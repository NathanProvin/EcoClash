# INSTRUCTIONS.md — Ecosystem RTS (codename: `EcoClash`)

> Single source of truth for the project. Read this file entirely before any task.
> When a decision changes, update this file and add an entry in `memory/DECISIONS.md`.
> Companion files: `memory/ROADMAP.md` (what's next), `memory/OPEN_QUESTIONS.md` (undecided design),
> `memory/JOURNAL.md` (session log). The session protocol is in the root `CLAUDE.md`.

---

## 0. Rules for the coding assistant

1. **Plan before coding.** For any non-trivial task: restate the goal, list the files you will touch, propose the approach, then implement.
2. **Never break determinism** (see §4). Any change to `sim-core` must keep the determinism tests green.
3. **The renderer never mutates simulation state.** It only reads snapshots.
4. **Small, testable steps.** One feature per commit/PR, with tests. No large speculative refactors.
5. **No new dependency without a one-line justification** in the PR/commit message.
6. **Data-driven balance.** No magic numbers in gameplay code: all tunables live in `data/balance.toml`.
7. **Reproducibility.** Every random process takes an explicit seed. Every script can be rerun and gives the same output.
8. **Ask when ambiguous** rather than guessing on game design questions.
9. Keep code comments and docs in English.
10. **Keep the memory files current.** Tick `ROADMAP.md`, append to `JOURNAL.md`, and log any decision in `DECISIONS.md` before ending a session.
11. **Do not implement a rule that depends on an open question** (`OPEN_QUESTIONS.md`, status other than `resolved`). Build around it, or ask.

---

## 1. Vision

A **1v1 real-time strategy game where each player grows an ecosystem**. Players win by producing more biomass than the opponent and conquering territory.

- **Platform:** runs in the browser (primary). Packaged later for Steam (Electron) and possibly Android (Capacitor).
- **Visual identity:** "stylized realism", with a **macro diorama / nature documentary** look. It is not pixel art. Low-poly models, strong shaders, one dominant light.
- **Core fantasy:** you do not command an army, you *cultivate a food web* and steer it.

---

## 2. Game design (v1 scope)

> **The detailed gameplay rules live in `data/gamerules.md`** (strata, spread, tech tree, species, fauna rules, economy, endgame). For game design, it takes precedence over this section (D-016). Read it before any gameplay or sim-rules task.
> Still open: the victory metric, agent reproduction, counters, fog of war and map scale (`OPEN_QUESTIONS.md`). Flora-only work (growth, spread, competition, territory) does not depend on them.

### 2.1 Ecological strata

| Stratum | Representation | Role |
|---|---|---|
| Herbaceous (L1, incl. pioneers) | **Field** (grid layer), fast growth | Base economy, colonizes land |
| Shrubs (L2) | **Field**, medium growth | Biomass storage, slows enemy units |
| Trees (L3) | **Structure** (discrete entity on grid) | Anchor territory, act as buildings / production sites |
| Herbivores (insects, small mammals) | **Agent** | Eat enemy flora; without orders and with no enemy flora nearby, graze own flora slowly for bonus biomass (D-018) |
| Predators | **Agent** | Hunt enemy prey. Kept in check by their own predators (food web) and by shrub refuges (D-023) |
| Decomposers | **Agent** (earthworms, pill bugs; D-018) | Turn dead biomass into nutrients |

### 2.2 Environment layers (fields)

- `nutrients`: soil fertility. It sets the carrying capacity K.
- `water`: moisture. It modulates growth.
- `dead_biomass`: litter, which decomposers consume.
- `light`: optional and static in v1. Later reduced by tree canopy.

### 2.3 Economy and victory

- **Resource:** biomass points, a bank separate from the fields. Income comes from the growth of the player's living plants and fauna; spending never removes biomass from the fields. Points are spent on unlocking tech-tree cards and spawning species (D-018, `data/gamerules.md` §4, §7).
- **Territory:** a cell belongs to the player whose living plant biomass dominates it (above a minimum threshold).
- **Victory:** control ≥ X % of the map (default 60 %), **or** have the highest standing biomass (living flora + fauna, D-023) when the time limit is reached (default 20 min). Both values are configurable.
- **Core tension:** predator–prey oscillations are a feature.

### 2.4 Player actions (v1)

- Seed / plant (grass patches, shrubs, trees) within or next to own territory.
- Spawn agents from trees (costs biomass).
- Standard RTS unit control: select, move, attack-move (graze/hunt), stop, group hotkeys.
- Camera: top-down RTS camera with pan, zoom and limited tilt.

### 2.5 Post-v1 ideas (do NOT implement before v1 is done)

- Seasons that modulate growth.
- Fire: destroys biomass and boosts nutrients.
- Pollinators: an agent that boosts own flora growth and is a priority target.
- Species traits that evolve during a match and change the unit visuals.

---

## 3. Architecture overview

```
EcoClash/
├── CLAUDE.md                # auto-loaded by Claude Code; imports memory files, session protocol
├── README.md                # human setup guide
├── rust-toolchain.toml      # pinned Rust version + wasm32 target
├── package.json             # npm workspaces + all task scripts (single entry point)
├── scripts/doctor.mjs       # checks every toolchain version (`npm run doctor`)
├── memory/
│   ├── INSTRUCTIONS.md      # this file
│   ├── DECISIONS.md         # dated log of decisions and changes (ADR-lite)
│   ├── ROADMAP.md           # milestones broken into tasks, current status
│   ├── OPEN_QUESTIONS.md    # undecided design points, with defaults and deadlines
│   └── JOURNAL.md           # append-only session log
├── data/
│   ├── balance.toml         # all gameplay tunables (shared by all targets)
│   └── gamerules.md         # gameplay rules: strata, tech tree, species, fauna, endgame (D-016)
├── sim-core/                # Rust crate: deterministic simulation, no rendering, no I/O
│   ├── src/
│   │   ├── lib.rs
│   │   ├── fixed.rs         # fixed-point types and math helpers
│   │   ├── rng.rs           # hand-rolled PCG32 (no `rand` crate, see §4)
│   │   ├── fields/          # grid layers (u16 / fixed-point)
│   │   ├── rules/           # growth, spread, grazing, predation, decomposition
│   │   ├── agents/          # hand-rolled SoA ECS, generational entity ids
│   │   ├── pathing/         # flow fields
│   │   ├── commands.rs      # player commands, timestamped by tick
│   │   ├── snapshot.rs      # read-only view for renderers / tools
│   │   └── hash.rs          # per-tick state checksum
│   └── tests/               # unit + determinism tests
├── sim-ai/                  # (M4) scripted bot: reads snapshots, emits commands only
├── sim-cli/                 # (M1) headless runner: seed + balance + commands -> hashes / metrics (CSV/JSON)
├── sim-wasm/                # wasm-bindgen wrapper around sim-core (browser)
├── sim-py/                  # (M4+, only if needed) PyO3 + maturin bindings for AI training
├── relay/                   # (M6) WebSocket lockstep relay server (forwards commands, compares hashes)
├── client/                  # TypeScript + Vite front-end
│   ├── src/
│   │   ├── worker/          # Web Worker hosting sim-wasm
│   │   ├── render/          # Three.js (WebGPURenderer), TSL shaders
│   │   ├── ui/              # Svelte components (menus, HUD, minimap)
│   │   ├── input/           # mouse/keyboard -> commands
│   │   └── net/             # (M3.5/M6) WebSocket lockstep client
│   └── public/assets/       # optimized glTF / KTX2
├── tools/                   # Python tooling (uv-managed)
│   ├── prototype/           # NumPy ecological model notebooks
│   ├── balance/             # headless batch runs via sim-cli
│   ├── ai/                  # opponent AI experiments / training
│   └── assets/              # Blender bpy generators, terrain generation
├── assets-src/              # source .blend files, generator outputs
└── ASSETS_LICENSES.md       # origin + license of every third-party asset
```

### 3.1 Technology choices

| Layer | Choice | Notes |
|---|---|---|
| Simulation core | **Rust** (stable) | Deterministic, integer / fixed-point only |
| Browser binding | **`cargo build --target wasm32-unknown-unknown` + `wasm-bindgen-cli`** (`--target web`) | Runs inside a Web Worker. CLI version pinned `=` to the `wasm-bindgen` crate |
| Headless runner | **`sim-cli`** (Rust binary) | Python tools read its CSV/JSON output |
| Python binding (M4+) | **PyO3 + maturin**, `numpy` crate for zero-copy arrays | Added only when AI training needs it |
| Front-end build | **Vite + TypeScript (strict)** | |
| Rendering | **Three.js `WebGPURenderer`** (auto-fallback to WebGL2), **TSL** shaders | |
| UI | **Svelte** + plain CSS | Clean and minimal |
| Networking | **WebSocket relay**, deterministic lockstep | Relay forwards commands and compares hashes. It does not simulate |
| Python tooling | **uv**, ruff, pytest, NumPy/SciPy | |
| 3D assets | **Blender** (driven by `bpy` scripts) → **glTF/GLB** → `gltf-transform` (meshopt/Draco, KTX2) | |
| Desktop packaging (later) | **Electron** (bundles Chromium, so WebGPU is consistent on Steam Deck/Linux) | |
| Mobile (optional, later) | **Capacitor** | Needs a dedicated touch UI |

Rejected options and why:
- **Unreal:** no web export, heavy.
- **Godot:** no compute shaders on web export, and awkward to plug in a deterministic Rust core.
- **Pygame/pygbag:** too limited for this scope.
- **GPU-side simulation:** floating-point results differ across GPUs, which breaks lockstep determinism.
- **WebRTC P2P + signaling + TURN:** it needs two servers plus TURN credentials, and NAT problems are hard to debug. A relay gives the same lockstep model with one service (D-006).
- **wasm-pack:** its upstream org was archived in 2025. It is an extra wrapper around `wasm-bindgen-cli` (D-008).
- **`rand` / `rand_pcg`:** their distribution algorithms can change between versions and silently break replays (D-009).

---

## 4. Determinism (non-negotiable)

The simulation must produce **bit-identical state** from the same inputs (seed + balance file + command stream) on every platform: native, WASM, and every browser and OS.

Rules for `sim-core`:
- **No `f32`/`f64` in simulation state or simulation logic.** Use integers or fixed-point (e.g. Q16.16 in `i32`, or normalized `u16` fields). Floats are allowed only in rendering and tooling code.
- **No transcendental functions** (`sin`, `sqrt` on floats, `exp`...). Use lookup tables or integer approximations defined in `fixed.rs`.
- **Single RNG source:** a hand-rolled PCG32 in `rng.rs`, owned by the world state, including its own range reduction. No `rand`/`rand_pcg` (their algorithms can change between versions). Never use thread-local or OS randomness.
- **Stable iteration order:** no iteration over `HashMap`/`HashSet`. Use `Vec`, indexed arenas or `BTreeMap`.
- **Fixed tick:** the simulation advances in discrete ticks (default 10 Hz). Rendering interpolates between the last two snapshots.
- **All inputs are commands** `{tick, player_id, payload}` applied at the start of a tick in a defined order (by `player_id`, then sequence number).
- **State hash:** agents and scalars are hashed every tick. Field layers are hashed only on the ticks where they update, or per dirty 32×32 chunk. Full-state hashing is for tests only, because hashing 4 MB per tick would use the whole tick budget in WASM. Use xxhash64 of the canonical serialization.
- **Multithreading inside the sim** (later) must use deterministic partitioning, with results merged in a fixed order.
- **Integer overflow is explicit.** The release profile sets `overflow-checks = true`, so debug and release behave the same. Fixed-point code uses `saturating_*` or `wrapping_*` on purpose. Q16.16 multiplication goes through an `i64` intermediate.
- **Rounding is specified.** Every fixed-point division or scaling uses one documented rule (default: round half away from zero, in `fixed.rs`). Never rely on Rust's truncation toward zero. It is asymmetric for negative numbers and makes mass drift.
- **Balance values** are parsed once at load, converted to fixed-point with the same rounding rule, and hashed **after conversion**. The file bytes are never hashed, so CRLF/LF and formatting don't matter. Peers and replays compare this balance hash.

Required tests:
- Same seed + same commands run twice → identical hash at every tick.
- Native (`sim-cli`) vs `sim-wasm` (headless via Node) → identical hash after N ticks (checked in CI).
- A property-based test (`proptest`) on random command streams → no panic, and the hash is stable across runs.

---

## 5. Simulation specification

### 5.1 Grid

- Default size **512×512** (configurable: 256 for low-end, 1024 as a stretch goal).
- Each field is a flat `Vec<u16>` (row-major). Per-player flora layers: `flora[player][species]`.
- Rendering never sees the grid as pixels. Fields are uploaded as textures and sampled bilinearly.

### 5.2 Update rules (reference model, prototype first in Python)

Flora follows the cell model of `data/gamerules.md` §2.1 and §3 (D-019): each cell has an owner and holds biomass per species; species of one stratum (L1 herbaceous, L2 shrub, L3 canopy) interpenetrate (D-022). Per plant tick, for each species biomass B:
- **Logistic growth with competition:** `ΔB_i = r_i · B_i · (shade_i − c_i − α · Σ_{j≠i, same stratum} c_j) / shade_i`, where `c = B / K` is cover, `K_i = k_max_i × modifier(cell)` (the modifier is 1.0 in V1, gamerules §2.3), `α` = `niche_overlap`, and `shade_i` is the capacity left by higher strata.
- **Colonization gauge (D-024):** `g_i ∈ [0, 1]` per species per cell caps the capacity (`K_i × g_i`). In own cells, `Δg = spread_rate × pressure × max(suit − g, 0)`, where pressure = (own cover + 4-neighbour cover of the same species and owner) / 5, and `suit = f_dev × f_soil × f_water × f_light` (the single modifier hook; neutral in V1 except the soil development ramp). Seed rain adds `seed_fraction × K × Δg` biomass.
- **Spread:** claim progress into empty neighbours, continuous smothering of lower enemy levels by neighbour cover, frozen same-level frontiers (gamerules §3). There is no diffusion.
- **Grazing:** herbivores consume B, which converts into their energy.
- **Death:** B that decays goes to `dead_biomass`, and decomposers turn `dead_biomass` into `nutrients`.
- Clamp to `[0, u16::MAX]`. All coefficients come from `balance.toml`, species under `[flora.<id>]` (D-020).
- Every rule reads the previous state and writes the next one (double buffering), so the result never depends on update order.

Integer implementation constraint (it must already be modelled in the M0 prototype's quantized mode):
- **Small-value growth:** at low density, `r·B·(…)` is below 1 and rounds to 0, so a stratum never grows. Positive growth that rounds to 0 becomes +1 (minimum-growth floor, D-021). No RNG draw is spent on growth.

### 5.3 Multi-rate scheduling

- Agents: every tick (10 Hz).
- Flora fields: every N ticks (default 5, i.e. 2 Hz).
- Nutrients / water: every M ticks (default 10).
- Later: **chunk sleeping**. 32×32 chunks with no change above a threshold skip updates.

### 5.4 Agents

- Hand-rolled **Structure-of-Arrays** storage with **generational entity ids**. No external ECS in `sim-core`, to keep full control of ordering.
- Positions and velocities are fixed-point.
- Behaviours in v1: move to target, graze (herbivores), hunt (predators), flee, idle/wander, reproduce. Kept as simple state machines.
- **Reproduction (D-023):** an agent whose energy crosses a threshold splits, which costs energy, under a per-player population cap. Players also spawn cards.
- Group movement uses **flow fields** computed on a coarse grid (e.g. 64×64).
- Budget: **1,000–2,000 agents** in v1.

### 5.5 Performance budgets (mid-range laptop, Chromium)

| Item | Budget |
|---|---|
| Sim tick at 512², 2 players, 1,500 agents | ≤ 8 ms on a single thread (in the Worker) |
| Render | 60 fps target, 30 fps floor on "low" preset |
| Initial download (web) | ≤ 30 MB |
| WASM memory | ≤ 512 MB |

Optimisations, in order: algorithmic → multi-rate → chunk sleeping → WASM SIMD → multithreading (SharedArrayBuffer, which requires COOP/COEP headers; itch.io supports this via an option).

---

## 6. Client architecture

- **Main thread:** rendering, UI, input. **Web Worker:** `sim-wasm`.
- Worker → main: snapshots through `SharedArrayBuffer` (preferred) or transferable `ArrayBuffer`s. Agent data goes every tick. Field layers go only on the ticks where they update (2 Hz by default): the fields are about 4 MB, so every tick would be about 40 MB/s.
- Main → worker: commands only.
- **The bot AI is just another player.** It reads snapshots and emits commands through the same queue as humans, and never mutates state directly. This gives replays, fairness, and a clean worker boundary. Difficulty = reaction delay + APM cap.
- **Tick overrun:** if the sim can't keep 10 Hz, game time slows down (every lockstep peer waits). The HUD reports it. Ticks are never skipped.
- The renderer interpolates agent positions between the two latest snapshots.
- The render layer is an **adapter** over `snapshot.rs`. This keeps a future native renderer (e.g. Unreal via a C API) possible without touching the simulation.

---

## 7. Art direction and rendering

### 7.1 Direction

- **Macro diorama look:** a top-down camera, subtle tilt-shift depth of field, and a terrarium / nature documentary feel.
- **Constrained palette:** 5–7 colours per biome, plus one hue per player. The palette is defined in one file (`client/src/render/palette.ts`). Player colours must be colour-blind safe: green vs ochre is on the red–green confusion axis. See Q-009.
- **One key light:** a low sun, a soft sky (hemisphere / HDRI), and tinted distance fog. A single colour-grading LUT for the whole game.
- Test for the direction: the scene must look good **with placeholder cubes** for units.

### 7.2 Production strategy per asset type

| Asset | Method |
|---|---|
| Terrain | Procedural (noise + erosion) in `tools/assets`, exported as heightmap + masks |
| Grass / moss | Pure shader: GPU-instanced blades whose density and colour are driven by the flora textures |
| Trees / shrubs | Procedural (L-systems / space colonization) via `bpy` or Geometry Nodes |
| Insects / predators | Parametric `bpy` generator ("shape genome"), with a fixed seed |
| Rocks, props, PBR materials | CC0 libraries: Poly Haven, ambientCG, Quaternius, Kenney |
| Hero pieces (mother tree, special structures) | AI image→3D (e.g. Hunyuan3D, TRELLIS, Meshy, Tripo), then Blender cleanup: decimate, UVs, bake. Check each licence |

Every third-party or AI-generated asset gets an entry in `ASSETS_LICENSES.md`.

### 7.3 Shader priorities (in order)

1. Wind sway (vertex noise) on grass and foliage.
2. Fake translucency / backlight on leaves.
3. Triplanar terrain blended by moisture and nutrient fields.
4. Player territory: subtle tint in the grass, and a soft glow on frontiers.
5. Post-processing: SSAO, light bloom, tilt-shift DoF, LUT grading.

Quality presets (low / medium / high): grass density, shadows, post-processing, and grid size where relevant.

### 7.4 Asset pipeline

`bpy` script or `.blend` → export GLB → `gltf-transform optimize` (meshopt, KTX2 textures) → `client/public/assets/`. The pipeline is scripted and reproducible (`tools/assets/build.py`).

---

## 8. UI

- Svelte + CSS, a minimal and clean design: one sans-serif font (e.g. Inter), and the palette from §7.1.
- Screens: main menu, settings (quality presets, keybinds), match setup (vs AI / vs player), in-game HUD (biomass, territory %, selected units, minimap), end screen with **live biomass/territory charts** of the match.

---

## 9. Python tooling

- `tools/prototype/`: NumPy notebooks for the ecological model. This is where rules are validated **before** being ported to Rust.
- Prototype quantization: the M0 notebook has a float mode and a **quantized mode** (u16 fields, same rounding as §4). Truncation effects should show up before the port, not after.
- `sim-cli` (M1): `sim-cli run --seed N --balance data/balance.toml --commands file.jsonl --ticks T --out metrics.csv`. It prints the per-tick hash and writes metrics. Python tools call it as a subprocess and read the CSV.
- `sim-py` (M4+, only if needed): exposes `World.new(seed, balance_path)`, `step(commands)`, `snapshot()` (NumPy views) and `hash()`. It is added when AI training needs in-process stepping.
- `tools/balance/`: batch headless matches (thousands of seeds) via `sim-cli`, with metrics such as match length, win-rate by strategy and collapse frequency. Results are written to Parquet.
- `tools/ai/`: v1 uses a scripted AI (Rust crate `sim-ai`, deterministic, command-only, see §6). Later, learned policies are trained with `sim-py`.
- Conventions: `uv` for environments (project in `tools/`), `ruff` for format and lint, type hints, `pytest`, fixed seeds everywhere. On Windows, run Python through `uv run`, never through the bare `python`, which is the Microsoft Store stub.

---

## 10. Networking and distribution (later milestones)

- **Order:** vs AI first. There is a lockstep smoke test at M3.5 and full multiplayer at M6. Determinism is enforced from day one.
- **Multiplayer model:** deterministic lockstep over a **WebSocket relay** (`relay/`). Clients exchange commands only. The relay orders them, forwards them, and compares the state hashes that clients send every N ticks. It never simulates. It is a single small service (Node on a small VPS, or Cloudflare Durable Objects), so no TURN and no NAT issues. WebRTC may come back later as an optimization if latency measurements justify it.
- **Lockstep parameters** (in `balance.toml` under `[net]`):
  - Input delay: a command issued at tick `t` executes at `t + d`, default `d = 2`, i.e. 200 ms.
  - Stall: if tick `t` has no commands from all peers, the sim waits. After a timeout (default 10 s), the missing peer is dropped as disconnected.
  - Disconnect: the missing player loses (v1). Resign is a command.
  - Pause: a command that both players must confirm.
- **Desync:** the hash mismatches are logged with the tick, and the match ends. A debug build dumps both states for diffing.
- **Handshake:** peers exchange build version + balance hash + seed before the match. A mismatch refuses to start.
- **Cheating:** lockstep gives every client the full state (maphack is possible). This is accepted for v1.
- **Replays:** seed + balance hash + command stream.
- **Distribution:**
  1. Web: static build on itch.io / Cloudflare Pages, for early testing.
  2. Steam: Electron wrapper. Steam Networking may replace the relay. Open the store page early, then Early Access.
  3. Android: Capacitor, with a dedicated touch UI and a reduced grid.

---

## 11. Milestones

Each milestone ends with a playable or testable result and passing CI. The detailed task breakdown and current status are in `ROADMAP.md`.

| # | Milestone | Acceptance criteria |
|---|---|---|
| M-1 | Environment bootstrap | Memory files, pinned toolchains, `npm run doctor` green, git initialized |
| M0 | Ecological prototype (Python) | Float and quantized modes. Over 100 seeds, all trophic levels of both players coexist at t = 20 min in ≥ 90 % of runs. Tunables are in `balance.toml` |
| M1 | `sim-core` fields | Growth/spread/competition in fixed-point. Determinism tests are green. `sim-cli` output matches M0's quantized-mode curves within tolerance. CI checks native vs WASM hashes |
| M2 | Web render of fields | Worker + WASM + Three.js: terrain, flora textures, instanced grass, RTS camera. 60 fps at 512² on the reference machine (to be named in ROADMAP) |
| M3 | Agents and control | Herbivores and predators, selection, orders, flow fields. The decomposer decision is taken |
| M3.5 | Lockstep smoke test | Two browser tabs over a local relay play the same match for 5 min with identical hashes |
| M4 | Full match vs AI | Economy, structures, territory, victory conditions. Scripted AI (command-only). End screen with charts |
| M5 | Art and UI polish | Art direction applied, shader priorities 1–5, menus, quality presets |
| M6 | Multiplayer | Deployed relay, lobby, desync detection, replays |

---

## 12. Coding conventions

- **Rust:** `rustfmt`, `clippy -D warnings`, no `unsafe` without a documented reason, unit tests next to code, `proptest` for rules. The release profile has `overflow-checks = true`.
- **TypeScript:** `strict: true`, ESLint + Prettier, no `any` in public interfaces.
- **Python:** see §9.
- **CI (GitHub Actions, from M1):** build all targets, run all tests, run the cross-target determinism hash check (native vs WASM).
- **Commits:** conventional commits (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `chore:`).
- **Line endings:** LF everywhere, enforced by `.gitattributes`.

---

## 13. Open questions

All open questions live in `memory/OPEN_QUESTIONS.md`, each with a recommended default and a deadline milestone. Once resolved, a question gets a `DECISIONS.md` entry and this file is updated.

---

## 14. Environment management

- **Pinned versions, one file per toolchain:** `rust-toolchain.toml` (Rust + wasm32 target + rustfmt/clippy), `.nvmrc` + `package.json` `engines` (Node), `.python-version` + `tools/uv.lock` (Python), `Cargo.lock` (from M1). All lockfiles are committed.
- **One entry point:** every task is a root `npm run <script>`, so the commands are the same on Windows PowerShell, Git Bash and CI. Rust and Python commands are wrapped in these scripts.
- **One check:** `npm run doctor` verifies every tool and prints the install command for anything missing. Run it first on a new machine and after any toolchain bump.
- **Environments:**
  - `local`: Vite dev server, `.env.local`.
  - `preview`: Cloudflare Pages branch deploys.
  - `prod`: itch.io + Pages `main`.
  - Client config goes only through `VITE_*` variables. `.env.example` documents every variable (created with the first one).
- **Secrets** (deploy tokens, relay credentials) live only in GitHub Actions secrets or the Cloudflare environment. They are never committed, and `.env*` is gitignored except `.env.example`.
- **Cross-origin isolation** (needed for SharedArrayBuffer): COOP/COEP headers in Vite `server.headers` for dev, and a `_headers` file for Pages (M2).
- **Bumping a toolchain** is a `chore:` commit with a DECISIONS entry if it touches determinism (Rust version, wasm-bindgen).
