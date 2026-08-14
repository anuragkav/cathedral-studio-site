-- Minimal stand-in for the parts of Supabase's `auth` schema that
-- schema.sql depends on. Real Supabase provisions `auth.users` and
-- `auth.uid()` for every project; this repo's schema.sql only ever runs
-- against that pre-provisioned environment, so a plain Postgres instance
-- needs this stub before schema.sql will even apply, let alone let RLS
-- policies referencing auth.uid() be exercised for real.
--
-- auth.uid() in real Supabase reads the `sub` claim off the request's
-- verified JWT via a `request.jwt.claims` GUC. This stub reads the same
-- shape of signal from a session-local GUC (`app.current_user_id`) that
-- the test driver sets per connection with `SET LOCAL` before each
-- query — that's what lets a single Postgres instance prove "user A's
-- session cannot see/touch user B's row" without standing up real JWT
-- verification.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

-- Real Supabase's `authenticated` and `anon` roles are what RLS policies
-- are actually enforced against (the anon key connects as `anon`, a
-- logged-in user's request runs as `authenticated`). Mirroring that
-- distinction here, rather than testing as the Postgres superuser, is
-- what makes RLS failures in this test suite real: the table owner
-- bypasses RLS entirely, so a same-role test would pass even if every
-- policy below were deleted.
-- service_role is the third role real Supabase requests can run as — the
-- one the SUPABASE_SERVICE_ROLE_KEY authenticates as, and the only one
-- that BYPASSES row level security entirely (real Postgres BYPASSRLS
-- attribute, not a policy). stripe-webhook/index.ts uses this role via
-- the Supabase JS client's service_role key specifically so it can write
-- to public.orders, which otherwise has zero permissive policies for any
-- other role. Testing that bypass for real (not just asserting "there's
-- no policy so it must be blocked") is what proves the webhook's actual
-- write path works, not just that everyone else's is blocked.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
end
$$;

grant usage on schema auth, public to authenticated, anon, service_role;
grant select on auth.users to authenticated, anon, service_role;
