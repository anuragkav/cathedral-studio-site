const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "cathedral_cart_v1";
const STRIPE_TEST_URL = "https://checkout.stripe.com/pay/cs_test_abc123";

// addInitScript persists for the page's whole lifetime and re-runs on
// every navigation, including page.reload() — so a plain "always seed"
// script would silently resurrect a cart the app just cleared. A separate
// marker key (untouched by the app, which only ever touches STORAGE_KEY)
// makes the seed one-shot: present only on the very first load.
function seedCart(items) {
  const seededMarkerKey = STORAGE_KEY + "__test_seeded";
  return async (page) => {
    await page.addInitScript(
      ({ key, markerKey, cart }) => {
        if (window.localStorage.getItem(markerKey)) return;
        window.localStorage.setItem(key, JSON.stringify(cart));
        window.localStorage.setItem(markerKey, "1");
      },
      { key: STORAGE_KEY, markerKey: seededMarkerKey, cart: { items } }
    );
  };
}

// Must match the CSP `connect-src ... https://*.supabase.co` allowlist on
// checkout.html — a non-supabase.co hostname would trip CSP and the fetch
// would never reach Playwright's route handler.
const FAKE_ENDPOINT = "https://fake-project.supabase.co/functions/v1/create-checkout-session";

async function stubCheckoutEndpoint(page, handler) {
  await page.addInitScript((endpoint) => {
    // addInitScript runs BEFORE the page's own <script> tags — including
    // config.js, whose top-level `window.CATHEDRAL_CONFIG = {...}` would
    // otherwise overwrite anything set here. Install a getter that always
    // merges CHECKOUT_ENDPOINT on top of whatever config.js later assigns.
    let stored = {};
    Object.defineProperty(window, "CATHEDRAL_CONFIG", {
      get() { return Object.assign({}, stored, { CHECKOUT_ENDPOINT: endpoint }); },
      set(v) { stored = v || {}; },
      configurable: true
    });
  }, FAKE_ENDPOINT);
  await page.route(FAKE_ENDPOINT, async (route) => {
    const request = route.request();
    const payload = request.postDataJSON ? request.postDataJSON() : JSON.parse(request.postData() || "{}");
    await handler(route, payload);
  });
}

test("checkout page shows the empty state when the cart has no items", async ({ page }) => {
  await page.goto("/checkout.html");
  await expect(page.locator("#cart-empty")).toBeVisible();
  await expect(page.locator("#cart-content")).toBeHidden();
});

test("checkout page renders seeded cart lines and a correct summary", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await expect(page.locator("#cart-content")).toBeVisible();
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator("#summary-subtotal")).toHaveText("$1,450.00");
  await expect(page.locator("#summary-shipping")).toHaveText("Free");
  await expect(page.locator("#summary-total")).toHaveText("$1,450.00");
});

