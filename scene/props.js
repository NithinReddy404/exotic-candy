// scene/props.js - product batches and retail furniture for Exotic Candy & Munchies.
//
// Everything here is built from the contract's material names (M.white, M.glass, M.labels ...).
// No DOM access, no Math.random: every random choice comes from a seeded LCG (makeRng), so the
// shelves look the same on every visit.
//
// Products
//   ProductBatches collects product placements and turns them into a few InstancedMeshes, one per
//   (zone, kind), so frustum culling works per area of the store. Item origin is the BOTTOM-CENTRE
//   of the item, label faces local +Z, `ry` is the yaw. Bags and boxes lean back around their
//   back-bottom edge, lathe items (bottles, cans, tubes) stand upright; nothing floats or sinks.
//   Label cell: InstancedBufferAttribute `uvCell` (vec2, = cell column/4, cell row/4, row 0 at the
//   bottom of the atlas) is added to M.labels through onBeforeCompile (patched once per material).
//   Only geometry in the "label" material group samples the atlas, so labels land on the front
//   face only; sides and backs use M.product with the instance colour. The label is never tinted
//   by the instance colour.
//
// Assumptions / failure modes
//   - M.labels.map is a 4x4 atlas with ~8 px gutters; UVs are inset by 1/128 of the atlas.
//   - If M.tiled is missing, tiledMaterial() (clone + every texture slot with the same repeat) is
//     used instead.
//   - Interior stock is sized for ~2,500 instances / ~250k triangles (see ProductBatches.stats()).

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const CELLS = 4;
const LABEL_INSET = 1 / 128;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Seeded LCG. r() in [0,1); r.range(a,b); r.int(n); r.pick(array). */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (n) => Math.min(n - 1, Math.floor(r() * n));
  r.pick = (arr) => arr[r.int(arr.length)];
  return r;
}

/** Clone a material and every texture slot with the same repeat (fallback when M.tiled is absent). */
export function tiledMaterial(src, rx, ry) {
  const m = src.clone();
  for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap', 'aoMap', 'metalnessMap', 'emissiveMap', 'alphaMap']) {
    if (src[k]) {
      const t = src[k].clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(rx, ry);
      t.needsUpdate = true;
      m[k] = t;
    }
  }
  return m;
}
/** M.tiled when builder A provides it, else the local fallback. */
export function tiledOf(M, mat, rx, ry) {
  return typeof M.tiled === 'function' ? M.tiled(mat, rx, ry) : tiledMaterial(mat, rx, ry);
}

const PALETTE = ['#e63946', '#f4a261', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ff006e', '#fb5607',
  '#3a86ff', '#ffbe0b', '#f1f1f1', '#2b2d42', '#80ed99', '#f72585', '#ff9f1c', '#2ec4b6'];
const _col = new THREE.Color();
const _col2 = new THREE.Color();
function shade(color, f) { _col2.set(color); _col2.multiplyScalar(f); return _col2.getHex(); }

// ---- label shader patch --------------------------------------------------------------------

function patchLabelMaterial(mat) {
  if (!mat || mat.userData.uvCellPatched) return;
  mat.userData.uvCellPatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) {
    if (prev) prev.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 uvCell;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
#if defined( USE_MAP ) && defined( USE_INSTANCING )
  vMapUv = vMapUv * ( 0.25 - 2.0 * ${LABEL_INSET.toFixed(6)} ) + ${LABEL_INSET.toFixed(6)} + uvCell;
#endif`);
    // the label texel is never tinted by the instance colour
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '');
  };
  mat.customProgramCacheKey = () => 'labels-uvoff-v1';
  mat.needsUpdate = true;
}

const _untintCache = new WeakMap();
/** Clone of a material that ignores the instance colour (white caps, steel can ends). */
function untinted(src) {
  if (_untintCache.has(src)) return _untintCache.get(src);
  const m = src.clone();
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>',
      '#ifdef USE_COLOR\n  vColor = vec3( 1.0 );\n#endif');
  };
  m.customProgramCacheKey = () => 'untinted-v1';
  _untintCache.set(src, m);
  return m;
}

// ---- tiny gradient textures for baked contact shadows (DataTexture: no DOM) ------------------

const _gradCache = {};
function gradTexture(kind) {
  if (_gradCache[kind]) return _gradCache[kind];
  const S = 64, data = new Uint8Array(S * S * 4);
  const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = (i + 0.5) / S * 2 - 1, v = (j + 0.5) / S * 2 - 1;
      let s;
      if (kind === 'disc') s = sm(1 - Math.hypot(u, v));
      else if (kind === 'strip') s = Math.pow((j + 0.5) / S, 2.2) * (1 - Math.pow(Math.abs(u), 12));
      else s = sm((1 - Math.max(Math.abs(u), Math.abs(v))) / 0.45);
      const f = Math.round((1 - 0.35 * s) * 255);
      const o = (j * S + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = f; data[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  _gradCache[kind] = t;
  return t;
}
const _shadowMats = {};
function shadowMaterial(kind) {
  if (_shadowMats[kind]) return _shadowMats[kind];
  // MultiplyBlending + premultipliedAlpha: result = dst * rgb. Strength is baked into the texture
  // (rgb = 1 - 0.35 * s, alpha 1) so unshadowed texels multiply by exactly 1.
  const m = new THREE.MeshBasicMaterial({
    map: gradTexture(kind), transparent: true, depthWrite: false, blending: THREE.MultiplyBlending,
    premultipliedAlpha: true, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  _shadowMats[kind] = m;
  return m;
}
/** Baked contact shadow on the floor: kind 'box' or 'disc'. Centre (cx,cz), size w (x) by d (z). */
export function contactShadow(parent, cx, cz, w, d, kind = 'box', ry = 0, y = 0.002) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), shadowMaterial(kind));
  mesh.rotation.set(-PI / 2, ry, 0, 'YXZ');
  mesh.position.set(cx, y, cz);
  mesh.renderOrder = 1; mesh.userData.noAO = true; mesh.userData.noShadow = true;
  mesh.castShadow = false; mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}
/** 6 cm dark gradient strip (darkest at the top edge) on a wall backing, facing `ry`. */
export function shelfStrip(parent, x, yTop, z, ry, length) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, 0.06), shadowMaterial('strip'));
  mesh.position.set(x, yTop - 0.03, z); mesh.rotation.y = ry;
  mesh.renderOrder = 1; mesh.userData.noAO = true; mesh.userData.noShadow = true;
  parent.add(mesh);
  return mesh;
}

// ---- generic mesh helpers ------------------------------------------------------------------

