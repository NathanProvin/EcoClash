//! Animals (gamerules §5.2, §6; D-023, D-026, D-052): agents on the flora grid, the Rust port of
//! the prototype's rules (`tools/prototype/fauna.py`). Two deliberate differences (D-052):
//! - movement is continuous: every tick an animal steers toward a target (fixed-point cells) at its
//!   speed, in any direction, plus a Brownian drift (D-065); targets are scattered inside cells.
//!   Decisions and feeding happen at each flora tick, as in the prototype;
//! - wandering draws from the world's PCG32, so the port is behaviour-equivalent, not bit-exact.
//!
//! At each flora tick, before the flora step: upkeep; feeding on the current cell (graze,
//! decompose, hunt); starvation; reproduction; then new targets (player orders first, then flee a
//! hunter, seek food, wander). Agents keep creation order; ids only grow and are never reused, so
//! renderers and orders can refer to them (no generation counter needed; D-053).

#![allow(clippy::needless_range_loop)] // parallel SoA arrays, indexed together

use std::collections::BTreeMap;

use crate::balance::DIET_RANKS;
use crate::balance::{Balance, Medium};
use crate::commands::OrderKind;
use crate::fixed::{ONE, div_round};
use crate::flora::{FloraParams, FloraState, U16, round};
use crate::hash::Hasher;
use crate::pathing;
use crate::rng::Pcg32;
use crate::terrain::SHALLOW;

