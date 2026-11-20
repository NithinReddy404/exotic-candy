// Exotic Candy & Munchies - first-person 3D store (integration layer).
//
// Boot order: detect quality tier -> renderer -> environment -> materials -> exterior ->
// first frame -> catalog + photo atlas + interior + shopkeeper in the background -> post stack.
// The state machine, camera walk, HUD, menu, product cards and hotspots live here; the
// rendering stack is scene/env.js + scene/textures.js, the store geometry is scene/store.js +
// scene/props.js, the catalog is scene/catalog.js and the shopkeeper is scene/human.js.
//
// Every product, price, photo and origin comes from data/products.json, a snapshot of the
// store's own site; prices on product cards are re-fetched live when a card opens.

import * as THREE from 'three';
import { detectTier, QUALITY, createRenderer, setupEnvironment, addLights, materials, createPost } from './scene/env.js';
import { makeTextures, ensureFonts } from './scene/textures.js';
import { buildExterior, buildInterior } from './scene/store.js';
import { loadShopkeeper } from './scene/human.js';
import { loadCatalog, selectFeatured, buildAtlas, livePrice, imageUrl, productUrl, flagFor, categoryLabel } from './scene/catalog.js';

const DATA = window.EXOTIC_MENU;
const STORE = DATA.store;
const $ = (s) => document.querySelector(s);

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isNarrow = () => innerWidth < 900;
const isCoarse = matchMedia('(pointer: coarse)').matches;
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const canvasEl = $('#c');
let renderer, scene, camera, post, M, lights, keeper = null, batches = null, catalog = null, atlas = null, atlasLoading = false;
let tierName = 'high';
const TIER_ORDER = ['ultra', 'high', 'medium', 'low'];
const W = () => innerWidth, H = () => innerHeight;
const tierObj = (name) => ({ name, ...QUALITY[name] });

// 50 deg vertical in landscape; in portrait keep a ~62 deg horizontal field so the storefront fits.
function applyFov() {
  const aspect = W() / H();
  camera.aspect = aspect;
  camera.fov = aspect >= 1 ? 50 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(62) / 2) / aspect));
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
  const envReady = setupEnvironment(renderer, scene, tier);
  const T = makeTextures(7, { maxSize: tier.maxSize });
  M = materials(T, tier);
  lights = addLights(scene, tier);
  buildExterior(scene, M);
  return envReady;
}

async function buildRest() {
  const tier = tierObj(tierName);
  // catalog first: the shelves are built from it
  try {
    catalog = await loadCatalog('data/products.json');
    const cells = 16;
    const items = selectFeatured(catalog, cells);
    atlas = buildAtlas(items, catalog, { size: (tierName === 'ultra' || tierName === 'high') ? 4096 : 2048, cells, onProgress: (d, n) => setLoadNote(d < n ? `Stocking shelves ${Math.round(d / n * 100)}%` : '') });
    atlasLoading = true; atlas.ready.then(() => { atlasLoading = false; });
  } catch (e) { console.warn('catalog unavailable, shelves use generated packaging', e); }
  const built = buildInterior(scene, M, tier, atlas ? { catalog: atlas } : {});
  batches = built?.batches || null;
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
  } catch (e) { console.warn('shopkeeper failed to load', e); }
  lights?.refreshShadows?.();
  try { await renderer.compileAsync(scene, camera); } catch {}
  buildMenu();
}
function makePost() { post = createPost(renderer, scene, camera, tierObj(tierName)); }

// Adaptive quality: average frame time over 3 s windows (ignoring warm-up and hitches); two slow
// windows in a row step down one tier. Stepping down only changes pixel ratio and post passes.
const perf = { acc: 0, n: 0, since: 0, slow: 0, warm: 0, hitch: false, settled: false };
function governor(dt) {
  if (tierName === 'low' || perf.settled) return;
  if (!interiorDone || atlasLoading) { perf.warm = 0; return; } // texture uploads during stocking are not representative
  if (perf.warm < 4) { perf.warm += dt; return; }
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
  } else perf.settled = true;
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
// The visit starts right at the entrance, on the mat, facing the sign.
const START = { pos: new THREE.Vector3(0.3, 1.62, 4.4), look: new THREE.Vector3(0, 2.0, 0) };
const COUNTER = { pos: new THREE.Vector3(-0.2, 1.62, -8.3), look: KEEPER_HEAD.clone() };
const WALK = new THREE.CatmullRomCurve3([
  [0.3, 1.62, 4.4], [0.15, 1.62, 2.2], [0.0, 1.62, -0.2], [-0.05, 1.62, -2.6], [-0.15, 1.62, -5.2], [-0.2, 1.62, -8.3],
].map((p) => new THREE.Vector3(...p)), false, 'centripetal');
const WALK_SECONDS = 8;

