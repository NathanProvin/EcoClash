import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import type { ReplayMeta } from "../replay/replay";
import {
  ANIMAL_FORM,
  AnimalView,
  BODIES,
  bodyGeometry,
  formOf,
  RING,
  ringRadius,
  GAIT,
  ANIMAL_SCALE,
  drawnLength,
  stepGait,
  turnToward,
} from "./animals";
import { animalGeometry, FINE_LENGTH, type AnimalForm } from "./bodies";

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
    view.rings = true; // owner rings show with the strategic icons (D-241)
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

describe("turnToward (D-111)", () => {
  it("turns by at most the step, the short way round", () => {
    expect(turnToward(0, 1, 0.1)).toBeCloseTo(0.1);
    expect(turnToward(0, -1, 0.1)).toBeCloseTo(-0.1);
    expect(turnToward(0, 0.05, 0.1)).toBeCloseTo(0.05);
    // From just under +pi to just over -pi is a small left turn, not a full spin.
    expect(turnToward(3.1, -3.1, 0.5)).toBeCloseTo(3.1 + (2 * Math.PI - 6.2));
  });
});

describe("gait (D-116)", () => {
  it("strides with the distance walked and settles when standing", () => {
    let g = { p: 0, amp: 0 };
    for (let i = 0; i < 30; i++) g = stepGait(g, 0.02, 1 / 60, 1, false); // 1.2 m/s
    expect(g.amp).toBeGreaterThan(0.9);
    const p = g.p;
    expect(p).toBeCloseTo(((30 * 0.02) / (GAIT.stride * 1)) * Math.PI, 5);
    for (let i = 0; i < 60; i++) g = stepGait(g, 0, 1 / 60, 1, false);
    expect(g.amp).toBeLessThan(0.01); // legs come to rest
    expect(g.p).toBe(p); // and do not keep pedalling
    expect(stepGait({ p: 0, amp: 0 }, 0, 0.1, 1, true).p).toBeGreaterThan(0); // wings flap
  });

  it("gives every species a coloured model whose legs swing in diagonal pairs", () => {
    for (const [name, form] of Object.entries(ANIMAL_FORM)) {
      const g = animalGeometry(form);
      expect(g.getAttribute("color"), name).toBeDefined();
      const gait = g.getAttribute("gait");
      const signs = new Set<number>();
      for (let i = 0; i < gait.count; i++) signs.add(gait.getX(i));
      const legged = !["bird", "fish", "duck", "frog"].includes(form.body);
      if (legged) expect([...signs].sort(), name).toEqual([-1, 0, 1]);
    }
    // Species of one body type still look apart: a fox is not a grey wolf.
    const tint = (n: string) => {
      const c = animalGeometry(ANIMAL_FORM[n] ?? formOf(n, "predator")).getAttribute("color");
      return [c.getX(0), c.getY(0), c.getZ(0)];
    };
    expect(tint("fox")).not.toEqual(tint("wolf"));
  });

  it("gives animals from rabbit size up a finer model, about 4x the triangles (D-150)", () => {
    const tris = (form: AnimalForm) => animalGeometry(form).getAttribute("position").count / 3;
    for (const [name, form] of Object.entries(ANIMAL_FORM)) {
      const coarse = tris({ ...form, length: 0 });
      const ratio = tris(form) / coarse;
      if (form.length >= FINE_LENGTH) expect(ratio, name).toBeGreaterThan(3);
      else expect(ratio, name).toBe(1); // small animals keep the light model
      expect(ratio, name).toBeLessThan(6);
    }
  });

  it("draws a fine species' far model as the coarse one (D-201)", () => {
    const tris = (g: ReturnType<typeof animalGeometry>) => g.getAttribute("position").count / 3;
    const fox = ANIMAL_FORM.fox ?? formOf("fox", "predator");
    expect(tris(animalGeometry(fox, true))).toBe(tris(animalGeometry({ ...fox, length: 0 })));
    expect(tris(animalGeometry(fox, true)) * 3).toBeLessThan(tris(animalGeometry(fox)));
  });
});

describe("drawn sizes (D-235)", () => {
  it("draws animals larger, small species most, large ones less", () => {
    expect(ANIMAL_SCALE).toBe(3.5);
    const vole = formOf("bank_vole", "herbivore");
    const deer = formOf("red_deer", "herbivore");
    const gain = (f: AnimalForm) => drawnLength(f) / f.length;
    expect(drawnLength(vole)).toBeCloseTo((0.1 * 3.5) / (1 + 0.75 * 0.1));
    expect(gain(vole)).toBeGreaterThan(gain(deer));
    expect(drawnLength(deer)).toBeGreaterThan(drawnLength(vole));
  });
});
