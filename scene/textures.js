// scene/textures.js - procedural, canvas-drawn PBR textures for Exotic Candy & Munchies.
//
// Everything is generated once (makeTextures) from a seeded LCG, never Math.random, so the
// store looks identical on every visit. Colour maps are authored together with a float height
// field; the normal map is derived from that height field (heightToNormal) so grout, planks,
// slat grooves and pinholes catch light consistently with what the colour map shows.
//
// Resolution rule: 1 px ~ 1 mm on the 1 m textures, nothing larger than 2048 px on its long side.
//
// Exports:
//   heightToNormal(canvas, strength = 2) -> THREE.CanvasTexture (NoColorSpace, RepeatWrapping)
//   makeTextures(seed = 7)               -> { tile, wood, ceiling, tealSlat, whiteSlat, cream, sign, badge,
//                                              mat, mural(w,h,variant), poster(tagline), lightbox(text),
//                                              tablet, freezerWrap, labels }
//   ensureFonts()                        -> Promise; waits for Fredoka (call before makeTextures when the page
//                                           links the Google font, otherwise the fallback face is baked in)
//
// Failure modes: needs a DOM (document.createElement('canvas')). If Fredoka is unavailable the
// fallback faces in FONT are used; the sign still reads correctly.

import * as THREE from 'three';

const FONT = '"Fredoka", "Arial Rounded MT Bold", "Arial Black", sans-serif';
const PURPLE = '#7a3fd3', DEEP = '#3b2270', TEAL = '#27b6c7', AQUA = '#9fe9f1';
const ORANGE = '#ff8a2a', YELLOW = '#ffd23f', PINK = '#ff5ea8', LIME = '#9be15d', WHITE = '#ffffff';
const ANISO = 8;
const texN = () => (MAXSZ <= 1024 ? 512 : 1024); // 1 m texture edge in px
let MAXSZ = 2048; // set by makeTextures({ maxSize }); caps every canvas's long side

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
function hashSeed(...n) {
  let h = 2166136261 >>> 0;
  for (const v of n) { h ^= (v | 0) + 0x9e3779b9; h = Math.imul(h, 16777619) >>> 0; h ^= h >>> 13; }
  return h >>> 0;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
const mix = (a, b, t) => a + (b - a) * t;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  const f = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
}
function shade(hex, amt) { // amt > 0 lightens toward white, < 0 darkens toward black
  const [r, g, b] = hexToRgb(hex);
  const t = Math.abs(amt), to = amt >= 0 ? 255 : 0;
  return rgbToHex(mix(r, to, t), mix(g, to, t), mix(b, to, t));
}

function colorTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  return t;
}
function dataTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = ANISO;
  return t;
}

// Build a canvas by filling an RGBA byte array directly (fast per-pixel path).
function pixelCanvas(w, h, fill) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  fill(img.data);
  ctx.putImageData(img, 0, 0);
  return c;
}
// Grey canvas from a Float32Array in 0..1 (roughness, masks).
function grayCanvas(w, h, f32) {
  return pixelCanvas(w, h, (d) => {
    for (let i = 0, j = 0; i < f32.length; i++, j += 4) {
      const v = clamp(f32[i], 0, 1) * 255;
      d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
    }
  });
}

// Periodic value noise on a cx x cy lattice, bilinear with smoothstep. Tiles seamlessly.
function periodicNoise(w, h, cx, cy, rng) {
  const lat = new Float32Array(cx * cy);
  for (let i = 0; i < lat.length; i++) lat[i] = rng();
  const out = new Float32Array(w * h);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    const fx = (x * cx) / w, ix = Math.floor(fx);
    x0[x] = ix % cx; x1[x] = (ix + 1) % cx; tx[x] = smooth(fx - ix);
  }
  for (let y = 0; y < h; y++) {
    const fy = (y * cy) / h, iy = Math.floor(fy), ty = smooth(fy - iy);
    const r0 = (iy % cy) * cx, r1 = ((iy + 1) % cy) * cx, row = y * w;
    for (let x = 0; x < w; x++) {
      const a = lat[r0 + x0[x]], b = lat[r0 + x1[x]], c = lat[r1 + x0[x]], d = lat[r1 + x1[x]];
      const t = tx[x];
      out[row + x] = (a + (b - a) * t) * (1 - ty) + (c + (d - c) * t) * ty;
    }
  }
  return out;
}
// Bilinear upsample with wrap (smooth low-frequency fields are generated small, then stretched).
function upsample(src, sw, sh, w, h) {
  const out = new Float32Array(w * h);
  const x0 = new Int32Array(w), x1 = new Int32Array(w), tx = new Float32Array(w);
  for (let x = 0; x < w; x++) { const fx = (x * sw) / w, ix = Math.floor(fx); x0[x] = ix % sw; x1[x] = (ix + 1) % sw; tx[x] = fx - ix; }
  for (let y = 0; y < h; y++) {
    const fy = (y * sh) / h, iy = Math.floor(fy), ty = fy - iy, r0 = (iy % sh) * sw, r1 = ((iy + 1) % sh) * sw, row = y * w;
    for (let x = 0; x < w; x++) {
      const a = src[r0 + x0[x]], b = src[r0 + x1[x]], c = src[r1 + x0[x]], d = src[r1 + x1[x]], t = tx[x];
      out[row + x] = (a + (b - a) * t) * (1 - ty) + (c + (d - c) * t) * ty;
    }
  }
  return out;
}
// Fractal sum of periodicNoise, normalised to 0..1. Fields whose finest octave has <= 1 cell per 8 px
// are computed at 1/4 resolution and upsampled (same lattice, same rng draws, ~16x cheaper).
function fbm(w, h, cx, cy, octaves, rng, gain = 0.5) {
  const fineX = cx << (octaves - 1), fineY = cy << (octaves - 1);
  const k = (fineX * 8 <= w && fineY * 8 <= h && w % 4 === 0 && h % 4 === 0) ? 4 : 1;
  const ww = w / k, hh = h / k;
  const acc = new Float32Array(ww * hh);
  let amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = periodicNoise(ww, hh, Math.min(cx << o, ww), Math.min(cy << o, hh), rng);
    for (let i = 0; i < acc.length; i++) acc[i] += n[i] * amp;
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= norm;
  return k === 1 ? acc : upsample(acc, ww, hh, w, h);
}

