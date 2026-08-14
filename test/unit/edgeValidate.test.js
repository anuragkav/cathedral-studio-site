// Unit tests for supabase/functions/_shared/validate.js.
//
// The edge function's actual request-validation and rate-limit logic
// lives in that shared module so both Deno (production) and Node's
// test runner (this file) can import it. Prior to this coverage, the
// only defense of the checkout endpoint was end-to-end via Playwright
// stubbing the fetch response — which meant the pure input-parsing
// (spoofed IP handling, duplicate-id merge, boundary quantities) went
// entirely unverified against the real code path.
const { test, before } = require("node:test");
const assert = require("node:assert/strict");

// The shared module is ESM (used from Deno as well as here) — dynamic
// import into this CJS test file, populated once in a before() hook and
// referenced by every test below as `V`.
let V;
before(async () => {
  V = await import("../../supabase/functions/_shared/validate.mjs");
});

const CATALOG = {
  "men-01": { id: "men-01", name: "Nave Overcoat", unitAmount: 145_000 },
  "men-13": { id: "men-13", name: "Narthex Tee",    unitAmount:  13_500 }
};
const OPTS = { catalog: CATALOG, maxCartLines: 50, maxQtyPerLine: 10 };
const VALID_TOKEN = "a".repeat(32);

test("normalizeBody rejects non-object bodies", () => {
  assert.equal(V.normalizeBody(null, OPTS).ok, false);
  assert.equal(V.normalizeBody("hello", OPTS).ok, false);
  assert.equal(V.normalizeBody([1, 2], OPTS).ok, false);
});

test("normalizeBody rejects a missing or malformed checkout_token", () => {
  assert.match(V.normalizeBody({ items: [] }, OPTS).error, /token/i);
  assert.match(V.normalizeBody({ items: [], checkout_token: "short" }, OPTS).error, /token/i);
  // A path-traversal-ish or script-tag-shaped token must not sneak through
  // just because it happens to be 32+ chars — the regex is the boundary.
  assert.match(V.normalizeBody({ items: [], checkout_token: "../".repeat(20) }, OPTS).error, /token/i);
  assert.match(V.normalizeBody({ items: [], checkout_token: "<script>".repeat(6) }, OPTS).error, /token/i);
});

test("normalizeBody rejects a missing/empty items array", () => {
  const base = { checkout_token: VALID_TOKEN };
  assert.match(V.normalizeBody({ ...base }, OPTS).error, /items must be an array/i);
  assert.match(V.normalizeBody({ ...base, items: "not-an-array" }, OPTS).error, /items must be an array/i);
  assert.match(V.normalizeBody({ ...base, items: [] }, OPTS).error, /cart is empty/i);
});

test("normalizeBody rejects too many cart lines", () => {
  const items = Array.from({ length: OPTS.maxCartLines + 1 }, (_, i) => ({ id: "men-01", qty: 1 + (i % 3) }));
  const r = V.normalizeBody({ checkout_token: VALID_TOKEN, items }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.error, /too many/i);
});

test("normalizeBody rejects an unknown item id (catalog is the trust boundary)", () => {
  const r = V.normalizeBody({ checkout_token: VALID_TOKEN, items: [{ id: "not-in-catalog", qty: 1 }] }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown item/i);
});

test("normalizeBody rejects a prototype-pollution attempt via item id (__proto__ etc.)", () => {
  // Even though the item id looks like a valid string, __proto__ is a
  // key that exists on every object; a naive `id in catalog` check would
  // return true for it. hasOwnProperty is the correct check, and this
  // test locks that behavior in against a future regression.
  const r = V.normalizeBody({ checkout_token: VALID_TOKEN, items: [{ id: "__proto__", qty: 1 }] }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown item/i);
});

test("normalizeBody rejects an over-long id (id length ceiling stops payload amplification)", () => {
  const r = V.normalizeBody({ checkout_token: VALID_TOKEN, items: [{ id: "x".repeat(65), qty: 1 }] }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid item id/i);
});

test("normalizeBody rejects non-integer, non-finite, or sub-1 quantities", () => {
  const base = { checkout_token: VALID_TOKEN };
  assert.match(V.normalizeBody({ ...base, items: [{ id: "men-01", qty: "1" }] }, OPTS).error, /quantity/i);
  assert.match(V.normalizeBody({ ...base, items: [{ id: "men-01", qty: NaN }] }, OPTS).error, /quantity/i);
  assert.match(V.normalizeBody({ ...base, items: [{ id: "men-01", qty: Infinity }] }, OPTS).error, /quantity/i);
  assert.match(V.normalizeBody({ ...base, items: [{ id: "men-01", qty: 0 }] }, OPTS).error, /at least 1/i);
  assert.match(V.normalizeBody({ ...base, items: [{ id: "men-01", qty: -5 }] }, OPTS).error, /at least 1/i);
});

