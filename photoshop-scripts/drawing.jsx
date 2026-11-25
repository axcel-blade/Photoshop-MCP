/* Text, vector shape layers, fill layers and image placement. */

MCP.JUST = { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "LEFTJUSTIFIED" };

MCP.finishShape = function (d, p) {
  var l = d.activeLayer;
  if (p.name) l.name = p.name;
  if (p.opacity !== undefined) l.opacity = p.opacity;
  if (p.blendMode) MCP.setBlend(l, p.blendMode);
  if (p.parent) l.move(MCP.getLayer(d, p.parent), ElementPlacement.INSIDE);
  return MCP.layerOut(l);
};

MCP.strokeStyle = function (s) {
  if (!s) return undefined;
  if (s === "none") return { _obj: "strokeStyle", strokeStyleVersion: 2, strokeEnabled: false, fillEnabled: true };
  var align = { outside: "strokeStyleAlignOutside", inside: "strokeStyleAlignInside", center: "strokeStyleAlignCenter" }[s.position || "outside"];
  return {
    _obj: "strokeStyle", strokeStyleVersion: 2, strokeEnabled: true, fillEnabled: true, strokeStyleLineWidth: MCP.px(s.width || 2),
    strokeStyleLineAlignment: { _enum: "strokeStyleLineAlignment", _value: align }, strokeStyleContent: { _obj: "solidColorLayer", color: MCP.rgbDesc(s.color) },
    strokeStyleOpacity: MCP.pct(100)
  };
};

MCP.contentLayer = function (fill, shape, stroke) {
  MCP.aboveClipChain(app.activeDocument);
  var using = { _obj: "contentLayer", type: { _obj: "solidColorLayer", color: MCP.rgbDesc(fill || "#000000") } };
  if (shape) using.shape = shape;
  var ss = MCP.strokeStyle(stroke);
  // Stroke-only shape: no fill given (or "none") -> disable the fill instead of painting black.
  var noFill = (!fill || fill === "none") && stroke && stroke !== "none";
  if (ss) { if (noFill) ss.fillEnabled = false; using.strokeStyle = ss; }
  return { _obj: "make", _target: [{ _ref: "contentLayer" }], using: using };
};

MCP.setSel = function (to) { MCP.play({ _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: to }, "selection"); };
MCP.points = function (pts) { return MCP.map(pts, function (q) { return { _obj: "paint", horizontal: MCP.px(q.x), vertical: MCP.px(q.y) }; }); };
MCP.rectTo = function (b, kind) { return { _obj: kind, top: MCP.px(b.top), left: MCP.px(b.left), bottom: MCP.px(b.bottom), right: MCP.px(b.right) }; };

MCP.ops["text.create"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var font = p.font || "ArialMT", requested = font;
  if (!MCP.fontExists(font)) { MCP.warn("Font \"" + font + "\" is not installed; used ArialMT instead."); font = "ArialMT"; }
  MCP.aboveClipChain(d);
  var l = d.artLayers.add();
  l.kind = LayerKind.TEXT;
  var t = l.textItem;
  t.contents = p.text;
  t.font = font;
  t.size = MCP.textPt(p.size || 48, d);
  t.color = MCP.solid(p.color || "#000000");
  if (p.alignment) t.justification = Justification[MCP.JUST[p.alignment]];
  t.position = [UnitValue(p.x, "px"), UnitValue(p.y, "px")];
  if (p.tracking) t.tracking = p.tracking;
  if (p.leading) { t.useAutoLeading = false; t.leading = MCP.textPt(p.leading, d); }
  if (p.box) {
    t.kind = TextType.PARAGRAPHTEXT;
    t.width = MCP.textPt(p.box.width, d);
    t.height = MCP.textPt(p.box.height, d);
    t.position = [UnitValue(p.x, "px"), UnitValue(p.y, "px")];
  }
  if (p.name) l.name = p.name;
  var out = MCP.layerOut(l);
  out.font = { requested: requested, used: font, available: requested === font };
  return out;
};

