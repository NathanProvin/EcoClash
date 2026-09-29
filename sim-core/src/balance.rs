//! Game data, parsed once at load (INSTRUCTIONS §4, D-029): global rules from `balance.toml` and
//! the per-species stat sheet from `species.toml`. Values stay as written (floats) here and are
//! converted to fixed-point once, by the modules that use them (see `flora::FloraParams`).
//!
//! `sim-core` does no I/O: callers pass the file contents. Tuning a value or a species stat never
//! needs a recompile. Species keep their order of appearance in the file (their index).

use std::collections::BTreeMap;

use serde::Deserialize;

/// `[sim]`: ticks and grid.
#[derive(Clone, Debug, Deserialize)]
pub struct Sim {
    pub tick_hz: u32,
    pub flora_every_ticks: u32,
    pub env_every_ticks: u32,
    pub grid_size: u32,
    pub chunk_size: u32,
}

/// `[flora]` global rules (gamerules §2–§3; D-019, D-022, D-024).
#[derive(Clone, Debug, Deserialize)]
pub struct FloraRules {
    pub seed_fraction: f64,
    pub establish_threshold: f64,
    pub smother_rate: f64,
    pub litter_fraction: f64,
    pub niche_overlap: f64,
    pub soil_min_level: [f64; 3],
    pub soil_ramp: f64,
    pub plant_gauge: f64,
    /// Brush radius of a player's plant order (a command parameter, not a rule: not hashed).
    pub plant_radius: u32,
    pub succession: bool,
    pub shade: bool,
    pub contested_cells: bool,
}

/// `[economy]`: the points bank (gamerules §4; D-046). Other keys are prototype-only for now.
#[derive(Clone, Debug, Deserialize)]
pub struct EconomyRules {
    pub start_budget: f64,
    /// Animals landing outside own land cost this much more (gamerules §6.3; D-061).
    pub drop_surcharge: f64,
}

/// `[match]`: victory (INSTRUCTIONS §2.3, gamerules §11.3; D-059).
#[derive(Clone, Debug, Deserialize)]
pub struct MatchRules {
    /// Share of the map that wins at once.
    pub victory_territory: f64,
    pub time_limit_s: u32,
    /// [Proposed] switch: the threshold decays from `territory_start` to `territory_end`.
    pub territory_decay: bool,
    pub territory_start: f64,
    pub territory_end: f64,
}

/// `[agents]`: the agent budget (INSTRUCTIONS §5.4).
#[derive(Clone, Debug, Deserialize)]
pub struct AgentRules {
    /// Total for both players; each player may field half.
    pub max_agents: u32,
}

/// `[fauna]` global rules (gamerules §6; D-023, D-026).
#[derive(Clone, Debug, Deserialize)]
pub struct FaunaRules {
    pub transfer: f64,
    pub own_graze: f64,
    pub soil_per_dead: f64,
    /// A drop lands within this many cells of the click (D-061).
    pub drop_radius: u32,
    pub flee_radius: u32,
    pub refuge_flora: Vec<String>,
    pub refuge_cover: f64,
    /// Organic movement (D-065): drift kick (share of speed), drift kept per tick, target scatter
    /// around cell centres (cells), idle stroll radius (cells).
    pub wobble: f64,
    pub wobble_keep: f64,
    pub scatter: f64,
    pub wander_radius: f64,
}

/// `[terrain]`: V1 constants and the soil types (gamerules §2.3).
#[derive(Clone, Debug, Deserialize)]
pub struct Terrain {
    pub water: f64,
    pub light: f64,
    pub soil_types: Vec<String>,
}

/// One plant species of `species.toml` (`[flora.<name>]`).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FloraSpecies {
    // Stats (D-029).
    pub growth: f64,
    pub spawn_cost: f64,
    pub unlock_cost: f64,
    #[serde(rename = "yield")]
    pub yield_: f64,
    /// Share of the map's cells per player (D-045).
    pub cap: f64,
    pub effect: String,
    // Model.
    pub level: u8,
    pub tier: u8,
    #[serde(default)]
    pub pioneer: bool,
    pub biomass_rate: f64,
    pub k_max: f64,
    pub shade_cast: f64,
    pub shade_tolerance: f64,
    pub soil_gain: f64,
    #[serde(default)]
    pub water_optimum: f64,
    #[serde(default)]
    pub water_tolerance: f64,
    #[serde(default)]
    pub light_optimum: f64,
    #[serde(default)]
    pub light_tolerance: f64,
    #[serde(default)]
    pub soil_affinity: BTreeMap<String, f64>,
}

