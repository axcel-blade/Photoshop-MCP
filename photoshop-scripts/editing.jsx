/* Selections, masks, adjustment layers, filters, layer styles, fills. Action Manager descriptors in batchPlay JSON form. */

MCP.SEL = [{ _ref: "channel", _property: "selection" }];
MCP.MODE_EVENT = { "new": "set", add: "addTo", subtract: "subtractFrom", intersect: "interfaceIconFrameDimmed" };

MCP.selectShape = function (to, mode) {
  MCP.play({ _obj: MCP.MODE_EVENT[mode || "new"] || "set", _target: MCP.SEL, to: to }, "selection (" + (mode || "new") + ")");
};
MCP.selResult = function (d) { var b = MCP.selectionBounds(d); return b ? { hasSelection: true, bounds: b } : { hasSelection: false }; };
MCP.feather = function (amount) { if (amount) MCP.play({ _obj: "feather", radius: MCP.px(amount), selectionModifyEffectAtCanvasBounds: false }, "feather"); };
MCP.targetEnum = function (ref) { return [{ _ref: ref, _enum: "ordinal", _value: "targetEnum" }]; };
MCP.hasMask = function (l) { return Boolean(MCP.layerProp(l.id, "hasUserMask")); };

/* ---------- adjustment layers ---------- */
MCP.CH = { composite: "composite", red: "red", green: "grain", blue: "blue" };
MCP.chanRef = function (c) { return { _ref: "channel", _enum: "channel", _value: MCP.CH[c || "composite"] }; };
MCP.custom = { _enum: "presetKindType", _value: "presetKindCustom" };

MCP.adjustmentType = function (kind, s) {
  switch (kind) {
    case "brightnessContrast": return { _obj: "brightnessEvent", brightness: Math.round(s.brightness || 0), center: Math.round(s.contrast || 0), useLegacy: false };
    case "exposure": return { _obj: "exposure", presetKind: MCP.custom, exposure: s.exposure || 0, offset: s.offset || 0, gammaCorrection: MCP.def(s.gamma, 1) };
    case "hueSaturation": return { _obj: "hueSaturation", presetKind: MCP.custom, colorize: Boolean(s.colorize), adjustment: [{ _obj: "hueSatAdjustmentV2", hue: Math.round(s.hue || 0), saturation: Math.round(s.saturation || 0), lightness: Math.round(s.lightness || 0) }] };
    case "vibrance": return { _obj: "vibrance", vibrance: Math.round(s.vibrance || 0), saturation: Math.round(s.saturation || 0) };
    case "levels": return { _obj: "levels", presetKind: MCP.custom, adjustment: MCP.map(s.channels || [s], function (c) {
      return { _obj: "levelsAdjustment", channel: MCP.chanRef(c.channel), input: [Math.round(c.inputBlack || 0), Math.round(MCP.def(c.inputWhite, 255))], gamma: MCP.def(c.gamma, 1), output: [Math.round(c.outputBlack || 0), Math.round(MCP.def(c.outputWhite, 255))] };
    }) };
    case "curves": return { _obj: "curves", presetKind: MCP.custom, adjustment: [{ _obj: "curvesAdjustment", channel: MCP.chanRef(s.channel), curve: MCP.map(s.points, function (q) { return { _obj: "paint", horizontal: Math.round(q.input), vertical: Math.round(q.output) }; }) }] };
    case "colorBalance": {
      var r3 = function (a) { return MCP.map(a || [0, 0, 0], function (v) { return Math.round(v); }); };
      return { _obj: "colorBalance", shadowLevels: r3(s.shadows), midtoneLevels: r3(s.midtones), highlightLevels: r3(s.highlights), preserveLuminosity: s.preserveLuminosity !== false };
    }
    case "selectiveColor": return { _obj: "selectiveColor", presetKind: MCP.custom, colorCorrection: MCP.map(s.corrections, function (c) {
      return { _obj: "colorCorrection", colors: { _enum: "colors", _value: c.color }, cyan: MCP.pct(c.cyan || 0), magenta: MCP.pct(c.magenta || 0), yellowColor: MCP.pct(c.yellow || 0), black: MCP.pct(c.black || 0) };
    }), method: { _enum: "correctionMethod", _value: s.method || "relative" } };
    case "blackAndWhite": {
      var d = { _obj: "blackAndWhite", presetKind: MCP.custom, red: MCP.def(s.reds, 40), yellow: MCP.def(s.yellows, 60), grain: MCP.def(s.greens, 40), cyan: MCP.def(s.cyans, 60), blue: MCP.def(s.blues, 20), magenta: MCP.def(s.magentas, 80), useTint: Boolean(s.tint) };
      if (s.tint) d.tintColor = MCP.rgbDesc(s.tint);
      return d;
    }
    case "gradientMap": return { _obj: "gradientMapClass", gradient: MCP.gradientDesc(s.stops), reverse: false, dither: false };
    case "photoFilter": return { _obj: "photoFilter", color: MCP.labDesc(s.color || "#EC8A00"), density: Math.round(s.density || 25), preserveLuminosity: s.preserveLuminosity !== false };
    case "invert": return { _class: "invert" };
    case "posterize": return { _obj: "posterization", levels: Math.round(s.levels || 6) };
    case "threshold": return { _obj: "thresholdClassEvent", level: Math.round(s.level || 128) };
    case "channelMixer": return { _obj: "channelMixer", presetKind: MCP.custom, monochromatic: Boolean(s.monochrome) };
  }
  MCP.fail("VALIDATION_ERROR", "Unknown adjustment " + kind);
};

