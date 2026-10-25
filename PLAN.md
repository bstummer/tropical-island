# Build plan

The order the island gets built in, and where it stands. [CLAUDE.md](CLAUDE.md) holds the rules: vision,
hard rules, visual workflow, definition of done. This file holds the stages. Each session takes on one
stage, or part of one, and leaves notes for the next session.

The user directs the work and reviews most stages. The AI builds, measures and reports, and says plainly
what it couldn't judge. It sees still images only, so motion in the running game, sound, how walking feels
and speed on real hardware are for the user to check.

The plan is loose on purpose. Each stage says what to achieve and how to tell when it's done, not how to
build it. Any technique it names is only a suggestion: the AI picks the approach at each step. Keep it that
way when editing the plan: write goals and checks, not techniques. When reality disagrees with the plan (a
stage turns out bigger than expected, an approach looks bad, the order is wrong), change the plan and note
why in the Log.

## How to work a stage

1. Read CLAUDE.md, then the Status table and the latest Log entries below.
2. Take the stage the user names, or else the first stage that is `todo` or `in progress`. A stage in
   `review` doesn't block the next one, except the cove gate (Stage 11), but the user's feedback on a stage
   in review comes first. If a stage is too big for one session, split it into a checklist of sub-steps
   under the stage and work through them in order.
3. Take a `before` capture and look at it. Write down what falls short of the vision's bar. That list is
   what the stage has to fix.
4. Build. One convincing result at the hero spot beats broad, mediocre coverage.
5. Add views for what the stage built, including at least one close-up, so its quality stays visible in
   every later capture. Give each new view a brief (CLAUDE.md §4).
6. Finish to CLAUDE.md §11 (verify, compare sheet reviewed, tests, views, docs).
7. Review the result harshly before the user does. Go through every view against its brief and
   CLAUDE.md's list of things that break the spell: the stills, plus the motion strips, zoomed crops and
   banding views once Stage 1 has built them. List everything that still falls short, including what got
   worse. A subagent that hasn't seen the code makes a good second pair of eyes.
8. Hand over: set the stage to `review` and give the user the capture label, the compare sheet, the frame
   cost and the list of known flaws. Make sure the user can open the images, even when the session ran in
   a cloud container. Name what needs the user's eyes or ears: motion in the running game, sound, feel,
   real hardware. The stage becomes `done` when the user says so.
9. Update this file: status, ticked sub-steps and a Log entry with the flaws still open. Commit and push
   only when the user asks. Pushing to `main` publishes the game.

Stop and ask the user when a new dependency looks necessary, when the performance budget can't be met, or
when a choice is about taste or scope rather than engineering (see Open questions).

## Principles for the order

- **Light and measurement first.** Tonemapping, sky and sunlight come before materials, so colours are
  tuned once, under the final light. The tools that show the AI motion, fine detail and frame cost come
  first too (Stage 1), so every later stage is judged with them.
- **One cove first.** Milestone 1 makes a single cove beautiful from a handful of viewpoints. The rest of
  the island stays coarse until the cove clears the wallpaper bar.
- **Hero detail first** within every stage: the shoreline, sunlight through leaves, the near foreground.
  Fake whatever is far away.
- **Always shippable.** Every stage ends with `main` deployable and `npm run verify` green. Replace the
  placeholder piece by piece, and delete each placeholder part in the stage that replaces it.
- **Budget as you go.** From Stage 1 on, every capture reports each view's frame cost against limits in
  `config.js`. Note each stage's cost in the Log and put its knobs in the quality presets. GPU time on the
  machine a session runs on says little about a mid-range laptop, so the counts and their limits are the
  guide, plus the benchmark results the user brings back from real machines. The limits are guesses until
  Stage 11 calibrates them, so ask the user to run the benchmark after each stage that adds a lot of cost
  (water, plants), not only at Stages 11 and 18. Don't leave performance to the end.
- **Works on any machine.** A session may run anywhere, including a cloud container with no GPU, where
  SwiftShader is the only renderer. Nothing in the workflow may depend on one machine's hardware, and
  captures must stay fast enough on SwiftShader to take in every session. SwiftShader runs every line of
  a shader at every pixel, branches or not (measured in Stage 4.3): code a pixel skips still costs it
  there, so heavy code that only some pixels need goes in a shader variant of its own.
- **Motion is part of the look.** If a thing looks right frozen but moves wrong, it isn't done. A single
  frame can't show motion: the AI judges it from motion strips and shimmer scores (Stage 1), and the user
  judges it in the running game.

## Status

| # | Stage | Milestone | Status |
|---|---|---|---|
| 1 | HDR frame and measurement | The cove | done |
| 2 | Sky, sun and atmosphere | The cove | done |
| 3 | Island shape | The cove | done |
| 4 | Ground surfaces and rocks | The cove | in progress |
| 4b | WebGPU port | The cove | done |
| 4c | Maths of our own | The cove | done |
| 5 | Shadows | The cove | todo |
| 6 | Ocean | The cove | todo |
| 7 | Shoreline | The cove | todo |
| 8 | Foliage foundation and coconut palms | The cove | todo |
| 9 | Cove vegetation | The cove | todo |
| 10 | Clouds | The cove | todo |
| 11 | Cove polish (milestone gate) | The cove | todo |
| 12 | Every hour of daylight | Alive | todo |
| 13 | Small life and detail | Alive | todo |
| 14 | Walking | Being there | todo |
| 15 | Sound | Being there | todo |
| 16 | Presentation | Being there | todo |
| 17 | Beyond the cove (repeatable) | Whole island | todo |
| 18 | Performance and robustness | Ship | todo |
| 19 | Final pass | Ship | todo |

Status values: `todo`, `in progress`, `review` (built and handed to the user), `done` (the user approved
it). Only the user moves a stage to `done`. A stage the user sends back returns to `in progress`.

Once an approved stage is committed, note the commit in the Log. Captures are deterministic, so checking
that commit out (a git worktree works) and capturing with the same args and backend recreates the approved
images. To compare them with a new capture, both sides need the same Chromium build (CLAUDE.md §4).

---

## Milestone 1: The cove

Goal: one cove (beach, lagoon, reef, palms, jungle edge) that works as a wallpaper from every one of its
views, at midday and at golden hour.

### 1. HDR frame and measurement

The image pipeline that every later stage is judged through, and the tools that let the AI judge it. The
AI sees only still images, and fine flaws hide in a scaled-down contact sheet, so this stage gives it ways
to see motion, detail and cost. Split it into sub-steps.

Image pipeline and groundwork:

- The scene renders into an HDR target. A post pass in `post/` owns tonemapping, exposure, dithering,
  anti-aliasing and output colour space.
- Bright things (sun disk, glitter) can go well above 1.0 and roll off gracefully instead of clipping.
- The frame is open to later systems. They will add passes of their own (shadows, reflections and the
  like) and need the screen size, without rewiring `main.js` each time.
- Choices that bind every later material are made here, before any real material exists: the
  anti-aliasing approach (with foliage and sun glitter in mind), and enough depth precision for the whole
  range, from a leaf near the lens to the horizon. Whatever they ask of materials goes into CLAUDE.md §8.
- Teardown is checked. Nothing calls `dispose()` today, so it is untested. The automated run tears down
  everything a quality change would rebuild, builds it again with another preset, and fails on leaked GPU
  resources. Every later system then keeps teardown working, and Stage 16's quality switch can rely on it.

Measurement in the game:

- A readout of frame time and draw calls (GPU time where the browser exposes it) that also works in the
  built game, not just the dev server, plus a benchmark mode that runs through the views and prints a
  summary the user can paste into a session, saying which GPU, browser, resolution and preset it ran on.
  That is how numbers from real machines reach the AI.

Measurement in `tools/screenshot.js` (pure parts get tests):

