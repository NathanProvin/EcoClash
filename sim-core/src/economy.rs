//! Biomass points (INSTRUCTIONS §2.3, gamerules §4; D-027, D-046): one bank per player, separate
//! from the fields. After each flora tick, every plant yields `yield` points per second per fully
//! covered cell of its owner (cover capped at 1): the prototype's `Economy.income`, in integers.
//! Spending (unlocks, planting costs) comes with the M4 economy.

use crate::balance::Balance;
use crate::fixed::{ONE, div_round};
use crate::flora::{FloraParams, FloraState, round};
use crate::hash::Hasher;

#[derive(Clone, Debug)]
pub struct Economy {
    /// Points at the start of the match (Q16).
    start: i64,
    /// Points per second per fully covered cell, per plant species (Q16).
    yld: Vec<i64>,
    /// Flora period as a fraction: `flora_every_ticks / tick_hz` seconds.
    every: i64,
    hz: i64,
    /// Points banked, per player (Q16).
    pub bank: [i64; 2],
    /// Income over the last flora tick, per player (Q16 points per second).
    pub income: [i64; 2],
}

impl Economy {
    #[must_use]
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    pub fn new(b: &Balance) -> Economy {
        let one = f64::from(ONE);
        let start = round(b.economy.start_budget * one);
        Economy {
            start,
            yld: b
                .flora_species
                .iter()
                .map(|(_, s)| round(s.yield_ * one))
                .collect(),
            every: i64::from(b.sim.flora_every_ticks),
            hz: i64::from(b.sim.tick_hz),
            bank: [start; 2],
            income: [0; 2],
        }
    }

    /// Credit one flora period of income, from the state after the flora tick.
    pub fn update(&mut self, p: &FloraParams, st: &FloraState) {
        let n2 = st.n * st.n;
        let mut income = [0i64; 2];
        for (s, (&yld, &kmax)) in self.yld.iter().zip(&p.kmax).enumerate() {
            let mut covered = [0i64; 2]; // sum of min(biomass, k_max) over each player's cells
            for (k, &b) in st.bio[s * n2..(s + 1) * n2].iter().enumerate() {
                if let o @ 1..=2 = st.owner[k] {
                    covered[usize::from(o) - 1] += b.min(kmax);
                }
            }
            for (inc, c) in income.iter_mut().zip(covered) {
                *inc += div_round(yld * c, kmax);
            }
        }
        for (pi, inc) in income.into_iter().enumerate() {
            self.income[pi] = inc;
            self.bank[pi] += div_round(inc * self.every, self.hz);
        }
    }

    /// The converted economy values, for the balance hash.
    pub fn hash_params(&self, h: &mut Hasher) {
        h.i64(self.start).i64s(&self.yld);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BALANCE: &str = include_str!("../../data/balance.toml");
    const SPECIES: &str = include_str!("../../data/species.toml");

    #[test]
    fn income_is_yield_times_capped_cover_and_banks_one_flora_period() {
        let b = Balance::from_toml(BALANCE, SPECIES).unwrap();
        let p = FloraParams::from_balance(&b);
        let mut e = Economy::new(&b);
        let start = e.bank;
        let g = p.index("grasses").unwrap();
        let mut st = FloraState::new(&p, 4);
        for k in 0..4 {
            st.owner[k] = 1;
            st.bio[g * 16 + k] = p.kmax[g] * 2 / (1 + i64::try_from(k % 2).unwrap()); // full cover
        }
        st.owner[5] = 1;
        st.bio[g * 16 + 5] = p.kmax[g] / 2; // half cover
        st.owner[6] = 2;
        st.bio[g * 16 + 6] = p.kmax[g]; // P2's cell counts for P2 only
        e.update(&p, &st);
        let yld = e.yld[g];
        assert_eq!(e.income, [yld * 4 + div_round(yld, 2), yld]);
        let period = |inc: i64| div_round(inc * e.every, e.hz);
        assert_eq!(
            e.bank,
            [start[0] + period(e.income[0]), start[1] + period(yld)]
        );
    }
}