test("checkout applies flat shipping under the free-shipping threshold", async ({ page }) => {
  await (await seedCart([{ id: "men-13", name: "Narthex Tee", price: 135, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await expect(page.locator("#summary-shipping")).toHaveText("$15.00");
  await expect(page.locator("#summary-total")).toHaveText("$150.00");
});

test("increasing quantity via the + button updates the line total and summary", async ({ page }) => {
  await (await seedCart([{ id: "men-13", name: "Narthex Tee", price: 135, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.click('[data-action="increase"][data-id="men-13"]');
  await expect(page.locator('.cart-line[data-id="men-13"] .qty-input')).toHaveValue("2");
  await expect(page.locator('.cart-line[data-id="men-13"] .cart-line-total')).toHaveText("$270.00");
  await expect(page.locator("#summary-subtotal")).toHaveText("$270.00");
});

test("decreasing quantity to zero removes the line and shows the empty state", async ({ page }) => {
  await (await seedCart([{ id: "men-13", name: "Narthex Tee", price: 135, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.click('[data-action="decrease"][data-id="men-13"]');
  await expect(page.locator("#cart-empty")).toBeVisible();
  await expect(page.locator("#cart-content")).toBeHidden();
});

test("typing a quantity directly updates the summary and clamps at the per-line maximum", async ({ page }) => {
  await (await seedCart([{ id: "men-13", name: "Narthex Tee", price: 135, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  const qtyInput = page.locator('.cart-line[data-id="men-13"] .qty-input');
  await qtyInput.fill("999");
  await qtyInput.dispatchEvent("change");
  await expect(qtyInput).toHaveValue("10");
  await expect(page.locator("#summary-subtotal")).toHaveText("$1,350.00");
});

test("clicking Remove drops the line entirely", async ({ page }) => {
  await (await seedCart([
    { id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 },
    { id: "men-13", name: "Narthex Tee", price: 135, qty: 1 }
  ]))(page);
  await page.goto("/checkout.html");
  await page.click('[data-action="remove"][data-id="men-13"]');
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator("#summary-subtotal")).toHaveText("$1,450.00");
});

test("removing the only line falls back to the empty state", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.click('[data-action="remove"][data-id="men-01"]');
  await expect(page.locator("#cart-empty")).toBeVisible();
});

test("proceed-to-payment sends only id, qty, and a checkout_token to the endpoint, never the price", async ({ page }) => {
  await (await seedCart([
    { id: "men-01", name: "Nave Overcoat", price: 1450, qty: 2, cat: "Outerwear", fabric: "Doubleface wool" }
  ]))(page);
  let capturedPayload = null;
  await stubCheckoutEndpoint(page, async (route, payload) => {
    capturedPayload = payload;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: STRIPE_TEST_URL })
    });
  });
  await page.goto("/checkout.html");
  await page.route(STRIPE_TEST_URL, (route) => route.fulfill({ status: 200, body: "stripe stub" }));
  await page.click("#checkout-submit");
  await page.waitForURL(STRIPE_TEST_URL);
  expect(capturedPayload.items).toEqual([{ id: "men-01", qty: 2 }]);
  expect(typeof capturedPayload.checkout_token).toBe("string");
  expect(capturedPayload.checkout_token.length).toBeGreaterThanOrEqual(16);
  expect(capturedPayload.items[0]).not.toHaveProperty("price");
  expect(capturedPayload.items[0]).not.toHaveProperty("name");
  expect(capturedPayload.items[0]).not.toHaveProperty("fabric");
});

test("a retried proceed-to-payment reuses the same checkout_token for idempotency", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  const tokens = [];
  await stubCheckoutEndpoint(page, async (route, payload) => {
    tokens.push(payload.checkout_token);
    if (tokens.length === 1) {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
    } else {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: STRIPE_TEST_URL }) });
    }
  });
  await page.route(STRIPE_TEST_URL, (route) => route.fulfill({ status: 200, body: "stripe stub" }));
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-error")).toBeVisible();
  await expect(page.locator("#checkout-submit")).toBeEnabled();
  await page.click("#checkout-submit");
  await page.waitForURL(STRIPE_TEST_URL);
  expect(tokens).toHaveLength(2);
  expect(tokens[0]).toBe(tokens[1]);
});

test("proceed-to-payment redirects the browser to the Stripe URL returned by the endpoint", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await stubCheckoutEndpoint(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: STRIPE_TEST_URL })
    });
  });
  await page.route(STRIPE_TEST_URL, (route) => route.fulfill({ status: 200, body: "stripe stub" }));
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await page.waitForURL(STRIPE_TEST_URL);
  expect(page.url()).toBe(STRIPE_TEST_URL);
});

test("a non-stripe URL returned by the endpoint is refused instead of redirecting", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await stubCheckoutEndpoint(page, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ url: "https://evil.example.com/phish" })
    });
  });
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-error")).toBeVisible();
  await expect(page.locator("#checkout-error")).toContainText(/checkout url/i);
  expect(page.url()).toContain("/checkout.html");
});

test("an endpoint error surfaces the error message and re-enables the button", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await stubCheckoutEndpoint(page, async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: "Cart is empty." })
    });
  });
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-error")).toContainText("Cart is empty.");
  await expect(page.locator("#checkout-submit")).toBeEnabled();
});

test("a network failure surfaces a network error and re-enables the button", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await stubCheckoutEndpoint(page, async (route) => {
    await route.abort("failed");
  });
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-error")).toContainText(/network error/i);
  await expect(page.locator("#checkout-submit")).toBeEnabled();
});

