// Den models (D-245, D-251, D-253): the centrepiece of each side. A land den is a lumpy earth
// burrow with a deep entrance, roots creeping out of it, pebbles and a few flowers on top; a water
// den is a beaver lodge of criss-crossed sticks with reeds and lily pads. Both are ringed in the
// owner's colour. Low-poly and flat-shaded like the rest of the diorama, the same for every den
// (fixed shapes, no RNG).

import * as THREE from "three/webgpu";
import { CELL } from "./layout";

/** Sizes (m) and colours. The land mound is 30 % bigger than the first version (play test). */
const DEN = {
  rx: 0.6 * CELL,
  rz: 0.48 * CELL,
  height: 0.32 * CELL,
  lumps: 0.13,
  hole: 0.15 * CELL,
  lodge: 0.42 * CELL,
  lodgeHeight: 0.3 * CELL,
  earth: "#7a5a3a",
  earthDark: "#5e4329",
  rim: "#9a7650",
  hole_color: "#120b06",
  root: "#5a3d24",
  pebble: "#8d8a82",
  mud: "#4a3a2a",
  sticks: ["#6b5236", "#5a4430", "#7b6040", "#4f3b28"],
  leaf: "#4f8f3f",
  stem: "#3f6e33",
  petals: ["#f4f1ea", "#d58fc5", "#f2c94c"],
  heart: "#f2b632",
  reed: "#6d8f3e",
  pad: "#3f7d3a",
} as const;

const flat = (color: string) =>
  new THREE.MeshStandardNodeMaterial({ color, roughness: 0.95, flatShading: true });

/** A fixed pseudo-random value in [0, 1) for an index (shapes only, never the sim). */
const hash = (i: number) => {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** A half-ellipsoid of radii (rx, h, rz), lumpy: every vertex pushed out or in by a hash of its
 *  direction, the same for the copies of one vertex, so the faces stay closed. */
function lumpyDome(rx: number, h: number, rz: number, lumps: number, detail: number) {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = Math.round(v.x * 97) * 7919 + Math.round(v.y * 97) * 104729 + Math.round(v.z * 97);
    const k = 1 + lumps * (hash(key) * 2 - 1);
    const y = Math.max(v.y, 0) * h * k;
    pos.setXYZ(i, v.x * rx * k, y, v.z * rz * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** The dome's height at (x, z), for placing things on it. */
const domeY = (x: number, z: number, rx: number, h: number, rz: number) =>
  h * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2 - (z / rz) ** 2));

/** A flower: a stem, two leaves, five petals round a heart. */
function flower(petal: string, height: number): THREE.Group {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, height, 5), flat(DEN.stem));
  stem.position.y = height / 2;
  g.add(stem);
  for (const side of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.28, 4), flat(DEN.leaf));
    leaf.position.set(side * 0.08, height * 0.35, 0);
    leaf.rotation.z = -side * 1.0;
    g.add(leaf);
  }
  const head = new THREE.Group();
  head.position.y = height;
  const heart = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 0), flat(DEN.heart));
  head.add(heart);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), flat(petal));
    p.scale.set(1, 0.35, 0.6);
    p.position.set(Math.cos(a) * 0.09, 0, Math.sin(a) * 0.09);
    p.rotation.y = -a;
    head.add(p);
  }
  g.add(head);
  return g;
}

