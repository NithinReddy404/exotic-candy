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
| `app.js` | The 3D scene (Three.js from a CDN), camera walk, shopkeeper, hotspots, state machine |
| `menu.js` | **The only source of the menu.** Categories, blurbs, items, prices, photos |

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

Search `app.js` for these tags.

| Tag | What is approximate | What replaces it |
|-----|---------------------|------------------|
| `APPROX-SIGN` | Sign letters are drawn on a canvas in the Fredoka font | The real logo file (PNG/SVG with transparency) |
| `APPROX-MURAL` | Wall art is procedural shapes in the photo palette | Straight-on photos of each mural wall |
| `APPROX-KEEPER` | Low-poly placeholder shopkeeper | A reference photo or a rigged character model |
| `APPROX-GOODS` | Shelf products are coloured blocks | Product photos (also used by the menu) |

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
