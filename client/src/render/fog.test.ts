import { describe, expect, it } from "vitest";
import { FOG_RES, fogMask } from "./fog";

describe("fog mask (D-249)", () => {
  it("is clear in sight, dark far off, and ramps smoothly between", () => {
    const n = 12;
    const vis = new Uint8Array(n * n);
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++) if ((r - 4) ** 2 + (c - 4) ** 2 <= 4) vis[r * n + c] = 1; // a sight disc
    const mask = fogMask(vis, vis, n, 200, 100);
    const m = n * FOG_RES;
    const mid = FOG_RES / 2;
    const at = (row: number, col: number) =>
      mask[((n - 1 - row) * FOG_RES + mid) * m + col * FOG_RES + mid] ?? -1;
    expect(mask.length).toBe(m * m);
    expect(at(4, 4)).toBeLessThan(10); // the disc's centre: clear
    expect(at(4, 10)).toBe(200); // far: never seen
    const ramp = new Set(mask);
    expect(ramp.size).toBeGreaterThan(20); // many steps: a smooth edge, not two levels
  });
});
