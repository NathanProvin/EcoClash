import { describe, expect, it } from "vitest";
import { CATASTROPHE_LOOK, cardStatus, lookOf, type Catastrophe } from "./catastrophes";

const storm: Catastrophe = {
  name: "storm",
  act: "storm",
  cost: 9000,
  radius: 9,
  cooldown_s: 420,
  duration_s: 6,
  effect: "",
};

describe("catastrophe cards (D-129)", () => {
  it("are ready once cooled down and affordable", () => {
    expect(cardStatus(storm, 0, 9000)).toEqual({ ready: true, affordable: true, left: 0 });
    expect(cardStatus(storm, 0, 8999).ready).toBe(false);
    const cooling = cardStatus(storm, 210, 20000);
    expect(cooling.ready).toBe(false);
    expect(cooling.left).toBeCloseTo(0.5); // half the cooldown to run: the sweep
  });
});

describe("the catastrophe grid (D-252)", () => {
  it("places the nine cards on distinct cells of a 3x3 grid, each with a cue", () => {
    const cells = Object.values(CATASTROPHE_LOOK).map((l) => l.at.join(","));
    expect(cells).toHaveLength(9);
    expect(new Set(cells).size).toBe(9);
    expect(Object.values(CATASTROPHE_LOOK).every((l) => l.cue.startsWith("fx."))).toBe(true);
    expect(lookOf({ ...storm, name: "unknown" }).icon).toBe("storm");
  });
});
