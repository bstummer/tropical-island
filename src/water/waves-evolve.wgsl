// The waves at this moment (water/waves.js): each cascade's spectrum of
// water/spectrum.js evolved to time t, as four complex fields whose inverse FFTs
// (waves-fft.wgsl) are eight real ones, two to a field: a real field's spectrum
// A(k) and another's B(k) make A(k) + i B(k), whose inverse is a(x) + i b(x).
//
// With H(k) = h0(k) e^(-i w t) + conj(h0(-k)) e^(i w t), the height's spectrum:
//   Dx  = i kx/k L H       h   = H              (sideways, so crests sharpen; height)
//   Dz  = i kz/k L H       Dxz = -kx kz/k L H   (how Dx changes along z)
//   hx  = i kx H           hz  = i kz H         (slopes)
//   Dxx = -kx kx/k L H     Dzz = -kz kz/k L H   (how the sideways moves pile up)
// L: how far crests lean (`choppy`).

struct Evolve {
  uSize: u32,
  uBase: f32, // 2 pi / the patch
  uTime: f32, // s, wrapped at the spectrum's loop
  uChoppy: f32,
}

// One texel's fields: Dx + i h, Dz + i Dxz; hx + i hz, Dxx + i Dzz.
struct Cell {
  first: vec4f,
  second: vec4f,
}

@group(0) @binding(0) var<uniform> evolve: Evolve;
@group(0) @binding(1) var<storage, read> amplitudes: array<vec4f>;
@group(0) @binding(2) var<storage, read> frequencies: array<f32>;
@group(0) @binding(3) var<storage, read_write> cells: array<Cell>;

fn timesI(c: vec2f) -> vec2f {
  return vec2f(-c.y, c.x);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = evolve.uSize;
  if (id.x >= size || id.y >= size) {
    return;
  }
  let n = id.y * size + id.x;
  let half = i32(size) / 2;
  let index = vec2i(id.xy);
  let wave = vec2f(select(index, index - i32(size), index >= vec2i(half))) * evolve.uBase;
  let k = max(length(wave), 1e-6);

  let a = amplitudes[n];
  let phase = frequencies[n] * evolve.uTime;
  let c = cos(phase);
  let s = sin(phase);
  // h0 e^(-i phase) + conj(h0(-k)) e^(i phase)
  let h = vec2f(a.x * c + a.y * s, a.y * c - a.x * s) + vec2f(a.z * c - a.w * s, a.z * s + a.w * c);

  let leaning = evolve.uChoppy / k;
  let dx = timesI(h) * wave.x * leaning;
  let dz = timesI(h) * wave.y * leaning;
  let dxz = -h * wave.x * wave.y * leaning;
  let hx = timesI(h) * wave.x;
  let hz = timesI(h) * wave.y;
  let dxx = -h * wave.x * wave.x * leaning;
  let dzz = -h * wave.y * wave.y * leaning;

  cells[n].first = vec4f(dx + timesI(h), dz + timesI(dxz));
  cells[n].second = vec4f(hx + timesI(hz), dxx + timesI(dzz));
}
