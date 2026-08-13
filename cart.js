// Cathedral Studio — cart engine.
// Pure logic, no DOM access, so it can run under a browser <script> tag
// (attaches to window.CathedralCart) or under Node's test runner via
// module.exports. Money is tracked in integer cents internally and only
// converted back to dollars at the edges, since these are $100-1500
// garments and float drift on repeated addition is not acceptable.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.CathedralCart = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  const MAX_QTY_PER_LINE = 10;
  const FREE_SHIPPING_THRESHOLD = 1000;
  const FLAT_SHIPPING = 15;
  const STORAGE_KEY = "cathedral_cart_v1";

  function clampQty(qty) {
    const n = Math.trunc(Number(qty));
    if (!Number.isFinite(n) || n < 0) return 0;
    return n > MAX_QTY_PER_LINE ? MAX_QTY_PER_LINE : n;
  }

  function toCents(amount) {
    return Math.round(amount * 100);
  }

  function centsToDollars(cents) {
    return Number((Math.round(cents) / 100).toFixed(2));
  }

  function cloneLine(line) {
    return Object.assign({}, line);
  }

  function cloneItems(items) {
    return items.map(cloneLine);
  }

  function assertValidItem(item) {
    if (!item || typeof item !== "object") {
      throw new TypeError("addItem: item must be an object");
    }
    if (typeof item.id !== "string" || item.id.trim() === "") {
      throw new TypeError("addItem: item.id must be a non-empty string");
    }
    if (typeof item.name !== "string" || item.name.trim() === "") {
      throw new TypeError("addItem: item.name must be a non-empty string");
    }
    if (typeof item.price !== "number" || !Number.isFinite(item.price) || item.price <= 0) {
      throw new TypeError("addItem: item.price must be a finite number greater than 0");
    }
  }

  function createEmptyCart() {
    return { items: [] };
  }

  function addItem(cart, item, qty) {
    if (qty === undefined) qty = 1;
    assertValidItem(item);
    const clamped = clampQty(qty);
    const items = cloneItems(cart.items);
    if (clamped === 0) {
      return { items: items };
    }
    const idx = items.findIndex(function (line) { return line.id === item.id; });
    if (idx === -1) {
      const line = { id: item.id, name: item.name, price: item.price, qty: clamped };
      if (typeof item.cat === "string") line.cat = item.cat;
      if (typeof item.fabric === "string") line.fabric = item.fabric;
      items.push(line);
    } else {
      items[idx] = Object.assign({}, items[idx], { qty: clampQty(items[idx].qty + clamped) });
    }
    return { items: items };
  }

  function removeItem(cart, id) {
    return { items: cloneItems(cart.items.filter(function (line) { return line.id !== id; })) };
  }

  function updateQty(cart, id, qty) {
    const exists = cart.items.some(function (line) { return line.id === id; });
    if (!exists) return { items: cloneItems(cart.items) };
    const clamped = clampQty(qty);
    if (clamped === 0) return removeItem(cart, id);
    return {
      items: cart.items.map(function (line) {
        return line.id === id ? Object.assign({}, line, { qty: clamped }) : cloneLine(line);
      })
    };
  }

  function clearCart() {
    return createEmptyCart();
  }

  function getItemCount(cart) {
    return cart.items.reduce(function (sum, line) { return sum + line.qty; }, 0);
  }

  function getSubtotal(cart) {
    const cents = cart.items.reduce(function (sum, line) {
      return sum + toCents(line.price) * line.qty;
    }, 0);
    return centsToDollars(cents);
  }

  function getShipping(cart) {
    if (cart.items.length === 0) return 0;
    return getSubtotal(cart) >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  }

  function getTotal(cart) {
    return centsToDollars(toCents(getSubtotal(cart)) + toCents(getShipping(cart)));
  }

  function serialize(cart) {
    return JSON.stringify(cart);
  }

  function deserialize(raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) {
        return createEmptyCart();
      }
      // Storage (localStorage) is client-controlled and can be hand-edited
      // or corrupted independently of anything this module ever wrote, so
      // a raw blob can legally contain two lines sharing one id. Routing
      // every line through addItem (rather than pushing directly) reuses
      // its merge-and-clamp behavior instead of re-deriving it here, so
      // MAX_QTY_PER_LINE holds even for hand-crafted/tampered storage.
      let cart = createEmptyCart();
      for (const line of parsed.items) {
        if (!line || typeof line !== "object") continue;
        if (typeof line.id !== "string" || line.id.trim() === "") continue;
        if (typeof line.name !== "string" || line.name.trim() === "") continue;
        if (typeof line.price !== "number" || !Number.isFinite(line.price) || line.price <= 0) continue;
        const qty = clampQty(line.qty);
        if (qty === 0) continue;
        const item = { id: line.id, name: line.name, price: line.price };
        if (typeof line.cat === "string") item.cat = line.cat;
        if (typeof line.fabric === "string") item.fabric = line.fabric;
        cart = addItem(cart, item, qty);
      }
      return cart;
    } catch (err) {
      return createEmptyCart();
    }
  }

  function createMemoryStorage() {
    const map = new Map();
    return {
      getItem: function (key) { return map.has(key) ? map.get(key) : null; },
      setItem: function (key, value) { map.set(key, String(value)); },
      removeItem: function (key) { map.delete(key); }
    };
  }

  function createStore(storage) {
    const backing = storage || (typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : createMemoryStorage());
    return {
      load: function () {
        const raw = backing.getItem(STORAGE_KEY);
        if (raw === null || raw === undefined) return createEmptyCart();
        return deserialize(raw);
      },
      save: function (cart) {
        backing.setItem(STORAGE_KEY, serialize(cart));
      },
      clear: function () {
        backing.removeItem(STORAGE_KEY);
      }
    };
  }

  return {
    MAX_QTY_PER_LINE,
    FREE_SHIPPING_THRESHOLD,
    FLAT_SHIPPING,
    STORAGE_KEY,
    createEmptyCart,
    addItem,
    removeItem,
    updateQty,
    clearCart,
    getItemCount,
    getSubtotal,
    getShipping,
    getTotal,
    serialize,
    deserialize,
    createStore,
    createMemoryStorage,
    clampQty
  };
});
