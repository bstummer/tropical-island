// The haze fixture's answers (fixtures/haze.js), shared with tools/screenshot.js,
// which checks them. Pure: Node imports it. One texel per answer, in this
// order, each the worst miss on screen, in 8-bit levels, over the fixture's
// cases. The first four must stay small:
//   aerial       far sea and land through the aerial-perspective tables, against
//                a direct march of the air between the camera and the point
//   skyView      the sky as the sky-view table draws it, against a direct march
//   skyLight     the sky's light on a white surface (the SH), against the sky
//                integrated over every direction
//   sunlight     the sunlight on a white surface facing the sun, from the sea up
//                to the table's top (the sunlight table), against sky/light.js's
//                march towards the sun in doubles (sunAtHeight), on the spot and
//                25 km off, where the planet's bend has to be taken out
// The rest are deliberate mistakes the measure must see, or it measures nothing:
//   noHaze       the far points without any air in front of them
//   seaLevel     the air seen from sea level, as tables that ignore the camera's
//                height would give it (needs a camera well above the sea)
//   dimSkyLight  a quarter less sky light
//   seaLevelSun  the sea level's sunlight at every height
export const answers = ['aerial', 'skyView', 'skyLight', 'sunlight', 'noHaze', 'seaLevel', 'dimSkyLight', 'seaLevelSun'];

// The heights (m) the sunlight is checked at: the beach, the hills, and up to
// the sunlight table's top (config.sky.sunlightTop).
export const sunlightHeights = [0, 1.7, 12, 50, 140, 300, 800, 2000];

// After the answers, one texel per height here (m): the sunlight there as
// drawn, as a multiple of the sea level's (luminance), to report.
export const sunHeights = [50, 300];
