//! Food-web harmony (D-187): the tier rules of `data/species.toml`, checked so that tuning can't
//! silently break them.
//!
//! 1. No tier is weaker than the one below it in its family: unlock and call costs, yield, and
//!    for animals body (and bite for grazers) never go down from tier 1 to tier 3.
//! 2. The number of eaters falls with tier and cost: cheap species are never eaten by a single
//!    species, big ones never by many.

use sim_core::balance::Balance;

const BALANCE: &str = include_str!("../../data/balance.toml");
const SPECIES: &str = include_str!("../../data/species.toml");

/// A species row (family, tier, name, stats) and a family with its members by tier.
type Row = (String, u8, String, Vec<f64>);
type Family = (String, Vec<(u8, String, Vec<f64>)>);

/// Hunters this expensive to unlock are apex: nothing (or one hunter) eats them.
const APEX_UNLOCK: f64 = 6000.0;

fn balance() -> Balance {
    Balance::from_toml(BALANCE, SPECIES).expect("the shipped balance loads")
}

/// Per family, its members sorted by tier: (tier, name, stats to compare).
fn by_family(rows: Vec<Row>) -> Vec<Family> {
    let mut fams: Vec<Family> = Vec::new();
    for (family, tier, name, stats) in rows {
        match fams.iter_mut().find(|(f, _)| *f == family) {
            Some((_, v)) => v.push((tier, name, stats)),
            None => fams.push((family, vec![(tier, name, stats)])),
        }
    }
    for (_, v) in &mut fams {
        v.sort_by_key(|(t, _, _)| *t);
    }
    fams
}

#[test]
fn no_tier_is_weaker_than_the_one_below() {
    let b = balance();
    const PLANT: [&str; 3] = ["unlock_cost", "spawn_cost", "yield"];
    const ANIMAL: [&str; 5] = ["unlock_cost", "spawn_cost", "yield", "body", "bite"];
    let plants = b
        .flora_species
        .iter()
        .map(|(n, s)| {
            (
                s.family.clone(),
                s.tier,
                n.clone(),
                vec![s.unlock_cost, s.spawn_cost, s.yield_],
            )
        })
        .collect();
    let animals = b
        .fauna_species
        .iter()
        .map(|(n, s)| {
            let stats = vec![
                s.unlock_cost,
                s.spawn_cost,
                s.yield_,
                f64::from(s.body),
                s.bite,
            ];
            (s.family.clone(), s.tier, n.clone(), stats)
        })
        .collect();
    let mut bad = Vec::new();
    for (rows, keys) in [
        (by_family(plants), &PLANT[..]),
        (by_family(animals), &ANIMAL[..]),
    ] {
        for (family, members) in rows {
            for pair in members.windows(2) {
                let [(_, lo, a), (_, hi, z)] = pair else {
                    unreachable!()
                };
                for (k, key) in keys.iter().enumerate() {
                    if z[k] < a[k] {
                        bad.push(format!("{family}: {hi} {key} {} < {lo} {}", z[k], a[k]));
                    }
                }
            }
        }
    }
    assert!(
        bad.is_empty(),
        "higher tiers weaker than lower ones:\n{}",
        bad.join("\n")
    );
}

#[test]
fn eaters_fall_with_tier_and_cost() {
    let b = balance();
    let fauna = &b.fauna_species;
    let mut bad = Vec::new();
    // Animals: eaten by hunters (recyclers are never raiders and stay uneaten).
    for (name, s) in fauna.iter().filter(|(_, s)| s.role != "decomposer") {
        let n = fauna
            .iter()
            .filter(|(_, h)| h.role == "predator" && h.eats.iter().any(|e| e == name))
            .count();
        let band = match (s.role.as_str(), s.tier) {
            ("predator", _) if s.unlock_cost >= APEX_UNLOCK => 0..=1,
            ("predator", 1) => 2..=3,
            ("predator", _) => 1..=2,
            (_, 1) => 2..=3,
            (_, 2) => 2..=2,
            _ => 1..=2,
        };
        if !band.contains(&n) {
            bad.push(format!(
                "{name} (t{}) has {n} eaters, wants {band:?}",
                s.tier
            ));
        }
    }
    // Plants: eaten by grazers (a diet entry may name a whole family).
    for (name, p) in &b.flora_species {
        let n = fauna
            .iter()
            .filter(|(_, g)| {
                g.role == "herbivore" && g.eats.iter().any(|e| e == name || *e == p.family)
            })
            .count();
        let band = if p.tier == 3 { 1..=2 } else { 2..=3 };
        if !band.contains(&n) {
            bad.push(format!(
                "{name} (t{}) has {n} grazers, wants {band:?}",
                p.tier
            ));
        }
    }
    assert!(bad.is_empty(), "food-web bands broken:\n{}", bad.join("\n"));
}
