#!/usr/bin/env node
/* ============================================================
   centralize-supabase-config.js
   ------------------------------------------------------------
   One-pass, idempotent codemod for the GISCO static pages.

   What it does per HTML file:
     1. Deletes the hardcoded  const SUPABASE_URL = '...'
        and  const SUPABASE_ANON_KEY = '...'  definitions.
     2. Rewrites  <lib>.createClient(URL, KEY[, opts])  into
        GisSupabase.create([opts]) so the key always comes from
        the single shared supabase-config.js file.
     3. Points any leftover bare SUPABASE_URL identifier at
        GisSupabase.URL (e.g. console.log diagnostics).
     4. Injects <script src="supabase-config.js"></script> right
        after the supabase-js CDN tag.
     5. Refuses to write a file that still contains a service_role
        key or an unresolved identifier - it reports instead.

   Usage:
     node tools/centralize-supabase-config.js            # dry run
     node tools/centralize-supabase-config.js --apply     # write
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');
const CONFIG_FILE = 'supabase-config.js';

// Any page that talks to Supabase today is a candidate.
const CANDIDATES = fs.readdirSync(ROOT)
  .filter(f => f.toLowerCase().endsWith('.html'))
  .filter(f => /SUPABASE_URL|SUPABASE_ANON_KEY|createClient/.test(read(f)));

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* ------------------------------------------------------------
   Step 2 helper: replace a whole createClient(...) call
   expression, including multi-line option objects, by matching
   parentheses instead of assuming the call ends on one line.
   ------------------------------------------------------------ */
function rewriteCreateClient(src) {
  let out = '';
  let i = 0;
  let count = 0;

  while (true) {
    const at = src.indexOf('createClient(', i);
    if (at === -1) { out += src.slice(i); break; }

    // Open paren sits at `at + 'createClient'.length - 1`.
    const open = at + 'createClient('.length - 1;
    const close = matchParen(src, open);
    if (close === -1) { out += src.slice(i, at + 'createClient('.length); i = at + 'createClient('.length; continue; }

    const args = src.slice(open + 1, close);
    const parts = splitTopLevel(args);

    // Keep only arguments that are not the URL / key we just removed.
    const kept = parts.filter(a => {
      const s = a.trim().replace(/;$/, '').trim();
      return !/^(\w+\.)?SUPABASE_URL\b/.test(s) && !/^(\w+\.)?SUPABASE_ANON_KEY\b/.test(s);
    });

    // Absorb the receiver (supabase. / window.supabase.) preceding the call.
    const recvStart = findReceiverStart(src, at);
    out += src.slice(i, recvStart) + 'GisSupabase.create(' + (kept.length ? kept.join(',').trim() : '') + ')';
    i = close + 1;
    count++;
  }
  return { src: out, count };
}

function matchParen(src, open) {
  let depth = 0, inStr = null;
  for (let j = open; j < src.length; j++) {
    const c = src[j];
    if (inStr) { if (c === '\\') j++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return j; }
  }
  return -1;
}

