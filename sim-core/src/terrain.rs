//! Map generation (D-083): relief, a river, ponds, rock outcrops and moisture, from the match seed.
//!
//! Integer only, on its own PCG32 stream (the world's random sequence is untouched), so every
//! peer builds the same map. Every map has 180-degree rotational symmetry (cell `k` and cell
//! `n² - 1 - k` match), so both homes see the same land. The river runs along the anti-diagonal,
//! between the two homes: the natural front line. Its cells are shallows that animals and, slowly,
//! plants can cross; deep pools, deep pond centres and rock outcrops block (the rules live in
//! `flora.rs` and `fauna.rs`). Moisture, into the flora `water` field, is highest in the water
//! and falls with the distance to it and with height: valleys and banks wet, hills dry.

#![allow(clippy::needless_range_loop)] // grids indexed by cell, with their mirrors

use std::collections::VecDeque;

use crate::balance::Balance;
use crate::fixed::{ONE, div_round};
use crate::hash::Hasher;
use crate::rng::Pcg32;

/// Ground classes (`FloraState::ground`).
pub const LAND: u8 = 0;
pub const SHALLOW: u8 = 1;
pub const DEEP: u8 = 2;
pub const ROCK: u8 = 3;

const ONE_I: i64 = ONE as i64;
const U16: i64 = 65_535;
/// The terrain's own PCG32 stream.
const STREAM: u64 = 0x7e22_a1d0;
/// River path steps per cell, and deep pools at least this many steps apart.
const STEPS_PER_CELL: i64 = 2;
const DEEP_GAP: i64 = 8;
/// The river's sideways swing: lattice spacing (steps) and a ramp from the centre (steps), so
/// the two mirrored halves meet at the centre.
const MEANDER_STEPS: i64 = 6;
const MEANDER_RAMP: i64 = 8;
/// Lattice spacing (cells) of the noise that breaks rock outcrops into clusters.
const ROCK_CELLS: i64 = 3;

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
    width: i64,
    meander: i64,
    deep: i64,
    ponds: u32,
    pond_radius: u32,
    rock: i64,
    home_clear: i64,
    water_level: i64,
    bank_rise: i64,
    dry: i64,
    wet: i64,
    bank_cells: i64,
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
            width: r(t.river_width * one),
            meander: r(t.river_meander * one),
            deep: r(t.deep_share * one),
            ponds: t.ponds,
            pond_radius: t.pond_radius,
            rock: r(t.rock_share * one),
            home_clear: i64::from(t.home_clear),
            water_level: r(t.water_level * u16f),
            bank_rise: r(t.bank_rise * u16f),
            dry: r(t.moisture_dry * u16f),
            wet: r(t.moisture_wet * u16f),
            bank_cells: i64::from(t.bank_cells),
        }
    }

    /// The converted values, for the balance hash.
    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(u64::from(self.generate))
            .i64s(&self.cells)
            .i64s(&self.weights)
            .i64s(&[
                self.width,
                self.meander,
                self.deep,
                i64::from(self.ponds),
                i64::from(self.pond_radius),
                self.rock,
                self.home_clear,
                self.water_level,
                self.bank_rise,
                self.dry,
                self.wet,
                self.bank_cells,
            ]);
    }
}

/// A generated map, cell by cell (row-major): elevation 0..=65535, ground class, moisture in the
/// flora's u16 `water` units.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Map {
    pub elevation: Vec<i64>,
    pub ground: Vec<u8>,
    pub water: Vec<i64>,
}

