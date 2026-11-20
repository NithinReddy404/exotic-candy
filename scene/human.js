/**
 * scene/human.js - the shopkeeper: a rigged Ready Player Me avatar that behaves like shop staff.
 *
 * Exports
 *   loadShopkeeper({ scene, position, rotationY, avatarUrl, atlasUrl, animBase, tabletMaterial, onProgress })
 *     -> Promise<{ group, update(dt, camera), setMode(mode), headPosition(target), talk(ms), dispose(),
 *                  tablet, tune, getState(), isFallback }>
 *   mode is 'idle' | 'greet' | 'present'. `greet` waves/nods and then moves to `present` on its own.
 *
 * Pipeline per frame (update): mixer.update -> body turn -> look-at OFFSETS on top of the clip pose
 * (Spine2 15 %, Neck 40 %, Head 45 %, eyes take the residual) -> right-arm / tablet override -> morphs.
 * Every procedural rotation is an offset applied on top of what the mixer wrote this frame, or an absolute
 * set for bones the clips do not drive, so nothing accumulates. update() allocates nothing.
 *
 * Avatar and atlas
 *   Base file assets/keeper.glb is the Ready Player Me masculine avatar (mesh Wolf3D_Avatar, one unlit
 *   material). Its material is replaced by a MeshStandardMaterial that keeps the embedded normal map
 *   (texture index 0, not referenced by the unlit material) and swaps the base colour for
 *   assets/keeper_atlas.png when `atlasUrl` is given. Atlas regions repainted (1024x1024, layout face
 *   top-left, eye top-right, pants top-middle, shoes right-middle, shirt bottom-left, mouth bottom-middle):
 *     - head/neck/ear quadrant: skin to a warm medium brown, hair to near-black, short dark beard and
 *       moustache with stubble speckle on the lower face
 *     - the two flat swatches: hand/forearm skin and hair colour
 *     - shirt: cream knit polo with chevron ribbing, collar band, placket with two buttons, rib cuffs and hem
 *     - pants: light-blue denim with twill, whiskers and seam stitching
 *     - shoes: white leather with a dark swoosh-like stripe on the outer side
 *     - eye: lighter sclera periphery
 *   A photo-exact face needs a Ready Player Me avatar made from the photo: pass its .glb as `avatarUrl`
 *   (menu.js shopkeeper.avatarUrl). Any RPM-compatible glb works; the atlas swap is applied only to the
 *   single-mesh base avatar, other avatars just get their unlit materials upgraded.
 *
 * Known gap: the base avatar has no morph targets, so no blinks and no mouth movement. When a loaded avatar
 * has RPM morphs (eyeBlinkLeft/Right, jawOpen, viseme_aa) they are driven (blink every 2-6 s for 120 ms,
 * jaw noise while talking). Without morphs, small eye saccades (0.5-1 degree every 0.4-1.5 s) keep the
 * eyes alive.
 *
 * Clips: assets/anim/*.glb (Ready Player Me animation library, masculine). Tracks are filtered to bone
 * quaternions plus Hips.position (frame-0 X/Z removed so variations do not slide him). The left-hand wave
 * is the library's Standing_Expressions_001 mirrored across the sagittal plane (the tablet is in the right
 * hand), trimmed to its active 3 s.
 *
 * If the glb fails to load a low-poly capsule figure with the same API is built, so the site never breaks.
 * Determinism: all randomness comes from a seeded LCG; time is the sum of dt.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DEG = Math.PI / 180;
const FAR_DIST = 6;                 // visitor further than this: he keeps looking at the tablet
const BODY_TURN_START = 50 * DEG;   // camera further off his facing than this -> turn the body
const BODY_TURN_STOP = 6 * DEG;
const BODY_TURN_TAU = 0.2;          // ~0.6 s to settle
const HEAD_YAW_MAX = 60 * DEG, PITCH_UP_MAX = -20 * DEG, PITCH_DOWN_MAX = 30 * DEG;
const EYE_YAW_MAX = 25 * DEG, EYE_PITCH_MAX = 15 * DEG;
const TAU_EYE = 0.05, TAU_HEAD = 0.16, TAU_NECK = 0.2, TAU_SPINE = 0.3;
const SHARE_SPINE = 0.15, SHARE_NECK = 0.40;   // the head takes the remaining 45 %
const SPINE_MAX = 14 * DEG, NECK_MAX = 34 * DEG;
const FADE = 0.7;                   // idle crossfade seconds
const TALK_WEIGHT = 0.7;
const HAND_CAP = 35 * DEG;
const DEFAULT_AVATAR = new URL('../assets/keeper.glb', import.meta.url).href;
const DEFAULT_ANIM = new URL('../assets/anim/', import.meta.url).href;

// ---------------------------------------------------------------- tuned poses (local quaternions)
// The tablet is in the right hand, so the right arm is overridden in EVERY mode while it is attached.
//   hold    : idle / greet. Upper arm at his side, forearm flexed ~85 deg and supinated, palm up, tablet resting on
//             the palm tilted ~28 deg up toward his face, at waist height.
//   present : upper arm forward ~14 deg, forearm up ~50 deg and pronated, hand cocked back, the tablet held upright
//             in front of the palm at chest height. The hand is then re-solved every frame so the screen faces the
//             visitor (see applyArm), capped at 35 deg away from this stored pose.
// Quaternions are [x, y, z, w], LOCAL to the parent bone, over the clip rig (the clips' frame-0 pose). They were
// tuned by eye in assets/human-test.html (tune panel); `tune` (Euler degrees, ZXY: swing Z, swing X, twist Y
// innermost) adds a live offset on top of them and ships as zero.
const POSE = {
  hold: {
    arm: [0.6229, -0.0218, 0.1068, 0.7746],
    fore: [-0.469, -0.4407, -0.5576, 0.5243],
    hand: [0.022, -0.078, -0.021, 0.997],
  },
  present: {
    arm: [0.6531, 0.0541, 0.0182, 0.7551],
    fore: [0.5044, 0.3973, -0.6023, 0.4745],
    hand: [0.4306, 0.1082, -0.1434, 0.8851],
  },
  // tablet placement in the RightHand bone frame (bone Y runs along the fingers, -Z is out of the palm)
  tablet: {
    holdPos: [-0.075, 0.07, -0.025], holdQuat: [0.0, 0.9703, 0.2419, 0.0],
    presPos: [-0.035, 0.105, -0.028], presQuat: [0.0, 0.9703, 0.2419, 0.0],
  },
};
const TUNE_DEFAULT = {
  hold:    { arm: [0, 0, 0], fore: [0, 0, 0], hand: [0, 0, 0] },
  present: { arm: [0, 0, 0], fore: [0, 0, 0], hand: [0, 0, 0] },
  tablet:  { pos: [0, 0, 0], rot: [0, 0, 0], presPos: [0, 0, 0], presRot: [0, 0, 0], presRoll: 0 },
};

// ---------------------------------------------------------------- helpers
function makeRng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function eulerQuat(out, d) { // degrees XYZ
  return out.setFromEuler(_eul.set(d[0] * DEG, d[1] * DEG, d[2] * DEG, 'ZXY'));
}
const _eul = new THREE.Euler();
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1);

/** Tablet slab 0.26 x 0.18 x 0.008 with a screen plane on +Z. */
function buildTablet(tabletMaterial) {
  const g = new THREE.Group();
  g.name = 'keeperTablet';
  const slabMat = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.35, metalness: 0.6 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.008), slabMat);
  slab.castShadow = true; slab.receiveShadow = true;
  const screenMat = tabletMaterial || new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.245, 0.165), screenMat);
  screen.position.z = 0.0042;
  g.add(slab, screen);
  g.userData.owned = [slab.geometry, screen.geometry, slabMat, tabletMaterial ? null : screenMat];
  return g;
}

