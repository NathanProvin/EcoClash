import { describe, expect, it } from "vitest";
import { advance, OBJECTIVES, TUTORIAL_GOAL, type TutorialState } from "./tutorial";

const at = (s: Partial<TutorialState>): TutorialState => ({
  owned: 0,
  unlocked: new Set(["lichen_and_moss"]),
  animals: 0,
  onEnemy: 0,
  ...s,
});
const grasses = new Set(["lichen_and_moss", "grasses"]);

describe("tutorial objectives", () => {
  it("complete in order, one after the other", () => {
    expect(advance(0, at({}))).toBe(0);
    expect(advance(0, at({ owned: 0.01 }))).toBe(1); // founded, not yet 5 %
    expect(advance(1, at({ owned: 0.06 }))).toBe(2);
    // Rabbits called before grasses were unlocked do not skip the grasses step.
    expect(advance(2, at({ owned: 0.06, animals: 3 }))).toBe(2);
    expect(advance(2, at({ owned: 0.06, unlocked: grasses }))).toBe(3);
    expect(advance(3, at({ owned: 0.06, unlocked: grasses, animals: 2 }))).toBe(4);
    expect(advance(4, at({ owned: 0.1, unlocked: grasses, animals: 2, onEnemy: 1 }))).toBe(5);
    const all = at({ owned: TUTORIAL_GOAL, unlocked: grasses, animals: 5, onEnemy: 2 });
    expect(advance(5, all)).toBe(OBJECTIVES.length);
  });

  it("never goes back once an objective is done", () => {
    expect(advance(3, at({}))).toBe(3); // land lost after founding: still on the current step
  });
});
