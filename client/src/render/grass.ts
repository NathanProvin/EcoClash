// Instanced herbs (INSTRUCTIONS §7.2, D-055, D-151): the herbaceous stratum (L1) as static GPU
// meshes. The vertex shaders read the flora texture (RGB = owner's L1 colour, A = L1 cover) and
// the herb mix (R lichen and moss, G grasses, B wildflowers: each one's share of the cover) of the
// last two field frames and blend them (D-072), so tufts grow and fade between frames, with no
// per-frame CPU work. Grasses are blades that bend in the wind (D-086); lichen and moss are flat,
// round patches; wildflowers are round heads on short stems. Each herb has its own tufts: a tuft
// shows where that herb's cover (L1 cover x its share) is above the tuft's seed.

import {
  attribute,
  cameraPosition,
  clamp,
  float,
  mix,
  positionLocal,
  smoothstep,
  step,
  texture,
  time,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { wind } from "./growth";
import { CELL, rand } from "./layout";
import { FLOWERS, LICHENS } from "./palette";

const BLADE_WIDTH = 0.14; // metres at the base
const BLADE_HEIGHT = [0.3, 0.55] as const; // shortest, tallest (below the shrub band)
export const TUFT = 3; // blades per tuft, fanned 60 degrees apart
const BEND = 0.12; // metres the tallest blade's tip moves in a full gust
const TUFT_SPREAD = 0.1; // metres between a tuft's blades

/** Lichen and moss patches (D-151): disc radius (m), dome height and lift off the ground (m),
 *  tufts per grass tuft, and the patch (m) whose tufts share one colour. */
export const LICHEN = {
  radius: [0.09, 0.175], // D-215: half (was 0.18..0.35)
  dome: 0.02,
  lift: 0.015,
  share: 0.125, // D-154, D-168: a quarter of the patches of 0.5
  patch: 2,
} as const;
/** Wildflowers (D-151): heads per tuft, head radius and height (m), how far heads stand from
 *  the tuft's root (m), the wind's push at the top (m), tufts per grass tuft, colour patch (m). */
export const FLOWER = {
  heads: 3,
  radius: [0.07, 0.1],
  height: [0.3, 0.45],
  spread: 0.12,
  bend: 0.08,
  share: 1 / 3,
  patch: 3,
} as const;

/** Every cell of an `n x n` map, in order. */
const all = (n: number) => Array.from({ length: n * n }, (_, c) => c);

/** Herb chunks per map side (D-155): each herb mesh is split into this many squared, each with
 *  its bounds, so the GPU skips chunks off screen (a whole-map mesh is always drawn). */
export const HERB_CHUNKS = 4;

/** Herb level of detail (D-199): within `near` metres of the camera every tuft shows; by `far`
 *  only the share `min` does, each one wider so the meadow keeps its cover. Tufts are stored
 *  rank-major (every cell's first tuft, then every cell's second...), so a chunk draws its first
 *  tufts only: the vertex work of far tufts is skipped too. */
export interface HerbLod {
  near: number;
  far: number;
  min: number;
}

/** The share of tufts shown at `d` metres from the camera (D-199): 1 near, `min` far. */
export function herbBudget(d: number, lod: HerbLod): number {
  const t = Math.min(1, Math.max(0, (d - lod.near) / (lod.far - lod.near)));
  return 1 - t * (1 - lod.min);
}

/** Whether herb `herb` (0 lichen and moss, 1 grasses, 2 wildflowers: the herb mix channel) can
 *  show anywhere in the cells [r0, r1) x [c0, c1) of an `n x n` map, from the herb mix frames
 *  being blended (`mixes`, n x n RGBA). The shader samples the mix bilinearly, so one cell of
 *  border counts too; a herb with no share there collapses every tuft, so its mesh can go. */
export function herbIn(
  n: number,
  mixes: readonly Uint8Array[],
  herb: number,
  [r0, r1, c0, c1]: readonly [number, number, number, number],
): boolean {
  for (let r = Math.max(0, r0 - 1); r < Math.min(n, r1 + 1); r++) {
    for (let c = Math.max(0, c0 - 1); c < Math.min(n, c1 + 1); c++) {
      for (const m of mixes) if (m[(r * n + c) * 4 + herb]) return true;
    }
  }
  return false;
}

/** Vertex data of every blade: one triangle each (base left, base right, tip). */
export interface Blades {
  /** Blade-local positions (x, y, z), before the shader scales and moves them. */
  position: Float32Array;
  /** World x / z of the blade's base, per vertex. */
  root: Float32Array;
  /** The L1 cover above which the blade shows (0..1), per vertex: density follows cover. */
  seed: Float32Array;
  /** The tuft's rank in its cell, as a share ((k + ½) / perCell), per vertex (D-199). */
  rank: Float32Array;
}

/** Tufts of `TUFT` blades for an `n x n` map, `perCell` tufts per cell, jittered inside their cell
 *  (deterministic). A tuft's blades share its root and seed: they show and hide together. */
export function grassBlades(n: number, perCell: number, cells: readonly number[] = all(n)): Blades {
  const count = cells.length * perCell * TUFT;
  const position = new Float32Array(count * 9);
  const root = new Float32Array(count * 6);
  const seed = new Float32Array(count * 3);
  const rank = new Float32Array(count * 3);
  // Rank-major (D-199): every cell's tuft k before any cell's tuft k + 1.
  for (let k = 0; k < perCell; k++) {
    for (const [idx, c] of cells.entries()) {
      const x0 = ((c % n) - n / 2) * CELL;
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const salt = 5000 + 8 * k;
      const [rx, rz] = [x0 + rand(c, salt) * CELL, z0 + rand(c, salt + 1) * CELL];
      const tuftSeed = rand(c, salt + 4);
      for (let t = 0; t < TUFT; t++) {
        const b = (k * cells.length + idx) * TUFT + t;
        const angle = rand(c, salt + 2) * Math.PI + (t * Math.PI) / TUFT;
        const h = BLADE_HEIGHT[0] + (BLADE_HEIGHT[1] - BLADE_HEIGHT[0]) * rand(c, salt + 3 + t);
        const [cx, cz] = [Math.cos(angle), Math.sin(angle)];
        const [dx, dz] = [(cx * BLADE_WIDTH) / 2, (cz * BLADE_WIDTH) / 2];
        const [ox, oz] = [-cz * TUFT_SPREAD * (t - 1), cx * TUFT_SPREAD * (t - 1)]; // fan out
        position.set([ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox, h, oz], b * 9);
        root.set([rx, rz, rx, rz, rx, rz], b * 6);
        seed.fill(tuftSeed, b * 3, b * 3 + 3);
        rank.fill((k + 0.5) / perCell, b * 3, b * 3 + 3);
      }
    }
  }
  return { position, root, seed, rank };
}

/** One tuft's local geometry: positions, normals, triangle indices, and per vertex the colour
 *  index (-1: the herb's own colour from the flora texture, e.g. a stem). */
interface TuftShape {
  position: number[];
  normal: number[];
  index: number[];
  hue: number[];
}

/** Rim points of a lichen or moss patch (D-151). */
const LICHEN_SIDES = 9;

/** A lichen or moss patch: a flat, slightly domed round blob `r` metres across, its rim
 *  jittered (from `rnd`) so patches are not regular polygons. */
function lichenTuft(r: number, hue: number, rnd: (k: number) => number): TuftShape {
  const position = [0, LICHEN.dome, 0];
  const normal = [0, 1, 0];
  for (let i = 0; i < LICHEN_SIDES; i++) {
    const a = (i * 2 * Math.PI) / LICHEN_SIDES;
    const k = r * (0.78 + 0.32 * rnd(i + 1));
    position.push(Math.cos(a) * k, 0, Math.sin(a) * k);
    normal.push(0, 1, 0);
  }
  const index: number[] = [];
  for (let i = 0; i < LICHEN_SIDES; i++) index.push(0, 1 + ((i + 1) % LICHEN_SIDES), 1 + i);
  return { position, normal, index, hue: Array(LICHEN_SIDES + 1).fill(hue) as number[] };
}

/** Wildflowers: `FLOWER.heads` round heads (the top half of an octahedron: the camera looks
 *  down, so the lower half was all back faces) on thin stems, around the root. */
function flowerTuft(rnd: (k: number) => number, hue: number): TuftShape {
  const s: TuftShape = { position: [], normal: [], index: [], hue: [] };
  const corners = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;
  const faces = [
    [0, 2, 3],
    [3, 2, 1],
    [1, 2, 4],
    [4, 2, 0],
  ] as const;
  for (let h = 0; h < FLOWER.heads; h++) {
    const a = rnd(h) * Math.PI * 2;
    const d = FLOWER.spread * (0.3 + 0.7 * rnd(h + 10));
    const [x, z] = [Math.cos(a) * d, Math.sin(a) * d];
    const y = FLOWER.height[0] + (FLOWER.height[1] - FLOWER.height[0]) * rnd(h + 20);
    const r = FLOWER.radius[0] + (FLOWER.radius[1] - FLOWER.radius[0]) * rnd(h + 30);
    // The stem: one thin triangle from the ground to the head, both windings.
    const v = s.position.length / 3;
    s.position.push(x - 0.012, 0, z, x + 0.012, 0, z, x, y, z);
    s.normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    s.hue.push(-1, -1, -1);
    s.index.push(v, v + 1, v + 2, v + 2, v + 1, v);
    // The head: a flattened dome (a round blob from above), its rim a little below the stem top.
    const o = s.position.length / 3;
    for (const [cx, cy, cz] of corners) {
      s.position.push(x + cx * r, y + (cy - 0.35) * r * 0.7, z + cz * r);
      s.normal.push(cx, cy, cz);
      s.hue.push(hue);
    }
    for (const [i, j, k] of faces) s.index.push(o + i, o + j, o + k);
  }
  return s;
}

/** `perCell` tufts per cell of the shape `make` builds (from a tuft random and its patch colour
 *  index), as one indexed geometry with `root` (world x, z) and `seed` per vertex. */
export function tuftGeometry(
  n: number,
  perCell: number,
  salt: number,
  patch: number,
  colours: number,
  make: (rnd: (k: number) => number, hue: number) => TuftShape,
  cells: readonly number[] = all(n),
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const hues: number[] = [];
  const root: number[] = [];
  const seed: number[] = [];
  const rank: number[] = [];
  for (let k = 0; k < perCell; k++) {
    for (const c of cells) {
      const x0 = ((c % n) - n / 2) * CELL;
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const s = salt + 64 * k;
      const [rx, rz] = [x0 + rand(c, s) * CELL, z0 + rand(c, s + 1) * CELL];
      const tuftSeed = rand(c, s + 2);
      const cluster = Math.floor(rx / patch) * 7919 + Math.floor(rz / patch);
      const hue = Math.floor(rand(cluster, salt + 7) * colours);
      const shape = make((j) => rand(c, s + 3 + j), hue);
      const base = pos.length / 3;
      pos.push(...shape.position);
      nrm.push(...shape.normal);
      hues.push(...shape.hue);
      for (const i of shape.index) idx.push(base + i);
      for (let v = 0; v < shape.position.length / 3; v++) {
        root.push(rx, rz);
        seed.push(tuftSeed);
        rank.push((k + 0.5) / perCell);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("hue", new THREE.Float32BufferAttribute(hues, 1));
  g.setAttribute("root", new THREE.Float32BufferAttribute(root, 2));
  g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute("rank", new THREE.Float32BufferAttribute(rank, 1));
  g.setIndex(idx);
  return g;
}

/** One of up to four colours by the tuft's `hue` attribute (0..3). */
function pickColour(list: readonly string[]) {
  const i = attribute("hue", "float");
  const c = (k: number) => {
    const col = new THREE.Color(list[Math.min(k, list.length - 1)]);
    return vec3(col.r, col.g, col.b);
  };
  return mix(mix(c(0), c(1), step(1, i)), mix(c(2), c(3), step(3, i)), step(2, i));
}

/** The herbs over an `n x n` map, drawn from `flora` (n x n RGBA, rows = grid rows): the previous
 *  field frame `prev` blended into the current one by `blend` (0..1). `herbMix` holds each cell's
 *  herb shares (R lichen and moss, G grasses, B wildflowers). A group of three meshes. */
export function makeGrass(
  n: number,
  perCell: number,
  flora: THREE.Texture,
  prev: THREE.Texture,
  blend: THREE.UniformNode<"float", number>,
  heights?: THREE.Texture,
  herbMix?: { now: THREE.Texture; prev: THREE.Texture },
  relief = 0,
  lod: HerbLod = { near: 1e9, far: 2e9, min: 1 },
  water: number | null = null,
): HerbGroup {
  /** The highest a herb reaches above the map's base (m): the relief plus the tallest herb. */
  const ceiling = relief + Math.max(BLADE_HEIGHT[1], FLOWER.height[1]) + 1;
  const size = n * CELL;
  const root = attribute("root", "vec2");
  const seed = attribute("seed", "float");
  const at = root.add(size / 2).div(size); // world x/z -> texel
  const texel = mix(texture(prev, at).level(float(0)), texture(flora, at).level(float(0)), blend);
  const shares = herbMix
    ? mix(
        texture(herbMix.prev, at).level(float(0)),
        texture(herbMix.now, at).level(float(0)),
        blend,
      )
    : vec3(0, 1, 0);
  // Roots on the relief (D-085): the ground's height at the root, from the height texture.
  const y = heights ? texture(heights, at).level(float(0)).r : float(0);
  // Level of detail (D-199): the share of tufts kept at this tuft's distance (as `herbBudget`),
  // and how much wider the kept ones grow to cover for the rest.
  const rank = attribute("rank", "float");
  const dist = vec3(root.x, y, root.y).sub(cameraPosition).length();
  const budget = float(1).sub(
    clamp(dist.sub(lod.near).div(lod.far - lod.near), 0, 1).mul(1 - lod.min),
  );
  const keep = step(rank, budget);
  const widen = budget.max(lod.min).pow(-0.5);
  /** 0: the tuft is hidden (collapsed), 1: shown; by its herb's cover against its seed, and by
   *  the level of detail. */
  // No herb grows where its root is under water (D-210): bank cells dip into the river.
  const dry = water === null ? float(1) : step(water + 0.03, y);
  const shown = (herb: "r" | "g" | "b") =>
    smoothstep(seed.sub(0.05), seed.add(0.05), texel.a.mul(shares[herb])).mul(keep).mul(dry);
  /** A tuft's shape, wider (not taller) where fewer tufts show. */
  const spread = (v: typeof positionLocal) => vec3(v.x.mul(widen), v.y, v.z.mul(widen));

  // Grasses: blades.
  const bladeGeometry = (cells: readonly number[]) => {
    const b = grassBlades(n, perCell, cells);
    const blades = new THREE.BufferGeometry();
    blades.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
    blades.setAttribute("root", new THREE.BufferAttribute(b.root, 2));
    blades.setAttribute("seed", new THREE.BufferAttribute(b.seed, 1));
    blades.setAttribute("rank", new THREE.BufferAttribute(b.rank, 1));
    // Normals point up: grass lights like the ground under it, not like thin tilted cards.
    const up = new Float32Array(b.position.length);
    for (let i = 1; i < up.length; i += 3) up[i] = 1;
    blades.setAttribute("normal", new THREE.BufferAttribute(up, 3));
    // Both windings, one-sided material: both faces keep the up normal (double-sided rendering
    // would flip it on the back face and darken it).
    const index = new Uint32Array((b.seed.length / 3) * 6);
    for (let v = 0, i = 0; i < index.length; v += 3, i += 6) {
      index.set([v, v + 1, v + 2, v + 2, v + 1, v], i);
    }
    blades.setIndex(new THREE.BufferAttribute(index, 1));
    return blades;
  };
  const grass = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const tip = positionLocal.y.div(BLADE_HEIGHT[1]);
  const push = wind(root, time).mul(tip.mul(tip).mul(BEND));
  const blade = spread(positionLocal)
    .add(vec3(push.x, 0, push.y))
    .mul(shown("g"));
  grass.positionNode = vec3(root.x, y, root.y).add(blade);
  const shade = mix(float(0.62), float(1.02), tip); // dark base, no lime tip (D-211)
  grass.colorNode = texel.rgb.mul(shade);

  // Lichen and moss: flat round patches in their own colours.
  const lichenRadius = (rnd: (k: number) => number) =>
    LICHEN.radius[0] + (LICHEN.radius[1] - LICHEN.radius[0]) * rnd(0);
  const lichenGeometry = (cells: readonly number[]) =>
    tuftGeometry(
      n,
      Math.max(1, Math.round(perCell * LICHEN.share)),
      6100,
      LICHEN.patch,
      LICHENS.length,
      (rnd, hue) => lichenTuft(lichenRadius(rnd), hue, rnd),
      cells,
    );
  const lichen = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const hue = attribute("hue", "float");
  lichen.positionNode = vec3(root.x, y.add(LICHEN.lift), root.y).add(
    spread(positionLocal).mul(shown("r")),
  );
  lichen.colorNode = pickColour(LICHENS).mul(mix(float(0.85), float(1.05), seed));

  // Wildflowers: round heads on stems, one colour per patch.
  const flowerGeometry = (cells: readonly number[]) =>
    tuftGeometry(
      n,
      Math.max(1, Math.round(perCell * FLOWER.share)),
      6900,
      FLOWER.patch,
      FLOWERS.length,
      flowerTuft,
      cells,
    );
  const flower = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
  const top = positionLocal.y.div(FLOWER.height[1]);
  const sway = wind(root, time).mul(top.mul(top).mul(FLOWER.bend));
  const swayed = spread(positionLocal)
    .add(vec3(sway.x, 0, sway.y))
    .mul(shown("b"));
  flower.positionNode = vec3(root.x, y, root.y).add(swayed);
  const isHead = step(0, hue); // stems carry -1
  flower.colorNode = mix(texel.rgb.mul(0.8), pickColour(FLOWERS), isHead);

  // One mesh per herb and chunk. Positions are made in the shader, so each chunk gets its
  // bounds by hand: its square, plus the relief and the tallest herb (`ceiling` m).
  const group = new THREE.Group() as HerbGroup;
  const chunks: {
    mesh: THREE.Mesh;
    box: THREE.Box3;
    perTuft: number;
    cells: number;
    per: number;
    herb: number;
    span: [number, number, number, number];
  }[] = [];
  const side = Math.ceil(n / HERB_CHUNKS);
  for (let r0 = 0; r0 < n; r0 += side) {
    for (let c0 = 0; c0 < n; c0 += side) {
      const cells: number[] = [];
      for (let r = r0; r < Math.min(n, r0 + side); r++) {
        for (let c = c0; c < Math.min(n, c0 + side); c++) cells.push(r * n + c);
      }
      const [w, h] = [Math.min(side, n - c0) * CELL, Math.min(side, n - r0) * CELL];
      const centre = new THREE.Vector3(
        c0 * CELL - size / 2 + w / 2,
        ceiling / 2,
        r0 * CELL - size / 2 + h / 2,
      );
      const bounds = new THREE.Sphere(centre, Math.hypot(w / 2, h / 2, ceiling / 2) + 1);
      const box = new THREE.Box3(
        new THREE.Vector3(c0 * CELL - size / 2, 0, r0 * CELL - size / 2),
        new THREE.Vector3(c0 * CELL - size / 2 + w, ceiling, r0 * CELL - size / 2 + h),
      );
      const counts = [
        perCell,
        Math.max(1, Math.round(perCell * LICHEN.share)),
        Math.max(1, Math.round(perCell * FLOWER.share)),
      ];
      for (const [i, [make, material]] of (
        [
          [bladeGeometry, grass],
          [lichenGeometry, lichen],
          [flowerGeometry, flower],
        ] as const
      ).entries()) {
        const g = make(cells);
        g.boundingSphere = bounds;
        const mesh = new THREE.Mesh(g, material);
        mesh.receiveShadow = true;
        group.add(mesh);
        const per = counts[i] ?? 1;
        const indices = g.index?.count ?? 0;
        chunks.push({
          mesh,
          box,
          perTuft: indices / (per * cells.length),
          cells: cells.length,
          per,
          herb: [1, 0, 2][i] ?? 1, // blades are grasses (mix G), lichen R, flowers B
          span: [r0, Math.min(n, r0 + side), c0, Math.min(n, c0 + side)],
        });
      }
    }
  }
  // Each field frame: hide the chunk meshes of herbs absent from their chunk (most of the map
  // early on; wildflowers, the heaviest tufts, wherever they are not grown).
  group.cull = (mixes) => {
    for (const c of chunks) c.mesh.visible = herbIn(n, mixes, c.herb, c.span);
  };
  // Each frame: a chunk draws only the tufts the nearest point of its square can show.
  group.lod = (eye: THREE.Vector3) => {
    for (const c of chunks) {
      const share = herbBudget(c.box.distanceToPoint(eye), lod);
      const tufts = Math.min(c.per, Math.ceil(share * c.per));
      c.mesh.geometry.setDrawRange(0, tufts * c.cells * c.perTuft);
    }
  };
  return group;
}

/** The herbs' group, with its per-frame level of detail (D-199) and its per-field-frame culling
 *  from the herb mix frames being blended (D-224). */
export type HerbGroup = THREE.Group & {
  lod?: (eye: THREE.Vector3) => void;
  cull?: (mixes: readonly Uint8Array[]) => void;
};
