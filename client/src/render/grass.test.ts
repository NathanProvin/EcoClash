import { describe, expect, it } from "vitest";
import { grassBlades, LICHEN, TUFT, tuftGeometry } from "./grass";
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

  it("builds lichen and flower tufts with one colour per patch (D-151)", () => {
    const g = tuftGeometry(n, 2, 6100, LICHEN.patch, 3, (rnd, hue) => ({
      position: [0, 0, 0, rnd(0), 0, 0, 0, 0, 1],
      normal: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      index: [0, 2, 1],
      hue: [hue, hue, hue],
    }));
    expect(g.getAttribute("position").count).toBe(n * n * 2 * 3);
    expect(g.index?.count).toBe(n * n * 2 * 3);
    const [hue, root] = [g.getAttribute("hue"), g.getAttribute("root")];
    const seen = new Map<string, number>();
    for (let v = 0; v < hue.count; v++) {
      const h = hue.getX(v);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(3);
      const key = `${Math.floor(root.getX(v) / LICHEN.patch)}:${Math.floor(root.getY(v) / LICHEN.patch)}`;
      if (seen.has(key)) expect(seen.get(key)).toBe(h);
      seen.set(key, h);
    }
  });
});
