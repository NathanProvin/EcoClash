//! Map generation (D-083, D-096, D-102): a map type drawn per seed (plains, meadows, hills,
//! mountains, canyon, lakeland, marsh, lake...), then relief with valleys and cliffs, water laid
//! out along the topography, rock and moisture, from the match seed.
//!
//! Integer only, on its own PCG32 stream (the world's random sequence is untouched), so every
//! peer builds the same map. Every map has 180-degree rotational symmetry (cell `k` and cell
//! `n² - 1 - k` match): both players see the same land, wherever they spawn.
//! - Relief: value-noise octaves, minus winding valleys (where a coarse noise crosses its middle),
//!   then terraced: plateaus joined by steep steps, the cliffs.
//! - The map type (`[[terrain.map_types]]`, D-102) sets the relief's height and ruggedness
//!   (terraces, valleys, cliffs), the rock, and the water: none, a river crossing the map, a
//!   central lake fed by two streams, or the lowest ground flooded (lakes, marshes), plus ponds.
//!   Rivers take the cheapest way through low ground (Dijkstra on height), so they run along the
//!   valleys; ponds sit in basins.
//!   Water cells are shallows that animals and, slowly, plants can cross; deep pools block.
//! - Rock: bands on the steep steps, broken by gaps (cliffs with passes), and outcrops on the
//!   high ground. The two home clearings stay dry and rock-free, and every walkable cell stays
//!   reachable on foot. The rules for each ground class live in `flora.rs` and `fauna.rs`.
//! - Moisture, into the flora `water` field: highest in the water, falling with the distance to it
//!   and with height: valleys and banks wet, hills dry.

#![allow(clippy::needless_range_loop)] // grids indexed by cell, with their mirrors

use std::cmp::Reverse;
use std::collections::{BinaryHeap, VecDeque};

use crate::balance::{Balance, Water};
use crate::fixed::{ONE, div_round};
use crate::hash::Hasher;
use crate::rng::Pcg32;

/// Ground classes (`FloraState::ground`).
pub const LAND: u8 = 0;
pub const SHALLOW: u8 = 1;
pub const DEEP: u8 = 2;
pub const ROCK: u8 = 3;

/// Water layouts (D-096, D-102), set by the map type.
pub const NO_WATER: u8 = 0;
pub const RIVER: u8 = 1;
pub const LAKE: u8 = 2;
pub const FLOOD: u8 = 3;

const ONE_I: i64 = ONE as i64;
const HALF: i64 = ONE_I / 2;
const U16: i64 = 65_535;
/// The terrain's own PCG32 stream.
const STREAM: u64 = 0x7e22_a1d0;
/// Deep pools on a river at least this many path cells apart.
const DEEP_GAP: usize = 4;
/// Lattice spacing (cells) of the noise that breaks rock into clusters and cliffs into bands.
const ROCK_CELLS: i64 = 3;
/// Path cost of a step (Dijkstra), on top of the height of the cell entered; much dearer near a
/// home, so water keeps clear of the clearings.
const STEP_COST: i64 = 2_000;
const HOME_COST: i64 = 4 * U16;
/// Path cost added per cell closer than `RIM` to the map edge, so water crosses the map instead
/// of running along its rim.
const RIM_COST: i64 = U16;
const RIM: usize = 4;

#[must_use]
pub fn is_water(g: u8) -> bool {
    g == SHALLOW || g == DEEP
}

/// The generator's settings, converted once (Q16 shares, u16 heights, cells).
#[derive(Clone, Debug)]
pub struct TerrainParams {
    pub generate: bool,
    cells: [i64; 3],
    weights: [i64; 3],
    valley_cells: i64,
    valley_width: i64,
    steep: i64,
    cliff_drop: i64,
    cliff_gaps: i64,
    width: i64,
    deep: i64,
    pond_radius: u32,
    lake_radius: u32,
    home_clear: i64,
    water_level: i64,
    bank_rise: i64,
    dry: i64,
    wet: i64,
    damp: i64,
    damp_cells: i64,
    bank_cells: i64,
    /// The map types (D-102), converted.
    pub types: Vec<MapTypeParams>,
}

/// One map type (D-102), converted: Q16 shares, counts, the water layout.
#[derive(Clone, Debug)]
pub struct MapTypeParams {
    pub name: String,
    weight: u32,
    relief: i64,
    terraces: i64,
    valley_depth: i64,
    cliffs: bool,
    rock: i64,
    pub water: u8,
    ponds: u32,
    flood: i64,
    flood_deep: i64,
}

