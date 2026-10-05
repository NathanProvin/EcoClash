//! Scripted bot (INSTRUCTIONS §6, ROADMAP M4; D-014, D-060). The bot is just another player: it
//! reads the world and returns commands, which the host submits through the same queue as a
//! human's. It never mutates the world, so matches against it replay and verify like any other.
//!
//! Difficulty is reaction time and actions per decision (INSTRUCTIONS §6). Each decision tries a
//! rotating list of plays, keeping the first few that apply: follow the unlock plan, push grass
//! toward the enemy, plant shrubs and trees where the soil is ready, call decomposers, herbivores
//! and predators, and send herbivores raiding. Deterministic: no randomness, fixed orders.

use sim_core::balance::Act;
use sim_core::commands::{OrderKind, Payload};
use sim_core::fauna::Role;
use sim_core::fixed::ONE;
use sim_core::world::World;

/// How hard the bot plays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Level {
    Easy,
    Normal,
    Hard,
}

impl Level {
    /// Ticks between two decisions (10 Hz: 6 s, 3 s, 1.5 s).
    fn period(self) -> u64 {
        match self {
            Level::Easy => 60,
            Level::Normal => 30,
            Level::Hard => 15,
        }
    }

    /// Ticks before the bot founds its colony (D-101): a moment to look at the map, longer on
    /// easier levels.
    fn found_after(self) -> u64 {
        match self {
            Level::Easy => 150,
            Level::Normal => 100,
            Level::Hard => 60,
        }
    }

    /// Commands per decision at most.
    fn actions(self) -> usize {
        match self {
            Level::Easy => 2,
            Level::Normal => 3,
            Level::Hard => 4,
        }
    }

    /// Aggression (D-148): seconds between raids, the herd of units a raid needs, seconds between
    /// drop raids (None: never), and how many grazer cards the bot keeps on the map.
    fn aggression(self) -> (u64, usize, Option<u64>, i64) {
        match self {
            Level::Easy => (90, 8, None, 4),
            Level::Normal => (45, 4, Some(90), 6),
            Level::Hard => (30, 5, Some(60), 8),
        }
    }

    /// This level's income factor (D-143), from `[bots] income`.
    #[must_use]
    pub fn income(self, b: &sim_core::balance::Balance) -> f64 {
        b.bots.income[match self {
            Level::Easy => 0,
            Level::Normal => 1,
            Level::Hard => 2,
        }]
    }

    /// "easy", "normal" or "hard".
    #[must_use]
    pub fn parse(name: &str) -> Option<Level> {
        match name {
            "easy" => Some(Level::Easy),
            "normal" => Some(Level::Normal),
            "hard" => Some(Level::Hard),
            _ => None,
        }
    }
}

/// Unlock order (players start with lichen & moss only, D-118), by game phase (D-142): herbs and the first
/// grazers, then undergrowth, shrubs and the first hunters, then trees and the big hunters. Land only:
/// the bot leaves the aquatic families (W, HW, PW) to players for now.
const UNLOCKS: &[&str] = &[
    "grasses",
    "wildflowers",
    "ferns",
    "grasshoppers",
    "rabbits",
    "earthworms",
    "elder",
    "great_tit",
    "slugs",
    "nettle",
    "hawthorn",
    "kestrel",
    "oak",
    "caterpillars",
    "chestnut",
    "bark_beetles",
    "pine_marten",
    "bramble",
    "hazel",
    "fox",
    "lynx",
    "beech",
    "bison",
    "wolf",
];

/// Game-time pacing (D-143): an animal call at most every CALL_S seconds at every level, so faster
/// levels do not waste more. Raids and drops are paced per level (`Level::aggression`, D-148).
const CALL_S: u64 = 9;

/// Seconds of income the bot is willing to save for its next unlock (D-142).
const SAVE_HORIZON_S: i64 = 120;

