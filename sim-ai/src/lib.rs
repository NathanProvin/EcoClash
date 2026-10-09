//! Scripted bot (INSTRUCTIONS §6, ROADMAP M4; D-014, D-060). The bot is just another player: it
//! reads the world and returns commands, which the host submits through the same queue as a
//! human's. It never mutates the world, so matches against it replay and verify like any other.
//!
//! Difficulty is reaction time, anticipation, actions per decision and adaptation (INSTRUCTIONS
//! §6). A style (D-228) shares the spending between land (spreading), depth (species per cell)
//! and army (grazers for raids). Each decision reads the map (`Intel`: enemy animals on its land
//! and near its herds, the enemy's plants, water; the front: strength, push and margin per cell,
//! D-225), answers threats first (hunters, the unlock toward their eater), then runs the plays of
//! the category furthest below its share: spread toward the enemy or around its bulges, add the
//! species a front cell lacks, raid the enemy cell one grazed-out species would flip (D-191,
//! D-192, D-228). Deterministic: no randomness, fixed orders.

use std::cmp::Reverse;

use sim_core::balance::{Act, Balance};
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

    /// Adaptation (D-228): seconds between two reads of the enemy's play, and how far (points of
    /// spending share) the bot shifts toward the counter; easy keeps its style.
    fn adaptation(self) -> Option<(u64, i64)> {
        match self {
            Level::Easy => None,
            Level::Normal => Some((120, 12)),
            Level::Hard => Some((60, 25)),
        }
    }

    /// This level's income factor (D-143), from `[bots] income`.
    #[must_use]
    pub fn income(self, b: &Balance) -> f64 {
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

/// A play style (D-228): how the bot shares its spending between land (spreading), depth
/// (species per cell, fertility) and army (grazers for raids); the weights are `[bots.styles]`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    Wide,
    Tall,
    Rush,
    Balanced,
}

impl Style {
    pub const ALL: [Style; 4] = [Style::Wide, Style::Tall, Style::Rush, Style::Balanced];

    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Style::Wide => "wide",
            Style::Tall => "tall",
            Style::Rush => "rush",
            Style::Balanced => "balanced",
        }
    }

    /// "wide", "tall", "rush" or "balanced".
    #[must_use]
    pub fn parse(name: &str) -> Option<Style> {
        Style::ALL.into_iter().find(|s| s.name() == name)
    }

    /// Spending weights in % (land, depth, army), from `[bots.styles]`.
    #[must_use]
    pub fn weights(self, b: &Balance) -> [i64; 3] {
        let s = &b.bots.styles;
        match self {
            Style::Wide => s.wide,
            Style::Tall => s.tall,
            Style::Rush => s.rush,
            Style::Balanced => s.balanced,
        }
        .map(i64::from)
    }
}

/// The enemy's play as the bot reads it from the map (D-228).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Posture {
    Wide,
    Tall,
    Rush,
}

/// Spending categories (D-228), indices into a style's weights.
const LAND: usize = 0;
const DEPTH: usize = 1;
const ARMY: usize = 2;

/// Points (Q16) every category is credited with, so a few commands do not swing the shares; and
/// the decisions over which recent spending fades (D-228).
const SPEND_PRIOR: i64 = 1000 << 16;
const SPEND_WINDOW: i64 = 64;

/// Reading the enemy (D-228): enemy grazers on own land that make a rush; mean species per enemy
/// cell (x100) and its ratio to the bot's own (%) that make it tall; enemy land against the bot's
/// (%) or its growth per minute (% of the map) that make it wide.
const RUSH_RAIDERS: i64 = 6;
const TALL_SPECIES: i64 = 300;
const TALL_RATIO: i64 = 130;
const WIDE_RATIO: i64 = 120;
const WIDE_GROWTH: i64 = 2;
/// How far beyond its land (cells past the plant radius) a land-heavy bot seeds new ground.
const CLAIM_REACH: usize = 3;
/// The least share (%) a category keeps when the bot shifts toward a counter.
const MIN_WEIGHT: i64 = 5;
/// Extra hunter cards the bot keeps against a rush (D-228).
const RUSH_GUARD: i64 = 2;
/// The army weight (%) at which the bot's raid pace and grazer cards are the level's own; and the
/// pace bounds (seconds).
const ARMY_REF: i64 = 33;
const PACE_S: (u64, u64) = (15, 300);

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
    pub style: Style,
    /// The style's weights, and the weights now (after adaptation), in % (land, depth, army).
    base: [i64; 3],
    pub weights: [i64; 3],
    /// Points spent per category (Q16, priced from the bot's own commands): over the match, and
    /// recently (fading by 1/SPEND_WINDOW per decision; the budgets use it).
    pub spent: [i64; 3],
    recent: [i64; 3],
    /// Whether the bot adapts to the enemy (its level allowing); off to measure a style alone.
    pub adapt: bool,
    /// The enemy's play as last read, and how many times the bot changed its weights.
    pub posture: Option<Posture>,
    pub shifts: u32,
    /// The tick of the next read, and the enemy's cells at the last one.
    read_next: u64,
    enemy_land: Option<i64>,
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
    /// The front (D-225): each cell's strength for its owner (Q16); on own cells the enemy's push
    /// over it (`Flora::push`); on enemy cells the margin, the bot's push less the cell's strength.
    strength: Vec<i64>,
    push: Vec<i64>,
    margin: Vec<i64>,
    /// The bank above the savings, worked out once per decision (D-207): the bank cannot change
    /// within one (commands apply at the next tick).
    spare: i64,
}

