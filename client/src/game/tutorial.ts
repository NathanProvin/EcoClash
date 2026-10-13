// Tutorial (M5a 8b, D-139, D-257): a short match on a gentle map against the easy bot, guided by
// objectives that complete in order. Each step names the control it uses, and a pointer rings
// that control on screen. It teaches the core loop: the den as the heart, fog, spread, layers and
// biodiversity, unlocks, animals out of the den and their habitat cap, hold, breeding, raids, the
// predator-prey answer to a raid (D-141) and catastrophe cards. Bigger hunters, recyclers,
// weather and moving the den are left to discover.
// Pure: the HUD feeds it what the player has done so far.

import type { MatchSetup } from "./setup";

/** The tutorial's match: a small meadows map (seed 2), the easy bot, nothing unlocked for free. */
export const TUTORIAL_SETUP: MatchSetup = {
  bot: "easy",
  style: "balanced", // the scripted lesson needs a predictable bot (D-228)
  seed: 2,
  sandbox: false,
  map: "small",
};

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
  /** Predator-prey loop (D-141): the player's animals born on the map (not called), and the
   *  animal species it fields. */
  born: number;
  fauna: ReadonlySet<string>;
  /** Enemy grasshoppers on the map, and whether every raid wave has been sent. */
  swarm: number;
  raidOver: boolean;
  /** The player gave a hold order (H + click), and cast a catastrophe card. */
  held: boolean;
  cast: boolean;
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
  /** Biomass the step needs (D-144): on entry the tutorial tops the bank up to it, so the
   *  player never waits to save up. */
  need?: number;
  done: (s: TutorialState, index: number) => boolean;
}

/** The share of the map that ends the tutorial: more than the free land, so it takes pushing
 *  into the bot's. */
export const TUTORIAL_GOAL = 0.55;
/** The land to reach while learning to spread. */
export const SPREAD_GOAL = 0.04;
/** Births to wait for while the herd grows at home. */
export const HERD_BIRTHS = 1;
/** The step during which the bot raids with grasshopper swarms (the App drives that raid). */
export const DEFEND_TITLE = "Defend your meadows";
/** The scripted raid (D-141, D-245): a swarm of grasshoppers the bot sends onto the player's grass
 *  every `everyMs`, at most `waves` times; each wave first grants the bot `grant` biomass so it
 *  always comes (the easy bot spends its bank as it goes). */
export const RAID = { waves: 6, everyMs: 20_000, grant: 2500 } as const;

const acked = (s: TutorialState, i: number) => s.acked.has(i);

/** Players start with lichen & moss only (D-118); grasses then feed the rabbits, the first animal
 *  that can be selected and ordered (grasshoppers are a swarm). The `need`s follow the prices in
 *  species.toml and balance.toml. */
