// Tool fixture (?fixture=sea-light): the far sea keeps the near sea's average light
// at the same angles (PLAN.md 6.4), as what a far pixel's waves do on average, it
// has to work out; a near pixel simply shows. The real sea, with no air in front of
// it, as the air has its own check (`haze`), and with no ceiling on the sun's light in
// the water, which holds back flashes more than a smooth band. tools/screenshot.js
// looks at it from low and from high up at the same angles, at a few times, and
// reads the mean exposed light of the frame through window.__SEA_LIGHT__: { look(fov),
// read(), mistake(on) }: its mistake leaves out what the far pixel's waves do. Not
// part of the island.
import { Texture } from '../gpu/texture.js';
import { Vector4 } from '../maths/index.js';

// One half float texel, as the frame's tables hold it.
const texel = (gpu, name, dimension, value) => new Texture(gpu, { name, width: 1, height: 1, dimension, format: 'rgba16float', data: true, sampler: { mag: 'linear', min: 'linear' } }).upload(new Uint16Array([value, value, value, value]));
const HALF_ONE = 0x3c00;

export function create(ctx) {
  const { gpu, frame, camera } = ctx;
  const noAir = texel(gpu, 'fixture-sea-light air', '3d', 0);
  const allThrough = texel(gpu, 'fixture-sea-light through', '2d', HALF_ONE);
  frame.uniforms.uAerial.value = noAir;
  frame.uniforms.uAerialTransmittance.value = allThrough;
  const ready = ctx.water.ready.then(() => {
    const { uniforms } = ctx.water.material;
    uniforms.uSunCeiling.value = 1e9;
    const { value: unresolved } = uniforms.uUnresolved;
    window.__SEA_LIGHT__ = {
      look(fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      },
      async read() {
        const stored = await frame.sceneTarget.color.read();
        const sum = [0, 0, 0];
        const texels = stored.length / 4;
        for (let n = 0; n < texels; n++) {
          const [r, g, b] = [stored[4 * n], stored[4 * n + 1], stored[4 * n + 2]];
          const open = Math.max(1 - Math.max(r, g, b), 1 / 2048); // chunks/scene-output.wgsl sceneRadiance
          sum[0] += r / open;
          sum[1] += g / open;
          sum[2] += b / open;
        }
        return sum.map((c) => c / texels);
      },
      mistake(on) {
        uniforms.uUnresolved.value = on ? unresolved.map(() => new Vector4()) : unresolved;
      },
    };
  });
  return {
    ready,
    update() {},
    dispose() {
      delete window.__SEA_LIGHT__;
      noAir.destroy();
      allThrough.destroy();
    },
  };
}
