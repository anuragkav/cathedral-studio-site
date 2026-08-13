// Cathedral Studio — pure request-validation + rate-limit logic for the
// create-checkout-session edge function.
//
// Kept as ES-module .mjs (not .ts, not embedded in index.ts) so both Deno
// (the edge function's runtime) and Node's `node --test` runner (unit
// tests in test/unit) can import it as-is, with no build step and no
// duplicated logic between the two.
//
// Everything here is pure — no I/O, no Stripe, no Deno globals — so a
// unit test can exercise the exact same normalizeBody() and
// isRateLimited() that ship in production, instead of a
// round-tripped-through-Playwright approximation.

export const TOKEN_RE = /^[a-f0-9-]{16,128}$/i;

export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;
// Anything hitting the endpoint without a trusted IP header (see
// clientIpFrom) is bucketed here alone, with a tighter budget than a
// single identified user gets. Not shared with legitimate identified
// traffic — a null-IP flood cannot lock out real users.
export const NO_IP_KEY = "__no_ip__";
export const NO_IP_MAX = 3;

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Trust order for extracting the caller's IP:
//   1. `cf-connecting-ip` — Cloudflare sets this on ingress; a client
//      cannot overwrite it before it reaches the function.
//   2. Last hop of `x-forwarded-for` — behind a different (or no)
//      proxy, the client's own value CAN appear at the front of the
//      list; the LAST value is the one set by the nearest trusted hop,
//      if any. Taking the first value would let a caller shard past
//      the per-IP rate limit by rotating fake front-of-list IPs.
//   3. Null — no trusted signal, don't invent one. isRateLimited()
//      treats null as "use the null-IP fallback bucket".
export function clientIpFrom(getHeader) {
  const cf = getHeader("cf-connecting-ip");
  if (cf) return String(cf).trim() || null;
  const fwd = getHeader("x-forwarded-for");
  if (fwd) {
    const parts = String(fwd).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return null;
}

// Sliding window over `buckets` (a Map the caller owns, so tests can
// inject a fresh one per test and the edge function can share one
// module-level Map across requests).
export function isRateLimited(buckets, clientIp, now = Date.now()) {
  const key = clientIp ?? NO_IP_KEY;
  const max = clientIp ? RATE_LIMIT_MAX : NO_IP_MAX;
  const stamps = (buckets.get(key) ?? []).filter(
    (t) => now - t < RATE_LIMIT_WINDOW_MS,
  );
  if (stamps.length >= max) {
    buckets.set(key, stamps);
    return true;
  }
  stamps.push(now);
  buckets.set(key, stamps);
  if (buckets.size > 5000) {
    for (const [ip, ts] of buckets) {
      if (ts.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) buckets.delete(ip);
    }
  }
  return false;
}

// Validates and normalizes the request body. Never trusts client-supplied
// prices/names — those are looked up in `catalog` (a Record<id, {name,
// unitAmount}>) by the caller. Also merges duplicate ids UP FRONT so a
// hand-crafted body listing the same id multiple times cannot bypass the
// per-line quantity cap by summing across duplicate entries.
export function normalizeBody(input, opts) {
  const { catalog, maxCartLines, maxQtyPerLine } = opts;

  if (!isPlainObject(input)) return { ok: false, error: "Body must be a JSON object." };
  const body = input;

  if (typeof body.checkout_token !== "string" || !TOKEN_RE.test(body.checkout_token)) {
    return { ok: false, error: "Missing or malformed checkout token." };
  }
  const token = body.checkout_token;

  if (!Array.isArray(body.items)) {
    return { ok: false, error: "items must be an array." };
  }
  if (body.items.length === 0) {
    return { ok: false, error: "Cart is empty." };
  }
  if (body.items.length > maxCartLines) {
    return { ok: false, error: "Too many cart lines." };
  }

  const byId = new Map();
  for (const raw of body.items) {
    if (!isPlainObject(raw)) return { ok: false, error: "Each cart line must be an object." };
    const id = raw.id;
    const qty = raw.qty;
    if (typeof id !== "string" || id.length === 0 || id.length > 64) {
      return { ok: false, error: "Invalid item id." };
    }
    if (!Object.prototype.hasOwnProperty.call(catalog, id)) {
      return { ok: false, error: `Unknown item: ${id}` };
    }
    if (typeof qty !== "number" || !Number.isFinite(qty)) {
      return { ok: false, error: "Invalid quantity." };
    }
    const n = Math.trunc(qty);
    if (n < 1) return { ok: false, error: "Quantity must be at least 1." };
    const existing = byId.get(id) ?? 0;
    const merged = existing + n;
    byId.set(id, merged > maxQtyPerLine ? maxQtyPerLine : merged);
  }
  const lines = Array.from(byId.entries()).map(([id, qty]) => ({ id, qty }));
  return { ok: true, lines, token };
}
