// All tunables live here as plain data. Keep this file free of browser APIs:
// the Node tools (tools/*.js) import it too.

// Quality presets, picked with ?quality=<name>. Systems read their own fields
// from ctx.quality, so a new system adds its per-preset knobs here.
export const quality = {
  default: 'high',
  // terrainDetail: metres from the camera, across the ground, within which the
  // terrain keeps its finest mesh, 0.25 m quads; each coarser level reaches
  // terrainRatio times as far (config.world.terrain), a ratio over 2 refining
  // the distance: 1 m quads end at terrainDetail x ratio^2. Below
  // leaf x 1.41 / ((ratio - 1) x (1 - morph)), about 16 m at a ratio of 2,
  // seams between levels open (world/lod.js refuses it).
  // groundDetail: a factor on how far from the camera the ground's surfaces
  // show their detail (config.world.terrain's sand, rock and green `range`);
  // surfaceTexture: texels across each of their tiles (textures/surfaces.js).
  // rockPixels: a rock standing out of the ground less than this many pixels
  // of the drawing buffer isn't drawn (world/rocks.js): thinner than about two,
  // it would crawl (CLAUDE.md §8).
  presets: {
    low: { renderScale: 0.67, maxPixelRatio: 1, terrainDetail: 18, terrainRatio: 2, groundDetail: 0.6, surfaceTexture: 512, rockPixels: 3 },
    medium: { renderScale: 0.85, maxPixelRatio: 1.5, terrainDetail: 14.4, terrainRatio: 2.5, groundDetail: 0.8, surfaceTexture: 1024, rockPixels: 2.5 },
    high: { renderScale: 1, maxPixelRatio: 2, terrainDetail: 20.5, terrainRatio: 2.5, groundDetail: 1, surfaceTexture: 1024, rockPixels: 2 },
  },
};

// Depth is reversed and 32-bit float (post/frame.js), so precision is about
// the same fraction of the distance everywhere: a near plane at a leaf's
// distance costs nothing at the horizon.
export const camera = {
  fov: 70, // vertical, degrees; a view may override it
  near: 0.02,
  far: 100000, // beyond the horizon from any hilltop
};

// The output pass (post/output.wgsl). `tonemap` picks one of `tonemaps`
// (?tonemap=<name> overrides it); the numbers are the shader's TONEMAP override.
export const post = {
  exposure: 1, // a factor on the exposure, which follows the light (sky/light.js); ?exposure= overrides it
  // The user's pick (PLAN.md, Decisions): keeps authored colours. agx-punchy's extra
  // saturation pushed strong cyans out of gamut (red clipped to 0, visible contours).
  tonemap: 'neutral',
  tonemaps: { neutral: 1, agx: 2, 'agx-punchy': 3, aces: 4 },
};

// The sky (sky/). The sun's path is solar geometry at an art-directed latitude
// and season (sky/sun.js): the noon sun stands 90 - |latitude - declination|
// degrees up, towards the north for a southern latitude, which is to the right
// of a viewer facing the sunset.
export const sky = {
  sun: {
    latitude: -27, // degrees: 63° at noon, high enough for a tropical noon, low enough to model shapes
    declination: 0, // degrees: equinox, so daylight runs from 6:00 to 18:00
    sunsetYaw: 165, // the view yaw (views.js) that looks into the setting sun: the beach faces it
  },
  // The sun's height in degrees at the named times (sky/sun.js). Sunrise and
  // sunset stand a degree up, so the land still catches the low sun (the user's
  // pick, PLAN.md Decisions); daylight goes on until its centre meets the horizon.
  namedElevations: { sunset: 1, goldenHour: 5 },
  // The haze thins as the sun sinks (sky/light.js hazeAmount): its share with the
  // sun on the horizon, and the sun's height (degrees) from which it is all there.
  haze: { low: 0.3, fullAbove: 25 },
  // The sun's disk once exposed is held softly under this (sky/sky.wgsl), so a
  // low sun keeps its colour instead of clipping to white.
  sunCeiling: 8,
  limbDarkening: 0.6, // the disk's edge at 40% of its centre's brightness
  // The aureole around the sun (sky/sky.wgsl): the sharp forward peak of the haze's
  // scattering, which makes the sun glow a few degrees wide, as the eye sees it.
  aureole: { g: 0.98, strength: 0.012 },
  stepMinutes: 10, // the dev time control (sky/time-control.js): , and . step the time by this much
  // The atmosphere (sky/atmosphere.wgsl). Lengths in km, scattering and
  // absorption per km at sea level; Earth's values after Hillaire 2020, plus a
  // humid marine haze layer that softens the horizon and warms the low sun.
  atmosphere: {
    groundRadius: 6360,
    topRadius: 6460,
    rayleighScattering: [5.802e-3, 13.558e-3, 33.1e-3],
    rayleighHeight: 8,
    mieScattering: 3.996e-3,
    mieAbsorption: 0.444e-3,
    mieHeight: 1.2,
    // Haze: dense near the sea and thin above, so it softens the horizon and
    // reddens the low sun without greying the sky overhead.
    hazeScattering: 0.2, // and absorption: at 550 nm
    hazeAbsorption: 0.002,
    hazeAngstrom: 1, // how much more it scatters blue than red: the horizon pale blue, not grey
    hazeHeight: 0.15,
    mieG: 0.8,
    hazeG: 0.2, // scatters more evenly than the aerosols above, so seen side-on it reads bright, not grey
    ozoneAbsorption: [0.65e-3, 1.881e-3, 0.085e-3],
    groundAlbedo: [0.08, 0.1, 0.12], // mostly sea, seen from the sky
    sunIlluminance: [1, 1, 1], // linear sRGB, above the atmosphere; the unit of all light
    sunRadius: 0.2678, // degrees, the disk's angular radius
    wavelengths: [680, 550, 440], // nm: the red, green and blue the scattering above is given for
  },
  // Lookup table sizes (sky/atmosphere.js).
  tables: { transmittance: [256, 64], multiscatter: [32, 32], skyView: [192, 108], aerial: [32, 32, 32], sunlight: [64, 1] },
  // Ray-march steps and sample counts of the tables (sky/*.wgsl). They run only
  // when the time or the camera's height changes, never per frame.
  samples: {
    transmittance: 40,
    multiscatter: { directions: 8, steps: 20 }, // directions per side of a grid over the sphere
    skyView: 48,
    aerial: 16,
    probe: { azimuths: 32, rings: 16, steps: 16 },
    sunlight: 64,
  },
  aerialRange: 64, // km: the aerial-perspective table reaches past the horizon from any view
  // km: the sunlight table (sky/atmosphere.js) holds the sun's light up to this
  // height above the sea, which no lit surface on the island comes near.
  sunlightTop: 2,
  // The camera height the sky is drawn for moves in these steps (metres): the sky
  // follows the camera's height, but no faster than this. In the game it moves
  // only once the camera is more than heightSlack from it (metres), so walking
  // along a slope or bobbing across a step doesn't draw the tables every time;
  // a capture draws them for the step nearest the camera, as a fresh load does.
  heightStep: 1,
  heightSlack: 0.75,
  // Exposure follows the light: key / E^compensation, where E is the illuminance
  // (sky/light.js) in units of the sun above the atmosphere. 1 would make every
  // hour as bright as noon, 0 leave sunset dark. The user's pick (PLAN.md,
  // Decisions): 0.3, so a low sun stays darker and keeps its deep orange; 0.5
  // washed the sunset out. The key keeps noon's exposure as 0.5 had it.
  exposure: { key: 4.47, compensation: 0.3 },
};

