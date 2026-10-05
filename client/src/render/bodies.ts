// Animal models (D-068, D-116): one low-poly model per species, one unit long along +x (head
// forward), standing on y = 0 (birds: the body centre). A body type sets the shape; the species
// palette colours its parts (coat, paler belly, dark legs and nose, markings, bill), baked into
// vertex colours. Every vertex also carries its gait role (`gait`: leg swing sign and hip height,
// wing, tail wag), which the shader in animals.ts animates per instance.

import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three/webgpu";
import type { Role } from "../replay/replay";

export const BODIES = [
  "rodent",
  "squirrel",
  "beaver",
  "hedgehog",
  "rabbit",
  "canid",
  "cat",
  "bird",
  "deer",
  "stag",
  "boar",
  "bison",
  "bear",
  "mustelid",
  "fish",
  "duck",
  "frog",
  "wader",
] as const;
export type Body = (typeof BODIES)[number];

/** Colour roles of a model's parts; eyes are always near black. */
type Tone = "coat" | "belly" | "dark" | "accent" | "light" | "bill" | "eye";
export type Palette = Record<Tone, string>;

/** Body type, real length (m, nose to tail base) and colours of a species: `color` is the coat;
 *  the other tones default from it (`paletteOf`). */
export interface AnimalForm {
  body: Body;
  length: number;
  color: string;
  tones?: Partial<Palette>;
}

export const ANIMAL_FORM: Record<string, AnimalForm> = {
  black_woodpecker: {
    body: "bird",
    length: 0.45,
    color: "#1c1b1f",
    tones: { belly: "#2b2a2e", accent: "#b8262b", dark: "#121114", bill: "#cfc6b0" },
  },
  rabbits: { body: "rabbit", length: 0.4, color: "#8d7c68", tones: { belly: "#d9cdb8" } },
  bison: {
    body: "bison",
    length: 2.8,
    color: "#4a3727",
    tones: { accent: "#6e4f35", dark: "#231910", light: "#d3cab8" },
  },
  bank_vole: { body: "rodent", length: 0.1, color: "#7a5b3e", tones: { belly: "#b9a58c" } },
  roe_deer: {
    body: "deer",
    length: 1.1,
    color: "#9a6a3e",
    tones: { belly: "#d8c4a4", dark: "#3c2c20" },
  },
  red_squirrel: {
    body: "squirrel",
    length: 0.22,
    color: "#b0552a",
    tones: { belly: "#efe3d0", accent: "#c56a35" },
  },
  red_deer: {
    body: "stag",
    length: 1.9,
    color: "#7d5534",
    tones: { belly: "#b89a72", accent: "#cdb892", dark: "#3a2a1d", light: "#dccdae" },
  },
  beaver: {
    body: "beaver",
    length: 0.8,
    color: "#5b4030",
    tones: { accent: "#2f2a26", light: "#e0a14a" },
  },
  wild_boar: {
    body: "boar",
    length: 1.3,
    color: "#5d5045",
    tones: { accent: "#2f2823", dark: "#231d19", light: "#efe6d2" },
  },
  roach: {
    body: "fish",
    length: 0.25,
    color: "#9aa3a8",
    tones: { belly: "#e4e8ea", accent: "#c8483a", dark: "#4d5a60" },
  },
  mallard: {
    body: "duck",
    length: 0.55,
    color: "#8c8579",
    tones: { accent: "#1f5a3a", belly: "#7a5a46", light: "#f1efe9", bill: "#d8b13a" },
  },
  great_tit: {
    body: "bird",
    length: 0.14,
    color: "#6f8a5a",
    tones: { belly: "#e3c94a", accent: "#18181a", dark: "#4d5f6b", bill: "#202020" },
  },
  frog: { body: "frog", length: 0.08, color: "#6f8f3c", tones: { belly: "#d6d39a" } },
  badger: {
    body: "mustelid",
    length: 0.75,
    color: "#6d6a66",
    tones: { accent: "#ecebe7", dark: "#18181a", belly: "#3a3836" },
  },
  kestrel: {
    body: "bird",
    length: 0.33,
    color: "#a0633a",
    tones: { belly: "#e0c49a", accent: "#8b8f96", dark: "#3a2a20", bill: "#e0b94a" },
  },
  pine_marten: {
    body: "mustelid",
    length: 0.5,
    color: "#5e3b22",
    tones: { belly: "#e8c066", dark: "#2e1d12" },
  },
  fox: {
    body: "canid",
    length: 0.7,
    color: "#c2612b",
    tones: { belly: "#f1e9dc", dark: "#2a1d17" },
  },
  lynx: {
    body: "cat",
    length: 1.0,
    color: "#b48b5c",
    tones: { belly: "#e6d8c0", dark: "#2b231b" },
  },
  wolf: {
    body: "canid",
    length: 1.2,
    color: "#7d7a73",
    tones: { belly: "#d3cec4", dark: "#3e3b37", light: "#d8d4cc" },
  },
  brown_bear: {
    body: "bear",
    length: 2.0,
    color: "#5a3d25",
    tones: { belly: "#8a6a4a", dark: "#2c1e13" },
  },
  pike: {
    body: "fish",
    length: 0.8,
    color: "#5e6b3e",
    tones: { belly: "#d9d6a8", accent: "#8a7a3a", dark: "#33401f" },
  },
  heron: {
    body: "wader",
    length: 0.9,
    color: "#9aa0a6",
    tones: { belly: "#e9ebec", accent: "#1c1c1f", dark: "#8a7a5a", bill: "#d4a83a" },
  },
  otter: {
    body: "mustelid",
    length: 0.7,
    color: "#4d3a2c",
    tones: { belly: "#9a8470", accent: "#4d3a2c", dark: "#2e2219" },
  },
};

