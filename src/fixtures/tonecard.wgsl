// Fixture: the HDR test card, top to bottom. See tonecard.js.
//   sky       sunset gradient, brighter to the right, with a sun disk (300) and glow
//   swatches  water, deep sea, palm, sand, hibiscus, frangipani; rows at -2 to +2 stops
//   grey      a ramp from 2^-8 to 2^6
//   colours   red, green, blue and cyan ramps from 2^-4 to 2^6

#include "card.wgsl"
#include "chunks/scene-output.wgsl"

fn fromSrgb(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}

fn swatch(i: i32) -> vec3f {
  if (i == 0) { return fromSrgb(vec3f(0.17, 0.70, 0.74)); } // shallow water
  if (i == 1) { return fromSrgb(vec3f(0.04, 0.25, 0.43)); } // deep sea
  if (i == 2) { return fromSrgb(vec3f(0.25, 0.49, 0.16)); } // palm
  if (i == 3) { return fromSrgb(vec3f(0.86, 0.77, 0.59)); } // sand
  if (i == 4) { return fromSrgb(vec3f(0.82, 0.13, 0.23)); } // hibiscus
  return fromSrgb(vec3f(0.97, 0.91, 0.65)); // frangipani
}

@fragment
fn fragmentMain(in: Varyings) -> @location(0) vec4f {
  let uv = in.vUv;
  // Derivatives before any branch (WGSL's uniformity rules).
  let cell = vec2f(uv.x * 6.0, (uv.y - 0.4) / 0.3 * 5.0);
  let cellWidth = fwidth(cell);
  let rowWidth = fwidth(uv.y);
  var c: vec3f;
  if (uv.y > 0.7) {
    let y = (uv.y - 0.7) / 0.3; // 0 at the horizon, 1 at the top
    c = mix(vec3f(1.6, 0.55, 0.18), vec3f(0.02, 0.04, 0.12), pow(y, 0.6)) * mix(1.0, 3.0, uv.x);
    let d = length((uv - vec2f(0.8, 0.76)) * vec2f(1.78, 1.0));
    c += vec3f(1.0, 0.75, 0.45) * (300.0 * (1.0 - smoothstep(0.018, 0.022, d)) + 6.0 * exp(-25.0 * d));
  } else if (uv.y > 0.4) {
    c = swatch(i32(cell.x)) * exp2(floor(cell.y) - 2.0);
    // Black lines about two pixels wide between the cells, filtered by pixel footprint.
    let edge = min(fract(cell), 1.0 - fract(cell)) / cellWidth;
    c *= clamp(min(edge.x, edge.y) - 1.0, 0.0, 1.0);
  } else if (uv.y > 0.2) {
    c = vec3f(exp2(mix(-8.0, 6.0, uv.x)));
  } else {
    let row = i32(uv.y / 0.2 * 4.0);
    var hue = vec3f(0.02, 0.8, 1.0);
    if (row == 3) {
      hue = vec3f(1.0, 0.02, 0.02);
    } else if (row == 2) {
      hue = vec3f(0.02, 1.0, 0.02);
    } else if (row == 1) {
      hue = vec3f(0.02, 0.05, 1.0);
    }
    c = hue * exp2(mix(-4.0, 6.0, uv.x));
  }

  // Black lines about two pixels wide between bands and ramps, filtered like the cells'.
  let edges = array<f32, 6>(0.05, 0.1, 0.15, 0.2, 0.4, 0.7);
  var d = 1.0;
  for (var i = 0; i < 6; i++) {
    d = min(d, abs(uv.y - edges[i]));
  }
  c *= clamp(d / rowWidth - 1.0, 0.0, 1.0);

  return sceneOutput(c, 1.0);
}