// Split on commas that are not nested in (), [], {} or a string.
function splitTopLevel(args) {
  const parts = [];
  let depth = 0, inStr = null, cur = '';
  for (let j = 0; j < args.length; j++) {
    const c = args[j];
    if (inStr) { cur += c; if (c === '\\') { cur += args[++j]; continue; } if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

// Walk back over `supabase.` / `window.supabase.` so we can drop it.
function findReceiverStart(src, at) {
  let k = at;
  const m = src.slice(0, at).match(/((?:window\.)?[A-Za-z_$][\w$]*\.)?$/);
  if (m && m[1]) k = at - m[1].length;
  return k;
}

/* ------------------------------------------------------------
   Per-file transform
   ------------------------------------------------------------ */
function transform(file) {
  const before = read(file);
  let src = before;
  const log = [];

  // 1. Drop the credential definition lines.
  const defRe = /^[ \t]*(?:const|let|var)[ \t]+SUPABASE_(?:URL|ANON_KEY)[ \t]*=[ \t]*['"][^'"]*['"][ \t]*;?[ \t]*\r?\n/gm;
  const defs = (src.match(defRe) || []).length;
  src = src.replace(defRe, '');
  if (defs) log.push(`removed ${defs} credential definition line(s)`);

  // 2. Rewrite createClient(...) calls.
  const cc = rewriteCreateClient(src);
  src = cc.src;
  if (cc.count) log.push(`rewrote ${cc.count} createClient call(s)`);

  // 3. Point leftover URL references at the shared config.
  const leftovers = src.match(/\bSUPABASE_URL\b/g);
  if (leftovers) {
    src = src.replace(/\bSUPABASE_URL\b/g, 'GisSupabase.URL');
    log.push(`re-pointed ${leftovers.length} leftover SUPABASE_URL reference(s)`);
  }

  // 4. Inject the shared config script after the supabase-js CDN tag.
  //    The CDN URL may end in `.js`, `.min.js`, `@2`, `@2.39.7/dist/...`
  //    or carry no filename at all, so match on `supabase` anywhere in src.
  if (!new RegExp('src=["\']' + CONFIG_FILE + '["\']').test(src)) {
    const createAt = src.search(/GisSupabase\.create\(/);
    if (createAt !== -1) {
      const cdnRe = /([ \t]*)<script[^>]*src=["'][^"']*supabase[^"']*["'][^>]*>\s*<\/script>/i;
      const m = src.match(cdnRe);
      if (m) {
        src = src.slice(0, m.index + m[0].length) + '\n' + m[1] +
          `<script src="${CONFIG_FILE}"></script>` +
          src.slice(m.index + m[0].length);
        log.push('injected <script src="' + CONFIG_FILE + '"> after the CDN tag');
      } else {
        // Fall back: put it just before the inline script that uses it.
        const tagStart = src.lastIndexOf('<script', createAt);
        const indent = /^\s*/.exec(src.slice(tagStart, src.indexOf('\n', tagStart) + 1))[0].slice(0, 2);
        src = src.slice(0, tagStart) +
          `<script src="${CONFIG_FILE}"></script>\n${indent}` +
          src.slice(tagStart);
        log.push('injected <script src="' + CONFIG_FILE + '"> before the inline script (no CDN tag found)');
      }
    }
  }

  // Safety: never emit a file that still carries a real, usable privileged
  // key. We decode every JWT-shaped string rather than grepping for the words
  // "service_role", which also appear legitimately in guidance comments.
  const keys = src.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
  const badKeys = keys.filter(k => {
    try {
      let b64 = k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      return (JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).role || '') !== 'anon';
    } catch (e) { return true; }
  });
  const dangling = /\bSUPABASE_ANON_KEY\b/.test(src);

  return { before, after: src, log, badKeys, dangling, changed: src !== before };
}

/* ------------------------------------------------------------
   Main
   ------------------------------------------------------------ */
console.log(APPLY ? 'APPLYING changes' : 'DRY RUN (pass --apply to write)');
console.log(`scanning ${CANDIDATES.length} Supabase-using page(s)\n`);

let touched = 0, failed = 0;
for (const f of CANDIDATES) {
  const r = transform(f);
  if (!r.changed) { console.log(`○ ${f} - already clean, skipped`); continue; }
  if (r.badKeys.length) {
    console.log(`✗ ${f} - ${r.badKeys.length} non-anon key(s) still present, NOT written`);
    failed++; continue;
  }
  if (r.dangling) { console.log(`✗ ${f} - unresolved SUPABASE_ANON_KEY reference, NOT written`); failed++; continue; }

  console.log(`• ${f}`);
  r.log.forEach(l => console.log(`    ${l}`));
  if (APPLY) { fs.writeFileSync(path.join(ROOT, f), r.after, 'utf8'); }
  touched++;
}

console.log(`\n${APPLY ? 'updated' : 'would update'} ${touched} file(s), ${failed} refused.`);
if (!APPLY && touched) console.log('Re-run with --apply once the plan above looks right.');
