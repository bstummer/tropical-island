// The sea's waves as a sum of plain waves: which ones, how tall, and how fast
// each turns. Pure and Node-importable. water/waves.js evolves them on the GPU
// and sums them with inverse FFTs (water/waves.wgsl); water/surface.js sums the
// largest in JS, so walking and swimming know the sea that is drawn (CLAUDE.md §5).
//
// After Tessendorf (2001) and Horvath (2015): each wave's height comes from a
// wave spectrum, its phase from the seed, its speed from how deep water carries
// waves. Two seas, each of its own height and period (config.water.waves): the
// swell, long and narrow, coming in from the open sea; and the wind's chop, short
// and spread. As the patches repeat, they hold bands of wavelengths that don't
// overlap: `swell` the swell, `chop` the chop's long waves and `ripples` its
// short ones, so that the sea knows how much of each reaches a point
// (water/sea-map.js) and the patches' sizes, whose ratio isn't a simple one, hide
// each other's repeats.
//
// Frequencies are whole multiples of 2 pi / `loop`, so it all repeats exactly
// after `loop` seconds, and time can wrap before the GPU's floats lose it.

const G = 9.81;

// The waves of one cascade, N x N of them, row by row, as an FFT holds them:
// k = (i, j) x 2 pi / patch for i, j up to N / 2 and (i - N, j - N) x 2 pi / patch
// after. Per wave: `amplitudes` [re, im] of h0(k) and of the conjugate of h0(-k),
// `frequencies` its angular frequency; `choppy`: how far crests lean.
function cascade(size, patch) {
  return { size, patch, amplitudes: new Float32Array(4 * size * size), frequencies: new Float32Array(size * size), choppy: 0 };
}

// JONSWAP's power at angular frequency w for a peak at wp and peak enhancement gamma.
export function jonswap(w, wp, gamma) {
  if (w <= 0) return 0;
  const sigma = w <= wp ? 0.07 : 0.09;
  const r = (w - wp) / (sigma * wp);
  return w ** -5 * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** Math.exp(-0.5 * r * r);
}

// How much of a sea runs at `angle` (radians) off its main direction: a lobe
// narrower the larger `spread` (cos^2s of half the angle).
export function spreading(angle, spread) {
  return Math.abs(Math.cos(angle / 2)) ** (2 * spread);
}

// Which cascade holds wave number k of this sea, or -1: the bands of `bands`,
// [cascade, from, to], don't overlap.
function bandOf(bands, k) {
  for (const [index, from, to] of bands) if (k >= from && k < to) return index;
  return -1;
}