export const OBJECTIVES: Objective[] = [
  {
    title: "Welcome to the valley",
    text: "The bar at the top is your dashboard: the coloured bar shows your land (blue, from the left) against your rival's (orange), then your species alive, your biomass and what it earns each second.",
    tip: "Biomass buys everything: new species, plants, animals, catastrophes.",
    point: ["resources"],
    ack: true,
    done: acked,
  },
  {
    title: "Found your den",
    text: "Open Herbs in the bar at the bottom, pick Lichen & moss, then click anywhere on land. Your first planting is your den, the burrow at the heart of your land.",
    tip: "In a real match, losing the den cell loses the game: keep it deep inside your land.",
    point: ["family-L1"],
    done: (s) => s.owned > 0,
  },
  {
    title: "Through the fog",
    text: "You only see around your land and your animals. Taller plants see farther (herbs 2 cells, trees 5). Animals see by kind: insects barely, deer a little, birds of prey and wildcats far, fish only the water.",
    tip: "Out of sight, enemy animals vanish and enemy land shows as you last saw it.",
    ack: true,
    done: acked,
  },
  {
    title: "Let it spread",
    text: `Plants creep into free land next to them on their own. Plant more along your border to speed it up. Goal: ${Math.round(SPREAD_GOAL * 100)} % of the map.`,
    tip: "Income comes from growth: young, growing land earns more than old, full land.",
    point: ["land"],
    done: (s) => s.owned >= SPREAD_GOAL,
  },
  {
    title: "Read the soil",
    text: "Plants grow in four layers: herbs, undergrowth, shrubs, trees. A taller layer needs richer soil, and your herbs slowly build it. Open the display menu and turn on the Soil overlay to see where it is ready.",
    tip: "The Moisture and Bedrock overlays show where each plant grows best.",
    point: ["overlay-soil", "display"],
    done: (s) => s.overlay === "soil",
  },
  {
    title: "Plant Grasses",
    need: 500, // unlock 170 + a planting (about 13 cells × 22)
    text: "Open Herbs: the Grasses card fills with colour as you save up. Click it when its padlock turns gold: it unlocks and comes to hand. Plant grasses over your lichen.",
    tip: "Biodiversity: every extra species in a cell makes it stronger at the front and earn more.",
    point: ["family-L1"],
    done: (s) => s.plants.has("grasses"),
  },
  {
    title: "Grow a second layer",
    need: 1300, // Ferns 800 + a planting (about 13 cells × 35)
    text: "Unlock Ferns in Undergrowth and plant them where your soil is rich.",
    tip: "A cell's strength rises with its highest layer: that is how borders move.",
    point: ["family-L2"],
    done: (s) => s.layer >= 2,
  },
  {
    title: "Who eats whom",
    text: "Open the tech tree (T): it is a food web. Hover a species to light up its food and its hunters.",
    tip: "Grazers eat one layer: rabbits the herbs, deer the undergrowth, squirrels the shrubs.",
    point: ["tech"],
    done: (s) => s.techOpened,
  },
  {
    title: "Call rabbits",
    need: 3500, // Grasshoppers 600 + Rabbits 1000 + a card of two (800 each)
    text: "In Grazers (yellow), unlock Grasshoppers, then Rabbits, then click Rabbits: they come out of your den and walk from there.",
    tip: "A herd only grows as big as its habitat: about 5 rabbits per cell of your herbs.",
    point: ["family-H1"],
    done: (s) => s.animals > 0,
  },
  {
    title: "Command them",
    text: "Drag a box over your rabbits to select them, then right-click your land to move them.",
    tip: "Ctrl + 1 saves a selection as group 1; press 1 to recall it. Press I for group icons over every herd.",
    done: (s) => s.selected > 0,
  },
  {
    title: "Guard your den",
    text: "With your rabbits selected, press H, then click your den: they gather there and stay, grazing, instead of wandering off.",
    tip: "Idle animals spread over your land by themselves; a hold keeps them where you need them.",
    done: (s) => s.held,
  },
  {
    title: "Grow your herd",
    text: "Well-fed animals breed on your land. Keep your rabbits at home on your grass for a while and watch the herd grow.",
    tip: "A strong herd at home is the raid you send later.",
    done: (s) => s.born >= HERD_BIRTHS,
  },
  {
    title: "Raid the enemy",
    text: "Select your herd, press A, then click enemy land: they march there and graze it bare, and bare land is free to take.",
    tip: "In a real match, taking the enemy's den wins at once.",
    done: (s) => s.onEnemy > 0,
  },
  {
    title: DEFEND_TITLE,
    need: 1800, // Great tit 800 + a card of two (400 each) + spare
    text: "The enemy is sending grasshopper swarms onto your meadows! Great tits eat them: unlock Great tit in Insect eaters, call it, then send it onto the swarm (A + click).",
    tip: "Every grazer has a hunter: the tech tree shows who eats whom.",
    point: ["family-L3", "family-P1"],
    // Fallback: a bot left without grass cannot raid; then the unlock is enough.
    done: (s) =>
      s.fauna.has("great_tit") || (s.unlocked.has("great_tit") && s.raidOver && s.swarm === 0),
  },
  {
    title: "Strike from afar",
    need: 800, // the aphid outbreak 600 + spare
    text: "Open Catastrophes, at the right of the bottom bar, pick the Aphid outbreak and click enemy herbs: aphids blight every herb in the disc.",
    tip: "Catastrophes hit both sides alike, then cool down. Bigger ones open as the match goes on.",
    point: ["catastrophes"],
    done: (s) => s.cast,
  },
  {
    title: "Take the land",
    text: `Grow until you hold ${Math.round(TUTORIAL_GOAL * 100)} % of the map: spread, stack your layers and species, raid the front, and hunt the enemy's raiders.`,
    tip: "Bigger hunters wait higher up the tree, and the cell card can move your den.",
    point: ["land"],
    done: (s) => s.owned >= TUTORIAL_GOAL,
  },
];

/** What to grant on entering step `step` with `bank` biomass: the shortfall to its need. */
export function topUp(step: number, bank: number): number {
  return Math.max(0, Math.ceil((OBJECTIVES[step]?.need ?? 0) - bank));
}

/** The current objective (OBJECTIVES.length: all done): from `step`, past every one done now. */
export function advance(step: number, s: TutorialState): number {
  let i = step;
  while (i < OBJECTIVES.length && OBJECTIVES[i]?.done(s, i)) i++;
  return i;
}
