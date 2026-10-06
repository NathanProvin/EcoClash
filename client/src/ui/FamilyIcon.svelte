<script lang="ts">
  import { SPECIES_GLYPHS } from "./glyphs";

  // Build-bar family pictograms (D-105): one sober line drawing per family, tied to what the
  // family is (blades of grass, a fern frond, a bush, a tree, a lily pad, a grasshopper, a
  // snail, a caterpillar on its leaf, a beetle, a bird, a fox, a paw, a fish, a heron, a
  // mushroom), on the family's tone. Water plants: a lily pad and a cattail (D-125). 24 x 24 paths, coloured by `currentColor`.
  const PATHS: Record<string, string> = {
    L1: "M8 20c0-4-1-7.5-3.5-11M12 20V5.5M16 20c0-4 1-7.5 3.5-11M10 20c0-3-.6-5.5-2-7.5M14 20c0-3 .6-5.5 2-7.5M3.5 20h17",
    L2: "M12 21c0-7 1.5-12 5-16M12.3 17 8 15M12.8 13 8.5 10.5M14 9.4 10.5 6.8M12.7 16.5l4.3-1.3M13.4 12.5l3.9-1.8M14.6 8.6l3-1.9",
    L3: "M6 18a3.5 3.5 0 0 1 .3-7A5 5 0 0 1 15.6 9a3.8 3.8 0 0 1 2.9 7.2A2.5 2.5 0 0 1 17 18zM12 18v3M9 21h6",
    L4: "M12 21v-6M9 21h6M12 15c-4.5 0-7-2.4-7-6a7 7 0 0 1 14 0c0 3.6-2.5 6-7 6z",
    W: "M2.5 18c3-1.8 6.5-1.8 9.5 0s6.5 1.8 9.5 0M5 14.5c0-1.4 2.2-2.5 5-2.5s5 1.1 5 2.5c-3 .9-7 .9-10 0zM18 15V9.2M16.8 6.6a1.2 2.6 0 1 0 2.4 0 1.2 2.6 0 1 0-2.4 0M18 4V2.4M18 12.6l2.4-2.4",
    H1: "M3.5 14.5c4-3.5 10-4.5 14-2 1.8 1.1 1.4 3.2-.6 3.2H6.5M17 12l3-6.5M8.5 15.7 7 19.5M13 15.7l1 3.8M19.2 10.7l2.3-.6",
    H2: "M3 18h14.5A3.5 3.5 0 0 0 21 14.5V9.5M19.3 9.5 18 6.5M21 9.5l1-3M12.5 18a5.5 5.5 0 1 0-5.5-5.5 3 3 0 0 0 3 3 1.6 1.6 0 0 0 1.6-1.6",
    H3: "M3.5 20.5c0-9 6-15.5 17-17-1 10.5-7.5 17-17 17zM9 14.5a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M12.2 12a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0M15.4 9.5a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0",
    H4: "M12 6.5c3 0 5 3 5 7.2S15 20.5 12 20.5 7 17.9 7 13.7 9 6.5 12 6.5zM12 9v11.5M10 6.8 8 3.5M14 6.8l2-3.3M7.2 11H4M16.8 11H20M7.4 16H4.5M16.6 16h2.9",
    P1: "M4 14.5c3 0 5.2-2.2 7-5.2 2-3.3 6.2-3.2 7.3-.2l3 1.1-3 1c-.2 5-4 8.3-9 8.3l-2.3 2v-3.1C5.2 17.6 4 16.4 4 14.5zM15.5 9h.01",
    P2: "M4 3.5 8 9h8l4-5.5-.5 7.5L12 20.5 4.5 11zM9.5 13h.01M14.5 13h.01M11 16.5h2",
    P3: "M12 13c-3 0-5.3 3-4.3 5.3.8 1.8 2.8 2.2 4.3 2.2s3.5-.4 4.3-2.2C17.3 16 15 13 12 13zM6 11.5a1.7 2.1 0 1 0 0-.01M9.5 7.5a1.7 2.1 0 1 0 0-.01M14.5 7.5a1.7 2.1 0 1 0 0-.01M18 11.5a1.7 2.1 0 1 0 0-.01",
    S: "M5.5 9 6.5 4l3.8 3h3.4l3.8-3 1 5c1.4 5.2-1.6 11-6.5 11S4.1 14.2 5.5 9zM9.5 12a1.5 1.5 0 1 0 .01 0M14.5 12a1.5 1.5 0 1 0 .01 0M12 14.6l-1 1.6h2z",
    HW: "M2.5 12c3.5-4.5 10-5.5 14 0-4 5.5-10.5 4.5-14 0zM16.5 12l5-3.5v7zM7.5 11.2h.01",
    PW: "M8 13.5c0-3 2.6-5 5.5-5H15V5.6A1.8 1.8 0 0 1 16.8 3.8l4.7.9-4.7.9v3.1M8 13.5c2.2 2.2 6.3 2.2 8.5-.5M11 15.5 9.5 21M13.8 15.6l1 5.4M3 19h18",
    C: "M6.5 15a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.3 3.3 0 0 1 17 15zM12.5 12l-2 4h3l-2 4.5",
    D: "M3.5 12.5a8.5 7.5 0 0 1 17 0zM10 12.5v6a2 2 0 0 0 4 0v-6M8 9.5h.01M13 8h.01M16.5 10h.01",
  };

  /** Tone per family: plant greens by height, water teals, grazer ochre, hunter red, earth. */
  const TONE: Record<string, string> = {
    L1: "l1",
    L2: "l2",
    L3: "l3",
    L4: "l4",
    W: "w",
    HW: "w",
    PW: "w",
    D: "decomposer",
    C: "catastrophe",
    H1: "herbivore",
    H2: "herbivore",
    H3: "herbivore",
    H4: "herbivore",
    P1: "predator",
    P2: "predator",
    P3: "predator",
    S: "predator",
  };

  /** `bare`: the pictogram alone, in the current colour (round toggles, D-135). `glyph`: a
   *  species name; its silhouette replaces the family pictogram when there is one (D-167). */
  let {
    family,
    size = 40,
    bare = false,
    glyph,
  }: { family: string; size?: number; bare?: boolean; glyph?: string } = $props();
  // One path per primitive: overlaps simply paint over each other (in one path, opposite
  // windings would cancel and punch holes).
  const silhouette = $derived(glyph ? SPECIES_GLYPHS[glyph]?.split(/(?=M)/) : undefined);
