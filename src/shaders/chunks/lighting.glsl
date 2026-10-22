// The shared lighting model (CLAUDE.md §8): every lit scene material shades
// with it, then lets the air between it and the camera have its say:
//
//   vec3 radiance = albedo / PI * (sunLight(position, normal) + skyIrradiance(normal));
//   gl_FragColor = sceneOutput(aerialPerspective(radiance, position), alpha);
//
// The light state (the uniforms below) lives in ctx.frame.uniforms, and
// sky/sky.js keeps it in step with the time of day, from the same atmosphere
// that draws the sky: sky, light and haze agree at every hour. Light is in
// units of the sun's illuminance above the atmosphere; the exposure scales it.

#include "sky-view.glsl"
#include "aerial.glsl"
#include "sh.glsl"

uniform vec3 uSunDirection; // towards the sun
uniform vec3 uSunRadiance; // the sun's illuminance on a surface facing it, at sea level
uniform vec3 uSkySH[9]; // the sky's radiance as SH (sh.glsl); below the horizon, the lit ground's
uniform sampler2D uSkyView;
uniform vec2 uSkyViewSize;
uniform float uSkyViewHeight; // km: the camera's height the sky-view table is for
uniform sampler3D uAerial;
uniform sampler2D uAerialTransmittance;

// How much of the sun reaches a point: 1 lit, 0 in shadow. The one place
// where shadows join the light: Stage 5's sun shadows and Stage 10's cloud
// shadows multiply in here, so every material gets them.
float sunVisibility(vec3 position, vec3 normal) { // position first, as everywhere here
  return 1.0;
}

// Irradiance from the sun on a surface with this normal.
vec3 sunLight(vec3 position, vec3 normal) {
  return uSunRadiance * max(dot(normal, uSunDirection), 0.0) * sunVisibility(position, normal);
}

// Irradiance from the whole sky, and from the ground below the horizon, on a
// surface with this normal.
vec3 skyIrradiance(vec3 n) {
  return shIrradiance(uSkySH, n);
}

// The sky's radiance towards dir, as the sky draws it: for reflections.
vec3 skyRadiance(vec3 dir) {
  vec2 across = dir.xz;
  vec2 sunAcross = uSunDirection.xz;
  float cosAzimuth = dot(across, sunAcross) / max(length(across) * length(sunAcross), 1e-6);
  return textureLod(uSkyView, skyViewUv(uSkyViewHeight, dir.y, cosAzimuth, uSkyViewSize), 0.0).rgb;
}

// The air between the camera and position: dims the light leaving there and
// adds the light it scatters towards the camera. Distant land and sea fade
// into the same haze the sky shows at the horizon.
vec3 aerialPerspective(vec3 radiance, vec3 position) {
  vec3 ray = position - cameraPosition;
  float d = length(ray);
  vec3 uvw = aerialUvw(ray / max(d, 1e-4), d * 0.001, uSunDirection);
  return radiance * texture(uAerialTransmittance, uvw.yz).rgb + texture(uAerial, uvw).rgb;
}
