// Where the rocks lie (PLAN.md Stage 4.5): big blocks and fallen columns at
// the foot of the cliffs, crags on steep ground, boulders along rocky shores,
// stones scattered inland and a few on the sand, each kind by a rule of
// world/scatter.js, in that order, so the big ones claim their ground first:
// the first things placed on the ground, which later placement keeps clear of.
// Each rock is one of world/rock-shapes.js's prototypes, turned, tipped,
// leaning with the ground, scaled, and sunk until its underside lies under the
// ground all over, then deeper by its kind's share of its height: rocks sit in
// the ground, not on it, with no gap under them to see into. Its underside is
// every facet that leans out over the ground further than `overhang` past
// square to it, the ground's slope at its place; the others are its sides,
// and on a slope its downhill face may stand out over the falling ground. One
// that would show too little of itself above the ground isn't placed.
// Settings: config.world.rocks. Pure and Node-importable.
import { Quaternion, Vector3 } from 'three';
import { hull, scatter } from './scatter.js';

const UP = new Vector3(0, 1, 0);
const NORMAL_STEP = 0.5; // m either side, for the ground's normal

// The rocks within `region` (scatter's, cove frame) that keep clear of
// `clearance` (scatter.js createClearance), which they join: an array of {
// kind, shape (index into shapes), position [x, y, z], rotation [x, y, z, w],
// scale [x, y, z], height (m), top (how far its highest point stands above its
// position, m), shows (how far it stands out of the ground, m), spread (how
// far it reaches across the ground from its position, m), centre [x, y, z] and
// radius (a sphere round it), footprint (its outline from above, cove frame)
// }. seedOf(kind) gives each kind's integer seed.
export function placeRocks(heightmap, island, shapes, settings, region, seedOf, clearance) {
  const byKind = { block: [], column: [] };
  shapes.forEach((shape, index) => byKind[shape.kind].push(index));
  // How far each prototype reaches from the middle of its height.
  const reach = shapes.map(({ positions, height }) => {
    let max = 0;
    for (let i = 0; i < positions.length; i += 3) max = Math.max(max, Math.hypot(positions[i], positions[i + 1] - height / 2, positions[i + 2]));
    return max;
  });
  // A facet is underside where its normal, along the ground's, comes to less than this.
  const underside = -Math.sin((settings.overhang * Math.PI) / 180);

  const rocks = [];
  const yaw = new Quaternion();
  const tip = new Quaternion();
  const lean = new Quaternion();
  const q = new Quaternion();
  const axis = new Vector3();
  const normal = new Vector3();
  const v = new Vector3();
  const corner = new Vector3(); // a triangle's first corner, and its edges from it
  const along = new Vector3();
  const across = new Vector3();
  for (const [kind, rule] of Object.entries(settings.kinds)) {
    const placed = scatter(heightmap, island, { ...rule, seed: seedOf(kind) }, region, (a, o, ground, random) => {
      const [x, z] = island.fromCove(a, o);
      // Many small, few large.
      const [small, large] = rule.size;
      const size = small * (large / small) ** (random(3) ** rule.tail);
      const kinds = random(4) < rule.columns && byKind.column.length ? byKind.column : byKind.block;
      const shape = kinds[Math.floor(random(5) * kinds.length)];
      const scale = [size * (0.85 + 0.3 * random(6)), size * (0.8 + 0.4 * random(7)), size * (0.85 + 0.3 * random(8))];

      // Turned about the vertical, tipped a little any way, then leaning with the ground.
      yaw.setFromAxisAngle(UP, 2 * Math.PI * random(9));
      const tipAngle = ((rule.tip * Math.PI) / 180) * random(10);
      const tipDirection = 2 * Math.PI * random(11);
      tip.setFromAxisAngle(axis.set(Math.cos(tipDirection), 0, Math.sin(tipDirection)), tipAngle);
      const h = heightmap.heightAt;
      normal.set(h(x - NORMAL_STEP, z) - h(x + NORMAL_STEP, z), 2 * NORMAL_STEP, h(x, z - NORMAL_STEP) - h(x, z + NORMAL_STEP)).normalize();
      lean.setFromUnitVectors(UP, v.copy(UP).lerp(normal, rule.lean).normalize());
      q.copy(lean).multiply(tip).multiply(yaw);

      // Its corners as placed, about its position.
      const { positions, normals, index, height } = shapes[shape];
      const points = [];
      for (let i = 0; i < positions.length; i += 3) {
        points.push(v.set(positions[i] * scale[0], positions[i + 1] * scale[1], positions[i + 2] * scale[2]).applyQuaternion(q).toArray());
      }
      // Sunk until every point of its underside is under the ground, tried
      // `step` m apart or closer across each of its triangles, then deeper by
      // `sink` of its height.
      let base = Infinity;
      for (let t = 0; t < index.length; t += 3) {
        const n = 3 * index[t];
        // Normals take the inverse of an uneven scale.
        v.set(normals[n] / scale[0], normals[n + 1] / scale[1], normals[n + 2] / scale[2]).applyQuaternion(q);
        if (v.dot(normal) >= underside * v.length()) continue;
        corner.fromArray(points[index[t]]);
        along.fromArray(points[index[t + 1]]).sub(corner);
        across.fromArray(points[index[t + 2]]).sub(corner);
        const steps = Math.ceil(Math.max(along.length(), across.length(), along.distanceTo(across)) / settings.step);
        for (let i = 0; i <= steps; i++) {
          for (let j = 0; i + j <= steps; j++) {
            v.copy(corner).addScaledVector(along, i / steps).addScaledVector(across, j / steps);
            base = Math.min(base, h(x + v.x, z + v.z) - v.y);
          }
        }
      }
      const y = base - rule.sink * height * scale[1];
      let shows = -Infinity;
      let top = -Infinity;
      let spread = 0;
      for (const [px, py, pz] of points) {
        shows = Math.max(shows, y + py - h(x + px, z + pz));
        top = Math.max(top, py);
        spread = Math.max(spread, Math.hypot(px, pz));
      }
      if (shows < settings.show * height * scale[1]) return null;

      v.set(0, (height / 2) * scale[1], 0).applyQuaternion(q);
      return {
        kind,
        shape,
        position: [x, y, z],
        rotation: [q.x, q.y, q.z, q.w],
        scale,
        height: height * scale[1],
        top,
        shows,
        spread,
        centre: [x + v.x, y + v.y, z + v.z],
        radius: reach[shape] * Math.max(...scale),
        footprint: hull(points.map(([px, , pz]) => island.toCove(x + px, z + pz))),
      };
    }, clearance);
    rocks.push(...placed);
  }
  return rocks;
}
