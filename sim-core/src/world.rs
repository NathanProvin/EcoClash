//! The world and its tick loop (INSTRUCTIONS §4, §5.3). One `step()` = one fixed tick (10 Hz):
//! 1. apply the tick's commands, in (player, seq) order;
//! 2. agents walk toward their targets (every tick);
//! 3. every `flora_every_ticks` (default 8: 1.25 Hz): the animals act (feed, die, breed, choose
//!    targets), then the flora step (which settles ownership), then the income;
//! 4. environment, every `env_every_ticks` (nothing to update in V1);
//! 5. refresh the dirty field-chunk hashes and return the tick hash.
//!
//! Ticks are never skipped (INSTRUCTIONS §6).

use crate::balance::Balance;
use crate::commands::{Command, CommandQueue, OrderKind, Payload, disc};
use crate::economy::Economy;
use crate::fauna::{Fauna, FaunaParams};
use crate::fixed::{ONE, div_round};
use crate::flora::{Flora, FloraParams, FloraState};
use crate::hash::{FieldHashes, Hasher};
use crate::rng::Pcg32;
use crate::snapshot::Snapshot;

/// Stream of the world's RNG (the seed comes from the match).
const RNG_STREAM: u64 = 0x0ec0_c1a5;

/// How a match ended (gamerules §11.3; D-059).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    /// A player held the territory threshold.
    Territory,
    /// Time limit: the highest standing biomass.
    Biomass,
    /// Time limit, standing biomass tied: the larger territory.
    TerritoryShare,
    /// Time limit, everything tied.
    Draw,
}

/// The verdict: the winner (0 for a draw), why, and the tick it was reached.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Outcome {
    pub winner: u8,
    pub reason: Reason,
    pub tick: u64,
}

/// Victory rules, converted once (Q16 shares, ticks).
#[derive(Clone, Debug)]
struct Victory {
    fixed: i64,
    decay: Option<(i64, i64)>,
    limit: u64,
}

#[derive(Clone, Debug)]
pub struct World {
    /// The next tick to run (ticks done so far).
    pub tick: u64,
    pub flora: Flora,
    pub state: FloraState,
    pub economy: Economy,
    pub fauna: Fauna,
    /// Why recent orders did nothing, for the UI: (player, text). Not part of the state hash;
    /// callers drain it (`take_notices`).
    pub notices: Vec<(u8, String)>,
    /// Animals placed by spawn commands since the last `take_drops`, as (first id, count): the
    /// renderer parachutes them in (D-080). A view, never hashed, like the notices.
    pub drops: Vec<(u32, u32)>,
    /// Set once the match is decided (checked after every flora tick); the world keeps running if
    /// stepped, callers stop there.
    pub result: Option<Outcome>,
    victory: Victory,
    /// The only randomness of the simulation (INSTRUCTIONS §4); unused by the flora rules.
    pub rng: Pcg32,
    /// Commands refused so far (invalid, or due in the past); identical on every peer.
    pub rejected: u64,
    queue: CommandQueue,
    fields: FieldHashes,
    flora_every: u64,
    env_every: u64,
}

impl Victory {
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    fn from_balance(b: &Balance) -> Victory {
        let (m, one) = (&b.r#match, f64::from(ONE));
        let q = |x: f64| crate::flora::round(x * one);
        Victory {
            fixed: q(m.victory_territory),
            decay: m
                .territory_decay
                .then(|| (q(m.territory_start), q(m.territory_end))),
            limit: u64::from(m.time_limit_s) * u64::from(b.sim.tick_hz),
        }
    }

    fn hash_into(&self, h: &mut Hasher) {
        h.i64(self.fixed).u64(self.limit);
        if let Some((a, b)) = self.decay {
            h.i64(a).i64(b);
        }
    }
}

/// The victory rules' converted values, for the balance hash.
pub(crate) fn hash_victory(b: &Balance, h: &mut Hasher) {
    Victory::from_balance(b).hash_into(h);
}

impl World {
    /// A bare `n x n` map. `n` is normally `balance.sim.grid_size`; tests use smaller maps.
    #[must_use]
    pub fn new(balance: &Balance, seed: u64, n: usize) -> World {
        let flora = Flora::new(FloraParams::from_balance(balance));
        let fauna = Fauna::new(FaunaParams::from_balance(balance, &flora.p));
        let state = FloraState::new(&flora.p, n);
        let chunk = usize::try_from(balance.sim.chunk_size).unwrap_or(32);
        World {
            tick: 0,
            flora,
            state,
            economy: Economy::new(balance, &fauna.p),
            fauna,
            notices: Vec::new(),
            drops: Vec::new(),
            result: None,
            victory: Victory::from_balance(balance),
            rng: Pcg32::new(seed, RNG_STREAM),
            rejected: 0,
            queue: CommandQueue::default(),
            fields: FieldHashes::new(n, chunk),
            flora_every: u64::from(balance.sim.flora_every_ticks),
            env_every: u64::from(balance.sim.env_every_ticks),
        }
    }