// The island's shape (world/island.js). Metres. The cove's beach is the origin;
// positions in the cove are [along, out]: along the beach towards the headland,
// and out to sea, which is towards the setting sun. Ridges are lists of
// [along, out, height] points.
export const world = {
  island: {
    // From the cove's beach to the far coast. Performance decides the final size
    // (PLAN.md, Decisions); nothing in the cove changes with it. world.terrain's
    // grids follow it, their samples (and boot's time) as its area.
    size: 2000,
    minSize: 1600, // smaller, and the far coast cuts into the hills behind the cove
    cove: {
      radius: 520, // nothing within this of the beach depends on the size
      blend: 300, // the band beyond it where the rest of the island takes over
      headlandSide: -1, // -1: the headland is on the left of someone facing the sea, 1: on the right
      bay: { radius: [130, 185], blend: 90 }, // the beach's arc: its radius towards the headland and the far side
      // The land the bay is cut into: it reaches `out` to sea (on the headland's
      // side, on the far side), and between `from` and `to` along the coast falls
      // back to the island's coast, which curves back with `radius`.
      front: { out: [190, 105], from: 140, to: 380, radius: 800 },
      corner: 25, // how round the bay's corners are
      // Promontories either side of the bay, as chains of [along, out, radius].
      // `sheer`: its face towards the bay and its tip stay a sheer cliff (along
      // the beach up to the first), its outer shore as sheer as the coast has it
      // (shore.rocky) beyond the second.
      headland: { path: [[265, -150, 100], [240, 40, 75], [232, 140, 58], [205, 235, 40]], blend: 30, sheer: [215, 260] },
      point: { path: [[-165, 20, 70], [-180, 120, 45]], blend: 25 }, // the low point opposite
      // Where the beach gives way to rock round the headland: towards it between
      // `headland` metres along, in front of `back` metres out (rock in front of
      // the first, sand again behind the second, along the headland's outer
      // shore), and within `fade` metres of it all round.
      sand: { headland: [90, 220], back: [-150, -300], fade: 90 },
    },
    coast: {
      // The shore's wiggles: in the bay, and either side of it, where they also swing
      // slowly; they change from the one to the other between `outerFrom` metres along.
      cove: { amplitude: 2.5, outer: 10, swing: 25, wavelength: 70, outerFrom: [150, 400] },
      island: { amplitude: 10, swing: 45, wavelength: 380 }, // and around the rest of the island, larger
      // The island: a main lobe behind the cove, its front `front` out at the cove,
      // `width` x size across, and `count` more, seeded, reaching out from it.
      lobes: { front: -20, width: 0.9, count: 3, spread: 115, reach: [0.3, 0.48], radius: [0.32, 0.56] },
      lobeBlend: 120,
    },
    hills: {
      summit: [100, -650, 285], // the peak behind the cove (PLAN.md, Decisions: 250–300 m)
      summitRound: 40,
      // The volcano's profile: shares of the summit's height that fall away by e
      // over these distances, a steep cone on a broad shield.
      profile: [[0.6, 220], [0.4, 900]],
      // Lower summits on the other lobes: shares of the main one's height, their profile, valleys around them.
      peaks: { share: [0.5, 0.75], profile: [[0.55, 180], [0.45, 500]], valleys: 6 },
      // Valleys radiating from each summit: `count` around the main one, twice as
      // many beyond each `branch` band (metres from the top), `length` long, cutting
      // up to `depth` of the height between `from` and `full` metres out; `saturate`
      // sets how broad they are. The cove's valley, `width` degrees wide, cuts deeper.
      // `round`: the ridges between them rounded on top, and their floors into
      // their sides, over this much of their noise, tens of metres.
      valleys: {
        count: 7,
        branch: [[220, 420], [550, 900]],
        length: 700,
        depth: 0.6,
        saturate: 0.6,
        round: 0.1,
        from: 60,
        full: 300,
        cove: { width: 11, depth: 0.7 },
      },
      ridges: [
        [[100, -650, 285], [215, -430, 195], [245, -220, 130], [215, -20, 95], [205, 120, 70], [200, 215, 40]], // down to the headland
        [[100, -650, 285], [-110, -580, 225], [-250, -420, 160], [-290, -200, 85], [-230, -30, 30]], // the valley's far side
      ],
      crestRadius: 12, // ridges are rounded this much on top
      flankSlope: 1.15, // steepest slope of a ridge's flanks, unless its width is held between these
      width: [12, 120],
      join: 30, // how smoothly the ridges merge into the volcanoes
      bend: 2, // metres: where a ridge's segments cross, as at the inside of a bend, the corner between them is rounded within this of each other
      warp: { amplitude: 40, wavelength: 420 }, // bends the ridgelines
      detail: { share: 0.035, base: 0.8, wavelength: 90, octaves: 4 },
      creases: { share: 0.06, wavelength: 50, round: 4 }, // folds every way, `share` of the height deep, their floors rounded over `round` metres
      // Gullies the rain has cut straight down the slopes, sharp V-shaped
      // grooves `spacing` metres apart, `depth` of the height deep at most,
      // `sharp` the higher the narrower, wandering over about `length` down the
      // slope: on a volcano radiating from its top (from `from` metres out, full
      // by `full`, twice as many beyond each of its valleys' branch bands), on a
      // ridge down either flank. Their floors are rounded over `round` metres,
      // two of world.terrain's samples: an edge would read as one in the ground.
      gullies: { spacing: 38, depth: 0.1, sharp: 3, round: 4, length: 140, from: 120, full: 260 },
    },
    // The ground's roughness over all the land, from `from` metres inland (the
    // beach by the water stays smooth): up to `base` metres, over `wavelength`
    // metres and `octaves` more below it, each `gain` as high as the last, down
    // to 8 m: four of world.terrain's 2 m samples, the least that draws one.
    // Rough as ground is: `flat` of it on flat ground (plains, valley floors),
    // all of it where the land's shape (its volcanoes' and ridges' slopes) is
    // as steep as `steep` (rise over run), and in stretches of about
    // `patches.wavelength` metres between `patches.range` of that; but with
    // room only down to `floor` metres above the sea, so low ground by the
    // shore lies smoother and above the waves. Added once the shore and the
    // hills have met, so the hills fading out towards the shore don't thin it out.
    roughness: { base: 3.6, wavelength: 32, octaves: 2, gain: 0.8, from: [25, 45], flat: 0.4, steep: [0.05, 0.3], patches: { range: [0.5, 1.4], wavelength: 300 }, floor: 1.6 },
    shore: {
      // A beach rises over its berm to a gentle plain; a rocky shore steeply.
      // A beach: its berm, then a plain rising `plain` metres over about
      // `plainReach`. Beyond the cove (`island`) the berm stands higher, a ridge
      // the storms have built where the green begins, and the plain behind it
      // a few metres above the sea, as coastal flats are.
      // Beyond the cove the flat behind a beach is old beach
      // ridges, `ridges` metres high, parallel to the shore from `from` metres
      // inland and gone by between `to`, spacing[0] apart there and further
      // apart further in, spacing[1] by the furthest `to`; and hummocks of
      // `hummocks` [metres, wavelength] over it.
      beach: {
        berm: 1.7, bermWidth: 20, plainFrom: 35, plain: 6, plainReach: 150, shelfSlope: 0.07, hillReach: 160,
        island: { berm: 2.8, bermWidth: 14, plain: 9, ridges: 1.3, spacing: [26, 48], from: 28, to: [140, 260], hummocks: [1.5, 70] },
      },
      // A rocky shore: a wall the waves have cut, between `wall` metres high,
      // rising over about `wallWidth`, then a gentler rise of `rise` over about
      // `reach`; the hills come down to it over between `hillReach` metres:
      // sheer where that is short, in steep slopes the green holds onto where it
      // is long. Both change along the coast over about `wavelength`, the wall
      // tallest where the shore is sheerest. In the cove the wall stays low and
      // the hills make the cliffs; beyond it a cape's (`island`) is a wall of
      // its own, the hills further back.
      rocky: {
        wall: [2.5, 2.5], wallWidth: 4, rise: 20, reach: 80, shelfSlope: 0.35, hillReach: [18, 110], wavelength: 130,
        island: { wall: [8, 16], rise: 6, hillReach: [50, 90] },
      },
      hillJoin: 6,
      undulation: { amplitude: 1.2, wavelength: 140, from: [30, 120] }, // a slow swell on the beach's plain, between these metres inland
      // Beyond the cove a beach's plain lies flat for between `flat` metres,
      // changing over about `wavelength` metres along the coast: here the slopes
      // come down close behind the sand, there a broad flat lies before them, as
      // on high tropical islands. Then the hills rise over `ramp` metres, taller
      // ones further, no steeper than `slope` (rise over run), but over no more
      // than `reach`, so the peaks behind keep their height; easing between
      // these over `ease` metres, so the slope never turns at once.
      plain: { flat: [0, 160], wavelength: 600, ramp: 110, slope: 0.45, reach: 220, ease: 40 },
      // Beyond the cove the hills' rise from any shore is no steeper than this
      // (rise over run, 35°), tall ones further in than plain.reach if need be,
      // and from a rocky one over its hillReach where that is gentler: with
      // the hills' own slopes on top, no cliffs behind the beaches (40°
      // left some on 5 of seeds 1-20), and green slopes above the capes' walls.
      steepest: 0.7,
      // Beyond the cove the coast is beach but for `count` rocky capes, where it
      // juts out furthest (its curvature over `scale` metres, found along `rays`
      // rays from the island's middle), at least `spacing` metres from each other
      // and from the headland's root: exposed points the waves keep bare. Each is
      // `length` metres of coast, giving way to sand over `fade`.
      capes: { count: 1, length: [300, 450], fade: 120, scale: 250, spacing: 1000, rays: 180 },
      bayScale: 150, // metres over which the coast's curvature (bayness) is measured, for the zones' widths
    },
    seabed: {
      lagoon: { depth: 3.4, swing: 1, wavelength: 160 },
      reef: {
        // The crest across the cove: `out` from the beach (PLAN.md, Decisions:
        // 200–300 m), curving back with `radius`. Around the rest of the island it
        // keeps mean ± swing from the coast.
        cove: { out: 265, radius: 520 },
        island: { mean: 230, swing: 120, wavelength: 600 },
        // No reef grows on a perfect arc: its crest wanders this far either way over
        // about this length, and with it the reef's width.
        wander: [8, 110],
        crest: 0.35, // depth of the crest, where the surf breaks
        crestBlend: 2, // metres either side of the crest over which the lagoon's side and the drop-off meet
        flat: 0.9, // and of the reef flat behind it
        flatWidth: 25,
        backSlope: 0.15, // the back of the reef, down to the lagoon floor
        roughness: [0.25, 9], // the crest's and the flat's: metres up and down, wavelength
        // The drop-off seaward of the crest, with spur-and-groove ridges across it:
        // grooves [height, wavelength], from the crest out to between `groovesEnd` metres.
        fore: { drop: 22, dropWidth: 25, slope: 0.11, grooves: [1.5, 14], groovesEnd: [60, 160] },
      },
      // Through the reef, wider towards the sea, its walls `ragged` [metres, wavelength].
      pass: { from: [-80, 200], to: [-110, 340], halfWidth: [20, 30], depth: [6, 12], wall: 0.5, ragged: [4, 25] },
      // From the bay to the pass, deepening and widening along the way.
      channel: { path: [[-10, 80], [-45, 112], [-48, 150], [-72, 180], [-88, 210]], halfWidth: [7, 18], depth: [3.8, 6.5], wall: 0.3 },
      bend: { amplitude: 12, wavelength: 70 }, // how far the pass's and the channel's walls wander
      // Coral heads in the lagoon: from `from` m offshore to `clear` m inside the reef's crest.
      bommies: { cell: 28, chance: 0.35, radius: [4, 9], top: [0.8, 1.8], from: 45, clear: 50 },
      minDepth: 0.3, // nothing out in the water comes closer to the surface
      outerMargin: 300, // past the reef's crest, the seabed is deep beyond this
    },
    // Placement zones (world/island.js ZONES) and the ground they stand on.
    // Widths in metres inland; on rocky shores the shore's band is rock. No band
    // keeps one width: as behind real beaches, each swings along the coast with
    // a slow noise over `wavelength`, its edge frays, beyond the cove the
    // coast's shape has its say, and the land ends the palm belt.
    zones: {
      // Degrees: over these slopes ground turns to rock, and sand slides off,
      // leaving rock (sand holds to about 34°, its angle of repose).
      rockSlope: [50, 60],
      sandSlope: [31, 37],
      // A rocky shore is bare rock where it is steeper than these degrees, where
      // the waves and their spray reach, up to between `splash` metres above the
      // sea, and at the foot of a sheer cliff, as far as the hills have risen
      // less than between `talus` metres; elsewhere the green comes down to the
      // cliff's edge.
      cliffSlope: [46, 60],
      splash: [3, 6],
      talus: [8, 18],
      // Metres above the sea: below it the waves keep the sand wet. The reef
      // breaks the swell, so the lagoon's waves run only a little way up the beach.
      wetSand: 0.35,
      // The band along the shore, sand or rock: `width` give or take `swing` (in
      // the cove, beyond it), and beyond the cove wider in bays, where the waves
      // leave their sand, and narrower on points, by `bay` metres per unit of the
      // coast's curvature (per km, held to ±2); never under `min`.
      // Each band's inland edge frays by `ragged` [metres, wavelength along the coast].
      shore: { width: 32, swing: [7, 14], bay: 6, min: 10, ragged: [5, 45] },
      // The strand and the beach scrub behind it, wider on exposed points, where
      // salt spray keeps trees back, and thin in sheltered bays.
      scrub: { width: 10, swing: 7, bay: 4, min: 2, ragged: [3, 30] },
      // The palm belt holds the low ground behind the scrub: as wide as given
      // where the land stays level, so it covers the coastal flats (shore.plain)
      // and reaches up valley floors, half as wide where the hills have risen
      // `rise` metres above the shore's plain, a third at twice that: the
      // jungle comes down the spurs and the slopes close behind a beach.
      palmBelt: { width: 100, swing: 35, min: 8, rise: 4, ragged: [20, 100] },
      edge: 3, // metres either side of the shore's band's end over which sand gives way to green
      sandy: 25, // metres inland of a beach's band over which the soil turns from its sand to soil
      // How lush the green is, 0 open to 1 lush (world/island.js lushOf): per
      // band at the scrub, the palm belt and the jungle; less by `relief` for
      // each metre the ground stands above the ground within `radius` m round
      // it (more where it lies below); give or take `patches` over about
      // `wavelength` m.
      lush: { bands: [0.1, 0.35, 0.7], radius: 20, relief: 0.1, patches: 0.3, wavelength: 260 },
      wavelength: 250, // long enough that the zones' edges move slower than the shore falls behind
      // The reef zone runs from this far inside the crest out to where it is
      // deeper than reefDeep: a pass, or the drop-off a few metres outside the crest.
      reefBack: 60,
      reefDeep: 3,
    },
  },
  // The island as drawn (world/heightmap.js, world/terrain.js).
  terrain: {
    // Two grids of heights in the cove's frame, finest first, `texel` metres
    // apart and laid out for each island (world/heightmap.js layoutLevel): the
    // coarse one out to where the sea is deep all round, and inside it the
    // fine one over all the ground higher than `depth` metres under the sea,
    // the land and the sea you can see into, the cove no different from the
    // rest (PLAN.md, Decisions; tests/heightmap.test.js).
    levels: [{ texel: 2, depth: 20 }, { texel: 8 }],
    blend: 16, // samples over which the fine grid fades into the coarse one at its edge, out in the deep
    // Levels of mipmaps of each grid's textures, each half the last exactly:
    // the grids are laid out a multiple of 2^(mips - 1) samples across
    // (heightmap.js gridAlign). The last one's texels are 256 samples across,
    // 512 m on the fine grid: only a pixel at the horizon spans more, and reads
    // it a little sharp.
    mips: 9,
    // The level-of-detail mesh: a quadtree over the coarsest grid. Its smallest
    // nodes are `leaf` metres across, with `grid` x `grid` quads; each level up
    // doubles both. A node splits within quality.terrainDetail x
    // quality.terrainRatio^level metres of the camera, and morphs into its parent
    // over the last `morph` of the band between its range and the finer level's.
    // Its quads near the camera are a quarter of a metre: the ground between
    // the grid's samples is a curve (world/heightmap.js), and a flat triangle
    // a metre across would turn a tight bend of it into a corner.
    leaf: 8,
    grid: 32,
    morph: 0.3,
    rowsPerTask: 32, // rows of a grid per job of the workers that build it
    maxWorkers: 8,
    // The ground's albedos, linear: what each surface reflects on average. The
    // terrain draws them as plain colours until its surfaces (PLAN.md Stage 4),
    // which keep to them on average, and they light shade from below
    // (world/albedo.js). Measured: white coral sand about 0.5–0.65, golden
    // quartz sand 0.35–0.45, wet sand half of dry; fresh basalt 0.05–0.1,
    // weathered volcanic rock 0.15–0.2; grass green-peaked at 0.15–0.25 (red
    // and blue about 0.05), a forest's leaves at about 0.1; dry soil 0.15–0.35,
    // leaf litter 0.1–0.2.
    albedo: {
      // The user's pick (PLAN.md, Decisions): bright white sand, at the top of
      // what coral sand measures; at 0.55 it read grey, golden sand tan.
      drySand: [0.72, 0.64, 0.5],
      wetSand: [0.36, 0.28, 0.17], // darker, warmer and more saturated
      rock: [0.055, 0.052, 0.05], // the user's pick (PLAN.md, Decisions): dark basalt
      // Inland (chunks/green.wgsl): the living green, grasses and herbs on open
      // ground and the leafy understory on lush; the bare ground, sand behind
      // the beach, then soil, and dead leaves further in. With the shares in
      // `green`, the user's pick (PLAN.md, Decisions): lush tropical.
      grass: [0.085, 0.19, 0.038],
      leafy: [0.02, 0.078, 0.017],
      soil: [0.3, 0.24, 0.16],
      litter: [0.09, 0.06, 0.035],
    },
    // Metres: the light from below comes from the ground's albedo averaged over
    // about this far around (chunks/lighting.wgsl groundAlbedo).
    bounceReach: 24,
    // Sand (chunks/sand.wgsl, textures/sand.js). Lengths in metres.
    sand: {
      grain: { tile: 1 },
      // Wind ripples: about this far apart and this high (a ripple index of about 17).
      ripples: { tile: 8, wavelength: 0.105, height: 0.006, strength: 0.8 },
      // The wind that piles them blows this many degrees to the right of
      // straight out to sea: the trades, from behind the island.
      wind: 25,
      // How wet the ground is by the height above the sea (chunks/wet.wgsl,
      // rock's too): under a film below `film`, half wet at zones.wetSand
      // (the wet sand's zone), dry above `dry`.
      wetness: { film: 0.2, dry: 0.7 },
      // Damp sand is all but matte; only a film of water mirrors.
      roughness: { dry: 0.9, wet: 0.75, film: 0.07 },
      // Metres from the camera within which sand shows its detail; beyond, its
      // albedo alone, drawn by a cheaper shader (world/terrain.js).
      range: 120,
    },
    // Rock (chunks/rock.wgsl, textures/rock.js). Lengths in metres.
    rock: {
      // The detail tile, and its second, finer read as a share of it.
      tile: 4,
      detail: 0.19,
      // Blocks between cracks: their size, how regular (0 to 1), the cracks'
      // width, and the edges' bevel; how round the edges (0 a chamfer, 1
      // round), how tilted the faces, how proud or sunk the blocks (of the
      // bevel), and the share of joints that gape as cracks. Basalt cools
      // into fairly regular, sharp-edged blocks.
      blocks: { size: 0.9, regular: 0.6, crack: 0.012, bevel: 0.03 },
      shape: { rounding: 0.15, tilt: 0.15, proud: 0.6, gapes: 0.5 },
      // The faces: their roughness, pits (size, share of cells with one,
      // depth): the gas bubbles frozen in lava.
      face: { roughness: 0.04, pitSize: 0.012, pits: 0.45, pitDepth: 0.008 },
      // Two minerals: crystal size, the second's share and brightness, the
      // speckle's contrast; each one's colour factor. Pale feldspar in the
      // dark groundmass.
      minerals: { size: 0.015, share: 0.08, brightness: 2.2, speckle: 0.15, tints: [[1, 1, 1], [1.1, 1.05, 0.95]] },
      // Relief in 3D: the largest scale, its height as a share of it, how
      // sharp its crests (0 to 1), stretched along the vertical (below 1).
      relief: { scale: 12, height: 0.22, sharp: 0.8, stretch: 0.5 },
      tone: 0.2, // how much the albedo follows the relief
      // Colour factors: streaks of salt and rust down steep faces, layers of
      // lava flows across them. Lichen (albedos) covers `cover` of what faces
      // up, `share` of it the second kind: a little, as the user picked bare
      // basalt over lichened rock (PLAN.md, Decisions).
      streaks: { colour: [1.2, 1, 0.85], strength: 0.35 },
      strata: { spacing: 4, tone: 0.2, ledges: 0.08 },
      lichen: { colour: [0.16, 0.16, 0.14], cover: 0.03, second: [0.25, 0.16, 0.07], share: 0.15 },
      // Rock is as wet as the ground (chunks/wet.wgsl), its crests up to
      // `ragged` drier and its hollows wetter, and darkens by `dark` wet; a
      // band from `band` m above the sea where spray keeps algae alive,
      // darkened by `bandDark`, its edges `bandRagged` m ragged.
      wet: { ragged: 0.4, dark: 0.6, band: [0.6, 2], bandDark: 0.8, bandRagged: 0.6 },
      roughness: { dry: 0.8, wet: 0.35 },
      // Metres from the camera within which rock shows its detail tile and
      // lichen; beyond, its relief alone, drawn by a cheaper shader
      // (world/terrain.js).
      range: 200,
    },
    // The green inland (chunks/green.wgsl): the ground that is neither sand
    // nor rock. Shares at the scrub, the palm belt and the jungle
    // (world/island.js's bands): of the ground that is green, on open and on
    // lush ground (island.js lushOf); and of the bare ground that is litter
    // rather than soil, or sand behind a beach (island.js groundOf's sandy).
    // Lengths in metres.
    green: {
      cover: { open: [0.45, 0.85, 0.92], lush: [0.55, 0.85, 0.95] },
      litter: [0.1, 0.6, 0.9],
      // Over about `wavelength` m the green turns drier (+) or deeper (-), its
      // colour's factor changing by `change` per unit.
      tone: { change: [0.1, 0.03, -0.12], wavelength: 160 },
      // Patches of green and bare about `size` across, their edges from soft (0) to sharp (1).
      patches: { size: 4, sharp: 0.5 },
      // Clumps about `size` across, lighter or darker by `strength` (a deviation).
      clumps: { size: 0.5, strength: 0.07 },
      // How much the green hides the bare ground between it when seen at a
      // slant: 0 not at all (flat), 1 as a layer of leaves would.
      stand: 0.4,
      // The detail tiles (textures/green.js): the grass's and the litter's,
      // and how much larger the soil's crumbs are than the sand's grains.
      tiles: { grass: 0.6, litter: 1.5, crumbs: 2.5 },
      straw: [3.2, 1.4, 3], // a dry blade's colour factor
      depths: 0.35, // the sward's depths between the blades: their colour's factor
      leaves: { light: [1.45, 1.4, 1.3], dark: [0.55, 0.55, 0.6] }, // a leaf's colour factor at its lightest tone and its darkest
      // Metres from the camera within which the green shows its detail;
      // beyond, its patches and albedo alone, drawn by a cheaper shader
      // (world/terrain.js).
      range: 70,
    },
  },
  // Rocks and boulders (world/rocks.js, rock-placement.js, rock-shapes.js).
  rocks: {
    // The cove's: within this of its beach (m). Beyond it, Stage 17's.
    reach: 520,
    // A rock standing out of the ground less than quality.rockPixels pixels
    // isn't drawn; it sinks into the ground as it shrinks from `fade` times
    // that to it, so it doesn't pop.
    fade: 2,
    show: 0.3, // a rock whose top would stand less than this share of its height above the ground isn't placed
    // Degrees: a facet that leans out over the ground further than this past
    // square to it (its normal more than 90° plus this from the ground's) is
    // underside, which placement buries; the others are sides.
    overhang: 15,
    step: 0.25, // m: how far apart placement tries the underside against the ground; rough ground bends between the finest grid's samples
    // How far the terrain's mesh may stray from its finest height, for a share
    // of the distance: rocks move with it, and are culled with that much room.
    stray: 0.03,
    // The prototypes every rock is one of (world/rock-shapes.js), made at a
    // block's half-length or a column's radius of 1: lengths are in those
    // units unless said otherwise. [a, b] ranges; counts are inclusive.
    shapes: {
      maxVertices: 200, // per prototype (each facet has its own): each is drawn thousands of times
      // A cut that would leave an edge shorter than minEdge, a facet narrower
      // than minWidth or a corner flatter than maxAngle degrees is drawn
      // again: no slivers to shimmer.
      minEdge: 0.03,
      minWidth: 0.04,
      maxAngle: 170,
      // Blocks: prisms round an ellipse on a level bottom, width and height
      // over length; `sides` round it, spaced unevenly by `jitter` of their
      // spacing, moved in or out by `offset`, leaning out over its foot (-)
      // or in (+) by `lean` degrees: mostly in, so a block sunk in the ground
      // doesn't overhang it (rock-placement.js); the top tilted up to
      // `topTilt`. Then `fractures` across its upper edges, their faces
      // looking `fractureElevation` degrees above level, each taking
      // `fractureDepth` of its extent that way.
      blocks: { count: 8, width: [0.5, 0.9], height: [0.25, 0.65], sides: [5, 6], jitter: 0.4, offset: 0.15, lean: [-6, 22], topTilt: 25, fractures: [2, 3], fractureElevation: [15, 65], fractureDepth: [0.15, 0.4] },
      // Fallen columns: five or six uneven sides, `length` over width, ends
      // slanting `endTilt` degrees from square; `breaks` more cuts step an
      // end, `breakTilt` degrees off the axis, `breakDepth` of the width deep.
      columns: { count: 4, sides: [5, 6], length: [1.5, 3.5], jitter: 0.25, offset: 0.12, endTilt: [8, 35], breaks: [0, 2], breakTilt: [30, 60], breakDepth: [0.15, 0.4] },
      // Chips off corners and the ends of edges: `depth` deep, the facet they
      // leave no wider than `span`, lopsided by `skew` (faces weighted 1 ± skew);
      // `edgeChance` of them off an edge's end, tapering out over `taper` degrees.
      chips: { count: [5, 9], depth: [0.06, 0.16], span: 0.4, skew: 0.5, edgeChance: 0.5, taper: [10, 35] },
    },
    // Each kind is scattered by a rule (world/scatter.js): a candidate in
    // `chance` of the cells `cell` m apart, kept where the ground meets `where`
    // (sand and rock shares, height above the sea in m, slope in degrees, and
    // m inland from the coast: a rocky shore's foot lies within a few metres
    // out, and the reef's crest, as shallow, far beyond).
    // Sizes: the horizontal half-width, from size[0] to size[1] m, `tail`
    // raising how many are small; `columns`: the share that are fallen basalt
    // columns rather than blocks. Each is tipped up to `tip` degrees, leans
    // `lean` of the way to the ground's slope, and sinks `sink` of its height
    // below where the ground first covers its underside. Rocks keep clear of
    // each other, so the kinds placed first, the largest, claim their ground.
    kinds: {
      foot: { cell: 9, chance: 0.4, where: { rock: [0.6, 1], height: [-1, 6], slope: [0, 50], coast: [-8, 1000] }, size: [1.2, 3.5], tail: 1.5, columns: 0.4, tip: 20, lean: 0.5, sink: 0.3 },
      crags: { cell: 6, chance: 0.18, where: { rock: [0.6, 1], height: [6, 1000], slope: [30, 55] }, size: [0.8, 2.5], tail: 1.5, columns: 0.2, tip: 10, lean: 0.8, sink: 0.5 },
      shore: { cell: 2.5, chance: 0.5, where: { rock: [0.5, 1], height: [-1.5, 4], slope: [0, 40], coast: [-8, 1000] }, size: [0.2, 1.8], tail: 2.5, columns: 0.25, tip: 15, lean: 0.6, sink: 0.22 },
      beach: { cell: 5, chance: 0.25, where: { sand: [0.3, 0.95], rock: [0.05, 0.7], height: [-0.5, 3], coast: [-8, 1000] }, size: [0.15, 0.9], tail: 2, columns: 0.1, tip: 15, lean: 0.7, sink: 0.35 },
      inland: { cell: 10, chance: 0.06, where: { sand: [0, 0.2], rock: [0, 0.3], height: [2, 1000], slope: [0, 35] }, size: [0.2, 0.9], tail: 2.5, columns: 0, tip: 20, lean: 0.8, sink: 0.45 },
    },
  },
};

