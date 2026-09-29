//! Animals (gamerules §5.2, §6; D-023, D-026, D-052): agents on the flora grid, the Rust port of
//! the prototype's rules (`tools/prototype/fauna.py`). Two deliberate differences (D-052):
//! - movement is continuous: every tick an animal walks toward a target (fixed-point cells) at its
//!   speed, while decisions and feeding happen at each flora tick, as in the prototype;
//! - wandering draws from the world's PCG32, so the port is behaviour-equivalent, not bit-exact.
//!
//! At each flora tick, after the flora step: upkeep; feeding on the current cell (graze,
//! decompose, hunt); starvation; reproduction; then new targets (flee a hunter, seek food,
//! wander). Agents keep creation order; ids are never reused, so renderers can follow them.

#![allow(clippy::needless_range_loop)] // parallel SoA arrays, indexed together

use std::collections::BTreeMap;

use crate::balance::Balance;
use crate::fixed::{ONE, div_round};
use crate::flora::{FloraParams, FloraState, U16, round};
use crate::hash::Hasher;
use crate::rng::Pcg32;

const ONE_I: i64 = ONE as i64;
const HALF: i64 = ONE_I / 2;
const PLAYERS: [u8; 2] = [1, 2];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Decomposer,
    Herbivore,
    Predator,
}

/// The fauna part of the balance, converted once (fixed-point, per flora tick where it applies).
#[derive(Clone, Debug)]
pub struct FaunaParams {
    pub names: Vec<String>,
    pub role: Vec<Role>,
    /// Flora the player must own (bitmask over flora species).
    habitat: Vec<u32>,
    /// Flora eaten (herbivores), fauna eaten (predators): bitmasks.
    eats_flora: Vec<u32>,
    eats_fauna: Vec<u32>,
    small: Vec<bool>,
    /// Energy capacity, in biomass units (full energy = body x ONE).
    pub body: Vec<i64>,
    /// Biomass eaten per flora tick.
    bite: Vec<i64>,
    /// Energy burnt per flora tick (Q16 biomass, at least 1).
    upkeep: Vec<i64>,
    /// Cells walked per tick (Q16).
    speed: Vec<i64>,
    sight: Vec<i64>,
    group: Vec<i64>,
    /// Animals per player.
    cap: Vec<i64>,
    /// Flora ticks between two births.
    breed: Vec<i64>,
    /// Points per second per animal (Q16).
    pub yld: Vec<i64>,
    transfer: i64,
    own_graze: i64,
    soil_per_dead: i64,
    herb_range: usize,
    flee: i64,
    refuge: u32,
    refuge_cover: i64,
    /// Animals per player, all species.
    player_cap: i64,
    /// Ticks per flora tick.
    every: i64,
    /// Search offsets (d², dy, dx), nearest first, ties in row-major order.
    offs: Vec<(i64, i64, i64)>,
}

