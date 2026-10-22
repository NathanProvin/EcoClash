import { describe, expect, it } from "vitest";
import { tipOf, type TipSource } from "./longpress";

/** A stand-in element: its attributes and its parent. */
const el = (attrs: Record<string, string>, parentElement: TipSource | null = null): TipSource => ({
  getAttribute: (name) => attrs[name] ?? null,
  parentElement,
});

describe("long-press tooltips", () => {
  it("reads the element's own title", () => {
    expect(tipOf(el({ title: "Menu" }))).toBe("Menu");
  });

  it("falls back to the nearest ancestor with a title (an icon inside a button)", () => {
    const button = el({ title: "Full screen" });
    const icon = el({}, el({ class: "glyph" }, button));
    expect(tipOf(icon)).toBe("Full screen");
  });

  it("shows nothing without a title, and ignores blank ones", () => {
    expect(tipOf(el({ "aria-label": "Fox" }))).toBeNull();
    expect(tipOf(el({ title: "  " }))).toBeNull();
    expect(tipOf(null)).toBeNull();
  });
});
