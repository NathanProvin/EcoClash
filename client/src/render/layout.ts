// Placement of placeholder models inside a cell, with guaranteed clearance (D-033).
//
// Every model owns a slot of a per-cell grid and stays inside it (jitter + size + rotation), so
// models never overlap inside a cell nor across cells. Heights are fixed bands that do not
// intersect: herb dots on the ground, shrub cones below SHRUB_TOP, tree canopies between
// CANOPY_BOTTOM and CANOPY_TOP, animals above ANIMAL_BASE. All distances are world metres; a cell
// is CELL metres wide and local coordinates run from 0 to CELL.

export const CELL = 4; // metres (D-047)
export const SLAB_DEPTH = 12; // the diorama slab under the map, metres (D-054)
export const SHRUB_TOP = 1.3;
export const CANOPY_Y = 2.0; // tree cube centre
export const CANOPY_BOTTOM = 1.62;
export const ANIMAL_BASE = 2.6;

/** Footprint radius and, for shape height, the ratio to it. */
export const DOT = { max: 0.22, min: 0.12, heightRatio: 0.7 } as const; // squashed sphere
export const CONE = { max: 0.42, min: 0.22, heightRatio: 3.0 } as const; // height = 3 x radius
export const CUBE = { max: 0.7, min: 0.45 } as const; // edge length; rotated, so circle = edge / sqrt 2

/** Models per cell at full cover. */
export const MAX_MODELS = [10, 5, 3] as const; // dots, cones, cubes (on 4x4, 3x3, 2x2 slots)

/** One model in cell-local coordinates: centre (x, z), size (radius or edge), angle. */
export interface Placement {
  x: number;
  z: number;
  size: number;
  angle: number;
}

/** Deterministic hash of (cell, salt) to [0, 1). */
export function rand(cell: number, salt: number): number {
  let h = Math.imul(cell ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** The grid's slot order for a cell: a deterministic shuffle of 0..count-1. */
function order(cell: number, count: number, salt: number): number[] {
  const slots = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(rand(cell, salt + i) * (i + 1));
    [slots[i], slots[j]] = [slots[j] ?? 0, slots[i] ?? 0];
  }
  return slots;
}

/** Place `count` models of footprint radius `radius` in distinct slots of a g x g grid, skipping
 *  slots rejected by `blocked`. The jitter keeps the footprint inside its slot. */
function place(
  cell: number,
  salt: number,
  g: number,
  count: number,
  radius: (k: number) => number,
  size: (k: number) => number,
  blocked: (x: number, z: number, r: number) => boolean = () => false,
): Placement[] {
  const out: Placement[] = [];
  if (count === 0) return out; // most strata of most cells: skip the shuffle
  const slot = CELL / g;
  for (const s of order(cell, g * g, salt)) {
    if (out.length >= count) break;
    const k = out.length;
    const r = radius(k);
    const room = Math.max(0, slot / 2 - r - 0.01); // clearance to the slot edge
    const x = (s % g) * slot + slot / 2 + (rand(cell, salt + 100 + s) * 2 - 1) * room;
    const z = Math.floor(s / g) * slot + slot / 2 + (rand(cell, salt + 200 + s) * 2 - 1) * room;
    if (blocked(x, z, r)) continue;
    out.push({ x, z, size: size(k), angle: rand(cell, salt + 300 + s) * Math.PI * 2 });
  }
  return out;
}

/** Plant models of one cell from the cover (0..1) of each stratum: [dots, cones, cubes]. */
export function plantLayout(cell: number, cover: readonly number[]): Placement[][] {
  const count = (s: 0 | 1 | 2) => {
    const v = cover[s] ?? 0;
    return v < 0.05 ? 0 : Math.max(1, Math.min(MAX_MODELS[s], Math.round(v * MAX_MODELS[s])));
  };
  const grow = (lo: number, hi: number, v: number, k: number, salt: number) =>
    lo + (hi - lo) * v * (0.85 + 0.15 * rand(cell, salt + k));
  const [v0, v1, v2] = [cover[0] ?? 0, cover[1] ?? 0, cover[2] ?? 0];
  const coneR = (k: number) => grow(CONE.min, CONE.max, v1, k, 20);
  const cubeE = (k: number) => grow(CUBE.min, CUBE.max, v2, k, 30);
  const dotR = (k: number) => grow(DOT.min, DOT.max, v0, k, 10);
  const cubes = place(cell, 3000, 2, count(2), (k) => cubeE(k) / Math.SQRT2, cubeE);
  const cones = place(cell, 2000, 3, count(1), coneR, coneR);
  // Dots share the ground with cone bases: skip slots that would touch one.
  const clash = (x: number, z: number, r: number) =>
    cones.some((c) => Math.hypot(c.x - x, c.z - z) < c.size + r + 0.02);
  const dots = place(cell, 1000, 4, count(0), dotR, dotR, clash);
  return [dots, cones, cubes];
}

/** Offsets and scale for `count` animals sharing a cell: a g x g grid, shrinking as they crowd.
 *  `radius` is the largest animal footprint at scale 1. */
export function animalSlots(
  count: number,
  radius: number,
): { x: number; z: number; scale: number }[] {
  const g = Math.max(1, Math.ceil(Math.sqrt(count)));
  const slot = CELL / g;
  const scale = Math.min(1, (slot / 2 - 0.02) / radius);
  return Array.from({ length: count }, (_, k) => ({
    x: (k % g) * slot + slot / 2,
    z: Math.floor(k / g) * slot + slot / 2,
    scale,
  }));
}
