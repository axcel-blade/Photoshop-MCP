/* Layers: list, create, delete, duplicate, move, transform, arrange, merge, group, properties, smart objects. */

MCP.layerOut = function (l) { return { layer: MCP.layerInfo(l, true) }; };
MCP.requirePixels = function (l, what) {
  var b = MCP.boundsOf(l.bounds);
  if (b.width <= 0 || b.height <= 0) MCP.fail("VALIDATION_ERROR", "Layer \"" + l.name + "\" is empty; nothing to " + what + ".");
};
MCP.refs = function (d, list) { return MCP.map(list || [], function (r) { return MCP.getLayer(d, r); }); };
MCP.ANCH = { center: "MIDDLECENTER", topLeft: "TOPLEFT", top: "TOPCENTER", bottom: "BOTTOMCENTER" };

MCP.tree = function (container, opts, out) {
  for (var i = 0; i < container.layers.length; i++) {
    var l = container.layers[i];
    if (opts.includeHidden !== false || l.visible) out.push(MCP.layerInfo(l, false));
    if (l.typename === "LayerSet") MCP.tree(l, opts, out);
  }
  return out;
};

MCP.ops["layer.list"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var layers = MCP.tree(d, p, []);
  if (p.selectedOnly) {
    var ids = MCP.targetIds(d), sel = [];
    for (var i = 0; i < layers.length; i++) if (MCP.contains(ids, layers[i].id)) sel.push(layers[i]);
    layers = sel;
  }
  return { documentId: d.id, layers: layers };
};

MCP.ops["layer.info"] = function (p) { return MCP.layerOut(MCP.getLayer(MCP.getDoc(p.doc), p.layer)); };
MCP.ops["layer.select"] = function (p) { var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer); MCP.selectLayer(l); return MCP.layerOut(l); };

MCP.ops["layer.create"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.aboveClipChain(d);
  var l = p.kind === "group" ? d.layerSets.add() : d.artLayers.add();
  if (p.name) l.name = p.name;
  if (p.opacity !== undefined) l.opacity = p.opacity;
  if (p.blendMode) MCP.setBlend(l, p.blendMode);
  if (p.parent) l.move(MCP.getLayer(d, p.parent), ElementPlacement.INSIDE);
  return MCP.layerOut(l);
};

MCP.ops["layer.delete"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var ls = p.layers ? MCP.refs(d, p.layers) : [MCP.getLayer(d, p.layer)];
  var ids = MCP.map(ls, function (l) { return l.id; });
  for (var i = 0; i < ls.length; i++) ls[i].remove();
  return { deleted: ids };
};

MCP.ops["layer.duplicate"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var src = MCP.getLayer(d, p.layer);
  var l = src.duplicate();
  if (p.name) l.name = p.name;
  d.activeLayer = l;
  return MCP.layerOut(l);
};

MCP.ops["layer.fromSelection"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.selectLayer(MCP.getLayer(d, p.layer));
  if (!MCP.selectionBounds(d)) MCP.fail("VALIDATION_ERROR", "Layer via Copy needs an active selection");
  MCP.play({ _obj: p.cut ? "cutToLayer" : "copyToLayer" }, "layer via copy");
  var l = d.activeLayer;
  if (p.name) l.name = p.name;
  return MCP.layerOut(l);
};

MCP.ops["layer.rename"] = function (p) { var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer); l.name = p.name; return MCP.layerOut(l); };

MCP.ops["layer.translate"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  MCP.requirePixels(l, "move");
  var b = MCP.boundsOf(l.bounds);
  var dx = p.x !== undefined ? p.x - b.left : (p.dx || 0);
  var dy = p.y !== undefined ? p.y - b.top : (p.dy || 0);
  l.translate(UnitValue(dx, "px"), UnitValue(dy, "px"));
  return MCP.layerOut(l);
};

