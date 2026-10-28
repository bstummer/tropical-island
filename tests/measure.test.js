import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureShimmer, measureView, stopAnalysis } from '../tools/measure.js';

// A capture page as tools/measure.js talks to it, whose frames are no PNGs, so
// every analysis of them fails in the worker.
const NOT_A_PNG = 'data:image/png;base64,bm90IGEgcG5n';
const page = {
  async evaluate(fn, arg) {
    const source = String(fn);
    if (source.includes('stats()')) return { drawCalls: 1, triangles: 1, passes: 1, pipelines: 1, textureBytes: 0, renderTargetBytes: 0, canvasBytes: 0, bufferBytes: 0 };
    if (source.includes('overdraw()')) return { width: 1, height: 1, counts: Buffer.from([1]).toString('base64') };
    if (source.includes('image()') && !arg) return NOT_A_PNG;
    return arg.map(() => NOT_A_PNG); // renderFrames
  },
};
const info = { drawingBuffer: [4, 2], fov: 60, t: 0 };

test("a view's failed analysis waits for whoever reads it, without ending the process meanwhile", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'measure-test-'));
  const unhandled = [];
  const listener = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', listener);
  t.after(async () => {
    process.off('unhandledRejection', listener);
    await stopAnalysis();
    rmSync(dir, { recursive: true, force: true });
  });

  // The screenshot tool holds the analysis while the next view renders.
  const { analysis } = await measureView(page, { info, first: NOT_A_PNG, dir: join(dir, 'view'), gpuTime: false });
  // The worker answers in order: once a later job has failed, so has the view's.
  await assert.rejects(measureShimmer(page, info, join(dir, 'shimmer.png')), /not a PNG/);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(unhandled, []);
  await assert.rejects(analysis, /not a PNG/);
});
