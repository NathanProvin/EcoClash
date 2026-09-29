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

export const WORLD = {
  soil: "#c8b58f", // bare, undeveloped ground (pale, sandy)
  soilRich: "#5c4430", // fully developed soil (dark humus)
  trunk: "#5b4533", // tree trunks
  earthTop: "#3f3024", // diorama slab sides: topsoil band (D-054)
  earthSub: "#6d5840", // subsoil
  earthStone: "#8b8479", // bedrock at the bottom
  sky: "#dfe8ec",
  horizon: "#c9d3cf",
  sun: "#fff4e0",
  groundLight: "#6b5f4c",
} as const;

export type PlayerId = keyof typeof PLAYER;

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
 *  dashed, like its frontier (D-040), so identity never rests on colour alone. */
export const CHART = { 1: "#0072B2", 2: "#C28000" } as const;