impl FaunaParams {
    #[must_use]
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    pub fn from_balance(b: &Balance, fl: &FloraParams) -> FaunaParams {
        let (fa, dt, one) = (&b.fauna, b.flora_dt(), f64::from(ONE));
        let hz = f64::from(b.sim.tick_hz);
        let flora_mask = |names: &[String]| -> u32 {
            let mut m = 0;
            for n in names {
                for (i, &l) in fl.level.iter().enumerate() {
                    let by_level = n.len() == 2 && n.starts_with('L') && n[1..] == l.to_string();
                    if by_level || fl.names.get(i) == Some(n) {
                        m |= 1 << i;
                    }
                }
            }
            m
        };
        let sp: Vec<_> = b.fauna_species.iter().map(|(_, s)| s).collect();
        let names: Vec<String> = b.fauna_species.iter().map(|(n, _)| n.clone()).collect();
        let role = sp
            .iter()
            .map(|s| match s.role.as_str() {
                "decomposer" => Role::Decomposer,
                "herbivore" => Role::Herbivore,
                _ => Role::Predator,
            })
            .collect::<Vec<_>>();
        let eats_fauna = sp
            .iter()
            .map(|s| {
                names
                    .iter()
                    .enumerate()
                    .filter(|(_, n)| s.role == "predator" && s.eats.contains(n))
                    .fold(0u32, |m, (i, _)| m | 1 << i)
            })
            .collect();
        let sight: Vec<i64> = sp.iter().map(|s| i64::from(s.sight)).collect();
        let flee = i64::from(fa.flee_radius);
        let r = sight.iter().copied().max().unwrap_or(0).max(flee);
        let mut offs = Vec::new();
        for dy in -r..=r {
            for dx in -r..=r {
                offs.push((dy * dy + dx * dx, dy, dx));
            }
        }
        offs.sort_unstable(); // (d², dy, dx): nearest first, then row-major
        FaunaParams {
            role,
            habitat: sp.iter().map(|s| flora_mask(&s.habitat)).collect(),
            eats_flora: sp
                .iter()
                .map(|s| {
                    if s.role == "herbivore" {
                        flora_mask(&s.eats)
                    } else {
                        0
                    }
                })
                .collect(),
            eats_fauna,
            small: sp.iter().map(|s| s.small).collect(),
            body: sp.iter().map(|s| i64::from(s.body)).collect(),
            bite: sp.iter().map(|s| round(s.bite * dt)).collect(),
            upkeep: sp
                .iter()
                .map(|s| round(f64::from(s.body) * s.upkeep * dt * one).max(1))
                .collect(),
            speed: sp
                .iter()
                .map(|s| round(s.speed / hz * one).max(1))
                .collect(),
            sight,
            group: sp.iter().map(|s| i64::from(s.group)).collect(),
            cap: sp.iter().map(|s| i64::from(s.cap)).collect(),
            breed: sp.iter().map(|s| round(s.growth / dt).max(1)).collect(),
            yld: sp.iter().map(|s| round(s.yield_ * one)).collect(),
            transfer: round(fa.transfer * one),
            own_graze: round(fa.own_graze * one),
            soil_per_dead: round(fa.soil_per_dead * one),
            herb_range: usize::try_from(fa.herbivore_range).unwrap_or(0),
            flee,
            refuge: flora_mask(&fa.refuge_flora),
            refuge_cover: round(fa.refuge_cover * one),
            player_cap: i64::from(b.agents.max_agents / 2),
            every: i64::from(b.sim.flora_every_ticks),
            offs,
            names,
        }
    }

    #[must_use]
    pub fn index(&self, name: &str) -> Option<usize> {
        self.names.iter().position(|n| n == name)
    }

    /// The converted values, for the balance hash.
    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(self.names.len() as u64);
        for name in &self.names {
            h.u64(name.len() as u64).bytes(name.as_bytes());
        }
        for (i, r) in self.role.iter().enumerate() {
            h.u64(*r as u64)
                .u64(u64::from(self.habitat[i]))
                .u64(u64::from(self.eats_flora[i]))
                .u64(u64::from(self.eats_fauna[i]))
                .u64(u64::from(self.small[i]));
        }
        for v in [
            &self.body,
            &self.bite,
            &self.upkeep,
            &self.speed,
            &self.sight,
            &self.group,
            &self.cap,
            &self.breed,
            &self.yld,
        ] {
            h.i64s(v);
        }
        h.i64s(&[
            self.transfer,
            self.own_graze,
            self.soil_per_dead,
            self.herb_range as i64,
            self.flee,
            i64::from(self.refuge),
            self.refuge_cover,
            self.player_cap,
        ]);
    }
}

/// Structure of arrays, one row per living animal, in creation order.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Agents {
    pub id: Vec<u32>,
    pub sp: Vec<u8>,
    pub owner: Vec<u8>,
    /// Position in cells (Q16); the cell is `y >> 16`, its centre `cell * ONE + ONE / 2`.
    pub y: Vec<i64>,
    pub x: Vec<i64>,
    /// Where the animal walks to (Q16 cells).
    pub ty: Vec<i64>,
    pub tx: Vec<i64>,
    /// Q16 biomass units.
    pub energy: Vec<i64>,
    /// Flora ticks before this animal may give birth again.
    pub cooldown: Vec<i64>,
    pub next_id: u32,
}

impl Agents {
    #[must_use]
    pub fn len(&self) -> usize {
        self.id.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.id.is_empty()
    }

    /// The cell index of agent `i` on an `n x n` map.
    #[must_use]
    pub fn cell(&self, i: usize, n: usize) -> usize {
        cell_of(self.y[i]) * n + cell_of(self.x[i])
    }

    fn push(&mut self, sp: usize, owner: u8, y: i64, x: i64, energy: i64, cooldown: i64) {
        self.id.push(self.next_id);
        self.next_id = self.next_id.wrapping_add(1);
        self.sp.push(u8::try_from(sp).unwrap_or(u8::MAX));
        self.owner.push(owner);
        self.y.push(y);
        self.x.push(x);
        self.ty.push(y);
        self.tx.push(x);
        self.energy.push(energy);
        self.cooldown.push(cooldown);
    }

