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
- **Status:** superseded by D-035 (remote created 2026-09-28)
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

## D-031 · 2026-09-28 · Cell inspection (click), aura, zoom to plant scale
- **Status:** accepted (user request)
- **Decision:**
  - A plain click on the map inspects the cell under the cursor (ground-plane raycast); a drag still box-selects animals (D-030). Esc clears the cell first, then the selection.
  - **Aura:** a foggy, smoky light-grey ring (three soft layers through the plant height, drifting in opposite directions and gently breathing) marks the selected cell.
  - **Cell panel** (floating, top right): owner, soil development, cover of each plant species present, the animals standing on the cell by species and owner, and a "Zoom to plant scale" button that flies the camera down (0.8 s ease-out) until single plant models fill the view. The wheel can now zoom that close too (min distance 2 m, near plane 0.1).
  - **Replay v3:** each field frame stores owner, soil development and the cover of each plant species (1 byte each per cell); the viewer derives the per-stratum cover from the species.

## D-032 · 2026-09-28 · `sim-core` foundations (M1.1, M1.2)
- **Status:** accepted
- **Decision:**
  - **Cargo workspace** at the root: edition 2024, resolver 3, release `overflow-checks = true`. Lints: `unsafe_code = "forbid"` and clippy `float_arithmetic = "warn"`, with clippy run as `-D warnings`, so any float slipping into simulation logic fails the build. `Q16::from_balance` is the single allowed conversion point.
  - **`fixed.rs`:** `Q16` (Q16.16 in `i32`), products through `i64`, one rounding rule, `div_round` (half away from zero), identical to the prototype's quant mode. `+`/`-` panic on overflow (a bug); `saturating_*` where saturation is meant. `from_balance(f64)` scales by 2^16 (exact) and rounds half away (`f64::round`), so it is platform-independent.
  - **`rng.rs`:** PCG32 (XSH-RR 64/32), seeded like the reference `pcg32_srandom_r`. Verified against the reference demo outputs (seed 42, stream 54). `below()` uses the reference threshold rejection (unbiased). `chance(num, den)` is exact.
  - **CI workflow** (`.github/workflows/ci.yml`): rust (fmt, clippy, test, wasm32 build), python (ruff, pytest), client (lint, check, test, build), all through the root npm scripts. It is inactive until the remote exists.
- **Consequences:** No crates yet. The balance loader (M1.5) will need `toml` + `serde`, justified then.

## D-033 · 2026-09-28 · Placeholder layout without overlaps
- **Status:** accepted (fix of a critical visual bug reported by the user)
- **Context:** Models overlapped. Offsets were independent and random (up to ±0.42 cell); heights were baked into the geometry and scaled with size, so small tree cubes sank into cones; animals on one cell were drawn at the same point.
- **Decision** (`client/src/render/layout.ts`, pure and tested):
  - **Slots:** every model owns a slot of a per-cell grid: 2×2 for tree cubes and for shrub cones, 3×3 for herb dots. Its jitter, size and rotation keep it inside the slot, so there are no overlaps inside a cell or across cells. Dots skip slots that would touch a cone base.
  - **Height bands**, fixed and disjoint: dots on the ground; cones up to 1.26 m (≤ 1.3); tree cubes between 1.65 and 2.35 m (centre 2.0); animals above 2.6 m.
  - **Animals** sharing a cell get a per-cell g×g grid by id order, scaled down as they crowd. The selection highlight is colour only (no size bump).
  - The test checks no overlap over 4,000 random cells and the band limits.

