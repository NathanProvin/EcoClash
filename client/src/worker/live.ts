// Main-thread side of the live match: owns the sim worker (sim.worker.ts) and exposes its latest
// snapshot as a `Source`, so the viewer and HUD draw it like a replay. Plants come with each flora
// tick; animals with every tick, and are interpolated between the last two frames.

import type { TerrainFrame } from "../render/terrain";
import {
  cellAt,
  decodeFields,
  REPLAY_VERSION,
  type Animal,
  type CellInfo,
  type Fields,
  type ReplayMeta,
  type Role,
  type Source,
  type Species,
} from "../replay/replay";

export type ToWorker =
  | {
      type: "start";
      seed: number;
      size: number;
      sandbox: boolean;
      bot: string;
      relay?: string; // a lockstep relay's URL (D-062)
    }
  | { type: "pause"; paused: boolean }
  | { type: "speed"; speed: number }
  | { type: "command"; player: 1 | 2; payload: object };

export type ToMain =
  | {
      type: "ready";
      me: number; // the player this client commands (the relay assigns it)
      species: string;
      n: number;
      tickHz: number;
      pace: number;
      plantRadius: number;
      dropRadius: number;
      victory: number;
      timeLimitS: number;
      maxAgents: number;
      balanceHash: string;
      terrain: ArrayBuffer; // elevation (0..255) then ground class, n * n bytes each
      reliefM: number;
    }
  | {
      type: "tick";
      tick: number;
      hash: string;
      ms: number;
      agents: ArrayBuffer;
      unlocked: number[][]; // per player, one flag per species (species-table order)
      result: string; // the verdict as JSON once the match is decided, else ""
      stalled: boolean; // relayed: waiting for the other player's turn
      drops: number[]; // animals just dropped by spawn commands: flat (first id, count) pairs
    }
  | {
      type: "fields";
      tick: number;
      frame: ArrayBuffer;
      pressure: ArrayBuffer;
      lock: ArrayBuffer;
      bank: number[];
      income: number[];
      standing: number[];
    }
  | { type: "notice"; notices: { player: number; text: string }[] }
  | { type: "net"; event: "desync" | "left"; tick: number }
  | { type: "error"; message: string };

/** How long a dropped animal is remembered, for its parachute (ms; the fall is shorter). */
const DROP_MEMORY_MS = 5000;

/** Why an order did nothing, shown for a few seconds. */
export interface Notice {
  player: number;
  text: string;
  at: number; // performance.now()
}

/** The animal record of `Fauna::frame` (sim-core): u32 count, then u32 id, u16 y, u16 x (1/256
 *  cell), u8 species, u8 owner per animal, little endian. */
export function decodeAgents(buf: ArrayBuffer): Animal[] {
  const v = new DataView(buf);
  const out: Animal[] = [];
  for (let k = 0, p = 4; k < v.getUint32(0, true); k++, p += 10) {
    out.push({
      id: v.getUint32(p, true),
      y: v.getUint16(p + 4, true) / 256,
      x: v.getUint16(p + 6, true) / 256,
      species: v.getUint8(p + 8),
      owner: v.getUint8(p + 9),
    });
  }
  return out;
}

/** How a live match ended (sim-core `Outcome`): winner 0 is a draw. */
export interface Outcome {
  winner: number;
  reason: string;
  tick: number;
}

export class Live implements Source {
  readonly meta: ReplayMeta;
  tick = 0;
  hash = "";
  /** Sim time per tick in ms, smoothed (the HUD shows it; budget: INSTRUCTIONS §5.5). */
  simMs = 0;
  error = "";
  notices: Notice[] = [];
  /** The player this client commands (2 when a relay seats it second). */
  readonly me: 1 | 2;
  /** Relayed: waiting for the other player's turn. */
  stalled = false;
  /** Relayed: what went wrong with the link, for the HUD. */
  netProblem = "";
  result: Outcome | null = null;
  readonly plantRadius: number;
  /** Cells around the click where an animal dropped off your land lands (D-061). */
  readonly dropRadius: number;
  /** The generated map (D-083), for the renderer. */
  readonly terrain: TerrainFrame;
  /** Share of the map that wins, and the match length (s): for the "victory near" alerts. */
  readonly victory: number;
  readonly timeLimitS: number;
  private readonly maxAgents: number;
  private current: Fields;
  private flora: number[][] = [[], []]; // cells per plant species, per player, current frame
  private unlockedFlags: number[][] = [[], []];
  private prev = { tick: 0, at: 0, animals: [] as Animal[] };
  private cur = { tick: 0, at: 0, animals: [] as Animal[] };

