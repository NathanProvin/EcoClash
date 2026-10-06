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

## D-052 · 2026-09-29 · Animals in sim-core and the live match (M3 start)
- **Status:** accepted
- **Decision:**
  - `sim-core/src/fauna.rs` ports the prototype's fauna rules (D-023, D-026; `tools/prototype/fauna.py`). At each flora tick, before the flora step (which then settles ownership of cells grazed bare):
    1. upkeep;
    2. feeding on the current cell: herbivores graze the richest diet species (enemy flora at a full bite, own flora at `own_graze`, pro rata when a stock runs short); decomposers turn litter into soil; predators kill one huntable enemy prey in their cell (not in a refuge);
    3. starvation, where the carcass becomes litter;
    4. reproduction, under the species and player caps;
    5. new targets: flee the nearest hunter within `flee_radius`; else seek food in sight (grazers skip overcrowded cells); else wander.
  - **Differences from the prototype, on purpose:**
    - Animals walk every tick toward their target, at `speed` cells per second, in Q16 cells (the prototype jumped once per flora tick). The per-axis step keeps it integer-only, with no square roots.
    - Wandering draws from the world's PCG32. The port is therefore behaviour-equivalent, not bit-exact; the prototype stays the design reference.
  - **Units:** `speed` in species.toml is cells per second; `growth` is seconds between births; bites and upkeep are converted per flora tick.
  - **Spawning** is a `spawn` command `{species, row, col}` with the gamerules §6.3 rules: own habitat required; predators land on the enemy prey nearest the click; herbivores need enemy diet flora within `herbivore_range` of own land and land on the own habitat cell nearest it; decomposers land on the own habitat cell nearest the click. Cards spawn `group` animals at half energy.
  - **Free for now:** spawning is free and every species is available, as with planting (D-042); costs and unlocks come with M4 spending.
  - **Notices:** an order that does nothing (spawn refused, or nothing planted) adds a notice (player, text). Notices are drained by the UI and are not part of the state hash.
  - **Hashing and income:** agents are hashed every tick; the fauna parameters are in the balance hash (version 3). Animal yields count in the income.
  - **Renderer frame:** the replay record layout with sub-cell positions (1/256 cell). The worker sends it every loop as a transferable buffer; the client keeps the last two frames and interpolates between them.
  - **UI:** the live bottom bar has Plants / Animals tabs. Clicking a card arms it, and the next map click plants or calls it. Notices show for 5 s.
  - **Not yet:** ids are sequential and never reused, with no generation counter, until orders need to hold references. There are no player orders for animals yet (they act on their own), and no flow fields.
- **Consequences:** `npm run wasm:check` now includes spawn orders, so native and WASM agree on animal behaviour too. A seed-7 run has 145 animals at 2 min and 300 at 10 min (both earthworm caps reached).

## D-053 · 2026-09-29 · Player orders for animals (M3)
- **Status:** accepted
- **Decision:**
  - The `order` command `{ids, kind, row, col}` has three kinds (gamerules §9):
    - `move`: walk to the cell, ignoring food and hunters, then act on its own again;
    - `attack`: walk to the cell, seeking only enemy food or prey in sight on the way, then act on its own;
    - `stop`: halt now and act on its own.
  - The order takes effect at once (the target is set immediately). Only the commanding player's animals obey; unknown ids are ignored. An order is stored per agent (kind and goal) and hashed.
  - Animals under orders do not flee. They still feed on the cell they stand on at each flora tick.
  - Ids only grow and are never reused, and the agent list keeps creation order, so it is sorted and orders look ids up by binary search. No generation counter is needed.
  - There are no flow fields: the V1 terrain has no obstacles, so straight lines reach every cell. Flow fields come with obstacles.
  - **Controls:**
    - A left click or drag selects own animals. A right-click orders a move, or an attack-move on an enemy cell (enemy land or enemy animals). A right-drag still pans.
    - A + click is an attack-move; S stops.
    - Shift or Ctrl + 1–9 assigns a control group and 1–9 recalls it. Chrome keeps Ctrl + 1–8 for its tabs; Ctrl will work in the Electron build.
    - Arrows pan: WASD is dropped because A and S are orders in the gamerules controls table.
  - While animals are selected, species cards filter the selection instead of arming a spawn.
- **Consequences:** Fog of war (Q-007) stays at its default, none, which needs no code. The proptest streams include orders with random, enemy and unknown ids. The budget check is met: ≈1.0 ms per tick on average with 1,500 animals on a full 64² map (native release).

## D-054 · 2026-09-29 · Flat diorama ground (M2 terrain)
- **Status:** accepted (user choice: V1 stays flat, gamerules §2.3)
- **Decision:**
  - The ground keeps its per-cell texture (soil development and territory tint). A TSL colour node multiplies it by two-scale noise (`mx_noise_float` at 0.35 and 2.1 cycles per metre, ±6 % and ±4 %), so the earth never looks flat-shaded.
  - The map sits on a slab, `SLAB_DEPTH` = 12 m. Its sides show an earth cross-section: topsoil, subsoil, then bedrock, with a little noise (`palette.ts` `earthTop` / `earthSub` / `earthStone`). The slab has no top face, because two coplanar faces z-fight.
  - The default camera frames the whole slab above the bottom HUD. The fog now starts past the slab (2.2× to 5× the map size).
- **Consequences:** Terrain relief, water and soil types stay post-V1, as data and a map generator (gamerules §2.3). Picking, the frontier overlay and the models are unchanged (top at y = 0).

