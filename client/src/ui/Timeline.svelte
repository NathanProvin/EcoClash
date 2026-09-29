<script lang="ts">
  // Playback strip: play / pause (Space), speed, and the scrubber for a replay or the sim time per
  // tick for a live match (INSTRUCTIONS §6: the HUD reports tick overruns). Above the unit bar.
  import type { Source } from "../replay/replay";

  let {
    replay,
    live,
    simMs,
    perf,
    tick = $bindable(),
    playing = $bindable(),
    speed = $bindable(),
    result,
  }: {
    replay: Source;
    live: boolean;
    simMs: number;
    perf: string;
    tick: number;
    playing: boolean;
    speed: number;
    result: string;
  } = $props();

  const speeds = [1, 2, 4, 8, 16, 32];
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  function playPause() {
    if (!live && !playing && tick >= replay.meta.ticks - 1) tick = 0; // replay from the start
    playing = !playing;
  }
</script>

<div class="strip panel">
  <button class="btn play" onclick={playPause} aria-label={playing ? "Pause" : "Play"}>
    {playing ? "❚❚" : "▶"}
  </button>
  {#if live}
    <span class="clock num">{clock(tick * replay.meta.dt)}</span>
    <span
      class="sim num"
      class:slow={simMs * speed > replay.meta.dt * 1000}
      title="Sim time per tick (budget 8 ms)">sim {simMs.toFixed(1)} ms/tick</span
    >
    <span class="grow"></span>
  {:else}
    <span class="clock"
      >{clock(tick * replay.meta.dt)} / {clock(replay.meta.ticks * replay.meta.dt)}</span
    >
    <input
      type="range"
      min="0"
      max={replay.meta.ticks - 1}
      step="1"
      bind:value={tick}
      aria-label="Match time"
    />
  {/if}
  <select class="btn" bind:value={speed} aria-label="Playback speed">
    {#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  {#if result}<strong class="result" role="status">{result}</strong>{/if}
  <span class="perf" title="Render rate (target: 60 fps on medium, D-040)">{perf}</span>
</div>

<style>
  .strip {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: 188px;
    width: min(760px, calc(100% - 20px));
    height: 40px;
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 0 10px;
    border-radius: 999px;
  }
  input[type="range"],
  .grow {
    flex: 1;
  }
  input[type="range"] {
    accent-color: var(--gold);
  }
  .play {
    width: 34px;
    height: 28px;
    padding: 0;
    border-radius: 999px;
    font-size: 0.8em;
  }
  .btn {
    padding: 3px 8px;
  }
  .clock {
    font-size: 1.05em;
    font-weight: 800;
    min-width: 88px;
  }
  .sim {
    font-size: 0.8em;
    color: var(--ink-soft);
  }
  .slow {
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
