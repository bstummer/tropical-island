// The blend fixture's layout (fixtures/blend.js), shared with
// tools/screenshot.js, which measures it. Pure: Node imports it.
//
// Horizontal bands of light fill the frame, from dark at the bottom to brighter
// than the sun's glow at the top. Cards stand over the left half; each has a
// reference at the same place in the right half, an opaque card that shows the
// same mix computed directly in linear light. Fractions of the frame: x from the
// left, bands and heights from the bottom.
export const blendLayout = {
  bands: 9,
  // Linear radiance and coverage: a dark veil, a bright cloud and a warm haze in
  // the translucent pass, and a dark glass in the after-opaque pass, which mixes
  // with the opaque scene it reads behind it (frame.opaque) instead of blending.
  cards: [
    { color: [0, 0, 0], alpha: 0.5 },
    { color: [3, 3, 3.2], alpha: 0.6 },
    { color: [2, 0.9, 0.3], alpha: 0.35 },
    { color: [0, 0, 0], alpha: 0.5, afterOpaque: true },
  ],
  // An opaque bar across the whole frame in front of the cards, inside one band:
  // they must hide behind it, which the translucent ones do only if the scene's
  // depth reaches their pass.
  bar: { bottom: 3.2 / 9, top: 3.8 / 9, color: [0.4, 0.4, 0.4] },
};

// Card i's span across the frame, [left, right]; its reference is half a frame to the right.
export function cardSpan(i) {
  const w = 0.5 / blendLayout.cards.length;
  return [i * w + 0.15 * w, (i + 1) * w - 0.15 * w];
}
