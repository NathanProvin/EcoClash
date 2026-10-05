//! Weather (D-132): random events that hit the whole map, both players alike. One or two per
//! half hour: the first starts in `first_s`, the next `gap_s` after one ends. A weather alert
//! comes `warning_s` before each; the kind is drawn then, by weight. While it lasts:
//! - plant growth, animal speed and herbivore bites take the kind's factors;
//! - drought: tree stands die standing (D-127) and grass-only cells are laid bare, a share of
//!   them over the event;
//! - flood: land cells next to water turn into shallows (their plants that cannot stand full
//!   water drown to litter), and turn back to land when it ends.
//!
//! The weather has its own RNG stream, so matches before the first alert run exactly as without
//! weather (the flora parity and the command checks).

use crate::balance::Balance;
use crate::fixed::{ONE, div_round};
use crate::flora::{Flora, FloraState, U16, round};
use crate::hash::Hasher;
use crate::rng::Pcg32;
use crate::terrain::{LAND, SHALLOW, is_water};

const ONE_I: i64 = ONE as i64;
/// Stream of the weather's RNG (the seed comes from the match).
const RNG_STREAM: u64 = 0x00ea_7e5a;

/// One kind of weather, converted once (Q16 factors and chances, ticks).
#[derive(Clone, Debug)]
pub struct Kind {
    pub name: String,
    weight: u32,
    /// Ticks it lasts.
    pub duration: u64,
    pub growth: i64,
    pub speed: i64,
    pub bite: i64,
    /// Chance per flora tick that a tree stand dies, that a grass-only cell is laid bare.
    trees: i64,
    grass: i64,
    /// Chance that a land cell next to water floods; moisture response under which plants drown.
    flood: i64,
    drown_below: i64,
}

#[derive(Clone, Debug)]
pub struct WeatherParams {
    pub kinds: Vec<Kind>,
    /// Windows in ticks.
    first: (u64, u64),
    gap: (u64, u64),
    pub warning: u64,
}

impl WeatherParams {
    #[must_use]
    #[allow(clippy::float_arithmetic, clippy::cast_precision_loss)] // load-time conversion
    pub fn from_balance(b: &Balance) -> WeatherParams {
        let (one, hz) = (f64::from(ONE), f64::from(b.sim.tick_hz));
        let w = &b.weather;
        let ticks = |s: f64| u64::try_from(round(s * hz)).unwrap_or(0);
        let flora_ticks = |s: f64| (s * hz / f64::from(b.sim.flora_every_ticks)).max(1.0);
        WeatherParams {
            kinds: w
                .kinds
                .iter()
                .map(|k| {
                    let per_tick = |share: f64| round(share / flora_ticks(k.duration_s) * one);
                    Kind {
                        name: k.name.clone(),
                        weight: k.weight,
                        duration: ticks(k.duration_s).max(1),
                        growth: round(k.growth * one),
                        speed: round(k.speed * one),
                        bite: round(k.bite * one),
                        trees: per_tick(k.tree_death),
                        grass: per_tick(k.grass_loss),
                        flood: round(k.flood * one),
                        drown_below: round(k.drown_below * one),
                    }
                })
                .collect(),
            first: (ticks(w.first_s[0]), ticks(w.first_s[1])),
            gap: (ticks(w.gap_s[0]), ticks(w.gap_s[1])),
            warning: ticks(w.warning_s),
        }
    }

    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(self.first.0)
            .u64(self.first.1)
            .u64(self.gap.0)
            .u64(self.gap.1)
            .u64(self.warning)
            .u64(self.kinds.len() as u64);
        for k in &self.kinds {
            h.u64(k.name.len() as u64)
                .bytes(k.name.as_bytes())
                .u64(u64::from(k.weight))
                .u64(k.duration);
            h.i64s(&[
                k.growth,
                k.speed,
                k.bite,
                k.trees,
                k.grass,
                k.flood,
                k.drown_below,
            ]);
        }
    }
}

/// Where the weather stands at a tick.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    Calm,
    /// The alert is out: `kind` starts at `start`.
    Warning,
    /// `kind` acts until `end`.
    Active,
}

