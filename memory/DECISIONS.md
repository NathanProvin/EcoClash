# DECISIONS.md — EcoClash decision log

> Append-only. Never edit the body of an accepted decision. To change one, add a new entry and set the old one's status to `superseded by D-NNN`.
> Every entry that changes a rule must also update `INSTRUCTIONS.md` in the same commit.

Template:

```
## D-NNN · YYYY-MM-DD · Title
- **Status:** accepted | superseded by D-NNN | proposed
- **Context:** why a decision was needed
- **Decision:** what we do
- **Alternatives:** what was rejected, and why
- **Consequences:** what this costs or commits us to
```

---

## D-001 · 2026-09-27 · Browser-first 1v1 ecosystem RTS, vs AI before multiplayer
- **Status:** accepted (from the initial spec)
- **Context:** Scope for v1.
- **Decision:** 1v1 match where players grow a food web. It runs in the browser first. The vs-AI mode ships before multiplayer. Electron (Steam) and Capacitor (Android) come after v1.
- **Alternatives:** Native engine first (Unreal, Godot): see D-003.
- **Consequences:** Every system must fit browser budgets (§5.5): ≤ 30 MB download, ≤ 512 MB WASM memory.

## D-002 · 2026-09-27 · Deterministic Rust simulation core, integer / fixed-point only
- **Status:** accepted (from the initial spec)
- **Context:** Lockstep multiplayer and replays need bit-identical state on every platform.
- **Decision:** `sim-core` is a Rust crate with no floats, no I/O and no rendering. It uses fixed-point math, a single seeded RNG, stable iteration order, and a per-tick hash.
- **Alternatives:** A GPU simulation is fast, but floats differ across GPUs. A JS/TS simulation makes float determinism across JS engines hard to guarantee.
- **Consequences:** No transcendental functions (LUTs instead). Every rule is ported from float to fixed-point, so the M0 prototype needs a quantized mode (D-011).

## D-003 · 2026-09-27 · Web stack: Vite + TypeScript + Three.js WebGPURenderer (TSL) + Svelte
- **Status:** accepted (from the initial spec)
- **Context:** Browser rendering with a stylized-realism look and a light UI.
- **Decision:**
  - Build: Vite + TypeScript (strict).
  - Rendering: Three.js `WebGPURenderer` with automatic fallback to WebGL2, TSL shaders.
  - UI: Svelte + plain CSS.
- **Alternatives:** Unreal has no web export. Godot has no compute shaders on web and fits a Rust core awkwardly. Pygame is too limited.
- **Consequences:** The render layer is an adapter over `snapshot.rs`. A native renderer stays possible later.

## D-004 · 2026-09-27 · Deterministic lockstep, commands only
- **Status:** accepted (from the initial spec). D-006 refines the transport.
- **Context:** Networking model for 1v1 with thousands of agents.
- **Decision:** Peers exchange only commands `{tick, player_id, payload}` and compare state hashes every N ticks.
- **Alternatives:** Server-authoritative state sync costs too much bandwidth for 1–2k agents plus fields.
- **Consequences:** Determinism is non-negotiable from day one. Maphack is possible (accepted for v1).

## D-005 · 2026-09-27 · Data-driven balance in `data/balance.toml`
- **Status:** accepted (from the initial spec)
- **Context:** Tuning happens through batch runs, so the code must have no magic numbers.
- **Decision:** All gameplay tunables live in `data/balance.toml`, shared by every target.
- **Alternatives:** Constants in code need a rebuild for every tuning pass.
- **Consequences:** The balance hash is part of the match handshake and of replays (D-011).

## D-006 · 2026-09-27 · Multiplayer transport: WebSocket relay instead of WebRTC P2P + TURN
- **Status:** accepted (user decision, spec review)
- **Context:** WebRTC P2P needs a signaling server **and** a TURN relay for strict NATs, so two services plus credentials, and NAT failures are hard to debug.
- **Decision:** A small WebSocket relay (`relay/`) forwards commands in order and compares hashes. It never simulates. Default input delay is 2 ticks. The stall timeout, disconnect, pause and handshake rules are in INSTRUCTIONS §10.
- **Alternatives:** WebRTC P2P has slightly lower latency, but more infrastructure. Steam Networking is only relevant for the Steam build.
- **Consequences:** One service to host (small VPS or Cloudflare Durable Objects). It works behind every NAT. WebRTC can come back as an optimization if measured latency requires it.

