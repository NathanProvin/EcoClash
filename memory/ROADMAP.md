# ROADMAP.md — EcoClash

> Living plan. Update the **Status** block and tick boxes at the end of every session.
> One task ≈ one commit. The acceptance criteria are the ones in INSTRUCTIONS §11.

## Status
- **Now:** M5a, the playable alpha for outside playtesters (D-073). First: the fps gate on the reference laptop.
- **Next:** M7-lite (balance loop) → Content (terrain, biomes, map generator, species) → M5b (art) → M6 (online multiplayer).
- **Blocked:** none. Fog of war: none for now (D-074).
- **Last updated:** 2026-09-30

---

## M-1 · Environment bootstrap ✅ (2026-09-27)
- [x] Spec review, with improvements applied to INSTRUCTIONS (D-006…D-015)
- [x] Memory files: CLAUDE.md, DECISIONS, ROADMAP, OPEN_QUESTIONS, JOURNAL
- [x] Pinned toolchains: `rust-toolchain.toml`, `.nvmrc`, `.python-version`, `tools/pyproject.toml` + `uv.lock`
- [x] Repo hygiene: `.gitattributes` (LF), `.editorconfig`, `.gitignore`
- [x] `npm run doctor`
- [x] `git init` + first commit
- [x] Rust 1.98.1 + wasm32 + MSVC Build Tools installed; `npm run doctor` green, native + wasm32 hello builds OK

## M0 · Ecological prototype (Python, `tools/prototype/`)
Flora-only first, following the gamerules cell model (D-019). [Proposed] flora rules are prototyped behind switches in `balance.toml`.
- [x] M0.1 NumPy float cell model (`tools/prototype/flora.py`): strata, logistic growth + shade, soil development, spread / colonize / smother / frozen frontiers, territory. Species from `balance.toml` `[flora.<id>]`. Mirrored scripted scenario; CSV + plots (biomass, territory %, income).
- [x] M0.2 Quantized mode: u16 state, Q16.16 rates, the §4 rounding rule, stochastic rounding vs growth floor (resolves Q-015).
- [x] M0.3 Comparison runs: float vs quant curves, each [Proposed] switch on vs off. Report in JOURNAL.
- [x] M0.4 Herbivores + predators as agents (NumPy arrays of positions and energy), reproduction with cap, refuges (D-023). Fauna model D-026.
- [x] M0.5 Economy / victory metric: standing biomass (D-023). Economy model D-027.
- [ ] M0.6 Seed sweep: 100 seeds; all trophic levels of both players coexist at t = 20 min in ≥ 90 % of runs.
- [ ] M0.7 `balance.toml` filled with the tuned coefficients. DECISIONS entry for the model. (Pass 1, flora frontier timing: D-025.)

