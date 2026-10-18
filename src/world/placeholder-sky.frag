// TEMPORARY: placeholder sky dome. A two-colour gradient plus a soft sun.

#include <common>
#include <dithering_pars_fragment>

uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;

varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  vec3 color = mix(uHorizon, uZenith, sqrt(max(d.y, 0.0)));
  float s = max(dot(d, uSunDir), 0.0);
  color += uSunColor * (8.0 * pow(s, 900.0) + 0.3 * pow(s, 12.0));

  gl_FragColor = vec4(color, 1.0);
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
