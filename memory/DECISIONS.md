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
- **Status:** superseded by D-029
- **Context:** Gamerules asked for a separate `data/species.toml`. Species coefficients are tunables (rule 6), and the balance hash (D-011) should cover one file.
- **Decision:** Species tunables go in `data/balance.toml` under `[flora.<id>]` (later `[fauna.<id>]`). No `species.toml`.
- **Consequences:** One loader and one balance hash for every target.

## D-021 · 2026-09-27 · Low-density growth uses a minimum-growth floor (Q-015)
- **Status:** accepted (M0.2 evidence)
- **Context:** In integer mode, growth below 1 per tick rounds to 0. Q-015 recommended seeded stochastic rounding.
- **Decision:** Positive growth that rounds to 0 becomes +1. Every other division rounds half away from zero.
- **Evidence:** Scenario seed 1, 128², 20 min: float, quant-stochastic and quant-floor give identical territory (39.9 % / 45.0 %) and biomass within 0.5 %. The cell model seeds each stratum at 10 % of k_max, so the low-density regime is rare and the floor's bias doesn't show.
- **Alternatives:** Stochastic rounding is unbiased, but it costs one RNG draw per stratum per cell per flora tick, couples the RNG stream to the map size, and breaks exact mirror symmetry. It stays in the prototype as `--rounding stochastic` for comparison.
- **Consequences:** INSTRUCTIONS §5.2 updated. `sim-core` growth needs no RNG.

## D-022 · 2026-09-27 · Species of one stratum interpenetrate
- **Status:** accepted (user decision; the competition formula is [Proposed])
- **Context:** With one species per stratum, clover, ferns and bramble could never spread: developed soil only exists under pioneers, which hold the L1 slot (found by M0.1).
- **Decision:** Species of the same stratum complement each other, share cells and keep spreading. A cell holds biomass per species. Within a stratum they compete with partial niche overlap: `ΔB_i = r_i B_i (shade_i − c_i − α Σ_{j≠i} c_j) / shade_i`, with `α = niche_overlap` (0.5 default), so mixed stands hold more biomass than monocultures.
- **Related fix:** On bare land, the fastest-spreading candidate colonizes (it arrives first). A smothered enemy cell goes to the attacking higher-level species. Higher strata reach bare land later, through own-cell spread.
- **Consequences:** State is `bio[species]` (12 layers at V1; about 6 MB of u16 at 512²). Planting adds a species next to the existing ones instead of replacing them.

## D-023 · 2026-09-27 · Victory metric, reproduction, counters (Q-003, Q-004, Q-005)
- **Status:** accepted (user decision)
- **Decision:**
  - Q-003: at the time limit, the highest **standing biomass** (living flora + fauna) wins, shown live in the HUD. Ties: territory share, then draw.
  - Q-004: animals **reproduce** when their energy crosses a threshold (it costs energy), under a per-player population cap. Players also spawn cards.
  - Q-005: counters come from **food-web predators** (gamerules §5.2) and **shrub refuges** (own small fauna in dense hawthorn or bramble cannot be hunted). No special fast energy decay; no friendly predation (gamerules §6.2 stands).
- **Consequences:** M0.4 and M0.5 are unblocked. INSTRUCTIONS §2.1, §2.3, §5.4 and gamerules §6.2, §6.4, §11.3 updated.

## D-024 · 2026-09-27 · Colonization gauge and bioclimate hooks
- **Status:** accepted (user decision; formula [Proposed])
- **Context:** Spread was binary: a flat-rate progress, then a species popped in at 10 % biomass. The user asked for a 0–100 % colonization gauge driven by same-species neighbours, soil and bioclimate.
- **Decision:**
  - Each species has a gauge per cell that caps its capacity (`K × gauge`).
  - In own cells, `Δg = spread_rate × pressure × max(suit − g, 0)`, with pressure = (own + 4-neighbour cover of the same species and owner) / 5.
  - Seed rain adds `seed_fraction × K × Δg` biomass.
  - Empty cells: claim progress at `spread_rate × pressure × suit`. Arrivals start established (biomass ≥ establish threshold, so the new owner can hold the cell), with gauge = pressure × suit.
  - Smothering is continuous, proportional to the best higher-level neighbour cover.
  - `suit = f_dev × f_soil × f_water × f_light` is the single modifier of gamerules §2.3. `f_dev` ramps from 0 at `soil_min − soil_ramp` to 1 at `soil_min` (soft succession). Water and light use a triangular response (no transcendentals). Soil affinity is per soil type. The terrain fields exist with constant V1 values, and absent species keys are neutral.
  - `spread_threshold` is removed.