- **Motion:** a strip of frames at stepped `t` values, and frames at a frozen `t` with sub-pixel camera
  turns that expose shimmer and aliasing. (Moving the camera by centimetres shifts near things by many
  pixels, which a score can't tell apart from aliasing.) A per-view shimmer score from the
  turned frames goes in `info.json`, so flicker shows up as a number, and the tool warns above a limit in
  `config.js`.
- **Detail:** zoomed crops of chosen regions, and a contrast-boosted copy of each view that
  makes banding and dithering visible.
- **Cost:** per view in `info.json`: draw calls, triangles, shader programs, render passes, a measure of
  fragment work (such as overdraw), and texture and render-target memory. These numbers are the same on
  every backend, so they work in CI and cloud sessions. Limits per quality preset live in `config.js`, and
  the tool warns above them. Add GPU time where hardware GL exposes timer queries.
- **Proof:** each measurement is shown to catch its problem on a deliberately bad case (something that
  shimmers, an undithered gradient, a scene over the limits). The placeholder can't prove the tools on its
  own: nothing in it shimmers or goes over a limit, and the banding it shows (water and sand) goes away in
  this stage. The bad cases are fixtures for the tools, not views, so normal captures stay clean.
- **Speed:** captures stay fast on SwiftShader (see Principles), and `npm run verify` stays a quick gate.
  `info.json` records how long each capture took, and the tool warns above a time budget in `config.js`.
- **Done when** the placeholder renders through post with no banding and no new visible flaws (every pixel
  may change); the tool produces motion strips, shimmer scores, crops, banding views and cost numbers, each
  proven on a bad case; teardown is checked; the readout and benchmark work in the built game; and
  CLAUDE.md is corrected wherever this stage made it wrong, including that tonemapping and colour-space
  output now live in post.

Sub-steps, in order. Each one ends with `npm run verify` green and `main` shippable, and fixes whatever it
made untrue in CLAUDE.md. The tools come first, so the pipeline change in 1.4 is judged with them.

- [x] **1.1 Capture groundwork.** The tool works from any working directory (on Windows it failed every
  capture when the shell's drive letter was lowercase, `c:\`, flagging its own page as a network
  request). One page load can render extra frames (other `t` values, sub-pixel camera turns) without
  reloading, so the measurements below stay fast. `info.json` records each capture's time, with a warning
  above a budget in `config.js`. Check: the game's pixels are identical to `stage1-before`.
- [x] **1.2 Detail and motion.** Crops, banding views, motion strips and shimmer scores, each proven on a
  bad case.
- [x] **1.3 Cost.** The cost numbers, their limits per preset and the warnings, proven on a scene over the
  limits.
- [x] **1.4 HDR frame.** The image pipeline and the choices that bind every material. Thin dark shapes
  against a bright sky stay anti-aliased after tonemapping: backlit fronds against a sunset depend on it.
  The look of the tonemapping is a matter of taste, so show the user candidates side by side and let them
  pick. Check: the banding views show no bands, no shimmer score went up, and the compare sheet shows no
  new flaw.
- [x] **1.5 Teardown.** The teardown check, proven on a system that leaks on purpose.
- [x] **1.6 Readout and benchmark.** Both work in the built game, and the screenshot tool's player-mode
  run exercises them, so breaking either fails `verify`. Then the user runs the benchmark on the machines
  they have, for the first real numbers.

### 2. Sky, sun and atmosphere

- A physically motivated sky for every hour of daylight, with a sun disk. The horizon colour matches the
  haze on distant land and sea.
- One shared lighting model used by every material: sunlight, sky ambient, and aerial perspective (fog).
  Later materials plug into it rather than inventing their own. The light state lives in one place that
  every material reads and that survives a quality change, and this stage decides how Stage 5's shadows
  will plug in.
- Settle the frame's structure for what comes after the sky, while little depends on it yet. Water, foam
  and spray need the opaque scene's colour and depth behind them; translucent layers over bright ones
  must blend as they would in linear light (today they don't, CLAUDE.md §8); bloom and god rays need a
  chain of post effects before the output. Prove the blending with a fixture.
- The sun's path is art-directed. It sets over the sea straight ahead of the beach, which Stage 3 lays out
  to match (see Decisions), and midday has to look good too.
- `sky/` owns time of day. It doesn't pass on its own and covers daylight only (see Decisions). This stage
  defines the daylight range and what sunrise, midday, golden hour and sunset mean in hours, in one place
  that later stages and captures use. The time changes only when it's set: by `?time=` now, by a dev
  control in this stage, and by the in-game settings from Stage 16.
- Changing the time while the game runs updates everything that depends on it, not only at boot. A check
  proves it: a time changed at runtime renders the same as that time set at boot. Every later system that
  depends on the time stays under that check.
- **Done when** sunrise, midday, golden hour and sunset captures all look believable, the horizon dissolves
  into haze, the time can't be set to night, the runtime check passes, and the placeholder sky is gone.

Sub-steps, in order. Each one ends with `npm run verify` green and `main` shippable, and fixes whatever it
made untrue in CLAUDE.md. The groundwork comes first, so the sky and the light are built once, in their
final place, and judged by the runtime check from the start.

- [x] **2.1 Time of day.** `sky/` takes over the time. The daylight range and the named times (sunrise,
  midday, golden hour, sunset) are defined in one place, and views and captures can ask for a time by
  name. The sun's path follows from them, setting in a fixed direction that Stage 3 turns the beach
  towards. Nothing can set a time outside daylight: not the URL, a view or the dev control, which changes
  the time while the game runs. The runtime check joins `verify`, proven on a system that reads the time
  only at boot. Check: tests cover the range and the named times, and the compare sheet shows nothing but
  the sun's new path.
- [x] **2.2 Frame structure.** What comes after the sky gets its place in the frame now: the opaque scene's
  colour and depth for whatever draws after it, translucent layers that blend as they would in linear
  light (also over bright ones), and a chain of post effects before the output. None of it costs anything
  in a frame that doesn't use it. The sky draws after the opaque scene, so sky hidden behind land costs
  nothing (Stage 1 left it drawing first). A fixture proves the blending: translucent layers over
  backgrounds from dark to as bright as the sun come out as the same mix done in linear light. Check: the
  island's pictures stay the same, teardown stays clean, and the Log records what the new passes cost.
- [x] **2.3 Sky.** A physically motivated sky with a sun disk replaces the placeholder sky, for every hour
  of daylight. Sunrise, midday, golden hour and sunset each look believable and distinct. The sun disk
  has a clean edge and a soft glow, and the sky shows no bands, also in the deep blue overhead and the
  sunset gradients. Exposure follows the light, so sunrise isn't murky and midday isn't blown out. Add a
  telephoto view towards the sun over the sea at sunset as the stage's close-up. How high the midday sun
  stands and how deep the blue goes are a matter of taste: show the user candidates side by side. Check:
  captures at the four named times, with clean banding views and no shimmer at the sun's edge, and
  captures still quick on SwiftShader.
- [x] **2.4 Light and haze.** The shared lighting model: sunlight, sky ambient and aerial perspective, all
  fed by the sky, so light, sky and haze agree at every hour. The light state lives in one place that
  every material reads, survives a quality change and follows a time change. Stage 5's shadows and
  Stage 10's cloud shadows have a defined place to plug in. The placeholder land and water use the model
  until Stages 3 and 6 replace them, so captures show it. Distant land and sea dissolve into the horizon
  haze, with no seam where the sea meets the sky. A test scene shows the light without the island:
  neutral and coloured objects from arm's length out to the far haze. Check: at every named time the
  telephoto view shows no seam at the horizon, neutral objects read neutral at midday and warm at golden
  hour, and the runtime check still passes.

### 3. Island shape

- `world/island.js` holds the height function: pure, Node-importable, tested. The layout is art-directed
  around a hero cove: a crescent beach, a lagoon, a reef where surf breaks, a headland, and green hills
  behind. The beach faces the sunset (see Decisions). The rest of the island exists in coarse form so the
  overview and the horizon work.
- Design the seabed as carefully as the land. The water reads depth from it: sand shelf, channels, reef,
  drop-off.
- The seed changes the island, but the game uses one seed for now, and the views are framed on it (see
  Decisions).
- Keep the island's size easy to change. Performance will decide the final size (see Decisions). Resizing
  leaves the cove and its views where they are.
- The heightmap goes to the GPU as a texture (CLAUDE.md §6). Terrain holds up close to the camera and stays
  cheap far away. Placement zones run from wet sand to jungle.
- Invariant tests over seeds 1–20 (CLAUDE.md §5).
- Move the existing views onto the cove once, here, keeping their names, and keep them stable after that.
  Add a view from the beach out to sea at golden hour, into the setting sun: the shot the cove is laid
  out for.
- Every view gets a `brief` (CLAUDE.md §4). Write the briefs for the cove views with the user. Once every
  view has one, make the views test require it.
- Rough walking: a toggle that puts the camera at eye height on the terrain, so the user can judge the
  cove's scale from the ground long before Stage 14 builds real walking.
- Hilltops catch the last light at sunset. Known from Stage 2: the light is the same at every height
  today, while a low sun is several times stronger on a hilltop than on the beach.
- **Done when** the placeholder mound is gone, the overview's landforms read as a tropical island, the views
  frame the cove, each with a brief the user agreed, and the user has checked the cove's scale on foot.

Sub-steps, in order. Each one ends with `npm run verify` green and `main` shippable, and fixes whatever it
made untrue in CLAUDE.md. The layout comes first and is judged on a map before anything renders it, and
the user walks the cove before the views are framed on it: until then, changing the layout is cheap.

- [x] **3.1 Layout.** `world/island.js` holds the height function and the placement zones, with the cove
  art-directed and the rest of the island coarse. The seabed is designed with the land: sand shelf,
  lagoon, channels, the reef and a pass through it, the drop-off. The island's size is one setting. A
  top-down map (relief, depths, zones, where the views stand) lets the user and the AI judge the layout
  before anything renders it. How high the hills stand, how far out the reef lies and where the headland
  sits are a matter of taste: show the user candidates as maps side by side. Check: invariant tests over
  seeds 1–20, each seen red once: the zones run in order from the shore and cover every point once, the
  beach faces the sunset, the reef stays under water, deep sea rings the island, and resizing leaves the
  cove's heights unchanged. The pictures don't change (nothing draws the island yet).
- [x] **3.2 Terrain.** The island replaces the placeholder mound: land and seabed drawn from the heightmap
  on the GPU, with no facets at eye height, cheap in the distance, and no cracks, popping or crawling
  ridgelines. The GPU's heights agree with `island.js` at sample points, checked in the browser and
  proven on a deliberate offset. Until Stage 6, the placeholder water shows the depth below it in its
  colour, so the lagoon and the reef read from above. The views move onto the new land, keeping their
  names, and a test keeps them above the terrain. Rough walking arrives here, so the user can judge the
  scale on foot. Boot stays quick: a verify run loads the page dozens of times. Check: shimmer and cost
  within their limits, captures within their time budget on SwiftShader, teardown clean. Then the user
  walks the cove; what they find goes back into 3.1's layout before 3.4 frames the views.
- [x] **3.3 Light by height.** Sunlight depends on the height of the point it falls on, as the atmosphere
  says, so hilltops catch the last light while the beach lies in the low sun's dimmer light. Check: the
  GPU's sunlight at sample heights agrees with direct marches through the atmosphere, the runtime time
  check still passes, and the overview at sunset shows lit hilltops above a dimmer shore.
- [x] **3.4 Views and briefs.** The final framing. The existing views keep their names; a new view looks
  from the beach into the setting sun at golden hour, the shot the cove is laid out for; a close-up
  shows the ground at the camera's feet. The AI drafts a brief for every view and the user agrees them,
  then the views test requires one. Check: every view judged against its brief at midday and at golden
  hour.

### 4. Ground surfaces and rocks

- Procedural texture generators in `textures/`. Surfaces: sand (dry, damp, wet, with ripples and fine
  grain near the camera), soil, grass base and rock. Blends follow height, slope and zone. No visible
  tiling.
- Procedurally shaped rocks and boulders, including the headland.
- Shade takes its light from below from the ground around it. Known from Stage 2: the lighting assumes the
  far sea below everything today; sand instead brings shade at noon from 3.3 stops below sunlit ground to
  about 1.5, and from blue to warm.
- Known from Stage 3: the zones are worked out twice, and they disagree along the edges between bands.
  `island.zoneOf` swings the sand's and the palm belt's edges with noise and judges rock by the exact
  slope; the terrain's shader uses fixed bands and the drawn grid's slope (about 5% of the cove's sandy
  land differs). Settle one definition, which the GPU and placement (Stages 8–9) share, before building
  surfaces on it. The terrain's info texture has no channel left. Rock judged by the mip-averaged slope
  fades on sharp ridges in the distance, where slopes either side average out. Sand lies on slopes up to
  54° where the beach meets the headland, though sand holds to about 34°.
- Known from 4.2: at golden hour the beach reads a flat, muddy brown, whatever the sand: level ground gets
  a sixth of the low sun's light, and the exposure keeps the evening dark (Decisions). What the
  sand does with a low sun (ripples catching it, wet sand mirroring the sky) has to carry the evening.
- Known from 4.3 (an outside review): the ripples keep one spacing and direction everywhere, without
  forks; between 20 and 120 m the beach has only drifts and wind streaks to show, and beyond that its
  plain albedo; at 16:30 the sand reads khaki rather than golden (Stage 11's grade may answer it).
- Known from 4.4: the rock is basalt (Decisions), its relief a field in world space at three scales
  over a detail tile laid along the axes it faces most (`chunks/rock.glsl`), so no cliff smears; layers
  of lava flows, streaks down the faces; sand and soil fill its hollows where it gives way to them.
  Within 200 m it has its tile and lichen, beyond its relief alone, by a cheaper shader. Its outline is
  still the heightmap's smooth curve, and from a few hundred metres a cliff reads more draped than
  jointed, its ribs rounded: columns, overhangs and fallen blocks need 4.5's rocks. Where rock pokes
  through sand it leaves a pepper of black specks; the volcano's steep patches still show as blotches
  from the overview until plants (Stages 8–9) frame them.
- Known from 4.5: about 2,000 rocks in the cove (`world/rocks.js`): basalt blocks and fallen columns
  (`rock-shapes.js`), placed by kind (`rock-placement.js` on `world/scatter.js`), each sunk until its base
  lies under the ground all round, and moved down each frame as far as the mesh as drawn lies below that
  ground across it (`chunks/terrain-mesh.glsl`, which the terrain fixture checks against its JS twin), so
  they stay sunk near and far; sand or soil drifts against their foot. Without shadows (Stage 5) a rock on
  the sand looks set down on it rather than sitting in it. Up close the blocks are faceted and fairly
  regular, and the surface detail on their flat facets is faint; the cliffs' outline above their foot is
  still the heightmap's smooth curve. Rocks stand only round the cove (`config.world.rocks.reach`).
- Known from 4.6: the green inland (`chunks/green.glsl`) is living green over bare ground in patches,
  by how lush the ground is (lush in hollows, open on ridges) and how sandy its soil (behind beaches),
  both kept per sample with the ground (`island.lushOf`, `groundOf`'s `sandy`) for placement too; near
  the camera, grass and leaf litter tiles (`textures/green.js`). It is painted flat: at standing height
  it reads as a dense, even lawn strewn with leaves, its tufts and leaves showing within about 15 m;
  the grass tile is stylised close up (every tuft a star) and the leaves are all of one outline. Seen at
  a slant the green hides the bare ground between it (`green.stand`), standing in for plants' height:
  Stage 9's plants hide it themselves. The jungle reads green from afar, as its canopy will. Bare
  patches 20–60 m off read as soft spots. A thin strip of green runs between the beach and the
  headland's foot in the `rocks` view, a sliver of ground between sand and steep rock (4.1's rules).
- Known from 4.7 (after an outside review): the ground's wetness has one input (`chunks/wet.glsl`):
  wet sand keeps its sheen to the horizon (far pieces that reach down to it draw it, TERRAIN_WET), the
  seabed has no film, and rock gets wet where sand does. The green's patches stay put and JS knows
  them (`world/green.js`); seen at a slant the bare ones take on the green rather than shrink, which
  took most of the freckles off the far hills. The grass tile holds its colour factor, so mipmaps keep
  the green's colour near the camera. Lichen keeps its share at any distance (now 3% of what faces up,
  as the user picked bare basalt), and sand or soil fills rock's hollows in the share the ground says,
  following the shading: the soot of specks off the `rocks` shelf is mostly gone, a fringe of crumbs
  stays at its edges, and the soil in the steep cliff's hollows shows (4.8). Sand and sandy soil lie no
  steeper than sand holds anywhere (the coarse grids judged slopes too gently): far cliffs and the
  volcano's gullies gained rock. Rocks: about 700 in the cove (most of the old 2,000 lay on the reef),
  none with a gap under it or inside another, none out at sea, and none drawn under two pixels: they
  sink away first. The surfaces' five tiles share one texture array; the detail ranges and the rocks
  scale with the presets; the game compiles its shaders while the start screen shows. SwiftShader
  frames cost 5–25% more (0.8–2.7 s): `rocks` is 0.16 s over its 2.5 s budget.
- **Done when** a close-up of sand holds up, no tiling shows from any view, and nothing looks plastic.

Sub-steps, in order. Each one ends with `npm run verify` green and `main` shippable, and fixes whatever it
made untrue in CLAUDE.md. What the ground is comes first, so the surfaces and Stages 8–9's placement build
on one definition of it; then the albedos and the light from below, so the surfaces are tuned once under
the final light; then the surfaces, hero first. The `stage4-before` capture shows plain colours: sand like
cardboard in low sun, a wet band of even brown, airbrushed edges from sand to grass, cliffs smeared down
their faces, rock on the ridges in blotches like camouflage, a flat green lawn at the jungle's edge.

- [x] **4.1 One ground.** What the ground is at each point (its zone, how sandy, how rocky) is worked out
  once and shared: the GPU draws it, and JS placement reads the same answer, fast enough to place plants
  by the hundred thousand (Stage 8). Sand lies only as steep as sand holds; rock stays rock on sharp
  ridges far away. The map shows the ground as drawn. Check: invariant tests over seeds 1–20, each seen
  red once: the zones keep their order from the shore and cover every point once, and no sand is steeper
  than sand holds; the GPU and JS agree on the ground at sample points, checked in the browser and proven
  on a deliberate offset. The pictures keep their plain colours, with the edges moved.
- [x] **4.2 Albedos and the light from below.** Each surface gets its albedo, from measured values, and
  shade takes its light from below from the ground around it: sand on the beach, green inland, the sea
  over water. The surfaces' detail (4.3–4.6) keeps to these albedos on average. How light the sand is
  (white coral sand or golden) and the air's clarity (Open questions) are a matter of taste: show the user
  candidates side by side, at noon and at golden hour. Check: the light fixture shows the light from below
  following the ground under it, and the runtime time check still passes.
- [x] **4.3 Sand.** The hero surface: dry, damp and wet sand, with ripples and fine grain near the camera,
  varied at every scale so it never repeats, without sparkle or crawl. The sand can look any wetness, from
  dry to the mirror sheen just after a wave drains, so Stage 7 only has to drive it; until then the
  wetness follows the height above the sea. A test scene shows the ground's surfaces without the island:
  level and steep, from the camera's feet to far away, in high and low sun. Check: the `sand` close-up
  holds up at its time and at midday, the beach views show no tiling, shimmer, banding and cost stay within
  their limits, and captures within their time budget on SwiftShader.
- [x] **4.4 Rock surfaces.** Rock where the ground is steep and along rocky shores: cliffs without smears
  down their faces, the same rock near and far, darker where the sea wets it. Which rock the island shows
  (dark basalt, weathered and lichened, or paler) is a matter of taste: show the user candidates side by
  side. Check: the headland reads as rock, not plastic, in every view that shows it; shimmer and cost
  within their limits.
- [x] **4.5 Rocks and boulders.** Procedurally shaped rocks break the heightmap's smooth outlines: at the
  headland's foot, along rocky shores, scattered inland. They are the first things placed on the ground, by
  rules Stages 8–9 reuse. They sit in the ground, not on it, near and far (the far mesh strays from
  `heightAt`: Stage 8's notes), and stay cheap far away. The `rocks` close-up (from 4.4) stands at the
  headland's foot by the water. Check: invariant tests over seeds: rocks only where the ground allows them, none floats,
  no view starts inside one; shimmer and cost within their limits.
- [x] **4.6 Soil and grass base.** The ground inland, where Stages 8–9 grow plants: the sandy scrub behind
  the beach, the palm belt and the jungle floor, as soil, grass base and leaf litter. The edges from sand
  to green follow the ground (4.1) and hold up close. From the overview the hills read varied, neither
  flat nor tiled. Check: the `jungle-edge` foreground holds up, no tiling shows from any view, and cost
  stays within its limits. Then the user runs the benchmark: the ground fills most of every frame.
- [x] **4.7 Harden.** An outside review of 4.1–4.6 (2026-10-24) found `verify` red in CI, bugs in the
  surfaces and rocks, and traps for the stages after. `verify` passes on SwiftShader, in CI too, with room
  to spare, and `main` publishes again. Nothing on the ground changes with where the camera stands: the
  green's patches and the line where it meets the sand stay put as the camera moves, and JS knows them
  for Stage 9; lichen covers the same share near and far; the green keeps its colour near the camera.
  Wet sand keeps its sheen to the horizon, the seabed under water has no film, and wet meets dry without
  stair-steps. The wetness has one input, which Stage 7 drives, and what the waves shape (ripples, swash
  marks) follows where they reach, not how wet the sand is now. No specks where rock meets sand, and no
  sand on cliffs anywhere on the island. No rock is drawn smaller than two pixels, none shows air under
  its edge or lies inside another, and what Stages 8–9 place can keep clear of them. The detail ranges and
  the rocks scale with the presets, the game compiles its shaders before it starts, and the terrain's
  shader leaves texture units free for shadows, caustics and cloud shadows. Check: tests for each, each
  seen red once; the GPU checks reach the rocks' offsets and the light from below; captures within their
  budget on SwiftShader.
- [ ] **4.8 The look, again.** Waits for Stage 4b: the port matches the build before 4.8, and the look
  is tuned once, in WGSL. What the review saw first in the pictures: the wet band reads as a flat
  grey kerb, the edge from sand to green as a cut-out lying on the sand, the shelf in `rocks` as soot
  sprayed on sand, the `sand` close-up as khaki without grain at midday, and the wet glint as lacquer.
  Since 4.7 the rock's hollows hold their true share of soil, which shows on the `rocks` cliff as tan
  pockets; the blocks taper upwards now (so their sides bury cleanly), and dry rock has no sheen. Each
  is a matter of taste: show the user candidates side by side. Check: every view against the stage's
  Done line, at its time and at golden hour. Known from 2026-10-25: from the `overview`, 1 km up, the
  green's speckle of bare ground behind the beaches falls under a pixel and shimmers (0.54%, over the
  0.5% limit).

### 4b. WebGPU port

Move the game from three.js's WebGL renderer to raw WebGPU, with hand-written WGSL and a small renderer
of the project's own. three stays only as a maths library. **Nothing changes visually:** the island looks
exactly as it does in the last WebGL build, and every check still passes and still catches its bad case.
New capabilities, such as compute, arrive in the stages that need them, not here. The port comes before
4.8, and `main` takes no change to the picture while it runs: anything that must land on `main` meanwhile
lands on the branch too, and the baseline is captured again.

**Decisions** (2026-10-24, in Decisions below): raw WebGPU with hand-written WGSL and a renderer of the
project's own, replacing the WebGL2 decision of 2026-10-20; three for maths only; WebGPU only, with no
WebGL fallback; MSAA 4 samples on every preset; reversed 32-bit float depth everywhere.

**Ground rules**
- Work on a branch. `main` stays on WebGL and shippable until the port matches, then merge once.
- Leave the pure JS untouched: island, heightmap, LOD, scatter, rock placement, sun, light maths, albedo
  and the workers. Keep the views and config values, except MSAA and the depth fallback.
- Port shader by shader, keeping function names, structure and comments, so a GLSL→WGSL diff reads side
  by side.
- No tuning and no improvements. A visible difference from the baseline is a bug, unless it's explained
  and logged.
- Use core WebGPU only. Don't require optional features (`shader-f16` and `float32-filterable`).
  `timestamp-query` is used where available, and the GPU time reads "n/a" without it.
- Stop and ask the user if a new dependency looks necessary, if captures can't be made reproducible, or
  if a check has to be loosened.

**Known facts and pitfalls** (measured in the 2026-10-24 sessions, or standard WebGPU):
- On SwiftShader (Linux), WebGPU renders at the same speed as WebGL, gives identical pixels across runs,
  and supports everything the frame needs:
  - 4× MSAA `rgba16float` with resolve;
  - `depth32float` with compare `greater`;
  - alpha-to-coverage;
  - reading multisampled depth in a later pass;
  - rendering into slices of a 3D texture;
  - compute writing 3D storage textures;
  - timestamp queries.
- Launch flags: `--enable-unsafe-webgpu --enable-features=Vulkan --use-vulkan=swiftshader
  --use-webgpu-adapter=swiftshader`. Without the first one there's no adapter.
- **Windows** (Playwright's headless shell, Chromium 156):
  - WebGPU gets the real GPU (D3D12) only with `--disable-dawn-features=use_dxc`. The headless shell
    ships without `dxcompiler.dll`, so creating the device fails without the flag; with it, Dawn compiles
    with FXC, and the probe's MSAA, depth, alpha-to-coverage and readback ran without validation errors.
  - There is no SwiftShader WebGPU on Windows: no adapter at all under the flags above, nor with a
    fallback adapter, `--enable-unsafe-swiftshader`, other ANGLE back ends or without the GPU sandbox.
    So WebGPU captures on SwiftShader come from Linux only: CI, a cloud session, or a Linux container
    on a Windows machine. `--gl auto` on Windows means the real GPU, and `--gl swiftshader` there must
    say where to get SwiftShader instead of handing over another adapter.
  - A Linux container on Windows (Ubuntu 24.04 in Docker Desktop, with the pinned Chromium) has it: the
    flags above give the SwiftShader adapter, and a test frame came out byte-identical across launches.
- **CI time.** On `adee91b` the build job took 22 of its 30 minutes, 20 of them captures (4.8–9.2 s a
  frame on SwiftShader). Captures can't get slower in the port without the job outgrowing its limit.
- **WGSL has no preprocessor.**
  - Variants (`#ifdef TERRAIN_SAND`, the `defines` objects) become `override` constants. A branch on an
    override set to `false` cost nothing on SwiftShader, the same as removed code.
  - `vite-plugin-glsl` already resolves `#include` in `.wgsl` files. Keep it, and add `.wgsl` to the
    hot-swap pattern in `vite.config.js`.
- **Uniformity.** WGSL rejects `fwidth`/`dpdx`, and texture reads that compute their own detail level
  (`textureSample`), inside branches that vary per pixel. Take derivatives before any branch, as
  `terrain.frag` already does. Inside branches, read with `textureSampleGrad` or `textureSampleLevel`.
  Use `diagnostic(off, derivative_uniformity)` only where it's proven harmless.
- **Y-axis and origins.** Framebuffer and texture origins are top-left in WebGPU. Anything that renders
  to a texture and samples it, or reads `gl_FragCoord.y` (the dither, the overdraw counter, readbacks),
  must be checked for flips.
- **Uniform buffers.** WGSL alignment rules apply (a `vec3` takes 16 bytes). Put the shared light state
  (`ctx.frame.uniforms` today) in one uniform buffer bound to every scene pipeline.
- **Readbacks.** `copyTextureToBuffer` needs `bytesPerRow` to be a multiple of 256, and `mapAsync` is
  async. This applies to the sky probe, the texture generators and the captures.
- **Depth.** WebGPU has no automatic depth resolve. The after-opaque pass (water) reads multisampled
  depth directly, or the frame resolves it in a pass of its own.
- **Determinism.** No results that depend on the order of atomic operations: on SwiftShader, an
  atomic-append list came out in a different order every run. Later GPU culling uses prefix sums.
- **Projection.** Use `Matrix4.makePerspective(..., WebGPUCoordinateSystem, true)` and
  `Frustum.setFromProjectionMatrix` with the same coordinate system.
- **Canvas.** Configure it with the preferred format and `alphaMode: 'opaque'`. The output pass keeps
  doing sRGB encoding and dithering by hand.
- **Not yet known:** whether GitHub's runners have the Vulkan loader WebGPU needs (prove it in W.1),
  and whether a Linux container on Windows gives the same bytes as CI.

**Found in the code** (a survey of `adee91b` while planning, 2026-10-24):
- **Waits on the GPU.** The game reads the GPU back and waits in two places: the sky's light probe on
  every time change, and the ground tiles' averages at boot. WebGPU readbacks are async, so the time
  change becomes async: it lands a few frames late, all of it in one frame. No frame mixes two times'
  light, and a capture's frame at another time still waits for it. The tiles' averages go behind
  `ready`. Today's stall on a time change (Stage 12's note) goes with it.
- **GLSL and WGSL differ where a port looks the same:**
  - `mod` floors, but WGSL's `%` truncates. It has 4 uses, in tile wrapping, with negative cells.
  - A float converted to an int saturates in WGSL.
  - `atan(y, x)` becomes `atan2`.
  - `dpdy` has the opposite sign to `dFdy`, because y points down. It has 6 uses, tangent frames
    among them.
  - Fragment positions count from the top. That matters for the output's dither and the readback
    passes. Tables written and read by fragment position need no flip; fullscreen passes that work
    from clip space do.
  - A uniform array can't be sized by an override (`LOD_LEVELS`, the maths fixture's `DIRECTIONS`).
- **three does more than draw.** It handles the scene graph and its layers, and the draw order
  (renderOrder, then program and material; the overdraw counts follow it). It also caches programs,
  generates mipmaps, resolves MSAA depth and copies it into the translucent pass. It provides a basic
  material, which six fixtures use, and `withSceneOutput()` builds on it. Each needs a counterpart of
  the project's own, or goes. Mipmaps made another way change the texture detail far off: they must
  filter as WebGL's did.
- **Some checks test things that go.** The leaky fixture's `scene.fog` has no scene left to sit in.
  The depth fallback has no fallback left. "A bad WebGL call" and "a lost context" become a validation
  error and a lost device. Each check is replaced by its WebGPU counterpart, which doesn't loosen it.
- **Noise level.** Different shader compilers round differently. The hash avoids `sin()`
  (`chunks/noise.glsl`), so its patterns can't jump. "Matches `webgl-final`" means: no difference
  visible in the compare sheet, and every view within a few levels, measured. Anything above that is
  explained or fixed.

Sub-steps, in order. Each ends with tests, build and check green, plus the checks named. The full
`verify` is green from W.4 on. Each system's GLSL goes in the step whose WGSL port matches the
baseline: on the branch nothing runs it any more, and `adee91b` keeps it for side-by-side reading.

- [x] **W.0 Baseline.**
  - Fix CI first: since "Add more beaches" `verify` has failed because the benchmark check times out at
    60 s on SwiftShader, so the live site is still Stage 3. Then `main` is green.
  - On that commit, capture `webgl-final` with `--gl swiftshader`: all views, and the four named times on
    the `horizon` and `overview` views.
  - Add this stage to PLAN.md and reopen the WebGL2 decision.
  - Done 2026-10-24. 4.7 had already fixed CI: `verify` passed on `adee91b` and the live site shows
    Stage 4. The baseline is `adee91b` on SwiftShader WebGL, Chromium 156.0.8078.4, 1600×900:
    `webgl-final` (all views, with `--checks`, so its `info.json` holds every check's numbers),
    `webgl-final-<time>` for each named time (`--views horizon,overview --time <time>`), and
    `webgl-final-tonecard`, `-gradient` and `-blend` (`--views beach --fixture <name>`, the blend at
    `--exposure 2` as its check takes it). `screenshots/` isn't committed: a machine without them
    recreates them byte for byte from `adee91b` (a git worktree) with the same args and Chromium build
    (CLAUDE.md §4).
- [x] **W.1 Device, frame and tools.** The foundation every later step is checked with.
  - WebGPU device setup, and the "needs WebGPU" note. The game still opens from `file://`.
  - Errors: shader compile messages, validation errors, a lost device and uncaptured errors. All reach
    the error overlay and fail a capture.
  - A renderer of the project's own in place of three's:
    - shaders with includes and overrides, hot-swapped in dev as today;
    - the light state in one uniform buffer that every scene pipeline binds;
    - a draw list with the frame's passes and three's draw order;
    - textures with mipmaps;
    - readbacks.
  - The frame:
    - the HDR target (4× MSAA `rgba16float`, reversed `depth32float`);
    - its passes: opaque, after-opaque, translucent in linear light, composite, the post chain;
    - the output pass (tonemap, sRGB, dither) and the fullscreen pass.

    The depth fallback and MSAA 2 are never ported.
  - The capture contract (`ready`, extra frames, readback), and the screenshot tool's launch flags and
    backend detection.
  - A Windows session can make SwiftShader captures that match CI's bytes, so every step compares with
    `webgl-final` without waiting for CI.
  - The compare sheet gives, per view, how many pixels differ by how many levels.
  - The fixtures that need no world, on a basic material of the project's own: `tonecard`, `gradient`,
    `blend`, `broken`, `shimmer`, `silhouette`, `depth`.
  - Check:
    - `tonecard`, `gradient` and `blend` match `webgl-final` and pass;
    - the `shimmer`, `silhouette` and `depth` checks pass;
    - the errors check catches a broken shader out of sight, a validation error, a lost device and
      blending outside the translucent pass;
    - a push of the branch shows WebGPU working in CI, and a capture there is byte-identical to the
      same capture made locally.
  - Done 2026-10-24. Windows makes SwiftShader captures in a Linux container (`tools/linux.js`, Docker),
    where `webgl-final` came out byte for byte again. `tonecard`, `gradient` and `blend` match it within
    a level.
- [x] **W.2 Sky and light.**
  - The atmosphere's tables:
    - transmittance;
    - multiple scattering;
    - sky view;
    - the 3D aerial table;
    - sunlight by height.
  - The probe and the light state from it, and the shared lighting chunks.
  - The sky drawing last on the far plane, and the placeholder water.
  - A time change lands whole (see above).
  - Check:
    - the `maths`, `haze` and `light` checks pass at their current limits and still catch their
      deliberate mistakes;
    - the runtime time check passes, and `stale-time` is still caught;
    - the `horizon` view matches the baseline at every named time.
  - Done 2026-10-24. At every named time under 0.2% of the horizon's pixels differ, by 1–2 levels,
    apart from a one-row step in the horizon line at the frame's left edge. The light lands in the
    readback's callback, so a frame never shows half of it.
- [x] **W.3 Ground.**
  - The heightmap's and the ground's textures, the LOD mesh with instancing, and the terrain's
    variants as overrides.
  - The generated tiles (sand, rock, green) with mipmaps, their averages behind `ready`, and the
    bounce map.
  - Check:
    - the `terrain`, `surfaces` and `patches` checks pass and still catch their deliberate mistakes;
    - the `beach`, `shoreline`, `jungle-edge`, `overview`, `into-the-sun` and `sand` views match
      `webgl-final`, far ground included;
    - captures take no longer than `webgl-final`'s.
  - Done 2026-10-24. 92–99.8% of each view's pixels are identical to `webgl-final`, and at most 0.44%
    are more than 8 levels off: single pixels of fine detail (the rock's streaks, glints, the green's
    dithered edges) where float rounding crosses a threshold, and edges (see the known flaws). No
    shape moved. Three traps cost time:
    - 8-bit mips round halves to even in WebGL, but up in a WebGPU render pass, so every level came out
      brighter. `gpu/mipmap.wgsl` now rounds as WebGL did, which reproduces its levels exactly.
    - A uniform array of `f32` or `vec2f` doesn't have GLSL's layout (it broke the mesh's height and
      the rocks' offsets). Uniform arrays now hold `vec4f`, and `gpu/reflect.js` refuses others.
    - Frames took 50% longer on SwiftShader until the heights were read with one `textureGather`
      instead of four `textureLoad`s, which Dawn bounds-checks one by one. Now 545–575 ms a frame,
      against WebGL's 502–617 in the same container.
- [x] **W.4 Rocks, measurements and teardown.**
  - Rocks and their offsets pass.
  - Cost counts (draws, triangles, passes, pipelines, memory) and overdraw.
  - GPU time via timestamp queries.
  - The readout (F3), and the benchmark, which names the adapter.
  - Teardown, with the `leaky` and `heavy` fixtures in WebGPU's terms.
  - Check:
    - the full `npm run verify` is green on SwiftShader, locally and in CI, and CI's build job takes no
      longer than on `adee91b`;
    - every view and named time matches `webgl-final`;
    - the cost numbers match `webgl-final`'s, or each difference is explained;
    - every tool check still catches its bad case;
    - the quality change (high → low → high) leaks nothing and gives the same picture.
  - Done 2026-10-24. The cost numbers equal `webgl-final`'s on every view (draws, triangles, passes,
    overdraw, texture memory), apart from these:
    - 26 pipelines against 25 programs: the frame's depth resolve, a blit in three, is a pipeline made
      up front.
    - 0.13 MB more in render targets: a second set of transmittance and multiple-scattering tables,
      so a time change lands whole.

    Overdraw was 1% off until the draw order was three's again. Under reversed depth, three negates
    the depth it sorts by, which the port had missed: opaque meshes drew far to near and transparent
    ones near to far (`gpu/scene.js drawOrder`, tested).

    CI's build job took 12.5 and 24.9 minutes on two runs of the same code. GitHub's runners differ
    about twofold in speed, in every view, check and test alike, and `adee91b`'s run (21.7 minutes)
    landed in between. In the same container, frames take as long as WebGL's. CI's captures are
    byte-identical to the container's.
- [x] **W.5 Cut-over.**
  - Delete what's left of three's renderer and of WebGL: the depth fallback's fixture, check and
    `nearFallback`, `?depth=`, and the MSAA knob.
  - Add a lint to `npm run check` so three is imported for maths only.
  - Review the port from outside: a reader who hasn't seen it compares the WGSL with `adee91b`'s GLSL.
  - Update CLAUDE.md:
    - §2: three for maths only;
    - §3: flags, `--gl`;
    - §4: where SwiftShader captures come from (Linux only, see above);
    - §6: architecture;
    - §7: `ctx.frame`;
    - §8: WGSL, uniformity, overrides, MSAA 4, reversed depth everywhere, no atomic-order dependence,
      Y origin;
    - §9: shader files.
  - Update the README with browser requirements, and PLAN.md's Decisions and Log, and the later stages'
    notes that the port made untrue (three's shadow pitfalls in Stage 5, the Firefox depth fallback and
    WebGL context loss in Stage 18).
  - Hand over to the user:
    - run the benchmark on real hardware, compared with the last WebGL build on the same machine;
    - open the game in Chrome, Edge, Firefox (Windows) and Safari 26;
    - merge to `main`.
  - Done 2026-10-24, but for the hand-over. Two readers compared every WGSL file with `adee91b`'s GLSL
    and found no transcription error. A third reviewed the renderer; fixed from it:
    - `frame.opaque.depth` was the multisampled depth the after-opaque pass draws into, which it can't
      read. Now it is the depth resolved to one sample, as WebGL gave it, and the blend fixture checks it.
    - Player mode waits for the sky's first light: the first frames were black.
    - A sky that fails to land its light, and shaders that fail to compile outside the scene, now say so.

    A second round, at the user's request, took four other angles: the JS around the shaders; the
    checks themselves; WebGPU's layout and semantics; and both builds run side by side under 75
    conditions the captures don't cover (presets, sizes, tonemaps, exposures, times, seeds, fixtures).
    Fixed from it:
    - the draw order and the mip rounding (W.3, W.4);
    - in dev, a shader fixed after an error now restarts the game, as WebGL's did;
    - `reflect.js` refuses layouts and values it would get wrong silently;
    - the three.js lint catches dynamic and unspaced imports;
    - the errors check proves the tool still recognises the browser's own WebGPU warnings;
    - player mode compares what its canvas shows with the capture of the same view (0.2 levels off);
    - shader modules join the teardown's counts;
    - a game that never starts drawing fails the tool instead of hanging it.

    The user's benchmark (GTX 1660 Ti, 2562×1237, `high`):
    - Both builds hold 60 fps on every view, with the same draws, triangles and passes.
    - GPU ms across all views: 6.1 and 6.7 on WebGL; 6.4–6.6 on WebGPU. WebGPU was faster where sky and
      sea fill the frame, and slower where ground does.
    - Some of that was the timer, not the GPU. WebGPU's timer ran from the frame's first pass to its
      last, so it counted the GPU waiting for the CPU between passes: headless on that GPU, a quarter of
      the span (5.6 ms busy in 7.5). WebGL's timer saw the frame as one stream.
    - The timer now sums the passes' own durations (`core/gpu-stats.js`). Rerun on `02249b2`: 5.05 ms
      across all views in both runs, 21% less than WebGL's. Every view takes less GPU time (horizon
      −48%, sand −5%), and so do the slowest frames (p95 6.7 against 8.4 ms). WebGL's timer may count
      some idle time too, so WebGPU is at least as fast, not exactly 21% faster.

**Known flaws** (for review):
- WebGL stored its targets bottom-up, WebGPU top-down, and two things follow. Edges and detail differ
  from WebGL's in single pixels; nothing is better or worse. Rendering the frame upside down would match
  WebGL, at the cost of a flip in every pass from then on, so the port doesn't.
  - MSAA's sample pattern is mirrored. Edges at shallow angles get other coverage: the silhouette
    fixture has 0.85% of pixels more than 8 levels off.
  - With an odd drawing-buffer height (the low and medium presets at 900 rows), derivatives pair other
    rows, so footprint-filtered detail shifts by a row. The rocks view at low has 2.1% of pixels more
    than 2 levels off, against 1.9% at an even height.
- The low preset has 4 samples now (Decisions), so its render targets take 46.9 MB at 1600×900 instead
  of 31.9.
- Behaviours of three's renderer that nothing uses yet are missing: a change of render state needs
  `needsUpdate`, double-sided transparent meshes draw in one pass, a mirroring transform doesn't flip
  the front face, alpha-to-coverage needs a target with samples, and a destroyed texture keeps its cached
  bind groups. `gpu/material.js` says so where it bites. A drawing buffer beyond the device's limit
  (8192 px) fails instead of shrinking.
- Speed on real hardware and the four browsers are untried (the hand-over).

**Done when** `verify` is green on WebGPU in CI. The compare sheet against `webgl-final` shows no visible
change on any view or named time, and every check proves itself on its bad case as before. No WebGL code
remains. The docs describe the new conventions. The user has run the benchmark on their machine and seen
the game in each browser.

### 4c. Maths of our own

Remove three.js, the game's last runtime dependency. Since Stage 4b it does maths only: vectors, matrices,
rotations, colours, culling shapes and half floats. Each becomes a small module of the project's own. This
is about dependencies and control, not speed: the frame rate is set on the GPU, and the maths costs
microseconds a frame. **Nothing changes:** every picture stays byte-identical, nothing gets slower and
nothing gets less correct. The stage comes before Stage 5, whose shadows bring the most new maths (the
sun's cameras), so that maths is written once, on the project's own modules. 4.8 can come before or after it.

**Decision** (2026-10-24, in Decisions below): no runtime dependencies; three goes.

**Ground rules**
- Not one bit of any picture changes. Captures are deterministic, so on the same backend every capture
  equals the baseline's, and so do `info.json`'s measurements, timings aside. A difference is a bug in the
  new maths.
- Only what the game uses, as the game uses it: no API for its own sake. Later stages add what they need,
  with tests. Call sites read as clearly as before.
- The pure JS keeps its logic (island, heightmap, LOD, scatter, rock placement, sun, light maths, albedo);
  only where its maths comes from changes.
- Where the project's code follows three's, it keeps three's MIT notice, in the source and in the built file.
- Stop and ask the user if a picture can't be kept identical, or a check would have to be loosened.

**Found in the code** (a survey of `51774eb`, 2026-10-24):
- 29 files in `src/` import three (14 of them fixtures), and so do 3 tests. They use:
  - `Vector2`, `Vector3` and `Vector4`; `Matrix3` (normal matrices); `Matrix4` (compose, invert, multiply,
    the reversed perspective, look-at, a rotation); `Quaternion`; `Euler`, of which only the camera's
    angles, in `YXZ` order, are read; `Color`;
  - `Box3`, `Sphere` and `Frustum`, to cull the terrain's nodes, the rocks and every mesh;
  - `MathUtils` (degrees, clamp) and `DataUtils` (half floats);
  - `WebGPUCoordinateSystem`, which changes nothing under reversed depth: three takes the same path for
    either clip space then.
- The maths reaches the pictures four ways, and a difference in the last bit can move any of them:
  - the camera's and the meshes' matrices, in every draw's uniforms;
  - culling and the draw order (the overdraw counts follow it);
  - rock placement, where rotations decide where each rock sits, how deep it sinks and whether it shows;
  - half floats in the heightmap's and the fixtures' textures, and the sRGB colours of the placeholder water
    and the fixtures.

  three computes in doubles on plain numbers, so plain JS reproduces its bits, but only in its order of
  operations: `degToRad(x)` is `x * (π / 180)`, not `x * π / 180`.
- **Half floats truncate.** three's `toHalfFloat` drops the bits a half float can't keep (and clamps at
  ±65504, with a warning). JS's own `Math.f16round` and `Float16Array` round to nearest, which moves texels.
- **The renderer reads three's shapes.** `gpu/reflect.js` packs a uniform from a vector's `x, y, z, w`, a
  colour's `isColor` and `r, g, b`, and a matrix's column-major `elements`. Systems set uniforms with
  `fromArray`, and the capture reads them with `toArray`. `gpu/scene.js` keeps a node's angles and its
  quaternion in step through three's private `_onChange` hooks.
- **Degenerate inputs take branches that random inputs seldom reach:** normalizing a zero vector, a rotation
  between opposite directions, a pitch of ±90° turned back into angles, inverting a singular matrix, half
  floats beyond their range or below their smallest normal.
- **Some tests use three as an independent reference:** `tests/image.test.js` checks `panShift` with three's
  own camera. Once three goes, they need a reference other than the code they check.
- **Licence.** `gpu/geometry.js` and `core/camera.js` already follow three's code. The built file carries
  three's MIT notice only because three is bundled (`vite.config.js` keeps legal comments).
- `tools/check-build.js`'s lint lets `src/` import three's maths only, by name, and forbids three's clocks
  and random helpers.

Sub-steps, in order. Each one ends with `npm run verify` green, `main` shippable, and captures
byte-identical to `maths-before`.

- [x] **M.0 Baseline.** On `main` as it stands, capture `maths-before` as W.0 captured `webgl-final`: every
  view with `--checks`, the named times on `horizon` and `overview`, and the `tonecard`, `gradient` and
  `blend` fixtures. Time the JS that uses the maths most: at boot (placing the rocks) and each frame
  (culling, the draw order, the matrices). Timings compare only on one machine, so a later session on
  another machine times the baseline's commit again. Record the built file's size.
  - Done 2026-10-24 on `51774eb`: `maths-before` on SwiftShader (the Linux container, Chromium 156.0.8078.4,
    1600×900) and `maths-before-hw` on the session machine's GPU, each the whole set. Two hardware runs of
    one build came out byte-identical, so hardware captures served as the quick check. The built file:
    700.0 KB raw, 160.0 KB gzip.
- [x] **M.1 The maths.** Modules of the project's own for everything the survey lists. Every function gives
  three's answer to the last bit: tests compare the two on seeded inputs and on every degenerate case
  above, each test seen red once. Other tests hold the maths to what it should do, without three: an
  inverse undoes its matrix, angles turned into a rotation and back come out the same, a sphere inside the
  frustum is kept and one outside is culled, half floats keep exactly what they can hold. Nothing uses the
  new modules yet.
  - Done: `src/maths/` (index.js exports them, with three's MIT notice). `tests/maths.test.js` runs 18 case
    sets, 199,683 numbers, each giving three r186's answers to the last bit; the answers are recorded as
    hashes in `tests/fixtures/maths/three-answers.json`, and with three installed for the moment
    (`npm i --no-save three@0.186.1`), `THREE_MATHS=compare` names the first number that differs.
  - The inputs come from a generator of the test's own and are made without `Math.pow`, whose results V8
    changed in Node 24; the sRGB curve, which takes `Math.pow`, is held to three's formula by a test of its
    own. The answers hold on Node 20.19, 22.12 and 24.21.
  - Of 64 deliberate mistakes in the maths, all but two turn the tests red; those two can't change a
    result (doubling is exact, and exponents below −26 give zero either way).
- [x] **M.2 Switch-over.** Every import of three in `src/` moves to the new modules, one area at a time:
  rock placement; the renderer, scene graph and camera; the systems and fixtures. The tests that used three
  as a reference get one that isn't the code they check. Check: after each area, the compare sheet says
  "identical" for every view, named time and fixture, and `info.json`'s measurements are unchanged; the
  quality change leaks nothing; the JS timed in M.0 is no slower.
  - Done. Rock placement was checked on its own output: 6,330 rocks over nine seeds, every number
    identical. The other two areas went over before one capture. On both backends all 148 PNGs of the set
    (views, crops, banding, shimmer, motion, overdraw) are byte-identical to `maths-before`, `info.json`'s
    measurements are equal, and the compare sheet says "identical" on every view. The hardware run's
    player mode failed, as on the baseline (M.3, found on the way).
  - `tests/image.test.js` checks `panShift` against the game's own camera, and `tests/rock-placement.test.js`
    turns points by a rotation matrix of its own; each goes red when broken on purpose.
  - Timed in turns, ten runs each (82 rounds) on an otherwise idle machine. Placing the cove's rocks (715 on
    the timing script's coarser grids; the game's own give 703) took 82.6 ms with three and 81.4 ms after
    (medians). A frame's culling, draw order and matrices took 103.9 and 105.0 µs: the same within noise.
    A sum over the frame's results (normal matrices, what was culled) came out the same.
- [x] **M.3 Removal.** three leaves `package.json` and the lockfile. Once it is gone, the tests still hold
  the maths to three's answers on their cases. The lint has one rule for imports: `src/` imports only its
  own files, with a fail fixture (CLAUDE.md §5); the rules for three's clocks and random helpers go with
  three. An outside reader compares each function with three's original and checks that the tests reach its
  branches. CLAUDE.md is corrected where it says three: §2 (dependencies, the lint), §3 (`npm run check`),
  §6 (where the maths lives, `gpu/`), §8 (colours, the projection, frustums). Check: `package.json` has no
  `dependencies`; `npm ci` on a clean checkout and `verify` are green, also in CI; the built file no longer
  bundles three and still carries its MIT notice for the code that follows three's; its size is recorded
  against M.0's.
  - Done. `package.json` has no `dependencies`.
  - The guarantee is the build's: it fails when it bundles any module from outside `src/` and `index.html`,
    whatever brought it in (`checkModules`, called from `vite.config.js`). A build with an import hidden from
    the lint behind a line continuation failed this way.
  - The lint's rule (`own-imports`) is the early warning, with a file and a line. It checks every module
    a file names, wherever it sits: `from '…'`, `import '…'`, `import(…)` and `import.meta.glob(…)`. It
    passes only relative paths, with forward slashes, into `src/`.
  - A test trips the lint with packages, `node:` modules, quoted names, imports nested in classes and
    functions, glob character classes, type arguments, absolute paths, backslashes and paths out of `src/`.
    Words such as `'import'` must not trip it. (Source rules are tested with trees of files, not HTML
    fixtures.)
  - A regex reads text, not JavaScript, so contrived code still gets past the lint; the build stops it.
  - Three rounds of outside readers, six in all; none found a difference in any number the game computes.
    - They read every function against three's.
    - They fuzzed against three's own code: 413,000 checks in the first round and 50 million numbers in
      the second, ordinary, extreme and non-finite.
    - They compared the old code with the new on every view's camera, the geometry, 20 seeds of rocks and
      20,000 sequences of the scene graph's rotations.
    - They re-recorded three's answers byte for byte.
    - They checked every claim here against the captures and logs.
    - The last of them tried to slip imports past the lint, which led to the build's check.

    Fixed from them:
    - half floats become numbers through three's tables;
    - an `update` flag counts only when `true`, as in three;
    - `Euler.set` refuses an unknown order before changing anything;
    - the camera's `reversedDepth` flag went (the draw order assumes reversed depth, as the projection does);
    - the lint's gaps, and a hole the first fix of them opened (it now matches modules, not clauses), and
      the build's module check behind it;
    - tests for exact ties, nearly opposite directions, non-finite inputs, what a change call sees and what
      the maths refuses, and the test's independence from the engine's `Math.pow`;
    - the rock test's rotation of its own;
    - comments that said wrong things.
  - The built file: 617.3 KB raw, 137.1 KB gzip (83 KB less), with three's notice from `src/maths/index.js`
    and none of three's code. A fresh copy of the working tree (nothing is committed yet) installs from the
    lockfile with `npm ci` and passes test, build and check.
  - The final captures of the final code are byte-identical to `maths-before`, measurements included:
    - `maths-final`, from `verify` in the Linux container after `npm ci` there, on the working tree;
    - `maths-final-hw`, from `verify` on the GPU.
  - Found on the way: player mode looked for the start screen 30 browser frames after the page loaded, which
    a busy machine's boot outlasts. It failed on the unchanged baseline too. Now it looks once the game draws,
    and it still catches a start screen that never shows (a build that hides it fails).

**Known flaws** (for review):
- On purpose, the maths refuses what the game doesn't use. `Color` throws on CSS names, `#rgb`, `rgb(…)`
  and `hsl(…)`, which three parsed, and on `null`, objects and other strings, where three left the colour
  white. Euler orders other than XYZ and YXZ throw, where three supported all six. A later stage that needs
  more adds it, with tests.
- The recorded answers say which case set differs, not where. Finding where needs three for the moment
  (`npm i --no-save three@0.186.1`, `THREE_MATHS=compare`). They hold while the engine's `sin`, `cos`,
  `tan`, `asin` and `atan2` give what V8's have since 2016; the file records the V8 it was made on.
- The bits of a NaN written into a `Float32Array` (a readback) depend on how the engine compiled the call,
  so the tests compare values, not those bits.
- The switch-over took two areas before one capture, not one at a time; the capture came out identical.
- CI hasn't run it yet: that needs a push. The container's `verify` is CI's, byte for byte (Stage 4b).

**Done when** the game has no runtime dependencies; every view, named time and fixture is byte-identical to
`maths-before` on the same backend; the maths' tests reach every branch they replace and hold it to three's
answers without three installed; nothing timed in M.0 got slower; and CLAUDE.md says how things are. The
GPU does the same work as before, so the user's review needs no benchmark or browser runs.

### 5. Shadows

- Sun shadows across the whole depth range: soft penumbrae, stable when the camera moves (no shimmering),
  long and soft at low sun. Objects sit on the ground instead of floating.
- Shadow quality scales with the quality presets.
- Plant shadows come with the plants in Stage 8. Build the shadow system so leaves can later cast
  leaf-shaped shadows.
- Known from Stage 4b: there are no built-in shadows; the shadow maps are the project's own, drawn in a
  `frame.beforeScene()` pass. Depth is reversed, so a depth bias takes the opposite sign to the usual.
  Anything whose vertex shader moves it (the terrain's morph, the rocks' offsets, later leaves and waves)
  needs a depth material that moves it the same way.
- Known from Stage 4: rocks (`world/rocks.js`) need shadows near and far, and cast them on the sand they
  sit in; their vertex shader moves each by its offset onto the mesh as drawn, which a shadow pass must
  take too, or it casts every rock's shadow from where its instance starts. The light from below
  (`groundAlbedo()` in `skyIrradiance()`) assumes the ground around is in the sun, so shade under a canopy
  or a cloud gets it in full. Until there are shadows, golden hour has no cool shade anywhere: everything
  is warm.
- Known from Stage 2: new light uniforms (the shadows') go in `ctx.frame.uniforms` and
  `chunks/frame-struct.wgsl`, which every scene material binds at group 0. Capture mode's pre-compile
  (`frame.compile()`) covers the scene's passes and the frame's own materials: a shadow pass's
  materials must join it. The sky is in the opaque pass, so a shadow pass has to leave it out.
- Known from Stage 3: the terrain's morph and the planet's bend (`chunks/planet.wgsl`) measure from the
  frame's `cameraPosition`, which in a shadow pass is the light's camera. The terrain picks its nodes
  once a frame, for the main camera, into the meshes' shared instance buffers: a shadow pass reusing
  them would miss casters out of view, such as the volcano with the sun behind it. The mesh's shape
  depends on where the camera is (its levels of detail), so whatever draws it must agree on that camera.
- Known from the optimization review (2026-10-25), for the renderer (`src/gpu/`):
  - Each `renderer.render()` encodes and submits its own pass, so uniforms written between passes apply
    in order: a frame is 3 submits, and 37 when the sky's tables follow the camera's height. Cascades
    multiply passes. One command encoder a frame needs a slot per pass for what changes between passes
    (the materials' uniform buffers, and the objects' slots, which start at 0 every pass), as a ring
    with dynamic offsets.
  - Group 0 (`chunks/frame.wgsl`) binds the frame's tables to every scene material, also in a pass that
    draws into one of them. A shadow map can't go there: give it, and whatever else the frame draws into,
    a group of its own, bound by the passes that read it.
  - The sky's 3D aerial table takes 32 render passes, one a slice (WebGL had no compute). Make it one
    compute pass once the renderer has compute pipelines.
  - A system with many meshes keeps their instances in one set of attributes, each mesh drawing its
    range (`gpu/geometry.js` Attribute, `firstInstance`): the terrain and the rocks do. A shadow pass
    that needs other instances than the main view's needs ranges of its own.
- **Done when** low-sun captures show long, soft shadows from the rocks and terrain, with no acne, no
  detached shadows and no hard edges, and the camera-offset captures show no shimmer (the tool turns the
  camera but can't move it yet).

### 6. Ocean

- `water/`: waves (swell plus chop); sky reflection; a sun-glitter path; colour from depth, from clear
  turquoise shallows to deep blue; the seabed visible through the shallows, with surfaces of its own
  (rippled sand, the reef), which only the water shows; a far sea that doesn't sparkle
  or alias; a seamless fade into the horizon haze; the white line of surf on the reef.
- Walking, swimming and sound will need the water's motion in JS as well, and it must agree with what's
  drawn (CLAUDE.md §5).
- Known from Stage 2:
  - The haze over the far sea matches the physics (the `haze` check), so the colour where the sea meets
    the sky is now the water's own. The placeholder mirrors the sky from 8° up, which leaves a line at
    the beach's horizon and a flat salmon sea at sunset.
  - The sun's disk, its glow and the ceiling on its brightness exist only in the sky's shader, so
    reflections miss the glow (beside the setting sun the sky reads 186 and the sea 155) and a reflected
    sun would come out uncapped. Reflections read the sky as seen from the camera's height: from 135 m,
    up to half again too bright beside a low sun.
  - Where no seabed is drawn, `frame.opaque` holds the sky's colour and the far plane's depth. The
    seabed's own shader already adds the haze in front of it, which the water must not add again.
  - Nothing reads `frame.opaque.depth` yet. The first thing that does proves it in a fixture, as the
    blend fixture proves the colour.
  - The translucent pass has one sample per pixel and can't add light, so glints can't go there.
- Known from Stage 3:
  - The terrain's shader skips seabed under the placeholder water, which hides it (TEMPORARY in
    `terrain.frag`): remove that with the placeholder.
  - The terrain's grids end where the sea is deep all round (`island.coveBounds`, about 1 km out from
    the cove); beyond them heights repeat the coarse grid's edge (−50 to −90 m) in straight stripes to
    the horizon. The drawn seabed ends about 1 km out.
  - The coast's distance comes from the exact shapes, the drawn waterline from the grids: take the
    waterline from the drawn depth.
- Known from Stage 4: the GPU reads the reef's offset with the ground (`terrainGround()`, held within
  ±250 m), but no distance to the shore any more. The light from below takes the far sea's albedo over
  all water (`world/albedo.js`), though the shallow lagoon over white sand sends up far more. Under the
  sea the ground is soaked but has no film of water (`chunks/wet.wgsl`): the water's surface mirrors.
  The terrain's shader reads 9 textures of the 16 a shader is sure to have (the surfaces' tiles share
  one array, `textures/surfaces.js`).
