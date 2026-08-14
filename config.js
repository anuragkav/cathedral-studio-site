// Cathedral Studio — Supabase project config.
//
// SUPABASE_ANON_KEY is a public, publishable key — safe to ship in
// client-side JS by design (Supabase's row-level security policies, not
// this key, are what protect the data). Do not put a service_role key
// here or anywhere in this repo.
//
// Replace both placeholders with the values from
// Supabase Dashboard → Project Settings → API, then remove this comment.
//
// TURNSTILE_SITE_KEY is optional and defends signup/signin/password-reset
// against scripted abuse (mass account creation, credential-stuffing,
// confirmation-email flooding) — see turnstile.js and its usage in auth.js.
// Get a site key at dash.cloudflare.com/?to=/:account/turnstile, then
// enable "Enable Captcha protection" under Supabase Dashboard →
// Authentication → Settings → Bot and Abuse Protection, using the matching
// secret key there. Leaving this as the placeholder value below disables
// CAPTCHA entirely — signup/signin/reset still work, just unprotected.
//
//
// CHECKOUT_ENDPOINT is optional. When empty, checkout.js derives it as
// `${SUPABASE_URL}/functions/v1/create-checkout-session`. Set it
// explicitly only when pointing at a non-default deployment (a preview
// branch, a self-hosted function). It must resolve to a same-project
// Supabase Function that owns the Stripe secret key — never a raw Stripe
// URL.
window.CATHEDRAL_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY",
  TURNSTILE_SITE_KEY: "YOUR-TURNSTILE-SITE-KEY",
  CHECKOUT_ENDPOINT: ""
};
