import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";

// GitHub Pages defaults; override with ASTRO_SITE / ASTRO_BASE (e.g. a custom domain).
const site = process.env.ASTRO_SITE || "https://axcel-blade.github.io";
const base = (process.env.ASTRO_BASE ?? "/Photoshop-MCP").replace(/\/$/, "");
const REPO = "https://github.com/axcel-blade/Photoshop-MCP";

/**
 * The site renders the repository's docs/*.md as-is. Rewrite their relative links:
 * "TOOLS.md#x" -> "<base>/docs/tools/#x"; anything else relative ("../examples/a.json") -> GitHub.
 */
function rewriteDocLinks() {
  const walk = (node) => {
    if (node.type === "link" && typeof node.url === "string" && !/^([a-z]+:|#|\/)/i.test(node.url)) {
      const doc = node.url.match(/^(?:\.\/)?([A-Za-z0-9_-]+)\.md(#.*)?$/);
      if (doc) node.url = `${base}/docs/${doc[1].toLowerCase().replace(/_/g, "-")}/${doc[2] ?? ""}`;
      else node.url = `${REPO}/blob/main/${node.url.replace(/^(\.\.\/)+/, "")}`;
    }
    for (const child of node.children ?? []) walk(child);
  };
  return () => (tree) => walk(tree);
}

export default defineConfig({
  site,
  base: base || "/",
  trailingSlash: "ignore",
  build: { format: "directory" },
  markdown: {
    remarkPlugins: [rewriteDocLinks()],
    shikiConfig: { themes: { light: "github-light", dark: "github-dark" } },
  },
  vite: {
    plugins: [
      {
        // docs/ is outside the site root, so the dev watcher does not see edits there by default.
        name: "watch-repo-docs",
        configureServer(server) {
          server.watcher.add(fileURLToPath(new URL("../docs", import.meta.url)));
        },
      },
    ],
    // docs/*.md and package.json live one level above the site.
    server: {
      fs: { allow: [".."] },
      // Docker Desktop bind mounts do not forward file events; poll when asked (docker-compose.dev.yml).
      watch: process.env.CHOKIDAR_USEPOLLING === "true" ? { usePolling: true, interval: 300 } : undefined,
    },
  },
});
