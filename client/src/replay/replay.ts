import type { TerrainFrame } from "../render/terrain";
// Replays exported by the Python prototype (tools/prototype/match.py, export_replay), and the
// `Source` interface the renderer and HUD read: a Replay or a live match (worker/live.ts). The
// renderer only sees a Source (INSTRUCTIONS §6: the renderer is an adapter over snapshots).

export type Role = "decomposer" | "herbivore" | "predator";

/** One species of the stat sheet (data/species.toml, D-029). */
export interface Species {
  name: string;
  kind: "flora" | "fauna";
  /** Tech-tree family (D-087): L1..L4, W; D, H1..H4, HW, P1..P3, PW. */
  family: string;
  /** Plants: height stratum 1..4; animals: 0. */
  level: number;
  tier: number;
  role: string; // "L1".."L4" for plants, a Role for animals
  /** Animals: drawn as a swarm, not a unit (D-065). */
  swarm?: boolean;
  /** Animals: walk, swim, amphibious or fly (D-084). */
  medium?: string;
  habitat: string[];
  eats: string[];
  stats: {
    growth: number;
    spawn_cost: number;
    unlock_cost: number;
    yield: number;
    cap: number;
    effect: string;
  };
}

export const REPLAY_VERSION = 3;

/** Flora fields of one field frame. Arrays view the replay buffer, one byte per cell. */
export interface Fields {
  frame: number;
  owner: Uint8Array; // 0 none, 1 or 2
  soil: Uint8Array; // soil development 0..255
  species: Uint8Array[]; // cover 0..255 per plant species (species-table order)
  cover: Uint8Array[]; // cover 0..255 per height stratum L1..L4 (sum of its species, capped)
  pressure?: Uint8Array; // live only: how hard the non-owner pushes into each cell, 0..255 (D-076)
  lock?: Uint8Array; // live only: per cell, the barred player and seconds left (D-098)
}

/** What stands on one cell at one tick (the cell panel). */
export interface CellInfo {
  row: number;
  col: number;
  owner: number;
  soil: number; // 0..1
  /** Ground class (terrain.ts GROUND; land when unknown). */
  ground: number;
  /** Cover of each height stratum, herbs to trees, 0..1. */
  strata: number[];
  /** How hard the other player pushes into the cell, 0..1 (live only). */
  push: number;
  /** The player barred from taking the cell back, and for how long (D-098; live only). */
  lock: { player: number; s: number } | null;
  plants: { name: string; level: number; cover: number }[]; // cover 0..1
  animals: { name: string; owner: number; count: number }[];
}

export interface ReplayMeta {
  version: number;
  species: Species[];
  counts: number[][][]; // per field frame: [player 1, player 2] counts in species order
  n: number;
  dt: number;
  /** Seconds of ecology per real second (D-069); replays of the prototype before it: 1. */
  pace?: number;
  ticks: number;
  field_every: number;
  builds: string[];
  flora: { names: string[]; level: number[] };
  fauna: { names: string[]; role: Role[] };
  series: Record<string, number[]>;
  log: { t_s: number; player: number; what: string; count: number }[];
}

/** One animal at one tick. */
export interface Animal {
  id: number;
  y: number;
  x: number;
  species: number;
  owner: number;
}

/** What the renderer and HUD read, from a replay file or from the live worker. */
export type Source = Pick<
  Replay,
  "meta" | "animals" | "fields" | "cell" | "counts" | "maxAnimals" | "seriesIndex"
> & {
  /** Species cards a player has unlocked (live matches; replays rebuild it from their log). */
  unlocked?: (player: number) => Set<string>;
  /** The generated map (live matches, D-083); replays are flat. */
  terrain?: TerrainFrame;
  /** When an animal was dropped by a spawn order (ms, performance.now), for its parachute. */
  droppedAt?: (id: number) => number | undefined;
};

const ANIMAL_BYTES = 10; // u32 id, u16 y, u16 x, u8 species, u8 owner