- Known from the optimization review (2026-10-25): the terrain leaves out nodes a metre and more under
  the placeholder water (TEMPORARY in `world/terrain.js`, beside the `hidden` early-out in
  `terrain.wgsl`): the seabed the water shows needs them back, culled by what the water hides instead.
  The after-opaque pass draws on the opaque pass's samples, which resolve into a texture of their own
  for it (`frame.opaque.color`), and it resolves the HDR target itself: no pass of its own for that.
- **Done when** the placeholder water is gone and the lagoon reads as tropical at every time of day.

### 7. Shoreline (the hero)

- Waves run up the beach and slide back. Foam lines, plus foam that lingers. Wet sand that is darker and
  mirror-like, and dries slowly after each wave. Caustics dancing on the shallow seabed. A small shore
  break.
- Expect several sessions. Split this stage into sub-steps.
- Known from Stage 3: the coast's distance (`island.sample().coast`) isn't metres; across the shore it
  changes by 0.5 to 1.7 a metre, so bands measured in it vary in width on the ground. Near the camera
  the waterline is drawn as a polyline 1 m a side, whose kinks show in the `sand` close-up. The cove's
  beach is a smooth arc by design, as sandy bays behind a headland are; the small-scale life of a real
  waterline, beach cusps scalloped by the swash every 20–40 m, comes with the waves.