    /// Queue a command. Commands for a tick already run, or duplicates, are refused.
    pub fn submit(&mut self, c: Command) -> bool {
        let ok = c.tick >= self.tick && self.queue.push(c);
        if !ok {
            self.rejected += 1;
        }
        ok
    }

    /// Run one tick; returns the hash of the state after it.
    pub fn step(&mut self) -> u64 {
        for c in self.queue.take(self.tick) {
            self.apply(&c);
        }
        self.fauna.walk(self.state.n, &mut self.rng);
        if self.tick.is_multiple_of(self.flora_every) {
            self.fauna
                .act(&self.flora.p, &mut self.state, &mut self.rng);
            self.flora.step(&mut self.state);
            self.economy.update(&self.flora.p, &self.state, &self.fauna);
            if self.result.is_none() {
                self.result = self.judge();
            }
            self.fields.mark_all();
        }
        if self.tick.is_multiple_of(self.env_every) {
            // (nutrients / water: constant in V1)
        }
        self.tick += 1;
        self.hash()
    }

    fn apply(&mut self, c: &Command) {
        let valid_player = matches!(c.player, 1 | 2);
        match &c.payload {
            Payload::Plant {
                species,
                row,
                col,
                radius,
            } => {
                let s = self.flora.p.index(species);
                let n = self.state.n;
                let inside = usize::try_from(*row).is_ok_and(|r| r < n)
                    && usize::try_from(*col).is_ok_and(|c| c < n);
                let (Some(s), true, true) = (s, valid_player, inside) else {
                    self.rejected += 1;
                    return;
                };
                if !self.economy.is_unlocked(c.player, s) {
                    let why = "locked: unlock it in the tech tree first";
                    self.notices.push((c.player, format!("{species}: {why}")));
                    return;
                }
                // Cell by cell, paying `spawn_cost` for each cell planted, while the bank allows.
                let unit = self.economy.unit_cost(s, false);
                let mut planted = 0;
                let mut broke = false;
                for k in disc(n, *row, *col, *radius) {
                    if self.economy.affordable(c.player, unit) == 0 {
                        broke = true;
                        break;
                    }
                    let got = self.flora.plant(&mut self.state, c.player, s, &[k]);
                    self.economy
                        .pay(c.player, unit * i64::try_from(got).unwrap_or(0));
                    planted += got;
                    self.fields.mark_cell(k);
                }
                if broke {
                    self.notices.push((
                        c.player,
                        format!("{species}: not enough biomass for more cells"),
                    ));
                } else if planted == 0 {
                    self.notices.push((
                        c.player,
                        format!("{species}: nothing took there (soil too poor, land taken, or cap reached)"),
                    ));
                }
            }
            Payload::Spawn { species, row, col } => {
                let s = self.fauna.p.index(species);
                let n = self.state.n;
                let at = (usize::try_from(*row), usize::try_from(*col));
                let (Some(s), true, (Ok(r), Ok(c2))) = (s, valid_player, at) else {
                    self.rejected += 1;
                    return;
                };
                if r >= n || c2 >= n {
                    self.rejected += 1;
                    return;
                }
                if !self.economy.is_unlocked(c.player, self.economy.animal(s)) {
                    let why = "locked: unlock it in the tech tree first";
                    self.notices.push((c.player, format!("{species}: {why}")));
                    return;
                }
                let site = self
                    .fauna
                    .spawn_site(&self.flora.p, &self.state, c.player, s, (r, c2));
                let (at, count) = match site {
                    Ok(site) => site,
                    Err(why) => {
                        self.notices.push((c.player, format!("{species}: {why}")));
                        return;
                    }
                };
                // Any animal landing outside own land costs more (gamerules §6.3; D-061).
                let outside = self.state.owner[at] != c.player;
                let unit = self.economy.unit_cost(self.economy.animal(s), outside);
                let count = count.min(self.economy.affordable(c.player, unit));
                if count == 0 {
                    self.notices
                        .push((c.player, format!("{species}: not enough biomass")));
                    return;
                }
                let first = self.fauna.agents.next_id;
                self.fauna.place(s, c.player, at, count, n);
                self.drops.push((first, u32::try_from(count).unwrap_or(0)));
                self.economy.pay(c.player, unit * count);
            }
            Payload::Unlock { species } => {
                let i = (self.flora.p.index(species))
                    .or_else(|| self.fauna.p.index(species).map(|s| self.economy.animal(s)));
                let Some(i) = i.filter(|_| valid_player) else {
                    self.rejected += 1;
                    return;
                };
                if let Err(why) = self.economy.unlock(c.player, i) {
                    self.notices.push((c.player, format!("{species}: {why}")));
                }
            }
            Payload::Order {
                ids,
                kind,
                row,
                col,
            } => {
                let n = self.state.n;
                let goal = (usize::try_from(*row), usize::try_from(*col));
                let inside = matches!(goal, (Ok(r), Ok(c2)) if r < n && c2 < n);
                if !valid_player || (*kind != OrderKind::Stop && !inside) {
                    self.rejected += 1;
                    return;
                }
                let goal = (goal.0.unwrap_or(0), goal.1.unwrap_or(0));
                self.fauna.order(c.player, ids, *kind, goal);
            }
        }
    }

