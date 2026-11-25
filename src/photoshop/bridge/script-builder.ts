import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_ROOT } from "../../config/index.js";
import { BRIDGE_OPS } from "./commands.js";

export const SCRIPT_DIR = join(PROJECT_ROOT, "photoshop-scripts");
const MODULES = ["bootstrap.jsx", "document.jsx", "layers.jsx", "drawing.jsx", "editing.jsx", "inspect.jsx", "design.jsx"];

/**
 * Operations the JSX layer implements. The bridge refuses anything else before Photoshop
 * is contacted, and the JSX dispatcher refuses again on its side.
 */
export const ALLOWED_OPS = new Set<string>(BRIDGE_OPS);

let cachedLibrary: string | undefined;

export function loadScriptLibrary(): string {
  if (!cachedLibrary) {
    cachedLibrary = MODULES.map((m) => `// ---- ${m} ----\n` + readFileSync(join(SCRIPT_DIR, m), "utf8")).join("\n");
  }
  return cachedLibrary;
}

/** JSON is valid ES3 when non-ASCII and the U+2028/9 separators are escaped. */
export function toJsxLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

export function buildScript(op: string, args: unknown, resultPath: string): string {
  const command = toJsxLiteral({ op, args });
  const result = toJsxLiteral(resultPath);
  return `${loadScriptLibrary()}\n// ---- invocation ----\nMCP.main(${command}, ${result});\n`;
}