    fn retain(&mut self, keep: &[bool]) {
        fn filter<T: Copy>(v: &mut Vec<T>, keep: &[bool]) {
            let mut k = keep.iter();
            v.retain(|_| *k.next().unwrap_or(&false));
        }
        filter(&mut self.id, keep);
        filter(&mut self.sp, keep);
        filter(&mut self.owner, keep);
        filter(&mut self.y, keep);
        filter(&mut self.x, keep);
        filter(&mut self.ty, keep);
        filter(&mut self.tx, keep);
        filter(&mut self.energy, keep);
        filter(&mut self.cooldown, keep);
    }

    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(u64::from(self.next_id)).u64(self.len() as u64);
        for i in 0..self.len() {
            h.u64(u64::from(self.id[i]))
                .u64(u64::from(self.sp[i]))
                .u64(u64::from(self.owner[i]));
        }
        for v in [
            &self.y,
            &self.x,
            &self.ty,
            &self.tx,
            &self.energy,
            &self.cooldown,
        ] {
            h.i64s(v);
        }
    }
}

fn cell_of(q: i64) -> usize {
    usize::try_from(q >> 16).unwrap_or(0)
}

fn centre(cell: usize) -> i64 {
    i64::try_from(cell).unwrap_or(0) * ONE_I + HALF
}

/// All animals and their rules.
#[derive(Clone, Debug)]
pub struct Fauna {
    pub p: FaunaParams,
    pub agents: Agents,
}

impl Fauna {
    #[must_use]
    pub fn new(p: FaunaParams) -> Fauna {
        Fauna {
            p,
            agents: Agents::default(),
        }
    }

    /// Every tick: each animal walks toward its target, up to its speed on each axis.
    pub fn walk(&mut self) {
        let a = &mut self.agents;
        for i in 0..a.len() {
            let v = self.p.speed[usize::from(a.sp[i])];
            a.y[i] += (a.ty[i] - a.y[i]).clamp(-v, v);
            a.x[i] += (a.tx[i] - a.x[i]).clamp(-v, v);
        }
    }

    /// Animals per species for one player, in species order.
    #[must_use]
    pub fn census(&self, player: u8) -> Vec<i64> {
        let mut c = vec![0; self.p.names.len()];
        for i in 0..self.agents.len() {
            if self.agents.owner[i] == player {
                c[usize::from(self.agents.sp[i])] += 1;
            }
        }
        c
    }

    /// Small fauna inside its owner's dense refuge flora cannot be hunted (D-023).
    fn safe(&self, fl: &FloraParams, st: &FloraState) -> Vec<bool> {
        let (a, n2) = (&self.agents, st.n * st.n);
        (0..a.len())
            .map(|i| {
                let k = a.cell(i, st.n);
                let cover: i64 = (0..fl.names.len())
                    .filter(|&s| self.p.refuge >> s & 1 == 1)
                    .map(|s| div_round(st.bio[s * n2 + k] * ONE_I, fl.kmax[s]))
                    .sum();
                self.p.small[usize::from(a.sp[i])]
                    && st.owner[k] == a.owner[i]
                    && cover >= self.p.refuge_cover
            })
            .collect()
    }

    /// The nearest `true` cell of `mask` within radius `r` of `cell`, nearest first.
    fn nearest(&self, mask: &[bool], n: usize, cell: usize, r: i64) -> Option<usize> {
        let (cy, cx) = (i64::try_from(cell / n).ok()?, i64::try_from(cell % n).ok()?);
        let n = i64::try_from(n).ok()?;
        for &(d2, dy, dx) in &self.p.offs {
            if d2 > r * r {
                break;
            }
            let (y, x) = (cy + dy, cx + dx);
            if (0..n).contains(&y) && (0..n).contains(&x) {
                let k = usize::try_from(y * n + x).ok()?;
                if mask[k] {
                    return Some(k);
                }
            }
        }
        None
    }

    /// Advance one flora tick (after the flora step): see the module doc.
    pub fn act(&mut self, fl: &FloraParams, st: &mut FloraState, rng: &mut Pcg32) {
        if self.agents.is_empty() {
            return;
        }
        let a = &mut self.agents;
        for i in 0..a.len() {
            let s = usize::from(a.sp[i]);
            a.energy[i] -= self.p.upkeep[s];
            a.cooldown[i] = (a.cooldown[i] - 1).max(0);
        }
        let safe = self.safe(fl, st);
        self.graze(st);
        self.decompose(st);
        let alive = self.hunt(st, &safe);
        self.starve_and_bury(st, alive);
        self.reproduce();
        self.decide(fl, st, rng);
    }

