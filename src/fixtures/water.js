// Tool fixture (?fixture=water): what the water sees under its surface is what
// JS's exact ray meets, and the light it works out from that is its JS twin's
// (CLAUDE.md §5). A sloping seabed whose colour holds its own position, and a
// block standing out of the water near the camera, drawn into a target of the
// fixture's own in place of the opaque scene; then the water's own code
// (water-seen.wgsl, water-optics.wgsl) over a flat surface, into a float target,
// from a few cameras. Per point of the surface in view that JS says sees the
// seabed: how far where the GPU landed lies from where the ray lands, how far
// off how deep it reads that, and how far its light is off its twin's; and the
// deliberate mistakes that must show, a ray that doesn't bend and light worked
// out half a metre too deep. No point may read what stands above the water. A
// second seabed lies deep and level from high cameras, as under a rock at a cliff's
// foot: a point whose ray misses the block must not read it, though the pixel its
// ray lands on shows it. window.__WATER__ holds them for tools/screenshot.js. Not
// part of the island.
import { Matrix4, Vector3, degToRad } from '../maths/index.js';
import shader from './water.wgsl';
import plateShader from './water-plate.wgsl';
import { Camera } from '../core/camera.js';
import { Material } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh } from '../gpu/scene.js';
import { createTarget } from '../gpu/texture.js';
import { opticsUniforms } from '../water/water.js';
import { waterLeaving } from '../water/optics.js';

const SIZE = 256;
const STEP = 3; // pixels between the points it judges
// The seabed: y = -(from + slope x how far along -z), and how far it reaches; and the cameras over it.
const SEABED = { reach: 300, width: 400 };
const SCENES = [
  {
    from: 0.2,
    slope: 0.07,
    cameras: [
      { height: 2.5, pitch: -25, fov: 60 },
      { height: 8, pitch: -40, fov: 60 },
      { height: 1.2, pitch: -12, fov: 50 },
      { height: 30, pitch: -70, fov: 40 },
    ],
  },
  {
    from: 20,
    slope: 0,
    cameras: [
      { height: 31, pitch: -15, fov: 60 },
      { height: 12, pitch: -25, fov: 60 },
    ],
  },
];
// The block: its near face's z, its half-width, how high it stands, how deep it is.
const BLOCK = { z: -9, halfWidth: 1.2, top: 1.2, depth: 2 };
const SUN = { cos: 0.8, light: [0.5, 0.48, 0.42], sky: [0.06, 0.09, 0.14] };
const MISTAKE = { deeper: 0.5 };
const ABOVE = 1000; // what stands above the water reads as this, no point of the seabed

