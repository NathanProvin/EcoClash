import { describe, expect, it } from "vitest";
import {
  assign,
  CELL,
  cellSlots,
  LOW,
  LOW_CLEAR,
  LOW_GAP,
  BASE_MODELS,
  densityAt,
  MAX_MODELS,
  patchiness,
  plantLayout,
  rand,
  share,
  SHRUB,
  SHRUB_GAP,
  stratumOf,
  treesIn,
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
  it("keeps shrubs and clumps apart, clear of every trunk slot, and everything inside the cell", () => {
    let full = 0; // cells with a slot for every shrub (dart-throwing may fit one fewer)
    for (let cell = 0; cell < 4000; cell++) {
      const [low = [], shrubs = [], trees = [], pads = []] = cellSlots(cell);
      expect(shrubs.length, `cell ${cell}`).toBeGreaterThanOrEqual(BASE_MODELS[1] - 1);
      expect(low.length, `cell ${cell}`).toBeGreaterThanOrEqual(BASE_MODELS[0]);
      expect(pads).toBe(low); // pads float where clumps would stand
      if (shrubs.length >= BASE_MODELS[1]) full++;
      for (const s of shrubs) {
        expect(inside(s, SHRUB.max)).toBe(true);
        for (const t of trees) expect(dist(s, t)).toBeGreaterThanOrEqual(TRUNK_CLEAR);
        for (const o of shrubs) if (o !== s) expect(dist(s, o)).toBeGreaterThanOrEqual(SHRUB_GAP);
      }
      for (const s of low) {
        expect(inside(s, LOW.max)).toBe(true);
        for (const t of trees) expect(dist(s, t)).toBeGreaterThanOrEqual(LOW_CLEAR);
        for (const o of low) if (o !== s) expect(dist(s, o)).toBeGreaterThanOrEqual(LOW_GAP);
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
      for (const s of cellSlots(cell)[1] ?? []) xs.add(s.x.toFixed(2));
    expect(xs.size).toBeGreaterThan(90); // positions vary freely, not a few grid columns
  });
});

describe("stratumOf", () => {
  it("maps height levels to model strata, aquatic herbs to pads, land herbs to grass", () => {
    expect([1, 2, 3, 4].map((l) => stratumOf(l, false))).toEqual([null, 0, 1, 2]);
    expect(stratumOf(1, true)).toBe(3);
  });
});

describe("plantLayout", () => {
  it("keeps every model on its fixed slot, whatever the cover", () => {
    for (let cell = 0; cell < 500; cell++) {
      const slots = cellSlots(cell);
      const strata = [mix(cell, 40, 0), mix(cell, 1, 3), mix(cell, 20, 6), mix(cell, 60, 9)];
      plantLayout(cell, strata).forEach((models, s) => {
        for (const m of models)
          expect([m.x, m.z]).toEqual([slots[s]?.[m.slot]?.x, slots[s]?.[m.slot]?.z]);
        expect(models.length).toBeLessThanOrEqual(MAX_MODELS[s] ?? 0);
      });
    }
  });

  it("adds models as the cover grows, none on bare ground, every species present", () => {
    expect(plantLayout(7, []).flat()).toHaveLength(0);
    const full = (species: number) => [{ species, cover: 1 }];
    const counts = plantLayout(7, [full(1), full(4), full(9), full(12)]).map((m) => m.length);
    expect(counts).toEqual([BASE_MODELS[0], BASE_MODELS[1], treesIn(7), BASE_MODELS[3]]);
    const half = [
      { species: 9, cover: 0.5 },
      { species: 10, cover: 0.5 },
    ];
    const two = Array.from({ length: 100 }, (_, c) => c).find((c) => treesIn(c) === 2) ?? 0;
    const trees = plantLayout(two, [[], [], half])[2] ?? [];
    expect(new Set(trees.map((t) => t.species))).toEqual(new Set([9, 10]));
  });
});

describe("treesIn", () => {
  it("puts 1 tree per cell, 2 on about 15 % of the cells (D-109, D-151)", () => {
    let total = 0;
    for (let cell = 0; cell < 3000; cell++) total += treesIn(cell);
    expect(total / 3000).toBeCloseTo(1.15, 1);
  });
});

describe("patchiness (D-151)", () => {
  const n = 32;
  it("is smooth and spans its range", () => {
    let [lo, hi] = [1, 0];
    for (let c = 0; c < n * n; c++) {
      const v = patchiness(c, n, 1);
      [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
      if (c % n < n - 1) expect(Math.abs(v - patchiness(c + 1, n, 1))).toBeLessThan(0.5);
    }
    expect(lo).toBeLessThan(0.2);
    expect(hi).toBeGreaterThan(0.8);
  });

  it("thins shrubs by about 15 % on average, in patches, and keeps undergrowth even", () => {
    let [shrub, low] = [0, 0];
    for (let c = 0; c < n * n; c++) {
      const d = densityAt(c, n);
      shrub += d[1] ?? 1;
      low += d[0] ?? 1;
    }
    expect(shrub / (n * n)).toBeCloseTo(0.85, 1);
    expect(low / (n * n)).toBeCloseTo(1, 1);
  });

  it("scales a cell's models by its density, within MAX_MODELS", () => {
    const full = (species: number) => [{ species, cover: 1 }];
    const strata = [full(1), full(4)];
    const counts = (d: number[]) => plantLayout(7, strata, [], undefined, d).map((m) => m.length);
    expect(counts([0.3, 0.3])).toEqual([1, 1, 0, 0]);
    const dense = counts([1.6, 1.4]);
    expect(dense[0]).toBeLessThanOrEqual(MAX_MODELS[0]);
    expect(dense[1]).toBeGreaterThan(BASE_MODELS[1]);
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
