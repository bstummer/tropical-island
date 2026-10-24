// Linear RGB colours, as three.js's Color makes them (see index.js): hex
// numbers and '#rrggbb' strings are sRGB, made linear; three numbers are
// linear already (CLAUDE.md §8).

export class Color {
  constructor(r, g, b) {
    this.isColor = true; // gpu/reflect.js writes r, g, b
    this.r = 1;
    this.g = 1;
    this.b = 1;
    this.set(r, g, b);
  }

  // A Color, an sRGB hex number or '#rrggbb' string, or linear r, g, b.
  // Anything else throws, where three.js left the colour white.
  set(r, g, b) {
    if (g !== undefined || b !== undefined) return this.setRGB(r, g, b);
    if (r?.isColor) return this.copy(r);
    if (typeof r === 'number') return this.setHex(r);
    if (typeof r === 'string') {
      const hex = /^#([A-Fa-f\d]{6})$/.exec(r);
      if (!hex) throw new Error(`Color: "${r}" isn't '#rrggbb'`);
      return this.setHex(parseInt(hex[1], 16));
    }
    if (r !== undefined) throw new Error(`Color: can't make a colour of ${r}`);
    return this;
  }

  copy(color) {
    this.r = color.r;
    this.g = color.g;
    this.b = color.b;
    return this;
  }

  setRGB(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
    return this;
  }

  setHex(hex) {
    hex = Math.floor(hex);
    this.r = srgbToLinear(((hex >> 16) & 255) / 255);
    this.g = srgbToLinear(((hex >> 8) & 255) / 255);
    this.b = srgbToLinear((hex & 255) / 255);
    return this;
  }
}

// The sRGB curve undone, with three.js's constants.
function srgbToLinear(c) {
  return c < 0.04045 ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}
