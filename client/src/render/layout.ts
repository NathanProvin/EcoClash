// Placement of plant models inside a cell (D-033, D-067, D-072).
//
// Every cell has fixed model slots that never depend on cover, so a model keeps its place from
// seedling to full size and can grow smoothly (growth.ts). Tree trunks sit on a jittered 2 x 2
// grid; shrubs are scattered by deterministic dart-throwing, clear of every trunk slot and of each
// other, so they do not line up. Cover decides how many slots are in use (the first ones) and how
// big the models are; the species present share the slots in proportion to their cover, and a
// slot keeps its species while that species still has a share (`assign`), so mixed stands do not
// reshuffle. Tree crowns are wider than their slot: neighbouring crowns may interpenetrate at
// different heights, like a canopy, but trunks stay at least TRUNK_GAP apart so no two crowns
// merge. Distances are world metres; local coordinates run from 0 to CELL.

export const CELL = 4; // metres (D-047)
export const SLAB_DEPTH = 12; // the diorama slab under the map, metres (D-054)

/** Models per cell at full cover: [herbs (drawn as grass), shrubs, trees]. */
export const MAX_MODELS = [0, 3, 2] as const;
/** Tree trunks on a 2 x 2 grid. */
const TREE_GRID = 2;
/** Shrub footprint radius (m), from a young to a full stand. */
export const SHRUB = { min: 0.35, max: 0.65 } as const; // side blobs make a bush wider
/** Tree crown radius and trunk height (m), young to full; trunk radius (m). */
export const TREE = { min: 0.9, max: 1.4, trunkMin: 1.6, trunkMax: 2.6, trunkR: 0.16 } as const;
/** How far a trunk may stray from its slot centre (m): trunks of neighbouring slots stay
 *  TRUNK_GAP apart. */
export const TRUNK_JITTER = 0.25;
export const TRUNK_GAP = CELL / TREE_GRID - 2 * TRUNK_JITTER;
/** Shrub slots per cell (a few spares beyond MAX_MODELS, in case dart-throwing places fewer),
 *  and the darts thrown to find them. */
const SHRUB_SLOTS = 4;
const DARTS = 64;
/** Shrub slots keep these distances (m): between two shrub centres (bases may touch, like a
 *  clump), and from a trunk slot (the rounded bush may reach under a crown, not over a trunk). */
export const SHRUB_GAP = 1.6 * SHRUB.max;
export const TRUNK_CLEAR = TREE.trunkR + 0.6 * SHRUB.max;

/** A fixed model slot of a cell: centre (x, z), angle, a random value in [0, 1) for variety. */
export interface Slot {
  x: number;
  z: number;
  angle: number;
  seed: number;
}

/** One model in cell-local coordinates: its slot, footprint radius and plant species index
 *  (`meta.flora`). */
export interface Placement extends Slot {
  slot: number;
  size: number;
  species: number;
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

/** The fixed slots of a cell, [shrubs, trees], in the order they fill up. */
export function cellSlots(cell: number): [Slot[], Slot[]] {
  const side = CELL / TREE_GRID;
  const trees: Slot[] = [];
  const grid = Array.from({ length: TREE_GRID * TREE_GRID }, (_, i) => i);
  for (let i = grid.length - 1; i > 0; i--) {
    const j = Math.floor(rand(cell, 3000 + i) * (i + 1)); // shuffled fill order
    [grid[i], grid[j]] = [grid[j] ?? 0, grid[i] ?? 0];
  }
  for (const s of grid) {
    const jitter = (salt: number) => (rand(cell, salt + s) * 2 - 1) * TRUNK_JITTER;
    trees.push({
      x: (s % TREE_GRID) * side + side / 2 + jitter(3100),
      z: Math.floor(s / TREE_GRID) * side + side / 2 + jitter(3200),
      angle: rand(cell, 3300 + s) * Math.PI * 2,
      seed: rand(cell, 3400 + s),
    });
  }
  const shrubs: Slot[] = [];
  const r = SHRUB.max;
  for (let d = 0; d < DARTS && shrubs.length < SHRUB_SLOTS; d++) {
    const x = r + rand(cell, 2000 + 2 * d) * (CELL - 2 * r);
    const z = r + rand(cell, 2001 + 2 * d) * (CELL - 2 * r);
    const clear = (o: { x: number; z: number }, gap: number) => Math.hypot(o.x - x, o.z - z) >= gap;
    if (!trees.every((t) => clear(t, TRUNK_CLEAR))) continue;
    if (!shrubs.every((b) => clear(b, SHRUB_GAP))) continue;
    shrubs.push({ x, z, angle: rand(cell, 2300 + d) * Math.PI * 2, seed: rand(cell, 2400 + d) });
  }
  return [shrubs, trees];
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

/** Species of the first `count` slots: each slot keeps its previous species (`prev`, by slot)
 *  while that species still has a share; only the rest is reassigned, in slot order. */
export function assign(
  count: number,
  plants: readonly { species: number; cover: number }[],
  prev: readonly number[] = [],
): number[] {
  const quota = new Map<number, number>();
  for (const s of share(count, plants)) quota.set(s, (quota.get(s) ?? 0) + 1);
  const out = Array<number>(count).fill(-1);
  for (let j = 0; j < count; j++) {
    const s = prev[j] ?? -1;
    if ((quota.get(s) ?? 0) > 0) {
      out[j] = s;
      quota.set(s, (quota.get(s) ?? 0) - 1);
    }
  }
  const rest = [...quota].flatMap(([s, n]) => Array<number>(n).fill(s));
  return out.map((s) => (s >= 0 ? s : (rest.shift() ?? -1)));
}

/** Plant models of one cell, [shrubs, trees], from the cover (0..1) of each shrub and tree
 *  species present; `prev` holds each stratum's species by slot from the last layout. Sizes grow
 *  with the stratum's total cover. */
export function plantLayout(
  cell: number,
  shrubs: readonly { species: number; cover: number }[],
  trees: readonly { species: number; cover: number }[],
  prev: readonly [readonly number[], readonly number[]] = [[], []],
  slots: [Slot[], Slot[]] = cellSlots(cell),
): [Placement[], Placement[]] {
  const models = (s: 1 | 2, plants: typeof shrubs, [lo, hi]: [number, number]) => {
    const v = Math.min(
      1,
      plants.reduce((t, p) => t + p.cover, 0),
    );
    const free = slots[s - 1] ?? [];
    const want = v < 0.05 ? 0 : Math.max(1, Math.round(v * MAX_MODELS[s]));
    const count = Math.min(MAX_MODELS[s], want, free.length);
    return assign(count, plants, prev[s - 1]).map((species, slot) => {
      const at = free[slot] as Slot;
      return { ...at, slot, species, size: lo + (hi - lo) * v * (0.8 + 0.2 * at.seed) };
    });
  };
  return [models(1, shrubs, [SHRUB.min, SHRUB.max]), models(2, trees, [TREE.min, TREE.max])];
}