#[derive(Clone, Debug)]
pub struct Weather {
    pub p: WeatherParams,
    rng: Pcg32,
    /// The kind announced or at work (drawn at the alert).
    pub kind: Option<usize>,
    /// The tick the next (or current) event starts, and the tick it ends (0 until it starts).
    pub start: u64,
    pub end: u64,
    /// Cells flooded by the current event, with the ground and moisture to give back.
    pub flooded: Vec<(usize, u8, i64)>,
}

/// A draw in `lo..=hi`.
fn within(rng: &mut Pcg32, (lo, hi): (u64, u64)) -> u64 {
    lo + u64::from(rng.below(u32::try_from(hi - lo + 1).unwrap_or(u32::MAX)))
}

impl Weather {
    #[must_use]
    pub fn new(p: WeatherParams, seed: u64) -> Weather {
        let mut rng = Pcg32::new(seed, RNG_STREAM);
        let start = within(&mut rng, p.first);
        Weather {
            p,
            rng,
            kind: None,
            start,
            end: 0,
            flooded: Vec::new(),
        }
    }

    #[must_use]
    pub fn phase(&self) -> Phase {
        match (self.kind, self.end) {
            (None, _) => Phase::Calm,
            (Some(_), 0) => Phase::Warning,
            (Some(_), _) => Phase::Active,
        }
    }

    /// The factors on growth, speed and bites now (ONE when calm or warned).
    #[must_use]
    pub fn factors(&self) -> (i64, i64, i64) {
        match (self.phase(), self.kind) {
            (Phase::Active, Some(k)) => {
                let k = &self.p.kinds[k];
                (k.growth, k.speed, k.bite)
            }
            _ => (ONE_I, ONE_I, ONE_I),
        }
    }

    /// Advance to `tick` (a flora tick): raise the alert, start, act, end. Run before the animals
    /// and plants of that tick, so the factors hold for the whole tick.
    pub fn flora_tick(&mut self, tick: u64, flora: &Flora, st: &mut FloraState) {
        if self.kind.is_none() && tick + self.p.warning >= self.start {
            self.kind = Some(self.draw(st));
        }
        let Some(kind) = self.kind else {
            return;
        };
        if self.end == 0 && tick >= self.start {
            self.end = tick + self.p.kinds[kind].duration;
            self.flood(kind, flora, st);
        }
        if self.end == 0 {
            return;
        }
        if tick >= self.end {
            self.recede(st);
            self.kind = None;
            self.start = tick + within(&mut self.rng, self.p.gap);
            self.end = 0;
            return;
        }
        self.parch(kind, flora, st);
    }

    /// Draw a kind by weight; floods only on maps with water.
    fn draw(&mut self, st: &FloraState) -> usize {
        let wet = st.ground.iter().any(|&g| is_water(g));
        let weight = |k: &Kind| if k.flood > 0 && !wet { 0 } else { k.weight };
        let total: u32 = self.p.kinds.iter().map(weight).sum();
        let mut r = self.rng.below(total.max(1));
        for (i, k) in self.p.kinds.iter().enumerate() {
            if r < weight(k) {
                return i;
            }
            r -= weight(k);
        }
        0
    }

    /// Drought: each tree stand dies with `trees`, each grass-only cell is laid bare with `grass`.
    fn parch(&mut self, kind: usize, flora: &Flora, st: &mut FloraState) {
        let k = &self.p.kinds[kind];
        if k.trees == 0 && k.grass == 0 {
            return;
        }
        let (fp, n2) = (&flora.p, st.n * st.n);
        for c in 0..n2 {
            let (mut grass, mut other) = (false, false);
            for s in (0..fp.species()).filter(|&s| st.bio[s * n2 + c] >= 1) {
                if fp.level[s] == 1 {
                    grass = true;
                } else {
                    other = true;
                }
            }
            let trees = fp.strata[fp.strata.len() - 1]
                .iter()
                .any(|&s| st.bio[s * n2 + c] >= 1);
            if trees && k.trees > 0 && i64::from(self.rng.below(1 << 16)) < k.trees {
                flora.kill_trees(st, c);
            } else if grass && !other && k.grass > 0 && i64::from(self.rng.below(1 << 16)) < k.grass
            {
                flora.fell(st, c, 1);
            }
        }
    }

