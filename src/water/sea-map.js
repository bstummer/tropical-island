// What the sea knows of the island (PLAN.md Stage 6.2), worked out once per seed
// from the ground as drawn (world/heightmap.js), so the waterline it knows is
// the one on screen. Pure and Node-importable; water/water.js uploads it, and
// water/sea-map.wgsl reads it as at() does here. Per sample of a grid in the
// cove's frame, over the coarsest grid's square:
//
//   shore  m to the nearest waterline, across the ground: + out at sea, - on land
//   depth  m of water over the ground as drawn: - on land
//   inlandA, inlandO  the way inland, a unit vector (a, o): the waterline lies `shore` m
//          along it, from land as from the sea, and it runs on smoothly across the waterline
//   reef   m to the nearest line of the reef's crest under the sea: + seaward of it, - inside
//   swell  how much of the open sea's swell reaches here, 0 to 1
//   wind   how much of the wind's chop has grown here, 0 to 1
//   chop   how much of the chop reaches here, 0 to 1: the wind's own, or the open sea's
//   surf   how much of the swell breaks here, 0 to 1
//   breaks how hard the surf breaks round here, 0 to 1: the surf over tens of metres,
//          what its foam runs in over (water/surf.js)
//   late   s a wave of the swell gets here later than one over deep water would
//   wayA, wayO  the way it runs here, a unit vector (a, o)
//   speed  m/s it runs at here
//
// A swell runs in from the open sea, spread over a fan of directions, and can't
// stand taller than the water under it allows: what the crest of the reef
// (or any shallows) takes from it breaks there, and that is the surf; behind it
// the swell stays as small as the shallowest water it crossed. Land stops it.
// The wind's chop grows with how far the wind has blown over open water. The open sea's
// comes in with the swell and breaks on the shallows as it does, but its lower waves
// cross more of them, and run on over a reef's flat as broken waves that die away over
// tens of metres: so the roughness of the open sea fades into the calm of a lagoon,
// with no line on the water between them. A wave front
// slows over shallow water, so it bends round what is shallow and bunches up over it:
// when it reaches each place is worked out as light's would be, through water whose
// speed goes by its depth. config.water.map holds the numbers.
//
// Past the map's square the open sea goes on: at() and the GPU read its edge, and
// over `open.over` m beyond it (as far as a sample is past the square) what
// the island held back there gives way to the open sea's: all the swell and the
// wind, no surf, the reef `open.reef` m off, so nothing the island did runs on to
// the horizon in a straight lane (water/sea-map.wgsl seaKept is the twin).

import { smoothstep } from '../world/island.js';

const G = 9.81;
const SHALLOWEST = 0.1; // m: what a wave runs over on land and at the waterline, so it gets round them

// How fast a wave of this period runs over water this deep (m/s): the dispersion
// relation, in Fenton and McKee's (1990) closed form.
export function waveSpeed(depth, period) {
  const inDeep = (G * period) / (2 * Math.PI);
  if (depth === Infinity) return inDeep;
  const x = ((2 * Math.PI) / period) * Math.sqrt(Math.max(depth, SHALLOWEST) / G);
  return inDeep * Math.tanh(x ** 1.5) ** (2 / 3);
}

// How far a wave's swell is held by the water under it, as a share of the open
// sea's: all of it down to `breaks` m deep, less and less over shallower water.
const heldBy = (depth, breaks) => Math.max(Math.min(depth / breaks, 1), 0);

// The mean of `values` over a square `radius` samples each way: twice along each axis, as rounder.
function roundAbout(values, samples, radius) {
  let from = values;
  for (let pass = 0; pass < 2; pass++) {
    for (const stride of [1, samples]) {
      const across = stride === 1 ? samples : 1;
      const to = new Float32Array(from.length);
      for (let line = 0; line < samples; line++) {
        let sum = 0;
        const at = (k) => from[line * across + Math.min(Math.max(k, 0), samples - 1) * stride];
        for (let k = -radius; k <= radius; k++) sum += at(k);
        for (let k = 0; k < samples; k++) {
          to[line * across + k * stride] = sum / (2 * radius + 1);
          sum += at(k + radius + 1) - at(k - radius);
        }
      }
      from = to;
    }
  }
  return from;
}

// Directions in the cove's frame, degrees to the right of straight out to sea
// for someone facing it (`side`: config.world.island.cove.headlandSide).
function outward(degrees, side) {
  const t = (degrees * Math.PI) / 180;
  return [side * Math.sin(t), Math.cos(t)];
}

