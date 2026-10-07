// One lockstep room of two players (INSTRUCTIONS §10; D-062, D-219). Pure logic, no I/O: the
// local Node relay (server.mjs) and the Cloudflare Durable Object (worker.mjs) both wrap it.
//
// Handshake: each player's first message is `hello` {build, balance, seed?, size?}. The first
// player in is the host (player 1); its hello sets the match's seed and map size. The guest must
// run the same build and balance hash, or it is refused. Once both said hello, both get `start`.
// Then it collects each player's turn (their commands for a tick), broadcasts the tick's bundle
// once both turns are in, and compares the state hashes the players report: a mismatch is a
// desync, and both players are told, with the tick. It never simulates.

export const PLAYERS = 2;

/** A room. `send(player, message)` delivers to one player; `close(player, reason)` drops one. */
export function createRoom({ delay, hashEvery, stallS }, send, close) {
  const hellos = new Map(); // player -> hello
  const seats = new Set(); // players connected
  const turns = new Map(); // tick -> Map(player -> payloads)
  const hashes = new Map(); // tick -> Map(player -> hash)
  const status = { started: false, bundles: 0, checked: 0, desync: null, match: null };
  const all = (m) => seats.forEach((p) => send(p, m));
  let lastBundle; // when the last bundle went out (ms)

  function hello(player, m) {
    const host = hellos.get(1) ?? (player === 1 ? m : undefined);
    if (player !== 1 && host && (m.build !== host.build || m.balance !== host.balance)) {
      const what = m.build !== host.build ? "game version" : "balance";
      close(player, `refused: a different ${what} from the host`);
      return;
    }
    hellos.set(player, m);
    if (hellos.size < PLAYERS) return;
    const h = hellos.get(1);
    status.started = true;
    status.match = { seed: Number(h.seed ?? 1), size: Number(h.size ?? 0) };
    for (const p of seats) send(p, { type: "start", ...status.match, player: p, delay, hashEvery });
  }

  function turn(player, m) {
    const byPlayer = turns.get(m.tick) ?? new Map();
    byPlayer.set(player, m.payloads);
    turns.set(m.tick, byPlayer);
    if (byPlayer.size < PLAYERS) return;
    const bundle = [...byPlayer].sort(([a], [b]) => a - b);
    all({
      type: "bundle",
      tick: m.tick,
      turns: bundle.map(([p, payloads]) => ({ player: p, payloads })),
    });
    turns.delete(m.tick);
    status.bundles++;
    lastBundle = undefined; // set at the next idle check
  }

  function hash(player, m) {
    const byPlayer = hashes.get(m.tick) ?? new Map();
    byPlayer.set(player, m.hash);
    hashes.set(m.tick, byPlayer);
    if (byPlayer.size < PLAYERS) return;
    hashes.delete(m.tick);
    status.checked++;
    if (new Set(byPlayer.values()).size > 1 && !status.desync) {
      status.desync = { tick: m.tick, hashes: Object.fromEntries(byPlayer) };
      all({ type: "desync", tick: m.tick });
    }
  }

  return {
    status,
    /** Seat a new connection: its player number, or null when the room is full. */
    join() {
      for (let p = 1; p <= PLAYERS; p++) {
        if (!seats.has(p) && !hellos.has(p)) {
          seats.add(p);
          return p;
        }
      }
      return null;
    },
    message(player, m) {
      if (m.type === "hello" && !hellos.has(player)) hello(player, m);
      else if (!status.started) return;
      else if (m.type === "turn") turn(player, m);
      else if (m.type === "hash") hash(player, m);
    },
    /** Stall timeout (INSTRUCTIONS §10, D-221): call every second or so. When no bundle went
     *  out for `stallS`, the player whose turn the oldest open tick misses is dropped (the other
     *  is told it left, and wins). Both silent: nobody is to blame, nothing happens. */
    idle(now) {
      if (!status.started || status.desync) return;
      lastBundle ??= now;
      if (now - lastBundle < stallS * 1000 || !turns.size) return;
      const oldest = turns.get(Math.min(...turns.keys()));
      for (let p = 1; p <= PLAYERS; p++)
        if (!oldest.has(p) && seats.has(p)) close(p, "dropped: no turn for too long");
    },
    leave(player) {
      if (!seats.delete(player)) return;
      if (!status.started) hellos.delete(player); // a lobby seat frees up again
      all({ type: "left", player });
    },
  };
}
