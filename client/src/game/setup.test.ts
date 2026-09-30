import { describe, expect, it } from "vitest";
import { DEFAULT_SETUP, loadSetup, randomSeed, saveSetup, withUrl } from "./setup";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("match setup", () => {
  it("remembers the chosen setup, and falls back to the default on bad data", () => {
    const store = memory();
    expect(loadSetup(store)).toEqual(DEFAULT_SETUP);
    saveSetup({ bot: "hard", seed: 42, sandbox: true }, store);
    expect(loadSetup(store)).toEqual({ bot: "hard", seed: 42, sandbox: true });
    store.setItem("ecoclash.setup", '{"bot":"godlike","seed":-3}');
    expect(loadSetup(store)).toEqual(DEFAULT_SETUP);
    store.setItem("ecoclash.setup", "not json");
    expect(loadSetup(store)).toEqual(DEFAULT_SETUP);
  });

  it("lets URL parameters override it", () => {
    const chosen = { bot: "easy", seed: 5, sandbox: false } as const;
    expect(withUrl(chosen, "")).toEqual(chosen);
    expect(withUrl(chosen, "?bot=none&seed=9&sandbox=1")).toEqual({
      bot: "none",
      seed: 9,
      sandbox: true,
    });
  });

  it("draws seeds in range", () => {
    for (let i = 0; i < 100; i++) {
      const s = randomSeed();
      expect(s >= 1 && s <= 999_999 && Number.isInteger(s)).toBe(true);
    }
  });
});