/* ---------- filters ---------- */
MCP.filterDesc = function (kind, s) {
  switch (kind) {
    case "gaussianBlur": return { _obj: "gaussianBlur", radius: MCP.px(s.radius) };
    case "motionBlur": return { _obj: "motionBlur", angle: Math.round(s.angle || 0), distance: MCP.px(Math.round(s.distance || 20)) };
    case "radialBlur": return { _obj: "radialBlur", amount: Math.round(s.amount || 10), blurMethod: { _enum: "blurMethod", _value: s.method || "zoom" }, blurQuality: { _enum: "blurQuality", _value: s.quality || "good" } };
    case "surfaceBlur": return { _obj: "surfaceBlur", radius: MCP.px(Math.round(s.radius || 5)), threshold: Math.round(s.threshold || 15) };
    case "smartSharpen": return { _obj: "smartSharpen", presetKind: MCP.custom, useLegacy: false, amount: MCP.pct(s.amount || 100), radius: MCP.px(s.radius || 1), noiseReduction: MCP.pct(s.noiseReduction || 0), blur: { _enum: "blurType", _value: "gaussianBlur" } };
    case "unsharpMask": return { _obj: "unsharpMask", amount: MCP.pct(s.amount || 80), radius: MCP.px(s.radius || 1.5), threshold: Math.round(s.threshold || 0) };
    case "highPass": return { _obj: "highPass", radius: MCP.px(s.radius || 3) };
    case "addNoise": return { _obj: "addNoise", distort: { _enum: "distort", _value: s.distribution === "uniform" ? "uniformDistribution" : "gaussianDistribution" }, noise: MCP.pct(s.amount || 5), monochromatic: s.monochromatic !== false };
    case "median": return { _obj: "median", radius: MCP.px(Math.round(s.radius || 2)) };
    case "dustAndScratches": return { _obj: "dustAndScratches", radius: Math.round(s.radius || 2), threshold: Math.round(s.threshold || 0) };
    case "emboss": return { _obj: "emboss", angle: Math.round(MCP.def(s.angle, 135)), height: Math.round(s.height || 3), amount: Math.round(s.amount || 100) };
    case "texturizer": {
      var tex = { brick: "textureBrick", burlap: "textureBurlap", canvas: "textureCanvas", sandstone: "textureSandstone" }[s.texture || "canvas"];
      var light = { top: "lightDirTop", topLeft: "lightDirTopLeft", left: "lightDirLeft", bottomLeft: "lightDirBottomLeft", bottom: "lightDirBottom", bottomRight: "lightDirBottomRight", right: "lightDirRight", topRight: "lightDirTopRight" }[s.light || "top"];
      return { _obj: "texturizer", textureType: { _enum: "textureType", _value: tex }, scaling: Math.round(s.scaling || 100), relief: Math.round(s.relief || 4), lightDirection: { _enum: "lightDirection", _value: light }, invertTexture: false };
    }
    case "twirl": return { _obj: "twirl", angle: Math.round(MCP.def(s.amount, 50)) };
    case "pinch": return { _obj: "pinch", amount: Math.round(Math.max(-100, Math.min(100, MCP.def(s.amount, 50)))) };
    case "spherize": return { _obj: "spherize", amount: Math.round(Math.max(-100, Math.min(100, MCP.def(s.amount, 50)))), spherizeMode: { _enum: "spherizeMode", _value: "normal" } };
    case "ripple": return { _obj: "ripple", amount: Math.round(MCP.def(s.amount, 100)), rippleSize: { _enum: "rippleSize", _value: "medium" } };
    case "findEdges": return { _obj: "findEdges" };
    case "desaturate": return { _obj: "desaturate" };
    case "invert": return { _obj: "invert" };
    case "oilPaint": return { _obj: "oilPaint", lightingOn: s.lighting !== false, stylization: MCP.def(s.stylization, 4), cleanliness: MCP.def(s.cleanliness, 5), brushScale: MCP.def(s.scale, 1), microBrush: MCP.def(s.bristleDetail, 3), LightDirection: -60, specularity: 1.3 };
  }
  MCP.fail("VALIDATION_ERROR", "Unknown filter " + kind);
};

