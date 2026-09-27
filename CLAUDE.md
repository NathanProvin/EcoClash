# CLAUDE.md — EcoClash

Ecosystem RTS in the browser: a deterministic Rust sim, rendered with Three.js, with a bot opponent and lockstep multiplayer.
The spec and the current plan are imported below. Read them before any task.

@memory/INSTRUCTIONS.md
@memory/ROADMAP.md

Gameplay rules (strata, tech tree, species, fauna, endgame) live in `data/gamerules.md`. It is not imported, to keep context small: read it before any gameplay or sim-rules task (D-016).

## Session protocol
1. **Start:** read ROADMAP `Status`, the last entry of `memory/JOURNAL.md`, and any `memory/OPEN_QUESTIONS.md` item that touches the task.
2. **Work:** plan first, one task = one conventional commit. Never build on an unresolved open question (INSTRUCTIONS rule 11).
3. **End:**
   - Tick the ROADMAP boxes and update `Status`.
   - Append a JOURNAL entry.
   - Add a `memory/DECISIONS.md` entry for any decision and reflect it in INSTRUCTIONS.
   - Move resolved questions out of OPEN_QUESTIONS.

## Definition of Done (per task)
- Tests exist for the new logic and pass. Determinism tests stay green for any `sim-core` change.
- The linters are clean: `cargo fmt --check`, `cargo clippy -D warnings`, `ruff check`, ESLint.
- There are no new magic numbers; tunables are in `data/balance.toml`.
- Any new dependency is justified in one line in the commit message.
- The memory files are updated (see "End" above).

## Commands (Windows: PowerShell or Git Bash)
- `npm run doctor`: check all toolchains. Run it first on a new machine.
- `npm run py:sync` / `npm run py:test` / `npm run py:lint`: Python tools (uv project in `tools/`).
- Rust, WASM and client scripts are added to `package.json` with their milestones (M1, M2).
- Python: always go through `uv run` (the bare `python` on this machine is the Microsoft Store stub).
