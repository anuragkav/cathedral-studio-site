# Cathedral Studio — site

Bare-bones v0 waitlist site for Cathedral Studio, deployed via GitHub Pages. Plain HTML/CSS/JS, no framework, no Shopify storefront.

Business research, risk register, and roadmap live in the private [cathedral_clothing](https://github.com/anuragkav/cathedral_clothing) repo — this repo is public (required for free GitHub Pages hosting) and contains only the public-facing site, no business/strategy documents.

Current phase: waitlist/email-capture only, per the phased roadmap in the private repo — no live checkout yet.

## Accounts setup (Supabase)

The account system (`account.html`, `auth.js`, `account.js`) needs a Supabase project to work:

1. Create a project at supabase.com, then run `supabase/schema.sql` in its SQL editor.
2. Fill in `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `config.js` (the anon/publishable key is safe to commit — see the comment in that file. Never put a `service_role` key there).
3. In the Supabase dashboard, under Authentication → URL Configuration, add this site's `account.html` URL (e.g. `https://<user>.github.io/cathedral-studio-site/account.html`) to the **Redirect URLs** allowlist. Without this, password-reset links fall back to the project's default Site URL and silently drop the `?mode=update-password` param, signing the user in without ever showing the "set a new password" form.
