// Terrain rendering (D-085): the generated map (D-083) as a displaced ground, a water surface over
// the valleys, rock outcrops, and slab walls that follow the relief. Heights come from the sim's
// terrain frame (elevation 0..255 per cell); everything that stands on the ground asks
// `Heightfield.at` for its height. A replay has no terrain: a flat field at 0.

import * as THREE from "three/webgpu";
import { CELL, rand } from "./layout";

/** Ground classes, as in sim-core `terrain.rs`. */
export const GROUND = { land: 0, shallow: 1, deep: 2, rock: 3 } as const;

/** Render depths (m): the water surface above the shared bed level, and how much deeper the
 *  bed of a deep cell is drawn. */
export const WATER = { surface: 0.5, deepBed: 1.5 } as const;

/** The map for the renderer: per cell, elevation 0..255 and the ground class. */
export interface TerrainFrame {
  elevation: Uint8Array;
  ground: Uint8Array;
  /** Metres from the lowest to the highest ground. */
  reliefM: number;
}

/** Box-blur passes over the cell heights (render only): banks and shorelines come out rounded
 *  instead of following the cell grid. */
const SMOOTH = 1; // one pass: cliffs stay steep (D-096)

/** Heights of an `n x n` map (m): per cell centre, bilinear in between. */
export class Heightfield {
  /** Height of each cell centre (m), row-major. */
  readonly cell: Float32Array;
  /** The water surface (m), or null without water. */
  readonly water: number | null;

  constructor(
    readonly n: number,
    readonly terrain?: TerrainFrame,
  ) {
    this.cell = new Float32Array(n * n);
    let bed: number | null = null;
    if (terrain) {
      for (let k = 0; k < n * n; k++) {
        const g = terrain.ground[k] ?? 0;
        let h = ((terrain.elevation[k] ?? 0) / 255) * terrain.reliefM;
        if (g === GROUND.shallow || g === GROUND.deep) {
          bed = h;
          if (g === GROUND.deep) h -= WATER.deepBed;
        }
        this.cell[k] = h;
      }
      const raw = this.cell.slice();
      for (let pass = 0; pass < SMOOTH; pass++) blur(this.cell, n); // rounded banks and shores
      // Beds never rise with the blur, so narrow rivers keep their water; rock keeps its height,
      // so cliffs stay sharp.
      for (let k = 0; k < n * n; k++) {
        const g = terrain.ground[k];
        if (g === GROUND.rock) this.cell[k] = Math.max(this.cell[k] ?? 0, raw[k] ?? 0);
        else if (g === GROUND.shallow || g === GROUND.deep)
          this.cell[k] = Math.min(this.cell[k] ?? 0, raw[k] ?? 0);
      }
    }
    this.water = bed === null ? null : bed + WATER.surface;
  }

  /** Height (m) at world point (x, z), bilinear between cell centres, clamped at the edges. */
  at(x: number, z: number): number {
    const n = this.n;
    const fx = Math.min(Math.max(x / CELL + n / 2 - 0.5, 0), n - 1);
    const fz = Math.min(Math.max(z / CELL + n / 2 - 0.5, 0), n - 1);
    const [x0, z0] = [Math.floor(fx), Math.floor(fz)];
    const [x1, z1] = [Math.min(x0 + 1, n - 1), Math.min(z0 + 1, n - 1)];
    const [tx, tz] = [fx - x0, fz - z0];
    const h = (r: number, c: number) => this.cell[r * n + c] ?? 0;
    const top = h(z0, x0) * (1 - tx) + h(z0, x1) * tx;
    const bottom = h(z1, x0) * (1 - tx) + h(z1, x1) * tx;
    return top * (1 - tz) + bottom * tz;
  }

  /** The heights as a half-float texture (rows = grid rows; 32-bit floats are not filterable in
   *  WebGPU), for shaders: grass roots, water depth. */
  texture(): THREE.DataTexture {
    const half = Uint16Array.from(this.cell, (v) => THREE.DataUtils.toHalfFloat(v));
    const t = new THREE.DataTexture(half, this.n, this.n, THREE.RedFormat, THREE.HalfFloatType);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }
}

/** One 3 x 3 box blur of an `n x n` grid, in place (edges use the cells that exist). */
function blur(h: Float32Array, n: number): void {
  const src = h.slice();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      let [sum, count] = [0, 0];
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const [rr, cc] = [r + dr, c + dc];
          if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
          sum += src[rr * n + cc] ?? 0;
          count++;
        }
      }
      h[r * n + c] = sum / count;
    }
  }
}

/** Ground mesh subdivisions per cell (4 since D-150: about 1.8x the triangles of 3). */
const SUBDIV = 4;

