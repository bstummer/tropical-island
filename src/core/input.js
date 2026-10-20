import * as THREE from 'three';

// Pointer-lock mouse look + free-fly camera (walking comes later).
//   Mouse: look · W/A/S/D: move along the view direction · Space: up · Shift: down
//   Wheel: fly speed · Esc: release the mouse
//   P (dev builds only): log the camera as a views.js entry and copy it to the clipboard
export function create(ctx) {
  const { camera, renderer, config } = ctx;
  const { movement } = config;
  const canvas = renderer.domElement;
  const overlay = document.getElementById('start');

  const pressed = new Set();
  const look = new THREE.Euler(0, 0, 0, 'YXZ').copy(camera.rotation);
  const maxPitch = THREE.MathUtils.degToRad(movement.maxPitch);
  const move = new THREE.Vector3();
  let speed = movement.flySpeed;

  const locked = () => document.pointerLockElement === canvas;

  function lock() {
    // Chrome rejects re-locking right after Esc; the next click will work.
    Promise.resolve(canvas.requestPointerLock()).catch(() => {});
  }

  function onLockChange() {
    overlay.hidden = locked();
    if (!locked()) pressed.clear();
  }

  function onMouseMove(e) {
    if (!locked()) return;
    look.y -= e.movementX * movement.lookSensitivity;
    look.x = THREE.MathUtils.clamp(look.x - e.movementY * movement.lookSensitivity, -maxPitch, maxPitch);
    camera.rotation.copy(look);
  }

  function onKeyDown(e) {
    if (import.meta.env.DEV && e.code === 'KeyP' && !e.repeat) logView();
    if (!locked()) return;
    pressed.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  }

  function onWheel(e) {
    if (!locked()) return;
    const step = e.deltaY < 0 ? movement.wheelSpeedStep : 1 / movement.wheelSpeedStep;
    speed = THREE.MathUtils.clamp(speed * step, movement.minFlySpeed, movement.maxFlySpeed);
  }

  function onKeyUp(e) {
    pressed.delete(e.code);
  }

  function onBlur() {
    pressed.clear();
  }

  function logView() {
    const r = (v, d = 2) => Number(v.toFixed(d));
    const deg = (rad) => r(THREE.MathUtils.radToDeg(rad), 1);
    const p = camera.position;
    const entry =
      `{ name: 'new-view', position: [${r(p.x)}, ${r(p.y)}, ${r(p.z)}], ` +
      `yaw: ${deg(look.y)}, pitch: ${deg(look.x)}, fov: ${r(camera.fov, 1)}, timeOfDay: ${r(ctx.timeOfDay)}, brief: '' },`;
    console.log(entry);
    navigator.clipboard?.writeText(entry).then(
      () => console.log('[input] view copied to clipboard'),
      () => console.log('[input] clipboard unavailable; copy the line above'),
    );
  }

  overlay.hidden = false;
  overlay.addEventListener('click', lock);
  document.addEventListener('pointerlockchange', onLockChange);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('blur', onBlur);

  return {
    update(dt) {
      if (!locked() || dt === 0) return;
      const axis = (pos, neg) => (pressed.has(pos) ? 1 : 0) - (pressed.has(neg) ? 1 : 0);
      const shift = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
      move.set(axis('KeyD', 'KeyA'), 0, -axis('KeyW', 'KeyS')).applyEuler(look);
      move.y += (pressed.has('Space') ? 1 : 0) - (shift ? 1 : 0);
      if (move.lengthSq() > 0) camera.position.addScaledVector(move.normalize(), speed * dt);
    },
    dispose() {
      overlay.removeEventListener('click', lock);
      document.removeEventListener('pointerlockchange', onLockChange);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      document.removeEventListener('wheel', onWheel);
      window.removeEventListener('blur', onBlur);
      if (locked()) document.exitPointerLock();
    },
  };
}
