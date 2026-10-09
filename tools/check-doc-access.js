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

(async () => {
  const key = browserKey();
  const name = process.argv[2] || '22084.pdf';

  const rows = await (await fetch(`${PROJECT_URL}/rest/v1/login?select=username,password&limit=1`, { headers: { apikey: key } })).json();
  if (!Array.isArray(rows) || !rows[0]) throw new Error('login register unreadable');
  const tok = await (await fetch(`${PROJECT_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: rows[0].username + '@gisco.internal', password: rows[0].password })
  })).json();
  if (!tok || !tok.access_token) throw new Error('session could not be created');

  const enc = encodeURIComponent(name);
  const onDisk = fs.statSync(path.join(ROOT, name)).size;

  // The path the CDN supabase-js client uses for an authenticated read,
  // learned from the browser's own network log.
  const signed = await head(`${PROJECT_URL}/storage/v1/object/${BUCKET}/${enc}`, { apikey: key, Authorization: 'Bearer ' + tok.access_token });
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
    const here = await fetch(`${PROJECT_URL}${p}`, { method: m, headers: { apikey: key, Authorization: 'Bearer ' + tok.access_token }, body: m === 'POST' ? '{}' : undefined });
    const gone = await fetch(`${PROJECT_URL}${p.replace(enc, missing)}`, { method: m, headers: { apikey: key, Authorization: 'Bearer ' + tok.access_token }, body: m === 'POST' ? '{}' : undefined });
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
