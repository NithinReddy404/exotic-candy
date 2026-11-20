// Exotic Candy & Munchies - first-person 3D store.
//
// Layout and look are taken from the reference photos of the mall storefront:
// open inline mall entrance (no door; a wide opening under a white bulkhead),
// dimensional bubble-letter sign hung from the ceiling in front of the opening,
// purple/teal graffiti-mural walls, white slatwall shelving, black "mystery box"
// gable boxes along the top rail, white centre gondolas, a chest freezer by the
// left wall near the entrance, a glass-door drink cooler, a black logo mat on
// the mall floor and a counter at the back under the logo.
//
// Items marked APPROX are stand-ins that need a photo or asset to replace:
//   APPROX-MURAL   the wall art is procedural shapes in the photo palette, not the real murals.
//   APPROX-KEEPER  the shopkeeper is a simple low-poly character; swap in a model/photo.
//   APPROX-SIGN    the sign is canvas-drawn bubble letters; swap for the real logo file.
//   APPROX-GOODS   shelf products are coloured blocks; swap for real product photos.
//
// No menu, price or inventory is invented: everything comes from menu.js.

import * as THREE from 'three';

const DATA = window.EXOTIC_MENU;
const STORE = DATA.store;
const $ = (s) => document.querySelector(s);

const PURPLE = '#7a3fd3', DEEP = '#3b2270', TEAL = '#27b6c7', AQUA = '#9fe9f1';
const ORANGE = '#ff8a2a', YELLOW = '#ffd23f', PINK = '#ff5ea8', LIME = '#9be15d', WHITE = '#ffffff';
const PRODUCT_COLORS = ['#e63946', '#f4a261', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff006e',
  '#fb5607', '#3a86ff', '#ffbe0b', '#ffffff', '#2b2d42', '#80ed99', '#f72585', '#ff9f1c', '#2ec4b6'];

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => innerWidth < 900;

// Deterministic pseudo-random so the shelves look the same on every visit.
let seed = 20261120;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// ---------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTex(c, { repeat = [1, 1], srgb = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}
const FONT = '"Fredoka", "Arial Rounded MT Bold", "Arial Black", sans-serif';

function bubbleWord(ctx, text, x, y, size, fill, stroke, weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.16;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// APPROX-SIGN: the dimensional storefront sign, drawn as outlined bubble letters.
function signTexture() {
  const [c, ctx] = canvas(2048, 560);
  ctx.textBaseline = 'middle';
  const words = [
    { t: 'EXOTIC', fill: PURPLE, stroke: WHITE, size: 230 },
    { t: 'CANDY', fill: WHITE, stroke: PURPLE, size: 300 },
    { t: '& MUNCHIES', fill: PURPLE, stroke: WHITE, size: 230 },
  ];
  const gap = 50;
  let total = 0;
  for (const w of words) { ctx.font = `700 ${w.size}px ${FONT}`; w.w = ctx.measureText(w.t).width; total += w.w; }
  total += gap * (words.length - 1);
  const scale = Math.min(1, 1900 / total);
  let x = (2048 - total * scale) / 2;
  const y = 280;
  // shadow pass for depth
  for (const w of words) {
    ctx.save(); ctx.translate(x + 14, y + 18);
    bubbleWord(ctx, w.t, 0, 0, w.size * scale, '#2a1456', '#2a1456');
    ctx.restore();
    x += (w.w + gap) * scale;
  }
  x = (2048 - total * scale) / 2;
  for (const w of words) {
    ctx.save(); ctx.translate(x, y);
    bubbleWord(ctx, w.t, 0, 0, w.size * scale, w.fill, w.stroke);
    ctx.restore();
    x += (w.w + gap) * scale;
  }
  return toTex(c);
}

// Round badge used on the mat, the counter and the back wall.
function badgeTexture() {
  const [c, ctx] = canvas(512, 512);
  const g = ctx.createConicGradient(0, 256, 256);
  [PINK, ORANGE, YELLOW, LIME, TEAL, PURPLE, PINK].forEach((col, i, a) => g.addColorStop(i / (a.length - 1), col));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(256, 256, 250, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#0c0a14'; ctx.beginPath(); ctx.arc(256, 256, 226, 0, Math.PI * 2); ctx.fill();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  bubbleWord(ctx, 'EXOTIC', 256, 150, 84, PURPLE, WHITE);
  bubbleWord(ctx, 'CANDY', 256, 250, 116, WHITE, PURPLE);
  bubbleWord(ctx, '& MUNCHIES', 256, 350, 62, PURPLE, WHITE);
  return toTex(c);
}

function matTexture() {
  const [c, ctx] = canvas(2048, 683);
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 2048, 683);
  ctx.fillStyle = '#1c1c1c'; ctx.fillRect(30, 30, 1988, 623);
  const b = badgeTexture().image;
  for (let i = 0; i < 3; i++) ctx.drawImage(b, 180 + i * 650, 115, 450, 450);
  return toTex(c);
}

// APPROX-MURAL: procedural graffiti in the photo palette (purple field, teal
// panels, orange/yellow/pink blobs, white starbursts). Replace with photos.
function muralTexture(w, h, variant) {
  const [c, ctx] = canvas(w, h);
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#8a4de0'); g.addColorStop(1, '#5c2fb0');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  // teal angled panels
  ctx.fillStyle = TEAL;
  for (let i = 0; i < 2 + (variant % 2); i++) {
    const x0 = rnd() * w, y0 = rnd() * h * 0.6;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + w * 0.35, y0 - h * 0.25);
    ctx.lineTo(x0 + w * 0.55, y0 + h * 0.4); ctx.lineTo(x0 + w * 0.1, y0 + h * 0.5); ctx.closePath(); ctx.fill();
  }
  // palm-frond style dark green strokes (the photos have a tree painted on the right wall)
  ctx.strokeStyle = '#1f5f3a'; ctx.lineWidth = h * 0.02; ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const x0 = rnd() * w, y0 = rnd() * h * 0.5;
    ctx.beginPath(); ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(x0 + (rnd() - 0.5) * w * 0.3, y0 + h * 0.2, x0 + (rnd() - 0.5) * w * 0.5, y0 + h * 0.45); ctx.stroke();
  }
  // bubble blobs with white outline and highlight
  for (let i = 0; i < 16; i++) {
    const r = h * (0.06 + rnd() * 0.12), x = rnd() * w, y = rnd() * h;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = pick([ORANGE, YELLOW, PINK, LIME, AQUA]); ctx.fill();
    ctx.lineWidth = r * 0.14; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.beginPath(); ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.22, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fill();
  }
  // starbursts
  ctx.fillStyle = '#fff';
  for (let i = 0; i < 9; i++) {
    const x = rnd() * w, y = rnd() * h, r = h * (0.03 + rnd() * 0.05);
    ctx.beginPath();
    for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2, rr = k % 2 ? r : r * 0.35; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  }
  // drips
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 12; i++) { const x = rnd() * w, y = rnd() * h * 0.7, len = h * (0.05 + rnd() * 0.15); ctx.fillRect(x, y, h * 0.012, len); ctx.beginPath(); ctx.arc(x + h * 0.006, y + len, h * 0.01, 0, Math.PI * 2); ctx.fill(); }
  if (variant === 2) {
    // big header text, like the "SAVANNAH" header in the photos, but with the store name
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const size = h * 0.42;
    ctx.save(); ctx.translate(w / 2 + size * 0.03, h / 2 + size * 0.05);
    bubbleWord(ctx, STORE.short.toUpperCase(), 0, 0, Math.min(size, w / 7.5), '#2a1456', '#2a1456');
    ctx.restore();
    bubbleWord(ctx, STORE.short.toUpperCase(), w / 2, h / 2, Math.min(size, w / 7.5), YELLOW, PURPLE);
  }
  return toTex(c);
}

