# Tropical Island

Standing instructions for every session in this repo. Read this file fully before changing anything,
then [PLAN.md](PLAN.md): the stages the game is built in, what's done and what's next.

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

- **The output is one file**: `dist/index.html`, with all JS, CSS and shaders inlined, working when opened via
  `file://`. It is never committed: CI verifies, builds and publishes it on every push to `main`
  (`.github/workflows/deploy.yml`), so pushing to `main` publishes the game. `./index.html` is the source template.
- **No external assets and no runtime network access.** No fetch, XHR, WebSocket, CDN or font links, and no image
  or model files. `npm run check` enforces this, and the screenshot tool fails on any network request.
- **Everything is procedural**: geometry, textures, sky, sound. Generate it at runtime.
- **No runtime dependencies.** The renderer (`src/gpu/`, raw WebGPU) and the maths (`src/maths/`) are the
  project's own. The build fails on any module from outside `src/`, and `npm run check` lints that `src/`
  imports and `#include`s only its own files. Ask the user before adding any dependency, runtime or dev.
- **Randomness only through `src/core/random.js`** (`ctx.rng('name')`), **time only through
  `src/core/clock.js`** (`ctx.clock`, or the `dt`/`t` passed to `update`). `Math.random`, `Date.now`,
  `new Date` and `performance.now` are forbidden anywhere else in `src/`; `npm run check` lints for them.

## 3. Commands

