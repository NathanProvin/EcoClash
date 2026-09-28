// Placeholder diorama over a Replay (INSTRUCTIONS §6: the renderer only reads snapshots).
// Ground tinted by territory; flora as instanced dots (L1), cones (L2) and cubes (L3), several per
// cell at deterministic random offsets, sizes and angles for a natural look (D-029); animals as
// spheres (herbivores), small dots (decomposers) and pyramids (predators), unlit and raised.
// 1 cell = CELL world units (2 m, Q-008 default).

import { MapControls } from "three/addons/controls/MapControls.js";
import * as THREE from "three/webgpu";
import { interpolate, type Animal, type Replay, type Role } from "../replay/replay";
import { hexToRgb, PLAYER, WORLD, type PlayerId } from "./palette";

export type Layer = "territory" | "L1" | "L2" | "L3" | "animals";

export const CELL = 2;
const ROLES: Role[] = ["herbivore", "decomposer", "predator"];
/** Models per cell and size ranges per stratum: many small dots, a few cones, one or two cubes. */
const SLOTS = [5, 3, 2] as const;
const SIZE = [
  [0.35, 0.8],
  [0.45, 1.0],
  [0.6, 1.1],
] as const;
const HIGHLIGHT = new THREE.Color("#ffffff");

/** Keys held by the player, read each frame for keyboard camera moves. */
export interface CameraKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

