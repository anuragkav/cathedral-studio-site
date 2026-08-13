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
