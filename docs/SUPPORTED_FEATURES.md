# Supported Features

Summary by module. Per-tool details, schemas and JSX bridge ops: [TOOLS.md](TOOLS.md). Status legend: ✅ supported · ◐ partial (documented approximation) · ☁ requires an external provider · ✖ unsupported (honest error + alternative).

| Module | Highlights |
|---|---|
| 1. Documents | ✅ create, open, close, save, save as (PSD/PSB/TIFF/PNG/JPEG/PDF/WebP/GIF/BMP), info, list, activate, image size, canvas size, resolution, color mode, bit depth, flatten, duplicate, export |
| 2. Layers | ✅ list, info, create (pixel/group), delete, duplicate, rename, move, reorder, merge, merge visible, group, ungroup, hide/show, lock/unlock, opacity, fill opacity, blend mode, link, rasterize, smart object, bounds |
| 3. Text | ✅ live text, edit, find/replace, font, size, color, faux styles, alignment, tracking, leading, transform, layer-style effects, outline, shadow, glow, gradient text, convert to shape, typography layouts |
| 4. Shapes & design | ✅ rectangle (rounded, stroke), ellipse, polygon, line, custom shapes (star, heart, arrow…), edit fill/stroke, gradient fill layers, procedural patterns; poster, flyer, banner, social, thumbnail, ad, magazine and album layouts |
| 5. Images | ✅ import, place (smart object, fit contain/cover/stretch), crop, rotate, flip, resize, free transform, replace contents, convert, export, dimensions/metadata from headers, contact sheet |
| 6. Selection & masks | ✅ all/none/invert, Select Subject, Select Sky, color range, rectangle/ellipse/polygon, layer transparency, feather/expand/contract/smooth, layer & vector masks, invert/delete/apply · ◐ object selection, refine mask |
| 7. Background & objects | ✅ remove/replace background (mask), transparent/white/custom background, remove/move/replace object (Content-Aware Fill), spot cleanup · ◐ extend background |
| 8. Retouching | ✅ blemish/spot removal, teeth whitening, eye brightening, red eye, sharpening, measured exposure and white balance, scratches · ◐ skin smoothing, wrinkles, noise, restoration, colorize, portrait enhancement |
| 9. Color | ✅ brightness, contrast, exposure, saturation, vibrance, hue, temperature, tint, levels, curves, color balance, selective color, B&W, gradient map, photo filter, posterize, threshold, invert, cinematic grades · ◐ color matching · ✖ color lookup |
| 10. Filters & effects | ✅ Gaussian/motion/radial/surface blur, smart sharpen, unsharp mask, high pass, noise, median, dust & scratches, texturizer, emboss, find edges, oil paint, distortions (smart filters by default); glow, shadow, inner shadow/glow, stroke, bevel · ✖ lens blur, perspective warp, liquify |
| 11. Compositing | ✅ combine, collage, photo composite, double exposure, product composite, realistic shadow, reflection, depth effect · ◐ lighting/color match, cinematic/fantasy/surreal scenes |
| 12. Digital art | ✅ pencil sketch, line art, painting effects · ◐ painting/illustration/character/concept/matte canvases · ✖ custom brushes, brush presets |
| 13. AI | ✅ capability status, native object removal, measured image analysis, design review · ☁ generative fill/expand, generate image/background/variations, AI replace (Adobe Firefly Services) |
| 14. Automation | ✅ action sets/actions, run action (confirm), batch process/resize/convert/export/watermark, stored workflows, plan & execute from a brief, execution status, cancel |
| 15. History & inspection | ✅ undo/redo, history, active tool, document state, canvas info, selected layers/objects, dominant colors, inspect, preview image, validation |
| 16. Export | ✅ PNG, JPEG, WebP, TIFF, PDF, PSD, PSB, web export, size-targeted optimisation, transparent PNG, multiple sizes, delivery package with manifest |

| 17. AI design engine | ✅ brief → design plan → one-call build: posters, flyers, logos, social graphics, business cards, brand identity, packaging, infographics, icon sets, editorial layouts; plan validation, versioning, compare, revise, composition analysis, critique, automatic improvements, variations, design knowledge search |
| 18. UI design | ✅ app screens, landing pages, web dashboards, UI kits, custom auto-layout screens from components and design tokens, semantic layer renaming ([UI_DESIGN.md](UI_DESIGN.md)) |
| 19. Background jobs | ✅ `background: true` on long tools; `get_job`, `wait_for_job`, `list_jobs`, `cancel_job` |

Everything is tested against the mock adapter; the bridge and the most-used ops passed a live run against Photoshop 2027 ([TEST_REPORT.md](TEST_REPORT.md)). See [LIMITATIONS.md](LIMITATIONS.md) for what is approximate or unavailable.