/// The two homes of an `n x n` map: (n / 4, n / 4) and its mirror, as in the openings.
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

    // Relief: weighted octaves of value noise, stretched to 0..=U16, made symmetric.
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
    let (lo, hi) = (min(&elevation), max(&elevation));
    for e in &mut elevation {
        *e = div_round((*e - lo) * U16, (hi - lo).max(1));
    }
    for k in 0..cells {
        let v = (elevation[k] + elevation[mirror(k)]) / 2;
        (elevation[k], elevation[mirror(k)]) = (v, v);
    }

    let mut ground = vec![LAND; cells];
    river(p, n, &mut rng, &mut ground);
    ponds(p, n, &mut rng, &elevation, &mut ground);
    for k in 0..cells {
        let g = ground[k].max(ground[mirror(k)]); // DEEP > SHALLOW > LAND
        (ground[k], ground[mirror(k)]) = (g, g);
    }

    // Homes: dry, flatter, rock-free.
    let home = homes(n);
    let clear = |k: usize| {
        home.iter()
            .any(|&h| dist2(k, h, n) <= p.home_clear * p.home_clear)
    };
    let disc: Vec<usize> = (0..cells)
        .filter(|&k| clear(k) && dist2(k, home[0], n) <= p.home_clear * p.home_clear)
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
        let bank = p.water_level + to_water[k] * p.bank_rise;
        elevation[k] = if is_water(ground[k]) {
            p.water_level
        } else {
            elevation[k].min(bank).max(p.water_level + 1)
        };
    }

    // Rock outcrops: the land scoring highest on height plus a fine, symmetric noise, so they
    // break into several clusters on the high ground (outside the homes).
    let mut grain = noise(n, ROCK_CELLS, &mut rng);
    for k in 0..cells {
        let v = (grain[k] + grain[mirror(k)]) / 2;
        (grain[k], grain[mirror(k)]) = (v, v);
    }
    let score = |k: usize| elevation[k] + div_round(grain[k] * U16, ONE_I);
    let mut high: Vec<i64> = (0..cells)
        .filter(|&k| ground[k] == LAND && !clear(k))
        .map(score)
        .collect();
    high.sort_unstable();
    if p.rock > 0 && !high.is_empty() {
        let len = i64::try_from(high.len()).unwrap_or(i64::MAX);
        let at = usize::try_from(len - 1 - div_round((len - 1) * p.rock, ONE_I)).unwrap_or(0);
        let threshold = high[at.min(high.len() - 1)];
        for k in 0..cells {
            if ground[k] == LAND && !clear(k) && score(k) >= threshold {
                ground[k] = ROCK;
            }
        }
    }

    connect(n, &mut ground, home);

    // Moisture: water cells full; land from dry (high) to wet (low), wetter near water.
    let to_water = bfs(n, |k| is_water(ground[k]));
    let water = (0..cells)
        .map(|k| {
            if is_water(ground[k]) {
                return U16;
            }
            let base = p.dry + div_round((p.wet - p.dry) * (U16 - elevation[k]), U16);
            let near = (p.bank_cells - to_water[k]).max(0);
            base + div_round((p.wet - base) * near, p.bank_cells)
        })
        .collect();
    Map {
        elevation,
        ground,
        water,
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

/// Half the river: from the centre toward the top-right corner, meandering; the caller mirrors
/// it. Cells within half the width of the path become shallows, with the odd deep pool.
fn river(p: &TerrainParams, n: usize, rng: &mut Pcg32, ground: &mut [u8]) {
    let ni = i64::try_from(n).unwrap_or(0);
    let centre = (ni - 1) * ONE_I / 2;
    let diag = 46_341; // ONE / sqrt(2)
    let steps = ni * STEPS_PER_CELL; // well past the corner
    let knots: Vec<i64> = (0..steps / MEANDER_STEPS + 2)
        .map(|_| i64::from(rng.below(2 * (1 << 16) + 1)) - ONE_I)
        .collect();
    let half = p.width / 2;
    let mut last_deep = -DEEP_GAP;
    for t in 0..steps {
        let (i, f) = (
            usize::try_from(t / MEANDER_STEPS).unwrap_or(0),
            t % MEANDER_STEPS * ONE_I / MEANDER_STEPS,
        );
        let (a, b) = (knots[i], knots[(i + 1).min(knots.len() - 1)]);
        let wave = a + div_round((b - a) * f, ONE_I);
        let ramp = (t * ONE_I / MEANDER_RAMP).min(ONE_I);
        let side = div_round(div_round(p.meander * wave, ONE_I) * ramp, ONE_I);
        let along = t * ONE_I / STEPS_PER_CELL;
        // Toward the top-right corner (-y, +x), swung along the perpendicular (+y, +x).
        let y = centre + div_round((side - along) * diag, ONE_I);
        let x = centre + div_round((side + along) * diag, ONE_I);
        if y < -ONE_I || x >= (ni + 1) * ONE_I {
            break;
        }
        let r = half / ONE_I + 1;
        let (cy, cx) = (y / ONE_I, x / ONE_I);
        for gy in (cy - r).max(0)..=(cy + r).min(ni - 1) {
            for gx in (cx - r).max(0)..=(cx + r).min(ni - 1) {
                let (dy, dx) = (gy * ONE_I - y, gx * ONE_I - x);
                if dy * dy + dx * dx <= half * half {
                    let k = usize::try_from(gy * ni + gx).unwrap_or(0);
                    ground[k] = ground[k].max(SHALLOW);
                }
            }
        }
        let deep = p.width >= 2 * ONE_I
            && t - last_deep >= DEEP_GAP
            && i64::from(rng.below(1 << 16)) < p.deep;
        if deep && (0..ni).contains(&(y / ONE_I)) && (0..ni).contains(&(x / ONE_I)) {
            ground[usize::try_from((y / ONE_I) * ni + x / ONE_I).unwrap_or(0)] = DEEP;
            last_deep = t;
        }
    }
}

/// Ponds in the first half of the map (the caller mirrors them): at the lowest land away from the
/// river and the homes, radius 1..=pond_radius, a deep centre from radius 2.
fn ponds(p: &TerrainParams, n: usize, rng: &mut Pcg32, elevation: &[i64], ground: &mut [u8]) {
    let cells = n * n;
    let to_river = bfs(n, |k| is_water(ground[k]));
    let reach = i64::from(p.pond_radius);
    let home = homes(n);
    let mut spots: Vec<usize> = (0..cells)
        .filter(|&k| k < cells - 1 - k)
        .filter(|&k| to_river[k] >= reach + 3)
        .filter(|&k| {
            home.iter()
                .all(|&h| dist2(k, h, n) > (p.home_clear + reach + 2).pow(2))
        })
        .collect();
    spots.sort_by_key(|&k| (elevation[k], k));
    let mut placed: Vec<usize> = Vec::new();
    for k in spots {
        if placed.len() >= usize::try_from(p.ponds).unwrap_or(0) {
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

    #[test]
    fn maps_are_symmetric_and_reproducible() {
        let p = params();
        for seed in 1..6 {
            let m = generate(&p, 43, seed);
            let cells = 43 * 43;
            for k in 0..cells {
                assert_eq!(m.ground[k], m.ground[cells - 1 - k], "seed {seed} cell {k}");
                assert_eq!(m.elevation[k], m.elevation[cells - 1 - k]);
                assert_eq!(m.water[k], m.water[cells - 1 - k]);
            }
            assert_eq!(m, generate(&p, 43, seed), "same seed, same map");
        }
        assert_ne!(
            generate(&p, 43, 1),
            generate(&p, 43, 2),
            "another seed, another map"
        );
    }

    #[test]
    fn homes_are_clear_and_the_river_separates_them() {
        let p = params();
        for seed in 1..6 {
            let m = generate(&p, 43, seed);
            let home = homes(43);
            for k in 0..43 * 43 {
                if dist2(k, home[0], 43) <= p.home_clear * p.home_clear {
                    assert_eq!(m.ground[k], LAND, "seed {seed}: home cell {k}");
                }
            }
            let dry = flood(43, &m.ground, home[0], |g| g == LAND);
            assert!(
                !dry[home[1]],
                "seed {seed}: the river lies between the homes"
            );
            let wet = flood(43, &m.ground, home[0], |g| g == LAND || g == SHALLOW);
            assert!(wet[home[1]], "seed {seed}: but it can be crossed");
            for k in 0..43 * 43 {
                if m.ground[k] == LAND || m.ground[k] == SHALLOW {
                    assert!(wet[k], "seed {seed}: cell {k} reachable on foot");
                }
            }
        }
    }

    /// Prints a map: `~` shallows, `#` deep, `^` rock, `H` homes, digits land height.
    /// Run: `cargo test -p sim-core -- --ignored --nocapture map_preview`.
    #[test]
    #[ignore = "preview, not a check"]
    fn map_preview() {
        let (p, n) = (params(), 43);
        for seed in [1, 7] {
            let m = generate(&p, n, seed);
            let home = homes(n);
            println!("seed {seed}");
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
        let m = generate(&p, 43, 3);
        let count = |g: u8| m.ground.iter().filter(|&&x| x == g).count();
        assert!(count(SHALLOW) > 40, "a river and ponds: {}", count(SHALLOW));
        assert!(
            count(ROCK) > 20 && count(ROCK) < 200,
            "outcrops: {}",
            count(ROCK)
        );
        for k in 0..43 * 43 {
            if is_water(m.ground[k]) {
                assert_eq!(m.water[k], U16);
                assert_eq!(m.elevation[k], p.water_level, "water beds share one level");
            } else {
                assert!(
                    m.water[k] >= p.dry && m.water[k] <= p.wet,
                    "land moisture in range"
                );
                assert!(
                    m.elevation[k] > p.water_level,
                    "land stands above the water"
                );
            }
        }
    }
}
