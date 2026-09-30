// Placement of plant models inside a cell (D-033, D-067, D-072, D-087).
//
// Model strata: undergrowth clumps (height level 2), shrubs (3), trees (4), and lily pads for the
// aquatic herbs; herbs (level 1) are grass blades (grass.ts). Every cell has fixed model slots
// that never depend on cover, so a model keeps its place from seedling to full size and can grow
// smoothly (growth.ts). Tree trunks sit on a jittered 2 x 2 grid; shrubs and clumps are scattered
// by deterministic dart-throwing, clear of every trunk slot and of each other, so they do not
// line up (pads share the clump slots: they float, clumps stand). Cover decides how many slots are in use (the first ones) and how
// big the models are; the species present share the slots in proportion to their cover, and a
// slot keeps its species while that species still has a share (`assign`), so mixed stands do not
// reshuffle. Tree crowns are wider than their slot: neighbouring crowns may interpenetrate at
// different heights, like a canopy, but trunks stay at least TRUNK_GAP apart so no two crowns
// merge. Distances are world metres; local coordinates run from 0 to CELL.

export const CELL = 4; // metres (D-047)
export const SLAB_DEPTH = 12; // the diorama slab under the map, metres (D-054)

/** Model strata, in slot order. */
export const STRATA = ["low", "shrub", "tree", "pad"] as const;
export type Stratum = (typeof STRATA)[number];
/** Models per cell at full cover, per model stratum (index in STRATA). */
export const MAX_MODELS = [4, 3, 2, 4] as const;

/** The model stratum of a plant: undergrowth, shrub, tree by height level; aquatic herbs float as
 *  pads; land herbs have none (grass). */
export function stratumOf(level: number, aquatic: boolean): number | null {
  if (level === 1) return aquatic ? 3 : null;
  return level - 2;
}
/** Tree trunks on a 2 x 2 grid. */
const TREE_GRID = 2;
/** Shrub footprint radius (m), from a young to a full stand. */
export const SHRUB = { min: 0.35, max: 0.65 } as const; // side blobs make a bush wider
/** Undergrowth clump and lily pad radius (m), young to full. */
export const LOW = { min: 0.28, max: 0.55 } as const;
export const PAD = { min: 0.15, max: 0.35 } as const;
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
/** Clump slots: how many, and their distances (m) from each other and from a trunk slot. */
const LOW_SLOTS = 5;
export const LOW_GAP = 1.25 * LOW.max; // clumps may touch
export const LOW_CLEAR = TREE.trunkR + 0.5 * LOW.max;

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
  willow: { w: 1.25, h: 0.8, blobs: 3 }, // wide, drooping
  ferns: { w: 1.25, h: 0.5, blobs: 3 }, // low spreading fronds
  nettle: { w: 0.6, h: 1.35, blobs: 2 }, // upright stems
  bramble: { w: 1.3, h: 0.6, blobs: 3 }, // sprawling mound
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

/** The fixed slots of a cell per model stratum ([low, shrub, tree, pad]), in fill order. */
export function cellSlots(cell: number): Slot[][] {
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
  // Dart-throwing: up to `count` slots of radius r, `gap` apart, `clearance` from every trunk.
  const darts = (count: number, r: number, gap: number, clearance: number, salt: number) => {
    const out: Slot[] = [];
    for (let d = 0; d < DARTS && out.length < count; d++) {
      const x = r + rand(cell, salt + 2 * d) * (CELL - 2 * r);
      const z = r + rand(cell, salt + 1 + 2 * d) * (CELL - 2 * r);
      const clear = (o: { x: number; z: number }, g: number) => Math.hypot(o.x - x, o.z - z) >= g;
      if (!trees.every((t) => clear(t, clearance))) continue;
      if (!out.every((b) => clear(b, gap))) continue;
      const angle = rand(cell, salt + 300 + d) * Math.PI * 2;
      out.push({ x, z, angle, seed: rand(cell, salt + 400 + d) });
    }
    return out;
  };
  const shrubs = darts(SHRUB_SLOTS, SHRUB.max, SHRUB_GAP, TRUNK_CLEAR, 2000);
  const low = darts(LOW_SLOTS, LOW.max, LOW_GAP, LOW_CLEAR, 4000);
  return [low, shrubs, trees, low];
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

/** Footprint radius range per model stratum. */
const SIZE = [LOW, SHRUB, TREE, PAD] as const;

/** Plant models of one cell per model stratum, from the cover (0..1) of each species present in
 *  it (`strata[i]`, index in STRATA); `prev` holds each stratum's species by slot from the last
 *  layout. Sizes grow with the stratum's total cover. */
export function plantLayout(
  cell: number,
  strata: readonly (readonly { species: number; cover: number }[])[],
  prev: readonly (readonly number[])[] = [],
  slots: Slot[][] = cellSlots(cell),
): Placement[][] {
  return STRATA.map((_, s) => {
    const plants = strata[s] ?? [];
    const v = Math.min(
      1,
      plants.reduce((t, p) => t + p.cover, 0),
    );
    const free = slots[s] ?? [];
    const most = MAX_MODELS[s] ?? 0;
    const want = v < 0.05 ? 0 : Math.max(1, Math.round(v * most));
    const count = Math.min(most, want, free.length);
    const { min: lo, max: hi } = SIZE[s] ?? LOW;
    return assign(count, plants, prev[s]).map((species, slot) => {
      const at = free[slot] as Slot;
      return { ...at, slot, species, size: lo + (hi - lo) * v * (0.8 + 0.2 * at.seed) };
    });
  });
}
