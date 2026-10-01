// Animal models (D-068): one low-poly shape per body type, merged from a few primitives, one unit
// long along +x (head forward) and standing on y = 0; instances scale them to each species' size
// and turn them to face where they go. Birds fly above the canopy; fish swim under the water
// surface, and amphibious animals float on it (D-087). A ring on the ground, in the
// owner's colour, marks every controllable animal (white when selected). Soil life and insects
// stay faint dots (D-065). AnimalView draws them from each frame's animals: the seam where skinned
// or vertex-animated models can replace these bodies later (D-072).

import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three/webgpu";
import { atan, color, mix, positionGeometry, sin, step } from "three/tsl";
import { isSwarm } from "../game/species";
import type { Animal, ReplayMeta, Role } from "../replay/replay";
import { writeMatrix } from "./growth";
import { CELL } from "./layout";
import { PLAYER, type PlayerId } from "./palette";

export const BODIES = [
  "rodent",
  "hedgehog",
  "rabbit",
  "canid",
  "cat",
  "bird",
  "ungulate",
  "bear",
  "mustelid",
  "fish",
  "duck",
  "frog",
  "wader",
] as const;
export type Body = (typeof BODIES)[number];

/** Body type, real length (m, nose to tail base) and natural colour of a species. */
export interface AnimalForm {
  body: Body;
  length: number;
  color: string;
}

export const ANIMAL_FORM: Record<string, AnimalForm> = {
  black_woodpecker: { body: "bird", length: 0.45, color: "#1c1b1f" },
  rabbits: { body: "rabbit", length: 0.4, color: "#8d7c68" },
  bison: { body: "ungulate", length: 2.8, color: "#4a3727" },
  bank_vole: { body: "rodent", length: 0.1, color: "#7a5b3e" },
  roe_deer: { body: "ungulate", length: 1.1, color: "#9a6a3e" },
  red_squirrel: { body: "rodent", length: 0.22, color: "#b0552a" },
  red_deer: { body: "ungulate", length: 1.9, color: "#7d5534" },
  beaver: { body: "rodent", length: 0.8, color: "#5b4030" },
  wild_boar: { body: "ungulate", length: 1.3, color: "#4b4038" },
  roach: { body: "fish", length: 0.25, color: "#9aa3a8" },
  mallard: { body: "duck", length: 0.55, color: "#6b7a4a" },
  great_tit: { body: "bird", length: 0.14, color: "#d6c14a" },
  frog: { body: "frog", length: 0.08, color: "#6f8f3c" },
  badger: { body: "mustelid", length: 0.75, color: "#6d6a66" },
  kestrel: { body: "bird", length: 0.33, color: "#a0633a" },
  pine_marten: { body: "mustelid", length: 0.5, color: "#5e3b22" },
  fox: { body: "canid", length: 0.7, color: "#c2612b" },
  lynx: { body: "cat", length: 1.0, color: "#b48b5c" },
  wolf: { body: "canid", length: 1.2, color: "#7d7a73" },
  brown_bear: { body: "bear", length: 2.0, color: "#5a3d25" },
  pike: { body: "fish", length: 0.8, color: "#5e6b3e" },
  heron: { body: "wader", length: 0.9, color: "#9aa0a6" },
  otter: { body: "mustelid", length: 0.7, color: "#4d3a2c" },
};

export function formOf(name: string, role: Role): AnimalForm {
  return (
    ANIMAL_FORM[name] ??
    (role === "predator"
      ? { body: "canid", length: 0.6, color: "#8a6a4a" }
      : { body: "rodent", length: 0.2, color: "#7a5b3e" })
  );
}

/** Models are drawn this many times their real size, so a vole still shows next to a 3 m crown;
 *  large animals are scaled up less (`drawnLength`), so a bison does not dwarf the trees. */
export const ANIMAL_SCALE = 2.5;
const LARGE = 0.5; // per metre of real length: how much less a large animal is enlarged

/** Drawn length (m) of a species: its real length enlarged, less so the larger it is (D-087). */
export function drawnLength(form: AnimalForm): number {
  return (form.length * ANIMAL_SCALE) / (1 + LARGE * form.length);
}
/** Birds fly this high (m): above the canopy (trunks up to 2.6 m, then the crown). */
export const FLIGHT_Y = 7.5;
/** Ground ring radius (m): max(min, k x drawn length); width as a share of the radius. */
export const RING = { min: 0.45, k: 0.75, width: 0.18 } as const;

export function ringRadius(form: AnimalForm): number {
  return Math.max(RING.min, RING.k * drawnLength(form));
}

