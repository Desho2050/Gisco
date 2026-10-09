/* ============================================================
   GISCO Auth Guard - shared session gate
   ------------------------------------------------------------
   v2: the gate is a real Supabase (GoTrue) session, not the old
   sessionStorage boolean.

   WHY THE OLD VERSION WAS NOT A SECURITY CONTROL
   It read sessionStorage.getItem('gisAuthenticated') === 'true'.
   Anyone could set that from the browser console, and the boolean
   came from a plaintext password comparison done in JavaScript
   against a row fetched with a key that bypassed RLS. So it was a
   speed bump, not a lock.

   WHERE THE SECURITY ACTUALLY LIVES NOW
   The database. After db/003_enable_rls.sql the anon role cannot
   read or write any business table, so the guard's job is only to
   give people a login page instead of a wall of empty tables. It
   deliberately has NO dependencies: it reads the session that
   supabase-js already persisted in localStorage, and decodes the
   JWT's exp/iss claims to decide. It does not verify the signature
   and must never be described as doing so - PostgREST verifies the
   signature on every real request.

   MIGRATION
   ALLOW_LEGACY_LOGIN lets a page through on the old boolean while
   db/002 and db/003 are still being applied, so deploying this
   client cannot lock anyone out of a database that has no auth
   accounts yet. Set it to false (the single switch at the top of
   gis-auth.js) once sign-in through Supabase Auth is confirmed.
   The run order is documented in the header of
   db/003_enable_rls.sql.

   LOAD: anywhere in <head> or before the page's own scripts. It
   must not be deferred, because a page should gate before it renders.
   ============================================================ */
