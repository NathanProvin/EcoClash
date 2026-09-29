// Lockstep relay (INSTRUCTIONS §10, ROADMAP M3.5; D-062). One room of two players. It never
// simulates: it hands out player ids and the match seed, collects each player's turn (their
// commands for a tick), broadcasts the tick's bundle once both turns are in, and compares the
// state hashes the players report. A mismatch is a desync: both players are told, with the tick.
//
//   node relay/server.mjs [--port 8787] [--seed 1]      (npm run relay)

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { netRules } from "../client/src/net/lockstep.ts";

const PLAYERS = 2;

/** Start a relay. Returns its port, a status snapshot and `close`. */
export function startRelay({
  port = 0,
  seed = 1,
  balancePath = new URL("../data/balance.toml", import.meta.url),
} = {}) {
  const { delay, hashEvery } = netRules(readFileSync(balancePath, "utf8"));
  const wss = new WebSocketServer({ port });
  const players = [];
  const turns = new Map(); // tick -> Map(player -> payloads)
  const hashes = new Map(); // tick -> Map(player -> hash)
  const status = { started: false, bundles: 0, checked: 0, desync: null };
  const send = (ws, m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m));
  const all = (m) => players.forEach((ws) => send(ws, m));

  wss.on("connection", (ws) => {
    if (players.length >= PLAYERS) {
      ws.close(1013, "room full");
      return;
    }
    players.push(ws);
    const player = players.length;
    ws.on("message", (data) => {
      const m = JSON.parse(String(data));
      if (m.type === "turn") {
        const byPlayer = turns.get(m.tick) ?? new Map();
        byPlayer.set(player, m.payloads);
        turns.set(m.tick, byPlayer);
        if (byPlayer.size === PLAYERS) {
          const bundle = [...byPlayer].sort(([a], [b]) => a - b);
          all({
            type: "bundle",
            tick: m.tick,
            turns: bundle.map(([p, payloads]) => ({ player: p, payloads })),
          });
          turns.delete(m.tick);
          status.bundles++;
        }
      } else if (m.type === "hash") {
        const byPlayer = hashes.get(m.tick) ?? new Map();
        byPlayer.set(player, m.hash);
        hashes.set(m.tick, byPlayer);
        if (byPlayer.size === PLAYERS) {
          hashes.delete(m.tick);
          status.checked++;
          if (new Set(byPlayer.values()).size > 1 && !status.desync) {
            status.desync = { tick: m.tick, hashes: Object.fromEntries(byPlayer) };
            all({ type: "desync", tick: m.tick });
          }
        }
      }
    });
    ws.on("close", () => all({ type: "left", player }));
    if (players.length === PLAYERS) {
      status.started = true;
      players.forEach((p, i) => send(p, { type: "start", seed, player: i + 1, delay, hashEvery }));
    }
  });

  return new Promise((resolve) => {
    wss.on("listening", () =>
      resolve({
        port: wss.address().port,
        status,
        close: () =>
          new Promise((done) => {
            players.forEach((ws) => ws.terminate());
            wss.close(done);
          }),
      }),
    );
  });
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : fallback;
  };
  const relay = await startRelay({
    port: Number(opt("port", "8787")),
    seed: Number(opt("seed", "1")),
  });
  console.log(`relay on ws://localhost:${relay.port} (waiting for 2 players)`);
  setInterval(() => {
    const st = relay.status;
    if (!st.started) return;
    const sync = st.desync ? `DESYNC at tick ${st.desync.tick}` : "in sync";
    console.log(`ticks relayed ${st.bundles}, hash checks ${st.checked}: ${sync}`);
  }, 10_000);
}
