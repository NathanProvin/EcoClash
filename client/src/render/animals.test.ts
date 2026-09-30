import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import type { ReplayMeta } from "../replay/replay";
import { ANIMAL_FORM, AnimalView, BODIES, bodyGeometry, formOf, RING, ringRadius } from "./animals";

describe("bodyGeometry", () => {
  it("builds every body about one unit long, standing on the ground, head toward +x", () => {
    for (const body of BODIES) {
      const g = bodyGeometry(body);
      g.computeBoundingBox();
      const box = g.boundingBox;
      expect(box, body).not.toBeNull();
      if (!box) continue;
      const length = box.max.x - box.min.x;
      expect(length, body).toBeGreaterThan(0.8);
      expect(length, body).toBeLessThan(1.5);
      expect(box.max.x, `${body}: the head is forward`).toBeGreaterThan(-box.min.x - 0.2);
      if (body === "bird") expect(box.max.z - box.min.z, "wingspan").toBeGreaterThan(length);
      else expect(box.min.y, `${body}: on the ground`).toBeGreaterThanOrEqual(-0.01);
    }
  });
});

describe("forms", () => {
  it("keeps real proportions and gives every animal a ring it can be picked by", () => {
    const len = (n: string) => ANIMAL_FORM[n]?.length ?? 0;
    expect(len("bank_vole")).toBeLessThan(len("rabbits"));
    expect(len("rabbits")).toBeLessThan(len("fox"));
    expect(len("fox")).toBeLessThan(len("lynx"));
    expect(ringRadius(formOf("bank_vole", "herbivore"))).toBe(RING.min);
    expect(ringRadius(formOf("lynx", "predator"))).toBeGreaterThan(RING.min);
    expect(formOf("unknown", "predator").body).toBe("canid");
  });
});

describe("AnimalView parachute drops (D-080)", () => {
  it("lowers a dropped animal under a canopy, then lands it", () => {
    const meta = {
      version: 3,
      species: [],
      counts: [],
      n: 4,
      dt: 0.1,
      ticks: 1,
      field_every: 1,
      builds: [],
      flora: { names: [], level: [] },
      fauna: { names: ["bank_vole"], role: ["herbivore"] },
      series: {},
      log: [],
    } satisfies ReplayMeta;
    const scene = new THREE.Scene();
    const view = new AnimalView(scene, meta, 4);
    const vole = [{ id: 7, y: 1, x: 1, species: 0, owner: 1 }];
    const meshes = () => scene.children as THREE.InstancedMesh[];
    const heightOf = (m: THREE.InstancedMesh) => (m.instanceMatrix.array as Float32Array)[13];
    // The body mesh is the merged (non-indexed) one in use.
    const body = () => meshes().find((m) => m.count === 1 && m.geometry.index === null);
    const bodyY = () => {
      const b = body();
      return b ? heightOf(b) : NaN;
    };
    view.update(vole, new Set(), 0, 4, 1500, () => 500); // dropped 1 s ago
    expect(bodyY()).toBeGreaterThan(5); // still high in the air
    expect(meshes().filter((m) => m.count === 1).length).toBe(4); // body, ring, canopy, shadow
    view.update(vole, new Set(), 0, 4, 3500, () => 500); // just landed: a dust ring
    expect(bodyY()).toBe(0);
    expect(meshes().filter((m) => m.count === 1).length).toBe(3); // body, ring, dust
    view.update(vole, new Set(), 0, 4, 6000, () => 500); // settled
    expect(meshes().filter((m) => m.count === 1).length).toBe(2); // body, ring
    view.update(vole, new Set(), 0, 4, 9000, () => undefined); // no longer a recent drop
    const m = body()?.instanceMatrix.array as Float32Array;
    expect([...m.subarray(0, 16)].every(Number.isFinite)).toBe(true); // no NaN pose
  });
});