- Known from Stage 4: the sand takes any wetness from dry to a film of water (`chunks/sand.wgsl`): the
  waves only have to drive it; today it follows the height above the sea, its edge wandering in arcs
  (`sandReach`). Looking down, the sun's glint on the film is a smooth oval, which reads a little CG;
  looking into a low sun, the wet band stays darker than a real foreshore, which mirrors the bright sky
  round the sun: the film is only about 2 m wide, and the sky's light as SH blurs that glow away. The
  wetness has one input for sand, rock and the rocks (`chunks/wet.wgsl`): drive `wetness` (and its film)
  there, and keep `washed`, where the waves reach, which the ripples and swash marks follow, so drying
  sand doesn't grow ripples. Spray darkens rock to 2 m above the sea (`chunks/rock.wgsl`): waves
  breaking on it should drive that too.
- **Done when** the low beach view is a wallpaper, its motion strip shows waves running up and draining
  back naturally (the strip spans 2.5 s today, less than one wave), and the user finds the motion natural
  in the running game.

### 8. Foliage foundation and coconut palms

- `plants/`, the shared foundation for all plants:
  - procedural leaves with colour, shape, surface detail and translucency;
  - foliage shading, including the gold-green glow of backlit leaves;
  - leaf edges that neither flicker nor alias, near or far;
  - shadows from leaves, so plants cast soft, dappled shade that moves with them;
  - one shared wind model, with gusts that travel across the island;
  - placement by zone, density per quality preset, and many plants drawn cheaply.
