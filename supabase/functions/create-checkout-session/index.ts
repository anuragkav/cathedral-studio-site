// Cathedral Studio — create-checkout-session Supabase Edge Function.
//
// Accepts a JSON body: { items: [{ id: string, qty: number }, ...], checkout_token: string }
// Returns:                { url: string }   (Stripe Checkout Session URL)
//
// Trust boundary: the request comes from the shopper's browser, so
// nothing in the body is trusted for money. The function looks each id
// up in the server-side CATALOG for its unit amount, clamps qty to the
// per-line ceiling, computes shipping from the true subtotal, and only
// then hands values to Stripe. The client-side cart's `price` field is
// never read here — that field exists only to render the summary.
//
// Deploy:
//   supabase functions deploy create-checkout-session --no-verify-jwt
// Secrets (set once per env — never checked in):
//   supabase secrets set STRIPE_SECRET_KEY=sk_test_...
//   supabase secrets set ALLOWED_ORIGINS="https://anuragkav.github.io,http://localhost:4173"
//   supabase secrets set SITE_URL="https://anuragkav.github.io/cathedral-studio-site"
//
// --no-verify-jwt is intentional: checkout is available to anonymous
// shoppers, and the security posture is "trust the CATALOG, distrust
// the body", not "trust the caller". If you later require sign-in to
// check out, drop the flag and add an auth.getUser() check here.

import Stripe from "https://esm.sh/stripe@16.12.0?target=denonext";
import {
  CATALOG,
  CURRENCY,
  FLAT_SHIPPING_CENTS,
  FREE_SHIPPING_THRESHOLD_CENTS,
  MAX_CART_LINES,
  MAX_QTY_PER_LINE,
} from "../_shared/catalog.ts";
// Pure request-validation and rate-limit logic — the same file is imported
// by node --test in test/unit so this exact code is unit-tested, not just
// exercised indirectly via the end-to-end suite.
// deno-lint-ignore no-explicit-any
import {
  clientIpFrom as sharedClientIpFrom,
  isRateLimited as sharedIsRateLimited,
  normalizeBody as sharedNormalizeBody,
  RATE_LIMIT_WINDOW_MS,
} from "../_shared/validate.mjs";

// Deno globals ambient declaration — Edge Functions run under Deno.
// deno-lint-ignore no-explicit-any
declare const Deno: any;

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((s: string) => s.trim())
  .filter(Boolean);
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
  // Under Deno, Stripe's default node http client won't work; force fetch.
  httpClient: Stripe.createFetchHttpClient(),
});

function corsHeaders(origin: string | null): Record<string, string> {
  // Never echo an arbitrary origin — that would defeat CORS. Only echo
  // when the request's Origin is on the configured allowlist; otherwise
  // omit Access-Control-Allow-Origin so the browser refuses the response.
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : "";
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return headers;
}

function jsonResponse(
  body: unknown,
  init: { status: number; origin: string | null; extraHeaders?: Record<string, string> },
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(init.origin),
      ...(init.extraHeaders ?? {}),
    },
  });
}

// The real validation and rate-limit logic lives in _shared/validate.mjs so
// Node's test runner can exercise it directly. Everything below wires
// those shared functions to this function's specific catalog/limits and
// the request/response shape.

const rateBuckets = new Map<string, number[]>();

function normalizeBody(input: unknown):
  | { ok: true; lines: Array<{ id: string; qty: number }>; token: string }
  | { ok: false; error: string } {
  return sharedNormalizeBody(input, {
    catalog: CATALOG,
    maxCartLines: MAX_CART_LINES,
    maxQtyPerLine: MAX_QTY_PER_LINE,
  });
}

function isRateLimited(clientIp: string | null): boolean {
  return sharedIsRateLimited(rateBuckets, clientIp);
}

function clientIpFrom(req: Request): string | null {
  return sharedClientIpFrom((name: string) => req.headers.get(name));
}

