import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBenchmark, formatReadout, percentile, summarizeFrames } from '../src/core/timing.js';

test('percentiles by nearest rank', () => {
  const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  assert.equal(percentile(sorted, 0.5), 50);
  assert.equal(percentile(sorted, 0.95), 100);
  assert.equal(percentile(sorted, 0), 10);
  assert.equal(percentile([], 0.5), null);
});

test('frame summaries: a hitch shows in p95 and max, not in the median', () => {
  const ms = [...Array(99).fill(16.7), 100];
  const s = summarizeFrames(ms);
  assert.equal(s.count, 100);
  assert.equal(s.median, 16.7);
  assert.equal(s.max, 100);
  assert.ok(Math.abs(s.fps - 1000 / ((99 * 16.7 + 100) / 100)) < 1e-9);
  assert.equal(summarizeFrames([]), null);
});

const counts = { drawCalls: 4, triangles: 162208, passes: 2 };
const memory = { programs: 4, renderTargetBytes: 88 * 1024 * 1024, textureBytes: 0 };

test('the readout shows timing, GPU time when there is one, counts and memory', () => {
  const text = formatReadout({ frames: summarizeFrames([16, 17]), gpu: null, counts, memory, preset: 'high', size: { width: 1600, height: 900 }, msaa: 4 });
  const lines = text.split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[0], /^16\.5 ms · 61 fps · GPU n\/a$/);
  assert.match(lines[1], /4 draws · 162\.2k tris · 2 passes · 4 programs/);
  assert.match(lines[2], /RT 88 MB · tex 0 MB · high 1600×900 · MSAA 4/);
  assert.match(formatReadout({ frames: null, gpu: summarizeFrames([2.5]), counts, memory, preset: 'low', size: { width: 1, height: 1 }, msaa: 2 }), /n\/a ms · n\/a fps · GPU 2\.50 ms/);
});

test('the benchmark summary names the machine and has a row per view plus all views', () => {
  const results = [
    { view: 'beach', frameMs: [16.6, 16.7, 16.8], gpuMs: [4, 5], counts },
    { view: 'overview', frameMs: [33.3], gpuMs: [], counts },
  ];
  const text = formatBenchmark({
    build: 'abc1234',
    gpu: 'ANGLE (Test GPU)',
    browser: 'TestBrowser/1.0',
    screen: { width: 1920, height: 1080, pixelRatio: 1.25, buffer: [2400, 1350] },
    preset: 'high',
    quality: { renderScale: 1, maxPixelRatio: 2 },
    msaa: 4,
    reversedDepth: true,
    tonemap: 'agx-punchy',
    warmupSeconds: 1,
    seconds: 5,
    results,
  });
  for (const expected of ['build      abc1234', 'gpu        ANGLE (Test GPU)', 'browser    TestBrowser/1.0', '1920×1080 CSS px × 1.25 → drawing buffer 2400×1350', 'preset     high', 'MSAA 4', 'reversed depth yes']) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
  const rows = text.split('\n');
  const beach = rows.find((r) => r.startsWith('beach'));
  assert.match(beach, /16\.7\s+16\.8\s+16\.8\s+59\.9\s+4\.00\s+5\.00\s+4\s+162\.2k\s+2$/);
  assert.match(rows.find((r) => r.startsWith('overview')), /33\.3\s+30\.0\s+n\/a\s+n\/a/);
  assert.match(rows.find((r) => r.startsWith('all views')), /16\.7\s+33\.3\s+33\.3\s+48\.0\s+4\.00\s+5\.00$/);
});
