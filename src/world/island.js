// The island's shape: the one height function (CLAUDE.md §6), and the placement
// zones from the reef to the jungle. Pure and Node-importable: JS evaluates it
// for placement and collision, the GPU gets it as a heightmap, and nothing
// re-implements it in WGSL.
//
// Everything hangs off the coast: a signed distance to the shore (positive
// inland) built from shapes, from which the beach, the seabed and the zones
// follow by how far a point lies from the water, and the green's bands also
// by how far the hills have risen. The coast is beach but for the headland's
// cliff and a rocky cape or two beyond the cove, where a coastal flat of
// changing width lies before the hills. The reef follows a line of its own,
// smoother than the coast. The hills are a volcano, a steep cone on a broad
// shield cut by valleys that radiate from the summit, one of them running
// down to the cove, with the ridges that frame the cove on top, all cut by
// gullies running straight down their slopes.
//
// The cove is art-directed in a frame of its own: its beach is the world's
// origin, and it looks out to sea towards the setting sun
// (config.sky.sun.sunsetYaw, PLAN.md Decisions). In that frame `a` runs along
// the beach towards the headland and `o` out to sea. The rest of the island
// lies behind the cove and is coarse; its size is one setting, and nothing
// within config.world.island.cove.radius of the beach depends on it, so
// resizing leaves the cove and its views as they are.
//
// Units are metres, heights above sea level. Settings: config.world.island.
//
// What is drawn is the heightmap made from this (world/heightmap.js), its
// samples 2 m apart over the land and the shallows, which misses it by
// centimetres, on cliffs by up to metres: anything that stands on the ground takes its height
// from ctx.terrain.heightAt, the ground as drawn. The coast's distance is the
// shapes' and only roughly metres: across the shore it changes by 0.5 to 1.7
// a metre, so bands measured in it (the zones) vary in width on the ground.
import { config } from '../config.js';
import { cellHash, createNoise, fbm } from './noise.js';

// From the shore inland. Rock sits outside the order: steep ground and rocky
// shores, wherever they are.
export const LAND_ZONES = ['wet-sand', 'dry-sand', 'scrub', 'palm-belt', 'jungle'];
// From the shore out to sea.
export const SEA_ZONES = ['lagoon', 'reef', 'ocean'];
export const ZONES = [...SEA_ZONES, 'rock', ...LAND_ZONES];

const DEG = Math.PI / 180;

// How fast the noise (and its fbm) typically changes a unit across: where it
// crosses zero, 1.27; to turn metres into noise.
const NOISE_SLOPE = 1.25;

// The ground's band and reef offset (groundOf) are held within these: beyond
// them they tell nothing more, and on the GPU their half floats stay precise.
const BAND_RANGE = [-1, 4];
const REEF_RANGE = 250;

