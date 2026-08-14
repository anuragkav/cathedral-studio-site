// Cathedral Studio — cart rendering + Stripe Checkout hand-off.
//
// The button on this page does NOT charge anything. It POSTs the cart's
// { id, qty } lines plus a per-tab token to the create-checkout-session
// Supabase Edge Function (which owns the trusted price catalog), then
// navigates the browser to the returned Stripe Checkout URL. Card, email,
// and shipping address are collected by Stripe, never by this site.

(function () {
  const Cart = window.CathedralCart;
  const Validation = window.CathedralValidation;
  const store = Cart.createStore();

  // Per-tab nonce written to sessionStorage before initiating checkout.
  // Doubles as (a) the Stripe idempotency key so retries re-attach to the
  // same Session, and (b) a return-URL validator so an attacker-crafted
  // "checkout.html?checkout=success" link cannot unilaterally clear the
  // victim's cart or paint a fake "payment received" page. Declared up
  // top because cart-mutation handlers invalidate it on any change.
  const CHECKOUT_TOKEN_KEY = "cathedral_checkout_token_v1";

  const cartEmptyEl = document.getElementById("cart-empty");
  const cartContentEl = document.getElementById("cart-content");
  const cartLinesEl = document.getElementById("cart-lines");
  const summarySubtotalEl = document.getElementById("summary-subtotal");
  const summaryShippingEl = document.getElementById("summary-shipping");
  const summaryTotalEl = document.getElementById("summary-total");
  const submitBtn = document.getElementById("checkout-submit");
  const confirmationEl = document.getElementById("checkout-confirmation");
  const cancelledEl = document.getElementById("checkout-cancelled");
  const checkoutErrorEl = document.getElementById("checkout-error");
  const storageErrorEl = document.getElementById("storage-error");

  function showStorageErrorIfSaveFailed(saved) {
    if (storageErrorEl) storageErrorEl.hidden = saved;
  }

  function getCheckoutEndpoint() {
    const cfg = window.CATHEDRAL_CONFIG || {};
    if (typeof cfg.CHECKOUT_ENDPOINT === "string" && cfg.CHECKOUT_ENDPOINT.length > 0) {
      return cfg.CHECKOUT_ENDPOINT;
    }
    if (typeof cfg.SUPABASE_URL === "string" && /^https:\/\/[^/]+\.supabase\.co$/.test(cfg.SUPABASE_URL)) {
      return cfg.SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/create-checkout-session";
    }
    return null;
  }

  function generateCheckoutToken() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    // Fallback for very old browsers — not cryptographic, but for a
    // per-tab idempotency + return-validator nonce it's enough (an
    // attacker would need to guess THIS tab's token).
    const rand = () => Math.random().toString(16).slice(2).padStart(13, "0");
    return rand() + rand() + rand();
  }

  function renderLine(line) {
    const el = document.createElement("div");
    el.className = "cart-line";
    el.dataset.id = line.id;
    // line.id/line.name come from localStorage (Cart.deserialize), which is
    // user-tamperable, so they are never placed into an innerHTML template —
    // only trusted static markup goes through innerHTML; every dynamic value
    // is assigned afterward via DOM properties/attributes.
    el.innerHTML = `
      <div class="cart-line-info">
        <div class="cart-line-text">
          <p class="cart-line-name"></p>
          <p class="cart-line-meta"></p>
          <p class="cart-line-unit-price"></p>
        </div>
      </div>
      <div class="cart-line-qty">
        <button type="button" class="qty-btn" data-action="decrease">&minus;</button>
        <input type="number" class="qty-input" min="1" max="${Cart.MAX_QTY_PER_LINE}" step="1" inputmode="numeric">
        <button type="button" class="qty-btn" data-action="increase">+</button>
      </div>
      <p class="cart-line-total"></p>
      <button type="button" class="cart-line-remove" data-action="remove">Remove</button>
    `;
    el.querySelector(".cart-line-name").textContent = line.name;
    el.querySelector(".cart-line-meta").textContent = line.fabric || line.cat || "";
    el.querySelector(".cart-line-unit-price").textContent = Validation.formatCurrency(line.price) + " each";
    el.querySelector(".cart-line-total").textContent = Validation.formatCurrency(line.price * line.qty);

    const decreaseBtn = el.querySelector('[data-action="decrease"]');
    const increaseBtn = el.querySelector('[data-action="increase"]');
    const removeBtn = el.querySelector('[data-action="remove"]');
    const qtyInput = el.querySelector(".qty-input");
    decreaseBtn.dataset.id = line.id;
    increaseBtn.dataset.id = line.id;
    removeBtn.dataset.id = line.id;
    qtyInput.dataset.id = line.id;
    qtyInput.value = line.qty;
    decreaseBtn.setAttribute("aria-label", "Decrease quantity for " + line.name);
    increaseBtn.setAttribute("aria-label", "Increase quantity for " + line.name);
    removeBtn.setAttribute("aria-label", "Remove " + line.name);
    qtyInput.setAttribute("aria-label", "Quantity for " + line.name);

    return el;
  }

  function renderCart() {
    const cart = store.load();
    const isEmpty = cart.items.length === 0;

    cartEmptyEl.hidden = !isEmpty;
    cartContentEl.hidden = isEmpty;
    if (isEmpty) return;

    // Build off-DOM and append once — appending each line directly to the
    // live, attached cartLinesEl would force a style/layout pass per line,
    // which turns an already-rare huge cart into a multi-second hang.
    const fragment = document.createDocumentFragment();
    cart.items.forEach(function (line) {
      fragment.appendChild(renderLine(line));
    });
    cartLinesEl.innerHTML = "";
    cartLinesEl.appendChild(fragment);

    const subtotal = Cart.getSubtotal(cart);
    const shipping = Cart.getShipping(cart);
    summarySubtotalEl.textContent = Validation.formatCurrency(subtotal);
    summaryShippingEl.textContent = shipping === 0 ? "Free" : Validation.formatCurrency(shipping);
    summaryTotalEl.textContent = Validation.formatCurrency(subtotal + shipping);
  }

  function invalidateCheckoutTokenOnCartMutation() {
    // If the shopper mutates the cart AFTER a Stripe redirect they then
    // abandoned (Back button instead of Cancel), the stored token still
    // points at a Stripe Session built from the OLD line items. Reusing
    // it as an idempotency key with a different body makes Stripe return
    // the stale session (or reject the call). Clear it here so the next
    // click mints a fresh token and a fresh Session reflecting the new cart.
    try { window.sessionStorage.removeItem(CHECKOUT_TOKEN_KEY); } catch (e) { /* no-op */ }
  }

  function onCartLinesClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const id = button.dataset.id;
    const action = button.dataset.action;
    const cart = store.load();

    let saved;
    if (action === "remove") {
      saved = store.save(Cart.removeItem(cart, id));
    } else if (action === "increase" || action === "decrease") {
      const line = cart.items.find(function (l) { return l.id === id; });
      if (!line) return;
      const delta = action === "increase" ? 1 : -1;
      saved = store.save(Cart.updateQty(cart, id, line.qty + delta));
    } else {
      return;
    }
    invalidateCheckoutTokenOnCartMutation();
    showStorageErrorIfSaveFailed(saved);
    renderCart();
  }

  function onCartLinesChange(event) {
    const input = event.target.closest(".qty-input");
    if (!input) return;
    const id = input.dataset.id;
    const cart = store.load();
    const typed = Number(input.value);
    // Typing is for setting a quantity, not for removing a line — a blank,
    // non-numeric, or sub-1 value (e.g. from select-all-and-delete) resets
    // the field back to its last saved quantity instead of clamping to 0
    // and silently deleting the line. Removal stays an explicit action.
    if (!Number.isFinite(typed) || typed < 1) {
      renderCart();
      return;
    }
    invalidateCheckoutTokenOnCartMutation();
    showStorageErrorIfSaveFailed(store.save(Cart.updateQty(cart, id, typed)));
    renderCart();
  }

  cartLinesEl.addEventListener("click", onCartLinesClick);
  cartLinesEl.addEventListener("change", onCartLinesChange);

  function showCheckoutError(message) {
    if (!checkoutErrorEl) return;
    checkoutErrorEl.textContent = message;
    checkoutErrorEl.hidden = false;
  }

  function clearCheckoutError() {
    if (!checkoutErrorEl) return;
    checkoutErrorEl.textContent = "";
    checkoutErrorEl.hidden = true;
  }

  function toStripePayload(cart, token) {
    // Only id + qty + token cross the wire. The server-side CATALOG owns
    // unit price and product name — a tampered localStorage that sends a
    // $1 price or a rewritten name cannot influence what Stripe charges.
    return {
      items: cart.items.map(function (line) {
        return { id: line.id, qty: line.qty };
      }),
      checkout_token: token
    };
  }

  async function onCheckoutClick() {
    clearCheckoutError();
    const cart = store.load();
    if (cart.items.length === 0) return;

    const endpoint = getCheckoutEndpoint();
    if (!endpoint) {
      showCheckoutError("Checkout is not configured yet. Please try again later.");
      return;
    }

    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "Redirecting…";

    // Store the token BEFORE the network call so a retry (double-click,
    // transient error) reuses the same token and Stripe returns the SAME
    // session via its idempotency key.
    let token;
    try {
      token = window.sessionStorage.getItem(CHECKOUT_TOKEN_KEY) || generateCheckoutToken();
      window.sessionStorage.setItem(CHECKOUT_TOKEN_KEY, token);
    } catch (err) {
      // sessionStorage disabled/full — fall back to a per-click token so
      // checkout still works (idempotency + return validation degrade,
      // but not to anything worse than before).
      token = generateCheckoutToken();
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No cookies: the edge function is public and stateless, and
        // sending credentials would only widen the attack surface on the
        // shared Supabase domain.
        credentials: "omit",
        body: JSON.stringify(toStripePayload(cart, token))
      });
      const data = await res.json().catch(function () { return {}; });
      if (!res.ok || typeof data.url !== "string") {
        showCheckoutError(
          (data && typeof data.error === "string" && data.error) ||
          "We couldn't start checkout. Please try again."
        );
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }
      // Whitelist the redirect target — any URL that isn't a Stripe
      // Checkout URL is treated as a compromised response and refused,
      // so a tampered edge function can't turn this button into an
      // open-redirect / phishing pivot.
      if (!/^https:\/\/checkout\.stripe\.com\//.test(data.url)) {
        showCheckoutError("Unexpected checkout URL. Please try again.");
        submitBtn.disabled = false;
        submitBtn.textContent = originalText;
        return;
      }
      window.location.href = data.url;
    } catch (err) {
      showCheckoutError("Network error. Please check your connection and try again.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }

  submitBtn.addEventListener("click", onCheckoutClick);

  function renderCartBadgeIfPresent() {
    const badge = document.getElementById("cart-badge");
    if (!badge) return;
    badge.hidden = true;
    badge.textContent = "";
  }

  function readStoredCheckoutToken() {
    try {
      return window.sessionStorage.getItem(CHECKOUT_TOKEN_KEY);
    } catch (err) {
      return null;
    }
  }

  function clearStoredCheckoutToken() {
    try {
      window.sessionStorage.removeItem(CHECKOUT_TOKEN_KEY);
    } catch (err) { /* nothing we can do */ }
  }

  function handleReturnFromStripe() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("checkout");
    if (status !== "success" && status !== "cancelled") return false;

    // A raw ?checkout=success link sent by an attacker would otherwise
    // clear the victim's cart or paint a misleading "payment received"
    // page. We only trust the return when the URL token matches the one
    // THIS tab stashed in sessionStorage before initiating the redirect.
    const urlToken = params.get("token");
    const storedToken = readStoredCheckoutToken();
    if (!urlToken || !storedToken || urlToken !== storedToken) {
      return false;
    }
    clearStoredCheckoutToken();

    if (status === "success") {
      // Stripe only redirects to success_url after a successful charge;
      // token match confirms this browser initiated the checkout. The
      // order-of-record and any fulfillment must still be driven from
      // Stripe webhooks server-side — this branch is UI only.
      store.clear();
      cartContentEl.hidden = true;
      cartEmptyEl.hidden = true;
      confirmationEl.hidden = false;
      renderCartBadgeIfPresent();
      const heading = confirmationEl.querySelector("h1");
      if (heading) {
        heading.setAttribute("tabindex", "-1");
        heading.focus();
      }
      return true;
    }
    // cancelled — cart remains intact, cancellation panel shown.
    cartContentEl.hidden = true;
    cartEmptyEl.hidden = true;
    cancelledEl.hidden = false;
    const heading = cancelledEl.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
    return true;
  }

  const handled = handleReturnFromStripe();
  if (!handled) renderCart();
})();
