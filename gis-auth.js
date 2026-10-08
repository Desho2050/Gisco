/* ============================================================
   GISCO - shared authentication module (Supabase Auth)
   ------------------------------------------------------------
   REPLACES: the old "if (data.password === password) sessionStorage
   .setItem('gisAuthenticated','true')" flow, which compared a
   plaintext password fetched over the anon key and then trusted a
   client-side boolean for every page.

   WHAT ACTUALLY SECURES THIS APP
   Two things, both server-side:
     1. Row Level Security (db/003_enable_rls.sql) - the anon key
        stops being able to read or write any business table, so
        forging anything in the browser gains nothing.
     2. The GoTrue-issued JWT, which supabase-js attaches to every
        PostgREST request, making the database see role
        `authenticated` instead of `anon`.
   Nothing in this file is a security control. It is session
   plumbing and UX. Do not add a check here and call it protection.

   USERNAME -> EMAIL, AND WHY
   Hosted Supabase has no username sign-in: GoTrue answers a
   {username} payload with "missing email or phone", and phone is
   disabled here. So accounts are keyed on a synthetic, unreachable
   email derived from the username. The domain lives in Postgres in
   public.gis_auth_domain() and this module READS IT FROM THERE at
   runtime, so the two sides can never drift apart. FALLBACK_DOMAIN
   below is only used if that RPC is not installed yet, and a
   mismatch then shows up as "Invalid login credentials".

   LOAD ORDER: supabase-js CDN -> supabase-config.js -> this file.
   It reuses the single cached client from GisSupabase.create(), so
   the session it writes is the same one every data request sends.

   MIGRATION BOOLEANS - see GISCO_AUTH_FLAGS at the bottom.
   ============================================================ */