## D-055 · 2026-09-29 · Instanced grass replaces the L1 placeholder dots (M2)
- **Status:** accepted (user choice)
- **Decision:**
  - The herbaceous stratum (L1) is drawn as GPU grass (`client/src/render/grass.ts`): one merged static mesh of tufts of 3 blades (≈0.3–0.55 m high), jittered in their cell with `layout.rand`, 12 tufts per cell by default.
  - The vertex shader reads `floraTex` (n × n RGBA, repainted with each field frame: RGB = owner's L1 colour, A = L1 cover) at each tuft's root. A tuft shows when its seed is below the cover, so density follows cover; hidden tufts collapse to a point. There is no per-frame CPU work.
  - Normals point up and each blade is indexed with both windings, so grass lights like the ground under it on both faces.
  - L1 dots are no longer laid out or drawn (the viewer passes L1 cover 0 to `plantLayout`). The L1 layer toggle shows or hides the grass. Shrub cones and tree cubes are unchanged.
- **Consequences:** Seen from the whole map, grass reads as a fine grain over the territory tint; up close, as tufts. Wind sway is M5 (shader priority 1). `grassBlades` has unit tests: counts, roots inside their cell, determinism, seed range.

## D-056 · 2026-09-29 · Minimal quality presets (for the M2 perf check)
- **Status:** accepted (user choice: presets now, not in M5)
- **Decision:** `client/src/render/quality.ts`: Low / Medium / High set the grass tufts per cell (6 / 12 / 24) and cap the device pixel ratio (1 / 1.5 / 2). The preset is chosen in the Layers menu and remembered in `localStorage` (guarded: a blocked store falls back to Medium). Switching rebuilds the grass mesh and resizes the renderer.
- **Consequences:** The D-040 targets (60 fps on Medium, 30 on Low) can now be checked. Shadows and post-processing join the presets in M5.

## D-057 · 2026-09-29 · Main menu (M4)
- **Status:** accepted (user request)
- **Decision:**
  - The app opens on a main menu (`client/src/ui/MainMenu.svelte`): the title and tagline in a HUD panel over a painted placeholder background (sky gradient and rolling hills in CSS).
  - An image dropped at `client/public/menu/background.webp` replaces the placeholder, with no code change.
  - Buttons: "Launch game" starts a live match. "Species" (a catalog of every species) and "Options" (player settings) are shown disabled, marked "soon", as the user plans them for later.
  - In a game, a Menu button in the top bar ends the match (worker and viewer disposed) and returns to the menu. Game keys are ignored while the menu is open.
- **Consequences:** Replays stay reachable from the top-bar source menu once in a game.

## D-058 · 2026-09-29 · Spending: unlocks and costs in sim-core (M4)
- **Status:** accepted
- **Decision:**
  - `sim-core/src/economy.rs` ports the prototype's spending rules (D-027, D-029). Each player has an unlocked flag per species (plants, then animals); species with unlock cost 0 start unlocked.
  - A new `unlock {species}` command pays the unlock cost. It needs one unlocked species on the previous tier of the same tree and level and, for an animal, one unlocked habitat plant.
  - Planting a locked species is refused with a notice. Otherwise the order plants cell by cell, paying `spawn_cost` per cell planted, and stops when the bank runs dry.
  - A spawn pays `spawn_cost` per animal, times `drop_surcharge` (1.5) for a predator landing outside own land, with fewer animals if the bank cannot pay for the whole card. `Fauna::spawn` is split into `spawn_site` and `place` so the world can charge in between.
  - The unlocked flags and the bank are in the tick hash; costs and the surcharge are in the balance hash (version 4).
  - **Sandbox:** a world flag (in the tick hash) makes everything unlocked and free. It is used by `sim-cli --sandbox 1` (the prototype cross-check), the native-vs-WASM check, the timing tests, and the client's `?sandbox=1`.
  - **Match setup:** `World::setup_plant` plants the starting patches for free before the first tick. It is not a player action; every peer runs the same setup.
  - **Client:** the worker sends each player's unlocked flags every tick. In a live match, bottom-bar cards are unlocked (arm them), available ("Unlock · cost": a click buys it) or locked (dimmed, with the reason in the tooltip). The tech tree has Unlock buttons on available cards.
- **Consequences:** The Python prototype keeps its own float economy (no parity requirement for the economy). A measurement note: the timing test ran ≈2× slower this session on both the new and the old commit, so machine state, not code; D-053's figures are the reference.

## D-059 · 2026-09-29 · Victory conditions and end screen (M4)
- **Status:** accepted
- **Decision:**
  - **In sim-core:** after every flora tick, `World::judge` follows the prototype's `Economy.winner` and gamerules §11.3.5:
    - a player owning at least the territory threshold of the map wins at once (`[match] victory_territory`, 60 %; optional linear decay from `territory_start` to `territory_end`, `[Proposed]` switch off);
    - otherwise, at `time_limit_s` (20 min), the highest standing biomass wins (plant biomass of own cells plus animal bodies), then the larger territory, else a draw.
  - The verdict (`World::result`: winner, reason, tick) is in the tick hash; the victory values are in the balance hash (version 5).
  - The world keeps running if stepped; the worker stops stepping at the verdict.
  - **`sim-wasm`:** `result()` (JSON) and `standing(p)`. The live source records `t_s` and `standing_p*` series per field frame.
  - **End screen:** Victory, Defeat or Draw for the human (P1), with the reason and match time; charts of territory (% of the map) and standing biomass over time for both players; buttons Keep watching and Main menu.
  - **Charts** (`LineChart.svelte`, per the dataviz rules): one measure per chart, a legend, direct end labels nudged apart when close, a recessive grid, and a hover crosshair with a tooltip.
  - **Chart colours:** P1 `#0072B2` and P2 `#C28000`, one step deeper than the game orange so it fits the dark-mode lightness band. Validated on `#18211c`: CVD ΔE 23.7, contrast ≥ 3:1. P2 is dashed.
- **Consequences:** An idle match is a mirror, so it ends in a draw at 20:00 (checked in the browser). The bot (next) breaks the symmetry.

## D-060 · 2026-09-29 · Scripted bot opponent (M4)
- **Status:** accepted
- **Decision:**
  - The new `sim-ai` crate provides `Bot::think(&World) -> Vec<Payload>`. It only reads the world; the host submits its commands through the normal queue for the current tick (D-014), so bot matches replay and verify like any other.
  - **Difficulty** is reaction time and actions per decision: Easy decides every 6 s with 1 action, Normal every 3 s with 2, Hard every 1.5 s with 3.
  - **Each decision** tries a rotating list of plays and keeps the first that apply:
    - unlock the next species of a fixed plan (meadow income, then succession, then the food web);
    - plant the best unlocked spreader on the free cell next to own land nearest the enemy;
    - plant the tallest unlocked shrub or tree on an own cell whose soil suits it (suitability ≥ ½), nearest the enemy;
    - call decomposers (up to 8), herbivores (up to 12) and predators (up to 3, on the enemy prey nearest home);
    - every fourth decision, attack-move own herbivores to the enemy land nearest home.
  - There is no randomness. Its refusals leave notices like a player's, and the UI shows only the human's.
  - `sim-wasm` gets `addBot(player, level)`; bot sequence numbers start at 2³⁰ so they never collide with the host's.
  - **Client:** "Launch game" plays against a Normal bot on P2 (`?bot=easy|hard|none` to change). The human always commands P1; viewing P2 is read-only.
  - **Tests:** the bot outgrows an idle player with no rejected commands and unlocks cards; bot-vs-bot matches replay identically. An ignored `bot_report` test plays Normal vs Hard for 20 minutes and prints the outcome.
- **Consequences:** Measured: Normal vs Hard ends near-even at 20 min (1,955 vs 2,086 cells). In the browser, an idle human loses to the Normal bot (P2 53 % of the land). Balance tuning stays deferred (Q-013).

## D-061 · 2026-09-29 · Herbivore drops, the ×1.5 surcharge for every role, calmer own-land herbivores
- **Status:** accepted (user decision)
- **Context:** Only predators could land outside own land, so the ×1.5 drop surcharge never applied to herbivores, and caterpillars could not be sent onto an enemy tree or nettle patch. Herbivores also needed enemy food within 10 cells of own land before they could be called at all, and they went for enemy flora first.
- **Decision:**
  - Every animal landing outside own land costs `spawn_cost` × `drop_surcharge` (1.5), whatever its role.
  - **Herbivores clicked on own land:** they land on the own habitat cell nearest the click, at base price, with no trigger (the `herbivore_range` rule is gone from sim-core; the key stays for the Python prototype).
  - **Herbivores clicked elsewhere:** they are dropped on the not-own cell with their diet flora nearest the click, within the new `[fauna] drop_radius` (4 cells). Otherwise the spawn is refused with "no food it eats near that spot".
  - **Predators:** dropped on the huntable enemy prey nearest the click within `drop_radius` (gamerules `r_prey`; before, prey anywhere counted).
  - **Behaviour:** a free herbivore seeks the nearest food on any land, with no enemy-first preference. It keeps the reduced own-flora bite (`own_graze`), its passive yield and its breeding. Dropped raiders feed where they land; attack-move still hunts enemy food only.
  - **Bot:** it calls herbivores and decomposers on its own land, near home, and drops raiders (`drop_raiders`: the most advanced unlocked herbivore with food on enemy land, onto the enemy food nearest home).
  - `FaunaParams::eats_plant` is public for the bot. Balance hash version 6; parity fixture regenerated.
- **Consequences:** gamerules §5.2 and §6.3 and INSTRUCTIONS §5.4 are updated. Tests cover own-land calls without enemy food, drops on food, refused drops, the predator radius, no enemy-first seeking, and the ×1.5 charge. Checked in the browser: voles dropped on P2's meadow landed there.

## D-062 · 2026-09-29 · Lockstep smoke test: relay, client core, two tabs (M3.5)
- **Status:** accepted
- **Decision:**
  - **Relay** (`relay/server.mjs`, Node + `ws`): one room of two players. It seats them (P1, P2) and sends the match seed and the `[net]` rules (`input_delay_ticks`, `hash_every_ticks`, read from balance.toml). It collects each player's turn per tick and broadcasts the tick's bundle once both are in. It compares the hashes both report every `hash_every_ticks` ticks; a mismatch is broadcast as a desync with its tick. It never simulates.
  - **Client core** (`client/src/net/lockstep.ts`, pure, erasable TypeScript so Node runs it directly): tick t runs only with its bundle, and every client submits the bundle's commands with the same (tick, player, seq).
    - After tick t, the client sends its turn for t + delay; the first `delay` turns go out empty.
    - While a bundle is missing the sim waits (stall), and the HUD shows "Waiting for the other player…".
  - **Browser:** `?relay=ws://…` makes Launch game join the relay. The worker gets the seed and its seat from the relay, runs one tick per 10 Hz loop, and sends its player's orders as turns. Pause and speed do not apply. The human commands the seat the relay gave.
  - **Test** (`npm run relay:test`, in CI after `wasm:check`): two headless players (sim-wasm + Lockstep) play 5 minutes with plants, unlocks, spawns and orders on both sides. They must have identical hashes at every tick and no desync, with the orders visibly applied. A second match makes one player submit a command outside the relay; the relay reports the desync at the next hash check.
  - **Dependency:** `ws` 8, the standard Node WebSocket server (Node has a client, not a server).
- **Consequences:** Checked in two browser tabs: the players were seated P1/P2, an unlock and a spawn applied on both sides, and 56 hash checks were in sync; the faster tab waited for the slower one. M6 keeps deployment, lobby and handshake, the stall timeout, disconnect rules, replays and state dumps.

## D-063 · 2026-09-29 · Build card, species tooltips, leave confirmation (feedback round 1)
- **Status:** accepted (user feedback)
- **Decision:**
  - The bottom bar is a compact RTS build card: every species as an icon tile, in two rows (plants; animals), grouped by family in tier order: Herbs, Shrubs, Trees; Soil life, Insects, Small mammals, Birds, Carnivores (`families` in `species.ts`).
  - Count badges; "+" on cards that can be unlocked (a click buys them); dimmed locked tiles. The Plants/Animals tabs and the bottom-left detail box are gone.
  - Hovering a tile shows a tooltip just above it: name, tier and role, stats (`statLines`), effect, and what a click does (unlock cost, why it is locked, or "click, then the map · hold Shift to keep dropping"). Shift serial drops already worked; they are now stated where they matter.
  - With animals selected, a small strip above the card shows them by species (a click narrows the selection), the order keys, and a clear button.
  - The in-game Menu button asks "Leave the match? It will be lost." (Stay / Leave; Esc stays) while a live match is on; it leaves at once after the verdict or in a replay.
- **Consequences:** No text labels on tiles (names are in the tooltip), which keeps the bar short and fits more RTS spirit.

## D-064 · 2026-09-29 · Calm translucent HUD, decluttered (feedback round 1)
- **Status:** accepted (user feedback: "more soft, blurry, translucent and calm; remove bloating text or buttons")
- **Decision:**
  - Theme tokens (`app.css`): light panels (`--panel` at 40 % over the scene) with `backdrop-filter: blur(18px)`, a thin light border instead of the gold trim, pill buttons, softer ink and accent colours, lighter label weight.
  - Top bar: one centred resource capsule (land with the tug gauge, species, biomass and rate; no text labels, tooltips carry the names). Three round icon buttons on the right: tech tree, view and display, menu. The quality preset, viewed player, replay source and performance readout moved into the view and display menu.
  - Time controls: a small clock pill at the top left in a live match (play/pause, clock, speed; "slowed" only when the sim lags). Replays keep a slim scrubber above the build card. Sim ms and fps show only with the performance readout on (off by default).
  - The idle controls hint is gone. A hint shows only while something is armed (planting, calling, attack-move). The order keys live in the selection strip.
- **Consequences:** The HUD look in INSTRUCTIONS §8 changes from "dark panels with a gold trim" to translucent frosted panels.

## D-065 · 2026-09-29 · Organic animal movement; insects and soil life as swarms (feedback round 1)
- **Status:** accepted (user feedback: "avoid grid like and straight lines, introduce some noise, some brownian motion"; "insects and recyclers can stay as faint dots … from the vole size we want to control")
- **Decision:**
  - Steering (`Fauna::walk`): each tick an animal moves at its speed straight toward its target, in any direction (integer `isqrt`), instead of per axis (which gave 45° then straight paths).
  - Brownian drift: per-animal drift `(wy, wx)` (hashed state). Each tick it keeps `wobble_keep` of itself and gains a uniform kick of ±`wobble` × speed from the world PCG32: a discrete Ornstein–Uhlenbeck walk, so paths curve and idle animals shuffle. Positions stay on the map.
  - Scattered targets: food and order targets sit at a fixed per-animal offset (±`scatter` cell, id hash, no RNG) around the cell centre, so a group spreads in the cell. Idle animals stroll to a random point within `wander_radius` cells instead of a neighbouring cell centre.
  - New `[fauna]` keys: `wobble`, `wobble_keep`, `scatter`, `wander_radius`, validated. Balance hash version 7.
  - Client: fauna levels 1–2 (soil life, insects) are swarms (`isSwarm`, `species.ts`), drawn as small faint dots, not selectable. From small mammals up, animals are units. Every animal is drawn at its own sub-cell position (plus a fixed id offset for replays), with no slot grid.
- **Consequences:** The native/WASM check and the prototype CLI parity still pass (the prototype has no movement to match). Sizes and models per type come with the model pass.

## D-066 · 2026-09-29 · Food-limited carrying capacity, hunting success, feeding at home (feedback round 1)
- **Status:** accepted (user feedback: "introduce an environmental load, capacity, over which the population stop growing, and it depends on the amount of food source available in neighboring cells … emerging food prey dynamics … like the Lotka Volterra equations"; answer: food rules, with the caps kept as a safety ceiling)
- **Decision:**
  - **Local carrying capacity** (`Fauna::reproduce`): a ready animal gives birth only if the food within its sight (square window, 2D prefix sums) covers the load of every rival, plus its young born this tick, plus itself.
    - Rivals are animals of the same role with an overlapping diet. Grazers and decomposers count both players (same plants, same litter); predators count their owner's predators only.
    - Each rival needs `food_reserve` seconds of its bites, or `prey_per_predator` huntable enemy prey.
    - The per-player budget and the species caps stay as ceilings. Fauna caps are doubled so food binds first more often.
  - **Hunting:**
    - A predator catches prey within `strike_radius` cells (it was: same cell only, which almost never happened with moving prey), with chance `catch_chance` per flora tick (one RNG draw).
    - A predator at full energy is sated and does not hunt (a handling limit). Without these, three foxes wiped out 60 voles in 40 s.
  - **Grazing at home:** own plants are still bitten at `own_graze`, but they give the energy of a full bite. Before, the energy gained was below upkeep for every herbivore (voles 1.44 against 2.4 per flora tick), so herbivores at home slowly starved and never bred, against D-061.
  - New `[fauna]` keys: `food_reserve` 900 s, `prey_per_predator` 4, `strike_radius` 1, `catch_chance` 0.5. Balance hash version 8.
- **Evidence:** `lotka_volterra_report` (ignored test, `sim-core/src/fauna.rs`): a 64² meadow with every cap lifted.
  - Voles alone grow logistically to about 1,450, a food limit.
  - With five foxes and bramble refuges (capped at 3 % of the map), seeds 2 and 3 show a cycle: voles peak at about 1,200, foxes rise to 10–13, voles fall to about 550 and are held there by the refuges, then the foxes crash.
  - In seeds 1 and 4 the foxes starve before the voles are dense enough (a small-population Allee effect).
  - Uncapped bramble spreads over the voles' whole land and hides every vole, so the foxes starve: the refuge rule as designed.
- **Consequences:** In bot-vs-bot matches, earthworms and voles still reach their (doubled) caps: litter and a full map feed more than the ceilings. Setting the magnitudes (`food_reserve`, caps, predator upkeep versus catch rate) is balance work for M7.

## D-067 · 2026-09-29 · Plants with depth: species forms, natural colours, mixed stands; stronger ground (feedback round 1)
- **Status:** accepted (user feedback: "the scale of the models … seems flat, satellite view like … greatly increase the size of the models, while keeping the overlapping issue controlled … avoid invasion of only oaks … keep some room for other trees … natural, organic feeling"; "add texture and color that are more pronounced" to the ground; answer: natural colours, subtle player tint)
- **Finding (oaks):** the sim already lets same-tier species share a cell (`niche_overlap` 0.5 gives about ⅔ cover each at equilibrium), and oak is capped at 10 % of the map per player. The oak monoculture was a rendering artefact: every tree was the same player-coloured cube, drawn from the stratum's total cover. No sim change.
- **Decision (renderer only):**
  - Per-species models: a cell's model slots are shared among the species present in proportion to their cover (largest remainder, `share` in `layout.ts`), so mixed woods and thickets show each species.
  - Trees: a tapered trunk (1.6–2.6 m) and low-poly flat-shaded crown blobs, 0.9–1.4 m radius (≈3 m wide in a 4 m cell), up to 2 per cell. Crowns may overlap at different heights, like a canopy; trunks stay ≥ `TRUNK_GAP` (1.5 m) apart, so no two crowns merge.
  - Shrubs: 2–3 blob clusters, up to 4 per cell, kept clear of trunks.
  - Forms per species (`FORM`): oak broad, beech tall oval, chestnut round; elder loose, hazel upright, hawthorn compact.
  - Colours (`palette.ts` `FLORA`): each species' natural colour, mixed with 15 % of its owner's hue (`PLAYER_TINT`); per-model brightness variety. Ownership reads from a lighter ground tint (15 %, was 35 %) and the frontier line.
  - Grass blades take the cover-weighted colour of the cell's herbs.
  - Ground: darker humus for developed soil, three noise scales (patches, clods, grit) and darker, warmer patches.
  - Camera: the tilt limit goes from 1.05 to 1.2 rad, for a lower diorama view.
- **Consequences:** Instances per full cell: at most 12 bush blobs, 6 crown blobs and 2 trunks (icosahedron detail 1 = 80 triangles per blob). The fps check on the reference laptop should be redone.

## D-068 · 2026-09-29 · Animal models per body type, player rings (feedback round 1)
- **Status:** accepted (user feedback: "from the vole size … the models must seem realistic, in size and behavior … the animal models must harbor their player color … and keep the model shape depending of the type of animal"; answer: realistic, plus a player-coloured ring)
- **Decision (renderer only, `client/src/render/animals.ts`):**
  - Six low-poly bodies, merged from a few primitives and flat shaded: rodent (voles, moles), hedgehog, rabbit, canid (fox), cat (lynx), bird (tits, woodpecker, tawny owl, buzzard). Unknown species fall back by role.
  - Real lengths (vole 0.12 m … lynx 1 m) in natural colours, all drawn ×`ANIMAL_SCALE` (2.5), so proportions between animals stay true and a vole still shows next to a 3 m crown.
  - Animals stand on the ground and face the way they go (the heading holds while they stand still). Birds fly at `FLIGHT_Y` (5.5 m, above the canopy) with a slight bob.
  - Every controllable animal stands on a ring in its owner's colour (predators in the vivid predator tint), radius max(0.45 m, 0.75 × drawn length). A selected animal's ring turns white. Picking aims at the model's height.
  - Soil life and insects stay faint dots (D-065), now in the herbs (0.15 m) instead of floating at 2.6 m.

## D-069 · 2026-09-30 · Ecology pace 0.4 (feedback round 2)
- **Status:** accepted (user: "the rhythm is too fast, reduce the base game speed [to] 0.4x current rate"; answers: 0.4×, ecology only)
- **Decision:**
  - `[sim] pace = 0.4`: seconds of ecology per real second. `Balance::flora_dt()` returns the real flora period × pace, and every ecological rate is converted with it: growth, spread, soil, bites, upkeep, breeding, `food_reserve`.
  - Income: the economy multiplies by pace, so `income` is per real second and the bank follows.
  - Unchanged: animal movement and drift (per real tick), the 10 Hz tick, the match clock and the 20 min time limit. Orders stay responsive.
  - The prototype splits `step_s` (real) from `dt` (ecology). Flora parity stays exact (fixture regenerated).
  - The client gets `pace` from `sim-wasm`; card tooltips show real seconds (breed every growth / pace s, yields × pace).
  - Balance hash version 9. The relay test's second unlock moves to tick 2800 (income is slower).

## D-070 · 2026-09-30 · Map 43² (feedback round 2)
- **Status:** accepted (user: "the map is still a little too large, reduce it by 33%"; answer: side −33 %)
- **Decision:**
  - `grid_size` goes 64 → 43 (172 m). The loader no longer requires `grid_size` to be a multiple of `chunk_size`: edge hash chunks are partial, which the hashing and its test already supported.
  - Openings, flora caps (map shares) and the bot scale with `n`. The sim-ai test match, the relay test (openings at 10 and 32) and the prototype's default size follow the balance. The WASM parity check (64) and `cli:check` (48) keep their own sizes on purpose.
- **Consequences:** bot report at 43²: no errors; grasshoppers now appear next to earthworms. Budgets in INSTRUCTIONS §5.5 are restated at 43².

## D-071 · 2026-09-30 · Build bar by family with tier flyouts, unlock icon (feedback round 2)
- **Status:** accepted (user: "change the + sign … by an unlock icon … instant display the 3 tiers of species on hover of a generic species group item")
- **Decision:**
  - The build bar shows one item per family (Herbs, Shrubs, Trees │ Soil life, Insects, Small mammals, Birds, Carnivores). Each item shows:
    - its armed species, else its highest unlocked one, else the first;
    - the family name;
    - the group's count;
    - a padlock badge when a species of the group can be unlocked.
  - Hovering an item opens its flyout at once, with the species in Tier 1 / 2 / 3 columns. The tiles behave as before (arm, Shift to keep dropping, unlock, locked) and keep the stats tooltip. A 120 ms grace covers the gap; a click pins the flyout; arming or Esc closes it.
  - The "+" badge is an open padlock (`unlock` icon).
  - Fix: the tooltip was `position: fixed` inside the transformed dock, which placed it off-screen. It is now placed in the dock's coordinates.
- **Consequences:** The bar is one short row whatever the number of species per family. Hotkeys per family can come with M5 keybinds.

## D-069a · 2026-09-30 · Live matches start at 1×; pace back to 1.0
- **Status:** accepted (user, after the finding below: "Pace 1.0")
- **Finding:** `App.svelte` defaulted the playback speed to 4× for replays, and live matches inherited it, so every live match ran at 4×. The round-2 "0.4× the current rate" was relative to that.
- **Decision:** a live match starts at 1× and replays at 4×. `[sim] pace` is set to 1.0; the knob stays for tuning (M7). At 1×, the ecology now runs at 0.25× what the user played, and animals too.

## D-072 · 2026-09-30 · Progressive plant growth, sparser organic shrubs, render seams (feedback round 2)
- **Status:** accepted (user: "progressive growth of the plant models, instead of popping out of nowhere … efficient code and performance friendly, as well as modularity if later on we want to replace [them] with real animated 3D models"; "some shrubs are still quite grid like … reduce a little bit the density")
- **Decision:**
  - **Stable slots** (`layout.ts`): each cell has fixed model slots, whatever its cover.
    - Trunks: the jittered 2×2 grid.
    - Shrubs: deterministic dart-throwing, keeping `SHRUB_GAP` between shrubs and `TRUNK_CLEAR` from trunk slots. No grid; about 1 cell in 100 fits one shrub fewer.
    - Shrubs go from 4 to 3 per cell.
    - Cover decides how many slots are used and the size.
  - **Sticky species:** `assign` keeps each slot's species while that species still has a share, so mixed stands do not reshuffle.
  - **GPU growth** (`growth.ts`, `GrowingMesh`): keyed instances with two instanced attributes, the root point and (start, from, to). The material's position node scales each model around its root by a smoothstep over `GROW_S` (3 s), against a time uniform set once per frame.
    - New models grow in, resized ones ease to their new size, lost ones wither and are then freed by swap-remove.
    - Buffers upload only on change (field frames, frees), never per frame. A tree's parts share its trunk base, so the whole tree grows from the ground.
  - **Grass:** the last two flora textures blend over the time between field frames, so blades grow instead of snapping at 1.25 Hz.
  - **Seams:** `PlantStyle` (plants.ts; `LowPolyPlants` today) gives the meshes and parts of a model, and `PlantView` does the layout, stickiness and growth. `AnimalView` (animals.ts) draws animals. `viewer.ts` only orchestrates. Real glTF plants, wind and animated animals plug in behind these seams.
- **Consequences:** Checked in the browser: plants grow in, the forest renders, no console errors. New tests cover slots, spacing, stickiness, growth maths, swap-remove, resizes and revivals. The fps must be measured on the reference laptop: the browser used here throttles background tabs.

## D-073 · 2026-09-30 · Next directions: a playable alpha first
- **Status:** accepted (user approved the plan)
- **Context:** the core loop, map, renderer and a functional UI are done. Better models plug in through `PlantStyle` / `AnimalView`, though animated animals at scale need vertex-animation textures. Terrain has its hooks (gamerules §2.3). Balance has no data yet: no batch runs, no outside players.
- **Decision (milestone order):**
  1. **M5a**, a playable alpha for outside playtesters: fps gate, match setup and options screens, onboarding, sound, static deploy.
  2. **M7-lite**, the balance loop: bot-vs-bot batch runs and a report, plus the playtest feedback.
  3. **Content**: seeded terrain and map generator, biomes, new species. Retire the Python flora parity rule (D-034) first, to be decided then.
  4. **M5b**: the art pass.
  5. **M6**: online multiplayer.
  6. **M7**: balance at scale and `sim-py`.
- **Why:** real players and data before multiplayer and art; tuning without data is guesswork.

## D-074 · 2026-09-30 · No fog of war for now (Q-007)
- **Status:** accepted (user: "no fog of war yet")
- **Decision:** the full map is visible to both players and the bot. Fog of war is a post-v1 idea (INSTRUCTIONS §2.5). This matches lockstep, where every client holds the full state anyway.

## D-075 · 2026-09-30 · M5a scope: playability tools before sound
- **Status:** accepted (user)
- **Decision:**
  - Sound moves to M5b (art). M5a gains the playability tools:
    - **pressure borders:** frontier width shows each player's push, from the sim's own smothering term plus enemy grazing, derived and not hashed;
    - **notifications and pop-ups**, with varied raid alerts ("Enemy [species] incursion / attack / raid") and a map ping;
    - **toggleable strategic icons** over large groups of your animals;
    - **a drop cursor** showing the armed species' model; parachute drops as a stretch.
  - Keyboard shortcuts follow the printed letter (`e.key`), so AZERTY and QWERTY both work.
- **Consequences:** The detailed task list and order are in ROADMAP M5a. The fps gate passed: steady 60 fps on the reference laptop.

## D-076 · 2026-09-30 · Pressure borders
- **Status:** accepted (user: "a dynamically changing border width, depending of the strength of attack of the player in the local area")
- **Decision:**
  - `Flora::push` gives, per owned cell, the flora step's attack term: over the 4 neighbours held by the enemy, the best cover of an enemy species able to smother the cell (higher level than its dominant one, suitable there).
  - `snapshot::pressure_frame` adds a quarter of a full neighbour per enemy grazer on the cell, and maps 2 full neighbours to 255. Display constants live there.
  - The frame is derived and never hashed. `sim-wasm` exports `pressureFrame()`, and the worker sends it with each field frame.
  - `frontier.ts`: each player's line is 1–4 texels wide (0.5–2 m), from its push into the enemy cell across the edge. P1 solid, P2 dashed as before. Replays have no pressure and draw thin lines.
- **Consequences:** A test shows the push is positive exactly where the step smothers, and zero on same-level (frozen) fronts. In a bot-vs-bot report at 43², 227 cells are under push at the end, the strongest at 255.

## D-077 · 2026-09-30 · Notifications, raid alerts, pings
- **Status:** accepted (user: "alerts and notifications when a significant raid is launched against a player territory … vary the formulation … with a ping on the relevant location")
- **Decision:**
  - **Toast stack** (`ui/Toasts.svelte`): under the resource bar, soft and translucent, at most 4. Alerts last 8 s, other toasts 5 s. Clicking an alert flies the camera over its place (`Viewer.lookAt`). Order notices ("population cap reached"…) now go through it.
  - **Raids** (`game/alerts.ts`, `RaidWatch`, pure and tested), checked once a second on the drawn animals:
    - enemy animals on your land are grouped by 4×4-cell area and weighted (swarms 0.25, other animals 1, predators 3);
    - severities 2 / 6 / 15 give an incursion, an attack or a raid, worded in turn ("Enemy {species} incursion / foray / sighted…", "attack / assault / offensive", "raid! / major raid! / invasion!"), named after the group's main species;
    - an area and its neighbours stay quiet for 30 s unless the group gets worse, and the whole map raises at most one new alert every 5 s, the worst first.
  - **Lost ground** (`FrontWatch`): 6 of your cells taken by the enemy within 10 s raise "Losing ground to the enemy" (and variants) at their centre, at most once per 30 s.
  - **Infos:** "{Species} can be unlocked" when a card becomes both available and affordable.
  - **Pings:** three spreading rings at the place (`Viewer.ping`, alert colour `WORLD.alert`). While an alert shows, an arrow at the screen edge points to its place when it is out of view.
- **Consequences:** Checked in the browser against the hard bot: grasshopper raids, unlock infos, click-to-fly.

## D-078 · 2026-09-30 · Strategic icons
- **Status:** accepted (user: "a toggable strategic icons option … icons of the species overlapping the location of large groupements of your unit")
- **Decision:**
  - `game/groups.ts` (pure, tested) groups your animals per species: 5×5-cell areas, merged with touching areas of the same species. A group needs 3 animals, or 8 for a swarm.
  - `ui/StrategicIcons.svelte` puts a species icon with the head count over each group, at a fixed screen size (HTML over projected positions, refreshed about 10 times a second, hidden off-screen), with a player-colour underline.
  - Clicking an icon selects the group. Swarm icons only show, since swarms cannot be ordered.
  - Toggle: the I key, or "Strategic icons" in the view menu. On by default, remembered per browser.
- **Consequences:** Checked in the browser: 18 voles show one "×18" icon; a click selects all 18; I hides and shows the icons.

## D-079 · 2026-09-30 · Drop cursor
- **Status:** accepted (user: "the cursor changed into the model of the species when selected in the unit bar and ready to be dropped")
- **Decision:**
  - While a species is armed, the OS cursor hides over the map and `render/ghost.ts` shows a see-through copy of its model at the cell under the pointer. It uses the same `PlantStyle` parts and animal bodies as the scene: a tuft for herbs, a bush, a tree, an animal body.
  - A ring shows the landing:
    - plants: the plant disc (`plant_radius`, player colour);
    - animals on your land: the landing spot;
    - animals elsewhere: the drop area (`drop_radius`, now exported by `sim-wasm`), in the alert colour with a "×1.5" tag.
  - The model is enlarged to at least 2 % of the camera distance across, so a vole reads from the map view while a tree stays true to size up close.
- **Consequences:** Checked in the browser: oak and vole ghosts at map zoom, and the paid drop ring over enemy land.

## D-080 · 2026-09-30 · Parachute drops
- **Status:** accepted (user: "an animation where animals are dropped from the sky, like parachuted into the map")
- **Decision:**
  - The world records the id range each successful spawn command creates (`World::drops`, drained by `take_drops`, `sim-wasm` `takeDrops`). It is a view, never hashed, like the notices. Births are not drops.
  - The worker sends the ranges with each tick. `Live` remembers each dropped id's landing time for 5 s (`droppedAt`).
  - `AnimalView` lowers dropped animals from 10 m over 1.6 s (easing out), swaying, under a leaf-green dome canopy that vanishes on landing. Their ring on the ground already marks the landing spot. Swarm dots fall too, without a canopy.
- **Consequences:** Tests: the world records one drop per landed spawn and drains; `Live.droppedAt`; `AnimalView` shows a canopy mid-fall and the animal on the ground once landed. Native and WASM hashes are unchanged.

## D-081 · 2026-09-30 · Match setup, Options, Play again, victory-near alerts
- **Status:** accepted (M5a task 7, D-075)
- **Decision:**
  - **Main menu:**
    - "Play" opens the match setup: opponent (easy, normal or hard bot, or no opponent), map seed (typed or random), sandbox. It is remembered per browser (`game/setup.ts`).
    - URL parameters (`?bot=`, `?seed=`, `?sandbox=1`, `?relay=`, `?size=`) still override it, for development and the lockstep test.
    - "Options": quality, strategic icons, performance readout, and the list of shortcuts. Rebinding keys comes later.
    - "Species" (catalog) still to come.
  - **End screen:** "Play again" restarts with the same setup. The verdict now uses your seat (`me`), not always P1.
  - **Victory near** (`VictoryWatch`, tested):
    - an info toast when either side comes within 10 points of the winning share ("Victory in sight: you hold 52 % of the map (60 % wins)" / "The enemy nears victory…"), warned again only after it falls 15 points below;
    - "5 minutes left" and "One minute left".
    - `sim-wasm` exposes `victoryTerritory` and `timeLimitS`.
- **Consequences:** The seed only changes the match's randomness today; it becomes the map seed with the terrain generator (Content milestone).

## D-083 · 2026-09-30 · Map generator
- **Status:** accepted (user: "the terrain overhaul, with relief, rock obstacles, and water (river and ponds)"; answers: real obstacles, shallows crossable, relief shapes moisture, flat-map parity only)
- **Decision:**
  - `sim-core/src/terrain.rs` builds each match's map from its seed, on its own PCG32 stream (the world's random sequence is untouched), integer only.
  - **Relief:** three octaves of value noise.
  - **River:** along the anti-diagonal, so it runs between the two homes as the natural front line. It meanders, is `river_width` cells wide, and its cells are shallows with the odd deep pool at its centre (never across its whole width).
  - **Ponds:** `ponds` per half at the lowest land, deep in the middle from radius 2.
  - **Rock outcrops:** the top `rock_share` of the land by height plus a fine noise, so several clusters form on the high ground.
  - **Homes** are cleared (dry, rock-free, flatter).
  - **Valleys:** water beds sit at one level and banks rise from them.
  - **Connectivity:** every land or shallow cell is reachable on foot from the first home (a corridor is opened if needed, and cut-off pockets become rock).
  - **Moisture** (the flora `water` field) goes from `moisture_dry` on the highest ground to `moisture_wet` in the lowest land and next to water; water cells are full.
  - **Symmetry:** 180° rotational, so both homes see the same land.
  - `FloraState` gains `ground` (land, shallow, deep, rock) and `elevation`, both in the chunk hashes, so peers with different maps desync at once. The generator settings join the balance hash (version 10).
  - `World::new` stays flat, which keeps tests and flat-map parity exact. The game calls `World::generate_terrain` (`sim-wasm generateTerrain`, `sim-cli --terrain 1`; `wasm:check` runs with terrain on). `sim-wasm terrainFrame()` exports it for the renderer.