- **Consequences:** State adds `gauge[species]`, `soil_type`, `water` and `light`; own-cell progress is gone. Fronts are round and gradual. At the old rates, spread at a straight front is about 5× slower (pressure 1/5), so M0.7 retunes.

## D-025 · 2026-09-27 · M0.7 tuning pass 1: frontier timing, and gauge fixes
- **Status:** accepted (values are placeholders until the M0.6 sweep)
- **Target (gamerules §11.1):** frontiers form in the mid phase, shrubs reach them by 12 min, and frozen frontiers can break.
- **Decision:**
  - `spread_rate` ×8 for L1 and ×24 for L2/L3; `soil_gain` ×3 (values in `balance.toml`).
  - The "forest" build plants shrubs and trees forward, toward the frontier, as a player would. Build offsets scale with the map size.
  - Fixes found while tuning:
    - arrivals (claims and flips) come only from species **established** in a neighbour (biomass ≥ establish threshold), so 1-biomass seedlings can't be promoted;
    - seed rain uses normal rounding, not the growth floor;
    - biomass below 1 is cleared at the end of each step, which removes float "ghosts" of 1e-57.
  - The `own_spread` switch is removed: the gauge is the spread mechanism (D-024), and turning it off only froze all spread.
  - `spread_rate × dt ≤ 1` is validated at load.
- **Result (seed 1, 128², 20 min):**

  | Variant | Contact | L2 at front (P1 / P2) | First take | Territory (P1 / P2) | Cells taken (P1 / P2) |
  |---|---|---|---|---|---|
  | Baseline | 8.1 min | 10.4 / 11.5 min | 10.8 min | 50.3 % / 49.7 % | 202 / 0 |
  | Quant | 8.1 min | 10.3 / 10.7 min | 10.7 min | 49.3 % / 50.7 % | 75 / 40 |
  | No succession | 8.1 min | 9.1 / 11.3 min | 9.5 min | 52.1 % / 47.9 % | 500 / 0 |
  | No shade | same as baseline | | | | |
  | No contested cells | same as baseline | | | | |

  - The meadow build leads at 5 and 10 min. The switches now change territory.
  - Quant's timing matches float. Its biomass is +5 %: a species enters a neighbour cell once a tick's seed rain rounds to 1, which is half a unit in quant and a full unit in float.
  - No shade: +11 % biomass, same territory.
- **Consequences:** Breakthroughs are threshold events, so exact cell counts differ between modes; curves and timings are compared, not cell counts.

