// What capture mode checks about the scene's materials (core/capture.js): that
// each ends with sceneOutput() and that only the translucent pass blends. Pure:
// tests/scene-check.test.js runs it in Node.

// The scene's materials whose fragment entry point doesn't return sceneOutput(), as "name":
// every return in it must be that call and nothing else (the functions it calls may return anything).
export function missingSceneOutput(scene) {
  const missing = new Set();
  for (const { material } of scene.meshes(undefined, [], true)) {
    const returns = functionBody(material.shader, material.fragment).match(/\breturn\b[^;]*/g) ?? [];
    if (!returns.length || !returns.every(returnsSceneOutput)) missing.add(material.name);
  }
  return [...missing];
}

// Whether a return statement (up to its `;`) returns one call of sceneOutput() as it is.
function returnsSceneOutput(statement) {
  const call = /^return\s+sceneOutput\s*\(/.exec(statement);
  if (!call) return false;
  let depth = 1;
  for (let i = call[0].length; i < statement.length; i++) {
    if (statement[i] === '(') depth++;
    else if (statement[i] === ')' && --depth === 0) return statement.slice(i + 1).trim() === '';
  }
  return false;
}

// The body of WGSL function `name` in `source`, or '' without one.
export function functionBody(source, name) {
  const start = source.search(new RegExp(`\\bfn\\s+${name}\\s*\\(`));
  if (start < 0) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i >= 0 && i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
  }
  return '';
}

// What breaks the frame's passes (post/frame.js), as sentences: a material that
// blends outside the translucent pass, where it would blend in the compressed
// space and darken bright light behind it by stops; a mesh in the translucent
// pass that frame.translucent() didn't set up; and a mesh in none of the passes.
export function misplacedBlending(scene, passes) {
  const blending = new Set();
  const unprepared = new Set();
  const lost = new Set();
  for (const mesh of scene.meshes(undefined, [], true)) {
    const { material } = mesh;
    if (!passes.includes(mesh.pass)) lost.add(mesh.name || 'a mesh');
    if (mesh.pass === 'translucent') {
      if (!material.overrides.SCENE_TRANSLUCENT) unprepared.add(material.name);
    } else if (material.blend) {
      blending.add(material.name);
    }
  }
  const problems = [];
  if (blending.size) problems.push(`materials that blend outside the translucent pass (use frame.translucent()): ${[...blending].join(', ')}`);
  if (unprepared.size) problems.push(`materials in the translucent pass not set up by frame.translucent(): ${[...unprepared].join(', ')}`);
  if (lost.size) problems.push(`meshes in none of the frame's passes: ${[...lost].join(', ')}`);
  return problems;
}