const HOTSPOTS = [
  { id: 'candy', label: 'Candy shelves', cat: 'candy', at: [-3.6, 1.5, -7.2], view: { pos: [-1.8, 1.62, -6.6], look: [-3.9, 1.2, -7.4] } },
  { id: 'new', label: 'New arrivals', cat: 'new', at: [1.4, 1.2, -5.8], view: { pos: [-0.2, 1.62, -4.3], look: [1.5, 0.85, -6.0] } },
  { id: 'chips', label: 'Chips & cookies', cat: 'chips', at: [3.6, 1.5, -3.5], view: { pos: [1.7, 1.62, -2.6], look: [3.9, 1.2, -3.8] } },
  { id: 'drinks', label: 'Drink cooler', cat: 'drinks', at: [3.3, 1.6, -9.3], view: { pos: [0.6, 1.62, -8.4], look: [3.9, 1.2, -9.3] } },
  { id: 'freezer', label: 'Freezer', cat: null, at: [-3.3, 1.1, -1.6], view: { pos: [-1.6, 1.62, -1.0], look: [-3.7, 0.7, -1.7] } },
];

let state = 'outside'; // outside | walking | greeting | menu | explore | hotspot
const view = { pos: START.pos.clone(), look: START.look.clone(), yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, yawLimit: 0.5, pitchLimit: 0.22, shiftX: 0, shiftY: 0, bob: 0, sway: 0 };
let transition = null;
let walking = null;
let currentHotspot = null;
let interiorReady = null, interiorDone = false, wasInside = false;
let lastFrame = performance.now();

const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const _lookA = new THREE.Vector3(0, 2.1, 0.2), _lookB = new THREE.Vector3(0.2, 1.45, -6.5), _tmp = new THREE.Vector3();

function setLimits(yaw, pitch) { view.yawLimit = yaw; view.pitchLimit = pitch; }
function moveTo(pos, look, dur) {
  return new Promise((resolve) => {
    if (reduceMotion || dur <= 0) { view.pos.copy(pos); view.look.copy(look); view.yaw = view.pitch = 0; resolve(); return; }
    transition = { from: { pos: view.pos.clone(), look: view.look.clone() }, to: { pos: pos.clone(), look: look.clone() }, t0: performance.now(), dur: dur * 1000, resolve };
  });
}
function walk() {
  return new Promise((resolve) => {
    if (reduceMotion) { view.pos.copy(COUNTER.pos); view.look.copy(COUNTER.look); resolve(); return; }
    walking = { t0: performance.now(), dur: WALK_SECONDS * 1000, resolve };
  });
}
function walkLook(t, out) {
  if (keeper) keeper.headPosition(KEEPER_HEAD);
  if (t < 0.15) return out.copy(_lookA);
  if (t < 0.42) return out.copy(_lookA).lerp(_lookB, smooth((t - 0.15) / 0.27));
  if (t < 0.8) return out.copy(_lookB).lerp(KEEPER_HEAD, smooth((t - 0.42) / 0.38));
  return out.copy(KEEPER_HEAD);
}