export function create(ctx) {
  const { renderer, gpu, config } = ctx;
  const flat = (width, height, sx = 1, sy = 1) => plane(width, height, sx, sy).applyMatrix4(new Matrix4().makeRotationX(-Math.PI / 2));

  const ready = (async () => {
    const opaque = createTarget(gpu, { name: 'fixture-water-opaque', width: SIZE, height: SIZE, format: 'rgba16float', depth: true });
    const output = createTarget(gpu, { name: 'fixture-water-output', width: SIZE, height: SIZE, format: 'rgba32float' });
    const seabedUniform = () => ({ value: new Vector3(0, 0, SEABED.reach) });
    const plateMaterial = new Material({ name: 'fixture-water-plate', shader: plateShader, side: 'double', uniforms: { uSeabed: seabedUniform(), uMark: { value: 0 } } });
    const blockMaterial = new Material({ name: 'fixture-water-block', shader: plateShader, side: 'double', uniforms: { uSeabed: seabedUniform(), uMark: { value: ABOVE } } });
    // The plate's vertices lie at x, z; its shader bends it to the slope.
    const seabedMesh = new Mesh(flat(SEABED.width, SEABED.reach, 64, 256), plateMaterial);
    seabedMesh.position.set(0, 0, -SEABED.reach / 2);
    const face = new Mesh(plane(2 * BLOCK.halfWidth, BLOCK.top + 30), blockMaterial); // its near face, from the deep to out of the water
    face.position.set(0, (BLOCK.top - 30) / 2, BLOCK.z);
    const top = new Mesh(flat(2 * BLOCK.halfWidth, BLOCK.depth), blockMaterial);
    top.position.set(0, BLOCK.top, BLOCK.z - BLOCK.depth / 2);
    const meshes = [seabedMesh, face, top];

    const surface = new Mesh(flat(2 * SEABED.width, 2 * SEABED.width, 8, 8), null);
    const modes = [0, 1].map(
      (mode) =>
        new Material({
          name: 'fixture-water',
          shader,
          side: 'double',
          uniforms: {
            ...opticsUniforms(config.water),
            uOpaque: { value: opaque.color },
            uOpaqueDepth: { value: opaque.depth },
            uMode: { value: mode },
            uSunCos: { value: SUN.cos },
            uSunLight: { value: new Vector3(...SUN.light) },
            uSkyLight: { value: new Vector3(...SUN.sky) },
            uSeabed: seabedUniform(),
          },
        }),
    );
    for (const mesh of [...meshes, surface]) {
      mesh.frustumCulled = false;
      mesh.updateMatrixWorld();
    }

    const result = { points: 0, landing: 0, depth: 0, light: 0, unbent: 0, tooDeep: 0, reads: 0, above: 0, ghosts: 0 };
    const camera = new Camera(60, 1, config.camera.near, config.camera.far);
    for (const scene of SCENES) {
      for (const material of [plateMaterial, blockMaterial, ...modes]) material.uniforms.uSeabed.value.set(scene.from, scene.slope, SEABED.reach);
      for (const { height, pitch, fov } of scene.cameras) {
        camera.fov = fov;
        camera.position.set(0, height, 0);
        camera.rotation.set(degToRad(pitch), 0, 0);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        renderer.render(meshes, camera, opaque, { clearColor: [0, 0, 0, 0], clearDepth: 0 });
        const reads = [];
        for (const material of modes) {
          surface.material = material;
          renderer.render([surface], camera, output, { clearColor: [0, 0, 0, 0] });
          reads.push(await output.color.read());
        }
        judge(reads[0], reads[1], { height, pitch, fov, camera, water: config.water, scene }, result);
      }
    }
    window.__WATER__ = result;
    opaque.dispose();
    output.dispose();
    for (const mesh of [...meshes, surface]) mesh.geometry.dispose();
    for (const material of [plateMaterial, blockMaterial, ...modes]) material.dispose();
  })();
  return {
    ready,
    update() {},
    dispose() {
      delete window.__WATER__;
    },
  };
}

