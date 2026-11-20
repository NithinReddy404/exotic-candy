// scene/env.js - renderer, environment, lights, post-processing, quality tiers and PBR materials.
//
// Physical light units (three r155+, no legacy lights): RectAreaLight intensity is luminance,
// PointLight/SpotLight intensity is candela, DirectionalLight is illuminance. A white diffuse
// surface lit by a directional light of intensity E reflects E/pi, so "bright retail" needs
// a few lumens-ish of rect light plus a modest IBL term, not the old 0..1 numbers.
//
// Rules this file keeps:
//  * The light count never changes at runtime (a visibility flip or an extra light recompiles every
//    shader). addLights creates everything once; setInterior only scales intensities.
//  * Transmission glass is a full extra scene render, so only the 'ultra' tier uses it.
//  * Tiers without a composer ('medium', 'low') render straight to the canvas, which is MSAA
//    because the renderer is always created with antialias:true (fixed at context creation, so a
//    runtime step-down keeps its anti-aliasing).
//
// Tier objects: QUALITY[name] already carries `name`; app code passes `{ ...QUALITY[name] }` (or just
// the name string, every entry point accepts both).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Quality tiers
// ---------------------------------------------------------------------------
// pixelRatio (cap) | shadows | shadowMap (directional) | spotShadowMap | ao (+aoSamples, aoHalf) | bloom | smaa
// anisotropy | envIntensity (outside) | envInterior | maxSize (texture px cap) | rectLights | transmission
export const QUALITY = {
  ultra: {
    name: 'ultra', pixelRatio: 2, shadows: true, shadowMap: 2048, spotShadowMap: 1024,
    ao: true, aoSamples: 16, aoHalf: false, bloom: true, smaa: true, anisotropy: 8,
    envIntensity: 0.3, envInterior: 0.22, maxSize: 2048, rectLights: 'full', transmission: true, maxLights: 8,
  },
  high: {
    name: 'high', pixelRatio: 1.5, shadows: true, shadowMap: 1024, spotShadowMap: 1024,
    ao: true, aoSamples: 8, aoHalf: true, bloom: true, smaa: true, anisotropy: 8,
    envIntensity: 0.3, envInterior: 0.22, maxSize: 2048, rectLights: 'full', transmission: false, maxLights: 8,
  },
  medium: {
    name: 'medium', pixelRatio: 1.5, shadows: true, shadowMap: 1024, spotShadowMap: 512,
    ao: false, aoSamples: 0, aoHalf: false, bloom: false, smaa: false, anisotropy: 4,
    // Measured on an Intel UHD iGPU: four rect lights cost ~45% of the frame, so phones get the
    // hemisphere + environment lighting of the low tier and keep shadows and the sharper pixel ratio.
    envIntensity: 0.7, envInterior: 0.7, maxSize: 1024, rectLights: 'none', transmission: false, maxLights: 6,
  },
  low: {
    name: 'low', pixelRatio: 1, shadows: false, shadowMap: 512, spotShadowMap: 512,
    ao: false, aoSamples: 0, aoHalf: false, bloom: false, smaa: false, anisotropy: 2,
    envIntensity: 0.7, envInterior: 0.7, maxSize: 1024, rectLights: 'none', transmission: false, maxLights: 4,
  },
};

function tierOf(t) {
  if (typeof t === 'string') return QUALITY[t] || QUALITY.high;
  if (t && t.name && QUALITY[t.name]) return { ...QUALITY[t.name], ...t };
  return t || QUALITY.high;
}
function usesComposer(t) { return !!(t.ao || t.bloom); }
function effectivePixelRatio(t) {
  const dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1) || 1;
  let cap = t.pixelRatio;
  if (t.name === 'medium' && dpr >= 3 && typeof screen !== 'undefined' && screen.width < 400) cap = Math.min(cap, 1.25);
  return Math.min(dpr, cap);
}

/**
 * Pick a tier name. `?tier=ultra|high|medium|low` overrides (debugging).
 * Apple + touch/mobile -> medium, Apple desktop -> high, Adreno/Mali/PowerVR -> medium,
 * Intel UHD/HD -> medium, Iris/Xe/Arc -> high, NVIDIA/AMD discrete -> ultra, software GL -> low.
 * @returns {'ultra'|'high'|'medium'|'low'}
 */
