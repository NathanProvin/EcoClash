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
