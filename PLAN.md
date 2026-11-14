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
why in the stage's notes.

Keep the notes short. A finished stage keeps a few lines on what it built and a list of what is still open;
what got fixed, and how, goes: git has the history, and module headers say how things work. What a later
stage needs goes in that stage's notes, once.

## How to work a stage

1. Read CLAUDE.md, then the Status table and the notes of the stage you are about to take.
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
   CLAUDE.md's list of things that break the spell: the stills, the motion strips, zoomed crops and
   banding views. List everything that still falls short, including what got worse. A subagent that hasn't
   seen the code makes a good second pair of eyes.
8. Hand over: set the stage to `review` and give the user the capture label, the compare sheet, the frame
   cost and the list of known flaws. Make sure the user can open the images, even when the session ran in
   a cloud container. Name what needs the user's eyes or ears: motion in the running game, sound, feel,
   real hardware. The stage becomes `done` when the user says so.
9. Update this file: status, ticked sub-steps and the stage's notes (the flaws still open). Commit and
   push only when the user asks. Pushing to `main` publishes the game.

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
- **Budget as you go.** Every capture reports each view's frame cost against limits in `config.js`. Note
  each stage's cost in its notes and put its knobs in the quality presets. GPU time on the machine a
  session runs on says little about a mid-range laptop, so the counts and their limits are the guide, plus
  the benchmark results the user brings back from real machines. The limits are guesses until Stage 11
  calibrates them, so ask the user to run the benchmark after each stage that adds a lot of cost (water,
  plants), not only at Stages 11 and 18. Don't leave performance to the end.
- **Works on any machine.** A session may run anywhere, including a cloud container with no GPU, where
  SwiftShader is the only renderer. Nothing in the workflow may depend on one machine's hardware, and
  captures must stay fast enough on SwiftShader to take in every session. SwiftShader runs every line of
  a shader at every pixel, branches or not (measured in Stage 4.3): code a pixel skips still costs it
  there, so heavy code that only some pixels need goes in a shader variant of its own.
- **Motion is part of the look.** If a thing looks right frozen but moves wrong, it isn't done. A single
  frame can't show motion: the AI judges it from motion strips and shimmer scores, and the user judges it
  in the running game.

## Status

| # | Stage | Milestone | Status |
|---|---|---|---|
| 1 | HDR frame and measurement | The cove | done |
| 2 | Sky, sun and atmosphere | The cove | done |
| 3 | Island shape | The cove | done |
| 4 | Ground surfaces and rocks | The cove | done |
| 4b | WebGPU port | The cove | done |
| 4c | Maths of our own | The cove | done |
| 5 | Shadows | The cove | done |
| 6 | Ocean | The cove | done |
| 7 | Shoreline | The cove | in progress |
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

Captures are deterministic, so checking out the commit that approved a stage (find it with `git log`; a
git worktree works) and capturing with the same args and backend recreates the approved images. To compare
them with a new capture, both sides need the same Chromium build (CLAUDE.md §4).

---

## Milestone 1: The cove

Goal: one cove (beach, lagoon, reef, palms, jungle edge) that works as a wallpaper from every one of its
views, at midday and at golden hour.

### 1. HDR frame and measurement

Done. The scene renders into an HDR target, and post owns tonemapping, exposure, dithering and the output
colour space (CLAUDE.md §8). The screenshot tool measures what stills hide: motion strips, shimmer as the
camera turns (and, since 5.1, moves), zoomed crops, banding views, cost counts against limits per preset,
and each capture's time against a budget, each proven on a fixture built to fail it. A teardown check fails
on leaked GPU resources. The readout (F3) and the benchmark (`?bench=1`) work in the built game, and the
player-mode run exercises them. Sub-steps: 1.1 capture groundwork, 1.2 detail and motion, 1.3 cost, 1.4
HDR frame, 1.5 teardown, 1.6 readout and benchmark.

### 2. Sky, sun and atmosphere

Done. `sky/` owns the time of day: daylight only, with the named times (sunrise, midday, golden hour,
sunset) defined in one place and the sun setting straight ahead of the beach (Decisions). The time changes
only when it is set: by `?time=`, a view, the `,` and `.` keys (in every build since 2026-11-12) and, from
Stage 16, the settings menu. A check proves that a time changed at runtime renders as the same time set at
boot; every system that depends on the time stays under it. The frame has the opaque scene's colour and
depth for what draws after it, translucent layers blended in linear light, and a chain of post effects. A
physical sky with a sun disk, and one shared lighting model (sunlight, sky ambient, aerial perspective) fed
from one light state: neutral objects read neutral at midday and warm at golden hour, and far land and sea
dissolve into the horizon haze. Sub-steps: 2.1 time of day, 2.2 frame structure, 2.3 sky, 2.4 light and
haze.

### 3. Island shape

Done. `world/island.js` holds the height function and the placement zones, pure and tested over seeds
1–20. The cove is art-directed: a crescent beach facing the sunset, a lagoon, a reef 200–300 m out with a
pass, the headland on the left and steep green ridges behind (Decisions); the rest of the island is
coarser. The seabed is designed with the land. The island's size is one setting, and `npm run map` shows
the layout. The terrain draws the heightmap on the GPU, and sunlight depends on height, so hilltops catch
the last light. Every view has a brief the user agreed. Rough walking (G) puts the camera at eye height.
Sub-steps: 3.1 layout, 3.2 terrain, 3.3 light by height, 3.4 views and briefs.

### 4. Ground surfaces and rocks

Done. What the ground is at each point (its zone, how sandy, rocky and lush) is worked out once: the GPU
draws it and JS placement reads the same answer. Albedos come from measured values, and shade takes its
light from below from the ground around it. Sand runs from dry to a film of water through one wetness input
(`chunks/wet.wgsl`), for Stage 7 to drive. The rock is basalt. About 700 procedural rocks stand round the
cove (`world/rocks.js`, `config.world.rocks.reach`), sunk into the mesh as drawn, placed by rules Stages 8–9
reuse. The green inland is soil, grass base and leaf litter in patches JS knows (`world/green.js`). Nothing
on the ground changes with where the camera stands. The look is the user's picks (Decisions). Sub-steps:
4.1 one ground, 4.2 albedos and the light from below, 4.3 sand, 4.4 rock surfaces, 4.5 rocks and boulders,
4.6 soil and grass base, 4.7 harden, 4.8 the look.

