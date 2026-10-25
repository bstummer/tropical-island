import test from 'node:test';
import assert from 'node:assert/strict';
import { createImage } from '../tools/image.js';
import { shBasis, shIrradiance } from '../src/sky/light.js';
import { coefficients, directions, texelCount, texels } from '../src/fixtures/maths-cases.js';
import { answers as hazeAnswers } from '../src/fixtures/haze-cases.js';
import { sunPath } from '../src/sky/sun.js';
import { views } from '../src/views.js';
import { config } from '../src/config.js';
import {
  benchmarkProblems,
  blendMismatch,
  checkLimits,
  describeWarning,
  explainLaunchError,
  hazeProblems,
  terrainProblems,
  surfaceProblems,
  patchesProblems,
  isSameFile,
  mathsMismatch,
  metricChanges,
  mismatchWarnings,
  parseArgs,
  resourceLeaks,
  rockProblems,
  timeChangeTarget,
} from '../tools/screenshot.js';

// ---------------------------------------------------------------- own-page requests

test('the page itself is not a network request, whatever the drive letter case', () => {
  const node = 'file:///c:/Users/me/tropical-island/dist/index.html';
  const chromium = 'file:///C:/Users/me/tropical-island/dist/index.html?capture=1&view=beach';
  assert.equal(isSameFile(chromium, node, 'win32'), true);
  assert.equal(isSameFile(`${node}#top`, node, 'win32'), true);
});

test('other files are still requests', () => {
  const page = 'file:///C:/game/dist/index.html';
  assert.equal(isSameFile('file:///C:/game/dist/other.html', page, 'win32'), false);
  assert.equal(isSameFile('https://example.com/index.html', page, 'win32'), false);
  // Linux paths are case-sensitive: a different case is a different file.
  assert.equal(isSameFile('file:///home/Me/dist/index.html', 'file:///home/me/dist/index.html', 'linux'), false);
  assert.equal(isSameFile('file:///home/me/dist/index.html?t=1', 'file:///home/me/dist/index.html', 'linux'), true);
});

// ---------------------------------------------------------------- limits

test('only values above their limit are reported', () => {
  const warnings = checkLimits({ frameMs: 1001, drawCalls: 10, triangles: 5 }, { frameMs: 1000, drawCalls: 10 });
  assert.deepEqual(warnings, [{ metric: 'frameMs', value: 1001, limit: 1000 }]);
});

test('missing or non-numeric values and limits never warn', () => {
  assert.deepEqual(checkLimits({ frameMs: null, gpuMs: NaN }, { frameMs: 1, gpuMs: 1 }), []);
  assert.deepEqual(checkLimits({ frameMs: 99 }, {}), []);
});

test('compare lists the numbers that changed, as shown', () => {
  const before = { drawCalls: 3, triangles: 162208, overdraw: 1.891, shimmerPercent: 0.03, gpuMs: null };
  const after = { drawCalls: 5, triangles: 162210, overdraw: 1.8912, shimmerPercent: 0.03, gpuMs: 1.2 };
  assert.deepEqual(metricChanges(before, after), ['draw calls 3 → 5']); // the rest round the same, or is missing on one side
  assert.deepEqual(metricChanges({ textureMB: 10 }, { textureMB: 300 }), ['texture memory 10 MB → 300 MB']);
  assert.deepEqual(metricChanges(undefined, after), []);
});

test('resource leaks list what grew, and nothing for what shrank or stayed', () => {
  const MB = 1024 * 1024;
  const before = { objects: { Texture: 5, Buffer: 9, Framebuffer: 2 }, textureBytes: 10 * MB, renderTargetBytes: 50 * MB, bufferBytes: 2 * MB };
  assert.deepEqual(resourceLeaks(before, before), []);
  const after = { objects: { Texture: 7, Buffer: 8, Framebuffer: 2, Query: 1 }, textureBytes: 10.5 * MB, renderTargetBytes: 50 * MB, bufferBytes: 1 * MB };
  assert.deepEqual(resourceLeaks(before, after), ['+2 Texture', '+1 Query', '+512 KB textures']);
  assert.deepEqual(resourceLeaks(before, { ...before, renderTargetBytes: 66.5 * MB }), ['+16.5 MB render targets']);
});