const ONE_I: i64 = ONE as i64;
const HALF: i64 = ONE_I / 2;
const PLAYERS: [u8; 2] = [1, 2];
/// Standing orders (`Agents::order`).
const FREE: u8 = 0;
const MOVE: u8 = 1;
const ATTACK: u8 = 2;

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
    pub(crate) habitat: Vec<u32>,
    /// Flora eaten (herbivores), fauna eaten (predators): bitmasks, all ranks together.
    eats_flora: Vec<u32>,
    eats_fauna: Vec<u32>,
    /// The same, per diet rank (D-123): primary, secondary, tertiary.
    rank_flora: Vec<[u32; DIET_RANKS]>,
    rank_fauna: Vec<[u32; DIET_RANKS]>,
    /// Energy from a food of each rank, as a share of `transfer` (Q16).
    diet_yield: [i64; DIET_RANKS],
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
    /// Flora ticks a cell grazed bare stays barred to its former owner (D-098).
    lockout: i64,
    /// A drop lands within this many cells of the click (D-061).
    drop_radius: i64,
    flee: i64,
    refuge: u32,
    refuge_cover: i64,
    /// Local carrying capacity (D-066): flora ticks of bites per animal, prey per predator.
    reserve: i64,
    prey_per: i64,
    /// Catch distance (cells, each axis).
    strike: usize,
    /// Chance of a kill per flora tick (Q16).
    catch: i64,
    /// Organic movement (D-065, D-088), per species: drift kick per tick (Q16 share of speed),
    /// drift kept per tick (Q16), chance to rest at an idle decision (Q16); then the target scatter
    /// and stroll radius (Q16 cells).
    pub wobble: Vec<i64>,
    pub wobble_keep: Vec<i64>,
    rest: Vec<i64>,
    scatter: i64,
    wander: i64,
    /// Fluid motion (D-111): velocity gap closed per tick (Q16), and the pull toward the target
    /// per cell of distance (Q16), `steer / 4` so the approach is critically damped: no overshoot.
    steer: i64,
    pull: i64,
    /// Terrain (D-084): where each species can stand; speed share in shallows for walkers (Q16);
    /// cells a path search may explore.
    pub medium: Vec<Medium>,
    shallow_speed: i64,
    path_cells: usize,
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
    pub fn from_balance(b: &Balance) -> FaunaParams {
        let (fa, dt, one) = (&b.fauna, b.flora_dt(), f64::from(ONE));
        let hz = f64::from(b.sim.tick_hz);
        // A plant name, or a family name (L1..L4, W; D-087) for every plant of that family.
        let flora_mask = |names: &[String]| -> u32 {
            let mut m = 0;
            for n in names {
                for (i, (name, s)) in b.flora_species.iter().enumerate() {
                    if n == name || *n == s.family {
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
        // Diets by rank (D-123): the n-th food listed is rank n; a food listed twice keeps its first
        // rank.
        let ranked = |role: &str, mask: &dyn Fn(&String) -> u32| -> Vec<[u32; DIET_RANKS]> {
            sp.iter()
                .map(|s| {
                    let mut ranks = [0u32; DIET_RANKS];
                    let mut seen = 0u32;
                    if s.role == role {
                        for (r, e) in s.eats.iter().take(DIET_RANKS).enumerate() {
                            ranks[r] = mask(e) & !seen;
                            seen |= ranks[r];
                        }
                    }
                    ranks
                })
                .collect()
        };
        let rank_flora = ranked("herbivore", &|e| flora_mask(std::slice::from_ref(e)));
        let rank_fauna = ranked("predator", &|e| {
            names.iter().position(|n| n == e).map_or(0, |i| 1u32 << i)
        });
        let any = |r: &[u32; DIET_RANKS]| r.iter().fold(0, |m, x| m | x);
        let eats_fauna = rank_fauna.iter().map(any).collect();
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
            eats_flora: rank_flora.iter().map(any).collect(),
            eats_fauna,
            rank_flora,
            rank_fauna,
            diet_yield: std::array::from_fn(|r| {
                round(fa.diet_yield.get(r).copied().unwrap_or(1.0) * one)
            }),
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
            lockout: round(fa.lockout_s * hz / f64::from(b.sim.flora_every_ticks)),
            drop_radius: i64::from(fa.drop_radius),
            flee,
            refuge: flora_mask(&fa.refuge_flora),
            refuge_cover: round(fa.refuge_cover * one),
            reserve: round(fa.food_reserve / dt),
            prey_per: i64::from(fa.prey_per_predator),
            strike: usize::try_from(fa.strike_radius).unwrap_or(0),
            catch: round(fa.catch_chance * one),
            wobble: sp
                .iter()
                .map(|s| round(s.wobble.unwrap_or(fa.wobble) * one))
                .collect(),
            wobble_keep: sp
                .iter()
                .map(|s| round(s.wobble_keep.unwrap_or(fa.wobble_keep) * one))
                .collect(),
            rest: sp.iter().map(|s| round(s.rest * one)).collect(),
            scatter: round(fa.scatter * one),
            wander: round(fa.wander_radius * one),
            steer: round(fa.steer * one),
            pull: round(fa.steer / 4.0 * one),
            medium: sp.iter().map(|s| s.medium).collect(),
            shallow_speed: round(fa.shallow_speed * one),
            path_cells: usize::try_from(fa.path_cells).unwrap_or(1),
            player_cap: i64::from(b.agents.max_agents / 2),
            every: i64::from(b.sim.flora_every_ticks),
            offs,
            names,
        }
    }

    /// The rank of plant `plant` in herbivore `s`'s diet (0: primary), if it eats it (D-123).
    #[must_use]
    pub fn plant_rank(&self, s: usize, plant: usize) -> Option<usize> {
        let ranks = self.rank_flora.get(s)?;
        (0..DIET_RANKS).find(|&r| ranks[r] >> plant & 1 == 1)
    }

    /// The rank of animal species `prey` in predator `s`'s diet (0: primary), if it eats it.
    #[must_use]
    pub fn prey_rank(&self, s: usize, prey: usize) -> Option<usize> {
        let ranks = self.rank_fauna.get(s)?;
        (0..DIET_RANKS).find(|&r| ranks[r] >> prey & 1 == 1)
    }

    /// Energy from `amount` of a food of `rank`: the transfer, scaled by the rank's yield.
    fn fed(&self, amount: i64, rank: usize) -> i64 {
        div_round(amount * self.transfer * self.diet_yield[rank], ONE_I)
    }

    /// Whether herbivore species `s` eats plant species `plant`.
    #[must_use]
    pub fn eats_plant(&self, s: usize, plant: usize) -> bool {
        self.eats_flora.get(s).is_some_and(|m| m >> plant & 1 == 1)
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
            &self.wobble,
            &self.wobble_keep,
            &self.rest,
        ] {
            h.i64s(v);
        }
        h.i64s(&[
            self.transfer,
            self.diet_yield[0],
            self.diet_yield[1],
            self.diet_yield[2],
            self.own_graze,
            self.soil_per_dead,
            self.lockout,
            self.drop_radius,
            self.flee,
            i64::from(self.refuge),
            self.refuge_cover,
            self.reserve,
            self.prey_per,
            i64::try_from(self.strike).unwrap_or(0),
            self.catch,
            self.scatter,
            self.wander,
            self.steer,
            self.pull,
            self.shallow_speed,
            i64::try_from(self.path_cells).unwrap_or(0),
            self.player_cap,
        ]);
        h.i64s(&self.medium.iter().map(|&m| m as i64).collect::<Vec<_>>());
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
    /// Standing player order: 0 none, 1 move, 2 attack-move (gamerules §9; D-053).
    pub order: Vec<u8>,
    /// Destination of the order (Q16 cells).
    pub gy: Vec<i64>,
    pub gx: Vec<i64>,
    /// Brownian drift added to the walk each tick (Q16 cells per tick; D-065).
    pub wy: Vec<i64>,
    pub wx: Vec<i64>,
    /// Velocity (Q16 cells per tick; D-111): it eases toward the wanted one, so animals turn,
    /// start and stop progressively.
    pub vy: Vec<i64>,
    pub vx: Vec<i64>,
    /// Where it heads now on its way to the target, around obstacles (Q16 cells; D-084);
    /// `ROUTE` when a new route is due.
    pub py: Vec<i64>,
    pub px: Vec<i64>,
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

    pub(crate) fn push(
        &mut self,
        sp: usize,
        owner: u8,
        y: i64,
        x: i64,
        energy: i64,
        cooldown: i64,
    ) {
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
        self.order.push(FREE);
        self.gy.push(y);
        self.gx.push(x);
        self.wy.push(0);
        self.wx.push(0);
        self.vy.push(0);
        self.vx.push(0);
        self.py.push(y);
        self.px.push(x);
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
        filter(&mut self.order, keep);
        filter(&mut self.gy, keep);
        filter(&mut self.gx, keep);
        filter(&mut self.wy, keep);
        filter(&mut self.wx, keep);
        filter(&mut self.vy, keep);
        filter(&mut self.vx, keep);
        filter(&mut self.py, keep);
        filter(&mut self.px, keep);
    }

    pub fn hash_into(&self, h: &mut Hasher) {
        h.u64(u64::from(self.next_id)).u64(self.len() as u64);
        for i in 0..self.len() {
            h.u64(u64::from(self.id[i]))
                .u64(u64::from(self.sp[i]))
                .u64(u64::from(self.owner[i]))
                .u64(u64::from(self.order[i]));
        }
        for v in [
            &self.y,
            &self.x,
            &self.ty,
            &self.tx,
            &self.energy,
            &self.cooldown,
            &self.gy,
            &self.gx,
            &self.wy,
            &self.wx,
            &self.vy,
            &self.vx,
            &self.py,
            &self.px,
        ] {
            h.i64s(v);
        }
    }
}

/// `v` moved toward `w` by the share `steer` (Q16) of the gap; a gap too small to move rounds to
/// `w` itself, so a velocity never lingers at a few units (D-111).
fn ease(v: i64, w: i64, steer: i64) -> i64 {
    match div_round((w - v) * steer, ONE_I) {
        0 => w,
        d => v + d,
    }
}

fn cell_of(q: i64) -> usize {
    usize::try_from(q >> 16).unwrap_or(0)
}

fn centre(cell: usize) -> i64 {
    i64::try_from(cell).unwrap_or(0) * ONE_I + HALF
}

/// A waypoint is due (`Agents::py`), and one is reached within a quarter cell.
const ROUTE: i64 = i64::MIN;
const QUARTER: i64 = ONE_I / 4;
/// The waypoint is the farthest of this many next path cells in straight view.
const LOOKAHEAD: usize = 6;

/// Where to head next from `from` toward `to` (Q16 cells): `to` itself when the way is clear,
/// else a cell along a path around what it cannot stand on; None when no path is found.
fn waypoint(
    n: usize,
    stand: &dyn Fn(usize) -> bool,
    from: (i64, i64),
    to: (i64, i64),
    limit: usize,
) -> Option<(i64, i64)> {
    if pathing::line_clear(n, stand, from, to) {
        return Some(to);
    }
    let start = pathing::cell_at(from.0, from.1, n)?;
    let end = pathing::cell_at(to.0, to.1, n)?;
    let path = pathing::route(n, stand, start, end, limit)?;
    let seen = |k: usize| pathing::line_clear(n, stand, from, (centre(k / n), centre(k % n)));
    let next = path
        .iter()
        .skip(1)
        .take(LOOKAHEAD)
        .rev()
        .copied()
        .find(|&k| seen(k));
    let k = next.or_else(|| path.get(1).copied())?;
    Some((centre(k / n), centre(k % n)))
}

/// A uniform draw in `-r..=r`.
fn spread(rng: &mut Pcg32, r: i64) -> i64 {
    let bound = u32::try_from(2 * r.max(0) + 1).unwrap_or(u32::MAX);
    i64::from(rng.below(bound)) - r.max(0)
}

/// A fixed per-animal offset in `-r..=r` (multiplicative hash of the id and a salt), so a group
/// sent to one cell spreads inside it without an RNG draw.
fn offset(id: u32, salt: u32, r: i64) -> i64 {
    let h = id
        .wrapping_add(salt.wrapping_mul(0x9E37_79B9))
        .wrapping_mul(0x9E37_79B1)
        >> 8;
    i64::from(h) % (2 * r + 1).max(1) - r
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

    /// Give `player`'s animals among `ids` an order toward cell `goal` (gamerules §9). Other
    /// players' and unknown ids are ignored. Returns how many animals took it. Takes effect at
    /// once: the animals turn toward the goal now, not at the next flora tick.
    pub fn order(
        &mut self,
        player: u8,
        ids: &[u32],
        kind: OrderKind,
        goal: (usize, usize),
    ) -> usize {
        let a = &mut self.agents;
        let mut taken = 0;
        for id in ids {
            // Ids only grow and the list keeps creation order: it is sorted.
            let Ok(i) = a.id.binary_search(id) else {
                continue;
            };
            if a.owner[i] != player {
                continue;
            }
            taken += 1;
            if kind == OrderKind::Stop {
                a.order[i] = FREE;
                a.ty[i] = a.y[i];
                a.tx[i] = a.x[i];
                (a.py[i], a.px[i]) = (a.y[i], a.x[i]);
                continue;
            }
            a.order[i] = if kind == OrderKind::Move {
                MOVE
            } else {
                ATTACK
            };
            let r = self.p.scatter;
            (a.gy[i], a.gx[i]) = (
                centre(goal.0) + offset(a.id[i], 1, r),
                centre(goal.1) + offset(a.id[i], 2, r),
            );
            (a.ty[i], a.tx[i]) = (a.gy[i], a.gx[i]);
            a.py[i] = ROUTE;
        }
        taken
    }

    /// Every tick, on an `n x n` map: each animal steers toward its target (any direction, not per
    /// axis). Its velocity eases toward the wanted one, its speed capped, slowing as it nears the
    /// target (critically damped, D-111). On top comes its Brownian drift: a random kick each tick, of which
    /// `wobble_keep` carries over (a discrete Ornstein-Uhlenbeck walk), so paths curve and idle
    /// animals shuffle (D-065). Positions stay on the map.
    pub fn walk(&mut self, st: &FloraState, rng: &mut Pcg32) {
        let n = st.n;
        let (a, p) = (&mut self.agents, &self.p);
        let edge = i64::try_from(n).unwrap_or(1) * ONE_I - 1;
        for i in 0..a.len() {
            let s = usize::from(a.sp[i]);
            let medium = p.medium[s];
            let stand = |k: usize| medium.stands(st.ground[k]);
            // Obstacles (D-084): head for a waypoint, routed again when due or reached.
            let due = a.py[i] == ROUTE;
            let reached =
                !due && (a.py[i] - a.y[i]).abs() < QUARTER && (a.px[i] - a.x[i]).abs() < QUARTER;
            let there = a.py[i] == a.ty[i] && a.px[i] == a.tx[i];
            if due || (reached && !there) {
                let from = (a.y[i], a.x[i]);
                match waypoint(n, &stand, from, (a.ty[i], a.tx[i]), p.path_cells) {
                    Some((y, x)) => (a.py[i], a.px[i]) = (y, x),
                    None => {
                        // No way there: stay.
                        (a.ty[i], a.tx[i]) = from;
                        (a.py[i], a.px[i]) = from;
                    }
                }
            }
            let mut v = p.speed[s];
            if medium == Medium::Walk && st.ground[a.cell(i, n)] == SHALLOW {
                v = div_round(v * p.shallow_speed, ONE_I).max(1);
            }
            let (dy, dx) = (a.py[i] - a.y[i], a.px[i] - a.x[i]);
            let len = i64::try_from((dy * dy + dx * dx).unsigned_abs().isqrt()).unwrap_or(i64::MAX);
            let want = v.min(div_round(len * p.pull, ONE_I));
            let (wy, wx) = if len == 0 {
                (0, 0)
            } else {
                (div_round(dy * want, len), div_round(dx * want, len))
            };
            a.vy[i] = ease(a.vy[i], wy, p.steer);
            a.vx[i] = ease(a.vx[i], wx, p.steer);
            let (sy, sx) = (a.vy[i], a.vx[i]);
            let (kick, keep) = (div_round(v * p.wobble[s], ONE_I), p.wobble_keep[s]);
            a.wy[i] = div_round(a.wy[i] * keep, ONE_I) + spread(rng, kick);
            a.wx[i] = div_round(a.wx[i] * keep, ONE_I) + spread(rng, kick);
            // Never onto a cell it cannot stand on: drop the drift, else stay.
            let open = |y: i64, x: i64| pathing::cell_at(y, x, n).is_some_and(stand);
            let (y, x) = (
                (a.y[i] + sy + a.wy[i]).clamp(0, edge),
                (a.x[i] + sx + a.wx[i]).clamp(0, edge),
            );
            if open(y, x) {
                (a.y[i], a.x[i]) = (y, x);
            } else {
                (a.wy[i], a.wx[i]) = (0, 0);
                let (y, x) = ((a.y[i] + sy).clamp(0, edge), (a.x[i] + sx).clamp(0, edge));
                if open(y, x) {
                    (a.y[i], a.x[i]) = (y, x);
                } else {
                    (a.vy[i], a.vx[i]) = (0, 0); // blocked: it stops, then sets off again
                }
            }
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
        let alive = self.hunt(st, &safe, rng);
        self.starve_and_bury(st, alive);
        self.reproduce(fl, st);
        self.decide(fl, st, rng);
    }

    /// Herbivores graze the richest diet species of their cell: enemy flora at a full bite, own
    /// flora at `own_graze` of it, which feeds them as much as a full bite (they spare their own
    /// economy without starving at home; D-066). Bites on one stock are served pro rata when it
    /// runs short.
    fn graze(&mut self, st: &mut FloraState) {
        let (a, p, n, n2) = (&mut self.agents, &self.p, st.n, st.n * st.n);
        let mut orders: Vec<(usize, usize, i64)> = Vec::new(); // (agent, stock index, bite)
        let mut rank_by = vec![0usize; a.len()]; // the diet rank of each grazer's food
        let mut home = vec![false; a.len()];
        for i in 0..a.len() {
            let s = usize::from(a.sp[i]);
            let k = a.cell(i, n);
            if p.role[s] != Role::Herbivore || st.owner[k] == 0 {
                continue;
            }
            // The best-ranked food in the cell (D-123), then the one with the most biomass, then
            // the first.
            let mut pick: Option<(usize, usize, i64)> = None; // (rank, species, biomass)
            for j in 0..32 {
                if let Some(r) = p.plant_rank(s, j) {
                    let have = st.bio[j * n2 + k];
                    if have >= 1 && pick.is_none_or(|(pr, _, h)| r < pr || (r == pr && have > h)) {
                        pick = Some((r, j, have));
                    }
                }
            }
            if let Some((rank, j, _)) = pick {
                let mut bite = p.bite[s];
                if st.owner[k] == a.owner[i] {
                    bite = div_round(bite * p.own_graze, ONE_I);
                    home[i] = true;
                }
                orders.push((i, j * n2 + k, bite));
                rank_by[i] = rank;
            }
        }
        let mut raided: Vec<usize> = Vec::new(); // cells bitten by enemy grazers
        for (i, at, eaten) in share(&orders, |at| st.bio[at]) {
            st.bio[at] -= eaten;
            if !home[i] {
                raided.push(at % n2);
            }
            let rank = rank_by[i];
            let fed = if home[i] && p.own_graze > 0 {
                div_round(p.fed(eaten, rank) * ONE_I, p.own_graze)
            } else {
                p.fed(eaten, rank)
            };
            a.energy[i] += fed;
            st.dead[at % n2] += eaten - div_round(eaten * p.transfer, ONE_I);
        }
        // Eaten bare by the enemy (D-098): the cell turns neutral, and its former owner may not
        // take it back for a while, so the raider's plants can move in behind the front.
        raided.sort_unstable();
        raided.dedup();
        let species = st.bio.len() / n2;
        for k in raided {
            if st.owner[k] != 0 && (0..species).all(|s| st.bio[s * n2 + k] < 1) {
                st.lock[k] = p.lockout;
                st.lock_p[k] = st.owner[k];
                st.owner[k] = 0;
                st.prog[0][k] = 0;
                st.prog[1][k] = 0;
                for s in 0..species {
                    st.bio[s * n2 + k] = 0;
                    st.gauge[s * n2 + k] = 0;
                }
            }
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

    /// Predators kill one huntable enemy prey in reach (`strike` cells on each axis), in index order. A
    /// predator at full energy is sated and does not hunt (a handling limit, D-066). With prey in reach, a kill succeeds
    /// with chance `catch` (one draw per predator that has prey in reach). Returns who lives.
    fn hunt(&mut self, st: &mut FloraState, safe: &[bool], rng: &mut Pcg32) -> Vec<bool> {
        let (a, p, n) = (&mut self.agents, &self.p, st.n);
        let mut alive = vec![true; a.len()];
        for i in 0..a.len() {
            let s = usize::from(a.sp[i]);
            if p.role[s] != Role::Predator || !alive[i] || a.energy[i] >= p.body[s] * ONE_I {
                continue;
            }
            let k = a.cell(i, n);
            // The best-ranked prey in reach (D-123), the first in index order among equals.
            let mut prey: Option<(usize, usize)> = None; // (rank, agent)
            for j in 0..a.len() {
                if alive[j]
                    && !safe[j]
                    && a.owner[j] == 3 - a.owner[i]
                    && Window::within(a.cell(j, n), k, p.strike, n)
                    && let Some(r) = p.prey_rank(s, usize::from(a.sp[j]))
                    && prey.is_none_or(|(pr, _)| r < pr)
                {
                    prey = Some((r, j));
                }
            }
            if let Some((rank, j)) = prey
                && i64::from(rng.below(1 << 16)) < p.catch
            {
                alive[j] = false;
                let body = p.body[usize::from(a.sp[j])];
                a.energy[i] += p.fed(body, rank);
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

    /// At full energy, once its cooldown is over, an animal splits in two if the food within its
    /// sight can carry one more (local carrying capacity, D-066). The food is shared by every
    /// animal of the same role whose diet overlaps, each needing its share: grazers and
    /// decomposers `reserve` bites of their food (diet flora on any land; dead biomass), counted
    /// over both players since they eat the same plants and litter; predators `prey_per` huntable
    /// enemy prey, counted over their owner's predators only (each player's predators hunt the
    /// other's animals). The player and species caps stay as safety ceilings (D-023, D-029).
    fn reproduce(&mut self, fl: &FloraParams, st: &FloraState) {
        let safe = self.safe(fl, st);
        let (a, p, n, n2) = (&mut self.agents, &self.p, st.n, st.n * st.n);
        let ns = p.names.len();
        let mut count = [0i64; 2];
        let mut kin = vec![[0i64; 2]; ns];
        for i in 0..a.len() {
            let pi = usize::from(a.owner[i] - 1);
            count[pi] += 1;
            kin[usize::from(a.sp[i])][pi] += 1;
        }
        let len = a.len();
        let ready: Vec<bool> = (0..len)
            .map(|i| a.energy[i] >= p.body[usize::from(a.sp[i])] * ONE_I && a.cooldown[i] == 0)
            .collect();
        let need = |s: usize| -> i64 {
            if p.role[s] == Role::Predator {
                p.prey_per
            } else {
                p.bite[s] * p.reserve
            }
        };
        // Whether animal species `j` (owned by `oj`) competes with `s` (owned by `pl`) for food.
        let rival = |s: usize, pl: u8, j: usize, oj: u8| -> bool {
            p.role[j] == p.role[s]
                && match p.role[s] {
                    Role::Herbivore => p.eats_flora[s] & p.eats_flora[j] != 0,
                    Role::Decomposer => true,
                    Role::Predator => oj == pl && p.eats_fauna[s] & p.eats_fauna[j] != 0,
                }
        };
        // Food and load windows, built once per (species, player) with a ready animal.
        let mut windows: BTreeMap<(usize, u8), (Window, Window)> = BTreeMap::new();
        for i in (0..len).filter(|&i| ready[i]) {
            let (s, pl) = (usize::from(a.sp[i]), a.owner[i]);
            windows.entry((s, pl)).or_insert_with(|| {
                let mut food = vec![0i64; n2];
                let mut load = vec![0i64; n2];
                for j in 0..len {
                    let (k, sj) = (a.cell(j, n), usize::from(a.sp[j]));
                    if rival(s, pl, sj, a.owner[j]) {
                        load[k] += need(sj);
                    }
                    let prey = a.owner[j] == 3 - pl && !safe[j] && p.eats_fauna[s] >> sj & 1 == 1;
                    if p.role[s] == Role::Predator && prey {
                        food[k] += 1;
                    }
                }
                for k in 0..n2 {
                    food[k] += match p.role[s] {
                        Role::Herbivore => (0..32)
                            .filter(|j| p.eats_flora[s] >> j & 1 == 1)
                            .map(|j| st.bio[j * n2 + k])
                            .sum(),
                        Role::Decomposer => st.dead[k],
                        Role::Predator => 0,
                    };
                }
                (Window::new(&food, n), Window::new(&load, n))
            });
        }
        let mut born: Vec<(usize, u8, usize)> = Vec::new(); // (species, owner, cell) this tick
        for i in (0..len).filter(|&i| ready[i]) {
            let (s, pl) = (usize::from(a.sp[i]), a.owner[i]);
            let pi = usize::from(pl - 1);
            if count[pi] >= p.player_cap || kin[s][pi] >= p.cap[s] {
                continue;
            }
            let (food, load) = &windows[&(s, pl)];
            let (k, r) = (a.cell(i, n), usize::try_from(p.sight[s]).unwrap_or(0));
            let young: i64 = born
                .iter()
                .filter(|&&(bs, bo, bk)| rival(s, pl, bs, bo) && Window::within(bk, k, r, n))
                .map(|&(bs, _, _)| need(bs))
                .sum();
            if load.sum(k, r) + young + need(s) > food.sum(k, r) {
                continue; // the neighbourhood cannot feed one more
            }
            let half = a.energy[i] / 2;
            a.energy[i] -= half;
            a.cooldown[i] = p.breed[s];
            let (y, x) = (a.y[i], a.x[i]);
            a.push(s, pl, y, x, half, p.breed[s]);
            born.push((s, pl, k));
            count[pi] += 1;
            kin[s][pi] += 1;
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
        let a = &mut self.agents;
        // 0. Player orders: a move order holds until the goal cell is reached; an attack-move
        //    also ends there (it looks for enemy food on the way, in step 2).
        for i in 0..len {
            let arrived =
                cell_of(a.y[i]) == cell_of(a.gy[i]) && cell_of(a.x[i]) == cell_of(a.gx[i]);
            if a.order[i] != FREE && arrived {
                a.order[i] = FREE;
            }
            if a.order[i] == MOVE {
                target[i] = Some((a.gy[i], a.gx[i]));
            }
        }
        let a = &self.agents;
        let p = &self.p;
        let limit = |v: i64| v.clamp(HALF, centre(n - 1));

        // 1. Flee: step away from the nearest enemy hunter, one flora period's walk. Animals
        //    under orders hold their course.
        for &v in &species {
            for pl in PLAYERS {
                let mut hunters = vec![false; n2];
                for j in 0..len {
                    if a.owner[j] == 3 - pl && p.eats_fauna[usize::from(a.sp[j])] >> v & 1 == 1 {
                        hunters[a.cell(j, n)] = true;
                    }
                }
                for i in 0..len {
                    if usize::from(a.sp[i]) != v
                        || a.owner[i] != pl
                        || safe[i]
                        || a.order[i] != FREE
                    {
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
                // Seek order (D-123): the primary food in sight first, then the secondary, then the
                // tertiary.
                let masks: Vec<Vec<bool>> = if p.role[s] == Role::Predator {
                    (0..DIET_RANKS)
                        .map(|r| {
                            let mut prey = vec![false; n2];
                            for j in 0..len {
                                if a.owner[j] == 3 - pl
                                    && !safe[j]
                                    && p.rank_fauna[s][r] >> a.sp[j] & 1 == 1
                                {
                                    prey[a.cell(j, n)] = true;
                                }
                            }
                            for k in 0..n2 {
                                prey[k] &= p.medium[s].stands(st.ground[k]);
                            }
                            prey
                        })
                        .collect()
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
                    let stand = |k: usize| p.medium[s].stands(st.ground[k]);
                    if p.role[s] == Role::Herbivore {
                        // Per rank, [enemy food, food on any land]: an attack-move hunts the
                        // first, a free herbivore the second, with no enemy-first preference
                        // (D-061).
                        let mut masks = Vec::new();
                        for r in 0..DIET_RANKS {
                            let food = |k: usize| {
                                (0..32)
                                    .filter(|&j| p.rank_flora[s][r] >> j & 1 == 1)
                                    .map(|j| st.bio[j * n2 + k])
                                    .max()
                                    .unwrap_or(0)
                                    >= p.bite[s] * crowd[k].max(1)
                            };
                            let on = |pred: &dyn Fn(u8) -> bool| -> Vec<bool> {
                                (0..n2)
                                    .map(|k| food(k) && stand(k) && pred(st.owner[k]))
                                    .collect()
                            };
                            masks.push(on(&|o| o == 3 - pl));
                            masks.push(on(&|_| true));
                        }
                        masks
                    } else {
                        vec![
                            (0..n2)
                                .map(|k| enough[k] && stand(k) && st.owner[k] != 3 - pl)
                                .collect(),
                        ]
                    }
                };
                for (mi, m) in masks.iter().enumerate() {
                    idx.retain(|&i| {
                        let herbivore = p.role[s] == Role::Herbivore;
                        if herbivore && ((mi % 2 == 0) != (a.order[i] == ATTACK)) {
                            return true; // see the masks: attack-move even, free odd
                        }
                        match self.nearest(m, n, a.cell(i, n), p.sight[s]) {
                            Some(k) => {
                                let r = p.scatter;
                                target[i] = Some((
                                    centre(k / n) + offset(a.id[i], 3, r),
                                    centre(k % n) + offset(a.id[i], 4, r),
                                ));
                                false
                            }
                            None => true,
                        }
                    });
                }
            }
        }

        // 3. Attack-moves with nothing in sight head on; everyone else strolls to a random point
        //    within `wander` cells (D-065), centred one flora period ahead along its velocity so
        //    strolls meander on instead of turning back (D-111), or rests where it is, by its
        //    species' `rest` chance (stop-and-go grazing, D-088).
        let a = &mut self.agents;
        for i in 0..len {
            if target[i].is_none() && a.order[i] == ATTACK {
                target[i] = Some((a.gy[i], a.gx[i]));
            }
            let rest = self.p.rest[usize::from(a.sp[i])];
            if target[i].is_none() && rest > 0 && i64::from(rng.below(1 << 16)) < rest {
                target[i] = Some((a.y[i], a.x[i]));
            }
            let (ty, tx) = target[i].unwrap_or_else(|| {
                let (w, e) = (self.p.wander, self.p.every);
                (
                    limit(a.y[i] + a.vy[i] * e + spread(rng, w)),
                    limit(a.x[i] + a.vx[i] * e + spread(rng, w)),
                )
            });
            // A target it cannot stand on (a flight into a pond, a stroll onto rock): stay.
            let fits = pathing::cell_at(ty, tx, n)
                .is_some_and(|k| self.p.medium[usize::from(a.sp[i])].stands(st.ground[k]));
            let (ty, tx) = if fits { (ty, tx) } else { (a.y[i], a.x[i]) };
            if (ty, tx) != (a.ty[i], a.tx[i]) {
                a.py[i] = ROUTE;
            }
            a.ty[i] = ty;
            a.tx[i] = tx;
        }
    }

    /// Spawn a card of species `s` for `player` near the clicked cell (gamerules §6.3; D-061): it
    /// needs its habitat plants on own land. Decomposers, and herbivores called on own land, land
    /// on the own habitat cell nearest the click. Herbivores clicked elsewhere are dropped on the
    /// not-own cell with their food nearest the click, and predators on the huntable enemy prey
    /// nearest it, both within `drop_radius` cells of the click.
    /// Returns the number spawned, or why nothing was.
    pub fn spawn(
        &mut self,
        fl: &FloraParams,
        st: &FloraState,
        player: u8,
        s: usize,
        click: (usize, usize),
    ) -> Result<usize, String> {
        let (at, count) = self.spawn_site(fl, st, player, s, click)?;
        self.place(s, player, at, count, st.n);
        Ok(usize::try_from(count).unwrap_or(0))
    }

    /// Where a card of species `s` would land for `player` and how many animals it would bring
    /// (gamerules §6.3, see `spawn`), without placing them: the caller may charge first.
    pub fn spawn_site(
        &self,
        fl: &FloraParams,
        st: &FloraState,
        player: u8,
        s: usize,
        (row, col): (usize, usize),
    ) -> Result<(usize, i64), String> {
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
        let stand = |k: usize| p.medium[s].stands(st.ground[k]);
        let home: Vec<bool> = (0..n2)
            .map(|k| {
                stand(k)
                    && st.owner[k] == player
                    && (0..fl.names.len())
                        .any(|j| p.habitat[s] >> j & 1 == 1 && st.bio[j * n2 + k] >= fl.est_thr[j])
            })
            .collect();
        if !home.contains(&true) {
            return Err("needs its habitat plants on your land".into());
        }
        let click = row * n + col;
        // Drops land within `drop_radius` cells of the click (gamerules §6.3 r_prey; D-061).
        let r2 = p.drop_radius * p.drop_radius;
        let near_click = |k: usize| i64::try_from(dist2(k, click, n)).unwrap_or(i64::MAX) <= r2;
        let at = match p.role[s] {
            Role::Predator => {
                let safe = self.safe(fl, st);
                let prey: Vec<bool> = {
                    let mut m = vec![false; n2];
                    for j in 0..a.len() {
                        let k = a.cell(j, n);
                        if a.owner[j] == 3 - player
                            && stand(k)
                            && !safe[j]
                            && p.eats_fauna[s] >> a.sp[j] & 1 == 1
                            && near_click(k)
                        {
                            m[k] = true;
                        }
                    }
                    m
                };
                closest(&prey, n, click).ok_or("no enemy prey near that spot")?
            }
            // On own land: the own habitat cell nearest the click, to build biomass. Elsewhere: a
            // drop on the food of its diet nearest the click (D-061).
            Role::Herbivore if st.owner[click] == player => {
                closest(&home, n, click).ok_or("needs its habitat plants on your land")?
            }
            Role::Herbivore => {
                let food: Vec<bool> = (0..n2)
                    .map(|k| {
                        st.owner[k] != player
                            && stand(k)
                            && near_click(k)
                            && (0..fl.names.len())
                                .any(|j| p.eats_flora[s] >> j & 1 == 1 && st.bio[j * n2 + k] >= 1)
                    })
                    .collect();
                closest(&food, n, click).ok_or("no food it eats near that spot")?
            }
            Role::Decomposer => {
                closest(&home, n, click).ok_or("needs its habitat plants on your land")?
            }
        };
        Ok((at, count))
    }

    /// Place `count` animals of species `s` for `player` on cell `at`, at half energy.
    pub fn place(&mut self, s: usize, player: u8, at: usize, count: i64, n: usize) {
        let energy = self.p.body[s] * ONE_I / 2;
        for _ in 0..count {
            self.agents
                .push(s, player, centre(at / n), centre(at % n), energy, 0);
        }
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

/// Sums of a grid over square windows, in O(1) each (2D prefix sums).
struct Window {
    n: usize,
    /// `acc[(y + 1) * (n + 1) + x + 1]` = sum of the cells above and left of (y, x), inclusive.
    acc: Vec<i64>,
}

impl Window {
    fn new(grid: &[i64], n: usize) -> Window {
        let mut acc = vec![0i64; (n + 1) * (n + 1)];
        for y in 0..n {
            for x in 0..n {
                acc[(y + 1) * (n + 1) + x + 1] =
                    grid[y * n + x] + acc[y * (n + 1) + x + 1] + acc[(y + 1) * (n + 1) + x]
                        - acc[y * (n + 1) + x];
            }
        }
        Window { n, acc }
    }

    /// The sum over the cells within `r` of cell `k` on both axes (clipped to the map).
    fn sum(&self, k: usize, r: usize) -> i64 {
        let (n, w) = (self.n, self.n + 1);
        let (y0, x0) = ((k / n).saturating_sub(r), (k % n).saturating_sub(r));
        let (y1, x1) = ((k / n + r + 1).min(n), (k % n + r + 1).min(n));
        self.acc[y1 * w + x1] - self.acc[y0 * w + x1] - self.acc[y1 * w + x0]
            + self.acc[y0 * w + x0]
    }

    /// Whether cell `a` lies in the window of radius `r` around cell `b`.
    fn within(a: usize, b: usize, r: usize, n: usize) -> bool {
        (a / n).abs_diff(b / n) <= r && (a % n).abs_diff(b % n) <= r
    }
}

/// Squared distance between cells `a` and `b` of an `n`-wide grid.
fn dist2(a: usize, b: usize, n: usize) -> usize {
    (a / n).abs_diff(b / n).pow(2) + (a % n).abs_diff(b % n).pow(2)
}

/// The `true` cell of `mask` closest to `to` (squared distance; ties: row-major order).
fn closest(mask: &[bool], n: usize, to: usize) -> Option<usize> {
    (0..mask.len())
        .filter(|&k| mask[k])
        .min_by_key(|&k| (dist2(k, to, n), k))
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
        let fauna = Fauna::new(FaunaParams::from_balance(&b));
        let st = FloraState::new(&flora.p, n);
        (flora, fauna, st, Pcg32::new(1, 2))
    }

    /// D-098: a cell eaten bare by enemy grazers turns neutral; its former owner may not take it
    /// back until the lockout runs out, while the raider may.
    #[test]
    fn grazing_a_cell_bare_frees_it_and_bars_its_former_owner() {
        let (mut f, mut fa, mut st, _) = setup(6);
        let (grass, n2, k) = (f.p.index("grasses").unwrap(), 36, 2 * 6 + 2);
        st.owner[k] = 2;
        st.bio[grass * n2 + k] = 3; // a last tuft
        st.gauge[grass * n2 + k] = ONE_I / 2;
        let rabbits = fa.p.index("rabbits").unwrap();
        fa.agents.push(rabbits, 1, centre(2), centre(2), ONE_I, 0);
        fa.graze(&mut st);
        assert_eq!(st.owner[k], 0, "neutral again");
        assert_eq!(st.lock_p[k], 2);
        assert_eq!(st.lock[k], fa.p.lockout);
        assert!(fa.p.lockout > 0);
        f.step(&mut st);
        assert_eq!(
            st.lock[k],
            fa.p.lockout - 1,
            "the lockout runs down each flora tick"
        );
        assert_eq!(
            f.plant(&mut st, 2, grass, &[k]),
            0,
            "the former owner is barred"
        );
        assert_eq!(
            f.plant(&mut st, 1, grass, &[k]),
            1,
            "the raider may take it"
        );
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

    /// Fluid motion (D-111): an animal sets off and turns progressively, keeps a straight line
    /// at any angle, never beats its speed, never turns back on itself, and settles on its target
    /// without overshooting.
    #[test]
    fn walking_eases_straight_to_the_target_without_overshoot() {
        let (_, mut fa, st, mut rng) = setup(8);
        fa.p.wobble.fill(0); // no drift: the pure steering
        fa.agents.push(0, 1, centre(1), centre(1), ONE_I, 0);
        (fa.agents.ty[0], fa.agents.tx[0]) = (centre(5), centre(4)); // a 3-4-5 triangle
        let v = fa.p.speed[0];
        let dist = |a: &Agents| {
            let (dy, dx) = (centre(5) - a.y[0], centre(4) - a.x[0]);
            (dy * dy + dx * dx).isqrt()
        };
        fa.walk(&st, &mut rng);
        let (dy, dx) = (fa.agents.y[0] - centre(1), fa.agents.x[0] - centre(1));
        assert!(dy > 0 && dy < v, "a soft start, not full speed at once");
        assert!((dy * 3 - dx * 4).abs() <= 4, "along the straight line");
        let (mut last, mut gap) = ((dy, dx), dist(&fa.agents));
        for _ in 0..1000 {
            let (y, x) = (fa.agents.y[0], fa.agents.x[0]);
            fa.walk(&st, &mut rng);
            let step = (fa.agents.y[0] - y, fa.agents.x[0] - x);
            assert!(
                step.0 * step.0 + step.1 * step.1 <= v * v + 2 * v,
                "never beats its speed"
            );
            assert!(step.0 * last.0 + step.1 * last.1 >= 0, "never turns back");
            let now = dist(&fa.agents);
            assert!(
                now <= gap.max(ONE_I / 1024),
                "no overshoot (beyond rounding): {gap} -> {now}"
            );
            (last, gap) = (step, now);
        }
        assert!(gap <= ONE_I / 256, "settles on the target ({gap})");
    }

    /// Movement per species (D-088): a rabbit drifts far less than a grasshopper, and rests at
    /// idle decisions, so over a while it covers much less ground.
    /// Fluid motion (D-111): a strolling deer or rabbit turns a little per tick and changes speed
    /// gradually; it never spins on the spot or lurches to full speed.
    #[test]
    fn strolling_mammals_turn_and_speed_up_gradually() {
        for name in ["rabbits", "roe_deer", "bison"] {
            let (f, mut fa, st, mut rng) = setup(16);
            let s = fa.p.index(name).unwrap();
            fa.agents.push(s, 1, centre(8), centre(8), ONE_I, 0);
            let v = fa.p.speed[s] as f64;
            let (mut last, mut turn, mut accel, mut moving) = ((0.0f64, 0.0f64), 0.0f64, 0.0f64, 0);
            for t in 0..2000 {
                if t % 8 == 0 {
                    fa.decide(&f.p, &st, &mut rng);
                    fa.agents.energy.fill(fa.p.body[s] * ONE_I); // never hungry
                }
                let (y, x) = (fa.agents.y[0], fa.agents.x[0]);
                fa.walk(&st, &mut rng);
                let step = ((fa.agents.y[0] - y) as f64, (fa.agents.x[0] - x) as f64);
                let (a, b) = (step.0.hypot(step.1), last.0.hypot(last.1));
                accel = accel.max((a - b).abs() / v);
                if a > 0.3 * v && b > 0.3 * v {
                    moving += 1;
                    let c = (step.0 * last.0 + step.1 * last.1) / (a * b);
                    turn = turn.max(c.clamp(-1.0, 1.0).acos());
                }
                last = step;
            }
            assert!(moving > 100, "{name} strolls ({moving} ticks)");
            assert!(
                turn < 0.6,
                "{name} turns gradually ({turn:.2} rad in a tick)"
            );
            assert!(
                accel < 0.3,
                "{name} speeds up gradually ({accel:.2} of its speed)"
            );
        }
    }

    #[test]
    fn calm_species_drift_less_and_rest_between_strolls() {
        let (f, mut fa, st, mut rng) = setup(12);
        let (rabbit, hopper) = (
            fa.p.index("rabbits").unwrap(),
            fa.p.index("grasshoppers").unwrap(),
        );
        assert!(fa.p.wobble[rabbit] < fa.p.wobble[hopper]);
        for s in [rabbit, hopper] {
            fa.agents.push(s, 1, centre(6), centre(6), ONE_I, 0);
        }
        let mut path = [0i64; 2];
        let mut stayed = 0;
        for t in 0..800 {
            if t % 8 == 0 {
                fa.decide(&f.p, &st, &mut rng);
                let a = &fa.agents;
                stayed += i32::from((a.ty[0], a.tx[0]) == (a.y[0], a.x[0]));
                fa.agents.energy.fill(fa.p.body[rabbit] * ONE_I); // never hungry
            }
            let before = (fa.agents.y.clone(), fa.agents.x.clone());
            fa.walk(&st, &mut rng);
            for (j, d) in path.iter_mut().enumerate() {
                *d += (fa.agents.y[j] - before.0[j]).abs() + (fa.agents.x[j] - before.1[j]).abs();
            }
        }
        assert!(
            path[0] * 2 < path[1],
            "the rabbit moves much less: {path:?}"
        );
        assert!(
            stayed > 10,
            "the rabbit rests at idle decisions ({stayed} of 100)"
        );
    }

    #[test]
    fn the_drift_makes_idle_animals_shuffle_near_their_spot() {
        let (_, mut fa, st, mut rng) = setup(8);
        fa.agents.push(0, 1, centre(0), centre(0), ONE_I, 0); // a corner: the edge holds
        let (mut moved, mut far) = (false, 0);
        for _ in 0..500 {
            fa.walk(&st, &mut rng);
            let a = &fa.agents;
            moved |= a.y[0] != centre(0) || a.x[0] != centre(0);
            far = far.max((a.y[0] - centre(0)).abs().max((a.x[0] - centre(0)).abs()));
            assert!(a.y[0] >= 0 && a.x[0] >= 0, "stays on the map");
        }
        assert!(moved, "it shuffles");
        assert!(
            far < ONE_I,
            "but the steering keeps it within a cell of its spot"
        );
    }

    #[test]
    fn herbivores_graze_enemy_flora_and_decomposers_turn_litter_into_soil() {
        let (fl, mut fa, mut st, mut rng) = setup(8);
        meadow(&fl, &mut st, "grasses");
        let (rabbits, worms) = (
            fa.p.index("rabbits").unwrap(),
            fa.p.index("earthworms").unwrap(),
        );
        let g = fl.p.index("grasses").unwrap();
        let k = 3 * 8 + 6; // P2's land
        fa.agents.push(rabbits, 1, centre(3), centre(6), ONE_I, 0);
        st.dead[2 * 8 + 2] = 1000;
        fa.agents.push(worms, 1, centre(2), centre(2), ONE_I, 0);
        let before = st.bio[g * 64 + k];
        fa.act(&fl.p, &mut st, &mut rng);
        let eaten = before - st.bio[g * 64 + k];
        assert_eq!(eaten, fa.p.bite[rabbits], "full bite on enemy flora");
        assert!(st.dead[k] > 0, "what is not assimilated becomes litter");
        assert!(
            st.dead[2 * 8 + 2] < 1000 && st.soil[2 * 8 + 2] > 0,
            "litter -> soil"
        );
    }

    #[test]
    fn predators_eat_enemy_prey_in_reach_but_not_in_a_refuge_nor_when_sated() {
        let (fox, rabbits) = {
            let (_, fa, _, _) = setup(8);
            (fa.p.index("fox").unwrap(), fa.p.index("rabbits").unwrap())
        };
        // One hungry fox next to (not on) a rabbit; `plant` covers the map; `catch` in Q16.
        let run = |plant: &str, fox_energy: i64, catch: i64| {
            let (fl, mut fa, mut st, mut rng) = setup(8);
            meadow(&fl, &mut st, plant);
            fa.p.catch = catch;
            fa.agents.push(fox, 1, centre(1), centre(5), fox_energy, 0);
            fa.agents
                .push(rabbits, 2, centre(2), centre(6), ONE_I * 100, 0);
            fa.act(&fl.p, &mut st, &mut rng);
            fa.census(2)[rabbits]
        };
        let hungry = ONE_I * 100;
        assert_eq!(
            run("grasses", hungry, ONE_I),
            0,
            "caught within strike reach"
        );
        assert_eq!(run("grasses", hungry, 0), 1, "a missed attack");
        assert_eq!(run("bramble", hungry, ONE_I), 1, "hidden in the refuge");
        let full = ONE_I * 3100; // above the fox's body after its upkeep
        assert_eq!(run("grasses", full, ONE_I), 1, "a sated fox does not hunt");
    }

    /// D-125: cattails are a refuge in the water: a small roach in its owner's dense cattails
    /// cannot be hunted; in open water it can.
    #[test]
    fn cattails_hide_small_water_animals() {
        let (fl, mut fa, mut st, _) = setup(8);
        let (roach, cattails) = (
            fa.p.index("roach").unwrap(),
            fl.p.index("cattails").unwrap(),
        );
        let k = 3 * 8 + 3;
        st.owner[k] = 2;
        fa.agents.push(roach, 2, centre(3), centre(3), ONE_I, 0);
        assert_eq!(fa.safe(&fl.p, &st), vec![false], "open water");
        st.bio[cattails * 64 + k] = fl.p.kmax[cattails];
        assert_eq!(fa.safe(&fl.p, &st), vec![true], "hidden in the cattails");
    }

    #[test]
    fn herbivores_feed_as_well_at_home_on_a_smaller_bite() {
        let (fl, mut fa, mut st, mut rng) = setup(8);
        meadow(&fl, &mut st, "grasses");
        let rabbits = fa.p.index("rabbits").unwrap();
        let g = fl.p.index("grasses").unwrap();
        fa.agents.push(rabbits, 1, centre(3), centre(1), ONE_I, 0); // own land
        fa.agents.push(rabbits, 1, centre(3), centre(6), ONE_I, 0); // enemy land
        let before = [st.bio[g * 64 + 3 * 8 + 1], st.bio[g * 64 + 3 * 8 + 6]];
        fa.act(&fl.p, &mut st, &mut rng);
        let eaten = [
            before[0] - st.bio[g * 64 + 3 * 8 + 1],
            before[1] - st.bio[g * 64 + 3 * 8 + 6],
        ];
        assert!(eaten[0] * 4 < eaten[1], "own plants: a much smaller bite");
        let gain = fa.agents.energy[0] - fa.agents.energy[1];
        assert!(gain.abs() <= ONE_I, "but the same energy");
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
        assert_eq!(
            fa.census(1)[worms],
            2,
            "no litter around: no room for young"
        );
        st.dead.fill(1_000_000);
        fa.agents.energy.fill(full);
        fa.act(&fl.p, &mut st, &mut rng);
        assert_eq!(
            fa.census(1)[worms],
            3,
            "food: one birth, then the species cap"
        );
        assert_eq!(fa.agents.id, vec![1, 2, 3], "new ids, creation order");
    }

    #[test]
    fn births_stop_at_the_local_carrying_capacity() {
        let (fl, mut fa, mut st, mut rng) = setup(16);
        let worms = fa.p.index("earthworms").unwrap();
        let need = fa.p.bite[worms] * fa.p.reserve; // litter per worm in sight
        st.dead[8 * 16 + 8] = need * 3; // room for three worms around the centre
        let full = fa.p.body[worms] * ONE_I * 2;
        for _ in 0..3 {
            fa.agents.push(worms, 1, centre(8), centre(8), full, 0);
        }
        fa.act(&fl.p, &mut st, &mut rng);
        assert_eq!(fa.census(1)[worms], 3, "already at capacity: no birth");
        st.dead[8 * 16 + 8] = need * 5 + 100; // (+ the bites eaten before breeding)
        fa.agents.energy.fill(full);
        fa.act(&fl.p, &mut st, &mut rng);
        assert_eq!(
            fa.census(1)[worms],
            5,
            "room for two more: two births, not three"
        );
    }

    #[test]
    fn spawn_follows_habitat_and_triggers() {
        let (fl, mut fa, mut st, _) = setup(16);
        let (worms, fox, rabbits) = (
            fa.p.index("earthworms").unwrap(),
            fa.p.index("fox").unwrap(),
            fa.p.index("rabbits").unwrap(),
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
        let got = fa.spawn(&fl.p, &st, 2, rabbits, (5, 5)).unwrap();
        assert!(got > 0, "enemy grasses in range: rabbits may come");
    }

    #[test]
    fn orders_steer_own_animals_until_they_arrive() {
        let (fl, mut fa, mut st, mut rng) = setup(16);
        meadow(&fl, &mut st, "grasses");
        let rabbits = fa.p.index("rabbits").unwrap();
        fa.agents
            .push(rabbits, 1, centre(2), centre(2), ONE_I * 100, 0);
        fa.agents
            .push(rabbits, 2, centre(2), centre(12), ONE_I * 100, 0);
        assert_eq!(
            fa.order(1, &[0, 1, 99], OrderKind::Move, (14, 2)),
            1,
            "own animals only"
        );
        assert_eq!(
            (cell_of(fa.agents.ty[0]), cell_of(fa.agents.tx[0])),
            (14, 2),
            "turns at once, to a point inside the goal cell"
        );
        assert_eq!(fa.agents.ty[1], centre(2), "the enemy rabbit ignores it");
        for t in 0..400 {
            fa.walk(&st, &mut rng);
            if t % 8 == 0 {
                fa.act(&fl.p, &mut st, &mut rng); // food all around: an order ignores it
            }
            if fa.agents.order[0] == FREE {
                break;
            }
        }
        assert_eq!(
            fa.agents.cell(0, 16),
            14 * 16 + 2,
            "arrived, then free again"
        );
        assert_eq!(fa.agents.order[0], FREE);

        fa.order(1, &[0], OrderKind::Attack, (2, 2));
        fa.act(&fl.p, &mut st, &mut rng);
        let enemy_land = |ty: i64, tx: i64| st.owner[cell_of(ty) * 16 + cell_of(tx)] == 2;
        assert!(
            enemy_land(fa.agents.ty[0], fa.agents.tx[0]) || cell_of(fa.agents.ty[0]) == 2,
            "attack-move: enemy food in sight, else the goal"
        );
        fa.order(1, &[0], OrderKind::Stop, (0, 0));
        assert_eq!(
            (fa.agents.order[0], fa.agents.ty[0]),
            (FREE, fa.agents.y[0]),
            "stops now"
        );
    }

    #[test]
    fn herbivores_come_on_own_land_or_are_dropped_on_food_near_the_click() {
        let (fl, fa, mut st, _) = setup(16);
        let (rabbits, caterpillars) = (
            fa.p.index("rabbits").unwrap(),
            fa.p.index("caterpillars").unwrap(),
        );
        let g = fl.p.index("grasses").unwrap();
        for k in 0..256 {
            if k % 16 < 8 {
                st.owner[k] = 1; // P1: the left half, grass
                st.bio[g * 256 + k] = fl.p.kmax[g];
            }
        }
        // Own land, no enemy food anywhere: the call still works (no trigger any more).
        let (at, _) = fa.spawn_site(&fl.p, &st, 1, rabbits, (2, 3)).unwrap();
        assert_eq!(at, 2 * 16 + 3, "own habitat cell nearest the click");
        // P2 grass on the right half: a click there drops the rabbits on it, where clicked.
        for k in 0..256 {
            if k % 16 >= 8 {
                st.owner[k] = 2;
                st.bio[g * 256 + k] = fl.p.kmax[g];
            }
        }
        let (at, _) = fa.spawn_site(&fl.p, &st, 1, rabbits, (5, 12)).unwrap();
        assert_eq!(
            (at, st.owner[at]),
            (5 * 16 + 12, 2),
            "dropped on enemy food"
        );
        // Caterpillars eat nettle, bramble, shrubs and trees: none near that spot.
        let nettle = fl.p.index("nettle").unwrap();
        st.bio[nettle * 256 + 16] = fl.p.kmax[nettle]; // their habitat, on P1's land
        let err = fa
            .spawn_site(&fl.p, &st, 1, caterpillars, (5, 12))
            .unwrap_err();
        assert!(err.contains("no food"), "{err}");
        st.bio[nettle * 256 + 5 * 16 + 14] = fl.p.kmax[nettle]; // enemy nettle, 2 cells away
        let (at, _) = fa.spawn_site(&fl.p, &st, 1, caterpillars, (5, 12)).unwrap();
        assert_eq!(at, 5 * 16 + 14, "on the enemy nettle nearest the click");
    }

    #[test]
    fn predators_are_dropped_on_prey_near_the_click_only() {
        let (fl, mut fa, mut st, _) = setup(16);
        meadow(&fl, &mut st, "elder"); // L3: the fox's habitat (not a refuge)
        let (fox, rabbits) = (fa.p.index("fox").unwrap(), fa.p.index("rabbits").unwrap());
        fa.agents.push(rabbits, 2, centre(3), centre(13), ONE_I, 0);
        assert!(
            fa.spawn_site(&fl.p, &st, 1, fox, (12, 3))
                .unwrap_err()
                .contains("near that spot")
        );
        let (at, _) = fa.spawn_site(&fl.p, &st, 1, fox, (4, 12)).unwrap();
        assert_eq!(at, 3 * 16 + 13, "on the prey");
    }

    #[test]
    fn free_herbivores_feed_on_the_nearest_food_not_on_the_enemy_first() {
        let (fl, mut fa, mut st, mut rng) = setup(16);
        meadow(&fl, &mut st, "grasses");
        let rabbits = fa.p.index("rabbits").unwrap();
        fa.agents
            .push(rabbits, 1, centre(8), centre(4), ONE_I * 100, 0); // 4 cells from P2's land
        fa.act(&fl.p, &mut st, &mut rng);
        let a = &fa.agents;
        assert_eq!(
            st.owner[cell_of(a.ty[0]) * 16 + cell_of(a.tx[0])],
            1,
            "stays on own food"
        );
        fa.order(1, &[a.id[0]], OrderKind::Attack, (8, 12));
        fa.act(&fl.p, &mut st, &mut rng);
        let a = &fa.agents;
        assert_eq!(
            st.owner[cell_of(a.ty[0]) * 16 + cell_of(a.tx[0])],
            2,
            "attack-move: enemy food"
        );
    }

    /// Predator-prey runs on a 64² meadow with the caps lifted, so only food limits the
    /// populations (D-066): P2 rabbits grazing at home among bramble clumps (refuges, capped at 3 % of the map), five P1 foxes
    /// dropped among them after 2 minutes. One line per seed: rabbits/foxes every 160 s, 48 min.
    /// Run: `cargo test -p sim-core --release -- --ignored --nocapture lotka_volterra_report`.
    #[test]
    #[ignore = "report, not a check"]
    fn lotka_volterra_report() {
        for seed in 1..=4 {
            let (mut fl, mut fa, mut st, _) = setup(64);
            let mut rng = Pcg32::new(seed, 2);
            meadow(&fl, &mut st, "grasses");
            let (fox, rabbits) = (fa.p.index("fox").unwrap(), fa.p.index("rabbits").unwrap());
            let (g, b) = (
                fl.p.index("grasses").unwrap(),
                fl.p.index("bramble").unwrap(),
            );
            for k in 0..4096 {
                st.gauge[g * 4096 + k] = ONE_I; // an established meadow on developed soil
                st.soil[k] = U16;
                if k % 64 >= 32 && k / 64 % 6 < 2 && k % 6 < 2 {
                    st.bio[b * 4096 + k] = fl.p.kmax[b];
                    st.gauge[b * 4096 + k] = ONE_I;
                }
            }
            fl.p.cap[b] = ONE_I * 3 / 100; // refuges stay patches: 3 % of the map
            fa.p.cap[rabbits] = 5000;
            fa.p.player_cap = 5000;
            fa.p.cap[fox] = 90;
            for k in 0..12 {
                fa.agents
                    .push(rabbits, 2, centre(20 + k), centre(40 + k), ONE_I * 150, 0);
            }
            let mut line = format!("seed {seed}:");
            for t in 0..3600 {
                if t == 150 {
                    for k in 0..5 {
                        fa.agents
                            .push(fox, 1, centre(22 + 3 * k), centre(45), ONE_I * 1500, 0);
                    }
                }
                for _ in 0..8 {
                    fa.walk(&st, &mut rng);
                }
                fa.act(&fl.p, &mut st, &mut rng);
                fl.step(&mut st);
                if t % 200 == 0 {
                    line += &format!(" {}/{}", fa.census(2)[rabbits], fa.census(1)[fox]);
                }
            }
            println!("{line}");
        }
    }

    /// A wall of rock down column 4 with one gap at the bottom row (D-084).
    fn walled(st: &mut FloraState) {
        for y in 0..7 {
            st.ground[y * 8 + 4] = crate::terrain::ROCK;
        }
    }

    #[test]
    fn walkers_go_around_rock_and_never_stand_on_it() {
        let (_, mut fa, mut st, mut rng) = setup(8);
        walled(&mut st);
        let rabbits = fa.p.index("rabbits").unwrap();
        fa.agents.push(rabbits, 1, centre(1), centre(1), ONE_I, 0);
        (fa.agents.ty[0], fa.agents.tx[0], fa.agents.py[0]) = (centre(1), centre(6), ROUTE);
        for _ in 0..3000 {
            fa.walk(&st, &mut rng);
            let k = fa.agents.cell(0, 8);
            assert_ne!(st.ground[k], crate::terrain::ROCK, "never on rock");
            if k == 8 + 6 {
                return; // arrived on the far side, through the gap
            }
        }
        panic!("did not get around the wall");
    }

    #[test]
    fn swimmers_stay_in_water_fliers_cross_rock_and_shallows_slow_walkers() {
        let (_, mut fa, mut st, mut rng) = setup(8);
        let rabbits = fa.p.index("rabbits").unwrap();
        // A swimmer in a pond (column 0..2) asked to walk ashore stays in the water.
        for y in 0..8 {
            for x in 0..3 {
                st.ground[y * 8 + x] = crate::terrain::SHALLOW;
            }
        }
        fa.p.medium[rabbits] = Medium::Swim;
        fa.agents.push(rabbits, 1, centre(1), centre(1), ONE_I, 0);
        (fa.agents.ty[0], fa.agents.tx[0], fa.agents.py[0]) = (centre(1), centre(6), ROUTE);
        for _ in 0..200 {
            fa.walk(&st, &mut rng);
            assert!(crate::terrain::is_water(st.ground[fa.agents.cell(0, 8)]));
        }
        // A flier goes straight over a wall of rock.
        let (_, mut fa, mut st, mut rng) = setup(8);
        walled(&mut st);
        fa.p.medium[rabbits] = Medium::Fly;
        fa.p.wobble.fill(0);
        fa.agents.push(rabbits, 1, centre(1), centre(1), ONE_I, 0);
        (fa.agents.ty[0], fa.agents.tx[0], fa.agents.py[0]) = (centre(1), centre(6), ROUTE);
        fa.walk(&st, &mut rng);
        assert_eq!(fa.agents.px[0], centre(6), "a straight line");
        // A walker in the shallows moves at the shallow share of its speed.
        let (_, mut fa, mut st, mut rng) = setup(8);
        st.ground.fill(crate::terrain::SHALLOW);
        fa.p.wobble.fill(0);
        fa.agents.push(rabbits, 1, centre(1), centre(1), ONE_I, 0);
        (fa.agents.ty[0], fa.agents.tx[0], fa.agents.py[0]) = (centre(1), centre(6), ROUTE);
        let slow = div_round(fa.p.speed[rabbits] * fa.p.shallow_speed, ONE_I);
        let mut top = 0;
        for _ in 0..30 {
            let x = fa.agents.x[0];
            fa.walk(&st, &mut rng);
            top = top.max(fa.agents.x[0] - x);
        }
        assert!(
            top <= slow && top > slow / 2,
            "about the shallow speed ({top} vs {slow})"
        );
    }

    /// D-123: a grazer eats its primary food first, even where another food is more plentiful,
    /// and a secondary food feeds it 75 % as well.
    #[test]
    fn grazers_prefer_their_primary_food_and_lower_ranks_feed_less() {
        let (f, mut fa, mut st, _) = setup(4);
        let rabbit = fa.p.index("rabbits").unwrap();
        let [grass, flowers] = ["grasses", "wildflowers"].map(|n| f.p.index(n).unwrap());
        assert_eq!(fa.p.plant_rank(rabbit, grass), Some(0));
        assert_eq!(fa.p.plant_rank(rabbit, flowers), Some(1));
        let n2 = 16;
        let k = 5;
        st.owner[k] = 2; // enemy land: full bites
        let meal = |fa: &mut Fauna, st: &mut FloraState, grass_bio: i64| {
            st.bio[grass * n2 + k] = grass_bio;
            st.bio[flowers * n2 + k] = 9000;
            fa.agents = Agents::default();
            fa.agents.push(rabbit, 1, centre(1), centre(1), 0, 0);
            fa.graze(st);
            fa.agents.energy[0]
        };
        let primary = meal(&mut fa, &mut st, 3000);
        assert!(
            st.bio[flowers * n2 + k] == 9000,
            "the wildflowers are left for later"
        );
        let secondary = meal(&mut fa, &mut st, 0);
        assert!(
            st.bio[flowers * n2 + k] < 9000,
            "no grass: the secondary food"
        );
        assert!(
            (secondary * 4 - primary * 3).abs() <= 4,
            "75 %: {secondary} vs {primary}"
        );
    }

    /// D-123: a hunter heads for its primary prey in sight, though a secondary prey is nearer.
    #[test]
    fn hunters_seek_their_primary_prey_first() {
        let (f, mut fa, st, mut rng) = setup(12);
        let [fox, rabbit, vole] = ["fox", "rabbits", "bank_vole"].map(|n| fa.p.index(n).unwrap());
        assert_eq!(fa.p.prey_rank(fox, rabbit), Some(0));
        assert_eq!(fa.p.prey_rank(fox, vole), Some(1));
        fa.agents.push(fox, 1, centre(6), centre(6), ONE_I, 0);
        fa.agents.push(vole, 2, centre(6), centre(7), ONE_I, 0); // next to it
        fa.agents.push(rabbit, 2, centre(6), centre(9), ONE_I, 0); // three cells away
        fa.decide(&f.p, &st, &mut rng);
        assert_eq!(cell_of(fa.agents.tx[0]), 9, "the fox goes for the rabbit");
    }

    /// D-126: low tiers are easy to counter. Every plant is someone's food; every tier-1 plant has
    /// at least two eaters, one of them a tier-1 animal; every grazer has a hunter, and every
    /// tier-1 grazer one of tier 2 at most.
    #[test]
    fn the_food_web_makes_low_tiers_easy_to_counter() {
        let b = Balance::from_toml(BALANCE, SPECIES).unwrap();
        let p = FaunaParams::from_balance(&b);
        let tier = |a: usize| b.fauna_species[a].1.tier;
        let animals = 0..p.names.len();
        for (j, (name, s)) in b.flora_species.iter().enumerate() {
            let eaters: Vec<usize> = animals
                .clone()
                .filter(|&a| p.plant_rank(a, j).is_some())
                .collect();
            assert!(!eaters.is_empty(), "{name} feeds someone");
            if s.tier == 1 {
                assert!(eaters.len() >= 2, "{name}: {} eaters", eaters.len());
                assert!(
                    eaters.iter().any(|&a| tier(a) == 1),
                    "{name}: a tier-1 counter"
                );
            }
        }
        for v in animals.clone().filter(|&v| p.role[v] == Role::Herbivore) {
            let hunters: Vec<usize> = animals
                .clone()
                .filter(|&a| p.prey_rank(a, v).is_some())
                .collect();
            let name = &p.names[v];
            assert!(!hunters.is_empty(), "{name} is hunted");
            if tier(v) == 1 {
                assert!(
                    hunters.iter().any(|&a| tier(a) <= 2),
                    "{name}: an early hunter"
                );
            }
        }
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