// settings: config.water.waves. direction(degreesRightOfStraightOut) -> a unit
// [x, z] in the world, for someone facing the sea. Returns { loop, cascades }.
export function buildSpectrum(settings, size, rng, direction) {
  const { patches, loop } = settings;
  const cascades = patches.map((patch) => cascade(size, patch));
  const w0 = (2 * Math.PI) / loop;
  const nyquist = (patch) => (Math.PI * size) / patch;

  // Each sea's bands: the ripples start where the long waves' cascade ends.
  const seas = [
    { ...settings.swell, heading: direction(settings.swell.from).map((v) => -v), bands: [[0, 0, (2 * Math.PI) / settings.swell.shortest]], choppy: settings.swell.choppy, target: 0 },
    {
      ...settings.chop,
      heading: direction(settings.chop.blows),
      bands: [
        [1, 0, settings.chop.split],
        [2, settings.chop.split, nyquist(patches[2])],
      ],
      choppy: settings.chop.choppy,
    },
  ];

  const gauss = () => {
    // Box-Muller: a complex Gaussian whose squared length averages 1.
    const a = 2 * Math.PI * rng.range(0, 1);
    const r = Math.sqrt(-Math.log(1 - rng.range(0, 1)));
    return [r * Math.cos(a), r * Math.sin(a)];
  };

  // Every wave of every cascade: its power per sea, its phase.
  for (const sea of seas) {
    const [hx, hz] = sea.heading;
    const wp = (2 * Math.PI) / sea.period;
    let total = 0;
    // First the sea's total power, to scale it to its height.
    const power = (c, kx, kz) => {
      const k = Math.hypot(kx, kz);
      if (k === 0 || bandOf(sea.bands, k) !== c) return 0;
      const w = Math.sqrt(G * k);
      const angle = Math.atan2(kx * hz - kz * hx, kx * hx + kz * hz);
      // Per unit of wave vector: dw/dk over k.
      return jonswap(w, wp, sea.gamma) * spreading(angle, sea.spread) * (0.5 * Math.sqrt(G / k)) / k * Math.exp(-((k * settings.smallest) ** 2));
    };
    for (const [c] of sea.bands) {
      const { patch } = cascades[c];
      const dk = (2 * Math.PI) / patch;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          total += (power(c, wave(i, size) * dk, wave(j, size) * dk) + power(c, -wave(i, size) * dk, -wave(j, size) * dk)) * dk * dk;
        }
      }
    }
    const scale = total > 0 ? ((sea.height / 4) ** 2) / total : 0;

    for (const [c] of sea.bands) {
      const target = cascades[c];
      target.choppy = sea.choppy;
      const dk = (2 * Math.PI) / target.patch;
      const { amplitudes, frequencies } = target;
      for (let j = 0; j < size; j++) {
        for (let i = 0; i < size; i++) {
          const n = j * size + i;
          const [kx, kz] = [wave(i, size) * dk, wave(j, size) * dk];
          // Drawn for every wave of every sea, in or out of its bands, so a
          // change to one band doesn't shift the phases of the others.
          const xi = gauss();
          const k = Math.hypot(kx, kz);
          // The highest row and column have no partner of opposite sign: left
          // out, the field stays real.
          if (k === 0 || i === size / 2 || j === size / 2) continue;
          // Also where this way has no power: its opposite's runs at this frequency.
          frequencies[n] = Math.round(Math.sqrt(G * k) / w0) * w0;
          const a = Math.sqrt(power(c, kx, kz) * scale * dk * dk);
          amplitudes[4 * n] += a * xi[0];
          amplitudes[4 * n + 1] += a * xi[1];
        }
      }
    }
  }

  // The ripples stand as steep as asked: what breaks the sun into glints, which
  // the chop's height says little about.
  const ripples = cascades[2];
  const steep = unresolvedSlopes(ripples, 1, true)[0];
  if (steep > 0) {
    const scale = settings.chop.rippleSlope / Math.sqrt(steep);
    for (let n = 0; n < ripples.amplitudes.length; n++) ripples.amplitudes[n] *= scale;
  }

  // Each wave also needs the conjugate of its opposite's, which the evolution
  // adds to run the other way.
  for (const { amplitudes } of cascades) {
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const n = j * size + i;
        const m = ((size - j) % size) * size + (size - i) % size;
        amplitudes[4 * n + 2] = amplitudes[4 * m];
        amplitudes[4 * n + 3] = -amplitudes[4 * m + 1];
      }
    }
  }
  return { loop, size, cascades };
}

// The signed wave number of index i of N, as an FFT orders them.
export function wave(i, size) {
  return i < size / 2 ? i : i - size;
}

// The plain waves of a cascade, largest first, down to those that together make
// up all but `rest` of its power, or at most `most` of them: what JS sums
// (water/surface.js). Each { kx, kz, re, im, w }: its part of the height is
// 2 (re cos p - im sin p), p = kx x + kz z - w t, its opposite folded in.
export function largestWaves({ size, patch, amplitudes, frequencies }, rest, most) {
  const dk = (2 * Math.PI) / patch;
  const all = [];
  let total = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = j * size + i;
      const power = amplitudes[4 * n] ** 2 + amplitudes[4 * n + 1] ** 2;
      if (power === 0) continue;
      total += power;
      all.push({ kx: wave(i, size) * dk, kz: wave(j, size) * dk, re: amplitudes[4 * n], im: amplitudes[4 * n + 1], w: frequencies[n], power });
    }
  }
  all.sort((a, b) => b.power - a.power);
  let kept = 0;
  let count = 0;
  while (count < all.length && count < most && kept < (1 - rest) * total) kept += all[count++].power;
  return all.slice(0, count);
}

// The slope variance a cascade holds at wavelengths shorter than each mip
// level resolves, per level (0: its finest), summing what it holds: what a far
// pixel's filtered normal has lost, and its shine must widen by. With `all`, what it holds in all.
export function unresolvedSlopes({ size, patch, amplitudes }, levels, all = false) {
  const dk = (2 * Math.PI) / patch;
  const out = new Float64Array(levels);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = j * size + i;
      const power = amplitudes[4 * n] ** 2 + amplitudes[4 * n + 1] ** 2;
      if (power === 0) continue;
      const k = Math.hypot(wave(i, size), wave(j, size));
      // A mip level holds waves up to half its own texels' frequency.
      for (let level = 0; level < levels; level++) {
        if (all || k >= size / 2 / 2 ** level) out[level] += 2 * power * (k * dk) ** 2;
      }
    }
  }
  return out;
}
