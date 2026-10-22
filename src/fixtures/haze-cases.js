// The haze fixture's answers (fixtures/haze.js), shared with tools/screenshot.js,
// which checks them. Pure: Node imports it. One texel per answer, in this
// order, each the worst miss on screen, in 8-bit levels, over the fixture's
// cases. The first three must stay small:
//   aerial       far sea and land through the aerial-perspective tables, against
//                a direct march of the air between the camera and the point
//   skyView      the sky as the sky-view table draws it, against a direct march
//   skyLight     the sky's light on a white surface (the SH), against the sky
//                integrated over every direction
// The rest are deliberate mistakes the measure must see, or it measures nothing:
//   noHaze       the far points without any air in front of them
//   seaLevel     the air seen from sea level, as tables that ignore the camera's
//                height would give it (needs a camera well above the sea)
//   dimSkyLight  a quarter less sky light
export const answers = ['aerial', 'skyView', 'skyLight', 'noHaze', 'seaLevel', 'dimSkyLight'];
