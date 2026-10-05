// Instanced herbs (INSTRUCTIONS §7.2, D-055, D-151): the herbaceous stratum (L1) as static GPU
// meshes. The vertex shaders read the flora texture (RGB = owner's L1 colour, A = L1 cover) and
// the herb mix (R lichen and moss, G grasses, B wildflowers: each one's share of the cover) of the
// last two field frames and blend them (D-072), so tufts grow and fade between frames, with no
// per-frame CPU work. Grasses are blades that bend in the wind (D-086); lichen and moss are flat,
// round patches; wildflowers are round heads on short stems. Each herb has its own tufts: a tuft
// shows where that herb's cover (L1 cover x its share) is above the tuft's seed.

import {
  attribute,
  float,
  mix,
  positionLocal,
  smoothstep,
  step,
  texture,
  time,
  vec3,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { wind } from "./growth";
import { CELL, rand } from "./layout";
import { FLOWERS, LICHENS } from "./palette";

const BLADE_WIDTH = 0.14; // metres at the base
const BLADE_HEIGHT = [0.3, 0.55] as const; // shortest, tallest (below the shrub band)
export const TUFT = 3; // blades per tuft, fanned 60 degrees apart
const BEND = 0.12; // metres the tallest blade's tip moves in a full gust
const TUFT_SPREAD = 0.1; // metres between a tuft's blades

/** Lichen and moss patches (D-151): disc radius (m), dome height and lift off the ground (m),
 *  tufts per grass tuft, and the patch (m) whose tufts share one colour. */
export const LICHEN = {
  radius: [0.18, 0.35],
  dome: 0.035,
  lift: 0.015,
  share: 0.5,
  patch: 2,
} as const;
/** Wildflowers (D-151): heads per tuft, head radius and height (m), how far heads stand from
 *  the tuft's root (m), the wind's push at the top (m), tufts per grass tuft, colour patch (m). */
export const FLOWER = {
  heads: 3,
  radius: [0.07, 0.1],
  height: [0.3, 0.45],
  spread: 0.12,
  bend: 0.08,
  share: 1 / 3,
  patch: 3,
} as const;

/** Vertex data of every blade: one triangle each (base left, base right, tip). */
export interface Blades {
  /** Blade-local positions (x, y, z), before the shader scales and moves them. */
  position: Float32Array;
  /** World x / z of the blade's base, per vertex. */
  root: Float32Array;
  /** The L1 cover above which the blade shows (0..1), per vertex: density follows cover. */
  seed: Float32Array;
}

/** Tufts of `TUFT` blades for an `n x n` map, `perCell` tufts per cell, jittered inside their cell
 *  (deterministic). A tuft's blades share its root and seed: they show and hide together. */
export function grassBlades(n: number, perCell: number): Blades {
  const count = n * n * perCell * TUFT;
  const position = new Float32Array(count * 9);
  const root = new Float32Array(count * 6);
  const seed = new Float32Array(count * 3);
  for (let c = 0; c < n * n; c++) {
    const x0 = ((c % n) - n / 2) * CELL;
    const z0 = (Math.floor(c / n) - n / 2) * CELL;
    for (let k = 0; k < perCell; k++) {
      const salt = 5000 + 8 * k;
      const [rx, rz] = [x0 + rand(c, salt) * CELL, z0 + rand(c, salt + 1) * CELL];
      const tuftSeed = rand(c, salt + 4);
      for (let t = 0; t < TUFT; t++) {
        const b = (c * perCell + k) * TUFT + t;
        const angle = rand(c, salt + 2) * Math.PI + (t * Math.PI) / TUFT;
        const h = BLADE_HEIGHT[0] + (BLADE_HEIGHT[1] - BLADE_HEIGHT[0]) * rand(c, salt + 3 + t);
        const [cx, cz] = [Math.cos(angle), Math.sin(angle)];
        const [dx, dz] = [(cx * BLADE_WIDTH) / 2, (cz * BLADE_WIDTH) / 2];
        const [ox, oz] = [-cz * TUFT_SPREAD * (t - 1), cx * TUFT_SPREAD * (t - 1)]; // fan out
        position.set([ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox, h, oz], b * 9);
        root.set([rx, rz, rx, rz, rx, rz], b * 6);
        seed.fill(tuftSeed, b * 3, b * 3 + 3);
      }
    }
  }
  return { position, root, seed };
}

/** One tuft's local geometry: positions, normals, triangle indices, and per vertex the colour
 *  index (-1: the herb's own colour from the flora texture, e.g. a stem). */
interface TuftShape {
  position: number[];
  normal: number[];
  index: number[];
  hue: number[];
}

/** A lichen or moss patch: a flat hexagon with a raised centre, `r` metres across. */
function lichenTuft(r: number, hue: number): TuftShape {
  const position = [0, LICHEN.dome, 0];
  const normal = [0, 1, 0];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    position.push(Math.cos(a) * r, 0, Math.sin(a) * r);
    normal.push(0, 1, 0);
  }
  const index: number[] = [];
  for (let i = 0; i < 6; i++) index.push(0, 1 + ((i + 1) % 6), 1 + i); // counter-clockwise from above
  return { position, normal, index, hue: Array(7).fill(hue) as number[] };
}

