# ROADMAP.md — EcoClash

> Living plan. Update the **Status** block and tick boxes at the end of every session.
> One task ≈ one commit. The acceptance criteria are the ones in INSTRUCTIONS §11.

## Status
- **Now:** M0.1: flora cell model prototype (float).
- **Next:** M0.2 quantized mode, then M0.3 comparison runs.
- **Blocked:**
  - M0 agent tasks (M0.4+) wait for Q-003, Q-004, Q-005 (user thinking).
  - None on the tooling side (Rust ready as of 2026-09-27).
- **Last updated:** 2026-09-27

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
- [ ] M0.1 NumPy float cell model (`tools/prototype/flora.py`): strata, logistic growth + shade, soil development, spread / colonize / smother / frozen frontiers, territory. Species from `balance.toml` `[flora.<id>]`. Mirrored scripted scenario; CSV + plots (biomass, territory %, income).
- [ ] M0.2 Quantized mode: u16 state, Q16.16 rates, the §4 rounding rule, stochastic rounding vs growth floor (resolves Q-015).
- [ ] M0.3 Comparison runs: float vs quant curves, each [Proposed] switch on vs off. Report in JOURNAL.
- [ ] M0.4 ⏸ Herbivores + predators as agents (NumPy arrays of positions and energy). Needs Q-004, Q-005.
- [ ] M0.5 ⏸ Economy / victory metric. Needs Q-003.
- [ ] M0.6 Seed sweep: 100 seeds; all trophic levels of both players coexist at t = 20 min in ≥ 90 % of runs.
- [ ] M0.7 `balance.toml` filled with the tuned coefficients. DECISIONS entry for the model.

## M1 · `sim-core` fields (Rust)
- [ ] M1.1 User creates the GitHub remote. Cargo workspace (`Cargo.toml`: release `overflow-checks = true`), CI skeleton (fmt, clippy, test).
- [ ] M1.2 `fixed.rs` (Q16.16, rounding rule, LUTs) + `rng.rs` (PCG32 with known-answer tests).
- [ ] M1.3 Fields + growth/spread/competition rules, multi-rate scheduler.
- [ ] M1.4 `commands.rs`, `hash.rs` (incremental), `snapshot.rs`.
- [ ] M1.5 Balance loader: parse, convert to fixed-point, validate (stability), balance hash.
- [ ] M1.6 `sim-cli run` → per-tick hash + metrics CSV. The Python script compares the result with M0 quantized mode.
- [ ] M1.7 Determinism tests: run twice, `proptest` command streams.
- [ ] M1.8 `sim-wasm` + Node headless runner. CI checks the native vs WASM hash. `npm run doctor` checks that the `wasm-bindgen-cli` version matches `Cargo.lock` (D-008).

## M2 · Web render of fields
- [ ] Resolve Q-008 (scale), Q-009 (colours), Q-010 (reference machine).
- [ ] Vite + TS + Svelte scaffold as an npm workspace (`client/`). COOP/COEP headers in dev and `_headers`.
- [ ] Worker hosting `sim-wasm`, SharedArrayBuffer snapshots (fields at their update rate only).
- [ ] Three.js WebGPURenderer: terrain, flora textures, instanced grass, RTS camera.
- [ ] Perf check: 60 fps at 512² on the reference machine.

## M3 · Agents and control
- [ ] Resolve Q-007 (fog). (Q-006 and Q-012 resolved by D-018.)
- [ ] SoA agent storage + generational ids, behaviour state machines, flow fields (64×64).
- [ ] Selection, orders, group hotkeys; input → commands.
- [ ] Sim tick ≤ 8 ms at 512² with 1,500 agents (in the worker).

## M3.5 · Lockstep smoke test (D-007)
- [ ] Minimal `relay/` (Node WebSocket): order + forward commands, compare hashes.
- [ ] `client/src/net/`: input delay `d`, stall handling.
- [ ] Two tabs, 5 min, identical hashes. Automated in a Node test with two headless clients.

## M4 · Full match vs AI
- [ ] Economy, structures, territory, victory conditions (per the resolved Q-002 and Q-003).
- [ ] `sim-ai` scripted bot, command-only (D-014), with difficulty levels.
- [ ] End screen with biomass and territory charts.
- [ ] `tools/balance/` batch runs via `sim-cli` → Parquet; tune Q-013.
- [ ] Decide whether `sim-py` is needed (D-010).

## M5 · Art and UI polish
- [ ] Git LFS for `assets-src/`. Blender `bpy` pipeline (`tools/assets/build.py`).
- [ ] Shader priorities 1–5, quality presets, menus, settings, keybinds.
- [ ] `ASSETS_LICENSES.md` complete.

## M6 · Multiplayer
- [ ] Relay deployed (VPS or Durable Objects), `.env.example` with `VITE_RELAY_URL`.
- [ ] Lobby + handshake (build version, balance hash, seed).
- [ ] Desync detection UI + state dumps, replays, resign/pause/disconnect rules.
- [ ] Preview/prod deploy pipeline (Cloudflare Pages, itch.io).
