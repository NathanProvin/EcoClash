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
import { caneGeometry, frondGeometry, limbGeometry, lumpGeometry, nettleGeometry } from "./shapes";

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

/** Tree crowns (D-150): lumps and limbs per tree at most. */
const TREE_LUMPS = 6;
const TREE_LIMBS = 3;
/** Beech: a smooth grey trunk. */
const BEECH_BARK = "#8d8a82";
/** Undergrowth shapes (D-150): fronds per fern (length and height x the clump radius); nettle
 *  stems (height x the radius); bramble canes (length x the radius) and their colour. */
const FERN = { fronds: 6, length: 1.15, height: 0.9 } as const;
const NETTLE_STEMS = { least: 5, most: 7, height: 2.1 } as const;
const BRAMBLE = { canes: 4, length: 1.5, color: "#6e3b4a" } as const;

/** Blob sizes beyond the first one, relative to the main blob, and their spread. */
const BLOB = { size: 0.62, spread: 0.5 } as const;

/** The placeholder look: bushes as blob clusters, trees as a trunk and blob crowns. */
export class LowPolyPlants implements PlantStyle {
  private readonly bark = new THREE.Color(WORLD.trunk);
  readonly meshes = [
    { geometry: new THREE.IcosahedronGeometry(1, 1), roughness: 0.85, perModel: [0, 3, 0, 0] },
    { geometry: lumpGeometry(0), roughness: 0.8, perModel: [0, 0, TREE_LUMPS, 0] },
    {
      geometry: new THREE.CylinderGeometry(0.65, 1, 1, 8).translate(0, 0.5, 0),
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
    // Trees by species (D-150): a second crown lump shape, and limbs.
    { geometry: lumpGeometry(1), roughness: 0.8, perModel: [0, 0, TREE_LUMPS, 0] },
    { geometry: limbGeometry(), roughness: 0.95, perModel: [0, 0, TREE_LIMBS, 0] },
    // Undergrowth by species (D-150): fern fronds, nettle stems, bramble canes.
    { geometry: frondGeometry(), roughness: 0.85, perModel: [FERN.fronds, 0, 0, 0] },
    { geometry: nettleGeometry(), roughness: 0.9, perModel: [NETTLE_STEMS.most, 0, 0, 0] },
    { geometry: caneGeometry(), roughness: 0.8, perModel: [BRAMBLE.canes, 0, 0, 0] },
  ] satisfies PlantStyle["meshes"];
  private readonly head = new THREE.Color(CATTAIL_HEAD);
  private readonly beechBark = new THREE.Color(BEECH_BARK);
  private readonly cane = new THREE.Color(BRAMBLE.color);

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
    if (stratum === "low" && name === "ferns") {
      for (let i = 0; i < FERN.fronds; i++) {
        const a = m.angle + (i * Math.PI * 2) / FERN.fronds + 0.4 * (rand(i, salt) - 0.5);
        const len = r * FERN.length * (0.75 + 0.35 * rand(i + 5, salt));
        const shade = i % 2 ? 0.8 : 1.05; // two greens alternating
        out.push({ mesh: 10, x, y: 0, z, w: len, h: len * FERN.height, angle: a, shade });
      }
      return out;
    }
    if (stratum === "low" && name === "nettle") {
      const extra = NETTLE_STEMS.most - NETTLE_STEMS.least + 1;
      const stems = NETTLE_STEMS.least + Math.floor(m.seed * extra);
      for (let i = 0; i < stems; i++) {
        const a = (i * 2.4 + m.angle) % (Math.PI * 2); // golden-angle spiral: a tight brush
        const d = r * 0.45 * Math.sqrt((i + 0.5) / stems);
        const h = r * NETTLE_STEMS.height * (0.75 + 0.3 * rand(i, salt));
        const [sx, sz] = [x + Math.cos(a) * d, z + Math.sin(a) * d];
        const shade = 0.8 + 0.25 * rand(i + 3, salt);
        out.push({ mesh: 11, x: sx, y: 0, z: sz, w: h, h, angle: a * 3, shade });
      }
      return out;
    }
    if (stratum === "low" && name === "bramble") {
      const [w, h] = [r * form.w * 0.8, r * form.h * 0.8];
      out.push({ mesh: 3, x, y: h * 0.4, z, w, h, angle: m.angle, shade: 0.7 + 0.15 * m.seed });
      for (let i = 0; i < BRAMBLE.canes; i++) {
        const a = m.angle + (i * Math.PI * 2) / BRAMBLE.canes + 0.5 * (rand(i, salt) - 0.5);
        const len = r * BRAMBLE.length * (0.7 + 0.4 * rand(i + 5, salt));
        // From near the mound centre, arching out over it.
        const [cx, cz] = [x - Math.cos(a) * r * 0.3, z - Math.sin(a) * r * 0.3];
        out.push({
          mesh: 12,
          x: cx,
          y: 0,
          z: cz,
          w: len,
          h: len,
          angle: a,
          shade: 1,
          color: this.cane,
        });
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
    if (name === "oak" || name === "chestnut" || name === "beech") return this.tree(name, m, x, z);
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

  /** A tree of a species with a silhouette (D-150): trunk, limbs and a lumpy crown, varied by
   *  the model's slot seed (lean, limb count, lump layout and sizes). */
  private tree(name: keyof typeof SILHOUETTE, m: Placement, x: number, z: number): Part[] {
    const sil = SILHOUETTE[name];
    const form = formOf(name);
    const r = m.size;
    const salt = Math.floor(m.seed * 1e6);
    const grown = (r - TREE.min) / (TREE.max - TREE.min);
    const full = TREE.trunkMin + (TREE.trunkMax - TREE.trunkMin) * (0.6 * grown + 0.4 * m.seed);
    const trunk = full * sil.trunk;
    const [cw, ch] = [r * form.w, r * form.h];
    const crownY = trunk + ch * 0.35;
    const trunkR = TREE.trunkR * sil.girth * (0.7 + 0.5 * grown);
    const bark = name === "beech" ? this.beechBark : this.bark;
    // The crown leans a little off its trunk.
    const lean = LEAN * rand(1, salt);
    const [lx, lz] = [x + Math.cos(m.angle) * lean, z + Math.sin(m.angle) * lean];
    const out: Part[] = [
      { mesh: 2, x, y: 0, z, w: trunkR, h: crownY, angle: m.angle, shade: 1, color: bark },
    ];
    const limbs = Math.max(0, sil.limbs - (rand(2, salt) < 0.4 ? 1 : 0));
    for (let i = 0; i < limbs; i++) {
      const a = m.angle + (i * Math.PI * 2) / Math.max(1, limbs) + 0.6 * rand(i + 3, salt);
      const len = cw * (0.75 + 0.3 * rand(i + 6, salt));
      const y = trunk * (0.7 + 0.15 * rand(i + 9, salt));
      out.push({ mesh: 9, x, y, z, w: len, h: len, angle: a, shade: 1, color: bark });
    }
    const lump = (i: number, px: number, y: number, pz: number, size: number, shade: number) => {
      const angle = m.angle + i * 1.3;
      // Two lump shapes, alternating.
      out.push({ mesh: i % 2 ? 8 : 1, x: px, y, z: pz, w: size, h: size * sil.flat, angle, shade });
    };
    const top = 0.92 + 0.16 * m.seed;
    if (sil.stack) {
      // A tall oval: lumps stacked up the axis, smaller toward the top, two lower at the sides.
      const levels = sil.lumps - 2;
      for (let i = 0; i < levels; i++) {
        const t = i / Math.max(1, levels - 1);
        const size = cw * sil.lump * (1.15 - 0.45 * t) * (0.9 + 0.2 * rand(i + 12, salt));
        lump(i, lx, crownY - ch * 0.3 + t * ch * 0.95, lz, size, top - 0.06 * (1 - t));
      }
      [-1, 1].forEach((side, k) => {
        const a = m.angle + side * (Math.PI / 2 + 0.4 * rand(k + 20, salt));
        const d = cw * sil.ring;
        const [px, pz] = [lx + Math.cos(a) * d, lz + Math.sin(a) * d];
        lump(levels + k, px, crownY - ch * 0.2, pz, cw * sil.lump * 0.85, 0.82);
      });
      return out;
    }
    // A spreading crown: a central lump over a ring of lumps at varied heights and sizes.
    lump(0, lx, crownY + ch * 0.15, lz, cw * sil.lump * 1.25, top);
    const ring = sil.lumps - 1;
    for (let i = 0; i < ring; i++) {
      const a = m.angle + (i * Math.PI * 2) / ring + 0.5 * (rand(i + 30, salt) - 0.5);
      const d = cw * sil.ring * (0.85 + 0.3 * rand(i + 40, salt));
      const y = crownY + ch * (sil.rise + 0.25 * (rand(i + 50, salt) - 0.5));
      const size = cw * sil.lump * (0.85 + 0.3 * rand(i + 60, salt));
      const shade = 0.8 + 0.14 * rand(i + 70, salt); // the ring sits lower, in the shade
      lump(i + 1, lx + Math.cos(a) * d, y, lz + Math.sin(a) * d, size, shade);
    }
    return out;
  }
}

/** Tree silhouettes (D-150), per species: trunk height and girth (x the generic tree); crown
 *  lumps: count, ring radius and lump size (x the crown width), lump height (x its width), ring
 *  height (x the crown height); limbs; a stacked oval crown (beech) or a spreading one. */
const SILHOUETTE = {
  oak: {
    trunk: 0.72,
    girth: 1.35,
    lumps: 6,
    ring: 0.78,
    lump: 0.56,
    flat: 0.72,
    rise: -0.1,
    limbs: 3,
    stack: false,
  },
  chestnut: {
    trunk: 0.85,
    girth: 1.45,
    lumps: 5,
    ring: 0.5,
    lump: 0.62,
    flat: 0.95,
    rise: -0.15,
    limbs: 2,
    stack: false,
  },
  beech: {
    trunk: 1.12,
    girth: 0.8,
    lumps: 5,
    ring: 0.32,
    lump: 0.5,
    flat: 1.0,
    rise: 0,
    limbs: 0,
    stack: true,
  },
} as const;
/** How far a crown may lean off its trunk (m). */
const LEAN = 0.3;

/** Wind push at a model's top, metres per metre above its root (D-086). */
const SWAY = 0.02;
/** Fake translucency (D-086): a warm rim on edges, brighter when looking toward the sun. */
const RIM = { power: 2.5, base: 0.06, backlit: 0.3 } as const;

/** Parts per model at most: keys hold up to this many parts per slot (trees: trunk, limbs and
 *  crown lumps, D-150). */
const PARTS = 12;
/** Slots per stratum at most, in keys. */
const KEY_SLOTS = 8;
/** Mesh indices per key (the key's last factor). */
const KEY_MESHES = 16;

/** The species of one cell per model stratum (STRATA order), with their cover. */
export type CellCover = { species: number; cover: number }[][];

export class PlantView {
  private readonly meshes: GrowingMesh<number>[];
  /** Per cell: its fixed slots, the species by slot of each stratum, the part keys shown. */
  private readonly slots: Slot[][][] = [];
  private readonly prev: number[][][] = [];
  private readonly shown: number[][] = [];
  private readonly tmp = new THREE.Color();
  /** Meshes that trees are made of (trunks, crowns): they fall when felled (D-128). */
  private readonly treeMesh: boolean[];

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
    const tree = STRATA.indexOf("tree");
    this.treeMesh = style.meshes.map((m) => (m.perModel[tree] ?? 0) > 0);
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
    deadwood?: Uint8Array,
  ): void {
    const n = this.n;
    for (let c = 0; c < n * n; c++) {
      const o = owner[c] ?? 0;
      const present = o === 1 || o === 2 ? cover(c) : null;
      const before = this.shown[c] ?? [];
      // Trees felled by grazers, a storm or a lost front fall over (D-128); trees that died
      // standing (dead wood now on the cell, D-127) wither away under their dead trunk.
      const fall = !(deadwood?.[c] ?? 0);
      if (!present) {
        this.dropAll(before, t, fall); // the cell was lost: its plants wither
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
        fall,
      );
      this.shown[c] = now;
    }
  }

  /** Every frame: free withered models, upload changes. */
  frame(t: number): void {
    for (const g of this.meshes) g.update(t);
  }

  /** Keys end with their mesh index (key % KEY_MESHES), see `update`; tree parts fall when
   *  `fall`, all the parts of one model toward one side (a hash of its slot). */
  private dropAll(keys: number[], t: number, fall = false): void {
    for (const key of keys) {
      const mesh = key % KEY_MESHES;
      if (fall && this.treeMesh[mesh]) {
        const slot = Math.floor(key / KEY_MESHES / PARTS);
        this.meshes[mesh]?.fell(key, t, rand(slot, 9100) * Math.PI * 2);
      } else {
        this.meshes[mesh]?.drop(key, t);
      }
    }
  }
}

/** Dead trees (D-127): a weathered grey trunk and a few bare branches, sized by the dead wood
 *  left. Branch geometry leans out in model space, since instances only turn about Y. */
const DEAD = { trunk: 3.4, trunkR: 0.26, branches: 5, branch: 1.8, color: "#a89e90" } as const;

export class DeadTrees {
  private readonly trunks: GrowingMesh<number>;
  private readonly branches: GrowingMesh<number>;
  private readonly color = new THREE.Color(DEAD.color);
  private readonly shown = new Set<number>();

  constructor(scene: THREE.Scene, n: number, now: THREE.UniformNode<"float", number>) {
    const cells = n * n;
    const mat = () => new THREE.MeshStandardNodeMaterial({ roughness: 1, flatShading: true });
    this.trunks = new GrowingMesh<number>(
      new THREE.CylinderGeometry(0.55, 1, 1, 6).translate(0, 0.5, 0),
      cells,
      mat(),
      now,
    );
    this.branches = new GrowingMesh<number>(
      // Thin and leaning in the geometry: instances scale it evenly by the branch length.
      new THREE.CylinderGeometry(0.03, 0.065, 1, 4).translate(0, 0.5, 0).rotateZ(-0.9),
      cells * DEAD.branches,
      mat(),
      now,
    );
    for (const g of [this.trunks, this.branches]) {
      g.mesh.castShadow = true;
      g.mesh.receiveShadow = true;
      scene.add(g.mesh);
    }
  }

  /** A new field frame at `t`: a dead tree on every cell with dead wood, withering when gone. */
  update(
    deadwood: Uint8Array | undefined,
    n: number,
    t: number,
    height: (x: number, z: number) => number,
  ): void {
    for (let c = 0; c < n * n; c++) {
      const w = deadwood?.[c] ?? 0;
      if (w === 0) {
        if (this.shown.delete(c)) {
          this.trunks.drop(c, t);
          for (let b = 0; b < DEAD.branches; b++) this.branches.drop(c * DEAD.branches + b, t);
        }
        continue;
      }
      this.shown.add(c);
      const size = 0.45 + 0.55 * Math.sqrt(w / 255);
      const x = ((c % n) - n / 2 + 0.5 + 0.3 * (rand(c, 7100) - 0.5)) * CELL;
      const z = (Math.floor(c / n) - n / 2 + 0.5 + 0.3 * (rand(c, 7200) - 0.5)) * CELL;
      const y = height(x, z);
      const h = DEAD.trunk * size;
      const turn = rand(c, 7300) * Math.PI * 2;
      const root = { rootX: x, rootY: y, rootZ: z, color: this.color };
      this.trunks.put(c, { ...root, x, y, z, w: DEAD.trunkR * size, h, angle: turn }, t);
      for (let b = 0; b < DEAD.branches; b++) {
        const a = turn + (b * Math.PI * 2) / DEAD.branches + rand(c * 8 + b, 7400);
        const len = DEAD.branch * size * (0.7 + 0.4 * rand(c * 8 + b, 7500));
        const by = y + h * (0.5 + 0.4 * (b / DEAD.branches));
        this.branches.put(
          c * DEAD.branches + b,
          { ...root, x, y: by, z, w: len, h: len, angle: a },
          t,
        );
      }
    }
  }

  frame(t: number): void {
    this.trunks.update(t);
    this.branches.update(t);
  }
}
