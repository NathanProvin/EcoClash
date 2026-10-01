import { expect, test } from "vitest";
import { frontierField } from "./frontier";

/** Channel j of grid cell (r, c), undoing the row flip, as 0..1. */
const at = (out: Uint8Array, n: number, r: number, c: number, j: number) =>
  (out[((n - 1 - r) * n + c) * 4 + j] ?? 0) / 255;

test("each player's ownership is a smooth field crossing 0.5 at the front (D-108)", () => {
  // 6 columns: P1 P1 P1 P2 P2 P2
  const n = 6;
  const owner = new Uint8Array(n * n).map((_, k) => (k % n < 3 ? 1 : 2));
  const out = new Uint8Array(n * n * 4);
  frontierField(owner, n, out);
  const row = (j: number) => Array.from({ length: n }, (_, c) => at(out, n, 2, c, j));
  const p1 = row(0);
  expect(p1[0]).toBe(1); // deep inside, and at the map edge: no crossing there
  expect(p1[2]).toBeGreaterThan(0.5); // the front cell: still P1's side ...
  expect(p1[3]).toBeLessThan(0.5); // ... the crossing lies between columns 2 and 3
  expect((p1[2] ?? 0) - (p1[3] ?? 0)).toBeLessThan(0.6); // a gradual ramp, not a step
  expect(row(1)[3]).toBeGreaterThan(0.5); // P2 mirrors it
});

test("pushes land on the attacker's channel, near the front", () => {
  const n = 6;
  const owner = new Uint8Array(n * n).map((_, k) => (k % n < 3 ? 1 : 2));
  const pressure = new Uint8Array(n * n);
  pressure[2 * n + 3] = 255; // P1 pushes into the P2 cell (2, 3)
  const out = new Uint8Array(n * n * 4);
  frontierField(owner, n, out, pressure);
  expect(at(out, n, 2, 2, 2)).toBeGreaterThan(0); // P1's push, felt on its side of the front
  expect(at(out, n, 2, 2, 3)).toBe(0); // P2 does not push
});
