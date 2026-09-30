// Native vs WASM determinism check (INSTRUCTIONS §4 required test, ROADMAP M1.8): build the WASM
// package, run the same command file through sim-cli (native) and run.mjs (WASM), and demand the
// same hash at every tick. `npm run wasm:check`; CI runs it on every push.

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
const ticks = "1200"; // two minutes of play
const common = ["--seed", "7", "--ticks", ticks, "--size", "64", "--sandbox", "1", "--terrain", "1", "--commands", "sim-wasm/node/commands.jsonl"]; // prettier-ignore

execSync("npm run -s wasm:build", { stdio: "inherit" }); // the package the browser loads too

const dir = mkdtempSync(join(tmpdir(), "ecoclash-"));
const native = join(dir, "native.csv");
const wasm = join(dir, "wasm.csv");
run("cargo", ["run", "-q", "--release", "-p", "sim-cli", "--", "run", ...common, "--hashes", native]);
run("node", ["sim-wasm/node/run.mjs", ...common, "--hashes", wasm]);

const [a, b] = [readFileSync(native, "utf8").split("\n"), readFileSync(wasm, "utf8").split("\n")];
const first = a.findIndex((line, i) => line !== b[i]);
if (first >= 0 || a.length !== b.length) {
  console.error(`native and WASM differ at line ${first}: ${a[first]} vs ${b[first]}`);
  process.exit(1);
}
console.log(`native and WASM hashes identical on all ${a.length - 2} ticks (${a.at(-2)})`);
