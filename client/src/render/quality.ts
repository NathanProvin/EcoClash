// Quality presets (INSTRUCTIONS §7.3, D-056, D-086): grass density, render resolution, sun shadows
// (map size, 0 = off) and post-processing (bloom and tilt-shift). The choice is a per-viewer
// convenience kept in the browser.

import type { HerbLod } from "./grass";

export type Quality = "low" | "medium" | "high";

export const QUALITY: Record<
  Quality,
  { grass: number; pixelRatio: number; shadow: number; post: boolean; herbLod: HerbLod }
> = {
  // tufts per cell; device pixel cap; herb level of detail (D-199): full within `near` m, the
  // share `min` by `far` m
  low: {
    grass: 6,
    pixelRatio: 1,
    shadow: 0,
    post: false,
    herbLod: { near: 20, far: 70, min: 0.3 },
  },
  medium: {
    grass: 12,
    pixelRatio: 1.5,
    shadow: 1024,
    post: false,
    herbLod: { near: 25, far: 90, min: 0.35 },
  },
  high: {
    grass: 14,
    pixelRatio: 1.25,
    shadow: 2048,
    post: true,
    herbLod: { near: 30, far: 110, min: 0.4 },
  }, // D-090, D-155: lighter than 24 / 2
};
const KEY = "ecoclash.quality";

/** The stored preset, or "medium" when none is stored, it is unknown, or storage is blocked. */
export function loadQuality(storage?: Pick<Storage, "getItem">): Quality {
  try {
    // Inside the try: reading localStorage itself throws when site data is blocked.
    const v = (storage ?? globalThis.localStorage)?.getItem(KEY);
    return v && Object.hasOwn(QUALITY, v) ? (v as Quality) : "medium";
  } catch {
    return "medium";
  }
}

export function saveQuality(q: Quality, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? globalThis.localStorage)?.setItem(KEY, q);
  } catch {
    // private window or blocked storage: the preset just is not remembered
  }
}
