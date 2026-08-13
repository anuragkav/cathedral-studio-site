const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validateEmail, validatePassword, MIN_PASSWORD_LENGTH } = require("../../validators.js");

test("validateEmail accepts well-formed addresses", () => {
  assert.equal(validateEmail("a@b.com"), true);
  assert.equal(validateEmail("first.last+tag@sub.example.co"), true);
});

test("validateEmail rejects malformed input", () => {
  assert.equal(validateEmail(""), false);
  assert.equal(validateEmail("not-an-email"), false);
  assert.equal(validateEmail("a@b"), false);
  assert.equal(validateEmail("a b@c.com"), false);
  assert.equal(validateEmail(undefined), false);
  assert.equal(validateEmail(null), false);
  assert.equal(validateEmail(12345), false);
});

test("validatePassword enforces the minimum length", () => {
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH - 1)), false);
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH)), true);
  assert.equal(validatePassword("a".repeat(MIN_PASSWORD_LENGTH + 5)), true);
});

test("validatePassword rejects non-string input", () => {
  assert.equal(validatePassword(undefined), false);
  assert.equal(validatePassword(null), false);
  assert.equal(validatePassword(123456789012), false);
  assert.equal(validatePassword(""), false);
});
