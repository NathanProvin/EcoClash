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
