import { describe, expect, it } from "vitest";
import type { Animal } from "../replay/replay";
import { FRONT, FrontWatch, RAID, RaidWatch, VictoryWatch, type Kind } from "./alerts";

const kinds: Kind[] = [
  { label: "Voles", predator: false, swarm: false },
  { label: "Fox", predator: true, swarm: false },
  { label: "Caterpillars", predator: false, swarm: true },
];
const n = 16;
const owner = new Uint8Array(n * n).map((_, k) => (k % n < 8 ? 1 : 2)); // P1 west, P2 east
let id = 0;
const herd = (species: number, count: number, row: number, col: number, who = 2): Animal[] =>
  Array.from({ length: count }, () => ({ id: id++, y: row, x: col, species, owner: who }));

describe("RaidWatch", () => {
  it("names the group by its main species and words it by size", () => {
    const w = new RaidWatch();
    expect(w.scan(herd(0, 1, 2, 2), owner, n, 1, kinds, 0)).toEqual([]); // one vole: nothing
    const small = w.scan(herd(0, 3, 2, 2), owner, n, 1, kinds, 0)[0];
    expect(small?.severity).toBe(0);
    expect(small?.text).toMatch(/voles/);
    const raid = new RaidWatch().scan(herd(1, 5, 10, 2), owner, n, 1, kinds, 0)[0];
    expect(raid?.severity).toBe(2); // 5 foxes: 15 weight
    expect(raid?.text).toMatch(/fox/);
    expect([raid?.row, raid?.col]).toEqual([10, 2]);
  });

  it("ignores own animals, enemies on their own land, and swarms below the threshold", () => {
    const w = new RaidWatch();
    expect(w.scan(herd(0, 9, 2, 2, 1), owner, n, 1, kinds, 0)).toEqual([]);
    expect(w.scan(herd(0, 9, 2, 12), owner, n, 1, kinds, 0)).toEqual([]);
    expect(w.scan(herd(2, 7, 2, 2), owner, n, 1, kinds, 0)).toEqual([]); // 7 x 0.25 < 2
  });

  it("stays quiet in an area during the cooldown unless it gets worse", () => {
    const w = new RaidWatch();
    const voles = herd(0, 3, 2, 2);
    expect(w.scan(voles, owner, n, 1, kinds, 0)).toHaveLength(1);
    expect(w.scan(voles, owner, n, 1, kinds, 5)).toHaveLength(0);
    expect(w.scan(herd(0, 3, 2, 5), owner, n, 1, kinds, 6)).toHaveLength(0); // next area too
    expect(w.scan(herd(1, 5, 2, 2), owner, n, 1, kinds, 7)).toHaveLength(1); // worse: a raid
    expect(w.scan(voles, owner, n, 1, kinds, RAID.cooldownS + 8)).toHaveLength(1);
  });

  it("raises one alert at a time across the map, the worst first", () => {
    const w = new RaidWatch();
    const two = [...herd(0, 3, 2, 2), ...herd(0, 8, 12, 2)]; // far apart: attack and incursion
    const first = w.scan(two, owner, n, 1, kinds, 0);
    expect(first).toHaveLength(1);
    expect(first[0]?.severity).toBe(1);
    expect(w.scan(two, owner, n, 1, kinds, RAID.gapS - 1)).toHaveLength(0);
    expect(w.scan(two, owner, n, 1, kinds, RAID.gapS + 1)).toHaveLength(1); // the other area
  });
});

describe("FrontWatch", () => {
  it("alerts when several cells fall to the enemy in a short time, once per cooldown", () => {
    const w = new FrontWatch();
    const owner = new Uint8Array(16 * 16).fill(1);
    expect(w.scan(owner, 16, 1, 0)).toBeNull(); // first look: nothing to compare
    const taken = owner.slice();
    for (let k = 0; k < 8; k++) taken[k] = 2; // row 0, cols 0..7
    const alert = w.scan(taken, 16, 1, 1);
    expect(alert?.text).toBeTruthy();
    expect([alert?.row, alert?.col]).toEqual([0, 4]);
    const more = taken.slice();
    for (let k = 16; k < 24; k++) more[k] = 2;
    expect(w.scan(more, 16, 1, 2)).toBeNull(); // cooldown
  });

  it("ignores slow losses", () => {
    const w = new FrontWatch();
    let owner = new Uint8Array(16 * 16).fill(1);
    w.scan(owner, 16, 1, 0);
    for (let step = 1; step <= 10; step++) {
      owner = owner.slice();
      owner[step] = 2;
      expect(w.scan(owner, 16, 1, step * (FRONT.windowS / 2))).toBeNull(); // 1 cell per 5 s
    }
  });
});

describe("VictoryWatch", () => {
  it("warns once as a side nears the winning share, again after it fell back", () => {
    const w = new VictoryWatch();
    expect(w.scan([0.3, 0.3], 1, 0.6, 0, 1200)).toEqual([]);
    expect(w.scan([0.52, 0.3], 1, 0.6, 10, 1200)[0]).toMatch(/Victory in sight: you hold 52 %/);
    expect(w.scan([0.55, 0.3], 1, 0.6, 20, 1200)).toEqual([]); // already warned
    expect(w.scan([0.3, 0.51], 1, 0.6, 30, 1200)[0]).toMatch(/enemy nears victory/);
    w.scan([0.4, 0.3], 1, 0.6, 40, 1200); // fell back below 45 %
    expect(w.scan([0.5, 0.3], 1, 0.6, 50, 1200)).toHaveLength(1);
  });

  it("counts down the last minutes once each", () => {
    const w = new VictoryWatch();
    expect(w.scan([0, 0], 1, 0.6, 1200 - 301, 1200)).toEqual([]);
    expect(w.scan([0, 0], 1, 0.6, 1200 - 299, 1200)).toEqual(["5 minutes left"]);
    expect(w.scan([0, 0], 1, 0.6, 1200 - 200, 1200)).toEqual([]);
    expect(w.scan([0, 0], 1, 0.6, 1200 - 59, 1200)).toEqual(["One minute left"]);
  });
});