export function buildSeaMap(heightmap, settings, side, blend = 0) {
  const { levels } = heightmap;
  const coarsest = levels.at(-1);
  const scale = coarsest.texel / settings.texel;
  if (!Number.isInteger(scale)) throw new Error(`sea map: ${settings.texel} m samples don't fit the ${coarsest.texel} m grid`);
  const samples = coarsest.samples * scale;
  const { texel } = settings;
  const { origin } = coarsest;
  const count = samples * samples;

  const { heights, offsets, highest } = groundOnLines(levels, samples, texel, blend);

  const shore = signedDistance(heights, samples, texel, (n) => heights[n] < 0);
  const reef = signedDistance(offsets, samples, texel, (n) => offsets[n] >= 0, (n) => heights[n] < 0);
  const inlandA = new Float32Array(count);
  const inlandO = new Float32Array(count);
  downhill(shore, samples, inlandA, inlandO);

  const depths = new Float32Array(count);
  for (let n = 0; n < count; n++) depths[n] = -heights[n];
  // What holds a wave back is the shallowest water round a sample: a crest
  // narrower than the samples are apart would let it stand taller than the
  // water over the crest, which would show in its troughs.
  const shallowest = (n) => Math.max(-highest[n], 0);

  // The swell: over each direction of its fan, sweeping in from the open sea.
  const swell = new Float32Array(count);
  const surf = new Float32Array(count);
  const reach = new Float32Array(count);
  const lost = new Float32Array(count);
  const { from, spread, breaks } = settings.swell;
  spread.forEach(([degrees, share]) => {
    const inward = outward(from + degrees, side).map((v) => -v);
    sweep(samples, inward, 1, (n, before, across) => {
      const held = heldBy(shallowest(n), breaks);
      const arriving = before * (1 - settings.swell.spreading) + across * settings.swell.spreading;
      reach[n] = Math.min(arriving, held);
      lost[n] = Math.max(arriving - held, 0);
    }, reach);
    for (let n = 0; n < count; n++) {
      swell[n] += share * reach[n];
      surf[n] += share * lost[n];
    }
  });
  for (let n = 0; n < count; n++) surf[n] = Math.min((surf[n] * settings.swell.surf) / settings.texel, 1);
  const breaking = roundAbout(surf, samples, Math.max(Math.round(settings.swell.round / texel), 1));
  for (let n = 0; n < count; n++) breaking[n] = Math.min(breaking[n] / settings.swell.full, 1);

  // The wind: how far it has blown over water, from every direction of its fan.
  const wind = new Float32Array(count);
  const fetch = new Float32Array(count);
  const { blows, gusts, fetch: fullFetch, depth: chopDepth, grows } = settings.wind;
  gusts.forEach(([degrees, share]) => {
    const blowing = outward(blows + degrees, side);
    const step = texel * Math.hypot(blowing[0], blowing[1]) / Math.max(Math.abs(blowing[0]), Math.abs(blowing[1]));
    sweep(samples, blowing, fullFetch * 4, (n, before) => {
      // Shallow water holds it back, whatever it has crossed: behind a reef's crest it starts over.
      fetch[n] = heights[n] < 0 ? Math.min(before + step, grows * shallowest(n) ** 2) : 0;
    }, fetch);
    for (let n = 0; n < count; n++) wind[n] += share * (1 - Math.exp(-fetch[n] / fullFetch));
  });
  for (let n = 0; n < count; n++) wind[n] *= heldBy(shallowest(n), chopDepth);

  // The chop, carried along each way of a fan: held by the water as the swell is, and
  // what gets over the shallows dies away over them, faster the shallower they are;
  // `raised(n)`, what the wind raises there itself, takes over where it is more.
  const { breaks: chopBreaks, dies, deep, spreading, round } = settings.chop;
  // Per sample, how much of it the water holds, and how fast it dies away there, per metre.
  const holds = new Float32Array(count);
  const dying = new Float32Array(count);
  for (let n = 0; n < count; n++) {
    const depth = shallowest(n);
    holds[n] = heldBy(depth, chopBreaks);
    dying[n] = depth < deep ? (1 - smoothstep(deep / 2, deep, depth)) / (dies * Math.max(depth, SHALLOWEST)) : 0;
  }
  const carried = (fan, way, raised) => {
    const out = new Float32Array(count);
    fan.forEach(([degrees, share]) => {
      const along = way(degrees);
      const step = (texel * Math.hypot(along[0], along[1])) / Math.max(Math.abs(along[0]), Math.abs(along[1]));
      sweep(samples, along, 1, (n, before, across) => {
        const arriving = (before * (1 - spreading) + across * spreading) * (dying[n] > 0 ? Math.exp(-step * dying[n]) : 1);
        reach[n] = Math.max(Math.min(arriving, holds[n]), raised ? raised[n] : 0);
      }, reach);
      for (let n = 0; n < count; n++) out[n] += share * reach[n];
    });
    return out;
  };
  // The open sea's, in with the swell; the wind's own, along its way, so it too fades
  // behind a crest it blew over before it grows again.
  const raised = wind.map((w) => w * w);
  const open = carried(spread, (degrees) => outward(from + degrees, side).map((v) => -v), null);
  const blown = carried(gusts, (degrees) => outward(blows + degrees, side), raised);
  for (let n = 0; n < count; n++) open[n] = Math.max(open[n], blown[n]);
  // Softened, but never more than the water holds: deeper troughs would bare a crest.
  const softened = roundAbout(open, samples, Math.max(Math.round(round / texel / 2), 1));
  const chop = new Float32Array(count);
  for (let n = 0; n < count; n++) chop[n] = depths[n] > 0 ? Math.max(raised[n], Math.min(softened[n], holds[n])) : 0;

  // When the swell's waves get to each place, and which way they run there.
  const speed = new Float32Array(count);
  for (let n = 0; n < count; n++) speed[n] = waveSpeed(depths[n], settings.swell.period);
  const running = outward(from, side).map((v) => -v);
  const { late, wayA, wayO } = arrivals(speed, samples, texel, running, waveSpeed(Infinity, settings.swell.period));

  return {
    origin,
    texel,
    samples,
    shore,
    depth: depths,
    reef,
    inlandA,
    inlandO,
    swell,
    wind,
    chop,
    surf,
    breaks: breaking,
    late,
    wayA,
    wayO,
    speed,
    // The map at a, o in the cove's frame, into `out`, bilinear as the GPU filters it.
    at(a, o, out = {}) {
      const last = samples - 1;
      const ua = (a - origin[0]) / texel;
      const uo = (o - origin[1]) / texel;
      const fx = Math.min(Math.max(ua, 0), last);
      const fy = Math.min(Math.max(uo, 0), last);
      const i = Math.min(Math.floor(fx), last - 1);
      const j = Math.min(Math.floor(fy), last - 1);
      const tx = fx - i;
      const ty = fy - j;
      const n = j * samples + i;
      const mix = (v) => {
        const bottom = v[n] + (v[n + 1] - v[n]) * tx;
        const top = v[n + samples] + (v[n + samples + 1] - v[n + samples]) * tx;
        return bottom + (top - bottom) * ty;
      };
      out.shore = mix(shore);
      out.depth = mix(depths);
      out.reef = mix(reef);
      out.swell = mix(swell);
      out.wind = mix(wind);
      out.chop = mix(chop);
      out.surf = mix(surf);
      out.breaks = mix(breaking);
      out.inlandA = mix(inlandA);
      out.inlandO = mix(inlandO);
      out.late = mix(late);
      out.wayA = mix(wayA);
      out.wayO = mix(wayO);
      out.speed = mix(speed);
      // Past the edge, the open sea.
      const kept = 1 - smoothstep(0, settings.open.over, texel * Math.hypot(ua - fx, uo - fy));
      if (kept < 1) {
        out.swell = 1 + (out.swell - 1) * kept;
        out.wind = 1 + (out.wind - 1) * kept;
        out.chop = 1 + (out.chop - 1) * kept;
        out.surf *= kept;
        out.breaks *= kept;
        out.reef = settings.open.reef + (out.reef - settings.open.reef) * kept;
      }
      return out;
    },
  };
}

