<script lang="ts">
  // Strategic icons (D-078, D-114): the family pictogram of the build bar with a head count over
  // each large group of your animals, at a fixed screen size, so the whole army reads at a
  // glance. Clicking one selects the group (swarms cannot be ordered: their icons only show).
  // The enemy's groups show too (D-146), with a solid red ring (D-158): where the threat is.
  import { label, MEDAL } from "../game/species";
  import type { Species } from "../replay/replay";
  import FamilyIcon from "./FamilyIcon.svelte";

  let {
    icons,
    onSelect,
    onHover,
  }: {
    icons: {
      key: string;
      x: number;
      y: number;
      s: Species;
      count: number;
      ids: number[];
      order: boolean;
      enemy: boolean;
    }[];
    onSelect: (ids: number[]) => void;
    /** The group under the pointer (D-161: its unit card shows), or null on leaving. */
    onHover?: (ids: number[] | null) => void;
  } = $props();
</script>

{#each icons as i (i.key)}
  <button
    class="icon"
    class:swarm={!i.order}
    class:enemy={i.enemy}
    style:left="{i.x}px"
    style:top="{i.y}px"
    title="{i.enemy ? 'Enemy ' : ''}{label(i.s.name)} ×{i.count}{i.enemy
      ? ''
      : i.order
        ? ' · click to select the group'
        : ' · a swarm: it cannot be ordered'}"
    onclick={() => i.order && onSelect(i.ids)}
    onpointerenter={() => onHover?.(i.ids)}
    onpointerleave={() => onHover?.(null)}
  >
    <FamilyIcon family={i.s.family} size={30} glyph={i.s.name} />
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
    cursor: var(--cursor-pointer);
    transition: transform 0.12s;
  }
  .icon.enemy {
    --player: var(--threat);
    outline: 2px solid var(--threat);
    outline-offset: 3px;
    cursor: var(--cursor);
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
    cursor: var(--cursor);
    opacity: 0.85;
    box-shadow:
      0 0 0 2px var(--player),
      0 0 0 4px rgba(0, 0, 0, 0.25);
  }
</style>
