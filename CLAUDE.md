# Tropical Island

Standing instructions for every session in this repo. Read this file fully before changing anything.
Then read [PLAN.md](PLAN.md): the stages the game is built in, what's done and what's next.

## 1. Vision

A first-person walk around a tropical island that runs in a desktop browser and ships as one HTML file. The goal is a place so beautiful that people stop and ask, "Wait, this is in a browser?" Beauty is the product. It ranks above feature count, above code cleverness and above size of the world: one breathtaking cove beats a whole island that merely looks fine.

The target look is heightened realism, not photorealism: light that behaves physically, with an art-directed, slightly saturated palette. Think of the island a travel poster promises, then make it move.

- **Light does most of the work.** Warm, low sun. Long, soft shadows. Palm leaves glowing gold-green when backlit. Dappled shade drifting across the sand. A path of sun glitter on the sea.
- **Water is the hero.** Shallows so clear you see the sand and dancing caustics beneath, deepening from turquoise to deep blue. Waves running up the beach and leaving wet, mirror-like sand that slowly dries. Foam lines. The white line of surf breaking on the distant reef.
- **Plants are lush and varied.** Leaning coconut palms, torn banana leaves, monstera, hibiscus, frangipani, vines creeping onto the sand. Each species moves in the wind in its own way.
- **Nothing is static.** Wind gusts roll across the grass, waves keep coming, clouds drift and their shadows slide over the lagoon.
- **Depth from near to far.** A leaf centimetres from the camera holds up to scrutiny, and the horizon fades into haze and feels endless.

The bar: every viewpoint should work as a desktop wallpaper. If a screenshot looks "fine" or "like a tech demo", it isn't done. Anything that breaks the spell is a bug, not polish. That includes banding in gradients, flickering or jagged foliage, hard shadow edges, visible texture tiling, and plastic-looking surfaces.

When choosing between approaches, pick the one that looks better in the screenshot, then make it fit the performance budget. Spend detail where the eye goes (the shoreline, sunlight through leaves, the near foreground) and fake everything else.

## 2. Hard rules

- **The output is one file**: `dist/index.html`, with all JS, CSS and shaders inlined. It must work when
  opened directly via `file://`. It is never committed: CI builds and publishes it (see Deploying).
  `./index.html` is the source template.
- **No external assets and no runtime network access.** No fetch, XHR, WebSocket, CDN or font links, and
  no image or model files. `npm run check` enforces this, and the screenshot tool fails on any network
  request the page makes.
- **Everything is procedural**: geometry, textures, sky, sound. Generate it at runtime.
- **`three` is the only runtime dependency.** Ask the user before adding another (runtime or dev).
- **All randomness goes through `src/core/random.js`** (`ctx.rng('name')`), and **all time goes through
  `src/core/clock.js`** (`ctx.clock`, or the `dt`/`t` passed to `update`). `Math.random`, `Date.now`,
  `new Date`, `performance.now`, `THREE.Clock`/`Timer`, `MathUtils.rand*`/`seededRandom` and the
  `.random()`/`.randomDirection()` methods of three's vectors and quaternions are forbidden anywhere
  else in `src/`. `npm run check` lints for these. three.js internals are exempt.

## 3. Commands