// The three layers of half floats the GPU reads (water/sea-map.wgsl): shore, depth,
// swell, chop, which every pixel of water needs; the way inland, breaks, reef; the
// swell's waves. `late` stays small where they break, so half floats hold it finely.
const LAYERS = [
  ['shore', 'depth', 'swell', 'chop'],
  ['inlandA', 'inlandO', 'breaks', 'reef'],
  ['late', 'wayA', 'wayO', 'speed'],
];

// The same at each of `levels` mip levels, [level][layer], each texel the mean of
// those under it, but for how deep the water is: the mean over the water under it
// alone, as a ray that lands in the water there goes through only that
// (water-seen.wgsl), and land counted in, its depth below 0, would make a steep
// shore's water read shallow from afar. Over land alone, the land's. Each level's
// side is half the last's, rounded down as a texture's mip levels are: a texel of
// an even side's level covers the four under it, of an odd side's what it spans.
export function seaMapLevels(map, half, levels) {
  let size = Math.round(Math.sqrt(map.shore.length));
  let values = LAYERS.map((names) => names.map((name) => Float32Array.from(map[name])));
  let water = Float32Array.from(map.depth, (d) => (d > 0 ? 1 : 0)); // how much of each is water
  const out = [];
  for (let level = 0; level < levels; level++) {
    if (level) {
      if (size === 1) throw new Error(`sea map: ${Math.sqrt(map.shore.length)} samples have fewer than ${levels} mip levels`);
      const next = Math.floor(size / 2);
      const taps = halving(size, next);
      values = values.map((layer, l) => layer.map((v, c) => meanOver(v, size, next, taps, l === 0 && c === 1 ? water : null)));
      water = meanOver(water, size, next, taps, null);
      size = next;
    }
    out.push(
      values.map((layer) => {
        const texels = new Uint16Array(4 * size * size);
        for (let n = 0; n < size * size; n++) for (let c = 0; c < 4; c++) texels[4 * n + c] = half(layer[c][n]);
        return texels;
      }),
    );
  }
  return out;
}

