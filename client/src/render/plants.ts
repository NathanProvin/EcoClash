// Shrub and tree models (D-067, D-072). PlantView turns each field frame into plant models: the
// cell's fixed slots and sticky species (layout.ts), then the parts of each model from a
// PlantStyle, shown through GrowingMesh so they grow, resize and wither smoothly. The style is
// the seam for art: today's LowPolyPlants builds trunks and blob crowns from primitives; a glTF
// style can bring per-species meshes (and wind, in the growth position node) with no change here.

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
  TREE,
  type Placement,
  type Slot,
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
  /** Geometry, roughness and the most instances one model uses, per stratum [shrub, tree]. */
  meshes: { geometry: THREE.BufferGeometry; roughness: number; perModel: [number, number] }[];
  /** The parts of model `m` (world centre x, z) of stratum `stratum` for species `name`. */
  parts(stratum: 1 | 2, m: Placement, x: number, z: number, name: string): Part[];
}

/** Blob sizes beyond the first one, relative to the main blob, and their spread. */
const BLOB = { size: 0.62, spread: 0.5 } as const;

/** The placeholder look: bushes as blob clusters, trees as a trunk and blob crowns. */
export class LowPolyPlants implements PlantStyle {
  private readonly bark = new THREE.Color(WORLD.trunk);
  readonly meshes = [
    { geometry: new THREE.IcosahedronGeometry(1, 1), roughness: 0.85, perModel: [3, 0] },
    { geometry: new THREE.IcosahedronGeometry(1, 1), roughness: 0.8, perModel: [0, 3] },
    {
      geometry: new THREE.CylinderGeometry(0.65, 1, 1, 6).translate(0, 0.5, 0),
      roughness: 0.95,
      perModel: [0, 1],
    },
  ] satisfies PlantStyle["meshes"];

  parts(stratum: 1 | 2, m: Placement, x: number, z: number, name: string): Part[] {
    const form = formOf(name);
    const r = m.size;
    const salt = Math.floor(m.seed * 1e6);
    const around = (b: number, spread: number) => {
      const a = m.angle + (b * Math.PI * 2) / Math.max(1, form.blobs - 1);
      return { a, x: x + Math.cos(a) * spread, z: z + Math.sin(a) * spread };
    };
    const out: Part[] = [];
    if (stratum === 1) {
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
const PARTS = 4;
/** Slots per stratum at most, in keys. */
const KEY_SLOTS = 8;

export class PlantView {
  private readonly meshes: GrowingMesh<number>[];
  /** Per cell: its fixed slots, the species by slot of each stratum, the part keys shown. */
  private readonly slots: [Slot[], Slot[]][] = [];
  private readonly prev: [number[], number[]][] = [];
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
      const capacity = cells * (MAX_MODELS[1] * s.perModel[0] + MAX_MODELS[2] * s.perModel[1]);
      const material = new THREE.MeshStandardNodeMaterial({
        roughness: s.roughness,
        flatShading: true,
      });
      material.emissiveNode = rim;
      const g = new GrowingMesh<number>(s.geometry, capacity, material, now, SWAY);
      g.mesh.castShadow = true;
      g.mesh.receiveShadow = true;
      scene.add(g.mesh);
      return g;
    });
  }

  /** Stratum meshes, for the layer toggles: [shrubs, trees]. */
  meshesOf(stratum: 1 | 2): THREE.InstancedMesh[] {
    return this.style.meshes
      .map((s, i) => ((stratum === 1 ? s.perModel[0] : s.perModel[1]) > 0 ? this.meshes[i] : null))
      .flatMap((g) => (g ? [g.mesh] : []));
  }

  /** A new field frame at time `t`: models of every owned cell, per stratum the species present
   *  with their cover; `colors[player][species]` are linear colours. */
  update(
    cover: (
      c: number,
    ) => [{ species: number; cover: number }[], { species: number; cover: number }[]] | null,
    owner: Uint8Array,
    names: readonly string[],
    colors: Record<1 | 2, THREE.Color[]>,
    t: number,
    height: (x: number, z: number) => number = () => 0,
  ): void {
    const n = this.n;
    for (let c = 0; c < n * n; c++) {
      const o = owner[c] ?? 0;
      const present = o === 1 || o === 2 ? cover(c) : null;
      const before = this.shown[c] ?? [];
      if (!present) {
        this.dropAll(before, t); // the cell was lost: its plants wither
        this.shown[c] = [];
        this.prev[c] = [[], []];
        continue;
      }
      const slots = (this.slots[c] ??= cellSlots(c));
      const models = plantLayout(c, present[0], present[1], this.prev[c], slots);
      this.prev[c] = [models[0].map((m) => m.species), models[1].map((m) => m.species)];
      const x0 = ((c % n) - n / 2) * CELL;
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const now: number[] = [];
      models.forEach((list, s) => {
        const stratum = (s + 1) as 1 | 2;
        for (const m of list) {
          const [x, z] = [x0 + m.x, z0 + m.z];
          const y0 = height(x, z);
          const base = colors[o as 1 | 2][m.species];
          this.style.parts(stratum, m, x, z, names[m.species] ?? "").forEach((p, i) => {
            const key = (((c * 2 + s) * KEY_SLOTS + m.slot) * PARTS + i) * 4 + p.mesh;
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

  /** Keys end with their mesh index (key % 4), see `update`. */
  private dropAll(keys: number[], t: number): void {
    for (const key of keys) this.meshes[key % 4]?.drop(key, t);
  }
}
