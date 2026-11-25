import { readableOn } from "../shared.js";
import type { WorkflowStep } from "../schemas/index.js";
import { applyCase, type DesignStyle } from "./styles.js";

export type LayoutKind =
  | "poster" | "flyer" | "banner" | "social" | "thumbnail" | "advertisement" | "product_ad" | "magazine_cover"
  | "album_cover" | "typography" | "ecommerce";

export interface LayoutSpec {
  kind: LayoutKind;
  width: number;
  height: number;
  resolution?: number;
  style: DesignStyle;
  headline?: string;
  subhead?: string;
  body?: string;
  cta?: string;
  imagePath?: string;
  removeBackground?: boolean;
  reflection?: boolean;
  shadow?: boolean;
  glow?: boolean;
  lightingColor?: string;
  colors?: string[];
  documentName?: string;
  /** Reuse the active document instead of creating one. */
  useActiveDocument?: boolean;
}

const r = (v: number) => Math.round(v);

/**
 * Compile a layout into ordered, structured tool calls. Everything is a named, editable layer:
 * gradient/solid fill layers, vector shape layers, live text layers and a smart-object image.
 */
export function compileLayout(spec: LayoutSpec): WorkflowStep[] {
  const { width: W, height: H, style } = spec;
  const pal = { ...style.palette };
  if (spec.colors?.[0]) pal.primary = spec.colors[0];
  if (spec.colors?.[1]) pal.accent = spec.colors[1];
  const min = Math.min(W, H);
  const landscape = W / H > 1.4;
  const steps: WorkflowStep[] = [];
  const add = (tool: string, args: Record<string, unknown>, description: string, id?: string) =>
    steps.push({ tool, args, description, continueOnError: false, ...(id ? { id } : {}) });

  if (!spec.useActiveDocument) {
    add("create_document", { name: spec.documentName ?? `${spec.kind}-${Date.now()}`, width: W, height: H, resolution: spec.resolution ?? 72, background: "white", mode: "rgb" }, `Create ${W}x${H} canvas`, "doc");
  }
  add("create_gradient", {
    name: "Background",
    gradient: { type: spec.kind === "product_ad" || style.id === "luxury" ? "radial" : "linear", angle: 90, stops: [{ color: pal.backgroundAlt, location: 0 }, { color: pal.background, location: 100 }] },
  }, "Background gradient fill layer", "bg");

  if (spec.kind === "ecommerce") {
    steps.pop();
    add("create_white_background", {}, "Pure white background layer", "bg");
  }

  // Decorative structure differs per kind
  if (spec.kind === "thumbnail" || spec.kind === "banner" || landscape) {
    add("create_rectangle", { name: "Accent Bar", bounds: { left: 0, top: r(H * 0.82), right: W, bottom: H }, fill: pal.primary }, "Accent bar");
  } else if (spec.kind === "magazine_cover") {
    add("create_rectangle", { name: "Masthead Band", bounds: { left: 0, top: 0, right: W, bottom: r(H * 0.16) }, fill: pal.primary, opacity: 90 }, "Masthead band");
  } else if (spec.kind !== "ecommerce" && spec.kind !== "typography") {
    add("create_ellipse", { name: "Light Orb", bounds: { left: r(W * 0.15), top: r(H * 0.12), right: r(W * 0.85), bottom: r(H * 0.12 + W * 0.7) }, fill: spec.lightingColor ?? pal.primary, opacity: 22 }, "Soft light orb");
    add("apply_gaussian_blur", { layer: { name: "Light Orb" }, radius: r(min * 0.08), smart: true }, "Blur the orb into a glow");
  }

  // Hero image
  if (spec.imagePath) {
    const box = landscape
      ? { x: r(W * 0.55), y: r(H * 0.08), width: r(W * 0.4), height: r(H * 0.74) }
      : { x: r(W * 0.15), y: r(H * 0.2), width: r(W * 0.7), height: r(H * 0.5) };
    add("place_image", { path: spec.imagePath, name: "Hero Image", ...box, fit: "contain" }, "Place hero image as smart object", "hero");
    if (spec.removeBackground) add("remove_background", { layer: { name: "Hero Image" } }, "Mask out the original background (Select Subject + layer mask)");
    if (spec.reflection) add("create_reflection", { layer: { name: "Hero Image" }, opacity: 30 }, "Mirror reflection below the product");
    if (spec.shadow) add("create_realistic_shadow", { layer: { name: "Hero Image" } }, "Contact shadow");
    if (spec.glow) add("apply_glow", { layer: { name: "Hero Image" }, color: spec.lightingColor ?? pal.primary, size: r(min * 0.04), opacity: 45 }, "Rim glow");
  }

  // Typography
  const headSize = r(min * (spec.kind === "thumbnail" ? 0.14 : spec.kind === "typography" ? 0.16 : landscape ? 0.1 : 0.085));
  const textColor = spec.kind === "ecommerce" ? "#111111" : pal.text;
  const headY = spec.imagePath ? (landscape ? r(H * 0.42) : r(H * 0.12)) : r(H * 0.45);
  const headX = spec.imagePath && landscape ? r(W * 0.06) : r(W / 2);
  const align = spec.imagePath && landscape ? "left" : "center";
  if (spec.headline) {
    add("add_text", { name: "Headline", text: applyCase(spec.headline, style.headlineCase), x: headX, y: headY, font: style.fonts.headline, size: headSize, color: spec.kind === "magazine_cover" ? readableOn(pal.primary) : textColor, alignment: align, tracking: style.id === "luxury" ? 200 : 0 }, "Headline", "headline");
    if (style.effects.shadow) add("apply_shadow", { layer: { name: "Headline" }, color: "#000000", opacity: 55, distance: r(headSize * 0.06), size: r(headSize * 0.12), angle: 120 }, "Headline drop shadow");
    if (style.id === "luxury") add("create_gradient_text", { layer: { name: "Headline" }, gradient: { type: "linear", angle: 90, stops: [{ color: "#B8860B", location: 0 }, { color: "#F7E7A1", location: 50 }, { color: "#B8860B", location: 100 }] } }, "Gold gradient on headline");
  }
  if (spec.subhead) {
    add("add_text", { name: "Subhead", text: spec.subhead, x: headX, y: headY + r(headSize * 1.1), font: style.fonts.body, size: r(headSize * 0.38), color: pal.muted === pal.background ? textColor : textColor, alignment: align, tracking: 50 }, "Subheading");
  }
  if (spec.body) {
    add("add_text", { name: "Body", text: spec.body, x: headX, y: headY + r(headSize * 1.8), font: style.fonts.body, size: r(headSize * 0.26), color: textColor, alignment: align }, "Body copy");
  }
  if (spec.cta) {
    const bw = r(Math.max(min * 0.32, spec.cta.length * headSize * 0.22));
    const bh = r(headSize * 0.55);
    const cx = align === "center" ? r(W / 2) : headX + r(bw / 2);
    const top = r(H * (landscape ? 0.66 : 0.84) - bh / 2);
    add("create_rectangle", { name: "CTA Button", bounds: { left: cx - r(bw / 2), top, right: cx + r(bw / 2), bottom: top + bh }, fill: pal.primary, radius: r(bh / 2) }, "CTA button");
    add("add_text", { name: "CTA Label", text: spec.cta.toUpperCase(), x: cx, y: top + r(bh * 0.66), font: style.fonts.body, size: r(bh * 0.42), color: readableOn(pal.primary), alignment: "center", tracking: 100 }, "CTA label");
  }
  if (style.effects.grain && spec.kind !== "ecommerce") {
    add("create_layer", { name: "Grain", fill: "#808080", blendMode: "overlay" }, "Neutral grain layer");
    add("apply_noise", { layer: { name: "Grain" }, amount: 6, monochromatic: true }, "Film grain");
  }
  return steps;
}