function bx(parent, w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.rotation.y = ry; parent.add(m); return m;
}
function rbx(parent, w, h, d, r, mat, x, y, z, seg = 2) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4)), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function cyl(parent, r0, r1, h, seg, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
  m.position.set(x, y, z); parent.add(m); return m;
}
function plane(parent, w, h, mat, x, y, z, ry = 0, rx = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); parent.add(m); return m;
}
/** Shadow flags for furniture; transmissive / transparent meshes never cast and skip the AO pass. */
function finish(root, { cast = true } = {}) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const glassy = mats.some((m) => m && (m.transmission > 0 || (m.transparent && m.opacity < 1)));
    if (glassy) o.userData.noAO = true;
    if (o.userData.noShadow) return;
    o.castShadow = cast && !glassy;
    o.receiveShadow = true;
  });
}
function mergeBoxes(list) {
  // list of [w,h,d,x,y,z]
  const geos = list.map(([w, h, d, x, y, z]) => new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  return mergeGeometries(geos, false);
}

// ---------------------------------------------------------------------------
// Product geometry (all origins at the bottom-centre; bags/boxes are unit-sized and scaled)
// ---------------------------------------------------------------------------

/** Pillowed stand-up bag: unit box x[-.5,.5] y[0,1] z[-.5,.5]. Group 0 = front (label), 1 = rest. */
function makeBagGeometry() {
  const nx = 4, ys = [0, 0.05, 0.2, 0.5, 0.8, 0.93, 1], ny = ys.length - 1;
  const pos = [], uv = [], index = [];
  const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const ty = (y) => (y < 0.2 ? 0.16 + 0.84 * sm(y / 0.2) : y > 0.8 ? 1 - 0.86 * sm((y - 0.8) / 0.15) : 1);
  const thick = (x, y) => ty(y) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(2 * x), 2.4)), 0.8);
  const grid = (rows, side) => {
    const base = pos.length / 3;
    for (const y of rows) {
      for (let i = 0; i <= nx; i++) {
        const x = i / nx - 0.5;
        pos.push(x, y, side * 0.5 * thick(x, y)); uv.push(x + 0.5, y);
      }
    }
    return base;
  };
  const frontBase = grid(ys, 1);
  const backRows = [0, 1];
  const backBase = grid(backRows, -1);
  const vf = (i, j) => frontBase + j * (nx + 1) + i;
  const vb = (i, j) => backBase + j * (nx + 1) + i;
  const frontIdx = [], restIdx = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) frontIdx.push(vf(i, j), vf(i + 1, j), vf(i + 1, j + 1), vf(i, j), vf(i + 1, j + 1), vf(i, j + 1));
  for (let i = 0; i < nx; i++) restIdx.push(vb(i, 0), vb(i + 1, 1), vb(i + 1, 0), vb(i, 0), vb(i, 1), vb(i + 1, 1));
  for (let i = 0; i < nx; i++) {
    // top seal edge (normal +y) and bottom (normal -y)
    restIdx.push(vf(i, ny), vf(i + 1, ny), vb(i + 1, 1), vf(i, ny), vb(i + 1, 1), vb(i, 1));
    restIdx.push(vf(i, 0), vb(i + 1, 0), vf(i + 1, 0), vf(i, 0), vb(i, 0), vb(i + 1, 0));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...frontIdx, ...restIdx]);
  g.addGroup(0, frontIdx.length, 0);
  g.addGroup(frontIdx.length, restIdx.length, 1);
  g.computeVertexNormals();
  return g;
}

/** Re-order a RoundedBox/Box so the +Z face is its own last group (material 0) and the rest is group 1. */
function regroupFront(src, frontGroup = 4) {
  const geo = src.index ? src.toNonIndexed() : src;
  const groups = src.groups;
  const names = ['position', 'normal', 'uv'];
  const parts = { position: [], normal: [], uv: [] };
  const take = (gr) => { for (const n of names) { const a = geo.attributes[n]; parts[n].push(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize)); } };
  let restCount = 0, frontCount = 0;
  groups.forEach((gr, gi) => { if (gi !== frontGroup) { take(gr); restCount += gr.count; } });
  take(groups[frontGroup]); frontCount = groups[frontGroup].count;
  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const a = geo.attributes[n]; const len = parts[n].reduce((s, p) => s + p.length, 0);
    const arr = new Float32Array(len); let o = 0;
    for (const p of parts[n]) { arr.set(p, o); o += p.length; }
    out.setAttribute(n, new THREE.BufferAttribute(arr, a.itemSize));
  }
  out.addGroup(0, restCount, 1);
  out.addGroup(restCount, frontCount, 0);
  return out;
}

function makeBoxGeometry() {
  const rb = new RoundedBoxGeometry(1, 1, 1, 1, 0.06); // segments 1 -> ~108 tris
  rb.translate(0, 0.5, 0);
  return regroupFront(rb, 4);
}

function lathe(points, seg, label = false) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg, label ? -PI : 0, PI * 2);
  if (label) { // wrap the cell over the front ~120 degrees; clamp elsewhere
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, Math.max(0, Math.min(1, (uv.getX(i) - 0.5) * 3 + 0.5)));
  }
  return g;
}

/** 0.5 L soda bottle (0.065 x 0.23): groups 0 body (M.product), 1 label (M.labels), 2 cap. 10 radial x 12 profile points. */
function makeBottleGeometry() {
  const seg = 10;
  const body = lathe([[0.0001, 0], [0.0245, 0], [0.0305, 0.006], [0.0325, 0.016], [0.0325, 0.148], [0.0300, 0.172],
    [0.0215, 0.188], [0.0135, 0.199], [0.0128, 0.2125]], seg);
  const label = lathe([[0.0332, 0.045], [0.0332, 0.135]], seg, true);
  const cap = lathe([[0.0152, 0.2125], [0.0152, 0.2285], [0.0001, 0.2300]], seg);
  return mergeGeometries([body, label, cap], true);
}
/** Can 0.066 x 0.123: group 0 label band, 1 steel ends. 12 segments. */
function makeCanGeometry() {
  const seg = 12;
  const label = lathe([[0.0334, 0.012], [0.0334, 0.111]], seg, true);
  const ends = mergeGeometries([
    lathe([[0.0001, 0], [0.026, 0], [0.0325, 0.006], [0.0334, 0.012]], seg),
    lathe([[0.0334, 0.111], [0.0322, 0.1175], [0.0270, 0.1205], [0.0270, 0.123], [0.0001, 0.123]], seg),
  ], false);
  return mergeGeometries([label, ends], true);
}
/** Chip canister 0.075 x 0.235: group 0 label, 1 steel base, 2 plastic lid. */
function makeTubeGeometry() {
  const seg = 10;
  const label = lathe([[0.0378, 0.012], [0.0378, 0.2]], seg, true);
  const base = lathe([[0.0001, 0], [0.0345, 0], [0.0375, 0.004], [0.0378, 0.012]], seg);
  const lid = lathe([[0.0378, 0.2], [0.0385, 0.204], [0.0385, 0.228], [0.0370, 0.2335], [0.0001, 0.2335]], seg);
  return mergeGeometries([label, base, lid], true);
}
/** Black gable "mystery box": pentagon extruded, unit sized, origin bottom-centre, front is +Z. */
function makeGableGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0.5, 0.74); s.lineTo(0, 1); s.lineTo(-0.5, 0.74); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, -0.5);
  g.clearGroups();
  return g;
}
function makeBlockGeometry() { return new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); }
function makeCandyGeometry() { return new THREE.SphereGeometry(0.5, 6, 4); }


