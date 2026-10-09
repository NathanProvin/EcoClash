import { describe, expect, it } from "vitest";
import type { ReplayMeta, Species } from "../replay/replay";
import {
  habitatPlants,
  lockText,
  orList,
  capText,
  cardState,
  eatersOf,
  families,
  foodsOf,
  groundOf,
  label,
  quickStats,
  unlockedAt,
} from "./species";

function sp(
  name: string,
  kind: "flora" | "fauna",
  level: number,
  tier: number,
  cost: number,
  habitat: string[] = [],
  family = kind === "flora" ? `L${level}` : "P2",
): Species {
  // prettier-ignore
  return {
    name, kind, family, level, tier, role: kind === "flora" ? `L${level}` : "predator", habitat,
    eats: [],
    stats: { growth: 1, spawn_cost: 1, unlock_cost: cost, yield: 1, cap: 1, effect: "" },
  }; // prettier-ignore
}

const meta = {
  species: [
    sp("grasses", "flora", 1, 1, 0),
    sp("clover", "flora", 1, 2, 300),
    sp("elder", "flora", 3, 1, 1500),
    sp("fox", "fauna", 0, 1, 8000, ["L3"]),
  ],
  log: [
    { t_s: 100, player: 1, what: "unlock: clover", count: 300 },
    { t_s: 200, player: 2, what: "unlock: elder", count: 1500 },
    { t_s: 250, player: 1, what: "grasses", count: 29 },
  ],
} as unknown as ReplayMeta;

describe("species helpers", () => {
  it("formats names", () => {
    expect(label("tawny_owl")).toBe("Tawny owl");
    expect(label("lichen_and_moss")).toBe("Lichen & moss");
  });

  it("shows plant caps as map shares and animal caps as counts", () => {
    expect(
      capText({
        ...sp("grasses", "flora", 1, 1, 0),
        stats: { ...sp("g", "flora", 1, 1, 0).stats, cap: 0.15 },
      }),
    ).toBe("15 % of map");
    expect(capText(sp("fox", "fauna", 5, 1, 0))).toBe("1 animals");
  });

  it("tracks unlocks over time and per player", () => {
    expect([...unlockedAt(meta, 1, 50)]).toEqual(["grasses"]);
    expect([...unlockedAt(meta, 1, 100)]).toEqual(["grasses", "clover"]);
    expect(unlockedAt(meta, 2, 300).has("clover")).toBe(false);
  });

  it("derives card states from tiers and habitats", () => {
    const [grasses, clover, elder, fox] = meta.species as [Species, Species, Species, Species];
    const p1 = unlockedAt(meta, 1, 0);
    expect(cardState(meta, grasses, p1)).toBe("unlocked");
    expect(cardState(meta, clover, p1)).toBe("available");
    expect(cardState(meta, elder, p1)).toBe("available"); // tier 1 of L3
    expect(cardState(meta, fox, p1)).toBe("locked"); // needs an L3 plant
    expect(cardState(meta, fox, unlockedAt(meta, 2, 300))).toBe("available");
  });
});

describe("ground hint (D-239)", () => {
  it("names the ground a plant wants, nothing for animals", () => {
    const at = (water: number) => {
      const s = sp("x", "flora", 1, 1, 0);
      return groundOf({ ...s, stats: { ...s.stats, water } });
    };
    expect(at(0.3)).toBe("Grows best on dry ground");
    expect(at(0.5)).toBe("Grows on most ground");
    expect(at(0.65)).toBe("Grows best on moist ground");
    expect(at(0.8)).toBe("Grows best on wet ground");
    expect(at(0.9)).toBe("Grows in water");
    expect(groundOf(sp("fox", "fauna", 0, 1, 0))).toBeUndefined();
  });
});