## D-007 · 2026-09-27 · Lockstep smoke test at M3.5
- **Status:** accepted (user decision, spec review)
- **Context:** Multiplayer is a stated core feature, but it was scheduled last (M6), so integration bugs would be found late.
- **Decision:** New milestone M3.5: two browser tabs play the same match through a local relay for 5 minutes with identical hashes. Full multiplayer (deployed relay, lobby, replays, desync UI) stays at M6.
- **Alternatives:** Relying only on the cross-target determinism CI misses worker/net/timing integration bugs.
- **Consequences:** A minimal `relay/` and `client/src/net/` exist from M3.5.

## D-008 · 2026-09-27 · Build WASM with cargo + `wasm-bindgen-cli`, no wasm-pack
- **Status:** accepted (spec review)
- **Context:** wasm-pack's upstream org (rustwasm) was archived in 2025. wasm-pack is a wrapper whose main job is fetching a matching `wasm-bindgen-cli`.
- **Decision:** `cargo build --target wasm32-unknown-unknown --release`, then `wasm-bindgen --target web`. The CLI version is pinned `=` to the `wasm-bindgen` crate version in `Cargo.lock`. `npm run doctor` checks that they match. `wasm-opt` is optional, for size.
- **Alternatives:** wasm-pack is one more tool with uncertain maintenance.
- **Consequences:** The build script lives in root `package.json`. Bumping `wasm-bindgen` means bumping the CLI too.

## D-009 · 2026-09-27 · Hand-rolled PCG32, no `rand` / `rand_pcg`
- **Status:** accepted (spec review)
- **Context:** `rand`'s distribution and range algorithms have changed between versions. A dependency bump would silently change every replay and break cross-version determinism.
- **Decision:** `sim-core/src/rng.rs` implements PCG32 (XSH-RR) and its own unbiased range reduction. It is about 30 lines, frozen, and covered by known-answer tests.
- **Alternatives:** `rand_pcg` with pinned versions is fragile.
- **Consequences:** Zero RNG dependencies. Known-answer vectors are committed in the tests.

## D-010 · 2026-09-27 · Defer `sim-py`, ship `sim-cli` first; cross-target CI = native vs WASM
- **Status:** accepted (user decision, spec review)
- **Context:** PyO3 + maturin is a third binding to maintain from M1. Comparing native vs `sim-py` hashes proves little, because it is the same native code. The real cross-platform risk is WASM.
- **Decision:** M1 ships a Rust `sim-cli` binary: seed + balance + commands in, per-tick hashes + metrics out as CSV/JSON. Python tools call it as a subprocess. `sim-py` is added at M4+ only if AI training needs in-process stepping. CI compares the native `sim-cli` against `sim-wasm` run under Node.
- **Alternatives:** Keep `sim-py` in M1, as in the original spec.
- **Consequences:** Simpler M1. Balance batch runs pay a process spawn per match, which is negligible at 20-minute matches.

## D-011 · 2026-09-27 · Determinism hardening rules
- **Status:** accepted (spec review)
- **Context:** The original spec didn't cover several integer-determinism traps.
- **Decision:** The following rules were added to INSTRUCTIONS §4 and §5.2:
  1. The release profile has `overflow-checks = true`, and fixed-point code uses explicit `saturating_*`/`wrapping_*` ops. Q16.16 multiply goes through `i64`.
  2. One rounding rule, round half away from zero, lives in `fixed.rs`. Never rely on truncation.
  3. Low-density growth uses seeded stochastic rounding or a growth floor (to choose in M0).
  4. Diffusion is a pairwise flux exchange, so it conserves mass. `D·dt ≤ 0.25` is enforced when the balance file is loaded.
  5. Hashing is incremental: agents every tick, fields only on their update ticks or per dirty chunk. Full hashes are for tests only.
  6. The balance hash is computed from the parsed fixed-point values, never from the file bytes.
  7. LF line endings are enforced repo-wide.
  8. Snapshots send fields only on field-update ticks.
