/* ============================================================
   GISCO local dev server
   ------------------------------------------------------------
   Hardened replacement for the old 27-line version, which had two
   real problems:
     1. Path traversal - it joined the raw request path onto the
        root, so /../../../Windows/win.ini escaped the folder.
     2. No Content-Type header at all, and it served Requests.html
        at / instead of index.html, the actual login entry point.

   It now: stays inside the folder, sets Content-Type, defaults to
   index.html, sends no-cache for HTML so edits show up on reload,
   and binds to 127.0.0.1 only so it is not reachable from the
   LAN. Run with: node serve.js
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.cwd());
const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5500);
const INDEX = 'index.html';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel'
};

function send(res, status, body, headers) {
  res.writeHead(status, Object.assign({ 'Content-Length': Buffer.byteLength(body) }, headers));
  res.end(body);
}

const server = http.createServer((req, res) => {
  let rel;
  try {
    // Only accept GET/HEAD for a static dev server.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    }
    const url = new URL(req.url, 'http://' + HOST);
    rel = decodeURIComponent(url.pathname);
    if (rel.indexOf('\0') !== -1) return send(res, 400, 'Bad Request', {});
  } catch (e) {
    return send(res, 400, 'Bad Request', {});
  }

  if (rel === '/' || rel === '') rel = '/' + INDEX;

  // Resolve, then prove the result is still inside ROOT.
  const target = path.normalize(path.join(ROOT, rel));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain' });
  }

  fs.stat(target, (err, st) => {
    let file = target;
    if (!err && st.isDirectory()) file = path.join(target, INDEX);

    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        return send(res, 404, 'Not found: ' + path.relative(ROOT, file).replace(/\\/g, '/'),
          { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      const ext = path.extname(file).toLowerCase();
      const isHtml = ext === '.html';
      send(res, 200, data, {
        'Content-Type': TYPES[ext] || 'application/octet-stream',
        // HTML must never be cached or the app serves stale pages mid-edit.
        'Cache-Control': isHtml ? 'no-store, must-revalidate' : 'no-cache'
      });
    });
  });
});

server.listen(PORT, HOST, () => {
  console.log('GISCO dev server: http://' + HOST + ':' + PORT + '/  (serving ' + ROOT + ')');
  console.log('Press Ctrl+C to stop.');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('Port ' + PORT + ' is already in use. Try: PORT=5600 node serve.js');
    process.exit(1);
  }
  throw e;
});
