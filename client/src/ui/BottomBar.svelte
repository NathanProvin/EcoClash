<script lang="ts">
  // RTS unit bar (D-030): the current selection grouped by species, or, when nothing is selected,
  // the viewed player's living species. A card focuses a species; the left panel shows its stats.
  // In a live match every plant has a card, and clicking one arms planting (App plants on click).
  import { capText, glyph, label, position } from "../game/species";
  import type { Source, Species } from "../replay/replay";

  let {
    replay,
    tick,
    player,
    selection,
    focus = $bindable(),
    live,
    planting = $bindable(),
    onPickSpecies,
    onClear,
  }: {
    replay: Source;
    tick: number;
    player: 1 | 2;
    selection: Set<number>;
    focus: string | null;
    live: boolean;
    planting: string | null;
    onPickSpecies: (name: string) => void;
    onClear: () => void;
  } = $props();

  const species = $derived(replay.meta.species);
  const fauna = $derived(species.filter((s) => s.kind === "fauna"));

  /** Cards: selected animals by species, or the player's roster (cells / animals). */
  const cards = $derived.by((): { s: Species; count: number }[] => {
    if (selection.size) {
      const by: Record<string, number> = {};
      for (const a of replay.animals(Math.floor(tick))) {
        const s = fauna[a.species];
        if (s && selection.has(a.id)) by[s.name] = (by[s.name] ?? 0) + 1;
      }
      return species.filter((s) => s.name in by).map((s) => ({ s, count: by[s.name] ?? 0 }));
    }
    const counts = replay.counts(tick, player);
    return species
      .map((s, i) => ({ s, count: counts[i] ?? 0 }))
      .filter((c) => c.count > 0 || (live && c.s.kind === "flora"));
  });
  const shown = $derived(species.find((s) => s.name === focus) ?? cards[0]?.s);
  const unit = (s: Species) => (s.kind === "flora" ? "cells" : "animals");
</script>

<footer class="bar">
  <section class="detail" aria-label="Selected species">
    {#if shown}
      <h2><span class="glyph p{player}">{glyph(shown)}</span> {label(shown.name)}</h2>
      <p class="muted">{position(shown)} · {shown.kind === "flora" ? "plant" : shown.role}</p>
      <dl>
        <dt>Growth</dt>
        <dd>{shown.stats.growth}{shown.kind === "flora" ? " /s" : " s/birth"}</dd>
        <dt>Yield</dt>
        <dd>{shown.stats.yield} /s</dd>
        <dt>Spawn</dt>
        <dd>{shown.stats.spawn_cost}</dd>
        <dt>Cap</dt>
        <dd>{capText(shown)}</dd>
      </dl>
      <p class="effect">{shown.stats.effect}</p>
    {:else}
      <p class="muted">Drag a box around your animals to select them.</p>
    {/if}
  </section>

  <section class="cards" aria-label={selection.size ? "Selection" : "Your species"}>
    <header>
      <span class="muted">
        {selection.size ? `Selection · ${selection.size} animals` : "Your species"}
      </span>
      {#if selection.size}<button class="clear" onclick={onClear}>Clear (Esc)</button>{/if}
    </header>
    <div class="list">
      {#each cards as { s, count } (s.name)}
        <button
          class="card"
          class:on={shown?.name === s.name}
          class:armed={planting === s.name}
          onclick={() => {
            focus = s.name;
            if (s.kind === "fauna") onPickSpecies(s.name);
            else if (live) planting = planting === s.name ? null : s.name;
          }}
          title="{label(s.name)}: {count} {unit(s)}{live && s.kind === 'flora'
            ? ' · click, then click the map to plant'
            : ''}"
        >
          <span class="glyph p{player}">{glyph(s)}</span>
          <span class="name">{label(s.name)}</span>
          <span class="count">{count}</span>
        </button>
      {:else}
        <p class="muted">Nothing yet.</p>
      {/each}
    </div>
  </section>
</footer>

<style>
  .bar {
    position: absolute;
    inset: auto 0 0 0;
    height: 132px;
    display: flex;
    gap: 16px;
    padding: 10px 16px;
    background: var(--panel);
    border-top: 1px solid var(--line);
    backdrop-filter: blur(6px);
  }
  .detail {
    width: 300px;
    flex: none;
    overflow-y: auto;
    border-right: 1px solid var(--line);
    padding-right: 16px;
  }
  h2 {
    margin: 0;
    font-size: 1em;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 2px 8px;
    margin: 6px 0;
    font-size: 0.85em;
  }
  dt {
    color: var(--ink-soft);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .effect {
    margin: 0;
    font-size: 0.82em;
    color: var(--ink-soft);
    font-style: italic;
  }
  .muted {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85em;
  }
  .cards {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .cards header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .clear {
    border: 1px solid var(--line);
    background: white;
    border-radius: 6px;
    padding: 2px 8px;
    cursor: pointer;
    font-size: 0.85em;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    overflow-y: auto;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--line);
    background: white;
    border-radius: 6px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .card.on {
    border-color: var(--ink);
    box-shadow: inset 0 0 0 1px var(--ink);
  }
  .card.armed,
  .card.armed .count {
    background: var(--ink);
    color: white;
  }
  .count {
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
    font-size: 0.85em;
  }
  .glyph {
    display: inline-block;
    width: 1.1em;
    text-align: center;
  }
  .glyph.p1 {
    color: var(--p1);
  }
  .glyph.p2 {
    color: var(--p2);
  }
</style>