// Height field (Float32 0..1) -> tangent-space normal map canvas (OpenGL convention, +Y up).
// Sobel with wrap-around so tiling textures stay seamless. strength multiplies the slope.
function boxBlur(src, w, h, r) { // separable box blur with wrap, r = radius in px
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { let a = 0; for (let k = -r; k <= r; k++) a += src[y * w + ((x + k + w) % w)]; tmp[y * w + x] = a / n; }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { let a = 0; for (let k = -r; k <= r; k++) a += tmp[((y + k + h) % h) * w + x]; out[y * w + x] = a / n; }
  }
  return out;
}
function normalCanvas(hf, w, h, strength, blur = 0) {
  if (blur > 0) hf = boxBlur(hf, w, h, blur);
  const s = strength / 8;
  return pixelCanvas(w, h, (d) => {
    for (let y = 0; y < h; y++) {
      const ym = ((y - 1 + h) % h) * w, y0 = y * w, yp = ((y + 1) % h) * w;
      for (let x = 0; x < w; x++) {
        const xm = (x - 1 + w) % w, xp = (x + 1) % w;
        const tl = hf[ym + xm], t = hf[ym + x], tr = hf[ym + xp];
        const l = hf[y0 + xm], r = hf[y0 + xp];
        const bl = hf[yp + xm], b = hf[yp + x], br = hf[yp + xp];
        const nx = -((tr + 2 * r + br) - (tl + 2 * l + bl)) * s;
        const ny = ((bl + 2 * b + br) - (tl + 2 * t + tr)) * s; // image y points down, v points up
        const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
        const j = (y0 + x) * 4;
        d[j] = (nx * inv * 0.5 + 0.5) * 255;
        d[j + 1] = (ny * inv * 0.5 + 0.5) * 255;
        d[j + 2] = (inv * 0.5 + 0.5) * 255;
        d[j + 3] = 255;
      }
    }
  });
}

/**
 * Convert a height-map canvas (luminance = height) into a normal-map texture.
 * @param {HTMLCanvasElement} canvas  source height map
 * @param {number} strength           slope multiplier (default 2)
 * @returns {THREE.CanvasTexture}     NoColorSpace, RepeatWrapping
 */
export function heightToNormal(canvas, strength = 2) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const src = ctx.getImageData(0, 0, w, h).data;
  const hf = new Float32Array(w * h);
  for (let i = 0, j = 0; i < hf.length; i++, j += 4) hf[i] = (src[j] * 0.299 + src[j + 1] * 0.587 + src[j + 2] * 0.114) / 255;
  return dataTexture(normalCanvas(hf, w, h, strength, 1)); // 1 px blur so AA stair-steps do not become ridges
}

function menuData() {
  const m = (typeof window !== 'undefined' && window.EXOTIC_MENU) || {};
  const store = m.store || {};
  return {
    name: store.name || 'Exotic Candy & Munchies',
    short: store.short || store.name || 'Exotic Candy & Munchies',
    tagline: store.tagline || 'A world of candy. A store worth discovering.',
    categories: m.categories || [],
  };
}

export async function ensureFonts() {
  if (typeof document === 'undefined' || !document.fonts || !document.fonts.load) return;
  try {
    await Promise.all(['500', '600', '700'].map((w) => document.fonts.load(`${w} 64px "Fredoka"`, 'EXOTIC CANDY & MUNCHIES')));
  } catch (e) { /* fallback faces are fine */ }
}

// ---------------------------------------------------------------------------
// Bubble lettering (2D canvas): drop shadow, outline, gradient fill, top gloss.
// ---------------------------------------------------------------------------
function bubbleWord(ctx, text, x, y, size, fill, stroke, o = {}) {
  const { weight = 700, outline = 0.16, shadow = true, shine = true, align = 'center', baseline = 'middle' } = o;
  ctx.save();
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.textAlign = align; ctx.textBaseline = baseline;
  ctx.lineJoin = 'round'; ctx.miterLimit = 2;
  if (shadow) {
    ctx.lineWidth = size * outline; ctx.strokeStyle = 'rgba(28,10,64,0.55)';
    ctx.strokeText(text, x + size * 0.045, y + size * 0.065);
  }
  ctx.lineWidth = size * outline; ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  const g = ctx.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.5);
  g.addColorStop(0, shade(fill, 0.2)); g.addColorStop(0.55, fill); g.addColorStop(1, shade(fill, -0.2));
  ctx.fillStyle = g; ctx.fillText(text, x, y);
  if (shine) {
    const s = ctx.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.05);
    s.addColorStop(0, 'rgba(255,255,255,0.45)'); s.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = s; ctx.fillText(text, x, y);
  }
  ctx.restore();
}
function fitSize(ctx, text, weight, maxW, maxSize) {
  ctx.font = `${weight} 100px ${FONT}`;
  const w100 = ctx.measureText(text).width;
  return Math.min(maxSize, (maxW / w100) * 100);
}

// ---------------------------------------------------------------------------
// Polished cream mall tile, 1 m, 2 x 2 tiles of 0.5 m with 5 mm grout
// ---------------------------------------------------------------------------
function makeTile(seed) {
  const N = texN(), s = N / 1024, rng = makeRng(seed);
  const mott = fbm(N, N, 3, 3, 4, rng);
  const v1 = fbm(N, N, 3, 3, 5, rng), v2 = fbm(N, N, 6, 2, 4, rng), warp = fbm(N, N, 2, 2, 3, rng);
  const v3 = fbm(N, N, 2, 7, 3, rng);
  const speck = periodicNoise(N, N, N / 2, N / 2, rng);
  const micro = fbm(N, N, 64, 64, 2, rng);
  const tileTone = [0.0, 0.02, -0.018, 0.012];
  const hf = new Float32Array(N * N), rough = new Float32Array(N * N), coat = new Float32Array(N * N);
  const gw = Math.max(1.5, 3.2 * s), cell = N / 2, half = N / 4, cham = Math.max(1.5, 3 * s);
  const colour = pixelCanvas(N, N, (d) => {
    for (let y = 0; y < N; y++) {
      const dyc = Math.abs(((y + half) % cell) - half), ty = Math.floor(y / cell) & 1;
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const dxc = Math.abs(((x + half) % cell) - half);
        const dist = Math.min(dxc, dyc);
        const tone = tileTone[(Math.floor(x / cell) & 1) + ty * 2];
        let r, g, b, hh, rg, cc;
        if (dist < gw) { // grout
          const gn = 0.9 + 0.2 * speck[i];
          const edge = smoothstep(0, gw, dist);
          r = 150 * gn * (0.86 + 0.14 * edge); g = 143 * gn * (0.86 + 0.14 * edge); b = 130 * gn * (0.86 + 0.14 * edge);
          hh = 0.0 + micro[i] * 0.05; rg = 1.0; cc = 0.04;
        } else {
          const f = v1[i] + (warp[i] - 0.5) * 0.4;
          const t1 = Math.abs(f - 0.5), line1 = t1 < 0.03 ? Math.pow(1 - t1 / 0.03, 2) : 0;
          const t2 = Math.abs(v2[i] - 0.5 + (warp[i] - 0.5) * 0.15), line2 = t2 < 0.018 ? Math.pow(1 - t2 / 0.018, 2) : 0;
          const t3 = Math.abs(v3[i] - 0.52), line3 = t3 < 0.012 ? 1 - t3 / 0.012 : 0;
          const vein = clamp(line1 * 0.30 + line2 * 0.20 + line3 * 0.12, 0, 0.5);
          const cloud = (mott[i] - 0.5) * 0.10 + tone + (speck[i] - 0.5) * 0.03;
          let rr = 232, gg = 227, bb = 215;
          rr = mix(rr, 186, vein) * (1 + cloud); gg = mix(gg, 172, vein) * (1 + cloud); bb = mix(bb, 150, vein) * (1 + cloud);
          const edge = smoothstep(gw, gw + cham, dist), ao = 0.93 + 0.07 * edge; // tiny chamfer shading
          r = rr * ao; g = gg * ao; b = bb * ao;
          hh = 0.55 + 0.45 * edge + (micro[i] - 0.5) * 0.02;
          rg = 0.86 + 0.07 * mott[i] + vein * 0.1; cc = 1; // multiplier on material.roughness
        }
        hf[i] = hh; rough[i] = rg; coat[i] = cc;
        const j = i * 4; d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
      }
    }
  });
  return {
    map: colorTexture(colour),
    normalMap: dataTexture(normalCanvas(hf, N, N, 2.2)),
    roughnessMap: dataTexture(grayCanvas(N, N, rough)),
    clearcoatMap: dataTexture(grayCanvas(N, N, coat)),
    size: 1,
  };
}

