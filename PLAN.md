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
  captures must stay fast enough on SwiftShader to take in every session.
- **Motion is part of the look.** If a thing looks right frozen but moves wrong, it isn't done. A single
  frame can't show motion: the AI judges it from motion strips and shimmer scores (Stage 1), and the user
  judges it in the running game.

## Status

| # | Stage | Milestone | Status |
|---|---|---|---|
| 1 | HDR frame and measurement | The cove | done |
| 2 | Sky, sun and atmosphere | The cove | todo |
| 3 | Island shape | The cove | todo |
| 4 | Ground surfaces and rocks | The cove | todo |
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
  every material reads, and this stage decides how Stage 5's shadows will plug in.
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
- **Done when** the placeholder mound is gone, the overview's landforms read as a tropical island, the views
  frame the cove, each with a brief the user agreed, and the user has checked the cove's scale on foot.

### 4. Ground surfaces and rocks

- Procedural texture generators in `textures/`. Surfaces: sand (dry, damp, wet, with ripples and fine
  grain near the camera), soil, grass base and rock. Blends follow height, slope and zone. No visible
  tiling.
- Procedurally shaped rocks and boulders, including the headland.
- **Done when** a close-up of sand holds up, no tiling shows from any view, and nothing looks plastic.

### 5. Shadows

- Sun shadows across the whole depth range: soft penumbrae, stable when the camera moves (no shimmering),
  long and soft at low sun. Objects sit on the ground instead of floating.
- Shadow quality scales with the quality presets.
- Plant shadows come with the plants in Stage 8. Build the shadow system so leaves can later cast
  leaf-shaped shadows.
- **Done when** low-sun captures show long, soft shadows from the rocks and terrain, with no acne, no
  detached shadows and no hard edges, and the camera-offset captures show no shimmer.

### 6. Ocean

- `water/`: waves (swell plus chop); sky reflection; a sun-glitter path; colour from depth, from clear
  turquoise shallows to deep blue; the seabed visible through the shallows; a far sea that doesn't sparkle
  or alias; a seamless fade into the horizon haze; the white line of surf on the reef.
- Walking, swimming and sound will need the water's motion in JS as well, and it must agree with what's
  drawn (CLAUDE.md §5).
- **Done when** the placeholder water is gone and the lagoon reads as tropical at every time of day.

### 7. Shoreline (the hero)

- Waves run up the beach and slide back. Foam lines, plus foam that lingers. Wet sand that is darker and
  mirror-like, and dries slowly after each wave. Caustics dancing on the shallow seabed. A small shore
  break.
- Expect several sessions. Split this stage into sub-steps.
- **Done when** the low beach view is a wallpaper, its motion strip shows waves running up and draining
  back naturally, and the user finds the motion natural in the running game.

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
  miss something.
- **Done when** palms glow when backlit at golden hour, fronds sway and flutter, their shade sits soft on
  the sand, close-ups hold up, and nothing flickers: the shimmer score stays low and the user sees none in
  the running game.

### 9. Cove vegetation

- Banana (with torn leaves), monstera, hibiscus, frangipani, ferns, grasses, beach scrub, and vines
  creeping onto the sand. One file per species, each with its own wind response.
- Grass that shows gusts rolling across it, and dappled shade drifting over the sand.
- Cheap distant vegetation, so the hillsides look lush from the overview.
- **Done when** the jungle-edge view is lush and layered, each species is recognisable by its shape and its
  motion, and the frame cost is within budget.

### 10. Clouds

- Golden hour and the cove gate need a sky with clouds, so they come before the polish pass.
- Drifting clouds lit by the sky model, with sunset-coloured undersides. Their shadows slide across the
  lagoon and the land, consistent with the sun shadows.
- **Done when** clouds look soft and full from both the beach and the overview, and their shadows visibly
  move.

### 11. Cove polish (milestone gate)

