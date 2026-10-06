import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { curve, OrderLines, ORDER_LINE, ribbon } from "./orders";

describe("order lines (D-162)", () => {
  it("curves from the group to the target, bending to one side", () => {
    const pts = curve([0, 0], [10, 0], 24, ORDER_LINE.bend);
    expect(pts).toHaveLength(25);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[24]?.[0]).toBeCloseTo(10);
    expect(pts[24]?.[1]).toBeCloseTo(0);
    const mid = pts[12] ?? [0, 0];
    expect(mid[0]).toBeCloseTo(5);
    expect(Math.abs(mid[1])).toBeGreaterThan(0.5); // bent off the straight way
  });

  it("lays a ribbon of two vertices per point on the ground", () => {
    const pos = ribbon(
      [
        [0, 0],
        [1, 0],
      ],
      0.2,
      () => 3,
      0.1,
    );
    expect(pos).toHaveLength(12);
    expect(pos[1]).toBeCloseTo(3.1);
    expect(Math.abs((pos[2] ?? 0) - (pos[5] ?? 0))).toBeCloseTo(0.2); // its width, across the way
  });

  it("keeps a line while its animals follow the order, drops it after", () => {
    const scene = new THREE.Scene();
    const lines = new OrderLines(scene);
    lines.add([1, 2], new THREE.Vector3(8, 0, 8), "move");
    const drawn = [
      { id: 1, owner: 1, x: 0, y: 0, z: 0 },
      { id: 2, owner: 1, x: 2, y: 0, z: 0 },
    ];
    const moving = [1, 2].map((id) => ({ id, y: 0, x: 0, species: 0, owner: 1, order: 1 }));
    lines.update(drawn, moving, () => 0);
    expect(scene.children).toHaveLength(1);
    lines.update(
      drawn,
      moving.map((a) => ({ ...a, order: 0 })),
      () => 0,
    ); // arrived
    expect(scene.children).toHaveLength(0);
  });

  it("moves animals to their newest order's line", () => {
    const scene = new THREE.Scene();
    const lines = new OrderLines(scene);
    lines.add([1], new THREE.Vector3(8, 0, 8), "move");
    lines.add([1], new THREE.Vector3(-8, 0, 8), "attack");
    expect(scene.children).toHaveLength(1);
  });
});
