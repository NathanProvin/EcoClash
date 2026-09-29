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

/// Everything `sim-core` reads from the data files, validated.
#[derive(Clone, Debug)]
pub struct Balance {
    pub sim: Sim,
    pub flora: FloraRules,
    pub terrain: Terrain,
    /// Plant species in file order: the index is the species id.
    pub flora_species: Vec<(String, FloraSpecies)>,
}

#[derive(Deserialize)]
struct BalanceFile {
    sim: Sim,
    flora: FloraRules,
    terrain: Terrain,
}

impl Balance {
    /// Parse and validate `balance.toml` and `species.toml` contents.
    pub fn from_toml(balance: &str, species: &str) -> Result<Balance, String> {
        let file: BalanceFile =
            toml::from_str(balance).map_err(|e| format!("balance.toml: {e}"))?;
        let doc: toml::Table = species.parse().map_err(|e| format!("species.toml: {e}"))?;
        let mut flora_species = Vec::new();
        if let Some(table) = doc.get("flora").and_then(toml::Value::as_table) {
            for (name, value) in table {
                let s: FloraSpecies = value
                    .clone()
                    .try_into()
                    .map_err(|e| format!("species.toml [flora.{name}]: {e}"))?;
                flora_species.push((name.clone(), s));
            }
        }
        let b = Balance {
            sim: file.sim,
            flora: file.flora,
            terrain: file.terrain,
            flora_species,
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
        let dt = self.flora_dt();
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
        assert_eq!(names.first(), Some(&"lichen"));
        assert_eq!(names.last(), Some(&"chestnut"));
        assert_eq!(names.len(), 12);
        assert!(b.flora.succession);
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