test('a benchmark result must cover every view and say where it ran', () => {
  const summary = ['build      abc', 'gpu        Test GPU', 'browser    Test', 'screen     640×360', 'preset     high (MSAA 4)'].join('\n');
  const result = (view) => ({ view, frameMs: [16.7, 16.6], counts: { drawCalls: 4 } });
  assert.deepEqual(benchmarkProblems(summary, [result('beach'), result('overview')], ['beach', 'overview']), []);

  const texts = (problems) => problems.map((p) => p.text).join('\n');
  assert.match(texts(benchmarkProblems(summary, [result('beach')], ['beach', 'overview'])), /measured views beach, expected beach, overview/);
  assert.match(texts(benchmarkProblems(summary, [{ ...result('beach'), frameMs: [] }], ['beach'])), /no valid frame times for beach/);
  assert.match(texts(benchmarkProblems(summary, [{ ...result('beach'), counts: null }], ['beach'])), /no GPU counts for beach/);
  assert.match(texts(benchmarkProblems(summary.replace('gpu        Test GPU', 'gpu'), [result('beach')], ['beach'])), /no "gpu" line/);
});

test('warnings read as sentences with units', () => {
  assert.equal(describeWarning({ metric: 'frameMs', value: 1240.4, limit: 1000 }), 'capture time per frame 1240 ms is over the limit of 1000 ms');
  assert.equal(describeWarning({ metric: 'bandingPercent', value: 2.5, limit: 1 }), 'banding 2.50% is over the limit of 1.00%');
  assert.equal(describeWarning({ metric: 'unknown', value: 3, limit: 2 }), 'unknown 3 is over the limit of 2');
});

// ---------------------------------------------------------------- launch errors

// Trimmed from a real launch on a bare Ubuntu 24.04 container.
const MISSING_LIB = [
  'browserType.launch: Target page, context or browser has been closed',
  'Browser logs:',
  '',
  '<launched> pid=83',
  '[pid=83][err] /root/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell: ' +
    'error while loading shared libraries: libglib-2.0.so.0: cannot open shared object file: No such file or directory',
  'Call log:',
].join('\n');

test('a launch that dies on a missing library names it and the fix', () => {
  const text = explainLaunchError(MISSING_LIB);
  assert.match(text, /missing system library libglib-2\.0\.so\.0\b/);
  assert.match(text, /npx playwright install-deps chromium/);
  assert.doesNotMatch(text, /\n/);
});

test('a missing browser points at the install command', () => {
  const text = explainLaunchError("browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/x/chrome-headless-shell\n╔══╗");
  assert.match(text, /npx playwright install --only-shell chromium/);
});

test('other launch errors keep only their first line', () => {
  assert.equal(explainLaunchError('no WebGL2 context'), 'no WebGL2 context');
  assert.equal(explainLaunchError('first line\nsecond line'), 'first line');
});

// ---------------------------------------------------------------- compare warnings

const info = {
  gl: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
  browser: '156.0.8078.4',
  size: [1600, 900],
  params: { capture: '1' },
};
const side = (overrides) => ({ info: { ...info, ...overrides } });

test('matching captures compare without warnings', () => {
  assert.deepEqual(mismatchWarnings([side({}), side({})]), []);
});

test('every differing capture setting is warned about', () => {
  const warnings = mismatchWarnings([
    side({}),
    side({ gl: 'ANGLE (NVIDIA, D3D11)', browser: '157.0.1.0', size: [800, 450], params: { capture: '1', t: '3' } }),
  ]);
  assert.equal(warnings.length, 4);
  assert.match(warnings.join('\n'), /GL backends/);
  assert.match(warnings.join('\n'), /Chromium builds: 156\.0\.8078\.4 vs 157\.0\.1\.0/);
  assert.match(warnings.join('\n'), /sizes/);
  assert.match(warnings.join('\n'), /params/);
});

