import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const RULES = `
Rules for every step:
- Call photoshop_status first; if not connected, tell the user to start Photoshop (and, on Windows, check the Photoshop.Application COM registration with scripts/diagnostics.ps1) instead of guessing.
- Call inspect_document before editing. Work non-destructively (adjustment layers, smart filters, masks, copy layers).
- Check every result: "ok" true and "source": "photoshop". If a result says "mock", Photoshop was not used.
- Judge visual quality ONLY from images returned by capture_preview / ai_image_analysis. Never describe what you have not seen.
- Destructive tools need confirm: true — ask the user first. Never overwrite files without asking (overwrite: true only after consent).
- Features marked unsupported/requires_provider: explain the limitation and offer the documented alternative.
- Finish with save_document_as (PSD) and the requested exports; report every file path written and anything not done.`;

interface P { name: string; title: string; description: string; args: Record<string, string>; body: (a: Record<string, string | undefined>) => string }

const PROMPTS: P[] = [
  {
    name: "professional_photo_retouch", title: "Professional photo retouching", description: "Non-destructive portrait/photo retouch workflow.",
    args: { goal: "What to achieve (e.g. natural magazine retouch)", blemishes: "Optional: blemish coordinates" },
    body: ({ goal, blemishes }) => `Retouch the active photo: ${goal ?? "natural, professional result"}.
1. inspect_document, capture_preview to see the photo; ai_image_analysis for measured exposure/color.
2. correct_exposure and correct_white_balance if the analysis shows problems.
3. ${blemishes ? `remove_blemishes with spots ${blemishes}` : "Identify blemish coordinates from the preview and call remove_blemishes (x, y, radius in document px)."}
4. smooth_skin (strength 30-45 for natural), whiten_teeth / brighten_eyes with regions from the preview.
5. sharpen_image (smart, amount ~60). capture_preview and compare; undo steps that look worse.${RULES}`,
  },
  {
    name: "product_advertising", title: "Product advertisement", description: "Product ad from a product photo and brief.",
    args: { product: "Path to the product photo", brief: "Brand, copy, style, size, outputs" },
    body: ({ product, brief }) => `Create a product advertisement. Brief: ${brief ?? "(ask the user)"}. Product photo: ${product ?? "(ask the user)"}.
1. plan_workflow with the brief and assets [product] — review assumptions and missingInputs with the user.
2. execute_workflow { steps } (or { brief, assets }). Use background: true for long runs and poll get_execution_status.
3. capture_preview, ai_design_assistant; fix issues (text contrast, placement) with targeted tools.
4. create_delivery_package or export_* as requested.${RULES}`,
  },
  {
    name: "poster_creation", title: "Poster creation", description: "Poster from headline/copy/style.",
    args: { headline: "Headline", details: "Subhead, date, CTA, style, size" },
    body: ({ headline, details }) => `Create a poster. Headline: "${headline ?? "(ask)"}". Details: ${details ?? "none"}.
Use create_poster (pick style and preset), then capture_preview and ai_design_assistant, refine with add_text / add_text_effect / create_custom_shape, then save and export.${RULES}`,
  },
  {
    name: "social_media_design", title: "Social media design", description: "Platform-sized social graphic.",
    args: { platform: "instagram_post, instagram_story, facebook_post, linkedin_post, twitter_post…", message: "Headline / copy" },
    body: ({ platform, message }) => `Create a ${platform ?? "instagram_post"} graphic: ${message ?? "(ask)"}.
create_social_media_design { preset: "${platform ?? "instagram_post"}" }, then preview, refine, export_for_web (jpg) and export_png.${RULES}`,
  },
  {
    name: "background_replacement", title: "Background replacement", description: "Cut out the subject and replace the background.",
    args: { background: "Color hex, gradient description, or image path" },
    body: ({ background }) => `Replace the background of the active photo with: ${background ?? "(ask)"}.
1. capture_preview. 2. replace_background (color / gradient / imagePath). 3. capture_preview — if edges are rough use refine_mask (feather 1-3). 4. match_lighting on the subject layer against the new background. 5. create_realistic_shadow if the subject stands on a surface.${RULES}`,
  },
  {
    name: "image_restoration", title: "Image restoration", description: "Restore an old or damaged photo.",
    args: { damage: "Describe damage (scratches, dust, fading, tears)" },
    body: ({ damage }) => `Restore the active photo. Damage: ${damage ?? "unknown — inspect first"}.
1. capture_preview + ai_image_analysis. 2. restore_photo. 3. For tears/large scratches, find regions in the preview and call remove_scratches { regions } or remove_object. 4. colorize_photo (toning) only if the user wants it; say it is not AI colorization unless a provider is configured.${RULES}`,
  },
  {
    name: "cinematic_compositing", title: "Cinematic compositing", description: "Composite and grade a cinematic scene.",
    args: { background: "Background plate path", subject: "Subject photo path", mood: "Mood / grade" },
    body: ({ background, subject, mood }) => `Build a cinematic composite. Plate: ${background ?? "(ask)"}; subject: ${subject ?? "(ask)"}; mood: ${mood ?? "teal & orange"}.
create_photo_composite → create_cinematic_scene (or apply_cinematic_color_grade with the matching style) → capture_preview → refine.${RULES}`,
  },
  {
    name: "ecommerce_preparation", title: "E-commerce image preparation", description: "White-background product images at marketplace sizes.",
    args: { folder: "Folder of product photos (optional, for batch)", size: "Output size (default 2000x2000)" },
    body: ({ folder, size }) => `Prepare e-commerce images${folder ? ` for every photo in ${folder}` : " for the active photo"} at ${size ?? "2000x2000"}.
Single image: execute_workflow { template: "ecommerce_white", vars: { output: "<path>.jpg" } }.
Batch: batch_process with steps [remove_background, create_white_background, resize_canvas] and format jpg, background: true; poll get_execution_status. Verify a few results with open_document + capture_preview.${RULES}`,
  },
];

export function registerPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    const shape = Object.fromEntries(Object.entries(p.args).map(([k, d]) => [k, z.string().optional().describe(d)]));
    server.registerPrompt(p.name, { title: p.title, description: p.description, argsSchema: shape }, (args: Record<string, string | undefined>) => ({
      messages: [{ role: "user" as const, content: { type: "text" as const, text: p.body(args) } }],
    }));
  }
}

export const PROMPT_NAMES = PROMPTS.map((p) => p.name);
