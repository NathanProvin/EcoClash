//! Flora cell model (gamerules §2–§3; D-019, D-022, D-024, D-025, D-029). It began as an exact
//! port of the prototype's quant mode (`tools/prototype/flora.py`); since D-226 it is the single
//! reference for the rules. Conquest of enemy cells compares strength and push (D-225).
//!
//! Units, as in the prototype: biomass, soil, water, light in 0..=U16; cover, gauge, suitability
//! and claim progress in 0..=ONE (Q16.16). Every rule reads the previous state; the new state is
//! written separately (double buffering), so the order of cells never matters.

// Loops index several parallel arrays through the same species-major offset, block for block
// with the prototype; index loops keep that correspondence readable.
#![allow(clippy::needless_range_loop)]

use crate::balance::Balance;
use crate::fixed::{ONE, div_round};

const ONE_I: i64 = ONE as i64;
/// Largest u16: the range of biomass, soil development, water and light.
pub const U16: i64 = 65_535;
#[cfg(test)] // only the reference step walks neighbours by offset
const DIRS: [(isize, isize); 4] = [(-1, 0), (1, 0), (0, -1), (0, 1)];
const PLAYERS: [u8; 2] = [1, 2];
/// Height strata: herbs, intermediate, shrubs, trees (D-087).
pub const LEVELS: usize = 4;

/// Plant rules and species stats, converted once to fixed-point (INSTRUCTIONS §4). Per-species
/// vectors are indexed by species id (file order of `species.toml`).
#[derive(Clone, Debug)]
pub struct FloraParams {
    pub names: Vec<String>,
    pub level: Vec<u8>,
    /// Species ids of each height stratum (1..=LEVELS).
    pub strata: [Vec<usize>; LEVELS],
    pub kmax: Vec<i64>,
    /// Logistic rate per tick (Q16).
    pub rdt: Vec<i64>,
    /// Colonization gauge speed per tick at full pressure (Q16): the `growth` stat.
    pub rate: Vec<i64>,
    pub soil_dt: Vec<i64>,
    pub cast: Vec<i64>,
    pub tol: Vec<i64>,
    pub alpha: i64,
    pub seed_b: Vec<i64>,
    pub est_thr: Vec<i64>,
    pub smother: Vec<i64>,
    pub litter: Vec<i64>,
    pub plant_g: i64,
    pub soil_min: Vec<i64>,
    pub soil_ramp: i64,
    pub water0: i64,
    pub light0: i64,
    pub w_opt: Vec<i64>,
    pub w_tol: Vec<i64>,
    pub l_opt: Vec<i64>,
    pub l_tol: Vec<i64>,
    /// Soil-type affinity per species (Q16), indexed `[species][soil type]`.
    pub aff: Vec<Vec<i64>>,
    /// Share of the map's cells each player may hold, per species (Q16; D-029, D-045).
    pub cap: Vec<i64>,
    pub succession: bool,
    pub shade: bool,
    /// Strength gain at full soil development (Q16, D-225).
    pub fert: i64,
    /// Strength gain under a full canopy, biodiversity gain per species and its cap (Q16, D-236).
    pub canopy: i64,
    pub edge: i64,
    pub floor: i64,
    /// Least moisture response in the shallows (Q16, D-239).
    pub seep: i64,
    pub div: i64,
    pub div_cap: i64,
    /// Conquest hold (D-230), in flora ticks.
    pub hold: i64,
    /// Dead wood (D-127), per flora tick (Q16): the chance a tree stand dies of old age, the
    /// share of it left standing, and the share of standing dead wood that rots.
    pub death: i64,
    pub wood_share: i64,
    pub rot: i64,
}

/// The prototype's `round_half_away`: `sign(x) * floor(|x| + 0.5)`, used for every load-time
/// conversion so both sides produce the same integers.
#[allow(clippy::float_arithmetic, clippy::cast_possible_truncation)]
pub(crate) fn round(x: f64) -> i64 {
    let r = (x.abs() + 0.5).floor() as i64;
    if x < 0.0 { -r } else { r }
}

impl FloraParams {
    /// Convert the flora part of the balance, with the prototype's float operations in the same
    /// order (tools/prototype/flora.py, `Flora.__init__`), then its rounding.
    #[must_use]
    #[allow(clippy::float_arithmetic)]
    pub fn from_balance(b: &Balance) -> FloraParams {
        let (f, dt) = (&b.flora, b.flora_dt());
        let one = f64::from(ONE);
        let u16f = 65535.0;
        let sp: Vec<_> = b.flora_species.iter().map(|(_, s)| s).collect();
        let col = |get: &dyn Fn(&crate::balance::FloraSpecies) -> f64, scale: f64| -> Vec<f64> {
            sp.iter().map(|s| get(s) * scale).collect()
        };
        let kmax_f = col(&|s| s.k_max, 1.0);
        let rdt_f = col(&|s| s.biomass_rate, dt * one);
        let level: Vec<u8> = sp.iter().map(|s| s.level).collect();
        let mut strata: [Vec<usize>; LEVELS] = std::array::from_fn(|_| vec![]);
        for (i, &l) in level.iter().enumerate() {
            strata[usize::from(l) - 1].push(i);
        }
        let v = |x: Vec<f64>| x.into_iter().map(round).collect::<Vec<i64>>();
        let soil_min = sp
            .iter()
            .map(|s| {
                if s.pioneer {
                    0.0
                } else {
                    f.soil_min_level[usize::from(s.level) - 1] * u16f
                }
            })
            .collect();
        let aff = sp
            .iter()
            .map(|s| {
                b.terrain
                    .soil_types
                    .iter()
                    .map(|t| round(s.soil_affinity.get(t).copied().unwrap_or(1.0) * one))
                    .collect()
            })
            .collect();
        FloraParams {
            names: b.flora_species.iter().map(|(n, _)| n.clone()).collect(),
            strata,
            kmax: v(kmax_f.clone()),
            rate: v(col(&|s| s.growth, dt * one)),
            soil_dt: v(col(&|s| s.soil_gain, dt * u16f)),
            cast: v(col(&|s| s.shade_cast, one)),
            tol: v(col(&|s| s.shade_tolerance, one)),
            alpha: round(f.niche_overlap * one),
            seed_b: v(kmax_f.iter().map(|k| k * f.seed_fraction).collect()),
            est_thr: v(kmax_f.iter().map(|k| k * f.establish_threshold).collect()),
            smother: v(kmax_f.iter().map(|k| k * f.smother_rate * dt).collect()),
            litter: v(rdt_f.iter().map(|r| r * f.litter_fraction).collect()),
            rdt: v(rdt_f),
            plant_g: round(f.plant_gauge * one),
            soil_min: v(soil_min),
            soil_ramp: round(f.soil_ramp * u16f),
            water0: round(b.terrain.water * u16f),
            light0: round(b.terrain.light * u16f),
            w_opt: v(col(&|s| s.water_optimum, u16f)),
            w_tol: v(col(&|s| s.water_tolerance, u16f)),
            l_opt: v(col(&|s| s.light_optimum, u16f)),
            l_tol: v(col(&|s| s.light_tolerance, u16f)),
            aff,
            cap: v(col(&|s| s.cap, one)),
            level,
            succession: f.succession,
            shade: f.shade,
            fert: round(f.fert_gain * one),
            canopy: round(f.canopy_gain * one),
            edge: round(f.edge_shade * one),
            floor: round(f.vigor_floor * one),
            seep: round(f.shallow_seep * one),
            div: round(f.div_gain * one),
            div_cap: round(f.div_cap * one),
            hold: round(f.hold_s * f64::from(b.sim.tick_hz) / f64::from(b.sim.flora_every_ticks)),
            death: round(dt / b.deadwood.natural_death_s * one),
            wood_share: round(b.deadwood.wood_share * one),
            rot: round(dt / b.deadwood.rot_s * one),
        }
    }

    /// Cell cap of species `s` on a map of `n2` cells: its share times the cell count.
    #[must_use]
    pub fn cap_cells(&self, s: usize, n2: usize) -> i64 {
        div(self.cap[s] * i64::try_from(n2).unwrap_or(i64::MAX), ONE_I)
    }

    #[must_use]
    pub fn species(&self) -> usize {
        self.names.len()
    }

    #[must_use]
    pub fn index(&self, name: &str) -> Option<usize> {
        self.names.iter().position(|n| n == name)
    }

    /// Feed every converted value to a hasher, in a fixed order (balance hash, M1.5).
    pub fn hash_into(&self, h: &mut crate::hash::Hasher) {
        h.u64(self.names.len() as u64);
        for name in &self.names {
            h.u64(name.len() as u64).bytes(name.as_bytes());
        }
        h.bytes(&self.level);
        for v in [
            &self.kmax,
            &self.rdt,
            &self.rate,
            &self.soil_dt,
            &self.cast,
            &self.tol,
            &self.seed_b,
            &self.est_thr,
            &self.smother,
            &self.litter,
            &self.soil_min,
            &self.w_opt,
            &self.w_tol,
            &self.l_opt,
            &self.l_tol,
            &self.cap,
        ] {
            h.i64s(v);
        }
        for row in &self.aff {
            h.i64s(row);
        }
        h.i64(self.alpha)
            .i64(self.death)
            .i64(self.wood_share)
            .i64(self.rot)
            .i64(self.plant_g)
            .i64(self.soil_ramp)
            .i64(self.water0)
            .i64(self.light0)
            .i64(self.fert)
            .i64(self.canopy)
            .i64(self.edge)
            .i64(self.floor)
            .i64(self.seep)
            .i64(self.div)
            .i64(self.div_cap)
            .i64(self.hold);
        h.bytes(&[u8::from(self.succession), u8::from(self.shade)]);
    }
}

