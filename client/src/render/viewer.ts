// Placeholder diorama over a Replay (INSTRUCTIONS §6: the renderer only reads snapshots).
// Ground tinted by territory; flora as instanced dots (L1), cones (L2) and cubes (L3), several per
// cell in their own slots and height bands so models never overlap (layout.ts, D-033); animals as
// spheres (herbivores), small dots (decomposers) and pyramids (predators), unlit, in a band above
// the canopy, one slot each per cell. 1 cell = CELL world units (2 m, Q-008 default).

import { MapControls } from "three/addons/controls/MapControls.js";
import * as THREE from "three/webgpu";
import { interpolate, type Animal, type Replay, type Role } from "../replay/replay";
import { animalSlots, ANIMAL_BASE, CANOPY_Y, CELL, CONE, DOT, plantLayout, rand } from "./layout";
import { hexToRgb, PLAYER, WORLD, type PlayerId } from "./palette";

export type Layer = "territory" | "L1" | "L2" | "L3" | "animals";

export { CELL };
const ROLES: Role[] = ["herbivore", "decomposer", "predator"];
/** Footprint radius (m) of each animal shape at scale 1; the band starts at ANIMAL_BASE. */
const ANIMAL_R: Record<Role, number> = { herbivore: 0.35, decomposer: 0.18, predator: 0.4 };
const MAX_PER_CELL = [5, 3, 2] as const; // instance capacity per cell and stratum
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
  private readonly animals: Record<Role, THREE.InstancedMesh>;
  private readonly roleOf: Role[];
  private readonly animalColor: Record<PlayerId, { animal: THREE.Color; predator: THREE.Color }> = {
    1: { animal: new THREE.Color(PLAYER[1].animal), predator: new THREE.Color(PLAYER[1].predator) },
    2: { animal: new THREE.Color(PLAYER[2].animal), predator: new THREE.Color(PLAYER[2].predator) },
  };
  private readonly aura: THREE.Group; // smoky ring over the selected cell
  private readonly raycaster = new THREE.Raycaster();
  private flight: { from: THREE.Vector3[]; to: THREE.Vector3[]; t: number } | undefined;
  private lastTime = 0;
  private lastFrame = -1;
  private showTerritory = true;
  private shown: Animal[] = [];
  private drawn: { id: number; owner: number; x: number; z: number }[] = []; // world positions
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

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, size * 6);
    this.controls = new MapControls(this.camera, canvas);
    // RTS mouse: left = box select (handled by the UI), middle = rotate, right = pan (orders
    // take the right button in M3), wheel = zoom toward the cursor.
    this.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    this.controls.zoomToCursor = true;
    this.controls.enableDamping = true;
    this.controls.minPolarAngle = 0.15; // limited tilt (INSTRUCTIONS §2.4)
    this.controls.maxPolarAngle = 1.05;
    this.controls.minDistance = 2; // close enough to see single plant models
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
    // Unit shapes, base on the ground (dots, cones) or centred (cubes); instances scale them to
    // their footprint and place them in their band (layout.ts).
    const dot = new THREE.SphereGeometry(1, 8, 4)
      .scale(1, DOT.heightRatio / 2, 1)
      .translate(0, DOT.heightRatio / 2, 0);
    const cone = new THREE.ConeGeometry(1, CONE.heightRatio, 8).translate(
      0,
      CONE.heightRatio / 2,
      0,
    );
    const cube = new THREE.BoxGeometry(1, 1, 1);
    this.strata = [dot, cone, cube].map((g, s) =>
      this.instanced(g, cells * MAX_PER_CELL[s as 0], 0.9),
    );

    this.aura = makeAura();
    this.scene.add(this.aura);

    const most = replay.maxAnimals();
    this.animals = {
      herbivore: this.instanced(new THREE.SphereGeometry(1, 12, 8).translate(0, 1, 0), most),
      decomposer: this.instanced(new THREE.SphereGeometry(1, 8, 6).translate(0, 1, 0), most),
      predator: this.instanced(new THREE.ConeGeometry(1, 2.5, 3).translate(0, 1.25, 0), most),
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

  /** The grid cell under a screen point (CSS pixels of the canvas), or null off the map. */
  pickCell(x: number, y: number): { row: number; col: number } | null {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.raycaster.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, 1 - (y / h) * 2), this.camera);
    const hit = this.raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
      new THREE.Vector3(),
    );
    const n = this.replay.meta.n;
    if (!hit) return null;
    const col = Math.floor(hit.x / CELL + n / 2);
    const row = Math.floor(hit.z / CELL + n / 2);
    return row >= 0 && row < n && col >= 0 && col < n ? { row, col } : null;
  }

  /** Show the aura over a cell, or hide it (null). */
  setCell(cell: { row: number; col: number } | null): void {
    this.aura.visible = cell !== null;
    if (cell) this.aura.position.copy(cellCenter(cell, this.replay.meta.n));
  }

  /** Fly the camera down to a cell until single plant models fill the view. */
  zoomToCell(cell: { row: number; col: number }): void {
    const target = cellCenter(cell, this.replay.meta.n);
    const dir = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    dir.y = 0;
    dir.normalize();
    const eye = target.clone().addScaledVector(dir, 3.2).setY(2.6);
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [eye, target],
      t: 0,
    };
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
    const now = performance.now() / 1000;
    const dt = Math.min(now - (this.lastTime || now), 0.1);
    this.lastTime = now;
    const fields = this.replay.fields(tick);
    if (fields.frame !== this.lastFrame) {
      this.lastFrame = fields.frame;
      this.paintFields(fields.owner, fields.cover);
    }
    this.placeAnimals(tick);
    animateAura(this.aura, now);
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(f.t + dt / 0.8, 1);
      const e = 1 - (1 - f.t) ** 3; // ease out
      const [p0, t0] = f.from as [THREE.Vector3, THREE.Vector3];
      const [p1, t1] = f.to as [THREE.Vector3, THREE.Vector3];
      this.camera.position.lerpVectors(p0, p1, e);
      this.controls.target.lerpVectors(t0, t1, e);
      if (f.t >= 1) this.flight = undefined;
    }
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
    const v = new THREE.Vector3();
    let best: { id: number; d: number } | undefined;
    const hits: number[] = [];
    for (const a of this.drawn) {
      if (a.owner !== player) continue;
      v.set(a.x, ANIMAL_BASE + 0.4, a.z).project(this.camera);
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
      const x0 = ((c % n) - n / 2) * CELL; // cell corner in world metres
      const z0 = (Math.floor(c / n) - n / 2) * CELL;
      const layers = plantLayout(
        c,
        [0, 1, 2].map((k) => (cover[k]?.[c] ?? 0) / 255),
      );
      layers.forEach((models, s) => {
        const mesh = this.strata[s];
        const color = strataColor[p - 1]?.[s];
        if (!mesh || !color) return;
        const y = s === 2 ? CANOPY_Y : 0;
        for (const m of models) {
          const i = counts[s as 0 | 1 | 2]++;
          writeInstance(mesh, i, x0 + m.x, y, z0 + m.z, m.size, m.angle, color);
        }
      });
    }
    this.strata.forEach((m, s) => finish(m, counts[s as 0 | 1 | 2]));
    this.groundTex.needsUpdate = true;
  }

  private placeAnimals(tick: number): void {
    const t0 = Math.floor(tick);
    this.shown = interpolate(this.replay.animals(t0), this.replay.animals(t0 + 1), tick - t0);
    const n = this.replay.meta.n;
    // Animals sharing a cell each get their own slot (by id order), shrinking as they crowd.
    const byCell = new Map<number, Animal[]>();
    for (const a of this.shown) {
      const key = Math.round(a.y) * n + Math.round(a.x);
      const list = byCell.get(key);
      if (list) list.push(a);
      else byCell.set(key, [a]);
    }
    const counts: Record<Role, number> = { herbivore: 0, decomposer: 0, predator: 0 };
    this.drawn = [];
    for (const group of byCell.values()) {
      group.sort((a, b) => a.id - b.id);
      const slots = animalSlots(group.length, ANIMAL_R.predator);
      group.forEach((a, k) => {
        const slot = slots[k] ?? { x: CELL / 2, z: CELL / 2, scale: 1 };
        const role = this.roleOf[a.species] ?? "herbivore";
        const colors = this.animalColor[a.owner === 2 ? 2 : 1];
        const picked = this.selected.has(a.id);
        const color = picked ? HIGHLIGHT : role === "predator" ? colors.predator : colors.animal;
        // The animal's (interpolated) cell corner, plus its slot inside the cell.
        const x = (a.x - n / 2) * CELL + slot.x;
        const z = (a.y - n / 2) * CELL + slot.z;
        const size = ANIMAL_R[role] * slot.scale;
        writeInstance(this.animals[role], counts[role]++, x, ANIMAL_BASE, z, size, 0, color);
        this.drawn.push({ id: a.id, owner: a.owner, x, z });
      });
    }
    for (const role of ROLES) finish(this.animals[role], counts[role]);
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function cellCenter(cell: { row: number; col: number }, n: number): THREE.Vector3 {
  return new THREE.Vector3((cell.col - n / 2 + 0.5) * CELL, 0, (cell.row - n / 2 + 0.5) * CELL);
}

/** A foggy, smoky light-grey ring: three soft layers stacked through the plant height, each a
 *  radial ring with smoke puffs, drifting in opposite directions. */
function makeAura(): THREE.Group {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  const ring = g.createRadialGradient(128, 128, 36, 128, 128, 128);
  ring.addColorStop(0, "rgba(232,234,236,0)");
  ring.addColorStop(0.55, "rgba(232,234,236,0.5)");
  ring.addColorStop(0.72, "rgba(232,234,236,0.32)");
  ring.addColorStop(1, "rgba(232,234,236,0)");
  g.fillStyle = ring;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 48; i++) {
    const [a, r, s] = [rand(i, 1) * Math.PI * 2, 78 + rand(i, 2) * 50, 10 + rand(i, 3) * 14];
    const [x, y] = [128 + Math.cos(a) * r, 128 + Math.sin(a) * r];
    const puff = g.createRadialGradient(x, y, 0, x, y, s);
    puff.addColorStop(0, "rgba(240,241,243,0.22)");
    puff.addColorStop(1, "rgba(240,241,243,0)");
    g.fillStyle = puff;
    g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  [0.08, 0.9, 1.8].forEach((height, i) => {
    const material = new THREE.MeshBasicNodeMaterial({ map, transparent: true, depthWrite: false });
    material.opacity = [0.9, 0.55, 0.3][i] ?? 0.3;
    const layer = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL * (2.6 + i * 0.5), CELL * (2.6 + i * 0.5)).rotateX(-Math.PI / 2),
      material,
    );
    layer.position.y = height;
    layer.renderOrder = 10;
    group.add(layer);
  });
  group.visible = false;
  return group;
}

function animateAura(aura: THREE.Group, seconds: number): void {
  if (!aura.visible) return;
  aura.children.forEach((layer, i) => {
    layer.rotation.y = seconds * (i % 2 ? -0.35 : 0.25);
    const breathe = 1 + Math.sin(seconds * 1.6 + i) * 0.06;
    layer.scale.set(breathe, 1, breathe);
  });
}

/** Rotation about Y + uniform scale + translation, written straight into the instance buffers. */
function writeInstance(
  mesh: THREE.InstancedMesh,
  i: number,
  x: number,
  y: number, // not scaled: the height band
  z: number,
  scale: number,
  angle: number,
  color: THREE.Color, // linear, managed by THREE.Color
): void {
  const [c, s] = [Math.cos(angle) * scale, Math.sin(angle) * scale];
  const m = mesh.instanceMatrix.array as Float32Array;
  m.set([c, 0, -s, 0, 0, scale, 0, 0, s, 0, c, 0, x, y, z, 1], i * 16);
  (mesh.instanceColor?.array as Float32Array | undefined)?.set([color.r, color.g, color.b], i * 3);
}

function finish(mesh: THREE.InstancedMesh, count: number): void {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
