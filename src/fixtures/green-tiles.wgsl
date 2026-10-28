// Fixture: see green-tiles.js. At a point per output texel, spread over
// metres of ground, seen by a pixel uFootprint metres across, the green's
// detail tiles as chunks/green.wgsl green() reads them. Mode 0 and 1:
// greenTile's two reads of the grass's tile (its colour's factor, x 4, and
// cover) and of the litter's (its tone, and cover), with the ground between
// the covers taken as nothing for uMistaken, a deliberate mistake. Mode 2 and
// 3: what greenLeaves and greenOver show of the litter's leaves at the share
// uShare (half of it for uMistaken), over nothing, each with its tone's factor
// as green() gives it, and how much of the point they cover, the ground
// between them included: the dead leaves (the lightest first) and the green
// ones (the darkest first).

#include "chunks/fullscreen.wgsl"
#include "chunks/green.wgsl"

struct GreenTilesCheck {
  uMode: f32,
  uFootprint: f32, // m
  uShare: f32,
  uMistaken: f32,
  uSpacing: f32, // m between the points
}

@group(1) @binding(0) var<uniform> check: GreenTilesCheck;

@fragment
fn fragmentMain(in: Fullscreen) -> @location(0) vec4f {
  let cell = floor(in.position.xy);
  let xz = (cell + noiseHash22(cell + 0.5) * 0.5 + 0.5) * check.uSpacing;
  let dx = vec2f(check.uFootprint, 0.0);
  let dy = vec2f(0.0, check.uFootprint);
  let lean = 0.6 * gradientNoise(xz * 0.7 + 3.1); // as green()
  let ground = 1.0 - select(0.0, check.uMistaken, check.uMode < 1.5);
  if (check.uMode < 0.5) {
    let grass = greenTile(TILE_GRASS, xz, dx, dy, greenParams.uGreenTiles.x, vec3f(0.25 * greenParams.uGrassDepths * ground), lean, false);
    return vec4f(grass.rgb * 4.0, grass.a);
  }
  let leaves = greenTile(TILE_LITTER, xz, dx, dy, greenParams.uGreenTiles.y, vec3f(0.5 * ground), lean, true);
  if (check.uMode < 1.5) {
    return vec4f(leaves.b, leaves.a, 0.0, 0.0);
  }
  // As green() shows its dead leaves, and its green ones.
  let own = greenLeafOwn(check.uFootprint);
  let laid = greenLitter(xz, dx, dy, lean, own);
  let tone = greenLeafTone(laid.leaves);
  let share = check.uShare * (1.0 - 0.5 * check.uMistaken);
  let cover = greenParams.uLitterCover;
  let k = max(share - cover, 0.0) / (1.0 - cover); // how much the ground between them takes on (greenOver)
  var present: f32;
  var on: vec3f;
  if (check.uMode < 2.5) {
    present = greenLeaves(laid.masks, laid.leaves.a, tone, own, share / cover);
    on = greenLeafFactor(tone, greenShownTone(share / cover, own), own);
  } else {
    present = laid.leaves.a - greenLeaves(laid.masks, laid.leaves.a, tone, own, 1.0 - share / cover);
    on = greenLeafFactor(tone, greenShownDarkTone(share / cover, own), own);
  }
  return vec4f(greenOver(present, cover, share, on, vec3f(0.0)), present + (1.0 - present) * k);
}
