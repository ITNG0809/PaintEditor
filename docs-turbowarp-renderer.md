# PaintEditor: TurboWarp Canvas compatibility

## Source investigation

Inspected the official gallery source at
<https://extensions.turbowarp.org/lab/text.js> on 2026-11-22, without modifying it.
SHA-256: `baa093e7fab2ac4d2ee03de2758098968fd81b651a7e0a6b403b639acbf6d01b`.
The root `/text.js` is **Text / strings**, not Animated Text / text.
The official file is not bundled or automatically executed in the application.
Use the existing Animation → Extensions → URL/file/text loader and its trust confirmation.

### Complete external API inventory of this source

| Surface                        | Actual uses in the inspected source                                                                                                                                                                             |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Scratch`                      | `vm`, `translate` / `translate.setup`, `Cast.toString`, `Cast.toNumber`, `BlockType` COMMAND / REPORTER / BOOLEAN / BUTTON / LABEL, `ArgumentType` STRING / NUMBER / COLOR, `extensions.register`               |
| `vm`                           | `renderer`, `runtime`, `exports.RenderedTarget`, `extensionManager.refreshBlocks()`                                                                                                                             |
| `runtime`                      | `stageWidth`, `targets`, `on("BEFORE_EXECUTE")`, `on("PROJECT_START")`, `on("PROJECT_STOP_ALL")`, `on("targetWasRemoved")`; optional `fontManager.getFonts()`                                                   |
| `util`                         | `target`, `runtime.requestRedraw()`                                                                                                                                                                             |
| Target                         | symbol-keyed custom state, `drawableID`, `currentCostume`, `setCostume()`                                                                                                                                       |
| RenderedTarget                 | wraps `prototype.makeClone()` and copies text, width, alignment, font, color and animation duration settings to the new target                                                                                  |
| Renderer                       | `gl`, `exports`, `_allDrawables`, `_allSkins`, `_nextSkinId`, `createTextWrapper()`, `updateDrawableSkinId()`, `destroySkin()`                                                                                  |
| Drawable                       | `.skin`, `.scale[0]`, target-to-drawable lookup by ID                                                                                                                                                           |
| Renderer exports               | `Skin`, `CanvasMeasurementProvider`, `twgl.createTexture()`                                                                                                                                                     |
| Skin base                      | `constructor(id, renderer)`, `.id`, `_texture`, `_rotationCenter` / `rotationCenter`, `_setTexture(canvas)`, `emitWasAltered()`, `dispose()`, `_silhouette.unlazy()`                                            |
| Skin subclass consumed by host | `getTexture(scale)`, `size`, `useNearest()`, rotation center; source also implements `updateSilhouette(scale)` and `isMetricsReady()`                                                                           |
| Text measurement/wrapping      | `new CanvasMeasurementProvider(ctx)`, `measureText(string)`, `renderer.createTextWrapper(provider).wrapText(width, text)`                                                                                       |
| WebGL-shaped texture adapter   | `gl.CLAMP_TO_EDGE`, `gl.deleteTexture(texture)`, `twgl.createTexture(gl, {auto: false, wrap: gl.CLAMP_TO_EDGE})`                                                                                                |
| Browser APIs                   | Canvas2D font measurement, fill/stroke text, linear gradients and color stops, `Date.now()`, Promise, interval/timeout and cancellation, `confirm()`, `alert()` for old-VM rejection, optional custom-font menu |

There are no calls to shader compilation, framebuffer operations, raw GL texture
upload, `createDrawable`, `createBitmapSkin`, or VM target creation APIs. None are
invented as placeholders. `targetWasCreated` appears in a comment in this
extension, not as a registered listener.

## Implementation

- `index.html` + `css/style.css` + `js/costume-editor.js` + `js/animation.js` retain the complete
  supplied editor (costume tools, effects, pen, scenes, block interpreter, loader and project
  formats). They were split out of the former single `paint-editor.html` without code changes.
- (Restructure note) The former `src/App.tsx` React/Vite shell only displayed the editor in a
  full-window iframe to isolate it from Tailwind/React. That shell has been removed; the editor
  is now served directly as the static `index.html` (no build step).
- `js/scratch-compat.js` (first half, formerly `tw-canvas-compat.js`) implements only the required renderer surface.
  Text layout and animation remain in the **unmodified official extension**.
- The extension's `Skin._setTexture` snapshots a Canvas into an owned Canvas
  texture. `getTexture()` runs during the existing drawing pass. The existing
  target transform, ghost value and scene object order determine the result.
  The original pen/effect pipeline continues to call the same drawing function.
- Skin rotation centers and alpha pixels are used for text selection bounds and
  direct picking; no duplicate text DOM overlays or separate WebGL renderer exist.
- `emitWasAltered()` and redraw requests are coalesced. `BEFORE_EXECUTE` is emitted
  before interpreter ticks and on animation redraws, including when there are
  no active block threads. The pump stops on stop/reset/closing the scene.
- RenderedTarget classes and wrapper caches are **per extension load**. Official
  monkey patches cannot accumulate on one shared prototype after reload, or
  interfere with another extension's patch. Native clone blocks and
  `target.makeClone()` both traverse the hooks after allocating the drawable.
- Skin IDs and drawable IDs are monotonic shared IDs; source ownership controls
  disposal. Delete-clone, stop's clone cleanup, reset, unload and failed load
  release associated renderer data. Cancellation happens before official skin
  disposal because its `dispose()` does not itself clear animation timers.
- Costume changes restore the original costume, including a change to the same
  costume index. The costume data itself is not replaced by transient text.
- Existing source-code persistence and trust prompts remain in use. No backend
  or new storage format is introduced.
- `SCN.H.extensions` exposes load/unload/sources for integration testing using
  the same core loader as the dialog. It is not a sandbox or a security boundary;
  existing custom extensions already run unrestricted JavaScript.

## Deliberate boundaries / unsupported features

- `renderer.gl` is explicitly a **Canvas texture adapter**, not a WebGL context.
  Unimplemented GL member access throws a descriptive error. Arbitrary shaders,
  framebuffers and other TWGL APIs are unsupported, not silently ignored.
- The texture adapter supports the `auto`, `wrap`, and Canvas `src` options, with
  a 16-megapixel allocation bound. Other options fail explicitly.
- No generic renderer API beyond the audited subset, no full Scratch VM, and no
  extension-created standalone drawables or generic VM target factory. Imported
  Scratch stage scripts use a scene-backed target marked `isStage`.
- Optional `runtime.fontManager` is not advertised. The default families fall
  back to browser fonts unless matching fonts have been installed in the page;
  Scratch Lab font faces are not bundled. Exact Scratch typography is not claimed.
- The wrapper preserves newlines and uses measured word/grapheme wrapping.
  Its Unicode line-breaking is not bit-for-bit scratch-render TextWrapper.
- Animated Text defines one text skin per target. Multiple independent texts use
  multiple scene targets or clones, as in the official extension.
- The official clone hook does not copy outline/shake intensity settings or
  restart in-progress animations; this implementation does not secretly rewrite it.
- Arbitrary independent static-gradient control is not exposed by Animated Text.
  Its actual animated rainbow gradient is supported.
- Advanced sensing operations that directly sample the original costume
  (`mask`, touching-color and some edge/collision paths) still use costume pixels.
  Text picking/bounds are integrated, but full Scratch collision equivalence
  for every sensing block is not claimed.
- Existing stubs unrelated to this change (such as `util.ioQuery` and variable
  lookup) are not broadened or represented as newly implemented APIs.
- Transient text skins are not serialized. Existing scripts, extension source,
  scenes and costumes are; executing the saved scripts regenerates text.

## Verification

Result for the source hash above: **14/14 Chromium checks passed**, with no
extension errors or uncaught page errors. `pnpm build` also passed (both results are from before the restructure; there is no build step now).
JavaScript syntax checks passed for the compatibility module and all inline HTML scripts.

`tests/animated-text.mjs` runs against a statically served copy of the project root (e.g. `python3 -m http.server 3000`) with real
Chromium Canvas2D, not a mocked canvas. The official source can be provided with
`TEXT_SOURCE` for a pinned offline copy. Otherwise it is fetched from the gallery
and its SHA-256 is printed.

Example (test tooling may live outside the app's production dependencies):

```sh
PLAYWRIGHT_MODULE=/tmp/paint-test/node_modules/playwright-core/index.mjs \
TEXT_SOURCE=/tmp/lab-text.js node tests/animated-text.mjs
```

The suite covers registration without API warnings, original sample block
execution (reporter, boolean, loop/command and target movement), actual text/color
pixels, outline/multiline wrapping, rainbow/zoom/shake/type frame changes and
Promise completion, multicolor gradient pixels, position/scale/visibility/ghost,
simultaneous targets and ordering, native and API clones, timer/texture cleanup,
reload/reset, bitmap rendering and the original project/scene save/load path.

## Future compatibility work

1. Audit each additional extension before expanding the API surface.
2. Share a skin-aware geometry/silhouette provider across every sensing path,
   pen mask and edge calculation, then add pixel-level regression cases.
3. Add real bitmap/SVG skin APIs and standalone drawable lifecycle only when a
   concrete extension requires them; integrate their ordering with scene targets.
4. Add a real font manager and licensed font assets if exact Scratch font metrics
   are required; compare wrapping using multilingual reference fixtures.
5. Decide explicitly which WebGL extensions can be translated to Canvas, which
   need a real GL backend, and which should be rejected with capability errors.
6. Broaden interpreter/extension regression coverage for HAT/EVENT, async reporters,
   clone limits, multiple independently patching extensions, and malformed input.
