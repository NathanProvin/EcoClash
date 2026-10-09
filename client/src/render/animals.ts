// Animals on the map (D-068, D-116): one instanced mesh per species, its model and palette from
// bodies.ts, scaled to the species' size and turned to face where it goes. Legs swing, bodies bob,
// wings flap and tails wag with the distance walked (the gait shader below). Birds fly above the
// canopy; fish swim under the water surface, and amphibious animals float on it (D-087). A ring on
// the ground, in the owner's colour, marks every animal while the strategic icons show (D-241),
// and the selected ones always (white). Soil life and insects stay faint dots (D-065). AnimalView is the seam where skinned or
// vertex-animated models can replace these bodies later (D-072).

import * as THREE from "three/webgpu";
import {
  abs,
  atan,
  attribute,
  color,
  length,
  mix,
  positionGeometry,
  positionLocal,
  sin,
  step,
  vec3,
} from "three/tsl";
import { isSwarm } from "../game/species";
import type { Animal, ReplayMeta } from "../replay/replay";
import { animalGeometry, formOf, isFine, type AnimalForm } from "./bodies";
import { writeMatrix } from "./growth";
import { CELL } from "./layout";
import { PLAYER, type PlayerId } from "./palette";

export { ANIMAL_FORM, BODIES, bodyGeometry, formOf, type AnimalForm, type Body } from "./bodies";

/** Models are drawn this many times their real size, so a vole still shows next to a 3 m crown;
 *  large animals are scaled up less (`drawnLength`), so a bison does not dwarf the trees. */
export const ANIMAL_SCALE = 3.5; // D-235: was 2.5
const LARGE = 0.75; // D-235: was 0.5; per metre of real length: how much less a large animal is enlarged

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

/** Gait (D-116): legs swing by `leg` x their depth under the hip, one stride every `stride` body
 *  lengths walked; the body bobs by `bob` of its size; wings flap `flap` times per second, tails
 *  wag `wag` (share of the size). `walk` (m/s per metre of drawn size) is a full stride. */
export const GAIT = { leg: 0.55, stride: 0.55, bob: 0.035, flap: 9, wag: 0.12, walk: 0.6 } as const;

/** One step of an animal's gait: its phase advanced by `dist` metres walked (or by time for
 *  fliers and swimmers) and its stride amplitude eased toward its speed (0..1). */
export function stepGait(
  g: { p: number; amp: number },
  dist: number,
  dt: number,
  size: number,
  flies: boolean,
): { p: number; amp: number } {
  if (flies) return { p: g.p + dt * GAIT.flap, amp: 1 };
  const speed = dt > 0 ? dist / dt / Math.max(size, 0.05) : 0;
  const target = Math.min(speed / GAIT.walk, 1);
  const amp = g.amp + (target - g.amp) * Math.min(dt * 6, 1);
  return { p: g.p + (dist / (GAIT.stride * Math.max(size, 0.05))) * Math.PI, amp };
}

/** The shared body material: vertex colours (the species palette) and the gait offsets, in world
 *  space after instancing (per instance `motion`: leg swing, flap, facing x size). */
function gaitMaterial(): THREE.MeshStandardNodeMaterial {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.85, flatShading: true });
  m.vertexColors = true;
  const gait = attribute("gait", "vec4"); // leg sign, hip, wing, wag
  const motion = attribute("motion", "vec4"); // leg swing, flap, forward x size (x, z)
  const fwd = vec3(motion.z, 0, motion.w);
  const side = vec3(motion.w.negate(), 0, motion.z);
  const size = length(fwd);
  const local = positionGeometry;
  const leg = fwd.mul(gait.x.mul(motion.x).mul(gait.y.sub(local.y)).mul(GAIT.leg));
  const wing = vec3(0, gait.z.mul(motion.y).mul(abs(local.z)).mul(size).mul(0.6), 0);
  const wag = side.mul(gait.w.mul(motion.y).mul(GAIT.wag));
  m.positionNode = positionLocal.add(leg).add(wing).add(wag);
  return m;
}

/** Swarm dots (soil life, insects; D-065): radius (m), height (m, in the herbs), opacity, and the
 *  radius factor of a selected dot (D-238). */
const SWARM = { r: 0.06, y: 0.15, opacity: 0.45, selected: 2 } as const;
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

/** Fluid turning (D-111): an animal faces where it goes, turning at most `rate` rad/s, and only
 *  while it moves faster than `min` m/s, so a shuffle on the spot never spins it. */
export const TURN = { rate: 2.5, min: 0.15 } as const;

