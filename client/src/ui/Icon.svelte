<script lang="ts">
  // HUD icons: simple 24 x 24 outline paths, coloured by `currentColor`.
  const PATHS = {
    land: "M5 21V4m0 0h11l-2 4 2 4H5",
    species: "M5 19c0-8 5-14 14-14 0 9-5 14-13 14zM5 19l8-8",
    biomass: "M12 21v-7m0 0c-4 0-7-2-7-7 4 0 7 2 7 7zm0 0c0-4 3-7 7-7 0 4-3 7-7 7z",
    tree: "M12 22v-6m0 0H7l3-4H8l4-6 4 6h-2l3 4z",
    layers: "M12 4 3 9l9 5 9-5zm-9 9 9 5 9-5",
  } as const;

  let { name, size = 18 }: { name: keyof typeof PATHS; size?: number } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={PATHS[name]} /></svg
>