  private constructor(
    private readonly worker: Worker,
    ready: Extract<ToMain, { type: "ready" }>,
  ) {
    const species = JSON.parse(ready.species) as Species[];
    const plants = species.filter((s) => s.kind === "flora");
    const animals = species.filter((s) => s.kind === "fauna");
    this.plantRadius = ready.plantRadius;
    this.dropRadius = ready.dropRadius;
    const map = new Uint8Array(ready.terrain);
    const cells = ready.n * ready.n;
    this.terrain = {
      elevation: map.subarray(0, cells),
      ground: map.subarray(cells, 2 * cells),
      reliefM: ready.reliefM,
    };
    this.victory = ready.victory;
    this.timeLimitS = ready.timeLimitS;
    this.me = ready.me === 2 ? 2 : 1;
    this.maxAgents = ready.maxAgents;
    this.meta = {
      version: REPLAY_VERSION,
      species,
      counts: [],
      n: ready.n,
      dt: 1 / ready.tickHz,
      pace: ready.pace,
      ticks: 1,
      field_every: 1,
      builds: [],
      flora: { names: plants.map((s) => s.name), level: plants.map((s) => s.level) },
      fauna: { names: animals.map((s) => s.name), role: animals.map((s) => s.role as Role) },
      series: {},
      log: [],
    };
    this.current = this.decode(0, new Uint8Array((2 + plants.length) * ready.n * ready.n));
    worker.onmessage = (e: MessageEvent<ToMain>) => this.receive(e.data);
  }

  /** Start a match in a new worker: a bare map of `size` cells a side (0 = balance grid size).
   *  A sandbox match has every species unlocked and free (D-058). `bot` is the P2 opponent's level
   *  ("easy", "normal", "hard"), or "none" for an idle P2 (D-060). With a `relay` URL, the match
   *  is a lockstep with another client: it starts once both have joined (D-062). */
  static start(
    seed: number,
    size: number,
    sandbox = false,
    bot = "none",
    relay?: string,
  ): Promise<Live> {
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<ToMain>) => {
        if (e.data.type === "ready") resolve(new Live(worker, e.data));
        else if (e.data.type === "error") reject(new Error(e.data.message));
      };
      worker.onerror = (e) => reject(new Error(`sim worker: ${e.message}`));
      worker.postMessage({ type: "start", seed, size, sandbox, bot, relay } satisfies ToWorker);
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

  /** Order one card of an animal species near a cell (gamerules §6.3: the sim decides where it
   *  lands, or says why it cannot come). */
  spawn(player: 1 | 2, species: string, row: number, col: number): void {
    this.send({ type: "command", player, payload: { type: "spawn", species, row, col } });
  }

  /** Unlock a species card (gamerules §4); the sim refuses it, with a notice, if not allowed. */
  unlock(player: 1 | 2, species: string): void {
    this.send({ type: "command", player, payload: { type: "unlock", species } });
  }

  /** Species cards a player has unlocked, as the sim last reported. */
  unlocked(player: number): Set<string> {
    const flags = this.unlockedFlags[player - 1] ?? [];
    return new Set(this.meta.species.filter((_, i) => flags[i]).map((s) => s.name));
  }

  /** Give own animals an order (gamerules §9): move to a cell, attack-move to it, or stop. */
  order(
    player: 1 | 2,
    ids: number[],
    kind: "move" | "attack" | "stop",
    row: number,
    col: number,
  ): void {
    this.send({ type: "command", player, payload: { type: "order", ids, kind, row, col } });
  }

