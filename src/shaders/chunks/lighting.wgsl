// The shared lighting model (CLAUDE.md §8): every lit scene material shades
// with it, then lets the air between it and the camera have its say:
//
//   var radiance = albedo / PI * (sunLight(position, normal) + skyIrradiance(position, normal));
//   radiance += specularLight(position, normal, view, roughness, f0); // glossy surfaces only
//   return sceneOutput(aerialPerspective(radiance, position), alpha);
//
// view points from the surface to the camera. A glossy surface's diffuse part
// gives up what its specular part takes: albedo * (1.0 - fresnel(f0, n.v)).
//
// The light state (frame.wgsl's uniforms and tables) lives in ctx.frame.uniforms,
// and sky/sky.js keeps it in step with the time of day, from the same atmosphere
// that draws the sky: sky, light and haze agree at every hour. Light is in
// units of the sun's illuminance above the atmosphere; the exposure scales it.

#include "frame.wgsl"
#include "pi.wgsl"
#include "sky-view.wgsl"
#include "aerial.wgsl"
#include "sh.wgsl"
#include "sunlight.wgsl"
#include "terrain.wgsl"
#include "shadows.wgsl"

// How much of the sun reaches a point, per colour: 1 lit, 0 in shadow, tinted
// where it comes through leaves or water. The one place where shadows join the
// light: the sun's shadows (shadows.wgsl) and Stage 10's cloud shadows
// multiply in here, so every material gets them.
fn sunVisibility(position: vec3f, normal: vec3f) -> vec3f { // position first, as everywhere here
  return vec3f(sunShadow(position, normal));
}

// Irradiance from the sun on a surface with this normal. It grows with the
// height above the sea: a low sun's light crosses less haze on its way to a
// hilltop than to the beach.
fn sunLight(position: vec3f, normal: vec3f) -> vec3f {
  // The height above the sea, as before the planet's bend (planet.wgsl), so
  // the light on a hill doesn't change as the camera moves away.
  let h = position.y + planetDrop(position.xz);
  let sun = textureSampleLevel(uSunlight, uSunlightSampler, vec2f(sunlightU(h * 0.001), 0.5), 0.0).rgb;
  return sun * max(dot(normal, frame.uSunDirection), 0.0) * sunVisibility(position, normal);
}

// The albedo of the ground around a point, which sends the light on it back
// up: sand on the beach, green inland, the sea over water, averaged over tens
// of metres (config.world.terrain.bounceReach). Where there is no ground, the
// far sea's.
fn groundAlbedo(position: vec3f) -> vec3f {
  if (frame.uBounceLayout.z == 0.0) {
    return frame.uBounceAlbedo;
  }
  let uv = (terrainCove(position.xz) - frame.uBounceLayout.xy) * frame.uBounceLayout.z;
  return textureSampleLevel(uBounceMap, uBounceMapSampler, uv, frame.uBounceLayout.w).rgb;
}

// Irradiance on level ground around a point: the sky's, and the sun's as far
// as the ground around is in it (shadows.wgsl shadeAround), which it sends
// back up as the light from below.
fn groundLight(position: vec3f) -> vec3f {
  let sun = frame.uSunRadiance * max(frame.uSunDirection.y, 0.0);
  return frame.uLevelLight - sun * (1.0 - shadeAround(position));
}

// Irradiance from the sky above and the ground below on a surface at position
// with normal n. The ground is diffuse, lit as level ground around it is, and
// fills the lower half of the view from the surface. Where something blocks the
// sky (a canopy, PLAN.md Stage 8), it is blocked here.
fn skyIrradiance(position: vec3f, n: vec3f) -> vec3f {
  return shIrradiance(n) + groundAlbedo(position) * groundLight(position) * (0.5 - 0.5 * n.y);
}

