// The unit card (D-161): what the HUD shows about one animal or a group, from the animal frame.
// Pure: the HUD feeds it the animals drawn now.

import type { Animal } from "../replay/replay";

/** Order states of the animal frame (sim-core `Fauna::frame`). */
export const ORDER_TEXT = ["Free", "Moving", "Raiding"] as const;

export interface UnitCard {
  /** Fauna species index of the group's most common species, and its owner. */
  species: number;
  owner: number;
  /** Animals of the group still alive. */
  count: number;
  /** Mean fullness, 0..1 (0 when unknown, e.g. replays). */
  full: number;
  /** The most common order state (an ORDER_TEXT index). */
  order: number;
}

/** The card of the animals `ids` among `animals`, or null when none is alive. */
export function unitCard(animals: readonly Animal[], ids: readonly number[]): UnitCard | null {
  const wanted = new Set(ids);
  const alive = animals.filter((a) => wanted.has(a.id));
  const first = alive[0];
  if (!first) return null;
  const most = (key: (a: Animal) => number) => {
    const tally = new Map<number, number>();
    for (const a of alive) tally.set(key(a), (tally.get(key(a)) ?? 0) + 1);
    return [...tally].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0]?.[0] ?? 0;
  };
  return {
    species: most((a) => a.species),
    owner: first.owner,
    count: alive.length,
    full: alive.reduce((t, a) => t + (a.full ?? 0), 0) / alive.length,
    order: most((a) => a.order ?? 0),
  };
}