/** `from` turned toward `to` by at most `max` radians, the short way round. */
export function turnToward(from: number, to: number, max: number): number {
  const d = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + Math.max(-max, Math.min(max, d));
}

/** Where an animal was drawn (world metres), for picking. */
export interface Drawn {
  id: number;
  owner: number;
  x: number;
  y: number;
  z: number;
}

/** The animals of a match: one instanced mesh per species, their rings, the swarm dots. */
export class AnimalView {
  /** Owner rings under unselected animals (D-241): off unless the strategic icons are on. */
  rings = false;
  /** Where each animal was drawn this frame, for click picking (swarms excluded, D-238). */
  drawn: Drawn[] = [];
  private readonly bodies: (THREE.InstancedMesh | undefined)[];
  private readonly motions: (THREE.InstancedBufferAttribute | undefined)[];
  /** Level of detail (D-201): the coarse model of fine species, drawn beyond LOD_NEAR m from the
   *  camera, without a shadow; the fine one (casting) only up close. */
  private readonly far: (THREE.InstancedMesh | undefined)[];
  private readonly farMotions: (THREE.InstancedBufferAttribute | undefined)[];
  /** The frame each heading entry was last touched, to drop the dead (no per-frame Map). */
  private stamp = 0;
  private readonly ringMesh: THREE.InstancedMesh;
  private readonly swarm: THREE.InstancedMesh;
  private readonly canopies: THREE.InstancedMesh;
  private readonly canopyColor = new THREE.Color(FALL.canopy);
  private readonly shadows: THREE.InstancedMesh;
  private readonly dusts: THREE.InstancedMesh;
  private readonly shadowColor = new THREE.Color(FALL.shadow);
  private readonly dustColor = new THREE.Color(FALL.dustColor);
  private readonly forms: AnimalForm[];
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
  /** Last drawn position, heading and gait per animal id. */
  private readonly heading = new Map<
    number,
    { x: number; z: number; a: number; p: number; amp: number; seen: number }
  >();
  /** When the last frame was drawn (ms), for the turn rate. */
  private lastNow = 0;
  private readonly mediumOf: string[];