// ---------------------------------------------------------------------------
// Grey-washed oak planks, 1 m, four planks across (25 cm each), staggered butt joints
// ---------------------------------------------------------------------------
function makeWood(seed) {
  const N = texN(), s = N / 1024, ph = N / 4, rng = makeRng(seed);
  const warp = fbm(N, N, 2, 12, 4, rng);
  const ring2 = fbm(N, N, 3, 40, 3, rng);
  const fibre = fbm(N, N, 6, Math.round(420 * s), 2, rng);
  const pore = periodicNoise(N, N, Math.round(90 * s), Math.round(360 * s), rng);
  const wash = fbm(N, N, 4, 3, 3, rng);
  const rows = [];
  for (let r = 0; r < 4; r++) {
    rows.push({
      tone: 0.9 + rng() * 0.2, warm: (rng() - 0.5) * 8, phase: rng() * 6.28,
      joint: Math.floor(((r * 0.31 + 0.12 + rng() * 0.14) % 1) * N), freq: 6 + rng() * 3,
    });
  }
  const hf = new Float32Array(N * N), rough = new Float32Array(N * N), bev = Math.max(2.5, 4.5 * s);
  const colour = pixelCanvas(N, N, (d) => {
    for (let y = 0; y < N; y++) {
      const r = (y / ph) | 0, row = rows[r], yl = y - r * ph, v = yl / ph;
      const dEdge = Math.min(yl + 0.5, ph - yl - 0.5);
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        let dj = Math.abs(x - row.joint); dj = Math.min(dj, N - dj);
        const dist = Math.min(dEdge, dj);
        const ringPhase = v * row.freq + (warp[i] - 0.5) * 6 + (ring2[i] - 0.5) * 1.4 + row.phase;
        const ring = 0.5 + 0.5 * Math.sin(ringPhase * 6.2832);
        const grain = Math.pow(ring, 2.2);
        const fib = fibre[i] - 0.5;
        const isPore = pore[i] > 0.74 ? (pore[i] - 0.74) / 0.26 : 0;
        const wsh = wash[i] - 0.5;
        const base = row.tone * (1 + wsh * 0.12);
        let rr = (160 + row.warm) * base, gg = 152 * base, bb = (141 - row.warm) * base;
        const dark = grain * 0.15 + fib * 0.08 + isPore * 0.12;
        rr *= 1 - dark; gg *= 1 - dark * 0.98; bb *= 1 - dark * 0.9;
        let hh = 0.82 + (grain - 0.5) * 0.03 + fib * 0.025 - isPore * 0.06;
        let rg = 0.9 + isPore * 0.1 - (grain * 0.05);
        if (dist < bev) { // bevel / joint gap: V groove
          const t = smoothstep(0, bev, dist);
          const shadeF = 0.45 + 0.55 * t;
          rr *= shadeF; gg *= shadeF; bb *= shadeF;
          hh = hh * (0.12 + 0.88 * t); rg = 1;
        }
        hf[i] = hh; rough[i] = rg;
        const j = i * 4; d[j] = rr; d[j + 1] = gg; d[j + 2] = bb; d[j + 3] = 255;
      }
    }
  });
  return {
    map: colorTexture(colour),
    normalMap: dataTexture(normalCanvas(hf, N, N, 3.2)),
    roughnessMap: dataTexture(grayCanvas(N, N, rough)),
  };
}

// ---------------------------------------------------------------------------
// Mineral-fibre ceiling, 1.2 m = 2 x 2 tiles of 0.6 m in an exposed white T-bar grid
// ---------------------------------------------------------------------------
function makeCeiling(seed) {
  const N = texN(), s = N / 1024, rng = makeRng(seed), cell = N / 2, half = N / 4, bar = 10 * s;
  const cloud = fbm(N, N, 6, 6, 4, rng);
  const fis = fbm(N, N, 24, 24, 3, rng);
  const fis2 = fbm(N, N, 9, 31, 3, rng);
  const holes = periodicNoise(N, N, 170, 170, rng);
  const grain = periodicNoise(N, N, N / 2, N / 2, rng);
  const hf = new Float32Array(N * N);
  const colour = pixelCanvas(N, N, (d) => {
    for (let y = 0; y < N; y++) {
      const dy = Math.abs(((y + half) % cell) - half);
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const dx = Math.abs(((x + half) % cell) - half);
        const dist = Math.min(dx, dy);
        let v, hh;
        if (dist < bar) { // T-bar flange
          const edge = smoothstep(bar * 0.8, bar, dist);
          v = 249 * (0.985 + 0.015 * grain[i]) * (1 - 0.06 * edge); hh = 1.0 - 0.06 * edge;
          d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v * 0.99;
        } else {
          const t = Math.abs(fis[i] - 0.5), fissure = t < 0.012 ? 1 - t / 0.012 : 0;
          const t2 = Math.abs(fis2[i] - 0.5), fissure2 = t2 < 0.010 ? 1 - t2 / 0.010 : 0;
          const hole = holes[i] > 0.9 ? 1 : 0;
          const lip = smoothstep(bar, bar * 1.7, dist); // shadow under the bar lip
          v = 240 * (1 + (cloud[i] - 0.5) * 0.035 + (grain[i] - 0.5) * 0.04);
          v *= (0.83 + 0.17 * lip) * (1 - fissure * 0.07 - fissure2 * 0.05 - hole * 0.17);
          hh = 0.55 + (grain[i] - 0.5) * 0.05 - fissure * 0.05 - hole * 0.14 + (cloud[i] - 0.5) * 0.03;
          d[i * 4] = v; d[i * 4 + 1] = v; d[i * 4 + 2] = v * 0.985;
        }
        d[i * 4 + 3] = 255;
        hf[i] = hh;
      }
    }
  });
  return { map: colorTexture(colour), normalMap: dataTexture(normalCanvas(hf, N, N, 1.6)) };
}

