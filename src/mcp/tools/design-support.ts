import type { InspectedItem } from "../../design-engine/composition/analyzer.js";
import type { DesignPlan } from "../../schemas/design-plan.js";
import { cmd, type ToolContext } from "./registry.js";

export { IMAGE_INPUT_EXTENSIONS as IMAGE_EXTENSIONS } from "../../utils/paths.js";

/** Plan resolution: an explicit export ppi, else 72 for screen units and 150 for print units. */
export function planResolution(plan: DesignPlan): number {
  if (plan.export?.ppi) return plan.export.ppi;
  return plan.document.units === "px" || plan.document.units === "pt" ? 72 : 150;
}

export interface Inspection {
  name: string;
  artboards: { width: number; height: number; active: boolean }[];
  items: (InspectedItem & { uuid?: string })[];
}

/** Document + layers in the shape the composition analyzer and plan verification expect (pixels). */
export async function inspectForDesign(ctx: ToolContext): Promise<Inspection> {
  const info = (await cmd(ctx, "doc.info")).data as { document: { name: string; width: number; height: number } };
  const layers = (await cmd(ctx, "layer.list")).data as {
    layers: { name: string; kind: string; visible: boolean; locked: boolean; parentId?: number; id: number; bounds: { left: number; top: number; width: number; height: number }; fill?: string; text?: { contents: string; size: number; font: string; color?: string } }[];
  };
  const groups = new Map(layers.layers.filter((l) => l.kind === "group").map((l) => [l.id, l.name]));
  const items: Inspection["items"] = layers.layers
    .filter((l) => l.kind !== "group" && l.kind !== "adjustment")
    .map((l) => ({
      uuid: String(l.id),
      name: l.name,
      type: l.kind === "text" ? "TextFrame" : l.kind === "smartObject" ? "PlacedItem" : l.kind === "pixel" || l.kind === "background" ? "RasterItem" : "PathItem",
      layer: l.parentId !== undefined ? groups.get(l.parentId) : undefined,
      bounds: { x: l.bounds.left, y: l.bounds.top, width: l.bounds.width, height: l.bounds.height },
      fill: l.kind === "text" ? (l.text?.color ? { hex: l.text.color } : null) : l.fill ? { hex: l.fill } : null,
      contents: l.text?.contents,
      fontSize: l.text?.size,
      font: l.text?.font ?? null,
      hidden: !l.visible,
      locked: l.locked,
    }));
  return { name: info.document.name, artboards: [{ width: info.document.width, height: info.document.height, active: true }], items };
}

/** Render a JPEG preview of the active document (attached as an MCP image by the caller). */
export async function exportPreview(ctx: ToolContext, _opts: { artboard?: number } = {}): Promise<{ path?: string; base64?: string; warnings: string[] }> {
  const out = await cmd(ctx, "ps.preview", { maxSize: 1024 });
  const r = out.data as { base64?: string };
  return { base64: r.base64, warnings: out.warnings ?? [] };
}