export class Replay {
  readonly meta: ReplayMeta;
  private readonly view: DataView;
  private readonly animalAt: number[] = []; // byte offset of each tick's animal record
  private readonly fieldAt: number[] = []; // byte offset of each field frame
  private readonly layers: number; // owner, soil, then one per plant species
  private cached: Fields | undefined;

  constructor(meta: ReplayMeta, frames: ArrayBuffer) {
    if (meta.version !== REPLAY_VERSION) {
      throw new Error(
        `replay version ${meta.version}, viewer expects ${REPLAY_VERSION}: npm run proto -- --replay`,
      );
    }
    this.meta = meta;
    this.view = new DataView(frames);
    this.layers = 2 + meta.flora.names.length;
    const cells = meta.n * meta.n;
    let pos = 0;
    for (let tick = 0; tick < meta.ticks; tick++) {
      this.animalAt.push(pos);
      pos += 4 + ANIMAL_BYTES * this.view.getUint32(pos, true);
      if (tick % meta.field_every === 0) {
        this.fieldAt.push(pos);
        pos += this.layers * cells;
      }
    }
    if (pos !== frames.byteLength) {
      throw new Error(`replay: parsed ${pos} bytes, file has ${frames.byteLength}`);
    }
  }

  /** Animals at a tick (clamped to the replay). */
  animals(tick: number): Animal[] {
    const at = this.animalAt[clampTick(tick, this.meta.ticks)] ?? 0;
    const count = this.view.getUint32(at, true);
    const out: Animal[] = [];
    for (let k = 0, p = at + 4; k < count; k++, p += ANIMAL_BYTES) {
      out.push({
        id: this.view.getUint32(p, true),
        y: this.view.getUint16(p + 4, true),
        x: this.view.getUint16(p + 6, true),
        species: this.view.getUint8(p + 8),
        owner: this.view.getUint8(p + 9),
      });
    }
    return out;
  }

  /** Flora fields of the latest field frame at or before `tick` (cached per frame). */
  fields(tick: number): Fields {
    const frame = Math.min(
      Math.floor(clampTick(tick, this.meta.ticks) / this.meta.field_every),
      this.fieldAt.length - 1,
    );
    if (this.cached?.frame === frame) return this.cached;
    const cells = this.meta.n * this.meta.n;
    const at = this.fieldAt[frame] ?? 0;
    this.cached = decodeFields(
      frame,
      new Uint8Array(this.view.buffer, at, this.layers * cells),
      this.meta,
    );
    return this.cached;
  }

  cell(tick: number, row: number, col: number): CellInfo {
    return cellAt(this, tick, row, col);
  }

  /** Cells per plant species / animals per animal species for a player (1 or 2), from the latest
   *  field frame at or before `tick`, in species-table order. */
  counts(tick: number, player: number): number[] {
    const frame = this.fields(tick).frame;
    return this.meta.counts[frame]?.[player - 1] ?? [];
  }

  /** The largest animal count of any tick (instance buffer capacity). */
  maxAnimals(): number {
    return this.animalAt.reduce((m, at) => Math.max(m, this.view.getUint32(at, true)), 0);
  }

  /** Index into `meta.series` for the state at a tick (series row k is the state after tick
   *  k + 1, i.e. at time (k + 1) * dt). */
  seriesIndex(tick: number): number {
    return Math.max(0, Math.min(Math.floor(tick) - 1, (this.meta.series["t_s"]?.length ?? 1) - 1));
  }
}

/** Split one field frame (owner, soil, cover per plant species; n*n bytes each) into layers,
 *  plus the cover of each stratum (sum of its species, capped at 255). */