- **Consequences:** Tests: symmetry, determinism, homes clear, the river between the homes yet crossable, every walkable cell reachable, water and rock shares, moisture ranges. An ignored `map_preview` test prints maps. The rules (1b) and the look (1c) come next.

## D-084 · 2026-09-30 · Terrain rules and pathfinding
- **Status:** accepted (user: "Rocks and deep water block walking and planting; the river and ponds are shallows and allow crossing; plants can slowly disseminate; birds fly over; animals path around obstacles")
- **Decision:**
  - **Plants:** suitability is 0 on rock and deep water, so nothing is planted there, grows there or claims it. Shallows go through the water response: land plants now have `water_optimum` 0.5 (the flat map's moisture, so flat maps and Python parity stay exact) and `water_tolerance` 0.6. In full-water shallows they grow at about a sixth of the land rate, which is the slow seeping across the river.
  - **Animals** get a `medium` in species.toml (walk by default; swim, amphibious, fly), with a `stands(ground)` rule:
    - walkers: land and shallows, at `shallow_speed` (0.5) in shallows;
    - swimmers: water only;
    - amphibious: everything but rock;
    - fliers: anywhere.
  - **Pathfinding** (`pathing.rs`): each animal heads for a waypoint (new hashed fields `py`, `px`):
    - the target itself when the straight line is clear;
    - else the farthest of the next 6 cells of a bounded A* path (8 neighbours, no corner cutting, at most `path_cells` 400 cells explored);
    - routed again when a new target is set or the waypoint is reached;
    - with no path, the animal stays.
    - A drift step that would enter a blocked cell is dropped.
  - **Targets and spawns:** food, prey, flee and stroll targets, and spawn and drop sites, only use cells the species can stand on.
- **Consequences:**
  - Tests: walkers get around a rock wall through its gap and never stand on rock; swimmers stay in water; fliers cross rock; shallows halve walking speed; rock and deep refuse plants; shallows are slow, not closed; the pathing unit tests.
  - Performance at 43² with terrain: 1.2 ms per tick on average with 1,500 animals, worst tick 8.8 ms.
  - The bot plays on generated maps (its tests and report).
  - Fix: the benchmark placed animals past the last row on odd grid sizes.

## D-085 · 2026-09-30 · Terrain rendering
- **Status:** accepted (world overhaul step 1c)
- **Decision:**
  - The worker sends the map once at start (`terrainFrame()`: elevation 0..255, then the ground class; `reliefM` from `[terrain] relief_m`). Replays stay flat.
  - `Heightfield` (render only): cell-centre heights, deep beds drawn 1.5 m lower, two 3×3 blur passes for rounded banks (beds never rise, so narrow rivers keep their water), bilinear `at(x, z)`, and a half-float height texture (32-bit floats are not filterable in WebGPU).
  - **Ground:** a plane with 3 subdivisions per cell raised on the CPU; picking raycasts it. The frontier texture moves into the ground material, so the lines follow the relief. Slab walls follow the edge profile.
  - **Water:** one transparent plane at the water level, tinted by depth (from the height texture, so it fades at the shore), with a slow noise shimmer.
  - **Rocks:** 2–4 jittered low-poly stones per rock cell, three shapes, instanced, flat shaded.
  - Plants, grass roots (height texture), animals, rings, the aura, pings, the drop cursor and camera targets stand on the relief.
- **Consequences:** new palette entries (shallows, deep water, rock). Shadows, wind and slope tints come with step 2.

## D-086 · 2026-09-30 · Light and shaders
- **Status:** accepted (world overhaul step 2)
- **Decision:**
  - **Sun:** warmer (`#ffe7c4`), a little stronger, soft PCF shadows over the whole slab. Plants, rocks and animal bodies cast; the ground, grass, plants and rocks receive. The map size comes from the preset: off on Low, 1024 on Medium, 2048 on High.
  - **Tone mapping:** Khronos Neutral, so bright colours roll off instead of clipping, with hues kept. This takes the place of a separate colour grade (no LUT).
  - **Wind** (`growth.ts` `wind()`): a prevailing direction, times a slow noise gust field plus a gentle sway.
    - Grass tips bend up to 0.12 m, by (height share)².
    - Shrubs and trees bend rigidly from their root, 0.02 m per metre of height, in the GrowingMesh position node (the seam from D-072).
  - **Ground tints:** darker and greener within 1.5 m above the water, paler on the top of the relief, the rock colour on steep slopes.
  - **Foliage rim:** a warm edge light on plant parts, stronger when looking toward the sun (fake translucency).
  - **High only:** a `RenderPipeline` with a depth-of-field tilt-shift and a light bloom. The focus is the camera's distance to its target, and the sharp band is 45 % of it.
  - Slab walls rise to the water level at the map edge, so ponds no longer overhang it.
  - **Dev hook:** `window.ecoViewer` (dev builds only), so browser checks can drive the camera.
- **Consequences:** checked in the browser on all three presets, switched at runtime. The fps check on the reference laptop is still to do (the user).

## D-087 · 2026-09-30 · Species revamp: families, four strata, water species
- **Status:** accepted (the author's species table; defaults for diets, habitats, media and stats)
- **Decision:**
  - **Tech tree:** 5 plant families (L1 herbaceous, L2 intermediate, L3 shrubs, L4 trees, W aquatic) and 10 animal families (D, H1–H4, HW, P1–P3, PW). Each family has three tiers (small, medium, large), one species per tier: 15 plants and 30 animals (gamerules §4.2).
    - A card needs the previous tier of its family and, for an animal, one of its habitat plants.
    - Lichen & moss, grasses and earthworms are free at start.
  - **species.toml** gains `family` (every species) and `swarm` (animals, renderers only). `level` is now the plant height stratum; animals have none.
  - Diet and habitat entries resolve family names ("L4", "W") to every plant of that family, so aquatic plants never count as land strata.
  - **Four height strata** in Rust and in the Python prototype (`LEVELS` / `STRATA` = 4; `soil_min_level` has 4 values). Flat-map parity holds: fixture regenerated, `cli:check` exact.
  - **Aquatic plants** use the water response: algae (optimum 1.0, tolerance 0.25) stays in water; reeds and willow also take wet banks.
  - **Animals:** the author's 30, with the default diets, habitats and media of gamerules §4.3. Swarms are the insects, larvae, earthworms and fungi. Stats are placeholders from tier and family templates, for M7.
  - The balance hash includes the family tree (`BALANCE_HASH_VERSION` 11).
  - **Client:**
    - families in the build bar (two-line labels);
    - plant models in model strata: undergrowth clumps, reed stems, shrubs, trees, and lily pads floating on the water (aquatic herbs), with a Layers toggle per stratum;
    - new animal bodies: ungulate, bear, mustelid, fish, duck, frog, wader. Fish swim under the surface, amphibians float on it;
    - large animals are enlarged less (`drawnLength`), so a bison does not dwarf the trees.
  - **Bot:** new unlock plan on land (the aquatic families are left to players for now); its succession play is for shrubs and trees.
- **Consequences:**
  - Tests: water plants hold the shallows and never dry land, fish stay in water, the family tree unlocks, layout strata.
  - Tick budget with 1,500 animals: 1.1 ms on average, worst tick 8.3 ms.
  - The demo replay was regenerated.
  - Known: the hard bot over-spends and stalls before trees (M7 tuning).

## D-088 · 2026-09-30 · Movement per species
- **Status:** accepted (user: "the brownian noise is good for insect, even if a bit fast and erratic; for small herbivores it must be calmer and slower, adapt by specie")
- **Decision:**
  - species.toml gets optional per-species movement keys, each defaulting to the `[fauna]` value:
    - `wobble`: the drift kick, a share of speed;
    - `wobble_keep`: the drift kept per tick;
    - `rest`: the chance to stay put at an idle decision instead of strolling (stop-and-go grazing).
  - All three are hashed with the balance.
  - **Values** (placeholders):
    - insects and soil life: wobble 0.25–0.3, slower (grasshoppers 2 → 1.5 cells/s);
    - small herbivores: wobble 0.06–0.1, keep 0.9, rest 0.5, slow (vole 0.6, rabbit 1.2);
    - large herbivores: wobble 0.04–0.06, rest 0.5–0.6, slow and steady (bison 0.8, deer 1.2);
    - hunters: low drift, rest 0.2–0.6, their chase speed kept;
    - birds: a light drift.
- **Consequences:** a test checks that a rabbit covers much less ground than a grasshopper and rests at idle decisions. Parity, native vs WASM and the relay test are green.

## D-089 · 2026-09-30 · A drop you can see
- **Status:** accepted (user: "I would like to see them falling from the sky")
- **Decision:** the parachute drop of D-080 was too small and too quick to see from the playing camera.
  - **Fall:** 40 m over 2.5 s, easing out; the animals of one card leave up to 0.5 s apart, a staggered column.
  - **Canopy:** at least 3 % of the camera distance across, so it reads from the full-map view.
  - **Ground:** a shadow spot that shrinks onto the landing point, then a dust ring that spreads for 0.7 s.
  - Dev builds expose `window.ecoViewer` and `window.ecoLive`, so a browser check can place the camera and spawn animals.
- **Consequences:**
  - Fixed a bug on the way: a settled animal's sway was `0 × sin(∞)` = NaN, which hid its body. The test now demands a finite pose.
  - Checked in the browser from the full-map view and from close up.

## D-090 · 2026-10-01 · Quality switch crash fix, a lighter High preset
- **Status:** accepted (user: High at 30 fps early, 23 fps late; changing quality crashed the game)
- **Decision:**
  - **Crash, root cause:** a change of shadow size disposed `sun.shadow.map`. In three r186 the shadow node keeps that render target, and the materials sample its depth texture. Destroying a texture still in use led to a white canvas or device loss.
    - Now only `mapSize` is set; three resizes the map itself.
    - The post pipeline is built once and switched on or off.
    - Checked: 17 switches in a row across all presets, no console error.
  - **High preset, lighter:**
    - shadows are cast only by shrubs, trees, rocks and animal bodies (not clumps, reeds, pads or grass);
    - the shadow map is redrawn every 2nd frame (`autoUpdate` off, `needsUpdate` on alternate frames);
    - grass is 18 tufts per cell (was 24), the resolution cap 1.5 (was 2).
  - The 25 % smaller map (D-091) cuts the cell count by 45 %.
- **Consequences:** the late-game fps on High is the user's to check on the reference laptop.

## D-091 · 2026-10-01 · Map side 43 → 32 (128 m)
- **Status:** accepted (user: "reduce map size again: -25%")
- **Decision:** `grid_size = 32`: 1,024 cells instead of 1,849, homes at (8, 8) and its mirror. The generator keeps its values: at 32 the map still has the river with shallows and deep pools, the ponds, the rock outcrops and clear homes (the `map_preview` test now prints 32²). The relay test, the prototype's default size and the docs follow.
- **Consequences:**
  - Tick at 32² with 1,500 animals: 0.7 ms on average, worst 4.4 ms.
  - Flora parity, `cli:check`, native vs WASM and the relay test are green.

## D-092 · 2026-10-01 · "Recyclers"; the black woodpecker replaces the raven
- **Status:** accepted (user; the rename covers player-facing text, the woodpecker's gameplay comes later)
- **Decision:**
  - Family D is "Recyclers" in the build bar, the tooltips ("recycler") and gamerules. The data and code keep `role = "decomposer"`, so the sim, the hashes and the tests are untouched.
  - The tier-3 recycler is the black woodpecker (flies, eats litter, needs trees), with the raven's placeholder stats and a lower speed. Its effect text announces "speeds up the decay of dead trees". The rule itself is to come (for example a faster litter recycling on tree cells).
  - The demo replay was regenerated.
- **Consequences:** all checks are green; seen in the browser (flyout, tooltip).

## D-093 · 2026-10-01 · A thinner selection ring
- **Status:** accepted (user: "divide by 2 the width of the ring of fog for the cell selection")
- **Decision:** the fog band of the selected-cell aura is half as wide, at the same middle radius:
  - gradient from radius 64 to 120 of 128 (was 36 to 128);
  - puffs at radius 86–110 and size 6–13;
  - the three stacked layers grow by 0.25 cell instead of 0.5.

## D-094 · 2026-10-01 · Victory: 90 % of the map, or the most standing biomass at 60 minutes
- **Status:** accepted (user: "60min timer and 90% map coverage")
- **Decision:** `[match] victory_territory = 0.90`, `time_limit_s = 3600`. The client reads both from the sim, so the HUD, the near-victory toasts and the end screen follow. The decaying-threshold switch stays off. Q-013 keeps them tunable.
- **Consequences:** the Python victory test now uses 91 %. All checks are green.

## D-095 · 2026-10-01 · No starting land: the first planting is the spawn
- **Status:** accepted (user: "no player has any cell already colonized; choosing the spawn point is going to be a strategic part"; spawn anywhere on land; the clock runs and you plant when ready)
- **Decision:**
  - The free opening patches (D-058) are gone from the live match.
  - A player founds the colony with a first planting, paid from the start budget, on any free land cell (the plant rules already allowed any free cell).
  - The HUD shows "Choose your spawn" until the player holds land.
  - The bot founds its colony on the free cell that suits its first spreader best, nearest its side of the map (the generator's home clearing).
- **Consequences:**
  - New test: a bot founds its colony on an empty map.
  - The relay test and the bot tests keep their own scripted openings (`setup_plant`).
  - Checked in the browser.

## D-096 · 2026-10-01 · Varied maps: valleys, cliffs, water along the topography
- **Status:** accepted (user: too many maps shared the same MOBA-like structure, one river and two ponds; wants rivers that follow the topography, more relief, small valleys, cliffs with rocks)
- **Decision:** `terrain.rs` is rewritten; it stays integer-only, 180° symmetric, every walkable cell reachable.
  - **Relief:** value-noise octaves minus winding valleys (where a coarse noise crosses its middle), then terraced. Three parts terrace to one part raw relief: plateaus with some roll, joined by steep steps.
  - **Water:** one layout per seed:
    - a river crossing the map;
    - a central lake fed by two streams;
    - scattered ponds (up to 3 pairs);
    - dry highlands with one pair.

    Rivers start in the middle of a map side, on the higher half, and take the cheapest way to their goal (Dijkstra on height). They are kept off the rim and away from the homes, so they run along the valleys. A river and its mirror can braid, run in parallel, or merge.
  - **Ponds** sit in inland basins.
  - **Rock:** cliffs (a drop to a neighbour ≥ `cliff_drop`, broken into bands with passes by a fine noise) plus a few outcrops on the high ground.
  - **Render:** relief 16 m (was 8); rock keeps its height through the shore blur, a single pass now, so cliffs stay sharp.
  - New `[terrain]` keys: `valley_*`, `terraces`, `cliff_*`, `lake_radius`. Removed: `river_meander`.
  - The home clearings stay: they anchor reachability and the bot's spawn.
- **Consequences:**
  - Tests: symmetry and reproducibility, clear homes and full reachability over 24 seeds, every layout over 40 seeds (rivers reach the edges, lakes the centre) with cliffs, valley paths keep to the valley floor, water and moisture invariants.
  - The water-plants test picks a river map.
  - Tick budget unchanged.

## D-097 · 2026-10-01 · Rings follow the relief
- **Status:** accepted (user: the selection and drop rings should follow the terrain, not clip into it)
- **Decision:** `terrain.ts` `drape(mesh, height, lift)` sets every vertex of a flat mesh `lift` m above the ground (or the water surface) under it. It works through the mesh's world matrix, so it holds after moves, Y turns and scaling.
  - Draped: the drop-cursor ring (96 segments), the three fog layers of the selection aura (24×24 each, every frame since they turn and breathe), and alert pings (every frame as they spread).
  - These meshes are not frustum-culled, since their vertices move.
  - Animal rings stay flat (small, instanced).
- **Consequences:** a unit test checks that a turned, scaled, moved mesh sits on a sloped ground. Seen in the browser on a ridge.

## D-098 · 2026-10-01 · A cell grazed bare turns neutral, barred to its former owner for 30 s
- **Status:** accepted (user: favour front-line progression; lockout 30 s)
- **Decision:**
  - When enemy grazers eat the last plant biomass of a cell (every species below 1), grazing makes it neutral at once: gauges and claim progress are reset.
  - `FloraState` gets `lock` (flora ticks left) and `lock_p` (the barred player), both in the chunk hash.
  - While locked, the barred player gets no claim progress on the cell (both flora steps) and cannot plant there. The other player can do both at once.
  - The lock runs down one per flora tick. `[fauna] lockout_s = 30` (real seconds) is in the balance hash.
  - Python parity is untouched: the lock only comes from grazing, and the flora fixture has no animals.
- **Consequences:**
  - New test: grazed bare, neutral, barred owner, raider may plant, countdown.
  - All checks are green; native vs WASM still match.
  - The lock shows in the new cell panel (D-100).

## D-099 · 2026-10-01 · Solid frontier for both players
- **Status:** accepted (user: "replace the P2 dash line with continuous")
- **Decision:** P2's frontier is a solid line like P1's, with the same push-driven width (D-076). This drops the pattern cue of D-040: on the map, the two players now differ by colour only (Okabe–Ito blue and orange, chosen to stay distinct under colour blindness). The end-screen charts keep P2 dashed.

## D-100 · 2026-10-01 · A compact cell panel, read at a glance
- **Status:** accepted (user: quick access to cell health and animal population without reading)
- **Decision:** `CellPanel.svelte` is rebuilt (214 px wide), with icons and bars; names and figures are in tooltips.
  - **Header:** owner dot, ground icon (land, water, rock), a health heart, a lockout badge (barred player's colour, seconds left; D-098), and zoom / close.
  - The health heart (`game/cell.ts`, tested):
    - grey when nobody holds the cell;
    - green when nothing threatens it;
    - gold when it is pushed or barred;
    - red when pushed hard (≥ 50 %) or when the other side's animals are on it.
  - **Body:**
    - four columns for the cover of each height stratum;
    - soil and enemy-push bars;
    - the plants as species icons with a cover bar;
    - the animals as species icons with a count badge and an owner ring.
  - **Data:** `CellInfo` gains `ground`, `strata`, `push` and `lock`; `sim-wasm` adds `lockFrame()`, sent with the field frames.
  - **Fixed on the way:** bar sizes used "40 %" (invalid CSS), so the old panel's bars always looked full.
- **Consequences:** client tests for the status and the lock and push plumbing; checked in the browser.

## D-101 · 2026-10-01 · The bot waits before founding its colony
- **Status:** accepted (user: the bot still started with land at once; "make him wait a few seconds")
- **Decision:** with no land yet, the bot founds its colony only after 15 s (easy), 10 s (normal) or 6 s (hard). Until then it sends nothing. Tested: no spawn command during the wait.

## D-102 · 2026-10-01 · Map types: real diversity of relief, rock and water
- **Status:** accepted (user: every map was high relief with a crossing river; wants flat dry maps, rocky mountain valleys, marshes, lakes, really diverse)
- **Decision:** each seed first draws a map type by weight from `[[terrain.map_types]]` in balance.toml.
  - **Settings per type:**
    - relief height (a share of the full relief);
    - terraces;
    - valley depth;
    - cliffs on or off;
    - rock share;
    - water: none, river, lake, or flood (the lowest share of the map under water, part of it deep);
    - extra ponds.
  - **The types:**

    | Type | Relief | Rock | Water |
    |---|---|---|---|
    | plains | 0.12 | almost none | none |
    | meadows | 0.25 | little | 2 pond pairs |
    | hills | 0.55 | some | river |
    | mountains | 1.0, terraced | cliffs, many outcrops | 1 pond pair |
    | canyon | 0.9 | cliffs | river |
    | lakeland | 0.45 | little | 14 % flooded |
    | marsh | 0.12 | none | 30 % flooded, mostly shallow |
    | lake | 0.5 | some | central lake |

  - Water beds and banks scale with the type's relief. Moisture is relative to the map's own heights.
  - Cliffs only appear on cliff types, and need a real drop.
  - `BALANCE_HASH_VERSION` 12.
- **Consequences:**
  - Tests over 120 seeds: every type appears; each respects its relief cap, dryness, river edges, central lake, flood share and cliff rule. Symmetry and reachability hold at 24, 32 and 44 cells.
  - Seen in the browser: plains, mountains, lakeland.

## D-103 · 2026-10-01 · Map size in the match setup
- **Status:** accepted (user: Small, Mid, Large in the start menu)
- **Decision:** the match setup has a Map size choice: Small 24, Mid 32 (the balance grid) or Large 44 cells per side (`game/setup.ts` `MAP_SIZES`). It is remembered with the setup, `?map=` overrides it, and `?size=N` still wins for tools. Lockstep matches keep the balance grid, so both peers agree. The generator is tested at all three sizes.

## D-104 · 2026-10-01 · Lichen & moss spread at about 3/4 of grasses
- **Status:** accepted (user: the bot expanded far faster early on, "my moss and lichens barely expand"; option chosen: about 75 % of grasses)
- **Decision:**
  - **Root cause:** the stats, not a regression. Lichen & moss had `growth` 0.28 (grasses 1.2) and `biomass_rate` 0.04 (grasses 0.25). Claims on neighbouring cells scale with both, so a lichen front crawled.
    - The free opening of D-058 (grasses + lichen for everyone) hid this.
    - With the open start (D-095), a player founding with lichen faced a bot founding with grasses.
    - Measured: 37 cells against 327 after 2 minutes.
  - Now `growth` is 1.0 and `biomass_rate` 0.18, which gives 255 cells against 327 (78 %).
  - Lichen & moss keep their niche: shade tolerance, the fastest soil development, low biomass and yield.
- **Consequences:**
  - New test `pioneers_found_at_a_comparable_pace` (flat map, mirrored spots, 2 min): lichen holds at least 70 % of grasses' land and still less.
  - Fixture regenerated; parity and every check are green.

## D-105 · 2026-10-01 · A compact build bar: sections and family pictograms
- **Status:** accepted (user: too much space between icons; water species grouped on the right; recyclers at the far right; nicer, sober family icons tied to their concept; option chosen: icon only, name on hover)
- **Decision:**
  - **Bar order and sections** (`families()`, tested), with a thin separator between sections:
    1. land plants L1–L4;
    2. land animals H1–H4, P1–P3;
    3. water W, HW, PW;
    4. recyclers D.
  - Family items are icon-only (the name on hover and as the flyout header), with tighter gaps. The "can unlock" badge sits inside the icon corner.
  - **`FamilyIcon.svelte`:** one line pictogram per family on its tone:
    - plants: a grass tuft, a fern frond, a bush, a tree;
    - land animals: a grasshopper, a snail, a caterpillar on a leaf, a beetle, a bird, a fox head, a paw;
    - water: a lily pad with a reed, a fish, a heron;
    - recyclers: a mushroom.
  - The bar shrinks from about 1,440 px to about 960 px.

## D-106 · 2026-10-01 · Tier medals, overlaid padlocks, quick-stat tooltips
- **Status:** accepted (user: tooltips too verbose, want fast access to cost, yield, breeding and other stats plus the short description; padlock over the unit icon; discreet bronze, silver, gold outlines per tier)
- **Decision:**
  - **Flyout tiles:**
    - each has a thin ring in its tier's medal colour (bronze #b08d57, silver #c3c9cf, gold #d4af37);
    - the "Tier N" column titles become medal dots;
    - locked tiles show a small padlock over the icon (less faded than before); available ones keep the gold open padlock inside the corner.
  - **Tooltips:**
    - Header: medal dot, name and kind.
    - A 2×2 grid of icon + value quick stats (`quickStats`, tested, real seconds through `pace`):
      - plants: cost per cell, biomass per cell /s, spread /s, map share cap;
      - animals: cost (×1.5 off your land in the hover text), biomass /s, breeding period, head cap.
    - One line for the unlock cost or the lock condition, then the species' short description.
  - New `Icon` glyphs: coin, spread, egg, cap.

## D-107 · 2026-10-01 · One padlock: closed, on what is still locked
- **Status:** accepted (user: open and closed padlocks were confusing)
- **Decision:** the open-padlock badges are gone. The closed padlock sits on species tiles that are locked, and on a family item when all of its species are locked. Unlockable cards look normal; their tooltip gives the unlock cost.

## D-108 · 2026-10-01 · A smooth, slowly evolving front line
- **Status:** accepted (user: the jagged square front is clear but not calm; wants a curvy line that evolves slowly)
- **Decision:**
  - `frontierField` fills one RGBA texel per cell (P1 and P2 ownership, each side's push into the other) and blurs it twice with a 3×3 binomial kernel.
  - The ground shader samples it linearly and draws each player's line in the band just inside its territory where the blurred ownership crosses 0.5, widened by its push.
  - The previous field frame is blended into the current one by the grass `blend` uniform, so the line glides over the frame interval.
  - The 8-texel overlay is gone.
- **Consequences:** the fronts are smooth curves at any zoom; tests check the 0.5 crossing, the ramp and the push channels.

## D-109 · 2026-10-01 · Bigger, sparser trees and shrubs
- **Status:** accepted (user: the grown forest should look better; models +33 %, density −33 %)
- **Decision:** shrub and tree models are 33 % bigger (trunk radius ×1.2). A cell holds at most 2 shrubs (was 3) and 1 tree, 2 on a third of the cells (`treesIn`, average 4/3; was 2). Flying animals fly at 7.5 m (was 5.5) to clear the taller canopy. Render only: the sim is unchanged.

## D-110 · 2026-10-01 · A nature backdrop and striped parachutes
- **Status:** accepted (user: the white background should be a calm, blurred mix of greens, cyans and earthy browns; parachutes white with red stripes)
- **Decision:** the scene background is a 256² canvas of blurred blobs (moss, sage, teal, earth; `WORLD.backdrop`), drawn once; the haze beyond the slab fades to its mid tone. Parachute canopies have 8 gores, alternately white and red (`#c8423a`), from the angle around the dome axis in the material.

## D-112 · 2026-10-01 · Zooming out lifts the camera back
- **Status:** accepted (user: after "zoom to plant level", zooming out left the camera stuck low)
- **Cause:** the zoom put the eye at an absolute 2.6 m, under the target on raised ground, so the tilt clamped at its lowest (1.2 rad); wheel zoom keeps the angle.
- **Decision:** the eye goes 2.6 m above the target. The lowest tilt eases with distance from 1.2 rad (within 8 m) to the reset view's 0.66 rad (from 0.6 × the map size; `TILT`), so wheeling out lifts the camera back to the overview.

## D-113 · 2026-10-01 · Caps don't hold conquest back; higher tree and shrub caps
- **Status:** accepted (user chose both fixes: "Apply both options 1 and 2")
- **Cause:** a late-game forest edge never overcame enemy grass. Flips (step 7) and claims (step 8) required the arriving species to be under its cell cap (D-045). The front-line trees and shrubs were at their caps (10–15 % of the map), and the herbs under them were shaded out, so no P1 species could enter. Cells grazed bare turned neutral, and P1 could not claim them after the lockout either, so the enemy took them back. A test reproduced it: a capped oak and hawthorn half held exactly 72 of 144 cells for good.
- **Decision:**
  - Flipping a smothered enemy cell ignores caps.
  - Claiming a free cell ignores caps when it was grazed bare from the enemy (`lock_p` is the enemy).
  - Caps still limit planting, own-cell spread and expansion into free land.
  - Caps raised: oak, chestnut, beech and willow 0.1 → 0.3; elder, hawthorn and hazel 0.15 → 0.35.
  - The prototype mirrors the flip rule (D-034); it has no lockout, so the claim exemption is `sim-core` only.
- **Consequences:** the same test now advances about one column every 70 flora ticks and takes the grazed cell. Fixture regenerated; parity, native vs WASM and `cli:check` exact.

## D-114 · 2026-10-01 · Strategic icons use the family pictograms
- **Status:** accepted (user: update the strategic icons to the new group icons)
- **Decision:** each strategic icon is the build bar's family pictogram (`FamilyIcon`) ringed in the player colour, with a head-count badge carrying the tier medal (bronze, silver, gold), so species of one family stay apart. The medal classes moved to `app.css`, and `MEDAL` to `game/species.ts`, shared with the build bar. The tooltip names the species.

## D-115 · 2026-10-01 · Front-line width follows the push again
- **Status:** accepted (user: check that the curved line's push-dependent width is still meaningful)
- **Cause:** since D-108 the push sits in the enemy cells and is blurred twice with the ownership. Where the line is drawn, just inside the attacker's land, a straight front read only 5/16 of it, so a full push widened the line to about 0.8 m instead of 2 m.
- **Decision:** the push channels are scaled by 16/5 (capped at 1) after the blur. A full push along a front now reads about full width at the line, and fades away from it (test).

## D-116 · 2026-10-01 · Polished animal models: per-species patterns and a gait
- **Status:** accepted (user: improve the low-poly animal models to a new level of polish for the alpha)
- **Decision:**
  - Models live in `client/src/render/bodies.ts`, one per species. A body type gives the shape; the species palette (coat, belly, dark, accent, light, bill, eye) is baked into vertex colours. Examples: a fox's white chest and tail tip and dark stockings, a mallard's green head and white collar, a great tit's yellow breast and black cap, a badger's striped face, a roe deer's pale rump.
  - New body types: squirrel, beaver, deer, stag (antlers), boar (snout disc, tusks), bison (hump, horns, beard). Every model has eyes; legs are tapered, with stockings, hooves or paws; birds have swept wings with dark primaries.
  - A gait in the shader, after instancing. Each vertex carries its role (`gait`: leg sign for diagonal pairs and hip height, wing, tail wag), and each instance its `motion` (leg swing, flap, facing × size).
    - Legs swing with the distance walked (one stride per 0.55 body lengths); the stride eases out when the animal stops, so legs never pedal on the spot.
    - The body bobs by 3.5 % of its size; birds flap and fish wag their tails.
  - `AnimalView` draws one instanced mesh per species with one shared material. The drop ghost uses the same coloured model.
- **Consequences:** tests check the gait, coloured models, swinging legs and palette differences between species. Spot-checked in a gallery of all 23 models and on live rabbits and bison.

## D-117 · 2026-10-01 · Tutorial: a guided match with objectives (M5a 8b)
- **Status:** accepted (user, 2026-09-30: a separate "Tutorial" entry next to Play)
- **Decision:**
  - The menu's Tutorial button starts a fixed match (`TUTORIAL_SETUP`): the easy bot, a small meadows map (seed 2: gentle relief, two ponds), no sandbox.
  - Six objectives complete in order (`game/tutorial.ts`, pure and tested):
    1. Found a colony.
    2. Spread to 5 % of the map.
    3. Unlock a species.
    4. Call an animal on your land.
    5. Have animals on enemy land: a raid or a ×1.5 drop.
    6. Hold 55 % of the map.
  - The last goal is above half the map, so it takes pushing into the bot's land: in a test run, grass alone reached 43 %.
  - A panel at the top left shows the current objective and progress dots, and a toast marks each one done. At the end, "Tutorial complete" offers the main menu; the match goes on.
  - First-match tips are paused during the tutorial, and the "choose your spawn" banner gives way to the first objective. Play again on the end screen replays the tutorial.
- **Consequences:** played through in the browser, from founding to the completion panel. The completion check used a temporary low goal. Grazers wander into enemy grass by themselves, so objective 5 can complete without an order; the text still teaches the order and the drop.

## D-118 · 2026-10-01 · Players start with lichen & moss only
- **Status:** accepted (user: at the start, only lichen & moss; everything else locked)
- **Decision:** grasses unlock for 200 (the family's tier-2 value) and earthworms for 250; lichen & moss is the only free card. The bot unlocks grasses first, then wildflowers and earthworms. Tests that planted grasses by command now plant lichen & moss or unlock grasses first; the relay test's script unlocks grasses and earthworms before using them.
- **Consequences:** the first minutes are a lichen colony earning toward grasses. Fixture regenerated; parity, native vs WASM, `cli:check`, relay and Python tests green.

## D-119 · 2026-10-01 · Unlockable cards: padlock and a biomass gauge
- **Status:** accepted (user: unlockable cards lacked the padlock; fill the icon from the bottom as the budget grows)
- **Decision:** an unlockable card shows the padlock, like a locked one. Its icon is grey with a full-colour copy on top, clipped from the bottom to bank ÷ unlock cost and eased over 0.4 s. Once affordable, the icon is full colour and the padlock turns gold. Locked cards stay grey with a dark padlock; a family item still gets a padlock only when all of its species are locked (D-107).

## D-120 · 2026-10-01 · Tutorial teaches the raid with rabbits
- **Status:** accepted (user: grasshoppers could not be selected or attack-moved; use rabbits)
- **Cause:** grasshoppers are a swarm, and swarms cannot be selected or ordered (D-065).
- **Decision:** with the lichen-only start (D-118), the objectives are:
  1. Found with lichen & moss.
  2. Spread to 5 %.
  3. Unlock and plant grasses.
  4. Unlock grasshoppers, then rabbits, and call rabbits.
  5. Select the rabbits, press A, click enemy land.
  6. Hold 55 %.

  Objectives 4 and 5 count only animals that can take orders. Objective 5 also needs a move or attack order onto enemy land: in the test run, grazing rabbits had drifted over the front and completed it on their own. The goal reads "55 %" (it showed a float tail).
- **Consequences:** played through in the browser: box selection picked the nine rabbits, and A + click sent them to graze the enemy's front cells.

## D-121 · 2026-10-01 · Planting feedback: a seed scatter and a ripple
- **Status:** accepted (user asked for a planting animation and a proposal; this one was built)
- **Decision:**
  - On a planting click, 12 seeds in the plant's colour (with the owner tint) pop up from the click and arc out over the planting radius in 0.6 s, staggered. They lie for 0.5 s, then shrink away (`render/seeds.ts`, one instanced mesh, flat colour).
  - Seeds are at least 0.6 % of the camera distance across, so a burst reads from the overview.
  - As they land, a ring in the plant's colour ripples once from 1/5 of the planting radius to its edge: the alert ping, which now takes a radius, a wave count and a delay.
  - The plants' own GPU grow-in follows when the cells sprout.
  - The feedback shows on every click, whatever the sim decides; a refused order still leaves its notice.
- **Consequences:** tests cover the flight and the fade. Checked in the browser at the overview and close up, with the timing slowed for the screenshots.

## D-122 · 2026-10-01 · Ranked diets, and "Feeds on" on species cards
- **Status:** accepted (user approved the proposed food web; an animal needs at least a primary and a secondary food, and tier 3 a tertiary)
- **Decision:**
  - Grazer families feed on their own plant layer first, then a neighbouring one: H1 meadow, H2 undergrowth, H3 shrubs, H4 canopy, HW water.
  - Hunter families target an animal size: P1 insect eaters, P2 small hunters, P3 big game, PW water life.
  - Each tier 1 and 2 animal has two foods, each tier 3 three. Every plant and every animal is someone's food.
  - `eats` lists species in rank order, primary first; recyclers eat dead biomass. The full table is in `data/species.toml`.
  - The species tooltip has a "Feeds on" row: each food is a chip (family pictogram, tier medal, name), primary first in bold. Species artwork is still placeholder, so pictograms and names carry the meaning.
  - Helpers `foodsOf` and `eatersOf` (`game/species.ts`) serve the tooltip and the tech tree.
- **Consequences:** the ranks only order the list for now; the rule follows in D-123.

## D-123 · 2026-10-01 · Food ranks: preference and yield
- **Status:** accepted (user chose "preference + yield")
- **Decision:**
  - An animal seeks its primary food in sight first, then the secondary, then the tertiary; an attack-move looks on enemy land the same way.
  - A grazer eats the best-ranked plant in its cell (then the most plentiful); a hunter takes the best-ranked prey in reach.
  - A meal gives energy × `[fauna] diet_yield = [1.0, 0.75, 0.5]` of its rank.
  - The loader allows at most three foods and requires non-increasing yields; balance hash version 14.
- **Consequences:** tests cover a grazer leaving plentiful wildflowers for scarcer grass, the 75 % meal and a fox passing a nearby vole for a rabbit. Fixture regenerated; every check is green.

## D-124 · 2026-10-01 · The tech tree becomes a food web
- **Status:** accepted (user: rework the tech tree in depth into a logical, harmonious view of the links between species, interactive, to see in game which species counters which)
- **Decision:**
  - The full-screen tree (T) lays the families out in three rows, bottom-up: plants, grazers, hunters.
  - Each grazer family stands over the plant layer it eats (H1 over Herbs … HW over Water plants), and hunters over their prey. The recyclers stand beside the grazers, over a "dead biomass" node.
  - Every feeding link is drawn faintly. Hovering or clicking a species lights its foods (gold) and its eaters (red), with thickness by diet rank, and dims the rest.
  - Links join the facing sides of nodes; within one column they arc through the gutter, so none runs behind a sibling node.
  - Species the enemy fields now carry an orange dot, and yours that eat any of them a crosshair. "Counters" lights only those relations.
  - The side panel shows the focused species: stats, feeds on, eaten or hunted by (clickable chips), habitat, what unlocking needs, and the Unlock button.
  - The layout and relations are pure and tested (`game/foodweb.ts`).
- **Consequences:** the old levels × tiers grid is gone.

## D-125 · 2026-10-01 · Cattails replace the willow
- **Status:** accepted (user: the willow added little; a tier-3 aquatic plant should replace it; named cattails)
- **Decision:**
  - `[flora.cattails]` is the W tier-3 plant: shrub height (level 3), likes shallows and wet banks like the reeds, unlock 1600 (W costs: 400 → 800 → 1600).
  - Its role uses the existing refuge rule: `"cattails"` joins `[fauna] refuge_flora`, so small water animals (larvae, roach, frog) in their owner's dense cattails cannot be hunted.
  - The beaver now eats chestnut, then oak.
  - Drawn as thin stems with brown seed heads; the water-plant pictogram shows a cattail.
- **Consequences:** a test checks that a roach in cattails is safe and one in open water is not. Fixture regenerated; every check is green.

## D-126 · 2026-10-01 · A food web where low tiers are easy to counter
- **Status:** accepted (user: tier-1 plants such as ferns, elder and oak took a high-tier unlock to counter; tier-1 insects should live one layer lower)
- **Decision:**
  - Within each plant layer:
    - the tier-1 insect eats the tier-1 plant first, then the tier-2;
    - the tier-2 animal eats the tier-2 plant, then the tier-1;
    - the tier-3 animal eats the tier-3 plant, then the tier-2, then a neighbouring layer.
  - Tier-1 plants now have 3 eaters (lichen 2), each including a tier-1 insect; tier-3 plants have 1 or 2.
  - Hunters: the frog now eats slugs first and the pike larvae first.
  - Insect habitats are one layer lower: slugs on herbs, caterpillars on undergrowth, bark beetles on shrubs (grasshoppers stay on herbs). Slugs can be unlocked with the starting lichen alone, to answer ferns.
  - Tech-tree nodes show "eaten by N" in red.
  - Every tier-1 grazer has a hunter of tier 2 at most; slugs have no tier-1 hunter, so the test asks for tier 2 at most.
- **Consequences:** two tests guard this:
  - the web test (every plant feeds someone; tier-1 plants have two or more eaters including a tier-1 animal; every grazer is hunted, tier-1 grazers by a tier-2 hunter or lower);
  - the unlock test (slugs with lichen only; caterpillars only after an undergrowth plant).

  The gradient test is in Rust, which loads the real data files; a client test would have needed a TOML parser.

## D-127 · 2026-10-01 · Dead trees
- **Status:** accepted (user: trees die of natural causes with a small chance and leave a dead dry tree; while it stands no tree grows there; recyclers, especially woodpeckers, clear it)
- **Decision:**
  - `FloraState.snag` holds the standing dead wood per cell; it is in the chunk hash and `full_hash`.
  - `Flora::natural_deaths` runs after the flora step, on the world RNG. Each cell with trees dies with chance `dt / natural_death_s`, a 3 h mean life of ecology time, so about one death a minute in a 200-cell forest.
  - `Flora::kill_trees` sends `wood_share` (0.3) of the trees' biomass to standing dead wood and the rest to litter; the cell turns neutral if nothing else grows there.
  - Trees get zero suitability under dead wood. Dead wood rots to litter (`rot_s` 600).
  - Recyclers eat it through ranked rot foods (litter or dead wood): the woodpecker eats dead wood first, fungi second.
  - Kept out of `Flora::step` so the Python parity (D-034) holds, like the lockout.
  - The client draws a weathered grey trunk with bare branches (`DeadTrees`, `plants.ts`) sized by the wood left, from a new `deadwoodFrame` sent with the field frames. The cell panel shows a dead-tree chip.
- **Consequences:** balance hash version 15. Tests cover the stand, block and rot cycle, the woodpecker's preference (eating and seeking) and the hash. In a first browser run, a 30-minute mean life killed most of a young forest, so it is 3 h.

## D-128 · 2026-10-01 · Falling trees
- **Status:** accepted (user: a tree eaten by its animals falls on the ground and disappears progressively)
- **Decision:**
  - `GrowingMesh` gets a per-instance fall (start, direction) and `fell(key, t, dir)`. In the shader the part tilts about its root toward `dir`, accelerating, flat after `FALL_S` = 1.4 s; then it withers away on the ground over `GROW_S`.
  - `fallen` and `fallAngle` mirror the maths on the CPU for tests.
  - `PlantView.dropAll` fells tree parts (trunk and crown meshes): all parts of one model fall to one side, a hash of its slot.
  - Only trees removed while no dead wood stands in the cell fall: grazed down, lost front, and later storms. A tree that died standing (D-127) withers while its dead trunk grows in. Everything else withers as before.
- **Consequences:** tests cover the fall pose and its timing. Checked in the browser (felled trees lie flat with their crowns beside them); the hidden tab only renders on screenshots, so the timing was staged.

## D-129 · 2026-10-01 · Catastrophe cards
- **Status:** accepted (user: a catastrophe deck at the far right of the unit bar, late-game trump cards, unlocked, expensive; the user chose reuse after a cooldown, and that they hit everything in their area)
- **Decision:**
  - `[catastrophes.<name>]` in `balance.toml` gives `act`, cost, radius, cooldown, duration, chance per cell per flora tick, and the card text:
    - `kill_trees`: bark beetle outbreak, r 4, 8 s, 0.35;
    - `storm`: violent storm, r 9, 6 s, 0.06;
    - `spill`: chemical spill, r 1, one tick.
  - `sim-core/src/catastrophe.rs` holds the converted cards, the active effects and per-player cooldowns (all hashed), and `cast`.
  - `Payload::Catastrophe { kind, row, col }`: refused with a notice while cooling down or short of biomass; sandbox is free.
  - Each flora tick, the active effects act on their disc:
    - beetles through `Flora::kill_trees` (dead trees, D-127);
    - the storm through `Flora::fell` (shrubs and trees to litter, so they fall, D-128);
    - the spill through `Flora::lay_bare`.
  - `take_effects` reports casts (player, card, row, col) for the animations.
  - Client:
    - a `CatastropheDeck` after the recyclers, with a cloud-and-lightning pictogram;
    - cards (beetle, storm, drum) with a gold cost, and a sweep with the seconds left while cooling;
    - a click arms a card: the drop ghost shows the disc as a ring, a map click casts, Esc cancels;
    - `viewer.catastropheFx` draws small rings and particles in each card's tone;
    - an enemy cast raises an alert toast.
- **Consequences:**
  - Balance hash version 16. The determinism `proptest` streams include catastrophe commands.
  - Tests:
    - beetles kill every tree in the disc into dead wood; outside, only old age;
    - cooldown refusal;
    - a storm fells some cells inside and none outside;
    - a spill leaves bare, ownerless, soil-0 cells;
    - a short bank is refused;
    - client: card status, plumbing.
  - The bot does not cast catastrophes yet: for the balance loop (M7-lite).

## D-130 · 2026-10-05 · Processionary caterpillars replace the bark beetle card
- **Status:** accepted (user, 2026-10-02)
- **Decision:** the `kill_trees` catastrophe card is now `[catastrophes.processionary_caterpillars]`, with a caterpillar pictogram (`Icon` `caterpillar`). Its rules are unchanged (D-129). The bark beetles stay as a species (H4).
- **Consequences:** the balance hash changes (renamed key). The tests, the `proptest` stream and the flora fixture follow.

## D-131 · 2026-10-05 · Species icons show their family pictogram
- **Status:** accepted (user: icons more explicit than geometric forms, looking like their group icon)
- **Decision:**
  - Until a species has its own `.webp`, `SpeciesIcon` draws its family's `FamilyIcon` (pictogram and tone). The stratum and role glyphs (`glyph()`) are removed.
  - The tier stays readable from the medal dots and rings around the build-bar tiles (D-106).
  - Fix: a catastrophe card's tooltip is placed out of the flyout's flow. Before, growing the flyout slid the cards from under the pointer, so the tooltip flickered on and off.
- **Consequences:** species of one family share a pictogram until real icons come (M5b).

## D-132 · 2026-10-05 · Weather events
- **Status:** accepted (user: rain, drought and flood, no seasons; a weather icon at the top left; weather alerts so players can prepare; once, maybe twice per 30-min game; particles, light and background change). The numbers are defaults picked here.
- **Decision:**
  - Effects:

    | Weather | Plant growth | Animals | Also |
    |---|---|---|---|
    | Rain | ×1.15 | speed ×0.9 | |
    | Drought | ×0.4 | speed ×0.9, bites ×0.85 | 12 % of tree stands die standing; 20 % of grass-only cells laid bare |
    | Flood | ×0.85 | speed ×0.85 | bank cells flood (0.6 each) |

  - Schedule: the first event in 480–900 s, the next 720–1200 s after one ends, with an alert 30 s before. Over 40 seeds, a 30-min match gets one or two events (tested).
  - `sim-core/src/weather.rs`:
    - Its own PCG32 stream, so nothing changes before the first alert: the flora parity and the `cli:check` run match without weather.
    - The kind is drawn at the alert, so the terrain is known; floods only on maps with water.
    - All state is hashed: RNG, kind, start, end, flooded cells.
  - The factors are Q16 and exact when neutral:
    - `Flora::growth` scales positive growth only, with the growth floor (D-021);
    - `Fauna::speed` scales movement;
    - `Fauna::bite` scales grazing bites.
  - Drought: the shares are per event, converted to a chance per flora tick. It goes through `Flora::kill_trees` (dead trees, D-127) and `Flora::fell(1)` on grass-only cells.
  - Flood:
    - land cells 4-adjacent to water become `SHALLOW` with full moisture;
    - plants whose moisture response under full water is below `drown_below` (0.5) drown to litter: land plants 0.17, water plants keep;
    - when it ends, the saved ground and moisture come back.
  - wasm: `weather()` (kind, phase, ticks left), `weatherTable()`, `floodCells()` (sent with the field frames).
  - Client:
    - `WeatherBadge` under the clock: icon, name and countdown; a pulsing ring during the alert; the effect in the tooltip;
    - toasts for the alert (what to prepare for), the start and the end (`game/weather.ts`);
    - `render/weather.ts`: the sun, sky light, fog and backdrop tint ease toward the weather's `SKY` (`palette.ts`); a third of the way during the alert;
    - slanted rain streaks or drifting dust (CPU-moved line segments, up to 2,400);
    - water tiles on flooded cells. The backdrop is now drawn through `scene.backgroundNode`, so it can be tinted.
- **Consequences:**
  - Balance hash version 17.
  - Tests:
    - one or two events per 30 min on 40 seeds, each after its alert;
    - drought losses within bounds, and neutral factors after it;
    - flood on the banks only, drowning, and recede;
    - rain grows more than clear weather, drought less;
    - client: decoding and toasts, plus the live plumbing.
  - Checked in the browser with a shortened schedule for each kind (reverted). The first rain looked like snow dots, so the streaks are now longer and slanted; drought dust was too faint, so it is paler.
  - The bot ignores the weather.
  - The native vs WASM check (1,200 ticks) ends before the first event; the weather is integer-only like the rest.

## D-133 · 2026-10-05 · Weather tooltip; shadows set once per match
- **Status:** accepted (user: the weather tooltip should look like the species tooltip; switching High → Medium froze the map)
- **Decision:**
  - The weather badge's tooltip is a frosted panel like the build bar's species tooltip:
    - the name, with the alert countdown or the time left;
    - the factors as signed changes with icons (plant growth, animal speed, grazing);
    - the effect text.
  - The weather table now carries the factors (`growth`, `speed`, `bite`).
  - The App keeps the weather in `$state.raw`. A `$state` proxy never equals the object it wraps, so the badge refreshed every frame.
  - Shadows (on or off, map size) are set once, before the first frame. A preset change mid-match applies grass, resolution and post-processing at once, and shadows from the next match (the quality select says so).
  - Cause: the direct render (Low, Medium) and the High post pass share the sun's shadow node, but each caches its own bindings, and three caches bind groups by texture id and version.
    - Resizing the map left the other path on the destroyed texture: every submit failed and the canvas froze on its last frame, while the HTML overlay kept moving.
    - Toggling shadows disposed the node under the other path: a crash, then a white canvas.
  - Tried first, each still failing in the browser:
    - swapping in a new sun;
    - drawing every preset through one rebuilt pipeline;
    - bumping the depth texture's version.
- **Consequences:**
  - The browser cycle Medium → High → Medium → Low → High → Medium ran with no validation error, and the map still pans and zooms.
  - A full live switch would need a new viewer (renderer and scene), not worth it now.

## D-134 · 2026-10-05 · Top bar: centred land tug-of-war, weather in the icon row
- **Status:** accepted (user)
- **Decision:**
  - The land gauge is a bar across the top of the resource pill: P1 fills from the left, P2 from the right, free land in between, with a mark at 50 %.
  - The weather badge (D-132) is a round button at the start of the top-right icon row. Its countdown sits in a pill under it, and its tooltip opens below it.

## D-135 · 2026-10-05 · Map overlays and the display menu
- **Status:** accepted (user: layers as round toggles that show a heatmap of the chosen feature; add biodiversity, moisture and shade)
- **Decision:**
  - Overlays, one at a time, off by default (and at each new match):
    - soil fertility;
    - the cover of herbs, undergrowth, shrubs and trees;
    - diversity: plant species growing plus animal species standing in the cell, relative to the richest cell;
    - moisture (live only);
    - shade on the ground, relative to the darkest cell (live only).
  - `game/overlays.ts` (pure, tested) maps fields to 0..1. The ramps are one hue each, light to dark (`OVERLAY_RAMPS` in `palette.ts`). Opacity rises with the value, so low ground stays visible.
  - The viewer draws the overlay texture on a copy of the ground mesh over the scene (no depth test, like a map mode). Drawn under the canopy, it was hidden. Linear filtering, so cells never read as squares.
  - Sim: `shade_frame` and `moisture_frame` (`snapshot.rs`), views that are not hashed. The shade rule moved into `Flora::casts` and `Flora::light`, which `Flora::step` now uses, so the overlay and the rule cannot drift apart. The prototype parity is unchanged.
  - The display menu:
    - an overlay grid of round toggles that light up gold, with a legend (also shown on the map while the menu is closed);
    - a "Show" row of small round toggles for the old show/hide layers;
    - a segmented Low/Med/High quality control;
    - round toggles for group icons and the performance readout.
  - `FamilyIcon` gets a `bare` mode, so the strata reuse the build-bar pictograms.
- **Consequences:**
  - Tests: overlay values (soil, cover, relative shade, diversity with animals), ramp painting, the shade and moisture frames (Rust), the live plumbing.
  - Found in the browser: an `$effect` that read the (non-reactive) viewer before the overlay never re-ran.

## D-136 · 2026-10-05 · Planting feedback: a sprinkle from the sky
- **Status:** accepted (user: smaller particles that fall like a sprinkle from the sky, not a geyser)
- **Decision:** `render/seeds.ts`:
  - 24 seeds per click (was 12), half the size (0.06 m; at least 0.35 % of the camera distance);
  - they start 6–9 m above random spots of the planting disc, staggered by 0.03 s;
  - each falls in 0.9 s with gravity (`h·(1 − k²)`) and a sway that dies as it lands, then rests and fades as before.
- **Consequences:** the seed tests cover the fall (gravity: more than half the height left at half time), the landing and the fade.

## D-137 · 2026-10-05 · Play menu by mode
- **Status:** accepted (user: Play lists Sandbox, Multi, Ranked, AI opponent; Multi and Ranked greyed out for now; a mode opens map size and seed; the sandbox has no opponent)
- **Decision:**
  - Play shows the modes, in order:
    - Sandbox;
    - Multiplayer (disabled, "soon");
    - Ranked (disabled, "soon");
    - AI opponent.
  - Sandbox opens map size and seed. AI opponent adds the difficulty (easy / normal / hard).
  - `forMode` (`game/setup.ts`, tested) maps a mode onto the saved setup: sandbox means sandbox on and no bot; AI means sandbox off, keeping the chosen level (normal if none).
  - The mode is derived from `sandbox`, not stored, so old saves need no migration. URL overrides are unchanged.

## D-138 · 2026-10-05 · Time limit 600 min; robust end-screen charts
- **Status:** accepted (user: a draw at 60 min with flat curves at 0; remove the limit virtually, and make the end-screen curves render)
- **Decision:**
  - `[match] time_limit_s = 36000` (600 min). The territory threshold (90 %) now decides almost every match. The world test that plays a match up to its limit sets its own 120 s limit.
  - `LineChart` draws at most 400 points per line, sampled evenly with the last kept (`ui/chart.ts`, tested). It finds the top value with a loop, not `Math.max(...values)`: at 600 min a line has about 45 000 samples, too many to spread into arguments. It reads non-finite values as 0, and says "No data" when both players stay at zero.
- **Consequences:**
  - Balance hash changes (match rule).
  - Not reproduced in the browser: a 1-minute match and a headless 60-minute bot-vs-bot match (P2 won on territory at 51:50) both gave proper curves. A draw at the limit needs equal standing biomass and territory, in practice both at zero.

## D-139 · 2026-10-05 · A guided tutorial
- **Status:** accepted (user: guide through the UI, tips, spreading, plant layers, spawning and ordering animals; keep surprises)
- **Decision:** eleven steps (`game/tutorial.ts`). Each names its control, and most add a muted tip:
  1. welcome to the dashboard (Next);
  2. found the colony;
  3. spread to 4 %;
  4. read the soil: the four layers, soil built by herbs, turn on the Soil overlay;
  5. plant Grasses: done once they grow on your land, since the rabbits need them;
  6. grow a second layer with Ferns (taller layers smother lower ones at the front);
  7. open the tech tree;
  8. call rabbits;
  9. select them;
  10. raid with A + click;
  11. hold 55 %, with a teaser: "Not everything in this valley eats plants…".

  Not explained, kept as surprises: hunters, recyclers, dead trees, weather, catastrophes.
- Steps marked `ack` wait for a Next button. The tutorial state now carries:
  - the steps acknowledged;
  - the overlay shown;
  - the tech tree opened;
  - the highest plant layer held, and the plants held;
  - the animals selected.
- `TourPointer`: a pulsing gold ring with an arrow around the control the step names, found by `data-tour` keys (the resource and land bars, tech and display buttons, overlay toggles, build-bar families). It takes the first key on screen, so step 4 points at the display button, then at the Soil toggle inside the open menu.
- **Consequences:**
  - Tests: Next gating, the whole run in order, no skipping (e.g. Grasses unlocked but not planted), no going back.
  - The browser walk-through of steps 1–8 found that unlocking Grasses without planting them stranded the rabbits step. Step 5 now requires grasses on the map.

## D-140 · 2026-10-05 · Species page in the main menu
- **Status:** accepted (user: the in-game tech tree as the menu's Species page, without much work)
- **Decision:**
  - "Species" opens the tech tree (`TechTree`, D-124) over the menu, on a catalog source (`game/catalog.ts`, tested): every species unlocked (full-colour cards), zero counts (no enemy or counter marks), no series, nothing to buy.
  - The species table comes from `sim-wasm` on the main thread, loaded on demand, so it reads the same data files as a match.
  - Esc or Close returns to the menu.
- **Consequences:** the legend still names the in-match marks (enemy, counters), which never show on this page. Left as is (user: no need to work much on it).

## D-141 · 2026-10-05 · Tutorial: breeding, airdrops, and a raid answered by a hunter
- **Status:** accepted (user: teach breeding then the attack, the ×1.5 airdrop, and a bot raid with grasshoppers answered by great tits)
- **Decision:**
  - New tutorial steps: grow your herd (2 births), raid (A + click), airdrop a raid (×1.5), defend your meadows.
  - During the defend step, the client sends the bot's commands: grasshoppers dropped on the player's grass every 20 s, 6 waves, each with a grant.
  - `Payload::Grant` is accepted only in a tutorial match (`World::set_tutorial`, hashed, never with a relay). The tutorial never ends on territory.
  - Great tits now also eat grasshoppers.
  - `Live.wasCalled` tells called animals from born ones.
  - The defend step also completes if the bot cannot raid: Great tit unlocked, waves spent, no swarm on the map.
- **Consequences:**
  - Rust tests: a grant only in the tutorial; no territory win there.
  - TS tests: the step order and the defend fallback.
  - Browser run, every step in order to "Tutorial complete": the herd bred, the raid and the airdrop (×1.5) completed their steps, and great tits dropped on the swarm ended the defense.
  - The bot sat at its grasshopper cap, so the scripted waves were refused, but its own swarm was already on the player's land. The fallback covers a bot with no swarm at all.

## D-142 · 2026-10-05 · Balance pass 1: pacing and unit weight
- **Status:** accepted (user: early game 5–7 min, mid game peaking at 12–15 min, late game from 20 min, matches of about 30 min; each unit called should matter, no spam)
- **Decision:**
  - Tool: `sim-cli bench` (bot vs bot, threads, a compact marker table; `TRACE=<min>` for one match).
  - The bot as a player proxy:
    - strict unlock plan, ordered by phase, with savings when the next unlock is within 120 s of income;
    - undergrowth in succession;
    - swarm = one card; four grazer cards in total;
    - units before swarms; only calls that can land;
    - calls every third decision, raid drops every fifth with a reserve.
  - Data:
    - `pace` 1.0 → 0.75 (every ecological rate);
    - swarm caps 300 → 60–80, smaller cards, calls about 2–4× the price;
    - unit grazers: pricier calls, 3–4 per card, caps of 40, stronger bites and yields;
    - tier-3 grazers 6 000–9 000;
    - first hunters cheaper (Great tit 3 000, Kestrel 6 000);
    - Elder 2 500 and slower;
    - trees 9 000 / 12 000 / 16 000;
    - catastrophes 15 000 / 22 000 / 10 000;
    - Bramble, Hazel, Cattails and Black woodpecker raised to the late-game range.
- **Consequences** (normal vs hard, 8 seeds, median):

  | Marker | Before | After |
  |---|---|---|
  | First animal | 0:52 | 2:49 |
  | Shrubs | 35:31 | 18:04 |
  | First hunter | never | 18:10 |
  | Trees | 44:34 | 28:37 |
  | Catastrophes affordable | 44:05 | 25:56 |
  | Match end | 42:51 (5 of 8 unfinished) | 24–30 |
  | Calls per player-minute | 10.9 | 2.7 |
  | Swarm members | 300–675 | 80–140 |
  | Units at 20 min | 0 | 11 |

- **Open:** the levels show no difficulty ladder (outcomes depend on the map, not the level), since every level is money-limited. Next: difficulty by play quality (D-143).

## D-143 · 2026-10-05 · Balance pass 2: bot difficulty ladder and match length
- **Status:** accepted (follows D-142; the user asked for about 30-min matches and a real difficulty ladder)
- **Decision:**
  - Difficulty by play quality:
    - easy grows its tall plants at home, never raids, calls no hunters;
    - normal raids with a herd (at least 6 units) and calls hunters onto enemy prey;
    - hard adds airdrop raids and catastrophe cards (caterpillars on the enemy's densest woods, the storm on its tallest stands, the spill on the front).
  - Pacing is in game time and the same for every level: calls at most every 9 s, raids every 60 s, hard's drops every 45 s. Faster decisions no longer mean more waste: per-decision pacing made hard *weaker* than normal.
  - Bot income `[bots] income = [0.8, 1.0, 1.25]` (`World::set_income_factor`, hashed; set by `addBot` and the bench; never for humans or lockstep matches).
  - Victory (Q-013 resolved):
    - the decaying threshold of gamerules §11.3 is adopted;
    - it uses its own window: 90 % until 20 min (`decay_from_s`), 60 % at 40 min (`decay_to_s`);
    - the time limit stays 600 min;
    - the prototype mirrors the window.
  - Balance hash version 18.
- **Consequences** (30 seeds per side, normal vs hard):
  - Markers, medians:

    | Marker | Median |
    |---|---|
    | First animal | 2:43 |
    | Tier 2 | 5:43 |
    | Undergrowth | 12:40 |
    | Shrubs | 13:10 |
    | First hunter | 13:22 |
    | Catastrophes affordable | 19:18 |
    | Trees | 21:43 |
    | Tier 3 | 22:23 |
    | Match end | 30:11 (p25–p75 24–35) |

    Units: 7 at 10 min, 12 at 20 min. Calls per player-minute 1.8.
  - The ladder:
    - hard beat normal in 33 of 46 decided matches (72 %);
    - normal beat easy in 15 of 17 (12-seed runs).
  - Still off target: the biomass growth peak (20:30, since trees keep adding late biomass), and units at 20 min (12, below the 15–35 aim). Next lever if the playtest agrees: cheaper unit calls in the mid game.
  - Test fixes:
    - the relay test's earthworm call moved to tick 1 100 (calls cost more);
    - the Python decay test uses the window.

## D-144 · 2026-10-05 · Faster breeding; no waiting in the tutorial
- **Status:** accepted (user playtest: saving for Ferns and waiting for births broke the tutorial's rhythm)
- **Breeding worked, but slowly.** Measured: three rabbits on their own rich meadow grew to 9 in 4 minutes. The local food check needed 900 s of bites per animal in sight.
- **Change:**
  - `food_reserve` 900 → 300 s;
  - the rabbit breeding cooldown (`growth`) is 30 s.

  Now the herd doubles about every 40 s (3 → 6 → 12 → 21) and levels off near 30 on a 16² meadow. Test: `a_fed_herd_breeds_within_two_minutes`.
- **Bench** (normal vs hard, 16 seeds): units 10 at 10 min and 25 at 20 min (were 7 and 12); median end 30:28; the other markers unchanged.
- **Tutorial:**
  - Each step that costs biomass has a `need`. On entering the step, the tutorial tops the bank up to it with the tutorial-only grant (`topUp`): Grasses 500, Ferns 1 000, Rabbits 4 000, the airdrop 3 600, Elder + Great tit 7 000.
  - The herd step waits for one birth (was 2).

## D-145 · 2026-10-05 · Shortcut tips: Shift repeats a card, I shows group icons
- **Status:** accepted (user playtest)
- **First-match tips:**
  - "Hold Shift to plant or drop the same card again" (from 30 s);
  - "Press I for group icons, yours and the enemy's" (once you have 6 animals or after a raid alert).
- **Tutorial:** the same two hints on the Call rabbits and Command them steps.

## D-146 · 2026-10-05 · Enemy strategic icons
- **Status:** accepted (user playtest: "see where the threat is")
- **Decision:** the strategic icons (I) also show the enemy's groups. They have a dashed ring in the enemy's colour (`--enemy`), are not clickable, and have a tooltip such as "Enemy rabbits ×12". The same grouping applies (`strategicGroups` per owner); one toggle shows both sides.

## D-147 · 2026-10-05 · Territory victory at 80 %
- **Status:** accepted (user playtest: 90 % is too restrictive)
- **Decision:** `victory_territory` and `territory_start` 0.90 → 0.80. The decay to 60 % between 20 and 40 min stays.
- **Bench** (normal vs hard, 16 seeds): median end 25:12 (was 30:28). The stronger bots of D-148 are measured against it.

## D-148 · 2026-10-05 · Stronger bots
- **Status:** accepted (user playtest: bots far too easy; weak expansion, little aggression, slow tiers)
- **Behaviour** (`sim-ai`):
  - Actions per decision: 2 / 3 / 4 (were 1 / 2 / 3).
  - Ferns come before the first grazers in the unlock plan.
  - Per-level aggression (`Level::aggression`):

    | Level | Raids | Drop raids | Grazer cards kept |
    |---|---|---|---|
    | Easy | herd of 8 units, every 90 s | none | 4 |
    | Normal | herd of 4, every 45 s | every 90 s | 6 |
    | Hard | herd of 5, every 30 s | every 60 s | 8 |

  - Hard casts catastrophes only where the disc holds none of its own land, and only from the bank above its savings. Unguarded casts were hurting it: hard won 67 % without them, but only even with them.
- **Income:** `[bots] income` 0.8 / 1.0 / 1.25 → 1.0 / 1.3 / 2.0. Behaviour alone barely moved the timings: the economy is the bottleneck.
- **Match length:** the decay window moves to 25 → 45 min (`decay_from_s = 1500`, `decay_to_s = 2700`), so the stronger bots still play about 30-min matches.
- **Bench, 30 seeds:**
  - Normal mirror, medians:

    | Marker | Median |
    |---|---|
    | First animal | 3:10 |
    | Tier 2 | 5:52 |
    | Undergrowth | 5:55 |
    | First raid | 9:00 |
    | Shrubs | 12:07 |
    | Trees | 17:25 (was 21:43) |
    | Tier 3 | 20:34 |
    | Match end | 25:32 |

    Units at 10 min 14 (was 7); land 37 % at 5 min.
  - Hard beats normal in 46 of 52 decided matches (88 %), and normal beats easy in 18 of 20. Hard at 1.75 or 1.85 income gave only about 58 %, so the step is steep around 2.0.
- New bench markers: first raid, land at 5 and 10 min.

## D-149 · 2026-10-05 · Performance: static instance buffers, a 10 Hz HUD tick
- **Status:** accepted (user playtest: about 30 fps on Medium, mid to late game)
- **Diagnosis** (Large map, hard vs hard at 22 min, Medium, Chromium, WebGPU; 20 000 plant and animal instances; about 1.2 M triangles):
  - `viewer.render` took 27.7 ms of CPU (p90 44 ms), which caps the game near 30 fps.
  - Our own frame work took about 3.5 ms; `renderer.render` took 26 ms, of which `backend.updateAttribute` took 23 ms.
  - Cause: three.js r186 (`renderers/common/Attributes.js`) re-uploads every `DynamicDrawUsage` attribute in full on every render pass, changed or not. Every plant, animal and seed instance buffer was dynamic, so it uploaded twice a frame (main and shadow pass).
- **Fix:**
  - Instance buffers use static usage; three uploads them when their version changes, and only the marked ranges.
  - `GrowingMesh`'s custom attributes (root, grow, fall) are our own `InstancedInterleavedBuffer`s, fed to the static TSL `instancedBufferAttribute`, so `needsUpdate` reaches the GPU copy.
- **Result:** same state, CPU render 3.4 ms median (5.0 p90); uploads 0.13 ms a frame. The GPU side is not measured here (the test tab is in the background); the user confirms on the reference laptop.
- **Also:**
  - The HUD's `tick` is now a whole tick, updated at the sim's 10 Hz, while the renderer reads a fractional `frameTick`. TopBar, BottomBar and TechTree no longer re-render every frame.
  - New dev message `{ type: "bot", player, level }` hands a player to a bot (profiling a late game: `ecoLive.send` with speed 8).
- **Next strategies if the GPU is the limit** (not built):
  - shadow refresh every 4th frame on Medium, trees and rocks only;
  - plant LOD or impostors for far trees;
  - a lower resolution cap on Medium (1.25);
  - GPU culling per chunk;
  - moving `paintFields` into the worker;
  - chunk-level dirty updates for plants.

## D-150 · 2026-10-05 · Models v2 (branch `models-v2`)
- **Status:** proposed, on a branch (user: "a new code branch that can be quickly dropped"). Merge after the user's look and fps check.
- **Decision** (visual only: no sim, balance or hash change):
  - **Large animals** (length ≥ 0.4 m, `FINE_LENGTH`): smooth spheres, cones and cylinders with twice the segments, plus necks, hooves, a fuller muzzle and humps. Models have 3 880–4 488 triangles (were 820–1 120). Small animals keep the light model.
  - **Ground:** 4 subdivisions per cell (were 3, ×1.8). Rocks: icosahedron detail 1 with a broad and a craggy jitter.
  - **Trees by species:**
    - oak: short thick trunk, limbs, a broad low ring of lumps;
    - chestnut: stout trunk, a dense dome;
    - beech: tall grey trunk, a stacked oval crown.

    Each tree varies by its slot seed (lean, limb count, lump layout). Triangles: 572 / 472 / 432 (were 264 / 264 / 184). Shrubs unchanged.
  - **Undergrowth:**
    - ferns: rosettes of 6 arching fronds with square, stepped leaflets;
    - nettle: brushes of 5–7 straight stems with leaf pairs;
    - bramble: a dark mound with 4 thorny purple canes.

    240–332 triangles (were 60); they cast no shadow.
  - **Herbs:**
    - lichen and moss lie flat as rosettes;
    - wildflowers are shorter, with tips in one of four colours, one colour per 3 m patch;
    - each tuft picks its look from the cell's herb shares (a second texture).
  - Code: `render/shapes.ts` (new); the `PARTS` and `KEY_MESHES` key space is 12 × 16.
- **To check before merging:**
  - The visual look: the browser tool was disconnected, so it isn't checked in-session.
  - Late-game fps on Medium on the laptop. Estimated triangles a frame rise from about 1.9 M to 3–3.5 M; most of it is animals (they cast shadows) and trees.

## D-151 · 2026-10-05 · Models v2, round 2: herb shapes, reed beds, patchy stands, and fps (branch `models-v2`)
- **Status:** proposed, on the branch (follows the user's review of D-150)
- **Looks:**
  - **Herbs** are three static GPU meshes driven by the herb-mix texture. Each herb's tufts show where its cover (L1 cover × its share) beats the tuft's seed.
    - grasses: blades;
    - lichen and moss: flat, slightly domed, irregular round patches in white-grey, lichen yellow or moss green, one colour per 2 m patch;
    - wildflowers: round octahedron heads on thin stems, twice the old size, one of 4 colours per 3 m patch.
  - **Reeds:** 10 stems per clump (were 5); 25 % straw yellow and 15 % brown.
  - **Patchy stands:** a smooth value noise over a 3-cell lattice sets a per-cell density multiplier.
    - shrub stratum (bushes, cattails): 0.3–1.4, averaging 0.85, so 15 % fewer, in clumps;
    - undergrowth: 0.4–1.6, averaging 1;
    - `MAX_MODELS` (caps) and `BASE_MODELS` (average);
    - trees: two per cell on 15 % of cells (was 1/3), about 14 % fewer.
  - **Ferns and nettles:** single-sided leaves on double-sided materials. Ferns have 5 fronds of 5 steps, about 100 triangles (were 288). Nettles have 4–6 stems with 2 leaf pairs, about 70 (were 240).
- **Performance** (GPU timestamp queries now used: `renderer.backend.trackTimestamp`; same machine, Large map, bots both sides):
  - Mid game, the ground's fragment shader was the biggest GPU cost (about 7.7 of 14 ms for the scene pass): three Perlin noises per pixel. The water plane runs a 3D noise over the whole map.
  - Both now read one baked, tileable value-noise texture (`noiseTexture`, three channels).
  - Scene pass: about 8–11 ms mid game (was 14–25), 13.4 ms late game at 1.8 M triangles. CPU about 1.4–7 ms a frame.
  - Rain and dust move on the GPU (a static seed buffer, positions from `time` and the heights texture). This removes the per-frame CPU move and upload; 60 % of the particles below High.
  - Shadows are redrawn every 4th frame (was 2nd).
- **Not measured:** High's post-processing (bloom and tilt-shift at 1.5× resolution). The timestamps only cover the final pass there.
- **Left:** the field paint (`paintFields` with `PlantView.update`) takes about 34 ms once per field frame (1.25 Hz), a periodic hitch. Next levers: spread it over frames, or move it to the worker; post-processing at half resolution on High.

## D-152 · 2026-10-05 · Trampling grazers and shorter-lived trees
- **Status:** accepted (user: help break fronts in the late game)
- **Decision:**
  - `[fauna] graze_damage = 4.0`: on enemy land, plants lose 4× what a grazer eats; the extra goes to litter. The grazer's energy is unchanged (no faster breeding). The pressure lines count enemy grazers 4× too.
  - `[deadwood] natural_death_s` 10 800 → 3 600 (trees die of old age 3× as often).
  - Balance hash version 19.
- **Bench** (normal mirror, 30 seeds, 60 min):
  - more decided matches: 8 unfinished, were 12;
  - median end 25:25 (was 25:32);
  - trees settle at about 19:00 (were 17:25).

## D-153 · 2026-10-05 · No more plant-repaint hitch (branch `models-v2`)
- **Status:** proposed, on the branch (user: research the periodic stutter)
- **Diagnosis:**
  - At each field frame (1.25 Hz), `PlantView.update` rebuilt every cell's plant models: layout, parts, about 25 000 `put` calls.
  - Late game on a Large map that took about 113 ms in the profiling tab, which runs about 4× slower than a foreground tab (about 30 ms in a normal one): a dropped frame or two every 0.8 s.
  - The frontier blur added about 9 ms (a closure per sample).
- **Decision:**
  - **Signature skip:** each cell has a signature (owner, dead wood, modelled covers in steps of 8/255); the layout reads covers rounded to the same steps. Only cells whose signature changed are repainted: about 200–250 of 1 936 per field frame late game (88 % skipped).
  - **Spread over frames:** changed cells are queued and repainted in `PlantView.frame`, at most 3 ms a frame (`PAINT_BUDGET_MS`); about 8 ms of work spreads over 3 frames.
  - **Frontier blur:** separable, in place (rows, then columns): same result, a fraction of the cost.
- Test: `PlantView repainting` (queue, skip, budget).

## D-154 · 2026-10-05 · The fox comes before the pine marten
- **Status:** accepted (user: a quick rabbit counter)
- **Decision:** the fox and the pine marten swap slots in the small-mammal eaters (P2).
  - fox: tier 2, unlock 12 000, call 1 500, yield 0.25;
  - pine marten: tier 3, 16 000, 3 000, 0.5.

  Diets, habitats and bodies are unchanged. The bot unlocks the fox before the pine marten.
- **Bench** (normal mirror, 30 seeds): the fox is now the most-called hunter (390 calls); median end 25:49.

## D-155 · 2026-10-05 · Culled herb chunks, a lighter High, half the lichen (branch `models-v2`)
- **Status:** proposed, on the branch (user: late game on a Large map at about 30 fps on High; wants 5–10 fps more)
- **Measurement limit:** Chrome throttles the GPU of a background tab (about 200 ms per synced frame whatever the setting), so High's fps could not be measured in-session. The changes below are the ones that reliably cut GPU work on integrated graphics; the user confirms on the laptop.
- **Decision:**
  - **Herb chunks:** each herb mesh (grass, lichen, flowers) is split into 4 × 4 chunks (`HERB_CHUNKS`). Each has hand-set bounds (its square, the relief and the tallest herb), so three culls the chunks off screen. Before, the whole-map meshes were always drawn. Zoomed in, 9 of 48 chunks are drawn; the overview draws all.
  - **High preset:** resolution cap 1.5 → 1.25 (about 30 % fewer pixels for every fragment shader and the post passes), herb tufts per cell 18 → 14. Bloom and depth of field already run at half resolution.
  - **Lichen and moss:** half as many patches (`LICHEN.share` 0.5 → 0.25 of the grass tufts).

## D-156 · 2026-10-05 · A cheaper fox, a leaf cursor, a full-screen button
- **Status:** accepted (user)
- **Decision:**
  - Fox unlock 12 000 → 8 000: a quick rabbit counter (follows D-154).
  - **Leaf cursor:** a curved leaf-shaped arrow, leaf green with a bark outline and a pale vein (`public/cursors/leaf.svg`), golden over things you can click (`leaf-hover.svg`). The `--cursor` and `--cursor-pointer` tokens replace `pointer` and `default` everywhere. Planting keeps its crosshair and dropping its ghost.
  - **Full screen:** a button in the top-right row, before the menu, toggles the browser's full screen; its icon follows the state (Esc also leaves).

## D-157 · 2026-10-05 · Static deploy on Cloudflare Pages (M5a 9)
- **Status:** accepted; it goes live once the user's Cloudflare project, token and account id exist
- **Decision:**
  - The CI client job (it already gets the WASM package from the rust job, lints, checks and tests) builds the client with `VITE_BUILD` = commit · date and `VITE_FEEDBACK_URL` from the repo variable `FEEDBACK_URL`.
  - On pushes to `main` it deploys `client/dist` with `cloudflare/wrangler-action@v3` (`pages deploy`), only when the repository variable `CLOUDFLARE_PAGES_PROJECT` and the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set. Until then CI skips the step and stays green.
  - `npm run deploy` does the same by hand (`npx wrangler@4`, after `wrangler login`).
  - The main menu shows the build and a "Send feedback" link (hidden without a URL).
  - `.env.example` documents both variables (INSTRUCTIONS §14); `src/env.d.ts` types them.
  - The cross-origin headers ship in `public/_headers`. The bundle is 4.5 MB (WASM 1.4 MB), under the 30 MB budget.

## D-158 · 2026-10-06 · Enemy group icons in solid red
- **Status:** accepted (user, Alpha 2)
- **Decision:** enemy strategic icons get a solid red ring (`--threat: #d8392b`), not the dashed one in the enemy's colour (D-146).

## D-159 · 2026-10-06 · A lighter selection aura
- **Status:** accepted (user, Alpha 2)
- **Decision:** the selected cell's fog ring is less dense, fainter and thinner:
  - 20 smoke puffs (were 48);
  - two layers (were three), opacities 0.6 / 0.3;
  - ring alpha 0.28 / 0.16 (was 0.5 / 0.32);
  - a band of radii 88–116 of 256 (was 64–120).

## D-160 · 2026-10-06 · Raids graze the area bare
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - An attack order no longer ends on arrival. Attack-movers keep seeking enemy food they eat (hunters: enemy prey) within their sight. With nothing in sight they head to the goal, and once there (within one cell) with nothing left, the order ends and they go free.
  - Move orders still end on arrival.
- **Frame (D-161):** `Fauna::frame` adds fullness (energy over body, 0..255) and the order per animal, 12 bytes (`FRAME_BYTES`). The client decoder, the relay test and the fixtures follow.
- **Bench** (30 seeds):
  - normal mirror: median end 25:30 (unchanged);
  - hard vs normal: hard wins 23 of 27 decided (was 46 of 52), 3 unfinished.

## D-161 · 2026-10-06 · Unit selection and the unit card
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - **Selection:** a click on an animal (anyone's, within 14 px) selects it when it is yours and shows its card; a click elsewhere inspects the cell. A box selection also shows the card of the selected group.
  - **Card** (`ui/UnitPanel.svelte`, stacked under the cell card on the right):
    - species, count, owner and role;
    - a fullness bar;
    - the order (Free / Moving / Raiding);
    - top speed;
    - "Eats" and "Hunted by" icons (`related`).
  - It follows the animals every tick (`game/units.ts` `unitCard`), and shows the group under the pointer while a strategic icon (own or enemy) is hovered.
  - The animal frame carries fullness and order (D-160). The species table carries `speed`.

## D-162 · 2026-10-06 · Order lines
- **Status:** accepted (user, Alpha 2)
- **Decision:** a move or attack order draws a faint curved ribbon on the ground, from the ordered group's centre to the goal (`render/orders.ts`):
  - 0.22 m wide, bent sideways by 18 % of its length, draped on the relief, opacity 0.4;
  - silvery grey (`#c9cdd2`) for a move, fire red (`#e2452b`) for an attack.
  - It shortens as the group goes, and disappears once no animal still follows the order (the animal frame's order byte) or they are all dead.
  - A newer order takes the animals off their older line.

## D-163 · 2026-10-06 · A bigger cell card
- **Status:** accepted (user, Alpha 2)
- **Decision:** the cell card is 340 px wide (was 214; about 2.5× the area), with titles only:
  - a header in the owner's colour: Yours / Enemy / Free land, the ground, a health word (Thriving / Pushed / Under attack), lock and dead-tree chips, zoom and close;
  - one titled full-width bar with a percentage per layer (Herbs, Undergrowth, Shrubs, Trees, in green shades), then Soil and Enemy push;
  - plant icons with their cover;
  - your animals and the enemy's in separate rows.

  The cell and unit cards stack in one right-hand column.
- **Order lines, follow-up (D-162):** a new line ignores the animals' old order byte for 1 s, since the sim takes the order a tick or two later (lockstep delay).

## D-164 · 2026-10-06 · Main menu title, tagline and a moving background
- **Status:** accepted (user, Alpha 2 polish)
- **Decision:**
  - **Title:** "ECO" in moss green `#7fa650`, "CLASH" gold, a dark outline (`-webkit-text-stroke`) and a layered shadow.
  - **Tagline:** "Grow your ecosystem. Outgrow your opponent."
  - **Background** (CSS only):
    - the blurred sky drifts (Ken Burns, 60 s);
    - three hill planes slide at their own pace (parallax, 40 / 55 / 80 s);
    - soft light motes rise.

    Still under `prefers-reduced-motion`.

## D-165 · 2026-10-06 · Match setup polish
- **Status:** accepted (user, Alpha 2 polish)
- **Decision:**
  - The AI opponent setup has no heading; Sandbox keeps its short one.
  - START and BACK are centred.
  - The selected difficulty and map size wear the primary buttons' mustard (gold border and gradient); the choices glow gold on hover.

## D-166 · 2026-10-06 · A game-like Options screen
- **Status:** accepted (user, Alpha 2 polish)
- **Decision:** Options (`ui/OptionsMenu.svelte`) has three tabs:
  - **Graphics:** the quality presets as cards with signal bars and a one-line hint.
  - **Interface:** strategic icons, performance readout and first-match tips as sliding toggles.
  - **Controls:** the shortcuts as keycaps beside their action.

  The active tab, the chosen preset and an "on" toggle wear the menu's mustard; BACK is centred. The settings and their storage are unchanged.

## D-167 · 2026-10-06 · An icon per species
- **Status:** accepted (user, Alpha 2 polish)
- **Decision:** every species gets its own filled silhouette (`ui/glyphs.ts`, 45 in a 24 × 24 box), drawn on its family's tile and tone:
  - animals in side view facing right (a rabbit, a bison, a fox, a heron…);
  - plants as their shape (a grass tuft, daisies, a fern frond, an oak's crown, cattails…).

  Built from primitives (ellipses, polygons, thick segments), one SVG path each, so overlaps never cancel.
- **Where:**
  - `SpeciesIcon` uses them everywhere a species shows (build bar cards, cell and unit cards, end screen);
  - strategic icons show the group's species;
  - the build bar's family tiles keep the family pictograms;
  - a dropped `.webp` still takes precedence (D-048).
- **Test:** every species of the stat sheet has a glyph inside its box.

## D-168 · 2026-10-06 · Bigger small-animal caps, wider herbs, fewer lichen patches
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - Caps of the 12 small animals ×2: earthworms and fungi 160; grasshoppers, slugs, caterpillars, bark beetles, larvae and frog 120; rabbits, bank vole, red squirrel and roach 80.
  - Expansion caps of herbs and undergrowth ×1.5: lichen and grasses 0.75, wildflowers, nettle and bramble 0.3, ferns 0.45.
  - Lichen and moss patches at 0.125 of the grass tufts (render).
- **Bench** (normal mirror, 30 seeds):
  - median end 27:20 (was 25:30), 5 unfinished;
  - swarm members at 10 min 280 (were 140);
  - units 6 at 10 min and 17 at 20 min: swarms now share the food.

## D-169 · 2026-10-06 · Unlock feedback: armed in hand, and a pop
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - Once the worker confirms an unlock, the species is armed at once (the next map click plants or drops it).
  - Its card and family tile play a 0.6 s pop (a swell and a fading gold ring).
  - The tutorial's Grasses step says so.

## D-170 · 2026-10-06 · Short red notices
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - Orders that did nothing show as red toasts in a few words (`game/notices.ts` `shortNotice`): "Elder: need more [biomass icon]" (the biomass icon in green), and "Oak: nothing took root".
  - Unlock infos read "Elder: available".

## D-171 · 2026-10-06 · Smooth strategic icons
- **Status:** accepted (user: icons stuttered and froze while panning)
- **Cause:** grouping and screen placement both ran every 100 ms, so while the camera panned at 60 fps the icons jumped 10 times a second behind the map.
- **Decision:** grouping stays at 10 Hz (cell positions); the icons are projected to the screen every frame, after the camera moved.

## D-172 · 2026-10-06 · Locked cards name their habitat plants
- **Status:** accepted (user, Alpha 2)
- **Decision:** a locked animal card reads, for example, "tier 1 + Elder, Hawthorn or Hazel first" (`lockText`, `habitatPlants`, `orList` in `game/species.ts`), not "+ habitat plant". The tech tree uses the same names. A tier-1 animal locked only by its habitat no longer says "tier 0".

## D-173 · 2026-10-06 · No drought dust; half the bushes, scattered; oak and chestnut swapped
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - **Drought:** shows in the light, haze and tint only (no dust particles).
  - **Bushes (shrub stratum, cattails included):**
    - patch density 0–0.9 (mean about 0.45, half of D-151);
    - a cell may have none where the patch thins (no one-bush-per-cell floor);
    - a finer patch noise (2-cell lattice).

    Stands come and go instead of lining up.
  - **Trees:** the oak and the chestnut wear each other's model.

## D-174 · 2026-10-06 · Unit list on the left
- **Status:** accepted (user, Alpha 2)
- **Decision:** a titleless list at the left edge (`ui/UnitList.svelte`) of your controllable animals on the map, by species in the build bar's order, each an icon with its head count. A click selects every animal of that species. Swarms are not listed (they cannot be ordered).

## D-175 · 2026-10-06 · Victory marks on the tug bar; a speed bar
- **Status:** accepted (user, Alpha 2)
- **Decision:**
  - **Victory marks:**
    - `World::threshold()` exposes the share that wins now (the decay included); `victoryNow` (sim-wasm, display only) rides each field frame into `Live.victoryNow`;
    - the tug bar shows a green mark where your bar wins and a red one where the enemy's would, from each side, moving as the threshold decays.
  - **Speed bar:** under the clock, four buttons with one to four stacked chevrons for ×1, ×2, ×4, ×8 (the active one in mustard), instead of the dropdown (×16 and ×32 dropped).
  - **Layout:** the armed card's prompt moves above the build bar; the tutorial objectives move below the speed bar.

## D-176 · 2026-10-06 · Procedural audio, with a seam for recorded sounds
- **Status:** accepted (user, Alpha 1.1: "small sound effects"; new to game audio, asked for best practices)
- **Decision:**
  - **Graph:** one Web Audio graph (`client/src/audio/`): buses (ui, fx, ambience, music) into a master gain and a soft compressor. It starts on the first gesture and sleeps while the tab is hidden; the volumes are saved per browser.
  - **Sounds:** every sound is a procedural recipe (`sounds.ts`: enveloped tones and filtered noise).
    - Interface: click, open, unlock chime, error, info, tip, alert.
    - World: plant patter, drop thump, order click, storm, spill and caterpillar cues.
    - Animal voices by body: bird, woodpecker, heron, duck, insect, small mammal, large mammal, hunter, frog, fish. Slugs, worms and fungi stay silent.
  - **Repetition:** each play varies pitch and volume; cooldowns and voice limits per bus.
  - **Space:** world sounds pan by screen position and stay silent off screen.
  - **Ambience** (`ambience.ts`): wind, rain, dry-wind and water beds with birds, cicadas and drops, crossfaded by weather. Birds come closer as the camera does; a quieter menu bed; hushed while paused.
- **Seam:** `public/audio/manifest.json` (an array of sound ids) lists recorded `public/audio/<id>.ogg` files that replace their recipe. One request, no probing; CC0 or royalty-free files, logged in `ASSETS_LICENSES.md`.
- **No dependency.** The download grows by code only.

## D-177 · 2026-10-06 · Where sounds play
- **Status:** accepted
- **Decision:**
  - any button or choice clicks;
  - each toast kind has its cue;
  - an unlock chimes with its pop;
  - planting patters, a call or drop thumps then the species calls, an order clicks;
  - catastrophes have their cue;
  - the weather sets the ambience (an alert fades it in part way);
  - every 2.5 s an animal on screen may call (more often when zoomed in).

## D-178 · 2026-10-06 · Audio options
- **Status:** accepted
- **Decision:** an Audio tab in Options (master, interface, effects and ambience sliders with a preview, a mute switch); M mutes in game.

## D-179 · 2026-10-06 · Sound tweaks: plant groups, a felt click, life, water, howls, munching
- **Status:** accepted (user, after listening)
- **Decision:**
  - **Planting** is louder, with one sprinkle per group: high and light for herbs and undergrowth, fuller for shrubs, deep for trees, watery drops for water plants.
  - **Button click:** a soft, low brown-noise tap.
  - **Birds and insects** follow life: silent on bare land, half once you unlock a shrub, full with a tree. Soft insects join the clear-weather mix. The menu keeps its birds.
  - **Water:** maps with water get plops and trickles now and then.
  - **Drops:** a dropped animal calls in 60 % of drops; the wolf howls.
  - **Munching:** enemy swarms on your land (3 or more on screen) munch, at most every 2.2 s.

## D-180 · 2026-10-06 · Generated ambient music
- **Status:** accepted (user: soft, atmospheric, liquid, Minecraft-like ambient music)
- **Decision** (`client/src/audio/music.ts`, on the music bus):
  - **Instruments:** a felt-piano voice (a sine with soft octave and twelfth harmonics, a 4–6 s decay) wandering over slow major-seventh chords (Cmaj7, Am9, Fmaj7, G6sus; 9 s each), with a low note at each chord, a quiet detuned pad, rests, and a long generated stereo reverb.
  - **When:** the main menu plays it all the time. A match starts with 40 s of silence, then 2–3 min pieces separated by 6–11 min of silence.
  - **Recorded track:** list `music.menu` or `music.game` in `public/audio/manifest.json` and add `public/audio/music.menu.ogg` / `music.game.ogg`; the file replaces the generated music.
  - A Music slider in Options → Audio.

## D-181 · 2026-10-06 · Three wind voices
- **Status:** accepted (user: two more wind variations in pitch, brown-like noise and rhythm)
- **Decision** (`ambience.ts`): the wind bed is three voices under the same `wind` level:
  - the breeze (lowpass 380 Hz, as before);
  - a low gust on true brown noise (a seamless 4 s random-walk buffer, lowpass 200 Hz, two unrelated filter swells at 0.031 and 0.113 Hz, so the rhythm never repeats);
  - a high whistle (bandpass 1100 Hz, Q 2.5, its centre drifting at 0.02 Hz).

  Every 25–45 s one voice takes the lead (`windWeights`) and the others stay low, crossfading over 8 s.

## D-182 · 2026-10-06 · Animals answer selection and orders
- **Status:** accepted (user: every selectable animal has a sound, with a chance on drop, selection or move)
- **Decision:** one of your selected animals on screen calls with a chance of 0.5 on any selection (click, box, unit list, strategic icon, control group) and 0.35 on a move or attack order; drops keep 0.6. A 1.2 s cooldown per voice. New voices replace generic ones:
  - the kestrel gets a raptor "kee-kee";
  - the badger, pine marten, otter and red squirrel get a chitter;
  - the brown bear gets a low growl.

  A test checks every non-swarm species against a recipe.

## D-183 · 2026-10-06 · Click pitch variety
- **Status:** accepted (user)
- **Decision:** `ui.click` varies its pitch by 14 % (6 % before) and draws one of three tap colours (×0.86 / ×1 / ×1.19) per press.

## D-184 · 2026-10-06 · Leaf cursor over the map
- **Status:** accepted (user bug report)
- **Cause:** three's `MapControls` writes an inline `cursor: auto` on the canvas (in `disconnect()`, run by `connect()`). The inline style beat the inherited leaf cursor, so the map showed the system arrow.
- **Fix:** `canvas { cursor: var(--cursor) !important; }` in `app.css`; the planting crosshair and the hidden drop cursor are `!important` too. Checked in the browser: inline `auto`, computed leaf.

## D-185 · 2026-10-06 · Sound design pack
- **Status:** accepted (user picked ideas 2, 3, 4, 5, 6, 7 and 9 of the proposal)
- **Decision:**
  - **Adaptive music:** a raid alert on your land turns the music tense for 45 s: minor chords (Am9, Fmaj7, Dm9, Esus) and a low pulse every 1.6 s. A piece starts at once if none is playing (`music.alarm()`).
  - **Family motifs:** each tech family unlocks with its own 3-note motif (`ui.unlock.<family>`): grasses airy and high, trees low and woody, water gliding, recyclers earthy, grazers bright, hunters minor and sly.
  - **Stingers:** victory gets a warm rising cadence, defeat a hollow falling one, both on the music bus.
  - **Macro layer:** zoomed in close (closeness > 0.65) on living land, a wingbeat flies across now and then and leaves rustle.
  - **Woodpecker drumming:** a roll every few seconds on dead wood on screen.
  - **Pre-rumble:** a low swell when a weather alert begins, and under an enemy catastrophe.
  - **Growth creaks:** a wood creak when a cell's canopy cover on screen crosses 200/255 (camera close).

## D-186 · 2026-10-06 · Bigger maps: Mid 38, Large 56
- **Status:** accepted (user: more room for terrain diversity before the balance pass)
- **Decision:**
  - the match setup offers Small 24, Mid 38, Large 56 (were 24 / 32 / 44);
  - `[sim] grid_size` 32 → 38, so the default and lockstep matches are 152 m across;
  - the relay test follows the size.
- **Bench** (normal mirror, 30 seeds, the old roster):

  | Marker | 32² | 38² |
  |---|---|---|
  | First hunter | 13:58 | 11:34 |
  | Units at 10 min | 6 | 15 |
  | Median end | 27:20 | 27:52 |
  | Unfinished at 45 min | 5 | 10 |

  The roster rework (D-187) follows.
- **Risk:** 56² has 1.6× the cells of 44²; Large on High needs a check on the reference laptop.

## D-187 · 2026-10-06 · Food-web rework: cheap counters, hunter hunters, tier harmony
- **Status:** accepted (user: harmony between cheap early raids and affordable defence; predators of predators; no tier weaker than the one below; eaters inversely proportional to tier and cost)
- **Flaws found:**
  - Counters cost 5–15× the raids they answered: the great tit's path was 5 500 against grasshoppers' 600, the fox's 16 500 against rabbits' 1 600.
  - The fox sat behind the kestrel, which didn't eat rabbits.
  - Late grazers (beaver, bison, red deer, boar) had a single eater that a 25-min match never reached.
  - No land hunter had a predator.
  - Five cheap species had one eater.
  - The P2 marten (t3) was weaker than the fox (t2); the chestnut (t2) yielded less than the oak (t1).
- **Decision** (`data/species.toml`):
  - **New family S, "Hunter hunters":**
    - hawk (the kestrel, renamed; covers kestrel, hobby and sparrowhawk): tits, voles, grasshoppers;
    - wildcat: weasels, hawks, squirrels;
    - eagle-owl: foxes, hawks, herons.
  - **Weasel** replaces the kestrel as P2 tier 1: voles, rabbits, tits.
  - **Cheaper hunters:**
    - great tit 800 (lives on meadows too);
    - fox 4 000 (meadows too);
    - lynx, wolf and bear 6 000 / 9 000 / 14 000;
    - water hunters 2 500 / 4 500 / 8 000.
  - **Diets rebalanced** so the eater counts follow the tier bands (gamerules §4.3).
  - **Rule-2 fixes:** marten body 3 500; chestnut yield 0.85, k_max 62 000.
  - **Sim:** predator diets are `u64` masks (the hash is unchanged), and the fauna limit is 64.
  - **Guard test:** `sim-core/tests/food_web.rs` checks both rules.
  - **Client:**
    - family name, pictogram (an owl face) and food-web slot;
    - forms and silhouettes for the weasel, wildcat and eagle-owl;
    - voices: hawk "kee-kee", eagle-owl hoot, wildcat yowl, weasel chitter;
    - an S unlock motif.

## D-188 · 2026-10-06 · Bot plan and tutorial follow the roster
- **Status:** accepted
- **Decision:**
  - The bot unlocks the great tit and weasel right after the first grazers, the hawk in the shrub phase, then the fox, wildcat, lynx, marten, eagle-owl and wolf.
  - The tutorial's defence step asks only for the great tit (need 1 500, was 7 000 with Elder).

## D-189 · 2026-10-06 · Bench after the rework; hard bot income 1.5
- **Status:** accepted
- **Bench** (38², 30 seeds):

  | Marker | Old roster | New roster |
  |---|---|---|
  | First hunter | 11:34 (never 3) | 6:10 (never 0) |
  | Units at 10 min | 15 | 26 |
  | Median end, normal mirror | 27:52 (10 unfinished) | 25:20 (1 unfinished) |

  Top calls: rabbits, grasshoppers, earthworms, great tit, weasel.
- **Ladder:**
  - With cheap counters, hard (income 2.0) beat normal 27 of 28 (96 %); 1.8 still gave 96 %.
  - `[bots] income` for hard 2.0 → 1.5: hard beats normal 25 of 28 (89 %), median end 20:57.
  - Normal beats easy 18 of 18.
- **Open:** match length vs hard (about 21 min) is shorter than the mirror; watch it in playtests.

## D-190 · 2026-10-06 · Bench markers for situational play
- **Status:** accepted (user: the bench must show the bots unlock and use units adapted to the situation, the whole roster, water included)
- **Decision** (`sim-cli bench`), new summary lines:
  - **Animals called / never called;** species never unlocked.
  - **Raids answered:** a raid is 3 or more enemy grazers on own land; it closes after 30 s without them. A raid is answered by the first own call of a hunter that eats one of the raiders. Reported as a share, a median latency, and the share answered within 60 s.
  - **Hunter calls with prey within the drop radius:** primary prey, any prey.
  - **On water maps:** sides that unlocked W / HW / PW species; HW and PW calls per match.
- **Baseline** (old bot, normal mirror, 30 seeds):
  - 12 of 33 animals ever called;
  - raids answered 719 / 868 (median 8 s);
  - primary prey in reach 48 %;
  - water maps 26 / 30, with no water species ever unlocked.

## D-191 · 2026-10-06 · Bots read the map and answer what they see
- **Status:** accepted (user: unlock and use units adapted to the situation, not a fixed script)
- **Decision** (`sim-ai`):
  - **Intel** per decision, from the map only, never the enemy's cards:
    - enemy animals on the bot's land (raiders), near its animals that they eat (stalkers), anywhere;
    - plant cells per side;
    - water.
  - **Threats,** weighted by call cost, each lasting the level's reaction time before an answer:

    | Level | Answers | Reaction time |
    |---|---|---|
    | Easy | raids | 60 s |
    | Normal | raids and stalkers | 15 s |
    | Hard | everything it sees, including anticipation | 0 s |

    Recyclers threaten nothing.
  - **Unlock goal:** the next step on the cheapest-path eater of the worst threat (diet rank first, then the path cost: price plus the missing lower tier and habitat plant); otherwise the backbone plan. The plan now lists every land card; savings follow the goal.
  - **Hunters** (`defend`): the hunter with the best diet rank for the threat, dropped where most of those animals are. Then normal and hard hunt the best-ranked prey nearest home. Easy now answers raids too.
  - `Economy::card` / `habitat_of`: read-only accessors.
- **Data fix:** the pine marten's habitat becomes shrubs or trees (L3, L4), as D-187 planned.

## D-192 · 2026-10-06 · Food-aware grazers, a raid fund, water play
- **Status:** accepted
- **Decision:**
  - **Food scores:** grazers are scored by their food on a side's land (primary 4, secondary 2, tertiary 1, times plant height squared), less the enemy hunters that eat them. The score is spread over the cards already out, so the herd diversifies; units still come before swarms.
  - **Raid fund:** `spare` keeps the next raid drop's price when it is within 120 s of income. A drop then needs only its own price (it needed 3 drops spare, which kept big grazers out of reach).
  - **Recycler cards:** up to 3.
  - **Water:** on maps with shallows, the water cards join the plan by phase, and `expand` puts algae on shallow border cells (each border cell takes the first spreader that suits it).
- **Tests** (`sim-ai`):
  - a grasshopper raid → great tit;
  - a rabbit raid → weasel, then fox;
  - hard takes the tit ahead of its plan on seeing grasshoppers, easy does not;
  - a stalking weasel → wildcat, not the marten;
  - a water map → algae held in the shallows.

## D-193 · 2026-10-06 · Bench after the bot rework
- **Status:** accepted, with open gaps
- **Bench** (normal mirror, 30 seeds, 38²):

  | Marker | Before | After |
  |---|---|---|
  | Animals called | 12 / 33 | 24 / 33 |
  | Species never unlocked | 20 | 0 |
  | Raids answered | 83 %, median 8 s | 94 %, median 8 s (91 % within 60 s) |
  | Hunter calls with primary prey in reach | 48 % | 80 % |
  | Water-map sides using W / HW / PW | 0 % | 100 / 57 / 46 % |
  | Median end | 25:20 | 25:43 |

  Ladder: hard beats normal 25 of 28; normal beats easy 17 of 18.
- **Still unused:** roe deer, caterpillars, bark beetles (swarms lose to units), mallard, heron, otter (water hunters only meet enemy water prey), pine marten, wolf, brown bear (late tiers that 25-min matches rarely reach).
- **Tried and reverted:**
  - extra card slots for species not yet out: more calls, slower tiers, 11 unfinished;
  - waiting for the best unit instead of a cheaper swarm: no gain.

## D-194 · 2026-10-06 · The bot founds in varied places
- **Status:** accepted (user: the bot always started in the lower-right corner)
- **Cause:** `Bot::found` aimed at `terrain::homes(n)`, a fixed point at (n/4, n/4) and its mirror.
- **Decision:**
  - **Candidates:** free cells its spreader suits, on the bot's half (across the anti-diagonal), at least a third of the map from enemy land.
  - **Scoring:** the best cell per 6 × 6 block, by suitability plus a bonus for shallows within 2 cells.
  - **Pick:** among the best 4, a map fingerprint (elevation and ground) chooses. Deterministic, no RNG.
  - **Fallback:** the old clearing rule when no site qualifies.
- **Test:** over 10 seeds, at least 5 distinct sites, all on the bot's half.

## D-195 · 2026-10-06 · Menu raindrop, trunk click, quieter defaults, map-wide animal calls, softer rain
- **Status:** accepted (user playtest)
- **Decision:**
  - **Hover:** `ui.hover`, a soft wet raindrop (a quiet rising bloop and a faint splash), when the pointer reaches a new main-menu button.
  - **Click:** `ui.click` is a knock on a thick trunk: brown noise lowpassed 260 → 110 Hz, a 95 Hz body, a short 190 Hz mode. The tap colours narrow to ×0.9 / 1 / 1.1.
  - **Default volumes:** master 0.75, interface 0.9, effects 0.5, ambience 0.4, music 0.4. The storage key moves to `ecoclash.audio.v2`, so the new defaults reach everyone once.
  - **Animal calls:** every 3–8 s, with a chance that grows with the animals on the map, a random animal anywhere calls. On screen it calls from its place; off screen, a distant call at 0.2 from its side.
  - **Rain:**
    - the bed is lowpassed at 1 600 Hz (it was a 2 600 Hz bandpass), at gain 0.1 (was 0.18);
    - the drops are quieter (0.03) and lower (1.2–3.5 kHz).

## D-196 · 2026-10-06 · Hunters eat before they strike again
- **Status:** accepted (user: two weasels or foxes must not repel a prepared rabbit raid)
- **Cause:** a meal is tiny next to a hunter's body (a rabbit gives a fox 60 energy of its 3 000), so it never felt full. It struck every flora tick at 0.5 chance: two foxes erased 12 rabbits in about 10 s.
- **Decision:**
  - `[fauna] handling_s = 15`: after a kill, a hunter eats for 15 ecology seconds (about 20 real seconds) before it strikes again.
  - It is a new per-animal clock, `Agents::digest` (hashed), separate from the breeding cooldown. `serde(default)` gives 0 (no handling) for older balance files such as the parity fixture.
  - Balance hash version 20.
  - The Python prototype's fauna is not parity-checked (D-034 covers flora) and keeps the old rule.
- **Test:** two foxes among 12 rabbits, every strike landing, kill 2–4 in 30 real seconds.
- **Bench** (30 seeds):

  | Marker | Before | After |
  |---|---|---|
  | Units at 20 min | 2 | 23 |
  | Hunter calls with primary prey in reach | 80 % | 98 % |
  | Median end | 25:43 | 25:38 |

- **Ladder:** hunting had been what set the levels apart, so the bot incomes move:

  | `[bots] income` | Before | After |
  |---|---|---|
  | Easy | 1.0 | 0.8 |
  | Normal | 1.3 | 1.3 |
  | Hard | 1.5 | 2.0 |

  Hard beats normal 19 of 27; normal beats easy 12 of 16.

## D-197 · 2026-10-06 · "Superpredators"
- **Status:** accepted (user)
- **Decision:** family S (hawk, wildcat, eagle-owl) is named "Superpredators" in the UI and the docs (it was "Hunter hunters").

## D-198 · 2026-10-06 · Perf panel and the `?perf=1` bench (branch `optimization-v3`)
- **Status:** accepted (user: deep performance pass before Alpha 1.1; late game at about 30 fps on Mid/Medium and 15 fps on Large/High)
- **Decision:**
  - **The perf readout** (Display → performance) gets a detail panel:
    - smoothed JS time per section: app, icons, fields, plants, animals, scene, submit;
    - GPU time of the render pass via WebGPU timestamp queries (`trackTimestamp`), only when `?perf=1`;
    - triangles and draw calls per family (herbs, plants, animals, ground, rocks, water, dead trees) and the shadow casters, from `userData.family` tags.
  - **`?perf=1[&map=mid|large][&minute=22]`:** a Large map, both sides played by the hard bot at 8× until the minute, then 10 s measured at 1× from the overview. Fps, median, 90th percentile, JS sections, GPU and census go to the console and `window.ecoPerf`.
- **First reading:** on an empty Mid map, the herbs already submit 393 k triangles, because every tuft of every cell is drawn, scaled to zero when hidden. Measured at minute 22 on a Large map: 1.16 M triangles, 79 draw calls, herbs 57 %.
- **Limit:** a background browser tab gets no animation frames and a throttled GPU, so frame rates must be read on the reference laptop.

## D-199 · 2026-10-06 · Herb level of detail (branch `optimization-v3`)
- **Status:** accepted (perf plan item 1)
- **Decision:**
  - **Rank-major tufts:** every cell's first tuft comes before any second, with a `rank` attribute.
  - **Per-chunk draw range:** each frame, a herb chunk draws only the tufts its nearest point can show (`herbBudget`): all within `near` m of the camera, falling to the share `min` by `far` m. The vertex work of far tufts is skipped.
  - **Shader:** the vertex shader applies the same budget per tuft and widens the kept tufts by 1/√share, so the meadow keeps its cover from afar.
  - **Presets** (`quality.ts` `herbLod`):

    | Preset | `near` | `far` | `min` |
    |---|---|---|---|
    | Low | 20 m | 70 m | 0.3 |
    | Medium | 25 m | 90 m | 0.35 |
    | High | 30 m | 110 m | 0.4 |
- **Measured** (Mid, Medium): herb triangles at the overview 393 k → 143 k (−64 %). Close up, full density.

## D-200 · 2026-10-06 · Pixel cost: Medium at 1×, dynamic resolution, no MSAA on Low (branch `optimization-v3`)
- **Status:** accepted (perf plan item 2)
- **Decision:**
  - **Medium pixel-ratio cap** 1.5 → 1. It rendered more pixels than High (1.25).
  - **Dynamic resolution** (`ResolutionGuard`): the render scale (times the preset cap) steps down by 0.1 to a floor of 0.7 after a second whose average frame time stays above 25 ms (under 40 fps), and back up after 4 s below 18 ms. It guards against the deep late-game drops without chasing 60 fps at a blurry scale. The perf panel shows `res`.
  - **Antialiasing:** MSAA is off on Low, on for Medium and High.

## D-201 · 2026-10-06 · Animal level of detail and fewer per-frame allocations (branch `optimization-v3`)
- **Status:** accepted (perf plan item 3)
- **Decision:**
  - **Two models per fine species** (rabbit size and up):
    - within 45 m of the camera, the fine model, which casts a shadow;
    - beyond, the coarse model (about a quarter of the triangles), with no shadow.
  - **Eyes** are always the plainest icosahedron (20 triangles), not a 320-triangle sphere.
  - **Fewer per-frame allocations:**
    - the per-animal heading map is persistent, mutated in place, its dead entries dropped by a frame stamp;
    - motion and colour writes are indexed, with no array literals;
    - `interpolate` builds its id lookups once per pair of animal frames, not every frame;
    - `OrderLines.update` returns at once with no order lines.
- **Measured** (Mid, minute 10, 425 animals):

  | View | Animal triangles | Shadow triangles |
  |---|---|---|
  | Overview | 45 k | 20 k |
  | Close up | 82 k | 68 k |

## D-202 · 2026-10-06 · HUD: no live blur in a match, transform-placed icons, a stable unlock set (branch `optimization-v3`)
- **Status:** accepted (perf plan item 4)
- **Decision:**
  - **No live blur:** in a match (`:root.in-match`), HUD panels drop `backdrop-filter` and use the denser `--panel-flat`. The blur was recomputed over the moving scene every frame, costly on integrated GPUs. Menus keep it.
  - **Strategic icons:**
    - `$state.raw`, so they are not deep-proxied every frame;
    - placed by `transform` through `--x` / `--y`, so no layout runs;
    - the hover scale uses the `scale` property;
    - the viewer caches the canvas size on resize instead of reading it per icon.
  - **`unlocked`** keeps the same Set while nothing new is unlocked, so the effects and cards that read it stop rerunning every tick.

## D-203 · 2026-10-06 · Field-frame spikes: partial plant uploads, an allocation-free paint (branch `optimization-v3`)
- **Status:** accepted (perf plan item 5)
- **Decision:**
  - **Partial plant uploads:** `GrowingMesh` tracks the lowest and highest instance changed since its last upload and uploads only that range. It uploaded all 5 attributes of every live instance each frame while repaints ran: megabytes per frame on Large maps.
  - **Allocation-free herb paint:** `paintFields` writes the herb colour and mix with index loops (no `flatMap`, no array literals per cell).
  - **Repaint budget:** 3 ms per frame on High, 1.5 ms on Medium and Low.
  - **Seeds:** `SeedBurst` skips its upload when no seed is in flight.
- **Not done:** reusing decode buffers and capping the census series. Both are small; to revisit if the perf panel shows `fields` above 2 ms.
- **Test:** after one changed key, only that instance's range is uploaded.

## D-204 · 2026-10-06 · Far shadows redrawn less often (branch `optimization-v3`)
- **Status:** accepted (perf plan item 6)
- **Decision:** with the camera more than 60 m from its target, the sun's shadow map is redrawn every 12 frames instead of 4. From afar only plants cast shadows (animals cast up close only, D-201), and plants grow slowly. Casters were already narrowed by D-201. The Medium map size (1024) stays until the perf panel shows the shadow pass is heavy.

## D-205 · 2026-10-06 · Cheap wind gusts (branch `optimization-v3`)
- **Status:** accepted (perf plan item 7)
- **Decision:** `wind()` makes its gust field from two slow waves crossing the map (a few sines of the root and time) instead of a 3D Perlin noise (`mx_noise_float`). The noise ran for every vertex of every plant and grass blade, in the shadow pass too. Same range (0..1 gusts plus the sway), same prevailing direction.
- **Not done:** packing the herbs' texture reads; to revisit if the perf panel shows a vertex-bound GPU.

## D-206 · 2026-10-06 · Welded plant models (branch `optimization-v3`)
- **Status:** accepted (perf plan item 8, first part)
- **Decision:** shrub and tree geometries are welded at creation: normals and uvs dropped, then `mergeVertices`. They were non-indexed (three's icosahedra, merged parts), so each corner was shaded once per face, about 3× the vertex work in both the main and shadow passes. Flat shading takes its normals from screen-space derivatives (three's `isFlatShading`), so the look is unchanged.
- **Not done:** a distance level of detail for plants (simpler far models or impostors). That needs a second instanced set per stratum; it belongs to the M5b art pass, to be revisited if forests show up as the main cost in the perf panel.

## D-207 · 2026-10-06 · Sim and bot hot spots (branch `optimization-v3`)
- **Status:** accepted (perf plan item 9)
- **Decision:**
  - **Diet scans:** herbivore food scans (`decide`'s seek masks and stock, `reproduce`'s food windows) iterate the set bits of the diet mask (`bits`) instead of 32 plant slots. The seek masks compute their food test once per rank, not once per mask.
  - **Hunting:** `hunt` buckets the animals by cell once per call and checks only the cells in strike reach. It was O(predators × animals). The pick is unchanged: the best rank, then the lowest index.
  - **Bot:** `spare()` is worked out once per decision into the `View`; it was recomputed up to about 19 times. The bank cannot change within a decision. The hard bot's catastrophe check uses one dilated "near own land" mask instead of comparing every enemy cell with every own cell.
- **Behaviour unchanged:**
  - bench outputs are identical before and after (normal vs hard 6 × 15 min; hard vs hard on 56², 4 × 30 min);
  - the native vs WASM hash is unchanged (`2aead5e9f5c7c145` at 1200 ticks).
- **Measured:** one 30-min hard vs hard match on 56², single thread: 39.2 s → 19.2 s.
- **Not done:** hashing agent arrays as raw bytes and reusing A*'s buffers. They are small; to revisit if the HUD's sim time climbs.

## D-208 · 2026-10-06 · A Low-preset hint for weak GPUs (branch `optimization-v3`)
- **Status:** accepted (perf plan item 10, first part)
- **Decision:** when dynamic resolution has sat at its floor (0.7) for 30 s on Medium or High, a tip suggests the Low preset, once per browser (`ecoclash.lowHint`).
- **Waits for the laptop:** retuning the presets to the measured budget. `?perf=1` on the reference laptop, Mid/Medium and Large/High at minute 22, gives the figures.

## D-209 · 2026-10-06 · Sharp image back: resolution guard for emergencies only (branch `optimization-v3`)
- **Status:** accepted (user: water, shores and ground looked degraded after the perf pass)
- **Cause:** the D-200 guard stepped down under 40 fps but only recovered above 55 fps. At 45 fps on Large/High it sat at 0.7 for good. Medium had also been cut to 1× pixels.
- **Decision:**
  - The guard steps down only under 30 fps (34 ms), to a floor of 0.85, and recovers under 24 ms. At 40–60 fps the image stays at full resolution.
  - Medium's pixel-ratio cap is 1.25 (it was 1.5 before D-200, and 1 after it).

## D-210 · 2026-10-06 · Crisp shores, no plants in the water (branch `optimization-v3`)
- **Status:** accepted (user: confused shores, plants clipping through the water)
- **Decision:**
  - **Water edge:** water opacity is full within 8 cm of depth (it faded over 35 cm, which spread over metres on flat shores).
  - **Bed:** the ground shader darkens and cools the bed under the water from its own height, crisp at any resolution. A pale waterline was tried and dropped: on gentle beaches it read as a path.
  - **Herbs:** no tuft shows where its root is under water (+3 cm).
  - **Land plants:** a plant whose spot is under water (+5 cm) is left out. Bank cells dip into the river, and half-sunk shrubs clipped through the surface. Water plants (W family) and lily pads keep their place.

## D-211 · 2026-10-06 · An organic ground and leaf-green grass (branch `optimization-v3`)
- **Status:** accepted (user: a flat, copy-pasted ground texture; lime grass)
- **Decision:**
  - **Ground:**
    - each noise scale is sampled turned by its own angle, so the tiles never line up;
    - two broad noises drift the soil hue between ochre, grey-brown and red loam;
    - an emboss gives depth: each of the clod and grit scales against itself a little toward the sun. That costs 2 extra texture reads per ground pixel.
  - **Grass:** `#3f692b` (was `#8bb356`), with a softer tip highlight (0.62–1.02, was 0.7–1.15).
