// Cathedral Studio — account page controller.
// Pure DOM/textContent rendering throughout: nothing here ever sets
// innerHTML from a value that can come from user input (email, display
// name, error text), so there's no XSS surface via profile data.

const panels = ["signin", "signup", "forgot", "update-password", "account"];

function showPanel(name) {
  const loading = document.getElementById("account-loading");
  if (loading) loading.hidden = true;

  panels.forEach((p) => {
    const el = document.getElementById(`panel-${p}`);
    if (el) el.hidden = p !== name;
  });
  // Keyboard/screen-reader users switching panels via the data-panel
  // links otherwise get no indication focus has moved into new content.
  const heading = document.querySelector(`#panel-${name} .account-title`);
  if (heading) {
    heading.setAttribute("tabindex", "-1");
    heading.focus();
  }
}

function setMessage(formName, text, isError) {
  const el = document.querySelector(`.account-msg[data-for="${formName}"]`);
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("account-msg--error", Boolean(isError));
}

// Prevents double-submits (e.g. double-click) from firing duplicate
// signup/reset requests while a request is already in flight, and shows
// a spinner in place of the label so a slow network reads as "working"
// rather than an unresponsive click.
function withSubmitGuard(form, handler) {
  let busy = false;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    busy = true;
    const button = form.querySelector("button[type=submit]");
    if (button) {
      button.disabled = true;
      button.classList.add("is-busy");
    }
    try {
      await handler(new FormData(form));
    } finally {
      busy = false;
      if (button) {
        button.disabled = false;
        button.classList.remove("is-busy");
      }
    }
  });
}

async function renderAccountPanel(session) {
  const profile = await window.CathedralAuth.getProfile(session.user.id);
  document.getElementById("account-email").textContent = profile.email;
  document.getElementById("display-name").value = profile.display_name || "";
  showPanel("account");
}

async function refreshView() {
  const session = await window.CathedralAuth.getSession();

  // Gated on the recovery-flow signal itself, not on the presence of a
  // session or the ?mode= query param — either of those alone can be
  // true for a normal signed-in user, which would otherwise let a
  // password-reset link (or a hand-typed URL) act as a standing login
  // rather than a one-time path to setting a new password.
  if (session && window.CathedralAuth.isInRecoveryFlow()) {
    showPanel("update-password");
    return;
  }
  if (session) {
    await renderAccountPanel(session);
    return;
  }
  showPanel("signin");
}

// A browser can restore this page from the back-forward cache — DOM and
// all — without re-running any script on a plain history navigation. On
// a shared machine, Back after Sign out could otherwise redisplay the
// previous session's account panel straight from that cached DOM.
// Forcing a fresh refreshView() on every bfcache restore closes that.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) refreshView();
});

document.querySelectorAll("[data-panel]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    showPanel(link.dataset.panel);
  });
});

withSubmitGuard(document.getElementById("signin-form"), async (form) => {
  setMessage("signin", "", false);
  try {
    await window.CathedralAuth.signIn(form.get("email"), form.get("password"));
    await refreshView();
  } catch (err) {
    setMessage("signin", err.message, true);
    if (err.unconfirmed) {
      lastUnconfirmedEmail = form.get("email");
      document.getElementById("resend-confirmation-btn").hidden = false;
    }
  }
});

let lastUnconfirmedEmail = "";

// Client-side cooldown for the resend/reset flows. Not a security boundary
// on its own — a scripted attacker bypasses this trivially by calling the
// Supabase endpoint directly with the public anon key — but it stops the
// far more common "impatient human hammering the button", and combined
// with Supabase's own server-side rate limits + Turnstile it meaningfully
// raises the cost of email-flooding a victim's inbox via this UI.
const COOLDOWN_MS = 60 * 1000;
const COOLDOWN_KEYS = {
  resend: "cathedral_cooldown_resend",
  forgot: "cathedral_cooldown_forgot"
};

function cooldownRemainingMs(key) {
  const until = Number(window.sessionStorage.getItem(key));
  if (!Number.isFinite(until) || until <= 0) return 0;
  return Math.max(0, until - Date.now());
}

function armCooldown(key) {
  window.sessionStorage.setItem(key, String(Date.now() + COOLDOWN_MS));
}

function applyCooldownToButton(button, key, labelFn) {
  if (!button) return;
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel;

  function tick() {
    const remaining = cooldownRemainingMs(key);
    if (remaining <= 0) {
      button.disabled = false;
      button.textContent = originalLabel;
      return;
    }
    button.disabled = true;
    button.textContent = labelFn(Math.ceil(remaining / 1000));
    setTimeout(tick, 500);
  }
  tick();
}