/// Spreaders for the front line, best first.
const SPREADERS: &[&str] = &["grasses", "wildflowers", "lichen_and_moss"];

type Play = fn(&Bot, &View) -> Option<Payload>;

pub struct Bot {
    pub player: u8,
    level: Level,
    /// The brush radius of a plant order (`[flora] plant_radius`).
    radius: u32,
    next: u64,
    turn: usize,
}

/// What the bot reads from the world at one decision.
struct View<'a> {
    w: &'a World,
    n: usize,
    /// Where the bot's land and the enemy's are centred (row, col); the map centre if empty.
    home: (usize, usize),
    enemy: (usize, usize),
}

impl Bot {
    #[must_use]
    pub fn new(player: u8, level: Level, plant_radius: u32) -> Bot {
        Bot {
            player,
            level,
            radius: plant_radius,
            next: 0,
            turn: 0,
        }
    }

    /// Commands for this tick (usually none: the bot decides every `period` ticks). Call it once
    /// per tick, before the world steps, and submit the result for the current tick.
    pub fn think(&mut self, w: &World) -> Vec<Payload> {
        if w.tick < self.next || w.result.is_some() {
            return Vec::new();
        }
        self.next = w.tick + self.level.period();
        self.turn += 1;
        let n = w.state.n;
        let view = View {
            w,
            n,
            home: centroid(w, self.player).unwrap_or((n / 2, n / 2)),
            enemy: centroid(w, 3 - self.player).unwrap_or((n / 2, n / 2)),
        };
        if centroid(w, self.player).is_none() {
            if w.tick < self.level.found_after() {
                return Vec::new(); // looking the map over first (D-101)
            }
            return self.found(&view).into_iter().collect(); // no land yet: found the colony
        }
        let plays: [Play; 9] = [
            Bot::catastrophe,
            Bot::unlock,
            Bot::expand,
            Bot::succession,
            Bot::decomposers,
            Bot::herbivores,
            Bot::predators,
            Bot::drop_raiders,
            Bot::raid,
        ];
        let mut out = Vec::new();
        for k in 0..plays.len() {
            if out.len() >= self.level.actions() {
                break;
            }
            if let Some(p) = plays[(self.turn + k) % plays.len()](self, &view) {
                out.push(p);
            }
        }
        out
    }

    /// True once per `secs` of game time (at the first decision in each window).
    fn every(&self, v: &View, secs: u64) -> bool {
        v.w.tick % (secs * 10) < self.level.period()
    }

    /// Index of a species in the whole stat sheet (plants, then animals).
    fn sheet(w: &World, name: &str) -> Option<usize> {
        (w.flora.p.index(name)).or_else(|| w.fauna.p.index(name).map(|s| w.economy.animal(s)))
    }

    /// Whether `units` of species `i` fit in the bank above the savings for the next unlock.
    fn can_pay(&self, w: &World, i: usize, units: i64) -> bool {
        self.spare(w) >= w.economy.unit_cost(i, false) * units
    }

    /// The bank above the savings (D-142): when the next unlock of the plan is held back only by
    /// its price, and that price is within SAVE_HORIZON_S of income, the bot saves for it instead
    /// of spending everything on planting. Further goals do not freeze it.
    fn spare(&self, w: &World) -> i64 {
        let pi = usize::from(self.player - 1);
        let bank = w.economy.bank[pi];
        let reach = w.economy.income[pi] * SAVE_HORIZON_S;
        let saving = UNLOCKS
            .iter()
            .filter_map(|name| Bot::sheet(w, name))
            .find(|&i| !w.economy.is_unlocked(self.player, i))
            .filter(|&i| {
                w.economy
                    .check_unlock(self.player, i)
                    .is_err_and(|e| e.ends_with("biomass"))
            })
            .map_or(0, |i| w.economy.unlock_price(i));
        if saving > reach { bank } else { bank - saving }
    }

