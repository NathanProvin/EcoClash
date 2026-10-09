// Map overlays (D-135): one heatmap at a time over the ground, from the field frames. Each maps
// a feature of every cell to 0..1; the viewer paints it with the overlay's ramp, more opaque
// where the value is high, so low ground stays visible.

import type { Animal, Fields } from "../replay/replay";
import type { TerrainFrame } from "../render/terrain";
import { BEDROCK_NAMES } from "./species";
import { hexToRgb, OVERLAY_RAMPS } from "../render/palette";

export type OverlayId =
  "soil" | "L1" | "L2" | "L3" | "L4" | "diversity" | "moisture" | "shade" | "bedrock";

export interface Overlay {
  id: OverlayId;
  label: string;
  /** What high means, for the legend. */
  high: string;
  ramp: keyof typeof OVERLAY_RAMPS;
  /** Needs fields that only a live match sends. */
  live?: boolean;
  /** Row in the map menu (D-241): 1 the plant layers, 2 the ground, 3 the rest. */
  row: 1 | 2 | 3;
  /** Categories instead of a scale (D-240): one colour each, at even opacity; the legend names
   *  them. Their values are 0, 0.5 and 1 on the ramp; cells without a category stay clear. */
  classes?: readonly string[];
}

export const OVERLAYS: Overlay[] = [
  { id: "L1", label: "Herbs", high: "dense herbs", ramp: "cover", row: 1 },
  { id: "L2", label: "Undergrowth", high: "dense undergrowth", ramp: "cover", row: 1 },
  { id: "L3", label: "Shrubs", high: "dense shrubs", ramp: "cover", row: 1 },
  { id: "L4", label: "Trees", high: "dense trees", ramp: "cover", row: 1 },
  {
    id: "bedrock",
    label: "Bedrock",
    high: "rock type",
    ramp: "bedrock",
    live: true,
    row: 2,
    classes: BEDROCK_NAMES.slice(1),
  },
  { id: "moisture", label: "Moisture", high: "wet ground", ramp: "moisture", live: true, row: 2 },
  { id: "soil", label: "Soil", high: "fertile soil", ramp: "soil", row: 2 },
  { id: "diversity", label: "Diversity", high: "many species", ramp: "diversity", row: 3 },
  { id: "shade", label: "Shade", high: "deep shade", ramp: "shade", live: true, row: 3 },
];

/** Opacity of the overlay at value 0 and at value 1 (0..255); categories use one opacity. */
const ALPHA = [15, 170] as const;
const CLASS_ALPHA = 150;

/** Each cell's value, 0..1 (row-major, `n * n`). Diversity counts the plant species growing
 *  there and the animal species standing there, relative to the richest cell of the map; shade
 *  too is relative to the darkest cell. */
export function overlayValues(
  id: OverlayId,
  fields: Fields,
  animals: readonly Animal[],
  n: number,
  terrain?: TerrainFrame,
): Float32Array {
  const cells = n * n;
  const out = new Float32Array(cells);
  const bytes = (src: Uint8Array | undefined) => {
    for (let k = 0; k < cells; k++) out[k] = (src?.[k] ?? 0) / 255;
  };
  const relative = () => {
    const top = out.reduce((m, v) => Math.max(m, v), 0);
    if (top > 0) for (let k = 0; k < cells; k++) out[k] = (out[k] ?? 0) / top;
  };
  if (id === "bedrock") {
    // Types 1..3 at 0, 0.5, 1 on the ramp; none (0) is NaN: left clear.
    for (let k = 0; k < cells; k++) {
      const t = terrain?.bedrock?.[k] ?? 0;
      out[k] = t ? (t - 1) / 2 : NaN;
    }
  } else if (id === "soil") bytes(fields.soil);
  else if (id === "moisture") bytes(fields.moisture);
  else if (id === "shade") {
    bytes(fields.shade);
    relative();
  } else if (id === "diversity") {
    for (const c of fields.species)
      for (let k = 0; k < cells; k++) if (c[k]) out[k] = (out[k] ?? 0) + 1;
    const seen = new Set<number>();
    for (const a of animals) {
      const k = Math.floor(a.y) * n + Math.floor(a.x);
      const key = k * 64 + a.species;
      if (k < 0 || k >= cells || seen.has(key)) continue;
      seen.add(key);
      out[k] = (out[k] ?? 0) + 1;
    }
    relative();
  } else bytes(fields.cover[Number(id.slice(1)) - 1]);
  return out;
}

/** The ramp colour at `v` (0..1), interpolated between its stops, as sRGB bytes. */
export function rampAt(ramp: readonly string[], v: number): [number, number, number] {
  const x = Math.min(Math.max(v, 0), 1) * (ramp.length - 1);
  const i = Math.min(Math.floor(x), ramp.length - 2);
  const [a, b] = [hexToRgb(ramp[i] ?? "#000"), hexToRgb(ramp[i + 1] ?? "#000")];
  const t = x - i;
  return [0, 1, 2].map((j) => Math.round((a[j] ?? 0) + ((b[j] ?? 0) - (a[j] ?? 0)) * t)) as [
    number,
    number,
    number,
  ];
}

/** RGBA texels for `values` (`out`: 4 bytes per cell, same order); `classes`: one opacity, and
 *  NaN cells clear. */
export function paintOverlay(
  values: Float32Array,
  ramp: readonly string[],
  out: Uint8Array,
  classes = false,
): void {
  values.forEach((v, k) => {
    if (Number.isNaN(v)) return out.set([0, 0, 0, 0], k * 4);
    const [r, g, b] = rampAt(ramp, v);
    const a = classes ? CLASS_ALPHA : Math.round(ALPHA[0] + (ALPHA[1] - ALPHA[0]) * v);
    out.set([r, g, b, a], k * 4);
  });
}