## D-034 · 2026-09-28 · Flora rules in `sim-core`, exact parity with the prototype (M1.3)
- **Status:** accepted
- **Decision:**
  - **`balance.rs`:** parses `balance.toml` + `species.toml` from strings at runtime (no I/O in `sim-core`, no recompile to tune). Species keep file order (their index), unknown species keys are rejected (typos), and the prototype's asserts become readable errors.
  - **`flora.rs`:**
    - `FloraParams` converts with the prototype's float operations in the same order, then its rounding `sign(x)·floor(|x|+0.5)`, so every integer matches.
    - `FloraState` is species-major, all `i64` (ponytail: pack to u16 later).
    - `Flora::step` ports quant-mode `Flora.step` block for block (shade, logistic growth with niche overlap, soil, pressure / attack / seeds, cell caps, litter + smothering, gauge + seed rain, flips, contested claims, cleanup). `plant()` follows the prototype's cap rule.
  - **Parity test:** `tools/prototype/fixture.py` (`npm run rs:fixture`) runs a 14×14, 300-tick quant scenario (soil gradient, both players, mixed strata, grass cap 30) and writes its parameters and 8 checkpoints with the TOML it used. `sim-core/tests/flora_parity.rs` demands identical parameters and state; a one-unit mutation is caught at tick 1 with its cell.
  - **Crates (rule 5):** `serde` (derive) + `toml` (`preserve_order`: species index = file order) for the data files; `serde_json` (dev) for the fixture.
- **Consequences:** The prototype and `sim-core` evolve together. The M1.6 comparison becomes an exact check instead of "within tolerance".

## D-035 · 2026-09-28 · GitHub remote and commit identity
- **Status:** accepted (user decision)
- **Decision:**
  - Remote `origin` = https://github.com/NathanProvin/EcoClash, with CI on every push.
  - GitHub's email privacy refused the first push, so this repo's `user.email` is the noreply address `77007242+NathanProvin@users.noreply.github.com`. The 22 local, never-pushed commits were rewritten to it (dates and messages kept).
- **Consequences:** Supersedes D-015.

## D-036 · 2026-09-28 · Commands, hashing, snapshots, tick loop (M1.4)
- **Status:** accepted
- **Decision:**
  - **Commands** `{tick, player, seq, payload}` sit in a `BTreeMap` queue and are applied at the start of their tick in (player, seq) order, whatever the submission order. The first payload is `Plant { species (by name), row, col, radius }` (gamerules §8 disc). Invalid commands (unknown species, bad player, off-map, late, duplicate) are ignored and counted in `rejected`, identically on every peer. Commands serialize to JSON (`{"type":"plant",...}`) for command files and replays. Plant costs and unlocks stay in the prototype economy until M4.
  - **Hash:** xxHash64 (seed 0) of canonical little-endian bytes. Fields are hashed per 32×32 chunk; chunks are re-hashed only when dirty (all on flora ticks, touched chunks on a Plant). World hash per tick = (tick, flora ticks, rejected, RNG state, digest of chunk hashes). Chunk hashes can locate a desync (M6). `full_hash` is for tests.
  - **Snapshot:** a copy in display bytes (owner, soil 0..255, cover per species 0..255). `field_frame()` is exactly the replay v3 layout the viewer decodes, so the worker (M2) can feed the renderer without changing it.
  - **World:** tick = commands → (agents, M3) → flora every `flora_every_ticks` → (environment, constant in V1) → hash. It owns the PCG32, seeded per match.
  - **Crate (rule 5):** `xxhash-rust` (xxh64 only): the spec mandates xxHash64, and its algorithm is frozen, so it cannot drift like `rand`; the known answers are tested.
- **Finding:** 107 ms per flora tick at 256² in release (budget 8 ms per tick) → ROADMAP M1.9.

## D-037 · 2026-09-28 · Balance hash and `sim-cli` (M1.5, M1.6)
- **Status:** accepted
- **Decision:**
  - **Balance hash** (`hash::balance_hash`): xxh64 over a version number, the `[sim]` integers and every converted flora value (species names in order, levels, per-species fixed-point arrays, global rules, switches). It is computed **after** conversion, never over file bytes. Tested: CRLF, spacing, comments and sub-resolution edits keep it; real stat or rule changes alter it. Stats not read by a ported system yet (costs, yields, fauna) join it with their system. Peers compare it in the handshake (M6); `sim-cli` prints it.
  - **`sim-cli`** (new workspace binary; deps `sim-core` + `serde_json`; std-only argument parsing): `run --seed --ticks [--commands file.jsonl] [--size] [--balance] [--species] [--out metrics.csv] [--hashes hashes.csv]`. It prints the balance hash and final state hash; metrics once per flora tick (territory, biomass, cells per species per player); hashes once per tick.
  - **Cross-check** (`tools/prototype/cli_check.py`, `npm run cli:check`, `tests/test_cli.py`): one command file (both players, an order between flora ticks, two orders in one tick) through `sim-cli` and through the quant prototype with the same command semantics. Every flora tick must match exactly (240 of 240 at 48²). Shifting one order by one flora tick is detected.

