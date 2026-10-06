# JOURNAL.md — EcoClash session log

> Append-only, newest at the bottom. One entry per working session, 5–10 lines max.
> Format: `## YYYY-MM-DD · short title`, then Goal / Done / Decisions / Next / Blockers.

---

## 2026-09-27 · Spec review + environment bootstrap (M-1)
- **Goal:** Review INSTRUCTIONS.md critically, set up the project memory files and the environment management.
- **Done:**
  - Spec review in four areas: design gaps, determinism traps, toolchain sprawl, process. Improvements applied to INSTRUCTIONS.
  - Created the memory files, pinned the toolchains, added `npm run doctor`, `git init`.
- **Decisions:**
  - D-006 WebSocket relay
  - D-007 lockstep smoke test at M3.5
  - D-008 no wasm-pack
  - D-009 own PCG32
  - D-010 `sim-cli` first, `sim-py` deferred
  - D-011 determinism hardening
  - D-012 memory layout
  - D-013 environment management
  - D-014 command-only AI
  - D-015 git local only
- **Next:** M0.1, the flora-only Python prototype.
- **Blockers:**
  - Design questions Q-001…Q-008 (user thinking in parallel, not blocking flora work).
  - Rust is not installed yet (user action).

## 2026-09-27 · Review and completion of `data/gamerules.md`
- **Goal:** Review the author's first gameplay draft and fill its missing sections.
- **Done:** Strata table (4 levels), flora/fauna tech tree, species tables §5.1–5.2, food web mermaid, fire card, numbering and typo fixes. All additions tagged [Proposed].
- **Decisions:** None final. New author questions added to gamerules §12 (7, 9–11).
- **Next:** Author validates §12; then reconcile gamerules with INSTRUCTIONS §2 and OPEN_QUESTIONS (Q-001, Q-002, Q-006, Q-012 overlap). `data/species.toml` when species reach code (M0.5+).
- **Blockers:** None for M0.1–M0.4 (flora-only).

## 2026-09-27 · Gamerules decisions applied
- **Goal:** Apply the author's answers to the gamerules review.
- **Done:** Gamerules moved to three flora levels (pioneers = L1 tier 1), bees and fire post-V1, hedgehog added, non-V1 species removed from examples. INSTRUCTIONS §2 summarizes and defers to gamerules; CLAUDE.md points to it.
- **Decisions:** D-016 gamerules is the design reference; D-017 flora levels and V1 species; D-018 resolves Q-001, Q-002, Q-006, Q-012.
- **Next:** M0.1 flora-only prototype.
- **Blockers:** M0.5+ wait for Q-003, Q-004, Q-005.

## 2026-09-27 · Spec aligned with the gamerules flora model
- **Goal:** Prepare M0 code: align INSTRUCTIONS and ROADMAP with gamerules.
- **Done:** Dropped the "over-producing herbivores" sentence (§2.3). §5.2 now uses the cell spread model. ROADMAP M0 rewritten.
- **Decisions:** D-019 cell model + own-cell spread + [Proposed] rules behind switches; D-020 species data in `balance.toml`.
- **Next:** M0.1 float cell model.
- **Blockers:** None for flora.

## 2026-09-27 · M0.1 float flora cell model
- **Goal:** First prototype code: the gamerules flora rules in NumPy.
- **Done:**
  - `tools/prototype/flora.py`: strata, logistic growth + shade, soil development, spread / smother / frozen frontiers, contested cells, own-cell spread; scripted mirrored scenario; CSV + plots.
  - Species tables in `balance.toml` (placeholders). 5 rule tests in `tools/tests/test_flora.py`.
- **Findings (seed 1, 128², 20 min):** meadow build out-expands forest build (45 % vs 40 % territory); L1/L1 frontier freezes at ~15 min as designed; trees stay near their base (slow spread + 0.6 soil gate), so no smothering happens in 20 min; clover/ferns/bramble cannot spread (gamerules §12 q7).
- **Decisions:** None.
- **Next:** M0.2 quantized mode.
- **Blockers:** None.

## 2026-09-27 · M0.2 quantized mode, Q-015 resolved
- **Goal:** Preview integer effects before the Rust port.
- **Done:** `--mode quant`: int64 state in u16 ranges, Q16.16 rates converted once with round-half-away, floor or stochastic growth rounding. Tests: quant determinism, low-density growth, mirror symmetry (float + quant), float≈quant territory. 12 tests green.
- **Decisions:** D-021 minimum-growth floor (quant matches float within 0.5 % biomass, identical territory).
- **Next:** M0.3 comparison runs; author answer on gamerules §12 q7.
- **Blockers:** None.

## 2026-09-27 · Interpenetrating strata (D-022) + M0.3 comparison runs
- **Goal:** Apply the author's answer on L1 succession; compare float vs quant and each [Proposed] switch.
- **Done:**
  - State is now biomass per species; same-stratum species share cells with niche overlap 0.5. Planting adds instead of replacing. Tests for interpenetration and mixed > monoculture (14 green).
  - Fix: bare land goes to the fastest colonizer; smothered cells go to the attacking higher-level species.
  - `--compare` runs 6 variants and writes `compare.csv` + `compare.png`.
- **Findings (seed 1, 20 min; 128² and 64² agree):**
  - Territory is identical in every variant (128²: 39.9 % vs 44.9 %). It is settled by the early pioneer race; L1/L1 frontiers freeze on contact, and shrubs/trees never reach the frontier in time. The switches only move biomass.
  - Biomass vs baseline: quant −0.5 %; no succession +3.5 % (P1); no shade +4 %; no contested cells 0 (ties rare); no own spread −25 % (128²) / −55 % (64²) and no mixed stands.
  - Keep succession, shade, own spread. Contested cells is harmless (tie rule only).
- **Decisions:** D-022.
- **Next:** M0.7 tuning: L2/L3 must reach the frontier in the mid phase (gamerules §11.1).
- **Blockers:** M0.4/M0.5 wait on Q-003, Q-004, Q-005.

## 2026-09-27 · Q-003, Q-004, Q-005 resolved
- **Done:** Recorded the author's answers (D-023): standing biomass at the time limit; reproduction with a cap; food-web predators + shrub refuges.
- **Next:** Colonization gauge (D-024), then M0.7 tuning.

## 2026-09-27 · Colonization gauge (D-024)
- **Done:** Gauge per species per cell (neighbour pressure × suitability), seed rain, continuous smothering, soft succession ramp, terrain fields (soil type, water, light) with neutral V1 hooks. Fix: arrivals start established (a conquered seedling was re-smothered at once). 19 tests green.
- **Findings (seed 1, 128², 20 min, old rates):** round fronts; the shrub belt keeps pace with the meadow; territory 14.7 % / 18.2 % (was 40 / 45), because front pressure is ~1/5.
- **Next:** M0.7 tuning pass with frontier metrics.

