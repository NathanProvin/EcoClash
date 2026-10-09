<script lang="ts">
  // RTS build bar (D-030, D-063, D-071, D-105): one pictogram per family, in sections (land
  // plants | land animals | water | recyclers), names on hover, so the bar stays short however
  // many species come. Hovering an item opens its
  // flyout at once: the family's species in three tier columns. Hovering a species tile shows its
  // stats; clicking arms it (the next map click plants it or calls the animal; Shift keeps it
  // armed), buys it when it can be unlocked, or does nothing while locked. A click on a family
  // item pins its flyout (touch, keyboard); Esc closes it. With animals selected, a selection
  // strip sits above the bar. Replays show the same bar, read-only. With a species in focus (a
  // strategic icon clicked, D-232), its predators wear a red ring, its prey a mossy green one,
  // and every other family and tile is greyed out.
  import { webRoles } from "../game/foodweb";
  import {
    cardState,
    families,
    lockText,
    foodsOf,
    label,
    MEDAL,
    quickStats,
    roleName,
    dropsOf,
    groundOf,
    rockIndex,
    rockOf,
    BEDROCK_SHORT,
    discCells,
  } from "../game/species";
  import type { Source, Species } from "../replay/replay";
  import { OVERLAY_RAMPS } from "../render/palette";
  import type { Catastrophe } from "../game/catastrophes";
  import CatastropheDeck from "./CatastropheDeck.svelte";
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
    catastrophes = [],
    waits = [],
    castArmed = null,
    onCast = () => {},
    popped = null,
    focus = null,
    suit = null,
    plantRadius = 2,
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
    /** Catastrophe cards (D-129; live matches), seconds before each is ready, the armed one. */
    catastrophes?: Catastrophe[];
    waits?: number[];
    castArmed?: string | null;
    onCast?: (name: string) => void;
    /** The species just unlocked: its card and family tile pop (D-169). */
    popped?: string | null;
    /** The species whose food web the bar lights (D-232). */
    focus?: Species | null;
    /** How well each plant suits the selected cell, 0..1 (D-240): tiles desaturate with it. */
    suit?: ReadonlyMap<string, number> | null;
    /** The planting disc's radius (D-242): plant costs are shown per full planting. */
    plantRadius?: number;
  } = $props();

  const TIERS = [1, 2, 3] as const;
  /** Tier medals (D-106): bronze, silver, gold. */
  const MEDAL_NAME = ["Tier 1 · small", "Tier 2 · medium", "Tier 3 · large"] as const;
  const GRACE_MS = 120; // time to cross the gap between an item and its flyout

  const species = $derived(replay.meta.species);
  const fauna = $derived(species.filter((s) => s.kind === "fauna"));
  const groups = $derived(families(species));
  /** The focused species' prey and predators by name (D-232). */
  const roles = $derived(focus ? webRoles(focus, species) : null);
  /** A species' place in the focus: its role, "dim" when unrelated, "" without a focus. */
  const web = (name: string) =>
    roles ? (roles.get(name) ?? (name === focus?.name ? "" : "dim")) : "";
  /** A family's place: predator if one of its species is, else prey, else dim. */
  const webOf = (names: string[]) => {
    if (!roles) return "";
    const r = names.map(web);
    return r.includes("predator")
      ? "predator"
      : r.includes("prey")
        ? "prey"
        : r.includes("")
          ? ""
          : "dim";
  };
  /** A tile's saturation for the selected cell (D-240), when no food-web focus is shown. */
  const tint = (names: string[]) => {
    if (roles || !suit) return undefined;
    const v = names.map((n) => suit.get(n)).filter((x) => x !== undefined);
    return v.length ? `saturate(${(0.2 + 0.8 * Math.max(...v)).toFixed(2)})` : undefined;
  };
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

  /** Biomass in the bank now, and how far it goes toward unlocking `s` (0..1; D-119). */
  const bank = $derived.by(() => {
    void tick; // the series grows in place: read it again every tick
    return replay.meta.series[`bank_p${player}`]?.at(-1) ?? 0;
  });
  const funded = (s: Species) =>
    s.stats.unlock_cost > 0 ? Math.min(bank / s.stats.unlock_cost, 1) : 1;

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
    // To the right of the tile (D-242), its middle level with the tile's.
    hover = { s, x: r.right + 10 - d.left, y: r.top + r.height / 2 - d.top };
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

