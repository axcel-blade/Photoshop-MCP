/* Documents: create, open, save, export, resize, mode, crop, rotate, flip. */

MCP.docInfo = function (d) {
  var path;
  try { path = d.fullName.fsName; } catch (e) { path = undefined; }
  var bits = { "BitsPerChannelType.ONE": 1, "BitsPerChannelType.EIGHT": 8, "BitsPerChannelType.SIXTEEN": 16, "BitsPerChannelType.THIRTYTWO": 32 }[String(d.bitsPerChannel)];
  var mode = String(d.mode).replace("DocumentMode.", "").toLowerCase();
  return {
    id: d.id, name: d.name, path: path, width: Math.round(d.width.as("px")), height: Math.round(d.height.as("px")), resolution: d.resolution,
    mode: mode, bitDepth: bits, saved: d.saved, layerCount: MCP.allLayers(d).length, activeLayerIds: MCP.targetIds(d),
    active: app.activeDocument === d
  };
};

MCP.MODES = { rgb: "RGB", cmyk: "CMYK", grayscale: "GRAYSCALE", lab: "LAB", bitmap: "BITMAP" };
MCP.CHANGE = { rgb: "RGB", cmyk: "CMYK", grayscale: "GRAYSCALE", lab: "LAB", bitmap: "BITMAP", indexed: "INDEXEDCOLOR" };
MCP.ANCHOR = { topLeft: "TOPLEFT", top: "TOPCENTER", topRight: "TOPRIGHT", left: "MIDDLELEFT", center: "MIDDLECENTER", right: "MIDDLERIGHT", bottomLeft: "BOTTOMLEFT", bottom: "BOTTOMCENTER", bottomRight: "BOTTOMRIGHT" };
MCP.RESAMPLE = { bicubicAutomatic: "AUTOMATIC", bicubic: "BICUBIC", bicubicSharper: "BICUBICSHARPER", bicubicSmoother: "BICUBICSMOOTHER", bilinear: "BILINEAR", nearestNeighbor: "NEARESTNEIGHBOR", preserveDetails: "PRESERVEDETAILS", none: "NONE" };

MCP.resample = function (name) {
  var k = MCP.RESAMPLE[name || "bicubicAutomatic"];
  try { return ResampleMethod[k]; } catch (e) { return ResampleMethod.BICUBIC; }
};

MCP.saveTo = function (d, path, format, p, asCopy) {
  var f = new File(path);
  switch (format) {
    case "psd": { var o = new PhotoshopSaveOptions(); o.embedColorProfile = true; o.layers = true; d.saveAs(f, o, asCopy, Extension.LOWERCASE); break; }
    case "png": { var pn = new PNGSaveOptions(); pn.compression = MCP.def(p.compression, 6); pn.interlaced = Boolean(p.interlaced); d.saveAs(f, pn, asCopy, Extension.LOWERCASE); break; }
    case "jpg": { var j = new JPEGSaveOptions(); j.quality = Math.max(0, Math.min(12, Math.round(MCP.def(p.quality, 10)))); j.embedColorProfile = true; j.formatOptions = FormatOptions.STANDARDBASELINE; d.saveAs(f, j, asCopy, Extension.LOWERCASE); break; }
    case "tiff": {
      var t = new TiffSaveOptions();
      t.imageCompression = { none: TIFFEncoding.NONE, lzw: TIFFEncoding.TIFFLZW, zip: TIFFEncoding.TIFFZIP, jpeg: TIFFEncoding.JPEG }[p.compression || "lzw"];
      t.layers = true; t.embedColorProfile = true;
      d.saveAs(f, t, asCopy, Extension.LOWERCASE); break;
    }
    case "pdf": { var pd = new PDFSaveOptions(); pd.preserveEditing = Boolean(p.preserveEditing); pd.embedColorProfile = true; d.saveAs(f, pd, asCopy, Extension.LOWERCASE); break; }
    case "gif": { var g = new GIFSaveOptions(); d.saveAs(f, g, asCopy, Extension.LOWERCASE); break; }
    case "bmp": { var b = new BMPSaveOptions(); d.saveAs(f, b, asCopy, Extension.LOWERCASE); break; }
    case "psb":
      MCP.play({ _obj: "save", as: { _obj: "largeDocumentFormat", maximizeCompatibility: true }, "in": { _path: f.fsName }, documentID: d.id, copy: asCopy, lowerCase: true }, "save PSB");
      break;
    case "webp":
      MCP.play({ _obj: "save", as: { _obj: "WebPFormat", compression: { _enum: "WebPCompression", _value: p.lossless ? "compressionLossless" : "compressionLossy" }, quality: Math.round(MCP.def(p.quality, 85)), includeXMPData: false, includeEXIFData: false, includePsExtras: false }, "in": { _path: f.fsName }, documentID: d.id, copy: asCopy, lowerCase: true }, "save WebP");
      break;
    default: MCP.fail("VALIDATION_ERROR", "Unsupported format " + format);
  }
};

