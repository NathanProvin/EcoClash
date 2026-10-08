<script lang="ts">
  // Unit list (D-174): your controllable animals on the map, by species, in the build bar's
  // order, with head counts. No title. A click selects every animal of that species; the
  // species of the selection wear a bright outline (D-232).
  import { families, label } from "../game/species";
  import type { Animal, Species } from "../replay/replay";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    animals,
    species,
    fauna,
    me,
    selected = new Set(),
    onPick,
  }: {
    /** The animals drawn now. */
    animals: readonly Animal[];
    /** Every species (build bar order comes from their families). */
    species: Species[];
    /** Fauna species names, by an animal's `species` index. */
    fauna: readonly string[];
    me: number;
    /** Species of the selected animals (D-232). */
    selected?: ReadonlySet<string>;
    onPick: (name: string) => void;
  } = $props();

  const order = $derived(
    families(species).flatMap((f) => f.species.filter((s) => s.kind === "fauna" && !s.swarm)),
  );
  const rows = $derived.by(() => {
    const count: Record<string, number> = {};
    for (const a of animals) {
      if (a.owner !== me) continue;
      const name = fauna[a.species];
      if (name) count[name] = (count[name] ?? 0) + 1;
    }
    return order.flatMap((s) => {
      const n = count[s.name] ?? 0;
      return n ? [{ s, n }] : [];
    });
  });
</script>

{#if rows.length}
  <nav class="units panel" aria-label="Your units">
    {#each rows as r (r.s.name)}
      <button
        class="unit"
        class:on={selected.has(r.s.name)}
        aria-pressed={selected.has(r.s.name)}
        onclick={() => onPick(r.s.name)}
        title="{label(r.s.name)}: select all"
        aria-label="Select all {label(r.s.name)}"
      >
        <SpeciesIcon s={r.s} size={30} />
        <span class="n">{r.n}</span>
      </button>
    {/each}
  </nav>
{/if}

<style>
  .units {
    position: absolute;
    left: 14px;
    top: 50%;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px;
    transform: translateY(-50%);
    max-height: 56vh;
    overflow: auto;
  }
  .unit {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px 3px 3px;
    border: 1px solid transparent;
    border-radius: 9px;
    background: none;
    color: var(--ink);
    cursor: var(--cursor-pointer);
  }
  .unit:hover {
    border-color: var(--gold);
    background: rgba(216, 180, 92, 0.15);
  }
  /* The selected species (D-232): a bright outline that reads over the map. */
  .unit.on {
    border-color: #fff6d8;
    background: rgba(216, 180, 92, 0.22);
    box-shadow:
      0 0 0 1px var(--gold),
      0 0 10px var(--gold-soft);
  }
  .n {
    min-width: 22px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
</style>