// The frame readout (core/readout.js) and the benchmark (core/benchmark.js, ?bench=1).
export const readout = {
  key: 'F3',
  refreshSeconds: 0.5, // how often the numbers change: readable, and averaged over that time
};
export const bench = {
  warmupSeconds: 1, // per view, not measured: shaders compile, the frame rate settles
  warmupFrames: 10, // and at least this many frames, so one long hitch can't end the warmup
  seconds: 5, // measured per view
};

export const movement = {
  flySpeed: 16, // m/s
  minFlySpeed: 0.5,
  maxFlySpeed: 200,
  wheelSpeedStep: 1.2, // speed multiplier per mouse-wheel notch
  lookSensitivity: 0.0022, // radians per mouse pixel
  maxPitch: 89, // degrees
  // Rough walking (core/input.js), to judge the cove's scale on foot until Stage 14:
  // the key that toggles it, m/s, Shift's factor, the eye's height over the
  // ground, and over the sea where it is deeper than that.
  walk: { key: 'KeyG', speed: 1.4, run: 3, eye: 1.7, float: 0.4 },
};

// Used when a URL param and the active view leave a value unset.
export const defaults = {
  view: 'beach',
  seed: '1',
  timeOfDay: 10, // hours of daylight, or a named time (sky/sun.js)
  t: 0, // simulation start time, seconds
};

