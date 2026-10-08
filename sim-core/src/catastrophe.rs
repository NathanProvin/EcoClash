//! Catastrophe cards (D-129): late-game trump cards at the far right of the build bar. Every card
//! is available from the start, costs biomass at each use and cools down before it can be played
//! again (per player). A cast hits everything in its disc, both players' plants alike, on the
//! flora ticks of its duration:
//! - `kill_trees` (processionary caterpillars): each tree stand dies with `chance`, standing as dead
//!   wood (D-127);
//! - `storm` (violent storm): each cell loses all its shrubs and trees to litter with `chance`;
//! - `spill` (chemical spill): the cells go back to bare soil: no plants, litter, dead wood or
//!   soil development, and nobody owns them.

use crate::balance::{Act, Balance};
use crate::commands::disc;
use crate::economy::Economy;
use crate::fixed::ONE;
use crate::flora::{Flora, FloraState, round};
use crate::hash::Hasher;
use crate::rng::Pcg32;

const ONE_I: i64 = ONE as i64;

/// The catastrophe cards, converted once (file order of `[catastrophes.*]`, a sorted map).
#[derive(Clone, Debug)]
pub struct CatastropheParams {
    pub names: Vec<String>,
    act: Vec<Act>,
    /// Biomass per use (Q16, like the bank).
    pub cost: Vec<i64>,
    pub radius: Vec<u32>,
    /// Ticks before the same player may play the card again.
    pub cooldown: Vec<u64>,
    /// Flora ticks the effect lasts (at least 1).
    duration: Vec<i64>,
    /// Chance per affected cell per flora tick (Q16).
    chance: Vec<i64>,
    /// Ticks per second, to tell players how long a cooldown has left.
    hz: u64,
}

impl CatastropheParams {
    #[must_use]
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    pub fn from_balance(b: &Balance) -> CatastropheParams {
        let (one, hz) = (f64::from(ONE), f64::from(b.sim.tick_hz));
        let flora_period = f64::from(b.sim.flora_every_ticks) / hz; // real seconds
        let c: Vec<_> = b.catastrophes.values().collect();
        CatastropheParams {
            names: b.catastrophes.keys().cloned().collect(),
            act: c.iter().map(|r| r.act).collect(),
            cost: c.iter().map(|r| round(r.cost * one)).collect(),
            radius: c.iter().map(|r| r.radius).collect(),
            cooldown: c
                .iter()
                .map(|r| u64::try_from(round(r.cooldown_s * hz)).unwrap_or(0))
                .collect(),
            duration: c
                .iter()
                .map(|r| round(r.duration_s / flora_period).max(1))
                .collect(),
            chance: c.iter().map(|r| round(r.chance * one)).collect(),
            hz: u64::from(b.sim.tick_hz.max(1)),
        }
    }

    /// What card `k` does.
    #[must_use]
    pub fn act(&self, k: usize) -> Act {
        self.act[k]
    }

    #[must_use]
    pub fn index(&self, name: &str) -> Option<usize> {
        self.names.iter().position(|n| n == name)
    }

    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(self.names.len() as u64);
        for (i, name) in self.names.iter().enumerate() {
            h.u64(name.len() as u64)
                .bytes(name.as_bytes())
                .u64(self.act[i] as u64)
                .u64(u64::from(self.radius[i]))
                .u64(self.cooldown[i]);
        }
        h.i64s(&self.cost).i64s(&self.duration).i64s(&self.chance);
    }
}

/// A catastrophe at work: its card, its centre, the flora ticks it still acts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Active {
    pub kind: usize,
    pub row: u32,
    pub col: u32,
    pub left: i64,
}

#[derive(Clone, Debug)]
pub struct Catastrophes {
    pub p: CatastropheParams,
    pub active: Vec<Active>,
    /// Per player and card, the tick from which it may be played again.
    pub ready: [Vec<u64>; 2],
    /// Casts since the last `take`, as (player, card, row, col): the animations of both
    /// players' casts. A view, never hashed.
    pub effects: Vec<(u8, usize, u32, u32)>,
}

impl Catastrophes {
    #[must_use]
    pub fn new(p: CatastropheParams) -> Catastrophes {
        let cards = p.names.len();
        Catastrophes {
            p,
            active: Vec::new(),
            ready: [vec![0; cards], vec![0; cards]],
            effects: Vec::new(),
        }
    }

    /// Play card `kind` for `player` at (`row`, `col`) on tick `tick`: it must be ready and
    /// affordable (sandbox: free). Pays, starts the cooldown and the effect.
    pub fn cast(
        &mut self,
        economy: &mut Economy,
        player: u8,
        kind: usize,
        (row, col): (u32, u32),
        tick: u64,
    ) -> Result<(), String> {
        let pi = usize::from(player - 1);
        let ready = self.ready[pi][kind];
        if tick < ready {
            let s = (ready - tick).div_ceil(self.p.hz);
            return Err(format!("not ready for {s} s"));
        }
        let cost = if economy.sandbox {
            0
        } else {
            self.p.cost[kind]
        };
        if economy.bank[pi] < cost {
            return Err(format!("needs {} biomass", cost / ONE_I));
        }
        economy.pay(player, cost);
        self.ready[pi][kind] = tick + self.p.cooldown[kind];
        self.active.push(Active {
            kind,
            row,
            col,
            left: self.p.duration[kind],
        });
        self.effects.push((player, kind, row, col));
        Ok(())
    }

    /// One flora tick of every catastrophe at work, in cast order; spent ones end.
    pub fn act(&mut self, flora: &Flora, st: &mut FloraState, rng: &mut Pcg32) {
        let n = st.n;
        for a in &mut self.active {
            let (act, chance) = (self.p.act[a.kind], self.p.chance[a.kind]);
            for k in disc(n, a.row, a.col, self.p.radius[a.kind]) {
                if i64::from(rng.below(1 << 16)) >= chance {
                    continue;
                }
                match act {
                    Act::KillTrees => {
                        flora.kill_trees(st, k);
                    }
                    Act::Storm => {
                        // Windthrown trees stand on as dead trees (D-227); shrubs fall to litter.
                        flora.kill_trees(st, k);
                        flora.fell(st, k, 3);
                    }
                    Act::Spill => flora.lay_bare(st, k),
                }
            }
            a.left -= 1;
        }
        self.active.retain(|a| a.left > 0);
    }

    pub fn hash_state(&self, h: &mut Hasher) {
        h.u64(self.active.len() as u64);
        for a in &self.active {
            h.u64(a.kind as u64)
                .u64(u64::from(a.row))
                .u64(u64::from(a.col))
                .i64(a.left);
        }
        for r in &self.ready {
            for &t in r {
                h.u64(t);
            }
        }
    }
}