// ---------------------------------------------------------------------------
// ProductBatches
// ---------------------------------------------------------------------------

const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _m = new THREE.Matrix4();

export class ProductBatches {
  constructor(M, seed = 20261120) {
    this.M = M;
    this.rnd = makeRng(seed);
    patchLabelMaterial(M.labels);
    const cap = untinted(M.white), steel = untinted(M.steel);
    this.geo = {
      bag: makeBagGeometry(), box: makeBoxGeometry(), bottle: makeBottleGeometry(), can: makeCanGeometry(),
      tube: makeTubeGeometry(), gable: makeGableGeometry(), candy: makeCandyGeometry(), block: makeBlockGeometry(),
    };
    this.jarGeometry = new THREE.CylinderGeometry(0.1, 0.1, 0.26, 24, 1, false); // glass jar (counter)
    this.mats = {
      bag: [M.labels, M.product], box: [M.labels, M.product], bottle: [M.product, M.labels, cap],
      can: [M.labels, steel], tube: [M.labels, steel, cap], gable: M.black, candy: M.product, block: M.product,
    };
    this.zone = 'main';
    this.data = new Map();
    this.meshes = [];
    this.group = null;
  }

  setZone(name) { this.zone = name; return this; }

  _entry(kind) {
    const key = `${this.zone}|${kind}`;
    let d = this.data.get(key);
    if (!d) { d = { zone: this.zone, kind, m: [], c: [], u: [], n: 0 }; this.data.set(key, d); }
    return d;
  }

  _add(kind, x, y, z, ry, sx, sy, sz, lean, roll, pivotZ, color, cell) {
    const d = this._entry(kind);
    _q1.setFromEuler(_e.set(-lean, 0, roll, 'XYZ'));
    _q2.setFromAxisAngle(Y_AXIS, ry);
    _v1.set(0, 0, pivotZ);
    _v2.copy(_v1).applyQuaternion(_q1);
    _v1.sub(_v2).applyQuaternion(_q2); // rotate about the back-bottom edge, then yaw
    _p.set(x + _v1.x, y + 0.002 + Math.abs(Math.sin(roll)) * sx * 0.5 + _v1.y, z + _v1.z);
    _q2.multiply(_q1);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q2, _s);
    const e = _m.elements;
    for (let i = 0; i < 16; i++) d.m.push(e[i]);
    _col.set(color);
    d.c.push(_col.r, _col.g, _col.b);
    const ci = cell === undefined ? this.rnd.int(16) : cell & 15;
    d.u.push((ci % CELLS) / CELLS, (CELLS - 1 - Math.floor(ci / CELLS)) / CELLS);
    d.n++;
  }

  /** x,y,z = bottom-centre (y is the surface it stands on); ry = yaw; lean (rad, backwards) and roll optional. */
  addBag(x, y, z, ry, w, h, d, color, cell, lean = 0.105, roll = 0) {
    this._add('bag', x, y, z, ry, w, h, d, lean, roll, -d / 2, color, cell);
  }
  addBox(x, y, z, ry, w, h, d, color, cell, lean = 0, roll = 0) {
    this._add('box', x, y, z, ry, w, h, d, lean, roll, -d / 2, color, cell);
  }
  /** 0.065 m wide, 0.23 m tall at scale 1; colour tints the liquid. cell/ry optional. */
  addBottle(x, y, z, color, scale = 1, cell, ry = 0) {
    this._add('bottle', x, y, z, ry, scale, scale, scale, 0, 0, 0, color, cell);
  }
  /** 0.066 x 0.123 */
  addCan(x, y, z, color, cell, ry = 0, scale = 1) {
    this._add('can', x, y, z, ry, scale, scale, scale, 0, 0, 0, color, cell);
  }
  /** chip canister 0.075 x 0.235 */
  addTube(x, y, z, ry, scale, color, cell) {
    this._add('tube', x, y, z, ry, scale, scale, scale, 0, 0, 0, color, cell);
  }
  /** black gable mystery box, w x h (incl. roof) x d, front +Z */
  addGable(x, y, z, ry, w, h, d) {
    this._add('gable', x, y, z, ry, w, h, d, 0, 0, 0, '#ffffff', 0);
  }
  /** plain tinted block (cheap 12-triangle filler behind the visible rows of a facing) */
  addBlock(x, y, z, ry, w, h, d, color) {
    this._add('block', x, y, z, ry, w, h, d, 0, 0, 0, color, 0);
  }
  /** wrapped sweet; (x,y,z) is its CENTRE */
  addCandy(x, y, z, color, s = 1, ry = 0) {
    this._add('candy', x, y - 0.0, z, ry, 0.04 * s, 0.022 * s, 0.026 * s, 0, 0, 0, color, 0);
  }

  /** Create the InstancedMeshes (one per zone and kind). castShadow=false skips the shadow pass for products. */
  build(scene, castShadow = true) {
    const group = new THREE.Group(); group.name = 'products';
    for (const d of this.data.values()) {
      if (!d.n) continue;
      const geo = this.geo[d.kind].clone();
      geo.setAttribute('uvCell', new THREE.InstancedBufferAttribute(new Float32Array(d.u), 2));
      const im = new THREE.InstancedMesh(geo, this.mats[d.kind], d.n);
      im.instanceMatrix.array.set(d.m); im.instanceMatrix.needsUpdate = true;
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(d.c), 3);
      im.computeBoundingSphere(); im.computeBoundingBox();
      im.castShadow = castShadow; im.receiveShadow = true; im.frustumCulled = true;
      im.name = `${d.zone}:${d.kind}`;
      group.add(im); this.meshes.push(im);
    }
    scene.add(group);
    this.group = group;
    return group;
  }

  /** { instances, triangles, meshes } of the built (or pending) batches. */
  stats() {
    let instances = 0, triangles = 0;
    for (const d of this.data.values()) {
      const g = this.geo[d.kind];
      instances += d.n; triangles += d.n * (g.index ? g.index.count : g.attributes.position.count) / 3;
    }
    return { instances, triangles: Math.round(triangles), meshes: this.meshes.length };
  }
}

