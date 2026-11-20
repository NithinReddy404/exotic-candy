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
| `scene/catalog.js` | Loads `data/products.json`, picks the shelf products, builds the photo atlas, fetches live prices |
| `data/products.json` | Catalog snapshot from exoticsnackguys.com (`scripts/sync_products.py` refreshes it) |
| `menu.js` | Store name, greeting, shopkeeper avatar URL, and the fallback categories if the catalog is missing |
| `docs/ARCHITECTURE.md` | The module contract the scene was built against |

Test pages: `scene/test-env.html` (materials and lighting per tier), `scene/test-store.html`
(geometry), `assets/human-test.html` (shopkeeper modes). Force a quality tier with
`?tier=ultra|high|medium|low`.

## Quality tiers and performance

The tier is picked from the GPU string, device type and memory, then an adaptive governor steps
down one tier whenever two consecutive 3-second windows average more than 22 ms per frame.

| Tier | Typical device | What it adds |
|------|----------------|--------------|
| ultra | NVIDIA / AMD desktop GPU | 2x pixel ratio, 2048 shadow maps, full-res ambient occlusion, bloom, vignette and grain, SMAA, glass refraction, 9 area lights, real HDRI lighting |
| high | Intel Iris/Xe, Apple desktop | 1.5x pixel ratio, half-res ambient occlusion, bloom, vignette and grain, SMAA, 9 area lights, real HDRI lighting |
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

## The products

Every product on the shelves and in the menu is pulled from the store's own site,
https://www.exoticsnackguys.com (Shopify): 954 published products across Candy, Chips,
Chocolate, Cookies, Drinks, Cereal, Ramen & Noodles, Pickles, Sparkling Water, Mystery Box and
New Arrivals, with the store's photo, price, weight, description and country of origin (from the
store's own tags; 916 of 954 have one). The snapshot lives in `data/products.json`.

- **On the shelves:** 256 of them stand on the 3D shelves with their real packaging photo, grouped
  the way the store groups them (candy on the left wall, chips/cookies/chocolate on the right,
  noodles and cereal at the back, new arrivals on the centre island, drinks in the cooler).
- **Point or tap:** hovering a package shows its name, price and origin; tapping opens a card
  with the photo, description, weight, country, a "Buy on exoticsnackguys.com" link, and the
  **live price and stock** fetched from the store at that moment (the card says "live price"
  once it has it, or "price as of last sync" if the store cannot be reached).
- **Menu:** every product, by category, with search across names and countries.

### Refreshing the catalog

```bash
python scripts/sync_products.py
```

The store rate-limits scripts hard, so the sync goes slowly (about 6 s per request). If it is
blocked from your network, open https://www.exoticsnackguys.com/collections/chips/products.json
in a browser, open the developer console and run the snippet below; it prints the JSON to copy
into `data/products.json`.

```js
(async () => { const cats = { candy: 'candy-1', chips: 'chips', chocolate: 'snacks', cookies: 'others', drinks: 'drinks', cereal: 'cereals', noodles: 'noodles', pickles: 'pickles', sparkling: 'sparkling-water', mystery: 'mystery-box', new: 'new-products' };
const strip = (h) => (h || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); const base = 'https://cdn.shopify.com/s/files/1/0758/3475/3331/files/'; const out = new Map();
for (const [key, h] of Object.entries(cats)) for (let page = 1; page < 20; page++) { const r = await fetch(`/collections/${h}/products.json?limit=250&page=${page}`); const d = await r.json(); if (!d.products.length) break;
for (const p of d.products) { const v = p.variants[0] || {}; const img = p.images[0]?.src || null; const rec = out.get(p.id) || { id: p.id, handle: p.handle, title: p.title, price: v.price, compare: v.compare_at_price, available: !!v.available, grams: v.grams, image: img && img.startsWith(base) ? img.slice(base.length) : img, type: p.product_type, cats: [], origin: null, desc: strip(p.body_html).slice(0, 160), tags: p.tags }; if (!rec.cats.includes(key)) rec.cats.push(key); out.set(p.id, rec); }
await new Promise((r) => setTimeout(r, 1500)); if (d.products.length < 250) break; }
console.log(JSON.stringify({ source: 'https://www.exoticsnackguys.com', fetched_at: new Date().toISOString(), image_base: base, categories: cats, products: [...out.values()] })); })();
```

(The console version leaves `origin` null and keeps `tags`; `scripts/sync_products.py` shows
the tag-to-country mapping if you want to fill it in.)

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
- The visit starts on the mat at the entrance. **See menu** (or Enter/Space with the 3D view focused) walks in.
- **Skip tour** opens the same menu immediately without walking.
- **Start over** cuts straight back to the entrance. **Back to counter** returns from a hotspot.
- Hotspots: Candy shelves, New arrivals, Chips & cookies, Drink cooler, Freezer. Point at or tap any package for its price and origin. Esc closes cards and the menu.
- **Voice** is off by default; when on, the greeting is spoken with the browser's own voice.
- Reduced-motion users and devices without WebGL get the direct menu view automatically.