- First species: leaning coconut palms along the cove, with coconuts.
- Judge flicker with Stage 1's motion captures and shimmer score, near and far. Extend the tool if they
  miss something. Known gaps: the shimmer pan only moves diagonally, so a thin line along that diagonal
  scores nothing; a per-view percentage hides flicker on a single palm; overdraw misses what cut-out
  leaves hide behind their holes, and counts points, lines and sprites wrongly.
- Shade under a canopy blocks the sky's light as well as the sun's. Known from Stage 2: nothing blocks
  the sky's light yet, and at golden hour it is 52% of the light on level ground, so shade would glow.
- Known from Stage 1: no fixture proves alpha-to-coverage yet, and geometry thinner than about two pixels
  crawls even with MSAA.
- Known from Stage 4: placement reads the drawn ground (`heightmap.zoneAt`, `groundAt`: what the GPU
  draws, about 0.25 µs a point), not `island.zone()` (7 µs, and a little off the drawn ground).
- Known from Stage 3: near the camera the mesh is `ctx.terrain.heightAt`, but farther out its levels of detail stray from it (by
  centimetres at 200–400 m, decimetres beyond, metres far out) and change as the camera moves. Known
  from Stage 4: `chunks/terrain-mesh.wgsl` gives the mesh's own height as drawn (`terrainMeshHeight`, the
  vertex shader's own morph), with a JS twin (`ctx.terrain.meshHeightAtCove`) that the terrain fixture
  checks it against; rocks move by it each frame in a pass of nine texels each (`world/rocks.js`, about
  700 rocks), which won't scale to plants by the hundred thousand: they need their offsets another way.
  Placement by rules is `world/scatter.js`, and what it places keeps clear of what is there already
  (`ctx.rocks.clearance`), so palms don't grow through boulders. It runs on the main thread at boot,
  while the GPU makes the surfaces' tiles (`ctx.terrain.grids`), and is kept per seed through a quality
  change (the rocks take 0.13–0.3 s cold): plants by the hundred thousand need workers. Plants also bend with the planet
  (`chunks/planet.wgsl`), or the far ones float.