// rng: a seeded random factory (core/random.js createRandom), so the seed shapes
// the island. sunsetYaw: the view yaw (views.js) looking into the setting sun.
export function createIsland(rng, settings = config.world.island, sunsetYaw = config.sky.sun.sunsetYaw) {
  const { size, cove, coast, hills, roughness, shore, seabed, zones } = settings;
  if (!(size >= settings.minSize)) throw new Error(`world.island.size ${size} m is below minSize ${settings.minSize} m`);
  const side = cove.headlandSide;
  if (side !== 1 && side !== -1) throw new Error(`world.island.cove.headlandSide must be 1 or -1, not ${side}`);

  // The cove's frame in world x, z: `forward` out to sea, `right` to the right
  // of someone on the beach facing it.
  const yaw = sunsetYaw * DEG;
  const forward = [-Math.sin(yaw), -Math.cos(yaw)];
  const right = [Math.cos(yaw), -Math.sin(yaw)];

  const coastNoise = createNoise(rng('island/coast'));
  const hillNoise = createNoise(rng('island/hills'));
  const seabedNoise = createNoise(rng('island/seabed'));
  const zoneNoise = createNoise(rng('island/zones'));
  const lushNoise = createNoise(rng('island/lush'));
  const bommieSeed = rng('island/bommies').int(0, 0x7fffffff);

  const lobes = makeLobes(rng('island/lobes'), size, coast.lobes);
  const [summitA, summitO, summitH] = hills.summit;
  const summit = { a: summitA, o: summitO, height: summitH, profile: hills.profile, valleys: hills.valleys.count };
  const peaks = makePeaks(rng('island/peaks'), lobes, hills);
  const headland = segments(cove.headland.path);
  const point = segments(cove.point.path);
  const pass = segments([[...seabed.pass.from, 0], [...seabed.pass.to, 0]])[0];
  const channel = segments(alongPath(seabed.channel.path));
  const ridges = hills.ridges.flatMap((path) => ridgePath(path, hills));
  const coveAngle = Math.atan2(-summitA, -summitO); // from the summit down to the beach
  const capes = findCapes(rng('island/capes'));

  // How much the rest of the island has its say at a point: 0 in the cove,
  // where nothing may depend on the size, 1 beyond its blend band.
  function islandWeight(a, o) {
    return smoothstep(cove.radius, cove.radius + cove.blend, Math.sqrt(a * a + o * o));
  }

  // The coast's broad shape, before the cove's bay and points: the land the
  // cove is cut into, and the island's lobes beyond it.
  function broadCoast(a, o, w) {
    const { front } = cove;
    const out = front.out[1] + (front.out[0] - front.out[1]) * smoothstep(-100, 100, a);
    const behind = coast.lobes.front - (a * a) / (2 * front.radius);
    let d = out + (behind - out) * smoothstep(front.from, front.to, Math.abs(a)) - o;
    if (w > 0) {
      let island = -Infinity;
      for (const lobe of lobes) island = smax(island, ellipse(a, o, lobe), coast.lobeBlend);
      island += coast.island.swing * coastNoise(a / coast.island.wavelength + 31.7, o / coast.island.wavelength - 12.9);
      d += w * (island - d);
    }
    return d;
  }

  // The coast: signed distance to the shore, positive inland (approximately:
  // shapes joined smoothly aren't exact distances).
  function coastDistance(a, o, w, broad) {
    let d = smax(broad, capsuleInside(a, o, headland), cove.headland.blend);
    d = smax(d, capsuleInside(a, o, point), cove.point.blend);
    // The bay: circles through the beach's middle, a tighter one towards the
    // headland and a wider one towards the far point, as bays behind a headland are.
    const [tight, wide] = cove.bay.radius;
    const toHeadland = smoothstep(-cove.bay.blend, cove.bay.blend, a);
    const tightBay = Math.sqrt(a * a + (o - tight) ** 2) - tight;
    const wideBay = Math.sqrt(a * a + (o - wide) ** 2) - wide;
    d = smin(d, wideBay + toHeadland * (tightBay - wideBay), cove.corner);
    const outside = smoothstep(...coast.cove.outerFrom, Math.abs(a)) * (1 - w);
    const wiggle = coast.cove.amplitude + outside * (coast.cove.outer - coast.cove.amplitude) + w * (coast.island.amplitude - coast.cove.amplitude);
    d += wiggle * fbm(coastNoise, a / coast.cove.wavelength, o / coast.cove.wavelength, 2);
    return d + outside * coast.cove.swing * coastNoise(a / coast.island.wavelength + 31.7, o / coast.island.wavelength - 12.9);
  }

  // How sandy the shore is, 0 (rock) to 1 (beach). It changes slowly along the
  // coast: how steeply the hills come down to the shore follows it, and a
  // sudden change would leave a cliff running inland. In the cove the headland
  // is rock; beyond it the coast is sand but for the capes.
  function beachiness(a, o, w) {
    const { sand } = cove;
    let b = 1 - smoothstep(sand.headland[0], sand.headland[1], a) * smoothstep(sand.back[1], sand.back[0], o);
    b *= 1 - smoothstep(-sand.fade, 0, capsuleInside(a, o, headland));
    if (w > 0) {
      let island = 1;
      for (const c of capes) {
        const da = a - c.a;
        const dz = o - c.o;
        island = Math.min(island, smoothstep(c.radius, c.radius + shore.capes.fade, Math.sqrt(da * da + dz * dz)));
      }
      b += w * (island - b);
    }
    return b;
  }

  // How much the coast curves round the water near a, o, per km: positive in a
  // bay, negative on a point. The broad coast's Laplacian over `scale` metres,
  // only near the shore, where it shapes the zones; it fades out away from it.
  function bayness(a, o, broad, scale = shore.bayScale) {
    const near = 1 - smoothstep(250, 350, Math.abs(broad));
    if (near === 0) return 0;
    const at = (da, dO) => broadCoast(a + da, o + dO, islandWeight(a + da, o + dO));
    return (near * 1000 * (at(scale, 0) + at(-scale, 0) + at(0, scale) + at(0, -scale) - 4 * broad)) / (scale * scale);
  }

  // Beyond the cove, what the flat behind a beach adds to its plain, d metres
  // inland: the ridges old beaches have left, parallel to the shore, further
  // apart further in, how far inland they reach changing along the coast, and
  // hummocks over them (shore.beach.island). Their spacing goes by d alone:
  // changing along the coast as well, it would turn them across the shore,
  // by up to 75° where it changed fastest.
  function oldBeaches(d, a, o) {
    const { ridges, from, to, hummocks } = shore.beach.island;
    const reach = between(to, smoothstep(-0.5, 0.5, hillNoise(a / 500 - 3.3, o / 500 + 19.4)));
    const there = smoothstep(from, from + 20, d) * (1 - smoothstep(reach - 60, reach, d));
    const crests = 0.5 - 0.5 * Math.cos(2 * Math.PI * ridgesIn(d - from));
    const [high, wavelength] = hummocks;
    return ridges * there * crests + high * smoothstep(from, from + 30, d) * fbm(hillNoise, a / wavelength + 91.1, o / wavelength - 14.4, 2);
  }

  // How many old beach ridges lie within x metres of the first: their spacing
  // widens evenly from spacing[0] there to spacing[1] where the furthest reach
  // ends (shore.beach.island), so this is the integral of one over it.
  function ridgesIn(x) {
    const { spacing: [near, far], from, to } = shore.beach.island;
    const span = to[1] - from;
    const widen = (far - near) / span; // metres of spacing per metre inland
    const within = Math.min(Math.max(x, 0), span);
    const count = widen > 0 ? Math.log1p((widen * within) / near) / widen : within / near;
    return count + (x - within) / (near + widen * within);
  }

  // Beyond the cove, how far a beach's plain lies flat before the hills rise
  // (shore.plain.flat), changing slowly along the coast.
  function flatAt(a, o) {
    const { flat, wavelength } = shore.plain;
    return flat[0] + (flat[1] - flat[0]) * smoothstep(-0.5, 0.5, hillNoise(a / wavelength + 61.1, o / wavelength - 23.4));
  }

  // The rocky capes beyond the cove (shore.capes): the coast traced in from the
  // sea along rays from the island's middle, and the points where it juts out
  // furthest, kept apart from each other and from the headland's root. In the
  // cove's frame, so the headland's side doesn't change them.
  function findCapes(r) {
    const { count, length, scale, spacing, rays } = shore.capes;
    if (count === 0) return [];
    const radii = Array.from({ length: count }, () => r.range(...length) / 2);
    const broadAt = (a, o) => broadCoast(a, o, islandWeight(a, o));
    const centre = lobes[0];
    let far = 0;
    for (const l of lobes) far = Math.max(far, Math.hypot(l.a - centre.a, l.o - centre.o) + Math.max(l.ra, l.ro));
    far += coast.island.swing + coast.lobeBlend;
    const points = [];
    for (let k = 0; k < rays; k++) {
      const t = (2 * Math.PI * k) / rays;
      const [da, dO] = [Math.sin(t), -Math.cos(t)];
      let lo = far;
      while (lo > 0 && broadAt(centre.a + lo * da, centre.o + lo * dO) < 0) lo -= 20;
      let hi = lo + 20;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        if (broadAt(centre.a + mid * da, centre.o + mid * dO) > 0) lo = mid;
        else hi = mid;
      }
      const [a, o] = [centre.a + lo * da, centre.o + lo * dO];
      if (Math.hypot(a, o) < cove.radius + cove.blend) continue; // the cove's own
      points.push({ a, o, bay: bayness(a, o, broadAt(a, o), scale) });
    }
    points.sort((p, q) => p.bay - q.bay);
    const [rootA, rootO] = cove.headland.path[0];
    const kept = [{ a: rootA, o: rootO }];
    for (const p of points) {
      if (kept.length > count) break;
      if (kept.every((c) => Math.hypot(c.a - p.a, c.o - p.o) >= spacing)) kept.push(p);
    }
    return kept.slice(1).map((p, i) => ({ a: p.a, o: p.o, radius: radii[i] }));
  }

  // The slope of the shape the last volcano() or ridgeHeight() worked out:
  // the land's lie at the scale of its valleys and spurs, not of its bumps.
  let shapeSlope = 0;
  const ridgeOut = { slope: 0 };
  // hillHeight()'s: the slope of whichever of its shapes stands highest
  // there, blended where they meet as smax blends them, so it runs on.
  let hillSlope = 0;

  // The hills, as heights above sea level before they meet the shore.
  function hillHeight(a, o, w) {
    const { warp, detail, creases } = hills;
    const wa = a + warp.amplitude * hillNoise(a / warp.wavelength + 5.2, o / warp.wavelength);
    const wo = o + warp.amplitude * hillNoise(a / warp.wavelength - 7.4, o / warp.wavelength + 3.3);

    // The main volcano, its valley down to the cove, and older, lower ones on
    // the island's other lobes.
    let h = volcano(wa, wo, summit, true);
    hillSlope = shapeSlope;
    // Joins x, of this slope, onto h.
    const join = (x, slope) => {
      hillSlope += Math.min(Math.max(0.5 + (0.5 * (x - h)) / hills.join, 0), 1) * (slope - hillSlope);
      h = smax(h, x, hills.join);
    };
    if (w > 0) for (const p of peaks) join(w * volcano(wa, wo, p, false, h - hills.join), w * shapeSlope);

    // The ridges that frame the cove, joined as one shape: the higher of their
    // segments, the corner where two cross rounded from below (roundMax). Joined
    // one by one, two segments would bulge by a join's quarter, 7.5 m, wherever
    // they stand as high as each other: round every bend, and where the
    // ridges start together at the summit.
    let ridge = -Infinity;
    let ridgeSlope = 0;
    for (const s of ridges) {
      const x = ridgeHeight(wa, wo, s, hills, gully, ridgeOut);
      const share = ridge === -Infinity ? 1 : smoothstep(-hills.bend, hills.bend, x - ridge);
      ridge = ridge === -Infinity ? x : roundMax(ridge, x, hills.bend);
      ridgeSlope += share * (ridgeOut.slope - ridgeSlope);
    }
    if (ridge > -Infinity) join(ridge, ridgeSlope);
    if (h <= 0) {
      hillSlope = 0;
      return 0;
    }

    const bumps = (detail.share * h + detail.base) * fbm(hillNoise, wa / detail.wavelength, wo / detail.wavelength, detail.octaves);
    const crease = 1 - softAbs(fbm(hillNoise, wa / creases.wavelength + 50.1, wo / creases.wavelength - 20.7, 3), (creases.round * NOISE_SLOPE) / creases.wavelength);
    return Math.max(0, h + bumps - creases.share * h * crease * crease);
  }

  // How high the ground's roughness stands at a, o (roughness), where the
  // land's shape has this slope and the land stands this high: rougher on
  // steep ground than on flats and valley floors, more in some stretches than
  // others, and with room only down to roughness.floor above the sea.
  function roughHeight(a, o, slope, land) {
    const { base, flat, steep, patches, floor } = roughness;
    const room = land - floor;
    if (room <= 0) return 0;
    const patch = smoothstep(-0.4, 0.4, hillNoise(a / patches.wavelength + 71.3, o / patches.wavelength - 22.9));
    const high = base * between(patches.range, patch) * (flat + (1 - flat) * smoothstep(steep[0], steep[1], slope));
    return room * (1 - Math.exp(-high / room)); // `high` where there's room, and never more than the room
  }

  // Roughness over `wavelength` and roughness.octaves finer ones, each `gain`
  // as high as the last, about -1 to 1.
  function roughAt(a, o, wavelength) {
    const { octaves, gain } = roughness;
    let sum = hillNoise(a / wavelength - 61.7, o / wavelength + 27.3);
    let x = a / wavelength;
    let y = o / wavelength;
    let amplitude = 1;
    for (let k = 0; k < octaves; k++) {
      const nx = 2 * (0.8 * x - 0.6 * y) + 13.1;
      y = 2 * (0.6 * x + 0.8 * y) - 7.9;
      x = nx;
      amplitude *= gain;
      sum += amplitude * hillNoise(x, y);
    }
    return sum / 1.5;
  }

  // A gully, 0 to 1, from noise n that changes `across` a metre across it:
  // sharp grooves where it crosses zero, their floors rounded over
  // gullies.round metres.
  function groove(n, across) {
    return (1 - softAbs(n, hills.gullies.round * across)) ** hills.gullies.sharp;
  }

  // A gully at `across` metres along the slope's contour and `down` metres
  // down it: the noise changes slowly down the slope, so the gullies run
  // straight down it, wandering.
  function gully(across, down) {
    const { spacing, length } = hills.gullies;
    return groove(hillNoise(across / spacing + 17.3, down / length - 41.9), NOISE_SLOPE / spacing);
  }

  // A volcano worn down by valleys that radiate from its top: a steep cone on a
  // broad shield, cut where noise read around a circle (so it wraps without a
  // seam) is far from zero. Ridges run where it crosses zero, sharp; the
  // valleys between them are broad. Further down there is room for more, and
  // the valleys branch. With `toCove`, one valley runs down to the cove's beach.
  // Below `floor` its valleys and gullies aren't worked out: they only lower
  // it, and what it is joined to lies a join's width above it there. Its
  // profile's slope there, worn down as it is, goes to shapeSlope.
  function volcano(wa, wo, v, toCove, floor = -Infinity) {
    const { valleys } = hills;
    const da = wa - v.a;
    const dz = wo - v.o;
    const r2 = da * da + dz * dz;
    const r = Math.sqrt(r2);
    const fromTop = Math.sqrt(r2 + hills.summitRound * hills.summitRound) - hills.summitRound;
    let h = 0;
    let fall = 0; // how fast it falls with r
    for (const [share, falloff] of v.profile) {
      const part = share * v.height * Math.exp(-fromTop / falloff);
      h += part;
      fall += part / falloff;
    }
    shapeSlope = (fall * r) / (fromTop + hills.summitRound);
    if (r <= valleys.from || h <= floor) return h;
    const c = dz / r;
    const s = da / r;
    let open = 0;
    let total = 0;
    for (let k = 0; k < valleys.branch.length + 1; k++) {
      const weight = k === 0 ? 1 : smoothstep(valleys.branch[k - 1][0], valleys.branch[k - 1][1], r);
      if (weight === 0) break;
      const around = (v.valleys << k) / (2 * Math.PI);
      open += weight * softAbs(hillNoise(around * c + r / valleys.length + 13.7 * k + v.a / 97, around * s - 4.1 * k + v.o / 89), valleys.round);
      total += weight;
    }
    // The ridges between the valleys rounded on top, and their floors into their sides.
    let cut = valleys.depth * smin(open / total / valleys.saturate, 1, valleys.round / valleys.saturate);
    if (toCove) {
      const off = Math.atan2(s * Math.cos(coveAngle) - c * Math.sin(coveAngle), c * Math.cos(coveAngle) + s * Math.sin(coveAngle));
      const along = Math.exp(-((off / (valleys.cove.width * DEG)) ** 2));
      cut += along * (valleys.cove.depth - cut);
    }
    const worn = 1 - cut * smoothstep(valleys.from, valleys.full, r);
    h *= worn;
    shapeSlope *= worn;
    // Gullies down the flanks, radiating from the top: their number round the
    // circle gives them `spacing` where they are full, and doubles beyond each
    // of the valleys' branch bands, so they stay about as close further down.
    const { gullies } = hills;
    if (r <= gullies.from) return h;
    // Read round a circle, as the valleys are, so they wrap without a seam.
    let grooves = 0;
    let weights = 0;
    for (let k = 0; k < valleys.branch.length + 1; k++) {
      const weight = k === 0 ? 1 : smoothstep(valleys.branch[k - 1][0], valleys.branch[k - 1][1], r);
      if (weight === 0) break;
      const around = (k === 0 ? gullies.full : valleys.branch[k - 1][1]) / gullies.spacing;
      grooves += weight * groove(hillNoise(around * c + r / gullies.length + 29.1 * (k + 1) + v.a / 61, around * s - 15.7 * (k + 1) + v.o / 53), (NOISE_SLOPE * around) / r);
      weights += weight;
    }
    const gullied = 1 - gullies.depth * smoothstep(gullies.from, gullies.full, r) * (grooves / weights);
    shapeSlope *= gullied;
    return h * gullied;
  }

  // How sheer a rocky shore is at a, o, 0 to 1, changing slowly along the
  // coast: its wall's height and how close the hills come follow it
  // (shore.rocky). The headland's face towards the bay is sheer. Not worked
  // out where the shore is all sand.
  function sheerAt(a, o, b, w) {
    if (b >= 1) return 0;
    const { wavelength } = shore.rocky;
    const sheer = smoothstep(-0.5, 0.5, hillNoise(a / wavelength + 83.1, o / wavelength - 52.6));
    return Math.max(sheer, (1 - w) * (1 - smoothstep(...cove.headland.sheer, a)));
  }

  // The shore's own rise inland: a beach with a berm and a gentle plain behind
  // it, or a rocky shore's wall and the rise behind it, both beyond the cove
  // (w) as shore.beach.island and shore.rocky.island have them.
  function shoreHeight(d, b, a, o, w, sheer) {
    const { beach, rocky, undulation } = shore;
    // The plain rises from plainFrom metres inland, eased in: less the ease's
    // own little rise at the waterline, so the beach starts at the sea.
    const plainIn = softplus(d - beach.plainFrom, 10) - softplus(-beach.plainFrom, 10);
    const berm = beach.berm + w * (beach.island.berm - beach.berm);
    const bermWidth = beach.bermWidth + w * (beach.island.bermWidth - beach.bermWidth);
    const plain = beach.plain + w * (beach.island.plain - beach.plain);
    let sandy = berm * Math.tanh(d / bermWidth) + plain * (1 - Math.exp(-plainIn / beach.plainReach));
    if (w > 0 && d > beach.island.from) sandy += w * oldBeaches(d, a, o);
    const swell = undulation.amplitude * smoothstep(...undulation.from, d) * hillNoise(a / undulation.wavelength - 40.2, o / undulation.wavelength + 8.8);
    if (b >= 1) return Math.max(sandy + swell, 0.02 * d);
    const wall = between(rocky.wall, sheer) + w * (between(rocky.island.wall, sheer) - between(rocky.wall, sheer));
    const rise = rocky.rise + w * (rocky.island.rise - rocky.rise);
    const rockyRise = wall * Math.tanh(d / rocky.wallWidth) + rise * (1 - Math.exp(-d / rocky.reach));
    // Never below the water: the waterline is where the coast says.
    return Math.max(rockyRise + b * (sandy - rockyRise + swell), 0.02 * d);
  }

  // Distance out to sea from the reef's crest (negative inside it). In the cove
  // the reef runs along its own curve; around the rest of the island it keeps
  // a distance from the broad coast.
  function reefOffset(a, o, w, broad) {
    const { reef } = seabed;
    const bend = a / reef.cove.radius;
    const [wander, wanderLength] = reef.wander;
    const wobble = wander * fbm(seabedNoise, a / wanderLength + 41.7, o / wanderLength - 13.3, 2);
    const coveOffset = (o - reef.cove.out + (a * a) / (2 * reef.cove.radius)) / Math.sqrt(1 + bend * bend) + wobble;
    if (w === 0) return coveOffset;
    const n = fbm(seabedNoise, a / reef.island.wavelength + 9.1, o / reef.island.wavelength - 2.4, 2);
    const islandOffset = -broad - (reef.island.mean + reef.island.swing * n) + wobble;
    return coveOffset + w * (islandOffset - coveOffset);
  }

  // The seabed, x metres offshore and y beyond the reef's crest.
  function seabedHeight(x, y, b, a, o) {
    // The lagoon's side of the crest and the drop-off follow rules of their
    // own; across a band at the crest they blend, each taken at the crest's
    // edge of its side, so the reef runs on without a step.
    const band = seabed.reef.crestBlend;
    let h;
    if (y <= -band) h = insideReef(x, y, b, a, o);
    else if (y >= band) h = outsideReef(x, y, a, o);
    else {
      const inside = insideReef(x, Math.min(y, 0), b, a, o);
      h = inside + (outsideReef(x, Math.max(y, 0), a, o) - inside) * smoothstep(-band, band, y);
    }
    // The pass and the channel, their walls bent so they don't run straight.
    const { bend } = seabed;
    const ba = a + bend.amplitude * seabedNoise(a / bend.wavelength - 21.3, o / bend.wavelength);
    const bo = o + bend.amplitude * seabedNoise(a / bend.wavelength, o / bend.wavelength + 17.9);
    h = smin(h, passHeight(ba, bo), 2);
    h = smin(h, channelHeight(ba, bo), 1.5);
    // Nothing breaks the surface: everything in the water stays below it, and
    // out in it below minDepth.
    return Math.min(h, -seabed.minDepth * smoothstep(5, 25, x), -0.02 * Math.min(x, 5));
  }

  // Inside the reef's crest (y <= 0): the shelf, the lagoon floor, the reef
  // flat behind the crest, and coral heads.
  function insideReef(x, y, b, a, o) {
    const { lagoon, reef, bommies } = seabed;
    const shelf = -x * (shore.rocky.shelfSlope + b * (shore.beach.shelfSlope - shore.rocky.shelfSlope));
    const floor = -(lagoon.depth + lagoon.swing * fbm(seabedNoise, a / lagoon.wavelength, o / lagoon.wavelength, 2));
    let h = smax(shelf, floor, 1.5);
    const flat = -reef.crest - (reef.flat - reef.crest) * smoothstep(0, reef.flatWidth, -y) - reef.backSlope * Math.max(0, -y - reef.flatWidth);
    const [roughness, roughWavelength] = reef.roughness;
    const rough = roughness * smoothstep(-reef.flatWidth - 20, 0, y) * fbm(seabedNoise, a / roughWavelength + 3.3, o / roughWavelength, 2);
    h = smax(h, flat + rough, 1);
    const lagoonShare = smoothstep(bommies.from, bommies.from + 25, x) * (1 - smoothstep(-bommies.clear - 25, -bommies.clear, y));
    if (lagoonShare > 0) h += lagoonShare * coralHeads(a, o, h);
    return h;
  }

  // Outside it (y >= 0): the drop-off. A shore out here drops straight into
  // the deep, sandy or not.
  function outsideReef(x, y, a, o) {
    const { reef } = seabed;
    const { fore } = reef;
    const [groove, grooveWavelength] = fore.grooves;
    const grooves = groove * smoothstep(0, 10, y) * (1 - smoothstep(...fore.groovesEnd, y)) * fbm(seabedNoise, a / grooveWavelength - 8.8, o / grooveWavelength + 4.4, 2);
    return smax(-x * shore.rocky.shelfSlope, -reef.crest - fore.drop * (1 - Math.exp(-y / fore.dropWidth)) - fore.slope * y + grooves, 1);
  }

  function passHeight(a, o) {
    const { t, dist } = segment(a, o, pass.ax, pass.ao, pass.bx, pass.bo);
    const { depth, wall, halfWidth, ragged } = seabed.pass;
    const width = halfWidth[0] + (halfWidth[1] - halfWidth[0]) * t + ragged[0] * seabedNoise(a / ragged[1] + 5.5, o / ragged[1] - 7.7);
    return -(depth[0] + (depth[1] - depth[0]) * t) + wall * Math.max(0, dist - width);
  }

  // The channel deepens and widens along its path, towards the pass. Each
  // stretch is a trough of its own and the deepest has its way, so the floor
  // runs on without a step where stretches meet at a bend.
  function channelHeight(a, o) {
    const { depth, halfWidth, wall } = seabed.channel;
    let h = Infinity;
    for (const s of channel) {
      const { t, dist } = segment(a, o, s.ax, s.ao, s.bx, s.bo);
      const along = s.ha + (s.hb - s.ha) * t;
      const trough = -(depth[0] + (depth[1] - depth[0]) * along) + wall * Math.max(0, dist - (halfWidth[0] + (halfWidth[1] - halfWidth[0]) * along));
      h = Math.min(h, trough);
    }
    return h;
  }

  // Coral heads scattered over the lagoon floor: one or none per cell of a grid,
  // placed by a hash of the cell. Returns how much they raise the floor at a, o.
  function coralHeads(a, o, floor) {
    const { cell, chance, radius, top } = seabed.bommies;
    const ci = Math.floor(a / cell);
    const cj = Math.floor(o / cell);
    let lift = 0;
    for (let i = ci - 1; i <= ci + 1; i++) {
      for (let j = cj - 1; j <= cj + 1; j++) {
        const h0 = cellHash(i, j, bommieSeed);
        if (h0 >= chance) continue;
        const r = radius[0] + (radius[1] - radius[0]) * cellHash(i, j, bommieSeed + 3);
        const dx = a - (i + 0.15 + 0.7 * cellHash(i, j, bommieSeed + 1)) * cell;
        const dz = o - (j + 0.15 + 0.7 * cellHash(i, j, bommieSeed + 2)) * cell;
        const q = (dx * dx + dz * dz) / (r * r);
        if (q >= 1) continue;
        const peak = -(top[0] + ((top[1] - top[0]) * h0) / chance);
        lift = Math.max(lift, Math.max(0, peak - floor) * (1 - q) * (1 - q));
      }
    }
    return lift;
  }

  // Everything about a point in the cove's frame, written into `out` (no
  // allocation: the heightmap evaluates this a million times at boot).
  function evaluate(a, o, out) {
    const w = islandWeight(a, o);
    const broad = broadCoast(a, o, w);
    const d = coastDistance(a, o, w, broad);
    const b = beachiness(a, o, w);
    const reef = reefOffset(a, o, w, broad);
    let height;
    if (d >= 0) {
      const sheer = sheerAt(a, o, b, w);
      const base = shoreHeight(d, b, a, o, w, sheer);
      const hills = hillHeight(a, o, w);
      // The hills come down to a rocky shore the closer the sheerer it is.
      const near = between(shore.rocky.hillReach, 1 - sheer);
      const rocky = near + w * (between(shore.rocky.island.hillReach, 1 - sheer) - near);
      let reach = rocky + b * (shore.beach.hillReach - rocky);
      let from = 0;
      if (w > 0) {
        // Beyond the cove a beach's plain lies flat before the hills rise, and
        // they rise over plain.ramp, or further for tall ones, no steeper than
        // plain.slope (the taper's steepest is 1.5 x their height over its
        // reach), but over no more than plain.reach, so the peaks further in
        // keep their height; a rocky shore's over its own reach. Either way
        // the rise itself is no steeper than shore.steepest, however tall they
        // are: no cliffs but the capes' walls, and green slopes above those.
        const { plain } = shore;
        const gentle = smin(smax(plain.ramp, (1.5 * hills) / plain.slope, plain.ease), plain.reach, plain.ease);
        const island = smax(rocky + b * (gentle - rocky), (1.5 * hills) / shore.steepest, plain.ease);
        reach += w * (island - reach);
        from = w * b * flatAt(a, o);
      }
      const taper = smoothstep(from, from + reach, d);
      const meet = shore.hillJoin * taper;
      height = smax(base, hills * taper, meet);
      out.rise = height - base;
      out.land = height;
      // The ground's roughness, the shore's and the hills' alike: on the hills,
      // where they fade out towards the shore, it would fade with them. As
      // steep as the hills' shapes, tapered, and as they rise out of the plain
      // (the taper's own slope), as far as they stand above the shore's own
      // rise (smax's share): where that is the higher, the land is as flat as it.
      if (d > roughness.from[0]) {
        const u = Math.min(Math.max((d - from) / reach, 0), 1);
        const above = hills * taper - base;
        const share = meet > 0 ? Math.min(Math.max(0.5 + (0.5 * above) / meet, 0), 1) : above > 0 ? 1 : 0;
        const steepness = share * (hillSlope * taper + (hills * 6 * u * (1 - u)) / reach);
        height += roughHeight(a, o, steepness, height) * smoothstep(...roughness.from, d) * roughAt(a, o, roughness.wavelength);
      }
    } else {
      height = seabedHeight(-d, reef, b, a, o);
      out.rise = 0;
      out.land = height;
    }
    out.height = height;
    out.coast = d;
    out.beach = b;
    out.reef = reef;
    out.a = a;
    out.o = o;
    return out;
  }

  const sampleCove = (a, o) => evaluate(a, o, {});

  function toCove(x, z) {
    return [side * (x * right[0] + z * right[1]), x * forward[0] + z * forward[1]];
  }

  function fromCove(a, o) {
    const u = side * a;
    return [u * right[0] + o * forward[0], u * right[1] + o * forward[1]];
  }

  // What the ground is at a sampled point, given its slope there (rise over
  // run) and the slope of the land under its roughness (`land`, evaluate's
  // out.land), into `out`: how much of it is sand and how much rock (the rest is
  // green), `band`, how far into the green it lies (0 where the shore's band
  // ends, 1 where the scrub does, 2 where the palm belt does), the reef's
  // offset, and `sandy`, how much of the soil is sand: behind a beach, whose
  // sand the wind carries inland, fading over zones.sandy metres, and only as
  // steep as sand holds. The one definition of the ground: world/heightmap.js
  // keeps it per sample of its grids, for the GPU and for placement alike, and
  // the zones follow from it (zoneFrom).
  const rockSlope = zones.rockSlope.map((deg) => Math.tan(deg * DEG));
  const sandSlope = zones.sandSlope.map((deg) => Math.tan(deg * DEG));
  const cliffSlope = zones.cliffSlope.map((deg) => Math.tan(deg * DEG));
  // The bands' widest (a bay adds at most 2 x `bay`). Out at sea beyond the
  // shore's narrowest less the scrub's widest, the band is the lowest of
  // BAND_RANGE and the point in the shore's band, whatever the widths; inland
  // beyond the shore's and the scrub's widest and three of the palm belt's,
  // the band is the highest and the shore's band far behind. There the widths
  // aren't worked out, which saves most of the grids' samples their noise.
  const { shore: sh, scrub: sc, palmBelt: pb } = zones;
  const widest = {
    shore: sh.width + sh.swing[1] + 2 * sh.bay + sh.ragged[0],
    scrub: sc.width + sc.swing + 2 * sc.bay + sc.ragged[0],
    palmBelt: pb.width + pb.swing + pb.ragged[0],
  };
  const outAtSea = sh.min - widest.scrub;
  const deepInland = widest.shore + widest.scrub + (BAND_RANGE[1] - 1) * widest.palmBelt;
  function groundOf(s, slope, out = {}, land = slope) {
    const { coast: d, beach: b, rise, a, o } = s;
    // Each band's width swings along the coast with a noise of its own, and its
    // inland edge frays. Each edge lies inland of the last, and none changes
    // faster across the ground than the shore falls behind, so walking inland
    // the bands come in order: the noise stays gentle, and the land does the
    // rest (below).
    let shoreWidth = sh.width;
    let scrub = sc.width;
    let palmBelt = pb.width;
    if (d > outAtSea && d < deepInland) {
      const w = islandWeight(a, o);
      const curve = w > 0 ? w * Math.min(Math.max(bayness(a, o, broadCoast(a, o, w)), -2), 2) : 0;
      const swing = (dx, dz) => zoneNoise(a / zones.wavelength + dx, o / zones.wavelength + dz);
      const fray = ([metres, wavelength], dx, dz) => metres * fbm(zoneNoise, a / wavelength + dx, o / wavelength + dz, 2);
      const shoreSwing = sh.swing[0] + w * (sh.swing[1] - sh.swing[0]);
      shoreWidth = Math.max(sh.min, sh.width + shoreSwing * swing(70.3, -15.1) + sh.bay * curve + fray(sh.ragged, 12.3, -41.9));
      scrub = Math.max(sc.min, sc.width + sc.swing * swing(-33.6, 52.8) - sc.bay * curve + fray(sc.ragged, -27.4, 8.6));
      palmBelt = Math.max(pb.min, pb.width + pb.swing * swing(45.2, 91.7) + fray(pb.ragged, 63.9, -70.2));
    }
    const into = d - shoreWidth;
    // The palm belt holds the low ground behind the shore and ends as the hills
    // rise above the shore's plain, narrowed by 1 + rise / palmBelt.rise: it
    // covers the coastal flats and reaches up valley floors, and the jungle
    // comes down the spurs.
    const band = into < scrub ? into / scrub : 1 + ((into - scrub) / palmBelt) * (1 + rise / pb.rise);
    // The shore's band is sand as far as the shore is sandy and the ground
    // flat enough for sand to lie on, and rock otherwise; inland, land too
    // steep for soil is rock. Sand, and the sand in sandy soil, goes by the
    // ground's slope as it is; rock by the land's under its roughness, so it
    // stands out where the land is steep, not on the sides of its bumps.
    const onShore = 1 - smoothstep(-zones.edge, zones.edge, into);
    // Beyond the reef's crest the seabed drops off steeper than a coarse grid
    // sees, its cells spanning the drop: judged by at least the steepest the
    // drop-off gets within its own width of the point, no level lays sand on it.
    const { fore } = seabed.reef;
    const drop = d < 0 && s.reef > 0 ? (fore.drop / fore.dropWidth) * Math.exp(-Math.max(0, s.reef - fore.dropWidth) / fore.dropWidth) + fore.slope : 0;
    const holds = 1 - smoothstep(sandSlope[0], sandSlope[1], Math.max(slope, drop));
    const sand = smoothstep(0.4, 0.6, b) * holds;
    const steep = smoothstep(rockSlope[0], rockSlope[1], land);
    // Where the shore's band isn't sand, it is bare rock as far as it is a
    // cliff, the waves and their spray reach it, or rock fallen from a sheer
    // cliff lies at its foot (where the hills have risen little yet), and
    // green elsewhere: the green comes down to a cliff's edge and over gentler
    // slopes to the spray, not to a line along the shore.
    const cliff = smoothstep(cliffSlope[0], cliffSlope[1], land);
    const spray = 1 - smoothstep(zones.splash[0], zones.splash[1], s.height);
    const fallen = b < 1 ? sheerAt(a, o, b, islandWeight(a, o)) * (1 - smoothstep(zones.talus[0], zones.talus[1], rise)) : 0;
    const bare = Math.max(cliff, spray, fallen);
    out.sand = onShore * sand;
    out.rock = onShore * (1 - sand) * bare + (1 - onShore) * steep;
    out.sandy = smoothstep(0.4, 0.6, b) * (1 - smoothstep(0, zones.sandy, into)) * holds;
    out.band = Math.min(Math.max(band, BAND_RANGE[0]), BAND_RANGE[1]);
    out.reef = Math.min(Math.max(s.reef, -REEF_RANGE), REEF_RANGE);
    return out;
  }

  // How lush the green is at a point, 0 open to 1 lush, given its ground
  // (groundOf) and its relief: how many metres it stands above (+) or below
  // (-) the ground round it, within zones.lush.radius (world/heightmap.js
  // measures it on its grids). Open behind the beach and lusher into the
  // jungle; lush in hollows and gullies, where water and soil gather, open on
  // ridges and spurs; and in patches a few hundred metres across. What grows
  // follows it (Stages 8-9), and the green's look (chunks/green.wgsl).
  function lushOf(g, relief, a, o) {
    const { bands, relief: perMetre, patches, wavelength } = zones.lush;
    const palm = smoothstep(0.5, 1.5, g.band);
    const jungle = smoothstep(1.67, 2.33, g.band);
    let lush = bands[0] + (bands[1] - bands[0]) * palm;
    lush += (bands[2] - lush) * jungle;
    lush -= perMetre * relief;
    lush += patches * fbm(lushNoise, a / wavelength + 31.7, o / wavelength - 8.9, 2);
    return Math.min(Math.max(lush, 0), 1);
  }

  // The zone of a point from its ground (groundOf) and its height: whichever
  // of sand, rock and green it is most of, ties going to rock.
  function zoneFrom(g, height) {
    if (height < 0) {
      if (g.reef < -zones.reefBack) return 'lagoon';
      return height < -zones.reefDeep ? (g.reef < 0 ? 'lagoon' : 'ocean') : 'reef';
    }
    const green = 1 - g.sand - g.rock;
    if (g.rock >= g.sand && g.rock >= green) return 'rock';
    if (g.sand >= green) return height < zones.wetSand ? 'wet-sand' : 'dry-sand';
    return g.band < 1 ? 'scrub' : g.band < 2 ? 'palm-belt' : 'jungle';
  }

  // The zone of a sampled point, given the ground's slope there, and the land's.
  const zoneOf = (s, slope, land = slope) => zoneFrom(groundOf(s, slope, {}, land), s.height);

  const scratch = {};
  const at = (x, z) => evaluate(side * (x * right[0] + z * right[1]), x * forward[0] + z * forward[1], scratch);
  const heightAt = (x, z) => at(x, z).height;

  // Slope (rise over run) by central differences over `step` metres: of the
  // ground, and with `land` of the land under its roughness.
  function slope(x, z, step = 0.5, land = false) {
    const h = land ? (px, pz) => at(px, pz).land : heightAt;
    const gx = (h(x + step, z) - h(x - step, z)) / (2 * step);
    const gz = (h(x, z + step) - h(x, z - step)) / (2 * step);
    return Math.sqrt(gx * gx + gz * gz);
  }

  return {
    settings,
    forward,
    right,
    side,
    toCove,
    fromCove,
    // evaluate(a, o, out): sample() in the cove's frame, into `out`.
    evaluate,
    // Height above sea level at world x, z (not as drawn: see the top).
    height: heightAt,
    // { height, land, coast, beach, rise, reef, a, o }: the height, the height
    // of the land under its roughness, the signed distance to the shore
    // (positive inland), how sandy the shore is (0 to 1), how far the hills
    // have risen above the shore's own rise, the distance out to sea from the
    // reef's crest, and the point in the cove's frame.
    sample: (x, z) => sampleCove(...toCove(x, z)),
    // The rocky capes beyond the cove: [{ a, o, radius }] in the cove's frame.
    capes,
    // The ellipses the island's coast is made of, beyond the cove (makeLobes).
    lobes,
    // The ground of a sample, given its slope and the land's (groundOf); the
    // zone of a ground and height; the zone of a sample, given its slopes; and
    // at world x, z (nine evaluations, about 12 µs: placement reads the drawn
    // ground's, world/heightmap.js zoneAt, which is also what the GPU draws).
    groundOf,
    // How lush the green is, given the ground and its relief (lushOf).
    lushOf,
    zoneFrom,
    zoneOf,
    zone: (x, z) => zoneOf(sampleCove(...toCove(x, z)), slope(x, z), slope(x, z, 0.5, true)),
    slope,
    // The box outside which there is only deep sea: in world x, z, and in the
    // cove's frame ({ minA, maxA, minO, maxO }).
    ...islandBounds(lobes, settings, fromCove),
  };
}

