<script lang="ts">
  // Options (D-166): a game's options screen. Tabs for Graphics, Interface and Controls; the
  // quality presets as cards, the interface switches as sliding toggles, the shortcuts as
  // keycaps. Selected things wear the menu's mustard.
  import type { Quality } from "../render/quality";

  let {
    quality,
    onQuality,
    icons = $bindable(),
    perf = $bindable(),
    tips,
    onTips,
    keys,
    onBack,
  }: {
    quality: Quality;
    onQuality: (q: Quality) => void;
    icons: boolean;
    perf: boolean;
    tips: boolean;
    onTips: (on: boolean) => void;
    /** Shortcuts: the keys (" / "-separated alternatives, "+" combinations) and what they do. */
    keys: [string, string][];
    onBack: () => void;
  } = $props();

  type Tab = "graphics" | "interface" | "controls";
  const TABS: { id: Tab; name: string }[] = [
    { id: "graphics", name: "Graphics" },
    { id: "interface", name: "Interface" },
    { id: "controls", name: "Controls" },
  ];
  let tab: Tab = $state("graphics");

  const PRESETS: { id: Quality; name: string; hint: string; bars: number }[] = [
    { id: "low", name: "Low", hint: "Smooth on any laptop", bars: 1 },
    { id: "medium", name: "Medium", hint: "Balanced", bars: 2 },
    { id: "high", name: "High", hint: "Shadows, bloom, depth of field", bars: 3 },
  ];

  /** The interface switches. */
  const switches = $derived([
    {
      label: "Strategic icons",
      hint: "Icons over every herd (I)",
      on: icons,
      set: (v: boolean) => (icons = v),
    },
    {
      label: "Performance readout",
      hint: "Frame rate and sim time",
      on: perf,
      set: (v: boolean) => (perf = v),
    },
    {
      label: "First-match tips",
      hint: "Hints as you play; on: shown again",
      on: tips,
      set: onTips,
    },
  ]);

  /** A shortcut's keys as keycaps: "Shift or Ctrl + 1–9" → [["Shift", "Ctrl"], ["1–9"]]. */
  const caps = (k: string) => k.split(/\s*,\s*then\s*|\s*\/\s*|\s+or\s+|\s*\+\s*/).filter(Boolean);
</script>

<div class="options" aria-label="Options">
  <div class="tabs" role="tablist">
    {#each TABS as t (t.id)}
      <button
        role="tab"
        aria-selected={tab === t.id}
        class:on={tab === t.id}
        onclick={() => (tab = t.id)}>{t.name}</button
      >
    {/each}
  </div>

  <div class="page">
    {#if tab === "graphics"}
      <p class="heading">Quality</p>
      <div class="presets">
        {#each PRESETS as p (p.id)}
          <button class="preset" class:on={quality === p.id} onclick={() => onQuality(p.id)}>
            <span class="bars" aria-hidden="true">
              {#each [1, 2, 3] as b (b)}<span class:lit={b <= p.bars}></span>{/each}
            </span>
            <strong>{p.name}</strong>
            <small>{p.hint}</small>
          </button>
        {/each}
      </div>
      <p class="note">Shadow quality applies from the next match.</p>
    {:else if tab === "interface"}
      {#each switches as row (row.label)}
        <button class="toggle" role="switch" aria-checked={row.on} onclick={() => row.set(!row.on)}>
          <span class="text"><strong>{row.label}</strong><small>{row.hint}</small></span>
          <span class="track" class:on={row.on}><span class="knob"></span></span>
        </button>
      {/each}
    {:else}
      <div class="keys">
        {#each keys as [key, what] (key)}
          <div class="key">
            <span class="caps">
              {#each caps(key) as c, i (i)}<kbd>{c}</kbd>{/each}
            </span>
            <span class="what">{what}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <nav class="back">
    <button onclick={onBack}>Back</button>
  </nav>
</div>

<style>
  .options {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(560px, 86vw);
  }
  .tabs {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
  .tabs button,
  .preset,
  .back button {
    border: 1px solid var(--line);
    border-radius: 10px;
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
    color: var(--ink);
    cursor: var(--cursor-pointer);
    transition:
      border-color 0.12s,
      box-shadow 0.12s,
      transform 0.12s;
  }
  .tabs button {
    padding: 9px 18px;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  .tabs button:hover,
  .preset:hover,
  .back button:hover {
    border-color: var(--gold);
    box-shadow: 0 0 14px rgba(216, 180, 92, 0.35);
  }
  .on,
  .tabs button.on,
  .preset.on {
    border-color: var(--gold);
    background: linear-gradient(180deg, rgba(216, 180, 92, 0.45), rgba(216, 180, 92, 0.15));
    box-shadow: 0 0 12px rgba(216, 180, 92, 0.35);
  }
  .page {
    min-height: 236px;
    padding: 16px 18px;
    border-radius: 14px;
    background: rgba(0, 0, 0, 0.18);
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  }
  .heading {
    margin: 0 0 10px;
    font-size: 0.8em;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-soft);
  }
  .presets {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .preset {
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 16px 10px 14px;
  }
  .preset strong {
    font-size: 1.15em;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .preset small {
    font-size: 0.78em;
    color: var(--ink-soft);
    text-align: center;
  }
  .bars {
    display: flex;
    align-items: flex-end;
    gap: 4px;
    height: 26px;
  }
  .bars span {
    width: 8px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
  }
  .bars span:nth-child(1) {
    height: 10px;
  }
  .bars span:nth-child(2) {
    height: 18px;
  }
  .bars span:nth-child(3) {
    height: 26px;
  }
  .bars span.lit {
    background: var(--gold);
  }
  .note {
    margin: 12px 0 0;
    font-size: 0.8em;
    color: var(--ink-soft);
    text-align: center;
  }
  .toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    margin: 0 0 8px;
    padding: 12px 14px;
    border: 1px solid transparent;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--ink);
    text-align: left;
    cursor: var(--cursor-pointer);
  }
  .toggle:hover {
    border-color: rgba(216, 180, 92, 0.5);
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .text small {
    font-size: 0.78em;
    color: var(--ink-soft);
  }
  .track {
    position: relative;
    flex: none;
    width: 48px;
    height: 26px;
    border-radius: 13px;
    background: rgba(255, 255, 255, 0.16);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: background 0.15s;
  }
  .track.on {
    background: linear-gradient(180deg, #d8b45c, #a9852f);
  }
  .knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #f3eedb;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    transition: transform 0.15s;
  }
  .track.on .knob {
    transform: translateX(22px);
  }
  .keys {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 18px;
    max-height: 300px;
    overflow: auto;
  }
  .key {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .caps {
    display: flex;
    flex: none;
    gap: 4px;
  }
  kbd {
    min-width: 26px;
    padding: 3px 7px;
    border-radius: 6px;
    background: linear-gradient(180deg, #4a5240, #343a2e);
    box-shadow:
      0 2px 0 #1c2016,
      inset 0 1px 0 rgba(255, 255, 255, 0.15);
    color: #f3eedb;
    font-family: inherit;
    font-size: 0.78em;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    white-space: nowrap;
  }
  .what {
    font-size: 0.85em;
    color: var(--ink-soft);
  }
  .back {
    display: flex;
    justify-content: center;
  }
  .back button {
    width: min(280px, 70vw);
    padding: 12px 18px;
    font-size: 1.05em;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
</style>
