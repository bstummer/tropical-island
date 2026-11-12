// How tiles drift over the water (water/drift.js): whole tiles in their loop, yet at
// the speed and the way asked, for the wind's gusts and the surf's lace, on every
// island the seeds make (the wind's way in the world goes by the cove's).
import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { createRandom } from '../src/core/random.js';
import { createIsland } from '../src/world/island.js';
import { alongDrifting, driftsOf, twoDrifting } from '../src/water/drift.js';

const { waves, surf } = config.water;
const side = config.world.island.cove.headlandSide;

test('the gusts drift with the wind and the lace with the swell, at their speed and on their way, whole tiles in their loop', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const island = createIsland(createRandom(seed));
    const direction = (degrees) => {
      const t = (degrees * Math.PI) / 180;
      return island.fromCove(side * Math.sin(t), Math.cos(t));
    };
    const cases = [
      ['gusts', waves.gusts.speed, waves.gusts.sizes, direction(waves.chop.blows), waves.gusts.loop],
      ['foam', surf.drift, surf.patches, direction(waves.swell.from).map((v) => -v), waves.loop],
    ];
    for (const [name, speed, sizes, way, loop] of cases) {
      const drift = twoDrifting(speed, sizes, way, loop);
      for (const v of [drift.x, drift.y, drift.z, drift.w]) assert.ok(Number.isInteger(Math.round(v * loop * 1e6) / 1e6), `seed ${seed}: ${name} drift ${v * loop} tiles in the loop`);
      for (const [x, z] of driftsOf(drift, sizes)) {
        const fast = Math.hypot(x, z);
        const off = (Math.acos(Math.min((x * way[0] + z * way[1]) / fast, 1)) * 180) / Math.PI;
        assert.ok(Math.abs(fast / speed - 1) < 0.05, `seed ${seed}: ${name} drift at ${fast.toFixed(2)} m/s, not ${speed}`);
        assert.ok(off < 2, `seed ${seed}: ${name} drift ${off.toFixed(1)} degrees off its way`);
      }
    }
  }
});

test("the foam's lace drifts along the swell's way at its speed, whole tiles in the loop", () => {
  const { tiles, stretch } = surf.lace;
  const drifts = alongDrifting(surf.drift, tiles, stretch, waves.loop);
  drifts.forEach((v, n) => {
    assert.ok(Number.isInteger(Math.round(v * waves.loop * 1e6) / 1e6), `${v * waves.loop} tiles in the loop`);
    const fast = (v * tiles[n]) / stretch;
    assert.ok(Math.abs(fast / surf.drift - 1) < 0.05, `the lace read ${tiles[n]} m wide drifts at ${fast.toFixed(3)} m/s, not ${surf.drift}`);
  });
});
