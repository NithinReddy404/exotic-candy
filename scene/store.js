// scene/store.js - exterior (mall corridor + storefront + sign) and interior assembly.
//
// Uses only the contract's M material names and the builders in props.js. No lights are added.
// World frame (metres, Y up, store depth along -Z) is fixed by docs/ARCHITECTURE.md; the walking
// lane |x| < 0.7 from z = 2 to z = -8.3 is kept clear of geometry.
//
// Assumptions / failure modes
//   - M.tiled(mat, rx, ry) is used for every repeated texture (props.tiledOf falls back to a local
//     clone-all-slots helper when it is missing).
//   - The sign is built from M.sign (front face) plus six alpha-cut M.signSide planes 1 cm apart
//     behind it, so it needs M.sign.map to carry the letter alpha.
//   - tier is the QUALITY object from env.js ({ name, ... }); product shadows only for ultra/high.

import * as THREE from 'three';
import {
  ProductBatches, wallShelves, gondola, freezer, cooler, counter, ceilingLights, contactShadow, tiledOf,
} from './props.js';

const PI = Math.PI;

function add(parent, geo, mat, x, y, z, ry = 0, rx = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); m.receiveShadow = true; parent.add(m); return m;
}
const box = (p, w, h, d, mat, x, y, z, ry = 0) => add(p, new THREE.BoxGeometry(w, h, d), mat, x, y, z, ry);
const plane = (p, w, h, mat, x, y, z, ry = 0, rx = 0) => add(p, new THREE.PlaneGeometry(w, h), mat, x, y, z, ry, rx);
const noAO = (m) => { m.userData.noAO = true; m.userData.noShadow = true; m.castShadow = false; m.receiveShadow = false; return m; };

/** One dark-glass shop front with aluminium frame and mullions. Centre x, width w, facing +z (or -z with flip). */
function shopFront(g, M, cx, z, w, h, flip = false) {
  const s = flip ? -1 : 1, ry = flip ? PI : 0;
  const glass = plane(g, w, h, M.neighborGlass, cx, h / 2 + 0.12, z + s * 0.02, ry);
  glass.receiveShadow = false;
  box(g, w + 0.12, 0.1, 0.1, M.aluminum, cx, 0.07, z + s * 0.04); // sill
  box(g, w + 0.12, 0.08, 0.1, M.aluminum, cx, h + 0.16, z + s * 0.04);
  const n = Math.max(2, Math.round(w / 1.1));
  for (let i = 0; i <= n; i++) box(g, 0.06, h + 0.1, 0.08, M.aluminum, cx - w / 2 + (w * i) / n, h / 2 + 0.12, z + s * 0.04);
  box(g, w, 0.04, 0.06, M.aluminum, cx, 1.0, z + s * 0.04); // transom bar
}

function planter(g, M, x, z) {
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.6, 20), M.darkGloss);
  pot.position.set(x, 0.3, z); pot.castShadow = pot.receiveShadow = true; g.add(pot);
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.02, 20), M.black);
  soil.position.set(x, 0.6, z); g.add(soil);
  const leaf = M.product.clone(); leaf.color.set('#3f7d3a'); leaf.roughness = 0.8;
  const geo = new THREE.IcosahedronGeometry(0.28, 1);
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.2 + (i % 3) * 0.06, y = 0.85 + (i % 4) * 0.2 + Math.floor(i / 5) * 0.15;
    const m = new THREE.Mesh(geo, leaf);
    m.position.set(x + Math.cos(a) * r, y, z + Math.sin(a) * r); m.scale.set(1, 0.85, 1); m.castShadow = true; g.add(m);
  }
}

function bench(g, M, x, z) {
  const slat = M.floorWood;
  for (let i = 0; i < 4; i++) box(g, 1.6, 0.03, 0.1, slat, x, 0.44, z - 0.18 + i * 0.12).castShadow = true;
  for (let i = 0; i < 3; i++) { const b = box(g, 1.6, 0.1, 0.03, slat, x, 0.62 + i * 0.12, z - 0.24); b.rotation.x = -0.15; b.castShadow = true; }
  for (const sx of [-0.7, 0.7]) { box(g, 0.05, 0.43, 0.5, M.steel, x + sx, 0.215, z - 0.06).castShadow = true; box(g, 0.05, 0.4, 0.04, M.steel, x + sx, 0.62, z - 0.25).castShadow = true; }
}

// ---------------------------------------------------------------------------
// Exterior
// ---------------------------------------------------------------------------

