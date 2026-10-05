// Plant shapes (D-150): the meshes behind tree crowns and limbs, fern fronds, nettle stems and
// bramble canes. Each is built once and instanced by PlantView, so instances only move, scale
// (w across, h up) and turn about Y: anything that leans or arches is baked in here. Unit size:
// a model scales it by its own length.

import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three/webgpu";
import { rand } from "./layout";

/** A crown lump: a once-subdivided icosahedron (radius 1) with its vertices pushed in and out
 *  (deterministic per variant), so lumps of one tree are not identical balls. */
export function lumpGeometry(variant: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    // By rounded position, so the corners shared by several faces move together.
    const key = Math.round(x * 50) * 7919 + Math.round(y * 50) * 131 + Math.round(z * 50);
    const f = 0.82 + 0.3 * rand(key, 9300 + variant);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

/** A limb: a thin tapering branch one unit long from the origin, leaning out toward +x. */
export function limbGeometry(): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(0.035, 0.07, 1, 5).translate(0, 0.5, 0).rotateZ(-0.75);
}

/** Flat quads, one face each: their meshes draw both sides (`side: "double"`, D-151). */
function quads(corners: [number, number, number][][]): THREE.BufferGeometry {
  const v: number[] = [];
  for (const [a, b, c, d] of corners) {
    if (!a || !b || !c || !d) continue;
    for (const t of [a, b, c, a, c, d]) v.push(...(t as number[]));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

/** Fern frond leaflets (pairs) and how high the frond arches (unit length). */
export const FROND = { steps: 5, rise: 0.45, width: 0.24 } as const;

/** A fern frond: a strip arching out along +x and down, edged with square leaflets that shrink
 *  toward the tip, a blocky, pixel-like outline (the user's "Minecraft fern"). */
export function frondGeometry(): THREE.BufferGeometry {
  const at = (t: number): [number, number] => [t, FROND.rise * Math.sin(Math.PI * t * 0.85)];
  const cells: [number, number, number][][] = [];
  for (let i = 0; i < FROND.steps; i++) {
    const [t0, t1] = [i / FROND.steps, (i + 0.8) / FROND.steps];
    const [x0, y0] = at(t0);
    const [x1, y1] = at(t1);
    const w = FROND.width * (1 - 0.8 * (i / FROND.steps));
    for (const s of [-1, 1]) {
      // A square leaflet beside the rachis, its outer edge stepped by the tooth below.
      cells.push([
        [x0, y0, s * 0.02],
        [x1, y1, s * 0.02],
        [x1, y1, s * w],
        [x0, y0, s * w],
      ]);
    }
  }
  return quads(cells);
}

/** Nettle leaf pairs up a stem: heights (of 1), leaf length and width. */
const NETTLE = { leaves: [0.45, 0.75], length: 0.19, width: 0.08, stem: 0.018 } as const;

/** A nettle stem one unit tall, straight up, with pairs of pointed leaves, each pair turned a
 *  quarter from the one below. */
export function nettleGeometry(): THREE.BufferGeometry {
  const leaves: [number, number, number][][] = [];
  NETTLE.leaves.forEach((y, i) => {
    const turn = (i * Math.PI) / 2;
    for (const s of [-1, 1]) {
      const dir = (r: number, up: number): [number, number, number] => [
        Math.cos(turn) * r * s,
        y + up,
        Math.sin(turn) * r * s,
      ];
      const side = (r: number, up: number, off: number): [number, number, number] => [
        Math.cos(turn) * r * s - Math.sin(turn) * off,
        y + up,
        Math.sin(turn) * r * s + Math.cos(turn) * off,
      ];
      leaves.push([
        dir(0.01, 0),
        side(NETTLE.length * 0.45, 0.05, NETTLE.width / 2),
        dir(NETTLE.length, 0.09),
        side(NETTLE.length * 0.45, 0.05, -NETTLE.width / 2),
      ]);
    }
  });
  const stem = new THREE.CylinderGeometry(NETTLE.stem * 0.6, NETTLE.stem, 1, 3, 1, true)
    .translate(0, 0.5, 0)
    .toNonIndexed();
  stem.deleteAttribute("uv");
  return mergeGeometries([stem, quads(leaves)]);
}

/** Bramble cane: thorns along it, their length (of the cane's 1). */
const CANE = { thorns: 6, thorn: 0.08, radius: 0.024 } as const;

/** A bramble cane one unit long: it rises from the origin and arches back down toward +x, with
 *  small thorns along it. */
export function caneGeometry(): THREE.BufferGeometry {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.45, 0.85, 0),
    new THREE.Vector3(1, 0.1, 0),
  );
  const parts: THREE.BufferGeometry[] = [
    new THREE.TubeGeometry(curve, 7, CANE.radius, 3, false).toNonIndexed(),
  ];
  for (let i = 1; i <= CANE.thorns; i++) {
    const t = i / (CANE.thorns + 1);
    const p = curve.getPoint(t);
    const side = i % 2 ? 1 : -1;
    parts.push(
      new THREE.ConeGeometry(0.012, CANE.thorn, 3)
        .rotateX((side * Math.PI) / 2)
        .rotateZ(0.6)
        .translate(p.x, p.y, side * CANE.thorn * 0.4)
        .toNonIndexed(),
    );
  }
  for (const g of parts) {
    g.deleteAttribute("uv");
    g.deleteAttribute("normal");
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}
