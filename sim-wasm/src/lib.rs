//! The simulation for the browser (Web Worker) and Node (INSTRUCTIONS §3.1, §6): a thin
//! wasm-bindgen wrapper over `sim_core::world::World`. It holds no rules of its own, so native
//! (`sim-cli`) and WASM runs give the same hash at every tick (checked by `npm run wasm:check`).
//!
//! Hashes cross the boundary as 16-digit hex strings (u64 would become a JS BigInt).

use sim_core::balance::Balance;
use sim_core::commands::Command;
use sim_core::hash::balance_hash;
use sim_core::world::World;
use wasm_bindgen::prelude::*;

/// One running match.
#[wasm_bindgen]
pub struct Sim {
    world: World,
    balance_hash: u64,
    species: String,
    tick_hz: u32,
    plant_radius: u32,
    max_agents: u32,
}

#[wasm_bindgen]
impl Sim {
    /// A bare `size x size` map (0 = the balance's grid size), from the contents of
    /// `balance.toml` and `species.toml`, with a match seed.
    #[wasm_bindgen(constructor)]
    pub fn new(balance: &str, species: &str, seed: u64, size: u32) -> Result<Sim, JsError> {
        let b = Balance::from_toml(balance, species).map_err(|e| JsError::new(&e))?;
        let n = if size == 0 { b.sim.grid_size } else { size };
        let n = usize::try_from(n).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(Sim {
            balance_hash: balance_hash(&b),
            species: species_table(&b),
            tick_hz: b.sim.tick_hz,
            plant_radius: b.flora.plant_radius,
            max_agents: b.agents.max_agents,
            world: World::new(&b, seed, n),
        })
    }

    /// Queue one command (JSON, as in command files). False if refused (late or duplicate).
    pub fn submit(&mut self, command: &str) -> Result<bool, JsError> {
        let c: Command = serde_json::from_str(command).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(self.world.submit(c))
    }

    /// Run one tick; returns the state hash after it.
    pub fn step(&mut self) -> String {
        hex(self.world.step())
    }

    /// Ticks done so far.
    #[wasm_bindgen(getter)]
    pub fn tick(&self) -> f64 {
        #[allow(clippy::cast_precision_loss)] // exact below 2^53 ticks (~28 000 years at 10 Hz)
        let t = self.world.tick as f64;
        t
    }

    /// Flora ticks done so far: the field frame changes only when this does.
    #[wasm_bindgen(getter, js_name = floraTick)]
    pub fn flora_tick(&self) -> f64 {
        #[allow(clippy::cast_precision_loss)]
        let t = self.world.state.t as f64;
        t
    }

    #[wasm_bindgen(getter, js_name = balanceHash)]
    pub fn balance_hash(&self) -> String {
        hex(self.balance_hash)
    }

    /// Sim ticks per second.
    #[wasm_bindgen(getter, js_name = tickHz)]
    pub fn tick_hz(&self) -> u32 {
        self.tick_hz
    }

    /// Radius in cells of a player's plant order (`[flora] plant_radius`).
    #[wasm_bindgen(getter, js_name = plantRadius)]
    pub fn plant_radius(&self) -> u32 {
        self.plant_radius
    }

    /// Points banked by a player (1 or 2), for display.
    #[allow(clippy::float_arithmetic, clippy::cast_precision_loss)] // display only, never fed back
    pub fn bank(&self, player: u8) -> f64 {
        points(self.world.economy.bank, player)
    }

    /// A player's income over the last flora tick, in points per second, for display.
    #[allow(clippy::float_arithmetic, clippy::cast_precision_loss)]
    pub fn income(&self, player: u8) -> f64 {
        points(self.world.economy.income, player)
    }

    /// The agent budget, both players (instance buffer capacity).
    #[wasm_bindgen(getter, js_name = maxAgents)]
    pub fn max_agents(&self) -> u32 {
        self.max_agents
    }

    /// The animals now, for the renderer: see `sim_core::fauna::Fauna::frame`.
    #[wasm_bindgen(js_name = agentFrame)]
    pub fn agent_frame(&self) -> Vec<u8> {
        self.world.fauna.frame()
    }

    /// Why recent orders did nothing, as JSON `[{"player": 1, "text": "..."}]`; then forgotten.
    #[wasm_bindgen(js_name = takeNotices)]
    pub fn take_notices(&mut self) -> String {
        let list: Vec<_> = self
            .world
            .take_notices()
            .into_iter()
            .map(|(player, text)| serde_json::json!({ "player": player, "text": text }))
            .collect();
        serde_json::Value::Array(list).to_string()
    }

    /// Commands refused so far.
    #[wasm_bindgen(getter)]
    pub fn rejected(&self) -> f64 {
        #[allow(clippy::cast_precision_loss)]
        let r = self.world.rejected as f64;
        r
    }

    /// The current field frame, in the replay v3 layout the viewer decodes: owner, soil, then the
    /// cover of each plant species, `n * n` bytes each.
    #[wasm_bindgen(js_name = fieldFrame)]
    pub fn field_frame(&self) -> Vec<u8> {
        self.world.snapshot().field_frame()
    }

    /// Plant species names, in id order (the order of the cover layers).
    #[wasm_bindgen(js_name = speciesNames)]
    pub fn species_names(&self) -> Vec<String> {
        self.world.flora.p.names.clone()
    }

    /// The stat sheet as JSON, plants then animals, each in id order, in the viewer's `Species`
    /// shape (the table the prototype writes into replays: tools/prototype/match.py).
    #[wasm_bindgen(js_name = speciesTable)]
    pub fn species_table(&self) -> String {
        self.species.clone()
    }
}

fn species_table(b: &Balance) -> String {
    let flora = b.flora_species.iter().map(|(name, s)| {
        serde_json::json!({
            "name": name, "kind": "flora", "level": s.level, "tier": s.tier,
            "role": format!("L{}", s.level), "habitat": [], "eats": [],
            "stats": {
                "growth": s.growth, "spawn_cost": s.spawn_cost, "unlock_cost": s.unlock_cost,
                "yield": s.yield_, "cap": s.cap, "effect": s.effect,
            },
        })
    });
    let fauna = b.fauna_species.iter().map(|(name, s)| {
        serde_json::json!({
            "name": name, "kind": "fauna", "level": s.level, "tier": s.tier,
            "role": s.role, "habitat": s.habitat, "eats": s.eats,
            "stats": {
                "growth": s.growth, "spawn_cost": s.spawn_cost, "unlock_cost": s.unlock_cost,
                "yield": s.yield_, "cap": s.cap, "effect": s.effect,
            },
        })
    });
    serde_json::Value::Array(flora.chain(fauna).collect()).to_string()
}

/// A player's Q16 value as a float (0 for an unknown player).
#[allow(clippy::float_arithmetic, clippy::cast_precision_loss)]
fn points(v: [i64; 2], player: u8) -> f64 {
    let q = match player {
        1 | 2 => v[usize::from(player) - 1],
        _ => 0,
    };
    q as f64 / f64::from(sim_core::fixed::ONE)
}

fn hex(v: u64) -> String {
    format!("{v:016x}")
}
