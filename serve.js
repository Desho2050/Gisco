const http = require('http');
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURI(req.url || '/');
    const filePath = path.join(root, urlPath === '/' ? 'Requests.html' : urlPath.replace(/^\//, ''));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      res.end(data);
    });
  } catch (e) {
    res.statusCode = 500;
    res.end('Server error');
  }
});

server.listen(5500, () => {
  console.log('Server listening at http://localhost:5500/Requests.html');
});