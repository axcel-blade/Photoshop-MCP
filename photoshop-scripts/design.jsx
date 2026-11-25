/*
 * Design plans: build a compiled DesignPlan (src/design-engine/compiler.ts) as editable Photoshop layers in ONE script call.
 * Plan coordinates arrive in points (1/72 in), origin top-left; MCP.S converts them to pixels at the plan's resolution.
 * Each element becomes a named layer inside a layer group named after its plan layer.
 */

MCP.S = 1;
MCP.P = function (v) { return v === undefined || v === null ? v : v * MCP.S; };

MCP.fillHex = function (f) {
  if (!f || f === "none") return null;
  if (f.hex) return f.hex;
  if (f.stops && f.stops.length) return f.stops[0].color.hex;
  return null;
};
MCP.planGradient = function (f) {
  return { type: f.type === "radial" ? "radial" : "linear", angle: f.angle || 0, stops: MCP.map(f.stops, function (s) { return { color: s.color.hex, location: s.position, opacity: MCP.def(s.opacity, 100) }; }) };
};
MCP.planStroke = function (s) {
  if (!s || s === "none") return undefined;
  return { color: s.color.hex, width: Math.max(0.5, MCP.P(s.width || 1)), position: "center" };
};

MCP.ringPoints = function (cx, cy, r, n, inner) {
  var pts = [], total = inner ? n * 2 : n;
  for (var i = 0; i < total; i++) {
    var a = -Math.PI / 2 + i * 2 * Math.PI / total, k = inner && i % 2 === 1 ? inner / r : 1;
    pts.push({ x: cx + Math.cos(a) * r * k, y: cy + Math.sin(a) * r * k });
  }
  return pts;
};

/** Shape from points with optional bezier handles (in/out are absolute points). */
MCP.pathShape = function (d, el, closed) {
  var pts = [];
  for (var i = 0; i < el.points.length; i++) {
    var q = el.points[i], pp = new PathPointInfo();
    pp.kind = q.corner === false ? PointKind.SMOOTHPOINT : PointKind.CORNERPOINT;
    pp.anchor = [MCP.P(q.x), MCP.P(q.y)];
    pp.leftDirection = q["in"] ? [MCP.P(q["in"][0]), MCP.P(q["in"][1])] : pp.anchor;
    pp.rightDirection = q.out ? [MCP.P(q.out[0]), MCP.P(q.out[1])] : pp.anchor;
    pts.push(pp);
  }
  var sp = new SubPathInfo();
  sp.closed = closed;
  sp.operation = ShapeOperation.SHAPEADD;
  sp.entireSubPath = pts;
  var path = d.pathItems.add("psmcp-plan-" + new Date().getTime(), [sp]);
  path.select();
  var hex = MCP.fillHex(el.fill), stroke = MCP.planStroke(el.stroke);
  var desc = MCP.contentLayer(hex || "#000000", undefined, stroke);
  if (!hex && stroke) desc.using.strokeStyle.fillEnabled = false;
  MCP.play(desc, "path shape");
  try { path.remove(); } catch (e) { /* leave */ }
  return d.activeLayer;
};

MCP.planEffects = function (l, effects) {
  var fx = {}, has = false;
  for (var i = 0; i < effects.length; i++) {
    var e = effects[i];
    if (e.type === "shadow") {
      var ox = MCP.P(e.offsetX || 0), oy = MCP.P(e.offsetY || 0);
      fx.dropShadow = { color: "#000000", opacity: Math.round(MCP.def(e.opacity, 0.4) * 100), angle: Math.round(Math.atan2(oy, -ox) * 180 / Math.PI), distance: Math.round(Math.sqrt(ox * ox + oy * oy)), size: Math.round(MCP.P(e.blur || 5)), spread: 0, blendMode: "multiply" };
      has = true;
    } else if (e.type === "outerGlow" || e.type === "innerGlow") {
      fx[e.type] = { color: "#FFFFFF", opacity: Math.round(MCP.def(e.opacity, 0.75) * 100), size: Math.round(MCP.P(e.radius || 8)), spread: 0, blendMode: "screen" };
      has = true;
    } else if (e.type === "blur") {
      MCP.ops["filter.apply"]({ layer: { id: l.id }, kind: "gaussianBlur", settings: { radius: Math.max(0.1, MCP.P(e.radius || 5)) }, smart: true });
      l = app.activeDocument.activeLayer;
    }
  }
  if (has) MCP.ops["layer.effects"]({ layer: { id: l.id }, effects: fx });
  return l;
};

MCP.pickFont = function (fonts) {
  var list = fonts instanceof Array ? fonts : [fonts];
  for (var i = 0; i < list.length; i++) if (list[i] && MCP.fontExists(list[i])) return { font: list[i], fallback: i > 0 };
  return { font: "ArialMT", fallback: true };
};

MCP.WEIGHT_BOLD = { semibold: true, bold: true, extrabold: true, black: true };

