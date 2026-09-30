// Progressive growth for instanced models (D-072). A GrowingMesh is an InstancedMesh whose
// instances have stable keys: `put` adds a model (it grows in from nothing) or moves it to a new
// size (it grows or shrinks to it), `drop` withers it away, `update` frees the withered ones.
// The animation runs in the vertex shader: each instance stores the ground point it grows from
// and (start time, from, to); the shader scales the model around that point by a smoothstep of
// the time since `start`. So nothing is written or uploaded per frame, only when models change
// (flora frames, 1.25 Hz at most). Any geometry and material can grow this way, so real models
// (glTF, with wind in the same position node) can replace the placeholders later.

import {
  clamp,
  instancedDynamicBufferAttribute,
  mix,
  positionLocal,
  smoothstep,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

/** Seconds for a model to grow in, change size, or wither away. */
export const GROW_S = 3;

/** An instance's pose: centre, footprint scale across, scale up, rotation about Y, colour, and
 *  the ground point it grows from (a tree's parts share their trunk base). */
export interface Pose {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  angle: number;
  color: THREE.Color;
  rootX: number;
  rootY?: number;
  rootZ: number;
}

/** The growth factor at time `t` of an animation started at `start`, from `from` to `to`: the
 *  shader's formula, on the CPU. */
export function growth(start: number, from: number, to: number, t: number): number {
  const k = Math.min(Math.max((t - start) / GROW_S, 0), 1);
  return from + (to - from) * k * k * (3 - 2 * k);
}

export class GrowingMesh<K> {
  readonly mesh: THREE.InstancedMesh;
  private readonly at = new Map<K, number>(); // key -> instance index
  private readonly keys: K[] = []; // instance index -> key
  private readonly dying = new Map<K, number>(); // key -> time it can be freed
  private readonly root: THREE.InstancedBufferAttribute; // x, 0, z
  private readonly grow: THREE.InstancedBufferAttribute; // start, from, to
  private readonly width: Float32Array; // the pose's `w`, to resize from the current size
  private readonly m = new Float32Array(16);
  private dirty = false;

  /** `now` is the time uniform the renderer sets once per frame (seconds). */
  constructor(
    geometry: THREE.BufferGeometry,
    capacity: number,
    material: THREE.MeshStandardNodeMaterial,
    now: THREE.UniformNode<"float", number>,
  ) {
    const n = Math.max(capacity, 1);
    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.root = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.grow = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.width = new Float32Array(n);
    for (const a of [this.root, this.grow]) a.setUsage(THREE.DynamicDrawUsage);
    // positionLocal is already instanced here (NodeMaterial.setupPosition): scale around root.
    // The attribute helper is typed Node<string>: name its vec3 type for the arithmetic below.
    const attr = (a: THREE.InstancedBufferAttribute) =>
      instancedDynamicBufferAttribute(a, "vec3") as unknown as ReturnType<typeof vec3>;
    const [root, g] = [attr(this.root), attr(this.grow)];
    const k = smoothstep(0, 1, clamp(now.sub(g.x).div(GROW_S), 0, 1));
    material.positionNode = root.add(positionLocal.sub(root).mul(mix(g.y, g.z, k)));
  }

  get count(): number {
    return this.keys.length;
  }

  /** Show `key` at `pose`: a new key grows in; a changed pose grows or shrinks to it from the
   *  size shown at `t`; an unchanged one is left alone (a withering one comes back). */
  put(key: K, pose: Pose, t: number): void {
    writeMatrix(this.m, pose);
    let i = this.at.get(key);
    if (i === undefined) {
      if (this.keys.length >= this.mesh.instanceMatrix.count) return; // full: skip, never throw
      i = this.keys.length;
      this.keys.push(key);
      this.at.set(key, i);
      this.set(i, pose, [t, 0, 1]);
      return;
    }
    const revived = this.dying.delete(key);
    const matrix = this.mesh.instanceMatrix.array as Float32Array;
    const same = this.m.every((v, j) => v === matrix[i * 16 + j]);
    if (same && !revived) {
      this.setColor(i, pose.color);
      return;
    }
    const g = this.grow.array as Float32Array;
    const shown = growth(g[i * 3] ?? 0, g[i * 3 + 1] ?? 0, g[i * 3 + 2] ?? 0, t);
    const from = same ? shown : (shown * (this.width[i] ?? 0)) / (pose.w || 1);
    this.set(i, pose, [t, from, 1]);
  }

  /** Wither `key` away from `t`; `update` frees it once gone. */
  drop(key: K, t: number): void {
    const i = this.at.get(key);
    if (i === undefined || this.dying.has(key)) return;
    const g = this.grow.array as Float32Array;
    const shown = growth(g[i * 3] ?? 0, g[i * 3 + 1] ?? 0, g[i * 3 + 2] ?? 0, t);
    g.set([t, shown, 0], i * 3);
    this.dying.set(key, t + GROW_S);
    this.dirty = true;
  }

  /** Free the models that have withered by `t`, then upload what changed. */
  update(t: number): void {
    for (const [key, until] of this.dying) {
      if (t >= until) this.free(key);
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.count = this.keys.length;
    for (const [attr, size] of [
      [this.mesh.instanceMatrix, 16],
      [this.mesh.instanceColor, 3],
      [this.root, 3],
      [this.grow, 3],
    ] as const) {
      if (!attr) continue;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(1, this.keys.length) * size);
      attr.needsUpdate = true;
    }
  }

  private set(i: number, pose: Pose, grow: [number, number, number]): void {
    (this.mesh.instanceMatrix.array as Float32Array).set(this.m, i * 16);
    (this.root.array as Float32Array).set([pose.rootX, pose.rootY ?? 0, pose.rootZ], i * 3);
    (this.grow.array as Float32Array).set(grow, i * 3);
    this.width[i] = pose.w;
    this.setColor(i, pose.color);
    this.dirty = true;
  }

  private setColor(i: number, c: THREE.Color): void {
    const col = this.mesh.instanceColor?.array as Float32Array | undefined;
    if (!col || (col[i * 3] === c.r && col[i * 3 + 1] === c.g && col[i * 3 + 2] === c.b)) return;
    col.set([c.r, c.g, c.b], i * 3);
    this.dirty = true;
  }

  /** Swap-remove: the last instance moves into the freed index. */
  private free(key: K): void {
    const i = this.at.get(key);
    this.dying.delete(key);
    if (i === undefined) return;
    const last = this.keys.length - 1;
    if (i !== last) {
      const move = (a: THREE.BufferAttribute | null | undefined, size: number) => {
        const v = a?.array as Float32Array | undefined;
        v?.copyWithin(i * size, last * size, last * size + size);
      };
      move(this.mesh.instanceMatrix, 16);
      move(this.mesh.instanceColor, 3);
      move(this.root, 3);
      move(this.grow, 3);
      this.width[i] = this.width[last] ?? 0;
      const moved = this.keys[last] as K;
      this.keys[i] = moved;
      this.at.set(moved, i);
    }
    this.keys.pop();
    this.at.delete(key);
    this.dirty = true;
  }
}

/** Rotation about Y, scale (`w` across, `h` up) and translation, column-major. */
export function writeMatrix(
  m: Float32Array,
  p: Pick<Pose, "x" | "y" | "z" | "w" | "h" | "angle">,
): void {
  const [c, s] = [Math.cos(p.angle) * p.w, Math.sin(p.angle) * p.w];
  m.set([c, 0, -s, 0, 0, p.h, 0, 0, s, 0, c, 0, p.x, p.y, p.z, 1]);
}