(function () {
  'use strict';

  var LOGIN_PAGE = 'index.html';
  var LEGACY_KEY = 'gisAuthenticated';

  /* ------------------------------------------------------------
     Read the session supabase-js persisted.
     The key is sb-<project-ref>-auth-token; we match the shape
     instead of hardcoding the ref so rotating the project does not
     require editing this file.
     ------------------------------------------------------------ */
  function readStoredSession() {
    var names = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && /^sb-[A-Za-z0-9-]+-auth-token/.test(k)) names.push(k);
    }
    for (var j = 0; j < names.length; j++) {
      try {
        var raw = localStorage.getItem(names[j]);
        if (!raw) continue;
        var parsed = JSON.parse(raw);
        var s = parsed.currentSession || parsed;
        if (s && s.access_token && s.refresh_token) return { key: names[j], session: s };
      } catch (e) {
        /* A corrupt key is not a session; keep looking. */
      }
    }
    return null;
  }

  function claims(jwt) {
    try {
      var parts = String(jwt || '').split('.');
      if (parts.length !== 3) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(decodeURIComponent(
        atob(b64).split('').map(function (c) {
          return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join('')
      ));
    } catch (e) {
      return null;
    }
  }

  function legacyLoginAccepted() {
    // Honour the single switch in gis-auth.js when that file is
    // loaded; default to true so pages without it still work during
    // the migration window.
    if (window.GisAuth && typeof window.GisAuth.ALLOW_LEGACY_LOGIN === 'boolean') {
      return window.GisAuth.ALLOW_LEGACY_LOGIN;
    }
    return true;
  }

  /* ------------------------------------------------------------
     Is there a usable session right now?
     ------------------------------------------------------------ */
  function hasSession() {
    var found = readStoredSession();
    if (found) {
      var jwt = claims(found.session.access_token);
      // No exp, or exp in the future: supabase-js refreshes the
      // access token on its own schedule, so a token that is merely
      // at its expiry boundary still means "this browser proved its
      // password recently".
      if (!jwt || !jwt.exp || jwt.exp * 1000 > Date.now() - 60000) return true;
    }
    if (legacyLoginAccepted()) {
      try {
        if (sessionStorage.getItem(LEGACY_KEY) === 'true') return true;
      } catch (e) { /* private mode */ }
    }
    return false;
  }

  /* Which page to bounce back from.
     A protected page like Overtime.html appends its own name, so the login
     form can return the visitor there after a successful sign-in instead of
     always landing on the dashboard. That is what makes a shared page link
     behave as a private URL: form first, requested page after. */
  function loginUrl() {
    var here = decodeURIComponent(String(location.pathname || '').split('/').pop() || '');
    if (!here || here === LOGIN_PAGE || !/\.html$/i.test(here)) return LOGIN_PAGE;
    return LOGIN_PAGE + '?next=' + encodeURIComponent(here);
  }

  function redirectToLogin() {
    var target = loginUrl();
    try {
      // replace() so a protected page never stays in the history
      // stack for the Back button to restore.
      window.location.replace(target);
    } catch (e) {
      window.location.href = target;
    }
  }

  function checkAuth() {
    if (!hasSession()) redirectToLogin();
  }

  checkAuth();

  /* ------------------------------------------------------------
     A token minted before a signing-key rotation still decodes as
     unexpired, so the synchronous pass above cannot see that the
     database has stopped trusting it. Once the page owns its
     scripts, re-check against GoTrue and bounce if it refuses.
     ------------------------------------------------------------ */
  document.addEventListener('DOMContentLoaded', function () {
    if (!readStoredSession()) return;
    if (!window.GisAuth || typeof window.GisAuth.requireSession !== 'function') return;
    Promise.resolve(window.GisAuth.requireSession()).then(function (ok) {
      if (!ok) redirectToLogin();
    }, function () {
      /* Keep the synchronous decision rather than guessing. */
    });
  });

  /* ------------------------------------------------------------
     Back / forward cache. A page restored from bfcache does not
     re-run scripts, so pageshow with persisted=true is where we
     re-verify.
     ------------------------------------------------------------ */
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) checkAuth();
  });

  // Some mobile webviews restore without firing pageshow.
  window.addEventListener('focus', checkAuth);

  /* ------------------------------------------------------------
     Revoke the refresh token server-side, then clear local state.
     POST {issuer}/auth/v1/logout with the access token; the issuer
     comes from the JWT itself (iss = https://<ref>.supabase.co), so
     this file needs no copy of the project URL or key.
     keepalive lets the request survive the navigation.
     ------------------------------------------------------------ */
  function revokeRemotely(session) {
    var jwt = claims(session.access_token);
    if (!jwt || !jwt.iss) return Promise.resolve();
    try {
      return fetch(String(jwt.iss).replace(/\/$/, '') + '/auth/v1/logout', {
        method: 'POST',
        keepalive: true,
        headers: { Authorization: 'Bearer ' + session.access_token }
      });
    } catch (e) {
      return Promise.resolve();
    }
  }

  /* ------------------------------------------------------------
     Clear everything this browser holds for the app.

     This is intentionally aggressive. The pages cache employee
     rosters, passports, timesheets and material movements in
     IndexedDB and localStorage (oracle.html alone caches ~25k rows),
     and these apps run on shared Android devices in the field, so
     leaving that data behind after a logout hands the next person
     real personal data without any password at all.

     It also wipes the harmless stuff (theme, language) - the
     previous build did the same, and it is not worth trying to
     separate the two on a per-key basis we cannot keep current.
     ------------------------------------------------------------ */
  function clearLocalTraces() {
    if (window.GisAuth && typeof window.GisAuth.clearLocalData === 'function') {
      // Same page, same module - use the one implementation.
      return window.GisAuth.clearLocalData();
    }

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

    /* Returns a promise: deleteDatabase is async and is BLOCKED
       while a page holds the connection, so redirecting before it
       settles leaves the cached rows on the device. */
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

  function gisGuardLogout() {
    var finish = function () {
      Promise.resolve(clearLocalTraces()).then(redirectToLogin, redirectToLogin);
    };

    var found = readStoredSession();
    if (found && window.GisAuth && typeof window.GisAuth.signOut === 'function') {
      // Preferred path: let supabase-js revoke the refresh token.
      window.GisAuth.signOut().then(finish, finish);
      return;
    }
    if (found) {
      revokeRemotely(found.session).then(finish, finish);
      return;
    }
    finish();
  }

  // gisGuardLogout is the named one; handleLogout stays as the
  // global the pages' onclick handlers already call. A page that
  // declares its own handleLogout() overwrites this (mainpage.html
  // did) - that is why mainpage now delegates here instead.
  window.gisGuardLogout = gisGuardLogout;
  window.handleLogout = gisGuardLogout;
})();
