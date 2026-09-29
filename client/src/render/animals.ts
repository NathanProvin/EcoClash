// Animal models (D-068): one low-poly shape per body type, merged from a few primitives, one unit
// long along +x (head forward) and standing on y = 0; instances scale them to each species' size
// and turn them to face where they go. Birds fly above the canopy. A ring on the ground, in the
// owner's colour, marks every controllable animal (white when selected). Soil life and insects
// stay faint dots (D-065).

import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import * as THREE from "three/webgpu";
import type { Role } from "../replay/replay";

export type Body = "rodent" | "hedgehog" | "rabbit" | "canid" | "cat" | "bird";
export const BODIES: Body[] = ["rodent", "hedgehog", "rabbit", "canid", "cat", "bird"];

/** Body type, real length (m, nose to tail base) and natural colour of a species. */
export interface AnimalForm {
  body: Body;
  length: number;
  color: string;
}

export const ANIMAL_FORM: Record<string, AnimalForm> = {
  voles: { body: "rodent", length: 0.12, color: "#7a5b3e" },
  moles: { body: "rodent", length: 0.15, color: "#3e3a37" },
  hedgehog: { body: "hedgehog", length: 0.25, color: "#6e5b45" },
  rabbits: { body: "rabbit", length: 0.4, color: "#8d7c68" },
  tits: { body: "bird", length: 0.12, color: "#d6c14a" },
  woodpecker: { body: "bird", length: 0.25, color: "#3a3431" },
  buzzard: { body: "bird", length: 0.55, color: "#6b4f36" },
  tawny_owl: { body: "bird", length: 0.4, color: "#8b6a49" },
  fox: { body: "canid", length: 0.7, color: "#c2612b" },
  lynx: { body: "cat", length: 1.0, color: "#b48b5c" },
};

export function formOf(name: string, role: Role): AnimalForm {
  return (
    ANIMAL_FORM[name] ??
    (role === "predator"
      ? { body: "canid", length: 0.6, color: "#8a6a4a" }
      : { body: "rodent", length: 0.2, color: "#7a5b3e" })
  );
}

/** Models are drawn this many times their real size, so a vole still shows next to a 3 m crown
 *  (the proportions between animals stay true). */
export const ANIMAL_SCALE = 2.5;
/** Birds fly this high (m): above the canopy (trunks up to 2.6 m, then the crown). */
export const FLIGHT_Y = 5.5;
/** Ground ring radius (m): max(min, k x drawn length); width as a share of the radius. */
export const RING = { min: 0.45, k: 0.75, width: 0.18 } as const;

export function ringRadius(form: AnimalForm): number {
  return Math.max(RING.min, RING.k * form.length * ANIMAL_SCALE);
}

/** The model of a body type: unit length along +x, feet (or, for birds, the body centre) at 0. */
export function bodyGeometry(body: Body): THREE.BufferGeometry {
  const blob = (sx: number, sy: number, sz: number, x: number, y: number, z = 0) =>
    new THREE.IcosahedronGeometry(0.5, 1).scale(sx, sy, sz).translate(x, y, z);
  const ear = (x: number, y: number, z: number, r: number, h: number) =>
    new THREE.ConeGeometry(r, h, 4).translate(x, y, z);
  const legs = (h: number, dx: number, dz: number) =>
    [-dx, dx].flatMap((x) =>
      [-dz, dz].map((z) => new THREE.BoxGeometry(0.06, h, 0.06).translate(x, h / 2, z)),
    );
  const parts: THREE.BufferGeometry[] = (() => {
    switch (body) {
      case "rodent": // round body, small head, tucked feet
        return [blob(0.8, 0.45, 0.5, -0.05, 0.22), blob(0.36, 0.32, 0.32, 0.38, 0.22)];
      case "hedgehog": // a spiny dome and a pointed snout
        return [
          blob(0.9, 0.55, 0.75, -0.05, 0.27),
          new THREE.ConeGeometry(0.1, 0.3, 4).rotateZ(-Math.PI / 2).translate(0.5, 0.14, 0),
        ];
      case "rabbit": // haunches, head, two long ears
        return [
          blob(0.8, 0.55, 0.5, -0.08, 0.28),
          blob(0.34, 0.32, 0.3, 0.34, 0.48),
          ear(0.32, 0.8, 0.06, 0.045, 0.34),
          ear(0.32, 0.8, -0.06, 0.045, 0.34),
        ];
      case "canid": // long body on legs, pointed ears, a long brush of a tail
        return [
          blob(0.7, 0.3, 0.26, 0, 0.5),
          blob(0.3, 0.22, 0.22, 0.42, 0.62),
          new THREE.ConeGeometry(0.07, 0.2, 4).rotateZ(-Math.PI / 2).translate(0.62, 0.58, 0),
          ear(0.42, 0.78, 0.06, 0.04, 0.12),
          ear(0.42, 0.78, -0.06, 0.04, 0.12),
          blob(0.4, 0.14, 0.14, -0.5, 0.45),
          ...legs(0.38, 0.24, 0.08),
        ];
      case "cat": // heavier body, round head, tufted ears, short tail
        return [
          blob(0.72, 0.34, 0.3, 0, 0.52),
          blob(0.3, 0.26, 0.26, 0.42, 0.66),
          ear(0.4, 0.84, 0.07, 0.04, 0.14),
          ear(0.4, 0.84, -0.07, 0.04, 0.14),
          blob(0.2, 0.1, 0.1, -0.44, 0.55),
          ...legs(0.4, 0.24, 0.1),
        ];
      case "bird": // body, head, spread wings, tail
        return [
          blob(0.75, 0.32, 0.32, 0, 0),
          blob(0.3, 0.28, 0.28, 0.38, 0.06),
          new THREE.BoxGeometry(0.34, 0.03, 1.7).translate(-0.02, 0.04, 0),
          new THREE.BoxGeometry(0.3, 0.02, 0.2).translate(-0.45, 0, 0),
        ];
    }
  })();
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}