function slatwallTexture(base, groove) {
  const [c, ctx] = canvas(256, 512); // 1 m x 1 m
  ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = groove;
  for (let y = 0; y < 512; y += 39) ctx.fillRect(0, y, 256, 6);
  return toTex(c);
}

function tileTexture() {
  const [c, ctx] = canvas(512, 512); // one 1 m tile
  ctx.fillStyle = '#d9d6cf'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#efece6'; ctx.fillRect(6, 6, 500, 500);
  for (let i = 0; i < 900; i++) { ctx.fillStyle = `rgba(120,110,100,${rnd() * 0.08})`; ctx.fillRect(rnd() * 512, rnd() * 512, 3, 3); }
  return toTex(c);
}

function woodTexture() {
  const [c, ctx] = canvas(512, 512); // 1 m x 1 m, planks along x
  for (let y = 0; y < 512; y += 64) {
    const shade = 120 + rnd() * 30;
    ctx.fillStyle = `rgb(${shade},${shade},${shade - 4})`; ctx.fillRect(0, y, 512, 64);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, y, 512, 2);
    ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(rnd() * 512, y, 2, 64);
    for (let i = 0; i < 20; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; ctx.fillRect(0, y + rnd() * 64, 512, 1); }
  }
  return toTex(c);
}

function ceilingTexture() {
  const [c, ctx] = canvas(512, 512); // 1.2 m x 1.2 m: 2x2 tiles
  ctx.fillStyle = '#cfcfcf'; ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#f4f4f2';
  ctx.fillRect(4, 4, 250, 250); ctx.fillRect(258, 4, 250, 250); ctx.fillRect(4, 258, 250, 250); ctx.fillRect(258, 258, 250, 250);
  for (let i = 0; i < 1500; i++) { ctx.fillStyle = `rgba(0,0,0,${rnd() * 0.06})`; ctx.fillRect(rnd() * 512, rnd() * 512, 2, 2); }
  return toTex(c);
}

function lightboxTexture(text) {
  const [c, ctx] = canvas(1024, 256);
  ctx.fillStyle = '#f7f9ff'; ctx.fillRect(0, 0, 1024, 256);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  bubbleWord(ctx, text, 512, 128, 150, '#3453d6', '#3453d6', 600);
  return toTex(c);
}

function posterTexture() {
  const [c, ctx] = canvas(512, 768);
  ctx.fillStyle = TEAL; ctx.fillRect(0, 0, 512, 768);
  ctx.fillStyle = PURPLE; ctx.fillRect(0, 0, 512, 300);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  bubbleWord(ctx, 'EXOTIC', 256, 110, 86, WHITE, PURPLE);
  bubbleWord(ctx, 'CANDY', 256, 200, 100, YELLOW, PURPLE);
  bubbleWord(ctx, '& MUNCHIES', 256, 280, 60, WHITE, PURPLE);
  ctx.fillStyle = '#0b2c31';
  ctx.font = `700 46px ${FONT}`;
  const lines = STORE.tagline.toUpperCase().split('. ').map((s) => s.replace(/\.$/, ''));
  lines.forEach((l, i) => ctx.fillText(l, 256, 420 + i * 70));
  return toTex(c);
}