// ---------------------------------------------------------------------------
// Slatwall: 1 m, 13 horizontal grooves (76.9 mm pitch), groove 10 mm wide with chamfered lips
// ---------------------------------------------------------------------------
function makeSlat(seed, baseHex, grooveHex) {
  const H = texN(), W = H / 2, sc = H / 1024, rng = makeRng(seed);
  const peel = fbm(W, H, W / 4, H / 4, 2, rng);
  const streak = fbm(W, H, 4, H / 4.6, 2, rng);
  const blot = fbm(W, H, 3, 4, 3, rng);
  const [br, bg, bb] = hexToRgb(baseHex), [gr, gg, gb] = hexToRgb(grooveHex);
  const hf = new Float32Array(W * H), rough = new Float32Array(W * H);
  const pitch = H / 13, ghalf = 5.0 * (H / 1000); // groove 10 mm wide
  const colour = pixelCanvas(W, H, (d) => {
    for (let y = 0; y < H; y++) {
      const ph = ((y / pitch) % 1 + 1) % 1; // groove centred on phase 0
      const dc = Math.min(ph, 1 - ph) * pitch; // px from groove centre
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const n = (peel[i] - 0.5) * 0.03 + (streak[i] - 0.5) * 0.025 + (blot[i] - 0.5) * 0.04;
        let r = br * (1 + n), g = bg * (1 + n), b = bb * (1 + n), hh = 1 - (peel[i] - 0.5) * 0.01;
        if (dc < ghalf + 3 * sc) {
          if (dc < ghalf) { // groove floor and walls: dark with a falloff toward the lip
            const t = dc / ghalf;
            const k = 0.52 + 0.30 * smoothstep(0.35, 1, t);
            r = gr * k * (1 + n); g = gg * k * (1 + n); b = gb * k * (1 + n);
            hh = 0.05 + 0.25 * smoothstep(0.55, 1, t);
          } else { // chamfered lip, slightly brighter edge
            const t = (dc - ghalf) / (3 * sc);
            const lit = 1.0 + 0.05 * (1 - t);
            r *= lit; g *= lit; b *= lit; hh = 0.3 + 0.7 * smoothstep(0, 1, t);
          }
        }
        hf[i] = hh; rough[i] = 0.9;
        const j = i * 4; d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = 255;
      }
    }
  });
  return { map: colorTexture(colour), normalMap: dataTexture(normalCanvas(hf, W, H, 2.4)) };
}

// ---------------------------------------------------------------------------
// Painted drywall, 1 m
// ---------------------------------------------------------------------------
function makeCream(seed) {
  const N = Math.min(512, MAXSZ), rng = makeRng(seed);
  const cloud = fbm(N, N, 4, 4, 3, rng), peel = fbm(N, N, N / 5, N / 5, 3, rng);
  const hf = new Float32Array(N * N), rough = new Float32Array(N * N);
  const colour = pixelCanvas(N, N, (d) => {
    for (let i = 0; i < N * N; i++) {
      const n = (cloud[i] - 0.5) * 0.025 + (peel[i] - 0.5) * 0.03;
      const j = i * 4;
      d[j] = 240 * (1 + n); d[j + 1] = 235 * (1 + n); d[j + 2] = 224 * (1 + n); d[j + 3] = 255;
      hf[i] = peel[i]; rough[i] = 0.94 + (peel[i] - 0.5) * 0.08;
    }
  });
  return { map: colorTexture(colour), normalMap: dataTexture(normalCanvas(hf, N, N, 0.9)), roughnessMap: dataTexture(grayCanvas(N, N, rough)) };
}

// ---------------------------------------------------------------------------
// Dimensional bubble-letter sign, 2048 x 560, transparent. Letters are shaded from a height
// field built out of two distance transforms (outline ring and puffy fill), lit from the top left.
// ---------------------------------------------------------------------------
function distanceInside(alpha, w, h) {
  const BIG = 1e6, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = alpha[i] > 127 ? BIG : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x; let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + 3);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3);
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x; let v = d[i];
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
      }
      d[i] = v;
    }
  }
  for (let i = 0; i < d.length; i++) d[i] = Math.min(d[i], 3000) / 3;
  return d;
}

function makeSign() {
  const sc = Math.min(1, MAXSZ / 2048), W = Math.round(2048 * sc), H = Math.round(560 * sc);
  const words = [
    { t: 'EXOTIC', fill: PURPLE, stroke: '#ffffff', k: 0.6, line: 0 },
    { t: 'CANDY', fill: '#ffffff', stroke: PURPLE, k: 1, line: 0 },
    { t: '& MUNCHIES', fill: PURPLE, stroke: '#ffffff', k: 0.6, line: 1 },
  ];
  const probe = makeCanvas(8, 8).getContext('2d');
  probe.font = `700 100px ${FONT}`;
  for (const w of words) w.w100 = probe.measureText(w.t).width;
  const gap = 0.2;
  const l0 = (words[0].k * words[0].w100 + words[1].k * words[1].w100) / 100 + gap;
  const l1 = (words[2].k * words[2].w100) / 100;
  const S = Math.min((W - 120 * sc) / l0, 330 * sc);
  const outline = 0.2, capH = 0.72;
  const totalH = S * (capH + 0.18 + capH * 0.6) + S * outline;
  const baseY0 = (H - totalH) / 2 + S * outline / 2 + S * capH;
  const baseY1 = baseY0 + S * 0.18 + S * capH * 0.6;
  const x0 = (W - l0 * S) / 2;
  const place = [];
  { let x = x0; for (let k = 0; k < 2; k++) { place.push({ x, y: baseY0 }); x += (words[k].k * words[k].w100 / 100 + gap) * S; } }
  place.push({ x: (W - l1 * S) / 2, y: baseY1 });

  const outer = makeCanvas(W, H), fillC = makeCanvas(W, H), wordId = makeCanvas(W, H);
  const oc = outer.getContext('2d'), fc = fillC.getContext('2d');
  for (const c of [oc, fc]) { c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.lineJoin = 'round'; c.miterLimit = 2; }
  words.forEach((w, i) => {
    const size = S * w.k;
    for (const c of [oc, fc]) c.font = `700 ${size}px ${FONT}`;
    oc.lineWidth = size * outline; oc.strokeStyle = '#fff'; oc.fillStyle = '#fff';
    oc.strokeText(w.t, place[i].x, place[i].y); oc.fillText(w.t, place[i].x, place[i].y);
    fc.fillStyle = '#fff'; fc.fillText(w.t, place[i].x, place[i].y);
  });
  // word index map: which word owns each px (for colours). Painted nearest-word by x-ranges per line.
  const wc = wordId.getContext('2d');
  words.forEach((w, i) => {
    const size = S * w.k;
    wc.font = `700 ${size}px ${FONT}`; wc.textAlign = 'left'; wc.textBaseline = 'alphabetic';
    wc.lineJoin = 'round'; wc.lineWidth = size * outline; wc.strokeStyle = `rgb(${i + 1},0,0)`; wc.fillStyle = `rgb(${i + 1},0,0)`;
    wc.strokeText(w.t, place[i].x, place[i].y); wc.fillText(w.t, place[i].x, place[i].y);
  });
  const oa = new Uint8Array(W * H), fa = new Uint8Array(W * H), wi = new Uint8Array(W * H);
  { const a = oc.getImageData(0, 0, W, H).data, b = fc.getImageData(0, 0, W, H).data, c = wc.getImageData(0, 0, W, H).data;
    for (let i = 0; i < W * H; i++) { oa[i] = a[i * 4 + 3]; fa[i] = b[i * 4 + 3]; wi[i] = c[i * 4]; } }
  const dOut = distanceInside(oa, W, H), dFill = distanceInside(fa, W, H);
  const hf = new Float32Array(W * H);
  const bwOut = 15 * sc, bwFill = 26 * sc;
  const dome = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t); };
  for (let i = 0; i < hf.length; i++) {
    hf[i] = fa[i] > 127 ? 0.5 + 0.5 * dome(dFill[i] / bwFill) : 0.5 * dome(dOut[i] / bwOut);
  }
  const colS = words.map((w) => ({ fill: hexToRgb(w.fill), stroke: hexToRgb(w.stroke) }));
  const L = [-0.45, -0.62, 0.64]; const Ln = Math.hypot(...L); L[0] /= Ln; L[1] /= Ln; L[2] /= Ln; // image space: -y is up
  const Hh = [L[0], L[1], L[2] + 1]; const Hn = Math.hypot(...Hh); Hh[0] /= Hn; Hh[1] /= Hn; Hh[2] /= Hn;
  const sk = (5.5 / sc) / 8;
  const colour = pixelCanvas(W, H, (d) => {
    for (let y = 0; y < H; y++) {
      const ym = Math.max(y - 1, 0) * W, y0 = y * W, yp = Math.min(y + 1, H - 1) * W;
      for (let x = 0; x < W; x++) {
        const i = y0 + x, j = i * 4;
        const a = oa[i];
        const wd = colS[Math.max(wi[i] - 1, 0)] || colS[0];
        if (a === 0) { d[j] = wd.stroke[0]; d[j + 1] = wd.stroke[1]; d[j + 2] = wd.stroke[2]; d[j + 3] = 0; continue; }
        const xm = Math.max(x - 1, 0), xp = Math.min(x + 1, W - 1);
        const gx = ((hf[ym + xp] + 2 * hf[y0 + xp] + hf[yp + xp]) - (hf[ym + xm] + 2 * hf[y0 + xm] + hf[yp + xm])) * sk;
        const gy = ((hf[yp + xm] + 2 * hf[yp + x] + hf[yp + xp]) - (hf[ym + xm] + 2 * hf[ym + x] + hf[ym + xp])) * sk;
        const inv = 1 / Math.sqrt(gx * gx + gy * gy + 1);
        const nx = -gx * inv, ny = -gy * inv, nz = inv; // image y is down, so -gy is "up" in image space
        const ndl = nx * L[0] + ny * L[1] + nz * L[2];
        const inFill = fa[i] > 127;
        const base = inFill ? wd.fill : wd.stroke;
        let f = 1 + 0.85 * (ndl - L[2]);
        f *= 1.05 - 0.14 * (y / H);
        const sp = Math.max(nx * Hh[0] + ny * Hh[1] + nz * Hh[2], 0);
        const spec = Math.pow(sp, 60) * (inFill ? 0.6 : 0.3);
        d[j] = clamp(base[0] * f + spec * 255, 0, 255);
        d[j + 1] = clamp(base[1] * f + spec * 255, 0, 255);
        d[j + 2] = clamp(base[2] * f + spec * 255, 0, 255);
        d[j + 3] = a;
      }
    }
  });
  const normal = normalCanvas(hf, W, H, 3.2 / sc);
  return { map: colorTexture(colour), normalMap: dataTexture(normal) };
}

