// Tutorial (M5a 8b, D-139): a short match on a gentle map against the easy bot, guided by
// objectives that complete in order. Each step names the control it uses, and a pointer rings
// that control on screen. It teaches the main loops (spread, layers, unlocks, animals, raids)
// and keeps some surprises: hunters, recyclers, weather and catastrophes are left to discover.
// Pure: the HUD feeds it what the player has done so far.

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
  /** Explanation steps the player clicked Next on (their indices). */
  acked: ReadonlySet<number>;
  /** The map overlay shown (D-135), the tech tree opened this tutorial. */
  overlay: string | null;
  techOpened: boolean;
  /** The highest plant layer the player holds (0 none, 1 herbs … 4 trees), and the plant
   *  species growing on its land. */
  layer: number;
  plants: ReadonlySet<string>;
  /** The player's animals selected now. */
  selected: number;
}

/** UI elements a step can point at: `data-tour` keys, the first one on screen wins. */
export type TourTarget = string[];

export interface Objective {
  title: string;
  text: string;
  /** A muted extra line. */
  tip?: string;
  point?: TourTarget;
  /** An explanation: done when the player clicks Next. */
  ack?: true;
  done: (s: TutorialState, index: number) => boolean;
}

/** The share of the map that ends the tutorial: more than the free land, so it takes pushing
 *  into the bot's. */
export const TUTORIAL_GOAL = 0.55;
/** The land to reach while learning to spread. */
export const SPREAD_GOAL = 0.04;

const acked = (s: TutorialState, i: number) => s.acked.has(i);

/** Players start with lichen & moss only (D-118); grasses then feed the rabbits, the first animal
 *  that can be selected and ordered (grasshoppers are a swarm). */
export const OBJECTIVES: Objective[] = [
  {
    title: "Welcome to the valley",
    text: "The bar at the top is your dashboard: the coloured bar shows your land (blue, from the left) against your rival's (orange), then your species alive, your biomass and what it earns each second.",
    tip: "Biomass buys everything: new species, plants, animals.",
    point: ["resources"],
    ack: true,
    done: acked,
  },
  {
    title: "Found your colony",
    text: "Open Herbs in the bar at the bottom, pick Lichen & moss, then click anywhere on land. Your first planting is your home.",
    point: ["family-L1"],
    done: (s) => s.owned > 0,
  },
  {
    title: "Let it spread",
    text: `Plants creep into free land next to them on their own, and earn biomass as they grow. Plant more along your border to speed it up. Goal: ${Math.round(SPREAD_GOAL * 100)} % of the map.`,
    tip: "Watch the blue part of the top bar grow.",
    point: ["land"],
    done: (s) => s.owned >= SPREAD_GOAL,
  },
  {
    title: "Read the soil",
    text: "Plants grow in four layers: herbs, undergrowth, shrubs, trees. A taller layer needs richer soil, and your herbs build it. Open the display menu and turn on the Soil overlay to see where it is ready.",
    tip: "Turn the overlay off again with the same button.",
    point: ["overlay-soil", "display"],
    done: (s) => s.overlay === "soil",
  },
  {
    title: "Plant Grasses",
    text: "Open Herbs: the Grasses card fills with colour as you save up. Click it when its padlock turns gold to unlock it, click it again, then plant grasses on your land.",
    tip: "Grasses spread faster than lichen, and feed most grazers.",
    point: ["family-L1"],
    done: (s) => s.plants.has("grasses"),
  },
  {
    title: "Grow a second layer",
    text: "Unlock Ferns in Undergrowth and plant them where your soil is rich.",
    tip: "At the front, a taller layer shades and smothers the enemy's lower plants: that is how borders move.",
    point: ["family-L2"],
    done: (s) => s.layer >= 2,
  },
  {
    title: "Who eats whom",
    text: "Open the tech tree (T): it is a food web. Hover a species to light up its food and its hunters.",
    tip: "Every species has an answer somewhere in the web.",
    point: ["tech"],
    done: (s) => s.techOpened,
  },
  {
    title: "Call rabbits",
    text: "In Grazers (yellow), unlock Grasshoppers, then Rabbits. Pick Rabbits and click your grass: on your own land they come at the base price.",
    point: ["family-H1"],
    done: (s) => s.animals > 0,
  },
  {
    title: "Command them",
    text: "Drag a box over your rabbits to select them, then right-click your land to move them.",
    tip: "Ctrl + 1 saves a selection as group 1; press 1 to recall it.",
    done: (s) => s.selected > 0,
  },
  {
    title: "Raid the enemy",
    text: "With rabbits selected, press A, then click enemy land: they march there and graze it bare, and bare land is free to take.",
    done: (s) => s.onEnemy > 0,
  },
  {
    title: "Take the land",
    text: `Grow until you hold ${Math.round(TUTORIAL_GOAL * 100)} % of the map: spread, stack your layers, raid the front.`,
    tip: "Not everything in this valley eats plants…",
    point: ["land"],
    done: (s) => s.owned >= TUTORIAL_GOAL,
  },
];

/** The current objective (OBJECTIVES.length: all done): from `step`, past every one done now. */
export function advance(step: number, s: TutorialState): number {
  let i = step;
  while (i < OBJECTIVES.length && OBJECTIVES[i]?.done(s, i)) i++;
  return i;
}
