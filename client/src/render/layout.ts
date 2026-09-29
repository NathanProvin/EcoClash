// Placement of plant models inside a cell (D-033, D-067).
//
// Every shrub and every tree trunk owns a slot of a per-cell grid and stays inside it, so trunks
// and shrub bases never overlap, inside a cell or across cells. Tree crowns are much wider than
// their slot: neighbouring crowns may interpenetrate, at different heights, like a real canopy,
// but trunks stay at least TRUNK_GAP apart so no two crowns merge. A cell's slots are shared
// between the species present, in proportion to their cover, so mixed woods show every species.
// All distances are world metres; a cell is CELL metres wide and local coordinates run from 0 to
// CELL.

export const CELL = 4; // metres (D-047)
export const SLAB_DEPTH = 12; // the diorama slab under the map, metres (D-054)

/** Models per cell at full cover: [herbs (drawn as grass), shrubs, trees]. */
export const MAX_MODELS = [0, 4, 2] as const;
/** Slot grid side per stratum: shrubs on 3 x 3, trees on 2 x 2. */
const GRID = [1, 3, 2] as const;
/** Shrub footprint radius (m), from a young to a full stand. */
export const SHRUB = { min: 0.35, max: 0.65 } as const; // side blobs make a bush wider
/** Tree crown radius and trunk height (m), young to full; trunk radius (m). */
export const TREE = { min: 0.9, max: 1.4, trunkMin: 1.6, trunkMax: 2.6, trunkR: 0.16 } as const;
/** How far a trunk may stray from its slot centre (m): trunks of neighbouring slots stay
 *  TRUNK_GAP apart. */
export const TRUNK_JITTER = 0.25;
export const TRUNK_GAP = CELL / GRID[2] - 2 * TRUNK_JITTER;

/** One model in cell-local coordinates: centre (x, z), footprint radius, angle, the plant
 *  species index (`meta.flora`), and a per-model random value in [0, 1) for variety. */
export interface Placement {
  x: number;
  z: number;
  size: number;
  angle: number;
  species: number;
  seed: number;
}

/** Crown or bush shape per species: width and height scales of the main blob, blob count. */
export interface Form {
  w: number;
  h: number;
  blobs: number;
}

export const FORM: Record<string, Form> = {
  oak: { w: 1.05, h: 0.7, blobs: 3 }, // broad, spreading
  beech: { w: 0.8, h: 1.2, blobs: 2 }, // tall oval
  chestnut: { w: 0.95, h: 0.9, blobs: 3 }, // round, dense
  elder: { w: 1.0, h: 0.75, blobs: 3 }, // loose, spreading
  hazel: { w: 0.85, h: 1.15, blobs: 3 }, // upright, many stems
  hawthorn: { w: 0.9, h: 0.85, blobs: 2 }, // dense, compact
};
const DEFAULT_FORM: Form = { w: 0.9, h: 0.9, blobs: 2 };
export const formOf = (name: string): Form => FORM[name] ?? DEFAULT_FORM;

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

/** `count` model slots shared by species in proportion to their cover (largest remainder; ties
 *  to the earlier species), as a list of species indices. */
export function share(count: number, plants: readonly { species: number; cover: number }[]) {
  const total = plants.reduce((t, p) => t + p.cover, 0);
  if (count === 0 || total <= 0) return [];
  const exact = plants.map((p) => (p.cover / total) * count);
  const got = exact.map(Math.floor);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; got.reduce((t, g) => t + g, 0) < count; k++) {
    const i = order[k % order.length]?.i ?? 0;
    got[i] = (got[i] ?? 0) + 1;
  }
  return plants.flatMap((p, i) => Array<number>(got[i] ?? 0).fill(p.species));
}

/** Plant models of one cell, [shrubs, trees], from the cover (0..1) of each shrub and tree
 *  species present. Sizes grow with the stratum's total cover. */
export function plantLayout(
  cell: number,
  shrubs: readonly { species: number; cover: number }[],
  trees: readonly { species: number; cover: number }[],
): [Placement[], Placement[]] {
  const total = (ps: readonly { cover: number }[]) =>
    Math.min(
      1,
      ps.reduce((t, p) => t + p.cover, 0),
    );
  const count = (s: 1 | 2, v: number) =>
    v < 0.05 ? 0 : Math.max(1, Math.min(MAX_MODELS[s], Math.round(v * MAX_MODELS[s])));
  const grow = (lo: number, hi: number, v: number, k: number, salt: number) =>
    lo + (hi - lo) * v * (0.8 + 0.2 * rand(cell, salt + k));

  const vt = total(trees);
  const treeSpecies = share(count(2, vt), trees);
  const tslot = CELL / GRID[2];
  const treeOut: Placement[] = order(cell, GRID[2] * GRID[2], 3000)
    .slice(0, treeSpecies.length)
    .map((s, k) => ({
      x: (s % GRID[2]) * tslot + tslot / 2 + (rand(cell, 3100 + s) * 2 - 1) * TRUNK_JITTER,
      z:
        Math.floor(s / GRID[2]) * tslot + tslot / 2 + (rand(cell, 3200 + s) * 2 - 1) * TRUNK_JITTER,
      size: grow(TREE.min, TREE.max, vt, k, 30),
      angle: rand(cell, 3300 + s) * Math.PI * 2,
      species: treeSpecies[k] ?? 0,
      seed: rand(cell, 3400 + s),
    }));

  // Shrubs keep clear of trunks; their slots are skipped when too close to one.
  const vs = total(shrubs);
  const shrubSpecies = share(count(1, vs), shrubs);
  const sslot = CELL / GRID[1];
  const shrubOut: Placement[] = [];
  for (const s of order(cell, GRID[1] * GRID[1], 2000)) {
    const k = shrubOut.length;
    if (k >= shrubSpecies.length) break;
    const r = grow(SHRUB.min, SHRUB.max, vs, k, 20);
    const room = Math.max(0, sslot / 2 - r - 0.01);
    const x = (s % GRID[1]) * sslot + sslot / 2 + (rand(cell, 2100 + s) * 2 - 1) * room;
    const z = Math.floor(s / GRID[1]) * sslot + sslot / 2 + (rand(cell, 2200 + s) * 2 - 1) * room;
    if (treeOut.some((t) => Math.hypot(t.x - x, t.z - z) < TREE.trunkR + r)) continue;
    shrubOut.push({
      x,
      z,
      size: r,
      angle: rand(cell, 2300 + s) * Math.PI * 2,
      species: shrubSpecies[k] ?? 0,
      seed: rand(cell, 2400 + s),
    });
  }
  return [shrubOut, treeOut];
}