// ---------------------------------------------------------------------------
// Round badge (mat, counter, back wall, freezer)
// ---------------------------------------------------------------------------
function makeBadge() {
  const c = makeCanvas(512, 512), ctx = c.getContext('2d');
  const g = ctx.createConicGradient(-Math.PI / 2, 256, 256);
  [PINK, ORANGE, YELLOW, LIME, TEAL, PURPLE, PINK].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(256, 256, 252, 0, Math.PI * 2); ctx.fill();
  const rim = ctx.createRadialGradient(256, 256, 226, 256, 256, 252);
  rim.addColorStop(0, 'rgba(0,0,0,0.0)'); rim.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = rim; ctx.beginPath(); ctx.arc(256, 256, 252, 0, Math.PI * 2); ctx.fill();
  const inner = ctx.createRadialGradient(256, 200, 20, 256, 256, 232);
  inner.addColorStop(0, '#1b1530'); inner.addColorStop(1, '#09070f');
  ctx.fillStyle = inner; ctx.beginPath(); ctx.arc(256, 256, 228, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(256, 256, 216, 0, Math.PI * 2); ctx.stroke();
  bubbleWord(ctx, 'EXOTIC', 256, 150, 84, PURPLE, WHITE);
  bubbleWord(ctx, 'CANDY', 256, 250, 116, WHITE, PURPLE);
  bubbleWord(ctx, '& MUNCHIES', 256, 350, 62, PURPLE, WHITE);
  return c;
}

// ---------------------------------------------------------------------------
// Entrance mat, 2048 x 683 (3.6 x 1.2 m): black carpet with three printed badges
// ---------------------------------------------------------------------------
function makeMat(seed, badgeCanvas) {
  const sc = Math.min(1, MAXSZ / 2048), W = Math.round(2048 * sc), H = Math.round(683 * sc), rng = makeRng(seed);
  const base = makeCanvas(W, H), bc = base.getContext('2d');
  bc.scale(sc, sc);
  bc.fillStyle = '#101012'; bc.fillRect(0, 0, 2048, 683);
  bc.fillStyle = '#1a1a1d'; bc.fillRect(32, 32, 2048 - 64, 683 - 64);
  bc.strokeStyle = '#2a2a2e'; bc.lineWidth = 6; bc.strokeRect(46, 46, 2048 - 92, 683 - 92);
  for (let i = 0; i < 3; i++) bc.drawImage(badgeCanvas, 180 + i * 650, 115, 450, 450);
  const fibreA = periodicNoise(W, H, W / 2, H / 2, rng), fibreB = periodicNoise(W, H, W, H, rng);
  const pile = fbm(W, H, 6, 40, 3, rng);
  const src = bc.getImageData(0, 0, W, H).data;
  const hf = new Float32Array(W * H);
  const colour = pixelCanvas(W, H, (d) => {
    for (let i = 0; i < W * H; i++) {
      const j = i * 4;
      const f = 0.82 + 0.24 * fibreA[i] + 0.1 * (fibreB[i] - 0.5) + 0.12 * (pile[i] - 0.5);
      d[j] = src[j] * f; d[j + 1] = src[j + 1] * f; d[j + 2] = src[j + 2] * f; d[j + 3] = 255;
      hf[i] = 0.6 * fibreA[i] + 0.3 * fibreB[i] + 0.1 * pile[i];
    }
  });
  return { map: colorTexture(colour), normalMap: dataTexture(normalCanvas(hf, W, H, 3.0)) };
}

// ---------------------------------------------------------------------------
// Graffiti mural (spray look): purple field, teal panels, palm fronds, bubble blobs, starbursts, drips
// ---------------------------------------------------------------------------
function frond(ctx, x, y, len, ang, curl, u, rng) {
  const n = 20; ctx.lineCap = 'round';
  const pts = []; let px = x, py = y;
  for (let i = 0; i <= n; i++) {
    const t = i / n, a = ang + curl * t * t;
    pts.push({ x: px, y: py, a, t });
    px += Math.cos(a) * len / n; py += Math.sin(a) * len / n;
  }
  ctx.strokeStyle = '#17482e'; ctx.lineWidth = u * 0.014;
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (const p of pts) ctx.lineTo(p.x, p.y); ctx.stroke();
  for (let i = 2; i < pts.length; i++) {
    const p = pts[i], ll = len * 0.3 * Math.sin(Math.PI * (0.12 + p.t * 0.88)) * (1 - p.t * 0.45);
    for (const s of [-1, 1]) {
      const a = p.a + s * (0.95 - p.t * 0.25);
      ctx.strokeStyle = rng() < 0.5 ? '#1f6f45' : '#2a8a54'; ctx.lineWidth = u * 0.011 * (1 - p.t * 0.5);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * ll, p.y + Math.sin(a) * ll); ctx.stroke();
    }
  }
}

