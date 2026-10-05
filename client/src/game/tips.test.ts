import { describe, expect, it } from "vitest";
import { ALL_TIPS, loadSeen, saveSeen, TIP_GAP_S, TipWatch, type Progress } from "./tips";

const start: Progress = { t: 0, canUnlock: false, animalsUnlocked: 0, animals: 0, raided: false };

describe("TipWatch", () => {
  it("offers tips when they become useful, one at a time, each once", () => {
    const w = new TipWatch(new Set());
    expect(w.scan(start)).toBeNull();
    expect(w.scan({ ...start, t: 3 })).toMatch(/spread on their own/);
    expect(w.scan({ ...start, t: 4, canUnlock: true })).toBeNull(); // too soon after the last
    expect(w.scan({ ...start, t: 3 + TIP_GAP_S, canUnlock: true })).toMatch(/padlock/);
    const later = { ...start, t: 100, canUnlock: true, animals: 5 };
    expect(w.scan(later)).toMatch(/Hold Shift/);
    expect(w.scan({ ...later, t: 130 })).toMatch(/smother/);
    expect(w.scan({ ...later, t: 160 })).toMatch(/right-click/);
    expect(w.scan({ ...later, t: 190 })).toMatch(/Win by taking/); // icons wait for a herd
    expect(w.scan({ ...later, t: 220 })).toBeNull(); // nothing left that applies
    expect(w.scan({ ...later, t: 250, animals: 6 })).toMatch(/Press I/);
  });

  it("skips seen tips, remembers new ones, and stays silent when tips are off", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const w = new TipWatch(loadSeen(storage), (s) => saveSeen(s, storage));
    w.scan({ ...start, t: 3 });
    expect([...loadSeen(storage)]).toEqual(["spread"]);
    const again = new TipWatch(loadSeen(storage));
    expect(again.scan({ ...start, t: 3 })).toBeNull();
    expect(new TipWatch(ALL_TIPS()).scan({ ...start, t: 999, canUnlock: true })).toBeNull();
  });
});
