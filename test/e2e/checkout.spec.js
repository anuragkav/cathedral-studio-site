const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "cathedral_cart_v1";

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

const VALID_SHIPPING = {
  email: "buyer@example.com",
  "full-name": "Jamie Rivera",
  address1: "1 Cathedral Way",
  city: "Providence",
  state: "RI",
  zip: "02903"
};

const VALID_CARD = {
  "card-number": "4111 1111 1111 1111",
  "card-expiry": "12/30",
  "card-cvc": "123"
};

async function fillValidCheckoutForm(page) {
  await page.fill("#email", VALID_SHIPPING.email);
  await page.fill("#full-name", VALID_SHIPPING["full-name"]);
  await page.fill("#address1", VALID_SHIPPING.address1);
  await page.fill("#city", VALID_SHIPPING.city);
  await page.fill("#state", VALID_SHIPPING.state);
  await page.fill("#zip", VALID_SHIPPING.zip);
  await page.fill("#card-number", VALID_CARD["card-number"]);
  await page.fill("#card-expiry", VALID_CARD["card-expiry"]);
  await page.fill("#card-cvc", VALID_CARD["card-cvc"]);
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

test("removing the only line falls back to the empty state and clears the summary cart", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.click('[data-action="remove"][data-id="men-01"]');
  await expect(page.locator("#cart-empty")).toBeVisible();
});

test("submitting with empty required fields shows field errors and does not show the confirmation", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await page.click("#checkout-submit");
  await expect(page.locator('[data-error-for="email"]')).not.toHaveText("");
  await expect(page.locator('[data-error-for="full-name"]')).not.toHaveText("");
  await expect(page.locator('[data-error-for="card-number"]')).not.toHaveText("");
  await expect(page.locator("#checkout-confirmation")).toBeHidden();
});

test("an invalid email is flagged with a specific error", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.fill("#email", "not-an-email");
  await page.click("#checkout-submit");
  await expect(page.locator('[data-error-for="email"]')).toHaveText(/valid email/i);
  await expect(page.locator("#checkout-confirmation")).toBeHidden();
});

test("a Luhn-invalid card number is rejected", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.fill("#card-number", "4111 1111 1111 1112");
  await page.click("#checkout-submit");
  await expect(page.locator('[data-error-for="card-number"]')).toHaveText(/valid card/i);
  await expect(page.locator("#checkout-confirmation")).toBeHidden();
});

test("an expired card is rejected", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.fill("#card-expiry", "01/20");
  await page.click("#checkout-submit");
  await expect(page.locator('[data-error-for="card-expiry"]')).toHaveText(/expiry/i);
  await expect(page.locator("#checkout-confirmation")).toBeHidden();
});

test("an invalid US zip is rejected", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.fill("#zip", "abc");
  await page.click("#checkout-submit");
  await expect(page.locator('[data-error-for="zip"]')).not.toHaveText("");
  await expect(page.locator("#checkout-confirmation")).toBeHidden();
});

test("a fully valid submission shows the preview confirmation and never a real charge claim", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-confirmation")).toBeVisible();
  await expect(page.locator("#checkout-confirmation")).toContainText(/nothing was charged/i);
  await expect(page.locator("#cart-content")).toBeHidden();
});

test("submitting clears the cart from storage so a reload shows the empty state", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-confirmation")).toBeVisible();
  await page.reload();
  await expect(page.locator("#cart-empty")).toBeVisible();
});

test("the disclosure banner is visible and the submit button never claims to charge or place a real order", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await expect(page.locator(".checkout-disclosure")).toContainText(/no payment is processed/i);
  const submitText = (await page.locator("#checkout-submit").textContent()).toLowerCase();
  expect(submitText).not.toMatch(/pay now|place order|charge/);
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

test("submitting with an invalid email sets aria-invalid and associates the error via aria-describedby", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.fill("#email", "not-an-email");
  await page.click("#checkout-submit");
  const emailInput = page.locator("#email");
  await expect(emailInput).toHaveAttribute("aria-invalid", "true");
  const describedBy = await emailInput.getAttribute("aria-describedby");
  expect(describedBy).toBe("error-email");
  await expect(page.locator("#" + describedBy)).toHaveAttribute("role", "alert");
});

test("correcting an invalid field clears aria-invalid and aria-describedby", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.fill("#email", "not-an-email");
  await page.click("#checkout-submit");
  await expect(page.locator("#email")).toHaveAttribute("aria-invalid", "true");
  await page.fill("#email", VALID_SHIPPING.email);
  await page.click("#checkout-submit");
  await expect(page.locator("#email")).not.toHaveAttribute("aria-invalid", "true");
});

test("submitting successfully moves focus to the confirmation heading", async ({ page }) => {
  await (await seedCart([{ id: "men-01", name: "Nave Overcoat", price: 1450, qty: 1 }]))(page);
  await page.goto("/checkout.html");
  await fillValidCheckoutForm(page);
  await page.click("#checkout-submit");
  await expect(page.locator("#checkout-confirmation")).toBeVisible();
  await expect(page.locator("#checkout-confirmation h1")).toBeFocused();
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
