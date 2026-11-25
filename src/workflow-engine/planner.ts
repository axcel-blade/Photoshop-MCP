import type { WorkflowStep } from "../schemas/index.js";
import { parseBrief, type ParsedBrief } from "./brief.js";
import { compileLayout, type LayoutKind } from "./layouts.js";
import { getPreset } from "./presets.js";

export interface PlanContext {
  /** Whether Photoshop currently has an open document (from inspect). */
  hasActiveDocument: boolean;
  /** Relative output folder inside the allowed roots, e.g. "designs". */
  outputFolder?: string;
  /** Input image path(s) supplied explicitly by the caller. */
  assets?: string[];
}

export interface WorkflowPlan {
  name: string;
  brief: ParsedBrief;
  summary: string;
  assumptions: string[];
  missingInputs: string[];
  steps: WorkflowStep[];
}

const LAYOUT_FOR: Partial<Record<ParsedBrief["intent"], LayoutKind>> = {
  product_ad: "product_ad", advertisement: "advertisement", social_media: "social", poster: "poster", flyer: "flyer",
  thumbnail: "thumbnail", banner: "banner", ecommerce: "ecommerce", magazine_cover: "magazine_cover",
  album_cover: "album_cover", marketing: "social", typography: "typography",
};

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";
}

/** Turn a natural-language brief into an ordered, verifiable list of tool calls. */
export function planFromBrief(text: string, ctx: PlanContext): WorkflowPlan {
  const brief = parseBrief(text, getPreset);
  const assets = [...(ctx.assets ?? []), ...brief.assets];
  const missing: string[] = [];
  const assumptions = [...brief.assumptions];
  const steps: WorkflowStep[] = [];
  const name = slug(brief.texts.headline ?? `${brief.intent}-${brief.style.id}`);
  const folder = ctx.outputFolder ?? "designs";
  const add = (tool: string, args: Record<string, unknown>, description: string, id?: string) =>
    steps.push({ tool, args, description, continueOnError: false, ...(id ? { id } : {}) });

  steps.push({ id: "inspect", tool: "inspect_document", args: {}, description: "Inspect Photoshop state before editing (may fail when no document is open)", continueOnError: true });

  const photoIntents = ["portrait_retouch", "photo_restoration", "background_replacement", "photo_manipulation"];
  if (photoIntents.includes(brief.intent)) {
    // Photo-editing workflows operate on the active document (or open the supplied asset).
    if (assets[0]) add("open_document", { path: assets[0] }, "Open the source photo", "open");
    else if (!ctx.hasActiveDocument) missing.push("A source photo: open it in Photoshop or pass its path in assets.");
    if (brief.intent === "portrait_retouch" || brief.wants.retouch) add("enhance_portrait", {}, "Non-destructive portrait enhancement stack");
    if (brief.intent === "photo_restoration" || brief.wants.restore) add("restore_photo", {}, "Dust & scratches, noise reduction, tonal correction");
    if (brief.intent === "background_replacement") {
      add("replace_background", { color: brief.colors[0] ?? brief.style.palette.background }, "Mask subject and add a new background layer");
    }
    if (brief.intent === "photo_manipulation") add("create_cinematic_scene", {}, "Cinematic grade, vignette and atmosphere");
  } else if (brief.intent === "digital_art") {
    add("create_digital_painting", { width: brief.size.width, height: brief.size.height, subject: brief.raw.slice(0, 200) }, "Painting canvas with organised layer structure");
  } else {
    const kind = LAYOUT_FOR[brief.intent] ?? "social";
    if (!brief.texts.headline) assumptions.push('No headline found; put the copy in quotes, e.g. "Summer Sale".');
    if ((kind === "product_ad" || kind === "ecommerce") && !assets[0]) missing.push("A product photo path (assets) to place in the design.");
    steps.push(...compileLayout({
      kind, width: brief.size.width, height: brief.size.height, resolution: brief.size.resolution, style: brief.style,
      headline: brief.texts.headline, subhead: brief.texts.subhead, cta: brief.texts.cta, imagePath: assets[0],
      removeBackground: brief.wants.removeBackground, reflection: brief.wants.reflection,
      shadow: brief.wants.shadow || kind === "product_ad", glow: brief.wants.glow, lightingColor: brief.wants.lighting,
      colors: brief.colors, documentName: name,
    }));
    if (brief.wants.surface) assumptions.push(`"${brief.wants.surface}" surface is approximated with gradient + noise; supply a texture photo in assets for realism.`);
  }

  if (brief.wants.cinematicGrade && brief.intent !== "photo_manipulation") add("apply_cinematic_color_grade", { style: "teal_orange", strength: 60 }, "Cinematic color grade (adjustment layers)");
  if (brief.wants.blackAndWhite) add("apply_black_and_white", {}, "Black & white adjustment layer");

  add("capture_preview", { maxSize: 768 }, "Capture a preview for visual review", "preview");
  add("validate_document", {}, "Validate layers, empty text and missing fonts", "validate");
  add("save_document_as", { path: `${folder}/${name}.psd`, format: "psd", overwrite: false }, "Save editable PSD", "psd");
  for (const o of brief.outputs) {
    if (o.format === "psd") continue;
    add("export_document", { path: `${folder}/${name}${o.width || o.height ? `-${o.width ?? o.height}` : ""}.${o.format}`, format: o.format, width: o.width, height: o.height, overwrite: false }, `Export ${o.format.toUpperCase()}${o.width ? ` at ${o.width}px wide` : ""}`);
  }

  const summary = `${brief.intent.replace(/_/g, " ")} in the "${brief.style.id}" style, ${brief.size.width}x${brief.size.height}px, ${steps.length} steps; outputs: ${brief.outputs.map((o) => o.format).join(", ")}.`;
  return { name, brief, summary, assumptions, missingInputs: missing, steps };
}