function tabletTexture() {
  const [c, ctx] = canvas(512, 384);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 512, 384);
  ctx.fillStyle = PURPLE; ctx.fillRect(0, 0, 512, 80);
  ctx.fillStyle = '#fff'; ctx.font = `700 46px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillText('MENU', 24, 40);
  ctx.fillStyle = '#2a2140'; ctx.font = `800 34px Nunito, sans-serif`;
  DATA.categories.forEach((cat, i) => { ctx.fillStyle = PURPLE; ctx.fillRect(24, 110 + i * 68, 14, 14); ctx.fillStyle = '#2a2140'; ctx.fillText(cat.name, 52, 118 + i * 68); });
  return toTex(c);
}

function freezerWrapTexture() {
  const [c, ctx] = canvas(1024, 512);
  const g = ctx.createLinearGradient(0, 0, 1024, 0); g.addColorStop(0, PURPLE); g.addColorStop(1, TEAL);
  ctx.fillStyle = g; ctx.fillRect(0, 0, 1024, 512);
  ctx.drawImage(badgeTexture().image, 312, 56, 400, 400);
  return toTex(c);
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const canvasEl = $('#c');
let renderer, scene, camera;
const W = () => innerWidth, H = () => innerHeight;

function makeRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, isNarrow() ? 1.75 : 2));
  renderer.setSize(W(), H(), false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#dcd8d0');
  camera = new THREE.PerspectiveCamera(62, W() / H(), 0.05, 80);
}

const mats = {};
function materials() {
  mats.tile = new THREE.MeshLambertMaterial({ map: tileTexture() });
  mats.wood = new THREE.MeshLambertMaterial({ map: woodTexture() });
  mats.ceiling = new THREE.MeshLambertMaterial({ map: ceilingTexture() });
  mats.cream = new THREE.MeshLambertMaterial({ color: '#efeae0' });
  mats.white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  mats.grey = new THREE.MeshLambertMaterial({ color: '#b9b7b2' });
  mats.dark = new THREE.MeshLambertMaterial({ color: '#1a1a1f' });
  mats.black = new THREE.MeshLambertMaterial({ color: '#0e0e12' });
  mats.tealSlat = new THREE.MeshLambertMaterial({ map: slatwallTexture('#2ab4c4', '#1b8d9b') });
  mats.whiteSlat = new THREE.MeshLambertMaterial({ map: slatwallTexture('#f6f6f6', '#d4d4d4') });
  mats.badge = new THREE.MeshLambertMaterial({ map: badgeTexture(), transparent: false });
  mats.glass = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transparent: true, opacity: 0.14, roughness: 0.05, metalness: 0, side: THREE.DoubleSide });
  mats.lightPanel = new THREE.MeshBasicMaterial({ color: '#fff9ee' });
  mats.neighborGlass = new THREE.MeshStandardMaterial({ color: '#1c2433', roughness: 0.15, metalness: 0.4 });
  mats.frame = new THREE.MeshLambertMaterial({ color: '#8f9094' });
}

function box(w, h, d, mat, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function plane(w, h, mat, x, y, z, rx = 0, ry = 0, parent = scene) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0); parent.add(m); return m;
}
function mapped(mat, repX, repY) { const m = mat.clone(); m.map = mat.map.clone(); m.map.repeat.set(repX, repY); m.map.needsUpdate = true; return m; }

// Instanced products (APPROX-GOODS)
class Batch {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.items = []; }
  add(x, y, z, sx, sy, sz, ry, color) { this.items.push({ x, y, z, sx, sy, sz, ry, color }); }
  build(parent = scene) {
    if (!this.items.length) return null;
    const im = new THREE.InstancedMesh(this.geo, this.mat, this.items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    this.items.forEach((it, i) => {
      q.setFromEuler(new THREE.Euler(0, it.ry, 0)); s.set(it.sx, it.sy, it.sz); p.set(it.x, it.y, it.z);
      m.compose(p, q, s); im.setMatrixAt(i, m); im.setColorAt(i, col.set(it.color));
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    parent.add(im); this.items = []; return im;
  }
}
const boxes = new Batch(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: '#fff' }));
const bottles = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 10), new THREE.MeshLambertMaterial({ color: '#fff' }));

// Fill a run of shelf with products. start = first corner, dir = unit along the run,
// out = unit vector pointing away from the wall (the product's front).
function fillRun(start, dir, length, out, y, kind = 'box') {
  let d = 0.03;
  const ry = Math.atan2(out.x, out.z);
  while (d < length - 0.05) {
    const w = kind === 'bag' ? 0.1 + rnd() * 0.06 : 0.07 + rnd() * 0.09;
    if (d + w > length - 0.02) break;
    const h = kind === 'bag' ? 0.16 + rnd() * 0.08 : 0.12 + rnd() * 0.12;
    const dep = kind === 'bag' ? 0.04 + rnd() * 0.03 : 0.05 + rnd() * 0.06;
    const cx = start.x + dir.x * (d + w / 2) + out.x * (0.17 - dep / 2);
    const cz = start.z + dir.z * (d + w / 2) + out.z * (0.17 - dep / 2);
    boxes.add(cx, y + h / 2, cz, w, h, dep, ry + (rnd() - 0.5) * 0.08, pick(PRODUCT_COLORS));
    d += w + 0.012 + rnd() * 0.01;
  }
}

// Wall shelving unit: white boards on slatwall, products on each shelf, black gable
// "mystery boxes" along the top rail (as in the photos).
function wallShelves(start, dir, length, out, { shelves = [0.28, 0.72, 1.16, 1.6], topBoxes = true } = {}) {
  const ry = Math.atan2(out.x, out.z);
  const g = new THREE.Group(); scene.add(g);
  // backing slatwall (white) sits just off the wall
  const back = new THREE.Mesh(new THREE.BoxGeometry(length, 2.25, 0.02), mapped(mats.whiteSlat, length, 2.25));
  back.position.set(start.x + dir.x * length / 2 + out.x * 0.01, 1.125, start.z + dir.z * length / 2 + out.z * 0.01);
  back.rotation.y = ry; g.add(back);
  for (const y of shelves) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(length, 0.03, 0.36), mats.white);
    s.position.set(start.x + dir.x * length / 2 + out.x * 0.19, y, start.z + dir.z * length / 2 + out.z * 0.19);
    s.rotation.y = ry; g.add(s);
    fillRun(start, dir, length, out, y + 0.015, rnd() < 0.5 ? 'bag' : 'box');
  }
  // uprights
  for (let d = 0; d <= length + 0.01; d += 1.2) {
    const u = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.0, 0.36), mats.white);
    u.position.set(start.x + dir.x * Math.min(d, length) + out.x * 0.19, 1.0, start.z + dir.z * Math.min(d, length) + out.z * 0.19);
    u.rotation.y = ry; g.add(u);
  }
  if (topBoxes) {
    for (let d = 0.35; d < length - 0.2; d += 0.6) {
      const bx = start.x + dir.x * d + out.x * 0.12, bz = start.z + dir.z * d + out.z * 0.12;
      boxes.add(bx, 2.05, bz, 0.26, 0.26, 0.2, ry, '#111118');
      boxes.add(bx + out.x * 0.105, 2.08, bz + out.z * 0.105, 0.11, 0.07, 0.005, ry, PURPLE); // label
    }
  }
}

function gondola(x, z, lengthZ = 1.8) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  box(1.0, 0.85, lengthZ, mats.white, 0, 0.425, 0, g);
  box(1.08, 0.04, lengthZ + 0.08, mats.white, 0, 0.87, 0, g);
  box(1.0, 0.03, lengthZ, mats.white, 0, 0.45, 0, g); // mid shelf lip
  // products on top: two rows facing +x and -x, bags leaning
  const s = new THREE.Vector3(x + 0.45, 0, z - lengthZ / 2);
  fillRun(s, new THREE.Vector3(0, 0, 1), lengthZ, new THREE.Vector3(1, 0, 0), 0.89, 'bag');
  const s2 = new THREE.Vector3(x - 0.45, 0, z + lengthZ / 2);
  fillRun(s2, new THREE.Vector3(0, 0, -1), lengthZ, new THREE.Vector3(-1, 0, 0), 0.89, 'bag');
  // centre stack of boxes
  for (let k = 0; k < Math.floor(lengthZ / 0.3); k++) boxes.add(x, 0.98, z - lengthZ / 2 + 0.2 + k * 0.3, 0.26, 0.18, 0.22, 0, pick(PRODUCT_COLORS));
  // lower open shelf with boxes
  for (let k = 0; k < Math.floor(lengthZ / 0.25); k++) { boxes.add(x + 0.35, 0.55, z - lengthZ / 2 + 0.15 + k * 0.25, 0.14, 0.18, 0.2, Math.PI / 2, pick(PRODUCT_COLORS)); boxes.add(x - 0.35, 0.55, z - lengthZ / 2 + 0.15 + k * 0.25, 0.14, 0.18, 0.2, -Math.PI / 2, pick(PRODUCT_COLORS)); }
}

function freezer(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const wrap = new THREE.MeshLambertMaterial({ map: freezerWrapTexture() });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.85, 1.6), [mats.white, wrap, mats.white, mats.white, wrap, wrap]);
  body.position.y = 0.425; g.add(body);
  box(0.79, 0.05, 1.64, mats.white, 0, 0.87, 0, g);
  const lid = box(0.62, 0.02, 1.45, mats.glass, 0, 0.9, 0, g); lid.renderOrder = 2;
  box(0.6, 0.02, 1.4, new THREE.MeshLambertMaterial({ color: '#dff4ff' }), 0, 0.72, 0, g);
}

function cooler(x, z) { // 3-door glass cooler on the right wall, doors facing -x
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  // hollow cabinet: back, sides, top (with lightbox) and base, so the bottles show through the doors
  const lining = new THREE.MeshLambertMaterial({ color: '#eef6fa' });
  box(0.05, 2.1, 1.95, mats.grey, 0.33, 1.05, 0, g);
  plane(1.9, 1.8, lining, 0.3, 1.0, 0, 0, -Math.PI / 2, g);
  box(0.7, 2.1, 0.04, mats.grey, 0, 1.05, -0.975, g); box(0.7, 2.1, 0.04, mats.grey, 0, 1.05, 0.975, g);
  box(0.7, 0.3, 1.95, mats.grey, 0, 1.95, 0, g);
  box(0.7, 0.12, 1.95, mats.grey, 0, 0.06, 0, g);
  const lb = plane(1.9, 0.26, new THREE.MeshBasicMaterial({ map: lightboxTexture('DRINKS') }), -0.351, 1.95, 0, 0, -Math.PI / 2, g);
  for (let t = 0; t < 4; t++) {
    box(0.6, 0.02, 1.88, mats.white, -0.02, 0.3 + t * 0.4, 0, g);
    for (let row = 0; row < 3; row++) {
      const start = new THREE.Vector3(x - 0.3 + row * 0.16, 0, z - 0.92);
      let d = 0.04;
      while (d < 1.84) { bottles.add(start.x, 0.31 + t * 0.4 + 0.1, start.z + d, 0.06, 0.2, 0.06, 0, pick(PRODUCT_COLORS)); d += 0.075; }
    }
  }
  // doors + frames
  for (let i = 0; i < 3; i++) {
    const dz = -0.65 + i * 0.65;
    const door = plane(0.63, 1.72, mats.glass, -0.36, 0.92, dz, 0, -Math.PI / 2, g); door.renderOrder = 3;
    box(0.03, 1.76, 0.03, mats.frame, -0.36, 0.92, dz - 0.31, g);
    box(0.03, 1.76, 0.03, mats.frame, -0.36, 0.92, dz + 0.31, g);
    box(0.03, 0.03, 0.65, mats.frame, -0.36, 1.78, dz, g);
    box(0.03, 0.03, 0.65, mats.frame, -0.36, 0.06, dz, g);
    box(0.02, 0.3, 0.02, mats.dark, -0.39, 0.95, dz + 0.26, g); // handle
  }
  const light = new THREE.PointLight('#ffffff', 2.5, 3, 2); light.position.set(x - 0.2, 1.6, z); scene.add(light);
}

// APPROX-KEEPER: simple low-poly shopkeeper. Faces +z (toward the entrance).
const keeper = { group: null, head: null, armR: null, armL: null, tablet: null, mode: 'idle', t: 0, greetStart: 0 };
function buildKeeper(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const skin = new THREE.MeshLambertMaterial({ color: '#c98f6a' });
  const shirt = new THREE.MeshLambertMaterial({ color: PURPLE });
  const pants = new THREE.MeshLambertMaterial({ color: '#2b2d42' });
  const hair = new THREE.MeshLambertMaterial({ color: '#2a1a12' });
  const cap = new THREE.MeshLambertMaterial({ color: TEAL });
  const leg = new THREE.CapsuleGeometry(0.085, 0.55, 4, 10);
  [-0.11, 0.11].forEach((lx) => { const m = new THREE.Mesh(leg, pants); m.position.set(lx, 0.42, 0); g.add(m); });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 12), shirt); torso.position.y = 1.08; g.add(torso);
  const tag = box(0.09, 0.03, 0.01, mats.white, 0.1, 1.2, 0.2, g); tag.rotation.x = -0.1;
  // head
  const head = new THREE.Group(); head.position.set(0, 1.5, 0); g.add(head);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 10), skin); neck.position.y = -0.02; head.add(neck);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 16), skin); skull.position.y = 0.1; head.add(skull);
  const hairM = new THREE.Mesh(new THREE.SphereGeometry(0.135, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hair); hairM.position.y = 0.11; hairM.rotation.x = -0.35; head.add(hairM);
  const capM = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 20), cap); capM.position.y = 0.21; head.add(capM);
  const brim = box(0.14, 0.015, 0.1, cap, 0, 0.19, 0.14, head);
  [-0.045, 0.045].forEach((ex) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), mats.black); e.position.set(ex, 0.12, 0.12); head.add(e); });
  const mouth = box(0.05, 0.012, 0.01, new THREE.MeshLambertMaterial({ color: '#8a3a3a' }), 0, 0.045, 0.125, head);
  mouth.rotation.z = 0;
  // arms (pivot at shoulder)
  const armGeo = new THREE.CapsuleGeometry(0.055, 0.42, 4, 10);
  const mkArm = (sx) => { const a = new THREE.Group(); a.position.set(sx, 1.32, 0); const m = new THREE.Mesh(armGeo, shirt); m.position.y = -0.26; a.add(m); const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 10), skin); hand.position.y = -0.52; a.add(hand); g.add(a); return a; };
  const armL = mkArm(-0.26), armR = mkArm(0.26);
  armL.rotation.x = 0.12; armL.rotation.z = 0.12; armR.rotation.x = 0.35; armR.rotation.z = -0.12;
  // tablet held in front (position/rotation are lerped between held-low and presented)
  const tab = new THREE.Group(); g.add(tab);
  const tabBody = box(0.3, 0.21, 0.012, mats.black, 0, 0, 0, tab);
  const screen = plane(0.28, 0.19, new THREE.MeshBasicMaterial({ map: tabletTexture() }), 0, 0, 0.0065, 0, 0, tab);
  tab.position.set(0.2, 0.98, 0.22); tab.rotation.x = -1.25;
  Object.assign(keeper, { group: g, head, armR, armL, tablet: tab, mouth });
}

// APPROX-MURAL textures, cached per wall size
function muralMat(w, h, variant) { return new THREE.MeshLambertMaterial({ map: muralTexture(Math.round(w * 180), Math.round(h * 180), variant) }); }

function buildExterior() {
  // mall corridor floor and ceiling
  plane(26, 18, mapped(mats.tile, 26, 18), 0, 0, 9, -Math.PI / 2);
  plane(26, 18, mapped(mats.ceiling, 26 / 1.2, 18 / 1.2), 0, 4.5, 9, Math.PI / 2);
  for (let z = 2; z < 18; z += 4) for (const x of [-6, 0, 6]) { const l = plane(0.6, 1.2, mats.lightPanel, x, 4.48, z, Math.PI / 2); }
  // storefront wall at z=0: pilasters, bulkhead, and neighbour frontages
  box(1.6, 4.5, 0.3, mats.cream, -4.0, 2.25, -0.15);
  box(1.6, 4.5, 0.3, mats.cream, 4.0, 2.25, -0.15);
  box(6.4, 1.1, 0.3, mats.cream, 0, 3.95, -0.15); // bulkhead over the opening (opening 6.4 wide x 3.4 tall)
  box(0.08, 3.4, 0.12, mats.dark, -3.2, 1.7, -0.06); box(0.08, 3.4, 0.12, mats.dark, 3.2, 1.7, -0.06); // thin storefront frame
  box(6.4, 0.08, 0.12, mats.dark, 0, 3.4, -0.06);
  // neighbouring stores (closed glass fronts)
  for (const sx of [-1, 1]) {
    box(8.2, 4.5, 0.3, mats.cream, sx * 8.9, 2.25, -0.15);
    plane(7.2, 3.2, mats.neighborGlass, sx * 8.9, 1.7, 0.01);
    for (let k = -3; k <= 3; k++) box(0.05, 3.2, 0.05, mats.frame, sx * 8.9 + k * 1.2, 1.7, 0.03);
  }
  // far side of the corridor: another frontage
  box(26, 4.5, 0.3, mats.cream, 0, 2.25, 18.15);
  plane(20, 3.0, mats.neighborGlass, 0, 1.6, 17.99, 0, Math.PI);
  // corridor benches / planters for scale
  box(1.6, 0.45, 0.5, mats.grey, -5, 0.225, 6); box(1.6, 0.45, 0.5, mats.grey, 5, 0.225, 6);
  // logo mat on the mall floor in front of the entrance
  const mat = plane(3.6, 1.2, new THREE.MeshLambertMaterial({ map: matTexture() }), 0, 0.006, 1.0, -Math.PI / 2);
  // the sign: hung from the ceiling, in front of the opening, with a bracket
  const signMat = new THREE.MeshBasicMaterial({ map: signTexture(), transparent: true, side: THREE.DoubleSide });
  const sign = plane(4.6, 1.26, signMat, 0, 3.05, 0.42);
  const signBack = plane(4.6, 1.26, new THREE.MeshBasicMaterial({ map: signMat.map, transparent: true, color: '#3a2a60', side: THREE.DoubleSide }), 0, 3.03, 0.38);
  box(0.04, 1.08, 0.04, mats.dark, -1.2, 3.96, 0.4); box(0.04, 1.08, 0.04, mats.dark, 1.2, 3.96, 0.4); // hanger rods
  box(3.0, 0.05, 0.05, mats.dark, 0, 3.42, 0.36); // rail just above the letters
  // lights
  scene.add(new THREE.HemisphereLight('#ffffff', '#8c8780', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e4', 1.2); sun.position.set(4, 9, 12); scene.add(sun);
  const front = new THREE.PointLight('#fff2dd', 18, 10, 2); front.position.set(0, 3.2, 2.5); scene.add(front);
}

function buildInterior() {
  const Wd = 8, D = 11, Hh = 3.4;
  plane(Wd, D, mapped(mats.wood, Wd, D), 0, 0.001, -D / 2, -Math.PI / 2);
  plane(Wd, D, mapped(mats.ceiling, Wd / 1.2, D / 1.2), 0, Hh, -D / 2, Math.PI / 2);
  for (let z = -1.5; z > -D; z -= 2.2) for (const x of [-2, 2]) plane(0.6, 1.2, mats.lightPanel, x, Hh - 0.01, z, Math.PI / 2);
  // walls: lower teal slatwall band + mural above; left-front section is full-height mural
  const lowerH = 2.3;
  // left wall x=-4
  plane(4.2, Hh, muralMat(4.2, Hh, 1), -Wd / 2, Hh / 2, -2.1, 0, Math.PI / 2);
  plane(D - 4.2, lowerH, mapped(mats.tealSlat, D - 4.2, lowerH), -Wd / 2, lowerH / 2, -4.2 - (D - 4.2) / 2, 0, Math.PI / 2);
  plane(D - 4.2, Hh - lowerH, muralMat(D - 4.2, Hh - lowerH, 3), -Wd / 2, lowerH + (Hh - lowerH) / 2, -4.2 - (D - 4.2) / 2, 0, Math.PI / 2);
  // right wall x=4
  plane(D, lowerH, mapped(mats.tealSlat, D, lowerH), Wd / 2, lowerH / 2, -D / 2, 0, -Math.PI / 2);
  plane(D, Hh - lowerH, muralMat(D, Hh - lowerH, 2), Wd / 2, lowerH + (Hh - lowerH) / 2, -D / 2, 0, -Math.PI / 2);
  // back wall z=-11
  plane(Wd, lowerH, mapped(mats.tealSlat, Wd, lowerH), 0, lowerH / 2, -D);
  plane(Wd, Hh - lowerH, muralMat(Wd, Hh - lowerH, 4), 0, lowerH + (Hh - lowerH) / 2, -D);
  // inside returns of the front pilasters
  plane(0.8, Hh, mapped(mats.tealSlat, 0.8, Hh), -3.6, Hh / 2, -0.01); plane(0.8, Hh, mapped(mats.tealSlat, 0.8, Hh), 3.6, Hh / 2, -0.01);
  // poster on the left-front mural
  plane(0.8, 1.2, new THREE.MeshLambertMaterial({ map: posterTexture() }), -3.98, 1.9, -0.9, 0, Math.PI / 2);
  // shelving
  wallShelves(new THREE.Vector3(-4, 0, -4.3), new THREE.Vector3(0, 0, -1), 6.2, new THREE.Vector3(1, 0, 0));
  wallShelves(new THREE.Vector3(4, 0, -0.4), new THREE.Vector3(0, 0, -1), 7.5, new THREE.Vector3(-1, 0, 0));
  wallShelves(new THREE.Vector3(-3.9, 0, -11), new THREE.Vector3(1, 0, 0), 2.3, new THREE.Vector3(0, 0, 1));
  wallShelves(new THREE.Vector3(1.6, 0, -11), new THREE.Vector3(1, 0, 0), 2.3, new THREE.Vector3(0, 0, 1));
  gondola(-1.4, -3.2); gondola(1.4, -5.8);
  freezer(-3.4, -1.6);
  cooler(3.6, -9.3);
  // counter at the back, left of centre so the menu panel can sit on the right
  const cx = -0.3, cz = -10.0;
  const counterFront = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.02, 0.7), [mats.white, mats.white, mats.white, mats.white, mapped(mats.tealSlat, 2.4, 1.02), mats.white]);
  counterFront.position.set(cx, 0.51, cz); scene.add(counterFront);
  box(2.5, 0.05, 0.8, mats.white, cx, 1.04, cz);
  plane(0.62, 0.62, mats.badge, cx, 0.55, cz + 0.352); // logo on the counter front
  box(0.28, 0.22, 0.2, mats.dark, cx + 0.7, 1.17, cz - 0.1); // POS
  const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.26, 16), mats.glass); jar.position.set(cx - 0.8, 1.2, cz - 0.05); scene.add(jar);
  for (let i = 0; i < 24; i++) bottles.add(cx - 0.8 + (rnd() - 0.5) * 0.12, 1.1 + rnd() * 0.18, cz - 0.05 + (rnd() - 0.5) * 0.12, 0.035, 0.035, 0.035, 0, pick(PRODUCT_COLORS));
  // big logo on the back wall above the counter
  plane(1.5, 1.5, mats.badge, cx, 2.3, -10.99);
  buildKeeper(cx, cz - 0.75);
  boxes.build(); bottles.build();
  // interior lights
  for (const z of [-2.2, -5.5, -9]) { const l = new THREE.PointLight('#fff4e6', 22, 11, 2); l.position.set(0, 3.1, z); scene.add(l); }
  const counterLight = new THREE.PointLight('#ffffff', 6, 5, 2); counterLight.position.set(cx, 2.6, cz + 0.5); scene.add(counterLight);
}

// ---------------------------------------------------------------------------
// Camera, states and animation
// ---------------------------------------------------------------------------
const KEEPER_HEAD = new THREE.Vector3(-0.3, 1.58, -10.75);
const OUTSIDE = { pos: new THREE.Vector3(0.4, 1.62, 7.6), look: new THREE.Vector3(0, 2.3, 0) };
const COUNTER = { pos: new THREE.Vector3(-0.2, 1.62, -8.3), look: KEEPER_HEAD.clone() };
const WALK = new THREE.CatmullRomCurve3([
  [0.4, 1.62, 7.6], [0.25, 1.62, 4.2], [0.05, 1.62, 1.2], [-0.05, 1.62, -1.8], [-0.15, 1.62, -5.0], [-0.2, 1.62, -8.3],
].map((p) => new THREE.Vector3(...p)), false, 'centripetal');
const WALK_SECONDS = 9.5;

const HOTSPOTS = [
  { id: 'candy', label: 'Candy shelves', cat: 'candy', at: [-3.6, 1.5, -7.2], view: { pos: [-1.8, 1.62, -6.6], look: [-3.9, 1.2, -7.4] } },
  { id: 'new', label: 'New arrivals', cat: 'new', at: [-1.4, 1.2, -3.2], view: { pos: [0.1, 1.62, -1.9], look: [-1.5, 0.85, -3.3] } },
  { id: 'snacks', label: 'Snack aisle', cat: 'snacks', at: [1.4, 1.2, -5.8], view: { pos: [-0.2, 1.62, -4.3], look: [1.5, 0.85, -6.0] } },
  { id: 'drinks', label: 'Drink cooler', cat: 'drinks', at: [3.3, 1.6, -9.3], view: { pos: [0.6, 1.62, -8.4], look: [3.9, 1.2, -9.3] } },
  { id: 'freezer', label: 'Freezer', cat: null, at: [-3.3, 1.1, -1.6], view: { pos: [-1.6, 1.62, -1.0], look: [-3.7, 0.7, -1.7] } },
];

let state = 'outside'; // outside | walking | greeting | menu | explore | hotspot | leaving
const view = { pos: OUTSIDE.pos.clone(), look: OUTSIDE.look.clone(), yaw: 0, pitch: 0, yawLimit: 0.5, pitchLimit: 0.22, shiftX: 0, shiftY: 0, bob: 0 };
let transition = null; // {from:{pos,look}, to:{pos,look}, t0, dur, resolve}
let walking = null;    // {t0, dur, reverse, resolve}
let currentHotspot = null;
let interiorReady = null;
let lastFrame = performance.now();

function setLimits(yaw, pitch) { view.yawLimit = yaw; view.pitchLimit = pitch; }

function moveTo(pos, look, dur) {
  return new Promise((resolve) => {
    if (reduceMotion || dur <= 0) { view.pos.copy(pos); view.look.copy(look); view.yaw = view.pitch = 0; resolve(); return; }
    transition = { from: { pos: view.pos.clone(), look: view.look.clone() }, to: { pos: pos.clone(), look: look.clone() }, t0: performance.now(), dur: dur * 1000, resolve };
  });
}
function walk(reverse) {
  return new Promise((resolve) => {
    if (reduceMotion) { const end = reverse ? OUTSIDE : COUNTER; view.pos.copy(end.pos); view.look.copy(end.look); resolve(); return; }
    walking = { t0: performance.now(), dur: WALK_SECONDS * 1000, reverse, resolve };
  });
}
function walkLook(t) { // where the walker looks along the path (t in 0..1, forward direction)
  const A = new THREE.Vector3(0, 2.4, 0.4), B = new THREE.Vector3(0.2, 1.45, -6.5), C = KEEPER_HEAD;
  if (t < 0.18) return A.clone();
  if (t < 0.45) return A.clone().lerp(B, smooth((t - 0.18) / 0.27));
  if (t < 0.8) return B.clone().lerp(C, smooth((t - 0.45) / 0.35));
  return C.clone();
}

function updateCamera(now, dt) {
  if (walking) {
    const u = clamp((now - walking.t0) / walking.dur, 0, 1);
    const e = easeInOut(u);
    const t = walking.reverse ? 1 - e : e;
    view.pos.copy(WALK.getPointAt(t));
    if (walking.reverse) {
      // walking out: look toward the mall, then back at the sign
      const ahead = WALK.getPointAt(clamp(t - 0.08, 0, 1)).clone(); ahead.y = 1.55;
      view.look.copy(ahead).lerp(new THREE.Vector3(0.4, 1.5, 12), smooth(clamp((e - 0.7) / 0.3, 0, 1)));
    } else view.look.copy(walkLook(t));
    const steps = e * WALK_SECONDS * 1.9;
    view.bob = Math.sin(steps * Math.PI * 2) * 0.022 * Math.sin(Math.PI * u);
    view.yaw *= 0.9; view.pitch *= 0.9;
    if (u >= 1) { const r = walking.resolve; walking = null; view.bob = 0; r(); }
  } else if (transition) {
    const u = clamp((now - transition.t0) / transition.dur, 0, 1), e = easeInOut(u);
    view.pos.lerpVectors(transition.from.pos, transition.to.pos, e);
    view.look.lerpVectors(transition.from.look, transition.to.look, e);
    view.yaw *= 0.9; view.pitch *= 0.9;
    if (u >= 1) { const r = transition.resolve; transition = null; r(); }
  } else {
    // free look relaxes nothing; keyboard held keys
    if (keys.has('ArrowLeft')) view.yaw = clamp(view.yaw + dt * 1.2, -view.yawLimit, view.yawLimit);
    if (keys.has('ArrowRight')) view.yaw = clamp(view.yaw - dt * 1.2, -view.yawLimit, view.yawLimit);
    if (keys.has('ArrowUp')) view.pitch = clamp(view.pitch + dt * 0.8, -view.pitchLimit, view.pitchLimit);
    if (keys.has('ArrowDown')) view.pitch = clamp(view.pitch - dt * 0.8, -view.pitchLimit, view.pitchLimit);
  }
  const dir = view.look.clone().sub(view.pos).normalize();
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), view.yaw);
  dir.applyQuaternion(yawQ);
  const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  dir.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(right, view.pitch));
  camera.position.copy(view.pos); camera.position.y += view.bob;
  camera.lookAt(camera.position.clone().add(dir));
  // shift the view so the shopkeeper stays visible beside / above the menu panel
  const wantX = (state === 'menu' && !isNarrow() && !$('#menu').classList.contains('overlay')) ? 0.2 : 0;
  const wantY = (state === 'menu' && isNarrow() && !$('#menu').classList.contains('overlay')) ? 0.26 : 0;
  view.shiftX = lerp(view.shiftX, wantX, 1 - Math.pow(0.001, dt)); view.shiftY = lerp(view.shiftY, wantY, 1 - Math.pow(0.001, dt));
  camera.setViewOffset(W(), H(), view.shiftX * W(), view.shiftY * H(), W(), H());
}

function updateKeeper(now, dt) {
  if (!keeper.group) return;
  keeper.t += dt;
  const k = keeper, t = k.t;
  k.group.position.y = Math.sin(t * 1.6) * 0.008;
  const greeting = k.mode === 'greet';
  const g = greeting ? clamp((now - k.greetStart) / 1400, 0, 1) : 0;
  const ge = easeInOut(g);
  // head: looks down at the tablet when idle, up at the visitor when greeting
  const headPos = new THREE.Vector3(); k.head.getWorldPosition(headPos);
  const toCam = camera.position.clone().sub(headPos);
  const yawTo = clamp(Math.atan2(toCam.x, toCam.z), -0.8, 0.8);
  const pitchTo = clamp(-Math.atan2(toCam.y, Math.hypot(toCam.x, toCam.z)), -0.5, 0.5);
  const idleYaw = Math.sin(t * 0.7) * 0.12, idlePitch = 0.42;
  k.head.rotation.y = lerp(idleYaw, yawTo, ge);
  k.head.rotation.x = lerp(idlePitch, pitchTo, ge);
  // right arm raises the tablet; tablet moves from held-low to presented
  k.armR.rotation.x = lerp(0.35, -1.25, ge);
  k.tablet.position.set(lerp(0.2, 0.26, ge), lerp(0.98, 1.3, ge), lerp(0.22, 0.46, ge));
  k.tablet.rotation.x = lerp(-1.25, -0.22, ge);
  k.tablet.rotation.y = lerp(0, yawTo * 0.6, ge);
  // left arm waves for the first moments of the greeting
  const waveT = greeting ? clamp((now - k.greetStart) / 1000, 0, 1) : 0;
  const waving = greeting && (now - k.greetStart) < 1900;
  const waveAmp = waving ? Math.sin(Math.PI * clamp((now - k.greetStart) / 1900, 0, 1)) : 0;
  k.armL.rotation.z = lerp(0.12, 2.6, waveAmp) ;
  k.armL.rotation.x = waveAmp * Math.sin(t * 14) * 0.35;
  k.mouth.scale.y = greeting && (now - k.greetStart) < 2600 ? 1 + Math.abs(Math.sin(t * 16)) * 1.6 : 1;
}

// ---------------------------------------------------------------------------
// HUD helpers
// ---------------------------------------------------------------------------
const keys = new Set();
const el = {
  hint: $('#hint'), outsideUI: $('#outside-ui'), exploreUI: $('#explore-ui'), hotspots: $('#hotspots'), bubble: $('#bubble'),
  spotCard: $('#spot-card'), spotTitle: $('#spot-title'), spotBody: $('#spot-body'), spotBrowse: $('#spot-browse'),
  menu: $('#menu'), tabs: $('#tabs'), menuBody: $('#menu-body'), skip: $('#skip'), outside: $('#outside'), voice: $('#voice'),
  seeMenu: $('#see-menu'), openMenu: $('#open-menu'), toCounter: $('#to-counter'), loading: $('#loading'), loadingText: $('#loading-text'),
};
const v2 = new THREE.Vector3();
function project(x, y, z) {
  v2.set(x, y, z).project(camera);
  return { x: (v2.x + 1) / 2 * W(), y: (1 - v2.y) / 2 * H(), front: v2.z < 1 && Math.abs(v2.x) < 1.05 && Math.abs(v2.y) < 1.05 };
}

function buildHotspotButtons() {
  el.hotspots.innerHTML = '';
  for (const h of HOTSPOTS) {
    const b = document.createElement('button'); b.className = 'spot'; b.textContent = h.label; b.dataset.id = h.id; b.hidden = true;
    b.addEventListener('click', () => goHotspot(h));
    el.hotspots.appendChild(b); h.btn = b;
  }
}
function updateHotspots() {
  const show = state === 'explore';
  for (const h of HOTSPOTS) {
    if (!show) { h.btn.hidden = true; continue; }
    const p = project(...h.at);
    h.btn.hidden = !p.front; h.btn.style.left = p.x + 'px'; h.btn.style.top = p.y + 'px';
  }
}
function updateBubble() {
  if (el.bubble.hidden) return;
  const p = project(KEEPER_HEAD.x, KEEPER_HEAD.y + 0.42, KEEPER_HEAD.z);
  el.bubble.style.left = clamp(p.x, 140, W() - 140) + 'px'; el.bubble.style.top = clamp(p.y, 130, H() - 40) + 'px';
  el.bubble.style.opacity = p.front ? 1 : 0;
}
function showHint(text) { el.hint.textContent = text; el.hint.classList.remove('off'); clearTimeout(showHint.t); showHint.t = setTimeout(() => el.hint.classList.add('off'), 3500); }

// ---------------------------------------------------------------------------
// Menu rendering (shared by the in-store panel and the direct view)
// ---------------------------------------------------------------------------
function renderMenu(tabsEl, bodyEl, activeId) {
  const cats = DATA.categories;
  const active = cats.find((c) => c.id === activeId) || cats[0];
  tabsEl.innerHTML = '';
  for (const c of cats) {
    const b = document.createElement('button'); b.className = 'tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(c === active)); b.textContent = c.name;
    b.addEventListener('click', () => renderMenu(tabsEl, bodyEl, c.id));
    tabsEl.appendChild(b);
  }
  bodyEl.innerHTML = '';
  const blurb = document.createElement('p'); blurb.className = 'cat-blurb'; blurb.textContent = active.blurb; bodyEl.appendChild(blurb);
  if (!active.items.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.innerHTML = `Products and prices for <b>${active.name}</b> are being added.<small>Ask at the counter for today's selection.</small>`;
    bodyEl.appendChild(e); return;
  }
  const grid = document.createElement('div'); grid.className = 'grid';
  for (const it of active.items) {
    const card = document.createElement('div'); card.className = 'item';
    if (it.photo) { const img = document.createElement('img'); img.src = it.photo; img.alt = it.name; img.loading = 'lazy'; card.appendChild(img); }
    else { const ph = document.createElement('div'); ph.className = 'ph'; card.appendChild(ph); }
    const meta = document.createElement('div'); meta.className = 'meta';
    const n = document.createElement('div'); n.className = 'name'; n.textContent = it.name; meta.appendChild(n);
    if (it.price) { const p = document.createElement('div'); p.className = 'price'; p.textContent = it.price; meta.appendChild(p); }
    if (it.note) { const p = document.createElement('div'); p.className = 'note'; p.textContent = it.note; meta.appendChild(p); }
    card.appendChild(meta); grid.appendChild(card);
  }
  bodyEl.appendChild(grid);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------