// The sky's radiance towards dir, as the sky draws it: for reflections.
fn skyRadiance(dir: vec3f) -> vec3f {
  let across = dir.xz;
  let sunAcross = frame.uSunDirection.xz;
  let cosAzimuth = dot(across, sunAcross) / max(length(across) * length(sunAcross), 1e-6);
  return textureSampleLevel(uSkyView, uSkyViewSampler, skyViewUv(frame.uSkyViewHeight, dir.y, cosAzimuth, frame.uSkyViewSize), 0.0).rgb;
}

// The share of light a surface with reflectance f0 at normal incidence
// reflects at an angle whose cosine is c (Schlick).
fn fresnel(f0: f32, c: f32) -> f32 {
  let m = 1.0 - clamp(c, 0.0, 1.0);
  return f0 + (1.0 - f0) * m * m * m * m * m;
}

// How much the normal turns across the pixel: specular lobes widen by it, so
// small glossy bumps and far ripples blur instead of sparkling (specular
// antialiasing, after Tokuyoshi and Kaplanyan 2019). Call it where every pixel
// around runs it: it takes derivatives.
fn specularKernel(n: vec3f) -> f32 {
  let dx = dpdx(n);
  let dy = dpdy(n);
  return min(0.5 * (dot(dx, dx) + dot(dy, dy)), 0.18);
}

// A roughness widened by that kernel.
fn filteredRoughness(roughness: f32, kernel: f32) -> f32 {
  let a = roughness * roughness;
  return sqrt(sqrt(min(a * a + kernel, 1.0)));
}

// Light a glossy surface mirrors towards the eye: the sun's lobe (GGX, with
// Smith's shadowing) and the sky around the mirrored direction, blurred
// towards the sky's light as the surface roughens; below the horizon it
// mirrors the lit ground. The sun's lobe takes the sunlight by height and its
// visibility, as sunLight() does. roughness is perceptual (0 a mirror, 1 matte).
fn specularLight(position: vec3f, n: vec3f, view: vec3f, roughness: f32, f0: f32) -> vec3f {
  let a = max(roughness * roughness, 0.002);
  let a2 = a * a;
  let nv = max(dot(n, view), 1e-4);
  let l = frame.uSunDirection;
  let nl = max(dot(n, l), 0.0);
  let h = normalize(l + view);
  let nh = max(dot(n, h), 0.0);
  let q = nh * nh * (a2 - 1.0) + 1.0;
  let d = a2 / (PI * q * q);
  let k = 0.5 * a;
  let g = nl / (nl * (1.0 - k) + k) * nv / (nv * (1.0 - k) + k);
  let height = position.y + planetDrop(position.xz);
  let sun = textureSampleLevel(uSunlight, uSunlightSampler, vec2f(sunlightU(height * 0.001), 0.5), 0.0).rgb * sunVisibility(position, n);
  let lobe = sun * d * g * fresnel(f0, dot(view, h)) / (4.0 * nv);

  let r = reflect(-view, n);
  let sky = mix(skyRadiance(r), shIrradiance(r) / PI, smoothstep(0.1, 0.7, roughness));
  let ground = groundAlbedo(position) * groundLight(position) / PI;
  let mirrored = mix(ground, sky, smoothstep(-0.05, 0.05, r.y));
  // Rough surfaces mirror less at grazing angles than Schlick's smooth surface.
  let f = mix(fresnel(f0, nv), f0, roughness);
  return lobe + f * mirrored;
}

// The air between the camera and position: dims the light leaving there and
// adds the light it scatters towards the camera. Distant land and sea fade
// into the same haze the sky shows at the horizon.
fn aerialPerspective(radiance: vec3f, position: vec3f) -> vec3f {
  let ray = position - frame.cameraPosition;
  let d = length(ray);
  let uvw = aerialUvw(ray / max(d, 1e-4), d * 0.001, frame.uSunDirection);
  // The tables have one level: sampled at it, as WebGL sampled them.
  return radiance * textureSampleLevel(uAerialTransmittance, uAerialTransmittanceSampler, uvw.yz, 0.0).rgb + textureSampleLevel(uAerial, uAerialSampler, uvw, 0.0).rgb;
}
