// Weather ambience (D-132): the light eases toward the weather's sky (sun, sky light, haze, a tint
// on the backdrop), rain streaks or drifting dust fill the air, and flooded cells get a water
// tile. The sky starts to turn during the alert, so the change is felt before it hits.

import * as THREE from "three/webgpu";
import { CELL } from "./layout";
import { SKY, WORLD, type Sky } from "./palette";

/** Most particles drawn (at amount 1). */
const MOTES = 2400;
/** Rain: fall speed (m/s), streak length (m), the wind's slant (m per m of fall). */
const RAIN = { fall: 18, length: 2.4, slant: 0.35 } as const;
/** Dust: drift speed (m/s), mote length (m), height band above the ground (m). */
const DUST = { drift: 1.4, length: 0.4, low: 0.3, high: 7 } as const;
/** Particles start this high above the ground (m). */
const TOP = 26;
/** Seconds for the light to get most of the way to its new sky. */
const EASE_S = 3;
/** Share of the weather's look shown during its alert. */
const ALERT_SHARE = 0.35;
/** Flood tiles float this far above the highest corner of their cell (m). */
const FLOOD_LIFT = 0.06;

export class WeatherFx {
  private readonly motes: THREE.LineSegments;
  private readonly points = new Float32Array(MOTES * 6);
  private readonly material = new THREE.LineBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  private readonly sky: Sky = { ...SKY.clear } as Sky;
  private readonly tile: THREE.InstancedMesh;
  private target: Sky = SKY.clear as Sky;
  private share = 0;
  private flooded = "";

  constructor(
    private readonly scene: THREE.Scene,
    private readonly size: number,
    private readonly height: (x: number, z: number) => number,
    private readonly lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight },
    private readonly tint: { value: THREE.Color },
  ) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.points, 3));
    geometry.setDrawRange(0, 0);
    this.motes = new THREE.LineSegments(geometry, this.material);
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 3;
    scene.add(this.motes);
    for (let i = 0; i < MOTES; i++) this.respawn(i, Math.random() * TOP);
    const water = new THREE.MeshStandardNodeMaterial({
      color: WORLD.shallows,
      roughness: 0.35,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
    });
    const plane = new THREE.PlaneGeometry(CELL * 1.04, CELL * 1.04).rotateX(-Math.PI / 2);
    const cells = Math.round(size / CELL) ** 2;
    this.tile = new THREE.InstancedMesh(plane, water, cells);
    this.tile.count = 0;
    this.tile.renderOrder = 2;
    scene.add(this.tile);
  }

  /** The weather now: its kind (null: clear) and phase. */
  set(kind: string | null, phase: "clear" | "alert" | "active"): void {
    this.target = (kind && SKY[kind]) || (SKY.clear as Sky);
    this.share = phase === "active" ? 1 : phase === "alert" ? ALERT_SHARE : 0;
  }

  /** Water tiles over the flooded cells (row-major indices on an `n x n` grid). */
  flood(cells: readonly number[] | undefined, n: number): void {
    const key = (cells ?? []).join(",");
    if (key === this.flooded) return;
    this.flooded = key;
    const m = new THREE.Matrix4();
    (cells ?? []).forEach((c, i) => {
      const [x, z] = [(c % n) * CELL - this.size / 2, Math.floor(c / n) * CELL - this.size / 2];
      const h = Math.max(
        this.height(x, z),
        this.height(x + CELL, z),
        this.height(x, z + CELL),
        this.height(x + CELL, z + CELL),
      );
      this.tile.setMatrixAt(i, m.makeTranslation(x + CELL / 2, h + FLOOD_LIFT, z + CELL / 2));
    });
    this.tile.count = cells?.length ?? 0;
    this.tile.instanceMatrix.needsUpdate = true;
  }

  /** One frame: ease the light, move the particles. */
  update(dt: number): void {
    const k = 1 - Math.exp(-dt / (EASE_S / 3));
    const to = blend(SKY.clear as Sky, this.target, this.share);
    const s = this.sky;
    s.sunI += (to.sunI - s.sunI) * k;
    s.hemi += (to.hemi - s.hemi) * k;
    s.amount += (to.amount - s.amount) * k;
    s.particles = this.target.particles;
    this.lights.sun.color.lerp(new THREE.Color(to.sun), k);
    this.lights.sun.intensity = s.sunI;
    this.lights.hemi.intensity = s.hemi;
    (this.scene.fog as THREE.Fog).color.lerp(new THREE.Color(to.fog), k);
    this.tint.value.lerp(new THREE.Color(to.tint), k);
    this.material.color.lerp(new THREE.Color(this.target.mote), k);
    this.material.opacity = s.particles === "rain" ? 0.3 : 0.6;
    const live = s.particles ? Math.round(MOTES * s.amount * this.share ** 2) : 0;
    this.motes.geometry.setDrawRange(0, live * 2);
    for (let i = 0; i < live; i++) this.move(i, dt, s.particles === "rain");
    if (live) (this.motes.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }

  private move(i: number, dt: number, rain: boolean): void {
    const p = this.points;
    const j = i * 6;
    let [x, y, z] = [p[j] ?? 0, p[j + 1] ?? 0, p[j + 2] ?? 0];
    if (rain) {
      y -= RAIN.fall * dt;
      x += RAIN.fall * RAIN.slant * dt;
    } else {
      const t = performance.now() / 1000 + i;
      x += DUST.drift * dt;
      y += Math.sin(t * 0.7) * 0.3 * dt;
      z += Math.cos(t * 0.5) * 0.4 * dt;
    }
    const ground = this.height(x, z);
    const half = this.size / 2;
    const lost = rain ? y < ground : y < ground + DUST.low || y > ground + DUST.high;
    if (lost || Math.abs(x) > half || Math.abs(z) > half) {
      this.respawn(i, rain ? TOP : DUST.low + Math.random() * (DUST.high - DUST.low));
      return;
    }
    const len = rain ? RAIN.length : DUST.length;
    p.set([x, y, z, x - len * (rain ? RAIN.slant : 1), y + (rain ? len : 0), z], j);
  }

  private respawn(i: number, lift: number): void {
    const half = this.size / 2;
    const x = (Math.random() * 2 - 1) * half;
    const z = (Math.random() * 2 - 1) * half;
    const y = this.height(x, z) + lift;
    this.points.set([x, y, z, x, y, z], i * 6);
  }
}

/** The look `share` of the way from `a` to `b` (colours as hex strings). */
function blend(a: Sky, b: Sky, share: number): Sky {
  const mixHex = (x: string, y: string) =>
    `#${new THREE.Color(x).lerp(new THREE.Color(y), share).getHexString()}`;
  return {
    sun: mixHex(a.sun, b.sun),
    sunI: a.sunI + (b.sunI - a.sunI) * share,
    hemi: a.hemi + (b.hemi - a.hemi) * share,
    fog: mixHex(a.fog, b.fog),
    tint: mixHex(a.tint, b.tint),
    particles: b.particles,
    amount: b.amount,
    mote: b.mote,
  };
}