// The island's lobes in the cove's frame: the main one behind the cove, its
// front where the coast either side of the cove runs, and a few seeded ones.
function makeLobes(r, size, lobes) {
  const main = { a: 0, o: lobes.front - size / 2, ra: (lobes.width * size) / 2, ro: size / 2, cos: 1, sin: 0 };
  const extra = Array.from({ length: lobes.count }, () => {
    const angle = r.range(-lobes.spread, lobes.spread) * DEG; // from straight back
    const reach = r.range(...lobes.reach) * size;
    const turn = r.range(0, Math.PI);
    return {
      a: main.a + reach * Math.sin(angle),
      o: main.o - reach * Math.cos(angle),
      ra: (r.range(...lobes.radius) * size) / 2,
      ro: (r.range(...lobes.radius) * size) / 2,
      cos: Math.cos(turn),
      sin: Math.sin(turn),
    };
  });
  return [main, ...extra];
}

// A lower summit on each extra lobe, older and more worn than the main one.
function makePeaks(r, lobes, { summit, peaks }) {
  return lobes.slice(1).map((lobe) => ({
    a: lobe.a + r.range(-0.2, 0.2) * lobe.ra,
    o: lobe.o + r.range(-0.2, 0.2) * lobe.ro,
    height: summit[2] * r.range(...peaks.share),
    profile: peaks.profile,
    valleys: peaks.valleys,
  }));
}