/* ---------- layer styles ---------- */
MCP.shadowFx = function (o, name) {
  return { _obj: name, enabled: true, present: true, showInDialog: true, mode: MCP.blendEnum(o.blendMode || "multiply"), color: MCP.rgbDesc(o.color || "#000000"), opacity: MCP.pct(MCP.def(o.opacity, 60)), useGlobalAngle: false, localLightingAngle: MCP.deg(MCP.def(o.angle, 120)), distance: MCP.px(MCP.def(o.distance, 10)), chokeMatte: MCP.px(o.spread || 0), blur: MCP.px(MCP.def(o.size, 15)), noise: MCP.pct(0), antiAlias: false, transferSpec: { _obj: "shapeCurveType", name: "Linear" }, layerConceals: true };
};
MCP.glowFx = function (o, name) {
  return { _obj: name, enabled: true, present: true, showInDialog: true, mode: MCP.blendEnum(o.blendMode || "screen"), color: MCP.rgbDesc(o.color || "#FFE9A8"), opacity: MCP.pct(MCP.def(o.opacity, 60)), glowTechnique: { _enum: "matteTechnique", _value: "softMatte" }, chokeMatte: MCP.px(o.spread || 0), blur: MCP.px(MCP.def(o.size, 20)), noise: MCP.pct(0), shadingNoise: MCP.pct(0), antiAlias: false, transferSpec: { _obj: "shapeCurveType", name: "Linear" }, inputRange: MCP.pct(50) };
};
MCP.effectsDesc = function (e) {
  var out = {};
  if (e.dropShadow) out.dropShadow = MCP.shadowFx(e.dropShadow, "dropShadow");
  if (e.innerShadow) out.innerShadow = MCP.shadowFx(e.innerShadow, "innerShadow");
  if (e.outerGlow) out.outerGlow = MCP.glowFx(e.outerGlow, "outerGlow");
  if (e.innerGlow) { out.innerGlow = MCP.glowFx(e.innerGlow, "innerGlow"); out.innerGlow.innerGlowSource = { _enum: "innerGlowSourceType", _value: "edgeGlow" }; }
  if (e.stroke) {
    var st = { outside: "outsetFrame", inside: "insetFrame", center: "centeredFrame" }[e.stroke.position || "outside"];
    out.frameFX = { _obj: "frameFX", enabled: true, present: true, showInDialog: true, style: { _enum: "frameStyle", _value: st }, paintType: { _enum: "frameFill", _value: "solidColor" }, mode: MCP.blendEnum("normal"), opacity: MCP.pct(MCP.def(e.stroke.opacity, 100)), size: MCP.px(e.stroke.size || 3), color: MCP.rgbDesc(e.stroke.color || "#000000"), overprint: false };
  }
  if (e.bevel) {
    var b = e.bevel;
    out.bevelEmboss = { _obj: "bevelEmboss", enabled: true, present: true, showInDialog: true, highlightMode: MCP.blendEnum("screen"), highlightColor: MCP.rgbDesc("#FFFFFF"), highlightOpacity: MCP.pct(75), shadowMode: MCP.blendEnum("multiply"), shadowColor: MCP.rgbDesc("#000000"), shadowOpacity: MCP.pct(75), bevelTechnique: { _enum: "bevelTechnique", _value: "softMatte" }, bevelStyle: { _enum: "bevelEmbossStyle", _value: b.style || "innerBevel" }, useGlobalAngle: false, localLightingAngle: MCP.deg(MCP.def(b.angle, 120)), localLightingAltitude: MCP.deg(MCP.def(b.altitude, 30)), strengthRatio: MCP.pct(b.depth || 100), blur: MCP.px(MCP.def(b.size, 5)), bevelDirection: { _enum: "bevelEmbossStampStyle", _value: b.direction === "down" ? "stampOut" : "stampIn" }, transferSpec: { _obj: "shapeCurveType", name: "Linear" }, antialiasGloss: false, softness: MCP.px(b.soften || 0), useShape: false, useTexture: false };
  }
  if (e.gradientOverlay) {
    var g = e.gradientOverlay.gradient;
    out.gradientFill = { _obj: "gradientFill", enabled: true, present: true, showInDialog: true, mode: MCP.blendEnum(e.gradientOverlay.blendMode || "normal"), opacity: MCP.pct(MCP.def(e.gradientOverlay.opacity, 100)), gradient: MCP.gradientDesc(g.stops), angle: MCP.deg(MCP.def(g.angle, 90)), type: { _enum: "gradientType", _value: g.type || "linear" }, reverse: false, dither: false, align: true, scale: MCP.pct(100), offset: { _obj: "paint", horizontal: MCP.pct(0), vertical: MCP.pct(0) } };
  }
  if (e.colorOverlay) out.solidFill = { _obj: "solidFill", enabled: true, present: true, showInDialog: true, mode: MCP.blendEnum(e.colorOverlay.blendMode || "normal"), opacity: MCP.pct(MCP.def(e.colorOverlay.opacity, 100)), color: MCP.rgbDesc(e.colorOverlay.color) };
  return out;
};

