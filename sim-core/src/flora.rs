//! Flora cell model (gamerules §2–§3; D-019, D-022, D-024, D-025, D-029), the Rust port of the
//! prototype's quant mode (`tools/prototype/flora.py`, `Flora.step`). The port is exact: the
//! parity test replays a prototype fixture and demands identical state at every checkpoint.
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

/// Plant rules and species stats, converted once to fixed-point (INSTRUCTIONS §4). Per-species
/// vectors are indexed by species id (file order of `species.toml`).
#[derive(Clone, Debug)]
pub struct FloraParams {
    pub names: Vec<String>,
    pub level: Vec<u8>,
    /// Species ids of each stratum (L1, L2, L3).
    pub strata: [Vec<usize>; 3],
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
    pub contested_cells: bool,
}

/// The prototype's `round_half_away`: `sign(x) * floor(|x| + 0.5)`, used for every load-time
/// conversion so both sides produce the same integers.
#[allow(clippy::float_arithmetic, clippy::cast_possible_truncation)]
fn round(x: f64) -> i64 {
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
        let mut strata: [Vec<usize>; 3] = [vec![], vec![], vec![]];
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
            contested_cells: f.contested_cells,
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
            .i64(self.plant_g)
            .i64(self.soil_ramp)
            .i64(self.water0)
            .i64(self.light0);
        h.bytes(&[
            u8::from(self.succession),
            u8::from(self.shade),
            u8::from(self.contested_cells),
        ]);
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
    /// Claim progress on empty cells, per player (Q16).
    pub prog: [Vec<i64>; 2],
    /// Dead biomass (litter), eaten by decomposers.
    pub dead: Vec<i64>,
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
            prog: [vec![0; cells], vec![0; cells]],
            dead: vec![0; cells],
            t: 0,
        }
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
    }
}

impl Flora {
    #[must_use]
    pub fn new(p: FloraParams) -> Flora {
        Flora {
            p,
            scratch: Scratch::default(),
        }
    }

    /// The single site modifier (gamerules §2.3): f_dev x f_soil x f_water x f_light, 0..=ONE.
    #[must_use]
    pub fn suitability(&self, st: &FloraState, s: usize, k: usize) -> i64 {
        let p = &self.p;
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
            suit = div(suit * response(st.water[k], p.w_opt[s], p.w_tol[s]), ONE_I);
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
            let free = st.owner[k] == 0 || st.owner[k] == player;
            if !free || self.suitability(st, s, k) <= 0 {
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

        // Global pass: cover, presence bitmask, dominant level, cells held per species.
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

            // 1-2. Shade and logistic growth with competition, for the species present here.
            let casts = [1usize, 2].map(|u| {
                div(
                    p.strata[u].iter().map(|&j| p.cast[j] * cover[at(j)]).sum(),
                    ONE_I,
                )
            });
            let totals: [i64; 3] =
                [0, 1, 2].map(|l| p.strata[l].iter().map(|&j| cover[at(j)]).sum());
            for s in species().filter(|&s| bio[at(s)] > 0) {
                let mut shade = ONE_I;
                if p.shade {
                    for (u, cast) in [1usize, 2].into_iter().zip(casts) {
                        if usize::from(p.level[s]) <= u {
                            let block = div(cast * (ONE_I - p.tol[s]), ONE_I);
                            shade = div(shade * (ONE_I - block).max(0), ONE_I);
                        }
                    }
                }
                let i = at(s);
                let cap = div(shade * st.gauge[i], ONE_I).max(1);
                let total = totals[usize::from(p.level[s]) - 1];
                let comp = cover[i] + div(p.alpha * (total - cover[i]), ONE_I);
                growth[s] = grow_div(p.rdt[s] * bio[i] * (cap - comp), cap * ONE_I);
            }

            // 3. Soil development.
            if p.succession {
                let gain = div(species().map(|s| p.soil_dt[s] * cover[at(s)]).sum(), ONE_I);
                sc.soil[k] = (st.soil[k] + gain).min(U16);
            }

            // 4. Pressure, seeds and attack of each player.
            let dom = sc.dom[k];
            let can = |s: usize| p.level[s] > dom && suit[s] > 0;
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
                    seeds[pi][s] = mine && suit[s] > 0;
                }
                for &m in &nbr {
                    if m != NONE {
                        let m = m as usize;
                        attack[pi] += species()
                            .map(|s| if can(s) { cov(s, m) } else { 0 })
                            .max()
                            .unwrap_or(0);
                    }
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
                    if suit[s] <= 0 || (full[pi][s] && sc.bio[i] == 0) {
                        continue;
                    }
                    let gap = (suit[s] - sc.gauge[i]).max(0);
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
                        let g = div(press[pi][s] * suit[s], ONE_I);
                        gauge[i] = g;
                        new[i] = grow_div(p.seed_b[s] * g, ONE_I).max(p.est_thr[s]);
                    }
                };

            // 7. A smothered enemy cell flips to the attacker's higher-level species.
            for (pi, pl) in PLAYERS.into_iter().enumerate() {
                if owner[k] == 3 - pl && new_owner == 0 && attack[pi] > 0 {
                    arrive(
                        pi,
                        &|s| can(s) && seeds[pi][s] && !full[pi][s],
                        &mut sc.gauge,
                        &mut sc.bio,
                    );
                    new_owner = pl;
                }
            }

