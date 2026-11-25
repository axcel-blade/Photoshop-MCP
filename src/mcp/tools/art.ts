import { z } from "zod";
import { getStyle, STYLES } from "../../workflow-engine/index.js";
import { unsupported } from "../../shared.js";
import { Sequence, tool, WRITE, type ToolContext, type ToolOutput } from "./registry.js";
import { doc, layer } from "./args.js";

const M = "digital_art";
const idOf = (o: ToolOutput) => (o.data as { layer: { id: number } }).layer.id;

/** Painting canvas with an organised, named layer structure and palette swatches (the painting itself is the artist's or a provider's). */
async function paintingCanvas(ctx: ToolContext, a: { width: number; height: number; title: string; style: string; groups: string[]; generatePrompt?: string }): Promise<ToolOutput> {
  const style = getStyle(a.style) ?? STYLES[0]!;
  const seq = new Sequence(ctx);
  await seq.run("canvas", "doc.create", { name: a.title, width: a.width, height: a.height, resolution: 300, background: "white" });
  await seq.run("base tone", "fill.solid", { color: style.palette.backgroundAlt, name: "Canvas Tone" });
  for (const g of a.groups) await seq.run(`group ${g}`, "layer.create", { kind: "group", name: g });
  const sw = Math.round(Math.min(a.width, a.height) * 0.05);
  const pal = Object.entries(style.palette);
  const swGroup = await seq.run("palette group", "layer.create", { kind: "group", name: "Palette (hide before export)" });
  for (const [i, [k, c]] of pal.entries()) {
    await seq.run(`swatch ${k}`, "shape.rect", { bounds: { left: sw * 0.5 + i * sw * 1.2, top: sw * 0.5, right: sw * 1.5 + i * sw * 1.2, bottom: sw * 1.5 }, fill: c, name: `Swatch ${k} ${c}`, parent: { id: idOf(swGroup) } });
  }
  const warnings = ["Canvas, layer structure and palette are set up; brush painting is not scriptable via ExtendScript. Paint in Photoshop, or call generate_image (Firefly) and place the result as a reference layer."];
  if (a.generatePrompt) {
    const gen = ctx.providers.find("generate_image");
    if (!gen) warnings.push("No image provider configured, so no reference was generated (set FIREFLY_CLIENT_ID/SECRET).");
  }
  return seq.result({ palette: style.palette, groups: a.groups }, warnings);
}

