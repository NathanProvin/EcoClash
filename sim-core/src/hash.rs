//! State hashing (INSTRUCTIONS §4): xxHash64 of a canonical little-endian serialization.
//!
//! Hashing the full fields every tick would cost too much, so field layers are hashed per 32x32
//! chunk, and a chunk is re-hashed only when it is dirty: every chunk on flora ticks, the touched
//! chunks when a command writes cells. The per-tick world hash combines the tick, the scalars and
//! the digest of the chunk hashes. `full_hash` hashes everything at once, for tests.

use xxhash_rust::xxh64::Xxh64;

use crate::balance::Balance;
use crate::flora::{FloraParams, FloraState};

/// Seed of every xxHash64 in the simulation.
pub const SEED: u64 = 0;

/// A canonical writer: every value in little-endian bytes, in the caller's fixed order.
pub struct Hasher(Xxh64);

impl Hasher {
    #[must_use]
    pub fn new() -> Hasher {
        Hasher(Xxh64::new(SEED))
    }

    pub fn u64(&mut self, v: u64) -> &mut Hasher {
        self.0.update(&v.to_le_bytes());
        self
    }

    pub fn i64(&mut self, v: i64) -> &mut Hasher {
        self.0.update(&v.to_le_bytes());
        self
    }

    pub fn bytes(&mut self, v: &[u8]) -> &mut Hasher {
        self.0.update(v);
        self
    }

    pub fn i64s(&mut self, v: &[i64]) -> &mut Hasher {
        for x in v {
            self.0.update(&x.to_le_bytes());
        }
        self
    }

    #[must_use]
    pub fn finish(&self) -> u64 {
        self.0.digest()
    }
}

impl Default for Hasher {
    fn default() -> Hasher {
        Hasher::new()
    }
}

/// Per-chunk hashes of the flora fields, refreshed only where dirty.
#[derive(Clone, Debug)]
pub struct FieldHashes {
    n: usize,
    chunk: usize,
    side: usize, // chunks per side
    hashes: Vec<u64>,
    dirty: Vec<bool>,
    digest: u64,
}

impl FieldHashes {
    /// Everything starts dirty.
    #[must_use]
    pub fn new(n: usize, chunk: usize) -> FieldHashes {
        let side = n.div_ceil(chunk);
        FieldHashes {
            n,
            chunk,
            side,
            hashes: vec![0; side * side],
            dirty: vec![true; side * side],
            digest: 0,
        }
    }

    pub fn mark_all(&mut self) {
        self.dirty.iter_mut().for_each(|d| *d = true);
    }

    /// Mark the chunk of cell `k` (row-major) dirty.
    pub fn mark_cell(&mut self, k: usize) {
        let (y, x) = (k / self.n, k % self.n);
        self.dirty[(y / self.chunk) * self.side + x / self.chunk] = true;
    }

    /// Re-hash the dirty chunks and return the digest of all chunk hashes.
    pub fn refresh(&mut self, st: &FloraState) -> u64 {
        if !self.dirty.contains(&true) {
            return self.digest;
        }
        for c in 0..self.hashes.len() {
            if self.dirty[c] {
                self.hashes[c] = self.chunk_hash(st, c);
                self.dirty[c] = false;
            }
        }
        let mut h = Hasher::new();
        for &v in &self.hashes {
            h.u64(v);
        }
        self.digest = h.finish();
        self.digest
    }

    /// The hashes of the chunks, row-major: where a desync starts (M6 debugging).
    #[must_use]
    pub fn chunks(&self) -> &[u64] {
        &self.hashes
    }

    /// Canonical order inside a chunk: per cell (row-major) the cell layers, then per species
    /// (id order) and cell the biomass and gauge.
    fn chunk_hash(&self, st: &FloraState, c: usize) -> u64 {
        let cells = self.n * self.n;
        let (y0, x0) = ((c / self.side) * self.chunk, (c % self.side) * self.chunk);
        let ks: Vec<usize> = (y0..(y0 + self.chunk).min(self.n))
            .flat_map(|y| (x0..(x0 + self.chunk).min(self.n)).map(move |x| y * self.n + x))
            .collect();
        let mut h = Hasher::new();
        for &k in &ks {
            h.bytes(&[st.owner[k], st.soil_type[k], st.ground[k], st.lock_p[k]])
                .i64(st.lock[k])
                .i64(st.elevation[k])
                .i64(st.soil[k])
                .i64(st.water[k])
                .i64(st.light[k])
                .i64(st.prog[0][k])
                .i64(st.prog[1][k])
                .i64(st.dead[k]);
        }
        for s in 0..st.bio.len() / cells {
            for &k in &ks {
                h.i64(st.bio[s * cells + k]).i64(st.gauge[s * cells + k]);
            }
        }
        h.finish()
    }
}