    /// Herbivores graze the richest diet species of their cell: enemy flora at a full bite, own
    /// flora at `own_graze`. Bites on one stock are served pro rata when it runs short.
    fn graze(&mut self, st: &mut FloraState) {
        let (a, p, n, n2) = (&mut self.agents, &self.p, st.n, st.n * st.n);
        let mut orders: Vec<(usize, usize, i64)> = Vec::new(); // (agent, stock index, bite)
        for i in 0..a.len() {
            let s = usize::from(a.sp[i]);
            let k = a.cell(i, n);
            if p.role[s] != Role::Herbivore || st.owner[k] == 0 {
                continue;
            }
            let mut pick: Option<(usize, i64)> = None; // first species with the most biomass
            for j in 0..32 {
                if p.eats_flora[s] >> j & 1 == 1 {
                    let have = st.bio[j * n2 + k];
                    if have >= 1 && pick.is_none_or(|(_, h)| have > h) {
                        pick = Some((j, have));
                    }
                }
            }
            if let Some((j, _)) = pick {
                let mut bite = p.bite[s];
                if st.owner[k] == a.owner[i] {
                    bite = div_round(bite * p.own_graze, ONE_I);
                }
                orders.push((i, j * n2 + k, bite));
            }
        }
        for (i, at, eaten) in share(&orders, |at| st.bio[at]) {
            st.bio[at] -= eaten;
            a.energy[i] += eaten * p.transfer;
            st.dead[at % n2] += eaten - div_round(eaten * p.transfer, ONE_I);
        }
    }

    /// Decomposers eat dead biomass and turn it into soil development.
    fn decompose(&mut self, st: &mut FloraState) {
        let (a, p, n) = (&mut self.agents, &self.p, st.n);
        let orders: Vec<(usize, usize, i64)> = (0..a.len())
            .filter(|&i| p.role[usize::from(a.sp[i])] == Role::Decomposer)
            .map(|i| (i, a.cell(i, n), p.bite[usize::from(a.sp[i])]))
            .collect();
        for (i, k, eaten) in share(&orders, |k| st.dead[k]) {
            st.dead[k] -= eaten;
            a.energy[i] += eaten * p.transfer;
            st.soil[k] = (st.soil[k] + div_round(eaten * p.soil_per_dead, ONE_I)).min(U16);
        }
    }

    /// Predators kill one huntable enemy prey in their cell, in index order. Returns who lives.
    fn hunt(&mut self, st: &mut FloraState, safe: &[bool]) -> Vec<bool> {
        let (a, p, n) = (&mut self.agents, &self.p, st.n);
        let mut alive = vec![true; a.len()];
        for i in 0..a.len() {
            let s = usize::from(a.sp[i]);
            if p.role[s] != Role::Predator || !alive[i] {
                continue;
            }
            let k = a.cell(i, n);
            let prey = (0..a.len()).find(|&j| {
                alive[j]
                    && !safe[j]
                    && a.owner[j] == 3 - a.owner[i]
                    && p.eats_fauna[s] >> a.sp[j] & 1 == 1
                    && a.cell(j, n) == k
            });
            if let Some(j) = prey {
                alive[j] = false;
                let body = p.body[usize::from(a.sp[j])];
                a.energy[i] += body * p.transfer;
                st.dead[k] += body - div_round(body * p.transfer, ONE_I);
            }
        }
        alive
    }

    /// Starvation: the carcass (half the body) becomes dead biomass. Removes the dead.
    fn starve_and_bury(&mut self, st: &mut FloraState, mut alive: Vec<bool>) {
        let a = &mut self.agents;
        for i in 0..a.len() {
            if alive[i] && a.energy[i] <= 0 {
                alive[i] = false;
                st.dead[a.cell(i, st.n)] += self.p.body[usize::from(a.sp[i])] / 2;
            }
        }
        a.retain(&alive);
    }

