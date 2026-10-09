import { describe, expect, it } from "vitest";
import type { Species } from "../replay/replay";
import { plantable } from "./planting";

const plant = (stats: Partial<Species["stats"]> = {}): Species =>
  ({
    name: "ferns",
    kind: "flora",
    family: "L2",
    level: 2,
    tier: 1,
    role: "L2",
    habitat: [],
    eats: [],
    stats: { growth: 1, spawn_cost: 10, unlock_cost: 0, yield: 1, cap: 1, effect: "", ...stats },
  }) as Species;

// A 5x5 map, all free, rich soil, middling moisture; a radius-1 disc at the centre holds 5 cells.
const n = 5;
const fields = () => ({
  owner: new Uint8Array(n * n),
  soil: new Uint8Array(n * n).fill(255),
  moisture: new Uint8Array(n * n).fill(128),
  lock: new Uint8Array(2 * n * n),
});
const at = { row: 2, col: 2 };

describe("plantable at the cursor (D-242)", () => {
  it("counts free and own cells, and needs the bank for all of them", () => {
    const f = fields();
    expect(plantable(plant(), at, 1, n, 1, f, undefined, 1000)).toEqual({ cells: 5, ok: true });
    expect(plantable(plant(), at, 1, n, 1, f, undefined, 49).ok).toBe(false); // 5 x 10 needed
  });

  it("skips enemy land, locked land, rock and deep water", () => {
    const f = fields();
    f.owner[2 * n + 1] = 2; // enemy
    f.lock[2 * (1 * n + 2)] = 1; // barred to player 1 ...
    f.lock[2 * (1 * n + 2) + 1] = 9; // ... for 9 s
    const ground = new Uint8Array(n * n);
    ground[3 * n + 2] = 3; // rock
    ground[2 * n + 3] = 2; // deep
    expect(plantable(plant(), at, 1, n, 1, f, { ground }, 1000).cells).toBe(1);
  });

  it("needs the species' soil and moisture; the shallows always seep", () => {
    const f = fields();
    f.soil.fill(40);
    expect(plantable(plant({ soil_need: 0.3 }), at, 1, n, 1, f, undefined, 1000).ok).toBe(false);
    const dry = fields();
    dry.moisture.fill(10);
    const moist = plant({ water: 0.7, water_tolerance: 0.35 });
    expect(plantable(moist, at, 1, n, 1, dry, undefined, 1000).cells).toBe(0);
    const ground = new Uint8Array(n * n).fill(1); // shallows
    expect(plantable(moist, at, 1, n, 1, dry, { ground }, 1000).cells).toBe(5);
  });
});
