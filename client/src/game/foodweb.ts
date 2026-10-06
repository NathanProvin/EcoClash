// The tech tree as a food web (D-124): pure layout and relations for ui/TechTree.svelte. Three
// rows, bottom-up: plants, grazers, hunters. Each grazer family stands over the plant layer it
// eats, hunters over their prey; the recyclers stand beside the grazers, over the dead biomass.

import type { Species } from "../replay/replay";
import { eatersOf, foodsOf } from "./species";

/** Rows, top to bottom. */
export const ROWS = ["Hunters", "Grazers", "Plants"] as const;

/** Where each family sits: [row, column] (rows as in ROWS). */
const SLOT: Record<string, readonly [number, number]> = {
  S: [0, 0],
  P1: [0, 1],
  P2: [0, 2],
  P3: [0, 3],
  PW: [0, 4],
  H1: [1, 0],
  H2: [1, 1],
  H3: [1, 2],
  H4: [1, 3],
  HW: [1, 4],
  D: [1, 5],
  L1: [2, 0],
  L2: [2, 1],
  L3: [2, 2],
  L4: [2, 3],
  W: [2, 4],
};
export const COLUMNS = 6;
/** The dead-biomass node under the recyclers: [row, column]. */
export const LITTER: readonly [number, number] = [2, 5];
export const LITTER_ID = "dead";

/** A family's place in the web; unknown families go to the end of their row. */
export function slotOf(family: string, kind: Species["kind"]): readonly [number, number] {
  return SLOT[family] ?? (kind === "flora" ? [2, COLUMNS - 1] : [1, COLUMNS - 1]);
}

/** One feeding link: `eater` feeds on `food` (a species name, or LITTER_ID), at diet `rank`. */
export interface Link {
  eater: string;
  food: string;
  rank: number;
}

/** Every feeding link of the web; recyclers link to the dead biomass. */
export function links(all: readonly Species[]): Link[] {
  return all.flatMap((s) =>
    s.role === "decomposer"
      ? [{ eater: s.name, food: LITTER_ID, rank: 0 }]
      : foodsOf(s, all).map((f, rank) => ({ eater: s.name, food: f.name, rank })),
  );
}

/** What a focused species touches: its foods and its eaters, with ranks. */
export function related(
  s: Species,
  all: readonly Species[],
): { foods: { s: Species; rank: number }[]; eaters: { s: Species; rank: number }[] } {
  return {
    foods: foodsOf(s, all).map((f, rank) => ({ s: f, rank })),
    eaters: eatersOf(s, all).sort((a, b) => a.rank - b.rank),
  };
}

/** Your counters (D-124): the species that feed on something the enemy fields now. */
export function counters(all: readonly Species[], enemy: ReadonlySet<string>): Set<string> {
  return new Set(
    all.filter((s) => foodsOf(s, all).some((f) => enemy.has(f.name))).map((s) => s.name),
  );
}