let stateBeforeMenu = 'outside';
function setState(s) {
  state = s;
  el.outsideUI.hidden = s !== 'outside';
  el.exploreUI.hidden = !(s === 'explore' || s === 'hotspot');
  el.toCounter.hidden = s !== 'hotspot';
  el.outside.hidden = !(s === 'explore' || s === 'hotspot' || s === 'menu' && stateBeforeMenu !== 'outside');
  el.skip.hidden = !(s === 'outside' || s === 'walking');
  if (s !== 'hotspot') el.spotCard.hidden = true;
  if (s === 'outside') setLimits(0.5, 0.22);
  if (s === 'explore') setLimits(1.3, 0.45);
  if (s === 'hotspot') setLimits(0.6, 0.35);
  if (s === 'menu') setLimits(0.25, 0.15);
}

async function enterStore() {
  if (state !== 'outside') return;
  setState('walking');
  el.hint.classList.add('off');
  await interiorReady;
  await walk(false);
  greet();
}
function greet() {
  setState('greeting');
  keeper.mode = 'greet'; keeper.greetStart = performance.now();
  el.bubble.textContent = STORE.greeting; el.bubble.hidden = false;
  if (voiceOn && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(STORE.greeting); u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); }
  setTimeout(() => { if (state === 'greeting') openMenu({ from: 'greeting' }); }, reduceMotion ? 200 : 1500);
}
function openMenu({ from = state, cat = null, overlay = false } = {}) {
  stateBeforeMenu = from === 'menu' ? stateBeforeMenu : from;
  renderMenu(el.tabs, el.menuBody, cat);
  el.menu.hidden = false; el.menu.classList.toggle('overlay', overlay);
  requestAnimationFrame(() => el.menu.classList.add('open'));
  setState('menu');
  el.menu.querySelector('.tab')?.focus({ preventScroll: true });
  clearTimeout(openMenu.bubbleT); openMenu.bubbleT = setTimeout(() => { el.bubble.hidden = true; }, 5000);
}
function closeMenu() {
  el.menu.classList.remove('open');
  setTimeout(() => { el.menu.hidden = true; }, 450);
  el.bubble.hidden = true;
  if (stateBeforeMenu === 'outside' || stateBeforeMenu === 'walking') { setState(stateBeforeMenu === 'walking' ? 'explore' : 'outside'); if (state === 'outside') showHint('Drag or swipe to look around'); return; }
  if (stateBeforeMenu === 'hotspot' && currentHotspot) { setState('hotspot'); el.spotCard.hidden = false; return; }
  setState('explore');
  showHint('Tap a marked spot, or look around');
}
async function goHotspot(h) {
  if (state !== 'explore') return;
  currentHotspot = h; setState('hotspot');
  await moveTo(new THREE.Vector3(...h.view.pos), new THREE.Vector3(...h.view.look), 1.7);
  const cat = DATA.categories.find((c) => c.id === h.cat);
  el.spotTitle.textContent = h.label;
  el.spotBody.textContent = cat ? cat.blurb : 'Chilled treats by the entrance.';
  el.spotBrowse.hidden = !cat; if (cat) el.spotBrowse.textContent = `Browse ${cat.name}`;
  el.spotBrowse.onclick = () => openMenu({ from: 'hotspot', cat: h.cat });
  el.spotCard.hidden = false;
}
async function backToCounter() {
  if (state !== 'hotspot') return;
  el.spotCard.hidden = true; currentHotspot = null; setState('explore');
  await moveTo(COUNTER.pos, COUNTER.look, 1.6);
}
async function backOutside() {
  if (state === 'menu') { el.menu.classList.remove('open'); el.menu.hidden = true; }
  el.bubble.hidden = true; el.spotCard.hidden = true; currentHotspot = null;
  setState('leaving');
  keeper.mode = 'idle';
  if (view.pos.distanceTo(COUNTER.pos) > 0.3) await moveTo(COUNTER.pos, new THREE.Vector3(0, 1.5, 2), 1.4);
  await walk(true);
  await moveTo(OUTSIDE.pos, OUTSIDE.look, 1.2);
  setState('outside'); showHint('Drag or swipe to look around');
}
function skipTour() {
  // Same menu, immediately. If a walk is in progress, finish it instantly at the counter.
  if (state === 'walking') { walking = null; view.pos.copy(COUNTER.pos); view.look.copy(COUNTER.look); keeper.mode = 'greet'; keeper.greetStart = performance.now() - 2000; openMenu({ from: 'walking', overlay: true }); return; }
  openMenu({ from: 'outside', overlay: true });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
let drag = null;
canvasEl.addEventListener('pointerdown', (e) => { if (walking || transition) return; drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; canvasEl.setPointerCapture(e.pointerId); canvasEl.focus({ preventScroll: true }); });
canvasEl.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const s = 2.2 / Math.max(W(), 400);
  view.yaw = clamp(drag.yaw + (e.clientX - drag.x) * s, -view.yawLimit, view.yawLimit);
  view.pitch = clamp(drag.pitch + (e.clientY - drag.y) * s * 0.8, -view.pitchLimit, view.pitchLimit);
});
const endDrag = () => { drag = null; };
canvasEl.addEventListener('pointerup', endDrag); canvasEl.addEventListener('pointercancel', endDrag);
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && state !== 'menu') { keys.add(e.key); e.preventDefault(); }
  if (e.key === 'Escape') { if (state === 'menu') closeMenu(); else if (state === 'hotspot') backToCounter(); }
  if ((e.key === 'Enter' || e.key === ' ') && state === 'outside' && e.target === canvasEl) { e.preventDefault(); enterStore(); }
});
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('blur', () => keys.clear());