document.getElementById("resend-confirmation-btn").addEventListener("click", async (e) => {
  const button = e.currentTarget;
  if (cooldownRemainingMs(COOLDOWN_KEYS.resend) > 0) return;
  armCooldown(COOLDOWN_KEYS.resend);
  try {
    await window.CathedralAuth.resendConfirmation(lastUnconfirmedEmail);
  } catch (err) {
    // Deliberately ignored: resendConfirmation already avoids leaking
    // whether the address exists, so this button always ends the same way.
  }
  setMessage("signin", "If that account needs confirming, a new email is on its way.", false);
  applyCooldownToButton(button, COOLDOWN_KEYS.resend, (s) => `Resend confirmation email (${s}s)`);
});

withSubmitGuard(document.getElementById("signup-form"), async (form) => {
  setMessage("signup", "", false);
  try {
    await window.CathedralAuth.signUp(form.get("email"), form.get("password"));
    setMessage("signup", "Check your email to confirm your account.", false);
  } catch (err) {
    setMessage("signup", err.message, true);
  }
});

const forgotForm = document.getElementById("forgot-form");
const forgotButton = forgotForm.querySelector('button[type="submit"]');

withSubmitGuard(forgotForm, async (form) => {
  setMessage("forgot", "", false);
  if (cooldownRemainingMs(COOLDOWN_KEYS.forgot) > 0) {
    // Every branch of this handler lands on the same generic message, so
    // an in-cooldown submit can't be distinguished from a successful one
    // by the response text — only by the button label countdown, which
    // is a UX affordance for a real human, not an oracle for a bot.
    setMessage("forgot", "If that email is registered, a reset link is on its way.", false);
    applyCooldownToButton(forgotButton, COOLDOWN_KEYS.forgot, (s) => `Send reset link (${s}s)`);
    return;
  }
  armCooldown(COOLDOWN_KEYS.forgot);
  try {
    await window.CathedralAuth.requestPasswordReset(form.get("email"));
    setMessage("forgot", "If that email is registered, a reset link is on its way.", false);
  } catch (err) {
    // requestPasswordReset only ever throws for a genuine server failure
    // (a 5xx) — it never throws to indicate "no such account", so
    // surfacing this specific error can't be used to enumerate accounts;
    // it would fire identically whether or not the email is registered.
    // Swallowing it here would instead tell a real user an email is on
    // its way when the request never actually reached Supabase.
    setMessage("forgot", err.message, true);
  }
  applyCooldownToButton(forgotButton, COOLDOWN_KEYS.forgot, (s) => `Send reset link (${s}s)`);
});

// Re-arm the visual cooldown after a reload or panel switch, so a user
// who reset their password 20 seconds ago and refreshed still sees the
// remaining wait instead of a fresh-looking button.
if (cooldownRemainingMs(COOLDOWN_KEYS.forgot) > 0) {
  applyCooldownToButton(forgotButton, COOLDOWN_KEYS.forgot, (s) => `Send reset link (${s}s)`);
}
if (cooldownRemainingMs(COOLDOWN_KEYS.resend) > 0) {
  applyCooldownToButton(
    document.getElementById("resend-confirmation-btn"),
    COOLDOWN_KEYS.resend,
    (s) => `Resend confirmation email (${s}s)`
  );
}

withSubmitGuard(document.getElementById("update-password-form"), async (form) => {
  setMessage("update-password", "", false);
  try {
    await window.CathedralAuth.updatePassword(form.get("password"));
    setMessage("update-password", "Password updated.", false);
    window.history.replaceState({}, "", "account.html");
    await refreshView();
  } catch (err) {
    setMessage("update-password", err.message, true);
  }
});

withSubmitGuard(document.getElementById("name-form"), async (form) => {
  setMessage("name", "", false);
  try {
    const session = await window.CathedralAuth.getSession();
    await window.CathedralAuth.updateDisplayName(session.user.id, form.get("displayName") || "");
    setMessage("name", "Saved.", false);
  } catch (err) {
    setMessage("name", err.message, true);
  }
});

document.getElementById("signout-btn").addEventListener("click", async () => {
  await window.CathedralAuth.signOut();
  await refreshView();
});

window.CathedralAuth.onAuthStateChange(() => {
  refreshView();
});

refreshView();
