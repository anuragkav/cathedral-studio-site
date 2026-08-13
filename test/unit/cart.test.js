const { test } = require("node:test");
const assert = require("node:assert/strict");
const Cart = require("../../cart.js");

const SAMPLE_ITEM = { id: "men-01", name: "Nave Overcoat", price: 1450, cat: "Outerwear", fabric: "Doubleface wool" };
const CHEAP_ITEM = { id: "men-13", name: "Narthex Tee", price: 135, cat: "Jersey", fabric: "Heavyweight cotton" };

test("createEmptyCart returns an empty items array", () => {
  assert.deepEqual(Cart.createEmptyCart(), { items: [] });
});

test("addItem adds a new line with default qty 1", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].id, "men-01");
  assert.equal(cart.items[0].qty, 1);
});

test("addItem does not mutate the input cart", () => {
  const original = Cart.createEmptyCart();
  const originalItemsRef = original.items;
  Cart.addItem(original, SAMPLE_ITEM);
  assert.equal(original.items.length, 0);
  assert.equal(original.items, originalItemsRef);
});

test("addItem does not mutate a non-empty input cart's existing lines", () => {
  let cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 2);
  const snapshotLine = cart.items[0];
  const nextCart = Cart.addItem(cart, SAMPLE_ITEM, 1);
  assert.equal(cart.items[0], snapshotLine, "original line object must be untouched");
  assert.equal(cart.items[0].qty, 2, "original cart's qty must not change");
  assert.equal(nextCart.items[0].qty, 3);
});

test("addItem increments qty for a duplicate id instead of adding a second line", () => {
  let cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 2);
  cart = Cart.addItem(cart, SAMPLE_ITEM, 3);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].qty, 5);
});

test("addItem clamps qty at MAX_QTY_PER_LINE on the initial add", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 999);
  assert.equal(cart.items[0].qty, Cart.MAX_QTY_PER_LINE);
});

test("addItem clamps cumulative qty at MAX_QTY_PER_LINE across repeated adds", () => {
  let cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 8);
  cart = Cart.addItem(cart, SAMPLE_ITEM, 8);
  assert.equal(cart.items[0].qty, Cart.MAX_QTY_PER_LINE);
});

test("addItem treats a qty of 0 as a no-op but still returns a new cart object", () => {
  const original = Cart.createEmptyCart();
  const result = Cart.addItem(original, SAMPLE_ITEM, 0);
  assert.equal(result.items.length, 0);
  assert.notEqual(result, original);
});

test("addItem treats a negative qty as clamping to 0 (no-op)", () => {
  const result = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, -5);
  assert.equal(result.items.length, 0);
});

test("addItem truncates a fractional qty toward zero", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 2.9);
  assert.equal(cart.items[0].qty, 2);
});

test("addItem throws TypeError for a missing/blank id", () => {
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { name: "X", price: 10 }), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "  ", name: "X", price: 10 }), TypeError);
});

test("addItem throws TypeError for a missing/blank name", () => {
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "x", price: 10 }), TypeError);
});

test("addItem throws TypeError for a non-positive or non-finite price", () => {
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: 0 }), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: -5 }), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: NaN }), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: Infinity }), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: "10" }), TypeError);
});

test("addItem throws TypeError for a non-object item", () => {
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), null), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), "item"), TypeError);
  assert.throws(() => Cart.addItem(Cart.createEmptyCart(), undefined), TypeError);
});

test("removeItem removes the matching line without mutating the input", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM);
  const next = Cart.removeItem(cart, "men-01");
  assert.equal(next.items.length, 0);
  assert.equal(cart.items.length, 1, "original cart must be untouched");
});

test("removeItem is a no-op (does not throw) for an id that doesn't exist", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM);
  const next = Cart.removeItem(cart, "does-not-exist");
  assert.equal(next.items.length, 1);
});

test("removeItem on an empty cart does not throw", () => {
  assert.doesNotThrow(() => Cart.removeItem(Cart.createEmptyCart(), "anything"));
});

test("updateQty sets a new clamped qty", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 1);
  const next = Cart.updateQty(cart, "men-01", 4);
  assert.equal(next.items[0].qty, 4);
});

test("updateQty removes the line when qty clamps to 0", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 1);
  const next = Cart.updateQty(cart, "men-01", 0);
  assert.equal(next.items.length, 0);
});

test("updateQty removes the line for a negative qty", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 1);
  const next = Cart.updateQty(cart, "men-01", -3);
  assert.equal(next.items.length, 0);
});

test("updateQty is a no-op for an id that doesn't exist", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 1);
  const next = Cart.updateQty(cart, "nope", 5);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].qty, 1);
});

test("clearCart returns a fresh empty cart", () => {
  assert.deepEqual(Cart.clearCart(), { items: [] });
});

test("getItemCount sums quantities across all lines", () => {
  let cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 2);
  cart = Cart.addItem(cart, CHEAP_ITEM, 3);
  assert.equal(Cart.getItemCount(cart), 5);
});