## 2026-09-27 · M0.7 tuning pass 1 (D-025)
- **Goal:** Shrubs/trees reach the frontier in the mid phase so frozen frontiers break.
- **Done:** Frontier metrics in `run()` (`front`, `front_hi`, `taken`). Three parallel tuning rounds (throwaway scratch harness). Applied pioneers ×8, L2/L3 ×24 spread, soil ×3; forward planting in the forest build; offsets scale with map size.
- **Bugs found and fixed:** 1-biomass seedlings promoted to established on arrival (quant grew 2× the oak); float ghosts of 1e-57; own_spread switch obsolete under the gauge (removed).
- **Result:** contact 8.1 min, L2 at front 10.4/11.5 min, first take 10.8 min, 50/50 at 20 min; quant matches float in timing and territory within 1 %.
- **Next:** M0.4 fauna agents (D-023), then M0.6 100-seed sweep.
- **Notes:** a 128² 20-min run takes about 2 min; the 19 tests take about 25 s.

## 2026-09-28 · M0.4 fauna agents (D-026)
- **Goal:** A prototype with animals (user: no more balance fine-tuning).
- **Done:**
  - `fauna.py`: 15 V1 species as integer agents; flee / seek / wander, grazing, decomposing, hunting, refuges, starvation, reproduction with player and species caps, §6.3 spawn rules.
  - Flora litter turnover feeds dead biomass.
  - `match.py` split out (`npm run proto`); both builds spawn animals; an animals panel and animal markers on the maps.
  - 8 fauna tests; 27 tests green.
- **Structural fixes found:**
  - integer upkeep rounded up 4× → Q16 energy;
  - decomposers starved on a bare floor → litter turnover;
  - herds piled into one cell and starved together → crowd-aware targeting;
  - breeding filled the player cap and blocked spawns → per-species breeding cap.
- **Result (seed 1, 128², 20 min):** decomposers 150/150 from 5 min; herbivores from 8 min up to 300/300; predators hunt (9 / 36 kills) but starve within minutes (placeholder values, not tuned). Territory 49 % / 51 %.
- **Next:** M0.5 economy, then the replay viewer (D-027).

## 2026-09-28 · M0.5 economy (D-027)
- **Done:**
  - `economy.py`: bank, income (flora growth share + animal energy gain), tech-tree unlock paths with habitat prerequisites, plant and spawn costs with drop surcharge, victory (fixed or decaying threshold; standing biomass at the limit).
  - Wired into `match.py` (`--no-economy`); 7 economy tests; 34 tests green.
- **Result:** P1 wins on biomass at 20 min (seed 1, 128²).
- **Decisions:** D-027. The user chose the replay viewer first, with strata and role placeholder shapes (D-028, next).
- **Next:** replay export + client viewer.

## 2026-09-28 · Replay viewer v1 (D-028)
- **Goal:** First visualization and UI with placeholder shapes.
- **Done:**
  - Python: persistent agent ids; `--replay` export (4.3 MB gz for a 20-min 128² match) with a round-trip test.
  - Client (`client/`): replay loader and decoder, Three.js viewer (instanced dots / cones / cubes, animal spheres and pyramids, territory-tinted ground, RTS camera), Svelte HUD, timeline and legend.
  - 6 Vitest tests; lint, type check and build clean.
  - Verified in Chrome on the WebGPU backend: territory tint matches the flora; animals are visible at the front (herds, decomposers, predator raids).
- **Fixes on the way:**
  - Vite sends `.gz` with Content-Encoding (magic-byte check before decompressing);
  - ground texture rows were flipped;
  - animals blended into the plants (now unlit, bigger, raised, light tints).
- **Next:** the user chooses: input on the viewer, or M1 `sim-core`.

## 2026-09-28 · Species stat sheet (D-029) and RTS UI v1 (D-030)
- **Goal:** Per-species stats in a config file for the user to tune; halve the grid; a first RTS UI.
- **Done:**
  - `data/species.toml`: growth, spawn / unlock cost, yield, cap, effect per species, plus model internals.
  - Per-species unlocks with a prerequisite chain; yield income; plant cell caps; animal breeding cooldown and species caps.
  - Grid 512 → 256 (prototype 128 → 64).
  - Replay v2: species table, counts, unlock log.
  - Client: natural scatter (several models per cell), RTS mouse and keys with rotation, top resource bar, bottom unit bar with box selection, full-screen tech tree.
  - Tests: 39 Python, 11 client. Checked in Chrome (WebGPU).
- **Fix on the way:** `main()` reused `out` for the replay folder, so metrics and plots landed in the replay folder.
- **Next:** M1 `sim-core`.

## 2026-09-28 · Cell inspection (D-031)
- **Done:** Click-to-inspect with a smoky aura, a cell panel (plants cover, animals, soil) and a zoom to plant scale; replay v3 with per-species cover and soil. Tests: 39 Python, 12 client. Checked in Chrome.
- **Next:** M1 `sim-core` (workspace, `fixed.rs`, `rng.rs`).

## 2026-09-28 · M1 started: workspace, fixed-point, PCG32 (D-032)
- **Done:** Cargo workspace (`sim-core`), `fixed.rs` (Q16.16, half-away rounding, balance conversion) and `rng.rs` (PCG32, reference known answers, unbiased bounded draws). 8 Rust tests; fmt and clippy clean; wasm32 builds. CI workflow written; `rs:*` npm scripts added.
- **Next:** M1.3 fields and rules (port of the quant-mode prototype), M1.4 commands / hash / snapshot.
- **Blocker:** the GitHub remote (user) for CI.

## 2026-09-28 · Overlap fix, GitHub, M1.3 flora port (D-033–D-035)
- **Done:**
  - Placeholder layout without overlaps (slots + height bands, tested over 4,000 cells).
  - Pushed to GitHub after rewriting commit emails to the noreply address; CI green on the first run.
  - `sim-core`: `balance.rs` (runtime TOML loading and validation) and `flora.rs` (the full flora step), with exact parity with the prototype over 300 ticks (mutation-checked).
  - 14 Rust tests; clippy clean; wasm32 builds.
- **Next:** M1.4 commands / hash / snapshot and the tick scheduler, M1.5 balance hash, M1.6 `sim-cli`.

