<script lang="ts">
  // Main menu (D-057, D-081): title over a placeholder background, and the game's entry points.
  // "Play" lists the modes (D-137): Sandbox, Multiplayer and Ranked (soon), AI opponent; a mode
  // opens its setup (map size and seed, plus the bot level against the AI), remembered per browser;
  // "Options" holds the display settings and the list of shortcuts; "Species" shows the tech tree
  // with every species (D-140). Background: drop an image at client/public/menu/background.webp
  // and it replaces the painted placeholder.
  import {
    BOTS,
    cleanCode,
    forMode,
    MAP_SIZES,
    randomSeed,
    roomCode,
    type Bot,
    type MapSize,
    type MatchSetup,
    type Mode,
  } from "../game/setup";
  import type { Quality } from "../render/quality";
  import OptionsMenu from "./OptionsMenu.svelte";
  import { audio } from "../audio/engine";

  // The build badge and feedback link (M5a 9, D-157): set by the deploy (VITE_BUILD) and in
  // .env (VITE_FEEDBACK_URL); a dev server shows "dev" and no link.
  const BUILD: string = import.meta.env.VITE_BUILD ?? "dev";
  /** The release shown on the main menu (D-217). */
  const VERSION = "Alpha 1.1";
  const FEEDBACK: string | undefined = import.meta.env.VITE_FEEDBACK_URL || undefined;

  let {
    setup = $bindable(),
    quality,
    onQuality,
    icons = $bindable(),
    perf = $bindable(),
    tips,
    onTips,
    onStart,
    onOnline,
    onTutorial,
    onSpecies,
  }: {
    setup: MatchSetup;
    quality: Quality;
    onQuality: (q: Quality) => void;
    icons: boolean;
    perf: boolean;
    tips: boolean;
    onTips: (on: boolean) => void;
    onStart: () => void;
    /** Host (a new code) or join an online room (D-219). */
    onOnline: (code: string) => void;
    onTutorial: () => void;
    onSpecies: () => void;
  } = $props();

  let view: "home" | "modes" | Mode | "options" = $state("home");
  let typed = $state(""); // the room code typed to join (D-219)
  const BOT_NAMES: Record<Bot, string> = {
    easy: "Easy",
    normal: "Normal",
    hard: "Hard",
    none: "No opponent",
  };
  /** The Play modes, in the menu's order; Ranked comes later (M6). */
  const MODES: { id: Mode | null; name: string; hint: string }[] = [
    { id: "sandbox", name: "Sandbox", hint: "Everything unlocked and free, no opponent" },
    { id: "online", name: "Multiplayer", hint: "A 1v1 online: host a match or join one by code" },
    { id: null, name: "Ranked", hint: "Ranked matches: coming soon" },
    { id: "ai", name: "AI opponent", hint: "A match against the bot" },
  ];
  function pick(mode: Mode) {
    setup = forMode(setup, mode);
    view = mode;
  }
  const MAP_NAMES: Record<MapSize, string> = { small: "Small", mid: "Mid", large: "Large" };
  /** Soft out-of-focus light motes rising through the background (D-164): fixed, not random. */
  const MOTES = Array.from({ length: 14 }, (_, i) => ({
    x: (i * 37 + 11) % 100,
    size: 6 + ((i * 7) % 5) * 4,
    rise: 26 + ((i * 13) % 9) * 3,
    delay: (i * 5.3) % 30,
  }));
  /** Shortcuts (letters follow the printed key, D-075). */
  const KEYS: [string, string][] = [
    ["Left-click", "Select an animal / inspect a cell"],
    ["Left-drag", "Select your animals"],
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
    ["M", "Mute / unmute"],
    ["Space", "Pause"],
    ["Esc", "Cancel / close"],
  ];

  /** A soft raindrop when the pointer reaches a new button (D-195). */
  let hovered: Element | null = null;
  function hover(e: PointerEvent) {
    const b = (e.target as Element | null)?.closest("button") ?? null;
    if (b === hovered) return;
    hovered = b;
    if (b && !(b as HTMLButtonElement).disabled) audio.play("ui.hover");
  }
</script>

