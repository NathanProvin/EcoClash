# ROADMAP.md — EcoClash

> Living plan. Update the **Status** block and tick boxes at the end of every session.
> One task ≈ one commit. The acceptance criteria are the ones in INSTRUCTIONS §11.

## Status
- **Now:** 2026-10-08: gameplay direction agreed: conquest by strength and push, three emergent styles (D-225); Python parity retired (D-226). Spec and sim done (D-225…D-227, steps 2 and 2b) on branch `gameplay-changes`; next: bot style presets (step 3). Herb culling (D-224) merged to main (not pushed). Before: 2026-10-07: **Alpha 1.2** released: the food pyramid with wider cycles and online 1v1 on the Cloudflare relay (D-218…D-222), merged to main and deployed (Pages + relay). Played across two machines by the user. Next: playtest feedback; M6 leftovers (replays, pause, state dumps).
- **Next:** Gameplay · Three styles (steps 2–6) → UI/UX juice → M7-lite (balance loop) → Content (terrain, biomes, map generator, species) → M5b (art) → M6 (online multiplayer).
- **Blocked:** none. Fog of war: none for now (D-074).
- **Last updated:** 2026-10-08

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
- [x] Perf check (the user, on the reference laptop): steady 60 fps (2026-09-30; D-040, D-044, D-056).

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

## M5a · Playable alpha for outside playtesters (next, D-073, D-075)
Goal: a build strangers can play against the bot and understand at a glance. One task = one commit, in this order.
- [x] Performance gate: steady 60 fps on the reference laptop (user, 2026-09-30).
- [x] **1. Bug fixes.**
  - Letter shortcuts by the printed letter (`e.key`), not the key position (`e.code`). On AZERTY, the A key fired the QWERTY-Q rotate binding. This covers A, S, T, Q/E rotation and group digits.
  - The species tooltip stays on screen after the flyout closes (the tile is removed without a pointer-leave). Clear it on close, on arming and on Esc.
- [x] **2. Pressure borders.** Each player's frontier line gets wider where that player pushes harder into enemy land: one glance shows where the fronts are won.
  - Sim (derived, not hashed): `sim-core` computes per cell the push of the non-owner, with the same term as smothering in `flora.rs` step 4 (`attack`: neighbour cover of species able to smother), plus the bites of enemy grazers on the cell.
  - Export: `pressureFrame()` in `sim-wasm`, n² bytes, sent with the field frames. Replays have none and draw normal lines.
  - `frontier.ts`: line width 1–4 texels (0.5–2 m), from the pressure on the enemy cell across the edge. P1 solid, P2 dashed as today.
  - Tests: pressure > 0 exactly where smothering happens (Rust), widths (TS).
- [x] **3. Notifications and pop-ups.** ("Victory threshold near" moves to task 7, with the threshold in the client.) (D-087)
  - One toast stack, soft and translucent, that fades out; clicking a toast flies the camera there. The existing order notices move into it.
  - `game/alerts.ts` (pure, tested): clusters of enemy animals on your land, from the animal frames. An alert is raised when a cluster crosses a size threshold, with a cooldown per area. The wording varies with size and at random: "Enemy caterpillar incursion" (small), "Enemy vole attack" (medium), "Enemy fox raid" (large), plus synonyms (foray, assault, swarm…). The species named is the cluster's dominant one.
  - A ping at the location: an expanding ring on the map, and an arrow at the screen edge when it is off-screen.
  - More events through the same stack: a species can be unlocked, a cell front is lost fast, the victory threshold is near.
- [x] **4. Strategic icons** (toggle: the View menu and the `I` key).
  - Your animals are grouped per species (coarse grid, merged neighbours); a species icon with a count sits over each large group, at a fixed screen size (HTML overlay over projected positions, about 10 Hz).
  - Clicking an icon selects that group (controllable species). Swarms get icons too, without selection.
