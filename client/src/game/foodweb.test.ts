import { describe, expect, it } from "vitest";
import type { Species } from "../replay/replay";
import { counters, LITTER_ID, links, related, slotOf, webRoles } from "./foodweb";

const sp = (
  name: string,
  kind: Species["kind"],
  family: string,
  role: string,
  eats: string[] = [],
) =>
  ({
    name,
    kind,
    family,
    role,
    eats,
    tier: 1,
    level: 1,
    habitat: [],
    stats: {},
  }) as unknown as Species;

const grass = sp("grasses", "flora", "L1", "L1");
const rabbit = sp("rabbits", "fauna", "H1", "herbivore", ["grasses"]);
const fox = sp("fox", "fauna", "P2", "predator", ["rabbits"]);
const worm = sp("earthworms", "fauna", "D", "decomposer", ["dead"]);
const all = [grass, rabbit, fox, worm];

describe("food web (D-124)", () => {
  it("stacks hunters over grazers over the plants they eat", () => {
    expect(slotOf("H1", "fauna")[1]).toBe(slotOf("L1", "flora")[1]); // same column
    expect(slotOf("P2", "fauna")[0]).toBeLessThan(slotOf("H1", "fauna")[0]);
    expect(slotOf("H1", "fauna")[0]).toBeLessThan(slotOf("L1", "flora")[0]);
  });

  it("links eaters to foods, recyclers to the dead biomass", () => {
    expect(links(all)).toEqual([
      { eater: "rabbits", food: "grasses", rank: 0 },
      { eater: "fox", food: "rabbits", rank: 0 },
      { eater: "earthworms", food: LITTER_ID, rank: 0 },
    ]);
    const r = related(rabbit, all);
    expect(r.foods.map((x) => x.s.name)).toEqual(["grasses"]);
    expect(r.eaters.map((x) => x.s.name)).toEqual(["fox"]);
  });

  it("finds your counters to what the enemy fields", () => {
    expect([...counters(all, new Set(["rabbits"]))]).toEqual(["fox"]);
    expect(counters(all, new Set()).size).toBe(0);
  });
});

describe("webRoles (D-232)", () => {
  it("marks a focused species' foods as prey and its eaters as predators", () => {
    const roles = webRoles(rabbit, all);
    expect(roles.get("grasses")).toBe("prey");
    expect(roles.get("fox")).toBe("predator");
    expect(roles.has("earthworms")).toBe(false);
    expect(roles.has("rabbits")).toBe(false);
  });
});