// What a texel of a side `next` long covers of a side `size` long under it, along
// one axis: texel i's taps from first[i] to first[i + 1], each an index and its
// share, the shares adding up to 1.
function halving(size, next) {
  const first = new Int32Array(next + 1);
  const index = [];
  const share = [];
  for (let i = 0; i < next; i++) {
    first[i] = index.length;
    const [from, to] = [(i * size) / next, ((i + 1) * size) / next];
    for (let k = Math.floor(from); k < Math.min(Math.ceil(to), size); k++) {
      index.push(k);
      share.push((Math.min(k + 1, to) - Math.max(k, from)) / (to - from));
    }
  }
  first[next] = index.length;
  return { first, index: Int32Array.from(index), share: Float64Array.from(share) };
}

// `values`, `size` square, at the level above, `next` square: each texel the mean
// of what it covers, or with `weights` the mean weighted by them (the plain mean
// where they are all 0).
function meanOver(values, size, next, { first, index, share }, weights) {
  const to = new Float32Array(next * next);
  for (let j = 0; j < next; j++) {
    for (let i = 0; i < next; i++) {
      let [plain, sum, w] = [0, 0, 0];
      for (let b = first[j]; b < first[j + 1]; b++) {
        const row = index[b] * size;
        for (let a = first[i]; a < first[i + 1]; a++) {
          const n = row + index[a];
          const part = share[b] * share[a];
          plain += part * values[n];
          if (weights) {
            w += part * weights[n];
            sum += part * weights[n] * values[n];
          }
        }
      }
      to[j * next + i] = w > 0 ? sum / w : plain;
    }
  }
  return to;
}

// The drawn height and the crest's offset on the map's sample lines, read from
// the grids' own samples, a hundred times faster than sampling them (and as
// sharp, the lines being theirs): the coarsest grid's, bilinear between its lines
// out in the deep, where the swell and the wind care little, then each finer one
// where it has its full say (world/heightmap.js weight; `blend`: its fade, in
// samples). `highest`: the highest of the finest grid's samples round each.
function groundOnLines(levels, samples, texel, blend) {
  const heights = new Float32Array(samples * samples);
  const offsets = new Float32Array(samples * samples);
  const highest = new Float32Array(samples * samples);
  const [a0, o0] = levels.at(-1).origin;
  for (let k = levels.length - 1; k >= 0; k--) {
    const level = levels[k];
    const stride = texel / level.texel; // its samples between the map's lines
    const inMap = level.texel / texel; // and the map's between its lines, for the coarsest
    if (k === levels.length - 1) {
      const last = level.samples - 1;
      for (let j = 0, n = 0; j < samples; j++) {
        const fy = Math.min(j / inMap, last);
        const y = Math.min(Math.floor(fy), last - 1);
        for (let i = 0; i < samples; i++, n++) {
          const fx = Math.min(i / inMap, last);
          const x = Math.min(Math.floor(fx), last - 1);
          const m = y * level.samples + x;
          const mix = (v, s, c) => {
            const bottom = v[s * m + c] + (v[s * (m + 1) + c] - v[s * m + c]) * (fx - x);
            const top = v[s * (m + level.samples) + c] + (v[s * (m + level.samples + 1) + c] - v[s * (m + level.samples) + c]) * (fx - x);
            return bottom + (top - bottom) * (fy - y);
          };
          heights[n] = highest[n] = mix(level.heights, 1, 0);
          offsets[n] = mix(level.info, 4, 3);
        }
      }
      continue;
    }
    if (!Number.isInteger(stride)) throw new Error(`sea map: ${texel} m samples don't fit the ${level.texel} m grid`);
    const start = (level.origin[0] - a0) / texel;
    const startO = (level.origin[1] - o0) / texel;
    const margin = 1 + blend;
    for (let y = 0; y < level.samples; y += stride) {
      if (y < margin || y > level.samples - 1 - margin) continue;
      const j = startO + y / stride;
      for (let x = 0; x < level.samples; x += stride) {
        if (x < margin || x > level.samples - 1 - margin) continue;
        const i = start + x / stride;
        const n = j * samples + i;
        const m = y * level.samples + x;
        heights[n] = level.heights[m];
        offsets[n] = level.info[4 * m + 3];
        let top = heights[n];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) top = Math.max(top, level.heights[m + dy * level.samples + dx]);
        }
        highest[n] = top;
      }
    }
  }
  return { heights, offsets, highest };
}

