<script lang="ts">
  // RTS build bar (D-030, D-063, D-071, D-105): one pictogram per family, in sections (land
  // plants | land animals | water | recyclers), names on hover, so the bar stays short however
  // many species come. Hovering an item opens its
  // flyout at once: the family's species in three tier columns. Hovering a species tile shows its
  // stats; clicking arms it (the next map click plants it or calls the animal; Shift keeps it
  // armed), buys it when it can be unlocked, or does nothing while locked. A click on a family
  // item pins its flyout (touch, keyboard); Esc closes it. With animals selected, a selection
  // strip sits above the bar. Replays show the same bar, read-only.
  import { cardState, families, label, quickStats, roleName } from "../game/species";
  import type { Source, Species } from "../replay/replay";
  import FamilyIcon from "./FamilyIcon.svelte";
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
  /** Tier medals (D-106): bronze, silver, gold. */
  const MEDAL = ["bronze", "silver", "gold"] as const;
  const MEDAL_NAME = ["Tier 1 · small", "Tier 2 · medium", "Tier 3 · large"] as const;
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
      {@const total = g.species.reduce((t, s) => t + count(s), 0)}
      {#if i > 0 && g.section !== groups[i - 1]?.section}<span class="sep" aria-hidden="true"
        ></span>{/if}
      <div class="group" role="group" onpointerenter={() => enter(g.name)} onpointerleave={leave}>
        <button
          class="item"
          class:open={open === g.name}
          class:armed={g.species.some((s) => s.name === planting)}
          aria-expanded={open === g.name}
          aria-label={g.name}
          title={g.name}
          onclick={() => pin(g.name)}
        >
          <FamilyIcon family={g.key} size={40} />
          {#if total}<span class="count num">{total}</span>{/if}
          {#if g.species.every((s) => cardOf(s) === "locked")}
            <span class="lock"><Icon name="lock" size={12} /></span>
          {/if}
        </button>

        {#if open === g.name}
          <div class="flyout panel" role="menu" aria-label="{g.name} species">
            <span class="fh">{g.name}</span>
            <div class="tiers">
              {#each TIERS as t (t)}
                {@const list = g.species.filter((s) => s.tier === t)}
                {#if list.length}
                  <div class="tier">
                    <span class="medal {MEDAL[t - 1]}" title={MEDAL_NAME[t - 1]}></span>
                    {#each list as s (s.name)}
                      {@const state = cardOf(s)}
                      <button
                        class="tile {state} {MEDAL[s.tier - 1] ?? 'bronze'}"
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
                        {#if state === "locked"}
                          <span class="lock"><Icon name="lock" size={12} /></span>
                        {/if}
                      </button>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </nav>

  {#if hover}
    {@const s = hover.s}
    {@const state = cardOf(s)}
    <div class="tip panel" style:left="{hover.x}px" style:top="{hover.y}px" role="tooltip">
      <span class="head">
        <span class="medal {MEDAL[s.tier - 1]}"></span>
        <strong>{label(s.name)}</strong>
        <span class="sub">{s.kind === "flora" ? "plant" : roleName(s.role)}</span>
      </span>
      <span class="stats">
        {#each quickStats(s, replay.meta.pace) as q (q.icon)}
          <span class="stat" title={q.title}><Icon name={q.icon} size={13} />{q.value}</span>
        {/each}
      </span>
      {#if state === "available"}
        <span class="act"><Icon name="unlock" size={12} /> {s.stats.unlock_cost} to unlock</span>
      {:else if state === "locked"}
        <span class="act dim"
          ><Icon name="lock" size={12} /> tier {s.tier - 1}{s.kind === "fauna"
            ? " + habitat plant"
            : ""} first</span
        >
      {/if}
      <em>{s.stats.effect}</em>
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
    align-items: center;
    gap: 3px;
    padding: 6px 8px;
  }
  .sep {
    align-self: stretch;
    width: 1px;
    margin: 4px 4px;
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
    padding: 2px;
    border-radius: 12px;
  }
  .item:hover,
  .item.open {
    border-color: var(--line);
    background: var(--well);
  }
  .flyout {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 4;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 8px 8px;
  }
  .fh {
    font-size: 0.66em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    white-space: nowrap;
    color: var(--ink-soft);
  }
  .tiers {
    display: flex;
    gap: 8px;
  }
  .tier {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  /* Tier medals and rings (D-106): bronze, silver, gold. */
  .bronze {
    --medal: #b08d57;
  }
  .silver {
    --medal: #c3c9cf;
  }
  .gold {
    --medal: #d4af37;
  }
  .medal {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--medal);
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
  }
  .tile {
    box-shadow: inset 0 0 0 1.5px var(--medal);
  }
  .lock {
    position: absolute;
    right: 3px;
    top: 3px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    color: #fff;
    background: rgba(0, 0, 0, 0.6);
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
    opacity: 0.55;
    filter: grayscale(0.85);
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
    bottom: -2px;
    min-width: 18px;
    padding: 0 4px;
    border-radius: 999px;
    font-size: 0.62em;
    font-weight: 700;
    color: white;
    background: var(--player);
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
    gap: 4px;
    width: max-content;
    max-width: 230px;
    padding: 7px 10px;
    font-size: 0.78em;
    pointer-events: none;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .head strong {
    font-size: 1.08em;
  }
  .stats {
    display: grid;
    grid-template-columns: auto auto;
    gap: 3px 12px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .stat {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ink);
  }
  .stat :global(svg) {
    color: var(--ink-soft);
  }
  .sub,
  .dim,
  em {
    color: var(--ink-soft);
  }
  .act {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--gold);
  }
  em {
    font-size: 0.95em;
    line-height: 1.3;
  }
</style>
