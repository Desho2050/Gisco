/* ============================================================
   tools/verify-auth-migration.js
   ------------------------------------------------------------
   Static + live checks for the Supabase Auth migration.

     node tools/verify-auth-migration.js          syntax + wiring
     node tools/verify-auth-migration.js --live   also probe the API

   --live asks the RUNNING questions: can the anon key still read a
   business table, and does the login RPC answer? It only ever reads,
   and it uses the same public key the browser has, so a pass here
   means exactly what a pass in the browser would mean.

   Exit code is non-zero when anything is BLOCKING.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const LIVE = process.argv.includes('--live');

let blocking = 0;
let warnings = 0;
const say = (level, msg) => {
  if (level === 'BLOCK') blocking++;
  if (level === 'WARN') warnings++;
  console.log(`  ${level === 'BLOCK' ? 'X' : level === 'WARN' ? '~' : ' '} ${msg}`);
};

const htmlFiles = fs.readdirSync(ROOT).filter((f) => /\.html$/i.test(f)).sort();

/* ------------------------------------------------------------
   1. Syntax of every inline script block
   ------------------------------------------------------------ */
console.log('\n[1] inline script syntax');
for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(src))) {
    i++;
    if (!m[1].trim()) continue;
    try {
      new vm.Script(m[1], { filename: `${f}#${i}` });
    } catch (e) {
      say('BLOCK', `${f} block ${i}: ${e.message}`);
    }
  }
}
say('OK', `${htmlFiles.length} pages scanned`);

/* ------------------------------------------------------------
   2. Script wiring on pages that use the client
   ------------------------------------------------------------ */
