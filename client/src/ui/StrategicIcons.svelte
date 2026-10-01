<script lang="ts">
  // Strategic icons (D-078, D-114): the family pictogram of the build bar with a head count over
  // each large group of your animals, at a fixed screen size, so the whole army reads at a
  // glance. Clicking one selects the group (swarms cannot be ordered: their icons only show).
  import { label, MEDAL } from "../game/species";
  import type { Species } from "../replay/replay";
  import FamilyIcon from "./FamilyIcon.svelte";

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
    title="{label(i.s.name)} · {i.order
      ? 'click to select the group'
      : 'a swarm: it cannot be ordered'}"
    onclick={() => i.order && onSelect(i.ids)}
  >
    <FamilyIcon family={i.s.family} size={30} />
    <span class="num"><span class="medal {MEDAL[i.s.tier - 1] ?? 'bronze'}"></span>{i.count}</span>
  </button>
{/each}

<style>
  .icon {
    position: absolute;
    z-index: 3;
    padding: 0;
    transform: translate(-50%, -120%);
    border: 0;
    border-radius: 9px;
    background: none;
    box-shadow:
      0 0 0 2px var(--player),
      0 3px 10px rgba(0, 0, 0, 0.35);
    cursor: pointer;
    transition: transform 0.12s;
  }
  .icon:hover {
    transform: translate(-50%, -120%) scale(1.1);
  }
  .icon > :global(.icon) {
    display: grid;
  }
  .num {
    position: absolute;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    right: -9px;
    bottom: -7px;
    min-width: 18px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(20, 24, 20, 0.85);
    box-shadow: 0 0 0 1.5px var(--player);
    color: #fff;
    font-size: 0.68em;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    line-height: 1.4;
  }
  .icon.swarm {
    cursor: default;
    opacity: 0.85;
    box-shadow:
      0 0 0 2px var(--player),
      0 0 0 4px rgba(0, 0, 0, 0.25);
  }
</style>