## D-038 · 2026-09-29 · Fast flora step; flora every 8 ticks (M1.9)
- **Status:** accepted (user: lowering the flora frequency is fine)
- **Context:** The first port took 107 ms per flora tick at 256² (budget: 8 ms per tick).
- **Decision:**
  - **Exactness first:** `Flora::step` computes the same state as before, bit for bit. The previous version stays as `step_reference` (test only), and a test runs both on a busy 40×40 map (all strata, both players, a cap) for 400 ticks, comparing everything every 5 ticks. The prototype parity and the `sim-cli` cross-check still hold.
  - **How:**
    - One global pass computes cover, a per-cell species-presence bitmask, the dominant level and the cap counts.
    - Then each cell is solved alone, since every rule reads only the cell and its 4 neighbours, over its relevant species only (present in the cell or next door). A bare cell with bare neighbours is skipped.
    - Buffers are reused (no per-tick allocation), with a precomputed neighbour table.
    - The neutral water and light responses are skipped (`div(x·ONE, ONE) = x`).
  - **Guard:** the loader rejects `k_max × establish_threshold < 1` (the skip logic needs established species to have biomass).
  - **`flora_every_ticks` 5 → 8** (1.25 Hz). `growth × dt ≤ 1` still holds (max 0.96).
- **Result** (release, this machine, noisy runs):

  | Case | Per flora tick | Per tick (average) |
  |---|---|---|
  | Mid-game (3,800 cells owned) | ~6 ms | ~0.75 ms |
  | Worst case (all 65,536 cells owned, 7 species each) | 46–55 ms | 5.7–6.9 ms |

  Both are within the 8 ms per tick budget; the largest single tick is far below the 100 ms tick period.

