// Cathedral Studio — Supabase project config.
//
// SUPABASE_ANON_KEY is a public, publishable key — safe to ship in
// client-side JS by design (Supabase's row-level security policies, not
// this key, are what protect the data). Do not put a service_role key
// here or anywhere in this repo.
//
// Replace both placeholders with the values from
// Supabase Dashboard → Project Settings → API, then remove this comment.
window.CATHEDRAL_CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT-REF.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-PUBLIC-KEY"
};
