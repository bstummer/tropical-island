// Where the rocks lie (PLAN.md Stage 4.5): boulders along rocky shores, big
// blocks and fallen columns at the foot of the cliffs, a few on the sand next
// to them, crags on steep ground and stones scattered inland, each kind by a
// rule of world/scatter.js: the first things placed on the ground. Each rock
// is one of world/rock-shapes.js's prototypes, turned, tipped, leaning with
// the ground, scaled, and sunk until its lower part lies under the ground all
// round, then deeper by its kind's share of its height: rocks sit in the
// ground, not on it. One that would show too little of itself above the
// ground isn't placed. Settings: config.world.rocks. Pure and Node-importable.
import { Quaternion, Vector3 } from 'three';
import { scatter } from './scatter.js';

const UP = new Vector3(0, 1, 0);
const NORMAL_STEP = 0.5; // m either side, for the ground's normal

// The rocks within `region` (scatter's, cove frame): an array of { kind,
// shape (index into shapes), position [x, y, z], rotation [x, y, z, w],
// scale [x, y, z], height (m), spread (how far it reaches across the ground
// from its position, m), centre [x, y, z] and radius (a sphere round it) }.
// seedOf(kind) gives each kind's integer seed.
export function placeRocks(heightmap, island, shapes, settings, region, seedOf) {
  const byKind = { block: [], column: [] };
  shapes.forEach((shape, index) => byKind[shape.kind].push(index));
  // How far each prototype reaches from the middle of its height.
  const reach = shapes.map(({ positions, height }) => {
    let max = 0;
    for (let i = 0; i < positions.length; i += 3) max = Math.max(max, Math.hypot(positions[i], positions[i + 1] - height / 2, positions[i + 2]));
    return max;
  });

  const rocks = [];
  const yaw = new Quaternion();
  const tip = new Quaternion();
  const lean = new Quaternion();
  const q = new Quaternion();
  const axis = new Vector3();
  const normal = new Vector3();
  const v = new Vector3();
  for (const [kind, rule] of Object.entries(settings.kinds)) {
    scatter(heightmap, { ...rule, seed: seedOf(kind) }, region, (a, o, ground, random) => {
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

      // Sunk until every point of its lower part is under the ground, and deeper by `sink` of its height.
      const { lower, positions, height } = shapes[shape];
      let base = Infinity;
      for (let i = 0; i < lower.length; i += 3) {
        v.set(lower[i] * scale[0], lower[i + 1] * scale[1], lower[i + 2] * scale[2]).applyQuaternion(q);
        base = Math.min(base, h(x + v.x, z + v.z) - v.y);
      }
      const y = base - rule.sink * height * scale[1];
      let shows = -Infinity;
      let spread = 0;
      for (let i = 0; i < positions.length; i += 3) {
        v.set(positions[i] * scale[0], positions[i + 1] * scale[1], positions[i + 2] * scale[2]).applyQuaternion(q);
        shows = Math.max(shows, y + v.y - h(x + v.x, z + v.z));
        spread = Math.max(spread, Math.hypot(v.x, v.z));
      }
      if (shows < settings.show * height * scale[1]) return;

      v.set(0, (height / 2) * scale[1], 0).applyQuaternion(q);
      rocks.push({
        kind,
        shape,
        position: [x, y, z],
        rotation: [q.x, q.y, q.z, q.w],
        scale,
        height: height * scale[1],
        spread,
        centre: [x + v.x, y + v.y, z + v.z],
        radius: reach[shape] * Math.max(...scale),
      });
    });
  }
  return rocks;
}
