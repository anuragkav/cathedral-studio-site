// Cathedral Studio — checkout form validation.
// Pure functions, no DOM access, so this can run under a browser <script>
// tag (attaches to window.CathedralValidation) or under Node's test
// runner via module.exports.
//
// This is a MOCK checkout — no real payment processing occurs anywhere
// in this app. luhnCheck only proves a card number is checksum-valid,
// never that it belongs to a real, chargeable card.

(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.CathedralValidation = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {

  const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  const US_ZIP_RE = /^\d{5}(-\d{4})?$/;

  function validateRequired(value) {
    return typeof value === "string" && value.trim().length > 0;
  }

  function validateEmail(value) {
    return typeof value === "string" && EMAIL_RE.test(value);
  }

  function validateZip(value, countryCode) {
    if (countryCode === "US") {
      return typeof value === "string" && US_ZIP_RE.test(value.trim());
    }
    return validateRequired(value);
  }

  function luhnCheck(cardNumber) {
    if (typeof cardNumber !== "string") return false;
    const stripped = cardNumber.replace(/[\s-]/g, "");
    if (!/^\d+$/.test(stripped) || stripped.length < 13 || stripped.length > 19) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = stripped.length - 1; i >= 0; i--) {
      let digit = parseInt(stripped[i], 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function validateExpiry(month, year, referenceDate) {
    if (referenceDate === undefined) referenceDate = new Date();
    const m = Number(month);
    let y = Number(year);
    if (!Number.isInteger(m) || m < 1 || m > 12) return false;
    if (!Number.isInteger(y)) return false;
    if (y < 100) y += 2000;
    // Last instant of the expiry month — a card expiring "this month" is
    // still valid through its final day, not just up to the 1st.
    const expiry = new Date(y, m, 0, 23, 59, 59, 999);
    return expiry >= referenceDate;
  }

  function formatCurrency(amount) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  return {
    validateRequired,
    validateEmail,
    validateZip,
    luhnCheck,
    validateExpiry,
    formatCurrency
  };
});