function computeSubtotalCents(lines: Array<{ id: string; qty: number }>): number {
  let sum = 0;
  for (const line of lines) {
    // CATALOG lookup is guaranteed by normalizeBody above.
    sum += CATALOG[line.id].unitAmount * line.qty;
  }
  return sum;
}

function buildLineItems(lines: Array<{ id: string; qty: number }>) {
  return lines.map((line) => {
    const item = CATALOG[line.id];
    return {
      price_data: {
        currency: CURRENCY,
        product_data: {
          // Stripe displays this to the shopper; the CATALOG name is trusted.
          name: item.name,
          metadata: { catalog_id: item.id },
        },
        unit_amount: item.unitAmount,
      },
      quantity: line.qty,
    };
  });
}

function buildShippingOptions(subtotalCents: number) {
  const amount = subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
  const label = amount === 0 ? "Free shipping" : "Standard shipping";
  return [{
    shipping_rate_data: {
      type: "fixed_amount" as const,
      fixed_amount: { amount, currency: CURRENCY },
      display_name: label,
    },
  }];
}

// deno-lint-ignore no-explicit-any
Deno.serve(async (req: Request): Promise<Response> => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, { status: 405, origin });
  }

  // Even for CORS-cleared browsers, reject cross-origin POSTs at the
  // application layer — CORS is a browser-side courtesy, not a server
  // guarantee (curl and other non-browser clients ignore it).
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
    return jsonResponse({ error: "Origin not allowed." }, { status: 403, origin });
  }

  if (!STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "Server is not configured for checkout." }, { status: 500, origin });
  }
  if (!SITE_URL) {
    return jsonResponse({ error: "Server is not configured for checkout." }, { status: 500, origin });
  }

  if (isRateLimited(clientIpFrom(req))) {
    // 429 with a bland message — do not include the current window count
    // (that would help attackers time their bursts). Retry-After lets
    // well-behaved clients (browsers, fetch libraries) back off correctly
    // without needing to parse the response body.
    return jsonResponse(
      { error: "Too many checkout attempts. Please wait a minute and try again." },
      {
        status: 429,
        origin,
        extraHeaders: { "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)) },
      },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Body must be valid JSON." }, { status: 400, origin });
  }

  const normalized = normalizeBody(body);
  if (!normalized.ok) {
    return jsonResponse({ error: normalized.error }, { status: 400, origin });
  }

  const subtotalCents = computeSubtotalCents(normalized.lines);
  const lineItems = buildLineItems(normalized.lines);
  const shippingOptions = buildShippingOptions(subtotalCents);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ["US", "CA", "GB"],
      },
      shipping_options: shippingOptions,
      // The token round-trips: the client's stashed sessionStorage token
      // is placed into success_url so the client can verify on return
      // that THIS tab initiated the checkout (defeats attacker-crafted
      // "?checkout=success" links). {CHECKOUT_SESSION_ID} is substituted
      // by Stripe at redirect time so the success page can confirm
      // payment status against Stripe rather than trusting the query
      // string alone.
      success_url:
        `${SITE_URL}/checkout.html?checkout=success` +
        `&token=${encodeURIComponent(normalized.token)}` +
        `&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/checkout.html?checkout=cancelled` +
        `&token=${encodeURIComponent(normalized.token)}`,
    }, {
      // Reusing the same idempotency key across retries makes Stripe
      // return the SAME session instead of creating duplicates when a
      // double-click or transient network error retries the request.
      idempotencyKey: normalized.token,
    });

    if (!session.url) {
      return jsonResponse({ error: "Stripe did not return a checkout URL." }, { status: 502, origin });
    }
    return jsonResponse({ url: session.url }, { status: 200, origin });
  } catch (err) {
    // Never leak Stripe error internals to the client — a raw Stripe
    // error can echo request details or API keys in edge cases.
    console.error("stripe.checkout.sessions.create failed", err);
    return jsonResponse({ error: "Could not start checkout." }, { status: 502, origin });
  }
});
