// Cathedral Studio — trusted server-side product catalog.
//
// This mirrors products.js but is the ONLY price source the edge function
// trusts. Client-side prices from the cart's localStorage are never used
// to compute Stripe line items; the client only supplies { id, qty }.
//
// If products.js changes, this file must be updated in the same commit —
// a divergence would mean the storefront quotes one price and Stripe
// charges another. There is an integration test that fails if any id in
// products.js is missing here.

export type CatalogItem = {
  id: string;
  name: string;
  // Integer cents. Never a float — floating-point drift on repeated
  // addition is unacceptable for garments priced $135–$1,450.
  unitAmount: number;
};

export const CURRENCY = "usd";

// Shipping matches cart.js: free at or above $1,000 subtotal, else $15 flat.
export const FREE_SHIPPING_THRESHOLD_CENTS = 100_000;
export const FLAT_SHIPPING_CENTS = 1_500;

// Matches Cart.MAX_QTY_PER_LINE in cart.js.
export const MAX_QTY_PER_LINE = 10;

// Ceiling on cart lines. The client cart caps at 28 (14 men + 14 women)
// but the edge function must defend against a hand-crafted request.
export const MAX_CART_LINES = 50;

export const CATALOG: Record<string, CatalogItem> = {
  "men-01": { id: "men-01", name: "Nave Overcoat",         unitAmount: 145_000 },
  "men-02": { id: "men-02", name: "Cloister Trench",       unitAmount:  98_000 },
  "men-03": { id: "men-03", name: "Sacristy Field Jacket", unitAmount:  78_000 },
  "men-04": { id: "men-04", name: "Buttress Chore Coat",   unitAmount:  56_000 },
  "men-05": { id: "men-05", name: "Ambo Blazer",           unitAmount:  89_000 },
  "men-06": { id: "men-06", name: "Chancel Trouser",       unitAmount:  41_000 },
  "men-07": { id: "men-07", name: "Transept Denim",        unitAmount:  34_000 },
  "men-08": { id: "men-08", name: "Compline Cardigan",     unitAmount:  69_000 },
  "men-09": { id: "men-09", name: "Lauds Turtleneck",      unitAmount:  52_000 },
  "men-10": { id: "men-10", name: "Rood Screen Sweater",   unitAmount:  42_000 },
  "men-11": { id: "men-11", name: "Vespers Knit Polo",     unitAmount:  29_000 },
  "men-12": { id: "men-12", name: "Matins Oxford Shirt",   unitAmount:  26_000 },
  "men-13": { id: "men-13", name: "Narthex Tee",           unitAmount:  13_500 },
  "men-14": { id: "men-14", name: "Reliquary Scarf",       unitAmount:  21_000 },
  "women-01": { id: "women-01", name: "Sanctuary Coat",     unitAmount: 138_000 },
  "women-02": { id: "women-02", name: "Apse Trench",        unitAmount:  92_000 },
  "women-03": { id: "women-03", name: "Basilica Blazer",    unitAmount:  86_000 },
  "women-04": { id: "women-04", name: "Aisle Trouser",      unitAmount:  39_000 },
  "women-05": { id: "women-05", name: "Litany Wide-Leg",    unitAmount:  41_000 },
  "women-06": { id: "women-06", name: "Chantry Skirt",      unitAmount:  38_000 },
  "women-07": { id: "women-07", name: "Requiem Slip Skirt", unitAmount:  31_000 },
  "women-08": { id: "women-08", name: "Verona Slip Dress",  unitAmount:  65_000 },
  "women-09": { id: "women-09", name: "Gloria Knit Dress",  unitAmount:  46_000 },
  "women-10": { id: "women-10", name: "Vestry Cardigan",    unitAmount:  61_000 },
  "women-11": { id: "women-11", name: "Choir Turtleneck",   unitAmount:  48_000 },
  "women-12": { id: "women-12", name: "Rosary Blouse",      unitAmount:  34_000 },
  "women-13": { id: "women-13", name: "Psalter Camisole",   unitAmount:  22_000 },
  "women-14": { id: "women-14", name: "Halo Scarf",         unitAmount:  19_500 },
};
