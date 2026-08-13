// Cathedral Studio — cart rendering + checkout form wiring.
// This is a design preview only: submitting the form never contacts a
// payment network or a server. See the disclosure copy in checkout.html.

(function () {
  const Cart = window.CathedralCart;
  const Validation = window.CathedralValidation;
  const store = Cart.createStore();

  const cartEmptyEl = document.getElementById("cart-empty");
  const cartContentEl = document.getElementById("cart-content");
  const cartLinesEl = document.getElementById("cart-lines");
  const summarySubtotalEl = document.getElementById("summary-subtotal");
  const summaryShippingEl = document.getElementById("summary-shipping");
  const summaryTotalEl = document.getElementById("summary-total");
  const form = document.getElementById("checkout-form");
  const confirmationEl = document.getElementById("checkout-confirmation");
  const storageErrorEl = document.getElementById("storage-error");

  function showStorageErrorIfSaveFailed(saved) {
    if (storageErrorEl) storageErrorEl.hidden = saved;
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
    // and silently deleting the line. Removal stays an explicit action:
    // the Remove button, or repeatedly clicking decrease down from 1.
    if (!Number.isFinite(typed) || typed < 1) {
      renderCart();
      return;
    }
    showStorageErrorIfSaveFailed(store.save(Cart.updateQty(cart, id, typed)));
    renderCart();
  }

  cartLinesEl.addEventListener("click", onCartLinesClick);
  cartLinesEl.addEventListener("change", onCartLinesChange);

  const FIELD_VALIDATORS = {
    email: {
      check: function (values) { return Validation.validateEmail(values.email); },
      message: "Enter a valid email address."
    },
    "full-name": {
      check: function (values) { return Validation.validateRequired(values["full-name"]); },
      message: "Enter your full name."
    },
    address1: {
      check: function (values) { return Validation.validateRequired(values.address1); },
      message: "Enter a street address."
    },
    city: {
      check: function (values) { return Validation.validateRequired(values.city); },
      message: "Enter a city."
    },
    state: {
      check: function (values) { return Validation.validateRequired(values.state); },
      message: "Enter a state or province."
    },
    zip: {
      check: function (values) { return Validation.validateZip(values.zip, values.country); },
      message: "Enter a valid postal code."
    },
    "card-number": {
      check: function (values) { return Validation.luhnCheck(values["card-number"]); },
      message: "Enter a valid card number."
    },
    "card-expiry": {
      check: function (values) {
        const match = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec((values["card-expiry"] || "").trim());
        if (!match) return false;
        return Validation.validateExpiry(match[1], match[2]);
      },
      message: "Enter a valid, unexpired expiry (MM/YY)."
    },
    "card-cvc": {
      check: function (values) { return /^\d{3,4}$/.test((values["card-cvc"] || "").trim()); },
      message: "Enter a valid CVC."
    }
  };

  function readFormValues() {
    return {
      email: form.email.value.trim(),
      "full-name": form["full-name"].value,
      address1: form.address1.value,
      city: form.city.value,
      state: form.state.value,
      zip: form.zip.value,
      country: form.country.value,
      "card-number": form["card-number"].value,
      "card-expiry": form["card-expiry"].value,
      "card-cvc": form["card-cvc"].value
    };
  }

  function setFieldError(fieldId, message) {
    const errorEl = form.querySelector('[data-error-for="' + fieldId + '"]');
    const inputEl = document.getElementById(fieldId);
    if (errorEl) {
      errorEl.textContent = message || "";
      errorEl.setAttribute("role", message ? "alert" : "presentation");
    }
    if (inputEl) {
      if (message) {
        inputEl.setAttribute("aria-invalid", "true");
        if (errorEl) inputEl.setAttribute("aria-describedby", errorEl.id);
      } else {
        inputEl.removeAttribute("aria-invalid");
        inputEl.removeAttribute("aria-describedby");
      }
    }
  }

  function validateForm() {
    const values = readFormValues();
    let isValid = true;
    Object.keys(FIELD_VALIDATORS).forEach(function (fieldId) {
      const validator = FIELD_VALIDATORS[fieldId];
      const ok = validator.check(values);
      setFieldError(fieldId, ok ? "" : validator.message);
      if (!ok) isValid = false;
    });
    return isValid;
  }

  function onSubmit(event) {
    event.preventDefault();
    if (store.load().items.length === 0) return;
    if (!validateForm()) return;

    store.clear();
    cartContentEl.hidden = true;
    cartEmptyEl.hidden = true;
    confirmationEl.hidden = false;
    renderCartBadgeIfPresent();

    const confirmationHeading = confirmationEl.querySelector("h1");
    if (confirmationHeading) {
      confirmationHeading.setAttribute("tabindex", "-1");
      confirmationHeading.focus();
    }
  }

  function renderCartBadgeIfPresent() {
    const badge = document.getElementById("cart-badge");
    if (!badge) return;
    badge.hidden = true;
    badge.textContent = "";
  }

  form.addEventListener("submit", onSubmit);

  renderCart();
})();
