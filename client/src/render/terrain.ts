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

/** Ground mesh subdivisions per cell. */
const SUBDIV = 3;

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

/** A rough stone: an icosahedron with its vertices pushed in and out (deterministic). */
export function stoneGeometry(variant: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 0);
  const pos = g.attributes.position as THREE.BufferAttribute;
  // Jitter by the vertex's rounded position, so shared corners move together.
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const key = Math.round(x * 97) * 7919 + Math.round(y * 97) * 131 + Math.round(z * 97);
    const f = 0.75 + 0.45 * rand(key, 8000 + variant);
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  g.computeVertexNormals();
  return g;
}
