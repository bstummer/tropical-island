import test from 'node:test';
import assert from 'node:assert/strict';
import { diskAbove, hazeAmount, lightFromProbe, luminance, shBasis, shIrradiance } from '../src/sky/light.js';
import { config } from '../src/config.js';

// Directions over the sphere with their solid angles (latitude-longitude grid).
function sphere(rings = 90, azimuths = 180) {
  const out = [];
  for (let i = 0; i < rings; i++) {
    const t0 = (Math.PI * i) / rings;
    const t1 = (Math.PI * (i + 1)) / rings;
    const t = (t0 + t1) / 2;
    const weight = ((Math.cos(t0) - Math.cos(t1)) * 2 * Math.PI) / azimuths;
    for (let j = 0; j < azimuths; j++) {
      const p = (2 * Math.PI * (j + 0.5)) / azimuths;
      out.push({ dir: [Math.sin(t) * Math.cos(p), Math.cos(t), Math.sin(t) * Math.sin(p)], weight });
    }
  }
  return out;
}

// Projects radiance(dir) -> [r, g, b] onto the basis, as probe.frag does.
function project(radiance) {
  const c = Array.from({ length: 9 }, () => [0, 0, 0]);
  for (const { dir, weight } of sphere()) {
    const y = shBasis(dir);
    const l = radiance(dir);
    for (let k = 0; k < 9; k++) for (let i = 0; i < 3; i++) c[k][i] += l[i] * y[k] * weight;
  }
  return c;
}

const close = (a, b, eps) => Math.abs(a - b) <= eps;

test('the SH basis is orthonormal over the sphere', () => {
  const samples = sphere();
  for (let a = 0; a < 9; a++) {
    for (let b = a; b < 9; b++) {
      const sum = samples.reduce((s, { dir, weight }) => s + shBasis(dir)[a] * shBasis(dir)[b] * weight, 0);
      assert.ok(close(sum, a === b ? 1 : 0, 2e-3), `<Y${a}, Y${b}> = ${sum}`);
    }
  }
});

test('a uniform sky of radiance L gives irradiance pi L on any surface', () => {
  const sky = project(() => [1, 0.5, 0.25]);
  for (const n of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [0.6, 0.8, 0]]) {
    const e = shIrradiance(sky, n);
    [1, 0.5, 0.25].forEach((l, i) => assert.ok(close(e[i], Math.PI * l, 0.01), `E(${n}) = ${e}`));
  }
});

test('a sky lit from above lights an upward surface and leaves a downward one nearly dark', () => {
  const sky = project(([, y]) => (y > 0 ? [1, 1, 1] : [0, 0, 0]));
  const up = shIrradiance(sky, [0, 1, 0])[0];
  const down = shIrradiance(sky, [0, -1, 0])[0];
  const side = shIrradiance(sky, [1, 0, 0])[0];
  assert.ok(close(up, Math.PI, 0.15), `up ${up}`); // a hemisphere of 1: pi, up to SH ringing
  assert.ok(down < 0.15, `down ${down}`);
  assert.ok(close(side, Math.PI / 2, 0.1), `side ${side}`);
});

test('diskAbove: none of the sun below the horizon, half on it, all above', () => {
  const r = 0.01;
  assert.equal(diskAbove(-r, r), 0);
  assert.ok(close(diskAbove(0, r), 0.5, 1e-12));
  assert.equal(diskAbove(r, r), 1);
  assert.equal(diskAbove(-1, r), 0);
  let last = 0;
  for (let e = -r; e <= r; e += r / 20) {
    assert.ok(diskAbove(e, r) >= last);
    last = diskAbove(e, r);
  }
});

// A probe as probe.frag reads it back: the sun's radiance, then a uniform sky.
function probe(sun, sky) {
  const coefficients = project(() => sky);
  return Float32Array.from([...sun, 1, ...coefficients.flatMap((c) => [...c, 1])]);
}
const sunAt = (degrees) => {
  const e = (degrees * Math.PI) / 180;
  return { elevation: e, direction: [Math.cos(e), Math.sin(e), 0] };
};

test('lightFromProbe: the sun, the sky and an exposure that falls as the light grows', () => {
  const noon = lightFromProbe(probe([0.9, 0.85, 0.75], [0.05, 0.06, 0.08]), sunAt(60), config.sky);
  assert.deepEqual(noon.sunRadiance.map((v) => +v.toFixed(5)), [0.9, 0.85, 0.75]);
  assert.equal(noon.sky.length, 9);
  const dusk = lightFromProbe(probe([0.05, 0.02, 0.005], [0.005, 0.005, 0.008]), sunAt(3), config.sky);
  assert.ok(dusk.illuminance < noon.illuminance);
  assert.ok(dusk.exposure > noon.exposure);
  // Compensated in part: the dimmer hour still comes out darker.
  assert.ok(dusk.exposure * dusk.illuminance < noon.exposure * noon.illuminance);
});

test('lightFromProbe: with its centre on the horizon, half the sun shines', () => {
  const set = lightFromProbe(probe([0.2, 0.1, 0.05], [0, 0, 0]), sunAt(0), config.sky);
  assert.ok(close(set.sunRadiance[0], 0.1, 1e-6));
  assert.ok(close(luminance(set.sunRadiance), luminance([0.1, 0.05, 0.025]), 1e-6));
});

test('lightFromProbe: a low sun still counts through the surfaces that face it', () => {
  const low = lightFromProbe(probe([1, 1, 1], [0, 0, 0]), sunAt(2), config.sky);
  // Level ground gets sin(2 degrees) of it, an upright surface facing it nearly all.
  const e = (2 * Math.PI) / 180;
  assert.ok(close(low.illuminance, (Math.sin(e) + Math.cos(e)) / 2, 1e-6));
});

test('hazeAmount: the low share at and below the horizon, all of it from fullAbove up, rising between', () => {
  const settings = { low: 0.3, fullAbove: 25 };
  const deg = (d) => (d * Math.PI) / 180;
  assert.equal(hazeAmount(deg(-1), settings), 0.3);
  assert.equal(hazeAmount(0, settings), 0.3);
  assert.equal(hazeAmount(deg(25), settings), 1);
  assert.equal(hazeAmount(deg(63), settings), 1);
  let last = 0.3;
  for (let d = 0; d <= 25; d += 1) {
    const a = hazeAmount(deg(d), settings);
    assert.ok(a >= last && a <= 1, `${d} degrees: ${a}`);
    last = a;
  }
});
