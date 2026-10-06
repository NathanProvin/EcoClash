import { describe, expect, it } from "vitest";
import sheet from "../../../data/species.toml?raw";
import { SPECIES_GLYPHS } from "./glyphs";

describe("species glyphs (D-167)", () => {
  it("draws every species of the stat sheet", () => {
    const names = [...sheet.matchAll(/^\[(?:flora|fauna)\.(\w+)\]/gm)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(40);
    for (const name of names) expect(SPECIES_GLYPHS[name as string], name).toMatch(/^M/);
  });

  it("keeps every glyph inside its 24 x 24 box (a little bleed allowed)", () => {
    for (const [name, d] of Object.entries(SPECIES_GLYPHS)) {
      const nums = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      for (const v of nums) expect(Math.abs(v), name).toBeLessThanOrEqual(360); // arc angles
      const points = d.split(/(?=[MLA])/).flatMap((cmd) => {
        const v = (cmd.slice(1).match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
        return cmd[0] === "A" ? [v.slice(5, 7)] : [v.slice(0, 2)];
      });
      for (const [x = 0, y = 0] of points) {
        expect(x, name).toBeGreaterThan(-1);
        expect(x, name).toBeLessThan(25);
        expect(y, name).toBeGreaterThan(-1);
        expect(y, name).toBeLessThan(25);
      }
    }
  });
});