    /// The plan in order (D-142): the first species not unlocked yet that its tier and habitat
    /// allow; if only its price holds it back, wait and save for it rather than buy a cheaper,
    /// later one.
    fn unlock(&self, v: &View) -> Option<Payload> {
        let w = v.w;
        for name in UNLOCKS {
            let Some(i) = Bot::sheet(w, name) else {
                continue;
            };
            match w.economy.check_unlock(self.player, i) {
                Ok(()) => {
                    return Some(Payload::Unlock {
                        species: (*name).into(),
                    });
                }
                Err(e) if e.ends_with("biomass") => return None,
                Err(_) => {}
            }
        }
        None
    }

    /// No land yet (D-095): found the colony with the first unlocked spreader, on the free cell
    /// that suits it nearest the bot's side of the map (the generator's home clearing).
    fn found(&self, v: &View) -> Option<Payload> {
        let (w, n) = (v.w, v.n);
        let name = SPREADERS.iter().find(|name| {
            Bot::sheet(w, name).is_some_and(|i| w.economy.is_unlocked(self.player, i))
        })?;
        let s = w.flora.p.index(name)?;
        let home = sim_core::terrain::homes(n)[usize::from(self.player - 1)];
        let k = (0..n * n)
            .filter(|&k| {
                w.state.owner[k] == 0 && w.flora.suitability(&w.state, s, k) >= i64::from(ONE) / 2
            })
            .min_by_key(|&k| (dist2(k, n, (home / n, home % n)), k))?;
        Some(self.plant(name, k, n))
    }

    /// Grass on the free cell next to own land nearest the enemy: push the front.
    fn expand(&self, v: &View) -> Option<Payload> {
        let (w, n) = (v.w, v.n);
        let name = SPREADERS.iter().find(|name| {
            Bot::sheet(w, name).is_some_and(|i| {
                w.economy.is_unlocked(self.player, i) && self.can_pay(w, i, disc_cells(self.radius))
            })
        })?;
        let own = |k: usize| w.state.owner[k] == self.player;
        let target = (0..n * n)
            .filter(|&k| w.state.owner[k] == 0 && neighbours(k, n).any(own))
            .min_by_key(|&k| (dist2(k, n, v.enemy), k))?;
        Some(self.plant(name, target, n))
    }

    /// The tallest unlocked plant, on an own cell where the soil suits it and it is missing,
    /// nearest the enemy: undergrowth, shrubs and trees follow the grass (succession).
    fn succession(&self, v: &View) -> Option<Payload> {
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let p = &w.flora.p;
        let mut order: Vec<usize> = (0..p.species()).collect();
        order.sort_by_key(|&s| (std::cmp::Reverse(p.level[s]), s));
        for s in order {
            if p.level[s] < 2 // undergrowth, shrubs and trees (D-087, D-142)
                || !w.economy.is_unlocked(self.player, s)
                || !self.can_pay(w, s, disc_cells(self.radius) / 2)
            {
                continue;
            }
            let good = |k: usize| {
                w.state.owner[k] == self.player
                    && w.state.bio[s * n2 + k] == 0
                    && w.flora.suitability(&w.state, s, k) >= i64::from(ONE) / 2
            };
            // Easy grows its tall plants at home; normal and hard push them onto the front.
            let toward = if self.level == Level::Easy {
                v.home
            } else {
                v.enemy
            };
            if let Some(k) = (0..n2)
                .filter(|&k| good(k))
                .min_by_key(|&k| (dist2(k, n, toward), k))
            {
                return Some(self.plant(&p.names[s], k, n));
            }
        }
        None
    }

    /// A card of decomposers on own land, while there are few.
    fn decomposers(&self, v: &View) -> Option<Payload> {
        if !self.every(v, CALL_S) {
            return None; // calls are paced like a player's attention (D-142)
        }
        self.call(v, Role::Decomposer, 2, self.own_near(v, v.home)?)
    }