/** Wildflowers: `FLOWER.heads` round heads (octahedra) on thin stems, around the root. */
function flowerTuft(rnd: (k: number) => number, hue: number): TuftShape {
  const s: TuftShape = { position: [], normal: [], index: [], hue: [] };
  const corners = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;
  const faces = [
    [0, 2, 4],
    [4, 2, 1],
    [1, 2, 5],
    [5, 2, 0],
    [4, 3, 0],
    [1, 3, 4],
    [5, 3, 1],
    [0, 3, 5],
  ] as const;
  for (let h = 0; h < FLOWER.heads; h++) {
    const a = rnd(h) * Math.PI * 2;
    const d = FLOWER.spread * (0.3 + 0.7 * rnd(h + 10));
    const [x, z] = [Math.cos(a) * d, Math.sin(a) * d];
    const y = FLOWER.height[0] + (FLOWER.height[1] - FLOWER.height[0]) * rnd(h + 20);
    const r = FLOWER.radius[0] + (FLOWER.radius[1] - FLOWER.radius[0]) * rnd(h + 30);
    // The stem: one thin triangle from the ground to the head, both windings.
    const v = s.position.length / 3;
    s.position.push(x - 0.012, 0, z, x + 0.012, 0, z, x, y, z);
    s.normal.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    s.hue.push(-1, -1, -1);
    s.index.push(v, v + 1, v + 2, v + 2, v + 1, v);
    // The head: a flattened octahedron (a round blob from above).
    const o = s.position.length / 3;
    for (const [cx, cy, cz] of corners) {
      s.position.push(x + cx * r, y + cy * r * 0.7, z + cz * r);
      s.normal.push(cx, cy, cz);
      s.hue.push(hue);
    }
    for (const [i, j, k] of faces) s.index.push(o + i, o + j, o + k);
  }
  return s;
}

/** `perCell` tufts per cell of the shape `make` builds (from a tuft random and its patch colour
 *  index), as one indexed geometry with `root` (world x, z) and `seed` per vertex. */
