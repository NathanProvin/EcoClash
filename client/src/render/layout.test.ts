import { describe, expect, it } from "vitest";
import {
  CELL,
  MAX_MODELS,
  plantLayout,
  rand,
  share,
  SHRUB,
  TREE,
  TRUNK_GAP,
  type Placement,
} from "./layout";

const inside = (p: Placement, r: number) =>
  p.x - r >= 0 && p.x + r <= CELL && p.z - r >= 0 && p.z + r <= CELL;
const dist = (a: Placement, b: Placement) => Math.hypot(a.x - b.x, a.z - b.z);

/** Random species covers for a cell: up to three species per stratum. */
function mix(cell: number, salt: number, first: number) {
  return [0, 1, 2]
    .map((i) => ({
      species: first + i,
      cover: rand(cell, salt + i) > 0.5 ? rand(cell, salt + 9 + i) : 0,
    }))
    .filter((p) => p.cover > 0);
}

describe("plantLayout", () => {
  it("keeps shrub bases and trunks apart, and inside their cell", () => {
    for (let cell = 0; cell < 4000; cell++) {
      const [shrubs, trees] = plantLayout(cell, mix(cell, 1, 3), mix(cell, 20, 6));
      for (const s of shrubs) {
        expect(inside(s, s.size), `cell ${cell} shrub`).toBe(true);
        for (const t of trees) expect(dist(s, t)).toBeGreaterThanOrEqual(s.size + TREE.trunkR);
      }
      for (let i = 0; i < shrubs.length; i++) {
        for (let j = i + 1; j < shrubs.length; j++) {
          const [a, b] = [shrubs[i] as Placement, shrubs[j] as Placement];
          expect(dist(a, b)).toBeGreaterThanOrEqual(a.size + b.size);
        }
      }
      for (let i = 0; i < trees.length; i++) {
        const a = trees[i] as Placement;
        expect(inside(a, TREE.trunkR), `cell ${cell} trunk`).toBe(true);
        for (let j = i + 1; j < trees.length; j++) {
          expect(dist(a, trees[j] as Placement)).toBeGreaterThanOrEqual(TRUNK_GAP - 1e-9);
        }
      }
    }
  });

  it("gives big crowns but keeps trunks far enough apart that crowns never merge", () => {
    expect(TREE.max * 2).toBeGreaterThan(CELL / 2); // crowns wider than their slot
    expect(TRUNK_GAP).toBeGreaterThan(TREE.max); // two crowns overlap by less than a radius
    expect(SHRUB.max).toBeLessThan(CELL / 3 / 2); // a shrub base fits its 3 x 3 slot
  });

  it("adds models as the cover grows, none on bare ground, every species present", () => {
    expect(plantLayout(7, [], []).flat()).toHaveLength(0);
    const one = [{ species: 4, cover: 1 }];
    const [shrubs, trees] = plantLayout(7, one, [{ species: 9, cover: 1 }]);
    expect(trees).toHaveLength(MAX_MODELS[2]);
    expect(shrubs.length).toBeGreaterThan(0);
    const mixed = plantLayout(
      7,
      [],
      [
        { species: 9, cover: 0.5 },
        { species: 10, cover: 0.5 },
      ],
    )[1];
    expect(new Set(mixed.map((t) => t.species))).toEqual(new Set([9, 10]));
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