    /// Grazers on own land (base price) to build biomass, while there are few (D-061).
    fn herbivores(&self, v: &View) -> Option<Payload> {
        if !self.every(v, CALL_S) {
            return None;
        }
        self.call(
            v,
            Role::Herbivore,
            self.level.aggression().3,
            self.own_near(v, v.home)?,
        )
    }

    /// A raid by drop (×1.5, D-061): the most advanced unlocked herbivore that has food on enemy
    /// land, dropped on the enemy cell with its food nearest home.
    /// Normal and hard, at their drop pace (D-148), and only with a reserve of three such drops in
    /// the bank; units before swarms: a raid is a choice, not a reflex (D-142).
    fn drop_raiders(&self, v: &View) -> Option<Payload> {
        let every = self.level.aggression().2?;
        if !self.every(v, every) {
            return None;
        }
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let fa = &w.fauna.p;
        let mut order: Vec<usize> = (0..fa.names.len()).rev().collect();
        order.sort_by_key(|&s| fa.group_size(s) > 4); // units (small cards) first, stable
        order.into_iter().find_map(|s| {
            let i = w.economy.animal(s);
            let ready = fa.role[s] == Role::Herbivore
                && w.economy.is_unlocked(self.player, i)
                && self.spare(w) >= 3 * w.economy.unit_cost(i, true);
            if !ready {
                return None;
            }
            let food = |k: usize| {
                w.state.owner[k] == 3 - self.player
                    && (0..w.flora.p.species())
                        .any(|j| fa.eats_plant(s, j) && w.state.bio[j * n2 + k] >= 1)
            };
            let k = (0..n2)
                .filter(|&k| food(k))
                .min_by_key(|&k| (dist2(k, n, v.home), k))?;
            Some(Payload::Spawn {
                species: fa.names[s].clone(),
                row: u32::try_from(k / n).unwrap_or(0),
                col: u32::try_from(k % n).unwrap_or(0),
            })
        })
    }

    /// The own cell nearest `at` (a call there costs the base price).
    fn own_near(&self, v: &View, at: (usize, usize)) -> Option<(usize, usize)> {
        let n = v.n;
        (0..n * n)
            .filter(|&k| v.w.state.owner[k] == self.player)
            .min_by_key(|&k| (dist2(k, n, at), k))
            .map(|k| (k / n, k % n))
    }

    /// A predator on the enemy prey nearest own land (the sim drops it on the nearest match).
    fn predators(&self, v: &View) -> Option<Payload> {
        if self.level == Level::Easy || !self.every(v, CALL_S) {
            return None;
        }
        let a = &v.w.fauna.agents;
        let prey = (0..a.len())
            .filter(|&j| a.owner[j] == 3 - self.player)
            .map(|j| a.cell(j, v.n))
            .min_by_key(|&k| (dist2(k, v.n, v.home), k))?;
        self.call(v, Role::Predator, 2, (prey / v.n, prey % v.n))
    }