// ---------------------------------------------------------------------------
// fillRun: pack a run of shelf with neat, stocked facings
// ---------------------------------------------------------------------------

const DEFAULT_MIX = { bag: 0.45, box: 0.3, tube: 0.08, bottle: 0.1, can: 0.07 };

function pickKind(mix, rnd) {
  let total = 0; for (const k in mix) total += mix[k];
  let t = rnd() * total;
  for (const k in mix) { t -= mix[k]; if (t <= 0) return k; }
  return 'bag';
}

function makeSpec(kind, rnd, maxH, opts) {
  const sp = { kind, color: PALETTE[rnd.int(PALETTE.length)], cell: rnd.int(16), jitter: 0.1, lean: 0, gap: 0.006 };
  if (kind === 'bag') {
    const r = rnd();
    if (r < 0.3) { sp.w = rnd.range(0.19, 0.23); sp.h = rnd.range(0.26, 0.30); sp.d = rnd.range(0.07, 0.085); }
    else if (r < 0.7) { sp.w = rnd.range(0.14, 0.17); sp.h = rnd.range(0.2, 0.24); sp.d = rnd.range(0.055, 0.065); }
    else { sp.w = rnd.range(0.11, 0.135); sp.h = rnd.range(0.16, 0.2); sp.d = rnd.range(0.04, 0.05); }
    sp.h = Math.min(sp.h, maxH); sp.lean = rnd.range(0.09, 0.12); sp.pitch = sp.d * 1.04 + 0.004;
  } else if (kind === 'box') {
    const r = rnd();
    if (r < 0.6) { sp.w = rnd.range(0.07, 0.12); sp.h = rnd.range(0.11, 0.18); sp.d = rnd.range(0.04, 0.07); }
    else if (r < 0.85) { sp.w = rnd.range(0.045, 0.06); sp.h = rnd.range(0.15, 0.19); sp.d = 0.03; sp.gap = 0.003; }
    else { sp.w = rnd.range(0.17, 0.21); sp.h = rnd.range(0.22, 0.27); sp.d = rnd.range(0.07, 0.09); }
    sp.h = Math.min(sp.h, maxH); sp.lean = rnd.range(0.0, 0.04); sp.pitch = sp.d + 0.004;
  } else if (kind === 'bottle') {
    const s = Math.min(rnd.range(opts.bottleScale?.[0] ?? 0.9, opts.bottleScale?.[1] ?? 1.15), maxH / 0.23);
    sp.scale = s; sp.w = 0.065 * s; sp.h = 0.23 * s; sp.d = sp.w; sp.pitch = sp.w + 0.002; sp.gap = 0.002; sp.jitter = 0.5;
  } else if (kind === 'can') {
    const s = rnd() < 0.2 ? 1.2 : 1;
    sp.scale = s; sp.w = 0.066 * s; sp.h = 0.123 * s; sp.d = sp.w; sp.pitch = sp.w + 0.002; sp.gap = 0.002; sp.jitter = 0.5;
  } else { // tube
    const s = Math.min(rnd.range(0.95, 1.05), maxH / 0.235);
    sp.scale = s; sp.w = 0.075 * s; sp.h = 0.235 * s; sp.d = sp.w; sp.pitch = sp.w + 0.003; sp.gap = 0.003; sp.jitter = 0.6;
  }
  return sp;
}

/**
 * Fill one shelf board with facings. `start` is on the wall line at the start of the run (world),
 * `dir` runs along the shelf, `out` points away from the wall (the product front), `y` is the shelf
 * top surface. opts: depth (wall line to shelf front, default 0.36), margin, frontInset, backClear,
 * maxH, mix {kind: weight}, rows (fixed row count; default 2 with a 10% chance of 3),
 * bottleScale [min,max], backfill (default true: a cheap block fills the depth behind the rows).
 */
export function fillRun(batches, start, dir, length, out, y, kind = 'mixed', opts = {}) {
  const rnd = batches.rnd;
  const depth = opts.depth ?? 0.36, margin = opts.margin ?? 0.012, inset = opts.frontInset ?? 0.012;
  const backClear = opts.backClear ?? 0.025, maxH = opts.maxH ?? 0.31, mix = opts.mix ?? DEFAULT_MIX;
  const ry0 = Math.atan2(out.x, out.z);
  const uEnd = length - margin;
  let u = margin;
  const at = (cu, v) => [start.x + dir.x * cu + out.x * v, start.z + dir.z * cu + out.z * v];
  while (u < uEnd - 0.04) {
    const k = kind === 'mixed' ? pickKind(mix, rnd) : kind;
    const sp = makeSpec(k, rnd, maxH, opts);
    const across = (k === 'bag' && sp.w > 0.17) ? 1 + rnd.int(2) : 1 + rnd.int(k === 'bottle' || k === 'can' ? 5 : 3);
    const rowsWanted = opts.rows ?? (rnd() < 0.1 ? 3 : 2);
    const blockStart = u; let rowsMax = 0, placedAny = false;
    for (let a = 0; a < across; a++) {
      if (u + sp.w > uEnd) break;
      const cu = u + sp.w / 2;
      for (let r = 0; r < rowsWanted; r++) {
        const vf = depth - inset - r * sp.pitch;
        if (vf - sp.d < backClear) break;
        const [px, pz] = at(cu, vf - sp.d / 2);
        const yaw = ry0 + (rnd() - 0.5) * sp.jitter;
        const hj = (rnd() - 0.5) * 0.006;
        if (k === 'bag') batches.addBag(px, y, pz, yaw, sp.w, sp.h + hj, sp.d, sp.color, sp.cell, sp.lean * rnd.range(0.8, 1.2), (rnd() - 0.5) * 0.02);
        else if (k === 'box') batches.addBox(px, y, pz, yaw, sp.w, sp.h + hj, sp.d, sp.color, sp.cell, sp.lean * rnd.range(0.5, 1.2), 0);
        else if (k === 'bottle') batches.addBottle(px, y, pz, sp.color, sp.scale, sp.cell, yaw);
        else if (k === 'can') batches.addCan(px, y, pz, sp.color, sp.cell, yaw, sp.scale);
        else batches.addTube(px, y, pz, yaw, sp.scale, sp.color, sp.cell);
        rowsMax = Math.max(rowsMax, r + 1); placedAny = true;
      }
      u += sp.w + sp.gap;
    }
    if (placedAny && opts.backfill !== false) {
      const vEnd = depth - inset - rowsMax * sp.pitch;
      const rem = vEnd - backClear;
      const bw = u - sp.gap - blockStart - 0.004;
      if (rem > 0.06 && bw > 0.03) {
        const [px, pz] = at(blockStart + 0.002 + bw / 2, backClear + rem / 2);
        batches.addBlock(px, y, pz, ry0, bw, Math.max(0.05, sp.h * 0.7), rem - 0.004, shade(sp.color, 0.5));
      }
    }
    if (!placedAny) break;
  }
}