impl TerrainParams {
    #[must_use]
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    pub fn from_balance(b: &Balance) -> TerrainParams {
        let t = &b.terrain;
        #[allow(clippy::cast_possible_truncation)] // bounded by validation
        let r = |v: f64| v.round() as i64;
        let (one, u16f) = (f64::from(ONE), 65_535.0);
        TerrainParams {
            generate: t.generate,
            cells: t.noise_cells.map(i64::from),
            weights: t.noise_weights.map(|w| r(w * one)),
            valley_cells: i64::from(t.valley_cells),
            valley_width: r(t.valley_width * one),
            steep: r(t.cliff_steepness * one),
            cliff_drop: r(t.cliff_drop * u16f),
            cliff_gaps: r(t.cliff_gaps * one),
            width: r(t.river_width * one),
            deep: r(t.deep_share * one),
            pond_radius: t.pond_radius,
            lake_radius: t.lake_radius,
            home_clear: i64::from(t.home_clear),
            water_level: r(t.water_level * u16f),
            bank_rise: r(t.bank_rise * u16f),
            dry: r(t.moisture_dry * u16f),
            wet: r(t.moisture_wet * u16f),
            damp: r(t.moisture_noise * u16f),
            damp_cells: i64::from(t.moisture_cells),
            bank_cells: i64::from(t.bank_cells),
            types: t
                .map_types
                .iter()
                .map(|m| MapTypeParams {
                    name: m.name.clone(),
                    weight: m.weight,
                    relief: r(m.relief * one),
                    terraces: i64::from(m.terraces),
                    valley_depth: r(m.valley_depth * one),
                    cliffs: m.cliffs,
                    rock: r(m.rock_share * one),
                    water: match m.water {
                        Water::None => NO_WATER,
                        Water::River => RIVER,
                        Water::Lake => LAKE,
                        Water::Flood => FLOOD,
                    },
                    ponds: m.ponds,
                    flood: r(m.flood * one),
                    flood_deep: r(m.flood_deep * one),
                })
                .collect(),
        }
    }

    /// The converted values, for the balance hash.
    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(u64::from(self.generate))
            .i64s(&self.cells)
            .i64s(&self.weights)
            .i64s(&[
                self.valley_cells,
                self.valley_width,
                self.steep,
                self.cliff_drop,
                self.cliff_gaps,
                self.width,
                self.deep,
                i64::from(self.pond_radius),
                i64::from(self.lake_radius),
                self.home_clear,
                self.water_level,
                self.bank_rise,
                self.dry,
                self.wet,
                self.damp,
                self.damp_cells,
                self.bank_cells,
            ]);
        for t in &self.types {
            h.u64(t.name.len() as u64).bytes(t.name.as_bytes()).i64s(&[
                i64::from(t.weight),
                t.relief,
                t.terraces,
                t.valley_depth,
                i64::from(t.cliffs),
                t.rock,
                i64::from(t.water),
                i64::from(t.ponds),
                t.flood,
                t.flood_deep,
            ]);
        }
    }
}

/// A generated map, cell by cell (row-major): elevation 0..=65535, ground class, moisture in the
/// flora's u16 `water` units; and the map type drawn for it (index in `TerrainParams::types`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Map {
    pub elevation: Vec<i64>,
    pub ground: Vec<u8>,
    pub water: Vec<i64>,
    pub kind: usize,
}

/// The two home clearings of an `n x n` map: (n / 4, n / 4) and its mirror.
#[must_use]
pub fn homes(n: usize) -> [usize; 2] {
    let b = n / 4;
    let k = b * n + b;
    [k, n * n - 1 - k]
}