<div class="menu" onpointerover={hover} role="presentation">
  <!-- The out-of-focus landscape, drifting like a slow camera move (D-164). -->
  <div class="scene" aria-hidden="true">
    <div class="sky"></div>
    <div class="hills far"></div>
    <div class="hills mid"></div>
    <div class="hills near"></div>
    <div class="motes">
      {#each MOTES as m, i (i)}
        <span
          style:left="{m.x}%"
          style:--size="{m.size}px"
          style:--rise="{m.rise}s"
          style:animation-delay="-{m.delay}s"
        ></span>
      {/each}
    </div>
  </div>
  <div class="content">
    <h1>ECO<span>CLASH</span></h1>
    {#if view === "home"}
      <p class="tagline">Grow your ecosystem. Outgrow your opponent.</p>
      <nav aria-label="Main menu">
        <button class="primary" onclick={() => (view = "modes")}>Play</button>
        <button onclick={onTutorial} title="A short guided match against the easy bot">
          Tutorial
        </button>
        <button onclick={onSpecies} title="Every species and who eats whom">Species</button>
        <button onclick={() => (view = "options")}>Options</button>
      </nav>
    {:else if view === "modes"}
      <nav aria-label="Play">
        {#each MODES as m (m.name)}
          {@const id = m.id}
          <button
            class:primary={id === "ai"}
            disabled={id === null}
            title={m.hint}
            onclick={() => id && pick(id)}
          >
            {m.name}
            {#if id === null}<small>soon</small>{/if}
          </button>
        {/each}
        <button onclick={() => (view = "home")}>Back</button>
      </nav>
    {:else if view === "sandbox" || view === "ai" || view === "online"}
      <form
        class="panel-form"
        aria-label={view === "ai"
          ? "Match against the AI"
          : view === "online"
            ? "Multiplayer"
            : "Sandbox"}
        onsubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
      >
        {#if view === "sandbox"}
          <p class="mode">Sandbox <small>everything unlocked and free</small></p>
        {:else if view === "online"}
          <p class="mode">Multiplayer <small>host picks the map, a friend joins by code</small></p>
        {/if}
        {#if view === "ai"}
          <fieldset>
            <legend>Difficulty</legend>
            <div class="choices three">
              {#each BOTS.filter((b) => b !== "none") as b (b)}
                <label class="choice" class:on={setup.bot === b}>
                  <input type="radio" name="bot" value={b} bind:group={setup.bot} />
                  {BOT_NAMES[b]}
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}
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
        {#if view === "online"}
          <nav class="actions">
            <button class="primary" type="button" onclick={() => onOnline(roomCode())}>
              Host a match
            </button>
          </nav>
          <label class="row">
            Room code
            <span class="seed">
              <input
                type="text"
                maxlength="8"
                autocomplete="off"
                spellcheck="false"
                placeholder="ABCDE"
                bind:value={typed}
              />
              <button
                type="button"
                disabled={!cleanCode(typed)}
                onclick={() => onOnline(cleanCode(typed))}
              >
                Join
              </button>
            </span>
          </label>
          <nav class="actions">
            <button type="button" onclick={() => (view = "modes")}>Back</button>
          </nav>
        {:else}
          <nav class="actions">
            <button class="primary" type="submit">Start</button>
            <button type="button" onclick={() => (view = "modes")}>Back</button>
          </nav>
        {/if}
      </form>
    {:else}
      <OptionsMenu
        {quality}
        {onQuality}
        bind:icons
        bind:perf
        {tips}
        {onTips}
        keys={KEYS}
        onBack={() => (view = "home")}
      />
    {/if}
  </div>
  <p class="foot">
    {VERSION} · build {BUILD} · placeholder art{#if FEEDBACK}
      · <a href={FEEDBACK} target="_blank" rel="noopener">Send feedback</a>{/if}
  </p>
</div>

<style>
  .menu {
    position: absolute;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: #2b3d4a;
  }
  /* The landscape (D-164): a blurred sky on a slow Ken-Burns drift, three hill planes sliding at
     their own pace (parallax), and light motes rising. Reduced motion: all still. */
  .scene,
  .sky {
    position: absolute;
    inset: 0;
  }
  .sky {
    inset: -8%;
    /* An image dropped at public/menu/background.webp covers the painted placeholder below. */
    background:
      url("/menu/background.webp") center / cover no-repeat,
      radial-gradient(ellipse at 70% 18%, rgba(255, 214, 140, 0.55), transparent 45%),
      linear-gradient(180deg, #2b3d4a 0%, #6f7f6a 48%, #c9a86a 70%, #3c4a2c 100%);
    filter: blur(6px);
    animation: drift 60s ease-in-out infinite alternate;
  }
  @keyframes drift {
    from {
      transform: scale(1.04) translate(-1.5%, 0);
    }
    to {
      transform: scale(1.12) translate(2%, -1.5%);
    }
  }
  .hills {
    position: absolute;
    inset: auto -14% 0 -14%;
    filter: blur(3px);
    animation: slide var(--pace) ease-in-out infinite alternate;
  }
  .hills.far {
    --pace: 80s;
    --shift: 2%;
    height: 58%;
    opacity: 0.75;
    background:
      radial-gradient(ellipse 45% 55% at 75% 100%, #3a4f34 60%, transparent 61%),
      radial-gradient(ellipse 40% 60% at 20% 100%, #33462e 60%, transparent 61%);
    filter: blur(6px);
  }
  .hills.mid {
    --pace: 55s;
    --shift: 4%;
    height: 48%;
    opacity: 0.9;
    background:
      radial-gradient(ellipse 60% 45% at 45% 100%, #3d5530 60%, transparent 61%),
      radial-gradient(ellipse 70% 38% at 90% 100%, #4d6a39 60%, transparent 61%);
  }
  .hills.near {
    --pace: 40s;
    --shift: 7%;
    height: 34%;
    background:
      radial-gradient(ellipse 70% 30% at 10% 100%, #5f7d42 60%, transparent 61%),
      radial-gradient(ellipse 50% 40% at 70% 100%, #1f2d1c 60%, transparent 61%);
    filter: blur(2px);
  }
  @keyframes slide {
    from {
      transform: translateX(calc(var(--shift) * -1));
    }
    to {
      transform: translateX(var(--shift));
    }
  }
  .motes span {
    position: absolute;
    bottom: -20px;
    width: var(--size);
    height: var(--size);
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 236, 190, 0.55), transparent 70%);
    filter: blur(2px);
    animation: rise var(--rise) linear infinite;
  }
  @keyframes rise {
    from {
      transform: translate(0, 0);
      opacity: 0;
    }
    15% {
      opacity: 0.8;
    }
    to {
      transform: translate(6vw, -105vh);
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sky,
    .hills,
    .motes span {
      animation: none;
    }
  }
  /* The chosen mode, over its setup (D-137). */
  .mode {
    margin: 0;
    text-align: center;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .mode small {
    display: block;
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
    color: var(--ink-soft);
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
  /* The title (D-164): moss green ECO, gold CLASH, a dark outline and a shadow behind. */
  h1 {
    margin: 0;
    font-size: clamp(2.6rem, 7vw, 4.6rem);
    font-weight: 900;
    letter-spacing: 0.08em;
    color: #7fa650;
    -webkit-text-stroke: 2px #1c2116;
    paint-order: stroke fill;
    text-shadow:
      0 5px 0 rgba(0, 0, 0, 0.35),
      0 10px 28px rgba(0, 0, 0, 0.55);
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
    cursor: var(--cursor-pointer);
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
    cursor: var(--cursor);
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
    cursor: var(--cursor-pointer);
  }
  .choice {
    text-align: center;
    transition:
      border-color 0.12s,
      box-shadow 0.12s;
  }
  .choice:hover {
    border-color: var(--gold);
  }
  /* The selected choice wears the primary button's mustard (D-165). */
  .choice.on {
    border-color: var(--gold);
    background: linear-gradient(180deg, rgba(216, 180, 92, 0.45), rgba(216, 180, 92, 0.15));
    box-shadow: 0 0 12px rgba(216, 180, 92, 0.35);
    font-weight: 800;
  }
  /* START and BACK, centred under the setup (D-165). */
  .actions {
    align-self: center;
    margin-top: 6px;
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
  .seed input {
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
    cursor: var(--cursor-pointer);
  }
  .foot {
    position: absolute;
    bottom: 12px;
    margin: 0;
    font-size: 0.75em;
    color: rgba(243, 238, 219, 0.6);
  }
  .foot a {
    color: rgba(243, 238, 219, 0.85);
  }
</style>