test("a fake ?checkout=success link WITHOUT a matching token does NOT clear the cart or show confirmation", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html?checkout=success&session_id=cs_test_xyz&token=attacker-crafted-token");
  await expect(page.locator("#cart-content")).toBeVisible();
  await expect(page.locator("#checkout-confirmation")).toBeHidden();
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(storage).not.toBeNull();
});

test("a ?checkout=success return WITH the matching token clears the cart and shows confirmation", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  let capturedToken = null;
  await stubCheckoutEndpoint(page, async (route, payload) => {
    capturedToken = payload.checkout_token;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: STRIPE_TEST_URL }) });
  });
  await page.route(STRIPE_TEST_URL, (route) => route.fulfill({ status: 200, body: "stripe stub" }));
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await page.waitForURL(STRIPE_TEST_URL);
  expect(capturedToken).toBeTruthy();
  await page.goto(`/checkout.html?checkout=success&session_id=cs_test_xyz&token=${encodeURIComponent(capturedToken)}`);
  await expect(page.locator("#checkout-confirmation")).toBeVisible();
  await expect(page.locator("#cart-content")).toBeHidden();
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(storage).toBeNull();
  const remainingToken = await page.evaluate(() => window.sessionStorage.getItem("cathedral_checkout_token_v1"));
  expect(remainingToken).toBeNull();
});

test("returning with ?checkout=cancelled AND the matching token shows the cancellation panel without clearing the cart", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  let capturedToken = null;
  await stubCheckoutEndpoint(page, async (route, payload) => {
    capturedToken = payload.checkout_token;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: STRIPE_TEST_URL }) });
  });
  await page.route(STRIPE_TEST_URL, (route) => route.fulfill({ status: 200, body: "stripe stub" }));
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await page.waitForURL(STRIPE_TEST_URL);
  expect(capturedToken).toBeTruthy();
  await page.goto(`/checkout.html?checkout=cancelled&token=${encodeURIComponent(capturedToken)}`);
  await expect(page.locator("#checkout-cancelled")).toBeVisible();
  await expect(page.locator("#cart-content")).toBeHidden();
  const storage = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  expect(storage).not.toBeNull();
  const parsed = JSON.parse(storage);
  expect(parsed.items).toHaveLength(1);
});

test("the disclosure banner no longer claims payment is a preview", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await expect(page.locator(".checkout-disclosure")).toContainText(/stripe/i);
  const submitText = (await page.locator("#checkout-submit").textContent()).toLowerCase();
  expect(submitText).toMatch(/proceed to payment/);
});

test("adding an item from the collection grid on the front page carries through to checkout", async ({ page }) => {
  await page.goto("/index.html");
  const firstAddButton = page.locator('[data-action="add-to-cart"]').first();
  const id = await firstAddButton.getAttribute("data-id");
  await firstAddButton.click();
  await page.goto("/checkout.html");
  await expect(page.locator(`.cart-line[data-id="${id}"]`)).toBeVisible();
});

test("adding the same item twice from the front page increments quantity rather than duplicating the line", async ({ page }) => {
  await page.goto("/index.html");
  const firstAddButton = page.locator('[data-action="add-to-cart"]').first();
  const id = await firstAddButton.getAttribute("data-id");
  await firstAddButton.click();
  await page.waitForTimeout(50);
  await page.reload();
  await page.locator(`[data-action="add-to-cart"][data-id="${id}"]`).click();
  await page.goto("/checkout.html");
  await expect(page.locator(`.cart-line[data-id="${id}"]`)).toHaveCount(1);
  await expect(page.locator(`.cart-line[data-id="${id}"] .qty-input`)).toHaveValue("2");
});

test("cart badge in the nav reflects item count after adding from the front page", async ({ page }) => {
  await page.goto("/index.html");
  await expect(page.locator("#cart-badge")).toBeHidden();
  await page.locator('[data-action="add-to-cart"]').first().click();
  await expect(page.locator("#cart-badge")).toBeVisible();
  await expect(page.locator("#cart-badge")).toHaveText("1");
});