/// Generate the map of an `n x n` match from its seed.
#[must_use]
pub fn generate(p: &TerrainParams, n: usize, seed: u64) -> Map {
    let cells = n * n;
    let mirror = |k: usize| cells - 1 - k;
    let mut rng = Pcg32::new(seed, STREAM);

    // The map type (D-102), by weight.
    let total_weight: u32 = p.types.iter().map(|t| t.weight).sum::<u32>().max(1);
    let mut draw = rng.below(total_weight);
    let kind = p
        .types
        .iter()
        .position(|t| {
            let hit = draw < t.weight;
            draw = draw.saturating_sub(t.weight);
            hit
        })
        .unwrap_or(0);
    let t = &p.types[kind];

    // Relief: weighted octaves of value noise, minus the valleys, stretched to 0..=U16, made
    // symmetric, then terraced.
    let total: i64 = p.weights.iter().sum::<i64>().max(1);
    let mut elevation = vec![0i64; cells];
    for (&s, &w) in p.cells.iter().zip(&p.weights) {
        let layer = noise(n, s, &mut rng);
        for k in 0..cells {
            elevation[k] += layer[k] * w;
        }
    }
    for e in &mut elevation {
        *e = div_round(*e, total);
    }
    let fold = noise(n, p.valley_cells, &mut rng);
    for k in 0..cells {
        let d = (fold[k] - HALF).abs();
        if d < p.valley_width {
            let v = ONE_I - div_round(d * ONE_I, p.valley_width.max(1)); // 1 on the valley line
            elevation[k] -= div_round(div_round(v * v, ONE_I) * t.valley_depth, ONE_I);
        }
    }
    let (lo, hi) = (min(&elevation), max(&elevation));
    for e in &mut elevation {
        *e = div_round((*e - lo) * U16, (hi - lo).max(1));
    }
    for k in 0..cells {
        let v = (elevation[k] + elevation[mirror(k)]) / 2;
        (elevation[k], elevation[mirror(k)]) = (v, v);
    }
    if t.terraces > 1 {
        // Three parts terrace, one part the raw relief: plateaus keep some roll, so water still
        // finds a winding way across them.
        for e in &mut elevation {
            *e = (3 * terrace(*e, t.terraces, p.steep) + *e) / 4;
        }
    }
    // The type's relief height: flat plains to full mountains.
    for e in &mut elevation {
        *e = div_round(*e * t.relief, ONE_I);
    }
    let level = div_round(p.water_level * t.relief, ONE_I); // water beds
    let rise = div_round(p.bank_rise * t.relief, ONE_I).max(1); // banks, per cell

    // Water, along the topography.
    let home = homes(n);
    let near_home = |k: usize| {
        home.iter()
            .any(|&h| dist2(k, h, n) <= (p.home_clear + 2).pow(2))
    };
    let mut ground = vec![LAND; cells];
    match t.water {
        RIVER => {
            let s = source(n, &elevation, &near_home, &mut rng);
            let path = valley_path(n, &elevation, &near_home, s, |k| k == mirror(s));
            lay(p, n, &path, p.width, &mut rng, &mut ground);
        }
        LAKE => {
            let r = i64::from(p.lake_radius);
            let r = r - i64::from(rng.below(2)).min(r - 1); // radius - 1 or radius
            let c = i64::try_from(n - 1).unwrap_or(0); // the centre, doubled
            for k in 0..cells {
                let (y, x) = (
                    i64::try_from(k / n).unwrap_or(0),
                    i64::try_from(k % n).unwrap_or(0),
                );
                let d2 = (2 * y - c).pow(2) + (2 * x - c).pow(2); // 4 x squared distance
                if d2 <= 4 * r * r {
                    ground[k] = if d2 <= 4 * (r - 1) * (r - 1) {
                        DEEP
                    } else {
                        SHALLOW
                    };
                }
            }
            let s = source(n, &elevation, &near_home, &mut rng);
            let lake = ground.clone();
            let path = valley_path(n, &elevation, &near_home, s, |k| is_water(lake[k]));
            lay(p, n, &path, ONE_I, &mut rng, &mut ground);
        }
        FLOOD => flood_low(
            n,
            t.flood,
            t.flood_deep,
            &elevation,
            &near_home,
            &mut ground,
        ),
        _ => {}
    }
    ponds(p, n, t.ponds, &mut rng, &elevation, &mut ground);
    for k in 0..cells {
        let g = ground[k].max(ground[mirror(k)]); // DEEP > SHALLOW > LAND
        (ground[k], ground[mirror(k)]) = (g, g);
    }

    // Homes: dry, flatter, rock-free.
    let clear = |k: usize| {
        home.iter()
            .any(|&h| dist2(k, h, n) <= p.home_clear * p.home_clear)
    };
    let disc: Vec<usize> = (0..cells)
        .filter(|&k| dist2(k, home[0], n) <= p.home_clear * p.home_clear)
        .collect();
    let mean = disc.iter().map(|&k| elevation[k]).sum::<i64>()
        / i64::try_from(disc.len().max(1)).unwrap_or(1);
    for k in (0..cells).filter(|&k| clear(k)) {
        ground[k] = LAND;
        elevation[k] = (elevation[k] + mean) / 2;
    }

    // Valleys: water beds at the water level, banks rising away from them.
    let to_water = bfs(n, |k| is_water(ground[k]));
    for k in 0..cells {
        let bank = level + to_water[k] * rise;
        elevation[k] = if is_water(ground[k]) {
            level
        } else {
            elevation[k].min(bank).max(level + 1)
        };
    }

    // Rock: cliffs on the steep steps (broken by a fine, symmetric noise into bands with
    // passes), then outcrops on the land scoring highest on height plus that noise.
    let mut grain = noise(n, ROCK_CELLS, &mut rng);
    for k in 0..cells {
        let v = (grain[k] + grain[mirror(k)]) / 2;
        (grain[k], grain[mirror(k)]) = (v, v);
    }
    let drop = |k: usize| {
        neighbours(k, n)
            .map(|m| elevation[k] - elevation[m])
            .max()
            .unwrap_or(0)
    };
    let cliffs: Vec<usize> = (0..cells)
        .filter(|&k| {
            t.cliffs
                && ground[k] == LAND
                && !clear(k)
                && drop(k) >= p.cliff_drop
                && grain[k] >= p.cliff_gaps
        })
        .collect();
    for k in cliffs {
        ground[k] = ROCK;
    }
    let score = |k: usize| elevation[k] + div_round(grain[k] * U16, ONE_I);
    let mut high: Vec<i64> = (0..cells)
        .filter(|&k| ground[k] == LAND && !clear(k))
        .map(score)
        .collect();
    high.sort_unstable();
    if t.rock > 0 && !high.is_empty() {
        let len = i64::try_from(high.len()).unwrap_or(i64::MAX);
        let at = usize::try_from(len - 1 - div_round((len - 1) * t.rock, ONE_I)).unwrap_or(0);
        let threshold = high[at.min(high.len() - 1)];
        for k in 0..cells {
            if ground[k] == LAND && !clear(k) && score(k) >= threshold {
                ground[k] = ROCK;
            }
        }
    }

    connect(n, &mut ground, home);

    // Moisture: water cells full; land from dry (its highest) to wet (its lowest), plus or minus
    // a symmetric noise (wet hollows, dry knolls; D-239), wetter near water. Heights count
    // relative to this map's own relief. The noise is the generator's last draw, so the relief,
    // water and rock of a seed do not depend on it.
    let mut damp = noise(n, p.damp_cells, &mut rng);
    for k in 0..cells {
        let v = (damp[k] + damp[mirror(k)]) / 2;
        (damp[k], damp[mirror(k)]) = (v, v);
    }
    let to_water = bfs(n, |k| is_water(ground[k]));
    let land: Vec<i64> = (0..cells)
        .filter(|&k| !is_water(ground[k]))
        .map(|k| elevation[k])
        .collect();
    let (low, high) = (min(&land), max(&land));
    let water = (0..cells)
        .map(|k| {
            if is_water(ground[k]) {
                return U16;
            }
            let wet = div_round((high - elevation[k]) * U16, (high - low).max(1)); // 1 at the lowest
            let base = p.dry + div_round((p.wet - p.dry) * wet, U16);
            let base = (base + div_round(p.damp * (2 * damp[k] - ONE_I), ONE_I)).clamp(0, U16);
            let near = (p.bank_cells - to_water[k]).max(0);
            base + div_round((p.wet - base) * near, p.bank_cells)
        })
        .collect();
    Map {
        elevation,
        ground,
        water,
        kind,
    }
}

