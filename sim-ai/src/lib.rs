//! Scripted bot (INSTRUCTIONS §6, ROADMAP M4; D-014, D-060). The bot is just another player: it
//! reads the world and returns commands, which the host submits through the same queue as a
//! human's. It never mutates the world, so matches against it replay and verify like any other.
//!
//! Difficulty is reaction time and actions per decision (INSTRUCTIONS §6). Each decision tries a
//! rotating list of plays, keeping the first few that apply: follow the unlock plan, push grass
//! toward the enemy, plant shrubs and trees where the soil is ready, call decomposers, herbivores
//! and predators, and send herbivores raiding. Deterministic: no randomness, fixed orders.

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

    /// Commands per decision at most.
    fn actions(self) -> usize {
        match self {
            Level::Easy => 1,
            Level::Normal => 2,
            Level::Hard => 3,
        }
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

/// Unlock order: meadow income first, then succession, then the food web.
const UNLOCKS: &[&str] = &[
    "wildflowers",
    "elder",
    "grasshoppers",
    "nettle",
    "voles",
    "hazel",
    "oak",
    "bramble",
    "caterpillars",
    "hedgehog",
    "fox",
    "hawthorn",
    "beech",
    "tits",
    "buzzard",
    "chestnut",
    "tawny_owl",
    "lynx",
];

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
        let plays: [Play; 8] = [
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

    /// Index of a species in the whole stat sheet (plants, then animals).
    fn sheet(w: &World, name: &str) -> Option<usize> {
        (w.flora.p.index(name)).or_else(|| w.fauna.p.index(name).map(|s| w.economy.animal(s)))
    }

    fn can_pay(&self, w: &World, i: usize, units: i64) -> bool {
        w.economy
            .affordable(self.player, w.economy.unit_cost(i, false))
            >= units
    }

    /// The next species of the plan that may be unlocked now (and is affordable).
    fn unlock(&self, v: &View) -> Option<Payload> {
        let w = v.w;
        UNLOCKS.iter().find_map(|name| {
            let i = Bot::sheet(w, name)?;
            w.economy.check_unlock(self.player, i).ok()?;
            Some(Payload::Unlock {
                species: (*name).into(),
            })
        })
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
    /// nearest the enemy: shrubs and trees follow the grass (succession).
    fn succession(&self, v: &View) -> Option<Payload> {
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let p = &w.flora.p;
        let mut order: Vec<usize> = (0..p.species()).collect();
        order.sort_by_key(|&s| (std::cmp::Reverse(p.level[s]), s));
        for s in order {
            if p.level[s] < 2
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
            if let Some(k) = (0..n2)
                .filter(|&k| good(k))
                .min_by_key(|&k| (dist2(k, n, v.enemy), k))
            {
                return Some(self.plant(&p.names[s], k, n));
            }
        }
        None
    }

    /// A card of decomposers on own land, while there are few.
    fn decomposers(&self, v: &View) -> Option<Payload> {
        self.call(v, Role::Decomposer, 8, self.own_near(v, v.home)?)
    }

    /// Grazers on own land (base price) to build biomass, while there are few (D-061).
    fn herbivores(&self, v: &View) -> Option<Payload> {
        self.call(v, Role::Herbivore, 12, self.own_near(v, v.home)?)
    }

    /// A raid by drop (×1.5, D-061): the most advanced unlocked herbivore that has food on enemy
    /// land, dropped on the enemy cell with its food nearest home.
    fn drop_raiders(&self, v: &View) -> Option<Payload> {
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let fa = &w.fauna.p;
        (0..fa.names.len()).rev().find_map(|s| {
            let i = w.economy.animal(s);
            let ready = fa.role[s] == Role::Herbivore
                && w.economy.is_unlocked(self.player, i)
                && w.economy
                    .affordable(self.player, w.economy.unit_cost(i, true))
                    >= 1;
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
        let a = &v.w.fauna.agents;
        let prey = (0..a.len())
            .filter(|&j| a.owner[j] == 3 - self.player)
            .map(|j| a.cell(j, v.n))
            .min_by_key(|&k| (dist2(k, v.n, v.home), k))?;
        self.call(v, Role::Predator, 3, (prey / v.n, prey % v.n))
    }

    /// Every fourth decision: own herbivores attack-move to the enemy land nearest home.
    fn raid(&self, v: &View) -> Option<Payload> {
        if !self.turn.is_multiple_of(4) {
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
        (!ids.is_empty()).then(|| Payload::Order {
            ids,
            kind: OrderKind::Attack,
            row: u32::try_from(target / n).unwrap_or(0),
            col: u32::try_from(target % n).unwrap_or(0),
        })
    }

    /// Spawn the most advanced unlocked, affordable species of `role` near `at`, if the bot has
    /// fewer than `enough` animals of that role.
    fn call(&self, v: &View, role: Role, enough: usize, at: (usize, usize)) -> Option<Payload> {
        let w = v.w;
        let (fa, a) = (&w.fauna.p, &w.fauna.agents);
        let mine = (0..a.len())
            .filter(|&i| a.owner[i] == self.player && fa.role[usize::from(a.sp[i])] == role)
            .count();
        if mine >= enough {
            return None;
        }
        let s = (0..fa.names.len()).rev().find(|&s| {
            let i = w.economy.animal(s);
            fa.role[s] == role && w.economy.is_unlocked(self.player, i) && self.can_pay(w, i, 1)
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
    }
}
