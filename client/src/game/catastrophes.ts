// Catastrophe cards (D-129): the table the sim exposes, and how a card reads in the bar. Pure.

/** One card of `[catastrophes.*]` (sim-wasm `catastropheTable`). */
export interface Catastrophe {
  name: string;
  /** "killtrees", "storm" or "spill". */
  act: string;
  cost: number;
  /** Cells. */
  radius: number;
  cooldown_s: number;
  duration_s: number;
  effect: string;
}

/** The card's pictogram (`Icon` names) and its tone in the animations. */
export const CATASTROPHE_LOOK: Record<
  string,
  { icon: "caterpillar" | "storm" | "drum"; color: string }
> = {
  killtrees: { icon: "caterpillar", color: "#7a5230" }, // processionary caterpillars (D-130)
  storm: { icon: "storm", color: "#8a949c" },
  spill: { icon: "drum", color: "#b5c42a" },
};

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
