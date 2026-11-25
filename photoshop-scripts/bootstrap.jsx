/*
 * Photoshop AI MCP - ExtendScript bootstrap (ES3).
 *
 * The Node bridge concatenates this file with the operation modules and appends a call to
 * MCP.main(command, resultPath). Only operations registered in MCP.ops can run; there is no
 * code path that evaluates client-provided source.
 *
 * Coordinates received from Node: document pixels, origin top-left, y grows DOWN (Photoshop's own convention).
 * Action Manager descriptors are written in the same JSON form as UXP batchPlay ({_obj, _target, _unit, _enum, _ref})
 * and converted to ActionDescriptor by MCP.toDesc, so descriptors can be recorded with "Copy as JavaScript".
 */
var MCP = MCP || {};
MCP.ops = {};
MCP.warnings = [];

/* ---------------- JSON (ExtendScript has no native JSON) ---------------- */
MCP.quote = function (s) {
  var out = '"';
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i), code = s.charCodeAt(i);
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (code < 32 || code > 126) {
      var h = code.toString(16);
      while (h.length < 4) h = "0" + h;
      out += "\\u" + h;
    } else out += c;
  }
  return out + '"';
};

MCP.stringify = function (v) {
  if (v === null || v === undefined) return "null";
  var t = typeof v;
  if (t === "number") return isFinite(v) ? String(Math.round(v * 10000) / 10000) : "null";
  if (t === "boolean") return v ? "true" : "false";
  if (t === "string") return MCP.quote(v);
  if (v instanceof Array) {
    var parts = [];
    for (var i = 0; i < v.length; i++) parts.push(MCP.stringify(v[i]));
    return "[" + parts.join(",") + "]";
  }
  if (t === "object") {
    var props = [];
    for (var k in v) {
      if (v.hasOwnProperty(k) && typeof v[k] !== "function" && v[k] !== undefined) props.push(MCP.quote(k) + ":" + MCP.stringify(v[k]));
    }
    return "{" + props.join(",") + "}";
  }
  return MCP.quote(String(v));
};

/* ---------------- small ES3 helpers ---------------- */
MCP.each = function (arr, fn) { for (var i = 0; i < arr.length; i++) fn(arr[i], i); };
MCP.map = function (arr, fn) { var o = []; for (var i = 0; i < arr.length; i++) o.push(fn(arr[i], i)); return o; };
MCP.contains = function (arr, v) { for (var i = 0; i < arr.length; i++) if (arr[i] === v) return true; return false; };
MCP.def = function (v, d) { return v === undefined || v === null ? d : v; };

/* ---------------- errors ---------------- */
MCP.fail = function (code, message, details) {
  var e = new Error(message);
  e.mcpCode = code;
  e.mcpDetails = details;
  throw e;
};
MCP.warn = function (msg) { MCP.warnings.push(msg); };

/* ---------------- Action Manager <-> JSON ---------------- */
/* Keys without a string ID round-trip as "#XXXX" char IDs. */
MCP.sID = function (s) { return s.charAt(0) === "#" ? charIDToTypeID(s.substr(1)) : stringIDToTypeID(s); };
MCP.tID = function (id) { var s = ""; try { s = typeIDToStringID(id); } catch (e) { s = ""; } return s ? s : "#" + typeIDToCharID(id); };

MCP.toRef = function (items) {
  var ref = new ActionReference();
  if (!(items instanceof Array)) items = [items];
  for (var i = 0; i < items.length; i++) {
    var r = items[i];
    if (r._ref === undefined && r._property !== undefined) { ref.putProperty(MCP.sID("property"), MCP.sID(r._property)); continue; }
    var cls = MCP.sID(r._ref);
    if (r._id !== undefined) ref.putIdentifier(cls, r._id);
    else if (r._index !== undefined) ref.putIndex(cls, r._index);
    else if (r._name !== undefined) ref.putName(cls, r._name);
    else if (r._enum !== undefined) ref.putEnumerated(cls, MCP.sID(r._enum), MCP.sID(r._value));
    else if (r._property !== undefined) ref.putProperty(cls, MCP.sID(r._property));
    else ref.putClass(cls);
  }
  return ref;
};

