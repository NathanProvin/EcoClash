import { describe, expect, it } from "vitest";
import {
  captures,
  comboChange,
  FALL,
  incomePops,
  killKind,
  Phrase,
  popStyle,
  RISE,
  ratio,
} from "./juice";

describe("game feel (D-233)", () => {
  it("sums each patch of your land's income over the pulse, largest first", () => {
    const n = 8;
    const owner = new Uint8Array(n * n);
    const income = new Uint8Array(n * n);
    // P1: two cells in the top-left patch (0.5 and 0.25 points/s), one in the bottom-right.
    for (const [k, v] of [
      [0, 50],
      [1, 25],
      [63, 10],
    ] as const) {
      owner[k] = 1;
      income[k] = v;
    }
    owner[2] = 2; // P2's cell: not ours
    income[2] = 99;
    const pops = incomePops(owner, income, n, 1, 3);
    expect(pops).toHaveLength(2);
    expect(pops[0]?.value).toBeCloseTo((0.5 + 0.25) * 3);
    expect(pops[0]?.row).toBeCloseTo(0);
    expect(pops[0]?.col).toBeCloseTo(0.5);
    expect(pops[1]?.value).toBeCloseTo(0.3);
  });

  it("widens the patches so a large territory shows 12 numbers at most (D-234)", () => {
    const n = 38;
    const owner = new Uint8Array(n * n).fill(1);
    const income = new Uint8Array(n * n).fill(20);
    const pops = incomePops(owner, income, n, 1, 3);
    expect(pops.length).toBeLessThanOrEqual(12);
    expect(pops.length).toBeGreaterThan(4);
    const total = pops.reduce((t, p) => t + p.value, 0);
    expect(total).toBeLessThanOrEqual(n * n * 0.2 * 3 + 1e-6);
  });

  it("styles numbers from small and light to large and mossy", () => {
    const low = popStyle(1, 10);
    const high = popStyle(10, 10);
    expect(high.scale).toBeGreaterThan(low.scale);
    expect(high.color).toBe("rgb(79, 125, 46)");
    expect(popStyle(0, 10).color).toBe("rgb(155, 227, 122)");
  });

  it("finds the cells you gained and lost", () => {
    expect(captures([0, 1, 2, 1], [1, 2, 1, 1], 1)).toEqual({ gained: [0, 2], lost: [1] });
  });

  it("climbs the pentatonic scale while captures follow each other, then starts over", () => {
    const rise = new Phrase(RISE, 2000);
    expect([0, 100, 200].map((t) => rise.next(t))).toEqual([0, 2, 4]);
    expect(rise.next(5000)).toBe(0); // after a pause
    const fall = new Phrase(FALL, 2000);
    expect([fall.next(0), fall.next(10)]).toEqual([0, -3]);
    expect(ratio(12)).toBeCloseTo(2);
  });

  it("reports the combo's rises and falls to the hundredth", () => {
    expect(comboChange(1.1, 1.15)).toBe("up");
    expect(comboChange(1.15, 1.1)).toBe("down");
    expect(comboChange(1.1, 1.1001)).toBeNull();
  });

  it("sorts kills into yours and your losses", () => {
    expect(killKind({ hunter: 1, owner: 2 }, 1)).toBe("won");
    expect(killKind({ hunter: 2, owner: 1 }, 1)).toBe("lost");
    expect(killKind({ hunter: 1, owner: 1 }, 1)).toBeNull();
    expect(killKind({ hunter: 2, owner: 2 }, 1)).toBeNull();
  });
});