export const capture = {
  // Frames rendered at the frozen time before the app signals ready, and again
  // for every extra frame the tool asks for. Raise it only for an effect that
  // builds up over frames: each frame costs ~0.4 s on SwiftShader.
  warmupFrames: 1,
  // tools/screenshot.js warns when an extra frame of a view (rendering and
  // reading it back) takes longer. Captures must stay quick on SwiftShader, the
  // one renderer every machine has, and each view renders about ten frames.
  // Raised from 1000 when the ground got its surfaces (Stage 4), with the
  // user's leave: SwiftShader runs every line of a shader at every pixel.
  // 2500 since rock (Stage 4.4): where it meets the beach, a pixel runs both
  // surfaces' detail.
  frameBudgetMs: 2500,
  // What the screenshot tool measures per view (tools/measure.js).
  motion: { frames: 6, stepSeconds: 0.5, threshold: 4 }, // strip at t, t + 0.5 s, ...; threshold in 8-bit levels
  // Frames panned by stepPixels at the centre; see shimmer() in tools/image.js.
  // edge: local contrast (levels) that makes a pixel an edge pixel; edgeLimitPercent: the
  // share of edge pixels the silhouette fixture may have shimmering.
  shimmer: { frames: 5, stepPixels: 0.25, threshold: 24, ratio: 0.5, fullRatio: 0.7, edge: 48, limitPercent: 0.5, edgeLimitPercent: 5 },
  crop: { width: 300, height: 168, zoom: 4 }, // source pixels, shown at zoom x
  // edge: levels off the local mean that count as a real edge (drawn flat grey);
  // limitPercent: the share of a view, or of the gradient fixture, in bands (tools/image.js bandedShare).
  banding: { radius: 6, gain: 32, edge: 6, limitPercent: 1 },
  // The blend fixture, in 8-bit levels: how far a translucent card may land from its
  // reference mixed in linear light (post/frame.js; blending in the compressed HDR
  // target misses by 68, linear blending by 0.2), and how far the cards must differ
  // from the light behind them for the check to measure anything.
  blend: { limitLevels: 2, minContrastLevels: 20 },
  // The maths fixture (src/fixtures/maths.js): how far the GPU's SH values may land
  // from sky/light.js's (relative), and the tables' mappings from inverting (texels).
  // A wrong formula misses by whole texels; the GPUs' approximate sin and asin cost
  // up to 0.08 near the zenith on SwiftShader, and cost 0.28 at the horizon before
  // the mappings measured angles from it (chunks/angles.wgsl).
  maths: { valueTolerance: 1e-4, texelTolerance: 0.1 },
  // The light fixture (src/fixtures/light.js), in 8-bit levels on a white sphere's
  // lit side: how far its channels may spread at midday (neutral), and how much
  // redder than blue it must be at golden hour (warm). And how much brighter at
  // midday a white sphere's shaded underside must be over sand than over sea.
  light: { neutralLevels: 10, warmLevels: 80, bounceRatio: 1.5 },
  // The haze fixture (src/fixtures/haze.js), in 8-bit levels: how far the sky's
  // tables may land from direct marches through the same air. The sky's light as
  // SH misses the bright band along the horizon by up to 5 levels on a white
  // surface at golden hour; the tables miss by 1 to 4 levels.
  haze: { limitLevels: 6 },
  // The terrain fixture (src/fixtures/terrain.js), in metres: how far the GPU's
  // heights may land from world/heightmap.js's (floats on the GPU, doubles in JS),
  // and the deliberate mistake, half a metre off, that the check has to catch.
  // And how far the drawn ground may stray from world/island.js between samples,
  // as a median per level and a share of its spacing: bilinear misses about
  // 0.005 of it on curved ground, a grid shifted half a sample 0.1 and more.
  // `ground`: how far the GPU's ground may land from heightmap.js's, for the
  // shares of sand and rock, how lush and how sandy (`cover`), the band, and the reef's offset in metres: the
  // GPU's filtering and its half floats. Half floats, as maths/half-float.js makes them, hold
  // the reef's ±250 m to 0.12 m, and a GPU may filter with coarse weights: 0.15 m
  // on one D3D11 GPU. `bounce`: how far the ground's albedo the light from
  // below reads on the GPU may land from JS's, per channel: half floats and
  // filter weights cost 0.001 on one D3D11 GPU, 0.0003 on SwiftShader; the
  // map read half a texel off misses by 0.1. `far`: the ground read `lod`
  // levels of mips up, as a pixel 256 m across reads the fine grid, within
  // `band` and `reef` (metres) of the mips made in JS: wider, as neighbouring
  // texels there differ by metres of reef and whole bands, which a GPU's
  // coarse filter weights and seven levels of half floats rounded its own way
  // carry into the result.
  terrain: { limit: 0.002, offset: 0.5, islandMedian: 0.04, ground: { cover: 0.01, band: 0.005, reef: 0.25 }, mesh: 0.01, bounce: 0.01, far: { lod: 7, band: 0.05, reef: 2 } },
  // The surfaces fixture (src/fixtures/surfaces.js): a tile made again shifted
  // by a whole tile may change this share of its texels by more than `levels`
  // (the odd texel on a cell's edge flips by rounding); shifted by half a tile,
  // a deliberate mistake, it must change more than `mistaken` of them. `tiles`:
  // the tiles it checks.
  surfaces: { levels: 2, share: 0.01, mistaken: 0.3, tiles: ['grain', 'ripples', 'rock', 'grass', 'litter'] },
  // The patches fixture (src/fixtures/patches.js): how far the GPU's patches
  // (0 to 1) may land from world/green.js's (floats and an approximate exp on
  // the GPU); points shifted a tenth of a patch, a mistake, must land further.
  patches: { limit: 0.002 },
  // The rocks fixture (src/fixtures/rocks.js), in metres: how far the GPU's
  // offsets may land from their JS twin (as the terrain's mesh: floats on the
  // GPU), and the pixels its vertex shader draws from its twin's surface: 0.5 mm
  // on one D3D11 GPU, 2.3 mm on SwiftShader, whose rasterizer lets a pixel at
  // a facet's edge read the facet a hair past it. And at least how many pixels
  // it must draw to tell. Its deliberate mistakes miss by metres.
  rocks: { offsets: 0.01, vertices: 0.01, pixels: 20000 },
};