// ---------------------------------------------------------------------------
// Wall shelving
// ---------------------------------------------------------------------------

const LEVEL_MIX = [
  { box: 0.36, bag: 0.3, tube: 0.22, bottle: 0.08, can: 0.04 },
  { bag: 0.47, box: 0.33, tube: 0.1, bottle: 0.06, can: 0.04 },
  { bag: 0.52, box: 0.3, tube: 0.08, bottle: 0.05, can: 0.05 },
  { bag: 0.57, box: 0.3, tube: 0.07, bottle: 0.03, can: 0.03 },
];

function boardGeometry(length, depth, thick) {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.lineTo(depth - 0.005, 0); s.lineTo(depth, 0.005); s.lineTo(depth, thick - 0.008);
  s.lineTo(depth - 0.008, thick); s.lineTo(0, thick); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false, steps: 1 });
  g.translate(0, -thick, -length / 2); // top face at y=0, centred on the run
  g.rotateY(-PI / 2); // shape x (depth) -> +z, extrusion -> x
  return g;
}

/**
 * White laminate wall shelving on a slatwall backing: base cabinet, 4 boards (tops at opts.levels),
 * bevelled front edges, uprights at bay boundaries (~1.2 m), a top rail with black gable mystery
 * boxes every 0.6 m, products on every board. start = world point on the wall line, dir = run
 * direction, out = away from the wall. opts.zone names the instancing zone.
 */
export function wallShelves(scene, M, batches, start, dir, length, out, opts = {}) {
  const levels = opts.levels ?? [0.28, 0.72, 1.16, 1.60];
  const railY = opts.railY ?? 2.04;
  const th = 0.032, theta = Math.atan2(out.x, out.z);
  const g = new THREE.Group(); g.name = 'wallShelves'; scene.add(g);
  const W = (u, v) => ({ x: start.x + dir.x * u + out.x * v, z: start.z + dir.z * u + out.z * v });
  batches.setZone(opts.zone ?? 'wall');

  const mid = length / 2;
  // slatwall backing
  let p = W(mid, 0.004);
  const back = plane(g, length, railY, tiledOf(M, M.whiteSlat, length, railY), p.x, railY / 2, p.z, theta);
  back.receiveShadow = true;
  // base cabinet + toe kick
  p = W(mid, 0.2); bx(g, length, 0.168, 0.36, M.white, p.x, 0.08 + 0.084, p.z, theta);
  p = W(mid, 0.18); bx(g, length - 0.03, 0.08, 0.3, M.black, p.x, 0.04, p.z, theta);
  // boards, bevelled
  const bg = boardGeometry(length, 0.36, th);
  levels.forEach((ly) => { p = W(mid, 0.02); const b = new THREE.Mesh(bg, M.white); b.position.set(p.x, ly, p.z); b.rotation.y = theta; g.add(b); });
  const rg = boardGeometry(length, 0.3, th);
  p = W(mid, 0.02); { const b = new THREE.Mesh(rg, M.white); b.position.set(p.x, railY, p.z); b.rotation.y = theta; g.add(b); }
  // 6 cm gradient strips under every board on the backing
  p = W(mid, 0.006);
  [...levels, railY].forEach((ly) => shelfStrip(g, p.x, ly - th, p.z, theta, length));
  // uprights at bay boundaries
  const bays = Math.max(1, Math.round(length / 1.2)), bayW = length / bays;
  for (let i = 0; i <= bays; i++) {
    const u = Math.min(length - 0.015, Math.max(0.015, i * bayW));
    p = W(u, 0.2); bx(g, 0.03, railY, 0.36, M.white, p.x, railY / 2, p.z, theta);
  }
  // products
  levels.forEach((ly, li) => {
    for (let i = 0; i < bays; i++) {
      const u0 = i * bayW + 0.018, q = W(u0, 0);
      fillRun(batches, { x: q.x, z: q.z }, dir, bayW - 0.036, out, ly, 'mixed',
        { depth: 0.38, frontInset: 0.012, backClear: 0.03, maxH: li === 0 ? 0.3 : 0.32, mix: opts.mix?.[li] ?? LEVEL_MIX[li % LEVEL_MIX.length] });
    }
  });
  // gable mystery boxes on the rail, one every 0.6 m
  if (opts.rail !== false) {
    for (let u = 0.35; u < length - 0.2; u += 0.6) {
      const c = W(u, 0.17);
      batches.addGable(c.x, railY, c.z, theta, 0.28, 0.3, 0.22);
      const f = W(u, 0.17 + 0.11 + 0.001);
      batches.addBox(f.x, railY + 0.065, f.z, theta, 0.13, 0.1, 0.004, '#ffffff', batches.rnd.int(16));
    }
  }
  // wall run contact shadow on the floor
  const c = W(mid, 0.3);
  contactShadow(g, c.x, c.z, Math.abs(dir.x) > 0.5 ? length + 0.4 : 0.9, Math.abs(dir.z) > 0.5 ? length + 0.4 : 0.9, 'box');
  finish(g);
  return g;
}

// ---------------------------------------------------------------------------
// Gondola
// ---------------------------------------------------------------------------

/** Centre island 1.0 x 0.85 x lengthZ: kick plinth, spine, end caps, top with a lip, mid and lower shelves. */
export function gondola(scene, M, batches, x, z, lengthZ = 1.8, zone) {
  const L = lengthZ, g = new THREE.Group(); g.name = 'gondola'; g.position.set(x, 0, z); scene.add(g);
  batches.setZone(zone ?? `gondola${x < 0 ? 'A' : 'B'}`);
  bx(g, 0.84, 0.09, L - 0.08, M.black, 0, 0.045, 0);
  bx(g, 0.04, 0.76, L, M.white, 0, 0.47, 0);
  for (const s of [-1, 1]) bx(g, 1.0, 0.76, 0.03, M.white, 0, 0.47, s * (L / 2 - 0.015));
  rbx(g, 1.0, 0.04, L, 0.012, M.white, 0, 0.83, 0); // top, surface at 0.85
  for (const s of [-1, 1]) bx(g, 0.014, 0.035, L - 0.06, M.white, s * 0.493, 0.8675, 0); // top lip
  for (const [ty] of [[0.47], [0.14]]) {
    bx(g, 0.96, 0.025, L - 0.06, M.white, 0, ty - 0.0125, 0);
    for (const s of [-1, 1]) bx(g, 0.012, 0.035, L - 0.06, M.white, s * 0.486, ty + 0.0175, 0);
  }
  const mixes = [
    { box: 0.4, bag: 0.3, tube: 0.2, bottle: 0.1 },
    { bag: 0.4, box: 0.3, tube: 0.1, bottle: 0.1, can: 0.1 },
    { bag: 0.6, box: 0.25, tube: 0.1, can: 0.05 },
  ];
  [0.14, 0.47, 0.85].forEach((ty, li) => {
    for (const s of [-1, 1]) {
      const start = { x: x + s * 0.02, z: z + L / 2 - 0.03 };
      fillRun(batches, start, { x: 0, z: -1 }, L - 0.06, { x: s, z: 0 }, ty, 'mixed',
        { depth: 0.484, frontInset: li === 2 ? 0.02 : 0.024, backClear: 0.03, maxH: li === 2 ? 0.33 : 0.29, mix: mixes[li], margin: 0.02 });
    }
  });
  contactShadow(g, 0, 0, 1.4, L + 0.4, 'box');
  finish(g);
  return g;
}