function disposeTree(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'emissiveMap', 'aoMap']) if (m[k]) m[k].dispose();
      m.dispose();
    }
  });
}

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

// ---------------------------------------------------------------- avatar loading
function upgradeMaterials(root, normalMap, atlas) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    const out = arr.map((m) => {
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) { m.envMapIntensity = 0.8; return m; }
      const old = m;
      const params = { roughness: 0.62, metalness: 0, envMapIntensity: 0.8 };
      if (atlas) { params.map = atlas; if (normalMap) params.normalMap = normalMap; }
      else { if (old.map) params.map = old.map; if (old.color) params.color = old.color.clone(); }
      const mat = new THREE.MeshStandardMaterial(params);
      if (atlas && old.map && old.map !== atlas) old.map.dispose();
      old.dispose();
      return mat;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
  });
}

function prepClip(clip, name, boneNames, hipsBind) {
  const tracks = [];
  for (const t of clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    if (node === 'Armature' || node === 'RootNode' || !boneNames.has(node)) continue;
    if (prop === 'quaternion') { tracks.push(t); continue; }
    if (node === 'Hips' && prop === 'position') {
      const v = t.values.slice();
      let maxY = 0; for (let i = 1; i < v.length; i += 3) maxY = Math.max(maxY, Math.abs(v[i]));
      const k = maxY > 10 ? 0.01 : 1;
      const x0 = v[0] * k, y0 = v[1] * k, z0 = v[2] * k;
      for (let i = 0; i < v.length; i += 3) {
        v[i] = hipsBind.x + (v[i] * k - x0);
        v[i + 1] = hipsBind.y + (v[i + 1] * k - y0);
        v[i + 2] = hipsBind.z + (v[i + 2] * k - z0);
      }
      tracks.push(new THREE.VectorKeyframeTrack('Hips.position', t.times, v));
    }
  }
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

// ---------------------------------------------------------------- the rigged shopkeeper
async function buildRigged({ avatarUrl, atlasUrl, animBase, tabletMaterial, onProgress }) {
  const loader = new GLTFLoader();
  const prog = (a, b) => (e) => { if (onProgress && e && e.total) onProgress(a + (b - a) * (e.loaded / e.total)); };
  const gltf = await loader.loadAsync(avatarUrl || DEFAULT_AVATAR, prog(0, 0.7));
  const root = gltf.scene;

  // single-mesh base avatar (layout known) vs any other RPM avatar
  const meshes = [];
  root.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) throw new Error('avatar has no skinned mesh');
  const isBase = meshes.length === 1 && meshes[0].name === 'Wolf3D_Avatar';
  let atlas = null, normalMap = null;
  if (isBase && atlasUrl) {
    atlas = await loadTexture(atlasUrl);
    atlas.flipY = false; atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8;
    try {
      normalMap = await gltf.parser.getDependency('texture', 0);
      normalMap.flipY = false; normalMap.colorSpace = THREE.NoColorSpace; normalMap.anisotropy = 8;
    } catch { normalMap = null; }
  }
  if (onProgress) onProgress(0.8);
  upgradeMaterials(root, normalMap, atlas);

  const bones = {};
  const boneNames = new Set();
  root.traverse((o) => { if (o.isBone) { bones[o.name] = o; boneNames.add(o.name); } });
  const need = ['Hips', 'Spine2', 'Neck', 'Head', 'RightArm', 'RightForeArm', 'RightHand'];
  for (const n of need) if (!bones[n]) throw new Error('avatar is missing bone ' + n);

  // morph targets (RPM full-body avatars sometimes have them)
  const morphMeshes = meshes.filter((m) => m.morphTargetDictionary);
  const morphIdx = (name) => morphMeshes.map((m) => [m, m.morphTargetDictionary[name]]).filter((p) => p[1] !== undefined);
  const morphs = {
    blinkL: morphIdx('eyeBlinkLeft'), blinkR: morphIdx('eyeBlinkRight'),
    jaw: morphIdx('jawOpen').concat(morphIdx('viseme_aa')),
  };

  // clips
  const mixer = new THREE.AnimationMixer(root);
  const hipsBind = bones.Hips.position.clone();
  const clipBase = new URL(animBase || DEFAULT_ANIM, typeof location !== 'undefined' ? location.href : import.meta.url);
  const clipUrl = (f) => new URL(f, clipBase.href.endsWith('/') ? clipBase.href : clipBase.href + '/').href;
  const actions = {};
  const loadClip = async (key, file, opts = {}) => {
    const g = await loader.loadAsync(clipUrl(file));
    let clip = prepClip(g.animations[0], key, boneNames, hipsBind);
    if (opts.window) clip = THREE.AnimationUtils.subclip(clip, key, opts.window[0] * 24, opts.window[1] * 24, 24);
    const a = mixer.clipAction(clip);
    if (opts.once) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[key] = a;
    return a;
  };
  try { await loadClip('idleA', 'idle_a.glb'); } catch (e) { console.warn('[human] base idle clip failed', e); }
  if (onProgress) onProgress(1);
  const lazy = Promise.allSettled([
    loadClip('idleB', 'idle_b.glb'),
    loadClip('varLook', 'idle_var_look.glb', { once: true }),
    loadClip('varTilt', 'idle_var_tilt.glb', { once: true }),
    loadClip('wave', 'greet_wave_left.glb', { once: true, window: [2.0, 5.0] }),
    loadClip('nod', 'greet_nod.glb', { once: true, window: [0.4, 2.8] }),
    loadClip('talkA', 'talk_a.glb'),
    loadClip('talkB', 'talk_b.glb'),
  ]);
  return { root, gltf, bones, morphs, mixer, actions, lazy, isBase, atlas, normalMap };
}