// Frame cost limits per quality preset. tools/screenshot.js measures every view
// and warns above them. Guesses until PLAN.md Stage 11 calibrates them on real
// machines; the counts are the same on every GPU, so they work in CI too.
//   drawCalls, triangles   per frame, all passes
//   passes                 render passes that draw or clear, per frame
//   pipelines              render pipelines alive
//   overdraw               fragments shaded per pixel of the main view, on average
//   textureMB              textures, mipmaps included: uploaded, or made once with a mip chain (src/textures/)
//   renderTargetMB         render targets (what the game draws into as it runs: the frame, the sky's tables,
//                          the rocks' offsets) and the canvas
export const budget = {
  high: { drawCalls: 1500, triangles: 3e6, passes: 16, pipelines: 64, overdraw: 5, textureMB: 512, renderTargetMB: 256 },
  medium: { drawCalls: 1000, triangles: 1.5e6, passes: 12, pipelines: 64, overdraw: 4, textureMB: 384, renderTargetMB: 160 },
  low: { drawCalls: 600, triangles: 7.5e5, passes: 8, pipelines: 64, overdraw: 3, textureMB: 128, renderTargetMB: 96 },
};

export const build = {
  sizeBudgetBytes: 3 * 1024 * 1024, // raw size of dist/index.html; warn above, fail above 2x
};

export const config = { quality, camera, post, sky, world, readout, bench, movement, defaults, capture, budget, build };
