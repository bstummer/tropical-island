// Works out the island's shade (shade.js) off the main thread, so the game
// goes on drawing while a time of day is on its way. sky/shadows.js keeps a
// pool of these: a lead, and the others, each with a channel of its own to
// the lead, so the work never waits on the main thread.
//
// The lead gets the heightmap's levels and the channels ({ levels, texel,
// ports }), works out the grid's heights once (latticeHeights) and hands them
// on; then per time ({ id, direction, radius, around, size }) hands out bands
// of the shade's strips (shadeBands), two at a time to each so each carries on
// while the lead takes the last one's piece, puts the pieces together as they
// come (shadeMerger) and hands back the whole shade as the texture holds it
// (packShade's texels). The others get their channel ({ port }), the heights
// over it ({ layout, heights }), then bands ({ id, direction, radius, band }),
// and hand back each band's piece (packPiece).
import { latticeHeights, packPiece, shadeBands, shadeLayout, shadeMerger, shadeStrips, turnShade } from './shade.js';

self.onmessage = ({ data }) => {
  if (data.port) work(data.port);
  else if (data.levels) lead(data);
  else run(data);
};

// One of the others: bands, over `port`.
function work(port) {
  let layout = null;
  let heights = null;
  port.onmessage = ({ data }) => {
    if (data.heights) {
      ({ layout, heights } = data);
      return;
    }
    const { id, direction, radius, band } = data;
    const piece = packPiece(shadeStrips(heights, layout, turnShade(layout, direction), radius, band[0], band[1]));
    port.postMessage({ id, piece }, [piece.runs.buffer, piece.visible.buffer, piece.texels.buffer]);
  };
}

// The lead's.
let layout = null;
let ports = [];
const load = new Map(); // port -> bands it has
const tasks = []; // bands waiting for a port
const merging = new Map(); // id -> { merger, left }

function lead({ levels, texel, ports: given }) {
  layout = shadeLayout(levels, texel);
  const heights = latticeHeights(levels, layout);
  ports = given;
  for (const port of ports) {
    load.set(port, 0);
    port.postMessage({ layout, heights });
    port.onmessage = ({ data }) => {
      load.set(port, load.get(port) - 1);
      hand();
      place(data);
    };
  }
}

function run({ id, direction, radius, around, size }) {
  const bands = shadeBands(turnShade(layout, direction), size);
  merging.set(id, { merger: shadeMerger(layout, around), left: bands.length });
  for (const band of bands) tasks.push({ id, direction, radius, band });
  hand();
}

function hand() {
  for (const port of ports) {
    for (; tasks.length && load.get(port) < 2; load.set(port, load.get(port) + 1)) port.postMessage(tasks.shift());
  }
}

function place({ id, piece }) {
  const job = merging.get(id);
  job.merger.place(piece);
  if (--job.left > 0) return;
  merging.delete(id);
  const texels = job.merger.finish();
  self.postMessage({ id, texels }, [texels.buffer]);
}