  /** The tick to draw at time `now` (ms): between the last two animal frames, so animals glide. */
  renderTick(now: number): number {
    const period = Math.max(this.cur.at - this.prev.at, 1);
    return this.cur.tick - 1 + Math.min(Math.max((now - this.cur.at) / period, 0), 1);
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
      this.prev = this.cur;
      this.cur = { tick: m.tick, at: performance.now(), animals: decodeAgents(m.agents) };
      this.unlockedFlags = m.unlocked;
      this.stalled = m.stalled;
      this.noteDrops(m.drops, this.cur.at);
      if (m.result && !this.result) this.result = JSON.parse(m.result) as Outcome;
    } else if (m.type === "fields") {
      this.current = this.decode(this.current.frame + 1, new Uint8Array(m.frame), m);
      this.current.pressure = new Uint8Array(m.pressure);
      this.current.lock = new Uint8Array(m.lock);
    } else if (m.type === "notice") {
      const at = performance.now();
      this.notices = [...this.notices, ...m.notices.map((n) => ({ ...n, at }))].slice(-4);
    } else if (m.type === "net") {
      this.netProblem =
        m.event === "desync"
          ? `Desync at tick ${m.tick}: the two simulations disagree. The match is void.`
          : "The other player left the match.";
    } else if (m.type === "error") {
      this.error = m.message;
    }
  }

  /** When each recently dropped animal landed on the map (ms, performance.now), by id (D-080). */
  private readonly dropped = new Map<number, number>();

  private noteDrops(pairs: readonly number[], at: number): void {
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const [first, count] = [pairs[i] ?? 0, pairs[i + 1] ?? 0];
      for (let id = first; id < first + count; id++) this.dropped.set(id, at);
    }
    for (const [id, t] of this.dropped) if (at - t > DROP_MEMORY_MS) this.dropped.delete(id);
  }

  /** When animal `id` was dropped (ms, performance.now), if it was dropped a moment ago. */
  droppedAt(id: number): number | undefined {
    return this.dropped.get(id);
  }

  /** Decode a frame, refresh the per-player plant census, and append a row to the HUD series. */
  private decode(
    frame: number,
    bytes: Uint8Array,
    points: { bank: number[]; income: number[]; standing?: number[]; tick?: number } = {
      bank: [0, 0],
      income: [0, 0],
    },
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
    (this.meta.series["t_s"] ??= []).push((points.tick ?? 0) * this.meta.dt);
    for (const p of [1, 2]) {
      this.flora[p - 1] = census[p] ?? [];
      const alive = this.counts(0, p).filter((c) => c > 0).length;
      (this.meta.series[`territory_p${p}`] ??= []).push((owned[p] ?? 0) / cells);
      (this.meta.series[`species_p${p}`] ??= []).push(alive);
      (this.meta.series[`bank_p${p}`] ??= []).push(points.bank[p - 1] ?? 0);
      (this.meta.series[`yield_p${p}`] ??= []).push(points.income[p - 1] ?? 0);
      (this.meta.series[`standing_p${p}`] ??= []).push(points.standing?.[p - 1] ?? 0);
    }
    return f;
  }

  /** Animals at a tick: the latest frame from its tick on, the one before earlier. */
  animals(tick: number): Animal[] {
    return tick >= this.cur.tick ? this.cur.animals : this.prev.animals;
  }

  fields(): Fields {
    return this.current;
  }

  cell(tick: number, row: number, col: number): CellInfo {
    return cellAt(this, tick, row, col);
  }

  /** Cells per plant species, then animals per animal species, in species-table order. */
  counts(_tick: number, player: number): number[] {
    const fauna = new Array<number>(this.meta.fauna.names.length).fill(0);
    for (const a of this.cur.animals) {
      if (a.owner === player) fauna[a.species] = (fauna[a.species] ?? 0) + 1;
    }
    return [...(this.flora[player - 1] ?? []), ...fauna];
  }

  maxAnimals(): number {
    return this.maxAgents;
  }

  seriesIndex(): number {
    return this.current.frame;
  }
}
