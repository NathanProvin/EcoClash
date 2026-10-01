<script lang="ts">
  // Main menu (D-057, D-081): title over a placeholder background, and the game's entry points.
  // "Play" opens the match setup (opponent, map seed, practice sandbox), remembered per browser;
  // "Options" holds the display settings and the list of shortcuts; "Species" (a catalog of every
  // species) is still to come. Background: drop an image at client/public/menu/background.webp
  // and it replaces the painted placeholder.
  import {
    BOTS,
    MAP_SIZES,
    randomSeed,
    type Bot,
    type MapSize,
    type MatchSetup,
  } from "../game/setup";
  import type { Quality } from "../render/quality";

  let {
    setup = $bindable(),
    quality,
    onQuality,
    icons = $bindable(),
    perf = $bindable(),
    tips,
    onTips,
    onStart,
    onTutorial,
  }: {
    setup: MatchSetup;
    quality: Quality;
    onQuality: (q: Quality) => void;
    icons: boolean;
    perf: boolean;
    tips: boolean;
    onTips: (on: boolean) => void;
    onStart: () => void;
    onTutorial: () => void;
  } = $props();

  let view: "home" | "play" | "options" = $state("home");
  const BOT_NAMES: Record<Bot, string> = {
    easy: "Bot · easy",
    normal: "Bot · normal",
    hard: "Bot · hard",
    none: "No opponent",
  };
  const MAP_NAMES: Record<MapSize, string> = { small: "Small", mid: "Mid", large: "Large" };
  /** Shortcuts (letters follow the printed key, D-075). */
  const KEYS: [string, string][] = [
    ["Left-click / drag", "Inspect a cell / select your animals"],
    ["Right-click", "Move (on enemy land: attack-move)"],
    ["A, then click", "Attack-move"],
    ["S", "Stop"],
    ["Shift or Ctrl + 1–9", "Set a control group"],
    ["1–9", "Recall a control group"],
    ["Shift + click", "Keep dropping the armed species"],
    ["Q / E", "Rotate the camera"],
    ["Arrows / right-drag", "Pan"],
    ["Wheel", "Zoom"],
    ["Home", "Reset the view"],
    ["T", "Tech tree"],
    ["I", "Strategic icons"],
    ["Space", "Pause"],
    ["Esc", "Cancel / close"],
  ];
</script>