    /// At full energy, once its cooldown is over, an animal splits in two, under the player and
    /// species caps (D-023, D-029).
    fn reproduce(&mut self) {
        let (a, p) = (&mut self.agents, &self.p);
        let ns = p.names.len();
        let mut count = [0i64; 2];
        let mut kin = vec![[0i64; 2]; ns];
        for i in 0..a.len() {
            let pi = usize::from(a.owner[i] - 1);
            count[pi] += 1;
            kin[usize::from(a.sp[i])][pi] += 1;
        }
        for i in 0..a.len() {
            let (s, pi) = (usize::from(a.sp[i]), usize::from(a.owner[i] - 1));
            let ready = a.energy[i] >= p.body[s] * ONE_I && a.cooldown[i] == 0;
            if ready && count[pi] < p.player_cap && kin[s][pi] < p.cap[s] {
                let half = a.energy[i] / 2;
                a.energy[i] -= half;
                a.cooldown[i] = p.breed[s];
                let (y, x, owner) = (a.y[i], a.x[i], a.owner[i]);
                a.push(s, owner, y, x, half, p.breed[s]);
                count[pi] += 1;
                kin[s][pi] += 1;
            }
        }
    }

    /// New targets: flee the nearest enemy hunter; else seek food in sight (predators: enemy
    /// prey; herbivores: enemy flora, then own flora; decomposers: dead biomass off enemy land;
    /// grazers skip cells whose stock cannot feed everyone of their kind there); else wander.
    fn decide(&mut self, fl: &FloraParams, st: &FloraState, rng: &mut Pcg32) {
        let safe = self.safe(fl, st);
        let (n, n2) = (st.n, st.n * st.n);
        let len = self.agents.len();
        let mut target: Vec<Option<(i64, i64)>> = vec![None; len];
        let mut species: Vec<usize> = self.agents.sp.iter().map(|&s| usize::from(s)).collect();
        species.sort_unstable();
        species.dedup();
        let a = &self.agents;
        let p = &self.p;
        let limit = |v: i64| v.clamp(HALF, centre(n - 1));

        // 1. Flee: step away from the nearest enemy hunter, one flora period's walk.
        for &v in &species {
            for pl in PLAYERS {
                let mut hunters = vec![false; n2];
                for j in 0..len {
                    if a.owner[j] == 3 - pl && p.eats_fauna[usize::from(a.sp[j])] >> v & 1 == 1 {
                        hunters[a.cell(j, n)] = true;
                    }
                }
                for i in 0..len {
                    if usize::from(a.sp[i]) != v || a.owner[i] != pl || safe[i] {
                        continue;
                    }
                    if let Some(h) = self.nearest(&hunters, n, a.cell(i, n), p.flee) {
                        let reach = p.speed[v] * p.every;
                        let ty = a.y[i] - (centre(h / n) - a.y[i]).clamp(-reach, reach);
                        let tx = a.x[i] - (centre(h % n) - a.x[i]).clamp(-reach, reach);
                        target[i] = Some((limit(ty), limit(tx)));
                    }
                }
            }
        }

        // 2. Seek food within sight.
        for &s in &species {
            for pl in PLAYERS {
                let mine: Vec<usize> = (0..len)
                    .filter(|&i| usize::from(a.sp[i]) == s && a.owner[i] == pl)
                    .collect();
                let mut idx: Vec<usize> = mine
                    .iter()
                    .copied()
                    .filter(|&i| target[i].is_none())
                    .collect();
                if idx.is_empty() {
                    continue;
                }
                let masks: Vec<Vec<bool>> = if p.role[s] == Role::Predator {
                    let mut prey = vec![false; n2];
                    for j in 0..len {
                        if a.owner[j] == 3 - pl && !safe[j] && p.eats_fauna[s] >> a.sp[j] & 1 == 1 {
                            prey[a.cell(j, n)] = true;
                        }
                    }
                    vec![prey]
                } else {
                    let mut crowd = vec![0i64; n2];
                    for &i in &mine {
                        crowd[a.cell(i, n)] += 1;
                    }
                    let stock = |k: usize| -> i64 {
                        if p.role[s] == Role::Herbivore {
                            (0..32)
                                .filter(|j| p.eats_flora[s] >> j & 1 == 1)
                                .map(|j| st.bio[j * n2 + k])
                                .max()
                                .unwrap_or(0)
                        } else {
                            st.dead[k]
                        }
                    };
                    let enough: Vec<bool> = (0..n2)
                        .map(|k| stock(k) >= p.bite[s] * crowd[k].max(1))
                        .collect();
                    idx.retain(|&i| {
                        let k = a.cell(i, n);
                        enough[k] || stock(k) < 1 // crowded cells: wander off instead
                    });
                    let on = |pred: &dyn Fn(u8) -> bool| -> Vec<bool> {
                        (0..n2).map(|k| enough[k] && pred(st.owner[k])).collect()
                    };
                    if p.role[s] == Role::Herbivore {
                        vec![on(&|o| o == 3 - pl), on(&|o| o == pl)]
                    } else {
                        vec![on(&|o| o != 3 - pl)]
                    }
                };
                for m in &masks {
                    idx.retain(|&i| match self.nearest(m, n, a.cell(i, n), p.sight[s]) {
                        Some(k) => {
                            target[i] = Some((centre(k / n), centre(k % n)));
                            false
                        }
                        None => true,
                    });
                }
            }
        }

        // 3. Everyone else wanders to a neighbouring cell (or stays).
        let a = &mut self.agents;
        for i in 0..len {
            let (ty, tx) = target[i].unwrap_or_else(|| {
                let dy = i64::from(rng.below(3)) - 1;
                let dx = i64::from(rng.below(3)) - 1;
                (
                    limit(centre(cell_of(a.y[i])) + dy * ONE_I),
                    limit(centre(cell_of(a.x[i])) + dx * ONE_I),
                )
            });
            a.ty[i] = ty;
            a.tx[i] = tx;
        }
    }

