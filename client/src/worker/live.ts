// Main-thread side of the live match: owns the sim worker (sim.worker.ts) and exposes its latest
// snapshot as a `Source`, so the viewer and HUD draw it like a replay. Plants only for now:
// sim-core has no animals until M3.

import {
  cellAt,
  decodeFields,
  REPLAY_VERSION,
  type Animal,
  type CellInfo,
  type Fields,
  type ReplayMeta,
  type Source,
  type Species,
} from "../replay/replay";

export type ToWorker =
  | { type: "start"; seed: number; size: number }
  | { type: "pause"; paused: boolean }
  | { type: "speed"; speed: number }
  | { type: "command"; player: 1 | 2; payload: object };

export type ToMain =
  | {
      type: "ready";
      species: string;
      n: number;
      tickHz: number;
      plantRadius: number;
      balanceHash: string;
    }
  | { type: "tick"; tick: number; hash: string; ms: number }
  | { type: "fields"; tick: number; frame: ArrayBuffer; bank: number[]; income: number[] }
  | { type: "error"; message: string };

export class Live implements Source {
  readonly meta: ReplayMeta;
  tick = 0;
  hash = "";
  /** Sim time per tick in ms, smoothed (the HUD shows it; budget: INSTRUCTIONS §5.5). */
  simMs = 0;
  error = "";
  readonly plantRadius: number;
  private current: Fields;
  private census: number[][] = [[], []]; // cells per plant species, per player, current frame

  private constructor(
    private readonly worker: Worker,
    ready: Extract<ToMain, { type: "ready" }>,
  ) {
    const species = JSON.parse(ready.species) as Species[];
    this.plantRadius = ready.plantRadius;
    this.meta = {
      version: REPLAY_VERSION,
      species,
      counts: [],
      n: ready.n,
      dt: 1 / ready.tickHz,
      ticks: 1,
      field_every: 1,
      builds: [],
      flora: { names: species.map((s) => s.name), level: species.map((s) => s.level) },
      fauna: { names: [], role: [] },
      series: {},
      log: [],
    };
    this.current = this.decode(0, new Uint8Array((2 + species.length) * ready.n * ready.n));
    worker.onmessage = (e: MessageEvent<ToMain>) => this.receive(e.data);
  }

  /** Start a match in a new worker: a bare map of `size` cells a side (0 = balance grid size). */
  static start(seed: number, size: number): Promise<Live> {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ToMain>) => {
        if (e.data.type === "ready") resolve(new Live(worker, e.data));
        else if (e.data.type === "error") reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(`sim worker: ${e.message}`));
      worker.postMessage({ type: "start", seed, size } satisfies ToWorker);
    });
  }

  send(m: ToWorker): void {
    this.worker.postMessage(m);
  }

  /** Order a plant disc (`plantRadius`) of one species around a cell. The sim plants only where
   *  it may (free or own cells, suitable soil, under the species cap). */
  plant(player: 1 | 2, species: string, row: number, col: number): void {
    const radius = this.plantRadius;
    this.send({ type: "command", player, payload: { type: "plant", species, row, col, radius } });
  }

  dispose(): void {
    this.worker.terminate();
  }

  private receive(m: ToMain) {
    if (m.type === "tick") {
      this.tick = m.tick;
      this.hash = m.hash;
      this.meta.ticks = m.tick + 1;
      this.simMs = this.simMs ? this.simMs * 0.9 + m.ms * 0.1 : m.ms;
    } else if (m.type === "fields") {
      this.current = this.decode(this.current.frame + 1, new Uint8Array(m.frame), m);
    } else if (m.type === "error") {
      this.error = m.message;
    }
  }

  /** Decode a frame, refresh the per-player census, and append a row to the HUD series. */
  private decode(
    frame: number,
    bytes: Uint8Array,
    points: { bank: number[]; income: number[] } = { bank: [0, 0], income: [0, 0] },
  ): Fields {
    const f = decodeFields(frame, bytes, this.meta);
    const cells = this.meta.n * this.meta.n;
    const owned = [0, 0, 0];
    const census = [0, 1, 2].map(() => new Array<number>(f.species.length).fill(0));
    for (let k = 0; k < cells; k++) {
      const o = f.owner[k] ?? 0;
      const row = census[o];
      if (!o || !row) continue;
      owned[o] = (owned[o] ?? 0) + 1;
      f.species.forEach((c, i) => {
        if (c[k]) row[i] = (row[i] ?? 0) + 1;
      });
    }
    for (const p of [1, 2]) {
      const row = census[p] ?? [];
      this.census[p - 1] = row;
      (this.meta.series[`territory_p${p}`] ??= []).push((owned[p] ?? 0) / cells);
      (this.meta.series[`species_p${p}`] ??= []).push(row.filter((c) => c > 0).length);
      (this.meta.series[`bank_p${p}`] ??= []).push(points.bank[p - 1] ?? 0);
      (this.meta.series[`yield_p${p}`] ??= []).push(points.income[p - 1] ?? 0);
    }
    return f;
  }

  animals(): Animal[] {
    return [];
  }

  fields(): Fields {
    return this.current;
  }

  cell(tick: number, row: number, col: number): CellInfo {
    return cellAt(this, tick, row, col);
  }

  counts(_tick: number, player: number): number[] {
    return this.census[player - 1] ?? [];
  }

  maxAnimals(): number {
    return 0;
  }

  seriesIndex(): number {
    return this.current.frame;
  }
}
