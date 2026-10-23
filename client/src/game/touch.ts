// Touch gestures on the map (phones, D-269). One finger drags the map (MapControls pans), a tap
// acts like a click, a long press then a drag draws the selection box, and a second finger makes
// it a pinch (MapControls zooms and rotates). Mouse input never goes through here.

/** What a touch gesture is so far. */
export type Gesture = "pending" | "tap" | "pan" | "box" | "pinch";

/** A finger that travels less than this (px) still taps: fingers jitter more than a mouse. */
export const TAP_PX = 10;
/** A finger held this long (ms) before it travels draws a selection box instead of panning. */
export const LONG_MS = 450;

/** One touch gesture, from the first finger down to the last finger up. Times in ms. */
export class TouchGesture {
  kind: Gesture = "pending";
  /** Where and when the first finger went down. */
  x0 = 0;
  y0 = 0;
  private t0 = 0;
  private fingers = 0;

  /** A finger goes down. A second one makes the gesture a pinch, for good. */
  down(x: number, y: number, t: number): Gesture {
    this.fingers++;
    if (this.fingers === 1 && this.kind !== "pinch") {
      [this.x0, this.y0, this.t0, this.kind] = [x, y, t, "pending"];
    } else {
      this.kind = "pinch";
    }
    return this.kind;
  }

  /** The first finger moves: past TAP_PX it pans, or draws a box when it was held LONG_MS. */
  move(x: number, y: number, t: number): Gesture {
    if (this.kind === "pending" && Math.hypot(x - this.x0, y - this.y0) > TAP_PX) {
      this.kind = t - this.t0 >= LONG_MS ? "box" : "pan";
    }
    return this.kind;
  }

  /** A finger lifts: the gesture's final kind once the last one is up (a still finger taps). */
  up(): Gesture {
    this.fingers = Math.max(this.fingers - 1, 0);
    if (this.kind === "pending") this.kind = "tap";
    const kind = this.kind;
    if (this.fingers === 0) this.kind = "pending";
    return kind;
  }

  /** Whether a finger is still down. */
  get active(): boolean {
    return this.fingers > 0;
  }

  /** The browser took the gesture over (a system swipe): forget it. */
  cancel(): void {
    [this.fingers, this.kind] = [0, "pending"];
  }
}