let voiceOn = false;
el.voice.addEventListener('click', () => { voiceOn = !voiceOn; el.voice.setAttribute('aria-pressed', String(voiceOn)); el.voice.textContent = voiceOn ? 'Voice on' : 'Voice off'; if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel(); });
el.seeMenu.addEventListener('click', enterStore);
el.skip.addEventListener('click', skipTour);
el.outside.addEventListener('click', backOutside);
$('#menu-close').addEventListener('click', closeMenu);
el.openMenu.addEventListener('click', () => openMenu({ from: state, cat: currentHotspot?.cat || null }));
el.toCounter.addEventListener('click', backToCounter);

addEventListener('resize', () => { if (!renderer) return; renderer.setSize(W(), H(), false); camera.aspect = W() / H(); camera.updateProjectionMatrix(); });

// ---------------------------------------------------------------------------
// Direct (2D) menu view
// ---------------------------------------------------------------------------
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
function showFallback({ allow3D }) {
  $('#app').hidden = true; const fb = $('#fallback'); fb.hidden = false;
  $('#fb-tagline').textContent = STORE.tagline;
  renderMenu($('#fb-tabs'), $('#fb-body'));
  const enter = $('#fb-enter'); enter.hidden = !allow3D;
  enter.addEventListener('click', () => { fb.hidden = true; $('#app').hidden = false; start3D(); });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
let started = false;
async function start3D() {
  if (started) return; started = true;
  try { await Promise.race([document.fonts.load(`700 40px ${FONT}`), new Promise((r) => setTimeout(r, 1500))]); } catch {}
  makeRenderer(); materials(); buildExterior(); buildHotspotButtons();
  setState('outside');
  renderer.render(scene, camera);
  el.loading.classList.add('off');
  el.loadingText.textContent = 'Preparing the store…';
  // interior is built in the background right after the first frame so the walk never stops at the door
  interiorReady = new Promise((resolve) => setTimeout(() => { buildInterior(); resolve(); }, 60));
  showHint('Drag or swipe to look around');
  lastFrame = performance.now();
  renderer.setAnimationLoop(frame);
}
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  updateCamera(now, dt); updateKeeper(now, dt); updateHotspots(); updateBubble();
  renderer.render(scene, camera);
}

window.__exotic = { get state() { return state; }, view, walking: () => !!walking };
const forceMenu = new URLSearchParams(location.search).has('menu'); // ?menu opens the direct menu view
if (!webglOK()) showFallback({ allow3D: false });
else if (reduceMotion || forceMenu) showFallback({ allow3D: true });
else start3D();