/* Put one JSON value into an ActionDescriptor (key given) or ActionList (key null). */
MCP.putValue = function (target, key, v) {
  var isList = key === null;
  function call(name) {
    var args = Array.prototype.slice.call(arguments, 1);
    if (isList) return target[name].apply(target, args);
    return target[name].apply(target, [key].concat(args));
  }
  if (v === null || v === undefined) return;
  if (typeof v === "boolean") return call("putBoolean", v);
  if (typeof v === "number") return Math.round(v) === v && Math.abs(v) < 2147483647 ? call("putInteger", v) : call("putDouble", v);
  if (typeof v === "string") return call("putString", v);
  if (v instanceof Array) {
    var list = new ActionList();
    for (var i = 0; i < v.length; i++) MCP.putValue(list, null, v[i]);
    return call("putList", list);
  }
  if (v._unit !== undefined) return call("putUnitDouble", MCP.sID(v._unit), v._value);
  if (v._enum !== undefined && v._ref === undefined) return call("putEnumerated", MCP.sID(v._enum), MCP.sID(v._value));
  if (v._path !== undefined) return call("putPath", new File(v._path));
  if (v._ref !== undefined) return call("putReference", MCP.toRef(v._ref instanceof Array ? v._ref : v));
  if (v._class !== undefined && v._obj === undefined) return call("putClass", MCP.sID(v._class));
  if (v._obj !== undefined) return call("putObject", MCP.sID(v._obj), MCP.toDesc(v));
  return call("putObject", MCP.sID("object"), MCP.toDesc(v));
};

MCP.toDesc = function (obj) {
  var d = new ActionDescriptor();
  for (var k in obj) {
    if (!obj.hasOwnProperty(k) || k === "_obj" || k === "_target" || k === "_isCommand") continue;
    MCP.putValue(d, MCP.sID(k), obj[k]);
  }
  if (obj._target) d.putReference(MCP.sID("null"), MCP.toRef(obj._target));
  return d;
};

MCP.fromDesc = function (d) {
  var out = {};
  for (var i = 0; i < d.count; i++) {
    var k = d.getKey(i);
    out[MCP.tID(k)] = MCP.readValue(d, k);
  }
  return out;
};

MCP.readValue = function (src, key) {
  var t = src.getType(key);
  switch (t) {
    case DescValueType.BOOLEANTYPE: return src.getBoolean(key);
    case DescValueType.INTEGERTYPE: return src.getInteger(key);
    case DescValueType.DOUBLETYPE: return src.getDouble(key);
    case DescValueType.LARGEINTEGERTYPE: return src.getLargeInteger(key);
    case DescValueType.STRINGTYPE: return src.getString(key);
    case DescValueType.UNITDOUBLE: return { _unit: MCP.tID(src.getUnitDoubleType(key)), _value: src.getUnitDoubleValue(key) };
    case DescValueType.ENUMERATEDTYPE: return { _enum: MCP.tID(src.getEnumerationType(key)), _value: MCP.tID(src.getEnumerationValue(key)) };
    case DescValueType.OBJECTTYPE: { var o = MCP.fromDesc(src.getObjectValue(key)); o._obj = MCP.tID(src.getObjectType(key)); return o; }
    case DescValueType.LISTTYPE: {
      var l = src.getList(key), arr = [];
      for (var j = 0; j < l.count; j++) arr.push(MCP.readValue(l, j));
      return arr;
    }
    case DescValueType.CLASSTYPE: return { _class: MCP.tID(src.getClass(key)) };
    case DescValueType.ALIASTYPE: try { return src.getPath(key).fsName; } catch (e) { return null; }
    default: return null;
  }
};

/** Execute a batchPlay-style descriptor through executeAction. */
MCP.play = function (obj, label) {
  try {
    var r = executeAction(MCP.sID(obj._obj), MCP.toDesc(obj), DialogModes.NO);
    return r ? MCP.fromDesc(r) : null;
  } catch (e) {
    MCP.fail("PHOTOSHOP_ERROR", (label || obj._obj) + ": " + String(e.message || e).replace(/^Error \d+: /, ""), { descriptor: obj._obj });
  }
};

/** executeActionGet for a property of a target, e.g. MCP.get("hasUserMask", [{_ref:"layer",_id:5}]). */
MCP.get = function (property, target) {
  var ref = new ActionReference();
  if (property) ref.putProperty(MCP.sID("property"), MCP.sID(property));
  var t = target instanceof Array ? target : [target];
  for (var i = 0; i < t.length; i++) {
    var r = t[i], cls = MCP.sID(r._ref);
    if (r._id !== undefined) ref.putIdentifier(cls, r._id);
    else if (r._index !== undefined) ref.putIndex(cls, r._index);
    else ref.putEnumerated(cls, MCP.sID("ordinal"), MCP.sID("targetEnum"));
  }
  var d = executeActionGet(ref);
  var all = MCP.fromDesc(d);
  return property ? all[property] : all;
};