Known flaws:
- Sand: the ripples keep one wavelength and direction, and the backwash's rumples one scale; no grain shows
  at standing height; from 20 to 120 m the beach shows only drifts and streaks; the wet band reads as a thin
  tan outline from afar; at golden hour the beach's sheen is a flat smear cut at the wet/dry line, and at
  16:30 the sand reads khaki rather than golden (Stage 11's grade may answer it); `into-the-sun`'s
  foreground lost its ripples to the smooth face the high tide washed; a pale stripe of sand at the rocks'
  feet.
- Rock: the shelf in `rocks` reads as smooth mats with rounded outlines; the crack net has one scale;
  cliffs keep the heightmap's smooth outline, draped rather than jointed from a few hundred metres; rocks up
  close are faceted and fairly regular; outcrops on the green slopes read as near-black blots.
- Green: bare soil reads as brick-red ovals in the middle distance, orange at golden hour; the scrub ends in
  a carpet's edge with a soft rim (plants, Stages 8–9); the stands' lighter side reads lime at 9.5 h; the
  green is painted flat, a dense lawn at standing height, its grass tile stylised close up and its leaves
  all of one outline.
- The near/far check's albedo limit is absolute, so it misses a small change between green and bare.

### 4b. WebGPU port

Done. The game moved from three.js's WebGL renderer to raw WebGPU, with hand-written WGSL and a renderer of
the project's own (`src/gpu/`), and nothing changed visibly: every view matched the last WebGL build within
a few levels, and every check still caught its bad case. The conventions it settled are in CLAUDE.md §8,
and the choices in Decisions. On the user's desktop GPU it was at least as fast as WebGL on every view.
The GPU timer sums the passes' own durations (`core/gpu-stats.js`): a span from the first pass to the last
counted the GPU waiting on the CPU.

Known gaps: behaviours of three's renderer that nothing uses yet are missing, and `gpu/material.js` says
so where they bite. A change of render state needs `needsUpdate`; double-sided transparent meshes draw in
one pass; a mirroring transform doesn't flip the front face; alpha-to-coverage needs a target with
samples; a destroyed texture keeps its cached bind groups. A drawing buffer past the device's limit
(8192 px) fails instead of shrinking (Stage 18).

### 4c. Maths of our own

Done. three.js is gone: `src/maths/` holds the vectors, matrices, rotations, colours, culling shapes and
half floats the game uses, and every capture stayed byte-identical. `tests/maths.test.js` holds them to
three r186's answers to the last bit, recorded as hashes (`tests/fixtures/maths/three-answers.json`); to
find the number that differs, install three for the moment (`npm i --no-save three@0.186.1`) and run with
`THREE_MATHS=compare`. The answers hold while the engine's `sin`, `cos`, `tan`, `asin` and `atan2` stay
V8's. The build fails on any module from outside `src/`, and the lint names the file and line.

The maths does only what the game uses and refuses the rest: `Color` takes no CSS names or `rgb(…)`, and
`Euler` only the orders XYZ and YXZ. A stage that needs more adds it, with tests.

### 5. Shadows

Done. Two kinds of shadow, multiplied in `sunVisibility()` (`chunks/shadows.wgsl`):
- The island's own shade (`world/shade.js`): per time of day, over the whole island, how much of the sun's
  disk each point sees over its horizon, worked out in workers and landing with the sky's light
  (Decisions). Under a wide shade the light from below dims, and shade turns cool at golden hour. JS knows
  it, and the GPU agrees.
- Shadow maps round the camera (`sky/cascades.js`: 4, 3 and 2 cascades out to 100, 80 and 50 m on high,
  medium and low) of what stands on the ground (rocks; the terrain casts none): sharp at a caster's foot,
  softer away from it, twice as soft as the sun's disk makes them (Decisions). The ground reads them only
  where a caster's shadow can fall (`ctx.shadows.from`, `sky/shadow-reach.js`).

The test scene `?fixture=shadows` holds both to JS. Sub-steps: 5.1 room and a camera that moves, 5.2
shadows in a test scene, 5.3 the island's own shade, 5.4 rocks in the sun, 5.5 the look.

- 5.1: what a SwiftShader frame costs, switching one thing off at a time: the green 23–28% where it fills
  the frame (its near detail 12–15%), rock's relief up to 31% (`rocks`), the shadow maps 17–19%, sand's
  detail up to 10%. The user raised the capture budget instead (Decisions); a pass over the terrain
  shader's cost waits, and would help real GPUs too.

Known flaws:
- The maps soften no further than about 27 cm each way (reached about 30 m from a caster), and no sharper
  than the finest map's texels where a point lies (on high 2 cm at 5–16 m from the camera, 6 cm at
  16–45 m). Gaps a few texels across dim sooner than the sun's disk would leave them.
- A long edge under a low sun shows a soft sawtooth (`rock-shade`, the big rock's shadow's far end): the
  map's texels, stretched along the sun's way. Wider filters shrink it only at a cost growing with the
  square of their width, and turning the maps' frame didn't help. It would take maps filtered before they
  are read (moments) or smoothing over frames.
- The island's shade is 2 m apart (4 m on low), so near the camera its edges blur over a texel or two. What
  stands above the ground reads it at its height and misses the outer half of a far ridge's soft edge.
- Rocks past the maps' reach cast nothing, and the terrain past sand's detail (120 m) doesn't read the maps.
- Shade on dark ground is near black at golden hour (basalt in `rock-shade`, shaded grass from above): the
  light is physical, so how much to lift it is the grade's (Stage 11) or the hours' (Stage 12).
- The sand drifted against a rock's foot reads as a pale collar at midday. In `morning-shade` the hills'
  shade edge smears into streaks at the waterline (2 m samples at a grazing angle), and the lit sand reads
  cool for a brief that says the first light warms it.

### 6. Ocean

Goal: waves (swell plus chop); sky reflection; a sun-glitter path; colour from depth, from clear turquoise
shallows to deep blue; the seabed visible through the shallows, with surfaces of its own; a far sea that
doesn't sparkle or alias; a seamless fade into the horizon haze; the white line of surf on the reef. The
water's motion is known in JS too, agreeing with what's drawn, for walking, swimming and sound. **Done
when** the placeholder water is gone and the lagoon reads as tropical at every time of day.

- [x] **6.1 Clear water.** Light dims and takes on colour along its way through the water, so the lagoon,
  the channel, the pass, the bommies and the drop-off read by their depth. The light from below over water
  follows the depth.
- [x] **6.2 What the sea knows of the island** (`water/sea-map.js`): depth, the shore's distance in metres on
  the drawn ground and the way inland, the reef's crest, how much swell and chop reach each point, and when
  the surf arrives. Ready before a capture starts, kept across quality changes, shown on the map. The GPU
  and JS both read it.
- [x] **6.3 Waves.** Swell, chop and ripples, each scaled by what reaches a point, with gusts. JS knows the
  surface (`ctx.water.heightAt`, `over`) to within 0.25 m of the GPU; rough walking floats on it.
- [x] **6.4 The mirror.** The sky as seen from the sea, with the sun's glow. A glitter path of glints that
  melt into a band with distance. The far sea keeps the near sea's average light and fades into the sky
  with no seam. The land is mirrored by a compute pass, so plants will show in it for nothing.
- [x] **6.5 Seabed and colour.** The water draws the seabed itself (`water/water-seabed.wgsl`): rippled sand,
  coral and rubble on the reef and the bommies, weed beds. Turquoise to deep blue by depth.
- [x] **6.6 Surf on the reef.** Each wave is a train from the open sea that bends round the reef and breaks
  by what the water takes from it, in sets with lulls. Foam is a surface of its own (`textures/foam.js`)
  that Stage 7's foam can join. `ctx.water.surfAt(x, z, t)` is for sound. Tuned to the user's picks
  (Decisions).
- [x] **6.7 The look, at every hour.** Every view at its own time, at midday and at golden hour, and `beach`,
  `horizon` and `into-the-sun` at the four named times. Outside reviews, and the user's looks from the air
  and swimming: each finding was reproduced in a view of its own (disabled: `air-*`, `reef-*`,
  `sun-over-hills`) before it was fixed.

Research behind it: Tessendorf 2001 and Horvath 2015 (the spectrum), Bruneton et al. 2010 (the far sea),
Maritorena et al. 1994 (clear shallow water), Cichocki 2017 (pixel-projected reflections), Mitsuyasu et al.
1975 (how short waves spread).

**Cost**
- On high at 1600×900: at most 83 draw calls (`rocks`), 777 k triangles (`overview`), 9 passes,
  48 pipelines, overdraw 1.45, textures about 190 MB, render targets 180 MB. Medium and low stay within
  their limits.
- The user's benchmark (desktop, 2562×1237, high): 60 fps, GPU 8.3 ms at the median, 11.1 at worst
  (`rocks`). A laptop with Intel UHD 620 at 1920×1080: 6.9 fps on high, 11.3 on medium, 17.5 on low.
  Whether that counts as CLAUDE.md §10's mid-range laptop is the user's call.
- The sea map takes 1.6 s on the main thread at boot; a worker would take it off if boot needs it.
- SwiftShader frames in the Linux container, last measured at 6.6: `rocks` 7.4 s and `surf` 6.7 s against
  the 8 s budget (a 4-core cloud machine is over it on every view). CI's job takes about 29 of its 40 minutes. Later stages
  should win time back in both.
- A water shader uses all 16 textures a shader can count on: Stage 7's caustics have to be another layer of
  the surface tiles, or worked out, and Stage 10's cloud shadows must free one in group 0.
- Shimmer stays within its limit everywhere but `open-sea`: 0.51% on high (limit 0.5, it warns), 0.72% on
  medium and 1.0% on low, where the land's image lies in coarser cells.

**For the user's review**
- Motion, which stills can't show: the waves' timing, how long a glint lasts, whether the gusts read as wind
  and fade well with distance, how the foam's lace drifts and opens, how the chop dies over the reef's
  flat. And the benchmark on a mid-range laptop.
- Taste: the sun's path at sunset is a smooth pillar rather than broken glints; from straight above
  (`air-sun`) the sun's glare stays grey (220 at most); the ripples mirror the deep zenith as violet-navy
  dashes on the turquoise (`beach`, `reef`); the lagoon's floor seen from 25 m (`lagoon-sun`) shows no
  sand ripples; the bommies read as polka dots from the air (Stage 3's layout, 6.5's coral).
