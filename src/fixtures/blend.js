// Tool fixture (?fixture=blend): cards over bands of light from dark to brighter
// than the sun's glow, each beside an opaque reference that shows the same mix
// computed in linear light (layout in blend-layout.js). The frame must blend
// translucent layers so the cards match their references, also over the
// brightest bands, where blending in the HDR target's compressed space darkens
// them by stops; hide them behind an opaque bar; and hand the after-opaque card
// the opaque scene to mix with, and its depth (the card turns magenta where it
// puts the scene beyond the bands). tools/screenshot.js compares the two halves. It
// also routes the frame through a post pass that changes nothing, so the post
// chain runs. Not part of the island.
import { MathUtils, Vector3 } from 'three';
import shader from './blend.wgsl';
import copyShader from './copy.wgsl';
import { Material } from '../gpu/material.js';
import { plane } from '../gpu/geometry.js';
import { Mesh, Node } from '../gpu/scene.js';
import { blendLayout, cardSpan } from './blend-layout.js';

const BANDS_DISTANCE = 20; // m (blend.wgsl's)
const CARD_DISTANCE = 10; // m
const BAR_DISTANCE = 8; // m

export function create(ctx) {
  const { scene, camera, frame, renderer } = ctx;
  const group = new Node();
  group.position.copy(camera.position);
  group.quaternion.copy(camera.quaternion);
  scene.add(group);

  const materials = [];
  const material = (mode, { color = [0, 0, 0], alpha = 1 } = {}) => {
    const m = new Material({
      name: `fixture-blend-${['bands', 'card', 'reference', 'after-opaque', 'bar'][mode]}`,
      shader,
      uniforms: {
        uHeight: { value: frame.size.height },
        uBands: { value: blendLayout.bands },
        uMode: { value: mode },
        uColor: { value: new Vector3(...color) },
        uAlpha: { value: alpha },
        // Only the after-opaque pass may read the opaque scene: the opaque pass draws into it.
        uOpaque: { value: mode === 3 ? frame.opaque.color : null },
        uOpaqueDepth: { value: mode === 3 ? frame.opaque.depth : null },
      },
    });
    materials.push(m);
    return m;
  };
  // A plane facing the camera that spans [left, right] of the frame's width and
  // [bottom, top] of its height (all of it, with a margin, by default).
  const meshes = [];
  const card = (distance, [left, right], m, [bottom, top] = [-0.01, 1.01]) => {
    const height = 2 * distance * Math.tan(MathUtils.degToRad(camera.fov / 2));
    const width = height * camera.aspect;
    const mesh = new Mesh(plane((right - left) * width, (top - bottom) * height), m);
    mesh.position.set(((left + right) / 2 - 0.5) * width, ((top + bottom) / 2 - 0.5) * height, -distance);
    group.add(mesh);
    meshes.push(mesh);
    return mesh;
  };

  card(BANDS_DISTANCE, [0, 1], material(0));
  blendLayout.cards.forEach((layout, i) => {
    const [left, right] = cardSpan(i);
    const mesh = card(CARD_DISTANCE, [left, right], material(layout.afterOpaque ? 3 : 1, layout));
    if (layout.afterOpaque) mesh.pass = 'afterOpaque';
    else frame.translucent(mesh);
    card(CARD_DISTANCE, [left + 0.5, right + 0.5], material(2, layout));
  });
  const { bar } = blendLayout;
  card(BAR_DISTANCE, [-0.01, 1.01], material(4, { color: bar.color }), [bar.bottom, bar.top]);
  const stopResize = frame.onResize(({ height }) => {
    for (const m of materials) m.uniforms.uHeight.value = height;
  });

  const copy = renderer.fullscreen(new Material({ name: 'fixture-blend-copy', shader: copyShader, uniforms: { uInput: { value: null } } }));
  const removePost = frame.addPost((_, input, output) => {
    copy.uniforms.uInput.value = input;
    copy.render(output);
  });

  return {
    update() {},
    dispose() {
      removePost();
      stopResize();
      copy.dispose();
      scene.remove(group);
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
