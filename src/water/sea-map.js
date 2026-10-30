// What the sea knows of the island (PLAN.md Stage 6.2), worked out once per seed
// from the ground as drawn (world/heightmap.js), so the waterline it knows is
// the one on screen. Pure and Node-importable; water/water.js uploads it, and
// water/sea-map.wgsl reads it as at() does here. Per sample of a grid in the
// cove's frame, over the coarsest grid's square:
//
//   shore  m to the nearest waterline, across the ground: + out at sea, - on land
//   depth  m of water over the ground as drawn: - on land
//   toShoreA, toShoreO  the way there, a unit vector (a, o), or 0 where no sea is
//   reef   m to the nearest line of the reef's crest under the sea: + seaward of it, - inside
//   swell  how much of the open sea's swell reaches here, 0 to 1
//   wind   how much of the wind's chop has grown here, 0 to 1
//   surf   how much of the swell breaks here, 0 to 1
//
// A swell runs in from the open sea, spread over a fan of directions, and can't
// stand taller than the water under it allows: what the crest of the reef
// (or any shallows) takes from it breaks there, and that is the surf; behind it
// the swell stays as small as the shallowest water it crossed. Land stops it.
// The wind's chop grows with how far the wind has blown over open water.
// config.water.map holds the numbers.

// How far a wave's swell is held by the water under it, as a share of the open
// sea's: all of it down to `breaks` m deep, less and less over shallower water.
const heldBy = (depth, breaks) => Math.max(Math.min(depth / breaks, 1), 0);

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
  const toShoreA = new Float32Array(count);
  const toShoreO = new Float32Array(count);
  downhill(shore, samples, toShoreA, toShoreO);

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

  // The wind: how far it has blown over water, from every direction of its fan.
  const wind = new Float32Array(count);
  const fetch = new Float32Array(count);
  const { blows, gusts, fetch: fullFetch, depth: chopDepth } = settings.wind;
  gusts.forEach(([degrees, share]) => {
    const blowing = outward(blows + degrees, side);
    const step = texel * Math.hypot(blowing[0], blowing[1]) / Math.max(Math.abs(blowing[0]), Math.abs(blowing[1]));
    sweep(samples, blowing, fullFetch * 4, (n, before) => {
      fetch[n] = heights[n] < 0 ? before + step : 0;
    }, fetch);
    for (let n = 0; n < count; n++) wind[n] += share * (1 - Math.exp(-fetch[n] / fullFetch));
  });
  for (let n = 0; n < count; n++) wind[n] *= heldBy(shallowest(n), chopDepth);

  return {
    origin,
    texel,
    samples,
    shore,
    depth: depths,
    reef,
    toShoreA,
    toShoreO,
    swell,
    wind,
    surf,
    // The map at a, o in the cove's frame, into `out`, bilinear as the GPU filters it.
    at(a, o, out = {}) {
      const last = samples - 1;
      const fx = Math.min(Math.max((a - origin[0]) / texel, 0), last);
      const fy = Math.min(Math.max((o - origin[1]) / texel, 0), last);
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
      out.surf = mix(surf);
      out.toShoreA = mix(toShoreA);
      out.toShoreO = mix(toShoreO);
      return out;
    },
  };
}

// The two layers of half floats the GPU reads (water/sea-map.wgsl): shore, depth,
// swell, wind, which every pixel of water needs; the way to the shore, surf, reef.
export function seaMapLayers({ shore, depth, reef, swell, wind, toShoreA, toShoreO, surf }, half) {
  const count = shore.length;
  const first = new Uint16Array(4 * count);
  const second = new Uint16Array(4 * count);
  for (let n = 0; n < count; n++) {
    first[4 * n] = half(shore[n]);
    first[4 * n + 1] = half(depth[n]);
    first[4 * n + 2] = half(swell[n]);
    first[4 * n + 3] = half(wind[n]);
    second[4 * n] = half(toShoreA[n]);
    second[4 * n + 1] = half(toShoreO[n]);
    second[4 * n + 2] = half(surf[n]);
    second[4 * n + 3] = half(reef[n]);
  }
  return [first, second];
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

// The unit way down a distance field at each sample, from its neighbours.
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