// ---------------------------------------------------------------------------
// Chest freezer
// ---------------------------------------------------------------------------

/** Wrapped chest freezer 0.75 x 0.85 x 1.6 with a white lid frame and a frosted sliding glass lid. */
export function freezer(scene, M, x, z, batches = null) {
  const g = new THREE.Group(); g.name = 'freezer'; g.position.set(x, 0, z); scene.add(g);
  const T = 0.05, H = 0.81, Y0 = 0.04;
  const wrapSide = M.freezerWrap;
  const wrapEnd = M.freezerWrap.clone();
  if (M.freezerWrap.map) {
    const t = M.freezerWrap.map.clone(); t.repeat.set(0.5, 1); t.offset.set(0.25, 0); t.needsUpdate = true; wrapEnd.map = t;
  }
  const W = M.white;
  // box materials: px, nx, py, ny, pz, nz
  bx(g, T, H, 1.6 - 2 * T, [wrapSide, W, W, W, W, W], 0.375 - T / 2, Y0 + H / 2, 0);
  bx(g, T, H, 1.6 - 2 * T, [W, W, W, W, W, W], -0.375 + T / 2, Y0 + H / 2, 0);
  bx(g, 0.75, H, T, [W, W, W, W, W, W], 0, Y0 + H / 2, -0.8 + T / 2);
  bx(g, 0.75, H, T, [W, W, W, W, wrapEnd, W], 0, Y0 + H / 2, 0.8 - T / 2);
  bx(g, 0.65, 0.06, 1.5, W, 0, Y0 + 0.03, 0); // floor
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.7, 0.7]) bx(g, 0.05, 0.04, 0.05, M.black, sx, 0.02, sz);
  // lid frame (white) with aluminium tracks
  const fy = Y0 + H + 0.02;
  for (const s of [-1, 1]) rbx(g, 0.075, 0.04, 1.6, 0.01, W, s * 0.3375, fy, 0);
  for (const s of [-1, 1]) rbx(g, 0.6, 0.04, 0.075, 0.01, W, 0, fy, s * 0.7625);
  for (const s of [-1, 1]) bx(g, 0.012, 0.01, 1.46, M.aluminum, s * 0.302, fy + 0.024, 0);
  // two sliding frosted panes, one overlapping the other
  const paneA = bx(g, 0.612, 0.012, 0.78, M.frostedGlass, 0, fy + 0.006, -0.37);
  const paneB = bx(g, 0.612, 0.012, 0.78, M.frostedGlass, 0, fy + 0.02, 0.18);
  paneA.userData.noAO = paneB.userData.noAO = true;
  bx(g, 0.1, 0.006, 0.02, M.black, 0, fy + 0.029, 0.5); // finger pull
  // interior: light strip + basket + stock
  const light = bx(g, 0.5, 0.01, 0.03, M.lightPanel, 0, Y0 + H - 0.02, -0.7); light.userData.noAO = true; light.userData.noShadow = true;
  bx(g, 0.6, 0.012, 1.46, M.steel, 0, 0.55, 0); // basket platform
  if (batches) {
    batches.setZone('freezer');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 11; j++) {
      const px = x + (i - 1) * 0.19, pz = z - 0.66 + j * 0.132;
      batches.addBox(px, 0.556, pz, batches.rnd.range(-0.1, 0.1), 0.115, 0.09, 0.115, PALETTE[batches.rnd.int(16)], batches.rnd.int(16));
    }
  }
  contactShadow(g, 0, 0, 1.15, 2.0, 'box');
  finish(g);
  return g;
}

// ---------------------------------------------------------------------------
// Three-door glass drink cooler
// ---------------------------------------------------------------------------

