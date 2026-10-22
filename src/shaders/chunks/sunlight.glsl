// The sunlight table's mapping (sky/atmosphere.js renders the table): the
// sun's illuminance on a surface facing it, by the height above the sea, for
// one sun. Low sunlight crosses the haze near the sea on a long slant, so it
// grows fast with height: at sunset hilltops catch several times the beach's
// light. Texels crowd near the sea, where it changes fastest. h in km.

uniform float uSunlightSize; // texels
uniform float uSunlightTop; // km: the table's top; above it, the top's light

float sunlightU(float h) {
  return (sqrt(clamp(h / uSunlightTop, 0.0, 1.0)) * (uSunlightSize - 1.0) + 0.5) / uSunlightSize;
}

float sunlightHeight(float u) {
  float x = (u * uSunlightSize - 0.5) / (uSunlightSize - 1.0);
  return x * x * uSunlightTop;
}