/// One animal species of `species.toml` (`[fauna.<name>]`).
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FaunaSpecies {
    // Stats (D-029).
    /// Minimum seconds between two births of a well-fed animal.
    pub growth: f64,
    pub spawn_cost: f64,
    pub unlock_cost: f64,
    #[serde(rename = "yield")]
    pub yield_: f64,
    /// Animals per player.
    pub cap: u32,
    pub effect: String,
    // Model.
    pub level: u8,
    pub tier: u8,
    /// "decomposer", "herbivore" or "predator".
    pub role: String,
    /// Flora names or L1..L3 (herbivores), fauna names (predators), "dead" (decomposers).
    pub eats: Vec<String>,
    /// Flora names or L1..L3 that the player must own for a spawn.
    pub habitat: Vec<String>,
    /// Can hide in a refuge (D-023).
    #[serde(default)]
    pub small: bool,
    /// Energy capacity, in biomass units.
    pub body: u32,
    /// Biomass eaten per second (herbivores, decomposers).
    #[serde(default)]
    pub bite: f64,
    /// Share of the body burnt per second.
    pub upkeep: f64,
    /// Cells per second.
    pub speed: f64,
    /// Cells.
    pub sight: u32,
    /// Animals per spawned card.
    pub group: u32,
}

/// Everything `sim-core` reads from the data files, validated.
#[derive(Clone, Debug)]
pub struct Balance {
    pub sim: Sim,
    pub flora: FloraRules,
    pub terrain: Terrain,
    pub economy: EconomyRules,
    pub agents: AgentRules,
    pub fauna: FaunaRules,
    #[allow(clippy::struct_field_names)]
    pub r#match: MatchRules,
    /// Plant species in file order: the index is the species id.
    pub flora_species: Vec<(String, FloraSpecies)>,
    /// Animal species in file order: the index is the species id.
    pub fauna_species: Vec<(String, FaunaSpecies)>,
}

#[derive(Deserialize)]
struct BalanceFile {
    sim: Sim,
    flora: FloraRules,
    terrain: Terrain,
    economy: EconomyRules,
    agents: AgentRules,
    fauna: FaunaRules,
    r#match: MatchRules,
}

impl Balance {
    /// Parse and validate `balance.toml` and `species.toml` contents.
    pub fn from_toml(balance: &str, species: &str) -> Result<Balance, String> {
        let file: BalanceFile =
            toml::from_str(balance).map_err(|e| format!("balance.toml: {e}"))?;
        let doc: toml::Table = species.parse().map_err(|e| format!("species.toml: {e}"))?;
        let b = Balance {
            sim: file.sim,
            flora: file.flora,
            terrain: file.terrain,
            economy: file.economy,
            agents: file.agents,
            fauna: file.fauna,
            r#match: file.r#match,
            flora_species: section(&doc, "flora")?,
            fauna_species: section(&doc, "fauna")?,
        };
        b.validate()?;
        Ok(b)
    }

    /// Seconds per flora tick.
    #[must_use]
    #[allow(clippy::float_arithmetic)] // load-time conversion, see fixed::Q16::from_balance
    pub fn flora_dt(&self) -> f64 {
        f64::from(self.sim.flora_every_ticks) / f64::from(self.sim.tick_hz)
    }

    /// The prototype's asserts (tools/prototype/flora.py), as errors.
    #[allow(clippy::float_arithmetic)]
    fn validate(&self) -> Result<(), String> {
        let f = &self.flora;
        let check = |ok: bool, what: String| if ok { Ok(()) } else { Err(what) };
        check(
            self.sim.tick_hz > 0 && self.sim.flora_every_ticks > 0,
            "[sim] ticks must be > 0".into(),
        )?;
        check(
            self.sim.grid_size.is_multiple_of(self.sim.chunk_size),
            "[sim] grid_size % chunk_size != 0".into(),
        )?;
        check(
            self.terrain.soil_types.first().is_some_and(|t| t == "loam"),
            "[terrain] first soil type must be loam".into(),
        )?;
        check(
            (0.0..=1.0).contains(&f.niche_overlap),
            "[flora] niche_overlap must be in 0..1".into(),
        )?;
        check(f.soil_ramp > 0.0, "[flora] soil_ramp must be > 0".into())?;
        check(
            !self.flora_species.is_empty(),
            "species.toml: no [flora.*] species".into(),
        )?;
        check(
            (0.0..=32767.0).contains(&self.economy.start_budget),
            "economy.start_budget must be in 0..32767".into(),
        )?;
        let m = &self.r#match;
        check(
            [m.victory_territory, m.territory_start, m.territory_end]
                .iter()
                .all(|v| (0.0..=1.0).contains(v))
                && m.time_limit_s > 0,
            "[match] territory shares must be in 0..1 and time_limit_s > 0".into(),
        )?;
        check(
            self.economy.drop_surcharge >= 1.0,
            "economy.drop_surcharge must be >= 1".into(),
        )?;
        let dt = self.flora_dt();
        self.validate_fauna()?;
        for (n, s) in &self.flora_species {
            check(
                (1..=3).contains(&s.level),
                format!("{n}: level must be 1..3"),
            )?;
            check(
                s.k_max > 0.0 && s.k_max <= 65535.0,
                format!("{n}: k_max must be in 1..65535"),
            )?;
            check(
                s.cap > 0.0 && s.cap <= 1.0,
                format!("{n}: cap is a share of the map, in 0..1 (D-045)"),
            )?;
            check(
                (0.0..1.0).contains(&s.shade_cast),
                format!("{n}: shade_cast must be in 0..1"),
            )?;
            check(
                (0.0..=1.0).contains(&s.shade_tolerance),
                format!("{n}: shade_tolerance must be in 0..1"),
            )?;
            // The fast flora step needs every established species to have biomass (D-038).
            check(
                s.k_max * f.establish_threshold >= 0.5,
                format!("{n}: k_max x establish_threshold must be >= 1 after rounding"),
            )?;
            check(
                s.biomass_rate * dt < 1.0,
                format!("{n}: biomass_rate * dt must stay < 1"),
            )?;
            check(
                s.growth * dt <= 1.0,
                format!("{n}: growth * dt must stay <= 1"),
            )?;
            for t in s.soil_affinity.keys() {
                check(
                    self.terrain.soil_types.contains(t),
                    format!("{n}: unknown soil type {t}"),
                )?;
            }
        }
        Ok(())
    }