/** Hollow steel cabinet 0.7 x 2.1 x 1.95, doors face -x, three glass doors, wire shelves, stocked. */
export function cooler(scene, M, batches, x, z) {
  const g = new THREE.Group(); g.name = 'cooler'; g.position.set(x, 0, z); scene.add(g);
  const W = 0.7, H = 2.1, L = 1.95, T = 0.03;
  // shell: steel outside, white liner inside
  bx(g, T, H, L, M.steel, W / 2 - T / 2, H / 2, 0);
  for (const s of [-1, 1]) bx(g, W, H, T, M.steel, 0, H / 2, s * (L / 2 - T / 2));
  plane(g, L - 2 * T, 1.7, M.white, W / 2 - T - 0.001, 0.12 + 0.85, 0, -PI / 2);
  for (const s of [-1, 1]) plane(g, W - T, 1.7, M.white, -T / 2, 0.12 + 0.85, s * (L / 2 - T - 0.001), s > 0 ? PI : 0);
  bx(g, W - 0.04, 0.12, L - 2 * T, M.white, 0, 0.06, 0); // inner floor (top at 0.12)
  bx(g, 0.02, 0.1, L - 0.06, M.darkGloss, -0.335, 0.05, 0); // kick grille
  for (let i = 0; i < 6; i++) bx(g, 0.004, 0.006, L - 0.1, M.black, -0.347, 0.02 + i * 0.016, 0);
  // header with a lit "DRINKS" box
  bx(g, 0.72, 0.3, L, M.white, -0.01, 1.95, 0);
  const lb = plane(g, 1.36, 0.26, M.lightbox('DRINKS'), -0.3715, 1.95, 0, -PI / 2);
  lb.userData.noAO = true; lb.userData.noShadow = true;
  for (const s of [-1, 1]) {
    const lp = plane(g, 0.28, 0.26, M.lightPanel, -0.3715, 1.95, s * 0.82, -PI / 2);
    lp.userData.noAO = true; lp.userData.noShadow = true;
  }
  bx(g, 0.74, 0.015, L + 0.02, M.aluminum, -0.01, 2.1, 0);
  // doors: aluminium frames, glass panes, handles
  const zc = [-0.65, 0, 0.65];
  zc.forEach((c, i) => {
    for (const s of [-1, 1]) bx(g, 0.035, 1.68, 0.032, M.aluminum, -0.34, 0.96, c + s * 0.305);
    for (const yy of [0.14, 1.78]) bx(g, 0.035, 0.032, 0.64, M.aluminum, -0.34, yy, c);
    const pane = bx(g, 0.008, 1.62, 0.58, M.glass, -0.34, 0.96, c);
    pane.userData.noAO = true; pane.userData.noShadow = true;
    const hz = c + (i === 1 ? -0.26 : 0.26);
    cyl(g, 0.011, 0.011, 0.55, 8, M.aluminum, -0.388, 0.96, hz);
    for (const yy of [0.76, 1.16]) { const st = cyl(g, 0.007, 0.007, 0.034, 6, M.aluminum, -0.371, yy, hz); st.rotation.z = PI / 2; }
  });
  for (const zz of [-0.975, 0.975]) bx(g, 0.04, 1.68, 0.02, M.aluminum, -0.34, 0.96, zz * 0.995);
  // LED strips just behind the door frames
  for (const s of [-1, 1]) {
    const led = bx(g, 0.012, 1.58, 0.03, M.lightPanel, -0.31, 0.96, s * 0.93);
    led.userData.noAO = true; led.userData.noShadow = true;
  }
  // wire shelves (one instanced rod mesh) + stock
  const shelfY = [0.3, 0.68, 1.06, 1.44];
  const rodGeo = new THREE.CylinderGeometry(0.0025, 0.0025, 1, 4); rodGeo.rotateX(PI / 2);
  const rods = [];
  const q0 = new THREE.Quaternion(), q90 = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, PI / 2);
  shelfY.forEach((sy) => {
    for (let k = 0; k < 9; k++) rods.push([-0.28 + k * 0.07, sy - 0.0025, 0, 1.86, q0]);
    for (let j = 0; j < 11; j++) rods.push([0.01, sy - 0.0075, -0.9 + j * 0.18, 0.6, q90]);
    bx(g, 0.01, 0.025, 1.86, M.aluminum, -0.3, sy - 0.012, 0); // shelf-edge strip
  });
  const rodMesh = new THREE.InstancedMesh(rodGeo, M.steel, rods.length);
  rods.forEach(([rx, ry, rz, len, q], i) => { _m.compose(_p.set(rx, ry, rz), q, _s.set(1, 1, len)); rodMesh.setMatrixAt(i, _m); });
  rodMesh.instanceMatrix.needsUpdate = true; rodMesh.computeBoundingSphere(); rodMesh.castShadow = false; g.add(rodMesh);
  batches.setZone('cooler');
  shelfY.forEach((sy, li) => {
    fillRun(batches, { x: x + 0.3, z: z + 0.93 }, { x: 0, z: -1 }, 1.86, { x: -1, z: 0 }, sy, 'mixed', {
      depth: 0.58, frontInset: 0.018, backClear: 0.02, maxH: 0.31, margin: 0.01, rows: 2,
      mix: li === 0 ? { bottle: 0.75, can: 0.25 } : { bottle: 0.6, can: 0.4 },
      bottleScale: li === 0 ? [1.05, 1.3] : [0.95, 1.1],
    });
  });
  contactShadow(g, 0, 0, 1.15, 2.5, 'box');
  finish(g);
  return g;
}

// ---------------------------------------------------------------------------
// Counter
// ---------------------------------------------------------------------------

/**
 * Counter 2.4 x 0.7, top at 1.04: teal slatwall front with the round logo, POS terminal (right),
 * card reader, candy jar (left), acrylic sign holder. Nothing stands in world x [-0.6, 0.0] on the top
 * (the tablet zone). Returns { top, group }. `batches` is optional (candies in the jar).
 */
