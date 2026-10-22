import { describe, expect, it } from "vitest";
import { LONG_MS, TAP_PX, TouchGesture } from "./touch";

describe("touch gestures", () => {
  it("a short still touch taps, even with a little jitter", () => {
    const g = new TouchGesture();
    g.down(100, 100, 0);
    expect(g.move(100 + TAP_PX - 1, 100, 50)).toBe("pending");
    expect(g.up()).toBe("tap");
    expect(g.active).toBe(false);
  });

  it("a drag right away pans", () => {
    const g = new TouchGesture();
    g.down(100, 100, 0);
    expect(g.move(140, 100, 80)).toBe("pan");
    expect(g.move(100, 100, LONG_MS + 10)).toBe("pan"); // it stays a pan
    expect(g.up()).toBe("pan");
  });

  it("a long press then a drag draws a box", () => {
    const g = new TouchGesture();
    g.down(100, 100, 0);
    expect(g.move(102, 100, LONG_MS - 100)).toBe("pending");
    expect(g.move(160, 140, LONG_MS + 50)).toBe("box");
    expect(g.up()).toBe("box");
  });

  it("a second finger makes a pinch until every finger is up", () => {
    const g = new TouchGesture();
    g.down(100, 100, 0);
    expect(g.down(200, 100, 30)).toBe("pinch");
    expect(g.move(300, 100, 600)).toBe("pinch");
    expect(g.up()).toBe("pinch");
    expect(g.active).toBe(true);
    expect(g.up()).toBe("pinch");
    expect(g.active).toBe(false);
    // The next touch starts afresh.
    g.down(50, 50, 1000);
    expect(g.up()).toBe("tap");
  });

  it("a cancelled gesture is forgotten", () => {
    const g = new TouchGesture();
    g.down(100, 100, 0);
    g.cancel();
    expect(g.active).toBe(false);
    g.down(10, 10, 5);
    expect(g.up()).toBe("tap");
  });
});
