// Cathedral Studio — stripe-webhook Supabase Edge Function.
//
// Receives Stripe's checkout.session.completed webhook and records a row
// in public.orders. This is the ONLY place an order is created — without
// it, create-checkout-session successfully starts a Stripe Checkout
// Session, the customer pays, and nothing on our side ever finds out.
//
// Trust boundary: unlike create-checkout-session (which distrusts the
// caller and trusts only the server-side CATALOG), this function trusts
// the CALLER — but only after verifying the request actually came from
// Stripe via HMAC signature verification over the raw request body. A
// request with a missing/invalid/replayed-past-tolerance signature is
// rejected before any parsing happens, full stop.
//
// Deploy:
//   supabase functions deploy stripe-webhook --no-verify-jwt
// Secrets (set once per env — never checked in):
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_...        (same as create-checkout-session)
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...      (from the Stripe Dashboard webhook endpoint, NOT the API key)
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ...      (Project Settings -> API -> service_role; bypasses RLS, never expose to a browser)
// Register the endpoint in the Stripe Dashboard -> Developers -> Webhooks,
// pointing at:
//   https://<project-ref>.functions.supabase.co/stripe-webhook
// and select the checkout.session.completed event (and optionally
// checkout.session.async_payment_failed / .expired if you want to record
// those too — see the switch below).
//
// --no-verify-jwt is required: Stripe calls this endpoint directly with
// no Supabase auth context at all. The signature check above is this
// function's actual authentication, not Supabase's JWT layer.

import Stripe from "https://esm.sh/stripe@16.12.0?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=denonext";
import { decodeOrderLines } from "../_shared/validate.mjs";

// deno-lint-ignore no-explicit-any
declare const Deno: any;

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: the first is auto-injected
// by the Supabase platform into every Edge Function's environment; only
// the second needs to be set explicitly as a secret (see deploy notes
// above). Using the service_role key here is intentional and required —
// this function is the ONE place allowed to bypass orders' default-deny
// RLS (see the comment on public.orders in schema.sql).
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  httpClient: Stripe.createFetchHttpClient(),
});

// deno-lint-ignore no-explicit-any
let supabaseAdmin: any = null;
function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return supabaseAdmin;
}

function textResponse(body: string, status: number): Response {
  // Stripe does not read the response body meaningfully — it only cares
  // about the status code (2xx = delivered, anything else = retry per
  // Stripe's backoff schedule). Plain text is fine; no CORS headers are
  // needed since a browser never calls this endpoint, only Stripe's
  // servers do.
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

// deno-lint-ignore no-explicit-any
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return textResponse("Method not allowed.", 405);
  }
  if (!STRIPE_WEBHOOK_SECRET) {
    // Fail closed: with no configured secret, EVERY signature would
    // otherwise need special-casing to "pass" — that's a trivially
    // exploitable bypass. Refuse to process anything until it's set.
    console.error("STRIPE_WEBHOOK_SECRET is not configured.");
    return textResponse("Webhook is not configured.", 500);
  }

  // Stripe signs the EXACT raw bytes of the request body — reading it as
  // text (not req.json()) before any parsing is required for
  // constructEventAsync to verify correctly. Parsing first and
  // re-serializing would very likely produce different bytes (key order,
  // whitespace) and make every signature check fail.
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return textResponse("Missing Stripe-Signature header.", 400);
  }

  // deno-lint-ignore no-explicit-any
  let event: any;
  try {
    // constructEventAsync (not the sync constructEvent) is required
    // under Deno — Stripe's signature verification uses SubtleCrypto,
    // which is only available as an async API in this runtime.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    // Do not echo `err` details in the response — that could leak
    // information about why verification failed to a probing attacker.
    // The server log (console.error) is the place to actually look.
    console.error("Stripe webhook signature verification failed", err);
    return textResponse("Invalid signature.", 400);
  }

  if (event.type !== "checkout.session.completed") {
    // Acknowledge and ignore. Returning 200 for event types we don't
    // handle tells Stripe "delivered, don't retry" — the alternative
    // (a non-2xx) would make Stripe retry an event we were never going
    // to act on anyway, and Stripe's dashboard would report those as
    // failures even though nothing is actually wrong.
    return textResponse("Ignored event type.", 200);
  }

  const session = event.data.object;

  // A Checkout Session can complete via async payment methods (e.g. bank
  // debits) where checkout.session.completed fires before the payment
  // has actually settled. payment_status distinguishes "customer
  // finished checkout" from "money has actually moved" — only record as
  // paid when it's genuinely "paid", so a later
  // checkout.session.async_payment_failed (not handled here, but a real
  // Stripe event) doesn't contradict a row we already marked complete.
  const isPaid = session.payment_status === "paid";

  const lineItems = decodeOrderLines(session.metadata ?? {});

  const orderRow = {
    stripe_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : null,
    customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    amount_total_cents: typeof session.amount_total === "number" ? session.amount_total : 0,
    currency: session.currency ?? "usd",
    line_items: lineItems,
    shipping_address: session.shipping_details?.address ?? null,
    status: isPaid ? "paid" : session.payment_status ?? "unknown",
  };

  try {
    const admin = getSupabaseAdmin();
    // Upsert on stripe_session_id (the table's unique constraint) rather
    // than insert: Stripe's webhook delivery is documented as
    // at-least-once, and this event (or a related one for the same
    // session) can legitimately arrive more than once. An insert-only
    // handler would throw a duplicate-key error on redelivery and make
    // Stripe retry forever; upsert makes redelivery a safe no-op.
    const { error } = await admin.from("orders").upsert(orderRow, { onConflict: "stripe_session_id" });
    if (error) {
      console.error("Failed to upsert order", error);
      // A non-2xx here tells Stripe to retry — appropriate for a
      // transient DB error, since the alternative is silently losing
      // a paid order with no record of it anywhere.
      return textResponse("Failed to record order.", 500);
    }
  } catch (err) {
    console.error("Unexpected error recording order", err);
    return textResponse("Failed to record order.", 500);
  }

  return textResponse("ok", 200);
});