/// The flora grid. Per-species arrays are species-major: `bio[s * cells + k]`.
/// ponytail: i64 everywhere for an exact, simple port; pack to u16 fields when memory matters.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FloraState {
    pub n: usize,
    /// 0 none, else player (1, 2).
    pub owner: Vec<u8>,
    pub bio: Vec<i64>,
    /// Colonization gauge per species and cell (Q16): capacity = k_max x gauge.
    pub gauge: Vec<i64>,
    pub soil: Vec<i64>,
    pub soil_type: Vec<u8>,
    pub water: Vec<i64>,
    pub light: Vec<i64>,
    /// Ground class (`terrain::LAND`, `SHALLOW`, `DEEP`, `ROCK`) and elevation (0..=65535) of each
    /// cell (D-083); a flat map is all land at 0.
    pub ground: Vec<u8>,
    pub elevation: Vec<i64>,
    /// Claim progress on empty cells, per player (Q16).
    pub prog: [Vec<i64>; 2],
    /// Dead biomass (litter), eaten by decomposers.
    pub dead: Vec<i64>,
    /// Lockout (D-098): flora ticks left during which player `lock_p` may not take the cell back
    /// (set when enemy grazers eat it bare; 0 = free).
    pub lock: Vec<i64>,
    pub lock_p: Vec<u8>,
    /// Standing dead wood (D-127), biomass units: a dead tree, eaten by recyclers and rotting to
    /// litter; while any stands, the trees of `snag_owner` (who held the cell when the stand
    /// died) do not grow in the cell; the enemy's may (D-227).
    pub snag: Vec<i64>,
    pub snag_owner: Vec<u8>,
    /// Flora ticks done.
    pub t: u64,
}

impl FloraState {
    /// A bare `n x n` map with the V1 constant terrain.
    #[must_use]
    pub fn new(p: &FloraParams, n: usize) -> FloraState {
        let cells = n * n;
        FloraState {
            n,
            owner: vec![0; cells],
            bio: vec![0; cells * p.species()],
            gauge: vec![0; cells * p.species()],
            soil: vec![0; cells],
            soil_type: vec![0; cells],
            water: vec![p.water0; cells],
            light: vec![p.light0; cells],
            ground: vec![0; cells],
            elevation: vec![0; cells],
            prog: [vec![0; cells], vec![0; cells]],
            dead: vec![0; cells],
            lock: vec![0; cells],
            lock_p: vec![0; cells],
            snag: vec![0; cells],
            snag_owner: vec![0; cells],
            t: 0,
        }
    }
}

/// One flora tick off every lockout (D-098).
fn count_down(lock: &mut [i64]) {
    for l in lock {
        *l = (*l - 1).max(0);
    }
}

/// `a / b` rounded half away from zero (the prototype's `Flora.div`); `b > 0`.
fn div(a: i64, b: i64) -> i64 {
    div_round(a, b)
}

/// Growth division with the minimum-growth floor (D-021): positive growth never rounds to 0.
fn grow_div(a: i64, b: i64) -> i64 {
    let q = div(a, b);
    if q == 0 && a > 0 { 1 } else { q }
}

/// Triangular response in 0..=ONE: 1 at the optimum, 0 at `tol` away; `tol == 0` is neutral.
fn response(x: i64, opt: i64, tol: i64) -> i64 {
    if tol > 0 {
        (ONE_I - div((x - opt).abs() * ONE_I, tol)).clamp(0, ONE_I)
    } else {
        ONE_I
    }
}

/// The flora rules over a [`FloraState`].
#[derive(Clone, Debug)]
pub struct Flora {
    pub p: FloraParams,
    /// Weather factor on positive growth (Q16, D-132); ONE leaves the rules exactly as is.
    pub growth: i64,
    /// Animal species living in each cell, per player (D-225): set from the animals before each
    /// flora step (`Fauna::residents`); empty counts none. Derived from hashed state.
    pub residents: Vec<[u8; 2]>,
    scratch: Scratch,
}

/// Outside the map, in the neighbour table.
const NONE: u32 = u32::MAX;

/// Buffers reused from one flora tick to the next (no per-tick allocation).
#[derive(Clone, Debug, Default)]
struct Scratch {
    n: usize,
    /// The 4 neighbours of each cell (up, down, left, right), NONE outside.
    nbr: Vec<[u32; 4]>,
    cover: Vec<i64>,
    /// Bit s set when species s has biomass in the cell.
    present: Vec<u64>,
    dom: Vec<u8>,
    /// Strength of each cell for its owner (Q16, D-225).
    strength: Vec<i64>,
    bio: Vec<i64>,
    gauge: Vec<i64>,
    owner: Vec<u8>,
    soil: Vec<i64>,
    prog: [Vec<i64>; 2],
}

impl Scratch {
    fn prepare(&mut self, n: usize, ns: usize) {
        let cells = n * n;
        if self.n != n || self.nbr.len() != cells {
            self.n = n;
            let id = |y: usize, x: usize| u32::try_from(y * n + x).unwrap_or(NONE);
            self.nbr = (0..cells)
                .map(|k| {
                    let (y, x) = (k / n, k % n);
                    [
                        if y > 0 { id(y - 1, x) } else { NONE },
                        if y + 1 < n { id(y + 1, x) } else { NONE },
                        if x > 0 { id(y, x - 1) } else { NONE },
                        if x + 1 < n { id(y, x + 1) } else { NONE },
                    ]
                })
                .collect();
        }
        self.cover.resize(ns * cells, 0);
        self.present.resize(cells, 0);
        self.dom.resize(cells, 0);
        self.strength.resize(cells, 0);
    }
}

impl Flora {
    /// The trees of cell `k` die (D-127): `wood_share` of their biomass stands on as dead wood,
    /// the rest falls as litter. A cell left with no plant turns neutral. Returns whether trees
    /// were there.
    pub fn kill_trees(&self, st: &mut FloraState, k: usize) -> bool {
        let (p, n2) = (&self.p, st.n * st.n);
        let mut wood = 0;
        for &s in &p.strata[LEVELS - 1] {
            wood += st.bio[s * n2 + k];
            st.bio[s * n2 + k] = 0;
            st.gauge[s * n2 + k] = 0;
        }
        if wood <= 0 {
            return false;
        }
        let standing = div(wood * p.wood_share, ONE_I);
        st.snag[k] += standing;
        st.snag_owner[k] = st.owner[k]; // its trees may not grow back under it (D-227)
        st.dead[k] += wood - standing;
        if (0..p.species()).all(|s| st.bio[s * n2 + k] < 1) {
            st.owner[k] = 0;
            st.prog[0][k] = 0;
            st.prog[1][k] = 0;
        }
        true
    }

    /// Fell every plant of level `min_level` and up in cell `k` to litter (a storm, D-129); a
    /// cell left with no plant turns neutral.
    pub fn fell(&self, st: &mut FloraState, k: usize, min_level: u8) {
        let (p, n2) = (&self.p, st.n * st.n);
        for s in (0..p.species()).filter(|&s| p.level[s] >= min_level) {
            st.dead[k] += st.bio[s * n2 + k];
            st.bio[s * n2 + k] = 0;
            st.gauge[s * n2 + k] = 0;
        }
        if (0..p.species()).all(|s| st.bio[s * n2 + k] < 1) {
            st.owner[k] = 0;
            st.prog[0][k] = 0;
            st.prog[1][k] = 0;
        }
    }

    /// Cell `k` back to bare soil (a chemical spill, D-129): no plants, litter, dead wood, soil
    /// development or claim progress, and no owner.
    pub fn lay_bare(&self, st: &mut FloraState, k: usize) {
        let n2 = st.n * st.n;
        for s in 0..self.p.species() {
            st.bio[s * n2 + k] = 0;
            st.gauge[s * n2 + k] = 0;
        }
        st.dead[k] = 0;
        st.snag[k] = 0;
        st.soil[k] = 0;
        st.owner[k] = 0;
        st.prog[0][k] = 0;
        st.prog[1][k] = 0;
    }

    /// One flora tick of old age (D-127): every cell with trees dies with chance `death`.
    pub fn natural_deaths(&self, st: &mut FloraState, rng: &mut crate::rng::Pcg32) {
        let n2 = st.n * st.n;
        for k in 0..n2 {
            let trees = self.p.strata[LEVELS - 1]
                .iter()
                .any(|&s| st.bio[s * n2 + k] >= 1);
            if trees && i64::from(rng.below(1 << 16)) < self.p.death {
                self.kill_trees(st, k);
            }
        }
    }

    /// One flora tick of rot (D-127): standing dead wood loses `rot` of itself (at least 1) to
    /// litter.
    pub fn rot_deadwood(&self, st: &mut FloraState) {
        for k in 0..st.snag.len() {
            if st.snag[k] > 0 {
                let lost = div(st.snag[k] * self.p.rot, ONE_I).max(1).min(st.snag[k]);
                st.snag[k] -= lost;
                st.dead[k] += lost;
            }
        }
    }

