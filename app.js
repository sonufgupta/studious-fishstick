/* ==========================================
   G - SERVICE CENTER CLIENT LOGIC ENGINE
   ========================================== */

// Global Application State
let state = {
    products: [],
    inwords: [],
    dispatches: [],
    replacements: [],
    couriers: [],
    audits: [],
    pendingAudits: []
};

// Temporary forms states
let tempInwordSerials = [];
let tempDispatchSerials = [];
let tempEditInwordSerials = [];
let activeEditingInwordIndex = null;
let activeAuditProduct = null;
let expectedAuditSerials = [];
let verifiedAuditSerials = [];

// Courier Modal settings state
let defaultCouriersList = ["DHL Express", "FedEx", "Blue Dart", "DTDC Courier", "Professional Courier", "Delhivery"];

// Scanner Modal State
let scannerActiveInput = null;
let currentScannedCode = "";

// Chart references for live updates
let categoryPieChartInstance = null;

// Audio context for synthesizer sound effects
let audioCtx = null;

function playSound(type) {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        
        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        if (type === 'beep') {
            osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
            gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
            osc.start();
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.15);
            osc.stop(audioCtx.currentTime + 0.15);
        } else if (type === 'success') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
            osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1); // E5
            osc.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2); // G5
            gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
            osc.start();
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.45);
            osc.stop(audioCtx.currentTime + 0.5);
        } else if (type === 'error') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(120, audioCtx.currentTime);
            gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
            osc.start();
            gainNode.gain.exponentialRampToValueAtTime(0.00001, audioCtx.currentTime + 0.3);
            osc.stop(audioCtx.currentTime + 0.35);
        }
    } catch (e) {
        console.warn("Audio Context blocked or not supported:", e);
    }
}

/* ==========================================
   1. REAL-TIME CLOCK & PASSCODE SECURITY
   ========================================== */
function initClock() {
    function updateClock() {
        const now = new Date();
        
        const hrs = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');
        const secs = String(now.getSeconds()).padStart(2, '0');
        const timeStr = `${hrs}:${mins}:${secs}`;
        
        const options = { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' };
        const dateStr = now.toLocaleDateString('en-US', options);
        
        const loginTime = document.getElementById('login-clock-time');
        const loginDate = document.getElementById('login-clock-date');
        const appClock = document.getElementById('app-clock-display');
        
        if (loginTime) loginTime.textContent = timeStr;
        if (loginDate) loginDate.textContent = dateStr;
        if (appClock) appClock.textContent = timeStr;
    }
    
    updateClock();
    setInterval(updateClock, 1000);
}

// Global Reusable Passcode Authenticator Check
function authenticateAction(promptMsg) {
    const passcode = prompt(promptMsg);
    if (!passcode) return false;
    
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const expectedPasscode = `${currentHour}-${currentMin}`;
    
    const cleanedInput = passcode.trim().replace(/[:]/g, '-');
    
    // Support time, backdoor codes, and direct bypasses for testing
    if (cleanedInput === expectedPasscode || 
        cleanedInput === `${currentHour}${currentMin}` ||
        passcode === "admin" || 
        passcode === "99-99" || 
        passcode === "12-34") {
        return true;
    }
    return false;
}

function handleLogin(e) {
    e.preventDefault();
    const inputPasscode = document.getElementById('login-passcode').value.trim();
    
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    
    if (authenticateActionCheckDirect(inputPasscode)) {
        playSound('success');
        showToast("Access Granted", "Operations console unlocked successfully.", "success");
        sessionStorage.setItem('g_service_session', 'active');
        
        const loginView = document.getElementById('login-view');
        const appView = document.getElementById('app-view');
        
        loginView.style.opacity = '0';
        setTimeout(() => {
            loginView.style.display = 'none';
            appView.style.display = 'block';
            setTimeout(() => {
                appView.style.opacity = '1';
                lucide.createIcons();
                refreshAllViews();
            }, 50);
        }, 500);
    } else {
        playSound('error');
        showToast("Invalid Passcode", `Incorrect password. Hint: Time is currently ${currentHour}-${currentMin}.`, "error");
        document.getElementById('login-passcode').focus();
    }
}

function authenticateActionCheckDirect(inputPasscode) {
    const now = new Date();
    const currentHour = String(now.getHours()).padStart(2, '0');
    const currentMin = String(now.getMinutes()).padStart(2, '0');
    const expectedPasscode = `${currentHour}-${currentMin}`;
    const cleanedInput = inputPasscode.trim().replace(/[:]/g, '-');
    return (cleanedInput === expectedPasscode || 
            cleanedInput === `${currentHour}${currentMin}` ||
            inputPasscode === "admin" || 
            inputPasscode === "99-99" || 
            inputPasscode === "12-34");
}

function handleLogout() {
    sessionStorage.removeItem('g_service_session');
    playSound('beep');
    
    const loginView = document.getElementById('login-view');
    const appView = document.getElementById('app-view');
    
    appView.style.opacity = '0';
    setTimeout(() => {
        appView.style.display = 'none';
        loginView.style.display = 'flex';
        setTimeout(() => {
            loginView.style.opacity = '1';
            document.getElementById('login-passcode').value = "";
        }, 50);
    }, 500);
}

function checkActiveSession() {
    if (sessionStorage.getItem('g_service_session') === 'active') {
        document.getElementById('login-view').style.display = 'none';
        const appView = document.getElementById('app-view');
        appView.style.display = 'block';
        appView.style.opacity = '1';
        setTimeout(() => {
            lucide.createIcons();
            refreshAllViews();
        }, 100);
    }
}


/* ==========================================
   2. DATABASE & STORAGE MANAGEMENT
   ========================================== */
function initDatabase() {
    // One-time total system wipe as requested by user to clear all mock entries
    if (!localStorage.getItem('g_cleared_v2')) {
        localStorage.setItem('g_products', JSON.stringify([]));
        localStorage.setItem('g_inwords', JSON.stringify([]));
        localStorage.setItem('g_dispatches', JSON.stringify([]));
        localStorage.setItem('g_replacements', JSON.stringify([]));
        localStorage.setItem('g_couriers', JSON.stringify(defaultCouriersList));
        localStorage.setItem('g_cleared_v2', 'true');
    }
    
    if (!localStorage.getItem('g_products')) {
        localStorage.setItem('g_products', JSON.stringify([]));
    }
    if (!localStorage.getItem('g_inwords')) {
        localStorage.setItem('g_inwords', JSON.stringify([]));
    }
    if (!localStorage.getItem('g_dispatches')) {
        localStorage.setItem('g_dispatches', JSON.stringify([]));
    }
    if (!localStorage.getItem('g_replacements')) {
        localStorage.setItem('g_replacements', JSON.stringify([]));
    }
    if (!localStorage.getItem('g_couriers')) {
        localStorage.setItem('g_couriers', JSON.stringify(defaultCouriersList));
    }
    
    if (!localStorage.getItem('g_audits')) {
        localStorage.setItem('g_audits', JSON.stringify([]));
    }
    if (!localStorage.getItem('g_pending_audits')) {
        localStorage.setItem('g_pending_audits', JSON.stringify([]));
    }
    
    loadStateFromStorage();
}

function loadStateFromStorage() {
    // 1. Load locally first as a super-fast instant cache
    loadStateFromLocalStorageOnly();
    
    // 2. Fetch fresh global state from server asynchronously
    fetch('/api/state')
        .then(response => {
            if (!response.ok) throw new Error();
            return response.json();
        })
        .then(serverData => {
            // Reconcile and assign state
            // One-time automatic migration: if network server is empty but browser has local data, push to server!
            const localProducts = JSON.parse(localStorage.getItem('g_products')) || [];
            if ((!serverData.products || serverData.products.length === 0) && localProducts.length > 0) {
                loadStateFromLocalStorageOnly();
                saveStateToStorage();
                return;
            }
            
            state.products = serverData.products || [];
            state.inwords = serverData.inwords || [];
            state.dispatches = serverData.dispatches || [];
            state.replacements = serverData.replacements || [];
            state.couriers = serverData.couriers || [];
            state.audits = serverData.audits || [];
            state.pendingAudits = serverData.pendingAudits || [];
            
            // Enforce structure
            state.products.forEach(p => {
                p.serials = p.serials || [];
                p.stock = p.serials.length;
            });
            
            // Update local cache
            saveStateToLocalStorageOnly();
            
            // Redraw views with server data
            refreshAllViewsUIOnly();
        })
        .catch(() => {
            // Keep local data if offline
        });
}

function loadStateFromLocalStorageOnly() {
    state.products = JSON.parse(localStorage.getItem('g_products')) || [];
    state.inwords = JSON.parse(localStorage.getItem('g_inwords')) || [];
    state.dispatches = JSON.parse(localStorage.getItem('g_dispatches')) || [];
    state.replacements = JSON.parse(localStorage.getItem('g_replacements')) || [];
    state.couriers = JSON.parse(localStorage.getItem('g_couriers')) || [];
    state.audits = JSON.parse(localStorage.getItem('g_audits')) || [];
    state.pendingAudits = JSON.parse(localStorage.getItem('g_pending_audits')) || [];
    
    // Enforce Serialization mapping structures
    state.products.forEach(p => {
        p.serials = p.serials || [];
        p.stock = p.serials.length; // Stock level ALWAYS matches active serial numbers count!
    });
}

function saveStateToStorage() {
    state.products.forEach(p => {
        p.stock = p.serials.length;
    });
    
    // 1. Save locally first
    saveStateToLocalStorageOnly();
    
    // 2. Sync to the shared database server
    fetch('/api/state', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(state)
    })
    .catch(err => console.warn("Failed to sync save with network server:", err));
}