    /// Flood: land cells next to water turn into shallows with chance `flood`; their plants that
    /// cannot stand full water drown to litter.
    fn flood(&mut self, kind: usize, flora: &Flora, st: &mut FloraState) {
        let k = &self.p.kinds[kind];
        if k.flood == 0 {
            return;
        }
        let n = st.n;
        let wet = |y: usize, x: usize| is_water(st.ground[y * n + x]);
        let mut cells = Vec::new();
        for c in 0..n * n {
            let (y, x) = (c / n, c % n);
            let bank = (y > 0 && wet(y - 1, x))
                || (y + 1 < n && wet(y + 1, x))
                || (x > 0 && wet(y, x - 1))
                || (x + 1 < n && wet(y, x + 1));
            if st.ground[c] == LAND && bank && i64::from(self.rng.below(1 << 16)) < k.flood {
                cells.push(c);
            }
        }
        let (fp, n2) = (&flora.p, n * n);
        for &c in &cells {
            self.flooded.push((c, st.ground[c], st.water[c]));
            st.ground[c] = SHALLOW;
            st.water[c] = U16;
            for s in 0..fp.species() {
                if st.bio[s * n2 + c] >= 1 && flora.moisture(s, U16) < k.drown_below {
                    st.dead[c] += st.bio[s * n2 + c];
                    st.bio[s * n2 + c] = 0;
                    st.gauge[s * n2 + c] = 0;
                }
            }
            if (0..fp.species()).all(|s| st.bio[s * n2 + c] < 1) {
                st.owner[c] = 0;
                st.prog[0][c] = 0;
                st.prog[1][c] = 0;
            }
        }
    }

    /// The flood ends: flooded cells get their ground and moisture back.
    fn recede(&mut self, st: &mut FloraState) {
        for (c, ground, water) in self.flooded.drain(..) {
            st.ground[c] = ground;
            st.water[c] = water;
        }
    }

    pub fn hash_state(&self, h: &mut Hasher) {
        let (state, inc) = self.rng.state();
        h.u64(state)
            .u64(inc)
            .u64(self.kind.map_or(0, |k| k as u64 + 1))
            .u64(self.start)
            .u64(self.end)
            .u64(self.flooded.len() as u64);
        for &(c, g, w) in &self.flooded {
            h.u64(c as u64).u64(u64::from(g)).i64(w);
        }
    }
}