MCP.prepFilterLayer = function (d, p) {
  var l = MCP.getLayer(d, p.layer);
  MCP.selectLayer(l);
  var kind = MCP.kindOf(l), name = l.name;
  if (p.smart) {
    if (kind !== "smartObject") {
      MCP.ensureNotBackground(l);
      MCP.selectLayer(l);
      var oldId = l.id;
      MCP.play({ _obj: "newPlacedLayer" }, "convert to smart object");
      MCP.warn("Layer \"" + name + "\" was converted to a smart object so the filter stays editable; its layer id changed from " + oldId + " to " + d.activeLayer.id + ".");
    }
  } else if (kind !== "pixel" && kind !== "background") {
    MCP.fail("VALIDATION_ERROR", "Destructive filters need a pixel layer; \"" + l.name + "\" is " + kind + ". Use smart: true or rasterize_layer first.");
  }
  return d.activeLayer;
};

/* ---------- selections ---------- */
MCP.ops["select.all"] = function (p) { var d = MCP.getDoc(p.doc); d.selection.selectAll(); return MCP.selResult(d); };
MCP.ops["select.none"] = function (p) { var d = MCP.getDoc(p.doc); d.selection.deselect(); return { hasSelection: false }; };
MCP.ops["select.invert"] = function (p) { var d = MCP.getDoc(p.doc); d.selection.invert(); return MCP.selResult(d); };
MCP.ops["select.rect"] = function (p) {
  var d = MCP.getDoc(p.doc), shapes = p.shapes || [p.bounds];
  for (var i = 0; i < shapes.length; i++) MCP.selectShape(MCP.rectTo(shapes[i], "rectangle"), i === 0 ? p.mode : "add");
  MCP.feather(p.feather);
  return MCP.selResult(d);
};
MCP.ops["select.ellipse"] = function (p) {
  var d = MCP.getDoc(p.doc), shapes = p.shapes || [p.bounds];
  for (var i = 0; i < shapes.length; i++) { var e = MCP.rectTo(shapes[i], "ellipse"); e.antiAlias = true; MCP.selectShape(e, i === 0 ? p.mode : "add"); }
  MCP.feather(p.feather);
  return MCP.selResult(d);
};
MCP.ops["select.polygon"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.selectShape({ _obj: "polygon", points: MCP.points(p.points) }, p.mode);
  MCP.feather(p.feather);
  return MCP.selResult(d);
};
MCP.ops["select.subject"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.play({ _obj: "autoCutout", sampleAllLayers: Boolean(p.sampleAllLayers) }, "Select Subject");
  var r = MCP.selResult(d);
  if (!r.hasSelection) MCP.fail("PHOTOSHOP_ERROR", "Select Subject found no subject");
  return r;
};
MCP.ops["select.sky"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.play({ _obj: "selectSky", sampleAllLayers: false }, "Select Sky");
  var r = MCP.selResult(d);
  if (!r.hasSelection) MCP.fail("PHOTOSHOP_ERROR", "Select Sky found no sky");
  return r;
};
MCP.ops["select.colorRange"] = function (p) {
  var d = MCP.getDoc(p.doc);
  /* Skin-tone Color Range faults Photoshop's COM server on non-RGB documents (seen on Photoshop 2027): refuse up front. */
  if (p.preset === "skinTone" && d.mode !== DocumentMode.RGB) MCP.fail("VALIDATION_ERROR", "Skin tone Color Range needs an RGB document; convert with change_color_mode first.");
  var desc = { _obj: "colorRange", colors: { _enum: "colors", _value: p.preset } };
  if (p.preset === "skinTone") desc.fuzziness = Math.round(MCP.def(p.fuzziness, 40));
  if (p.mode && p.mode !== "new") desc.selectionModifier = { _enum: "selectionModifierType", _value: p.mode === "add" ? "addToSelection" : p.mode === "subtract" ? "removeFromSelection" : "intersectWithSelection" };
  MCP.play(desc, "Color Range");
  return MCP.selResult(d);
};
MCP.ops["select.modify"] = function (p) {
  var d = MCP.getDoc(p.doc);
  if (!MCP.selectionBounds(d)) MCP.fail("VALIDATION_ERROR", "No active selection to modify");
  if (p.op === "feather") d.selection.feather(UnitValue(p.amount, "px"));
  else if (p.op === "expand") d.selection.expand(UnitValue(p.amount, "px"));
  else if (p.op === "contract") d.selection.contract(UnitValue(p.amount, "px"));
  else if (p.op === "smooth") d.selection.smooth(UnitValue(p.amount, "px"));
  else MCP.fail("VALIDATION_ERROR", "Unknown selection op " + p.op);
  return MCP.selResult(d);
};
MCP.ops["select.info"] = function (p) { return MCP.selResult(MCP.getDoc(p.doc)); };
MCP.ops["select.layerPixels"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.play({ _obj: MCP.MODE_EVENT[p.mode || "new"] || "set", _target: MCP.SEL, to: { _ref: [{ _ref: "channel", _enum: "channel", _value: "transparencyEnum" }, { _ref: "layer", _id: l.id }] } }, "load transparency");
  if (p.includeMask && MCP.hasMask(l)) {
    try { MCP.play({ _obj: "interfaceIconFrameDimmed", "null": { _ref: [{ _ref: "channel", _enum: "channel", _value: "mask" }, { _ref: "layer", _id: l.id }] }, "with": { _ref: [{ _ref: "channel", _property: "selection" }] } }, "intersect with mask"); }
    catch (e) { MCP.warn("Could not intersect with the layer mask; selection uses layer transparency only."); }
  }
  return MCP.selResult(d);
};

