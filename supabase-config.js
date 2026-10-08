/* ============================================================
   GISCO - single source of truth for the Supabase client
   ------------------------------------------------------------
   WHY THIS FILE EXISTS
   Before this, every page hardcoded its own SUPABASE_URL /
   SUPABASE_ANON_KEY pair, and 12 of those pages carried a
   service_role key. service_role bypasses Row Level Security
   completely, so anyone who opened DevTools on those pages could
   read, edit and delete the whole database.

   RULES FOR THIS FILE
   1. Only a PUBLIC browser key may ever live here - the new
      'sb_publishable_...' key, or a legacy 'anon' JWT. A runtime
      guard below enforces that and refuses to build a client
      otherwise. Do not weaken it.
   2. If you need extra privilege for an operation, add a Postgres
      RPC or an Edge Function and call that - never add a
      privileged key to the browser. A 'sb_secret_...' key and a
      'service_role' JWT are both refused by that guard.
   3. Load this file AFTER the supabase-js CDN tag and BEFORE any
      inline script that calls GisSupabase.create().

   LOADING THE KEY
   The key is read from window.GIS_ENV first (so a deployed site can
   inject it without editing this file) and falls back to the
   constant below. After rotating keys in Supabase Dashboard ->
   Settings -> API Keys, update it in this ONE place only.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://gecghwcqgxmitcsjbnst.supabase.co';

  // Public browser key. The guard in create() rejects anything else.
  var SUPABASE_ANON_KEY = 'sb_publishable_3WmMzqEIJIJGzL5sspMLlQ_7biSX42Q';

  /* ------------------------------------------------------------
     Which role a configured key carries.

     New-style keys carry the role in their prefix: sb_publishable_
     is the public browser key, sb_secret_ is privileged. Legacy
     keys are JWTs whose payload names the role; we decode it
     without verifying the signature, which is safe to read from a
     payload and is the only reason this function exists.
     ------------------------------------------------------------ */
  function roleOf(jwt) {
    try {
      var parts = String(jwt || '').split('.');
      if (parts.length < 2) return null;
      var b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return JSON.parse(atob(b64)).role || null;
    } catch (e) {
      return null;
    }
  }

  function keyRole(key) {
    var s = String(key || '');
    if (s.indexOf('sb_publishable_') === 0) return 'anon';
    if (s.indexOf('sb_secret') === 0) return 'service_role';
    return roleOf(s);
  }

  var banner = '%c[GISCO Supabase]';
  var warned = false;

  function complain(message) {
    if (!warned) {
      warned = true;
      console.error(banner, message, 'font-weight:bold;color:#b91c1c');
    }
    throw new Error('GISCO Supabase config refused: ' + message);
  }

  /* ------------------------------------------------------------
     Auth defaults for the ONE client every page shares.

     persistSession is what makes the RLS migration work: the JWT
     GoTrue hands back at sign-in is what supabase-js attaches to
     each PostgREST request, so the database sees role
     `authenticated` instead of `anon`. A client that turns it off
     sends no token, and after db/003_enable_rls.sql every business
     table refuses it - oracle.html used to be in that position.

     detectSessionInUrl is off because this app has no OAuth
     redirect and runs inside an Android WebView; leaving it on makes
     the library look for a session in the URL hash on every load.
     ------------------------------------------------------------ */
  var DEFAULT_AUTH = {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  };

  /* ------------------------------------------------------------
     GisSupabase.create(options)
     Returns a supabase-js client built from the shared config.
     `options` is merged OVER the auth defaults above, so a page
     that needs a custom fetch still persists the session unless it
     explicitly asks not to.

     Fails closed: a refused client is a broken page, which is far
     better than a page that quietly hands out admin access.
     ------------------------------------------------------------ */
  var client = null; // one client per page is enough

  window.GisSupabase = {
    get URL() {
      return (window.GIS_ENV && window.GIS_ENV.SUPABASE_URL) || SUPABASE_URL;
    },

    get AUTH_DEFAULTS() {
      return DEFAULT_AUTH;
    },

    create: function (options) {
      var url = (window.GIS_ENV && window.GIS_ENV.SUPABASE_URL) || SUPABASE_URL;
      var key = (window.GIS_ENV && window.GIS_ENV.SUPABASE_ANON_KEY) || SUPABASE_ANON_KEY;

      var role = keyRole(key);
      if (role !== 'anon') {
        complain(
          'configured key has role "' + (role || 'unreadable') + '". ' +
          'Only a public browser key is allowed here - a secret or ' +
          'service_role key bypasses Row Level Security. Put the ' +
          'sb_publishable_... key from Supabase Dashboard -> Settings ' +
          '-> API Keys in supabase-config.js.'
        );
      }

      if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        complain('supabase-js library is not loaded on this page.');
      }

      // Cache only the no-options case; pages asking for custom options
      // get their own client.
      if (!options && client) return client;

      var merged = {};
      Object.keys(options || {}).forEach(function (k) { merged[k] = options[k]; });
      merged.auth = Object.assign({}, DEFAULT_AUTH, (options && options.auth) || {});

      if (merged.auth.persistSession === false) {
        console.error(
          '%c[GISCO Supabase] persistSession:false means this page sends no ' +
          'signed-in JWT. Once db/003_enable_rls.sql is applied, every query ' +
          'from it runs as the anon role and is refused.',
          'font-weight:bold;color:#b91c1c'
        );
      }

      var created = window.supabase.createClient(url, key, merged);
      if (!options) client = created;
      return created;
    }
  };
})();