## D-039 · 2026-09-29 · `sim-wasm` and the native vs WASM check (M1.8)
- **Status:** accepted
- **Decision:**
  - **`sim-wasm`** (cdylib): a thin wasm-bindgen wrapper with no rules of its own. `Sim::new(balance, species, seed, size)`, `submit(json)`, `step()` → hash, `tick` / `floraTick` / `balanceHash` / `rejected`, `fieldFrame()` (replay v3 layout, what the viewer decodes) and `speciesNames()`. Hashes cross as 16-digit hex strings (u64 would be a BigInt).
  - **One package for Node and browser:** `wasm-bindgen --target web` into `sim-wasm/pkg/` (git-ignored). Node loads it with `initSync(bytes)`; the M2 worker will load the same package. (`--target nodejs` emits CommonJS, which clashes with the repo's `"type": "module"`.)
  - **`npm run wasm:check`** (`sim-wasm/node/check.mjs`) builds the package, runs `sim-wasm/node/commands.jsonl` (both players, an order between flora ticks, an invalid player) for 1200 ticks through `sim-cli` and `run.mjs`, and requires the same hash on every tick. CI's rust job runs it, with `wasm-bindgen-cli` cached per version.
  - **Pinning (D-008):** `wasm-bindgen = "=0.2.129"`. `npm run doctor` checks that the installed CLI matches the version in `Cargo.lock` and prints the install command.
- **Deps (rule 5):** `wasm-bindgen` (the browser binding, INSTRUCTIONS §3.1) and `serde_json` (commands arrive as JSON).

## D-040 · 2026-09-29 · Map scale, player colours, reference machine (Q-008, Q-009, Q-010)
- **Status:** accepted (user decision)
- **Decision:**
  - **Q-008, scale:** 1 cell = 2 m; the 256² map is about 512 m across. Herbivores are about 0.3 m and move about 1.5 cells/s; predators about 0.6 m, about 2.5 cells/s. Crossing the map takes about 2–3 minutes: a diorama feel, with small living things in a big meadow.
  - **Q-009, colours:** P1 blue `#0072B2`, P2 orange `#E69F00` (Okabe–Ito; validator: ΔE 29 under red-green colour blindness, target ≥ 8). A non-colour cue is added: each player's frontier line has its own pattern (P1 solid, P2 dashed).
  - **Q-010, reference machine:** the dev laptop, Lenovo 83EQ (i5-12450H, 8 cores / 12 threads, 16 GB, Intel UHD integrated graphics, 1080p), for every budget: 60 fps on "medium", 30 fps on "low", sim ≤ 8 ms per tick on average.
- **Consequences:** INSTRUCTIONS §5.5, §7.1 and §11 updated; the M2 perf check uses 256² and this machine. The frontier line pattern comes with the M2 territory border.

## D-041 · 2026-09-29 · Live match in a Web Worker behind the viewer (M2)
- **Status:** accepted
- **Decision:**
  - `client/src/worker/sim.worker.ts` runs `sim-wasm` at the fixed tick rate. When a tick overruns, the next one starts at once: game time slows down, ticks are never skipped. It posts the tick (hash, sim ms per tick) every loop, and the field frame only when the flora ticked.
  - Field frames travel as transferable `ArrayBuffer`s (about 0.9 MB at 1.25 Hz). SharedArrayBuffer is deferred to M3, when agents need per-tick data. COOP/COEP headers are already set (Vite dev/preview, `public/_headers`).
  - The renderer and HUD read a `Source` (the public surface of `Replay`); `Live` implements it from the latest frame, and its HUD series grows by one row per frame (end-screen charts later).
  - `balance.toml` and `species.toml` are bundled into the worker (`?raw`); `sim-wasm` exposes `speciesTable()` (the replay species table, plants only) and `tickHz`.
  - The worker stamps commands with the next tick to run and a per-player sequence number. There is no input delay locally; lockstep adds it (M3.5).
  - Until match setup exists (M4), both players open with the prototype builds' tick-0 plants (grasses + lichen at the home point n/4, mirrored).
  - `npm run wasm:build` builds the package the browser and `wasm:check` share; `client:dev` runs it first. In CI, the rust job uploads `sim-wasm/pkg` and the client job (now after it) downloads it.
  - URL options: `?seed=N&size=N` (default seed 1, size = balance grid).
- **Consequences:** the viewer opens on the live match; replays stay in the source menu.

## D-042 · 2026-09-29 · Planting from the UI in the live match (M2)
- **Status:** accepted
- **Decision:**
  - In a live match, the bottom bar shows a card for every plant species. Clicking a card arms planting; the next map click sends a `plant` command for the viewed player. Shift keeps it armed, like RTS build orders; Esc cancels.
  - The brush is a disc of `[flora] plant_radius` cells (2). It is a command parameter, not a rule, so it is not part of the balance hash. `sim-wasm` exposes it as `plantRadius`.
  - The sim decides what takes: free or own cells, suitable soil, under the species cap. The UI does not predict it.
  - Until the economy and unlocks are ported (M4), every plant species can be planted, at no cost: the live match is a sandbox for the flora rules.
- **Consequences:** there is no feedback when an order plants nothing (enemy land, soil too poor); a placement preview or refusal notice can come with the economy (M4).

## D-043 · 2026-09-29 · Frontier line rendering (M2)
- **Status:** accepted
- **Decision:**
  - The frontier (D-040) is an RGBA overlay texture with 4 texels per cell side, laid just above the ground and under the plants. It is unlit and uses nearest filtering up close, so dashes stay crisp.
  - Each player's line runs one texel (0.5 m) inside its own cells, wherever a 4-neighbour is not its own; map edges get no line. P1 is solid, P2 is dashed (2 texels on, 2 off).
  - It is repainted with each field frame and toggled with the territory layer (`client/src/render/frontier.ts`, unit-tested).
- **Consequences:** where the players touch, the two lines run side by side, blue solid next to orange dashed. That border reads without colour.

## D-044 · 2026-09-29 · Field-frame repaint budget and fps readout (M2 perf)
- **Status:** accepted
- **Context:** A cap-bound late game at 256² (≈16k L1, 3.6k L2, 2.4k L3 cells over both players; ≈77k plant models) cost ≈97 ms of plant layout on the main thread per field frame (1.25 Hz), a visible hitch. Measured in Node:
  - decode: 1 ms;
  - live census: 12 ms;
  - frontier: 8 ms.
- **Decision:**
  - `place` skips empty strata (no shuffle); the full layout plus instance writes drops to 41 ms.
  - The viewer caches each cell's layout, keyed by its three cover bytes, and recomputes it only when they change. Steady-state repaint: 5 ms for 77k models.
  - Instance matrices and colours are written in place with no allocation. Only the instances in use are uploaded (`addUpdateRange`), not the full-map capacity (≈40 MB).
  - Single-pass live census; the frontier skips interior cells.
  - The playback strip shows the fps and the worst frame over the last 0.5 s, plus the render backend, for the D-040 check on the reference laptop.
- **Consequences:** A frame where many cells change cover at once (early growth) can still cost up to ≈40 ms. If the laptop shows hitches, the next steps are spreading the repaint over several frames or moving the layout to the worker.

## D-045 · 2026-09-29 · Plant caps are a share of the map (fixes the growth cliff)
- **Status:** accepted
- **Context:** The user saw plant growth "hit a cliff" around 10 minutes, and new patches stop spreading. Cause: plant caps were absolute cell counts written for the 64² prototype map, where grasses' 2000 cells was half the map. On a 256² map, grasses reached 2000 cells about 4 minutes into a live-like run and froze. Territory then crawled on lichen alone (+25 cells per minute), and any later grasses patch could not gain a cell.
- **Decision:**
  - The flora `cap` in `species.toml` is a share of the map's cells per player, in (0, 1]. The old values were converted at 64² scale (cells / 4096, rounded): 2000 → 0.5, 800 → 0.2, 600 → 0.15, 400 → 0.1.
  - It is converted to Q16 at load, and the cell cap is `div(cap × n², ONE)` with the §4 rounding, identical in the prototype and `sim-core` (parity fixture regenerated, exact).
  - Animal caps stay head counts.
  - The UI shows plant caps as "% of map".
- **Consequences:**
  - The same live-like run now grows territory steadily until the fronts meet: 2,159 cells at 4 min, 12,404 at 10 min, 28,693 at 20 min on 256².
  - Rule tests on tiny maps use `tests/helpers.py::uncapped()`; the cap rule keeps its own test.

## D-046 · 2026-09-29 · Biomass bank and income in sim-core
- **Status:** accepted
- **Context:** The live match showed "Biomass stock 0 +0/s". The economy only existed in the Python prototype (D-027); sim-core had none.
- **Decision:**
  - `sim-core/src/economy.rs` keeps a Q16 bank and income per player. After each flora tick, the income is Σ over the player's cells of `yield × min(biomass / k_max, 1)` per second, as in the prototype's `Economy.income`.
  - The bank gains one flora period of it (`income × flora_every / tick_hz`, with the §4 rounding).
  - Bank values are hashed every tick. The start budget and the yields are in the balance hash (`BALANCE_HASH_VERSION` 2). `sim-wasm` exposes `bank(p)` and `income(p)` for display.
  - Spending is not ported yet (planting stays free, D-042): unlock and spawn costs come with the M4 economy.
- **Consequences:** The HUD stock and rate work in the live match. There is no parity test against the float prototype economy; the rule is simple and has its own unit test.

## D-047 · 2026-09-29 · 128² map of 4 m cells (supersedes the cell size of D-040)
- **Status:** accepted (user request: "the game play is too slow")
- **Decision:**
  - The grid goes from 256² to 128² and a cell from 2 m to 4 m; the map stays 512 m across.
  - The flora rules are per cell, so every front now moves twice as fast in metres, and the sim does a quarter of the work (≈3 ms per tick average).
  - More models per cell: up to 10 herb dots, 5 shrub cones and 3 tree cubes, on 4×4, 3×3 and 2×2 slot grids (was 5, 3 and 2). The no-overlap test still covers 4,000 cells.
  - Frontier overlay: 8 texels per cell (line 0.5 m, P2 dashes 2 m).
  - Animal speeds in `species.toml` stay in cells per second, so animals also get twice as fast in metres, which fits the faster pace. Q-008's speeds (D-040) are to be re-read at the fauna port (M3).
- **Consequences:** The perf target (D-040) now applies at 128². Worst-case plant instances on a fully covered map: ≈295k (18 per cell).

## D-048 · 2026-09-29 · Game HUD style and species icon slots
- **Status:** accepted (user request: "more video game like and less corporate dashboard like")
- **Decision:**
  - Theme: dark translucent panels with a thin gold trim and drop shadow over the diorama; bold tabular numbers; small caps labels; game buttons with a gold hover glow; dark thin scrollbars. Tokens are in `app.css`.
  - Top bar: brand and player switch on the left; a resource capsule in the centre (icons, land with a P1/P2 tug-of-war gauge, species, biomass and income); tech tree, source and layers buttons on the right.
  - Bottom: a portrait panel (icon, name, 2×2 stats, effect) and square tile cards (icon slot, name, count badge in the player colour, gold glow when armed for planting). A floating playback capsule sits above them.
  - The tech tree and the cell inspector use the same style.
  - Species icon slot (`SpeciesIcon.svelte`): loads `public/icons/species/<name>.webp`, falls back to the glyph on a stratum or role colour, and remembers missing files for the session.
- **Consequences:** Adding a species icon needs no code, only the file. The HUD covers more of the screen bottom (168 px); the camera still pans under it.

## D-049 · 2026-09-29 · 64² map (a 256 m map of 4 m cells)
- **Status:** accepted (user request: "the map is too big, divide it by two")
- **Decision:** The grid goes from 128² to 64²; cells stay 4 m, so the map is 256 m across (a quarter of the area). Plant caps are map shares (D-045), so they scale with it. The live opening scales its offsets with n.
- **Consequences:** Fronts meet sooner and the whole map fits one screen. The per-tick sim cost drops about 4×, which leaves room for the fauna port.

## D-050 · 2026-09-29 · Herbaceous line-up: lichen & moss, grasses, ferns; wildflowers, nettle, bramble
- **Status:** accepted (user decision); tier placement of the three intermediates is a default, see Q-016
- **Decision:**
  - L1 tier 1, the pioneers (free at start, establish on bare soil): `lichen_and_moss` (merged; shade-tolerant, fastest soil gain), `grasses`, `ferns` (now a pioneer, cap 0.3).
  - Tier 2: `wildflowers` (best L1 income) and `nettle` (grazed only by caterpillars).
  - Tier 3: `bramble` (thorny refuge).
  - Clover and separate moss are removed.
  - Fauna diets and habitats follow: slugs eat lichen & moss, grasses, ferns and wildflowers; grasshoppers, voles and rabbits eat wildflowers instead of clover; caterpillars eat and live in nettle; pill bugs live under lichen & moss or ferns.
  - "_and_" in a species key shows as "&" in the UI.
- **Consequences:** gamerules §4.2 and §5 are updated. Scripts, tests and fixtures use the new names; the parity fixture was regenerated and stays exact. The overyielding test threshold is now 1.1: the theory gives ×1.17 with wildflowers (k_max 6000), against ×1.25 with clover.

## D-051 · 2026-09-29 · Ground colour follows soil development
- **Status:** accepted (user request: "subtle color changes given the soil status")
- **Decision:** Each cell's ground texel blends from bare, pale earth (`WORLD.soil`) to dark humus (`WORLD.soilRich`) with its soil development (0–255, already in every field frame). The territory tint (35 %) goes on top, so succession stays visible under both players' land. The function is `soilColor` in `palette.ts`, with a unit test.
- **Consequences:** No extra data or sim cost; it repaints with each field frame (1.25 Hz).
