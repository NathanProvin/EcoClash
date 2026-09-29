<script lang="ts">
  // RTS build card (D-030, D-063): every species as an icon tile, in two rows (plants, animals),
  // grouped by family in tier order, so the whole tree is one glance away. Hovering a tile shows
  // its stats; clicking arms it (the next map click plants it or calls the animal; Shift keeps it
  // armed), buys it when it can be unlocked, or does nothing while locked. With animals selected, a
  // selection strip sits above the card. Replays show the same card, read-only.
  import { cardState, families, label, statLines } from "../game/species";
  import type { Source, Species } from "../replay/replay";
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
  function click(s: Species) {
    const state = cardOf(s);
    if (state === "available") onUnlock(s.name);
    else if (state === "unlocked" && live) planting = planting === s.name ? null : s.name;
  }

  let hover: { s: Species; x: number; y: number } | null = $state(null);
  function show(e: PointerEvent, s: Species) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    hover = { s, x: r.left + r.width / 2, y: r.top - 10 }; // just above the tile
  }
</script>

<footer class="dock p{player}">
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

  <nav class="card panel" aria-label="Species">
    {#each ["flora", "fauna"] as const as kind (kind)}
      <div class="row">
        {#each groups.filter((g) => g.kind === kind) as g (g.name)}
          <div class="family">
            <span class="fam">{g.name}</span>
            <div class="tiles">
              {#each g.species as s (s.name)}
                {@const state = cardOf(s)}
                <button
                  class="tile {state}"
                  class:armed={planting === s.name}
                  class:none={count(s) === 0 && state === "unlocked"}
                  aria-label={label(s.name)}
                  onclick={() => click(s)}
                  onpointerenter={(e) => show(e, s)}
                  onpointerleave={() => (hover = null)}
                >
                  <SpeciesIcon {s} size={38} />
                  {#if count(s)}<span class="count num">{count(s)}</span>{/if}
                  {#if state === "available"}<span class="plus">+</span>{/if}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/each}
  </nav>

  {#if hover}
    {@const s = hover.s}
    {@const state = cardOf(s)}
    <div class="tip panel" style:left="{hover.x}px" style:top="{hover.y}px" role="tooltip">
      <strong>{label(s.name)}</strong>
      <span class="sub">tier {s.tier} · {s.kind === "flora" ? "plant" : s.role}</span>
      {#each statLines(s) as line (line)}<span>{line}</span>{/each}
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
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 12px;
  }
  .row {
    display: flex;
    gap: 14px;
  }
  .family {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .fam {
    font-size: 0.62em;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .tiles {
    display: flex;
    gap: 4px;
  }
  .tile {
    position: relative;
    padding: 2px;
    border: 1px solid transparent;
    border-radius: 11px;
    background: none;
    cursor: pointer;
    transition:
      transform 0.12s,
      border-color 0.12s,
      opacity 0.12s;
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
  .tile.armed {
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
  .plus {
    position: absolute;
    right: -2px;
    top: -3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 0.75em;
    font-weight: 800;
    line-height: 16px;
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
    position: fixed;
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