export function registerArtTools(): void {
  const canvas = { width: z.number().int().min(256).max(20000).default(3000), height: z.number().int().min(256).max(20000).default(2000), title: z.string().max(120).optional(), style: z.enum(STYLES.map((s) => s.id) as [string, ...string[]]).default("cinematic"), subject: z.string().max(500).optional() };
  const canvasTool = (nm: string, desc: string, groups: string[]) =>
    tool({
      name: nm, module: M, description: `${desc} Creates a 300ppi canvas with named layer groups and a palette.`, annotations: WRITE, status: "partial",
      limitations: "Sets up the document; brushwork must be done by the artist or by an external image provider.", commands: ["doc.create", "layer.create", "shape.rect"],
      input: canvas,
      handler: (a, ctx) => paintingCanvas(ctx, { width: a.width, height: a.height, title: a.title ?? nm.replace("create_", "").replace(/_/g, " "), style: a.style, groups, generatePrompt: a.subject }),
    });
  canvasTool("create_digital_painting", "Digital painting setup.", ["FX & Atmosphere", "Details", "Lighting", "Shading", "Base Colors", "Sketch"]);
  canvasTool("create_illustration", "Illustration setup.", ["Highlights", "Line Art", "Shading", "Flats", "Background"]);
  canvasTool("create_character_art", "Character art setup.", ["Rim Light", "Details", "Shading", "Flats", "Line Art", "Pose Sketch", "Background"]);
  canvasTool("create_concept_art", "Concept art setup.", ["Overpaint", "Photo Bash", "Lighting", "Values", "Thumbnails"]);
  canvasTool("create_matte_painting", "Matte painting setup (wide plate).", ["Atmosphere", "Foreground", "Midground", "Background", "Sky", "Plate References"]);

  tool({
    name: "create_sketch", module: M, description: "Pencil-sketch effect: desaturated copy + inverted copy in Color Dodge with Gaussian Blur (classic recipe, editable smart filter).", annotations: WRITE,
    commands: ["layer.duplicate", "filter.apply", "layer.props", "layer.group"], input: { doc, layer, detail: z.number().min(1).max(100).default(8).describe("Blur radius: higher = bolder lines") },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const base = await seq.run("gray copy", "layer.duplicate", { doc: a.doc, layer: a.layer, name: "Sketch Base" });
      const bid = idOf(base);
      await seq.run("rasterize base", "layer.rasterize", { doc: a.doc, layer: { id: bid } });
      await seq.run("desaturate", "filter.apply", { doc: a.doc, layer: { id: bid }, kind: "desaturate", settings: {}, smart: false });
      const top = await seq.run("dodge copy", "layer.duplicate", { doc: a.doc, layer: { id: bid }, name: "Sketch Dodge" });
      const tid = idOf(top);
      await seq.run("invert", "filter.apply", { doc: a.doc, layer: { id: tid }, kind: "invert", settings: {}, smart: false });
      await seq.run("color dodge", "layer.props", { doc: a.doc, layer: { id: tid }, blendMode: "colorDodge" });
      await seq.run("blur", "filter.apply", { doc: a.doc, layer: { id: tid }, kind: "gaussianBlur", settings: { radius: a.detail }, smart: true });
      await seq.run("group", "layer.group", { doc: a.doc, layers: [{ id: tid }, { id: bid }], name: "Pencil Sketch" });
      return seq.result({ baseLayerId: bid, dodgeLayerId: tid });
    },
  });
  tool({
    name: "create_line_art", module: M, description: "Line art: Find Edges on a desaturated copy, then a Threshold adjustment clipped to it.", annotations: WRITE, commands: ["layer.duplicate", "filter.apply", "adjust.layer"],
    input: { doc, layer, threshold: z.number().int().min(1).max(255).default(200) },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const c = await seq.run("copy", "layer.duplicate", { doc: a.doc, layer: a.layer, name: "Line Art" });
      const id = idOf(c);
      await seq.run("rasterize", "layer.rasterize", { doc: a.doc, layer: { id } });
      await seq.run("desaturate", "filter.apply", { doc: a.doc, layer: { id }, kind: "desaturate", settings: {}, smart: false });
      await seq.run("find edges", "filter.apply", { doc: a.doc, layer: { id }, kind: "findEdges", settings: {}, smart: false });
      await seq.run("threshold", "adjust.layer", { doc: a.doc, layer: { id }, kind: "threshold", settings: { level: a.threshold }, clip: true, name: "Line Threshold" });
      return seq.result({ layerId: id });
    },
  });
  tool({
    name: "apply_painting_effect", module: M, description: "Painterly look on a smart copy: oil (Oil Paint filter), watercolor (median + surface blur + texture) or poster (median + posterize).", annotations: WRITE, commands: ["layer.duplicate", "layer.smartObject", "filter.apply", "adjust.layer"],
    input: { doc, layer, style: z.enum(["oil", "watercolor", "poster"]).default("oil"), strength: z.number().min(0).max(100).default(60) },
    handler: async (a, ctx) => {
      const seq = new Sequence(ctx);
      const c = await seq.run("copy", "layer.duplicate", { doc: a.doc, layer: a.layer, name: `Painting (${a.style})` });
      let id = idOf(c);
      id = ((await seq.run("smart object", "layer.smartObject", { doc: a.doc, layer: { id } })).data as { layer: { id: number } }).layer.id; // conversion creates a new layer id
      const s = a.strength / 100;
      if (a.style === "oil") await seq.run("oil paint", "filter.apply", { doc: a.doc, layer: { id }, kind: "oilPaint", settings: { stylization: 1 + s * 8, cleanliness: 3 + s * 6, scale: 1, bristleDetail: 3, lighting: true }, smart: true });
      if (a.style === "watercolor") {
        await seq.run("median", "filter.apply", { doc: a.doc, layer: { id }, kind: "median", settings: { radius: Math.max(2, Math.round(s * 8)) }, smart: true });
        await seq.run("surface blur", "filter.apply", { doc: a.doc, layer: { id }, kind: "surfaceBlur", settings: { radius: Math.max(3, Math.round(s * 12)), threshold: 25 }, smart: true });
        await seq.run("paper texture", "filter.apply", { doc: a.doc, layer: { id }, kind: "texturizer", settings: { texture: "canvas", scaling: 100, relief: 3, light: "top" }, smart: true });
      }
      if (a.style === "poster") {
        await seq.run("median", "filter.apply", { doc: a.doc, layer: { id }, kind: "median", settings: { radius: Math.max(1, Math.round(s * 5)) }, smart: true });
        await seq.run("posterize", "adjust.layer", { doc: a.doc, layer: { id }, kind: "posterize", settings: { levels: Math.max(3, Math.round(10 - s * 6)) }, clip: true, name: "Poster Levels" });
      }
      return seq.result({ layerId: id, style: a.style });
    },
  });
  tool({
    name: "create_custom_brush", module: M, description: "Define a brush preset from the selection.", annotations: WRITE, commands: [], status: "unsupported",
    limitations: "Edit > Define Brush Preset is not in the documented scripting DOM; brush presets cannot be created or listed programmatically.",
    input: { name: z.string().max(100) }, handler: async () => { throw unsupported("Define Brush Preset", "no documented scripting API for brush presets", "Select the shape and use Edit > Define Brush Preset in Photoshop; record it as an action to automate with run_action."); },
  });
  tool({
    name: "manage_brush_presets", module: M, description: "List / delete / rename brush presets.", annotations: WRITE, commands: [], status: "unsupported",
    limitations: "The Brushes panel is not exposed to scripting.",
    input: { action: z.enum(["list", "delete", "rename"]).default("list") }, handler: async () => { throw unsupported("Brush preset management", "the Brushes panel is not exposed to scripting", "Manage brushes in the Brushes panel (Window > Brushes)."); },
  });
}
