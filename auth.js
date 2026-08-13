// Cathedral Studio — account system.
// Wraps the Supabase JS client for signup/login/session/profile. Supabase
// row-level security (see supabase/schema.sql) is the actual authorization
// boundary — everything here is UX plumbing, not a trust boundary itself.

const supabaseClient = window.supabase.createClient(
  window.CATHEDRAL_CONFIG.SUPABASE_URL,
  window.CATHEDRAL_CONFIG.SUPABASE_ANON_KEY
);

// Aliased on destructure: validators.js already declares top-level
// `function validateEmail`/`validatePassword` and `const MIN_PASSWORD_LENGTH`
// in this same classic-script global scope. Reusing those exact names here
// via `const` is a redeclaration and throws a SyntaxError at parse time,
// which silently aborts this entire script (and with it window.CathedralAuth).
const {
  validateEmail: validateEmailFormat,
  validatePassword: validatePasswordFormat,
  MIN_PASSWORD_LENGTH: MIN_PW_LEN
} = window.CathedralValidators;

// Every auth error surfaced to the UI is genericized here so the login
// and reset flows never reveal whether a given email is registered.
function genericAuthError() {
  return new Error("That didn't work. Check your details and try again.");
}

function isUnconfirmedEmailError(error) {
  return error.code === "email_not_confirmed" || /email.*not.*confirm/i.test(error.message || "");
}

// True if config.js still has its placeholder values. Every entry point
// below checks this first so a not-yet-configured deploy fails with one
// clear message instead of a raw network/fetch error from the Supabase
// client trying to reach a fake project URL.
function isConfigured() {
  const cfg = window.CATHEDRAL_CONFIG || {};
  return cfg.SUPABASE_URL !== "https://YOUR-PROJECT-REF.supabase.co" &&
    cfg.SUPABASE_ANON_KEY !== "YOUR-ANON-PUBLIC-KEY";
}

function assertConfigured() {
  if (!isConfigured()) {
    throw new Error("Accounts aren't set up yet on this site. Check back soon.");
  }
}

// captchaToken is optional everywhere it appears below: passing undefined
// (the default) omits Supabase's `options.captchaToken` entirely, which is
// exactly how these calls behaved before Turnstile existed — a caller on
// a page with no Turnstile widget, or before turnstile.js loads, doesn't
// need a code path change to keep working, it just gets no bot protection.
async function signUp(email, password, captchaToken) {
  assertConfigured();
  if (!validateEmailFormat(email)) throw new Error("Enter a valid email address.");
  if (!validatePasswordFormat(password)) {
    throw new Error(`Password must be at least ${MIN_PW_LEN} characters.`);
  }
  const options = captchaToken ? { captchaToken } : undefined;
  const { data, error } = await supabaseClient.auth.signUp({ email, password, options });
  // Two distinct "this email is already taken" shapes have to be
  // swallowed the same way, not just one: an explicit `error` (some
  // Supabase configs/versions do return "User already registered"), and
  // the shape real Supabase-js actually returns for a duplicate,
  // already-confirmed email when email confirmations are on — no error
  // at all, just data.user.identities: [] (GoTrue's documented way of
  // avoiding account enumeration via the signup endpoint itself). The
  // caller shows identical "check your email" copy regardless of which
  // shape came back, so a signup attempt on an existing address can't
  // be used to enumerate confirmed accounts either way.
  const isDuplicateError = error && /already registered/i.test(error.message || "");
  if (error && !isDuplicateError) throw new Error(error.message);
  return data;
}

async function signIn(email, password, captchaToken) {
  assertConfigured();
  if (!validateEmailFormat(email) || !validatePasswordFormat(password)) throw genericAuthError();
  const options = captchaToken ? { captchaToken } : undefined;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password, options });
  if (error) {
    if (isUnconfirmedEmailError(error)) {
      throw Object.assign(new Error("Confirm your email before signing in."), { unconfirmed: true });
    }
    throw genericAuthError();
  }
  return data;
}