    /// Cells owned per player.
    #[must_use]
    pub fn territory(&self) -> [i64; 2] {
        let mut t = [0i64; 2];
        for &o in &self.state.owner {
            if let o @ 1..=2 = o {
                t[usize::from(o) - 1] += 1;
            }
        }
        t
    }

    /// Standing biomass per player (gamerules §11.3.5, D-023): the plant biomass of its cells plus
    /// the bodies of its animals, in biomass units.
    #[must_use]
    pub fn standing(&self) -> [i64; 2] {
        let (st, n2) = (&self.state, self.state.n * self.state.n);
        let mut s = [0i64; 2];
        for (i, &b) in st.bio.iter().enumerate() {
            if let o @ 1..=2 = st.owner[i % n2] {
                s[usize::from(o) - 1] += b;
            }
        }
        let a = &self.fauna.agents;
        for i in 0..a.len() {
            s[usize::from(a.owner[i] - 1)] += self.fauna.p.body[usize::from(a.sp[i])];
        }
        s
    }

    /// The verdict, if the match is decided now (the prototype's `Economy.winner`): the
    /// territory threshold at any time; at the time limit, standing biomass, then territory, else
    /// a draw.
    fn judge(&self) -> Option<Outcome> {
        let v = &self.victory;
        let n2 = i64::try_from(self.state.n * self.state.n).unwrap_or(i64::MAX);
        let (tick, t) = (self.tick, self.territory());
        let threshold = match v.decay {
            None => v.fixed,
            Some((start, end)) => {
                let done = i64::try_from(tick.min(v.limit)).unwrap_or(0);
                start + div_round((end - start) * done, i64::try_from(v.limit).unwrap_or(1))
            }
        };
        let top = if t[1] > t[0] { 2 } else { 1 }; // ties: P1, as the prototype
        let outcome = |winner, reason| {
            Some(Outcome {
                winner,
                reason,
                tick,
            })
        };
        if t[usize::from(top - 1)] * i64::from(ONE) >= threshold * n2 {
            return outcome(top, Reason::Territory);
        }
        if tick < v.limit {
            return None;
        }
        let (s, pick) = (
            self.standing(),
            |x: [i64; 2]| if x[0] > x[1] { 1 } else { 2 },
        );
        if s[0] != s[1] {
            return outcome(pick(s), Reason::Biomass);
        }
        if t[0] != t[1] {
            return outcome(pick(t), Reason::TerritoryShare);
        }
        outcome(0, Reason::Draw)
    }

