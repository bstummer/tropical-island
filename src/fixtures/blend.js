// Tool fixture (?fixture=blend): cards over bands of light from dark to brighter
// than the sun's glow, each beside an opaque reference that shows the same mix
// computed in linear light (layout in blend-layout.js). The frame must blend
// translucent layers so the cards match their references, also over the
// brightest bands, where blending in the HDR target's compressed space darkens
// them by stops; hide them behind an opaque bar; and hand the after-opaque card
// the opaque scene to mix with. tools/screenshot.js compares the two halves. It
// also routes the frame through a post pass that changes nothing, so the post
// chain runs. Not part of the island.
import * as THREE from 'three';
import vertexShader from './gradient.vert';
import fragmentShader from './blend.frag';
import copyShader from './copy.frag';
import outputVertex from '../post/output.vert';
import { createFullscreen } from '../post/fullscreen.js';
import { blendLayout, cardSpan } from './blend-layout.js';

const BANDS_DISTANCE = 20; // m
const CARD_DISTANCE = 10; // m
const BAR_DISTANCE = 8; // m

export function create(ctx) {
  const { scene, camera, frame } = ctx;
  const group = new THREE.Group();
  group.position.copy(camera.position);
  group.quaternion.copy(camera.quaternion);
  scene.add(group);

  const materials = [];
  const material = (mode, { color = [0, 0, 0], alpha = 1 } = {}) => {
    const m = new THREE.ShaderMaterial({
      name: `fixture-blend-${['bands', 'card', 'reference', 'after-opaque', 'bar'][mode]}`,
      vertexShader,
      fragmentShader,
      uniforms: {
        ...frame.uniforms,
        uHeight: { value: frame.size.height },
        uBands: { value: blendLayout.bands },
        uMode: { value: mode },
        uColor: { value: new THREE.Vector3(...color) },
        uAlpha: { value: alpha },
        uOpaque: { value: frame.opaque.color },
      },
    });
    materials.push(m);
    return m;
  };
  // A plane facing the camera that spans [left, right] of the frame's width and
  // [bottom, top] of its height (all of it, with a margin, by default).
  const plane = (distance, [left, right], m, [bottom, top] = [-0.01, 1.01]) => {
    const height = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const width = height * camera.aspect;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry((right - left) * width, (top - bottom) * height), m);
    mesh.position.set(((left + right) / 2 - 0.5) * width, ((top + bottom) / 2 - 0.5) * height, -distance);
    group.add(mesh);
    return mesh;
  };

  plane(BANDS_DISTANCE, [0, 1], material(0));
  blendLayout.cards.forEach((card, i) => {
    const [left, right] = cardSpan(i);
    const mesh = plane(CARD_DISTANCE, [left, right], material(card.afterOpaque ? 3 : 1, card));
    if (card.afterOpaque) mesh.layers.set(frame.layers.afterOpaque);
    else frame.translucent(mesh);
    plane(CARD_DISTANCE, [left + 0.5, right + 0.5], material(2, card));
  });
  const { bar } = blendLayout;
  plane(BAR_DISTANCE, [-0.01, 1.01], material(4, { color: bar.color }), [bar.bottom, bar.top]);
  const stopResize = frame.onResize(({ height }) => {
    for (const m of materials) m.uniforms.uHeight.value = height;
  });

  const copy = createFullscreen(new THREE.ShaderMaterial({ name: 'fixture-blend-copy', vertexShader: outputVertex, fragmentShader: copyShader, uniforms: { uInput: { value: null } } }));
  const removePost = frame.addPost((renderer, input, output) => {
    copy.uniforms.uInput.value = input;
    copy.render(renderer, output);
  });

  return {
    update() {},
    dispose() {
      removePost();
      stopResize();
      copy.dispose();
      scene.remove(group);
      group.traverse((object) => object.geometry?.dispose());
      for (const m of materials) m.dispose();
    },
  };
}
