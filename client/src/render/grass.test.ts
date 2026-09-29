import { describe, expect, it } from "vitest";
import { grassBlades, TUFT } from "./grass";
import { CELL } from "./layout";

describe("grassBlades", () => {
  const n = 6;
  const per = 5;
  const b = grassBlades(n, per);

  const blades = n * n * per * TUFT;

  it("makes one triangle per blade, TUFT blades per tuft", () => {
    expect(b.position.length).toBe(blades * 9);
    expect(b.root.length).toBe(blades * 6);
    expect(b.seed.length).toBe(blades * 3);
  });

  it("roots every blade inside its own cell, the same for its three vertices", () => {
    for (let blade = 0; blade < blades; blade++) {
      const c = Math.floor(blade / (per * TUFT));
      const x0 = ((c % n) - n / 2) * CELL;
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const [x, z] = [b.root[blade * 6] ?? NaN, b.root[blade * 6 + 1] ?? NaN];
      expect(x).toBeGreaterThanOrEqual(x0);
      expect(x).toBeLessThan(x0 + CELL);
      expect(z).toBeGreaterThanOrEqual(z0);
      expect(z).toBeLessThan(z0 + CELL);
      expect([b.root[blade * 6 + 4], b.root[blade * 6 + 5]]).toEqual([x, z]);
    }
  });

  it("gives seeds in [0, 1) and is deterministic", () => {
    expect(b.seed.every((s) => s >= 0 && s < 1)).toBe(true);
    const again = grassBlades(n, per);
    expect(again.position).toEqual(b.position);
    expect(again.seed).toEqual(b.seed);
  });
});