MCP.px = function (v) { return { _unit: "pixelsUnit", _value: Number(v) }; };
MCP.pct = function (v) { return { _unit: "percentUnit", _value: Number(v) }; };
MCP.deg = function (v) { return { _unit: "angleUnit", _value: Number(v) }; };

/* ---------------- colors ---------------- */
MCP.hexToRgb = function (hex) {
  var h = String(hex).replace("#", "");
  if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
  return { r: parseInt(h.substr(0, 2), 16), g: parseInt(h.substr(2, 2), 16), b: parseInt(h.substr(4, 2), 16) };
};
MCP.toHex = function (r, g, b) {
  function c(v) { var s = Math.max(0, Math.min(255, Math.round(v))).toString(16); return s.length === 1 ? "0" + s : s; }
  return ("#" + c(r) + c(g) + c(b)).toUpperCase();
};
MCP.rgbDesc = function (hex) { var c = MCP.hexToRgb(hex); return { _obj: "RGBColor", red: c.r, grain: c.g, blue: c.b }; };
MCP.labDesc = function (hex) {
  var c = MCP.hexToRgb(hex);
  function lin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
  var R = lin(c.r), G = lin(c.g), B = lin(c.b);
  var X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : 7.787 * t + 16 / 116; }
  return { _obj: "labColor", luminance: 116 * f(Y) - 16, a: 500 * (f(X) - f(Y)), b: 200 * (f(Y) - f(Z)) };
};
MCP.solid = function (hex) {
  var c = MCP.hexToRgb(hex), s = new SolidColor();
  s.rgb.red = c.r; s.rgb.green = c.g; s.rgb.blue = c.b;
  return s;
};
MCP.solidHex = function (s) { try { return MCP.toHex(s.rgb.red, s.rgb.green, s.rgb.blue); } catch (e) { return undefined; } };

/** Gradient descriptor; stop locations 0-100 → 0-4096. */
MCP.gradientDesc = function (stops) {
  return {
    _obj: "gradientClassEvent", name: "Custom", gradientForm: { _enum: "gradientForm", _value: "customStops" }, interfaceIconFrameDimmed: 4096,
    colors: MCP.map(stops, function (s) { return { _obj: "colorStop", color: MCP.rgbDesc(s.color), type: { _enum: "colorStopType", _value: "userStop" }, location: Math.round(s.location / 100 * 4096), midpoint: 50 }; }),
    transparency: MCP.map(stops, function (s) { return { _obj: "transferSpec", opacity: MCP.pct(MCP.def(s.opacity, 100)), location: Math.round(s.location / 100 * 4096), midpoint: 50 }; })
  };
};

MCP.BLEND = {
  normal: "normal", dissolve: "dissolve", darken: "darken", multiply: "multiply", colorBurn: "colorBurn", linearBurn: "linearBurn",
  darkerColor: "darkerColor", lighten: "lighten", screen: "screen", colorDodge: "colorDodge", linearDodge: "linearDodge",
  lighterColor: "lighterColor", overlay: "overlay", softLight: "softLight", hardLight: "hardLight", vividLight: "vividLight",
  linearLight: "linearLight", pinLight: "pinLight", hardMix: "hardMix", difference: "difference", exclusion: "exclusion",
  subtract: "blendSubtraction", divide: "blendDivide", hue: "hue", saturation: "saturation", color: "color", luminosity: "luminosity"
};
MCP.blendEnum = function (m) { return { _enum: "blendMode", _value: MCP.BLEND[m] || "normal" }; };
MCP.DOM_BLEND = {
  normal: "NORMAL", dissolve: "DISSOLVE", darken: "DARKEN", multiply: "MULTIPLY", colorBurn: "COLORBURN", linearBurn: "LINEARBURN",
  darkerColor: "DARKERCOLOR", lighten: "LIGHTEN", screen: "SCREEN", colorDodge: "COLORDODGE", linearDodge: "LINEARDODGE",
  lighterColor: "LIGHTERCOLOR", overlay: "OVERLAY", softLight: "SOFTLIGHT", hardLight: "HARDLIGHT", vividLight: "VIVIDLIGHT",
  linearLight: "LINEARLIGHT", pinLight: "PINLIGHT", hardMix: "HARDMIX", difference: "DIFFERENCE", exclusion: "EXCLUSION",
  subtract: "SUBTRACT", divide: "DIVIDE", hue: "HUE", saturation: "SATURATION", color: "COLORBLEND", luminosity: "LUMINOSITY"
};
MCP.setBlend = function (layer, m) {
  if (!m) return;
  if (!MCP.DOM_BLEND[m]) MCP.fail("VALIDATION_ERROR", "Unknown blend mode " + m);
  layer.blendMode = BlendMode[MCP.DOM_BLEND[m]];
};
MCP.blendName = function (bm) {
  var s = String(bm).replace("BlendMode.", "");
  for (var k in MCP.DOM_BLEND) if (MCP.DOM_BLEND[k] === s) return k;
  return s.toLowerCase();
};

