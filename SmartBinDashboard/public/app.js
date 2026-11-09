// @ts-nocheck
// Plain JavaScript lang ito. Pinatay ang type-checking ng Visual Studio para walang false errors.

/** @typedef {{id: number, timestamp: string, category: string, status: string, tag: string}} WasteItem */

/** @type {WasteItem[]} */
let wasteHistory = [];
let nextId = 1;
let currentRole = 'staff';

// Estado ng mga bin (percent) at bilang ng na-collect na items
const state = { bio: 0, nonBio: 0, collectedBio: 0, collectedNonBio: 0, lastSeg: 'None yet' };

// Ilang % ang dagdag ng bawat item na na-segregate
const ITEM_PERCENT = 5;

/** @param {string} id @returns {HTMLElement} */
function el(id) {
    return /** @type {HTMLElement} */ (document.getElementById(id));
}

/** @param {string} id @returns {HTMLInputElement} */
function inputEl(id) {
    return /** @type {HTMLInputElement} */ (document.getElementById(id));
}

/** @param {string} viewName */
function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(function (v) {
        v.classList.remove('active');
    });

    const targetView = document.getElementById(viewName + '-view');
    if (targetView) {
        targetView.classList.add('active');
    } else {
        console.error("View not found: " + viewName);
    }
}

// Status text at kulay depende sa level
/** @param {number} level */
function getStatus(level) {
    if (level >= 100) return { text: 'Full – collect now!', color: '#c62828' };
    if (level >= 80) return { text: 'Almost full – collect soon', color: '#ef6c00' };
    if (level >= 50) return { text: 'Getting full', color: '#f9a825' };
    return { text: 'Plenty of space', color: '#4caf50' };
}

// I-update lahat ng nakikita sa dashboard
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
    // Pinakabago sa itaas
    tbody.innerHTML = wasteHistory.slice().reverse().map(function (h) {
        return '<tr><td>' + h.id + '</td><td>' + h.timestamp + '</td><td>' + h.category +
            '</td><td><span class="tag ' + h.tag + '">' + h.status + '</span></td></tr>';
    }).join('');
}

/**
 * @param {string} category
 * @param {string} status
 * @param {string} tag
 */
function logEntry(category, status, tag) {
    wasteHistory.push({
        id: nextId++,
        timestamp: new Date().toLocaleString(),
        category: category,
        status: status,
        tag: tag
    });
}

// ADMIN: mag-collect ng bin
/** @param {string} categoryType */
function collectBin(categoryType) {
    let collectedSomething = false;

    if (categoryType === 'Bio' || categoryType === 'Both') {
        if (state.bio > 0) {
            const items = Math.round(state.bio / ITEM_PERCENT);
            state.collectedBio += items;
            logEntry('Biodegradable', 'Collected (' + state.bio + '% → 0%, ' + items + ' items)', 'tag-collected');
            state.bio = 0;
            collectedSomething = true;
        }
    }
    if (categoryType === 'Non-Bio' || categoryType === 'Both') {
        if (state.nonBio > 0) {
            const items = Math.round(state.nonBio / ITEM_PERCENT);
            state.collectedNonBio += items;
            logEntry('Non-biodegradable', 'Collected (' + state.nonBio + '% → 0%, ' + items + ' items)', 'tag-collected');
            state.nonBio = 0;
            collectedSomething = true;
        }
    }

    if (!collectedSomething) {
        alert('Walang laman ang napiling bin. Wala pang ico-collect.');
    }
    render();
}

// SIMULATION: i-set ang level ng dalawang bin
/** @param {number} level */
function setBothLevels(level) {
    state.bio = level;
    state.nonBio = level;
    render();
}