// ---------------------------------------------------------------- behaviour on the rigged avatar
function makeRigged(rig, { position, rotationY, tabletMaterial }) {
  const { root, bones, morphs, mixer, actions } = rig;
  const group = new THREE.Group();
  group.name = 'Shopkeeper';
  group.add(root);
  if (position) group.position.set(position.x || 0, position.y || 0, position.z || 0);
  group.rotation.y = rotationY || 0;

  const head = bones.Head, neck = bones.Neck, spine2 = bones.Spine2;
  const eyeL = bones.LeftEye || null, eyeR = bones.RightEye || null;
  const rArm = bones.RightArm, rFore = bones.RightForeArm, rHand = bones.RightHand;
  const eyeRestL = eyeL ? eyeL.quaternion.clone() : null;
  const eyeRestR = eyeR ? eyeR.quaternion.clone() : null;

  // ---- tablet
  const tablet = buildTablet(tabletMaterial);
  let tabletAttached = true;
  rHand.add(tablet);

  let poseS = 0;                               // 0 = hold, 1 = present
  // ---- tunable poses
  const tune = JSON.parse(JSON.stringify(TUNE_DEFAULT));
  const Q = {
    holdArm: new THREE.Quaternion(), holdFore: new THREE.Quaternion(), holdHand: new THREE.Quaternion(),
    presArm: new THREE.Quaternion(), presFore: new THREE.Quaternion(), presHand: new THREE.Quaternion(),
    hand0: new THREE.Quaternion().fromArray(POSE.present.hand),
    tabHold: new THREE.Quaternion(), tabPres: new THREE.Quaternion(), tabOff: new THREE.Quaternion(), tabOffInv: new THREE.Quaternion(),
  };
  const tabPosHold = new THREE.Vector3(), tabPosPres = new THREE.Vector3();
  const _qa = new THREE.Quaternion(), _va = new THREE.Vector3();
  const compile = () => {
    const mk = (out, base, d) => out.fromArray(base).multiply(eulerQuat(_qa, d));
    mk(Q.holdArm, POSE.hold.arm, tune.hold.arm); mk(Q.holdFore, POSE.hold.fore, tune.hold.fore);
    mk(Q.holdHand, POSE.hold.hand, tune.hold.hand);
    mk(Q.presArm, POSE.present.arm, tune.present.arm); mk(Q.presFore, POSE.present.fore, tune.present.fore);
    mk(Q.presHand, POSE.present.hand, tune.present.hand);
    tabPosHold.fromArray(POSE.tablet.holdPos).add(_va.fromArray(tune.tablet.pos));
    tabPosPres.fromArray(POSE.tablet.presPos).add(_va.fromArray(tune.tablet.presPos));
    mk(Q.tabHold, POSE.tablet.holdQuat, tune.tablet.rot); mk(Q.tabPres, POSE.tablet.presQuat, tune.tablet.presRot);
    Q.tabPres.multiply(_qa.setFromAxisAngle(AX_Z, tune.tablet.presRoll * DEG));      // roll about the tablet's own normal
    setTabletBlend(smooth01(poseS));
  };
  const setTabletBlend = (s) => {
    tablet.position.copy(tabPosHold).lerp(tabPosPres, s);
    Q.tabOff.copy(Q.tabHold).slerp(Q.tabPres, s);
    Q.tabOffInv.copy(Q.tabOff).invert();
    tablet.quaternion.copy(Q.tabOff);
  };
  tune.ideal = [0, 0, 0];
  tune.recompute = compile;
  tune.quats = () => Object.fromEntries(Object.entries(Q).map(([k, q]) => [k, q.toArray().map((v) => +v.toFixed(4))]));
  compile();

  // ---- state
  const rng = makeRng(0x5eed51);
  let time = 0;
  let mode = 'idle', modeT = 0;
  let disposed = false;
  let cur = actions.idleA || null;
  if (cur) cur.play();
  let baseIdx = 0, lastVar = -1;
  let varT = 8 + rng() * 7;
  let oneShot = null, oneShotLeft = 0;         // a variation / greeting currently playing
  let greetToPresent = -1;
  let greetCount = 0;
  let talkLeft = 0, talkAction = null, talkFlip = 0, talkFade = 0;
  let nodT = -1;
  // gaze
  let gazeKind = 0, gazeT = 1, asideSign = 1, gazeBiasYaw = 0, gazeBiasPitch = 0;
  let lastYawSign = 1;
  let spineY = 0, spineP = 0, neckY = 0, neckP = 0, headY = 0, headP = 0, eyeY = 0, eyeP = 0;
  let sacT = 0.6, sacY = 0, sacP = 0;
  let blinkT = 2 + rng() * 4, blinkPhase = -1, jaw = 0;
  let turning = false;
  let dist = 99;

  // pre-allocated temporaries
  const camPos = new THREE.Vector3(), tgt = new THREE.Vector3(), tabPos = new THREE.Vector3();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), vUp = new THREE.Vector3(0, 1, 0);
  const vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3(), vS = new THREE.Vector3();
  const qG = new THREE.Quaternion(), qGi = new THREE.Quaternion(), qH = new THREE.Quaternion();
  const qW = new THREE.Quaternion(), qD = new THREE.Quaternion(), qP = new THREE.Quaternion(), qT = new THREE.Quaternion();
  const qT2 = new THREE.Quaternion(), qDes = new THREE.Quaternion(), qPW = new THREE.Quaternion();
  const qHandState = new THREE.Quaternion().copy(Q.holdHand);
  const qYaw = new THREE.Quaternion(), qPit = new THREE.Quaternion();
  const mat = new THREE.Matrix4();
  const Q_LEAN = new THREE.Quaternion().setFromAxisAngle(AX_X, -8 * DEG);
  let handInit = false, handErr = 0;

  const fadeTo = (next, dur = FADE) => {
    if (!next || next === cur) return;
    if (cur) cur.crossFadeTo(next.reset().play(), dur, false); else next.reset().play();
    cur = next;
  };
  const baseAction = () => (baseIdx === 0 || !actions.idleB ? actions.idleA : actions.idleB);
  const returnToIdle = () => {
    baseIdx = 1 - baseIdx;
    fadeTo(baseAction());
    oneShot = null;
    varT = 8 + rng() * 7;
  };
  const startOneShot = (a, fade = FADE) => {
    if (!a) return false;
    fadeTo(a, fade);
    oneShot = a;
    oneShotLeft = a.getClip().duration - fade;   // start fading back half a second+ before the end
    return true;
  };

  function setMode(m) {
    if (m !== 'idle' && m !== 'greet' && m !== 'present') return;
    mode = m; modeT = 0;
    greetToPresent = -1;
    if (m === 'greet') {
      gazeKind = 0; gazeT = 4 + rng() * 2; gazeBiasYaw = 0; gazeBiasPitch = 0;
      const a = (greetCount++ % 2 === 0) ? actions.wave : actions.nod;
      const ok = startOneShot(a || actions.nod || actions.wave, 0.4);
      greetToPresent = ok ? Math.max(0.6, oneShotLeft - 0.9) : 0.6;
    } else if (m === 'present') {
      gazeKind = 0; gazeT = 3 + rng() * 2; gazeBiasYaw = 0; gazeBiasPitch = 0;
    }
  }

  function talk(ms) {
    talkLeft = Math.max(0.2, ms / 1000);
    nodT = 0;
    const a = (talkFlip++ % 2 === 0 ? actions.talkA : actions.talkB) || actions.talkA || actions.talkB;
    if (a && a !== talkAction) {
      if (talkAction) talkAction.fadeOut(0.3);
      talkAction = a;
    }
    if (talkAction && !(talkAction.isRunning() && talkAction.getEffectiveWeight() > 0.01)) {
      talkAction.reset();
      talkAction.setEffectiveWeight(TALK_WEIGHT);
      talkAction.fadeIn(0.4).play();
    }
  }

  function headPosition(target) {
    head.getWorldPosition(target);
    target.y += 0.08;
    return target;
  }

  // ---------------------------------------------------------------- per frame
  function update(dt, camera) {
    if (disposed) return;
    if (!(dt > 0)) dt = 1 / 120;
    if (dt > 0.1) dt = 0.1;
    time += dt; modeT += dt;

    // camera world position (no allocation)
    camera.updateWorldMatrix(true, false);
    const ce = camera.matrixWorld.elements;
    camPos.set(ce[12], ce[13], ce[14]);
    const gx = group.position.x, gz = group.position.z;
    const dx = camPos.x - gx, dz = camPos.z - gz;
    dist = Math.hypot(dx, dz);

    // ---- body turn (yaw of the group)
    if (dist > 0.3) {
      const rel = wrapPi(Math.atan2(dx, dz) - group.rotation.y);
      if (!turning && Math.abs(rel) > BODY_TURN_START) turning = true;
      if (turning) {
        group.rotation.y += rel * (1 - Math.exp(-dt / BODY_TURN_TAU));
        if (Math.abs(rel) < BODY_TURN_STOP) turning = false;
      }
    }

    // ---- scheduling: idle variations, greeting hand-over, talk, nod
    if (mode === 'greet' && greetToPresent >= 0 && modeT >= greetToPresent) setMode('present');
    if (oneShot) {
      oneShotLeft -= dt;
      if (oneShotLeft <= 0) returnToIdle();
    } else if (mode !== 'greet') {
      varT -= dt;
      if (varT <= 0) {
        const pick = lastVar === 0 ? 1 : lastVar === 1 ? 0 : (rng() < 0.5 ? 0 : 1);
        lastVar = pick;
        const a = pick === 0 ? actions.varLook : actions.varTilt;
        if (!startOneShot(a)) varT = 3;
      }
    }
    if (talkLeft > 0) {
      talkLeft -= dt;
      if (talkLeft <= 0 && talkAction) talkAction.fadeOut(0.5);
    }

    // ---- gaze segments (camera / tablet / aside)
    gazeT -= dt;
    if (gazeT <= 0) {
      if (mode === 'idle' && dist > FAR_DIST) {
        if (gazeKind === 1) { gazeKind = 0; gazeT = 1 + rng(); }          // looks up for 1-2 s
        else { gazeKind = 1; gazeT = 5 + rng() * 2; }                      // back to the tablet ~every 6 s
      } else if (gazeKind === 0) {
        if (rng() < 0.62) { gazeKind = 1; gazeT = 0.45 + rng() * 0.15; }  // glance at the tablet
        else { gazeKind = 2; gazeT = 0.4 + rng() * 0.2; asideSign = rng() < 0.5 ? -1 : 1; }
        if (mode === 'greet') { gazeKind = 0; gazeT = 3; }                 // keep eye contact while greeting
      } else {
        gazeKind = 0; gazeT = 4 + rng() * 3;
      }
    }
    const biasYawT = gazeKind === 2 ? asideSign * 22 * DEG : 0;
    const biasPitchT = gazeKind === 2 ? 4 * DEG : 0;
    const bk = 1 - Math.exp(-dt / 0.08);
    gazeBiasYaw += (biasYawT - gazeBiasYaw) * bk;
    gazeBiasPitch += (biasPitchT - gazeBiasPitch) * bk;

    // ---- animation
    mixer.update(dt);
    group.updateMatrixWorld(true);

    // ---- look-at offsets on top of the clip pose
    tgt.copy(camPos);
    if (gazeKind === 1) {
      tabPos.setFromMatrixPosition(tablet.matrixWorld);
      tgt.copy(tabPos);
    }
    // eye midpoint (clip pose)
    if (eyeL && eyeR) {
      v1.setFromMatrixPosition(eyeL.matrixWorld); v2.setFromMatrixPosition(eyeR.matrixWorld); v1.add(v2).multiplyScalar(0.5);
    } else { head.getWorldPosition(v1); v1.y += 0.09; }
    group.getWorldQuaternion(qG); qGi.copy(qG).invert();
    v2.copy(tgt).sub(v1).applyQuaternion(qGi);
    let yawG = Math.atan2(v2.x, v2.z);
    const pitchG = -Math.atan2(v2.y, Math.hypot(v2.x, v2.z));
    // hold the last yaw sign when the target is behind him (no atan2 snap); the body turn takes over
    if (Math.abs(yawG) > 110 * DEG) yawG = lastYawSign * Math.abs(yawG);
    else if (Math.abs(yawG) > 0.2) lastYawSign = yawG < 0 ? -1 : 1;
    let pitchGaze = pitchG;
    if (gazeKind === 1) {                          // reading the tablet: head drops, only slightly toward its side
      yawG = clamp(yawG * 0.4, -20 * DEG, 20 * DEG);
      pitchGaze = 28 * DEG;
    }
    yawG += gazeBiasYaw;
    head.matrixWorld.decompose(v3, qH, vS);
    v3.set(0, 0, 1).applyQuaternion(qH).applyQuaternion(qGi);       // clip head forward in the body frame
    const yawH = Math.atan2(v3.x, v3.z), pitchH = -Math.atan2(v3.y, Math.hypot(v3.x, v3.z));
    const wantYaw = clamp(yawG, -HEAD_YAW_MAX, HEAD_YAW_MAX);
    const wantPitch = clamp(pitchGaze + gazeBiasPitch, PITCH_UP_MAX, PITCH_DOWN_MAX);
    let offY = clamp(wrapPi(wantYaw - yawH), -2 * HEAD_YAW_MAX, 2 * HEAD_YAW_MAX);
    let offP = wantPitch - pitchH;
    // nod
    let nod = 0;
    if (nodT >= 0) {
      nodT += dt;
      const u = nodT / 0.7;
      if (u >= 1) nodT = -1; else nod = 0.13 * Math.sin(u * Math.PI) * (u < 0.5 ? 1 : 0.85);
    }
    const ks = 1 - Math.exp(-dt / TAU_SPINE), kn = 1 - Math.exp(-dt / TAU_NECK), kh = 1 - Math.exp(-dt / TAU_HEAD);
    // shares 15 / 40 / 45 %; spine and neck are bounded so a big clip-pose compensation lands on the head
    const sY = clamp(offY * SHARE_SPINE, -SPINE_MAX, SPINE_MAX), sP = clamp(offP * SHARE_SPINE, -SPINE_MAX, SPINE_MAX);
    const nY = clamp(offY * SHARE_NECK, -NECK_MAX, NECK_MAX), nP = clamp(offP * SHARE_NECK, -NECK_MAX, NECK_MAX);
    spineY += (sY - spineY) * ks; spineP += (sP - spineP) * ks;
    neckY += (nY - neckY) * kn;   neckP += (nP - neckP) * kn;
    headY += ((offY - sY - nY) - headY) * kh;
    headP += ((offP - sP - nP) + nod - headP) * kh;

    // cumulative world delta: apply Spine2, then Neck, then Head (each sees its already-rotated parent)
    qD.identity();
    applyOffset(spine2, spineY, spineP, qG);
    applyOffset(neck, neckY, neckP, qG);
    applyOffset(head, headY, headP, qG);

    spine2.updateMatrixWorld(true);

    // ---- eyes: residual relative to the head, eyes lead
    if (eyeL && eyeR) {
      eyeL.updateMatrixWorld(true); eyeR.updateMatrixWorld(true);
      v1.setFromMatrixPosition(eyeL.matrixWorld); v2.setFromMatrixPosition(eyeR.matrixWorld); v1.add(v2).multiplyScalar(0.5);
      head.matrixWorld.decompose(v3, qH, vS);
      qT.copy(qH).invert();
      v2.copy(tgt).sub(v1).applyQuaternion(qT);
      v2.applyAxisAngle(AX_Y, gazeBiasYaw * 0.5);
      sacT -= dt;
      if (sacT <= 0) {
        sacT = 0.4 + rng() * 1.1;
        sacY = (rng() * 2 - 1) * (0.5 + rng() * 0.5) * DEG;
        sacP = (rng() * 2 - 1) * (0.5 + rng() * 0.5) * DEG;
      }
      const eyawT = clamp(Math.atan2(v2.x, v2.z) + sacY, -EYE_YAW_MAX, EYE_YAW_MAX);
      const epitT = clamp(-Math.atan2(v2.y, Math.hypot(v2.x, v2.z)) + sacP, -EYE_PITCH_MAX, EYE_PITCH_MAX);
      const ke = 1 - Math.exp(-dt / TAU_EYE);
      eyeY += (eyawT - eyeY) * ke; eyeP += (epitT - eyeP) * ke;
      qYaw.setFromAxisAngle(AX_Y, eyeY); qPit.setFromAxisAngle(AX_X, eyeP);
      qT.copy(qYaw).multiply(qPit);
      eyeL.quaternion.copy(qT).multiply(eyeRestL);
      eyeR.quaternion.copy(qT).multiply(eyeRestR);
    }

    // ---- right arm and tablet (override every mode while the tablet is attached)
    if (tabletAttached) applyArm(dt);

    // ---- morphs
    updateMorphs(dt);
  }

  // premultiply a world-space yaw/pitch offset (about the body axes) onto a bone's local quaternion
  function applyOffset(bone, yaw, pitch, qGroup) {
    // parent world rotation now = qD * parentOldWorld
    bone.parent.matrixWorld.decompose(v3, qP, vS);
    qP.premultiply(qD);
    // world offset about the group's up / right axes
    qYaw.setFromAxisAngle(AX_Y, yaw); qPit.setFromAxisAngle(AX_X, pitch);
    qW.copy(qGroup).multiply(qYaw).multiply(qPit).multiply(qGi);   // group-frame rotation -> world rotation
    // local = qP^-1 * qW * qP
    qT2.copy(qP).invert().multiply(qW).multiply(qP);
    bone.quaternion.premultiply(qT2);
    qD.premultiply(qW);
  }

  function applyArm(dt) {
    const target = mode === 'present' ? 1 : 0;
    poseS += clamp(target - poseS, -dt / 0.9, dt / 0.9);
    const s = smooth01(poseS);
    setTabletBlend(s);
    // arm + forearm: slerp between the two stored poses
    rArm.quaternion.copy(Q.holdArm).slerp(Q.presArm, s);
    rFore.quaternion.copy(Q.holdFore).slerp(Q.presFore, s);
    // breathing drift while presenting (about 0.4 degree at 0.25 Hz)
    const drift = 0.007 * Math.sin(time * 2 * Math.PI * 0.25) * s;
    const drift2 = 0.005 * Math.sin(time * 2 * Math.PI * 0.19 + 1.3) * s;
    qT.setFromAxisAngle(AX_X, drift); rArm.quaternion.multiply(qT);
    qT.setFromAxisAngle(AX_Y, drift2); rFore.quaternion.multiply(qT);
    // hand: stored hold pose, or solved so the tablet faces the visitor, capped at 35 degrees
    rFore.updateWorldMatrix(true, false);
    rFore.matrixWorld.decompose(v3, qPW, vS);
    qT.copy(Q.holdHand).slerp(Q.presHand, s);          // base pose (stored)
    if (s > 0.02) {
      tabPos.setFromMatrixPosition(tablet.matrixWorld);
      vZ.copy(camPos).sub(tabPos);
      if (vZ.lengthSq() > 1e-4) {
        vZ.normalize();
        vX.crossVectors(vUp, vZ);
        if (vX.lengthSq() > 1e-4) {
          vX.normalize(); vY.crossVectors(vZ, vX);
          mat.makeBasis(vX, vY, vZ);
          qDes.setFromRotationMatrix(mat).multiply(Q_LEAN);
          qT2.copy(qDes).multiply(Q.tabOffInv);                      // hand world
          qT2.premultiply(qP.copy(qPW).invert());                    // hand local
          const ang = qT2.angleTo(Q.presHand);
          handErr = ang;
          // ideal hand pose as tuning Euler (degrees, same convention as tune.present.hand): for tuning only
          qT.copy(Q.hand0).invert().multiply(qT2);
          _eul.setFromQuaternion(qT, 'ZXY');
          tune.ideal[0] = _eul.x / DEG; tune.ideal[1] = _eul.y / DEG; tune.ideal[2] = _eul.z / DEG;
          const f = ang > HAND_CAP ? HAND_CAP / ang : 1;
          qDes.copy(Q.presHand).slerp(qT2, f);                       // capped solve
          qT.slerp(qDes, s);
        }
      }
    }
    if (!handInit) { qHandState.copy(qT); handInit = true; }
    qHandState.slerp(qT, 1 - Math.exp(-dt / 0.14));
    rHand.quaternion.copy(qHandState);
    qT.setFromAxisAngle(AX_Y, drift2 * 0.6); rHand.quaternion.multiply(qT);
    rHand.updateMatrixWorld(true);
  }

  function updateMorphs(dt) {
    if (morphs.blinkL.length || morphs.blinkR.length) {
      blinkT -= dt;
      if (blinkPhase < 0 && blinkT <= 0) { blinkPhase = 0; }
      let b = 0;
      if (blinkPhase >= 0) {
        blinkPhase += dt;
        const u = blinkPhase / 0.12;
        b = u < 0.4 ? u / 0.4 : Math.max(0, 1 - (u - 0.4) / 0.6);
        if (u >= 1) { blinkPhase = -1; blinkT = 2 + rng() * 4; b = 0; }
      }
      for (const [m, i] of morphs.blinkL) m.morphTargetInfluences[i] = b;
      for (const [m, i] of morphs.blinkR) m.morphTargetInfluences[i] = b;
    }
    if (morphs.jaw.length) {
      const talking = talkLeft > 0;
      const jt = talking ? 0.1 + 0.28 * Math.abs(Math.sin(time * 9.1) * Math.sin(time * 5.3 + 1)) : 0;
      jaw += (jt - jaw) * (1 - Math.exp(-dt / 0.05));
      for (const [m, i] of morphs.jaw) m.morphTargetInfluences[i] = jaw;
    }
  }

  function getState() {
    const names = [];
    for (const k in actions) { const a = actions[k]; if (a.isRunning() && a.getEffectiveWeight() > 0.02) names.push(k + ':' + a.getEffectiveWeight().toFixed(2)); }
    return { mode, clips: names.join(' '), gaze: ['camera', 'tablet', 'aside'][gazeKind], talking: talkLeft > 0, dist, turning, handErrDeg: +(handErr / DEG).toFixed(1),
      headYawDeg: +((spineY + neckY + headY) / DEG).toFixed(1), headPitchDeg: +((spineP + neckP + headP) / DEG).toFixed(1) };
  }

  function dispose() {
    disposed = true;
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    if (group.parent) group.parent.remove(group);
    rHand.remove(tablet);
    const owned = tablet.userData.owned || [];
    for (const o of owned) if (o) o.dispose();
    disposeTree(root);
    if (rig.atlas) rig.atlas.dispose();
    if (rig.normalMap) rig.normalMap.dispose();
  }

  return { group, update, setMode, headPosition, talk, dispose, tablet, tune, getState, isFallback: false, bones,
    detachTablet() { tabletAttached = false; rHand.remove(tablet); },
    lazy: rig.lazy };
}

