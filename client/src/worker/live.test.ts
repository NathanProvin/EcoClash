import { afterEach, expect, test, vi } from "vitest";
import { AGENT_BYTES, decodeAgents, Live, type ToMain, type ToWorker } from "./live";

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
        { name: "grasses", kind: "flora", family: "L1", level: 1 },
        { name: "oak", kind: "flora", family: "L4", level: 4 },
        { name: "rabbits", kind: "fauna", family: "H1", level: 0, role: "herbivore" },
      ];
      queueMicrotask(() =>
        this.emit({
          type: "ready",
          me: 1,
          species: JSON.stringify(species),
          catastrophes: JSON.stringify([
            {
              name: "storm",
              act: "storm",
              cost: 9000,
              radius: 9,
              cooldown_s: 420,
              duration_s: 6,
              effect: "",
            },
          ]),
          weather: JSON.stringify({
            warning_s: 30,
            kinds: [
              { name: "flood", duration_s: 120, effect: "", growth: 0.85, speed: 0.85, bite: 1 },
            ],
          }),
          n: 2,
          tickHz: 10,
          pace: 1,
          plantRadius: 2,
          dropRadius: 4,
          victory: 0.6,
          timeLimitS: 1200,
          terrain: new Uint8Array(8).buffer,
          reliefM: 8,
          botStyles: "2:wide",
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
function agents(
  list: [
    id: number,
    y: number,
    x: number,
    sp: number,
    owner: number,
    full?: number,
    order?: number,
  ][],
) {
  const buf = new ArrayBuffer(4 + AGENT_BYTES * list.length);
  const v = new DataView(buf);
  v.setUint32(0, list.length, true);
  list.forEach(([id, y, x, sp, owner, full = 0, order = 0], k) => {
    const p = 4 + AGENT_BYTES * k;
    v.setUint32(p, id, true);
    v.setUint16(p + 4, y * 256, true);
    v.setUint16(p + 6, x * 256, true);
    v.setUint8(p + 8, sp);
    v.setUint8(p + 9, owner);
    v.setUint8(p + 10, full);
    v.setUint8(p + 11, order);
  });
  return buf;
}

afterEach(() => vi.unstubAllGlobals());

test("decodes the animal frame, sub-cell positions included", () => {
  expect(decodeAgents(agents([[7, 1.25, 0.5, 0, 2, 255, 2]]))).toEqual([
    { id: 7, y: 1.25, x: 0.5, species: 0, owner: 2, full: 1, order: 2 },
  ]);
});

test("live source decodes frames into census, HUD series, animals and cells", async () => {
  vi.stubGlobal("Worker", FakeWorker);
  const live = await Live.start(1, 2);
  const worker = FakeWorker.last as FakeWorker;
  expect(live.meta.dt).toBeCloseTo(0.1);
  expect(live.meta.flora.names).toEqual(["grasses", "oak"]);
  expect(live.meta.fauna).toEqual({ names: ["rabbits"], role: ["herbivore"] });
  expect(live.maxAnimals()).toBe(2000);
  expect(live.counts(0, 1)).toEqual([0, 0, 0]);

  // 2x2 map: owner, soil, grasses cover, oak cover (4 bytes each)
  const frame = new Uint8Array([1, 1, 2, 0, 9, 9, 9, 0, 200, 50, 80, 0, 0, 255, 0, 0]);
  worker.emit({
    type: "fields",
    tick: 8,
    frame: frame.buffer,
    pressure: new Uint8Array([0, 128, 0, 0]).buffer,
    lock: new Uint8Array([0, 0, 0, 0, 2, 12, 0, 0]).buffer, // cell 2: P2 barred for 12 s
    deadwood: new Uint8Array([0, 0, 0, 51]).buffer, // cell 3: a dead tree (D-127)
    flood: [2], // cell 2 under flood water (D-132)
    shade: new Uint8Array([0, 0, 0, 90]).buffer, // D-135
    moisture: new Uint8Array([60, 60, 255, 60]).buffer,
    bank: [1000, 990],
    income: [4, 2],
    standing: [5000, 4000],
    victory: 0.8,
  });
  const unlocked = [
    [1, 0, 1],
    [1, 0, 0],
  ];
  const tick = {
    hash: "aa",
    ms: 2,
    unlocked,
    result: "",
    stalled: false,
    drops: [1, 2],
    waits: [[50], [0]], // P1's storm: 5 s to go at 10 Hz (D-129)
    effects: [2, 0, 3, 4], // P2 cast a storm at (3, 4)
    weather: [1, 2, 600], // a flood at work for 60 s more (D-132)
  };
  worker.emit({ type: "tick", tick: 8, agents: agents([[1, 0, 0, 0, 1]]), ...tick });
  worker.emit({ type: "tick", tick: 9, agents: agents([[1, 0, 1, 0, 1]]), ...tick });
  expect(live.result).toBeNull();
  expect(live.droppedAt(1)).toBeDefined(); // ids 1 and 2 were dropped: they parachute in
  expect(live.droppedAt(3)).toBeUndefined();
  expect([live.wasCalled(2), live.wasCalled(3)]).toEqual([true, false]); // 3 was born (D-141)
  expect(live.meta.series["standing_p1"]?.[live.seriesIndex()]).toBe(5000);
  expect(live.meta.series["t_s"]?.[live.seriesIndex()]).toBeCloseTo(0.8);
  expect([...live.unlocked(1)]).toEqual(["grasses", "rabbits"]);
  expect([...live.unlocked(2)]).toEqual(["grasses"]);
  expect(live.waits[0]).toEqual([5]); // D-129: ticks to seconds
  expect(live.takeEffects()[0]).toEqual({ player: 2, card: 0, row: 3, col: 4 });
  expect(live.takeEffects()).toEqual([]); // drained
  expect(live.catastrophes[0]?.name).toBe("storm");
  expect(live.weather).toEqual({ kind: "flood", phase: "active", seconds: 60 });
  expect(live.fields().flood).toEqual([2]);
  expect(live.fields().shade?.[3]).toBe(90);
  expect(live.fields().moisture?.[2]).toBe(255);

  expect(live.tick).toBe(9);
  expect(live.counts(9, 1)).toEqual([2, 1, 1]);
  expect(live.counts(9, 2)).toEqual([1, 0, 0]);
  expect(live.meta.series["territory_p1"]?.[live.seriesIndex()]).toBe(0.5);
  expect(live.meta.series["bank_p2"]?.[live.seriesIndex()]).toBe(990);
  expect(live.meta.series["yield_p1"]?.[live.seriesIndex()]).toBe(4);
  expect(live.cell(9, 0, 1).plants.map((p) => p.name)).toEqual(["grasses", "oak"]);
  expect(live.cell(9, 0, 1).animals).toEqual([{ name: "rabbits", owner: 1, count: 1 }]);
  expect(live.cell(9, 0, 1).push).toBeCloseTo(128 / 255); // D-100
  expect(live.cell(9, 1, 0).lock).toEqual({ player: 2, s: 12 }); // D-098
  expect(live.cell(9, 0, 0).lock).toBeNull();
  expect(live.cell(9, 1, 1).deadwood).toBeCloseTo(51 / 255); // D-127
  expect(live.fields().cover[3]?.[1]).toBe(255);
  expect(live.animals(8)[0]?.x).toBe(0); // the frame before...
  expect(live.animals(9)[0]?.x).toBe(1); // ...and the latest one, to interpolate between
  expect(live.renderTick(0)).toBeGreaterThanOrEqual(8);

  live.spawn(2, "rabbits", 1, 0);
  expect(worker.sent.at(-1)).toEqual({
    type: "command",
    player: 2,
    payload: { type: "spawn", species: "rabbits", row: 1, col: 0 },
  });
  live.order(1, [4, 9], "attack", 1, 1);
  expect(worker.sent.at(-1)).toEqual({
    type: "command",
    player: 1,
    payload: { type: "order", ids: [4, 9], kind: "attack", row: 1, col: 1 },
  });
  worker.emit({ type: "notice", notices: [{ player: 2, text: "rabbits: no enemy food" }] });
  expect(live.notices.map((n) => n.text)).toEqual(["rabbits: no enemy food"]);
  const verdict = '{"winner":2,"reason":"territory","tick":10}';
  worker.emit({ type: "tick", tick: 10, agents: agents([]), ...tick, result: verdict });
  expect(live.result).toEqual({ winner: 2, reason: "territory", tick: 10 });
  expect(live.me).toBe(1);
  worker.emit({ type: "net", event: "desync", tick: 40 });
  expect(live.netProblem).toContain("tick 40");
  expect(live.result?.reason).toBe("territory"); // a decided match keeps its verdict (D-221)
  live.result = null; // undecided: a desync voids the match, and a later leave changes nothing
  worker.emit({ type: "net", event: "desync", tick: 50 });
  expect(live.result).toEqual({ winner: 0, reason: "desync", tick: 50 });
  worker.emit({ type: "net", event: "left", tick: 0 });
  expect(live.result).toMatchObject({ reason: "desync" });
  live.result = null; // the other player leaves: this one wins
  worker.emit({ type: "net", event: "left", tick: 0 });
  expect(live.result).toMatchObject({ winner: 1, reason: "left" });
});