impl Bot {
    #[must_use]
    pub fn new(player: u8, level: Level, style: Style, b: &Balance) -> Bot {
        let base = style.weights(b);
        Bot {
            player,
            level,
            style,
            base,
            weights: base,
            spent: [0; 3],
            recent: [0; 3],
            adapt: true,
            posture: None,
            shifts: 0,
            read_next: 0,
            enemy_land: None,
            radius: b.flora.plant_radius,
            next: 0,
            turn: 0,
            since: Vec::new(),
        }
    }

    /// Decisions taken so far.
    #[must_use]
    pub fn decisions(&self) -> usize {
        self.turn
    }

    /// Commands for this tick (usually none: the bot decides every `period` ticks). Call it once
    /// per tick, before the world steps, and submit the result for the current tick.
    pub fn think(&mut self, w: &World) -> Vec<Payload> {
        if w.tick < self.next || w.result.is_some() {
            return Vec::new();
        }
        self.next = w.tick + self.level.period();
        self.turn += 1;
        let view = self.view(w);
        if centroid(w, self.player).is_none() {
            if w.tick < self.level.found_after() {
                return Vec::new(); // looking the map over first (D-101)
            }
            let p = self.found(&view);
            if let Some(p) = &p {
                self.book(&view, p);
            }
            return p.into_iter().collect(); // no land yet: found the colony
        }
        self.adapt_to(&view);
        // Threats first (D-191), outside the budgets; then the categories at or below their
        // share, furthest below first (D-228). A category over its share waits: the bot saves
        // for the others rather than spend its money elsewhere.
        let reactive: [Play; 3] = [Bot::catastrophe, Bot::defend, Bot::unlock];
        let budgets: [&[Play]; 3] = [
            &[Bot::expand],
            &[Bot::deepen, Bot::decomposers],
            &[Bot::herbivores, Bot::drop_raiders, Bot::raid],
        ];
        let active = [LAND, DEPTH, ARMY].map(|c| self.active(&view, c));
        let mut order: Vec<usize> = (0..3)
            .filter(|&c| active[c] && self.deficit(c, active) >= -self.slack(active))
            .collect();
        order.sort_by_key(|&c| (Reverse(self.deficit(c, active)), c));
        let mut out = Vec::new();
        let actions = self.level.actions();
        for play in reactive {
            if out.len() < actions
                && let Some(p) = play(self, &view)
            {
                self.book(&view, &p);
                out.push(p);
            }
        }
        for &c in &order {
            for play in budgets[c] {
                if out.len() < actions
                    && let Some(p) = play(self, &view)
                {
                    self.book(&view, &p);
                    out.push(p);
                }
            }
        }
        // Recent spending fades (D-228): a category that could not spend for a while does not
        // binge to catch up.
        self.recent = self.recent.map(|x| x - x / SPEND_WINDOW);
        out
    }

    /// Whether category `c` has anything to spend on now (D-228): land a spreader and a free
    /// border cell; depth a plant beyond the spreaders or a recycler; army a grazer. A category
    /// with nothing to do drops out of the shares instead of starving the others.
    fn active(&self, v: &View, c: usize) -> bool {
        let w = v.w;
        let unlocked = |i: usize| w.economy.is_unlocked(self.player, i);
        let cards = w.flora.p.species() + w.fauna.p.names.len();
        match c {
            LAND => {
                let n = v.n;
                (0..cards).any(|i| unlocked(i) && category(w, i) == Some(LAND))
                    && (0..n * n).any(|k| {
                        w.state.owner[k] == 0
                            && !(w.state.lock[k] > 0 && w.state.lock_p[k] == self.player)
                            && neighbours(k, n).any(|m| w.state.owner[m] == self.player)
                    })
            }
            _ => (0..cards).any(|i| unlocked(i) && category(w, i) == Some(c)),
        }
    }

