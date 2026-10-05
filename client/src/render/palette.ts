// The single palette file (INSTRUCTIONS §7.1). Player hues use the Q-009 default: a blue / orange
// pair from Okabe-Ito, colour-blind safe, checked with the dataviz validator (ΔE 29 under protan).
// Plants wear their species' natural colour with a light tint of their owner's hue (D-067); the
// ground tint and the frontier line carry ownership. Animals are near-white player tints
// (predators vivid) so they stand out from the vegetation.

export const PLAYER = {
  1: {
    base: "#0072B2",
    animal: "#d8f0ff",
    predator: "#00e0ff",
  },
  2: {
    base: "#E69F00",
    animal: "#fff0c8",
    predator: "#ff5a1f",
  },
} as const;

/** Wildflower colours (D-150): yellow, white, violet, pink; one per patch. */
export const FLOWERS = ["#f2cf45", "#f4f1e6", "#9b7fd4", "#e58fb2"] as const;

export const WORLD = {
  soil: "#c8b58f", // bare, undeveloped ground (pale, sandy)
  soilRich: "#5c4430", // fully developed soil (dark humus)
  trunk: "#5b4533", // tree trunks
  alert: "#ff7a5c", // raid pings and alert accents (D-077)
  shallows: "#6f9c8f", // water over a near bed (D-085)
  deepWater: "#244b5a", // deep pools and pond centres
  rock: "#8a8176", // rock outcrops
  earthTop: "#3f3024", // diorama slab sides: topsoil band (D-054)
  earthSub: "#6d5840", // subsoil
  earthStone: "#8b8479", // bedrock at the bottom
  sky: "#dfe8ec", // hemisphere light from above
  /** The backdrop behind the diorama (D-110): soft blurred blobs of moss, sage, teal and earth
   *  over a misty base; the haze beyond the slab fades into `horizon`, its mid tone. */
  backdrop: ["#5f7d55", "#8aa37a", "#5f9a96", "#86a9a3", "#8a7457", "#6e6a4c"],
  backdropBase: "#7f9283",
  horizon: "#7f9283",
  sun: "#ffe7c4", // warm, low (D-086)
  groundLight: "#6b5f4c",
} as const;

/** The light of each weather (D-132): sun colour and strength, sky light strength, haze, the
 *  backdrop tint, and its particles (rain streaks or drifting dust; `amount`: share of the most
 *  drawn). Clear is the default light above. */
export interface Sky {
  sun: string;
  sunI: number;
  hemi: number;
  fog: string;
  tint: string;
  particles: "rain" | "dust" | null;
  amount: number;
  /** Particle colour. */
  mote: string;
}
export const SKY: Record<string, Sky> = {
  clear: {
    sun: WORLD.sun,
    sunI: 2.6,
    hemi: 1.3,
    fog: WORLD.horizon,
    tint: "#ffffff",
    particles: null,
    amount: 0,
    mote: "#ffffff",
  },
  rain: {
    sun: "#cfd8de",
    sunI: 1.3,
    hemi: 1.05,
    fog: "#7c8a90",
    tint: "#a3adb2",
    particles: "rain",
    amount: 0.7,
    mote: "#c4d2da",
  },
  drought: {
    sun: "#ffc47e",
    sunI: 3.1,
    hemi: 1.15,
    fog: "#b59d72",
    tint: "#efcf98",
    particles: "dust",
    amount: 0.5,
    mote: "#fbeecb",
  },
  flood: {
    sun: "#b4c2cb",
    sunI: 0.95,
    hemi: 0.95,
    fog: "#66767f",
    tint: "#86939b",
    particles: "rain",
    amount: 1,
    mote: "#b8c8d2",
  },
};

export type PlayerId = keyof typeof PLAYER;

/** Map overlay ramps (D-135): sequential, one hue each, light (low) to dark (high). */
export const OVERLAY_RAMPS = {
  soil: ["#f3e3b5", "#c08a2e", "#6b4410"],
  cover: ["#e3f1c8", "#6aa84f", "#1f5524"],
  diversity: ["#f1e2f3", "#b45fb5", "#5a1a63"],
  moisture: ["#dcecf7", "#5d9fd3", "#1c4f8a"],
  shade: ["#ececec", "#7a7a7a", "#2b2b2b"],
} as const;

/** Natural colour of each plant species (D-067); unknown species fall back per stratum. */
export const FLORA: Record<string, string> = {
  lichen_and_moss: "#8f9c6c", // grey-green
  grasses: "#8bb356",
  ferns: "#5d8f3e",
  wildflowers: "#b6b765", // meadow green, warmed by the flowers
  nettle: "#4f7b39",
  bramble: "#5d6b3b",
  elder: "#6f9148",
  hazel: "#8aa35a",
  hawthorn: "#56703a",
  oak: "#5b7936",
  beech: "#7c9d3d",
  chestnut: "#4c6a2d",
  cattails: "#7d9a4a", // reed green; the seed heads are drawn brown (D-125)
};
const FLORA_BY_LEVEL = ["#8bb356", "#6f9148", "#5b7936"] as const;

/** Share of the owner's hue mixed into a plant's natural colour. */
export const PLAYER_TINT = 0.15;

/** A plant's colour: its species' natural colour with a light tint of its owner's hue. */
export function plantColor(
  name: string,
  level: number,
  player: PlayerId,
): [number, number, number] {
  const base = hexToRgb(FLORA[name] ?? FLORA_BY_LEVEL[level - 1] ?? FLORA_BY_LEVEL[0]);
  const tint = hexToRgb(PLAYER[player].base);
  return [0, 1, 2].map((j) =>
    Math.round((base[j] ?? 0) * (1 - PLAYER_TINT) + (tint[j] ?? 0) * PLAYER_TINT),
  ) as [number, number, number];
}

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

const BARE = hexToRgb(WORLD.soil);
const RICH = hexToRgb(WORLD.soilRich);

/** Ground colour for a soil development of 0..255: from bare, pale earth to dark humus, so
 *  succession shows under the plants (D-051). */
export function soilColor(dev: number): [number, number, number] {
  const f = Math.min(Math.max(dev, 0), 255) / 255;
  return [0, 1, 2].map((j) =>
    Math.round((BARE[j] ?? 0) + ((RICH[j] ?? 0) - (BARE[j] ?? 0)) * f),
  ) as [number, number, number];
}

/** Player line colours for charts on the dark HUD surface (D-059): P1 as in the game, P2 one step
 *  deeper than its game orange so it sits in the dark-mode lightness band. Validated with the
 *  dataviz palette checker on #18211c: CVD ΔE 23.7 (protan), contrast ≥ 3:1. P2 lines are also
 *  dashed (D-040), so identity never rests on colour alone in the charts. */
export const CHART = { 1: "#0072B2", 2: "#C28000" } as const;
