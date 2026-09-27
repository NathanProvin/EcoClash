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

## 2026-09-27 · Review and completion of `data/gamerules.md`
- **Goal:** Review the author's first gameplay draft and fill its missing sections.
- **Done:** Strata table (4 levels), flora/fauna tech tree, species tables §5.1–5.2, food web mermaid, fire card, numbering and typo fixes. All additions tagged [Proposed].
- **Decisions:** None final. New author questions added to gamerules §12 (7, 9–11).
- **Next:** Author validates §12; then reconcile gamerules with INSTRUCTIONS §2 and OPEN_QUESTIONS (Q-001, Q-002, Q-006, Q-012 overlap). `data/species.toml` when species reach code (M0.5+).
- **Blockers:** None for M0.1–M0.4 (flora-only).

## 2026-09-27 · Gamerules decisions applied
- **Goal:** Apply the author's answers to the gamerules review.
- **Done:** Gamerules moved to three flora levels (pioneers = L1 tier 1), bees and fire post-V1, hedgehog added, non-V1 species removed from examples. INSTRUCTIONS §2 summarizes and defers to gamerules; CLAUDE.md points to it.
- **Decisions:** D-016 gamerules is the design reference; D-017 flora levels and V1 species; D-018 resolves Q-001, Q-002, Q-006, Q-012.
- **Next:** M0.1 flora-only prototype.
- **Blockers:** M0.5+ wait for Q-003, Q-004, Q-005.

## 2026-09-27 · Spec aligned with the gamerules flora model
- **Goal:** Prepare M0 code: align INSTRUCTIONS and ROADMAP with gamerules.
- **Done:** Dropped the "over-producing herbivores" sentence (§2.3). §5.2 now uses the cell spread model. ROADMAP M0 rewritten.
- **Decisions:** D-019 cell model + own-cell spread + [Proposed] rules behind switches; D-020 species data in `balance.toml`.
- **Next:** M0.1 float cell model.
- **Blockers:** None for flora.

## 2026-09-27 · M0.1 float flora cell model
- **Goal:** First prototype code: the gamerules flora rules in NumPy.
- **Done:**
  - `tools/prototype/flora.py`: strata, logistic growth + shade, soil development, spread / smother / frozen frontiers, contested cells, own-cell spread; scripted mirrored scenario; CSV + plots.
  - Species tables in `balance.toml` (placeholders). 5 rule tests in `tools/tests/test_flora.py`.
- **Findings (seed 1, 128², 20 min):** meadow build out-expands forest build (45 % vs 40 % territory); L1/L1 frontier freezes at ~15 min as designed; trees stay near their base (slow spread + 0.6 soil gate), so no smothering happens in 20 min; clover/ferns/bramble cannot spread (gamerules §12 q7).
- **Decisions:** None.
- **Next:** M0.2 quantized mode.
- **Blockers:** None.

## 2026-09-27 · M0.2 quantized mode, Q-015 resolved
- **Goal:** Preview integer effects before the Rust port.
- **Done:** `--mode quant`: int64 state in u16 ranges, Q16.16 rates converted once with round-half-away, floor or stochastic growth rounding. Tests: quant determinism, low-density growth, mirror symmetry (float + quant), float≈quant territory. 12 tests green.
- **Decisions:** D-021 minimum-growth floor (quant matches float within 0.5 % biomass, identical territory).
- **Next:** M0.3 comparison runs; author answer on gamerules §12 q7.
- **Blockers:** None.
