<script lang="ts">
  // HUD icons: simple 24 x 24 outline paths, coloured by `currentColor`.
  const PATHS = {
    land: "M5 21V4m0 0h11l-2 4 2 4H5",
    species: "M5 19c0-8 5-14 14-14 0 9-5 14-13 14zM5 19l8-8",
    biomass: "M12 21v-7m0 0c-4 0-7-2-7-7 4 0 7 2 7 7zm0 0c0-4 3-7 7-7 0 4-3 7-7 7z",
    tree: "M12 22v-6m0 0H7l3-4H8l4-6 4 6h-2l3 4z",
    layers: "M12 4 3 9l9 5 9-5zm-9 9 9 5 9-5",
    menu: "M4 7h16M4 12h16M4 17h16",
    unlock: "M8 11V7a4 4 0 0 1 7.7-1.5M5 11h14v10H5z",
    lock: "M8 11V7a4 4 0 0 1 8 0v4M5 11h14v10H5z",
    heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
    zoom: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm5-2 5 5M8 11h6m-3-3v6",
    close: "M6 6l12 12M18 6 6 18",
    push: "M3 12h13m-4-5 5 5-5 5M20 5v14",
    soil: "M3 17h18M5 13c3-2 6-2 9 0s5 2 7 0",
    water: "M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z",
    rock: "M3 19l5-9 4 5 3-4 6 8z",
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
