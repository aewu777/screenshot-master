# AGENTS.md

Guidance for coding agents working in this repository. It applies to humans too.

## What this is

A screenshot capture plugin for agent hosts. It captures the full screen, one display, or one application window,
saves a PNG, and returns the absolute path plus metadata. It never displays, uploads, or attaches the image.

Current hosts:

- **DeepSeek Harness** — Cordis plugin, package export `.`, bundle patch in `cordis.patch.yml`.
- **OpenCode 2.x** — plugin package, server part exported as `./server` (alias `./opencode`), loaded by `plugins`
  in `opencode.json`.
- **MCP** — not implemented yet. The design keeps the tool layer host-neutral so it can be added without a rewrite.

## Layout

| Path | Role |
| --- | --- |
| `src/index.ts` | DSH adapter: `apply(ctx)`, `setup(ctx, config)` |
| `src/hosts/opencode.ts` | OpenCode adapter: default `{ id, setup }`, `ctx.tool.transform` |
| `src/runtime.ts` | Shared config + backend + service assembly |
| `src/tools.ts` | The three tool definitions and their text renderers |
| `src/toolkit.ts` | Host-neutral `ToolDefinition`, JSON Schema validation |
| `src/capture.ts` | Capture orchestration: temp file, verification, final write |
| `src/config.ts` | Config keys, env overrides, path expansion |
| `src/platforms/` | Windows and macOS backends, PowerShell and Swift native layers |
| `src/png.ts`, `src/storage.ts` | PNG decoding, atomic file writes |
| `tests/` | `*.test.ts` unit, `*.integration.test.ts` real capture |

## Commands

```bash
npm ci
npm run build      # tsc -> lib/, copies the PowerShell scripts
npm run typecheck  # src and tests
npm run lint
npm test           # unit project, no screen needed
npm run test:integration  # real captures, needs a desktop session
npm run check      # workflow + typecheck + lint + build + unit
```

`npm run build` must run before loading the package: the entry points are `lib/*.js`.

## Rules

- **Keep the core host-neutral.** `capture.ts`, `config.ts`, `errors.ts`, `png.ts`, `storage.ts`, `toolkit.ts`,
  `tools.ts`, `runtime.ts` and `platforms/` must not import a host SDK (Cordis, `@opencode/plugin`) or a host
  package. Host specifics live in `src/index.ts` and `src/hosts/`.
- **One source of tool definitions.** Both hosts call `buildToolDefinitions`. Never copy names, descriptions, or
  schemas into an adapter.
- **Adapters map, they do not decide.** Config, validation, errors, and rendering stay in the core.
- **Error codes are a public contract.** Do not rename or reuse a `ScreenshotErrorCode`; add a new one instead.
- **No shells.** Pass native arguments as arrays to `spawn`/`execFile` with `shell: false`. Never build a command
  string from a path, title, or user input.
- **No new native work at startup.** Registration is side-effect free; a capture happens only in a tool call.
- **Tests stay separated.** Unit tests never touch a screen, a native helper, or the network. Real capture goes in
  `*.integration.test.ts` and is platform-gated, not retried into passing.
- **Do not edit `lib/`.** It is build output.
- **Do not add image attaching, OCR, uploads, or telemetry.** Out of scope on purpose; the README says so.

## Commit style

Conventional Commits, imperative subject, 72 character cap. Body only for non-obvious reasons.
