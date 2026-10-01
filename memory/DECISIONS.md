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
