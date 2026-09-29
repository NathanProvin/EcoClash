import { describe, expect, it } from "vitest";
import { ANIMAL_FORM, BODIES, bodyGeometry, formOf, RING, ringRadius } from "./animals";

describe("bodyGeometry", () => {
  it("builds every body about one unit long, standing on the ground, head toward +x", () => {
    for (const body of BODIES) {
      const g = bodyGeometry(body);
      g.computeBoundingBox();
      const box = g.boundingBox;
      expect(box, body).not.toBeNull();
      if (!box) continue;
      const length = box.max.x - box.min.x;
      expect(length, body).toBeGreaterThan(0.8);
      expect(length, body).toBeLessThan(1.5);
      expect(box.max.x, `${body}: the head is forward`).toBeGreaterThan(-box.min.x - 0.2);
      if (body === "bird") expect(box.max.z - box.min.z, "wingspan").toBeGreaterThan(length);
      else expect(box.min.y, `${body}: on the ground`).toBeGreaterThanOrEqual(-0.01);
    }
  });
});

describe("forms", () => {
  it("keeps real proportions and gives every animal a ring it can be picked by", () => {
    const len = (n: string) => ANIMAL_FORM[n]?.length ?? 0;
    expect(len("voles")).toBeLessThan(len("rabbits"));
    expect(len("rabbits")).toBeLessThan(len("fox"));
    expect(len("fox")).toBeLessThan(len("lynx"));
    expect(ringRadius(formOf("voles", "herbivore"))).toBe(RING.min);
    expect(ringRadius(formOf("lynx", "predator"))).toBeGreaterThan(RING.min);
    expect(formOf("unknown", "predator").body).toBe("canid");
  });
});
