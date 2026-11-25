import { z } from "zod";

export const UnitSchema = z.enum(["pt", "px", "mm", "cm", "in", "pc"]);
export type Unit = z.infer<typeof UnitSchema>;

/** Points per unit (PostScript point = 1/72 inch). Design plans are authored in points; Photoshop documents are in pixels (px = pt * resolution / 72, see docs/COORDINATES.md). */
const PT_PER_UNIT: Record<Unit, number> = {
  pt: 1,
  px: 1,
  mm: 72 / 25.4,
  cm: 72 / 2.54,
  in: 72,
  pc: 12,
};

export function toPoints(value: number, unit: Unit): number {
  return value * PT_PER_UNIT[unit];
}

export function fromPoints(value: number, unit: Unit): number {
  return value / PT_PER_UNIT[unit];
}

export function convert(value: number, from: Unit, to: Unit): number {
  return fromPoints(toPoints(value, from), to);
}

export function round(value: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/**
 * Coordinate convention (used by every tool and the design schema):
 *   origin = top-left corner of the target artboard, x grows right, y grows DOWN.
 * Photoshop scripting uses the same top-left, y-down convention in pixels, so no axis flip is needed.
 */

export const PAPER_SIZES_MM: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  Letter: [215.9, 279.4],
  Tabloid: [279.4, 431.8],
  BusinessCardUS: [88.9, 50.8],
  BusinessCardEU: [85, 55],
};
