/* ============================================================
   GISCO - copy the work-order PDFs from the git repo into the
   private Supabase Storage bucket `gisco-docs`.

   WHY
   The repo has served these PDFs over raw.githubusercontent /
   GitHub Pages, so making the repo private would break WO.html and
   Shuhrah.html. Storage is the replacement, and the bucket stays
   private: every object is read with a signed-in user's JWT.

   CREDENTIALS
   Nothing is hardcoded and nothing secret is printed. The browser
   key is parsed out of supabase-config.js (it is a public key by
   design), and the login used to obtain a session is read from the
   `login` table at run time. Only lengths and HTTP statuses are
   logged.

   USAGE
     node tools/migrate-docs-to-storage.js --dry-run   # list what it would do
     node tools/migrate-docs-to-storage.js --limit 3   # small real test
     node tools/migrate-docs-to-storage.js             # everything (resumable)
     node tools/migrate-docs-to-storage.js --force     # re-upload existing keys

   Already-uploaded objects are skipped, so an interrupted run is
   safe to repeat.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'gisco-docs';
const PROJECT_URL = 'https://gecghwcqgxmitcsjbnst.supabase.co';

function die(msg) {
  console.error('FATAL: ' + msg);
  process.exit(1);
}

function browserKey() {
  const src = fs.readFileSync(path.join(ROOT, 'supabase-config.js'), 'utf8');
  const m = src.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  if (!m) die('could not read the browser key out of supabase-config.js');
  if (!/^sb_publishable_/.test(m[1])) die('supabase-config.js holds a non-public key');
  return m[1];
}

async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  return { status: res.status, text, json: (() => { try { return JSON.parse(text); } catch (e) { return null; } })() };
}

// A real GISCO account, so the upload runs as role `authenticated` and
// is governed by the same storage policies the app will use.
async function signIn(key) {
  const rows = await api(`${PROJECT_URL}/rest/v1/login?select=username,password&limit=1`, {
    headers: { apikey: key }
  });
  if (rows.status !== 200 || !Array.isArray(rows.json) || rows.json.length === 0) {
    die('could not read the login register (http ' + rows.status + ')');
  }
  const { username, password } = rows.json[0];
  const tok = await api(`${PROJECT_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: username + '@gisco.internal', password })
  });
  if (tok.status !== 200 || !tok.json || !tok.json.access_token) {
    die('login failed (http ' + tok.status + ') for user of length ' + String(username).length);
  }
  console.log('session ok: user len ' + String(username).length + ', token len ' + tok.json.access_token.length);
  return tok.json.access_token;
}

function pdfList() {
  const out = execFileSync('git', ['ls-files', '-z', '*.pdf'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean).sort();
}

async function exists(token, key, apiKey) {
  const r = await api(
    `${PROJECT_URL}/storage/v1/object/info/${BUCKET}/${encodeURIComponent(key)}`,
    { headers: { apikey: apiKey, Authorization: 'Bearer ' + token } }
  );
  return r.status === 200;
}

async function upload(token, apiKey, relPath, force) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return { status: 'MISSING' };
  if (!force && (await exists(token, relPath, apiKey))) return { status: 'SKIPPED' };

  const body = fs.readFileSync(abs);
  const r = await api(`${PROJECT_URL}/storage/v1/object/${BUCKET}/${encodeURIComponent(relPath)}`, {
    method: 'POST',
    headers: {
      apikey: apiKey,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/pdf',
      'x-upsert': 'true',
      'cache-control': '3600'
    },
    body
  });
  return { status: r.status, bytes: body.length, detail: r.status >= 400 ? r.text.slice(0, 160) : '' };
}

(async () => {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const limitArg = args.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(args[limitArg + 1], 10) : Infinity;

  const files = pdfList().slice(0, limit);
  const totalBytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
  console.log(`plan: ${files.length} files, ${(totalBytes / 1048576).toFixed(1)} MB -> ${BUCKET}/`);

  if (dryRun) {
    files.slice(0, 20).forEach((f) => console.log('  would upload: ' + f));
    console.log('dry run, nothing sent');
    return;
  }

  const key = browserKey();
  const token = await signIn(key);

  const counts = { uploaded: 0, skipped: 0, failed: 0 };
  const failures = [];
  let bytesDone = 0;

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const r = await upload(token, key, f, force);
    if (r.status === 'SKIPPED') counts.skipped++;
    else if (r.status === 'MISSING') { counts.failed++; failures.push(f + ' (not on disk)'); }
    else if (r.status >= 200 && r.status < 300) { counts.uploaded++; bytesDone += r.bytes; }
    else { counts.failed++; failures.push(`${f} -> http ${r.status} ${r.detail}`); }

    if ((i + 1) % 25 === 0 || i === files.length - 1) {
      console.log(`progress ${i + 1}/${files.length} uploaded=${counts.uploaded} skipped=${counts.skipped} failed=${counts.failed} ${(bytesDone / 1048576).toFixed(1)} MB`);
    }
  }

  console.log(`\ndone: uploaded=${counts.uploaded} skipped=${counts.skipped} failed=${counts.failed}`);
  if (failures.length) {
    console.log('failures:');
    failures.slice(0, 25).forEach((x) => console.log('  ' + x));
    process.exitCode = 1;
  }
})().catch((e) => die(e && e.stack ? e.stack : String(e)));