    /// Match setup (D-058): plant a starting patch for free, before the first tick. It is not a
    /// player action, so it costs nothing and needs no unlock; every peer runs the same setup.
    /// Unknown species or cells off the map plant nothing. Returns the cells planted.
    pub fn setup_plant(
        &mut self,
        player: u8,
        species: &str,
        row: u32,
        col: u32,
        radius: u32,
    ) -> usize {
        let n = self.state.n;
        let (Some(s), true) = (self.flora.p.index(species), matches!(player, 1 | 2)) else {
            return 0;
        };
        if usize::try_from(row).map_or(true, |r| r >= n)
            || usize::try_from(col).map_or(true, |c| c >= n)
        {
            return 0;
        }
        let cells = disc(n, row, col, radius);
        for &k in &cells {
            self.fields.mark_cell(k);
        }
        self.flora.plant(&mut self.state, player, s, &cells)
    }

    /// A sandbox match: every species unlocked and free (tools, checks; D-058). Set it before the
    /// first tick; it is part of the state hash, so peers must agree on it.
    pub fn set_sandbox(&mut self, on: bool) {
        self.economy.sandbox = on;
    }

    /// Why recent orders did nothing, oldest first; the list is emptied.
    pub fn take_notices(&mut self) -> Vec<(u8, String)> {
        std::mem::take(&mut self.notices)
    }

    /// Animals dropped by spawn commands since the last call, as (first id, count).
    pub fn take_drops(&mut self) -> Vec<(u32, u32)> {
        std::mem::take(&mut self.drops)
    }

    /// Hash of the current state: tick, scalars (points banked included), RNG, field digest (dirty chunks re-hashed).
    pub fn hash(&mut self) -> u64 {
        let digest = self.fields.refresh(&self.state);
        let (state, inc) = self.rng.state();
        let mut h = Hasher::new();
        h.u64(self.tick)
            .u64(self.state.t)
            .u64(self.rejected)
            .u64(state)
            .u64(inc)
            .u64(digest);
        self.economy.hash_state(&mut h);
        if let Some(o) = self.result {
            h.u64(u64::from(o.winner)).u64(o.reason as u64).u64(o.tick);
        }
        self.fauna.agents.hash_into(&mut h);
        h.finish()
    }

    /// Per-chunk field hashes, row-major (to locate a desync).
    pub fn chunk_hashes(&mut self) -> &[u64] {
        self.fields.refresh(&self.state);
        self.fields.chunks()
    }

    /// Read-only view for renderers and tools.
    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        Snapshot::new(self.tick, &self.flora, &self.state)
    }

