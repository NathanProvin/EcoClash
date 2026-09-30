import { expect, test } from "vitest";
import { paintFrontier, TEXELS, widthFor, WIDTH } from "./frontier";

const color = { 1: [0, 0, 255], 2: [255, 128, 0] } as const;

/** Alpha of the texel at grid-space (x, y), undoing the row flip. */
function alpha(out: Uint8Array, side: number, x: number, y: number): number {
  return out[((side - 1 - y) * side + x) * 4 + 3] ?? 0;
}

test("P1 frontier is solid, P2 frontier is dashed, interiors and map edges stay clear", () => {
  // 4 columns: P1 P1 P2 P2, on 4 rows
  const n = 4;
  const owner = new Uint8Array(n * n).map((_, k) => (k % n < 2 ? 1 : 2));
  const side = n * TEXELS;
  const out = new Uint8Array(side * side * 4);
  paintFrontier(owner, n, color, out);

  const p1Line = TEXELS * 2 - 1; // last texel column of the P1 cells
  const p2Line = TEXELS * 2; // first texel column of the P2 cells
  const p1 = Array.from({ length: side }, (_, y) => alpha(out, side, p1Line, y));
  const p2 = Array.from({ length: side }, (_, y) => alpha(out, side, p2Line, y));
  expect(p1.every((a) => a === 255)).toBe(true);
  expect(p2.filter((a) => a === 255).length).toBe(side / 2);
  expect(p2.some((a) => a === 0)).toBe(true);

  // map edges and cell interiors: nothing
  for (let y = 0; y < side; y++) {
    expect(alpha(out, side, 0, y)).toBe(0);
    expect(alpha(out, side, side - 1, y)).toBe(0);
    expect(alpha(out, side, 1, y)).toBe(0);
  }
  // colour of P1's line
  const t = ((side - 1) * side + p1Line) * 4;
  expect([...out.subarray(t, t + 3)]).toEqual([0, 0, 255]);
});

test("a line widens with its player's push into the enemy cell across the edge (D-076)", () => {
  expect(widthFor(0)).toBe(WIDTH.min);
  expect(widthFor(255)).toBe(WIDTH.max);
  const n = 4;
  const owner = new Uint8Array(n * n).map((_, k) => (k % n < 2 ? 1 : 2));
  // P1 pushes hard into row 0 of P2's first column, not at all elsewhere.
  const pressure = new Uint8Array(n * n);
  pressure[2] = 255;
  const side = n * TEXELS;
  const out = new Uint8Array(side * side * 4);
  paintFrontier(owner, n, color, out, pressure);
  const edge = TEXELS * 2 - 1; // P1's last texel column
  const widthAt = (y: number) => {
    let w = 0;
    while (w < TEXELS && alpha(out, side, edge - w, y) === 255) w++;
    return w;
  };
  expect(widthAt(1)).toBe(WIDTH.max); // row 0 of cells: the push
  expect(widthAt(TEXELS + 1)).toBe(WIDTH.min); // row 1: no push
});