export function counter(scene, M, x, z, batches = null) {
  const g = new THREE.Group(); g.name = 'counter'; g.position.set(x, 0, z); scene.add(g);
  bx(g, 2.3, 0.1, 0.6, M.black, 0, 0.05, 0); // plinth
  bx(g, 2.4, 0.9, 0.7, M.white, 0, 0.55, 0); // carcass
  const front = plane(g, 2.26, 0.8, tiledOf(M, M.tealSlat, 2.26, 0.8), 0, 0.55, 0.3515);
  front.userData.noShadow = true;
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.31, 48), M.badge);
  logo.position.set(0, 0.56, 0.354); logo.userData.noAO = true; logo.userData.noShadow = true; g.add(logo);
  const top = rbx(g, 2.5, 0.04, 0.8, 0.012, M.white, 0, 1.02, 0); // surface at 1.04
  const T = 1.04;
  const screenMat = M.darkGloss.clone(); screenMat.color.set('#0b0e14'); screenMat.emissive.set('#3b6fd4'); screenMat.emissiveIntensity = 0.55;
  const barMat = M.lightPanel.clone(); barMat.emissiveIntensity = 1.2;
  // POS (right): cash drawer, stand, tilted monitor facing the shopkeeper, customer display
  rbx(g, 0.38, 0.085, 0.36, 0.01, M.darkGloss, 0.62, T + 0.0425, -0.08);
  rbx(g, 0.17, 0.012, 0.14, 0.004, M.darkGloss, 0.62, T + 0.091, -0.06, 1);
  cyl(g, 0.013, 0.016, 0.09, 12, M.darkGloss, 0.62, T + 0.142, -0.06);
  const mon = new THREE.Group(); mon.position.set(0.62, T + 0.255, -0.06); mon.rotation.set(-0.22, PI, 0, 'YXZ'); g.add(mon);
  rbx(mon, 0.34, 0.22, 0.024, 0.008, M.darkGloss, 0, 0, 0);
  const scr = plane(mon, 0.31, 0.19, screenMat, 0, 0, 0.0125); scr.userData.noAO = true; scr.userData.noShadow = true;
  const hdr = plane(mon, 0.29, 0.025, barMat, 0, 0.075, 0.0128); hdr.userData.noAO = true; hdr.userData.noShadow = true;
  for (let r = 0; r < 4; r++) { const row = plane(mon, 0.2 - r * 0.02, 0.012, barMat, -0.04 - r * 0.01, 0.03 - r * 0.027, 0.0128); row.userData.noAO = true; row.userData.noShadow = true; }
  cyl(g, 0.006, 0.006, 0.17, 8, M.darkGloss, 0.84, T + 0.085, -0.02);
  const cd = new THREE.Group(); cd.position.set(0.84, T + 0.19, -0.02); cd.rotation.set(-0.3, 0, 0, 'YXZ'); g.add(cd);
  rbx(cd, 0.14, 0.09, 0.012, 0.004, M.darkGloss, 0, 0, 0);
  const cds = plane(cd, 0.125, 0.075, screenMat, 0, 0, 0.0065); cds.userData.noAO = true; cds.userData.noShadow = true;
  // receipt printer
  rbx(g, 0.14, 0.11, 0.18, 0.01, M.darkGloss, 1.0, T + 0.055, -0.1);
  bx(g, 0.1, 0.004, 0.012, M.white, 1.0, T + 0.112, 0.0);
  // card reader on a short stand (customer side), local x 0.35 => world x 0.05, outside the tablet zone
  const cr = new THREE.Group(); cr.position.set(0.35, T, 0.2); g.add(cr);
  rbx(cr, 0.09, 0.014, 0.08, 0.004, M.darkGloss, 0, 0.007, 0);
  const rd = new THREE.Group(); rd.position.set(0, 0.085, 0); rd.rotation.set(-0.45, 0, 0, 'YXZ'); cr.add(rd);
  rbx(rd, 0.075, 0.14, 0.02, 0.006, M.darkGloss, 0, 0, 0);
  const rs = plane(rd, 0.055, 0.032, screenMat, 0, 0.042, 0.0105); rs.userData.noAO = true; rs.userData.noShadow = true;
  const keys = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) keys.push([0.014, 0.011, 0.003, (c - 1) * 0.019, -0.004 - r * 0.0185, 0.0115]);
  rd.add(new THREE.Mesh(mergeBoxes(keys), M.black));
  cyl(cr, 0.006, 0.006, 0.07, 8, M.darkGloss, 0, 0.045, -0.02);
  // candy jar (left)
  const jx = -0.85, jz = -0.02;
  const jar = new THREE.Mesh(batches ? batches.jarGeometry : new THREE.CylinderGeometry(0.1, 0.1, 0.26, 24), M.glass);
  jar.position.set(jx, T + 0.015 + 0.13, jz); jar.userData.noAO = true; jar.userData.noShadow = true; g.add(jar);
  cyl(g, 0.098, 0.1, 0.015, 24, M.black, jx, T + 0.0075, jz);
  cyl(g, 0.082, 0.082, 0.02, 24, M.steel, jx, T + 0.015 + 0.26 + 0.01, jz);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 8), M.steel); knob.position.set(jx, T + 0.31, jz); g.add(knob);
  if (batches) {
    batches.setZone('counter');
    const rnd = batches.rnd;
    for (let layer = 0; layer < 6; layer++) {
      for (let k = 0; k < 11; k++) {
        const a = rnd() * PI * 2, rr = Math.sqrt(rnd()) * 0.07;
        batches.addCandy(x + jx + Math.cos(a) * rr, T + 0.03 + layer * 0.03 + 0.011, z + jz + Math.sin(a) * rr, PALETTE[rnd.int(16)], rnd.range(0.85, 1.1), rnd() * PI);
      }
    }
  } else {
    const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.17, 20), M.product.clone());
    fill.material.color.set('#ff7a3d'); fill.position.set(jx, T + 0.015 + 0.085, jz); g.add(fill);
  }
  // acrylic sign holder (customer side, left of the jar side of the tablet zone)
  const sx = -0.95, sz = 0.2;
  const sh = new THREE.Group(); sh.position.set(sx, T, sz); g.add(sh);
  const acrylic = (w, h, d, ax, ay, az) => { const m = bx(sh, w, h, d, M.glass, ax, ay, az); m.userData.noAO = true; m.userData.noShadow = true; return m; };
  acrylic(0.13, 0.006, 0.075, 0, 0.003, 0);
  const plate = new THREE.Group(); plate.position.set(0, 0.006, -0.025); plate.rotation.set(-0.2, 0, 0, 'YXZ'); sh.add(plate);
  const pb = bx(plate, 0.12, 0.16, 0.003, M.glass, 0, 0.08, 0); pb.userData.noAO = true; pb.userData.noShadow = true;
  const pf = bx(plate, 0.12, 0.16, 0.003, M.glass, 0, 0.08, 0.018); pf.userData.noAO = true; pf.userData.noShadow = true;
  const lip = bx(plate, 0.12, 0.02, 0.018, M.glass, 0, 0.01, 0.009); lip.userData.noAO = true; lip.userData.noShadow = true;
  const paper = plane(plate, 0.1, 0.15, M.poster, 0, 0.085, 0.0095); paper.userData.noAO = true; paper.userData.noShadow = true;
  contactShadow(g, 0, 0, 3.0, 1.5, 'box');
  finish(g);
  return { top, group: g };
}

// ---------------------------------------------------------------------------
// Ceiling light panels
// ---------------------------------------------------------------------------

/** Recessed 0.6 x 1.2 panels (long axis z) with a thin white frame. positions: [[x,z] | {x,z}]. */
export function ceilingLights(scene, M, positions, y) {
  const g = new THREE.Group(); g.name = 'ceilingLights'; scene.add(g);
  const pts = positions.map((p) => (Array.isArray(p) ? { x: p[0], z: p[1] } : { x: p.x, z: p.z }));
  const panelGeo = new THREE.PlaneGeometry(0.6, 1.2).rotateX(PI / 2);
  const barL = new THREE.BoxGeometry(0.025, 0.03, 1.25), barS = new THREE.BoxGeometry(0.6, 0.03, 0.025);
  const panels = new THREE.InstancedMesh(panelGeo, M.lightPanel, pts.length);
  const longs = new THREE.InstancedMesh(barL, M.white, pts.length * 2);
  const shorts = new THREE.InstancedMesh(barS, M.white, pts.length * 2);
  pts.forEach((p, i) => {
    panels.setMatrixAt(i, _m.makeTranslation(p.x, y - 0.012, p.z));
    longs.setMatrixAt(i * 2, _m.makeTranslation(p.x - 0.3, y - 0.012, p.z));
    longs.setMatrixAt(i * 2 + 1, _m.makeTranslation(p.x + 0.3, y - 0.012, p.z));
    shorts.setMatrixAt(i * 2, _m.makeTranslation(p.x, y - 0.012, p.z - 0.6));
    shorts.setMatrixAt(i * 2 + 1, _m.makeTranslation(p.x, y - 0.012, p.z + 0.6));
  });
  for (const m of [panels, longs, shorts]) { m.instanceMatrix.needsUpdate = true; m.computeBoundingSphere(); m.userData.noAO = true; m.receiveShadow = false; m.castShadow = false; g.add(m); }
  return g;
}