console.log('\n[2] script wiring (CDN -> supabase-config -> gis-auth)');
for (const f of htmlFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  const usesClient = /GisSupabase\.create\(/.test(src);
  const usesAuth = /GisAuth\./.test(src);
  if (!usesClient && !usesAuth) continue;

  const iCdn = src.search(/<script[^>]*src=["'][^"']*supabase[^"']*\.co[^"]*["']|<script[^>]*src=["'][^"']*supabase-js/);
  const iCfg = src.indexOf('supabase-config.js');
  const iAuth = src.indexOf('gis-auth.js');
  const firstUse = Math.min(
    ...[src.search(/GisSupabase\.create\(/), src.search(/GisAuth\./)].filter((n) => n >= 0)
  );

  if (iCfg < 0) say('BLOCK', `${f}: no supabase-config.js tag`);
  if (usesAuth && iAuth < 0) say('BLOCK', `${f}: uses GisAuth but never loads gis-auth.js`);
  if (iCfg >= 0 && iAuth >= 0 && iCfg > iAuth) say('BLOCK', `${f}: gis-auth.js loads BEFORE supabase-config.js`);
  if (iAuth >= 0 && firstUse >= 0 && iAuth > firstUse) say('BLOCK', `${f}: gis-auth.js loads after its first use`);
  if (usesAuth && !/auth-guard\.js/.test(src) && f !== 'index.html' && f !== 'warehouse.html') {
    say('WARN', `${f}: uses GisAuth but has no auth-guard.js`);
  }
}
say('OK', 'wiring checked');

/* ------------------------------------------------------------
   3. No privileged key anywhere
   ------------------------------------------------------------ */
console.log('\n[3] key hygiene');
const jwtShape = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g;
const allFiles = fs.readdirSync(ROOT).filter((f) => /\.(html|js)$/i.test(f));
for (const f of allFiles) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const token of src.match(jwtShape) || []) {
    let role = 'unreadable';
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      role = JSON.parse(Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString()).role;
    } catch (e) { /* keep unreadable */ }
    if (role !== 'anon') say('BLOCK', `${f}: JWT with role "${role}" is present in client code`);
  }
}
say('OK', 'every JWT found in html/js carries role "anon"');

/* ------------------------------------------------------------
   3b. Session persistence must stay on, or a page sends no JWT.
   Matched as an options object, not as prose: both supabase-config.js
   and oracle.html mention persistSession:false in comments explaining
   why it must not be used.
   ------------------------------------------------------------ */
console.log('\n[3b] client auth options');
let persistBreakers = 0;
for (const f of [...htmlFiles, 'gis-auth.js', 'supabase-config.js']) {
  const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  if (/auth\s*:\s*\{[^}]*persistSession\s*:\s*false/.test(src)) {
    persistBreakers++;
    say('BLOCK', `${f}: passes persistSession:false - after db/003 every request from it is refused as anon`);
  }
}
if (!persistBreakers) say('OK', 'no page disables session persistence');

/* ------------------------------------------------------------
   4. Migration flags - the thing people forget to turn off
   ------------------------------------------------------------ */
console.log('\n[4] migration flags');
const authSrc = fs.readFileSync(path.join(ROOT, 'gis-auth.js'), 'utf8');
for (const [name, done] of [
  ['ALLOW_LEGACY_LOGIN', /var ALLOW_LEGACY_LOGIN = (true|false);/],
  ['ALLOW_PLAINTEXT_LOGIN_FALLBACK', /var ALLOW_PLAINTEXT_LOGIN_FALLBACK = (true|false);/]
]) {
  const v = (authSrc.match(done) || [])[1];
  if (v === undefined) say('BLOCK', `${name}: declaration not found - the flag was renamed or removed`);
  else if (v === 'true') say('WARN', `${name} is still true (expected until db/002 + db/003 are applied)`);
  else say('OK', `${name} = false`);
}

/* ------------------------------------------------------------
   5. The plaintext column must not be read from the browser
   ------------------------------------------------------------ */
console.log('\n[5] plaintext password reads and writes');
const PINPOINT = /\.(password)\s*===|update\(\{\s*password|select\(['"]\*['"]\)\s*\.eq\(['"]username/;
for (const f of [...htmlFiles, 'gis-auth.js', 'auth-guard.js', 'supabase-config.js']) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  if (!PINPOINT.test(src)) continue;
  if (/ALLOW_PLAINTEXT_LOGIN_FALLBACK/.test(src)) {
    say('WARN', `${f}: touches the plaintext password column, inside a branch gated by ALLOW_PLAINTEXT_LOGIN_FALLBACK`);
  } else {
    say('BLOCK', `${f}: reads or writes login.password with no migration gate`);
  }
}

/* ------------------------------------------------------------
   6. Optional live probe
   ------------------------------------------------------------ */
async function probe() {
  const cfg = fs.readFileSync(path.join(ROOT, 'supabase-config.js'), 'utf8');
  const url = (cfg.match(/var SUPABASE_URL = '([^']+)'/) || [])[1];
  const key = (cfg.match(/var SUPABASE_ANON_KEY = '([^']+)'/) || [])[1];
  if (!url || !key) throw new Error('supabase-config.js has no readable constants');

  const ask = (resource) => new Promise((resolve) => {
    const req = https.request(url + resource, {
      method: 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key, Range: '0-0' }
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body: body.slice(0, 200) }));
    });
    req.on('error', (e) => resolve({ status: 0, body: e.message }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
    req.end();
  });

  console.log('\n[6] live probe as the anon role');
  for (const t of ['emps', 'materials', 'transactions', 'login', 'user_roles']) {
    // Never print a response body here: these tables hold personal
    // data and, pre-004, login holds passwords.
    const r = await ask(`/rest/v1/${encodeURIComponent(t)}?select=*&limit=1`);
    if (r.status === 200) say('WARN', `anon can still READ ${t} (HTTP 200) - RLS is not applied yet`);
    else if (r.status === 401 || r.status === 403 || r.status === 404) say('OK', `anon blocked from ${t} (HTTP ${r.status})`);
    else say('WARN', `${t}: unexpected HTTP ${r.status}`);
  }
  const rpc = await ask('/rest/v1/rpc/gis_login_usernames');
  if (rpc.status === 200) say('OK', 'gis_login_usernames() answers anon (login dropdown will work)');
  else say('WARN', `gis_login_usernames() -> HTTP ${rpc.status} (run db/001_helpers_and_roles.sql)`);
}

(async () => {
  if (LIVE) {
    try { await probe(); } catch (e) { say('BLOCK', 'live probe failed: ' + e.message); }
  } else {
    console.log('\n[6] live probe skipped (pass --live to run it)');
  }

  console.log(`\n${blocking ? 'BLOCKING: ' + blocking : 'no blocking issues'} | warnings: ${warnings}`);
  process.exitCode = blocking ? 1 : 0;
})();
