import { expect, it } from "vitest";
import { loadQuality, QUALITY, saveQuality } from "./quality";

it("remembers a preset and falls back to medium on anything else", () => {
  const box = new Map<string, string>();
  const storage = {
    getItem: (k: string) => box.get(k) ?? null,
    setItem: (k: string, v: string) => void box.set(k, v),
  };
  expect(loadQuality(storage)).toBe("medium");
  saveQuality("low", storage);
  expect(loadQuality(storage)).toBe("low");
  box.set("ecoclash.quality", "toString"); // not a preset, even if the object has the key
  expect(loadQuality(storage)).toBe("medium");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  expect(loadQuality(blocked)).toBe("medium");
  expect(QUALITY.low.grass).toBeLessThan(QUALITY.high.grass);
});
