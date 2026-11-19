# dsh-screenshot-master

Screenshot capture for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and
[OpenCode](https://opencode.ai). Captures the full screen, one display, or one application window, saves a PNG, and
returns its absolute path with capture metadata. It never opens, analyses, uploads, or attaches the image.

Windows 10/11 and macOS 14+. Linux is not supported.

## Scope

Does:

- capture the full screen or one display;
- list capturable windows and displays;
- capture one window by the identifier from that listing;
- save PNG, verify it, return path plus width, height, method, timestamp.

Does not: open or preview the image, run OCR, attach it to a conversation, upload it, delete old screenshots, or
drive the desktop. `list_windows` never captures. The caller owns the file afterwards.

## Installation

Requires Node.js 22 or newer. Build first: the entry points are `lib/*.js`.

```bash
npm ci
npm run build
```

### DeepSeek Harness

Install as a profile bundle:

```
plugin_manager install_bundle  target: <absolute path to this directory>
```

`package.json` declares `dsh.bundle.patch`, so the install applies [`cordis.patch.yml`](./cordis.patch.yml) and
inserts the plugin row. Override configuration from the profile's own `cordis.patch.yml`.

### OpenCode

Add the directory to `opencode.json(c)`. OpenCode resolves the server part from `package.json` exports `./server`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["/absolute/path/to/dsh-screenshot-master"]
}
```

The three tools appear in the next session. Configuration comes from the plugin options object or the environment:

```jsonc
{
  "plugins": [
    { "package": "/absolute/path/to/dsh-screenshot-master", "options": { "outputDir": "D:/captures" } }
  ]
}
```

### macOS: build the native helper once

Window capture and display selection need a small Swift helper. Build it on the machine that will run it
(Xcode command line tools only):

```bash
npm run build:native:macos
```

Without the helper the plugin still registers and captures the main display through `/usr/sbin/screencapture`;
window enumeration returns `NATIVE_HELPER_UNAVAILABLE` with build instructions.

## Configuration

All keys are optional. Set them on the plugin row, in the OpenCode options object, or through the environment.

| Key | Environment | Default | Meaning |
| --- | --- | --- | --- |
| `outputDir` | `DSH_SCREENSHOT_OUTPUT_DIR` | `~/.dsh/screenshots` | Directory for the PNG files, created when missing. `~`, `%VAR%`, `$VAR` expanded. |
| `windowFallback` | `DSH_SCREENSHOT_WINDOW_FALLBACK` | `true` | Windows: retry a failed window capture by cropping the desktop rectangle. Labelled `desktop-region`. |
| `allowUniformCaptures` | `DSH_SCREENSHOT_ALLOW_UNIFORM` | `false` | Accept a single-colour image. Off because that is what a failed capture looks like. |
| `timeoutMs` | `DSH_SCREENSHOT_TIMEOUT_MS` | `30000` | Time budget per native capture, clamped to 1 000–300 000 ms. |
| `keepTempFiles` | `DSH_SCREENSHOT_KEEP_TEMP` | `false` | Keep the `.partial` file for debugging. |
| `powershellPath` | `DSH_SCREENSHOT_POWERSHELL` | system Windows PowerShell | Windows: interpreter that runs the capture scripts. |
| `windowsScriptDir` | `DSH_SCREENSHOT_WINDOWS_SCRIPT_DIR` | bundled `lib/platforms/scripts/windows` | Windows: override the `.ps1` location. |
| `macosHelperPath` | `DSH_SCREENSHOT_MACOS_HELPER` | `native/macos/build/dsh-screenshot-helper` | macOS: explicit helper binary. |
| `macosHelperDir` | – | – | Reserved for relocated helper layouts. |

Booleans accept `true`/`false`/`1`/`0`/`yes`/`no`/`on`/`off`. Unknown keys are ignored, so a profile written for a
newer version still loads.

## Tools

### `screenshot_screen`

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `display` | integer \| string | no | Zero-based display index or display id from `list_windows`. Omit for the primary display. |

### `list_windows`

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `filter` | string | no | Case-insensitive substring over title, application name, and identifier. |

Returns `{ count, windows, displays, notes }`. Window ids look like `win32:<HWND>` or `mac:<CGWindowID>`. Titles are
not unique, so `screenshot_window` accepts only `id`.

### `screenshot_window`

| Parameter | Type | Required | Meaning |
| --- | --- | --- | --- |
| `window_id` | string | yes | The `id` from `list_windows`, for example `win32:4195478`. |

Captures the window's own composited content, not the desktop behind it. If the platform cannot read the window,
the call fails; it never substitutes another image.

```json
{
  "path": "C:\\Users\\me\\.dsh\\screenshots\\screen-display0-20261027-201500-123-00-a1b2c3d4.png",
  "bytes": 836177,
  "width": 1920,
  "height": 1080,
  "captureType": "screen",
  "method": "copyfromscreen",
  "takenAt": "2026-10-27T13:15:00.123Z",
  "uniform": false,
  "fallback": false,
  "notes": []
}
```

### Errors

| Code | Meaning |
| --- | --- |
| `UNSUPPORTED_PLATFORM` | No capture backend for this OS. |
| `INVALID_ARGUMENT` | Missing, malformed, out-of-range, or unknown parameter. |
| `DISPLAY_NOT_FOUND` | Display index or id does not exist. |
| `WINDOW_NOT_FOUND` | Window closed, or the handle no longer names one. |
| `WINDOW_NOT_CAPTURABLE` | Window exists but exposes no capturable surface. |
| `WINDOW_MINIMIZED` | Minimized, and its desktop rectangle cannot be captured. |
| `PERMISSION_DENIED` | macOS Screen Recording permission missing. |
| `CAPTURE_FAILED` | Native layer ran but produced nothing usable. |
| `BLANK_CAPTURE` | Image is one uniform colour. |
| `OUTPUT_WRITE_FAILED` | Directory or file could not be written. |
| `INVALID_PNG` | Written bytes are not a decodable PNG. |
| `NATIVE_HELPER_UNAVAILABLE` | macOS helper missing or not executable. |
| `TIMEOUT` | Native command exceeded `timeoutMs`. |

Every error carries a hint appended to the model-facing message.

## Output files

- **Name**: `<type>-<label>-<YYYYMMDD>-<HHMMSS>-<mmm>-<attempt>-<random>.png`, local time, ASCII only. Label comes
  from the window title or application name, `[a-z0-9-]`, at most 40 characters.
- **Unique**: the final file is created with the `wx` flag. A collision moves to the next candidate, up to 8 tries.
- **Absolute path**: relative values resolve against the process working directory.
- **Temporary**: native code writes `.dsh-screenshot-<token>.partial`, which is verified, copied, and removed. On
  failure it is removed too, unless `keepTempFiles` is on. Nothing else in the directory is touched.
- **Verified before success**: file exists and is non-empty; PNG signature, header and chunk CRCs valid; it decodes
  to non-zero dimensions; not uniform unless allowed; dimensions match what the backend reported.

## Platform notes

### Windows

- Screen capture uses `Graphics.CopyFromScreen` after `SetProcessDPIAware`, so pixels are real, not DPI-scaled.
- Window capture tries `PrintWindow` with `PW_RENDERFULLCONTENT`, then plain `PrintWindow`, then `BitBlt`, then the
  optional desktop-region fallback. `method` reports which step produced the image.
- Images are cropped to the visible frame, so the invisible resize border and the black 1 px DWM ring are absent.
- The PNG conversion copies pixels and never composites over a background, so undefined GDI alpha cannot paint
  white dots.
- Hardware-accelerated windows (browsers, Electron, games) often refuse `PrintWindow` and return a blank frame. That
  is detected; the desktop fallback covers it when enabled.
- Protected content (DRM, some banking apps) cannot be captured by any user-mode API.

### macOS

- Primary path is the bundled Swift helper over ScreenCaptureKit. Arguments go to `spawn` as an array with
  `shell: false`; the helper prints one JSON object per call.
- Screen Recording permission is required and cannot be bypassed. Grant it in **System Settings → Privacy &
  Security → Screen & System Audio Recording**, then restart the host application.
- Without the helper only the main display can be captured, and windows cannot be enumerated.
- Windows on another Space, hidden windows, and minimized windows are not capturable. There is no desktop-region
  fallback on macOS.
- `bounds` are physical pixels on Windows and logical points on macOS; captured images are always physical pixels.

## Testing

```bash
npm run test:unit           # deterministic, no screen or permission needed
npm run test:integration    # real captures, needs a desktop session
npm run typecheck
npm run lint
npm run check               # workflow + typecheck + lint + build + unit
```

Unit tests use a fake backend and a temporary directory. Integration tests are platform-gated and run against a
real desktop. The Windows suite also compares captures pixel for pixel with a rendered pattern and covers a
window-overlap case that a desktop crop cannot pass.

CI runs on GitHub-hosted runners: unit on Windows and macOS across Node 22 and 24, plus real-capture jobs on
`windows-latest` and `macos-latest`. A missing GUI session or Screen Recording permission fails the job on purpose.

## Verification status

- Windows screen, window, and enumeration capture: passed by the real-capture suite.
- Pixel fidelity, border cropping, and the no-compositing PNG conversion: passed by the fidelity tests.
- macOS screen and window capture through ScreenCaptureKit: passed in CI on `macos-latest`.
- Unit suite: 185 tests, passing locally and in CI.

Do not infer macOS support from compilation, unit tests, or the presence of a workflow file. It is verified because
a hosted macOS runner captured a real screen and a real window.

## Host APIs

**DeepSeek Harness.** The module exports `name`, `inject = ['tools']`, and `apply(ctx, config)`. Tools are
registered with `ctx.tools.register(definition)`, where `definition` is `{ name, description, parameters, output:
{ schema, render }, execute }`; lifecycle is tied with `ctx.effect`. The plugin does not import harness packages; it
builds that shape in [`src/toolkit.ts`](./src/toolkit.ts).

**OpenCode 2.x.** The server part is the default export `{ id, setup }`. `setup(ctx)` runs on load, registers tools
with `ctx.tool.transform((editor) => editor.add(tool))`, and may return a cleanup function. Tool shape:
`{ name, description, input, options, execute }`, where `execute` returns `{ content }` and no `output`, because a
tool without an output schema may not return one. The adapter lives in
[`src/hosts/opencode.ts`](./src/hosts/opencode.ts) and imports no OpenCode package; the types it needs are declared
locally.

Both hosts call the same `buildToolDefinitions`, so names, descriptions, and schemas cannot drift apart.

## Known limitations

- macOS is verified on GitHub-hosted runners only, not on every configuration. Mixed-DPI multi-display setups are
  untested.
- Window capture cannot beat platform protection: DRM windows, hardware-accelerated surfaces that refuse
  `PrintWindow`, and windows hidden by their own application stay out of reach.
- A genuinely uniform image is rejected as `BLANK_CAPTURE` unless `allowUniformCaptures` is on.
- The Windows desktop fallback includes anything overlapping the window; it is labelled and can be disabled.
- Display order is the plugin's own (left to right, then top to bottom), which can differ from system settings.
- Nothing deletes old screenshots. Prune `outputDir` yourself.
