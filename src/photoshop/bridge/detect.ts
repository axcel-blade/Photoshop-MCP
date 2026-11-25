import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { DetectionResult, PhotoshopInstall } from "./types.js";

const run = promisify(execFile);

/** Photoshop marketing year → major version. */
const VERSION_NAMES: Record<string, string> = {
  "2020": "21", "2021": "22", "2022": "23", "2023": "24", "2024": "25", "2025": "26", "2026": "27", "2027": "28",
};

function versionLabel(dir: string): string {
  const year = /(\d{4})/.exec(dir)?.[1];
  if (year) return `${year} (v${VERSION_NAMES[year] ?? "?"})`;
  if (/CC/i.test(dir)) return "CC";
  return dir.replace(/^Adobe Photoshop\s*/i, "").replace(/\.app$/i, "") || "unknown";
}

/** Windows: Program Files\Adobe\Adobe Photoshop *\Photoshop.exe */
export function findWindowsInstalls(roots: string[] = [process.env.ProgramFiles ?? "C:\\Program Files"]): PhotoshopInstall[] {
  const installs: PhotoshopInstall[] = [];
  for (const root of roots) {
    const adobe = join(root, "Adobe");
    if (!existsSync(adobe)) continue;
    for (const dir of readdirSync(adobe)) {
      if (!/^Adobe Photoshop/i.test(dir)) continue;
      const exe = join(adobe, dir, "Photoshop.exe");
      if (!existsSync(exe)) continue;
      installs.push({ version: versionLabel(dir), path: join(adobe, dir), executable: exe });
    }
  }
  return installs.sort((a, b) => b.version.localeCompare(a.version));
}

/** macOS: Adobe Photoshop <year>/Adobe Photoshop <year>.app under /Applications or ~/Applications. */
export function findMacInstalls(roots: string[] = ["/Applications", join(homedir(), "Applications")]): PhotoshopInstall[] {
  const installs: PhotoshopInstall[] = [];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const dir of readdirSync(root)) {
      if (!/^Adobe Photoshop/i.test(dir)) continue;
      const folder = join(root, dir);
      const app = dir.endsWith(".app") ? folder : join(folder, `${dir}.app`);
      if (!existsSync(app)) continue;
      installs.push({ version: versionLabel(dir), path: folder, executable: app });
    }
  }
  return installs.sort((a, b) => b.version.localeCompare(a.version));
}

async function comRegistration(): Promise<{ registered: boolean; progId?: string }> {
  try {
    const { stdout } = await run("reg", ["query", "HKCR\\Photoshop.Application\\CurVer"], { windowsHide: true, timeout: 5000 });
    return { registered: true, progId: /REG_SZ\s+(\S+)/.exec(stdout)?.[1] };
  } catch {
    try {
      await run("reg", ["query", "HKCR\\Photoshop.Application"], { windowsHide: true, timeout: 5000 });
      return { registered: true };
    } catch {
      return { registered: false };
    }
  }
}

export async function isPhotoshopRunning(): Promise<boolean> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await run("pgrep", ["-if", "Adobe Photoshop"], { timeout: 5000 });
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq Photoshop.exe", "/FO", "CSV", "/NH"], { windowsHide: true, timeout: 5000 });
    return /Photoshop\.exe/i.test(stdout);
  } catch {
    return false;
  }
}

export async function detectPhotoshop(): Promise<DetectionResult> {
  const notes: string[] = [];
  const running = await isPhotoshopRunning();
  if (process.platform === "darwin") {
    const installs = findMacInstalls();
    const automationAvailable = installs.length > 0;
    if (!installs.length) notes.push("No Adobe Photoshop .app found under /Applications or ~/Applications.");
    else notes.push("macOS bridge uses AppleScript (application id com.adobe.Photoshop → do javascript file).");
    if (!running && automationAvailable) notes.push("Photoshop is installed but not running; the first call may launch it unless PHOTOSHOP_AUTO_LAUNCH=false.");
    return { platform: process.platform, installs, comRegistered: false, automationAvailable, bridge: "applescript", running, notes };
  }
  if (process.platform !== "win32") {
    return { platform: process.platform, installs: [], comRegistered: false, automationAvailable: false, running: false, notes: [`Unsupported platform "${process.platform}". This MCP supports Windows (COM) and macOS (AppleScript).`] };
  }
  const installs = findWindowsInstalls([process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter((p): p is string => Boolean(p)));
  const com = await comRegistration();
  if (!installs.length) notes.push("No Photoshop installation found under Program Files\\Adobe.");
  if (!com.registered) notes.push("COM class Photoshop.Application is not registered; scripting cannot start Photoshop.");
  else notes.push("Windows bridge uses COM (Photoshop.Application.DoJavaScriptFile).");
  return { platform: process.platform, installs, comRegistered: com.registered, comProgId: com.progId, automationAvailable: com.registered, bridge: "com", running, notes };
}