export function formOf(name: string, role: Role): AnimalForm {
  return (
    ANIMAL_FORM[name] ??
    (role === "predator"
      ? { body: "canid", length: 0.6, color: "#8a6a4a" }
      : { body: "rodent", length: 0.2, color: "#7a5b3e" })
  );
}

/** The full palette of a form: the coat, a paler belly, darker legs and nose, white markings. */
export function paletteOf(form: Pick<AnimalForm, "color" | "tones">): Palette {
  const mix = (to: string, t: number) =>
    "#" + new THREE.Color(form.color).lerp(new THREE.Color(to), t).getHexString();
  return {
    coat: form.color,
    belly: mix("#efe6d6", 0.45),
    dark: mix("#000000", 0.55),
    accent: form.color,
    light: "#f3efe7",
    bill: "#3a3530",
    eye: "#0d0c0b",
    ...form.tones,
  };
}

/** Gait roles of a part: legs swing (sign: diagonal pairs) about their hip height, wings flap,
 *  tails wag. */
interface Part {
  g: THREE.BufferGeometry;
  tone: Tone;
  leg?: number;
  hip?: number;
  wing?: boolean;
  wag?: boolean;
}

/** Animals this long (m) or more get the fine model (D-150): smooth, about 4x the triangles.
 *  Small ones are many and tiny on screen, and keep the coarse one. */
export const FINE_LENGTH = 0.4;

/** Whether the part builders below make fine geometry (set per model by `animalGeometry`). */
let fine = false;
/** Radial segments of cones and cylinders, coarse and fine. */
const seg = (coarse: number) => (fine ? Math.max(8, coarse * 2) : coarse);
/** A unit-diameter ball: a faceted icosahedron, or a smooth sphere on fine models. */
const ball = () =>
  fine ? new THREE.SphereGeometry(0.5, 16, 11) : new THREE.IcosahedronGeometry(0.5, 1);