    /// Hard only (D-143): play a ready, affordable catastrophe card where it hurts the enemy most,
    /// on the enemy cell with the most tall plants (trees for the caterpillars, shrubs and trees
    /// for the storm), or the enemy cell nearest home (the spill). At most every CALL_S.
    fn catastrophe(&self, v: &View) -> Option<Payload> {
        if self.level != Level::Hard || !self.every(v, CALL_S) {
            return None;
        }
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let c = &w.catastrophes;
        let pi = usize::from(self.player - 1);
        let fl = &w.flora.p;
        let tall = |k: usize, min: u8| -> i64 {
            (0..fl.species())
                .filter(|&s| fl.level[s] >= min)
                .map(|s| w.state.bio[s * n2 + k])
                .sum()
        };
        let own: Vec<usize> = (0..n2)
            .filter(|&k| w.state.owner[k] == self.player)
            .collect();
        for k in 0..c.p.names.len() {
            if w.tick < c.ready[pi][k] || self.spare(w) < c.p.cost[k] {
                continue;
            }
            // Only where the disc spares the bot's own land (D-148): cards hit both sides.
            let r2 = u64::from(c.p.radius[k]).pow(2) as usize;
            let enemy: Vec<usize> = (0..n2)
                .filter(|&e| w.state.owner[e] == 3 - self.player)
                .filter(|&e| own.iter().all(|&o| dist2(o, n, (e / n, e % n)) > r2))
                .collect();
            let at = match c.p.act(k) {
                Act::KillTrees => enemy
                    .iter()
                    .copied()
                    .filter(|&k| tall(k, 4) > 0)
                    .max_by_key(|&k| (tall(k, 4), k)),
                Act::Storm => enemy
                    .iter()
                    .copied()
                    .filter(|&k| tall(k, 3) > 0)
                    .max_by_key(|&k| (tall(k, 3), k)),
                Act::Spill => enemy
                    .iter()
                    .copied()
                    .min_by_key(|&k| (dist2(k, n, v.home), k)),
            };
            if let Some(at) = at {
                return Some(Payload::Catastrophe {
                    kind: c.p.names[k].clone(),
                    row: u32::try_from(at / n).unwrap_or(0),
                    col: u32::try_from(at % n).unwrap_or(0),
                });
            }
        }
        None
    }

    /// At the level's raid pace, with a large enough herd of units (D-148): own herbivores
    /// attack-move to the enemy land nearest home.
    fn raid(&self, v: &View) -> Option<Payload> {
        let (every, herd, ..) = self.level.aggression();
        if !self.every(v, every) {
            return None;
        }
        let (w, n) = (v.w, v.n);
        let a = &w.fauna.agents;
        let ids: Vec<u32> = (0..a.len())
            .filter(|&i| {
                a.owner[i] == self.player && w.fauna.p.role[usize::from(a.sp[i])] == Role::Herbivore
            })
            .map(|i| a.id[i])
            .collect();
        let target = (0..n * n)
            .filter(|&k| w.state.owner[k] == 3 - self.player)
            .min_by_key(|&k| (dist2(k, n, v.home), k))?;
        let units = ids
            .iter()
            .filter(|&&id| {
                a.id.binary_search(&id)
                    .is_ok_and(|i| w.fauna.p.group_size(usize::from(a.sp[i])) <= 4)
            })
            .count();
        (units >= herd).then(|| Payload::Order {
            ids,
            kind: OrderKind::Attack,
            row: u32::try_from(target / n).unwrap_or(0),
            col: u32::try_from(target % n).unwrap_or(0),
        })
    }

    /// While the bot has fewer than `enough` cards of `role` on the map (animals over the card
    /// size: a swarm counts as one card, D-142): its most advanced unlocked species, units before
    /// swarms, if affordable and able to land at `at` now.
    fn call(&self, v: &View, role: Role, enough: i64, at: (usize, usize)) -> Option<Payload> {
        let w = v.w;
        let (fa, a) = (&w.fauna.p, &w.fauna.agents);
        let cards = |s: usize| {
            let mine = (0..a.len())
                .filter(|&i| a.owner[i] == self.player && usize::from(a.sp[i]) == s)
                .count();
            let mine = i64::try_from(mine).unwrap_or(i64::MAX);
            if fa.group_size(s) > 4 {
                mine.min(1) // a swarm breeds on its own: one card while it lives
            } else {
                mine / fa.group_size(s).max(1)
            }
        };
        let mut order: Vec<usize> = (0..fa.names.len()).rev().collect();
        order.sort_by_key(|&s| fa.group_size(s) > 4); // units (small cards) before swarms
        let total: i64 = (0..fa.names.len())
            .filter(|&s| fa.role[s] == role)
            .map(cards)
            .sum();
        if total >= enough {
            return None; // enough cards of this role on the map, whatever the species
        }
        let s = order.into_iter().find(|&s| {
            let i = w.economy.animal(s);
            fa.role[s] == role
                && w.economy.is_unlocked(self.player, i)
                && w.economy.affordable(self.player, w.economy.unit_cost(i, false)) >= 1 // the
                // savings hold back planting, not the few animals the bot keeps (D-142)
                && w.fauna
                    .spawn_site(&w.flora.p, &w.state, self.player, s, at)
                    .is_ok() // it can land there now (habitat, food or prey)
        })?;
        Some(Payload::Spawn {
            species: fa.names[s].clone(),
            row: u32::try_from(at.0).unwrap_or(0),
            col: u32::try_from(at.1).unwrap_or(0),
        })
    }

