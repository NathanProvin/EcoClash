import { describe, expect, it } from "vitest";
import { interpolate, isGzip, Replay, type Animal, type ReplayMeta } from "./replay";

/** A 2x2 map, 3 ticks, fields every 2 ticks, built with the export layout of match.py. */
function tiny(): Replay {
  const n = 2;
  const meta: ReplayMeta = {
    version: 1,
    n,
    dt: 0.5,
    ticks: 3,
    field_every: 2,
    builds: ["forest", "meadow"],
    flora: { names: ["grasses"], level: [1] },
    fauna: { names: ["rabbits"], role: ["herbivore"] },
    series: { t_s: [0.5, 1.0], territory_p1: [0.25, 0.5] },
    log: [],
  };
  const ticks: Animal[][] = [[{ id: 7, y: 0, x: 0, species: 0, owner: 1 }], [], []];
  const bytes: number[] = [];
  const u32 = (v: number) => bytes.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, v >>> 24);
  const u16 = (v: number) => bytes.push(v & 255, v >> 8);
  ticks.forEach((animals, tick) => {
    u32(animals.length);
    for (const a of animals) {
      u32(a.id);
      u16(a.y);
      u16(a.x);
      bytes.push(a.species, a.owner);
    }
    if (tick % meta.field_every === 0) {
      bytes.push(...[1, 0, 2, tick], ...[255, 0, 0, 0], ...[0, 128, 0, 0], ...[0, 0, 0, 9]);
    }
  });
  return new Replay(meta, new Uint8Array(bytes).buffer);
}

describe("Replay", () => {
  it("indexes animal and field frames", () => {
    const r = tiny();
    expect(r.animals(0)).toEqual([{ id: 7, y: 0, x: 0, species: 0, owner: 1 }]);
    expect(r.animals(1)).toEqual([]);
    const f = r.fields(1); // latest field frame at or before tick 1 is frame 0
    expect(f.frame).toBe(0);
    expect([...f.owner]).toEqual([1, 0, 2, 0]);
    expect([...(f.cover[1] ?? [])]).toEqual([0, 128, 0, 0]);
    expect([...r.fields(2).owner]).toEqual([1, 0, 2, 2]);
    expect(r.fields(99).frame).toBe(1); // clamped
  });

  it("maps ticks to series rows", () => {
    const r = tiny();
    expect(r.seriesIndex(0)).toBe(0);
    expect(r.seriesIndex(2)).toBe(1);
    expect(r.seriesIndex(50)).toBe(1);
  });

  it("rejects a truncated file", () => {
    const r = tiny();
    expect(() => new Replay(r.meta, new ArrayBuffer(8))).toThrow();
  });
});

describe("interpolate", () => {
  const a = [
    { id: 1, y: 0, x: 0, species: 0, owner: 1 },
    { id: 2, y: 5, x: 5, species: 0, owner: 2 },
  ];
  const b = [
    { id: 1, y: 2, x: 4, species: 0, owner: 1 },
    { id: 3, y: 9, x: 9, species: 0, owner: 1 },
  ];

  it("moves matched animals linearly", () => {
    expect(interpolate(a, b, 0.25)[0]).toMatchObject({ id: 1, y: 0.5, x: 1 });
  });

  it("keeps the dead until halfway, then shows the newborns", () => {
    expect(interpolate(a, b, 0.25).map((x) => x.id)).toEqual([1, 2]);
    expect(interpolate(a, b, 0.75).map((x) => x.id)).toEqual([1, 3]);
  });
});

describe("isGzip", () => {
  it("detects the gzip magic bytes", () => {
    expect(isGzip(new Uint8Array([0x1f, 0x8b, 8]).buffer)).toBe(true);
    expect(isGzip(new Uint8Array([1, 0, 0, 0]).buffer)).toBe(false);
    expect(isGzip(new ArrayBuffer(0))).toBe(false);
  });
});
