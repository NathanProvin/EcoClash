<script lang="ts">
  // Full-screen tech tree (gamerules §4, D-029/D-030): flora L1..L3 and fauna F1..F5 as levels x
  // tiers; each card shows the stat sheet and its state for the viewed player at the current time.
  import { cardState, glyph, label, unlockedAt } from "../game/species";
  import type { Replay, Species } from "../replay/replay";

  let {
    replay,
    tick,
    player,
    onClose,
  }: { replay: Replay; tick: number; player: 1 | 2; onClose: () => void } = $props();

  const meta = $derived(replay.meta);
  const unlocked = $derived(unlockedAt(meta, player, tick * meta.dt));
  const counts = $derived(replay.counts(tick, player));
  const trees = [
    { kind: "flora", title: "Flora", prefix: "L", levels: [1, 2, 3], names: ["Herbaceous", "Shrubs", "Trees"] },
    { kind: "fauna", title: "Fauna", prefix: "F", levels: [1, 2, 3, 4, 5], names: ["Soil fauna", "Insects", "Small mammals", "Birds", "Carnivores"] },
  ] as const; // prettier-ignore

  const at = (kind: string, level: number, tier: number): Species[] =>
    meta.species.filter((s) => s.kind === kind && s.level === level && s.tier === tier);
  const count = (s: Species) => counts[meta.species.indexOf(s)] ?? 0;
  const growth = (s: Species) =>
    s.kind === "flora" ? `${s.stats.growth} /s` : `${s.stats.growth} s/birth`;
</script>

<div class="page" role="dialog" aria-modal="true" aria-label="Tech tree">
  <header>
    <h1>Tech tree <span class="muted">· P{player}</span></h1>
    <p class="legend">
      <span class="badge unlocked">unlocked</span>
      <span class="badge available">available</span>
      <span class="badge locked">locked</span>
      <span class="muted"
        >A species needs one species of the previous tier; animals also need a habitat plant.</span
      >
    </p>
    <button onclick={onClose}>Close (Esc)</button>
  </header>

  <div class="trees">
    {#each trees as tree (tree.kind)}
      <section>
        <h2>{tree.title}</h2>
        <div class="grid">
          <span></span>
          {#each [1, 2, 3] as tier (tier)}<span class="col">Tier {tier}</span>{/each}
          {#each tree.levels as level, li (level)}
            <span class="row">{tree.prefix}{level}<small>{tree.names[li]}</small></span>
            {#each [1, 2, 3] as tier (tier)}
              <div class="cell">
                {#each at(tree.kind, level, tier) as s (s.name)}
                  {@const state = cardState(meta, s, unlocked)}
                  <article class="card {state}">
                    <h3>
                      <span class="glyph p{player}">{glyph(s)}</span>
                      {label(s.name)}
                      <span class="badge {state}">{state}</span>
                    </h3>
                    <dl>
                      <dt>Growth</dt>
                      <dd>{growth(s)}</dd>
                      <dt>Yield</dt>
                      <dd>{s.stats.yield} /s</dd>
                      <dt>Spawn</dt>
                      <dd>{s.stats.spawn_cost}</dd>
                      <dt>Unlock</dt>
                      <dd>{s.stats.unlock_cost || "free"}</dd>
                      <dt>Cap</dt>
                      <dd>{s.stats.cap}</dd>
                      <dt>Owned</dt>
                      <dd>{count(s)}</dd>
                    </dl>
                    {#if s.kind === "fauna"}
                      <p class="small">Eats {s.eats.map(label).join(", ")}</p>
                      <p class="small">Habitat {s.habitat.map(label).join(", ")}</p>
                    {/if}
                    <p class="effect">{s.stats.effect}</p>
                  </article>
                {/each}
              </div>
            {/each}
          {/each}
        </div>
      </section>
    {/each}
  </div>
</div>

<style>
  .page {
    position: absolute;
    inset: 0;
    z-index: 10;
    background: #f6f6f2;
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--line);
  }
  h1 {
    margin: 0;
    font-size: 1.2em;
  }
  header button {
    margin-left: auto;
    border: 1px solid var(--line);
    background: white;
    border-radius: 6px;
    padding: 4px 12px;
    cursor: pointer;
  }
  .legend {
    display: flex;
    gap: 8px;
    align-items: center;
    margin: 0;
  }
  .trees {
    flex: 1;
    overflow: auto;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(760px, 1fr)); /* stacked unless very wide */
    gap: 24px;
    padding: 16px 24px;
    align-content: start;
  }
  h2 {
    margin: 0 0 8px;
    font-size: 1em;
  }
  .grid {
    display: grid;
    grid-template-columns: 88px repeat(3, 1fr);
    gap: 8px;
  }
  .col {
    color: var(--ink-soft);
    font-size: 0.8em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .row {
    font-weight: 600;
    display: flex;
    flex-direction: column;
  }
  .row small {
    font-weight: 400;
    color: var(--ink-soft);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card {
    background: white;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 0.82em;
  }
  .card.locked {
    opacity: 0.55;
  }
  .card.unlocked {
    border-color: #7aa37e;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 1.05em;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  h3 .badge {
    margin-left: auto;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr auto 1fr;
    gap: 1px 6px;
    margin: 0 0 4px;
  }
  dt {
    color: var(--ink-soft);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .small {
    margin: 0;
    color: var(--ink-soft);
  }
  .effect {
    margin: 4px 0 0;
    font-style: italic;
    color: var(--ink-soft);
  }
  .badge {
    font-size: 0.75em;
    border-radius: 999px;
    padding: 1px 7px;
    border: 1px solid var(--line);
  }
  .badge.unlocked {
    background: #e3f1e4;
    border-color: #7aa37e;
  }
  .badge.available {
    background: #fff5d6;
    border-color: #d9b44a;
  }
  .badge.locked {
    background: #eee;
  }
  .muted {
    color: var(--ink-soft);
    font-weight: 400;
    font-size: 0.85em;
  }
  .glyph.p1 {
    color: var(--p1);
  }
  .glyph.p2 {
    color: var(--p2);
  }
</style>