export class Viewer {
  readonly backend: string;
  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: MapControls;
  private readonly groundData: Uint8Array;
  private readonly groundTex: THREE.DataTexture;
  private readonly strata: THREE.InstancedMesh[];
  private readonly scatter: Float32Array[]; // per stratum: n*n*slots x (dx, dz, size, angle)
  private readonly animals: Record<Role, THREE.InstancedMesh>;
  private readonly roleOf: Role[];
  private readonly animalColor: Record<PlayerId, { animal: THREE.Color; predator: THREE.Color }> = {
    1: { animal: new THREE.Color(PLAYER[1].animal), predator: new THREE.Color(PLAYER[1].predator) },
    2: { animal: new THREE.Color(PLAYER[2].animal), predator: new THREE.Color(PLAYER[2].predator) },
  };
  private lastFrame = -1;
  private showTerritory = true;
  private shown: Animal[] = [];
  private selected = new Set<number>();

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly replay: Replay,
    renderer: THREE.WebGPURenderer,
  ) {
    const n = replay.meta.n;
    const size = n * CELL;
    this.renderer = renderer;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? "WebGPU"
      : "WebGL2";
    this.roleOf = replay.meta.fauna.role;

    this.scene.background = new THREE.Color(WORLD.sky);
    this.scene.fog = new THREE.Fog(WORLD.horizon, size * 1.2, size * 3);
    this.scene.add(new THREE.HemisphereLight(WORLD.sky, WORLD.groundLight, 1.4));
    const sun = new THREE.DirectionalLight(WORLD.sun, 2.2); // one low key light (§7.1)
    sun.position.set(-size, size * 0.6, -size * 0.4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, size * 6);
    this.controls = new MapControls(this.camera, canvas);
    // RTS mouse: left = box select (handled by the UI), middle = rotate, right = pan (orders
    // take the right button in M3), wheel = zoom toward the cursor.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.15; // limited tilt (INSTRUCTIONS §2.4)
    this.controls.maxPolarAngle = 1.05;
    this.controls.minDistance = 10;
    this.controls.maxDistance = size * 2.2;
    this.resetView();

    // Ground: one texel per cell, linearly filtered so cells never read as pixels (§5.1).
    this.groundData = new Uint8Array(n * n * 4);
    this.groundTex = new THREE.DataTexture(this.groundData, n, n);
    this.groundTex.magFilter = THREE.LinearFilter;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      new THREE.MeshStandardNodeMaterial({ map: this.groundTex, roughness: 1 }),
    );
    this.scene.add(ground);

    const cells = n * n;
    const dot = new THREE.SphereGeometry(0.3, 6, 4).scale(1, 0.4, 1).translate(0, 0.12, 0);
    const cone = new THREE.ConeGeometry(0.45, 1.1, 7).translate(0, 0.55, 0);
    const cube = new THREE.BoxGeometry(0.85, 0.85, 0.85).translate(0, 1.6, 0);
    this.strata = [dot, cone, cube].map((g, s) => this.instanced(g, cells * SLOTS[s as 0], 0.9));
    this.scatter = SLOTS.map((slots, s) => scatterTable(cells * slots, 1 + s));

    const most = replay.maxAnimals();
    this.animals = {
      herbivore: this.instanced(new THREE.SphereGeometry(0.6, 12, 8).translate(0, 1.3, 0), most),
      decomposer: this.instanced(new THREE.SphereGeometry(0.3, 8, 6).translate(0, 0.9, 0), most),
      predator: this.instanced(new THREE.ConeGeometry(0.9, 2.4, 3).translate(0, 2.2, 0), most),
    };
  }

  static async create(canvas: HTMLCanvasElement, replay: Replay): Promise<Viewer> {
    // WebGPU when available, WebGL2 otherwise (INSTRUCTIONS §3.1).
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    return new Viewer(canvas, replay, renderer);
  }

  /** An instanced mesh; lit with `roughness`, or unlit (animals) without it. */
  private instanced(geometry: THREE.BufferGeometry, count: number, roughness?: number) {
    const material =
      roughness === undefined
        ? new THREE.MeshBasicNodeMaterial()
        : new THREE.MeshStandardNodeMaterial({ roughness });
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(count, 1));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(Math.max(count, 1) * 3),
      3,
    );
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    this.scene.add(mesh);
    return mesh;
  }

  resetView(): void {
    const size = this.replay.meta.n * CELL;
    this.controls.target.set(0, 0, 0);
    this.camera.position.set(0, size * 0.85, size * 0.75);
    this.controls.update();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  setVisible(layer: Layer, on: boolean): void {
    if (layer === "territory") {
      this.showTerritory = on;
      this.lastFrame = -1; // repaint the ground
    } else if (layer === "animals") {
      for (const m of Object.values(this.animals)) m.visible = on;
    } else {
      const mesh = this.strata[Number(layer[1]) - 1];
      if (mesh) mesh.visible = on;
    }
  }

  setSelection(ids: Iterable<number>): void {
    this.selected = new Set(ids);
  }

  /** Keyboard camera: pan along the ground in the view direction, rotate around the target. */
  moveCamera(keys: CameraKeys, seconds: number): void {
    const dist = this.camera.position.distanceTo(this.controls.target);
    const step = dist * 0.9 * seconds;
    const forward = new THREE.Vector3().subVectors(this.controls.target, this.camera.position);
    forward.y = 0;
    forward.normalize();
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    const move = new THREE.Vector3()
      .addScaledVector(forward, (keys.forward ? 1 : 0) - (keys.back ? 1 : 0))
      .addScaledVector(right, (keys.right ? 1 : 0) - (keys.left ? 1 : 0));
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(step);
      this.camera.position.add(move);
      this.controls.target.add(move);
    }
    const turn = ((keys.rotateLeft ? 1 : 0) - (keys.rotateRight ? 1 : 0)) * 1.6 * seconds;
    if (turn) {
      const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      this.camera.position.copy(this.controls.target).add(offset);
    }
  }

  /** Draw the replay at a fractional tick. */
  render(tick: number): void {
    const fields = this.replay.fields(tick);
    if (fields.frame !== this.lastFrame) {
      this.lastFrame = fields.frame;
      this.paintFields(fields.owner, fields.cover);
    }
    this.placeAnimals(tick);
    this.controls.update();
    void this.renderer.render(this.scene, this.camera);
  }

  /** Ids of the player's animals inside a screen rectangle (CSS pixels of the canvas). A click
   *  (tiny rectangle) picks the single nearest animal within 14 px. */
  pick(x0: number, y0: number, x1: number, y1: number, player: number): number[] {
    const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
    const click = right - left < 4 && bottom - top < 4;
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const n = this.replay.meta.n;
    const v = new THREE.Vector3();
    let best: { id: number; d: number } | undefined;
    const hits: number[] = [];
    for (const a of this.shown) {
      if (a.owner !== player) continue;
      v.set((a.x - n / 2 + 0.5) * CELL, 1.2, (a.y - n / 2 + 0.5) * CELL).project(this.camera);
      if (v.z > 1) continue; // behind the camera
      const [sx, sy] = [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
      if (click) {
        const d = Math.hypot(sx - x0, sy - y0);
        if (d < 14 && (!best || d < best.d)) best = { id: a.id, d };
      } else if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
        hits.push(a.id);
      }
    }
    return click ? (best ? [best.id] : []) : hits;
  }

  /** The animals currently drawn (interpolated), for the UI. */
  visibleAnimals(): readonly Animal[] {
    return this.shown;
  }

  private paintFields(owner: Uint8Array, cover: Uint8Array[]): void {
    const n = this.replay.meta.n;
    const soil = hexToRgb(WORLD.soil);
    const tint = { 1: hexToRgb(PLAYER[1].base), 2: hexToRgb(PLAYER[2].base) };
    const strataColor = ([1, 2] as PlayerId[]).map((p) =>
      PLAYER[p].strata.map((hex) => new THREE.Color(hex)),
    );
    const counts: Record<0 | 1 | 2, number> = { 0: 0, 1: 0, 2: 0 };
    for (let c = 0; c < n * n; c++) {
      const p = owner[c] ?? 0;
      const t = p && this.showTerritory ? tint[p as PlayerId] : soil;
      const k = p && this.showTerritory ? 0.35 : 0;
      // Texture row 0 is the plane's near edge (+z); grid row 0 is the far edge (-z): flip rows.
      const texel = ((n - 1 - Math.floor(c / n)) * n + (c % n)) * 4;
      for (let j = 0; j < 3; j++) {
        this.groundData[texel + j] = Math.round((soil[j] ?? 0) * (1 - k) + (t[j] ?? 0) * k);
      }
      this.groundData[texel + 3] = 255;
      if (!p) continue;
      const cx = (c % n) - n / 2 + 0.5;
      const cz = Math.floor(c / n) - n / 2 + 0.5;
      for (const s of [0, 1, 2] as const) {
        const v = (cover[s]?.[c] ?? 0) / 255;
        const mesh = this.strata[s];
        const color = strataColor[p - 1]?.[s];
        if (v < 0.05 || !mesh || !color) continue;
        // More models as the cover fills; each keeps its own random spot, size and angle.
        const models = Math.max(1, Math.round(v * SLOTS[s]));
        const [lo, hi] = SIZE[s];
        const table = this.scatter[s] ?? new Float32Array(0);
        for (let m = 0; m < models; m++) {
          const r = (c * SLOTS[s] + m) * 4;
          const x = (cx + (table[r] ?? 0)) * CELL;
          const z = (cz + (table[r + 1] ?? 0)) * CELL;
          const scale = (lo + (hi - lo) * v) * (table[r + 2] ?? 1) * CELL * 0.6;
          writeInstance(mesh, counts[s]++, x, z, scale, table[r + 3] ?? 0, color);
        }
      }
    }
    this.strata.forEach((m, s) => finish(m, counts[s as 0 | 1 | 2]));
    this.groundTex.needsUpdate = true;
  }

  private placeAnimals(tick: number): void {
    const t0 = Math.floor(tick);
    this.shown = interpolate(this.replay.animals(t0), this.replay.animals(t0 + 1), tick - t0);
    const n = this.replay.meta.n;
    const counts: Record<Role, number> = { herbivore: 0, decomposer: 0, predator: 0 };
    for (const a of this.shown) {
      const role = this.roleOf[a.species] ?? "herbivore";
      const colors = this.animalColor[a.owner === 2 ? 2 : 1];
      const picked = this.selected.has(a.id);
      const color = picked ? HIGHLIGHT : role === "predator" ? colors.predator : colors.animal;
      const [x, z] = [(a.x - n / 2 + 0.5) * CELL, (a.y - n / 2 + 0.5) * CELL];
      writeInstance(this.animals[role], counts[role]++, x, z, picked ? 1.35 : 1, 0, color);
    }
    for (const role of ROLES) finish(this.animals[role], counts[role]);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

/** Deterministic per-slot randomness (dx, dz in -0.42..0.42 of a cell, size 0.8..1.2, angle). */
function scatterTable(count: number, seed: number): Float32Array {
  const out = new Float32Array(count * 4);
  let h = seed * 0x9e3779b9;
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) ^ Math.imul(h ^ (h >>> 13), 0x297a2d39);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
  for (let i = 0; i < count; i++) {
    out.set(
      [(next() - 0.5) * 0.84, (next() - 0.5) * 0.84, 0.8 + next() * 0.4, next() * 6.283],
      i * 4,
    );
  }
  return out;
}

/** Rotation about Y + uniform scale + translation, written straight into the instance buffers. */
function writeInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  z: number,
  scale: number,
  angle: number,
  color: THREE.Color, // linear, managed by THREE.Color
): void {
  const [c, s] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  const m = mesh.instanceMatrix.array as Float32Array;
  m.set([c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, x, 0, z, 1], i * 16);
  (mesh.instanceColor?.array as Float32Array | undefined)?.set([color.r, color.g, color.b], i * 3);
}

function finish(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
