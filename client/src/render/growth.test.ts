import * as THREE from "three/webgpu";
import { uniform } from "three/tsl";
import { describe, expect, it } from "vitest";
import { FALL_S, GROW_S, GrowingMesh, fallAngle, fallen, growth, type Pose } from "./growth";

function mesh() {
  const material = new THREE.MeshStandardNodeMaterial();
  return new GrowingMesh<string>(new THREE.BoxGeometry(), 8, material, uniform(0));
}
const pose = (x: number, w = 1): Pose => ({
  x,
  y: 0,
  z: 0,
  w,
  h: w,
  angle: 0,
  color: new THREE.Color(0.2, 0.5, 0.2),
  rootX: x,
  rootZ: 0,
});
/** Instance `i`'s (start, from, to), from the private growth attribute. */
const growOf = (g: GrowingMesh<string>, i: number) => {
  return (g as unknown as { grow: THREE.InstancedBufferAttribute }).grow.array.slice(
    i * 3,
    i * 3 + 3,
  );
};

describe("growth", () => {
  it("eases from `from` to `to` over GROW_S", () => {
    expect(growth(10, 0, 1, 10)).toBe(0);
    expect(growth(10, 0, 1, 10 + GROW_S / 2)).toBeCloseTo(0.5);
    expect(growth(10, 0, 1, 10 + GROW_S * 2)).toBe(1);
    expect(growth(10, 1, 0, 10 + GROW_S)).toBe(0);
  });
});

describe("GrowingMesh", () => {
  it("grows new keys from nothing and leaves unchanged ones alone", () => {
    const g = mesh();
    g.put("a", pose(1), 0);
    expect(g.count).toBe(1);
    expect([...growOf(g, 0)]).toEqual([0, 0, 1]);
    g.put("a", pose(1), 5); // same pose later: no restart
    expect([...growOf(g, 0)]).toEqual([0, 0, 1]);
  });

  it("resizes from the size shown now", () => {
    const g = mesh();
    g.put("a", pose(1, 1), 0);
    g.put("a", pose(1, 2), GROW_S); // fully grown at size 1, now target size 2
    const [start, from, to] = [...growOf(g, 0)];
    expect(start).toBe(GROW_S);
    expect(from).toBeCloseTo(0.5); // 1 shown / 2 target
    expect(to).toBe(1);
  });

  it("withers dropped keys, then frees them with a swap-remove", () => {
    const g = mesh();
    for (const [k, x] of [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ] as const)
      g.put(k, pose(x), 0);
    g.drop("a", GROW_S);
    g.update(GROW_S);
    expect(g.count).toBe(3); // still withering
    g.update(2 * GROW_S);
    expect(g.count).toBe(2);
    // "c" (the last) moved into "a"'s index 0: its matrix x is there now.
    expect((g.mesh.instanceMatrix.array as Float32Array)[12]).toBe(3);
    g.put("c", pose(3), 2 * GROW_S); // still known under its key: unchanged, no regrowth
    expect(g.count).toBe(2);
  });

  it("brings a withering key back from its current size", () => {
    const g = mesh();
    g.put("a", pose(1), 0);
    g.drop("a", GROW_S);
    g.put("a", pose(1), GROW_S * 1.5);
    const [, from, to] = [...growOf(g, 0)];
    expect(from).toBeCloseTo(0.5);
    expect(to).toBe(1);
    g.update(GROW_S * 10);
    expect(g.count).toBe(1); // not freed
  });
});

describe("felled trees (D-128)", () => {
  it("tilt about the root toward their side, accelerating, flat after FALL_S", () => {
    expect(fallAngle(10, 10)).toBe(0);
    expect(fallAngle(10, 10 + FALL_S / 2)).toBeLessThan(Math.PI / 4); // slow at first
    expect(fallAngle(10, 10 + FALL_S)).toBeCloseTo(Math.PI / 2);
    const top = fallen([0, 3, 0], 0, Math.PI / 2); // a 3 m trunk falling toward +x
    expect(top[0]).toBeCloseTo(3);
    expect(top[1]).toBeCloseTo(0);
    expect(top[2]).toBeCloseTo(0);
    const side = fallen([0, 2, 0], Math.PI / 2, Math.PI / 2); // toward +z
    expect(side[2]).toBeCloseTo(2);
  });

  it("lie down, then wither on the ground and go", () => {
    const g = mesh();
    g.put("a", pose(1), 0);
    g.fell("a", GROW_S, 0.5);
    const [start, from, to] = [...growOf(g, 0)];
    expect(start).toBeCloseTo(GROW_S + FALL_S, 5); // full size until it lies flat
    expect([from, to]).toEqual([1, 0]);
    g.update(GROW_S + FALL_S + GROW_S / 2);
    expect(g.count).toBe(1);
    g.update(GROW_S + FALL_S + GROW_S);
    expect(g.count).toBe(0);
  });
});
