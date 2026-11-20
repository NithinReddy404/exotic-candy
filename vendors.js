// Vendor site: the full product range with filters, from data/products.json.
import { flagFor, categoryLabel } from './scene/flags.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PAGE = 60;

let data, products = [], categories = [];
const state = { q: '', cat: '', country: '', sort: 'name', instock: false, shown: PAGE };

function imageUrl(p, width) {
  if (!p.image) return null;
  const abs = /^https?:/.test(p.image) ? p.image : (data.image_base || '') + p.image;
  return abs + (abs.includes('?') ? '&' : '?') + 'width=' + width;
}

async function load() {
  const res = await fetch('data/products.json', { cache: 'no-cache' });
  data = await res.json();
  products = data.products;
  const counts = {};
  for (const p of products) for (const c of p.cats) counts[c] = (counts[c] || 0) + 1;
  categories = Object.keys(data.categories).filter((k) => counts[k]).map((k) => ({ key: k, label: categoryLabel(k), count: counts[k] }));
  const countries = [...new Set(products.map((p) => p.origin).filter(Boolean))].sort();
  $('#stat-products').textContent = products.length.toLocaleString();
  $('#stat-countries').textContent = countries.length;
  $('#stat-categories').textContent = categories.filter((c) => c.key !== 'new' && c.key !== 'mystery').length;
  $('#stat-new').textContent = counts.new || 0;
  const sel = $('#country');
  for (const c of countries) { const o = document.createElement('option'); o.value = c; o.textContent = `${flagFor(c)} ${c}`.trim(); sel.appendChild(o); }
  renderChips();
  render();
}

function renderChips() {
  const box = $('#cats'); box.innerHTML = '';
  const all = document.createElement('button'); all.className = 'chip'; all.type = 'button'; all.setAttribute('role', 'tab');
  all.setAttribute('aria-selected', String(!state.cat)); all.innerHTML = `All <small>${products.length}</small>`;
  all.addEventListener('click', () => { state.cat = ''; state.shown = PAGE; renderChips(); render(); });
  box.appendChild(all);
  for (const c of categories) {
    const b = document.createElement('button'); b.className = 'chip'; b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.cat === c.key)); b.innerHTML = `${esc(c.label)} <small>${c.count}</small>`;
    b.addEventListener('click', () => { state.cat = c.key; state.shown = PAGE; renderChips(); render(); });
    box.appendChild(b);
  }
}

function filtered() {
  const q = state.q.toLowerCase();
  let list = products.filter((p) =>
    (!state.cat || p.cats.includes(state.cat)) &&
    (!state.country || p.origin === state.country) &&
    (!state.instock || p.available) &&
    (!q || p.title.toLowerCase().includes(q) || (p.origin || '').toLowerCase().includes(q)));
  const price = (p) => parseFloat(p.price) || 0;
  if (state.sort === 'price-asc') list.sort((a, b) => price(a) - price(b));
  else if (state.sort === 'price-desc') list.sort((a, b) => price(b) - price(a));
  else if (state.sort === 'new') list.sort((a, b) => (b.cats.includes('new') - a.cats.includes('new')) || a.title.localeCompare(b.title));
  else list.sort((a, b) => a.title.localeCompare(b.title));
  return list;
}

function render() {
  const list = filtered();
  const grid = $('#grid'); grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const p of list.slice(0, state.shown)) {
    const b = document.createElement('button'); b.className = 'item'; b.type = 'button';
    const img = imageUrl(p, 300);
    b.innerHTML = `${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : '<div class="ph"></div>'}
      <div class="meta"><div class="name">${esc(p.title)}${p.cats.includes('new') ? '<span class="badge">New</span>' : ''}</div>
      <div class="price">$${esc(p.price)}</div>
      <div class="note">${p.origin ? `${flagFor(p.origin)} ${esc(p.origin)}` : ''}${p.available ? '' : ' <span class="out">· sold out</span>'}</div></div>`;
    b.addEventListener('click', () => openModal(p));
    frag.appendChild(b);
  }
  grid.appendChild(frag);
  const parts = [];
  if (state.cat) parts.push(categoryLabel(state.cat));
  if (state.country) parts.push(state.country);
  if (state.instock) parts.push('in stock');
  if (state.q) parts.push(`"${state.q}"`);
  $('#count').textContent = `${list.length.toLocaleString()} product${list.length === 1 ? '' : 's'}${parts.length ? ' · ' + parts.join(' · ') : ''}`;
  $('#more').hidden = list.length <= state.shown;
}

function openModal(p) {
  const img = imageUrl(p, 700);
  $('#m-img').innerHTML = img ? `<img src="${esc(img)}" alt="${esc(p.title)}">` : '<div class="ph"></div>';
  $('#m-cat').textContent = p.cats.filter((c) => c !== 'new' && c !== 'mystery').map(categoryLabel).join(' · ') || p.type || '';
  $('#m-title').textContent = p.title;
  $('#m-price').textContent = '$' + p.price;
  const meta = [];
  if (p.origin) meta.push(`${flagFor(p.origin)} From ${p.origin}`);
  if (p.grams > 0 && p.grams < 5000) meta.push(`${p.grams} g`);
  meta.push(p.available ? 'In stock' : 'Sold out');
  $('#m-meta').textContent = meta.join(' · ');
  $('#m-desc').textContent = p.desc ? p.desc + (p.desc.length >= 160 ? '…' : '') : '';
  $('#modal').hidden = false;
  $('#m-close').focus();
}
function closeModal() { $('#modal').hidden = true; }

$('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); state.shown = PAGE; render(); });
$('#country').addEventListener('change', (e) => { state.country = e.target.value; state.shown = PAGE; render(); });
$('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('#instock').addEventListener('change', (e) => { state.instock = e.target.checked; state.shown = PAGE; render(); });
$('#clear').addEventListener('click', () => { Object.assign(state, { q: '', cat: '', country: '', sort: 'name', instock: false, shown: PAGE }); $('#q').value = ''; $('#country').value = ''; $('#sort').value = 'name'; $('#instock').checked = false; renderChips(); render(); });
$('#more').addEventListener('click', () => { state.shown += PAGE; render(); });
$('#m-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target === $('#modal')) closeModal(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
$('#year').textContent = new Date().getFullYear();

load().catch((e) => { $('#count').textContent = 'The product list could not be loaded.'; console.error(e); });
