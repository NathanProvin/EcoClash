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
