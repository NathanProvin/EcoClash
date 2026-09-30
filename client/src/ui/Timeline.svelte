<script lang="ts">
  // Time controls (D-064). A live match: a small clock pill at the top left (play / pause with
  // Space, speed), with a quiet "slowed" mark when the sim cannot keep 10 Hz (INSTRUCTIONS §6).
  // A replay: a slim scrubber above the build card. Performance numbers only on request.
  import type { Source } from "../replay/replay";

  let {
    replay,
    live,
    simMs,
    perf,
    showPerf,
    tick = $bindable(),
    playing = $bindable(),
    speed = $bindable(),
    result,
  }: {
    replay: Source;
    live: boolean;
    simMs: number;
    perf: string;
    showPerf: boolean;
    tick: number;
    playing: boolean;
    speed: number;
    result: string;
  } = $props();

  const speeds = [1, 2, 4, 8, 16, 32];
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const slow = $derived(live && simMs * speed > replay.meta.dt * 1000);

  function playPause() {
    if (!live && !playing && tick >= replay.meta.ticks - 1) tick = 0; // replay from the start
    playing = !playing;
  }
</script>

<div class="strip panel" class:live>
  <button class="play" onclick={playPause} aria-label={playing ? "Pause" : "Play"}>
    {playing ? "❚❚" : "▶"}
  </button>
  <span class="clock num">{clock(tick * replay.meta.dt)}</span>
  {#if !live}
    <input
      type="range"
      min="0"
      max={replay.meta.ticks - 1}
      step="1"
      bind:value={tick}
      aria-label="Match time"
    />
    <span class="end num">{clock(replay.meta.ticks * replay.meta.dt)}</span>
  {/if}
  <select bind:value={speed} aria-label="Speed">
    {#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  {#if slow}<span class="slow" title="The simulation cannot keep up: game time slows">slowed</span
    >{/if}
  {#if result}<strong class="result" role="status">{result}</strong>{/if}
  {#if showPerf}
    <span class="perf num">sim {simMs.toFixed(1)} ms · {perf}</span>
  {/if}
</div>

<style>
  .strip {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 12px 4px 6px;
    border-radius: 999px;
    left: 50%;
    transform: translateX(-50%);
    bottom: 104px;
    width: min(680px, calc(100% - 24px));
  }
  .strip.live {
    left: 14px;
    top: 12px;
    bottom: auto;
    transform: none;
    width: auto;
  }
  input[type="range"] {
    flex: 1;
    accent-color: var(--gold);
  }
  .play {
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 50%;
    background: var(--well);
    font-size: 0.75em;
    cursor: pointer;
  }
  .clock {
    font-weight: 600;
    min-width: 42px;
  }
  .end {
    color: var(--ink-soft);
    font-size: 0.85em;
  }
  select {
    border: 0;
    background: none;
    color: var(--ink-soft);
    cursor: pointer;
  }
  select option {
    background: #1f2823;
  }
  .slow {
    font-size: 0.75em;
    color: var(--bad);
  }
  .perf {
    font-size: 0.72em;
    color: var(--ink-soft);
    white-space: nowrap;
  }
  .result {
    font-size: 0.9em;
    color: var(--gold);
  }
</style>
