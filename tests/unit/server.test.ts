import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROMPT_NAMES } from "../../src/mcp/prompts/index.js";
import { TOOL_CATALOG } from "../../src/mcp/tools/registry.js";
import { setup } from "../helpers.js";

/** Every tool name from the project specification's 16 modules. */
const SPEC_TOOLS = `create_document open_document close_document save_document save_document_as get_document_info get_open_documents get_active_document set_active_document resize_document resize_canvas change_resolution change_color_mode change_bit_depth flatten_document duplicate_document export_document
get_layers get_layer_info create_layer delete_layer duplicate_layer rename_layer move_layer reorder_layers merge_layers merge_visible_layers group_layers ungroup_layers hide_layer show_layer lock_layer unlock_layer set_layer_opacity set_layer_fill_opacity set_blend_mode link_layers rasterize_layer convert_to_smart_object get_layer_bounds
add_text edit_text delete_text replace_text set_font set_font_size set_font_color set_font_style set_text_alignment set_character_spacing set_line_spacing transform_text add_text_effect create_text_outline create_text_shadow create_gradient_text create_typography_design
create_rectangle create_ellipse create_polygon create_line create_custom_shape edit_shape transform_shape set_shape_fill set_shape_stroke create_gradient create_pattern create_poster create_flyer create_banner create_social_media_design create_thumbnail create_advertisement
import_image place_image crop_image rotate_image flip_image resize_image transform_image duplicate_image replace_image convert_image export_image get_image_dimensions get_image_metadata create_image_contact_sheet
select_all deselect invert_selection select_subject select_object select_sky select_color_range select_rectangle select_ellipse create_layer_mask create_vector_mask delete_mask invert_mask apply_mask refine_mask feather_selection expand_selection contract_selection get_selection_info
remove_background replace_background extend_background remove_object move_object replace_object clean_image remove_spots create_transparent_background create_white_background create_custom_background
retouch_skin remove_blemishes smooth_skin whiten_teeth brighten_eyes remove_wrinkles remove_red_eye reduce_noise sharpen_image correct_exposure correct_white_balance remove_scratches restore_photo colorize_photo enhance_portrait
adjust_brightness adjust_contrast adjust_exposure adjust_saturation adjust_vibrance adjust_hue adjust_temperature adjust_tint adjust_levels adjust_curves adjust_color_balance apply_selective_color apply_black_and_white apply_gradient_map apply_color_lookup apply_cinematic_color_grade match_colors
apply_gaussian_blur apply_motion_blur apply_radial_blur apply_surface_blur apply_lens_blur apply_smart_sharpen apply_unsharp_mask apply_high_pass apply_noise apply_texture apply_glow apply_shadow apply_stroke apply_emboss apply_bevel apply_distortion apply_perspective_warp apply_liquify
combine_images create_photo_composite create_double_exposure create_photo_collage create_surreal_artwork create_cinematic_scene create_product_composite create_realistic_shadow create_reflection match_lighting match_colors_between_images create_depth_effect create_fantasy_scene
create_digital_painting create_sketch create_illustration create_character_art create_concept_art create_matte_painting create_line_art apply_painting_effect create_custom_brush manage_brush_presets
generative_fill generative_expand generate_background generate_image generate_variations ai_remove_object ai_replace_object ai_image_analysis ai_design_assistant
get_actions get_action_sets run_action batch_process resize_batch convert_batch export_batch watermark_batch create_automation_workflow execute_workflow get_execution_status cancel_execution
undo redo get_history get_active_tool get_document_state get_canvas_info get_selected_layers get_selected_objects get_document_colors inspect_document capture_preview validate_document
export_png export_jpeg export_webp export_tiff export_pdf export_psd export_psb export_for_web optimize_image export_transparent_image export_multiple_sizes create_delivery_package`.split(/\s+/);

describe("MCP server", () => {
  let t: Awaited<ReturnType<typeof setup>>;
  beforeAll(async () => { t = await setup(); });
  afterAll(async () => t.close());

  it("starts and lists every specified tool", async () => {
    const { tools } = await t.client.listTools();
    const names = new Set(tools.map((x) => x.name));
    const missing = SPEC_TOOLS.filter((n) => !names.has(n));
    expect(missing).toEqual([]);
    expect(tools.length).toBeGreaterThanOrEqual(SPEC_TOOLS.length);
  });

  it("annotates tools and marks unsupported ones honestly", async () => {
    const { tools } = await t.client.listTools();
    const del = tools.find((x) => x.name === "delete_layer")!;
    expect(del.annotations?.destructiveHint).toBe(true);
    expect(tools.find((x) => x.name === "get_layers")!.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((x) => x.name === "apply_liquify")!.description).toMatch(/unsupported/);
    expect(TOOL_CATALOG.get("generative_fill")!.status).toBe("requires_provider");
  });

  it("exposes resources and prompts", async () => {
    const { resources } = await t.client.listResources();
    const uris = resources.map((r) => r.uri);
    for (const u of ["photoshop://status", "photoshop://documents/active", "photoshop://documents", "photoshop://documents/active/layers", "photoshop://version", "photoshop://catalog", "photoshop://executions", "photoshop://workflows/templates"]) expect(uris).toContain(u);
    const status = await t.client.readResource({ uri: "photoshop://status" });
    expect(JSON.parse((status.contents[0] as { text: string }).text).bridge.adapter).toBe("mock");
    const { prompts } = await t.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([...PROMPT_NAMES].sort());
    const p = await t.client.getPrompt({ name: "background_replacement", arguments: { background: "#FFFFFF" } });
    expect((p.messages[0]!.content as { text: string }).text).toContain("#FFFFFF");
  });

  it("photoshop_status reports the bridge", async () => {
    const r = await t.call("photoshop_status");
    expect(r.ok).toBe(true);
    expect(r.data.adapter).toBe("mock");
    expect(r.data.application.photoshopVersion).toBe("mock");
    expect(r.data.tools).toBe(TOOL_CATALOG.size);
  });

  it("labels mock results so they are never mistaken for Photoshop", async () => {
    const r = await t.call("create_document", { width: 100, height: 100 });
    expect(r.source).toBe("mock");
    expect(r.warnings[0]).toMatch(/MOCK ADAPTER/);
  });
});