- [x] **5. Drop cursor.** While a species is armed, the cursor over the map becomes a ghost of its model (a plant's tuft, bush or tree; an animal's body, from `PlantStyle` / `AnimalView` geometry) on a footprint ring (plant radius or drop radius). The ring shows whether the drop is on your land or costs ×1.5.
- [x] **6. (Stretch) Parachute drops.** The worker reports the ids created by each spawn command; `AnimalView` lowers those animals from the sky (about 10 m, 1.5 s, a light sway) before they land. Births do not.
- [x] **7. Menus.**
  - Match setup: vs bot, difficulty, map seed, sandbox; replaces the URL parameters.
  - Options: quality, keybinds.
  - "Play again" on the end screen.
- [x] **8a. First-match tips** (D-082): contextual, once each, through the notification stack; switch in Options.
- [x] **8b. Tutorial** (D-117): a "Tutorial" entry next to Play: the easy bot on a small meadows map (seed 2), six objectives in order (found with lichen, spread to 5 %, unlock grasses, call rabbits, raid with A + click, hold 55 %; D-120), progress dots, a "Tutorial complete" panel.
- [x] **9. Static deploy** (Cloudflare Pages, D-157): live; **Alpha 1** released and played by outside testers (2026-10-05).

## World overhaul (before M5a 8b and 9; user, 2026-09-30)
In this order:
- [x] **1a. Map generator** (D-083): seeded relief, an anti-diagonal river (shallows, deep pools), ponds, rock outcrops, home clearings, moisture; 180° symmetry; `World::generate_terrain`, `sim-cli --terrain 1`, `sim-wasm generateTerrain / terrainFrame`.
- [x] **1b. Terrain rules** (D-084): rock and deep cells block plants and walkers; shallows slow walkers and let plants seep across; movement media (walk, swim, amphibious, fly); pathfinding (`pathing.rs`).
- [x] **1c. Terrain rendering** (D-085): displaced ground, heights everywhere, water surface, rocks, frontier on the relief, slab sides.
- [x] **2. Light and shaders** (D-086): shadows, wind, terrain blending, foliage rim light, colour grade; bloom and tilt-shift on High.
- [x] **3. Species revamp**: the user's 15-plant, 30-animal table; 4 plant strata; groups and tiers; aquatic species; new bodies; bot.
- [x] **4. Movement per species** (D-088): calmer, slower small herbivores; stop-and-go; less erratic insects.
- [x] **5. Visible drop animation** (D-089): high fall, readable canopy, ground shadow, dust ring.

## M7-lite · Balance loop (pulled forward, D-073)
- [x] Bot-vs-bot batch runs: `sim-cli bench` (seeds × difficulties → phase markers, match length, win rates, calls; D-142).
- [ ] One-page report; tune `pace`, `food_reserve`, caps, costs and the victory thresholds (Q-013) with it and the playtest feedback.

