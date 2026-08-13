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

### Known gaps before going live

The current wiring supports test-mode checkout end-to-end. Before you
switch `STRIPE_SECRET_KEY` to a live-mode `sk_live_` key, close these:

1. **No Stripe webhook / no order of record.** The Edge Function only
   creates a Checkout Session — nothing on your side ever records that
   a payment succeeded. Add a second Edge Function subscribed to the
   Stripe `checkout.session.completed` webhook (verify the signature
   with `STRIPE_WEBHOOK_SECRET`) that writes a row into a Supabase
   `orders` table. The `client_reference_id` on the session is the
   same token the browser stored in sessionStorage, so it lets you
   correlate paid sessions back to the originating browser tab (and,
   once you add auth, to the shopper's account).
2. **CSP `connect-src` is wildcarded.** `checkout.html` allows
   `https://*.supabase.co`, which is broader than needed. When you
   deploy, tighten it to your exact project ref
   (`https://YOUR-PROJECT-REF.supabase.co`) so an XSS on the storefront
   couldn't exfiltrate data to some *other* Supabase project.
3. **Rate limit is best-effort only.** The Edge Function has a small
   in-memory per-IP counter (10 checkout attempts per 60 s, plus a
   tighter fallback bucket for IP-less callers) as a speed bump
   against scripted flooding, but it resets on every cold start and
   is bypassable by any attacker who can rotate source IPs. For real
   protection, wire the existing Cloudflare Turnstile plumbing
   (`TURNSTILE_SITE_KEY` in `config.js` — see the account-creation
   flow for how it's already used) onto the Proceed-to-Payment
   button, and validate the token server-side before the Stripe API
   call. That defends against a determined attacker in a way an
   in-memory counter cannot.
4. **Origin allowlist is browser-only.** The Edge Function refuses
   requests whose `Origin` header isn't on `ALLOWED_ORIGINS`, but the
   `Origin` header is set by *the caller* — real browsers set it
   honestly, but `curl` and any scripted client can send any value.
   Treat this as a defense against accidental cross-origin browser
   traffic, not against a determined attacker. The Turnstile fix in
   item 3 also closes this.
