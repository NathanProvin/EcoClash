# ROADMAP.md — EcoClash

> Living plan. Update the **Status** block and tick boxes at the end of every session.
> One task ≈ one commit. The acceptance criteria are the ones in INSTRUCTIONS §11.

## Status
- **Now:** M1.7 determinism tests (`proptest` command streams), then M1.9 performance and M1.8 `sim-wasm`.
- **Known issue:** a flora tick takes 107 ms at 256² (budget 8 ms per tick): M1.9.
- **Next:** M1 (`sim-core`). Balance tuning (M0.6 sweep, M0.7) is deferred: the user wants a working prototype, not tuned values.
- **Blocked:**
  - None on design questions for M0.
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
- [ ] M1.7 Determinism tests: run twice, `proptest` command streams.
- [ ] M1.9 Flora step performance: ≤ 8 ms per flora tick at 256² (107 ms at the first port, release). Skip bare cells, reuse buffers, precompute neighbours; the parity test guards exactness. Measure: `cargo test -p sim-core --release -- --ignored --nocapture flora_tick_time`.
- [ ] M1.8 `sim-wasm` + Node headless runner. CI checks the native vs WASM hash. `npm run doctor` checks that the `wasm-bindgen-cli` version matches `Cargo.lock` (D-008).

## M2 · Web render of fields
- [x] RTS UI v1 on the replay viewer (D-030): top resource bar, bottom unit bar with box selection, full-screen tech tree, camera rotation.
- [x] Replay viewer (early M2, D-028): the Python prototype exports replays; the Vite + TS + Svelte + Three.js client plays them back with placeholder shapes, an RTS camera and a HUD.
- [ ] Resolve Q-008 (scale), Q-009 (colours), Q-010 (reference machine).
- [ ] Vite + TS + Svelte scaffold as an npm workspace (`client/`) — done with the viewer; still to do: COOP/COEP headers in dev and `_headers`.
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
