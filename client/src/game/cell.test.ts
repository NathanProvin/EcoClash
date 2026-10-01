import { expect, it } from "vitest";
import type { CellInfo } from "../replay/replay";
import { cellStatus } from "./cell";

const base: CellInfo = {
  row: 0,
  col: 0,
  owner: 1,
  soil: 0.5,
  ground: 0,
  strata: [0.5, 0, 0, 0],
  push: 0,
  lock: null,
  plants: [],
  animals: [],
};

it("rates a cell at a glance (D-100)", () => {
  expect(cellStatus(base)).toBe("good");
  expect(cellStatus({ ...base, push: 0.2 })).toBe("warn");
  expect(cellStatus({ ...base, push: 0.6 })).toBe("danger");
  const raid = [{ name: "rabbits", owner: 2, count: 3 }];
  expect(cellStatus({ ...base, animals: raid })).toBe("danger");
  const own = [{ name: "rabbits", owner: 1, count: 3 }];
  expect(cellStatus({ ...base, animals: own })).toBe("good");
  expect(cellStatus({ ...base, owner: 0 })).toBe("none");
  expect(cellStatus({ ...base, owner: 0, lock: { player: 2, s: 12 } })).toBe("warn");
});
