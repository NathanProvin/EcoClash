// Full screen (D-156): the browser's own; the button leaves it. Esc stays with the game (keyboard
// lock, Chromium; a long Esc press still leaves, as browsers require), and phones hold landscape
// (D-269). Shared by the top bar and the phone menu (D-271).

/** A phone in landscape (D-269, D-271): a touch screen at most 500 px tall. The CSS rules for
 *  phones use the same query. */
export const PHONE = "(pointer: coarse) and (max-height: 500px)";

/** Whether the page is on a phone (see PHONE). */
export function isPhone(): boolean {
  return typeof matchMedia === "function" && matchMedia(PHONE).matches;
}

/** Enter or leave full screen; refused (an iframe without permission) does nothing. */
export function toggleFullscreen(): void {
  const done = document.fullscreenElement
    ? document.exitFullscreen()
    : (lockEscape(), document.documentElement.requestFullscreen().then(holdFullscreen));
  done.catch(() => {});
}

/** On entering full screen, however it was entered: keep Esc and hold landscape. */
export function holdFullscreen(): void {
  lockEscape();
  const o = screen.orientation as ScreenOrientation & { lock?: (to: string) => Promise<void> };
  o?.lock?.("landscape").catch(() => {}); // phones, where the browser allows it (Android)
}

/** Keep Esc for the game while in full screen, where the browser supports it. */
function lockEscape(): void {
  const kb = (navigator as Navigator & { keyboard?: { lock?: (keys: string[]) => Promise<void> } })
    .keyboard;
  kb?.lock?.(["Escape"]).catch(() => {});
}