export function detectTier() {
  try {
    const q = new URLSearchParams(location.search).get('tier');
    if (q && QUALITY[q]) return q;
  } catch (e) { /* no location */ }
  const ua = navigator.userAgent || '';
  const touch = (navigator.maxTouchPoints || 0) > 1;
  const mobile = /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(ua) || (touch && /Macintosh/.test(ua));
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 8;
  let gpu = '';
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'low';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
  } catch (e) { return 'low'; }
  if (/SwiftShader|llvmpipe|softpipe|Basic Render|Software|Microsoft Basic/i.test(gpu)) return 'low';
  if (mem <= 2) return 'low';
  if (/Apple/i.test(gpu)) return (mobile || touch) ? 'medium' : 'high';
  if (/Adreno|Mali|PowerVR|Immortalis/i.test(gpu) || mobile) return 'medium';
  if (/Intel/i.test(gpu)) return /Iris|Xe|Arc/i.test(gpu) ? 'high' : 'medium';
  if (/NVIDIA|GeForce|Quadro|RTX|GTX/i.test(gpu)) return 'ultra';
  if (/AMD|Radeon/i.test(gpu)) return /Vega|Graphics\b/i.test(gpu) && !/RX|Pro W/i.test(gpu) ? 'high' : 'ultra';
  return cores >= 8 ? 'high' : 'medium';
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
/** WebGLRenderer with NeutralToneMapping (keeps brand purple/teal), exposure 1, always MSAA canvas. */
export function createRenderer(canvas, tier) {
  const t = tierOf(tier);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(effectivePixelRatio(t));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !!t.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  if (t.transmission && 'transmissionResolutionScale' in renderer) renderer.transmissionResolutionScale = 0.5;
  return renderer;
}

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
/** PMREM of RoomEnvironment as image-based light; neutral cream background; no fog. Returns the env texture. */
export function setupEnvironment(renderer, scene, tier) {
  const t = tierOf(tier || 'high');
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const rt = pmrem.fromScene(room, 0.04);
  scene.environment = rt.texture;
  scene.environmentIntensity = t.envIntensity;
  scene.background = new THREE.Color('#cfcbc3');
  scene.fog = null;
  pmrem.dispose();
  room.dispose();
  return rt.texture;
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------
const COL_INTERIOR = '#fff3e6', COL_MALL = '#f3f6ff', COL_SPOT = '#fff0de', COL_SUN = '#fff6ee';

// Tunables (physical units). Everything is created once; setInterior scales the "mall" group.
const LIGHT = {
  interiorStrip: 9,     // 0.6 x 9.0 luminance strips over the two ceiling-panel columns
  corridorStrip: 7,
  corridorPanel: 7,     // 0.6 x 1.2 panels near the storefront
  sun: 0.5,
  spot: 16,              // candela, counter spot (25 blew the white counter top out)
  hemi: 0.5,             // low tier only
  mallWhileInside: 0.65, // fraction of the mall light left once the camera is in the store
};

function makeStrip(color, intensity, w, h, x, y, z) {
  const l = new THREE.RectAreaLight(color, intensity, w, h);
  l.position.set(x, y, z);
  l.rotation.x = -Math.PI / 2; // faces straight down (local -Z -> world -Y); width along x, height along z
  return l;
}

/**
 * Create every light once.
 * @returns {{ all: THREE.Light[], sun, spot, setInterior(inside: boolean): void, refreshShadows(): void }}
 *   setInterior eases the mall light and environmentIntensity (never touches visibility).
 *   refreshShadows() re-renders the static directional shadow once; call it after the interior is built.
 */
export function addLights(scene, tier) {
  const t = tierOf(tier);
  const all = [];
  const mall = [];     // { light, base }
  const add = (l) => { scene.add(l); all.push(l); return l; };

  if (t.rectLights !== 'none') RectAreaLightUniformsLib.init();

  // Interior rect lights (two strips over the panel columns) and corridor lights.
  if (t.rectLights !== 'none') {
    for (const x of [-2, 2]) add(makeStrip(COL_INTERIOR, LIGHT.interiorStrip, 0.6, 9.0, x, 3.38, -5.9));
    for (const x of [-3, 3]) { const l = add(makeStrip(COL_MALL, LIGHT.corridorStrip, 0.6, 10.0, x, 4.48, 6.5)); mall.push({ light: l, base: LIGHT.corridorStrip }); }
    if (t.rectLights === 'full') {
      for (const x of [-6, 0, 6]) { const l = add(makeStrip(COL_MALL, LIGHT.corridorPanel, 0.6, 1.2, x, 4.48, 2)); mall.push({ light: l, base: LIGHT.corridorPanel }); }
    }
  } else {
    add(new THREE.HemisphereLight('#ffffff', '#cfc8bd', LIGHT.hemi));
  }

  // One soft overhead key from above and in front. Static shadow map: set up once, refreshShadows() to redo.
  const sun = add(new THREE.DirectionalLight(COL_SUN, LIGHT.sun));
  sun.position.set(2, 12, 4);
  sun.target.position.set(0, 0, -4);
  scene.add(sun.target);
  mall.push({ light: sun, base: LIGHT.sun });
  if (t.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(t.shadowMap, t.shadowMap);
    const c = sun.shadow.camera;
    c.left = -6; c.right = 6; c.top = 8; c.bottom = -14; c.near = 1; c.far = 25;
    c.updateProjectionMatrix();
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true;
  }

  // Counter spot (the only dynamic shadow caster).
  const spot = add(new THREE.SpotLight(COL_SPOT, LIGHT.spot, 0, 0.55, 0.7, 2));
  spot.position.set(-0.3, 3.3, -9.0);
  spot.target.position.set(-0.3, 1.0, -10.1);
  scene.add(spot.target);
  if (t.shadows) {
    spot.castShadow = true;
    const m = t.spotShadowMap || 1024;
    spot.shadow.mapSize.set(m, m);
    spot.shadow.camera.near = 0.5; spot.shadow.camera.far = 5;
    spot.shadow.bias = -0.0002; spot.shadow.normalBias = 0.02;
  }

  // setInterior: ease the mall group and environmentIntensity over ~0.7 s.
  const envOut = t.envIntensity, envIn = t.envInterior;
  let k = 0, target = 0, raf = 0, last = 0;
  const apply = () => {
    const e = k * k * (3 - 2 * k);
    for (const m of mall) m.light.intensity = m.base * (1 - e * (1 - LIGHT.mallWhileInside));
    scene.environmentIntensity = envOut + (envIn - envOut) * e;
  };
  const step = (now) => {
    const dt = Math.min((now - last) / 1000, 0.1); last = now;
    const dir = Math.sign(target - k);
    k = clampStep(k, target, dir * dt / 0.7);
    apply();
    raf = k === target ? 0 : requestAnimationFrame(step);
  };
  function clampStep(v, to, d) { const n = v + d; return (d > 0 ? n > to : n < to) ? to : n; }
  const setInterior = (inside) => {
    target = inside ? 1 : 0;
    if (typeof requestAnimationFrame !== 'function') { k = target; apply(); return; }
    if (!raf && k !== target) { last = performance.now(); raf = requestAnimationFrame(step); }
  };
  const refreshShadows = () => { if (sun.castShadow) sun.shadow.needsUpdate = true; };
  apply();
  return { all, sun, spot, setInterior, refreshShadows };
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
function collectTextures(obj, out = new Set(), depth = 0) {
  if (!obj || depth > 3) return out;
  if (obj.isTexture) { out.add(obj); return out; }
  if (typeof obj === 'object') for (const k of Object.keys(obj)) if (typeof obj[k] === 'object') collectTextures(obj[k], out, depth + 1);
  return out;
}

const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'clearcoatMap', 'emissiveMap', 'metalnessMap', 'aoMap'];

/**
 * Build every material. Builders MUST use M.tiled(mat, rx, ry) instead of mat.clone(): since r151 every
 * texture slot has its own UV transform, so cloning only `map` leaves normalMap/roughnessMap at repeat 1.
 * Roughness maps hold a MULTIPLIER (G ~0.75..1), three multiplies material.roughness by it.
 * @param {object} T  makeTextures() result
 * @param {object|string} tier
 */
export function materials(T, tier) {
  const t = tierOf(tier);
  const hq = t.name === 'ultra' || t.name === 'high';
  const aniso = t.anisotropy;
  for (const tex of collectTextures(T)) tex.anisotropy = aniso;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const P = (o) => new THREE.MeshPhysicalMaterial(o);
  const M = {};

  const tileOpts = { map: T.tile.map, normalMap: T.tile.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughnessMap: T.tile.roughnessMap, roughness: 0.16, metalness: 0 };
  M.floorTile = hq
    ? P({ ...tileOpts, clearcoat: 0.3, clearcoatRoughness: 0.1, clearcoatMap: T.tile.clearcoatMap })
    : S(tileOpts);
  M.floorWood = S({ map: T.wood.map, normalMap: T.wood.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: T.wood.roughnessMap, roughness: 0.7, metalness: 0 });
  // faint emissive stands in for light bounced up from the floor; keeps the drop ceiling from going grey
  M.ceiling = S({ map: T.ceiling.map, normalMap: T.ceiling.normalMap, emissive: '#fff6ea', emissiveMap: T.ceiling.map, emissiveIntensity: 0.12, roughness: 0.95, metalness: 0 });
  M.wallCream = S({ map: T.cream.map, normalMap: T.cream.normalMap, normalScale: new THREE.Vector2(0.6, 0.6), roughnessMap: T.cream.roughnessMap, roughness: 0.9, metalness: 0 });
  M.tealSlat = S({ map: T.tealSlat.map, normalMap: T.tealSlat.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.45, metalness: 0 });
  M.whiteSlat = S({ map: T.whiteSlat.map, normalMap: T.whiteSlat.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.45, metalness: 0 });
  M.white = S({ color: '#f4f4f2', roughness: 0.5, metalness: 0 });
  M.black = S({ color: '#0c0c0f', roughness: 0.8, metalness: 0 });
  M.darkGloss = S({ color: '#17171c', roughness: 0.3, metalness: 0.1 });
  M.steel = S({ color: '#c9ccd0', roughness: 0.35, metalness: 0.9 });
  M.aluminum = S({ color: '#bcbfc4', roughness: 0.4, metalness: 0.85 });

  // Glass: transmission is a whole extra scene render, so only ultra gets it. Everyone else (and every jar) gets alpha glass.
  const alphaGlass = () => P({ transparent: true, opacity: 0.12, roughness: 0.04, metalness: 0, ior: 1.5, specularIntensity: 1, envMapIntensity: 1.2, depthWrite: false, side: THREE.FrontSide, color: '#e8f0ef' });
  M.glass = t.transmission
    ? P({ color: '#ffffff', transmission: 0.92, thickness: 0.01, roughness: 0.05, ior: 1.5, metalness: 0, side: THREE.FrontSide })
    : alphaGlass();
  M.jarGlass = alphaGlass();
  M.frostedGlass = P({ color: '#dff0f6', transparent: true, opacity: 0.6, roughness: 0.5, metalness: 0, ior: 1.5, depthWrite: false, side: THREE.FrontSide });

  const muralMats = new Map();
  M.mural = (w, h, variant = 1) => {
    const key = `${Math.round(w)}|${Math.round(h)}|${variant}`;
    let tex = muralMats.get(key);
    if (!tex) { tex = T.mural(w, h, variant).map; tex.anisotropy = aniso; muralMats.set(key, tex); }
    return S({ map: tex, roughness: 0.85, metalness: 0 });
  };
  // Sign: opaque alpha-tested (no sorting); alphaToCoverage smooths the edge on MSAA targets.
  M.sign = S({
    map: T.sign.map, normalMap: T.sign.normalMap, normalScale: new THREE.Vector2(0.8, 0.8),
    color: '#bdbdbd', emissive: '#ffffff', emissiveMap: T.sign.map, emissiveIntensity: 0.35,
    alphaTest: 0.5, alphaToCoverage: true, side: THREE.DoubleSide, roughness: 0.4, metalness: 0,
  });
  M.signSide = S({ color: '#2a1458', roughness: 0.5, metalness: 0.1 });
  M.badge = S({ map: T.badge.map, roughness: 0.5, metalness: 0 });
  M.mat = S({ map: T.mat.map, normalMap: T.mat.normalMap, roughness: 1, metalness: 0 });
  M.poster = S({ map: T.poster().map, roughness: 0.4, metalness: 0 });
  M.lightbox = (text = 'DRINKS') => {
    const tx = T.lightbox(text).map; tx.anisotropy = aniso;
    return S({ map: tx, emissive: '#ffffff', emissiveMap: tx, emissiveIntensity: 1.0, roughness: 0.4, metalness: 0 });
  };
  M.lightPanel = S({ color: '#ffffff', emissive: '#fff3dc', emissiveIntensity: 4, roughness: 0.6, metalness: 0, toneMapped: true });
  M.neighborGlass = S({ color: '#1a2230', roughness: 0.12, metalness: 0.3 });
  M.tablet = S({ map: T.tablet.map, emissive: '#ffffff', emissiveMap: T.tablet.map, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0 });
  M.freezerWrap = S({ map: T.freezerWrap.map, roughness: 0.45, metalness: 0 });
  M.labels = S({ map: T.labels.map, roughness: 0.45, metalness: 0 });
  M.product = S({ color: '#ffffff', roughness: 0.45, metalness: 0 });
  M.textures = T;

  // Tiled clones: material AND every texture slot cloned with the same repeat; cached by (material, rx, ry).
  const tiledCache = new Map();
  M.tiled = (mat, rx, ry = rx) => {
    const key = `${mat.uuid}|${rx}|${ry}`;
    let m = tiledCache.get(key);
    if (m) return m;
    m = mat.clone();
    for (const slot of TEX_SLOTS) {
      if (!mat[slot]) continue;
      const tx = mat[slot].clone();
      tx.repeat.set(rx, ry); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.anisotropy = aniso; tx.needsUpdate = true;
      m[slot] = tx;
    }
    tiledCache.set(key, m);
    return m;
  };
  return M;
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------
// GTAO that also skips anything tagged userData.noAO and anything see-through (glass, alpha signs).
class AOPass extends GTAOPass {
  constructor(...a) { super(...a); this.halfRes = false; }
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const m = o.material;
      const mats = !m ? [] : Array.isArray(m) ? m : [m];
      if ((o.userData && o.userData.noAO === true) || mats.some((x) => x.transparent || x.transmission > 0 || x.alphaTest > 0)) o.visible = false;
    });
  }
  setSize(w, h) {
    const k = this.halfRes ? 2 : 1;
    super.setSize(Math.max(1, Math.floor(w / k)), Math.max(1, Math.floor(h / k)));
  }
}

