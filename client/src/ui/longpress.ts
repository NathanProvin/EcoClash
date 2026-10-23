// Long press = hover on touch screens (D-270). Phones have no hover: a finger held still on the
// HUD for HOLD_MS shows what a mouse would. The element's tooltip (`title`, as desktop browsers
// show it) appears in a bubble above the finger, and the element and its ancestors get the
// pointer-enter a mouse would send, so hover handlers run (strategic icons' unit card, food-web
// focus, card tooltips). Lifting the finger hides it all and swallows the tap that would follow:
// a long press only shows. The map canvas keeps its own long press (the selection box, D-269).

/** A finger held this long (ms) and this still (px) shows the hover. */
export const HOLD_MS = 450;
export const STILL_PX = 10;

/** What `tipOf` reads from an element (a DOM element, or a stand-in in tests). */
export interface TipSource {
  getAttribute(name: string): string | null;
  parentElement: TipSource | null;
}

/** The tooltip a long press shows: the nearest `title` on the element or its ancestors. */
export function tipOf(el: TipSource | null): string | null {
  for (let e = el; e; e = e.parentElement) {
    const t = e.getAttribute("title")?.trim();
    if (t) return t;
  }
  return null;
}

/** The chain a pointer-enter reaches: the element and its ancestors up to `root`. */
function chain(el: Element, root: Element): Element[] {
  const out: Element[] = [];
  for (let e: Element | null = el; e && e !== root; e = e.parentElement) out.push(e);
  return out;
}

/** Pointer-enter or -leave as a mouse would send it (handlers skip touch events, D-269). */
function hover(els: Element[], type: "pointerenter" | "pointerleave", x: number, y: number) {
  for (const e of els) {
    e.dispatchEvent(new PointerEvent(type, { pointerType: "mouse", clientX: x, clientY: y }));
  }
}

/** Install long-press hover under `root`; `show` and `hide` draw the bubble. Returns the
 *  uninstaller. */
export function installLongPress(
  root: HTMLElement,
  show: (text: string, x: number, y: number) => void,
  hide: () => void,
): () => void {
  let press: { x: number; y: number; target: Element; timer: number } | null = null;
  let shown: Element[] | null = null;

  const down = (e: PointerEvent) => {
    end();
    const target = e.target instanceof Element ? e.target : null;
    if (e.pointerType !== "touch" || !target || target instanceof HTMLCanvasElement) return;
    const [x, y] = [e.clientX, e.clientY];
    const timer = window.setTimeout(() => {
      shown = chain(target, root).reverse(); // enters go outermost first, as for a mouse
      hover(shown, "pointerenter", x, y);
      const text = tipOf(target);
      if (text) show(text, x, y);
    }, HOLD_MS);
    press = { x, y, target, timer };
  };
  const move = (e: PointerEvent) => {
    if (press && !shown && Math.hypot(e.clientX - press.x, e.clientY - press.y) > STILL_PX) end();
  };
  /** The press ends: hide what it showed, and swallow the click that follows a shown hover. */
  const end = () => {
    if (press) window.clearTimeout(press.timer);
    if (shown && press) {
      hover([...shown].reverse(), "pointerleave", press.x, press.y);
      hide();
      const swallow = (c: Event) => {
        c.preventDefault();
        c.stopPropagation();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, true), 400);
    }
    [press, shown] = [null, null];
  };
  // Android opens a context menu on a long press: not on the HUD.
  const menu = (e: Event) => {
    if (press) e.preventDefault();
  };

  const opts = { capture: true };
  root.addEventListener("pointerdown", down, opts);
  root.addEventListener("pointermove", move, opts);
  root.addEventListener("pointerup", end, opts);
  root.addEventListener("pointercancel", end, opts);
  root.addEventListener("contextmenu", menu, opts);
  return () => {
    end();
    root.removeEventListener("pointerdown", down, opts);
    root.removeEventListener("pointermove", move, opts);
    root.removeEventListener("pointerup", end, opts);
    root.removeEventListener("pointercancel", end, opts);
    root.removeEventListener("contextmenu", menu, opts);
  };
}
