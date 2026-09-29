import { describe, expect, it } from "vitest";
import { FLORA, hexToRgb, PLAYER, plantColor, soilColor, WORLD } from "./palette";

describe("soilColor", () => {
  it("runs from bare ground to humus, darker as the soil develops, clamped", () => {
    expect(soilColor(0)).toEqual(hexToRgb(WORLD.soil));
    expect(soilColor(255)).toEqual(hexToRgb(WORLD.soilRich));
    expect(soilColor(999)).toEqual(soilColor(255));
    const lum = (c: number[]) => c.reduce((a, b) => a + b, 0);
    expect(lum(soilColor(64))).toBeGreaterThan(lum(soilColor(192)));
  });
});

describe("plantColor", () => {
  it("keeps the species' natural colour, lightly tinted toward the owner", () => {
    const oak = hexToRgb(FLORA["oak"] ?? "#000000");
    const [p1, p2] = [plantColor("oak", 3, 1), plantColor("oak", 3, 2)];
    const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, j) => v - (b[j] ?? 0)));
    expect(dist(p1, oak)).toBeLessThan(40); // still an oak green
    expect(dist(p1, hexToRgb(PLAYER[1].base))).toBeLessThan(dist(p2, hexToRgb(PLAYER[1].base)));
    expect(plantColor("unknown", 2, 1)).toHaveLength(3);
  });
});