/* ---------- masks ---------- */
MCP.makeMask = function (from) {
  MCP.play({ _obj: "make", "new": { _class: "channel" }, at: { _ref: "channel", _enum: "channel", _value: "mask" }, using: { _enum: "userMaskEnabled", _value: { selection: "revealSelection", revealAll: "revealAll", hideAll: "hideAll" }[from] } }, "add layer mask");
};
MCP.ops["mask.create"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  MCP.selectLayer(l);
  var from = p.from || "selection";
  if (from === "selection" && !MCP.selectionBounds(d)) MCP.fail("VALIDATION_ERROR", "No active selection for the mask; select first or use from: revealAll");
  if (MCP.hasMask(l)) MCP.play({ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }] }, "replace existing mask");
  MCP.makeMask(from);
  return MCP.layerOut(d.activeLayer);
};
MCP.ops["mask.vector"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  MCP.selectLayer(l);
  if (!MCP.selectionBounds(d)) MCP.fail("VALIDATION_ERROR", "Vector mask needs a selection or region");
  d.selection.makeWorkPath(0.5);
  MCP.play({ _obj: "make", _target: [{ _ref: "path" }], at: { _ref: "path", _enum: "path", _value: "vectorMask" }, using: { _ref: "path", _enum: "ordinal", _value: "targetEnum" } }, "vector mask");
  try { for (var i = d.pathItems.length - 1; i >= 0; i--) if (d.pathItems[i].kind === PathKind.WORKPATH) d.pathItems[i].remove(); } catch (e) { MCP.warn("Work path left in Paths panel."); }
  return MCP.layerOut(l);
};
MCP.ops["mask.delete"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  MCP.selectLayer(l);
  if (p.kind === "vector") {
    if (!MCP.layerProp(l.id, "hasVectorMask")) MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" has no vector mask");
    MCP.play({ _obj: "delete", _target: [{ _ref: "path", _enum: "path", _value: "vectorMask" }, { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }, "delete vector mask");
  } else {
    if (!MCP.hasMask(l)) MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" has no layer mask");
    MCP.play({ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }] }, "delete mask");
  }
  return MCP.layerOut(l);
};
MCP.ops["mask.apply"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  if (!MCP.hasMask(l)) MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" has no layer mask");
  MCP.selectLayer(l);
  MCP.play({ _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }], apply: true }, "apply mask");
  return MCP.layerOut(l);
};
MCP.ops["mask.invert"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  if (!MCP.hasMask(l)) MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" has no layer mask");
  MCP.selectLayer(l);
  MCP.play({ _obj: "select", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }], makeVisible: false }, "target mask");
  MCP.play({ _obj: "invert" }, "invert mask");
  MCP.play({ _obj: "select", _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }], makeVisible: false }, "target RGB");
  return MCP.layerOut(l);
};
MCP.ops["mask.refine"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  if (!MCP.hasMask(l)) MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" has no layer mask");
  MCP.selectLayer(l);
  var to = { _obj: "layer" };
  if (p.feather !== undefined) to.userMaskFeather = MCP.px(p.feather);
  if (p.density !== undefined) to.userMaskDensity = MCP.pct(p.density);
  MCP.play({ _obj: "set", _target: MCP.targetEnum("layer"), to: to }, "mask properties");
  return MCP.layerOut(l);
};
MCP.ops["mask.gradient"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  MCP.selectLayer(l);
  if (!MCP.hasMask(l)) MCP.makeMask("revealAll");
  MCP.play({ _obj: "select", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }], makeVisible: false }, "target mask");
  MCP.play({ _obj: "gradientClassEvent", from: { _obj: "paint", horizontal: MCP.px(p.from.x), vertical: MCP.px(p.from.y) }, to: { _obj: "paint", horizontal: MCP.px(p.to.x), vertical: MCP.px(p.to.y) }, type: { _enum: "gradientType", _value: "linear" }, dither: true, useMask: true, gradient: MCP.gradientDesc([{ color: "#FFFFFF", location: 0 }, { color: "#000000", location: 100 }]) }, "mask gradient");
  MCP.play({ _obj: "select", _target: [{ _ref: "channel", _enum: "channel", _value: "RGB" }], makeVisible: false }, "target RGB");
  return MCP.layerOut(l);
};