/** The model of species `form`: merged parts with `color` and `gait` (leg, hip, wing, wag). */
export function animalGeometry(
  form: Pick<AnimalForm, "body" | "color" | "tones"> & { length?: number },
): THREE.BufferGeometry {
  const palette = paletteOf(form);
  fine = (form.length ?? 0) >= FINE_LENGTH;
  const parts = [...bodyParts(form.body), ...(fine ? fineParts(form.body) : [])];
  fine = false;
  const geos = parts.map((p) => {
    const g = p.g.index ? p.g.toNonIndexed() : p.g;
    const n = g.getAttribute("position").count;
    const c = new THREE.Color(palette[p.tone]);
    const color = new Float32Array(n * 3);
    const gait = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      color.set([c.r, c.g, c.b], i * 3);
      gait.set([p.leg ?? 0, p.hip ?? 0, p.wing ? 1 : 0, p.wag ? 1 : 0], i * 4);
    }
    g.setAttribute("color", new THREE.BufferAttribute(color, 3));
    g.setAttribute("gait", new THREE.BufferAttribute(gait, 4));
    g.deleteAttribute("uv");
    return g;
  });
  return mergeGeometries(geos);
}

/** The model of a body type in a neutral coat (tests, fallbacks). */
export function bodyGeometry(body: Body): THREE.BufferGeometry {
  return animalGeometry({ body, color: "#8a7a68" });
}

// Part builders: unit model space, +x forward, y up.
const blob = (
  tone: Tone,
  [sx, sy, sz]: [number, number, number],
  [x, y, z = 0]: [number, number, number?],
  rz = 0,
): Part => ({
  g: ball().scale(sx, sy, sz).rotateZ(rz).translate(x, y, z),
  tone,
});
/** A cone pointing along +x (`dir` = 1) or -x, centred at (x, y, z). */
const snout = (
  tone: Tone,
  r: number,
  h: number,
  [x, y, z = 0]: [number, number, number?],
  dir = 1,
): Part => ({
  g: new THREE.ConeGeometry(r, h, seg(5), fine ? 2 : 1)
    .rotateZ((-dir * Math.PI) / 2)
    .translate(x, y, z),
  tone,
});
const ears = (
  tone: Tone,
  r: number,
  h: number,
  x: number,
  y: number,
  dz: number,
  tilt = 0.25,
): Part[] =>
  [-1, 1].map((s) => ({
    g: new THREE.ConeGeometry(r, h, seg(4), fine ? 2 : 1).rotateX(s * tilt).translate(x, y, s * dz),
    tone,
  }));
const eyes = (x: number, y: number, dz: number, r = 0.035): Part[] =>
  [-1, 1].map((s) => blob("eye", [r, r, r], [x, y, s * dz]));
/** A flat, rounded feather surface (wing or tail) `l` long and `w` wide, swept back by `sweep`
 *  radians, centred at (x, 0.04, z). */
const feather = (l: number, w: number, sweep: number, x: number, z: number) =>
  ball().scale(l, 0.045, w).rotateY(sweep).translate(x, 0.04, z);
/** Four legs: front pair at +dx, hind pair at -dx; diagonal pairs swing together. An upper leg in
 *  the coat, a thinner lower leg (stocking, hoof or paw) in `foot`. */
const legs = (dx: number, hip: number, dz: number, r: number, foot: Tone = "dark"): Part[] =>
  [
    [dx, dz, 1],
    [dx, -dz, -1],
    [-dx, dz, -1],
    [-dx, -dz, 1],
  ].flatMap(([x = 0, z = 0, sign = 0]) => [
    {
      g: new THREE.CylinderGeometry(r, r * 0.75, hip * 0.55, seg(5), fine ? 2 : 1).translate(
        x,
        hip * 0.725,
        z,
      ),
      tone: "coat" as Tone,
      leg: sign,
      hip,
    },
    {
      g: new THREE.CylinderGeometry(r * 0.7, r * 0.62, hip * 0.5, seg(5), fine ? 2 : 1).translate(
        x,
        hip * 0.25,
        z,
      ),
      tone: foot,
      leg: sign,
      hip,
    },
  ]);
const tail = (
  tone: Tone,
  s: [number, number, number],
  at: [number, number, number?],
  rz = 0,
): Part => ({
  ...blob(tone, s, at, rz),
  wag: true,
});

/** Extra parts on fine models (D-150), where the finer surface shows: necks joining head and
 *  chest, a fuller muzzle, hooves, a shaggier hump and mane. */