- **Done when** palms glow when backlit at golden hour, fronds sway and flutter, their shade sits soft on
  the sand, close-ups hold up, and nothing flickers: the shimmer score stays low and the user sees none in
  the running game.

### 9. Cove vegetation

- Banana (with torn leaves), monstera, hibiscus, frangipani, ferns, grasses, beach scrub, and vines
  creeping onto the sand. One file per species, each with its own wind response.
- Grass that shows gusts rolling across it, and dappled shade drifting over the sand.
- Cheap distant vegetation, so the hillsides look lush from the overview.
- Known from Stage 3: rocky shores (since 2026-10-25 only the headland and one cape) get a band of rock
  zone 20–45 m deep; what grows there decides how it looks. The green's bands vary with the land
  (Decisions, 2026-10-25): placement reads `band` and `lush`, not distances from the shore.
- Known from Stage 4: the ground says how lush it is and how sandy its soil (`heightmap.groundAt`:
  `lush`, `sandy`), which the green's look follows: dense jungle where lush, open grass where not,
  beach plants where sandy. Its patches of green and bare ground stay put and JS knows them
  (`world/green.js`, `ctx.terrain.greenAt`; the patches fixture checks the GPU against it), so grass
  can stand on the green only; near the camera their edges fray by a blade or two, which JS leaves
  out. Seen at a slant the bare patches take on the green, standing in for plants
  (`config.world.terrain.green.stand`); lower it where real plants stand.
- **Done when** the jungle-edge view is lush and layered, each species is recognisable by its shape and its
  motion, and the frame cost is within budget.

### 10. Clouds

- Golden hour and the cove gate need a sky with clouds, so they come before the polish pass.
- Drifting clouds lit by the sky model, with sunset-coloured undersides. Their shadows slide across the
  lagoon and the land, consistent with the sun shadows.
- Known from Stage 2: the transmittance table is private to the sky (`sky/atmosphere.js`), and the
  aerial-perspective table reaches 64 km.
- **Done when** clouds look soft and full from both the beach and the overview, and their shadows visibly
  move.

### 11. Cove polish (milestone gate)

