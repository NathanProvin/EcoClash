//! Biomass points (INSTRUCTIONS §2.3, gamerules §4; D-027, D-046): one bank per player, separate
//! from the fields. After each flora tick, every plant yields `yield` points per second per fully
//! covered cell of its owner (cover capped at 1), and every animal `yield` points per second
//! per head: the prototype's `Economy.income`, in integers.
//!
//! Spending (gamerules §4, §7; D-058), as in the prototype's `Economy`: species cards are
//! unlocked per player (unlock cost 0 = unlocked at start). A card needs one unlocked species on
//! the previous tier of its tree and level and, for an animal, one unlocked habitat plant. Planting
//! costs `spawn_cost` per cell planted; spawning costs `spawn_cost` per animal, times
//! `drop_surcharge` for any animal landing outside own land (D-061). A sandbox match (tools, checks) has
//! everything unlocked and free.
//!
//! Species indices here run over the whole stat sheet: plants first, then animals.

use crate::balance::Balance;
use crate::fauna::{Fauna, FaunaParams};
use crate::fixed::{ONE, div_round};

const ONE_I: i64 = ONE as i64;
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
    /// Species cards unlocked, per player (plants, then animals).
    pub unlocked: [Vec<bool>; 2],
    /// Everything unlocked and free (tools and checks; part of the state hash).
    pub sandbox: bool,
    /// Per species (plants, then animals), Q16 points.
    unlock_cost: Vec<i64>,
    spawn_cost: Vec<i64>,
    surcharge: i64,
    /// Per species: (is an animal, level, tier) for the unlock rule.
    tree: Vec<(bool, u8, u8)>,
    /// Per animal species: habitat plants (bitmask over plant species).
    habitat: Vec<u32>,
    plants: usize,
}

