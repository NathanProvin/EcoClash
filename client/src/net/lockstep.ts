// Deterministic lockstep, client side (INSTRUCTIONS §10, ROADMAP M3.5; D-062). Pure logic, no I/O:
// the browser worker and the headless Node test both drive it (erasable TypeScript only, so Node
// can run it directly).
//
// Tick t runs only once the relay's bundle for t (every player's commands for t) is here. After
// running tick t, a client sends its turn for tick t + delay: the commands its player issued
// meanwhile (input delay). The first `delay` turns are sent empty at start. Every `hashEvery`
// ticks it reports its state hash; the relay compares them (desync detection).

/** What the lockstep drives: the sim-wasm `Sim`, or a fake in tests. */
export interface SimLike {
  readonly tick: number;
  submit(command: string): boolean;
  step(): string;
}

/** Client -> relay. The first message is `hello` (D-219): the host's sets the seed and map size;
 *  a guest with another build or balance hash is refused (the socket closes with code 4000). */
export type ToRelay =
  | { type: "hello"; build: string; balance: string; seed?: number; size?: number }
  | { type: "turn"; tick: number; payloads: object[] }
  | { type: "hash"; tick: number; hash: string };

/** Relay -> client. */
export type FromRelay =
  | { type: "start"; seed: number; size: number; player: number; delay: number; hashEvery: number }
  | { type: "bundle"; tick: number; turns: { player: number; payloads: object[] }[] }
  | { type: "desync"; tick: number }
  | { type: "left"; player: number };

export class Lockstep {
  readonly player: number;
  readonly delay: number;
  private readonly sim: SimLike;
  private readonly hashEvery: number;
  private readonly send: (m: ToRelay) => void;
  private readonly bundles = new Map<number, { player: number; payloads: object[] }[]>();
  private pending: object[] = [];

  constructor(
    sim: SimLike,
    start: { player: number; delay: number; hashEvery: number },
    send: (m: ToRelay) => void,
  ) {
    this.sim = sim;
    this.player = start.player;
    this.delay = start.delay;
    this.hashEvery = start.hashEvery;
    this.send = send;
    for (let t = sim.tick; t < sim.tick + this.delay; t++)
      send({ type: "turn", tick: t, payloads: [] });
  }

  /** A command of this client's player, for the next turn it sends. */
  queue(payload: object): void {
    this.pending.push(payload);
  }

  /** Store a bundle from the relay. */
  receive(bundle: Extract<FromRelay, { type: "bundle" }>): void {
    this.bundles.set(bundle.tick, bundle.turns);
  }

  /** True while the next tick's bundle has not arrived: the sim must wait. */
  get stalled(): boolean {
    return !this.bundles.has(this.sim.tick);
  }

  /** Run up to `max` ticks whose bundles are here. Returns the hashes of the ticks run. */
  advance(max: number): string[] {
    const hashes: string[] = [];
    while (hashes.length < max && !this.stalled) {
      const t = this.sim.tick;
      for (const turn of this.bundles.get(t) ?? []) {
        // Every client submits the same commands with the same (tick, player, seq).
        turn.payloads.forEach((payload, seq) => {
          this.sim.submit(JSON.stringify({ tick: t, player: turn.player, seq, payload }));
        });
      }
      this.bundles.delete(t);
      const hash = this.sim.step();
      hashes.push(hash);
      this.send({ type: "turn", tick: t + this.delay, payloads: this.pending });
      this.pending = [];
      if (this.sim.tick % this.hashEvery === 0) {
        this.send({ type: "hash", tick: this.sim.tick, hash });
      }
    }
    return hashes;
  }
}

/** The `[net]` values of balance.toml, read by the relay (it has no TOML parser: the keys are
 *  plain `key = integer` lines). A missing key is an error, not a silent default. */
export function netRules(balanceToml: string): {
  delay: number;
  hashEvery: number;
  stallS: number;
} {
  const get = (key: string) => {
    const m = new RegExp(`^${key}\\s*=\\s*(\\d+)`, "m").exec(balanceToml);
    if (!m?.[1]) throw new Error(`balance.toml: [net] ${key} missing`);
    return Number(m[1]);
  };
  return {
    delay: get("input_delay_ticks"),
    hashEvery: get("hash_every_ticks"),
    stallS: get("stall_timeout_s"),
  };
}
