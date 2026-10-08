/* ============================================================
   tools/inject-auth-scripts.js
   ------------------------------------------------------------
   Adds <script src="gis-auth.js"></script> directly after the
   supabase-config.js tag on every page that calls
   GisSupabase.create(), so GisAuth exists before any page script
   runs.

   The previous inline one-liner failed on CRLF pages because it
   required "\n" right after </script>; this version accepts
   \r?\n. Idempotent: a page that already references gis-auth.js
   is left alone.

   Usage:  node tools/inject-auth-scripts.js          (dry run)
           node tools/inject-auth-scripts.js --apply
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

// Indentation of the config tag is reused so the file keeps its own
// formatting style.
const CONFIG_RE = /([ \t]*)<script[^>]*src=["']supabase-config\.js["'][^>]*><\/script>(\r?\n)?/;

const results = [];

for (const name of fs.readdirSync(ROOT).sort()) {
  if (!/\.html$/i.test(name)) continue;

  const file = path.join(ROOT, name);
  const src = fs.readFileSync(file, 'utf8');

  if (src.includes('gis-auth.js')) {
    results.push(['skip  ', name, 'tag already present']);
    continue;
  }

  const needsAuth = /GisSupabase\.create\(|GisAuth\./.test(src);
  if (!needsAuth) {
    results.push(['skip  ', name, 'no Supabase client use']);
    continue;
  }

  const match = src.match(CONFIG_RE);
  if (!match) {
    results.push(['BLOCK ', name, 'uses the client but has no supabase-config.js tag']);
    continue;
  }

  const indent = match[1] || '';
  const eol = match[2] || (src.includes('\r\n') ? '\r\n' : '\n');
  const tag = indent + '<script src="gis-auth.js"></script>' + eol;
  const patched = src.slice(0, match.index + match[0].length) + tag + src.slice(match.index + match[0].length);

  if (APPLY) fs.writeFileSync(file, patched);
  results.push([APPLY ? 'write ' : 'dry   ', name, 'after line ' + src.slice(0, match.index).split(/\r?\n/).length]);
}

for (const [verb, name, note] of results) console.log(verb, name.padEnd(22), note);

const blocked = results.filter((r) => r[0] === 'BLOCK ');
console.log('\ntotal html pages:', results.length, '| blocked:', blocked.length);
if (blocked.length) {
  console.error('BLOCKED pages need the config tag added first (run tools/centralize-supabase-config.js).');
  process.exitCode = 1;
}
