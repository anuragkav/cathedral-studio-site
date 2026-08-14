const { test, expect } = require("@playwright/test");

// nav.js/style.css collapse .nav-links behind a hamburger below 860px.
// These tests pin an explicit viewport rather than relying on a project's
// default, so the assertions mean the same thing regardless of which
// Playwright project runs them.
const MOBILE_VIEWPORT = { width: 375, height: 800 };
const NARROW_VIEWPORT = { width: 320, height: 800 };

test("hamburger toggle opens and closes the mobile nav, flipping aria-expanded", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  const toggle = page.locator(".nav-toggle");
  const men = page.locator("#nav-links a", { hasText: /^Men$/ });

  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(men).toBeHidden();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".nav")).toHaveClass(/nav-open/);
  await expect(men).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".nav")).not.toHaveClass(/nav-open/);
  await expect(men).toBeHidden();
});

test("clicking a link inside the open mobile nav closes it", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  await page.locator(".nav-toggle").click();
  await page.locator("#nav-links a", { hasText: /^Men$/ }).click();

  await expect(page.locator(".nav")).not.toHaveClass(/nav-open/);
  await expect(page.locator(".nav-toggle")).toHaveAttribute("aria-expanded", "false");
});

test("clicking non-link whitespace inside the open nav does not close it", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  await page.locator(".nav-toggle").click();

  // Dispatched directly on the container (not on an <a>) so this exercises
  // nav.js's `e.target.closest("a")` guard rather than accidentally
  // landing on a link via click-position flakiness.
  await page.locator("#nav-links").evaluate((el) =>
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  );

  await expect(page.locator(".nav")).toHaveClass(/nav-open/);
});

test("Escape closes the mobile nav and returns focus to the toggle when focus is inside it", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  await page.locator(".nav-toggle").click();
  await page.locator("#nav-links a", { hasText: /^Men$/ }).focus();

  await page.keyboard.press("Escape");

  await expect(page.locator(".nav")).not.toHaveClass(/nav-open/);
  await expect(page.locator(".nav-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator(".nav-toggle")).toBeFocused();
});

test("Escape does not close the nav or steal focus when focus is elsewhere on the page", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  await page.locator(".nav-toggle").click();
  await page.locator("#email").focus();

  await page.keyboard.press("Escape");

  await expect(page.locator(".nav")).toHaveClass(/nav-open/);
  await expect(page.locator("#email")).toBeFocused();
});

test("cart link and badge stay visible while the rest of the mobile menu is collapsed", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");

  await expect(page.locator(".nav-cart")).toBeVisible();
  await expect(page.locator("#nav-links a", { hasText: /^Women$/ })).toBeHidden();

  await page.locator('[data-action="add-to-cart"]').first().click();
  await expect(page.locator("#cart-badge")).toBeVisible();
  await expect(page.locator("#cart-badge")).toHaveText("1");
});

test("keyboard activation: a focused toggle responds to Enter", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  await page.locator(".nav-toggle").focus();

  await page.keyboard.press("Enter");
  await expect(page.locator(".nav")).toHaveClass(/nav-open/);

  await page.keyboard.press("Enter");
  await expect(page.locator(".nav")).not.toHaveClass(/nav-open/);
});

test("Tab from the wordmark reaches the toggle next (native button stays in tab order)", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/index.html");
  await page.locator(".nav-mark").focus();

  await page.keyboard.press("Tab");

  await expect(page.locator(".nav-toggle")).toBeFocused();
});

test("waitlist email input has an accessible label, not just a placeholder", async ({ page }) => {
  await page.goto("/index.html");

  await expect(page.locator('label[for="email"]')).toHaveText("Email");
  await expect(page.locator("#email")).toHaveAccessibleName("Email");
});

for (const url of ["/checkout.html", "/account.html"]) {
  test(`hamburger toggle works on ${url} too`, async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(url);
    const toggle = page.locator(".nav-toggle");
    const firstLink = page.locator("#nav-links a").first();

    await expect(firstLink).toBeHidden();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(firstLink).toBeVisible();
  });
}

test("no JS: nav-toggle stays hidden and every link stays visible/reachable", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: MOBILE_VIEWPORT });
  const page = await context.newPage();
  await page.goto("/index.html");

  await expect(page.locator(".nav-toggle")).toBeHidden();
  await expect(page.locator("#nav-links a", { hasText: /^Women$/ })).toBeVisible();

  await context.close();
});

test("no horizontal overflow on the front page at 320px (footer links wrap; waitlist form stacks)", async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto("/index.html");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
});

test("waitlist form stacks input above button under 400px instead of overflowing", async ({ page }) => {
  await page.setViewportSize(NARROW_VIEWPORT);
  await page.goto("/index.html");

  const emailBox = await page.locator("#email").boundingBox();
  const buttonBox = await page.locator('#waitlist-form button[type="submit"]').boundingBox();
  expect(buttonBox.y).toBeGreaterThanOrEqual(emailBox.y + emailBox.height);
});

test("a long account email wraps instead of overflowing the page at 320px", async ({ page }) => {
  await page.route("**/supabase-js@2", (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" })
  );
  await page.route("**/config.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.CATHEDRAL_CONFIG = { SUPABASE_URL: "https://test-project.supabase.co", SUPABASE_ANON_KEY: "test-anon-key" };`
    })
  );
  await page.addInitScript({ path: require("node:path").join(__dirname, "support", "mockSupabase.js") });
  await page.setViewportSize(NARROW_VIEWPORT);

  const longEmail = "a.very.long.email.address.for.testing.overflow@some-long-subdomain.example.com";
  await page.goto("/account.html");
  await page.evaluate((email) => {
    window.supabase.createClient().auth.__seedConfirmedUser(email, "the-real-password-1");
  }, longEmail);
  await page.fill("#signin-email", longEmail);
  await page.fill("#signin-password", "the-real-password-1");
  await page.click('#signin-form button[type="submit"]');
  await expect(page.locator("#account-email")).toHaveText(longEmail);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
});

test("quantity +/- buttons meet a 40px minimum touch target on mobile", async ({ page }) => {
  const STORAGE_KEY = "cathedral_cart_v1";
  await page.addInitScript(
    ({ key, cart }) => window.localStorage.setItem(key, JSON.stringify(cart)),
    { key: STORAGE_KEY, cart: { items: [{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }] } }
  );
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.goto("/checkout.html");

  const box = await page.locator('.qty-btn[data-action="increase"]').first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);
});
