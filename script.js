// Cathedral Studio — Collection I rendering + waitlist form.
// No real product photography exists yet (see the site-wide disclosure in
// the footer) — each card's image is a hand-picked stand-in editorial
// photo (Unsplash, see products.js), not a photo of the named piece.

function placeholderImageUrl(unsplashId) {
  return `https://images.unsplash.com/photo-${unsplashId}?w=900&q=75&auto=format&fit=crop`;
}

function renderCard(item) {
  const id = item.id;
  return `
    <article class="card">
      <div class="plate">
        <img class="plate-image" src="${placeholderImageUrl(item.img)}" alt="${item.name}, ${item.fabric}" loading="lazy">
        <span class="plate-num">${item.n}</span>
        <span class="plate-tag">${item.cat}</span>
      </div>
      <div class="card-info">
        <span>
          <span class="card-name">${item.name}</span>
          <span class="card-meta">${item.fabric}</span>
        </span>
        <span class="card-price">$${item.price.toLocaleString("en-US")}</span>
      </div>
      <button type="button" class="add-to-cart-btn" data-action="add-to-cart" data-id="${id}">Add to Cart</button>
    </article>
  `;
}

function renderGrid(targetId, items) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = items.map(renderCard).join("");
}

renderGrid("men-grid", PRODUCTS.men);
renderGrid("women-grid", PRODUCTS.women);

const form = document.getElementById('waitlist-form');
const message = document.getElementById('form-message');

form.addEventListener('submit', function (e) {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  if (!email) return;

  // No backend wired up yet — Phase 0 per the roadmap is capture-only.
  // Swap this for a real endpoint (hosted form service or Shopify
  // Buy Button integration) before this site takes real traffic.
  message.textContent = "You're on the list.";
  form.reset();
});
