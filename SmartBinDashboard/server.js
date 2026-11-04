const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

// Hindi mag-start ang server kung walang naka-set na admin credentials
if (!ADMIN_USER || !ADMIN_PASS) {
    console.error('ERROR: I-set muna ang ADMIN_USER at ADMIN_PASS (environment variables).');
    process.exit(1);
}

const publicDir = path.join(__dirname, 'public');
const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
};

// ---------- Data (nasa memory ng server) ----------
const ITEM_PERCENT = 5;
const state = { bio: 0, nonBio: 0, collectedBio: 0, collectedNonBio: 0, lastSeg: 'None yet' };
let history = [];
let nextId = 1;

function logEntry(category, status, tag) {
    history.push({ id: nextId++, timestamp: new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' }), category, status, tag });
    if (history.length > 500) history.shift();
}

// ---------- Permanenteng storage (PostgreSQL) ----------
let pool = null;
if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const url = process.env.DATABASE_URL;
    pool = new Pool({
        connectionString: url,
        ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false }
    });
}

async function loadData() {
    if (!pool) {
        console.warn('WARNING: Walang DATABASE_URL. Memory lang ang data at mawawala kapag nag-restart.');
        return;
    }
    await pool.query('CREATE TABLE IF NOT EXISTS app_state (id INT PRIMARY KEY, data JSONB NOT NULL)');
    const r = await pool.query('SELECT data FROM app_state WHERE id = 1');
    if (r.rows.length) {
        const d = r.rows[0].data;
        Object.assign(state, d.state || {});
        history = d.history || [];
        nextId = d.nextId || 1;
    }
    console.log('Data loaded from database.');
}

let saving = Promise.resolve();
function saveData() {
    if (!pool) return;
    const snapshot = JSON.stringify({ state: state, history: history, nextId: nextId });
    saving = saving
        .then(function () {
            return pool.query(
                'INSERT INTO app_state (id, data) VALUES (1, $1::jsonb) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
                [snapshot]
            );
        })
        .catch(function (e) { console.error('Save failed:', e.message); });
}

// ---------- Auth ----------
const SESSION_MS = 7 * 24 * 60 * 60 * 1000; // 7 araw
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
    console.warn('WARNING: Walang SESSION_SECRET. Mawawala ang login session kapag nag-restart ang server.');
}
const revoked = new Set();

function signPayload(payload) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
}

function makeToken() {
    const payload = String(Date.now() + SESSION_MS);
    return payload + '.' + signPayload(payload);
}

function validToken(token) {
    if (!token || revoked.has(token)) return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const expected = signPayload(parts[0]);
    if (parts[1].length !== expected.length) return false;
    if (!crypto.timingSafeEqual(Buffer.from(parts[1]), Buffer.from(expected))) return false;
    return Number(parts[0]) > Date.now();
}

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function getToken(req) {
    const m = /(?:^|;\s*)session=([0-9]+\.[a-f0-9]{64})/.exec(req.headers.cookie || '');
    return m ? m[1] : null;
}

function isAdmin(req) {
    return validToken(getToken(req));
}

// Limit sa maling login: 5 mali kada 15 minuto kada IP
const attempts = new Map();
function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    return (fwd ? fwd.split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}
function isBlocked(ip) {
    const a = attempts.get(ip);
    if (!a) return false;
    if (a.resetAt < Date.now()) { attempts.delete(ip); return false; }
    return a.count >= 5;
}
function recordFail(ip) {
    const a = attempts.get(ip);
    if (!a || a.resetAt < Date.now()) attempts.set(ip, { count: 1, resetAt: Date.now() + 15 * 60 * 1000 });
    else a.count++;
}

// ---------- Helpers ----------
function sendJson(res, code, obj, extraHeaders) {
    res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, extraHeaders || {}));
    res.end(JSON.stringify(obj));
}

function readBody(req, res, cb) {
    let body = '';
    let tooBig = false;
    req.on('data', function (c) {
        body += c;
        if (body.length > 10000) { tooBig = true; req.destroy(); }
    });
    req.on('end', function () {
        if (tooBig) return;
        try { cb(body ? JSON.parse(body) : {}); }
        catch (e) { sendJson(res, 400, { error: 'Bad request' }); }
    });
}

function requireAdmin(req, res) {
    if (!isAdmin(req)) {
        sendJson(res, 401, { error: 'Admin login required' });
        return false;
    }
    return true;
}

function clampLevel(n) {
    n = Math.round(Number(n));
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(100, n));
}