{#if picked.length}
  <div class="selection panel p{player}" aria-label="Selection">
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
<footer class="dock p{player}" bind:this={dock}>
  <nav class="bar panel" aria-label="Species">
    {#each groups as g, i (g.name)}
      {@const total = g.species.reduce((t, s) => t + count(s), 0)}
      {#if i > 0 && g.section !== groups[i - 1]?.section}<span class="sep" aria-hidden="true"
        ></span>{/if}
      <div class="group" role="group" onpointerenter={() => enter(g.name)} onpointerleave={leave}>
        <button
          class="item web-{webOf(g.species.map((s) => s.name))}"
          style:filter={tint(g.species.map((s) => s.name))}
          class:open={open === g.name}
          class:armed={g.species.some((s) => s.name === planting)}
          class:pop={g.species.some((s) => s.name === popped)}
          aria-expanded={open === g.name}
          aria-label={g.name}
          title={g.name}
          data-tour="family-{g.key}"
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
                  <div class="tier" title={MEDAL_NAME[t - 1]}>
                    {#each list as s (s.name)}
                      {@const state = cardOf(s)}
                      <button
                        class="tile {state} {MEDAL[s.tier - 1] ?? 'bronze'} web-{web(s.name)}"
                        style:filter={tint([s.name])}
                        class:armed={planting === s.name}
                        class:pop={popped === s.name}
                        class:none={count(s) === 0 && state === "unlocked"}
                        role="menuitem"
                        aria-label={label(s.name)}
                        onclick={() => click(s)}
                        onpointerenter={(e) => show(e, s)}
                        onpointerleave={() => (hover = null)}
                      >
                        {#if state === "available"}
                          <!-- A gauge (D-119): the icon fills with colour from the bottom as the
                               bank nears the unlock cost; the padlock turns gold once affordable. -->
                          {@const f = funded(s)}
                          <span class="grey"><SpeciesIcon {s} size={38} /></span>
                          <span class="fill">
                            <span
                              class="clip"
                              style:clip-path="inset({(100 - f * 100).toFixed(1)}% 0 0 0)"
                            >
                              <SpeciesIcon {s} size={38} />
                            </span>
                          </span>
                          <span class="lock" class:ready={f >= 1}
                            ><Icon name="lock" size={12} /></span
                          >
                        {:else}
                          <SpeciesIcon {s} size={38} />
                          {#if count(s)}<span class="count num">{count(s)}</span>{/if}
                          {#if state === "locked"}
                            <span class="lock"><Icon name="lock" size={12} /></span>
                          {/if}
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
    <CatastropheDeck cards={catastrophes} {waits} {bank} armed={castArmed} onArm={onCast} />
  </nav>

  {#if hover}
    {@const s = hover.s}
    {@const state = cardOf(s)}
    <div class="tip panel" style:left="{hover.x}px" style:top="{hover.y}px" role="tooltip">
      <span class="head {MEDAL[s.tier - 1] ?? 'bronze'}">
        <strong>{label(s.name)}</strong>
        <span class="sub">{s.kind === "flora" ? "plant" : roleName(s.role)}</span>
      </span>
      <span class="stats">
        {#each quickStats(s, replay.meta.pace, discCells(plantRadius), species) as q (q.icon)}
          <span class="stat" title={q.title} style:color={q.tone}
            ><Icon name={q.icon} size={13} />{q.value}</span
          >
        {/each}
        <!-- Ground at a glance (D-241): the favourite bedrock in its overlay colour, and the
             moisture need as one to three drops. -->
        {#if rockIndex(s)}
          <span class="stat rock" title={rockOf(s)}
            ><i style:background={OVERLAY_RAMPS.bedrock[rockIndex(s) - 1]}></i>{BEDROCK_SHORT[
              rockIndex(s)
            ]}</span
          >
        {/if}
        {#if dropsOf(s)}
          <span class="stat drops" title={groundOf(s)}>
            {#each [1, 2, 3].slice(0, dropsOf(s)) as i (i)}<Icon name="water" size={12} />{/each}
          </span>
        {/if}
      </span>
      {#if s.kind === "fauna"}
        <!-- D-122: foods in rank order, primary largest. -->
        <span class="feeds">
          Feeds on
          {#if s.role === "decomposer"}
            <span class="dead">dead biomass</span>
          {:else}
            {#each foodsOf(s, species) as f, i (f.name)}
              <span
                class="food rank{i}"
                title="{['Primary', 'Secondary', 'Tertiary'][i] ?? ''} food"
                ><FamilyIcon family={f.family} size={18} /><span
                  class="medal {MEDAL[f.tier - 1] ?? 'bronze'}"
                ></span>{label(f.name)}</span
              >
            {/each}
          {/if}
        </span>
      {/if}
      {#if state === "available"}
        <span class="act"><Icon name="unlock" size={12} /> {s.stats.unlock_cost} to unlock</span>
      {:else if state === "locked"}
        <span class="act dim"><Icon name="lock" size={12} /> {lockText(s, species)}</span>
      {/if}
      <em>{s.stats.effect}</em>
    </div>
  {/if}
</footer>

<style>
  /* Unlock pop (D-169): a quick swell with a gold ring that fades. */
  .pop {
    animation: pop 0.6s ease-out;
  }
  @keyframes pop {
    0% {
      transform: scale(1);
      box-shadow: 0 0 0 0 rgba(216, 180, 92, 0.9);
    }
    35% {
      transform: scale(1.18);
      box-shadow: 0 0 0 6px rgba(216, 180, 92, 0.55);
    }
    100% {
      transform: scale(1);
      box-shadow: 0 0 0 14px rgba(216, 180, 92, 0);
    }
  }
  .dock {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 3; /* its flyouts and hints above the map banners (D-242) */
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
    cursor: var(--cursor-pointer);
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
  /* Tiers bottom to top, bronze to gold (D-242). */
  .tiers {
    display: flex;
    flex-direction: column-reverse;
    gap: 6px;
  }
  .tier {
    display: flex;
    justify-content: center;
    gap: 6px;
  }
  /* Tier rings (D-106), the medal merged in as a thicker left edge (D-242); colours in app.css. */
  .tile {
    box-shadow:
      inset 0 0 0 1.5px var(--medal),
      inset 4px 0 0 0 var(--medal);
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
    cursor: var(--cursor);
  }
  .grey {
    display: grid;
    filter: grayscale(0.9);
    opacity: 0.5;
  }
  .fill {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
  }
  .clip {
    display: grid;
    transition: clip-path 0.4s ease-out;
  }
  .lock.ready {
    color: #1d1a12;
    background: var(--gold);
    box-shadow: 0 0 8px var(--gold-soft);
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
  /* The selection strip and its key help sit in the lower left corner (D-234), clear of the
     build bar. */
  .selection {
    position: absolute;
    left: 14px;
    bottom: 12px;
    z-index: 3;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    max-width: min(34vw, 460px);
    padding: 4px 8px;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 0;
    background: none;
    cursor: var(--cursor-pointer);
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
    cursor: var(--cursor-pointer);
  }
  .tip {
    position: absolute;
    transform: translateY(-50%); /* right of the tile (D-242) */
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
    color: var(--medal); /* the tier's metal (D-242) */
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
  /* Ground at a glance (D-241): a bedrock swatch, and one to three drops close together. */
  .stat.rock i {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.45);
  }
  .stat.drops {
    gap: 0;
  }
  .stat.drops :global(svg) {
    color: #7fb6e0;
    margin-right: -3px;
  }
  .sub,
  .dim,
  em {
    color: var(--ink-soft);
  }
  .feeds {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 6px;
    font-size: 0.9em;
    color: var(--ink-soft);
  }
  .food {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--ink);
  }
  .food.rank0 {
    font-weight: 700;
  }
  .food.rank1 {
    opacity: 0.85;
  }
  .food.rank2 {
    opacity: 0.7;
  }
  .dead {
    color: var(--ink);
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
  /* Food-web focus (D-232): rings like the tutorial's pointer, red for predators, mossy green
     for prey; everything unrelated loses 40 % of its colour. */
  .web-predator,
  .web-prey {
    position: relative;
    z-index: 1;
    animation: web-pulse 1.4s ease-in-out infinite;
  }
  .web-predator {
    --web: var(--threat);
    box-shadow:
      0 0 0 2px var(--web),
      0 0 12px var(--web);
  }
  .web-prey {
    --web: #3f6b2a;
    box-shadow:
      0 0 0 2px var(--web),
      0 0 12px var(--web);
  }
  .web-dim {
    filter: saturate(0.2); /* -80 % (D-235) */
  }
  @keyframes web-pulse {
    50% {
      box-shadow:
        0 0 0 2px var(--web),
        0 0 20px var(--web);
    }
  }
</style>
