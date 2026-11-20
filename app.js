// Exotic Candy & Munchies - first-person 3D store (integration layer).
//
// Boot order: detect quality tier -> renderer -> environment -> materials -> exterior ->
// first frame -> interior + shopkeeper in the background -> post-processing.
// The state machine, camera walk, HUD, menu and hotspots live here; the rendering stack is
// scene/env.js + scene/textures.js, the store geometry is scene/store.js + scene/props.js and
// the rigged shopkeeper is scene/human.js. See docs/ARCHITECTURE.md.
//
// No menu, price or inventory is invented: everything comes from menu.js.

import * as THREE from 'three';
import { detectTier, QUALITY, createRenderer, setupEnvironment, addLights, materials, createPost } from './scene/env.js';
import { makeTextures, ensureFonts } from './scene/textures.js';
import { buildExterior, buildInterior } from './scene/store.js';
import { loadShopkeeper } from './scene/human.js';

const DATA = window.EXOTIC_MENU;
const STORE = DATA.store;
const $ = (s) => document.querySelector(s);

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => innerWidth < 900;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const canvasEl = $('#c');
let renderer, scene, camera, post, M, lights, keeper = null;
let tierName = 'high';
const TIER_ORDER = ['ultra', 'high', 'medium', 'low'];
const W = () => innerWidth, H = () => innerHeight;

const tierObj = (name) => ({ name, ...QUALITY[name] });
// 50 deg vertical in landscape; in portrait keep a ~65 deg horizontal field so the storefront fits.
function applyFov() {
  const aspect = W() / H();
  camera.aspect = aspect;
  camera.fov = aspect >= 1 ? 50 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(65) / 2) / aspect));
  camera.updateProjectionMatrix();
}
function makeScene() {
  const forced = new URLSearchParams(location.search).get('tier');
  tierName = QUALITY[forced] ? forced : detectTier();
  const tier = tierObj(tierName);
  renderer = createRenderer(canvasEl, tier);
  renderer.setSize(W(), H(), false);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, W() / H(), 0.1, 60);
  applyFov();
  setupEnvironment(renderer, scene, tier);
  const T = makeTextures(7, { maxSize: tier.maxSize });
  M = materials(T, tier);
  lights = addLights(scene, tier);
  buildExterior(scene, M);
}

async function buildRest() {
  const tier = tierObj(tierName);
  buildInterior(scene, M, tier);
  const sk = DATA.shopkeeper || {};
  try {
    keeper = await loadShopkeeper({
      scene,
      position: new THREE.Vector3(-0.3, 0, -10.75),
      rotationY: 0,
      avatarUrl: sk.avatarUrl || 'assets/keeper.glb',
      atlasUrl: sk.avatarUrl ? null : (sk.atlasUrl || 'assets/keeper_atlas.png'),
      animBase: 'assets/anim/',
      tabletMaterial: M.tablet,
    });
  } catch (e) {
    console.warn('shopkeeper failed to load', e);
  }
  lights?.refreshShadows?.();
  // compile every material once now so the walk does not stutter on first-seen shaders
  try { await renderer.compileAsync(scene, camera); } catch {}
}

function makePost() {
  post = createPost(renderer, scene, camera, tierObj(tierName));
}

// Adaptive quality: average frame time over 3 s windows (ignoring the first seconds and any
// window with a hitch); two slow windows in a row step down one tier. Stepping down only
// changes pixel ratio and post passes, never shadows or light counts (those would recompile).
const perf = { acc: 0, n: 0, since: 0, slow: 0, warm: 0, hitch: false, settled: false };
function governor(dt) {
  if (tierName === 'low' || perf.settled) return;
  if (perf.warm < 3) { perf.warm += dt; return; }
  if (dt > 0.1) perf.hitch = true;
  perf.acc += dt; perf.n++; perf.since += dt;
  if (perf.since < 3) return;
  const avg = perf.acc / perf.n, hitch = perf.hitch;
  perf.acc = 0; perf.n = 0; perf.since = 0; perf.hitch = false;
  if (hitch) return;
  if (avg > 0.022) {
    if (++perf.slow >= 2) {
      perf.slow = 0;
      const next = TIER_ORDER[Math.min(TIER_ORDER.indexOf(tierName) + 1, TIER_ORDER.length - 1)];
      if (next !== tierName) setTier(next);
    }
  } else perf.settled = true; // fast enough: lock it in
}
function setTier(name) {
  tierName = name;
  const tier = tierObj(name);
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, tier.pixelRatio));
  post?.setTier(tier);
  post?.setSize(W(), H());
}

// ---------------------------------------------------------------------------
// Camera, states and animation
// ---------------------------------------------------------------------------
const KEEPER_HEAD = new THREE.Vector3(-0.3, 1.7, -10.75); // refreshed from the rig's Head bone once loaded
const OUTSIDE = { pos: new THREE.Vector3(0.4, 1.62, 5.2), look: new THREE.Vector3(0, 2.25, 0) };
const COUNTER = { pos: new THREE.Vector3(-0.2, 1.62, -8.3), look: KEEPER_HEAD.clone() };
const WALK = new THREE.CatmullRomCurve3([
  [0.4, 1.62, 5.2], [0.25, 1.62, 3.0], [0.05, 1.62, 1.0], [-0.05, 1.62, -1.8], [-0.15, 1.62, -5.0], [-0.2, 1.62, -8.3],
].map((p) => new THREE.Vector3(...p)), false, 'centripetal');
const WALK_SECONDS = 8.5;

