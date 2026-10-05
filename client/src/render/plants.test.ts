import { describe, expect, it } from "vitest";
import { LOW, TREE, type Placement } from "./layout";
import { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { LowPolyPlants, PlantView, type CellCover } from "./plants";

const style = new LowPolyPlants();
const at = (size: number, seed: number): Placement => ({
  x: 0,
  z: 0,
  angle: 0.3,
  seed,
  slot: 0,
  size,
  species: 0,
});

describe("LowPolyPlants (D-150)", () => {
  it("keeps every model within its part keys and the meshes it declares", () => {
    const cases = [
      ["tree", TREE.max, ["oak", "chestnut", "beech", "other"]],
      ["low", LOW.max, ["ferns", "nettle", "bramble", "other"]],
    ] as const;
    for (const [stratum, size, names] of cases) {
      const s = stratum === "tree" ? 2 : 0;
      for (const name of names) {
        for (const seed of [0, 0.37, 0.99]) {
          const parts = style.parts(stratum, at(size, seed), 0, 0, name);
          expect(parts.length, name).toBeGreaterThan(0);
          expect(parts.length, name).toBeLessThanOrEqual(12); // PARTS
          const used = new Map<number, number>();
          for (const p of parts) used.set(p.mesh, (used.get(p.mesh) ?? 0) + 1);
          for (const [mesh, count] of used) {
            expect(count, `${name} mesh ${mesh}`).toBeLessThanOrEqual(
              style.meshes[mesh]?.perModel[s] ?? 0,
            );
          }
        }
      }
    }
  });

  it("gives each tree species its silhouette: oak spreads, beech stands tall", () => {
    const extent = (name: string) => {
      const parts = style.parts("tree", at(TREE.max, 0.5), 0, 0, name).filter((p) => !p.color);
      const wide = Math.max(...parts.map((p) => Math.hypot(p.x, p.z) + p.w));
      const tall =
        Math.max(...parts.map((p) => p.y + p.h)) - Math.min(...parts.map((p) => p.y - p.h));
      return { wide, tall };
    };
    const [oak, beech] = [extent("oak"), extent("beech")];
    expect(oak.wide).toBeGreaterThan(beech.wide);
    expect(beech.tall / beech.wide).toBeGreaterThan(oak.tall / oak.wide);
  });

  it("varies trees of one species by their slot seed", () => {
    const key = (seed: number) =>
      JSON.stringify(style.parts("tree", at(TREE.max, seed), 0, 0, "oak").map((p) => p.x));
    expect(key(0.1)).not.toEqual(key(0.6));
  });
});

describe("PlantView repainting (D-153)", () => {
  const n = 4;
  const owner = new Uint8Array(n * n).fill(1);
  const ferns: CellCover = [[{ species: 0, cover: 1 }], [], [], []];
  const colors = { 1: [new THREE.Color(0x336633)], 2: [new THREE.Color(0x336633)] };
  const make = () => new PlantView(new THREE.Scene(), n, style, uniform(0));

  it("paints changed cells over frames and skips cells whose signature holds", () => {
    const view = make();
    const update = (sig: (c: number) => number) =>
      view.update(() => ferns, owner, ["ferns"], colors, undefined, null, undefined, sig);
    update(() => 1);
    expect(view.pending).toBe(n * n);
    view.frame(0, Infinity);
    expect(view.pending).toBe(0);
    update(() => 1); // nothing changed
    expect(view.pending).toBe(0);
    update((c) => (c === 5 ? 2 : 1)); // one cell changed
    expect(view.pending).toBe(1);
    view.frame(1, 0); // no time left this frame: it waits
    expect(view.pending).toBe(1);
    view.frame(1, Infinity);
    expect(view.pending).toBe(0);
  });
});
