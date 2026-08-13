// Cathedral Studio — Cloudflare Turnstile wrapper.
// Renders an invisible/managed Turnstile widget into a container and
// resolves a fresh token on demand. A no-op (never renders, always
// resolves null) when TURNSTILE_SITE_KEY is still the config.js
// placeholder, so pages work identically before Turnstile is set up —
// auth.js treats a null token as "don't send captchaToken", which is
// exactly Supabase's behavior when captcha protection is off.

function isTurnstileConfigured() {
  const key = (window.CATHEDRAL_CONFIG || {}).TURNSTILE_SITE_KEY;
  return typeof key === "string" && key !== "YOUR-TURNSTILE-SITE-KEY" && key.length > 0;
}

// One widget per container id, so a page with multiple forms (sign in,
// sign up, forgot password) can each hold their own token independently
// rather than fighting over a single global widget instance.
const widgetIdsByContainer = new Map();
const tokensByContainer = new Map();

function renderInto(containerId) {
  if (!isTurnstileConfigured()) return;
  if (widgetIdsByContainer.has(containerId)) return;
  const container = document.getElementById(containerId);
  if (!container || typeof window.turnstile === "undefined") return;

  const widgetId = window.turnstile.render(container, {
    sitekey: window.CATHEDRAL_CONFIG.TURNSTILE_SITE_KEY,
    callback: (token) => tokensByContainer.set(containerId, token),
    "expired-callback": () => tokensByContainer.delete(containerId),
    "error-callback": () => tokensByContainer.delete(containerId)
  });
  widgetIdsByContainer.set(containerId, widgetId);
}

// Returns the widget's current token, or null if Turnstile isn't
// configured/loaded/solved yet — callers pass this straight through as
// captchaToken, and Supabase itself rejects a stale/missing token with a
// normal error the existing error-handling paths already surface.
function getToken(containerId) {
  return tokensByContainer.get(containerId) || null;
}

function resetWidget(containerId) {
  const widgetId = widgetIdsByContainer.get(containerId);
  if (widgetId !== undefined && typeof window.turnstile !== "undefined") {
    window.turnstile.reset(widgetId);
  }
  tokensByContainer.delete(containerId);
}

window.CathedralTurnstile = {
  isConfigured: isTurnstileConfigured,
  renderInto,
  getToken,
  resetWidget
};