export function decodeFields(
  frame: number,
  bytes: Uint8Array,
  meta: Pick<ReplayMeta, "n" | "flora">,
): Fields {
  const cells = meta.n * meta.n;
  const layer = (k: number) => bytes.subarray(k * cells, (k + 1) * cells);
  const species = meta.flora.names.map((_, i) => layer(2 + i));
  const cover = [1, 2, 3, 4].map((level) => {
    const sum = new Uint8Array(cells);
    species.forEach((c, i) => {
      if (meta.flora.level[i] !== level) return;
      for (let k = 0; k < cells; k++) sum[k] = Math.min(255, (sum[k] ?? 0) + (c[k] ?? 0));
    });
    return sum;
  });
  return { frame, owner: layer(0), soil: layer(1), species, cover };
}

/** Plants (cover per species) and animals (count per species and owner) on one cell. */
export function cellAt(
  src: Pick<Source, "meta" | "fields" | "animals" | "terrain">,
  tick: number,
  row: number,
  col: number,
): CellInfo {
  const f = src.fields(tick);
  const k = row * src.meta.n + col;
  const { names, level } = src.meta.flora;
  const plants = names
    .map((name, i) => ({ name, level: level[i] ?? 1, cover: (f.species[i]?.[k] ?? 0) / 255 }))
    .filter((p) => p.cover > 0);
  const herd: Record<string, { name: string; owner: number; count: number }> = {};
  for (const a of src.animals(Math.round(tick))) {
    if (Math.round(a.y) !== row || Math.round(a.x) !== col) continue; // live: sub-cell
    const name = src.meta.fauna.names[a.species] ?? "?";
    const key = `${name}:${a.owner}`;
    herd[key] = { name, owner: a.owner, count: (herd[key]?.count ?? 0) + 1 };
  }
  return {
    row,
    col,
    owner: f.owner[k] ?? 0,
    soil: (f.soil[k] ?? 0) / 255,
    ground: src.terrain?.ground[k] ?? 0,
    strata: f.cover.map((c) => (c[k] ?? 0) / 255),
    push: (f.pressure?.[k] ?? 0) / 255,
    lock: f.lock?.[2 * k] ? { player: f.lock[2 * k] ?? 0, s: f.lock[2 * k + 1] ?? 0 } : null,
    plants,
    animals: Object.values(herd),
  };
}

export function clampTick(tick: number, ticks: number): number {
  return Math.max(0, Math.min(Math.floor(tick), ticks - 1));
}

/** Animal positions at a fractional tick: linear interpolation between the two surrounding ticks,
 *  matched by id. Newborns appear at their position, the dead vanish (INSTRUCTIONS §6). */
export function interpolate(a: Animal[], b: Animal[], f: number): Animal[] {
  const next = new Map(b.map((x) => [x.id, x]));
  const prev = new Set(a.map((x) => x.id));
  const moved = a.flatMap((x) => {
    const y = next.get(x.id);
    if (!y) return f < 0.5 ? [x] : [];
    return [{ ...x, y: x.y + (y.y - x.y) * f, x: x.x + (y.x - x.x) * f }];
  });
  return f < 0.5 ? moved : moved.concat(b.filter((y) => !prev.has(y.id)));
}

/** Fetch a replay folder (replay.json + frames.bin.gz). Some servers (Vite dev included) send
 *  .gz files with Content-Encoding: gzip, so the browser has already inflated them; otherwise
 *  the native DecompressionStream does it. The gzip magic bytes tell which case we are in. */
export async function loadReplay(base: string): Promise<Replay> {
  const [meta, raw] = await Promise.all([
    fetch(`${base}/replay.json`).then((r) => r.json() as Promise<ReplayMeta>),
    fetch(`${base}/frames.bin.gz`).then((r) => {
      if (!r.ok) throw new Error(`replay: cannot load ${base}/frames.bin.gz (${r.status})`);
      return r.arrayBuffer();
    }),
  ]);
  return new Replay(meta, isGzip(raw) ? await gunzip(raw) : raw);
}

export function isGzip(buf: ArrayBuffer): boolean {
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  return b[0] === 0x1f && b[1] === 0x8b;
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}