// Fills each sample, in the order a wave running this way reaches them: step(n,
// what arrives from the sample behind it, what arrives from those beside that
// one), reading `field`, where the grid's upwind edges see `edge` arrive. The
// fan's directions cross the grid at a slant, so a sample's upwind neighbour lies
// between two: read bilinear, which also spreads it sideways as waves spread.
function sweep(samples, [da, dO], edge, step, field) {
  const along = Math.abs(da) >= Math.abs(dO); // the axis it runs along most: columns of a, or rows of o
  const main = along ? da : dO;
  const side = (along ? dO : da) / Math.abs(main);
  const forward = main > 0 ? 1 : -1;
  const lean = side > 0 ? 1 : -1;
  const slant = Math.abs(side);
  const at = (u, v) => (along ? v * samples + u : u * samples + v);
  const us = main > 0 ? [0, samples, 1] : [samples - 1, -1, -1];
  for (let u = us[0]; u !== us[1]; u += us[2]) {
    for (let v = 0; v < samples; v++) {
      const n = at(u, v);
      const pu = u - forward;
      if (pu < 0 || pu >= samples) {
        step(n, edge, edge);
        continue;
      }
      const v0 = v - lean;
      const straight = field[at(pu, v)];
      const beside = v0 < 0 || v0 >= samples ? edge : field[at(pu, v0)];
      const before = straight + (beside - straight) * slant;
      const either = 0.5 * ((v > 0 ? field[at(pu, v - 1)] : edge) + (v < samples - 1 ? field[at(pu, v + 1)] : edge));
      step(n, before, either);
    }
  }
}

// When a wave front running the way `way` from the grid's upwind edges reaches each
// sample, at the speed each has: fast sweeping (Zhao 2005) of the eikonal equation,
// over all four orders of the grid, twice, as what bends round the land runs against some.
// `late`: s behind where a front that kept `inDeep` would be; `wayA`, `wayO`: which way it runs.
function arrivals(speed, samples, texel, way, inDeep) {
  const count = samples * samples;
  const last = samples - 1;
  const plain = (i, j) => ((i * way[0] + j * way[1]) * texel) / inDeep;
  const arrives = new Float64Array(count).fill(Infinity);
  for (let k = 0; k < samples; k++) {
    if (way[0] !== 0) arrives[k * samples + (way[0] > 0 ? 0 : last)] = plain(way[0] > 0 ? 0 : last, k);
    if (way[1] !== 0) arrives[(way[1] > 0 ? 0 : last) * samples + k] = plain(k, way[1] > 0 ? 0 : last);
  }
  const first = (step) => (step > 0 ? 0 : last);
  // Its own way first: that alone settles most of it.
  const steps = [Math.sign(way[0]) || 1, Math.sign(way[1]) || 1];
  const orders = [[steps[0], steps[1]], [-steps[0], steps[1]], [steps[0], -steps[1]], [-steps[0], -steps[1]]];
  for (let round = 0; round < 2; round++) {
    for (const [si, sj] of orders) {
      for (let j = first(sj); j >= 0 && j < samples; j += sj) {
        for (let i = first(si); i >= 0 && i < samples; i += si) {
          const n = j * samples + i;
          const a = Math.min(i > 0 ? arrives[n - 1] : Infinity, i < last ? arrives[n + 1] : Infinity);
          const b = Math.min(j > 0 ? arrives[n - samples] : Infinity, j < last ? arrives[n + samples] : Infinity);
          const slow = texel / speed[n];
          const gap = Math.abs(a - b);
          const t = gap >= slow ? Math.min(a, b) + slow : 0.5 * (a + b + Math.sqrt(2 * slow * slow - gap * gap));
          if (t < arrives[n]) arrives[n] = t;
        }
      }
    }
  }
  const late = new Float32Array(count);
  const wayA = new Float32Array(count);
  const wayO = new Float32Array(count);
  for (let j = 0, n = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++, n++) {
      late[n] = arrives[n] - plain(i, j);
      const da = arrives[j * samples + Math.min(i + 1, last)] - arrives[j * samples + Math.max(i - 1, 0)];
      const dO = arrives[Math.min(j + 1, last) * samples + i] - arrives[Math.max(j - 1, 0) * samples + i];
      const length = Math.hypot(da, dO);
      wayA[n] = length > 1e-6 ? da / length : way[0];
      wayO[n] = length > 1e-6 ? dO / length : way[1];
    }
  }
  return { late, wayA, wayO };
}