MCP.buildElement = function (d, el) {
  var l, hex = MCP.fillHex(el.fill), grad = el.fill && el.fill.stops ? MCP.planGradient(el.fill) : null, stroke = MCP.planStroke(el.stroke);
  var box = el.width !== undefined ? { left: MCP.P(el.x), top: MCP.P(el.y), right: MCP.P(el.x + el.width), bottom: MCP.P(el.y + el.height) } : null;
  switch (el.type) {
    case "rect": {
      MCP.ops["shape.rect"]({ bounds: box, fill: hex || "#000000", radius: MCP.P(el.cornerRadius || 0), stroke: stroke });
      l = d.activeLayer;
      if (!hex && !grad) l.fillOpacity = stroke ? 0 : l.fillOpacity;
      break;
    }
    case "ellipse":
      MCP.ops["shape.ellipse"]({ bounds: box, fill: hex || "#000000", stroke: stroke });
      l = d.activeLayer;
      if (!hex && !grad && stroke) l.fillOpacity = 0;
      break;
    case "polygon":
    case "star": {
      var pts = MCP.ringPoints(MCP.P(el.cx), MCP.P(el.cy), MCP.P(el.radius), el.type === "star" ? el.points : el.sides, el.type === "star" ? MCP.P(el.innerRadius) : 0);
      MCP.ops["shape.polygon"]({ points: pts, fill: hex || "#000000", stroke: stroke });
      l = d.activeLayer;
      break;
    }
    case "line": {
      var x1 = MCP.P(el.x1), y1 = MCP.P(el.y1), x2 = MCP.P(el.x2), y2 = MCP.P(el.y2);
      var w = stroke ? stroke.width : 1, dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
      var nx = -dy / len * w / 2, ny = dx / len * w / 2;
      MCP.ops["shape.polygon"]({ points: [{ x: x1 + nx, y: y1 + ny }, { x: x2 + nx, y: y2 + ny }, { x: x2 - nx, y: y2 - ny }, { x: x1 - nx, y: y1 - ny }], fill: stroke ? stroke.color : "#000000" });
      l = d.activeLayer;
      break;
    }
    case "path":
      l = MCP.pathShape(d, el, el.closed !== false);
      break;
    case "text": {
      var f = MCP.pickFont(el.font);
      if (f.fallback) MCP.warn("Text \"" + el.name + "\": font " + MCP.stringify(el.font) + " not installed; used " + f.font + ".");
      var size = MCP.P(el.fontSize), content = el.caps === "all" ? String(el.content).toUpperCase() : el.content;
      var para = el.width !== undefined && el.height !== undefined;
      var ax = MCP.P(el.x), align = el.align || "left";
      if (!para && align === "center" && el.width) ax = MCP.P(el.x + el.width / 2);
      MCP.ops["text.create"]({ text: content, x: ax, y: MCP.P(el.y) + size * 0.8, size: size, font: f.font, color: el.color ? el.color.hex : "#111111", alignment: align, tracking: el.tracking || 0, leading: el.leading ? MCP.P(el.leading) : undefined, box: para ? { width: MCP.P(el.width), height: MCP.P(el.height) } : undefined });
      l = d.activeLayer;
      if (para) l.textItem.position = [UnitValue(MCP.P(el.x), "px"), UnitValue(MCP.P(el.y), "px")];
      if (el.weight && MCP.WEIGHT_BOLD[el.weight] && !/bold|black|heavy|semi/i.test(f.font)) l.textItem.fauxBold = true;
      break;
    }
    case "image":
      MCP.ops["image.place"]({ path: el.path, x: MCP.P(el.x), y: MCP.P(el.y), width: MCP.P(el.width), height: MCP.P(el.height), fit: el.fit === "stretch" ? "stretch" : "contain", linked: el.embed === false });
      l = d.activeLayer;
      break;
    default:
      MCP.fail("VALIDATION_ERROR", "Unknown element type " + el.type);
  }
  l.name = el.name;
  if (grad) MCP.ops["layer.effects"]({ layer: { id: l.id }, effects: { gradientOverlay: { gradient: grad, opacity: 100, blendMode: "normal" } } });
  if (el.effects && el.effects.length) l = MCP.planEffects(l, el.effects);
  if (el.rotation) l.rotate(-el.rotation, AnchorPosition.MIDDLECENTER);
  if (el.opacity !== undefined) l.opacity = el.opacity;
  if (el.blendMode) MCP.setBlend(l, el.blendMode);
  return l;
};

MCP.findGroup = function (d, name) {
  for (var i = 0; i < d.layerSets.length; i++) if (d.layerSets[i].name === name) return d.layerSets[i];
  var g = d.layerSets.add();
  g.name = name;
  return g;
};