</script>

<span
  class="icon {TONE[family] ?? 'herbivore'}"
  class:bare
  style:--size="{size}px"
  aria-hidden="true"
>
  <svg
    width={size * (bare ? 1 : 0.62)}
    height={size * (bare ? 1 : 0.62)}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    >{#if silhouette}{#each silhouette as d, i (i)}<path
          {d}
          fill="currentColor"
          stroke="none"
        />{/each}{:else}<path d={PATHS[family] ?? PATHS["L1"]} />{/if}</svg
  >
</span>

<style>
  .icon {
    display: inline-grid;
    place-items: center;
    flex: none;
    width: var(--size);
    height: var(--size);
    border-radius: calc(var(--size) * 0.24);
    color: rgba(255, 255, 255, 0.92);
    background: radial-gradient(circle at 35% 28%, var(--hi), var(--lo));
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.22),
      inset 0 -2px 4px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(0, 0, 0, 0.4);
  }
  .icon.bare {
    color: inherit;
    background: none;
    box-shadow: none;
  }
  svg {
    filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
  }
  .l1 {
    --hi: #a6d17a;
    --lo: #4e7a34;
  }
  .l2 {
    --hi: #8fbf5e;
    --lo: #41662a;
  }
  .l3 {
    --hi: #6fae58;
    --lo: #2f5a26;
  }
  .l4 {
    --hi: #4c8a45;
    --lo: #1b3b1d;
  }
  .w {
    --hi: #6fb8ad;
    --lo: #1f5a55;
  }
  .decomposer {
    --hi: #b08a62;
    --lo: #5a4028;
  }
  .herbivore {
    --hi: #d2b25a;
    --lo: #7a5a1c;
  }
  .catastrophe {
    --hi: #8f8796;
    --lo: #3a3440;
  }
  .predator {
    --hi: #d0695a;
    --lo: #6e2219;
  }
</style>
