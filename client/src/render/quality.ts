// Quality presets (INSTRUCTIONS §7.3, D-056): grass density and render resolution for now; shadows
// and post-processing join them in M5. The choice is a per-viewer convenience kept in the browser.

export type Quality = "low" | "medium" | "high";

export const QUALITY: Record<Quality, { grass: number; pixelRatio: number }> = {
  low: { grass: 6, pixelRatio: 1 }, // grass tufts per cell; device pixel ratio cap
  medium: { grass: 12, pixelRatio: 1.5 },
  high: { grass: 24, pixelRatio: 2 },
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
