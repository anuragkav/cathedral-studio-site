// Injected into the page before any app script runs, so account.html's
// `<script src=".../supabase-js@2">` load is superseded by this stub —
// window.supabase already exists by the time the real CDN script would
// otherwise define it, and script tags don't clobber an existing global
// with the same name that createClient normally attaches to.
//
// This models Supabase auth + a `profiles` table entirely in memory, with
// email-uniqueness and per-user row isolation enforced the same way real
// Supabase would via unique constraints and RLS — close enough to drive
// the UI through every flow deterministically, without a live project or
// real email delivery.
(function () {
  // addInitScript re-runs this whole file on every navigation/reload, so
  // state that needs to survive a reload (registered users, the active
  // session) is persisted to localStorage — mirroring how the real
  // Supabase client persists its session — instead of living only in
  // this closure.
  const STORE_KEY = "__mockSupabaseState";

  function loadStore() {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return { users: [], sessionEmail: null };
    return JSON.parse(raw);
  }

  function saveStore(store) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store));
  }

  const store = loadStore();
  const usersByEmail = new Map(store.users.map((r) => [r.user.email, r]));
  let currentSession = store.sessionEmail ? makeSessionFor(store.sessionEmail) : null;
  const authListeners = [];

  function persist() {
    saveStore({
      users: [...usersByEmail.values()],
      sessionEmail: currentSession ? currentSession.user.email : null
    });
  }

  function makeSessionFor(email) {
    const record = usersByEmail.get(email);
    return record ? makeSession(record.user) : null;
  }

  function emitAuthChange(event) {
    authListeners.forEach((cb) => cb(event, currentSession));
  }

  function makeSession(user) {
    return { access_token: "mock-token", user };
  }

  const auth = {
    async signUp({ email, password }) {
      if (usersByEmail.has(email)) {
        return { data: null, error: { message: "User already registered" } };
      }
      const user = { id: `user-${usersByEmail.size + 1}`, email };
      // Real Supabase requires email confirmation before a session exists
      // (session: null below) and before signInWithPassword succeeds
      // (confirmed: false here) — both mirrored so auth.js's unconfirmed-
      // email branch and the "check your email" UI copy are both exercised.
      usersByEmail.set(email, { user, password, confirmed: false, profile: { id: user.id, email, display_name: null } });
      persist();
      return { data: { user, session: null }, error: null };
    },
    async signInWithPassword({ email, password }) {
      const record = usersByEmail.get(email);
      if (!record || record.password !== password) {
        return { data: null, error: { message: "Invalid login credentials" } };
      }
      if (!record.confirmed) {
        return { data: null, error: { message: "Email not confirmed" } };
      }
      currentSession = makeSession(record.user);
      persist();
      emitAuthChange("SIGNED_IN");
      return { data: { user: record.user, session: currentSession }, error: null };
    },
    async signOut() {
      currentSession = null;
      persist();
      emitAuthChange("SIGNED_OUT");
      return { error: null };
    },
    async resetPasswordForEmail(_email, _opts) {
      return { error: null };
    },
    // Real Supabase resends a signup-confirmation email; nothing to send
    // here, but the call must succeed (or at least resolve) for every
    // address the same way — auth.js already discards this result for
    // enumeration-safety, so the mock only needs to not throw.
    async resend({ type: _type, email: _email }) {
      return { error: null };
    },
    async updateUser({ password }) {
      if (!currentSession) return { error: { message: "Not authenticated" } };
      const record = usersByEmail.get(currentSession.user.email);
      record.password = password;
      persist();
      return { error: null };
    },
    async getSession() {
      return { data: { session: currentSession }, error: null };
    },
    onAuthStateChange(cb) {
      authListeners.push(cb);
      return { data: { subscription: { unsubscribe() {} } } };
    },
    // Test-only hook: force a session into existence, bypassing signIn,
    // to reach the "signed in" panel directly in setup steps.
    __setSessionForTest(email) {
      const record = usersByEmail.get(email);
      currentSession = makeSession(record.user);
      persist();
      emitAuthChange("SIGNED_IN");
    },
    // Test-only hook: mirrors following a real password-recovery email
    // link — Supabase issues a real session and fires PASSWORD_RECOVERY
    // (not SIGNED_IN) for that session's arrival, which is the only signal
    // auth.js's isInRecoveryFlow() has to distinguish it from a normal login.
    __triggerPasswordRecoveryForTest(email) {
      const record = usersByEmail.get(email);
      currentSession = makeSession(record.user);
      persist();
      emitAuthChange("PASSWORD_RECOVERY");
    },
    __seedConfirmedUser(email, password) {
      const user = { id: `user-${usersByEmail.size + 1}`, email };
      usersByEmail.set(email, { user, password, confirmed: true, profile: { id: user.id, email, display_name: null } });
      persist();
    },
    __seedUnconfirmedUser(email, password) {
      const user = { id: `user-${usersByEmail.size + 1}`, email };
      usersByEmail.set(email, { user, password, confirmed: false, profile: { id: user.id, email, display_name: null } });
      persist();
    }
  };

  function fromProfiles() {
    let filterId = null;
    const builder = {
      select() {
        return builder;
      },
      update(patch) {
        builder._patch = patch;
        return builder;
      },
      eq(_col, value) {
        filterId = value;
        return builder;
      },
      async single() {
        const record = [...usersByEmail.values()].find((r) => r.user.id === filterId);
        if (!record) return { data: null, error: { message: "No rows found" } };
        if (builder._patch) {
          Object.assign(record.profile, builder._patch);
          persist();
          return { data: null, error: null };
        }
        return { data: record.profile, error: null };
      },
      then(resolve) {
        // `.update().eq()` in auth.js is awaited without `.single()`;
        // support both call shapes.
        return this.single().then(resolve);
      }
    };
    return builder;
  }

  window.supabase = {
    createClient() {
      return {
        auth,
        from(table) {
          if (table !== "profiles") throw new Error(`unexpected table ${table}`);
          return fromProfiles();
        }
      };
    }
  };
})();