function fineParts(body: Body): Part[] {
  switch (body) {
    case "canid":
      return [
        blob("coat", [0.2, 0.26, 0.17], [0.3, 0.62], -0.6),
        blob("belly", [0.12, 0.16, 0.12], [0.33, 0.55], -0.5),
      ];
    case "cat":
      return [blob("coat", [0.2, 0.22, 0.22], [0.26, 0.64], -0.5)];
    case "deer":
    case "stag":
      return [blob("coat", [0.12, 0.08, 0.1], [0.5, 0.99]), ...hooves(0.25, 0.56, 0.08, 0.026)];
    case "boar":
      return [blob("accent", [0.5, 0.16, 0.14], [-0.04, 0.66]), ...hooves(0.24, 0.3, 0.1, 0.04)];
    case "bison":
      return [
        blob("accent", [0.4, 0.4, 0.38], [0.22, 0.4]),
        blob("dark", [0.12, 0.16, 0.16], [0.44, 0.24]),
        ...hooves(0.24, 0.42, 0.11, 0.045),
      ];
    case "bear":
      return [
        blob("coat", [0.3, 0.26, 0.4], [0.18, 0.62]),
        blob("coat", [0.2, 0.2, 0.2], [0.36, 0.6]),
      ];
    default:
      return [];
  }
}

/** Dark hooves at the foot of four legs placed like `legs(dx, hip, dz, r)`: they swing with them. */
const hooves = (dx: number, hip: number, dz: number, r: number): Part[] =>
  [
    [dx, dz, 1],
    [dx, -dz, -1],
    [-dx, dz, -1],
    [-dx, -dz, 1],
  ].map(([x = 0, z = 0, sign = 0]) => ({
    g: new THREE.CylinderGeometry(r * 0.9, r, 0.05, seg(5)).translate(x, 0.025, z),
    tone: "dark" as Tone,
    leg: sign,
    hip,
  }));

