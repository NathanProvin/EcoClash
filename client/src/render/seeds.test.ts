import { describe, expect, it } from "vitest";
import * as THREE from "three/webgpu";
import { SEEDS, seedAt, seedScale, type Seed } from "./seeds";

const seed: Seed = { x: 2, y: 0, z: 1, h: 8, t0: 10, phase: 0, color: new THREE.Color() };

describe("seed sprinkle (D-121, D-136)", () => {
  it("falls from high above onto its spot, faster near the ground", () => {
    expect(seedAt(seed, 10)[1]).toBe(8); // starts high
    const [, mid] = seedAt(seed, 10 + SEEDS.s / 2);
    expect(mid).toBeGreaterThan(4); // gravity: more than half the height left at half time
    seedAt(seed, 10 + SEEDS.s).forEach((v, j) => expect(v).toBeCloseTo([2, 0, 1][j] ?? 0, 6));
    expect(seedAt(seed, 99)).toEqual([2, 0, 1]); // then it rests
  });

  it("lies a moment, then shrinks away", () => {
    expect(seedScale(seed, 10 + SEEDS.s + SEEDS.rest)).toBeCloseTo(SEEDS.size, 6);
    expect(seedScale(seed, 10 + SEEDS.s + SEEDS.rest + SEEDS.fade)).toBeCloseTo(0, 6);
  });
});
