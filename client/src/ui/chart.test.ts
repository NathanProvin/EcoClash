import { describe, expect, it } from "vitest";
import { pick, sampleIndices, topValue } from "./chart";

describe("chart data (D-138)", () => {
  it("keeps short series whole and samples long ones, last point included", () => {
    expect(sampleIndices(3)).toEqual([0, 1, 2]);
    const long = sampleIndices(45_000, 400); // a 600-min match at 1.25 field frames per second
    expect(long).toHaveLength(400);
    expect(long[0]).toBe(0);
    expect(long.at(-1)).toBe(44_999);
  });

  it("finds the top of 90 000 values (too many to spread) and ignores non-finite ones", () => {
    const big = Array.from({ length: 90_000 }, (_, i) => i);
    expect(topValue([big, [NaN, Infinity]])).toBe(89_999);
    expect(topValue([[0, 0], []])).toBe(0);
    expect(pick([1, NaN, 3], [0, 1, 2])).toEqual([1, 0, 3]);
  });
});
