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

document.getElementById("resend-confirmation-btn").addEventListener("click", async (e) => {
  e.target.hidden = true;
  try {
    await window.CathedralAuth.resendConfirmation(lastUnconfirmedEmail);
  } catch (err) {
    // Deliberately ignored: resendConfirmation already avoids leaking
    // whether the address exists, so this button always ends the same way.
  }
  setMessage("signin", "If that account needs confirming, a new email is on its way.", false);
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

withSubmitGuard(document.getElementById("forgot-form"), async (form) => {
  setMessage("forgot", "", false);
  try {
    await window.CathedralAuth.requestPasswordReset(form.get("email"));
  } catch (err) {
    // Even on error, fall through to the same generic message below —
    // only a genuine server failure throws, and it looks identical to
    // the caller so email existence can't be inferred from this flow.
  }
  setMessage("forgot", "If that email is registered, a reset link is on its way.", false);
});

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