/// Flood the lowest ground (D-102): the lowest `share` (Q16) of the map outside the homes goes
/// under water, its lowest `deep` part deep. Lakes and marshes follow the topography.
fn flood_low(
    n: usize,
    share: i64,
    deep: i64,
    elevation: &[i64],
    near_home: &dyn Fn(usize) -> bool,
    ground: &mut [u8],
) {
    let open: Vec<usize> = (0..n * n).filter(|&k| !near_home(k)).collect();
    let mut heights: Vec<i64> = open.iter().map(|&k| elevation[k]).collect();
    heights.sort_unstable();
    if heights.is_empty() || share <= 0 {
        return;
    }
    let len = i64::try_from(heights.len()).unwrap_or(1);
    let at = |q: i64| heights[usize::try_from(div_round((len - 1) * q, ONE_I)).unwrap_or(0)];
    let (water, below) = (at(share), at(div_round(share * deep, ONE_I)));
    for k in open {
        if deep > 0 && elevation[k] <= below {
            ground[k] = ground[k].max(DEEP);
        } else if elevation[k] <= water {
            ground[k] = ground[k].max(SHALLOW);
        }
    }
}

/// Terraces: `levels` plateaus; within each band the height steepens around its middle by
/// `steep` (Q16), so plateaus meet at steep steps.
fn terrace(e: i64, levels: i64, steep: i64) -> i64 {
    let band = (U16 / levels).max(1);
    let i = (e / band).min(levels - 1);
    let t = div_round((e - i * band) * ONE_I, band);
    let t = (div_round((t - HALF) * steep, ONE_I) + HALF).clamp(0, ONE_I);
    (i * band + div_round(t * band, ONE_I)).min(U16)
}

