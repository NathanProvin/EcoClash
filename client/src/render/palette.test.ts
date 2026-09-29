import { describe, expect, it } from "vitest";
import { hexToRgb, soilColor, WORLD } from "./palette";

describe("soilColor", () => {
  it("runs from bare ground to humus, darker as the soil develops, clamped", () => {
    expect(soilColor(0)).toEqual(hexToRgb(WORLD.soil));
    expect(soilColor(255)).toEqual(hexToRgb(WORLD.soilRich));
    expect(soilColor(999)).toEqual(soilColor(255));
    const lum = (c: number[]) => c.reduce((a, b) => a + b, 0);
    expect(lum(soilColor(64))).toBeGreaterThan(lum(soilColor(192)));
  });
});
