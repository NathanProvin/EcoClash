<script lang="ts">
  // RTS unit bar (D-030): the current selection grouped by species, or, when nothing is selected,
  // the viewed player's living species. A card focuses a species; the left panel shows its stats.
  // In a live match every species has a card, under a Plants / Animals tab; clicking one arms it,
  // and the next map click plants it or calls the animal there (App).
  import { capText, label, position } from "../game/species";
  import type { Source, Species } from "../replay/replay";
  import SpeciesIcon from "./SpeciesIcon.svelte";

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
  let tab: "flora" | "fauna" = $state("flora");
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
      .filter((c) => (live ? c.s.kind === tab : c.count > 0));
  });
  const shown = $derived(species.find((s) => s.name === focus) ?? cards[0]?.s);
  const unit = (s: Species) => (s.kind === "flora" ? "cells" : "animals");
</script>

<footer class="bar p{player}">
  <section class="detail panel" aria-label="Selected species">
    {#if shown}
      <div class="head">
        <SpeciesIcon s={shown} size={52} />
        <div>
          <h2>{label(shown.name)}</h2>
          <p class="label">{position(shown)} · {shown.kind === "flora" ? "plant" : shown.role}</p>
        </div>
      </div>
      <dl>
        <div>
          <dt class="label">Growth</dt>
          <dd class="num">{shown.stats.growth}{shown.kind === "flora" ? "/s" : " s"}</dd>
        </div>
        <div>
          <dt class="label">Yield</dt>
          <dd class="num">{shown.stats.yield}/s</dd>
        </div>
        <div>
          <dt class="label">Spawn</dt>
          <dd class="num">{shown.stats.spawn_cost}</dd>
        </div>
        <div>
          <dt class="label">Cap</dt>
          <dd class="num">{capText(shown)}</dd>
        </div>
      </dl>
      <p class="effect">{shown.stats.effect}</p>
    {:else}
      <p class="muted">Drag a box around your animals to select them.</p>
    {/if}
  </section>

  <section class="cards panel" aria-label={selection.size ? "Selection" : "Your species"}>
    <header>
      {#if live && !selection.size}
        <div class="tabs" role="tablist">
          {#each [["flora", "Plants"], ["fauna", "Animals"]] as const as [kind, name] (kind)}
            <button
              role="tab"
              aria-selected={tab === kind}
              class:on={tab === kind}
              onclick={() => (tab = kind)}>{name}</button
            >
          {/each}
        </div>
        <span class="label">
          {tab === "flora"
            ? "Pick a plant, then click the map to plant it"
            : "Pick an animal, then click the map to call it"}
        </span>
      {:else}
        <span class="label">
          {selection.size ? `Selection · ${selection.size} animals` : "Your species"}
        </span>
      {/if}
      {#if selection.size}<button class="btn clear" onclick={onClear}>Clear (Esc)</button>{/if}
    </header>
    <div class="list">
      {#each cards as { s, count } (s.name)}
        <button
          class="card"
          class:on={shown?.name === s.name}
          class:armed={planting === s.name}
          class:none={count === 0}
          onclick={() => {
            focus = s.name;
            if (live) planting = planting === s.name ? null : s.name;
            else if (s.kind === "fauna") onPickSpecies(s.name);
          }}
          title="{label(s.name)}: {count} {unit(s)}{live ? ' · click, then click the map' : ''}"
        >
          <SpeciesIcon {s} size={46} />
          <span class="name">{label(s.name)}</span>
          {#if count}<span class="count num">{count}</span>{/if}
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
    inset: auto 10px 10px 10px;
    height: 168px;
    display: flex;
    gap: 10px;
  }
  .detail {
    width: 300px;
    flex: none;
    overflow: hidden auto;
    border-top: 2px solid var(--player);
  }
  .head {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 1.15em;
    font-weight: 800;
  }
  .head .label {
    margin: 2px 0 0;
  }
  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 12px;
    margin: 6px 0 4px;
  }
  dl div {
    display: flex;
    flex-direction: column;
  }
  dd {
    margin: 0;
    font-weight: 700;
    white-space: nowrap;
  }
  .effect {
    margin: 0;
    font-size: 0.8em;
    color: var(--ink-soft);
    font-style: italic;
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
    min-height: 22px;
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin-right: auto;
  }
  .tabs button {
    border: 1px solid var(--line);
    border-radius: 7px;
    background: var(--well);
    padding: 2px 12px;
    cursor: pointer;
    font-weight: 700;
    font-size: 0.8em;
    color: var(--ink-soft);
  }
  .tabs button.on {
    color: var(--ink);
    border-color: var(--gold);
    box-shadow: 0 0 8px rgba(216, 180, 92, 0.35);
  }
  .clear {
    padding: 1px 10px;
    font-size: 0.8em;
  }
  .list {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: 6px;
    overflow-y: auto;
    padding: 2px;
  }
  .card {
    position: relative;
    width: 76px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 5px 2px 4px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.07), rgba(0, 0, 0, 0.15));
    cursor: pointer;
    transition:
      transform 0.1s,
      border-color 0.1s,
      box-shadow 0.1s;
  }
  .card:hover {
    transform: translateY(-2px);
    border-color: var(--gold);
  }
  .card.none {
    opacity: 0.6;
  }
  .card.on {
    border-color: var(--player-glow);
    box-shadow: 0 0 0 1px var(--player-glow);
  }
  .card.armed {
    border-color: var(--gold);
    box-shadow:
      0 0 0 2px var(--gold),
      0 0 14px var(--gold);
    opacity: 1;
  }
  .name {
    font-size: 0.72em;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }
  .count {
    position: absolute;
    top: 2px;
    right: 3px;
    min-width: 20px;
    padding: 0 5px;
    border-radius: 999px;
    font-size: 0.68em;
    font-weight: 800;
    color: white;
    background: var(--player);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
  }
</style>
