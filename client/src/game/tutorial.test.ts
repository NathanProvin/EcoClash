import { describe, expect, it } from "vitest";
import {
  advance,
  DEFEND_TITLE,
  HERD_BIRTHS,
  OBJECTIVES,
  SPREAD_GOAL,
  TUTORIAL_GOAL,
  topUp,
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
  fauna: new Set(),
  swarm: 0,
  raidOver: false,
  held: false,
  cast: false,
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
      [{ owned: 0.01 }, 2], // founded: the den
      [{ owned: SPREAD_GOAL }, 2], // the fog explanation waits for Next
      [{ acked: new Set([0, 2]) }, 4], // fog read, spread done
      [{ overlay: "soil" }, 5], // read the soil
      [{ overlay: null }, 6], // closed it
      [{ overlay: "bedrock" }, 7], // rock and water
      [{ overlay: null }, 8], // closed again
      [{ unlocked: grasses }, 8], // unlocked, not planted yet: rabbits would find no food
      [{ plants: grown }, 9],
      [{ layer: 2 }, 10], // a second layer; pushing waits for Next
      [{ acked: new Set([0, 2, 10]) }, 11],
      [{ techOpened: true }, 12], // the grazer kinds wait for Next
      [{ acked: new Set([0, 2, 10, 12]) }, 13],
      [{ animals: 2 }, 14],
      [{ selected: 2 }, 15],
      [{ held: true }, 16], // guarding the den
      [{ born: HERD_BIRTHS }, 17],
      [{ onEnemy: 1 }, 18], // raid
      [{ fauna: new Set(["rabbits"]) }, 18], // no hunter yet: still defending
      [{ fauna: new Set(["rabbits", "great_tit"]) }, 19],
      [{ cast: true }, 20], // a catastrophe
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
    const d = OBJECTIVES.findIndex((o) => o.title === DEFEND_TITLE);
    expect(advance(d, at({ unlocked: tit }))).toBe(d); // waves still coming
    expect(advance(d, at({ unlocked: tit, raidOver: true, swarm: 3 }))).toBe(d); // prey to hunt
    expect(advance(d, at({ unlocked: tit, raidOver: true }))).toBe(d + 1);
  });

  it("does not skip a step done out of order", () => {
    // Rabbits called before the soil overlay was opened do not skip the soil step.
    expect(advance(4, at({ owned: 0.1, animals: 3, selected: 3 }))).toBe(4);
    expect(advance(4, at({ overlay: "moisture" }))).toBe(4); // another overlay
    expect(advance(9, at({ layer: 1 }))).toBe(9); // herbs only
    expect(advance(15, at({ selected: 2, born: 3 }))).toBe(15); // no hold yet
    expect(advance(5, at({ overlay: "soil" }))).toBe(5); // soil still on: not cleared
    expect(advance(6, at({ overlay: "moisture" }))).toBe(7); // moisture counts as well
  });

  it("tops the bank up to a step's need, never down (D-144)", () => {
    const step = OBJECTIVES.findIndex((o) => o.title === "Grow a second layer");
    expect(topUp(step, 200)).toBe(1100);
    expect(topUp(step, 5000)).toBe(0);
    expect(topUp(0, 0)).toBe(0); // no need: nothing granted
  });

  it("never goes back once an objective is done", () => {
    expect(advance(4, at({}))).toBe(4); // land lost after founding: still on the current step
  });
});