/** Corridor, storefront (pilasters, bulkhead, shutter cassette), side fronts, dimensional sign, rods, mat, benches, light panels. */
export function buildExterior(scene, M) {
  const g = new THREE.Group(); g.name = 'exterior'; scene.add(g);

  // corridor floor / ceiling / walls
  plane(g, 14, 12, tiledOf(M, M.floorTile, 14, 12), 0, 0, 6, 0, -PI / 2);
  plane(g, 14, 12, tiledOf(M, M.ceiling, 14 / 1.2, 12 / 1.2), 0, 4.5, 6, 0, PI / 2);
  const mallLights = [];
  for (const x of [-6, -3, 0, 3, 6]) for (const z of [1.5, 4.5, 7.5, 10.5]) mallLights.push([x, z]);
  ceilingLights(g, M, mallLights, 4.5);
  for (const s of [-1, 1]) {
    box(g, 0.3, 4.5, 12, M.wallCream, s * 7.15, 2.25, 6);
    plane(g, 8, 3.2, M.neighborGlass, s * 6.99, 1.8, 6, -s * PI / 2);
    for (let i = 0; i <= 4; i++) box(g, 0.08, 3.3, 0.06, M.aluminum, s * 6.97, 1.8, 2 + i * 2);
  }
  box(g, 14.6, 4.5, 0.3, M.wallCream, 0, 2.25, 12.15);
  for (const cx of [-3.7, 3.7]) shopFront(g, M, cx, 11.98, 5.2, 3.2, true);

  // storefront wall at z=0
  for (const s of [-1, 1]) {
    box(g, 1.6, 4.5, 0.3, M.wallCream, s * 4.0, 2.25, -0.15); // pilaster
    box(g, 2.2, 4.5, 0.3, M.wallCream, s * 5.9, 2.25, -0.15); // side shop block
    shopFront(g, M, s * 5.9, 0.0, 2.0, 3.2);
    box(g, 2.2, 1.0, 0.34, M.wallCream, s * 5.9, 4.0, -0.15); // fascia above the glass
  }
  box(g, 6.4, 1.1, 0.3, M.white, 0, 3.95, -0.15); // bulkhead
  // opening reveal: aluminium jambs, shutter cassette and guides, threshold
  for (const s of [-1, 1]) box(g, 0.05, 3.4, 0.08, M.aluminum, s * 3.17, 1.7, -0.1);
  box(g, 6.4, 0.26, 0.24, M.steel, 0, 3.27, -0.2);
  box(g, 6.4, 0.012, 0.06, M.aluminum, 0, 0.006, 0.0);
  // pilaster returns facing into the store
  for (const s of [-1, 1]) {
    const r = plane(g, 0.8, 2.3, tiledOf(M, M.tealSlat, 0.8, 2.3), s * 3.6, 1.15, -0.302, PI);
    r.receiveShadow = true;
    plane(g, 0.8, 1.1, M.wallCream, s * 3.6, 2.85, -0.302, PI);
  }

  // dimensional sign: front face + 6 alpha-cut dark layers 1 cm apart behind it
  const sign = plane(g, 4.6, 1.26, M.sign, 0, 3.05, 0.42); noAO(sign); sign.name = 'sign-front';
  const sideMat = M.signSide.clone();
  if (M.sign.map) sideMat.map = M.sign.map;
  sideMat.alphaTest = 0.5; sideMat.transparent = false; sideMat.side = THREE.DoubleSide;
  for (let i = 1; i <= 6; i++) { const l = plane(g, 4.6, 1.26, sideMat, 0, 3.05, 0.42 - i * 0.01); noAO(l); l.name = 'sign-depth'; }
  for (const s of [-1, 1]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 8), M.steel);
    rod.position.set(s * 1.2, 4.05, 0.4); rod.castShadow = true; g.add(rod);
    box(g, 0.05, 0.03, 0.05, M.steel, s * 1.2, 4.49, 0.4); // ceiling plate
    box(g, 0.04, 0.06, 0.04, M.steel, s * 1.2, 3.6, 0.4); // clamp
  }
  box(g, 3.0, 0.02, 0.02, M.steel, 0, 3.64, 0.37);

  // logo mat
  const mat = plane(g, 3.6, 1.2, M.mat, 0, 0.0125, 1.0, 0, -PI / 2); noAO(mat);
  box(g, 3.64, 0.012, 1.24, M.black, 0, 0.006, 1.0);

  // street furniture (well away from the walk path)
  for (const s of [-1, 1]) { bench(g, M, s * 5.0, 6.6); planter(g, M, s * 5.9, 3.2); planter(g, M, s * 5.9, 9.6); }
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.8, 16), M.steel); bin.position.set(-6.3, 0.4, 1.4); bin.castShadow = true; g.add(bin);
  g.traverse((o) => { if (o.isMesh && !o.userData.noShadow && o.castShadow === false && !o.userData.noAO) o.receiveShadow = true; });
  return g;
}

// ---------------------------------------------------------------------------
// Interior
// ---------------------------------------------------------------------------

