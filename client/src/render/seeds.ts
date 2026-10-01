// Planting feedback (D-121): a handful of seeds pop up from the clicked point and arc down onto
// the planting area, lie there a moment, then shrink away; the plants' own grow-in takes over when
// the cells sprout. One instanced mesh for every burst in flight.

import * as THREE from "three/webgpu";

/** Seeds per click; flight time (s) and arc height (share of the planting radius); time lying on
 *  the ground (s) and fade (s); seed size (m), at least `screen` x the camera distance so a burst
 *  reads from the overview; start stagger (s); how many can be in flight at once. */
export const SEEDS = {
  count: 12,
  s: 0.6,
  arc: 0.45,
  rest: 0.5,
  fade: 0.3,
  size: 0.12,
  screen: 0.006,
  stagger: 0.025,
  capacity: 120,
} as const;

export interface Seed {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  /** When it leaves (s), and the top of its arc above the straight line (m). */
  t0: number;
  arc: number;
  color: THREE.Color;
}

/** Where a seed is (m) at time `t` (s): a parabola from the click to its spot, then resting. */
export function seedAt(s: Seed, t: number): [number, number, number] {
  const k = Math.min(Math.max((t - s.t0) / SEEDS.s, 0), 1);
  const lift = 4 * s.arc * k * (1 - k);
  return [s.x0 + (s.x1 - s.x0) * k, s.y0 + (s.y1 - s.y0) * k + lift, s.z0 + (s.z1 - s.z0) * k];
}

/** A seed's scale at `t`: full size until it has rested, then shrinking to nothing. */
export function seedScale(s: Seed, t: number): number {
  const gone = (t - s.t0 - SEEDS.s - SEEDS.rest) / SEEDS.fade;
  return SEEDS.size * Math.min(Math.max(1 - gone, 0), 1);
}

export class SeedBurst {
  private readonly mesh: THREE.InstancedMesh;
  private seeds: Seed[] = [];
  private readonly m = new THREE.Matrix4();

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshBasicNodeMaterial(), // flat colour: tiny lit facets read as dark specks
      SEEDS.capacity,
    );
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(SEEDS.capacity * 3),
      3,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
  }

  /** Scatter seeds from (x, z) over a disc of `radius` m, each landing on `height`. */
  add(
    x: number,
    z: number,
    radius: number,
    color: THREE.Color,
    now: number,
    height: (x: number, z: number) => number,
  ): void {
    const y0 = height(x, z) + 0.3;
    for (let i = 0; i < SEEDS.count; i++) {
      // Even angles with a little jitter, and an even spread over the disc (sqrt).
      const a = ((i + Math.random() * 0.6) / SEEDS.count) * Math.PI * 2;
      const r = radius * Math.sqrt(0.1 + 0.9 * Math.random());
      const [x1, z1] = [x + Math.cos(a) * r, z + Math.sin(a) * r];
      const y1 = height(x1, z1) + SEEDS.size * 0.5;
      const t0 = now + i * SEEDS.stagger;
      this.seeds.push({ x0: x, y0, z0: z, x1, y1, z1, t0, arc: SEEDS.arc * radius, color });
    }
    if (this.seeds.length > SEEDS.capacity)
      this.seeds.splice(0, this.seeds.length - SEEDS.capacity);
  }

  /** Draw the seeds in flight at `now`, sized for a camera `far` metres away. */
  update(now: number, far: number): void {
    const grow = Math.max(1, (SEEDS.screen * far) / SEEDS.size);
    this.seeds = this.seeds.filter((s) => seedScale(s, now) > 0 || now < s.t0);
    this.seeds.forEach((s, i) => {
      const [x, y, z] = seedAt(s, now);
      const k = now < s.t0 ? 0 : seedScale(s, now) * grow;
      this.m.makeScale(k, k * 0.7, k).setPosition(x, y, z);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, s.color);
    });
    this.mesh.count = this.seeds.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
