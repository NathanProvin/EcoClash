// Progressive growth for instanced models (D-072). A GrowingMesh is an InstancedMesh whose
// instances have stable keys: `put` adds a model (it grows in from nothing) or moves it to a new
// size (it grows or shrinks to it), `drop` withers it away, `update` frees the withered ones.
// The animation runs in the vertex shader: each instance stores the ground point it grows from
// and (start time, from, to); the shader scales the model around that point by a smoothstep of
// the time since `start`. So nothing is written or uploaded per frame, only when models change
// (flora frames, 1.25 Hz at most). Any geometry and material can grow this way, so real models
// (glTF, with wind in the same position node) can replace the placeholders later. Wind (D-086)
// bends each model away from its root in the same node: rigid, stronger the taller.

import {
  clamp,
  cos,
  dot,
  instancedBufferAttribute,
  mix,
  positionLocal,
  sin,
  smoothstep,
  vec2,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";

/** Seconds for a model to grow in, change size, or wither away. */
export const GROW_S = 3;
/** Seconds for a felled tree to fall flat (D-128), before it withers away on the ground. */
export const FALL_S = 1.4;
/** A fall start that never comes: the model stands. */
const STANDING = 1e9;

/** Where model point `u` (relative to its root) lies once tilted by `theta` toward ground
 *  direction `dir` (radians about Y, 0 = +x): the shader's fall, on the CPU (D-128). */
export function fallen(u: [number, number, number], dir: number, theta: number): number[] {
  const [dx, dz] = [Math.cos(dir), Math.sin(dir)];
  const s = u[0] * dx + u[2] * dz;
  const s2 = s * Math.cos(theta) + u[1] * Math.sin(theta);
  const h2 = -s * Math.sin(theta) + u[1] * Math.cos(theta);
  return [u[0] + dx * (s2 - s), h2, u[2] + dz * (s2 - s)];
}

/** How far a fall started at `start` has tilted at `t` (radians): accelerating, like a falling
 *  tree, flat (pi / 2) after FALL_S. */
export function fallAngle(start: number, t: number): number {
  const k = Math.min(Math.max((t - start) / FALL_S, 0), 1);
  return k * k * (Math.PI / 2);
}

/** Wind (D-086): the prevailing direction (x, z) and a gust field over the map. `wind` gives a
 *  horizontal push in about -0.3..1.3 at a root (world x / z) and time (s); callers scale it. */
const WIND = { dir: [0.9, 0.44], gustScale: 0.03, gustSpeed: 0.12, swayHz: 0.35 } as const;

type Vec2Node = THREE.Node<"vec2">;
type FloatNode = THREE.Node<"float">;

export function wind(root: Vec2Node, t: FloatNode): Vec2Node {
  // Gusts (D-205): two slow waves crossing the map, not a 3D Perlin noise. The noise ran for
  // every vertex of every plant and grass blade, in the shadow pass too; this is a few sines.
  const g = root.mul(WIND.gustScale);
  const gust = sin(g.x.mul(6.1).add(t.mul(WIND.gustSpeed * 3.1)))
    .mul(cos(g.y.mul(4.7).sub(t.mul(WIND.gustSpeed * 2.3))))
    .mul(0.5)
    .add(0.5);
  const sway = sin(
    t
      .mul(Math.PI * 2 * WIND.swayHz)
      .add(root.x.mul(0.21))
      .add(root.y.mul(0.13)),
  );
  return vec2(...WIND.dir).mul(gust.add(sway.mul(0.3)));
}

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
  // Static buffers, uploaded only when `update` marks them (D-149): three re-uploads every
  // DynamicDrawUsage buffer in full on every render pass, which cost ~23 ms a frame late game.
  private readonly root: THREE.InstancedInterleavedBuffer; // x, 0, z
  private readonly grow: THREE.InstancedInterleavedBuffer; // start, from, to
  private readonly fall: THREE.InstancedInterleavedBuffer; // fall start, direction (D-128)
  private readonly width: Float32Array; // the pose's `w`, to resize from the current size
  private readonly m = new Float32Array(16);
  private dirty = false;

  /** `now` is the time uniform the renderer sets once per frame (seconds); `sway` is the wind's
   *  push at the top of a model, in metres per metre above its root (0: still). */
  constructor(
    geometry: THREE.BufferGeometry,
    capacity: number,
    material: THREE.MeshStandardNodeMaterial,
    now: THREE.UniformNode<"float", number>,
    sway = 0,
  ) {
    const n = Math.max(capacity, 1);
    this.mesh = new THREE.InstancedMesh(geometry, material, n);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.root = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 3), 3);
    this.grow = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 3), 3);
    this.fall = new THREE.InstancedInterleavedBuffer(new Float32Array(n * 2).fill(STANDING), 2);
    this.width = new Float32Array(n);
    // positionLocal is already instanced here (NodeMaterial.setupPosition): scale around root.
    // The attribute helper is typed Node<string>: name its vec3 type for the arithmetic below.
    const attr = (a: THREE.InstancedInterleavedBuffer) =>
      instancedBufferAttribute(a, "vec3") as unknown as ReturnType<typeof vec3>;
    const [root, g] = [attr(this.root), attr(this.grow)];
    const k = smoothstep(0, 1, clamp(now.sub(g.x).div(GROW_S), 0, 1));
    const sized = positionLocal.sub(root).mul(mix(g.y, g.z, k));
    // A felled tree (D-128) tilts about its root toward `dir`, accelerating (see `fallen`).
    const f = instancedBufferAttribute(this.fall, "vec2") as unknown as ReturnType<typeof vec2>;
    const kf = clamp(now.sub(f.x).div(FALL_S), 0, 1);
    const theta = kf.mul(kf).mul(Math.PI / 2);
    const dir = vec2(cos(f.y), sin(f.y));
    const along = dot(sized.xz, dir);
    const along2 = along.mul(cos(theta)).add(sized.y.mul(sin(theta)));
    const up2 = along
      .negate()
      .mul(sin(theta))
      .add(sized.y.mul(cos(theta)));
    const shift = dir.mul(along2.sub(along));
    const grown = root.add(vec3(sized.x.add(shift.x), up2, sized.z.add(shift.y)));
    if (sway === 0) {
      material.positionNode = grown;
    } else {
      const push = wind(root.xz, now).mul(grown.y.sub(root.y).mul(sway));
      material.positionNode = grown.add(vec3(push.x, 0, push.y));
    }
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

  /** Fell `key` at `t` toward `dir` (radians about Y, D-128): it falls flat over FALL_S, then
   *  withers away on the ground; `update` frees it once gone. */
  fell(key: K, t: number, dir: number): void {
    const i = this.at.get(key);
    if (i === undefined || this.dying.has(key)) return;
    const g = this.grow.array as Float32Array;
    const shown = growth(g[i * 3] ?? 0, g[i * 3 + 1] ?? 0, g[i * 3 + 2] ?? 0, t);
    g.set([t + FALL_S, shown, 0], i * 3);
    (this.fall.array as Float32Array).set([t, dir], i * 2);
    this.dying.set(key, t + FALL_S + GROW_S);
    this.touch(i);
  }

  /** Wither `key` away from `t`; `update` frees it once gone. */
  drop(key: K, t: number): void {
    const i = this.at.get(key);
    if (i === undefined || this.dying.has(key)) return;
    const g = this.grow.array as Float32Array;
    const shown = growth(g[i * 3] ?? 0, g[i * 3 + 1] ?? 0, g[i * 3 + 2] ?? 0, t);
    g.set([t, shown, 0], i * 3);
    this.dying.set(key, t + GROW_S);
    this.touch(i);
  }

  /** Free the models that have withered by `t`, then upload what changed. */
  update(t: number): void {
    for (const [key, until] of this.dying) {
      if (t >= until) this.free(key);
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.mesh.count = this.keys.length;
    // Only the instances that changed (D-203): a repaint touches a few cells at a time, and the
    // whole prefix of every attribute was uploaded each frame before.
    const lo = this.lo;
    const hi = Math.min(this.hi, this.keys.length - 1);
    [this.lo, this.hi] = [Infinity, -1];
    if (hi < lo) return; // only the count changed
    for (const [attr, size] of [
      [this.mesh.instanceMatrix, 16],
      [this.mesh.instanceColor, 3],
      [this.root, 3],
      [this.grow, 3],
      [this.fall, 2],
    ] as const) {
      if (!attr) continue;
      attr.clearUpdateRanges();
      attr.addUpdateRange(lo * size, (hi - lo + 1) * size);
      attr.needsUpdate = true;
    }
  }

  private set(i: number, pose: Pose, grow: [number, number, number]): void {
    (this.mesh.instanceMatrix.array as Float32Array).set(this.m, i * 16);
    (this.root.array as Float32Array).set([pose.rootX, pose.rootY ?? 0, pose.rootZ], i * 3);
    (this.grow.array as Float32Array).set(grow, i * 3);
    (this.fall.array as Float32Array).set([STANDING, 0], i * 2); // (re)placed: standing
    this.width[i] = pose.w;
    this.setColor(i, pose.color);
    this.touch(i);
  }

  private setColor(i: number, c: THREE.Color): void {
    const col = this.mesh.instanceColor?.array as Float32Array | undefined;
    if (!col || (col[i * 3] === c.r && col[i * 3 + 1] === c.g && col[i * 3 + 2] === c.b)) return;
    col.set([c.r, c.g, c.b], i * 3);
    this.touch(i);
  }

  /** Mark instance `i` changed: `update` uploads the range of changed instances only (D-203). */
  private touch(i: number): void {
    if (i < this.lo) this.lo = i;
    if (i > this.hi) this.hi = i;
    this.dirty = true;
  }
  private lo = Infinity;
  private hi = -1;

  /** Swap-remove: the last instance moves into the freed index. */
  private free(key: K): void {
    const i = this.at.get(key);
    this.dying.delete(key);
    if (i === undefined) return;
    const last = this.keys.length - 1;
    if (i !== last) {
      const move = (a: { array: ArrayLike<number> } | null | undefined, size: number) => {
        const v = a?.array as Float32Array | undefined;
        v?.copyWithin(i * size, last * size, last * size + size);
      };
      move(this.mesh.instanceMatrix, 16);
      move(this.mesh.instanceColor, 3);
      move(this.root, 3);
      move(this.grow, 3);
      move(this.fall, 2);
      this.width[i] = this.width[last] ?? 0;
      const moved = this.keys[last] as K;
      this.keys[i] = moved;
      this.at.set(moved, i);
      this.touch(i);
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
