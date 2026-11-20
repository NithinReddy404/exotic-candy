# Exotic Candy & Munchies - realistic rebuild: module contract

Goal: the same experience as today (sidewalk -> See menu -> one continuous first-person walk ->
shopkeeper greets and presents a tablet -> menu -> explore hotspots) but photoreal-leaning
rendering, a real rigged human shopkeeper with natural behaviour, and smooth frame rates on
phones and laptops. It must read as a professional website, not a game: no HUD clutter, no
cartoon shading, muted natural lighting, correct scale.

This document is the binding contract between four files built in parallel. Names are binding.
Every builder owns ONLY the files listed under their task and must not edit any other file.

## Stack

- ES modules, no bundler. `index.html` has an import map:
  - `three` -> `https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js`
  - `three/addons/` -> `https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/`
- Import addons as `import { X } from 'three/addons/<path>.js'` (for example
  `three/addons/postprocessing/EffectComposer.js`, `three/addons/loaders/GLTFLoader.js`,
  `three/addons/geometries/RoundedBoxGeometry.js`, `three/addons/environments/RoomEnvironment.js`,
  `three/addons/lights/RectAreaLightUniformsLib.js`, `three/addons/postprocessing/GTAOPass.js`,
  `three/addons/postprocessing/UnrealBloomPass.js`, `three/addons/postprocessing/SMAAPass.js`,
  `three/addons/postprocessing/OutputPass.js`).