function makeMural(baseSeed, w0, h0, variant) {
  let w = Math.max(64, Math.round(w0)), h = Math.max(64, Math.round(h0));
  const mx = Math.max(w, h), cap = Math.min(2048, MAXSZ);
  if (mx > cap) { const k = cap / mx; w = Math.round(w * k); h = Math.round(h * k); }
  const rng = makeRng(hashSeed(baseSeed, w, h, variant));
  const R = (a = 0, b = 1) => a + (b - a) * rng();
  const pickc = (arr) => arr[Math.floor(rng() * arr.length)];
  const c = makeCanvas(w, h), ctx = c.getContext('2d');
  const u = h, aspect = w / h;
  const rep = Math.max(1, aspect);

  // Field: diagonal purple gradient with cloudy overspray mottling
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#8d50e4'); g.addColorStop(0.5, '#7a3fd3'); g.addColorStop(1, '#5a2fae');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 26 * Math.min(rep, 6); i++) {
    const x = R(0, w), y = R(0, h), r = u * R(0.35, 1.0);
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    const light = rng() < 0.5;
    rg.addColorStop(0, light ? 'rgba(190,140,255,0.10)' : 'rgba(40,10,90,0.12)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // Teal angled panels with soft sprayed edges
  const panels = clamp(Math.round(aspect * 0.9) + 1, 2, 10);
  for (let i = 0; i < panels; i++) {
    const x0 = R(-0.1, 1) * w, y0 = R(-0.1, 0.6) * h, sw = u * R(0.5, 1.1), sk = u * R(0.2, 0.5);
    const poly = [[x0, y0], [x0 + sw, y0 - sk], [x0 + sw * 1.15, y0 + u * R(0.5, 0.9)], [x0 + sw * 0.1, y0 + u * R(0.6, 1.0)]];
    ctx.save();
    ctx.shadowColor = 'rgba(20,100,115,0.8)'; ctx.shadowBlur = u * 0.04; ctx.shadowOffsetX = u * 0.02; ctx.shadowOffsetY = u * 0.025;
    const tg = ctx.createLinearGradient(x0, y0, x0 + sw, y0 + u);
    tg.addColorStop(0, '#33c5d4'); tg.addColorStop(1, '#1fa3b4');
    ctx.fillStyle = tg; ctx.beginPath(); poly.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = u * 0.012; ctx.stroke();
    ctx.restore();
  }
  // Palm fronds, fanning in from the top and bottom edges
  const palms = clamp(Math.round(aspect * 0.8) + 1, 2, 9);
  for (let i = 0; i < palms; i++) {
    const fromTop = rng() < 0.6;
    const x = R(0, w), y = fromTop ? -u * 0.05 : h + u * 0.05;
    const len = u * R(0.55, 0.95), base = fromTop ? R(0.9, 2.2) : -R(0.9, 2.2);
    const bundle = 3 + Math.floor(rng() * 3);
    ctx.save(); ctx.shadowColor = 'rgba(10,40,25,0.6)'; ctx.shadowBlur = u * 0.015;
    for (let k = 0; k < bundle; k++) frond(ctx, x, y, len * R(0.75, 1.1), base + (k - bundle / 2) * 0.32 + R(-0.1, 0.1), R(-0.7, 0.7), u, rng);
    ctx.restore();
  }
  // Wavy accent lines
  for (let i = 0; i < clamp(Math.round(aspect * 1.2) + 2, 3, 16); i++) {
    const x = R(0, w), y = R(0.1, 0.9) * h, len = u * R(0.5, 1.2);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineWidth = u * R(0.015, 0.03);
    ctx.strokeStyle = pickc(['rgba(255,210,63,0.85)', 'rgba(255,255,255,0.8)', 'rgba(255,94,168,0.85)', 'rgba(159,233,241,0.85)']);
    ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = u * 0.012;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 1; s <= 6; s++) ctx.lineTo(x + (len * s) / 6, y + Math.sin(s * 1.7 + i) * u * 0.05);
    ctx.stroke(); ctx.restore();
  }
  // Bubble blobs with white outline, shading, gloss, drips, overspray
  const blobs = clamp(Math.round(rep * 2.4) + 4, 6, 44);
  const palette = [ORANGE, YELLOW, PINK, LIME, AQUA];
  const drips = [];
  for (let i = 0; i < blobs; i++) {
    const r = u * R(0.06, 0.17), x = R(0, w), y = R(0, h), col = pickc(palette);
    ctx.save();
    ctx.shadowColor = 'rgba(30,8,70,0.40)'; ctx.shadowBlur = r * 0.25; ctx.shadowOffsetX = r * 0.14; ctx.shadowOffsetY = r * 0.2;
    ctx.beginPath(); ctx.ellipse(x, y, r, r * R(0.85, 1.05), R(-0.3, 0.3), 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    const rg = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.05);
    rg.addColorStop(0, shade(col, 0.45)); rg.addColorStop(0.55, col); rg.addColorStop(1, shade(col, -0.22));
    ctx.fillStyle = rg; ctx.fill();
    ctx.lineWidth = r * 0.15; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(x - r * 0.33, y - r * 0.38, r * 0.26, r * 0.15, -0.6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fill();
    ctx.beginPath(); ctx.arc(x + r * 0.28, y + r * 0.35, r * 0.07, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fill();
    ctx.restore();
    // overspray halo
    const dots = Math.round(40 + r * 0.9);
    for (let k = 0; k < dots; k++) {
      const a = R(0, 6.2832), d = r * R(1.05, 1.55);
      ctx.fillStyle = col; ctx.globalAlpha = R(0.05, 0.25);
      ctx.beginPath(); ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, u * R(0.0015, 0.005), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (rng() < 0.55) drips.push({ x: x + R(-0.4, 0.4) * r, y: y + r, len: u * R(0.05, 0.2), w: u * R(0.008, 0.016), col });
  }
  for (const dr of drips) { // drips run down from the blob edge
    ctx.fillStyle = dr.col; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.moveTo(dr.x - dr.w / 2, dr.y - dr.w); ctx.lineTo(dr.x - dr.w / 2, dr.y + dr.len);
    ctx.arc(dr.x, dr.y + dr.len, dr.w / 2, Math.PI, 0, true); ctx.lineTo(dr.x + dr.w / 2, dr.y - dr.w); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(dr.x - dr.w * 0.25, dr.y, dr.w * 0.18, dr.len * 0.8);
    ctx.globalAlpha = 1;
  }
  // White starbursts
  const stars = clamp(Math.round(rep * 1.6) + 3, 4, 28);
  for (let i = 0; i < stars; i++) {
    const x = R(0, w), y = R(0, h), r = u * R(0.03, 0.08), pts = pickc([8, 12, 16]);
    ctx.save(); ctx.shadowColor = 'rgba(255,255,255,0.7)'; ctx.shadowBlur = r * 0.5;
    ctx.fillStyle = '#fff'; ctx.beginPath();
    for (let k = 0; k < pts * 2; k++) { const a = (k / (pts * 2)) * Math.PI * 2 + 0.3, rr = k % 2 ? r * 0.38 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }
  if (variant === 2) { // store-name header, like the painted header in the reference photos
    const name = menuData().name.toUpperCase();
    const size = Math.min(u * 0.62, fitSize(ctx, name, 700, w * 0.9, 9999));
    bubbleWord(ctx, name, w / 2, h * 0.5, size, YELLOW, PURPLE, { outline: 0.2 });
  }
  // Spray grain: per-pixel speckle plus a very faint concrete mottling
  const id = ctx.getImageData(0, 0, w, h), d = id.data;
  const gr = makeRng(hashSeed(baseSeed, w, h, variant, 91));
  for (let i = 0; i < d.length; i += 4) {
    const n = 1 + (gr() - 0.5) * 0.07;
    d[i] = clamp(d[i] * n, 0, 255); d[i + 1] = clamp(d[i + 1] * n, 0, 255); d[i + 2] = clamp(d[i + 2] * n, 0, 255);
  }
  ctx.putImageData(id, 0, 0);
  return { map: colorTexture(c) };
}

// ---------------------------------------------------------------------------
// Poster, lightbox, tablet, freezer wrap, label atlas
// ---------------------------------------------------------------------------
function makePoster(tagline) {
  const W = 512, H = 768, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#16141a'; ctx.fillRect(0, 0, W, H); // frame
  ctx.fillStyle = '#f6f4ef'; ctx.fillRect(10, 10, W - 20, H - 20); // mat board
  const x0 = 34, y0 = 34, w = W - 68, h = H - 68;
  const tg = ctx.createLinearGradient(0, y0 + 270, 0, y0 + h); tg.addColorStop(0, '#31bccc'); tg.addColorStop(1, '#1d98a9');
  ctx.fillStyle = tg; ctx.fillRect(x0, y0, w, h);
  const pg = ctx.createLinearGradient(0, y0, 0, y0 + 270); pg.addColorStop(0, '#8d50e4'); pg.addColorStop(1, '#6a35c4');
  ctx.fillStyle = pg; ctx.fillRect(x0, y0, w, 270);
  ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, w, h); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let yy = y0 + 8; yy < y0 + h; yy += 18) for (let xx = x0 + ((yy / 18) % 2 ? 9 : 0); xx < x0 + w; xx += 18) { ctx.beginPath(); ctx.arc(xx, yy, 3.2, 0, 6.2832); ctx.fill(); }
  ctx.restore();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  bubbleWord(ctx, 'EXOTIC', W / 2, y0 + 70, 84, WHITE, PURPLE);
  bubbleWord(ctx, 'CANDY', W / 2, y0 + 158, 100, YELLOW, PURPLE);
  bubbleWord(ctx, '& MUNCHIES', W / 2, y0 + 236, 56, WHITE, PURPLE);
  const lines = String(tagline).toUpperCase().split(/\.\s+/).map((s) => s.replace(/\.$/, '').trim()).filter(Boolean);
  ctx.fillStyle = '#0b3a41';
  lines.forEach((l, i) => {
    const sz = Math.min(44, fitSize(ctx, l, 700, w - 50, 44));
    ctx.font = `700 ${sz}px ${FONT}`; ctx.fillText(l, W / 2, y0 + 360 + i * 70);
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, h); // mat bevel line
  return { map: colorTexture(c) };
}

function makeLightbox(text) {
  const c = makeCanvas(1024, 256), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256); g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#e9eefc');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 256);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const sz = Math.min(150, fitSize(ctx, text, 700, 920, 150));
  ctx.font = `700 ${sz}px ${FONT}`; ctx.fillStyle = '#2f4fd0'; ctx.fillText(text, 512, 132);
  return { map: colorTexture(c) };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function makeTablet() {
  const W = 512, H = 384, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#f5f3fb'; ctx.fillRect(0, 0, W, H);
  const hg = ctx.createLinearGradient(0, 0, W, 0); hg.addColorStop(0, '#6a35c4'); hg.addColorStop(1, '#8d50e4');
  ctx.fillStyle = hg; ctx.fillRect(0, 0, W, 84);
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = '#fff'; ctx.font = `700 48px ${FONT}`; ctx.fillText('MENU', 26, 36);
  ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.font = `600 18px ${FONT}`; ctx.fillText(menuData().name, 28, 66);
  const cats = menuData().categories;
  const rowH = Math.min(62, (H - 100) / Math.max(cats.length, 1));
  cats.forEach((cat, i) => {
    const y = 98 + i * rowH;
    ctx.save(); ctx.shadowColor = 'rgba(60,30,120,0.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2;
    ctx.fillStyle = '#fff'; roundRect(ctx, 18, y, W - 36, rowH - 8, 12); ctx.fill(); ctx.restore();
    ctx.fillStyle = [PURPLE, TEAL, ORANGE, PINK, LIME][i % 5]; roundRect(ctx, 28, y + 10, 10, rowH - 28, 5); ctx.fill();
    ctx.fillStyle = '#2a2140'; ctx.font = `600 28px ${FONT}`; ctx.fillText(cat.name, 54, y + (rowH - 8) / 2);
    ctx.strokeStyle = '#8d50e4'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(W - 52, y + (rowH - 8) / 2 - 8); ctx.lineTo(W - 42, y + (rowH - 8) / 2); ctx.lineTo(W - 52, y + (rowH - 8) / 2 + 8); ctx.stroke();
  });
  return { map: colorTexture(c) };
}

function makeFreezerWrap(badgeCanvas) {
  const c = makeCanvas(1024, 512), ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 1024, 0); g.addColorStop(0, '#7a3fd3'); g.addColorStop(1, '#27b6c7');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  ctx.save(); ctx.globalAlpha = 0.13; ctx.strokeStyle = '#fff'; ctx.lineWidth = 16;
  for (let i = -2; i < 8; i++) { ctx.beginPath(); ctx.moveTo(i * 190, 512); ctx.lineTo(i * 190 + 300, 0); ctx.stroke(); }
  ctx.restore();
  ctx.save(); ctx.shadowColor = 'rgba(20,6,50,0.5)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.drawImage(badgeCanvas, 312, 56, 400, 400); ctx.restore();
  const shine = ctx.createLinearGradient(0, 0, 0, 512); shine.addColorStop(0, 'rgba(255,255,255,0.14)'); shine.addColorStop(0.4, 'rgba(255,255,255,0)');
  ctx.fillStyle = shine; ctx.fillRect(0, 0, 1024, 512);
  return { map: colorTexture(c) };
}

function makeLabels(seed) {
  const S = 1024, cell = 256, rng = makeRng(seed);
  const c = makeCanvas(S, S), ctx = c.getContext('2d');
  const designs = [
    ['SPICY', '#e63a2e', '#ff9a1f', '#ffe14a', '#ffffff'], ['SOUR', '#8bd13a', '#2aa84f', '#fff35c', '#1e5a14'],
    ['CHOCO', '#5a2e1c', '#8a4a2a', '#f3c98b', '#ffe8c8'], ['LIMON', '#ffe94d', '#9be15d', '#ffffff', '#2b7a1c'],
    ['COLA', '#b3151f', '#4a0b10', '#ffffff', '#ffffff'], ['GUMMY', '#ff5ea8', '#a23de6', '#ffe14a', '#ffffff'],
    ['MANGO', '#ffab1f', '#ff6a2a', '#7ed957', '#ffffff'], ['BERRY', '#6a35c4', '#2a2f9e', '#ff7ac0', '#ffffff'],
    ['CRUNCH', '#f2a33a', '#c8641b', '#fff1c4', '#5a2a0a'], ['TANGY', '#27b6c7', '#1b6fb3', '#ffe14a', '#ffffff'],
    ['CHILI', '#c4161c', '#1c1c1c', '#ffd23f', '#ffffff'], ['SWEET', '#ff8fc4', '#ffd0e6', '#7a3fd3', '#7a3fd3'],
    ['MINT', '#35c9a4', '#1c8f8a', '#ffffff', '#ffffff'], ['PEACH', '#ffb08a', '#ff7a6a', '#ffe9a8', '#ffffff'],
    ['FIZZ', '#3a8ef0', '#7a3fd3', '#9fe9f1', '#ffffff'], ['SALTY', '#f4f1ea', '#c8cfd8', '#e23b3b', '#e23b3b'],
  ];
  designs.forEach(([word, c1, c2, accent, textCol], i) => {
    const cx = (i % 4) * cell, cy = Math.floor(i / 4) * cell;
    ctx.save(); ctx.beginPath(); ctx.rect(cx, cy, cell, cell); ctx.clip(); ctx.translate(cx, cy);
    const bg = ctx.createLinearGradient(0, 0, cell, cell); bg.addColorStop(0, c1); bg.addColorStop(1, c2);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cell, cell);
    const style = i % 4;
    ctx.globalAlpha = 0.28; ctx.fillStyle = accent;
    if (style === 0) { for (let k = -2; k < 8; k++) { ctx.beginPath(); ctx.moveTo(k * 46, cell); ctx.lineTo(k * 46 + 26, cell); ctx.lineTo(k * 46 + 26 + 120, 0); ctx.lineTo(k * 46 + 120, 0); ctx.fill(); } }
    else if (style === 1) { ctx.beginPath(); for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2, r = k % 2 ? 80 : 190; ctx.lineTo(128 + Math.cos(a) * r, 128 + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); }
    else if (style === 2) { for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc(rng() * cell, rng() * cell, 20 + rng() * 40, 0, 6.2832); ctx.fill(); } }
    else { ctx.beginPath(); ctx.moveTo(0, 150); for (let x = 0; x <= cell; x += 32) ctx.lineTo(x, 150 + ((x / 32) % 2 ? 26 : -26)); ctx.lineTo(cell, cell); ctx.lineTo(0, cell); ctx.fill(); }
    ctx.globalAlpha = 1;
    // central badge
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = accent; roundRect(ctx, 20, 74, cell - 40, 108, 26); ctx.fill(); ctx.restore();
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(255,255,255,0.85)'; roundRect(ctx, 20, 74, cell - 40, 108, 26); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sz = fitSize(ctx, word, 700, cell - 70, 74);
    ctx.font = `700 ${sz}px ${FONT}`; ctx.lineJoin = 'round'; ctx.lineWidth = sz * 0.1; ctx.strokeStyle = shade(c1, -0.4);
    ctx.strokeText(word, cell / 2, 130); ctx.fillStyle = textCol === accent ? '#fff' : textCol; ctx.fillText(word, cell / 2, 130);
    // gloss along the top, small pips
    const gl = ctx.createLinearGradient(0, 0, 0, 90); gl.addColorStop(0, 'rgba(255,255,255,0.35)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, 0, cell, 90);
    ctx.fillStyle = '#fff'; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(cell / 2 + (k - 1) * 22, 214, 6, 0, 6.2832); ctx.fill(); }
    ctx.restore();
  });
  const map = colorTexture(c);
  map.cells = 4;
  // atlas helper: lower-left UV corner of cell i (row 0 is the top row of the canvas)
  map.cellOffset = (i) => [(i % 4) / 4, 1 - (Math.floor(i / 4) + 1) / 4];
  return { map, cells: 4, cellOffset: map.cellOffset };
}