function saveStateToLocalStorageOnly() {
    localStorage.setItem('g_products', JSON.stringify(state.products));
    localStorage.setItem('g_inwords', JSON.stringify(state.inwords));
    localStorage.setItem('g_dispatches', JSON.stringify(state.dispatches));
    localStorage.setItem('g_replacements', JSON.stringify(state.replacements));
    localStorage.setItem('g_couriers', JSON.stringify(state.couriers));
    localStorage.setItem('g_audits', JSON.stringify(state.audits));
    localStorage.setItem('g_pending_audits', JSON.stringify(state.pendingAudits));
}


/* ==========================================
   3. ROUTING & VIEWS NAVIGATION
   ========================================== */
const VIEW_METADATA = {
    home: { title: "Dashboard & Live Stock", desc: "Real-time status overview of active product stock." },
    inword: { title: "Inventory Inword Register", desc: "Form to register incoming courier invoices with serial scanning." },
    dispatch: { title: "Outbound Dispatch Centre", desc: "Dispatch serialized boxes and verify packing boxes with photos." },
    audit: { title: "Product Level Stock Audit", desc: "Reconcile expected stock by matching scanned serial numbers with system records." },
    replacement: { title: "Product Exchange & Replacement", desc: "Log returned serials and deduct fresh replacement stock instantly." },
    control: { title: "Database Control & Purge Centre", desc: "Selectively delete inventory catalogs, transactional history logs, or bulk wipe databases (Password: 2026)." }
};

function switchView(viewName) {
    document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
    document.querySelectorAll('.sidebar-menu-item').forEach(item => item.classList.remove('active'));
    
    const targetSec = document.getElementById(`view-${viewName}`);
    const targetMenu = document.getElementById(`menu-${viewName}`);
    
    if (targetSec && targetMenu) {
        targetSec.classList.add('active');
        targetMenu.classList.add('active');
        
        document.getElementById('current-view-title').textContent = VIEW_METADATA[viewName].title;
        document.getElementById('current-view-desc').textContent = VIEW_METADATA[viewName].desc;
        
        playSound('beep');
        toggleMobileSidebar(false);
        refreshAllViews();
    }
}

function refreshAllViews() {
    loadStateFromStorage();
    refreshAllViewsUIOnly();
}

function refreshAllViewsUIOnly() {
    populateProductDropdowns();
    populateCourierDropdowns();
    calculateDashboardStats();
    
    renderStockTable();
    renderInwordTable();
    renderDispatchTable();
    renderReplacementTable();
    renderAuditTable();
    renderPendingAuditsTable();
    
    // Refresh the Database Control selective tables
    renderControlProductsTable();
    renderControlLogsTable();
}


/* ==========================================
   4. HOME PAGE / LIVE STOCK CONTROLS
   ========================================== */
function calculateDashboardStats() {
    document.getElementById('stat-product-count').textContent = state.products.length;
    
    const stockTotal = state.products.reduce((acc, p) => acc + p.stock, 0);
    document.getElementById('stat-total-stock').textContent = stockTotal;
    
    const totalInword = state.inwords.reduce((acc, i) => acc + i.quantity, 0);
    document.getElementById('stat-total-inword').textContent = totalInword;
    
    const totalDispatch = state.dispatches.reduce((acc, d) => acc + d.quantity, 0);
    document.getElementById('stat-total-dispatch').textContent = totalDispatch;
    
    document.getElementById('stat-total-replacement').textContent = state.replacements.length;
}

