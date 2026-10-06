import { describe, expect, it } from "vitest";
import { shortNotice } from "./notices";

describe("shortNotice (D-170)", () => {
  it("says a lack of biomass in a few words", () => {
    expect(shortNotice("Elder: not enough biomass for more cells")).toBe(
      "Elder: need more {biomass}",
    );
    expect(shortNotice("Rabbits: not enough biomass")).toBe("Rabbits: need more {biomass}");
    expect(shortNotice("Nettle: needs 900 biomass")).toBe("Nettle: need more {biomass}");
  });

  it("shortens a planting that took nowhere, and leaves the rest", () => {
    expect(shortNotice("Oak: nothing took there (soil too poor, land taken, or cap reached)")).toBe(
      "Oak: nothing took root",
    );
    expect(shortNotice("Fox: no prey in reach")).toBe("Fox: no prey in reach");
  });
});