            // 8. Empty cell: claim progress; the first player to complete takes it.
            if owner[k] == 0 {
                let cand = |pi: usize, s: usize| seeds[pi][s] && !full[pi][s];
                let (mut done, mut lvl) = ([false; 2], [0u8; 2]);
                for pi in 0..2 {
                    let push = species()
                        .filter(|&s| cand(pi, s))
                        .map(|s| div(p.rate[s] * press[pi][s] * suit[s], ONE_I * ONE_I))
                        .max()
                        .unwrap_or(0);
                    sc.prog[pi][k] = st.prog[pi][k] + push;
                    done[pi] = sc.prog[pi][k] >= ONE_I && species().any(|s| cand(pi, s));
                    lvl[pi] = species()
                        .filter(|&s| cand(pi, s))
                        .map(|s| p.level[s])
                        .max()
                        .unwrap_or(0);
                }
                for pi in 0..2 {
                    let q = 1 - pi;
                    let both = done[0] && done[1];
                    if (done[pi] && !done[q]) || (p.contested_cells && both && lvl[pi] > lvl[q]) {
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

        std::mem::swap(&mut st.bio, &mut sc.bio);
        std::mem::swap(&mut st.gauge, &mut sc.gauge);
        std::mem::swap(&mut st.owner, &mut sc.owner);
        std::mem::swap(&mut st.soil, &mut sc.soil);
        std::mem::swap(&mut st.prog, &mut sc.prog);
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
            for u in 1..3usize {
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

        // 4. Pressure (own + 4-neighbour cover, / 5), attack (best higher-level neighbour cover,
        //    summed over neighbours) and seeds (species established in a neighbour).
        let dom = self.dominant(st);
        let can = |s: usize, k: usize| p.level[s] > dom[k] && suit[at(s, k)] > 0;
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
                    seeds[pi][at(s, k)] = mine && suit[at(s, k)] > 0;
                }
                attack[pi][k] = neighbours(k)
                    .map(|m| {
                        (0..ns)
                            .map(|s| if can(s, k) { cov(s, m) } else { 0 })
                            .max()
                            .unwrap_or(0)
                    })
                    .sum();
            }
            // Species at their cell cap (D-029) cannot enter new cells this tick.
            for s in 0..ns {
                let held = (0..cells)
                    .filter(|&k| present(s, k) && owner[k] == pl)
                    .count();
                full[pi][s] = i64::try_from(held).unwrap_or(i64::MAX) >= p.cap_cells(s, cells);
            }
        }

        // 5. Growth, minus litter and smothering by higher enemy levels; losses become litter.
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
                        && suit[i] > 0
                        && !(full[pi][s] && new_bio[i] == 0);
                    if !own {
                        continue;
                    }
                    let gap = (suit[i] - new_g[i]).max(0);
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
                    let g = div(pressure[pi][i] * suit[i], ONE_I);
                    new_g[i] = g;
                    new_bio[i] = grow_div(p.seed_b[s] * g, ONE_I).max(p.est_thr[s]);
                }
                new_owner[k] = PLAYERS[pi];
            }
        }; // fmt: skip

        // 7. Smothered enemy cells flip to the attacker's higher-level species.
        for (pi, &pl) in PLAYERS.iter().enumerate() {
            let won: Vec<bool> = (0..cells)
                .map(|k| owner[k] == 3 - pl && new_owner[k] == 0 && attack[pi][k] > 0)
                .collect();
            let cand = |s: usize, k: usize| can(s, k) && seeds[pi][at(s, k)] && !full[pi][s];
            arrive(&won, pi, &cand, &mut new_bio, &mut new_g, &mut new_owner);
        }

        // 8. Empty cells: claim progress builds up; the first player to complete takes the cell.
        let cand = |pi: usize, s: usize, k: usize| seeds[pi][at(s, k)] && !full[pi][s];
        let mut done = [vec![false; cells], vec![false; cells]];
        let mut lvl = [vec![0u8; cells], vec![0u8; cells]];
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
                                p.rate[s] * pressure[pi][at(s, k)] * suit[at(s, k)],
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
                lvl[pi][k] = (0..ns)
                    .map(|s| if cand(pi, s, k) { p.level[s] } else { 0 })
                    .max()
                    .unwrap_or(0);
            }
        }
        for pi in 0..2 {
            let q = 1 - pi;
            let win: Vec<bool> = (0..cells)
                .map(|k| {
                    let both = done[0][k] && done[1][k];
                    (done[pi][k] && !done[q][k])
                        || (p.contested_cells && both && lvl[pi][k] > lvl[q][k])
                })
                .collect();
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
        st.owner = new_owner;
        st.bio = new_bio;
        st.gauge = new_g;
        st.soil = soil;
        st.prog = prog;
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
            (1u8, ["grasses", "clover", "elder", "oak", "moss"]),
            (2u8, ["grasses", "bramble", "hawthorn", "beech", "lichen"]),
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
}
