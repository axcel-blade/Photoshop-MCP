import type { Workflow } from "../schemas/index.js";

/** Ready-made workflows exposed as an MCP resource and runnable with execute_workflow { template }. */
export const WORKFLOW_TEMPLATES: Record<string, Workflow> = {
  portrait_retouch: {
    name: "portrait_retouch",
    description: "Non-destructive portrait retouch on the active document, then PSD save.",
    steps: [
      { id: "inspect", tool: "inspect_document", args: {}, continueOnError: false },
      { tool: "correct_exposure", args: {}, continueOnError: true },
      { tool: "correct_white_balance", args: {}, continueOnError: true },
      { tool: "smooth_skin", args: { strength: 40 }, continueOnError: false },
      { tool: "sharpen_image", args: { amount: 60, radius: 1.2 }, continueOnError: false },
      { tool: "capture_preview", args: { maxSize: 768 }, continueOnError: false },
    ],
  },
  ecommerce_white: {
    name: "ecommerce_white",
    description: "Cut out the product on the active layer, put it on pure white, export 2000px JPEG.",
    steps: [
      { tool: "remove_background", args: {}, continueOnError: false },
      { tool: "create_white_background", args: {}, continueOnError: false },
      { tool: "resize_canvas", args: { width: 2000, height: 2000, anchor: "center" }, continueOnError: true },
      { tool: "capture_preview", args: { maxSize: 768 }, continueOnError: false },
      { tool: "export_jpeg", args: { path: "{{vars.output}}", quality: 10, overwrite: false }, continueOnError: false },
    ],
  },
  photo_restoration: {
    name: "photo_restoration",
    description: "Dust & scratches, noise reduction, levels and sharpening on a duplicated smart layer.",
    steps: [
      { tool: "restore_photo", args: {}, continueOnError: false },
      { tool: "capture_preview", args: { maxSize: 768 }, continueOnError: false },
    ],
  },
  cinematic_grade: {
    name: "cinematic_grade",
    description: "Teal & orange grade, vignette and grain as adjustment/fill layers.",
    steps: [
      { tool: "apply_cinematic_color_grade", args: { style: "teal_orange", strength: 70 }, continueOnError: false },
      { tool: "capture_preview", args: { maxSize: 768 }, continueOnError: false },
    ],
  },
  social_square: {
    name: "social_square",
    description: "1080x1080 social post with headline from vars.headline.",
    steps: [
      { tool: "create_social_media_design", args: { platform: "instagram_post", headline: "{{vars.headline}}", style: "bold" }, continueOnError: false },
      { tool: "capture_preview", args: { maxSize: 768 }, continueOnError: false },
    ],
  },
};