/** Everything inside the store. Returns { batches, counter }. tier: QUALITY object (product shadows for ultra/high). */
export function buildInterior(scene, M, tier) {
  const g = new THREE.Group(); g.name = 'interior'; scene.add(g);
  const Wd = 8, D = 11, Hh = 3.4, lowerH = 2.3;
  const productShadows = !!tier && (tier.name === 'ultra' || tier.name === 'high' || tier.productShadows === true);

  // floor, ceiling, light panels
  plane(g, Wd, D, tiledOf(M, M.floorWood, Wd, D), 0, 0.001, -D / 2, 0, -PI / 2);
  plane(g, Wd, D, tiledOf(M, M.ceiling, Wd / 1.2, D / 1.2), 0, Hh, -D / 2, 0, PI / 2);
  const panelPos = [];
  for (const z of [-1.5, -3.7, -5.9, -8.1, -10.3]) for (const x of [-2, 2]) panelPos.push([x, z]);
  ceilingLights(g, M, panelPos, Hh);

  // walls: teal slatwall band 0..2.3, mural above; left-front section z in [0,-4.2] is full-height mural
  const tealSeg = (w, h, cx, cy, cz, ry) => plane(g, w, h, tiledOf(M, M.tealSlat, w, h), cx, cy, cz, ry);
  plane(g, 4.2, Hh, M.mural(4.2, Hh, 1), -Wd / 2, Hh / 2, -2.1, PI / 2);
  tealSeg(D - 4.2, lowerH, -Wd / 2, lowerH / 2, -4.2 - (D - 4.2) / 2, PI / 2);
  plane(g, D - 4.2, Hh - lowerH, M.mural(D - 4.2, Hh - lowerH, 3), -Wd / 2, lowerH + (Hh - lowerH) / 2, -4.2 - (D - 4.2) / 2, PI / 2);
  tealSeg(D, lowerH, Wd / 2, lowerH / 2, -D / 2, -PI / 2);
  plane(g, D, Hh - lowerH, M.mural(D, Hh - lowerH, 2), Wd / 2, lowerH + (Hh - lowerH) / 2, -D / 2, -PI / 2);
  tealSeg(Wd, lowerH, 0, lowerH / 2, -D, 0);
  plane(g, Wd, Hh - lowerH, M.mural(Wd, Hh - lowerH, 4), 0, lowerH + (Hh - lowerH) / 2, -D, 0);
  // trim line where slatwall meets mural, and a back-wall skirting
  box(g, 0.02, 0.04, D - 4.2, M.white, -Wd / 2 + 0.01, lowerH, -4.2 - (D - 4.2) / 2);
  box(g, 0.02, 0.04, D, M.white, Wd / 2 - 0.01, lowerH, -D / 2);
  box(g, Wd, 0.04, 0.02, M.white, 0, lowerH, -D + 0.01);
  box(g, 3.2, 0.1, 0.02, M.black, 0, 0.05, -D + 0.01);

  // poster on the left-front mural (with a thin black frame)
  const poster = plane(g, 0.8, 1.2, M.poster, -Wd / 2 + 0.012, 1.9, -0.9, PI / 2); noAO(poster);
  for (const [w, h, y, z] of [[0.03, 1.26, 1.9, -0.9 + 0.415], [0.03, 1.26, 1.9, -0.9 - 0.415]]) box(g, 0.025, h, w, M.black, -Wd / 2 + 0.0125, y, z);
  for (const y of [1.9 + 0.615, 1.9 - 0.615]) box(g, 0.025, 0.03, 0.86, M.black, -Wd / 2 + 0.0125, y, -0.9);

  // big round logo on the back wall above the counter
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.75, 64), M.badge);
  logo.position.set(-0.3, 2.3, -D + 0.03); noAO(logo); g.add(logo);

  // security domes on the ceiling (above head height, outside the lane's visual clutter)
  for (const [dx, dz] of [[0, -3.0], [0, -8.9]]) {
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 8, 0, PI * 2, 0, PI / 2), M.darkGloss);
    dome.rotation.x = PI; dome.position.set(dx, Hh - 0.0, dz); g.add(dome);
  }

  // furniture
  const batches = new ProductBatches(M, 20261120);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  wallShelves(g, M, batches, V(-4, 0, -4.3), V(0, 0, -1), 6.2, V(1, 0, 0), { zone: 'left' });
  wallShelves(g, M, batches, V(4, 0, -0.4), V(0, 0, -1), 7.5, V(-1, 0, 0), { zone: 'right' });
  wallShelves(g, M, batches, V(-3.9, 0, -11), V(1, 0, 0), 2.3, V(0, 0, 1), { zone: 'back' });
  wallShelves(g, M, batches, V(1.6, 0, -11), V(1, 0, 0), 2.3, V(0, 0, 1), { zone: 'back' });
  gondola(g, M, batches, -1.4, -3.2, 1.8, 'gondolaA');
  gondola(g, M, batches, 1.4, -5.8, 1.8, 'gondolaB');
  freezer(g, M, -3.4, -1.6, batches);
  cooler(g, M, batches, 3.6, -9.3);
  const ctr = counter(g, M, -0.3, -10.0, batches);
  contactShadow(g, -0.3, -10.75, 0.5, 0.5, 'disc'); // shopkeeper's feet
  batches.build(g, productShadows);
  return { batches, counter: ctr };
}