    fn plant(&self, name: &str, k: usize, n: usize) -> Payload {
        Payload::Plant {
            species: name.into(),
            row: u32::try_from(k / n).unwrap_or(0),
            col: u32::try_from(k % n).unwrap_or(0),
            radius: self.radius,
        }
    }
}

/// Cells of a plant disc of radius `r` (about π r²; enough to decide affordability).
fn disc_cells(r: u32) -> i64 {
    let r = i64::from(r);
    3 * r * r + 1
}

fn centroid(w: &World, player: u8) -> Option<(usize, usize)> {
    let n = w.state.n;
    let (mut sy, mut sx, mut c) = (0usize, 0usize, 0usize);
    for (k, &o) in w.state.owner.iter().enumerate() {
        if o == player {
            (sy, sx, c) = (sy + k / n, sx + k % n, c + 1);
        }
    }
    (c > 0).then(|| (sy / c, sx / c))
}

fn dist2(k: usize, n: usize, (r, c): (usize, usize)) -> usize {
    (k / n).abs_diff(r).pow(2) + (k % n).abs_diff(c).pow(2)
}

fn neighbours(k: usize, n: usize) -> impl Iterator<Item = usize> {
    let (r, c) = (k / n, k % n);
    [
        (r > 0).then(|| k - n),
        (r + 1 < n).then(|| k + n),
        (c > 0).then(|| k - 1),
        (c + 1 < n).then(|| k + 1),
    ]
    .into_iter()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim_core::balance::Balance;
    use sim_core::commands::Command;

    fn balance() -> Balance {
        Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .unwrap()
    }

    /// A match on the balance's map, both players opening as in the live client (home at n / 4,
    /// mirrored); `bots` play for their players. Returns the world after `minutes` and every
    /// tick's hash.
    fn play(bots: &mut [Bot], minutes: u64) -> (World, Vec<u64>) {
        let b = balance();
        let n = usize::try_from(b.sim.grid_size).unwrap();
        let mut w = World::new(&b, 1, n);
        w.generate_terrain(&sim_core::terrain::TerrainParams::from_balance(&b), 1); // a real map (D-083)
        let home = u32::try_from(n / 4).unwrap();
        let away = u32::try_from(n - 1 - n / 4).unwrap();
        w.setup_plant(1, "grasses", home, home, 3);
        w.setup_plant(2, "grasses", away, away, 3);
        let mut seq = [0u32; 2];
        let mut hashes = Vec::new();
        for _ in 0..minutes * 600 {
            for bot in bots.iter_mut() {
                for payload in bot.think(&w) {
                    let player = bot.player;
                    let s = &mut seq[usize::from(player - 1)];
                    w.submit(Command {
                        tick: w.tick,
                        player,
                        seq: *s,
                        payload,
                    });
                    *s += 1;
                }
            }
            hashes.push(w.step());
        }
        (w, hashes)
    }

    #[test]
    fn a_bot_outgrows_an_idle_player_and_its_orders_are_well_formed() {
        let b = balance();
        let mut bots = [Bot::new(2, Level::Normal, b.flora.plant_radius)];
        let (w, _) = play(&mut bots, 6);
        let t = w.territory();
        assert!(t[1] > t[0], "bot territory {} vs idle {}", t[1], t[0]);
        assert_eq!(w.rejected, 0, "no malformed or late command");
        let unlocked = w.economy.unlocked[1].iter().filter(|&&u| u).count();
        let free = w.economy.unlocked[0].iter().filter(|&&u| u).count();
        assert!(unlocked > free, "the bot unlocked cards");
    }

    #[test]
    fn a_bot_founds_its_colony_on_an_empty_map() {
        let b = balance();
        let n = usize::try_from(b.sim.grid_size).unwrap();
        let mut w = World::new(&b, 1, n);
        w.generate_terrain(&sim_core::terrain::TerrainParams::from_balance(&b), 1);
        let mut bot = Bot::new(2, Level::Easy, b.flora.plant_radius);
        for seq in 0..600 {
            for payload in bot.think(&w) {
                w.submit(Command {
                    tick: w.tick,
                    player: 2,
                    seq,
                    payload,
                });
            }
            w.step();
        }
        assert!(w.territory()[1] > 0, "the bot spawned and holds land");
        let mut early = World::new(&b, 1, n);
        early.generate_terrain(&sim_core::terrain::TerrainParams::from_balance(&b), 1);
        let mut bot = Bot::new(2, Level::Hard, b.flora.plant_radius);
        for _ in 0..Level::Hard.found_after() {
            assert!(
                bot.think(&early).is_empty(),
                "no spawn in the first seconds (D-101)"
            );
            early.step();
        }
        assert_eq!(w.territory()[0], 0, "the idle player has none");
    }

    #[test]
    fn bot_matches_replay_identically() {
        let b = balance();
        let r = b.flora.plant_radius;
        let mut a = [Bot::new(1, Level::Hard, r), Bot::new(2, Level::Easy, r)];
        let mut c = [Bot::new(1, Level::Hard, r), Bot::new(2, Level::Easy, r)];
        assert_eq!(play(&mut a, 3).1, play(&mut c, 3).1);
    }

    /// How a full match goes, for tuning by hand:
    /// `cargo test -p sim-ai --release -- --ignored --nocapture bot_report`.
    #[test]
    #[ignore = "report, run by hand in release"]
    fn bot_report() {
        let b = balance();
        let r = b.flora.plant_radius;
        let mut bots = [Bot::new(1, Level::Normal, r), Bot::new(2, Level::Hard, r)];
        let (w, _) = play(&mut bots, 20);
        let (t, s) = (w.territory(), w.standing());
        for p in 0..2 {
            let unlocked: Vec<&str> = (0..w.flora.p.species())
                .filter(|&i| w.economy.unlocked[p][i])
                .map(|i| w.flora.p.names[i].as_str())
                .chain(
                    (0..w.fauna.p.names.len())
                        .filter(|&s| w.economy.unlocked[p][w.economy.animal(s)])
                        .map(|s| w.fauna.p.names[s].as_str()),
                )
                .collect();
            let animals = w.fauna.census(u8::try_from(p + 1).unwrap());
            println!(
                "P{}: land {} cells, standing {}, bank {}, animals {:?}, unlocked {unlocked:?}",
                p + 1,
                t[p],
                s[p],
                w.economy.bank[p] >> 16,
                animals
            );
        }
        let push = w.pressure_frame();
        let pushed = push.iter().filter(|&&v| v > 0).count();
        let strongest = push.iter().max().copied().unwrap_or(0);
        println!("pushed cells {pushed}, strongest push {strongest}/255 (D-076)");
        println!("result {:?}, notices {}", w.result, w.notices.len());
        let mut kinds: std::collections::BTreeMap<String, usize> =
            std::collections::BTreeMap::new();
        for n in &w.notices {
            *kinds
                .entry(format!("{n:?}").chars().take(90).collect())
                .or_default() += 1;
        }
        println!("{kinds:#?}");
    }
}