// ---------- API ----------
function handleApi(req, res) {
    const url = req.url.split('?')[0];

    if (req.method === 'GET' && url === '/api/state') {
        return sendJson(res, 200, { state, history, admin: isAdmin(req) });
    }

    if (req.method === 'GET' && url === '/api/me') {
        return sendJson(res, 200, { admin: isAdmin(req) });
    }

    if (req.method === 'POST' && url === '/api/login') {
        const ip = clientIp(req);
        if (isBlocked(ip)) return sendJson(res, 429, { error: 'Too many attempts. Try again in 15 minutes.' });

        return readBody(req, res, function (body) {
            const okUser = safeEqual(body.username || '', ADMIN_USER);
            const okPass = safeEqual(body.password || '', ADMIN_PASS);
            if (okUser && okPass) {
                attempts.delete(ip);
                const token = makeToken();
                const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
                return sendJson(res, 200, { ok: true }, {
                    'Set-Cookie': 'session=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + (SESSION_MS / 1000) + secure
                });
            }
            recordFail(ip);
            sendJson(res, 401, { error: 'Incorrect credentials.' });
        });
    }

    if (req.method === 'POST' && url === '/api/logout') {
        const token = getToken(req);
        if (token) revoked.add(token);
        return sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
    }

    // ---- Admin-only na mga route ----
    if (req.method === 'POST' && url === '/api/collect') {
        if (!requireAdmin(req, res)) return;
        return readBody(req, res, function (body) {
            const type = body.type;
            if (['Bio', 'Non-Bio', 'Both'].indexOf(type) === -1) return sendJson(res, 400, { error: 'Invalid type' });
            let collected = false;

            if ((type === 'Bio' || type === 'Both') && state.bio > 0) {
                const items = Math.round(state.bio / ITEM_PERCENT);
                state.collectedBio += items;
                logEntry('Biodegradable', 'Collected (' + state.bio + '% \u2192 0%, ' + items + ' items)', 'tag-collected');
                state.bio = 0;
                collected = true;
            }
            if ((type === 'Non-Bio' || type === 'Both') && state.nonBio > 0) {
                const items = Math.round(state.nonBio / ITEM_PERCENT);
                state.collectedNonBio += items;
                logEntry('Non-biodegradable', 'Collected (' + state.nonBio + '% \u2192 0%, ' + items + ' items)', 'tag-collected');
                state.nonBio = 0;
                collected = true;
            }
            if (collected) saveData();
            sendJson(res, 200, { collected, state, history });
        });
    }

    if (req.method === 'POST' && url === '/api/set-levels') {
        if (!requireAdmin(req, res)) return;
        return readBody(req, res, function (body) {
            if (body.bio !== undefined) state.bio = clampLevel(body.bio);
            if (body.nonBio !== undefined) state.nonBio = clampLevel(body.nonBio);
            saveData();
            sendJson(res, 200, { state, history });
        });
    }

    if (req.method === 'POST' && url === '/api/simulate') {
        if (!requireAdmin(req, res)) return;
        return readBody(req, res, function (body) {
            const category = body.category;
            if (['Biodegradable', 'Non-biodegradable'].indexOf(category) === -1) return sendJson(res, 400, { error: 'Invalid category' });
            const isBio = category === 'Biodegradable';
            const current = isBio ? state.bio : state.nonBio;

            if (current >= 100) {
                logEntry(category, 'Bin full \u2013 item not accepted', 'tag-full');
            } else {
                const newLevel = Math.min(100, current + ITEM_PERCENT);
                if (isBio) state.bio = newLevel; else state.nonBio = newLevel;
                logEntry(category, 'Sorted automatically', 'tag-sorted');
                state.lastSeg = category + ' \u2022 ' + new Date().toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila' });
            }
            saveData();
            sendJson(res, 200, { state, history });
        });
    }

    if (req.method === 'POST' && url === '/api/clear') {
        if (!requireAdmin(req, res)) return;
        history = [];
        nextId = 1;
        state.collectedBio = 0;
        state.collectedNonBio = 0;
        state.lastSeg = 'None yet';
        saveData();
        return sendJson(res, 200, { state, history });
    }

    sendJson(res, 404, { error: 'Not found' });
}

// ---------- Static files (public/ lang) ----------
function handleStatic(req, res) {
    let urlPath;
    try { urlPath = decodeURIComponent(req.url.split('?')[0]); }
    catch (e) { res.writeHead(400); return res.end('Bad request'); }

    const rel = urlPath === '/' ? 'index.html' : urlPath;
    const filePath = path.join(publicDir, rel);

    if (filePath !== publicDir && filePath.indexOf(publicDir + path.sep) !== 0) {
        res.writeHead(403);
        return res.end('Forbidden');
    }

    fs.readFile(filePath, function (err, data) {
        if (err) {
            res.writeHead(404);
            return res.end('Not found');
        }
        res.writeHead(200, { 'Content-Type': types[path.extname(filePath)] || 'application/octet-stream' });
        res.end(data);
    });
}

const server = http.createServer(function (req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');

    if (req.url.indexOf('/api/') === 0) return handleApi(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('Method not allowed'); }
    handleStatic(req, res);
});

// I-load muna ang data mula sa database bago tumanggap ng requests
loadData()
    .then(function () {
        server.listen(PORT, function () {
            console.log('Running at http://localhost:' + PORT);
        });
    })
    .catch(function (e) {
        console.error('Database error:', e.message);
        process.exit(1);
    });
