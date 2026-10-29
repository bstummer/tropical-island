// The sun's shadow maps round the camera (sky/cascades.js): each covers its
// slice of the view, the maps' texels stay put on the ground however the
// camera moves or turns, and the shader's reading of a map is the one the
// matrices that draw it make.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Vector3 } from '../src/maths/index.js';
import { createRandom } from '../src/core/random.js';
import { cascadeTexel, cascadeView, fitCascades, lightFrame, sliceSphere } from '../src/sky/cascades.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SPLITS = [0.02, 6, 20, 60, 160];

// A camera's view: forward, and the corners of its slice from near to far.
function view(rng) {
  const yaw = rng.range(0, 2 * Math.PI);
  const pitch = rng.range(-1.2, 1.2);
  const forward = [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
  const right = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up = [forward[1] * right[2] - forward[2] * right[1], forward[2] * right[0] - forward[0] * right[2], forward[0] * right[1] - forward[1] * right[0]];
  const tanY = Math.tan((rng.range(30, 80) * Math.PI) / 360);
  const aspect = rng.range(1, 2.4);
  const position = [rng.range(-2000, 2000), rng.range(1, 400), rng.range(-2000, 2000)];
  const corners = (d) =>
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => position.map((p, i) => p + d * (forward[i] + sx * tanY * aspect * right[i] + sy * tanY * up[i])));
  return { position, forward, spread: tanY * Math.hypot(1, aspect), corners };
}

function sun(rng) {
  const e = rng.range(0.01, 1.2);
  const a = rng.range(0, 2 * Math.PI);
  return [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
}

test("the sun's frame is square, level across, and faces the sun", () => {
  const rng = createRandom('cascades')('frame');
  for (let i = 0; i < 50; i++) {
    const s = sun(rng);
    const { right, up, toward } = lightFrame(s);
    for (const [a, b] of [[right, up], [up, toward], [toward, right]]) assert.ok(Math.abs(dot(a, b)) < 1e-12);
    for (const v of [right, up, toward]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-12);
    assert.ok(Math.abs(right[1]) < 1e-12, 'level');
    assert.ok(dot(toward, s) > 0.999999 * Math.hypot(...s));
    assert.ok(up[1] >= 0, 'up is up');
  }
  assert.ok(Math.abs(dot(lightFrame([0, 1, 0]).right, [1, 0, 0]) - 1) < 1e-12, 'overhead');
});

test('a slice sphere holds the slice, and is no bigger than its far end needs or its corners fix', () => {
  const rng = createRandom('cascades')('spheres');
  for (let i = 0; i < 200; i++) {
    const near = rng.range(0.01, 50);
    const far = near + rng.range(0.5, 300);
    const spread = rng.range(0.2, 2);
    const { centre, radius } = sliceSphere(near, far, spread);
    for (const [d, off] of [[near, near * spread], [far, far * spread], [near, 0], [far, 0]]) assert.ok(Math.hypot(d - centre, off) <= radius * (1 + 1e-9), `holds ${d}`);
    // Through the far corners, and through the near ones too unless it would lie past the far end.
    assert.ok(Math.abs(Math.hypot(far - centre, far * spread) - radius) < 1e-9 || Math.abs(Math.hypot(centre - near, near * spread) - radius) < 1e-9);
  }
});

test("each cascade's map holds its slice of the view, all the way towards the sun", () => {
  const rng = createRandom('cascades')('hold');
  for (let i = 0; i < 100; i++) {
    const v = view(rng);
    const s = sun(rng);
    const fitted = fitCascades({ ...v, splits: SPLITS, size: 1024, sun: s, reach: 50 });
    fitted.cascades.forEach((cascade, k) => {
      for (const corner of [...v.corners(SPLITS[k]), ...v.corners(SPLITS[k + 1])]) {
        const { u, v: w, depth } = cascadeTexel(fitted.frame, cascade, corner);
        assert.ok(u > 0 && u < 1 && w > 0 && w < 1, `cascade ${k}: a corner of its slice off its map (${u}, ${w})`);
        assert.ok(depth > 0 && depth < 1, `cascade ${k}: a corner of its slice outside its depth (${depth})`);
        // Whatever lies up to `reach` beyond, towards the sun, too.
        const beyond = corner.map((c, j) => c + fitted.frame.toward[j] * 49);
        const far = cascadeTexel(fitted.frame, cascade, beyond).depth;
        assert.ok(far > 0 && far <= 1, `cascade ${k}: a caster towards the sun outside its depth (${far})`);
        assert.ok(far > depth, 'nearer the sun is deeper');
      }
    });
  }
});

test("the maps' texels stay put on the ground as the camera moves and turns", () => {
  const rng = createRandom('cascades')('still');
  const s = sun(rng);
  const size = 2048;
  const spread = 1.1; // one camera's lens
  const base = fitCascades({ ...view(rng), spread, splits: SPLITS, size, sun: s, reach: 50 });
  for (let i = 0; i < 100; i++) {
    const fitted = fitCascades({ ...view(rng), spread, splits: SPLITS, size, sun: s, reach: 50 });
    fitted.cascades.forEach((cascade, k) => {
      const first = base.cascades[k];
      // The same size, on the same lattice: a world point lands on the same
      // spot of a texel in every map, as far as float allows.
      assert.equal(cascade.texel, first.texel, 'texels the same size');
      for (const c of [0, 1]) {
        const shift = (cascade.centre[c] - first.centre[c]) / cascade.texel;
        assert.ok(Math.abs(shift - Math.round(shift)) < 1e-6, `cascade ${k} moved by ${shift} texels`);
      }
    });
  }
});

test("a map's texel and depth are where its matrices draw a point", () => {
  const rng = createRandom('cascades')('matrices');
  for (let i = 0; i < 40; i++) {
    const v = view(rng);
    const fitted = fitCascades({ ...v, splits: SPLITS, size: 1024, sun: sun(rng), reach: 30 });
    for (const cascade of fitted.cascades) {
      const viewMatrix = new Matrix4();
      viewMatrix.elements = cascadeView(fitted.frame, cascade);
      const projection = new Matrix4().makeOrthographic(-cascade.radius, cascade.radius, cascade.radius, -cascade.radius, 0, cascade.depth);
      for (let j = 0; j < 10; j++) {
        const p = v.corners(rng.range(1, 150))[j % 4];
        const ndc = new Vector3(...p).applyMatrix4(viewMatrix).applyMatrix4(projection);
        const { u, v: w, depth } = cascadeTexel(fitted.frame, cascade, p);
        assert.ok(Math.abs(u - (0.5 + ndc.x / 2)) < 1e-9 && Math.abs(w - (0.5 - ndc.y / 2)) < 1e-9, 'texel');
        assert.ok(Math.abs(depth - ndc.z) < 1e-9, 'depth');
      }
    }
  }
});
