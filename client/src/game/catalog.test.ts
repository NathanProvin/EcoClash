import { describe, expect, it } from "vitest";
import type { Species } from "../replay/replay";
import { catalogSource } from "./catalog";

const sp = (name: string, kind: "flora" | "fauna"): Species =>
  ({
    name,
    kind,
    family: kind === "flora" ? "L1" : "H1",
    level: 1,
    tier: 1,
    role: kind === "flora" ? "L1" : "herbivore",
    habitat: [],
    eats: [],
    stats: { growth: 1, spawn_cost: 1, unlock_cost: 100, yield: 1, cap: 1, effect: "" },
  }) as unknown as Species;

describe("species catalog (D-140)", () => {
  it("shows every species unlocked, nothing on the map, no series", () => {
    const src = catalogSource([sp("grasses", "flora"), sp("rabbits", "fauna")]);
    expect([...(src.unlocked?.(1) ?? [])]).toEqual(["grasses", "rabbits"]);
    expect(src.counts(0, 2)).toEqual([0, 0]);
    expect(src.meta.series["bank_p1"]?.at(-1) ?? 0).toBe(0);
    expect(src.fields(0).species).toHaveLength(1);
  });
});
