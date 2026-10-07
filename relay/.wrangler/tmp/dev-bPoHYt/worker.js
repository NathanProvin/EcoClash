var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.mjs
import balance from "./e386d9d9b2a358393ce179c42beba2ff0c8b8d70-balance.toml";

// ../client/src/net/lockstep.ts
function netRules(balanceToml) {
  const get = /* @__PURE__ */ __name((key) => {
    const m = new RegExp(`^${key}\\s*=\\s*(\\d+)`, "m").exec(balanceToml);
    if (!m?.[1]) throw new Error(`balance.toml: [net] ${key} missing`);
    return Number(m[1]);
  }, "get");
  return { delay: get("input_delay_ticks"), hashEvery: get("hash_every_ticks") };
}
__name(netRules, "netRules");

// room.mjs
var PLAYERS = 2;
function createRoom({ delay, hashEvery }, send, close) {
  const hellos = /* @__PURE__ */ new Map();
  const seats = /* @__PURE__ */ new Set();
  const turns = /* @__PURE__ */ new Map();
  const hashes = /* @__PURE__ */ new Map();
  const status = { started: false, bundles: 0, checked: 0, desync: null, match: null };
  const all = /* @__PURE__ */ __name((m) => seats.forEach((p) => send(p, m)), "all");
  function hello(player, m) {
    const host = hellos.get(1) ?? (player === 1 ? m : void 0);
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
  __name(hello, "hello");
  function turn(player, m) {
    const byPlayer = turns.get(m.tick) ?? /* @__PURE__ */ new Map();
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
  }
  __name(turn, "turn");
  function hash(player, m) {
    const byPlayer = hashes.get(m.tick) ?? /* @__PURE__ */ new Map();
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
  __name(hash, "hash");
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
    leave(player) {
      if (!seats.delete(player)) return;
      if (!status.started) hellos.delete(player);
      all({ type: "left", player });
    },
  };
}
__name(createRoom, "createRoom");

// worker.mjs
var CODE = /^[A-Z0-9]{4,8}$/;
var worker_default = {
  fetch(req, env) {
    const code = new URL(req.url).pathname.slice(1).toUpperCase();
    if (req.headers.get("Upgrade") !== "websocket")
      return new Response("EcoClash relay", { status: 200 });
    if (!CODE.test(code)) return new Response("bad room code", { status: 400 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
};
var Room = class {
  static {
    __name(this, "Room");
  }
  constructor() {
    this.sockets = /* @__PURE__ */ new Map();
    const send = /* @__PURE__ */ __name(
      (p, m) => this.sockets.get(p)?.send(JSON.stringify(m)),
      "send",
    );
    const close = /* @__PURE__ */ __name(
      (p, reason) => this.sockets.get(p)?.close(4e3, reason),
      "close",
    );
    this.room = createRoom(netRules(balance), send, close);
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
    const gone = /* @__PURE__ */ __name(() => {
      if (this.sockets.get(player) !== server) return;
      this.sockets.delete(player);
      this.room.leave(player);
    }, "gone");
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }
};

// ../../../../Users/Nathan/AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {}
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../Users/Nathan/AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause),
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true",
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-0kY0Fh/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default,
];
var middleware_insertion_facade_default = worker_default;

// ../../../../Users/Nathan/AppData/Local/npm-cache/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    },
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware,
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-0kY0Fh/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (
    __INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 ||
    __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0
  ) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function (request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function (type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {},
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    },
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (
    __INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 ||
    __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0
  ) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {},
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher,
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export { Room, __INTERNAL_WRANGLER_MIDDLEWARE__, middleware_loader_entry_default as default };
//# sourceMappingURL=worker.js.map