## M1 · `sim-core` fields (Rust)
- [x] M1.1 GitHub remote (https://github.com/NathanProvin/EcoClash), Cargo workspace (`Cargo.toml`: release `overflow-checks = true`), CI (fmt, clippy, test; green on the first push).
- [x] M1.2 `fixed.rs` (Q16.16, rounding rule) + `rng.rs` (PCG32 with known-answer tests). No LUT yet: no rule needs a transcendental function.
- [x] M1.3 Fields + growth / gauge / spread / competition rules (`flora.rs`), exact parity with the prototype's quant mode (D-034). The multi-rate scheduler moves to M1.4, with the tick loop.
- [x] M1.4 `commands.rs`, `hash.rs` (incremental, per 32×32 chunk), `snapshot.rs`, `world.rs` tick loop (multi-rate: flora every 5 ticks) (D-036).
- [x] M1.5 Balance loader: parse, convert to fixed-point, validate (`balance.rs`); balance hash of the converted values (`hash::balance_hash`, D-037).
- [x] M1.6 `sim-cli run` → per-tick hash + metrics CSV. `npm run cli:check` / pytest compare it with the M0 quant mode: identical on every flora tick (D-037).
- [x] M1.7 Determinism tests: run twice, `proptest` command streams (invalid ones included), chunk-hash and ownership invariants (`sim-core/tests/determinism.rs`).
- [x] M1.9 Flora step performance (D-038): 107 → ~6 ms per flora tick mid-game, 46–55 ms on a fully owned 256² map; flora every 8 ticks → ≤ 7 ms per tick on average in the worst case. Measure: `cargo test -p sim-core --release -- --ignored --nocapture flora_tick_time`.
- [x] M1.8 `sim-wasm` + Node headless runner. CI checks the native vs WASM hash (`npm run wasm:check`: identical on 1200 ticks). `npm run doctor` checks that the `wasm-bindgen-cli` version matches `Cargo.lock` (D-008, D-039).

## M2 · Web render of fields
- [x] RTS UI v1 on the replay viewer (D-030): top resource bar, bottom unit bar with box selection, full-screen tech tree, camera rotation.
- [x] Replay viewer (early M2, D-028): the Python prototype exports replays; the Vite + TS + Svelte + Three.js client plays them back with placeholder shapes, an RTS camera and a HUD.
- [x] Resolve Q-008 (scale), Q-009 (colours), Q-010 (reference machine) (D-040).
- [x] Vite + TS + Svelte scaffold as an npm workspace (`client/`), COOP/COEP headers in dev/preview and `public/_headers`.
- [x] Worker hosting `sim-wasm` (D-041): the "live match" source; field frames only when the flora ticks, as transferable buffers (SharedArrayBuffer waits for per-tick agent data, M3).
- [x] Plant from the UI in the live match (commands main → worker, D-042).
- [x] Territory frontier line, P1 solid / P2 dashed (D-040, D-043).
- [x] Three.js WebGPURenderer: terrain (flat diorama ground, D-054), flora textures, instanced grass (D-055), RTS camera; quality presets (D-056).
- [ ] Perf check (the user, on the reference laptop): the HUD fps with Layers → Quality on Medium (target 60) and Low (floor 30), at 64² (D-040, D-044, D-056).

## M3 · Agents and control
- [x] Resolve Q-007 (fog): no fog of war for now (D-074). (Q-006 and Q-012 resolved by D-018.)
- [x] Fauna in `sim-core` (D-052): SoA agents (sequential ids, never reused), the prototype's behaviours (flee, seek, wander, graze, decompose, hunt, starve, breed, refuges), continuous movement every tick, `spawn` command with the §6.3 triggers, animals hashed every tick, animal yields in the income. Native vs WASM check covers animals.
- [x] Live animals in the client (D-052): animal frame every tick, interpolated; Plants / Animals tabs; call an animal with a click; notices for orders that did nothing.
- [x] Ids and paths (D-053): ids only grow and are never reused, so no generation counter is needed. No flow fields: the V1 map has no obstacles, so straight lines reach every cell. Add them with terrain obstacles.
- [x] Selection, orders (move, attack-move, stop), control groups; input → `order` commands (D-053).
- [x] Sim tick ≤ 8 ms at 64² with 1,500 agents: ≈1.0 ms per tick on average, 7.9 ms worst tick (native release, full map; `flora_tick_time` ignored test). The HUD shows the in-browser figure.

## M3.5 · Lockstep smoke test (D-007)
- [x] Minimal `relay/` (Node WebSocket): order + forward commands, compare hashes (D-062).
- [x] `client/src/net/`: input delay `d`, stall handling (the sim waits; the HUD says so) (D-062).
- [x] Two tabs, 5 min, identical hashes. Automated in a Node test with two headless clients (`npm run relay:test`, in CI), plus a divergence caught at the next hash check.

## M4 · Full match vs AI
- [x] Economy, structures, territory, victory conditions (per the resolved Q-002 and Q-003). Done: bank + income (D-046), spending: unlocks, planting and spawn costs (D-058), victory conditions (D-059).
- [x] `sim-ai` scripted bot, command-only (D-014), with difficulty levels (D-060).
- [x] Main menu (D-057).
- [x] End screen with biomass and territory charts (D-059).
- Batch balance runs and the `sim-py` decision moved to M7 (user, 2026-09-29).

## M5a · Playable alpha for outside playtesters (next, D-073)
- [ ] Performance gate: fps on the reference laptop (M2 check), 60 on Medium, 30 on Low; fix what misses.
- [ ] Match setup screen (vs bot, difficulty, map seed, sandbox) replacing the URL parameters; Options (quality, volume, keybinds); "Play again" on the end screen.
- [ ] Onboarding: contextual first-match tips (plant, spread, unlock, call animals, drop, win conditions), then a short guided scenario.
- [ ] Sound: ambient loops, UI clicks, animal and event cues, volume setting; CC0 sources in `ASSETS_LICENSES.md`.
- [ ] Static deploy (Cloudflare Pages or itch.io), build-version badge, feedback link.

## M7-lite · Balance loop (pulled forward, D-073)
- [ ] `tools/balance/`: bot-vs-bot batch runs through `sim-cli` (seeds × difficulties) → match length, win rates, population curves, collapses.
- [ ] One-page report; tune `pace`, `food_reserve`, caps, costs and the victory thresholds (Q-013) with it and the playtest feedback.

## Content · Terrain, biomes, map generator, species (D-073)
- [ ] Decide on retiring the Python flora parity rule (D-034) before the terrain work (`sim-core` as the single reference).
- [ ] Seeded map generation in `sim-core` (soil types, water, relief), deterministic and hashed; relief and water in the client.
- [ ] The three biomes of gamerules §2.2 and their species (Q-014, Q-016); the bot learns them; the balance loop re-tunes.

## M5b · Art pass
- [ ] Git LFS for `assets-src/`. Blender `bpy` pipeline (`tools/assets/build.py`) → glTF → `gltf-transform`.
- [ ] glTF plants through `PlantStyle`; animals through `AnimalView` with vertex-animation textures (animated at 1,000+ instances).
- [ ] Shader priorities 1–5 (wind, translucency, terrain blending, territory glow, post-processing), quality presets.
- [ ] Brand and store art after the name (Q-011). `ASSETS_LICENSES.md` complete.

## M6 · Multiplayer (after the single player is fun)
- [ ] Relay deployed (VPS or Durable Objects), `.env.example` with `VITE_RELAY_URL`.
- [ ] Lobby + handshake (build version, balance hash, seed).
- [ ] Desync detection UI + state dumps, replays (seed + commands), resign/pause/disconnect rules.
- [ ] Preview/prod deploy pipeline (Cloudflare Pages, itch.io).

## M7 · Balance at scale and AI training (last)
- [ ] Thousands of headless matches → Parquet; M0.6/M0.7.
- [ ] Decide whether `sim-py` (PyO3 bindings, D-010) is needed: only for a learned AI opponent.
