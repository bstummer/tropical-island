// Angles and clamping, as three.js's MathUtils computes them (see index.js):
// degToRad(x) is x * (π / 180), whose bits differ from x * π / 180.

export const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export function degToRad(degrees) {
  return degrees * DEG2RAD;
}

export function radToDeg(radians) {
  return radians * RAD2DEG;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
