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
    coin: "M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z",
    spread:
      "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 3v4m0 10v4M3 12h4m10 0h4M9.5 4.5 12 2l2.5 2.5M9.5 19.5 12 22l2.5-2.5M4.5 9.5 2 12l2.5 2.5M19.5 9.5 22 12l-2.5 2.5",
    egg: "M12 3c3.2 0 6.5 5.7 6.5 10.4A6.5 6.5 0 0 1 5.5 13.4C5.5 8.7 8.8 3 12 3z",
    caterpillar:
      "M4 15a2 2 0 1 0 4 0 2 2 0 1 0-4 0M8 13.5a2 2 0 1 0 4 0 2 2 0 1 0-4 0M12 12a2 2 0 1 0 4 0 2 2 0 1 0-4 0M16 10.5a2.3 2.3 0 1 0 4.6 0 2.3 2.3 0 1 0-4.6 0M17.5 8.4 16.8 6M19.6 8.4l.8-2.4M3 20c3-1 6-1 9-1s6 0 9 1",
    storm: "M7 16a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.5 1.5A3.3 3.3 0 0 1 17.5 16zM12.5 13l-2 4h3l-2 4",
    drum: "M6 5h12v15H6zM6 9h12M6 15h12M10 12c.6-1 1.4-1 2 0s1.4 1 2 0",
    deadtree: "M12 21V8M12 13l-4-4M8 9V6M12 11l4-3M16 8l1.5-2.5M12 8l-1.5-4M9 21h6",
    target:
      "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v4M12 18v4M2 12h4M18 12h4",
    cap: "M4 20h16M7 20v-6M12 20V9M17 20v-9M4 5h16",
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
