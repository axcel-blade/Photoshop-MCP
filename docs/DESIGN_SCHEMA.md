# Design plan schema

The structured intermediate representation of the design engine lives in `src/schemas/design-plan.ts` (Zod).
`plan_design`, `generate_design` and the `create_*` design tools produce it; `validate_design_plan` checks it;
`execute_design_plan` builds it in Photoshop in **one** bridge call (`execute_plan` in `photoshop-scripts/design.jsx`).

## Top level

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | |
| `meta` | object | `title`, `brief`, `category`, `style`, `audience`, `template`, `rationale[]` |
| `document` | object | `name`, `width`, `height`, `units` (`pt px mm cm in pc`, default `mm`), `colorMode` (`RGB`/`CMYK`) |
| `background` | union | `{type:"solid", color}` · `{type:"gradient", gradient}` · `{type:"none"}`. Built as a shape layer named `Background` in the bottom group |
| `palette` | object | `name`, `colors: { role: "#RRGGBB" }` |
| `typography` | object | `heading`, `body`, `accent?` → `{ fonts: [candidates...], weight?, tracking? }` |
| `grid` | object? | `columns`, `margin`, `gutter` |
| `tokens` | object? | Design tokens: `spacing`, `radius`, `fontSize`, `controlHeight`. See [UI_DESIGN.md](UI_DESIGN.md) |
| `autoLayout` | array? | Input only: auto-layout tree, flattened into `elements` before validation. See [UI_DESIGN.md](UI_DESIGN.md) |
| `layers` | array | Top-to-bottom. `{ name, locked? }` — each becomes a **layer group** |
| `elements` | array | Bottom-to-top unless `z` is set; each becomes a named layer inside its group |
| `swatches` | boolean | Reported in the result; Photoshop's Swatches panel is not modified |
| `export` | object? | `formats[]`, `ppi` — `ppi` is also the document resolution (see [COORDINATES.md](COORDINATES.md)) |

## Colors

A color is `#RRGGBB`/`#RGB` or a palette reference `palette.<role>`. Gradients: `{ type: "linear"|"radial", angle, stops: [{ color, position 0–100, opacity? }] }`.
Gradient fills are applied as a Gradient Overlay layer effect on the shape layer.

## Elements

Common fields: `name` (unique — used for revisions), `layer` (must be declared), `x`, `y`, `rotation`, `opacity` (0–100),
`blendMode`, `effects[]` (`shadow`, `blur`, `innerGlow`, `outerGlow` → layer effects / Gaussian Blur), `z`, `locked`, `role`, `align`.

| `type` | Built as | Specific fields |
|---|---|---|
| `rect` | shape layer (rounded if `cornerRadius`) | `width`, `height`, `cornerRadius?`, `fill`, `stroke` |
| `ellipse` | shape layer | `width`, `height`, `fill`, `stroke` (x/y = top-left) |
| `circle` | shape layer | `radius` (x/y = **center**) |
| `polygon` | shape layer | `radius`, `sides` (center) |
| `star` | shape layer | `radius`, `innerRadius`, `points` (center) |
| `line` | thin polygon shape layer | `x2`, `y2`, `stroke` |
| `path` | custom shape layer | `points[{x,y,in?,out?,corner?}]`, `closed` |
| `text` | live text layer | `content`, `fontRole`, `font?` (string or candidate list), `fontSize` (pt), `weight`, `color`, `textAlign`, `tracking`, `leading` (pt), `width`+`height` for paragraph text, `caps` |
| `image` | placed smart object | `path`, `width`, `height`, `embed` (`false` = linked), `fit` |

### Alignment and dependencies

`align: { relativeTo: "artboard" | "<element name>", horizontal?: left|center|right, vertical?: top|middle|bottom, offsetX, offsetY }`
resolves to absolute coordinates at compile time (`"artboard"` is the canvas). References must exist and appear earlier in z-order; cycles are rejected.

## Validation

`validate_design_plan` / `validatePlan()` returns `{ valid, errors[], warnings[] }`:

- **Errors**: schema violations, duplicate layer/element names, undeclared layers, unresolved palette references,
  alignment cycles / unknown references, star inner ≥ outer radius, half-specified paragraph text.
- **Warnings**: elements fully off the canvas, text contrast below WCAG (4.5:1, or 3:1 at ≥ 18 pt).
- Fonts and image files can only be checked on the real machine, so `execute_design_plan` preflights them (`check_fonts`):
  missing images become labelled placeholder frames, missing fonts produce warnings naming the fallback actually used.

## Revisions

`revise_design` diffs plan versions by element name and sends only `update_elements` / additions / removals; the document is
rebuilt only when its size or units change. `get_design_plan` and `compare_design_versions` read the stored versions.

## Example

```json
{
  "document": { "name": "Luxury Skincare Poster", "width": 210, "height": 297, "units": "mm", "colorMode": "RGB" },
  "background": { "type": "solid", "color": "#E9DDCC" },
  "palette": { "name": "Luxe", "colors": { "text": "#29231E", "accent": "#C6A98A", "background": "#E9DDCC" } },
  "layers": [{ "name": "Typography" }, { "name": "Graphics" }, { "name": "Background", "locked": true }],
  "elements": [
    { "type": "circle", "name": "Decorative Element", "layer": "Graphics", "x": 105, "y": 140, "radius": 40, "fill": "palette.accent" },
    { "type": "text", "name": "Headline", "layer": "Typography", "content": "PURE BEAUTY", "fontSize": 48,
      "color": "palette.text", "align": { "relativeTo": "artboard", "horizontal": "center" }, "y": 30 }
  ],
  "export": { "formats": ["png"], "ppi": 300 }
}
```
