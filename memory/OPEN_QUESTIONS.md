# OPEN_QUESTIONS.md — EcoClash

> Undecided points. Each one has a **recommended default** so work isn't blocked, and a **deadline** (the milestone that needs the answer).
> Status values:
> - `user thinking`: the owner is working on it; don't decide it.
> - `open`: not decided yet.
> - `resolved → D-NNN`: decided; the decision is recorded in DECISIONS.md.
>
> Do not implement a rule that depends on an unresolved question (INSTRUCTIONS rule 11). When a question is resolved: add a DECISIONS entry, update INSTRUCTIONS, and set the status here.

| ID | Topic | Deadline | Status |
|---|---|---|---|
| Q-001 | Herbivore diet: enemy flora only, or any flora? | M0 (agents part) | resolved → D-018 |
| Q-002 | What biomass currency is (bank vs harvesting standing stock) | M0 (agents part) | resolved → D-018 |
| Q-003 | Victory metric: standing biomass or cumulative production | M0 | resolved → D-023 |
| Q-004 | Do agents reproduce on their own? | M0 (agents part) | resolved → D-023 |
| Q-005 | Counter loop: what kills predators, friendly fire | M0 (agents part) | resolved → D-023 |
| Q-006 | Unit control at 1–2k agents: per-unit or swarm/zone orders | M3 | resolved → D-018 |
| Q-007 | Fog of war in v1? | M3 | resolved → D-074 |
| Q-008 | Map scale: world units per cell, agent size, speeds | M2 | resolved → D-040 (cell size: D-047) |
| Q-009 | Colour-blind-safe player colours | M2 | resolved → D-040 |
| Q-010 | Reference machine for performance budgets | M2 | resolved → D-040 |
| Q-011 | Final game name | before store page | open |
| Q-012 | Decomposers: agent or field | M3 | resolved → D-018 |
| Q-013 | Exact victory thresholds and match length | M7-lite (tuned via `tools/balance`) | open |
| Q-014 | Plant species per player in v1 | M0 | open (default: grass + shrub + tree) |
| Q-015 | Low-density growth: stochastic rounding or growth floor | M0 (quantized mode) | resolved → D-021 |
| Q-016 | Tiers of the L1 intermediates (wildflowers, nettle, bramble) | M4 | open (default: wildflowers and nettle tier 2, bramble tier 3; D-050) |

---

## Q-001 · Herbivore diet — resolved → D-018
## Q-002 · Biomass as a currency — resolved → D-018

## Q-003 · Victory metric — resolved → D-023
## Q-004 · Agent reproduction — resolved → D-023
## Q-005 · Counter loop — resolved → D-023

## Q-006 · Unit control scale — resolved → D-018

## Q-007 · Fog of war — resolved → D-074

## Q-008 · Map scale — resolved → D-040
## Q-009 · Player colours — resolved → D-040
## Q-010 · Reference machine — resolved → D-040

## Q-011 · Final game name
- Use the codename **EcoClash** until then.

## Q-012 · Decomposers: agent or field — resolved → D-018

## Q-013 · Victory thresholds and match length
- Defaults: 90 % of the map / 60 min (user, 2026-10-01, D-094; were 60 % / 20 min). Tune them with `tools/balance` in M7-lite (D-073).

## Q-014 · Plant species per player
- Default: grass + shrub (fields) + tree (structure).

## Q-015 · Low-density growth rounding — resolved → D-021

## Q-016 · Tiers of the L1 intermediates
- **Question:** The user named wildflowers, nettle and bramble as "intermediate" L1 species. Are they all tier 2, or spread over tiers 2 and 3?
- **Default (in use):** wildflowers and nettle are tier 2; bramble stays tier 3, keeping its refuge role for late game.
- **Deadline:** M4 (unlock costs matter once spending is ported).
