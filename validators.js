// Cathedral Studio — pure account-form validation logic.
// No DOM/window dependency, so this loads unmodified in the browser
// (as a plain script, attached to window) and under Node's test runner
// (via module.exports) without needing a DOM shim.

const MIN_PASSWORD_LENGTH = 12;

function validateEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validatePassword(password) {
  return typeof password === "string" && password.length >= MIN_PASSWORD_LENGTH;
}

const api = { validateEmail, validatePassword, MIN_PASSWORD_LENGTH };

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
}
if (typeof window !== "undefined") {
  window.CathedralValidators = api;
}
