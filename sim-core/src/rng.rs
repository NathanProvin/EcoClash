//! The simulation's only randomness (INSTRUCTIONS §4, D-009): a hand-rolled PCG32
//! (PCG-XSH-RR 64/32, M. E. O'Neill, pcg-random.org), owned by the world state.
//!
//! No `rand` / `rand_pcg`: their distribution algorithms can change between versions and silently
//! break replays. The range reduction is ours too: the reference implementation's unbiased
//! threshold rejection, so a bounded draw never depends on anything but this file.

const MULTIPLIER: u64 = 6_364_136_223_846_793_005;

/// A PCG32 generator: 64-bit state, 64-bit stream selector, 32-bit output.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Pcg32 {
    state: u64,
    inc: u64,
}

impl Pcg32 {
    /// Seed a generator on a stream, as `pcg32_srandom_r(seed, stream)` in the reference code.
    /// Different streams give independent sequences for the same seed.
    #[must_use]
    pub fn new(seed: u64, stream: u64) -> Pcg32 {
        let mut rng = Pcg32 {
            state: 0,
            inc: (stream << 1) | 1,
        };
        rng.next_u32();
        rng.state = rng.state.wrapping_add(seed);
        rng.next_u32();
        rng
    }

    /// The generator's internal state (state, increment), for the world hash.
    #[must_use]
    pub fn state(&self) -> (u64, u64) {
        (self.state, self.inc)
    }

    /// The next 32 random bits.
    pub fn next_u32(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(MULTIPLIER).wrapping_add(self.inc);
        #[allow(clippy::cast_possible_truncation)] // the output is the high bits, by design
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        #[allow(clippy::cast_possible_truncation)]
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// A uniform integer in `0..bound`, without modulo bias: draws below the threshold
    /// `2^32 mod bound` are rejected, as in `pcg32_boundedrand_r`. Panics if `bound == 0`.
    pub fn below(&mut self, bound: u32) -> u32 {
        assert!(bound > 0, "Pcg32::below: bound must be positive");
        let threshold = bound.wrapping_neg() % bound;
        loop {
            let r = self.next_u32();
            if r >= threshold {
                return r % bound;
            }
        }
    }

    /// True with probability `num / den` (0 <= num <= den, den > 0), exactly.
    pub fn chance(&mut self, num: u32, den: u32) -> bool {
        assert!(num <= den, "Pcg32::chance: num must not exceed den");
        self.below(den) < num
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_answers_from_the_reference_implementation() {
        // pcg-c-basic, pcg32-demo: pcg32_srandom_r(&rng, 42u, 54u), first six outputs.
        let mut rng = Pcg32::new(42, 54);
        let got: Vec<u32> = (0..6).map(|_| rng.next_u32()).collect();
        assert_eq!(
            got,
            [
                0xa15c_02b7,
                0x7b47_f409,
                0xba1d_3330,
                0x83d2_f293,
                0xbfa4_784b,
                0xcbed_606e
            ]
        );
    }

    #[test]
    fn same_seed_same_sequence_and_streams_differ() {
        let draw = |seed, stream| {
            let mut rng = Pcg32::new(seed, stream);
            (0..8).map(|_| rng.next_u32()).collect::<Vec<_>>()
        };
        assert_eq!(draw(7, 1), draw(7, 1));
        assert_ne!(draw(7, 1), draw(7, 2));
        assert_ne!(draw(7, 1), draw(8, 1));
    }

    #[test]
    fn bounded_draws_stay_in_range_and_are_roughly_uniform() {
        let mut rng = Pcg32::new(1, 1);
        let mut counts = [0u32; 6];
        for _ in 0..60_000 {
            let r = rng.below(6);
            counts[r as usize] += 1;
        }
        for c in counts {
            assert!((9_000..11_000).contains(&c), "{counts:?}");
        }
        assert_eq!(Pcg32::new(3, 3).below(1), 0);
    }

    #[test]
    fn chance_extremes() {
        let mut rng = Pcg32::new(5, 5);
        assert!((0..100).all(|_| !rng.chance(0, 10)));
        assert!((0..100).all(|_| rng.chance(10, 10)));
    }
}
