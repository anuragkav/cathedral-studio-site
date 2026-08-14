-- Cathedral Studio — account system schema.
-- Run this once in the Supabase project's SQL editor (or via `supabase db push`).
-- Auth (signup/login/password/session) is handled entirely by Supabase's
-- built-in auth.users table — this file only adds the public profile that
-- sits alongside it, plus the row-level security that makes direct
-- client-side reads/writes to Postgres safe.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint display_name_length check (char_length(display_name) <= 80)
);

alter table public.profiles enable row level security;

-- Each user may read only their own profile row.
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- Each user may update only their own profile row, and may not
-- reassign it to someone else's id.
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No insert/delete policy is defined for regular users: rows are created
-- only by the trigger below (as the security-definer function owner) and
-- deleted only via the auth.users cascade — never directly by a client.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_profiles_updated on public.profiles;
create trigger on_profiles_updated
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- The update RLS policy above only restricts which ROW a user can touch,
-- not which COLUMNS — without this, a user could UPDATE their own row's
-- `email` to an arbitrary string, decoupling it from the verified
-- auth.users.email it's meant to mirror. Force it (and id, belt-and-
-- suspenders alongside the with-check clause above) back to their prior
-- values on every update, regardless of what the client sends.
create or replace function public.protect_immutable_profile_columns()
returns trigger
language plpgsql
as $$
begin
  new.id = old.id;
  new.email = old.email;
  return new;
end;
$$;

drop trigger if exists on_profiles_protect_immutable on public.profiles;
create trigger on_profiles_protect_immutable
  before update on public.profiles
  for each row execute function public.protect_immutable_profile_columns();

-- Orders: written ONLY by the stripe-webhook edge function (via the
-- service_role key, which bypasses RLS entirely by design — this is the
-- one and only writer). Checkout is anonymous (see
-- create-checkout-session's --no-verify-jwt), so there is no auth.uid()
-- to scope a client-facing policy to; rather than write a policy that
-- would have to be "true" for anon/authenticated and hope nobody ever
-- calls it from the client, RLS is enabled with NO policies at all,
-- which defaults to deny-all for every role except the table owner and
-- service_role (which bypasses RLS). This table is intentionally
-- unreachable from any anon/authenticated client request — order lookup
-- for a customer is a future feature that would need its own
-- deliberately-scoped read policy (e.g. by a signed lookup token in the
-- URL, not by anything guessable), not a retrofit onto this table's
-- default posture.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  -- Stripe's Checkout Session id. Unique so the webhook's upsert is
  -- naturally idempotent against Stripe's documented at-least-once
  -- delivery (the same event, or a related event for the same session,
  -- can arrive more than once).
  stripe_session_id text not null unique,
  stripe_payment_intent_id text,
  customer_email text,
  -- Integer cents, matching cart.js/catalog.ts convention throughout
  -- this codebase — never a float, for the same reason as everywhere
  -- else prices are handled here.
  amount_total_cents integer not null,
  currency text not null,
  -- Raw {id, qty} pairs decoded from the Session's metadata (see
  -- encodeOrderLines/decodeOrderLines in _shared/validate.mjs). Kept as
  -- jsonb rather than a normalized line-items table because this is a
  -- point-in-time record of what Stripe actually charged for, not a
  -- live-editable order — normalizing it would invite someone to "fix"
  -- a line after the fact, which should never happen to a paid order.
  line_items jsonb not null,
  shipping_address jsonb,
  -- Stripe's own status vocabulary (e.g. "complete", "expired") for the
  -- Checkout Session, recorded as received rather than reinterpreted.
  status text not null,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
-- No policies defined — see the comment above the table. This is
-- deliberate default-deny, not an oversight; do not add a permissive
-- policy here without designing a real customer-scoped access model.
