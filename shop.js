// Cathedral Studio — "Add to Cart" wiring for the collection grid.
// Depends on cart.js (window.CathedralCart) and products.js/script.js
// having already rendered .card elements with data-id on them.

(function () {
  const store = window.CathedralCart.createStore();

  function findProduct(id) {
    const all = PRODUCTS.men.concat(PRODUCTS.women);
    return all.find(function (p) { return p.id === id; });
  }

  function updateCartBadge() {
    const badge = document.getElementById("cart-badge");
    if (!badge) return;
    const count = window.CathedralCart.getItemCount(store.load());
    badge.textContent = count > 0 ? String(count) : "";
    badge.hidden = count === 0;
  }

  // store.save() can fail (browser storage quota) on a very large or
  // tampered cart; a failed add must not claim "Added" with no explanation.
  function showStorageErrorToast() {
    let toast = document.getElementById("storage-error-toast");
    if (!toast) {
      toast = document.createElement("p");
      toast.id = "storage-error-toast";
      toast.setAttribute("role", "alert");
      toast.className = "storage-error-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = "Your cart couldn't be updated — your browser's storage for this site is full.";
    toast.hidden = false;
    clearTimeout(showStorageErrorToast.hideTimer);
    showStorageErrorToast.hideTimer = setTimeout(function () {
      toast.hidden = true;
    }, 4000);
  }

  function onAddToCartClick(event) {
    const button = event.target.closest("[data-action='add-to-cart']");
    if (!button) return;
    const id = button.dataset.id;
    const product = findProduct(id);
    if (!product) return;

    const cart = store.load();
    const existingLine = cart.items.find(function (l) { return l.id === product.id; });
    const alreadyAtMax = existingLine && existingLine.qty >= window.CathedralCart.MAX_QTY_PER_LINE;
    const next = window.CathedralCart.addItem(cart, {
      id: product.id,
      name: product.name,
      price: product.price,
      cat: product.cat,
      fabric: product.fabric
    }, 1);
    const saved = store.save(next);
    if (!saved) {
      showStorageErrorToast();
      return;
    }
    updateCartBadge();

    const original = button.textContent;
    button.textContent = alreadyAtMax ? "Limit reached" : "Added";
    button.disabled = true;
    setTimeout(function () {
      button.textContent = original;
      button.disabled = false;
    }, 1200);
  }

  document.addEventListener("click", onAddToCartClick);
  updateCartBadge();
})();
