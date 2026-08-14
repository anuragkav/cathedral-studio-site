// Real-Postgres integration tests for supabase/schema.sql.
//
// Every other test in this repo (test/unit, test/e2e) runs against
// mockSupabase.js — a JS object with no concept of Postgres roles or
// row-level security. That leaves the actual security boundary this
// account system relies on — the RLS policies and triggers in
// schema.sql — completely unverified by automation. These tests close
// that gap by running schema.sql against a real, ephemeral Postgres
// instance (via embedded-postgres, no Docker required) and proving the
// policies hold when queried as different authenticated users, not as
// the table owner (which bypasses RLS entirely and would pass even with
// no policies at all).
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { Client } = require("pg");

// embedded-postgres ships ESM-only; a top-level dynamic import keeps this
// file plain CommonJS (consistent with the rest of the test suite) while
// still loading it.
let EmbeddedPostgres;

const DATA_DIR = path.join(__dirname, ".pgdata");
const PORT = 54329;

let pg;
let adminClient;

// Runs a query as a specific app user: opens its own connection (so
// role/GUC state from one test can't bleed into another), sets the
// Postgres role RLS actually enforces against, and stamps
// app.current_user_id so auth.uid() resolves the same way a real
// Supabase request's JWT would for that user. Commits (rather than
// rolling back) so a later query on adminClient — a separate connection
// — can observe whatever effect this call had; each test's own fixture
// rows come from a fresh beforeEach, so nothing here needs to be undone
// between tests.
async function asUser(userId, fn) {
  const client = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    if (userId) {
      await client.query("select set_config('app.current_user_id', $1, true)", [userId]);
    }
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Same shape as asUser, but running as anon (no app.current_user_id at
// all) — models an unauthenticated request using only the public anon
// key, which is exactly how create-checkout-session's caller (and any
// direct PostgREST/client-side query) would be seen by RLS.
async function asAnon(fn) {
  const client = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role anon");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Models the ONE role allowed to touch public.orders — the service_role
// key stripe-webhook/index.ts authenticates as. Real Postgres BYPASSRLS
// (set on the role in supabaseAuthStub.sql), not a policy, is what makes
// this work — proving that is the entire point of the tests using it.
async function asServiceRole(fn) {
  const client = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await client.connect();
  try {
    await client.query("begin");
    await client.query("set local role service_role");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

before(async () => {
  ({ default: EmbeddedPostgres } = await import("embedded-postgres"));
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false
  });
  await pg.initialise();
  await pg.start();

  adminClient = new Client({ host: "localhost", port: PORT, user: "postgres", password: "postgres", database: "postgres" });
  await adminClient.connect();
  await adminClient.query('create extension if not exists "pgcrypto"');
  await adminClient.query(fs.readFileSync(path.join(__dirname, "supabaseAuthStub.sql"), "utf8"));
  await adminClient.query(fs.readFileSync(path.join(__dirname, "..", "..", "supabase", "schema.sql"), "utf8"));
  // Real Supabase auto-grants table access to `authenticated`/`anon` at
  // the project level; schema.sql itself intentionally doesn't include
  // that (it only ever runs inside a project where it's already true),
  // so the test harness — standing in for that provisioning step, not
  // for anything schema.sql is responsible for — grants it here.
  await adminClient.query("grant select, update, insert, delete on public.profiles to authenticated, anon");
  // orders gets the SAME table-level grant on purpose, even though no
  // policy exists for it — this is the point of the test below. Without
  // this grant, "authenticated can't touch orders" would trivially pass
  // for the wrong reason (no GRANT at all) instead of proving RLS itself
  // is what's blocking access, which is what actually happens in a real
  // Supabase project (grants are project-wide, RLS is what's supposed to
  // narrow them per table).
  await adminClient.query("grant select, update, insert, delete on public.orders to authenticated, anon");
  await adminClient.query("grant select, update, insert, delete on public.orders to service_role");
}, { timeout: 60_000 });

after(async () => {
  await adminClient.end();
  await pg.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

let userA;
let userB;

beforeEach(async () => {
  const a = await adminClient.query(
    "insert into auth.users (email) values ($1) returning id",
    [`user-a-${Date.now()}-${Math.random()}@example.com`]
  );
  const b = await adminClient.query(
    "insert into auth.users (email) values ($1) returning id",
    [`user-b-${Date.now()}-${Math.random()}@example.com`]
  );
  userA = a.rows[0].id;
  userB = b.rows[0].id;
});

test("the handle_new_user trigger creates a matching profiles row on signup", async () => {
  const result = await adminClient.query("select id, email, display_name from public.profiles where id = $1", [userA]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].display_name, null);
});

test("a user can select their own profile row", async () => {
  const result = await asUser(userA, (client) =>
    client.query("select id from public.profiles where id = $1", [userA])
  );
  assert.equal(result.rows.length, 1);
});

test("a user cannot select another user's profile row via RLS", async () => {
  const result = await asUser(userA, (client) =>
    client.query("select id from public.profiles where id = $1", [userB])
  );
  // A real cross-user select doesn't error — RLS just filters the row
  // out, so the correct assertion is "zero rows", not "throws".
  assert.equal(result.rows.length, 0);
});

test("an unauthenticated request (no app.current_user_id) sees no profile rows", async () => {
  const result = await asUser(null, (client) => client.query("select id from public.profiles"));
  assert.equal(result.rows.length, 0);
});

test("a user can update their own display_name", async () => {
  await asUser(userA, (client) =>
    client.query("update public.profiles set display_name = $1 where id = $2", ["Real Name", userA])
  );
  const result = await adminClient.query("select display_name from public.profiles where id = $1", [userA]);
  assert.equal(result.rows[0].display_name, "Real Name");
});

test("a user cannot update another user's profile row via RLS", async () => {
  await asUser(userA, (client) =>
    client.query("update public.profiles set display_name = $1 where id = $2", ["Hijacked", userB])
  );
  const result = await adminClient.query("select display_name from public.profiles where id = $1", [userB]);
  assert.notEqual(result.rows[0].display_name, "Hijacked");
});

test("the protect_immutable_profile_columns trigger blocks a user from rewriting their own email", async () => {
  const before = await adminClient.query("select email from public.profiles where id = $1", [userA]);
  await asUser(userA, (client) =>
    client.query("update public.profiles set email = $1 where id = $2", ["spoofed@example.com", userA])
  );
  const after = await adminClient.query("select email from public.profiles where id = $1", [userA]);
  assert.equal(after.rows[0].email, before.rows[0].email);
  assert.notEqual(after.rows[0].email, "spoofed@example.com");
});

test("the protect_immutable_profile_columns trigger blocks a user from reassigning their row's id", async () => {
  await asUser(userA, (client) =>
    client.query("update public.profiles set id = $1 where id = $2", [userB, userA])
  );
  const stillA = await adminClient.query("select id from public.profiles where id = $1", [userA]);
  const stillOneB = await adminClient.query("select count(*) from public.profiles where id = $1", [userB]);
  assert.equal(stillA.rows.length, 1);
  assert.equal(Number(stillOneB.rows[0].count), 1);
});

test("a user cannot insert an arbitrary profiles row (no insert policy exists, RLS default-denies)", async () => {
  await assert.rejects(
    () => asUser(userA, (client) =>
      client.query(
        "insert into public.profiles (id, email) values (gen_random_uuid(), 'ghost@example.com')"
      )
    ),
    /row-level security/i
  );
});

test("a user cannot delete their own profiles row (no delete policy exists, RLS default-denies)", async () => {
  // Unlike INSERT (which errors when the new row fails a WITH CHECK-style
  // visibility test), Postgres RLS handles UPDATE/DELETE with no
  // permissive policy by silently matching zero rows — no error, just a
  // no-op. The real assertion is that the row still exists afterward.
  const deleteResult = await asUser(userA, (client) => client.query("delete from public.profiles where id = $1", [userA]));
  assert.equal(deleteResult.rowCount, 0);
  const result = await adminClient.query("select id from public.profiles where id = $1", [userA]);
  assert.equal(result.rows.length, 1);
});

test("the updated_at trigger advances on a real update", async () => {
  const before = await adminClient.query("select updated_at from public.profiles where id = $1", [userA]);
  await new Promise((r) => setTimeout(r, 10));
  await asUser(userA, (client) =>
    client.query("update public.profiles set display_name = $1 where id = $2", ["Touch", userA])
  );
  const after = await adminClient.query("select updated_at from public.profiles where id = $1", [userA]);
  assert.ok(new Date(after.rows[0].updated_at) > new Date(before.rows[0].updated_at));
});

test("deleting the auth.users row cascades to delete the profile", async () => {
  await adminClient.query("delete from auth.users where id = $1", [userA]);
  const result = await adminClient.query("select id from public.profiles where id = $1", [userA]);
  assert.equal(result.rows.length, 0);
});

// public.orders — deliberately has NO permissive RLS policy for any
// role (see the comment above the table in schema.sql). These tests
// prove that posture holds for real: an authenticated user, an anon
// (unauthenticated) request, AND a signed-in user trying to read
// someone else's order must all see zero rows / be blocked, DESPITE the
// table-level GRANT each of those roles has (see the before() hook) —
// RLS itself, not the absence of a grant, is what's stopping them.
// service_role is the sole exception, via BYPASSRLS, matching exactly
// how stripe-webhook/index.ts is authorized to write orders.

function sampleOrder(overrides) {
  return Object.assign({
    stripe_session_id: `cs_test_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    stripe_payment_intent_id: "pi_test_123",
    customer_email: "shopper@example.com",
    amount_total_cents: 145_000,
    currency: "usd",
    line_items: JSON.stringify([{ id: "men-01", qty: 1 }]),
    shipping_address: JSON.stringify({ country: "US" }),
    status: "paid"
  }, overrides);
}

test("service_role can insert an order (models the webhook's actual write path)", async () => {
  const order = sampleOrder();
  await asServiceRole((client) =>
    client.query(
      `insert into public.orders
        (stripe_session_id, stripe_payment_intent_id, customer_email, amount_total_cents, currency, line_items, shipping_address, status)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [order.stripe_session_id, order.stripe_payment_intent_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.shipping_address, order.status]
    )
  );
  const result = await adminClient.query("select id from public.orders where stripe_session_id = $1", [order.stripe_session_id]);
  assert.equal(result.rows.length, 1);
});

test("service_role upsert on stripe_session_id is idempotent (models Stripe's at-least-once webhook redelivery)", async () => {
  const order = sampleOrder();
  const insertSql = `insert into public.orders
      (stripe_session_id, stripe_payment_intent_id, customer_email, amount_total_cents, currency, line_items, shipping_address, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (stripe_session_id) do update set status = excluded.status`;
  const args = [order.stripe_session_id, order.stripe_payment_intent_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.shipping_address, order.status];

  await asServiceRole((client) => client.query(insertSql, args));
  // Redelivery: same session id, arrives a second time.
  await asServiceRole((client) => client.query(insertSql, args));

  const result = await adminClient.query("select count(*) from public.orders where stripe_session_id = $1", [order.stripe_session_id]);
  assert.equal(Number(result.rows[0].count), 1, "redelivery must not create a duplicate row");
});

test("an authenticated user cannot select ANY row from orders, including one tied to their own email", async () => {
  const order = sampleOrder({ customer_email: "user-a-owns-this@example.com" });
  await adminClient.query(
    `insert into public.orders (stripe_session_id, customer_email, amount_total_cents, currency, line_items, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [order.stripe_session_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.status]
  );
  const result = await asUser(userA, (client) =>
    client.query("select id from public.orders where stripe_session_id = $1", [order.stripe_session_id])
  );
  assert.equal(result.rows.length, 0, "orders has no policy that would ever let an authenticated user see this row");
});

test("an anon (unauthenticated) request cannot select any row from orders", async () => {
  const order = sampleOrder();
  await adminClient.query(
    `insert into public.orders (stripe_session_id, customer_email, amount_total_cents, currency, line_items, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [order.stripe_session_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.status]
  );
  const result = await asAnon((client) =>
    client.query("select id from public.orders where stripe_session_id = $1", [order.stripe_session_id])
  );
  assert.equal(result.rows.length, 0);
});

test("an authenticated user cannot insert a fake order for themselves (RLS default-denies, not just the absent policy)", async () => {
  const order = sampleOrder();
  await assert.rejects(
    () => asUser(userA, (client) =>
      client.query(
        `insert into public.orders (stripe_session_id, customer_email, amount_total_cents, currency, line_items, status)
         values ($1, $2, $3, $4, $5, $6)`,
        [order.stripe_session_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.status]
      )
    ),
    /row-level security/i
  );
  const result = await adminClient.query("select id from public.orders where stripe_session_id = $1", [order.stripe_session_id]);
  assert.equal(result.rows.length, 0, "the forged order must not have been created");
});

test("an authenticated user cannot update another order's status (e.g. to fake a refund or mark it shipped)", async () => {
  const order = sampleOrder({ status: "paid" });
  await adminClient.query(
    `insert into public.orders (stripe_session_id, customer_email, amount_total_cents, currency, line_items, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [order.stripe_session_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.status]
  );
  const updateResult = await asUser(userA, (client) =>
    client.query("update public.orders set status = 'refunded' where stripe_session_id = $1", [order.stripe_session_id])
  );
  assert.equal(updateResult.rowCount, 0, "no policy means zero rows matched, not an error, but the update must be a no-op");
  const after = await adminClient.query("select status from public.orders where stripe_session_id = $1", [order.stripe_session_id]);
  assert.equal(after.rows[0].status, "paid");
});

test("an authenticated user cannot delete an order", async () => {
  const order = sampleOrder();
  await adminClient.query(
    `insert into public.orders (stripe_session_id, customer_email, amount_total_cents, currency, line_items, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [order.stripe_session_id, order.customer_email, order.amount_total_cents, order.currency, order.line_items, order.status]
  );
  const deleteResult = await asUser(userA, (client) =>
    client.query("delete from public.orders where stripe_session_id = $1", [order.stripe_session_id])
  );
  assert.equal(deleteResult.rowCount, 0);
  const result = await adminClient.query("select id from public.orders where stripe_session_id = $1", [order.stripe_session_id]);
  assert.equal(result.rows.length, 1, "the order must still exist");
});
