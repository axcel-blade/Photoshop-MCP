import type { MarkdownInstance } from "astro";
import pkg from "../../../package.json";

export const REPO = "https://github.com/axcel-blade/Photoshop-MCP";
export const VERSION: string = pkg.version;

/** docs/*.md from the repository root; the site never keeps its own copy. */
const files = import.meta.glob<MarkdownInstance<Record<string, unknown>>>("../../../docs/*.md", { eager: true });

export interface Doc {
  slug: string;
  file: string;
  title: string;
  group: string;
  order: number;
  entry: MarkdownInstance<Record<string, unknown>>;
}

/** Sidebar order and grouping; unknown docs land under "Reference" alphabetically. */
const LAYOUT: Record<string, [group: string, order: number]> = {
  INSTALLATION: ["Get started", 1],
  CONFIGURATION: ["Get started", 2],
  CLIENTS: ["Get started", 3],
  EXAMPLES: ["Get started", 4],
  TROUBLESHOOTING: ["Get started", 5],
  SUPPORTED_FEATURES: ["Reference", 1],
  API_REFERENCE: ["Reference", 2],
  TOOLS: ["Reference", 3],
  COORDINATES: ["Reference", 4],
  DESIGN_SCHEMA: ["Reference", 5],
  UI_DESIGN: ["Reference", 6],
  LIMITATIONS: ["Reference", 7],
  GAP_ANALYSIS: ["Project", 6],
  ARCHITECTURE: ["Project", 1],
  SECURITY: ["Project", 2],
  DEVELOPMENT: ["Project", 3],
  TESTING: ["Project", 4],
  TEST_REPORT: ["Project", 5],
};
export const GROUPS = ["Get started", "Reference", "Project"];

export const docs: Doc[] = Object.entries(files)
  .map(([path, entry]) => {
    const file = path.split("/").pop()!.replace(/\.md$/, "");
    const heading = entry.getHeadings().find((h) => h.depth === 1)?.text;
    const [group, order] = LAYOUT[file] ?? ["Reference", 99];
    return { slug: file.toLowerCase().replace(/_/g, "-"), file, title: heading ?? file.replace(/_/g, " "), group, order, entry };
  })
  .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || a.order - b.order || a.title.localeCompare(b.title));

export const toolCount = (): number => {
  // TOOLS.md is generated with a "**N tools**" summary line; its headings are modules, not tools.
  const raw = Object.values(import.meta.glob<string>("../../../docs/TOOLS.md", { query: "?raw", import: "default", eager: true }))[0];
  const m = raw?.match(/\*\*(\d+) tools\*\*/);
  return m ? Number(m[1]) : 0;
};

/** Prefix a site path with the configured base ("/Photoshop-MCP"). */
export const href = (path: string): string => `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
