# Test report

**Date:** 2026-11-25 · **Branch:** `feature/photoshop-mcp` · **Machine:** Windows 11 Pro (10.0.26300), Node 20+, pnpm 10.18.0
**Photoshop:** Adobe Photoshop 2027 (v28.0.0), driven through COM (`Photoshop.Application.DoJavaScriptFile`)

## Summary

| Check | Result |
|---|---|
| `pnpm typecheck` | pass |
| `pnpm lint` | pass (0 problems) |
| `pnpm build` | pass |
| `pnpm test` (Vitest, mock adapter) | **58/58** tests in 7 files |
| `pnpm test:e2e`, `test:e2e:http`, `test:e2e:resources` (built server, mock adapter) | pass |
| PowerShell parse check (`scripts/`, `photoshop-scripts/`, `installers/windows/`) | pass |
| `pnpm docs:tools` | 294 tools |
| `pnpm test:integration` (live Photoshop 2027 via COM) | **36/36 steps passed** |

## Live integration run

`pnpm test:integration` (`tests/integration/run-integration.ts`), adapter `com`:

| Step | Result | Step | Result |
|---|---|---|---|
| status | PASS | selection info | PASS |
| create document | PASS | deselect | PASS |
| gradient fill layer | PASS | analyze (pixel statistics) | PASS |
| rectangle shape | PASS | preview | PASS |
| ellipse shape | PASS | validate | PASS |
| custom star | PASS | history | PASS |
| text layer | PASS | save PSD | PASS |
| edit text | PASS | export PNG | PASS |
| text shadow | PASS | export JPEG resized | PASS |
| gradient text | PASS | export WebP | PASS |
| pixel layer + fill | PASS | export TIFF | PASS |
| noise filter (smart) | PASS | generate design (design engine) | PASS |
| gaussian blur (smart) | PASS | critique design | PASS |
| opacity/blend | PASS | close design | PASS |
| levels adjustment | PASS | undo | PASS |
| curves adjustment | PASS | close | PASS |
| hue/sat adjustment | PASS | | |
| cinematic grade | PASS | | |
| rect selection | PASS | | |
| feather | PASS | | |

Typical per-step time is 0.5–2 s (one `powershell.exe` + COM round trip per op). The first call takes ~14 s while COM attaches;
`generate_design` (a full poster in one `execute_plan` call) takes ~10 s.

Warnings reported during the run (expected, not failures):

- *noise filter*: the pixel layer was converted to a smart object so the filter stays editable, and its layer id changed (the result reports the new id).
- *generate design*: the plan's fonts (Inter, Helvetica Neue) are not installed on the test machine, so ArialMT was used and each text layer says so;
  one placeholder label is below 4.5:1 contrast; Photoshop swatches are not modified by plans.

## Not covered by this run

- macOS / AppleScript adapter (no Mac in this environment). The AppleScript runner and `scripts/*.sh` are untested on real hardware.
- Adobe Firefly Services and remove.bg against the live services (covered by unit tests with mocked HTTP only).
- Every one of the 294 tools individually against Photoshop; the run covers the bridge ops behind the most-used tools.