MCP.ops["doc.list"] = function () {
  var out = [];
  for (var i = 0; i < app.documents.length; i++) out.push(MCP.docInfo(app.documents[i]));
  return { documents: out };
};

MCP.ops["doc.info"] = function (p) {
  var d = MCP.getDoc(p.doc);
  return { document: MCP.docInfo(d), selection: MCP.selectionBounds(d) };
};

MCP.ops["doc.create"] = function (p) {
  var fill = { white: DocumentFill.WHITE, transparent: DocumentFill.TRANSPARENT, backgroundColor: DocumentFill.BACKGROUNDCOLOR }[p.background] || DocumentFill.WHITE;
  var bits = { 8: BitsPerChannelType.EIGHT, 16: BitsPerChannelType.SIXTEEN, 32: BitsPerChannelType.THIRTYTWO }[p.bitDepth || 8];
  var mode = NewDocumentMode[MCP.MODES[p.mode || "rgb"]];
  var d = app.documents.add(UnitValue(p.width, "px"), UnitValue(p.height, "px"), p.resolution || 72, p.name || "Untitled", mode, fill, 1, bits);
  if (p.background === "black") {
    d.selection.selectAll();
    d.selection.fill(MCP.solid("#000000"));
    d.selection.deselect();
  }
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.open"] = function (p) {
  var f = new File(p.path);
  if (!f.exists) MCP.fail("FILE_NOT_FOUND", "File not found: " + p.path);
  var d = app.open(f);
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.activate"] = function (p) {
  var d = MCP.getDoc(p.doc);
  app.activeDocument = d;
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.close"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var id = d.id;
  if (p.save === "yes" && !d.saved) {
    var has = true;
    try { d.fullName; } catch (e) { has = false; }
    if (!has) MCP.fail("PHOTOSHOP_ERROR", "Document has never been saved; use save_document_as first, or close with save: 'no'");
    d.save();
  }
  d.close(SaveOptions.DONOTSAVECHANGES);
  return { closed: id, saved: p.save === "yes" };
};

MCP.ops["doc.save"] = function (p) {
  var d = MCP.getDoc(p.doc), path;
  try { path = d.fullName.fsName; } catch (e) { MCP.fail("PHOTOSHOP_ERROR", "Document has never been saved; use save_document_as"); }
  d.save();
  return { path: path };
};

