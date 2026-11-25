/**
 * Every operation photoshop-scripts/*.jsx implements (MCP.ops). The bridge refuses anything else before Photoshop is
 * contacted, and the JSX dispatcher refuses again: there is deliberately no "run arbitrary JSX / Action Manager" op.
 */
export const BRIDGE_OPS = [
  // application / inspection
  "ps.info", "ps.history", "ps.undo", "ps.redo", "ps.activeTool", "ps.preview", "ps.analyze",
  // documents
  "doc.create", "doc.open", "doc.close", "doc.save", "doc.saveAs", "doc.info", "doc.list", "doc.activate",
  "doc.resizeImage", "doc.resizeCanvas", "doc.mode", "doc.bitDepth", "doc.flatten", "doc.duplicate",
  "doc.crop", "doc.rotate", "doc.flip", "doc.trim", "doc.colors",
  // layers
  "layer.list", "layer.info", "layer.create", "layer.delete", "layer.duplicate", "layer.rename",
  "layer.translate", "layer.arrange", "layer.merge", "layer.mergeVisible", "layer.group", "layer.ungroup",
  "layer.props", "layer.link", "layer.rasterize", "layer.smartObject", "layer.select", "layer.transform",
  "layer.effects", "layer.clearEffects", "layer.fill", "layer.clip", "layer.replaceContents", "layer.fromSelection",
  // text
  "text.create", "text.edit", "text.toShape",
  // shapes / fills
  "shape.rect", "shape.ellipse", "shape.polygon", "shape.edit", "fill.solid", "fill.gradient",
  // images
  "image.place",
  // selection
  "select.all", "select.none", "select.invert", "select.rect", "select.ellipse", "select.polygon",
  "select.subject", "select.sky", "select.colorRange", "select.modify", "select.info", "select.layerPixels",
  // masks
  "mask.create", "mask.vector", "mask.delete", "mask.invert", "mask.apply", "mask.refine", "mask.gradient",
  // adjustments / filters / edits
  "adjust.layer", "filter.apply", "edit.contentAwareFill", "edit.fillSelection",
  // actions
  "action.list", "action.run",
  // design plans (photoshop-scripts/design.jsx)
  "execute_plan", "update_elements", "check_fonts",
] as const;

export type BridgeOp = (typeof BRIDGE_OPS)[number];

export const ADJUSTMENT_KINDS = [
  "brightnessContrast", "exposure", "hueSaturation", "vibrance", "levels", "curves", "colorBalance",
  "selectiveColor", "blackAndWhite", "gradientMap", "photoFilter", "invert", "posterize", "threshold", "channelMixer",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const FILTER_KINDS = [
  "gaussianBlur", "motionBlur", "radialBlur", "surfaceBlur", "smartSharpen", "unsharpMask", "highPass",
  "addNoise", "median", "dustAndScratches", "emboss", "texturizer", "twirl", "pinch", "spherize", "ripple",
  "findEdges", "desaturate", "invert", "oilPaint",
] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];

export const BLEND_MODES = [
  "normal", "dissolve", "darken", "multiply", "colorBurn", "linearBurn", "darkerColor", "lighten", "screen",
  "colorDodge", "linearDodge", "lighterColor", "overlay", "softLight", "hardLight", "vividLight", "linearLight",
  "pinLight", "hardMix", "difference", "exclusion", "subtract", "divide", "hue", "saturation", "color", "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const COLOR_RANGE_PRESETS = [
  "reds", "yellows", "greens", "cyans", "blues", "magentas", "highlights", "midtones", "shadows", "skinTone",
] as const;

export const SAVE_FORMATS = ["psd", "psb", "png", "jpg", "tiff", "pdf", "webp", "gif", "bmp"] as const;
export type SaveFormat = (typeof SAVE_FORMATS)[number];