- The sun's path still reads as a solid white fill in the afternoon (`glare-air`, `glare-beach`,
  disabled), even at an eighth of its light: its core is tens of times brighter than white, as a real
  one's is. Halving it (Decisions) only narrowed it.
- Chevrons of sand and teal in `sand-edge`'s far bay and camouflage in `open-sea`: the outer two of the
  mirror's three rays read the land's image at its nearest cell. Reading all three between cells softens
  them and brings `open-sea` within its shimmer limit (0.40%) for about 1 ms more on a desktop GPU.

**Known flaws**
- Looking steeply down from the air at golden hour (`overview`, `air-headland`, `air-sun`, `lagoon-sun`)
  the sea is near black, and at sunrise the cove lies dark in the island's shade: right by the numbers, the
  exposure's more than the water's (Stage 12).
- At dawn, while the reef lies in the island's shade (until about 7:30), its line from the beach is a dark
  slate band: the breaking waves' faces mirror the sky from higher up, and foam is lit by shade alone. Into
  the setting sun (`horizon`) the reef's line reads as a dark scar.
- Through a telephoto from far off (fov 20 at 1.7 km) the reef's white line is a pixel thin and breaks into
  even dashes: nothing filters it across the crest. From outside the reef (`open-sea`) it barely shows
  white, and from straight above a wave out in the blue barely shows until it whitens.
- `surf`'s still shows no breaking wave (the white is the sun's glare on its face), and its motion strip a
  straight, even band.
- Near foam smears at a low angle, and from a low eye the middle distance reads soft: slopes are read by the
  pixel's longer side. Sparse foam lies as few small bits.
- A thin dark line along parts of the reef's crest in the sun's glare from the air: the seabed's own step,
  from 0.2 to over 4 m deep within 4 m.
- The land's image breaks into patches through the waves (`open-sea`, `swimmer`), stair-steps slightly
  right by a swimmer's eye, and gets shorter as the eye looks down (nothing off the frame can be mirrored);
  the hills' green speckles through it.
- Where the sun stands just over land, the land in the mirror holds back the glitter, which stands in
  fairly for the land in the sun's way (`sun-over-hills`); a true answer would march the sun's ray through
  the mirror.
- At the far end of the afternoon sun's path, seen from 30 to 120 m up, a smooth bright bar over a darker
  gap. Cause not found.
- The swell's own reach drops from 1 to 0.2 over the drop-off within about 12 m; its long waves hide it.
- Small: a dashed dark line along the top of a rock in 10–30 cm of water; a few dim orange glints in the
  cove's shade at sunrise; the waterline a dashed orange line of pixels, seen from outside the reef at
  sunrise.
- Checks: the light fixture compares the sand with the far sea's albedo, not the lagoon's; the motion strip
  spans 10 s, less than the swell's 11 s; nothing checks the opaque resolve's weighting with alpha under 1,
  nor the GPU's `seaKept` past the sea map's square; captures' GPU times leave the water at the last time
  timed, for the overdraw measured after (hardware only). `lagoon-sun` once shimmered 4.77% in one
  `verify` on the Intel laptop and never again: to watch for.
- Left for Stage 7: whitewater, the waterline and the seabed near a swimmer (its notes).