/** The land burrow. */
function burrow(): THREE.Group {
  const g = new THREE.Group();
  const { rx, rz, height: h } = DEN;
  g.add(new THREE.Mesh(lumpyDome(rx, h, rz, DEN.lumps, 3), flat(DEN.earth)));
  // A darker skirt of loose earth at its foot.
  const skirt = new THREE.Mesh(
    lumpyDome(rx * 1.18, h * 0.22, rz * 1.18, 0.2, 2),
    flat(DEN.earthDark),
  );
  g.add(skirt);

  // The entrance, on the front (+z): a lighter rim of dug earth round a deep, dark tunnel.
  const mouth = new THREE.Group();
  const y0 = h * 0.38;
  const z0 = rz * Math.sqrt(Math.max(0, 1 - (y0 / h) ** 2)) * (1 + DEN.lumps);
  mouth.position.set(0, y0, z0);
  mouth.rotation.x = -0.35;
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(DEN.hole, DEN.hole * 0.32, 6, 14),
    flat(DEN.rim),
  );
  rim.scale.set(1.15, 0.9, 1);
  mouth.add(rim);
  // The opening: a dark, deep-looking disc on the mound's face (the tunnel itself would hide
  // inside the solid mound), and a darker core for depth.
  const dark = (c: string) =>
    new THREE.MeshBasicNodeMaterial({ color: c, polygonOffset: true, polygonOffsetFactor: -2 });
  const opening = new THREE.Mesh(new THREE.CircleGeometry(DEN.hole * 1.02, 16), dark("#2a1a0e"));
  opening.scale.set(1.15, 0.9, 1);
  opening.position.z = 0.04;
  mouth.add(opening);
  const core = new THREE.Mesh(new THREE.CircleGeometry(DEN.hole * 0.7, 16), dark(DEN.hole_color));
  core.scale.set(1.15, 0.9, 1);
  core.position.set(0, -DEN.hole * 0.08, 0.06);
  mouth.add(core);
  g.add(mouth);
  // Dug earth spilling out of the entrance.
  const spill = new THREE.Mesh(
    lumpyDome(DEN.hole * 1.6, 0.12, DEN.hole * 2, 0.25, 1),
    flat(DEN.rim),
  );
  spill.position.set(0, 0, rz * 1.05);
  g.add(spill);

  // Roots creeping out of the mound into the ground.
  const roots: [number, number][] = [
    [0.9, 1],
    [2.3, 0.85],
    [3.6, 1.1],
    [5.0, 0.95],
  ];
  roots.forEach(([a, len], i) => {
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const pts = [0.7, 1.0, 1.25, 1.45].map((t, j) => {
      const r = t * len;
      const x = out.x * rx * r;
      const z = out.z * rz * r;
      const lift = j === 0 ? domeY(x, z, rx, h, rz) * 0.6 : j === 1 ? 0.12 : j === 2 ? 0.05 : -0.05;
      return new THREE.Vector3(x + Math.sin(i + j) * 0.15, lift, z + Math.cos(i * 2 + j) * 0.15);
    });
    const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.07 - i * 0.008, 5);
    g.add(new THREE.Mesh(tube, flat(DEN.root)));
  });

  // Pebbles round the foot.
  for (let i = 0; i < 6; i++) {
    const a = 0.4 + i * 1.05 + hash(i) * 0.4;
    const r = 1.08 + hash(i + 10) * 0.2;
    const s = 0.12 + hash(i + 20) * 0.14;
    const p = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), flat(DEN.pebble));
    p.position.set(Math.cos(a) * rx * r, s * 0.4, Math.sin(a) * rz * r);
    p.scale.y = 0.6;
    g.add(p);
  }

  // A few flowers on top: green on the heart of the colony.
  const flowers: [number, number, number][] = [
    [-0.35, -0.2, 0],
    [0.3, -0.35, 1],
    [0.05, 0.05, 2],
  ];
  for (const [fx, fz, c] of flowers) {
    const x = fx * rx;
    const z = fz * rz;
    const f = flower(DEN.petals[c] ?? DEN.petals[0], 0.45 + c * 0.08);
    f.position.set(x, domeY(x, z, rx, h, rz) - 0.05, z);
    g.add(f);
  }
  return g;
}

/** The beaver lodge (water den): a mud core under criss-crossed sticks, a dark arch at the
 *  waterline, reeds and lily pads round it. */
function lodge(): THREE.Group {
  const g = new THREE.Group();
  const r = DEN.lodge;
  const h = DEN.lodgeHeight;
  g.add(new THREE.Mesh(lumpyDome(r, h, r * 0.9, 0.1, 2), flat(DEN.mud)));
  const stick = new THREE.CylinderGeometry(0.035, 0.045, 1, 5);
  for (let i = 0; i < 44; i++) {
    const a = hash(i) * Math.PI * 2;
    const t = 0.15 + hash(i + 50) * 0.8; // how far up the dome
    const x = Math.cos(a) * r * Math.sqrt(1 - t * t) * 1.02;
    const z = Math.sin(a) * r * 0.9 * Math.sqrt(1 - t * t) * 1.02;
    const s = new THREE.Mesh(stick, flat(DEN.sticks[i % DEN.sticks.length] ?? DEN.mud));
    s.scale.y = 0.9 + hash(i + 100) * 0.9;
    s.position.set(x, h * t, z);
    // Laid along the dome, at a slant, criss-crossing its neighbours.
    s.rotation.set(Math.PI / 2 - t * 0.9, -a + Math.PI / 2, (hash(i + 150) - 0.5) * 1.6);
    g.add(s);
  }
  const arch = new THREE.Mesh(
    new THREE.CircleGeometry(r * 0.3, 12, 0, Math.PI),
    new THREE.MeshBasicNodeMaterial({ color: DEN.hole_color, side: THREE.DoubleSide }),
  );
  arch.position.set(0, 0.02, r * 0.88);
  arch.rotation.x = -0.25;
  g.add(arch);
  for (let i = 0; i < 7; i++) {
    const a = 0.3 + i * 0.85;
    const reed = new THREE.Mesh(
      new THREE.ConeGeometry(0.04, 1.1 + hash(i) * 0.6, 4),
      flat(DEN.reed),
    );
    reed.position.set(Math.cos(a) * r * 1.25, 0.6, Math.sin(a) * r * 1.2);
    reed.rotation.z = (hash(i + 7) - 0.5) * 0.3;
    g.add(reed);
  }
  for (let i = 0; i < 3; i++) {
    const a = 1.2 + i * 1.9;
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(0.28 + i * 0.05, 10, 0.3, Math.PI * 1.85),
      flat(DEN.pad),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(Math.cos(a) * r * 1.45, 0.03, Math.sin(a) * r * 1.45);
    g.add(pad);
  }
  return g;
}

/** One den model, its base at the origin; `tint` is the owner's colour (a ring at its foot). */
export function denModel(water: boolean, tint: string): THREE.Group {
  const g = water ? lodge() : burrow();
  const r = water ? DEN.lodge * 1.6 : DEN.rx * 1.3;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r, r * 1.1, 32),
    new THREE.MeshBasicNodeMaterial({ color: tint, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh && o !== ring) o.castShadow = true;
  });
  return g;
}

/** Where the land burrow's entrance opens, relative to the den's base (m): animals come out there. */
export const DEN_MOUTH = { y: DEN.height * 0.38, z: DEN.rz } as const;
