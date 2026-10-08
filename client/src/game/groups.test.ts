import { describe, expect, it } from "vitest";
import type { Animal } from "../replay/replay";
import { GROUP, stableKeys, strategicGroups } from "./groups";

let id = 0;
const herd = (species: number, count: number, y: number, x: number, owner = 1): Animal[] =>
  Array.from({ length: count }, (_, i) => ({ id: id++, y: y + (i % 3) * 0.5, x, species, owner }));

describe("stableKeys (D-232)", () => {
  it("keeps a group's key while its members change, and gives new groups fresh ones", () => {
    const serial = { n: 0 };
    const first = stableKeys(new Map(), [{ prefix: "1:3", ids: [1, 2, 3] }], serial);
    expect(first).toEqual(["1:3#0"]);
    const prev = new Map([["1:3#0", [1, 2, 3]]]);
    // Animal 1 died, 4 was born, and a second herd appeared: the herd keeps its key.
    const next = stableKeys(
      prev,
      [
        { prefix: "1:3", ids: [2, 3, 4] },
        { prefix: "1:3", ids: [9, 10, 11] },
      ],
      serial,
    );
    expect(next).toEqual(["1:3#0", "1:3#1"]);
    // Another species or owner never inherits it.
    expect(stableKeys(prev, [{ prefix: "2:3", ids: [1, 2, 3] }], serial)).toEqual(["2:3#2"]);
  });

  it("gives one previous key to one group only: the first, largest group", () => {
    const prev = new Map([["1:3#0", [1, 2, 3, 4]]]);
    const keys = stableKeys(
      prev,
      [
        { prefix: "1:3", ids: [1, 2, 3] },
        { prefix: "1:3", ids: [4] },
      ],
      { n: 5 },
    );
    expect(keys).toEqual(["1:3#0", "1:3#5"]);
  });
});

describe("strategicGroups", () => {
  it("groups own animals per species, merging neighbouring areas", () => {
    // Voles spread over two touching areas, one group; foxes apart; enemy voles ignored.
    const animals = [
      ...herd(0, 3, 2, 4),
      ...herd(0, 2, 2, 6), // next area (x 5..9), touching
      ...herd(1, 3, 20, 20),
      ...herd(0, 9, 2, 5, 2),
    ];
    const groups = strategicGroups(animals, 1, [false, false]);
    expect(groups.map((g) => [g.species, g.count])).toEqual([
      [0, 5],
      [1, 3],
    ]);
    expect(groups[1]?.row).toBeCloseTo(20.5);
    expect(groups[0]?.ids).toHaveLength(5);
  });

  it("drops small groups, with a higher bar for swarms", () => {
    expect(strategicGroups(herd(0, GROUP.min - 1, 1, 1), 1, [false])).toEqual([]);
    expect(strategicGroups(herd(0, GROUP.min, 1, 1), 1, [true])).toEqual([]); // a swarm
    expect(strategicGroups(herd(0, GROUP.minSwarm, 1, 1), 1, [true])).toHaveLength(1);
  });

  it("groups each side apart, so the enemy's herds get icons too (D-146)", () => {
    const both = [...herd(0, 4, 1, 1, 1), ...herd(0, 5, 1, 1, 2)];
    expect(strategicGroups(both, 1, [false]).map((g) => g.count)).toEqual([4]);
    expect(strategicGroups(both, 2, [false]).map((g) => g.count)).toEqual([5]);
  });

  it("keeps far herds of one species apart", () => {
    const groups = strategicGroups([...herd(0, 3, 1, 1), ...herd(0, 3, 30, 30)], 1, [false]);
    expect(groups).toHaveLength(2);
  });
});
