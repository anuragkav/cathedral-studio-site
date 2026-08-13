const { test, expect } = require("@playwright/test");
const path = require("node:path");

const MOCK_SCRIPT = path.join(__dirname, "support", "mockSupabase.js");

test.beforeEach(async ({ page }) => {
  // Stub out the real CDN script entirely — otherwise it loads after our
  // mock and overwrites window.supabase with the real createClient.
  await page.route("**/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" })
  );
  // auth.js's assertConfigured() rejects the repo's real config.js, which
  // ships with placeholder values until a real Supabase project is wired
  // up. Route around it with non-placeholder values so these tests
  // exercise the actual auth flow instead of universally hitting that
  // "not configured" gate — an addInitScript couldn't do this, since
  // config.js's own unconditional assignment would run after it and win.
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.CATHEDRAL_CONFIG = { SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_ANON_KEY: "test-anon-key" };`
    })
  );
  await page.addInitScript({ path: MOCK_SCRIPT });
});

test("shows sign-in panel by default when signed out", async ({ page }) => {
  await page.goto("/account.html");
  await expect(page.locator("#panel-signin")).toBeVisible();
  await expect(page.locator("#panel-account")).toBeHidden();
});

test("sign up happy path shows confirmation copy, no session yet", async ({ page }) => {
  await page.goto("/account.html");
  await page.click('[data-panel="signup"]');
  await page.fill("#signup-email", "new.user@example.com");
  await page.fill("#signup-password", "correct-horse-battery");
  await page.click('#signup-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="signup"]')).toHaveText(/check your email/i);
  await expect(page.locator("#panel-account")).toBeHidden();
});

test("sign up rejects a password under the minimum length client-side, no network call", async ({ page }) => {
  await page.goto("/account.html");
  await page.click('[data-panel="signup"]');
  await page.fill("#signup-email", "shortpw@example.com");
  await page.fill("#signup-password", "short1");
  await page.click('#signup-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="signup"]')).toHaveText(/at least 12 characters/i);
});

test("duplicate signup shows the same confirmation copy as a fresh signup (no account enumeration)", async ({ page }) => {
  await page.addInitScript(() => {
    window.__seedEmail = "dup@example.com";
  });
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("dup@example.com", "already-registered-1");
  });
  await page.click('[data-panel="signup"]');
  await page.fill("#signup-email", "dup@example.com");
  await page.fill("#signup-password", "another-password-12");
  await page.click('#signup-form button[type="submit"]');
  // auth.js deliberately swallows "already registered" so this screen can't
  // be used to enumerate accounts — a duplicate signup must look identical
  // to a fresh one, not reveal that the address is already taken.
  await expect(page.locator('.account-msg[data-for="signup"]')).toHaveText(/check your email/i);
});

test("duplicate signup against a CONFIRMED account (real Supabase's no-error, empty-identities shape) still shows the same copy", async ({ page }) => {
  // Regression coverage for a real Supabase-js gotcha: for an
  // already-confirmed email, real Supabase returns no `error` at all —
  // just data.user.identities: []. A mock that only ever simulated the
  // "error: {message: 'already registered'}" shape would let auth.js's
  // handling of this second shape go completely untested.
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("confirmed-dup@example.com", "already-registered-1");
  });
  await page.click('[data-panel="signup"]');
  await page.fill("#signup-email", "confirmed-dup@example.com");
  await page.fill("#signup-password", "another-password-12");
  await page.click('#signup-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="signup"]')).toHaveText(/check your email/i);
});

test("login with wrong password shows a generic error", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("known@example.com", "the-real-password-1");
  });
  await page.fill("#signin-email", "known@example.com");
  await page.fill("#signin-password", "totally-wrong-password");
  await page.click('#signin-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="signin"]')).toHaveText(/didn't work/i);
});

test("login with an unregistered email shows the same generic error (no user enumeration)", async ({ page }) => {
  await page.goto("/account.html");
  await page.fill("#signin-email", "nobody-registered@example.com");
  await page.fill("#signin-password", "whatever-password-1");
  await page.click('#signin-form button[type="submit"]');
  const unregisteredText = await page.locator('.account-msg[data-for="signin"]').textContent();

  await page.reload();
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("registered@example.com", "the-real-password-1");
  });
  await page.fill("#signin-email", "registered@example.com");
  await page.fill("#signin-password", "wrong-password-here");
  await page.click('#signin-form button[type="submit"]');
  const wrongPasswordText = await page.locator('.account-msg[data-for="signin"]').textContent();

  expect(unregisteredText).toBe(wrongPasswordText);
});

test("forgot-password flow shows identical message regardless of whether the email exists", async ({ page }) => {
  await page.goto("/account.html");
  await page.click('[data-panel="forgot"]');
  await page.fill("#forgot-email", "unknown@example.com");
  await page.click('#forgot-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="forgot"]')).toHaveText(/on its way/i);

  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("known2@example.com", "some-password-123");
  });
  await page.fill("#forgot-email", "known2@example.com");
  await page.click('#forgot-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="forgot"]')).toHaveText(/on its way/i);
});

test("successful login reaches the account panel and shows the user's email", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("session-user@example.com", "the-real-password-1");
  });
  await page.fill("#signin-email", "session-user@example.com");
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  await expect(page.locator("#panel-account")).toBeVisible();
  await expect(page.locator("#account-email")).toHaveText("session-user@example.com");
});

test("session persists across a page reload", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("reload-user@example.com", "the-real-password-1");
    window.supabase.createClient().auth.__setSessionForTest("reload-user@example.com");
  });
  await page.reload();
  await expect(page.locator("#panel-account")).toBeVisible();
});

test("signing out clears the session and returns to the sign-in panel", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("signout-user@example.com", "the-real-password-1");
    window.supabase.createClient().auth.__setSessionForTest("signout-user@example.com");
  });
  await page.reload();
  await expect(page.locator("#panel-account")).toBeVisible();
  await page.click("#signout-btn");
  await expect(page.locator("#panel-signin")).toBeVisible();
});

test("a script-tag payload in the display name is rendered as literal text, not executed", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("xss-user@example.com", "the-real-password-1");
    window.supabase.createClient().auth.__setSessionForTest("xss-user@example.com");
  });
  await page.reload();

  let dialogFired = false;
  page.once("dialog", () => {
    dialogFired = true;
  });

  const payload = '<img src=x onerror="window.__xss=true">';
  await page.fill("#display-name", payload);
  await page.click('#name-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="name"]')).toHaveText(/saved/i);

  await page.reload();
  expect(await page.locator("#display-name").inputValue()).toBe(payload);
  expect(dialogFired).toBe(false);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test("login with an unconfirmed account shows a specific message and reveals the resend button", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedUnconfirmedUser("unconfirmed@example.com", "the-real-password-1");
  });
  await expect(page.locator("#resend-confirmation-btn")).toBeHidden();
  await page.fill("#signin-email", "unconfirmed@example.com");
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="signin"]')).toHaveText(/confirm your email/i);
  await expect(page.locator("#resend-confirmation-btn")).toBeVisible();
  await expect(page.locator("#panel-account")).toBeHidden();
});

test("a confirmed account's correct-password login never reveals the resend button", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("confirmed@example.com", "the-real-password-1");
  });
  await page.fill("#signin-email", "confirmed@example.com");
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  await expect(page.locator("#panel-account")).toBeVisible();
  await expect(page.locator("#resend-confirmation-btn")).toBeHidden();
});

test("clicking resend shows the same generic copy whether or not the resend call succeeds", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedUnconfirmedUser("resend-me@example.com", "the-real-password-1");
  });
  await page.fill("#signin-email", "resend-me@example.com");
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  await expect(page.locator("#resend-confirmation-btn")).toBeVisible();

  await page.click("#resend-confirmation-btn");
  await expect(page.locator('.account-msg[data-for="signin"]')).toHaveText(/on its way/i);
  // The button stays visible but goes into a countdown cooldown so it
  // can't be mashed to fire repeated resend requests for the same address
  // — the label reflects the remaining seconds, and the button is disabled.
  await expect(page.locator("#resend-confirmation-btn")).toBeDisabled();
  await expect(page.locator("#resend-confirmation-btn")).toHaveText(/\d+s/);
});

test("clicking resend never throws even if the underlying resend call rejects", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedUnconfirmedUser("resend-fail@example.com", "the-real-password-1");
    const client = window.supabase.createClient();
    client.auth.resend = async () => {
      throw new Error("simulated network failure");
    };
  });
  await page.fill("#signin-email", "resend-fail@example.com");
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  await page.click("#resend-confirmation-btn");
  // Even a hard failure must still land on the same generic copy — a
  // distinct message here would leak whether the address exists.
  await expect(page.locator('.account-msg[data-for="signin"]')).toHaveText(/on its way/i);
});

test("a password-recovery session lands on the update-password panel, not the account panel", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("recovery-user@example.com", "old-password-123");
    window.supabase.createClient().auth.__triggerPasswordRecoveryForTest("recovery-user@example.com");
  });
  await expect(page.locator("#panel-update-password")).toBeVisible();
  await expect(page.locator("#panel-account")).toBeHidden();
});

test("completing the update-password form from a recovery session then lands on the account panel", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("recovery-done@example.com", "old-password-123");
    window.supabase.createClient().auth.__triggerPasswordRecoveryForTest("recovery-done@example.com");
  });
  await expect(page.locator("#panel-update-password")).toBeVisible();
  await page.fill("#update-password", "brand-new-password-1");
  await page.click('#update-password-form button[type="submit"]');
  await expect(page.locator('.account-msg[data-for="update-password"]')).toHaveText(/updated/i);
});

test("a normal sign-in after a recovery session does not stay pinned to the update-password panel", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    window.supabase.createClient().auth.__seedConfirmedUser("normal-after-recovery@example.com", "the-real-password-1");
    window.supabase.createClient().auth.__triggerPasswordRecoveryForTest("normal-after-recovery@example.com");
  });
  await expect(page.locator("#panel-update-password")).toBeVisible();
  await page.evaluate(() => {
    window.supabase.createClient().auth.signOut();
  });
  await expect(page.locator("#panel-signin")).toBeVisible();
  await page.fill("#signin-email", "normal-after-recovery@example.com");
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  // A fresh SIGNED_IN event must clear the earlier recovery flag — this
  // login must reach the account panel, not get re-pinned to update-password.
  await expect(page.locator("#panel-account")).toBeVisible();
});

test("forgot-password button enters a visible cooldown countdown after use", async ({ page }) => {
  await page.goto("/account.html");
  await page.click('[data-panel="forgot"]');
  await page.fill("#forgot-email", "cooldown@example.com");
  const button = page.locator('#forgot-form button[type="submit"]');
  await button.click();
  await expect(page.locator('.account-msg[data-for="forgot"]')).toHaveText(/on its way/i);
  // Post-click the button must land in cooldown, not fresh — a bot mashing
  // this endpoint via the UI would otherwise fire up to $networkRTT reqs/sec.
  await expect(button).toBeDisabled();
  await expect(button).toHaveText(/\d+s/);
});

test("forgot-password cooldown survives a reload (sessionStorage-backed)", async ({ page }) => {
  await page.goto("/account.html");
  await page.click('[data-panel="forgot"]');
  await page.fill("#forgot-email", "cooldown-persist@example.com");
  await page.click('#forgot-form button[type="submit"]');
  await page.reload();
  await page.click('[data-panel="forgot"]');
  const button = page.locator('#forgot-form button[type="submit"]');
  await expect(button).toBeDisabled();
  await expect(button).toHaveText(/\d+s/);
});

test("submit button is disabled while a request is in flight, preventing duplicate submits", async ({ page }) => {
  await page.goto("/account.html");
  await page.evaluate(() => {
    const client = window.supabase.createClient();
    const original = client.auth.signInWithPassword.bind(client.auth);
    client.auth.signInWithPassword = async (...args) => {
      await new Promise((r) => setTimeout(r, 300));
      return original(...args);
    };
    window.__client = client;
  });
  await page.fill("#signin-email", "someone@example.com");
  await page.fill("#signin-password", "whatever-password-1");
  const button = page.locator('#signin-form button[type="submit"]');
  await button.click();
  await expect(button).toBeDisabled();
});
