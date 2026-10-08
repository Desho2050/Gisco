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
   1. Only the 'anon' (public) key may ever live here. A runtime
      guard below enforces that and refuses to build a client
      otherwise. Do not weaken it.
   2. If you need extra privilege for an operation, add a Postgres
      RPC or an Edge Function and call that - never add a
      privileged key to the browser.
   3. Load this file AFTER the supabase-js CDN tag and BEFORE any
      inline script that calls GisSupabase.create().

   LOADING THE KEY
   The key is read from window.GIS_ENV first (so a deployed site can
   inject it without editing this file) and falls back to the
   constant below. After rotating keys in Supabase Dashboard ->
   Settings -> API, update it in this ONE place only.
   ============================================================ */
(function () {
  'use strict';

  var SUPABASE_URL = 'https://gecghwcqgxmitcsjbnst.supabase.co';

  // ⚠ anon key only. The guard in create() rejects anything else.
  var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdlY2dod2NxZ3htaXRjc2pibnN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ4NjY3OTAsImV4cCI6MjA4MDQ0Mjc5MH0.0Kia3U-TVkSF1_4GGeeu4l3o2APMvL-xug-k8iQMM9g';

  /* ------------------------------------------------------------
     Decode the role claim from a Supabase JWT without verifying
     its signature. We only care which role the key was minted
     for, which is safe to read from the payload.
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

      var role = roleOf(key);
      if (role !== 'anon') {
        complain(
          'configured key has role "' + (role || 'unreadable') + '". ' +
          'Only the anon public key is allowed in browser code - a non-anon ' +
          'key bypasses Row Level Security. Rotate it in Supabase Dashboard ' +
          '-> Settings -> API and put the new anon key in supabase-config.js.'
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
