//! Player commands (INSTRUCTIONS §4): every input is a command `{tick, player, seq, payload}`,
//! applied at the start of its tick, in order of player id then sequence number. The bot AI goes
//! through the same queue (D-014). Commands serialize to JSON for command files and replays.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// What a command asks for.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Payload {
    /// Seed a plant species in a disc of cells (gamerules §8), on own or empty land. Species go
    /// by name so command files survive a reordering of species.toml.
    Plant {
        species: String,
        row: u32,
        col: u32,
        radius: u32,
    },
    /// Spawn one card of an animal species near a cell (gamerules §6.3, §8). Where it lands and
    /// whether it may spawn at all is decided by the fauna rules (`Fauna::spawn`).
    Spawn { species: String, row: u32, col: u32 },
}

/// One command, timestamped by the tick it executes at.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Command {
    pub tick: u64,
    pub player: u8,
    /// Per-player sequence number: orders a player's commands within one tick.
    pub seq: u32,
    pub payload: Payload,
}

/// Pending commands, kept sorted by (tick, player, seq) (`BTreeMap`: stable iteration order).
#[derive(Clone, Debug, Default)]
pub struct CommandQueue {
    pending: BTreeMap<(u64, u8, u32), Payload>,
}

impl CommandQueue {
    /// Queue a command. A second command with the same (tick, player, seq) is refused: `false`.
    pub fn push(&mut self, c: Command) -> bool {
        let key = (c.tick, c.player, c.seq);
        if self.pending.contains_key(&key) {
            return false;
        }
        self.pending.insert(key, c.payload);
        true
    }

    /// Remove and return the commands of `tick`, in application order (player, then seq).
    pub fn take(&mut self, tick: u64) -> Vec<Command> {
        let later = self.pending.split_off(&(tick + 1, 0, 0));
        let now = std::mem::replace(&mut self.pending, later);
        now.into_iter()
            .filter(|((t, ..), _)| *t == tick) // anything older was already due: dropped
            .map(|((tick, player, seq), payload)| Command {
                tick,
                player,
                seq,
                payload,
            })
            .collect()
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.pending.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.pending.is_empty()
    }
}

/// Cells of the disc of `radius` around (row, col), clipped to an `n x n` map, row-major.
#[must_use]
pub fn disc(n: usize, row: u32, col: u32, radius: u32) -> Vec<usize> {
    let (r, c, rad) = (i64::from(row), i64::from(col), i64::from(radius));
    let side = i64::try_from(n).unwrap_or(i64::MAX);
    let mut cells = Vec::new();
    for y in (r - rad).max(0)..=(r + rad).min(side - 1) {
        for x in (c - rad).max(0)..=(c + rad).min(side - 1) {
            if (y - r) * (y - r) + (x - c) * (x - c) <= rad * rad {
                cells.push(usize::try_from(y * side + x).unwrap_or(usize::MAX));
            }
        }
    }
    cells
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plant(tick: u64, player: u8, seq: u32) -> Command {
        let payload = Payload::Plant {
            species: "grasses".into(),
            row: 1,
            col: 1,
            radius: 1,
        };
        Command {
            tick,
            player,
            seq,
            payload,
        }
    }

    #[test]
    fn take_returns_a_ticks_commands_by_player_then_seq() {
        let mut q = CommandQueue::default();
        for c in [
            plant(5, 2, 0),
            plant(5, 1, 1),
            plant(4, 1, 0),
            plant(5, 1, 0),
            plant(6, 1, 0),
        ] {
            assert!(q.push(c));
        }
        assert!(!q.push(plant(5, 1, 0)), "duplicate (tick, player, seq)");
        let order: Vec<_> = q.take(5).iter().map(|c| (c.player, c.seq)).collect();
        assert_eq!(order, [(1, 0), (1, 1), (2, 0)]);
        assert_eq!(q.len(), 1, "tick 4 was overdue and dropped, tick 6 stays");
    }

    #[test]
    fn commands_round_trip_as_json() {
        let c = plant(10, 1, 3);
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(
            json,
            r#"{"tick":10,"player":1,"seq":3,"payload":{"type":"plant","species":"grasses","row":1,"col":1,"radius":1}}"#
        );
        assert_eq!(serde_json::from_str::<Command>(&json).unwrap(), c);
    }

    #[test]
    fn disc_is_clipped_and_row_major() {
        assert_eq!(disc(4, 0, 0, 1), [0, 1, 4]);
        assert_eq!(disc(5, 2, 2, 1), [7, 11, 12, 13, 17]);
        assert_eq!(disc(3, 1, 1, 0), [4]);
    }
}