| Command | What it does |
|---|---|
| `npm install` | Installs deps and Playwright's headless Chromium, the only browser the tools use. |
| `npm run dev` | Vite dev server. Shader edits hot-swap into live scene materials, so the camera stays put; the shaders of fullscreen passes and of the sky's tables reload the page. |
| `npm test` | Unit and invariant tests, `tests/*.test.js` (Node's built-in runner). |
| `npm run build` | `dist/index.html`. Fails on any other output, or a module from outside `src/`. |
| `npm run check` | `tools/check-build.js`: one self-contained file within the size budget, and the `src/` lint. |
| `npm run shot -- [args]` | Builds, then `tools/screenshot.js`: a PNG per view, `contact-sheet.png` and `info.json` in `screenshots/<label>/`, and per view its measurements (banding, zoomed crops, shimmer as the camera turns and as it moves, a motion strip, overdraw) and frame costs, with warnings past their limits. `--checks` adds the tool's checks of itself and of the game: test scenes built to fail the measurements, the GPU's results against their JS twins (`src/fixtures/`), reproducible captures, nothing leaked over a quality change, a run in player mode and a short benchmark. `tools/screenshot.js` lists them. |
| `npm run verify` | test + build + check + shot with `--checks`. **The definition-of-done command.** |
| `node tools/screenshot.js --compare A B` | Before/after sheet `screenshots/compare/A_vs_B.png`, with a diff column per view. |
| `npm run map -- [args]` | `tools/map.js`: a top-down map of the island (relief, depths, zones, where the views stand), to judge the layout without rendering. |
| `node tools/linux.js <command>` | Runs a command in a Linux container like CI's runner (Docker): SwiftShader captures on Windows and macOS (§4). |

Screenshot args: `--views beach,shoreline` (default: all not `disabled` in `src/views.js`), `--label` (default
`<git hash>[-dirty]-<timestamp>`), `--size 1600x900`, `--t 12.5` (sim seconds), `--time 17.5` or `--time sunset`,
`--seed`, `--quality`, `--tonemap`, `--exposure`, `--fixture`, `--gl auto|hardware|swiftshader` (auto: the GPU,
else SwiftShader, which exists on Linux only), `--checks`. `SCREENSHOT_PROGRESS=1` reports each check as it ends.

URL params: `?view=beach&time=17.5&t=12.5&seed=1&quality=low&capture=1`. `time` takes hours of daylight or a
named time (`sunrise`, `midday`, `golden-hour`, `sunset`); night is an error. Also `tonemap` and `exposure` (to
compare looks), `fixture=<name>` (a test scene from `src/fixtures/`; `tonecard` and `light` are for judging the
look), `stats=1` (the frame readout, F3) and `bench=1` (the benchmark: every view, then a summary to paste into
a session). Dev keys: **P** copies the camera as a `views.js` entry; **,** and **.** step the time of day
(Shift: to the next named time).

**Cloud sessions** run in Linux with no GPU and no display: run `npm ci`, then once per machine
`npx playwright install-deps chromium` (needs root). Captures fall back to SwiftShader, about half a minute a
view, and compare directly with CI's.

## 4. Visual workflow

For every change that can affect pixels:

1. `npm run shot -- --label before` on the current state, before editing.
2. Make the change.
3. `npm run shot -- --label after`
4. `node tools/screenshot.js --compare before after`, then **open and look at** the sheet, and at full-size
   PNGs where detail matters.
5. **Never claim a visual improvement without actually looking at the images.** Say what you saw, including
   what got worse. A still frame can't show motion or speed on real hardware: name what you couldn't check
   and leave it to the user.

- Captures are deterministic: the same args on the same backend give byte-identical PNGs, so any diff is real.
- Compare only captures from the **same backend** (WebGPU adapter): a GPU and SwiftShader differ by a few levels
  everywhere. CI's are SwiftShader's. WebGPU has SwiftShader on Linux only, so on Windows and macOS those come
  from `node tools/linux.js node tools/screenshot.js --gl swiftshader ...`, byte-identical to CI's while
  `package-lock.json` pins the same Playwright, and with it the same Chromium (`info.json` records it).
- A new area or feature gets views in `src/views.js` (fly there in dev, press P, paste), each with a `brief`:
  one line on what the shot is for (focal point, where the sun sits, the mood), which reviews judge it against.
  Keep existing views stable so history stays comparable.

## 5. Testing

**Pure logic gets tests; visuals get screenshots.** Anything with an answer that can be checked without looking
(seeded randomness, params, the clock, the build checker, terrain maths, placement rules) gets tests in `tests/`.

- World logic gets **invariant tests** of properties, not specific numbers: every view above the terrain and
  the water; no plants below the waterline or on slopes steeper than the species allows; every point on the
  island in exactly one placement zone. Run them over seeds 1–20, so a lucky seed can't hide a bug; checks
  tied to the views run on the game's one seed (`config.defaults.seed`), which they are framed on.
- What is computed both in JS and on the GPU agrees at sample points. Where the GPU side can't run in Node,
  check it in the browser, in the screenshot tool's run (a fixture).
- `node:test` and `node:assert/strict` only; ask before adding a test dependency. Files are
  `tests/<module>.test.js`, and nothing outside `tests/` may have a name `node --test` picks up
  (`tests/layout.test.js` checks).
- Tests import from `src/` directly: keep logic **pure and Node-importable** (no shader imports, no DOM at
  import time), the maths in its own module and the GPU wiring in the system that uses it.
- Tests are deterministic: fixed seeds, and time mocked with `t.mock.method(performance, 'now', ...)`.
- `tools/check-build.js`'s HTML rules each have a fixture in `tests/fixtures/check-build/fail/<rule-id>.html`
  that trips exactly that rule; `pass/*.html` trip none.
- A test that has never failed proves little: break the code it covers once and watch it go red.

## 6. Architecture

```
index.html            source template: canvas, overlays, readout and benchmark panels
vite.config.js        single-file build to dist/; shader includes; shader hot-swap
PLAN.md               the build plan: status, and each stage's notes
src/
  main.js             boot, the world systems (WORLD_SYSTEMS), the loop; capture mode hands over to core/capture.js
  config.js           ALL tunables: quality presets, the capture's settings and limits, the frame-cost budget
  views.js            named viewpoints
  maths/              vectors, matrices, colours, culling shapes, half floats (ported from three.js; pure)
  gpu/                the renderer: device, passes and pipelines, scene, materials, textures, bindings by name
  core/               params, clock, random, the display, camera, input, the capture contract, GPU stats, readout, benchmark
  sky/                the sky and its tables, the light state, the sun's path and the time of day, the sun's shadows
  post/               the frame: HDR target, its passes, the output pass
  world/              the island's shape (island.js), its heightmap, the terrain, rocks, the island's own shade
  textures/           procedural textures made on the GPU at boot: the ground's tiles
  shaders/chunks/     shared WGSL: the frame (group 0), lighting, shadows, terrain, the ground's surfaces, noise, planet
  fixtures/           test scenes (?fixture=) for the screenshot tool's checks; not part of the island
  world/placeholder*  TEMPORARY stand-in water (flat, coloured by depth). Delete once replaced.
tools/                the screenshot tool, its measurements and checks, the build check, the map, the Linux container
tests/                node:test suites and their fixtures
```

Each module's header says what it does and what it puts on `ctx`. `world/island.js` is the **single source of
truth for the height function**: JS evaluates it for placement and collision and uploads it as heightmaps for
the shaders, so nothing re-implements it in WGSL. Planned folders, each created with its first real system:
`water/` (the ocean, shoreline, ripples), `plants/` (shared wind and leaves, a file per species), `audio/`
(procedural WebAudio, never before a user gesture), `player/` (walking, collision; replaces free-fly).

## 7. Module contract

Every system is one module exporting `create(ctx)`, which returns `{ update(dt, t), dispose() }`, and
optionally `ready` (a Promise, awaited before a capture starts, for async setup) and `settled()` (a Promise
while work its `update` started is in flight, else nothing; a capture renders again once it lands). World
systems are listed in `WORLD_SYSTEMS` in `src/main.js`, and update in that order every frame, after input.

`ctx` holds `gpu`, `renderer`, `canvas`, `scene`, `camera`, `config`, `quality` (the active preset), `params`
(URL params), `view`, `timeOfDay` (hours of daylight or a named time; night throws), `clock`, `stats` and
`rng(name)`, and what systems put on it, each described in its module's header: `terrain` (the island, its
heights, the mesh as drawn and its JS twin, the ground's surfaces), `rocks` (placed rocks, read-only, and their
clearance for later placement), `sky` (the light state; `follow(fn)` for what must land with a time change),
`shadows` (what casts registers with `cast(fn)` and `from(spheres)`) and `frame` (`post/frame.js`: the drawing
buffer's size, the uniforms every scene material binds at group 0, `beforeScene()` for passes of a system's
own, the passes, `translucent()`, `opaque`, `addPost()`). A system that reads one of them in `create()` comes
after its owner in `WORLD_SYSTEMS`.