// How far each sample lies from where `inside(n)` changes between neighbours, in
// metres: + inside, - outside; only crossings where `where` holds of both count
// (all, by default). `values` says where between two samples it crosses. An
// exact distance transform (Felzenszwalb and Huttenlocher 2012) from those
// crossings, each sample's start the crossing's distance from it.
function signedDistance(values, samples, texel, inside, where = () => true) {
  const count = samples * samples;
  const FAR = 1e12;
  const squared = new Float64Array(count).fill(FAR);
  for (let j = 0, n = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++, n++) {
      for (const m of [i < samples - 1 ? n + 1 : -1, j < samples - 1 ? n + samples : -1]) {
        if (m < 0 || inside(n) === inside(m) || !where(n) || !where(m)) continue;
        const t = Math.abs(values[n]) / Math.max(Math.abs(values[n]) + Math.abs(values[m]), 1e-6);
        squared[n] = Math.min(squared[n], (t * texel) ** 2);
        squared[m] = Math.min(squared[m], ((1 - t) * texel) ** 2);
      }
    }
  }
  const line = new Float64Array(samples);
  const out = new Float64Array(samples);
  const sites = new Int32Array(samples);
  const edges = new Float64Array(samples + 1);
  // Along one row, then one column: the lower envelope of parabolas.
  const pass = (start, stride) => {
    for (let k = 0; k < samples; k++) line[k] = squared[start + k * stride];
    let top = 0;
    sites[0] = 0;
    edges[0] = -Infinity;
    edges[1] = Infinity;
    const w2 = texel * texel;
    for (let q = 1; q < samples; q++) {
      let s;
      for (;;) {
        const p = sites[top];
        s = (line[q] - line[p] + w2 * (q * q - p * p)) / (2 * w2 * (q - p));
        if (s > edges[top]) break;
        top--;
      }
      top++;
      sites[top] = q;
      edges[top] = s;
      edges[top + 1] = Infinity;
    }
    let at = 0;
    for (let q = 0; q < samples; q++) {
      while (edges[at + 1] < q) at++;
      const p = sites[at];
      out[q] = line[p] + w2 * (q - p) * (q - p);
    }
    for (let k = 0; k < samples; k++) squared[start + k * stride] = out[k];
  };
  for (let j = 0; j < samples; j++) pass(j * samples, 1);
  for (let i = 0; i < samples; i++) pass(i, samples);
  const signed = new Float32Array(count);
  for (let n = 0; n < count; n++) signed[n] = (inside(n) ? 1 : -1) * Math.sqrt(squared[n]);
  return signed;
}

// The unit way down a field at each sample, from its neighbours: down a signed
// distance, the way to where it is 0 from the + side, and on through it, so a
// bilinear read across the 0 line (the waterline) still gives a whole way.
function downhill(field, samples, outA, outO) {
  const last = samples - 1;
  for (let j = 0, n = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++, n++) {
      const da = field[j * samples + Math.min(i + 1, last)] - field[j * samples + Math.max(i - 1, 0)];
      const dO = field[Math.min(j + 1, last) * samples + i] - field[Math.max(j - 1, 0) * samples + i];
      const length = Math.hypot(da, dO);
      if (length > 1e-6) {
        outA[n] = -da / length;
        outO[n] = -dO / length;
      }
    }
  }
}
