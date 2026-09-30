// Placeholder diorama over a Source (INSTRUCTIONS §6: the renderer only reads snapshots). The
// viewer holds the scene, camera and ground (tinted by territory, with frontier lines, P1 solid,
// P2 dashed: frontier.ts, D-040); herbs are grass blades (grass.ts), shrubs and trees come from
// PlantView (plants.ts: species forms, natural colours, growth, D-067, D-072), animals from
// AnimalView (animals.ts, D-065, D-068). 1 cell = CELL world units (4 m, D-047).

import { MapControls } from "three/addons/controls/MapControls.js";
import * as THREE from "three/webgpu";
import {
  color,
  float,
  mix,
  mx_noise_float,
  positionLocal,
  positionWorld,
  smoothstep,
  texture,
  uniform,
  uv,
  vec3,
} from "three/tsl";
import { interpolate, type Animal, type Fields, type Source } from "../replay/replay";
import { AnimalView } from "./animals";
import { Ghost, type GhostSpec } from "./ghost";
import { paintFrontier, TEXELS } from "./frontier";
import { makeGrass } from "./grass";
import { CELL, rand, SLAB_DEPTH } from "./layout";
import { hexToRgb, plantColor, PLAYER, soilColor, WORLD, type PlayerId } from "./palette";
import { LowPolyPlants, PlantView } from "./plants";
import { QUALITY, type Quality } from "./quality";

export type Layer = "territory" | "L1" | "L2" | "L3" | "animals";

export { CELL };
/** Share of the owner's hue in the ground of owned cells: light, the frontier line carries
 *  ownership and the plants keep their natural colours (D-067). */
const TERRITORY_TINT = 0.15;
/** A ping (alerts, D-077): rings spread from 1 to `spread` cells over `waveS`, `waves` times. */
const PING = { spread: 4, waveS: 1, waves: 3 } as const;
/** The drop cursor's model is at least this share of the camera distance across (readable
 *  from afar; true size up close). */
const GHOST_SIZE = 0.02;
/** Grass blends from one field frame to the next over the time between the last two frames,
 *  within these bounds (s). */
const BLEND_S = { min: 0.2, max: 2 } as const;

/** Keys held by the player, read each frame for keyboard camera moves. */
export interface CameraKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

type Covers = { species: number; cover: number }[];