    #[must_use]
    pub fn new(p: FloraParams) -> Flora {
        Flora {
            p,
            growth: ONE_I,
            residents: Vec::new(),
            scratch: Scratch::default(),
        }
    }

    /// Species `s`'s moisture response at moisture `x` (0..=ONE; neutral species: ONE).
    #[must_use]
    pub fn moisture(&self, s: usize, x: i64) -> i64 {
        response(x, self.p.w_opt[s], self.p.w_tol[s])
    }

    /// The shade each stratum casts on the strata below, from the cover of each species (Q16):
    /// `casts[u]` for stratum u + 1 (u = 0, the herbs, casts on nothing).
    pub(crate) fn casts(&self, cover: impl Fn(usize) -> i64) -> [i64; LEVELS] {
        let p = &self.p;
        std::array::from_fn(|u| {
            div(
                p.strata[u].iter().map(|&j| p.cast[j] * cover(j)).sum(),
                ONE_I,
            )
        })
    }

    /// The light left (Q16, ONE: full) for a plant of `level` with shade tolerance `tol` under
    /// `casts`: each higher stratum blocks its cast, less the tolerated share.
    pub(crate) fn light(casts: &[i64; LEVELS], level: u8, tol: i64) -> i64 {
        let mut light = ONE_I;
        for (u, &cast) in casts.iter().enumerate().skip(1) {
            if usize::from(level) <= u {
                let block = div(cast * (ONE_I - tol), ONE_I);
                light = div(light * (ONE_I - block).max(0), ONE_I);
            }
        }
        light
    }

    /// The single site modifier (gamerules §2.3): f_dev x f_soil x f_water x f_light, 0..=ONE.
    #[must_use]
    pub fn suitability(&self, st: &FloraState, s: usize, k: usize) -> i64 {
        let p = &self.p;
        // Rock and deep water: nothing takes root (D-084). Shallows through the water response
        // below, at least `seep` (D-239).
        if matches!(st.ground[k], crate::terrain::ROCK | crate::terrain::DEEP) {
            return 0;
        }
        let mut suit = p.aff[s][usize::from(st.soil_type[k])];
        if p.succession {
            let dev = div(
                (st.soil[k] - (p.soil_min[s] - p.soil_ramp)) * ONE_I,
                p.soil_ramp,
            );
            suit = div(suit * dev.clamp(0, ONE_I), ONE_I);
        }
        // A neutral response is ONE, and div(x * ONE, ONE) == x exactly: skip it.
        if p.w_tol[s] > 0 {
            let mut r = response(st.water[k], p.w_opt[s], p.w_tol[s]);
            if st.ground[k] == crate::terrain::SHALLOW {
                r = r.max(p.seep);
            }
            suit = div(suit * r, ONE_I);
        }
        if p.l_tol[s] > 0 {
            suit = div(suit * response(st.light[k], p.l_opt[s], p.l_tol[s]), ONE_I);
        }
        suit
    }

    /// Dominant level of each cell: the highest stratum with an established species (0 = none).
    #[must_use]
    pub fn dominant(&self, st: &FloraState) -> Vec<u8> {
        let cells = st.n * st.n;
        let mut dom = vec![0u8; cells];
        for (stratum, ids) in self.p.strata.iter().enumerate() {
            for &s in ids {
                for k in 0..cells {
                    if st.bio[s * cells + k] >= self.p.est_thr[s] {
                        dom[k] = u8::try_from(stratum + 1).unwrap_or(3);
                    }
                }
            }
        }
        dom
    }

    /// Conquest hold (D-230): every cell that went straight from one owner to the other this
    /// tick is held against its former owner for `hold` flora ticks (the lockout fields, D-098).
    fn hold_conquests(&self, st: &mut FloraState, new_owner: &[u8]) {
        for (k, &now) in new_owner.iter().enumerate() {
            let was = st.owner[k];
            if was != 0 && now != 0 && now != was {
                st.lock[k] = self.p.hold;
                st.lock_p[k] = was;
            }
        }
    }

    /// Whether a dead tree in cell `k` bars species `s` of `player` (D-227): a tree of the
    /// player who held the cell when the stand died, while its dead wood stands.
    #[must_use]
    pub fn tree_barred(&self, st: &FloraState, s: usize, k: usize, player: u8) -> bool {
        st.snag[k] > 0 && usize::from(self.p.level[s]) == LEVELS && st.snag_owner[k] == player
    }

    /// The species that count in cell `k` for its owner (D-225): its plants established there
    /// plus its animal species living there; 0 on a neutral cell.
    #[must_use]
    pub fn species_count(&self, st: &FloraState, k: usize) -> i64 {
        let (p, cells) = (&self.p, st.n * st.n);
        let o = st.owner[k];
        if o == 0 {
            return 0;
        }
        let plants = (0..p.species())
            .filter(|&s| st.bio[s * cells + k] >= p.est_thr[s])
            .count();
        let animals = self.residents.get(k).map_or(0, |r| r[usize::from(o) - 1]);
        i64::try_from(plants).unwrap_or(0) + i64::from(animals)
    }

    /// The shade cell `k`'s plants cast on its ground (Q16, 0..=ONE).
    fn ground_shade(&self, st: &FloraState, k: usize) -> i64 {
        let cells = st.n * st.n;
        let casts = self.casts(|s| div(st.bio[s * cells + k] * ONE_I, self.p.kmax[s]));
        ONE_I - Self::light(&casts, 1, 0)
    }

    /// Strength of cell `k` for its owner (Q16, D-236): vigor x canopy x side shade x fertility
    /// x biodiversity. Vigor: `floor` + (1 - `floor`) x the mean fill of the owner's established
    /// layers (each layer's summed cover, at most 1), weighted by its species' spread rate x
    /// cover x light, so young or shaded layers weigh little. Canopy: 1 + `canopy` x the shade
    /// cast on the ground. Side shade: 1 - `edge` x the strongest enemy neighbour's ground shade
    /// x own open ground. Fertility: 1 + `fert` x soil development. Biodiversity: 1 + `div` x
    /// species, at most `div_cap`.
    #[must_use]
    pub fn strength(&self, st: &FloraState, k: usize) -> i64 {
        self.strength_with(st, k, |m| self.ground_shade(st, m))
    }

    /// Every cell's strength (Q16, D-236), each cell's ground shade computed once.
    #[must_use]
    pub fn strengths(&self, st: &FloraState) -> Vec<i64> {
        let cells = st.n * st.n;
        let shade: Vec<i64> = (0..cells).map(|k| self.ground_shade(st, k)).collect();
        (0..cells)
            .map(|k| self.strength_with(st, k, |m| shade[m]))
            .collect()
    }

    /// `strength`, with the neighbours' ground shade from `shade`.
    fn strength_with(&self, st: &FloraState, k: usize, shade: impl Fn(usize) -> i64) -> i64 {
        let (p, n, cells) = (&self.p, st.n, st.n * st.n);
        let o = st.owner[k];
        if o == 0 {
            return 0;
        }
        let mut cov = [0i64; 64]; // at most 64 species (the step's presence bitmask)
        let mut est = 0u64;
        for s in 0..p.species() {
            let b = st.bio[s * cells + k];
            if b > 0 {
                cov[s] = div(b * ONE_I, p.kmax[s]);
                est |= u64::from(b >= p.est_thr[s]) << s;
            }
        }
        let cover = |s: usize| cov[s];
        let casts = self.casts(cover);
        let (mut num, mut den) = (0i64, 0i64);
        for (l, strat) in p.strata.iter().enumerate() {
            if !strat.iter().any(|&s| est >> s & 1 == 1) {
                continue;
            }
            let level = u8::try_from(l + 1).unwrap_or(u8::MAX);
            let fill = strat.iter().map(|&s| cover(s)).sum::<i64>().min(ONE_I);
            let weight: i64 = strat
                .iter()
                .map(|&s| {
                    let light = Self::light(&casts, level, p.tol[s]);
                    div(div(p.rate[s] * cover(s), ONE_I) * light, ONE_I)
                })
                .sum();
            num += weight * fill;
            den += weight;
        }
        if den <= 0 {
            return 0;
        }
        let vigor = p.floor + div((ONE_I - p.floor) * div(num, den), ONE_I);
        let open = Self::light(&casts, 1, 0);
        let canopy = ONE_I + div(p.canopy * (ONE_I - open), ONE_I);
        let (y, x) = (k / n, k % n);
        let side = [
            (y > 0).then(|| k - n),
            (y + 1 < n).then(|| k + n),
            (x > 0).then(|| k - 1),
            (x + 1 < n).then(|| k + 1),
        ]
        .into_iter()
        .flatten()
        .filter(|&m| st.owner[m] != 0 && st.owner[m] != o)
        .map(shade)
        .max()
        .unwrap_or(0);
        let shaded = (ONE_I - div(div(p.edge * side, ONE_I) * open, ONE_I)).max(0);
        let fert = ONE_I + div(p.fert * st.soil[k], U16);
        let animals = self.residents.get(k).map_or(0, |r| r[usize::from(o) - 1]);
        let species = i64::from(est.count_ones()) + i64::from(animals);
        let diversity = (ONE_I + p.div * species).min(p.div_cap);
        [canopy, shaded, fert, diversity]
            .into_iter()
            .fold(vigor, |v, m| div(v * m, ONE_I))
    }

