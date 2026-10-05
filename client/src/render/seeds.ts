// Planting feedback (D-121, D-136): a sprinkle of small seeds falls from the sky over the
// planting area, lands, lies there a moment, then shrinks away; the plants' own grow-in takes over
// when the cells sprout. One instanced mesh for every burst in flight.

import * as THREE from "three/webgpu";

/** Seeds per click; fall time (s) and height (m, a range); sideways sway (m); time lying on the
 *  ground (s) and fade (s); seed size (m), at least `screen` x the camera distance so a sprinkle
 *  reads from the overview; start stagger (s); how many can be in flight at once. */
export const SEEDS = {
  count: 24,
  s: 0.9,
  height: [6, 9],
  sway: 0.35,
  rest: 0.5,
  fade: 0.3,
  size: 0.06,
  screen: 0.0035,
  stagger: 0.03,
  capacity: 240,
} as const;

export interface Seed {
  /** Where it lands (m). */
  x: number;
  y: number;
  z: number;
  /** How high it starts above its spot (m), when it starts (s), its sway phase (rad). */
  h: number;
  t0: number;
  phase: number;
  color: THREE.Color;
}

/** Where a seed is (m) at time `t` (s): falling with gravity onto its spot, swaying less as it
 *  nears the ground, then resting. */
export function seedAt(s: Seed, t: number): [number, number, number] {
  const k = Math.min(Math.max((t - s.t0) / SEEDS.s, 0), 1);
  const sway = SEEDS.sway * (1 - k) * Math.sin(k * Math.PI * 3 + s.phase);
  return [s.x + sway, s.y + s.h * (1 - k * k), s.z + sway * 0.6];
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

  /** Sprinkle seeds over a disc of `radius` m around (x, z), each landing on `height`. */
  add(
    x: number,
    z: number,
    radius: number,
    color: THREE.Color,
    now: number,
    height: (x: number, z: number) => number,
  ): void {
    const [low, high] = SEEDS.height;
    for (let i = 0; i < SEEDS.count; i++) {
      // Even angles with a little jitter, and an even spread over the disc (sqrt).
      const a = ((i + Math.random() * 0.6) / SEEDS.count) * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      const [x1, z1] = [x + Math.cos(a) * r, z + Math.sin(a) * r];
      this.seeds.push({
        x: x1,
        y: height(x1, z1) + SEEDS.size * 0.5,
        z: z1,
        h: low + (high - low) * Math.random(),
        t0: now + i * SEEDS.stagger,
        phase: Math.random() * Math.PI * 2,
        color,
      });
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
