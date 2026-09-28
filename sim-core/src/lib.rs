//! EcoClash deterministic simulation core (INSTRUCTIONS §3, §4).
//!
//! Bit-identical results from the same seed, balance and command stream on every platform:
//! integers and fixed-point only, one hand-rolled RNG, stable iteration order, explicit overflow.

pub mod fixed;
pub mod rng;
