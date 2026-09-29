<script lang="ts">
  // Main menu (D-057): title over a placeholder background, and the game's entry points. Only
  // "Launch game" works for now; "Species" (a catalog of every species) and "Options" (player
  // settings) are placeholders for later. Background: drop an image at
  // client/public/menu/background.webp and it replaces the painted placeholder.
  let { onLaunch }: { onLaunch: () => void } = $props();
</script>

<div class="menu">
  <div class="hills" aria-hidden="true"></div>
  <div class="content">
    <h1>ECO<span>CLASH</span></h1>
    <p class="tagline">Grow a food web. Outgrow your rival.</p>
    <nav aria-label="Main menu">
      <button class="primary" onclick={onLaunch}>Launch game</button>
      <button disabled title="A catalog of every species: coming soon">
        Species <small>soon</small>
      </button>
      <button disabled title="Player options: coming soon">Options <small>soon</small></button>
    </nav>
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
  .foot {
    position: absolute;
    bottom: 12px;
    margin: 0;
    font-size: 0.75em;
    color: rgba(243, 238, 219, 0.6);
  }
</style>
