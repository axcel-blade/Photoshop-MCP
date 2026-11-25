/* Application info, history, previews, pixel samples for analysis, actions. */

MCP.ops["ps.info"] = function () {
  return { photoshopVersion: app.version, name: app.name, hostOs: $.os, scriptingVersion: $.version, documents: app.documents.length, activeDocumentId: app.documents.length ? app.activeDocument.id : null };
};

MCP.ops["ps.history"] = function (p) {
  var d = MCP.getDoc(p.doc), states = [], cur = -1;
  for (var i = 0; i < d.historyStates.length; i++) {
    var s = d.historyStates[i];
    states.push({ index: i, name: s.name, snapshot: s.snapshot });
    if (s === d.activeHistoryState) cur = i;
  }
  if (cur < 0) for (var j = 0; j < states.length; j++) if (d.historyStates[j].name === d.activeHistoryState.name) cur = j;
  return { states: states, current: cur };
};

MCP.stepHistory = function (p, dir) {
  var d = MCP.getDoc(p.doc), st = d.historyStates, i = -1;
  for (var k = 0; k < st.length; k++) if (st[k] === d.activeHistoryState) i = k;
  if (i < 0) MCP.fail("PHOTOSHOP_ERROR", "Could not locate the current history state");
  var t = Math.max(0, Math.min(st.length - 1, i + dir * (p.steps || 1)));
  d.activeHistoryState = st[t];
  return { current: t, state: st[t].name };
};
MCP.ops["ps.undo"] = function (p) { return MCP.stepHistory(p, -1); };
MCP.ops["ps.redo"] = function (p) { return MCP.stepHistory(p, 1); };

MCP.ops["ps.activeTool"] = function () {
  /* The current tool is the enumeration TYPE of the "tool" property. */
  var r = MCP.get("tool", { _ref: "application" });
  return { id: r && r._enum !== undefined ? r._enum : r };
};

/**
 * Render the composite (or one layer) of a merged duplicate to a temp file. Node reads the file,
 * converts it (base64 preview or decoded pixel statistics) and deletes it.
 */
MCP.renderTemp = function (d, layerRef, maxSize, format) {
  var src = d, tmp;
  if (layerRef) {
    var l = MCP.getLayer(d, layerRef);
    tmp = app.documents.add(d.width, d.height, d.resolution, "psmcp-render", NewDocumentMode.RGB, DocumentFill.TRANSPARENT);
    app.activeDocument = src;
    l.duplicate(tmp, ElementPlacement.PLACEATBEGINNING);
    app.activeDocument = tmp;
  } else {
    tmp = src.duplicate("psmcp-render", true);
  }
  try {
    if (tmp.mode !== DocumentMode.RGB) tmp.changeMode(ChangeMode.RGB);
    if (tmp.bitsPerChannel !== BitsPerChannelType.EIGHT) tmp.bitsPerChannel = BitsPerChannelType.EIGHT;
    var W = tmp.width.as("px"), H = tmp.height.as("px"), s = Math.min(1, maxSize / Math.max(W, H));
    if (s < 1) tmp.resizeImage(UnitValue(Math.max(1, Math.round(W * s)), "px"), UnitValue(Math.max(1, Math.round(H * s)), "px"), undefined, ResampleMethod.BICUBIC);
    var w = Math.round(tmp.width.as("px")), h = Math.round(tmp.height.as("px"));
    var f = MCP.tempFile(format === "png" ? "png" : "jpg");
    if (format === "png") { var o = new PNGSaveOptions(); o.compression = 1; tmp.saveAs(f, o, true, Extension.LOWERCASE); }
    else { var j = new JPEGSaveOptions(); j.quality = 9; j.embedColorProfile = false; tmp.saveAs(f, j, true, Extension.LOWERCASE); }
    return { file: f.fsName, width: w, height: h, sourceWidth: Math.round(src.width.as("px")), sourceHeight: Math.round(src.height.as("px")) };
  } finally {
    tmp.close(SaveOptions.DONOTSAVECHANGES);
    app.activeDocument = src;
  }
};

MCP.ops["ps.preview"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var r = MCP.renderTemp(d, p.layer, p.maxSize || 1024, p.format === "png" ? "png" : "jpeg");
  return { previewFile: r.file, mimeType: p.format === "png" ? "image/png" : "image/jpeg", width: r.width, height: r.height, sourceWidth: r.sourceWidth, sourceHeight: r.sourceHeight };
};

MCP.ops["ps.analyze"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var r = MCP.renderTemp(d, p.layer, p.sampleSize || 256, "png");
  return { analyzeFile: r.file, width: r.width, height: r.height };
};

MCP.ops["doc.colors"] = function (p) {
  var d = MCP.getDoc(p.doc);
  var r = MCP.renderTemp(d, null, 200, "png");
  return { analyzeFile: r.file, width: r.width, height: r.height, colorsCount: p.count || 8 };
};

/* Actions panel via Action Manager (ExtendScript has no action tree DOM). */
MCP.ops["action.list"] = function () {
  var sets = [];
  for (var i = 1; i < 1000; i++) {
    var setDesc;
    try {
      var ref = new ActionReference();
      ref.putIndex(MCP.sID("actionSet"), i);
      setDesc = executeActionGet(ref);
    } catch (e) { break; }
    var name = setDesc.getString(MCP.sID("name")), n = setDesc.hasKey(MCP.sID("numberOfChildren")) ? setDesc.getInteger(MCP.sID("numberOfChildren")) : 0;
    var actions = [];
    for (var j = 1; j <= n; j++) {
      var r2 = new ActionReference();
      r2.putIndex(MCP.sID("action"), j);
      r2.putIndex(MCP.sID("actionSet"), i);
      actions.push(executeActionGet(r2).getString(MCP.sID("name")));
    }
    sets.push({ name: name, actions: actions });
  }
  return { sets: sets };
};

MCP.ops["action.run"] = function (p) {
  var sets = MCP.ops["action.list"]().sets, found = false;
  for (var i = 0; i < sets.length; i++) if (sets[i].name === p.set) { if (!MCP.contains(sets[i].actions, p.action)) MCP.fail("VALIDATION_ERROR", "Action not found: " + p.set + " / " + p.action); found = true; }
  if (!found) MCP.fail("VALIDATION_ERROR", "Action set not found: " + p.set);
  app.doAction(p.action, p.set);
  return { played: { set: p.set, action: p.action } };
};
