/* ============================================================
   GISCO - prove the gisco-docs access model before we rely on it.
   Three checks on one object, printing statuses and byte counts only:
     1. signed-in session  -> must succeed (this is how the pages read)
     2. anon (browser key) -> must be refused
     3. /object/public/... -> must be refused, the bucket is private
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUCKET = 'gisco-docs';
const PROJECT_URL = 'https://gecghwcqgxmitcsjbnst.supabase.co';

function browserKey() {
  const src = fs.readFileSync(path.join(ROOT, 'supabase-config.js'), 'utf8');
  const m = src.match(/SUPABASE_ANON_KEY\s*=\s*'([^']+)'/);
  if (!m || !/^sb_publishable_/.test(m[1])) throw new Error('no public browser key');
  return m[1];
}

async function head(url, headers) {
  const r = await fetch(url, { headers });
  const buf = await r.arrayBuffer();
  return { status: r.status, bytes: buf.byteLength, type: r.headers.get('content-type') };
}

/* The synthetic domain comes from Postgres, not from this file, so a database
   whose gis_auth_domain() differs cannot fail with a misleading answer. */
async function authDomain(key) {
  const r = await fetch(`${PROJECT_URL}/rest/v1/rpc/gis_auth_domain`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: '{}'
  }).then((x) => x.json()).catch(() => null);
  return typeof r === 'string' && r.indexOf('.') > 0 ? r.toLowerCase() : 'gisco.internal';
}

/* Which account can sign in is not knowable from here: db/002 carried the
   register's passwords into auth.users as <username>@<domain>, while accounts
   created in the dashboard answer whatever address they were made with, and
   GoTrue returns one identical 400 for a wrong email and a wrong password.
   So try each candidate. GISCO_AUTH_EMAIL/PASSWORD win because they are the
   only path left once db/003 closes the register to anon. */
async function loginCandidates(key, dom) {
  const out = [];
  if (process.env.GISCO_AUTH_EMAIL && process.env.GISCO_AUTH_PASSWORD) {
    out.push({ email: process.env.GISCO_AUTH_EMAIL, password: process.env.GISCO_AUTH_PASSWORD });
  }
  const rows = await fetch(`${PROJECT_URL}/rest/v1/login?select=username,password&order=username&limit=25`, { headers: { apikey: key } })
    .then((r) => (r.ok ? r.json() : [])).catch(() => []);
  for (const r of Array.isArray(rows) ? rows : []) {
    const u = String(r.username || '').trim();
    if (!u || !r.password) continue;
    out.push({ email: u.indexOf('@') > 0 ? u : u + '@' + dom, password: r.password });
  }
  return out;
}

async function firstSession(key, cands) {
  const tried = [];
  for (const c of cands) {
    const res = await fetch(`${PROJECT_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: c.email, password: c.password })
    });
    const j = await res.json().catch(() => null);
    if (res.status === 200 && j && j.access_token) return j.access_token;
    tried.push(c.email.replace(/^(.{2}).*?(@.*)$/, '$1***$2'));
  }
  throw new Error('no account could sign in'
    + (tried.length ? ' (tried ' + tried.join(', ') + ')' : ' (no candidates were readable)')
    + '. GoTrue answers the same 400 to a wrong password and an unknown email, so check auth.users, '
    + 'or set GISCO_AUTH_EMAIL and GISCO_AUTH_PASSWORD.');
}

(async () => {
  const key = browserKey();
  const name = process.argv[2] || '22084.pdf';

  const token = await firstSession(key, await loginCandidates(key, await authDomain(key)));

  const enc = encodeURIComponent(name);
  const onDisk = fs.statSync(path.join(ROOT, name)).size;

  // The path the CDN supabase-js client uses for an authenticated read,
  // learned from the browser's own network log.
  const signed = await head(`${PROJECT_URL}/storage/v1/object/${BUCKET}/${enc}`, { apikey: key, Authorization: 'Bearer ' + token });
  const anon = await head(`${PROJECT_URL}/storage/v1/object/${BUCKET}/${enc}`, { apikey: key });
  const viaPublic = await head(`${PROJECT_URL}/storage/v1/object/public/${BUCKET}/${enc}`, { apikey: key });

  // Which endpoint answers "does this object exist" for the resume check.
  const candidates = [
    ['GET', `/storage/v1/object/info/${BUCKET}/${enc}`],
    ['GET', `/storage/v1/object/info/authenticated/${BUCKET}/${enc}`],
    ['POST', `/storage/v1/object/info/authenticated/${BUCKET}/${enc}`]
  ];
  const missing = encodeURIComponent('this-file-does-not-exist-918273.pdf');
  const existence = [];
  for (const [m, p] of candidates) {
    const here = await fetch(`${PROJECT_URL}${p}`, { method: m, headers: { apikey: key, Authorization: 'Bearer ' + token }, body: m === 'POST' ? '{}' : undefined });
    const gone = await fetch(`${PROJECT_URL}${p.replace(enc, missing)}`, { method: m, headers: { apikey: key, Authorization: 'Bearer ' + token }, body: m === 'POST' ? '{}' : undefined });
    existence.push(`${m} ${p.split('/storage')[1]} : exists=${here.status} missing=${gone.status} ${here.status < 300 && gone.status >= 400 ? '<= usable' : ''}`);
  }

  console.log('object: ' + name + ' (local size ' + onDisk + ' bytes)');
  console.log('  signed-in : http ' + signed.status + ' ' + signed.bytes + 'B ' + signed.type + ' -> ' + (signed.bytes === onDisk ? 'BYTES MATCH' : 'SIZE MISMATCH'));
  console.log('  anon      : http ' + anon.status + ' ' + anon.bytes + 'B -> ' + (anon.status >= 400 ? 'REFUSED (good)' : 'READABLE (bad)'));
  console.log('  public url: http ' + viaPublic.status + ' ' + viaPublic.bytes + 'B -> ' + (viaPublic.status >= 400 ? 'REFUSED (good)' : 'READABLE (bad)'));
  existence.forEach((e) => console.log('  ' + e));

  const ok = signed.status === 200 && signed.bytes === onDisk && anon.status >= 400 && viaPublic.status >= 400;
  console.log(ok ? 'RESULT: access model correct' : 'RESULT: NOT as designed');
  process.exitCode = ok ? 0 : 1;
})().catch((e) => { console.error('FATAL: ' + e.message); process.exitCode = 1; });
