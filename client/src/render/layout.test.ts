import { describe, expect, it } from "vitest";
import {
  assign,
  CELL,
  cellSlots,
  MAX_MODELS,
  plantLayout,
  rand,
  share,
  SHRUB,
  SHRUB_GAP,
  TREE,
  TRUNK_CLEAR,
  TRUNK_GAP,
  type Slot,
} from "./layout";

const dist = (a: Slot, b: Slot) => Math.hypot(a.x - b.x, a.z - b.z);
const inside = (p: Slot, r: number) =>
  p.x - r >= 0 && p.x + r <= CELL && p.z - r >= 0 && p.z + r <= CELL;

/** Random species covers for a cell: up to three species per stratum. */
function mix(cell: number, salt: number, first: number) {
  return [0, 1, 2]
    .map((i) => ({
      species: first + i,
      cover: rand(cell, salt + i) > 0.5 ? rand(cell, salt + 9 + i) : 0,
    }))
    .filter((p) => p.cover > 0);
}

describe("cellSlots", () => {
  it("keeps shrubs apart, clear of every trunk slot, and everything inside the cell", () => {
    let full = 0; // cells with a slot for every shrub (dart-throwing may fit one fewer)
    for (let cell = 0; cell < 4000; cell++) {
      const [shrubs, trees] = cellSlots(cell);
      expect(shrubs.length, `cell ${cell}`).toBeGreaterThanOrEqual(MAX_MODELS[1] - 1);
      if (shrubs.length >= MAX_MODELS[1]) full++;
      for (const s of shrubs) {
        expect(inside(s, SHRUB.max)).toBe(true);
        for (const t of trees) expect(dist(s, t)).toBeGreaterThanOrEqual(TRUNK_CLEAR);
        for (const o of shrubs) if (o !== s) expect(dist(s, o)).toBeGreaterThanOrEqual(SHRUB_GAP);
      }
      for (const t of trees) {
        expect(inside(t, TREE.trunkR)).toBe(true);
        for (const o of trees)
          if (o !== t) expect(dist(t, o)).toBeGreaterThanOrEqual(TRUNK_GAP - 1e-9);
      }
    }
    expect(full / 4000).toBeGreaterThan(0.97);
  });

  it("does not put shrubs on a grid", () => {
    const xs = new Set<string>();
    for (let cell = 0; cell < 50; cell++)
      for (const s of cellSlots(cell)[0]) xs.add(s.x.toFixed(2));
    expect(xs.size).toBeGreaterThan(120); // positions vary freely, not a few grid columns
  });
});

describe("plantLayout", () => {
  it("keeps every model on its fixed slot, whatever the cover", () => {
    for (let cell = 0; cell < 500; cell++) {
      const slots = cellSlots(cell);
      const [shrubs, trees] = plantLayout(cell, mix(cell, 1, 3), mix(cell, 20, 6));
      for (const m of shrubs)
        expect([m.x, m.z]).toEqual([slots[0][m.slot]?.x, slots[0][m.slot]?.z]);
      for (const m of trees) expect([m.x, m.z]).toEqual([slots[1][m.slot]?.x, slots[1][m.slot]?.z]);
      expect(shrubs.length).toBeLessThanOrEqual(MAX_MODELS[1]);
      expect(trees.length).toBeLessThanOrEqual(MAX_MODELS[2]);
    }
  });

  it("adds models as the cover grows, none on bare ground, every species present", () => {
    expect(plantLayout(7, [], []).flat()).toHaveLength(0);
    const [shrubs, trees] = plantLayout(7, [{ species: 4, cover: 1 }], [{ species: 9, cover: 1 }]);
    expect(trees).toHaveLength(MAX_MODELS[2]);
    expect(shrubs).toHaveLength(MAX_MODELS[1]);
    const half = [
      { species: 9, cover: 0.5 },
      { species: 10, cover: 0.5 },
    ];
    expect(new Set(plantLayout(7, [], half)[1].map((t) => t.species))).toEqual(new Set([9, 10]));
  });
});

describe("assign", () => {
  it("keeps a slot's species while it still has a share", () => {
    const p = (species: number, cover: number) => ({ species, cover });
    const before = assign(3, [p(1, 0.34), p(2, 0.33), p(3, 0.33)]);
    expect(new Set(before)).toEqual(new Set([1, 2, 3]));
    // Species 1 grows, species 3 fades: only 3's slot changes hands.
    const after = assign(3, [p(1, 0.6), p(2, 0.4)], before);
    before.forEach((s, j) => {
      if (s !== 3) expect(after[j]).toBe(s);
    });
    expect(after.filter((s) => s === 1)).toHaveLength(2);
  });
});

describe("share", () => {
  it("splits slots in proportion to cover, largest remainder first", () => {
    const p = (species: number, cover: number) => ({ species, cover });
    expect(share(4, [p(1, 0.75), p(2, 0.25)])).toEqual([1, 1, 1, 2]);
    expect(share(2, [p(1, 0.5), p(2, 0.3), p(3, 0.2)])).toEqual([1, 2]);
    expect(share(0, [p(1, 1)])).toEqual([]);
    expect(share(3, [])).toEqual([]);
  });
});
