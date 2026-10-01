// The live match (INSTRUCTIONS §6): sim-wasm in a Web Worker. It runs the fixed tick (10 Hz; a
// tick that overruns slows game time down, ticks are never skipped), takes commands from the main
// thread, and posts the tick with the animals every loop, the field frame only when the flora
// changed, and notices when an order did nothing.
//
// With a relay (D-062), the match is a lockstep: the worker joins the relay, gets the seed and its
// player, and runs tick t only once the relay's bundle for t is here; its player's commands go out
// as turns (net/lockstep.ts). Pause and speed do not apply: both peers keep the same clock.

import balance from "../../../data/balance.toml?raw";
import species from "../../../data/species.toml?raw";
import init, { Sim } from "../../../sim-wasm/pkg/sim_wasm.js";
import wasmUrl from "../../../sim-wasm/pkg/sim_wasm_bg.wasm?url";
import { Lockstep, type FromRelay } from "../net/lockstep";
import type { ToMain, ToWorker } from "./live";

let sim: Sim | undefined;
let paused = false;
let speed = 1;
let floraTick = -1;
let over = ""; // the verdict (JSON) once the match is decided
const seq = new Map<number, number>(); // next command sequence number per player
let net: Lockstep | undefined; // set in a relayed match

const post = (m: ToMain, transfer: Transferable[] = []) => postMessage(m, { transfer });

function command(s: Sim, player: number, payload: object) {
  // Stamped with the next tick to run: a local match has no input delay (lockstep adds it, M3.5).
  const c = { tick: s.tick, player, seq: seq.get(player) ?? 0, payload };
  seq.set(player, c.seq + 1);
  if (!s.submit(JSON.stringify(c)))
    post({ type: "error", message: `refused ${JSON.stringify(c)}` });
}

function sendFields(s: Sim) {
  floraTick = s.floraTick;
  const frame = s.fieldFrame().buffer as ArrayBuffer; // a fresh copy out of WASM memory
  const pressure = s.pressureFrame().buffer as ArrayBuffer;
  const bank = [s.bank(1), s.bank(2)];
  const income = [s.income(1), s.income(2)];
  const standing = [s.standing(1), s.standing(2)];
  post({ type: "fields", tick: s.tick, frame, pressure, bank, income, standing }, [
    frame,
    pressure,
  ]);
}

function loop() {
  const start = performance.now();
  const s = sim;
  if (s && !over && (net || !paused)) {
    let hash = "";
    let ran = 0;
    if (net) {
      hash = net.advance(1)[0] ?? ""; // one tick per loop at most: every peer keeps 10 Hz
      ran = hash ? 1 : 0;
      over = s.result();
    } else {
      for (; ran < speed && !over; ran++) {
        hash = s.step();
        over = s.result(); // the match is decided: stop right there
      }
    }
    const ms = ran ? (performance.now() - start) / ran : 0;
    const agents = s.agentFrame().buffer as ArrayBuffer;
    const unlocked = [[...s.unlocked(1)], [...s.unlocked(2)]];
    const stalled = net?.stalled ?? false;
    const drops = [...s.takeDrops()];
    post({ type: "tick", tick: s.tick, hash, ms, agents, unlocked, result: over, stalled, drops }, [
      agents,
    ]);
    if (s.floraTick !== floraTick) sendFields(s);
    const notices = JSON.parse(s.takeNotices()) as { player: number; text: string }[];
    if (notices.length) post({ type: "notice", notices });
  }
  setTimeout(loop, Math.max(0, 1000 / (s?.tickHz ?? 10) - (performance.now() - start)));
}

/** Join a relay: resolves with its start message; bundles and events keep flowing to `net`. */
function join(url: string): Promise<Extract<FromRelay, { type: "start" }> & { ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onerror = () => reject(new Error(`cannot reach the relay at ${url}`));
    ws.onmessage = (e: MessageEvent<string>) => {
      const m = JSON.parse(e.data) as FromRelay;
      if (m.type === "start") resolve({ ...m, ws });
      else if (m.type === "bundle") net?.receive(m);
      else if (m.type === "desync") post({ type: "net", event: "desync", tick: m.tick });
      else post({ type: "net", event: "left", tick: 0 });
    };
  });
}

async function begin(
  seed: number,
  size: number,
  sandbox: boolean,
  bot: string,
  relay: string | undefined,
) {
  await init({ module_or_path: wasmUrl });
  const room = relay ? await join(relay) : undefined;
  if (room) [seed, sandbox, bot] = [room.seed, false, "none"]; // both peers: the relay's seed
  const s = new Sim(balance, species, BigInt(seed), size);
  s.setSandbox(sandbox);
  s.generateTerrain(); // this match's map, from its seed (D-083)
  if (bot !== "none") s.addBot(2, bot); // the scripted opponent plays P2 (D-060)
  // No starting land (D-095): each player's first planting, anywhere, is their spawn.
  const n = Math.sqrt(s.fieldFrame().length / (2 + s.speciesNames().length));
  sim = s;
  if (room) {
    const ws = room.ws;
    net = new Lockstep(s, room, (m) => ws.send(JSON.stringify(m)));
  }
  post({
    type: "ready",
    me: net?.player ?? 1,
    species: s.speciesTable(),
    n,
    tickHz: s.tickHz,
    pace: s.pace,
    plantRadius: s.plantRadius,
    dropRadius: s.dropRadius,
    victory: s.victoryTerritory,
    timeLimitS: s.timeLimitS,
    maxAgents: s.maxAgents,
    balanceHash: s.balanceHash,
    terrain: s.terrainFrame().buffer as ArrayBuffer, // the map, once (D-085)
    reliefM: s.reliefM,
  });
  sendFields(s);
  loop();
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "start") {
    begin(m.seed, m.size, m.sandbox, m.bot, m.relay).catch((err: unknown) =>
      post({ type: "error", message: String(err) }),
    );
  } else if (m.type === "pause") {
    paused = m.paused;
  } else if (m.type === "speed") {
    speed = m.speed;
  } else if (net) {
    net.queue(m.payload); // relayed: goes out in this player's next turn
  } else if (sim) {
    command(sim, m.player, m.payload);
  }
};