test("getItemCount is 0 for an empty cart", () => {
  assert.equal(Cart.getItemCount(Cart.createEmptyCart()), 0);
});

test("getSubtotal sums price * qty across lines", () => {
  let cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 2);
  cart = Cart.addItem(cart, CHEAP_ITEM, 1);
  assert.equal(Cart.getSubtotal(cart), 1450 * 2 + 135);
});

test("getSubtotal avoids float drift across many fractional-cent-prone lines", () => {
  let cart = Cart.createEmptyCart();
  cart = Cart.addItem(cart, { id: "a", name: "A", price: 0.1 }, 3);
  cart = Cart.addItem(cart, { id: "b", name: "B", price: 0.2 }, 1);
  assert.equal(Cart.getSubtotal(cart), 0.5);
});

test("getShipping is 0 for an empty cart", () => {
  assert.equal(Cart.getShipping(Cart.createEmptyCart()), 0);
});

test("getShipping is flat rate under the free-shipping threshold", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), CHEAP_ITEM, 1);
  assert.equal(Cart.getShipping(cart), Cart.FLAT_SHIPPING);
});

test("getShipping is free exactly at the threshold (inclusive)", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: Cart.FREE_SHIPPING_THRESHOLD }, 1);
  assert.equal(Cart.getSubtotal(cart), Cart.FREE_SHIPPING_THRESHOLD);
  assert.equal(Cart.getShipping(cart), 0);
});

test("getShipping is flat rate just under the threshold", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), { id: "x", name: "X", price: Cart.FREE_SHIPPING_THRESHOLD - 0.01 }, 1);
  assert.equal(Cart.getShipping(cart), Cart.FLAT_SHIPPING);
});

test("getShipping is free above the threshold", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 1);
  assert.equal(Cart.getShipping(cart), 0);
});

test("getTotal is subtotal plus shipping", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), CHEAP_ITEM, 1);
  assert.equal(Cart.getTotal(cart), 135 + Cart.FLAT_SHIPPING);
});

test("getTotal is just subtotal when shipping is free", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 1);
  assert.equal(Cart.getTotal(cart), 1450);
});

test("serialize/deserialize round-trips a cart", () => {
  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 2);
  const round = Cart.deserialize(Cart.serialize(cart));
  assert.deepEqual(round, cart);
});

test("deserialize falls back to an empty cart on invalid JSON", () => {
  assert.deepEqual(Cart.deserialize("{not json"), Cart.createEmptyCart());
});

test("deserialize falls back to an empty cart on null/non-string input", () => {
  assert.deepEqual(Cart.deserialize(null), Cart.createEmptyCart());
  assert.deepEqual(Cart.deserialize(undefined), Cart.createEmptyCart());
});

test("deserialize falls back to an empty cart when items is not an array", () => {
  assert.deepEqual(Cart.deserialize(JSON.stringify({ items: "nope" })), Cart.createEmptyCart());
});

test("deserialize falls back to an empty cart for a JSON array (not an object)", () => {
  assert.deepEqual(Cart.deserialize(JSON.stringify([1, 2, 3])), Cart.createEmptyCart());
});

test("deserialize drops individual lines with missing or wrong-typed fields, keeps valid ones", () => {
  const raw = JSON.stringify({
    items: [
      { id: "ok-1", name: "Fine", price: 10, qty: 1 },
      { id: "", name: "Bad id", price: 10, qty: 1 },
      { id: "ok-2", name: "Also fine", price: 20, qty: 2 },
      { id: "bad-price", name: "Bad price", price: "10", qty: 1 },
      { id: "bad-price-2", name: "Negative price", price: -5, qty: 1 },
      { name: "Missing id", price: 10, qty: 1 },
      { id: "missing-name", price: 10, qty: 1 }
    ]
  });
  const cart = Cart.deserialize(raw);
  assert.deepEqual(cart.items.map((l) => l.id), ["ok-1", "ok-2"]);
});

test("deserialize clamps qty on surviving lines and drops lines that clamp to 0", () => {
  const raw = JSON.stringify({
    items: [
      { id: "over", name: "Over", price: 10, qty: 999 },
      { id: "zero", name: "Zero", price: 10, qty: 0 },
      { id: "negative", name: "Negative", price: 10, qty: -3 }
    ]
  });
  const cart = Cart.deserialize(raw);
  assert.deepEqual(cart.items.map((l) => l.id), ["over"]);
  assert.equal(cart.items[0].qty, Cart.MAX_QTY_PER_LINE);
});

