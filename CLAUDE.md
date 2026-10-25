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
- **No runtime dependencies.** The renderer (`src/gpu/`, raw WebGPU) and the maths (`src/maths/`) are the
  project's own. The build fails on any module from outside `src/` (and `index.html`), and `npm run check`
  lints that `src/` imports only its own files. Ask the user before adding a dependency (runtime or dev).
- **All randomness goes through `src/core/random.js`** (`ctx.rng('name')`), and **all time goes through
  `src/core/clock.js`** (`ctx.clock`, or the `dt`/`t` passed to `update`). `Math.random`, `Date.now`,
  `new Date` and `performance.now` are forbidden anywhere else in `src/`. `npm run check` lints for these.

## 3. Commands

| Command | What it does |
|---|---|
| `npm install` | Installs deps; `postinstall` downloads Playwright's Chromium headless shell (cached per machine), the only browser the tools use. |
| `npm run dev` | Vite dev server. JS edits reload the page. Shader edits (`.wgsl`, including `#include`d chunks) are hot-swapped into live scene materials without a reload, so the camera stays put; shaders of fullscreen passes and of the sky's lookup tables reload the page. |
| `npm test` | Unit and invariant tests: `node --test --test-concurrency=4` over `tests/*.test.js` (Node's built-in runner, no test deps; without the flag, CI's two CPUs run one file at a time). |
| `npm run build` | Production build to `dist/index.html` (single file, no sourcemaps). The build fails if it would emit anything other than `index.html`, or bundle a module from outside `src/`. |
| `npm run check` | `tools/check-build.js`: exactly one file in dist, no `<script src>`/`<link href>`, no URLs except XML namespaces, no network APIs or `import()`, size vs budget (warn > 3 MB raw, fail > 6 MB), plus the src/ lint: determinism, and imports of src/ files only. |
| `npm run shot -- [args]` | Builds, then `tools/screenshot.js`: one PNG per view + `contact-sheet.png` + `info.json` in `screenshots/<label>/`, plus each view's measurements (banding view, zoomed crops, shimmer, motion strip, overdraw) in `screenshots/<label>/<view>/`, with the numbers and over-limit warnings in `info.json`. A reused label replaces the old capture. With `--checks` (`verify` passes it) the tool also checks itself and the game: that the shimmer and cost measurements still catch test scenes built to fail them, that the frame keeps its promises (smooth dark edges against a bright sky, depth precision from a hilltop, dithered gradients without bands, translucent layers blended in linear light and hidden behind the scene, the opaque scene handed to what draws after it), that errors nothing shows on screen (a broken shader out of sight, a validation error, a lost device, blending outside the translucent pass) fail a capture, that captures are reproducible, also after the time of day changed in the page (on every view, through every named time), that the GPU's sky maths agrees with the JS, that the terrain's heights on the GPU are the ones JS knows and keep close to the island's between samples, and the mesh's own height as drawn is its JS twin's, and that the light from below reads the ground's albedo map where JS expects it (`terrain` fixture, also with deliberate mistakes), that the rocks' offsets in the mesh as drawn and their vertex shader put them where their JS twins do (`rocks` fixture, likewise), that the green's patches on the GPU are the ones JS knows (`patches` fixture), that the sky's lookup tables agree with direct marches through the same air, and the sunlight by height with one in JS, also in the last minutes of daylight (`haze` fixture), and that the light reads neutral at midday and warm at golden hour, and that a quality change (default preset to low and back) leaks no GPU resources and brings back the same picture. Then it runs the game in player mode until it draws (no `?capture`: real-time loop, input, start screen, frame readout, walking on the ground, and a canvas that shows what the capture of the same view does), which captures never exercise, and a short benchmark run (`screenshots/<label>/benchmark.txt`). |
| `npm run verify` | test + build + check + shot with `--checks`. **The definition-of-done command.** |
| `npm run map -- [args]` | `tools/map.js`: a top-down map of the island (relief, depths, zones, where the views stand) in `screenshots/map/<label>.png`, to judge the layout without rendering. `--seed`, `--label`, and `--set path=value` (repeatable) to override a setting of `config.world.island` for candidates. No build needed. |
| `node tools/screenshot.js --compare A B` | Before/after sheet `screenshots/compare/A_vs_B.png`: A, B and a diff column per view, with the % of changed pixels and how many differ by more than 2 levels. No build needed. |
| `node tools/linux.js <command>` | Runs a command in a Linux container like CI's runner (Docker), with the repo mounted: how Windows and macOS make SwiftShader captures (section 4), e.g. `node tools/linux.js npm run verify -- --gl swiftshader`. |