/// Where a river or stream starts: a border cell in the first half of the map (the caller
/// mirrors), in the middle of its side and away from the homes, drawn among the higher half of
/// them: water comes down from the hills.
fn source(
    n: usize,
    elevation: &[i64],
    near_home: &dyn Fn(usize) -> bool,
    rng: &mut Pcg32,
) -> usize {
    let cells = n * n;
    let mut edge: Vec<usize> = (0..cells)
        .filter(|&k| k < cells - 1 - k)
        .filter(|&k| {
            // On an edge, in the middle half of its side: away from the corners.
            let (y, x) = (k / n, k % n);
            let mid = |v: usize| v >= n / 4 && v < n - n / 4;
            ((y == 0 || y == n - 1) && mid(x)) || ((x == 0 || x == n - 1) && mid(y))
        })
        .filter(|&k| !near_home(k))
        .collect();
    edge.sort_by_key(|&k| (Reverse(elevation[k]), k));
    let top = edge.len().div_ceil(2).max(1);
    let pick = usize::try_from(rng.below(u32::try_from(top).unwrap_or(1))).unwrap_or(0);
    edge.get(pick).copied().unwrap_or(0)
}

/// The cheapest 4-neighbour path from `from` to the first cell where `goal(k)`, each step
/// costing the height of the cell entered (plus a step cost, and much more near a home): the way
/// water would run, along the valleys. Ties break on the lower cell index.
fn valley_path(
    n: usize,
    elevation: &[i64],
    near_home: &dyn Fn(usize) -> bool,
    from: usize,
    goal: impl Fn(usize) -> bool,
) -> Vec<usize> {
    let cells = n * n;
    let mut cost = vec![i64::MAX; cells];
    let mut back = vec![usize::MAX; cells];
    let mut heap = BinaryHeap::from([Reverse((0i64, from))]);
    cost[from] = 0;
    while let Some(Reverse((c, k))) = heap.pop() {
        if c > cost[k] {
            continue;
        }
        if goal(k) {
            let mut path = vec![k];
            let mut at = k;
            while back[at] != usize::MAX {
                at = back[at];
                path.push(at);
            }
            return path;
        }
        for m in neighbours(k, n) {
            let edge = (m / n).min(m % n).min(n - 1 - m / n).min(n - 1 - m % n);
            let step = STEP_COST
                + elevation[m]
                + if near_home(m) { HOME_COST } else { 0 }
                + i64::try_from(RIM.saturating_sub(edge)).unwrap_or(0) * RIM_COST;
            if c + step < cost[m] {
                cost[m] = c + step;
                back[m] = k;
                heap.push(Reverse((c + step, m)));
            }
        }
    }
    vec![from]
}

/// Lay water along a path: cells within half of `width` (Q16 cells) of a path cell become
/// shallows; a wide river gets the odd deep pool at its centre.
fn lay(
    p: &TerrainParams,
    n: usize,
    path: &[usize],
    width: i64,
    rng: &mut Pcg32,
    ground: &mut [u8],
) {
    let half = width / 2;
    let r = half / ONE_I;
    let (ni, mut last_deep) = (i64::try_from(n).unwrap_or(0), None::<usize>);
    for (step, &k) in path.iter().enumerate() {
        let (cy, cx) = (
            i64::try_from(k / n).unwrap_or(0),
            i64::try_from(k % n).unwrap_or(0),
        );
        for gy in (cy - r).max(0)..=(cy + r).min(ni - 1) {
            for gx in (cx - r).max(0)..=(cx + r).min(ni - 1) {
                let d2 = ((gy - cy).pow(2) + (gx - cx).pow(2)) * ONE_I * ONE_I;
                if d2 <= half * half {
                    let q = usize::try_from(gy * ni + gx).unwrap_or(0);
                    ground[q] = ground[q].max(SHALLOW);
                }
            }
        }
        let apart = last_deep.is_none_or(|d| step - d >= DEEP_GAP);
        if width >= 2 * ONE_I && apart && i64::from(rng.below(1 << 16)) < p.deep {
            ground[k] = DEEP;
            last_deep = Some(step);
        }
    }
}

