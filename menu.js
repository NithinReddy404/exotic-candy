// Menu data for Exotic Candy & Munchies.
// This is the ONLY place the menu comes from. Nothing here is invented:
// the four categories and their blurbs come from the Candy Guys concept deck
// (Global Candy / Exotic Snacks / Specialty Drinks / Fun Finds), renamed to the
// shopper-facing labels requested for the site.
//
// To add real products, append objects to a category's `items` array:
//   { name: "Takis Fuego 3.5oz", price: "$4.49", photo: "photos/takis.jpg", note: "Mexico" }
// `photo` is a path relative to index.html (or a full URL). `price` and `note`
// are optional strings and are shown exactly as written.
window.EXOTIC_MENU = {
  store: {
    name: "Exotic Candy & Munchies",
    short: "Exotic Candy & Munchies",
    tagline: "A world of candy. A store worth discovering.",
    greeting: "Hey, welcome in! Here's what we've got — take a look.",
  },
  categories: [
    {
      id: "candy",
      name: "Candy",
      blurb: "Imported gummies, sweets and chocolates from around the world.",
      items: [],
    },
    {
      id: "snacks",
      name: "Chips & Savory Snacks",
      blurb: "International chips, cookies and treats.",
      items: [],
    },
    {
      id: "drinks",
      name: "Drinks",
      blurb: "Novelty sodas and global beverage flavors.",
      items: [],
    },
    {
      id: "new",
      name: "New Arrivals",
      blurb: "Seasonal, giftable and trending finds. Rotates often.",
      items: [],
    },
  ],
};
