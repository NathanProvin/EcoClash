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
| Q-007 | Fog of war in v1? | M3 | user thinking |
| Q-008 | Map scale: world units per cell, agent size, speeds | M2 | user thinking |
| Q-009 | Colour-blind-safe player colours | M2 | open |
| Q-010 | Reference machine for performance budgets | M2 | open |
| Q-011 | Final game name | before store page | open |
| Q-012 | Decomposers: agent or field | M3 | resolved → D-018 |
| Q-013 | Exact victory thresholds and match length | M4 (tuned via `tools/balance`) | open |
| Q-014 | Plant species per player in v1 | M0 | open (default: grass + shrub + tree) |
| Q-015 | Low-density growth: stochastic rounding or growth floor | M0 (quantized mode) | resolved → D-021 |

---

## Q-001 · Herbivore diet — resolved → D-018
## Q-002 · Biomass as a currency — resolved → D-018

## Q-003 · Victory metric — resolved → D-023
## Q-004 · Agent reproduction — resolved → D-023
## Q-005 · Counter loop — resolved → D-023

## Q-006 · Unit control scale — resolved → D-018

## Q-007 · Fog of war
- **Recommended default:** None in v1 (full visibility). Lockstep gives every client the full state anyway. Revisit after v1.

## Q-008 · Map scale
- **Recommended default** (to validate visually in M2):
  - 1 cell = 1 m.
  - Herbivore ≈ 0.3 m, speed ≈ 3 cells/s.
  - Predator ≈ 0.6 m, speed ≈ 5 cells/s.
  - A 512² map then takes about 2–3 minutes to cross.

## Q-009 · Player colours
- **Problem:** "Cool greens vs warm ochres" sits on the red–green colour-blind confusion axis.
- **Recommended default:** A blue/teal vs orange/amber pair (derived from Okabe–Ito), desaturated to fit the documentary palette, with a luminance difference and a **pattern cue** on territory borders.

## Q-010 · Reference machine
- **Problem:** "Mid-range laptop" isn't measurable.
- **Recommended default:** The dev machine, plus one integrated-GPU laptop tier (e.g. Intel Iris Xe class) for the 30 fps floor. Record the exact specs here.

## Q-011 · Final game name
- Use the codename **EcoClash** until then.

## Q-012 · Decomposers: agent or field — resolved → D-018

## Q-013 · Victory thresholds and match length
- Defaults: 60 % of the map / 20 min. Tune them with `tools/balance` in M4.

## Q-014 · Plant species per player
- Default: grass + shrub (fields) + tree (structure).

## Q-015 · Low-density growth rounding — resolved → D-021
