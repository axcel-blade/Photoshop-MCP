import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { PsMcpError } from "../../utils/errors.js";
import { encodePng } from "../../utils/png.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BridgeAdapter, DetectionResult, ExecuteRequest, ScriptEnvelope } from "./types.js";

interface MLayer {
  id: number; name: string; kind: string; visible: boolean; opacity: number; fillOpacity: number; blendMode: string;
  locked: boolean; bounds: { left: number; top: number; right: number; bottom: number }; parentId?: number;
  hasMask?: boolean; hasVectorMask?: boolean; clipped?: boolean; effects?: Record<string, unknown>;
  text?: { contents: string; font: string; size: number; color: string; alignment: string; tracking: number; leading?: number };
  linkedTo?: number[];
}
interface MDoc {
  id: number; name: string; path?: string; width: number; height: number; resolution: number; mode: string;
  bitDepth: number; saved: boolean; layers: MLayer[]; active: number[]; selection?: { left: number; top: number; right: number; bottom: number };
  history: string[]; historyIndex: number;
}

/**
 * In-memory stand-in for Photoshop used by automated tests and demos (PHOTOSHOP_ADAPTER=mock).
 * It keeps a document/layer model so tool chains behave realistically, writes placeholder files for saves/exports,
 * and answers with the same JSON envelope as bootstrap.jsx. Every result produced through it is labelled
 * source: "mock", so it can never be mistaken for real Photoshop output.
 */
export class MockAdapter implements BridgeAdapter {
  readonly name = "mock" as const;
  private docs: MDoc[] = [];
  private activeDoc?: number;
  private nextId = 1;
  readonly calls: { command: string; params: Record<string, unknown> }[] = [];
  /** Test hooks */
  failNext?: { command: string; code: string; message: string };
  delayMs = 0;

  async detect(): Promise<DetectionResult> {
    return { platform: process.platform, installs: [], comRegistered: false, automationAvailable: true, running: true, notes: ["Mock adapter: no Photoshop is used."] };
  }

  async execute(req: ExecuteRequest): Promise<string> {
    const params = (req.args ?? {}) as Record<string, unknown>;
    this.calls.push({ command: req.op, params });
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    let env: ScriptEnvelope;
    if (this.failNext && this.failNext.command === req.op) {
      const f = this.failNext;
      this.failNext = undefined;
      env = { ok: false, error: { code: f.code, message: f.message } };
    } else {
      try {
        env = { ok: true, data: this.handle(req.op, params), warnings: [] };
      } catch (e) {
        const err = e as PsMcpError;
        env = { ok: false, error: { code: err.code ?? "PHOTOSHOP_SCRIPT_ERROR", message: err.message } };
      }
    }
    const active = this.docs.find((d) => d.id === this.activeDoc);
    if (active) env.document = active.name;
    return JSON.stringify(env);
  }

  /* ---------------- model helpers ---------------- */

  private doc(params: Record<string, unknown>): MDoc {
    const ref = params.doc as { id?: number; name?: string } | undefined;
    const d = ref ? this.docs.find((x) => x.id === ref.id || x.name === ref.name) : this.docs.find((x) => x.id === this.activeDoc);
    if (!d) throw new PsMcpError(ref ? "DOCUMENT_NOT_FOUND" : "NO_ACTIVE_DOCUMENT", ref ? "Document not found" : "No document is open in Photoshop");
    return d;
  }

  private layer(d: MDoc, ref: unknown): MLayer {
    const r = ref as { id?: number; name?: string } | undefined;
    const l = r ? d.layers.find((x) => x.id === r.id || x.name === r.name) : d.layers.find((x) => x.id === d.active[0]);
    if (!l) throw new PsMcpError("LAYER_NOT_FOUND", r ? `Layer not found: ${JSON.stringify(r)}` : "No active layer");
    return l;
  }

  private addLayer(d: MDoc, partial: Partial<MLayer> & { name: string; kind: string }): MLayer {
    const l: MLayer = {
      id: this.nextId++, visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", locked: false,
      bounds: { left: 0, top: 0, right: d.width, bottom: d.height }, ...partial,
    };
    d.layers.unshift(l);
    d.active = [l.id];
    this.hist(d, `New ${partial.kind}: ${partial.name}`);
    return l;
  }