test('captures from before the Chromium build was recorded still get a warning', () => {
  const old = side({});
  delete old.info.browser;
  assert.match(mismatchWarnings([old, side({})]).join('\n'), /Chromium builds: unknown vs 156/);
});

test('a missing info.json is reported instead of guessed', () => {
  assert.match(mismatchWarnings([{ info: null }, side({})])[0], /info\.json missing/);
});

// ---------------------------------------------------------------- arguments

test('options parse in both --key value and --key=value form', () => {
  assert.deepEqual(parseArgs(['--views', 'beach,overview', '--label=before', '--gl', 'swiftshader']), {
    views: 'beach,overview',
    label: 'before',
    gl: 'swiftshader',
  });
});

test('--checks is a flag without a value', () => {
  assert.deepEqual(parseArgs(['--checks', '--gl', 'swiftshader']), { checks: true, gl: 'swiftshader' });
  assert.throws(() => parseArgs(['--checks=yes']), /--checks takes no value/);
});

test('--compare takes two labels', () => {
  assert.deepEqual(parseArgs(['--compare', 'before', 'after']), { compare: ['before', 'after'] });
  assert.throws(() => parseArgs(['--compare', 'before']), /usage: --compare/);
  assert.throws(() => parseArgs(['--compare', 'before', '--label']), /usage: --compare/);
});

test('unknown options, missing values and stray arguments fail', () => {
  assert.throws(() => parseArgs(['--colour', 'red']), /unknown option --colour/);
  assert.throws(() => parseArgs(['--label']), /--label needs a value/);
  assert.throws(() => parseArgs(['--label', '--views', 'beach']), /--label needs a value/);
  assert.throws(() => parseArgs(['beach']), /unexpected argument "beach"/);
});

// ---------------------------------------------------------------- blend fixture

// A frame drawn as the blend fixture lays out: two bands, one card with its
// reference, each card colour given per band.
function blendFrame(card, reference, light = [[20, 20, 20], [200, 200, 200]]) {
  const image = createImage(200, 100);
  const set = (x0, x1, y0, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set(c, (y * 200 + x) * 4);
  };
  for (const [k, top] of [[0, 50], [1, 0]]) {
    set(0, 200, top, top + 50, light[k]);
    set(40, 80, top, top + 50, card[k]);
    set(140, 180, top, top + 50, reference[k]);
  }
  return image;
}
const LAYOUT = { bands: 2, spans: [[0.2, 0.4]] };

test('blend mismatch: a card equal to its reference passes, and shows against the light', () => {
  const card = [[10, 10, 10], [120, 100, 90]];
  const { worst, contrast } = blendMismatch(blendFrame(card, card), LAYOUT);
  assert.equal(worst, 0);
  assert.equal(contrast, 110);
});

test('blend mismatch: the largest difference of any band and channel counts', () => {
  const { worst } = blendMismatch(blendFrame([[10, 10, 10], [120, 100, 90]], [[10, 10, 10], [120, 100, 160]]), LAYOUT);
  assert.equal(worst, 70);
});

test('blend mismatch: a missing card shows no contrast', () => {
  const light = [[20, 20, 20], [200, 200, 200]];
  assert.equal(blendMismatch(blendFrame(light, light, light), LAYOUT).contrast, 0);
});

// ---------------------------------------------------------------- maths fixture

// What the maths fixture would read back from a GPU that agrees with sky/light.js.
function mathsAnswers({ skyView = 0.001, aerial = 0.002, multiscatter = 0.003 } = {}) {
  const values = new Array(4 * texelCount).fill(0);
  const unit = (d) => d.map((v) => v / Math.hypot(...d));
  directions.forEach((d, j) => {
    shBasis(unit(d)).forEach((b, k) => (values[4 * (texels.basis + 9 * j + k)] = b));
    values.splice(4 * (texels.irradiance + j), 3, ...shIrradiance(coefficients, unit(d)));
  });
  values[4 * texels.skyView] = skyView;
  values[4 * texels.aerial] = aerial;
  values[4 * texels.multiscatter] = multiscatter;
  return values;
}

