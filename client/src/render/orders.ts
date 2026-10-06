// Order lines (D-162): a faint curved ribbon on the ground from a group under orders to the point
// it was sent to, silvery grey for a move, fire red for an attack. It starts at the group's
// centre each frame, so it shortens as they go, and it goes when no animal of the order still
// follows it (the order byte of the animal frame, D-161).

import * as THREE from "three/webgpu";
import type { Animal } from "../replay/replay";
import type { Drawn } from "./animals";

/** Ribbon width (m), curve segments, sideways bend (share of the length), lift off the ground
 *  (m), opacity, and the colour of each order. */
export const ORDER_LINE = {
  width: 0.22,
  segments: 24,
  bend: 0.18,
  lift: 0.12,
  opacity: 0.4,
  colors: { move: "#c9cdd2", attack: "#e2452b" },
} as const;

export type OrderKind = keyof typeof ORDER_LINE.colors;
/** The order byte of the animal frame for each kind. */
const ORDER_BYTE: Record<OrderKind, number> = { move: 1, attack: 2 };

/** `segments + 1` points (x, z) of a quadratic curve from `a` to `b`, its middle pushed to the
 *  left of the way (seen from above, going from a to b) by `bend` times the length. */
export function curve(
  a: readonly [number, number],
  b: readonly [number, number],
  segments: number,
  bend: number,
): [number, number][] {
  const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dz) || 1;
  // The left normal of (dx, dz) in the x-z plane, scaled to the bend.
  const [cx, cz] = [
    (a[0] + b[0]) / 2 + (dz / len) * len * bend,
    (a[1] + b[1]) / 2 - (dx / len) * len * bend,
  ];
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments;
    const [u, v, w] = [(1 - t) * (1 - t), 2 * (1 - t) * t, t * t];
    return [u * a[0] + v * cx + w * b[0], u * a[1] + v * cz + w * b[1]] as [number, number];
  });
}

/** A flat ribbon `width` wide along `points`, lying on `height` plus `lift`: two vertices per
 *  point (left, right), as (x, y, z) triples. */
export function ribbon(
  points: readonly (readonly [number, number])[],
  width: number,
  height: (x: number, z: number) => number,
  lift: number,
  out: Float32Array<ArrayBufferLike> = new Float32Array(points.length * 6),
): Float32Array<ArrayBufferLike> {
  points.forEach(([x, z], i) => {
    const [px, pz] = points[Math.max(0, i - 1)] ?? [x, z];
    const [nx, nz] = points[Math.min(points.length - 1, i + 1)] ?? [x, z];
    const [tx, tz] = [nx - px, nz - pz];
    const t = Math.hypot(tx, tz) || 1;
    const [ox, oz] = [(-tz / t) * (width / 2), (tx / t) * (width / 2)];
    const [lx, lz, rx, rz] = [x + ox, z + oz, x - ox, z - oz];
    out.set([lx, height(lx, lz) + lift, lz, rx, height(rx, rz) + lift, rz], i * 6);
  });
  return out;
}

interface Order {
  ids: Set<number>;
  kind: OrderKind;
  target: THREE.Vector3;
  mesh: THREE.Mesh;
}

export class OrderLines {
  private orders: Order[] = [];
  private readonly materials: Record<OrderKind, THREE.Material>;
  private readonly index: number[] = [];

  constructor(private readonly scene: THREE.Scene) {
    const make = (color: string) =>
      new THREE.MeshBasicNodeMaterial({
        color,
        transparent: true,
        opacity: ORDER_LINE.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    this.materials = { move: make(ORDER_LINE.colors.move), attack: make(ORDER_LINE.colors.attack) };
    for (let i = 0; i < ORDER_LINE.segments; i++) {
      const v = i * 2;
      this.index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }

  /** Animals `ids` were ordered to `target` (world): a new line; they leave their older ones. */
  add(ids: readonly number[], target: THREE.Vector3, kind: OrderKind): void {
    const set = new Set(ids);
    for (const o of this.orders) for (const id of set) o.ids.delete(id);
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array((ORDER_LINE.segments + 1) * 6), 3),
    );
    g.setIndex(this.index);
    const mesh = new THREE.Mesh(g, this.materials[kind]);
    mesh.frustumCulled = false; // rebuilt every frame
    mesh.renderOrder = 9;
    this.scene.add(mesh);
    this.orders.push({ ids: set, kind, target: target.clone(), mesh });
    this.prune();
  }

  /** Every frame: each line from its group's centre (`drawn`, world) to its target; lines whose
   *  animals all left the order (`animals`' order byte) or died go. */
  update(
    drawn: readonly Drawn[],
    animals: readonly Animal[],
    height: (x: number, z: number) => number,
  ): void {
    const orderOf = new Map(animals.map((a) => [a.id, a.order]));
    const at = new Map(drawn.map((d) => [d.id, d]));
    for (const o of this.orders) {
      for (const id of o.ids) {
        if (!orderOf.has(id)) o.ids.delete(id); // gone
        const order = orderOf.get(id);
        if (order !== undefined && order !== ORDER_BYTE[o.kind]) o.ids.delete(id); // replays have none
      }
      let [x, z, k] = [0, 0, 0];
      for (const id of o.ids) {
        const d = at.get(id);
        if (!d) continue;
        [x, z, k] = [x + d.x, z + d.z, k + 1];
      }
      o.mesh.visible = k > 0;
      if (!k) continue;
      const points = curve(
        [x / k, z / k],
        [o.target.x, o.target.z],
        ORDER_LINE.segments,
        ORDER_LINE.bend,
      );
      const pos = o.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
      ribbon(points, ORDER_LINE.width, height, ORDER_LINE.lift, pos.array as Float32Array);
      pos.needsUpdate = true;
    }
    this.prune();
  }

  /** Drop the lines no animal follows any more. */
  private prune(): void {
    this.orders = this.orders.filter((o) => {
      if (o.ids.size) return true;
      this.scene.remove(o.mesh);
      o.mesh.geometry.dispose();
      return false;
    });
  }
}