- Served statically (`python -m http.server 8787` from the repo root is already running at
  http://localhost:8787/). Nothing requires a build step.
- No vendor text, no invented store details: the store name is `window.EXOTIC_MENU.store.name`
  ("Exotic Candy & Munchies"), menu data only from `menu.js`.
- Deterministic: every module that uses randomness uses its own seeded LCG (no `Math.random`).

## World (metres, Y up, store depth runs along -Z)

Shared coordinate frame; DO NOT change these numbers, app.js' camera path depends on them.

- Store interior: x in [-4, 4], z in [0, -11], ceiling 3.4. Storefront opening at z=0,
  x in [-3.2, 3.2], 3.4 tall. White bulkhead above the opening up to the mall ceiling at 4.5.
  Pilasters x in [-4.8,-3.2] and [3.2,4.8].
- Mall corridor in front: z in [0, 12], x in [-7, 7], floor polished cream tile, mall ceiling
  4.5 with 0.6 x 1.2 light panels. The side stores can be plain (dark glass with mullions).
- Sign: dimensional bubble letters, centre (0, 3.05, 0.42), 4.6 x 1.26 face, hung by two thin
  rods from the mall ceiling at x=+-1.2.
- Logo mat on the mall floor: centre (0, 0.006, 1.0), 3.6 x 1.2.
- Interior floor: grey wood-look plank. Walls: teal slatwall band 0..2.3, graffiti mural above
  2.3..3.4; the left-front section z in [0,-4.2] is full-height mural. Drop ceiling with 0.6x1.2
  light panels at x=+-2, z = -1.5, -3.7, -5.9, -8.1, -10.3.
- Left wall shelving: from (-4, 0, -4.3) running -z for 6.2 m, products face +x.
- Right wall shelving: from (4, 0, -0.4) running -z for 7.5 m, products face -x.
- Back wall shelving: from (-3.9, 0, -11) running +x for 2.3 m and from (1.6, 0, -11) for 2.3 m,
  facing +z.
- Shelf boards at y = 0.28, 0.72, 1.16, 1.60 (0.36 deep). Black gable "mystery boxes" along a
  rail at y ~ 2.05, one every 0.6 m.
- Gondolas (centre islands, 1.0 x 0.85 x 1.8, long axis z): centres (-1.4, 0, -3.2) and
  (1.4, 0, -5.8). The lane |x| < 0.7 must stay clear: the camera walks through it.
- Chest freezer (0.75 x 0.85 x 1.6, long axis z): centre (-3.4, 0, -1.6).
- Three-door glass drink cooler (0.7 x 2.1 x 1.95, doors face -x): centre (3.6, 0, -9.3).
- Counter: centre (-0.3, 0, -10.0), 2.4 wide (x), 0.7 deep (z), top at 1.04. Teal slatwall front
  with the round logo; POS terminal on the right; candy jar on the left.
- Shopkeeper stands at (-0.3, 0, -10.75) facing +z. Head height ~1.58 (the avatar is ~1.75 m).
- Camera: eye height 1.62. Starts at (0.4, 1.62, 5.2) looking at (0, 2.3, 0). Walk path ends at
  (-0.2, 1.62, -8.3) looking at the shopkeeper's head.

## Files and owners

```
index.html        app.js owner (import map, HUD; unchanged structure)
app.js            app.js owner: boot, quality/adaptive loop, state machine, camera walk, HUD, menu
scene/textures.js A: all canvas-drawn textures + normal/roughness map generation
scene/env.js      A: renderer, environment, lights, post-processing, quality tiers, materials
scene/props.js    B: product batches and furniture builders
scene/store.js    B: exterior + interior assembly using props and materials
scene/human.js    C: rigged shopkeeper: load, animate, behave, present tablet, fallback
assets/           C: keeper.glb, keeper_atlas.png, anim/*.glb (local copies, no CDN dependency)
```

Every module must `import * as THREE from 'three'` and never touch the DOM except where stated.

## A. `scene/textures.js` and `scene/env.js`

### textures.js exports

```js
export function heightToNormal(canvas, strength = 2) // -> THREE.CanvasTexture (NoColorSpace), RepeatWrapping
export function makeTextures(seed = 7) // -> object below; call once
```
`makeTextures` returns:

| key | content | notes |
|-----|---------|-------|
| `tile` | `{map, normalMap, roughnessMap}` 1 m polished cream mall tile with grout, subtle veining | repeat set per use by caller via `.clone()`; provide `tile.size = 1` |
| `wood` | `{map, normalMap, roughnessMap}` 1 m x 1 m grey-washed oak planks (4 planks across), real grain, bevel lines | |
| `ceiling` | `{map, normalMap}` 1.2 m: 2x2 mineral-fibre tiles with grid | |
| `tealSlat` | `{map, normalMap}` 1 m x 1 m teal slatwall (#2ab4c4 base), grooves every 76 mm | |
| `whiteSlat` | same, white | |
| `cream` | `{map, roughnessMap}` 1 m painted drywall with faint texture | |
| `sign` | `{map}` 2048x560 transparent, bubble letters: EXOTIC (purple #7a3fd3 fill, white outline), CANDY (white fill, purple outline, larger), & MUNCHIES (purple, white outline); include a soft inner bevel/gradient so letters look dimensional | use font `"Fredoka", "Arial Rounded MT Bold", "Arial Black", sans-serif`, bold 700 |
| `badge` | `{map}` 512 round black badge with rainbow conic ring and the three words | |
| `mat` | `{map, normalMap}` 2048x683 black entrance mat with three badges and carpet fibre texture | |
| `mural(w, h, variant)` | function -> `{map}` graffiti mural: purple gradient field, teal angled panels, bubble blobs (orange/yellow/pink/lime/aqua) with white outlines and highlights, white starbursts, drips, palm fronds; variant 2 adds the store name in yellow bubble letters with purple outline as a header; make it look spray-painted (soft edges, slight overspray noise) | sizes up to 2048 wide |
| `poster(tagline)` | `{map}` 512x768 framed poster: purple top with the wordmark, teal bottom with the tagline lines | |
| `lightbox(text)` | `{map}` 1024x256 white lightbox with blue bold text | |
| `tablet` | `{map}` 512x384 tablet screen: purple header "MENU", list of category names from `window.EXOTIC_MENU.categories` | |
| `freezerWrap` | `{map}` 1024x512 purple->teal gradient with the badge | |
| `labels` | `{map}` 1024x1024 atlas of 16 (4x4) distinct snack package labels: bold brand-like shapes, stripes, bursts, flavour words that are generic ("SPICY", "SOUR", "CHOCO", "LIMON", "COLA", "GUMMY") in many colours; also `labels.cells = 4` | used by props.js: each instance picks one cell via UV offset |

All colour textures: `colorSpace = THREE.SRGBColorSpace`, `wrapS = wrapT = RepeatWrapping`,
`anisotropy = 8`, `generateMipmaps` default. Data textures (normal/roughness): `NoColorSpace`.

### env.js exports

```js
export const QUALITY = { ultra: {...}, high: {...}, medium: {...}, low: {...} };
// fields: pixelRatio (cap), shadows (bool), shadowMap (512|1024|2048), ao (bool), bloom (bool),
//         smaa (bool), anisotropy, envIntensity, maxLights
export function detectTier() // 'ultra'|'high'|'medium'|'low' from UA/mobile, hardwareConcurrency,
                              // devicePixelRatio, WEBGL_debug_renderer_info string (Apple/Adreno/Mali -> medium, Intel -> high, NVIDIA/AMD/Radeon RX -> ultra)
export function createRenderer(canvas, tier) // WebGLRenderer: antialias when !smaa, ACESFilmic, exposure 1.0, sRGB output,
                                              // shadowMap enabled PCFSoft when tier.shadows, setPixelRatio(min(dpr, tier.pixelRatio))
export function setupEnvironment(renderer, scene) // PMREM from RoomEnvironment; scene.environment set; scene.environmentIntensity from tier;
                                                  // scene.background = neutral cream (#cfcbc3); scene.fog none
export function addLights(scene, tier) // -> { all: Light[], setInterior(bool) }
   // mall: RectAreaLights for corridor panels (RectAreaLightUniformsLib.init()), one shadow-casting DirectionalLight from above-front (soft, low intensity) for contact shadows
   // store: RectAreaLights on the five ceiling-panel rows (warm white 3500K), a shadow-casting SpotLight over the counter, fill PointLights kept <= tier.maxLights
   // intensities must be tuned so the exterior is bright mall daylight and the interior is bright retail (no dark corners), nothing blown out with exposure 1.0
export function materials(T, tier) // T = makeTextures() result -> M object (names below). All MeshStandard/Physical.
export function createPost(renderer, scene, camera, tier) // -> { render(dt), setSize(w, h), setCamera(camera), setTier(tier) }
   // EffectComposer: RenderPass -> GTAOPass (if ao; radius ~0.25 m, scale tuned for 1.6 m eye height) -> UnrealBloomPass (if bloom; threshold 0.9, strength 0.25, radius 0.4) -> SMAAPass (if smaa) -> OutputPass
   // when the tier has no passes at all, render() just calls renderer.render
```

`M` material names (all must exist; builders B and C use them):
`floorTile` (Physical: clearcoat 0.6, roughness 0.25, tile maps, repeat set by caller via `M.floorTile.clone()` + map clone),
`floorWood` (Standard, roughness 0.7), `ceiling`, `wallCream`, `tealSlat`, `whiteSlat`,
`white` (shelf laminate, roughness 0.5), `black` (matte), `darkGloss` (POS plastics, roughness 0.3),
`steel` (brushed, metalness 0.9, roughness 0.35), `aluminum` (door frames), `glass` (Physical: transmission 0.92, thickness 0.01, roughness 0.05, ior 1.5, transparent),
`frostedGlass` (freezer lid), `mural(w,h,variant)` (function returning a new Standard material),
`sign` (Basic/emissive-ish letters: MeshStandard with emissive = map, emissiveIntensity 0.35, transparent, alphaTest 0.5, side Double),
`signSide` (dark purple for the letter depth), `badge`, `mat` (rough fabric, roughness 1), `poster`, `lightbox(text)` (function), `lightPanel` (MeshStandard emissive warm white, emissiveIntensity 2.5),
`neighborGlass` (dark glass), `tablet` (screen, emissive), `freezerWrap`,
`labels` (Standard with the atlas map; props.js offsets UVs per instance), `product` (Standard white base for vertex/instance colours, roughness 0.45).

Provide `M.textures = T` so other builders can reach raw textures.

## B. `scene/props.js` and `scene/store.js`

### props.js exports

```js
export class ProductBatches {
  constructor(M)                       // builds geometries once: bag (RoundedBox 1x1x1 r0.12, slightly pillowed by scaling), box (RoundedBox r0.02),
                                       // bottle (LatheGeometry: 0.5 L soda bottle shape with neck + cap), can (Cylinder 12-segs with rim), jar (Cylinder, glass)
  addBag(x,y,z,ry,w,h,d,color,cell)    // cell 0..15 picks a label atlas cell (per-instance UV offset via an InstancedBufferAttribute 'uvOffset' and onBeforeCompile on M.labels)
  addBox(x,y,z,ry,w,h,d,color,cell)
  addBottle(x,y,z,color,scale=1)       // 0.065 m wide, 0.23 m tall at scale 1; colour tints the liquid/label
  addCan(x,y,z,color)                  // 0.066 x 0.123
  build(scene)                         // creates InstancedMeshes with castShadow = receiveShadow = true, frustumCulled true
}
export function fillRun(batches, start, dir, length, out, y, kind)   // kind 'bag'|'box'|'bottle'|'can'|'mixed'; packs items with realistic spacing and slight random yaw/tilt
export function wallShelves(scene, M, batches, start, dir, length, out, opts)  // white laminate boards with front edge bevel, uprights every 1.2 m, white slatwall backing, products, mystery boxes on the rail
export function gondola(scene, M, batches, x, z, lengthZ = 1.8)   // white island with a top lip, mid shelf, products both sides
export function freezer(scene, M, x, z)      // chest freezer: wrapped body, white lid frame, frosted glass sliding lid, small interior light
export function cooler(scene, M, batches, x, z)   // hollow steel cabinet, three real glass doors (M.glass) with aluminium frames and handles, four wire shelves of bottles and cans, lit header "DRINKS" (M.lightbox), interior strip light
export function counter(scene, M, x, z)      // per the world spec; returns { top: Mesh } ; POS terminal, card reader, candy jar, a small acrylic sign holder
export function ceilingLights(scene, M, positions, y)  // recessed 0.6x1.2 panels (M.lightPanel) with a thin frame
```
Realism rules for props: bevels on edges (RoundedBoxGeometry), nothing floats, products sit on
shelves (bottom at shelf top + 0.002), consistent 0.36 m shelf depth, two or three rows deep on
wall shelves so shelves look stocked, bags lean back ~6 degrees, bottles in neat rows. Keep the
total under ~2,500 instances and ~250k triangles.

### store.js exports

```js
export function buildExterior(scene, M)       // corridor, pilasters, bulkhead, side fronts, sign (letters as an extruded look: front plane + 0.06 m depth made of a second plane set and a dark side strip), rods, mat, benches, corridor ceiling panels
export function buildInterior(scene, M, tier)  // everything inside per the world spec, using props.js; returns { batches }
```
All architecture meshes: `receiveShadow = true`; furniture: `castShadow = receiveShadow = true`.
Use `M.floorTile.clone()` style when a repeat differs. Do not add lights (env.js owns lights).

## C. `scene/human.js` and `assets/`

The shopkeeper is a real rigged human: the Ready Player Me masculine avatar from the open
animation library (same skeleton as its clips). Base file already at `assets/keeper_base.glb`
(2.6 MB, mesh `Wolf3D_Avatar`, bones Hips/Spine/Spine1/Spine2/Neck/Head/LeftEye/RightEye/
LeftShoulder/LeftArm/LeftForeArm/LeftHand/RightShoulder/.../RightHand, legs; no morph targets).
Clips: `https://cdn.jsdelivr.net/gh/readyplayerme/animation-library@master/masculine/glb/<folder>/<name>.glb`
with folders `idle` (M_Standing_Idle_001, _002, M_Standing_Idle_Variations_001..010),
`expression` (M_Standing_Expressions_001..018, M_Talking_Variations_001..010). Preview images:
`https://raw.githubusercontent.com/readyplayerme/animation-library/master/masculine/webp/<folder>/<name>.webp`.
Download the chosen clips into `assets/anim/` and the final avatar into `assets/keeper.glb`
so the site has no runtime dependency on GitHub.

Appearance target (reference photo at
`C:\Users\knith\AppData\Local\Temp\claude\C--Users-knith--claude-spares-spare-SRoRKT\1b12d90e-53f7-414d-8cb0-473af85f4261\scratchpad\assets\keeper_reference.jpg`):
young South Asian man, warm medium-brown skin, short neat dark hair, short dark beard, cream
knitted short-sleeve polo, light-blue straight jeans, white sneakers with a dark swoosh-like
stripe. Produce `assets/keeper_atlas.png` by repainting the avatar's embedded base-colour atlas
(extract it from the glb with Python; the atlas layout: face top-left, eye top-right, pants
top-middle, shoes right-middle, shirt bottom-left, teeth bottom-middle): recolour shirt to cream
with a knit pattern and a collar line, pants to light denim with seams, shoes white with a dark
stripe, skin to a warm medium-brown, hair to near-black, add beard shading on the lower face
region. Load the glb and swap the material's `map` for this atlas at runtime (keep the normal
map). Document in the module docstring which regions you changed and that a photo-exact face
needs a Ready Player Me avatar made from the photo (`shopkeeper.avatarUrl` in menu.js overrides
the local file; the loader must accept any RPM-compatible glb).

### human.js exports

```js
export async function loadShopkeeper({ scene, position, rotationY, avatarUrl, atlasUrl, animBase, tabletMaterial, onProgress })
// -> { group, update(dt, camera), setMode(mode), headPosition(target: Vector3), talk(ms), dispose() }
```
Behaviour (this is the "acts like a human" part; write it from how shop staff really behave):
- `idle`: loops M_Standing_Idle clips, crossfading to a random variation every 8-15 s; while
  the visitor is far (> 6 m) he glances down at the tablet he holds at waist height (right hand),
  looks up for 1-2 s every ~6 s, slight weight shifts come from the clips.
- `greet` (called when the visitor arrives): head and eyes turn to the camera within 0.4 s (eyes
  lead, head follows, neck shares ~40% of the rotation, spine ~15%), a short wave or nod from an
  expression clip (pick one by looking at the previews), then `present`.
- `present`: right arm raises so the tablet faces the camera at chest height, held steady with a
  tiny breathing drift; left hand rests; he keeps eye contact but breaks it naturally every 4-7 s
  for 0.5 s (glance at the tablet), nods once when `talk()` is called.
- `talk(ms)`: blend in a Talking_Variations clip for the duration (gestures), then back.
- If the camera moves more than 50 degrees off his facing, he turns his body toward it over 0.6 s
  (rotate `group` yaw, feet shuffle from the idle clip is acceptable).
- Procedural look-at: after `mixer.update(dt)` each frame, slerp Head/Neck/Spine2/eye bone
  quaternions toward the target with limits (head yaw +-60 deg, pitch +-30 deg; eyes +-25 deg).
- Tablet: build a 0.26 x 0.18 x 0.008 black slab with a screen plane using `tabletMaterial`,
  attached to the `RightHand` bone with an offset so it sits in the palm; in `present` the right
  arm pose is procedural (RightArm/RightForeArm/RightHand quaternions slerped to a stored
  presenting pose that was tuned by eye), overriding the clip for those bones only.
- Fallback: if the glb or atlas fails to load, build a simple low-poly figure (capsules, same
  API) so the site never breaks offline.
- All skinned meshes: `castShadow = true`, `frustumCulled = false`.
- Keep per-frame cost small: no allocations in `update`.

Make `assets/human-test.html` (a standalone page using the import map) that loads the
shopkeeper in a simple lit room and cycles idle -> greet -> present -> talk, to verify the
module in the browser pane.

## app.js (integration, done after A, B, C)

Boots: detectTier -> createRenderer -> setupEnvironment -> materials -> buildExterior -> first
frame -> buildInterior + loadShopkeeper in the background -> createPost. Adaptive quality: if the
average frame time over 3 s exceeds 22 ms, step down one tier (pixel ratio and passes); never
step up. The state machine, camera walk, HUD, menu and hotspots stay as they are today.

## Definition of done per builder

1. Module loads with no console errors under the import map above.
2. A standalone test page under `scene/test-<module>.html` (or `assets/human-test.html`)
   renders the module alone; checked in the browser pane in a tab the builder created itself
   (`tabs_create`, then always pass that tabId).
3. `node --check <file>` passes for every JS file.
4. No edits outside the owned files.
