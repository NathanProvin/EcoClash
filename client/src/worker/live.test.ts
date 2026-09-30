import { afterEach, expect, test, vi } from "vitest";
import { decodeAgents, Live, type ToMain, type ToWorker } from "./live";

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
        { name: "voles", kind: "fauna", level: 3, role: "herbivore" },
      ];
      queueMicrotask(() =>
        this.emit({
          type: "ready",
          me: 1,
          species: JSON.stringify(species),
          n: 2,
          tickHz: 10,
          pace: 1,
          plantRadius: 2,
          dropRadius: 4,
          maxAgents: 2000,
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

/** Animal records, as sim-core's `Fauna::frame` writes them. */
function agents(list: [id: number, y: number, x: number, sp: number, owner: number][]) {
  const buf = new ArrayBuffer(4 + 10 * list.length);
  const v = new DataView(buf);
  v.setUint32(0, list.length, true);
  list.forEach(([id, y, x, sp, owner], k) => {
    const p = 4 + 10 * k;
    v.setUint32(p, id, true);
    v.setUint16(p + 4, y * 256, true);
    v.setUint16(p + 6, x * 256, true);
    v.setUint8(p + 8, sp);
    v.setUint8(p + 9, owner);
  });
  return buf;
}

afterEach(() => vi.unstubAllGlobals());

test("decodes the animal frame, sub-cell positions included", () => {
  expect(decodeAgents(agents([[7, 1.25, 0.5, 0, 2]]))).toEqual([
    { id: 7, y: 1.25, x: 0.5, species: 0, owner: 2 },
  ]);
});

test("live source decodes frames into census, HUD series, animals and cells", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const live = await Live.start(1, 2);
  const worker = FakeWorker.last as FakeWorker;
  expect(live.meta.dt).toBeCloseTo(0.1);
  expect(live.meta.flora.names).toEqual(["grasses", "oak"]);
  expect(live.meta.fauna).toEqual({ names: ["voles"], role: ["herbivore"] });
  expect(live.maxAnimals()).toBe(2000);
  expect(live.counts(0, 1)).toEqual([0, 0, 0]);

  // 2x2 map: owner, soil, grasses cover, oak cover (4 bytes each)
  const frame = new Uint8Array([1, 1, 2, 0, 9, 9, 9, 0, 200, 50, 80, 0, 0, 255, 0, 0]);
  worker.emit({
    type: "fields",
    tick: 8,
    frame: frame.buffer,
    pressure: new Uint8Array(4).buffer,
    bank: [1000, 990],
    income: [4, 2],
    standing: [5000, 4000],
  });
  const unlocked = [
    [1, 0, 1],
    [1, 0, 0],
  ];
  const tick = { hash: "aa", ms: 2, unlocked, result: "", stalled: false, drops: [1, 2] };
  worker.emit({ type: "tick", tick: 8, agents: agents([[1, 0, 0, 0, 1]]), ...tick });
  worker.emit({ type: "tick", tick: 9, agents: agents([[1, 0, 1, 0, 1]]), ...tick });
  expect(live.result).toBeNull();
  expect(live.droppedAt(1)).toBeDefined(); // ids 1 and 2 were dropped: they parachute in
  expect(live.droppedAt(3)).toBeUndefined();
  expect(live.meta.series["standing_p1"]?.[live.seriesIndex()]).toBe(5000);
  expect(live.meta.series["t_s"]?.[live.seriesIndex()]).toBeCloseTo(0.8);
  expect([...live.unlocked(1)]).toEqual(["grasses", "voles"]);
  expect([...live.unlocked(2)]).toEqual(["grasses"]);

  expect(live.tick).toBe(9);
  expect(live.counts(9, 1)).toEqual([2, 1, 1]);
  expect(live.counts(9, 2)).toEqual([1, 0, 0]);
  expect(live.meta.series["territory_p1"]?.[live.seriesIndex()]).toBe(0.5);
  expect(live.meta.series["bank_p2"]?.[live.seriesIndex()]).toBe(990);
  expect(live.meta.series["yield_p1"]?.[live.seriesIndex()]).toBe(4);
  expect(live.cell(9, 0, 1).plants.map((p) => p.name)).toEqual(["grasses", "oak"]);
  expect(live.cell(9, 0, 1).animals).toEqual([{ name: "voles", owner: 1, count: 1 }]);
  expect(live.fields().cover[2]?.[1]).toBe(255);
  expect(live.animals(8)[0]?.x).toBe(0); // the frame before...
  expect(live.animals(9)[0]?.x).toBe(1); // ...and the latest one, to interpolate between
  expect(live.renderTick(0)).toBeGreaterThanOrEqual(8);

  live.spawn(2, "voles", 1, 0);
  expect(worker.sent.at(-1)).toEqual({
    type: "command",
    player: 2,
    payload: { type: "spawn", species: "voles", row: 1, col: 0 },
  });
  live.order(1, [4, 9], "attack", 1, 1);
  expect(worker.sent.at(-1)).toEqual({
    type: "command",
    player: 1,
    payload: { type: "order", ids: [4, 9], kind: "attack", row: 1, col: 1 },
  });
  worker.emit({ type: "notice", notices: [{ player: 2, text: "voles: no enemy food" }] });
  expect(live.notices.map((n) => n.text)).toEqual(["voles: no enemy food"]);
  const verdict = '{"winner":2,"reason":"territory","tick":10}';
  worker.emit({ type: "tick", tick: 10, agents: agents([]), ...tick, result: verdict });
  expect(live.result).toEqual({ winner: 2, reason: "territory", tick: 10 });
  expect(live.me).toBe(1);
  worker.emit({ type: "net", event: "desync", tick: 40 });
  expect(live.netProblem).toContain("tick 40");
});