/* Several moves in one call (align_layers / distribute_layers compute the deltas server-side). */
MCP.ops["layer.translateMany"] = function (p) {
  var d = MCP.getDoc(p.doc), out = [];
  for (var i = 0; i < p.moves.length; i++) {
    var m = p.moves[i], l = MCP.getLayer(d, { id: m.id });
    if (l.typename === "ArtLayer" && l.isBackgroundLayer) MCP.fail("VALIDATION_ERROR", "The Background layer cannot be moved; convert it to a normal layer first.");
    l.translate(UnitValue(m.dx, "px"), UnitValue(m.dy, "px"));
    out.push(MCP.layerInfo(l, false));
  }
  return { layers: out };
};

MCP.ops["layer.transform"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  MCP.requirePixels(l, "transform");
  var anchor = AnchorPosition[MCP.ANCH[p.anchor || "center"]];
  if (p.scaleX !== undefined || p.scaleY !== undefined) l.resize(MCP.def(p.scaleX, 100), MCP.def(p.scaleY, 100), anchor);
  if (p.angle) l.rotate(p.angle, anchor);
  if (p.skewX || p.skewY) {
    MCP.selectLayer(l);
    MCP.play({ _obj: "transform", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" }, skew: { _obj: "paint", horizontal: MCP.deg(p.skewX || 0), vertical: MCP.deg(p.skewY || 0) } }, "skew");
  }
  if (p.flip) {
    MCP.selectLayer(l);
    MCP.play({ _obj: "flip", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], axis: { _enum: "orientation", _value: p.flip === "vertical" ? "vertical" : "horizontal" } }, "flip layer");
  }
  if (p.dx || p.dy) l.translate(UnitValue(p.dx || 0, "px"), UnitValue(p.dy || 0, "px"));
  return MCP.layerOut(l);
};

MCP.ops["layer.arrange"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  MCP.ensureNotBackground(l);
  if (p.position === "above" || p.position === "below") {
    var rel = MCP.getLayer(d, p.relativeTo);
    if (rel.typename === "ArtLayer" && rel.isBackgroundLayer && p.position === "below") rel.isBackgroundLayer = false;
    l.move(rel, p.position === "above" ? ElementPlacement.PLACEBEFORE : ElementPlacement.PLACEAFTER);
  } else {
    var map = { top: "BRINGTOFRONT", bottom: "SENDTOBACK", up: "BRINGFORWARD", down: "SENDBACKWARD" };
    if (p.position === "bottom") {
      /* SENDTOBACK stops above a Background layer; move after it explicitly when there is one. */
      var last = d.layers[d.layers.length - 1];
      if (last !== l && last.typename === "ArtLayer" && last.isBackgroundLayer) { l.move(last, ElementPlacement.PLACEBEFORE); return MCP.layerOut(l); }
    }
    var v = { top: "front", bottom: "back", up: "next", down: "previous" }[p.position];
    MCP.selectLayer(l);
    MCP.play({ _obj: "move", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }], to: { _ref: "layer", _enum: "ordinal", _value: v } }, "arrange " + map[p.position]);
  }
  return MCP.layerOut(l);
};

MCP.ops["layer.merge"] = function (p) {
  var d = MCP.getDoc(p.doc);
  MCP.selectLayers(MCP.refs(d, p.layers));
  MCP.play({ _obj: "mergeLayersNew" }, "merge layers");
  return MCP.layerOut(d.activeLayer);
};

MCP.ops["layer.mergeVisible"] = function (p) { var d = MCP.getDoc(p.doc); d.mergeVisibleLayers(); return MCP.layerOut(d.activeLayer); };

/* Grouping non-adjacent layers puts the group at the topmost member, which moves lower members above the layers in between. */
MCP.warnSkipped = function (ls) {
  try {
    var par = ls[0].parent, sib = par.layers, idx = [], i, k;
    for (i = 0; i < ls.length; i++) {
      if (ls[i].parent !== par) return;
      for (k = 0; k < sib.length; k++) if (sib[k] === ls[i]) idx.push(k);
    }
    var lo = Math.min.apply(null, idx), hi = Math.max.apply(null, idx), skipped = [];
    for (k = lo; k <= hi; k++) {
      var member = false;
      for (i = 0; i < idx.length; i++) if (idx[i] === k) member = true;
      if (!member && !(sib[k].typename === "ArtLayer" && sib[k].grouped)) skipped.push(sib[k].name); /* clipped layers travel with their base */
    }
    if (skipped.length) MCP.warn("Members were not adjacent: the group sits where the topmost member was, so lower members now stack above " + skipped.slice(0, 12).join(", ") + (skipped.length > 12 ? " (+" + (skipped.length - 12) + " more)" : "") + ". Use reorder_layers if that hides something.");
  } catch (e) {}
};

