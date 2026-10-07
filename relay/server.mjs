// Lockstep relay, local Node server (INSTRUCTIONS §10, ROADMAP M3.5; D-062, D-219). Rooms by URL
// path (`ws://host:port/<code>`; no path is the room ""), each a `room.mjs` room of two players.
// The deployed relay is the Cloudflare Worker in worker.mjs, around the same rooms.
//
//   node relay/server.mjs [--port 8787]      (npm run relay)

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { WebSocketServer } from "ws";
import { netRules } from "../client/src/net/lockstep.ts";
import { createRoom } from "./room.mjs";

/** Start a relay. Returns its port, the status of its rooms (by code) and `close`. */
export function startRelay({
  port = 0,
  balancePath = new URL("../data/balance.toml", import.meta.url),
} = {}) {
  const rules = netRules(readFileSync(balancePath, "utf8"));
  const wss = new WebSocketServer({ port });
  const rooms = new Map(); // code -> { room, sockets }

  wss.on("connection", (ws, req) => {
    const code = decodeURIComponent((req.url ?? "/").slice(1).split("?")[0]);
    if (!rooms.has(code)) {
      const sockets = new Map(); // player -> ws
      const send = (p, m) => {
        const s = sockets.get(p);
        if (s?.readyState === s?.OPEN) s.send(JSON.stringify(m));
      };
      const close = (p, reason) => sockets.get(p)?.close(4000, reason);
      rooms.set(code, { room: createRoom(rules, send, close), sockets });
    }
    const { room, sockets } = rooms.get(code);
    const player = room.join();
    if (player === null) {
      ws.close(1013, "room full");
      return;
    }
    sockets.set(player, ws);
    ws.on("message", (data) => room.message(player, JSON.parse(String(data))));
    ws.on("close", () => {
      sockets.delete(player);
      room.leave(player);
      // ponytail: started rooms stay (their status is read after the match); fine for a local relay.
      if (!sockets.size && !room.status.started) rooms.delete(code);
    });
  });

  const status = (code = "") => rooms.get(code)?.room.status;
  return new Promise((resolve) => {
    wss.on("listening", () =>
      resolve({
        port: wss.address().port,
        status,
        close: () =>
          new Promise((done) => {
            wss.clients.forEach((ws) => ws.terminate());
            wss.close(done);
          }),
      }),
    );
  });
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--port");
  const relay = await startRelay({ port: Number(i >= 0 ? args[i + 1] : "8787") });
  console.log(`relay on ws://localhost:${relay.port}/<room code> (2 players per room)`);
}