  private hist(d: MDoc, name: string): void {
    d.history = d.history.slice(0, d.historyIndex + 1);
    d.history.push(name);
    d.historyIndex = d.history.length - 1;
    d.saved = false;
  }

  private out(l: MLayer) {
    const b = l.bounds;
    return { ...l, bounds: { ...b, width: b.right - b.left, height: b.bottom - b.top }, locked: l.locked };
  }

  private docInfo(d: MDoc) {
    return { id: d.id, name: d.name, path: d.path, width: d.width, height: d.height, resolution: d.resolution, mode: d.mode, bitDepth: d.bitDepth, saved: d.saved, layerCount: d.layers.length, activeLayerIds: d.active, active: d.id === this.activeDoc };
  }

  private newDoc(p: Record<string, unknown>): MDoc {
    const d: MDoc = {
      id: this.nextId++, name: String(p.name ?? `Untitled-${this.docs.length + 1}`), width: Number(p.width ?? 1000), height: Number(p.height ?? 1000),
      resolution: Number(p.resolution ?? 72), mode: String(p.mode ?? "rgb"), bitDepth: Number(p.bitDepth ?? 8), saved: false,
      layers: [], active: [], history: ["New document"], historyIndex: 0,
    };
    this.docs.push(d);
    this.activeDoc = d.id;
    if (p.background !== "transparent") this.addLayer(d, { name: "Background", kind: "background", locked: true });
    else this.addLayer(d, { name: "Layer 1", kind: "pixel" });
    return d;
  }

  private writePlaceholder(path: string, format: string, d: MDoc): void {
    mkdirSync(dirname(path), { recursive: true });
    const w = Math.max(1, Math.min(64, d.width)), h = Math.max(1, Math.min(64, d.height));
    const bytes = format === "png" ? encodePng(w, h, new Uint8Array(w * h * 4).fill(200), 4) : Buffer.from(`MOCK ${format.toUpperCase()} for ${d.name}\n`);
    writeFileSync(path, bytes);
  }

  /* ---------------- command dispatch ---------------- */