MCP.ops["layer.group"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var ls = MCP.refs(d, p.layers);
  MCP.warnSkipped(ls);
  MCP.selectLayers(ls);
  MCP.play({ _obj: "make", _target: [{ _ref: "layerSection" }], from: { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }, using: { _obj: "layerSection", name: p.name || "Group" } }, "group layers");
  return { layer: MCP.layerInfo(d.activeLayer, false), members: MCP.map(ls, function (l) { return l.id; }) };
};

MCP.ops["layer.ungroup"] = function (p) {
  var d = MCP.getDoc(p.doc), g = MCP.getLayer(d, p.layer);
  if (g.typename !== "LayerSet") MCP.fail("VALIDATION_ERROR", "\"" + g.name + "\" is not a group");
  var id = g.id;
  MCP.selectLayer(g);
  MCP.play({ _obj: "ungroupLayersEvent", _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }] }, "ungroup");
  return { ungrouped: id };
};

MCP.ops["layer.props"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  if (p.visible !== undefined) l.visible = p.visible;
  if (p.opacity !== undefined) l.opacity = p.opacity;
  if (p.fillOpacity !== undefined) l.fillOpacity = p.fillOpacity;
  if (p.blendMode !== undefined) MCP.setBlend(l, p.blendMode);
  if (p.lock !== undefined) {
    if (p.lock === "none") { l.allLocked = false; if (l.typename === "ArtLayer") { l.pixelsLocked = false; l.positionLocked = false; l.transparentPixelsLocked = false; } }
    else if (p.lock === "all") l.allLocked = true;
    else if (p.lock === "position") l.positionLocked = true;
    else if (p.lock === "pixels") l.pixelsLocked = true;
    else if (p.lock === "transparency") l.transparentPixelsLocked = true;
  }
  return MCP.layerOut(l);
};

MCP.ops["layer.link"] = function (p) {
  var d = MCP.getDoc(p.doc), ls = MCP.refs(d, p.layers);
  for (var i = 1; i < ls.length; i++) ls[0].link(ls[i]);
  return { linked: MCP.map(ls, function (l) { return l.id; }) };
};

MCP.ops["layer.rasterize"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  l.rasterize(RasterizeType.ENTIRELAYER);
  return MCP.layerOut(l);
};

MCP.ops["layer.smartObject"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  if (MCP.kindOf(l) === "smartObject") return MCP.layerOut(l);
  MCP.ensureNotBackground(l);
  MCP.selectLayer(l);
  var oldId = l.id;
  MCP.play({ _obj: "newPlacedLayer" }, "convert to smart object");
  MCP.warn("Layer id changed from " + oldId + " to " + d.activeLayer.id + " (Photoshop creates a new layer for the smart object).");
  return MCP.layerOut(d.activeLayer);
};

MCP.ops["layer.clip"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  l.grouped = p.release !== true;
  return MCP.layerOut(l);
};

MCP.ops["layer.replaceContents"] = function (p) {
  var l = MCP.getLayer(MCP.getDoc(p.doc), p.layer);
  if (MCP.kindOf(l) !== "smartObject") MCP.fail("VALIDATION_ERROR", "\"" + l.name + "\" is not a smart object");
  MCP.selectLayer(l);
  MCP.play({ _obj: "placedLayerReplaceContents", "null": { _path: p.path } }, "replace contents");
  var out = MCP.layerOut(app.activeDocument.activeLayer);
  out.path = p.path;
  return out;
};

MCP.ops["layer.fill"] = function (p) {
  var d = MCP.getDoc(p.doc), l = MCP.getLayer(d, p.layer);
  d.activeLayer = l;
  d.selection.selectAll();
  d.selection.fill(MCP.solid(p.color));
  d.selection.deselect();
  return MCP.layerOut(l);
};