Screenshot args: `--views beach,shoreline` (default all), `--label before` (default `<git hash>[-dirty]-<timestamp>`),
`--size 1600x900`, `--t 12.5` (sim seconds), `--time 17.5` or `--time sunset` (overrides each view's time),
`--seed 1`, `--quality high`, `--tonemap agx`, `--exposure 1.5`, `--fixture tonecard`, `--gl auto|hardware|swiftshader` (the
WebGPU adapter; default auto: the machine's GPU, falling back to SwiftShader, which exists on Linux only), `--checks`.
`SCREENSHOT_PROGRESS=1` in the environment reports each check as it ends, to find one that hangs.

URL params (dev server or `dist/index.html`): `?view=beach&time=17.5&t=12.5&seed=1&quality=low&capture=1`.
`time` takes hours of daylight or a named time (`sunrise`, `midday`, `golden-hour`, `sunset`; `sky/sun.js`), and
anything at night is an error. Also
`tonemap=<name>` and `exposure=<x>` (a curve from `config.post.tonemaps`, and a factor on the exposure, which follows the light; to compare looks), and `fixture=<name>` (a test scene
from `src/fixtures/` instead of the island; `tonecard` is an HDR test card for judging the look, `light` shows the lighting on test objects without the island). In the game,
`stats=1` shows the frame readout (F3 toggles it) and `bench=1` runs the benchmark: it visits every view and ends
with a summary of frame and GPU times to paste into a session (`benchSeconds=<s>` sets the time per view,
`benchWarmupFrames=<n>` the frames each view waits at least before it is measured).

Dev-only keys: **P** logs the camera as a ready-to-paste `views.js` entry and copies it to the clipboard.
**,** and **.** step the time of day (Shift: to the previous or next named time).

### Fresh Linux machines (cloud sessions)

Cloud sessions run in a Linux container with no GPU and no display, so screenshots are the only way to see the game.

- Run `npm ci`, then once per machine `npx playwright install-deps chromium` (apt, needs root). Without the
  system libraries, the screenshot tool fails with "missing system library ..." and prints that command.
- `--gl auto` finds no GPU and falls back to SwiftShader (about half a minute per view at 1600×900 on a desktop CPU,
  measurements included, and two to three times that on CI's runners; the tool warns when a frame gets slow).
- SwiftShader captures from here compare directly with CI and local `--gl swiftshader` captures (see section 4).

### Deploying

`.github/workflows/deploy.yml` runs on every push that changes more than Markdown (no `.md` file goes into the
build or the checks, so a docs-only push publishes nothing). On `main` it runs all three jobs; on any other branch
(and for a manual "Run workflow" there) it runs only the build job:

1. **build** (read-only token): `npm ci`, then `npm run verify -- --gl swiftshader` (runners have no GPU).
   It uploads the screenshots as a workflow artifact for review: all of them for 14 days when the run fails, the
   views, contact sheet and numbers for 7 days when it passes (the rest comes back from a capture of the commit).
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

- Only compare captures from the **same backend** (WebGPU adapter): hardware and SwiftShader differ by a
  few levels everywhere and more at edges. The compare sheet warns when the backends, Chromium builds,
  size or params differ. Use `--gl swiftshader` on both sides if the hardware is flaky.
- Captures are deterministic: the same args on the same backend give byte-identical PNGs. An
  "identical" result in the compare sheet really means nothing changed, and any diff is real.
- WebGPU has a SwiftShader adapter on Linux only. On Windows and macOS, SwiftShader captures come from a
  Linux container: `node tools/linux.js node tools/screenshot.js --gl swiftshader ...` (Docker; the image
  is built on first use). They are byte-identical to CI's and a cloud session's, as long as the Chromium
  build is the same (`info.json` records it; `package-lock.json` pins Playwright, which pins the build).
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
  the GPU and shader wiring in the system that uses it.
- Tests are deterministic: fixed seeds, and mock time with `t.mock.method(performance, 'now', ...)`.
- `tools/check-build.js` exports its checks. HTML fixtures live in `tests/fixtures/check-build/`:
  `pass/*.html` must produce no failures, and each `fail/<rule-id>.html` must trip exactly that rule.
  A new HTML rule needs a new fail fixture; a test enforces this. Source rules (the src/ lint) are tested
  with trees of files the test writes.
- A test that has never failed proves little. When adding one, break the code it covers once and
  watch it go red.

## 6. Architecture

```
index.html            source template: canvas, start and error overlays, readout and benchmark panels; loads src/main.js
vite.config.js        single-file build to dist/; shader includes; dev shader hot-swap; stamps the commit into the build (__BUILD__)
README.md             for players and visitors: play/download links, controls, dev quickstart
PLAN.md               staged build plan, status and session log; update it at the end of every session
.github/workflows/    deploy.yml: verify, then GitHub Pages + rolling "latest" release on every push to main
src/
  main.js             boot: params -> renderer/scene/camera/frame -> systems -> loop; capture mode hands over to core/capture.js
  config.js           ALL tunables (quality presets, camera, post, movement, defaults, capture, frame-cost budget, size budget). No browser APIs.
  views.js            named viewpoints. No browser APIs (Node imports it).
  maths/              the maths three.js gave the game, ported from it to the last bit (pure): vectors, matrices, quaternions,
                      Euler angles, culling shapes, colours, half floats; index.js exports them, with three.js's MIT notice
  gpu/                the renderer (raw WebGPU): device.js (the device, error reporting, caches),
                      renderer.js (draws a pass: pipelines, culling; fullscreen passes; compile),
                      scene.js (nodes and meshes, three's draw order), material.js, geometry.js, texture.js (textures, render targets,
                      mipmaps, readbacks), reflect.js (what a WGSL module declares, to bind by name), bindings.js
  core/               params.js, clock.js, random.js, renderer.js (the display: device, renderer, canvas size), camera.js,
                      input.js (free-fly + pointer lock), capture.js (the capture contract), gpu-stats.js (GPU counts,
                      memory, GPU time), overdraw.js (capture only), readout.js (F3), benchmark.js (?bench=1), timing.js
                      (their statistics and text)
  sky/                sky.js (the sky, and the light state every lit material reads), atmosphere.js/.wgsl (its lookup
                      tables, after Hillaire 2020), light.js (light-state maths: SH, exposure), sun.js (time of day:
                      daylight, named times, the sun's path), time-control.js (dev keys)
  post/               frame.js (HDR target, the frame's passes, post chain, output pass: tonemap, sRGB, dither),
                      scene-check.js (the materials capture mode checks); later bloom and colour grading. The only
                      place tonemapping happens.
  fixtures/           test scenes for the screenshot tool's checks and the tonecard (?fixture=); not part of the island
  world/              island.js (the island's shape: the height function and the placement zones; pure), noise.js (its noise, a cell hash
                      and the hash's noise, which the GPU shares), green.js (where the green inland is green and where bare; pure),
                      heightmap.js (the island as drawn: nested grids of it, and their sampler; pure), heightmap-worker.js
                      (builds them), lod.js (picks the terrain's mesh for a camera, and the mesh's own height; pure),
                      albedo.js (the ground's albedo from above, for the light it sends up; pure), terrain.js (the ground
                      and seabed), scatter.js (things scattered over the ground by rules, keeping clear of each
                      other; pure), rock-shapes.js,
                      rock-placement.js (pure) and rocks.js (rocks and boulders)
  world/placeholder*  TEMPORARY stand-in water (flat, coloured by depth). Delete once replaced.
  textures/           procedural textures made on the GPU at boot: surfaces.js (the ground's tiles, in one texture array), which
                      sand.js (the sand's grain and ripple tiles), rock.js (the rock's detail tile) and green.js (the grass's and
                      the leaf litter's tiles) draw into; tileable.wgsl
  shaders/chunks/     shared WGSL: frame.wgsl (what every scene material binds at group 0: the camera and
                      ctx.frame.uniforms), object.wgsl (a mesh's transform, group 2), fullscreen.wgsl (one-triangle
                      passes), noise.wgsl, scene-output.wgsl (how every scene material ends), lighting.wgsl (the
                      shared lighting model, with sky-view.wgsl, aerial.wgsl, sunlight.wgsl, sh.wgsl and angles.wgsl),
                      terrain.wgsl (the terrain's heights, slopes and ground, as heightmap.js samples them),
                      terrain-mesh.wgsl (the terrain's mesh as drawn, which what stands on it follows), sand.wgsl,
                      rock.wgsl and green.wgsl (the sand's, the rock's and the green's surfaces, with tiles.wgsl, wet.wgsl:
                      how wet the ground is, and patches.wgsl: where the green grows), planet.wgsl (the planet's bend, see
                      section 8);
                      wind later
tools/                screenshot.js, measure.js, analyse.js (its worker thread), image.js, png.js, check-build.js, map.js (Node
                      only; pure helpers exported for tests); linux.js and linux.Dockerfile (a Linux container like CI's)
tests/                node:test suites + fixtures/check-build/{pass,fail}/*.html, fixtures/maths/ (three.js's answers)
```

Planned folders. Create each one when its first real system lands, not before (no empty stubs). The
contents listed are suggestions, except that `world/island.js` holds the one height function, which is a
rule:

- `sky/` (exists): atmosphere scattering, clouds, the sun, time of day (owns `ctx.timeOfDay`: daylight hours only; it changes only when set, never on its own).
- `water/`: ocean surface, shoreline wash and foam, ripples, shallow-water colour from depth.
- `plants/`: leaf atlas, shared wind, one file per species (`palm-coconut.js`, ...).
- `world/` (exists): `island.js` is the **single source of truth for the height function**. It is evaluated in JS
  for placement and collision and uploaded as a heightmap texture for shaders, so nothing re-implements it
  in WGSL. Also terrain and placement zones from the reef to the jungle (lagoon, reef, ocean; wet sand,
  dry sand, beach scrub, palm belt, jungle; rock where it is steep or the shore is rocky).
- `audio/`: procedural WebAudio (surf, wind, birds). Must not start before a user gesture.
- `player/`: walking, terrain collision, head bob; replaces free-fly as the default controller.

## 7. Module contract

Every system is one module exporting `create(ctx)`, which returns `{ update(dt, t), dispose() }`, and
optionally `ready` (a Promise, awaited before a capture starts, for async setup) and `settled()` (a Promise
while work its `update` started is still in flight, such as the sky's light read back after a time change,
else nothing; a capture renders again once it lands). Register world systems in `WORLD_SYSTEMS` in `src/main.js`; they update in that order every frame,
after input.

`ctx` holds: `gpu` (the device and what shares it: `gpu/device.js`), `renderer` (`gpu/renderer.js`), `canvas`,
`scene` (a `gpu/scene.js` Scene), `camera`, `config`, `quality` (the active preset object), `params`
(parsed URL params), `view` (the starting view), `timeOfDay` (hours of daylight; it also takes a named time, and a time at
night throws), `clock` (`elapsed`, `dt`, `frame`,
`frozen`, `interval`), `stats` (GPU counts, memory and GPU time from `core/gpu-stats.js`), `rng` (`rng('name')` returns a stream with `next/range/int/chance/pick/normal`), `terrain`
(`world/terrain.js`: `island`, `heightAt(x, z)` the ground's height at its finest, which the mesh matches near the camera but
not far out, where its coarser levels stray from it, `heightmap` and its `ready`, `grids` (a promise of the heightmap
as soon as its grids are in, before `ready`, which waits for the surfaces' tiles too), `mesh` and `meshHeightAtCove` (the
mesh as drawn, for what stands on it: chunks/terrain-mesh.wgsl and its JS twin), `surfaces` (the ground's
surfaces' uniforms, for what is made of them or lies on them), `greenAt(x, z)` (whether the green inland is green or
bare there, as drawn: world/green.js); it exists while the terrain
system does, so systems that read it in `create()` come after `terrain` in `WORLD_SYSTEMS`), `rocks`
(`world/rocks.js`: `ready`, then `placed` and `shapes`, kept per seed through a quality change, so read-only, and `clearance`, the rocks' footprints, which later
placement passes to `world/scatter.js` to keep clear of them; likewise after `rocks`), `sky` (`sky/sky.js`:
`ready`, the first light state; after `sky` in `WORLD_SYSTEMS`), and `frame`
(`post/frame.js`: `size` and `onResize(fn)` for the drawing buffer, `uniforms` every scene material shares (the
exposure, the light state and the terrain's grids, bound at group 0 through `chunks/frame.wgsl`),
`beforeScene(fn)` for passes of a system's own such as shadow maps, `passes` (a mesh's `pass` names one),
`translucent(object)`, `opaque` (`{ color, depth }`), `addPost(fn)`, `skyOrder`, `sceneTarget`, and
`outputMaterials` and `compile()` for the capture; see §8).

- The time of day changes only when it's set, but it can be set while the game runs: a system that depends on it
  follows `ctx.timeOfDay` in `update()`, not only in `create()`.
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
  check fails on GPU objects left behind (textures, render targets, buffers, query sets, pipelines), and on
  scene objects left in the scene.
- UI must stay hidden when `ctx.params.capture` is true.

**Capture contract** (`?capture=1`, used by tools/screenshot.js): no UI or pointer lock. The camera goes to
the requested view and the clock is frozen at `t`. `core/capture.js` awaits `ready`, compiles, checks that every
pipeline compiled (also those nothing draws yet), that every scene material ends with `sceneOutput()`
and that only the translucent pass blends,
renders `config.capture.warmupFrames` frames, then sets
`window.__CAPTURE_READY__ = true` (and `__CAPTURE_INFO__`). Any failure sets `window.__CAPTURE_ERROR__`.
Once ready, `window.__CAPTURE__` renders more frames in the same page (another `t`, the camera nudged, another
time of day) and reports GPU counts and overdraw. A frame rendered at another `t` or time of day must match a
fresh load at that `t` or time; the tool checks both (with `--checks`). Don't break this. If a new system does
async work, put it behind `ready`, or behind `settled()` when its `update` starts it.

## 8. Rendering conventions

- **WebGPU** through the project's own renderer (`src/gpu/`), with WGSL shaders.
  There is no WebGL fallback: without WebGPU the game says what it needs (`gpu/device.js`). Core WebGPU
  only: no optional feature is required (`timestamp-query` gives the GPU time where it exists).
- Linear colour workflow. Author colours as sRGB hex through `Color` (`maths/color.js`, converted to linear)
  or as linear floats in shaders, and say which in a comment.
- The scene renders into the **HDR target** of `post/frame.js` (half float, 4× MSAA). Its output pass is the
  **only** place for tonemapping, sRGB conversion and dithering.
- **Every scene material's fragment entry point ends with `return sceneOutput(radiance, alpha);`**
  (`chunks/scene-output.wgsl`): it applies the exposure and compresses the colour so MSAA averages edges
  close to how they look after tonemapping. Capture mode fails on a scene material without it. Scene
  materials never tonemap or dither. The clear colour skips `sceneOutput()`, so the sky is a scene material:
  it draws last in the opaque pass, on the far plane (`renderOrder = frame.skyOrder`), so sky hidden behind
  land costs nothing.
- **Bindings by name.** Group 0 is the frame's (`chunks/frame.wgsl`, which `scene-output.wgsl` includes): the
  camera and `ctx.frame.uniforms`, which the renderer binds for every scene material. Group 1 is the
  material's own: its `uniforms` fill the module's `var<uniform>` structs field by field and its textures by
  name, each texture's sampler at `<name>Sampler` (a texture without one, such as `r32float`, is read with
  `textureLoad`, or with `textureGather` through an unfiltered `<name>Texels` sampler: per pixel, prefer the
  gather, as WebGPU bounds-checks every `textureLoad`). Group 2 is the mesh's transform (`chunks/object.wgsl`). Within group 1, chunks that bring
  bindings of their own (terrain, tiles, sand, rock, green, patches, wet) each keep a fixed binding number.
- **The frame draws in passes** (`post/frame.js` lists them), picked by the mesh's `pass`. Opaque meshes
  need nothing. Meshes that read the opaque scene's colour or depth (`frame.opaque`: water) set
  `pass = 'afterOpaque'`. **Anything translucent goes through `frame.translucent(object)`**, which
  blends it in linear light in a layer of its own: the HDR target blends in its compressed space, where a
  translucent layer over bright light (a cloud over the sky) darkens it by stops. Capture mode fails on a
  material that blends anywhere else. Alpha-to-coverage cut-outs are opaque. Post effects (bloom, god
  rays, grade) are `frame.addPost()` passes on linear HDR before the output.
- **Every lit material uses the shared lighting model** (`chunks/lighting.wgsl`): sunlight, sky light and aerial
  perspective, from the light state in `ctx.frame.uniforms` that `sky/` keeps in step with the time of day. Don't
  add lights or fog of a material's own. Shadows (Stage 5) and cloud shadows (Stage 10)
  join the light in its `sunVisibility()`. Light is in units of the sun's illuminance above the atmosphere; the
  exposure follows the light (`sky/light.js`), so author albedos, not brightnesses.
- **Anti-aliasing is MSAA with 4 samples** on every preset (WebGPU has 1 or 4), which shades once per pixel.
  Cut-out edges (leaves) use alpha-to-coverage. Shading that can sparkle or crawl (glints, fine procedural
  detail) is filtered in the shader by its pixel footprint (`fwidth`). Geometry thinner than about two pixels
  crawls even with MSAA, so each system's level of detail keeps it out. MSAA runs the fragment shader at the
  pixel centre, which at an edge can lie outside the triangle: varyings that can't be extrapolated, such as the
  world position of a surface reaching to the horizon, use `@interpolate(perspective, centroid)`.
- **Depth is reversed 32-bit float** (`depth32float`, compare `greater-equal`, cleared to 0) in every browser, so
  precision is about the same fraction of the distance everywhere: `camera.near` is 2 cm and `far` 100 km
  (`config.camera`). The projection (`Matrix4.makePerspective`, which `core/camera.js` uses) and the
  frustums set from it (`maths/bounds.js`) take reversed depth only.
- **WGSL** rules that bite:
  - Uniformity: `dpdx`/`dpdy`/`fwidth` and `textureSample` (which takes its own mip level) only in uniform
    control flow. Take derivatives before any branch that varies per pixel; inside one, read with
    `textureSampleGrad` or `textureSampleLevel`.
  - Variants are `override` constants, set per material (`overrides`), not text substitution. An array's size
    can't be an override: size it for the most a variant needs, and check the count in JS.
  - Uniform arrays hold `vec4f` elements: a scalar or `vec2f` array is refused by some browsers and packed
    tighter than 16 bytes by others (`gpu/reflect.js` refuses it). Booleans in uniforms are `u32`.
  - Y points down: fragment positions and texture rows count from the top, and `dpdy` is GLSL's `-dFdy`.
    Anything that renders to a texture and reads it back by position, or uses the fragment's y on screen
    (the dither), says which way it counts.
  - GLSL's `mod` floors, WGSL's `%` truncates: write `x - y * floor(x / y)` where negatives can occur.
  - Nothing may depend on the order of atomic operations (it varies from run to run, also on SwiftShader).
  - Readbacks are async (`texture.read()`): what depends on one lands whole when it resolves, behind `ready`
    or `settled()`, never in a frame half-way.
- Avoid huge triangles. Tessellate large planes (water, ground skirts): rasterizers clip and interpolate
  giant triangles differently, which moved the shoreline by metres between GPUs.
- The world is flat, the sky and the haze are a curved planet's. Surfaces that reach far (the sea, the terrain)
  bend down with the planet in their vertex shader (`planetDrop()` in `chunks/planet.wgsl`: distance² / 2R), so
  they end where the sky's horizon is, the haze before them matches the sky's, and the shoreline stays where it
  is at any distance. Whatever stands on them bends with them.

## 9. Code conventions

- One system per file. Plain JS ES modules, no TypeScript, no UI framework.
- Tunables live in `src/config.js`, never as magic numbers buried in systems. Per-quality knobs go in
  the quality presets.
- Shaders live in `.wgsl` files next to the system that uses them, one module per material with its vertex
  and fragment entry points (`vertexMain`, `fragmentMain` unless the material names others), imported as
  strings and used with `Material` (`gpu/material.js`). Shared code goes in `src/shaders/chunks/`:
  - From any shader: `#include "chunks/noise.wgsl"` (resolved to src/shaders/chunks/ from any folder).
  - Inside a chunk, include sibling chunks relatively: `#include "noise.wgsl"`. A chunk reached twice
    (two chunks both include `noise.wgsl`) lands in the shader once, so chunks need no include guards.
  - A system's own shared WGSL that other shaders `#include` (`sky/atmosphere.wgsl`) reaches the chunks by
    their root path: `#include "/chunks/sky-view.wgsl"`.
  - vite-plugin-glsl (it handles WGSL too) strips shader comments, and shader hot-swap matches materials by source string, so
    pass the imported string straight to the material where you can. Composed strings fall back to a
    page reload.
- Match the existing style: small modules, short comments that explain *why*, no dead code.

## 10. Performance budget

60 fps at 1080p on a mid-range laptop (integrated or entry-level GPU) at the `high` preset's defaults.
Weaker machines use `?quality=medium|low`; every expensive system (shadow resolution, plant density,
water detail, post effects) reads its knobs from `ctx.quality`.

## 11. Definition of done

- `npm run verify` passes: tests, build, check, and screenshots plus the player-mode run with zero
  console, page, shader or WebGPU errors.
- New or changed pure logic has tests, and new world logic has invariant tests (section 5).
- The before/after `--compare` contact sheet has been opened and reviewed, and you can say what changed.
- New areas have views in `views.js`.
- This file is updated if the structure, commands, conventions or contract changed.
- PLAN.md's status table and log are updated. A finished stage goes to `review` with its list of known
  flaws; only the user marks it `done`.