    /// Each owned cell's strength and the enemy's push on it (Q16, D-225): the summed strength
    /// of the enemy's neighbouring cells, 0 while the cell is held against that enemy (D-230).
    /// Neutral cells: [0, 0].
    #[must_use]
    pub fn fronts(&self, st: &FloraState) -> Vec<[i64; 2]> {
        let (n, cells) = (st.n, st.n * st.n);
        let strength = self.strengths(st);
        (0..cells)
            .map(|k| {
                let enemy = match st.owner[k] {
                    1 => 2,
                    2 => 1,
                    _ => return [0, 0],
                };
                if st.lock[k] > 0 && st.lock_p[k] == enemy {
                    return [strength[k], 0]; // held against its former owner (D-230)
                }
                let (y, x) = (k / n, k % n);
                let near = [
                    (y > 0).then(|| k - n),
                    (y + 1 < n).then(|| k + n),
                    (x > 0).then(|| k - 1),
                    (x + 1 < n).then(|| k + 1),
                ];
                let push: i64 = near
                    .into_iter()
                    .flatten()
                    .filter(|&m| st.owner[m] == enemy)
                    .map(|m| strength[m])
                    .sum();
                [strength[k], push]
            })
            .collect()
    }

    /// How hard the non-owner's plants push into each owned cell (Q16; 0 on empty cells), for
    /// display (D-076): the flora step's push over strength (D-225), at least 0.
    #[must_use]
    pub fn push(&self, st: &FloraState) -> Vec<i64> {
        self.fronts(st)
            .into_iter()
            .map(|[strength, push]| (push - strength).max(0))
            .collect()
    }

    /// Seed species `s` on own or empty `cells` (gamerules §8), alongside what already grows
    /// there, up to its cell cap (first cells in the given order). Returns the cells planted.
    pub fn plant(&self, st: &mut FloraState, player: u8, s: usize, cells: &[usize]) -> usize {
        let p = &self.p;
        let n2 = st.n * st.n;
        let held = (0..n2)
            .filter(|&k| st.bio[s * n2 + k] > 0 && st.owner[k] == player)
            .count();
        let mut room = p.cap_cells(s, n2) - i64::try_from(held).unwrap_or(i64::MAX);
        let mut planted = 0;
        for &k in cells {
            let barred = st.lock[k] > 0 && st.lock_p[k] == player; // D-098
            let free = (st.owner[k] == 0 && !barred) || st.owner[k] == player;
            if !free || self.suitability(st, s, k) <= 0 || self.tree_barred(st, s, k, player) {
                continue;
            }
            let i = s * n2 + k;
            if st.bio[i] == 0 {
                if room <= 0 {
                    continue;
                }
                room -= 1;
            }
            st.owner[k] = player;
            st.bio[i] = st.bio[i].max(p.seed_b[s]);
            st.gauge[i] = st.gauge[i].max(p.plant_g);
            planted += 1;
        }
        planted
    }

    /// Advance one flora tick: the same rules and results as the prototype's quant mode
    /// (tools/prototype/flora.py, `Flora.step`), computed fast (D-038).
    ///
    /// Every rule of a cell reads only that cell and its 4 neighbours in the previous state, and
    /// a species absent from a cell and its neighbours contributes nothing there. So one global
    /// pass computes cover, presence and the cap counts, then each cell is solved on its own,
    /// over its relevant species only; a bare cell with bare neighbours is skipped. Buffers are
    /// reused between ticks. `step_reference` (tests) is the readable original, kept as oracle.
    pub fn step(&mut self, st: &mut FloraState) {
        let mut sc = std::mem::take(&mut self.scratch);
        self.step_with(st, &mut sc);
        self.scratch = sc;
    }

    #[allow(clippy::too_many_lines)] // one rule per numbered block, as in the reference
    fn step_with(&self, st: &mut FloraState, sc: &mut Scratch) {
        let p = &self.p;
        let (n, ns) = (st.n, p.species());
        let cells = n * n;
        assert!(ns <= 64, "at most 64 plant species (presence bitmask)");
        sc.prepare(n, ns);

        // Global pass: cover, presence bitmask, dominant level, strength (D-225), cells held per
        // species.
        let mut held = [vec![0i64; ns], vec![0i64; ns]];
        for k in 0..cells {
            let (mut mask, mut dom) = (0u64, 0u8);
            for s in 0..ns {
                let i = s * cells + k;
                let b = st.bio[i];
                sc.cover[i] = if b > 0 { div(b * ONE_I, p.kmax[s]) } else { 0 };
                if b >= p.est_thr[s] {
                    dom = dom.max(p.level[s]);
                }
                if b > 0 {
                    mask |= 1 << s;
                    if let o @ 1..=2 = st.owner[k] {
                        held[usize::from(o) - 1][s] += 1;
                    }
                }
            }
            sc.present[k] = mask;
            sc.dom[k] = dom;
        }
        sc.strength = self.strengths(st);
        let full: [Vec<bool>; 2] = [0, 1].map(|pi| {
            (0..ns)
                .map(|s| held[pi][s] >= p.cap_cells(s, cells))
                .collect()
        });
        sc.bio.clone_from(&st.bio);
        sc.gauge.clone_from(&st.gauge);
        sc.owner.clone_from(&st.owner);
        sc.soil.clone_from(&st.soil);
        sc.prog[0].clone_from(&st.prog[0]);
        sc.prog[1].clone_from(&st.prog[1]);

        let (bio, owner, cover) = (&st.bio, &st.owner, &sc.cover);
        for k in 0..cells {
            let nbr = sc.nbr[k];
            let mut rel = sc.present[k];
            for &m in &nbr {
                if m != NONE {
                    rel |= sc.present[m as usize];
                }
            }
            if rel == 0 && owner[k] == 0 {
                continue; // bare cell, bare neighbours: nothing changes
            }
            let species = || (0..ns).filter(move |&s| rel & (1 << s) != 0);
            let at = |s: usize| s * cells + k;
            let (mut suit, mut growth) = ([0i64; 64], [0i64; 64]);
            for s in species() {
                suit[s] = self.suitability(st, s, k);
            }
            // Per player: a dead tree bars its former owner's trees only (D-227).
            let suitp: [[i64; 64]; 2] = [0, 1].map(|pi| {
                let mut v = suit;
                for s in species() {
                    if self.tree_barred(st, s, k, PLAYERS[pi]) {
                        v[s] = 0;
                    }
                }
                v
            });

            // 1-2. Shade and logistic growth with competition, for the species present here.
            let casts = self.casts(|j| cover[at(j)]);
            let totals: [i64; LEVELS] =
                std::array::from_fn(|l| p.strata[l].iter().map(|&j| cover[at(j)]).sum());
            for s in species().filter(|&s| bio[at(s)] > 0) {
                let shade = if p.shade {
                    Self::light(&casts, p.level[s], p.tol[s])
                } else {
                    ONE_I
                };
                let i = at(s);
                let cap = div(shade * st.gauge[i], ONE_I).max(1);
                let total = totals[usize::from(p.level[s]) - 1];
                let comp = cover[i] + div(p.alpha * (total - cover[i]), ONE_I);
                growth[s] = grow_div(p.rdt[s] * bio[i] * (cap - comp), cap * ONE_I);
                if growth[s] > 0 && self.growth != ONE_I {
                    growth[s] = grow_div(growth[s] * self.growth, ONE_I); // weather (D-132)
                }
            }

            // 3. Soil development.
            if p.succession {
                let gain = div(species().map(|s| p.soil_dt[s] * cover[at(s)]).sum(), ONE_I);
                sc.soil[k] = (st.soil[k] + gain).min(U16);
            }

            // 4. Pressure, seeds and attack of each player. Attack (D-225): the push of the
            //    player's neighbouring cells over this enemy cell's strength.
            let mut press = [[0i64; 64]; 2];
            let mut seeds = [[false; 64]; 2];
            let mut attack = [0i64; 2];
            for (pi, pl) in PLAYERS.into_iter().enumerate() {
                let cov = |s: usize, m: usize| {
                    if owner[m] == pl {
                        cover[s * cells + m]
                    } else {
                        0
                    }
                };
                for s in species() {
                    let mut sum = cov(s, k);
                    let mut mine = false;
                    for &m in &nbr {
                        if m != NONE {
                            let m = m as usize;
                            sum += cov(s, m);
                            mine |= owner[m] == pl && bio[s * cells + m] >= p.est_thr[s];
                        }
                    }
                    press[pi][s] = div(sum, 5).min(ONE_I);
                    seeds[pi][s] = mine && suitp[pi][s] > 0;
                }
                if owner[k] == 3 - pl {
                    let push: i64 = nbr
                        .iter()
                        .filter(|&&m| m != NONE && owner[m as usize] == pl)
                        .map(|&m| sc.strength[m as usize])
                        .sum();
                    // A cell just taken from this player is held (D-230).
                    let held = st.lock[k] > 0 && st.lock_p[k] == pl;
                    attack[pi] = if held {
                        0
                    } else {
                        (push - sc.strength[k]).max(0)
                    };
                }
            }

            // 5. Growth minus litter and smothering; losses become dead biomass.
            let mut dead = 0;
            for s in species().filter(|&s| bio[at(s)] > 0) {
                let i = at(s);
                let litter = div(p.litter[s] * bio[i], ONE_I);
                let grown = bio[i] + growth[s] - litter;
                let mut smothered = 0;
                for (pi, pl) in PLAYERS.into_iter().enumerate() {
                    if owner[k] == 3 - pl {
                        smothered += div(p.smother[s] * attack[pi], ONE_I);
                    }
                }
                let smothered = smothered.min(grown.max(0));
                dead += litter + smothered + (-growth[s]).max(0);
                sc.bio[i] = (grown - smothered).clamp(0, U16);
            }
            for s in 0..ns {
                if sc.bio[at(s)] == 0 {
                    sc.gauge[at(s)] = 0;
                }
            }
            let alive = |b: &[i64]| (0..ns).any(|s| b[s * cells + k] > 0);
            let mut new_owner = if alive(&sc.bio) { owner[k] } else { 0 };

            // 6. Own cell: gauge toward the suitability, driven by pressure; seed rain.
            for (pi, pl) in PLAYERS.into_iter().enumerate() {
                if owner[k] != pl || new_owner != pl {
                    continue;
                }
                for s in species() {
                    let i = at(s);
                    if suitp[pi][s] <= 0 || (full[pi][s] && sc.bio[i] == 0) {
                        continue;
                    }
                    let gap = (suitp[pi][s] - sc.gauge[i]).max(0);
                    let dg = div(p.rate[s] * press[pi][s] * gap, ONE_I * ONE_I);
                    sc.gauge[i] += dg;
                    if dg > 0 {
                        sc.bio[i] += div(p.seed_b[s] * dg, ONE_I);
                    }
                }
            }

            // The cell becomes player pi+1's; each candidate starts at gauge pressure x suit,
            // established so the new owner can hold it.
            let arrive =
                |pi: usize, cand: &dyn Fn(usize) -> bool, gauge: &mut [i64], new: &mut [i64]| {
                    for s in species().filter(|&s| cand(s)) {
                        let i = at(s);
                        let g = div(press[pi][s] * suitp[pi][s], ONE_I);
                        gauge[i] = g;
                        new[i] = grow_div(p.seed_b[s] * g, ONE_I).max(p.est_thr[s]);
                    }
                };

            // 7. A smothered enemy cell flips to the attacker's species established next to it, of
            //    any level (D-225). Caps do not hold conquest back (D-113): they limit planting
            //    and expansion into free land.
            for (pi, pl) in PLAYERS.into_iter().enumerate() {
                if owner[k] == 3 - pl && new_owner == 0 && attack[pi] > 0 {
                    arrive(pi, &|s| seeds[pi][s], &mut sc.gauge, &mut sc.bio);
                    new_owner = pl;
                }
            }

            // 8. Empty cell: claim progress; the first player to complete takes it, a tie leaves
            //    it empty (D-225). Land grazed bare from the enemy is conquest: caps do not hold it
            //    back (D-113).
            if owner[k] == 0 {
                let barred = |pi: usize| st.lock[k] > 0 && st.lock_p[k] == PLAYERS[pi]; // D-098
                let won = |pi: usize| st.lock_p[k] == 3 - PLAYERS[pi];
                let cand =
                    |pi: usize, s: usize| seeds[pi][s] && (!full[pi][s] || won(pi)) && !barred(pi);
                let mut done = [false; 2];
                for pi in 0..2 {
                    let push = species()
                        .filter(|&s| cand(pi, s))
                        .map(|s| div(p.rate[s] * press[pi][s] * suitp[pi][s], ONE_I * ONE_I))
                        .max()
                        .unwrap_or(0);
                    sc.prog[pi][k] = st.prog[pi][k] + push;
                    done[pi] = sc.prog[pi][k] >= ONE_I && species().any(|s| cand(pi, s));
                }
                for pi in 0..2 {
                    if done[pi] && !done[1 - pi] {
                        arrive(pi, &|s| cand(pi, s), &mut sc.gauge, &mut sc.bio);
                        new_owner = PLAYERS[pi];
                    }
                }
                if done[0] || done[1] {
                    sc.prog[0][k] = 0;
                    sc.prog[1][k] = 0;
                }
            } else {
                sc.prog[0][k] = 0;
                sc.prog[1][k] = 0;
            }

            // 9. Biomass below 1 is gone, with its gauge; no biomass, no owner.
            for s in species() {
                if sc.bio[at(s)] < 1 {
                    sc.bio[at(s)] = 0;
                    sc.gauge[at(s)] = 0;
                }
            }
            sc.owner[k] = if alive(&sc.bio) { new_owner } else { 0 };
            st.dead[k] += dead;
        }

        self.hold_conquests(st, &sc.owner);
        std::mem::swap(&mut st.bio, &mut sc.bio);
        std::mem::swap(&mut st.gauge, &mut sc.gauge);
        std::mem::swap(&mut st.owner, &mut sc.owner);
        std::mem::swap(&mut st.soil, &mut sc.soil);
        std::mem::swap(&mut st.prog, &mut sc.prog);
        count_down(&mut st.lock);
        st.t += 1;
    }

