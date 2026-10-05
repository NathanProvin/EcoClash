import { describe, expect, it } from "vitest";
import type { Fields } from "../replay/replay";
import { overlayValues, paintOverlay, rampAt } from "./overlays";

// 2x2 map: cell 0 has two plant species, cell 1 one, cells 2-3 none.
const fields: Fields = {
  frame: 1,
  owner: new Uint8Array(4),
  soil: new Uint8Array([0, 255, 51, 0]),
  species: [new Uint8Array([200, 0, 0, 0]), new Uint8Array([10, 30, 0, 0])],
  cover: [new Uint8Array([255, 30, 0, 0]), new Uint8Array(4), new Uint8Array(4), new Uint8Array(4)],
  shade: new Uint8Array([0, 0, 50, 100]),
};

describe("overlays", () => {
  it("maps fields to 0..1", () => {
    const soil = overlayValues("soil", fields, [], 2);
    [0, 1, 0.2, 0].forEach((v, k) => expect(soil[k]).toBeCloseTo(v));
    expect(overlayValues("L1", fields, [], 2)[0]).toBe(1);
    expect([...overlayValues("shade", fields, [], 2)]).toEqual([0, 0, 0.5, 1]); // relative
  });

  it("counts plant and animal species for diversity", () => {
    const animals = [
      { id: 1, x: 1.5, y: 0.2, species: 3, owner: 1 }, // cell 1
      { id: 2, x: 1.6, y: 0.4, species: 3, owner: 2 }, // same species: counted once
      { id: 3, x: 0.5, y: 1.5, species: 1, owner: 1 }, // cell 2
    ];
    expect([...overlayValues("diversity", fields, animals, 2)]).toEqual([1, 1, 0.5, 0]);
  });

  it("paints the ramp, more opaque when high", () => {
    const ramp = ["#000000", "#ffffff"];
    expect(rampAt(ramp, 0.5)).toEqual([128, 128, 128]);
    const out = new Uint8Array(8);
    paintOverlay(new Float32Array([0, 1]), ramp, out);
    expect(out[3]).toBeLessThan(out[7] ?? 0);
    expect([...out.subarray(4, 7)]).toEqual([255, 255, 255]);
  });
});