function updateCamera(now, dt) {
  if (walking) {
    const u = clamp((now - walking.t0) / walking.dur, 0, 1);
    const e = easeInOut(u);
    WALK.getPointAt(e, view.pos);
    walkLook(e, view.look);
    const steps = e * WALK_SECONDS * 1.9;
    const env = Math.sin(Math.PI * u);
    view.bob = Math.sin(steps * Math.PI * 2) * 0.006 * env;
    view.sway = Math.sin(steps * Math.PI) * 0.006 * env;
    view.yaw *= 0.9; view.pitch *= 0.9; view.vyaw = view.vpitch = 0;
    if (u >= 1) { const r = walking.resolve; walking = null; view.bob = 0; view.sway = 0; r(); }
  } else if (transition) {
    const u = clamp((now - transition.t0) / transition.dur, 0, 1), e = easeInOut(u);
    view.pos.lerpVectors(transition.from.pos, transition.to.pos, e);
    view.look.lerpVectors(transition.from.look, transition.to.look, e);
    view.yaw *= 0.9; view.pitch *= 0.9; view.vyaw = view.vpitch = 0;
    if (u >= 1) { const r = transition.resolve; transition = null; r(); }
  } else {
    if (keys.has('ArrowLeft')) view.vyaw = 1.2;
    if (keys.has('ArrowRight')) view.vyaw = -1.2;
    if (keys.has('ArrowUp')) view.vpitch = 0.8;
    if (keys.has('ArrowDown')) view.vpitch = -0.8;
    if (!drag) {
      // inertia after a swipe, with soft limits
      view.yaw = clamp(view.yaw + view.vyaw * dt, -view.yawLimit, view.yawLimit);
      view.pitch = clamp(view.pitch + view.vpitch * dt, -view.pitchLimit, view.pitchLimit);
      const damp = Math.pow(0.02, dt);
      view.vyaw *= damp; view.vpitch *= damp;
    }
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
  const overlay = el.menu.classList.contains('overlay');
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
  menu: $('#menu'), tabs: $('#tabs'), menuBody: $('#menu-body'), search: $('#search'), skip: $('#skip'), outside: $('#outside'), voice: $('#voice'),
  seeMenu: $('#see-menu'), openMenu: $('#open-menu'), toCounter: $('#to-counter'), loading: $('#loading'), loadingText: $('#loading-text'),
  tooltip: $('#tooltip'), product: $('#product'), fade: $('#fade'), loadNote: $('#load-note'),
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
function setLoadNote(text) { el.loadNote.textContent = text; el.loadNote.hidden = !text; }
async function fadeThrough(fn) {
  if (reduceMotion) { fn(); return; }
  el.fade.classList.add('on');
  await new Promise((r) => setTimeout(r, 320));
  fn();
  await new Promise((r) => setTimeout(r, 60));
  el.fade.classList.remove('on');
}

// ---------------------------------------------------------------------------
// Product picking: hover tooltip and click card, with the live price from the store
// ---------------------------------------------------------------------------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null, hoveredKey = '', lastPick = 0;
function pickAt(cx, cy) {
  if (!batches?.pick) return null;
  ndc.set((cx / W()) * 2 - 1, -(cy / H()) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  ray.far = 4.5;
  const hit = batches.pick(ray);
  return hit && hit.item?.product ? hit : null;
}
function canPick() { return (state === 'explore' || state === 'hotspot' || state === 'outside') && !walking && !transition; }
function hoverAt(cx, cy) {
  const hit = canPick() ? pickAt(cx, cy) : null;
  const item = hit?.item || null;
  const key = hit ? `${hit.mesh?.id}:${hit.instanceId}` : '';
  if (key !== hoveredKey) { hoveredKey = key; hovered = item; batches?.highlight?.(hit || null); canvasEl.style.cursor = item ? 'pointer' : ''; }
  if (item) {
    const p = item.product;
    el.tooltip.innerHTML = `<b>${esc(p.title)}</b><span>$${esc(p.price)}${p.origin ? ' · ' + flagFor(p.origin) + ' ' + esc(p.origin) : ''}</span>`;
    el.tooltip.hidden = false;
    el.tooltip.style.left = clamp(cx + 14, 8, W() - 240) + 'px';
    el.tooltip.style.top = clamp(cy - 10, 8, H() - 60) + 'px';
  } else el.tooltip.hidden = true;
}
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

let cardToken = 0;
function openProduct(p) {
  if (!p) return;
  const token = ++cardToken;
  const img = imageUrl(catalog, p, 600);
  const origin = p.origin ? `${flagFor(p.origin)} From ${esc(p.origin)}` : 'Origin not listed';
  const cats = (p.cats || []).filter((c) => c !== 'new' && c !== 'mystery').map(categoryLabel).join(' · ');
  el.product.innerHTML = `
    <button class="ghost close" id="product-close" aria-label="Close">Close</button>
    <div class="p-img">${img ? `<img src="${esc(img)}" alt="${esc(p.title)}">` : '<div class="ph"></div>'}</div>
    <div class="p-body">
      <div class="p-cat">${esc(cats || p.type || '')}${p.cats?.includes('new') ? ' <span class="tag">New</span>' : ''}</div>
      <h2 class="p-title">${esc(p.title)}</h2>
      <div class="p-price"><span id="p-price">$${esc(p.price)}</span>${p.compare ? ` <s>$${esc(p.compare)}</s>` : ''} <span class="live" id="p-live">checking live price…</span></div>
      <div class="p-origin">${origin}${p.grams ? ` · ${p.grams} g` : ''}</div>
      ${p.desc ? `<p class="p-desc">${esc(p.desc)}${p.desc.length >= 160 ? '…' : ''}</p>` : ''}
      <div class="p-actions">
        <a class="primary small" href="${esc(productUrl(catalog, p))}" target="_blank" rel="noopener">Buy on exoticsnackguys.com</a>
        <span class="avail ${p.available ? 'in' : 'out'}" id="p-avail">${p.available ? 'In stock' : 'Sold out'}</span>
      </div>
    </div>`;
  el.product.hidden = false;
  requestAnimationFrame(() => el.product.classList.add('open'));
  $('#product-close').addEventListener('click', closeProduct);
  el.tooltip.hidden = true;
  livePrice(catalog, p).then((live) => {
    if (token !== cardToken) return;
    const lv = $('#p-live');
    if (!lv) return;
    if (!live) { lv.textContent = 'price as of last sync'; return; }
    $('#p-price').textContent = '$' + live.price;
    lv.textContent = 'live price'; lv.classList.add('ok');
    const av = $('#p-avail'); av.textContent = live.available ? 'In stock' : 'Sold out'; av.className = 'avail ' + (live.available ? 'in' : 'out');
  });
}
function closeProduct() { el.product.classList.remove('open'); setTimeout(() => { el.product.hidden = true; }, 250); }

// ---------------------------------------------------------------------------
// Menu: the real catalog, by category, with search
// ---------------------------------------------------------------------------
let menuCat = null, menuQuery = '';
function buildMenu() {
  if (!catalog) { renderMenuFallback(); return; }
  el.search.hidden = false;
  el.search.oninput = () => { menuQuery = el.search.value.trim().toLowerCase(); renderMenuBody(); };
  renderTabs();
  renderMenuBody();
}
function renderTabs() {
  el.tabs.innerHTML = '';
  const cats = catalog.categories.filter((c) => c.key !== 'mystery');
  if (!menuCat || !cats.some((c) => c.key === menuCat)) menuCat = cats[0]?.key || null;
  for (const c of cats) {
    const b = document.createElement('button'); b.className = 'tab'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(c.key === menuCat));
    b.innerHTML = `${esc(c.label)} <small>${c.count}</small>`;
    b.addEventListener('click', () => { menuCat = c.key; renderTabs(); renderMenuBody(); });
    el.tabs.appendChild(b);
  }
}
function renderMenuBody() {
  const body = el.menuBody; body.innerHTML = '';
  let list;
  if (menuQuery) list = catalog.products.filter((p) => p.title.toLowerCase().includes(menuQuery) || (p.origin || '').toLowerCase().includes(menuQuery));
  else list = catalog.products.filter((p) => p.cats.includes(menuCat));
  const head = document.createElement('p'); head.className = 'cat-blurb';
  head.textContent = menuQuery ? `${list.length} result${list.length === 1 ? '' : 's'} for "${menuQuery}"` : `${list.length} products · tap one for the live price and where it is from`;
  body.appendChild(head);
  if (!list.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Nothing matches.'; body.appendChild(e); return; }
  const grid = document.createElement('div'); grid.className = 'grid';
  const frag = document.createDocumentFragment();
  for (const p of list) {
    const card = document.createElement('button'); card.className = 'item'; card.type = 'button';
    const img = imageUrl(catalog, p, 200);
    card.innerHTML = `${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="meta"><div class="name">${esc(p.title)}</div><div class="price">$${esc(p.price)}${p.compare ? ` <s>$${esc(p.compare)}</s>` : ''}</div>
      <div class="note">${p.origin ? flagFor(p.origin) + ' ' + esc(p.origin) : ''}${p.available ? '' : ' · sold out'}</div></div>`;
    card.addEventListener('click', () => openProduct(p));
    frag.appendChild(card);
  }
  grid.appendChild(frag); body.appendChild(grid);
}
function renderMenuFallback() {
  // catalog missing: show the static categories from menu.js
  const cats = DATA.categories; const active = cats.find((c) => c.id === menuCat) || cats[0];
  el.tabs.innerHTML = '';
  for (const c of cats) { const b = document.createElement('button'); b.className = 'tab'; b.setAttribute('aria-selected', String(c === active)); b.textContent = c.name; b.addEventListener('click', () => { menuCat = c.id; renderMenuFallback(); }); el.tabs.appendChild(b); }
  el.menuBody.innerHTML = `<p class="cat-blurb">${esc(active.blurb)}</p><div class="empty">The product list could not be loaded.<small>Run scripts/sync_products.py to refresh data/products.json.</small></div>`;
}
function openMenuAt(cat) {
  if (cat && catalog?.categories.some((c) => c.key === cat)) { menuCat = cat; menuQuery = ''; el.search.value = ''; renderTabs(); renderMenuBody(); }
  else if (!catalog) { menuCat = cat; renderMenuFallback(); }
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
  if (s === 'outside') setLimits(0.55, 0.25);
  if (s === 'explore') setLimits(1.3, 0.45);
  if (s === 'hotspot') setLimits(0.7, 0.4);
  if (s === 'menu') setLimits(0.25, 0.15);
  if (s === 'greeting') setLimits(0.2, 0.12);
  if (s !== 'explore' && s !== 'hotspot') { el.tooltip.hidden = true; if (hovered) { hovered = null; hoveredKey = ''; batches?.highlight?.(null); } }
}
async function enterStore() {
  if (state !== 'outside') return;
  setState('walking');
  el.hint.classList.add('off');
  if (!interiorDone) { el.seeMenu.textContent = 'Preparing…'; el.seeMenu.disabled = true; }
  await interiorReady;
  el.seeMenu.textContent = 'See menu'; el.seeMenu.disabled = false;
  if (state !== 'walking') return;
  await walk();
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
  openMenuAt(cat);
  el.menu.hidden = false; el.menu.classList.toggle('overlay', overlay);
  requestAnimationFrame(() => el.menu.classList.add('open'));
  setState('menu');
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
  showHint(isCoarse ? 'Tap a product or a marked spot' : 'Point at a product, or tap a marked spot');
}
async function goHotspot(h) {
  if (state !== 'explore') return;
  currentHotspot = h; setState('hotspot');
  await moveTo(new THREE.Vector3(...h.view.pos), new THREE.Vector3(...h.view.look), 1.7);
  const c = catalog?.categories.find((x) => x.key === h.cat);
  el.spotTitle.textContent = h.label;
  el.spotBody.textContent = c ? `${c.count} ${c.label.toLowerCase()} products. Tap any package for its price and where it is from.` : 'Chilled treats by the entrance.';
  el.spotBrowse.hidden = !h.cat; if (h.cat) el.spotBrowse.textContent = `Browse ${c ? c.label : h.label}`;
  el.spotBrowse.onclick = () => openMenu({ from: 'hotspot', cat: h.cat });
  el.spotCard.hidden = false;
}
async function backToCounter() {
  if (state !== 'hotspot') return;
  el.spotCard.hidden = true; currentHotspot = null; setState('explore');
  await moveTo(COUNTER.pos, COUNTER.look, 1.6);
}
// "Start over": straight back to the entrance where we came from, no walk-out.
async function startOver() {
  if (state === 'menu') { el.menu.classList.remove('open'); el.menu.hidden = true; }
  el.bubble.hidden = true; el.spotCard.hidden = true; currentHotspot = null; closeProduct();
  keeper?.setMode('idle');
  await fadeThrough(() => { walking = null; transition = null; view.pos.copy(START.pos); view.look.copy(START.look); view.yaw = view.pitch = view.vyaw = view.vpitch = 0; setState('outside'); });
  showHint('Drag or swipe to look around');
}
function skipTour() {
  if (state === 'walking') { walking = null; view.bob = 0; view.sway = 0; view.pos.copy(COUNTER.pos); view.look.copy(COUNTER.look); keeper?.setMode('present'); openMenu({ from: 'walking', overlay: true }); return; }
  openMenu({ from: 'outside', overlay: true });
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
let drag = null;
canvasEl.addEventListener('pointerdown', (e) => {
  if (walking || transition) return;
  drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch, t: performance.now(), moved: false, lt: performance.now() };
  view.vyaw = view.vpitch = 0;
  canvasEl.setPointerCapture(e.pointerId); canvasEl.focus({ preventScroll: true });
});
canvasEl.addEventListener('pointermove', (e) => {
  if (drag) {
    const s = 2.2 / Math.max(W(), 400);
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) drag.moved = true;
    const nyaw = clamp(drag.yaw + (e.clientX - drag.x) * s, -view.yawLimit, view.yawLimit);
    const npitch = clamp(drag.pitch + (e.clientY - drag.y) * s * 0.8, -view.pitchLimit, view.pitchLimit);
    const now = performance.now(), dt = Math.max(0.008, (now - drag.lt) / 1000);
    view.vyaw = (nyaw - view.yaw) / dt; view.vpitch = (npitch - view.pitch) / dt;
    view.yaw = nyaw; view.pitch = npitch; drag.lt = now;
    el.tooltip.hidden = true;
    return;
  }
  if (!isCoarse && performance.now() - lastPick > 50) { lastPick = performance.now(); hoverAt(e.clientX, e.clientY); }
});
const endDrag = (e) => {
  if (!drag) return;
  const tap = !drag.moved && performance.now() - drag.t < 400;
  const stale = performance.now() - drag.lt > 80;
  if (stale) view.vyaw = view.vpitch = 0; else { view.vyaw = clamp(view.vyaw, -3, 3) * 0.5; view.vpitch = clamp(view.vpitch, -3, 3) * 0.5; }
  drag = null;
  if (tap && canPick()) { const hit = pickAt(e.clientX, e.clientY); if (hit) openProduct(hit.item.product); else if (!el.product.hidden) closeProduct(); }
};
canvasEl.addEventListener('pointerup', endDrag); canvasEl.addEventListener('pointercancel', () => { drag = null; });
canvasEl.addEventListener('pointerleave', () => { if (!drag) hoverAt(-1, -1); });
addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && state !== 'menu') { keys.add(e.key); e.preventDefault(); }
  if (e.key === 'Escape') { if (!el.product.hidden) closeProduct(); else if (state === 'menu') closeMenu(); else if (state === 'hotspot') backToCounter(); }
  if ((e.key === 'Enter' || e.key === ' ') && state === 'outside' && e.target === canvasEl) { e.preventDefault(); enterStore(); }
});
addEventListener('keyup', (e) => keys.delete(e.key));
addEventListener('blur', () => keys.clear());