test('maths mismatch: answers that agree with sky/light.js come out near zero', () => {
  const m = mathsMismatch(mathsAnswers());
  assert.ok(m.basis < 1e-12 && m.irradiance < 1e-12, JSON.stringify(m));
  assert.equal(m.skyView, 0.001);
  assert.equal(m.aerial, 0.002);
  assert.equal(m.multiscatter, 0.003);
});

test('maths mismatch: a wrong basis value or irradiance shows', () => {
  const values = mathsAnswers();
  values[4 * (texels.basis + 2)] += 0.3;
  values[4 * texels.irradiance + 1] *= 1.01;
  const m = mathsMismatch(values);
  assert.ok(Math.abs(m.basis - 0.3) < 1e-9);
  assert.ok(m.irradiance > 0.005, `irradiance ${m.irradiance}`);
});

// ---------------------------------------------------------------- haze fixture

const goodHaze = { aerial: 1, skyView: 0.5, skyLight: 4, sunlight: 1, noHaze: 150, seaLevel: 40, dimSkyLight: 15, seaLevelSun: 30, sun: { 50: 1.15, 300: 1.6 } };

test('haze problems: small misses and visible mistakes pass', () => {
  assert.deepEqual(Object.keys(goodHaze).slice(0, -1), hazeAnswers);
  assert.deepEqual(hazeProblems(goodHaze, 6, { high: true }), []);
});

test('haze problems: a miss over the limit fails, and so does a mistake the measure cannot see', () => {
  assert.match(hazeProblems({ ...goodHaze, aerial: 9 }, 6).join(), /aerial off by 9\.0/);
  assert.match(hazeProblems({ ...goodHaze, dimSkyLight: 3 }, 6).join(), /dimSkyLight .*misses it/);
  assert.match(hazeProblems({ ...goodHaze, sunlight: 7 }, 6).join(), /sunlight off by 7\.0/);
  assert.match(hazeProblems({ ...goodHaze, seaLevelSun: 2 }, 6).join(), /seaLevelSun .*misses it/);
  assert.match(hazeProblems({ ...goodHaze, skyView: NaN }, 6).join(), /skyView/);
});

test('haze problems: the sunlight must grow with height', () => {
  assert.match(hazeProblems({ ...goodHaze, sun: { 50: 0.9, 300: 1.2 } }, 6).join(), /at 50 m .*less than lower down/);
  assert.match(hazeProblems({ ...goodHaze, sun: { 50: 1.5, 300: 1.2 } }, 6).join(), /at 300 m/);
  assert.match(hazeProblems({ ...goodHaze, sun: {} }, 6).join(), /no sunlight/);
});

test('haze problems: in the last minutes of daylight only the sunlight is judged', () => {
  assert.deepEqual(hazeProblems({ ...goodHaze, aerial: 9, noHaze: 1 }, 6, { sunOnly: true }), []);
  assert.match(hazeProblems({ ...goodHaze, sunlight: 9 }, 6, { sunOnly: true }).join(), /sunlight off/);
});

test('haze problems: tables made at sea level only have to show from high up', () => {
  const low = { ...goodHaze, seaLevel: 0.5 };
  assert.deepEqual(hazeProblems(low, 6), []);
  assert.match(hazeProblems(low, 6, { high: true }).join(), /seaLevel/);
});

// ---------------------------------------------------------------- terrain fixture

const goodTerrain = {
  gpu: 5e-5,
  mistaken: 1.6,
  ground: { gpu: 0.3, mistaken: 9 },
  mesh: { points: 3000, gpu: 2e-4, mistaken: 3 },
  bounce: { points: 1024, gpu: 1e-3, mistaken: 0.1 },
  far: { points: 512, lod: 7, gpu: 0.2, mistaken: 30 },
  island: [1, 2, 4, 8].map((texel) => ({ texel, median: 0.004 * texel })),
};
const terrainLimits = { limit: 0.002, islandMedian: 0.04, mesh: 0.01, bounce: 0.01 };

test('terrain problems: heights and ground that agree pass', () => {
  assert.deepEqual(terrainProblems(goodTerrain, terrainLimits), []);
});

