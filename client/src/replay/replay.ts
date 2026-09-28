// Replays exported by the Python prototype (tools/prototype/match.py, export_replay).
// This is the renderer's data source until the WASM worker exists; the renderer only sees
// `Replay` (INSTRUCTIONS §6: the renderer is an adapter over snapshots).

export type Role = "decomposer" | "herbivore" | "predator";

/** One species of the stat sheet (data/species.toml, D-029). */
export interface Species {
  name: string;
  kind: "flora" | "fauna";
  level: number;
  tier: number;
  role: string; // "L1".."L3" for plants, a Role for animals
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

export const REPLAY_VERSION = 2;

export interface ReplayMeta {
  version: number;
  species: Species[];
  counts: number[][][]; // per field frame: [player 1, player 2] counts in species order
  n: number;
  dt: number;
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

const ANIMAL_BYTES = 10; // u32 id, u16 y, u16 x, u8 species, u8 owner

export class Replay {
  readonly meta: ReplayMeta;
  private readonly view: DataView;
  private readonly animalAt: number[] = []; // byte offset of each tick's animal record
  private readonly fieldAt: number[] = []; // byte offset of each field frame

  constructor(meta: ReplayMeta, frames: ArrayBuffer) {
    if (meta.version !== REPLAY_VERSION) {
      throw new Error(
        `replay version ${meta.version}, viewer expects ${REPLAY_VERSION}: npm run proto -- --replay`,
      );
    }
    this.meta = meta;
    this.view = new DataView(frames);
    const cells = meta.n * meta.n;
    let pos = 0;
    for (let tick = 0; tick < meta.ticks; tick++) {
      this.animalAt.push(pos);
      pos += 4 + ANIMAL_BYTES * this.view.getUint32(pos, true);
      if (tick % meta.field_every === 0) {
        this.fieldAt.push(pos);
        pos += 4 * cells;
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

  /** Flora fields of the latest field frame at or before `tick`: owner, then cover of L1..L3
   *  (0..255), one byte per cell each. The arrays view the replay buffer (no copy). */
  fields(tick: number): { frame: number; owner: Uint8Array; cover: Uint8Array[] } {
    const frame = Math.min(
      Math.floor(clampTick(tick, this.meta.ticks) / this.meta.field_every),
      this.fieldAt.length - 1,
    );
    const cells = this.meta.n * this.meta.n;
    const at = this.fieldAt[frame] ?? 0;
    const layer = (k: number) => new Uint8Array(this.view.buffer, at + k * cells, cells);
    return { frame, owner: layer(0), cover: [layer(1), layer(2), layer(3)] };
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