    /// Spawn a card of species `s` for `player` near the clicked cell (gamerules §6.3): its
    /// habitat on own land, then the trigger. Predators land on the enemy prey nearest the click;
    /// herbivores need enemy food within `herbivore_range` of own land and land on the own habitat
    /// cell nearest that food; decomposers land on the own habitat cell nearest the click.
    /// Returns the number spawned, or why nothing was.
    pub fn spawn(
        &mut self,
        fl: &FloraParams,
        st: &FloraState,
        player: u8,
        s: usize,
        (row, col): (usize, usize),
    ) -> Result<usize, String> {
        let (p, n, n2) = (&self.p, st.n, st.n * st.n);
        let a = &self.agents;
        let mine = (0..a.len()).filter(|&i| a.owner[i] == player).count();
        let kin = (0..a.len())
            .filter(|&i| a.owner[i] == player && usize::from(a.sp[i]) == s)
            .count();
        let count = p.group[s]
            .min(p.player_cap - i64::try_from(mine).unwrap_or(i64::MAX))
            .min(p.cap[s] - i64::try_from(kin).unwrap_or(i64::MAX));
        if count <= 0 {
            return Err("population cap reached".into());
        }
        let home: Vec<bool> = (0..n2)
            .map(|k| {
                st.owner[k] == player
                    && (0..fl.names.len())
                        .any(|j| p.habitat[s] >> j & 1 == 1 && st.bio[j * n2 + k] >= fl.est_thr[j])
            })
            .collect();
        if !home.contains(&true) {
            return Err("needs its habitat plants on your land".into());
        }
        let click = row * n + col;
        let at = match p.role[s] {
            Role::Predator => {
                let safe = self.safe(fl, st);
                let prey: Vec<bool> = {
                    let mut m = vec![false; n2];
                    for j in 0..a.len() {
                        if a.owner[j] == 3 - player
                            && !safe[j]
                            && p.eats_fauna[s] >> a.sp[j] & 1 == 1
                        {
                            m[a.cell(j, n)] = true;
                        }
                    }
                    m
                };
                closest(&prey, n, click).ok_or("no enemy prey to hunt")?
            }
            Role::Herbivore => {
                let mut reach: Vec<bool> = (0..n2).map(|k| st.owner[k] == player).collect();
                for _ in 0..p.herb_range {
                    reach = (0..n2)
                        .map(|k| {
                            let (y, x) = (k / n, k % n);
                            reach[k]
                                || (y > 0 && reach[k - n])
                                || (y + 1 < n && reach[k + n])
                                || (x > 0 && reach[k - 1])
                                || (x + 1 < n && reach[k + 1])
                        })
                        .collect();
                }
                let food: Vec<bool> = (0..n2)
                    .map(|k| {
                        reach[k]
                            && st.owner[k] == 3 - player
                            && (0..fl.names.len())
                                .any(|j| p.eats_flora[s] >> j & 1 == 1 && st.bio[j * n2 + k] >= 1)
                    })
                    .collect();
                let near =
                    closest(&food, n, click).ok_or("no enemy food it eats near your land")?;
                closest(&home, n, near).ok_or("needs its habitat plants on your land")?
            }
            Role::Decomposer => {
                closest(&home, n, click).ok_or("needs its habitat plants on your land")?
            }
        };
        let energy = p.body[s] * ONE_I / 2;
        for _ in 0..count {
            self.agents
                .push(s, player, centre(at / n), centre(at % n), energy, 0);
        }
        Ok(usize::try_from(count).unwrap_or(0))
    }