function renderStockTable() {
    const tbody = document.getElementById('stock-table-body');
    tbody.innerHTML = "";
    
    state.products.forEach(p => {
        let statusBadge = "";
        if (p.stock === 0) {
            statusBadge = `<span class="badge b-red">Out of Stock</span>`;
        } else if (p.stock < 10) {
            statusBadge = `<span class="badge b-orange">Critical (${p.stock})</span>`;
        } else {
            statusBadge = `<span class="badge b-green">Healthy</span>`;
        }
        
        const totalIn = state.inwords
            .filter(i => i.product === p.name)
            .reduce((acc, i) => acc + i.quantity, 0);
            
        const totalOut = state.dispatches
            .filter(d => d.product === p.name)
            .reduce((acc, d) => acc + d.quantity, 0);
            
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-weight:600; color:#fff;" title="${p.serials.join(', ')}">${p.name}</td>
            <td style="font-family:var(--font-heading); font-size:16px; font-weight:700;">${p.stock} units</td>
            <td>${statusBadge}</td>
            <td style="color:var(--text-muted);">${totalIn} pcs</td>
            <td style="color:var(--text-muted);">${totalOut} pcs</td>
        `;
        tbody.appendChild(row);
    });
}

function filterStockTable() {
    const query = document.getElementById('stock-search').value.toLowerCase();
    const rows = document.querySelectorAll('#stock-table-body tr');
    
    rows.forEach(row => {
        const text = row.cells[0].textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}


/* ==========================================
   5. COURIER PARTNER DROPDOWN MANAGEMENT
   ========================================== */
function populateCourierDropdowns() {
    const inwordSelect = document.getElementById('inword-courier');
    const editSelect = document.getElementById('edit-inword-courier');
    
    const selects = [inwordSelect, editSelect];
    selects.forEach(select => {
        if (!select) return;
        const current = select.value;
        select.innerHTML = `<option value="" disabled selected>Select Courier Partner</option>`;
        
        state.couriers.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            select.appendChild(opt);
        });
        if (current) select.value = current;
    });
}

function openCourierManager() {
    document.getElementById('courier-modal').style.display = "flex";
    renderCourierManagerList();
    playSound('beep');
}

function closeCourierManager() {
    document.getElementById('courier-modal').style.display = "none";
}

function renderCourierManagerList() {
    const container = document.getElementById('courier-manager-list');
    container.innerHTML = "";
    
    state.couriers.forEach(c => {
        const div = document.createElement('div');
        div.className = "courier-manager-item";
        div.innerHTML = `
            <span>${c}</span>
            <button type="button" class="courier-delete-btn" onclick="deleteCourier('${c}')" title="Delete Courier">
                <i data-lucide="trash-2" style="width:16px; height:16px;"></i>
            </button>
        `;
        container.appendChild(div);
    });
    lucide.createIcons();
}

function addNewCourier() {
    const input = document.getElementById('new-courier-name');
    const name = input.value.trim();
    
    if (!name) {
        showToast("Invalid Input", "Please enter a courier partner name.", "warning");
        return;
    }
    
    if (state.couriers.some(c => c.toLowerCase() === name.toLowerCase())) {
        showToast("Already Registered", "This courier partner is already registered.", "warning");
        return;
    }
    
    state.couriers.push(name);
    saveStateToStorage();
    playSound('success');
    showToast("Courier Added", `"${name}" added successfully.`, "success");
    
    input.value = "";
    renderCourierManagerList();
    populateCourierDropdowns();
}

function deleteCourier(name) {
    state.couriers = state.couriers.filter(c => c !== name);
    saveStateToStorage();
    playSound('beep');
    showToast("Courier Deleted", `"${name}" removed successfully.`, "warning");
    
    renderCourierManagerList();
    populateCourierDropdowns();
}


/* ==========================================
   6. INVENTORY / INWORD LOGS (SERIALIZED)
   ========================================== */
function populateProductDropdowns() {
    const inwordSelect = document.getElementById('inword-product');
    const dispatchSelect = document.getElementById('dispatch-product');
    const replacementSelect = document.getElementById('replacement-product');
    const auditSelect = document.getElementById('audit-product');
    
    const selects = [inwordSelect, dispatchSelect, replacementSelect, auditSelect];
    selects.forEach(select => {
        if (!select) return;
        const current = select.value;
        select.innerHTML = `<option value="" disabled selected>Select Product Name</option>`;
        
        state.products.forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.name;
            opt.textContent = `${p.name} (Stock: ${p.stock})`;
            select.appendChild(opt);
        });
        if (current) select.value = current;
    });
}

function promptAddNewProduct() {
    // Password protection check!
    const verified = authenticateAction("Admin passcode verification required. Enter current time (HH-MM):");
    if (!verified) {
        playSound('error');
        showToast("Access Denied", "Incorrect passcode validation. Add product aborted.", "error");
        return;
    }
    
    const prodName = prompt("Enter the exact name of the NEW product catalog item:");
    if (!prodName) return;
    
    const trimmed = prodName.trim();
    if (trimmed.length < 3) {
        showToast("Invalid Name", "Product name must be at least 3 characters.", "error");
        return;
    }
    
    if (state.products.some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
        showToast("Product Exists", "This product is already registered.", "warning");
        return;
    }
    
    const newProduct = {
        id: "p_" + Date.now(),
        name: trimmed,
        stock: 0,
        serials: [],
        initialStock: 0
    };
    
    state.products.push(newProduct);
    saveStateToStorage();
    playSound('success');
    showToast("Product Registered", `"${trimmed}" is added to the catalogue list.`, "success");
    
    populateProductDropdowns();
    renderStockTable();
    document.getElementById('inword-product').value = trimmed;
}

// Inword Serials Chips adding logic
function addInwordSerial() {
    const input = document.getElementById('inword-serial');
    const serial = input.value.trim().toUpperCase();
    
    if (!serial) {
        showToast("Input Required", "Please enter or scan a serial number.", "warning");
        return;
    }
    
    if (tempInwordSerials.includes(serial)) {
        playSound('error');
        showToast("Duplicate Input", "This serial number is already in your active scanning list.", "warning");
        return;
    }
    
    let activeRegistered = false;
    let registeredProduct = "";
    state.products.forEach(p => {
        if (p.serials.includes(serial)) {
            activeRegistered = true;
            registeredProduct = p.name;
        }
    });
    
    if (activeRegistered) {
        playSound('error');
        showToast("Stock Collision", `Serial code matches active inventory inside "${registeredProduct}".`, "error");
        return;
    }
    
    tempInwordSerials.push(serial);
    input.value = "";
    playSound('beep');
    renderInwordSerialsChips();
}

function removeInwordSerial(serial) {
    tempInwordSerials = tempInwordSerials.filter(s => s !== serial);
    renderInwordSerialsChips();
    playSound('beep');
}

function renderInwordSerialsChips() {
    const container = document.getElementById('inword-serials-list');
    container.innerHTML = "";
    
    tempInwordSerials.forEach(s => {
        const chip = document.createElement('div');
        chip.className = "serial-chip";
        chip.innerHTML = `
            <span>${s}</span>
            <button type="button" class="remove-chip-btn" onclick="removeInwordSerial('${s}')">&times;</button>
        `;
        container.appendChild(chip);
    });
    
    const qtyBadge = document.getElementById('inword-qty-badge');
    qtyBadge.textContent = `${tempInwordSerials.length} Pieces`;
}

function clearInwordForm() {
    tempInwordSerials = [];
    renderInwordSerialsChips();
}

function submitInword(e) {
    e.preventDefault();
    
    const invoice = document.getElementById('inword-invoice').value.trim();
    const courier = document.getElementById('inword-courier').value;
    const awb = document.getElementById('inword-awb').value.trim();
    const productName = document.getElementById('inword-product').value;
    
    if (!courier || !productName) {
        showToast("Missing Selection", "Please make sure product name and courier are selected.", "warning");
        return;
    }
    
    if (tempInwordSerials.length === 0) {
        playSound('error');
        showToast("Serials Required", "Please scan or add at least one product serial number.", "error");
        return;
    }
    
    const product = state.products.find(p => p.name === productName);
    if (product) {
        product.serials.push(...tempInwordSerials);
        product.stock = product.serials.length;
    }
    
    const timestamp = new Date().toLocaleString();
    const inwordEntry = {
        timestamp,
        invoice,
        courier,
        awb,
        product: productName,
        quantity: tempInwordSerials.length,
        serials: [...tempInwordSerials]
    };
    
    state.inwords.unshift(inwordEntry);
    saveStateToStorage();
    playSound('success');
    showToast("Inword Recorded", `Invoice registered. +${tempInwordSerials.length} serialized units added to ${productName}.`, "success");
    
    document.getElementById('inword-form').reset();
    clearInwordForm();
    refreshAllViews();
}

function renderInwordTable() {
    const tbody = document.getElementById('inword-history-body');
    tbody.innerHTML = "";
    
    state.inwords.forEach((i, idx) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-size:11px; color:var(--text-dark);">${i.timestamp}</td>
            <td style="font-weight:600; color:#fff;">${i.invoice}</td>
            <td><span class="badge b-cyan">${i.courier}</span></td>
            <td style="font-family:var(--font-heading); font-size:12px;">${i.awb}</td>
            <td>${i.product}</td>
            <td style="font-weight:700; color:var(--cyan); font-family:var(--font-heading);">${i.quantity} pcs</td>
            <td style="font-size:12px; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; max-width:200px;" title="${i.serials.join(', ')}">
                ${i.serials.slice(0, 3).join(', ')}${i.serials.length > 3 ? '...' : ''}
            </td>
            <td style="text-align: center;">
                <div style="display:flex; justify-content:center; gap:8px;">
                    <button type="button" class="action-btn" onclick="editInwordLog(${idx})" title="Edit Log Entry" style="width:32px; height:32px;">
                        <i data-lucide="pencil" style="width:14px; height:14px; color:var(--cyan);"></i>
                    </button>
                    <button type="button" class="action-btn" onclick="deleteInwordLog(${idx})" title="Delete Log Entry" style="width:32px; height:32px;">
                        <i data-lucide="trash-2" style="width:14px; height:14px; color:var(--red);"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
    lucide.createIcons();
}

function filterInwordTable() {
    const query = document.getElementById('inword-search').value.toLowerCase();
    const rows = document.querySelectorAll('#inword-history-body tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}


/* ==========================================
   6.1 LOG EDITING & DELETING RECONCILIATIONS
   ========================================== */
function deleteInwordLog(index) {
    const verified = authenticateAction("Admin authentication required. Enter current passcode (HH-MM) to DELETE inword:");
    if (!verified) {
        playSound('error');
        showToast("Access Denied", "Incorrect passcode verification. Log deletion aborted.", "error");
        return;
    }
    
    loadStateFromStorage();
    const log = state.inwords[index];
    if (!log) return;
    
    const product = state.products.find(p => p.name === log.product);
    if (product) {
        product.serials = product.serials.filter(s => !log.serials.includes(s));
        product.stock = product.serials.length;
    }
    
    state.inwords.splice(index, 1);
    saveStateToStorage();
    playSound('beep');
    showToast("Log Deleted", `Inword log and stock serials deleted successfully.`, "warning");
    
    refreshAllViews();
}

function editInwordLog(index) {
    const verified = authenticateAction("Admin authentication required. Enter current passcode (HH-MM) to EDIT inword:");
    if (!verified) {
        playSound('error');
        showToast("Access Denied", "Incorrect passcode validation. Log editing aborted.", "error");
        return;
    }
    
    loadStateFromStorage();
    const log = state.inwords[index];
    if (!log) return;
    
    activeEditingInwordIndex = index;
    
    document.getElementById('edit-inword-modal').style.display = "flex";
    document.getElementById('edit-inword-invoice').value = log.invoice;
    document.getElementById('edit-inword-awb').value = log.awb;
    
    populateCourierDropdowns();
    document.getElementById('edit-inword-courier').value = log.courier;
    
    tempEditInwordSerials = [...log.serials];
    renderEditInwordSerialsChips();
    
    playSound('beep');
}

function closeEditInword() {
    document.getElementById('edit-inword-modal').style.display = "none";
    activeEditingInwordIndex = null;
    tempEditInwordSerials = [];
}

function addEditInwordSerial() {
    const input = document.getElementById('edit-inword-serial-scan');
    const serial = input.value.trim().toUpperCase();
    if (!serial) return;
    
    if (tempEditInwordSerials.includes(serial)) {
        showToast("Duplicate Input", "Serial already inside current edit list.", "warning");
        return;
    }
    
    let collision = false;
    let collidedProdName = "";
    state.products.forEach(p => {
        const originalInword = state.inwords[activeEditingInwordIndex];
        const isOriginalInwordSerial = originalInword && originalInword.serials.includes(serial);
        if (p.serials.includes(serial) && !isOriginalInwordSerial) {
            collision = true;
            collidedProdName = p.name;
        }
    });
    
    if (collision) {
        playSound('error');
        showToast("Stock Collision", `Serial code exists inside active stock inside "${collidedProdName}".`, "error");
        return;
    }
    
    tempEditInwordSerials.push(serial);
    input.value = "";
    renderEditInwordSerialsChips();
}

function removeEditInwordSerial(serial) {
    tempEditInwordSerials = tempEditInwordSerials.filter(s => s !== serial);
    renderEditInwordSerialsChips();
}

function renderEditInwordSerialsChips() {
    const container = document.getElementById('edit-inword-serials-list');
    container.innerHTML = "";
    
    tempEditInwordSerials.forEach(s => {
        const chip = document.createElement('div');
        chip.className = "serial-chip";
        chip.innerHTML = `
            <span>${s}</span>
            <button type="button" class="remove-chip-btn" onclick="removeEditInwordSerial('${s}')">&times;</button>
        `;
        container.appendChild(chip);
    });
    document.getElementById('edit-inword-qty-badge').textContent = `${tempEditInwordSerials.length} Pieces`;
}

function submitEditInword(e) {
    e.preventDefault();
    
    if (activeEditingInwordIndex === null) return;
    
    const invoice = document.getElementById('edit-inword-invoice').value.trim();
    const courier = document.getElementById('edit-inword-courier').value;
    const awb = document.getElementById('edit-inword-awb').value.trim();
    
    if (!courier) {
        showToast("Select Courier", "Please select a courier partner.", "warning");
        return;
    }
    
    if (tempEditInwordSerials.length === 0) {
        showToast("Serials Required", "Inword logs must contain at least 1 serial number.", "error");
        return;
    }
    
    loadStateFromStorage();
    const originalLog = state.inwords[activeEditingInwordIndex];
    const product = state.products.find(p => p.name === originalLog.product);
    
    if (product) {
        product.serials = product.serials.filter(s => !originalLog.serials.includes(s));
        product.serials.push(...tempEditInwordSerials);
        product.stock = product.serials.length;
    }
    
    originalLog.invoice = invoice;
    originalLog.courier = courier;
    originalLog.awb = awb;
    originalLog.serials = [...tempEditInwordSerials];
    originalLog.quantity = tempEditInwordSerials.length;
    
    saveStateToStorage();
    playSound('success');
    showToast("Changes Saved", "Inword invoice log and inventory stock serials updated.", "success");
    
    closeEditInword();
    refreshAllViews();
}


/* ==========================================
   7. OUTBOUND DISPATCH CONTROLS (SERIALIZED)
   ========================================== */
let packingPhotoBase64 = "";

function handleDispatchProductChange() {
    const productName = document.getElementById('dispatch-product').value;
    const badge = document.getElementById('dispatch-stock-badge');
    
    const product = state.products.find(p => p.name === productName);
    if (product) {
        badge.textContent = `Stock: ${product.stock}`;
        badge.className = product.stock === 0 ? "badge b-red" : (product.stock < 10 ? "badge b-orange" : "badge b-green");
    } else {
        badge.textContent = "Stock: 0";
        badge.className = "badge b-cyan";
    }
    
    tempDispatchSerials = [];
    renderDispatchSerialsChips();
}

function addDispatchSerial() {
    const productName = document.getElementById('dispatch-product').value;
    const input = document.getElementById('dispatch-serial-scan');
    const serial = input.value.trim().toUpperCase();
    
    if (!productName) {
        showToast("Select Product", "Please select a product name first.", "warning");
        return;
    }
    
    if (!serial) {
        showToast("Input Required", "Please enter or scan a serial number.", "warning");
        return;
    }
    
    if (tempDispatchSerials.includes(serial)) {
        showToast("Duplicate Scanning", "This serial number is already in your active scanning list.", "warning");
        return;
    }
    
    const product = state.products.find(p => p.name === productName);
    if (!product || !product.serials.includes(serial)) {
        playSound('error');
        showToast("Serial Missing", `Serial number "${serial}" is not present in stock for "${productName}".`, "error");
        return;
    }
    
    tempDispatchSerials.push(serial);
    input.value = "";
    playSound('beep');
    renderDispatchSerialsChips();
}

function removeDispatchSerial(serial) {
    tempDispatchSerials = tempDispatchSerials.filter(s => s !== serial);
    renderDispatchSerialsChips();
    playSound('beep');
}

function renderDispatchSerialsChips() {
    const container = document.getElementById('dispatch-serials-list');
    container.innerHTML = "";
    
    tempDispatchSerials.forEach(s => {
        const chip = document.createElement('div');
        chip.className = "serial-chip";
        chip.innerHTML = `
            <span>${s}</span>
            <button type="button" class="remove-chip-btn" onclick="removeDispatchSerial('${s}')">&times;</button>
        `;
        container.appendChild(chip);
    });
    
    const badge = document.getElementById('dispatch-qty-badge');
    badge.textContent = `${tempDispatchSerials.length} Pieces`;
}

function clearDispatchForm() {
    tempDispatchSerials = [];
    renderDispatchSerialsChips();
    removePhotoUpload();
}

function triggerPhotoUpload() {
    document.getElementById('dispatch-photo-file').click();
}

function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    if (file.size > 1.5 * 1024 * 1024) {
        showToast("File Too Large", "Please upload a photo smaller than 1.5 MB.", "warning");
        e.target.value = "";
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(evt) {
        packingPhotoBase64 = evt.target.result;
        
        const previewWrap = document.getElementById('dispatch-photo-preview-wrap');
        const previewImg = document.getElementById('dispatch-photo-preview');
        previewImg.src = packingPhotoBase64;
        previewWrap.style.display = "block";
        
        showToast("Photo Uploaded", "Box packing photo ready.", "success");
    };
    reader.readAsDataURL(file);
}

function removePhotoUpload() {
    packingPhotoBase64 = "";
    const fileInput = document.getElementById('dispatch-photo-file');
    if (fileInput) fileInput.value = "";
    
    const previewWrap = document.getElementById('dispatch-photo-preview-wrap');
    if (previewWrap) previewWrap.style.display = "none";
    
    const previewImg = document.getElementById('dispatch-photo-preview');
    if (previewImg) previewImg.src = "";
}

function submitDispatch(e) {
    e.preventDefault();
    
    const challan = document.getElementById('dispatch-challan').value.trim();
    const productName = document.getElementById('dispatch-product').value;
    
    if (!productName) {
        showToast("Product Required", "Please select a product item.", "warning");
        return;
    }
    
    if (tempDispatchSerials.length === 0) {
        playSound('error');
        showToast("Serials Required", "Please scan product serial numbers to dispatch.", "error");
        return;
    }
    
    const product = state.products.find(p => p.name === productName);
    if (!product || product.stock < tempDispatchSerials.length) {
        playSound('error');
        showToast("Stock Error", "Stock levels mismatch. Order aborted.", "error");
        return;
    }
    
    if (!packingPhotoBase64) {
        playSound('error');
        showToast("Photo Required", "Please upload packing photo verification.", "error");
        return;
    }
    
    product.serials = product.serials.filter(s => !tempDispatchSerials.includes(s));
    product.stock = product.serials.length;
    
    const timestamp = new Date().toLocaleString();
    const dispatchEntry = {
        timestamp,
        challan,
        product: productName,
        serials: [...tempDispatchSerials],
        quantity: tempDispatchSerials.length,
        photo: packingPhotoBase64
    };
    
    state.dispatches.unshift(dispatchEntry);
    saveStateToStorage();
    playSound('success');
    showToast("Dispatch Processed", `Shipped ${tempDispatchSerials.length} units of ${productName} (Stock Deducted).`, "success");
    
    document.getElementById('dispatch-form').reset();
    clearDispatchForm();
    refreshAllViews();
}

function renderDispatchTable() {
    const tbody = document.getElementById('dispatch-history-body');
    tbody.innerHTML = "";
    
    state.dispatches.forEach(d => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-size:11px; color:var(--text-dark);">${d.timestamp}</td>
            <td style="font-family:var(--font-heading); font-weight:600; color:#fff;">${d.challan}</td>
            <td>${d.product}</td>
            <td style="font-size:12px; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; max-width:200px;" title="${d.serials.join(', ')}">
                ${d.serials.slice(0, 3).join(', ')}${d.serials.length > 3 ? '...' : ''}
            </td>
            <td style="font-weight:700; color:var(--primary); font-family:var(--font-heading);">${d.quantity} pcs</td>
            <td>
                <img class="table-img-thumb" src="${d.photo}" onclick="enlargePhoto('${d.photo}')" alt="Box Photo">
            </td>
        `;
        tbody.appendChild(row);
    });
}

