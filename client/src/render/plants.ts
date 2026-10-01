// Plant models (D-067, D-072, D-087): undergrowth clumps, shrubs, trees and lily pads. PlantView
// turns each field frame into plant models: the cell's fixed slots and sticky species
// (layout.ts), then the parts of each model from a PlantStyle, shown through GrowingMesh so they
// grow, resize and wither smoothly. The style is the seam for art: today's LowPolyPlants builds
// clumps, reeds, trunks and blob crowns from primitives; a glTF style can bring per-species
// meshes (and wind, in the growth position node) with no change here.

import {
  cameraPosition,
  color,
  dot,
  normalView,
  positionViewDirection,
  positionWorld,
  pow,
  saturate,
  smoothstep,
  uniform,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { GrowingMesh, type Pose } from "./growth";
import {
  CELL,
  cellSlots,
  formOf,
  MAX_MODELS,
  plantLayout,
  rand,
  STRATA,
  TREE,
  type Placement,
  type Slot,
  type Stratum,
} from "./layout";
import { WORLD } from "./palette";

/** One instanced part of a model: which of the style's meshes, where, how big, which colour. */
export interface Part {
  mesh: number;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  angle: number;
  /** The species colour times `shade`, or `color` itself when given (e.g. bark). */
  shade: number;
  color?: THREE.Color;
}

/** How plant models look: the meshes it draws with, and the parts of one model. */
export interface PlantStyle {
  /** Geometry, roughness and the most instances one model uses, per model stratum (STRATA). */
  meshes: { geometry: THREE.BufferGeometry; roughness: number; perModel: number[] }[];
  /** The parts of model `m` (world centre x, z) of model stratum `stratum` for species `name`. */
  parts(stratum: Stratum, m: Placement, x: number, z: number, name: string): Part[];
}

/** Reed beds: stems per clump, their height per metre of clump radius, stem radius (m). */
const REED = { stems: 5, height: 4.5, radius: 0.05 } as const;

/** Cattails (D-125): stems per stand, their height per metre of stand radius, stem radius, and
 *  the brown seed head (height and radius, m) near the top. */
const CATTAIL = { stems: 7, height: 3.2, radius: 0.035, head: 0.32, headR: 0.07 } as const;
const CATTAIL_HEAD = "#6b4a2e";

/** Blob sizes beyond the first one, relative to the main blob, and their spread. */
const BLOB = { size: 0.62, spread: 0.5 } as const;

/** The placeholder look: bushes as blob clusters, trees as a trunk and blob crowns. */
export class LowPolyPlants implements PlantStyle {
  private readonly bark = new THREE.Color(WORLD.trunk);
  readonly meshes = [
    { geometry: new THREE.IcosahedronGeometry(1, 1), roughness: 0.85, perModel: [0, 3, 0, 0] },
    { geometry: new THREE.IcosahedronGeometry(1, 1), roughness: 0.8, perModel: [0, 0, 3, 0] },
    {
      geometry: new THREE.CylinderGeometry(0.65, 1, 1, 6).translate(0, 0.5, 0),
      roughness: 0.95,
      perModel: [0, 0, 1, 0],
    },
    // Undergrowth: spikier clumps; reeds: thin stems; lily pads: flat discs.
    { geometry: new THREE.IcosahedronGeometry(1, 0), roughness: 0.9, perModel: [3, 0, 0, 0] },
    {
      geometry: new THREE.ConeGeometry(1, 1, 5).translate(0, 0.5, 0),
      roughness: 0.9,
      perModel: [REED.stems, 0, 0, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(1, 1, 0.04, 9),
      roughness: 0.4,
      perModel: [0, 0, 0, 1],
    },
    // Cattails: thin stems and their seed heads (D-125).
    {
      geometry: new THREE.CylinderGeometry(0.6, 1, 1, 5).translate(0, 0.5, 0),
      roughness: 0.9,
      perModel: [0, CATTAIL.stems, 0, 0],
    },
    {
      geometry: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),
      roughness: 0.95,
      perModel: [0, CATTAIL.stems, 0, 0],
    },
  ] satisfies PlantStyle["meshes"];
  private readonly head = new THREE.Color(CATTAIL_HEAD);

  parts(stratum: Stratum, m: Placement, x: number, z: number, name: string): Part[] {
    const form = formOf(name);
    const r = m.size;
    const salt = Math.floor(m.seed * 1e6);
    const around = (b: number, spread: number) => {
      const a = m.angle + (b * Math.PI * 2) / Math.max(1, form.blobs - 1);
      return { a, x: x + Math.cos(a) * spread, z: z + Math.sin(a) * spread };
    };
    const out: Part[] = [];
    if (stratum === "pad") {
      return [{ mesh: 5, x, y: 0.02, z, w: r, h: 1, angle: m.angle, shade: 0.9 + 0.2 * m.seed }];
    }
    if (stratum === "low" && name === "reeds") {
      for (let i = 0; i < REED.stems; i++) {
        const a = m.angle + (i * Math.PI * 2) / REED.stems;
        const d = r * 0.6 * rand(i, salt);
        const h = r * REED.height * (0.7 + 0.3 * rand(i + 9, salt));
        const [sx, sz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
        const shade = 0.85 + 0.25 * rand(i + 3, salt);
        out.push({ mesh: 4, x: sx, y: 0, z: sz, w: REED.radius, h, angle: a, shade });
      }
      return out;
    }
    if (stratum === "low") {
      const [w, h] = [r * form.w, r * form.h];
      out.push({ mesh: 3, x, y: h * 0.45, z, w, h, angle: m.angle, shade: 0.85 + 0.2 * m.seed });
      for (let b = 1; b < form.blobs; b++) {
        const p = around(b, r * BLOB.spread);
        const rb = r * BLOB.size;
        const [bw, bh] = [rb * form.w, rb * form.h];
        const shade = 0.78 + 0.2 * rand(b, salt);
        out.push({ mesh: 3, x: p.x, y: bh * 0.4, z: p.z, w: bw, h: bh, angle: p.a, shade });
      }
      return out;
    }
    if (stratum === "shrub" && name === "cattails") {
      for (let i = 0; i < CATTAIL.stems; i++) {
        const a = m.angle + (i * Math.PI * 2) / CATTAIL.stems;
        const d = r * 0.7 * rand(i, salt);
        const h = r * CATTAIL.height * (0.75 + 0.25 * rand(i + 9, salt));
        const [sx, sz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
        const shade = 0.85 + 0.25 * rand(i + 3, salt);
        out.push({ mesh: 6, x: sx, y: 0, z: sz, w: CATTAIL.radius, h, angle: a, shade });
        const y = h * 0.8;
        const [hw, hh] = [CATTAIL.headR, CATTAIL.head];
        out.push({ mesh: 7, x: sx, y, z: sz, w: hw, h: hh, angle: a, shade: 1, color: this.head });
      }
      return out;
    }
    if (stratum === "shrub") {
      const [w, h] = [r * form.w, r * form.h];
      out.push({ mesh: 0, x, y: h * 0.6, z, w, h, angle: m.angle, shade: 0.9 + 0.2 * m.seed });
      for (let b = 1; b < form.blobs; b++) {
        const p = around(b, r * BLOB.spread);
        const rb = r * BLOB.size;
        const [bw, bh] = [rb * form.w, rb * form.h];
        const shade = 0.82 + 0.2 * rand(b, salt);
        out.push({ mesh: 0, x: p.x, y: bh * 0.5, z: p.z, w: bw, h: bh, angle: p.a, shade });
      }
      return out;
    }
    const grown = (r - TREE.min) / (TREE.max - TREE.min);
    const trunk = TREE.trunkMin + (TREE.trunkMax - TREE.trunkMin) * (0.6 * grown + 0.4 * m.seed);
    const [cw, ch] = [r * form.w, r * form.h];
    const crownY = trunk + ch * 0.45;
    const trunkR = TREE.trunkR * (0.7 + 0.5 * grown);
    out.push({
      mesh: 2,
      x,
      y: 0,
      z,
      w: trunkR,
      h: crownY,
      angle: m.angle,
      shade: 1,
      color: this.bark,
    });
    out.push({
      mesh: 1,
      x,
      y: crownY,
      z,
      w: cw,
      h: ch,
      angle: m.angle,
      shade: 0.92 + 0.16 * m.seed,
    });
    for (let b = 1; b < form.blobs; b++) {
      const p = around(b, cw * BLOB.spread);
      const rb = r * BLOB.size;
      const y = crownY - ch * (0.1 + 0.25 * rand(b, salt));
      const shade = 0.8 + 0.15 * rand(b + 7, salt); // lower blobs: in the shade
      out.push({ mesh: 1, x: p.x, y, z: p.z, w: rb * form.w, h: rb * form.h, angle: p.a, shade });
    }
    return out;
  }
}

/** Wind push at a model's top, metres per metre above its root (D-086). */
const SWAY = 0.02;
/** Fake translucency (D-086): a warm rim on edges, brighter when looking toward the sun. */
const RIM = { power: 2.5, base: 0.06, backlit: 0.3 } as const;

/** Parts per model at most: keys hold up to this many parts per slot. */
const PARTS = 6;
/** Slots per stratum at most, in keys. */
const KEY_SLOTS = 8;
/** Mesh indices per key (the key's last factor). */
const KEY_MESHES = 8;

/** The species of one cell per model stratum (STRATA order), with their cover. */
export type CellCover = { species: number; cover: number }[][];

export class PlantView {
  private readonly meshes: GrowingMesh<number>[];
  /** Per cell: its fixed slots, the species by slot of each stratum, the part keys shown. */
  private readonly slots: Slot[][][] = [];
  private readonly prev: number[][][] = [];
  private readonly shown: number[][] = [];
  private readonly tmp = new THREE.Color();

  constructor(
    scene: THREE.Scene,
    private readonly n: number,
    private readonly style: PlantStyle,
    now: THREE.UniformNode<"float", number>,
    toSun = new THREE.Vector3(0, 1, 0),
  ) {
    const cells = n * n;
    const sun = uniform(toSun.clone().normalize());
    const facing = positionWorld.sub(cameraPosition).normalize().dot(sun); // 1: into the sun
    const edge = pow(saturate(dot(normalView, positionViewDirection)).oneMinus(), RIM.power);
    const rim = color(WORLD.sun).mul(
      edge.mul(smoothstep(0, 0.9, facing).mul(RIM.backlit).add(RIM.base)),
    );
    this.meshes = style.meshes.map((s) => {
      const perCell = MAX_MODELS.reduce<number>((t, most, i) => t + most * (s.perModel[i] ?? 0), 0);
      const capacity = cells * perCell;
      const material = new THREE.MeshStandardNodeMaterial({
        roughness: s.roughness,
        flatShading: true,
      });
      material.emissiveNode = rim;
      const g = new GrowingMesh<number>(s.geometry, capacity, material, now, SWAY);
      // Only shrubs and trees cast: clumps, reeds and pads are many and small (D-090).
      const shrub = STRATA.indexOf("shrub");
      const tree = STRATA.indexOf("tree");
      g.mesh.castShadow = (s.perModel[shrub] ?? 0) > 0 || (s.perModel[tree] ?? 0) > 0;
      g.mesh.receiveShadow = true;
      scene.add(g.mesh);
      return g;
    });
  }

  /** The meshes of a model stratum, for the layer toggles. */
  meshesOf(stratum: Stratum): THREE.InstancedMesh[] {
    const s = STRATA.indexOf(stratum);
    return this.style.meshes
      .map((m, i) => ((m.perModel[s] ?? 0) > 0 ? this.meshes[i] : null))
      .flatMap((g) => (g ? [g.mesh] : []));
  }

  /** A new field frame at time `t`: models of every owned cell, per model stratum the species
   *  present with their cover; `colors[player][species]` are linear colours. Pads float on the
   *  `water` surface (m) where the ground is below it. */
  update(
    cover: (c: number) => CellCover | null,
    owner: Uint8Array,
    names: readonly string[],
    colors: Record<1 | 2, THREE.Color[]>,
    t: number,
    height: (x: number, z: number) => number = () => 0,
    water: number | null = null,
  ): void {
    const n = this.n;
    for (let c = 0; c < n * n; c++) {
      const o = owner[c] ?? 0;
      const present = o === 1 || o === 2 ? cover(c) : null;
      const before = this.shown[c] ?? [];
      if (!present) {
        this.dropAll(before, t); // the cell was lost: its plants wither
        this.shown[c] = [];
        this.prev[c] = [];
        continue;
      }
      const slots = (this.slots[c] ??= cellSlots(c));
      const models = plantLayout(c, present, this.prev[c], slots);
      this.prev[c] = models.map((list) => list.map((m) => m.species));
      const x0 = ((c % n) - n / 2) * CELL;
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const now: number[] = [];
      models.forEach((list, s) => {
        const stratum = STRATA[s] ?? "low";
        for (const m of list) {
          const [x, z] = [x0 + m.x, z0 + m.z];
          const ground = height(x, z);
          const y0 = stratum === "pad" ? Math.max(ground, water ?? ground) : ground;
          const base = colors[o as 1 | 2][m.species];
          this.style.parts(stratum, m, x, z, names[m.species] ?? "").forEach((p, i) => {
            const slot = (c * STRATA.length + s) * KEY_SLOTS + m.slot;
            const key = (slot * PARTS + i) * KEY_MESHES + p.mesh;
            const color = p.color ?? this.tmp.copy(base ?? this.tmp).multiplyScalar(p.shade);
            const pose: Pose = { ...p, y: p.y + y0, color, rootX: x, rootY: y0, rootZ: z };
            this.meshes[p.mesh]?.put(key, pose, t);
            now.push(key);
          });
        }
      });
      const keep = new Set(now);
      this.dropAll(
        before.filter((k) => !keep.has(k)),
        t,
      );
      this.shown[c] = now;
    }
  }

  /** Every frame: free withered models, upload changes. */
  frame(t: number): void {
    for (const g of this.meshes) g.update(t);
  }

  /** Keys end with their mesh index (key % KEY_MESHES), see `update`. */
  private dropAll(keys: number[], t: number): void {
    for (const key of keys) this.meshes[key % KEY_MESHES]?.drop(key, t);
  }
}
