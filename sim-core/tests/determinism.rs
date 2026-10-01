//! Determinism under random command streams (INSTRUCTIONS §4 required tests, ROADMAP M1.7):
//! the simulation never panics, the same inputs give the same hash at every tick, the incremental
//! chunk hashes equal a fresh recompute, and owned cells are exactly the cells with biomass.

use proptest::prelude::*;
use sim_core::balance::Balance;
use sim_core::commands::{Command, OrderKind, Payload};
use sim_core::hash::FieldHashes;
use sim_core::world::World;

const N: u32 = 20;
const TICKS: u64 = 120;

fn balance() -> Balance {
    Balance::from_toml(
        include_str!("../../data/balance.toml"),
        include_str!("../../data/species.toml"),
    )
    .expect("data files load")
}

/// Any command, valid or not: players 0..=3, unknown species, plant orders for animals and spawn
/// orders for plants, orders for unknown or enemy ids, cells off the map, duplicate seqs.
fn command(species: Vec<String>) -> impl Strategy<Value = Command> {
    (
        0..TICKS + 10,
        0u8..=3,
        0u32..4,
        prop::sample::select(species),
        0..N + 4,
        0..N + 4,
        0u32..5,
        0u8..4,
        prop::collection::vec(0u32..60, 0..8),
    )
        .prop_map(
            |(tick, player, seq, species, row, col, radius, what, ids)| Command {
                tick,
                player,
                seq,
                payload: match what {
                    0 => Payload::Plant {
                        species,
                        row,
                        col,
                        radius,
                    },
                    1 => Payload::Spawn { species, row, col },
                    3 if ids.len() % 2 == 0 => Payload::Catastrophe {
                        kind: ["storm", "bark_beetle_outbreak", "chemical_spill", "nope"]
                            [(col % 4) as usize]
                            .into(),
                        row,
                        col,
                    },
                    _ => Payload::Order {
                        ids,
                        kind: [OrderKind::Move, OrderKind::Attack, OrderKind::Stop]
                            [(row % 3) as usize],
                        row,
                        col,
                    },
                },
            },
        )
}

fn species_names() -> Vec<String> {
    let mut names: Vec<String> = balance()
        .flora_species
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    names.extend(balance().fauna_species.into_iter().map(|(n, _)| n));
    names.push("unknown".into());
    names
}

fn play(b: &Balance, seed: u64, commands: &[Command]) -> (Vec<u64>, World) {
    let mut w = World::new(b, seed, N as usize);
    for c in commands {
        w.submit(c.clone());
    }
    let hashes = (0..TICKS).map(|_| w.step()).collect();
    (hashes, w)
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 32, ..ProptestConfig::default() })]

    #[test]
    fn random_command_streams_replay_identically(
        commands in prop::collection::vec(command(species_names()), 0..48),
        seed in any::<u64>(),
    ) {
        let b = balance();
        let (first, mut w) = play(&b, seed, &commands);
        let (second, _) = play(&b, seed, &commands);
        prop_assert_eq!(&first, &second);

        let incremental = w.chunk_hashes().to_vec();
        let mut fresh = FieldHashes::new(N as usize, b.sim.chunk_size as usize);
        fresh.refresh(&w.state);
        prop_assert_eq!(incremental, fresh.chunks());

        let cells = (N * N) as usize;
        for k in 0..cells {
            let has_bio = (0..w.flora.p.species()).any(|s| w.state.bio[s * cells + k] > 0);
            prop_assert_eq!(w.state.owner[k] != 0, has_bio, "cell {}", k);
        }
    }

    #[test]
    fn command_submission_order_never_matters(
        commands in prop::collection::vec(command(species_names()), 0..32),
        seed in any::<u64>(),
    ) {
        let b = balance();
        let mut shuffled = commands.clone();
        shuffled.reverse();
        // Duplicates keep the first submitted: compare only streams without duplicate keys.
        let mut keys: Vec<_> = commands.iter().map(|c| (c.tick, c.player, c.seq)).collect();
        keys.sort_unstable();
        keys.dedup();
        prop_assume!(keys.len() == commands.len());
        prop_assert_eq!(play(&b, seed, &commands).0, play(&b, seed, &shuffled).0);
    }
}
