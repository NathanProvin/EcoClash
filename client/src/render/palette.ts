// The single palette file (INSTRUCTIONS §7.1). Player hues use the Q-009 default: a blue / orange
// pair from Okabe-Ito, colour-blind safe, checked with the dataviz validator (ΔE 29 under protan).
// Placeholder shapes: each stratum is a lighter-to-darker step of its owner's hue. Animals are
// near-white player tints (predators vivid) so they stand out from the vegetation.

export const PLAYER = {
  1: {
    base: "#0072B2",
    strata: ["#9ecae9", "#3b8fc4", "#003d61"],
    animal: "#d8f0ff",
    predator: "#00e0ff",
  },
  2: {
    base: "#E69F00",
    strata: ["#f5d08a", "#e39b2d", "#8a4b00"],
    animal: "#fff0c8",
    predator: "#ff5a1f",
  },
} as const;

export const WORLD = {
  soil: "#c1b196", // bare, undeveloped ground (pale, sandy)
  soilRich: "#7a6247", // fully developed soil (humus)
  earthTop: "#3f3024", // diorama slab sides: topsoil band (D-054)
  earthSub: "#6d5840", // subsoil
  earthStone: "#8b8479", // bedrock at the bottom
  sky: "#dfe8ec",
  horizon: "#c9d3cf",
  sun: "#fff4e0",
  groundLight: "#6b5f4c",
} as const;

export type PlayerId = keyof typeof PLAYER;

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