describe("food web (D-122)", () => {
  it("lists foods in rank order and finds who eats a species", () => {
    const grass = sp("grasses", "flora", 1, 2, 0);
    const flowers = sp("wildflowers", "flora", 1, 3, 0);
    const rabbit = { ...sp("rabbits", "fauna", 0, 2, 0), eats: ["grasses", "wildflowers"] };
    const fox = { ...sp("fox", "fauna", 0, 3, 0), eats: ["rabbits"] };
    const all = [grass, flowers, rabbit, fox];
    expect(foodsOf(rabbit, all).map((s) => s.name)).toEqual(["grasses", "wildflowers"]);
    expect(eatersOf(flowers, all)).toEqual([{ s: rabbit, rank: 1 }]);
    expect(eatersOf(rabbit, all)).toEqual([{ s: fox, rank: 0 }]);
    const herd = { ...rabbit, eats: ["L1"] }; // a family stands for its plants
    expect(foodsOf(herd, all).map((s) => s.name)).toEqual(["grasses", "wildflowers"]);
  });
});

describe("build card helpers", () => {
  it("groups species by family, plants first, in tier order", () => {
    const groups = families([
      sp("fox", "fauna", 0, 1, 0),
      sp("elder", "flora", 3, 1, 0),
      sp("wildflowers", "flora", 1, 2, 0),
      sp("grasses", "flora", 1, 1, 0),
    ]);
    expect(groups.map((g) => g.name)).toEqual(["Herbs", "Shrubs", "Small hunters"]);
    // D-105: the water families together on the right, the recyclers at the far right.
    const bar = families([
      sp("earthworms", "fauna", 0, 1, 0, [], "D"),
      sp("algae", "flora", 1, 1, 0, [], "W"),
      sp("pike", "fauna", 0, 1, 0, [], "PW"),
      sp("fox", "fauna", 0, 1, 0),
      sp("grasses", "flora", 1, 1, 0),
    ]);
    expect(bar.map((g) => g.key)).toEqual(["L1", "P2", "W", "PW", "D"]);
    expect(bar.map((g) => g.section)).toEqual(["plants", "animals", "water", "water", "recyclers"]);
    expect(groups[0]?.species.map((s) => s.name)).toEqual(["grasses", "wildflowers"]);
  });

  it("gives each card a few quick stats, in real seconds (D-106)", () => {
    const grass = quickStats(sp("grasses", "flora", 1, 1, 0));
    expect(grass.map((q) => q.icon)).toEqual(["coin", "biomass", "spread", "cap"]);
    const fox = sp("fox", "fauna", 5, 1, 0);
    expect(quickStats(fox).map((q) => q.icon)).toEqual(["coin", "biomass", "egg", "cap"]);
    const breeds = (pace: number) => parseFloat(quickStats(fox, pace)[2]?.value ?? "");
    expect(breeds(0.4)).toBeCloseTo(breeds(1) / 0.4, 5); // real seconds at 0.4 pace
  });
});

describe("habitat plants (D-172)", () => {
  const plant = (name: string, family: string) =>
    ({
      name,
      kind: "flora",
      family,
      level: 3,
      tier: 1,
      role: family,
      habitat: [],
      eats: [],
    }) as unknown as Species;
  const shrubs = [plant("elder", "L3"), plant("hawthorn", "L3"), plant("hazel", "L3")];
  const all = [...shrubs, plant("oak", "L4")];
  const fox = {
    name: "fox",
    kind: "fauna",
    family: "P2",
    tier: 2,
    habitat: ["L3"],
  } as unknown as Species;

  it("names the plants of an animal's habitat family", () => {
    expect(habitatPlants(fox, all).map((s) => s.name)).toEqual(["elder", "hawthorn", "hazel"]);
    expect(lockText(fox, all)).toBe("tier 1 + Elder, Hawthorn or Hazel first");
  });

  it("lists choices the way people say them", () => {
    expect(orList(["Elder"])).toBe("Elder");
    expect(orList(["Elder", "Hazel"])).toBe("Elder or Hazel");
  });
});
