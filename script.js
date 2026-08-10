const form = document.getElementById('waitlist-form');
const message = document.getElementById('form-message');

form.addEventListener('submit', function (e) {
  e.preventDefault();
  const email = document.getElementById('email').value.trim();
  if (!email) return;

  // No backend wired up yet — Phase 0 per data/roadmap.json is capture-only.
  // Swap this for a real endpoint (e.g. a hosted form service or Shopify
  // Buy Button integration) before this site takes real traffic.
  message.textContent = "You're on the list.";
  form.reset();
});