## Gameplay · Three styles (D-225, D-226; before the UI/UX phase)
Tall, wide and rush emerge from one conquest rule, map control stays the only victory. Branch `gameplay-changes`. Each step waits for the user's green light.
- [x] 1. Spec: gamerules §3, §3.1, §6.1, §7, §10, §11.2; D-225, D-226; INSTRUCTIONS; CLAUDE.md. Dead trees: D-227.
- [x] 2. Sim: animal species per cell (`fauna.rs`); strength and push replace the level attack in both `flora.rs` paths; contested tie-break dropped; biodiversity income (`economy.rs`); `fert_gain`, `div_gain`, `div_cap` in `balance.toml`; `pressure_frame` = push − strength; balance hash bump; parity test, fixture, `rs:fixture` and `cli:check` removed. Tests: equal front holds, a tip touching 3 weaker cells falls, fertility tips a front, grazing out a species flips a balanced cell, bare cell locked, multiplier capped.
- [x] 2b. Dead trees (D-227): `snag_owner` (hashed), a per-player tree lock in `Flora::suitability`, the storm windthrows trees into dead trees; tests: the former owner's tree cannot regrow under dead wood, the enemy's can, the lock ends when the wood is gone.
- [ ] 3. **Balance and bots (merged 3–5; plan approved 2026-10-08).** Bot: styles as spending weights in `[bots.styles]` (Wide 60/20/20, Tall 20/60/20, Rush 20/20/60, Balanced 34/33/33 for land/depth/army), deficit spending, a front map (strength, push, margin), `deepen`, breach raids, encircling; adaptation (Easy none, Normal half every 120 s, Hard full every 60 s, ±25 cap); reactive and proactive plays. Bench: `--p1 hard:wide`, `--matrix <level>`, `--ladder <style>`, lead changes, comeback, front mobility, style fingerprints. Balance passes, one lever each. Plumbing: sim-wasm style, match setup choice, end-screen label.
  - **Targets:**
    - *Match shape* (Balanced mirror, Normal, 16 seeds): median end 18–30 min; unfinished at 45 min ≤ 10 %; ≥ 2 lead changes; comeback 25–40 %; stalemates < 5 %; seat bias ±5.
    - *Cycle* (matrix at Normal, 8 seeds × both seats): rush > tall, tall > wide, wide > rush at 55–65 %; mirrors 45–55 %; Balanced 45–60 % against each; every style 40–60 % overall.
    - *Distinct styles* (at 10 min): Wide land ≥ 1.3× Tall's; Tall species per cell ≥ 1.5× Wide's; Rush animals on enemy land ≥ 2× the others'.
    - *Adaptation and reactivity:* adaptive Hard ≥ 55 % against locked Hard; raids answered within 60 s ≥ 85 % (Normal), Hard median ≤ 10 s; 0 rejected commands.
    - *Ladder:* Hard vs Normal 70–85 %, Normal vs Easy 70–85 %, Hard vs Easy ≥ 90 %.
    - *Ecology and roster:* all trophic levels alive at 20 min in ≥ 90 %; pyramid within D-222 ranges; ≥ 75 % of animals called over the matrix; top species ≤ 25 % of calls; every plant card unlocked somewhere.
    - *Performance:* `Bot::think` ≤ 1 ms median at 38²; worst tick ≤ 8 ms.
  - **Tests:**
    - *sim-ai:* style fingerprints; `deepen` defends front cells first; breach targeting; encircling; adaptation shifts (Hard yes, Easy no, capped); deficit spending within ±10; existing tests across all levels × styles.
    - *sim-cli:* matrix reducer, lead-change counter, seat parser.
    - *balance.rs:* `[bots.styles]` validation.
- [ ] 6. Cell card: "strength vs push".

## Content · Terrain, biomes, map generator, species (D-073)
- [x] Retire the Python flora parity rule (D-034): done, D-226.
- [ ] Seeded map generation in `sim-core` (soil types, water, relief), deterministic and hashed; relief and water in the client.
- [ ] The three biomes of gamerules §2.2 and their species (Q-014, Q-016); the bot learns them; the balance loop re-tunes.

## M5b · Art pass
- [x] Sound v1 (D-176…D-178): procedural UI, world, animal and weather sounds, ambience beds, volume options; recorded CC0 drop-ins via `public/audio/manifest.json` later.
- [ ] Git LFS for `assets-src/`. Blender `bpy` pipeline (`tools/assets/build.py`) → glTF → `gltf-transform`.
- [ ] glTF plants through `PlantStyle`; animals through `AnimalView` with vertex-animation textures (animated at 1,000+ instances).
- [ ] Shader priorities 1–5 (wind, translucency, terrain blending, territory glow, post-processing), quality presets.
- [ ] Brand and store art after the name (Q-011). `ASSETS_LICENSES.md` complete.

## Experimental · Photoreal diorama (beta goal, in parallel; D-223)
Branch `exp/photoreal`, behind a switch (Options, `?art=real`). Low-poly stays the default until the E3 gate passes.

**Budgets.** Reference laptop (Intel UHD), Medium preset, 1,000+ animals.
- **Frame targets:** scene ≤ 1.5 M triangles at most; 60 fps mid game, 45 fps or more late game.

