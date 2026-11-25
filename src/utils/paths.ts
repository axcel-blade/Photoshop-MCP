import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, normalize, relative, resolve } from "node:path";
import { PsMcpError } from "../shared.js";

export const IMAGE_INPUT_EXTENSIONS = [".psd", ".psb", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".webp", ".gif", ".bmp", ".heic", ".avif", ".pdf", ".svg", ".ai", ".cr2", ".cr3", ".nef", ".arw", ".dng"];
export const FORMAT_EXTENSIONS: Record<string, string[]> = {
  psd: [".psd"], psb: [".psb"], png: [".png"], jpg: [".jpg", ".jpeg"], tiff: [".tif", ".tiff"], pdf: [".pdf"],
  webp: [".webp"], gif: [".gif"], bmp: [".bmp"],
};

function inside(root: string, full: string): boolean {
  const rel = relative(root, full);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * File-system sandbox. Every client-supplied path must resolve inside an allowed root.
 * Blocks traversal (..), other drives, UNC/device paths and symlink escapes of existing paths.
 */
export class PathPolicy {
  readonly roots: string[];

  constructor(roots: string[]) {
    if (roots.length === 0) throw new Error("PathPolicy requires at least one allowed root");
    this.roots = roots.map((r) => normalize(resolve(r)));
  }

  resolve(input: string, opts: { extensions?: string[]; mustExist?: boolean } = {}): string {
    if (!input || input.includes("\0")) throw new PsMcpError("PATH_NOT_ALLOWED", "Invalid path");
    if (/^(\\\\|\/\/)/.test(input)) throw new PsMcpError("PATH_NOT_ALLOWED", "Network (UNC) and device paths are not allowed");
    if (/^[a-z]+:\/\//i.test(input)) throw new PsMcpError("PATH_NOT_ALLOWED", "URLs are not file paths");
    const full = normalize(isAbsolute(input) ? resolve(input) : resolve(this.roots[0]!, input));
    if (!this.roots.some((r) => inside(r, full))) {
      throw new PsMcpError("PATH_NOT_ALLOWED", `Path is outside the allowed directories: ${full}`, { allowedRoots: this.roots });
    }
    if (existsSync(full)) {
      const real = realpathSync.native(full);
      const realRoots = this.roots.map((r) => (existsSync(r) ? realpathSync.native(r) : r));
      if (!realRoots.some((r) => inside(r, real))) throw new PsMcpError("PATH_NOT_ALLOWED", `Path escapes the allowed directories via a link: ${full}`);
    }
    if (opts.extensions) {
      const ext = extname(full).toLowerCase();
      if (!opts.extensions.includes(ext)) {
        throw new PsMcpError("VALIDATION_ERROR", `File extension ${ext || "(none)"} not allowed here; expected ${opts.extensions.join(", ")}`);
      }
    }
    if (opts.mustExist && !existsSync(full)) throw new PsMcpError("FILE_NOT_FOUND", `File not found: ${full}`);
    return full;
  }

  /** Resolve an output path: never overwrites silently, creates the parent directory. */
  resolveOutput(input: string, opts: { extensions?: string[]; overwrite?: boolean }): string {
    const full = this.resolve(input, { extensions: opts.extensions });
    if (existsSync(full) && !opts.overwrite) {
      throw new PsMcpError("FILE_EXISTS", `File already exists: ${full}. Ask the user, then pass overwrite: true to replace it.`);
    }
    mkdirSync(dirname(full), { recursive: true });
    return full;
  }

  resolveDir(input: string, create = false): string {
    const full = this.resolve(input);
    if (create) mkdirSync(full, { recursive: true });
    else if (!existsSync(full)) throw new PsMcpError("FILE_NOT_FOUND", `Directory not found: ${full}`);
    return full;
  }
}
