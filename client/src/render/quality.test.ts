import { expect, it } from "vitest";
import { defaultQuality, loadQuality, QUALITY, saveQuality } from "./quality";

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

it("starts touch screens on Low, others on Medium; a stored choice wins (D-269)", () => {
  expect(defaultQuality(true)).toBe("low");
  expect(defaultQuality(false)).toBe("medium");
  expect(loadQuality({ getItem: () => null }, "low")).toBe("low");
  expect(loadQuality({ getItem: () => "high" }, "low")).toBe("high");
});
