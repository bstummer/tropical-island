// The shared lighting model (CLAUDE.md §8): every lit scene material shades
// with it, then lets the air between it and the camera have its say:
//
//   vec3 radiance = albedo / PI * (sunLight(position, normal) + skyIrradiance(position, normal));
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
// uSkySH (sh.glsl): the sky's radiance as SH, above the horizon only
uniform vec3 uLevelLight; // irradiance on level ground in the open: sun and sky
uniform vec3 uBounceAlbedo; // the ground's, for the light it sends back up (groundAlbedo())
uniform sampler2D uSkyView;
uniform vec2 uSkyViewSize;
uniform float uSkyViewHeight; // km: the camera's height the sky-view table is for
uniform sampler3D uAerial;
uniform sampler2D uAerialTransmittance;

// How much of the sun reaches a point, per colour: 1 lit, 0 in shadow, tinted
// where it comes through leaves or water. The one place where shadows join the
// light: Stage 5's sun shadows and Stage 10's cloud shadows multiply in here,
// so every material gets them.
vec3 sunVisibility(vec3 position, vec3 normal) { // position first, as everywhere here
  return vec3(1.0);
}

// Irradiance from the sun on a surface with this normal.
vec3 sunLight(vec3 position, vec3 normal) {
  return uSunRadiance * max(dot(normal, uSunDirection), 0.0) * sunVisibility(position, normal);
}

// The albedo of the ground below a point, which sends the light on it back up.
// The far sea's everywhere for now (config.sky.atmosphere.groundAlbedo): the
// terrain gives its own here, sand on the beach (PLAN.md Stage 4).
vec3 groundAlbedo(vec3 position) {
  return uBounceAlbedo;
}

// Irradiance from the sky above and the ground below on a surface at position
// with normal n. The ground is diffuse, lit as level ground in the open is, and
// fills the lower half of the view from the surface. Where something blocks the
// sky (a canopy, PLAN.md Stage 8), it is blocked here.
vec3 skyIrradiance(vec3 position, vec3 n) {
  return shIrradiance(n) + groundAlbedo(position) * uLevelLight * (0.5 - 0.5 * n.y);
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