/// Up to `count` ponds in the first half of the map (the caller mirrors them): in the lowest
/// basins away from other water and the homes, radius 1..=pond_radius, a deep centre from
/// radius 2.
fn ponds(
    p: &TerrainParams,
    n: usize,
    count: u32,
    rng: &mut Pcg32,
    elevation: &[i64],
    ground: &mut [u8],
) {
    let cells = n * n;
    let to_water = bfs(n, |k| is_water(ground[k]));
    let reach = i64::from(p.pond_radius);
    let home = homes(n);
    let mut spots: Vec<usize> = (0..cells)
        .filter(|&k| k < cells - 1 - k)
        .filter(|&k| to_water[k] >= reach + 3)
        .filter(|&k| {
            let edge = (k / n).min(k % n).min(n - 1 - k / n).min(n - 1 - k % n);
            i64::try_from(edge).unwrap_or(0) > reach // inland: not cut by the map edge
        })
        .filter(|&k| {
            home.iter()
                .all(|&h| dist2(k, h, n) > (p.home_clear + reach + 2).pow(2))
        })
        .collect();
    spots.sort_by_key(|&k| (elevation[k], k));
    let mut placed: Vec<usize> = Vec::new();
    for k in spots {
        if placed.len() >= usize::try_from(count).unwrap_or(0) {
            break;
        }
        let apart = |q: usize| {
            dist2(k, q, n) > (2 * reach + 3).pow(2)
                && dist2(k, cells - 1 - q, n) > (2 * reach + 3).pow(2)
        };
        if !placed.iter().all(|&q| apart(q)) || dist2(k, cells - 1 - k, n) <= (2 * reach + 3).pow(2)
        {
            continue;
        }
        let r = 1 + i64::from(rng.below(p.pond_radius.max(1)));
        for q in 0..cells {
            let d2 = dist2(q, k, n);
            if d2 <= r * r {
                ground[q] = ground[q].max(if r >= 2 && d2 <= (r - 1) * (r - 1) {
                    DEEP
                } else {
                    SHALLOW
                });
            }
        }
        placed.push(k);
    }
}

/// Value noise in 0..ONE on a lattice every `s` cells, bilinear with a smoothstep fade.
fn noise(n: usize, s: i64, rng: &mut Pcg32) -> Vec<i64> {
    let s = s.max(1);
    let side = usize::try_from(i64::try_from(n).unwrap_or(0) / s + 2).unwrap_or(2);
    let lattice: Vec<i64> = (0..side * side)
        .map(|_| i64::from(rng.below(1 << 16)))
        .collect();
    let at = |gy: usize, gx: usize| lattice[gy.min(side - 1) * side + gx.min(side - 1)];
    let fade = |f: i64| div_round(div_round(f * f, ONE_I) * (3 * ONE_I - 2 * f), ONE_I);
    let lerp = |a: i64, b: i64, t: i64| a + div_round((b - a) * t, ONE_I);
    (0..n * n)
        .map(|k| {
            let (y, x) = (
                i64::try_from(k / n).unwrap_or(0),
                i64::try_from(k % n).unwrap_or(0),
            );
            let (gy, gx) = (
                usize::try_from(y / s).unwrap_or(0),
                usize::try_from(x / s).unwrap_or(0),
            );
            let (fy, fx) = (fade(y % s * ONE_I / s), fade(x % s * ONE_I / s));
            let top = lerp(at(gy, gx), at(gy, gx + 1), fx);
            let bottom = lerp(at(gy + 1, gx), at(gy + 1, gx + 1), fx);
            lerp(top, bottom, fy)
        })
        .collect()
}

/// Every land or shallow cell must be reachable on foot from the first home: if the second home is
/// not, open a straight corridor between them; then cells still cut off become rock.
fn connect(n: usize, ground: &mut [u8], home: [usize; 2]) {
    let walk = |g: u8| g == LAND || g == SHALLOW;
    let mut seen = flood(n, ground, home[0], walk);
    if !seen[home[1]] {
        let (a, b) = (home[0], home[1]);
        let (ay, ax, by, bx) = (a / n, a % n, b / n, b % n);
        let len = ay.abs_diff(by).max(ax.abs_diff(bx)).max(1);
        for i in 0..=len {
            let y = (ay * (len - i) + by * i) / len;
            let x = (ax * (len - i) + bx * i) / len;
            for k in [y * n + x, (y * n + x).saturating_add(1).min(n * n - 1)] {
                ground[k] = match ground[k] {
                    ROCK => LAND,
                    DEEP => SHALLOW,
                    g => g,
                };
            }
        }
        seen = flood(n, ground, home[0], walk);
    }
    for k in 0..ground.len() {
        if walk(ground[k]) && !seen[k] {
            ground[k] = ROCK;
        }
    }
}