## 2026-09-28 · M1.4 commands, hash, snapshot, tick loop (D-036)
- **Done:**
  - `commands.rs` (ordered queue, JSON), `hash.rs` (xxh64, incremental chunk hashes), `snapshot.rs` (replay-layout field frame), `world.rs` (tick loop, flora every 5 ticks, seeded RNG).
  - 26 Rust tests: same inputs → same hash every tick, submission order irrelevant, planting re-hashes at once, incremental = full recompute (partial edge chunks), deterministic rejection.
- **Finding:** a flora tick costs 107 ms at 256² (release) → M1.9 optimization, guarded by the parity test.
- **Next:** M1.5 balance hash, M1.6 `sim-cli`, M1.9 performance.

## 2026-09-28 · M1.5 balance hash, M1.6 sim-cli (D-037)
- **Done:**
  - Balance hash over converted values (formatting-proof, change-sensitive).
  - `sim-cli run` with per-tick hashes and per-flora-tick metrics.
  - Python cross-check: exact match with the prototype over 240 flora ticks (48²), in pytest so CI runs it.
- **Next:** M1.7 `proptest` determinism tests, M1.9 flora performance, M1.8 `sim-wasm` + native-vs-WASM hash in CI.

## 2026-09-28 · M1.7 determinism property tests
- **Done:** `proptest` over random command streams (invalid players, species, cells, duplicate / late commands): no panic, identical hashes on replay, submission order irrelevant, incremental chunk hashes = fresh recompute, owned cells = cells with biomass. 29 Rust tests green.
- **Next:** M1.9 flora performance (user OK with a lower flora frequency, e.g. every 8 ticks; `growth * dt <= 1` still holds at dt 0.8), then M1.8 `sim-wasm` + native vs WASM hashes in CI.

## 2026-09-29 · M1.9 fast flora step (D-038)
- **Done:** Per-cell fused flora step over relevant species, reused buffers, neighbour table; the original kept as a test oracle (400-tick equivalence); flora every 8 ticks.
- **Result:** 107 ms → ~6 ms mid-game; worst case 46–55 ms per flora tick = 5.7–6.9 ms per tick on average (budget 8).
- **Checks:** 29 Rust + 40 Python tests; `cli:check` exact on 150 flora ticks.
- **Next:** M1.8 `sim-wasm`.

## 2026-09-29 · M1.8 sim-wasm, native vs WASM hashes (D-039)
- **Done:** `sim-wasm` wrapper; Node runner on the `--target web` package; `npm run wasm:check` identical on 1200 ticks; doctor checks the wasm-bindgen CLI version; CI runs the check. M1 complete.
- **Next:** M2, the live worker behind the viewer (open questions Q-008 / Q-009 / Q-010 first).

## 2026-09-29 · Q-008, Q-009, Q-010 resolved (D-040)
- **Done:** The user chose 1 cell = 2 m (2–3 min to cross), blue/orange with a frontier pattern cue, and this laptop (i5-12450H, Intel UHD) as the reference for every budget.
- **Next:** M2, the live worker behind the viewer.

## 2026-09-29 · M2 live worker (D-041)
- **Done:**
  - The viewer runs a live `sim-wasm` match in a Web Worker: 256², about 7.5 ms per tick measured in the browser (HUD readout).
  - COOP/COEP headers are set (`crossOriginIsolated` is true in dev).
  - `Source` interface over Replay and Live; the cell inspector, bottom bar and top bar work on live data.
  - Fixed: the source menu read the bound value before the binding updated it.
- **Next:** planting from the UI, the frontier line, the perf check.

## 2026-09-29 · M2 planting from the UI (D-042)
- **Done:**
  - Plant cards arm planting; a map click sends the command through the worker, and new patches appear on the next flora frame.
  - `plant_radius` is in balance.toml; the parity fixture was regenerated (only its embedded balance text changed).
- **Next:** the frontier line, then the perf check.

## 2026-09-29 · M2 frontier line (D-043)
- **Done:** frontier overlay (P1 solid, P2 dashed), checked on the 20-minute replay and the live match.
- **Note:** synthetic `change` events in browser tests must bubble: Svelte 5 delegates them to the root.
- **Next:** perf check on the reference laptop.

## 2026-09-29 · M2 perf pass (D-044)
- **Done:**
  - Field-frame repaint at 256² went from ≈97 ms to ≈5 ms in steady state (layout cache, skipped empty strata, in-place writes, partial uploads).
  - The HUD shows fps, the worst frame and the backend. WebGPU is active on the Intel UHD.
- **Not done:** the fps reading itself. The automated Chrome tab is hidden (`visibilityState` hidden, no animation frames), so the user reads it in a visible window.
- **Next:** the user's fps reading; then terrain and instanced grass (rest of the M2 render item) or M3.

## 2026-09-29 · Growth cliff = plant caps (D-045)
- **Done:**
  - Diagnosed the ~10 min cliff with a headless 20-minute run: grasses stopped at the 2000-cell cap, a 64²-era value.
  - Plant caps are now map shares, in the prototype and sim-core; parity stays exact.
- **Why new patches spread slower (user question):**
  - Species speeds differ (`growth`: grasses 1.2, clover 0.48, lichen and oak 0.24).
  - Non-pioneers only grow on soil developed by lichen and moss, with a gauge capped by suitability.
  - The planting brush (radius 2) is smaller than the opening patches (radius 3).
  - Mainly, a grasses patch planted after the cap was hit could not grow at all.

## 2026-09-29 · Biomass bank in sim-core (D-046)
- **Done:** income and bank per player in sim-core, hashed; shown in the live HUD.
- **Next:** grid 128² with 4 m cells, then the UI pass.

## 2026-09-29 · 128² map, 4 m cells (D-047)
- **Done:** Grid halved and cells doubled, with more models per cell. Live match at 32×: 34 % land at 9:47, sim 3–5 ms per tick.

## 2026-09-29 · Game HUD pass (D-048)
- **Done:** New dark HUD theme, resource capsule with icons, tile cards with icon slots, restyled tech tree, cell inspector and playback strip. Checked in the browser at 1540×784.
- **Next:** the user's fps reading; terrain and instanced grass, or M3.

## 2026-09-29 · 64² map (D-049), new herbaceous line-up (D-050)
- **Done:**
  - Map halved again, to 64² (256 m).
  - L1 is now lichen & moss, grasses, ferns (pioneers); wildflowers, nettle; bramble. Data, rules, diets, scripts and tests updated; the parity fixture was regenerated.