// SIMULATION: may bagong basurang na-segregate ng AI
/** @param {string} category */
function simulateItem(category) {
    const isBio = category === 'Biodegradable';
    const current = isBio ? state.bio : state.nonBio;

    if (current >= 100) {
        logEntry(category, 'Bin full – item not accepted', 'tag-full');
    } else {
        const newLevel = Math.min(100, current + ITEM_PERCENT);
        if (isBio) state.bio = newLevel; else state.nonBio = newLevel;
        logEntry(category, 'Sorted automatically', 'tag-sorted');
        state.lastSeg = category + ' • ' + new Date().toLocaleTimeString();
    }
    render();
}

function clearHistory() {
    if (!confirm('Sigurado ka bang buburahin ang lahat ng history at collected counters?')) {
        return;
    }
    wasteHistory = [];
    nextId = 1;
    state.collectedBio = 0;
    state.collectedNonBio = 0;
    state.lastSeg = 'None yet';
    render();
}

// Ipakita/itago ang admin-only panels
/** @param {boolean} isAdmin */
function applyRole(isAdmin) {
    currentRole = isAdmin ? 'admin' : 'staff';
    el('admin-panel').style.display = isAdmin ? 'block' : 'none';
    el('sim-panel').style.display = isAdmin ? 'block' : 'none';
    el('role-badge').innerText = isAdmin ? 'Admin' : 'Staff view';
}

function enterStaffView() {
    applyRole(false);
    render();
    switchView('dashboard');
}

document.addEventListener("DOMContentLoaded", function () {

    el('btnEnterStaff').addEventListener('click', enterStaffView);
    el('btnStaffViewFromLogin').addEventListener('click', enterStaffView);

    el('btnGoToLogin').addEventListener('click', function () {
        switchView('login');
    });

    el('btnCancelLogin').addEventListener('click', function () {
        switchView('portal');
    });

    el('btnExitView').addEventListener('click', function () {
        switchView('portal');
    });

    // Admin login (dummy check: may username at password na 4+ characters)
    el('btnSubmitLogin').addEventListener('click', function () {
        const userField = inputEl('username');
        const passField = inputEl('password');
        const errLabel = el('login-error');

        if (userField.value.trim() !== "" && passField.value.length >= 4) {
            errLabel.style.display = 'none';
            applyRole(true);
            render();
            switchView('dashboard');
        } else {
            errLabel.style.display = 'block';
        }
    });

    // Sliders ng simulation: live ang update
    inputEl('simBio').addEventListener('input', function () {
        state.bio = Number(inputEl('simBio').value);
        render();
    });
    inputEl('simNonBio').addEventListener('input', function () {
        state.nonBio = Number(inputEl('simNonBio').value);
        render();
    });

    render();
});

// Establish real-time communication line with the Node.js server
const socket = io();

// Listen to the live 'trashDetected' event broadcasted by the ESP32-CAM AI system
socket.on('trashDetected', (data) => {
    console.log("[LIVE DATA] Waste item detected by AI:", data);

    // Dynamic UI Notifications (Professional Theme)
    if (data.type === 'biodegradable') {
        alert(`Notification: A biodegradable item was successfully processed at ${data.timestamp}`);

        // OPTIONAL: If you have an HTML counter element, update it here:
        // const bioCounter = document.getElementById('bio-count-element');
        // if (bioCounter) bioCounter.innerText = parseInt(bioCounter.innerText) + 1;

    } else if (data.type === 'non_biodegradable') {
        alert(`Notification: A non-biodegradable item was successfully processed at ${data.timestamp}`);

        // OPTIONAL: If you have an HTML counter element, update it here:
        // const nonBioCounter = document.getElementById('non-bio-count-element');
        // if (nonBioCounter) nonBioCounter.innerText = parseInt(nonBioCounter.innerText) + 1;
    }

    // EXCLUSIVE SUGGESTION FOR THESIS CHARTS:
    // If you are using Chart.js on your dashboard, you can trigger a live redraw function here:
    // if (typeof updateDashboardCharts === 'function') { updateDashboardCharts(data.type); }
});