test("a script-tag payload seeded into a cart line name is rendered as literal text, not executed", async ({ page }) => {
  await (await seedCart([{ id: "xss-1", name: '<img src=x onerror="window.__xss=true">', price: 50, qty: 1 }]))(page);
  let dialogFired = false;
  page.once("dialog", () => {
    dialogFired = true;
  });
  await page.goto("/checkout.html");
  await expect(page.locator(".cart-line-name")).toHaveText('<img src=x onerror="window.__xss=true">');
  expect(dialogFired).toBe(false);
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test("a crafted item id containing an attribute-breakout payload cannot execute script", async ({ page }) => {
  const payload = '1"><img src=x onerror="window.__xssViaId=true">';
  await (await seedCart([{ id: payload, name: "Shirt", price: 100, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__xssViaId)).toBeUndefined();
  await expect(page.locator(".cart-line")).toHaveCount(1);
});

test("a crafted item name containing an attribute-breakout payload cannot execute script via the qty input's aria-label", async ({ page }) => {
  const payload = 'y"><img src=x onerror="window.__xssViaName=true">';
  await (await seedCart([{ id: "safe-id", name: payload, price: 50, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__xssViaName)).toBeUndefined();
  await expect(page.locator(".cart-line-name")).toHaveText(payload);
});

test("blanking the quantity input and blurring resets to the last saved quantity instead of deleting the line", async ({ page }) => {
  await (await seedCart([{ id: "men-13", name: "Narthex Tee", price: 135, qty: 3 }]))(page);
  await page.goto("/checkout.html");
  const qtyInput = page.locator('.cart-line[data-id="men-13"] .qty-input');
  await qtyInput.fill("");
  await qtyInput.dispatchEvent("change");
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator('.cart-line[data-id="men-13"] .qty-input')).toHaveValue("3");
});

test("typing a sub-1 quantity resets to the last saved quantity instead of deleting the line", async ({ page }) => {
  await (await seedCart([{ id: "men-13", name: "Narthex Tee", price: 135, qty: 2 }]))(page);
  await page.goto("/checkout.html");
  const qtyInput = page.locator('.cart-line[data-id="men-13"] .qty-input');
  await qtyInput.fill("0");
  await qtyInput.dispatchEvent("change");
  await expect(page.locator(".cart-line")).toHaveCount(1);
  await expect(page.locator('.cart-line[data-id="men-13"] .qty-input')).toHaveValue("2");
});

test("adding an item already at the per-line quantity cap shows distinct feedback instead of claiming success", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 10 }]))(page);
  await page.goto("/index.html");
  const button = page.locator('[data-action="add-to-cart"][data-id="men-01"]');
  await button.click();
  await expect(button).toHaveText(/limit reached/i);
});

test("each cart line's decrease/increase/remove controls have a distinct, item-specific accessible name", async ({ page }) => {
  await (await seedCart([
    { id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 },
    { id: "men-13", name: "Narthex Tee", price: 135, qty: 1 }
  ]))(page);
  await page.goto("/checkout.html");
  const removeOvercoat = page.locator('.cart-line[data-id="men-01"] [data-action="remove"]');
  const removeTee = page.locator('.cart-line[data-id="men-13"] [data-action="remove"]');
  await expect(removeOvercoat).toHaveAttribute("aria-label", /Nave Overcoat/);
  await expect(removeTee).toHaveAttribute("aria-label", /Narthex Tee/);
});

test("a quantity change that exceeds localStorage quota shows a visible error instead of failing silently", async ({ page }) => {
  await page.goto("/checkout.html");
  await page.evaluate(() => {
    function cartJSON(n) {
      const items = [];
      for (let i = 0; i < n; i++) {
        items.push({ id: "pad-" + i, name: "Padding Item " + i, price: 10, qty: 1, cat: "Outerwear", fabric: "Wool" });
      }
      return JSON.stringify({ items });
    }
    localStorage.clear();
    let lo = 0, hi = 200000;
    while (lo < hi) {
      const mid = Math.floor((lo + hi + 1) / 2);
      try {
        localStorage.setItem("cathedral_cart_v1", cartJSON(mid));
        lo = mid;
      } catch (e) {
        hi = mid - 1;
      }
    }
    localStorage.setItem("cathedral_cart_v1", cartJSON(lo));
  });
  await page.reload();
  await expect(page.locator(".cart-line").first()).toBeVisible();

  await page.click('[data-action="increase"]');
  await expect(page.locator("#storage-error")).toBeVisible();
});