## D-026 · 2026-09-28 · Fauna prototype model (M0.4)
- **Status:** accepted (prototype; values are untuned placeholders by user request)
- **Context:** M0.4 needs animals on top of the flora model, following gamerules §5.2 and §6 and D-023.
- **Decision:**
  - **Agents:** stand on grid cells and update once per flora tick (2 Hz) in the prototype. The spec's 10 Hz stays for `sim-core`. Structure of arrays in creation order; integer-only logic with Q16 energy, so float and quant flora modes share it.
  - **Behaviour priority:**
    1. flee the nearest enemy hunter within `flee_radius`;
    2. seek food within sight: enemy flora, then own flora (herbivores); dead biomass on non-enemy land (decomposers); huntable enemy prey (predators);
    3. otherwise wander one cell (seeded RNG, separate from flora).
  - **Eating:**
    - Herbivores eat the richest diet species of their cell; own flora at `own_graze` × bite. Bites on one stock are shared pro rata.
    - Energy gain = eaten × `transfer` (10 % rule); the rest becomes dead biomass.
    - Predators kill one huntable prey in their cell per tick, in index order.
    - Decomposers eat dead biomass and add soil development.
  - **Refuge:** small fauna in its owner's cells with dense hawthorn or bramble cannot be hunted (D-023).
  - **Life cycle:** upkeep each tick; starvation leaves half the body as dead biomass; at full energy an animal splits in two under the per-player cap `max_agents / 2` and a per-species breeding cap `species_cap` (150), so breeding cannot fill the room player spawns need.
  - **Grazers avoid crowds:** herbivores and decomposers only target cells whose stock covers everyone of their kind already there, and animals in an overcrowded cell wander off, so herds disperse instead of starving together.
  - **Spawning (gamerules §6.3):**
    - own habitat is required;
    - predators are dropped on the enemy prey nearest the clicked point;
    - herbivores need enemy food within `herbivore_range` of own land and spawn at the nearest own habitat cell;
    - decomposers need habitat only.
  - **Flora litter:** `litter_fraction × growth_rate × B` per second goes to dead biomass, as the spec's "death" rule. This keeps decomposers fed from the start.
  - **Code split:** `flora.py` (plants), `fauna.py` (animals), `match.py` (scripted match, plots, CLI; `npm run proto`).
- **Simplified for now:**
  - no player orders or stances (M3);
  - no spawn costs (M0.5);
  - voles eat biomass instead of reducing tree spread (§6.1);
  - lynx and buzzard habitats are "any L3";
  - no bark-beetle card.

## D-027 · 2026-09-28 · Economy prototype (M0.5)
- **Status:** accepted (prototype; values are untuned placeholders)
- **Decision:**
  - Biomass points are an integer bank per player (D-018), starting at `start_budget`.
  - **Income per tick:** `income_rate × flora growth` + the energy the player's animals gained (gamerules §6.4).
  - **Tech tree:**
    - a card is (tree, level, tier) and unlocks every species at that position;
    - tier 1 of level 1 of both trees (pioneers, earthworms) is unlocked at start;
    - a card needs the previous tier of its level, and an animal also needs one of its habitat plants unlocked;
    - unlocks cost `base(level) × tier_multiplier^(tier−1)` (§4.4).
  - **Spawning:** plants cost per cell by level. Animals cost `body × spawn_cost_per_body` each, ×`drop_surcharge` for predators dropped outside own land (§6.3).
  - **Victory:**
    - territory ≥ threshold at any time; the threshold is fixed (`victory_territory`, 60 %) or decays 75 % → 55 % behind the [Proposed] `territory_decay` switch (§11.3);
    - at the time limit: standing biomass (flora + animal bodies), then territory share, then a draw (D-023).
  - The scripted builds buy their unlock path one card at a time and wait until an order is affordable; orders don't block one another.
- **Result (seed 1, 128²):** P1 (forest) wins on standing biomass at 20 min, 247 M vs 191 M. Banks reach the millions late (income outgrows costs; placeholder).

## D-028 · 2026-09-28 · First visualization: replay viewer with placeholder shapes
- **Status:** accepted (user decision)
- **Context:** The user wanted a first visualization and UI, with dots, triangles and cubes standing in for the future models. The sim exists only in Python; the Rust/WASM core is M1/M2.
- **Decision:**
  - **Replay viewer first**, on the target stack: Vite + strict TypeScript + Svelte + Three.js `WebGPURenderer` (WebGL2 fallback), in `client/` as an npm workspace.
  - **Replay files:** the Python prototype exports `replay.json` (metadata, HUD series, log) and `frames.bin.gz` (per tick: animals as id / y / x / species / owner; every 4 ticks: owner + L1..L3 cover bytes). When the WASM worker exists, it replaces the replay as the data source; the renderer only reads snapshots (INSTRUCTIONS §6).
  - **Shapes:**
    - ground tinted by territory;
    - flora L1 = dots, L2 = cones, L3 = cubes, scaled by cover, in lighter-to-darker player hues;
    - animals unlit and raised above the plants: herbivores as spheres, decomposers as small spheres, predators as bright pyramids.
  - **UI:** HUD (territory, standing biomass, bank, animal counts, winner), timeline (play/pause with Space, speed, scrubber), legend with layer toggles, and an RTS camera (`MapControls`, limited tilt).
  - Agents got persistent ids (never reused) so the viewer can interpolate positions.