test("normalizeBody merges duplicate ids and clamps the merged qty at maxQtyPerLine", () => {
  // Adversarial case: attacker splits qty across duplicate line entries
  // hoping their sum exceeds the per-line ceiling. Merging on the way in
  // (rather than after clamping each) is the fix — verified here.
  const r = V.normalizeBody({
    checkout_token: VALID_TOKEN,
    items: [
      { id: "men-01", qty: 8 },
      { id: "men-01", qty: 8 },
      { id: "men-01", qty: 8 }
    ]
  }, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].qty, OPTS.maxQtyPerLine);
});

test("normalizeBody truncates fractional quantities toward zero (a 0.9 becomes 0 and gets rejected)", () => {
  const r = V.normalizeBody({ checkout_token: VALID_TOKEN, items: [{ id: "men-01", qty: 0.9 }] }, OPTS);
  assert.equal(r.ok, false);
  assert.match(r.error, /at least 1/i);
});

test("normalizeBody happy path returns {ok, lines, token}", () => {
  const r = V.normalizeBody({
    checkout_token: VALID_TOKEN,
    items: [{ id: "men-01", qty: 2 }, { id: "men-13", qty: 3 }]
  }, OPTS);
  assert.equal(r.ok, true);
  assert.equal(r.token, VALID_TOKEN);
  assert.deepEqual(r.lines.sort((a, b) => a.id.localeCompare(b.id)), [
    { id: "men-01", qty: 2 },
    { id: "men-13", qty: 3 }
  ]);
});

test("clientIpFrom prefers cf-connecting-ip (trusted, cannot be overwritten by the client)", () => {
  const headers = { "cf-connecting-ip": "203.0.113.5", "x-forwarded-for": "192.0.2.1, 10.0.0.1" };
  const get = (name) => headers[name.toLowerCase()] ?? null;
  assert.equal(V.clientIpFrom(get), "203.0.113.5");
});

test("clientIpFrom falls back to LAST x-forwarded-for hop, not first — first is client-controlled", () => {
  const headers = { "x-forwarded-for": "1.2.3.4, 5.6.7.8, 10.20.30.40" };
  const get = (name) => headers[name.toLowerCase()] ?? null;
  // First = client-controlled, last = set by nearest trusted hop. Taking
  // the first would let an attacker shard past the per-IP rate limit
  // trivially — this test locks the correct choice in.
  assert.equal(V.clientIpFrom(get), "10.20.30.40");
});

test("clientIpFrom returns null when no trusted header is present (does NOT invent 'unknown')", () => {
  const get = () => null;
  // The old behavior returned "unknown", which then got bucketed as a
  // shared key — a null-IP flood could lock out real users who also
  // happened to hit the "unknown" bucket. Returning null forces the
  // caller to explicitly handle the no-IP case (via NO_IP_KEY isolation).
  assert.equal(V.clientIpFrom(get), null);
});

test("clientIpFrom trims whitespace and handles empty strings", () => {
  const headers1 = { "cf-connecting-ip": "  203.0.113.5  " };
  assert.equal(V.clientIpFrom((n) => headers1[n.toLowerCase()] ?? null), "203.0.113.5");
  const headers2 = { "cf-connecting-ip": "" };
  // Empty string is not a usable IP — should fall through to XFF or null.
  assert.equal(V.clientIpFrom((n) => headers2[n.toLowerCase()] ?? null), null);
});

test("isRateLimited allows RATE_LIMIT_MAX requests per window per IP, then blocks", () => {
  const buckets = new Map();
  const ip = "203.0.113.5";
  for (let i = 0; i < V.RATE_LIMIT_MAX; i++) {
    assert.equal(V.isRateLimited(buckets, ip, 1000 + i), false, `request ${i + 1} should be allowed`);
  }
  assert.equal(V.isRateLimited(buckets, ip, 1000 + V.RATE_LIMIT_MAX), true, "next request must be blocked");
});

test("isRateLimited window is sliding — requests aged out are no longer counted", () => {
  const buckets = new Map();
  const ip = "203.0.113.5";
  for (let i = 0; i < V.RATE_LIMIT_MAX; i++) V.isRateLimited(buckets, ip, 1000 + i);
  // Move past the window boundary. All prior stamps should age out.
  assert.equal(V.isRateLimited(buckets, ip, 1000 + V.RATE_LIMIT_WINDOW_MS + 1), false);
});

test("isRateLimited applies a TIGHTER budget to null-IP callers (NO_IP_MAX < RATE_LIMIT_MAX)", () => {
  // A null-IP flood cannot exhaust a legitimate user's budget — the two
  // are on separate keys.
  const buckets = new Map();
  for (let i = 0; i < V.NO_IP_MAX; i++) {
    assert.equal(V.isRateLimited(buckets, null, 1000 + i), false);
  }
  assert.equal(V.isRateLimited(buckets, null, 1000 + V.NO_IP_MAX), true);
  // A real IP is still fine — separate bucket, separate budget.
  assert.equal(V.isRateLimited(buckets, "203.0.113.5", 2000), false);
});

