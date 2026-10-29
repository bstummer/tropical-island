// The sun's shadow maps around the camera (sky/shadows.js): a few cascades,
// each a square map over a sphere round a slice of the camera's view, from
// its feet out to the last split. Pure and Node-importable.
//
// They hold still as the camera moves, so shadows don't crawl: a sphere
// doesn't turn with the camera, so turning it changes nothing, and each
// sphere's centre snaps to whole texels of a frame fixed to the sun, so
// moving the camera slides a map by whole texels and every shadow stays where
// it is on the ground. Each map reaches `reach` metres further towards the
// sun than its sphere, for what casts into it from outside (a rock behind the
// camera with the sun ahead).
//
// Positions in the sun's frame (lightFrame): x along `right`, y along `up`,
// z towards the sun. A cascade's map looks down -z from `reach` past its
// sphere: per point q, its texel is (0.5 + (q.x - cx) / 2r, 0.5 - (q.y - cy) / 2r)
// (rows from the top) and its depth, reversed, 1 + (q.z - cz - r - reach) / (2r + reach)
// (chunks/shadows.wgsl reads them so).

// An orthonormal frame turned to the sun: `toward` it, `right` level, and `up`.
export function lightFrame(sun) {
  const toward = normalize(sun);
  // Level is square to the sun and to the vertical; overhead, any way is.
  let right = cross([0, 1, 0], toward);
  if (Math.hypot(...right) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  const up = cross(toward, right);
  return { right, up, toward };
}

// The least sphere round the part of a view between `near` and `far`
// metres ahead, whose corners lie `spread` times their distance off its axis
// (spread = tan(half the vertical angle) x sqrt(1 + aspect^2)): its centre's
// distance along the axis, and its radius.
export function sliceSphere(near, far, spread) {
  const k = spread * spread;
  // The sphere through all four far and near corners, its centre on the axis,
  // unless that lies past the far end: then round the far end alone.
  const centre = Math.min(far, ((near + far) / 2) * (1 + k));
  const radius = Math.max(Math.hypot(far - centre, far * spread), Math.hypot(centre - near, near * spread));
  return { centre, radius };
}

// The cascades for a camera at `position` looking along `forward` (unit),
// with spread as sliceSphere's, between `splits` (metres ahead, from the
// camera's near plane), maps `size` texels across, for the sun in `sun`.
// Returns { frame: lightFrame's, cascades: [{ centre: [cx, cy, cz] in the
// sun's frame, radius, texel, reach, depth: 2r + reach }] }.
export function fitCascades({ position, forward, spread, splits, size, sun, reach }) {
  const frame = lightFrame(sun);
  const cascades = [];
  for (let k = 0; k + 1 < splits.length; k++) {
    const sphere = sliceSphere(splits[k], splits[k + 1], spread);
    const along = sphere.centre;
    // A texel wider all round than the sphere: snapping moves the centre by
    // up to 0.71 of one, and the slice stays inside. A whole number of texels
    // across, so the snapped box's edges lie on texels too.
    const radius = (sphere.radius * size) / (size - 2);
    const texel = (2 * radius) / size;
    const world = position.map((p, i) => p + forward[i] * along);
    const centre = [dot(world, frame.right), dot(world, frame.up), dot(world, frame.toward)];
    centre[0] = Math.round(centre[0] / texel) * texel;
    centre[1] = Math.round(centre[1] / texel) * texel;
    cascades.push({ centre, radius, texel, reach, depth: 2 * radius + reach });
  }
  return { frame, cascades };
}

// A cascade's view matrix (column-major, as Matrix4.elements): from the sun's
// frame, put at its eye, `reach` past its sphere towards the sun.
export function cascadeView({ right, up, toward }, { centre, radius, reach }) {
  const [cx, cy, cz] = centre;
  const eye = cz + radius + reach;
  return [right[0], up[0], toward[0], 0, right[1], up[1], toward[1], 0, right[2], up[2], toward[2], 0, -cx, -cy, -eye, 1];
}

// Where a world point lands in a cascade's map: [u, v] (rows from the top)
// and its depth, as the GPU reads it (chunks/shadows.wgsl).
export function cascadeTexel({ right, up, toward }, { centre, radius, reach }, point) {
  const q = [dot(point, right), dot(point, up), dot(point, toward)];
  return {
    u: 0.5 + (q[0] - centre[0]) / (2 * radius),
    v: 0.5 - (q[1] - centre[1]) / (2 * radius),
    depth: 1 + (q[2] - centre[2] - radius - reach) / (2 * radius + reach),
  };
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normalize(v) {
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
}