/**
 * Composer chain RenderPass -> GTAO -> Bloom -> OutputPass -> SMAA (SMAA runs on tone-mapped output).
 * Tiers without ao/bloom skip the composer entirely and render straight to the (MSAA) canvas.
 * @returns {{ render(dt), setSize(w,h), setCamera(camera), setTier(tier), readonly composer, readonly passes }}
 */
export function createPost(renderer, scene, camera, tier) {
  let t = tierOf(tier);
  let cam = camera;
  let composer = null, passes = {}, w = 0, h = 0;
  const size = new THREE.Vector2();
  renderer.getSize(size); w = size.x; h = size.y;

  const disposePasses = () => {
    for (const k of Object.keys(passes)) if (passes[k] && passes[k].dispose) passes[k].dispose();
    passes = {};
    if (composer) { composer.passes.length = 0; }
  };
  const build = () => {
    renderer.setPixelRatio(effectivePixelRatio(t));
    renderer.shadowMap.enabled = !!t.shadows;
    disposePasses();
    if (!usesComposer(t)) { if (composer) { composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; } return; }
    if (!composer) composer = new EffectComposer(renderer);
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    const pr = renderer.getPixelRatio(), pw = Math.max(1, Math.floor(w * pr)), ph = Math.max(1, Math.floor(h * pr));
    passes.render = new RenderPass(scene, cam);
    composer.addPass(passes.render);
    if (t.ao) {
      const g = new AOPass(scene, cam, pw, ph);
      g.halfRes = !!t.aoHalf;
      g.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 0.6, distanceFallOff: 0.6, scale: 1.0, samples: t.aoSamples || 16, screenSpaceRadius: false });
      g.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
      g.blendIntensity = 0.75;
      passes.gtao = g;
      composer.addPass(g);
      g.setSize(pw, ph);
    }
    if (t.bloom) {
      passes.bloom = new UnrealBloomPass(new THREE.Vector2(pw, ph), 0.15, 0.25, 1.6);
      composer.addPass(passes.bloom);
    }
    passes.output = new OutputPass();
    composer.addPass(passes.output);
    if (t.smaa) { passes.smaa = new SMAAPass(pw, ph); composer.addPass(passes.smaa); }
  };
  build();

  return {
    get composer() { return composer; },
    get passes() { return passes; },
    render(dt) {
      if (composer) composer.render(dt);
      else renderer.render(scene, cam);
    },
    setSize(nw, nh) {
      w = nw; h = nh;
      renderer.setSize(nw, nh, false);
      if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(nw, nh); }
    },
    setCamera(c) { cam = c; build(); },
    setTier(nt) { t = tierOf(nt); build(); },
  };
}