// ---------------------------------------------------------------------------
// makeTextures
// ---------------------------------------------------------------------------
/**
 * Build every texture once. Returned objects hold THREE textures only; materials are built in env.js.
 * mural/poster/lightbox are memoised per argument set, so repeated calls return the same textures.
 * labels.cells = 4; labels.cellOffset(i) -> [u, v] lower-left corner of cell i (row 0 = top of the canvas).
 */
export function makeTextures(seed = 7, { maxSize = 2048 } = {}) {
  MAXSZ = maxSize;
  const badgeCanvas = makeBadge();
  const badgeMap = colorTexture(badgeCanvas);
  const timings = {};
  const timed = (k, fn) => { const t0 = performance.now(); const v = fn(); timings[k] = Math.round(performance.now() - t0); return v; };
  const T = {
    tile: timed('tile', () => makeTile(hashSeed(seed, 1))),
    wood: timed('wood', () => makeWood(hashSeed(seed, 2))),
    ceiling: timed('ceiling', () => makeCeiling(hashSeed(seed, 3))),
    tealSlat: timed('tealSlat', () => makeSlat(hashSeed(seed, 4), '#2ab4c4', '#12727f')),
    whiteSlat: timed('whiteSlat', () => makeSlat(hashSeed(seed, 5), '#f4f4f2', '#a9aaae')),
    cream: timed('cream', () => makeCream(hashSeed(seed, 6))),
    sign: timed('sign', () => makeSign()),
    badge: { map: badgeMap },
    mat: timed('mat', () => makeMat(hashSeed(seed, 7), badgeCanvas)),
    tablet: timed('tablet', () => makeTablet()),
    freezerWrap: timed('freezerWrap', () => makeFreezerWrap(badgeCanvas)),
    labels: timed('labels', () => makeLabels(hashSeed(seed, 8))),
  };
  T.timings = timings; // ms per texture, for the bench/debug overlay
  const muralCache = new Map(), posterCache = new Map(), lightCache = new Map();
  T.mural = (w, h, variant = 1) => {
    const key = `${Math.round(w)}|${Math.round(h)}|${variant}`;
    if (!muralCache.has(key)) muralCache.set(key, makeMural(seed, w, h, variant));
    return muralCache.get(key);
  };
  T.poster = (tagline = menuData().tagline) => {
    if (!posterCache.has(tagline)) posterCache.set(tagline, makePoster(tagline));
    return posterCache.get(tagline);
  };
  T.lightbox = (text = 'DRINKS') => {
    if (!lightCache.has(text)) lightCache.set(text, makeLightbox(text));
    return lightCache.get(text);
  };
  return T;
}