/** The ground: a plane over the map, its vertices raised to the heightfield. UVs as before. */
export function groundGeometry(field: Heightfield): THREE.BufferGeometry {
  const size = field.n * CELL;
  const segments = field.n * SUBDIV;
  const g = new THREE.PlaneGeometry(size, size, segments, segments).rotateX(-Math.PI / 2);
  const pos = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, field.at(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  return g;
}

/** The slab's four walls, from the ground's edge down to `depth` below 0. */
export function slabGeometry(field: Heightfield, depth: number): THREE.BufferGeometry {
  const half = (field.n * CELL) / 2;
  const segments = field.n * SUBDIV;
  const positions: number[] = [];
  const indices: number[] = [];
  const wall = (edge: (t: number) => [number, number], outward: boolean) => {
    const start = positions.length / 3;
    for (let i = 0; i <= segments; i++) {
      const [x, z] = edge(-half + (2 * half * i) / segments);
      // Up to the water where the ground dips under it, so the water never overhangs the edge.
      const top = Math.max(field.at(x, z), field.water ?? -Infinity);
      positions.push(x, top, z, x, -depth, z);
    }
    for (let i = 0; i < segments; i++) {
      const [a, b, c, d] = [start + 2 * i, start + 2 * i + 1, start + 2 * i + 2, start + 2 * i + 3];
      if (outward) indices.push(a, b, c, c, b, d);
      else indices.push(a, c, b, c, d, b);
    }
  };
  wall((t) => [t, half], true); // near side (+z)
  wall((t) => [t, -half], false); // far side (-z)
  wall((t) => [half, t], false); // right (+x)
  wall((t) => [-half, t], true); // left (-x)
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Rock outcrops: a few jittered low-poly stones per rock cell (world placements). */
export function rockPlacements(
  field: Heightfield,
): { x: number; y: number; z: number; s: number; sy: number; angle: number; shade: number }[] {
  const t = field.terrain;
  if (!t) return [];
  const n = field.n;
  const out: ReturnType<typeof rockPlacements> = [];
  for (let k = 0; k < n * n; k++) {
    if (t.ground[k] !== GROUND.rock) continue;
    const [x0, z0] = [((k % n) - n / 2) * CELL, (Math.floor(k / n) - n / 2) * CELL];
    const stones = 2 + Math.floor(rand(k, 7000) * 3);
    for (let i = 0; i < stones; i++) {
      const x = x0 + (0.15 + 0.7 * rand(k, 7100 + i)) * CELL;
      const z = z0 + (0.15 + 0.7 * rand(k, 7200 + i)) * CELL;
      const s = 0.8 + 1.1 * rand(k, 7300 + i);
      out.push({
        x,
        y: field.at(x, z) - 0.2 * s, // bedded in the ground
        z,
        s,
        sy: s * (0.55 + 0.4 * rand(k, 7400 + i)),
        angle: rand(k, 7500 + i) * Math.PI * 2,
        shade: 0.8 + 0.3 * rand(k, 7600 + i),
      });
    }
  }
  return out;
}

/** A rough stone: a once-subdivided icosahedron (D-150) with its vertices pushed in and out
 *  (deterministic), a broad lump plus a finer, craggy one. */
export function stoneGeometry(variant: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Jitter by the vertex's rounded position, so shared corners move together.
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const key = Math.round(x * 97) * 7919 + Math.round(y * 97) * 131 + Math.round(z * 97);
    const lump = rand(
      Math.round(x * 2) * 31 + Math.round(y * 2) * 7 + Math.round(z * 2),
      8100 + variant,
    );
    const f = 0.72 + 0.3 * lump + 0.16 * rand(key, 8000 + variant);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}

/** Lay a flat mesh (geometry in its XZ plane, turned only about Y) over the ground: each vertex
 *  sits `lift` metres above `height` under it, so rings and marks follow the relief instead of
 *  cutting into it (D-097). Call after moving, turning or scaling the mesh. */
export function drape(
  mesh: THREE.Mesh,
  height: (x: number, z: number) => number,
  lift: number,
): void {
  mesh.updateWorldMatrix(true, false);
  const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const m = mesh.matrixWorld.elements;
  const [y0, sy] = [m[13] ?? 0, m[5] || 1]; // world height of the mesh origin, its Y scale
  for (let i = 0; i < pos.count; i++) {
    const [x, z] = [pos.getX(i), pos.getZ(i)];
    const wx = (m[0] ?? 1) * x + (m[8] ?? 0) * z + (m[12] ?? 0);
    const wz = (m[2] ?? 0) * x + (m[10] ?? 1) * z + (m[14] ?? 0);
    pos.setY(i, (height(wx, wz) + lift - y0) / sy);
  }
  pos.needsUpdate = true;
}

/** Lattice cells across the baked noise texture, and its size in texels (D-151). */
export const NOISE = { period: 16, size: 256 } as const;

/** Tileable smooth value noise, baked once (D-151): three independent channels (R, G, B) of
 *  NOISE.period lattice cells across, so a shader samples it at `xz * frequency / period`
 *  (repeat wrapping) for the price of one texture fetch instead of a procedural Perlin noise
 *  per pixel. Values 0..1, mean about 0.5. */
export function noiseTexture(): THREE.DataTexture {
  const { period, size } = NOISE;
  const data = new Uint8Array(size * size * 4);
  const ease = (t: number) => t * t * (3 - 2 * t);
  for (let ch = 0; ch < 3; ch++) {
    const corner = (i: number, j: number) =>
      rand(((i + period) % period) * 977 + ((j + period) % period), 8800 + ch);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const [fx, fy] = [(x / size) * period, (y / size) * period];
        const [i, j] = [Math.floor(fx), Math.floor(fy)];
        const [tx, ty] = [ease(fx - i), ease(fy - j)];
        const top = corner(i, j) * (1 - tx) + corner(i + 1, j) * tx;
        const bottom = corner(i, j + 1) * (1 - tx) + corner(i + 1, j + 1) * tx;
        data[(y * size + x) * 4 + ch] = Math.round((top * (1 - ty) + bottom * ty) * 255);
      }
    }
  }
  for (let k = 3; k < data.length; k += 4) data[k] = 255;
  const t = new THREE.DataTexture(data, size, size);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
