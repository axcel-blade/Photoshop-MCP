#!/usr/bin/env node
/**
 * Build the release archive the installers download:
 *   release/photoshop-mcp-<version>.zip  (+ .sha256)
 * Contains the compiled server (dist/), the JSX bridge scripts, data, examples, docs and the
 * pnpm lockfile so installers only run `pnpm install --prod --frozen-lockfile`.
 *
 *   pnpm build && node scripts/pack-release.mjs [--out release]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(ROOT, outArg >= 0 ? process.argv[outArg + 1] : "release");
const { version } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const NAME = `photoshop-mcp-${version}`;

if (!existsSync(join(ROOT, "dist", "index.js"))) {
  console.error("dist/index.js is missing: run `pnpm build` first.");
  process.exit(1);
}

const INCLUDE = [
  "dist", "photoshop-scripts", "data", "examples", "docs", "scripts",
  "package.json", "pnpm-lock.yaml", ".env.example", "README.md", "LICENSE", "CHANGELOG.md", "SECURITY.md",
];

const stage = join(OUT, "stage", NAME);
rmSync(join(OUT, "stage"), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
for (const entry of INCLUDE) {
  const src = join(ROOT, entry);
  if (!existsSync(src)) { console.error(`missing ${entry}`); process.exit(1); }
  cpSync(src, join(stage, entry), { recursive: true, filter: (p) => !/\.(map|tsbuildinfo)$/.test(p) });
}
for (const dir of ["logs", "output"]) {
  mkdirSync(join(stage, dir), { recursive: true });
  writeFileSync(join(stage, dir, ".gitkeep"), "");
}
writeFileSync(join(stage, "VERSION"), `${version}\n`);

const zip = join(OUT, `${NAME}.zip`);
rmSync(zip, { force: true });
const cwd = join(OUT, "stage");
/* bsdtar (Windows 10+, macOS) writes zip with -a; GNU/Linux runners use zip. */
if (process.platform === "linux") execFileSync("zip", ["-qr", zip, NAME], { cwd, stdio: "inherit" });
else {
  /* On Windows use the system bsdtar, not a GNU tar that Git Bash may put first on PATH. */
  const tar = process.platform === "win32" ? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
  execFileSync(tar, ["-a", "-c", "-f", `../${NAME}.zip`, NAME], { cwd, stdio: "inherit" });
}
rmSync(cwd, { recursive: true, force: true });

const sha = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${sha}  ${NAME}.zip\n`);
console.log(`${zip}\nsha256 ${sha}`);