// [a, o] points with how far along the path each lies, 0 to 1, as the third value.
function alongPath(points) {
  const lengths = points.map((p, i) => (i ? Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) : 0));
  const total = lengths.reduce((sum, l) => sum + l, 0);
  let run = 0;
  return points.map(([a, o], i) => [a, o, (run += lengths[i]) / total]);
}

// A polyline of [a, o, height] points as segments, each with its length and
// how far along the polyline it starts.
function segments(points) {
  let start = 0;
  return points.slice(1).map((p, i) => {
    const [ax, ao, ha] = points[i];
    const [bx, bo, hb] = p;
    const length = Math.hypot(bx - ax, bo - ao);
    const s = { ax, ao, bx, bo, ha, hb, start, length };
    start += length;
    return s;
  });
}

// A ridge's path of [a, o, height] points as segments (segments()), each with
// its direction (ua, uo) and where along the ridge its gullies start counting
// (`across`): the path's length so far, and round each bend the angle it turns
// through times the ridge's width there, which the fan its gullies spread in
// round the outside of the bend takes up (gullyAcross). A point repeated in
// the path is left out: a segment of no length has no direction.
export function ridgePath(points, hills) {
  const kept = points.filter((p, i) => i === 0 || p[0] !== points[i - 1][0] || p[1] !== points[i - 1][1]);
  const path = segments(kept);
  let across = 0;
  path.forEach((s, i) => {
    s.ua = (s.bx - s.ax) / s.length;
    s.uo = (s.bo - s.ao) / s.length;
    // How high the segments either side stand at most: none at the ridge's ends.
    s.before = i > 0 ? Math.max(path[i - 1].ha, path[i - 1].hb) : null;
    s.after = i < path.length - 1 ? Math.max(path[i + 1].ha, path[i + 1].hb) : null;
    if (i > 0) {
      const last = path[i - 1];
      const turn = Math.acos(Math.min(Math.max(last.ua * s.ua + last.uo * s.uo, -1), 1));
      across += last.length + turn * ridgeWidth(s.ha, hills);
    }
    s.across = across;
  });
  return path;
}

