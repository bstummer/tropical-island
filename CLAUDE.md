# Tropical Island

Standing instructions for every session in this repo. Read this file fully before changing anything.

## 1. Vision

A first-person walk around a tropical island that runs in the browser and ships as one HTML file. The goal is a place so beautiful that people stop and ask, "Wait, this is in a browser?" Beauty is the product. It ranks above feature count, above code cleverness and above size of the world: one breathtaking cove beats a whole island that merely looks fine.

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
| `npm run shot -- [args]` | Builds, then `tools/screenshot.js`: one PNG per view + `contact-sheet.png` + `info.json` in `screenshots/<label>/`. Then it runs the game for 30 frames in player mode (no `?capture`: real-time loop, input, start screen), which captures never exercise. |
| `npm run verify` | test + build + check + shot. **The definition-of-done command.** |
| `node tools/screenshot.js --compare A B` | Before/after sheet `screenshots/compare/A_vs_B.png`: A, B and a diff column per view, with the % of changed pixels. No build needed. |

Screenshot args: `--views beach,shoreline` (default all), `--label before` (default `<git hash>[-dirty]-<timestamp>`),
`--size 1600x900`, `--t 12.5` (sim seconds), `--time 17.5` (hours, overrides each view's time),
`--seed 1`, `--quality high`, `--gl auto|hardware|swiftshader` (default auto: hardware GL, falling back to SwiftShader).

URL params (dev server or `dist/index.html`): `?view=beach&time=17.5&t=12.5&seed=1&quality=low&capture=1`.

Dev-only key: **P** logs the camera as a ready-to-paste `views.js` entry and copies it to the clipboard.

### Fresh Linux machines (cloud sessions)

Cloud sessions run in a Linux container with no GPU and no display, so screenshots are the only way to see the game.

- Run `npm ci`, then once per machine `npx playwright install-deps chromium` (apt, needs root). Without the
  system libraries, the screenshot tool fails with "missing system library ..." and prints that command.
- `--gl auto` finds no GPU and falls back to SwiftShader (about 1–3 s per view at 1600×900 today).
- SwiftShader captures from here compare directly with CI and local `--gl swiftshader` captures (see section 4).

### Deploying

`.github/workflows/deploy.yml` runs on every push to `main` (and manually via "Run workflow"):

1. **build** (read-only token): `npm ci`, then `npm run verify -- --gl swiftshader` (runners have no GPU).
   It uploads the screenshots as a workflow artifact for review, even when the run fails.
2. **deploy-pages**: publishes `dist/` to https://bstummer.github.io/tropical-island/.
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
   including what got worse.

- Only compare captures from the **same GL backend**: hardware and SwiftShader differ by a few levels
  everywhere and more at edges. The compare sheet warns when the backends, Chromium builds, size or params
  differ. Use `--gl swiftshader` on both sides if hardware GL is flaky.
- Captures are deterministic: the same args on the same backend give byte-identical PNGs. An
  "identical" result in the compare sheet really means nothing changed, and any diff is real.
- SwiftShader output is also byte-identical across Windows and Linux, as long as the Chromium build is the
  same (`info.json` records it; `package-lock.json` pins Playwright, which pins the build).
- When you build a new area or feature, add views for it to `src/views.js` (fly there in dev, press P,
  paste). Keep the existing views stable so history stays comparable.

## 5. Testing

**Pure logic gets tests; visuals get screenshots.** Anything with an answer that can be checked without
looking (seeded randomness, param parsing, clock behaviour, the build checker, terrain maths, placement
rules) gets tests in `tests/`. Anything judged by eye goes through the screenshot workflow above.

When you add world logic (height function, placement zones, viewpoints), add **invariant tests** that
check properties of the output, not specific numbers. Examples:

- Every view is above the terrain and above the water.
- No plants below the waterline or on slopes steeper than the species allows.
- Placement zones are ordered from shore to jungle, and every point on the island falls in exactly one.
- The JS height function and the uploaded heightmap agree at sample points.

Run invariants over several seeds (say 1–20), not just the default, so a lucky seed can't hide a bug.

How tests are written:

- `node:test` and `node:assert/strict` only. No test dependencies; ask before adding one.
- Files are `tests/<module>.test.js`. `npm test` runs `node --test` with Node's default discovery
  (`node --test tests/` breaks on newer Node versions), so don't name non-test files `*.test.js` or `test-*.js`.
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
index.html            source template: canvas + start overlay + error overlay; loads src/main.js
vite.config.js        single-file build to dist/; glsl includes; dev shader hot-swap; strips URLs from three's GLSL comments
README.md             for players and visitors: play/download links, controls, dev quickstart
.github/workflows/    deploy.yml: verify, then GitHub Pages + rolling "latest" release on every push to main
src/
  main.js             boot: params -> renderer/scene/camera -> systems -> loop, plus the capture contract
  config.js           ALL tunables (quality presets, camera, movement, defaults, capture, size budget). No browser APIs.
  views.js            named viewpoints. No browser APIs (Node imports it).
  core/               params.js, clock.js, random.js, renderer.js, input.js (free-fly + pointer lock)
  world/placeholder*  TEMPORARY stand-in world (sky dome, sand mound, flat water). Delete once replaced.
  shaders/chunks/     shared GLSL: noise.glsl today; wind and lighting code later
tools/                screenshot.js, check-build.js (Node only; both export their pure helpers for tests)
tests/                node:test suites + fixtures/check-build/{pass,fail}/*.html
```

Planned folders. Create each one when its first real system lands, not before (no empty stubs):

- `sky/`: atmosphere scattering, clouds, sun and moon, time of day (owns `ctx.timeOfDay` progression).
- `water/`: ocean surface, shoreline wash and foam, ripples, shallow-water colour from depth.
- `plants/`: leaf atlas, shared wind, one file per species (`palm-coconut.js`, ...).
- `world/`: `island.js` is the **single source of truth for the height function**. It is evaluated in JS
  for placement and collision and uploaded as a heightmap texture for shaders, so nothing re-implements it
  in GLSL. Also terrain and placement zones from shore to jungle (wet sand, dry sand, beach scrub,
  palm belt, jungle).
- `textures/`: procedural texture generators (render-to-texture or CPU canvases), cached per session.
- `post/`: HDR target, tonemapping, bloom, anti-aliasing, colour grading. The only place tonemapping happens.
- `audio/`: procedural WebAudio (surf, wind, birds). Must not start before a user gesture.
- `player/`: walking, terrain collision, head bob; replaces free-fly as the default controller.

## 7. Module contract

Every system is one module exporting `create(ctx)`, which returns `{ update(dt, t), dispose() }`, and
optionally `ready` (a Promise, awaited before a capture starts, for async setup). Register world systems in
`WORLD_SYSTEMS` in `src/main.js`; they update in that order every frame, after input.

`ctx` holds: `renderer`, `scene`, `camera`, `config`, `quality` (the active preset object), `params`
(parsed URL params), `view` (the starting view), `timeOfDay` (hours), `clock` (`elapsed`, `dt`, `frame`,
`frozen`), and `rng` (`rng('name')` returns a stream with `next/range/int/chance/pick/normal`).

- `update(dt, t)`: `dt` and `t` come from the clock. In capture mode `dt` is 0 and `t` is frozen, so
  anything time-driven must be a function of `t`, not an accumulation of `dt`, to look right in screenshots.
  An exception in `update()` stops the loop and shows the error overlay (in capture mode it fails the capture).
- Each system uses its own rng stream name (`rng('palms')`, `rng('palms/fronds')`). `rng(name)` always
  restarts the same sequence, and new names never shift existing systems.
- `dispose()` removes everything the system added and disposes GPU resources.
- UI must stay hidden when `ctx.params.capture` is true.

**Capture contract** (`?capture=1`, used by tools/screenshot.js): no UI or pointer lock. The camera goes to
the requested view and the clock is frozen at `t`. main.js awaits `ready`, compiles, renders
`config.capture.warmupFrames` frames, checks every shader program compiled, then sets
`window.__CAPTURE_READY__ = true` (and `__CAPTURE_INFO__`). Any failure sets `window.__CAPTURE_ERROR__`.
Don't break this. If a new system does async work, put it behind `ready`.

## 8. Rendering conventions

- Linear colour workflow. Author colours as sRGB hex through `THREE.Color` (converted to linear) or as
  linear floats in shaders, and say which in a comment.
- Render the scene into an **HDR render target** (HalfFloat). Tonemapping happens **only in the post pass**;
  materials and the renderer keep `NoToneMapping`. Until `post/` exists, the placeholder renders straight
  to the canvas.
- **sRGB output**: `renderer.outputColorSpace = SRGBColorSpace`. Custom `ShaderMaterial`s end with
  `#include <colorspace_fragment>` while they render to the screen; that moves to the output pass with post.
- **Dither gradients** (sky, fog, water depth, vignettes) to avoid banding: `dithering: true` plus
  `#include <common>`, `<dithering_pars_fragment>` and `<dithering_fragment>`, or the post pass's dither.
- Avoid huge triangles. Tessellate large planes (water, ground skirts): rasterizers clip and interpolate
  giant triangles differently, which moved the shoreline by metres between GPUs.
- Big outdoor depth range: keep `camera.near` as large as close-up plants allow, and consider reversed-Z
  or a log depth when shoreline z-fighting shows up.

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
  console, page or shader errors.
- New or changed pure logic has tests, and new world logic has invariant tests (section 5).
- The before/after `--compare` contact sheet has been opened and reviewed, and you can say what changed.
- New areas have views in `views.js`.
- This file is updated if the structure, commands, conventions or contract changed.