function filterDispatchTable() {
    const query = document.getElementById('dispatch-search').value.toLowerCase();
    const rows = document.querySelectorAll('#dispatch-history-body tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

function enlargePhoto(photoBase64) {
    const modal = document.getElementById('photo-modal');
    const modalImg = document.getElementById('enlarged-photo');
    const dlLink = document.getElementById('photo-download-link');
    
    modalImg.src = photoBase64;
    dlLink.href = photoBase64; 
    
    modal.style.display = "flex";
    playSound('beep');
}




/* ==========================================
   8. PRODUCT LEVEL RECONCILIATION AUDIT (SERIALIZED MATCH)
   ========================================== */
function handleAuditProductChange() {
    const productName = document.getElementById('audit-product').value;
    const verificationZone = document.getElementById('audit-verification-zone');
    const submitActions = document.getElementById('audit-submit-actions');
    const liveStockBadge = document.getElementById('audit-live-stock-badge');
    const serialsList = document.getElementById('audit-serials-list');
    
    const product = state.products.find(p => p.name === productName);
    if (!product) {
        verificationZone.style.display = "none";
        submitActions.style.display = "none";
        if (liveStockBadge) liveStockBadge.style.display = "none";
        return;
    }
    
    activeAuditProduct = product;
    expectedAuditSerials = [...product.serials];
    verifiedAuditSerials = [];
    
    if (liveStockBadge) {
        liveStockBadge.textContent = `Live Stock: ${product.stock}`;
        liveStockBadge.style.display = "inline-block";
    }
    
    verificationZone.style.display = "block";
    submitActions.style.display = "flex";
    
    // Reset inputs & list
    document.getElementById('audit-serial-scan').value = "";
    if (serialsList) serialsList.innerHTML = "";
    
    updateAuditVerificationProgress();
    
    playSound('beep');
}

function verifyAuditSerial() {
    const input = document.getElementById('audit-serial-scan');
    const serial = input.value.trim().toUpperCase();
    
    if (!serial) return;
    
    if (!expectedAuditSerials.includes(serial)) {
        playSound('error');
        showToast("Variance Alert", `Serial "${serial}" does not exist in stock database for this product!`, "error");
        return;
    }
    
    if (verifiedAuditSerials.includes(serial)) {
        showToast("Already Verified", "This serial code is already verified.", "warning");
        input.value = "";
        return;
    }
    
    verifiedAuditSerials.push(serial);
    input.value = "";
    playSound('success');
    showToast("Serial Verified", `Matched serial code "${serial}".`, "success");
    
    // Add verified chip to the list
    const serialsList = document.getElementById('audit-serials-list');
    if (serialsList) {
        const chip = document.createElement('div');
        chip.className = "serial-chip";
        chip.innerHTML = `
            <i data-lucide="check-circle"></i>
            <span>${serial}</span>
        `;
        serialsList.appendChild(chip);
        lucide.createIcons();
    }
    
    updateAuditVerificationProgress();
}

function updateAuditVerificationProgress() {
    const ratioBadge = document.getElementById('audit-progress-lbl');
    const submitBtn = document.getElementById('audit-submit-btn');
    const discrepancyBtn = document.getElementById('audit-discrepancy-btn');
    const verifiedLbl = document.getElementById('audit-verified-stock-lbl');
    const systemLbl = document.getElementById('audit-system-stock-lbl');
    
    const verifiedCount = verifiedAuditSerials.length;
    const totalExpected = expectedAuditSerials.length;
    
    if (verifiedLbl) verifiedLbl.textContent = verifiedCount;
    if (systemLbl) systemLbl.textContent = totalExpected;
    
    if (ratioBadge) {
        ratioBadge.textContent = `${verifiedCount} / ${totalExpected}`;
    }
    
    // Auto show submission actions based on match state
    if (verifiedCount === totalExpected && totalExpected > 0) {
        if (submitBtn) {
            submitBtn.style.display = "inline-flex";
            submitBtn.disabled = false;
        }
        if (discrepancyBtn) discrepancyBtn.style.display = "none";
        showToast("Stock Matched Perfectly", "All expected serials successfully verified. Close the ledger now.", "success");
    } else if (verifiedCount < totalExpected && totalExpected > 0) {
        if (submitBtn) {
            submitBtn.style.display = "none";
            submitBtn.disabled = true;
        }
        if (discrepancyBtn) discrepancyBtn.style.display = "inline-flex";
    } else {
        if (submitBtn) {
            submitBtn.style.display = "inline-flex";
            submitBtn.disabled = true;
        }
        if (discrepancyBtn) discrepancyBtn.style.display = "none";
    }
}

function submitAudit(e) {
    e.preventDefault();
    
    if (!activeAuditProduct) return;
    
    const systemStock = expectedAuditSerials.length;
    const physicalCount = verifiedAuditSerials.length;
    
    if (physicalCount !== systemStock) {
        showToast("Reconciliation Incomplete", "Cannot submit audit until all system serials are successfully scanned & matched.", "error");
        return;
    }
    
    const timestamp = new Date().toLocaleString();
    const auditEntry = {
        timestamp,
        product: activeAuditProduct.name,
        verifiedCount: physicalCount,
        systemCount: systemStock,
        variance: 0,
        status: "Balanced & Closed"
    };
    
    state.audits.unshift(auditEntry);
    saveStateToStorage();
    playSound('success');
    showToast("Audit Recorded", "System stock serials successfully balanced and verified.", "success");
    
    resetAuditModule();
    refreshAllViews();
}

function submitAuditWithRemark() {
    if (!activeAuditProduct) return;
    
    const systemStock = expectedAuditSerials.length;
    const physicalCount = verifiedAuditSerials.length;
    
    if (physicalCount >= systemStock) {
        showToast("Stock Balanced", "Please submit using the Audit Complete button.", "warning");
        return;
    }
    
    const remark = prompt("Product stock count is less. Please enter discrepancy remark (e.g. DAMAGE, MISSING, NOT FOUND):");
    if (remark === null) return; // User cancelled
    
    const trimmed = remark.trim();
    if (!trimmed) {
        showToast("Remark Required", "You must enter a remark to submit a discrepancy audit.", "warning");
        return;
    }
    
    const timestamp = new Date().toLocaleString();
    const variance = physicalCount - systemStock;
    const pendingEntry = {
        timestamp,
        product: activeAuditProduct.name,
        physicalCount: physicalCount,
        systemCount: systemStock,
        variance: variance,
        status: "Pending Admin Approval",
        reason: trimmed,
        verifiedSerials: [...verifiedAuditSerials]
    };
    
    state.pendingAudits.unshift(pendingEntry);
    saveStateToStorage();
    playSound('beep');
    showToast("Audit Pushed", `Pushed to Admin queue with remark: ${trimmed}.`, "warning");
    
    resetAuditModule();
    refreshAllViews();
}

function renderPendingAuditsTable() {
    const approvalsPanel = document.getElementById('admin-approvals-panel');
    const tbody = document.getElementById('pending-audits-body');
    if (!tbody || !approvalsPanel) return;
    tbody.innerHTML = "";
    
    if (state.pendingAudits.length === 0) {
        approvalsPanel.style.display = "none";
        return;
    }
    
    approvalsPanel.style.display = "block";
    state.pendingAudits.forEach((a, idx) => {
        let vBadge = a.variance === 0 ? "Balanced" : (a.variance > 0 ? `+${a.variance} Surplus` : `${a.variance} Shortage`);
        let vClass = a.variance === 0 ? "b-green" : (a.variance > 0 ? "b-cyan" : "b-red");
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-size:11px; color:var(--text-dark);">${a.timestamp}</td>
            <td style="font-weight:600; color:#fff;">${a.product}</td>
            <td style="font-weight:600; color:var(--cyan);">${a.physicalCount} units</td>
            <td>${a.systemCount} units</td>
            <td><span class="badge ${vClass}">${vBadge}</span></td>
            <td style="font-size:12px; color:var(--text-muted);">${a.reason}</td>
            <td style="text-align: center;">
                <div style="display: flex; gap: 8px; justify-content: center;">
                    <button type="button" class="btn btn-primary" onclick="approvePendingAudit(${idx})" style="padding:6px 12px; font-size:12px; background:linear-gradient(135deg, var(--green) 0%, #15803d 100%); border:none; box-shadow:0 0 10px rgba(34,197,94,0.2);">
                        <i data-lucide="check" style="width:12px; height:12px;"></i> Approve
                    </button>
                    <button type="button" class="btn btn-secondary" onclick="rejectPendingAudit(${idx})" style="padding:6px 12px; font-size:12px; border-color:rgba(244,63,94,0.25); color:var(--red);">
                        <i data-lucide="x" style="width:12px; height:12px;"></i> Reject
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
    lucide.createIcons();
}

function approvePendingAudit(index) {
    const password = prompt("Enter central admin passcode (2026) to APPROVE and reconcile stock:");
    if (!password) return;
    
    if (password !== "2026") {
        playSound('error');
        showToast("Access Denied", "Incorrect admin passcode.", "error");
        return;
    }
    
    loadStateFromStorage();
    const pending = state.pendingAudits[index];
    if (!pending) return;
    
    // Reconcile system serial database! Set active serials to exactly the verified scanned serials.
    // This adjusts the database stock count exactly down to the verified items, purging missing/damaged codes.
    const product = state.products.find(p => p.name === pending.product);
    if (product) {
        product.serials = pending.verifiedSerials || [];
        product.stock = product.serials.length;
    }
    
    const timestamp = new Date().toLocaleString();
    const approvedLog = {
        timestamp,
        product: pending.product,
        verifiedCount: pending.physicalCount,
        systemCount: pending.systemCount,
        variance: pending.variance,
        status: `Approved (${pending.reason})`
    };
    
    state.audits.unshift(approvedLog);
    state.pendingAudits.splice(index, 1);
    
    saveStateToStorage();
    playSound('success');
    showToast("Audit Approved", "System stock serials successfully reconciled and updated.", "success");
    
    refreshAllViews();
}

function rejectPendingAudit(index) {
    const password = prompt("Enter central admin passcode (2026) to REJECT this pending audit:");
    if (!password) return;
    
    if (password !== "2026") {
        playSound('error');
        showToast("Access Denied", "Incorrect admin passcode.", "error");
        return;
    }
    
    loadStateFromStorage();
    const pending = state.pendingAudits[index];
    if (!pending) return;
    
    // Simply reject and discard the pending log without modifying stock serials!
    state.pendingAudits.splice(index, 1);
    
    saveStateToStorage();
    playSound('beep');
    showToast("Audit Rejected", "Pending audit discrepancy discarded cleanly.", "warning");
    
    refreshAllViews();
}

function resetAuditModule() {
    document.getElementById('audit-form').reset();
    document.getElementById('audit-verification-zone').style.display = "none";
    document.getElementById('audit-submit-actions').style.display = "none";
    
    const discrepancyBtn = document.getElementById('audit-discrepancy-btn');
    if (discrepancyBtn) discrepancyBtn.style.display = "none";
    
    const liveStockBadge = document.getElementById('audit-live-stock-badge');
    if (liveStockBadge) liveStockBadge.style.display = "none";
    
    const serialsList = document.getElementById('audit-serials-list');
    if (serialsList) serialsList.innerHTML = "";
    
    activeAuditProduct = null;
    expectedAuditSerials = [];
    verifiedAuditSerials = [];
}

function renderAuditTable() {
    const tbody = document.getElementById('audit-history-body');
    if (!tbody) return;
    tbody.innerHTML = "";
    
    state.audits.forEach(a => {
        let vBadge = "";
        if (a.variance === 0) {
            vBadge = `<span class="badge b-green">Balanced</span>`;
        } else if (a.variance > 0) {
            vBadge = `<span class="badge b-cyan">+${a.variance} Surplus</span>`;
        } else {
            vBadge = `<span class="badge b-red">${a.variance} Shortage</span>`;
        }
        
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-size:11px; color:var(--text-dark);">${a.timestamp}</td>
            <td style="font-weight:600; color:#fff;">${a.product}</td>
            <td>${a.verifiedCount} units</td>
            <td>${a.systemCount} units</td>
            <td>${vBadge}</td>
            <td><span class="badge b-purple">${a.status}</span></td>
        `;
        tbody.appendChild(row);
    });
}

function filterAuditTable() {
    const query = document.getElementById('audit-search').value.toLowerCase();
    const rows = document.querySelectorAll('#audit-history-body tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}





/* ==========================================
   9. REPLACEMENT & LIVE EXCHANGE CONTROLS (SERIALIZED)
   ========================================== */
function updateReplacementMaxStock() {
    const productName = document.getElementById('replacement-product').value;
    const badge = document.getElementById('replacement-stock-badge');
    
    const product = state.products.find(p => p.name === productName);
    if (product) {
        badge.textContent = `Stock: ${product.stock}`;
        badge.className = product.stock === 0 ? "badge b-red" : (product.stock < 10 ? "badge b-orange" : "badge b-green");
    } else {
        badge.textContent = "Stock: 0";
        badge.className = "badge b-red";
    }
}

function submitReplacement(e) {
    e.preventDefault();
    
    const productName = document.getElementById('replacement-product').value;
    const oldSerial = document.getElementById('replacement-old-serial').value.trim().toUpperCase();
    const newSerial = document.getElementById('replacement-new-serial').value.trim().toUpperCase();
    
    if (!productName) {
        showToast("Product Required", "Please select a product for replacement.", "warning");
        return;
    }
    
    const product = state.products.find(p => p.name === productName);
    if (!product || !product.serials.includes(newSerial)) {
        playSound('error');
        showToast("Replacement Aborted", `Deduction serial "${newSerial}" is not present in warehouse stock catalog!`, "error");
        return;
    }
    
    product.serials = product.serials.filter(s => s !== newSerial);
    product.stock = product.serials.length;
    
    const timestamp = new Date().toLocaleString();
    const replacementEntry = {
        timestamp,
        product: productName,
        oldSerial,
        newSerial,
        stockDeducted: 1
    };
    
    state.replacements.unshift(replacementEntry);
    saveStateToStorage();
    playSound('success');
    showToast("Stock Deducted", `Replacement saved. Deducted 1 unit of ${productName} from live stock.`, "success");
    
    document.getElementById('replacement-form').reset();
    refreshAllViews();
}

function renderReplacementTable() {
    const tbody = document.getElementById('replacement-history-body');
    tbody.innerHTML = "";
    
    state.replacements.forEach(r => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-size:11px; color:var(--text-dark);">${r.timestamp}</td>
            <td style="font-weight:600; color:#fff;">${r.product}</td>
            <td style="font-family:var(--font-heading); color:var(--text-muted); text-decoration: line-through;">${r.oldSerial}</td>
            <td style="font-family:var(--font-heading); color:var(--green);">${r.newSerial}</td>
            <td><span class="badge b-red">-1 unit</span></td>
        `;
        tbody.appendChild(row);
    });
}

function filterReplacementTable() {
    const query = document.getElementById('replacement-search').value.toLowerCase();
    const rows = document.querySelectorAll('#replacement-history-body tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (text.includes(query)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}


/* ==========================================
   10. INTERACTIVE BARCODE SCANNER SIMULATOR
   ========================================== */
let html5QrcodeInstance = null;

function openScanner(targetInputId) {
    scannerActiveInput = targetInputId;
    
    document.getElementById('simulated-code').textContent = "SCANNING...";
    document.getElementById('simulated-code').style.color = "var(--text-muted)";
    
    const modal = document.getElementById('scanner-modal');
    modal.style.display = "flex";
    playSound('beep');
    
    // Default: Reset camera container layout
    document.getElementById('camera-scanner-view').style.display = "block";
    document.querySelector('.scanner-viewport').style.display = "none";
    
    setTimeout(() => {
        if (scannerActiveInput && !currentScannedCode) {
            generateScanCode();
        }
    }, 1200);
    
    startRealCameraScan();
}

function startRealCameraScan() {
    if (html5QrcodeInstance) {
        html5QrcodeInstance.stop().catch(() => {}).then(() => {
            html5QrcodeInstance = null;
            initRealCamera();
        });
    } else {
        initRealCamera();
    }
}

function initRealCamera() {
    const readerDiv = document.getElementById('reader');
    if (!readerDiv) return;
    
    html5QrcodeInstance = new Html5Qrcode("reader");
    
    const config = {
        fps: 15,
        qrbox: function(width, height) {
            const minSize = Math.min(width, height);
            const boxWidth = Math.floor(minSize * 0.85);
            const boxHeight = Math.floor(minSize * 0.4); // Rectangular for barcodes
            return { width: boxWidth, height: boxHeight };
        },
        aspectRatio: 1.0
    };
    
    html5QrcodeInstance.start(
        { facingMode: "environment" },
        config,
        (decodedText) => {
            currentScannedCode = decodedText.trim().toUpperCase();
            playSound('success');
            
            const inputField = document.getElementById(scannerActiveInput);
            if (inputField) {
                inputField.value = currentScannedCode;
                
                if (scannerActiveInput === "inword-serial") {
                    addInwordSerial();
                } else if (scannerActiveInput === "dispatch-serial-scan") {
                    addDispatchSerial();
                } else if (scannerActiveInput === "audit-serial-scan") {
                    verifyAuditSerial();
                } else if (scannerActiveInput === "edit-inword-serial-scan") {
                    addEditInwordSerial();
                }
                
                showToast("Barcode Scanned", `Captured code: "${currentScannedCode}".`, "success");
            }
            closeScanner();
        },
        () => {
            // Silently scan
        }
    ).catch(err => {
        console.warn("Camera start failed, showing simulator", err);
        document.getElementById('camera-scanner-view').style.display = "none";
        document.querySelector('.scanner-viewport').style.display = "block";
    });
}

function closeScanner() {
    document.getElementById('scanner-modal').style.display = "none";
    
    if (html5QrcodeInstance) {
        html5QrcodeInstance.stop().catch(() => {}).finally(() => {
            html5QrcodeInstance = null;
        });
    }
    
    scannerActiveInput = null;
    currentScannedCode = "";
}

function generateScanCode() {
    if (!scannerActiveInput) return;
    
    let codePrefix = "SN";
    let len = 8;
    
    if (scannerActiveInput.includes("challan")) {
        codePrefix = "CH";
        len = 6;
    } else if (scannerActiveInput.includes("invoice")) {
        codePrefix = "INV";
        len = 8;
    }
    
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let codeStr = codePrefix + "-";
    for (let i = 0; i < len; i++) {
        if (i === 4 && len === 8) codeStr += "-";
        codeStr += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    if ((scannerActiveInput.includes("dispatch") || scannerActiveInput.includes("audit")) && !scannerActiveInput.includes("challan")) {
        const selectId = scannerActiveInput.includes("dispatch") ? "dispatch-product" : "audit-product";
        const prodName = document.getElementById(selectId).value;
        const product = state.products.find(p => p.name === prodName);
        if (product && product.serials.length > 0) {
            const scannedList = scannerActiveInput.includes("dispatch") ? tempDispatchSerials : verifiedAuditSerials;
            const available = product.serials.filter(s => !scannedList.includes(s));
            if (available.length > 0) {
                codeStr = available[0];
            }
        }
    }
    
    currentScannedCode = codeStr;
    const codeDisplay = document.getElementById('simulated-code');
    codeDisplay.textContent = currentScannedCode;
    codeDisplay.style.color = "var(--green)";
    
    playSound('beep');
}

function regenerateScanCode() {
    document.getElementById('simulated-code').textContent = "GENERATING...";
    document.getElementById('simulated-code').style.color = "var(--text-muted)";
    setTimeout(generateScanCode, 500);
}

function confirmScanCode() {
    if (scannerActiveInput && currentScannedCode) {
        const inputField = document.getElementById(scannerActiveInput);
        if (inputField) {
            inputField.value = currentScannedCode;
            
            if (scannerActiveInput === "inword-serial") {
                addInwordSerial();
            } else if (scannerActiveInput === "dispatch-serial-scan") {
                addDispatchSerial();
            } else if (scannerActiveInput === "audit-serial-scan") {
                verifyAuditSerial();
            } else if (scannerActiveInput === "edit-inword-serial-scan") {
                addEditInwordSerial();
            }
            
            playSound('success');
            showToast("Scanner Captured", `Code "${currentScannedCode}" assigned.`, "success");
        }
    }
    closeScanner();
}


/* ==========================================
   11. SYSTEM DYNAMIC TOAST NOTIFICATIONS
   ========================================== */
function showToast(title, message, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast t-${type}`;
    
    let iconName = "check-circle";
    if (type === "error") iconName = "alert-circle";
    if (type === "warning") iconName = "alert-triangle";
    
    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <div class="toast-content">
            <h5>${title}</h5>
            <p>${message}</p>
        </div>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => {
        toast.classList.add('show');
    }, 50);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 400);
    }, 4000);
}


/* ==========================================
   12. DATA VISUALIZATION (REMOVED)
   ========================================== */


/* ==========================================
   13. SHEETJS EXCEL EXPORT INTEGRATION
   ========================================== */
function exportModuleToExcel(moduleName) {
    loadStateFromStorage();
    let dataToExport = [];
    let fileName = `G-SERVICE-CENTER-${moduleName.toUpperCase()}-${Date.now()}.xlsx`;
    
    if (moduleName === 'inword') {
        if (state.inwords.length === 0) {
            showToast("Export Denied", "No inword data logs available to export.", "warning");
            return;
        }
        dataToExport = state.inwords.map(i => ({
            "Date & Time": i.timestamp,
            "Invoice Number": i.invoice,
            "Courier Partner": i.courier,
            "AWB / Docket Number": i.awb,
            "Product Name": i.product,
            "Pieces Count": i.quantity,
            "Serial Numbers": i.serials.join(', ')
        }));
    } 
    else if (moduleName === 'dispatch') {
        if (state.dispatches.length === 0) {
            showToast("Export Denied", "No dispatch data logs available to export.", "warning");
            return;
        }
        dataToExport = state.dispatches.map(d => ({
            "Date & Time": d.timestamp,
            "Challan Number": d.challan,
            "Product Name": d.product,
            "Quantity": d.quantity,
            "Serial Numbers": d.serials.join(', ')
        }));
    } 
    else if (moduleName === 'audit') {
        if (state.audits.length === 0) {
            showToast("Export Denied", "No audit logs available to export.", "warning");
            return;
        }
        dataToExport = state.audits.map(a => ({
            "Date & Time": a.timestamp,
            "Product Name": a.product,
            "Verified Stock Count": a.verifiedCount,
            "System Count": a.systemCount,
            "Discrepancy Variance": a.variance,
            "Audit Status": a.status
        }));
    } 
    else if (moduleName === 'replacement') {
        if (state.replacements.length === 0) {
            showToast("Export Denied", "No replacement logs available to export.", "warning");
            return;
        }
        dataToExport = state.replacements.map(r => ({
            "Date & Time": r.timestamp,
            "Product Name": r.product,
            "Old Product Serial": r.oldSerial,
            "New Product Serial": r.newSerial,
            "Stock Deducted": r.stockDeducted
        }));
    }
    
    try {
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const fitColumns = {};
        dataToExport.forEach(row => {
            Object.keys(row).forEach(key => {
                const val = String(row[key] || '');
                fitColumns[key] = Math.max(fitColumns[key] || key.length, val.length);
            });
        });
        ws['!cols'] = Object.keys(fitColumns).map(key => ({
            wch: Math.min(fitColumns[key] + 4, 40) 
        }));
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} Logs`);
        XLSX.writeFile(wb, fileName);
        playSound('success');
        showToast("Excel Exported", `Excel file saved as "${fileName}" successfully.`, "success");
    } catch (e) {
        playSound('error');
        showToast("Export Failure", `Could not export Excel file: ${e.message}`, "error");
    }
}


/* ==========================================
   14. MOBILE RESPONSIVENESS DRAWERS
   ========================================== */
function toggleMobileSidebar(isOpen) {
    const sidebar = document.getElementById('app-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (sidebar && overlay) {
        if (isOpen) {
            sidebar.classList.add('mobile-active');
            overlay.classList.add('active');
        } else {
            sidebar.classList.remove('mobile-active');
            overlay.classList.remove('active');
        }
    }
}


/* ==========================================
   15. DATABASE CONTROL CENTER LOGIC (NEW - PASSWORD: 2026)
   ========================================== */
function renderControlProductsTable() {
    const tbody = document.getElementById('control-products-body');
    if (!tbody) return;
    tbody.innerHTML = "";
    
    if (state.products.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-dark);">No products currently registered.</td></tr>`;
        return;
    }
    
    state.products.forEach(p => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td style="font-family:var(--font-heading); font-size:12px;">${p.id}</td>
            <td style="font-weight:600; color:#fff;">${p.name}</td>
            <td style="font-family:var(--font-heading); font-weight:700;">${p.stock} units</td>
            <td style="font-size:12px; color:var(--text-muted); text-overflow:ellipsis; overflow:hidden; max-width:200px;" title="${p.serials.join(', ')}">
                ${p.serials.slice(0, 3).join(', ')}${p.serials.length > 3 ? '...' : ''}
            </td>
            <td style="text-align:center;">
                <button type="button" class="btn btn-secondary" onclick="deleteCatalogProduct('${p.id}')" style="padding:6px 12px; border-color:rgba(244,63,94,0.15); color:var(--red);" title="Delete Product (Password: 2026)">
                    <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Delete
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
    lucide.createIcons();
}

function deleteCatalogProduct(id) {
    const password = prompt("Enter central purge passcode (2026) to DELETE this product and all associated serial counts:");
    if (!password) return;
    
    if (password !== "2026") {
        playSound('error');
        showToast("Access Denied", "Incorrect purge password validation.", "error");
        return;
    }
    
    loadStateFromStorage();
    const product = state.products.find(p => p.id === id);
    if (!product) return;
    
    // Wipe product
    state.products = state.products.filter(p => p.id !== id);
    
    // Auto-wipe matching transactions to avoid database dangling references
    state.inwords = state.inwords.filter(i => i.product !== product.name);
    state.dispatches = state.dispatches.filter(d => d.product !== product.name);
    state.audits = state.audits.filter(a => a.product !== product.name);
    state.pendingAudits = state.pendingAudits.filter(pa => pa.product !== product.name);
    state.replacements = state.replacements.filter(r => r.product !== product.name);
    
    saveStateToStorage();
    playSound('success');
    showToast("Product Purged", `"${product.name}" and matching transaction history logs wiped.`, "success");
    
    refreshAllViews();
}

function renderControlLogsTable() {
    const logType = document.getElementById('control-log-type').value;
    const thead = document.getElementById('control-logs-thead');
    const tbody = document.getElementById('control-logs-tbody');
    
    if (!thead || !tbody) return;
    thead.innerHTML = "";
    tbody.innerHTML = "";
    
    const logs = state[logType] || [];
    
    if (logs.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-dark);">No log records present.</td></tr>`;
        return;
    }
    
    if (logType === 'inwords') {
        thead.innerHTML = `
            <tr>
                <th>Timestamp</th>
                <th>Invoice No</th>
                <th>Courier</th>
                <th>Product Name</th>
                <th>Quantity</th>
                <th>Serials</th>
                <th style="text-align:center;">Action</th>
            </tr>
        `;
        logs.forEach((l, idx) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-size:11px; color:var(--text-dark);">${l.timestamp}</td>
                <td style="font-weight:600; color:#fff;">${l.invoice}</td>
                <td><span class="badge b-cyan">${l.courier}</span></td>
                <td>${l.product}</td>
                <td style="font-weight:700; color:var(--cyan); font-family:var(--font-heading);">${l.quantity} pcs</td>
                <td style="font-size:11px; color:var(--text-muted);">${l.serials.slice(0,3).join(', ')}${l.serials.length > 3 ? '...' : ''}</td>
                <td style="text-align:center;">
                    <button type="button" class="btn btn-secondary" onclick="deleteLoggedRecord('inwords', ${idx})" style="padding:6px 12px; border-color:rgba(244,63,94,0.15); color:var(--red);" title="Delete Log Entry (Password: 2026)">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Delete
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } 
    else if (logType === 'dispatches') {
        thead.innerHTML = `
            <tr>
                <th>Timestamp</th>
                <th>Challan No</th>
                <th>Product Name</th>
                <th>Quantity</th>
                <th>Serials Dispatched</th>
                <th style="text-align:center;">Action</th>
            </tr>
        `;
        logs.forEach((l, idx) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-size:11px; color:var(--text-dark);">${l.timestamp}</td>
                <td style="font-family:var(--font-heading); font-weight:600; color:#fff;">${l.challan}</td>
                <td>${l.product}</td>
                <td style="font-weight:700; color:var(--primary); font-family:var(--font-heading);">${l.quantity} pcs</td>
                <td style="font-size:11px; color:var(--text-muted);">${l.serials.slice(0,3).join(', ')}${l.serials.length > 3 ? '...' : ''}</td>
                <td style="text-align:center;">
                    <button type="button" class="btn btn-secondary" onclick="deleteLoggedRecord('dispatches', ${idx})" style="padding:6px 12px; border-color:rgba(244,63,94,0.15); color:var(--red);" title="Delete Log Entry (Password: 2026)">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Delete
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } 
    else if (logType === 'audits') {
        thead.innerHTML = `
            <tr>
                <th>Timestamp</th>
                <th>Product Name</th>
                <th>Verified Count</th>
                <th>System Stock</th>
                <th>Variance</th>
                <th>Status</th>
                <th style="text-align:center;">Action</th>
            </tr>
        `;
        logs.forEach((l, idx) => {
            let vBadge = l.variance === 0 ? "Balanced" : (l.variance > 0 ? `+${l.variance}` : l.variance);
            let vClass = l.variance === 0 ? "b-green" : (l.variance > 0 ? "b-cyan" : "b-red");
            
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-size:11px; color:var(--text-dark);">${l.timestamp}</td>
                <td style="font-weight:600; color:#fff;">${l.product}</td>
                <td>${l.verifiedCount} units</td>
                <td>${l.systemCount} units</td>
                <td><span class="badge ${vClass}">${vBadge}</span></td>
                <td><span class="badge b-purple">${l.status}</span></td>
                <td style="text-align:center;">
                    <button type="button" class="btn btn-secondary" onclick="deleteLoggedRecord('audits', ${idx})" style="padding:6px 12px; border-color:rgba(244,63,94,0.15); color:var(--red);" title="Delete Log Entry (Password: 2026)">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Delete
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    } 
    else if (logType === 'replacements') {
        thead.innerHTML = `
            <tr>
                <th>Timestamp</th>
                <th>Product Name</th>
                <th>Old Product Serial</th>
                <th>New Product Serial</th>
                <th>Stock Impact</th>
                <th style="text-align:center;">Action</th>
            </tr>
        `;
        logs.forEach((l, idx) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td style="font-size:11px; color:var(--text-dark);">${l.timestamp}</td>
                <td style="font-weight:600; color:#fff;">${l.product}</td>
                <td style="font-family:var(--font-heading); color:var(--text-muted); text-decoration:line-through;">${l.oldSerial}</td>
                <td style="font-family:var(--font-heading); color:var(--green);">${l.newSerial}</td>
                <td><span class="badge b-red">-1 unit</span></td>
                <td style="text-align:center;">
                    <button type="button" class="btn btn-secondary" onclick="deleteLoggedRecord('replacements', ${idx})" style="padding:6px 12px; border-color:rgba(244,63,94,0.15); color:var(--red);" title="Delete Log Entry (Password: 2026)">
                        <i data-lucide="trash-2" style="width:14px; height:14px;"></i> Delete
                    </button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }
    lucide.createIcons();
}

function deleteLoggedRecord(type, index) {
    const password = prompt(`Enter secure purge passcode (2026) to DELETE this single database ${type} entry:`);
    if (!password) return;
    
    if (password !== "2026") {
        playSound('error');
        showToast("Access Denied", "Incorrect purge password validation.", "error");
        return;
    }
    
    loadStateFromStorage();
    const log = state[type][index];
    if (!log) return;
    
    // Inventory reconciliations! Reversing stock logs cleanly.
    const product = state.products.find(p => p.name === log.product);
    if (product) {
        if (type === 'inwords') {
            // Delete: Rollback and remove the inword serials from stock!
            product.serials = product.serials.filter(s => !log.serials.includes(s));
        } 
        else if (type === 'dispatches') {
            // Delete: Return dispatched serials back into product active serials stock!
            product.serials.push(...log.serials);
        } 
        else if (type === 'replacements') {
            // Delete: Return replacement new serial back to product catalog!
            product.serials.push(log.newSerial);
        }
        product.stock = product.serials.length;
    }
    
    state[type].splice(index, 1);
    saveStateToStorage();
    playSound('success');
    showToast("Record Purged", `Database transaction entry deleted successfully (Stock Reconciled).`, "success");
    
    refreshAllViews();
}

function bulkWipe(type) {
    const password = prompt(`Enter security purge passcode (2026) to DELETE ALL entries for: ${type.toUpperCase()}:`);
    if (!password) return;
    
    if (password !== "2026") {
        playSound('error');
        showToast("Access Denied", "Incorrect purge passcode validation.", "error");
        return;
    }
    
    loadStateFromStorage();
    
    if (type === 'all') {
        localStorage.setItem('g_products', JSON.stringify([]));
        localStorage.setItem('g_inwords', JSON.stringify([]));
        localStorage.setItem('g_dispatches', JSON.stringify([]));
        localStorage.setItem('g_audits', JSON.stringify([]));
        localStorage.setItem('g_replacements', JSON.stringify([]));
        localStorage.setItem('g_pending_audits', JSON.stringify([]));
        localStorage.setItem('g_couriers', JSON.stringify(defaultCouriersList));
        showToast("System Purged", "Total database reset complete. Fresh environment initialized.", "success");
    } else {
        // Selective Wipe
        localStorage.setItem(`g_${type}`, JSON.stringify([]));
        
        // If bulk wiping inwords, stock serials are compromised so reset them to avoid stock inconsistency
        if (type === 'inwords') {
            state.products.forEach(p => {
                p.serials = [];
                p.stock = 0;
            });
            localStorage.setItem('g_products', JSON.stringify(state.products));
        }
        showToast("Logs Purged", `All history logs of "${type}" deleted successfully.`, "success");
    }
    
    playSound('success');
    refreshAllViews();
}


/* ==========================================
   16. INITIALIZATION ON PAGE LOAD
   ========================================== */
function bindBarcodeEnterKeys() {
    const inputs = [
        { id: 'inword-serial', action: addInwordSerial },
        { id: 'dispatch-serial-scan', action: addDispatchSerial },
        { id: 'audit-serial-scan', action: verifyAuditSerial },
        { id: 'edit-inword-serial-scan', action: addEditInwordSerial }
    ];
    
    inputs.forEach(item => {
        const el = document.getElementById(item.id);
        if (el) {
            el.addEventListener('keydown', function(evt) {
                if (evt.key === 'Enter') {
                    evt.preventDefault(); // Stop main form from submitting!
                    item.action();
                }
            });
        }
    });

    // Elegant Replacement scanning transitions
    const oldRep = document.getElementById('replacement-old-serial');
    const newRep = document.getElementById('replacement-new-serial');
    if (oldRep && newRep) {
        oldRep.addEventListener('keydown', function(evt) {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                newRep.focus(); // Focus new replacement code input!
            }
        });
        newRep.addEventListener('keydown', function(evt) {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                submitReplacement(evt); // Submit replacement immediately!
            }
        });
    }
}

window.onload = function() {
    initClock();
    initDatabase();
    checkActiveSession();
    bindBarcodeEnterKeys(); // Bind Enter key listeners for automatic scanning counts!
    
    // Auto sync with the shared server every 5 seconds for multi-device collaboration!
    setInterval(() => {
        fetch('/api/state')
            .then(res => {
                if (!res.ok) throw new Error();
                return res.json();
            })
            .then(serverData => {
                // If any changes occurred, load and update views!
                if (JSON.stringify(serverData) !== JSON.stringify(state)) {
                    loadStateFromStorage();
                }
            })
            .catch(() => {});
    }, 5000);
    
    const zone = document.querySelector('.image-upload-zone');
    if (zone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            zone.addEventListener(eventName, (evt) => {
                evt.preventDefault();
                zone.style.borderColor = "var(--primary)";
                zone.style.background = "rgba(139, 92, 246, 0.05)";
            }, false);
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            zone.addEventListener(eventName, (evt) => {
                evt.preventDefault();
                zone.style.borderColor = "var(--border-color)";
                zone.style.background = "transparent";
            }, false);
        });
        
        zone.addEventListener('drop', (evt) => {
            const dt = evt.dataTransfer;
            const files = dt.files;
            if (files.length) {
                const inputElement = document.getElementById('dispatch-photo-file');
                inputElement.files = files;
                handlePhotoUpload({ target: { files: files } });
            }
        }, false);
    }
};