export function tuftGeometry(
  n: number,
  perCell: number,
  salt: number,
  patch: number,
  colours: number,
  make: (rnd: (k: number) => number, hue: number) => TuftShape,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const idx: number[] = [];
  const hues: number[] = [];
  const root: number[] = [];
  const seed: number[] = [];
  for (let c = 0; c < n * n; c++) {
    const x0 = ((c % n) - n / 2) * CELL;
    const z0 = (Math.floor(c / n) - n / 2) * CELL;
    for (let k = 0; k < perCell; k++) {
      const s = salt + 64 * k;
      const [rx, rz] = [x0 + rand(c, s) * CELL, z0 + rand(c, s + 1) * CELL];
      const tuftSeed = rand(c, s + 2);
      const cluster = Math.floor(rx / patch) * 7919 + Math.floor(rz / patch);
      const hue = Math.floor(rand(cluster, salt + 7) * colours);
      const shape = make((j) => rand(c, s + 3 + j), hue);
      const base = pos.length / 3;
      pos.push(...shape.position);
      nrm.push(...shape.normal);
      hues.push(...shape.hue);
      for (const i of shape.index) idx.push(base + i);
      for (let v = 0; v < shape.position.length / 3; v++) {
        root.push(rx, rz);
        seed.push(tuftSeed);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute("hue", new THREE.Float32BufferAttribute(hues, 1));
  g.setAttribute("root", new THREE.Float32BufferAttribute(root, 2));
  g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 1));
  g.setIndex(idx);
  return g;
}

/** One of up to four colours by the tuft's `hue` attribute (0..3). */
function pickColour(list: readonly string[]) {
  const i = attribute("hue", "float");
  const c = (k: number) => {
    const col = new THREE.Color(list[Math.min(k, list.length - 1)]);
    return vec3(col.r, col.g, col.b);
  };
  return mix(mix(c(0), c(1), step(1, i)), mix(c(2), c(3), step(3, i)), step(2, i));
}

/** The herbs over an `n x n` map, drawn from `flora` (n x n RGBA, rows = grid rows): the previous
 *  field frame `prev` blended into the current one by `blend` (0..1). `herbMix` holds each cell's
 *  herb shares (R lichen and moss, G grasses, B wildflowers). A group of three meshes. */
export function makeGrass(
  n: number,
  perCell: number,
  flora: THREE.Texture,
  prev: THREE.Texture,
  blend: THREE.UniformNode<"float", number>,
  heights?: THREE.Texture,
  herbMix?: { now: THREE.Texture; prev: THREE.Texture },
): THREE.Group {
  const size = n * CELL;
  const root = attribute("root", "vec2");
  const seed = attribute("seed", "float");
  const at = root.add(size / 2).div(size); // world x/z -> texel
  const texel = mix(texture(prev, at).level(float(0)), texture(flora, at).level(float(0)), blend);
  const shares = herbMix
    ? mix(
        texture(herbMix.prev, at).level(float(0)),
        texture(herbMix.now, at).level(float(0)),
        blend,
      )
    : vec3(0, 1, 0);
  // Roots on the relief (D-085): the ground's height at the root, from the height texture.
  const y = heights ? texture(heights, at).level(float(0)).r : float(0);
  /** 0: the tuft is hidden (collapsed), 1: shown; by its herb's cover against its seed. */
  const shown = (herb: "r" | "g" | "b") =>
    smoothstep(seed.sub(0.05), seed.add(0.05), texel.a.mul(shares[herb]));

  // Grasses: blades.
  const b = grassBlades(n, perCell);
  const blades = new THREE.BufferGeometry();
  blades.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  blades.setAttribute("root", new THREE.BufferAttribute(b.root, 2));
  blades.setAttribute("seed", new THREE.BufferAttribute(b.seed, 1));
  // Normals point up: grass lights like the ground under it, not like thin tilted cards.
  const up = new Float32Array(b.position.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  blades.setAttribute("normal", new THREE.BufferAttribute(up, 3));
  // Both windings, one-sided material: both faces keep the up normal (double-sided rendering
  // would flip it on the back face and darken it).
  const index = new Uint32Array((b.seed.length / 3) * 6);
  for (let v = 0, i = 0; i < index.length; v += 3, i += 6) {
    index.set([v, v + 1, v + 2, v + 2, v + 1, v], i);
  }
  blades.setIndex(new THREE.BufferAttribute(index, 1));
  const grass = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  const tip = positionLocal.y.div(BLADE_HEIGHT[1]);
  const push = wind(root, time).mul(tip.mul(tip).mul(BEND));
  const blade = positionLocal.add(vec3(push.x, 0, push.y)).mul(shown("g"));
  grass.positionNode = vec3(root.x, y, root.y).add(blade);
  const shade = mix(float(0.7), float(1.15), tip); // dark base
  grass.colorNode = texel.rgb.mul(shade);

  // Lichen and moss: flat round patches in their own colours.
  const lichenRadius = (rnd: (k: number) => number) =>
    LICHEN.radius[0] + (LICHEN.radius[1] - LICHEN.radius[0]) * rnd(0);
  const lichenGeo = tuftGeometry(
    n,
    Math.max(1, Math.round(perCell * LICHEN.share)),
    6100,
    LICHEN.patch,
    LICHENS.length,
    (rnd, hue) => lichenTuft(lichenRadius(rnd), hue),
  );
  const lichen = new THREE.MeshStandardNodeMaterial({ roughness: 1 });
  const hue = attribute("hue", "float");
  lichen.positionNode = vec3(root.x, y.add(LICHEN.lift), root.y).add(positionLocal.mul(shown("r")));
  lichen.colorNode = pickColour(LICHENS).mul(mix(float(0.85), float(1.05), seed));

  // Wildflowers: round heads on stems, one colour per patch.
  const flowerGeo = tuftGeometry(
    n,
    Math.max(1, Math.round(perCell * FLOWER.share)),
    6900,
    FLOWER.patch,
    FLOWERS.length,
    flowerTuft,
  );
  const flower = new THREE.MeshStandardNodeMaterial({ roughness: 0.75 });
  const top = positionLocal.y.div(FLOWER.height[1]);
  const sway = wind(root, time).mul(top.mul(top).mul(FLOWER.bend));
  const swayed = positionLocal.add(vec3(sway.x, 0, sway.y)).mul(shown("b"));
  flower.positionNode = vec3(root.x, y, root.y).add(swayed);
  const isHead = step(0, hue); // stems carry -1
  flower.colorNode = mix(texel.rgb.mul(0.8), pickColour(FLOWERS), isHead);

  const group = new THREE.Group();
  for (const [g, m] of [
    [blades, grass],
    [lichenGeo, lichen],
    [flowerGeo, flower],
  ] as const) {
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; // positions are made in the shader
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