## 2026-09-29 · Soil colour (D-051), animals in sim-core and the live match (D-052)
- **Done:**
  - The ground colour follows soil development, from bare earth to humus.
  - Fauna ported to sim-core, behaviour-equivalent to the prototype:
    - continuous movement every tick;
    - `spawn` command with the §6.3 triggers;
    - notices for orders that do nothing;
    - animals hashed every tick, fauna parameters in the balance hash (version 3), animal yields in the income.
  - Tests: 6 fauna unit tests, a world test, and spawn orders in the proptest streams and in the native-vs-WASM check (145 animals at 2 min, 300 at 10 min).
  - Live client: animal frame every tick, interpolated; Plants / Animals tabs; click to call an animal; notice toasts.
- **Next (M3):** player orders for animals (select, move, attack-move, stop), then flow fields.

## 2026-09-29 · M3 orders (D-053)
- **Done:**
  - `order` command (move, attack-move, stop), stored per agent and hashed, with unit tests and orders in the proptest streams.
  - Client: right-click move (or attack on an enemy cell), A + click attack-move, S stop, control groups, arrow-key panning.
  - Checked in the browser: 6 voles called, box-selected, moved, then attack-moved toward enemy grass.
  - The timing test was fixed for 64² and map-share caps, and now includes 1,500 animals: ≈1.0 ms per tick on average, 7.9 ms worst tick.
- **Next:** M4 spending and victory, the scripted bot; the M2 leftovers.

## 2026-09-29 · M2 leftovers: diorama ground, grass, presets (D-054 to D-056)
- **Done:**
  - Flat diorama ground: noise-varied earth on a 12 m slab with an earth cross-section. The default view frames the whole slab above the HUD; the fog was pushed out.
  - Instanced grass (tufts of 3 blades) driven by the flora texture, replacing the L1 dots.
  - Low / Medium / High presets in the Layers menu.
  - Browser checks: slab edge; grass up close for both players; the L1 toggle; the preset switch.
  - Fixed along the way: z-fighting (the slab has no top face) and dark back faces on blades (both windings, up normals).
- **Left in M2:** the user's fps reading on the reference laptop (Medium, then Low).

## 2026-09-29 · M4: menu, spending, victory, bot (D-057 to D-060)
- **Done:**
  - Main menu (Launch game; Species and Options placeholders).
  - Unlocks and costs in sim-core, with a sandbox flag for tools and checks and a free match setup.
  - Victory conditions, and an end screen with validated charts.
  - `sim-ai` scripted bot on P2. Checked in the browser: an idle P1 loses to the Normal bot at 20:00.
- **Notes:**
  - The timing test ran ≈2× slower this session on both the new and the old code (machine state).
  - The dataviz checker required a deeper P2 orange (`#C28000`) for charts on the dark HUD.
- **Next:** M3.5 lockstep smoke test, or M5 polish; balance tuning when the user asks.

## 2026-09-29 · Herbivore drops at ×1.5 (D-061)
- **Done:**
  - Any animal outside own land pays ×1.5.
  - Herbivores: free on own land (no trigger, feed where their food is best); dropped on food near the click elsewhere. Predator drops are limited to `drop_radius`.
  - The bot calls at home and drops raiders.
  - Tests, fixture, `wasm:check` and the browser check all pass.

## 2026-09-29 · M3.5 lockstep smoke test (D-062)
- **Done:**
  - Relay, lockstep core, relayed browser mode.
  - `relay:test`: 5 minutes identical, a cheat caught; added to CI.
  - Two-tab check in the browser: in sync, and the stall shows.
  - Moved balance runs and `sim-py` to M7 (user).
- **Next:** pause for the user's hands-on feedback round (and their fps reading), then M5/M6.

## 2026-09-29 · Feedback round 1: soft HUD (D-064)
- **Done:**
  - Frosted translucent theme; a decluttered top bar (one capsule, three icon buttons, settings in one menu); a live clock pill; the performance readout on request only; hints only while something is armed.
  - Client check, lint and tests pass; checked in the browser.
- **Next (feedback round):** organic animal movement and swarm species; food-limited carrying capacity; bigger, more natural plant models and ground; animal models with a player ring.

## 2026-09-29 · Organic movement, swarms (D-065)
- **Done:**
  - Any-angle steering, Brownian drift, scattered targets, strolls. The slot grid in the renderer is removed; soil life and insects are faint unselectable dots.
  - Rust tests (new: straight steering at any angle; drift stays near the spot and on the map), `wasm:check`, `cli:check`, `relay:test` and the client checks all pass.
- **Seen:** the bot report ends with earthworms and voles at their species caps and nothing else. The next step (food-limited carrying capacity) targets this.

## 2026-09-29 · Carrying capacity and predator-prey dynamics (D-066)
- **Done:**
  - Food-limited births shared by rival diets; predators with a strike radius, a catch chance and satiation; herbivores fed at home on small bites.
  - New tests: the local capacity, hunting (reach, a miss, a refuge, sated), home feeding. `lotka_volterra_report` shows logistic prey and a predator-prey cycle.
  - All Rust tests, `wasm:check`, `cli:check`, `relay:test` pass; the fixture was regenerated.
- **Seen:** in bot matches, earthworms and voles still hit their caps; tuning goes to M7. Foxes can starve out at low prey density.
- **Next:** plant models and ground (step 5), then animal models (step 6).

## 2026-09-29 · Plants with depth (D-067)
- **Done:**
  - Trees with trunks and blob crowns, bush clusters, per-species forms and natural colours with a light player tint, slots shared by the species of a cell, grass coloured by its herbs, a stronger ground, a lower camera tilt.
  - The "oaks everywhere" look was the renderer (one cube per tree, one colour): the sim already mixes same-tier species.
  - New layout tests (spacing, species shares). Client check, lint and tests pass.
- **Next:** animal models per type with a player ring (step 6).

## 2026-09-29 · Animal models (D-068)
- **Done:** six body types (rodent, hedgehog, rabbit, canid, cat, bird) at true relative sizes (×2.5), in natural colours, facing their travel direction, on player-coloured rings; birds above the canopy; swarm dots in the herbs. New tests on the bodies and forms.
- **Next:** the user's hands-on pass on feedback round 1 (and the fps reading, now with the heavier plant models).

## 2026-09-30 · Feedback round 2: ecology pace (D-069)
- **Done:** `pace = 0.4` scales every ecological rate and the income; movement and the clock stay real time. All Rust and Python tests, fixture parity, `cli:check`, `wasm:check`, `relay:test` and the client checks pass.

## 2026-09-30 · Map 43² (D-070)
- **Done:** 43×43 map; the chunk-multiple rule is dropped (partial edge chunks); tests, the relay test and the bot report adapted. All checks pass.