  constructor(scene: THREE.Scene, meta: ReplayMeta, capacity: number) {
    const fauna = meta.fauna;
    this.swarmOf = meta.species.filter((s) => s.kind === "fauna").map(isSwarm);
    this.predatorOf = fauna.role.map((r) => r === "predator");
    this.forms = fauna.names.map((name, i) => formOf(name, fauna.role[i] ?? "herbivore"));
    this.mediumOf = meta.species.filter((s) => s.kind === "fauna").map((s) => s.medium ?? "walk");
    const material = gaitMaterial();
    const n = Math.max(capacity, 1);
    this.motions = this.forms.map((_, i) =>
      this.swarmOf[i] ? undefined : new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
    );
    this.bodies = this.forms.map((form, i) => {
      const motion = this.motions[i];
      if (!motion) return undefined;
      const g = animalGeometry(form);
      g.setAttribute("motion", motion);
      const mesh = instanced(scene, g, capacity, material);
      mesh.castShadow = true; // D-086; up close only for fine species (D-201)
      return mesh;
    });
    this.farMotions = this.forms.map((form, i) =>
      this.swarmOf[i] || !isFine(form)
        ? undefined
        : new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4),
    );
    this.far = this.forms.map((form, i) => {
      const motion = this.farMotions[i];
      if (!motion) return undefined;
      const g = animalGeometry(form, true);
      g.setAttribute("motion", motion);
      return instanced(scene, g, capacity, material); // no shadow from afar
    });
    const faint = (opacity: number) =>
      new THREE.MeshBasicNodeMaterial({ transparent: true, opacity, depthWrite: false });
    const ring = new THREE.RingGeometry(1 - RING.width, 1, 28).rotateX(-Math.PI / 2);
    this.ringMesh = instanced(scene, ring, capacity, faint(0.85));
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
    const all = [this.ringMesh, this.swarm, this.canopies, this.shadows, this.dusts];
    for (const m of [...this.bodies, ...this.far, ...all]) {
      if (!m) continue;
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
    const counts = this.bodies.map(() => 0);
    const farCounts = this.bodies.map(() => 0);
    let [swarms, rings, canopies, shadows, dusts] = [0, 0, 0, 0, 0];
    const stamp = ++this.stamp;
    const dt = Math.min(Math.max((now - this.lastNow) / 1000, 0), 0.1);
    this.lastNow = now;
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
        const on = selected.has(a.id);
        const r = on ? SWARM.r * SWARM.selected : SWARM.r;
        put(
          this.swarm,
          swarms++,
          x,
          g + SWARM.y + fall,
          z,
          r,
          r,
          0,
          on ? HIGHLIGHT : this.dotColor[owner],
        );
        continue; // selected from the unit list or an icon, not by clicks (D-238)
      }
      const form = this.forms[a.species];
      const body = form?.body ?? "rodent";
      const size = form ? drawnLength(form) : 0.5;
      // Face the way it goes, turning progressively; keep the heading while it barely moves.
      const last = this.heading.get(a.id);
      let angle = last?.a ?? unit(a.id, 3) * Math.PI * 2;
      let walked = 0;
      if (last && dt > 0) {
        const [dx, dz] = [x - last.x, z - last.z];
        walked = Math.hypot(dx, dz);
        if (walked > TURN.min * dt) {
          angle = turnToward(angle, Math.atan2(-dz, dx), TURN.rate * dt);
        }
      }
      const g = stepGait(
        last ?? { p: unit(a.id, 5) * 6, amp: 0 },
        fall > 0 ? 0 : walked,
        dt,
        size,
        body === "bird" || body === "fish",
      );
      if (last) Object.assign(last, { x, z, a: angle, p: g.p, amp: g.amp, seen: stamp });
      else this.heading.set(a.id, { x, z, a: angle, p: g.p, amp: g.amp, seen: stamp });
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
      const swing = Math.sin(g.p) * g.amp;
      const bob = body === "bird" ? FLIGHT_Y + BOB * Math.sin(tick * 0.8 + a.id) : 0;
      const y = ground + bob + Math.abs(swing) * GAIT.bob * size + fall;
      const sway = left > 0 ? FALL.sway * left * Math.sin(age * 5 + a.id) : 0;
      // Up close the fine model, from afar the coarse one (D-201).
      const away =
        camera !== undefined &&
        this.far[a.species] !== undefined &&
        (camera.x - x) ** 2 + (camera.y - y) ** 2 + (camera.z - z) ** 2 > LOD_NEAR ** 2;
      const mesh = away ? this.far[a.species] : this.bodies[a.species];
      const motion = away ? this.farMotions[a.species] : this.motions[a.species];
      const tally = away ? farCounts : counts;
      const i = tally[a.species] ?? 0;
      if (mesh && motion) {
        put(mesh, i, x, y, z, size, size, angle + sway, HIGHLIGHT);
        const turned = angle + sway;
        const m = motion.array as Float32Array;
        m[i * 4] = swing;
        m[i * 4 + 1] = body === "bird" && fall > 0 ? 0 : Math.sin(g.p);
        m[i * 4 + 2] = Math.cos(turned) * size;
        m[i * 4 + 3] = -Math.sin(turned) * size;
        tally[a.species] = i + 1;
      }
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
      const picked = selected.has(a.id);
      if (picked || this.rings) {
        const ringColor = picked
          ? HIGHLIGHT
          : this.ringColor[owner][this.predatorOf[a.species] ? "predator" : "animal"];
        const r = form ? ringRadius(form) : RING.min;
        put(this.ringMesh, rings++, x, ground + 0.06, z, r, r, 0, ringColor);
      }
      this.drawn.push({ id: a.id, owner: a.owner, x, y: y + size * 0.3, z });
    }
    for (const [id, h] of this.heading) if (h.seen !== stamp) this.heading.delete(id);
    for (const [meshes, motions, tally] of [
      [this.bodies, this.motions, counts],
      [this.far, this.farMotions, farCounts],
    ] as const) {
      meshes.forEach((mesh, s) => {
        if (!mesh) return;
        const count = tally[s] ?? 0;
        finish(mesh, count);
        const motion = motions[s];
        if (motion) {
          motion.clearUpdateRanges();
          motion.addUpdateRange(0, Math.max(1, count) * 4);
          motion.needsUpdate = true;
        }
      });
    }
    finish(this.ringMesh, rings);
    finish(this.swarm, swarms);
    finish(this.canopies, canopies);
    finish(this.shadows, shadows);
    finish(this.dusts, dusts);
  }
}

/** Within this many metres of the camera, fine species draw their fine model (D-201). */
const LOD_NEAR = 45;

function instanced(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  count: number,
  material: THREE.Material,
): THREE.InstancedMesh {
  const n = Math.max(count, 1);
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  // Static usage (D-149): uploaded when marked, once a frame, not on every render pass.
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.userData.family = "animals"; // the perf census (D-198)
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
  const c = mesh.instanceColor?.array as Float32Array | undefined;
  if (c) [c[i * 3], c[i * 3 + 1], c[i * 3 + 2]] = [color.r, color.g, color.b];
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
