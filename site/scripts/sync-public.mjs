/* Copy the one-line installers into public/ so they are served at <site>/install.ps1|.sh.
   The files in installers/ stay the single source of truth (public copies are git-ignored). */
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const pub = resolve(import.meta.dirname, "../public");
mkdirSync(pub, { recursive: true });
copyFileSync(resolve(root, "installers/windows/install.ps1"), resolve(pub, "install.ps1"));
copyFileSync(resolve(root, "installers/macos/install.sh"), resolve(pub, "install.sh"));
console.log("synced installers -> site/public");
