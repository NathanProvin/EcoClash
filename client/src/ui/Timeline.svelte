<script lang="ts">
  // Playback strip: play / pause (Space), speed, and the scrubber for a replay or the sim time per
  // tick for a live match (INSTRUCTIONS §6: the HUD reports tick overruns). Above the unit bar.
  import type { Source } from "../replay/replay";

  let {
    replay,
    live,
    simMs,
    tick = $bindable(),
    playing = $bindable(),
    speed = $bindable(),
    result,
  }: {
    replay: Source;
    live: boolean;
    simMs: number;
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

<div class="strip">
  <button onclick={playPause} aria-label={playing ? "Pause" : "Play"}>
    {playing ? "❚❚" : "▶"}
  </button>
  {#if live}
    <span class="clock">{clock(tick * replay.meta.dt)}</span>
    <span class:slow={simMs * speed > replay.meta.dt * 1000} title="Sim time per tick (budget 8 ms)"
      >sim {simMs.toFixed(1)} ms/tick</span
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
  <select bind:value={speed} aria-label="Playback speed">
    {#each speeds as s (s)}<option value={s}>{s}×</option>{/each}
  </select>
  {#if result}<strong class="result" role="status">{result}</strong>{/if}
</div>

<style>
  .strip {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 132px;
    height: 34px;
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 0 16px;
    background: rgba(250, 250, 247, 0.72);
    border-top: 1px solid var(--line);
  }
  input[type="range"],
  .grow {
    flex: 1;
  }
  .slow {
    color: #a3261b;
  }
  button {
    width: 32px;
    height: 24px;
    border: 1px solid var(--line);
    border-radius: 6px;
    background: white;
    cursor: pointer;
    font-size: 0.8em;
  }
  .clock {
    font-variant-numeric: tabular-nums;
    font-size: 0.85em;
    min-width: 88px;
  }
  .result {
    font-size: 0.9em;
  }
</style>