// Each pixel's ray through the flat surface, as JS works it out, against what
// the GPU saw (seen: its colour and how deep) and the light it worked out.
function judge(seen, light, { height, pitch, fov, camera, water, scene }, result) {
  const tan = Math.tan(degToRad(fov) / 2);
  const [cp, sp] = [Math.cos(degToRad(pitch)), Math.sin(degToRad(pitch))];
  const eta = 1 / water.ior;
  for (let j = 4; j < SIZE - 4; j += STEP) {
    for (let i = 4; i < SIZE - 4; i += STEP) {
      const k = 4 * (j * SIZE + i);
      // The view's direction in world space: the camera pitched about x.
      const vx = ((2 * (i + 0.5)) / SIZE - 1) * tan;
      const vy = (1 - (2 * (j + 0.5)) / SIZE) * tan;
      const length = Math.hypot(vx, vy, 1);
      const [dx, dy, dz] = [vx / length, (vy * cp + sp) / length, (vy * sp - cp) / length];
      if (dy >= -0.02) continue; // towards the horizon: past the seabed's reach
      const t = -height / dy;
      const [px, pz] = [t * dx, t * dz];
      if (hidden(height, dx, dy, dz, t)) continue; // the block stands before the surface here: not drawn

      // Bent at the surface, then down to the slope.
      const cosAbove = -dy;
      const cosBelow = Math.sqrt(1 - eta * eta * (1 - cosAbove * cosAbove));
      const [bx, bz] = [eta * dx, eta * dz];
      const along = (scene.from - scene.slope * pz) / (cosBelow + scene.slope * bz);
      const [hx, hz] = [px + along * bx, pz + along * bz];
      const depth = scene.from - scene.slope * hz;
      // Past the seabed, or over the fade, there is nothing to tell it by.
      if (seen[k + 3] >= water.seabedFade[1] || depth > water.seabedFade[0] || hz > -1 || -hz > 0.8 * SEABED.reach || Math.abs(hx) > 0.4 * SEABED.width) continue;
      // The eye's own line to it running along the slope: it can't be told apart on screen.
      const eye = Math.hypot(hx, height + depth, hz);
      if (Math.abs(-(height + depth) / eye - (scene.slope * hz) / eye) < 0.04) continue;
      const on = new Vector3(hx, -depth, hz).project(camera);
      if (Math.abs(on.x) > 0.97 || Math.abs(on.y) > 0.97) continue; // off the frame: what it reads then is a choice, not a fact
      result.reads++;
      if (seen[k] >= 0.9 * ABOVE) {
        result.above++; // read what stands above the water as if under it
        continue;
      }
      // The ray does meet the block, or passes within a pixel's reach of it: nothing to say of where it lands.
      const toBlock = (BLOCK.z - pz) / bz;
      const crossing = toBlock > -1 / Math.abs(bz) && toBlock < along + 1 / Math.abs(bz);
      if (crossing && Math.abs(px + toBlock * bx) < BLOCK.halfWidth + 1) continue;
      // Read the block's face, though its ray lands well clear of it.
      if (Math.abs(seen[k + 1] - BLOCK.z) < 0.05 && Math.abs(seen[k] - hx) + Math.abs(hz - BLOCK.z) > 1.5) result.ghosts++;

      result.points++;
      result.landing = Math.max(result.landing, Math.hypot(seen[k] - hx, seen[k + 1] - hz));
      result.depth = Math.max(result.depth, Math.abs(seen[k + 3] - depth));
      // Where the straight ray lands, if it does, which bending must move it from.
      const down = cosAbove + scene.slope * dz;
      if (down > 0.01) {
        const straight = (scene.from - scene.slope * pz) / down;
        result.unbent = Math.max(result.unbent, Math.hypot(hx - (px + straight * dx), hz - (pz + straight * dz)));
      }
      // The light, from the seabed and depth it read, against the twin's.
      const seabed = [seen[k], seen[k + 1], seen[k + 2]];
      const twin = waterLeaving(seabed, seen[k + 3], cosAbove, SUN.cos, SUN.light, SUN.sky, water);
      const deeper = waterLeaving(seabed, seen[k + 3] + MISTAKE.deeper, cosAbove, SUN.cos, SUN.light, SUN.sky, water);
      for (let c = 0; c < 3; c++) {
        const scale = Math.max(Math.abs(twin[c]), 1e-3);
        result.light = Math.max(result.light, Math.abs(light[k + c] - twin[c]) / scale);
        result.tooDeep = Math.max(result.tooDeep, Math.abs(light[k + c] - deeper[c]) / scale);
      }
    }
  }
}

// Whether the block stands between the camera and the surface `t` along this ray.
function hidden(height, dx, dy, dz, t) {
  const inside = (x, z) => Math.abs(x) <= BLOCK.halfWidth && z <= BLOCK.z && z >= BLOCK.z - BLOCK.depth;
  const toFace = BLOCK.z / dz;
  const y = height + toFace * dy;
  if (toFace < t && y >= 0 && y <= BLOCK.top && Math.abs(toFace * dx) <= BLOCK.halfWidth) return true;
  if (height <= BLOCK.top) return false;
  const toTop = (BLOCK.top - height) / dy;
  return toTop < t && inside(toTop * dx, toTop * dz);
}