**Tried and dropped** (each measured; don't retry without a new idea)
- Glints as cells of a hash, each a count of facets: as good in a still, but they shimmered (2.41% in
  `lagoon-sun`, 3.06% in `air-headland`, against the tile's 0.09 and 0.22%).
- One mirror ray at moderately low angles: the land's image flipped pixel by pixel (2.46% in `open-sea`).
  The outer two rays counting for less, or held to the middle one: worse (0.54%, 1.48%).
- A mirror sharp up close (`fineSlopes` 0.0001) or a glitter ceiling of 6: they cut the sun's path short at
  low sun and left a flat white patch in `swimmer`. Softer ripples from high up fogged the sparkle.
- Judging the land in the sun's way by its height along the sun's way in the mirror: wrong at 42% of the
  points in and round a known shadow (the way it is now, 36%).
- Foam's holes from the seabed tile's cells read as a regular honeycomb. Foam lit by the sky on faces
  turned to the eye, or thinning at its holes' edges: barely changed, and thinned the reef's white line.
- The whitewater band gated by the crest's own swell took a fifth of the reef's white line from the beach.

### 7. Shoreline (the hero)

Goal: the water's edge alive, where the eye goes first. Waves run up the beach and slide back, leaving foam
lines, and foam that lingers; wet sand that is darker and mirror-like, and dries slowly after each wave;
caustics dancing on the shallow seabed; a small shore break; whitewater that stands up off the water.
**Done when** the low beach view is a wallpaper, its motion strip shows waves running up and draining back
naturally, and the user finds the motion natural in the running game.

Before (2026-11-12): nothing moves on the sand, and no white touches the beach. The waterline is a ruler's
cut where the still sea meets the ground, with a dark gutter on its sea side (`sand`, `into-the-sun`) and
a grey-tan band from standing height (`beach`); the wet band is one fixed outline, a tan stripe from afar
(`shoreline`); the sun glints twice, on the water and on the wet sand, each its own way (`sand`);
`swimmer`'s water is one flat teal; `air-shallows` shows no shore.

- [x] **7.1 Eyes on the water's edge.** Views for what the stage builds, each with a brief and frozen at a
  moment that shows it: low at the water's edge along the beach (the hero), the edge at arm's length,
  ankle-deep facing a wave coming in, looking down through knee-deep water, the waterline from the air, a
  rocky waterline up close; views the stage doesn't touch make room (CLAUDE.md §4). The tool shows a wave's
  whole run in stills: how far it reaches, how fast it goes up and back, how often one comes (the motion
  strip's 2 s steps skip most of a run-up), proven on a test scene built to fail it. The frame's cost on
  SwiftShader and CI's time measured where the shore fills the frame, and room made for what the stage
  adds: what only the shore needs costs nothing elsewhere.
- [x] **7.2 The run-up.** The waves that cross the lagoon reach the beach in the rhythm of the reef's sets,
  run up the sand as a thin clear sheet, slow, stop and drain back; each reaches its own line, in lobes
  along the beach, further for a set's big waves. The cut goes: sea, sheet and sand are one surface with no
  line, gutter or band between them, from standing height, from a hand above the sand and from the air,
  and from far off the beach's edge holds steady. JS knows where the water stands on the beach and when
  each wave lands (wading, sound), agreeing with the GPU at sample points, and any `t` gives the same frame
  however it was reached.
- [x] **7.3 Wet sand.** What a wave leaves: sand dark and glassy where the water just drained, mirroring
  the sky, the sun and the land as the sea beside it does, one glint of the sun across both. The gloss
  drains away within seconds, from the top down and in patches, the darkness over minutes, so the beach
  shows where the last wave reached and where the last big one did. Rock and the rocks within the waves'
  reach wet and dry by the same input. Into a low sun the foreshore glows (`into-the-sun`).
- [x] **7.4 Foam on the beach.** Each wave's front carries a line of foam up the sand and leaves it where
  it turns: it lingers, the backwash stretches and tears it into lace, and bits stay behind and fade; an
  older line shows under a newer one. One surface with the surf's foam (6.6). From the far end of the bay
  and from the air the beach is edged in white scallops that hold steady.
- [x] **7.5 The shore break, and whitewater that stands up.** In its last metres a wave stands up, breaks
  and runs on as a low bore into the run-up, a big one sooner and harder, a small one barely. Whitewater
  has height and hides what lies behind it itself, on the reef as at the beach, so the band painted from
  60 m off and its straight line go; close to, it has relief, sheen and a glow against a low sun, and
  spray where it breaks hardest. `ctx.water.surfAt` tells sound of the beach's waves too.
- [x] **7.6 Light under the water.** Caustics on the shallow floor, moving with the waves that make them:
  a fine bright net in ankle-deep water, wider and softer with depth, none in shade, melting into even
  light where a pixel can't hold them (no sparkle far off or from the air). The beach's ripples run on
  under the water, and the floor has detail down to centimetres under a swimmer's eye. On the rocks under
  water as on the sand.
- [ ] **7.7 Where rock meets the sea.** Against rock the sea rises and falls with the waves, washes white
  round the rocks' feet and drains off them; the wet line and the spray's dark band follow what the waves
  do there. No pale blocks along the rocky waterline, and no pale wet foot in the mirror (`rocks`).
- [ ] **7.8 The look, at every hour and from everywhere.** Every shoreline view at its own time, at midday
  and at golden hour, and the hero at the four named times; from the air, steeply down, through a telephoto
  and from a swimmer's eye, each finding reproduced in a view before it is fixed. An outside review. The
  taste calls go to the user as picks: how far and how often the waves run, how much foam, how glassy the
  sand, how strong the caustics, whether the beach's face gets cusps. The cost per preset, the benchmark
  asked of the user, and the hand-over.

Taken in three legs, each ending with `verify` green, commits on the `stage-7` branch and the user's look
at the running game: 7.1 to 7.4 (the run-up, the wet sand and the foam read only together, and their
timing is what the rest builds on), 7.5 and 7.6, then 7.7 and 7.8.

Leg 1 (7.1 to 7.4), handed to the user 2026-11-13:
- Views: `swash`, the hero (golden hour, along the bay from damp sand just above the waves' reach), and
  `air-swash` (from 25 m), with `sand` and `beach`, each with a run of a wave (views.js `run`: frames over
  a wave, and a time-slice along a line, proven by tests/image.test.js on frames of a moving edge and of a
  still one). `ankle` waits for 7.5, disabled; the view down through knee-deep water is 7.6's, the rocky
  waterline 7.7's. `horizon`, `overview` and `swimmer` stand aside.
- The run-up (`water/swash.js`, its WGSL twin): each wave lands when the sea map says (a fourth layer: when
  the waves reach the waterline nearest, how hard they break there, the beach's slope; the map now binds at
  group 0 for every material), runs up as a thrown stone would and drains back slower, its reach its set's and
  its own in lobes along the beach; the front sweeps along the bay as the waves land later towards the
  headland. JS knows it (`ctx.water.swashAt`, and `heightAt` on the beach), the waves fixture holds the GPU to
  it (the edge within 1.3 mm, once the landing times, hundreds of seconds, were mixed from their texels: half-
  float filtering rounded them), tests/swash.test.js its properties.
- The water lies over the beach as high as the waves may wet it and draws the sheet, the glassy film it leaves
  over the sand's rumples and the foam there, with the sea's mirror, the land in it and the sun's glitter;
  the terrain and the rocks wet and dry by the same model (`water/swash-wet.wgsl`), the sets' wetness as
  high as this beach's highest wave. `into-the-sun`'s foreshore glows again, as the sun's path runs on from
  the lagoon onto the wet sand.

Leg 2 (7.5 and 7.6), handed to the user 2026-11-13:
- Cost first, measured by the game's own benchmark run headless on the dev machine's GPU at the user's
  2562×1237, which gave their numbers to 0.3 ms: the water lies over the beach only as high as the waves wet
  it now, and gives bare ground back as the terrain drew it; the terrain shades no ground the water takes
  none of; the swash's noises are worked out per vertex (swash.wgsl `SwashPlace`: six waves in slots by
  number, so a piece's corners agree on each). `sand` 19.2 to 12.4 ms, `swash` 15.1 to 9.4, `beach` 15.3 to
  10.9, `air-swash` 16.6 to 10.0, `into-the-sun` 19.0 to 15.9. Tried and dropped: skipping the swell's and
  chop's reads and the walk for what stands under the water on the beach (slower: the branches cost more
  than they saved).
- The shore break (`water/swash.js` bore, its twin): each wave comes in over the last metres of the
  shallows as fast as the water lets it, timed to reach the waterline as its run-up starts, rises as it
  shoals and breaks where it stands 0.8 as tall as the water is deep: a big one 4 to 6 m out, a small one in
  the last 2 m or not at all. Its face steepens into a bore with foam on it and lace trailing, drifting in;
  the water it broke in turns milky. JS knows it (`ctx.water.boreAt`, `heightAt`, and `surfAt` tells sound
  of the beach's waves), the waves fixture holds the GPU to it, tests/swash.test.js its timing, its speed,
  where each wave breaks and its mean.
- Whitewater on the reef lifts the surface, up to 0.5 m where it breaks hardest, in lumps along the crest,
  each wave its own (`water/surf.js`, its twin): it hides what lies behind it itself, and the band painted
  from 60 m off is gone. Close to, its heaps are lit on the side facing the sun and its bubbles keep a little
  of the water's mirror. So that the line still reads from the beach, the reef's white lasts most of a period
  and runs 30 m in over the flat (`trail` 1.5, `run` 30), and fades to none by the next crest (it used to
  stop in a step, in foam and height). Spray (`water/spray.js`): puffs thrown up and forward off the crest
  where it breaks hardest, from the sea map's crest spots, in the translucent pass while the eye is within
  1.2 km of the reef.
- Caustics (`water/caustics.js`, `water-caustics.wgsl`): eight ripples of 4 to 36 cm running with the wind
  bend the sun's light in, and the floor is lit by the area's ratio (Wallace 2011): a fine net ankle-deep,
  wider and softer deeper as each ripple blurs out past its focus, its brightest lines held to five times
  even light. A pixel drops the shortest ripples first, the floor it sees through the waves too small for
  it counted in, so the net coarsens and melts into even light further off; a table of means over depth and
  ripples dropped (170 ms at load) keeps the floor as bright on average. The sun's share of the light only,
  on the floor the water draws and on what stands under the water near shore. Drawn by a variant of the
  water's own (`WATER_NEAR`) within 25 m of the eye: in the beach's variant they cost every piece near the
  eye 1 to 2.5 ms in a larger shader. Tests: its mean, its net's spacing by depth, its fading, its loop; the
  fixture holds the GPU to JS.
- The floor: wave ripples in the sand under the sea, their crests along the shore 9 cm apart in the
  shallows and 15 deeper (`chunks/sea-ripples.wgsl`), drawn by the terrain just under the waterline and by
  the water beyond, the same at the same place; the beach's grain on the water's floor under a swimmer's eye.
- Views: `ankle` (reframed, ankle-deep facing the waves coming in), `knee` (new: down through knee-deep
  water) and `surf` in; `shoreline` and `rocks` aside for leg 3. A view can open at a moment of its own
  (views.js `t`): `ankle` as a wave breaks in front, `swash` as the shore break runs along the bay, `surf`
  as the reef's wave breaks in sections. Found on the way: the bore shaped the water over the reef's flat
  too, far from any beach, in the shore's pieces alone, so their edges parted (the sea surface check saw
  the sky through them); it fades out 12 to 20 m from the waterline now.

The user's look at leg 2 (2026-11-14, at the default hour): the waves come in and break at the right speed
and size, but look fake: no wave can be seen standing up, and the water is too clear and plastic. Fixed
before leg 3, judged at 11:00 (`beach`, `ankle`) and in the hero:
- A wave's top outruns its foot: its water moves inland `lean` m per m it stands, as a Gerstner wave's
  does, and its face narrows from `steepens` times as deep as it breaks, so it leans in, near upright as a
  big one breaks, and its back eases (JS's surface follows; tests: it folds over nowhere, and a face stands
  past 45°). The reef's waves the same as they peak (`surf.lean`); its whitewater heaps up along the crest
  and stands lower between (`surf.heaps`, `stands` 0.65: as tall at its heaps as it stood before).
- The light through a wave: the eye's ray from a face turned to it bends in flatter and crosses more water
  (it was counted as crossing less, so a face read paler than the water before it), and a crest stands over
  more water than the sea map's depth. Near its top a wave is thin: on the face turned to the eye, the eye
  sees what lies behind it through the water, and against a low sun the sand stirred up in it sends the sun's
  light on: the hero's waves glow gold-green along their tops; at 11:00 a face is a turquoise band.
- Sand the waves stir up (`swash.stirred`): the surf zone always holds a little, gone by 16 m from the
  waterline, and the water a wave just broke in clouds in patches that drift in with it and settle over
  seconds, each wave's its own (it was a white veil); the floor and its net of light fade under it. It sends
  the sky's light back every way and a share of the sun's onwards. `knee` reads less like a pool, and from the
  air the shallows by the beach are aqua, no longer milky.
- The bore's foam: a roller at its front, thinning behind into patches (`roll`, `holds`). The spiky lace along
  its front was its drift: two waves' drifts, 8 m apart, blended across a hand's width; a place takes one
  wave's now.
- Spray: clusters of droplets with clear air between, wider than tall, not soft round puffs.

The user's look at 11:00 from `beach` (2026-11-14): a second wave that doesn't stand up pushes the water
onto the beach after every wave; the wave is too clear to see stand up; too many caustics; the film looks
fake. An outside review traced each to its cause and left a costed plan, A1 to C2 (the review artifact's
`handoff/report.md` §7). Taken so far, judged at 11:00 from `beach` and side-on:
- A1, one event from the break to the run-up (`water/swash.js`, its twin). The bore shrank to nothing a
  metre short of the sand (0.8 of the depth), its foam faded out before it, the edge the last backwash drew
  down rose all at once when the run-up started, and the run-up set off as a clear sheet of its own. Now the
  bore runs on to the waterline no lower than the sheet it runs up as; the drawn-down edge refills as its
  face passes (`fill`); the run-up starts from the waterline as the foot of the broken face reaches it,
  setting off at the bore's speed and speeding up over `collapses` s as the bore collapses; its front
  carries the bore's foam, as white as the bore's roller (`front` times it, which keeps the beach as white
  on average: a lull wave's run-up is as faint as its break, a set's big one whiter); the edge crossing the
  drawn-down sand is white where the face has come. Tests: on the cove and seeds 1-20 a wave's white front
  only moves inland from its break to 1 m up the beach, with no gap, no jump over 0.3 m in 0.05 s and no
  pause over 0.2 s, and the water behind its crest never rises again (the old model: a 1.3 m jump, a 0.35 s
  pause, 2.8 cm risen after the crest).
- A2: the run-up is white only within about `milkWidth` m behind its front; the milky veil that switched
  on over all the near water 2 s after each break is gone.
- A3: a wave lands at one time all along each line inland. The sea map's 4 m grid put each sample's
  waterline up to 1.3 m off where the waves' timing changes 0.7 s a metre; now each finds it on its own line
  (`sea-map.js`), and the landing time varies from 3 m up the beach to 5 m out by 0.09 s at most, from 1.46
  (test). The bore no longer gets a 0.9 s head start 5 m out, nor the run-up's top a 0.75 s late clock.
- `side` (new, in place of `surf`): kneeling in shin-deep water at 11:00, the waves passing side-on, with a
  run every 0.5 s. The review's own camera, crouching at 0.45 m, is lower than the views' rule allows.
  As the waves now break 0.75 s later, `ankle` opens at 159.35 s (was 158.6) and `side` at 159.25, each as
  its wave breaks. `verify` green on 65f5316, before that; its shimmer warnings (`side` 0.58% turning,
  1.48% moving; `knee` 14% moving, was 17%) are the floor's net seen through refraction, as before.
- Cost: no GPU in the cloud container, so measured as SwiftShader's GPU time (timestamp queries) at
  960×540, the build before and after alternated view by view: `air-swash` -0.3%, `knee` +1.1%,
  `into-the-sun` +0.8%, `swash` -5%; one pass over all eight views moved -7% to +11% either way, as much as
  two passes of the same build differ. A few operations per wave in the beach's pixels, and none where
  `ashore` went. Unchecked on the user's GPU.
- Seen in SwiftShader frames at the review's cameras and times (11:00, every 0.25 to 0.5 s): side-on, the
  whitewater runs in to the waterline and its white rides on up the sand as the run-up's front, thinning to
  its top; from `beach` the white line reaches the wet sand and the run-up's line peels off its front and
  races up, leaving the bore's lace on the water; from `ankle` the floor stays clear after the whitewater
  passes. The wave breaks about 0.75 s later than before (no more head start offshore). Not seen: motion
  at frame rate on a GPU.
- Still wrong, now easier to see: the run-up's edge is ruler-straight and bright, and the sheet behind it
  a flat grey band from standing height (the film, A9 to A11 and B5); for half a second from `beach` two
  white lines with that grey between (the run-up's front ahead of the bore's lace); as the bore collapses,
  its white is a solid band along the waterline side-on; the near water stays pale side-on (the stirred
  sand's haze, A6). The rest of the review's plan (A4 to C2) is open; A4 waits for the user's pick: whether
  breakers shrink to match today's run-ups or run-ups grow to match today's breakers, and how much white a
  lull wave shows (today: as little as its break, its run-up too).

Open after leg 2 (an outside review's findings and the user's look, less what was fixed after them):
- The reef from 30 m: where a wave breaks along the whole crest at once its whitewater is a band, heaped
  now; its face shows mostly as it breaks in sections (`surf` opens at such a moment). From the beach through
  a telephoto (`reef`) the white stood in flat wedges between its lumps before they came, unchecked since.
  From the beach the reef's white line pulses with the sets and goes dark in a lull, where Stage 6's band
  held it steady (the user's pick then): a pick for 7.8, with how much foam.
- The shore break: no lip is thrown over: an upright face turns into the roller's foam, which is flat white
  with no relief up close; the hero's glow is a thin line along each crest. In `ankle` faint horizontal
  stripes run through the water behind the bore (in leg 2's build too; cause not found).
- `knee`: the water's colour is still Stage 6's, the net now softer through the surf zone's haze.
- The camera-move shimmer can't follow refraction: it reads the floor's net, which moves with its apparent
  depth through the water, as shimmer (`knee` 37%, `swimmer` 10%); as the camera turns, 0.02%.
- Cost. GPU at the median, the game's benchmark headless on the dev machine at 2562×1237 (the user's
  leg-1 run in brackets): `into-the-sun` 20.1 ms (18.7), `ankle` 19.5, `sand` 16.1 (18.7), `air-swash`
  14.2 (16.5), `beach` 13.5 (15.4), `swash` 12.3 (15.0), `surf` 10.1, `knee` 9.3: under 60 fps there in
  `into-the-sun`, `ankle` and now `sand`. The fixes after the user's look add 0.3 to 0.8 ms, in a larger
  shader (skipping the heaps' noise and the clouds' read where there are none saved under 0.25). Of what
  leg 2 adds over the cost cut in `into-the-sun` (+3.5 ms): the bore 0.6, the caustics' code 0.6 to 0.9,
  the floor's ripples and grain 0.5 to 1.5 (most in `ankle`), spray 0.1 to 0.4, the rest spread through a
  larger shader. SwiftShader frames in the Linux container, all
  within the 10 s budget: `into-the-sun` 9.4 s, `ankle` 9.3, `beach` 9.3, `swash` 8.6 since the user's
  look (leg 2: 9.4, 9.2, 8.5, 8.4), `surf` 7.7, `sand` 5.5, `air-swash` 5.0, `knee` 3.3 at leg 2. 12
  passes (the translucent pass and its composite, for the spray), 52 pipelines (the water's four variants).
- From leg 1 still (the review saw them again): straight wet edges, the stepped waterline and wet margin,
  the headland's image cut off by a vertical edge with stepped teeth, the far water's stepped blocks at the
  bay's end, the seams in `sand`, the milky band from the air.

Open after leg 1 (with an outside review's findings; what leg 2 fixed is gone):
- From the air the uprush slides along the beach as a milky slab. A full wave runs 0.32 m up, the largest
  about 0.52 m.
- The sheet mirrors the sky over it as the sea does, so where it faces the dark sky away from a low sun it
  reads as a dark band darker than the sand (`swash`), and from standing height at midday as a grey-taupe
  stripe (`beach`). The glassy film after the drain, gold with the sun in its rumples, is the best of it.
- Foam: the front an even ribbon with a speckled edge, the stranded line streaky up close and dashed far off;
  no foam brighter than the sand from standing height.
- Edges: the run-up's edge is straight or a smooth arc in most views, its lobes gentle; the drying margin
  steps rather than fades; no beach cusps (7.8's pick).
- Seams: a dotted bright line and a dark hairline through the sheet (`sand`); rows of black dots and a dark
  stepped wedge in the far water at a grazing angle (`swash`); a blue-black streak along the rocks'
  waterline (`rocks`). Causes not found.
- The rocks take the beach's run-up up their faces as if they were sand (7.7).
- Cost: SwiftShader frames of 8.6 to 9.3 s where the shore fills the frame (`swash`, `beach`,
  `into-the-sun`, `rocks`), 5.4 to 5.5 s (`sand`, `air-swash`), with the budget raised to 10 s; the
  water's code for the beach is a variant of its own for the pieces within reach of a waterline, and the
  terrain's only in pieces with sand or rock, but every pixel of those still runs it, and the terrain needs
  only the wetness of what it works out. Overdraw rises by 0.3 to 0.8 where the water lies over the beach.
  CI's `verify` in the Linux container takes 20.5 minutes on the dev machine; the runner's own time shows
  on the next push.
- The user's look (2026-11-13): the motion looks natural. The benchmark (desktop, 2562×1237, high): 60 fps
  on five views; `sand` and `into-the-sun` 51 fps, GPU 18.7 ms at the median; the shore views' median
  15.3 ms (Stage 6's views: 8.3), `rocks` 13.4 (Stage 6: 11.1). Leg 2 wins some back before it adds.

- Stage 6 built for this stage: the sea map's distance to the shore in metres on the drawn ground, and the
  way inland (6.2); a surface in JS and on the GPU that the run-up joins (6.3); foam as a surface of its
  own that foam lines and lingering foam join (6.6). It leaves the waterline where the still sea meets the
  ground, and in shallow water a trough flattens to no lower than `shallowTroughs` of the water under it
  (`troughFloor()`), so the waterline can't draw back: the run-up must.
- The wetness has one input for sand, rock and the rocks (`chunks/wet.wgsl`): drive `wetness` and its film
  there (7.3), and keep `washed`, where the waves reach, which the ripples and swash marks follow, so
  drying sand doesn't grow ripples. Spray darkens rock to 2 m above the sea (`chunks/rock.wgsl`): waves
  breaking on it should drive that (7.7). A real waterline has beach cusps, scalloped by the swash about
  one and a half times as far apart as it runs up: 5 to 7 m here, where an open coast's lie 20–40 m apart
  (7.8).
- Measured in the cove: the beach's face rises 7 to 8.5 cm a metre at the waterline (5.7 towards the
  headland) and the seabed falls 5.5 to 7, so the wet sand's zone (0.35 m up) is about 4.5 m of beach, and
  the water is ankle-deep 2 m out and knee-deep at 7. The reef's waves come 11.25 s apart, in sets.
- What the code allows: a water shader has no texture to spare, the terrain's has four and the rocks'
  three. The land's image in the water (`water/mirror.js`) exists only after the opaque pass, so the
  ground's own sheen can mirror the sky but not the land. The water's mesh has quads of 0.25 m within 24 m
  of the eye on high and 0.5 m within 18 m on medium and low, coarser beyond: a wave a hand high keeps its
  shape from the vertices only close to. SwiftShader frames stood at 7.4 of their 8 s at the end of Stage
  6, and a shader's every line costs there at every pixel it draws.
- What nature does here, from the research: a wave that runs 0.3 m up this beach takes about 6 s over it,
  fastest at its start, the backwash about half as long again as the uprush, so between the reef's waves
  the sand lies glassy for a few seconds. The sheet is millimetres thick. Waves this long on a beach this
  flat don't curl: a low glassy hump steepens in its last metre and collapses into a thin bore. Behind a
  reef the sea's level at the shore also swings a few cm over half a minute to two, which moves the whole
  zone the waves wash. A film of water mirrors 6% of the sky 3 m from a standing eye, a third at 10 m and
  over half at 20 m: the mirror is the middle distance's, and at one's feet wet sand is dark. The net of
  light in ankle-deep water comes from wavelets of 3 to 10 cm; the ripples' texture has texels of 13 cm
  (26 on low), finer only where it is read again smaller.
- Research to start from: Hogg and Pritchard 2004 (a swash's path and its sheet's depth), Stockdon et al.
  2006 (how far waves run up), Lekner and Dorf 1988 (why wet sand is darker, and by how much), Lagarde
  2013 (wet surfaces as they dry), Wallace 2011 and Yuksel and Keyser 2009 (caustics from the surface's
  own shape), Dupuy and Bruneton 2012 (foam's cover and light), Vlachos 2010 (a pattern carried by a flow),
  Malan 2022 (a breaking wave as one shape moving along its front). No shipped renderer found simulates
  the beach's edge: each moves it by a formula of the distance or the time to the shore.
- Tried while planning, and thrown away: the water's mesh laid on the beach's face as a sheet with the
  sea's own mirror. It joined the sea with no seam and mirrored the headland; from above a clear sheet
  barely showed, as it reads by the dark sand under it, its foam and what it mirrors at a low angle; and a
  few millimetres over the ground it fought the terrain's mesh for depth, in dashes along the waterline.
- Left by Stage 6:
  - Whitewater (7.5) should stand up as geometry (foam lifting the surface), hiding what lies behind it
    itself. Today a band painted from 60 m off (`surf.stands`) draws a hard straight line along the top of
    every breaking wave between about 60 and 200 m (left for this stage by the user's pick); within about
    20 m of a swimmer whitewater reads as matte snow with grey specks, backlit at golden hour as tan
    sandstone, with no relief, sheen, curl or spray.
  - The waterline (7.2, 7.3; on rock 7.7): a cut with a dark gutter in `sand` and `into-the-sun`, muddy in
    `beach`, with a thin grey band along it there (the sky mirrored at a grazing angle over tan wet sand)
    and a tan line round it from the air. In `into-the-sun` the near water is dark beside a bright beach.
    Looking into a low sun the wet band stays darker than a real foreshore (the film is about 2 m wide, and
    the sky's light as SH blurs the glow away); looking down, the sun's glint on it is a smooth oval that
    reads CG. In `rocks` the rocky waterline shows pale blocks of the land's own pixels, and rocks in the
    water mirror a pale wet foot.
  - The seabed near a swimmer (7.6): `swimmer`'s near water reads as one flat teal (the floor's sand varies
    by about 10%, its ripples shade it by about 6%), and looking down its finest mottling is about 0.8 m.
    The beach's own ripples carried onto the floor, with caustics over them, should give the eye something
    to see through the water.

### 8. Foliage foundation and coconut palms

- `plants/`, the shared foundation for all plants:
  - procedural leaves with colour, shape, surface detail and translucency;
  - foliage shading, including the gold-green glow of backlit leaves;
  - leaf edges that neither flicker nor alias, near or far;
  - shadows from leaves, so plants cast soft, dappled shade that moves with them;
  - one shared wind model, with gusts that travel across the island;
  - placement by zone, density per quality preset, and many plants drawn cheaply.
- First species: leaning coconut palms along the cove, with coconuts.
- Judge flicker with the motion strips and shimmer scores, near and far, and extend the tool if they miss
  something. Known gaps: the shimmer pan only turns diagonally, so a thin line along that diagonal scores
  nothing; a per-view percentage hides flicker on a single palm; overdraw misses what cut-out leaves hide
  behind their holes, and counts points, lines and sprites wrongly. No fixture proves alpha-to-coverage
  yet, and geometry thinner than about two pixels crawls even with MSAA.
- Shade under a canopy blocks the sky's light as well as the sun's. Nothing blocks the sky's light yet, and
  at golden hour it is half the light on level ground, so shade would glow; the light from below assumes
  the ground around is in the sun.
- Leaves cast through the shadow maps as cut-outs (the shadows fixture's card proves the holes) and tell
  `ctx.shadows.from()` where they stand (CLAUDE.md §8). Palms' crowns stand high enough to read the
  island's shade right.
- Placement reads the drawn ground (`heightmap.groundAt`, `zoneAt`, about 0.25 µs a point) through
  `world/scatter.js`, keeping clear of the rocks (`ctx.rocks.clearance`). It runs on the main thread at
  boot and is kept per seed through a quality change: plants by the hundred thousand need workers.
- Near the camera the mesh is `ctx.terrain.heightAt`; farther out its levels of detail stray from it
  (centimetres at 200–400 m, metres far out) and change as the camera moves. `chunks/terrain-mesh.wgsl`
  gives the height as drawn, with a JS twin (`ctx.terrain.meshHeightAtCove`). The rocks move by it each
  frame in a pass of nine texels each, which won't scale to plants by the hundred thousand. Plants also
  bend with the planet (`chunks/planet.wgsl`), or the far ones float.
- **Done when** palms glow when backlit at golden hour, fronds sway and flutter, their shade sits soft on
  the sand, close-ups hold up, and nothing flickers: the shimmer score stays low and the user sees none in
  the running game.

### 9. Cove vegetation

- Banana (with torn leaves), monstera, hibiscus, frangipani, ferns, grasses, beach scrub, and vines
  creeping onto the sand. One file per species, each with its own wind response.
- Grass that shows gusts rolling across it, and dappled shade drifting over the sand.
- Cheap distant vegetation, so the hillsides look lush from the overview.
- The ground says how lush it is and how sandy its soil (`heightmap.groundAt`: `lush`, `sandy`, and `band`):
  dense jungle where lush, open grass where not, beach plants where sandy. Placement reads these, not
  distances from the shore (Decisions). The green's patches stay put and JS knows them
  (`ctx.terrain.greenAt`), so grass stands on the green only. Bare patches show from any distance, so the
  plants have to hide them where the eye expects cover.
- Rocky shores (the headland and one cape) have a band of rock zone 20–45 m deep: what grows there decides
  how it looks.
- **Done when** the jungle-edge view is lush and layered, each species is recognisable by its shape and its
  motion, and the frame cost is within budget.

### 10. Clouds

- Golden hour and the cove gate need a sky with clouds, so they come before the polish pass.
- Drifting clouds lit by the sky model, with sunset-coloured undersides. Their shadows slide across the
  lagoon and the land, consistent with the sun shadows.
- Cloud shadows join `sunVisibility()`, and need a texture in group 0: a water shader already uses all 16 a
  shader can count on, so free one first. The transmittance table is private to the sky
  (`sky/atmosphere.js`), and the aerial-perspective table reaches 64 km.
- **Done when** clouds look soft and full from both the beach and the overview, and their shadows visibly
  move.

### 11. Cove polish (milestone gate)

- Art-direction pass: colour grade, bloom, haze, exposure and palette. Review every view at several times
  of day and fix everything on CLAUDE.md's list of things that break the spell. Known:
  - Saturated primaries show kinks where the tonemapping clamps (the tonecard's ramps); natural colours
    don't.
  - The sky beside a low sun clips red in the sunset telephoto, so the disk can't show as an orange orb.
    Bloom needs the sun's energy, which the sky holds under a ceiling, and the HDR target holds at most
    about 2048 (exposed).
  - The sky's light on upward faces is up to 10% too strong in red at golden hour: nine SH coefficients
    can't hold the bright band along the horizon.
  - Shade on dark ground is near black at golden hour (Stage 5), and the sand reads khaki at 16:30
    (Stage 4).
  - Far terrain samples the 8 m grid at coarser spacing without prefiltering, so ridgelines may crawl in
    motion. The headland's inner flank runs inland as a long steep wall; beyond the cove the island is a
    smooth shape in an even ring of lagoon.
- Performance pass on the `high` preset. Record what the cove costs per frame: the counts, plus the
  benchmark on the machines the user can try, ideally including a mid-range laptop. That decides how much
  more island fits in the budget. Calibrate the limits in `config.js` against it, and tune `medium` and
  `low`. Known: GPU times on a laptop follow its GPU's clock and swing several-fold between identical runs,
  so only the benchmark weighs a change; the terrain shader's cost waits on a pass (5.1); on high-DPI
  screens the render targets passed their 256 MB limit several times over (0.5–0.7 GB at 4K, measured
  before the shadows and the sea); SwiftShader frames and CI's job are near their limits (Stage 6).
- **Done when** the user agrees that every cove view clears the wallpaper bar at midday and at golden hour.
  Later stages wait for that unless the user decides otherwise. Milestone 4 always waits, because it needs
  this stage's cost numbers.

---

## Milestone 2: Alive

### 12. Every hour of daylight

- Time doesn't pass, but the player can pick any hour from sunrise to sunset, so every one has to work, not
  only the midday and golden hour the cove gate checked. Lighting, exposure and fog stay consistent from
  one hour to the next. There is no night (see Decisions).
- A time change lands whole a few frames late: the sky's light is read back from the GPU, and the island's
  shade is worked out in workers (Decisions). Dragging the time (Stage 16's setting) would lag behind.
- The haze check's `aerial` answer stood at 5.6 of its 6-level limit from 190 m up at sunset, and 6.0 from
  the beach in the first and last minutes of daylight; from 1 km up it misses by 37 levels. Near the sea
  the transmittance table's rows lie 25 and 101 m up, in haze 150 m thick.
- At sunrise the cove lies dark in the island's shade, and at golden hour, looking steeply down from the
  air, the sea is near black, as is shade on dark ground: right by the numbers, as the exposure follows the
  sun, but no wallpaper.
- **Done when** a capture series from sunrise to sunset has no broken or ugly hour.

### 13. Small life and detail

- Signs of life: seabirds, butterflies, crabs, fish shadows in the shallows. Things lying about:
  coconuts, shells, driftwood, fallen flowers and leaves.
- A strand line of wrack painted on the sand read as smears and footprints, without relief, and went: it
  needs things lying on the beach. The sand's own bits of shell are flat specks.
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
  the world. The water's surface is `ctx.water.heightAt` and `over()`, which sums every wave each frame.
- Movement and collision maths get tests. Automated runs stub pointer lock and never drive the real
  mouse.
- The sky's tables render again whenever the camera's height crosses a whole metre, so a head bob around
  such a step would render them twice a stride.
- The user found the rough walk's pace (1.4 m/s) a bit slow on Stage 3's bare ground, perhaps for want of
  detail passing by. Judge the pace again on detailed ground.
- Update the README and the start screen's controls.
- **Done when** the movement tests pass; invariant tests over seeds show the player can't fall through the
  ground, get stuck or leave the world; and the user has walked and swum the cove and is happy with how it
  feels.

### 15. Sound

- `audio/`: procedural surf tied to the wave sets and to the distance from shore (`ctx.water.surfAt`); wind
  in the leaves tied to the gusts; birds and insects that change with the time of day; footsteps that
  depend on the surface.
- It starts only after a user gesture, has a mute control and stays silent in capture mode.
- Scheduling sound needs the audio clock (`AudioContext.currentTime`), an exception to the rule that all
  time goes through `clock.js`. Decide how, and write it into CLAUDE.md.
- The AI can't hear, so it checks what can be measured: render a few seconds of each soundscape offline in
  the browser and check levels and peaks (no clipping, no silent layer, no runaway gain).
- **Done when** those checks pass, capture mode and the start screen are silent, and the user has listened
  at several spots and times of day and is happy with it.

### 16. Presentation

- A start screen in the game's own visual language. Boot progress if generation takes noticeable time.
  An in-game settings menu: quality, time of day (beside the `,` and `.` keys) and sound. Optionally a
  photo mode with the UI hidden. The terrain's detail ignores the field of view, so a zoomed-in photo
  magnifies far ground at its coarse detail.
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
- The coast beyond the cove is beach with a coastal flat, and one rocky cape (Decisions). The views
  `headland`, `cape`, `coastal-flat` and `summit` already look at it, disabled for now (the user's call;
  `--views` still captures them).
- The terrain's grids are 2 m apart over the land and the shallows everywhere (Decisions), a multiple of
  256 samples across so their mipmaps halve exactly (`config.world.terrain.mips`): growing the island
  (`config.world.island.size`) grows them, and boot's time with them.
- The capes go where the coast juts out most, as measured 250 m inland, so changing the land's shape inland
  can move them. The coast's distance changes by up to about 1.7 m a metre near the shore, so slopes set in
  it (`shore.steepest`) come out steeper in places.
- Two seeds break a design rule, and `tests/island.test.js` names each as a known exception: on seed 20 the
  hills' slope and their rise from the shore add up to 55° at one point 243 m behind a beach; on seed 9 a
  valley moves in behind the headland's sheer face, which rises only 26.6 m in 30 m. Fixing either changes
  seed 1's island.
- **Done when** (per area) the user agrees its views clear the bar and the frame cost stays within the
  limits.

---

## Milestone 5: Ship

### 18. Performance and robustness

- Profile against the target: 60 fps at 1080p on a mid-range laptop. Captures can't measure real GPU cost,
  so ask the user to run the benchmark on real machines. Also cover: choosing quality automatically or
  picking a safe default, boot time, memory, a lost GPU device, the browsers with WebGPU, high-DPI
  screens (a drawing buffer past 8192 px fails), and the size budget.
- A lost device (a driver reset, say) stops the game with the error overlay. Recovering means making every
  GPU resource again, as a quality change already does (`setQuality` in `main.js`), on a new device.
  Firefox has WebGPU on Windows only (141 and later); elsewhere it gets the note that the game needs
  WebGPU.
- Boot: the heightmap's workers are untried outside Chromium; without them the grids build on the main
  thread, about 6 s on a fast desktop, and with two cores there is one worker. Boot waits on the surfaces'
  tiles (made and read back on the GPU) more than on the grids, so making the tiles faster is the lever.
  The sea map takes 1.6 s on the main thread (Stage 6).
- The terrain's fragment shader is most of a SwiftShader frame, its aerial perspective and its filtered
  slopes the largest parts.
- Each `renderer.render()` encodes and submits its own pass, and the sky's 3D aerial table takes a render
  pass a slice (37 submits in a frame where the sky's tables follow the camera's height): one encoder a
  frame, and the table as one compute pass, would save CPU time.
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

- **Time of day doesn't pass.** It stays where it's set: the player sets it with the `,` and `.` keys (in
  every build, 2026-11-12) and, from Stage 16, the settings menu. (2026-10-20)
- **The island's own shade is worked out per time of day, made fast**, not replaced: a time change waits
  for it, briefly. Should time ever pass on its own, the next time's shade is worked out in the background
  and blended in, or on the GPU behind the same texture. The terrain casting into the shadow maps round the
  camera was the alternative: time changes at once, but the ridges' shade past the maps' reach is lost.
  (2026-10-29)
- **Island size depends on performance.** The user expects the game to be heavy. Build the cove first,
  measure it (Stage 11), then grow the island only as far as the budget allows. (2026-10-20)
- **Daylight only.** Time of day spans sunrise to sunset. Night isn't part of the game. (2026-10-20)
- **The cove faces the sunset.** Looking out to sea from the beach, the sun sets straight ahead.
  (2026-10-20)
- **Swimming is basic and simple to build:** at the surface only, with the view above the water. No
  diving. (2026-10-20)
- **Desktop only:** a desktop browser with keyboard and mouse. (2026-10-20)
- **Raw WebGPU with hand-written WGSL, and a renderer of the project's own** (Stage 4b), replacing WebGL2
  through three.js. (2026-10-24)
- **No runtime dependencies** (Stage 4c): the maths the game took from three is the project's own.
  (2026-10-24)
- **WebGPU only**, with no WebGL fallback. A browser without WebGPU gets a short note that the game needs
  it. (2026-10-24)
- **MSAA is 4 samples on every preset.** WebGPU allows only 1 or 4, and the frame needs at least 2.
  (2026-10-24)
- **Reversed 32-bit float depth everywhere.** (2026-10-24)
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
- **Beaches all round, rock in two places**: the coast is beach but for the headland's high cliff, and one
  rocky cape beyond the cove where the coast juts out furthest, a black wall of 8–16 m with green slopes
  above. Behind the beaches a berm rises to where the green begins (about 2 m up), and a coastal flat of
  changing width (0–160 m) stands a few metres above the sea before the hills. The bands behind the sand
  vary as in nature rather than as rings: the beach 10–45 m wide, wider in bays; a thin strand of scrub,
  wider on points; the palm belt over the flats and up valley floors, so the jungle starts 35–170 m from
  the water. Rock on a rocky shore lies where nature leaves it bare: on cliffs, where the waves and spray
  reach, and fallen at a sheer cliff's foot; green comes down to a cliff's edge. The headland's face to the
  bay and its tip stay sheer; its outer shore changes from sheer walls to green slopes above a rocky foot.
  The flats are old beach ridges (about 1.3 m) and hummocks, and gullies run straight down the hills. A
  second cape is one setting (`shore.capes.count`). It replaces "more beaches beyond the cove", which left
  70% of the coast rocky cliff. (2026-10-25)
- **The terrain's heights lie 2 m apart over all the land and the sea you can see into** (above −20 m:
  the lagoon, the reef and its drop-off), the cove no different from the rest, and 8 m apart out to the
  deep. 2 m over the deep sea too (a third more samples nobody sees) and 1 m everywhere (about 15 s to
  build on one core) were the alternatives; finer relief than 8 m waits on whether it is still missed.
  (2026-10-25)
- **The reef is roughened a bit**: its crest wanders about 8 m either way over about 110 m, and its
  width with it; the pass widens towards the sea between ragged walls. A less circular bay, a blunter
  headland tip and leaving it regular were the alternatives. (2026-10-23)
- **Bright white sand**, albedo 0.65, at the top of what white coral sand measures: cream-white at
  midday. Measured coral sand at 0.55 (grey-beige), golden quartz sand at 0.40 and the old plain colour
  at 0.72 were the alternatives. (2026-10-23)
- **Dark basalt**, albedo about 0.05: near-black volcanic rock in lava-flow layers, with the beach's white
  sand gathered in its hollows. It gives the strongest contrast with the sand and the lagoon, and the
  volcano's steep patches read as dark crags rather than pale blotches. Weathered and lichened grey-brown
  rock (0.18), pale coral limestone (0.4) and pinkish granite (0.3) were the alternatives. (2026-10-23)
- **Lush tropical green inland**: saturated greens with little bare ground, grass on open ground and the
  dark leafy understory in hollows and gullies, so the hills show dark gullies under lighter ridges. A
  lighter, yellower sunny meadow, a sun-dried ground of olive and straw, and a darker deep jungle were the
  alternatives. (2026-10-24)
- **The ground's look (4.8)**: wet sand warm, with a lobed swash line where the waves reached (a dark
  glassy band and a soft drying without a line were the alternatives); glitter on wet sand (a gently
  rumpled surface); whiter dry sand with more contrast (grain that shows at standing height, and lumps and
  pocks); denser scrub (clumps, a darker scrub floor); stands that last into the distance with a lush
  floor of brown soil; lichen as an even tint (grey crust with orange rosettes was too much); rock stepping
  out of the sand as ledges (sand drifted against it); blockier rocks (a sheen on dry rock). (2026-10-28)
- **Shadows twice as soft as the sun's own disk makes them** (`config.shadows.softness` 2), the rocks' and
  the island's own shade alike: sharp at a caster's foot, softening further out. The real disk (rock
  shadows crisp almost to their tips in the low sun, a ragged edge to the hills' shade on the beach) and
  three times (hazy shade) were the alternatives. (2026-10-29)
- **The air stays as clear as it is**: the light from below lifts shade on the beach, and more aerosol
  barely changes midday while it spreads a large halo round the low sun. Four and ten times as much were
  the alternatives. (2026-10-23)
- **The hilltops' last light is as the atmosphere gives it**: at the named sunset the sun on the summit
  is 1.6 times the beach's, and lit hilltops over a dark shore show only in the last minutes before the
  sun touches the sea. Thicker evening haze (a greyer horizon) and a named sunset 0.5° up were the
  alternatives. (2026-10-22)
- **The sea's look (6.6)**: the water clearer and more turquoise; the lagoon as calm as it stood; the surf
  as it stood, about 0.9 m high where it breaks; stronger glitter (`glitterCeiling` 8). The hard line
  along a breaking wave's top is left for Stage 7's whitewater. (2026-10-31)
- **Half the sun's light in its path** (`config.water.glitter` 0.5), on the sea and on wet sand's film of
  water: the white band narrows by about half. A quarter and an eighth narrowed it more but dulled the
  glare seen from above at a high sun and cut the path short of the shore in `into-the-sun`. (2026-11-12)
- **The capture budget is 10 s a SwiftShader frame**, raised with the user's leave as the shadows, the
  sea and the beach's waves came (2.5, 4, 6, 8, then 10 s), as long as everything stays as cheap as it can.
  (2026-10-30, 10 s 2026-11-13)
- **CI checks, it doesn't measure**: it runs `verify` with `--no-measurements`, every check that can fail
  but none of the views' measurements, which only warn; sessions measure in their own `verify`. Splitting
  the captures across parallel jobs and publishing before the screenshots finish were the alternatives.
  The repo is public, for runners with twice the cores and free minutes. (2026-10-29)

## Open questions

Settle these when the stage that needs them arrives. Ask the user where the answer is a matter of taste or
scope.

- **Low-sun sky, for Stage 11 or 12.** From an outside review: at golden hour the sky away from the sun is
  slate with an olive band; the horizon is 3.7–5 times brighter than the zenith (the haze scatters evenly,
  g 0.2; sea air is nearer 0.7); the haze thins towards sunset, where real evening haze thickens; sunrise
  mirrors sunset.

## Ideas parking lot

Not part of the plan. Build one only if the user asks for it: a passing rain shower, tides, traces of people
(a hammock, an outrigger canoe).
