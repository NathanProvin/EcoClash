// Catastrophe cards (D-129): the table the sim exposes, and how a card reads in the bar. Pure.

/** One card of `[catastrophes.*]` (sim-wasm `catastropheTable`). */
export interface Catastrophe {
  name: string;
  /** "killtrees", "storm", "spill", "blight" (D-248), "fell" or "cull" (D-252). */
  act: string;
  cost: number;
  /** Cells. */
  radius: number;
  cooldown_s: number;
  duration_s: number;
  effect: string;
}

/** Each card's pictogram (`Icon` names), its tone in the animations, its sound cue and its
 *  place in the 3x3 deck (D-252): [row, column], rows cheap to costly, columns herbs, woody,
 *  fauna. */
export const CATASTROPHE_LOOK: Record<
  string,
  {
    icon: "aphid" | "caterpillar" | "bait" | "frost" | "saw" | "gun" | "drum" | "storm" | "virus";
    color: string;
    cue: string;
    at: readonly [number, number];
  }
> = {
  aphid_outbreak: { icon: "aphid", color: "#9bbf3a", cue: "fx.caterpillars", at: [1, 1] },
  processionary_caterpillars: {
    icon: "caterpillar",
    color: "#7a5230", // D-130
    cue: "fx.caterpillars",
    at: [1, 2],
  },
  poisoned_bait: { icon: "bait", color: "#8e5bb5", cue: "fx.bait", at: [1, 3] },
  late_frost: { icon: "frost", color: "#9fd3ee", cue: "fx.spill", at: [2, 1] },
  chainsaw: { icon: "saw", color: "#d98a2b", cue: "fx.chainsaw", at: [2, 2] },
  hunters: { icon: "gun", color: "#a8442e", cue: "fx.hunters", at: [2, 3] },
  chemical_spill: { icon: "drum", color: "#b5c42a", cue: "fx.spill", at: [3, 1] },
  storm: { icon: "storm", color: "#8a949c", cue: "fx.storm", at: [3, 2] },
  epidemic: { icon: "virus", color: "#6f8f4e", cue: "fx.epidemic", at: [3, 3] },
};

/** A card's look; an unknown card gets a plain one. */
export function lookOf(c: Catastrophe): (typeof CATASTROPHE_LOOK)[string] {
  return CATASTROPHE_LOOK[c.name] ?? { icon: "storm", color: "#888", cue: "", at: [4, 1] };
}

/** How a card stands now: ready to play (cooled down and affordable), and the share of its
 *  cooldown still to run (0..1), for the sweep. */
export function cardStatus(
  c: Catastrophe,
  waitS: number,
  bank: number,
): { ready: boolean; affordable: boolean; left: number } {
  const left = c.cooldown_s > 0 ? Math.min(Math.max(waitS / c.cooldown_s, 0), 1) : 0;
  const affordable = bank >= c.cost;
  return { ready: waitS <= 0 && affordable, affordable, left };
}