test("deserialize merges duplicate-id lines into one, clamped at MAX_QTY_PER_LINE (tampered/hand-edited storage)", () => {
  const raw = JSON.stringify({
    items: [
      { id: "men-01", name: "Nave Overcoat", price: 1450, qty: 8 },
      { id: "men-01", name: "Nave Overcoat (duplicate line)", price: 1450, qty: 8 }
    ]
  });
  const cart = Cart.deserialize(raw);
  assert.equal(cart.items.length, 1, "two lines sharing an id must collapse into one");
  assert.equal(cart.items[0].qty, Cart.MAX_QTY_PER_LINE, "merged qty must still respect the per-line cap");
});

test("deserialize strips unexpected/tampered extra keys from a line", () => {
  const raw = JSON.stringify({ items: [{ id: "x", name: "X", price: 10, qty: 1, __proto__isAdmin: true, price2: 0 }] });
  const cart = Cart.deserialize(raw);
  assert.deepEqual(Object.keys(cart.items[0]).sort(), ["id", "name", "price", "qty"]);
});

test("deserialize never throws regardless of garbage input", () => {
  const garbageInputs = ["", "null", "true", "42", "[]", "{}", "{{{", undefined, null, 12345, {}];
  garbageInputs.forEach((input) => {
    assert.doesNotThrow(() => Cart.deserialize(input));
  });
});

test("createStore round-trips a cart through an injected storage backend", () => {
  const storage = Cart.createMemoryStorage();
  const store = Cart.createStore(storage);
  assert.deepEqual(store.load(), Cart.createEmptyCart());

  const cart = Cart.addItem(Cart.createEmptyCart(), SAMPLE_ITEM, 3);
  store.save(cart);
  assert.deepEqual(store.load(), cart);

  store.clear();
  assert.deepEqual(store.load(), Cart.createEmptyCart());
});

test("createStore.load recovers gracefully from corrupted storage content", () => {
  const storage = Cart.createMemoryStorage();
  storage.setItem(Cart.STORAGE_KEY, "not valid json{{{");
  const store = Cart.createStore(storage);
  assert.deepEqual(store.load(), Cart.createEmptyCart());
});

test("createMemoryStorage getItem returns null for a missing key", () => {
  const storage = Cart.createMemoryStorage();
  assert.equal(storage.getItem("missing"), null);
});

test("clampQty handles non-numeric input by returning 0", () => {
  assert.equal(Cart.clampQty("not a number"), 0);
  assert.equal(Cart.clampQty(undefined), 0);
  assert.equal(Cart.clampQty(NaN), 0);
});

test("clampQty accepts numeric strings", () => {
  assert.equal(Cart.clampQty("4"), 4);
});

test("deserialize scales linearly, not quadratically, with a large number of lines", () => {
  const n = 20000;
  const items = [];
  for (let i = 0; i < n; i++) items.push({ id: "item-" + i, name: "Item " + i, price: 10, qty: 1 });
  const raw = JSON.stringify({ items });

  const start = process.hrtime.bigint();
  const cart = Cart.deserialize(raw);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;

  assert.equal(cart.items.length, n);
  // A quadratic implementation takes seconds at this size (confirmed by
  // profiling); a linear one finishes in well under 500ms even on a slow
  // CI box. This is a regression guard for that specific failure mode,
  // not a tight perf budget.
  assert.ok(ms < 500, `deserialize on ${n} lines took ${ms.toFixed(1)}ms, expected well under 500ms`);
});

test("deserialize merges duplicate ids by summing and clamping qty, in one pass", () => {
  const raw = JSON.stringify({
    items: [
      { id: "a", name: "A", price: 10, qty: 3 },
      { id: "b", name: "B", price: 5, qty: 1 },
      { id: "a", name: "A again", price: 10, qty: 4 }
    ]
  });
  const cart = Cart.deserialize(raw);
  assert.deepEqual(cart.items, [
    { id: "a", name: "A", price: 10, qty: 7 },
    { id: "b", name: "B", price: 5, qty: 1 }
  ]);
});

test("deserialize clamps a merged duplicate-id qty at MAX_QTY_PER_LINE", () => {
  const raw = JSON.stringify({
    items: [
      { id: "a", name: "A", price: 10, qty: 8 },
      { id: "a", name: "A", price: 10, qty: 8 }
    ]
  });
  const cart = Cart.deserialize(raw);
  assert.equal(cart.items.length, 1);
  assert.equal(cart.items[0].qty, Cart.MAX_QTY_PER_LINE);
});

test("createStore.save returns true on success and false (not throwing) when storage.setItem throws", () => {
  const okStorage = Cart.createMemoryStorage();
  const okStore = Cart.createStore(okStorage);
  assert.equal(okStore.save(Cart.createEmptyCart()), true);

  const quotaExceededStorage = {
    getItem: () => null,
    setItem: () => {
      const err = new Error("QuotaExceededError");
      err.name = "QuotaExceededError";
      throw err;
    },
    removeItem: () => {}
  };
  const failingStore = Cart.createStore(quotaExceededStorage);
  let result;
  assert.doesNotThrow(() => { result = failingStore.save(Cart.createEmptyCart()); });
  assert.equal(result, false);
});
