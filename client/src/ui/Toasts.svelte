<script lang="ts">
  // Notifications (D-077): one soft stack of toasts under the resource bar. Raid alerts carry a
  // place: clicking one flies the camera there, and while its ping lasts an arrow at the screen
  // edge points to it when it is out of view. Info and order notices just fade.
  import type { Toast } from "../game/alerts";

  let {
    toasts,
    arrows,
    onGo,
  }: {
    toasts: Toast[];
    arrows: { x: number; y: number; angle: number }[];
    onGo: (t: Toast) => void;
  } = $props();
</script>

{#if toasts.length}
  <div class="stack" role="status" aria-live="polite">
    {#each toasts as t (t.id)}
      {#if t.cell}
        <button class="toast panel {t.kind} s{t.severity ?? 0}" onclick={() => onGo(t)}>
          <span class="dot" aria-hidden="true"></span>{t.text}
        </button>
      {:else}
        <p class="toast panel {t.kind}">{t.text}</p>
      {/if}
    {/each}
  </div>
{/if}
{#each arrows as a, i (i)}
  <span
    class="arrow"
    style:left="{a.x}px"
    style:top="{a.y}px"
    style:transform="translate(-50%, -50%) rotate({a.angle}rad)"
    aria-hidden="true"
  ></span>
{/each}

<style>
  .stack {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .toast {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    padding: 6px 14px;
    border-radius: 999px;
    font-size: 0.85em;
    animation: in 0.25s ease-out;
  }
  button.toast {
    cursor: var(--cursor-pointer);
    color: var(--ink);
  }
  button.toast:hover {
    border-color: var(--accent);
  }
  .alert {
    border-color: rgba(255, 122, 92, 0.55);
  }
  .alert.s2 {
    font-weight: 600;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #ff7a5c;
    box-shadow: 0 0 8px #ff7a5c;
  }
  .notice,
  .info {
    color: var(--ink-soft);
  }
  .tip {
    max-width: min(560px, 90vw);
    border-radius: 14px;
    border-color: var(--gold-soft);
    color: var(--ink);
  }
  .tip::before {
    content: "Tip";
    margin-right: 4px;
    font-size: 0.8em;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--gold);
  }
  .arrow {
    position: absolute;
    z-index: 6;
    width: 0;
    height: 0;
    border-top: 9px solid transparent;
    border-bottom: 9px solid transparent;
    border-left: 16px solid #ff7a5c;
    filter: drop-shadow(0 0 6px rgba(255, 122, 92, 0.8));
    pointer-events: none;
  }
  @keyframes in {
    from {
      opacity: 0;
      transform: translateY(-6px);
    }
  }
</style>