    /// Every name an animal refers to exists, and the numbers are usable.
    fn validate_fauna(&self) -> Result<(), String> {
        let check = |ok: bool, what: String| if ok { Ok(()) } else { Err(what) };
        let flora = |x: &str| {
            self.flora_species.iter().any(|(n, _)| n == x) || matches!(x, "L1" | "L2" | "L3")
        };
        let fauna = |x: &str| self.fauna_species.iter().any(|(n, _)| n == x);
        check(
            self.flora_species.len() <= 32 && self.fauna_species.len() <= 32,
            "species.toml: at most 32 flora and 32 fauna species".into(),
        )?;
        check(
            self.agents.max_agents >= 2,
            "[agents] max_agents must be >= 2".into(),
        )?;
        let fa = &self.fauna;
        check(
            fa.wobble >= 0.0
                && (0.0..1.0).contains(&fa.wobble_keep)
                && (0.0..0.5).contains(&fa.scatter)
                && fa.wander_radius >= 0.0,
            "[fauna] wobble >= 0, wobble_keep in [0, 1), scatter in [0, 0.5), wander_radius >= 0"
                .into(),
        )?;
        for r in &self.fauna.refuge_flora {
            check(flora(r), format!("[fauna] refuge_flora: unknown plant {r}"))?;
        }
        for (n, s) in &self.fauna_species {
            let eats_ok = match s.role.as_str() {
                "decomposer" => s.eats.iter().all(|e| e == "dead"),
                "herbivore" => s.eats.iter().all(|e| flora(e)),
                "predator" => s.eats.iter().all(|e| fauna(e)),
                _ => false,
            };
            check(
                eats_ok,
                format!(
                    "{n}: role must be decomposer, herbivore or predator, with a matching diet"
                ),
            )?;
            check(
                s.habitat.iter().all(|h| flora(h)),
                format!("{n}: unknown habitat plant"),
            )?;
            check(
                s.body > 0 && s.speed > 0.0 && s.group > 0 && s.growth > 0.0,
                format!("{n}: body, speed, group and growth must be > 0"),
            )?;
        }
        Ok(())
    }
}

/// The `[kind.<name>]` tables of species.toml, in file order.
fn section<T: serde::de::DeserializeOwned>(
    doc: &toml::Table,
    kind: &str,
) -> Result<Vec<(String, T)>, String> {
    let mut out = Vec::new();
    if let Some(table) = doc.get(kind).and_then(toml::Value::as_table) {
        for (name, value) in table {
            let s: T = value
                .clone()
                .try_into()
                .map_err(|e| format!("species.toml [{kind}.{name}]: {e}"))?;
            out.push((name.clone(), s));
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BALANCE: &str = include_str!("../../data/balance.toml");
    const SPECIES: &str = include_str!("../../data/species.toml");

    #[test]
    fn loads_the_real_data_files_in_file_order() {
        let b = Balance::from_toml(BALANCE, SPECIES).expect("data files load");
        let names: Vec<&str> = b.flora_species.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names.first(), Some(&"lichen_and_moss"));
        assert_eq!(names.last(), Some(&"chestnut"));
        assert_eq!(names.len(), 12);
        assert!(b.flora.succession);
        assert_eq!(
            b.fauna_species.first().map(|(n, _)| n.as_str()),
            Some("earthworms")
        );
        assert_eq!(b.fauna_species.len(), 15);
    }

    #[test]
    fn rejects_bad_values_with_a_readable_error() {
        let bad = SPECIES.replacen("shade_cast = 0.85", "shade_cast = 1.5", 1);
        let err = Balance::from_toml(BALANCE, &bad).unwrap_err();
        assert!(err.contains("beech") && err.contains("shade_cast"), "{err}");
        let typo = SPECIES.replacen("k_max = 60000", "k_maxx = 60000", 1);
        assert!(
            Balance::from_toml(BALANCE, &typo)
                .unwrap_err()
                .contains("k_maxx")
        );
    }
}
