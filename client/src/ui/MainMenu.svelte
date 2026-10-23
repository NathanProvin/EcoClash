<script lang="ts">
  // Main menu (D-057, D-081): title over a placeholder background, and the game's entry points.
  // "Play" lists the modes (D-137): Sandbox, Multiplayer and Ranked (soon), AI opponent; a mode
  // opens its setup (map size and seed, plus the bot level against the AI), remembered per browser;
  // "Options" holds the display settings and the list of shortcuts; "Species" shows the tech tree
  // with every species (D-140). Entries are pebbles along a footpath, setups sit on a loam slab
  // (D-256). Background: drop an image at client/public/menu/background.webp
  // and it replaces the painted placeholder.
  import {
    BOTS,
    cleanCode,
    forMode,
    MAP_SIZES,
    randomSeed,
    roomCode,
    STYLES,
    type Bot,
    type BotStyle,
    type MapSize,
    type MatchSetup,
    type Mode,
  } from "../game/setup";
  import type { Quality } from "../render/quality";
  import OptionsMenu from "./OptionsMenu.svelte";
  import FamilyIcon from "./FamilyIcon.svelte";
  import Icon from "./Icon.svelte";
  import { isPhone, toggleFullscreen } from "./fullscreen";
  // The title face (D-258): Fraunces, a soft organic serif, self-hosted (latin, about 60 KB).
  import "@fontsource-variable/fraunces/soft.css";
  import { audio } from "../audio/engine";

  // The build badge and feedback link (M5a 9, D-157): set by the deploy (VITE_BUILD) and in
  // .env (VITE_FEEDBACK_URL); a dev server shows "dev" and no link.
  const BUILD: string = import.meta.env.VITE_BUILD ?? "dev";
  /** The release shown on the main menu (D-217). */
  const VERSION = "Alpha 1.7";
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
  // Phones (D-271): a full-screen button on the menu, following the browser's state.
  const phone = isPhone();
  let fullscreen = $state(!!document.fullscreenElement);
  $effect(() => {
    const sync = () => (fullscreen = !!document.fullscreenElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  });
  let typed = $state(""); // the room code typed to join (D-219)
  const BOT_NAMES: Record<Bot, string> = {
    easy: "Easy",
    normal: "Medium",
    hard: "Hard",
    none: "No opponent",
  };
  /** The Play modes, in the menu's order; Ranked comes later (M6). */
  const MODES: { id: Mode | null; name: string; hint: string; icon: string; tone: string }[] = [
    {
      id: "sandbox",
      name: "Sandbox",
      hint: "Everything unlocked and free, no opponent",
      icon: "L3",
      tone: "moss",
    },
    {
      id: "online",
      name: "Multiplayer",
      hint: "A 1v1 online: host a match or join one by code",
      icon: "P3",
      tone: "river",
    },
    { id: null, name: "Ranked", hint: "Ranked matches: coming soon", icon: "S", tone: "dim" },
    { id: "ai", name: "AI opponent", hint: "A match against the bot", icon: "P2", tone: "gold" },
  ];
  /** Where each stone of the path sits, left or right of the trail (px), in order (D-256). */
  const SWAY = [-46, 52, -30, 40, -10];
  function pick(mode: Mode) {
    setup = forMode(setup, mode);
    view = mode;
  }
  const MAP_NAMES: Record<MapSize, string> = { small: "Small", mid: "Mid", large: "Large" };
  /** Bot styles (D-228): name and hint. */
  const STYLE_NAMES: Record<BotStyle, [string, string]> = {
    random: ["Random", "One of the four, revealed at the end"],
    wide: ["Wide", "Grabs land fast with cheap plants"],
    tall: ["Tall", "Stacks species and tech, strong late"],
    rush: ["Rush", "Raids early with grazers"],
    balanced: ["Balanced", "A bit of everything"],
  };
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
    ["H, then click", "Hold: gather there and stay"],
    ["Shift or Ctrl + 1–9", "Set a control group"],
    ["1–9", "Recall a control group"],
    ["Shift + click", "Keep planting the armed species"],
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

{#snippet trail()}
  <!-- The spine of the menu (D-258): faint, abstract lines behind the stones, a stream's
       currents, a climbing vine with its curls, and a scatter of pebbles. -->
  <svg class="trail" viewBox="0 0 200 300" preserveAspectRatio="none" aria-hidden="true">
    <g class="stream">
      <path d="M88 300 C 60 250, 140 220, 104 165 S 58 80, 112 0" />
      <path d="M100 300 C 72 252, 152 218, 116 163 S 70 78, 124 0" />
      <path d="M112 300 C 86 254, 162 214, 128 161 S 84 76, 136 0" />
    </g>
    <g class="vine">
      <path d="M118 300 C 150 255, 72 225, 96 172 S 150 95, 92 0" />
      <path d="M131 262 c 14 -6 18 -20 6 -24 c -8 -2 -10 8 -3 9" />
      <path d="M86 196 c -16 -2 -22 -16 -10 -22 c 8 -3 12 6 5 9" />
      <path d="M124 118 c 16 -4 20 -18 8 -23 c -8 -3 -11 7 -4 9" />
      <path d="M104 46 c -15 -4 -18 -18 -6 -22 c 8 -2 10 7 3 9" />
    </g>
    <path
      class="stones"
      d="M70 282h0M84 268h0M142 246h0M156 232h0M58 204h0M146 178h0M66 150h0M150 126h0M60 96h0M136 70h0M74 42h0M128 18h0"
    />
  </svg>
{/snippet}

<div class="menu" onpointerover={hover} role="presentation">
  {#if phone}
    <!-- Phones (D-271): full screen from the menu too, before a match starts. -->
    <button
      class="fs"
      onclick={toggleFullscreen}
      title={fullscreen ? "Leave full screen" : "Full screen"}
      aria-label={fullscreen ? "Leave full screen" : "Full screen"}
    >
      <Icon name={fullscreen ? "shrink" : "expand"} />
    </button>
  {/if}
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
    <h1><span class="eco">Eco</span><span class="clash">Clash</span></h1>
    {#if view === "home"}
      <p class="tagline">Grow your ecosystem. Outgrow your opponent.</p>
      <nav class="path" aria-label="Main menu">
        {@render trail()}
        <button class="pebble stone big verdigris" style:--x="0px" onclick={() => (view = "modes")}>
          <FamilyIcon family="L4" bare size={30} />Play
        </button>
        <button
          class="pebble stone moss"
          style:--x="{SWAY[1]}px"
          onclick={onTutorial}
          title="A guided match: every core mechanic, step by step"
        >
          <FamilyIcon family="L1" bare size={24} />Tutorial
        </button>
        <button
          class="pebble stone rust"
          style:--x="{SWAY[2]}px"
          onclick={onSpecies}
          title="Every species and who eats whom"
        >
          <FamilyIcon family="P2" bare size={24} />Species
        </button>
        <button
          class="pebble stone earth"
          style:--x="{SWAY[3]}px"
          onclick={() => (view = "options")}
        >
          <FamilyIcon family="D" bare size={24} />Options
        </button>
      </nav>
    {:else if view === "modes"}
      <nav class="path" aria-label="Play">
        {@render trail()}
        {#each MODES as m, i (m.name)}
          {@const id = m.id}
          <button
            class="pebble stone {m.tone}"
            class:gold={m.tone === "gold"}
            style:--x="{SWAY[i] ?? 0}px"
            disabled={id === null}
            title={m.hint}
            onclick={() => id && pick(id)}
          >
            <FamilyIcon family={m.icon} bare size={24} />{m.name}
            {#if id === null}<small>soon</small>{/if}
          </button>
        {/each}
        <button
          class="pebble stone small earth"
          style:--x="{SWAY[4]}px"
          onclick={() => (view = "home")}>Back</button
        >
      </nav>
    {:else if view === "sandbox" || view === "ai" || view === "online"}
      <form
        class="panel-form loam slab"
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
                <label class="pebble choice" class:gold={setup.bot === b}>
                  <input type="radio" name="bot" value={b} bind:group={setup.bot} />
                  {BOT_NAMES[b]}
                </label>
              {/each}
            </div>
          </fieldset>
          <fieldset>
            <legend>Bot style</legend>
            <div class="choices three">
              {#each STYLES as st (st)}
                <label
                  class="pebble choice"
                  class:gold={setup.style === st}
                  title={STYLE_NAMES[st][1]}
                >
                  <input type="radio" name="style" value={st} bind:group={setup.style} />
                  {STYLE_NAMES[st][0]}
                </label>
              {/each}
            </div>
          </fieldset>
        {/if}
        <fieldset>
          <legend>Map size</legend>
          <div class="choices three">
            {#each Object.keys(MAP_SIZES) as m (m)}
              <label class="pebble choice" class:gold={setup.map === m}>
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
            <button
              class="pebble"
              type="button"
              onclick={() => (setup.seed = randomSeed())}
              title="A new map"
            >
              Random
            </button>
          </span>
        </label>
        {#if view === "online"}
          <nav class="actions">
            <button class="pebble gold stone" type="button" onclick={() => onOnline(roomCode())}>
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
                class="pebble"
                type="button"
                disabled={!cleanCode(typed)}
                onclick={() => onOnline(cleanCode(typed))}
              >
                Join
              </button>
            </span>
          </label>
          <nav class="actions">
            <button class="pebble stone small earth" type="button" onclick={() => (view = "modes")}
              >Back</button
            >
          </nav>
        {:else}
          <nav class="actions">
            <button class="pebble gold stone" type="submit">Start</button>
            <button class="pebble stone small earth" type="button" onclick={() => (view = "modes")}
              >Back</button
            >
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
  /* No panel (D-256): the title and the stones stand in the landscape itself. */
  .content {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 24px 16px 40px;
    max-width: 100%;
  }
  /* The title (D-164, D-258): a soft serif in moss and gold, carved out of the page by a
     stepped extrusion in darker tones of each colour, then a soft drop shadow. */
  h1 {
    margin: 0 0 4px;
    font-family: "Fraunces Variable", Georgia, serif;
    font-size: clamp(3rem, 8.5vw, 5.6rem);
    font-weight: 800;
    font-variation-settings: "SOFT" 100;
    letter-spacing: 0.01em;
    line-height: 1;
    -webkit-text-stroke: 3px var(--bark-dark); /* half shows outside: the stones' rim (D-262) */
    paint-order: stroke fill;
  }
  .eco {
    color: #95c25c;
    text-shadow:
      0 1px 0 #6e9640,
      0 2px 0 #5a7d33,
      0 3px 0 #4a6a29,
      0 4px 0 #3b5720,
      0 5px 0 #2d4518,
      0 6px 0 #1f3110,
      0 10px 14px rgba(0, 0, 0, 0.45),
      0 18px 36px rgba(0, 0, 0, 0.4);
  }
  .clash {
    color: #ecd08a;
    text-shadow:
      0 1px 0 #c9a95e,
      0 2px 0 #ad8d47,
      0 3px 0 #937536,
      0 4px 0 #7a5f28,
      0 5px 0 #614a1d,
      0 6px 0 #463513,
      0 10px 14px rgba(0, 0, 0, 0.45),
      0 18px 36px rgba(0, 0, 0, 0.4);
  }
  .tagline {
    margin: 0 0 12px;
    color: var(--ink-soft);
    letter-spacing: 0.04em;
  }
  nav {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }
  /* The stones along the trail (D-256): pebbles in the build bar's look, each sat a little left
     or right of the path (--x), each a slightly different shape. */
  .path {
    position: relative;
    gap: 16px;
    padding: 10px 0 18px;
    width: min(340px, calc(100vw - 32px));
  }
  .trail {
    position: absolute;
    inset: -16px 0 -24px;
    width: 100%;
    height: calc(100% + 40px);
    overflow: visible;
    pointer-events: none;
  }
  .trail path {
    fill: none;
    stroke-linecap: round;
    vector-effect: non-scaling-stroke;
  }
  .stream path {
    stroke: rgba(160, 222, 230, 0.32);
    stroke-width: 1.2;
    stroke-dasharray: 26 14 6 14;
    animation: flow 14s linear infinite;
  }
  .stream path:nth-child(2) {
    stroke-opacity: 0.7;
    animation-duration: 19s;
  }
  .vine path {
    stroke: rgba(184, 220, 130, 0.34);
    stroke-width: 1.4;
  }
  .trail .stones {
    stroke: rgba(236, 220, 184, 0.34);
    stroke-width: 6;
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -120;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .stream path {
      animation: none;
    }
  }
  .stone {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-width: 168px;
    padding: 12px 26px 13px 22px;
    font-size: 1.02em;
    font-weight: 800;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-shadow: 0 1px 2px rgba(20, 10, 2, 0.6);
    translate: var(--x, 0) 0;
    cursor: var(--cursor-pointer);
    transition:
      transform 0.15s,
      box-shadow 0.15s,
      filter 0.15s;
  }
  .stone:nth-of-type(2n) {
    border-radius: 54% 46% 58% 42% / 46% 56% 44% 54%;
  }
  .stone:nth-of-type(3n) {
    border-radius: 48% 52% 40% 60% / 58% 46% 54% 42%;
  }
  .stone.big {
    min-width: 220px;
    padding: 18px 36px 19px 30px;
    font-size: 1.35em;
  }
  .stone.small {
    min-width: 120px;
    padding: 8px 20px;
    font-size: 0.9em;
  }
  .stone:hover:not(:disabled),
  .stone:focus-visible {
    transform: translateY(-3px) rotate(-1deg);
    filter: brightness(1.08);
    box-shadow:
      inset 0 2px 3px rgba(255, 232, 190, 0.16),
      inset 0 -3px 6px rgba(18, 10, 4, 0.45),
      0 0 0 2px var(--gold),
      0 6px 14px rgba(0, 0, 0, 0.45),
      0 0 18px rgba(216, 180, 92, 0.4);
  }
  .stone:active:not(:disabled) {
    transform: translateY(0) scale(0.98);
  }
  .stone:disabled {
    filter: saturate(0.35) brightness(0.8);
    opacity: 0.75;
    cursor: var(--cursor);
  }
  /* Stone tones: the family-icon earths. */
  .moss {
    --hi: #93ad5e;
    --lo: #3d5426;
  }
  .river {
    --hi: #5f978c;
    --lo: #1b403c;
  }
  .rust {
    --hi: #ab5d4a;
    --lo: #4b1d14;
  }
  .earth {
    --hi: #9c7a55;
    --lo: #45301c;
  }
  .dim {
    --hi: #7d8471;
    --lo: #33382c;
  }
  /* Play (D-260): a pastel verdigris stone, sage turned toward lichen blue: it stands out from
     the moss, rust and loam stones without shouting. */
  .verdigris {
    --hi: #a9cdbf;
    --lo: #4f766b;
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
    width: min(380px, calc(100vw - 32px));
    margin: 4px 0 0;
  }
  /* A slab of loam under a bark rim (the build bar's panels), its corners worn uneven. */
  .slab {
    padding: 20px 22px 22px;
    border-radius: 22px 30px 26px 34px / 30px 24px 32px 26px;
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
    gap: 8px;
    margin-top: 8px;
  }
  .choices.three {
    grid-template-columns: 1fr 1fr 1fr;
  }
  /* The options are small pebbles; the chosen one turns gold (D-165, D-256). */
  .choice {
    padding: 8px 10px;
    text-align: center;
    font-weight: 700;
    cursor: var(--cursor-pointer);
    transition:
      transform 0.12s,
      box-shadow 0.12s;
  }
  .choice:nth-child(2n) {
    border-radius: 54% 46% 58% 42% / 46% 56% 44% 54%;
  }
  .choice:hover {
    transform: translateY(-1px);
    box-shadow:
      inset 0 2px 3px rgba(255, 232, 190, 0.12),
      inset 0 -3px 6px rgba(18, 10, 4, 0.45),
      0 0 0 1.5px var(--gold);
  }
  .choice:not(.gold) {
    --hi: #6b5a40;
    --lo: #2e2416;
  }
  /* START and BACK, centred under the setup (D-165). */
  .actions {
    flex-direction: row;
    flex-wrap: wrap;
    justify-content: center;
    align-self: center;
    gap: 14px;
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
    padding: 5px 10px;
    border: 1px solid var(--bark);
    border-radius: 12px 16px 12px 16px;
    background: rgba(12, 8, 4, 0.45);
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.5);
  }
  .seed button {
    --hi: #6b5a40;
    --lo: #2e2416;
    padding: 5px 14px;
    font-weight: 700;
    cursor: var(--cursor-pointer);
  }
  .seed button:disabled {
    opacity: 0.5;
    cursor: var(--cursor);
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
  /* Phones in landscape (D-269): the column scrolls and tightens, so setups and Options fit. */
  @media (pointer: coarse) and (max-height: 500px) {
    .content {
      max-height: 100%;
      overflow-y: auto;
      gap: 8px;
      padding: 8px 16px 32px;
    }
    h1 {
      font-size: clamp(2.2rem, 6vw, 3rem);
    }
    /* Phones (D-271): the stones in a row, not down a path. */
    .path {
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      width: min(800px, calc(100vw - 32px));
      gap: 10px;
      padding: 4px 0 8px;
    }
    .path .trail {
      display: none;
    }
    .path .stone {
      translate: none;
      min-width: 0;
      padding: 9px 18px 10px 16px;
    }
    .tagline {
      margin: 0 0 4px;
      font-size: 0.85em;
    }
    .fs {
      position: absolute;
      top: 10px;
      right: 12px;
      z-index: 1;
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid var(--line);
      border-radius: 50%;
      background: var(--panel);
      color: var(--ink);
    }
  }
</style>
