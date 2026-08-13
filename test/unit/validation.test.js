const { test } = require("node:test");
const assert = require("node:assert/strict");
const Validation = require("../../validation.js");

test("validateRequired accepts non-blank strings", () => {
  assert.equal(Validation.validateRequired("hello"), true);
  assert.equal(Validation.validateRequired("  hello  "), true);
});

test("validateRequired rejects blank/whitespace-only strings", () => {
  assert.equal(Validation.validateRequired(""), false);
  assert.equal(Validation.validateRequired("   "), false);
});

test("validateRequired rejects non-string input", () => {
  assert.equal(Validation.validateRequired(undefined), false);
  assert.equal(Validation.validateRequired(null), false);
  assert.equal(Validation.validateRequired(123), false);
});

test("validateEmail accepts well-formed addresses", () => {
  assert.equal(Validation.validateEmail("a@b.com"), true);
  assert.equal(Validation.validateEmail("first.last+tag@sub.example.co"), true);
  assert.equal(Validation.validateEmail("user@sub.domain.example.com"), true);
});

test("validateEmail rejects malformed input", () => {
  assert.equal(Validation.validateEmail(""), false);
  assert.equal(Validation.validateEmail("not-an-email"), false);
  assert.equal(Validation.validateEmail("a@b"), false);
  assert.equal(Validation.validateEmail("a b@c.com"), false);
  assert.equal(Validation.validateEmail("@c.com"), false);
  assert.equal(Validation.validateEmail("a@.com"), false);
  assert.equal(Validation.validateEmail("a@c."), false);
});

test("validateEmail rejects non-string input", () => {
  assert.equal(Validation.validateEmail(undefined), false);
  assert.equal(Validation.validateEmail(null), false);
  assert.equal(Validation.validateEmail(12345), false);
});

test("validateZip requires 5-digit or ZIP+4 format for US", () => {
  assert.equal(Validation.validateZip("12345", "US"), true);
  assert.equal(Validation.validateZip("12345-6789", "US"), true);
  assert.equal(Validation.validateZip("1234", "US"), false);
  assert.equal(Validation.validateZip("123456", "US"), false);
  assert.equal(Validation.validateZip("abcde", "US"), false);
  assert.equal(Validation.validateZip("12345-67", "US"), false);
});

test("validateZip trims surrounding whitespace for US", () => {
  assert.equal(Validation.validateZip("  12345  ", "US"), true);
});

test("validateZip falls back to non-blank check for non-US countries", () => {
  assert.equal(Validation.validateZip("SW1A 1AA", "UK"), true);
  assert.equal(Validation.validateZip("", "UK"), false);
  assert.equal(Validation.validateZip("anything", "Other"), true);
});

test("luhnCheck accepts known Luhn-valid card numbers", () => {
  assert.equal(Validation.luhnCheck("4111111111111111"), true);
  assert.equal(Validation.luhnCheck("5500005555555559"), true);
  assert.equal(Validation.luhnCheck("340000000000009"), true);
});

test("luhnCheck accepts a Luhn-valid number with spaces or dashes", () => {
  assert.equal(Validation.luhnCheck("4111 1111 1111 1111"), true);
  assert.equal(Validation.luhnCheck("4111-1111-1111-1111"), true);
});

test("luhnCheck rejects a checksum-invalid number", () => {
  assert.equal(Validation.luhnCheck("4111111111111112"), false);
});

test("luhnCheck rejects non-digit characters", () => {
  assert.equal(Validation.luhnCheck("411111111111111a"), false);
  assert.equal(Validation.luhnCheck("abcdefghijklmno"), false);
});

test("luhnCheck rejects numbers outside the 13-19 digit range", () => {
  assert.equal(Validation.luhnCheck("411111111111"), false);
  assert.equal(Validation.luhnCheck("41111111111111111111"), false);
});

test("luhnCheck rejects non-string input", () => {
  assert.equal(Validation.luhnCheck(4111111111111111), false);
  assert.equal(Validation.luhnCheck(undefined), false);
  assert.equal(Validation.luhnCheck(null), false);
});

const REFERENCE_DATE = new Date(2026, 5, 15); // June 15, 2026 — injected, not system time

test("validateExpiry accepts a future expiry", () => {
  assert.equal(Validation.validateExpiry(12, 26, REFERENCE_DATE), true);
  assert.equal(Validation.validateExpiry(12, 2026, REFERENCE_DATE), true);
});

test("validateExpiry accepts the current month as still valid", () => {
  assert.equal(Validation.validateExpiry(6, 26, REFERENCE_DATE), true);
});

test("validateExpiry rejects a past month in the current year", () => {
  assert.equal(Validation.validateExpiry(5, 26, REFERENCE_DATE), false);
});

test("validateExpiry rejects a past year entirely", () => {
  assert.equal(Validation.validateExpiry(12, 25, REFERENCE_DATE), false);
});

test("validateExpiry rejects an out-of-range month", () => {
  assert.equal(Validation.validateExpiry(0, 27, REFERENCE_DATE), false);
  assert.equal(Validation.validateExpiry(13, 27, REFERENCE_DATE), false);
  assert.equal(Validation.validateExpiry(-1, 27, REFERENCE_DATE), false);
});

test("validateExpiry accepts numeric-string month/year", () => {
  assert.equal(Validation.validateExpiry("12", "26", REFERENCE_DATE), true);
});

test("validateExpiry rejects non-numeric month/year", () => {
  assert.equal(Validation.validateExpiry("abc", "26", REFERENCE_DATE), false);
  assert.equal(Validation.validateExpiry("12", "xy", REFERENCE_DATE), false);
});

test("validateExpiry treats the last instant of the expiry month as still valid", () => {
  const lastDayOfJune = new Date(2026, 5, 30, 23, 0, 0);
  assert.equal(Validation.validateExpiry(6, 26, lastDayOfJune), true);
});

test("formatCurrency renders whole dollars with two decimal places and a thousands separator", () => {
  assert.equal(Validation.formatCurrency(1450), "$1,450.00");
});

test("formatCurrency renders fractional cents correctly", () => {
  assert.equal(Validation.formatCurrency(89.5), "$89.50");
});

test("formatCurrency renders zero", () => {
  assert.equal(Validation.formatCurrency(0), "$0.00");
});
