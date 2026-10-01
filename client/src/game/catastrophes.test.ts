import { describe, expect, it } from "vitest";
import { cardStatus, type Catastrophe } from "./catastrophes";

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
