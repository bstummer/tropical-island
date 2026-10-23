// The shared lighting model (CLAUDE.md §8): every lit scene material shades
// with it, then lets the air between it and the camera have its say:
//
//   vec3 radiance = albedo / PI * (sunLight(position, normal) + skyIrradiance(position, normal));
//   radiance += specularLight(position, normal, view, roughness, f0); // glossy surfaces only
//   gl_FragColor = sceneOutput(aerialPerspective(radiance, position), alpha);
//
// view points from the surface to the camera. A glossy surface's diffuse part
// gives up what its specular part takes: albedo * (1.0 - fresnel(f0, n.v)).
//
// The light state (the uniforms below) lives in ctx.frame.uniforms, and
// sky/sky.js keeps it in step with the time of day, from the same atmosphere
// that draws the sky: sky, light and haze agree at every hour. Light is in
// units of the sun's illuminance above the atmosphere; the exposure scales it.

#include "sky-view.glsl"
#include "aerial.glsl"
#include "sh.glsl"
#include "sunlight.glsl"
#include "terrain.glsl"

uniform vec3 uSunDirection; // towards the sun
uniform vec3 uSunRadiance; // the sun's illuminance on a surface facing it, at sea level
uniform sampler2D uSunlight; // and by the height above the sea (sunlight.glsl)
// uSkySH (sh.glsl): the sky's radiance as SH, above the horizon only
uniform vec3 uLevelLight; // irradiance on level ground in the open: sun and sky
uniform vec3 uBounceAlbedo; // the far sea's, for the light it sends back up where there is no ground (groundAlbedo())
uniform sampler2D uBounceMap; // the ground's albedo seen from above (world/albedo.js), linear
uniform vec4 uBounceLayout; // its corner in the cove's frame; 1 / its size in metres (0: no ground); the mip level read
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

// Irradiance from the sun on a surface with this normal. It grows with the
// height above the sea: a low sun's light crosses less haze on its way to a
// hilltop than to the beach.
vec3 sunLight(vec3 position, vec3 normal) {
  // The height above the sea, as before the planet's bend (planet.glsl), so
  // the light on a hill doesn't change as the camera moves away.
  float h = position.y + planetDrop(position.xz);
  vec3 sun = textureLod(uSunlight, vec2(sunlightU(h * 0.001), 0.5), 0.0).rgb;
  return sun * max(dot(normal, uSunDirection), 0.0) * sunVisibility(position, normal);
}

// The albedo of the ground around a point, which sends the light on it back
// up: sand on the beach, green inland, the sea over water, averaged over tens
// of metres (config.world.terrain.bounceReach). Where there is no ground, the
// far sea's.
vec3 groundAlbedo(vec3 position) {
  if (uBounceLayout.z == 0.0) return uBounceAlbedo;
  vec2 uv = (terrainCove(position.xz) - uBounceLayout.xy) * uBounceLayout.z;
  return textureLod(uBounceMap, uv, uBounceLayout.w).rgb;
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

// The share of light a surface with reflectance f0 at normal incidence
// reflects at an angle whose cosine is c (Schlick).
float fresnel(float f0, float c) {
  float m = 1.0 - clamp(c, 0.0, 1.0);
  return f0 + (1.0 - f0) * m * m * m * m * m;
}

// How much the normal turns across the pixel: specular lobes widen by it, so
// small glossy bumps and far ripples blur instead of sparkling (specular
// antialiasing, after Tokuyoshi and Kaplanyan 2019). Call it where every pixel
// around runs it: it takes derivatives.
float specularKernel(vec3 n) {
  vec3 dx = dFdx(n);
  vec3 dy = dFdy(n);
  return min(0.5 * (dot(dx, dx) + dot(dy, dy)), 0.18);
}

// A roughness widened by that kernel.
float filteredRoughness(float roughness, float kernel) {
  float a = roughness * roughness;
  return sqrt(sqrt(min(a * a + kernel, 1.0)));
}

// Light a glossy surface mirrors towards the eye: the sun's lobe (GGX, with
// Smith's shadowing) and the sky around the mirrored direction, blurred
// towards the sky's light as the surface roughens; below the horizon it
// mirrors the lit ground. The sun's lobe takes the sunlight by height and its
// visibility, as sunLight() does. roughness is perceptual (0 a mirror, 1 matte).
vec3 specularLight(vec3 position, vec3 n, vec3 view, float roughness, float f0) {
  float a = max(roughness * roughness, 0.002);
  float a2 = a * a;
  float nv = max(dot(n, view), 1e-4);
  vec3 l = uSunDirection;
  float nl = max(dot(n, l), 0.0);
  vec3 h = normalize(l + view);
  float nh = max(dot(n, h), 0.0);
  float q = nh * nh * (a2 - 1.0) + 1.0;
  float d = a2 / (PI * q * q);
  float k = 0.5 * a;
  float g = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  float height = position.y + planetDrop(position.xz);
  vec3 sun = textureLod(uSunlight, vec2(sunlightU(height * 0.001), 0.5), 0.0).rgb * sunVisibility(position, n);
  vec3 lobe = sun * d * g * fresnel(f0, dot(view, h)) / (4.0 * nv);

  vec3 r = reflect(-view, n);
  vec3 sky = mix(skyRadiance(r), shIrradiance(r) / PI, smoothstep(0.1, 0.7, roughness));
  vec3 ground = groundAlbedo(position) * uLevelLight / PI;
  vec3 mirrored = mix(ground, sky, smoothstep(-0.05, 0.05, r.y));
  // Rough surfaces mirror less at grazing angles than Schlick's smooth surface.
  float f = mix(fresnel(f0, nv), f0, roughness);
  return lobe + f * mirrored;
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