test("isRateLimited buckets are per-IP — one IP's flood cannot lock out another IP", () => {
  const buckets = new Map();
  for (let i = 0; i < V.RATE_LIMIT_MAX; i++) V.isRateLimited(buckets, "1.1.1.1", 1000 + i);
  // 1.1.1.1 is now locked out at now=2000, but 2.2.2.2 must not be affected.
  assert.equal(V.isRateLimited(buckets, "1.1.1.1", 2000), true);
  assert.equal(V.isRateLimited(buckets, "2.2.2.2", 2000), false);
});

// encodeOrderLines / decodeOrderLines — the metadata round-trip that lets
// the stripe-webhook function recover {id, qty} pairs from a Checkout
// Session's metadata without an extra Stripe API call.

test("encodeOrderLines/decodeOrderLines round-trips a small cart", () => {
  const lines = [{ id: "men-01", qty: 2 }, { id: "women-13", qty: 1 }];
  const metadata = V.encodeOrderLines(lines);
  const decoded = V.decodeOrderLines(metadata);
  assert.deepEqual(decoded.sort((a, b) => a.id.localeCompare(b.id)), lines.sort((a, b) => a.id.localeCompare(b.id)));
});

test("encodeOrderLines fits today's full 28-item catalog in a single metadata key", () => {
  // Sanity check on real-world sizing: today's catalog ids are short
  // (men-NN/women-NN), so even a maxed-out cart (all 28 lines at the
  // qty cap) stays well under Stripe's 500-char-per-value limit.
  const lines = [];
  for (let i = 1; i <= 14; i++) {
    lines.push({ id: `men-${String(i).padStart(2, "0")}`, qty: 10 });
    lines.push({ id: `women-${String(i).padStart(2, "0")}`, qty: 10 });
  }
  const metadata = V.encodeOrderLines(lines);
  assert.equal(Object.keys(metadata).length, 1);
  assert.ok(metadata.catalog_lines_0.length <= 500);
  const decoded = V.decodeOrderLines(metadata);
  assert.equal(decoded.length, lines.length);
});

test("encodeOrderLines chunks across multiple metadata keys once encoded length exceeds 500 chars", () => {
  // Forces the boundary explicitly with longer (but still realistic)
  // ids, rather than relying on today's catalog ever growing enough to
  // hit it by accident — this is the actual behavior under test, not a
  // hope that some future catalog change happens to exercise it.
  const lines = Array.from({ length: 40 }, (_, i) => ({
    id: `some-long-catalog-identifier-${i}`,
    qty: 3
  }));
  const metadata = V.encodeOrderLines(lines);
  const keys = Object.keys(metadata);
  assert.ok(keys.length >= 2, "expected chunking across multiple metadata keys");
  for (const key of keys) {
    assert.ok(metadata[key].length <= 500, `metadata value for ${key} must stay within Stripe's 500-char limit`);
  }
  const decoded = V.decodeOrderLines(metadata);
  assert.deepEqual(decoded.sort((a, b) => a.id.localeCompare(b.id)), lines.sort((a, b) => a.id.localeCompare(b.id)));
});

test("decodeOrderLines returns [] for metadata with no catalog_lines_* keys (e.g. a pre-metadata session)", () => {
  assert.deepEqual(V.decodeOrderLines({}), []);
  assert.deepEqual(V.decodeOrderLines({ some_other_key: "value" }), []);
});

test("decodeOrderLines is defensive against non-object input", () => {
  assert.deepEqual(V.decodeOrderLines(null), []);
  assert.deepEqual(V.decodeOrderLines(undefined), []);
  assert.deepEqual(V.decodeOrderLines("not an object"), []);
});

test("decodeOrderLines skips malformed pairs instead of throwing (webhook must not crash on an already-paid session)", () => {
  const decoded = V.decodeOrderLines({
    catalog_lines_0: "men-01:2,garbage-no-colon,men-13:0,women-01:-3,men-02:3"
  });
  // Only the genuinely valid pair should survive: qty must be >= 1 and a
  // colon must separate id from qty.
  assert.deepEqual(decoded, [{ id: "men-01", qty: 2 }, { id: "men-02", qty: 3 }]);
});

test("decodeOrderLines orders chunks numerically, not lexically (catalog_lines_10 after catalog_lines_9, not before catalog_lines_2)", () => {
  const metadata = {
    catalog_lines_10: "b-item:1",
    catalog_lines_2: "a-item:1",
    catalog_lines_0: "z-item:1"
  };
  const decoded = V.decodeOrderLines(metadata);
  assert.deepEqual(decoded.map((l) => l.id), ["z-item", "a-item", "b-item"]);
});
