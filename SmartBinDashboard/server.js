const http = require('http');
const fs = require('fs');
const path = require('path');

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const publicDir = path.join(__dirname, 'public');

function sendFile(filePath, res, onMissing) {
    fs.readFile(filePath, (err, data) => {
        if (err) return onMissing();
        res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'text/plain' });
        res.end(data);
    });
}

http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const file = urlPath === '/' ? '/index.html' : urlPath;
    const safe = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');

    // 1) hanapin sa public/, 2) kung wala, hanapin sa root (para sa app.js)
    sendFile(path.join(publicDir, safe), res, () => {
        if (safe === '\\server.js' || safe === '/server.js') {
            res.writeHead(404);
            return res.end('Not found');
        }
        sendFile(path.join(__dirname, safe), res, () => {
            res.writeHead(404);
            res.end('Not found');
        });
    });
}).listen(3000, () => console.log('Running at http://localhost:3000'));