let voiceOn = false;
el.voice.addEventListener('click', () => { voiceOn = !voiceOn; el.voice.setAttribute('aria-pressed', String(voiceOn)); el.voice.textContent = voiceOn ? 'Voice on' : 'Voice off'; if (!voiceOn && 'speechSynthesis' in window) speechSynthesis.cancel(); });
el.seeMenu.addEventListener('click', enterStore);
el.skip.addEventListener('click', skipTour);
el.outside.addEventListener('click', startOver);
$('#menu-close').addEventListener('click', closeMenu);
el.openMenu.addEventListener('click', () => { keeper?.setMode('present'); openMenu({ from: state, cat: currentHotspot?.cat || null }); });
el.toCounter.addEventListener('click', backToCounter);
el.product.addEventListener('click', (e) => { if (e.target === el.product) closeProduct(); });

addEventListener('resize', () => {
  if (!renderer) return;
  renderer.setSize(W(), H(), false); applyFov();
  post?.setSize(W(), H());
});

// ---------------------------------------------------------------------------
// Direct (2D) menu view
// ---------------------------------------------------------------------------
function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
async function showFallback({ allow3D }) {
  $('#app').hidden = true; const fb = $('#fallback'); fb.hidden = false;
  $('#fb-tagline').textContent = STORE.tagline;
  try { catalog = catalog || await loadCatalog('data/products.json'); } catch {}
  // reuse the in-store menu renderer against the fallback containers
  el.tabs = $('#fb-tabs'); el.menuBody = $('#fb-body'); el.search = $('#fb-search');
  buildMenu();
  const enter = $('#fb-enter'); enter.hidden = !allow3D;
  enter.addEventListener('click', () => { fb.hidden = true; $('#app').hidden = false; el.tabs = $('#tabs'); el.menuBody = $('#menu-body'); el.search = $('#search'); start3D(); });
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
  interiorReady = new Promise((resolve) => setTimeout(async () => { try { await buildRest(); } finally { makePost(); interiorDone = true; setLoadNote(''); resolve(); } }, 40));
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

window.__exotic = { get state() { return state; }, view, get tier() { return tierName; }, walking: () => !!walking, get keeper() { return keeper; }, get renderer() { return renderer; }, get scene() { return scene; }, get catalog() { return catalog; }, get batches() { return batches; }, setTier, openProduct };
const forceMenu = new URLSearchParams(location.search).has('menu'); // ?menu opens the direct menu view
if (!webglOK()) showFallback({ allow3D: false });
else if (reduceMotion || forceMenu) showFallback({ allow3D: true });
else start3D();