- Art-direction pass: colour grade, bloom, haze, exposure and palette. Review every view at several times
  of day and fix everything on CLAUDE.md's list of things that break the spell. Known from Stage 1:
  saturated primaries show kinks where the tonemapping clamps (the tonecard's ramps); natural colours
  don't. Known from Stage 2: the sky beside a low sun clips red in the sunset telephoto, so the disk can't
  show as an orange orb; bloom needs the sun's energy, which the sky holds under a ceiling today, and the
  HDR target holds at most about 2048 (exposed). The sky's
  light on upward faces is up to 10% too strong in red at golden hour (nine SH coefficients can't hold
  the bright band along the horizon). On high-DPI screens the render targets take 0.5–0.7 GB at 4K and
  0.9–1.3 GB at 5120×2880, against a 256 MB limit. SwiftShader captures took about 0.5 s per frame on a
  fast desktop but 1.1–2.3 s in CI with only the placeholder world (Stage 1: 0.46–0.72 s in CI; the
  lighting now costs about 17% less); with the sand (Stage 4.3), 0.6–1.4 s on that desktop, and the
  budget went from 1 to 2 s with the user's leave; with rock (4.4), 0.6–2.1 s (the `rocks` close-up,
  where a pixel runs both surfaces' detail), and 2.5 s; with the green (4.6), 0.6–2.3 s; hardened (4.7:
  the green's patches in noise JS shares, far wet sand's sheen), 0.8–2.7 s. The GPU times
  the screenshot tool and the benchmark measure on the development laptop follow its GPU's clock, which
  idles low between frames: they swing several-fold between identical runs. Known from Stage 3: far terrain samples the
  8 m grid at coarser spacing without prefiltering, so ridgelines may crawl in motion; the headland's
  inner flank runs inland as a long steep wall; beyond the cove the island is a smooth shape in an even
  ring of lagoon.
- Performance pass on the `high` preset. Record what the cove costs per frame: Stage 1's counts, plus the
  benchmark on the machines the user can try, ideally including a mid-range laptop. That decides how much
  more island fits in the budget. Calibrate the limits in `config.js` against it, and tune `medium` and
  `low`.
- **Done when** the user agrees that every cove view clears the wallpaper bar at midday and at golden hour
  (as Stage 2 defines them). Later stages wait for that
  unless the user decides otherwise. Milestone 4 always waits, because it needs this stage's cost numbers.

---

## Milestone 2: Alive

### 12. Every hour of daylight

- Time doesn't pass, but the player can pick any hour from sunrise to sunset, so every one has to work, not
  only the midday and golden hour the cove gate checked. Lighting, exposure and fog stay consistent from
  one hour to the next. There is no night (see Decisions).
- Known from Stage 2: a time change reads the light back from the GPU and waits for it, so dragging the
  time (Stage 16's setting) would stutter.
- Known from Stage 3: the haze check's `aerial` answer stood at 5.6 of its 6-level limit from 190 m up at
  sunset (the check's camera, now `headland`), and was measured at 6.0 from the beach in the first and
  last minutes of daylight; near the sea, the transmittance table's rows lie 25 and 101 m up, in haze
  150 m thick. From the air it misses far more: 37 levels from the `overview`, 1 km up (2026-10-25).
- **Done when** a capture series from sunrise to sunset has no broken or ugly hour.

### 13. Small life and detail

- Signs of life: seabirds, butterflies, crabs, fish shadows in the shallows. Things lying about:
  coconuts, shells, driftwood, fallen flowers and leaves.
- Known from Stage 4: a strand line of wrack painted on the sand read as smears and footprints, without
  relief, and went; it needs things lying on the beach. The sand's own bits of shell are flat specks.
- **Done when** something moves in every view within a few seconds, and the foreground rewards a close
  look.

---

## Milestone 3: Being there

### 14. Walking

- `player/`: walking on the terrain; collision with trunks and rocks; wading into the shallows; a gentle
  head bob; smoothed look. It replaces Stage 3's rough walking; free-fly stays as a dev toggle. The player
  spawns at a beautiful spot. `?view=` and captures still put the camera exactly at the view.
- Basic swimming, as simple to build as possible (see Decisions): in deep enough water the player floats
  and moves slowly, and the view stays above the water. Something keeps the player from swimming out of
  the world.
- Movement and collision maths get tests. Automated runs stub pointer lock and never drive the real
  mouse.
- Known from Stage 2: the sky's tables render again whenever the camera's height crosses a whole metre, so
  a head bob around such a step would render them twice a stride.
- Known from Stage 3: the user found the rough walk's pace (1.4 m/s) a bit slow on the bare ground of
  Stage 3, perhaps for want of detail passing by. Judge the pace again on detailed ground.
- Update the README and the start screen's controls.
- **Done when** the movement tests pass; invariant tests over seeds show the player can't fall through the
  ground, get stuck or leave the world; and the user has walked and swum the cove and is happy with how it
  feels.

### 15. Sound

- `audio/`: procedural surf tied to the wave sets and to the distance from shore; wind in the leaves tied
  to the gusts; birds and insects that change with the time of day; footsteps that depend on the surface.
- It starts only after a user gesture, has a mute control and stays silent in capture mode.
- Scheduling sound needs the audio clock (`AudioContext.currentTime`), an exception to the rule that all
  time goes through `clock.js`. Decide how, and write it into CLAUDE.md.
- The AI can't hear, so it checks what can be measured: render a few seconds of each soundscape offline in
  the browser and check levels and peaks (no clipping, no silent layer, no runaway gain).
- **Done when** those checks pass, capture mode and the start screen are silent, and the user has listened
  at several spots and times of day and is happy with it.

### 16. Presentation

- A start screen in the game's own visual language. Boot progress if generation takes noticeable time.
  An in-game settings menu: quality, time of day (the only in-game way to change it) and sound. Optionally
  a photo mode with the UI hidden. Known from Stage 3: the terrain's detail ignores the field of view, so a
  zoomed-in photo magnifies far ground at its coarse detail.
- The game is desktop only (see Decisions). A phone or tablet gets a short note that it needs a desktop
  browser with keyboard and mouse, instead of a start screen that can't work.
- Capture mode hides all UI, so extend the screenshot tool's player-mode run to also save images of the
  start screen and the settings menu. That's the only way the AI sees them.
- **Done when** the start screen, the settings and the photo mode (if built) work in player mode without
  errors; an emulated phone gets the desktop-only note; changing quality, time or sound applies at once;
  no UI shows in capture mode; and the user is happy with the look.

---

## Milestone 4: The whole island

### 17. Beyond the cove (repeatable)

- How far the island grows depends on what Stage 11 measured and how much budget is left.
- Bring the other areas up to the cove's standard, one area per pass. Candidates: a windward rocky coast
  with heavier surf, a hilltop lookout, the jungle interior, a stream. Each area gets views, a polish pass
  and a performance check.
- Don't start a new area while an existing one still falls short of the bar.
- Known from 2026-10-25: the coast beyond the cove is beach with a coastal flat, and one rocky cape
  (Decisions); the views `headland`, `cape` and `coastal-flat` already look at it, and `summit` at the
  rough ground near the top up close, framed on seed 1, all four disabled for now (the user's call:
  `disabled` in `src/views.js`; `--views` still captures them).
- Known from 2026-10-25: the terrain's grids are laid out for each island, 2 m apart over the land and
  the shallows everywhere (Decisions), a multiple of 256 samples across so their mipmaps halve exactly
  (`config.world.terrain.mips`); growing the island (`config.world.island.size`) grows them, and boot's
  time with them.
- Known from 2026-10-25: the capes go where the coast juts out most, as measured 250 m inland; changing
  the land's shape inland can move them (the lobes' centres fixed that day moved them on 5 of seeds 1–20,
  by 38 m on seed 1). The coast's distance changes by up to about 1.7 m a metre near the shore (noise on
  it), so slopes set in it, like the hills' rise from a beach (`shore.steepest`), come out steeper in
  places.
- **Done when** (per area) the user agrees its views clear the bar and the frame cost stays within the
  limits.

---

## Milestone 5: Ship

### 18. Performance and robustness

- Profile against the target: 60 fps at 1080p on a mid-range laptop. Captures can't measure real GPU cost,
  so ask the user to run the benchmark on real machines. Also cover: choosing quality automatically or
  picking a safe default, boot time, memory, a lost GPU device, the browsers with WebGPU, high-DPI
  screens, and the size budget.
- Known from Stage 4b: a lost device (a driver reset, say) stops the game with the error overlay.
  Recovering means making every GPU resource again, as a quality change already does (`setQuality` in
  `main.js`), on a new device. Firefox has WebGPU on Windows only (141 and later); elsewhere it gets the
  note that the game needs WebGPU.
- Known from Stage 3: the heightmap's workers are untried outside Chromium; without them the grids
  build in the main thread, about 6 s on a fast desktop (2.6 million samples for seed 1, since
  2026-10-25), and with two cores there is one worker.
  Boot waits on the surfaces' tiles (`textures/`, made and read back on the GPU), not on the grids, which
  are in a second or two before them: making the tiles faster is the lever for boot.
  The terrain's fragment shader is most of a SwiftShader frame, its aerial perspective and its filtered
  slopes the largest parts.
- The tools install only Chromium's headless shell. Automated Firefox runs need Playwright's Firefox
  build, a browser download rather than a new npm package; ask the user before adding it. Playwright can
  drive an installed Edge too.
- **Done when** the user has run the game on real machines, including a mid-range laptop; the `high`
  preset holds the target there (CLAUDE.md §10); and the game runs without errors in every browser the
  README names.

### 19. Final pass

- Review every view at several times of day and fix whatever breaks the spell. Bring the README,
  CLAUDE.md and this plan up to date.
- **Done when** the user signs off the release.

---

## Decisions

Made with the user. Don't reopen them unless the user does.

- **Time of day doesn't pass.** It stays where it's set, and the player sets it in the settings menu.
  (2026-10-20)
- **Island size depends on performance.** The user expects the game to be heavy. Build the cove first,
  measure it (Stage 11), then grow the island only as far as the budget allows. (2026-10-20)
- **Daylight only.** Time of day spans sunrise to sunset. Night isn't part of the game. (2026-10-20)
- **The cove faces the sunset.** Looking out to sea from the beach, the sun sets straight ahead.
  (2026-10-20)
- **Swimming is basic and simple to build:** at the surface only, with the view above the water. No
  diving. (2026-10-20)
- **Desktop only:** a desktop browser with keyboard and mouse. (2026-10-20)
- **Raw WebGPU with hand-written WGSL, and a renderer of the project's own** (Stage 4b). It replaces
  WebGL2 with GLSL through three's `WebGLRenderer` (2026-10-20). (2026-10-24)
- **No runtime dependencies** (Stage 4c): three goes too, and the maths the game took from it becomes
  modules of the project's own. It replaces "three for maths only" (2026-10-24), which left the choice
  until after the port. (2026-10-24)
- **WebGPU only**, with no WebGL fallback. A browser without WebGPU gets a short note that the game needs
  it. (2026-10-24)
- **MSAA is 4 samples on every preset.** WebGPU allows only 1 or 4, and the frame needs at least 2.
  (2026-10-24)
- **Reversed 32-bit float depth everywhere.** The Firefox depth fallback goes. (2026-10-24)
- **The seed changes the island; the game has one seed for now.** Every seed makes a different island, but
  the game only uses one, and the views and art direction are tuned on it. (2026-10-20)
- **The user directs the work and reviews most stages.** A finished stage goes to `review`; only the user
  marks it `done`. (2026-10-20)
- **The look starts from the neutral tonemapping curve** (Khronos PBR Neutral): authored colours stay as
  they are, so the travel-poster palette is set in the materials and the grade, not by the curve.
  (2026-10-20)
- **The air has haze.** A humid haze near the sea gives distant land depth and sunsets their red, at the
  cost of a slightly paler midday sky; a world without it was the alternative. (2026-10-21)
- **The noon sun stands 63° high**, to the right of a viewer facing the sunset, so midday keeps direction
  and shadows; a near-overhead tropical noon was the alternative. (2026-10-21)
- **The named sunrise and sunset stand the sun 1° up**, so the land still catches it; daylight goes on
  until the sun's centre meets the sea. 0° (land unlit) and 2° were the alternatives. (2026-10-22)
- **The exposure follows the light with a compensation of 0.3**: a low sun stays darker and keeps its
  deep orange, and noon is as before; 0.5 washed the sunset out to pale pink. (2026-10-22)
- **Steep green volcanic ridges behind the cove**, peaking around 250–300 m close behind the beach;
  gentle hills of about 120 m and a 500 m spire were the alternatives. (2026-10-22)