| Command | What it does |
|---|---|
| `npm install` | Installs deps; `postinstall` downloads Playwright's Chromium headless shell (cached per machine), the only browser the tools use. |
| `npm run dev` | Vite dev server. JS edits reload the page. Shader edits (`.glsl/.vert/.frag`, including `#include`d chunks) are hot-swapped into live materials without a reload, so the camera stays put. |
| `npm test` | Unit and invariant tests: `node --test` over `tests/*.test.js` (Node's built-in runner, no test deps). |
| `npm run build` | Production build to `dist/index.html` (single file, no sourcemaps). The build fails if it would emit anything other than `index.html`. |
| `npm run check` | `tools/check-build.js`: exactly one file in dist, no `<script src>`/`<link href>`, no URLs except XML namespaces, no network APIs or `import()`, size vs budget (warn > 3 MB raw, fail > 6 MB), plus the src/ determinism lint. |
| `npm run shot -- [args]` | Builds, then `tools/screenshot.js`: one PNG per view + `contact-sheet.png` + `info.json` in `screenshots/<label>/`, plus each view's measurements (banding view, zoomed crops, shimmer, motion strip, overdraw) in `screenshots/<label>/<view>/`, with the numbers and over-limit warnings in `info.json`. A reused label replaces the old capture. With `--checks` (`verify` passes it) the tool also checks itself and the game: that the shimmer and cost measurements still catch test scenes built to fail them, that the frame keeps its promises (smooth dark edges against a bright sky, depth precision from a hilltop, dithered gradients without bands), that errors nothing shows on screen (a broken shader out of sight, a bad WebGL call, a lost context) fail a capture, that captures are reproducible, and that a quality change (default preset to low and back) leaks no GPU resources and brings back the same picture. Then it runs the game for 30 frames in player mode (no `?capture`: real-time loop, input, start screen, frame readout), which captures never exercise, and a short benchmark run (`screenshots/<label>/benchmark.txt`). |
| `npm run verify` | test + build + check + shot with `--checks`. **The definition-of-done command.** |
| `node tools/screenshot.js --compare A B` | Before/after sheet `screenshots/compare/A_vs_B.png`: A, B and a diff column per view, with the % of changed pixels. No build needed. |

Screenshot args: `--views beach,shoreline` (default all), `--label before` (default `<git hash>[-dirty]-<timestamp>`),
`--size 1600x900`, `--t 12.5` (sim seconds), `--time 17.5` (hours, overrides each view's time),
`--seed 1`, `--quality high`, `--tonemap agx`, `--exposure 1.5`, `--fixture tonecard`, `--gl auto|hardware|swiftshader` (default
auto: hardware GL, falling back to SwiftShader), `--checks`.

URL params (dev server or `dist/index.html`): `?view=beach&time=17.5&t=12.5&seed=1&quality=low&capture=1`,
`tonemap=<name>` and `exposure=<x>` (a curve from `config.post.tonemaps` and the scene exposure, to compare looks), and `fixture=<name>` (a test scene
from `src/fixtures/` instead of the island; `tonecard` is an HDR test card for judging the look), and `depth=fallback` (the depth set-up of
browsers without EXT_clip_control, see section 8). In the game,
`stats=1` shows the frame readout (F3 toggles it) and `bench=1` runs the benchmark: it visits every view and ends
with a summary of frame and GPU times to paste into a session (`benchSeconds=<s>` sets the time per view).

Dev-only key: **P** logs the camera as a ready-to-paste `views.js` entry and copies it to the clipboard.

### Fresh Linux machines (cloud sessions)

Cloud sessions run in a Linux container with no GPU and no display, so screenshots are the only way to see the game.

- Run `npm ci`, then once per machine `npx playwright install-deps chromium` (apt, needs root). Without the
  system libraries, the screenshot tool fails with "missing system library ..." and prints that command.
- `--gl auto` finds no GPU and falls back to SwiftShader (a few seconds per view at 1600×900, measurements included; the tool
  warns when a frame gets slow).
- SwiftShader captures from here compare directly with CI and local `--gl swiftshader` captures (see section 4).

### Deploying

`.github/workflows/deploy.yml` runs on every push. On `main` it runs all three jobs; on any other branch (and for a
manual "Run workflow" there) it runs only the build job:

1. **build** (read-only token): `npm ci`, then `npm run verify -- --gl swiftshader` (runners have no GPU).
   It uploads the screenshots as a workflow artifact for review, even when the run fails.
2. **deploy-pages**: publishes `dist/` to https://bstummer.github.io/tropical-island/. It needs
   Settings → Pages → Source: "GitHub Actions". With "Deploy from a branch", GitHub's own Jekyll build
   also publishes the raw repo on every push and races this job, so the job fails until that is set.
3. **release**: points the `latest` tag at the commit and replaces the asset of the rolling release
   "Latest build". The download link is always the newest build:
   https://github.com/bstummer/tropical-island/releases/latest/download/tropical-island.html

So: nothing built is committed, a failing `verify` blocks both publishing steps, and publishing means
pushing to `main`.

- Only the build job runs `npm ci`. The publishing jobs get write tokens and run no code from
  `node_modules`. Keep it that way.
- Don't hand-edit the `latest` tag or release, and don't create other releases. A newer "latest" release
  would take over the `releases/latest/download/...` link.
- CI screenshots come from SwiftShader. Compare them only with local `--gl swiftshader` captures.

## 4. Visual workflow

For every change that can affect pixels:

1. `npm run shot -- --label before` on the current state, before editing.
2. Make the change.
3. `npm run shot -- --label after`
4. `node tools/screenshot.js --compare before after`, then **open and look at**
   `screenshots/compare/before_vs_after.png`, and at full-size PNGs where detail matters.
5. **Never claim a visual improvement without actually looking at the images.** Say what you saw,
   including what got worse. A still frame can't show motion or speed on real hardware: name what you
   couldn't check and leave it to the user.

- Only compare captures from the **same GL backend**: hardware and SwiftShader differ by a few levels
  everywhere and more at edges. The compare sheet warns when the backends, Chromium builds, size or params
  differ. Use `--gl swiftshader` on both sides if hardware GL is flaky.
- Captures are deterministic: the same args on the same backend give byte-identical PNGs. An
  "identical" result in the compare sheet really means nothing changed, and any diff is real.
- SwiftShader output is also byte-identical across Windows and Linux, as long as the Chromium build is the
  same (`info.json` records it; `package-lock.json` pins Playwright, which pins the build).
- When you build a new area or feature, add views for it to `src/views.js` (fly there in dev, press P,
  paste). Keep the existing views stable so history stays comparable.
- Give each new view a `brief`: one line on what the shot is for (focal point, where the sun sits, the
  mood). Reviews judge each capture against its brief.

## 5. Testing

**Pure logic gets tests; visuals get screenshots.** Anything with an answer that can be checked without
looking (seeded randomness, param parsing, clock behaviour, the build checker, terrain maths, placement
rules) gets tests in `tests/`. Anything judged by eye goes through the screenshot workflow above.

When you add world logic (height function, placement zones, viewpoints), add **invariant tests** that
check properties of the output, not specific numbers. Examples:

- Every view is above the terrain and above the water.
- No plants below the waterline or on slopes steeper than the species allows.
- Placement zones are ordered from shore to jungle, and every point on the island falls in exactly one.
- Anything computed both in JS and on the GPU agrees at sample points (the height function and its
  heightmap, for one). Where the GPU side can't run in Node, check it in the browser, in the screenshot
  tool's run.

Run invariants over several seeds (say 1–20), not just the game's seed, so a lucky seed can't hide a bug.
The game uses one seed for now (`config.defaults.seed`; PLAN.md, Decisions), and the views are framed on it,
so checks tied to the views (such as "every view is above the terrain") run on that seed only.

How tests are written:

- `node:test` and `node:assert/strict` only. No test dependencies; ask before adding one.
- Files are `tests/<module>.test.js`. `npm test` runs `node --test` with Node's default discovery
  (`node --test tests/` breaks on newer Node versions), so nothing outside `tests/` may have a name it runs as a test
  (`*.test.js`, `*-test.js`, `*_test.js`, `test-*.js`, `test.js`, or any file in a `test/` folder). `tests/layout.test.js` checks this.
- Tests import from `src/` directly. Keep logic **pure and Node-importable** so they can: no shader
  imports, no DOM access at import time. Put the maths in its own module (e.g. `world/island.js`) and keep
  the three.js and shader wiring in the system that uses it.
- Tests are deterministic: fixed seeds, and mock time with `t.mock.method(performance, 'now', ...)`.
- `tools/check-build.js` exports its checks. HTML fixtures live in `tests/fixtures/check-build/`:
  `pass/*.html` must produce no failures, and each `fail/<rule-id>.html` must trip exactly that rule.
  A new rule needs a new fail fixture; a test enforces this.
- A test that has never failed proves little. When adding one, break the code it covers once and
  watch it go red.

## 6. Architecture

```
index.html            source template: canvas, start and error overlays, readout and benchmark panels; loads src/main.js
vite.config.js        single-file build to dist/; glsl includes; dev shader hot-swap; strips URLs from three's GLSL comments;
                      stamps the commit into the build (__BUILD__)
README.md             for players and visitors: play/download links, controls, dev quickstart
PLAN.md               staged build plan, status and session log; update it at the end of every session
.github/workflows/    deploy.yml: verify, then GitHub Pages + rolling "latest" release on every push to main
src/
  main.js             boot: params -> renderer/scene/camera/frame -> systems -> loop; capture mode hands over to core/capture.js
  config.js           ALL tunables (quality presets, camera, post, movement, defaults, capture, frame-cost budget, size budget). No browser APIs.
  views.js            named viewpoints. No browser APIs (Node imports it).
  core/               params.js, clock.js, random.js, renderer.js, camera.js, input.js (free-fly + pointer lock),
                      capture.js (the capture contract), gl-stats.js (GPU call counts, memory, GPU time), overdraw.js
                      (capture only), readout.js (F3), benchmark.js (?bench=1), timing.js (their statistics and text)
  post/               frame.js (HDR target, passes, output pass: tonemap, sRGB, dither), scene-output.js; later
                      bloom and colour grading. The only place tonemapping happens.
  fixtures/           test scenes for the screenshot tool's checks and the tonecard (?fixture=); not part of the island
  world/placeholder*  TEMPORARY stand-in world (sky dome, sand mound, flat water). Delete once replaced.
  shaders/chunks/     shared GLSL: noise.glsl, scene-output.glsl (how every scene material ends); wind and lighting later
tools/                screenshot.js, measure.js, analyse.js (its worker thread), image.js, png.js, check-build.js (Node only; pure
                      helpers exported for tests)
tests/                node:test suites + fixtures/check-build/{pass,fail}/*.html
```

Planned folders. Create each one when its first real system lands, not before (no empty stubs). The
contents listed are suggestions, except that `world/island.js` holds the one height function, which is a
rule:

- `sky/`: atmosphere scattering, clouds, the sun, time of day (owns `ctx.timeOfDay`: daylight hours only; it changes only when set, never on its own).
- `water/`: ocean surface, shoreline wash and foam, ripples, shallow-water colour from depth.
- `plants/`: leaf atlas, shared wind, one file per species (`palm-coconut.js`, ...).
- `world/`: `island.js` is the **single source of truth for the height function**. It is evaluated in JS
  for placement and collision and uploaded as a heightmap texture for shaders, so nothing re-implements it
  in GLSL. Also terrain and placement zones from shore to jungle (wet sand, dry sand, beach scrub,
  palm belt, jungle).
- `textures/`: procedural texture generators (render-to-texture or CPU canvases), cached per session.
- `audio/`: procedural WebAudio (surf, wind, birds). Must not start before a user gesture.
- `player/`: walking, terrain collision, head bob; replaces free-fly as the default controller.

## 7. Module contract

Every system is one module exporting `create(ctx)`, which returns `{ update(dt, t), dispose() }`, and
optionally `ready` (a Promise, awaited before a capture starts, for async setup). Register world systems in
`WORLD_SYSTEMS` in `src/main.js`; they update in that order every frame, after input.

`ctx` holds: `renderer`, `scene`, `camera`, `config`, `quality` (the active preset object), `params`
(parsed URL params), `view` (the starting view), `timeOfDay` (hours), `clock` (`elapsed`, `dt`, `frame`,
`frozen`, `interval`), `stats` (GPU counts, memory and GPU time from `core/gl-stats.js`), `rng` (`rng('name')` returns a stream with `next/range/int/chance/pick/normal`), and `frame`
(`post/frame.js`: `size` and `onResize(fn)` for the drawing buffer, `uniforms` every scene material shares,
`beforeScene(fn)` for passes of a system's own such as shadow maps, and `sceneTarget`).

- `update(dt, t)`: `dt` and `t` come from the clock. In capture mode `dt` is 0 and `t` is frozen, so
  anything time-driven must look the same at a given `t` in a capture as in the running game. A function
  of `t` is the simplest way. Effects that need history (things that build up and fade) may simulate
  instead, if the simulation is deterministic and a capture can reproduce its state at `t`, also when it
  jumps to another `t` in the same page (`clock.seek`).
  An exception in `update()` stops the loop and shows the error overlay (in capture mode it fails the capture).
- Each system uses its own rng stream name (`rng('palms')`, `rng('palms/fronds')`). `rng(name)` always
  restarts the same sequence, and new names never shift existing systems.
- `dispose()` removes everything the system added and disposes GPU resources. A quality change disposes the
  frame and every world system and creates them again (`setQuality` in `main.js`), so a system can't assume it
  lives forever, and reads `ctx.frame` and `ctx.quality` afresh in `create()`. The screenshot tool's teardown
  check fails on GPU objects left behind, and on scene objects, fog, background or environment left in the scene.
- UI must stay hidden when `ctx.params.capture` is true.

**Capture contract** (`?capture=1`, used by tools/screenshot.js): no UI or pointer lock. The camera goes to
the requested view and the clock is frozen at `t`. `core/capture.js` awaits `ready`, compiles, checks that every
shader program compiled (also those nothing draws yet) and that every scene material ends with `sceneOutput()`,
renders `config.capture.warmupFrames` frames, then sets
`window.__CAPTURE_READY__ = true` (and `__CAPTURE_INFO__`). Any failure sets `window.__CAPTURE_ERROR__`.
Once ready, `window.__CAPTURE__` renders more frames in the same page (another `t`, the camera nudged) and
reports GPU counts and overdraw. A frame rendered at another `t` must match a fresh load at that `t`; the
tool checks this (with `--checks`). Don't break this. If a new system does async work, put it behind `ready`.

## 8. Rendering conventions

- **WebGL2** through three's `WebGLRenderer`, with GLSL shaders. Not WebGPU (PLAN.md, Decisions).
- Linear colour workflow. Author colours as sRGB hex through `THREE.Color` (converted to linear) or as
  linear floats in shaders, and say which in a comment.
- The scene renders into the **HDR target** of `post/frame.js` (half float, MSAA). Its output pass is the
  **only** place for tonemapping, sRGB conversion and dithering; the renderer keeps `NoToneMapping`.
- **Every scene material ends with `gl_FragColor = sceneOutput(radiance, alpha);`**
  (`chunks/scene-output.glsl`): it applies the exposure and compresses the colour so MSAA averages edges
  close to how they look after tonemapping. Spread `ctx.frame.uniforms` into the material's uniforms.
  Built-in three.js materials go through `withSceneOutput()` (`post/scene-output.js`), once, after any
  `onBeforeCompile` of their own; capture mode fails on a scene material without `sceneOutput()`. Scene materials
  never include `<colorspace_fragment>` or dithering. `scene.background` and the clear colour skip
  `sceneOutput()`, so the sky is a scene material. Blending happens in the compressed space: right where
  alpha means coverage (edges, foam masks) or both colours are well below 1, wrong for translucent layers
  over bright ones (a cloud card darkens the sky behind it by stops) and for adding bright light. Such
  effects need their own approach, such as a pass that reads the HDR target with `sceneRadiance()`.
- **Anti-aliasing is MSAA** (`quality.msaa`), which shades once per pixel. Cut-out edges (leaves) use
  alpha-to-coverage. Shading that can sparkle or crawl (glints, fine procedural detail) is filtered in the
  shader by its pixel footprint (`fwidth`). Geometry thinner than about two pixels crawls even with MSAA,
  so each system's level of detail keeps it out.
- **Depth is reversed 32-bit float** (EXT_clip_control), so precision is about the same fraction of the
  distance everywhere: `camera.near` is 2 cm and `far` 100 km (`config.camera`). Without the extension
  (Firefox), near moves out to 0.5 m and distant shallow water can z-fight; `?depth=fallback` renders that way
  in any browser, and `verify` runs the depth fixture so.
- Avoid huge triangles. Tessellate large planes (water, ground skirts): rasterizers clip and interpolate
  giant triangles differently, which moved the shoreline by metres between GPUs.

## 9. Code conventions

- One system per file. Plain JS ES modules, no TypeScript, no UI framework.
- Tunables live in `src/config.js`, never as magic numbers buried in systems. Per-quality knobs go in
  the quality presets.
- Shaders live in `.glsl/.vert/.frag` files next to the system that uses them, imported as strings and used
  with `ShaderMaterial` or `RawShaderMaterial`. Shared code goes in `src/shaders/chunks/`:
  - From any shader: `#include "chunks/noise.glsl"` (resolved to src/shaders/chunks/ from any folder).
  - Inside a chunk, include sibling chunks relatively: `#include "hash.glsl"`. A chunk reached twice
    (two chunks both include `hash.glsl`) lands in the shader once, so chunks need no include guards.
  - `#include <name>` with angle brackets is three.js's ShaderChunk system and is left untouched.
  - vite-plugin-glsl strips shader comments, and shader hot-swap matches materials by source string, so
    pass the imported string straight to the material where you can. Composed strings fall back to a
    page reload.
- Match the existing style: small modules, short comments that explain *why*, no dead code.

## 10. Performance budget

60 fps at 1080p on a mid-range laptop (integrated or entry-level GPU) at the `high` preset's defaults.
Weaker machines use `?quality=medium|low`; every expensive system (shadow resolution, plant density,
water detail, post effects) reads its knobs from `ctx.quality`.

## 11. Definition of done

- `npm run verify` passes: tests, build, check, and screenshots plus the player-mode run with zero
  console, page, shader or WebGL errors.
- New or changed pure logic has tests, and new world logic has invariant tests (section 5).
- The before/after `--compare` contact sheet has been opened and reviewed, and you can say what changed.
- New areas have views in `views.js`.
- This file is updated if the structure, commands, conventions or contract changed.
- PLAN.md's status table and log are updated. A finished stage goes to `review` with its list of known
  flaws; only the user marks it `done`.
