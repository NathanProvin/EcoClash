// Lockstep smoke test (ROADMAP M3.5): two headless players, each with its own sim-wasm, play 5
// minutes through a local relay with the client's Lockstep, issuing plants, unlocks, spawns and
// orders on both sides. Their hashes must match at every tick and the relay must see no desync.
// A second match proves a divergence is caught. Needs the WASM package: `npm run relay:test`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Lockstep } from "../../client/src/net/lockstep.ts";
import { initSync, Sim } from "../../sim-wasm/pkg/sim_wasm.js";
import { startRelay } from "../server.mjs";

initSync({ module: readFileSync(new URL("../../sim-wasm/pkg/sim_wasm_bg.wasm", import.meta.url)) });
const BALANCE = readFileSync(new URL("../../data/balance.toml", import.meta.url), "utf8");
const SPECIES = readFileSync(new URL("../../data/species.toml", import.meta.url), "utf8");
const TICKS = 3000; // 5 minutes at 10 Hz
const N = 64;

/** Each player's orders, by the tick they are issued at. `ids` are the player's animals. */
function script(player, tick, ids) {
  const [r, c] = player === 1 ? [16, 16] : [47, 47];
  const orders = {
    100: [{ type: "plant", species: "grasses", row: r + 4, col: c, radius: 2 }],
    250: [{ type: "unlock", species: "wildflowers" }],
    400: [{ type: "spawn", species: "earthworms", row: r, col: c }],
    700: [{ type: "plant", species: "wildflowers", row: r, col: c + 4, radius: 2 }],
    1200: ids.length ? [{ type: "order", ids, kind: "move", row: 32, col: 32 }] : [],
    2800: [{ type: "unlock", species: "grasshoppers" }], // income runs at the 0.4 pace (D-069)
  };
  return orders[tick] ?? [];
}

/** Ids of a player's animals, from the sim's animal frame. */
function animalsOf(sim, player) {
  const v = new DataView(sim.agentFrame().buffer);
  const ids = [];
  for (let k = 0, p = 4; k < v.getUint32(0, true); k++, p += 10) {
    if (v.getUint8(p + 9) === player) ids.push(v.getUint32(p, true));
  }
  return ids;
}

/** One headless player. With `cheat`, it also submits a command straight to its own sim at
 *  tick 1000, bypassing the relay: the kind of divergence lockstep must catch. */
function player(url, { cheat = false } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const hashes = [];
    let sim, ls;
    let desync = null;
    let queued = -1; // last tick whose script orders were queued
    const finish = () => {
      ws.close();
      const unlocked = [...sim.unlocked(ls.player)].filter(Boolean).length;
      resolve({ player: ls.player, hashes, desync, unlocked, animals: animalsOf(sim, ls.player) });
    };
    const run = () => {
      while (sim.tick < TICKS) {
        const t = sim.tick;
        if (queued < t) {
          queued = t;
          for (const p of script(ls.player, t, animalsOf(sim, ls.player))) ls.queue(p);
          if (cheat && t === 1000) {
            const extra = { type: "plant", species: "grasses", row: 2, col: 2, radius: 1 };
            sim.submit(JSON.stringify({ tick: t, player: ls.player, seq: 999, payload: extra }));
          }
        }
        const done = ls.advance(1);
        if (!done.length) return; // stalled: the bundle for t is not here yet
        hashes.push(done[0]);
      }
      finish();
    };
    ws.onerror = reject;
    ws.onmessage = (e) => {
      const m = JSON.parse(String(e.data));
      if (m.type === "start") {
        sim = new Sim(BALANCE, SPECIES, BigInt(m.seed), N);
        sim.setupPlant(1, "grasses", 16, 16, 3); // the same opening on every client
        sim.setupPlant(2, "grasses", 47, 47, 3);
        ls = new Lockstep(sim, m, (x) => ws.send(JSON.stringify(x)));
        run();
      } else if (m.type === "bundle") {
        ls.receive(m);
        if (sim.tick < TICKS) run();
      } else if (m.type === "desync") {
        desync ??= m.tick;
      }
    };
  });
}

test("two players stay in sync for 5 minutes through the relay", async () => {
  const relay = await startRelay({ seed: 7 });
  const url = `ws://localhost:${relay.port}`;
  const [a, b] = await Promise.all([player(url), player(url)]);
  await relay.close();
  assert.equal(a.hashes.length, TICKS);
  assert.deepEqual(a.hashes, b.hashes, "identical hash at every tick");
  assert.equal(relay.status.desync, null);
  assert.ok(relay.status.checked >= TICKS / 10 - 1, `hash checks: ${relay.status.checked}`);
  assert.deepEqual([a.player, b.player].sort(), [1, 2]);
  // The orders really played: both players called animals and bought two cards.
  const fresh = [...new Sim(BALANCE, SPECIES, 1n, N).unlocked(1)].filter(Boolean).length;
  for (const p of [a, b]) {
    assert.ok(p.animals.length > 0, `P${p.player} animals`);
    assert.equal(p.unlocked, fresh + 2, `P${p.player} unlocks`);
  }
});

test("a divergence is caught at the next hash check", async () => {
  const relay = await startRelay({ seed: 7 });
  const url = `ws://localhost:${relay.port}`;
  const [a, b] = await Promise.all([player(url, { cheat: true }), player(url)]);
  await relay.close();
  const at = relay.status.desync?.tick;
  assert.ok(at > 1000 && at <= 1010, `desync reported at tick ${at}`);
  assert.equal(a.desync ?? b.desync, at, "the players were told");
});