/// Cells reachable from `start` through cells where `pass(ground)` (4-neighbour).
fn flood(n: usize, ground: &[u8], start: usize, pass: impl Fn(u8) -> bool) -> Vec<bool> {
    let mut seen = vec![false; n * n];
    let mut todo = VecDeque::from([start]);
    seen[start] = true;
    while let Some(k) = todo.pop_front() {
        for m in neighbours(k, n) {
            if !seen[m] && pass(ground[m]) {
                seen[m] = true;
                todo.push_back(m);
            }
        }
    }
    seen
}

/// Distance in steps (4-neighbour) to the nearest cell where `source(k)`; far away if none.
fn bfs(n: usize, source: impl Fn(usize) -> bool) -> Vec<i64> {
    let far = i64::try_from(n * 2).unwrap_or(i64::MAX);
    let mut d = vec![far; n * n];
    let mut todo = VecDeque::new();
    for k in 0..n * n {
        if source(k) {
            d[k] = 0;
            todo.push_back(k);
        }
    }
    while let Some(k) = todo.pop_front() {
        for m in neighbours(k, n) {
            if d[m] > d[k] + 1 {
                d[m] = d[k] + 1;
                todo.push_back(m);
            }
        }
    }
    d
}

fn neighbours(k: usize, n: usize) -> impl Iterator<Item = usize> {
    let (y, x) = (k / n, k % n);
    [
        (y > 0).then(|| k - n),
        (y + 1 < n).then(|| k + n),
        (x > 0).then(|| k - 1),
        (x + 1 < n).then(|| k + 1),
    ]
    .into_iter()
    .flatten()
}

fn dist2(a: usize, b: usize, n: usize) -> i64 {
    let (dy, dx) = ((a / n).abs_diff(b / n), (a % n).abs_diff(b % n));
    i64::try_from(dy * dy + dx * dx).unwrap_or(i64::MAX)
}

fn min(v: &[i64]) -> i64 {
    v.iter().copied().min().unwrap_or(0)
}