    /// The animals for renderers: u32 count, then per animal u32 id, u16 y, u16 x (position in
    /// 1/256 cell, measured from the cell corner so a centred animal sits at `cell * 256`),
    /// u8 species, u8 owner; little endian (the replay record layout, with sub-cell positions).
    #[must_use]
    pub fn frame(&self) -> Vec<u8> {
        let a = &self.agents;
        let mut out = Vec::with_capacity(4 + 10 * a.len());
        out.extend_from_slice(&u32::try_from(a.len()).unwrap_or(u32::MAX).to_le_bytes());
        let q8 = |v: i64| u16::try_from(((v - HALF).max(0)) >> 8).unwrap_or(u16::MAX);
        for i in 0..a.len() {
            out.extend_from_slice(&a.id[i].to_le_bytes());
            out.extend_from_slice(&q8(a.y[i]).to_le_bytes());
            out.extend_from_slice(&q8(a.x[i]).to_le_bytes());
            out.push(a.sp[i]);
            out.push(a.owner[i]);
        }
        out
    }
}

/// Serve bites on shared stocks: when the bites on one stock exceed it, each gets its pro-rata
/// share, rounded down on purpose so the shares never exceed the stock. Returns (agent, stock,
/// eaten) in order.
fn share(orders: &[(usize, usize, i64)], have: impl Fn(usize) -> i64) -> Vec<(usize, usize, i64)> {
    let mut demand: BTreeMap<usize, i64> = BTreeMap::new();
    for &(_, at, bite) in orders {
        *demand.entry(at).or_insert(0) += bite;
    }
    orders
        .iter()
        .map(|&(i, at, bite)| {
            let (d, h) = (demand[&at], have(at));
            (i, at, if d > h { bite * h / d.max(1) } else { bite })
        })
        .collect()
}