/// Bumped whenever the set or order of hashed balance values changes.
pub const BALANCE_HASH_VERSION: u64 = 13; // 2: economy; 3: fauna; 4: costs; 5: victory; 6: drops; 7: movement; 8: capacity; 9: pace; 10: terrain; 11: families; 12: map types; 13: steering

/// The balance hash (INSTRUCTIONS §4, §10): the values the simulation uses, **after** conversion
/// to fixed-point, never the file bytes. Formatting, comments, CRLF / LF and changes below the
/// fixed-point resolution leave it unchanged. Peers and replays compare it before a match.
/// Stats that no ported system reads yet (costs, yields, fauna) join when their system does.
#[must_use]
pub fn balance_hash(b: &Balance) -> u64 {
    let mut h = Hasher::new();
    h.u64(BALANCE_HASH_VERSION);
    let s = &b.sim;
    for v in [
        s.tick_hz,
        s.flora_every_ticks,
        s.env_every_ticks,
        s.grid_size,
        s.chunk_size,
    ] {
        h.u64(u64::from(v));
    }
    let flora = FloraParams::from_balance(b);
    flora.hash_into(&mut h);
    let fauna = crate::fauna::FaunaParams::from_balance(b);
    crate::economy::Economy::new(b, &fauna).hash_params(&mut h);
    fauna.hash_into(&mut h);
    crate::world::hash_victory(b, &mut h);
    crate::terrain::TerrainParams::from_balance(b).hash_into(&mut h);
    h.finish()
}

/// The whole flora state in one hash (tests only: too slow per tick at full size).
#[must_use]
pub fn full_hash(st: &FloraState) -> u64 {
    let mut h = Hasher::new();
    h.u64(st.n as u64)
        .u64(st.t)
        .bytes(&st.owner)
        .bytes(&st.soil_type);
    h.i64s(&st.soil)
        .i64s(&st.water)
        .i64s(&st.light)
        .i64s(&st.prog[0])
        .i64s(&st.prog[1]);
    h.i64s(&st.dead).i64s(&st.bio).i64s(&st.gauge);
    h.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BALANCE: &str = include_str!("../../data/balance.toml");
    const SPECIES: &str = include_str!("../../data/species.toml");

    fn hash_of(balance: &str, species: &str) -> u64 {
        balance_hash(&Balance::from_toml(balance, species).expect("loads"))
    }

    #[test]
    fn balance_hash_ignores_formatting_but_not_values() {
        let base = hash_of(BALANCE, SPECIES);
        let crlf = SPECIES.replace('\n', "\r\n");
        let noisy = SPECIES.replace("growth = 1.2\n", "growth   =   1.2   # comment\n");
        assert_eq!(hash_of(BALANCE, &crlf), base, "line endings");
        assert_eq!(hash_of(BALANCE, &noisy), base, "spacing and comments");
        // Below the fixed-point resolution (1 / 65536 of the per-tick scale): same values.
        let tiny = SPECIES.replacen("growth = 1.2\n", "growth = 1.200000001\n", 1);
        assert_eq!(hash_of(BALANCE, &tiny), base, "sub-resolution change");
        let real = SPECIES.replacen("growth = 1.2\n", "growth = 1.25\n", 1);
        assert_ne!(hash_of(BALANCE, &real), base, "a real change");
        let rule = BALANCE.replace("smother_rate = 0.15", "smother_rate = 0.2");
        assert_ne!(hash_of(&rule, SPECIES), base, "a rule change");
    }

    #[test]
    fn xxh64_known_answers() {
        // Reference values of the xxHash specification (seed 0).
        assert_eq!(Hasher::new().finish(), 0xef46_db37_51d8_e999);
        assert_eq!(Hasher::new().bytes(b"a").finish(), 0xd24e_c4f1_a98c_6e5b);
    }
}
