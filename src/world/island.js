// The island's shape: the one height function (CLAUDE.md §6), and the placement
// zones from the reef to the jungle. Pure and Node-importable: JS evaluates it
// for placement and collision, the GPU gets it as a heightmap, and nothing
// re-implements it in WGSL.
//
// Everything hangs off the coast: a signed distance to the shore (positive
// inland) built from shapes, from which the beach, the seabed and the zones
// follow by how far a point lies from the water. The reef follows a line of
// its own, smoother than the coast. The hills are a volcano, a steep cone on a
// broad shield cut by valleys that radiate from the summit, one of them
// running down to the cove, with the ridges that frame the cove on top.
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
// What is drawn is the heightmap made from this (world/heightmap.js), which
// misses it by centimetres in the bay and up to decimetres, on cliffs metres,
// on the coarser grids: anything that stands on the ground takes its height
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

// The ground's band and reef offset (groundOf) are held within these: beyond
// them they tell nothing more, and on the GPU their half floats stay precise.
const BAND_RANGE = [-1, 4];
const REEF_RANGE = 250;

// rng: a seeded random factory (core/random.js createRandom), so the seed shapes
// the island. sunsetYaw: the view yaw (views.js) looking into the setting sun.
export function createIsland(rng, settings = config.world.island, sunsetYaw = config.sky.sun.sunsetYaw) {
  const { size, cove, coast, hills, shore, seabed, zones } = settings;
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
  const ridges = hills.ridges.flatMap(segments);
  const coveAngle = Math.atan2(-summitA, -summitO); // from the summit down to the beach

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
  // sudden change would leave a cliff running inland.
  function beachiness(a, o, w, broad) {
    const { sand } = cove;
    let b = (1 - smoothstep(sand.headland[0], sand.headland[1], a)) * (sand.far[2] + (1 - sand.far[2]) * smoothstep(sand.far[0], sand.far[1], a));
    b *= 1 - smoothstep(-sand.fade, 0, capsuleInside(a, o, headland));
    if (w > 0) {
      const { islandSand } = shore;
      const n = zoneNoise(a / islandSand.wavelength, o / islandSand.wavelength);
      const island = smoothstep(...islandSand.edges, islandSand.noise * n + bayness(a, o, broad));
      b += w * (island - b);
    }
    return b;
  }

  // How much the coast curves round the water near a, o, per km: positive in a
  // bay, negative on a point. The broad coast's Laplacian over bayScale metres,
  // only near the shore, where it decides the beach; it fades out away from it.
  function bayness(a, o, broad) {
    const near = 1 - smoothstep(250, 350, Math.abs(broad));
    if (near === 0) return 0;
    const s = shore.islandSand.bayScale;
    const at = (da, dO) => broadCoast(a + da, o + dO, islandWeight(a + da, o + dO));
    return (near * 1000 * (at(s, 0) + at(-s, 0) + at(0, s) + at(0, -s) - 4 * broad)) / (s * s);
  }

  // The hills, as heights above sea level before they meet the shore.
  function hillHeight(a, o, w) {
    const { warp, detail, gullies } = hills;
    const wa = a + warp.amplitude * hillNoise(a / warp.wavelength + 5.2, o / warp.wavelength);
    const wo = o + warp.amplitude * hillNoise(a / warp.wavelength - 7.4, o / warp.wavelength + 3.3);

    // The main volcano, its valley down to the cove, and older, lower ones on
    // the island's other lobes.
    let h = volcano(wa, wo, summit, true);
    if (w > 0) for (const p of peaks) h = smax(h, w * volcano(wa, wo, p, false), hills.join);

    // The ridges that frame the cove.
    for (const s of ridges) h = smax(h, ridgeHeight(wa, wo, s, hills), hills.join);
    if (h <= 0) return 0;

    const bumps = (detail.share * h + detail.base) * fbm(hillNoise, wa / detail.wavelength, wo / detail.wavelength, detail.octaves);
    const groove = 1 - Math.abs(fbm(hillNoise, wa / gullies.wavelength + 50.1, wo / gullies.wavelength - 20.7, 3));
    return Math.max(0, h + bumps - gullies.share * h * groove * groove);
  }

  // A volcano worn down by valleys that radiate from its top: a steep cone on a
  // broad shield, cut where noise read around a circle (so it wraps without a
  // seam) is far from zero. Ridges run where it crosses zero, sharp; the
  // valleys between them are broad. Further down there is room for more, and
  // the valleys branch. With `toCove`, one valley runs down to the cove's beach.
  function volcano(wa, wo, v, toCove) {
    const { valleys } = hills;
    const da = wa - v.a;
    const dz = wo - v.o;
    const r2 = da * da + dz * dz;
    const r = Math.sqrt(r2);
    const fromTop = Math.sqrt(r2 + hills.summitRound * hills.summitRound) - hills.summitRound;
    let h = 0;
    for (const [share, falloff] of v.profile) h += share * v.height * Math.exp(-fromTop / falloff);
    if (r <= valleys.from) return h;
    const c = dz / r;
    const s = da / r;
    let open = 0;
    let total = 0;
    for (let k = 0; k < valleys.branch.length + 1; k++) {
      const weight = k === 0 ? 1 : smoothstep(valleys.branch[k - 1][0], valleys.branch[k - 1][1], r);
      if (weight === 0) break;
      const around = (v.valleys << k) / (2 * Math.PI);
      open += weight * Math.abs(hillNoise(around * c + r / valleys.length + 13.7 * k + v.a / 97, around * s - 4.1 * k + v.o / 89));
      total += weight;
    }
    let cut = valleys.depth * Math.min(1, open / total / valleys.saturate);
    if (toCove) {
      const off = Math.atan2(s * Math.cos(coveAngle) - c * Math.sin(coveAngle), c * Math.cos(coveAngle) + s * Math.sin(coveAngle));
      const along = Math.exp(-((off / (valleys.cove.width * DEG)) ** 2));
      cut += along * (valleys.cove.depth - cut);
    }
    return h * (1 - cut * smoothstep(valleys.from, valleys.full, r));
  }

  // The shore's own rise inland: a beach with a berm and a gentle plain behind
  // it, or a steep rocky shore.
  function shoreHeight(d, b, a, o) {
    const { beach, rocky, undulation } = shore;
    // The plain rises from plainFrom metres inland, eased in: less the ease's
    // own little rise at the waterline, so the beach starts at the sea.
    const plainIn = softplus(d - beach.plainFrom, 10) - softplus(-beach.plainFrom, 10);
    const sandy = beach.berm * Math.tanh(d / beach.bermWidth) + beach.plain * (1 - Math.exp(-plainIn / beach.plainReach));
    const rockyRise = rocky.lip * Math.tanh(d / rocky.lipWidth) + rocky.rise * (1 - Math.exp(-d / rocky.reach));
    const swell = undulation.amplitude * smoothstep(...undulation.from, d) * hillNoise(a / undulation.wavelength - 40.2, o / undulation.wavelength + 8.8);
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
    const b = beachiness(a, o, w, broad);
    const reef = reefOffset(a, o, w, broad);
    let height;
    if (d >= 0) {
      const base = shoreHeight(d, b, a, o);
      const taper = smoothstep(0, shore.rocky.hillReach + b * (shore.beach.hillReach - shore.rocky.hillReach), d);
      height = smax(base, hillHeight(a, o, w) * taper, shore.hillJoin * taper);
    } else {
      height = seabedHeight(-d, reef, b, a, o);
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
  // run), into `out`: how much of it is sand and how much rock (the rest is
  // green), `band`, how far into the green it lies (0 where the shore's band
  // ends, 1 where the scrub does, 2 where the palm belt does), the reef's
  // offset, and `sandy`, how much of the soil is sand: behind a beach, whose
  // sand the wind carries inland, fading over zones.sandy metres, and only as
  // steep as sand holds. The one definition of the ground: world/heightmap.js
  // keeps it per sample of its grids, for the GPU and for placement alike, and
  // the zones follow from it (zoneFrom).
  const rockSlope = zones.rockSlope.map((deg) => Math.tan(deg * DEG));
  const sandSlope = zones.sandSlope.map((deg) => Math.tan(deg * DEG));
  function groundOf(s, slope, out = {}) {
    const { coast: d, beach: b, a, o } = s;
    // The bands' edges inland swing with the same slow noise, so they keep their order.
    const n = zoneNoise(a / zones.wavelength + 70.3, o / zones.wavelength - 15.1);
    const into = d - (zones.shore + zones.shoreSwing * n);
    const palmBelt = zones.palmBelt + zones.palmBeltSwing * n;
    const band = into < zones.scrub ? into / zones.scrub : 1 + (into - zones.scrub) / palmBelt;
    // The shore's band is sand as far as the shore is sandy and the ground
    // flat enough for sand to lie on, and rock otherwise; inland, ground too
    // steep for soil is rock. The sand in sandy soil gives way on slopes as
    // the beach's does.
    const onShore = 1 - smoothstep(-zones.edge, zones.edge, into);
    const holds = 1 - smoothstep(sandSlope[0], sandSlope[1], slope);
    const sand = smoothstep(0.4, 0.6, b) * holds;
    const steep = smoothstep(rockSlope[0], rockSlope[1], slope);
    out.sand = onShore * sand;
    out.rock = onShore * (1 - sand) + (1 - onShore) * steep;
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

  // The zone of a sampled point, given the ground's slope there.
  const zoneOf = (s, slope) => zoneFrom(groundOf(s, slope), s.height);

  const scratch = {};
  const heightAt = (x, z) => evaluate(side * (x * right[0] + z * right[1]), x * forward[0] + z * forward[1], scratch).height;

  // Slope (rise over run) by central differences over `step` metres.
  function slope(x, z, step = 0.5) {
    const gx = (heightAt(x + step, z) - heightAt(x - step, z)) / (2 * step);
    const gz = (heightAt(x, z + step) - heightAt(x, z - step)) / (2 * step);
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
    // { height, coast, beach, reef, a, o }: the height, the signed distance to the
    // shore (positive inland), how sandy the shore is (0 to 1), the distance out
    // to sea from the reef's crest, and the point in the cove's frame.
    sample: (x, z) => sampleCove(...toCove(x, z)),
    // The ground of a sample, given its slope (groundOf); the zone of a ground
    // and height; the zone of a sample, given its slope; and at world x, z
    // (five evaluations, about 7 µs: placement reads the drawn ground's,
    // world/heightmap.js zoneAt, which is also what the GPU draws).
    groundOf,
    // How lush the green is, given the ground and its relief (lushOf).
    lushOf,
    zoneFrom,
    zoneOf,
    zone: (x, z) => zoneOf(sampleCove(...toCove(x, z)), slope(x, z)),
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

// A polyline of [a, o, height] points as segments.
function segments(points) {
  return points.slice(1).map((p, i) => {
    const [ax, ao, ha] = points[i];
    const [bx, bo, hb] = p;
    return { ax, ao, bx, bo, ha, hb };
  });
}

// A ridge along a segment: rounded on top, its flanks steepest about 0.7 x
// its width out and gone by three widths.
function ridgeHeight(a, o, s, { crestRadius, flankSlope, width: [minWidth, maxWidth] }) {
  const { t, dist } = segment(a, o, s.ax, s.ao, s.bx, s.bo);
  const H = s.ha + (s.hb - s.ha) * t;
  const width = Math.min(Math.max((0.86 * H) / flankSlope, minWidth), maxWidth);
  const off = (Math.sqrt(dist * dist + crestRadius * crestRadius) - crestRadius) / width;
  if (off > 3) return 0;
  return H * Math.exp(-off * off);
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
function ellipse(a, o, { a: ca, o: co, ra, ro, cos, sin }) {
  const da = a - ca;
  const dz = o - co;
  const x = da * cos + dz * sin;
  const y = -da * sin + dz * cos;
  const k0 = Math.hypot(x / ra, y / ro);
  const k1 = Math.hypot(x / (ra * ra), y / (ro * ro));
  if (k1 < 1e-9) return Math.min(ra, ro);
  return -(k0 * (k0 - 1)) / k1;
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

function softplus(x, k) {
  return x > 20 * k ? x : k * Math.log1p(Math.exp(x / k));
}