async function resendConfirmation(email, captchaToken) {
  assertConfigured();
  if (!validateEmailFormat(email)) throw new Error("Enter a valid email address.");
  const options = captchaToken ? { captchaToken } : undefined;
  // Errors here are not surfaced distinctly from "sent" for the same
  // enumeration-safety reason as requestPasswordReset below.
  await supabaseClient.auth.resend({ type: "signup", email, options });
}

async function signOut() {
  const { error } = await supabaseClient.auth.signOut();
  if (error) throw new Error(error.message);
}

async function requestPasswordReset(email, captchaToken) {
  assertConfigured();
  if (!validateEmailFormat(email)) throw new Error("Enter a valid email address.");
  // redirectTo must be on Supabase's allowlisted Redirect URLs for this
  // project — otherwise Supabase itself rejects the reset link server-side.
  const redirectTo = new URL("account.html?mode=update-password", window.location.origin + window.location.pathname.replace(/[^/]+$/, "")).toString();
  const opts = { redirectTo };
  if (captchaToken) opts.captchaToken = captchaToken;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, opts);
  // Never branch on `error` here in a way the caller can distinguish
  // "no such account" from "sent" — both look identical to the UI.
  if (error && error.status && error.status >= 500) throw new Error("Something went wrong. Try again shortly.");
}

async function updatePassword(newPassword) {
  if (!validatePasswordFormat(newPassword)) {
    throw new Error(`Password must be at least ${MIN_PW_LEN} characters.`);
  }
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
  // The recovery flow is complete now that a new password is set — clear
  // the flag so this same session is treated as an ordinary signed-in
  // session on the next refreshView(), instead of looping back to the
  // "set a new password" panel indefinitely.
  setRecoveryFlow(false);
}

async function getSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

// Tracks whether the *current* session arrived via a password-recovery
// link, as opposed to a normal sign-in — Supabase issues a real, usable
// session either way, so this is the only signal that distinguishes them.
// Supabase fires PASSWORD_RECOVERY exactly once, at the moment the
// recovery link's token is first consumed — a later reload or navigation
// just restores the persisted session with no re-fire. Without storing
// the flag somewhere that survives that reload, the very first refresh
// after clicking a reset link would fall through to "session exists" and
// reopen the bug this is meant to close. sessionStorage is scoped to this
// tab and clears itself when the tab closes, so it can't leak into a
// later, unrelated browser session on a shared machine.
const RECOVERY_FLAG_KEY = "cathedral_in_recovery_flow";

function setRecoveryFlow(value) {
  if (value) {
    window.sessionStorage.setItem(RECOVERY_FLAG_KEY, "1");
  } else {
    window.sessionStorage.removeItem(RECOVERY_FLAG_KEY);
  }
}

function onAuthStateChange(callback) {
  return supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") setRecoveryFlow(true);
    if (event === "SIGNED_OUT") setRecoveryFlow(false);
    callback(session, event);
  });
}

function isInRecoveryFlow() {
  return window.sessionStorage.getItem(RECOVERY_FLAG_KEY) === "1";
}

async function getProfile(userId) {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("id, email, display_name, created_at")
    .eq("id", userId)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function updateDisplayName(userId, displayName) {
  const trimmed = displayName.trim();
  if (trimmed.length > 80) throw new Error("Name must be 80 characters or fewer.");
  const { error } = await supabaseClient
    .from("profiles")
    .update({ display_name: trimmed })
    .eq("id", userId);
  if (error) throw new Error(error.message);
}

window.CathedralAuth = {
  signUp,
  signIn,
  signOut,
  requestPasswordReset,
  resendConfirmation,
  updatePassword,
  getSession,
  onAuthStateChange,
  isInRecoveryFlow,
  getProfile,
  updateDisplayName,
  validateEmail: validateEmailFormat,
  validatePassword: validatePasswordFormat,
  MIN_PASSWORD_LENGTH: MIN_PW_LEN
};
