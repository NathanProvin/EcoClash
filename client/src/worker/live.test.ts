import { afterEach, expect, test, vi } from "vitest";
import { Live, type ToMain, type ToWorker } from "./live";

/** Stands in for the sim worker: answers "start" with "ready", and lets the test post frames. */
class FakeWorker {
  static last: FakeWorker | undefined;
  onmessage: ((e: { data: ToMain }) => void) | null = null;
  onerror: unknown = null;
  sent: ToWorker[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(m: ToWorker) {
    this.sent.push(m);
    if (m.type === "start") {
      const species = [
        { name: "grasses", kind: "flora", level: 1 },
        { name: "oak", kind: "flora", level: 3 },
      ];
      queueMicrotask(() =>
        this.emit({
          type: "ready",
          species: JSON.stringify(species),
          n: 2,
          tickHz: 10,
          plantRadius: 2,
          balanceHash: "0",
        }),
      );
    }
  }
  emit(data: ToMain) {
    this.onmessage?.({ data });
  }
  terminate() {}
}

afterEach(() => vi.unstubAllGlobals());

test("live source decodes frames into census, HUD series and cells", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const live = await Live.start(1, 2);
  const worker = FakeWorker.last as FakeWorker;
  expect(live.meta.dt).toBeCloseTo(0.1);
  expect(live.counts(0, 1)).toEqual([0, 0]);

  // 2x2 map: owner, soil, grasses cover, oak cover (4 bytes each)
  const frame = new Uint8Array([1, 1, 2, 0, 9, 9, 9, 0, 200, 50, 80, 0, 0, 255, 0, 0]);
  worker.emit({ type: "fields", tick: 8, frame: frame.buffer, bank: [1000, 990], income: [4, 2] });
  worker.emit({ type: "tick", tick: 9, hash: "ab", ms: 2 });

  expect(live.tick).toBe(9);
  expect(live.counts(9, 1)).toEqual([2, 1]);
  expect(live.counts(9, 2)).toEqual([1, 0]);
  expect(live.meta.series["territory_p1"]?.[live.seriesIndex()]).toBe(0.5);
  expect(live.meta.series["species_p2"]?.[live.seriesIndex()]).toBe(1);
  expect(live.meta.series["bank_p2"]?.[live.seriesIndex()]).toBe(990);
  expect(live.meta.series["yield_p1"]?.[live.seriesIndex()]).toBe(4);
  expect(live.cell(9, 0, 1).plants.map((p) => p.name)).toEqual(["grasses", "oak"]);
  expect(live.fields().cover[2]?.[1]).toBe(255);

  live.plant(2, "oak", 1, 0);
  expect(worker.sent.at(-1)).toEqual({
    type: "command",
    player: 2,
    payload: { type: "plant", species: "oak", row: 1, col: 0, radius: 2 },
  });
});
