// Headless WASM runner (ROADMAP M1.8): the same options and hash file as sim-cli, so native and
// WASM runs can be compared tick by tick. Uses the `--target web` package (ES module), loaded
// synchronously from disk; the browser worker (M2) loads the same package.
//
// node sim-wasm/node/run.mjs --seed N --ticks T [--commands file.jsonl] [--size N]
//      [--balance data/balance.toml] [--species data/species.toml] [--hashes hashes.csv]

import { readFileSync, writeFileSync } from "node:fs";
import { initSync, Sim } from "../pkg/sim_wasm.js";

initSync({ module: readFileSync(new URL("../pkg/sim_wasm_bg.wasm", import.meta.url)) });

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const sim = new Sim(
  readFileSync(opt("balance", "data/balance.toml"), "utf8"),
  readFileSync(opt("species", "data/species.toml"), "utf8"),
  BigInt(opt("seed", "1")),
  Number(opt("size", "0")),
);
const commands = opt("commands");
if (commands) {
  for (const line of readFileSync(commands, "utf8").split("\n")) {
    if (line.trim()) sim.submit(line);
  }
}

console.log(`balance hash ${sim.balanceHash}`);
const ticks = Number(opt("ticks"));
let hashes = "tick,hash\n";
let last = "";
for (let t = 0; t < ticks; t++) {
  last = sim.step();
  hashes += `${sim.tick},${last}\n`;
}
const out = opt("hashes");
if (out) writeFileSync(out, hashes);
console.log(`tick ${sim.tick} state hash ${last} (rejected commands: ${sim.rejected})`);