    /// How hard the non-owner pushes into each cell, 0..=255 (display only, D-076).
    #[must_use]
    pub fn pressure_frame(&self) -> Vec<u8> {
        crate::snapshot::pressure_frame(&self.flora, &self.state, &self.fauna)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hash::full_hash;

    fn balance() -> Balance {
        Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .expect("data files load")
    }

    fn plant(tick: u64, player: u8, seq: u32, species: &str, row: u32, col: u32) -> Command {
        let payload = Payload::Plant {
            species: species.into(),
            row,
            col,
            radius: 2,
        };
        Command {
            tick,
            player,
            seq,
            payload,
        }
    }

    /// Two players, a few orders, `ticks` ticks: the hash of every tick.
    fn play(seed: u64, n: usize, ticks: u64, commands: &[Command]) -> (Vec<u64>, World) {
        let mut w = World::new(&balance(), seed, n);
        for c in commands {
            w.submit(c.clone());
        }
        let hashes = (0..ticks).map(|_| w.step()).collect();
        (hashes, w)
    }

    fn orders() -> Vec<Command> {
        vec![
            plant(0, 1, 0, "grasses", 3, 3),
            plant(0, 2, 0, "grasses", 36, 36),
            plant(0, 1, 1, "lichen_and_moss", 3, 10),
            plant(50, 2, 1, "ferns", 30, 36),
        ]
    }

    #[test]
    fn same_inputs_same_hashes_every_tick() {
        let (a, _) = play(7, 40, 300, &orders());
        let (b, _) = play(7, 40, 300, &orders());
        assert_eq!(a, b);
        assert_ne!(a[0], a[1], "the state moves");
    }

    #[test]
    fn animals_spawn_by_command_live_in_the_hash_and_refusals_leave_a_notice() {
        let spawn = |seq: u32, species: &str| Command {
            tick: 100,
            player: 1,
            seq,
            payload: Payload::Spawn {
                species: species.into(),
                row: 3,
                col: 3,
            },
        };
        let mut cmds = orders();
        cmds.push(spawn(5, "earthworms"));
        cmds.push(spawn(6, "fox")); // no shrubs yet: refused
        let (a, mut w) = play(7, 40, 300, &cmds);
        let (b, _) = play(7, 40, 300, &cmds);
        assert_eq!(a, b);
        assert!(
            !w.fauna.agents.is_empty(),
            "earthworms spawned on own grass"
        );
        let (plain, _) = play(7, 40, 300, &orders());
        assert_ne!(a[299], plain[299], "animals are part of the state hash");
        let notices = w.take_notices();
        assert!(
            notices
                .iter()
                .any(|(p, t)| *p == 1 && t.starts_with("fox:")),
            "{notices:?}"
        );
        assert!(w.take_notices().is_empty(), "drained");
        let drops = w.take_drops();
        assert_eq!(drops.len(), 1, "one spawn landed: {drops:?}");
        assert!(drops[0].1 > 0, "its animals are there to parachute in");
        assert!(w.take_drops().is_empty(), "drained");
    }

    #[test]
    fn plants_cost_points_locked_ones_are_refused_and_setup_is_free() {
        let b = balance();
        let mut w = World::new(&b, 1, 40);
        assert!(w.setup_plant(1, "grasses", 5, 5, 3) > 0, "setup plants...");
        let bank = w.economy.bank[0];
        w.submit(plant(0, 1, 0, "grasses", 20, 20)); // a paid order
        w.submit(plant(0, 1, 1, "wildflowers", 30, 30)); // locked at start
        w.step();
        // The order paid for its cells (the same tick's income is far smaller); setup did not.
        assert!(bank - w.economy.bank[0] > 0);
        let notices = w.take_notices();
        assert!(
            notices
                .iter()
                .any(|(_, t)| t.starts_with("wildflowers: locked")),
            "{notices:?}"
        );
    }

    #[test]
    fn the_match_ends_on_the_territory_threshold_or_at_the_time_limit() {
        let b = balance();
        let mut w = World::new(&b, 1, 20);
        let every = u64::from(b.sim.flora_every_ticks);
        // P1 owns everything: the territory threshold wins at the first flora tick.
        w.set_sandbox(true);
        let cells: Vec<usize> = (0..400).collect();
        let g = w.flora.p.index("grasses").unwrap();
        w.flora.p.cap[g] = i64::from(ONE); // the whole map (grasses stop at half otherwise)
        w.flora.plant(&mut w.state, 1, g, &cells);
        w.step();
        let o = w.result.expect("decided");
        assert_eq!((o.winner, o.reason), (1, Reason::Territory));

        // A small patch each: nobody reaches the threshold; at the time limit, biomass decides.
        let mut w = World::new(&b, 1, 20);
        w.setup_plant(1, "grasses", 3, 3, 2);
        w.setup_plant(2, "lichen_and_moss", 16, 16, 2); // slower, lighter: P1 stands taller
        let limit = u64::from(b.r#match.time_limit_s) * u64::from(b.sim.tick_hz);
        while w.tick < limit - every {
            w.step();
            assert!(w.result.is_none(), "tick {}", w.tick);
        }
        while w.result.is_none() {
            w.step();
        }
        let o = w.result.unwrap();
        assert_eq!((o.winner, o.reason), (1, Reason::Biomass));
        assert!(o.tick >= limit);
    }

    #[test]
    fn animals_landing_outside_own_land_cost_the_drop_surcharge() {
        let b = balance();
        let mut w = World::new(&b, 1, 20);
        w.setup_plant(1, "grasses", 4, 4, 3);
        w.setup_plant(2, "grasses", 15, 15, 3);
        let voles = w.economy.animal(w.fauna.p.index("voles").unwrap());
        w.economy.bank[0] = 100_000 << 16;
        w.economy.unlock(1, voles).unwrap();
        let (base, drop) = (
            w.economy.unit_cost(voles, false),
            w.economy.unit_cost(voles, true),
        );
        assert!(drop > base, "the drop costs more");
        let spawn = |seq, row, col| Command {
            tick: 0,
            player: 1,
            seq,
            payload: Payload::Spawn {
                species: "voles".into(),
                row,
                col,
            },
        };
        w.submit(spawn(0, 4, 4)); // own land: base price
        w.submit(spawn(1, 15, 15)); // enemy grass: dropped there
        let bank = w.economy.bank[0];
        w.step();
        let group = w
            .fauna
            .p
            .index("voles")
            .map(|s| w.fauna.census(1)[s])
            .unwrap();
        let per_card = group / 2;
        let income = div_round(w.economy.income[0] * 8, 10); // the tick-0 flora period
        assert_eq!(bank - w.economy.bank[0] + income, per_card * (base + drop));
        assert!(w.fauna.agents.owner.iter().all(|&o| o == 1));
        let on_enemy =
            (0..w.fauna.agents.len()).filter(|&i| w.state.owner[w.fauna.agents.cell(i, 20)] == 2);
        assert_eq!(
            i64::try_from(on_enemy.count()).unwrap(),
            per_card,
            "half of them landed on P2 grass"
        );
    }

    #[test]
    fn command_order_within_a_tick_does_not_depend_on_submission_order() {
        let mut reversed = orders();
        reversed.reverse();
        assert_eq!(play(7, 40, 120, &orders()).0, play(7, 40, 120, &reversed).0);
    }

    #[test]
    fn the_seed_changes_the_hash() {
        assert_ne!(play(7, 20, 3, &[]).0, play(8, 20, 3, &[]).0);
    }

    /// Ticks per flora step, from the balance (INSTRUCTIONS §5.3).
    fn every() -> u64 {
        u64::from(balance().sim.flora_every_ticks)
    }

    #[test]
    fn flora_runs_every_flora_every_ticks() {
        let ticks = 3 * every() + 1;
        let (_, w) = play(1, 20, ticks, &orders());
        assert_eq!(w.state.t, 4, "ticks 0, e, 2e and 3e");
    }

    #[test]
    fn a_plant_between_flora_ticks_changes_the_hash_at_once() {
        let (a, _) = play(1, 40, 3, &[]);
        let (b, _) = play(1, 40, 3, &[plant(2, 1, 0, "grasses", 5, 5)]);
        assert_eq!(a[..2], b[..2]);
        assert_ne!(a[2], b[2], "tick 2 planted: its chunk was re-hashed");
    }

    #[test]
    fn incremental_chunk_hashes_match_a_full_recompute() {
        let ticks = 40 * every() + 1; // just after a flora tick
        let (_, mut w) = play(3, 70, ticks, &orders()); // 70: chunks at the edge are partial
        let incremental = w.chunk_hashes().to_vec();
        let mut fresh = FieldHashes::new(70, 32);
        fresh.refresh(&w.state);
        assert_eq!(incremental, fresh.chunks());
        let before = full_hash(&w.state);
        w.step(); // not a flora tick: the fields stay
        assert_eq!(before, full_hash(&w.state));
        for _ in 0..every() {
            w.step(); // through the next flora tick
        }
        assert_ne!(before, full_hash(&w.state));
    }

    #[test]
    fn invalid_or_late_commands_are_rejected_deterministically() {
        let mut w = World::new(&balance(), 1, 10);
        w.step();
        assert!(
            !w.submit(plant(0, 1, 0, "grasses", 1, 1)),
            "tick 0 already ran"
        );
        assert!(w.submit(plant(1, 1, 0, "unknown", 1, 1)));
        assert!(w.submit(plant(1, 3, 0, "grasses", 1, 1)));
        assert!(w.submit(plant(1, 1, 1, "grasses", 99, 1)));
        w.step();
        assert_eq!(w.rejected, 4);
        assert!(w.state.owner.iter().all(|&o| o == 0));
    }

    #[test]
    fn snapshot_field_frame_uses_the_replay_layout() {
        let ticks = 2 * every() + 1;
        let (_, w) = play(1, 12, ticks, &[plant(0, 1, 0, "grasses", 5, 5)]);
        let snap = w.snapshot();
        let frame = snap.field_frame();
        let cells = 12 * 12;
        assert_eq!(frame.len(), cells * (2 + w.flora.p.species()));
        assert_eq!(&frame[..cells], &w.state.owner[..]);
        let grasses = w.flora.p.index("grasses").unwrap();
        let cover = &frame[(2 + grasses) * cells..(3 + grasses) * cells];
        assert!(cover[5 * 12 + 5] > 0 && cover[0] == 0);
        assert_eq!((snap.tick, snap.flora_tick), (ticks, 3));
    }
}

#[cfg(test)]
mod perf {
    use super::*;
    use crate::flora::U16;

    fn balance() -> Balance {
        Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .unwrap()
    }

    /// Mean time of one flora step over `steps`, and the owned cells at the end.
    fn time_flora(w: &mut World, steps: u32) -> (std::time::Duration, usize) {
        let start = std::time::Instant::now();
        for _ in 0..steps {
            w.flora.step(&mut w.state);
        }
        let owned = w.state.owner.iter().filter(|&&o| o != 0).count();
        (start.elapsed() / steps, owned)
    }

    /// Manual check against the tick budget (INSTRUCTIONS §5.5; D-038):
    /// `cargo test -p sim-core --release -- --ignored --nocapture flora_tick_time`.
    /// Mid-game: four patches per player spreading. Worst case: the whole map owned, every cell
    /// holding several species of all three strata.
    #[test]
    #[ignore = "timing, run by hand in release"]
    fn flora_tick_time_at_the_default_grid() {
        let b = balance();
        let n = usize::try_from(b.sim.grid_size).unwrap();
        let every = u64::from(b.sim.flora_every_ticks);

        let mut w = World::new(&b, 1, n);
        w.set_sandbox(true); // plants any species
        let mut seq = 0;
        let m = u32::try_from(n).unwrap();
        let spots = [
            (1, m / 6, m / 6),
            (2, m - m / 6, m - m / 6),
            (1, m / 4, m / 2),
            (2, m * 3 / 4, m / 2),
        ];
        for (player, row, col) in spots {
            for species in ["grasses", "lichen_and_moss", "nettle"] {
                let payload = Payload::Plant {
                    species: species.into(),
                    row,
                    col,
                    radius: (m / 20).max(2),
                };
                w.submit(Command {
                    tick: 0,
                    player,
                    seq,
                    payload,
                });
                seq += 1;
            }
        }
        for _ in 0..600 {
            w.step(); // 60 s of play: the fronts spread
        }
        let (mid, owned) = time_flora(&mut w, 20);
        println!("{n}x{n} mid-game: {mid:?} per flora tick, {owned} cells owned");

        let mut w = World::new(&b, 1, n);
        w.set_sandbox(true);
        w.state.soil.iter_mut().for_each(|s| *s = U16);
        for (player, cols) in [(1u8, 0..n / 2), (2u8, n / 2..n)] {
            let cells: Vec<usize> = (0..n * n).filter(|k| cols.contains(&(k % n))).collect();
            for name in [
                "grasses",
                "wildflowers",
                "ferns",
                "elder",
                "hazel",
                "oak",
                "beech",
            ] {
                let s = w.flora.p.index(name).unwrap();
                w.flora.p.cap[s] = i64::from(crate::fixed::ONE); // the whole map: no cap
                w.flora.plant(&mut w.state, player, s, &cells);
            }
        }
        let (full, owned) = time_flora(&mut w, 10);
        println!(
            "{n}x{n} full map: {full:?} per flora tick, {owned} cells owned; one flora tick every \
             {every} ticks = {:?} per tick on average",
            full / u32::try_from(every).unwrap()
        );

        // The M3 budget (INSTRUCTIONS §5.5): the same full map plus 1,500 animals of every species,
        // all behaviours running, timed over whole ticks (walks every tick, acts every flora tick).
        let species = w.fauna.p.names.len();
        for k in 0..1500 {
            let (player, half) = if k % 2 == 0 { (1u8, 0) } else { (2u8, n / 2) };
            let cell = (k * 7919) % (n * n / 2);
            let (row, col) = (cell / (n / 2), half + cell % (n / 2));
            let s = k % species;
            let full = w.fauna.p.body[s] * i64::from(crate::fixed::ONE);
            let at = |c: usize| i64::try_from(c).unwrap() * i64::from(crate::fixed::ONE) + 32768;
            w.fauna.agents.push(s, player, at(row), at(col), full, 0);
        }
        let ticks = 10 * every;
        let (mut worst, start) = (std::time::Duration::ZERO, std::time::Instant::now());
        for _ in 0..ticks {
            let t = std::time::Instant::now();
            w.step();
            worst = worst.max(t.elapsed());
        }
        println!(
            "{n}x{n} full map + 1500 animals: {:?} per tick on average, worst tick {worst:?}, {} animals left",
            start.elapsed() / u32::try_from(ticks).unwrap(),
            w.fauna.agents.len()
        );
    }
}
