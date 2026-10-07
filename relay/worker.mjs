// Lockstep relay on Cloudflare (D-219): a Worker that routes `wss://<host>/<room code>` to one
// Durable Object per code, each holding a `room.mjs` room of two players. Deploy: `npm run
// relay:deploy` (wrangler.toml); local: `npx wrangler dev` in relay/, or `npm run relay` (Node).

import balance from "../data/balance.toml";
import { netRules } from "../client/src/net/lockstep.ts";
import { createRoom } from "./room.mjs";

const CODE = /^[A-Z0-9]{4,8}$/;

export default {
  fetch(req, env) {
    const code = new URL(req.url).pathname.slice(1).toUpperCase();
    if (req.headers.get("Upgrade") !== "websocket")
      return new Response("EcoClash relay", { status: 200 });
    if (!CODE.test(code)) return new Response("bad room code", { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
};

/** One match room. ponytail: plain WebSockets, no hibernation: the object stays in memory for the
 *  match (minutes); move to the hibernation API if idle rooms ever cost too much. */
export class Room {
  constructor() {
    this.sockets = new Map(); // player -> WebSocket
    const send = (p, m) => this.sockets.get(p)?.send(JSON.stringify(m));
    const close = (p, reason) => this.sockets.get(p)?.close(4000, reason);
    this.room = createRoom(netRules(balance), send, close);
    this.timer = setInterval(() => this.room.idle(Date.now()), 1000);
  }

  fetch() {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const player = this.room.join();
    if (player === null) {
      server.close(1013, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }
    this.sockets.set(player, server);
    server.addEventListener("message", (e) =>
      this.room.message(player, JSON.parse(String(e.data))),
    );
    const gone = () => {
      if (this.sockets.get(player) !== server) return;
      this.sockets.delete(player);
      this.room.leave(player);
      if (!this.sockets.size) clearInterval(this.timer); // the match is over
    };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
