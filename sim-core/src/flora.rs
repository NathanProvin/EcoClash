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
    /// Max cells per player (D-029).
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
            cap: sp.iter().map(|s| i64::from(s.cap)).collect(),
            level,
            succession: f.succession,
            shade: f.shade,
            contested_cells: f.contested_cells,
        }
    }

    #[must_use]
    pub fn species(&self) -> usize {
        self.names.len()
    }

    #[must_use]
    pub fn index(&self, name: &str) -> Option<usize> {
        self.names.iter().position(|n| n == name)
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
}

impl Flora {
    #[must_use]
    pub fn new(p: FloraParams) -> Flora {
        Flora { p }
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
        suit = div(suit * response(st.water[k], p.w_opt[s], p.w_tol[s]), ONE_I);
        div(suit * response(st.light[k], p.l_opt[s], p.l_tol[s]), ONE_I)
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
        let mut room = p.cap[s] - i64::try_from(held).unwrap_or(i64::MAX);
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

    /// Advance one flora tick (tools/prototype/flora.py, `Flora.step`, quant mode).
    #[allow(clippy::too_many_lines)] // one rule per numbered block, mirroring the prototype
    pub fn step(&self, st: &mut FloraState) {
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
                full[pi][s] = i64::try_from(held).unwrap_or(i64::MAX) >= p.cap[s];
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
        f.p.cap[grasses] = 10;
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
        let f = flora();
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
