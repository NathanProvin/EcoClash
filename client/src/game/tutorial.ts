// Tutorial (M5a 8b): a short match on a gentle map against the easy bot, guided by objectives
// that complete in order. Pure: the HUD feeds it what the player has done so far.

import type { MatchSetup } from "./setup";

/** The tutorial's match: a small meadows map (seed 2), the easy bot, nothing unlocked for free. */
export const TUTORIAL_SETUP: MatchSetup = { bot: "easy", seed: 2, sandbox: false, map: "small" };

/** What the objectives look at, once a second. */
export interface TutorialState {
  /** Share of the map the player holds (0..1). */
  owned: number;
  /** Species cards the player has unlocked. */
  unlocked: ReadonlySet<string>;
  /** The player's animals that can take orders (swarms cannot), and those on enemy land after an
   *  order sent them there. */
  animals: number;
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

/** Players start with lichen & moss only (D-118); grasses then feed the rabbits, the first animal
 *  that can be selected and ordered (grasshoppers are a swarm). */
export const OBJECTIVES: Objective[] = [
  {
    title: "Found your colony",
    text: "Lichen & moss is your only plant at first. Open Herbs in the bar, pick it, then click anywhere on land.",
    done: (s) => s.owned > 0,
  },
  {
    title: "Let it spread",
    text: "Plants spread by themselves and earn biomass. Plant more along your border to speed it up. Goal: 5 % of the map.",
    done: (s) => s.owned >= 0.05,
  },
  {
    title: "Unlock Grasses",
    text: "Open Herbs: the Grasses card fills with colour as you save up. Click it when its padlock turns gold, then plant grasses on your land.",
    done: (s) => s.unlocked.has("grasses"),
  },
  {
    title: "Call rabbits",
    text: "In Grazers (yellow), unlock Grasshoppers, then Rabbits. Pick Rabbits and click your grass: they come at base price.",
    done: (s) => s.animals > 0,
  },
  {
    title: "Raid the enemy",
    text: "Drag a box over your rabbits to select them, press A, then click enemy land: they march there and graze it bare.",
    done: (s) => s.onEnemy > 0,
  },
  {
    title: "Take the land",
    text: `Grow until you hold ${Math.round(TUTORIAL_GOAL * 100)} % of the map. Shrubs and trees smother enemy grass; grazed-bare land is yours to take.`,
    done: (s) => s.owned >= TUTORIAL_GOAL,
  },
];

/** The current objective (OBJECTIVES.length: all done): from `step`, past every one done now. */
export function advance(step: number, s: TutorialState): number {
  let i = step;
  while (i < OBJECTIVES.length && OBJECTIVES[i]?.done(s)) i++;
  return i;
}