fn max(v: &[i64]) -> i64 {
    v.iter().copied().max().unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params() -> TerrainParams {
        let b = Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .expect("data files load");
        TerrainParams::from_balance(&b)
    }

    const N: usize = 32;

    #[test]
    fn maps_are_symmetric_and_reproducible() {
        let p = params();
        for seed in 1..9 {
            let m = generate(&p, N, seed);
            let cells = N * N;
            for k in 0..cells {
                assert_eq!(m.ground[k], m.ground[cells - 1 - k], "seed {seed} cell {k}");
                assert_eq!(m.elevation[k], m.elevation[cells - 1 - k]);
                assert_eq!(m.water[k], m.water[cells - 1 - k]);
            }
            assert_eq!(m, generate(&p, N, seed), "same seed, same map");
        }
        assert_ne!(
            generate(&p, N, 1),
            generate(&p, N, 2),
            "another seed, another map"
        );
    }

    #[test]
    fn homes_are_clear_and_every_walkable_cell_is_reachable() {
        let p = params();
        for n in [24, N, 44] {
            // the menu's map sizes (D-103)
            for seed in 1..25 {
                let m = generate(&p, n, seed);
                let home = homes(n);
                for k in 0..n * n {
                    assert_eq!(m.ground[k], m.ground[n * n - 1 - k], "{n}: symmetric");
                    if dist2(k, home[0], n) <= p.home_clear * p.home_clear {
                        assert_eq!(m.ground[k], LAND, "{n}, seed {seed}: home cell {k}");
                    }
                }
                let wet = flood(n, &m.ground, home[0], |g| g == LAND || g == SHALLOW);
                for k in 0..n * n {
                    if m.ground[k] == LAND || m.ground[k] == SHALLOW {
                        assert!(wet[k], "{n}, seed {seed}: cell {k} reachable on foot");
                    }
                }
            }
        }
    }

    /// D-102: every map type turns up; each shapes the map as its settings say: plains are
    /// flat and dry (no water at all), mountains high, rivers reach the edges, lakes sit at the
    /// centre, floods cover their share of the map; cliffs appear on cliff types only.
    #[test]
    fn map_types_vary_and_shape_the_map() {
        let p = params();
        let mut seen = vec![0; p.types.len()];
        let mut cliffs = 0;
        for seed in 1..121 {
            let m = generate(&p, N, seed);
            let t = &p.types[m.kind];
            seen[m.kind] += 1;
            let water = |k: usize| is_water(m.ground[k]);
            let wet = (0..N * N).filter(|&k| water(k)).count();
            let top = max(&m.elevation);
            assert!(
                top <= div_round(U16 * t.relief, ONE_I),
                "seed {seed}: relief"
            );
            if t.water == NO_WATER && t.ponds == 0 {
                assert_eq!(wet, 0, "seed {seed}: {} is dry", t.name);
            }
            let edge = (0..N * N).filter(|&k| {
                let (y, x) = (k / N, k % N);
                y == 0 || x == 0 || y == N - 1 || x == N - 1
            });
            match t.water {
                RIVER => assert!(edge.filter(|&k| water(k)).count() >= 2, "seed {seed}"),
                LAKE => assert!(water((N / 2) * N + N / 2), "seed {seed}: a central lake"),
                FLOOD => assert!(
                    wet * 2 >= usize::try_from(t.flood * 1024 / ONE_I).unwrap(),
                    "seed {seed}: flooded"
                ),
                _ => {}
            }
            let steep = (0..N * N)
                .filter(|&k| m.ground[k] == ROCK)
                .filter(|&k| {
                    neighbours(k, N).any(|q| m.elevation[k] - m.elevation[q] >= p.cliff_drop)
                })
                .count();
            if !t.cliffs {
                assert_eq!(steep, 0, "seed {seed}: no cliffs on {}", t.name);
            }
            cliffs += steep;
        }
        assert!(
            seen.iter().all(|&c| c > 0),
            "every map type appears: {seen:?}"
        );
        assert!(cliffs > 0, "cliffs on the rugged types");
    }

    /// Rivers take the low ground: across a valley, the path keeps to its floor.
    #[test]
    fn valley_paths_follow_the_low_ground() {
        let n: usize = 20;
        let elevation: Vec<i64> = (0..n * n)
            .map(|k| i64::try_from((k % n).abs_diff(12)).unwrap() * 3000)
            .collect();
        let path = valley_path(n, &elevation, &|_| false, 3, |k| k == (n - 1) * n + 17);
        // Away from the rim (dearer, D-096), the path keeps to the floor of the valley.
        let inside: Vec<usize> = path
            .iter()
            .copied()
            .filter(|&k| (6..14).contains(&(k / n)))
            .collect();
        assert!(
            !inside.is_empty() && inside.iter().all(|&k| k % n == 12),
            "{inside:?}"
        );
    }

    /// Prints a map: `~` shallows, `#` deep, `^` rock, `H` homes, digits land height.
    /// Run: `cargo test -p sim-core -- --ignored --nocapture map_preview`.
    #[test]
    #[ignore = "preview, not a check"]
    fn map_preview() {
        let (p, n) = (params(), 32);
        for seed in 1..=10 {
            let m = generate(&p, n, seed);
            let home = homes(n);
            println!("seed {seed}, {}", p.types[m.kind].name);
            for y in 0..n {
                let row: String = (0..n)
                    .map(|x| {
                        let k = y * n + x;
                        match m.ground[k] {
                            _ if home.contains(&k) => 'H',
                            SHALLOW => '~',
                            DEEP => '#',
                            ROCK => '^',
                            _ => char::from(
                                b'0' + u8::try_from(m.elevation[k] * 9 / U16).unwrap_or(9),
                            ),
                        }
                    })
                    .collect();
                println!("{row}");
            }
        }
    }

    #[test]
    fn water_rocks_and_moisture_are_in_place() {
        let p = params();
        for seed in 1..25 {
            let m = generate(&p, N, seed);
            let level = div_round(p.water_level * p.types[m.kind].relief, ONE_I);
            let rock = m.ground.iter().filter(|&&g| g == ROCK).count();
            assert!(rock < N * N / 4, "seed {seed}: rock {rock}");
            for k in 0..N * N {
                if is_water(m.ground[k]) {
                    assert_eq!(m.water[k], U16);
                    assert_eq!(m.elevation[k], level, "water beds share one level");
                } else {
                    assert!((0..=U16).contains(&m.water[k]), "land moisture in range");
                    assert!(m.elevation[k] > level, "land stands above the water");
                }
            }
        }
    }

    /// D-239: land moisture spans more than half the range on every map (relief, banks and the
    /// moisture noise), so dry- and wet-ground plants both find their place.
    #[test]
    fn land_moisture_varies() {
        let p = params();
        for seed in 1..13 {
            let m = generate(&p, N, seed);
            let land: Vec<i64> = (0..N * N)
                .filter(|&k| !is_water(m.ground[k]))
                .map(|k| m.water[k])
                .collect();
            let (lo, hi) = (min(&land), max(&land));
            assert!(hi - lo > U16 / 2, "seed {seed}: moisture spans {lo}..{hi}");
        }
    }
}