MCP.ops["text.edit"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var targets = [];
  if (p.allTextLayers) { var all = MCP.allLayers(d); for (var i = 0; i < all.length; i++) if (MCP.kindOf(all[i]) === "text") targets.push(all[i]); }
  else targets.push(MCP.getLayer(d, p.layer));
  var changed = [];
  for (var j = 0; j < targets.length; j++) {
    var l = targets[j];
    if (MCP.kindOf(l) !== "text") { if (!p.allTextLayers) MCP.fail("VALIDATION_ERROR", "Layer \"" + l.name + "\" is not a text layer"); continue; }
    var t = l.textItem;
    if (p.find !== undefined) {
      if (t.contents.indexOf(p.find) < 0) continue;
      t.contents = t.contents.split(p.find).join(p.replace || "");
    }
    if (p.text !== undefined) t.contents = p.text;
    if (p.font !== undefined) { if (!MCP.fontExists(p.font)) MCP.fail("VALIDATION_ERROR", "Font \"" + p.font + "\" is not installed (use its PostScript name)"); t.font = p.font; }
    if (p.size !== undefined) t.size = MCP.textPt(p.size, d);
    if (p.color !== undefined) t.color = MCP.solid(p.color);
    if (p.tracking !== undefined) t.tracking = p.tracking;
    if (p.leading !== undefined) { if (p.leading === "auto") t.useAutoLeading = true; else { t.useAutoLeading = false; t.leading = MCP.textPt(p.leading, d); } }
    if (p.fauxBold !== undefined) t.fauxBold = p.fauxBold;
    if (p.fauxItalic !== undefined) t.fauxItalic = p.fauxItalic;
    if (p.underline !== undefined) t.underline = p.underline ? UnderlineType.UNDERLINELEFT : UnderlineType.UNDERLINEOFF;
    if (p.strikethrough !== undefined) t.strikeThru = p.strikethrough ? StrikeThruType.STRIKEBOX : StrikeThruType.STRIKEOFF;
    if (p.capitalization !== undefined) t.capitalization = { normal: TextCase.NORMAL, allCaps: TextCase.ALLCAPS, smallCaps: TextCase.SMALLCAPS }[p.capitalization];
    if (p.alignment !== undefined) t.justification = Justification[MCP.JUST[p.alignment]];
    changed.push(l);
  }
  if (p.find !== undefined && !changed.length) MCP.warn("\"" + p.find + "\" was not found in any text layer.");
  return { changed: MCP.map(changed, function (l) { return l.id; }), layers: MCP.map(changed, function (l) { return MCP.layerInfo(l, false); }) };
};

MCP.ops["text.toShape"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  if (MCP.kindOf(l) !== "text") MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" is not text");
  d.activeLayer = l;
  l.textItem.convertToShape();
  return { layer: MCP.layerInfo(d.activeLayer, false) };
};

MCP.ops["shape.rect"] = function (p) {
  var d = MCP.getDoc(p.doc), b = p.bounds, r = p.radius || 0;
  var shape = MCP.rectTo(b, "rectangle");
  shape.unitValueQuadVersion = 1;
  if (r) { shape.topRight = MCP.px(r); shape.topLeft = MCP.px(r); shape.bottomLeft = MCP.px(r); shape.bottomRight = MCP.px(r); }
  MCP.play(MCP.contentLayer(p.fill, shape, p.stroke), "rectangle");
  return MCP.finishShape(d, p);
};

MCP.ops["shape.ellipse"] = function (p) {
  var d = MCP.getDoc(p.doc), shape = MCP.rectTo(p.bounds, "ellipse");
  shape.unitValueQuadVersion = 1;
  MCP.play(MCP.contentLayer(p.fill, shape, p.stroke), "ellipse");
  return MCP.finishShape(d, p);
};