    /// What the bot reads from the world for one decision (D-191, D-225).
    fn view<'a>(&mut self, w: &'a World) -> View<'a> {
        let n = w.state.n;
        let intel = self.intel(w);
        let threats = self.threats(w, &intel);
        let (strength, push, margin) = front(w, self.player);
        let mut view = View {
            w,
            n,
            home: centroid(w, self.player).unwrap_or((n / 2, n / 2)),
            enemy: centroid(w, 3 - self.player).unwrap_or((n / 2, n / 2)),
            intel,
            threats,
            spare: 0,
            strength,
            push,
            margin,
        };
        view.spare = self.savings(&view);
        view
    }

    /// Points category `c` is short of its share of recent spending (Q16; below 0: over), the
    /// shares taken over the `active` categories only.
    fn deficit(&self, c: usize, active: [bool; 3]) -> i64 {
        let (mut total, mut weight) = (0, 0);
        for k in (0..3).filter(|&k| active[k]) {
            total += self.recent[k] + SPEND_PRIOR;
            weight += self.weights[k];
        }
        total / weight.max(1) * self.weights[c] - (self.recent[c] + SPEND_PRIOR)
    }

    /// How far over its share a category may go and still spend: a twentieth of recent
    /// spending, so the shares do not jitter.
    fn slack(&self, active: [bool; 3]) -> i64 {
        (0..3)
            .filter(|&k| active[k])
            .map(|k| self.recent[k] + SPEND_PRIOR)
            .sum::<i64>()
            / 20
    }

    /// Book what a command costs to its category (D-228): plants by kind (spreaders are land,
    /// the rest depth), grazers army, recyclers depth, unlocks by the card's kind. Hunters and
    /// catastrophes answer threats: outside the budgets.
    fn book(&mut self, v: &View, p: &Payload) {
        let w = v.w;
        let n = v.n;
        let (cat, cost) = match p {
            Payload::Plant { species, .. } => {
                let Some(i) = Bot::sheet(w, species) else {
                    return;
                };
                let cat = category(w, i);
                (cat, w.economy.unit_cost(i, false) * disc_cells(self.radius))
            }
            Payload::Spawn { species, row, col } => {
                let Some(s) = w.fauna.p.index(species) else {
                    return;
                };
                let i = w.economy.animal(s);
                let k = *row as usize * n + *col as usize;
                let away = w.state.owner.get(k) != Some(&self.player);
                (
                    category(w, i),
                    w.economy.unit_cost(i, away) * w.fauna.p.group_size(s),
                )
            }
            Payload::Unlock { species } => {
                let Some(i) = Bot::sheet(w, species) else {
                    return;
                };
                (category(w, i), w.economy.unlock_price(i))
            }
            _ => return,
        };
        if let Some(c) = cat {
            self.spent[c] += cost;
            self.recent[c] += cost;
        }
    }

    /// Adaptation (D-228): at the level's pace, read the enemy's play from the map and shift the
    /// weights toward its counter (against tall, army; against rush, land and more hunters;
    /// against wide, depth and encircling), at most the level's shift away from the style.
    fn adapt_to(&mut self, v: &View) {
        let Some((every, shift)) = self.level.adaptation() else {
            return;
        };
        if !self.adapt || v.w.tick < self.read_next {
            return;
        }
        self.read_next = v.w.tick + every * 10;
        let posture = self.read(v, every);
        let mut weights = self.base;
        if let Some(p) = posture {
            let to = match p {
                Posture::Tall => ARMY,
                Posture::Rush => LAND,
                Posture::Wide => DEPTH,
            };
            for c in (0..3).filter(|&c| c != to) {
                let take = (shift / 2).min(weights[c] - MIN_WEIGHT).max(0);
                weights[c] -= take;
                weights[to] += take;
            }
        }
        if weights != self.weights {
            self.shifts += 1;
        }
        self.weights = weights;
        self.posture = posture;
    }

    /// The enemy's play, from the map only (D-228): grazers on the bot's land (rush), more
    /// species per cell than the bot (tall), more land or fast-growing land (wide).
    fn read(&mut self, v: &View, every: u64) -> Option<Posture> {
        let (w, n2) = (v.w, v.n * v.n);
        let (mut mine, mut theirs, mut dm, mut de) = (0i64, 0i64, 0i64, 0i64);
        for k in 0..n2 {
            match w.state.owner[k] {
                o if o == self.player => {
                    mine += 1;
                    dm += w.flora.species_count(&w.state, k);
                }
                o if o == 3 - self.player => {
                    theirs += 1;
                    de += w.flora.species_count(&w.state, k);
                }
                _ => {}
            }
        }
        let cells = i64::try_from(n2).unwrap_or(i64::MAX);
        let minutes = i64::try_from(every).unwrap_or(60);
        let growth = self.enemy_land.map_or(0, |was| {
            (theirs - was) * 100 * 60 / (cells * minutes).max(1)
        });
        self.enemy_land = Some(theirs);
        if v.intel.raiders.iter().sum::<i64>() >= RUSH_RAIDERS {
            return Some(Posture::Rush);
        }
        if theirs == 0 || mine == 0 {
            return None;
        }
        let (de, dm) = (de * 100 / theirs, dm * 100 / mine);
        if de >= TALL_SPECIES && de * 100 >= dm * TALL_RATIO {
            return Some(Posture::Tall);
        }
        if theirs * 100 >= mine * WIDE_RATIO || growth >= WIDE_GROWTH {
            return Some(Posture::Wide);
        }
        None
    }

    /// A pace of `secs` at the level's own army weight, scaled by the bot's: more army, more
    /// often (D-228).
    fn paced(&self, secs: u64) -> u64 {
        let army = u64::try_from(self.weights[ARMY].max(1)).unwrap_or(1);
        (secs * ARMY_REF.unsigned_abs() / army).clamp(PACE_S.0, PACE_S.1)
    }

    /// One species' worth of strength in cell `k` (Q16): what its biodiversity factor loses
    /// with one species fewer (D-236; its layers kept full).
    fn one(v: &View, k: usize) -> i64 {
        let p = &v.w.flora.p;
        let d = |c: i64| (i64::from(ONE) + p.div * c).min(p.div_cap);
        let c = v.w.flora.species_count(&v.w.state, k);
        if c == 0 {
            return 0;
        }
        v.strength[k] - v.strength[k] * d(c - 1) / d(c)
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
        let active = [LAND, DEPTH, ARMY].map(|c| self.active(v, c));
        let army = match self.level.aggression().2 {
            Some(_) if active[ARMY] && self.deficit(ARMY, active) > 0 => {
                self.raider(v).map_or(0, |s| self.drop_cost(v, s))
            }
            _ => 0,
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

    /// The plan for this map: the backbone, with the water cards on maps with water (D-192),
    /// reordered by the weights (D-228): the cards of a heavier category come earlier.
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
        let w = v.w;
        let weight = |name: &str| {
            Bot::sheet(w, name)
                .and_then(|i| category(w, i))
                .map_or(ARMY_REF, |c| self.weights[c])
        };
        let mut keyed: Vec<(i64, &str)> = plan
            .into_iter()
            .enumerate()
            .map(|(i, name)| {
                (
                    i64::try_from(i).unwrap_or(0) * 100 / (weight(name) + 20),
                    name,
                )
            })
            .collect();
        keyed.sort_by_key(|&(key, _)| key); // stable: ties keep the backbone's order
        keyed.into_iter().map(|(_, name)| name).collect()
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

    /// Spread (D-192, D-228). A land-heavy bot claims: it seeds the free spot within CLAIM_REACH
    /// cells of its land whose plant disc covers the most free cells, clear of the enemy (any
    /// free cell may be planted, D-095), and so outruns the natural spread. Otherwise, or with
    /// nothing left to claim, the free cell next to own land nearest the enemy; facing a wide
    /// enemy, the one touching the most enemy cells first (encircling, where its neighbours'
    /// strengths add up). Each spot takes the first unlocked, affordable spreader it suits (grass
    /// on land, algae in the shallows). Cells it is locked out of are skipped (D-098).
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
        let barred = |k: usize| w.state.lock[k] > 0 && w.state.lock_p[k] == self.player;
        let suited = |k: usize| {
            spreaders
                .iter()
                .find(|&&(_, s)| w.flora.suitability(&w.state, s, k) >= i64::from(ONE) / 2)
        };
        if self.weights[LAND] >= 40 {
            let r = usize::try_from(self.radius).unwrap_or(2);
            let near_own = dilate(w, n, self.player, r + CLAIM_REACH);
            let near_enemy = dilate(w, n, 3 - self.player, r + 1);
            let free = |k: usize| w.state.owner[k] == 0 && !barred(k);
            let best = (0..n * n)
                .filter(|&k| free(k) && near_own[k] && !near_enemy[k] && suited(k).is_some())
                .map(|k| {
                    let covered = disc(k, n, r).filter(|&m| free(m)).count();
                    (covered, Reverse(dist2(k, n, v.home)), Reverse(k))
                })
                .max();
            if let Some((covered, _, Reverse(k))) = best
                && covered > disc_cells(self.radius).unsigned_abs() as usize / 2
                && let Some(&(name, _)) = suited(k)
            {
                return Some(self.plant(name, k, n));
            }
        }
        let mut border: Vec<usize> = (0..n * n)
            .filter(|&k| w.state.owner[k] == 0 && !barred(k) && neighbours(k, n).any(own))
            .collect();
        let encircle = self.posture == Some(Posture::Wide);
        let enemies = |k: usize| {
            neighbours(k, n)
                .filter(|&m| w.state.owner[m] == 3 - self.player)
                .count()
        };
        if encircle {
            border.sort_by_key(|&k| (Reverse(enemies(k)), dist2(k, n, v.enemy), k));
        } else {
            border.sort_by_key(|&k| (dist2(k, n, v.enemy), k));
        }
        border.into_iter().find_map(|k| {
            let (name, _) = spreaders
                .iter()
                .find(|&&(_, s)| w.flora.suitability(&w.state, s, k) >= i64::from(ONE) / 2)?;
            Some(self.plant(name, k, n))
        })
    }

    /// Depth (D-225, D-228): a plant the cell lacks, on own land, where a species counts most:
    /// first the cells the enemy pushes (defence, the strongest push first), then cells next to
    /// an enemy cell one species short of falling (offence; not easy), then home, for the
    /// biodiversity income. At the front the cheapest fitting plant (strength counts species, not
    /// height); at home the tallest or the fastest grower, in turn. Recyclers, called on their own pace,
    /// raise the soil's fertility.
    fn deepen(&self, v: &View) -> Option<Payload> {
        let (w, n, n2) = (v.w, v.n, v.n * v.n);
        let p = &w.flora.p;
        let half = i64::from(ONE) / 2;
        let plants: Vec<usize> = (0..p.species())
            .filter(|&s| {
                w.economy.is_unlocked(self.player, s)
                    && self.can_pay(v, s, disc_cells(self.radius) / 2)
            })
            .collect();
        if plants.is_empty() {
            return None;
        }
        let offence = |k: usize| {
            self.level != Level::Easy
                && neighbours(k, n).any(|e| {
                    w.state.owner[e] == 3 - self.player
                        && v.margin[e] <= 0
                        && v.margin[e] + Bot::one(v, e) > 0
                })
        };
        let mut cells: Vec<(u8, i64, usize, usize)> = (0..n2)
            .filter(|&k| w.state.owner[k] == self.player)
            .map(|k| {
                if v.push[k] > 0 {
                    (0, -v.push[k], dist2(k, n, v.enemy), k)
                } else if offence(k) {
                    (1, 0, dist2(k, n, v.enemy), k)
                } else {
                    (2, 0, dist2(k, n, v.home), k)
                }
            })
            .collect();
        cells.sort_unstable();
        let price = |s: usize| w.economy.unit_cost(s, false);
        for (tier, _, _, k) in cells {
            let fit = plants.iter().copied().filter(|&s| {
                w.state.bio[s * n2 + k] == 0
                    && !w.flora.tree_barred(&w.state, s, k, self.player)
                    && w.flora.suitability(&w.state, s, k) >= half
            });
            // At home, every other decision the tallest plant (biomass, income), else the fastest
            // grower (it counts in the strength soonest; D-225).
            let s = if tier < 2 {
                fit.min_by_key(|&s| (price(s), s))
            } else if self.turn.is_multiple_of(2) {
                fit.max_by_key(|&s| (p.level[s], Reverse(s)))
            } else {
                fit.max_by_key(|&s| (p.rdt[s], Reverse(s)))
            };
            if let Some(s) = s {
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
        let cards = (self.level.aggression().3 * self.weights[ARMY] / ARMY_REF).clamp(2, 16);
        let s = self.pick(v, Role::Herbivore, cards, food, at)?;
        Some(self.spawn(v, s, at))
    }

    /// A raid by drop (×1.5, D-061): the raid grazer (`raider`, D-192), dropped on the enemy cell
    /// with its food nearest the breach (D-228). Normal and hard, at their drop pace (D-148,
    /// scaled by the army weight), once the raid fund that `spare` keeps holds the drop's price.
    fn drop_raiders(&self, v: &View) -> Option<Payload> {
        let every = self.paced(self.level.aggression().2?);
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
        let aim = self.breach(v).map_or(v.home, |b| (b / n, b % n));
        let k = (0..n2)
            .filter(|&k| food(k))
            .min_by_key(|&k| (dist2(k, n, aim), k))?;
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
            let guard = if self.posture == Some(Posture::Rush) {
                RUSH_GUARD
            } else {
                0
            };
            if let Some(h) = self.pick(
                v,
                Role::Predator,
                DEFEND_CARDS + guard,
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

    /// At the level's raid pace (scaled by the army weight, D-228), with a large enough herd of
    /// units (D-148): own herbivores attack-move to the breach.
    fn raid(&self, v: &View) -> Option<Payload> {
        let (every, herd, ..) = self.level.aggression();
        if !self.every(v, self.paced(every)) {
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
        let target = self.breach(v)?;
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

    /// The raid target (D-225, D-228): an enemy cell next to own land that one species grazed out
    /// would flip (margin <= 0 < margin + one species); an army-heavy bot takes the strongest such
    /// stack (concentrated value), the others the one closest to falling. Else the enemy cell next
    /// to own land closest to falling; else the enemy land nearest home.
    fn breach(&self, v: &View) -> Option<usize> {
        let (w, n) = (v.w, v.n);
        let enemy = |k: usize| w.state.owner[k] == 3 - self.player;
        let front: Vec<usize> = (0..n * n)
            .filter(|&k| enemy(k) && neighbours(k, n).any(|m| w.state.owner[m] == self.player))
            .collect();
        let rush = self.weights[ARMY] >= 50;
        let tips = front
            .iter()
            .copied()
            .filter(|&e| v.margin[e] <= 0 && v.margin[e] + Bot::one(v, e) > 0);
        let best = if rush {
            tips.max_by_key(|&e| (v.strength[e], Reverse(e)))
        } else {
            tips.max_by_key(|&e| (v.margin[e], Reverse(e)))
        };
        best.or_else(|| {
            front
                .iter()
                .copied()
                .max_by_key(|&e| (v.margin[e], Reverse(e)))
        })
        .or_else(|| {
            (0..n * n)
                .filter(|&k| enemy(k))
                .min_by_key(|&k| (dist2(k, n, v.home), k))
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

/// The budget a card's commands come out of (D-228): spreaders land, other plants and recyclers
/// depth, grazers army; hunters none (they answer threats).
fn category(w: &World, i: usize) -> Option<usize> {
    let plants = w.flora.p.species();
    if i < plants {
        return Some(if SPREADERS.contains(&w.flora.p.names[i].as_str()) {
            LAND
        } else {
            DEPTH
        });
    }
    match w.fauna.p.role[i - plants] {
        Role::Herbivore => Some(ARMY),
        Role::Decomposer => Some(DEPTH),
        Role::Predator => None,
    }
}

/// The front for `me` (D-225): strength per cell; the enemy's push over own cells; on enemy
/// cells, the margin (the summed strength of `me`'s neighbouring cells less the cell's own).
fn front(w: &World, me: u8) -> (Vec<i64>, Vec<i64>, Vec<i64>) {
    let n = w.state.n;
    let n2 = n * n;
    let (strength, push): (Vec<i64>, Vec<i64>) = w
        .flora
        .fronts(&w.state)
        .into_iter()
        .map(|[s, p]| (s, (p - s).max(0)))
        .unzip();
    let margin = (0..n2)
        .map(|k| {
            if w.state.owner[k] == 3 - me {
                neighbours(k, n)
                    .filter(|&m| w.state.owner[m] == me)
                    .map(|m| strength[m])
                    .sum::<i64>()
                    - strength[k]
            } else {
                0
            }
        })
        .collect();
    (strength, push, margin)
}

/// The cells within `r` (Euclidean) of cell `k` on an `n x n` map.
fn disc(k: usize, n: usize, r: usize) -> impl Iterator<Item = usize> {
    let (row, col) = (k / n, k % n);
    (row.saturating_sub(r)..(row + r + 1).min(n)).flat_map(move |y| {
        (col.saturating_sub(r)..(col + r + 1).min(n))
            .filter(move |&x| y.abs_diff(row).pow(2) + x.abs_diff(col).pow(2) <= r * r)
            .map(move |x| y * n + x)
    })
}

/// Cells within `r` (Chebyshev) of `player`'s land.
fn dilate(w: &World, n: usize, player: u8, r: usize) -> Vec<bool> {
    let mut near = vec![false; n * n];
    for k in (0..n * n).filter(|&k| w.state.owner[k] == player) {
        let (row, col) = (k / n, k % n);
        for y in row.saturating_sub(r)..(row + r + 1).min(n) {
            for x in col.saturating_sub(r)..(col + r + 1).min(n) {
                near[y * n + x] = true;
            }
        }
    }
    near
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
        let mut bots = [Bot::new(2, Level::Normal, Style::Balanced, &b)];
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
        let mut bot = Bot::new(2, Level::Easy, Style::Balanced, &b);
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
        let mut bot = Bot::new(2, Level::Hard, Style::Balanced, &b);
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
        let mut a = [
            Bot::new(1, Level::Hard, Style::Balanced, &b),
            Bot::new(2, Level::Easy, Style::Balanced, &b),
        ];
        let mut c = [
            Bot::new(1, Level::Hard, Style::Balanced, &b),
            Bot::new(2, Level::Easy, Style::Balanced, &b),
        ];
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
        // A minute for the planted grass to establish (D-225: raiders land on food).
        for _ in 0..600 {
            w.step();
        }
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
        let mut bot = Bot::new(2, level, Style::Balanced, &b);
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
                tick: 590, // once the grass is established (D-225)
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
        let mut bot = Bot::new(2, Level::Hard, Style::Balanced, &b);
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
            let mut bot = Bot::new(2, Level::Hard, Style::Balanced, &b);
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
    /// A 38 x 38 sandbox world on developed soil (everything unlocked and free, D-058): `owner`
    /// gives each cell's owner (0: neutral), `plants` its species at full cover.
    fn painted(
        b: &Balance,
        owner: &dyn Fn(usize, usize) -> u8,
        plants: &dyn Fn(usize, usize) -> Vec<&'static str>,
    ) -> World {
        let n = 38;
        let mut w = World::new(b, 1, n);
        w.economy.sandbox = true;
        w.state.soil.fill(sim_core::flora::U16);
        let n2 = n * n;
        for k in 0..n2 {
            let (r, c) = (k / n, k % n);
            w.state.owner[k] = owner(r, c);
            if w.state.owner[k] == 0 {
                continue;
            }
            for name in plants(r, c) {
                let s = w.flora.p.index(name).unwrap();
                w.state.bio[s * n2 + k] = w.flora.p.kmax[s];
                w.state.gauge[s * n2 + k] = i64::from(ONE);
            }
        }
        w
    }

    /// D-225, D-228: the bot adds a species first where the enemy pushes it, not at home.
    #[test]
    fn deepen_defends_a_pushed_front_cell_first() {
        let b = balance();
        // The bot (P2) holds rows 19 and down in grass only; P1 above in grass and lichen: every
        // bot cell of row 19 is pushed (2 species against 1).
        let w = painted(&b, &|r, _| if r >= 19 { 2 } else { 1 }, &|r, _| {
            if r >= 19 {
                vec!["grasses"]
            } else {
                vec!["grasses", "lichen_and_moss"]
            }
        });
        let mut bot = Bot::new(2, Level::Normal, Style::Tall, &b);
        let v = bot.view(&w);
        assert!(v.push[19 * 38 + 5] > 0, "the front row is pushed");
        match bot.deepen(&v) {
            Some(Payload::Plant { row, .. }) => assert_eq!(row, 19, "on the pushed row"),
            other => panic!("expected a plant, got {other:?}"),
        }
    }

    /// D-225, D-228: the raid goes where grazing one species out flips the cell.
    #[test]
    fn raids_aim_at_the_breach() {
        let b = balance();
        // P1 (rows up to 18) holds three species per cell, but cell (18, 25) only two; the bot
        // (rows 19 and down) two. Only (18, 25) falls if one species is grazed out.
        let w = painted(&b, &|r, _| if r >= 19 { 2 } else { 1 }, &|r, c| {
            if r >= 19 || (r, c) == (18, 25) {
                vec!["grasses", "lichen_and_moss"]
            } else {
                vec!["grasses", "lichen_and_moss", "wildflowers"]
            }
        });
        for style in [Style::Balanced, Style::Rush] {
            let mut bot = Bot::new(2, Level::Normal, style, &b);
            let v = bot.view(&w);
            assert_eq!(bot.breach(&v), Some(18 * 38 + 25), "{style:?}");
        }
    }

    /// D-228: a land-heavy bot claims open ground: its plant disc lands on free cells, clear of
    /// the enemy. A bot facing a wide enemy encircles: free cells touching the most enemy cells
    /// first. Otherwise it spreads toward the enemy's centre.
    #[test]
    fn wide_claims_and_a_bot_facing_wide_encircles() {
        let b = balance();
        // The bot holds rows 20 and down. P1 has a small bulge at (19, 10), (18, 9), (18, 11),
        // and its main land in the top right corner.
        let p1 = |r: usize, c: usize| {
            [(19, 10), (18, 9), (18, 11)].contains(&(r, c)) || (r < 6 && c > 30)
        };
        let w = painted(
            &b,
            &|r, c| {
                if r >= 20 {
                    2
                } else if p1(r, c) {
                    1
                } else {
                    0
                }
            },
            &|_, _| vec!["grasses"],
        );
        let enemies = |row: u32, col: u32| {
            let k = row as usize * 38 + col as usize;
            neighbours(k, 38).filter(|&m| w.state.owner[m] == 1).count()
        };
        let planted = |bot: &mut Bot| {
            let v = bot.view(&w);
            match bot.expand(&v) {
                Some(Payload::Plant { row, col, .. }) => (row, col),
                other => panic!("expected a plant, got {other:?}"),
            }
        };
        let (row, col) = planted(&mut Bot::new(2, Level::Normal, Style::Wide, &b));
        let k = row as usize * 38 + col as usize;
        assert_eq!(w.state.owner[k], 0, "a free cell");
        assert!(row < 20, "beyond its land: ({row}, {col})");
        let r = usize::try_from(b.flora.plant_radius).unwrap();
        assert!(
            disc(k, 38, r + 1).all(|m| w.state.owner[m] != 1),
            "clear of the enemy: ({row}, {col})"
        );
        let mut facing = Bot::new(2, Level::Normal, Style::Balanced, &b);
        facing.posture = Some(Posture::Wide);
        let (row, col) = planted(&mut facing);
        assert_eq!(enemies(row, col), 2, "encircles at ({row}, {col})");
        let (row, col) = planted(&mut Bot::new(2, Level::Normal, Style::Tall, &b));
        assert!(
            enemies(row, col) < 2,
            "tall heads for the centre: ({row}, {col})"
        );
    }

    /// D-228: facing a tall enemy, hard shifts its full step toward army, normal half, easy none;
    /// a style keeps at least MIN_WEIGHT in every category.
    #[test]
    fn adaptation_shifts_toward_the_counter_by_level() {
        let b = balance();
        let tall = [
            "grasses",
            "lichen_and_moss",
            "wildflowers",
            "ferns",
            "nettle",
        ];
        let w = painted(&b, &|r, _| if r >= 19 { 2 } else { 1 }, &|r, _| {
            if r >= 19 {
                vec!["grasses"]
            } else {
                tall.to_vec()
            }
        });
        for (level, gain) in [(Level::Easy, 0), (Level::Normal, 12), (Level::Hard, 24)] {
            let mut bot = Bot::new(2, level, Style::Balanced, &b);
            let base = bot.weights;
            let v = bot.view(&w);
            bot.adapt_to(&v);
            assert_eq!(bot.weights[ARMY] - base[ARMY], gain, "{level:?}");
            assert_eq!(bot.weights.iter().sum::<i64>(), 100);
            if gain > 0 {
                assert_eq!(bot.posture, Some(Posture::Tall));
            }
        }
        let mut rush = Bot::new(2, Level::Hard, Style::Rush, &b);
        let v = rush.view(&w);
        rush.adapt_to(&v);
        assert!(
            rush.weights.iter().all(|&x| x >= MIN_WEIGHT),
            "{:?}",
            rush.weights
        );
    }

    /// D-228: over a match each style puts a larger share of its spending on its own category
    /// than the other styles do, and the tall style stacks more species per cell than the wide.
    #[test]
    fn each_style_leans_on_its_own_category() {
        let b = balance();
        let styles = [Style::Wide, Style::Tall, Style::Rush];
        let mut share = Vec::new();
        let mut depth = Vec::new();
        for style in styles {
            let mut bots = [
                Bot::new(1, Level::Normal, Style::Balanced, &b),
                Bot::new(2, Level::Normal, style, &b),
            ];
            bots[1].adapt = false;
            let (w, _) = play(&mut bots, 8);
            let spent = bots[1].spent;
            let total: i64 = spent.iter().sum::<i64>().max(1);
            share.push(spent.map(|x| x * 100 / total));
            let own: Vec<usize> = (0..w.state.owner.len())
                .filter(|&k| w.state.owner[k] == 2)
                .collect();
            let species: i64 = own
                .iter()
                .map(|&k| w.flora.species_count(&w.state, k))
                .sum();
            depth.push(species * 100 / i64::try_from(own.len().max(1)).unwrap());
        }
        for (i, style) in styles.iter().enumerate() {
            for j in (0..3).filter(|&j| j != i) {
                assert!(
                    share[i][i] > share[j][i],
                    "{style:?} {:?} against {:?} {:?}",
                    share[i],
                    styles[j],
                    share[j]
                );
            }
        }
        assert!(
            depth[1] > depth[0],
            "tall {} vs wide {} species per cell (x100)",
            depth[1],
            depth[0]
        );
    }

    /// D-228: each style against an idle player, minute by minute: land, the spending split,
    /// species per own cell, bank. `cargo test -p sim-ai --release -- --ignored --nocapture
    /// style_report`.
    #[test]
    #[ignore = "report, run by hand in release"]
    fn style_report() {
        let b = balance();
        for style in Style::ALL {
            let mut bots = [Bot::new(2, Level::Normal, style, &b)];
            bots[0].adapt = false;
            let mut line = format!("{:<9}", style.name());
            let (mut w, _) = play(&mut bots, 0);
            for minute in 1..=10 {
                w = advance(w, &mut bots, 1);
                if minute % 2 == 0 {
                    let own: Vec<usize> = (0..w.state.owner.len())
                        .filter(|&k| w.state.owner[k] == 2)
                        .collect();
                    let depth: i64 = own
                        .iter()
                        .map(|&k| w.flora.species_count(&w.state, k))
                        .sum();
                    let t = w.territory();
                    let total = bots[0].spent.iter().sum::<i64>().max(1);
                    let split = bots[0].spent.map(|x| x * 100 / total);
                    line += &format!(
                        " | {minute}m {}v{} sp {:.1} {split:?} bank {}",
                        t[1],
                        t[0],
                        depth as f64 / own.len().max(1) as f64,
                        w.economy.bank[1] >> 16
                    );
                }
            }
            println!("{line}");
        }
    }

    /// Step `w` for `minutes` with `bots` playing.
    fn advance(mut w: World, bots: &mut [Bot], minutes: u64) -> World {
        let mut seq = [1u32 << 20; 2];
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
            w.step();
        }
        w
    }

    /// `cargo test -p sim-ai --release -- --ignored --nocapture bot_report`.
    #[test]
    #[ignore = "report, run by hand in release"]
    fn bot_report() {
        let b = balance();
        let mut bots = [
            Bot::new(1, Level::Normal, Style::Balanced, &b),
            Bot::new(2, Level::Hard, Style::Balanced, &b),
        ];
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
