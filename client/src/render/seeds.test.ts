import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { SEEDS, seedAt, seedScale, type Seed } from "./seeds";

const seed: Seed = {
  x0: 0,
  y0: 1,
  z0: 0,
  x1: 2,
  y1: 0,
  z1: 0,
  t0: 10,
  arc: 1,
  color: new THREE.Color(),
};

describe("seed burst (D-121)", () => {
  it("arcs from the click up and over, down onto its spot", () => {
    expect(seedAt(seed, 10)).toEqual([0, 1, 0]);
    const [, top] = seedAt(seed, 10 + SEEDS.s / 2);
    expect(top).toBeGreaterThan(1); // above the start mid-flight
    seedAt(seed, 10 + SEEDS.s).forEach((v, j) => expect(v).toBeCloseTo([2, 0, 0][j] ?? 0, 6));
    expect(seedAt(seed, 99)).toEqual([2, 0, 0]); // then it rests
  });

  it("lies a moment, then shrinks away", () => {
    expect(seedScale(seed, 10 + SEEDS.s + SEEDS.rest)).toBe(SEEDS.size);
    expect(seedScale(seed, 10 + SEEDS.s + SEEDS.rest + SEEDS.fade)).toBe(0);
  });
});
