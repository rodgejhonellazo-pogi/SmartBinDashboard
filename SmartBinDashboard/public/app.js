// @ts-nocheck
// Front-end na ito: taga-display lang. Ang server na ang may hawak ng data at ng admin login.

let wasteHistory = [];
let state = { bio: 0, nonBio: 0, collectedBio: 0, collectedNonBio: 0, lastSeg: 'None yet' };
let currentRole = 'staff';
let lastLocalEdit = 0;
let sliderTimer = null;

function el(id) { return document.getElementById(id); }
function inputEl(id) { return document.getElementById(id); }

// ---------- API helper ----------
async function api(method, url, body) {
    try {
        const res = await fetch(url, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
            credentials: 'same-origin'
        });
        let data = null;
        try { data = await res.json(); } catch (e) { }
        return { ok: res.ok, status: res.status, data: data };
    } catch (e) {
        return { ok: false, status: 0, data: null };
    }
}

function applyServerData(data) {
    if (!data) return;
    if (data.state) state = data.state;
    if (data.history) wasteHistory = data.history;
    render();
}

async function loadState() {
    const r = await api('GET', '/api/state');
    if (r.ok) applyServerData(r.data);
}

// Kapag nag-expire ang session o hindi admin
function handleUnauthorized() {
    applyRole(false);
    alert('Session expired. Mag-login ulit bilang admin.');
    switchView('login');
}

function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(function (v) { v.classList.remove('active'); });
    const targetView = document.getElementById(viewName + '-view');
    if (targetView) targetView.classList.add('active');
    else console.error('View not found: ' + viewName);
}

function getStatus(level) {
    if (level >= 100) return { text: 'Full \u2013 collect now!', color: '#c62828' };
    if (level >= 80) return { text: 'Almost full \u2013 collect soon', color: '#ef6c00' };
    if (level >= 50) return { text: 'Getting full', color: '#f9a825' };
    return { text: 'Plenty of space', color: '#4caf50' };
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

function render() {
    const bins = [
        { level: state.bio, txt: 'txtBioCap', status: 'statusBio', fill: 'fillBio', slider: 'simBio', sliderVal: 'simBioVal' },
        { level: state.nonBio, txt: 'txtNonBioCap', status: 'statusNonBio', fill: 'fillNonBio', slider: 'simNonBio', sliderVal: 'simNonBioVal' }
    ];

    bins.forEach(function (b) {
        const s = getStatus(b.level);
        el(b.txt).innerText = b.level + '%';
        el(b.status).innerText = s.text;
        el(b.status).style.color = s.color;
        el(b.fill).style.height = b.level + '%';
        el(b.fill).style.backgroundColor = s.color;
        inputEl(b.slider).value = String(b.level);
        el(b.sliderVal).innerText = String(b.level);
    });

    el('countBio').innerText = String(state.collectedBio);
    el('countNonBio').innerText = String(state.collectedNonBio);
    el('txtLastSeg').innerText = state.lastSeg;
    renderHistory();
}

function renderHistory() {
    const tbody = el('history-logs');
    if (wasteHistory.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:#9ca3af;">No items logged yet.</td></tr>';
        return;
    }
    tbody.innerHTML = wasteHistory.slice().reverse().map(function (h) {
        return '<tr><td>' + h.id + '</td><td>' + escapeHtml(h.timestamp) + '</td><td>' + escapeHtml(h.category) +
            '</td><td><span class="tag ' + escapeHtml(h.tag) + '">' + escapeHtml(h.status) + '</span></td></tr>';
    }).join('');
}

// ---------- Admin actions (server ang nagve-verify) ----------
async function adminCall(url, body) {
    const r = await api('POST', url, body);
    if (r.status === 401) { handleUnauthorized(); return null; }
    if (!r.ok) { alert('May error. Subukan ulit.'); return null; }
    applyServerData(r.data);
    return r.data;
}

async function collectBin(categoryType) {
    const data = await adminCall('/api/collect', { type: categoryType });
    if (data && !data.collected) alert('Walang laman ang napiling bin. Wala pang ico-collect.');
}

function setBothLevels(level) {
    lastLocalEdit = Date.now();
    adminCall('/api/set-levels', { bio: level, nonBio: level });
}

function simulateItem(category) {
    adminCall('/api/simulate', { category: category });
}

function clearHistory() {
    if (!confirm('Sigurado ka bang buburahin ang lahat ng history at collected counters?')) return;
    adminCall('/api/clear');
}

function applyRole(isAdmin) {
    currentRole = isAdmin ? 'admin' : 'staff';
    el('admin-panel').style.display = isAdmin ? 'block' : 'none';
    el('sim-panel').style.display = isAdmin ? 'block' : 'none';
    el('role-badge').innerText = isAdmin ? 'Admin' : 'Staff view';
}

async function enterStaffView() {
    applyRole(false);
    await loadState();
    switchView('dashboard');
}

document.addEventListener('DOMContentLoaded', function () {

    el('btnEnterStaff').addEventListener('click', enterStaffView);
    el('btnStaffViewFromLogin').addEventListener('click', enterStaffView);

    el('btnGoToLogin').addEventListener('click', function () { switchView('login'); });
    el('btnCancelLogin').addEventListener('click', function () { switchView('portal'); });

    el('btnExitView').addEventListener('click', async function () {
        if (currentRole === 'admin') await api('POST', '/api/logout');
        applyRole(false);
        switchView('portal');
    });

    // TUNAY na login: ang server ang nagche-check ng username at password
    async function submitLogin() {
        const userField = inputEl('username');
        const passField = inputEl('password');
        const errLabel = el('login-error');
        const btn = el('btnSubmitLogin');

        btn.disabled = true;
        const r = await api('POST', '/api/login', {
            username: userField.value.trim(),
            password: passField.value
        });
        btn.disabled = false;

        if (r.ok) {
            errLabel.style.display = 'none';
            passField.value = '';
            applyRole(true);
            await loadState();
            switchView('dashboard');
        } else {
            errLabel.innerText = (r.data && r.data.error) ? r.data.error : 'Incorrect credentials.';
            errLabel.style.display = 'block';
            passField.value = '';
        }
    }

    el('btnSubmitLogin').addEventListener('click', submitLogin);
    inputEl('password').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submitLogin();
    });

    // Sliders ng simulation (admin lang; may debounce)
    function sliderChanged() {
        lastLocalEdit = Date.now();
        const bio = Number(inputEl('simBio').value);
        const nonBio = Number(inputEl('simNonBio').value);
        state.bio = bio;
        state.nonBio = nonBio;
        render();
        clearTimeout(sliderTimer);
        sliderTimer = setTimeout(function () {
            adminCall('/api/set-levels', { bio: bio, nonBio: nonBio });
        }, 250);
    }
    inputEl('simBio').addEventListener('input', sliderChanged);
    inputEl('simNonBio').addEventListener('input', sliderChanged);

    // Auto-refresh para makita ng staff ang live na bin levels
    setInterval(function () {
        if (!el('dashboard-view').classList.contains('active')) return;
        if (Date.now() - lastLocalEdit < 2000) return;
        loadState();
    }, 5000);

    // Pag-reload: kung naka-login pa ang admin, diretso sa dashboard
    (async function () {
        const r = await api('GET', '/api/me');
        if (r.ok && r.data && r.data.admin) {
            applyRole(true);
            await loadState();
            switchView('dashboard');
        } else {
            applyRole(false);
            loadState();
        }
    })();
});
