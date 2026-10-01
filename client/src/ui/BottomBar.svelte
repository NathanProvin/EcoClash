<script lang="ts">
  // RTS build bar (D-030, D-063, D-071): one item per family (herbs, shrubs, trees; soil life …
  // carnivores), so the bar stays short however many species come. Hovering an item opens its
  // flyout at once: the family's species in three tier columns. Hovering a species tile shows its
  // stats; clicking arms it (the next map click plants it or calls the animal; Shift keeps it
  // armed), buys it when it can be unlocked, or does nothing while locked. A click on a family
  // item pins its flyout (touch, keyboard); Esc closes it. With animals selected, a selection
  // strip sits above the bar. Replays show the same bar, read-only.
  import { cardState, families, label, roleName, statLines } from "../game/species";
  import type { Source, Species } from "../replay/replay";
  import Icon from "./Icon.svelte";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    replay,
    tick,
    player,
    selection,
    live,
    planting = $bindable(),
    unlocked,
    onUnlock,
    onPickSpecies,
    onClear,
  }: {
    replay: Source;
    tick: number;
    player: 1 | 2;
    selection: Set<number>;
    live: boolean;
    planting: string | null;
    unlocked: Set<string>;
    onUnlock: (name: string) => void;
    onPickSpecies: (name: string) => void;
    onClear: () => void;
  } = $props();

  const TIERS = [1, 2, 3] as const;
  const GRACE_MS = 120; // time to cross the gap between an item and its flyout

  const species = $derived(replay.meta.species);
  const fauna = $derived(species.filter((s) => s.kind === "fauna"));
  const groups = $derived(families(species));
  const counts = $derived(replay.counts(tick, player));
  const count = (s: Species) => counts[species.indexOf(s)] ?? 0;

  /** Selected animals by species. */
  const picked = $derived.by(() => {
    if (!selection.size) return [];
    const by: Record<string, number> = {};
    for (const a of replay.animals(Math.floor(tick))) {
      const s = fauna[a.species];
      if (s && selection.has(a.id)) by[s.name] = (by[s.name] ?? 0) + 1;
    }
    return fauna.filter((s) => s.name in by).map((s) => ({ s, n: by[s.name] ?? 0 }));
  });

  /** Live cards follow the tech tree: unlocked (arm it), available (buy it), locked. */
  const cardOf = (s: Species) => (live ? cardState(replay.meta, s, unlocked) : "unlocked");

  /** A family item's face: its armed species, else its highest unlocked one, else the first. */
  function face(list: Species[]): Species | undefined {
    const armed = list.find((s) => s.name === planting);
    const open = list.filter((s) => cardOf(s) === "unlocked");
    return armed ?? open[open.length - 1] ?? list[0];
  }

  let open: string | null = $state(null);
  let pinned = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function enter(name: string) {
    clearTimeout(timer);
    if (!pinned || open !== name) pinned = false;
    open = name;
  }
  function leave() {
    if (pinned) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      open = null;
      hover = null;
    }, GRACE_MS);
  }
  function close() {
    open = null;
    pinned = false;
    hover = null; // its tile is gone: no pointer-leave will come
  }
  function pin(name: string) {
    if (open === name && pinned) close();
    else [open, pinned] = [name, true];
  }

  function click(s: Species) {
    const state = cardOf(s);
    if (state === "available") onUnlock(s.name);
    else if (state === "unlocked" && live) {
      planting = planting === s.name ? null : s.name;
      if (planting) close(); // the map is free for the drop
    }
  }

  // The dock is transformed, so the tooltip is placed in the dock's own coordinates.
  let dock: HTMLElement | undefined = $state();
  let hover: { s: Species; x: number; y: number } | null = $state(null);
  function show(e: PointerEvent, s: Species) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const d = dock?.getBoundingClientRect() ?? { left: 0, top: 0 };
    hover = { s, x: r.left + r.width / 2 - d.left, y: r.top - 10 - d.top }; // above the tile
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<footer class="dock p{player}" bind:this={dock}>
  {#if picked.length}
    <div class="selection panel" aria-label="Selection">
      {#each picked as { s, n } (s.name)}
        <button
          class="pick"
          onclick={() => onPickSpecies(s.name)}
          title="Select only {label(s.name)}"
        >
          <SpeciesIcon {s} size={30} />
          <span class="num">×{n}</span>
        </button>
      {/each}
      <span class="keys">Right-click move · A attack · S stop · Ctrl 1-9 group</span>
      <button class="x" onclick={onClear} aria-label="Clear selection">✕</button>
    </div>
  {/if}

  <nav class="bar panel" aria-label="Species">
    {#each groups as g, i (g.name)}
      {@const s0 = face(g.species)}
      {@const total = g.species.reduce((t, s) => t + count(s), 0)}
      {#if i > 0 && g.kind !== groups[i - 1]?.kind}<span class="sep" aria-hidden="true"></span>{/if}
      <div class="group" role="group" onpointerenter={() => enter(g.name)} onpointerleave={leave}>
        <button
          class="item"
          class:open={open === g.name}
          class:armed={g.species.some((s) => s.name === planting)}
          aria-expanded={open === g.name}
          aria-label={g.name}
          onclick={() => pin(g.name)}
        >
          {#if s0}<SpeciesIcon s={s0} size={40} />{/if}
          {#if total}<span class="count num">{total}</span>{/if}
          {#if g.species.some((s) => cardOf(s) === "available")}
            <span class="unlock" title="A species can be unlocked"
              ><Icon name="unlock" size={11} /></span
            >
          {/if}
          <span class="fam">{g.name}</span>
        </button>

        {#if open === g.name}
          <div class="flyout panel" role="menu" aria-label="{g.name} species">
            {#each TIERS as t (t)}
              {@const list = g.species.filter((s) => s.tier === t)}
              {#if list.length}
                <div class="tier">
                  <span class="tl">Tier {t}</span>
                  {#each list as s (s.name)}
                    {@const state = cardOf(s)}
                    <button
                      class="tile {state}"
                      class:armed={planting === s.name}
                      class:none={count(s) === 0 && state === "unlocked"}
                      role="menuitem"
                      aria-label={label(s.name)}
                      onclick={() => click(s)}
                      onpointerenter={(e) => show(e, s)}
                      onpointerleave={() => (hover = null)}
                    >
                      <SpeciesIcon {s} size={38} />
                      {#if count(s)}<span class="count num">{count(s)}</span>{/if}
                      {#if state === "available"}
                        <span class="unlock"><Icon name="unlock" size={11} /></span>
                      {/if}
                    </button>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </nav>

  {#if hover}
    {@const s = hover.s}
    {@const state = cardOf(s)}
    <div class="tip panel" style:left="{hover.x}px" style:top="{hover.y}px" role="tooltip">
      <strong>{label(s.name)}</strong>
      <span class="sub">tier {s.tier} · {s.kind === "flora" ? "plant" : roleName(s.role)}</span>
      {#each statLines(s, replay.meta.pace) as line (line)}<span>{line}</span>{/each}
      <em>{s.stats.effect}</em>
      {#if state === "available"}
        <span class="act">Click to unlock · {s.stats.unlock_cost}</span>
      {:else if state === "locked"}
        <span class="act dim"
          >Locked: needs a tier {s.tier - 1}
          {s.kind === "flora" ? "plant" : "animal"} of this family{s.kind === "fauna"
            ? " and a habitat plant"
            : ""}</span
        >
      {:else if live}
        <span class="act">Click, then the map · hold Shift to keep dropping</span>
      {/if}
    </div>
  {/if}
</footer>

<style>
  .dock {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 24px);
  }
  .bar {
    display: flex;
    align-items: flex-start; /* icons in one row, whatever the label lines */
    gap: 2px;
    padding: 8px 12px 6px;
  }
  .sep {
    align-self: stretch;
    width: 1px;
    margin: 4px 6px;
    background: var(--line);
  }
  .group {
    position: relative;
  }
  .item,
  .tile {
    position: relative;
    border: 1px solid transparent;
    background: none;
    cursor: pointer;
    transition:
      transform 0.12s,
      border-color 0.12s,
      opacity 0.12s;
  }
  .item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 3px 4px 2px;
    border-radius: 12px;
  }
  .item:hover,
  .item.open {
    border-color: var(--line);
    background: var(--well);
  }
  .fam {
    width: 6.6em; /* long family names wrap on two lines (D-087) */
    font-size: 0.6em;
    line-height: 1.15;
    letter-spacing: 0.06em;
    text-align: center;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .flyout {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    gap: 10px;
    padding: 8px 10px;
  }
  .tier {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .tl {
    font-size: 0.58em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .tile {
    padding: 2px;
    border-radius: 11px;
  }
  .tile:hover {
    transform: translateY(-2px);
    border-color: var(--line);
  }
  .tile.none {
    opacity: 0.7;
  }
  .tile.locked {
    opacity: 0.28;
    filter: grayscale(0.9);
    cursor: default;
  }
  .tile.available {
    opacity: 0.75;
  }
  .tile.armed,
  .item.armed {
    border-color: var(--gold);
    box-shadow: 0 0 12px var(--gold-soft);
  }
  .count {
    position: absolute;
    right: -2px;
    top: 30px;
    min-width: 18px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 0.62em;
    font-weight: 700;
    color: white;
    background: var(--player);
  }
  .tile .count {
    top: auto;
    bottom: -2px;
  }
  .unlock {
    position: absolute;
    right: -3px;
    top: -3px;
    display: grid;
    place-items: center;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    color: #1d160a;
    background: var(--gold);
  }
  .selection {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: none;
    cursor: pointer;
    font-size: 0.8em;
  }
  .keys {
    margin-left: 6px;
    font-size: 0.72em;
    color: var(--ink-soft);
  }
  .x {
    border: 0;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .tip {
    position: absolute;
    transform: translate(-50%, -100%);
    z-index: 5;
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-width: 280px;
    font-size: 0.8em;
    pointer-events: none;
  }
  .tip strong {
    font-size: 1.1em;
  }
  .sub,
  .dim,
  em {
    color: var(--ink-soft);
  }
  .act {
    margin-top: 4px;
    color: var(--gold);
  }
</style>