const HOTSPOTS = [
  { id: 'candy', label: 'Candy shelves', cat: 'candy', at: [-3.6, 1.5, -7.2], view: { pos: [-1.8, 1.62, -6.6], look: [-3.9, 1.2, -7.4] } },
  { id: 'new', label: 'New arrivals', cat: 'new', at: [-1.4, 1.2, -3.2], view: { pos: [0.1, 1.62, -1.9], look: [-1.5, 0.85, -3.3] } },
  { id: 'snacks', label: 'Snack aisle', cat: 'snacks', at: [1.4, 1.2, -5.8], view: { pos: [-0.2, 1.62, -4.3], look: [1.5, 0.85, -6.0] } },
  { id: 'drinks', label: 'Drink cooler', cat: 'drinks', at: [3.3, 1.6, -9.3], view: { pos: [0.6, 1.62, -8.4], look: [3.9, 1.2, -9.3] } },
  { id: 'freezer', label: 'Freezer', cat: null, at: [-3.3, 1.1, -1.6], view: { pos: [-1.6, 1.62, -1.0], look: [-3.7, 0.7, -1.7] } },
];

let state = 'outside'; // outside | walking | greeting | menu | explore | hotspot | leaving
const view = { pos: OUTSIDE.pos.clone(), look: OUTSIDE.look.clone(), yaw: 0, pitch: 0, yawLimit: 0.5, pitchLimit: 0.22, shiftX: 0, shiftY: 0, bob: 0, sway: 0 };
let transition = null;
let walking = null;
let currentHotspot = null;
let interiorReady = null, interiorDone = false, wasInside = false;
let lastFrame = performance.now();

// scratch vectors (no per-frame allocation)
const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const _lookA = new THREE.Vector3(0, 2.3, 0.4), _lookB = new THREE.Vector3(0.2, 1.45, -6.5), _tmp = new THREE.Vector3(), _tmp2 = new THREE.Vector3();

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
function walkLook(t, out) {
  if (keeper) keeper.headPosition(KEEPER_HEAD);
  if (t < 0.18) return out.copy(_lookA);
  if (t < 0.45) return out.copy(_lookA).lerp(_lookB, smooth((t - 0.18) / 0.27));
  if (t < 0.8) return out.copy(_lookB).lerp(KEEPER_HEAD, smooth((t - 0.45) / 0.35));
  return out.copy(KEEPER_HEAD);
}

function updateCamera(now, dt) {
  if (walking) {
    const u = clamp((now - walking.t0) / walking.dur, 0, 1);
    const e = easeInOut(u);
    const t = walking.reverse ? 1 - e : e;
    WALK.getPointAt(t, view.pos);
    if (walking.reverse) {
      WALK.getPointAt(clamp(t - 0.08, 0, 1), _tmp); _tmp.y = 1.55;
      _tmp2.set(0.4, 1.5, 12);
      view.look.copy(_tmp).lerp(_tmp2, smooth(clamp((e - 0.7) / 0.3, 0, 1)));
    } else walkLook(t, view.look);
    // gait: ~1.9 steps per second, vertical bob plus a little lateral sway and roll
    const steps = e * WALK_SECONDS * 1.9;
    const env = Math.sin(Math.PI * u);
    view.bob = Math.sin(steps * Math.PI * 2) * 0.006 * env;
    view.sway = Math.sin(steps * Math.PI) * 0.006 * env;
    view.yaw *= 0.9; view.pitch *= 0.9;
    if (u >= 1) { const r = walking.resolve; walking = null; view.bob = 0; view.sway = 0; r(); }
  } else if (transition) {
    const u = clamp((now - transition.t0) / transition.dur, 0, 1), e = easeInOut(u);
    view.pos.lerpVectors(transition.from.pos, transition.to.pos, e);
    view.look.lerpVectors(transition.from.look, transition.to.look, e);
    view.yaw *= 0.9; view.pitch *= 0.9;
    if (u >= 1) { const r = transition.resolve; transition = null; r(); }
  } else {
    if (keys.has('ArrowLeft')) view.yaw = clamp(view.yaw + dt * 1.2, -view.yawLimit, view.yawLimit);
    if (keys.has('ArrowRight')) view.yaw = clamp(view.yaw - dt * 1.2, -view.yawLimit, view.yawLimit);
    if (keys.has('ArrowUp')) view.pitch = clamp(view.pitch + dt * 0.8, -view.pitchLimit, view.pitchLimit);
    if (keys.has('ArrowDown')) view.pitch = clamp(view.pitch - dt * 0.8, -view.pitchLimit, view.pitchLimit);
    if ((state === 'greeting' || state === 'menu') && keeper) { keeper.headPosition(KEEPER_HEAD); view.look.lerp(KEEPER_HEAD, 1 - Math.pow(0.02, dt)); }
  }
  const inside = view.pos.z < 0.3;
  if (inside !== wasInside) { wasInside = inside; lights?.setInterior?.(inside); }
  _dir.copy(view.look).sub(view.pos).normalize();
  _q.setFromAxisAngle(_up, view.yaw); _dir.applyQuaternion(_q);
  _right.crossVectors(_dir, _up).normalize();
  _q.setFromAxisAngle(_right, view.pitch); _dir.applyQuaternion(_q);
  camera.position.copy(view.pos).addScaledVector(_right, view.sway);
  camera.position.y += view.bob;
  _tmp.copy(camera.position).add(_dir);
  camera.lookAt(_tmp);
  camera.rotation.z += view.sway * 0.4;
  const overlay = $('#menu').classList.contains('overlay');
  const wantX = (state === 'menu' && !isNarrow() && !overlay) ? 0.2 : 0;
  const wantY = (state === 'menu' && isNarrow() && !overlay) ? 0.26 : 0;
  const k = 1 - Math.pow(0.001, dt);
  view.shiftX = lerp(view.shiftX, wantX, k); view.shiftY = lerp(view.shiftY, wantY, k);
  camera.setViewOffset(W(), H(), view.shiftX * W(), view.shiftY * H(), W(), H());
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
    const p = project(h.at[0], h.at[1], h.at[2]);
    h.btn.hidden = !p.front; h.btn.style.left = p.x + 'px'; h.btn.style.top = p.y + 'px';
  }
}
function updateBubble() {
  if (el.bubble.hidden) return;
  if (keeper) keeper.headPosition(KEEPER_HEAD);
  const p = project(KEEPER_HEAD.x, KEEPER_HEAD.y + 0.3, KEEPER_HEAD.z);
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
  if (s === 'greeting') setLimits(0.2, 0.12);
}