MCP.ops["shape.polygon"] = function (p) {
  var d = MCP.getDoc(p.doc);
  /* Build a vector path from the points (pathItems), then a solid-color shape layer from the active path. */
  var pts = [];
  for (var i = 0; i < p.points.length; i++) {
    var pp = new PathPointInfo();
    pp.kind = PointKind.CORNERPOINT;
    pp.anchor = [p.points[i].x, p.points[i].y];
    pp.leftDirection = pp.anchor;
    pp.rightDirection = pp.anchor;
    pts.push(pp);
  }
  var sp = new SubPathInfo();
  sp.closed = true;
  sp.operation = ShapeOperation.SHAPEADD;
  sp.entireSubPath = pts;
  var name = "psmcp-path-" + new Date().getTime();
  var path = d.pathItems.add(name, [sp]);
  path.select();
  MCP.play(MCP.contentLayer(p.fill, undefined, p.stroke), "shape from path");
  try { path.remove(); } catch (e) { MCP.warn("Temporary path left in the Paths panel."); }
  return MCP.finishShape(d, p);
};

MCP.ops["shape.edit"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.selectLayer(l);
  var target = [{ _ref: "contentLayer", _enum: "ordinal", _value: "targetEnum" }];
  if (p.fill) MCP.play({ _obj: "set", _target: target, to: { _obj: "solidColorLayer", color: MCP.rgbDesc(p.fill) } }, "shape fill");
  if (p.stroke) MCP.play({ _obj: "set", _target: target, to: { _obj: "shapeStyle", strokeStyle: MCP.strokeStyle(p.stroke) } }, "shape stroke");
  if (p.opacity !== undefined) l.opacity = p.opacity;
  return MCP.layerOut(l);
};

MCP.ops["fill.solid"] = function (p) {
  var d = MCP.getDoc(p.doc);
  if (p.bounds) MCP.setSel(MCP.rectTo(p.bounds, "rectangle"));
  MCP.play(MCP.contentLayer(p.color, undefined, undefined), "solid fill layer");
  if (p.bounds) d.selection.deselect();
  return MCP.finishShape(d, p);
};

MCP.ops["fill.gradient"] = function (p) {
  var d = MCP.getDoc(p.doc), g = p.gradient;
  MCP.aboveClipChain(d);
  if (p.bounds) MCP.setSel(MCP.rectTo(p.bounds, "rectangle"));
  var type = { radial: "radial", angle: "angle", reflected: "reflected", diamond: "diamond" }[g.type] || "linear";
  MCP.play({
    _obj: "make", _target: [{ _ref: "contentLayer" }],
    using: { _obj: "contentLayer", type: { _obj: "gradientLayer", angle: MCP.deg(MCP.def(g.angle, 90)), type: { _enum: "gradientType", _value: type }, gradient: MCP.gradientDesc(g.stops) } }
  }, "gradient fill layer");
  if (p.bounds) d.selection.deselect();
  return MCP.finishShape(d, p);
};

MCP.fitPlaced = function (l, p) {
  var b = MCP.boundsOf(l.bounds);
  if (p.width && p.height && p.fit !== "none") {
    var sx = p.width / b.width * 100, sy = p.height / b.height * 100;
    if (p.fit === "contain") sx = sy = Math.min(sx, sy);
    if (p.fit === "cover") sx = sy = Math.max(sx, sy);
    l.resize(sx, sy, AnchorPosition.MIDDLECENTER);
  }
  var nb = MCP.boundsOf(l.bounds);
  if (p.x !== undefined || p.y !== undefined) {
    var cx = p.width ? (p.x || 0) + p.width / 2 : (p.x || 0) + nb.width / 2;
    var cy = p.height ? (p.y || 0) + p.height / 2 : (p.y || 0) + nb.height / 2;
    l.translate(UnitValue(cx - (nb.left + nb.width / 2), "px"), UnitValue(cy - (nb.top + nb.height / 2), "px"));
  }
};

MCP.ops["image.place"] = function (p) {
  var d = MCP.getDoc(p.doc);
  if (!new File(p.path).exists) MCP.fail("FILE_NOT_FOUND", "File not found: " + p.path);
  MCP.play({ _obj: "placeEvent", "null": { _path: p.path }, linked: Boolean(p.linked), freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" }, offset: { _obj: "offset", horizontal: MCP.px(0), vertical: MCP.px(0) } }, "place image");
  var l = d.activeLayer;
  MCP.fitPlaced(l, p);
  if (p.name) l.name = p.name;
  return MCP.layerOut(l);
};
