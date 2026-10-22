//! `sim-cli sheet` (Alpha 1.7, M7-lite): every species' stats and the figures derived from them,
//! as two compact tables, plus flags for the outliers. Read-only: it parses the balance and
//! prints; nothing is simulated. All rates are per real second (ecology rates × `[sim] pace`).
//!
//! Plants: `mature/s` is one fully covered cell's income (stock_share × yield, its growth spent);
//! `peak/s` a half-covered cell growing at its fastest (D-247); `payback` the spawn cost over
//! `mature/s`; `fill` the seconds from 10 % to 90 % cover (logistic, ln 81 / r), not counting the
//! colonization gauge. Animals: per card (`group` animals); `dmg/s` is what a grazer card strips
//! from enemy plants (bite × graze_damage × tier_damage).

use std::fmt::Write as _;

use sim_core::balance::Balance;

/// A payback this many times the family median (or 1 / this) is flagged.
const OUTLIER: f64 = 2.0;

/// One plant's derived figures.
#[derive(Debug)]
pub struct Plant {
    pub name: String,
    pub family: String,
    pub tier: u8,
    pub unlock: f64,
    pub spawn: f64,
    pub mature: f64,
    pub peak: f64,
    pub payback: f64,
    pub fill: f64,
}

#[allow(clippy::float_arithmetic)] // report figures only
#[must_use]
pub fn plants(b: &Balance) -> Vec<Plant> {
    let (pace, stock) = (b.sim.pace, b.economy.stock_share);
    b.flora_species
        .iter()
        .map(|(name, s)| {
            let mature = s.yield_ * stock * pace;
            let mature_pay = if mature > 0.0 {
                s.spawn_cost / mature
            } else {
                f64::INFINITY
            };
            Plant {
                name: name.clone(),
                family: s.family.clone(),
                tier: s.tier,
                unlock: s.unlock_cost,
                spawn: s.spawn_cost,
                mature,
                // Half cover grows at r·K/4, the peak: production 1.
                peak: s.yield_ * (stock * 0.5 + (1.0 - stock)) * pace,
                payback: mature_pay,
                fill: 81f64.ln() / (s.biomass_rate * pace),
            }
        })
        .collect()
}

/// One animal's derived figures, per card.
#[derive(Debug)]
pub struct Animal {
    pub name: String,
    pub family: String,
    pub tier: u8,
    pub role: String,
    pub card: f64,
    pub unlock: f64,
    pub income: f64,
    pub breed: f64,
    pub damage: f64,
    pub eaten_by: Vec<String>,
}

#[allow(clippy::float_arithmetic, clippy::cast_precision_loss)] // report figures only
#[must_use]
pub fn animals(b: &Balance) -> Vec<Animal> {
    let pace = b.sim.pace;
    let fa = &b.fauna;
    b.fauna_species
        .iter()
        .map(|(name, s)| {
            let group = f64::from(s.group);
            let tier = usize::from(s.tier.clamp(1, 3) - 1);
            Animal {
                name: name.clone(),
                family: s.family.clone(),
                tier: s.tier,
                role: s.role.clone(),
                card: s.spawn_cost * group,
                unlock: s.unlock_cost,
                income: s.yield_ * group * pace,
                breed: s.growth / pace,
                damage: if s.role == "herbivore" {
                    s.bite * fa.graze_damage * fa.tier_damage[tier] * group * pace
                } else {
                    0.0
                },
                eaten_by: b
                    .fauna_species
                    .iter()
                    .filter(|(_, p)| p.eats.iter().any(|e| e == name))
                    .map(|(p, _)| p.clone())
                    .collect(),
            }
        })
        .collect()
}

fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v.get(v.len() / 2).copied().unwrap_or(0.0)
}

