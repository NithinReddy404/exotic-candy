// Product catalog for Exotic Candy & Munchies.
//
// The catalog snapshot (data/products.json) is pulled from the store's own Shopify site
// (exoticsnackguys.com) by scripts/sync_products.py or the browser snippet in README.md.
// Nothing here invents a product: every title, price, photo and origin comes from that file,
// and the price shown on a product card is re-fetched live from the store when the card opens.
//
// Exports:
//   loadCatalog(url)                  -> { data, products, byId, byHandle, categories }
//   selectFeatured(catalog, cells)    -> items for the shelves (cell, shape, zone, product)
//   buildAtlas(items, catalog, opts)  -> { texture, cells, items, ready }  (fills progressively)
//   livePrice(catalog, product)       -> Promise<{ price, compare, available } | null>
//   imageUrl(catalog, product, width) -> string | null
//   productUrl(catalog, product)      -> string
//   flagFor(country)                  -> emoji or ''

import * as THREE from 'three';

import { flagFor, categoryLabel } from './flags.js';
export { flagFor, categoryLabel };

// Zone capacities on the shelves (256 cells in a 16x16 atlas). Order matters: a product that
// belongs to several categories is placed once, in the first zone that still has room.
const ZONE_PLAN = [
  ['drinks', 30, ['drinks', 'sparkling']],
  ['chips', 40, ['chips']],
  ['chocolate', 25, ['chocolate']],
  ['cookies', 25, ['cookies']],
  ['noodles', 20, ['noodles']],
  ['cereal', 3, ['cereal']],
  ['pickles', 5, ['pickles']],
  ['new', 28, ['new']],
  ['candy', 80, ['candy', 'mystery']],
];


export async function loadCatalog(url = 'data/products.json') {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`catalog ${res.status}`);
  const data = await res.json();
  const products = data.products || [];
  const byId = new Map(), byHandle = new Map();
  for (const p of products) { byId.set(p.id, p); byHandle.set(p.handle, p); }
  const categories = Object.keys(data.categories || CATEGORY_LABELS)
    .map((key) => ({ key, label: categoryLabel(key), count: products.filter((p) => p.cats.includes(key)).length }))
    .filter((c) => c.count > 0);
  return { data, products, byId, byHandle, categories, source: data.source || 'https://www.exoticsnackguys.com' };
}

export function imageUrl(catalog, p, width = 256) {
  if (!p.image) return null;
  const abs = /^https?:/.test(p.image) ? p.image : (catalog.data.image_base || '') + p.image;
  return abs + (abs.includes('?') ? '&' : '?') + 'width=' + width;
}
export function productUrl(catalog, p) { return `${catalog.source}/products/${p.handle}`; }

// Package shape from the store's own category and title words.
export function shapeFor(p) {
  const t = (p.title || '').toLowerCase();
  const cats = p.cats || [];
  if (cats.includes('drinks') || cats.includes('sparkling') || /\bdrink\b|soda|juice|tea\b|coffee|water/.test(t)) {
    return /\bcans?\b|sparkling|energy|soda|cola|pepsi|fanta|sprite|monster|red bull/.test(t) && !/bottle|pet\b/.test(t) ? 'can' : 'bottle';
  }
  if (cats.includes('noodles')) return /\bcup\b|bowl/.test(t) ? 'cup' : 'bag';
  if (cats.includes('chips')) return 'bag';
  if (cats.includes('chocolate')) return 'box';
  if (cats.includes('cookies') || cats.includes('cereal') || cats.includes('mystery')) return 'box';
  if (cats.includes('candy')) return /gumm|sour|chew|jelly|pouch|bag|bites|mix|marshmallow|lollipop/.test(t) ? 'bag' : 'box';
  return 'bag';
}

// Choose which products stand on the 3D shelves: available ones with a photo, spread per zone.
export function selectFeatured(catalog, cells = 16) {
  const max = cells * cells;
  const used = new Set();
  const items = [];
  const pool = catalog.products.filter((p) => p.image && p.available !== false);
  for (const [zone, cap, keys] of ZONE_PLAN) {
    let n = 0;
    for (const p of pool) {
      if (n >= cap || items.length >= max) break;
      if (used.has(p.id) || !keys.some((k) => p.cats.includes(k))) continue;
      used.add(p.id);
      items.push({ cell: items.length, shape: shapeFor(p), zone, id: p.id, title: p.title, product: p });
      n++;
    }
  }
  // top up with anything left if a zone came up short
  for (const p of pool) {
    if (items.length >= max) break;
    if (used.has(p.id)) continue;
    used.add(p.id);
    const zone = p.cats.includes('candy') ? 'candy' : p.cats.includes('chips') ? 'chips' : 'new';
    items.push({ cell: items.length, shape: shapeFor(p), zone, id: p.id, title: p.title, product: p });
  }
  return items;
}

// Build the photo atlas progressively: cells start as a plain package colour and get their
// photo as it arrives, so the shelves fill in while the visitor is still outside.
export function buildAtlas(items, catalog, { size = 4096, cells = 16, onProgress = null } = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cs = size / cells;
  ctx.fillStyle = '#e9e6e1'; ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < items.length; i++) {
    const col = i % cells, row = Math.floor(i / cells);
    ctx.fillStyle = i % 2 ? '#ebe8e3' : '#e4e1dc';
    ctx.fillRect(col * cs, row * cs, cs, cs);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;

  const width = cs <= 128 ? 128 : 256;
  let done = 0, dirty = false, lastUpload = 0;
  const upload = () => { if (!dirty) return; dirty = false; lastUpload = performance.now(); texture.needsUpdate = true; };
  const tick = () => { if (dirty && performance.now() - lastUpload > 700) upload(); if (done < items.length) requestAnimationFrame(tick); else upload(); };

  const loadOne = (item) => new Promise((resolve) => {
    const url = imageUrl(catalog, item.product, width);
    if (!url) { done++; resolve(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const i = item.cell, col = i % cells, row = Math.floor(i / cells);
      const pad = cs * 0.04;
      const w = cs - pad * 2, h = cs - pad * 2;
      const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(col * cs, row * cs, cs, cs);
      ctx.drawImage(img, col * cs + (cs - dw) / 2, row * cs + (cs - dh) / 2, dw, dh);
      dirty = true; done++; onProgress?.(done, items.length); resolve();
    };
    img.onerror = () => { done++; resolve(); };
    img.src = url;
  });

  const ready = (async () => {
    requestAnimationFrame(tick);
    const queue = items.slice();
    const workers = Array.from({ length: 6 }, async () => { while (queue.length) await loadOne(queue.shift()); });
    await Promise.all(workers);
    upload();
  })();

  return { texture, cells, items, ready };
}

// Live price straight from the store (Shopify product endpoint, CORS-enabled). Cached 60 s.
const liveCache = new Map();
export async function livePrice(catalog, p) {
  const hit = liveCache.get(p.handle);
  if (hit && performance.now() - hit.t < 60000) return hit.v;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`${catalog.source}/products/${p.handle}.js`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const j = await res.json();
    const v = (j.variants && j.variants[0]) || {};
    const out = { price: (j.price / 100).toFixed(2), compare: j.compare_at_price ? (j.compare_at_price / 100).toFixed(2) : null, available: !!(v.available ?? j.available) };
    liveCache.set(p.handle, { t: performance.now(), v: out });
    return out;
  } catch { return null; }
  finally { clearTimeout(timer); }
}