- **Dependencies (rule 5):** three (renderer, §3.1); svelte + @sveltejs/vite-plugin-svelte and vite (UI and build, §3.1); typescript ~6.0 (typescript-eslint and svelte-check cap it below 6.1); eslint + typescript-eslint + eslint-plugin-svelte + @eslint/js + globals (Definition of Done lint); prettier + prettier-plugin-svelte (§12); svelte-check (types in .svelte); vitest (client tests, reuses the Vite config).
- **Not yet:** player input (the replay isn't live), minimap, COOP/COEP headers (no SharedArrayBuffer yet), real models and shaders (M5).

## D-029 · 2026-09-28 · Per-species stat sheet, halved grid
- **Status:** accepted (user decision; values are placeholders the user will tune)
- **Context:** The user wants per-species stats in a config file to tune: growth, spawn cost, unlock cost, biomass generation, population cap and special effect. They also found the grid too large.
- **Decision:**
  - **`data/species.toml`** holds one block per species; supersedes D-020. The six stats come first, then the model internals. `load_balance()` merges it into the balance dict, and both files will be converted and hashed together (D-011).
  - **growth:** plants = colonization gauge speed at full pressure (formerly `spread_rate`); animals = minimum seconds between two births of a well-fed animal (a breeding cooldown). The logistic rate is renamed `biomass_rate`.
  - **spawn_cost:** per cell planted or per animal. **unlock_cost:** per species; 0 means available at start.
  - **yield:** a flat income in points per second, per fully covered cell (× cover) or per animal. It replaces "a share of flora growth + animal energy" (D-027 income).
  - **cap:** max cells per player (plants) or max animals per player (animals); it replaces the global `species_cap`.
  - **effect:** text shown in the UI. Mechanics stay where they are (refuge flora, shade, soil gain).
  - **Unlocks are per species:** a species needs one unlocked species on the previous tier of its level (the cheapest path is bought first) and, for an animal, one of its habitat plants. Unlock events are logged for the tech tree.
  - **Grid halved:** spec default 512 → 256 (INSTRUCTIONS §5.1); prototype default 128 → 64; Q-008 default is now 1 cell = 2 m. The renderer scatters several plant models per cell at random offsets.
- **Consequences:** The balance hash in M1.5 covers both files. Replays (v2) carry the species table, per-species counts and unlock events.

## D-030 · 2026-09-28 · RTS UI v1 and camera controls
- **Status:** accepted (user direction: RTS philosophy, simple and clean style)
- **Decision:**
  - **Top resource bar** (viewed player; a P1 / P2 switch picks the view): land colonized (vs opponent), number of living species, biomass stock and its rate (+X/s). Tech tree and Layers buttons.
  - **Bottom unit bar:** the current selection grouped by species, or the player's living species (cells / animals) when nothing is selected. A card focuses a species; clicking an animal card selects those animals on screen. A details panel shows the focused species' stats and effect.
  - **Full-screen tech tree** (T / Esc): flora L1–L3 and fauna F1–F5 as levels × tiers. Each card shows the stat sheet, diet and habitat, owned count, and its state (unlocked / available / locked) at the current time, from the unlock log.
  - **Mouse (RTS):** left-drag = box select (a click picks one animal), middle-drag = rotate, right-drag = pan (right-click becomes orders in M3), wheel = zoom toward the cursor.
  - **Keys:** WASD / arrows = pan, Q / E = rotate, Home = reset view, Space = play/pause, Esc = close / clear.
  - A slim replay timeline sits above the unit bar (replay only).
  - Plants are scattered naturally: up to 5 dots, 3 cones or 2 cubes per cell, with deterministic random offset, size and angle, the count following cover (D-029).
- **Not yet:** orders and spawning from the UI (needs the live sim: M1–M3), minimap, plant selection highlight.