/// Both tables and the flags, as printed text.
#[allow(clippy::float_arithmetic)] // report figures only
#[must_use]
pub fn report(b: &Balance) -> String {
    let (ps, an) = (plants(b), animals(b));
    let mut out = String::new();
    let mut flags = Vec::new();
    let planned =
        |n: &str| sim_ai::UNLOCKS.contains(&n) || sim_ai::WATER_PLAN.iter().any(|&(_, w)| w == n);

    let _ = writeln!(
        out,
        "PLANTS        fam t  unlock  spawn mature/s peak/s payback_s fill_s"
    );
    for p in &ps {
        let _ = writeln!(
            out,
            "{:<16}{:<3}{} {:>7.0} {:>6.0} {:>8.3} {:>6.3} {:>9.0} {:>6.0}",
            p.name, p.family, p.tier, p.unlock, p.spawn, p.mature, p.peak, p.payback, p.fill
        );
    }
    let keys: Vec<_> = ps
        .iter()
        .map(|p| (p.family.as_str(), p.tier, p.unlock))
        .collect();
    for p in &ps {
        flags.extend(below(
            &keys,
            (&p.family, p.tier, p.unlock),
            &p.name,
            "unlock",
        ));
        let fam = median(
            ps.iter()
                .filter(|q| q.family == p.family)
                .map(|q| q.payback)
                .collect(),
        );
        if p.payback > fam * OUTLIER || p.payback * OUTLIER < fam {
            flags.push(format!(
                "{}: payback {:.0} s, family median {fam:.0} s",
                p.name, p.payback
            ));
        }
        if p.unlock > 0.0 && !planned(&p.name) {
            flags.push(format!("{}: no bot plan unlocks it", p.name));
        }
    }

    let _ = writeln!(
        out,
        "\nANIMALS          fam t role        card unlock income/s payback_s breed_s  dmg/s eaten by"
    );
    for a in &an {
        let payback = if a.income > 0.0 {
            a.card / a.income
        } else {
            f64::INFINITY
        };
        let _ = writeln!(
            out,
            "{:<17}{:<4}{} {:<10}{:>6.0} {:>6.0} {:>8.3} {:>9.0} {:>7.0} {:>6.0} {}",
            a.name,
            a.family,
            a.tier,
            a.role,
            a.card,
            a.unlock,
            a.income,
            payback,
            a.breed,
            a.damage,
            a.eaten_by.join(",")
        );
    }
    let keys: Vec<_> = an
        .iter()
        .map(|a| (a.family.as_str(), a.tier, a.card))
        .collect();
    for a in &an {
        flags.extend(below(&keys, (&a.family, a.tier, a.card), &a.name, "card"));
        if a.role != "predator" && a.eaten_by.is_empty() {
            flags.push(format!("{}: nothing hunts it", a.name));
        }
        if !planned(&a.name) {
            flags.push(format!("{}: no bot plan unlocks it", a.name));
        }
    }
    let grazers: Vec<&Animal> = an.iter().filter(|a| a.damage > 0.0).collect();
    let per_cost = median(grazers.iter().map(|a| a.damage / a.card).collect());
    for a in grazers {
        let r = a.damage / a.card / per_cost;
        if !(1.0 / OUTLIER..=OUTLIER).contains(&r) {
            flags.push(format!(
                "{}: damage per point {r:.1}x the grazer median",
                a.name
            ));
        }
    }

    let _ = writeln!(out, "\nFLAGS ({})", flags.len());
    for f in flags {
        let _ = writeln!(out, "- {f}");
    }
    out
}

/// A flag when a card (family, tier, cost) costs less than its family's card one tier below.
fn below(
    all: &[(&str, u8, f64)],
    (fam, tier, cost): (&str, u8, f64),
    name: &str,
    what: &str,
) -> Option<String> {
    let &(_, _, c) = all.iter().find(|&&(f, t, _)| f == fam && t + 1 == tier)?;
    (cost < c).then(|| format!("{name}: {what} {cost:.0} < tier {} {c:.0}", tier - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn balance() -> Balance {
        Balance::from_toml(
            include_str!("../../data/balance.toml"),
            include_str!("../../data/species.toml"),
        )
        .unwrap()
    }

    #[test]
    #[allow(clippy::float_arithmetic)]
    fn a_plant_pays_back_its_spawn_cost_from_its_mature_income() {
        let b = balance();
        let (_, s) = b
            .flora_species
            .iter()
            .find(|(n, _)| n == "grasses")
            .unwrap();
        let p = plants(&b)
            .into_iter()
            .find(|p| p.name == "grasses")
            .unwrap();
        let mature = s.yield_ * b.economy.stock_share * b.sim.pace; // per real second
        assert!((p.mature - mature).abs() < 1e-12);
        assert!((p.payback - s.spawn_cost / mature).abs() < 1e-9);
        assert!(
            p.peak > p.mature,
            "a growing cell out-earns a mature one (D-247)"
        );
    }

    #[test]
    fn hunters_are_listed_as_their_preys_eaters() {
        let an = animals(&balance());
        let rabbits = an.iter().find(|a| a.name == "rabbits").unwrap();
        assert!(rabbits.eaten_by.iter().any(|p| p == "fox"));
        assert!(
            an.iter()
                .filter(|a| a.role == "predator")
                .all(|a| a.damage == 0.0)
        );
    }
}