  private handle(command: string, p: Record<string, unknown>): unknown {
    switch (command) {
      case "ps.info":
        return { photoshopVersion: "mock", name: "Adobe Photoshop (mock)", scriptingVersion: "mock", hostOs: process.platform, documents: this.docs.length, activeDocumentId: this.activeDoc };
      case "doc.create":
        return { document: this.docInfo(this.newDoc(p)) };
      case "doc.open": {
        const path = String(p.path);
        const d = this.newDoc({ name: basename(path), width: 1600, height: 1200 });
        d.path = path;
        d.saved = true;
        return { document: this.docInfo(d) };
      }
      case "doc.list":
        return { documents: this.docs.map((d) => this.docInfo(d)) };
      case "doc.info": {
        const d = this.doc(p);
        return { document: this.docInfo(d), selection: d.selection ?? null };
      }
      case "doc.activate": {
        const d = this.doc(p);
        this.activeDoc = d.id;
        return { document: this.docInfo(d) };
      }
      case "doc.close": {
        const d = this.doc(p);
        this.docs = this.docs.filter((x) => x !== d);
        this.activeDoc = this.docs.at(-1)?.id;
        return { closed: d.id, saved: p.save === "yes" };
      }
      case "doc.save": {
        const d = this.doc(p);
        if (!d.path) throw new PsMcpError("PHOTOSHOP_ERROR", "Document has never been saved; use save_document_as");
        d.saved = true;
        this.writePlaceholder(d.path, "psd", d);
        return { path: d.path };
      }
      case "doc.saveAs": {
        const d = this.doc(p);
        const path = String(p.path);
        this.writePlaceholder(path, String(p.format), d);
        if (!p.asCopy) {
          d.path = path;
          d.name = basename(path);
          d.saved = true;
        }
        return { path, format: p.format, asCopy: Boolean(p.asCopy), width: p.width ?? d.width, height: p.height ?? d.height };
      }
      case "doc.resizeImage": {
        const d = this.doc(p);
        const pct = p.percent as number | undefined;
        const w = pct ? Math.round((d.width * pct) / 100) : (p.width as number | undefined);
        const h = pct ? Math.round((d.height * pct) / 100) : (p.height as number | undefined);
        const [ow, oh] = [d.width, d.height];
        d.width = w ?? Math.round((ow * (h ?? oh)) / oh);
        d.height = h ?? Math.round((oh * (w ?? ow)) / ow);
        if (p.resolution) d.resolution = Number(p.resolution);
        this.hist(d, "Image Size");
        return { document: this.docInfo(d) };
      }
      case "doc.resizeCanvas": {
        const d = this.doc(p);
        d.width = Number(p.width);
        d.height = Number(p.height);
        this.hist(d, "Canvas Size");
        return { document: this.docInfo(d) };
      }
      case "doc.mode": case "doc.bitDepth": case "doc.rotate": case "doc.flip": case "doc.trim": {
        const d = this.doc(p);
        if (command === "doc.mode") d.mode = String(p.mode);
        if (command === "doc.bitDepth") d.bitDepth = Number(p.depth);
        if (command === "doc.rotate" && Math.abs(Number(p.angle)) % 180 === 90) [d.width, d.height] = [d.height, d.width];
        this.hist(d, command);
        return { document: this.docInfo(d) };
      }
      case "doc.crop": {
        const d = this.doc(p);
        const b = p.bounds as MDoc["selection"];
        d.width = b!.right - b!.left;
        d.height = b!.bottom - b!.top;
        this.hist(d, "Crop");
        return { document: this.docInfo(d) };
      }
      case "doc.flatten": {
        const d = this.doc(p);
        d.layers = [];
        this.addLayer(d, { name: "Background", kind: "background", locked: true });
        return { document: this.docInfo(d) };
      }
      case "doc.duplicate": {
        const src = this.doc(p);
        const d = this.newDoc({ name: p.name ?? `${src.name} copy`, width: src.width, height: src.height, resolution: src.resolution });
        d.layers = src.layers.map((l) => ({ ...l, id: this.nextId++ }));
        return { document: this.docInfo(d) };
      }
      case "doc.colors":
        this.doc(p);
        return { analyzeFile: this.tempPng(16, 16), width: 16, height: 16, colorsCount: p.count ?? 8 };
      case "layer.list": {
        const d = this.doc(p);
        const layers = d.layers.filter((l) => !p.selectedOnly || d.active.includes(l.id)).map((l) => this.out(l));
        return { documentId: d.id, layers };
      }
      case "layer.info": case "layer.select": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        if (command === "layer.select") d.active = [l.id];
        return { layer: this.out(l) };
      }
      case "layer.create": {
        const d = this.doc(p);
        const l = this.addLayer(d, { name: String(p.name ?? `Layer ${d.layers.length}`), kind: p.kind === "group" ? "group" : "pixel", blendMode: String(p.blendMode ?? "normal"), opacity: Number(p.opacity ?? 100) });
        return { layer: this.out(l) };
      }
      case "layer.delete": {
        const d = this.doc(p);
        const ids = ((p.layers as unknown[] | undefined) ?? [p.layer]).map((r) => this.layer(d, r).id);
        d.layers = d.layers.filter((l) => !ids.includes(l.id));
        d.active = d.layers[0] ? [d.layers[0].id] : [];
        this.hist(d, "Delete Layer");
        return { deleted: ids };
      }
      case "layer.duplicate": case "layer.fromSelection": {
        const d = this.doc(p);
        const src = this.layer(d, p.layer);
        const kind = command === "layer.fromSelection" ? "pixel" : src.kind === "background" ? "pixel" : src.kind;
        const l = this.addLayer(d, { ...src, name: String(p.name ?? `${src.name} copy`), kind, locked: false });
        return { layer: this.out(l) };
      }
      case "layer.rename": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        l.name = String(p.name);
        return { layer: this.out(l) };
      }
      case "layer.translate": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        let dx = Number(p.dx ?? 0), dy = Number(p.dy ?? 0);
        if (p.x !== undefined) dx = Number(p.x) - l.bounds.left;
        if (p.y !== undefined) dy = Number(p.y) - l.bounds.top;
        l.bounds = { left: l.bounds.left + dx, top: l.bounds.top + dy, right: l.bounds.right + dx, bottom: l.bounds.bottom + dy };
        this.hist(d, "Move");
        return { layer: this.out(l) };
      }
      case "layer.translateMany": {
        const d = this.doc(p);
        const moved = (p.moves as { id: number; dx: number; dy: number }[]).map((m) => {
          const l = this.layer(d, { id: m.id });
          l.bounds = { left: l.bounds.left + m.dx, top: l.bounds.top + m.dy, right: l.bounds.right + m.dx, bottom: l.bounds.bottom + m.dy };
          return this.out(l);
        });
        this.hist(d, "Align");
        return { layers: moved };
      }
      case "layer.transform": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        const sx = Number(p.scaleX ?? p.scale ?? 100) / 100, sy = Number(p.scaleY ?? p.scale ?? 100) / 100;
        const w = (l.bounds.right - l.bounds.left) * sx, h = (l.bounds.bottom - l.bounds.top) * sy;
        l.bounds = { ...l.bounds, right: l.bounds.left + w, bottom: l.bounds.top + h };
        this.hist(d, "Transform");
        return { layer: this.out(l) };
      }
      case "layer.arrange": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        const i = d.layers.indexOf(l);
        d.layers.splice(i, 1);
        const pos = String(p.position);
        if (pos === "top") d.layers.unshift(l);
        else if (pos === "bottom") d.layers.push(l);
        else if (pos === "up") d.layers.splice(Math.max(0, i - 1), 0, l);
        else if (pos === "down") d.layers.splice(Math.min(d.layers.length, i + 1), 0, l);
        else {
          const rel = this.layer(d, p.relativeTo);
          const j = d.layers.indexOf(rel);
          d.layers.splice(pos === "above" ? j : j + 1, 0, l);
        }
        return { layer: this.out(l), order: d.layers.map((x) => x.id) };
      }
      case "layer.merge": case "layer.mergeVisible": {
        const d = this.doc(p);
        const targets = command === "layer.mergeVisible" ? d.layers.filter((l) => l.visible) : ((p.layers as unknown[]) ?? []).map((r) => this.layer(d, r));
        d.layers = d.layers.filter((l) => !targets.includes(l));
        const l = this.addLayer(d, { name: targets[0]?.name ?? "Merged", kind: "pixel" });
        return { layer: this.out(l) };
      }
      case "layer.group": {
        const d = this.doc(p);
        const members = ((p.layers as unknown[]) ?? []).map((r) => this.layer(d, r));
        const g = this.addLayer(d, { name: String(p.name ?? "Group"), kind: "group" });
        members.forEach((m) => (m.parentId = g.id));
        return { layer: this.out(g), members: members.map((m) => m.id) };
      }
      case "layer.ungroup": {
        const d = this.doc(p);
        const g = this.layer(d, p.layer);
        d.layers.filter((l) => l.parentId === g.id).forEach((l) => (l.parentId = undefined));
        d.layers = d.layers.filter((l) => l !== g);
        return { ungrouped: g.id };
      }
      case "layer.props": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        for (const k of ["visible", "opacity", "fillOpacity", "blendMode", "locked"] as const) if (p[k] !== undefined) (l as unknown as Record<string, unknown>)[k] = p[k];
        if (p.lock !== undefined) l.locked = p.lock !== "none";
        this.hist(d, "Layer Properties");
        return { layer: this.out(l) };
      }
      case "layer.link": {
        const d = this.doc(p);
        const ls = ((p.layers as unknown[]) ?? []).map((r) => this.layer(d, r));
        ls.forEach((l) => (l.linkedTo = ls.filter((x) => x !== l).map((x) => x.id)));
        return { linked: ls.map((l) => l.id) };
      }
      case "layer.rasterize": case "layer.smartObject": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        l.kind = command === "layer.rasterize" ? "pixel" : "smartObject";
        this.hist(d, command);
        return { layer: this.out(l) };
      }
      case "layer.effects": case "layer.clearEffects": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        l.effects = command === "layer.clearEffects" ? {} : { ...(l.effects ?? {}), ...(p.effects as object) };
        return { layer: this.out(l), effects: Object.keys(l.effects) };
      }
      case "layer.fill": case "edit.fillSelection": case "edit.contentAwareFill": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        if (command === "edit.contentAwareFill" && !d.selection) throw new PsMcpError("PHOTOSHOP_ERROR", "Content-Aware Fill needs an active selection");
        if (command === "edit.contentAwareFill" && l.kind !== "pixel" && l.kind !== "background") throw new PsMcpError("PHOTOSHOP_ERROR", `Content-Aware Fill needs a pixel layer; "${l.name}" is ${l.kind}`);
        this.hist(d, command);
        return { layer: this.out(l) };
      }
      case "layer.clip": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        l.clipped = p.release !== true;
        return { layer: this.out(l) };
      }
      case "layer.replaceContents": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        if (l.kind !== "smartObject") throw new PsMcpError("PHOTOSHOP_ERROR", "Replace Contents requires a smart object layer");
        return { layer: this.out(l), path: p.path };
      }
      case "text.create": {
        const d = this.doc(p);
        const size = Number(p.size ?? 48);
        const x = Number(p.x ?? 0), y = Number(p.y ?? 0);
        const contents = String(p.text);
        const w = contents.length * size * 0.55;
        const left = p.alignment === "center" ? x - w / 2 : p.alignment === "right" ? x - w : x;
        const l = this.addLayer(d, {
          name: String(p.name ?? contents.slice(0, 30)), kind: "text",
          bounds: { left, top: y - size * 0.8, right: left + w, bottom: y + size * 0.2 },
          text: { contents, font: String(p.font ?? "ArialMT"), size, color: String(p.color ?? "#000000"), alignment: String(p.alignment ?? "left"), tracking: Number(p.tracking ?? 0) },
        });
        return { layer: this.out(l), font: { requested: p.font ?? "ArialMT", used: p.font ?? "ArialMT", available: true } };
      }
      case "text.edit": {
        const d = this.doc(p);
        const targets = p.allTextLayers ? d.layers.filter((l) => l.kind === "text") : [this.layer(d, p.layer)];
        const changed: number[] = [];
        for (const l of targets) {
          if (l.kind !== "text" || !l.text) {
            if (!p.allTextLayers) throw new PsMcpError("PHOTOSHOP_ERROR", `Layer "${l.name}" is not a text layer`);
            continue;
          }
          if (p.find !== undefined) {
            if (!l.text.contents.includes(String(p.find))) continue;
            l.text.contents = l.text.contents.split(String(p.find)).join(String(p.replace ?? ""));
          }
          if (p.text !== undefined) l.text.contents = String(p.text);
          for (const k of ["font", "size", "color", "alignment", "tracking", "leading"] as const) if (p[k] !== undefined) (l.text as Record<string, unknown>)[k] = p[k];
          changed.push(l.id);
        }
        this.hist(d, "Edit Type");
        return { changed, layers: targets.filter((l) => changed.includes(l.id)).map((l) => this.out(l)) };
      }
      case "text.toShape": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        l.kind = "shape";
        return { layer: this.out(l) };
      }
      case "shape.rect": case "shape.ellipse": case "shape.polygon": case "fill.solid": case "fill.gradient": {
        const d = this.doc(p);
        const b = (p.bounds as MLayer["bounds"]) ?? (p.points ? this.pointsBounds(p.points as { x: number; y: number }[]) : { left: 0, top: 0, right: d.width, bottom: d.height });
        const kind = command.startsWith("fill.") ? (command === "fill.solid" ? "solidColor" : "gradientFill") : "shape";
        const l = this.addLayer(d, { name: String(p.name ?? kind), kind, bounds: b, opacity: Number(p.opacity ?? 100) });
        return { layer: this.out(l) };
      }
      case "shape.edit": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        if (!["shape", "solidColor", "gradientFill"].includes(l.kind)) throw new PsMcpError("PHOTOSHOP_ERROR", `Layer "${l.name}" is not a shape/fill layer`);
        return { layer: this.out(l) };
      }
      case "image.place": {
        const d = this.doc(p);
        if (!existsSync(String(p.path))) throw new PsMcpError("FILE_NOT_FOUND", `File not found: ${p.path}`);
        const x = Number(p.x ?? 0), y = Number(p.y ?? 0);
        const l = this.addLayer(d, { name: String(p.name ?? basename(String(p.path))), kind: "smartObject", bounds: { left: x, top: y, right: x + Number(p.width ?? d.width / 2), bottom: y + Number(p.height ?? d.height / 2) } });
        return { layer: this.out(l) };
      }
      case "select.all": case "select.rect": case "select.ellipse": case "select.polygon": case "select.subject": case "select.sky":
      case "select.colorRange": case "select.layerPixels": case "select.invert": case "select.modify": {
        const d = this.doc(p);
        const shapes = (p.shapes as MLayer["bounds"][] | undefined) ?? (p.bounds ? [p.bounds as MLayer["bounds"]] : undefined);
        d.selection = shapes?.[0] ?? (p.points ? this.pointsBounds(p.points as { x: number; y: number }[]) : { left: 0, top: 0, right: d.width, bottom: d.height });
        return { hasSelection: true, bounds: d.selection };
      }
      case "select.none": {
        const d = this.doc(p);
        d.selection = undefined;
        return { hasSelection: false };
      }
      case "select.info": {
        const d = this.doc(p);
        return d.selection ? { hasSelection: true, bounds: { ...d.selection, width: d.selection.right - d.selection.left, height: d.selection.bottom - d.selection.top } } : { hasSelection: false };
      }
      case "smartObject.maskSubject": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        if (l.kind !== "smartObject") throw new PsMcpError("VALIDATION_ERROR", `"${l.name}" is not a smart object`);
        return { layer: { ...l }, subjectInContents: l.bounds };
      }
      case "mask.create": case "mask.vector": case "mask.delete": case "mask.invert": case "mask.apply": case "mask.refine": case "mask.gradient": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        if (l.kind === "background") l.kind = "pixel";
        if (command === "mask.create") l.hasMask = true;
        if (command === "mask.vector") l.hasVectorMask = true;
        if (["mask.delete", "mask.apply", "mask.invert", "mask.refine", "mask.gradient"].includes(command) && !l.hasMask && !(command === "mask.delete" && l.hasVectorMask)) {
          throw new PsMcpError("PHOTOSHOP_ERROR", `Layer "${l.name}" has no layer mask`);
        }
        if (command === "mask.delete" || command === "mask.apply") l.hasMask = false;
        this.hist(d, command);
        return { layer: this.out(l) };
      }
      case "adjust.layer": {
        const d = this.doc(p);
        const l = this.addLayer(d, { name: String(p.name ?? p.kind), kind: "adjustment" });
        if (p.clip) l.clipped = true;
        if (d.selection) l.hasMask = true;
        return { layer: this.out(l), kind: p.kind };
      }
      case "filter.apply": {
        const d = this.doc(p);
        const l = this.layer(d, p.layer);
        const warnings: string[] = [];
        if (p.smart && l.kind !== "smartObject") {
          l.kind = "smartObject";
          warnings.push("converted to smart object");
        }
        this.hist(d, String(p.kind));
        return { layer: this.out(l), filter: p.kind, smartFilter: Boolean(p.smart), notes: warnings };
      }
      case "ps.history": {
        const d = this.doc(p);
        return { states: d.history.map((name, i) => ({ index: i, name })), current: d.historyIndex };
      }
      case "ps.undo": case "ps.redo": {
        const d = this.doc(p);
        const n = Number(p.steps ?? 1);
        d.historyIndex = command === "ps.undo" ? Math.max(0, d.historyIndex - n) : Math.min(d.history.length - 1, d.historyIndex + n);
        return { current: d.historyIndex, state: d.history[d.historyIndex] };
      }
      case "ps.activeTool":
        return { id: "moveTool", name: "Move Tool" };
      case "ps.preview": {
        const d = this.doc(p);
        const w = 32, h = Math.max(1, Math.round((32 * d.height) / d.width));
        return { previewFile: this.tempPng(w, h), mimeType: "image/png", width: w, height: h, sourceWidth: d.width, sourceHeight: d.height };
      }
      case "ps.analyze":
        this.doc(p);
        return { analyzeFile: this.tempPng(16, 16), width: 16, height: 16 };
      case "execute_plan": {
        const S = Number(p.resolution ?? 72) / 72;
        const d = p.newDocument ? this.newDoc({ name: p.artboardName, width: Math.round(Number(p.width) * S), height: Math.round(Number(p.height) * S), resolution: p.resolution ?? 72, background: "transparent" }) : this.doc(p);
        d.layers = d.layers.filter((l) => l.name !== "Layer 1");
        const groups = new Map<string, MLayer>();
        for (const g of [...(p.layers as string[])].reverse()) groups.set(g, this.addLayer(d, { name: g, kind: "group" }));
        const built: { name: string; id: number }[] = [];
        for (const el of p.elements as Record<string, number & string & Record<string, unknown>>[]) {
          const x = Number(el.x ?? (Number(el.cx ?? 0) - Number(el.radius ?? 0))) * S, y = Number(el.y ?? (Number(el.cy ?? 0) - Number(el.radius ?? 0))) * S;
          const w = Number(el.width ?? (el.radius ? Number(el.radius) * 2 : 100)) * S, h = Number(el.height ?? (el.radius ? Number(el.radius) * 2 : (el.fontSize ? Number(el.fontSize) * 1.2 : 20))) * S;
          const kind = el.type === "text" ? "text" : el.type === "image" ? "smartObject" : "shape";
          const fill = el.fill as { hex?: string } | undefined;
          const l = this.addLayer(d, { name: String(el.name), kind, bounds: { left: x, top: y, right: x + w, bottom: y + h }, parentId: groups.get(String(el.layer))?.id,
            text: kind === "text" ? { contents: String(el.content), font: "ArialMT", size: Number(el.fontSize) * S, color: (el.color as unknown as { hex?: string } | undefined)?.hex ?? "#111111", alignment: String(el.align ?? "left"), tracking: 0 } : undefined });
          if (fill?.hex) (l as MLayer & { fill?: string }).fill = fill.hex;
          built.push({ name: l.name, id: l.id });
        }
        return { document: { id: d.id, name: d.name, width: d.width, height: d.height, resolution: d.resolution }, built, failed: [] };
      }
      case "update_elements": {
        const d = this.doc(p);
        const updated: string[] = [], removed: string[] = [], failed: { name: string; message: string }[] = [];
        for (const u of p.updates as Record<string, unknown>[]) {
          const l = d.layers.find((x) => x.name === u.name);
          if (!l) { failed.push({ name: String(u.name), message: "Layer not found" }); continue; }
          if (u.remove) { d.layers = d.layers.filter((x) => x !== l); removed.push(l.name); continue; }
          if (l.text && u.content !== undefined) l.text.contents = String(u.content);
          if (l.text && u.fontSize !== undefined) l.text.size = Number(u.fontSize);
          if (u.opacity !== undefined) l.opacity = Number(u.opacity);
          updated.push(l.name);
        }
        return { updated, removed, failed };
      }
      case "check_fonts":
        return { fonts: (p.fonts as string[]).map((f) => ({ requested: f, available: true, resolved: f })) };
      case "action.list":
        return { sets: [{ name: "Default Actions", actions: ["Vignette (selection)", "Frame Channel - 50 pixel", "Sepia Toning (layer)"] }] };
      case "action.run":
        if (p.set !== "Default Actions") throw new PsMcpError("PHOTOSHOP_ERROR", `Action set not found: ${p.set}`);
        return { played: { set: p.set, action: p.action } };
      default:
        throw new PsMcpError("UNSUPPORTED_OPERATION", `Mock does not implement ${command}`);
    }
  }

  /** Deterministic sample: warm mid-tone (R140 G128 B110) with a darker band, like a real photo render. */
  private tempPng(w: number, h: number): string {
    const px = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const dark = Math.floor(i / w) < h / 4;
      px.set(dark ? [40, 36, 30, 255] : [140, 128, 110, 255], i * 4);
    }
    const file = join(tmpdir(), `psmcp-mock-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    writeFileSync(file, encodePng(w, h, px, 4));
    return file;
  }

  private pointsBounds(points: { x: number; y: number }[]): MLayer["bounds"] {
    const xs = points.map((q) => q.x), ys = points.map((q) => q.y);
    return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }
}