function bodyParts(body: Body): Part[] {
  switch (body) {
    case "rodent": // a round vole: tucked feet, small round ears, a thin tail
      return [
        blob("coat", [0.72, 0.42, 0.46], [-0.05, 0.22]),
        blob("belly", [0.56, 0.22, 0.38], [-0.02, 0.13]),
        blob("coat", [0.36, 0.3, 0.3], [0.33, 0.22]),
        blob("dark", [0.06, 0.06, 0.06], [0.51, 0.2]),
        blob("coat", [0.06, 0.12, 0.12], [0.27, 0.36, 0.1]),
        blob("coat", [0.06, 0.12, 0.12], [0.27, 0.36, -0.1]),
        ...eyes(0.43, 0.27, 0.1),
        tail("dark", [0.34, 0.035, 0.035], [-0.5, 0.12]),
        ...legs(0.18, 0.06, 0.12, 0.03),
      ];
    case "squirrel": // sitting up, ear tufts, a great bushy tail curled over the back
      return [
        blob("coat", [0.5, 0.48, 0.4], [-0.02, 0.27]),
        blob("belly", [0.3, 0.38, 0.28], [0.1, 0.27]),
        blob("coat", [0.3, 0.28, 0.27], [0.27, 0.53]),
        blob("dark", [0.05, 0.05, 0.05], [0.43, 0.51]),
        ...ears("accent", 0.04, 0.16, 0.22, 0.71, 0.08),
        ...eyes(0.36, 0.58, 0.09),
        tail("accent", [0.3, 0.62, 0.3], [-0.33, 0.5], 0.35),
        tail("accent", [0.22, 0.26, 0.24], [-0.2, 0.83], -0.4),
        ...legs(0.12, 0.08, 0.1, 0.035),
      ];
    case "beaver": // a heavy rodent, small ears, orange teeth, a flat scaly tail
      return [
        blob("coat", [0.68, 0.46, 0.5], [-0.02, 0.23]),
        blob("belly", [0.5, 0.22, 0.4], [0.02, 0.12]),
        blob("coat", [0.3, 0.26, 0.28], [0.36, 0.27]),
        blob("dark", [0.06, 0.05, 0.08], [0.51, 0.27]),
        { g: new THREE.BoxGeometry(0.03, 0.06, 0.05).translate(0.5, 0.19, 0), tone: "light" },
        blob("coat", [0.06, 0.07, 0.07], [0.3, 0.4, 0.11]),
        blob("coat", [0.06, 0.07, 0.07], [0.3, 0.4, -0.11]),
        ...eyes(0.43, 0.33, 0.1),
        {
          g: new THREE.BoxGeometry(0.34, 0.04, 0.18).translate(-0.5, 0.05, 0),
          tone: "accent",
          wag: true,
        },
        ...legs(0.2, 0.08, 0.15, 0.04),
      ];
    case "hedgehog": // a spiny dome, a pale face and a pointed snout
      return [
        blob("coat", [0.8, 0.52, 0.72], [-0.07, 0.26]),
        ...[-0.3, -0.12, 0.06].flatMap((x) =>
          [-0.22, 0, 0.22].map((z): Part => ({
            g: new THREE.ConeGeometry(0.06, 0.16, seg(4))
              .rotateZ(0.5)
              .rotateX(-z * 1.6)
              .translate(x, 0.48 - Math.abs(z) * 0.4, z),
            tone: "dark",
          })),
        ),
        blob("belly", [0.32, 0.28, 0.34], [0.3, 0.17]),
        snout("belly", 0.08, 0.2, [0.5, 0.15]),
        blob("eye", [0.05, 0.05, 0.05], [0.61, 0.15]),
        ...eyes(0.4, 0.23, 0.11),
        ...legs(0.18, 0.06, 0.18, 0.03),
      ];
    case "rabbit": // haunches, a chest, long ears, a white powder-puff tail
      return [
        blob("coat", [0.6, 0.52, 0.48], [-0.1, 0.27]),
        blob("coat", [0.38, 0.4, 0.36], [0.12, 0.28]),
        blob("belly", [0.42, 0.2, 0.34], [0.0, 0.12]),
        blob("coat", [0.32, 0.3, 0.27], [0.33, 0.5]),
        blob("dark", [0.05, 0.04, 0.05], [0.49, 0.48]),
        ...[-1, 1].map((s) => blob("coat", [0.09, 0.4, 0.05], [0.24, 0.78, s * 0.06], 0.3)),
        ...eyes(0.42, 0.55, 0.09),
        tail("light", [0.15, 0.15, 0.15], [-0.42, 0.36]),
        blob("belly", [0.3, 0.07, 0.1], [-0.08, 0.035, 0.16]),
        blob("belly", [0.3, 0.07, 0.1], [-0.08, 0.035, -0.16]),
        ...legs(0.18, 0.12, 0.08, 0.03, "coat"),
      ];
    case "canid": // a lithe body on long legs, a long muzzle, pointed ears, a brush tail
      return [
        blob("coat", [0.4, 0.34, 0.28], [0.18, 0.55]),
        blob("coat", [0.62, 0.28, 0.24], [-0.08, 0.53]),
        blob("belly", [0.26, 0.24, 0.2], [0.26, 0.46]),
        blob("coat", [0.26, 0.22, 0.22], [0.4, 0.68]),
        snout("coat", 0.075, 0.22, [0.59, 0.64]),
        blob("belly", [0.16, 0.06, 0.1], [0.52, 0.6]),
        blob("dark", [0.05, 0.04, 0.05], [0.7, 0.64]),
        ...ears("coat", 0.05, 0.13, 0.36, 0.83, 0.07),
        ...ears("dark", 0.025, 0.05, 0.36, 0.89, 0.075),
        ...eyes(0.48, 0.72, 0.07, 0.025),
        tail("coat", [0.42, 0.15, 0.15], [-0.5, 0.46], 0.35),
        tail("light", [0.13, 0.11, 0.11], [-0.68, 0.38], 0.35),
        ...legs(0.24, 0.42, 0.08, 0.035),
      ];
    case "cat": // a heavy body, a round head with a ruff, tufted ears, a short dark-tipped tail
      return [
        blob("coat", [0.72, 0.34, 0.3], [-0.02, 0.56]),
        blob("belly", [0.5, 0.16, 0.22], [0, 0.45]),
        blob("coat", [0.3, 0.26, 0.26], [0.4, 0.7]),
        blob("belly", [0.12, 0.18, 0.3], [0.38, 0.64]),
        blob("belly", [0.12, 0.08, 0.12], [0.53, 0.66]),
        blob("dark", [0.04, 0.03, 0.04], [0.58, 0.68]),
        ...ears("coat", 0.045, 0.12, 0.37, 0.87, 0.08),
        ...ears("dark", 0.012, 0.1, 0.37, 0.97, 0.085),
        ...eyes(0.5, 0.74, 0.07, 0.028),
        tail("coat", [0.18, 0.1, 0.1], [-0.44, 0.6], 0.4),
        tail("dark", [0.06, 0.08, 0.08], [-0.53, 0.65]),
        ...legs(0.24, 0.42, 0.1, 0.045),
      ];
    case "bird": // a body, a capped head, a bill, spread two-tone wings and a tail (centre at 0)
      return [
        blob("coat", [0.66, 0.3, 0.3], [-0.02, 0.02]),
        blob("belly", [0.44, 0.24, 0.26], [0.08, -0.05]),
        blob("coat", [0.28, 0.26, 0.26], [0.36, 0.06]),
        blob("accent", [0.22, 0.12, 0.24], [0.36, 0.14]),
        snout("bill", 0.04, 0.12, [0.54, 0.05]),
        ...eyes(0.44, 0.1, 0.1, 0.03),
        // Swept, rounded wings: a coat inner wing and dark primaries toward the tip.
        ...[-1, 1].flatMap((s): Part[] => [
          { g: feather(0.42, 0.78, s * 0.12, -0.02, s * 0.4), tone: "coat", wing: true },
          { g: feather(0.26, 0.5, s * 0.45, -0.1, s * 0.8), tone: "dark", wing: true },
        ]),
        { g: feather(0.36, 0.2, 0, -0.38, 0), tone: "dark" },
      ];
    case "deer": // slender on long legs, a raised neck, big ears, a pale rump
      return [
        blob("coat", [0.64, 0.32, 0.27], [-0.02, 0.66]),
        blob("belly", [0.48, 0.14, 0.2], [0, 0.56]),
        blob("light", [0.14, 0.2, 0.2], [-0.32, 0.68]),
        blob("coat", [0.14, 0.36, 0.13], [0.3, 0.86], -0.45),
        blob("coat", [0.2, 0.15, 0.14], [0.42, 1.02]),
        snout("coat", 0.055, 0.12, [0.55, 1.0]),
        blob("dark", [0.04, 0.04, 0.05], [0.61, 1.0]),
        ...[-1, 1].map((s) => blob("coat", [0.05, 0.14, 0.08], [0.36, 1.12, s * 0.08], 0.2)),
        ...eyes(0.46, 1.05, 0.06, 0.025),
        ...legs(0.25, 0.56, 0.08, 0.03),
      ];
    case "stag": // the deer body, a darker neck mane, branching antlers
      return [
        ...bodyParts("deer"),
        blob("dark", [0.17, 0.3, 0.16], [0.26, 0.82], -0.45),
        ...[-1, 1].flatMap((s): Part[] => [
          {
            g: new THREE.CylinderGeometry(0.012, 0.02, 0.36, seg(4))
              .rotateZ(0.4)
              .rotateX(-s * 0.35)
              .translate(0.36, 1.25, s * 0.1),
            tone: "accent",
          },
          {
            g: new THREE.CylinderGeometry(0.007, 0.012, 0.14, seg(4))
              .rotateZ(-0.7)
              .translate(0.42, 1.2, s * 0.1),
            tone: "accent",
          },
          {
            g: new THREE.CylinderGeometry(0.007, 0.012, 0.14, seg(4))
              .rotateZ(-0.5)
              .rotateX(-s * 0.4)
              .translate(0.35, 1.38, s * 0.16),
            tone: "accent",
          },
        ]),
      ];
    case "boar": // a deep wedge of a body, a dark mane, a long snout with a disc, tusks
      return [
        blob("coat", [0.7, 0.42, 0.36], [-0.06, 0.44]),
        blob("accent", [0.42, 0.46, 0.36], [0.14, 0.5]),
        blob("coat", [0.32, 0.26, 0.24], [0.38, 0.4]),
        {
          g: new THREE.CylinderGeometry(0.07, 0.09, 0.16, seg(6))
            .rotateZ(-Math.PI / 2)
            .translate(0.58, 0.36, 0),
          tone: "coat",
        },
        {
          g: new THREE.CylinderGeometry(0.072, 0.072, 0.02, seg(6))
            .rotateZ(-Math.PI / 2)
            .translate(0.67, 0.36, 0),
          tone: "dark",
        },
        ...[-1, 1].map((s): Part => ({
          g: new THREE.ConeGeometry(0.015, 0.09, seg(4))
            .rotateZ(-0.6)
            .translate(0.6, 0.4, s * 0.07),
          tone: "light",
        })),
        ...ears("dark", 0.045, 0.1, 0.32, 0.58, 0.08),
        ...eyes(0.46, 0.47, 0.09, 0.025),
        tail("dark", [0.14, 0.04, 0.04], [-0.43, 0.48], 0.6),
        ...legs(0.24, 0.3, 0.1, 0.05),
      ];
    case "bison": // a towering shaggy hump, a low dark head, a beard, short horns
      return [
        blob("coat", [0.5, 0.42, 0.36], [-0.2, 0.52]),
        blob("accent", [0.54, 0.62, 0.44], [0.1, 0.62]),
        blob("dark", [0.26, 0.3, 0.28], [0.4, 0.44]),
        blob("dark", [0.14, 0.2, 0.14], [0.44, 0.3]),
        blob("eye", [0.06, 0.05, 0.08], [0.53, 0.4]),
        ...[-1, 1].map((s): Part => ({
          g: new THREE.ConeGeometry(0.025, 0.13, seg(5))
            .rotateX(-s * 1.1)
            .translate(0.4, 0.58, s * 0.17),
          tone: "light",
        })),
        ...eyes(0.48, 0.5, 0.11, 0.025),
        tail("dark", [0.04, 0.22, 0.04], [-0.46, 0.44], -0.3),
        ...legs(0.24, 0.42, 0.11, 0.055),
      ];
    case "bear": // a massive body, a shoulder hump, a pale muzzle, round ears, thick legs
      return [
        blob("coat", [0.8, 0.5, 0.48], [-0.04, 0.5]),
        blob("coat", [0.36, 0.3, 0.38], [0.14, 0.7]),
        blob("coat", [0.3, 0.28, 0.28], [0.42, 0.64]),
        blob("belly", [0.16, 0.12, 0.12], [0.56, 0.6]),
        blob("dark", [0.05, 0.04, 0.06], [0.64, 0.62]),
        blob("coat", [0.1, 0.09, 0.05], [0.38, 0.8, 0.1]),
        blob("coat", [0.1, 0.09, 0.05], [0.38, 0.8, -0.1]),
        ...eyes(0.52, 0.69, 0.08, 0.025),
        ...legs(0.26, 0.4, 0.15, 0.085, "coat"),
      ];
    case "mustelid": // a long low body, a marked face, short legs, a long tail
      return [
        blob("coat", [0.66, 0.24, 0.22], [0.0, 0.2]),
        blob("belly", [0.24, 0.14, 0.16], [0.26, 0.17]),
        blob("accent", [0.24, 0.17, 0.17], [0.44, 0.24]),
        ...[-1, 1].map((s): Part => ({
          g: new THREE.BoxGeometry(0.2, 0.05, 0.02).translate(0.46, 0.27, s * 0.06),
          tone: "dark",
        })),
        blob("dark", [0.04, 0.04, 0.05], [0.56, 0.23]),
        blob("dark", [0.05, 0.05, 0.03], [0.38, 0.33, 0.07]),
        blob("dark", [0.05, 0.05, 0.03], [0.38, 0.33, -0.07]),
        ...eyes(0.5, 0.27, 0.065, 0.022),
        tail("coat", [0.34, 0.08, 0.08], [-0.46, 0.18], 0.15),
        ...legs(0.22, 0.12, 0.08, 0.03),
      ];
    case "fish": // a streamlined body, a dark back, a pale belly, red or gold fins
      return [
        blob("coat", [0.74, 0.26, 0.15], [0.05, 0.13]),
        blob("dark", [0.6, 0.1, 0.1], [0.04, 0.22]),
        blob("belly", [0.56, 0.12, 0.12], [0.06, 0.07]),
        { g: new THREE.ConeGeometry(0.07, 0.14, seg(3)).translate(-0.02, 0.29, 0), tone: "accent" },
        {
          g: new THREE.ConeGeometry(0.13, 0.22, seg(3))
            .rotateZ(Math.PI / 2)
            .translate(-0.42, 0.13, 0),
          tone: "accent",
          wag: true,
        },
        ...eyes(0.3, 0.16, 0.06, 0.03),
      ];
    case "duck": // a boat-shaped body afloat, a coloured head, a white collar, a flat bill
      return [
        blob("coat", [0.78, 0.3, 0.44], [-0.05, 0.16]),
        blob("belly", [0.3, 0.28, 0.34], [0.22, 0.2]),
        blob("dark", [0.5, 0.12, 0.08], [-0.08, 0.27, 0.19]),
        blob("dark", [0.5, 0.12, 0.08], [-0.08, 0.27, -0.19]),
        snout("dark", 0.08, 0.16, [-0.45, 0.24], -1),
        {
          g: new THREE.CylinderGeometry(0.075, 0.08, 0.04, seg(8)).translate(0.3, 0.36, 0),
          tone: "light",
        },
        blob("accent", [0.24, 0.24, 0.22], [0.34, 0.48]),
        { g: new THREE.BoxGeometry(0.17, 0.04, 0.1).translate(0.52, 0.45, 0), tone: "bill" },
        ...eyes(0.42, 0.52, 0.09, 0.025),
      ];
    case "frog": // a squat body, bulging eyes, folded hind legs, a few dark spots
      return [
        blob("coat", [0.6, 0.36, 0.55], [0.05, 0.18]),
        blob("belly", [0.5, 0.18, 0.48], [0.08, 0.1]),
        blob("coat", [0.14, 0.14, 0.14], [0.26, 0.34, 0.13]),
        blob("coat", [0.14, 0.14, 0.14], [0.26, 0.34, -0.13]),
        ...eyes(0.31, 0.37, 0.14, 0.05),
        blob("coat", [0.4, 0.18, 0.22], [-0.28, 0.09, 0.27]),
        blob("coat", [0.4, 0.18, 0.22], [-0.28, 0.09, -0.27]),
        blob("dark", [0.1, 0.05, 0.1], [-0.05, 0.35, 0.1]),
        blob("dark", [0.08, 0.05, 0.08], [0.1, 0.35, -0.12]),
        blob("dark", [0.08, 0.05, 0.08], [-0.15, 0.32, -0.05]),
      ];
    case "wader": // a slim grey body high on long legs, a white neck, a black crest, a dagger bill
      return [
        blob("coat", [0.5, 0.26, 0.24], [-0.05, 0.95]),
        blob("accent", [0.26, 0.12, 0.2], [-0.24, 0.92]),
        blob("belly", [0.1, 0.42, 0.1], [0.18, 1.22], -0.3),
        blob("belly", [0.16, 0.12, 0.11], [0.3, 1.44]),
        { g: new THREE.BoxGeometry(0.16, 0.02, 0.02).translate(0.2, 1.48, 0), tone: "accent" },
        snout("bill", 0.025, 0.3, [0.52, 1.42]),
        ...eyes(0.36, 1.46, 0.045, 0.018),
        ...[-1, 1].map((s): Part => ({
          g: new THREE.CylinderGeometry(0.015, 0.012, 0.84, seg(4)).translate(0, 0.42, s * 0.05),
          tone: "dark",
          leg: s,
          hip: 0.84,
        })),
      ];
  }
}
