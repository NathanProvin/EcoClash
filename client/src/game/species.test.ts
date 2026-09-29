import { describe, expect, it } from "vitest";
import type { ReplayMeta, Species } from "../replay/replay";
import { capText, cardState, label, unlockedAt } from "./species";

function sp(
  name: string,
  kind: "flora" | "fauna",
  level: number,
  tier: number,
  cost: number,
  habitat: string[] = [],
): Species {
  // prettier-ignore
  return {
    name, kind, level, tier, role: kind === "flora" ? `L${level}` : "predator", habitat, eats: [],
    stats: { growth: 1, spawn_cost: 1, unlock_cost: cost, yield: 1, cap: 1, effect: "" },
  }; // prettier-ignore
}

const meta = {
  species: [
    sp("grasses", "flora", 1, 1, 0),
    sp("clover", "flora", 1, 2, 300),
    sp("elder", "flora", 2, 1, 1500),
    sp("fox", "fauna", 5, 1, 8000, ["L2"]),
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
    expect(cardState(meta, elder, p1)).toBe("available"); // tier 1 of L2
    expect(cardState(meta, fox, p1)).toBe("locked"); // needs an L2 plant
    expect(cardState(meta, fox, unlockedAt(meta, 2, 300))).toBe("available");
  });
});
