import { describe, expect, it } from "vitest";
import {
  animalSlots,
  CANOPY_BOTTOM,
  CANOPY_Y,
  CELL,
  CONE,
  CUBE,
  MAX_MODELS,
  plantLayout,
  rand,
  SHRUB_TOP,
  type Placement,
} from "./layout";

/** Footprint circle radius of each stratum's model. */
const footprint = [
  (p: Placement) => p.size,
  (p: Placement) => p.size,
  (p: Placement) => p.size / Math.SQRT2,
];

function inside(p: Placement, r: number) {
  return p.x - r >= 0 && p.x + r <= CELL && p.z - r >= 0 && p.z + r <= CELL;
}

describe("plantLayout", () => {
  it("never overlaps models, inside a cell or across cells", () => {
    for (let cell = 0; cell < 4000; cell++) {
      const cover = [rand(cell, 1), rand(cell, 2), rand(cell, 3)];
      const layers = plantLayout(cell, cover);
      layers.forEach((models, s) => {
        const r = footprint[s] ?? ((p: Placement) => p.size);
        for (const p of models) expect(inside(p, r(p)), `cell ${cell} stratum ${s}`).toBe(true);
        for (let i = 0; i < models.length; i++) {
          for (let j = i + 1; j < models.length; j++) {
            const [a, b] = [models[i] as Placement, models[j] as Placement];
            expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(r(a) + r(b));
          }
        }
      });
      // Herb dots and cone bases share the ground: they must not touch.
      for (const d of layers[0] ?? []) {
        for (const c of layers[1] ?? []) {
          expect(Math.hypot(d.x - c.x, d.z - c.z)).toBeGreaterThanOrEqual(d.size + c.size);
        }
      }
    }
  });

  it("keeps the height bands apart: cones end below the canopy", () => {
    expect(CONE.max * CONE.heightRatio).toBeLessThanOrEqual(SHRUB_TOP);
    expect(CANOPY_Y - CUBE.max / 2).toBeGreaterThanOrEqual(CANOPY_BOTTOM);
    expect(SHRUB_TOP).toBeLessThan(CANOPY_BOTTOM);
  });

  it("adds models as the cover grows, and none on bare ground", () => {
    expect(plantLayout(7, [0, 0, 0]).flat()).toHaveLength(0);
    const full = plantLayout(7, [1, 1, 1]);
    expect(full[1]).toHaveLength(MAX_MODELS[1]);
    expect(full[2]).toHaveLength(MAX_MODELS[2]);
    expect((full[0] ?? []).length).toBeGreaterThan(0);
  });
});

describe("animalSlots", () => {
  it("gives crowded animals distinct, non-overlapping spots inside the cell", () => {
    for (const count of [1, 2, 4, 5, 9, 17]) {
      const radius = 0.4;
      const slots = animalSlots(count, radius);
      const r = radius * (slots[0]?.scale ?? 1);
      for (let i = 0; i < count; i++) {
        const a = slots[i];
        expect(a && a.x - r >= 0 && a.x + r <= CELL).toBe(true);
        for (let j = i + 1; j < count; j++) {
          const b = slots[j];
          if (a && b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThanOrEqual(2 * r);
        }
      }
    }
  });
});
