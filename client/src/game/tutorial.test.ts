import { describe, expect, it } from "vitest";
import {
  advance,
  HERD_BIRTHS,
  OBJECTIVES,
  SPREAD_GOAL,
  TUTORIAL_GOAL,
  type TutorialState,
} from "./tutorial";

const at = (s: Partial<TutorialState>): TutorialState => ({
  owned: 0,
  unlocked: new Set(["lichen_and_moss"]),
  animals: 0,
  onEnemy: 0,
  acked: new Set(),
  overlay: null,
  techOpened: false,
  layer: 0,
  plants: new Set(),
  selected: 0,
  born: 0,
  airdropped: 0,
  fauna: new Set(),
  swarm: 0,
  raidOver: false,
  ...s,
});
const grasses = new Set(["lichen_and_moss", "grasses"]);
const grown = new Set(["lichen_and_moss", "grasses"]);

describe("tutorial objectives (D-139)", () => {
  it("wait for Next on an explanation step", () => {
    expect(OBJECTIVES[0]?.ack).toBe(true);
    expect(advance(0, at({ owned: 0.01 }))).toBe(0); // played ahead: still reading
    expect(advance(0, at({ acked: new Set([0]) }))).toBe(1);
  });

  it("complete in order, one after the other, to the end", () => {
    let s = at({ acked: new Set([0]) });
    let step = advance(0, s);
    const steps: [Partial<TutorialState>, number][] = [
      [{ owned: 0.01 }, 2], // founded
      [{ owned: SPREAD_GOAL }, 3], // spread
      [{ overlay: "soil" }, 4], // read the soil
      [{ unlocked: grasses }, 4], // unlocked, not planted yet: rabbits would find no food
      [{ plants: grown }, 5],
      [{ layer: 2 }, 6], // a second layer
      [{ techOpened: true }, 7],
      [{ animals: 2 }, 8],
      [{ selected: 2 }, 9],
      [{ born: 1 }, 9], // one birth: the herd is still growing
      [{ born: HERD_BIRTHS }, 10],
      [{ onEnemy: 1 }, 11], // raid
      [{ airdropped: 1 }, 12],
      [{ fauna: new Set(["rabbits"]) }, 12], // no hunter yet: still defending
      [{ fauna: new Set(["rabbits", "great_tit"]) }, 13],
      [{ owned: TUTORIAL_GOAL }, OBJECTIVES.length],
    ];
    for (const [change, next] of steps) {
      s = { ...s, ...change };
      step = advance(step, s);
      expect(step).toBe(next);
    }
  });

  it("lets the defense end on the unlock when the bot cannot raid", () => {
    const tit = new Set(["lichen_and_moss", "great_tit"]);
    expect(advance(12, at({ unlocked: tit }))).toBe(12); // waves still coming
    expect(advance(12, at({ unlocked: tit, raidOver: true, swarm: 3 }))).toBe(12); // prey to hunt
    expect(advance(12, at({ unlocked: tit, raidOver: true }))).toBe(13);
  });

  it("does not skip a step done out of order", () => {
    // Rabbits called before the soil overlay was opened do not skip the soil step.
    expect(advance(3, at({ owned: 0.1, animals: 3, selected: 3 }))).toBe(3);
    expect(advance(3, at({ overlay: "moisture" }))).toBe(3); // another overlay
    expect(advance(5, at({ layer: 1 }))).toBe(5); // herbs only
  });

  it("never goes back once an objective is done", () => {
    expect(advance(4, at({}))).toBe(4); // land lost after founding: still on the current step
  });
});