MCP.ops["doc.saveAs"] = function (p) {
  var src = MCP.getDoc(p.doc), d = src, temp = null;
  var needsRgb = MCP.contains(["png", "webp", "gif", "bmp"], p.format) && d.mode !== DocumentMode.RGB && d.mode !== DocumentMode.GRAYSCALE && d.mode !== DocumentMode.INDEXEDCOLOR;
  if (p.width || p.height || p.convertToSRGB || needsRgb) {
    /* Work on a merged duplicate so the user's document is untouched. */
    temp = src.duplicate(src.name.replace(/\.[^.]+$/, "") + "-export", true);
    d = temp;
    if (p.width || p.height) {
      var w0 = d.width.as("px"), h0 = d.height.as("px");
      var w = p.width || Math.round(w0 * p.height / h0), h = p.height || Math.round(h0 * p.width / w0);
      d.resizeImage(UnitValue(w, "px"), UnitValue(h, "px"), undefined, ResampleMethod.BICUBIC);
    }
    if (needsRgb) { d.changeMode(ChangeMode.RGB); MCP.warn("Exported from an RGB copy: " + p.format.toUpperCase() + " does not support the document color mode."); }
    if (p.convertToSRGB) { try { d.convertProfile("sRGB IEC61966-2.1", Intent.PERCEPTUAL, true, true); } catch (e) { MCP.warn("sRGB conversion skipped: " + e.message); } }
  }
  var outW = Math.round(d.width.as("px")), outH = Math.round(d.height.as("px"));
  try {
    MCP.saveTo(d, p.path, p.format, p, temp ? false : Boolean(p.asCopy));
  } finally {
    if (temp) temp.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = src;
  }
  if (!new File(p.path).exists) MCP.fail("PHOTOSHOP_ERROR", "Photoshop reported success but did not write " + p.path);
  return { path: p.path, format: p.format, asCopy: Boolean(p.asCopy), width: outW, height: outH };
};

MCP.ops["doc.resizeImage"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var W = d.width.as("px"), H = d.height.as("px"), w = p.width, h = p.height;
  if (p.percent) { w = Math.round(W * p.percent / 100); h = Math.round(H * p.percent / 100); }
  if (w && !h) h = Math.round(H * w / W);
  if (h && !w) w = Math.round(W * h / H);
  if (p.resample === "none") d.resizeImage(undefined, undefined, p.resolution || d.resolution, ResampleMethod.NONE);
  else d.resizeImage(w ? UnitValue(w, "px") : undefined, h ? UnitValue(h, "px") : undefined, p.resolution || undefined, MCP.resample(p.resample));
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.resizeCanvas"] = function (p) {
  var d = MCP.getDoc(p.doc);
  d.resizeCanvas(UnitValue(p.width, "px"), UnitValue(p.height, "px"), AnchorPosition[MCP.ANCHOR[p.anchor || "center"]]);
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.mode"] = function (p) {
  var d = MCP.getDoc(p.doc);
  d.changeMode(ChangeMode[MCP.CHANGE[p.mode]]);
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.bitDepth"] = function (p) {
  var d = MCP.getDoc(p.doc);
  d.bitsPerChannel = { 8: BitsPerChannelType.EIGHT, 16: BitsPerChannelType.SIXTEEN, 32: BitsPerChannelType.THIRTYTWO }[p.depth];
  return { document: MCP.docInfo(d) };
};

MCP.ops["doc.flatten"] = function (p) { var d = MCP.getDoc(p.doc); d.flatten(); return { document: MCP.docInfo(d) }; };
MCP.ops["doc.duplicate"] = function (p) { var d = MCP.getDoc(p.doc); var n = d.duplicate(p.name || (d.name + " copy"), Boolean(p.mergeLayers)); return { document: MCP.docInfo(n) }; };
MCP.ops["doc.crop"] = function (p) { var d = MCP.getDoc(p.doc), b = p.bounds; d.crop([UnitValue(b.left, "px"), UnitValue(b.top, "px"), UnitValue(b.right, "px"), UnitValue(b.bottom, "px")]); return { document: MCP.docInfo(d) }; };
MCP.ops["doc.rotate"] = function (p) { var d = MCP.getDoc(p.doc); d.rotateCanvas(p.angle); return { document: MCP.docInfo(d) }; };
MCP.ops["doc.flip"] = function (p) { var d = MCP.getDoc(p.doc); d.flipCanvas(p.direction === "vertical" ? Direction.VERTICAL : Direction.HORIZONTAL); return { document: MCP.docInfo(d) }; };
MCP.ops["doc.trim"] = function (p) { var d = MCP.getDoc(p.doc); d.trim(TrimType.TRANSPARENT, true, true, true, true); return { document: MCP.docInfo(d) }; };
