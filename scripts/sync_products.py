"""Refresh data/products.json from the store's own Shopify site (exoticsnackguys.com).

Usage:  python scripts/sync_products.py            (writes data/products.json)
        python scripts/sync_products.py --dry-run  (prints counts only)

The site rate-limits non-browser clients aggressively (HTTP 429 "local_rate_limited"), so this
script goes slowly: one request every 6 seconds with long retries. If it still cannot get
through from your network, open https://www.exoticsnackguys.com/collections/chips/products.json
in a browser tab, paste the snippet from README.md ("Refreshing the catalog") into the console,
and save the result as data/products.json. Both paths produce the same schema (see
scene/catalog.js for how it is consumed).

Only published products are returned by the public feed; nothing is invented or edited here.
"""
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.exoticsnackguys.com"
IMAGE_BASE = "https://cdn.shopify.com/s/files/1/0758/3475/3331/files/"
CATEGORIES = {
    "candy": "candy-1", "chips": "chips", "chocolate": "snacks", "cookies": "others", "drinks": "drinks",
    "cereal": "cereals", "noodles": "noodles", "pickles": "pickles", "sparkling": "sparkling-water",
    "mystery": "mystery-box", "new": "new-products",
}
COUNTRY_TAGS = {
    "usa": "United States", "united states": "United States", "america": "United States", "american": "United States",
    "uk": "United Kingdom", "united kingdom": "United Kingdom", "england": "United Kingdom", "british": "United Kingdom",
    "korea": "South Korea", "korean": "South Korea", "south korea": "South Korea", "uae": "United Arab Emirates",
    "dubai": "United Arab Emirates", "tokyo": "Japan",
}
KNOWN = [
    "China", "Mexico", "Japan", "Germany", "India", "Australia", "Taiwan", "Turkey", "Canada", "Sweden", "France",
    "Brazil", "Indonesia", "Spain", "Thailand", "Poland", "Vietnam", "Netherlands", "Egypt", "Pakistan", "Greece",
    "Belgium", "Malaysia", "Nepal", "Italy", "Cyprus", "New Zealand", "Romania", "Czech Republic", "Ireland",
    "Bulgaria", "Bosnia and Herzegovina", "Philippines", "Singapore", "Hong Kong", "Switzerland", "Austria",
    "Denmark", "Israel", "Serbia", "Croatia", "Lebanon", "Ukraine", "Honduras", "Argentina", "Chile", "Peru",
    "Colombia", "Portugal", "Russia", "Saudi Arabia", "South Africa", "Morocco", "Finland", "Hungary", "Iraq",
    "Jordan", "Guatemala", "Bangladesh", "Barbados", "Trinidad and Tobago", "Jamaica", "Nigeria", "Ghana", "Iran",
    "Norway", "United Arab Emirates",
]
KNOWN_LOWER = {k.lower(): k for k in KNOWN}
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "application/json"}


def get_json(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                body = r.read().decode("utf-8")
            if body.startswith("local_rate_limited"):
                raise RuntimeError("rate limited")
            return json.loads(body)
        except Exception as e:  # noqa: BLE001 - retry everything, the site is flaky for scripts
            wait = 20 * (i + 1)
            print(f"  retry {url.split('/collections/')[-1]}: {e}; waiting {wait}s", flush=True)
            time.sleep(wait)
    return None


def strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()


def origin_from_tags(tags):
    for t in tags:
        key = t.strip().lower()
        if key in KNOWN_LOWER:
            return KNOWN_LOWER[key]
        if key in COUNTRY_TAGS:
            return COUNTRY_TAGS[key]
    return None


def main():
    dry = "--dry-run" in sys.argv
    products = {}
    for key, handle in CATEGORIES.items():
        n = 0
        for page in range(1, 20):
            data = get_json(f"{BASE}/collections/{handle}/products.json?limit=250&page={page}")
            time.sleep(6)
            if not data or not data.get("products"):
                break
            for p in data["products"]:
                v = (p.get("variants") or [{}])[0]
                img = (p.get("images") or [{}])[0].get("src")
                if img and img.startswith(IMAGE_BASE):
                    img = img[len(IMAGE_BASE):]
                rec = products.setdefault(p["id"], {
                    "id": p["id"], "handle": p["handle"], "title": p["title"], "price": v.get("price"),
                    "compare": v.get("compare_at_price"), "available": bool(v.get("available")),
                    "grams": v.get("grams", 0), "image": img, "type": p.get("product_type", ""), "cats": [],
                    "origin": origin_from_tags(p.get("tags") or []), "desc": strip_html(p.get("body_html"))[:160],
                })
                if key not in rec["cats"]:
                    rec["cats"].append(key)
                n += 1
            if len(data["products"]) < 250:
                break
        print(f"{key:10s} {n}", flush=True)
    out = {
        "source": BASE, "fetched_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "image_base": IMAGE_BASE, "categories": CATEGORIES, "products": list(products.values()),
    }
    print(f"{len(out['products'])} unique products, {sum(1 for p in out['products'] if p['origin'])} with an origin")
    if dry:
        return
    path = Path(__file__).resolve().parent.parent / "data" / "products.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("wrote", path)


if __name__ == "__main__":
    main()
