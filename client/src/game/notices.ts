// Short order notices (D-170): the sim explains why an order did nothing in a sentence; the toast
// says it in a few words. "{biomass}" stands for the biomass icon (Toasts.svelte draws it).

/** A sim notice ("Elder: not enough biomass for more cells") in its short form
 *  ("Elder: need more {biomass}"); texts without a short form come back unchanged. */
export function shortNotice(text: string): string {
  const m = /^(.+?): (.*)$/.exec(text);
  if (!m) return text;
  const [, who, why = ""] = m;
  if (/not enough biomass|needs? \d+ biomass/i.test(why)) return `${who}: need more {biomass}`;
  if (/^nothing took there/i.test(why)) return `${who}: nothing took root`;
  return text;
}