| Asset | LOD0 (≤ 15 m) | LOD1 (15–40 m) | Far | Textures (KTX2) | Download |
|---|---|---|---|---|---|
| Large mammal (deer, boar, bear) | 8–12 k tris | ~25 % | ~5 % (300–600 tris) | 1 atlas 1024² (2048² on High): colour + alpha, normal, ORM | ≤ 1.5 MB |
| Small mammal, bird | 2–4 k | ~25 % | 150–300 | 512–1024² | ≤ 0.8 MB |
| Insect, swarm | 300–800 | — | billboard | 256–512² | ≤ 0.3 MB |
| Tree | 8–20 k (leaf cards) | 2–4 k | octahedral impostor beyond ~30 m | 1024–2048² | ≤ 2 MB |
| Shrub, fern, nettle | 3–8 k | ~25 % | impostor | 1024² | ≤ 1 MB |
| Herbs (grass, lichen, flowers) | textured alpha cards, instanced, density by LOD as now | | | atlas 1024² | ≤ 0.5 MB |
| Ground | 4–6 tiling CC0 PBR sets blended by the fields | | | 1024² each | ≤ 6 MB |
| Sky, light | HDRI 2k (or generated) | | | | ≤ 3 MB |

- **Totals:** roster about 45–70 MB, streamed. Before the menu: ≤ 15 MB (code, WASM, ground, sky, tier-1 species).
- **Animation:** baked skeletal animation textures (bone matrices per frame), one clip set per species (idle, walk, run, eat, plus a fall for drops), clip and phase per instance from the sim's state. Fallback: vertex-animation textures for LOD1 and beyond. The E3 prototype decides.

**Tasks**, in order:
- [ ] **E0 · Art bible and licences.** Macro-documentary references; scale, palette and light rules; a licence policy. A browser game ships its assets downloadable, so only CC0, CC-BY or licences that allow web redistribution. No Megascans: their free licence covers Unreal only. Every asset in `ASSETS_LICENSES.md`.
- [ ] **E1 · Pipeline.** Git LFS for `assets-src/`, then `tools/assets/build.py`. In Blender (`bpy`): clean up, make the LODs, bake the atlas and the impostor, export glTF. Then `gltf-transform` (meshopt, KTX2). A manifest with the sizes; CI fails a species over its budget.
- [ ] **E2 · Runtime.** An asset manifest and per-species lazy loading, prefetched in tech-tree order. The current low-poly model shows until the asset arrives. `GltfPlants` behind `PlantStyle` and `GltfAnimals` behind `AnimalView` (the D-072 seams).
- [ ] **E3 · Vertical slice and gate.** The oak (largest plant) and the rabbit (most numerous animal) photoreal and animated, plus the photoreal ground and sky. Measure with `?perf=1` on the laptop: 1,000 rabbits and 300 oak cells. **Gate:** 60 fps mid game, 45+ late game on Medium. Pass → continue. Fail → adjust the budgets, or keep photoreal for High only.
- [ ] **E4 · Animation system:** clip blending and states from the sim (grazing, fleeing, hunting, falling).
- [ ] **E5 · Light and post:** HDRI, leaf translucency, ambient occlusion (High), grading, depth of field when zoomed in.
- [ ] **E6 · Roll-out per family,** most seen first: L1 herbs → H1 grazers → P2 hunters → trees and shrubs → the rest (45 species).
- [ ] **E7 · Presets:** High photoreal; Medium photoreal with reduced LODs; Low the low-poly fallback (integrated GPUs, mobile).

## M6 · Multiplayer (after the single player is fun)
- [x] Relay on Durable Objects (D-219): `relay/worker.mjs`, `npm run relay:deploy`, CI deploy once `RELAY_URL` is set; `.env.example` with `VITE_RELAY_URL`. Going live needs the user's Cloudflare setup.
- [x] Lobby + handshake (D-219, D-220): host a match / join by code or `?join=` link; build, balance hash, seed and size.
- [x] Disconnect rules and desync UI (D-221): a leaver forfeits, a stalled peer is dropped, a desync voids the match.
- [ ] State dumps on desync, replays (seed + commands), pause, a sim-side resign command.
- [x] Prod deploy pipeline: CI deploys Pages and the relay on main (D-157, D-219). itch.io and branch previews still to come.
- [ ] itch.io build, preview deploys per branch.

## M7 · Balance at scale and AI training (last)
- [ ] Thousands of headless matches → Parquet; M0.6/M0.7.
- [ ] Decide whether `sim-py` (PyO3 bindings, D-010) is needed: only for a learned AI opponent.
