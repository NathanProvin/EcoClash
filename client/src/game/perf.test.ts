import { describe, expect, it } from "vitest";
import { censusText, frameStats, Sections } from "./perf";

describe("perf figures (D-198)", () => {
  it("reads fps, median and p90 from frame times", () => {
    const ms = [...Array(9).fill(16), 50];
    const s = frameStats(ms);
    expect(s.median).toBe(16);
    expect(s.p90).toBe(50);
    expect(s.fps).toBeCloseTo(1000 / 19.4, 1);
    expect(frameStats([])).toEqual({ fps: 0, median: 0, p90: 0 });
  });

  it("smooths section timings and lists the largest first", () => {
    const s = new Sections(0.5);
    s.add("render", 4);
    s.add("render", 2);
    s.add("animals", 5);
    expect(s.ms.render).toBe(3);
    expect(s.text()).toBe("animals 5.0 · render 3.0");
  });

  it("prints the census largest family first", () => {
    const t = censusText({
      family: { ground: { tris: 100_000, draws: 3 }, herbs: { tris: 658_000, draws: 48 } },
      shadowTris: 304_000,
    });
    expect(t).toBe("herbs 658k/48 · ground 100k/3 · shadow 304k");
  });
});

describe("resolution guard (D-200)", () => {
  it("steps down after a slow second, to its floor, and back up when fast again", async () => {
    const { ResolutionGuard } = await import("./perf");
    const g = new ResolutionGuard();
    for (let i = 0; i < 60; i++) g.frame(16.7);
    expect(g.scale).toBe(1); // fine at 60 fps
    let changes = 0;
    for (let i = 0; i < 300; i++) g.frame(22); // 45 fps: sharp, no step (D-209)
    expect(g.scale).toBe(1);
    for (let i = 0; i < 400; i++) if (g.frame(50)) changes++; // 20 fps for 20 s
    expect(g.scale).toBe(0.85);
    expect(changes).toBe(2);
    for (let i = 0; i < 300; i++) g.frame(16.7); // 5 s fast
    expect(g.scale).toBeCloseTo(0.95);
  });
});