- The time of day changes only when it is set, but it can be set while the game runs: a system that depends on
  it follows `ctx.timeOfDay` in `update()`, not only in `create()`.
- `update(dt, t)`: in capture mode `dt` is 0 and `t` frozen, so anything time-driven must look the same at a
  given `t` in a capture as in the game: a function of `t`, or a deterministic simulation a capture can
  reproduce at `t`, also when it jumps to another `t` in the same page (`clock.seek`). An exception in
  `update()` stops the loop and shows the error overlay (in capture mode it fails the capture).
- Each system uses its own rng stream names (`rng('palms')`, `rng('palms/fronds')`): `rng(name)` always
  restarts the same sequence, and new names never shift existing systems.
- `dispose()` removes everything the system added and disposes its GPU resources. A quality change disposes
  the frame and every world system and creates them again, so a system reads `ctx.frame` and `ctx.quality`
  afresh in `create()`. The screenshot tool fails on anything left behind.
- UI stays hidden when `ctx.params.capture` is true.

**Capture contract** (`?capture=1`, `core/capture.js`, used by `tools/screenshot.js`): no UI or pointer lock;
the camera at the requested view and the clock frozen at `t`. It awaits `ready`, compiles every pipeline,
checks that each scene material ends with `sceneOutput()` and that only the translucent pass blends, renders
`config.capture.warmupFrames` frames, then sets `window.__CAPTURE_READY__` (any failure sets
`__CAPTURE_ERROR__`). Then `window.__CAPTURE__` renders more frames in the same page (another `t`, the camera
turned or moved, another time of day), which must match a fresh load at that `t` or time; `--checks` checks
it. A new system's async work goes behind `ready`, or behind `settled()` when its `update` starts it.

## 8. Rendering conventions

- **WebGPU** through the project's own renderer (`src/gpu/`), with WGSL shaders; no WebGL fallback. Core WebGPU
  only: no optional feature is required (`timestamp-query` gives the GPU time where it exists).
- Linear colour. Author colours as sRGB hex through `Color` (`maths/color.js`) or as linear floats in shaders,
  and say which in a comment.
- The scene renders into the **HDR target** of `post/frame.js` (half float, 4× MSAA). Its output pass is the
  **only** place for tonemapping, sRGB conversion and dithering.
- **Every scene material's fragment entry point ends with `return sceneOutput(radiance, alpha);`**
  (`chunks/scene-output.wgsl`: the exposure, and a compression so MSAA averages edges as they look after
  tonemapping); capture mode fails on one that doesn't. The sky is a scene material too, drawn last in the
  opaque pass on the far plane (`renderOrder = frame.skyOrder`).
- **Bindings by name.** Group 0 is the frame's (`chunks/frame.wgsl`): the camera and `ctx.frame.uniforms`, bound
  for every scene material. Group 1 is the material's: its `uniforms` fill its `var<uniform>` structs field by
  field and its textures by name, each texture's sampler at `<name>Sampler` (a `sampler_comparison` compares
  with `greater-equal`, as depth is reversed). A texture that can't be filtered is read with `textureGather`
  through an unfiltered `<name>Texels` sampler, or `textureLoad` (slower per pixel). Group 2 is the mesh's
  transform (`chunks/object.wgsl`). Chunks with bindings of their own keep a fixed binding number in group 1.
  A shader can count on 16 textures: group 0 takes 11.
- **The frame draws in passes** (`post/frame.js`), picked by a mesh's `pass`. Meshes that read the opaque
  scene's colour or depth (`frame.opaque`: water) set `pass = 'afterOpaque'`. **Anything translucent goes
  through `frame.translucent(object)`**, which blends it in linear light; capture mode fails on a material
  that blends anywhere else. Alpha-to-coverage cut-outs are opaque. Post effects are `frame.addPost()`
  passes on linear HDR before the output.
