<script lang="ts">
  // Strategic icons (D-078): a species icon with a head count over each large group of your
  // animals, at a fixed screen size, so the whole army reads at a glance. Clicking one selects
  // the group (swarms cannot be ordered: their icons only show).
  import type { Species } from "../replay/replay";
  import SpeciesIcon from "./SpeciesIcon.svelte";

  let {
    icons,
    onSelect,
  }: {
    icons: {
      key: string;
      x: number;
      y: number;
      s: Species;
      count: number;
      ids: number[];
      order: boolean;
    }[];
    onSelect: (ids: number[]) => void;
  } = $props();
</script>

{#each icons as i (i.key)}
  <button
    class="icon"
    class:swarm={!i.order}
    style:left="{i.x}px"
    style:top="{i.y}px"
    title={i.order ? "Select this group" : "A swarm: it cannot be ordered"}
    onclick={() => i.order && onSelect(i.ids)}
  >
    <SpeciesIcon s={i.s} size={26} />
    <span class="num">{i.count}</span>
  </button>
{/each}

<style>
  .icon {
    position: absolute;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 2px 7px 2px 2px;
    transform: translate(-50%, -120%);
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--panel);
    backdrop-filter: var(--blur);
    color: var(--ink);
    font-size: 0.72em;
    font-weight: 700;
    cursor: pointer;
    border-bottom: 2px solid var(--player);
  }
  .icon:hover {
    border-color: var(--accent);
  }
  .icon.swarm {
    cursor: default;
    opacity: 0.8;
  }
</style>
