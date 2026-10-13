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
  /** Short bullets, one idea each (D-261). */
  text: string[];
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
/** Biomass granted when the tutorial starts (D-261), on top of the per-step top-ups: room to
 *  unlock and try species without getting stuck. */
export const TUTORIAL_BUDGET = 4000;

const acked = (s: TutorialState, i: number) => s.acked.has(i);

/** Players start with lichen & moss only (D-118); grasses then feed the rabbits, the first animal
 *  that can be selected and ordered (grasshoppers are a swarm). The `need`s follow the prices in
 *  species.toml and balance.toml. Texts are short bullets with no figures (D-258, D-261): only
 *  the goals give one. */
export const OBJECTIVES: Objective[] = [
  {
    title: "Welcome to the valley",
    text: [
      "The top bar is your dashboard: your land (blue) against your rival's (orange).",
      "Then your species alive, your biomass, and what it earns each second.",
      "Biomass is the currency: species, plantings, animals, catastrophes.",
    ],
    point: ["resources"],
    ack: true,
    done: acked,
  },
  {
    title: "Found your den",
    text: [
      "Open Herbs in the bottom bar and pick Lichen & moss.",
      "Click anywhere on land: your first planting is your den.",
    ],
    tip: "In a real match, losing your den loses the game.",
    point: ["family-L1"],
    done: (s) => s.owned > 0,
  },
  {
    title: "Through the fog",
    text: [
      "You see only around your land and your animals.",
      "Taller plants see farther than herbs.",
      "Insects see little, birds of prey far, fish only the water.",
    ],
    ack: true,
    done: acked,
  },
  {
    title: "Let it spread",
    text: [
      "Plants creep into free land on their own.",
      "Plant along your border to speed it up.",
      `Goal: ${Math.round(SPREAD_GOAL * 100)} % of the map.`,
    ],
    tip: "Growing cells earn the most biomass; mature, full cells earn less.",
    point: ["land"],
    done: (s) => s.owned >= SPREAD_GOAL,
  },
  {
    title: "Read the soil",
    text: [
      "Four plant layers: herbs, undergrowth, shrubs, trees.",
      "Taller layers need richer soil; your herbs build it.",
      "Display menu: turn on the Soil overlay.",
    ],
    point: ["overlay-soil", "display"],
    done: (s) => s.overlay === "soil",
  },
  {
    title: "Clear the view",
    text: ["Turn the Soil overlay off with the same button."],
    point: ["overlay-soil", "display"],
    done: (s) => s.overlay === null,
  },
  {
    title: "Rock and water",
    text: [
      "Bedrock: each plant grows faster on its favourite rock.",
      "Moisture: some plants like it wet, others dry.",
      "Turn on Bedrock or Moisture.",
    ],
    tip: "Click a cell: plant cards fade where they would grow poorly.",
    point: ["overlay-bedrock", "overlay-moisture", "display"],
    done: (s) => s.overlay === "bedrock" || s.overlay === "moisture",
  },
  {
    title: "Clear the view again",
    text: ["Turn the overlay off; come back to it when you plan a planting."],
    point: ["overlay-bedrock", "overlay-moisture", "display"],
    done: (s) => s.overlay === null,
  },
  {
    title: "Tech up: Grasses",
    need: 500, // unlock 170 + a planting (about 13 cells × 22)
    text: [
      "Each family has three tiers, like teching up units.",
      "Biomass unlocks the next tier: lichen is the first herb, Grasses the second.",
      "Open Herbs, unlock Grasses (gold padlock), plant them on your land.",
    ],
    point: ["family-L1"],
    done: (s) => s.plants.has("grasses"),
  },
  {
    title: "Grow a second layer",
    need: 1300, // Ferns 800 + a planting (about 13 cells × 35)
    text: ["Unlock Ferns in Undergrowth.", "Plant them where the soil is rich."],
    point: ["family-L2"],
    done: (s) => s.layer >= 2,
  },
  {
    title: "Push the enemy back",
    text: [
      "A thriving cell pushes into a weaker enemy cell and takes it.",
      "Strength: full plants, a high layer, rich soil.",
      "Above all biodiversity: each extra species multiplies strength and income.",
    ],
    tip: "Stack species and layers along the front.",
    ack: true,
    done: acked,
  },
  {
    title: "Who eats whom",
    text: ["Open the tech tree (T): a food web.", "Hover a species to see its food and hunters."],
    point: ["tech"],
    done: (s) => s.techOpened,
  },
  {
    title: "Four kinds of grazers",
    text: [
      "One grazer kind per plant layer: herbs, undergrowth, shrubs, trees.",
      "Hunters eat grazers; great predators eat hunters.",
      "A herd grows with the cells of its layer you hold.",
    ],
    ack: true,
    done: acked,
  },
  {
    title: "Call rabbits",
    need: 3500, // Grasshoppers 600 + Rabbits 1000 + a card of two (800 each)
    text: [
      "Grazers (yellow): unlock Grasshoppers, then Rabbits.",
      "Click Rabbits: they come out of your den.",
    ],
    point: ["family-H1"],
    done: (s) => s.animals > 0,
  },
  {
    title: "Command them",
    text: ["Drag a box over your rabbits to select them.", "Right-click your land to move them."],
    tip: "Ctrl + 1 saves a group, 1 recalls it. I shows group icons.",
    done: (s) => s.selected > 0,
  },
  {
    title: "Guard your den",
    text: ["Press H, then click your den.", "They gather there and stay."],
    tip: "Idle animals wander over your land; a hold keeps them in place.",
    done: (s) => s.held,
  },
  {
    title: "Grow your herd",
    text: [
      "Well-fed animals breed.",
      "At home they crop your plants, but never eat a cell down.",
      "Keep them on your grass and wait.",
    ],
    done: (s) => s.born >= HERD_BIRTHS,
  },
  {
    title: "Raid the enemy",
    text: [
      "On enemy land, grazers strip their layer bare: bare land is free to take.",
      "Select your herd, press A, click enemy land.",
    ],
    tip: "In a real match, taking the enemy's den wins.",
    done: (s) => s.onEnemy > 0,
  },
  {
    title: DEFEND_TITLE,
    need: 1800, // Great tit 800 + a card of two (400 each) + spare
    text: [
      "Grasshopper swarms are raiding your meadows!",
      "Unlock Great tit (Insect eaters) and call it.",
      "Send it onto the swarm: A + click.",
    ],
    point: ["family-L3", "family-P1"],
    // Fallback: a bot left without grass cannot raid; then the unlock is enough.
    done: (s) =>
      s.fauna.has("great_tit") || (s.unlocked.has("great_tit") && s.raidOver && s.swarm === 0),
  },
  {
    title: "Strike from afar",
    need: 800, // the aphid outbreak 600 + spare
    text: [
      "Open Catastrophes, right of the bottom bar.",
      "Cast the Aphid outbreak on enemy herbs.",
    ],
    tip: "Catastrophes hit both sides alike; bigger ones open later.",
    point: ["catastrophes"],
    done: (s) => s.cast,
  },
  {
    title: "Take the land",
    text: [
      `Hold ${Math.round(TUTORIAL_GOAL * 100)} % of the map.`,
      "Spread, stack layers and species, raid, hunt raiders.",
    ],
    tip: "Bigger hunters wait higher up the tree; the cell card can move your den.",
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