MCP.ops["execute_plan"] = function (p) {
  MCP.S = (p.resolution || 72) / 72;
  var d;
  if (p.newDocument) {
    d = app.documents.add(UnitValue(Math.round(p.width * MCP.S), "px"), UnitValue(Math.round(p.height * MCP.S), "px"), p.resolution || 72, p.artboardName || "Design", p.colorMode === "CMYK" ? NewDocumentMode.CMYK : NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
  } else d = MCP.getDoc(p.doc);
  /* Groups: plan layers are listed top-first, so create bottom-first. */
  for (var gi = p.layers.length - 1; gi >= 0; gi--) MCP.findGroup(d, p.layers[gi]);
  var built = [], failed = [];
  for (var i = 0; i < p.elements.length; i++) {
    var el = p.elements[i];
    try {
      var l = MCP.buildElement(d, el);
      var g = MCP.findGroup(d, el.layer);
      l.move(g, ElementPlacement.PLACEATBEGINNING);
      if (el.locked) l.allLocked = true;
      built.push({ name: el.name, id: l.id });
    } catch (e) {
      failed.push({ name: el.name, message: String(e.message || e) });
      if (p.stopOnError) break;
    }
  }
  for (var k = 0; k < (p.lockLayers || []).length; k++) { try { MCP.findGroup(d, p.lockLayers[k]).allLocked = true; } catch (e2) { /* ignore */ } }
  /* Remove empty groups so the layer panel matches what was built. */
  for (var j = d.layerSets.length - 1; j >= 0; j--) { try { if (d.layerSets[j].layers.length === 0) d.layerSets[j].remove(); } catch (e3) { /* ignore */ } }
  if (p.swatches && p.swatches.length) MCP.warn("Palette swatches are reported in the plan; Photoshop swatches are not modified.");
  return { document: { id: d.id, name: d.name, width: Math.round(d.width.as("px")), height: Math.round(d.height.as("px")), resolution: d.resolution }, built: built, failed: failed };
};

MCP.ops["update_elements"] = function (p) {
  MCP.S = (p.resolution || app.activeDocument.resolution) / 72;
  var d = MCP.getDoc(p.doc), updated = [], failed = [];
  var removals = (p.removals || []).slice(0);
  for (var i = 0; i < p.updates.length; i++) {
    var u = p.updates[i];
    if (u.remove) { removals.push(u.name); continue; }
    try {
      var l = MCP.getLayer(d, { name: u.name });
      var wasLocked = l.allLocked;
      if (wasLocked) l.allLocked = false;
      var kind = MCP.kindOf(l);
      if (u.fill !== undefined) {
        var hex = MCP.fillHex(u.fill);
        if (kind === "text" && hex) l.textItem.color = MCP.solid(hex);
        else if (hex && (kind === "shape" || kind === "solidColor")) MCP.ops["shape.edit"]({ layer: { id: l.id }, fill: hex });
        if (u.fill && u.fill.stops) MCP.ops["layer.effects"]({ layer: { id: l.id }, effects: { gradientOverlay: { gradient: MCP.planGradient(u.fill), opacity: 100, blendMode: "normal" } } });
      }
      if (u.stroke !== undefined && (kind === "shape")) MCP.ops["shape.edit"]({ layer: { id: l.id }, stroke: u.stroke === "none" ? "none" : MCP.planStroke(u.stroke) });
      if (kind === "text") {
        var t = l.textItem;
        if (u.content !== undefined) t.contents = u.content;
        if (u.fontSize !== undefined) t.size = MCP.textPt(MCP.P(u.fontSize), d);
        if (u.font !== undefined) t.font = MCP.pickFont(u.font).font;
        if (u.tracking !== undefined) t.tracking = u.tracking;
        if (u.align !== undefined) t.justification = Justification[MCP.JUST[u.align] || "LEFT"];
      }
      if (u.x !== undefined && u.y !== undefined) {
        var b = MCP.boundsOf(l.bounds);
        if (u.width !== undefined && u.height !== undefined && kind !== "text" && b.width > 0 && b.height > 0) {
          l.resize(MCP.P(u.width) / b.width * 100, MCP.P(u.height) / b.height * 100, AnchorPosition.TOPLEFT);
          b = MCP.boundsOf(l.bounds);
        }
        l.translate(UnitValue(MCP.P(u.x) - b.left, "px"), UnitValue(MCP.P(u.y) - b.top, "px"));
      }
      if (u.opacity !== undefined) l.opacity = u.opacity;
      if (u.blendMode !== undefined) MCP.setBlend(l, u.blendMode);
      if (u.rotation) l.rotate(-u.rotation, AnchorPosition.MIDDLECENTER);
      if (u.effects) MCP.planEffects(l, u.effects);
      if (u.layerTo) l.move(MCP.findGroup(d, u.layerTo), ElementPlacement.PLACEATBEGINNING);
      if (wasLocked) l.allLocked = true;
      updated.push(u.name);
    } catch (e) {
      failed.push({ name: u.name, message: String(e.message || e) });
    }
  }
  var removed = [];
  for (var r = 0; r < removals.length; r++) {
    try { var rl = MCP.getLayer(d, { name: removals[r] }); rl.allLocked = false; rl.remove(); removed.push(removals[r]); }
    catch (e4) { failed.push({ name: removals[r], message: String(e4.message || e4) }); }
  }
  return { updated: updated, removed: removed, failed: failed };
};

MCP.ops["check_fonts"] = function (p) {
  return { fonts: MCP.map(p.fonts || [], function (f) { var ok = MCP.fontExists(f); return { requested: f, available: ok, resolved: ok ? f : null }; }) };
};
