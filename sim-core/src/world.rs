//! The world and its tick loop (INSTRUCTIONS §4, §5.3). One `step()` = one fixed tick (10 Hz):
//! 1. apply the tick's commands, in (player, seq) order;
//! 2. agents (every tick; M3);
//! 3. flora, every `flora_every_ticks` (default 5: 2 Hz);
//! 4. environment, every `env_every_ticks` (nothing to update in V1);
//! 5. refresh the dirty field-chunk hashes and return the tick hash.
//!
//! Ticks are never skipped (INSTRUCTIONS §6).

use crate::balance::Balance;
use crate::commands::{Command, CommandQueue, Payload, disc};
use crate::flora::{Flora, FloraParams, FloraState};
use crate::hash::{FieldHashes, Hasher};
use crate::rng::Pcg32;
use crate::snapshot::Snapshot;

/// Stream of the world's RNG (the seed comes from the match).
const RNG_STREAM: u64 = 0x0ec0_c1a5;

#[derive(Clone, Debug)]
pub struct World {
    /// The next tick to run (ticks done so far).
    pub tick: u64,
    pub flora: Flora,
    pub state: FloraState,
    /// The only randomness of the simulation (INSTRUCTIONS §4); unused by the flora rules.
    pub rng: Pcg32,
    /// Commands refused so far (invalid, or due in the past); identical on every peer.
    pub rejected: u64,
    queue: CommandQueue,
    fields: FieldHashes,
    flora_every: u64,
    env_every: u64,
}

impl World {
    /// A bare `n x n` map. `n` is normally `balance.sim.grid_size`; tests use smaller maps.
    #[must_use]
    pub fn new(balance: &Balance, seed: u64, n: usize) -> World {
        let flora = Flora::new(FloraParams::from_balance(balance));
        let state = FloraState::new(&flora.p, n);
        let chunk = usize::try_from(balance.sim.chunk_size).unwrap_or(32);
        World {
            tick: 0,
            flora,
            state,
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
        // (agents: M3)
        if self.tick.is_multiple_of(self.flora_every) {
            self.flora.step(&mut self.state);
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
                let cells = disc(n, *row, *col, *radius);
                self.flora.plant(&mut self.state, c.player, s, &cells);
                for &k in &cells {
                    self.fields.mark_cell(k);
                }
            }
        }
    }

    /// Hash of the current state: tick, scalars, RNG, field digest (dirty chunks re-hashed).
    pub fn hash(&mut self) -> u64 {
        let digest = self.fields.refresh(&self.state);
        let (state, inc) = self.rng.state();
        Hasher::new()
            .u64(self.tick)
            .u64(self.state.t)
            .u64(self.rejected)
            .u64(state)
            .u64(inc)
            .u64(digest)
            .finish()
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
            plant(0, 1, 1, "lichen", 3, 10),
            plant(50, 2, 1, "moss", 30, 36),
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
        let mut seq = 0;
        for (player, row, col) in [(1, 40, 40), (2, 215, 215), (1, 60, 120), (2, 190, 130)] {
            for species in ["grasses", "lichen", "clover"] {
                let payload = Payload::Plant {
                    species: species.into(),
                    row,
                    col,
                    radius: 12,
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
        w.state.soil.iter_mut().for_each(|s| *s = U16);
        for (player, cols) in [(1u8, 0..n / 2), (2u8, n / 2..n)] {
            let cells: Vec<usize> = (0..n * n).filter(|k| cols.contains(&(k % n))).collect();
            for name in [
                "grasses", "clover", "moss", "elder", "hazel", "oak", "beech",
            ] {
                let s = w.flora.p.index(name).unwrap();
                w.flora.p.cap[s] = i64::MAX; // no cap: every cell keeps every species
                w.flora.plant(&mut w.state, player, s, &cells);
            }
        }
        let (full, owned) = time_flora(&mut w, 10);
        println!(
            "{n}x{n} full map: {full:?} per flora tick, {owned} cells owned; one flora tick every \
             {every} ticks = {:?} per tick on average",
            full / u32::try_from(every).unwrap()
        );
    }
}