// A ridge's width where it stands H high: its flanks no steeper than
// flankSlope, unless that is outside `width`.
function ridgeWidth(H, { flankSlope, width: [minWidth, maxWidth] }) {
  return Math.min(Math.max((0.86 * H) / flankSlope, minWidth), maxWidth);
}

// A ridge along a segment of ridgePath: rounded on top, its flanks steepest
// about 0.7 x its width out and gone by three widths, cut by gullies down its
// flanks (gully(gullyAcross, out from its crest)). Its shape's slope there,
// across and along it, goes to out.slope. Beyond an end where another
// segment meets it, its height runs on as the segment was going, but no
// higher than that segment stands: held at the end, it would stand as a knob
// above the next segment's crest wherever the path falls away from it, and
// its crest would turn at once where the end is. The ridge's own two ends
// hold theirs, rounded off.
function ridgeHeight(a, o, s, hills, gully, out) {
  const { crestRadius, gullies } = hills;
  const { t, dist } = segment(a, o, s.ax, s.ao, s.bx, s.bo);
  let H = s.ha + (s.hb - s.ha) * t;
  const neighbour = t <= 0 ? s.before : t >= 1 ? s.after : null;
  if (neighbour !== null) H = Math.min(s.ha + ((s.hb - s.ha) * ((a - s.ax) * s.ua + (o - s.ao) * s.uo)) / s.length, Math.max(H, neighbour));
  const width = ridgeWidth(H, hills);
  const round = Math.sqrt(dist * dist + crestRadius * crestRadius);
  const off = (round - crestRadius) / width;
  out.slope = 0;
  if (off > 3) return 0;
  const flank = smoothstep(0.3, 1.1, off);
  const cut = flank > 0 ? gullies.depth * flank * gully(gullyAcross(a, o, s, t, hills), dist) : 0;
  const fall = Math.exp(-off * off);
  out.slope = (1 - cut) * Math.hypot((2 * off * H * fall * dist) / (round * width), (fall * (s.hb - s.ha)) / s.length);
  return H * fall * (1 - cut);
}

