// Instanced grass (INSTRUCTIONS §7.2, D-055): the herbaceous stratum (L1) as GPU blades. One merged
// static geometry; the vertex shader reads the flora texture (RGB = owner's L1 colour, A = L1 cover)
// of the last two field frames and blends them (D-072), so blades grow and fade between frames
// at each blade's root, so density and colour follow the fields with no per-frame CPU work. Blades
// bend in the wind (D-086), the tip most.

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
import { FLOWERS } from "./palette";

/** Herb looks (D-150): lichen and moss tufts lie flat as rosettes (their blades laid out this
 *  much, x their height, and lifted off the ground); wildflower tufts are this much shorter and
 *  take one flower colour per PATCH metres, so flowers grow in patches of one colour. */
const LICHEN = { spread: 1.4, lift: 0.02, flat: 0.05 } as const;
const FLOWER = { height: 0.65, tip: 0.55, patch: 3 } as const;

const BLADE_WIDTH = 0.14; // metres at the base
const BLADE_HEIGHT = [0.3, 0.55] as const; // shortest, tallest (below the shrub band)
export const TUFT = 3; // blades per tuft, fanned 60 degrees apart
const BEND = 0.12; // metres the tallest blade's tip moves in a full gust
const TUFT_SPREAD = 0.1; // metres between a tuft's blades

/** Vertex data of every blade: one triangle each (base left, base right, tip). */
export interface Blades {
  /** Blade-local positions (x, y, z), before the shader scales and moves them. */
  position: Float32Array;
  /** World x / z of the blade's base, per vertex. */
  root: Float32Array;
  /** The L1 cover above which the blade shows (0..1), per vertex: density follows cover. */
  seed: Float32Array;
  /** Per vertex (D-150): the tuft's herb pick (0..1, against the cell's herb shares), the
   *  blade's lay direction when flat (x, z), and the tuft's flower colour (FLOWERS index). */
  lay: Float32Array;
}

/** Tufts of `TUFT` blades for an `n x n` map, `perCell` tufts per cell, jittered inside their cell
 *  (deterministic). A tuft's blades share its root and seed: they show and hide together. */
export function grassBlades(n: number, perCell: number): Blades {
  const count = n * n * perCell * TUFT;
  const position = new Float32Array(count * 9);
  const root = new Float32Array(count * 6);
  const seed = new Float32Array(count * 3);
  const lay = new Float32Array(count * 12);
  for (let c = 0; c < n * n; c++) {
    const x0 = ((c % n) - n / 2) * CELL;
    const z0 = (Math.floor(c / n) - n / 2) * CELL;
    for (let k = 0; k < perCell; k++) {
      const salt = 5000 + 8 * k;
      const [rx, rz] = [x0 + rand(c, salt) * CELL, z0 + rand(c, salt + 1) * CELL];
      const tuftSeed = rand(c, salt + 4);
      const pick = rand(c, salt + 6);
      const patch = Math.floor(rx / FLOWER.patch) * 7919 + Math.floor(rz / FLOWER.patch);
      const hue = Math.floor(rand(patch, 5600) * FLOWERS.length);
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
        // Laid flat, a tuft's blades point three ways: a little star (lichen rosette).
        const out = angle + Math.PI / 2 + (t * 2 * Math.PI) / TUFT;
        const v = [pick, Math.cos(out), Math.sin(out), hue];
        lay.set([...v, ...v, ...v], b * 12);
      }
    }
  }
  return { position, root, seed, lay };
}

/** The grass mesh over an `n x n` map, drawn from `flora` (n x n RGBA, rows = grid rows): the
 *  previous field frame `prev` blended into the current one by `blend` (0..1). `mix` and
 *  `mixPrev` hold each cell's herb shares (R lichen and moss, G grasses, B wildflowers; D-150). */
export function makeGrass(
  n: number,
  perCell: number,
  flora: THREE.Texture,
  prev: THREE.Texture,
  blend: THREE.UniformNode<"float", number>,
  heights?: THREE.Texture,
  herbMix?: { now: THREE.Texture; prev: THREE.Texture },
): THREE.Mesh {
  const b = grassBlades(n, perCell);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(b.position, 3));
  geometry.setAttribute("root", new THREE.BufferAttribute(b.root, 2));
  geometry.setAttribute("seed", new THREE.BufferAttribute(b.seed, 1));
  geometry.setAttribute("lay", new THREE.BufferAttribute(b.lay, 4));
  // Normals point up: grass lights like the ground under it, not like thin tilted cards.
  const up = new Float32Array(b.position.length);
  for (let i = 1; i < up.length; i += 3) up[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(up, 3));
  // Both windings, one-sided material: both faces keep the up normal (double-sided rendering
  // would flip it on the back face and darken it).
  const index = new Uint32Array((b.seed.length / 3) * 6);
  for (let v = 0, i = 0; i < index.length; v += 3, i += 6) {
    index.set([v, v + 1, v + 2, v + 2, v + 1, v], i);
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const size = n * CELL;
  const root = attribute("root", "vec2");
  const seed = attribute("seed", "float");
  const at = root.add(size / 2).div(size); // world x/z -> texel
  const texel = mix(texture(prev, at).level(float(0)), texture(flora, at).level(float(0)), blend);
  const grow = smoothstep(seed.sub(0.05), seed.add(0.05), texel.a); // 0: blade collapsed
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
  // Roots on the relief (D-085): the ground's height at the root, from the height texture.
  const y = heights ? texture(heights, at).level(float(0)).r : float(0);
  const tip = positionLocal.y.div(BLADE_HEIGHT[1]);
  const push = wind(root, time).mul(tip.mul(tip).mul(BEND));
  // Which herb this tuft is (D-150): by its pick against the cell's shares.
  const lay = attribute("lay", "vec4");
  const shares = herbMix
    ? mix(
        texture(herbMix.prev, at).level(float(0)),
        texture(herbMix.now, at).level(float(0)),
        blend,
      )
    : vec3(0, 1, 0);
  const lichen = step(lay.x, shares.r); // pick below the lichen share
  const flower = step(float(1).sub(shares.b), lay.x).mul(lichen.oneMinus());
  const upright = positionLocal.add(vec3(push.x, 0, push.y));
  const short = upright.mul(mix(float(1), float(FLOWER.height), flower));
  const flat = vec3(
    positionLocal.x.add(lay.y.mul(positionLocal.y).mul(LICHEN.spread)),
    positionLocal.y.mul(LICHEN.flat).add(LICHEN.lift),
    positionLocal.z.add(lay.z.mul(positionLocal.y).mul(LICHEN.spread)),
  );
  const blade = mix(short, flat, lichen).mul(grow);
  material.positionNode = vec3(root.x, y, root.y).add(blade);
  const shade = mix(float(0.7), float(1.15), positionLocal.y.div(BLADE_HEIGHT[1])); // dark base
  const herb = texel.rgb.mul(mix(shade, float(0.95), lichen));
  // Flower tips: one of FLOWERS by the tuft's hue index.
  const hue = (i: number) => {
    const c = new THREE.Color(FLOWERS[i]);
    return vec3(c.r, c.g, c.b);
  };
  const bloom = mix(
    mix(hue(0), hue(1), step(1, lay.w)),
    mix(hue(2), hue(3), step(3, lay.w)),
    step(2, lay.w),
  );
  material.colorNode = mix(herb, bloom, flower.mul(smoothstep(FLOWER.tip - 0.2, FLOWER.tip, tip)));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false; // positions are made in the shader
  return mesh;
}