test('terrain problems: a GPU off, a mistake the check misses, or ground far from the island fail', () => {
  assert.match(terrainProblems({ ...goodTerrain, gpu: 0.01 }, terrainLimits).join(), /GPU vs world\/heightmap\.js off/);
  assert.match(terrainProblems({ ...goodTerrain, mistaken: 1e-4 }, terrainLimits).join(), /misses it/);
  const shifted = { ...goodTerrain, island: goodTerrain.island.map((l) => ({ ...l, median: 0.1 * l.texel })) };
  assert.equal(terrainProblems(shifted, terrainLimits).length, 4);
  assert.match(terrainProblems({ ...goodTerrain, gpu: NaN }, terrainLimits).join(), /GPU/);
});

test("terrain problems: the GPU's ground off, a mistake in it the check misses, or no ground read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, ground: { gpu: 1.5, mistaken: 9 } }, terrainLimits).join(), /GPU's ground/);
  assert.match(terrainProblems({ ...goodTerrain, ground: { gpu: 0.3, mistaken: 0.8 } }, terrainLimits).join(), /ground half a metre off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, ground: undefined }, terrainLimits).length, 2);
});

test("terrain problems: the GPU's mesh height off its twin, a mistake the check misses, or no mesh read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, mesh: { points: 3000, gpu: 0.05, mistaken: 3 } }, terrainLimits).join(), /mesh height vs/);
  assert.match(terrainProblems({ ...goodTerrain, mesh: { points: 3000, gpu: 1e-4, mistaken: 0.005 } }, terrainLimits).join(), /30 m off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, mesh: undefined }, terrainLimits).length, 2);
});

test("terrain problems: the light from below's albedo off JS's, a mistake in its layout the check misses, or no albedo read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, bounce: { points: 1024, gpu: 0.05, mistaken: 0.1 } }, terrainLimits).join(), /albedo the GPU's light from below reads/);
  assert.match(terrainProblems({ ...goodTerrain, bounce: { points: 1024, gpu: 1e-3, mistaken: 0.004 } }, terrainLimits).join(), /half a texel off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, bounce: undefined }, terrainLimits).length, 2);
  assert.equal(terrainProblems({ ...goodTerrain, bounce: { points: 1024, gpu: NaN, mistaken: NaN } }, terrainLimits).length, 2);
});

test("terrain problems: the far ground off JS's mipmaps, a mistake in them the check misses, or no far read fail", () => {
  assert.match(terrainProblems({ ...goodTerrain, far: { ...goodTerrain.far, gpu: 1.4 } }, terrainLimits).join(), /far ground the GPU reads/);
  assert.match(terrainProblems({ ...goodTerrain, far: { ...goodTerrain.far, mistaken: 0.6 } }, terrainLimits).join(), /quarter of a texel off .* misses it/);
  assert.equal(terrainProblems({ ...goodTerrain, far: undefined }, terrainLimits).length, 2);
  assert.equal(terrainProblems({ ...goodTerrain, far: { points: 512, lod: 7, gpu: NaN, mistaken: NaN } }, terrainLimits).length, 2);
});

// ---------------------------------------------------------------- rocks fixture

const goodRocks = { rocks: 690, cameras: 14, offsets: { points: 80000, gpu: 3e-4, mistaken: 5 }, vertices: { rocks: 336, pixels: 84000, gpu: 1.5e-4, mistaken: 1.9 } };
const rockLimits = { offsets: 0.01, vertices: 0.01, pixels: 20000 };

test('rock problems: offsets and vertices that agree with their twins pass', () => {
  assert.deepEqual(rockProblems(goodRocks, rockLimits), []);
});

