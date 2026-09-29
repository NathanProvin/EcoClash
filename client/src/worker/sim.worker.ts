// The live match (INSTRUCTIONS §6): sim-wasm in a Web Worker. It runs the fixed tick (10 Hz; a
// tick that overruns slows game time down, ticks are never skipped), takes commands from the main
// thread, and posts the tick with the animals every loop, the field frame only when the flora
// changed, and notices when an order did nothing.

import balance from "../../../data/balance.toml?raw";
import species from "../../../data/species.toml?raw";
import init, { Sim } from "../../../sim-wasm/pkg/sim_wasm.js";
import wasmUrl from "../../../sim-wasm/pkg/sim_wasm_bg.wasm?url";
import type { ToMain, ToWorker } from "./live";

// Starting patches until match setup exists (M4): the tick-0 plant orders of the prototype
// builds (tools/prototype/match.py BUILDS), offsets in cells of a 128 map from the home point
// (n/4, n/4), mirrored for P2. [species, row offset, col offset, radius]
const OPENING: [string, number, number, number][] = [
  ["grasses", 0, 0, 3],
  ["lichen_and_moss", 0, 8, 3],
];

let sim: Sim | undefined;
let paused = false;
let speed = 1;
let floraTick = -1;
const seq = new Map<number, number>(); // next command sequence number per player

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
  const bank = [s.bank(1), s.bank(2)];
  const income = [s.income(1), s.income(2)];
  post({ type: "fields", tick: s.tick, frame, bank, income }, [frame]);
}

function loop() {
  const start = performance.now();
  const s = sim;
  if (s && !paused) {
    let hash = "";
    for (let i = 0; i < speed; i++) hash = s.step();
    const ms = (performance.now() - start) / speed;
    const agents = s.agentFrame().buffer as ArrayBuffer;
    post({ type: "tick", tick: s.tick, hash, ms, agents }, [agents]);
    if (s.floraTick !== floraTick) sendFields(s);
    const notices = JSON.parse(s.takeNotices()) as { player: number; text: string }[];
    if (notices.length) post({ type: "notice", notices });
  }
  setTimeout(loop, Math.max(0, 1000 / (s?.tickHz ?? 10) - (performance.now() - start)));
}

async function begin(seed: number, size: number) {
  await init({ module_or_path: wasmUrl });
  const s = new Sim(balance, species, BigInt(seed), size);
  const n = Math.sqrt(s.fieldFrame().length / (2 + s.speciesNames().length));
  const base = Math.floor(n / 4);
  for (const player of [1, 2]) {
    for (const [name, dr, dc, radius] of OPENING) {
      let [row, col] = [base + Math.round((dr * n) / 128), base + Math.round((dc * n) / 128)];
      if (player === 2) [row, col] = [n - 1 - row, n - 1 - col];
      command(s, player, { type: "plant", species: name, row, col, radius });
    }
  }
  sim = s;
  post({
    type: "ready",
    species: s.speciesTable(),
    n,
    tickHz: s.tickHz,
    plantRadius: s.plantRadius,
    maxAgents: s.maxAgents,
    balanceHash: s.balanceHash,
  });
  sendFields(s);
  loop();
}

onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "start") {
    begin(m.seed, m.size).catch((err: unknown) => post({ type: "error", message: String(err) }));
  } else if (m.type === "pause") {
    paused = m.paused;
  } else if (m.type === "speed") {
    speed = m.speed;
  } else if (sim) {
    command(sim, m.player, m.payload);
  }
};