/* ---------------- documents / layers ---------------- */
MCP.getDoc = function (ref) {
  if (app.documents.length === 0) MCP.fail("NO_ACTIVE_DOCUMENT", "No document is open in Photoshop");
  if (!ref) return app.activeDocument;
  for (var i = 0; i < app.documents.length; i++) {
    var d = app.documents[i];
    if ((ref.id !== undefined && d.id === ref.id) || (ref.name !== undefined && d.name === ref.name)) {
      if (app.activeDocument !== d) app.activeDocument = d;
      return d;
    }
  }
  MCP.fail("DOCUMENT_NOT_FOUND", "Document not found: " + MCP.stringify(ref));
};

MCP.allLayers = function (container, out) {
  out = out || [];
  for (var i = 0; i < container.layers.length; i++) {
    var l = container.layers[i];
    out.push(l);
    if (l.typename === "LayerSet") MCP.allLayers(l, out);
  }
  return out;
};

MCP.targetIds = function (d) {
  try {
    var ids = MCP.get("targetLayersIDs", { _ref: "document", _id: d.id });
    var out = [];
    for (var i = 0; i < ids.length; i++) out.push(ids[i]._id !== undefined ? ids[i]._id : ids[i]);
    if (out.length) return out;
  } catch (e) { /* older versions */ }
  try { return [d.activeLayer.id]; } catch (e2) { return []; }
};

MCP.getLayer = function (d, ref) {
  if (!ref) {
    try { return d.activeLayer; } catch (e) { MCP.fail("LAYER_NOT_FOUND", "No active layer"); }
  }
  var all = MCP.allLayers(d);
  for (var i = 0; i < all.length; i++) {
    if ((ref.id !== undefined && all[i].id === ref.id) || (ref.name !== undefined && all[i].name === ref.name)) return all[i];
  }
  MCP.fail("LAYER_NOT_FOUND", "Layer not found: " + MCP.stringify(ref));
};

MCP.selectLayer = function (l) {
  MCP.play({ _obj: "select", _target: [{ _ref: "layer", _id: l.id }], makeVisible: false }, "select layer");
  return app.activeDocument.activeLayer;
};

MCP.selectLayers = function (layers) {
  for (var i = 0; i < layers.length; i++) {
    var o = { _obj: "select", _target: [{ _ref: "layer", _id: layers[i].id }], makeVisible: false };
    if (i > 0) o.selectionModifier = { _enum: "selectionModifierType", _value: "addToSelection" };
    MCP.play(o, "select layers");
  }
};

MCP.ensureNotBackground = function (l) {
  if (l.typename === "ArtLayer" && l.isBackgroundLayer) l.isBackgroundLayer = false;
};

MCP.layerProp = function (id, prop) {
  try { return MCP.get(prop, { _ref: "layer", _id: id }); } catch (e) { return undefined; }
};

MCP.boundsOf = function (b) {
  function v(x) { return typeof x === "number" ? x : x && x._value !== undefined ? x._value : Number(String(x).replace(/[^\d.\-]/g, "")); }
  var left = v(b[0] !== undefined ? b[0] : b.left), top = v(b[1] !== undefined ? b[1] : b.top), right = v(b[2] !== undefined ? b[2] : b.right), bottom = v(b[3] !== undefined ? b[3] : b.bottom);
  return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
};

MCP.KIND = {
  "LayerKind.NORMAL": "pixel", "LayerKind.TEXT": "text", "LayerKind.SMARTOBJECT": "smartObject", "LayerKind.SOLIDFILL": "solidColor",
  "LayerKind.GRADIENTFILL": "gradientFill", "LayerKind.PATTERNFILL": "patternFill", "LayerKind.VIDEO": "video", "LayerKind.LAYER3D": "3d"
};
MCP.kindOf = function (l) {
  if (l.typename === "LayerSet") return "group";
  if (l.isBackgroundLayer) return "background";
  var k = String(l.kind);
  if (MCP.KIND[k]) {
    if (k === "LayerKind.SOLIDFILL" || k === "LayerKind.GRADIENTFILL") { if (MCP.layerProp(l.id, "hasVectorMask")) return "shape"; }
    return MCP.KIND[k];
  }
  return "adjustment";
};