// ---------------------------------------------------------------- low-poly fallback
function makeFallback({ position, rotationY, tabletMaterial }) {
  const group = new THREE.Group();
  group.name = 'ShopkeeperFallback';
  if (position) group.position.set(position.x || 0, position.y || 0, position.z || 0);
  group.rotation.y = rotationY || 0;
  const skin = new THREE.MeshStandardMaterial({ color: 0xa8704c, roughness: 0.7 });
  const polo = new THREE.MeshStandardMaterial({ color: 0xe9dfc6, roughness: 0.9 });
  const denim = new THREE.MeshStandardMaterial({ color: 0x8ba6c9, roughness: 0.85 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x15110f, roughness: 0.8 });
  const shoeM = new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 });
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false; parent.add(m); return m;
  };
  const geos = [];
  const cap = (r, l) => { const g = new THREE.CapsuleGeometry(r, l, 4, 10); geos.push(g); return g; };
  const sph = (r) => { const g = new THREE.SphereGeometry(r, 16, 12); geos.push(g); return g; };
  const box = (x, y, z) => { const g = new THREE.BoxGeometry(x, y, z); geos.push(g); return g; };

  for (const sx of [-1, 1]) {
    mesh(cap(0.075, 0.74), denim, group, sx * 0.1, 0.5, 0);
    mesh(box(0.1, 0.07, 0.26), shoeM, group, sx * 0.1, 0.035, 0.05);
  }
  const torso = new THREE.Group(); torso.position.y = 0.95; group.add(torso);
  mesh(cap(0.17, 0.36), polo, torso, 0, 0.3, 0).scale.set(1.15, 1, 0.72);
  const headG = new THREE.Group(); headG.position.set(0, 0.62, 0); torso.add(headG);
  mesh(cap(0.06, 0.05), skin, headG, 0, 0.02, 0);
  const headM = mesh(sph(0.105), skin, headG, 0, 0.17, 0.01); headM.scale.set(0.9, 1.1, 1);
  mesh(sph(0.108), hairM, headG, 0, 0.2, -0.01).scale.set(0.92, 0.85, 1.02);
  const beard = mesh(sph(0.09), hairM, headG, 0, 0.12, 0.035); beard.scale.set(0.95, 0.65, 0.85);
  const arms = [];
  for (const sx of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(sx * 0.215, 0.5, 0); torso.add(sh);
    mesh(cap(0.05, 0.22), polo, sh, 0, -0.14, 0);
    const el = new THREE.Group(); el.position.set(0, -0.28, 0); sh.add(el);
    mesh(cap(0.042, 0.2), skin, el, 0, -0.13, 0);
    arms.push({ sh, el, sx });
  }
  const tablet = buildTablet(tabletMaterial);
  const rightEl = arms[1].el; // sx=+1 is the character's left in +z facing, use arms[0] as right
  const rEl = arms[0].el;
  rEl.add(tablet);
  tablet.position.set(0, -0.3, 0.06);
  tablet.rotation.x = -0.5;

  const rng = makeRng(0xfa11);
  let time = 0, mode = 'idle', modeT = 0, talkLeft = 0, nodT = -1, turning = false, poseS = 0;
  let yaw = 0, pitch = 0, gazeKind = 0, gazeT = 1, greetT = -1;
  const camPos = new THREE.Vector3(), v = new THREE.Vector3();

  function setMode(m) {
    if (m !== 'idle' && m !== 'greet' && m !== 'present') return;
    mode = m; modeT = 0; greetT = m === 'greet' ? 1.8 : -1; if (m !== 'idle') { gazeKind = 0; gazeT = 4; }
  }
  function talk(ms) { talkLeft = Math.max(0.2, ms / 1000); nodT = 0; }
  function headPosition(t) { headG.getWorldPosition(t); t.y += 0.08; return t; }
  function update(dt, camera) {
    if (!(dt > 0)) dt = 1 / 120; if (dt > 0.1) dt = 0.1;
    time += dt; modeT += dt;
    camera.updateWorldMatrix(true, false);
    const ce = camera.matrixWorld.elements; camPos.set(ce[12], ce[13], ce[14]);
    const dx = camPos.x - group.position.x, dz = camPos.z - group.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.3) {
      const rel = wrapPi(Math.atan2(dx, dz) - group.rotation.y);
      if (!turning && Math.abs(rel) > BODY_TURN_START) turning = true;
      if (turning) { group.rotation.y += rel * (1 - Math.exp(-dt / BODY_TURN_TAU)); if (Math.abs(rel) < BODY_TURN_STOP) turning = false; }
    }
    if (mode === 'greet' && greetT >= 0) { greetT -= dt; if (greetT <= 0) setMode('present'); }
    gazeT -= dt;
    if (gazeT <= 0) {
      if (mode === 'idle' && dist > FAR_DIST) { if (gazeKind === 1) { gazeKind = 0; gazeT = 1.5; } else { gazeKind = 1; gazeT = 5.5; } }
      else if (gazeKind === 0) { gazeKind = 1; gazeT = 0.5; } else { gazeKind = 0; gazeT = 4 + rng() * 3; }
    }
    // head look-at in the body frame
    headG.getWorldPosition(v);
    const tx = gazeKind === 1 ? 0 : camPos.x - v.x, ty = gazeKind === 1 ? -0.6 : camPos.y - v.y, tz = gazeKind === 1 ? 1 : camPos.z - v.z;
    const gy = group.rotation.y;
    const lx = tx * Math.cos(gy) - tz * Math.sin(gy), lz = tx * Math.sin(gy) + tz * Math.cos(gy);
    const wy = clamp(Math.atan2(lx, lz), -HEAD_YAW_MAX, HEAD_YAW_MAX);
    const wp = clamp(-Math.atan2(ty, Math.hypot(lx, lz)), PITCH_UP_MAX, PITCH_DOWN_MAX);
    let nod = 0;
    if (nodT >= 0) { nodT += dt; const u = nodT / 0.7; if (u >= 1) nodT = -1; else nod = 0.13 * Math.sin(u * Math.PI); }
    const k = 1 - Math.exp(-dt / 0.18);
    yaw += (wy - yaw) * k; pitch += (wp + nod - pitch) * k;
    headG.rotation.set(pitch, yaw, 0);
    // breathing, sway
    torso.position.y = 0.95 + Math.sin(time * 1.5) * 0.003;
    torso.rotation.z = Math.sin(time * 0.4) * 0.012;
    // arms: tablet arm raises for present
    poseS += clamp((mode === 'present' ? 1 : 0) - poseS, -dt / 0.9, dt / 0.9);
    const s = smooth01(poseS);
    arms[0].sh.rotation.set(-0.15 - 0.45 * s, 0, 0.05);
    arms[0].el.rotation.set(-1.45 - 0.2 * s, 0, 0);
    const wave = mode === 'greet' ? Math.sin(time * 8) * 0.25 : 0;
    arms[1].sh.rotation.set(0, 0, mode === 'greet' ? -2.3 + wave : -0.06);
    arms[1].el.rotation.set(mode === 'greet' ? -0.4 : -0.1, 0, 0);
    if (talkLeft > 0) talkLeft -= dt;
    void rightEl;
  }
  function getState() { return { mode, clips: 'fallback', gaze: ['camera', 'tablet', 'aside'][gazeKind], talking: talkLeft > 0 }; }
  function dispose() {
    if (group.parent) group.parent.remove(group);
    for (const g of geos) g.dispose();
    for (const m of [skin, polo, denim, hairM, shoeM]) m.dispose();
    for (const o of tablet.userData.owned || []) if (o) o.dispose();
  }
  return { group, update, setMode, headPosition, talk, dispose, tablet, tune: {}, getState, isFallback: true };
}

// ---------------------------------------------------------------- public entry
export async function loadShopkeeper({ scene, position, rotationY, avatarUrl, atlasUrl, animBase, tabletMaterial, onProgress } = {}) {
  let api;
  try {
    const rig = await buildRigged({ avatarUrl, atlasUrl, animBase, tabletMaterial, onProgress });
    api = makeRigged(rig, { position, rotationY, tabletMaterial });
  } catch (err) {
    console.warn('[human] avatar failed to load, using low-poly fallback:', err);
    api = makeFallback({ position, rotationY, tabletMaterial });
    if (onProgress) onProgress(1);
  }
  if (scene) scene.add(api.group);
  return api;
}