// How far along its ridge a point lies, for the gullies (ridgePath's
// `across`), t being how far along segment s its nearest point is. Beside the
// segment, how far along it; beyond either end, round the end in a fan: on by
// the angle from the flank times the ridge's width at the end, so the gullies
// run straight down its nose, and round the outside of a bend on into the
// next segment's, which counts on from there. Measured from the end alone,
// they would ring it.
export function gullyAcross(a, o, s, t, hills) {
  if (t > 0 && t < 1) return s.across + t * s.length;
  const start = t <= 0;
  const da = a - (start ? s.ax : s.bx);
  const dO = o - (start ? s.ao : s.bo);
  const ahead = (start ? -1 : 1) * (da * s.ua + dO * s.uo);
  const angle = Math.atan2(Math.max(ahead, 0), Math.abs(da * s.uo - dO * s.ua));
  return start ? s.across - angle * ridgeWidth(s.ha, hills) : s.across + s.length + angle * ridgeWidth(s.hb, hills);
}

// Past the land, the widest reef and the noise on the coast, and on to where the
// seabed has dropped into the deep.
function islandBounds(lobes, { cove, seabed, coast }, fromCove) {
  const reef = Math.max(seabed.reef.cove.out, seabed.reef.island.mean + seabed.reef.island.swing);
  const margin = reef + coast.island.amplitude + coast.island.swing + seabed.outerMargin;
  let minA = -cove.radius - cove.blend;
  let maxA = cove.radius + cove.blend;
  let minO = -cove.radius - cove.blend;
  let maxO = margin;
  for (const l of lobes) {
    const r = Math.max(l.ra, l.ro) + margin;
    minA = Math.min(minA, l.a - r);
    maxA = Math.max(maxA, l.a + r);
    minO = Math.min(minO, l.o - r);
    maxO = Math.max(maxO, l.o + r);
  }
  const corners = [fromCove(minA, minO), fromCove(minA, maxO), fromCove(maxA, minO), fromCove(maxA, maxO)];
  const xs = corners.map((c) => c[0]);
  const zs = corners.map((c) => c[1]);
  return {
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) },
    coveBounds: { minA, maxA, minO, maxO },
  };
}

