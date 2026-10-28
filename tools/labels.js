// The one rule for the labels the tools name their output by in screenshots/:
// a capture's folder (tools/screenshot.js), a map's file (tools/map.js).

// The name a label gives: the label with each run of anything but letters,
// digits, '_', '.' and '-' made a '-', and without trailing dots, which Windows
// drops. Throws for a label that would name nothing of its own beside the
// others ('', '.', '..'): one without a letter or digit.
export function labelName(label) {
  const name = String(label).replace(/[^\w.-]+/g, '-').replace(/\.+$/, '');
  if (!/[a-z\d]/i.test(name)) throw new Error(`the label "${label}" needs a letter or a digit`);
  return name;
}
