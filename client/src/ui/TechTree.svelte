<script lang="ts">
  // Full-screen tech tree (gamerules §4, D-029/D-030): flora L1..L3 and fauna F1..F5 as levels x
  // tiers; each card shows the stat sheet and its state for the viewed player at the current time.
  import { capText, cardState, label, unlockedAt } from "../game/species";
  import type { Source, Species } from "../replay/replay";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    replay,
    tick,
    player,
    onClose,
  }: { replay: Source; tick: number; player: 1 | 2; onClose: () => void } = $props();

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

<div class="page p{player}" role="dialog" aria-modal="true" aria-label="Tech tree">
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
    <button class="btn" onclick={onClose}>Close (Esc)</button>
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
                      <SpeciesIcon {s} size={36} />
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
                      <dd>{capText(s)}</dd>
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
    background:
      radial-gradient(ellipse at 50% 0%, rgba(216, 180, 92, 0.12), transparent 60%),
      linear-gradient(180deg, #17211b, #0b100d);
    display: flex;
    flex-direction: column;
  }
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 14px 24px;
    border-bottom: 1px solid var(--gold-soft);
  }
  h1 {
    margin: 0;
    font-size: 1.4em;
    font-weight: 900;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gold);
  }
  h1 .muted {
    color: var(--player-glow);
  }
  header .btn {
    margin-left: auto;
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
    margin: 0 0 10px;
    font-size: 0.9em;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--ink-soft);
  }
  .grid {
    display: grid;
    grid-template-columns: 92px repeat(3, 1fr);
    gap: 10px;
  }
  .col {
    color: var(--gold);
    font-size: 0.72em;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    text-align: center;
  }
  .row {
    font-weight: 900;
    font-size: 1.2em;
    display: flex;
    flex-direction: column;
    justify-content: center;
    color: var(--gold);
  }
  .row small {
    font-weight: 500;
    font-size: 0.6em;
    color: var(--ink-soft);
  }
  .cell {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card {
    background: var(--panel);
    box-shadow: var(--trim);
    border-radius: var(--radius);
    padding: 8px 10px;
    font-size: 0.82em;
  }
  .card.locked {
    opacity: 0.45;
    filter: grayscale(0.7);
  }
  .card.unlocked {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 0 0 1px var(--good),
      0 0 12px rgba(155, 215, 106, 0.25);
  }
  .card.available {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 0 0 1px var(--gold),
      0 0 12px rgba(216, 180, 92, 0.3);
  }
  h3 {
    margin: 0 0 6px;
    font-size: 1.1em;
    font-weight: 800;
    display: flex;
    align-items: center;
    gap: 8px;
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
    font-weight: 700;
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
    font-size: 0.68em;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border-radius: 999px;
    padding: 2px 8px;
    background: var(--well);
    border: 1px solid var(--line);
  }
  .badge.unlocked {
    color: var(--good);
    border-color: var(--good);
  }
  .badge.available {
    color: var(--gold);
    border-color: var(--gold);
  }
  .badge.locked {
    color: var(--ink-soft);
  }
  .muted {
    font-weight: 400;
    font-size: 0.85em;
  }
</style>