// An ellipse's inside, as an approximate signed distance (positive inside).
// Square roots, not Math.hypot, which takes several times as long: the
// heightmap's build calls this a few million times. It is (1 - k0) times
// k0 / k1, the ellipse's scale in the point's direction: ra along one axis,
// ro along the other. At the centre, where every direction meets, that
// would jump between them, and the distance with it, by 100 m on the main
// lobe. Out to ELLIPSE_EASE of the way to the shore it eases in from the
// smaller, the centre's true distance to the shore, so the distance runs on
// through the centre, falls away from it all round, and changes by about a
// metre a metre (at most 1.05), as the slopes set in it (the hills' rise from
// the shore) assume. Near the shore and outside it is as it was.
const ELLIPSE_EASE = 0.9;
export function ellipse(a, o, { a: ca, o: co, ra, ro, cos, sin }) {
  const da = a - ca;
  const dz = o - co;
  const x = da * cos + dz * sin;
  const y = -da * sin + dz * cos;
  const u0 = x / ra;
  const v0 = y / ro;
  const u1 = x / (ra * ra);
  const v1 = y / (ro * ro);
  const k0 = Math.sqrt(u0 * u0 + v0 * v0);
  const k1 = Math.sqrt(u1 * u1 + v1 * v1);
  const near = Math.min(ra, ro);
  if (k1 < 1e-9) return near;
  return (1 - k0) * (near + (k0 / k1 - near) * smoothstep(0, ELLIPSE_EASE, k0));
}

