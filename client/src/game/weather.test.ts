import { describe, expect, it } from "vitest";
import { change, CLEAR, decodeWeather, weatherToasts } from "./weather";

const kinds = [
  { name: "rain", duration_s: 150, effect: "", growth: 1, speed: 1, bite: 1 },
  { name: "drought", duration_s: 150, effect: "", growth: 1, speed: 1, bite: 1 },
];

describe("weather", () => {
  it("writes factors as changes", () => {
    expect(change(1.15)).toBe("+15 %");
    expect(change(0.4)).toBe("−60 %");
    expect(change(1)).toBeNull();
  });

  it("decodes the sim's report", () => {
    expect(decodeWeather([0, 0, 0], kinds, 10)).toEqual(CLEAR);
    expect(decodeWeather([2, 1, 300], kinds, 10)).toEqual({
      kind: "drought",
      phase: "alert",
      seconds: 30,
    });
    expect(decodeWeather([1, 2, 50], kinds, 10)).toEqual({
      kind: "rain",
      phase: "active",
      seconds: 5,
    });
  });

  it("raises one toast per change: alert, start, end", () => {
    const alert = decodeWeather([2, 1, 300], kinds, 10);
    const active = decodeWeather([2, 2, 1500], kinds, 10);
    expect(weatherToasts(CLEAR, alert)[0]).toMatch(/^Weather alert: drought in 30 s/);
    expect(weatherToasts(alert, { ...alert, seconds: 20 })).toEqual([]);
    expect(weatherToasts(alert, active)).toEqual(["Drought has begun"]);
    expect(weatherToasts(active, CLEAR)).toEqual(["The weather clears"]);
    expect(weatherToasts(CLEAR, CLEAR)).toEqual([]);
  });
});