## 2026-09-30 · Family build bar (D-071)
- **Done:** family items with instant tier flyouts, a padlock unlock badge, the tooltip placement fix; checked in the browser (flyout, tooltip in real-time units).
- **Found:** live matches started at 4× (the replay viewer's default speed leaked into live play), so the round-1 rhythm ran 4× too fast.
- **Then (D-069a):** live matches start at 1× (replays 4×); pace back to 1.0 by the user's choice.

## 2026-09-30 · Plant growth and render seams (D-072)
- **Done:** fixed per-cell slots (dart-thrown shrubs, 3 per cell), sticky species, GPU growth for shrubs and trees, blended grass, `PlantStyle`/`PlantView`/`AnimalView` seams. Client check, lint and 39 tests pass; plants grow in, checked in the browser.
- **Next:** the user's hands-on pass (1× start, 43² map, family bar, growth), and the fps reading on the reference laptop.

## 2026-09-30 · Next directions (D-073, D-074)
- **Done:** stepped back with the user; new milestone order: M5a playable alpha → M7-lite balance loop → Content (terrain, biomes, species) → M5b art → M6 multiplayer → M7. No fog of war for now.
- **Next:** M5a, starting with the fps gate on the reference laptop.

## 2026-09-30 · M5a plan (D-075)
- **Done:** fps gate passed (60 fps, user). M5a planned: bug fixes (AZERTY shortcuts, stuck tooltip), pressure borders, notifications and raid alerts, strategic icons, drop cursor, parachute drops (stretch), menus, onboarding, deploy. Sound moved to M5b.
- **Next:** M5a task 1, the bug fixes.

## 2026-09-30 · M5a task 1: bug fixes
- **Done:**
  - Letter shortcuts (A, S, T, Q/E) match the printed letter, so AZERTY works; digits stay on the digit row.
  - The species tooltip clears when the flyout closes (arming, grace timer, Esc). Checked in the browser.

## 2026-09-30 · M5a task 2: pressure borders (D-076)
- **Done:** display-only push from the sim's smothering term plus enemy grazers; frontier lines 0.5–2 m wide by push. Rust and client tests, `wasm:check`, the bot report pass.

## 2026-09-30 · M5a task 3: notifications (D-077)
- **Done:** toast stack; raid alerts with varied wording, pings and off-screen arrows; lost-ground alerts; affordable-unlock infos; order notices folded in. 46 client tests; checked in the browser.

## 2026-09-30 · M5a task 4: strategic icons (D-078)
- **Done:** species icons with counts over your groups, click to select, I toggle (view menu too), remembered. 49 client tests; checked in the browser.
- **Next:** M5a task 5, the drop cursor.

## 2026-09-30 · M5a task 5: drop cursor (D-079)
- **Done:** ghost model of the armed species under the cursor, landing ring (plant disc, home spot, paid drop area with ×1.5), readable at any zoom; `dropRadius` exported. Checked in the browser.

## 2026-09-30 · M5a task 6: parachute drops (D-080)
- **Done:** spawn id ranges from the sim (not hashed) → worker → `Live.droppedAt` → falling animals under a leaf canopy. Rust, client (50) and WASM parity checks pass.
- **Next:** M5a task 7, menus.

## 2026-09-30 · M5a task 7: menus (D-081)
- **Done:** Play → match setup (opponent, seed, sandbox; remembered; URL overrides), Options (quality, icons, perf, shortcuts), Play again, victory-near and last-minutes toasts. 55 client tests; the setup checked in the browser.
- **Next:** M5a task 8, onboarding.

## 2026-09-30 · M5a task 8a: first-match tips (D-082)
- **Done:** seven contextual tips through the toast stack, once each, Options switch. 57 client tests; checked in the browser.
- **Next:** 8b guided scenario; 9 static deploy (needs the user's hosting choice and account).

## 2026-09-30 · World overhaul 1a: map generator (D-083)
- **Done:** seeded, symmetric maps with relief, a river between the homes, ponds, rock outcrops, moisture; in the state and hashes; `wasm:check` with terrain; all checks pass.
- **Next:** 1b terrain rules (blocked cells, media, pathfinding).

## 2026-09-30 · World overhaul 1b: terrain rules (D-084)
- **Done:** rock and deep water block plants and walkers, shallows slow walkers and let plants seep, media (walk, swim, amphibious, fly), bounded A* pathfinding with waypoints; tests; the bot on real maps; tick budget holds.
- **Next:** 1c terrain rendering.

## 2026-09-30 · World overhaul 1c: terrain rendering (D-085)
- **Done:** displaced ground with the frontier in its material, water plane with depth tint, rock outcrops, heights for everything standing on the map; smoothed shores. Checked in the browser (seed 3); client, Rust, WASM and relay checks green.
- **Next:** 2, light and shaders.

## 2026-09-30 · World overhaul 2: light and shaders (D-086)
- **Done:** sun shadows per preset, neutral tone mapping, wind on grass and plants, ground tints (wet, dry, slope), foliage rim light, bloom and tilt-shift on High, a dev camera hook. Checked in the browser on Low, Medium and High; client checks green.
- **Note:** the pale yellow herbs on P2's side are the wildflowers' natural colour, not a lighting bug.
- **Next:** 3, the species revamp.

## 2026-09-30 · World overhaul 3: species revamp (D-087)
- **Done:**
  - the author's 15 plants and 30 animals in families and tiers;
  - four height strata (Rust and Python, parity exact);
  - aquatic plants and animals;
  - the build bar with 15 families;
  - clumps, reeds and lily pads, 7 new animal bodies, compressed large-animal sizes;
  - bot and tests updated; replay regenerated;
  - checked in the browser (sandbox: water plants, deer, bison, fish).
- **Next:** 4, movement per species.

## 2026-09-30 · World overhaul 4: movement per species (D-088)
- **Done:** per-species drift, drift memory and stop-and-go rests; calmer, slower herbivores; lighter insects; a test; seen in the browser (rabbits graze calmly around their spot).
- **Next:** 5, a drop animation you can actually see.

## 2026-09-30 · World overhaul 5: a visible drop (D-089)
- **Done:** a high, staggered fall under a canopy readable at any zoom, a ground shadow and a landing dust ring; the NaN pose bug fixed. The world overhaul (1–5) is complete.
- **Next:** M5a 8b, the Tutorial entry in the main menu; then 9, the static deploy (needs the user's accounts; ask before publishing).

## 2026-10-01 · Quality switch crash, High performance (D-090)
- **Done:** the crash root cause (a disposed shadow map still in use) is fixed; the post pipeline is kept; fewer shadow casters, shadows redrawn every 2nd frame, a lighter High.

## 2026-10-01 · Map side 32 (D-091)
- **Done:** 32×32 map, generator checked, tests and docs follow; tick budget well within.

## 2026-10-01 · Recyclers, black woodpecker (D-092)
- **Done:** the player-facing rename, the woodpecker in place of the raven (gameplay to come).

## 2026-10-01 · Thinner selection ring (D-093)
- **Done:** the aura band halved; checked in the browser.

## 2026-10-01 · Victory 90 % / 60 min (D-094)
- **Done:** new victory values, docs. All five requests of the day are in (D-090…D-094).
- **Next:** the user's fps check on High, then M5a 8b (Tutorial) and 9 (deploy).

## 2026-10-01 · Open start (D-095)
- **Done:** no opening patches, spawn banner, bot founding play and test. Next: varied maps.

## 2026-10-01 · Varied maps (D-096)
- **Done:** new generator (valleys, terraces, cliffs, four water layouts along the topography); tests; seen in the browser. Next: rings on the relief.

## 2026-10-01 · Rings on the relief (D-097)
- **Done:** `drape` for the cursor ring, the selection aura and pings; test; checked in the browser. Next: grazed-bare lockout.

## 2026-10-01 · Grazed-bare lockout (D-098)
- **Done:** neutral release on enemy grazing, 30 s bar to the former owner (claims and planting), hashed; test. Next: solid P2 frontier.

## 2026-10-01 · Solid P2 frontier (D-099)
- **Done:** no more dashes on the map; test updated. Next: the compact cell panel.

## 2026-10-01 · Compact cell panel (D-100)
- **Done:** icon-led panel with health status, strata, soil, push, lockout, plant and animal icons; lock frame export; bar CSS bug fixed. All six requests of the day are in (D-095…D-100).
- **Next:** the user's playtest; then M5a 8b (Tutorial) and 9 (deploy).

## 2026-10-01 · Bot founding delay (D-101)
- **Done:** level-dependent wait before the bot's first planting; test. Next: map types for real diversity, map size option.

## 2026-10-01 · Map types (D-102)
- **Done:** eight weighted map types (plains to mountains, lakeland, marsh), relief and water scaled per type, flooded lowlands; tests; browser check.

## 2026-10-01 · Map size option (D-103)
- **Done:** Small / Mid / Large in the match setup; tests; seen in the browser (Large lakeland). Next: the user's playtest, then M5a 8b and 9.

## 2026-10-01 · Lichen pace fix (D-104)
- **Done:** found the early-game gap (lichen stats, about 9x slower than grasses), buffed lichen to 78 % of grasses' pace, added a test. Next: build bar revamp.

## 2026-10-01 · Build bar sections and pictograms (D-105)
- **Done:** new order with water and recyclers on the right, icon-only items, 15 family pictograms. Next: tier rings, padlocks, quick-stat tooltips.

## 2026-10-01 · Tier medals and quick-stat tooltips (D-106)
- **Done:** tier rings and medal dots, overlaid padlocks, compact tooltips with quick stats; test; seen in the browser. All points of the request are in (D-104…D-106).

## 2026-10-01 · Padlocks (D-107)
- **Done:** closed padlock only, on locked tiles and fully locked families.

## 2026-10-01 · Smooth front line (D-108)
- **Done:** blurred ownership field, contour band in the ground shader, glide between frames; tests; seen in the browser.

## 2026-10-01 · Bigger, sparser forest (D-109)
- **Done:** layout sizes and counts, tests; a grown oak and hawthorn forest checked in the browser.

## 2026-10-01 · Backdrop and parachutes (D-110)
- **Done:** blurred nature backdrop (seen in the browser); striped canopy material (compiles cleanly; the 2.5 s fall was too quick to screenshot).

## 2026-10-01 · Fluid animals (D-111)
- **Done:** sim inertia (critically damped steering), forward-biased strolls, rate-limited heading in the renderer; tests on both sides; all checks green. The in-browser motion check was not possible: the tab's render loop is throttled while scripts run, so the motion was measured in the sim test instead.

## 2026-10-01 · Camera after zoom to plant (D-112)
- **Done:** eye relative to the target; distance-dependent tilt limit. Checked in the browser with wheel events: 0.89 rad close up, back to 0.66 by about 80 m.

## 2026-10-01 · Fronts advance (D-113)
- **Done:** reproduced the stall in a Rust test, then fixed it: caps no longer block flips, or claims of land grazed bare from the enemy. Tree and shrub caps raised; prototype flip rule mirrored; fixture regenerated; all checks green.
- **Note:** a first try that dropped caps from every claim made caps meaningless (the Python cap test caught it); narrowed to land taken from the enemy.

## 2026-10-01 · Strategic icons, push width (D-114, D-115)
- **Done:** family pictogram icons with tier medals, checked in the browser. Found that the blurred push reached the line at 5/16 strength; compensated, with a test. The browser window got stuck at 300×170 px, so the push width was not checked on screen.

## 2026-10-01 · Animal models (D-116)
- **Done:** per-species palettes, six new body types, eyes and tapered legs, a shader gait (legs, bob, flap, wag); gallery review fixed plank wings, a sofa-like bear and dark boar and bison lumps.

## 2026-10-01 · Tutorial (D-117, M5a 8b)
- **Done:** Tutorial entry, objectives logic and tests, panel, App wiring. Browser run-through caught swarm animals not counting (fixed) and a too-easy final goal (30 % → 55 %).
- **Next:** M5a 9, static deploy (needs the user's Cloudflare or itch.io account; ask before publishing).

## 2026-10-01 · Playtest round on the tutorial (D-118…D-121)
- **Done:** lichen-only start, with the bot, tests, relay script and docs updated (D-118); padlock and fill gauge on unlockable cards (D-119); tutorial reworked around grasses and rabbits, with a raid that needs a real order (D-120); planting seed scatter and ripple (D-121).
- **Notes:** browser timing artefacts (a throttled render loop) hid the seed burst until it was stamped with the real clock; the attack-move works but stops at the first enemy food, by design.

## 2026-10-01 · Food web (D-122, D-123)
- **Done:** checked GitHub (up to date, CI green); proposed the ranked food web and the user approved it; "Feeds on" chips on species cards; ranked seek, graze and hunt with rank yields in `sim-core`, with tests.
- **Next:** the tech tree rework (food-web view, counters).

## 2026-10-01 · Tech tree as a food web (D-124)
- **Done:** food-web layout, side-anchored links, focus and counters modes, side panel; checked in the browser. Fixed in review: links hidden behind sibling nodes, column overflow, wrapped family headers, "Eaten by" for plants.

## 2026-10-01 · Cattails (D-125)
- **Done:** cattails replace the willow (data, refuge, model, pictogram, docs, tests); the beaver eats chestnut and oak. Seen in the browser on a marsh map, after algae had built up the soil.

## 2026-10-01 · Food web by tier (D-126)
- **Done:** new diets and insect habitats, effect texts, docs, two tests, "eaten by N" on tech-tree nodes; checked in the browser (oak: bark beetles, beaver, boar).

## 2026-10-01 · Dead trees (D-127)
- **Done:** sim (snag field, natural death, blocking, rot, woodpecker diet), export, dead-tree model, cell chip, tests.
- **Fixed in the browser:** the branches collapsed to slivers (a scale across a leaning geometry), and the mean life was raised from 30 min to 3 h.

## 2026-10-01 · Falling trees (D-128)
- **Done:** GPU fall in `GrowingMesh`, `PlantView` fells tree parts unless a dead tree now stands there, tests, browser check.

## 2026-10-01 · Catastrophe cards (D-129)
- **Done:** sim module, balance, command, cooldowns, effects, wasm bindings, deck UI, targeting ring, animations, enemy-cast toasts, tests. In the browser, the beetle outbreak turned a forest patch into dead trees, the storm felled shrubs and blew leaves, the spill left a bare hole, and the card showed its cooldown.
- **Next:** weather (later); the bot learning catastrophes; M5a 9 (deploy) when the user is ready.

## 2026-10-05 · Card rename, tooltip flicker, species icons (D-130, D-131)
- **Done:** finished the bark beetle → processionary caterpillars card rename (fmt fix, all checks green). The catastrophe tooltip flickered because it grew the bottom-anchored flyout and slid the cards from under the pointer; it is now absolute. Species icons show their family pictogram. Both were checked in the browser.
- **Next:** weather (spec needed from the user); the bot learning catastrophes; M5a 9.

## 2026-10-05 · Weather (D-132)
- **Done:** sim module (schedule, alerts, rain, drought, flood), balance, hash, wasm bindings, badge, alert toasts, sky, particles, flood tiles, tests. Browser check of the alert, the flood, the drought and the rain with a temporarily shortened schedule; rain and dust tuned after the look.
- **Note:** the browser tab advances game time only while it renders (a background window), so natural events were too slow to wait for; the schedule was shortened in `balance.toml` for the check, then restored.
- **Next:** the bot reacting to weather alerts and casting catastrophes; M5a 9 (deploy) when the user is ready.

## 2026-10-05 · Weather tooltip, quality freeze (D-133)
- **Done:** the weather tooltip in the species-tooltip style, with factor stats. Found the High → Medium freeze in the console ("Destroyed texture ShadowDepthTexture used in a submit") and fixed it by setting shadows once per match. The full preset cycle is clean in the browser. Also fixed the weather `$state` proxy comparison, which refreshed the badge every frame.

## 2026-10-05 · QOL pass (D-134…D-137)
- **Done:**
  - top bar: a centred land tug-of-war bar, and the weather button in the icon row;
  - map overlays (soil, strata cover, diversity, moisture, shade) with a reworked display menu, and sim shade and moisture frames;
  - a seed sprinkle from the sky;
  - the Play menu by mode.
  
  All checked in the browser.
- **Notes:**
  - The overlays first did not show: an `$effect` read the non-reactive viewer first, so it never re-ran. Then the canopy hid them, so they are drawn over the scene.
  - A half-written file left Vite with a stale module (white page); touching the file fixed it.
- **Next:** the bot reacting to weather and casting catastrophes; M5a 9 (deploy) when the user is ready.

## 2026-10-05 · Time limit, end-screen charts (D-138)
- **Done:** time limit 600 min; charts sampled and spread-free, with "No data" on all-zero curves; tests. Checked a 1-min end screen in the browser (temporary limit, restored).
- **Open:** the user's 60-min draw with flat curves was not reproduced; ask which mode it was played in if it comes back.

## 2026-10-05 · Guided tutorial, Species page (D-139, D-140)
- **Done:** an eleven-step tutorial with tips, Next on explanations and a pointer ring on each control. In the browser I walked steps 1–8; the gap that walk found (Grasses unlocked but not planted) is fixed. Then the Species page (the tech tree over a catalog source), with Esc to close.
- **Note:** a wedged background tab looked like a page hang; a fresh tab was fine.
- **Next:** the bot reacting to weather and casting catastrophes; M5a 9 (deploy) when the user is ready.

## 2026-10-05 · Tutorial: predators and prey (D-141)
- **Done:**
  - steps for breeding, the raid, the airdrop and the defense against a grasshopper raid with great tits;
  - a tutorial-only `Grant` command;
  - no territory win in the tutorial;
  - great tits eat grasshoppers.

  The browser walk-through reached "Tutorial complete".
- **Note:** the hidden test tab skipped 65 game minutes in one jump, and the bot shrank to two cells. At a natural pace it still held 80 cells at the raid step.
- **Next:** the bot reacting to weather and casting catastrophes; M5a 9 (deploy) when the user is ready.

## 2026-10-05 · Balance passes (D-142, D-143)
- **Done:**
  - `sim-cli bench` (30 matches in about 40 s);
  - the bot made a fair player proxy;
  - the species-stat passes;
  - pace 0.75;
  - the decaying threshold window;
  - the difficulty ladder through play quality and bot income.

  The phase markers hit the targets (early ≤ 6 min, mid 12–14, late 19–22, median end 30 min); hard beats normal 72 %. All checks pass.
- **Lessons:** most "balance" problems were the bot: buying cheap items out of plan order, spamming swarms, failed calls blocking real ones, per-decision pacing punishing faster levels. Fix the proxy before tuning numbers.
- **Next:** the user's playtest per level (and the tutorial at the new pace); then the Cloudflare deploy (M5a 9).

## 2026-10-05 (2) · Playtest round (D-144…D-149)
- **Done:**
  - Breeding measured: it worked, but slowly. It's 4× faster now (`food_reserve` 300, rabbit cooldown 30 s).
  - The tutorial tops up each paid step's biomass.
  - Tips for Shift repeat drops and the I icons.
  - Enemy strategic icons.
  - Victory at 80 % (decaying to 60 % between 25 and 45 min).
  - Stronger bots: more actions, level-paced raids and drops, guarded catastrophes, income 1.0 / 1.3 / 2.0. Hard beats normal 88 %, normal beats easy 90 %; the normal mirror ends at about 26 min.
  - Performance: three re-uploaded every dynamic instance buffer on every pass. Static buffers took the late-game CPU render from 27.7 to 3.4 ms.
- **Lessons:**
  - Profile the renderer by wrapping three's internals (`renderer.backend`, `_attributes`…) in a dev page; the cause was one level below our code.
  - `ecoLive.send({type: "bot"})` plus speed 8 builds a late game in two minutes.
- **Next:** the user's playtest (fps on the laptop, bot strength per level, the tutorial pace); then the Cloudflare Pages deploy.

## 2026-10-05 (3) · Models v2 on branch `models-v2` (D-150)
- **Done:**
  - fine large animals;
  - finer ground and rocks;
  - species tree silhouettes;
  - fern, nettle and bramble shapes;
  - flat lichen and wildflower patches;
  - the undergrowth trimmed after counting triangles.

  Client tests, check, lint and build pass.
- **Not done:** a visual check in the browser (the extension disconnected), and an fps measurement.
- **Next:** the user looks at the branch and checks fps; merge or drop. Then the Cloudflare deploy.

## 2026-10-05 (4) · Models v2 round 2 (D-151)
- **Done:**
  - lichen patches and flower heads;
  - reed beds;
  - patchy stands (15 % fewer shrubs, 14 % fewer trees);
  - simpler ferns and nettles;
  - GPU rain;
  - shadows every 4th frame;
  - baked noise for the ground and water.

  Checked in the browser: lichen colours, ferns, trees, GPU rain during a flood.
- **Lesson:** WebGPU timestamp queries (`trackTimestamp` + `resolveTimestampsAsync("render")`) give GPU time per pass. The ground shader, not the models, was the main GPU cost.
- **Next:** the user's fps check on High and Medium (late game, rain); merge or drop the branch; then the deploy.

## 2026-10-05 (5) · Plant repaint hitch (D-153), trampling and dead trees (D-152)
- **D-152** (on `main`, merged into `models-v2`):
  - grazers trample: enemy plants lose 4× the bite, the grazer is fed 1×;
  - trees die of old age 3× as often.

  Normal mirror: 8 unfinished matches of 30 at 60 min (were 12), median end 25 min.
- **D-153** (branch):
  - repaint only the cells whose plants changed: about 12 % per field frame;
  - spread the repaint at 3 ms a frame;
  - separable frontier blur.

  Checked in the browser: plants render and the queue drains.
- **Lesson:** the profiling tab runs JavaScript about 4× slower than a foreground tab (10 M additions in 45 ms). Compare before and after in the same tab, never against numbers from another one.
- **Next:** the user's fps check on the branch; merge or drop; then the deploy.

## 2026-10-05 (6) · Small changes, merge, deploy pipeline (D-156, D-157)
- **Done:**
  - fox unlock 8 000;
  - the leaf cursor;
  - the full-screen button;
  - `models-v2` merged into `main` and pushed;
  - the Cloudflare Pages deploy: a CI step plus `npm run deploy`, the build badge and the feedback link.
- **Next:** the user creates the Pages project and the API token, then sets the GitHub secrets and variable; the first deploy; share the URL with playtesters.

## 2026-10-06 · Alpha 1 released; Alpha 2 (D-158…D-163)
- Alpha 1 is live on Cloudflare Pages and was played by the user's friends.
- **Alpha 2:**
  - red enemy icon rings;
  - a lighter aura;
  - raids graze the area bare (sim), with fullness and order in the animal frame;
  - click to select, and a unit card (also on icon hover);
  - order lines;
  - a bigger cell card.

  Checked in the browser:
  - the unit card on a rabbit;
  - the red attack line and the grey move line;
  - the new cell card and the thin aura.

  The enemy icon ring isn't shown in a background tab (the HUD loop doesn't run there).
- **Lesson:** order feedback must allow for the lockstep input delay: the sim reports the old order for a tick or two.

## 2026-10-06 (2) · Alpha 2 polish (D-164…D-167)
- **Done:**
  - main menu title (outline, shadow, moss-green ECO), new tagline, a drifting background (sky Ken Burns, parallax hills, rising motes);
  - match setup without the AI heading, centred buttons, mustard selection;
  - a tabbed, game-like Options screen;
  - 45 species silhouettes, used everywhere a species shows.

  Checked in the browser: menus, Options tabs, a contact sheet of all 45 icons (6 redrawn after the first look), the Grazers flyout.
- **Next:** the user's review; push to deploy Alpha 2.

## 2026-10-06 (3) · Alpha 2 round 3 (D-168…D-175)
- **Done:**
  - small-animal caps ×2, herb and undergrowth caps ×1.5, fewer lichen patches;
  - unlock comes to hand with a pop;
  - short red notices with the biomass icon;
  - smooth strategic icons (projected every frame);
  - locked cards name their plants;
  - no drought dust, half the bushes in scattered stands, oak and chestnut swapped;
  - a unit list;
  - victory marks;
  - a speed bar.

  Checked in the browser: the speed bar, the tug marks, unlock-to-hand, a red notice, the unit list click.
- **Seen:** with doubled swarm caps, the hard bot playing P1 fielded only swarms (grasshoppers, earthworms) at 10 min in one match. The bench agrees: units at 10 min fell from 14 to 6. Worth a look in the next balance pass (the bot's swarm-card counting).

## 2026-10-06 (4) · Sound v1 (D-176…D-178)
- **Done:**
  - a procedural Web Audio engine (buses, compressor, variation, cooldowns, voice limits, panning);
  - ~25 synthesised cues;
  - weather ambience beds;
  - wiring to clicks, toasts, unlocks, planting, drops, orders, catastrophes and animals on screen;
  - an Audio options tab and the M mute.

  Checked in the browser: the context starts on the first click, the buses take their volumes, the menu wind bed fades in, the sliders save.
- **Lesson:** the browser tool's clicks only reach the page after a screenshot brings the tab forward (no gesture before that).
- **Next:** the user listens and tunes; then the gameplay balance pass for Alpha 1.1.

## 2026-10-06 (5) · Sound tweaks and generated music (D-179, D-180)
- **Done:**
  - plant-group sprinkles;
  - a brown-noise click;
  - birds and insects gated by your shrub and tree unlocks;
  - water plops and trickles;
  - a 60 % call chance on drops; a wolf howl;
  - munching under enemy swarms;
  - generated ambient music (menu always, pieces now and then in a match), with a recorded-track drop-in and a Music slider.

  Checked in the browser: the menu music runs (scheduled notes, faded in).
- **Next:** the user listens; then the gameplay balance pass for Alpha 1.1.
