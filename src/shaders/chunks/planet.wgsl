// The world is flat; the sky and the haze are a curved planet's (CLAUDE.md
// §8). Surfaces that reach far bend down with the planet by planetDrop(), so
// they end where the sky's horizon is and the haze before them matches the
// sky's; whatever stands on them bends with them. The drop is measured from the
// camera, as the sea's surface falls away below level with distance.
// Needs `frame` (frame.wgsl, or frame-values.wgsl in passes).

// How far below level the planet's surface lies at world xz, in metres.
fn planetDrop(xz: vec2f) -> f32 {
  let away = xz - frame.cameraPosition.xz;
  return dot(away, away) / (2000.0 * frame.uGroundRadius);
}