test('rock problems: GPU offsets or vertices off, mistakes the check misses, too few pixels or no answer fail', () => {
  assert.match(rockProblems({ ...goodRocks, offsets: { ...goodRocks.offsets, gpu: 0.05 } }, rockLimits).join(), /offsets vs their JS twin/);
  assert.match(rockProblems({ ...goodRocks, offsets: { ...goodRocks.offsets, mistaken: 0.001 } }, rockLimits).join(), /next rock's .* misses it/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, gpu: 0.02 } }, rockLimits).join(), /rocks.wgsl draws rocks/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, mistaken: 0.002 } }, rockLimits).join(), /wrong way .* misses it/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, pixels: 100 } }, rockLimits).join(), /measures too little/);
  assert.match(rockProblems({ ...goodRocks, vertices: { ...goodRocks.vertices, gpu: NaN } }, rockLimits).join(), /rocks.wgsl/);
  assert.equal(rockProblems(undefined, rockLimits).length, 5);
});

// ---------------------------------------------------------------- surfaces fixture

const goodTiles = { grain: { whole: 0.001, half: 0.95 }, ripples: { whole: 0, half: 0.9 }, rock: { whole: 0.002, half: 0.97 }, grass: { whole: 0, half: 0.8 }, litter: { whole: 0, half: 0.95 } };
const tileLimits = { share: 0.01, mistaken: 0.3, tiles: ['grain', 'ripples', 'rock', 'grass', 'litter'] };

test('surface problems: tiles that repeat pass', () => {
  assert.deepEqual(surfaceProblems(goodTiles, tileLimits), []);
});

test("surface problems: a tile that doesn't repeat, a check that can't see it, or no answer fail", () => {
  assert.match(surfaceProblems({ ...goodTiles, ripples: { whole: 0.4, half: 0.9 } }, tileLimits).join(), /ripples tile doesn't repeat/);
  assert.match(surfaceProblems({ ...goodTiles, grain: { whole: 0, half: 0.1 } }, tileLimits).join(), /grain tile .* misses it/);
  assert.match(surfaceProblems({ ...goodTiles, rock: { whole: 0.2, half: 0.97 } }, tileLimits).join(), /rock tile doesn't repeat/);
  assert.match(surfaceProblems({ ...goodTiles, litter: { whole: 0.1, half: 0.95 } }, tileLimits).join(), /litter tile doesn't repeat/);
  assert.match(surfaceProblems({ ...goodTiles, grass: { whole: 0, half: 0 } }, tileLimits).join(), /grass tile .* misses it/);
  assert.equal(surfaceProblems(undefined, tileLimits).length, 10);
});

test('patches problems: GPU patches on their twin pass; off it, a check that misses its mistake, or no answer fail', () => {
  const limits = { limit: 0.002 };
  const good = { points: 1024, gpu: 3e-4, mistaken: 0.6 };
  assert.deepEqual(patchesProblems(good, limits), []);
  assert.match(patchesProblems({ ...good, gpu: 0.4 }, limits).join(), /GPU vs world\/green\.js off/);
  assert.match(patchesProblems({ ...good, mistaken: 1e-4 }, limits).join(), /misses it/);
  assert.equal(patchesProblems(undefined, limits).length, 2);
  assert.match(patchesProblems({ ...good, gpu: NaN }, limits).join(), /GPU/);
});

// ---------------------------------------------------------------- time check

test('time check: four views in a row visit every named time, never their own', () => {
  const names = Object.keys(sunPath.times);
  for (const hours of [sunPath.times.midday, sunPath.times.sunset, 9.5, 14]) {
    const targets = views.slice(0, 4).map((view) => timeChangeTarget(view.name, hours));
    for (const name of targets) assert.ok(Math.abs(sunPath.times[name] - hours) > 0.5, `${name} from ${hours} h`);
    const own = names.filter((n) => Math.abs(sunPath.times[n] - hours) <= 0.5);
    assert.deepEqual(new Set(targets), new Set(names.filter((n) => !own.includes(n))), `from ${hours} h`);
  }
});

test('time check: a full run of the views, each at its own time, covers every named time', () => {
  const own = (view) => sunPath.toHours(view.timeOfDay ?? config.defaults.timeOfDay);
  const targets = views.map((view) => timeChangeTarget(view.name, own(view)));
  views.forEach((view, i) => assert.ok(Math.abs(sunPath.times[targets[i]] - own(view)) > 0.5, `${view.name} to ${targets[i]}`));
  assert.deepEqual(new Set(targets), new Set(Object.keys(sunPath.times)));
});
