import { describe, expect, it } from "vitest";
import {
  botSpec,
  cleanCode,
  DEFAULT_SETUP,
  forMode,
  loadSetup,
  randomSeed,
  roomCode,
  saveSetup,
  withUrl,
} from "./setup";

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

describe("match setup", () => {
  it("maps the Play modes to a setup (D-137)", () => {
    const hard = { ...DEFAULT_SETUP, bot: "hard" as const, seed: 7 };
    expect(forMode(hard, "sandbox")).toEqual({ ...hard, sandbox: true, bot: "none" });
    expect(forMode(hard, "ai")).toEqual({ ...hard, sandbox: false }); // keeps the level
    expect(forMode({ ...hard, bot: "none" }, "ai").bot).toBe("normal");
    expect(forMode(hard, "online")).toEqual({ ...hard, sandbox: false, bot: "none" });
  });

  it("remembers the chosen setup, and falls back to the default on bad data", () => {
    const store = memory();
    expect(loadSetup(store)).toEqual(DEFAULT_SETUP);
    const chosen = { bot: "hard", style: "rush", seed: 42, sandbox: true, map: "large" } as const;
    saveSetup(chosen, store);
    expect(loadSetup(store)).toEqual(chosen);
    store.setItem("ecoclash.setup", '{"bot":"easy","seed":3,"map":"huge"}');
    expect(loadSetup(store).map).toBe("mid"); // not a size: the default
    store.setItem("ecoclash.setup", '{"bot":"godlike","seed":-3}');
    expect(loadSetup(store)).toEqual(DEFAULT_SETUP);
    store.setItem("ecoclash.setup", "not json");
    expect(loadSetup(store)).toEqual(DEFAULT_SETUP);
  });

  it("lets URL parameters override it", () => {
    const chosen = { bot: "easy", style: "random", seed: 5, sandbox: false, map: "mid" } as const;
    expect(withUrl(chosen, "")).toEqual(chosen);
    expect(withUrl(chosen, "?bot=none&style=tall&seed=9&sandbox=1&map=small")).toEqual({
      bot: "none",
      style: "tall",
      seed: 9,
      sandbox: true,
      map: "small",
    });
  });

  it("tells the worker the bot's level and style (D-228)", () => {
    expect(botSpec({ ...DEFAULT_SETUP, bot: "hard", style: "wide" })).toBe("hard:wide");
    expect(botSpec({ ...DEFAULT_SETUP, bot: "none" })).toBe("none");
    expect(loadSetup(memory()).style).toBe("random");
  });

  it("draws seeds in range", () => {
    for (let i = 0; i < 100; i++) {
      const s = randomSeed();
      expect(s >= 1 && s <= 999_999 && Number.isInteger(s)).toBe(true);
    }
  });
});

describe("online room codes (D-219)", () => {
  it("are 5 letters without look-alikes", () => {
    const code = roomCode();
    expect(code).toMatch(/^[A-HJ-NP-Z]{5}$/);
    expect(roomCode(() => 0.999)).toBe("ZZZZZ");
  });
  it("are cleaned when typed", () => {
    expect(cleanCode(" abc-de ")).toBe("ABCDE");
    expect(cleanCode("ab")).toBe("");
    expect(cleanCode("ABCDEFGHI")).toBe("");
  });
});