- **Alternatives:** Discovering these at M1 or M6 means debugging desyncs after the fact.
- **Consequences:** The M0 prototype needs a quantized mode to preview the integer effects.

## D-012 · 2026-09-27 · Project memory layout and codename
- **Status:** accepted (spec review)
- **Context:** Claude Code auto-loads `CLAUDE.md`, not `INSTRUCTIONS.md`. The spec had no progress tracker, no session log and no open-question tracker.
- **Decision:**
  - The codename is **EcoClash** (the folder name).
  - The memory docs live in `memory/`: INSTRUCTIONS, DECISIONS, ROADMAP, OPEN_QUESTIONS, JOURNAL.
  - The root `CLAUDE.md` imports INSTRUCTIONS + ROADMAP and defines the session protocol and the Definition of Done.
- **Alternatives:** Docs at the repo root would clutter it. A single giant file would be harder to keep current.
- **Consequences:** Every session starts with the ROADMAP "Now" section plus the last JOURNAL entry, and ends by updating them.

## D-013 · 2026-09-27 · Environment management
- **Status:** accepted (spec review)
- **Context:** Four toolchains (Rust, Node, Python, and later Blender) on Windows, and later CI, must stay reproducible.
- **Decision:**
  - Each toolchain version is pinned in one file: `rust-toolchain.toml` (1.98.1 + wasm32 + rustfmt/clippy), `.nvmrc` + `engines` (Node 24), `.python-version` (3.12) + `uv.lock`, and later `Cargo.lock`.
  - All tasks go through root `npm run` scripts. npm workspaces are used; no pnpm, since npm is already installed.
  - `npm run doctor` is the single health check.
  - LF is enforced through `.gitattributes`.
  - Secrets live only in CI or host secret stores.
  - There are three environments: local / preview / prod.
- **Alternatives:**
  - A devcontainer: Docker is not installed and GPU/WebGPU in containers is awkward.
  - `just` or `make`: an extra tool on Windows.
  - pnpm: not installed, and the gain is marginal.
- **Consequences:** Toolchain bumps are explicit `chore:` commits. A toolchain bump that touches determinism gets a DECISIONS entry.

## D-014 · 2026-09-27 · Bot AI is a command-only player
- **Status:** accepted (spec review)
- **Context:** The spec put the scripted AI "inside `sim-core` or a sibling crate", but didn't define its boundary.
- **Decision:** The AI (crate `sim-ai`) reads snapshots and emits commands through the same queue as humans. It never mutates the world. It is deterministic and seeded. Difficulty = reaction delay + APM cap.
- **Alternatives:** An AI with direct state access is easier to write, but it cheats, breaks replays and couples the AI to internals.
- **Consequences:** Replays of AI matches work unchanged. The AI can run in the worker or headless in `sim-cli`.

## D-015 · 2026-09-27 · Git: local repository only for now
- **Status:** accepted (user decision)
- **Context:** CI needs a remote, but there is no code to build before M1.
- **Decision:** `git init` locally with conventional commits. The user creates the GitHub remote before the M1 CI task.
- **Consequences:** The ROADMAP M1 has a "create remote + CI" task.

## D-016 · 2026-09-27 · Gameplay rules live in `data/gamerules.md`
- **Status:** accepted (user decision)
- **Context:** The author wrote a detailed gameplay draft (strata, spread, tech tree, species, fauna rules, economy, endgame) that goes far beyond INSTRUCTIONS §2.
- **Decision:** `data/gamerules.md` is the design reference for what the game is. For game design it takes precedence over INSTRUCTIONS §2, which keeps only a summary. `CLAUDE.md` points to it; it is not auto-imported, to keep session context small.
- **Consequences:** Gameplay and sim-rules tasks read gamerules first. Items tagged [Proposed] there are defaults, not decisions (INSTRUCTIONS rule 11 applies to them as to open questions).

