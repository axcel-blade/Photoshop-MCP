# Coordinate convention

One convention is used by every MCP tool:

- **Origin**: the top-left corner of the document canvas.
- **Axes**: `x` grows to the right, `y` grows **down** (like CSS/SVG). This is Photoshop's own convention, so the bridge does not flip any axis.
- **Units**: document **pixels**. `MCP.main` sets `rulerUnits` and `typeUnits` to pixels for the duration of each call and restores your preferences afterwards.
- **Bounds** (`bounds` inputs and everything returned by `inspect_document`, `list_layers`, `get_layer_info`) are `{ left, top, right, bottom }` in pixels.
- **Text**: `x`/`y` of point text is the baseline anchor; font sizes are pixels (`typeUnits = PIXELS`).
- **Shapes**: rectangles and ellipses take a bounding box; polygons and stars take a center and radius.

## Design plans are in points

Design plans (`plan_design`, `generate_design`, `create_*` design tools, `create_ui_design`) are authored in
`document.units` (default `mm`, also `pt px cm in pc`). The compiler converts everything to **points**, and
`photoshop-scripts/design.jsx` converts points to pixels at the plan resolution:

```
pixels = points × resolution / 72        (MCP.S = resolution / 72)
```

The resolution is `export.ppi` when the plan sets it, otherwise 72 ppi for `px`/`pt` plans and 150 ppi for print units
(`planResolution` in `src/mcp/tools/design-support.ts`). So an A4 plan (210 × 297 mm = 595 × 842 pt) becomes a 1240 × 1754 px
document at the default 150 ppi, or 2480 × 3508 px with `export.ppi: 300`. Font sizes in plans are points and scale the same way.
Screen-sized plans (`px` units, UI device frames) use 72 ppi, so 1 plan px = 1 document px.

| Unit | Points |
|------|--------|
| pt, px | 1 |
| pc | 12 |
| in | 72 |
| cm | 28.3465 |
| mm | 2.83465 |

Conversion helpers: `src/utils/units.ts` (`toPoints`, `fromPoints`, `convert`).
