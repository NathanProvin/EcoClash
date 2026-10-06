//! Scripted bot (INSTRUCTIONS §6, ROADMAP M4; D-014, D-060). The bot is just another player: it
//! reads the world and returns commands, which the host submits through the same queue as a
//! human's. It never mutates the world, so matches against it replay and verify like any other.
//!
//! Difficulty is reaction time, anticipation and actions per decision (INSTRUCTIONS §6). Each
//! decision reads the map (`Intel`: enemy animals on its land and near its herds, the enemy's
//! plants, water) and tries a rotating list of plays, keeping the first few that apply: unlock
//! the answer to the worst threat or the next card of the plan, push the front (grass on land,
//! algae in the shallows), grow taller plants, call recyclers and grazers fit for the food at
//! hand, answer raids with the hunter that eats the raiders, raid with the grazers that eat what
//! the enemy grows (D-191, D-192). Deterministic: no randomness, fixed orders.

use sim_core::balance::Act;
use sim_core::commands::{OrderKind, Payload};
use sim_core::fauna::Role;
use sim_core::fixed::ONE;
use sim_core::terrain::SHALLOW;
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

    /// Reaction (D-191): seconds a threat must last before the bot answers it, and what it
    /// answers: raids on its land always; enemy hunters stalking its herds from normal up; any
    /// enemy species on the map (anticipation) on hard.
    fn reaction(self) -> (u64, bool, bool) {
        match self {
            Level::Easy => (60, false, false),
            Level::Normal => (15, true, false),
            Level::Hard => (0, true, true),
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

/// The backbone plan (players start with lichen & moss only, D-118), by game phase (D-142): herbs,
/// the first grazers and their cheap answers (D-187), undergrowth and shrubs with their eaters,
/// then trees, the big grazers and the big hunters. Every land card is on it (D-191); counters to
/// what the enemy shows jump ahead of it.
const UNLOCKS: &[&str] = &[
    "grasses",
    "wildflowers",
    "ferns",
    "grasshoppers",
    "great_tit",
    "rabbits",
    "weasel",
    "earthworms",
    "elder",
    "slugs",
    "nettle",
    "bank_vole",
    "hawk",
    "hawthorn",
    "fungi",
    "caterpillars",
    "fox",
    "oak",
    "red_squirrel",
    "chestnut",
    "bark_beetles",
    "wildcat",
    "black_woodpecker",
    "bramble",
    "roe_deer",
    "hazel",
    "lynx",
    "pine_marten",
    "red_deer",
    "beech",
    "wild_boar",
    "bison",
    "eagle_owl",
    "wolf",
    "brown_bear",
];

/// On maps with water (D-192), the water cards join the plan, each after the card named first.
const WATER_PLAN: &[(&str, &str)] = &[
    ("ferns", "algae_and_lilies"),
    ("earthworms", "larvae"),
    ("nettle", "reeds"),
    ("hawk", "frog"),
    ("frog", "pike"),
    ("caterpillars", "roach"),
    ("oak", "beaver"),
    ("bramble", "cattails"),
    ("wildcat", "heron"),
    ("heron", "badger"),
    ("hazel", "mallard"),
    ("pine_marten", "otter"),
];

/// Game-time pacing (D-143): an animal call at most every CALL_S seconds at every level, so faster
/// levels do not waste more. Raids and drops are paced per level (`Level::aggression`, D-148).
const CALL_S: u64 = 9;

/// Seconds of income the bot is willing to save for its next unlock (D-142).
const SAVE_HORIZON_S: i64 = 120;

/// Spreaders for the front line, best first; each border cell takes the first that suits it
/// (algae in the shallows, D-192).
const SPREADERS: &[&str] = &[
    "grasses",
    "wildflowers",
    "lichen_and_moss",
    "algae_and_lilies",
];

/// Founding (D-194): one candidate site per block of this many cells, a choice among the best few.
const FOUND_BLOCK: usize = 6;
const FOUND_CHOICES: usize = 4;

/// Hunter cards the bot keeps for hunting and for answering raids (D-191).
const HUNT_CARDS: i64 = 2;
const DEFEND_CARDS: i64 = 4;

/// Cells around an enemy hunter where it threatens the bot's animals (D-191).
const STALK_CELLS: usize = 3;

type Play = fn(&Bot, &View) -> Option<Payload>;

pub struct Bot {
    pub player: u8,
    level: Level,
    /// The brush radius of a plant order (`[flora] plant_radius`).
    radius: u32,
    next: u64,
    turn: usize,
    /// Per animal species: the tick since which it has threatened the bot without a break
    /// (u64::MAX: not now), for the level's reaction time (D-191).
    since: Vec<u64>,
}

/// What the bot knows at one decision (D-191): the map only, as a player sees it, never the
/// enemy's cards.
#[derive(Default)]
struct Intel {
    /// Enemy animals per species: on the bot's land (raiders), near its animals that they eat
    /// (stalkers), anywhere.
    raiders: Vec<i64>,
    stalkers: Vec<i64>,
    seen: Vec<i64>,
    /// Cells per plant species that the enemy / the bot holds with it.
    enemy_plants: Vec<i64>,
    own_plants: Vec<i64>,
    /// The map has shallow water.
    water: bool,
}

/// What the bot reads from the world at one decision.
struct View<'a> {
    w: &'a World,
    n: usize,
    /// Where the bot's land and the enemy's are centred (row, col); the map centre if empty.
    home: (usize, usize),
    enemy: (usize, usize),
    intel: Intel,
    /// Threats the bot answers now, worst first: animal species (D-191).
    threats: Vec<usize>,
    /// The bank above the savings, worked out once per decision (D-207): the bank cannot change
    /// within one (commands apply at the next tick).
    spare: i64,
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
            since: Vec::new(),
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
        let intel = self.intel(w);
        let threats = self.threats(w, &intel);
        let mut view = View {
            w,
            n,
            home: centroid(w, self.player).unwrap_or((n / 2, n / 2)),
            enemy: centroid(w, 3 - self.player).unwrap_or((n / 2, n / 2)),
            intel,
            threats,
            spare: 0,
        };
        view.spare = self.savings(&view);
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
            Bot::defend,
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

    /// Read the map (D-191): enemy animals on own land, near own animals they eat, anywhere;
    /// plant cover per side; water.
    fn intel(&self, w: &World) -> Intel {
        let (n, n2) = (w.state.n, w.state.n * w.state.n);
        let (fa, a) = (&w.fauna.p, &w.fauna.agents);
        let ns = fa.names.len();
        let mut i = Intel {
            raiders: vec![0; ns],
            stalkers: vec![0; ns],
            seen: vec![0; ns],
            enemy_plants: vec![0; w.flora.p.species()],
            own_plants: vec![0; w.flora.p.species()],
            water: w.state.ground.contains(&SHALLOW),
        };
        // Own animal species present per cell (a mask), to find enemy hunters near them.
        let mut mine = vec![0u64; n2];
        for j in (0..a.len()).filter(|&j| a.owner[j] == self.player) {
            mine[a.cell(j, n)] |= 1 << a.sp[j];
        }
        for j in (0..a.len()).filter(|&j| a.owner[j] == 3 - self.player) {
            let (s, k) = (usize::from(a.sp[j]), a.cell(j, n));
            i.seen[s] += 1;
            if w.state.owner[k] == self.player && fa.role[s] == Role::Herbivore {
                i.raiders[s] += 1;
            }
            if fa.role[s] == Role::Predator {
                let (r, c) = (k / n, k % n);
                let near = (r.saturating_sub(STALK_CELLS)..(r + STALK_CELLS + 1).min(n))
                    .flat_map(|y| {
                        (c.saturating_sub(STALK_CELLS)..(c + STALK_CELLS + 1).min(n))
                            .map(move |x| y * n + x)
                    })
                    .any(|q| {
                        (0..ns).any(|p| mine[q] >> p & 1 == 1 && fa.prey_rank(s, p).is_some())
                    });
                if near {
                    i.stalkers[s] += 1;
                }
            }
        }
        for s in 0..w.flora.p.species() {
            for k in (0..n2).filter(|&k| w.state.bio[s * n2 + k] >= 1) {
                match w.state.owner[k] {
                    o if o == self.player => i.own_plants[s] += 1,
                    o if o == 3 - self.player => i.enemy_plants[s] += 1,
                    _ => {}
                }
            }
        }
        i
    }

    /// The threats the bot answers now, worst first (D-191): raids on its land, weighted by what
    /// the raiders cost; enemy hunters near its animals (normal and hard); any enemy species seen
    /// (hard). Each must have lasted the level's reaction time.
    fn threats(&mut self, w: &World, i: &Intel) -> Vec<usize> {
        let (delay, stalk, anticipate) = self.level.reaction();
        let fa = &w.fauna.p;
        let ns = fa.names.len();
        self.since.resize(ns, u64::MAX);
        let mut weighed: Vec<(i64, usize)> = Vec::new();
        for s in 0..ns {
            if fa.role[s] == Role::Decomposer {
                continue; // recyclers threaten nothing
            }
            let cost = w.economy.unit_cost(w.economy.animal(s), false) >> 16;
            let weight = 3 * i.raiders[s] * cost
                + if stalk { 2 * i.stalkers[s] * cost } else { 0 }
                + if anticipate { i.seen[s] * cost } else { 0 };
            if weight == 0 {
                self.since[s] = u64::MAX;
                continue;
            }
            if self.since[s] == u64::MAX {
                self.since[s] = w.tick;
            }
            if w.tick - self.since[s] >= delay * 10 {
                weighed.push((weight, s));
            }
        }
        weighed.sort_by_key(|&(wt, s)| (std::cmp::Reverse(wt), s));
        weighed.into_iter().map(|(_, s)| s).collect()
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
    fn can_pay(&self, v: &View, i: usize, units: i64) -> bool {
        self.spare(v) >= v.w.economy.unit_cost(i, false) * units
    }

    /// The bank above the savings (D-142): when the next unlock (an answer to a threat, or the
    /// plan's next card) is held back only by its price, and that price is within
    /// SAVE_HORIZON_S of income, the bot saves for it instead of spending everything on planting.
    fn spare(&self, v: &View) -> i64 {
        v.spare
    }

    fn savings(&self, v: &View) -> i64 {
        let w = v.w;
        let pi = usize::from(self.player - 1);
        let bank = w.economy.bank[pi];
        let reach = w.economy.income[pi] * SAVE_HORIZON_S;
        let unlock = self
            .goal(v)
            .filter(|&i| {
                w.economy
                    .check_unlock(self.player, i)
                    .is_err_and(|e| e.ends_with("biomass"))
            })
            .map_or(0, |i| w.economy.unlock_price(i));
        // The raid fund (D-192): levels that drop raids keep the price of the next drop too.
        let army = match self.level.aggression().2 {
            Some(_) => self.raider(v).map_or(0, |s| self.drop_cost(v, s)),
            None => 0,
        };
        let keep = |x: i64| if x > reach { 0 } else { x };
        bank - keep(unlock) - keep(army)
    }

    /// What a drop of grazer `s` on enemy land costs: a card, at the drop surcharge (D-061).
    fn drop_cost(&self, v: &View, s: usize) -> i64 {
        let w = v.w;
        w.economy.unit_cost(w.economy.animal(s), true) * w.fauna.p.group_size(s)
    }

    /// The raid grazer (D-192): the unlocked one that finds the most of its food on enemy land,
    /// less where enemy hunters that eat it roam, spread over the cards already out; units before
    /// swarms (D-142).
    fn raider(&self, v: &View) -> Option<usize> {
        let w = v.w;
        let fa = &w.fauna.p;
        let hunted = |s: usize| -> i64 {
            (0..fa.names.len())
                .filter(|&h| fa.prey_rank(h, s).is_some())
                .map(|h| v.intel.seen[h])
                .sum()
        };
        (0..fa.names.len())
            .filter(|&s| {
                fa.role[s] == Role::Herbivore
                    && w.economy.is_unlocked(self.player, w.economy.animal(s))
            })
            .map(|s| {
                let score = Bot::food_for(v, s, &v.intel.enemy_plants) - 8 * hunted(s);
                (self.varied(v, s, score), s)
            })
            .filter(|&(score, _)| score > 0)
            .max_by_key(|&(score, s)| (fa.group_size(s) <= 4, score, s))
            .map(|(_, s)| s)
    }

    /// The card to unlock next (D-191): the next step toward the cheapest answer to the worst
    /// threat; with no threat, the plan's first card that its tier and habitat allow.
    fn goal(&self, v: &View) -> Option<usize> {
        let w = v.w;
        let fa = &w.fauna.p;
        for &q in &v.threats {
            let best = (0..fa.names.len())
                .filter(|&h| fa.role[h] == Role::Predator)
                .filter_map(|h| Some((fa.prey_rank(h, q)?, h)))
                .map(|(rank, h)| {
                    let (cost, step) = self.path(w, w.economy.animal(h), 3);
                    (rank, cost, h, step)
                })
                .min_by_key(|&(rank, cost, h, _)| (rank, cost, h));
            match best {
                Some((_, _, _, Some(step))) => return Some(step),
                Some((.., None)) => continue, // already answered: the next threat
                None => {}
            }
        }
        self.plan(v).into_iter().find_map(|name| {
            let i = Bot::sheet(w, name)?;
            match w.economy.check_unlock(self.player, i) {
                Ok(()) => Some(i),
                Err(e) if e.ends_with("biomass") => Some(i),
                Err(_) => None,
            }
        })
    }

    /// The plan for this map: the backbone, with the water cards on maps with water (D-192).
    fn plan(&self, v: &View) -> Vec<&'static str> {
        let mut plan: Vec<&str> = UNLOCKS.to_vec();
        if v.intel.water {
            for &(after, name) in WATER_PLAN {
                let at = plan
                    .iter()
                    .position(|&x| x == after)
                    .map_or(plan.len(), |p| p + 1);
                plan.insert(at, name);
            }
        }
        plan
    }

    /// What card `i` still costs to reach (its price plus its missing lower tier and habitat
    /// plant, the cheapest of each), and the first card to unlock on the way (None: unlocked).
    fn path(&self, w: &World, i: usize, depth: u8) -> (i64, Option<usize>) {
        let e = &w.economy;
        if e.is_unlocked(self.player, i) {
            return (0, None);
        }
        let mut cost = e.unlock_price(i);
        let mut first = None;
        if depth == 0 {
            return (cost, Some(i));
        }
        let cards = w.flora.p.species() + w.fauna.p.names.len();
        let (animal, family, tier) = e.card(i);
        if tier > 1 {
            let below = (0..cards).filter(|&j| e.card(j) == (animal, family, tier - 1));
            if !below.clone().any(|j| e.is_unlocked(self.player, j)) {
                let best = below
                    .map(|j| self.path(w, j, depth - 1))
                    .min_by_key(|&(c, _)| c);
                if let Some((c, step)) = best {
                    cost += c;
                    first = first.or(step);
                }
            }
        }
        if animal {
            let s = i - w.flora.p.species();
            let mask = e.habitat_of(s);
            let plants = (0..w.flora.p.species()).filter(|&j| mask >> j & 1 == 1);
            if !plants.clone().any(|j| e.is_unlocked(self.player, j)) {
                let best = plants
                    .map(|j| self.path(w, j, depth - 1))
                    .min_by_key(|&(c, _)| c);
                if let Some((c, step)) = best {
                    cost += c;
                    first = first.or(step);
                }
            }
        }
        (cost, first.or(Some(i)))
    }

    /// Unlock the goal when it can be unlocked now; otherwise wait (and save) for it.
    fn unlock(&self, v: &View) -> Option<Payload> {
        let i = self.goal(v)?;
        v.w.economy.check_unlock(self.player, i).ok()?;
        let w = v.w;
        let name = if i < w.flora.p.species() {
            w.flora.p.names[i].clone()
        } else {
            w.fauna.p.names[i - w.flora.p.species()].clone()
        };
        Some(Payload::Unlock { species: name })
    }

    /// No land yet (D-095): found the colony with the first unlocked spreader (D-194). The sites
    /// are free cells it suits on the bot's half of the map (the map is 180° symmetric across the
    /// anti-diagonal), a third of the map or more from any enemy land; one per FOUND_BLOCK block,
    /// scored by suitability and water nearby. Among the best FOUND_CHOICES, a fingerprint of the
    /// map picks one: it varies from map to map, deterministically. With no such site: the free
    /// suited cell nearest the generator's home clearing.
    fn found(&self, v: &View) -> Option<Payload> {
        let (w, n) = (v.w, v.n);
        let name = SPREADERS.iter().find(|name| {
            Bot::sheet(w, name).is_some_and(|i| w.economy.is_unlocked(self.player, i))
        })?;
        let s = w.flora.p.index(name)?;
        let half = i64::from(ONE) / 2;
        let suits = |k: usize| w.state.owner[k] == 0 && w.flora.suitability(&w.state, s, k) >= half;
        let mine = |k: usize| {
            let d = k / n + k % n;
            if self.player == 1 {
                d < n - 1
            } else {
                d > n - 1
            }
        };
        let enemy: Vec<usize> = (0..n * n)
            .filter(|&k| w.state.owner[k] == 3 - self.player)
            .collect();
        let far = (n / 3).pow(2);
        let wet = |k: usize| {
            let (r, c) = (k / n, k % n);
            (r.saturating_sub(2)..(r + 3).min(n)).any(|y| {
                (c.saturating_sub(2)..(c + 3).min(n)).any(|x| w.state.ground[y * n + x] == SHALLOW)
            })
        };
        let mut best: std::collections::BTreeMap<(usize, usize), (i64, usize)> = Default::default();
        for k in (0..n * n).filter(|&k| suits(k) && mine(k)) {
            if enemy.iter().any(|&e| dist2(e, n, (k / n, k % n)) < far) {
                continue;
            }
            let score = w.flora.suitability(&w.state, s, k) + if wet(k) { half / 2 } else { 0 };
            let block = (k / n / FOUND_BLOCK, k % n / FOUND_BLOCK);
            let slot = best.entry(block).or_insert((score, k));
            if (score, std::cmp::Reverse(k)) > (slot.0, std::cmp::Reverse(slot.1)) {
                *slot = (score, k);
            }
        }
        let mut sites: Vec<(i64, usize)> = best.into_values().collect();
        sites.sort_by_key(|&(score, k)| (std::cmp::Reverse(score), k));
        sites.truncate(FOUND_CHOICES);
        let print = w
            .state
            .elevation
            .iter()
            .zip(&w.state.ground)
            .fold(0u64, |h, (e, &g)| {
                h.wrapping_mul(31)
                    .wrapping_add(e.unsigned_abs())
                    .wrapping_add(u64::from(g))
            });
        let k = match sites.len() {
            0 => {
                let home = sim_core::terrain::homes(n)[usize::from(self.player - 1)];
                (0..n * n)
                    .filter(|&k| suits(k))
                    .min_by_key(|&k| (dist2(k, n, (home / n, home % n)), k))?
            }
            len => sites[usize::try_from(print % len as u64).unwrap_or(0)].1,
        };
        Some(self.plant(name, k, n))
    }

    /// Push the front: the free cell next to own land nearest the enemy that an unlocked,
    /// affordable spreader suits (grass on land, algae in the shallows; D-192).
    fn expand(&self, v: &View) -> Option<Payload> {
        let (w, n) = (v.w, v.n);
        let spreaders: Vec<(&str, usize)> = SPREADERS
            .iter()
            .filter_map(|name| {
                let i = Bot::sheet(w, name)?;
                (w.economy.is_unlocked(self.player, i)
                    && self.can_pay(v, i, disc_cells(self.radius)))
                .then_some((*name, w.flora.p.index(name)?))
            })
            .collect();
        if spreaders.is_empty() {
            return None;
        }
        let own = |k: usize| w.state.owner[k] == self.player;
        let mut border: Vec<usize> = (0..n * n)
            .filter(|&k| w.state.owner[k] == 0 && neighbours(k, n).any(own))
            .collect();
        border.sort_by_key(|&k| (dist2(k, n, v.enemy), k));
        border.into_iter().find_map(|k| {
            let (name, _) = spreaders
                .iter()
                .find(|&&(_, s)| w.flora.suitability(&w.state, s, k) >= i64::from(ONE) / 2)?;
            Some(self.plant(name, k, n))
        })
    }

    /// The tallest unlocked plant, on an own cell where the soil suits it and it is missing,
    /// nearest the enemy: undergrowth, shrubs and trees follow the grass (succession); reeds and
    /// cattails take the shores (D-192).
    fn succession(&self, v: &View) -> Option<Payload> {
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let p = &w.flora.p;
        let mut order: Vec<usize> = (0..p.species()).collect();
        order.sort_by_key(|&s| (std::cmp::Reverse(p.level[s]), s));
        for s in order {
            if p.level[s] < 2 // undergrowth, shrubs and trees (D-087, D-142)
                || !w.economy.is_unlocked(self.player, s)
                || !self.can_pay(v, s, disc_cells(self.radius) / 2)
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
        let at = self.own_near(v, v.home)?;
        let s = self.pick(v, Role::Decomposer, 3, |s| self.varied(v, s, 8), at)?;
        Some(self.spawn(v, s, at))
    }

    /// How much food grazer `s` finds on one side's land (D-192): cells of its foods, the primary
    /// one counting most and taller plants more (they hold more biomass: height squared). The
    /// choice of grazer, for income at home and for raids.
    fn food_for(v: &View, s: usize, cells: &[i64]) -> i64 {
        let (fa, fl) = (&v.w.fauna.p, &v.w.flora.p);
        (0..cells.len())
            .filter_map(|j| Some((fa.plant_rank(s, j)?, j)))
            .map(|(rank, j)| cells[j] * [4, 2, 1][rank.min(2)] * i64::from(fl.level[j]).pow(2))
            .sum()
    }

    /// Grazers on own land (base price) to build biomass, while there are few (D-061): the one
    /// that finds the most of its food on own land (D-192).
    fn herbivores(&self, v: &View) -> Option<Payload> {
        if !self.every(v, CALL_S) {
            return None;
        }
        let at = self.own_near(v, v.home)?;
        let food = |s: usize| self.varied(v, s, Bot::food_for(v, s, &v.intel.own_plants));
        let s = self.pick(v, Role::Herbivore, self.level.aggression().3, food, at)?;
        Some(self.spawn(v, s, at))
    }

    /// A raid by drop (×1.5, D-061): the raid grazer (`raider`, D-192), dropped on the enemy cell
    /// with its food nearest home. Normal and hard, at their drop pace (D-148), once the raid
    /// fund that `spare` keeps holds the drop's price.
    fn drop_raiders(&self, v: &View) -> Option<Payload> {
        let every = self.level.aggression().2?;
        if !self.every(v, every) {
            return None;
        }
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let fa = &w.fauna.p;
        let s = self.raider(v)?;
        if w.economy.bank[usize::from(self.player - 1)] < self.drop_cost(v, s) {
            return None; // the raid fund is not full yet
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
    }

    /// The own cell nearest `at` (a call there costs the base price).
    fn own_near(&self, v: &View, at: (usize, usize)) -> Option<(usize, usize)> {
        let n = v.n;
        (0..n * n)
            .filter(|&k| v.w.state.owner[k] == self.player)
            .min_by_key(|&k| (dist2(k, n, at), k))
            .map(|k| (k / n, k % n))
    }

    /// Hunters (D-191). First, answer the worst threat: the hunter that eats it best (primary
    /// food first), dropped where most of those animals are. Then, normal and hard hunt: the
    /// hunter-and-prey pair with the best rank, the prey nearest home. Easy only answers raids.
    fn defend(&self, v: &View) -> Option<Payload> {
        if !self.every(v, CALL_S) {
            return None;
        }
        let (w, n) = (v.w, v.n);
        let (fa, a) = (&w.fauna.p, &w.fauna.agents);
        let enemy = |j: usize| a.owner[j] == 3 - self.player;
        for &q in &v.threats {
            // Where most of them are: the cell with the most of species q.
            let mut cells: Vec<usize> = (0..a.len())
                .filter(|&j| enemy(j) && usize::from(a.sp[j]) == q)
                .map(|j| a.cell(j, n))
                .collect();
            cells.sort_unstable();
            let Some(k) = cells
                .chunk_by(|x, y| x == y)
                .max_by_key(|c| (c.len(), std::cmp::Reverse(c[0])))
                .map(|c| c[0])
            else {
                continue;
            };
            let at = (k / n, k % n);
            let rank = |h: usize| fa.prey_rank(h, q);
            if let Some(h) = self.pick(
                v,
                Role::Predator,
                DEFEND_CARDS,
                |h| rank(h).map_or(0, |r| 3 - i64::try_from(r).unwrap_or(2)),
                at,
            ) {
                return Some(self.spawn(v, h, at));
            }
        }
        if self.level == Level::Easy {
            return None;
        }
        // Hunting: each unlocked hunter's best-ranked enemy prey nearest home; the best pair.
        let mut best: Option<(usize, usize, usize, usize)> = None; // (rank, dist, hunter, cell)
        for h in (0..fa.names.len()).filter(|&h| fa.role[h] == Role::Predator) {
            if !w.economy.is_unlocked(self.player, w.economy.animal(h)) {
                continue;
            }
            for j in (0..a.len()).filter(|&j| enemy(j)) {
                let Some(r) = fa.prey_rank(h, usize::from(a.sp[j])) else {
                    continue;
                };
                let k = a.cell(j, n);
                let cand = (r, dist2(k, n, v.home), h, k);
                if best.is_none_or(|b| (cand.0, cand.1, cand.2, cand.3) < b) {
                    best = Some(cand);
                }
            }
        }
        let (_, _, h, k) = best?;
        let at = (k / n, k % n);
        let s = self.pick(v, Role::Predator, HUNT_CARDS, |x| i64::from(x == h), at)?;
        Some(self.spawn(v, s, at))
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
        // Cells within `r` of own land (D-207): one dilation, not every own cell for every enemy one.
        let near_own = |r: usize| -> Vec<bool> {
            let mut near = vec![false; n2];
            let ri = isize::try_from(r).unwrap_or(0);
            let ni = isize::try_from(n).unwrap_or(0);
            for &o in &own {
                let (or, oc) = (
                    isize::try_from(o / n).unwrap_or(0),
                    isize::try_from(o % n).unwrap_or(0),
                );
                for dy in -ri..=ri {
                    for dx in -ri..=ri {
                        let (y, x) = (or + dy, oc + dx);
                        if (dy * dy + dx * dx) as usize <= r * r
                            && (0..ni).contains(&y)
                            && (0..ni).contains(&x)
                        {
                            near[usize::try_from(y * ni + x).unwrap_or(0)] = true;
                        }
                    }
                }
            }
            near
        };
        for k in 0..c.p.names.len() {
            if w.tick < c.ready[pi][k] || self.spare(v) < c.p.cost[k] {
                continue;
            }
            // Only where the disc spares the bot's own land (D-148): cards hit both sides.
            let near = near_own(usize::try_from(c.p.radius[k]).unwrap_or(0));
            let enemy: Vec<usize> = (0..n2)
                .filter(|&e| w.state.owner[e] == 3 - self.player && !near[e])
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
    /// size: a swarm counts as one card, D-142): the unlocked, affordable species of that role
    /// with the best `score` (0: unfit) that can land at `at` now; units before swarms, then the
    /// higher tier.
    fn pick(
        &self,
        v: &View,
        role: Role,
        enough: i64,
        score: impl Fn(usize) -> i64,
        at: (usize, usize),
    ) -> Option<usize> {
        let w = v.w;
        let fa = &w.fauna.p;
        let cards = |s: usize| self.cards(v, s);
        let total: i64 = (0..fa.names.len())
            .filter(|&s| fa.role[s] == role)
            .map(cards)
            .sum();
        if total >= enough {
            return None; // enough cards of this role on the map, whatever the species
        }
        (0..fa.names.len())
            .filter(|&s| {
                let i = w.economy.animal(s);
                fa.role[s] == role
                    && score(s) > 0
                    && w.economy.is_unlocked(self.player, i)
                    && w.economy.affordable(self.player, w.economy.unit_cost(i, false)) >= 1 // the
                    // savings hold back planting, not the few animals the bot keeps (D-142)
                    && w.fauna
                        .spawn_site(&w.flora.p, &w.state, self.player, s, at)
                        .is_ok() // it can land there now (habitat, food or prey)
            })
            .max_by_key(|&s| (fa.group_size(s) <= 4, score(s), s))
    }

    /// Cards of species `s` the bot has on the map: animals over the card size; a swarm counts as
    /// one card while it lives (it breeds on its own; D-142).
    fn cards(&self, v: &View, s: usize) -> i64 {
        let (fa, a) = (&v.w.fauna.p, &v.w.fauna.agents);
        let mine = (0..a.len())
            .filter(|&i| a.owner[i] == self.player && usize::from(a.sp[i]) == s)
            .count();
        let mine = i64::try_from(mine).unwrap_or(i64::MAX);
        if fa.group_size(s) > 4 {
            mine.min(1)
        } else {
            mine / fa.group_size(s).max(1)
        }
    }

    /// A score shared out over the cards already on the map (D-192): the herd diversifies
    /// instead of piling into one species.
    fn varied(&self, v: &View, s: usize, score: i64) -> i64 {
        score * 8 / (2 + self.cards(v, s))
    }

    fn spawn(&self, v: &View, s: usize, at: (usize, usize)) -> Payload {
        Payload::Spawn {
            species: v.w.fauna.p.names[s].clone(),
            row: u32::try_from(at.0).unwrap_or(0),
            col: u32::try_from(at.1).unwrap_or(0),
        }
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

    /// A scenario (D-191): a flat map, P1 home at (8, 8), the bot (P2) at (29, 29), both rich.
    /// P1 unlocks `cards` (in order), then calls `calls` at tick 1: (species, row, col). The bot
    /// plays at `level` for `secs`; returns the world and every command it sent.
    fn scenario(
        level: Level,
        setup: &dyn Fn(&mut World),
        cards: &[&str],
        calls: &[(&str, u32, u32)],
        secs: u64,
    ) -> (World, Vec<Payload>) {
        let b = balance();
        let mut w = World::new(&b, 1, 38);
        w.setup_plant(1, "grasses", 8, 8, 5);
        w.setup_plant(2, "grasses", 29, 29, 5);
        w.economy.bank = [1_000_000 << 16; 2];
        setup(&mut w);
        let mut seq = [0u32; 2];
        let mut send = |w: &mut World, player: u8, payload: Payload| {
            let s = &mut seq[usize::from(player - 1)];
            w.submit(Command {
                tick: w.tick,
                player,
                seq: *s,
                payload,
            });
            *s += 1;
        };
        for c in cards {
            send(
                &mut w,
                1,
                Payload::Unlock {
                    species: (*c).into(),
                },
            );
        }
        w.step();
        for &(c, row, col) in calls {
            send(
                &mut w,
                1,
                Payload::Spawn {
                    species: c.into(),
                    row,
                    col,
                },
            );
        }
        let mut bot = Bot::new(2, level, b.flora.plant_radius);
        let mut sent = Vec::new();
        for _ in 0..secs * 10 {
            for payload in bot.think(&w) {
                sent.push(payload.clone());
                send(&mut w, 2, payload);
            }
            w.step();
        }
        (w, sent)
    }

    fn unlocks(sent: &[Payload]) -> Vec<&str> {
        sent.iter()
            .filter_map(|p| match p {
                Payload::Unlock { species } => Some(species.as_str()),
                _ => None,
            })
            .collect()
    }

    fn spawned(sent: &[Payload], name: &str) -> bool {
        sent.iter()
            .any(|p| matches!(p, Payload::Spawn { species, .. } if species == name))
    }

    /// D-191: grasshoppers raid the bot's meadow; it unlocks the great tit and drops it on them.
    #[test]
    fn a_grasshopper_raid_brings_great_tits() {
        let (_, sent) = scenario(
            Level::Normal,
            &|_| {},
            &["grasses", "grasshoppers"],
            &[("grasshoppers", 29, 29)],
            90,
        );
        assert!(
            unlocks(&sent).contains(&"great_tit"),
            "{:?}",
            unlocks(&sent)
        );
        assert!(spawned(&sent, "great_tit"), "the tit answers the raid");
    }

    /// D-191: a rabbit raid brings their primary eater, the fox, by way of the weasel.
    #[test]
    fn a_rabbit_raid_brings_the_fox_line() {
        let (_, sent) = scenario(
            Level::Normal,
            &|_| {},
            &["grasses", "grasshoppers", "rabbits"],
            &[("rabbits", 29, 29), ("rabbits", 28, 28)],
            120,
        );
        let u = unlocks(&sent);
        assert!(u.contains(&"weasel") && u.contains(&"fox"), "{u:?}");
        assert!(spawned(&sent, "fox") || spawned(&sent, "weasel"));
    }

    /// D-191: hard answers what it sees before it attacks (grasshoppers on the enemy's own land):
    /// it takes the great tit ahead of its plan; easy keeps to its plan.
    #[test]
    fn hard_anticipates_and_easy_does_not() {
        let first = |level| {
            let (_, sent) = scenario(
                level,
                &|_| {},
                &["grasses", "grasshoppers"],
                &[("grasshoppers", 8, 8)],
                40,
            );
            unlocks(&sent)
                .iter()
                .map(|s| (*s).to_string())
                .collect::<Vec<_>>()
        };
        // The first decision comes before the enemy's grasshoppers: compare with the plan's next card.
        let before = |u: &[String]| {
            let at = |n: &str| u.iter().position(|x| x == n).unwrap_or(usize::MAX);
            at("great_tit") < at("wildflowers")
        };
        assert!(
            before(&first(Level::Hard)),
            "hard takes the tit ahead of its plan"
        );
        assert!(!before(&first(Level::Easy)), "easy keeps to its plan");
    }

    /// D-191: against an enemy weasel stalking its rabbits, the bot calls the hunter that eats
    /// weasels first (the wildcat), not the higher-tier pine marten that eats them last.
    #[test]
    fn the_best_ranked_hunter_answers_a_stalker() {
        let ready = |w: &mut World| {
            w.setup_plant(2, "elder", 29, 29, 3);
            w.setup_plant(2, "ferns", 30, 30, 3);
            for name in [
                "grasses",
                "ferns",
                "elder",
                "grasshoppers",
                "rabbits",
                "weasel",
                "fox",
                "pine_marten",
                "hawk",
                "wildcat",
            ] {
                let i =
                    w.flora.p.index(name).unwrap_or_else(|| {
                        w.economy.animal(w.fauna.p.index(name).expect("a species"))
                    });
                w.economy
                    .unlock(2, i)
                    .unwrap_or_else(|e| panic!("{name}: {e}"));
            }
            w.submit(Command {
                tick: 0,
                player: 2,
                seq: 1000,
                payload: Payload::Spawn {
                    species: "rabbits".into(),
                    row: 29,
                    col: 29,
                },
            });
        };
        let (_, sent) = scenario(
            Level::Normal,
            &ready,
            &["grasses", "weasel"],
            &[("weasel", 29, 29)],
            60,
        );
        assert!(spawned(&sent, "wildcat"), "the wildcat eats weasels first");
        assert!(
            !spawned(&sent, "pine_marten"),
            "not the marten (weasels last)"
        );
    }

    /// D-192: on a map with water, the bot unlocks water plants and grows them in the shallows.
    #[test]
    fn on_a_water_map_the_bot_takes_the_shallows() {
        let b = balance();
        let n = usize::try_from(b.sim.grid_size).unwrap();
        let tp = sim_core::terrain::TerrainParams::from_balance(&b);
        let seed = (1..40)
            .find(|&s| {
                let mut w = World::new(&b, s, n);
                w.generate_terrain(&tp, s);
                w.state.ground.iter().filter(|&&g| g == SHALLOW).count() > n
            })
            .expect("a map with shallows");
        let mut w = World::new(&b, seed, n);
        w.generate_terrain(&tp, seed);
        let home = sim_core::terrain::homes(n)[1];
        let (r, c) = (
            u32::try_from(home / n).unwrap(),
            u32::try_from(home % n).unwrap(),
        );
        w.setup_plant(2, "lichen_and_moss", r, c, 3);
        w.economy.bank[1] = 1_000_000 << 16;
        let mut bot = Bot::new(2, Level::Hard, b.flora.plant_radius);
        for seq in 0..10 * 60 * 10 {
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
        let algae = w.flora.p.index("algae_and_lilies").unwrap();
        assert!(
            w.economy.is_unlocked(2, algae),
            "algae unlocked on a water map"
        );
        let n2 = n * n;
        let wet = (0..n2).any(|k| {
            w.state.ground[k] == SHALLOW && w.state.owner[k] == 2 && w.state.bio[algae * n2 + k] > 0
        });
        assert!(wet, "the bot holds shallows with algae");
    }

    /// D-194: the bot founds in varied places from map to map, always on its own half.
    #[test]
    fn the_bot_founds_in_varied_places_on_its_half() {
        let b = balance();
        let n = usize::try_from(b.sim.grid_size).unwrap();
        let tp = sim_core::terrain::TerrainParams::from_balance(&b);
        let mut sites = std::collections::BTreeSet::new();
        for seed in 1..=10 {
            let mut w = World::new(&b, seed, n);
            w.generate_terrain(&tp, seed);
            let mut bot = Bot::new(2, Level::Hard, b.flora.plant_radius);
            let at = (0..400).find_map(|_| {
                let first = bot.think(&w).into_iter().find_map(|p| match p {
                    Payload::Plant { row, col, .. } => Some((row as usize, col as usize)),
                    _ => None,
                });
                w.step();
                first
            });
            let (r, c) = at.expect("the bot founds");
            assert!(r + c > n - 1, "seed {seed}: ({r}, {c}) is on its half");
            sites.insert((r, c));
        }
        assert!(sites.len() >= 5, "varied sites: {sites:?}");
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