export class Viewer {
  readonly backend: string;
  private readonly renderer: THREE.WebGPURenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: MapControls;
  private readonly groundData: Uint8Array;
  private readonly groundTex: THREE.DataTexture;
  private readonly frontierData: Uint8Array;
  private readonly frontierTex: THREE.DataTexture;
  private readonly frontier: THREE.Mesh;
  /** Seconds, for growth and blends (set once per frame). */
  private readonly now = uniform(0);
  // L1 as grass blades (grass.ts): RGB = the cell's herb colour, A = L1 cover, one texel per
  // cell; the previous field frame too, blended in by `blend`.
  private readonly floraData: Uint8Array;
  private readonly floraTex: THREE.DataTexture;
  private readonly floraPrev: THREE.DataTexture;
  private readonly blend = uniform(1);
  private blendFrom = 0;
  private blendS: number = BLEND_S.max;
  private grass: THREE.Mesh;
  private readonly plants: PlantView;
  private readonly animals: AnimalView;
  /** Plant species indices per level (1..3); colours per player and species (sRGB bytes, and
   *  linear for instances). */
  private readonly byLevel: number[][];
  private readonly plantRgb: Record<PlayerId, [number, number, number][]>;
  private readonly plantLinear: Record<PlayerId, THREE.Color[]>;
  private readonly aura: THREE.Group; // smoky ring over the selected cell
  private readonly raycaster = new THREE.Raycaster();
  private flight: { from: THREE.Vector3[]; to: THREE.Vector3[]; t: number } | undefined;
  private pings: { mesh: THREE.Mesh; start: number }[] = [];
  private readonly ghost: Ghost;
  private ghostSpec: GhostSpec | null = null;
  private owner: Uint8Array = new Uint8Array(0); // the last field frame's owners
  private lastTime = 0;
  private lastFrame = -1;
  private lastPaint = 0;
  private showTerritory = true;
  private shown: Animal[] = [];
  private selected = new Set<number>();

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly replay: Source,
    renderer: THREE.WebGPURenderer,
    private quality: Quality,
  ) {
    const n = replay.meta.n;
    const size = n * CELL;
    this.renderer = renderer;
    this.backend = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend
      ? "WebGPU"
      : "WebGL2";

    this.scene.background = new THREE.Color(WORLD.sky);
    this.scene.fog = new THREE.Fog(WORLD.horizon, size * 2.2, size * 5); // haze beyond the slab
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
    this.controls.minPolarAngle = 0.15; // limited tilt (INSTRUCTIONS §2.4), down to a low
    this.controls.maxPolarAngle = 1.2; // diorama view that shows the trees' height (D-067)
    this.controls.minDistance = 2; // close enough to see single plant models
    this.controls.maxDistance = size * 2.2;
    this.resetView();

    // Ground: one texel per cell, linearly filtered so cells never read as pixels (§5.1), with
    // a three-scale noise (patches, clods, grit) and darker humus mottling (D-054, D-067).
    this.groundData = new Uint8Array(n * n * 4);
    this.groundTex = new THREE.DataTexture(this.groundData, n, n);
    this.groundTex.magFilter = THREE.LinearFilter;
    this.groundTex.colorSpace = THREE.SRGBColorSpace;
    const groundMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    const patches = mx_noise_float(positionWorld.xz.mul(0.16)); // broad damp / dry patches
    const grain = float(1)
      .add(patches.mul(0.1))
      .add(mx_noise_float(positionWorld.xz.mul(0.8)).mul(0.08))
      .add(mx_noise_float(positionWorld.xz.mul(4.2)).mul(0.07)); // grit
    const earth = texture(this.groundTex, uv()).rgb;
    const humus = earth.mul(vec3(0.74, 0.68, 0.62)); // darker, warmer patches
    const mottle = smoothstep(0.05, 0.8, patches).mul(0.6);
    groundMat.colorNode = mix(earth, humus, mottle).mul(grain);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
      groundMat,
    );
    this.scene.add(ground);

    // The map as a diorama slab: an earth cross-section on its sides, topsoil to bedrock.
    const slabMat = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
    const depth = positionLocal.y.negate().div(SLAB_DEPTH); // 0 at the top, 1 at the bottom
    const soil = mix(color(WORLD.earthTop), color(WORLD.earthSub), smoothstep(0.05, 0.35, depth));
    const layers = vec3(mix(soil, color(WORLD.earthStone), smoothstep(0.65, 0.85, depth)));
    slabMat.colorNode = layers.mul(float(1).add(mx_noise_float(positionWorld.mul(1.5)).mul(0.08)));
    // Box faces: +x, -x, +y, -y, +z, -z. No top face: the ground plane is the top, and two
    // coplanar faces would z-fight.
    const noTop = new THREE.MeshBasicNodeMaterial({ visible: false });
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(size, SLAB_DEPTH, size).translate(0, -SLAB_DEPTH / 2, 0),
      [slabMat, slabMat, noTop, slabMat, slabMat, slabMat],
    );
    this.scene.add(slab);

    // Frontier overlay, a hair above the ground, under the plants; crisp texels up close.
    const side = n * TEXELS;
    this.frontierData = new Uint8Array(side * side * 4);
    this.frontierTex = new THREE.DataTexture(this.frontierData, side, side);
    this.frontierTex.magFilter = THREE.NearestFilter;
    this.frontierTex.colorSpace = THREE.SRGBColorSpace;
    this.frontier = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2).translate(0, 0.02, 0),
      new THREE.MeshBasicNodeMaterial({
        map: this.frontierTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.scene.add(this.frontier);

    const floraTexture = (data: Uint8Array) => {
      const t = new THREE.DataTexture(data, n, n);
      t.magFilter = THREE.LinearFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    this.floraData = new Uint8Array(n * n * 4);
    this.floraTex = floraTexture(this.floraData);
    this.floraPrev = floraTexture(new Uint8Array(n * n * 4));
    this.grass = this.makeGrass();
    this.scene.add(this.grass);

    const { names, level } = replay.meta.flora;
    this.byLevel = [1, 2, 3].map((l) => names.flatMap((_, i) => (level[i] === l ? [i] : [])));
    const colours = (p: PlayerId) => names.map((name, i) => plantColor(name, level[i] ?? 1, p));
    this.plantRgb = { 1: colours(1), 2: colours(2) };
    const linear = (p: PlayerId) =>
      this.plantRgb[p].map(([r, g, b]) =>
        new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace),
      );
    this.plantLinear = { 1: linear(1), 2: linear(2) };
    this.plants = new PlantView(this.scene, n, new LowPolyPlants(), this.now);
    this.animals = new AnimalView(this.scene, replay.meta, replay.maxAnimals());

    this.aura = makeAura();
    this.scene.add(this.aura);
    this.ghost = new Ghost(this.scene);
  }

  static async create(
    canvas: HTMLCanvasElement,
    replay: Source,
    quality: Quality,
  ): Promise<Viewer> {
    // WebGPU when available, WebGL2 otherwise (INSTRUCTIONS §3.1).
    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    return new Viewer(canvas, replay, renderer, quality);
  }

  private makeGrass(): THREE.Mesh {
    const perCell = QUALITY[this.quality].grass;
    return makeGrass(this.replay.meta.n, perCell, this.floraTex, this.floraPrev, this.blend);
  }

  resetView(): void {
    const size = this.replay.meta.n * CELL;
    // The whole slab in view, its near side above the bottom HUD: aim a little past the centre.
    this.controls.target.set(0, 0, size * 0.37);
    this.camera.position.set(0, size * 1.4, size * 1.45);
    this.controls.update();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, QUALITY[this.quality].pixelRatio),
    );
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }

  /** Switch the quality preset: rebuild the grass at its density, apply its resolution. */
  setQuality(q: Quality): void {
    this.quality = q;
    const visible = this.grass.visible;
    this.scene.remove(this.grass);
    this.grass.geometry.dispose();
    (this.grass.material as THREE.Material).dispose();
    this.grass = this.makeGrass();
    this.grass.visible = visible;
    this.scene.add(this.grass);
    this.resize();
  }

  setVisible(layer: Layer, on: boolean): void {
    if (layer === "territory") {
      this.showTerritory = on;
      this.frontier.visible = on;
      this.lastFrame = -1; // repaint the ground
    } else if (layer === "animals") {
      this.animals.setVisible(on);
    } else if (layer === "L1") {
      this.grass.visible = on;
    } else {
      for (const m of this.plants.meshesOf(layer === "L2" ? 1 : 2)) m.visible = on;
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

  /** The drop cursor (D-079): the armed species' model under the cursor, or none. */
  setGhost(spec: GhostSpec | null): void {
    this.ghostSpec = spec;
    this.ghost.set(spec);
  }

  /** Move the drop cursor to a screen point (null: off the canvas). Returns the cell and whether
   *  it lies off the armed player's land, or null off the map. */
  aimGhost(
    x: number | null,
    y = 0,
  ): { cell: { row: number; col: number }; offLand: boolean } | null {
    const spec = this.ghostSpec;
    const cell = spec && x !== null ? this.pickCell(x, y) : null;
    if (!spec || !cell) {
      this.ghost.aim(null, 0, "");
      return null;
    }
    const n = this.replay.meta.n;
    const offLand = this.owner[cell.row * n + cell.col] !== spec.player;
    const animal = spec.kind === "fauna";
    // Plants: the disc planted. Animals: the landing spot at home, the drop area elsewhere.
    const cells = animal ? (offLand ? spec.radius : 0.5) : spec.radius + 0.5;
    const color = animal && offLand ? WORLD.alert : PLAYER[spec.player].base;
    const at = cellCenter(cell, n);
    const least = this.camera.position.distanceTo(at) * GHOST_SIZE;
    this.ghost.aim(at, cells * CELL, color, least);
    return { cell, offLand };
  }

  /** Ping a cell: rings of `hex` spread and fade there for a few seconds (D-077). */
  ping(cell: { row: number; col: number }, hex: string): void {
    const material = new THREE.MeshBasicNodeMaterial({
      color: new THREE.Color(hex),
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2),
      material,
    );
    mesh.position.copy(cellCenter(cell, this.replay.meta.n)).setY(0.3);
    mesh.renderOrder = 11;
    this.scene.add(mesh);
    this.pings.push({ mesh, start: this.lastTime });
  }

  /** Fly the camera over a cell, keeping the current height and angle. */
  lookAt(cell: { row: number; col: number }): void {
    const target = cellCenter(cell, this.replay.meta.n);
    const offset = new THREE.Vector3().subVectors(this.camera.position, this.controls.target);
    this.flight = {
      from: [this.camera.position.clone(), this.controls.target.clone()],
      to: [target.clone().add(offset), target],
      t: 0,
    };
  }

  /** Where a cell's centre is on screen (CSS pixels of the canvas), and whether it is in view. */
  screenPoint(cell: { row: number; col: number }): { x: number; y: number; inView: boolean } {
    const v = cellCenter(cell, this.replay.meta.n).project(this.camera);
    const { clientWidth: w, clientHeight: h } = this.canvas;
    const behind = v.z > 1;
    const [x, y] = [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
    const inView = !behind && x >= 0 && x <= w && y >= 0 && y <= h;
    // Behind the camera the projection mirrors: flip it so arrows point the right way.
    return behind ? { x: w - x, y: h - y, inView } : { x, y, inView };
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
    this.now.value = now;
    const fields = this.replay.fields(tick);
    if (fields.frame !== this.lastFrame) {
      // Moving forward blends the grass in; the first frame or a scrub back shows at once.
      const step = this.lastFrame >= 0 && fields.frame > this.lastFrame;
      this.lastFrame = fields.frame;
      this.paintFields(fields, now, step);
    }
    this.blend.value = Math.min(1, (now - this.blendFrom) / this.blendS);
    this.plants.frame(now);
    const t0 = Math.floor(tick);
    this.shown = interpolate(this.replay.animals(t0), this.replay.animals(t0 + 1), tick - t0);
    const dropped = this.replay.droppedAt?.bind(this.replay);
    const ms = performance.now();
    this.animals.update(this.shown, this.selected, tick, this.replay.meta.n, ms, dropped);
    animateAura(this.aura, now);
    this.animatePings(now);
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
    for (const a of this.animals.drawn) {
      if (a.owner !== player) continue;
      v.set(a.x, a.y, a.z).project(this.camera);
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

  private paintFields(fields: Fields, now: number, step: boolean): void {
    const { owner, soil: soilDev, species, cover } = fields;
    this.owner = owner;
    const n = this.replay.meta.n;
    const tint = { 1: hexToRgb(PLAYER[1].base), 2: hexToRgb(PLAYER[2].base) };
    const [herbs = [], shrubs = [], trees = []] = this.byLevel;
    const present = (list: number[], c: number): Covers =>
      list.flatMap((i) => {
        const v = species[i]?.[c] ?? 0;
        return v ? [{ species: i, cover: v / 255 }] : [];
      });
    // Grass: the frame shown so far becomes the one to blend from.
    if (step) (this.floraPrev.image.data as Uint8Array).set(this.floraData);
    for (let c = 0; c < n * n; c++) {
      const soil = soilColor(soilDev[c] ?? 0);
      const o = owner[c] ?? 0;
      const k = o && this.showTerritory ? TERRITORY_TINT : 0;
      const t = o === 1 || o === 2 ? tint[o] : soil;
      // Texture row 0 is the plane's near edge (+z); grid row 0 is the far edge (-z): flip rows.
      const texel = ((n - 1 - Math.floor(c / n)) * n + (c % n)) * 4;
      for (let j = 0; j < 3; j++) {
        this.groundData[texel + j] = Math.round((soil[j] ?? 0) * (1 - k) + (t[j] ?? 0) * k);
      }
      this.groundData[texel + 3] = 255;
      if (o !== 1 && o !== 2) {
        this.floraData.fill(0, c * 4, c * 4 + 4);
        continue;
      }
      // Grass texel (rows not flipped: the grass shader maps world z to rows itself): the
      // cover-weighted colour of the cell's herbs.
      const rgb = [0, 0, 0];
      let weight = 0;
      for (const h of present(herbs, c)) {
        const col = this.plantRgb[o][h.species] ?? [0, 0, 0];
        for (let j = 0; j < 3; j++) rgb[j] = (rgb[j] ?? 0) + (col[j] ?? 0) * h.cover;
        weight += h.cover;
      }
      const w = weight || 1;
      this.floraData.set(
        [(rgb[0] ?? 0) / w, (rgb[1] ?? 0) / w, (rgb[2] ?? 0) / w, cover[0]?.[c] ?? 0],
        c * 4,
      );
    }
    if (!step) (this.floraPrev.image.data as Uint8Array).set(this.floraData); // no blend
    const since = now - this.lastPaint;
    this.blendS = Math.min(BLEND_S.max, Math.max(BLEND_S.min, since));
    this.blendFrom = now;
    this.lastPaint = now;
    this.plants.update(
      (c) => [present(shrubs, c), present(trees, c)],
      owner,
      this.replay.meta.flora.names,
      this.plantLinear,
      now,
    );
    this.floraTex.needsUpdate = true;
    this.floraPrev.needsUpdate = true;
    this.groundTex.needsUpdate = true;
    paintFrontier(owner, n, tint, this.frontierData, fields.pressure);
    this.frontierTex.needsUpdate = true;
  }

  private animatePings(now: number): void {
    this.pings = this.pings.filter(({ mesh, start }) => {
      const age = (now - start) / PING.waveS;
      if (age >= PING.waves) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        return false;
      }
      const k = age % 1; // this wave's progress
      mesh.scale.setScalar(CELL * (1 + (PING.spread - 1) * k));
      (mesh.material as THREE.MeshBasicNodeMaterial).opacity = 1 - k;
      return true;
    });
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