/* Text size/leading: Photoshop converts px via 72 ppi, so pass points scaled by the document resolution. */
MCP.textPt = function (px, d) { return UnitValue(px * 72 / (d || app.activeDocument).resolution, "pt"); };
MCP.textPx = function (uv, d) { return (uv.as ? uv.as("pt") : Number(uv)) * (d || app.activeDocument).resolution / 72; };

MCP.fontExists = function (ps) { try { app.fonts.getByName(ps); return true; } catch (e) { return false; } };

MCP.layerInfo = function (l, deep) {
  var info = {
    id: l.id, name: l.name, kind: MCP.kindOf(l), visible: l.visible, opacity: Math.round(l.opacity * 100) / 100,
    fillOpacity: l.typename === "ArtLayer" ? l.fillOpacity : 100, blendMode: MCP.blendName(l.blendMode), locked: l.allLocked,
    isBackground: l.typename === "ArtLayer" && l.isBackgroundLayer, bounds: MCP.boundsOf(l.bounds),
    parentId: l.parent && l.parent.typename === "LayerSet" ? l.parent.id : undefined
  };
  if (l.typename === "ArtLayer") info.isClippingMask = l.grouped;
  if (info.kind === "shape" || info.kind === "solidColor") {
    try { var adj = MCP.layerProp(l.id, "adjustment"); var c = adj && adj[0] && adj[0].color; if (c && c.red !== undefined) info.fill = MCP.toHex(c.red, c.grain, c.blue); } catch (eF) { /* gradient or pattern */ }
  }
  if (info.kind === "text") {
    try {
      var t = l.textItem;
      info.text = { contents: t.contents, font: t.font, size: Math.round(MCP.textPx(t.size) * 100) / 100, color: MCP.solidHex(t.color), alignment: String(t.justification).replace("Justification.", "").toLowerCase(), fontAvailable: MCP.fontExists(t.font) };
      try { info.text.tracking = t.tracking; } catch (e1) { /* unset */ }
    } catch (e) { info.text = { error: String(e.message || e) }; }
  }
  if (deep) {
    info.hasMask = Boolean(MCP.layerProp(l.id, "hasUserMask"));
    info.hasVectorMask = Boolean(MCP.layerProp(l.id, "hasVectorMask"));
    var fx = MCP.layerProp(l.id, "layerEffects");
    info.effects = [];
    if (fx) for (var k in fx) {
      if (!fx.hasOwnProperty(k) || k === "_obj" || k === "scale" || k === "masterFXSwitch") continue;
      var nm = k.replace(/Multi$/, "");
      if (!MCP.contains(info.effects, nm)) info.effects.push(nm);
    }
  }
  return info;
};

MCP.selectionBounds = function (d) {
  try { return MCP.boundsOf(d.selection.bounds); } catch (e) { return null; }
};

MCP.tempFile = function (ext) {
  return new File(Folder.temp.fsName + "/psmcp-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1e6) + "." + ext);
};

/* ---------------- dispatcher ---------------- */
MCP.writeResult = function (path, text) {
  if (!path) return;
  var f = new File(path);
  f.encoding = "UTF-8";
  f.open("w");
  f.write(text);
  f.close();
};

MCP.main = function (command, resultPath) {
  var out;
  var prefs = app.preferences, prevRuler = prefs.rulerUnits, prevType = prefs.typeUnits, prevDialogs = app.displayDialogs;
  MCP.warnings = [];
  try {
    prefs.rulerUnits = Units.PIXELS;
    prefs.typeUnits = TypeUnits.PIXELS;
    app.displayDialogs = DialogModes.NO;
    var fn = MCP.ops[command.op];
    if (!fn) MCP.fail("UNSUPPORTED_OPERATION", "Operation is not allowlisted: " + command.op);
    var data = fn(command.args || {});
    out = { ok: true, data: data === undefined ? null : data, warnings: MCP.warnings };
  } catch (e) {
    out = { ok: false, error: { code: e.mcpCode || "PHOTOSHOP_ERROR", message: String(e.message || e), line: e.line, details: e.mcpDetails }, warnings: MCP.warnings };
  }
  try { if (app.documents.length) out.document = app.activeDocument.name; } catch (e3) { /* no document */ }
  try { prefs.rulerUnits = prevRuler; prefs.typeUnits = prevType; app.displayDialogs = prevDialogs; } catch (e2) { /* ignore */ }
  var text = MCP.stringify(out);
  MCP.writeResult(resultPath, text);
  return text;
};