async function enterStore() {
  if (state !== 'outside') return;
  setState('walking');
  el.hint.classList.add('off');
  if (!interiorDone) { el.seeMenu.textContent = 'Preparing…'; el.seeMenu.disabled = true; }
  await interiorReady;
  el.seeMenu.textContent = 'See menu'; el.seeMenu.disabled = false;
  await walk(false);
  greet();
}
function greet() {
  setState('greeting');
  keeper?.setMode('greet');
  el.bubble.textContent = STORE.greeting; el.bubble.hidden = false;
  keeper?.talk(2600);
  if (voiceOn && 'speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(STORE.greeting); u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); }
  setTimeout(() => { if (state === 'greeting') { keeper?.setMode('present'); openMenu({ from: 'greeting' }); } }, reduceMotion ? 200 : 1900);
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
  keeper?.setMode('idle');
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
  keeper?.setMode('idle');
  if (view.pos.distanceTo(COUNTER.pos) > 0.3) await moveTo(COUNTER.pos, new THREE.Vector3(0, 1.5, 2), 1.4);
  await walk(true);
  await moveTo(OUTSIDE.pos, OUTSIDE.look, 1.2);
  setState('outside'); showHint('Drag or swipe to look around');
}
function skipTour() {
  if (state === 'walking') { walking = null; view.bob = 0; view.sway = 0; view.pos.copy(COUNTER.pos); view.look.copy(COUNTER.look); keeper?.setMode('present'); openMenu({ from: 'walking', overlay: true }); return; }
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
el.openMenu.addEventListener('click', () => { keeper?.setMode('present'); openMenu({ from: state, cat: currentHotspot?.cat || null }); });
el.toCounter.addEventListener('click', backToCounter);

addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(W(), H(), false); applyFov();
  post?.setSize(W(), H());
});

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
  try { await Promise.race([ensureFonts(), new Promise((r) => setTimeout(r, 2500))]); } catch {}
  makeScene(); buildHotspotButtons();
  setState('outside');
  updateCamera(performance.now(), 0.016);
  renderer.render(scene, camera);
  el.loading.classList.add('off');
  interiorReady = new Promise((resolve) => setTimeout(async () => { try { await buildRest(); } finally { makePost(); interiorDone = true; resolve(); } }, 40));
  canvasEl.addEventListener('webglcontextlost', (e) => { e.preventDefault(); renderer.setAnimationLoop(null); showFallback({ allow3D: false }); });
  showHint('Drag or swipe to look around');
  lastFrame = performance.now();
  renderer.setAnimationLoop(frame);
}
function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000); lastFrame = now;
  updateCamera(now, dt);
  keeper?.update(dt, camera);
  updateHotspots(); updateBubble();
  if (post) post.render(dt); else renderer.render(scene, camera);
  governor(dt);
}

window.__exotic = { get state() { return state; }, view, get tier() { return tierName; }, walking: () => !!walking, get keeper() { return keeper; }, get renderer() { return renderer; }, get scene() { return scene; }, setTier };
const forceMenu = new URLSearchParams(location.search).has('menu'); // ?menu opens the direct menu view
if (!webglOK()) showFallback({ allow3D: false });
else if (reduceMotion || forceMenu) showFallback({ allow3D: true });
else start3D();