(function () {
  'use strict';

  var LOGIN_PAGE = 'index.html';

  // Used only when public.gis_auth_domain() cannot be reached.
  // Must equal the value in db/001_helpers_and_roles.sql.
  var FALLBACK_DOMAIN = 'gisco.internal';

  // Legacy client-side flag the old guard trusted. Cleared on
  // logout; only honoured while ALLOW_LEGACY_LOGIN is true.
  var LEGACY_KEY = 'gisAuthenticated';

  // ------------------------------------------------------------
  // GISCO AUTH FLAGS - the only two switches for the cutover.
  // Read the documentation on them at the bottom of this file.
  // ------------------------------------------------------------
  var ALLOW_LEGACY_LOGIN = true;
  var ALLOW_PLAINTEXT_LOGIN_FALLBACK = true;

  var clientRef = null;
  var domainCache = null;

  function client() {
    if (!clientRef) {
      if (!window.GisSupabase || typeof window.GisSupabase.create !== 'function') {
        throw new Error('GISCO Auth: supabase-config.js must load before gis-auth.js');
      }
      clientRef = window.GisSupabase.create();
    }
    return clientRef;
  }

  function base64UrlDecode(segment) {
    var b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    return decodeURIComponent(
      atob(b64)
        .split('')
        .map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        })
        .join('')
    );
  }

  /* Read a JWT payload without verifying it. Only used to show the
     signed-in username and to spot an obviously expired token; the
     database does the real verification. */
  function claims(jwt) {
    try {
      var parts = String(jwt || '').split('.');
      if (parts.length !== 3) return null;
      return JSON.parse(base64UrlDecode(parts[1]));
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------
     The synthetic email domain, asked of Postgres itself.
     Cached for the page. Falls back to the constant above.
     ------------------------------------------------------------ */
  async function resolveDomain() {
    if (domainCache) return domainCache;
    try {
      var res = await client().rpc('gis_auth_domain');
      if (!res.error && typeof res.data === 'string' && res.data.indexOf('.') > 0) {
        domainCache = res.data.toLowerCase();
        return domainCache;
      }
    } catch (e) {
      /* pre-001 database: fall through */
    }
    domainCache = FALLBACK_DOMAIN;
    return domainCache;
  }

  async function emailFor(username) {
    var domain = await resolveDomain();
    return String(username || '').trim().toLowerCase() + '@' + domain;
  }

  function usernameFromUser(user) {
    if (!user) return '';
    var meta = user.user_metadata || {};
    if (meta.username) return meta.username;
    return String(user.email || '').split('@')[0];
  }

  /* ------------------------------------------------------------
     Session
     ------------------------------------------------------------ */
  async function session() {
    var res = await client().auth.getSession();
    if (res.error) return null;
    return res.data.session || null;
  }

  async function currentUser() {
    var s = await session();
    return s ? s.user : null;
  }

  async function hasValidSession() {
    var s = await session();
    if (!s || !s.access_token) return false;
    var jwt = claims(s.access_token);
    if (!jwt) return false;
    if (jwt.exp && jwt.exp * 1000 <= Date.now()) return false;
    return true;
  }

  /* ------------------------------------------------------------
     Sign in. Takes the USERNAME from the login dropdown; the
     synthetic email is built here so no page ever asks a person to
     type an email address.
     Returns { ok, user, error, code }.
     ------------------------------------------------------------ */
  async function signIn(username, password) {
    if (!username || !password) {
      return { ok: false, code: 'missing_input', error: 'Username and password are required' };
    }
    var email = await emailFor(username);
    var res = await client().auth.signInWithPassword({ email: email, password: password });
    if (res.error || !res.data || !res.data.session) {
      return {
        ok: false,
        code: (res.error && (res.error.code || res.error.name)) || 'sign_in_failed',
        status: res.error && res.error.status,
        error: (res.error && res.error.message) || 'Sign in failed'
      };
    }
    return { ok: true, user: res.data.user, session: res.data.session };
  }

  async function signOut() {
    try {
      await client().auth.signOut({ scope: 'global' });
    } catch (e) {
      /* A failed sign-out must still clear what we can clear. */
    }
    try {
      sessionStorage.removeItem(LEGACY_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------
     Wipe what this browser holds for the app.

     Same reasoning as auth-guard.js: these pages cache employee
     rosters, passports and material movements in IndexedDB and
     localStorage, and the apps run on shared Android devices, so a
     logout that leaves that data behind hands the next person real
     personal information without a password.

     auth-guard.js carries its own copy because it must stay
     dependency-free on 23 pages; this is the one for pages that
     load the full module (warehouse.html signs out on its own).
     ------------------------------------------------------------ */
  function clearLocalData() {
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-[A-Za-z0-9-]+-auth-token/.test(k)) kill.push(k);
      }
      kill.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    } catch (e) { /* private mode */ }

    try { sessionStorage.clear(); } catch (e) { /* ignore */ }
    try { localStorage.clear(); } catch (e) { /* ignore */ }

    /* deleteDatabase is asynchronous and is BLOCKED while a page
       holds the connection open. Navigating away first abandons the
       request, so the cached rows survive the logout - which is the
       one part of this wipe that actually holds other people's
       personal data. Callers must wait for this promise (bounded)
       before redirecting. */
    return new Promise(function (resolve) {
      var done = false;
      var finish = function () { if (!done) { done = true; clearTimeout(timer); resolve(); } };
      var timer = setTimeout(finish, 1500);

      if (!window.indexedDB || !indexedDB.databases) return finish();

      indexedDB.databases().then(function (dbs) {
        if (!dbs.length) return finish();
        var settled = 0;
        var one = function () { if (++settled >= dbs.length) finish(); };
        dbs.forEach(function (db) {
          try {
            var req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = one;
            req.onerror = one;
            req.onblocked = one;
          } catch (e) { one(); }
        });
      }).catch(finish);
    });
  }

  /* ------------------------------------------------------------
     Change the signed-in user's password.
     The old password is proven server-side first: signOut(), then
     signInWithPassword with the old value. That both verifies
     knowledge of the old password and gives GoTrue a fresh session,
     which it demands for sensitive updates when
     UPDATE_PASSWORD_REQUIRE_REAUTHENTICATION is on.
     ------------------------------------------------------------ */
  async function changePassword(username, oldPassword, newPassword) {
    if (!newPassword || newPassword.length < 6) {
      return { ok: false, error: 'New password must be at least 6 characters' };
    }

    var me = await currentUser();
    if (!me) {
      // Migration window: no auth account exists yet for this
      // username (db/002 has not run). Writing the old plaintext
      // column keeps the page working until then, and db/003 makes
      // the write fail closed by itself.
      if (ALLOW_PLAINTEXT_LOGIN_FALLBACK && ALLOW_LEGACY_LOGIN) {
        try {
          var row = await client()
            .from('login')
            .select('*')
            .eq('username', username)
            .maybeSingle();
          if (row.error || !row.data) {
            return { ok: false, error: 'Account not found' };
          }
          // The old page compared the current password here, and
          // this branch keeps that comparison. Dropping it would
          // make the migration path weaker than what is live today.
          if (row.data.password !== oldPassword) {
            return { ok: false, error: 'Current password is incorrect' };
          }

          // select() makes PostgREST return the affected rows. An
          // update that matches nothing is NOT an error, so without
          // this the page would congratulate you on changing the
          // password of a username that does not exist.
          var legacy = await client()
            .from('login')
            .update({ password: newPassword })
            .eq('username', username)
            .select('id');
          if (!legacy.error && legacy.data && legacy.data.length > 0) {
            return {
              ok: true,
              legacyPlaintext: true,
              error: 'Password updated in the legacy table. It takes effect for '
                   + 'Supabase Auth only after db/002_create_auth_users.sql is re-run.'
            };
          }
        } catch (e) { /* fall through to the normal error below */ }
      }
      return { ok: false, error: 'You must be signed in to change a password' };
    }

    var typed = String(username || '').trim().toLowerCase();
    var mine = usernameFromUser(me).toLowerCase();
    if (typed && typed !== mine) {
      return { ok: false, error: 'You can only change the password of the signed-in account (' + mine + ')' };
    }

    var email = await emailFor(mine);

    try {
      await client().auth.signOut({ scope: 'local' });
    } catch (e) { /* ignore */ }

    var re = await client().auth.signInWithPassword({ email: email, password: oldPassword });
    if (re.error || !re.data || !re.data.session) {
      return { ok: false, error: 'Current password is incorrect' };
    }

    var up = await client().auth.updateUser({ password: newPassword });
    if (up.error) {
      return { ok: false, error: (up.error.message || 'Password update failed') };
    }
    return { ok: true, user: up.data.user };
  }

  /* ------------------------------------------------------------
     The login dropdown, after step 3 closes public.login to anon.
     gis_login_usernames() is SECURITY DEFINER and returns only
     usernames; the return type makes it impossible for a password
     to come back through it.
     ------------------------------------------------------------ */
  async function usernames() {
    try {
      var rpc = await client().rpc('gis_login_usernames');
      if (!rpc.error && Array.isArray(rpc.data)) return rpc.data;
    } catch (e) { /* fall through to the table read */ }

    // Pre-003 databases can still read the table directly.
    var res = await client().from('login').select('username').order('username', { ascending: true });
    if (res.error) throw res.error;
    return (res.data || []).map(function (r) {
      return r.username;
    });
  }

  /* ------------------------------------------------------------
     Role of the signed-in user, via gis_my_role(). Returns null
     when the function is not installed yet or the user has no row,
     which callers treat as the least-privileged default.
     ------------------------------------------------------------ */
  async function myRole() {
    try {
      var res = await client().rpc('gis_my_role');
      if (!res.error) return res.data || null;
    } catch (e) { /* ignore */ }

    var s = await session();
    if (!s || !s.user) return null;
    var legacy = await client()
      .from('user_roles')
      .select('*')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (legacy.error) return null;
    return legacy.data;
  }

  function onAuthStateChange(callback) {
    return client().auth.onAuthStateChange(function (event, state) {
      try {
        callback(event, state);
      } catch (e) {
        console.error('GISCO Auth: state listener threw', e);
      }
    });
  }

  async function requireSession() {
    if (await hasValidSession()) return true;
    if (ALLOW_LEGACY_LOGIN) {
      try {
        if (sessionStorage.getItem(LEGACY_KEY) === 'true') return true;
      } catch (e) { /* ignore */ }
    }
    return false;
  }

  async function gotoLogin() {
    try {
      await window.GisAuth.signOut();
    } catch (e) { /* ignore */ }
    try {
      // Awaited: redirecting first abandons the IndexedDB deletes.
      await clearLocalData();
    } catch (e) { /* ignore */ }
    try {
      window.location.replace(LOGIN_PAGE);
    } catch (e) {
      window.location.href = LOGIN_PAGE;
    }
  }

  /* ============================================================
     GISCO AUTH FLAGS - the only two switches for the cutover.
     ------------------------------------------------------------
     ALLOW_LEGACY_LOGIN
       true  : a page also accepts the old sessionStorage boolean,
               and the login page may fall back to the plaintext
               public.login comparison when Supabase Auth rejects
               the account. Needed only between deploying this
               client and running db/002 (accounts) + db/003 (RLS).
       false : ONLY a real GoTrue session is accepted. Set this
               after db/003 is applied and sign-in is confirmed.
               Leaving it true after step 3 is harmless for the
               database (RLS ignores sessionStorage) but the login
               page will keep showing "account not set up yet"
               hints for people typing old passwords.

     ALLOW_PLAINTEXT_LOGIN_FALLBACK
       true  : index.html may check public.login.password directly.
               This only works while RLS is off; after db/003 the
               table is closed and this path fails closed anyway.
       false : never read a password column from the browser.

     When both are false, search for these names and delete the
     legacy branches - tools/verify-auth-migration.js reports it.
     The declarations live at the top of this file.
     ============================================================ */

  window.GisAuth = {
    LOGIN_PAGE: LOGIN_PAGE,
    FALLBACK_DOMAIN: FALLBACK_DOMAIN,
    ALLOW_LEGACY_LOGIN: ALLOW_LEGACY_LOGIN,
    ALLOW_PLAINTEXT_LOGIN_FALLBACK: ALLOW_PLAINTEXT_LOGIN_FALLBACK,
    claims: claims,
    resolveDomain: resolveDomain,
    emailFor: emailFor,
    usernameFromUser: usernameFromUser,
    client: client,
    session: session,
    currentUser: currentUser,
    hasValidSession: hasValidSession,
    signIn: signIn,
    signOut: signOut,
    clearLocalData: clearLocalData,
    changePassword: changePassword,
    usernames: usernames,
    myRole: myRole,
    onAuthStateChange: onAuthStateChange,
    requireSession: requireSession,
    gotoLogin: gotoLogin
  };
})();