- **The reef lies 200–300 m out**, so the surf line reads from the beach and the lagoon is a swim; a
  barrier reef 600 m to 1 km out with a broad lagoon was the alternative. (2026-10-22)
- **The headland stands on the left** of someone on the beach facing the sea: its inner cliffs catch the
  noon sun and the low evening light; on the right it would stand dark beside the sunset. (2026-10-22)
- **Beaches all round, rock in two places**: the coast is beach but for the headland's high cliff,
  which stays, and one rocky cape beyond the cove where the coast juts out furthest, a black wall of
  8–16 m with green slopes above. Behind the beaches a berm rises to where the green begins (about
  2 m up) and a coastal flat of changing width (0–160 m) stands a few metres above the sea before the
  hills. The bands behind the sand vary as in nature rather than as rings: the beach 10–45 m wide,
  wider in bays; a thin strand of scrub, wider on points; the palm belt over the flats and up valley
  floors, ending where the hills rise, so the jungle starts 35–170 m from the water. Rock on a rocky
  shore lies where nature leaves it bare: on cliffs, where the waves and spray reach, and fallen at a
  sheer cliff's foot; green comes down to a cliff's edge. The headland's face to the bay and its tip
  stay sheer; its outer shore changes from sheer walls to green slopes above a rocky foot. The flats
  are old beach ridges (about 1.3 m) and hummocks, and the hills are cut by gullies running straight
  down their slopes, over the folds they had. A second cape is one setting (`shore.capes.count`). It
  replaces "more beaches beyond the cove, in its bays" (2026-10-23), which left 70% of the coast rocky
  cliff. (2026-10-25)
- **The terrain's heights lie 2 m apart over all the land and the sea you can see into** (above −20 m:
  the lagoon, the reef and its drop-off), the cove no different from the rest, and 8 m apart out to the
  deep: relief of 8 m and more shows anywhere on the island. It replaces grids of 1 m over the bay, 2 m
  up to the summit, and 4 and 8 m beyond, which smoothed most of the island. 2 m over the deep sea too
  (a third more samples nobody sees) and 1 m everywhere (about 15 s to build on one core) were the
  alternatives; finer relief than 8 m waits on whether it is still missed. (2026-10-25)
- **The reef is roughened a bit**: its crest wanders about 8 m either way over about 110 m, and its
  width with it; the pass widens towards the sea between ragged walls. A less circular bay, a blunter
  headland tip and leaving it regular were the alternatives. (2026-10-23)
- **Bright white sand**, albedo 0.65, at the top of what white coral sand measures: cream-white at
  midday. Measured coral sand at 0.55 (grey-beige), golden quartz sand at 0.40 and the old plain colour
  at 0.72 were the alternatives. (2026-10-23)
- **Dark basalt**, albedo about 0.05: near-black volcanic rock, as the volcano would make, in lava-flow
  layers, with the beach's white sand gathered in its hollows. It gives the strongest contrast with the
  sand and the lagoon, and the volcano's steep patches read as dark crags rather than pale blotches; the
  rocks of 4.5 break into angular blocks. Weathered and lichened grey-brown rock (0.18), pale coral
  limestone (0.4) and pinkish granite (0.3) were the alternatives. (2026-10-23)
- **Lush tropical green inland**: saturated greens with little bare ground, grass on open ground and the
  dark leafy understory in hollows and gullies, so the hills show dark gullies under lighter ridges. A
  lighter, yellower sunny meadow, a sun-dried ground of olive and straw with more soil and litter, and a
  darker deep jungle were the alternatives. (2026-10-24)
- **The air stays as clear as it is**: the light from below lifts shade on the beach, and more aerosol
  barely changes midday (the sky's share of the light on level ground goes from 9% to 13% at ten times
  as much) while it spreads a large halo round the low sun. Four and ten times as much were the
  alternatives. (2026-10-23)
- **The hilltops' last light is as the atmosphere gives it**: at the named sunset the sun on the summit
  is 1.6 times the beach's, and lit hilltops over a dark shore show only in the last minutes before the
  sun touches the sea. Thicker evening haze (a greyer horizon) and a named sunset 0.5° up were the
  alternatives. (2026-10-22)

## Open questions

Settle these when the stage that needs them arrives. Ask the user where the answer is a matter of taste or
scope.

- **Low-sun sky, for Stage 11 or 12.** From an outside review: at golden hour the sky away from the sun is
  slate with an olive band; at low sun a dark line runs along the horizon above the brighter placeholder
  sea; the horizon is 3.7–5 times brighter than the zenith (the haze scatters evenly, g 0.2; sea air is
  nearer 0.7); the haze thins towards sunset, where real evening haze thickens; sunrise mirrors sunset.

## Ideas parking lot

Not part of the plan. Build one only if the user asks for it: a passing rain shower, tides, traces of people
(a hammock, an outrigger canoe).

## Log

Newest first. One short entry per session, only a few lines: date, stage, what changed, what is still
open, next step. Details belong in code comments.

- **2026-10-25, a bug review of the terrain generation, all fixed at the user's request** (with two
  helper agents): no jumps at the lobes' centres; no 7.5 m bulges where a ridge's segments meet (the
  summit 288 m, not 292); gullies fan round ridge ends; far mipmaps line up (grids a multiple of 256,
  checked on the GPU); flats less rough; beach ridges parallel; no cliffs behind beaches (`shore.steepest`)
  and the capes' `hillReach` has its say; robustness fixes in the worker pool and grids. `jungle-edge`,
  `coastal-flat` and `summit` lowered to their eye heights. Open: the capes moved on 5 of 20 seeds (Stage 17).

- **2026-10-25, the coast and the land's relief, at the user's request** (Decisions): beach all round but
  for the headland and one cape with a cliff, coastal flats with old beach ridges, zone bands that vary
  with the land; then one 2 m grid over all the land and the shallows (boot 2.6 → 5 s on one core), the
  ground rough as land is (steep slopes rough, flats and valley floors gentler, in patches), drawn
  without edges, rock where the land under it is steep; each with a test. New views `headland`, `cape`,
  `coastal-flat`, `summit`, disabled for now; `overview` from 1 km up. Capture `even-verify`. Open: one
  cape or two; relief under 8 m (plants, Stages 8–9); the scrub's sand blobs (4.8). Next: 4.8 or Stage 5.

- **2026-10-25, an optimization review of the port, checked and acted on** (with two helper agents). CI
  was red on `74dbabc` (player mode's canvas shot timed out under SwiftShader load): fixed, proven on two
  CPUs. Uniforms packed by writers made once, shared by the terrain's variants (frame JS about halved);
  terrain under the placeholder water culled, variants picked per 8 m tile; a frame stores nothing no
  later pass reads; boot overlaps compiles and placement with the tiles. SwiftShader: frames 9–33% and
  boots ~1 s faster, `verify`'s capture 664 → 346 s, every view byte-identical. Deferred to Stage 5's
  notes: one encoder a frame, group 0's split, the aerial table in compute. Next: 4.8 or Stage 5.

- **2026-10-24, Stage 4c planned and built: no runtime dependencies.** The user decided three goes
  (Decisions). Its maths is now `src/maths/`, ported in three's order of operations and held to three's
  answers to the last bit. Every capture and measurement is byte-identical to `maths-before` on SwiftShader
  and on the GPU, it runs as fast, and the build is 83 KB smaller. Player mode no longer races a slow boot.
  Open: the user's review, CI on a push. Next: 4.8, or Stage 5.
- **2026-10-24, Stage 4b planned in detail and built (W.1–W.5), on branch `webgpu`:** raw WebGPU with
  a renderer of the project's own (`src/gpu/`), every shader in WGSL, three for maths only (linted).
  Views and named times match `webgl-final` within float noise, every check passes and catches its bad
  case. On SwiftShader frames take as long as WebGL's; on the user's GTX 1660 Ti, about a fifth less
  GPU time, once the GPU timer stopped counting waits between passes. Two rounds of outside reviews
  found no shader port error; their findings are fixed or listed as known flaws. Open: the user's
  hand-over (the four browsers, merge). Next: 4.8.
- **2026-10-24, Stage 4b planned: the WebGPU port.** The user moved the game to raw WebGPU and WGSL
  (Decisions); the port runs on a branch before 4.8. W.0 done: CI green on `adee91b`, baseline
  `webgl-final` captured there. Probed headless Chromium 156: on Windows WebGPU gets the real GPU only
  without DXC, and has no SwiftShader adapter; in a Linux container it does. Next: W.1 on a branch.

- **2026-10-23–24, Stage 4 planned, built (4.1–4.6), reviewed and hardened (4.7):** one ground
  (`island.groundOf`) shared by the GPU and placement; measured albedos and light from below; the user
  picked bright white sand, the clear air, dark basalt and a lush tropical green (Decisions). Sand,
  rock, rocks and the green inland, each near and far; SwiftShader runs untaken branches, so the
  terrain draws nodes with only the surfaces they hold. An outside review sent the stage back: `verify`
  timed out in CI (the benchmark waited a fixed minute; it now fails only when a page stops drawing),
  and it found bugs that moved with the camera and traps for Stages 5–9, fixed in 4.7 (with two helper
  agents: rocks; slopes and the albedo checks). Capture `h47-verify`; SwiftShader 0.8–2.7 s a frame
  (`rocks` over its 2.5 s), 5–25% more than before. Next: 4.8, the look again, the user's picks.
- **2026-10-23, Stage 3: an outside review.** Fixed steps in the seabed (the channel's bends, the reef's
  crest) and a 1.2 cm one at every sandy waterline, now caught by a test for steps; far terrain finer
  (each level reaches 2.5 times as far as the last: the far cliffs lose their sawtooth); quarters culled;
  a 0.7 s stall at boot; a benchmark that measured before the island was in. Cost on `high`: 120–455k
  triangles, SwiftShader 0.5–1.04 s a frame. The user had the reef roughened a bit and asked for more
  beaches beyond the cove: they lie in its bays now (Decisions; building the grids costs 18% more).
  Open: the far mesh's own height (Stages 5, 8). Next: Stage 4.
- **2026-10-22, Stage 3 done** (commit `70cc348`, the maths check in `fb92551`). The island's shape
  (`world/island.js`, `npm run map`), terrain from nested grids with a morphing level-of-detail mesh,
  sunlight by height, and the final views with agreed briefs (new: `into-the-sun`, `sand`). The user
  walked the cove and made the taste calls (Decisions). A five-part review fixed cracks between detail levels on `low` and `medium` and stale
  culling, and tightened the checks. Open items went to Stages 4–9, 11, 12, 14, 17 and 18. A check of the
  maths after it replaced the coral heads' weak hash (now tested with the noise, `tests/noise.test.js`).
- **2026-10-22, Stage 2: a third review.** Light from below comes from the ground's albedo (the far sea's
  until Stage 4); the SH read is unrolled (17% off a SwiftShader frame). The user picked the named sunrise
  and sunset 1° up and an exposure compensation of 0.3 (Decisions). Open: the air's clarity and the
  low-sun sky (Open questions).
- **2026-10-22, Stage 2 hardened again** after a second outside review, checked against a double-precision
  port of the sky: the haze, its colour and the marches fixed; new checks: the `haze` fixture, the time
  check on every view, views that face the sunset. Notes went to Stages 3, 5, 6, 8, 11 and 12.
- **2026-10-21, Stage 2 hardened** after an outside code review: blending, the sunset horizon's seam and
  smaller fixes; new checks for the after-opaque pass, translucent depth, the GPU's sky maths and the
  light's colour. Time keys are now `,` and `.`.
- **2026-10-21, Stage 2 done** (commit `b43cc9c`; hardened in `aa920bf`). The user approved it and kept the
  defaults: haze, its level, and a 63° noon sun (Decisions). Next: Stage 3.
- **2026-10-21, Stage 2 built.** `sky/` owns the time (named times, no night) and a sky after Hillaire 2020
  with a marine haze; one lighting model and an exposure that follows the light; frame passes for
  after-opaque, linear translucent layers and a post chain. Open items went to Stages 6 and 11.
- **2026-10-21, Stage 2 planned:** sub-steps 2.1–2.4 (time of day, frame structure, sky, light and haze).
- **2026-10-21, Stage 1 hardened** after an outside review: captures about twice as fast, and they fail on
  hidden shader errors, WebGL errors and a lost context. Open items went to Stages 2, 5, 7, 8, 11, 15 and 18.
- **2026-10-20, Stage 1 done.** HDR frame in `post/`, capture measurements and tool checks, F3 readout,
  `?bench=1`; first benchmark 2.8–4.7 ms GPU per frame on one discrete GPU. Open items went to Stages 2, 8,
  11 and 18.
- **2026-10-20, plan.** Wrote this plan. Next: Stage 1.