impl Economy {
    #[must_use]
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    pub fn new(b: &Balance, fauna: &FaunaParams) -> Economy {
        let one = f64::from(ONE);
        let start = round(b.economy.start_budget * one);
        let (fl, fa) = (&b.flora_species, &b.fauna_species);
        let costs = |f: &dyn Fn(f64, f64) -> f64| -> Vec<i64> {
            fl.iter()
                .map(|(_, s)| f(s.unlock_cost, s.spawn_cost))
                .chain(fa.iter().map(|(_, s)| f(s.unlock_cost, s.spawn_cost)))
                .map(|v| round(v * one))
                .collect()
        };
        let unlock_cost = costs(&|u, _| u);
        let free: Vec<bool> = unlock_cost.iter().map(|&c| c == 0).collect();
        Economy {
            unlocked: [free.clone(), free],
            sandbox: false,
            spawn_cost: costs(&|_, s| s),
            unlock_cost,
            surcharge: round(b.economy.drop_surcharge * one),
            tree: fl
                .iter()
                .map(|(_, s)| (false, s.level, s.tier))
                .chain(fa.iter().map(|(_, s)| (true, s.level, s.tier)))
                .collect(),
            habitat: fauna.habitat.clone(),
            plants: fl.len(),
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
    pub fn update(&mut self, p: &FloraParams, st: &FloraState, fauna: &Fauna) {
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
        let a = &fauna.agents;
        for i in 0..a.len() {
            income[usize::from(a.owner[i] - 1)] += fauna.p.yld[usize::from(a.sp[i])];
        }
        for (pi, inc) in income.into_iter().enumerate() {
            self.income[pi] = inc;
            self.bank[pi] += div_round(inc * self.every, self.hz);
        }
    }

    /// The converted economy values, for the balance hash.
    pub fn hash_params(&self, h: &mut Hasher) {
        h.i64(self.start)
            .i64s(&self.yld)
            .i64s(&self.unlock_cost)
            .i64s(&self.spawn_cost)
            .i64(self.surcharge);
    }

    /// The state that changes during a match, for the tick hash.
    pub fn hash_state(&self, h: &mut Hasher) {
        h.i64s(&self.bank).u64(u64::from(self.sandbox));
        for list in &self.unlocked {
            let bytes: Vec<u8> = list.iter().map(|&u| u8::from(u)).collect();
            h.bytes(&bytes);
        }
    }

    /// Index of an animal species in the whole stat sheet.
    #[must_use]
    pub fn animal(&self, s: usize) -> usize {
        self.plants + s
    }

    #[must_use]
    pub fn is_unlocked(&self, player: u8, i: usize) -> bool {
        self.sandbox || self.unlocked[usize::from(player - 1)].get(i) == Some(&true)
    }

    /// Why species `i` cannot be unlocked by `player` now, if it cannot (gamerules §4.1).
    pub fn check_unlock(&self, player: u8, i: usize) -> Result<(), String> {
        let have = &self.unlocked[usize::from(player - 1)];
        if have.get(i) == Some(&true) {
            return Err("already unlocked".into());
        }
        let (animal, level, tier) = self.tree[i];
        let below = |j: usize| self.tree[j] == (animal, level, tier - 1) && have[j];
        if tier > 1 && !(0..self.tree.len()).any(below) {
            return Err(format!(
                "needs a tier {} species of its level first",
                tier - 1
            ));
        }
        if animal {
            let mask = self.habitat[i - self.plants];
            if !(0..self.plants).any(|j| mask >> j & 1 == 1 && have[j]) {
                return Err("needs one of its habitat plants unlocked first".into());
            }
        }
        if self.bank[usize::from(player - 1)] < self.unlock_cost[i] {
            return Err(format!("needs {} biomass", self.unlock_cost[i] >> 16));
        }
        Ok(())
    }

    /// Unlock species `i` for `player`, paying its unlock cost.
    pub fn unlock(&mut self, player: u8, i: usize) -> Result<(), String> {
        self.check_unlock(player, i)?;
        let pi = usize::from(player - 1);
        self.bank[pi] -= self.unlock_cost[i];
        self.unlocked[pi][i] = true;
        Ok(())
    }

    /// Cost of one planted cell or one spawned animal of species `i` (0 in a sandbox), with the
    /// drop surcharge when the animal lands `outside` own land.
    #[must_use]
    pub fn unit_cost(&self, i: usize, outside: bool) -> i64 {
        if self.sandbox {
            return 0;
        }
        let c = self.spawn_cost[i];
        if outside {
            div_round(c * self.surcharge, ONE_I)
        } else {
            c
        }
    }

    /// How many units at `unit` points `player` can pay for.
    #[must_use]
    pub fn affordable(&self, player: u8, unit: i64) -> i64 {
        if unit <= 0 {
            return i64::MAX;
        }
        self.bank[usize::from(player - 1)].max(0) / unit // whole units only: rounded down
    }

    pub fn pay(&mut self, player: u8, amount: i64) {
        self.bank[usize::from(player - 1)] -= amount;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BALANCE: &str = include_str!("../../data/balance.toml");
    const SPECIES: &str = include_str!("../../data/species.toml");

    #[test]
    fn cards_unlock_by_tier_and_habitat_and_cost_points() {
        let b = Balance::from_toml(BALANCE, SPECIES).unwrap();
        let p = FloraParams::from_balance(&b);
        let fp = FaunaParams::from_balance(&b, &p);
        let mut e = Economy::new(&b, &fp);
        let idx = |name: &str| {
            p.index(name)
                .or_else(|| fp.index(name).map(|s| p.species() + s))
                .unwrap()
        };
        let (grasses, wildflowers, bramble) = (idx("grasses"), idx("wildflowers"), idx("bramble"));
        let (worms, fox) = (idx("earthworms"), idx("fox"));
        assert!(
            e.is_unlocked(1, grasses) && e.is_unlocked(1, worms),
            "free at start"
        );
        assert!(!e.is_unlocked(1, wildflowers));
        assert!(e.check_unlock(1, bramble).unwrap_err().contains("tier 2"));
        let before = e.bank[0];
        e.unlock(1, wildflowers).unwrap();
        assert_eq!(e.bank[0], before - e.unlock_cost[wildflowers]);
        assert!(
            e.is_unlocked(1, wildflowers) && !e.is_unlocked(2, wildflowers),
            "per player"
        );
        assert!(
            e.check_unlock(1, fox).unwrap_err().contains("habitat"),
            "fox needs an L2 plant"
        );
        e.bank[0] = 0;
        let hazel = idx("hazel");
        assert!(
            e.check_unlock(1, idx("elder"))
                .unwrap_err()
                .contains("biomass")
        );
        assert!(e.check_unlock(1, hazel).is_err());
        assert_eq!(e.affordable(1, e.unit_cost(grasses, false)), 0);
        assert_eq!(
            e.unit_cost(fox, true),
            div_round(e.unit_cost(fox, false) * e.surcharge, ONE_I),
            "predator drop surcharge"
        );
        e.sandbox = true;
        assert!(
            e.is_unlocked(1, fox) && e.unit_cost(fox, true) == 0,
            "sandbox: all free"
        );
    }

    #[test]
    fn income_is_yield_times_capped_cover_and_banks_one_flora_period() {
        let b = Balance::from_toml(BALANCE, SPECIES).unwrap();
        let p = FloraParams::from_balance(&b);
        let fauna = Fauna::new(FaunaParams::from_balance(&b, &p));
        let mut e = Economy::new(&b, &fauna.p);
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
        e.update(&p, &st, &fauna);
        let yld = e.yld[g];
        assert_eq!(e.income, [yld * 4 + div_round(yld, 2), yld]);
        let period = |inc: i64| div_round(inc * e.every, e.hz);
        assert_eq!(
            e.bank,
            [start[0] + period(e.income[0]), start[1] + period(yld)]
        );
    }
}