- **What casts a shadow adds meshes in pass `'shadow'`**: the same shader and uniforms as its own material,
  so its vertices land where they are drawn, `fragment: null` (or one that only discards, for a cut-out),
  and instances picked through `ctx.shadows.cast()`, also out of view. A mesh whose vertex shader moves it
  sets `frustumCulled = false`. It also tells `ctx.shadows.from(spheres)` where it stands: the ground reads
  the shadow maps only where some caster's shadow can fall, so a caster that doesn't casts none on the
  ground. The terrain casts none: the island's own shade covers it.
- **Every lit material uses the shared lighting model** (`chunks/lighting.wgsl`), from the light state `sky/`
  keeps in `ctx.frame.uniforms`; no lights or fog of a material's own. Shadows join the light in
  `sunVisibility()`; a material that lights a pixel more than once sets `SHADE_ONCE` and calls `shadeOnce()`
  first. Light is in units of the sun's illuminance and the exposure follows it, so author albedos, not
  brightnesses.
- **Anti-aliasing is MSAA with 4 samples**, shading once per pixel. Cut-out edges use alpha-to-coverage.
  Shading that can sparkle or crawl (glints, fine procedural detail) is filtered by its pixel footprint
  (`fwidth`), and level of detail keeps out geometry thinner than about two pixels. Varyings that can't be
  extrapolated past a triangle's edge (the world position of a surface reaching to the horizon) use
  `@interpolate(perspective, centroid)`.
- **Depth is reversed 32-bit float** (`depth32float`, `greater-equal`, cleared to 0), near 2 cm, far 100 km.
  The projections and the frustums set from them (`maths/`) take reversed depth only.
- **WGSL** rules that bite:
  - Uniformity: `dpdx`/`dpdy`/`fwidth` and `textureSample` only in uniform control flow. Take derivatives
    before any branch that varies per pixel; inside one, read with `textureSampleGrad` or `textureSampleLevel`.
  - Variants are `override` constants set per material (`overrides`). An array's size can't be one: size it
    for the most a variant needs, and check the count in JS.
  - Uniform arrays hold `vec4f` elements (`gpu/reflect.js` refuses others); booleans in uniforms are `u32`.
  - Y points down: fragment positions and texture rows count from the top. Code that reads a texture back by
    position, or uses the fragment's y, says which way it counts.
  - `%` truncates: where negatives can occur, write `x - y * floor(x / y)`.
  - Nothing may depend on the order of atomic operations.
  - Readbacks are async (`texture.read()`): what depends on one lands whole, behind `ready` or `settled()`.
- Tessellate large planes (water, ground skirts): GPUs clip and interpolate giant triangles differently.
- The world is flat, the sky a curved planet's. Surfaces that reach far bend down with the planet in their
  vertex shader (`planetDrop()`, `chunks/planet.wgsl`), so they end at the sky's horizon, and whatever stands
  on them bends with them.

## 9. Code conventions

- One system per file. Plain JS ES modules, no TypeScript, no UI framework.
- Tunables live in `src/config.js`, never as magic numbers buried in systems; per-quality knobs in the presets.
- Shaders live in `.wgsl` files next to the system that uses them, one module per material (entry points
  `vertexMain` and `fragmentMain` unless it names others), imported as strings and used with `Material`.
  Shared code goes in `src/shaders/chunks/`: `#include "chunks/noise.wgsl"` from any shader, sibling chunks
  relatively (`#include "noise.wgsl"`), and from a system's own shared WGSL by their root path
  (`#include "/chunks/sky-view.wgsl"`). A chunk reached twice lands once: no include guards.
- Imported shaders lose their comments, and hot-swap matches materials by source string: pass the imported
  string straight to the material where you can (composed strings reload the page).
- Match the existing style: small modules, short comments that explain *why*, no dead code.

## 10. Performance budget

60 fps at 1080p on a mid-range laptop (integrated or entry-level GPU) at the `high` preset's defaults. Weaker
machines use `?quality=medium|low`; every expensive system reads its knobs from `ctx.quality`.

## 11. Definition of done

- `npm run verify` passes: tests, build, check, and screenshots plus the player-mode run with zero console,
  page, shader or WebGPU errors.
- New or changed pure logic has tests, and new world logic has invariant tests (§5).
- The before/after `--compare` sheet has been opened and reviewed, and you can say what changed.
- New areas have views in `views.js`.
- This file is updated if the structure, commands, conventions or contract changed.
- PLAN.md's status table and the stage's notes are updated. A finished stage goes to `review` with its list
  of known flaws; only the user marks it `done`.