/** The model of a body type: unit length along +x, feet (or, for birds, the body centre) at 0. */
export function bodyGeometry(body: Body): THREE.BufferGeometry {
  const blob = (sx: number, sy: number, sz: number, x: number, y: number, z = 0) =>
    new THREE.IcosahedronGeometry(0.5, 1).scale(sx, sy, sz).translate(x, y, z);
  const ear = (x: number, y: number, z: number, r: number, h: number) =>
    new THREE.ConeGeometry(r, h, 4).translate(x, y, z);
  const legs = (h: number, dx: number, dz: number) =>
    [-dx, dx].flatMap((x) =>
      [-dz, dz].map((z) => new THREE.BoxGeometry(0.06, h, 0.06).translate(x, h / 2, z)),
    );
  const parts: THREE.BufferGeometry[] = (() => {
    switch (body) {
      case "rodent": // round body, small head, tucked feet
        return [blob(0.8, 0.45, 0.5, -0.05, 0.22), blob(0.36, 0.32, 0.32, 0.38, 0.22)];
      case "hedgehog": // a spiny dome and a pointed snout
        return [
          blob(0.9, 0.55, 0.75, -0.05, 0.27),
          new THREE.ConeGeometry(0.1, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.5, 0.14, 0),
        ];
      case "rabbit": // haunches, head, two long ears
        return [
          blob(0.8, 0.55, 0.5, -0.08, 0.28),
          blob(0.34, 0.32, 0.3, 0.34, 0.48),
          ear(0.32, 0.8, 0.06, 0.045, 0.34),
          ear(0.32, 0.8, -0.06, 0.045, 0.34),
        ];
      case "canid": // long body on legs, pointed ears, a long brush of a tail
        return [
          blob(0.7, 0.3, 0.26, 0, 0.5),
          blob(0.3, 0.22, 0.22, 0.42, 0.62),
          new THREE.ConeGeometry(0.07, 0.2, 4).rotateZ(-Math.PI / 2).translate(0.62, 0.58, 0),
          ear(0.42, 0.78, 0.06, 0.04, 0.12),
          ear(0.42, 0.78, -0.06, 0.04, 0.12),
          blob(0.4, 0.14, 0.14, -0.5, 0.45),
          ...legs(0.38, 0.24, 0.08),
        ];
      case "cat": // heavier body, round head, tufted ears, short tail
        return [
          blob(0.72, 0.34, 0.3, 0, 0.52),
          blob(0.3, 0.26, 0.26, 0.42, 0.66),
          ear(0.4, 0.84, 0.07, 0.04, 0.14),
          ear(0.4, 0.84, -0.07, 0.04, 0.14),
          blob(0.2, 0.1, 0.1, -0.44, 0.55),
          ...legs(0.4, 0.24, 0.1),
        ];
      case "bird": // body, head, spread wings, tail
        return [
          blob(0.75, 0.32, 0.32, 0, 0),
          blob(0.3, 0.28, 0.28, 0.38, 0.06),
          new THREE.BoxGeometry(0.34, 0.03, 1.7).translate(-0.02, 0.04, 0),
          new THREE.BoxGeometry(0.3, 0.02, 0.2).translate(-0.45, 0, 0),
        ];
      case "ungulate": // deep body on long legs, raised neck and head, small ears
        return [
          blob(0.72, 0.34, 0.28, -0.02, 0.62),
          blob(0.16, 0.32, 0.14, 0.32, 0.8).rotateZ(-0.5),
          blob(0.24, 0.14, 0.13, 0.44, 0.94),
          ear(0.38, 1.04, 0.05, 0.03, 0.08),
          ear(0.38, 1.04, -0.05, 0.03, 0.08),
          ...legs(0.5, 0.26, 0.08),
        ];
      case "bear": // massive round body, short legs, round head, small ears
        return [
          blob(0.8, 0.5, 0.48, -0.04, 0.46),
          blob(0.32, 0.3, 0.3, 0.42, 0.6),
          blob(0.1, 0.08, 0.08, 0.4, 0.78, 0.09),
          blob(0.1, 0.08, 0.08, 0.4, 0.78, -0.09),
          ...legs(0.24, 0.25, 0.14),
        ];
      case "mustelid": // long low body, short legs, small head, long tail
        return [
          blob(0.68, 0.22, 0.2, 0.05, 0.2),
          blob(0.22, 0.16, 0.16, 0.45, 0.24),
          blob(0.35, 0.08, 0.08, -0.45, 0.18),
          ...legs(0.1, 0.22, 0.07),
        ];
      case "fish": // a streamlined body and a tail fin
        return [
          blob(0.8, 0.26, 0.16, 0.05, 0.13),
          new THREE.ConeGeometry(0.14, 0.24, 3).rotateZ(Math.PI / 2).translate(-0.42, 0.13, 0),
        ];
      case "duck": // a boat-shaped body afloat, head on a short neck, a flat bill
        return [
          blob(0.8, 0.34, 0.46, -0.05, 0.17),
          blob(0.26, 0.26, 0.24, 0.34, 0.43),
          new THREE.BoxGeometry(0.16, 0.04, 0.1).translate(0.52, 0.41, 0),
        ];
      case "frog": // a squat body and folded hind legs
        return [
          blob(0.7, 0.4, 0.6, 0.05, 0.2),
          blob(0.35, 0.22, 0.3, -0.25, 0.1, 0.25),
          blob(0.35, 0.22, 0.3, -0.25, 0.1, -0.25),
        ];
      case "wader": // a slim body high on long legs, a long neck and bill
        return [
          blob(0.55, 0.26, 0.24, -0.05, 0.95),
          blob(0.1, 0.4, 0.1, 0.22, 1.2).rotateZ(-0.3),
          blob(0.18, 0.12, 0.12, 0.32, 1.42),
          new THREE.ConeGeometry(0.03, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.54, 1.4, 0),
          ...[-0.05, 0.05].map((z) => new THREE.BoxGeometry(0.03, 0.8, 0.03).translate(0, 0.4, z)),
        ];
    }
  })();
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

/** Swarm dots (soil life, insects; D-065): radius (m), height (m, in the herbs) and opacity. */
const SWARM = { r: 0.06, y: 0.15, opacity: 0.45 } as const;
/** Birds bob this much (m) around their flight height. */
const BOB = 0.3;
/** Fish swim this far (m) under the water surface. */
const SWIM_DEPTH = 0.15;
/** Each animal keeps a fixed offset inside its cell (share of a cell), so animals on the same
 *  point (replays hold whole cells) do not stack. */
const SPREAD = 0.3;
const HIGHLIGHT = new THREE.Color("#ffffff");
/** Parachute drops (D-080, D-089): a dropped animal falls from `height` metres over `s` seconds
 *  under a striped canopy, swaying by up to `sway` radians; the animals of one card leave up to
 *  `stagger` seconds apart. The canopy is at least `screen` x the camera distance across, so a
 *  vole's drop reads from afar. A shadow spot on the ground shrinks onto the landing point, and a
 *  dust ring spreads for `dust` seconds on landing. */
const FALL = {
  height: 40,
  s: 2.5,
  sway: 0.35,
  stagger: 0.5,
  screen: 0.03,
  dust: 0.7,
  canopy: "#ffffff",
  stripe: "#c8423a",
  gores: 8,
  shadow: "#1d1a14",
  dustColor: "#cdbb98",
} as const;

/** Where an animal was drawn (world metres), for picking. */
export interface Drawn {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
}

/** The animals of a match: one instanced mesh per body type, their rings, the swarm dots. */
export class AnimalView {
  /** Where each animal was drawn this frame (swarms excluded: not selectable). */
  drawn: Drawn[] = [];
  private readonly bodies: Record<Body, THREE.InstancedMesh>;
  private readonly rings: THREE.InstancedMesh;
  private readonly swarm: THREE.InstancedMesh;
  private readonly canopies: THREE.InstancedMesh;
  private readonly canopyColor = new THREE.Color(FALL.canopy);
  private readonly shadows: THREE.InstancedMesh;
  private readonly dusts: THREE.InstancedMesh;
  private readonly shadowColor = new THREE.Color(FALL.shadow);
  private readonly dustColor = new THREE.Color(FALL.dustColor);
  private readonly forms: AnimalForm[];
  private readonly colors: THREE.Color[];
  private readonly swarmOf: boolean[];
  private readonly predatorOf: boolean[];
  private readonly ringColor: Record<PlayerId, { animal: THREE.Color; predator: THREE.Color }> = {
    1: { animal: new THREE.Color(PLAYER[1].base), predator: new THREE.Color(PLAYER[1].predator) },
    2: { animal: new THREE.Color(PLAYER[2].base), predator: new THREE.Color(PLAYER[2].predator) },
  };
  private readonly dotColor: Record<PlayerId, THREE.Color> = {
    1: new THREE.Color(PLAYER[1].animal),
    2: new THREE.Color(PLAYER[2].animal),
  };
  /** Last drawn position and heading per animal id, to face the way it goes. */
  private heading = new Map<number, { x: number; z: number; a: number }>();
  private readonly mediumOf: string[];

  constructor(scene: THREE.Scene, meta: ReplayMeta, capacity: number) {
    const fauna = meta.fauna;
    this.swarmOf = meta.species.filter((s) => s.kind === "fauna").map(isSwarm);
    this.predatorOf = fauna.role.map((r) => r === "predator");
    this.forms = fauna.names.map((name, i) => formOf(name, fauna.role[i] ?? "herbivore"));
    this.mediumOf = meta.species.filter((s) => s.kind === "fauna").map((s) => s.medium ?? "walk");
    this.colors = this.forms.map((f) => new THREE.Color(f.color));
    const lit = (g: THREE.BufferGeometry) =>
      instanced(
        scene,
        g,
        capacity,
        new THREE.MeshStandardNodeMaterial({ roughness: 0.9, flatShading: true }),
      );
    const bodies = {} as Record<Body, THREE.InstancedMesh>;
    for (const b of BODIES) {
      bodies[b] = lit(bodyGeometry(b));
      bodies[b].castShadow = true; // D-086
    }
    this.bodies = bodies;
    const faint = (opacity: number) =>
      new THREE.MeshBasicNodeMaterial({ transparent: true, opacity, depthWrite: false });
    const ring = new THREE.RingGeometry(1 - RING.width, 1, 28).rotateX(-Math.PI / 2);
    this.rings = instanced(scene, ring, capacity, faint(0.85));
    this.swarm = instanced(
      scene,
      new THREE.SphereGeometry(1, 6, 4),
      capacity,
      faint(SWARM.opacity),
    );
    const dome = new THREE.SphereGeometry(1, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    this.canopies = instanced(
      scene,
      dome,
      capacity,
      new THREE.MeshStandardNodeMaterial({
        roughness: 0.8,
        flatShading: true,
        side: THREE.DoubleSide,
        // White and red gores, by the angle around the dome's axis (D-110).
        colorNode: mix(
          color(FALL.canopy),
          color(FALL.stripe),
          step(0, sin(atan(positionGeometry.z, positionGeometry.x).mul(FALL.gores / 2))),
        ),
      }),
    );
    const disc = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
    this.shadows = instanced(scene, disc, capacity, faint(0.35));
    this.dusts = instanced(scene, ring, capacity, faint(0.55));
  }

  setVisible(on: boolean): void {
    const all = [this.rings, this.swarm, this.canopies, this.shadows, this.dusts];
    for (const m of [...Object.values(this.bodies), ...all]) {
      m.visible = on;
    }
  }

  /** Draw `animals` (interpolated, cell units) on an `n x n` map at fractional `tick`; at `now`
   *  (ms), animals `droppedAt` a moment ago are still falling under their canopy. */
  update(
    animals: readonly Animal[],
    selected: Set<number>,
    tick: number,
    n: number,
    now = 0,
    droppedAt?: (id: number) => number | undefined,
    height: (x: number, z: number) => number = () => 0,
    water: number | null = null,
    camera?: THREE.Vector3,
  ): void {
    const counts = Object.fromEntries(BODIES.map((b) => [b, 0])) as Record<Body, number>;
    let [swarms, rings, canopies, shadows, dusts] = [0, 0, 0, 0, 0];
    const heading = new Map<number, { x: number; z: number; a: number }>();
    this.drawn = [];
    for (const a of animals) {
      const owner: PlayerId = a.owner === 2 ? 2 : 1;
      // Its position from the cell corner, plus its own fixed offset.
      const x = (a.x - n / 2 + 0.5 + SPREAD * unit(a.id, 1)) * CELL;
      const z = (a.y - n / 2 + 0.5 + SPREAD * unit(a.id, 2)) * CELL;
      // Still falling from a drop: height left (m), easing out as it lands; the animals of a card
      // leave one after another.
      const since = droppedAt?.(a.id);
      const age =
        since === undefined
          ? Infinity
          : (now - since) / 1000 - FALL.stagger * (unit(a.id, 4) + 0.5);
      const left = (1 - Math.min(Math.max(age / FALL.s, 0), 1)) ** 2;
      const fall = FALL.height * left;
      if (this.swarmOf[a.species]) {
        const g = height(x, z);
        put(
          this.swarm,
          swarms++,
          x,
          g + SWARM.y + fall,
          z,
          SWARM.r,
          SWARM.r,
          0,
          this.dotColor[owner],
        );
        continue; // not selectable (D-065)
      }
      // Face the way it goes; keep the last heading while it stands still.
      const last = this.heading.get(a.id);
      const [dx, dz] = last ? [x - last.x, z - last.z] : [0, 0];
      const turn = Math.hypot(dx, dz) > 1e-3 ? Math.atan2(-dz, dx) : undefined;
      const angle = turn ?? last?.a ?? unit(a.id, 3) * Math.PI * 2;
      heading.set(a.id, { x, z, a: angle });
      const form = this.forms[a.species];
      const body = form?.body ?? "rodent";
      const size = form ? drawnLength(form) : 0.5;
      // Where it stands: fish just under the water surface, floaters on it (D-087).
      const bed = height(x, z);
      const medium = this.mediumOf[a.species];
      const surface = water ?? bed;
      const ground =
        medium === "swim"
          ? Math.max(bed, surface - SWIM_DEPTH)
          : medium === "amphibious" && body !== "wader"
            ? Math.max(bed, surface)
            : bed;
      const y =
        ground + (body === "bird" ? FLIGHT_Y + BOB * Math.sin(tick * 0.8 + a.id) : 0) + fall;
      const color = this.colors[a.species] ?? HIGHLIGHT;
      const sway = left > 0 ? FALL.sway * left * Math.sin(age * 5 + a.id) : 0;
      put(this.bodies[body], counts[body]++, x, y, z, size, size, angle + sway, color);
      // The canopy, readable at any zoom; the shadow spot under it; the dust ring on landing.
      if (left > 0) {
        const far = camera ? Math.hypot(camera.x - x, camera.y - y, camera.z - z) : 0;
        const cr = Math.max(0.5, size * 0.7, (FALL.screen * far) / 2);
        const cy = y + size * 0.8 + cr * 0.6;
        put(this.canopies, canopies++, x, cy, z, cr, cr * 0.5, angle + sway, this.canopyColor);
        const spot = cr * (0.5 + 0.9 * left);
        put(this.shadows, shadows++, x, ground + 0.05, z, spot, spot, 0, this.shadowColor);
      } else if (age >= FALL.s && age < FALL.s + FALL.dust) {
        const t = (age - FALL.s) / FALL.dust;
        const d = Math.max(0.6, size) * (1 + 1.5 * t);
        put(this.dusts, dusts++, x, ground + 0.08, z, d, d, 0, this.dustColor);
      }
      const ringColor = selected.has(a.id)
        ? HIGHLIGHT
        : this.ringColor[owner][this.predatorOf[a.species] ? "predator" : "animal"];
      const r = form ? ringRadius(form) : RING.min;
      put(this.rings, rings++, x, ground + 0.06, z, r, r, 0, ringColor);
      this.drawn.push({ id: a.id, owner: a.owner, x, y: y + size * 0.3, z });
    }
    this.heading = heading;
    for (const b of BODIES) finish(this.bodies[b], counts[b]);
    finish(this.rings, rings);
    finish(this.swarm, swarms);
    finish(this.canopies, canopies);
    finish(this.shadows, shadows);
    finish(this.dusts, dusts);
  }
}

function instanced(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  count: number,
  material: THREE.Material,
): THREE.InstancedMesh {
  const n = Math.max(count, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

/** Write instance `i`: position, scale (`w` across, `h` up), rotation about Y, colour. */
function put(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  angle: number,
  color: THREE.Color,
): void {
  const m = mesh.instanceMatrix.array as Float32Array;
  writeMatrix(m.subarray(i * 16, i * 16 + 16), { x, y, z, w, h, angle });
  (mesh.instanceColor?.array as Float32Array | undefined)?.set([color.r, color.g, color.b], i * 3);
}

/** A fixed pseudo-random value in [-0.5, 0.5) for animal `id` (multiplicative hash; `salt`
 *  picks the axis). */
function unit(id: number, salt: number): number {
  return (Math.imul(id + salt * 0x9e3779b9, 0x9e3779b1) >>> 0) / 2 ** 32 - 0.5;
}

/** Upload only the instances in use: the buffers are sized for the most animals. */
function finish(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  for (const [attr, size] of [
    [mesh.instanceMatrix, 16],
    [mesh.instanceColor, 3],
  ] as const) {
    if (!attr) continue;
    attr.clearUpdateRanges();
    attr.addUpdateRange(0, Math.max(1, count) * size);
    attr.needsUpdate = true;
  }
}