// A chain of capsules along [a, o, radius] segments, the radius running along
// each, as an approximate signed distance (positive inside).
function capsuleInside(a, o, chain) {
  let d = -Infinity;
  for (const s of chain) {
    const { t, dist } = segment(a, o, s.ax, s.ao, s.bx, s.bo);
    d = Math.max(d, s.ha + (s.hb - s.ha) * t - dist);
  }
  return d;
}

// The closest point of segment a-b to p: how far along (0 to 1) and how far
// away. Returns the same object every time, so read it before the next call.
// A segment of no length (a point repeated in a path) is its start.
const hit = { t: 0, dist: 0 };
function segment(px, pz, ax, az, bx, bz) {
  const abx = bx - ax;
  const abz = bz - az;
  const length2 = abx * abx + abz * abz;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * abx + (pz - az) * abz) / length2)) : 0;
  const dx = px - ax - t * abx;
  const dz = pz - az - t * abz;
  hit.t = t;
  hit.dist = Math.sqrt(dx * dx + dz * dz);
  return hit;
}

// The value t of the way from range[0] to range[1].
function between([from, to], t) {
  return from + (to - from) * t;
}

export function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1; // a step, not 0 / 0
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Polynomial smooth minimum and maximum: within k of each other, a and b blend.
export function smin(a, b, k) {
  if (!(k > 0)) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

export function smax(a, b, k) {
  return -smin(-a, -b, k);
}

// The larger of a and b, the corner where they cross rounded within k of each
// other from below: never above the larger. Where two pieces of one shape meet
// as high as each other, smax would raise them by k / 4.
export function roundMax(a, b, k) {
  return a + (b - a) * smoothstep(-k, k, b - a);
}

// |x| with its corner at 0 rounded off within about `round` of it: a fold
// made of it is a curve, not an edge.
function softAbs(x, round) {
  return (x * x) / Math.sqrt(x * x + round * round);
}

function softplus(x, k) {
  return x > 20 * k ? x : k * Math.log1p(Math.exp(x / k));
}
