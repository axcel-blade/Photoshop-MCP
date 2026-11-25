# Development

```powershell
pnpm install
```

```powershell
pnpm dev
```

| Command | What |
|---|---|
| `pnpm dev` | `tsx watch` the server from source |
| `pnpm build` | `tsc -p tsconfig.build.json` → `dist/` |
| `pnpm start`, `start:http`, `start:mock` | Run the built server (stdio, HTTP, mock adapter) |
| `pnpm typecheck` | `tsc --noEmit` over `src/`, `tests/`, `scripts/` |
| `pnpm lint` | ESLint |
| `pnpm test` | Vitest unit + security suites (mock Photoshop) |
| `pnpm test:e2e`, `test:e2e:http`, `test:e2e:resources` | Built server over stdio / HTTP (mock by default; `E2E_ADAPTER=auto` for Photoshop) |
| `pnpm test:integration` | Live Photoshop end to end ([TESTING.md](TESTING.md)) |
| `pnpm docs:tools` | Regenerate `docs/TOOLS.md` from the tool catalog (`scripts/gen-tool-docs.ts`; CI fails if it is stale) |
| `node scripts/pack-release.mjs` | Release ZIP for the installers (`release/photoshop-mcp-<version>.zip` + `.sha256`; run after `pnpm build`) |
| `node scripts/smoke-install.mjs` | Start an installed copy with the mock adapter, list tools, run one call |

Helper scripts (PowerShell, `scripts/`): `install.ps1`, `build.ps1`, `launch.ps1`, `check-deps.ps1`, `diagnostics.ps1`,
`test-bridge.ps1`, `integration-test.ps1`, `new-token.ps1`; macOS equivalents `install.sh`, `diagnostics.sh`, `test-bridge.sh`.

Single package: TypeScript in `src/` compiled with `tsc` (NodeNext, `.js` import suffixes) to `dist/`. ExtendScript in
`photoshop-scripts/` is plain ES3 and is not compiled. Use **pnpm** only.

## Layout

| Path | Contents |
|---|---|
| `src/mcp/tools/` | Tool modules (one per catalog section) and `registry.ts` |
| `src/photoshop/bridge/` | `PhotoshopBridge`, adapters, op allowlist, script builder, postprocess |
| `src/design-engine/`, `src/schemas/`, `data/` | Design planner, templates, validator, compiler, composition analysis, UI auto layout, design knowledge CSVs |
| `src/workflow-engine/` | Brief → tool-step workflows |
| `src/jobs/` | Background jobs and executions |
| `photoshop-scripts/` | `bootstrap.jsx` + op modules, `run-jsx.ps1`, `run-jsx.applescript` |
| `installers/`, `site/` | One-line installers and the Astro docs site (renders `docs/*.md`) |

## Adding a tool

1. If Photoshop needs a new operation, add the op name to `BRIDGE_OPS` in `src/photoshop/bridge/commands.ts`, implement it as
   `MCP.ops["area.name"] = function (p) { … return result; }` in the right `photoshop-scripts/*.jsx` module (ES3: no `let`,
   arrow functions or JSON built-in — use `MCP.stringify`), and add it to `MockAdapter` (`src/photoshop/bridge/mock-adapter.ts`).
   `tests/unit/bridge.test.ts` fails if an allowlisted op is not implemented in the JSX.
   For Action Manager calls, write the descriptor as batchPlay-style JSON and run it with `MCP.toDesc` / `MCP.play` (see `bootstrap.jsx`).
2. Define the tool in `src/mcp/tools/<module>.ts` with `tool({ name, module, description, input: { zod shape }, annotations, commands, status?, limitations?, handler })`.
   Use `cmd()` for one op, `Sequence` for several, `requireConfirm` for destructive behaviour, `inputPath` / `outputPath` for files.
3. If a feature cannot be implemented, set `status: "unsupported"` (or `partial`) and throw `unsupported(feature, reason, alternative)` — never return a fake success.
4. Add a test in `tests/unit`, run `pnpm docs:tools`, and if it touches Photoshop, `pnpm test:integration`.

## Debugging JSX

- Every op is logged (`bridge op` with `op`, `ok`, `durationMs`, `adapter`). Generated scripts and result files live in `%TEMP%\photoshop-ai-mcp\` and are deleted after each call.
- Run a script directly: `powershell -File photoshop-scripts\run-jsx.ps1 -ScriptPath <file.jsx> -ResultPath <out.json>`.
- Errors carry the JSX line number in `error.details`.
- To capture a descriptor, record the operation in the Actions panel and use *Copy as JavaScript*; the JSON form pastes into `MCP.toDesc` unchanged.

## Conventions

- Strict TypeScript, Zod for every input, structured `McpDesignError` codes.
- Logs go to stderr only (stdout is the stdio transport).
- Non-destructive first: adjustment layers, smart filters, masks, duplicates.
