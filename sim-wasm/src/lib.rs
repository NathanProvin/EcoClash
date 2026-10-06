//! The simulation for the browser (Web Worker) and Node (INSTRUCTIONS §3.1, §6): a thin
//! wasm-bindgen wrapper over `sim_core::world::World`. It holds no rules of its own, so native
//! (`sim-cli`) and WASM runs give the same hash at every tick (checked by `npm run wasm:check`).
//!
//! Hashes cross the boundary as 16-digit hex strings (u64 would become a JS BigInt).

use sim_core::balance::Balance;
use sim_core::commands::Command;
use sim_core::hash::balance_hash;
use sim_core::terrain::TerrainParams;
use sim_core::world::World;
use wasm_bindgen::prelude::*;

/// One running match.
#[wasm_bindgen]
pub struct Sim {
    world: World,
    balance_hash: u64,
    species: String,
    catastrophes: String,
    weather: String,
    tick_hz: u32,
    flora_every: u32,
    pace: f64,
    plant_radius: u32,
    drop_radius: u32,
    victory_territory: f64,
    time_limit_s: u32,
    max_agents: u32,
    terrain: TerrainParams,
    relief_m: f64,
    /// The bots' income factors by level (D-143).
    bot_income: [f64; 3],
    seed: u64,
    /// Scripted opponents, and the next sequence number of each one's commands.
    bots: Vec<(sim_ai::Bot, u32)>,
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
            catastrophes: catastrophe_table(&b),
            weather: weather_table(&b),
            tick_hz: b.sim.tick_hz,
            flora_every: b.sim.flora_every_ticks,
            pace: b.sim.pace,
            plant_radius: b.flora.plant_radius,
            drop_radius: b.fauna.drop_radius,
            victory_territory: b.r#match.victory_territory,
            time_limit_s: b.r#match.time_limit_s,
            max_agents: b.agents.max_agents,
            terrain: TerrainParams::from_balance(&b),
            relief_m: b.terrain.relief_m,
            bot_income: b.bots.income,
            seed,
            bots: Vec::new(),
            world: World::new(&b, seed, n),
        })
    }

    /// Match setup: a free starting patch, before the first step (D-058). Returns cells planted.
    #[wasm_bindgen(js_name = setupPlant)]
    pub fn setup_plant(
        &mut self,
        player: u8,
        species: &str,
        row: u32,
        col: u32,
        radius: u32,
    ) -> u32 {
        u32::try_from(self.world.setup_plant(player, species, row, col, radius)).unwrap_or(0)
    }

    /// A sandbox match: every species unlocked and free (D-058). Call it before the first step.
    /// The tutorial match (D-141): it accepts grant commands. Before the first step.
    #[wasm_bindgen(js_name = setTutorial)]
    pub fn set_tutorial(&mut self, on: bool) {
        self.world.set_tutorial(on);
    }

    #[wasm_bindgen(js_name = setSandbox)]
    pub fn set_sandbox(&mut self, on: bool) {
        self.world.set_sandbox(on);
    }

    /// The verdict once the match is decided, as JSON `{"winner": 1, "reason": "territory",
    /// "tick": 1234}` (winner 0 = draw); an empty string while it is still on.
    pub fn result(&self) -> String {
        use sim_core::world::Reason;
        self.world.result.map_or(String::new(), |o| {
            let reason = match o.reason {
                Reason::Territory => "territory",
                Reason::Biomass => "biomass",
                Reason::TerritoryShare => "territory share",
                Reason::Draw => "draw",
            };
            serde_json::json!({ "winner": o.winner, "reason": reason, "tick": o.tick }).to_string()
        })
    }

    /// Standing biomass (plants of its cells plus animal bodies) of a player, for charts.
    #[allow(clippy::cast_precision_loss)] // display only
    pub fn standing(&self, player: u8) -> f64 {
        match player {
            1 | 2 => self.world.standing()[usize::from(player) - 1] as f64,
            _ => 0.0,
        }
    }

    /// Species cards a player (1 or 2) has unlocked: one flag per species, plants then animals
    /// (the species-table order).
    pub fn unlocked(&self, player: u8) -> Vec<u8> {
        let e = &self.world.economy;
        let species = self.world.flora.p.species() + self.world.fauna.p.names.len();
        (0..species)
            .map(|i| u8::from(matches!(player, 1 | 2) && e.is_unlocked(player, i)))
            .collect()
    }

    /// Queue one command (JSON, as in command files). False if refused (late or duplicate).
    pub fn submit(&mut self, command: &str) -> Result<bool, JsError> {
        let c: Command = serde_json::from_str(command).map_err(|e| JsError::new(&e.to_string()))?;
        Ok(self.world.submit(c))
    }

    /// Run one tick; returns the state hash after it.
    pub fn step(&mut self) -> String {
        // Bots decide before the tick and play through the command queue, like a human (D-014).
        for (bot, seq) in &mut self.bots {
            for payload in bot.think(&self.world) {
                let c = Command {
                    tick: self.world.tick,
                    player: bot.player,
                    seq: *seq,
                    payload,
                };
                *seq += 1;
                self.world.submit(c);
            }
        }
        hex(self.world.step())
    }

    /// Let a scripted bot play `player` ("easy", "normal" or "hard"; D-060). Its sequence numbers
    /// start high so they never collide with commands the host sends for the same player.
    #[wasm_bindgen(js_name = addBot)]
    pub fn add_bot(&mut self, player: u8, level: &str) -> Result<(), JsError> {
        let level = sim_ai::Level::parse(level).ok_or_else(|| JsError::new("unknown bot level"))?;
        if !matches!(player, 1 | 2) {
            return Err(JsError::new("player must be 1 or 2"));
        }
        let bot = sim_ai::Bot::new(player, level, self.plant_radius);
        let factor = self.bot_income[match level {
            sim_ai::Level::Easy => 0,
            sim_ai::Level::Normal => 1,
            sim_ai::Level::Hard => 2,
        }];
        self.world.set_income_factor(player, factor); // D-143
        self.bots.push((bot, 1 << 30));
        Ok(())
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

    /// Seconds of ecology per real second (D-069).
    #[wasm_bindgen(getter)]
    pub fn pace(&self) -> f64 {
        self.pace
    }

    /// Radius in cells of a player's plant order (`[flora] plant_radius`).
    #[wasm_bindgen(getter, js_name = plantRadius)]
    pub fn plant_radius(&self) -> u32 {
        self.plant_radius
    }

    /// Lay out this match's map from its seed (D-083), before the first tick; a no-op when the
    /// balance's generator is off.
    #[wasm_bindgen(js_name = generateTerrain)]
    pub fn generate_terrain(&mut self) {
        self.world.generate_terrain(&self.terrain, self.seed);
    }

    /// The map for renderers (D-083): elevation (0..=255), then the ground class (0 land,
    /// 1 shallow, 2 deep, 3 rock), `n * n` bytes each.
    #[wasm_bindgen(js_name = terrainFrame)]
    pub fn terrain_frame(&self) -> Vec<u8> {
        let st = &self.world.state;
        st.elevation
            .iter()
            .map(|&e| u8::try_from(e >> 8).unwrap_or(u8::MAX))
            .chain(st.ground.iter().copied())
            .collect()
    }

    /// Metres from the lowest to the highest ground, for the renderer (`[terrain] relief_m`).
    #[wasm_bindgen(getter, js_name = reliefM)]
    pub fn relief_m(&self) -> f64 {
        self.relief_m
    }

    /// Radius in cells around the click where a drop off your land lands (`[fauna] drop_radius`).
    #[wasm_bindgen(getter, js_name = dropRadius)]
    pub fn drop_radius(&self) -> u32 {
        self.drop_radius
    }

    /// Share of the map that wins now, the decay included (D-175), for display.
    #[wasm_bindgen(js_name = victoryNow)]
    pub fn victory_now(&self) -> f64 {
        // Display only, never fed back into the sim.
        #[allow(clippy::cast_precision_loss, clippy::float_arithmetic)]
        let share = self.world.threshold() as f64 / f64::from(sim_core::fixed::ONE);
        share
    }

    /// Share of the map that wins (`[match] victory_territory`), for display.
    #[wasm_bindgen(getter, js_name = victoryTerritory)]
    pub fn victory_territory(&self) -> f64 {
        self.victory_territory
    }

    /// Match length in seconds (`[match] time_limit_s`).
    #[wasm_bindgen(getter, js_name = timeLimitS)]
    pub fn time_limit_s(&self) -> u32 {
        self.time_limit_s
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

    /// Animals dropped by spawn commands since the last call, as flat (first id, count) pairs
    /// (D-080): the renderer parachutes them in.
    #[wasm_bindgen(js_name = takeDrops)]
    pub fn take_drops(&mut self) -> Vec<u32> {
        self.world
            .take_drops()
            .into_iter()
            .flat_map(|(first, count)| [first, count])
            .collect()
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

    /// Lockouts (D-098), two bytes per cell: the player barred from taking it back (0: none) and
    /// the seconds left (rounded up, at most 255), for the cell panel.
    #[wasm_bindgen(js_name = lockFrame)]
    pub fn lock_frame(&self) -> Vec<u8> {
        let st = &self.world.state;
        let per = u64::from(self.flora_every);
        let hz = u64::from(self.tick_hz.max(1));
        st.lock
            .iter()
            .zip(&st.lock_p)
            .flat_map(|(&ticks, &p)| {
                let s = u64::try_from(ticks.max(0)).unwrap_or(0) * per;
                let left = u8::try_from(s.div_ceil(hz)).unwrap_or(u8::MAX);
                if left > 0 { [p, left] } else { [0, 0] }
            })
            .collect()
    }

    /// How hard the non-owner pushes into each cell, 0..=255, for the frontier lines (D-076).
    #[wasm_bindgen(js_name = pressureFrame)]
    pub fn pressure_frame(&self) -> Vec<u8> {
        self.world.pressure_frame()
    }

    /// Standing dead wood per cell, 0..=255 (D-127).
    /// Shade on the ground and moisture per cell, 0..=255, for the map overlays (D-135).
    #[wasm_bindgen(js_name = shadeFrame)]
    pub fn shade_frame(&self) -> Vec<u8> {
        self.world.shade_frame()
    }

    #[wasm_bindgen(js_name = moistureFrame)]
    pub fn moisture_frame(&self) -> Vec<u8> {
        self.world.moisture_frame()
    }

    #[wasm_bindgen(js_name = deadwoodFrame)]
    pub fn deadwood_frame(&self) -> Vec<u8> {
        self.world.deadwood_frame()
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

    /// The catastrophe cards (D-129), as JSON: name, act, cost, radius, cooldown, duration,
    /// effect.
    #[wasm_bindgen(js_name = catastropheTable)]
    pub fn catastrophe_table(&self) -> String {
        self.catastrophes.clone()
    }

    /// Ticks before `player` may play each card again (0: ready), in table order (D-129).
    #[wasm_bindgen(js_name = catastropheWait)]
    pub fn catastrophe_wait(&self, player: u8) -> Vec<u32> {
        let ready = &self.world.catastrophes.ready;
        let Some(r) = ready.get(usize::from(player.max(1) - 1)) else {
            return Vec::new();
        };
        r.iter()
            .map(|&t| u32::try_from(t.saturating_sub(self.world.tick)).unwrap_or(u32::MAX))
            .collect()
    }

    /// The kinds of weather (D-132), as JSON: name, duration, factors, effect; plus the alert lead
    /// time.
    #[wasm_bindgen(js_name = weatherTable)]
    pub fn weather_table(&self) -> String {
        self.weather.clone()
    }

    /// The weather now (D-132): [kind + 1 (0: none), phase (0 calm, 1 alert, 2 at work), ticks
    /// until it starts (alert) or ends (at work)].
    pub fn weather(&self) -> Vec<u32> {
        use sim_core::weather::Phase;
        let w = &self.world.weather;
        let tick = self.world.tick;
        let kind = w.kind.map_or(0, |k| u32::try_from(k).unwrap_or(0) + 1);
        let (phase, until) = match w.phase() {
            Phase::Calm => (0, 0),
            Phase::Warning => (1, w.start.saturating_sub(tick)),
            Phase::Active => (2, w.end.saturating_sub(tick)),
        };
        vec![kind, phase, u32::try_from(until).unwrap_or(u32::MAX)]
    }

    /// The cells under flood water now (D-132), row-major indices.
    #[wasm_bindgen(js_name = floodCells)]
    pub fn flood_cells(&self) -> Vec<u32> {
        let w = &self.world.weather;
        w.flooded
            .iter()
            .map(|&(c, _, _)| u32::try_from(c).unwrap_or(u32::MAX))
            .collect()
    }

    /// Catastrophes cast since the last call, as flat (player, card, row, col) quadruples.
    #[wasm_bindgen(js_name = takeEffects)]
    pub fn take_effects(&mut self) -> Vec<u32> {
        self.world
            .take_effects()
            .into_iter()
            .flat_map(|(p, k, r, c)| [u32::from(p), u32::try_from(k).unwrap_or(0), r, c])
            .collect()
    }
}

fn catastrophe_table(b: &Balance) -> String {
    let cards = b.catastrophes.iter().map(|(name, c)| {
        serde_json::json!({
            "name": name, "act": format!("{:?}", c.act).to_lowercase(), "cost": c.cost,
            "radius": c.radius, "cooldown_s": c.cooldown_s, "duration_s": c.duration_s,
            "effect": c.effect,
        })
    });
    serde_json::Value::Array(cards.collect()).to_string()
}

fn weather_table(b: &Balance) -> String {
    let kinds = b.weather.kinds.iter().map(|k| {
        serde_json::json!({
            "name": k.name, "duration_s": k.duration_s, "effect": k.effect,
            "growth": k.growth, "speed": k.speed, "bite": k.bite,
        })
    });
    serde_json::json!({ "warning_s": b.weather.warning_s, "kinds": kinds.collect::<Vec<_>>() })
        .to_string()
}

fn species_table(b: &Balance) -> String {
    let flora = b.flora_species.iter().map(|(name, s)| {
        serde_json::json!({
            "name": name, "kind": "flora", "family": s.family, "level": s.level, "tier": s.tier,
            "role": format!("L{}", s.level), "habitat": [], "eats": [],
            "stats": {
                "growth": s.growth, "spawn_cost": s.spawn_cost, "unlock_cost": s.unlock_cost,
                "yield": s.yield_, "cap": s.cap, "effect": s.effect,
            },
        })
    });
    let fauna = b.fauna_species.iter().map(|(name, s)| {
        serde_json::json!({
            "name": name, "kind": "fauna", "family": s.family, "level": 0, "tier": s.tier,
            "role": s.role, "habitat": s.habitat, "eats": s.eats, "swarm": s.swarm,
            "medium": format!("{:?}", s.medium).to_lowercase(),
            "stats": {
                "growth": s.growth, "spawn_cost": s.spawn_cost, "unlock_cost": s.unlock_cost,
                "yield": s.yield_, "cap": s.cap, "effect": s.effect, "speed": s.speed,
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
