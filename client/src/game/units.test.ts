import { describe, expect, it } from "vitest";
import type { Animal } from "../replay/replay";
import { unitCard } from "./units";

const a = (id: number, species: number, full: number, order: number): Animal => ({
  id,
  y: 0,
  x: 0,
  species,
  owner: 1,
  full,
  order,
});

describe("unitCard (D-161)", () => {
  it("sums up the live animals of a group: main species, count, mean fullness, main order", () => {
    const animals = [a(1, 3, 1, 2), a(2, 3, 0.5, 2), a(3, 4, 0, 0), a(9, 3, 1, 1)];
    expect(unitCard(animals, [1, 2, 3, 7])).toEqual({
      species: 3,
      owner: 1,
      count: 3,
      full: 0.5,
      order: 2,
    });
  });

  it("is null once every animal of the group is gone", () => {
    expect(unitCard([a(1, 0, 1, 0)], [5])).toBeNull();
  });
});