/// The `true` cell of `mask` closest to `to` (squared distance; ties: row-major order).
fn closest(mask: &[bool], n: usize, to: usize) -> Option<usize> {
    let d2 = |k: usize| (k / n).abs_diff(to / n).pow(2) + (k % n).abs_diff(to % n).pow(2);
    (0..mask.len())
        .filter(|&k| mask[k])
        .min_by_key(|&k| (d2(k), k))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flora::Flora;

    const BALANCE: &str = include_str!("../../data/balance.toml");
    const SPECIES: &str = include_str!("../../data/species.toml");

    fn setup(n: usize) -> (Flora, Fauna, FloraState, Pcg32) {
        let b = Balance::from_toml(BALANCE, SPECIES).unwrap();
        let flora = Flora::new(FloraParams::from_balance(&b));
        let fauna = Fauna::new(FaunaParams::from_balance(&b, &flora.p));
        let st = FloraState::new(&flora.p, n);
        (flora, fauna, st, Pcg32::new(1, 2))
    }

    /// Own the left half (P1) and right half (P2) of the map, covered by `plant` at full biomass.
    fn meadow(f: &Flora, st: &mut FloraState, plant: &str) {
        let (n, n2) = (st.n, st.n * st.n);
        let j = f.p.index(plant).unwrap();
        for k in 0..n2 {
            st.owner[k] = if k % n < n / 2 { 1 } else { 2 };
            st.bio[j * n2 + k] = f.p.kmax[j];
        }
    }

    #[test]
    fn walking_reaches_the_target_at_the_species_speed() {
        let (_, mut fa, _, _) = setup(8);
        fa.agents.push(0, 1, centre(1), centre(1), ONE_I, 0);
        fa.agents.ty[0] = centre(5);
        let v = fa.p.speed[0];
        fa.walk();
        assert_eq!(fa.agents.y[0], centre(1) + v);
        assert_eq!(fa.agents.x[0], centre(1), "no target on x: stays");
        for _ in 0..1000 {
            fa.walk();
        }
        assert_eq!(fa.agents.y[0], centre(5), "arrives and stops");
    }

    #[test]
    fn herbivores_graze_enemy_flora_and_decomposers_turn_litter_into_soil() {
        let (fl, mut fa, mut st, mut rng) = setup(8);
        meadow(&fl, &mut st, "grasses");
        let (voles, worms) = (
            fa.p.index("voles").unwrap(),
            fa.p.index("earthworms").unwrap(),
        );
        let g = fl.p.index("grasses").unwrap();
        let k = 3 * 8 + 6; // P2's land
        fa.agents.push(voles, 1, centre(3), centre(6), ONE_I, 0);
        st.dead[2 * 8 + 2] = 1000;
        fa.agents.push(worms, 1, centre(2), centre(2), ONE_I, 0);
        let before = st.bio[g * 64 + k];
        fa.act(&fl.p, &mut st, &mut rng);
        let eaten = before - st.bio[g * 64 + k];
        assert_eq!(eaten, fa.p.bite[voles], "full bite on enemy flora");
        assert!(st.dead[k] > 0, "what is not assimilated becomes litter");
        assert!(
            st.dead[2 * 8 + 2] < 1000 && st.soil[2 * 8 + 2] > 0,
            "litter -> soil"
        );
    }

    #[test]
    fn predators_eat_enemy_prey_but_not_in_a_refuge() {
        let (fl, mut fa, mut st, mut rng) = setup(8);
        meadow(&fl, &mut st, "grasses");
        let (fox, voles) = (fa.p.index("fox").unwrap(), fa.p.index("voles").unwrap());
        fa.agents.push(fox, 1, centre(1), centre(6), ONE_I * 100, 0);
        fa.agents
            .push(voles, 2, centre(1), centre(6), ONE_I * 100, 0);
        fa.act(&fl.p, &mut st, &mut rng);
        assert_eq!(fa.census(2)[voles], 0, "caught");

        // The same vole inside its own dense bramble is safe.
        let (fl, mut fa, mut st, mut rng) = setup(8);
        meadow(&fl, &mut st, "bramble");
        fa.agents.push(fox, 1, centre(1), centre(6), ONE_I * 100, 0);
        fa.agents
            .push(voles, 2, centre(1), centre(6), ONE_I * 100, 0);
        fa.act(&fl.p, &mut st, &mut rng);
        assert_eq!(fa.census(2)[voles], 1, "hidden in the refuge");
    }

    #[test]
    fn starving_animals_die_and_fed_ones_breed_under_the_cap() {
        let (fl, mut fa, mut st, mut rng) = setup(8);
        let worms = fa.p.index("earthworms").unwrap();
        fa.agents.push(worms, 1, centre(1), centre(1), 1, 0); // almost no energy
        fa.act(&fl.p, &mut st, &mut rng);
        assert!(
            fa.agents.is_empty() && st.dead[9] > 0,
            "starved; the carcass is litter"
        );

        let full = fa.p.body[worms] * ONE_I * 2;
        fa.p.cap[worms] = 3;
        for _ in 0..2 {
            fa.agents.push(worms, 1, centre(1), centre(1), full, 0);
        }
        fa.act(&fl.p, &mut st, &mut rng);
        assert_eq!(fa.census(1)[worms], 3, "one birth, then the species cap");
        assert_eq!(fa.agents.id, vec![1, 2, 3], "new ids, creation order");
    }

    #[test]
    fn spawn_follows_habitat_and_triggers() {
        let (fl, mut fa, mut st, _) = setup(16);
        let (worms, fox, voles) = (
            fa.p.index("earthworms").unwrap(),
            fa.p.index("fox").unwrap(),
            fa.p.index("voles").unwrap(),
        );
        assert!(
            fa.spawn(&fl.p, &st, 1, worms, (2, 2)).is_err(),
            "no habitat on bare land"
        );
        meadow(&fl, &mut st, "grasses");
        let got = fa.spawn(&fl.p, &st, 1, worms, (2, 12)).unwrap();
        assert_eq!(got, usize::try_from(fa.p.group[worms]).unwrap());
        assert_eq!(
            fa.agents.cell(0, 16),
            2 * 16 + 7,
            "own habitat cell nearest the click"
        );
        assert!(
            fa.spawn(&fl.p, &st, 1, fox, (2, 12)).is_err(),
            "fox needs its habitat (L2)"
        );
        let got = fa.spawn(&fl.p, &st, 2, voles, (5, 5)).unwrap();
        assert!(got > 0, "enemy grasses in range: voles may come");
    }

    #[test]
    fn frame_layout_matches_the_replay_record() {
        let (_, mut fa, _, _) = setup(8);
        fa.agents
            .push(2, 2, centre(3), centre(5) + ONE_I / 4, ONE_I, 0);
        let f = fa.frame();
        assert_eq!(f.len(), 4 + 10);
        assert_eq!(u32::from_le_bytes(f[0..4].try_into().unwrap()), 1);
        assert_eq!(u16::from_le_bytes([f[8], f[9]]), 3 * 256);
        assert_eq!(u16::from_le_bytes([f[10], f[11]]), 5 * 256 + 64);
        assert_eq!((f[12], f[13]), (2, 2));
    }
}
