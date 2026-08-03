/* ============================================================
   GISCO Auth Guard - shared session / cache protection
   ------------------------------------------------------------
   1) Redirects unauthenticated users to the login page (index.html)
      using location.replace() so protected pages are not kept in
      the browser history.
   2) Handles the browser Back / Forward cache (bfcache): when a
      user presses Back after logout, the browser can restore a
      page from cache without re-running scripts. The 'pageshow'
      event (event.persisted === true) forces a re-auth check.
   3) Provides window.handleLogout() which clears sessionStorage,
      localStorage, and IndexedDB app caches, then navigates to the
      login page with location.replace() (no history entry retained).
   ============================================================ */
(function () {
  'use strict';

  var AUTH_KEY = 'gisAuthenticated';
  var LOGIN_PAGE = 'index.html';

  function isAuthenticated() {
    try {
      return sessionStorage.getItem(AUTH_KEY) === 'true';
    } catch (e) {
      return false;
    }
  }

  function redirectToLogin() {
    try {
      // location.replace() removes the current page from history so
      // the Back button cannot return to a protected page.
      window.location.replace(LOGIN_PAGE);
    } catch (e) {
      window.location.href = LOGIN_PAGE;
    }
  }

  function checkAuth() {
    if (!isAuthenticated()) {
      redirectToLogin();
    }
  }

  // --- Initial check (runs immediately when the script loads) ---
  checkAuth();

  // --- Back / forward cache (bfcache) protection ---
  // On logout the session is cleared; if the user then presses Back
  // the browser may restore the cached page. 'pageshow' fires with
  // event.persisted === true in that case, so we re-verify auth.
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) {
      checkAuth();
    }
  });

  // Extra safety net for browsers / mobile webviews that may restore
  // a page on focus without firing pageshow.
  window.addEventListener('focus', function () {
    checkAuth();
  });

  /* ------------------------------------------------------------
     Global logout helper
     Clears sessionStorage, localStorage, and IndexedDB caches,
     then navigates to the login page using location.replace() so
     the protected page is not retained in browser history.
     ------------------------------------------------------------ */
  window.handleLogout = function () {
    try {
      // 1) Clear the session (auth token + all session data)
      sessionStorage.clear();
    } catch (e) { /* ignore */ }

    try {
      // 2) Clear all localStorage (theme, language, cached state)
      localStorage.clear();
    } catch (e) { /* ignore */ }

    // 3) Best-effort: clear IndexedDB application caches
    try {
      if (window.indexedDB && indexedDB.databases) {
        indexedDB.databases().then(function (dbs) {
          dbs.forEach(function (db) {
            try { indexedDB.deleteDatabase(db.name); } catch (e) { /* ignore */ }
          });
        }).catch(function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }

    // 4) Go to the login page, replacing the current history entry
    window.location.replace(LOGIN_PAGE);
  };
})();