/* ---------- adjustments / filters / styles / fills ---------- */
MCP.ops["adjust.layer"] = function (p) {
  var d = MCP.getDoc(p.doc);
  if (p.layer) MCP.selectLayer(MCP.getLayer(d, p.layer));
  MCP.play({ _obj: "make", _target: [{ _ref: "adjustmentLayer" }], using: { _obj: "adjustmentLayer", type: MCP.adjustmentType(p.kind, p.settings || {}) } }, p.kind + " adjustment");
  var l = d.activeLayer;
  if (p.name) l.name = p.name;
  if (p.opacity !== undefined) l.opacity = p.opacity;
  if (p.blendMode) MCP.setBlend(l, p.blendMode);
  if (p.clip) l.grouped = true;
  if (p.parent) l.move(MCP.getLayer(d, p.parent), ElementPlacement.INSIDE);
  var out = MCP.layerOut(l);
  out.kind = p.kind;
  return out;
};
MCP.ops["filter.apply"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.prepFilterLayer(d, p);
  MCP.play(MCP.filterDesc(p.kind, p.settings || {}), p.kind);
  var out = MCP.layerOut(d.activeLayer);
  out.filter = p.kind;
  out.smartFilter = Boolean(p.smart);
  return out;
};
MCP.ops["layer.effects"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  MCP.selectLayer(l);
  /* Merge into the existing layerEffects ActionDescriptor (no JSON round-trip of Photoshop-internal keys). */
  var fx;
  try {
    var ref = new ActionReference();
    ref.putProperty(MCP.sID("property"), MCP.sID("layerEffects"));
    ref.putIdentifier(MCP.sID("layer"), l.id);
    var ld = executeActionGet(ref);
    fx = ld.hasKey(MCP.sID("layerEffects")) ? ld.getObjectValue(MCP.sID("layerEffects")) : new ActionDescriptor();
  } catch (e0) { fx = new ActionDescriptor(); }
  if (!fx.hasKey(MCP.sID("scale"))) fx.putUnitDouble(MCP.sID("scale"), MCP.sID("percentUnit"), 100);
  var add = MCP.effectsDesc(p.effects || {});
  for (var k2 in add) if (add.hasOwnProperty(k2)) fx.putObject(MCP.sID(k2), MCP.sID(add[k2]._obj), MCP.toDesc(add[k2]));
  var set = new ActionDescriptor(), tref = new ActionReference();
  tref.putProperty(MCP.sID("property"), MCP.sID("layerEffects"));
  tref.putEnumerated(MCP.sID("layer"), MCP.sID("ordinal"), MCP.sID("targetEnum"));
  set.putReference(MCP.sID("null"), tref);
  set.putObject(MCP.sID("to"), MCP.sID("layerEffects"), fx);
  try { executeAction(MCP.sID("set"), set, DialogModes.NO); } catch (e1) { MCP.fail("PHOTOSHOP_ERROR", "layer style: " + String(e1.message || e1).replace(/^Error d+: /, "")); }
  var info = MCP.layerInfo(l, true);
  return { layer: info, effects: info.effects };
};
MCP.ops["layer.clearEffects"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  MCP.selectLayer(l);
  MCP.play({ _obj: "disableLayerStyle", _target: MCP.targetEnum("layer") }, "clear layer style");
  return MCP.layerOut(l);
};
MCP.ops["edit.contentAwareFill"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer), k = MCP.kindOf(l);
  if (k !== "pixel" && k !== "background") MCP.fail("VALIDATION_ERROR", "Content-Aware Fill needs a pixel layer; \"" + l.name + "\" is " + k);
  if (!MCP.selectionBounds(d)) MCP.fail("VALIDATION_ERROR", "Content-Aware Fill needs an active selection");
  MCP.selectLayer(l);
  MCP.play({ _obj: "fill", using: { _enum: "fillContents", _value: "contentAware" }, contentAwareColorAdaptationFill: true, opacity: MCP.pct(100), mode: MCP.blendEnum("normal") }, "Content-Aware Fill");
  return MCP.layerOut(l);
};
MCP.ops["edit.fillSelection"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  if (!MCP.selectionBounds(d)) MCP.fail("VALIDATION_ERROR", "Fill needs an active selection");
  d.activeLayer = l;
  d.selection.fill(MCP.solid(p.color), ColorBlendMode.NORMAL, MCP.def(p.opacity, 100));
  return MCP.layerOut(l);
};
