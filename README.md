# Cathedral Studio — site

Bare-bones v0 waitlist site for Cathedral Studio, deployed via GitHub Pages. Plain HTML/CSS/JS, no framework, no Shopify storefront.

Business research, risk register, and roadmap live in the private [cathedral_clothing](https://github.com/anuragkav/cathedral_clothing) repo — this repo is public (required for free GitHub Pages hosting) and contains only the public-facing site, no business/strategy documents.

Current phase: waitlist/email-capture only, per the phased roadmap in the private repo — no live checkout yet.

## Accounts setup (Supabase)

The account system (`account.html`, `auth.js`, `account.js`) needs a Supabase project to work:

1. Create a project at supabase.com, then run `supabase/schema.sql` in its SQL editor.
2. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js` (the anon/publishable key is safe to commit — see the comment in that file. Never put a `service_role` key there).
3. In the Supabase dashboard, under Authentication → URL Configuration, add this site's `account.html` URL (e.g. `https://<user>.github.io/cathedral-studio-site/account.html`) to the **Redirect URLs** allowlist. Without this, password-reset links fall back to the project's default Site URL and silently drop the `?mode=update-password` param, signing the user in without ever showing the "set a new password" form.

## Checkout setup (Stripe via Supabase Edge Function)

The Proceed-to-Payment button on `checkout.html` calls a Supabase Edge
Function that creates a Stripe Checkout Session with prices looked up
server-side, then redirects the browser to Stripe. The static site never
sees a Stripe secret key.

1. Install the Supabase CLI and link this repo to your project:
   ```
   supabase link --project-ref YOUR-PROJECT-REF
   ```
2. Set the secrets (do this in your terminal — never paste secrets into
   the repo, an editor buffer, or a chat):
   ```
   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
   supabase secrets set ALLOWED_ORIGINS="https://<user>.github.io,http://localhost:4173"
   supabase secrets set SITE_URL="https://<user>.github.io/cathedral-studio-site"
   ```
   Start with `sk_test_` keys and use test-mode cards
   (https://stripe.com/docs/testing) until you're ready to go live.
3. Deploy the function:
   ```
   supabase functions deploy create-checkout-session --no-verify-jwt
   ```
   `--no-verify-jwt` is intentional — checkout is open to anonymous
   shoppers. The function trusts its own catalog, not the caller.
4. Whenever you change a price in `products.js`, update the matching
   entry in `supabase/functions/_shared/catalog.ts` in the same commit.
   The two files must not drift: the storefront quotes prices from
   `products.js`, and Stripe charges prices from `catalog.ts`. See the
   comment at the top of `catalog.ts`.
5. In the Stripe Dashboard, keep the "success URL" and "cancel URL"
   allowlist wide enough to include your `SITE_URL` (Stripe rejects
   redirect targets that aren't allowlisted for your account).

## Order recording (Stripe webhook)

`create-checkout-session` only starts a Stripe Checkout Session — Stripe,
not this site, collects the card and completes the charge. Without a
webhook, nothing on your side would ever find out a payment succeeded.
`supabase/functions/stripe-webhook/index.ts` closes that: it verifies
Stripe's signature on the raw request body, then upserts a row into
`public.orders` (added by `supabase/schema.sql`) keyed on the Stripe
Checkout Session id, so Stripe's documented at-least-once webhook
redelivery is a safe no-op rather than a duplicate order.

1. Set the webhook secrets (in addition to the checkout secrets above):
   ```
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
   `STRIPE_WEBHOOK_SECRET` comes from the Stripe Dashboard webhook
   endpoint you create in step 3, NOT from your API keys page.
   `SUPABASE_SERVICE_ROLE_KEY` is under Project Settings → API —
   treat it like a root password. It is the only credential in this
   project allowed to bypass `orders`' row-level security (see the
   comment on that table in `schema.sql`); never put it in `config.js`,
   never send it to a browser, never commit it.
2. Deploy the function:
   ```
   supabase functions deploy stripe-webhook --no-verify-jwt
   ```
   `--no-verify-jwt` is required here too — Stripe calls this endpoint
   directly with no Supabase auth context. Signature verification
   inside the function *is* this endpoint's authentication.
3. In the Stripe Dashboard → Developers → Webhooks, add an endpoint
   pointing at `https://YOUR-PROJECT-REF.functions.supabase.co/stripe-webhook`
   and subscribe it to `checkout.session.completed`.
4. Query recorded orders from the Supabase SQL editor (running as the
   table owner, which bypasses RLS the same way `service_role` does) —
   there is deliberately no client-facing read policy on `orders` yet;
   a customer-facing order-lookup page is a real feature to design later
   (e.g. a signed lookup link, not a guessable URL), not a retrofit.

## Known gaps before going live

The current wiring supports test-mode checkout end-to-end, with order
recording. Before you switch `STRIPE_SECRET_KEY` to a live-mode
`sk_live_` key, close these:

1. **CSP `connect-src` is wildcarded.** `account.html` allows
   `https://*.supabase.co`, which is broader than needed. When you
   deploy, tighten it to your exact project ref
   (`https://YOUR-PROJECT-REF.supabase.co`) so an XSS on the storefront
   couldn't exfiltrate data to some *other* Supabase project.
2. **create-checkout-session's rate limit is best-effort only.** It has
   an in-memory per-IP sliding-window counter (10 checkout attempts per
   60 s, with a tighter fallback bucket for callers with no trustworthy
   IP header) as a speed bump against scripted flooding, but it resets
   on every cold start. It does correctly prefer Cloudflare's
   unspoofable `cf-connecting-ip` over the client-forgeable
   `x-forwarded-for`, but a genuinely determined attacker with many
   real source IPs is not stopped by this alone. For real protection,
   wire the existing Cloudflare Turnstile plumbing (`TURNSTILE_SITE_KEY`
   in `config.js` — see the account-creation flow for how it's already
   used there) onto the Proceed-to-Payment button, and validate the
   token server-side before the Stripe API call.
3. **Origin allowlist is browser-only.** Both Edge Functions check the
   `Origin` header against `ALLOWED_ORIGINS`, but that header is set by
   *the caller* — real browsers set it honestly, but `curl` and any
   scripted client can send any value. Treat this as a defense against
   accidental cross-origin browser traffic, not against a determined
   attacker. The Turnstile fix in item 2 also closes this for checkout;
   `stripe-webhook`'s real authentication is its signature check, not
   its Origin header (Stripe's servers don't send a browser-style
   Origin at all — the signature is what matters there).
4. **No customer-facing order lookup.** `orders` intentionally has no
   read policy for `anon`/`authenticated` yet — see the schema comment.
   Confirmation is currently just the on-page "payment received"
   message right after checkout; a returning customer has no way to
   look up an order later. Needs deliberate design (signed lookup
   token, or tie orders to `profiles.id` once checkout requires
   sign-in) before shipping, not a quick permissive policy.