- Art-direction pass: colour grade, bloom, haze, exposure and palette. Review every view at several times
  of day and fix everything on CLAUDE.md's list of things that break the spell.
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
- **Done when** a capture series from sunrise to sunset has no broken or ugly hour.

### 13. Small life and detail

- Signs of life: seabirds, butterflies, crabs, fish shadows in the shallows. Things lying about:
  coconuts, shells, driftwood, fallen flowers and leaves.
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
- Update the README and the start screen's controls.
- **Done when** the movement tests pass; invariant tests over seeds show the player can't fall through the
  ground, get stuck or leave the world; and the user has walked and swum the cove and is happy with how it
  feels.

### 15. Sound

- `audio/`: procedural surf tied to the wave sets and to the distance from shore; wind in the leaves tied
  to the gusts; birds and insects that change with the time of day; footsteps that depend on the surface.
- It starts only after a user gesture, has a mute control and stays silent in capture mode.
- The AI can't hear, so it checks what can be measured: render a few seconds of each soundscape offline in
  the browser and check levels and peaks (no clipping, no silent layer, no runaway gain).
- **Done when** those checks pass, capture mode and the start screen are silent, and the user has listened
  at several spots and times of day and is happy with it.

### 16. Presentation

- A start screen in the game's own visual language. Boot progress if generation takes noticeable time.
  An in-game settings menu: quality, time of day (the only in-game way to change it) and sound. Optionally
  a photo mode with the UI hidden.
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
- **Done when** (per area) the user agrees its views clear the bar and the frame cost stays within the
  limits.

---

## Milestone 5: Ship

### 18. Performance and robustness

- Profile against the target: 60 fps at 1080p on a mid-range laptop. Captures can't measure real GPU cost,
  so ask the user to run the benchmark on real machines. Also cover: choosing quality automatically or
  picking a safe default, boot time, memory, WebGL context loss, Chrome, Edge and Firefox, high-DPI
  screens, and the size budget.
- The tools install only Chromium's headless shell. Automated Firefox runs need Playwright's Firefox
  build, a browser download rather than a new npm package; ask the user before adding it. Playwright can
  drive an installed Edge too.
- **Done when** the user has run the game on real machines, including a mid-range laptop; the `high`
  preset holds the target there (CLAUDE.md §10); and the game runs in Chrome, Edge and Firefox without
  errors.

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
- **WebGL2 with GLSL shaders**, through three's `WebGLRenderer`, not WebGPU. (2026-10-20)
- **The seed changes the island; the game has one seed for now.** Every seed makes a different island, but
  the game only uses one, and the views and art direction are tuned on it. (2026-10-20)
- **The user directs the work and reviews most stages.** A finished stage goes to `review`; only the user
  marks it `done`. (2026-10-20)
- **The look starts from the neutral tonemapping curve** (Khronos PBR Neutral): authored colours stay as
  they are, so the travel-poster palette is set in the materials and the grade, not by the curve.
  (2026-10-20)

## Open questions

Settle these when the stage that needs them arrives. Ask the user where the answer is a matter of taste or
scope.

## Ideas parking lot

Not part of the plan. Build one only if the user asks for it: a passing rain shower, tides, traces of people
(a hammock, an outrigger canoe).

## Log

Newest first. One short entry per session, only a few lines: date, stage, what changed, what is still
open, next step. Details belong in code comments.

- **2026-10-20, Stage 1 done.** HDR frame in `post/` (neutral tonemap, 4x MSAA, reversed float depth),
  capture measurements and tool checks, teardown check, F3 readout, `?bench=1`. First benchmark (one
  discrete GPU): 2.8–4.7 ms GPU per frame. Open: no bloom, guessed limits, high-DPI `high` over the
  render-target limit (Stage 11); thin geometry crawls, no alpha-to-coverage fixture (Stage 8); placeholder
  sky draws first (Stage 2); z-fighting without EXT_clip_control (Stage 18). Next: Stage 2.
- **2026-10-20, plan.** Wrote this plan. Next: Stage 1.
