// The sunlight table's mapping (sky/atmosphere.js renders the table): the
// sun's illuminance on a surface facing it, by the height above the sea, for
// one sun. Low sunlight crosses the haze near the sea on a long slant, so it
// grows fast with height: at sunset hilltops catch several times the beach's
// light. Texels crowd near the sea, where it changes fastest. h in km.
// Needs `frame` (frame.wgsl or frame-values.wgsl).

fn sunlightU(h: f32) -> f32 {
  return (sqrt(clamp(h / frame.uSunlightTop, 0.0, 1.0)) * (frame.uSunlightSize - 1.0) + 0.5) / frame.uSunlightSize;
}

fn sunlightHeight(u: f32) -> f32 {
  let x = (u * frame.uSunlightSize - 0.5) / (frame.uSunlightSize - 1.0);
  return x * x * frame.uSunlightTop;
}
