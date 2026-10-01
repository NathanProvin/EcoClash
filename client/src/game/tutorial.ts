// Tutorial (M5a 8b): a short match on a gentle map against the easy bot, guided by objectives
// that complete in order. Pure: the HUD feeds it what the player has done so far.

import type { MatchSetup } from "./setup";

/** The tutorial's match: a small meadows map (seed 2), the easy bot, nothing unlocked for free. */
export const TUTORIAL_SETUP: MatchSetup = { bot: "easy", seed: 2, sandbox: false, map: "small" };

/** What the objectives look at, once a second. */
export interface TutorialState {
  /** Share of the map the player holds (0..1). */
  owned: number;
  /** Species unlocked since the start. */
  unlocked: number;
  /** The player's animals on the map. */
  animals: number;
  /** The player's animals standing on enemy land. */
  onEnemy: number;
}

export interface Objective {
  title: string;
  text: string;
  done: (s: TutorialState) => boolean;
}

/** The share of the map that ends the tutorial: more than the free land, so it takes pushing
 *  into the bot's. */
export const TUTORIAL_GOAL = 0.55;

export const OBJECTIVES: Objective[] = [
  {
    title: "Found your colony",
    text: "Open the first family in the bar (Herbs), pick a plant, then click anywhere on land.",
    done: (s) => s.owned > 0,
  },
  {
    title: "Let it spread",
    text: "Plants spread by themselves. Plant more along your border to speed it up. Goal: 5 % of the map.",
    done: (s) => s.owned >= 0.05,
  },
  {
    title: "Unlock a species",
    text: "Your plants earn biomass. Open a family and click a card you can afford to unlock it.",
    done: (s) => s.unlocked > 0,
  },
  {
    title: "Call an animal",
    text: "Pick a grazer (a yellow family) and click your own land: it comes at base price.",
    done: (s) => s.animals > 0,
  },
  {
    title: "Raid the enemy",
    text: "Drag to select your animals and right-click enemy land, or drop new grazers onto enemy grass (×1.5).",
    done: (s) => s.onEnemy > 0,
  },
  {
    title: "Take the land",
    text: `Grow until you hold ${TUTORIAL_GOAL * 100} % of the map. Shrubs and trees smother enemy grass.`,
    done: (s) => s.owned >= TUTORIAL_GOAL,
  },
];

/** The current objective (OBJECTIVES.length: all done): from `step`, past every one done now. */
export function advance(step: number, s: TutorialState): number {
  let i = step;
  while (i < OBJECTIVES.length && OBJECTIVES[i]?.done(s)) i++;
  return i;
}
