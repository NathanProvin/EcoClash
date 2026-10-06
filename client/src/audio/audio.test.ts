import { describe, expect, it } from "vitest";
import { MIX, moodOf } from "./ambience";
import { Gate, LIMITS, panFor, vary } from "./engine";
import { RECIPES, voiceOf } from "./sounds";

describe("audio engine (D-176)", () => {
  it("varies every play a little, never a lot", () => {
    expect(vary(1, 0.06, 0)).toBeCloseTo(0.94);
    expect(vary(1, 0.06, 0.5)).toBeCloseTo(1);
    expect(vary(1, 0.06, 0.999)).toBeLessThan(1.061);
  });

  it("pans by screen position, short of the extremes", () => {
    expect(panFor(0, 1000)).toBeCloseTo(-0.8);
    expect(panFor(500, 1000)).toBeCloseTo(0);
    expect(panFor(5000, 1000)).toBeCloseTo(0.8);
  });

  it("holds a sound back during its cooldown and a bus at its voice limit", () => {
    const g = new Gate();
    expect(g.admit("ui.click", "ui", 0, 50)).toBe(true);
    expect(g.admit("ui.click", "ui", 30, 50)).toBe(false); // too soon
    expect(g.admit("ui.click", "ui", 100, 50)).toBe(true);
    const fx = new Gate();
    for (let i = 0; i < LIMITS.fx; i++) expect(fx.admit(`a${i}`, "fx", 0, 1000)).toBe(true);
    expect(fx.admit("one-more", "fx", 0, 1000)).toBe(false); // the bus is full
    expect(fx.admit("one-more", "fx", 1001, 1000)).toBe(true); // voices ended
  });
});

describe("sounds and ambience (D-176)", () => {
  it("gives every voice a recipe, and silences slugs, worms and fungi", () => {
    for (const [name, body] of [
      ["rabbits", "rabbit"],
      ["fox", "canid"],
      ["bison", "bison"],
      ["great_tit", "bird"],
      ["heron", "wader"],
      ["grasshoppers", undefined],
      ["black_woodpecker", "bird"],
    ] as const) {
      const v = voiceOf(name, body);
      expect(v && RECIPES[v], name).toBeTruthy();
    }
    expect(voiceOf("earthworms", undefined)).toBeNull();
    expect(voiceOf("wolf", "canid")).toBe("animal.howl"); // D-179
    expect(voiceOf("fox", "canid")).toBe("animal.hunter");
  });

  it("has a sprinkle per plant group, water sounds and munching (D-179)", () => {
    for (const id of [
      "fx.plant.herb",
      "fx.plant.shrub",
      "fx.plant.tree",
      "fx.plant.water",
      "fx.plop",
      "fx.trickle",
      "fx.munch",
    ]) {
      expect(RECIPES[id], id).toBeTruthy();
    }
  });

  it("maps the weather to a mood, rain loudest in a flood", () => {
    expect(moodOf(null, "clear")).toBe("clear");
    expect(moodOf("drought", "active")).toBe("drought");
    expect(MIX.flood.rain).toBeGreaterThan(MIX.rain.rain);
  });
});

describe("music (D-180)", () => {
  it("tunes notes and keeps the melody in a soft middle range", async () => {
    const { CHORDS, hz, melodyOf } = await import("./music");
    expect(hz(69)).toBeCloseTo(440);
    expect(hz(60)).toBeCloseTo(261.63, 1);
    for (const chord of CHORDS) {
      const notes = melodyOf(chord);
      expect(notes.length).toBeGreaterThan(2);
      for (const n of notes) {
        expect(n).toBeGreaterThanOrEqual(60);
        expect(n).toBeLessThanOrEqual(84);
      }
    }
  });
});