## D-017 · 2026-09-27 · V1 flora levels and species subset
- **Status:** accepted (user decision)
- **Context:** Review of the gamerules draft: three strata in one table, four levels everywhere else; bees and fire in V1 against INSTRUCTIONS §2.5; slugs had no real counter.
- **Decision:**
  - Three flora levels: L1 herbaceous (pioneers lichen, moss, grasses are its first tier), L2 shrub, L3 canopy. A tier may unlock up to three species.
  - Pollinators (bees) and fire stay post-V1. F2 insects in V1 are grasshoppers and caterpillars.
  - The hedgehog joins V1 (F3 tier 2 with moles) as the slug counter.
  - Non-V1 species (bark beetles, roe deer, wild boar, wood mice) are removed from V1 examples. The bark beetle outbreak stays as a disturbance card.
  - Unlocked cards are permanent, even if the species dies out.
- **Consequences:** Succession thresholds: pioneers none, rest of L1 low, L2 medium, L3 high.

## D-018 · 2026-09-27 · Open questions answered by the gamerules draft
- **Status:** accepted (user decision)
- **Context:** Rules written in gamerules answer four open questions.
- **Decision:**
  - Q-001 herbivore diet: herbivores eat enemy flora. Without orders and with no enemy flora nearby, they graze own flora at a much slower rate and generate bonus biomass points (economic use). Gamerules §10.
  - Q-002 currency: biomass points are a bank separate from the fields. Income comes from the growth of the player's living plants and fauna, in proportion to biomass and growth. Spending (unlocks, spawns) never removes field biomass. Gamerules §7.
  - Q-006 control: fauna are autonomous agents; standard per-unit / group RTS orders override autonomy until completed. Gamerules §9.
  - Q-012 decomposers are agents (earthworms, pill bugs). Gamerules §5.2.
- **Alternatives:** The Q-002 default tied income to a radius around trees; the author's rule counts all living organisms. The Q-006 default was zone orders.
- **Consequences:** INSTRUCTIONS §2.1 and §2.3 updated. Per-unit control at 1–2k agents must stay usable (box select, control groups); revisit if M3 playtests show micro overload.

## D-019 · 2026-09-27 · Flora uses the gamerules cell model, not diffusion
- **Status:** accepted (user decision)
- **Context:** INSTRUCTIONS §5.2 modelled flora as continuous fields with logistic growth and diffusion. Gamerules §3 (D-016) defines a cell model: an owner per cell, one species per stratum, colonization progress, smothering, frozen same-level frontiers. Gamerules §3 only let lower strata spread into own cells, so forest could not advance over own meadow.
- **Decision:**
  - Flora spread is the gamerules cell model. Growth stays logistic within each stratum of a cell. Diffusion and its constraints (pairwise flux, `D·dt ≤ 0.25`) are dropped.
  - Own-cell spread: any stratum spreads into the same empty stratum of a neighbouring own cell, subject to soil development and shade.
  - The [Proposed] flora rules (succession, shade, contested cells, own-cell spread) are prototyped behind on/off switches in `balance.toml`, on by default. They are not validated by being implemented; M0.3 compares them on vs off.
- **Consequences:** ROADMAP M0 rewritten (M0.1 float cell model, M0.2 quantized mode, M0.3 comparison runs). INSTRUCTIONS §5.2 and the M1 criteria refer to spread instead of diffusion.

## D-020 · 2026-09-27 · Species data lives in `balance.toml`
- **Status:** accepted
- **Context:** Gamerules asked for a separate `data/species.toml`. Species coefficients are tunables (rule 6), and the balance hash (D-011) should cover one file.
- **Decision:** Species tunables go in `data/balance.toml` under `[flora.<id>]` (later `[fauna.<id>]`). No `species.toml`.
- **Consequences:** One loader and one balance hash for every target.