    /// The readable original: one rule per numbered block over whole arrays, mirroring the
    /// prototype line by line. Test oracle for `step`.
    #[cfg(test)]
    #[allow(clippy::too_many_lines)]
    pub(crate) fn step_reference(&self, st: &mut FloraState) {
        let p = &self.p;
        let (n, ns) = (st.n, p.species());
        let cells = n * n;
        let at = |s: usize, k: usize| s * cells + k;
        let bio = &st.bio;
        let owner = &st.owner;
        let present = |s: usize, k: usize| bio[at(s, k)] > 0;
        let neighbours = |k: usize| {
            let (y, x) = ((k / n).cast_signed(), (k % n).cast_signed());
            DIRS.iter().filter_map(move |&(dy, dx)| {
                let (yy, xx) = (y + dy, x + dx);
                let inside =
                    (0..n.cast_signed()).contains(&yy) && (0..n.cast_signed()).contains(&xx);
                inside.then(|| (yy.cast_unsigned()) * n + xx.cast_unsigned())
            })
        };

        let cover: Vec<i64> = (0..ns * cells)
            .map(|i| div(bio[i] * ONE_I, p.kmax[i / cells]))
            .collect();
        let suit: Vec<i64> = (0..ns * cells)
            .map(|i| self.suitability(st, i / cells, i % cells))
            .collect();

        // 1. Shade: the cover of each upper stratum lowers the capacity of the species below it.
        let mut shade = vec![ONE_I; ns * cells];
        if p.shade {
            for u in 1..LEVELS {
                for k in 0..cells {
                    let cast = div(
                        p.strata[u]
                            .iter()
                            .map(|&j| p.cast[j] * cover[at(j, k)])
                            .sum(),
                        ONE_I,
                    );
                    for s in (0..ns).filter(|&s| usize::from(p.level[s]) <= u) {
                        let block = div(cast * (ONE_I - p.tol[s]), ONE_I);
                        shade[at(s, k)] = div(shade[at(s, k)] * (ONE_I - block).max(0), ONE_I);
                    }
                }
            }
        }

        // 2. Growth: logistic toward capacity = shade x gauge, with competition in a stratum.
        let mut growth = vec![0i64; ns * cells];
        for ids in &p.strata {
            for k in 0..cells {
                let total: i64 = ids.iter().map(|&j| cover[at(j, k)]).sum();
                for &s in ids {
                    let i = at(s, k);
                    if !present(s, k) {
                        continue;
                    }
                    let cap = div(shade[i] * st.gauge[i], ONE_I).max(1);
                    let comp = cover[i] + div(p.alpha * (total - cover[i]), ONE_I);
                    growth[i] = grow_div(p.rdt[s] * bio[i] * (cap - comp), cap * ONE_I);
                }
            }
        }

        // 3. Soil development (succession).
        let mut soil = st.soil.clone();
        if p.succession {
            for k in 0..cells {
                let gain = div((0..ns).map(|s| p.soil_dt[s] * cover[at(s, k)]).sum(), ONE_I);
                soil[k] = (soil[k] + gain).min(U16);
            }
        }

        // 4. Pressure (own + 4-neighbour cover, / 5), attack (the push of the neighbours over the
        //    cell's strength, D-225) and seeds (species established in a neighbour). A dead tree
        //    bars its former owner's trees (D-227).
        let sp = |pi: usize, s: usize, k: usize| {
            if self.tree_barred(st, s, k, PLAYERS[pi]) {
                0
            } else {
                suit[at(s, k)]
            }
        };
        let strength: Vec<i64> = self.strengths(st);
        let mut pressure = [vec![0i64; ns * cells], vec![0i64; ns * cells]];
        let mut attack = [vec![0i64; cells], vec![0i64; cells]];
        let mut seeds = [vec![false; ns * cells], vec![false; ns * cells]];
        let mut full = [vec![false; ns], vec![false; ns]];
        for (pi, &pl) in PLAYERS.iter().enumerate() {
            let cov = |s: usize, k: usize| if owner[k] == pl { cover[at(s, k)] } else { 0 };
            for k in 0..cells {
                for s in 0..ns {
                    let near: i64 = neighbours(k).map(|m| cov(s, m)).sum();
                    pressure[pi][at(s, k)] = div(cov(s, k) + near, 5).min(ONE_I);
                    let mine =
                        neighbours(k).any(|m| owner[m] == pl && bio[at(s, m)] >= p.est_thr[s]);
                    seeds[pi][at(s, k)] = mine && sp(pi, s, k) > 0;
                }
                if owner[k] == 3 - pl {
                    let push: i64 = neighbours(k)
                        .filter(|&m| owner[m] == pl)
                        .map(|m| strength[m])
                        .sum();
                    let held = st.lock[k] > 0 && st.lock_p[k] == pl; // D-230
                    attack[pi][k] = if held { 0 } else { (push - strength[k]).max(0) };
                }
            }
            // Species at their cell cap (D-029) cannot enter new cells this tick.
            for s in 0..ns {
                let held = (0..cells)
                    .filter(|&k| present(s, k) && owner[k] == pl)
                    .count();
                full[pi][s] = i64::try_from(held).unwrap_or(i64::MAX) >= p.cap_cells(s, cells);
            }
        }

        // 5. Growth, minus litter and smothering by the enemy's push; losses become litter.
        let mut new_bio = vec![0i64; ns * cells];
        let mut dead = vec![0i64; cells];
        for s in 0..ns {
            for k in 0..cells {
                let i = at(s, k);
                let litter = if present(s, k) {
                    div(p.litter[s] * bio[i], ONE_I)
                } else {
                    0
                };
                let grown = bio[i] + growth[i] - litter;
                let mut smothered = 0;
                for (pi, &pl) in PLAYERS.iter().enumerate() {
                    if owner[k] == 3 - pl && present(s, k) {
                        smothered += div(p.smother[s] * attack[pi][k], ONE_I);
                    }
                }
                let smothered = smothered.min(grown.max(0));
                dead[k] += litter + smothered + (-growth[i]).max(0);
                new_bio[i] = (grown - smothered).clamp(0, U16);
            }
        }
        let mut new_g: Vec<i64> = (0..ns * cells)
            .map(|i| if new_bio[i] > 0 { st.gauge[i] } else { 0 })
            .collect();
        let alive = |nb: &[i64], k: usize| (0..ns).any(|s| nb[at(s, k)] > 0);
        let mut new_owner: Vec<u8> = (0..cells)
            .map(|k| if alive(&new_bio, k) { owner[k] } else { 0 })
            .collect();
        let mut prog = st.prog.clone();

        // 6. Own cells: the gauge rises toward the suitability, driven by pressure; seed rain.
        for (pi, &pl) in PLAYERS.iter().enumerate() {
            for s in 0..ns {
                for k in 0..cells {
                    let i = at(s, k);
                    let own = owner[k] == pl
                        && new_owner[k] == pl
                        && sp(pi, s, k) > 0
                        && !(full[pi][s] && new_bio[i] == 0);
                    if !own {
                        continue;
                    }
                    let gap = (sp(pi, s, k) - new_g[i]).max(0);
                    let dg = div(p.rate[s] * pressure[pi][i] * gap, ONE_I * ONE_I);
                    new_g[i] += dg;
                    if dg > 0 {
                        new_bio[i] += div(p.seed_b[s] * dg, ONE_I);
                    }
                }
            }
        }

        // Cells of `mask` become player pi+1's; each candidate species starts at gauge pressure x
        // suit, established so the new owner can hold the cell.
        let arrive = |mask: &[bool],
                      pi: usize,
                      cand: &dyn Fn(usize, usize) -> bool,
                      new_bio: &mut Vec<i64>,
                      new_g: &mut Vec<i64>,
                      new_owner: &mut Vec<u8>| {
            for k in (0..cells).filter(|&k| mask[k]) {
                for s in (0..ns).filter(|&s| cand(s, k)) {
                    let i = at(s, k);
                    let g = div(pressure[pi][i] * sp(pi, s, k), ONE_I);
                    new_g[i] = g;
                    new_bio[i] = grow_div(p.seed_b[s] * g, ONE_I).max(p.est_thr[s]);
                }
                new_owner[k] = PLAYERS[pi];
            }
        }; // fmt: skip

        // 7. Smothered enemy cells flip to the attacker's neighbouring species, any level (D-225);
        //    caps do not hold conquest back (D-113).
        for (pi, &pl) in PLAYERS.iter().enumerate() {
            let won: Vec<bool> = (0..cells)
                .map(|k| owner[k] == 3 - pl && new_owner[k] == 0 && attack[pi][k] > 0)
                .collect();
            let cand = |s: usize, k: usize| seeds[pi][at(s, k)];
            arrive(&won, pi, &cand, &mut new_bio, &mut new_g, &mut new_owner);
        }

        // 8. Empty cells: claim progress builds up; the first player to complete takes the cell, a
        //    tie leaves it empty (D-225). Caps hold back expansion, not land grazed bare from the
        //    enemy (D-113).
        let barred = |pi: usize, k: usize| st.lock[k] > 0 && st.lock_p[k] == PLAYERS[pi];
        let won = |pi: usize, k: usize| st.lock_p[k] == 3 - PLAYERS[pi];
        let cand = |pi: usize, s: usize, k: usize| {
            seeds[pi][at(s, k)] && (!full[pi][s] || won(pi, k)) && !barred(pi, k)
        };
        let mut done = [vec![false; cells], vec![false; cells]];
        for pi in 0..2 {
            for k in 0..cells {
                if owner[k] != 0 {
                    prog[pi][k] = 0;
                    continue;
                }
                let push = (0..ns)
                    .map(|s| {
                        if cand(pi, s, k) {
                            div(
                                p.rate[s] * pressure[pi][at(s, k)] * sp(pi, s, k),
                                ONE_I * ONE_I,
                            )
                        } else {
                            0
                        }
                    })
                    .max()
                    .unwrap_or(0);
                prog[pi][k] += push;
                let any = (0..ns).any(|s| cand(pi, s, k));
                done[pi][k] = prog[pi][k] >= ONE_I && any;
            }
        }
        for pi in 0..2 {
            let q = 1 - pi;
            let win: Vec<bool> = (0..cells).map(|k| done[pi][k] && !done[q][k]).collect();
            let c = |s: usize, k: usize| cand(pi, s, k);
            arrive(&win, pi, &c, &mut new_bio, &mut new_g, &mut new_owner);
        }
        for k in 0..cells {
            if done[0][k] || done[1][k] {
                prog[0][k] = 0;
                prog[1][k] = 0;
            }
        }

        // 9. Biomass below 1 is gone, with its gauge.
        for i in 0..ns * cells {
            if new_bio[i] < 1 {
                new_bio[i] = 0;
                new_g[i] = 0;
            }
        }
        for k in 0..cells {
            if !alive(&new_bio, k) {
                new_owner[k] = 0;
            }
        }

        for k in 0..cells {
            st.dead[k] += dead[k];
        }
        self.hold_conquests(st, &new_owner);
        st.owner = new_owner;
        st.bio = new_bio;
        st.gauge = new_g;
        st.soil = soil;
        st.prog = prog;
        count_down(&mut st.lock);
        st.t += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flora() -> Flora {
        let b = Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .expect("data files load");
        Flora::new(FloraParams::from_balance(&b))
    }

    /// The fast step must equal the reference step exactly, on a busy map: soil gradient, all
    /// three strata for both players, fronts meeting, a small cap, 400 ticks.
    #[test]
    fn fast_step_equals_the_reference_step() {
        let mut fast = flora();
        let grasses = fast.p.index("grasses").unwrap();
        fast.p.cap[grasses] = 300 * ONE_I / 1600; // 300 of the 1600 cells: the cap rule runs too
        let slow = fast.clone();
        let n = 40;
        let mut st = FloraState::new(&fast.p, n);
        for (k, soil) in st.soil.iter_mut().enumerate() {
            *soil = i64::try_from(k / n).unwrap() * U16 / 39;
        }
        let side = |player: u8| -> Vec<usize> {
            (0..n * n)
                .filter(|k| {
                    if player == 1 {
                        k % n < 8
                    } else {
                        k % n >= n - 8
                    }
                })
                .collect()
        };
        for (player, names) in [
            (
                1u8,
                ["grasses", "wildflowers", "elder", "oak", "lichen_and_moss"],
            ),
            (2u8, ["grasses", "bramble", "hawthorn", "beech", "ferns"]),
        ] {
            for name in names {
                let s = fast.p.index(name).unwrap();
                fast.plant(&mut st, player, s, &side(player));
            }
        }
        let mut reference = st.clone();
        for t in 0..400 {
            fast.step(&mut st);
            slow.step_reference(&mut reference);
            if t % 5 == 4 {
                assert_eq!(st, reference, "tick {t}");
            }
        }
        let owned = st.owner.iter().filter(|&&o| o != 0).count();
        assert!(owned > 400, "fronts spread and meet: {owned}");
    }

    #[test]
    fn plant_respects_suitability_ownership_and_the_cell_cap() {
        let mut f = flora();
        let (grasses, oak) = (f.p.index("grasses").unwrap(), f.p.index("oak").unwrap());
        let mut st = FloraState::new(&f.p, 4);
        let all: Vec<usize> = (0..16).collect();
        assert_eq!(
            f.plant(&mut st, 1, oak, &all),
            0,
            "trees need developed soil"
        );
        assert_eq!(f.plant(&mut st, 1, grasses, &all[..8]), 8);
        assert_eq!(
            f.plant(&mut st, 2, grasses, &all),
            8,
            "P1's cells are not free"
        );
        f.p.cap[grasses] = 10 * ONE_I / 16; // 10 of the 16 cells
        let mut st = FloraState::new(&f.p, 4);
        assert_eq!(f.plant(&mut st, 1, grasses, &all), 10, "cell cap");
        assert_eq!(
            f.plant(&mut st, 1, grasses, &all[..3]),
            3,
            "replanting own cells is free"
        );
    }

    #[test]
    fn owned_cells_are_exactly_the_cells_with_biomass() {
        let mut f = flora();
        let n = 16;
        let mut st = FloraState::new(&f.p, n);
        st.soil.iter_mut().for_each(|s| *s = U16);
        let (grasses, elder) = (f.p.index("grasses").unwrap(), f.p.index("elder").unwrap());
        let left: Vec<usize> = (0..n * n).filter(|k| k % n < 3).collect();
        let right: Vec<usize> = (0..n * n).filter(|k| k % n >= n - 3).collect();
        f.plant(&mut st, 1, grasses, &left);
        f.plant(&mut st, 1, elder, &left);
        f.plant(&mut st, 2, grasses, &right);
        let before = st.owner.iter().filter(|&&o| o != 0).count();
        for _ in 0..200 {
            f.step(&mut st);
        }
        let cells = n * n;
        for k in 0..cells {
            let has_bio = (0..f.p.species()).any(|s| st.bio[s * cells + k] > 0);
            assert_eq!(st.owner[k] != 0, has_bio, "cell {k}");
        }
        assert!(
            st.owner.iter().filter(|&&o| o != 0).count() > before,
            "plants spread"
        );
    }

    /// Rock and deep water refuse plants; shallows take them, but slowly (D-084).
    #[test]
    fn rock_and_deep_water_refuse_plants_and_shallows_slow_them() {
        let f = flora();
        let grasses = f.p.index("grasses").unwrap();
        let mut st = FloraState::new(&f.p, 4);
        st.soil.fill(U16);
        st.ground[0] = crate::terrain::ROCK;
        st.ground[1] = crate::terrain::DEEP;
        st.ground[2] = crate::terrain::SHALLOW;
        st.water[2] = U16; // shallows are full of water
        assert_eq!(
            f.plant(&mut st, 1, grasses, &[0, 1]),
            0,
            "no roots in rock or deep water"
        );
        let (land, shallow) = (
            f.suitability(&st, grasses, 3),
            f.suitability(&st, grasses, 2),
        );
        assert!(
            shallow > 0 && shallow * 3 < land,
            "shallows: slow, not closed ({shallow} vs {land})"
        );
    }

    /// The displayed push (D-076) is the step's attack: positive exactly on the cells a higher
    /// enemy level smothers, zero behind the front and on same-level fronts.
    /// D-113: a forest edge at its species caps still conquers enemy grass (flips) and takes
    /// grazed-bare land once its lockout is over (claims); caps only limit planting and spread on
    /// own land.
    #[test]
    fn capped_forest_fronts_advance_on_grass() {
        let mut f = flora();
        let [oak, hawthorn, grasses] =
            ["oak", "hawthorn", "grasses"].map(|n| f.p.index(n).unwrap());
        let n = 12;
        // P1 holds half the map under oak and hawthorn, at both caps; P2 the other half in grass.
        f.p.cap[oak] = ONE_I / 2;
        f.p.cap[hawthorn] = ONE_I / 2;
        let mut st = FloraState::new(&f.p, n);
        st.soil.fill(U16);
        for k in 0..n * n {
            let mine = k % n < n / 2;
            st.owner[k] = if mine { 1 } else { 2 };
            for s in if mine {
                vec![oak, hawthorn]
            } else {
                vec![grasses]
            } {
                st.bio[s * n * n + k] = f.p.kmax[s];
                st.gauge[s * n * n + k] = ONE_I;
            }
        }
        // One enemy cell next to the forest was grazed bare: neutral, P2's lockout running out.
        let bare = 3 * n + n / 2;
        st.owner[bare] = 0;
        st.bio[grasses * n * n + bare] = 0;
        (st.lock[bare], st.lock_p[bare]) = (1, 2);
        let mut reference = st.clone();
        let held = |st: &FloraState| st.owner.iter().filter(|&&o| o == 1).count();
        for _ in 0..120 {
            f.step(&mut st);
            f.step_reference(&mut reference);
        }
        assert_eq!(st, reference, "the fast step matches the reference");
        assert!(
            held(&st) >= n * n / 2 + 2 * n,
            "the forest advances: {} cells",
            held(&st)
        );
        assert_eq!(st.owner[bare], 1, "the grazed-bare cell is taken");
    }

    /// D-239: plants have their own ground: lichen beats ferns on dry ground, ferns beat lichen on
    /// moist ground.
    #[test]
    fn dry_and_wet_ground_favour_different_plants() {
        let f = flora();
        let (lichen, ferns) = (
            f.p.index("lichen_and_moss").unwrap(),
            f.p.index("ferns").unwrap(),
        );
        let mut st = FloraState::new(&f.p, 2);
        st.soil.fill(U16);
        (st.water[0], st.water[1]) = (U16 / 5, U16 * 7 / 10);
        let suit = |s, k| f.suitability(&st, s, k);
        assert!(suit(lichen, 0) > suit(ferns, 0), "dry: lichen");
        assert!(suit(ferns, 1) > suit(lichen, 1), "moist: ferns");
    }

    /// D-127, D-227: dead trees. Killed trees leave standing dead wood (the rest falls as litter)
    /// and the cell turns neutral if nothing else grows there; its former owner's trees do not
    /// take root while the wood stands, the enemy's may; it rots to litter, and the bar lifts.
    #[test]
    fn dead_trees_stand_block_trees_and_rot_away() {
        let f = flora();
        let (oak, grasses) = (f.p.index("oak").unwrap(), f.p.index("grasses").unwrap());
        let n = 4;
        let mut st = FloraState::new(&f.p, n);
        st.soil.fill(U16);
        let k = 5;
        st.owner[k] = 1;
        st.bio[oak * n * n + k] = 10_000;
        assert!(f.suitability(&st, oak, k) > 0);
        assert!(f.kill_trees(&mut st, k));
        assert_eq!(st.snag_owner[k], 1, "the stand was P1's");
        let standing = 10_000 * f.p.wood_share / ONE_I;
        assert!((st.snag[k] - standing).abs() <= 1 && st.snag[k] + st.dead[k] == 10_000);
        assert_eq!(
            st.owner[k], 0,
            "nothing else grew there: the cell turns neutral"
        );
        assert!(
            f.tree_barred(&st, oak, k, 1),
            "not P1's trees under its dead one"
        );
        assert!(!f.tree_barred(&st, oak, k, 2), "P2's trees may grow there");
        assert!(
            !f.tree_barred(&st, grasses, k, 1),
            "herbs may grow around it"
        );
        assert_eq!(
            f.plant(&mut st, 1, oak, &[k]),
            0,
            "P1 cannot replant its oak"
        );
        assert!(!f.kill_trees(&mut st, k), "no trees left to kill");
        let mut ticks = 0;
        while st.snag[k] > 0 {
            f.rot_deadwood(&mut st);
            ticks += 1;
            assert!(ticks < 100_000, "it rots away");
        }
        assert_eq!(st.dead[k], 10_000, "all of it ends as litter");
        assert!(!f.tree_barred(&st, oak, k, 1), "trees may grow again");
    }

    /// A map split at column `split`: P1 on the left, P2 on the right, each cell at full cover
    /// with `left` / `right` species, on developed soil.
    fn split_map(f: &Flora, n: usize, split: usize, left: &[&str], right: &[&str]) -> FloraState {
        let mut st = FloraState::new(&f.p, n);
        st.soil.fill(U16);
        for k in 0..n * n {
            let (player, names) = if k % n < split { (1, left) } else { (2, right) };
            st.owner[k] = player;
            for name in names {
                let s = f.p.index(name).unwrap();
                st.bio[s * n * n + k] = f.p.kmax[s];
                st.gauge[s * n * n + k] = ONE_I;
            }
        }
        st
    }

    const MEADOW: [&str; 2] = ["grasses", "lichen_and_moss"];

    /// D-236: a full cell's strength is fertility x biodiversity (species: plants established
    /// and the owner's resident animals), the biodiversity factor capped at `div_cap`.
    #[test]
    fn strength_is_fertility_times_capped_biodiversity() {
        let mut f = flora();
        let n = 4;
        let mut st = split_map(&f, n, 2, &MEADOW, &MEADOW);
        let fert = ONE_I + f.p.fert; // full soil
        let d = |species: i64| (ONE_I + f.p.div * species).min(f.p.div_cap);
        assert_eq!(f.species_count(&st, 0), 2);
        assert_eq!(f.strength(&st, 0), div(fert * d(2), ONE_I));
        f.residents = vec![[0; 2]; n * n];
        f.residents[0] = [3, 1]; // P1's three species count on P1's cell, P2's one does not
        assert_eq!(f.species_count(&st, 0), 5);
        st.soil[0] = 0;
        assert_eq!(f.strength(&st, 0), d(5), "no fertility: x 1");
        f.residents[0] = [20, 0];
        assert_eq!(f.strength(&st, 0), f.p.div_cap, "biodiversity capped");
    }

    /// D-236: strength follows the layers' fill (grazing lowers it), a young layer adds to it
    /// (no dip), a canopy raises it, and an enemy canopy next door shades an open cell down
    /// while a cell under its own canopy barely feels it.
    #[test]
    fn strength_follows_fill_canopy_and_side_shade() {
        let f = flora();
        let n = 4;
        let id = |name: &str| f.p.index(name).unwrap();
        let base = split_map(&f, n, 2, &MEADOW, &MEADOW);
        let full = f.strength(&base, 0);

        let mut grazed = base.clone();
        for s in MEADOW.map(id) {
            grazed.bio[s * n * n] = f.p.kmax[s] / 3; // the layer at 2/3
        }
        assert!(f.strength(&grazed, 0) < full, "grazed: weaker");

        let mut young = base.clone();
        young.bio[id("ferns") * n * n] = f.p.est_thr[id("ferns")];
        assert!(f.strength(&young, 0) > full, "a young layer adds strength");

        let mut forest = base.clone();
        forest.bio[id("oak") * n * n] = f.p.kmax[id("oak")];
        let canopy = f.strength(&forest, 0);
        let d3 = (ONE_I + 3 * f.p.div).min(f.p.div_cap);
        assert!(
            canopy > div(div(full, ONE_I + 2 * f.p.div) * d3, ONE_I),
            "a canopy adds more than its species"
        );

        // k = 1 is P1's front cell; its enemy neighbour k = 2 grows a dense canopy.
        let (k, e) = (1, 2);
        let mut shaded = base.clone();
        for t in ["oak", "hawthorn"].map(id) {
            shaded.bio[t * n * n + e] = f.p.kmax[t];
        }
        let open_drop = f.strength(&base, k) - f.strength(&shaded, k);
        assert!(
            open_drop > f.strength(&base, k) / 4,
            "open ground: shaded down"
        );
        let (mut own, mut both) = (base.clone(), shaded);
        own.bio[id("beech") * n * n + k] = f.p.kmax[id("beech")];
        both.bio[id("beech") * n * n + k] = f.p.kmax[id("beech")];
        let canopy_drop = f.strength(&own, k) - f.strength(&both, k);
        assert!(
            canopy_drop * 4 < open_drop,
            "own canopy: barely ({canopy_drop} vs {open_drop})"
        );
    }

    /// D-225: a straight front between equal sides holds; fertility tips it.
    #[test]
    fn an_equal_front_holds_and_fertility_tips_it() {
        let f = flora();
        let n = 6;
        let mut st = split_map(&f, n, 3, &MEADOW, &MEADOW);
        assert!(f.push(&st).iter().all(|&v| v == 0), "equal: no push");
        let before = st.owner.clone();
        let mut f2 = f.clone();
        for _ in 0..60 {
            f2.step(&mut st);
        }
        assert_eq!(st.owner, before, "the front holds");

        // P2's soil is poorer: P1's front cells are stronger and push.
        let mut st = split_map(&f, n, 3, &MEADOW, &MEADOW);
        for k in (0..n * n).filter(|k| k % n >= 3) {
            st.soil[k] = 0;
        }
        let push = f.push(&st);
        for k in 0..n * n {
            match k % n {
                3 => assert!(push[k] > 0, "P2's front cell is pushed"),
                _ => assert_eq!(push[k], 0, "nothing else"),
            }
        }
    }

    /// D-225: a bulge whose tip touches three equal enemy cells falls (their strengths add up);
    /// the side that wins loses nothing.
    #[test]
    fn a_bulge_tip_touching_three_cells_falls() {
        let mut f = flora();
        let n = 5;
        let mut st = split_map(&f, n, n, &MEADOW, &[]); // all P1
        let col = |k: usize| k % n == 2 && k / n >= 2; // P2's tongue, rows 2..4 of column 2
        let (g, l) = (
            f.p.index("grasses").unwrap(),
            f.p.index("lichen_and_moss").unwrap(),
        );
        for k in (0..n * n).filter(|&k| col(k)) {
            st.owner[k] = 2;
            for s in [g, l] {
                st.bio[s * n * n + k] = f.p.kmax[s];
            }
        }
        let tip = 2 * n + 2;
        let push = f.push(&st);
        assert!(
            push[tip] > push[tip + n] && push[tip + n] > 0,
            "3 neighbours against the tip, 2 against the tongue's middle"
        );
        let mut reference = st.clone();
        for _ in 0..60 {
            f.step(&mut st);
            f.step_reference(&mut reference);
        }
        assert_eq!(st, reference, "the fast step matches the reference");
        assert_eq!(st.owner[tip], 1, "the tip fell");
        assert!(
            (0..n * n).filter(|&k| !col(k)).all(|k| st.owner[k] == 1),
            "P1 lost nothing"
        );
    }

    /// D-225: grazing a species out of a front lowers its strength, and a balanced front breaks:
    /// a grazed front cell falls to the side next to it. (Holding it is another matter: a cell
    /// just taken has its species at the threshold and is the front's weakest point.)
    #[test]
    fn grazing_a_species_out_breaks_a_balanced_front() {
        let mut f = flora();
        let n = 5;
        let mut st = split_map(&f, n, 2, &MEADOW, &MEADOW);
        let l = f.p.index("lichen_and_moss").unwrap();
        let k = 2 * n + 2; // a P2 front cell
        let graze = |st: &mut FloraState| {
            for k in (0..n * n).filter(|&k| st.owner[k] == 2) {
                st.bio[l * n * n + k] = 0; // the grazers keep eating it, on all of P2's land
                st.gauge[l * n * n + k] = 0;
            }
        };
        graze(&mut st);
        assert!(f.push(&st)[k] > 0, "1 species against 2");
        let mut fell = false;
        for _ in 0..40 {
            graze(&mut st);
            f.step(&mut st);
            fell |= st.owner[k] == 1;
        }
        assert!(fell, "the grazed front cell fell");
    }

    /// D-232: the cell card's numbers: each owned cell's strength and the enemy's summed push;
    /// the display push is their difference, at least 0.
    #[test]
    fn fronts_give_strength_and_the_enemy_push() {
        let f = flora();
        let n = 4;
        let st = split_map(&f, n, 2, &MEADOW, &["grasses"]);
        let (two, one) = (f.strength(&st, 0), f.strength(&st, 3));
        let fronts = f.fronts(&st);
        assert_eq!(
            fronts[n + 1],
            [two, one],
            "P1's front cell, one P2 neighbour"
        );
        assert_eq!(
            fronts[n + 2],
            [one, two],
            "P2's front cell, one P1 neighbour"
        );
        assert_eq!(fronts[n], [two, 0], "behind the front: no push");
        assert_eq!(f.push(&st)[n + 2], two - one);
        assert_eq!(f.push(&st)[n + 1], 0);
    }

    /// D-230: a conquered cell is held against its former owner: no push while the hold runs,
    /// even out-numbered; then the push is back. Both steps agree.
    #[test]
    fn a_conquered_cell_is_held_against_its_former_owner() {
        let mut f = flora();
        let n = 6;
        // P1 strong on the left (3 species), P2 weak on the right (1): P2's front falls.
        let mut st = split_map(
            &f,
            n,
            3,
            &["grasses", "lichen_and_moss", "wildflowers"],
            &["grasses"],
        );
        let mut reference = st.clone();
        let k = 2 * n + 3; // a P2 front cell
        let mut taken = None;
        for t in 0..60 {
            f.step(&mut st);
            f.step_reference(&mut reference);
            if taken.is_none() && st.owner[k] == 1 {
                taken = Some(t);
                assert_eq!(
                    (st.lock_p[k], st.lock[k]),
                    (2, f.p.hold - 1),
                    "held against P2"
                );
            }
        }
        assert!(taken.is_some(), "the cell fell");
        assert_eq!(st, reference, "the fast step matches the reference");

        // A held P1 cell inside strong P2 land: no push; once the hold ends, pushed.
        let mut st = split_map(
            &f,
            n,
            0,
            &[],
            &["grasses", "lichen_and_moss", "wildflowers"],
        );
        let g = f.p.index("grasses").unwrap();
        let k = 2 * n + 2;
        for s in 0..f.p.species() {
            st.bio[s * n * n + k] = 0;
        }
        st.owner[k] = 1;
        st.bio[g * n * n + k] = f.p.kmax[g];
        (st.lock[k], st.lock_p[k]) = (5, 2);
        assert_eq!(f.push(&st)[k], 0, "held: no push");
        for _ in 0..3 {
            f.step(&mut st);
        }
        assert_eq!(st.owner[k], 1, "still P1's while held");
        st.lock[k] = 0;
        assert!(f.push(&st)[k] > 0, "the hold is over: out-numbered, pushed");
    }

    /// D-227: the enemy's trees take over a cell whose stand died; its former owner's do not.
    #[test]
    fn enemy_trees_replace_a_dead_stand() {
        let mut f = flora();
        let n = 3;
        let mut st = split_map(&f, n, 0, &[], &["grasses", "oak"]); // all P2, grass under oak
        let (g, oak) = (f.p.index("grasses").unwrap(), f.p.index("oak").unwrap());
        let k = 4; // the centre: P1's grass and oak
        st.owner[k] = 1;
        for s in [g, oak] {
            st.bio[s * n * n + k] = f.p.kmax[s];
        }
        let push: i64 = [1, 3, 5, 7].map(|m| f.strength(&st, m)).iter().sum();
        assert_eq!(f.push(&st)[k], push - f.strength(&st, k));
        assert!(f.kill_trees(&mut st, k), "P1's stand dies");
        assert_eq!(st.owner[k], 1, "its grass still holds the cell, for now");
        let mut grew = false;
        for _ in 0..80 {
            f.step(&mut st);
            grew |= st.owner[k] == 2 && st.bio[oak * n * n + k] > 0 && st.snag[k] > 0;
        }
        assert!(grew, "P2 took the cell and its oak grew by the dead one");
    }
}