<div class="menu">
  <div class="hills" aria-hidden="true"></div>
  <div class="content">
    <h1>ECO<span>CLASH</span></h1>
    {#if view === "home"}
      <p class="tagline">Grow a food web. Outgrow your rival.</p>
      <nav aria-label="Main menu">
        <button class="primary" onclick={() => (view = "play")}>Play</button>
        <button onclick={onTutorial} title="A short guided match against the easy bot">
          Tutorial
        </button>
        <button disabled title="A catalog of every species: coming soon">
          Species <small>soon</small>
        </button>
        <button onclick={() => (view = "options")}>Options</button>
      </nav>
    {:else if view === "play"}
      <form
        class="panel-form"
        aria-label="Match setup"
        onsubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
      >
        <fieldset>
          <legend>Opponent</legend>
          <div class="choices">
            {#each BOTS as b (b)}
              <label class="choice" class:on={setup.bot === b}>
                <input type="radio" name="bot" value={b} bind:group={setup.bot} />
                {BOT_NAMES[b]}
              </label>
            {/each}
          </div>
        </fieldset>
        <fieldset>
          <legend>Map size</legend>
          <div class="choices three">
            {#each Object.keys(MAP_SIZES) as m (m)}
              <label class="choice" class:on={setup.map === m}>
                <input type="radio" name="map" value={m} bind:group={setup.map} />
                {MAP_NAMES[m as MapSize]}
              </label>
            {/each}
          </div>
        </fieldset>
        <label class="row">
          Map seed
          <span class="seed">
            <input type="number" min="1" max="999999" bind:value={setup.seed} />
            <button type="button" onclick={() => (setup.seed = randomSeed())} title="A new map">
              Random
            </button>
          </span>
        </label>
        <label class="row">
          <span>Sandbox <small>everything unlocked and free</small></span>
          <input type="checkbox" bind:checked={setup.sandbox} />
        </label>
        <nav>
          <button class="primary" type="submit">Start</button>
          <button type="button" onclick={() => (view = "home")}>Back</button>
        </nav>
      </form>
    {:else}
      <div class="panel-form" aria-label="Options">
        <label class="row">
          Quality
          <select value={quality} onchange={(e) => onQuality(e.currentTarget.value as Quality)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label class="row">Strategic icons <input type="checkbox" bind:checked={icons} /></label>
        <label class="row">Performance readout <input type="checkbox" bind:checked={perf} /></label>
        <label class="row">
          <span>First-match tips <small>on: shown again</small></span>
          <input type="checkbox" checked={tips} onchange={(e) => onTips(e.currentTarget.checked)} />
        </label>
        <details>
          <summary>Shortcuts</summary>
          <dl>
            {#each KEYS as [key, what] (key)}<dt>{key}</dt>
              <dd>{what}</dd>{/each}
          </dl>
        </details>
        <nav><button onclick={() => (view = "home")}>Back</button></nav>
      </div>
    {/if}
  </div>
  <p class="foot">Prototype build · placeholder art</p>
</div>

<style>
  .menu {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    overflow: hidden;
    /* An image dropped at public/menu/background.webp covers the painted placeholder below. */
    background:
      url("/menu/background.webp") center / cover no-repeat,
      radial-gradient(ellipse at 70% 18%, rgba(255, 214, 140, 0.55), transparent 45%),
      linear-gradient(180deg, #2b3d4a 0%, #6f7f6a 48%, #c9a86a 70%, #3c4a2c 100%);
  }
  /* Placeholder landscape: three rolling hill layers of meadow and forest. */
  .hills {
    position: absolute;
    inset: auto -10% 0 -10%;
    height: 55%;
    background:
      radial-gradient(ellipse 40% 60% at 20% 100%, #1f2d1c 60%, transparent 61%),
      radial-gradient(ellipse 45% 55% at 75% 100%, #273a22 60%, transparent 61%),
      radial-gradient(ellipse 60% 45% at 45% 100%, #3d5530 60%, transparent 61%),
      radial-gradient(ellipse 70% 38% at 90% 100%, #56713f 60%, transparent 61%),
      radial-gradient(ellipse 70% 30% at 10% 100%, #6b8a47 60%, transparent 61%);
    opacity: 0.9;
  }
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 36px 56px 40px;
    border-radius: 18px;
    background: var(--panel);
    box-shadow: var(--trim);
    backdrop-filter: blur(4px);
  }
  h1 {
    margin: 0;
    font-size: clamp(2.6rem, 7vw, 4.6rem);
    font-weight: 900;
    letter-spacing: 0.08em;
    color: var(--ink);
    text-shadow: 0 4px 18px rgba(0, 0, 0, 0.6);
  }
  h1 span {
    color: var(--gold);
  }
  .tagline {
    margin: 0 0 12px;
    color: var(--ink-soft);
    letter-spacing: 0.04em;
  }
  nav {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: min(280px, 70vw);
  }
  nav button {
    padding: 12px 18px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.02));
    font-size: 1.05em;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition:
      border-color 0.12s,
      box-shadow 0.12s,
      transform 0.12s;
  }
  nav button:hover:not(:disabled) {
    border-color: var(--gold);
    box-shadow: 0 0 14px rgba(216, 180, 92, 0.45);
    transform: translateY(-1px);
  }
  nav .primary {
    border-color: var(--gold);
    background: linear-gradient(180deg, rgba(216, 180, 92, 0.45), rgba(216, 180, 92, 0.15));
  }
  nav button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  small {
    margin-left: 6px;
    font-size: 0.65em;
    color: var(--ink-soft);
    letter-spacing: 0.1em;
  }
  .panel-form {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 12px;
    width: min(340px, 80vw);
    margin: 4px 0 0;
  }
  fieldset {
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend,
  .row {
    color: var(--ink-soft);
    font-size: 0.9em;
  }
  .choices {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin-top: 6px;
  }
  .choices.three {
    grid-template-columns: 1fr 1fr 1fr;
  }
  .choice {
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    color: var(--ink);
    cursor: pointer;
  }
  .choice.on {
    border-color: var(--gold);
    box-shadow: 0 0 10px var(--gold-soft);
  }
  .choice input {
    display: none;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }
  .seed {
    display: flex;
    gap: 6px;
  }
  .seed input,
  select {
    width: 7em;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--well);
  }
  .seed button {
    padding: 4px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--well);
    cursor: pointer;
  }
  select option {
    background: #1f2823;
  }
  details {
    color: var(--ink-soft);
    font-size: 0.85em;
  }
  summary {
    cursor: pointer;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 3px 14px;
    margin: 8px 0 0;
    max-height: 30vh;
    overflow: auto;
  }
  dt {
    color: var(--gold);
    white-space: nowrap;
  }
  dd {
    margin: 0;
    color: var(--ink);
  }
  .foot {
    position: absolute;
    bottom: 12px;
    margin: 0;
    font-size: 0.75em;
    color: rgba(243, 238, 219, 0.6);
  }
</style>
