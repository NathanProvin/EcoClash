import { expect, it } from "vitest";
import { Lockstep, netRules, type ToRelay } from "./lockstep";

/** A sim that records what it is given. */
class FakeSim {
  tick = 0;
  submitted: string[] = [];
  submit(c: string) {
    this.submitted.push(c);
    return true;
  }
  step() {
    this.tick++;
    return `h${this.tick}`;
  }
}

it("runs a tick only with its bundle, sends turns `delay` ahead and hashes on cadence", () => {
  const sim = new FakeSim();
  const sent: ToRelay[] = [];
  const ls = new Lockstep(sim, { player: 2, delay: 2, hashEvery: 2 }, (m) => sent.push(m));
  // The first `delay` turns go out empty at once.
  expect(sent).toEqual([
    { type: "turn", tick: 0, payloads: [] },
    { type: "turn", tick: 1, payloads: [] },
  ]);
  expect(ls.stalled).toBe(true);
  expect(ls.advance(5)).toEqual([]); // no bundle: the sim waits

  const plant = { type: "plant", species: "grasses", row: 1, col: 1, radius: 1 };
  ls.receive({
    type: "bundle",
    tick: 0,
    turns: [
      { player: 1, payloads: [plant, plant] },
      { player: 2, payloads: [] },
    ],
  });
  ls.queue({ type: "unlock", species: "wildflowers" });
  expect(ls.advance(5)).toEqual(["h1"]); // tick 0 only: tick 1 has no bundle yet
  // Every client submits the same commands with the same (tick, player, seq).
  expect(sim.submitted.map((c) => JSON.parse(c) as { seq: number })).toMatchObject([
    { tick: 0, player: 1, seq: 0 },
    { tick: 0, player: 1, seq: 1 },
  ]);
  // After tick 0: this player's turn for tick 0 + delay carries what it queued.
  expect(sent.at(-1)).toEqual({
    type: "turn",
    tick: 2,
    payloads: [{ type: "unlock", species: "wildflowers" }],
  });
  ls.receive({ type: "bundle", tick: 1, turns: [] });
  ls.advance(5);
  expect(sent.at(-1)).toEqual({ type: "hash", tick: 2, hash: "h2" }); // every 2 ticks
});

it("reads the [net] rules from balance.toml and refuses a missing key", () => {
  const net = "[net]\ninput_delay_ticks = 3\nhash_every_ticks = 7\nstall_timeout_s = 10\n";
  expect(netRules(net)).toEqual({ delay: 3, hashEvery: 7, stallS: 10 });
  expect(() => netRules("[net]\n")).toThrow("input_delay_ticks");
});