/// `x * f` in Q16, exact when `f` is ONE.
#[must_use]
pub fn scale(x: i64, f: i64) -> i64 {
    if f == ONE_I {
        x
    } else {
        div_round(x * f, ONE_I)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::World;

    fn balance() -> Balance {
        Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .expect("data files load")
    }

    /// A world whose weather is `name`, starting now (as if its alert had just run out).
    fn under(name: &str, n: usize) -> World {
        let mut w = World::new(&balance(), 5, n);
        w.state.soil.fill(U16);
        let k = w.weather.p.kinds.iter().position(|k| k.name == name);
        w.weather.kind = k;
        w.weather.start = 0;
        w
    }

    fn fill(w: &mut World, species: &str, cells: impl Iterator<Item = usize>) {
        let (s, n2) = (w.flora.p.index(species).unwrap(), w.state.n * w.state.n);
        for k in cells {
            w.state.owner[k] = 1;
            w.state.bio[s * n2 + k] = 20_000;
            w.state.gauge[s * n2 + k] = ONE_I;
        }
    }

    fn run(w: &mut World, ticks: u64) {
        for _ in 0..ticks {
            w.step();
        }
    }

    /// One event per half hour, two at most, on every seed; each preceded by its alert.
    #[test]
    fn one_or_two_events_per_half_hour_each_announced() {
        let b = balance();
        let mut st = FloraState::new(&crate::flora::FloraParams::from_balance(&b), 8);
        let flora = Flora::new(crate::flora::FloraParams::from_balance(&b));
        let every = u64::from(b.sim.flora_every_ticks);
        let half_hour = 1800 * u64::from(b.sim.tick_hz);
        for seed in 0..40 {
            let mut w = Weather::new(WeatherParams::from_balance(&b), seed);
            let (mut events, mut warned_at) = (0, None);
            let mut last = Phase::Calm;
            for tick in (0..half_hour).step_by(usize::try_from(every).unwrap()) {
                w.flora_tick(tick, &flora, &mut st);
                let now = w.phase();
                if last == Phase::Calm && now == Phase::Warning {
                    warned_at = Some(tick);
                }
                if last == Phase::Warning && now == Phase::Active {
                    events += 1;
                    let lead = tick - warned_at.expect("an alert first");
                    assert!(
                        lead + every >= w.p.warning,
                        "seed {seed}: alert {lead} ticks ahead"
                    );
                }
                last = now;
            }
            assert!((1..=2).contains(&events), "seed {seed}: {events} events");
        }
    }

    /// Drought: some tree stands die standing, some grass-only cells go bare, mixed cells keep
    /// their grass; growth is much slower meanwhile.
    #[test]
    fn drought_kills_some_trees_and_dries_some_grass() {
        let n = 16;
        let mut w = under("drought", n);
        fill(&mut w, "oak", 0..n * n / 2);
        fill(&mut w, "grasses", n * n / 2..n * n);
        let duration = w.weather.p.kinds[w.weather.kind.unwrap()].duration;
        run(&mut w, duration - 1);
        assert_eq!(w.weather.phase(), Phase::Active);
        let dead = (0..n * n / 2).filter(|&k| w.state.snag[k] > 0).count();
        let bare = (n * n / 2..n * n)
            .filter(|&k| w.state.owner[k] == 0)
            .count();
        let half = n * n / 2;
        assert!(dead > 0 && dead < half / 3, "trees dead: {dead} of {half}");
        assert!(bare > 0 && bare < half / 2, "grass bare: {bare} of {half}");
        run(&mut w, 8); // it ends on the next flora tick
        assert_eq!(w.weather.phase(), Phase::Calm);
        assert_eq!(w.flora.growth, ONE_I, "factors back to neutral");
    }

    /// Flood: land cells along the water turn into shallows and their land plants drown; when it
    /// ends, the land comes back.
    #[test]
    fn flood_drowns_the_banks_then_recedes() {
        let n = 12;
        let mut w = under("flood", n);
        for y in 0..n {
            w.state.ground[y * n + 6] = crate::terrain::DEEP;
        }
        fill(&mut w, "grasses", (0..n * n).filter(|k| k % n != 6));
        let before = w.state.ground.clone();
        run(&mut w, 1);
        let flooded: Vec<usize> = (0..n * n)
            .filter(|&k| w.state.ground[k] == SHALLOW)
            .collect();
        assert!(!flooded.is_empty(), "some banks flood");
        let grass = w.flora.p.index("grasses").unwrap();
        for &k in &flooded {
            assert!(matches!(k % n, 5 | 7), "only cells next to the water: {k}");
            assert_eq!(w.state.bio[grass * n * n + k], 0, "land plants drown");
        }
        assert!(w.fauna.speed < ONE_I && w.flora.growth < ONE_I);
        let duration = w.weather.p.kinds[w.weather.kind.unwrap()].duration;
        run(&mut w, duration + 8);
        assert_eq!(w.state.ground, before, "the water recedes");
    }

    /// Rain grows a meadow faster than calm weather, drought slower.
    #[test]
    fn rain_speeds_growth_and_drought_slows_it() {
        let grown = |kind: Option<&str>| {
            let n = 8;
            let mut w = kind.map_or_else(
                || {
                    let mut w = World::new(&balance(), 5, n);
                    w.state.soil.fill(U16);
                    w
                },
                |k| under(k, n),
            );
            fill(&mut w, "grasses", 0..n * n);
            let s = w.flora.p.index("grasses").unwrap();
            for k in 0..n * n {
                w.state.bio[s * n * n + k] = 2_000;
            }
            run(&mut w, 80);
            w.state.bio.iter().sum::<i64>()
        };
        let calm = grown(None);
        assert!(grown(Some("rain")) > calm, "rain");
        assert!(grown(Some("drought")) < calm, "drought");
    }
}
