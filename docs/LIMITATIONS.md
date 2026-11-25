# Limitations

Honest list of what this project cannot do, or does only approximately. Tools in these areas say so in their description (`[status: …]`) and in their results.

## Verification

The bridge and the most-used ops passed a live run against Photoshop 2027 on Windows ([TEST_REPORT.md](TEST_REPORT.md)).
Not every one of the 294 tools has been exercised live, the macOS / AppleScript path has not been run on a Mac, and some
Action Manager descriptors (e.g. Select Sky, some filters) can differ between Photoshop versions. Failures surface as
`PHOTOSHOP_SCRIPT_ERROR` with Photoshop's message; they are never reported as success.

## Not available to scripting (tools return `UNSUPPORTED_OPERATION`)

| Feature | Alternative offered |
|---|---|
| Liquify | `apply_distortion` (twirl / pinch / spherize / ripple) |
| Perspective Warp | `transform_image` skew, or a recorded action via `run_action` |
| Lens Blur | `create_depth_effect` (Gaussian Blur smart filter + subject mask) |
| Color Lookup (LUT loading) | `apply_cinematic_color_grade`, or a recorded action |
| Define / manage brush presets | Edit → Define Brush Preset in Photoshop |

## Approximations (`status: partial`)

| Tool | What it actually does |
|---|---|
| `smooth_skin`, `retouch_skin`, `enhance_portrait`, `remove_wrinkles`, `restore_photo`, `reduce_noise` | Filter/adjustment stacks on copy layers (Surface Blur, Median, Dust & Scratches, Color Range skin mask). Not Neural Filters or Camera Raw |
| `colorize_photo` | Gradient map in Color blend mode (toning), not AI colorization |
| `select_object` | Select Subject ∩ rectangle (the Object Selection tool is interactive) |
| `refine_mask` | Mask feather / density only (Select and Mask is interactive) |
| `match_colors`, `match_lighting`, `match_colors_between_images` | Per-channel Levels from measured channel means |
| `extend_background` | Canvas Size + Content-Aware Fill |
| Scene tools (`create_cinematic_scene`, `create_fantasy_scene`, `create_surreal_artwork`) | Grade, light glow, haze and vignette layers; no new content is generated |
| Digital-art canvases (`create_digital_painting` …) | Canvas, named layer groups and palette; brushwork is not scriptable |

## AI features

Photoshop's in-app Generative Fill / Expand, Remove Tool and Neural Filters are not exposed to scripting. `generative_fill`,
`generative_expand`, `generate_*` and `ai_replace_object` use **Adobe Firefly Services** only when credentials are configured;
the provider code is tested with mocked HTTP and has not been exercised against the live service. `ai_image_analysis` and
`ai_design_assistant` are rule-based over measured pixel statistics, not vision models; they attach a preview so the assistant can judge visually.

## Design engine

- Text in design plans is measured with estimated glyph widths (real metrics exist only in Photoshop), so labels are anchored to their slot.
- Missing fonts fall back to ArialMT; every affected text layer is reported.
- Plan palettes are reported in the result; Photoshop's Swatches panel is not modified.

## Other

- Each bridge call starts a `powershell.exe` / `osascript` process (~0.3–1 s overhead); the first call takes longer while COM attaches.
- ExtendScript cannot be interrupted: cancellation stops further steps or queued jobs; an op already running in Photoshop finishes.
- A modal dialog open in Photoshop blocks every call until it is closed (`BRIDGE_TIMEOUT`).
- Previews are rendered to a temp file (JPEG/PNG) and decoded in Node; very large previews are downscaled.
- Some filters convert a pixel layer to a smart object to keep them editable; the layer id changes and the result reports the new id.
