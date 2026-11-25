import { z } from "zod";
import { READ_ONLY, tool, TOOL_CATALOG } from "./registry.js";
import { registerDocumentTools } from "./document.js";
import { registerLayerTools } from "./layers.js";
import { registerTextTools } from "./text.js";
import { registerShapeTools } from "./shapes.js";
import { registerImageTools } from "./images.js";
import { registerSelectionTools } from "./selection.js";
import { registerBackgroundTools } from "./background.js";
import { registerRetouchTools } from "./retouch.js";
import { registerColorTools } from "./color.js";
import { registerFilterTools } from "./filters.js";
import { registerCompositingTools } from "./compositing.js";
import { registerArtTools } from "./art.js";
import { registerAiTools } from "./ai.js";
import { registerAutomationTools } from "./automation.js";
import { registerInspectionTools } from "./inspection.js";
import { registerExportTools } from "./export.js";
import { registerDesignTools } from "./design.js";
import { registerUiTools } from "./ui.js";
import { registerJobTools } from "./jobs.js";

let done = false;

/** Build the tool catalog once per process (definitions are shared by every MCP session). */
export function defineAllTools(): void {
  if (done) return;
  done = true;
  tool({
    name: "photoshop_status", module: "status",
    description: "Detect installed Photoshop versions, bridge readiness (COM on Windows, AppleScript on macOS) and whether Photoshop is running. With probe: true also queries the running application (version, open documents) via a real script call. Call first.",
    annotations: READ_ONLY, commands: ["ps.info"],
    input: { probe: z.boolean().default(true).describe("Execute a status script inside Photoshop (may launch it if auto-launch is enabled)") },
    handler: async ({ probe }, ctx) => {
      const detection = await ctx.bridge.detect();
      const result: Record<string, unknown> = {
        adapter: ctx.bridge.adapterName, detection, autoLaunch: ctx.config.photoshop.autoLaunch, queuePending: ctx.bridge.pending,
        bridge: ctx.bridge.status(), recentOperations: ctx.bridge.recent(10), tools: TOOL_CATALOG.size, allowedPaths: ctx.paths.roots,
      };
      const warnings: string[] = [];
      let probed = false;
      if (probe) {
        try {
          const r = await ctx.bridge.run("ps.info", {});
          result.application = r.data;
          warnings.push(...r.warnings);
          probed = true;
        } catch (e) {
          result.application = null;
          result.probeError = (e as Error).message;
        }
      }
      return { data: result, warnings, source: probed ? undefined : "server" };
    },
  });
  registerDocumentTools();
  registerLayerTools();
  registerTextTools();
  registerShapeTools();
  registerImageTools();
  registerSelectionTools();
  registerBackgroundTools();
  registerRetouchTools();
  registerColorTools();
  registerFilterTools();
  registerCompositingTools();
  registerArtTools();
  registerAiTools();
  registerAutomationTools();
  registerInspectionTools();
  registerExportTools();
  registerDesignTools();
  registerUiTools();
  registerJobTools();
}
