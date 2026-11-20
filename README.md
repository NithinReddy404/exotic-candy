# Exotic Candy & Munchies - 3D store site

A first-person, interactive 3D website for the Exotic Candy & Munchies shop. You start on the
mall corridor facing the storefront, tap **See menu**, walk through the open entrance in one
continuous shot, and the shopkeeper at the back counter looks up, greets you and turns a tablet
toward you while the real menu opens beside them. No headset needed: it runs in any phone or
desktop browser.

## Run it

The page uses ES modules, so it needs to be served over http (any static host works, including
GitHub Pages). Locally:

```bash
python -m http.server 8787
```

Then open http://localhost:8787/ . Add `?menu` to open the direct (non-3D) menu view.

## Files

| File | What it is |
|------|------------|
| `index.html` | Page shell, HUD buttons, menu panel, direct-menu fallback |
| `styles.css` | Styling; the menu is a side panel on desktop and a bottom sheet on phones |
| `app.js` | Boot, quality tiers, camera walk, HUD, menu, hotspots, state machine |
| `scene/env.js` | Renderer, lighting, environment, post-processing (ambient occlusion, bloom, SMAA), PBR materials, quality tiers |
| `scene/textures.js` | Every texture, drawn procedurally with normal and roughness maps (sign, murals, tile, wood, slatwall, labels) |
| `scene/store.js`, `scene/props.js` | Mall corridor, storefront, shelving, ~2,300 instanced products, gondolas, cooler, freezer, counter |
| `scene/human.js` | The rigged shopkeeper: clip playback, look-at, body turn, tablet hold and present poses, fallback figure |
| `assets/` | `keeper.glb` (rigged avatar), `keeper_atlas.png` (repainted skin and clothes), `anim/*.glb` (idle, wave, nod, talking clips) |
| `menu.js` | **The only source of the menu.** Categories, blurbs, items, prices, photos, shopkeeper avatar URL |
| `docs/ARCHITECTURE.md` | The module contract the scene was built against |

Test pages: `scene/test-env.html` (materials and lighting per tier), `scene/test-store.html`
(geometry), `assets/human-test.html` (shopkeeper modes). Force a quality tier with
`?tier=ultra|high|medium|low`.

## Quality tiers and performance

The tier is picked from the GPU string, device type and memory, then an adaptive governor steps
down one tier whenever two consecutive 3-second windows average more than 22 ms per frame.

| Tier | Typical device | What it adds |
|------|----------------|--------------|
| ultra | NVIDIA / AMD desktop GPU | 2x pixel ratio, 2048 shadow maps, full-res ambient occlusion, bloom, SMAA, glass refraction, 7 area lights |
| high | Intel Iris/Xe, Apple desktop | 1.5x pixel ratio, half-res ambient occlusion, bloom, SMAA, 7 area lights |
| medium | phones, Intel UHD | 1.5x pixel ratio, shadows, hemisphere + environment lighting, no post-processing |
| low | software GL, 2 GB devices | 1x pixel ratio, no shadows, no post-processing |

Measured in the desktop app's browser pane on an Intel UHD iGPU at 810x895: medium 63 fps,
low 82 fps. A phone-sized viewport on medium ran at 79 fps.

## The shopkeeper

He is a rigged Ready Player Me avatar driven by motion-capture clips from the open RPM animation
library (idle variations, a left-hand wave, a nod, two talking gestures), with a procedural layer
on top: eyes lead and the head follows the visitor, eye contact breaks naturally, the body turns
when you move around him, he glances at the tablet while nobody is near, and he presents the
tablet toward the camera at the counter. The skin, hair, beard, cream knit polo, light denim and
white sneakers were painted onto the avatar's texture atlas from the reference photo.

For a photo-exact face, make an avatar from the photo at https://demo.readyplayer.me/avatar
(guest mode, no account), copy its `.glb` link and paste it into `shopkeeper.avatarUrl` in
`menu.js`. The loader accepts any RPM-compatible avatar. The base avatar has no facial morph
targets, so he does not blink or move his mouth; an RPM avatar exported with
`?morphTargets=ARKit,Oculus Visemes` will, automatically.

## Adding products and prices

Nothing in the menu is invented. The four categories and their one-line blurbs come from the
Candy Guys concept deck (global candy, exotic snacks, specialty drinks, fun finds), shown as
Candy, Chips & Savory Snacks, Drinks and New Arrivals. Each category's `items` list is empty
until you add real products:

```js
items: [
  { name: "Product name", price: "$4.49", photo: "photos/product.jpg", note: "Country" },
]
```

Put photos in a `photos/` folder next to `index.html`. `price` and `note` are optional.

## What the 3D scene reproduces from the photos

- Inline mall storefront: wide open entrance under a white bulkhead, no door (the real store has
  no door, so the walk crosses the threshold directly).
- Dimensional bubble-letter sign hung from the ceiling in front of the opening: purple
  "EXOTIC", white "CANDY", purple "& MUNCHIES".
- Purple and teal graffiti-mural walls with teal slatwall below, white slatwall shelving, black
  gable "mystery boxes" along the top rail, white centre gondolas, a wrapped chest freezer by the
  left wall near the entrance, a three-door glass drink cooler with a lit header, a black logo mat
  on the mall tile outside the entrance, grey wood-look floor inside, drop ceiling with panel lights.
- Counter at the back under the round logo, shopkeeper behind it holding a tablet.

## Temporary approximations (replace when you have the asset)


| Tag | What is approximate | What replaces it |
|-----|---------------------|------------------|
| sign | Sign letters are drawn on a canvas in the Fredoka font with a bevel normal map | The real logo file (PNG/SVG with transparency) |
| murals | Wall art is procedural spray-paint shapes in the photo palette | Straight-on photos of each mural wall |
| shopkeeper | Rigged avatar repainted to match the photo; the face is the avatar's, not his | An RPM avatar made from the photo (see above) |
| products | Packages are generic shapes with a 16-design label atlas | Product photos (also used by the menu) |

## Photos still needed

The Instagram photos cover the storefront from the corridor and the interior from the entrance.
These angles are missing and are currently approximated:

1. The counter and the wall behind it, straight on (placement, height, what sits on it).
2. The left wall from the freezer to the back (where candy shelving starts).
3. The right wall near the back, where the drink cooler sits.
4. The shopkeeper, if the character should resemble a real person.
5. The real logo file, so the sign, mat and badges are exact.

## Controls

- Mouse drag, touch swipe, or arrow keys to look around.
- **See menu** (or Enter/Space with the 3D view focused) walks in.
- **Skip tour** opens the same menu immediately without walking.
- **Back outside** walks back to the corridor. **Back to counter** returns from a hotspot.
- Hotspots: Candy shelves, Snack aisle, Drink cooler, New arrivals, Freezer. Esc closes the menu.
- **Voice** is off by default; when on, the greeting is spoken with the browser's own voice.
- Reduced-motion users and devices without WebGL get the direct menu view automatically.
