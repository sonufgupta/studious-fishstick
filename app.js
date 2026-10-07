/**

});
        // 0. Sync Reset Timestamp - Safe Realtime in-memory check (no infinite reload)
        let lastKnownResetTime = null;
        db.ref('wms_data/reset_timestamp').on('value', (snapshot) => {
            const cloudResetTime = snapshot.val();
            if (cloudResetTime) {
                if (lastKnownResetTime === null) {
                    lastKnownResetTime = cloudResetTime;
                } else if (cloudResetTime > lastKnownResetTime) {
                    lastKnownResetTime = cloudResetTime;
                    console.log('Factory reset signal received from cloud.');
                    scheduleSyncUIRender();
                }
            }
        });
/**
 * Warehouse Activity Portal - Application JavaScript (app.js)
 * Basic structure controls (clock, sidebar, navigation, theme toggle)
 */

document.addEventListener('DOMContentLoaded', () => {
    // --- Cloud-Only Storage Virtual Adapter (Zero Device/Browser LocalStorage) ---
    // All data is kept strictly in-memory during session and backed 100% by Firebase Realtime Cloud.
    const _cloudMemoryStore = {};
    const localStorage = {
        getItem: function(key) {
            return _cloudMemoryStore.hasOwnProperty(key) ? _cloudMemoryStore[key] : null;
        },
        setItem: function(key, val) {
            _cloudMemoryStore[key] = String(val);
        },
        removeItem: function(key) {
            delete _cloudMemoryStore[key];
        },
        clear: function() {
            Object.keys(_cloudMemoryStore).forEach(k => delete _cloudMemoryStore[k]);
        }
    };
    // Cache upgrade check for mock data
    const existingHist = localStorage.getItem('wms_inbound_history');
    if (existingHist && !existingHist.includes("inbound_mock_1")) {
        localStorage.removeItem('wms_inbound_history');
    }

    function escapeHtmlAttr(str) {
        if (!str) return '';
        return str.replace(/"/g, '&quot;');
    }

    // --- Firebase Configuration & Realtime Sync Integration ---
    const firebaseConfig = {
        apiKey: "AIzaSyALpgMRgKEz93jKhmXRevHO0L87lDkeiCI",
        authDomain: "wms-portal-g.firebaseapp.com",
        databaseURL: "https://wms-portal-g-default-rtdb.asia-southeast1.firebasedatabase.app",
        projectId: "wms-portal-g",
        storageBucket: "wms-portal-g.firebasestorage.app",
        messagingSenderId: "9299535740",
        appId: "1:9299535740:web:9d2f620aa536a96d6fe6f9",
        measurementId: "G-LW16F1YZ6P"
    };

    let isFirebaseConnected = false;
    let db = null;
    let cachedInboundHistory = null;
    let cachedOutboundHistory = null;
    let cachedProductWeights = null;
    let weightResolutionCache = null;
    let cachedProductStockMap = null;
    let cachedDamageRecords = null;

    // O(1) Fast Index Lookup Maps for Instant Barcode Scanning
    let inboundSerialLogMap = null;    // cleanSerialUpper -> log
    let outboundSerialLogMap = null;   // cleanSerialUpper -> log
    let damageSerialsFastSet = null;   // Set of cleanSerialUpper
    let deletedSerialsFastMap = null;  // cleanSerialUpper -> deletedObj

    function getInboundSerialLogMap() {
        if (inboundSerialLogMap !== null) return inboundSerialLogMap;
        const history = getHistory();
        inboundSerialLogMap = new Map();
        for (const log of history) {
            if (log && log.serials) {
                for (const s of log.serials) {
                    if (s && s.serial) {
                        inboundSerialLogMap.set(s.serial.trim().toUpperCase(), log);
                    }
                }
            }
        }
        return inboundSerialLogMap;
    }

    function getOutboundSerialLogMap() {
        if (outboundSerialLogMap !== null) return outboundSerialLogMap;
        const history = getOutboundHistory();
        outboundSerialLogMap = new Map();
        for (const log of history) {
            if (log && log.serials) {
                for (const s of log.serials) {
                    if (s && s.serial) {
                        outboundSerialLogMap.set(s.serial.trim().toUpperCase(), log);
                    }
                }
            }
        }
        return outboundSerialLogMap;
    }

    function getDamageSerialsFastSet() {
        if (damageSerialsFastSet !== null) return damageSerialsFastSet;
        const records = getDamageRecords();
        damageSerialsFastSet = new Set();
        for (const r of records) {
            if (r && r.serial) {
                damageSerialsFastSet.add(r.serial.trim().toUpperCase());
            }
        }
        return damageSerialsFastSet;
    }

    function getDeletedSerialsFastMap() {
        if (deletedSerialsFastMap !== null) return deletedSerialsFastMap;
        const records = getDeletedSerials();
        deletedSerialsFastMap = new Map();
        for (const r of records) {
            if (r && r.serial) {
                deletedSerialsFastMap.set(r.serial.trim().toUpperCase(), r);
            }
        }
        return deletedSerialsFastMap;
    }

    if (window.firebase) {
        try {
            firebase.initializeApp(firebaseConfig);
            db = firebase.database();
            isFirebaseConnected = true;
            window.db = db;
            window.isFirebaseConnected = isFirebaseConnected;
            console.log("Firebase Realtime Database initialized successfully!");
        } catch (err) {
            console.error("Firebase initialization failed. Falling back to local storage.", err);
        }
    } else {
        console.warn("Firebase SDK script not loaded. Running in local-only mode.");
    }

    function firebaseSet(node, data) {
        if (isFirebaseConnected && db) {
            try {
                db.ref('wms_data/' + node).set(data).catch(err => {
                    console.error("Firebase write error for node '" + node + "':", err);
                });
            } catch (err) {
                console.error("Firebase synchronous write error for node '" + node + "':", err);
            }
        }
    }

    let syncRenderRafId = null;
    function scheduleSyncUIRender() {
        if (syncRenderRafId) return;
        syncRenderRafId = requestAnimationFrame(() => {
            syncRenderRafId = null;
            renderHistoryTable();
            renderOutboundHistoryTable();
            renderInventoryPanel();
        });
    }

    function syncCloudDataToLocal(key, value) {
        if (value === null || value === undefined) {
            return false;
        }
        const currentLocal = localStorage.getItem(key);
        const newStr = JSON.stringify(value);
        if (currentLocal !== newStr) {
            localStorage.setItem(key, newStr);
            if (key === 'wms_inbound_history') {
                cachedInboundHistory = null;
                inboundSerialLogMap = null;
                weightResolutionCache = null;
                cachedProductStockMap = null;
            }
            if (key === 'wms_outbound_history') {
                cachedOutboundHistory = null;
                outboundSerialLogMap = null;
                cachedProductStockMap = null;
            }
            if (key === 'wms_product_weights') {
                cachedProductWeights = null;
                weightResolutionCache = null;
            }
            if (key === 'wms_damage_records') {
                cachedDamageRecords = null;
                damageSerialsFastSet = null;
                cachedProductStockMap = null;
            }
            if (key === 'wms_deleted_serials') {
                deletedSerialsFastMap = null;
            }
            return true;
        }
        return false;
    }

    if (isFirebaseConnected && db) {
        // 0. Sync Reset Timestamp to clear local storage on Factory Reset

        // 1. Sync Active Inbound Session (High Frequency, Small Size)
        db.ref('wms_data/active_inbound_session').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.removeItem('wms_active_inbound_session');
                activeSession = null;
                restoreSessionState();
            } else {
                if (syncCloudDataToLocal('wms_active_inbound_session', val)) {
                    restoreSessionState();
                    console.log("Active Inbound Session synchronized.");
                }
            }
        });

        // 2. Sync Active Outbound Session (High Frequency, Small Size)
        db.ref('wms_data/active_outbound_session').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.removeItem('wms_active_outbound_session');
                activeOutboundSession = null;
                restoreOutboundSessionState();
            } else {
                if (syncCloudDataToLocal('wms_active_outbound_session', val)) {
                    restoreOutboundSessionState();
                    console.log("Active Outbound Session synchronized.");
                }
            }
        });

        // 3. Sync Product Weights (Low Frequency, Small Size)
        db.ref('wms_data/product_weights').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_product_weights', '{}');
                scheduleSyncUIRender();
            } else {
                if (syncCloudDataToLocal('wms_product_weights', val)) {
                    scheduleSyncUIRender();
                    console.log("Product Weights synchronized.");
                }
            }
        });

        // 4. Sync WOS Items (Low Frequency, Small Size)
        db.ref('wms_data/wos_items').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_wos_items', '[]');
                renderWosDropdownItems();
            } else {
                if (syncCloudDataToLocal('wms_wos_items', val)) {
                    renderWosDropdownItems();
                    console.log("WOS Items synchronized.");
                }
            }
        });

        // 5. Sync Inbound Items (Low Frequency, Small Size)
        db.ref('wms_data/inbound_items').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_inbound_items', '[]');
                renderDropdownItems();
                renderActiveDropdownItems();
            } else {
                if (syncCloudDataToLocal('wms_inbound_items', val)) {
                    renderDropdownItems();
                    renderActiveDropdownItems();
                    console.log("Inbound Items synchronized.");
                }
            }
        });

        // 6. Sync Inbound History (Medium Frequency, Medium Size)
        db.ref('wms_data/inbound_history').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_inbound_history', '[]');
                scheduleSyncUIRender();
            } else {
                if (syncCloudDataToLocal('wms_inbound_history', val)) {
                    scheduleSyncUIRender();
                    loadInboundItems();
                    renderDropdownItems();
                    renderActiveDropdownItems();
                    console.log("Inbound History synchronized.");
                }
            }
        });

        // 7. Sync Outbound History (Medium Frequency, Medium Size)
        db.ref('wms_data/outbound_history').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_outbound_history', '[]');
                scheduleSyncUIRender();
            } else {
                if (syncCloudDataToLocal('wms_outbound_history', val)) {
                    scheduleSyncUIRender();
                    loadInboundItems();
                    renderDropdownItems();
                    renderActiveDropdownItems();
                    console.log("Outbound History synchronized.");
                }
            }
        });



        // 7.6. Sync Damage Records
        db.ref('wms_data/damage_records').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_damage_records', '[]');
                cachedDamageRecords = [];
                renderDamageUI();
                renderInventoryPanel();
                renderOrderQueueUI();
            } else {
                if (syncCloudDataToLocal('wms_damage_records', val)) {
                    cachedDamageRecords = val;
                    renderDamageUI();
                    renderInventoryPanel();
                    renderOrderQueueUI();
                    console.log("Damage Records synchronized.");
                }
            }
        });

        // 7.7. Sync ODA Pincode Records
        db.ref('wms_data/oda_records').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_oda_records', '[]');
                updateOdaMemoryCache([]);
                renderOdaUI();
            } else {
                if (syncCloudDataToLocal('wms_oda_records', val)) {
                    updateOdaMemoryCache(val);
                    renderOdaUI();
                    console.log("ODA Pincode Records synchronized.");
                }
            }
        });

        // 8. Sync Deleted Serials (Trash Bin)
        db.ref('wms_data/deleted_serials').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val === null) {
                localStorage.setItem('wms_deleted_serials', '[]');
                renderDeletedSerialsPanel();
            } else {
                if (syncCloudDataToLocal('wms_deleted_serials', val)) {
                    renderDeletedSerialsPanel();
                    console.log("Deleted Serials synchronized.");
                }
            }
        });
    }

    // 1. Time Widget / Local Clock
    const clockWidget = document.getElementById('headerClockWidget');
    function updateClock() {
        const now = new Date();
        const timeString = now.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        if (clockWidget) {
            clockWidget.textContent = timeString;
        }
    }
    setInterval(updateClock, 1000);
    updateClock(); // Initial run

    // 2. Sidebar Navigation Click Handlers (Page Toggling)
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('.content-section');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            if (link.id === 'navMisReport') {
                const pwd = prompt("Enter password to access MIS Reports:");
                if (pwd === '1998') {
                    window.open('https://geonix-desk.vercel.app/', '_blank');
                } else if (pwd !== null) {
                    alert("Incorrect password! Access denied.");
                }
                return;
            }
            const targetSectionId = link.id.replace('nav', 'section');
            if (targetSectionId === 'sectionInventory') {
                const isUnlocked = localStorage.getItem('wms_inventory_unlocked') === 'true';
                if (!isUnlocked) {
                    const pwd = prompt("Enter passcode to access Inventory:");
                    if (pwd === '2026' || pwd === '1998') {
                        localStorage.setItem('wms_inventory_unlocked', 'true');
                    } else {
                        if (pwd !== null) alert("Incorrect passcode! Access denied.");
                        return;
                    }
                }
            }
            if (targetSectionId === 'sectionDamage') {
                const isUnlocked = localStorage.getItem('wms_damage_unlocked') === 'true';
                if (!isUnlocked) {
                    const pwd = prompt("Enter passcode to access Damage Register:");
                    if (pwd === '2026' || pwd === '1998') {
                        localStorage.setItem('wms_damage_unlocked', 'true');
                    } else {
                        if (pwd !== null) alert("Incorrect passcode! Access denied.");
                        return;
                    }
                }
            }
            if (targetSectionId === 'sectionOda') {
                const isUnlocked = localStorage.getItem('wms_oda_unlocked') === 'true';
                if (!isUnlocked) {
                    const pwd = prompt("Enter passcode to access ODA Register:");
                    if (pwd === '2026' || pwd === '1998') {
                        localStorage.setItem('wms_oda_unlocked', 'true');
                    } else {
                        if (pwd !== null) alert("Incorrect passcode! Access denied.");
                        return;
                    }
                }
            }

            // Remove active class from all navigation links
            navLinks.forEach(item => item.classList.remove('active'));
            // Add to currently clicked navigation link
            link.classList.add('active');
            // Deactivate and hide all sections
            sections.forEach(sec => {
                sec.classList.remove('active');
                sec.style.display = 'none';
            });

            
            // Activate and show target section instantly
            const targetSection = document.getElementById(targetSectionId);
            if (targetSection) {
                targetSection.style.display = 'flex';
                targetSection.classList.add('active');
            }

            if (targetSectionId === 'sectionWarehouseAudit') {
                // Warehouse Audit is a dedicated top-level module. Audit is always the default page.
                window.showWarehouseAuditPage('audit');
            } else if (targetSectionId === 'sectionWarehouseExpenses') {
                // Warehouse Expenses is a dedicated top-level module. Audit is not shown here.
                window.showWarehouseAuditPage('expenses');
            } else if (targetSectionId === 'sectionInventory' || targetSectionId === 'sectionOverview') {
                renderInventoryPanel();
            } else if (targetSectionId === 'sectionMisReport') {
                populateMisProductsDropdown();
            } else if (targetSectionId === 'sectionInbound') {
                renderHistoryTable();
            } else if (targetSectionId === 'sectionOutbound') {
                renderOutboundHistoryTable();
            }
            
            console.log(`Navigated to section: ${targetSectionId}`);
        });
    });

    // Excel Stock Report Download Handler
    const btnDownloadStockReportExcel = document.getElementById('btnDownloadStockReportExcel');
    if (btnDownloadStockReportExcel) {
        btnDownloadStockReportExcel.addEventListener('click', () => {
            if (!window.XLSX) {
                alert('Excel utility library not loaded.');
                return;
            }

            // Get current stock calculations
            const history = getHistory();
            const outboundHistory = getOutboundHistory();
            const weights = getProductWeights();

            // 1. Gather all completed outbound scans and build normalizations
            const outboundSerialsSet = new Set();
            const unmatchedOutboundCounts = {};
            const outboundCountsByProduct = {};

            const inboundSerialsSet = new Set();
            history.forEach(log => {
                if (log.serials) {
                    log.serials.forEach(s => {
                        if (s && s.serial) {
                            inboundSerialsSet.add(s.serial.trim().toUpperCase());
                        }
                    });
                }
            });

            outboundHistory.forEach(log => {
                if (log.serials) {
                    log.serials.forEach(s => {
                        const cleanSerial = s.serial.trim().toUpperCase();
                        outboundSerialsSet.add(cleanSerial);

                        const itemName = s.itemName;
                        if (!outboundCountsByProduct[itemName]) {
                            outboundCountsByProduct[itemName] = 0;
                        }
                        outboundCountsByProduct[itemName]++;

                        if (!inboundSerialsSet.has(cleanSerial) && !cleanSerial.includes('WOS-OUT-')) {
                            if (!unmatchedOutboundCounts[itemName]) {
                                unmatchedOutboundCounts[itemName] = 0;
                            }
                            unmatchedOutboundCounts[itemName]++;
                        }
                    });
                }
            });

            // 2. Map inbound arrivals and box counts with FIFO weights
            const productStock = {};
            const remainingWosOutbound = {};
            Object.keys(outboundCountsByProduct).forEach(key => {
                remainingWosOutbound[key] = outboundCountsByProduct[key];
            });

            const remainingUnmatchedOutbound = {};
            Object.keys(unmatchedOutboundCounts).forEach(key => {
                remainingUnmatchedOutbound[key] = unmatchedOutboundCounts[key];
            });

            // Process inbound history from oldest to newest (FIFO)
            const inboundHistoryReversed = [...history].reverse();
            
            inboundHistoryReversed.forEach(log => {
                const name = log.item;
                if (log.serials && log.serials.length > 0) {
                    log.serials.forEach(s => {
                        const itemName = s.itemName || name; // Fallback if name is missing
                        const cleanInboundSerial = s.serial.trim().toUpperCase();
                        const logW = resolveLogWeight(log, itemName);
                        const unitWeight = (logW !== undefined) ? logW : (parseFloat(weights[itemName]) || 0);

                        if (!productStock[itemName]) {
                            productStock[itemName] = {
                                name: itemName,
                                inboundCount: 0,
                                serialsCount: 0,
                                availableWeight: 0,
                                boxNumbers: new Set()
                            };
                        }
                        
                        productStock[itemName].inboundCount++;
                        
                        let isDispatched = false;
                        if (outboundSerialsSet.has(cleanInboundSerial)) {
                            isDispatched = true;
                        } else if (remainingUnmatchedOutbound[itemName] && remainingUnmatchedOutbound[itemName] > 0) {
                            isDispatched = true;
                            remainingUnmatchedOutbound[itemName]--;
                        }

                        if (!isDispatched) {
                            productStock[itemName].serialsCount++;
                            productStock[itemName].availableWeight += unitWeight;
                            productStock[itemName].boxNumbers.add(s.boxNo);
                        }
                    });
                } else {
                    // Support "Without Serial Number Inward" math fallback (WOS)
                    if (name && log.count > 0) {
                        const logW = resolveLogWeight(log, name);
                        const unitWeight = (logW !== undefined) ? logW : (parseFloat(weights[name]) || 0);
                        
                        if (!productStock[name]) {
                            productStock[name] = {
                                name: name,
                                inboundCount: 0,
                                serialsCount: 0,
                                availableWeight: 0,
                                boxNumbers: new Set()
                            };
                        }
                        
                        productStock[name].inboundCount += log.count;

                        // FIFO deduction for WOS
                        const inboundQty = log.count;
                        const remOut = remainingWosOutbound[name] || 0;
                        if (remOut >= inboundQty) {
                            remainingWosOutbound[name] -= inboundQty;
                        } else {
                            const availableQty = inboundQty - remOut;
                            remainingWosOutbound[name] = 0;
                            
                            productStock[name].serialsCount += availableQty;
                            productStock[name].availableWeight += (availableQty * unitWeight);
                            if (log.wosBoxNo || log.boxNo) {
                                productStock[name].boxNumbers.add(log.wosBoxNo || log.boxNo);
                            }
                        }
                    }
                }
            });

            // 3. Compile stock rows list
            const sheetRows = [];
            let rowIdx = 1;
            let sumPcs = 0;
            let sumBoxes = 0;
            let sumWeight = 0.0;

            // Sort to place Out of Stock items at the top
            const sortedExcelStock = Object.values(productStock).sort((a, b) => {
                const aIsOut = a.serialsCount === 0 ? 1 : 0;
                const bIsOut = b.serialsCount === 0 ? 1 : 0;
                if (aIsOut !== bIsOut) {
                    return bIsOut - aIsOut;
                }
                return a.name.localeCompare(b.name);
            });

            sortedExcelStock.forEach(item => {
                const currentPcQty = item.serialsCount;
                const currentBoxQty = item.boxNumbers.size;
                const totalWeight = item.availableWeight;

                sheetRows.push({
                    "S.No.": rowIdx++,
                    "Product Name": item.name,
                    "Piece Quantity (PCs)": currentPcQty === 0 ? "Out of Stock" : currentPcQty,
                    "Total Weight (kg)": totalWeight > 0 ? parseFloat(totalWeight.toFixed(3)) : 0
                });

                sumPcs += currentPcQty;
                sumBoxes += currentBoxQty;
                sumWeight += totalWeight;
            });

            if (sheetRows.length === 0) {
                alert('No active stock items to export.');
                return;
            }

            // Append spacer row & total summary row at the bottom
            sheetRows.push({
                "S.No.": "",
                "Product Name": "",
                "Piece Quantity (PCs)": "",
                "Total Weight (kg)": ""
            });

            sheetRows.push({
                "S.No.": "",
                "Product Name": "TOTAL",
                "Piece Quantity (PCs)": sumPcs,
                "Total Weight (kg)": parseFloat(sumWeight.toFixed(3))
            });

            // Create new sheet
            const ws = XLSX.utils.json_to_sheet(sheetRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Current Stock");

            // Format Filename: mumbai stock report ( bhiwandi ) DD-MM-YYYY HH-MM-SS
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, '-'); // DD-MM-YYYY
            const timeStr = now.toLocaleTimeString('en-US', { hour12: false }).replace(/\:/g, '-'); // HH-MM-SS
            const filename = `mumbai stock report ( bhiwandi ) ${dateStr} ${timeStr}`.toUpperCase() + ".xlsx";

            XLSX.writeFile(wb, filename);
        });
    }

    // Administrative Workspace Factory Reset Handler
    const btnAdminResetPortal = document.getElementById('btnAdminResetPortal');
    if (btnAdminResetPortal) {
        btnAdminResetPortal.addEventListener('click', () => {
            const pwd = prompt("Enter administrator password to factory reset and clear all workspace data:");
            if (pwd === '1998') {
                if (confirm("Are you absolutely sure? This will delete all completed Inbound history, Outbound history, product weights, items configs, and active sessions. This action CANNOT be undone!")) {
                    localStorage.removeItem('wms_inbound_history');
                    localStorage.removeItem('wms_outbound_history');
                    localStorage.removeItem('wms_product_weights');
                    localStorage.removeItem('wms_inbound_items');
                    localStorage.removeItem('wms_wos_items');
                    localStorage.removeItem('wms_active_inbound_session');
                    localStorage.removeItem('wms_active_outbound_session');
                    localStorage.removeItem('wms_deleted_serials');
                    localStorage.clear(); // Complete browser clear fallback

                    const resetTime = Date.now();
                    localStorage.setItem('wms_reset_timestamp', resetTime.toString());

                    if (isFirebaseConnected && db) {
                        const resetPayload = {
                            active_inbound_session: null,
                            active_outbound_session: null,
                            inbound_history: null,
                            outbound_history: null,
                            product_weights: null,
                            wos_items: null,
                            inbound_items: null,
                            deleted_serials: null,
                            reset_timestamp: resetTime
                        };

                        db.ref('wms_data').update(resetPayload).then(() => {
                            alert("Workspace reset successful! Reloading page...");
                            window.location.reload();
                        }).catch(err => {
                            console.error("Firebase reset error:", err);
                            alert("Firebase reset failed, but local storage was cleared. Reloading page...");
                            window.location.reload();
                        });
                    } else {
                        alert("Workspace reset successful! Reloading page...");
                        window.location.reload();
                    }
                }
            } else if (pwd !== null) {
                alert("Incorrect password! Reset authorization denied.");
            }
        });
    }

    // 3. Responsive & Collapse Menu Toggle
    const menuToggleButton = document.getElementById('menuToggleButton');
    const appSidebar = document.getElementById('appSidebar');
    const btnCollapseSidebar = document.getElementById('btnCollapseSidebar');

    if (menuToggleButton && appSidebar) {
        menuToggleButton.addEventListener('click', () => {
            const appContainer = document.querySelector('.app-container');
            if (appContainer && appContainer.classList.contains('sidebar-collapsed')) {
                appContainer.classList.remove('sidebar-collapsed');
                localStorage.setItem('wms_sidebar_collapsed', 'false');
            } else {
                appSidebar.classList.toggle('active');
            }
        });

        // Close sidebar if user clicks outside on mobile view
        document.addEventListener('click', (e) => {
            if (window.innerWidth <= 768) {
                if (!appSidebar.contains(e.target) && !menuToggleButton.contains(e.target)) {
                    appSidebar.classList.remove('active');
                }
            }
        });
    }

    if (btnCollapseSidebar && appSidebar) {
        btnCollapseSidebar.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const appContainer = document.querySelector('.app-container');
            if (appContainer) {
                const collapsed = appContainer.classList.toggle('sidebar-collapsed');
                localStorage.setItem('wms_sidebar_collapsed', collapsed ? 'true' : 'false');
            }
            if (window.innerWidth <= 768) {
                appSidebar.classList.remove('active');
            }
        });
    }

    // 4. Dark / Light Theme Toggler
    const themeTogglerButton = document.getElementById('themeTogglerButton');
    const htmlElement = document.documentElement;

    if (themeTogglerButton) {
        themeTogglerButton.addEventListener('click', () => {
            const currentTheme = htmlElement.getAttribute('data-theme');
            const newTheme = currentTheme === 'light' ? 'dark' : 'light';
            
            htmlElement.setAttribute('data-theme', newTheme);
            console.log(`Theme toggled to: ${newTheme}`);
        });
    }

    // 5. Inbound Log Session & Scanner / Sequence Logic
    const startInboundSessionBtn = document.getElementById('startInboundSessionBtn');
    const endInboundSessionBtn = document.getElementById('endInboundSessionBtn');
    const cancelActiveInboundSessionBtn = document.getElementById('cancelActiveInboundSessionBtn');
    const inboundInactiveState = document.getElementById('inboundInactiveState');
    const inboundActiveState = document.getElementById('inboundActiveState');
    
    // Modals & Controls
    const inboundConfigModal = document.getElementById('inboundConfigModal');
    const closeInboundConfigModalBtn = document.getElementById('closeInboundConfigModalBtn');
    const cancelInboundConfigModalBtn = document.getElementById('cancelInboundConfigModalBtn');
    const inboundConfigForm = document.getElementById('inboundConfigForm');
    
    const addItemModal = document.getElementById('addItemModal');
    const openAddItemModalBtnInModal = document.getElementById('openAddItemModalBtnInModal');
    const closeAddItemModalBtn = document.getElementById('closeAddItemModalBtn');
    const cancelAddItemModalBtn = document.getElementById('cancelAddItemModalBtn');
    
    const newItemForm = document.getElementById('newItemForm');
    const newItemNameInput = document.getElementById('newItemName');
    const configItemSelect = document.getElementById('configItemSelect');
    const configItemDropdownContainer = document.getElementById('configItemDropdownContainer');
    const configItemDropdownTrigger = document.getElementById('configItemDropdownTrigger');
    const configItemDropdownSelectedText = document.getElementById('configItemDropdownSelectedText');
    const configItemDropdownMenu = document.getElementById('configItemDropdownMenu');
    const configItemDropdownList = document.getElementById('configItemDropdownList');
    
    // SKU Warning Reject Modal elements
    const skuWarningModal = document.getElementById('skuWarningModal');
    const warningTitleText = document.getElementById('warningTitleText');
    const warningDescText = document.getElementById('warningDescText');
    const warningExpectedLabel = document.getElementById('warningExpectedLabel');
    const warningExpectedSku = document.getElementById('warningExpectedSku');
    const warningScannedLabel = document.getElementById('warningScannedLabel');
    const warningScannedSerial = document.getElementById('warningScannedSerial');
    const rejectScanBtn = document.getElementById('rejectScanBtn');
    const allowLengthBtn = document.getElementById('allowLengthBtn');
    const warningAddProductBtn = document.getElementById('warningAddProductBtn');
    const warningModalConfirmInput = document.getElementById('warningModalConfirmInput');
    const configSkuPatternInput = document.getElementById('configSkuPattern');
    let deletedSerialDismissTimer = null;

    const productWeightModal = document.getElementById('productWeightModal');
    const weightModalProductDesc = document.getElementById('weightModalProductDesc');
    const weightInputVal = document.getElementById('weightInputVal');
    const productWeightForm = document.getElementById('productWeightForm');
    const closeWeightModalBtn = document.getElementById('closeWeightModalBtn');
    const cancelWeightModalBtn = document.getElementById('cancelWeightModalBtn');

    // Active Session HTML details
    const activeSessionVehicle = document.getElementById('activeSessionVehicle');
    const activeSessionProgress = document.getElementById('activeSessionProgress');
    const activeSessionRowsContainer = document.getElementById('activeSessionRowsContainer');
    const sessionScannedCount = document.getElementById('sessionScannedCount');
    const sessionBoxesContainer = document.getElementById('sessionBoxesContainer');
    const inboundHistoryBody = document.getElementById('inboundHistoryBody');

    // Add Product to Active Session Modal elements
    const openAddProductToActiveSessionModalBtn = document.getElementById('openAddProductToActiveSessionModalBtn');
    const addProductToActiveSessionModal = document.getElementById('addProductToActiveSessionModal');
    const closeAddProductToActiveSessionModalBtn = document.getElementById('closeAddProductToActiveSessionModalBtn');
    const cancelAddProductToActiveSessionModalBtn = document.getElementById('cancelAddProductToActiveSessionModalBtn');
    const addProductToActiveSessionForm = document.getElementById('addProductToActiveSessionForm');
    
    // Add product custom dropdown select fields
    const activeConfigItemSelect = document.getElementById('activeConfigItemSelect');
    const activeConfigItemDropdownContainer = document.getElementById('activeConfigItemDropdownContainer');
    const activeConfigItemDropdownTrigger = document.getElementById('activeConfigItemDropdownTrigger');
    const activeConfigItemDropdownSelectedText = document.getElementById('activeConfigItemDropdownSelectedText');
    const activeConfigItemDropdownMenu = document.getElementById('activeConfigItemDropdownMenu');
    const activeConfigItemDropdownList = document.getElementById('activeConfigItemDropdownList');
    const openAddItemModalBtnInActiveModal = document.getElementById('openAddItemModalBtnInActiveModal');

    // Unified Scanning elements
    const unifiedScanForm = document.getElementById('unifiedScanForm');
    const sequenceToggle = document.getElementById('sequenceToggle');
    const unifiedSerialInput = document.getElementById('unifiedSerialInput');
    const qtyInputGroup = document.getElementById('qtyInputGroup');
    const unifiedQtyInput = document.getElementById('unifiedQtyInput');
    const unifiedScanSubmitBtn = document.getElementById('unifiedScanSubmitBtn');
    const inputLabel = document.getElementById('inputLabel');
    const inputHelper = document.getElementById('inputHelper');
    const submitBtnText = document.getElementById('submitBtnText');
    const submitBtnIcon = document.getElementById('submitBtnIcon');

    // Global Active Session State
    let activeSession = null;
    let lastRejectedSerial = '';
    let lastRejectedItemName = '';
    let lastRejectedIsSequence = false;
    let lastRejectedSeqBase = '';
    let lastRejectedSeqCount = 0;
    let selectedWeightItemName = '';
    let weightConfigureQueue = [];
    let currentEndingSessionLogId = '';

    // --- Product Weight Storage Helpers ---
    function resolveLogWeight(log, itemName) {
        if (!log || !log.weights) return undefined;
        if (Array.isArray(log.weights)) {
            const found = log.weights.find(w => w.name === itemName);
            return found ? parseFloat(found.weight) : undefined;
        }
        return log.weights[itemName] !== undefined ? parseFloat(log.weights[itemName]) : undefined;
    }

    function saveLogWeight(log, itemName, weightVal) {
        if (!log) return;
        const parsed = parseFloat(weightVal);
        if (isNaN(parsed) || parsed <= 0) {
            if (log.weights) {
                if (Array.isArray(log.weights)) {
                    log.weights = log.weights.filter(w => w.name !== itemName);
                } else {
                    delete log.weights[itemName];
                }
            }
            return;
        }
        
        if (!log.weights) {
            log.weights = [];
        }
        
        if (Array.isArray(log.weights)) {
            const existing = log.weights.find(w => w.name === itemName);
            if (existing) {
                existing.weight = parsed;
            } else {
                log.weights.push({ name: itemName, weight: parsed });
            }
        } else {
            const dict = log.weights;
            const arr = Object.keys(dict).map(k => ({ name: k, weight: parseFloat(dict[k]) }));
            const existing = arr.find(w => w.name === itemName);
            if (existing) {
                existing.weight = parsed;
            } else {
                arr.push({ name: itemName, weight: parsed });
            }
            log.weights = arr;
        }
    }

    function buildWeightResolutionCache() {
        const inboundHistory = getHistory();
        const serialToWeight = new Map();
        const itemToWeight = new Map();

        // 1. Populate serial-to-weight mapping (oldest to newest, so newest log overrides and wins)
        for (let i = inboundHistory.length - 1; i >= 0; i--) {
            const log = inboundHistory[i];
            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    if (s && s.serial) {
                        const cleanSerial = s.serial.trim().toUpperCase();
                        const logW = resolveLogWeight(log, s.itemName || log.item);
                        if (logW !== undefined) {
                            serialToWeight.set(cleanSerial, logW);
                        }
                    }
                });
            }
        }

        // 2. Populate item-to-weight mapping (newest to oldest, so oldest log overrides and wins for FIFO)
        for (let i = 0; i < inboundHistory.length; i++) {
            const log = inboundHistory[i];
            const itemNames = new Set();
            if (log.item) itemNames.add(log.item);
            if (log.items) log.items.forEach(it => { if (it.name) itemNames.add(it.name); });
            if (log.serials) log.serials.forEach(sr => { if (sr.itemName) itemNames.add(sr.itemName); });

            itemNames.forEach(itemName => {
                const logW = resolveLogWeight(log, itemName);
                if (logW !== undefined) {
                    itemToWeight.set(itemName, logW);
                }
            });
        }

        const globalWeights = getProductWeights();

        return {
            resolve: function(serial, itemName) {
                if (serial && !serial.includes('WOS-OUT-')) {
                    const cleanSerial = serial.trim().toUpperCase();
                    if (serialToWeight.has(cleanSerial)) {
                        return serialToWeight.get(cleanSerial);
                    }
                }
                if (itemName && itemToWeight.has(itemName)) {
                    return itemToWeight.get(itemName);
                }
                return parseFloat(globalWeights[itemName]) || 0;
            }
        };
    }

    function resolveItemWeight(serial, itemName) {
        if (!weightResolutionCache) {
            weightResolutionCache = buildWeightResolutionCache();
        }
        return weightResolutionCache.resolve(serial, itemName);
    }

    function getProductWeights() {
        if (cachedProductWeights !== null) {
            return cachedProductWeights;
        }
        const saved = localStorage.getItem('wms_product_weights');
        if (!saved) {
            cachedProductWeights = {};
            return cachedProductWeights;
        }
        try {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) {
                const dict = {};
                parsed.forEach(w => {
                    if (w && w.name) {
                        dict[w.name] = parseFloat(w.weight) || 0;
                    }
                });
                cachedProductWeights = dict;
                return cachedProductWeights;
            }
            cachedProductWeights = parsed;
            return cachedProductWeights;
        } catch (e) {
            cachedProductWeights = {};
            return cachedProductWeights;
        }
    }

    function saveProductWeight(itemName, weight) {
        const weights = getProductWeights();
        const parsed = parseFloat(weight);
        if (weight === null || weight === undefined || weight === '' || isNaN(parsed) || parsed <= 0) {
            delete weights[itemName];
        } else {
            weights[itemName] = parsed;
        }
        
        cachedProductWeights = weights;
        weightResolutionCache = null;
        
        // Convert dictionary to array of objects to bypass Firebase path segment key restrictions
        const weightsArray = Object.keys(weights).map(name => ({
            name: name,
            weight: weights[name]
        }));
        
        localStorage.setItem('wms_product_weights', JSON.stringify(weightsArray));
        firebaseSet('product_weights', weightsArray);
    }

    // --- Auto-SKU Alphabet Pattern Extraction and Matching Helpers ---
    function extractAlphabetPattern(serial) {
        const pattern = {};
        for (let i = 0; i < serial.length; i++) {
            const char = serial[i];
            // Check if it is a letter (A-Z, a-z)
            if (/[a-zA-Z]/.test(char)) {
                pattern[i] = char.toUpperCase();
            } else if (/[0-9]/.test(char)) {
                // Include model digit if surrounded by letters (e.g., L7B in PL7BV vs PL1BV)
                const prevChar = i > 0 ? serial[i - 1] : '';
                const nextChar = i < serial.length - 1 ? serial[i + 1] : '';
                if (/[a-zA-Z]/.test(prevChar) && /[a-zA-Z]/.test(nextChar)) {
                    pattern[i] = char;
                }
            }
        }
        return pattern;
    }

    function matchesAlphabetPattern(serial, pattern) {
        if (!pattern) return false;
        for (const index in pattern) {
            const idx = parseInt(index);
            if (idx >= serial.length) return false;
            const expectedChar = pattern[index];
            if (expectedChar !== null && expectedChar !== undefined && expectedChar !== '') {
                if (serial[idx].toUpperCase() !== expectedChar) {
                    return false;
                }
            }
        }
        return true;
    }

    function matchesAlphabetPatternPartial(serial, pattern) {
        if (!pattern) return false;
        let checkedCount = 0;
        for (const index in pattern) {
            const idx = parseInt(index);
            // Only verify if index is within scanned serial range
            if (idx < serial.length) {
                const char = serial[idx];
                const expectedChar = pattern[index];
                if (expectedChar !== null && expectedChar !== undefined && expectedChar !== '') {
                    // Verify if position has letter or digit
                    if (/[a-zA-Z0-9]/.test(char)) {
                        checkedCount++;
                        if (char.toUpperCase() !== expectedChar) {
                            return false;
                        }
                    }
                }
            }
        }
        return checkedCount >= 3; // Ensure at least 3 characters match
    }

    function formatAlphabetPattern(pattern, length) {
        if (!pattern || length === 0) return 'Not Locked Yet';
        let str = '';
        for (let i = 0; i < length; i++) {
            if (pattern[i]) {
                str += pattern[i];
            } else {
                str += '.';
            }
        }
        return str;
    }

    function deriveProductNameFromPattern(serial, itemsList) {
        if (!serial || !itemsList || itemsList.length === 0) return null;
        const cleanSerial = serial.trim().toUpperCase();
        const newPattern = extractAlphabetPattern(cleanSerial);

        for (const item of itemsList) {
            if (!item || !item.name) continue;
            let patterns = item.allowedPatterns;
            if (!patterns || patterns.length === 0) {
                if (item.skuAlphabetPattern) {
                    patterns = [{ pattern: item.skuAlphabetPattern, length: item.lockedLength || cleanSerial.length }];
                }
            }
            if (!patterns) continue;

            for (const cfg of patterns) {
                if (!cfg || !cfg.pattern || cfg.length !== cleanSerial.length) continue;
                const refPattern = cfg.pattern;
                
                let diffIndex = -1;
                let diffCount = 0;
                
                const allKeys = new Set([...Object.keys(refPattern), ...Object.keys(newPattern)]);
                for (const k of allKeys) {
                    if (refPattern[k] !== newPattern[k]) {
                        diffCount++;
                        diffIndex = k;
                    }
                }

                if (diffCount === 1 && diffIndex !== -1) {
                    const oldChar = refPattern[diffIndex];
                    const newChar = newPattern[diffIndex];
                    if (oldChar && newChar && item.name.includes(oldChar)) {
                        const derivedName = item.name.replace(oldChar, newChar);
                        return derivedName;
                    }
                }
            }
        }
        return null;
    }

    function sanitizeSessionItems(session) {
        if (!session || !session.items || session.items.length === 0 || !session.serials) return;
        
        session.items.forEach(item => {
            if (!item.allowedPatterns || item.allowedPatterns.length <= 1) return;
            const itemSerials = session.serials.filter(s => s.itemName === item.name);
            if (itemSerials.length > 0) {
                const firstSerial = itemSerials[0].serial;
                const primaryPattern = extractAlphabetPattern(firstSerial);
                item.allowedPatterns = [{ pattern: primaryPattern, length: firstSerial.length }];
                item.skuAlphabetPattern = primaryPattern;
                item.lockedLength = firstSerial.length;
            }
        });

        const serialsToReassign = [];
        session.items.forEach(item => {
            if (!item.allowedPatterns || item.allowedPatterns.length === 0) return;
            const primaryCfg = item.allowedPatterns[0];
            
            const mismatched = session.serials.filter(s => {
                return s.itemName === item.name && !matchesAlphabetPattern(s.serial, primaryCfg.pattern);
            });

            mismatched.forEach(s => {
                const derivedName = deriveProductNameFromPattern(s.serial, session.items) || 'New Product';
                serialsToReassign.push({ serialObj: s, derivedName: derivedName });
            });
        });

        serialsToReassign.forEach(({ serialObj, derivedName }) => {
            let target = session.items.find(i => i.name === derivedName);
            if (!target) {
                const pat = extractAlphabetPattern(serialObj.serial);
                target = {
                    name: derivedName,
                    expectedQty: 0,
                    skuAlphabetPattern: pat,
                    lockedLength: serialObj.serial.length,
                    allowedPatterns: [{ pattern: pat, length: serialObj.serial.length }],
                    scannedCount: 0
                };
                session.items.push(target);
            }
            serialObj.itemName = derivedName;
        });

        compactOutboundBoxNumbers();
        compactBoxNumbers();
    }

    // --- State Persistence & LocalStorage Helpers ---

    function saveActiveSession() {
        if (activeSession) {
            localStorage.setItem('wms_active_inbound_session', JSON.stringify(activeSession));
            firebaseSet('active_inbound_session', activeSession);
        } else {
            localStorage.removeItem('wms_active_inbound_session');
            localStorage.removeItem('wms_inbound_joined');
            firebaseSet('active_inbound_session', null);
        }
    }

    // Custom Warning Modal triggers
    function showScanWarning(type, expected, scanned, isSameProductLengthError) {
        if (type === 'duplicate' || type === 'duplicate-seq' || type === 'duplicate-batch') {
            triggerSpeak("duplicate scan");
        } else if (type === 'sku') {
            triggerSpeak("incorrect product");
        } else if (type === 'length') {
            triggerSpeak("incomplete serial");
        }
        if (!skuWarningModal) return;

        const modalContainer = skuWarningModal.querySelector('.modal-card');
        const modalHeader = skuWarningModal.querySelector('.modal-header');
        const rejectBtn = document.getElementById('rejectScanBtn');

        // Hide allowLengthBtn and warningAddProductBtn by default
        if (allowLengthBtn) {
            allowLengthBtn.style.display = 'none';
        }
        if (warningAddProductBtn) {
            warningAddProductBtn.style.display = 'none';
        }

        // Apply dynamic theme styling based on warning type
        let themeColor = 'var(--accent-rose)';
        let themeGlow = 'rgba(244, 63, 94, 0.15)';
        let btnText = 'Reject & Dismiss Scan';

        if (type === 'length') {
            if (isSameProductLengthError) {
                themeColor = 'var(--accent-amber)';
                themeGlow = 'rgba(245, 158, 11, 0.15)';
                btnText = 'Dismiss & Re-scan';

                // Display allowLengthBtn and capture state
                if (allowLengthBtn) {
                    allowLengthBtn.style.display = 'block';
                    allowLengthBtn.style.borderColor = 'var(--accent-emerald)';
                    allowLengthBtn.style.color = 'var(--accent-emerald)';
                    allowLengthBtn.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
                    allowLengthBtn.textContent = 'Allow & Save SKU Pattern';
                }

                lastRejectedSerial = scanned;
                const workstationProductSelect = document.getElementById('workstationProductSelect');
                if (activeSession.items.length === 1) {
                    lastRejectedItemName = activeSession.items[0].name;
                } else if (workstationProductSelect) {
                    lastRejectedItemName = workstationProductSelect.value;
                }
            } else {
                themeColor = 'var(--accent-rose)';
                themeGlow = 'rgba(244, 63, 94, 0.15)';
                btnText = 'Reject & Dismiss Scan';
            }
        } else if (type === 'duplicate' || type === 'duplicate-seq' || type === 'duplicate-batch') {
            themeColor = 'var(--accent-purple)';
            themeGlow = 'rgba(139, 92, 246, 0.15)';
            btnText = 'Dismiss Duplicate Scan';
        } else if (type === 'sku') {
            themeColor = 'var(--accent-rose)';
            themeGlow = 'rgba(244, 63, 94, 0.15)';
            btnText = 'Reject & Dismiss Scan';
        }

        // Apply styles to elements
        if (modalContainer) {
            modalContainer.style.borderColor = themeColor;
            modalContainer.style.boxShadow = `0 20px 50px ${themeGlow}`;
        }
        if (modalHeader) {
            modalHeader.style.color = themeColor;
        }
        if (rejectBtn) {
            rejectBtn.style.backgroundColor = themeColor;
            rejectBtn.style.borderColor = themeColor;
            rejectBtn.textContent = btnText;
        }

        if (type === 'sku') {
            warningTitleText.textContent = "Another Item Detected!";
            warningDescText.textContent = "Scanned serial barcode does not belong to this shipment item's SKU pattern.";
            warningExpectedLabel.textContent = "EXPECTED SKU FILTER:";
            warningExpectedSku.textContent = expected;
            warningScannedLabel.textContent = "SCANNED BARCODE:";
            warningScannedSerial.textContent = scanned;
        } else if (type === 'length') {
            if (isSameProductLengthError) {
                warningTitleText.textContent = "Incomplete Barcode Scan!";
                warningDescText.textContent = "Barcode letters match this product, but some characters are missing (short length).";
            } else {
                warningTitleText.textContent = "Incorrect Barcode Format!";
                warningDescText.textContent = "Scanned serial barcode length does not match the locked session length.";
            }

            warningExpectedLabel.textContent = "EXPECTED LENGTH:";
            warningExpectedSku.textContent = `${expected} Characters`;
            warningScannedLabel.textContent = "SCANNED BARCODE:";
            warningScannedSerial.textContent = `${scanned} (${scanned.length} Characters)`;
        } else if (type === 'duplicate') {
            warningTitleText.textContent = "Duplicate Barcode Detected!";
            warningDescText.textContent = "This serial barcode is already scanned in a previous Box in this session.";
            warningExpectedLabel.textContent = "ALREADY REGISTERED IN:";
            warningExpectedSku.textContent = `Box ${expected}`;
            warningScannedLabel.textContent = "DUPLICATE BARCODE:";
            warningScannedSerial.textContent = scanned;
        } else if (type === 'duplicate-seq') {
            warningTitleText.textContent = "Duplicate Barcode in Sequence!";
            warningDescText.textContent = "A generated sequence barcode matches a previously scanned item.";
            warningExpectedLabel.textContent = "CONFLICTING BOX:";
            warningExpectedSku.textContent = `Box ${expected}`;
            warningScannedLabel.textContent = "DUPLICATE BARCODE:";
            warningScannedSerial.textContent = scanned;
        } else if (type === 'duplicate-batch') {
            warningTitleText.textContent = "Duplicate in Generator Batch!";
            warningDescText.textContent = "The sequence generator created duplicate barcodes within this batch.";
            warningExpectedLabel.textContent = "CURRENT BOX:";
            warningExpectedSku.textContent = `Box ${expected}`;
            warningScannedLabel.textContent = "DUPLICATE BARCODE:";
            warningScannedSerial.textContent = scanned;
        }

        skuWarningModal.classList.add('active');
    }

    // Generic SKU Warning Modal for Outbound Workstation
    function showSkuWarningModal(title, desc, expectedLabel, expectedVal, scannedLabel, scannedVal, showAllowLengthBtn, showAddBtn, extraVal) {
        if (title.includes('Deleted')) {
            triggerSpeak("deleted serial");
        } else if (title.includes('Already Dispatched')) {
            triggerSpeak("already dispatched");
        } else if (title.includes('Already Inbound')) {
            triggerSpeak("already inbound");
        } else if (title.includes('Duplicate')) {
            triggerSpeak("duplicate scan");
        } else if (title.includes('Unrecognized')) {
            triggerSpeak("unrecognized barcode");
        } else if (title.includes('Invalid')) {
            triggerSpeak("invalid serial");
        }
        if (!skuWarningModal) return;
        if (!title.includes('Deleted') && deletedSerialDismissTimer) {
            clearTimeout(deletedSerialDismissTimer);
            deletedSerialDismissTimer = null;
        }

        const modalContainer = skuWarningModal.querySelector('.modal-card');
        const modalHeader = skuWarningModal.querySelector('.modal-header');
        const rejectBtn = document.getElementById('rejectScanBtn');

        // Apply theme styling based on warning type
        let themeColor = 'var(--accent-rose)';
        let themeGlow = 'rgba(244, 63, 94, 0.15)';
        let btnText = 'Reject & Dismiss Scan';
        if (title.includes('Duplicate')) {
            themeColor = 'var(--accent-purple)';
            themeGlow = 'rgba(139, 92, 246, 0.15)';
            btnText = 'Dismiss Duplicate Scan';
        } else if (title.includes('Incomplete')) {
            themeColor = 'var(--accent-amber)';
            themeGlow = 'rgba(245, 158, 11, 0.15)';
            btnText = 'Dismiss & Re-scan';
        } else if (title.includes('Deleted')) {
            themeColor = 'var(--accent-rose)';
            themeGlow = 'rgba(244, 63, 94, 0.15)';
            btnText = 'Reject';
        } else if (showAddBtn) {
            themeColor = 'var(--accent-rose)';
            themeGlow = 'rgba(244, 63, 94, 0.15)';
            btnText = 'Reject Scan';
        }
        if (modalContainer) {
            modalContainer.style.borderColor = themeColor;
            modalContainer.style.boxShadow = `0 20px 50px ${themeGlow}`;
        }
        if (modalHeader) {
            modalHeader.style.color = themeColor;
        }
        if (rejectBtn) {
            rejectBtn.style.backgroundColor = themeColor;
            rejectBtn.style.borderColor = themeColor;
            rejectBtn.textContent = btnText;
        }

        // Make modal card wider if adding another product to outbound session
        if (showAddBtn) {
            if (modalContainer) {
                modalContainer.style.maxWidth = '620px';
            }
            
            // Raw detected serial is passed in extraVal
            const detectedSerial = extraVal || scannedVal;
            let detectedProduct = lookupProductBySerial(detectedSerial) || lookupProductBySkuPattern(detectedSerial) || 'Unknown Product';
            
            // Find box number of the detected serial from Inbound history
            let detectedBoxNo = 'N/A';
            const inboundHistory = getHistory();
            for (const log of inboundHistory) {
                if (log.serials) {
                    const match = log.serials.find(s => s.serial === detectedSerial);
                    if (match) {
                        detectedBoxNo = match.boxNo || 'N/A';
                        break;
                    }
                }
            }

            // Find last scan details of the active outbound session
            const lastSerialObj = (activeOutboundSession && activeOutboundSession.serials.length > 0)
                ? activeOutboundSession.serials[activeOutboundSession.serials.length - 1]
                : null;
            desc = `
                <div style="font-size: 0.9rem; line-height: 1.4; color: var(--text-secondary); margin-bottom: 12px;">
                    Warning: Scanned serial barcode does not belong to any of the products currently in this outbound dispatch.
                </div>
                <div style="display: flex; gap: 16px; margin: 12px 0; width: 100%; text-align: left;">
                    <!-- Last Scan Card -->
                    <div style="flex: 1; background: rgba(59, 130, 246, 0.04); border: 1px solid rgba(59, 130, 246, 0.15); padding: 12px; border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 0.72rem; color: var(--accent-blue); font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">Last Session Scan</span>
                        <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-primary); word-break: break-all; font-family: var(--font-mono);">${lastSerialObj ? lastSerialObj.serial : 'N/A'}</div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary); font-weight: 600;">${lastSerialObj ? lastSerialObj.itemName : 'No items scanned yet'}</div>
                        <div style="font-size: 0.8rem; color: var(--text-muted);">Box Number: <strong style="color: var(--text-secondary);">${lastSerialObj ? lastSerialObj.boxNo : 'N/A'}</strong></div>
                    </div>
                </div>
            `;
        } else {
            if (modalContainer) {
                modalContainer.style.maxWidth = '460px';
            }
        }

        if (warningTitleText) warningTitleText.textContent = title;
        if (warningDescText) warningDescText.innerHTML = desc;
        if (warningExpectedLabel) warningExpectedLabel.textContent = expectedLabel;
        if (warningExpectedSku) warningExpectedSku.textContent = expectedVal;
        if (warningScannedLabel) warningScannedLabel.textContent = scannedLabel;
        if (warningScannedSerial) warningScannedSerial.textContent = scannedVal;

        const warningExtraRow = document.getElementById('warningExtraRow');
        const warningExtraLabel = document.getElementById('warningExtraLabel');
        const warningExtraSerial = document.getElementById('warningExtraSerial');
        if (warningExtraRow && warningExtraLabel && warningExtraSerial) {
            if (extraVal) {
                warningExtraRow.style.display = 'flex';
                warningExtraLabel.textContent = 'SCANNED BARCODE:';
                warningExtraSerial.textContent = extraVal;
            } else {
                warningExtraRow.style.display = 'none';
            }
        }

        if (allowLengthBtn) {
            if (showAllowLengthBtn) {
                allowLengthBtn.style.display = 'block';
                allowLengthBtn.style.borderColor = 'var(--accent-emerald)';
                allowLengthBtn.style.color = 'var(--accent-emerald)';
                allowLengthBtn.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
                allowLengthBtn.textContent = 'Allow & Save SKU Pattern';
            } else {
                allowLengthBtn.style.display = 'none';
            }
        }

        if (warningAddProductBtn) {
            if (showAddBtn) {
                warningAddProductBtn.style.display = 'block';
                warningAddProductBtn.style.borderColor = 'var(--accent-blue)';
                warningAddProductBtn.style.color = 'var(--accent-blue)';
                warningAddProductBtn.style.backgroundColor = 'rgba(59, 130, 246, 0.05)';
                warningAddProductBtn.textContent = 'Add Product';
            } else {
                warningAddProductBtn.style.display = 'none';
            }
        }

        // Setup double-scan gesture inputs inside the warning modal
        const warningModalInputContainer = document.getElementById('warningModalInputContainer');
        if (warningModalInputContainer) {
            warningModalInputContainer.style.display = showAddBtn ? 'flex' : 'none';
        }

        if (warningModalConfirmInput) {
            warningModalConfirmInput.value = '';
            warningModalConfirmInput.onkeydown = null;
            if (showAddBtn) {
                setTimeout(() => {
                    warningModalConfirmInput.focus();
                }, 50);

                let sequenceStep = 1; 
                const lastSessionSerial = (activeOutboundSession && activeOutboundSession.serials.length > 0)
                    ? activeOutboundSession.serials[activeOutboundSession.serials.length - 1].serial
                    : null;
                const detectedSerial = extraVal || scannedVal;

                // Configure guidance label
                const guidanceLabel = document.querySelector('label[for="warningModalConfirmInput"]');
                if (guidanceLabel) {
                    if (lastSessionSerial) {
                        guidanceLabel.innerHTML = `To confirm add, scan <strong>Last Session Serial (${lastSessionSerial})</strong> first:`;
                        sequenceStep = 1;
                    } else {
                        guidanceLabel.innerHTML = `To confirm add, scan <strong>Detected Serial (${detectedSerial})</strong> to complete:`;
                        sequenceStep = 2; // skip to step 2 if no last scanned item exists
                    }
                }

                warningModalConfirmInput.onkeydown = (evt) => {
                    if (evt.key === 'Enter') {
                        evt.preventDefault();
                        const val = warningModalConfirmInput.value.trim();
                        if (!val) return;
                        
                        // 1. Check for reject scan gesture (scanning the same detected serial while in Step 1)
                        if (sequenceStep === 1 && val === detectedSerial) {
                            skuWarningModal.classList.remove('active');
                            if (deletedSerialDismissTimer) {
                                clearTimeout(deletedSerialDismissTimer);
                                deletedSerialDismissTimer = null;
                            }
                            refocusOutboundInput();
                            return;
                        }

                        // 2. Sequence verification (Step 1 or Step 2)
                        if (sequenceStep === 1) {
                            if (val === lastSessionSerial) {
                                sequenceStep = 2;
                                warningModalConfirmInput.value = '';
                                if (guidanceLabel) {
                                    guidanceLabel.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 700;">Step 1 Confirmed!</span> Now scan <strong>Detected Serial (${detectedSerial})</strong> to complete:`;
                                }
                                if (warningDescText) {
                                    warningDescText.innerHTML += `<br><strong style="color: var(--accent-emerald); display: block; margin-top: 10px;">Step 1 Verified! Please scan detected serial next...</strong>`;
                                }
                                return;
                            }
                        } else if (sequenceStep === 2) {
                            if (val === detectedSerial) {
                                // Add product!
                                if (warningAddProductBtn) warningAddProductBtn.click();
                                return;
                            }
                        }
                        
                        // 3. Incorrect scan alerts for sequence steps (non-blocking)
                        if (sequenceStep === 1) {
                            warningModalConfirmInput.value = '';
                            if (guidanceLabel) {
                                guidanceLabel.innerHTML = `To confirm add, scan <strong>Last Session Serial (${lastSessionSerial})</strong> first:<br><span style="color: var(--accent-rose); font-size: 0.8rem; font-weight: 700; display: block; margin-top: 4px;">Incorrect scan! Please scan Last Session Serial or same Detected Serial to Reject.</span>`;
                            }
                        } else if (sequenceStep === 2) {
                            warningModalConfirmInput.value = '';
                            if (guidanceLabel) {
                                guidanceLabel.innerHTML = `<span style="color: var(--accent-emerald); font-weight: 700;">Step 1 Confirmed!</span> Now scan <strong>Detected Serial (${detectedSerial})</strong> to complete:<br><span style="color: var(--accent-rose); font-size: 0.8rem; font-weight: 700; display: block; margin-top: 4px;">Incorrect scan! Please scan Detected Serial.</span>`;
                            }
                        }                    }
                };
            }
        }

        skuWarningModal.classList.add('active');
    }

    function saveHistory(historyData) {
        cachedInboundHistory = historyData;
        inboundSerialLogMap = null;
        weightResolutionCache = null;
        cachedProductStockMap = null;
        localStorage.setItem('wms_inbound_history', JSON.stringify(historyData));
        firebaseSet('inbound_history', historyData);
    }

    function getHistory() {
        if (cachedInboundHistory !== null) {
            return cachedInboundHistory;
        }
        const saved = localStorage.getItem('wms_inbound_history');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    cachedInboundHistory = parsed;
                    return cachedInboundHistory;
                }
            } catch (e) {
                console.error("Error parsing wms_inbound_history:", e);
            }
        }
        cachedInboundHistory = [];
        return cachedInboundHistory;
    }

    function renderHistoryTable() {
        if (!inboundHistoryBody) return;
        inboundHistoryBody.innerHTML = '';
        const mobileContainer = document.getElementById('inboundHistoryMobileCards');
        if (mobileContainer) {
            mobileContainer.innerHTML = '';
        }
        
        const historyData = getHistory();
        let needsUpdate = false;
        
        const trFrag = document.createDocumentFragment();
        const mobileFrag = document.createDocumentFragment();

        // High Performance Optimization: Limit initial rendering to top 100 recent entries to prevent main thread blocking
        const renderLimit = 100;
        const displayData = historyData.slice(0, renderLimit);

        displayData.forEach((row, idx) => {
            const tr = document.createElement('tr');
            const vehicleDisplay = row.vehicle === 'Not Specified' ? '<span class="text-muted">Not Specified</span>' : row.vehicle;
            
            // Assign unique ID to legacy mock logs if missing
            if (!row.id) {
                row.id = `log_${idx}_${Date.now()}`;
                row.items = [{ name: row.item, expectedQty: row.expected }];
                row.serials = [];
                needsUpdate = true;
                // generate dummy serials for default rows
                for (let i = 1; i <= row.count; i++) {
                    row.serials.push({
                        serial: `GXTFT185VCPB${602280 + i}`,
                        boxNo: Math.ceil(i / 5),
                        itemName: row.item
                    });
                }
            }
            
            const itemsList = row.items || [{ name: row.item, expectedQty: row.expected }];
            const itemsHtml = itemsList.map(item => {
                const weight = resolveLogWeight(row, item.name);
                const weightLabel = (weight !== undefined) ? ` (${weight} kg)` : ' (Set Weight)';
                const badgeStyle = weight 
                    ? 'background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); color: var(--accent-emerald);' 
                    : 'background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); color: var(--accent-blue);';
                
                return `
                    <button type="button" class="btn-item-weight-trigger" data-log-id="${row.id}" data-item-name="${escapeHtmlAttr(item.name)}" style="${badgeStyle} padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; transition: var(--transition-smooth); gap: 4px; margin-right: 6px; margin-bottom: 4px; border-style: solid;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 12px; height: 12px; stroke-width: 2.5;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1M12 20v1M4 12H3m18 0h-1M6.343 6.343l.707.707M16.95 16.95l.707.707M6.343 17.657l-.707-.707m11.314-11.314l-.707.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
                        </svg>
                        ${item.name}${weightLabel}
                    </button>
                `;
            }).join('');

            let finalBoxCount = row.boxCount;
            if ((!finalBoxCount || finalBoxCount <= 0) && row.serials && row.serials.length > 0) {
                const uniqueBoxes = new Set(row.serials.map(s => s.boxNo));
                finalBoxCount = uniqueBoxes.size;
            }
            if (!finalBoxCount || finalBoxCount < 0) {
                finalBoxCount = 0;
            }

            let countDisplay = `${row.count} PCs (${finalBoxCount} Boxes)`;
            if (row.expected > 0) {
                countDisplay = `${row.count} / ${row.expected} PCs (${finalBoxCount} Boxes)`;
            }

            tr.innerHTML = `
                <td class="font-mono">${row.timestamp}</td>
                <td>${vehicleDisplay}</td>
                <td style="max-width: 240px; white-space: normal; word-break: break-word;">${itemsHtml}</td>
                <td class="font-mono">${countDisplay}</td>
                <td>
                    <button type="button" class="btn-download-excel" data-id="${row.id}" title="Download Excel Report" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-emerald); color: var(--accent-emerald); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: var(--transition-smooth); border-style: solid;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Excel
                    </button>
                    <button type="button" class="btn-delete-inbound-log" data-id="${row.id}" title="Delete Inbound Session" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); color: var(--accent-rose); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: var(--transition-smooth); border-style: solid; margin-left: 6px;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                    </button>
                </td>
            `;
            trFrag.appendChild(tr);

            // Generate Inbound Card HTML (Matching Outbound Card Style)
            if (mobileContainer) {
                const card = document.createElement('div');
                card.className = 'mobile-log-card';
                card.style.cssText = `
                    background: var(--bg-secondary);
                    border: 1px solid var(--border-color);
                    border-radius: 12px;
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    box-sizing: border-box;
                    width: 100%;
                    min-width: 0;
                    overflow: hidden;
                `;
                
                const mobileItemsHtml = itemsList.map(item => {
                    const weight = resolveLogWeight(row, item.name);
                    const weightLabel = (weight !== undefined) ? ` (${weight} kg)` : ' (Set Weight)';
                    const badgeStyle = weight 
                        ? 'background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); color: var(--accent-emerald);' 
                        : 'background: rgba(59, 130, 246, 0.08); border: 1px solid rgba(59, 130, 246, 0.2); color: var(--accent-blue);';
                    
                    return `
                        <div style="display: flex; align-items: flex-start; gap: 6px; font-size: 0.82rem; color: var(--text-primary); font-weight: 600; line-height: 1.35; word-break: break-word;">
                            <span style="color: #f43f5e; font-size: 0.7rem; margin-top: 3px; flex-shrink: 0;">●</span>
                            <button type="button" class="btn-item-weight-trigger" data-log-id="${row.id}" data-item-name="${escapeHtmlAttr(item.name)}" style="${badgeStyle} padding: 3px 7px; border-radius: var(--radius-sm); font-size: 0.75rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; border-style: solid; text-align: left; white-space: normal; word-break: break-word;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 10px; height: 10px; stroke-width: 2.5; flex-shrink: 0;">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1M12 20v1M4 12H3m18 0h-1M6.343 6.343l.707.707M16.95 16.95l.707.707M6.343 17.657l-.707-.707m11.314-11.314l-.707.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
                                </svg>
                                <span>${item.name}${weightLabel}</span>
                            </button>
                        </div>
                    `;
                }).join('');

                // Format Full Date + Time Display
                let timestampDisplay = row.timestamp || 'N/A';
                let fullDateStr = '';
                if (row.date) {
                    fullDateStr = row.date;
                } else if (row.id && !isNaN(parseInt(String(row.id).replace('log_', '')))) {
                    const d = new Date(parseInt(String(row.id).replace('log_', '')));
                    const day = String(d.getDate()).padStart(2, '0');
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const month = months[d.getMonth()];
                    const year = d.getFullYear();
                    fullDateStr = `${day} ${month} ${year}`;
                }
                const fullDateTimeDisplay = fullDateStr ? `${fullDateStr} • ${timestampDisplay}` : timestampDisplay;
                const vehicleText = row.vehicle && row.vehicle !== 'Not Specified' ? row.vehicle : 'Not Specified';

                card.innerHTML = `
                    <!-- 1. Top Header: Vehicle No. + Distinct PCs Badge -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; width: 100%;">
                        <h4 style="font-size: 1.05rem; font-weight: 800; color: #ffffff; margin: 0; line-height: 1.3; flex: 1; word-break: break-word; letter-spacing: 0.01em;">Vehicle: ${vehicleText}</h4>
                        <span style="font-size: 0.82rem; font-weight: 800; color: #10b981; font-family: var(--font-mono); white-space: nowrap; flex-shrink: 0; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); padding: 4px 10px; border-radius: 6px; text-transform: uppercase;">${row.count} PCs</span>
                    </div>

                    <!-- 2. Sub-header Row: Full Date + Time • INBOUND Badge -->
                    <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 4px; font-size: 0.82rem;">
                        <span style="color: #8a8f9e; font-weight: 500;">${fullDateTimeDisplay}</span>
                        <span style="background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.35); padding: 2px 8px; border-radius: 4px; font-size: 0.7rem; font-weight: 800; text-transform: uppercase;">INBOUND</span>
                    </div>

                    <!-- 3. Full Inner Product Box -->
                    <div style="background: rgba(0, 0, 0, 0.35); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; margin-top: 4px;">
                        <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
                            ${mobileItemsHtml}
                        </div>

                        <div style="border-top: 1px dashed var(--border-color); margin: 2px 0;"></div>

                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;">
                            <span style="color: #8a8f9e; font-weight: 500;">Total Boxes:</span>
                            <span style="color: #10b981; font-weight: 800; font-family: var(--font-mono); font-size: 0.95rem;">${finalBoxCount} Boxes</span>
                        </div>
                    </div>

                    <!-- 4. Action Buttons Row (Excel, Delete - Always Positioned at Very Bottom) -->
                    <div style="display: flex; gap: 8px; width: 100%; margin-top: auto; padding-top: 12px;">
                        <button type="button" class="btn-download-excel" data-id="${row.id}" style="flex: 1; background: rgba(16, 185, 129, 0.08); border: 1px solid #10b981; color: #10b981; padding: 8px 6px; border-radius: 6px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            <span>Excel</span>
                        </button>
                        <button type="button" class="btn-delete-inbound-log" data-id="${row.id}" style="flex: 1; background: rgba(244, 63, 94, 0.08); border: 1px solid #f43f5e; color: #f43f5e; padding: 8px 6px; border-radius: 6px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Delete</span>
                        </button>
                    </div>
                `;
                mobileFrag.appendChild(card);
            }
        });

        inboundHistoryBody.appendChild(trFrag);
        if (mobileContainer) {
            mobileContainer.appendChild(mobileFrag);
        }

        // Save updated mock logs back to storage only if we modified them
        if (needsUpdate) {
            saveHistory(historyData);
        }
    }

    // --- Excel Report Download (SheetJS Multiple Tabs integration) ---
    function downloadLogExcel(log) {
        if (!window.XLSX) {
            alert('Excel utility library not loaded. Please verify internet connection.');
            return;
        }

        // Create new Excel Workbook
        const wb = XLSX.utils.book_new();
        
        const items = log.items || [{ name: log.item || 'Product', expectedQty: log.expected }];
        const serials = log.serials || [];

        items.forEach(item => {
            // Filter serials matching this item name
            const itemSerials = serials.filter(s => s.itemName === item.name);
            
            // Map serial data to sheet rows
            let sheetRows = [];
            if (itemSerials.length > 0) {
                sheetRows = itemSerials.map((s, idx) => ({
                    "S.No.": idx + 1,
                    "Box Number": `Box ${s.boxNo}`,
                    "Serial Number": s.serial,
                    "Product Name": s.itemName
                }));
            } else if (log.count > 0) {
                // If it is a WOS log, generate rows distributed across box count
                const boxCount = log.boxCount || 1;
                const baseQtyPerBox = Math.floor(log.count / boxCount);
                let remainder = log.count % boxCount;

                let rowIdx = 1;
                for (let b = 1; b <= boxCount; b++) {
                    const pcsInThisBox = baseQtyPerBox + (remainder > 0 ? 1 : 0);
                    remainder--;

                    for (let p = 1; p <= pcsInThisBox; p++) {
                        sheetRows.push({
                            "S.No.": rowIdx++,
                            "Box Number": `Box ${b}`,
                            "Serial Number": "Without Serial Number",
                            "Product Name": item.name
                        });
                    }
                }
            } else {
                sheetRows.push({
                    "S.No.": 1,
                    "Box Number": "N/A",
                    "Serial Number": "No serial numbers scanned",
                    "Product Name": item.name
                });
            }

            const ws = XLSX.utils.json_to_sheet(sheetRows);
            
            // Clean sheet name (SheetJS limits sheet tab names to max 31 characters)
            let sheetName = item.name.replace(/[\\\/\?\*\[\]\:]/g, "").substring(0, 30);
            if (!sheetName.trim()) {
                sheetName = "Scanned Serials";
            }

            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        });

        // Generate download filename based on vehicle and timestamp
        const safeVehicle = (log.vehicle || 'Not_Specified').replace(/[^a-zA-Z0-9]/g, '_');
        const safeTime = log.timestamp.replace(/\:/g, '-');
        const filename = `Inbound_Report_${safeVehicle}_${safeTime}`.toUpperCase() + ".xlsx";

        // Write file and trigger save prompt in browser
        XLSX.writeFile(wb, filename);
        console.log(`Excel file "${filename}" downloaded successfully with ${items.length} product sheets.`);
    }

    function deleteInboundSessionFromHistory(logId) {
        if (!confirm("Are you sure you want to permanently delete this completed inbound session? All scanned serials in this session will be removed from the stock register.")) {
            return;
        }

        const historyData = getHistory();
        const updated = historyData.filter(log => log.id !== logId);
        
        saveHistory(updated);
        renderHistoryTable();
        renderInventoryPanel();
    }

    // Bind event listener to Completed logs list for Excel downloads and Deletions (Both Desktop table and Mobile cards)
    const inboundTargets = ['inboundHistoryBody', 'inboundHistoryMobileCards'];
    inboundTargets.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-download-excel');
                if (btn) {
                    e.stopPropagation();
                    const logId = btn.getAttribute('data-id');
                    const historyData = getHistory();
                    const logItem = historyData.find(item => item.id === logId);
                    
                    if (logItem) {
                        downloadLogExcel(logItem);
                    } else {
                        alert('Completed log entry not found.');
                    }
                }

                const deleteBtn = e.target.closest('.btn-delete-inbound-log');
                if (deleteBtn) {
                    e.stopPropagation();
                    const logId = deleteBtn.getAttribute('data-id');
                    deleteInboundSessionFromHistory(logId);
                }
            });
        }
    });

    // Render scanned serials grouped by Box Card inside product columns
    function renderBoxCards() {
        if (!sessionBoxesContainer) return;
        sessionBoxesContainer.innerHTML = '';

        if (!activeSession || activeSession.serials.length === 0) {
            sessionBoxesContainer.innerHTML = `
                <div id="emptyScannedState" style="text-align: center; color: var(--text-muted); padding: 48px 24px; width: 100%;">
                    No serials scanned yet. Start scanning or generating above.
                </div>
            `;
            return;
        }

        const itemsList = activeSession.items || [];
        const mainFrag = document.createDocumentFragment();

        // Pre-group serials by itemName for O(1) lookup
        const serialsByItemNameMap = new Map();
        (activeSession.serials || []).forEach(s => {
            if (s && s.itemName) {
                let list = serialsByItemNameMap.get(s.itemName);
                if (!list) {
                    list = [];
                    serialsByItemNameMap.set(s.itemName, list);
                }
                list.push(s);
            }
        });

        itemsList.forEach(activeItem => {
            // Find all scanned serials belonging to this item
            const itemSerials = serialsByItemNameMap.get(activeItem.name) || [];
            
            // Calculate item-specific pieces and unique boxes count
            const itemPieces = itemSerials.length;
            const uniqueBoxesSet = new Set(itemSerials.map(s => s.boxNo));
            const itemBoxes = uniqueBoxesSet.size;

            // Create column container element
            const col = document.createElement('div');
            col.className = 'product-scan-column';
            col.style.cssText = 'display: flex; flex-direction: column; gap: 16px; border: 1px solid var(--border-color); padding: 16px; border-radius: var(--radius-md); background: rgba(255,255,255,0.01); min-width: 300px; flex: 1 1 0px; height: 100%; overflow: hidden;';

            // Column Header
            col.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                    <div style="font-weight: 700; color: var(--text-primary); font-size: 0.9rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1;" title="${activeItem.name}">
                        ${activeItem.name}
                    </div>
                    <div style="display: flex; gap: 6px; flex-shrink: 0;">
                        <span class="count-badge-pcs" style="font-size: 0.7rem; font-weight: 700; background: rgba(59,130,246,0.1); color: var(--accent-blue); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(59,130,246,0.2);">
                            PCs: ${itemPieces}
                        </span>
                        <span class="count-badge-boxes" style="font-size: 0.7rem; font-weight: 700; background: rgba(16,185,129,0.1); color: var(--accent-emerald); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16,185,129,0.2);">
                            BOXes: ${itemBoxes}
                        </span>
                    </div>
                </div>
            `;

            // Scrollable list container for Box cards of this product
            const boxListWrapper = document.createElement('div');
            boxListWrapper.className = 'product-boxes-list';
            boxListWrapper.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px; margin-top: 10px;';

            if (itemSerials.length === 0) {
                boxListWrapper.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 48px 12px;">
                        No serials scanned for this item yet.
                    </div>
                `;
            } else {
                // Group itemSerials by boxNo: { boxNo: [item1, item2] }
                const groups = {};
                itemSerials.forEach(s => {
                    if (!groups[s.boxNo]) {
                        groups[s.boxNo] = [];
                    }
                    groups[s.boxNo].push(s);
                });

                // Sort box numbers from highest to lowest (newest box on top)
                const boxNumbers = Object.keys(groups).map(Number).sort((a, b) => b - a);
                const MAX_VISIBLE_BOXES = activeItem.showAllBoxes ? boxNumbers.length : 40;
                const visibleBoxNumbers = boxNumbers.slice(0, MAX_VISIBLE_BOXES);
                const boxesFrag = document.createDocumentFragment();

                visibleBoxNumbers.forEach(boxNo => {
                    const boxItems = groups[boxNo];
                    const boxCard = document.createElement('div');
                    boxCard.className = 'box-card';
                    boxCard.style.cssText = 'margin-bottom: 0;';
                    boxCard.id = `box-card-${boxNo}-${activeItem.name.replace(/\s+/g, '-')}`;

                    // Box Card Header
                    boxCard.innerHTML = `
                        <div class="box-card-header" style="padding-bottom: 8px; margin-bottom: 8px;">
                            <div class="box-card-title">
                                <h3 style="font-size: 0.95rem;">Box ${boxNo}</h3>
                                <span class="box-badge" style="font-size: 0.7rem; padding: 2px 6px;">${boxItems.length} ${boxItems.length === 1 ? 'Item' : 'Items'}</span>
                            </div>
                            <button type="button" class="btn-delete-box" data-box="${boxNo}" data-item-name="${escapeHtmlAttr(activeItem.name)}" title="Delete items of this product from Box ${boxNo}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px;">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                            </button>
                        </div>
                    `;

                    // Serials List
                    const listContainer = document.createElement('div');
                    listContainer.className = 'box-serials-list';
                    const serialsFrag = document.createDocumentFragment();

                    boxItems.forEach(s => {
                        const row = document.createElement('div');
                        row.className = 'serial-item-row';
                        row.style.cssText = 'padding: 6px 8px; font-size: 0.85rem;';
                        row.innerHTML = `
                            <span class="serial-item-text font-mono">${s.serial}</span>
                            <button type="button" class="btn-delete-serial" data-serial="${s.serial}" title="Remove serial">&times;</button>
                        `;
                        serialsFrag.appendChild(row);
                    });

                    listContainer.appendChild(serialsFrag);
                    boxCard.appendChild(listContainer);
                    boxesFrag.appendChild(boxCard);
                });

                boxListWrapper.appendChild(boxesFrag);

                if (boxNumbers.length > MAX_VISIBLE_BOXES) {
                    const loadMoreBtn = document.createElement('button');
                    loadMoreBtn.type = 'button';
                    loadMoreBtn.className = 'btn-load-more-boxes';
                    loadMoreBtn.style.cssText = 'background: rgba(59, 130, 246, 0.1); border: 1px solid var(--accent-blue); color: var(--accent-blue); padding: 8px 12px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; margin-top: 8px; width: 100%; text-align: center; font-family: var(--font-mono);';
                    loadMoreBtn.textContent = `📦 Showing top 40 of ${boxNumbers.length} boxes (Click to show all ${boxNumbers.length} boxes)`;
                    loadMoreBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        activeItem.showAllBoxes = true;
                        renderBoxCards();
                    });
                    boxListWrapper.appendChild(loadMoreBtn);
                }
            }

            col.appendChild(boxListWrapper);
            mainFrag.appendChild(col);
        });

        sessionBoxesContainer.appendChild(mainFrag);
    }

    function updateWorkstationProductSelector() {
        if (!activeSession) return;

        const workstationProductSelectorGroup = document.getElementById('workstationProductSelectorGroup');
        const workstationProductSelect = document.getElementById('workstationProductSelect');

        if (!workstationProductSelectorGroup || !workstationProductSelect) return;

        const items = activeSession.items || [];

        if (items.length > 1) {
            // Show the selector group
            workstationProductSelectorGroup.style.display = 'block';
            
            // Re-populate options, keeping current selection if valid
            const currentVal = workstationProductSelect.value;
            workstationProductSelect.innerHTML = '';

            items.forEach(item => {
                const opt = document.createElement('option');
                opt.value = item.name;
                const patternStr = item.skuAlphabetPattern ? formatAlphabetPattern(item.skuAlphabetPattern, item.lockedLength) : 'Not Locked';
                opt.textContent = `${item.name} (${patternStr})`;
                workstationProductSelect.appendChild(opt);
            });

            // Restore selection if possible, otherwise default to first item
            const itemExists = items.some(i => i.name === currentVal);
            if (itemExists) {
                workstationProductSelect.value = currentVal;
            } else {
                workstationProductSelect.value = items[0].name;
            }
        } else {
            // Hide if single product session
            workstationProductSelectorGroup.style.display = 'none';
        }
    }

    // Load Session State on Reload
    function restoreSessionState() {
        const savedSession = localStorage.getItem('wms_active_inbound_session');
        if (savedSession) {
            activeSession = JSON.parse(savedSession);
            if (activeSession && !activeSession.items) {
                activeSession.items = [];
            }
            
            // Backward compatibility conversion of legacy format to items array format
            if (!activeSession.items && activeSession.item) {
                activeSession.items = [{
                    name: activeSession.item,
                    expectedQty: activeSession.expectedQty || 10,
                    skuAlphabetPattern: activeSession.skuAlphabetPattern || null,
                    lockedLength: activeSession.lockedLength || null,
                    scannedCount: activeSession.serials ? activeSession.serials.length : 0
                }];
            }

            // Lock and update active session display labels
            if (activeSessionVehicle) {
                activeSessionVehicle.textContent = activeSession.vehicle || 'Not Specified';
            }

            // Sanitize activeSession.items properties to prevent undefined/NaN errors
            if (activeSession.items) {
                activeSession.items.forEach(item => {
                    if (item) {
                        item.expectedQty = parseInt(item.expectedQty) || 0;
                        if (item.skuAlphabetPattern && !item.allowedPatterns) {
                            item.allowedPatterns = [{
                                pattern: item.skuAlphabetPattern,
                                length: item.lockedLength || 15
                            }];
                        }
                        if (item.allowedPatterns) {
                            item.allowedPatterns = item.allowedPatterns.filter(cfg => cfg && cfg.length <= 50);
                        }
                        if (item.lockedLength > 50) {
                            item.lockedLength = null;
                            item.skuAlphabetPattern = null;
                            if (item.allowedPatterns) {
                                item.allowedPatterns = item.allowedPatterns.filter(cfg => cfg && cfg.length <= 50);
                            }
                        }
                    }
                });
            }

            if (!activeSession.serials) {
                activeSession.serials = [];
            }

            // Convert old string-array format to object-array format if loaded from old cache
            if (activeSession.serials && activeSession.serials.length > 0) {
                activeSession.serials = activeSession.serials.map((item, index) => {
                    if (typeof item === 'string') {
                        return { serial: item, boxNo: index + 1, itemName: activeSession.items[0].name };
                    }
                    if (!item.itemName) {
                        item.itemName = activeSession.items[0].name;
                    }
                    return item;
                });
            }

            if (activeSession.serials) {
                activeSession.serials = activeSession.serials.filter(s => s && s.serial && (s.serial.length <= 150 || s.serial.includes('WOS')));
            }

            sanitizeSessionItems(activeSession);
            compactBoxNumbers();
            updateSessionProgress();
            updateWorkstationProductSelector();
            
            // Render restored cards
            renderBoxCards();
            // Check join authorization
            const isJoined = localStorage.getItem('wms_inbound_joined') === 'true';
            if (isJoined) {
                inboundInactiveState.style.display = 'none';
                inboundActiveState.style.display = 'flex';
            } else {
                inboundActiveState.style.display = 'none';
                inboundInactiveState.style.display = 'block';
                // Show warning banner and hide start button/welcome
                const banner = document.getElementById('inboundAlreadyWorkingBanner');
                const welcome = document.getElementById('inboundWelcomeContainer');
                if (banner) banner.style.display = 'flex';
                if (welcome) welcome.style.display = 'none';
            }
        } else {
            localStorage.removeItem('wms_inbound_joined');
            inboundActiveState.style.display = 'none';
            inboundInactiveState.style.display = 'block';
            const banner = document.getElementById('inboundAlreadyWorkingBanner');
            const welcome = document.getElementById('inboundWelcomeContainer');
            if (banner) banner.style.display = 'none';
            if (welcome) welcome.style.display = 'flex';
        }
        const isInboundJoined = localStorage.getItem('wms_inbound_joined') === 'true';
        if (!isInboundJoined) {
            renderHistoryTable();
        }
    }

    // --- Modal Configuration Handlers ---
    // Open Inbound Configuration Modal or block if active session exists on another device
    if (startInboundSessionBtn && inboundConfigModal) {
        startInboundSessionBtn.addEventListener('click', () => {
            if (activeSession) {
                // If there's an active session on another device, click acts as Join Session prompt
                const pwd = prompt('Enter passcode (2026) to join the active Inbound session:');
                if (pwd === '2026') {
                    localStorage.setItem('wms_inbound_joined', 'true');
                    restoreSessionState();
                } else {
                    alert('Incorrect passcode.');
                }
            } else {
                inboundConfigModal.classList.add('active');
            }
        });
    }

    // Join Inbound Session Event Listener
    const btnJoinInboundSession = document.getElementById('btnJoinInboundSession');
    if (btnJoinInboundSession) {
        btnJoinInboundSession.addEventListener('click', () => {
            const pwd = prompt('Enter passcode (2026) to join the active Inbound session:');
            if (pwd === '2026') {
                localStorage.setItem('wms_inbound_joined', 'true');
                restoreSessionState();
            } else {
                alert('Incorrect passcode.');
            }
        });
    }
    // --- Custom Dropdown Item List Logic ---
    let inboundItems = [];

    function saveInboundItems() {
        localStorage.setItem('wms_inbound_items', JSON.stringify(inboundItems));
        firebaseSet('inbound_items', inboundItems);
    }

    function syncInventoryItemsToInboundList() {
        const uniqueItems = new Set();
        
        // Gather from Inbound History (only from serialized logs)
        const inboundHistory = getHistory();
        inboundHistory.forEach(log => {
            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    if (s.itemName) uniqueItems.add(s.itemName.trim());
                });
            }
        });

        // Gather from Outbound History (only from serialized logs)
        const outboundHistory = getOutboundHistory();
        outboundHistory.forEach(log => {
            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    if (s.itemName) uniqueItems.add(s.itemName.trim());
                });
            }
        });

        // Add any missing items to inboundItems list
        let updated = false;
        uniqueItems.forEach(item => {
            if (item && !inboundItems.includes(item)) {
                inboundItems.push(item);
                updated = true;
            }
        });

        if (updated) {
            saveInboundItems();
        }
    }

    function loadInboundItems() {
        const saved = localStorage.getItem('wms_inbound_items');
        if (saved) {
            inboundItems = JSON.parse(saved);
        } else {
            inboundItems = [];
        }
        syncInventoryItemsToInboundList();
    }

    function renderDropdownItems() {
        if (!configItemDropdownList) return;
        loadInboundItems();
        configItemDropdownList.innerHTML = '';

        inboundItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'custom-dropdown-item';
            li.setAttribute('data-value', item);
            
            li.innerHTML = `
                <span class="custom-dropdown-item-text">${item}</span>
                <button type="button" class="btn-delete-dropdown-item" data-item="${item}" title="Delete Item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            `;

            // Selection trigger on text click
            const textSpan = li.querySelector('.custom-dropdown-item-text');
            if (textSpan) {
                textSpan.addEventListener('click', () => {
                    selectDropdownItem(item);
                    closeDropdownMenu();
                });
            }

            // Secure deletion trigger on delete button click
            const deleteBtn = li.querySelector('.btn-delete-dropdown-item');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation(); // Avoid triggering trigger toggle or selection click
                    
                    const pwd = prompt(`Enter password to delete item "${item}":`);
                    if (pwd === '2026') {
                        inboundItems = inboundItems.filter(i => i !== item);
                        saveInboundItems();
                        renderDropdownItems();
                        
                        // Reset if active item was deleted
                        if (configItemSelect && configItemSelect.value === item) {
                            configItemSelect.value = '';
                            if (configItemDropdownSelectedText) configItemDropdownSelectedText.textContent = 'Choose an item...';
                        }
                    } else if (pwd !== null) {
                        alert('Incorrect password! Item was not deleted.');
                    }
                });
            }

            configItemDropdownList.appendChild(li);
        });
    }

    function selectDropdownItem(item) {
        if (configItemSelect) configItemSelect.value = item;
        if (configItemDropdownSelectedText) configItemDropdownSelectedText.textContent = item;
    }

    function toggleDropdownMenu() {
        if (configItemDropdownContainer) {
            configItemDropdownContainer.classList.toggle('active');
        }
    }

    // Close Dropdown Menu Helper
    function closeDropdownMenu() {
        if (configItemDropdownContainer) {
            configItemDropdownContainer.classList.remove('active');
        }
    }

    // Bind trigger toggle click
    if (configItemDropdownTrigger) {
        configItemDropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleDropdownMenu();
        });
    }



    // Initialize custom dropdown
    loadInboundItems();
    renderDropdownItems();

    // Close Inbound Configuration Modal
    function closeConfigModal() {
        if (inboundConfigModal) {
            inboundConfigModal.classList.remove('active');
            inboundConfigForm.reset();
            // Reset custom selection state
            if (configItemSelect) configItemSelect.value = '';
            if (configItemDropdownSelectedText) configItemDropdownSelectedText.textContent = 'Choose an item...';
            closeDropdownMenu();
        }
    }
    if (closeInboundConfigModalBtn) closeInboundConfigModalBtn.addEventListener('click', closeConfigModal);
    if (cancelInboundConfigModalBtn) cancelInboundConfigModalBtn.addEventListener('click', closeConfigModal);

    // Open Add Item Modal from config
    if (openAddItemModalBtnInModal && addItemModal) {
        openAddItemModalBtnInModal.addEventListener('click', () => {
            addItemModal.classList.add('active');
            if (newItemNameInput) newItemNameInput.focus();
        });
    }

    // Close Add Item Modal
    function closeAddItemModal() {
        if (addItemModal) {
            addItemModal.classList.remove('active');
            newItemForm.reset();
        }
    }
    if (closeAddItemModalBtn) closeAddItemModalBtn.addEventListener('click', closeAddItemModal);
    if (cancelAddItemModalBtn) cancelAddItemModalBtn.addEventListener('click', closeAddItemModal);
    
    // Save New Item and Add to selector dropdown
    if (newItemForm && newItemNameInput) {
        newItemForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const itemName = newItemNameInput.value.trim();
            if (itemName) {
                if (!inboundItems.includes(itemName)) {
                    inboundItems.push(itemName);
                    saveInboundItems();
                    renderDropdownItems();
                }
                selectDropdownItem(itemName);
                closeAddItemModal();
            }
        });
    }

    // Close Modals & Dropdowns on Outer Click
    window.addEventListener('click', (e) => {
        if (e.target === inboundConfigModal) closeConfigModal();
        if (e.target === addItemModal) closeAddItemModal();
        if (e.target === addProductToActiveSessionModal) closeActiveProductModal();
        if (e.target === productWeightModal) closeWeightModal();
        
        if (configItemDropdownContainer && !configItemDropdownContainer.contains(e.target)) {
            closeDropdownMenu();
        }
        if (activeConfigItemDropdownContainer && !activeConfigItemDropdownContainer.contains(e.target)) {
            closeActiveDropdownMenu();
        }
    });

    // Close Active Product Modal Helper
    function closeActiveProductModal() {
        if (addProductToActiveSessionModal) {
            addProductToActiveSessionModal.classList.remove('active');
            addProductToActiveSessionForm.reset();
            if (activeConfigItemSelect) activeConfigItemSelect.value = '';
            if (activeConfigItemDropdownSelectedText) activeConfigItemDropdownSelectedText.textContent = 'Choose an item...';
            closeActiveDropdownMenu();
        }
    }

    // Confirm and Start Session
    if (inboundConfigForm) {
        inboundConfigForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const vehicleVal = document.getElementById('configVehicleNo').value.trim();
            const itemVal = configItemSelect.value;
            const parsed = parseInt(document.getElementById('configExpectedQty').value);
            const expectedQtyVal = isNaN(parsed) ? 0 : parsed;

            if (!itemVal) {
                alert('Please select an item first.');
                return;
            }

            // Initialize Active Session with items array format
            activeSession = {
                vehicle: vehicleVal || 'Not Specified',
                items: [{
                    name: itemVal,
                    expectedQty: expectedQtyVal,
                    skuAlphabetPattern: null,
                    lockedLength: null,
                    scannedCount: 0
                }],
                serials: []
            };

            // Lock and update active session display
            if (activeSessionVehicle) activeSessionVehicle.textContent = activeSession.vehicle;
            updateSessionProgress();
            
            // Render empty box cards container
            renderBoxCards();
            // Toggle dashboard states & set joined status
            localStorage.setItem('wms_inbound_joined', 'true');
            inboundInactiveState.style.display = 'none';
            inboundActiveState.style.display = 'flex';
            
            // Save state to localStorage
            saveActiveSession();
            // Cleanup modals & autofocus unified scan input
            closeConfigModal();
            setTimeout(() => {
                if (unifiedSerialInput) unifiedSerialInput.focus();
            }, 100);
        });
    }

    // Update progress numbers and count badge
    function updateSessionProgress() {
        if (!activeSession) return;

        // Ensure activeSession.items exists (fallback conversion)
        if (!activeSession.items && activeSession.item) {
            activeSession.items = [{
                name: activeSession.item,
                expectedQty: activeSession.expectedQty || 10,
                skuAlphabetPattern: activeSession.skuAlphabetPattern || null,
                lockedLength: activeSession.lockedLength || null,
                scannedCount: 0
            }];
        }

        const items = activeSession.items || [];
        
        // Pre-group serials by itemName for O(1) lookup
        const serialsByItemMap = new Map();
        (activeSession.serials || []).forEach(s => {
            if (s && s.itemName) {
                let list = serialsByItemMap.get(s.itemName);
                if (!list) {
                    list = [];
                    serialsByItemMap.set(s.itemName, list);
                }
                list.push(s);
            }
        });

        let totalExpected = 0;
        let totalScanned = 0;
        
        items.forEach(item => {
            totalExpected += parseInt(item.expectedQty) || 0;
            const itemSerials = serialsByItemMap.get(item.name) || [];
            const itemScans = itemSerials.length;
            item.scannedCount = itemScans;
            totalScanned += itemScans;
        });

        // Set total session progress text
        if (activeSessionProgress) {
            if (totalExpected > 0) {
                activeSessionProgress.textContent = `${totalScanned} / ${totalExpected} Scanned`;
            } else {
                activeSessionProgress.textContent = `${totalScanned} Scanned`;
            }
        }
        
        // Pieces count
        const sessionScannedCount = document.getElementById('sessionScannedCount');
        if (sessionScannedCount) sessionScannedCount.textContent = totalScanned;

        // Boxes count
        const sessionScannedBoxesCount = document.getElementById('sessionScannedBoxesCount');
        if (sessionScannedBoxesCount) {
            let totalBoxesCount = 0;
            items.forEach(activeItem => {
                const itemSerials = serialsByItemMap.get(activeItem.name) || [];
                const uniqueBoxes = new Set(itemSerials.map(s => s.boxNo));
                totalBoxesCount += uniqueBoxes.size;
            });
            sessionScannedBoxesCount.textContent = totalBoxesCount;
        }

        // Render table rows inside activeSessionRowsContainer
        if (activeSessionRowsContainer) {
            activeSessionRowsContainer.innerHTML = '';
            
            items.forEach(item => {
                const tr = document.createElement('tr');
                tr.style.cssText = 'border-bottom: 1px solid rgba(255, 255, 255, 0.05); font-size: 0.9rem;';
                
                const progressColor = item.expectedQty > 0 
                    ? (item.scannedCount >= item.expectedQty ? 'var(--accent-emerald)' : 'var(--text-secondary)')
                    : 'var(--accent-blue)';
                
                // Initialize allowedPatterns if missing (legacy recovery)
                if (!item.allowedPatterns) {
                    item.allowedPatterns = item.skuAlphabetPattern ? [{
                        pattern: item.skuAlphabetPattern,
                        length: item.lockedLength || 15
                    }] : [];
                }

                // Get accepted lengths list
                const lengthsList = item.allowedPatterns.map(cfg => cfg.length);
                const lengthVal = lengthsList.length > 0 ? `${lengthsList.join(', ')} Chars` : 'Not Locked Yet';
                
                const patternStyle = 'background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--accent-blue); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; font-family: var(--font-mono); display: block; margin-bottom: 4px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                let patternCellHtml = '';
                if (item.allowedPatterns.length > 0) {
                    const badgesHtml = item.allowedPatterns.map(cfg => {
                        const patStr = formatAlphabetPattern(cfg.pattern, cfg.length);
                        return `<span style="${patternStyle}" title="${patStr}">${patStr}</span>`;
                    }).join('');
                    
                    patternCellHtml = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 250px; overflow: hidden;">
                            ${badgesHtml}
                            <button type="button" class="btn-add-alternative-sku" title="Add alternative accepted SKU pattern structure" style="background: rgba(59, 130, 246, 0.15); border: 1px solid var(--accent-blue); color: var(--accent-blue); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; transition: var(--transition-smooth); white-space: nowrap; margin-top: 2px;">
                                + SKU
                            </button>
                        </div>
                    `;
                } else {
                    patternCellHtml = `<span style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">Not Locked Yet</span>`;
                }

                let progressText = `<span style="color: ${progressColor}; font-weight: 700;">${item.scannedCount}</span> / ${item.expectedQty} Scanned`;
                if (item.expectedQty === 0) {
                    progressText = `<span style="color: ${progressColor}; font-weight: 700;">${item.scannedCount}</span> Scanned`;
                }

                tr.innerHTML = `
                    <td style="padding: 12px 8px; font-weight: 700; color: var(--text-primary); display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0;">
                        <span style="text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1;" title="${item.name}">${item.name}</span>
                        <button type="button" class="btn-delete-active-item" data-item-name="${escapeHtmlAttr(item.name)}" title="Remove this product from session" style="background: none; border: none; color: var(--accent-rose); cursor: pointer; padding: 2px; display: flex; align-items: center;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px;">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </td>
                    <td style="padding: 12px 8px; color: var(--text-secondary);" class="font-mono">
                        ${progressText}
                    </td>
                    <td style="padding: 12px 8px; color: var(--text-secondary);" class="font-mono">
                        ${lengthVal}
                    </td>
                    <td style="padding: 12px 8px;">
                        ${patternCellHtml}
                    </td>
                `;

                // Bind add alternative SKU pattern button click
                const addSkuBtn = tr.querySelector('.btn-add-alternative-sku');
                if (addSkuBtn) {
                    addSkuBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        
                        const pwd = prompt(`Enter password to authorize adding a new SKU pattern structure (e.g. 2026):`);
                        if (pwd === '2026') {
                            const refSerial = prompt(`Scan or enter a reference serial number representing the new SKU format for "${item.name}":`);
                            if (refSerial) {
                                const cleanRef = refSerial.trim();
                                if (cleanRef) {
                                    const newPattern = extractAlphabetPattern(cleanRef);
                                    const newConfig = { pattern: newPattern, length: cleanRef.length };
                                    
                                    if (!item.allowedPatterns) {
                                        item.allowedPatterns = item.skuAlphabetPattern ? [{
                                            pattern: item.skuAlphabetPattern,
                                            length: item.lockedLength || 15
                                        }] : [];
                                    }
                                    
                                    // Avoid duplicates
                                    const exists = item.allowedPatterns.some(cfg => {
                                        return cfg.length === cleanRef.length && matchesAlphabetPattern(cleanRef, cfg.pattern);
                                    });
                                    
                                    if (!exists) {
                                        item.allowedPatterns.push(newConfig);
                                        // update legacy fields for safety
                                        item.skuAlphabetPattern = newPattern;
                                        item.lockedLength = cleanRef.length;
                                        
                                        updateSessionProgress();
                                        saveActiveSession();
                                        alert(`Success! Registered new SKU format of ${cleanRef.length} characters.`);
                                    } else {
                                        alert('This exact SKU format/length is already registered.');
                                    }
                                }
                            }
                        } else if (pwd !== null) {
                            alert('Incorrect password! Access denied.');
                        }
                    });
                }

                // Bind active item deletion click listener
                const deleteBtn = tr.querySelector('.btn-delete-active-item');
                if (deleteBtn) {
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        
                        if (activeSession.items.length <= 1) {
                            alert('Cannot delete the last remaining product in the session. Please use "Cancel Session" if you want to discard the entire session.');
                            return;
                        }

                        const pwd = prompt(`Enter password to delete "${item.name}" from active session:`);
                        if (pwd === '2026') {
                            // 1. Remove product item
                            activeSession.items = activeSession.items.filter(i => i.name !== item.name);
                            
                            // 2. Remove all serials scanned under this product item
                            activeSession.serials = activeSession.serials.filter(s => s.itemName !== item.name);

                            // 3. Compact box numbers sequentially
                            compactBoxNumbers();

                            // 4. Update UI & Save
                            updateSessionProgress();
                            updateWorkstationProductSelector();
                            renderBoxCards();
                            saveActiveSession();
                        } else if (pwd !== null) {
                            alert('Incorrect password! Product was not deleted.');
                        }
                    });
                }

                activeSessionRowsContainer.appendChild(tr);
            });
        }
    }

    // --- Toggle switch event for Sequence Mode ---
    if (sequenceToggle) {
        sequenceToggle.addEventListener('change', () => {
            const isSequenceMode = sequenceToggle.checked;
            if (isSequenceMode) {
                // Show quantity field
                if (qtyInputGroup) qtyInputGroup.style.display = 'block';
                if (inputLabel) inputLabel.textContent = 'Base Serial Code';
                if (unifiedSerialInput) unifiedSerialInput.placeholder = 'e.g. B1 or SN_001';
                if (inputHelper) inputHelper.textContent = 'System will read trailing digits to auto-generate sequence';
                if (submitBtnText) submitBtnText.textContent = 'Generate Sequence';
                if (submitBtnIcon) {
                    submitBtnIcon.innerHTML = `
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    `;
                }
            } else {
                // Hide quantity field
                if (qtyInputGroup) qtyInputGroup.style.display = 'none';
                if (inputLabel) inputLabel.textContent = 'Scan Serial Number';
                if (unifiedSerialInput) unifiedSerialInput.placeholder = 'Scan barcode with reader or type here...';
                if (inputHelper) inputHelper.textContent = 'Press Enter key to save immediately';
                if (submitBtnText) submitBtnText.textContent = 'Scan Item';
                if (submitBtnIcon) {
                    submitBtnIcon.innerHTML = `
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                    `;
                }
            }
            if (unifiedSerialInput) unifiedSerialInput.focus();
        });
    }

    // --- Add Scanned Serial Helper (with Length Locking & SKU Verification) ---
    function addSerialToSession(serial, targetBoxNo) {
        if (!activeSession) return false;
        
        lastRejectedIsSequence = false;

        // Clean serial number
        const cleanSerial = serial.trim();
        if (!cleanSerial) return false;

        if (cleanSerial.length > 50) {
            alert(`Scan rejected! Serial number is too long (${cleanSerial.length} characters). Max allowed length is 50 characters.`);
            return false;
        }

        const items = activeSession.items || [];
        if (items.length === 0) return false;

        // Strictly route the scanned serial to the selected product in the workstation
        let matchedItem = null;
        if (items.length === 1) {
            matchedItem = items[0];
        } else {
            const workstationProductSelect = document.getElementById('workstationProductSelect');
            if (workstationProductSelect && workstationProductSelect.value) {
                const selectedVal = workstationProductSelect.value;
                matchedItem = items.find(i => i.name === selectedVal);
            }
        }

        if (!matchedItem) {
            alert('No target product identified for scan validation.');
            return false;
        }

        // Initialize allowedPatterns if missing (legacy recovery)
        if (!matchedItem.allowedPatterns) {
            matchedItem.allowedPatterns = matchedItem.skuAlphabetPattern ? [{
                pattern: matchedItem.skuAlphabetPattern,
                length: matchedItem.lockedLength || 15
            }] : [];
        }

        // --- LOCK PATTERN IF FIRST SCAN ---
        if (matchedItem.allowedPatterns.length === 0) {
            const pattern = extractAlphabetPattern(cleanSerial);
            matchedItem.allowedPatterns = [{
                pattern: pattern,
                length: cleanSerial.length
            }];
            // Keep legacy fields updated for safety
            matchedItem.skuAlphabetPattern = pattern;
            matchedItem.lockedLength = cleanSerial.length;
            console.log(`Auto-locked SKU pattern for "${matchedItem.name}":`, pattern);
        }

        // Count current scans for this matched product
        const matchedItemScans = activeSession.serials.filter(s => s.itemName === matchedItem.name).length;

        // Check if this specific item has reached its expected quantity (only if expectedQty > 0)
        if (matchedItem.expectedQty > 0 && matchedItemScans >= matchedItem.expectedQty) {
            alert(`Cannot scan more pieces of "${matchedItem.name}"! You have already reached the expected quantity limit of ${matchedItem.expectedQty} for this product.`);
            return false;
        }

        // Check if barcode matches any allowed pattern configuration strictly
        const isStrictMatch = matchedItem.allowedPatterns.some(cfg => {
            return cleanSerial.length === cfg.length && matchesAlphabetPattern(cleanSerial, cfg.pattern);
        });

        if (!isStrictMatch) {
            // Check if barcode partially matches any configured pattern
            const isPartialMatch = matchedItem.allowedPatterns.some(cfg => {
                return matchesAlphabetPatternPartial(cleanSerial, cfg.pattern);
            });

            if (isPartialMatch) {
                const expectedStr = matchedItem.allowedPatterns.map(cfg => cfg.length).join(', ');
                showScanWarning('length', expectedStr, cleanSerial, true);
            } else {
                const firstConfig = matchedItem.allowedPatterns[0];
                const expectedPatternStr = firstConfig ? formatAlphabetPattern(firstConfig.pattern, firstConfig.length) : 'Any Pattern';
                
                lastRejectedSerial = cleanSerial;
                lastRejectedItemName = lookupProductBySerial(cleanSerial) || lookupProductBySkuPattern(cleanSerial) || 'Another Product';
                lastRejectedIsSequence = false;

                showSkuWarningModal(
                    'Another Product Detected!',
                    `Scanned serial barcode "${cleanSerial}" belongs to product: "${lastRejectedItemName}". Do you want to add or switch to this product in the active session?`,
                    'EXPECTED SKU:',
                    expectedPatternStr,
                    'SCANNED BARCODE:',
                    `${lastRejectedItemName} (${cleanSerial})`,
                    false, // showAllowLengthBtn
                    true,  // showAddBtn (enables + Add Product button and double scan confirmation!)
                    cleanSerial
                );
            }
            return false;
        }

        // Check for duplicates across session
        const serialsList = activeSession.serials.map(item => item.serial);
        if (serialsList.includes(cleanSerial)) {
            const foundItem = activeSession.serials.find(item => item.serial === cleanSerial);
            showScanWarning('duplicate', foundItem.boxNo, cleanSerial);
            return false;
        }

        // Check for duplicates across past inbound history logs (case-insensitive)
        const cleanSerialUpper = cleanSerial.toUpperCase();
        const alreadyInboundLog = getInboundSerialLogMap().get(cleanSerialUpper);

        if (alreadyInboundLog) {
            showSkuWarningModal(
                'Already Inbound Alert!',
                'This serial barcode already exists in a previously saved inbound history session.',
                'RECEIVED ON VEHICLE:',
                alreadyInboundLog.vehicle || 'N/A',
                'EXISTING BARCODE:',
                cleanSerial,
                false,
                false
            );
            return false;
        }

        // Determine Box Number (Product-Specific)
        let boxNo;
        if (targetBoxNo !== undefined) {
            boxNo = targetBoxNo;
        } else {
            const itemSerials = activeSession.serials.filter(s => s.itemName === matchedItem.name);
            const maxBoxNo = itemSerials.reduce((max, item) => item.boxNo > max ? item.boxNo : max, 0);
            boxNo = maxBoxNo + 1;
        }

        // Push to active serial list
        activeSession.serials.push({ serial: cleanSerial, boxNo: boxNo, itemName: matchedItem.name });

        // Speak last 3 digits
        const last3 = cleanSerial.slice(-3);
        const speakStr = last3.split('').join(', ');
        triggerSpeak(speakStr);

        // Update stats, re-render cards, and save active session state
        renderBoxCards();
        updateSessionProgress();
        saveActiveSession();
        return true;
    }

    // Compact box numbers sequentially per product
    function compactBoxNumbers() {
        if (!activeSession) return;
        const items = activeSession.items || [];
        items.forEach(activeItem => {
            const itemSerials = activeSession.serials.filter(s => s.itemName === activeItem.name);
            const uniqueBoxes = [];
            itemSerials.forEach(s => {
                if (!uniqueBoxes.includes(s.boxNo)) {
                    uniqueBoxes.push(s.boxNo);
                }
            });
            uniqueBoxes.sort((a, b) => a - b);
            
            activeSession.serials.forEach(s => {
                if (s.itemName === activeItem.name) {
                    s.boxNo = uniqueBoxes.indexOf(s.boxNo) + 1;
                }
            });
        });
    }

    // Compact Outbound box numbers sequentially per product
    function compactOutboundBoxNumbers() {
        if (!activeOutboundSession) return;
        const items = activeOutboundSession.items || [];
        items.forEach(activeItem => {
            const itemSerials = activeOutboundSession.serials.filter(s => s.itemName === activeItem.name);
            const uniqueBoxes = [];
            itemSerials.forEach(s => {
                if (!uniqueBoxes.includes(s.boxNo)) {
                    uniqueBoxes.push(s.boxNo);
                }
            });
            uniqueBoxes.sort((a, b) => a - b);
            
            activeOutboundSession.serials.forEach(s => {
                if (s.itemName === activeItem.name) {
                    s.boxNo = uniqueBoxes.indexOf(s.boxNo) + 1;
                }
            });
        });
    }

    // Automatically check and unlock length and pattern for any product that has no scans left
    function checkAndUnlockProducts() {
        if (!activeSession) return;
        const items = activeSession.items || [];
        items.forEach(item => {
            const scansCount = activeSession.serials.filter(s => s.itemName === item.name).length;
            if (scansCount === 0) {
                item.lockedLength = null;
                item.skuAlphabetPattern = null;
                item.allowedPatterns = [];
            }
        });
    }

    // Deletion Listeners for Box Cards and Serials
    if (sessionBoxesContainer) {
        sessionBoxesContainer.addEventListener('click', (e) => {
            // 1. Delete individual serial
            const deleteSerialBtn = e.target.closest('.btn-delete-serial');
            if (deleteSerialBtn && activeSession) {
                const serialToRemove = deleteSerialBtn.getAttribute('data-serial');
                
                activeSession.serials = activeSession.serials.filter(s => s.serial !== serialToRemove);
                
                // Unlock length/pattern if scans drop to 0
                checkAndUnlockProducts();

                compactBoxNumbers();
                renderBoxCards();
                updateSessionProgress();
                saveActiveSession();
                return;
            }

            // 2. Delete entire Box (or Box items for a specific product)
            const deleteBoxBtn = e.target.closest('.btn-delete-box');
            if (deleteBoxBtn && activeSession) {
                const boxToRemove = parseInt(deleteBoxBtn.getAttribute('data-box'));
                const itemName = deleteBoxBtn.getAttribute('data-item-name');
                
                let confirmMsg = `Are you sure you want to delete entire Box ${boxToRemove} and all its serial numbers?`;
                if (itemName) {
                    confirmMsg = `Are you sure you want to delete all serial numbers of "${itemName}" from Box ${boxToRemove}?`;
                }

                if (confirm(confirmMsg)) {
                    if (itemName) {
                        activeSession.serials = activeSession.serials.filter(s => !(s.boxNo === boxToRemove && s.itemName === itemName));
                    } else {
                        activeSession.serials = activeSession.serials.filter(s => s.boxNo !== boxToRemove);
                    }
                    
                    // Unlock length/pattern if scans drop to 0
                    checkAndUnlockProducts();

                    compactBoxNumbers();
                    renderBoxCards();
                    updateSessionProgress();
                    saveActiveSession();
                    return;
                }
            }
        });
    }

    // Clear all scanned serials in Inbound Session
    const clearAllInboundSerialsBtn = document.getElementById('clearAllInboundSerialsBtn');
    if (clearAllInboundSerialsBtn) {
        clearAllInboundSerialsBtn.addEventListener('click', () => {
            if (!activeSession || activeSession.serials.length === 0) {
                alert('No serials to clear.');
                return;
            }
            if (confirm('Are you sure you want to clear all scanned serials from this active inbound session?')) {
                activeSession.serials = [];
                checkAndUnlockProducts();
                renderBoxCards();
                updateSessionProgress();
                saveActiveSession();
            }
        });
    }

    // Submit Unified Scan / Sequence Generator Form
    if (unifiedScanForm) {
        unifiedScanForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const inputVal = unifiedSerialInput.value.trim();
            if (!inputVal) return;

            const isSequenceMode = sequenceToggle ? sequenceToggle.checked : false;

            if (!isSequenceMode) {
                // --- Single Scan Mode ---
                if (inputVal.includes(',')) {
                    const serials = inputVal.split(',').map(s => s.trim()).filter(s => s.length > 0);
                    let allSuccess = true;
                    for (const s of serials) {
                        const success = addSerialToSession(s);
                        if (!success) {
                            allSuccess = false;
                            break; // Stop loop if a warning/alert is triggered
                        }
                    }
                    if (allSuccess) {
                        unifiedSerialInput.value = '';
                    }
                } else {
                    const success = addSerialToSession(inputVal);
                    if (success) {
                        unifiedSerialInput.value = '';
                    }
                }
                if (unifiedSerialInput) unifiedSerialInput.focus();
            } else {
                // --- Sequence Generator Mode ---
                const baseCode = inputVal;
                const count = parseInt(unifiedQtyInput.value);
                generateSequenceSerials(baseCode, count);
            }
        });
    }

    function generateSequenceSerials(baseCode, count) {
        if (!activeSession) return;
        if (count < 1) return;

        // Find targeted product for sequence generator
        let matchedItem = null;
        const workstationProductSelect = document.getElementById('workstationProductSelect');
        if (activeSession.items.length === 1) {
            matchedItem = activeSession.items[0];
        } else if (workstationProductSelect && workstationProductSelect.value) {
            const selectedVal = workstationProductSelect.value;
            matchedItem = activeSession.items.find(i => i.name === selectedVal);
        }

        if (!matchedItem) {
            alert('No active scanning product selected.');
            return;
        }

        // Initialize allowedPatterns if missing (legacy recovery)
        if (!matchedItem.allowedPatterns) {
            matchedItem.allowedPatterns = matchedItem.skuAlphabetPattern ? [{
                pattern: matchedItem.skuAlphabetPattern,
                length: matchedItem.lockedLength || 15
            }] : [];
        }

        const baseCodes = baseCode.split(',').map(s => s.trim()).filter(s => s.length > 0);
        if (baseCodes.length === 0) return;

        // We will collect all generated serials across all base codes to validate and insert them
        const allTempSerials = []; // Array of { serial, boxNo }
        
        const itemSerials = activeSession.serials.filter(s => s.itemName === matchedItem.name);
        let maxBoxNo = itemSerials.reduce((max, item) => item.boxNo > max ? item.boxNo : max, 0);

        // Track how many scans we are adding in total
        let totalNewScans = baseCodes.length * count;
        const currentScans = activeSession.serials.filter(s => s.itemName === matchedItem.name).length;
        if (matchedItem.expectedQty > 0) {
            const remainingQty = matchedItem.expectedQty - currentScans;
            if (totalNewScans > remainingQty) {
                alert(`Cannot generate sequence! Generating ${totalNewScans} serials would exceed the expected quantity limit of ${matchedItem.expectedQty} for "${matchedItem.name}". You can only scan ${remainingQty} more item(s) of this product.`);
                return;
            }
        }

        let currentBoxOffset = 1;
        for (const singleBase of baseCodes) {
            const nextBoxNo = maxBoxNo + currentBoxOffset;
            currentBoxOffset++;

            const tempSerials = [];
            const regex = /^(.*?)(\d+)$/;
            const match = singleBase.match(regex);

            if (match) {
                const prefix = match[1];
                const startString = match[2];
                const startNum = parseInt(startString);
                const padLength = startString.length;

                for (let i = 0; i < count; i++) {
                    const nextNum = startNum + i;
                    const paddedNum = String(nextNum).padStart(padLength, '0');
                    tempSerials.push(prefix + paddedNum);
                }
            } else {
                for (let i = 1; i <= count; i++) {
                    tempSerials.push(`${singleBase}${i}`);
                }
            }

            tempSerials.forEach(s => {
                allTempSerials.push({ serial: s, boxNo: nextBoxNo });
            });
        }

        // Determine active patterns list for validation
        // If not locked yet, extract pattern from first serial in batch to validate the rest
        const firstSerialOfBatch = allTempSerials[0].serial;
        const activeAllowedPatterns = matchedItem.allowedPatterns.length > 0 ? matchedItem.allowedPatterns : [{
            pattern: extractAlphabetPattern(firstSerialOfBatch),
            length: firstSerialOfBatch.length
        }];

        // Pre-build sets for O(1) duplicate checks
        const existingSerialsSet = new Set(activeSession.serials.map(s => s.serial));
        const batchSerialsSet = new Set();

        // Pre-validate all items in allTempSerials
        for (let i = 0; i < allTempSerials.length; i++) {
            const checkSerial = allTempSerials[i].serial;
            const targetBoxNo = allTempSerials[i].boxNo;

            // Check duplicate across existing serials in session
            if (existingSerialsSet.has(checkSerial)) {
                const foundItem = activeSession.serials.find(item => item.serial === checkSerial);
                showScanWarning('duplicate-seq', foundItem ? foundItem.boxNo : 'N/A', checkSerial);
                return;
            }

            // Check duplicate in same batch
            if (batchSerialsSet.has(checkSerial)) {
                showScanWarning('duplicate-batch', targetBoxNo, checkSerial);
                return;
            }
            batchSerialsSet.add(checkSerial);

            // Check duplicate across past history database (case-insensitive)
            const inboundHistory = getHistory();
            let alreadyInboundLog = null;
            const cleanSerialUpper = checkSerial.toUpperCase();
            for (const log of inboundHistory) {
                if (log.serials) {
                    const found = log.serials.find(s => s && s.serial && s.serial.trim().toUpperCase() === cleanSerialUpper);
                    if (found) {
                        alreadyInboundLog = log;
                        break;
                    }
                }
            }

            if (alreadyInboundLog) {
                showSkuWarningModal(
                    'Already Inbound Alert!',
                    'A generated sequence serial barcode already exists in a previously saved inbound history session.',
                    'RECEIVED ON VEHICLE:',
                    alreadyInboundLog.vehicle || 'N/A',
                    'EXISTING BARCODE:',
                    checkSerial,
                    false,
                    false
                );
                return;
            }

            // Validate strictly against the active pattern layout configuration
            const isStrictMatch = activeAllowedPatterns.some(cfg => {
                return checkSerial.length === cfg.length && matchesAlphabetPattern(checkSerial, cfg.pattern);
            });

            if (!isStrictMatch) {
                const isPartialMatch = activeAllowedPatterns.some(cfg => {
                    return matchesAlphabetPatternPartial(checkSerial, cfg.pattern);
                });

                if (isPartialMatch) {
                    const expectedStr = activeAllowedPatterns.map(cfg => cfg.length).join(', ');
                    
                    // Capture recovery state variables for approval handler
                    lastRejectedIsSequence = true;
                    lastRejectedSeqBase = baseCode;
                    lastRejectedSeqCount = count;
                    lastRejectedSerial = checkSerial;
                    
                    const workstationProductSelect = document.getElementById('workstationProductSelect');
                    if (activeSession.items.length === 1) {
                        lastRejectedItemName = activeSession.items[0].name;
                    } else if (workstationProductSelect) {
                        lastRejectedItemName = workstationProductSelect.value;
                    }

                    showScanWarning('length', expectedStr, checkSerial, true);
                } else {
                    const firstConfig = activeAllowedPatterns[0];
                    const expectedPatternStr = firstConfig ? formatAlphabetPattern(firstConfig.pattern, firstConfig.length) : 'Any Pattern';
                    showScanWarning('sku', expectedPatternStr, checkSerial);
                }
                return;
            }
        }

        // If all items pass validation, lock pattern/length for product if not locked yet, and add them
        if (matchedItem.allowedPatterns.length === 0) {
            const pattern = extractAlphabetPattern(firstSerialOfBatch);
            matchedItem.allowedPatterns = [{
                pattern: pattern,
                length: firstSerialOfBatch.length
            }];
            // Sync legacy fields for safety
            matchedItem.skuAlphabetPattern = pattern;
            matchedItem.lockedLength = firstSerialOfBatch.length;
            console.log(`Auto-locked SKU pattern from sequence first serial for "${matchedItem.name}":`, pattern);
        }

        allTempSerials.forEach(item => {
            activeSession.serials.push({ serial: item.serial, boxNo: item.boxNo, itemName: matchedItem.name });
        });

        // Speak last 3 digits of the first serial scanned in this sequence
        if (allTempSerials.length > 0) {
            const firstSerial = allTempSerials[0].serial;
            const last3 = firstSerial.slice(-3);
            const speakStr = last3.split('').join(', ');
            triggerSpeak(speakStr);
        }

        // Update stats, re-render cards, and save active session state
        renderBoxCards();
        updateSessionProgress();
        saveActiveSession();

        // Cleanup sequence inputs
        unifiedSerialInput.value = '';
        unifiedQtyInput.value = '5';
        if (unifiedSerialInput) unifiedSerialInput.focus();
    }

    // --- End & Save Session ---
    if (endInboundSessionBtn) {
        endInboundSessionBtn.addEventListener('click', () => {
            if (!activeSession) return;
            const count = activeSession.serials.length;
            const totalExpected = activeSession.items.reduce((sum, item) => sum + item.expectedQty, 0);
            
            // Warn if count is less than expected, but allow them to bypass it with confirmation
            if (count < totalExpected) {
                const remaining = totalExpected - count;
                const warningMsg = `Warning: You have only scanned ${count} out of ${totalExpected} expected items.\nThere are ${remaining} remaining item(s).\n\nDo you still want to end and save this session anyway?`;
                if (!confirm(warningMsg)) {
                    return;
                }
            }
            
            const productSummary = activeSession.items.map(i => `${i.name} (${i.expectedQty} expected)`).join(', ');
            const confirmMsg = `Are you sure you want to end and save this session?\n\nVehicle: ${activeSession.vehicle}\nProducts: ${productSummary}\nTotal Scanned: ${count} / ${totalExpected}`;
            if (confirm(confirmMsg)) {
                // Add to completed inbound history table
                const now = new Date();
                const timeStr = now.toLocaleTimeString('en-US', {
                    hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit'
                });
                // Add to history array & save to localStorage
                const historyData = getHistory();
                const uniqueBoxes = new Set(activeSession.serials.map(s => s.boxNo));
                const boxCountVal = uniqueBoxes.size;

                const newLogId = Date.now().toString();
                historyData.unshift({
                    id: newLogId,
                    timestamp: timeStr,
                    vehicle: activeSession.vehicle,
                    item: activeSession.items.map(i => i.name).join(' + '),
                    count: count,
                    expected: totalExpected,
                    boxCount: boxCountVal,
                    items: activeSession.items,
                    serials: activeSession.serials,
                    weights: {}
                });
                saveHistory(historyData);
                currentEndingSessionLogId = newLogId;
 
                // Define callback to complete the session closure after weight configuration
                const itemsToConfigure = activeSession.items.map(i => i.name).filter(Boolean);
                window.completeEndInboundSession = function() {
                    // Reset dashboard inactive state
                    inboundActiveState.style.display = 'none';
                    inboundInactiveState.style.display = 'block';
                    
                    // Clear state & active localStorage
                    activeSession = null;
                    saveActiveSession();
     
                    // Re-render historical logs list
                    renderHistoryTable();
                    renderInventoryPanel();
                };

                // Queue weight configs and start processing
                weightConfigureQueue = Array.from(new Set(itemsToConfigure));
                if (weightConfigureQueue.length > 0) {
                    processWeightConfigureQueue();
                } else {
                    completeEndInboundSession();
                }
            }
        });
    }

    // --- Cancel Active Inbound Session ---
    if (cancelActiveInboundSessionBtn) {
        cancelActiveInboundSessionBtn.addEventListener('click', () => {
            if (!activeSession) return;
            if (confirm("Are you sure you want to cancel this inbound session? All scanned serials in this session will be discarded.")) {
                inboundActiveState.style.display = 'none';
                inboundInactiveState.style.display = 'block';
                
                // Clear state & active localStorage
                activeSession = null;
                saveActiveSession();
            }
        });
    }

    // --- Active Product Addition Modal Handlers ---

    // Open active modal
    if (openAddProductToActiveSessionModalBtn) {
        openAddProductToActiveSessionModalBtn.addEventListener('click', () => {
            if (addProductToActiveSessionModal) {
                addProductToActiveSessionModal.classList.add('active');
                renderActiveDropdownItems();
            }
        });
    }

    if (closeAddProductToActiveSessionModalBtn) closeAddProductToActiveSessionModalBtn.addEventListener('click', closeActiveProductModal);
    if (cancelAddProductToActiveSessionModalBtn) cancelAddProductToActiveSessionModalBtn.addEventListener('click', closeActiveProductModal);

    // Open add item modal from active config sub-form
    if (openAddItemModalBtnInActiveModal && addItemModal) {
        openAddItemModalBtnInActiveModal.addEventListener('click', () => {
            addItemModal.classList.add('active');
            if (newItemNameInput) newItemNameInput.focus();
        });
    }

    // Custom Active Dropdown Item List Logic
    function renderActiveDropdownItems() {
        if (!activeConfigItemDropdownList) return;
        loadInboundItems();
        activeConfigItemDropdownList.innerHTML = '';

        inboundItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'custom-dropdown-item';
            li.setAttribute('data-value', item);
            
            li.innerHTML = `
                <span class="custom-dropdown-item-text">${item}</span>
                <button type="button" class="btn-delete-dropdown-item" data-item="${item}" title="Delete Item">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            `;

            // Selection trigger
            const textSpan = li.querySelector('.custom-dropdown-item-text');
            if (textSpan) {
                textSpan.addEventListener('click', () => {
                    selectActiveDropdownItem(item);
                    closeActiveDropdownMenu();
                });
            }

            // Secure deletion trigger
            const deleteBtn = li.querySelector('.btn-delete-dropdown-item');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const pwd = prompt(`Enter password to delete item "${item}":`);
                    if (pwd === '2026') {
                        inboundItems = inboundItems.filter(i => i !== item);
                        saveInboundItems();
                        renderDropdownItems();
                        renderActiveDropdownItems();
                        
                        if (activeConfigItemSelect && activeConfigItemSelect.value === item) {
                            activeConfigItemSelect.value = '';
                            if (activeConfigItemDropdownSelectedText) activeConfigItemDropdownSelectedText.textContent = 'Choose an item...';
                        }
                    } else if (pwd !== null) {
                        alert('Incorrect password! Item was not deleted.');
                    }
                });
            }

            activeConfigItemDropdownList.appendChild(li);
        });
    }

    function selectActiveDropdownItem(item) {
        if (activeConfigItemSelect) activeConfigItemSelect.value = item;
        if (activeConfigItemDropdownSelectedText) activeConfigItemDropdownSelectedText.textContent = item;
    }

    function toggleActiveDropdownMenu() {
        if (activeConfigItemDropdownContainer) {
            activeConfigItemDropdownContainer.classList.toggle('active');
        }
    }

    function closeActiveDropdownMenu() {
        if (activeConfigItemDropdownContainer) {
            activeConfigItemDropdownContainer.classList.remove('active');
        }
    }

    if (activeConfigItemDropdownTrigger) {
        activeConfigItemDropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleActiveDropdownMenu();
        });
    }

    // Submit handler to add new product to active session on the fly
    if (addProductToActiveSessionForm) {
        addProductToActiveSessionForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!activeSession) return;

            const selectedItem = activeConfigItemSelect.value;
            const expectedQtyInput = document.getElementById('activeConfigExpectedQty');

            const parsed = parseInt(expectedQtyInput.value);
            const expectedQtyVal = isNaN(parsed) ? 0 : parsed;

            if (!selectedItem) {
                alert('Please select a product first.');
                return;
            }

            // Check if product is already added
            const exists = activeSession.items.some(i => i.name === selectedItem);
            if (exists) {
                alert(`Product "${selectedItem}" is already configured in this active session.`);
                return;
            }

            // Push product to active session
            activeSession.items.push({
                name: selectedItem,
                expectedQty: expectedQtyVal,
                skuAlphabetPattern: null,
                lockedLength: null,
                scannedCount: 0
            });

            // Update stats, save, and update selector dropdown
            updateSessionProgress();
            updateWorkstationProductSelector();
            saveActiveSession();

            closeActiveProductModal();
        });
    }

    // --- SKU Warning Reject Modal Actions ---
    if (rejectScanBtn && skuWarningModal) {
        rejectScanBtn.addEventListener('click', () => {
            skuWarningModal.classList.remove('active');
            if (deletedSerialDismissTimer) {
                clearTimeout(deletedSerialDismissTimer);
                deletedSerialDismissTimer = null;
            }
            // Clear incorrect scan and refocus correct input
            if (activeOutboundSession) {
                refocusOutboundInput();
            } else if (unifiedSerialInput) {
                unifiedSerialInput.value = '';
                unifiedSerialInput.focus();
            }
        });    }

    if (allowLengthBtn && skuWarningModal) {
        allowLengthBtn.addEventListener('click', () => {
            const pwd = prompt("Enter password to authorize and register this new SKU pattern structure (e.g. 2026):");
            if (pwd === '2026') {
                skuWarningModal.classList.remove('active');
                
                // Inbound recovery
                if (lastRejectedSerial && lastRejectedItemName && activeSession) {
                    const targetItem = activeSession.items.find(i => i.name === lastRejectedItemName);
                    if (targetItem) {
                        const newPattern = extractAlphabetPattern(lastRejectedSerial);
                        const newConfig = { pattern: newPattern, length: lastRejectedSerial.length };
                        
                        if (!targetItem.allowedPatterns) {
                            targetItem.allowedPatterns = targetItem.skuAlphabetPattern ? [{
                                pattern: targetItem.skuAlphabetPattern,
                                length: targetItem.lockedLength || 15
                            }] : [];
                        }
                        
                        const exists = targetItem.allowedPatterns.some(cfg => {
                            return cfg.length === lastRejectedSerial.length && matchesAlphabetPattern(lastRejectedSerial, cfg.pattern);
                        });
                        
                        if (!exists) {
                            targetItem.allowedPatterns.push(newConfig);
                            targetItem.skuAlphabetPattern = newPattern;
                            targetItem.lockedLength = lastRejectedSerial.length;
                            console.log(`Approved inbound SKU pattern format:`, newConfig);
                        }

                        if (lastRejectedIsSequence) {
                            generateSequenceSerials(lastRejectedSeqBase, lastRejectedSeqCount);
                        } else {
                            addSerialToSession(lastRejectedSerial);
                        }
                    }
                }

                // Outbound recovery
                if (lastRejectedSerial && lastRejectedItemName && activeOutboundSession) {
                    const targetItem = activeOutboundSession.items.find(i => i.name === lastRejectedItemName);
                    if (targetItem) {
                        const newPattern = extractAlphabetPattern(lastRejectedSerial);
                        const newConfig = { pattern: newPattern, length: lastRejectedSerial.length };
                        
                        if (!targetItem.allowedPatterns) {
                            targetItem.allowedPatterns = targetItem.skuAlphabetPattern ? [{
                                pattern: targetItem.skuAlphabetPattern,
                                length: targetItem.lockedLength || 15
                            }] : [];
                        }
                        
                        const exists = targetItem.allowedPatterns.some(cfg => {
                            return cfg.length === lastRejectedSerial.length && matchesAlphabetPattern(lastRejectedSerial, cfg.pattern);
                        });
                        
                        if (!exists) {
                            targetItem.allowedPatterns.push(newConfig);
                            targetItem.skuAlphabetPattern = newPattern;
                            targetItem.lockedLength = lastRejectedSerial.length;
                            console.log(`Approved outbound SKU pattern format:`, newConfig);
                        }

                        if (lastRejectedIsSequence) {
                            generateOutboundSequenceSerials(lastRejectedSeqBase, lastRejectedSeqCount);
                        } else {
                            saveOutboundSerial(lastRejectedSerial, lastRejectedItemName);
                        }
                    }
                }
            } else if (pwd !== null) {
                alert('Incorrect password! SKU pattern registration denied.');
            }

            // Clear incorrect scan and refocus correct input
            if (activeOutboundSession) {
                refocusOutboundInput();
            } else if (unifiedSerialInput) {
                unifiedSerialInput.value = '';
                unifiedSerialInput.focus();
            }
        });
    }

    if (warningAddProductBtn && skuWarningModal) {
        warningAddProductBtn.addEventListener('click', () => {
            skuWarningModal.classList.remove('active');
            
            // Outbound recovery & add product
            if (lastRejectedSerial && lastRejectedItemName && activeOutboundSession) {
                let targetItem = activeOutboundSession.items.find(i => i.name === lastRejectedItemName);
                if (!targetItem) {
                    targetItem = {
                        name: lastRejectedItemName,
                        skuAlphabetPattern: null,
                        lockedLength: null,
                        allowedPatterns: []
                    };
                    activeOutboundSession.items.push(targetItem);
                }
                const newPattern = extractAlphabetPattern(lastRejectedSerial);
                targetItem.skuAlphabetPattern = newPattern;
                targetItem.lockedLength = lastRejectedSerial.length;
                if (!targetItem.allowedPatterns) targetItem.allowedPatterns = [];
                const patternExists = targetItem.allowedPatterns.some(cfg => {
                    return cfg.length === lastRejectedSerial.length && matchesAlphabetPattern(lastRejectedSerial, cfg.pattern);
                });
                if (!patternExists) {
                    targetItem.allowedPatterns.push({ pattern: newPattern, length: lastRejectedSerial.length });
                }

                saveActiveOutboundSession();
                
                if (lastRejectedIsSequence) {
                    generateOutboundSequenceSerials(lastRejectedSeqBase, lastRejectedSeqCount);
                } else {
                    saveOutboundSerial(lastRejectedSerial, lastRejectedItemName);
                }
                return;
            }

            // Inbound recovery & add product
            if (lastRejectedSerial && activeSession) {
                const detectedProduct = lastRejectedItemName || lookupProductBySerial(lastRejectedSerial) || lookupProductBySkuPattern(lastRejectedSerial);
                if (detectedProduct && detectedProduct !== 'Another Product' && detectedProduct !== 'Unknown Product') {
                    let targetItem = activeSession.items.find(i => i.name === detectedProduct);
                    if (!targetItem) {
                        targetItem = {
                            name: detectedProduct,
                            expectedQty: 0,
                            skuAlphabetPattern: null,
                            lockedLength: null,
                            allowedPatterns: [],
                            scannedCount: 0
                        };
                        activeSession.items.push(targetItem);
                    }
                    const newPattern = extractAlphabetPattern(lastRejectedSerial);
                    targetItem.skuAlphabetPattern = newPattern;
                    targetItem.lockedLength = lastRejectedSerial.length;
                    if (!targetItem.allowedPatterns) targetItem.allowedPatterns = [];
                    const patternExists = targetItem.allowedPatterns.some(cfg => {
                        return cfg.length === lastRejectedSerial.length && matchesAlphabetPattern(lastRejectedSerial, cfg.pattern);
                    });
                    if (!patternExists) {
                        targetItem.allowedPatterns.push({ pattern: newPattern, length: lastRejectedSerial.length });
                    }

                    // Update workstation product selector if needed
                    const workstationProductSelect = document.getElementById('workstationProductSelect');
                    if (workstationProductSelect) {
                        workstationProductSelect.value = detectedProduct;
                    }

                    addSerialToSession(lastRejectedSerial);
                } else if (addProductToActiveSessionModal) {
                    // Open add product modal if item name unknown
                    addProductToActiveSessionModal.classList.add('active');
                }
            }
        });
    }

    // --- Product Weight Configuration Modal Handlers ---
    inboundTargets.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-item-weight-trigger');
            if (btn) {
                e.stopPropagation();
                const itemName = btn.getAttribute('data-item-name');
                const logId = btn.getAttribute('data-log-id');
                if (itemName) {
                    selectedWeightItemName = itemName;
                    currentEndingSessionLogId = logId || '';
                    if (weightModalProductDesc) {
                        weightModalProductDesc.textContent = `Configure the weight per piece for "${itemName}". This will be used in outbound logs.`;
                    }
                    
                    const weights = getProductWeights();
                    let activeWeight = weights[itemName];
                    if (logId) {
                        const historyData = getHistory();
                        const log = historyData.find(l => l.id === logId);
                        const logW = resolveLogWeight(log, itemName);
                        if (logW !== undefined) {
                            activeWeight = logW;
                        }
                    }
                    
                    if (weightInputVal) {
                        weightInputVal.value = activeWeight !== undefined ? activeWeight : '';
                    }
                    if (productWeightModal) {
                        productWeightModal.classList.add('active');
                    }
                }
            }
        });
        }
    });

    function processWeightConfigureQueue() {
        if (weightConfigureQueue.length === 0) {
            if (typeof window.completeEndInboundSession === 'function') {
                window.completeEndInboundSession();
                window.completeEndInboundSession = null;
            }
            return;
        }
        
        const itemName = weightConfigureQueue.shift();
        selectedWeightItemName = itemName;
        if (weightModalProductDesc) {
            weightModalProductDesc.textContent = `Configure the weight per piece for "${itemName}". This will be used in outbound logs.`;
        }
        const weights = getProductWeights();
        if (weightInputVal) {
            weightInputVal.value = weights[itemName] !== undefined ? weights[itemName] : '';
        }
        if (productWeightModal) {
            productWeightModal.classList.add('active');
        }
    }

    function closeWeightModal() {
        if (productWeightModal) {
            productWeightModal.classList.remove('active');
        }
        if (productWeightForm) {
            productWeightForm.reset();
        }
        selectedWeightItemName = '';

        if (weightConfigureQueue.length > 0) {
            setTimeout(() => {
                processWeightConfigureQueue();
            }, 100);
        } else {
            currentEndingSessionLogId = ''; // Clear log ID
            if (typeof window.completeEndInboundSession === 'function') {
                window.completeEndInboundSession();
                window.completeEndInboundSession = null;
            }
        }
    }

    if (closeWeightModalBtn) closeWeightModalBtn.addEventListener('click', closeWeightModal);
    if (cancelWeightModalBtn) cancelWeightModalBtn.addEventListener('click', closeWeightModal);

    if (productWeightForm) {
        productWeightForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (selectedWeightItemName && weightInputVal) {
                const val = weightInputVal.value.trim();
                saveProductWeight(selectedWeightItemName, val);
                
                // If ending a session or editing a past log, save the weight specifically inside that history log
                if (currentEndingSessionLogId) {
                    const historyData = getHistory();
                    const logIndex = historyData.findIndex(l => l.id === currentEndingSessionLogId);
                    if (logIndex !== -1) {
                        saveLogWeight(historyData[logIndex], selectedWeightItemName, val);
                        saveHistory(historyData);
                    }
                }

                // Hide modal immediately
                if (productWeightModal) {
                    productWeightModal.classList.remove('active');
                }
                if (productWeightForm) {
                    productWeightForm.reset();
                }
                selectedWeightItemName = '';

                renderHistoryTable();
                renderInventoryPanel();
                renderOutboundHistoryTable();
                
                if (weightConfigureQueue.length > 0) {
                    setTimeout(() => {
                        processWeightConfigureQueue();
                    }, 100);
                } else {
                    currentEndingSessionLogId = ''; // Clear log ID
                    if (typeof window.completeEndInboundSession === 'function') {
                        window.completeEndInboundSession();
                        window.completeEndInboundSession = null;
                    }
                }
            }
        });
    }

    // ==========================================================================
    // Outbound Logs Panel Controller Workspace
    // ==========================================================================
    let activeOutboundSession = null;
    let isEditingOutboundSession = false;

    // Outbound Workstation elements
    const startOutboundSessionBtn = document.getElementById('startOutboundSessionBtn');
    const endOutboundSessionBtn = document.getElementById('endOutboundSessionBtn');
    const cancelActiveOutboundSessionBtn = document.getElementById('cancelActiveOutboundSessionBtn');
    
    const outboundInactiveState = document.getElementById('outboundInactiveState');
    const outboundActiveState = document.getElementById('outboundActiveState');
    
    const outboundConfigModal = document.getElementById('outboundConfigModal');
    const closeOutboundConfigModalBtn = document.getElementById('closeOutboundConfigModalBtn');
    const cancelOutboundConfigModalBtn = document.getElementById('cancelOutboundConfigModalBtn');
    const outboundConfigForm = document.getElementById('outboundConfigForm');

    const unrecognizedBarcodeModal = document.getElementById('unrecognizedBarcodeModal');
    const outboundAddProductConfirmModal = document.getElementById('outboundAddProductConfirmModal');
    const outboundAddProductConfirmInput = document.getElementById('outboundAddProductConfirmInput');

    let outboundPendingProductSerial = '';
    let outboundPendingProductName = '';

    const outboundUnifiedScanForm = document.getElementById('outboundUnifiedScanForm');
    const outboundSequenceToggle = document.getElementById('outboundSequenceToggle');
    const outboundQtyInputGroup = document.getElementById('outboundQtyInputGroup');
    const outboundUnifiedSerialInput = document.getElementById('outboundUnifiedSerialInput');
    const outboundUnifiedQtyInput = document.getElementById('outboundUnifiedQtyInput');
    const outboundInputLabel = document.getElementById('outboundInputLabel');
    const outboundInputHelper = document.getElementById('outboundInputHelper');
    const outboundSubmitBtnText = document.getElementById('outboundSubmitBtnText');
    const outboundSubmitBtnIcon = document.getElementById('outboundSubmitBtnIcon');

    // Outbound state storage and management
    function saveActiveOutboundSession() {
        if (activeOutboundSession) {
            localStorage.setItem('wms_active_outbound_session', JSON.stringify(activeOutboundSession));
            firebaseSet('active_outbound_session', activeOutboundSession);
        } else {
            localStorage.removeItem('wms_active_outbound_session');
            localStorage.removeItem('wms_outbound_joined');
            firebaseSet('active_outbound_session', null);
        }
    }

    function restoreOutboundSessionState() {
        const saved = localStorage.getItem('wms_active_outbound_session');
        if (saved) {
            activeOutboundSession = JSON.parse(saved);

            if (!activeOutboundSession) return;

            if (activeOutboundSession && !activeOutboundSession.items) {
                activeOutboundSession.items = [];
            }
            
            // Sanitize activeOutboundSession items
            if (activeOutboundSession.items) {
                activeOutboundSession.items.forEach(item => {
                    if (item) {
                        if (item.allowedPatterns) {
                            item.allowedPatterns = item.allowedPatterns.filter(cfg => cfg && cfg.length <= 50);
                        }
                        if (item.lockedLength > 50) {
                            item.lockedLength = null;
                            item.skuAlphabetPattern = null;
                            if (item.allowedPatterns) {
                                item.allowedPatterns = item.allowedPatterns.filter(cfg => cfg && cfg.length <= 50);
                            }
                        }
                    }
                });
            }

            if (!activeOutboundSession.serials) {
                activeOutboundSession.serials = [];
            }

            if (activeOutboundSession.serials) {
                activeOutboundSession.serials = activeOutboundSession.serials.filter(s => s && s.serial && (s.serial.length <= 150 || s.serial.includes('WOS')));
            }

            sanitizeSessionItems(activeOutboundSession);

            document.getElementById('activeOutboundShop').textContent = activeOutboundSession.shopName;
            document.getElementById('activeOutboundInvoice').textContent = activeOutboundSession.invoiceNo;
            const pincodeEl = document.getElementById('activeOutboundPincode');
            if (pincodeEl) pincodeEl.textContent = activeOutboundSession.pincode || 'N/A';
            
            const odaBadge = document.getElementById('odaIndicatorBadge');
            if (odaBadge) {
                if (activeOutboundSession.pincode) {
                    const pincode = activeOutboundSession.pincode;
                    const odaInfo = getMultiCourierOdaStatus(pincode);
                    
                    odaBadge.style.display = 'flex';
                    odaBadge.innerHTML = `<span style="font-weight: 800; font-family: var(--font-mono); margin-right: 4px;">PIN ${pincode}:</span> ${odaInfo.badgeHtml}`;
                    
                    if (odaInfo.isAnyOda) {
                        odaBadge.style.backgroundColor = 'rgba(244, 63, 94, 0.1)';
                        odaBadge.style.borderColor = 'var(--accent-rose)';
                        odaBadge.style.animation = 'pulseOda 1.5s infinite';
                    } else {
                        odaBadge.style.backgroundColor = 'rgba(16, 185, 129, 0.08)';
                        odaBadge.style.borderColor = 'var(--accent-emerald)';
                        odaBadge.style.animation = 'pulseOdaNormal 2s infinite';
                    }
                } else {
                    odaBadge.style.display = 'none';
                }
            }
            
            compactOutboundBoxNumbers();
            updateOutboundSessionProgress();
            renderOutboundBoxCards();
            const isJoined = localStorage.getItem('wms_outbound_joined') === 'true';
            if (isJoined) {
                if (outboundInactiveState) outboundInactiveState.style.display = 'none';
                if (outboundActiveState) outboundActiveState.style.display = 'flex';
            } else {
                if (outboundActiveState) outboundActiveState.style.display = 'none';
                if (outboundInactiveState) outboundInactiveState.style.display = 'block';
                const banner = document.getElementById('outboundAlreadyWorkingBanner');
                const welcome = document.getElementById('outboundWelcomeContainer');
                if (banner) banner.style.display = 'flex';
                if (welcome) welcome.style.display = 'none';
            }
        } else {
            localStorage.removeItem('wms_outbound_joined');
            if (outboundActiveState) outboundActiveState.style.display = 'none';
            if (outboundInactiveState) outboundInactiveState.style.display = 'block';
            const banner = document.getElementById('outboundAlreadyWorkingBanner');
            const welcome = document.getElementById('outboundWelcomeContainer');
            if (banner) banner.style.display = 'none';
            if (welcome) welcome.style.display = 'flex';
        }
        const isOutboundJoined = localStorage.getItem('wms_outbound_joined') === 'true';
        if (!isOutboundJoined) {
            renderOutboundHistoryTable();
        }
    }

    // Modal Control triggers or block if active session exists on another device
    if (startOutboundSessionBtn && outboundConfigModal) {
        startOutboundSessionBtn.addEventListener('click', () => {
            if (activeOutboundSession) {
                // Click acts as Join Session prompt
                const pwd = prompt('Enter passcode (2026) to join the active Outbound session:');
                if (pwd === '2026') {
                    localStorage.setItem('wms_outbound_joined', 'true');
                    restoreOutboundSessionState();
                } else {
                    alert('Incorrect passcode.');
                }
            } else {
                isEditingOutboundSession = false;
                const modalTitle = document.getElementById('outboundConfigModalTitle');
                const modalSubmitBtn = document.getElementById('confirmOutboundSessionBtn');
                if (modalTitle) modalTitle.textContent = 'Configure Outbound Session';
                if (modalSubmitBtn) modalSubmitBtn.textContent = 'Lock Details & Start Scanning';
                
                document.getElementById('configShopName').value = '';
                document.getElementById('configInvoiceNo').value = '';
                const pinElReset = document.getElementById('configPincode');
                if (pinElReset) pinElReset.value = '';
                const addrElReset = document.getElementById('configAddress');
                if (addrElReset) addrElReset.value = '';
                
                outboundConfigModal.classList.add('active');
            }
        });
    }

    // Edit Session Details trigger
    const btnEditOutboundSessionInfo = document.getElementById('btnEditOutboundSessionInfo');
    if (btnEditOutboundSessionInfo && outboundConfigModal) {
        btnEditOutboundSessionInfo.addEventListener('click', () => {
            if (!activeOutboundSession) return;
            
            isEditingOutboundSession = true;
            const modalTitle = document.getElementById('outboundConfigModalTitle');
            const modalSubmitBtn = document.getElementById('confirmOutboundSessionBtn');
            if (modalTitle) modalTitle.textContent = 'Edit Outbound Session Details';
            if (modalSubmitBtn) modalSubmitBtn.textContent = 'Update Details';
            
            document.getElementById('configShopName').value = activeOutboundSession.shopName || '';
            document.getElementById('configInvoiceNo').value = activeOutboundSession.invoiceNo || '';
            const pinEl = document.getElementById('configPincode');
            if (pinEl) pinEl.value = activeOutboundSession.pincode || '';
            const addrEl = document.getElementById('configAddress');
            if (addrEl) addrEl.value = activeOutboundSession.address || '';
            
            outboundConfigModal.classList.add('active');
        });
    }

    // Join Outbound Session Event Listener
    const btnJoinOutboundSession = document.getElementById('btnJoinOutboundSession');
    if (btnJoinOutboundSession) {
        btnJoinOutboundSession.addEventListener('click', () => {
            const pwd = prompt('Enter passcode (2026) to join the active Outbound session:');
            if (pwd === '2026') {
                localStorage.setItem('wms_outbound_joined', 'true');
                restoreOutboundSessionState();
            } else {
                alert('Incorrect passcode.');
            }
        });
    }
    function closeOutboundConfigModal() {
        if (outboundConfigModal) {
            outboundConfigModal.classList.remove('active');
            outboundConfigForm.reset();
        }
    }
    if (closeOutboundConfigModalBtn) closeOutboundConfigModalBtn.addEventListener('click', closeOutboundConfigModal);
    if (cancelOutboundConfigModalBtn) cancelOutboundConfigModalBtn.addEventListener('click', closeOutboundConfigModal);

    // Outbound session initialization or edit
    if (outboundConfigForm) {
        outboundConfigForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const shopVal = document.getElementById('configShopName').value.trim();
            const invoiceVal = document.getElementById('configInvoiceNo').value.trim();
            const pinEl = document.getElementById('configPincode');
            const pinVal = pinEl ? pinEl.value.trim().replace(/\D/g, '') : '';
            const addrEl = document.getElementById('configAddress');
            const addrVal = addrEl ? addrEl.value.trim() : '';

            if (!shopVal || !invoiceVal) {
                alert('Please enter both Shop Name and Invoice Number.');
                return;
            }

            if (pinVal && pinVal.length !== 6) {
                alert('Pincode must be exactly a 6-digit number.');
                return;
            }

            const checkOdaStatusForPincode = (pincode) => {
                if (!pincode) return 'Normal';
                const records = getOdaRecords();
                const matched = records.filter(r => String(r.pincode) === String(pincode));
                if (matched.length === 0) return 'Normal';
                
                const hasOda = matched.some(r => isOdaRemark(r.remark));
                return hasOda ? 'ODA' : 'Normal';
            };

            const odaStatus = checkOdaStatusForPincode(pinVal);

            if (isEditingOutboundSession && activeOutboundSession) {
                activeOutboundSession.shopName = shopVal;
                activeOutboundSession.invoiceNo = invoiceVal;
                activeOutboundSession.pincode = pinVal || '';
                activeOutboundSession.address = addrVal || activeOutboundSession.address || '';
                activeOutboundSession.odaStatus = odaStatus;
            } else {
                activeOutboundSession = {
                    shopName: shopVal,
                    invoiceNo: invoiceVal,
                    pincode: pinVal || '',
                    address: addrVal || '',
                    odaStatus: odaStatus,
                    items: [],
                    serials: []
                };
                localStorage.setItem('wms_outbound_joined', 'true');
            }
            saveActiveOutboundSession();
            closeOutboundConfigModal();
            restoreOutboundSessionState();
        });
    }

    // Auto-fill parsing handler for outboundInvoicePasteArea
    const outboundInvoicePasteArea = document.getElementById('outboundInvoicePasteArea');
    if (outboundInvoicePasteArea) {
        outboundInvoicePasteArea.addEventListener('input', () => {
            const val = outboundInvoicePasteArea.value;
            if (!val.trim()) return;

            // Parser logic
            const lines = val.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            
            let shopName = '';
            let invoiceNo = '';
            let pincode = '';
            
            // 1. Extract Invoice / Sales Order Number
            const invoiceRegexes = [
                /\b(SO\s*-\s*[A-Za-z0-9\-\_\/]+(?:\s*\/[A-Za-z0-9\-\_\/]+)*)\b/i,
                /\b(INV\s*-\s*[A-Za-z0-9\-\_\/]+(?:\s*\/[A-Za-z0-9\-\_\/]+)*)\b/i,
                /(?:Sales\s*Order|Invoice|SO|Order)\s*(?:No\.?|#)\s*[:\-]?\s*([A-Za-z0-9\-\_\/\s]+)/i,
                /(?:Sales\s*Order|Invoice|SO|Order)\s*[:\-]\s*([A-Za-z0-9\-\_\/\s]+)/i
            ];
            
            for (const regex of invoiceRegexes) {
                const match = val.match(regex);
                if (match && match[1]) {
                    let cleaned = match[1].trim();
                    // Split by double-spaces, tab, or common keywords to avoid capturing trailing fields
                    cleaned = cleaned.split(/\s{2,}/)[0]; // stop at double spaces
                    cleaned = cleaned.split('\t')[0]; // stop at tabs
                    
                    // Stop at common invoice keywords
                    const stopKeywords = [/order\s*date/i, /date/i, /terms/i, /place/i, /gst/i];
                    for (const kw of stopKeywords) {
                        const kwIdx = cleaned.search(kw);
                        if (kwIdx !== -1) {
                            cleaned = cleaned.substring(0, kwIdx).trim();
                        }
                    }
                    
                    // Remove trailing non-alphanumeric punctuation
                    cleaned = cleaned.replace(/[\:\-\s]+$/, '').trim();
                    
                    // Reject if it matches a common keyword like "Sales Order" or "Order" or is too short
                    if (cleaned.toLowerCase() === 'sales order' || cleaned.toLowerCase() === 'order' || cleaned.length < 3) {
                        continue;
                    }
                    
                    invoiceNo = cleaned;
                    break;
                }
            }
            
            // 2. Extract Shop Name
            let headerIndex = -1;
            for (let i = 0; i < lines.length; i++) {
                if (/Bill\s*To|Ship\s*To/i.test(lines[i])) {
                    headerIndex = i;
                    break;
                }
            }
            
            if (headerIndex !== -1) {
                // Find the first valid non-empty line after "Bill To" or "Ship To"
                for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 6); i++) {
                    const line = lines[i];
                    if (/Bill\s*To|Ship\s*To/i.test(line)) continue;
                    if (/GSTIN|GST/i.test(line)) continue;
                    if (/Date|Order|SO|Invoice/i.test(line)) continue;
                    if (/Address|Mobile|Phone|Email/i.test(line)) continue;
                    if (line.match(/^\d+$/)) continue; // skip pure numbers
                    
                    shopName = line;
                    break;
                }
            }
            
            // 3. Extract Shipping Pincode (last 6-digit number in the document)
            const pincodes = val.match(/\b\d{6}\b/g) || [];
            if (pincodes.length > 0) {
                pincode = pincodes[pincodes.length - 1];
            }
            
            // 4. Extract Drop Address (text after customer GSTIN / last GSTIN)
            let extractedAddress = '';
            const gstinRegex = /(?:GSTIN|GST)\s*[:\-]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Zz][0-9A-Z]{1})|\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Zz][0-9A-Z]{1})\b/gi;
            const gstinMatches = [...val.matchAll(gstinRegex)];

            if (gstinMatches.length >= 2) {
                const lastMatch = gstinMatches[gstinMatches.length - 1];
                const gstinEndIndex = lastMatch.index + lastMatch[0].length;
                extractedAddress = val.substring(gstinEndIndex).trim();
            } else if (gstinMatches.length === 1) {
                const shipToIdx = val.search(/Ship\s*To|Bill\s*To/i);
                if (shipToIdx !== -1 && gstinMatches[0].index > shipToIdx) {
                    const gstinEndIndex = gstinMatches[0].index + gstinMatches[0][0].length;
                    extractedAddress = val.substring(gstinEndIndex).trim();
                } else {
                    const sub = val.substring(shipToIdx !== -1 ? shipToIdx : 0);
                    const subLines = sub.split('\n').map(l => l.trim()).filter(l => l.length > 0);
                    if (subLines.length > 2) {
                        extractedAddress = subLines.slice(2).join('\n').trim();
                    }
                }
            } else {
                const shipToMatch = val.match(/(?:Ship\s*To|Bill\s*To)[\s\S]*?\n([^\n]+)\n([\s\S]+)/i);
                if (shipToMatch && shipToMatch[2]) {
                    extractedAddress = shipToMatch[2].trim();
                }
            }

            if (extractedAddress) {
                extractedAddress = extractedAddress.replace(/^[\s\t\:\-]+/, '').trim();
            }

            // Populate form fields if extracted successfully
            let filled = false;
            if (shopName) {
                document.getElementById('configShopName').value = shopName;
                filled = true;
            }
            if (invoiceNo) {
                document.getElementById('configInvoiceNo').value = invoiceNo;
                filled = true;
            }
            if (pincode) {
                const pinEl = document.getElementById('configPincode');
                if (pinEl) pinEl.value = pincode;
                filled = true;
            }
            if (extractedAddress) {
                const addrEl = document.getElementById('configAddress');
                if (addrEl) addrEl.value = extractedAddress;
                filled = true;
            }
            
            if (filled) {
                // Clear the paste area immediately after successful extraction to keep UI clean
                outboundInvoicePasteArea.value = '';
                // Temporary success message inside the paste area label
                const label = outboundInvoicePasteArea.previousElementSibling;
                const originalText = label.innerHTML;
                label.innerHTML = '✅ Auto-Fill Success!';
                label.style.color = 'var(--accent-emerald)';
                setTimeout(() => {
                    label.innerHTML = originalText;
                    label.style.color = 'var(--accent-blue)';
                }, 2000);
            }
        });
    }

    // Toggle Sequence elements
    if (outboundSequenceToggle) {
        outboundSequenceToggle.addEventListener('change', () => {
            if (outboundSequenceToggle.checked) {
                if (outboundQtyInputGroup) outboundQtyInputGroup.style.display = 'block';
                if (outboundInputLabel) outboundInputLabel.textContent = 'Enter Sequence Start Serial';
                if (outboundInputHelper) outboundInputHelper.textContent = 'Enter first barcode of the sequence batch';
                if (outboundSubmitBtnText) outboundSubmitBtnText.textContent = 'Generate Sequence';
            } else {
                if (outboundQtyInputGroup) outboundQtyInputGroup.style.display = 'none';
                if (outboundInputLabel) outboundInputLabel.textContent = 'Scan Serial Number';
                if (outboundInputHelper) outboundInputHelper.textContent = 'Press Enter key to save immediately';
                if (outboundSubmitBtnText) outboundSubmitBtnText.textContent = 'Scan Item';
            }
        });
    }

    // unified scan submission
    if (outboundUnifiedScanForm) {
        outboundUnifiedScanForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!activeOutboundSession) return;

            const baseCode = outboundUnifiedSerialInput.value.trim();
            if (!baseCode) return;

            if (outboundSequenceToggle && outboundSequenceToggle.checked) {
                const qtyVal = parseInt(outboundUnifiedQtyInput.value) || 5;
                generateOutboundSequenceSerials(baseCode, qtyVal);
            } else {
                if (baseCode.includes(',')) {
                    const serials = baseCode.split(',').map(s => s.trim()).filter(s => s.length > 0);
                    let allSuccess = true;
                    for (const s of serials) {
                        const success = addOutboundSerialToSession(s);
                        if (!success) {
                            allSuccess = false;
                            break; // Stop loop if a warning/alert is triggered
                        }
                    }
                    if (allSuccess) {
                        outboundUnifiedSerialInput.value = '';
                    }
                } else {
                    const success = addOutboundSerialToSession(baseCode);
                    if (success) {
                        outboundUnifiedSerialInput.value = '';
                    }
                }
            }
        });
    }

    // lookup helpers
    function lookupProductBySerial(serial) {
        if (!serial) return null;
        const cleanUpper = serial.trim().toUpperCase();
        const found = getInboundSerialLogMap().get(cleanUpper);
        if (found && found.itemName) {
            return found.itemName;
        }
        if (cleanUpper.startsWith("GXTFT")) return 'LED Monitor 19.5" (Geonix)';
        if (cleanUpper.startsWith("BWR")) return 'Bubble Wrap Roll';
        return lookupProductBySkuPattern(serial);
    }

    function lookupProductBySkuPattern(serial) {
        const history = getHistory();
        for (const log of history) {
            const itemsList = [];
            if (log.items && Array.isArray(log.items)) {
                log.items.forEach(i => itemsList.push(i));
            } else if (log.item) {
                itemsList.push({ name: log.item, expectedQty: log.expected || 10 });
            }

            for (const item of itemsList) {
                const itemName = typeof item === 'string' ? item : (item.name || '');
                if (!itemName) continue;

                let allowed = (item && typeof item === 'object') ? item.allowedPatterns : null;
                if (!allowed || allowed.length === 0) {
                    // Inject fallback allowedPatterns for legacy/mock data checks
                    if (itemName.includes("LED Monitor")) {
                        allowed = [{
                            pattern: { 0: "G", 1: "X", 2: "T", 3: "F", 4: "T", 8: "V", 9: "C", 10: "P", 11: "B" },
                            length: 18
                        }, {
                            pattern: { 0: "G", 1: "X", 2: "T", 3: "F", 4: "T", 8: "V", 9: "C", 10: "P", 11: "B" },
                            length: 19
                        }];
                    } else if (itemName.includes("Bubble Wrap")) {
                        allowed = [{
                            pattern: { 0: "B", 1: "W", 2: "R" },
                            length: 9
                        }];
                    }
                }

                if (allowed) {
                    const match = allowed.some(cfg => {
                        return cfg && cfg.pattern && matchesAlphabetPattern(serial, cfg.pattern) && serial.length === cfg.length;
                    });
                    if (match) return itemName;
                }
            }
        }
        return null;
    }

    function populateUnrecognizedProductDropdown() {
        const select = document.getElementById('unrecognizedProductSelect');
        if (!select) return;
        select.innerHTML = '';
        inboundItems.forEach(item => {
            const opt = document.createElement('option');
            opt.value = item;
            opt.textContent = item;
            select.appendChild(opt);
        });
    }

    // Outbound validation and save scanning
    function addOutboundSerialToSession(serial) {
        if (!activeOutboundSession) return false;

        const cleanSerial = serial.trim();
        const cleanSerialUpper = cleanSerial.toUpperCase();
        const foundDeleted = getDeletedSerialsFastMap().get(cleanSerialUpper);
        if (foundDeleted) {
            if (deletedSerialDismissTimer) {
                clearTimeout(deletedSerialDismissTimer);
            }
            showSkuWarningModal(
                'Deleted Serial Alert!',
                `ye number delet ho chuka hai`,
                'DELETED AT:',
                foundDeleted.deletedAt || 'N/A',
                'SCANNED BARCODE:',
                cleanSerial,
                false,
                false
            );
            
            deletedSerialDismissTimer = setTimeout(() => {
                skuWarningModal.classList.remove('active');
                deletedSerialDismissTimer = null;
                if (activeOutboundSession) {
                    refocusOutboundInput();
                }
            }, 5000);
            return false;
        }

        if (cleanSerial.length > 50) {
            showSkuWarningModal(
                'Invalid Serial Number!',
                `The scanned barcode is too long (${cleanSerial.length} characters). Max allowed length is 50 characters. Scan is rejected.`,
                'EXPECTED SKU:',
                'Max 50 Chars',
                'SCANNED BARCODE:',
                cleanSerial,
                false
            );
            return false;
        }

        // Damaged check (O(1) Set lookup)
        const isDamaged = getDamageSerialsFastSet().has(cleanSerialUpper);
        if (isDamaged) {
            showSkuWarningModal(
                'Damaged Product Alert!',
                `The scanned serial barcode "${cleanSerial}" is marked as DAMAGED and cannot be dispatched!`,
                'STATUS:',
                'DAMAGED',
                'SCANNED BARCODE:',
                cleanSerial,
                false
            );
            return false;
        }

        // Already Dispatched check (O(1) Map lookup)
        const alreadyDispatchedLog = getOutboundSerialLogMap().get(cleanSerialUpper);

        if (alreadyDispatchedLog) {
            showSkuWarningModal(
                'Already Dispatched Alert!',
                `The scanned serial barcode "${cleanSerial}" has already been dispatched in a previous outbound session.`,
                'DISPATCHED TO SHOP:',
                alreadyDispatchedLog.shopName || 'N/A',
                'INVOICE / SO NO:',
                alreadyDispatchedLog.invoiceNo || 'N/A',
                false,
                false,
                cleanSerial
            );
            return false;
        }

        // Duplicate scan check
        const isDup = activeOutboundSession.serials.some(s => s.serial === cleanSerial);
        if (isDup) {
            showSkuWarningModal(
                'Duplicate Outbound Scan!',
                `The serial barcode "${serial}" has already been scanned in this outbound dispatch.`,
                'SCANNED BARCODE:',
                serial,
                'DUPLICATE:',
                'DUPLICATE',
                false
            );
            return false;
        }

        // Identify product
        let productName = lookupProductBySerial(serial);
        if (!productName) {
            productName = lookupProductBySkuPattern(serial);
        }
        if (!productName && activeOutboundSession && activeOutboundSession.items) {
            productName = deriveProductNameFromPattern(serial, activeOutboundSession.items);
        }

        // Unrecognized barcode popup - directly reject scan
        if (!productName) {
            showSkuWarningModal(
                'Unrecognized Barcode!',
                `The scanned serial barcode "${serial}" could not be matched to any Inbound log database product. Scan is rejected.`,
                'EXPECTED SKU:',
                'Any Inbound SKU',
                'SCANNED BARCODE:',
                serial,
                false
            );
            return false;
        }

        // Target product check
        let targetItem = activeOutboundSession.items.find(i => i.name === productName);
        if (!targetItem) {
            // If it is the first product of the session, add it automatically without warnings
            if (activeOutboundSession.items.length === 0) {
                const newItemObj = {
                    name: productName,
                    skuAlphabetPattern: null,
                    lockedLength: null,
                    allowedPatterns: []
                };
                
                const newPattern = extractAlphabetPattern(serial);
                newItemObj.skuAlphabetPattern = newPattern;
                newItemObj.lockedLength = serial.length;
                newItemObj.allowedPatterns.push({ pattern: newPattern, length: serial.length });
                
                activeOutboundSession.items.push(newItemObj);
                saveOutboundSerial(serial, productName);
                return true;
            }

            // Set state variables for SKU Warning Modal to capture
            lastRejectedSerial = serial;
            lastRejectedItemName = productName;
            lastRejectedIsSequence = false;

            // Trigger unified SKU Warning Modal with showAddBtn = true!
            showSkuWarningModal(
                'Another Product Detected!',
                `Scanned serial barcode "${serial}" belongs to product: "${productName}". Do you want to add this product to the current outbound dispatch?`,
                'EXPECTED SKU:',
                'Session Products',
                'SCANNED BARCODE:',
                `${productName} (${serial})`,
                false, // showAllowLengthBtn
                true,  // showAddBtn (enables Add Product button and double-scan gesture input!)
                serial // Raw serial passed as extraVal
            );
            return false;
        }

        // Validate structure rules
        let isMatched = false;
        if (targetItem.allowedPatterns && targetItem.allowedPatterns.length > 0) {
            isMatched = targetItem.allowedPatterns.some(cfg => {
                return matchesAlphabetPattern(serial, cfg.pattern) && serial.length === cfg.length;
            });
        } else if (targetItem.skuAlphabetPattern) {
            isMatched = matchesAlphabetPattern(serial, targetItem.skuAlphabetPattern) && serial.length === (targetItem.lockedLength || 15);
        } else {
            const newPattern = extractAlphabetPattern(serial);
            targetItem.skuAlphabetPattern = newPattern;
            targetItem.lockedLength = serial.length;
            if (!targetItem.allowedPatterns) targetItem.allowedPatterns = [];
            targetItem.allowedPatterns.push({ pattern: newPattern, length: serial.length });
            isMatched = true;
        }

        if (!isMatched) {
            let isLengthMismatch = false;
            if (targetItem.allowedPatterns && targetItem.allowedPatterns.length > 0) {
                isLengthMismatch = targetItem.allowedPatterns.some(cfg => {
                    return matchesAlphabetPattern(serial, cfg.pattern);
                });
            } else if (targetItem.skuAlphabetPattern) {
                isLengthMismatch = matchesAlphabetPattern(serial, targetItem.skuAlphabetPattern);
            }

            lastRejectedSerial = serial;
            lastRejectedItemName = productName;
            lastRejectedIsSequence = false;

            if (isLengthMismatch) {
                showSkuWarningModal(
                    'Incomplete Barcode Scan!',
                    `Length mismatch detected for item "${productName}". Expected: ${targetItem.lockedLength} chars, Scanned: ${serial.length} chars.`,
                    'EXPECTED SKU:',
                    targetItem.skuAlphabetPattern ? Object.keys(targetItem.skuAlphabetPattern).sort((a,b)=>a-b).map(k=>targetItem.skuAlphabetPattern[k]).join('') : 'X',
                    'SCANNED BARCODE:',
                    serial,
                    true
                );
            } else {
                showSkuWarningModal(
                    'Another Product Detected!',
                    `Scanned serial barcode "${serial}" belongs to product: "${productName || 'Another Product'}". Do you want to add this product to the current outbound dispatch?`,
                    'EXPECTED SKU:',
                    targetItem.skuAlphabetPattern ? formatAlphabetPattern(targetItem.skuAlphabetPattern, targetItem.lockedLength || serial.length) : 'Session SKU',
                    'SCANNED BARCODE:',
                    `${productName || 'Detected'} (${serial})`,
                    false, // showAllowLengthBtn
                    true,  // showAddBtn (enables + Add Product button & double scan confirmation!)
                    serial
                );
            }
            return false;
        }

        saveOutboundSerial(serial, productName);
        return true;
    }

    function saveOutboundSerial(serial, productName) {
        if (!activeOutboundSession) return;
        
        // 1 action = 1 box: get max box number for this product and add 1
        const itemSerials = activeOutboundSession.serials.filter(s => s.itemName === productName);
        const maxBoxNo = itemSerials.reduce((max, item) => item.boxNo > max ? item.boxNo : max, 0);
        const boxNo = maxBoxNo + 1;

        activeOutboundSession.serials.push({
            serial: serial,
            boxNo: boxNo,
            itemName: productName
        });

        // Speak last 3 digits
        const last3 = serial.slice(-3);
        const speakStr = last3.split('').join(', ');
        triggerSpeak(speakStr);

        saveActiveOutboundSession();
        updateOutboundSessionProgress();
        renderOutboundBoxCards();
        refocusOutboundInput();
    }

    function refocusOutboundInput() {
        if (outboundUnifiedSerialInput) {
            outboundUnifiedSerialInput.value = '';
            outboundUnifiedSerialInput.focus();
        }
    }

    function generateOutboundSequenceSerials(baseCode, count) {
        if (!activeOutboundSession) return;

        let productName = lookupProductBySerial(baseCode);
        if (!productName) {
            productName = lookupProductBySkuPattern(baseCode);
        }

        if (!productName) {
            showSkuWarningModal(
                'Unrecognized Barcode!',
                `The sequence base code "${baseCode}" could not be matched to any Inbound log database product. Scan is rejected.`,
                'EXPECTED SKU:',
                'Any Inbound SKU',
                'SCANNED BARCODE:',
                baseCode,
                false
            );
            return;
        }

        let targetItem = activeOutboundSession.items.find(i => i.name === productName);
        if (!targetItem) {
            // If it is the first product of the session, add it automatically without warnings
            if (activeOutboundSession.items.length === 0) {
                const newItemObj = {
                    name: productName,
                    skuAlphabetPattern: null,
                    lockedLength: null,
                    allowedPatterns: []
                };
                
                const newPattern = extractAlphabetPattern(baseCode);
                newItemObj.skuAlphabetPattern = newPattern;
                newItemObj.lockedLength = baseCode.length;
                newItemObj.allowedPatterns.push({ pattern: newPattern, length: baseCode.length });
                
                activeOutboundSession.items.push(newItemObj);
                generateOutboundSequenceSerials(baseCode, count);
                return;
            }

            // Set state variables for SKU Warning Modal to capture
            lastRejectedSerial = baseCode;
            lastRejectedItemName = productName;
            lastRejectedIsSequence = true;
            lastRejectedSeqBase = baseCode;
            lastRejectedSeqCount = count;

            // Trigger unified SKU Warning Modal with showAddBtn = true!
            showSkuWarningModal(
                'Another Product Detected!',
                `The sequence base code "${baseCode}" belongs to product: "${productName}". Do you want to add this product to the current outbound dispatch?`,
                'EXPECTED SKU:',
                'Session Products',
                'SCANNED BARCODE:',
                `${productName} (${baseCode})`,
                false, // showAllowLengthBtn
                true,  // showAddBtn (enables Add Product button and double-scan gesture input!)
                baseCode // Raw base code passed as extraVal
            );
            return;
        }

        const prefixMatch = baseCode.match(/^([A-Za-z]+)/);
        const suffixMatch = baseCode.match(/(\d+)$/);
        if (!prefixMatch || !suffixMatch) {
            alert('Invalid base code for sequence generation. Must start with letters and end with digits.');
            return;
        }

        const letters = prefixMatch[1];
        const numPart = suffixMatch[1];
        const totalLen = baseCode.length;
        const startNum = parseInt(numPart);
        const numLen = numPart.length;

        const generatedBatch = [];
        for (let i = 0; i < count; i++) {
            const nextNum = startNum + i;
            const paddedNum = String(nextNum).padStart(numLen, '0');
            const middleOffset = totalLen - letters.length - numLen;
            let serial = '';
            if (middleOffset > 0) {
                const middle = baseCode.substring(letters.length, letters.length + middleOffset);
                serial = letters + middle + paddedNum;
            } else {
                serial = letters + paddedNum;
            }
            generatedBatch.push(serial);
        }

        // Pre-build O(1) lookup structures outside the loop to prevent browser freeze
        const outboundHistory = getOutboundHistory();
        const dispatchedSerialsMap = {};
        outboundHistory.forEach(log => {
            if (log.serials) {
                log.serials.forEach(s => {
                    dispatchedSerialsMap[s.serial] = log;
                });
            }
        });
        
        const activeSerialsSet = new Set(activeOutboundSession.serials.map(s => s.serial));

        for (const code of generatedBatch) {
            // Check if already dispatched in history
            const alreadyDispatchedLog = dispatchedSerialsMap[code];
            if (alreadyDispatchedLog) {
                showSkuWarningModal(
                    'Already Dispatched Alert!',
                    `The sequence barcode "${code}" has already been dispatched in a previous outbound session.`,
                    'DISPATCHED TO SHOP:',
                    alreadyDispatchedLog.shopName || 'N/A',
                    'INVOICE / SO NO:',
                    alreadyDispatchedLog.invoiceNo || 'N/A',
                    false,
                    false,
                    code
                );
                return;
            }

            const isDup = activeSerialsSet.has(code);
            if (isDup) {
                showSkuWarningModal(
                    'Duplicate Outbound Sequence Scan!',
                    `The sequence barcode "${code}" is already scanned in this outbound dispatch.`,
                    'SCANNED BARCODE:',
                    code,
                    'DUPLICATE:',
                    'DUPLICATE',
                    false
                );
                return;
            }
            activeSerialsSet.add(code);

            let isMatched = false;
            if (targetItem.allowedPatterns && targetItem.allowedPatterns.length > 0) {
                isMatched = targetItem.allowedPatterns.some(cfg => {
                    return matchesAlphabetPattern(code, cfg.pattern) && code.length === cfg.length;
                });
            } else if (targetItem.skuAlphabetPattern) {
                isMatched = matchesAlphabetPattern(code, targetItem.skuAlphabetPattern) && code.length === (targetItem.lockedLength || 15);
            } else {
                const newPattern = extractAlphabetPattern(code);
                targetItem.skuAlphabetPattern = newPattern;
                targetItem.lockedLength = code.length;
                if (!targetItem.allowedPatterns) targetItem.allowedPatterns = [];
                targetItem.allowedPatterns.push({ pattern: newPattern, length: code.length });
                isMatched = true;
            }

            if (!isMatched) {
                let isLengthMismatch = false;
                if (targetItem.allowedPatterns && targetItem.allowedPatterns.length > 0) {
                    isLengthMismatch = targetItem.allowedPatterns.some(cfg => {
                        return matchesAlphabetPattern(code, cfg.pattern);
                    });
                } else if (targetItem.skuAlphabetPattern) {
                    isLengthMismatch = matchesAlphabetPattern(code, targetItem.skuAlphabetPattern);
                }

                lastRejectedSerial = code;
                lastRejectedItemName = productName;
                lastRejectedIsSequence = true;
                lastRejectedSeqBase = baseCode;
                lastRejectedSeqCount = count;

                if (isLengthMismatch) {
                    showSkuWarningModal(
                        'Incomplete Barcode Scan (Sequence)!',
                        `Length mismatch in batch. Expected: ${targetItem.lockedLength} chars. Code: "${code}".`,
                        'EXPECTED SKU:',
                        targetItem.skuAlphabetPattern ? Object.keys(targetItem.skuAlphabetPattern).sort((a,b)=>a-b).map(k=>targetItem.skuAlphabetPattern[k]).join('') : 'X',
                        'SCANNED BARCODE:',
                        code,
                        true
                    );
                } else {
                    showSkuWarningModal(
                        'SKU Mismatch Error (Sequence)!',
                        `Alphabet mismatch in batch. Expected: ${productName} pattern. Code: "${code}".`,
                        'EXPECTED SKU:',
                        targetItem.skuAlphabetPattern ? Object.keys(targetItem.skuAlphabetPattern).sort((a,b)=>a-b).map(k=>targetItem.skuAlphabetPattern[k]).join('') : 'X',
                        'SCANNED BARCODE:',
                        code,
                        false
                    );
                }
                return;
            }
        }

        // Determine Box Number for this batch (grouped under a single new Box, Product-Specific)
        const itemSerials = activeOutboundSession.serials.filter(s => s.itemName === productName);
        const maxBoxNo = itemSerials.reduce((max, item) => item.boxNo > max ? item.boxNo : max, 0);
        const nextBoxNo = maxBoxNo + 1;

        generatedBatch.forEach(code => {
            activeOutboundSession.serials.push({
                serial: code,
                boxNo: nextBoxNo,
                itemName: productName
            });
        });

        // Speak last 3 digits of the first serial scanned in this sequence
        if (generatedBatch.length > 0) {
            const firstSerial = generatedBatch[0];
            const last3 = firstSerial.slice(-3);
            const speakStr = last3.split('').join(', ');
            triggerSpeak(speakStr);
        }

        saveActiveOutboundSession();
        updateOutboundSessionProgress();
        renderOutboundBoxCards();
        refocusOutboundInput();
    }

    // Outbound History database
    function getOutboundHistory() {
        if (cachedOutboundHistory !== null) {
            return cachedOutboundHistory;
        }
        const saved = localStorage.getItem('wms_outbound_history');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                    cachedOutboundHistory = parsed;
                    return cachedOutboundHistory;
                }
            } catch (e) {
                console.error("Error parsing wms_outbound_history:", e);
            }
        }
        cachedOutboundHistory = [];
        return cachedOutboundHistory;
    }

    function saveOutboundHistory(historyData) {
        cachedOutboundHistory = historyData;
        outboundSerialLogMap = null;
        cachedProductStockMap = null;
        localStorage.setItem('wms_outbound_history', JSON.stringify(historyData));
        firebaseSet('outbound_history', historyData);
    }

    function renderOutboundHistoryTable() {
        const body = document.getElementById('outboundHistoryBody');
        if (!body) return;
        body.innerHTML = '';
        
        const mobileContainer = document.getElementById('outboundHistoryMobileCards');
        if (mobileContainer) {
            mobileContainer.innerHTML = '';
        }
        
        let todayBoxesSum = 0;
        let todayWeightSum = 0;
        
        const historyData = getOutboundHistory();

        const trFrag = document.createDocumentFragment();
        const mobileFrag = document.createDocumentFragment();

        // High Performance Optimization: Limit initial rendering to top 100 recent entries to prevent main thread blocking
        const renderLimit = 100;
        const displayData = historyData.slice(0, renderLimit);

        displayData.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.className = (index % 2 === 0) ? 'white-row' : 'black-row';
            let totalWeight = 0;
            const serialsByItemMap = new Map();
            (row.serials || []).forEach(s => {
                totalWeight += s.resolvedWeight !== undefined ? s.resolvedWeight : resolveItemWeight(s.serial, s.itemName);
                if (s && s.itemName) {
                    let list = serialsByItemMap.get(s.itemName);
                    if (!list) {
                        list = [];
                        serialsByItemMap.set(s.itemName, list);
                    }
                    list.push(s);
                }
            });

            const itemNamesHtml = (() => {
                const lines = (row.items || []).map(i => {
                    const count = (serialsByItemMap.get(i.name) || []).length;
                    return `<div style="display:flex; align-items:center; gap:6px; padding: 2px 0; white-space:nowrap;">
                        <span style="color:var(--accent-blue); font-size:0.65rem;">●</span>
                        <span style="font-size:0.82rem;">${i.name}</span>
                        <span style="background:rgba(16,185,129,0.12); color:var(--accent-emerald); border:1px solid rgba(16,185,129,0.25); font-size:0.68rem; font-weight:800; padding:1px 6px; border-radius:10px; white-space:nowrap;">${count} pcs</span>
                    </div>`;
                });
                return lines.length > 0
                    ? `<div style="display:flex; flex-direction:column; gap:2px; min-width:180px;">${lines.join('')}</div>`
                    : '<span style="color:var(--text-muted);">N/A</span>';
            })();

            // Calculate total PCs and Boxes count
            const totalPcs = (row.serials || []).length;
            let totalBoxes = 0;
            const rowItems = row.items || [];
            rowItems.forEach(i => {
                const itemSerials = serialsByItemMap.get(i.name) || [];
                const itemBoxes = new Set(itemSerials.map(s => s.boxNo)).size;
                totalBoxes += itemBoxes;
            });
            if (rowItems.length === 0 && (row.serials || []).length > 0) {
                totalBoxes = new Set((row.serials || []).map(s => s.boxNo)).size;
            }

            // Check if this log was created today
            let rowIsToday = false;
            const logTimestamp = parseInt(row.id);
            if (!isNaN(logTimestamp)) {
                const logDate = new Date(logTimestamp);
                const today = new Date();
                if (logDate.getDate() === today.getDate() &&
                    logDate.getMonth() === today.getMonth() &&
                    logDate.getFullYear() === today.getFullYear()) {
                    rowIsToday = true;
                }
            }

            // Add details to today summary if created today OR if checked/marked
            if (rowIsToday || row.isChecked) {
                todayBoxesSum += totalBoxes;
                todayWeightSum += totalWeight;
            }

            let timestampHtml = row.timestamp;
            if (rowIsToday) {
                timestampHtml = `${row.timestamp} <span style="background: var(--accent-emerald); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.65rem; font-weight: 800; text-transform: uppercase; margin-left: 6px; display: inline-block; vertical-align: middle;">Today</span>`;
                tr.style.borderLeft = "4px solid var(--accent-emerald)";
            }

            // Build checkbox indicator HTML
            const isChecked = row.isChecked || false;
            const checkedIcon = isChecked 
                ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 20px; height: 20px; color: var(--accent-emerald); display: block; margin: 0 auto;"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" /></svg>` 
                : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 20px; height: 20px; color: var(--text-muted); display: block; margin: 0 auto;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;

            tr.innerHTML = `
                <td style="text-align: center; cursor: pointer; padding: 10px 8px;" class="btn-toggle-outbound-mark" data-id="${row.id}" title="Toggle Marked Summary Inclusion">
                    ${checkedIcon}
                </td>
                <td class="font-mono" style="font-size:1.15rem; font-weight:900; color:#fff;">${timestampHtml}</td>
                <td style="font-size:1.15rem; font-weight:900; color:#fff;">${row.shopName}</td>
                <td class="font-mono" style="font-size:1.05rem; font-weight:900; color:#fff;">${row.invoiceNo}</td>
                <td>
                    ${(() => {
                        if (!row.pincode) return `<span style="color: var(--text-muted); font-size: 0.8rem;">—</span>`;
                        const odaInfo = getMultiCourierOdaStatus(row.pincode);
                        return `<div style="display: flex; flex-direction: column; gap: 4px; align-items: flex-start;">
                                    <span style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono); font-weight: 700;">PIN: ${row.pincode}</span>
                                    <div style="display: flex; gap: 4px; flex-wrap: wrap;">
                                        ${odaInfo.badgeHtml}
                                    </div>
                                </div>`;
                    })()}
                </td>
                <td>
                    ${row.courierRecommendation 
                        ? `<span style="display:inline-flex; align-items:center; gap:5px; background:#1d4ed8; color:#fff; padding:3px 10px; border-radius:6px; font-size:0.75rem; font-weight:800; white-space:nowrap;">🚚 ${row.courierRecommendation}</span>`
                        : `<span style="color:var(--text-muted); font-size:0.8rem;">—</span>`}
                </td>
                <td style="padding: 10px 16px;">${itemNamesHtml}</td>
                <td class="font-mono" style="font-size:1.15rem; font-weight:900; color:#fff;">${totalWeight.toFixed(3)} kg</td>
                <td class="font-mono" style="font-size:1.5rem; font-weight:900; color:#e11d48;">${totalPcs}</td>
                <td class="font-mono" style="text-align:center;">
                    <button type="button" class="btn-show-outbound-box-details" data-id="${row.id}"
                        style="background: #e11d48; border: none; color: #ffffff; padding: 12px 20px; border-radius: var(--radius-md); font-size: 2.2rem; font-weight: 900; cursor: pointer; transition: var(--transition-smooth); min-width: 64px; line-height: 1; box-shadow: 0 4px 14px rgba(225,29,72,0.4);">
                        ${totalBoxes}
                    </button>
                </td>
                <td>
                    <button type="button" class="btn-download-outbound-excel" data-id="${row.id}" title="Download Outbound Excel" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-emerald); color: var(--accent-emerald); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: var(--transition-smooth); border-style: solid;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Excel
                    </button>
                    <button type="button" class="btn-restore-outbound-log" data-id="${row.id}" title="Restore Outbound Session" style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--accent-blue); padding: 4px 10px; border-radius: var(--radius-sm); font-size: 0.8rem; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: var(--transition-smooth); border-style: solid; margin-left: 6px;">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                        Restore
                    </button>
                </td>
            `;
            trFrag.appendChild(tr);

            // Generate Mobile Card HTML
            if (mobileContainer) {
                const card = document.createElement('div');
                card.className = 'mobile-log-card';
                card.style.cssText = `
                    background: var(--bg-secondary);
                    border: 1px solid var(--border-color);
                    ${rowIsToday ? 'border-left: 4px solid var(--accent-emerald);' : ''}
                    border-radius: 12px;
                    padding: 14px;
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    box-sizing: border-box;
                    width: 100%;
                    min-width: 0;
                    overflow: hidden;
                `;

                // Checkbox mark status indicator
                const mobileCheckIcon = isChecked
                    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" style="width: 18px; height: 18px; color: var(--accent-emerald); cursor: pointer;"><path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" /></svg>` 
                    : `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 18px; height: 18px; color: var(--text-muted); cursor: pointer;"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>`;

                // Item pills list with pink bullet point
                const mobileItemsHtml = (row.items || []).map(i => {
                    const count = (serialsByItemMap.get(i.name) || []).length;
                    return `
                        <div style="display: flex; align-items: flex-start; gap: 6px; font-size: 0.82rem; color: var(--text-primary); font-weight: 600; line-height: 1.35; word-break: break-word;">
                            <span style="color: #f43f5e; font-size: 0.7rem; margin-top: 3px; flex-shrink: 0;">●</span>
                            <span>${i.name} (${count} pcs)</span>
                        </div>
                    `;
                }).join('');

                let mobileOdaBadge = '';
                if (row.pincode) {
                    const odaInfo = getMultiCourierOdaStatus(row.pincode);
                    mobileOdaBadge = `<div style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 2px;">${odaInfo.badgeHtml}</div>`;
                }

                // Format Full Date + Time Display
                let timestampDisplay = row.timestamp || 'N/A';
                let fullDateStr = '';
                if (row.date) {
                    fullDateStr = row.date;
                } else if (!isNaN(parseInt(row.id))) {
                    const d = new Date(parseInt(row.id));
                    const day = String(d.getDate()).padStart(2, '0');
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const month = months[d.getMonth()];
                    const year = d.getFullYear();
                    fullDateStr = `${day} ${month} ${year}`;
                }
                const fullDateTimeDisplay = fullDateStr ? `${fullDateStr} • ${timestampDisplay}` : timestampDisplay;

                card.innerHTML = `
                    <!-- 1. Top Header: Full Shop Name (No Truncation) + Distinct 24 PCs Badge -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; width: 100%;">
                        <h4 style="font-size: 1.05rem; font-weight: 800; color: #ffffff; margin: 0; line-height: 1.3; flex: 1; word-break: break-word; letter-spacing: 0.01em;">${row.shopName}</h4>
                        <span style="font-size: 0.82rem; font-weight: 800; color: #10b981; font-family: var(--font-mono); white-space: nowrap; flex-shrink: 0; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); padding: 4px 10px; border-radius: 6px; text-transform: uppercase;">${totalPcs} PCs</span>
                    </div>

                    <!-- 2. Sub-header Row: Full Date + Time • Red Invoice No • Pincode/ODA • MARK Checkmark -->
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%; margin-top: 4px; font-size: 0.82rem;">
                        <div style="display: flex; flex-direction: column; gap: 2px;">
                            <span style="color: #8a8f9e; font-weight: 500;">${fullDateTimeDisplay}</span>
                            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                <span style="font-family: var(--font-mono); font-size: 0.9rem; font-weight: 800; color: #f43f5e;">${row.invoiceNo}</span>
                                ${row.pincode ? `<span style="font-family: var(--font-mono); font-size: 0.78rem; color: #8a8f9e; font-weight: 700;">(${row.pincode})</span>` : ''}
                                ${mobileOdaBadge}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span style="font-size: 0.72rem; color: #8a8f9e; text-transform: uppercase; font-weight: 700;">MARK:</span>
                            <span class="btn-toggle-outbound-mark" data-id="${row.id}" style="display: inline-flex; align-items: center; justify-content: center; cursor: pointer;">
                                ${mobileCheckIcon}
                            </span>
                        </div>
                    </div>

                    <!-- 3. Full Inner Product Box (All Items Visible, Zero Hidden Details) -->
                    <div style="background: rgba(0, 0, 0, 0.35); border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; width: 100%; box-sizing: border-box; margin-top: 4px;">
                        <div style="display: flex; flex-direction: column; gap: 6px; width: 100%;">
                            ${mobileItemsHtml}
                        </div>

                        <div style="border-top: 1px dashed var(--border-color); margin: 2px 0;"></div>

                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem;">
                            <span style="color: #8a8f9e; font-weight: 500;">Total Weight:</span>
                            <span style="color: #10b981; font-weight: 800; font-family: var(--font-mono); font-size: 0.95rem;">${totalWeight.toFixed(3)} kg</span>
                        </div>

                        ${row.courierRecommendation 
                            ? `<div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; border-top: 1px dashed var(--border-color); padding-top: 6px;">
                                <span style="color: #8a8f9e; font-weight: 500;">Courier:</span>
                                <span style="background: #1d4ed8; color: #ffffff; padding: 3px 10px; border-radius: 6px; font-size: 0.78rem; font-weight: 800; display: inline-flex; align-items: center; gap: 4px;">🚚 ${row.courierRecommendation}</span>
                               </div>`
                            : ''}
                    </div>

                    <!-- 4. Action Buttons Row (Always Positioned at Very Bottom in Straight Horizontal Line Across Cards) -->
                    <div style="display: flex; gap: 8px; width: 100%; margin-top: auto; padding-top: 12px;">
                        <button type="button" class="btn-show-outbound-box-details" data-id="${row.id}" style="flex: 1; background: rgba(244, 63, 94, 0.08); border: 1px solid #f43f5e; color: #f43f5e; padding: 8px 6px; border-radius: 6px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s;">
                            <span>Boxes (${totalBoxes})</span>
                        </button>
                        <button type="button" class="btn-download-outbound-excel" data-id="${row.id}" style="flex: 1; background: rgba(16, 185, 129, 0.08); border: 1px solid #10b981; color: #10b981; padding: 8px 6px; border-radius: 6px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                            </svg>
                            <span>Excel</span>
                        </button>
                        <button type="button" class="btn-restore-outbound-log" data-id="${row.id}" style="flex: 1; background: rgba(99, 102, 241, 0.08); border: 1px solid #6366f1; color: #818cf8; padding: 8px 6px; border-radius: 6px; font-weight: 800; font-size: 0.82rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 4px; transition: all 0.2s;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                            </svg>
                            <span>Restore</span>
                        </button>
                    </div>
                `;
                mobileFrag.appendChild(card);
            }
        });

        body.appendChild(trFrag);
        if (mobileContainer) {
            mobileContainer.appendChild(mobileFrag);
        }


        const todayOutboundBoxesEl = document.getElementById('todayOutboundBoxes');
        const todayOutboundWeightEl = document.getElementById('todayOutboundWeight');
        if (todayOutboundBoxesEl) todayOutboundBoxesEl.textContent = todayBoxesSum;
        if (todayOutboundWeightEl) todayOutboundWeightEl.textContent = `${todayWeightSum.toFixed(3)} kg`;
    }

    function downloadOutboundLogExcel(log) {
        try {
            if (!window.XLSX) {
                alert('Excel library not loaded.');
                return;
            }
            const wb = XLSX.utils.book_new();
            const items = log.items || [];
            const serials = log.serials || [];

            // Extract last digits of Invoice/SO No.
            let lastIdPart = log.invoiceNo || '';
            const idMatch = lastIdPart.trim().match(/\/([^\/]+)$/);
            if (idMatch) {
                lastIdPart = idMatch[1].trim();
            } else {
                lastIdPart = lastIdPart.trim();
            }

            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, '-'); // DD-MM-YYYY
            const timeStr = now.toLocaleTimeString('en-US', { hour12: false });
            
            // Header text inside cell A1 of every sheet
            let headerText = `${log.shopName} - ${lastIdPart} - ${dateStr} ${timeStr}`;
            if (log.pincode) {
                headerText += ` - PIN: ${log.pincode} (${log.odaStatus || 'Normal'})`;
            }

            const seenSheetNames = new Set();

            items.forEach(item => {
                const itemSerials = serials.filter(s => s.itemName === item.name);

                const sheetRows = itemSerials.map((s, idx) => ({
                    "S.No.": idx + 1,
                    "Box Number": `Box ${s.boxNo}`,
                    "Serial Number": (s.serial.startsWith("Without Serial Number") || s.serial.startsWith("WOS-OUT-") || s.serial.includes("WOS-")) ? "Without Serial Number" : s.serial,
                    "Product Name": s.itemName
                }));

                if (sheetRows.length === 0) {
                    sheetRows.push({
                        "S.No.": 1,
                        "Box Number": "N/A",
                        "Serial Number": "No serial numbers packed",
                        "Product Name": item.name
                    });
                }

                // Create sheet with A1 header, then append JSON starting at A3
                const ws = XLSX.utils.aoa_to_sheet([[headerText]]);
                XLSX.utils.sheet_add_json(ws, sheetRows, { origin: "A3" });

                let baseSheetName = item.name.replace(/[\\\/\?\*\[\]\:]/g, "").substring(0, 25).trim();
                if (!baseSheetName) baseSheetName = "Packed Serials";

                let sheetName = baseSheetName;
                let counter = 1;
                while (seenSheetNames.has(sheetName.toLowerCase())) {
                    const suffix = `_${counter}`;
                    sheetName = baseSheetName.substring(0, 31 - suffix.length) + suffix;
                    counter++;
                }
                seenSheetNames.add(sheetName.toLowerCase());

                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });

            // Safe Filename format: SHOPNAME + last ID digit + Date + Time
            const safeShop = (log.shopName || 'Outbound').replace(/[^a-zA-Z0-9]/g, '_');
            const safeId = lastIdPart.replace(/[^a-zA-Z0-9]/g, '_');
            const fileDate = now.toISOString().slice(0, 10).replace(/-/g, '_');
            const fileTime = now.toLocaleTimeString('en-US', { hour12: false }).replace(/:/g, '-');
            
            const filename = `${safeShop}_${safeId}_${fileDate}_${fileTime}`.toUpperCase() + ".xlsx";
            XLSX.writeFile(wb, filename);
        } catch (excelErr) {
            console.error("Excel download failed but operation was saved:", excelErr);
            alert("Excel export encountered an error, but log details have been saved successfully.");
        }
    }

    // --- Outbound Progress UI and Live Count Calculators ---
    function updateOutboundSessionProgress() {
        if (!activeOutboundSession) return;

        const container = document.getElementById('outboundActiveRowsContainer');
        if (container) {
            container.innerHTML = '';
            
            const items = activeOutboundSession.items || [];
            const frag = document.createDocumentFragment();
            
            // Pre-group serials by itemName for O(1) lookup
            const serialsByItemMap = new Map();
            (activeOutboundSession.serials || []).forEach(s => {
                if (s && s.itemName) {
                    let list = serialsByItemMap.get(s.itemName);
                    if (!list) {
                        list = [];
                        serialsByItemMap.set(s.itemName, list);
                    }
                    list.push(s);
                }
            });

            items.forEach(item => {
                const itemSerials = serialsByItemMap.get(item.name) || [];
                const scannedCount = itemSerials.length;
                
                let subtotalWeight = 0;
                itemSerials.forEach(s => {
                    subtotalWeight += resolveItemWeight(s.serial, s.itemName);
                });
                
                const tr = document.createElement('tr');
                
                // Initialize allowedPatterns if missing (legacy recovery)
                if (!item.allowedPatterns) {
                    item.allowedPatterns = item.skuAlphabetPattern ? [{
                        pattern: item.skuAlphabetPattern,
                        length: item.lockedLength || 15
                    }] : [];
                }

                const patternStyle = 'background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--accent-blue); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.8rem; font-family: var(--font-mono); display: block; margin-bottom: 4px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';

                let patternCellHtml = '';
                if (item.allowedPatterns.length > 0) {
                    const badgesHtml = item.allowedPatterns.map(cfg => {
                        const patStr = formatAlphabetPattern(cfg.pattern, cfg.length);
                        return `<span style="${patternStyle}" title="${patStr}">${patStr}</span>`;
                    }).join('');
                    
                    patternCellHtml = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 250px; overflow: hidden;">
                            ${badgesHtml}
                            <button type="button" class="btn-outbound-add-alternative-sku" title="Add alternative accepted SKU pattern structure" style="background: rgba(59, 130, 246, 0.15); border: 1px solid var(--accent-blue); color: var(--accent-blue); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; transition: var(--transition-smooth); white-space: nowrap; margin-top: 2px;">
                                + SKU
                            </button>
                        </div>
                    `;
                } else {
                    patternCellHtml = `
                        <div style="display: flex; flex-direction: column; align-items: flex-start; gap: 4px;">
                            <span style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">Not Locked Yet</span>
                            <button type="button" class="btn-outbound-add-alternative-sku" title="Add alternative accepted SKU pattern structure" style="background: rgba(59, 130, 246, 0.15); border: 1px solid var(--accent-blue); color: var(--accent-blue); cursor: pointer; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; transition: var(--transition-smooth); white-space: nowrap; margin-top: 2px;">
                                + SKU
                            </button>
                        </div>
                    `;
                }

                const targetQtyStr = item.targetQty ? ` / ${item.targetQty}` : '';
                tr.innerHTML = `
                    <td style="font-weight: 700; color: var(--text-primary);">${item.name}</td>
                    <td class="font-mono" style="font-weight: 700;">${scannedCount}${targetQtyStr}</td>
                    <td class="font-mono">${subtotalWeight.toFixed(3)} kg</td>
                    <td style="padding: 12px 8px;">
                        ${patternCellHtml}
                    </td>
                `;
                frag.appendChild(tr);

                // Bind add alternative SKU pattern button click
                const addSkuBtn = tr.querySelector('.btn-outbound-add-alternative-sku');
                if (addSkuBtn) {
                    addSkuBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        
                        const pwd = prompt(`Enter password to authorize adding a new SKU pattern structure (e.g. 2026):`);
                        if (pwd === '2026') {
                            const refSerial = prompt(`Scan or enter a reference serial number representing the new SKU format for "${item.name}":`);
                            if (refSerial) {
                                const cleanRef = refSerial.trim();
                                if (cleanRef) {
                                    const newPattern = extractAlphabetPattern(cleanRef);
                                    const newConfig = { pattern: newPattern, length: cleanRef.length };
                                    
                                    if (!item.allowedPatterns) {
                                        item.allowedPatterns = item.skuAlphabetPattern ? [{
                                            pattern: item.skuAlphabetPattern,
                                            length: item.lockedLength || 15
                                        }] : [];
                                    }
                                    
                                    // Avoid duplicates
                                    const exists = item.allowedPatterns.some(cfg => {
                                        return cfg.length === cleanRef.length && matchesAlphabetPattern(cleanRef, cfg.pattern);
                                    });
                                    
                                    if (!exists) {
                                        item.allowedPatterns.push(newConfig);
                                        // update legacy fields for safety
                                        item.skuAlphabetPattern = newPattern;
                                        item.lockedLength = cleanRef.length;
                                        
                                        saveActiveOutboundSession();
                                        updateOutboundSessionProgress();
                                        alert(`Success! Registered new SKU format of ${cleanRef.length} characters.`);
                                    } else {
                                        alert('This exact SKU format/length is already registered.');
                                    }
                                }
                            }
                        } else if (pwd !== null) {
                            alert('Incorrect password! Access denied.');
                        }
                    });
                }
            });
            container.appendChild(frag);
        }

        const totalPcs = activeOutboundSession.serials.length;
        let uniqueBoxes = 0;
        activeOutboundSession.items.forEach(item => {
            const itemSerials = activeOutboundSession.serials.filter(s => s.itemName === item.name);
            const itemBoxes = new Set(itemSerials.map(s => s.boxNo)).size;
            uniqueBoxes += itemBoxes;
        });
        
        let totalWeight = 0;
        activeOutboundSession.serials.forEach(s => {
            totalWeight += resolveItemWeight(s.serial, s.itemName);
        });

        const countText = document.getElementById('outboundSessionScannedCount');
        if (countText) {
            countText.textContent = `${totalPcs} Scans across ${uniqueBoxes} boxes`;
        }
        
        const weightText = document.getElementById('activeOutboundWeight');
        if (weightText) {
            weightText.textContent = `${totalWeight.toFixed(3)} kg`;
        }

        // Giant Logistics badge: show if under 10 kg, hide at 10 kg+
        const giantBadge = document.getElementById('giantLogisticsBadge');
        if (giantBadge) {
            if (totalWeight < 10) {
                giantBadge.style.display = 'flex';
            } else {
                giantBadge.style.display = 'none';
            }
        }

        const boxesText = document.getElementById('activeOutboundBoxesCount');
        if (boxesText) {
            boxesText.textContent = `${uniqueBoxes} ${uniqueBoxes === 1 ? 'Box' : 'Boxes'}`;
        }

    }

    function renderOutboundBoxCards() {
        const container = document.getElementById('outboundSessionBoxesContainer');
        if (!container) return;
        container.innerHTML = '';

        if (!activeOutboundSession || activeOutboundSession.serials.length === 0) {
            container.innerHTML = `
                <div id="outboundEmptyScannedState" style="text-align: center; color: var(--text-muted); padding: 48px 24px; width: 100%;">
                    No serials scanned yet. Start scanning or generating above.
                </div>
            `;
            return;
        }

        const serialsByItemMap = new Map();
        (activeOutboundSession.serials || []).forEach(s => {
            if (s && s.itemName) {
                let list = serialsByItemMap.get(s.itemName);
                if (!list) {
                    list = [];
                    serialsByItemMap.set(s.itemName, list);
                }
                list.push(s);
            }
        });

        const colFrag = document.createDocumentFragment();

        activeOutboundSession.items.forEach(item => {
            const itemSerials = serialsByItemMap.get(item.name) || [];
            const itemPieces = itemSerials.length;
            const itemBoxes = new Set(itemSerials.map(s => s.boxNo)).size;

            const col = document.createElement('div');
            col.className = 'product-scan-column';
            col.style.cssText = 'display: flex; flex-direction: column; gap: 16px; border: 1px solid var(--border-color); padding: 16px; border-radius: var(--radius-md); background: rgba(255,255,255,0.01); min-width: 300px; flex: 1 1 0px; height: 100%; overflow: hidden;';

            col.innerHTML = `
                <div style="display: flex; flex-direction: column; gap: 6px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; width: 100%;">
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; width: 100%;">
                        <div style="font-weight: 700; color: var(--text-primary); font-size: 0.9rem; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1;" title="${item.name}">
                            ${item.name}
                        </div>
                        <button type="button" class="btn-clear-product-serials" data-name="${item.name}" title="Clear all serials of this product" style="background: rgba(244, 63, 94, 0.08); border: 1px solid rgba(244, 63, 94, 0.2); color: var(--accent-rose); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: 700; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; gap: 3px; flex-shrink: 0;">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 10px; height: 10px; stroke-width: 2.5;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Clear</span>
                        </button>
                    </div>
                    <div style="display: flex; gap: 6px; flex-shrink: 0;">
                        <span class="count-badge-pcs" style="font-size: 0.7rem; font-weight: 700; background: rgba(59,130,246,0.1); color: var(--accent-blue); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(59,130,246,0.2);">
                            PCs: ${itemPieces}
                        </span>
                        <span class="count-badge-boxes" style="font-size: 0.7rem; font-weight: 700; background: rgba(16,185,129,0.1); color: var(--accent-emerald); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16,185,129,0.2);">
                            BOXes: ${itemBoxes}
                        </span>
                    </div>
                </div>
            `;

            const clearBtn = col.querySelector('.btn-clear-product-serials');
            if (clearBtn) {
                clearBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (confirm(`Are you sure you want to clear all scanned serials for product "${item.name}" from this session?`)) {
                        activeOutboundSession.serials = activeOutboundSession.serials.filter(s => s.itemName !== item.name);
                        activeOutboundSession.items = activeOutboundSession.items.filter(i => i.name !== item.name);
                        compactOutboundBoxNumbers();
                        saveActiveOutboundSession();
                        updateOutboundSessionProgress();
                        renderOutboundBoxCards();
                    }
                });
            }

            const boxListWrapper = document.createElement('div');
            boxListWrapper.className = 'product-boxes-list';
            boxListWrapper.style.cssText = 'flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; padding-right: 4px; margin-top: 10px;';

            if (itemSerials.length === 0) {
                boxListWrapper.innerHTML = `
                    <div style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 48px 12px;">
                        No serials scanned for this item yet.
                    </div>
                `;
            } else {
                const groups = {};
                itemSerials.forEach(s => {
                    if (!groups[s.boxNo]) groups[s.boxNo] = [];
                    groups[s.boxNo].push(s);
                });

                const boxNumbers = Object.keys(groups).map(Number).sort((a,b)=>b-a);
                const MAX_VISIBLE_BOXES = item.showAllBoxes ? boxNumbers.length : 40;
                const visibleBoxNumbers = boxNumbers.slice(0, MAX_VISIBLE_BOXES);
                const boxFrag = document.createDocumentFragment();

                visibleBoxNumbers.forEach(boxNo => {
                    const boxItems = groups[boxNo];
                    const boxCard = document.createElement('div');
                    boxCard.className = 'box-card';
                    boxCard.style.cssText = 'margin-bottom: 0;';

                    boxCard.innerHTML = `
                        <div class="box-card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 8px; margin-bottom: 8px;">
                            <span class="box-number-badge" style="font-size: 0.8rem; font-weight:700; color: var(--accent-blue);">Box #${boxNo}</span>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 0.75rem; color: var(--text-muted);" class="font-mono">${boxItems.length} Pcs</span>
                                <button type="button" class="btn-outbound-delete-box" data-box="${boxNo}" data-product="${item.name}" title="Delete entire Box #${boxNo}" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 2px; display: flex; align-items: center; justify-content: center; transition: var(--transition-smooth); border-radius: 4px;">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5; color: var(--accent-rose);">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    `;

                    const delBoxBtn = boxCard.querySelector('.btn-outbound-delete-box');
                    if (delBoxBtn) {
                        delBoxBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (confirm(`Are you sure you want to delete entire Box #${boxNo} of product "${item.name}"? This will delete all ${boxItems.length} scanned serials in this box.`)) {
                                activeOutboundSession.serials = activeOutboundSession.serials.filter(x => !(x.boxNo === boxNo && x.itemName === item.name));
                                
                                const remainingForProduct = activeOutboundSession.serials.some(x => x.itemName === item.name);
                                if (!remainingForProduct) {
                                    activeOutboundSession.items = activeOutboundSession.items.filter(x => x.name !== item.name);
                                }
                                
                                compactOutboundBoxNumbers();
                                saveActiveOutboundSession();
                                updateOutboundSessionProgress();
                                renderOutboundBoxCards();
                            }
                        });
                    }

                    const serialsUl = document.createElement('ul');
                    serialsUl.style.cssText = 'list-style: none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px;';
                    const serialsFrag = document.createDocumentFragment();
                    
                    boxItems.forEach(s => {
                        const li = document.createElement('li');
                        li.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 4px; font-size:0.85rem; font-family:var(--font-mono); border: 1px solid rgba(255,255,255,0.04);';
                        
                        const displayVal = (s.serial.startsWith('WOS-OUT-') || s.serial.startsWith('Without Serial Number') || s.serial.includes('WOS-')) 
                            ? `<span style="color: var(--accent-amber); font-weight: 700; font-style: italic; font-family: var(--font-sans);">[Non-Serial Item]</span>` 
                            : s.serial;

                        li.innerHTML = `
                            <span style="color:var(--text-secondary); word-break:break-all;">${displayVal}</span>
                            <button type="button" class="btn-outbound-delete-serial" data-serial="${s.serial}" title="Remove serial" style="background: none; border: none; color: var(--text-muted); font-size: 1rem; cursor: pointer; padding: 0 4px; line-height: 1;">
                                &times;
                            </button>
                        `;

                        const delBtn = li.querySelector('.btn-outbound-delete-serial');
                        if (delBtn) {
                            delBtn.addEventListener('click', (e) => {
                                e.stopPropagation();
                                activeOutboundSession.serials = activeOutboundSession.serials.filter(x => x.serial !== s.serial);
                                const remainingForProduct = activeOutboundSession.serials.some(x => x.itemName === item.name);
                                if (!remainingForProduct) {
                                    activeOutboundSession.items = activeOutboundSession.items.filter(x => x.name !== item.name);
                                }
                                compactOutboundBoxNumbers();
                                saveActiveOutboundSession();
                                updateOutboundSessionProgress();
                                renderOutboundBoxCards();
                            });
                        }

                        serialsFrag.appendChild(li);
                    });
                    serialsUl.appendChild(serialsFrag);
                    boxCard.appendChild(serialsUl);
                    boxFrag.appendChild(boxCard);
                });

                boxListWrapper.appendChild(boxFrag);

                if (boxNumbers.length > MAX_VISIBLE_BOXES) {
                    const loadMoreBtn = document.createElement('button');
                    loadMoreBtn.type = 'button';
                    loadMoreBtn.className = 'btn-load-more-boxes';
                    loadMoreBtn.style.cssText = 'background: rgba(59, 130, 246, 0.1); border: 1px solid var(--accent-blue); color: var(--accent-blue); padding: 8px 12px; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; margin-top: 8px; width: 100%; text-align: center; font-family: var(--font-mono);';
                    loadMoreBtn.textContent = `📦 Showing top 40 of ${boxNumbers.length} boxes (Click to show all ${boxNumbers.length} boxes)`;
                    loadMoreBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        item.showAllBoxes = true;
                        renderOutboundBoxCards();
                    });
                    boxListWrapper.appendChild(loadMoreBtn);
                }
            }
            col.appendChild(boxListWrapper);
            colFrag.appendChild(col);
        });
        container.appendChild(colFrag);
    }



    // ── Helper: actually commit & close the outbound session ──────────────────
    function commitAndCloseOutboundSession(courierRecommendation) {
        const now = new Date();
        const timeStr = now.toLocaleTimeString('en-US', {
            hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const frozenSerials = (activeOutboundSession.serials || []).map(s => {
            return {
                ...s,
                resolvedWeight: resolveItemWeight(s.serial, s.itemName)
            };
        });

        const logObj = {
            id: Date.now().toString(),
            timestamp: timeStr,
            shopName: activeOutboundSession.shopName,
            invoiceNo: activeOutboundSession.invoiceNo,
            pincode: activeOutboundSession.pincode || '',
            address: activeOutboundSession.address || '',
            odaStatus: activeOutboundSession.odaStatus || 'Normal',
            distanceKm: activeOutboundSession.distanceKm || calculateDistanceKm(activeOutboundSession.pincode),
            courierRecommendation: courierRecommendation || '',
            items: activeOutboundSession.items,
            serials: frozenSerials
        };

        const historyData = getOutboundHistory();
        historyData.unshift(logObj);
        saveOutboundHistory(historyData);

        // Auto download Excel immediately
        downloadOutboundLogExcel(logObj);

        activeOutboundSession = null;
        saveActiveOutboundSession();
        restoreOutboundSessionState();
    }

    // End & Save Session
    if (endOutboundSessionBtn) {
        endOutboundSessionBtn.addEventListener('click', () => {
            if (!activeOutboundSession || activeOutboundSession.serials.length === 0) {
                alert('No serials scanned to dispatch.');
                return;
            }

            // Calculate current total weight
            let totalWeight = 0;
            (activeOutboundSession.serials || []).forEach(s => {
                totalWeight += resolveItemWeight(s.serial, s.itemName);
            });

            if (totalWeight < 10) {
                // Show Giant Logistics popup
                const popup = document.getElementById('giantLogisticsPopup');
                const weightDisplay = document.getElementById('glWeightDisplay');
                if (weightDisplay) weightDisplay.textContent = `${totalWeight.toFixed(3)} kg`;
                if (popup) popup.classList.add('visible');
            } else {
                // Normal confirm for 10 kg+
                const confirmMsg = `Are you sure you want to end and save this Outbound dispatch?\n\nShop: ${activeOutboundSession.shopName}\nInvoice: ${activeOutboundSession.invoiceNo}\nTotal Items: ${activeOutboundSession.serials.length}`;
                if (confirm(confirmMsg)) {
                    commitAndCloseOutboundSession('');
                }
            }
        });
    }

    // Giant Logistics popup button handlers
    const btnGiantYes = document.getElementById('btnGiantLogisticsYes');
    const btnGiantCancel = document.getElementById('btnGiantLogisticsCancel');
    const glPopup = document.getElementById('giantLogisticsPopup');

    if (btnGiantYes) {
        btnGiantYes.addEventListener('click', () => {
            if (glPopup) glPopup.classList.remove('visible');
            commitAndCloseOutboundSession('Giant Logistics');
        });
    }
    if (btnGiantCancel) {
        btnGiantCancel.addEventListener('click', () => {
            if (glPopup) glPopup.classList.remove('visible');
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Giant Logistics Mail & Image Upload Handlers for Outbound History
    // ─────────────────────────────────────────────────────────────────────────
    let currentGlRowId = null;
    if (cancelActiveOutboundSessionBtn) {
        cancelActiveOutboundSessionBtn.addEventListener('click', () => {
            if (confirm('Cancel outbound session? All scanned serials will be lost.')) {
                if (activeOutboundSession && activeOutboundSession.originalQueuedOrder) {
                    const queue = getOrderQueue();
                    if (!queue.some(q => q.id === activeOutboundSession.originalQueuedOrder.id)) {
                        queue.push(activeOutboundSession.originalQueuedOrder);
                        saveOrderQueue(queue);
                        renderOrderQueueUI();
                    }
                }
                activeOutboundSession = null;
                saveActiveOutboundSession();
                restoreOutboundSessionState();
            }
        });
    }

    // Bind Excel triggers in Outbound History body (Both Desktop table and Mobile cards)
    const outboundTargets = ['outboundHistoryBody', 'outboundHistoryMobileCards'];
    outboundTargets.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('click', (e) => {
            const toggleMarkBtn = e.target.closest('.btn-toggle-outbound-mark');
            if (toggleMarkBtn) {
                e.stopPropagation();
                const logId = toggleMarkBtn.getAttribute('data-id');
                const historyData = getOutboundHistory();
                const logIndex = historyData.findIndex(item => item.id === logId);
                if (logIndex !== -1) {
                    historyData[logIndex].isChecked = !historyData[logIndex].isChecked;
                    saveOutboundHistory(historyData);
                    renderOutboundHistoryTable();
                }
                return;
            }

            const boxDetailsBtn = e.target.closest('.btn-show-outbound-box-details');
            if (boxDetailsBtn) {
                e.stopPropagation();
                const logId = boxDetailsBtn.getAttribute('data-id');
                const historyData = getOutboundHistory();
                const logItem = historyData.find(item => item.id === logId);
                if (logItem) {
                    showOutboundFirstSerialsModal(logItem);
                } else {
                    alert('Log record not found.');
                }
            }

            const btn = e.target.closest('.btn-download-outbound-excel');
            if (btn) {
                e.stopPropagation();
                const logId = btn.getAttribute('data-id');
                const historyData = getOutboundHistory();
                const logItem = historyData.find(item => item.id === logId);
                if (logItem) {
                    downloadOutboundLogExcel(logItem);
                } else {
                    alert('Log record not found.');
                }
            }

            const restoreBtn = e.target.closest('.btn-restore-outbound-log');
            if (restoreBtn) {
                e.stopPropagation();
                const logId = restoreBtn.getAttribute('data-id');
                
                const pass = prompt("Enter Admin Password to restore this Outbound Session:");
                if (pass === null) return;
                if (pass !== '1998') {
                    alert("Incorrect password!");
                    return;
                }
                
                if (activeOutboundSession) {
                    alert("Cannot restore! An active Outbound session is already running. Please cancel or save the current session first.");
                    return;
                }
                
                const historyData = getOutboundHistory();
                const logIndex = historyData.findIndex(item => item.id === logId);
                if (logIndex !== -1) {
                    const restoredLog = historyData[logIndex];
                    
                    // Populate activeOutboundSession
                    activeOutboundSession = {
                        id: restoredLog.id,
                        shopName: restoredLog.shopName,
                        invoiceNo: restoredLog.invoiceNo,
                        items: restoredLog.items || [],
                        serials: restoredLog.serials || []
                    };
                    
                    // Remove from history
                    historyData.splice(logIndex, 1);
                    
                    // Save & reload
                    saveActiveOutboundSession();
                    saveOutboundHistory(historyData);
                    restoreOutboundSessionState();
                    renderInventoryPanel();
                    
                    alert("Outbound session successfully restored to workstation!");
                } else {
                    alert('Log record not found.');
                }
            }
        });
        }
    });

    // Close modals on outer click extensions
    window.addEventListener('click', (e) => {
        if (e.target === outboundConfigModal) closeOutboundConfigModal();
        if (e.target === unrecognizedBarcodeModal) {
            unrecognizedBarcodeModal.classList.remove('active');
            refocusOutboundInput();
        }
        if (e.target === outboundAddProductConfirmModal) {
            outboundAddProductConfirmModal.classList.remove('active');
            if (outboundAddProductConfirmInput) outboundAddProductConfirmInput.onkeydown = null;
            refocusOutboundInput();
        }
    });

    // --- Inventory Section Log Rendering & Search ---
    let productColorsMap = {};
    const colorThemes = [
        { bg: 'rgba(239, 68, 68, 0.08)', text: '#f87171', border: 'rgba(239, 68, 68, 0.25)' }, // Dim Red
        { bg: 'rgba(59, 130, 246, 0.08)', text: '#60a5fa', border: 'rgba(59, 130, 246, 0.25)' }, // Dim Blue
        { bg: 'rgba(16, 185, 129, 0.08)', text: '#34d399', border: 'rgba(16, 185, 129, 0.25)' }, // Dim Emerald
        { bg: 'rgba(245, 158, 11, 0.08)', text: '#fbbf24', border: 'rgba(245, 158, 11, 0.25)' }, // Dim Amber
        { bg: 'rgba(139, 92, 246, 0.08)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.25)' }, // Dim Purple
        { bg: 'rgba(244, 63, 94, 0.08)', text: '#fb7185', border: 'rgba(244, 63, 94, 0.25)' }  // Dim Rose
    ];

    function renderInventoryPanel() {
        const totalItemsEl = document.getElementById('inventoryTotalItems');
        const uniqueProductsEl = document.getElementById('inventoryUniqueProducts');
        const listContainer = document.getElementById('inventorySerialsListContainer');
        const searchInput = document.getElementById('inventorySearchInput');
        const registerBody = document.getElementById('inventoryStockRegisterBody');

        if (!listContainer) return;

        // Gather all completed outbound scans and sum them by product to subtract from stock
        const outboundHistory = getOutboundHistory();
        const outboundSerialsSet = new Set(getOutboundSerialLogMap().keys());
        const outboundDetailsMap = {};
        const unmatchedOutboundCounts = {};
        const outboundCountsByProduct = {};

        // Track all serials that exist in the inbound database so we can identify if an outbound serial is unmatched
        const inboundSerialsSet = new Set(getInboundSerialLogMap().keys());
        const inboundHistory = getHistory();

        outboundHistory.forEach(log => {
            if (log.serials) {
                log.serials.forEach(s => {
                    if (!s || !s.serial) return;
                    const cleanSerial = s.serial.trim().toUpperCase();
                    outboundDetailsMap[cleanSerial] = {
                        shopName: log.shopName,
                        invoiceNo: log.invoiceNo,
                        timestamp: log.timestamp
                    };

                    const itemName = s.itemName;
                    if (!outboundCountsByProduct[itemName]) {
                        outboundCountsByProduct[itemName] = 0;
                    }
                    outboundCountsByProduct[itemName]++;

                    // If this serial was not in bounded, it is unmatched
                    if (!inboundSerialsSet.has(cleanSerial) && !cleanSerial.includes('WOS-OUT-')) {
                        if (!unmatchedOutboundCounts[itemName]) {
                            unmatchedOutboundCounts[itemName] = 0;
                        }
                        unmatchedOutboundCounts[itemName]++;
                    }
                });
            }
        });

        const availableSerials = [];
        const productStock = {};
        const weights = getProductWeights();
        const damageRecords = getDamageRecords();
        const damageSerials = new Set(damageRecords.map(r => r.serial.trim().toUpperCase()));
 
        // Copy outbound counts to keep track of remaining to deduct for WOS (FIFO)
        const remainingWosOutbound = {};
        Object.keys(outboundCountsByProduct).forEach(key => {
            remainingWosOutbound[key] = outboundCountsByProduct[key];
        });
 
        // Copy unmatched outbound counts to decrement them as we deduct from inbound logs in FIFO order
        const remainingUnmatchedOutbound = {};
        Object.keys(unmatchedOutboundCounts).forEach(key => {
            remainingUnmatchedOutbound[key] = unmatchedOutboundCounts[key];
        });
 
        // Process inbound history from oldest to newest (FIFO)
        const inboundHistoryReversed = [...inboundHistory].reverse();
        
        inboundHistoryReversed.forEach(log => {
            const name = log.item;
            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    const itemName = s.itemName || name; // Fallback if name is missing
                    const cleanInboundSerial = s.serial.trim().toUpperCase();

                    const logW = resolveLogWeight(log, itemName);
                    const unitWeight = (logW !== undefined) ? logW : (parseFloat(weights[itemName]) || 0);

                    if (!productStock[itemName]) {
                        productStock[itemName] = {
                            name: itemName,
                            inboundCount: 0,
                            serialsCount: 0,
                            availableWeight: 0,
                            boxNumbers: new Set()
                        };
                    }
                    
                    productStock[itemName].inboundCount++;
                    
                    // Deduction logic: dispatch if matched exactly, or if matched to an unmatched count for this product in FIFO order
                    let isDispatched = false;
                    if (outboundSerialsSet.has(cleanInboundSerial)) {
                        isDispatched = true;
                    } else if (remainingUnmatchedOutbound[itemName] && remainingUnmatchedOutbound[itemName] > 0) {
                        isDispatched = true;
                        remainingUnmatchedOutbound[itemName]--; // Consume one unmatched outbound scan
                    }

                    if (!isDispatched) {
                        productStock[itemName].serialsCount++;
                        productStock[itemName].availableWeight += unitWeight;
                        productStock[itemName].boxNumbers.add(s.boxNo);
                        
                        availableSerials.push({
                            serial: s.serial,
                            itemName: itemName,
                            inboundTime: log.timestamp,
                            vehicle: log.vehicle || 'N/A',
                            isDamaged: damageSerials.has(cleanInboundSerial)
                        });
                    }
                });
            } else {
                // Support "Without Serial Number Inward" math fallback (WOS)
                if (name && log.count > 0) {
                    const logW = resolveLogWeight(log, name);
                    const unitWeight = (logW !== undefined) ? logW : (parseFloat(weights[name]) || 0);
                    
                    if (!productStock[name]) {
                        productStock[name] = {
                            name: name,
                            inboundCount: 0,
                            serialsCount: 0,
                            availableWeight: 0,
                            boxNumbers: new Set()
                        };
                    }
                    
                    productStock[name].inboundCount += log.count;

                    // FIFO subtraction logic for WOS
                    const inboundQty = log.count;
                    const remOut = remainingWosOutbound[name] || 0;
                    if (remOut >= inboundQty) {
                        remainingWosOutbound[name] -= inboundQty;
                        // 0 available from this log
                    } else {
                        const availableQty = inboundQty - remOut;
                        remainingWosOutbound[name] = 0;
                        
                        productStock[name].serialsCount += availableQty;
                        productStock[name].availableWeight += (availableQty * unitWeight);
                        if (log.wosBoxNo || log.boxNo) {
                            productStock[name].boxNumbers.add(log.wosBoxNo || log.boxNo);
                        }
                    }
                }
            }
        });

        // Set Overview Available Stock Counters
        const uniqueProductNames = Object.keys(productStock).filter(name => productStock[name].serialsCount > 0);
        const totalAvailableCount = Object.values(productStock).reduce((sum, item) => sum + item.serialsCount, 0);
        const outOfStockProducts = Object.values(productStock).filter(item => item.serialsCount === 0);
        const outOfStockCount = outOfStockProducts.length;
        
        const totalBoxesEl = document.getElementById('inventoryTotalBoxes');
        const totalWeightEl = document.getElementById('inventoryTotalWeight');
        const outOfStockCountEl = document.getElementById('inventoryOutOfStockCount');

        const totalAvailableBoxes = Object.values(productStock).reduce((sum, item) => sum + (item.serialsCount > 0 ? item.boxNumbers.size : 0), 0);
        const totalAvailableWeight = Object.values(productStock).reduce((sum, item) => {
            return sum + item.availableWeight;
        }, 0);

        if (totalItemsEl) totalItemsEl.textContent = totalAvailableCount;
        if (uniqueProductsEl) uniqueProductsEl.textContent = uniqueProductNames.length;
        if (totalBoxesEl) totalBoxesEl.textContent = totalAvailableBoxes;
        if (totalWeightEl) totalWeightEl.textContent = `${totalAvailableWeight.toFixed(3)} kg`;
        if (outOfStockCountEl) outOfStockCountEl.textContent = outOfStockCount;

        const totalDamagedEl = document.getElementById('inventoryTotalDamaged');
        if (totalDamagedEl) {
            totalDamagedEl.textContent = damageRecords.length;
        }

        // Map Colors dynamically to products
        let colorIdx = 0;
        const allUniqueInHistory = Object.keys(productStock);
        allUniqueInHistory.forEach(name => {
            if (!productColorsMap[name]) {
                productColorsMap[name] = colorThemes[colorIdx % colorThemes.length];
                colorIdx++;
            }
        });

        // Render Detailed Stock Register Table Body based on available stock
        if (registerBody) {
            // Sort to place Out of Stock items at the top
            const sortedRegisterStock = Object.values(productStock).sort((a, b) => {
                const aIsOut = a.serialsCount === 0 ? 1 : 0;
                const bIsOut = b.serialsCount === 0 ? 1 : 0;
                if (aIsOut !== bIsOut) {
                    return bIsOut - aIsOut;
                }
                return a.name.localeCompare(b.name);
            });

            const registerRowsHtml = sortedRegisterStock.map(item => {
                const totalWeight = item.availableWeight;
                const theme = productColorsMap[item.name] || colorThemes[0];
                const isOut = item.serialsCount === 0;
                
                const qtyHtml = isOut 
                    ? `<span style="color: var(--accent-rose); font-weight: 800; background: rgba(244, 63, 94, 0.08); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(244, 63, 94, 0.15); font-size: 0.72rem; text-transform: uppercase;">Out of Stock</span>` 
                    : item.serialsCount;
                
                return `
                    <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); ${isOut ? 'opacity: 0.75;' : ''}">
                        <td style="padding: 10px 8px; font-weight: 700; color: var(--text-primary);" title="${item.name}">
                            <span style="border-left: 3px solid ${isOut ? 'var(--accent-rose)' : theme.text}; padding-left: 6px;">${item.name}</span>
                        </td>
                        <td class="font-mono" style="padding: 10px 8px; text-align: right; font-weight: 700; color: var(--text-secondary);">${qtyHtml}</td>
                        <td class="font-mono" style="padding: 10px 8px; text-align: right; font-weight: 700; color: ${isOut ? 'var(--text-muted)' : 'var(--accent-emerald)'};">${totalWeight.toFixed(3)} kg</td>
                    </tr>
                `;
            }).join('');

            if (registerRowsHtml) {
                registerBody.innerHTML = registerRowsHtml;
            } else {
                registerBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">No active stock registered.</td></tr>`;
            }
        }

        // Get filter query
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        let filteredList = [];

        if (query === '') {
            // Default: Show only available in-stock items
            filteredList = availableSerials.map(s => ({
                serial: s.serial,
                itemName: s.itemName,
                status: s.isDamaged ? 'Damaged' : 'In Stock',
                details: `Inwarded: ${s.inboundTime} | Vehicle: ${s.vehicle}`
            }));
        } else {
            // Search: Match across all historical inbound barcodes to show live trace status
            inboundHistory.forEach(log => {
                if (log.serials) {
                    log.serials.forEach(s => {
                        const name = s.itemName || log.item;
                        if (s.serial.toLowerCase().includes(query) || name.toLowerCase().includes(query)) {
                            const isDispatched = outboundSerialsSet.has(s.serial);
                            const isDamaged = damageSerials.has(s.serial.trim().toUpperCase());
                            const outDetails = outboundDetailsMap[s.serial];
                            
                            let status = 'In Stock';
                            if (isDispatched) status = 'Dispatched';
                            else if (isDamaged) status = 'Damaged';

                            filteredList.push({
                                serial: s.serial,
                                itemName: name,
                                status: status,
                                details: isDispatched 
                                    ? `Out to: ${outDetails.shopName} | Invoice: ${outDetails.invoiceNo} (${outDetails.timestamp})`
                                    : `Inwarded: ${log.timestamp} | Vehicle: ${log.vehicle || 'N/A'}`
                            });
                        }
                    });
                }
            });
        }

        listContainer.innerHTML = '';
        if (filteredList.length === 0) {
            listContainer.innerHTML = `
                <div style="color: var(--text-muted); font-style: italic; text-align: center; padding: 32px 16px;">
                    ${query ? 'No matching serial numbers found.' : 'No serial numbers scanned yet.'}
                </div>
            `;
            return;
        }

        if (filteredList.length > 100) {
            const warningBanner = document.createElement('div');
            warningBanner.style.cssText = 'grid-column: 1 / -1; padding: 12px 16px; background: rgba(59, 130, 246, 0.06); border: 1px solid rgba(59, 130, 246, 0.2); border-radius: var(--radius-md); color: var(--accent-blue); font-size: 0.85rem; font-weight: 600; text-align: center; margin-bottom: 8px;';
            warningBanner.textContent = `Showing top 100 of ${filteredList.length} items. Please use the search bar above to narrow down results.`;
            listContainer.appendChild(warningBanner);
        }

        const displayList = filteredList.slice(0, 100);
        displayList.forEach(s => {
            const card = document.createElement('div');
            card.className = 'inventory-serial-card';
            const theme = productColorsMap[s.itemName] || colorThemes[0];
            
            let borderStyle = `border: 1px solid ${theme.border};`;
            let badgeBg = 'rgba(16, 185, 129, 0.15)';
            let badgeColor = 'var(--accent-emerald)';
            let isBlinkingClass = 'class="blink-text"';

            if (s.status === 'Dispatched') {
                borderStyle = 'border: 1px solid rgba(244, 63, 94, 0.25); background: rgba(244, 63, 94, 0.04);';
                badgeBg = 'rgba(244, 63, 94, 0.15)';
                badgeColor = 'var(--accent-rose)';
                isBlinkingClass = '';
            } else if (s.status === 'Damaged') {
                borderStyle = 'border: 1px solid var(--accent-rose); background: rgba(244, 63, 94, 0.08);';
                badgeBg = 'var(--accent-rose)';
                badgeColor = '#ffffff';
                isBlinkingClass = '';
            } else {
                card.style.background = theme.bg;
            }

            card.style.cssText = borderStyle + ' padding: 12px 16px; border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 4px; transition: var(--transition-smooth);';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 10px;">
                    <span style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: ${theme.text}; opacity: 0.85; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${s.itemName}">${s.itemName}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 0.65rem; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${badgeColor}33; text-transform: uppercase; flex-shrink: 0;">${s.status}</span>
                        <button type="button" class="btn-delete-inventory-serial" data-serial="${s.serial}" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); color: var(--accent-rose); width: 22px; height: 22px; border-radius: var(--radius-sm); display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: var(--transition-smooth);" title="Delete Serial">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 12px; height: 12px; stroke-width: 2.5;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div ${isBlinkingClass} style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; word-break: break-all; margin-top: 2px; color: ${s.status === 'Dispatched' ? 'var(--text-muted)' : theme.text};">${s.serial}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${s.details}">${s.details}</div>
            `;
            listContainer.appendChild(card);
        });
    }

    function getDeletedSerials() {
        const saved = localStorage.getItem('wms_deleted_serials');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return parsed;
            } catch (e) {
                console.error("Error parsing wms_deleted_serials:", e);
            }
        }
        return [];
    }

    function saveDeletedSerials(data) {
        deletedSerialsFastMap = null;
        localStorage.setItem('wms_deleted_serials', JSON.stringify(data));
        firebaseSet('deleted_serials', data);
    }

    function renderDeletedSerialsPanel() {
        const container = document.getElementById('deletedSerialsListContainer');
        if (!container) return;
        
        container.innerHTML = '';
        const deletedList = getDeletedSerials();
        
        if (deletedList.length === 0) {
            container.innerHTML = `
                <div style="color: var(--text-muted); font-style: italic; text-align: center; padding: 32px 16px;">
                    Trash is empty.
                </div>
            `;
            return;
        }

        deletedList.forEach(s => {
            const card = document.createElement('div');
            card.className = 'inventory-serial-card';
            card.style.cssText = 'border: 1px dashed rgba(244, 63, 94, 0.4); background: rgba(244, 63, 94, 0.02); padding: 12px 16px; border-radius: var(--radius-md); display: flex; flex-direction: column; gap: 4px; transition: var(--transition-smooth);';

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; gap: 10px;">
                    <span style="font-size: 0.72rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: var(--accent-rose); opacity: 0.85; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${s.itemName}">${s.itemName}</span>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" class="btn-restore-serial" data-serial="${s.serial}" style="background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: var(--accent-emerald); padding: 2px 8px; border-radius: var(--radius-sm); font-size: 0.65rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: var(--transition-smooth);" title="Restore Serial">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 10px; height: 10px; stroke-width: 3;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                            </svg>
                            <span>Restore</span>
                        </button>
                        <button type="button" class="btn-permanent-delete-serial" data-serial="${s.serial}" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); color: var(--accent-rose); padding: 2px 8px; border-radius: var(--radius-sm); font-size: 0.65rem; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; transition: var(--transition-smooth);" title="Delete Permanently">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 10px; height: 10px; stroke-width: 3;">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            <span>Delete</span>
                        </button>
                    </div>
                </div>
                <div style="font-family: var(--font-mono); font-size: 0.95rem; font-weight: 700; word-break: break-all; margin-top: 2px; color: var(--text-muted); text-decoration: line-through;">${s.serial}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px; font-family: var(--font-mono); text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">Deleted: ${s.deletedAt}</div>
            `;
            container.appendChild(card);
        });
    }

    function deleteSerialFromInventory(serial) {
        if (!confirm(`Are you sure you want to delete serial "${serial}"? It will be subtracted from all records and moved to the Trash Bin.`)) {
            return;
        }

        // 1. Update Inbound History and find details
        const inboundHistory = getHistory();
        let inboundUpdated = false;
        let sourceInboundLogId = null;
        let sourceBoxNo = 1;
        let itemName = '';

        inboundHistory.forEach(log => {
            if (log.serials) {
                const found = log.serials.find(s => s.serial === serial);
                if (found) {
                    sourceInboundLogId = log.id;
                    sourceBoxNo = found.boxNo || 1;
                    itemName = found.itemName || log.item;
                    
                    // Filter out the serial
                    log.serials = log.serials.filter(s => s.serial !== serial);
                    inboundUpdated = true;
                    // Recalculate count
                    log.count = log.serials.length;
                    
                    // If multi-item format exists, update matching item's scannedCount
                    if (log.items) {
                        log.items.forEach(item => {
                            item.scannedCount = log.serials.filter(s => s.itemName === item.name).length;
                        });
                    }
                }
            }
        });

        if (inboundUpdated) {
            saveHistory(inboundHistory);
        }

        // 2. Update Outbound History
        const outboundHistory = getOutboundHistory();
        let outboundUpdated = false;
        let sourceOutboundLogId = null;

        outboundHistory.forEach(log => {
            if (log.serials) {
                const found = log.serials.find(s => s.serial === serial);
                if (found) {
                    sourceOutboundLogId = log.id;
                    
                    // Filter out
                    log.serials = log.serials.filter(s => s.serial !== serial);
                    outboundUpdated = true;
                    
                    // Update items scannedCount
                    if (log.items) {
                        log.items.forEach(item => {
                            item.scannedCount = log.serials.filter(s => s.itemName === item.name).length;
                        });
                    }
                }
            }
        });

        if (outboundUpdated) {
            saveOutboundHistory(outboundHistory);
        }

        // 3. Add to Deleted Serials state
        if (itemName) {
            const deletedList = getDeletedSerials();
            // Avoid duplicates
            if (!deletedList.some(s => s.serial === serial)) {
                deletedList.push({
                    serial: serial,
                    itemName: itemName,
                    boxNo: sourceBoxNo,
                    inboundLogId: sourceInboundLogId,
                    outboundLogId: sourceOutboundLogId,
                    deletedAt: new Date().toLocaleString()
                });
                saveDeletedSerials(deletedList);
            }
        }

        // 4. Refresh all related views
        renderInventoryPanel();
        renderHistoryTable();
        renderOutboundHistoryTable();
        renderDeletedSerialsPanel();
    }

    function restoreDeletedSerial(serial) {
        if (!confirm(`Are you sure you want to restore serial "${serial}" back to active stock records?`)) {
            return;
        }

        const deletedList = getDeletedSerials();
        const record = deletedList.find(s => s.serial === serial);
        if (!record) return;

        // 1. Restore to original Inbound Log row
        const inboundHistory = getHistory();
        let inboundRestored = false;

        inboundHistory.forEach(log => {
            if (log.id === record.inboundLogId) {
                if (!log.serials) log.serials = [];
                // Avoid duplicates
                if (!log.serials.some(s => s.serial === serial)) {
                    log.serials.push({
                        serial: record.serial,
                        boxNo: record.boxNo || 1,
                        itemName: record.itemName
                    });
                    log.count = log.serials.length;
                    if (log.items) {
                        log.items.forEach(item => {
                            item.scannedCount = log.serials.filter(s => s.itemName === item.name).length;
                        });
                    }
                    inboundRestored = true;
                }
            }
        });

        if (inboundRestored) {
            saveHistory(inboundHistory);
        }

        // 2. Restore to original Outbound Log row if applicable
        if (record.outboundLogId) {
            const outboundHistory = getOutboundHistory();
            let outboundRestored = false;

            outboundHistory.forEach(log => {
                if (log.id === record.outboundLogId) {
                    if (!log.serials) log.serials = [];
                    if (!log.serials.some(s => s.serial === serial)) {
                        log.serials.push({
                            serial: record.serial,
                            itemName: record.itemName
                        });
                        if (log.items) {
                            log.items.forEach(item => {
                                item.scannedCount = log.serials.filter(s => s.itemName === item.name).length;
                            });
                        }
                        outboundRestored = true;
                    }
                }
            });

            if (outboundRestored) {
                saveOutboundHistory(outboundHistory);
            }
        }

        // 3. Remove from Deleted Serials
        const updatedDeletedList = deletedList.filter(s => s.serial !== serial);
        saveDeletedSerials(updatedDeletedList);

        // 4. Refresh all related views
        renderInventoryPanel();
        renderHistoryTable();
        renderOutboundHistoryTable();
        renderDeletedSerialsPanel();
    }

    function permanentlyDeleteSerial(serial) {
        if (!confirm(`Are you sure you want to permanently delete serial "${serial}"? This action cannot be undone.`)) {
            return;
        }

        const deletedList = getDeletedSerials();
        const updatedDeletedList = deletedList.filter(s => s.serial !== serial);
        saveDeletedSerials(updatedDeletedList);
        renderDeletedSerialsPanel();
    }

    const inventorySerialsListContainer = document.getElementById('inventorySerialsListContainer');
    if (inventorySerialsListContainer) {
        inventorySerialsListContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-delete-inventory-serial');
            if (btn) {
                const serial = btn.getAttribute('data-serial');
                deleteSerialFromInventory(serial);
            }
        });
    }

    const deletedSerialsListContainer = document.getElementById('deletedSerialsListContainer');
    if (deletedSerialsListContainer) {
        deletedSerialsListContainer.addEventListener('click', (e) => {
            // Restore btn
            const restoreBtn = e.target.closest('.btn-restore-serial');
            if (restoreBtn) {
                const serial = restoreBtn.getAttribute('data-serial');
                restoreDeletedSerial(serial);
            }
            // Permanent delete btn
            const permanentDeleteBtn = e.target.closest('.btn-permanent-delete-serial');
            if (permanentDeleteBtn) {
                const serial = permanentDeleteBtn.getAttribute('data-serial');
                permanentlyDeleteSerial(serial);
            }
        });
    }

    // Bind Inventory search elements
    const inventorySearchBtn = document.getElementById('inventorySearchBtn');
    const inventorySearchInput = document.getElementById('inventorySearchInput');

    if (inventorySearchBtn) {
        inventorySearchBtn.addEventListener('click', renderInventoryPanel);
    }
    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    if (inventorySearchInput) {
        inventorySearchInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') {
                renderInventoryPanel();
            }
        });
        // Real-time filter as you type (debounced to prevent lag)
        const debouncedInventorySearch = debounce(renderInventoryPanel, 150);
        inventorySearchInput.addEventListener('input', debouncedInventorySearch);
    }

    // ==========================================================================
    // Order Assign Workspace Controller (Direct Queue & Accorion Cards)
    // ==========================================================================
    const orderAssignRawText = document.getElementById('orderAssignRawText');
    const btnOrderAssignPasteClip = document.getElementById('btnOrderAssignPasteClip');
    const btnOrderAssignProcess = document.getElementById('btnOrderAssignProcess');

    function getOrderQueue() {
        const saved = localStorage.getItem('wms_order_queue');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                return [];
            }
        }
        return [];
    }

    function saveOrderQueue(queue) {
        localStorage.setItem('wms_order_queue', JSON.stringify(queue));
        firebaseSet('order_queue', queue);
    }

    if (btnOrderAssignPasteClip) {
        btnOrderAssignPasteClip.addEventListener('click', () => {
            navigator.clipboard.readText().then(text => {
                if (text && orderAssignRawText) {
                    orderAssignRawText.value = text;
                    processOrderAssignText(text);
                }
            }).catch(err => {
                alert("Clipboard access denied or not supported by browser.");
            });
        });
    }

    if (btnOrderAssignProcess) {
        btnOrderAssignProcess.addEventListener('click', () => {
            if (orderAssignRawText) {
                processOrderAssignText(orderAssignRawText.value);
            }
        });
    }

    // Drag & Drop PDF Uploader integration
    async function extractTextFromPDF(file) {
        if (!window.pdfjsLib) {
            throw new Error("PDF.js library not loaded.");
        }
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';

        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let text = '';
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const items = textContent.items;

            // Sort items vertically (top-to-bottom) then horizontally (left-to-right)
            items.sort((a, b) => {
                if (Math.abs(a.transform[5] - b.transform[5]) < 5) {
                    return a.transform[4] - b.transform[4];
                }
                return b.transform[5] - a.transform[5];
            });

            let pageText = '';
            let lastY = null;
            for (const item of items) {
                if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
                    pageText += '\n';
                }
                pageText += item.str + ' ';
                lastY = item.transform[5];
            }
            text += pageText + '\n';
        }
        return text;
    }

    async function processPdfFile(file) {
        const pdfUploadStatus = document.getElementById('pdfUploadStatus');
        if (pdfUploadStatus) {
            pdfUploadStatus.style.display = 'block';
            pdfUploadStatus.style.color = 'var(--accent-blue)';
            pdfUploadStatus.textContent = 'Extracting Sales Order details from PDF...';
        }

        try {
            const text = await extractTextFromPDF(file);
            if (orderAssignRawText) {
                orderAssignRawText.value = text;
                orderAssignRawText.dispatchEvent(new Event('input'));
            }

            if (pdfUploadStatus) {
                pdfUploadStatus.style.color = 'var(--accent-emerald)';
                pdfUploadStatus.textContent = `Parsed: "${file.name}" (Processed locally. Removed from memory.)`;
                setTimeout(() => {
                    pdfUploadStatus.style.display = 'none';
                }, 5000);
            }

            triggerSpeak("P, D, F, details, extracted");
        } catch (err) {
            console.error(err);
            if (pdfUploadStatus) {
                pdfUploadStatus.style.color = 'var(--accent-rose)';
                pdfUploadStatus.textContent = 'Error: Failed to parse PDF file!';
            }
            alert("Error parsing PDF: " + err.message);
        }
    }

    const pdfDragDropArea = document.getElementById('pdfDragDropArea');
    const orderAssignPdfInput = document.getElementById('orderAssignPdfInput');

    if (pdfDragDropArea && orderAssignPdfInput) {
        pdfDragDropArea.addEventListener('click', () => {
            orderAssignPdfInput.click();
        });

        pdfDragDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            pdfDragDropArea.style.borderColor = 'var(--accent-blue)';
            pdfDragDropArea.style.background = 'rgba(59, 130, 246, 0.05)';
        });

        pdfDragDropArea.addEventListener('dragleave', () => {
            pdfDragDropArea.style.borderColor = 'var(--border-color)';
            pdfDragDropArea.style.background = 'rgba(59, 130, 246, 0.01)';
        });

        pdfDragDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            pdfDragDropArea.style.borderColor = 'var(--border-color)';
            pdfDragDropArea.style.background = 'rgba(59, 130, 246, 0.01)';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                if (files[0].type === 'application/pdf' || files[0].name.toLowerCase().endsWith('.pdf')) {
                    processPdfFile(files[0]);
                } else {
                    alert("Please upload a PDF file.");
                }
            }
        });

        orderAssignPdfInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                processPdfFile(files[0]);
            }
        });
    }

    function processOrderAssignText(text) {
        if (!text.trim()) {
            alert("Please paste Sales Order text first.");
            return;
        }

        // 1. Parse Sales Order No (Invoice No)
        const soMatch = text.match(/Sales\s+Order#\s*:\s*(.*?)(?=\s+Order\s+Date|Terms|Place\s+Of|\t|\n|$)/i);
        let soNum = soMatch ? soMatch[1].trim() : '';

        // 2. Parse Shop Name (following Ship To)
        const lines = text.split('\n').map(l => l.trim());
        let shipToIndex = lines.findIndex(l => l.toLowerCase() === 'ship to');
        let shopName = '';
        if (shipToIndex !== -1) {
            for (let i = shipToIndex + 1; i < lines.length; i++) {
                if (lines[i]) {
                    shopName = lines[i];
                    break;
                }
            }
        }

        // Fallback for SO number and Shop name
        if (!soNum) {
            const genericSoMatch = text.match(/(?:SO|Invoice|InvoiceNo|OrderNo)\s*[:#\-]?\s*([A-Za-z0-9\-\/]+)/i);
            soNum = genericSoMatch ? genericSoMatch[1].trim() : 'SO-TEMP';
        }
        if (!shopName) {
            shopName = 'Unknown Vendor';
        }

        // 3. Extract items section and parse
        let headerIndex = lines.findIndex(l => l.includes('Item & Description') || l.includes('Item and Description'));
        let footerIndex = lines.findIndex(l => l.includes('Items in Total') || l.includes('Sub Total') || l.includes('SubTotal'));

        if (headerIndex === -1) headerIndex = 0;
        if (footerIndex === -1) footerIndex = lines.length;

        const itemSectionLines = lines.slice(headerIndex + 1, footerIndex);
        const parsedItems = [];

        for (let i = 0; i < itemSectionLines.length; i++) {
            const line = itemSectionLines[i];
            if (/^\d+$/.test(line)) {
                const itemNameLine = itemSectionLines[i + 1];
                if (itemNameLine && !/^\d+$/.test(itemNameLine)) {
                    let qty = 0;
                    for (let k = i + 2; k < Math.min(i + 7, itemSectionLines.length); k++) {
                        const l = itemSectionLines[k];
                        const hsnMatch = l.match(/\b\d{6,10}\s+(\d+)\b/);
                        if (hsnMatch) {
                            qty = parseInt(hsnMatch[1]);
                            break;
                        }
                        const qtyPcs = l.match(/\b(\d+)\s*pcs\b/i);
                        if (qtyPcs) {
                            qty = parseInt(qtyPcs[1]);
                            break;
                        }
                        if (l.toLowerCase() === 'pcs' || l.toLowerCase() === 'pc') {
                            const prev = itemSectionLines[k - 1];
                            const prevMatch = prev.match(/\b(\d+)\b/);
                            if (prevMatch) {
                                qty = parseInt(prevMatch[1]);
                                break;
                            }
                        }
                    }
                    parsedItems.push({
                        rawName: itemNameLine,
                        qty: qty || 1
                    });
                }
            }
        }

        // Fallback item extraction
        if (parsedItems.length === 0) {
            lines.forEach((line, idx) => {
                if (line.toLowerCase().includes('monitor') || line.toLowerCase().includes('led') || line.toLowerCase().includes('warranty')) {
                    if (idx > 0 && (lines[idx-1].toLowerCase().includes('monitor') || lines[idx-1].toLowerCase().includes('led'))) {
                        return; 
                    }
                    let qty = 1;
                    const nextLine = lines[idx + 1] || '';
                    const qtyMatch = nextLine.match(/\b(\d+)\b/);
                    if (qtyMatch) qty = parseInt(qtyMatch[1]);
                    
                    parsedItems.push({
                        rawName: line,
                        qty: qty
                    });
                }
            });
        }

        if (parsedItems.length === 0) {
            alert("No items could be parsed from the pasted text. Please verify the format.");
            return;
        }

        // Get unique products database list
        const inboundHistory = getHistory();
        const allInboundProducts = Array.from(new Set(inboundHistory.flatMap(log => (log.serials || []).map(s => s.itemName || log.item))));
        const weightKeys = Object.keys(getProductWeights());
        const uniqueProducts = Array.from(new Set([...allInboundProducts, ...weightKeys])).filter(Boolean).sort();

        // Parse City, State, and Pincode from client details
        let customerText = text;
        const billToIdx = text.toLowerCase().indexOf('bill to');
        const shipToIdx = text.toLowerCase().indexOf('ship to');
        const searchStartIdx = Math.max(billToIdx, shipToIdx);
        if (searchStartIdx !== -1) {
            customerText = text.substring(searchStartIdx);
        }

        // Pincode (6-digit number)
        const pinMatch = customerText.match(/\b\d{6}\b/);
        const pincode = pinMatch ? pinMatch[0] : '';

        // State (matching list of Indian States)
        const statesList = [
            "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", 
            "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", 
            "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", 
            "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", 
            "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Puducherry"
        ];
        let foundState = '';
        for (const state of statesList) {
            const regex = new RegExp('\\b' + state + '\\b', 'i');
            if (regex.test(customerText)) {
                foundState = state;
                break;
            }
        }

        // City (split comma token right before state/pincode)
        let foundCity = '';
        if (foundState) {
            const escapedState = foundState.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const pattern1 = new RegExp(`(?:\\b)([A-Za-z\\s\\.\\-\\(\\)]+),\\s*${escapedState}\\s*,?\\s*\\b\\d{6}\\b`, 'i');
            const match1 = customerText.match(pattern1);
            if (match1) {
                foundCity = match1[1].trim();
            } else {
                const pattern2 = new RegExp(`(?:\\b)([A-Za-z\\s\\.\\-\\(\\)]+),\\s*${escapedState}\\b`, 'i');
                const match2 = customerText.match(pattern2);
                if (match2) {
                    foundCity = match2[1].trim();
                }
            }
        }
        if (foundCity) {
            const cityParts = foundCity.split(',');
            foundCity = cityParts[cityParts.length - 1].trim();
        }
        if (!foundCity && foundState) {
            const escapedState = foundState.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            const patternFallback = new RegExp(`(\\b[A-Za-z]+)\\s+${escapedState}\\b`, 'i');
            const matchFallback = customerText.match(patternFallback);
            if (matchFallback) {
                foundCity = matchFallback[1].trim();
            }
        }

        // Push directly to queue
        const queue = getOrderQueue();

        // Duplicate check on soNum (invoiceNo / Sales Order No)
        const isDuplicate = queue.some(order => order.invoiceNo && order.invoiceNo.trim().toLowerCase() === soNum.trim().toLowerCase());
        if (isDuplicate) {
            alert(`Duplicate Order Alert!\nSales Order "${soNum}" already exists in the Active Queue.`);
            return;
        }
        
        const orderId = "q_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
        
        queue.push({
            id: orderId,
            shopName: shopName,
            invoiceNo: soNum,
            items: parsedItems.map(item => {
                const matched = findFuzzyProduct(item.rawName, uniqueProducts);
                return {
                    rawName: item.rawName,
                    name: matched || '',
                    qty: item.qty
                };
            }),
            timestamp: new Date().toLocaleString(),
            city: foundCity || 'Unknown City',
            state: foundState || 'Unknown State',
            pincode: pincode || 'Unknown PIN'
        });

        saveOrderQueue(queue);
        renderOrderQueueUI();

        // Clear textarea
        if (orderAssignRawText) orderAssignRawText.value = '';
    }

    function findFuzzyProduct(soItemName, knownProducts) {
        const clean = soItemName.trim().toLowerCase();
        const exact = knownProducts.find(p => p.toLowerCase() === clean);
        if (exact) return exact;
        
        const contains = knownProducts.find(p => {
            const lp = p.toLowerCase();
            return lp.includes(clean) || clean.includes(lp);
        });
        if (contains) return contains;
        
        const parts = clean.split(/\s+/).filter(p => p.length > 2 && p !== 'led' && p !== 'hdmi');
        if (parts.length > 0) {
            const matched = knownProducts.find(p => {
                const lp = p.toLowerCase();
                return parts.every(part => lp.includes(part));
            });
            if (matched) return matched;
        }
        return null;
    }

    function getProductStockMap() {
        if (cachedProductStockMap !== null) {
            return cachedProductStockMap;
        }

        const outboundHistory = getOutboundHistory();
        const outboundSerialsSet = new Set();
        const outboundCountsByProduct = {};
        const unmatchedOutboundCounts = {};

        const damageRecords = getDamageRecords();
        const damageSerials = new Set(damageRecords.map(r => r.serial.trim().toUpperCase()));

        const inboundSerialsSet = new Set();
        const inboundHistory = getHistory();
        inboundHistory.forEach(log => {
            if (log.serials) {
                log.serials.forEach(s => {
                    if (s && s.serial) {
                        inboundSerialsSet.add(s.serial.trim().toUpperCase());
                    }
                });
            }
        });

        outboundHistory.forEach(log => {
            if (log.serials) {
                log.serials.forEach(s => {
                    const cleanSerial = s.serial.trim().toUpperCase();
                    outboundSerialsSet.add(cleanSerial);
                    const itemName = s.itemName;
                    if (!outboundCountsByProduct[itemName]) {
                        outboundCountsByProduct[itemName] = 0;
                    }
                    outboundCountsByProduct[itemName]++;

                    if (!inboundSerialsSet.has(cleanSerial) && !cleanSerial.includes('WOS-OUT-')) {
                        if (!unmatchedOutboundCounts[itemName]) {
                            unmatchedOutboundCounts[itemName] = 0;
                        }
                        unmatchedOutboundCounts[itemName]++;
                    }
                });
            }
        });

        const productStock = {};
        const weights = getProductWeights();

        const remainingWosOutbound = {};
        Object.keys(outboundCountsByProduct).forEach(key => {
            remainingWosOutbound[key] = outboundCountsByProduct[key];
        });

        const remainingUnmatchedOutbound = {};
        Object.keys(unmatchedOutboundCounts).forEach(key => {
            remainingUnmatchedOutbound[key] = unmatchedOutboundCounts[key];
        });

        const inboundHistoryReversed = [...inboundHistory].reverse();
        
        inboundHistoryReversed.forEach(log => {
            const name = log.item;
            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    const itemName = s.itemName || name;
                    const cleanInboundSerial = s.serial.trim().toUpperCase();

                    if (damageSerials.has(cleanInboundSerial)) {
                        return; // Damaged, not available in stock
                    }

                    if (!productStock[itemName]) {
                        productStock[itemName] = {
                            name: itemName,
                            serialsCount: 0
                        };
                    }
                    
                    let isDispatched = false;
                    if (outboundSerialsSet.has(cleanInboundSerial)) {
                        isDispatched = true;
                    } else if (remainingUnmatchedOutbound[itemName] && remainingUnmatchedOutbound[itemName] > 0) {
                        isDispatched = true;
                        remainingUnmatchedOutbound[itemName]--;
                    }

                    if (!isDispatched) {
                        productStock[itemName].serialsCount++;
                    }
                });
            } else {
                if (name && log.count > 0) {
                    if (!productStock[name]) {
                        productStock[name] = {
                            name: name,
                            serialsCount: 0
                        };
                    }
                    
                    const inboundQty = log.count;
                    const remOut = remainingWosOutbound[name] || 0;
                    if (remOut >= inboundQty) {
                        remainingWosOutbound[name] -= inboundQty;
                    } else {
                        const availableQty = inboundQty - remOut;
                        remainingWosOutbound[name] = 0;
                        productStock[name].serialsCount += availableQty;
                    }
                }
            }
        });

        cachedProductStockMap = productStock;
        return cachedProductStockMap;
    }    function renderOrderQueueUI() {
        // No-op since Order Assign has been removed
    }

    // --- Without Serial Number Inward Workspace Controllers ---
    const inboundActionsDropdownBtn = document.getElementById('inboundActionsDropdownBtn');
    const inboundActionsDropdownMenu = document.getElementById('inboundActionsDropdownMenu');
    const btnOpenWithoutSerialInward = document.getElementById('btnOpenWithoutSerialInward');
    const sectionInbound = document.getElementById('sectionInbound');
    const sectionWithoutSerialInbound = document.getElementById('sectionWithoutSerialInbound');
    const btnBackToInboundLogs = document.getElementById('btnBackToInboundLogs');

    const wosItemDropdownContainer = document.getElementById('wosItemDropdownContainer');
    const wosItemDropdownTrigger = document.getElementById('wosItemDropdownTrigger');
    const wosItemDropdownMenu = document.getElementById('wosItemDropdownMenu');
    const wosItemDropdownList = document.getElementById('wosItemDropdownList');
    const wosItemDropdownSelectedText = document.getElementById('wosItemDropdownSelectedText');
    const wosItemSelect = document.getElementById('wosItemSelect');

    const withoutSerialInwardForm = document.getElementById('withoutSerialInwardForm');
    const wosVehicleNo = document.getElementById('wosVehicleNo');
    const wosQty = document.getElementById('wosQty');

    // 1. More Actions Dropdown Toggle
    if (inboundActionsDropdownBtn && inboundActionsDropdownMenu) {
        inboundActionsDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = inboundActionsDropdownMenu.style.display === 'block';
            inboundActionsDropdownMenu.style.display = isOpen ? 'none' : 'block';
        });
    }

    // 2. Open Without Serial Inward View
    if (btnOpenWithoutSerialInward && sectionWithoutSerialInbound && sectionInbound) {
        btnOpenWithoutSerialInward.addEventListener('click', () => {
            if (inboundActionsDropdownMenu) inboundActionsDropdownMenu.style.display = 'none';
            sectionInbound.classList.remove('active');
            sectionInbound.style.display = 'none';

            sectionWithoutSerialInbound.style.display = 'block';
            sectionWithoutSerialInbound.classList.add('active');

            renderWosDropdownItems();
        });
    }

    // 3. Back button navigation
    if (btnBackToInboundLogs && sectionInbound && sectionWithoutSerialInbound) {
        btnBackToInboundLogs.addEventListener('click', () => {
            sectionWithoutSerialInbound.classList.remove('active');
            sectionWithoutSerialInbound.style.display = 'none';

            sectionInbound.style.display = 'flex';
            sectionInbound.classList.add('active');
        });
    }

    // Helper to get/save dedicated WOS items
    function getWosItems() {
        const saved = localStorage.getItem('wms_wos_items');
        if (saved) return JSON.parse(saved);
        return [];
    }

    function saveWosItems(items) {
        localStorage.setItem('wms_wos_items', JSON.stringify(items));
        firebaseSet('wos_items', items);
    }

    // 4. Render product dropdown items for Without Serial Inward
    function renderWosDropdownItems() {
        if (!wosItemDropdownList) return;
        wosItemDropdownList.innerHTML = '';
        const items = getWosItems();
        items.forEach(item => {
            const li = document.createElement('li');
            li.className = 'custom-dropdown-item';
            li.style.cssText = 'padding: 12px; cursor: pointer; transition: var(--transition-smooth); font-weight: 500;';
            li.textContent = item;
            li.addEventListener('click', () => {
                if (wosItemSelect) wosItemSelect.value = item;
                if (wosItemDropdownSelectedText) wosItemDropdownSelectedText.textContent = item;
                if (wosItemDropdownContainer) wosItemDropdownContainer.classList.remove('active');
            });
            wosItemDropdownList.appendChild(li);
        });
    }

    if (wosItemDropdownTrigger && wosItemDropdownContainer) {
        wosItemDropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            wosItemDropdownContainer.classList.toggle('active');
        });
    }

    // Inline Add product prompt inside WOS Inward form
    const btnAddNewWosProduct = document.getElementById('btnAddNewWosProduct');
    if (btnAddNewWosProduct) {
        btnAddNewWosProduct.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const newName = prompt('Enter new Without Serial Number Product Name:');
            if (newName && newName.trim()) {
                const cleanName = newName.trim();
                const currentWosItems = getWosItems();
                if (!currentWosItems.includes(cleanName)) {
                    currentWosItems.push(cleanName);
                    saveWosItems(currentWosItems);
                    renderWosDropdownItems();
                }
                
                // Automatically select the newly created item
                if (wosItemSelect) wosItemSelect.value = cleanName;
                if (wosItemDropdownSelectedText) wosItemDropdownSelectedText.textContent = cleanName;
            }
        });
    }

    // 5. Global Document Click handler to close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
        if (inboundActionsDropdownMenu && !e.target.closest('.inbound-dropdown-container')) {
            inboundActionsDropdownMenu.style.display = 'none';
        }
        if (wosItemDropdownContainer && !e.target.closest('#wosItemDropdownContainer')) {
            wosItemDropdownContainer.classList.remove('active');
        }
    });

    // 6. Form Submission Handler for Without Serial Inward
    if (withoutSerialInwardForm) {
        withoutSerialInwardForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const itemVal = wosItemSelect.value;
            const vehicleVal = wosVehicleNo.value.trim();
            const qtyVal = parseInt(wosQty.value) || 1;
            const wosBoxCount = document.getElementById('wosBoxCount');
            const boxCountVal = wosBoxCount ? (parseInt(wosBoxCount.value) || 1) : 1;

            if (!itemVal) {
                alert('Please select a product item.');
                return;
            }

            const now = new Date();
            const logEntry = {
                id: "in_wos_" + Date.now(),
                timestamp: now.toLocaleTimeString('en-US', { hour12: true }),
                date: now.toISOString().slice(0, 10),
                vehicle: vehicleVal || 'N/A',
                item: itemVal,
                count: qtyVal,
                boxCount: boxCountVal, // Save box count!
                expected: 0,
                serials: [], // empty serials list for non-serial inward log
                weights: {}
            };

            const history = getHistory();
            history.unshift(logEntry);
            saveHistory(history);

            renderHistoryTable();
            renderInventoryPanel();

            // Set up callback to complete form reset and navigation after weight configuration
            window.completeEndInboundSession = function() {
                withoutSerialInwardForm.reset();
                if (wosItemDropdownSelectedText) wosItemDropdownSelectedText.textContent = 'Choose an item...';
                if (wosItemSelect) wosItemSelect.value = '';
                if (wosBoxCount) wosBoxCount.value = '1';

                // Navigate back
                sectionWithoutSerialInbound.classList.remove('active');
                sectionWithoutSerialInbound.style.display = 'none';
                sectionInbound.style.display = 'flex';
                sectionInbound.classList.add('active');

                alert(`Success! Inwarded ${qtyVal} PCs (${boxCountVal} Boxes) of "${itemVal}" without serial numbers.`);
            };

            // Queue and process weight
            weightConfigureQueue = [itemVal];
            currentEndingSessionLogId = logEntry.id;
            processWeightConfigureQueue();
        });
    }

    // --- Outbound Dispatch Without Serial Number Controllers ---
    const btnOpenOutboundWithoutSerialModal = document.getElementById('btnOpenOutboundWithoutSerialModal');
    const outboundWithoutSerialModal = document.getElementById('outboundWithoutSerialModal');
    const closeOutboundWithoutSerialModalBtn = document.getElementById('closeOutboundWithoutSerialModalBtn');
    const cancelOutboundWithoutSerialModalBtn = document.getElementById('cancelOutboundWithoutSerialModalBtn');
    const outboundWithoutSerialForm = document.getElementById('outboundWithoutSerialForm');

    const outboundWosItemDropdownContainer = document.getElementById('outboundWosItemDropdownContainer');
    const outboundWosItemDropdownTrigger = document.getElementById('outboundWosItemDropdownTrigger');
    const outboundWosItemDropdownList = document.getElementById('outboundWosItemDropdownList');
    const outboundWosItemDropdownSelectedText = document.getElementById('outboundWosItemDropdownSelectedText');
    const outboundWosItemSelect = document.getElementById('outboundWosItemSelect');
    const outboundWosQty = document.getElementById('outboundWosQty');

    if (btnOpenOutboundWithoutSerialModal && outboundWithoutSerialModal) {
        btnOpenOutboundWithoutSerialModal.addEventListener('click', () => {
            outboundWithoutSerialModal.classList.add('active');
            renderOutboundWosDropdownItems();
        });
    }

    function closeOutboundWithoutSerialModal() {
        if (outboundWithoutSerialModal) {
            outboundWithoutSerialModal.classList.remove('active');
        }
        if (outboundWithoutSerialForm) {
            outboundWithoutSerialForm.reset();
        }
        if (outboundWosItemDropdownSelectedText) {
            outboundWosItemDropdownSelectedText.textContent = 'Choose an item...';
        }
        if (outboundWosItemSelect) {
            outboundWosItemSelect.value = '';
        }
    }

    if (closeOutboundWithoutSerialModalBtn) closeOutboundWithoutSerialModalBtn.addEventListener('click', closeOutboundWithoutSerialModal);
    if (cancelOutboundWithoutSerialModalBtn) cancelOutboundWithoutSerialModalBtn.addEventListener('click', closeOutboundWithoutSerialModal);

    if (outboundWosItemDropdownTrigger && outboundWosItemDropdownContainer) {
        outboundWosItemDropdownTrigger.addEventListener('click', (e) => {
            e.stopPropagation();
            outboundWosItemDropdownContainer.classList.toggle('active');
        });
    }

    function renderOutboundWosDropdownItems() {
        if (!outboundWosItemDropdownList) return;
        outboundWosItemDropdownList.innerHTML = '';
        
        // Scan completed Inbound history to find items successfully inwarded without serial numbers!
        const history = getHistory();
        const inwardedWosItems = Array.from(new Set(
            history
                .filter(log => (!log.serials || log.serials.length === 0) && log.count > 0)
                .map(log => log.item)
        ));

        if (inwardedWosItems.length === 0) {
            const li = document.createElement('li');
            li.className = 'custom-dropdown-item';
            li.style.cssText = 'padding: 12px; color: var(--text-muted); font-style: italic; text-align: center;';
            li.textContent = 'No WOS items inwarded yet';
            outboundWosItemDropdownList.appendChild(li);
            return;
        }

        inwardedWosItems.forEach(item => {
            const li = document.createElement('li');
            li.className = 'custom-dropdown-item';
            li.style.cssText = 'padding: 12px; cursor: pointer; transition: var(--transition-smooth); font-weight: 500;';
            li.textContent = item;
            li.addEventListener('click', () => {
                if (outboundWosItemSelect) outboundWosItemSelect.value = item;
                if (outboundWosItemDropdownSelectedText) outboundWosItemDropdownSelectedText.textContent = item;
                if (outboundWosItemDropdownContainer) outboundWosItemDropdownContainer.classList.remove('active');
            });
            outboundWosItemDropdownList.appendChild(li);
        });
    }

    // Close on outer click
    window.addEventListener('click', (e) => {
        if (e.target === outboundWithoutSerialModal) {
            closeOutboundWithoutSerialModal();
        }
    });

    document.addEventListener('click', (e) => {
        if (outboundWosItemDropdownContainer && !e.target.closest('#outboundWosItemDropdownContainer')) {
            outboundWosItemDropdownContainer.classList.remove('active');
        }
    });

    if (outboundWithoutSerialForm) {
        outboundWithoutSerialForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!activeOutboundSession) return;

            const itemVal = outboundWosItemSelect.value;
            const qtyVal = parseInt(outboundWosQty.value) || 1;
            const outboundWosBoxCount = document.getElementById('outboundWosBoxCount');
            const boxCountVal = outboundWosBoxCount ? (parseInt(outboundWosBoxCount.value) || 1) : 1;

            if (!itemVal) {
                alert('Please select a product item.');
                return;
            }

            // Find or add item in active outbound session items list
            let targetItem = activeOutboundSession.items.find(i => i.name === itemVal);
            if (!targetItem) {
                targetItem = {
                    name: itemVal,
                    skuAlphabetPattern: null,
                    lockedLength: null,
                    allowedPatterns: []
                };
                activeOutboundSession.items.push(targetItem);
            }

            // Determine unique Box Number sequence for this product
            const itemSerials = activeOutboundSession.serials.filter(s => s.itemName === itemVal);
            const maxBoxNo = itemSerials.reduce((max, s) => s.boxNo > max ? s.boxNo : max, 0);
            const wosBoxNo = maxBoxNo + 1;

            // Distribute quantity across boxes
            const baseQtyPerBox = Math.floor(qtyVal / boxCountVal);
            let remainder = qtyVal % boxCountVal;

            let currentBoxOffset = wosBoxNo;
            for (let b = 0; b < boxCountVal; b++) {
                const boxNo = currentBoxOffset + b;
                const pcsInThisBox = baseQtyPerBox + (remainder > 0 ? 1 : 0);
                remainder--;

                for (let p = 1; p <= pcsInThisBox; p++) {
                    activeOutboundSession.serials.push({
                        serial: `WOS-OUT-${Date.now()}-${boxNo}-${p}`,
                        boxNo: boxNo,
                        itemName: itemVal
                    });
                }
            }

            saveActiveOutboundSession();
            updateOutboundSessionProgress();
            renderOutboundBoxCards();

            alert(`Success! Added ${qtyVal} PCs (${boxCountVal} Boxes) of "${itemVal}" to outbound dispatch list without serial numbers.`);
            closeOutboundWithoutSerialModal();
        });
    }

    // --- MIS Report Generator Logic ---
    function populateMisProductsDropdown() {
        const misProductSelect = document.getElementById('misProductSelect');
        if (!misProductSelect) return;

        // Keep the "ALL" option
        misProductSelect.innerHTML = '<option value="ALL">All Products (Mixed)</option>';

        // Get unique products from history database
        const history = getHistory();
        const outboundHistory = getOutboundHistory();
        const productsSet = new Set();

        history.forEach(log => {
            if (log.item) productsSet.add(log.item);
            if (log.serials) log.serials.forEach(s => productsSet.add(s.itemName));
        });
        outboundHistory.forEach(log => {
            if (log.item) productsSet.add(log.item);
            if (log.serials) log.serials.forEach(s => productsSet.add(s.itemName));
        });

        // Add sorted products to select dropdown
        Array.from(productsSet).sort().forEach(prod => {
            if (prod) {
                const opt = document.createElement('option');
                opt.value = prod;
                opt.textContent = prod;
                misProductSelect.appendChild(opt);
            }
        });
    }

    window.populateMisProductsDropdown = populateMisProductsDropdown; // export for global trigger

    function generateMisReportData() {
        const productFilter = document.getElementById('misProductSelect')?.value || 'ALL';
        const fromDateStr = document.getElementById('misFromDate')?.value || '';
        const toDateStr = document.getElementById('misToDate')?.value || '';

        const history = getHistory();
        const outboundHistory = getOutboundHistory();

        let mergedEvents = [];

        // 1. Gather Inward events
        history.forEach(log => {
            if (!log.timestamp) return;
            const timestamp = new Date(log.timestamp);
            // Check date range filters
            if (fromDateStr && new Date(fromDateStr + 'T00:00:00') > timestamp) return;
            if (toDateStr && new Date(toDateStr + 'T23:59:59') < timestamp) return;

            const name = log.item;
            const logType = "INWARD";
            const details = log.vehicle ? `Vehicle: ${log.vehicle}` : 'Inward Logs';

            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    const itemName = s.itemName || name;
                    if (productFilter !== 'ALL' && itemName !== productFilter) return;

                    mergedEvents.push({
                        rawTime: timestamp,
                        timeStr: log.timestamp,
                        activity: logType,
                        itemName: itemName,
                        serial: s.serial,
                        boxNo: s.boxNo,
                        qty: 1,
                        details: details
                    });
                });
            } else {
                // Non-serial inward
                if (productFilter !== 'ALL' && name !== productFilter) return;
                mergedEvents.push({
                    rawTime: timestamp,
                    timeStr: log.timestamp,
                    activity: logType,
                    itemName: name,
                    serial: 'Without Serial Number (WOS-IN)',
                    boxNo: log.wosBoxNo || '-',
                    qty: log.count || 0,
                    details: details
                });
            }
        });

        // 2. Gather Outward events
        outboundHistory.forEach(log => {
            if (!log.timestamp) return;
            const timestamp = new Date(log.timestamp);
            // Check date range filters
            if (fromDateStr && new Date(fromDateStr + 'T00:00:00') > timestamp) return;
            if (toDateStr && new Date(toDateStr + 'T23:59:59') < timestamp) return;

            const name = log.item;
            const logType = "OUTWARD";
            const details = `Shop: ${log.shopName || 'N/A'}, Inv: ${log.invoiceNo || 'N/A'}`;

            if (log.serials && log.serials.length > 0) {
                log.serials.forEach(s => {
                    const itemName = s.itemName || name;
                    if (productFilter !== 'ALL' && itemName !== productFilter) return;

                    mergedEvents.push({
                        rawTime: timestamp,
                        timeStr: log.timestamp,
                        activity: logType,
                        itemName: itemName,
                        serial: s.serial,
                        boxNo: s.boxNo,
                        qty: 1,
                        details: details
                    });
                });
            } else {
                // Non-serial outbound
                if (productFilter !== 'ALL' && name !== productFilter) return;
                mergedEvents.push({
                    rawTime: timestamp,
                    timeStr: log.timestamp,
                    activity: logType,
                    itemName: name,
                    serial: 'Without Serial Number (WOS-OUT)',
                    boxNo: log.outboundWosBoxNo || '-',
                    qty: log.count || 0,
                    details: details
                });
            }
        });

        // Sort by timestamp (oldest first)
        mergedEvents.sort((a, b) => a.rawTime - b.rawTime);

        return mergedEvents;
    }

    const btnGenerateMisReport = document.getElementById('btnGenerateMisReport');
    if (btnGenerateMisReport) {
        btnGenerateMisReport.addEventListener('click', () => {
            const data = generateMisReportData();
            const body = document.getElementById('misReportTableBody');
            if (!body) return;

            body.innerHTML = '';

            let totalInward = 0;
            let totalOutward = 0;

            if (data.length === 0) {
                body.innerHTML = `
                    <tr>
                        <td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">
                            No matching stock activity found for selected filters.
                        </td>
                    </tr>
                `;
                document.getElementById('misTotalInwardPcs').textContent = '0';
                document.getElementById('misTotalOutwardPcs').textContent = '0';
                document.getElementById('misNetPcs').textContent = '0';
                return;
            }

            data.forEach(row => {
                const tr = document.createElement('tr');
                
                // Color code Activity
                const badgeColor = row.activity === 'INWARD' ? 'var(--accent-blue)' : 'var(--accent-rose)';
                const badgeBg = row.activity === 'INWARD' ? 'rgba(59,130,246,0.1)' : 'rgba(244,63,94,0.1)';

                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); font-size: 0.8rem;">${row.timeStr}</td>
                    <td>
                        <span style="font-size: 0.72rem; font-weight: 700; background: ${badgeBg}; color: ${badgeColor}; padding: 2px 6px; border-radius: 4px; border: 1px solid ${badgeColor}40;">
                            ${row.activity}
                        </span>
                    </td>
                    <td style="font-weight: 700; color: var(--text-primary); font-size: 0.85rem;">${row.itemName}</td>
                    <td style="font-family: var(--font-mono); font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${row.serial}">${row.serial}</td>
                    <td>${row.boxNo}</td>
                    <td style="font-weight: 700;">${row.qty}</td>
                    <td style="font-size: 0.8rem; color: var(--text-secondary);">${row.details}</td>
                `;

                body.appendChild(tr);

                if (row.activity === 'INWARD') {
                    totalInward += row.qty;
                } else {
                    totalOutward += row.qty;
                }
            });

            document.getElementById('misTotalInwardPcs').textContent = totalInward;
            document.getElementById('misTotalOutwardPcs').textContent = totalOutward;
            document.getElementById('misNetPcs').textContent = (totalInward - totalOutward);
        });
    }

    const btnExportMisReportExcel = document.getElementById('btnExportMisReportExcel');
    if (btnExportMisReportExcel) {
        btnExportMisReportExcel.addEventListener('click', () => {
            const data = generateMisReportData();
            if (data.length === 0) {
                alert('No MIS report data to export. Generate a report first.');
                return;
            }

            const sheetRows = [];
            let rowIdx = 1;
            let sumInward = 0;
            let sumOutward = 0;

            data.forEach(row => {
                sheetRows.push({
                    "S.No.": rowIdx++,
                    "Timestamp": row.timeStr,
                    "Activity": row.activity,
                    "Product Name": row.itemName,
                    "Serial Number": row.serial,
                    "Box No.": row.boxNo,
                    "Quantity (Pcs)": row.qty,
                    "Details": row.details
                });

                if (row.activity === 'INWARD') {
                    sumInward += row.qty;
                } else {
                    sumOutward += row.qty;
                }
            });

            // Append summary row
            sheetRows.push({
                "S.No.": "",
                "Timestamp": "",
                "Activity": "",
                "Product Name": "",
                "Serial Number": "",
                "Box No.": "",
                "Quantity (Pcs)": "",
                "Details": ""
            });

            sheetRows.push({
                "S.No.": "",
                "Timestamp": "TOTAL INWARD PCs",
                "Activity": sumInward,
                "Product Name": "TOTAL OUTWARD PCs",
                "Box No.": sumOutward,
                "Quantity (Pcs)": "NET STOCK PCs",
                "Details": (sumInward - sumOutward)
            });

            const ws = XLSX.utils.json_to_sheet(sheetRows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "MIS Report");

            // Format Filename: MUMBAI_MIS_REPORT_BHIWANDI_DD_MM_YYYY_HH_MM_SS
            const now = new Date();
            const dateStr = now.toLocaleDateString('en-GB').replace(/\//g, '_');
            const timeStr = now.toLocaleTimeString('en-US', { hour12: false }).replace(/\:/g, '-');
            const filename = `MUMBAI_MIS_REPORT_BHIWANDI_${dateStr}_${timeStr}`.toUpperCase() + ".xlsx";

            XLSX.writeFile(wb, filename);
        });
    }

    // --- Real-time Connection Status feedback ---
    function updateConnectionStatus(connected) {
        const dot = document.getElementById('systemStatusDot');
        const text = document.getElementById('systemStatusText');
        if (!dot || !text) return;
        
        if (connected) {
            dot.style.backgroundColor = 'var(--accent-emerald)';
            dot.style.boxShadow = '0 0 8px var(--accent-emerald)';
            text.textContent = 'System Connected';
        } else {
            dot.style.backgroundColor = 'var(--accent-rose)';
            dot.style.boxShadow = '0 0 8px var(--accent-rose)';
            text.textContent = 'System Offline';
        }
    }

    if (isFirebaseConnected && db) {
        db.ref('.info/connected').on('value', (snap) => {
            if (snap.val() === true) {
                updateConnectionStatus(true);
            } else {
                updateConnectionStatus(false);
            }
        });
    } else {
        updateConnectionStatus(false);
    }

    // --- Device Access Authorization Control ---
    let deviceId = localStorage.getItem('wms_device_id');
    if (!deviceId) {
        deviceId = 'DEV-' + Math.floor(1000 + Math.random() * 9000);
        localStorage.setItem('wms_device_id', deviceId);
    }

    const accessLockOverlay = document.getElementById('accessLockOverlay');
    const accessOverlayDeviceId = document.getElementById('accessOverlayDeviceId');
    const btnUnlockOverlayWithPass = document.getElementById('btnUnlockOverlayWithPass');
    
    if (accessOverlayDeviceId) {
        accessOverlayDeviceId.textContent = deviceId;
    }

    // --- Real-time speech synthesis notification helpers ---
    let localSpeakerActive = localStorage.getItem('wms_speaker_active') === 'true';
    let baseSpeakerSpeed = parseFloat(localStorage.getItem('wms_speaker_speed')) || 0.95;
    let wakeLock = null;
    let silentAudioEl = null;
    let ttsAudioEl = null;

    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                console.log("Wake Lock acquired successfully.");
            }
        } catch (err) {
            console.warn(`Wake Lock failed: ${err.name}, ${err.message}`);
        }
    }

    function releaseWakeLock() {
        if (wakeLock !== null) {
            wakeLock.release().then(() => {
                wakeLock = null;
                console.log("Wake Lock released.");
            }).catch(err => {
                console.warn("Wake Lock release failed:", err);
            });
        }
    }

    function startSilenceLoop() {
        try {
            if (!silentAudioEl) {
                silentAudioEl = document.createElement('audio');
                silentAudioEl.id = 'silentAudioLoop';
                // 1-second silent WAV base64 data to keep audio session alive on mobile devices
                silentAudioEl.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQQAAAAAAA==';
                silentAudioEl.loop = true;
                silentAudioEl.volume = 0.05;
                document.body.appendChild(silentAudioEl);
            }
            silentAudioEl.play().then(() => {
                console.log("Silent audio loop started successfully.");
            }).catch(err => {
                console.warn("Silent audio play failed:", err);
            });
        } catch (e) {
            console.warn("Silent audio loop setup failed: ", e);
        }
    }

    function stopSilenceLoop() {
        if (silentAudioEl) {
            try {
                silentAudioEl.pause();
            } catch(e){}
            console.log("Silent audio loop stopped.");
        }
    }

    // Auto-acquire wake lock if page visibility changes back to visible and speaker is active
    document.addEventListener('visibilitychange', async () => {
        if (localSpeakerActive && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });

    function triggerSpeak(text) {
        if (isFirebaseConnected && db) {
            db.ref('wms_data/speak_event').set({
                text: text,
                timestamp: Date.now()
            });
        } else {
            playLocalSpeak(text);
        }
    }

    let speechQueue = [];
    let isSpeaking = false;

    function playLocalSpeak(text) {
        if (!localSpeakerActive) return;
        if (isFirebaseConnected && db) {
            db.ref('wms_data/devices/' + deviceId).once('value').then(snapshot => {
                const dev = snapshot.val();
                if (dev && dev.status === 'approved' && dev.speakerApproved) {
                    speechQueue.push(text);
                    processSpeechQueue();
                }
            });
        } else {
            speechQueue.push(text);
            processSpeechQueue();
        }
    }

    function processSpeechQueue() {
        if (isSpeaking) return;
        if (speechQueue.length === 0) return;

        isSpeaking = true;
        let text = speechQueue.shift();

        // Calculate rate dynamically based on the user-configured baseSpeakerSpeed
        const queueSize = speechQueue.length;
        let rate = baseSpeakerSpeed;
        let processedText = text;

        if (queueSize >= 2) {
            // Turbo Speed: 3+ items back-to-back (current + 2 waiting)
            rate = Math.min(baseSpeakerSpeed * 1.55, 2.0);
            processedText = text.replace(/,/g, ' '); // remove commas for speed
        } else if (queueSize === 1) {
            // Fast Speed: 2 items back-to-back (current + 1 waiting)
            rate = Math.min(baseSpeakerSpeed * 1.25, 2.0);
            processedText = text.replace(/,/g, ' '); // remove commas for speed
        } else {
            // Normal user-selected speed
            rate = baseSpeakerSpeed;
            processedText = text;
        }

        executeSpeechQueueItem(processedText, rate);
    }

    function executeSpeechQueueItem(text, rate) {
        if (navigator.onLine) {
            try {
                if (!ttsAudioEl) {
                    ttsAudioEl = document.createElement('audio');
                    ttsAudioEl.id = 'ttsAudioPlayer';
                    document.body.appendChild(ttsAudioEl);
                }
                const url = 'https://translate.google.com/translate_tts?ie=UTF-8&tl=en&client=tw-ob&q=' + encodeURIComponent(text);
                ttsAudioEl.src = url;
                ttsAudioEl.playbackRate = rate;
                ttsAudioEl.volume = 1.0;
                
                ttsAudioEl.onended = () => {
                    isSpeaking = false;
                    processSpeechQueue();
                };
                ttsAudioEl.onerror = () => {
                    console.warn("TTS audio play failed, trying local fallback.");
                    localSpeechFallbackQueue(text, rate);
                };

                ttsAudioEl.play().catch(err => {
                    console.warn("TTS play failed, trying local fallback:", err);
                    localSpeechFallbackQueue(text, rate);
                });
                return;
            } catch (e) {
                console.warn("TTS play exception, trying local fallback:", e);
            }
        }
        localSpeechFallbackQueue(text, rate);
    }

    function localSpeechFallbackQueue(text, rate) {
        if (!window.speechSynthesis) {
            isSpeaking = false;
            processSpeechQueue();
            return;
        }
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = rate;
        utterance.pitch = 1.0;
        
        utterance.onend = () => {
            isSpeaking = false;
            processSpeechQueue();
        };
        utterance.onerror = () => {
            isSpeaking = false;
            processSpeechQueue();
        };
        window.speechSynthesis.speak(utterance);
    }

    // Toggle Local Speaker button handler
    const btnToggleLocalSpeaker = document.getElementById('btnToggleLocalSpeaker');
    const btnToggleLocalSpeakerText = document.getElementById('btnToggleLocalSpeakerText');
    const localSpeakerIcon = document.getElementById('localSpeakerIcon');
    const inputSpeakerSpeed = document.getElementById('inputSpeakerSpeed');
    const lblSpeakerSpeedVal = document.getElementById('lblSpeakerSpeedVal');

    function updateLocalSpeakerUI() {
        if (!btnToggleLocalSpeaker || !btnToggleLocalSpeakerText) return;
        if (localSpeakerActive) {
            btnToggleLocalSpeaker.style.background = 'rgba(16, 185, 129, 0.12)';
            btnToggleLocalSpeaker.style.color = 'var(--accent-emerald)';
            btnToggleLocalSpeaker.style.borderColor = 'var(--accent-emerald)';
            btnToggleLocalSpeakerText.textContent = 'Speaker Active';
            if (localSpeakerIcon) {
                localSpeakerIcon.style.color = 'var(--accent-emerald)';
            }
        } else {
            btnToggleLocalSpeaker.style.background = 'rgba(244, 63, 94, 0.08)';
            btnToggleLocalSpeaker.style.color = 'var(--accent-rose)';
            btnToggleLocalSpeaker.style.borderColor = 'rgba(244, 63, 94, 0.2)';
            btnToggleLocalSpeakerText.textContent = 'Muted (Click to Unmute)';
            if (localSpeakerIcon) {
                localSpeakerIcon.style.color = 'var(--accent-rose)';
            }
        }

        // Update Speed Control Slider UI value
        if (inputSpeakerSpeed && lblSpeakerSpeedVal) {
            inputSpeakerSpeed.value = baseSpeakerSpeed;
            lblSpeakerSpeedVal.textContent = baseSpeakerSpeed.toFixed(2) + 'x';
        }
    }

    if (btnToggleLocalSpeaker) {
        btnToggleLocalSpeaker.addEventListener('click', () => {
            localSpeakerActive = !localSpeakerActive;
            localStorage.setItem('wms_speaker_active', localSpeakerActive ? 'true' : 'false');
            updateLocalSpeakerUI();
            if (localSpeakerActive) {
                startSilenceLoop();
                playLocalSpeak("Speaker active");
                requestWakeLock();
            } else {
                releaseWakeLock();
                stopSilenceLoop();
                speechQueue = [];
                isSpeaking = false;
                if (ttsAudioEl) {
                    try { ttsAudioEl.pause(); } catch(e){}
                }
                if (window.speechSynthesis) {
                    try { window.speechSynthesis.cancel(); } catch(e){}
                }
            }
        });
    }

    if (inputSpeakerSpeed && lblSpeakerSpeedVal) {
        inputSpeakerSpeed.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            baseSpeakerSpeed = val;
            localStorage.setItem('wms_speaker_speed', val.toString());
            lblSpeakerSpeedVal.textContent = val.toFixed(2) + 'x';
        });
    }

    // Try to restore wake lock and silent loop if localSpeakerActive was saved as active
    // Note: Browser rules require user gesture, so this will activate on the first user interaction on the page.
    window.addEventListener('click', function initSpeakerOnGesture() {
        if (localSpeakerActive) {
            startSilenceLoop();
            requestWakeLock();
        }
        window.removeEventListener('click', initSpeakerOnGesture);
    });

    updateLocalSpeakerUI();

    // Bind real-time listener for speak events across all authorized speaker devices
    if (isFirebaseConnected && db) {
        db.ref('wms_data/speak_event').on('value', (snapshot) => {
            const val = snapshot.val();
            if (val && val.text && val.timestamp) {
                if (Date.now() - val.timestamp < 5000) {
                    playLocalSpeak(val.text);
                }
            }
        });
    }

    function checkDeviceApprovalStatus() {
        if (!isFirebaseConnected || !db) {
            // Offline fallback: allow access for local testing if offline
            if (accessLockOverlay) accessLockOverlay.style.display = 'none';
            return;
        }

        db.ref('wms_data/devices/' + deviceId).on('value', (snapshot) => {
            const device = snapshot.val();
            if (!device) {
                // Register device as pending approval in Firebase
                const deviceRecord = {
                    id: deviceId,
                    status: 'pending',
                    requestedAt: new Date().toLocaleString(),
                    userAgent: navigator.userAgent
                };
                db.ref('wms_data/devices/' + deviceId).set(deviceRecord);
                if (accessLockOverlay) accessLockOverlay.style.display = 'flex';
            } else {
                if (device.status === 'approved') {
                    if (accessLockOverlay) accessLockOverlay.style.display = 'none';
                } else {
                    if (accessLockOverlay) accessLockOverlay.style.display = 'flex';
                    const statusText = document.getElementById('accessOverlayStatus');
                    if (statusText) {
                        if (device.status === 'rejected') {
                            statusText.style.color = 'var(--accent-rose)';
                            statusText.innerHTML = '<span class="status-dot" style="background-color: var(--accent-rose); box-shadow: 0 0 8px var(--accent-rose); width: 6px; height: 6px;"></span>Access Denied/Rejected';
                        } else {
                            statusText.style.color = 'var(--accent-amber)';
                            statusText.innerHTML = '<span class="status-dot" style="background-color: var(--accent-amber); box-shadow: 0 0 8px var(--accent-amber); width: 6px; height: 6px; animation: pulse 2s infinite;"></span>Waiting for admin approval...';
                        }
                    }
                }
            }
        });
    }

    if (btnUnlockOverlayWithPass) {
        btnUnlockOverlayWithPass.addEventListener('click', () => {
            const pass = prompt("Enter Administrator Password to authorize this device:");
            if (pass === '1998') {
                if (isFirebaseConnected && db) {
                    db.ref('wms_data/devices/' + deviceId + '/status').set('approved').then(() => {
                        alert("Device authorized successfully!");
                    });
                } else {
                    alert("Local authorization success (offline mode).");
                    if (accessLockOverlay) accessLockOverlay.style.display = 'none';
                }
            } else if (pass !== null) {
                alert("Incorrect password!");
            }
        });
    }

    // --- Device Manager Modal Controllers ---
    const btnOpenDeviceManager = document.getElementById('btnOpenDeviceManager');
    const deviceManagerModal = document.getElementById('deviceManagerModal');
    const closeDeviceManagerModalBtn = document.getElementById('closeDeviceManagerModalBtn');
    const closeDeviceManagerModalFooterBtn = document.getElementById('closeDeviceManagerModalFooterBtn');
    const deviceManagerTableBody = document.getElementById('deviceManagerTableBody');

    function openDeviceManager() {
        if (!deviceManagerModal) return;
        deviceManagerModal.classList.add('active');
        loadDevicesInManager();
    }

    function closeDeviceManager() {
        if (deviceManagerModal) {
            deviceManagerModal.classList.remove('active');
        }
    }

    if (btnOpenDeviceManager) {
        btnOpenDeviceManager.addEventListener('click', openDeviceManager);
    }
    if (closeDeviceManagerModalBtn) {
        closeDeviceManagerModalBtn.addEventListener('click', closeDeviceManager);
    }
    if (closeDeviceManagerModalFooterBtn) {
        closeDeviceManagerModalFooterBtn.addEventListener('click', closeDeviceManager);
    }

    const btnClearAllDevicesBtn = document.getElementById('btnClearAllDevicesBtn');
    if (btnClearAllDevicesBtn) {
        btnClearAllDevicesBtn.addEventListener('click', () => {
            const msg = "Are you sure you want to clear all device authorization records?\n\nThis will instantly lock all other devices. If your own device is locked, you can unlock it using the Admin Password '1998'.";
            if (!confirm(msg)) return;
            
            if (isFirebaseConnected && db) {
                db.ref('wms_data/devices').set(null).then(() => {
                    alert("All device records cleared successfully.");
                }).catch(err => {
                    alert("Failed to clear device records: " + err.message);
                });
            } else {
                alert("Database offline. Cannot clear records.");
            }
        });
    }

    function loadDevicesInManager() {
        if (!isFirebaseConnected || !db || !deviceManagerTableBody) return;
        
        db.ref('wms_data/devices').on('value', (snapshot) => {
            deviceManagerTableBody.innerHTML = '';
            const devices = snapshot.val();
            if (!devices) {
                deviceManagerTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-muted); font-style: italic; padding: 20px;">No device requests logged.</td></tr>';
                return;
            }

            Object.values(devices).forEach(dev => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid rgba(255, 255, 255, 0.05)';
                
                let statusBadge = `<span style="font-size: 0.7rem; font-weight: 700; background: rgba(245, 158, 11, 0.15); color: var(--accent-amber); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(245, 158, 11, 0.2); text-transform: uppercase;">Pending</span>`;
                if (dev.status === 'approved') {
                    statusBadge = `<span style="font-size: 0.7rem; font-weight: 700; background: rgba(16, 185, 129, 0.15); color: var(--accent-emerald); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.2); text-transform: uppercase;">Approved</span>`;
                } else if (dev.status === 'rejected') {
                    statusBadge = `<span style="font-size: 0.7rem; font-weight: 700; background: rgba(244, 63, 94, 0.15); color: var(--accent-rose); padding: 2px 6px; border-radius: 4px; border: 1px solid rgba(244, 63, 94, 0.2); text-transform: uppercase;">Rejected</span>`;
                }

                let speakerToggle = '';
                if (dev.status === 'approved') {
                    const isApproved = dev.speakerApproved ? 'checked' : '';
                    speakerToggle = `
                        <div style="display: flex; justify-content: center; align-items: center;">
                            <label style="position: relative; display: inline-block; width: 34px; height: 20px; cursor: pointer;">
                                <input type="checkbox" ${isApproved} onchange="window.toggleDeviceSpeaker('${dev.id}', this.checked)" style="opacity: 0; width: 0; height: 0; display: none;">
                                <span style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background-color: ${dev.speakerApproved ? 'var(--accent-emerald)' : 'rgba(255,255,255,0.1)'}; transition: .4s; border-radius: 20px;">
                                    <span style="position: absolute; content: ''; height: 14px; width: 14px; left: 3px; bottom: 3px; background-color: white; transition: .4s; border-radius: 50%; transform: ${dev.speakerApproved ? 'translateX(14px)' : 'none'};"></span>
                                </span>
                            </label>
                        </div>
                    `;
                } else {
                    speakerToggle = `<div style="text-align: center; color: var(--text-muted); font-size: 0.75rem;">N/A</div>`;
                }

                let actionButton = '';
                if (dev.status === 'pending') {
                    actionButton = `
                        <div style="display: flex; gap: 8px; justify-content: flex-end;">
                            <button type="button" class="btn-primary" onclick="window.setDeviceStatus('${dev.id}', 'approved')" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; border-radius: var(--radius-sm);">Approve</button>
                            <button type="button" class="btn-danger" onclick="window.setDeviceStatus('${dev.id}', 'rejected')" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; border-radius: var(--radius-sm); background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); color: var(--accent-rose);">Reject</button>
                        </div>
                    `;
                } else if (dev.status === 'approved') {
                    actionButton = `
                        <div style="display: flex; justify-content: flex-end;">
                            <button type="button" class="btn-danger" onclick="window.setDeviceStatus('${dev.id}', 'rejected')" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; border-radius: var(--radius-sm); background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); color: var(--accent-rose);">Revoke</button>
                        </div>
                    `;
                } else {
                    actionButton = `
                        <div style="display: flex; justify-content: flex-end;">
                            <button type="button" class="btn-primary" onclick="window.setDeviceStatus('${dev.id}', 'approved')" style="padding: 4px 8px; font-size: 0.7rem; font-weight: 700; cursor: pointer; border-radius: var(--radius-sm);">Approve</button>
                        </div>
                    `;
                }

                tr.innerHTML = `
                    <td style="font-family: var(--font-mono); font-size: 0.85rem; font-weight: 700; padding: 12px 8px;">${dev.id}</td>
                    <td style="font-size: 0.8rem; color: var(--text-secondary); padding: 12px 8px;">${dev.requestedAt || 'N/A'}</td>
                    <td style="padding: 12px 8px;">${speakerToggle}</td>
                    <td style="padding: 12px 8px;">${statusBadge}</td>
                    <td style="padding: 12px 8px;">${actionButton}</td>
                `;
                deviceManagerTableBody.appendChild(tr);
            });
        });
    }

    window.setDeviceStatus = function(devId, status) {
        if (isFirebaseConnected && db) {
            db.ref('wms_data/devices/' + devId + '/status').set(status);
        }
    };

    window.toggleDeviceSpeaker = function(devId, isChecked) {
        if (isFirebaseConnected && db) {
            db.ref('wms_data/devices/' + devId + '/speakerApproved').set(isChecked);
        }
    };

    // --- Outbound First Serials Modal Controllers ---
    const outboundFirstSerialsModal = document.getElementById('outboundFirstSerialsModal');
    const closeOutboundFirstSerialsModalBtn = document.getElementById('closeOutboundFirstSerialsModalBtn');
    const closeOutboundFirstSerialsModalFooterBtn = document.getElementById('closeOutboundFirstSerialsModalFooterBtn');

    let firstSerialsViewMode = 'list'; // 'list' or 'barcode'
    let currentOutboundHistoryRow = null;
    let archivedSequenceKeys = new Set();
    let archivedSequenceStack = [];
    let singleModeSeqGroups = new Set();

    // Inject custom animation styles for barcode pulsing border
    if (!document.getElementById('barcode-animation-style')) {
        const style = document.createElement('style');
        style.id = 'barcode-animation-style';
        style.textContent = `
            @keyframes barcodeRedPulse {
                0% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.3); }
                50% { box-shadow: 0 0 16px rgba(239, 68, 68, 0.7); border-color: #ef4444; }
                100% { box-shadow: 0 0 5px rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.3); }
            }
            @keyframes barcodeGreenPulse {
                0% { box-shadow: 0 0 5px rgba(16, 185, 129, 0.2); border-color: rgba(16, 185, 129, 0.3); }
                50% { box-shadow: 0 0 16px rgba(16, 185, 129, 0.7); border-color: #10b981; }
                100% { box-shadow: 0 0 5px rgba(16, 185, 129, 0.2); border-color: rgba(16, 185, 129, 0.3); }
            }
            @keyframes barcodeAmberPulse {
                0% { box-shadow: 0 0 5px rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.3); }
                50% { box-shadow: 0 0 16px rgba(245, 158, 11, 0.7); border-color: #f59e0b; }
                100% { box-shadow: 0 0 5px rgba(245, 158, 11, 0.2); border-color: rgba(245, 158, 11, 0.3); }
            }
            @keyframes barcodePurplePulse {
                0% { box-shadow: 0 0 5px rgba(139, 92, 246, 0.2); border-color: rgba(139, 92, 246, 0.3); }
                50% { box-shadow: 0 0 16px rgba(139, 92, 246, 0.7); border-color: #8b5cf6; }
                100% { box-shadow: 0 0 5px rgba(139, 92, 246, 0.2); border-color: rgba(139, 92, 246, 0.3); }
            }
            @keyframes barcodePinkPulse {
                0% { box-shadow: 0 0 5px rgba(236, 72, 153, 0.2); border-color: rgba(236, 72, 153, 0.3); }
                50% { box-shadow: 0 0 16px rgba(236, 72, 153, 0.7); border-color: #ec4899; }
                100% { box-shadow: 0 0 5px rgba(236, 72, 153, 0.2); border-color: rgba(236, 72, 153, 0.3); }
            }
            @keyframes barcodeCyanPulse {
                0% { box-shadow: 0 0 5px rgba(6, 182, 212, 0.2); border-color: rgba(6, 182, 212, 0.3); }
                50% { box-shadow: 0 0 16px rgba(6, 182, 212, 0.7); border-color: #06b6d4; }
                100% { box-shadow: 0 0 5px rgba(6, 182, 212, 0.2); border-color: rgba(6, 182, 212, 0.3); }
            }
            @keyframes barcodeIndigoPulse {
                0% { box-shadow: 0 0 5px rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.3); }
                50% { box-shadow: 0 0 16px rgba(99, 102, 241, 0.7); border-color: #6366f1; }
                100% { box-shadow: 0 0 5px rgba(99, 102, 241, 0.2); border-color: rgba(99, 102, 241, 0.3); }
            }
            @keyframes barcodeYellowPulse {
                0% { box-shadow: 0 0 5px rgba(234, 179, 8, 0.2); border-color: rgba(234, 179, 8, 0.3); }
                50% { box-shadow: 0 0 16px rgba(234, 179, 8, 0.7); border-color: #eab308; }
                100% { box-shadow: 0 0 5px rgba(234, 179, 8, 0.2); border-color: rgba(234, 179, 8, 0.3); }
            }
            .pulse-theme-0 { animation: barcodeRedPulse 1.8s infinite ease-in-out; border: 1.5px solid #ef4444 !important; }
            .pulse-theme-1 { animation: barcodeGreenPulse 1.8s infinite ease-in-out; border: 1.5px solid #10b981 !important; }
            .pulse-theme-2 { animation: barcodeAmberPulse 1.8s infinite ease-in-out; border: 1.5px solid #f59e0b !important; }
            .pulse-theme-3 { animation: barcodePurplePulse 1.8s infinite ease-in-out; border: 1.5px solid #8b5cf6 !important; }
            .pulse-theme-4 { animation: barcodePinkPulse 1.8s infinite ease-in-out; border: 1.5px solid #ec4899 !important; }
            .pulse-theme-5 { animation: barcodeCyanPulse 1.8s infinite ease-in-out; border: 1.5px solid #06b6d4 !important; }
            .pulse-theme-6 { animation: barcodeIndigoPulse 1.8s infinite ease-in-out; border: 1.5px solid #6366f1 !important; }
            .pulse-theme-7 { animation: barcodeYellowPulse 1.8s infinite ease-in-out; border: 1.5px solid #eab308 !important; }
        `;
        document.head.appendChild(style);
    }

    function renderFirstSerialsModalContent() {
        const body = document.getElementById('outboundFirstSerialsModalBody');
        const toggleBtnText = document.getElementById('btnToggleFirstSerialsViewText');
        if (!outboundFirstSerialsModal || !body || !currentOutboundHistoryRow) return;

        body.innerHTML = '';
        const row = currentOutboundHistoryRow;

        if (!row.serials || row.serials.length === 0) {
            body.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No serials found for this dispatch session.</div>`;
            return;
        }

        // Configure toggle button display
        if (toggleBtnText) {
            toggleBtnText.textContent = firstSerialsViewMode === 'list' ? 'Barcode View' : 'Box List View';
        }

        if (firstSerialsViewMode === 'list') {
            // Group serials by itemName, and find the first serial for each boxNo
            const grouped = {};
            row.serials.forEach(s => {
                if (!s || !s.itemName || s.boxNo === undefined || s.boxNo === null) return;
                const pName = s.itemName;
                const box = parseInt(s.boxNo);
                if (!grouped[pName]) {
                    grouped[pName] = {};
                }
                if (grouped[pName][box] === undefined) {
                    grouped[pName][box] = s.serial;
                }
            });

            // Build HTML
            Object.keys(grouped).forEach(pName => {
                const productHeader = document.createElement('div');
                productHeader.style.margin = '8px 0 4px 0';
                productHeader.innerHTML = `
                    <h4 style="margin: 12px 0 6px 0; color: var(--accent-blue); font-size: 0.95rem; font-weight: 700; border-left: 3px solid var(--accent-blue); padding-left: 8px; text-transform: uppercase; letter-spacing: 0.03em;">
                        ${pName}
                    </h4>
                `;
                body.appendChild(productHeader);

                const grid = document.createElement('div');
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))';
                grid.style.gap = '8px';
                grid.style.marginBottom = '16px';

                const boxMap = grouped[pName];
                // Sort boxes numerically
                const sortedBoxes = Object.keys(boxMap).map(Number).sort((a, b) => a - b);

                sortedBoxes.forEach(box => {
                    const card = document.createElement('div');
                    card.style.background = 'rgba(255, 255, 255, 0.02)';
                    card.style.border = '1px solid var(--border-color)';
                    card.style.padding = '8px 12px';
                    card.style.borderRadius = 'var(--radius-sm)';
                    card.style.display = 'flex';
                    card.style.justifyContent = 'space-between';
                    card.style.alignItems = 'center';
                    card.style.fontSize = '0.85rem';
                    card.style.fontFamily = 'var(--font-mono)';

                    card.innerHTML = `
                        <span style="color: var(--text-muted); font-weight: 600;">Box ${box}:</span>
                        <span style="color: var(--text-primary); font-weight: 700; word-break: break-all;">${boxMap[box]}</span>
                    `;
                    grid.appendChild(card);
                });

                body.appendChild(grid);
            });
        } else {
            // Mode is 'barcode': Gather and group all sequences flats
            const allSequences = [];
            const productNames = Array.from(new Set(row.serials.map(s => s.itemName).filter(Boolean)));
            
            productNames.forEach((pName, pIdx) => {
                const productSerials = row.serials.filter(s => s.itemName === pName);

                // Group by prefix to support mixed model serial formats
                const prefixGroups = {};
                productSerials.forEach(s => {
                    const match = s.serial.match(/^(.*?)(\d+)$/);
                    let prefix = s.serial;
                    let numVal = 0;
                    if (match) {
                        prefix = match[1];
                        numVal = parseInt(match[2], 10);
                    }
                    if (!prefixGroups[prefix]) {
                        prefixGroups[prefix] = [];
                    }
                    prefixGroups[prefix].push({ num: numVal, serial: s.serial, boxNo: s.boxNo });
                });

                // For each prefix, sort and find consecutive sequences
                Object.keys(prefixGroups).forEach((prefix, prefIdx) => {
                    const items = prefixGroups[prefix];
                    items.sort((a, b) => a.num - b.num);

                    // 1. Group items into raw consecutive sequence blocks
                    const rawSeqBlocks = [];
                    let currentSeq = null;
                    items.forEach(item => {
                        if (!currentSeq) {
                            currentSeq = {
                                startSerial: item.serial,
                                startNum: item.num,
                                count: 1,
                                startBox: item.boxNo,
                                endBox: item.boxNo,
                                serials: [item]
                            };
                        } else {
                            if (item.num === currentSeq.startNum + currentSeq.count) {
                                currentSeq.count++;
                                currentSeq.endBox = item.boxNo;
                                currentSeq.serials.push(item);
                            } else {
                                rawSeqBlocks.push(currentSeq);
                                currentSeq = {
                                    startSerial: item.serial,
                                    startNum: item.num,
                                    count: 1,
                                    startBox: item.boxNo,
                                    endBox: item.boxNo,
                                    serials: [item]
                                };
                            }
                        }
                    });
                    if (currentSeq) {
                        rawSeqBlocks.push(currentSeq);
                    }

                    // 2. Expand sequence blocks to 1 PC only if that count level is in singleModeSeqGroups
                    rawSeqBlocks.forEach(seqBlock => {
                        const groupKey = `${pName}_${seqBlock.count}`;
                        const isSingleGroup = singleModeSeqGroups.has(groupKey);

                        if (isSingleGroup && seqBlock.count > 1) {
                            seqBlock.serials.forEach(sItem => {
                                allSequences.push({
                                    key: `${pIdx}_${prefIdx}_${allSequences.length}`,
                                    pName: pName,
                                    startSerial: sItem.serial,
                                    startNum: sItem.num,
                                    count: 1,
                                    startBox: sItem.boxNo,
                                    endBox: sItem.boxNo,
                                    seqGroupKey: groupKey
                                });
                            });
                        } else {
                            allSequences.push({
                                key: `${pIdx}_${prefIdx}_${allSequences.length}`,
                                pName: pName,
                                startSerial: seqBlock.startSerial,
                                startNum: seqBlock.startNum,
                                count: seqBlock.count,
                                startBox: seqBlock.startBox,
                                endBox: seqBlock.endBox,
                                seqGroupKey: groupKey
                            });
                        }
                    });
                });
            });

            // Sort all sequences by Product Name first, and then by count (Total PCs) in ascending order
            allSequences.sort((a, b) => {
                if (a.pName !== b.pName) {
                    return a.pName.localeCompare(b.pName);
                }
                return a.count - b.count;
            });

            // Insert preparation cards whenever the product name or count changes (for count > 1)
            const finalSequences = [];
            let lastProduct = null;
            let lastCount = null;

            allSequences.forEach((seq, index) => {
                if (seq.count > 1 && (seq.pName !== lastProduct || seq.count !== lastCount)) {
                    lastProduct = seq.pName;
                    lastCount = seq.count;

                    // Insert a preparation card
                    finalSequences.push({
                        key: `prep_${index}`,
                        isPrepCard: true,
                        pName: seq.pName,
                        count: seq.count,
                        seqGroupKey: seq.seqGroupKey || `${seq.pName}_${seq.count}`
                    });
                }
                finalSequences.push(seq);
            });

            // Filter unarchived sequences
            const unarchived = finalSequences.filter(seq => !archivedSequenceKeys.has(seq.key));

            if (unarchived.length > 0) {
                // Show ONLY the first unarchived sequence
                const seq = unarchived[0];
                const currentIndex = finalSequences.length - unarchived.length + 1;

                if (seq.isPrepCard) {
                    // Render Preparation Card (White Background, Black Text)
                    const card = document.createElement('div');
                    card.className = 'active-barcode-card';
                    card.style.background = '#ffffff';
                    card.style.border = '2px dashed #94a3b8';
                    card.style.padding = '24px';
                    card.style.borderRadius = 'var(--radius-md)';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.gap = '16px';
                    card.style.color = '#000000';
                    card.style.boxShadow = '0 10px 25px rgba(0,0,0,0.05)';
                    
                    card.innerHTML = `
                        <div style="text-align: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 16px; width: 100%;">
                            <span style="font-size: 0.75rem; color: #64748b; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">
                                NEXT SEQUENCE PREPARATION
                            </span>
                            <h3 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin: 8px 0 4px 0; word-break: break-all;">
                                ${seq.pName}
                            </h3>
                            <div style="font-size: 0.8rem; color: #64748b; font-weight: 600;">
                                Card ${currentIndex} of ${finalSequences.length}
                            </div>
                        </div>

                        <div style="text-align: center; padding: 20px 10px; background: #f8fafc; border-radius: var(--radius-sm); width: 100%; box-sizing: border-box;">
                            <div style="font-size: 2.8rem; font-weight: 900; color: #0f172a; line-height: 1;">
                                ${seq.count} PCs
                            </div>
                            <div style="font-size: 0.85rem; color: #334155; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 8px;">
                                Barcodes Starting
                            </div>
                            <p style="font-size: 0.78rem; color: #64748b; margin: 8px 0 0 0; line-height: 1.4;">
                                Please prepare boxes of <strong>${seq.count} pieces</strong> for this product.
                            </p>
                        </div>

                        <div style="display: flex; gap: 8px; width: 100%; flex-wrap: wrap;">
                            ${currentIndex > 1 ? `
                                <button type="button" class="btn-prev-seq-barcode" style="flex: 1; min-width: 75px; padding: 12px 8px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: var(--radius-sm); color: #475569; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; justify-content: center; gap: 6px;">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 16px; height: 16px; stroke-width: 2.5; color: #475569;">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                                    </svg>
                                    <span>Back</span>
                                </button>
                            ` : ''}
                            ${seq.count > 1 ? `
                                <button type="button" class="btn-skip-to-single-mode" data-groupkey="${escapeHtmlAttr(seq.seqGroupKey)}" data-prepkey="${escapeHtmlAttr(seq.key)}" style="flex: 1.2; min-width: 140px; padding: 12px 8px; background: #fff7ed; border: 1px solid #f97316; border-radius: var(--radius-sm); color: #c2410c; font-weight: 800; font-size: 0.85rem; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; justify-content: center; gap: 6px;" title="Switch this ${seq.count}-PC sequence block to single 1-PC barcode mode">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 16px; height: 16px; stroke-width: 2.5; color: #ea580c;">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <span>Skip Sequence (1 PC Mode)</span>
                                </button>
                            ` : ''}
                            <button type="button" class="btn-archive-seq-barcode" data-key="${seq.key}" style="flex: 1.5; min-width: 140px; padding: 12px 8px; background: #0f172a; border: none; border-radius: var(--radius-sm); color: white; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 16px; height: 16px; stroke-width: 2.5;">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <span>Start ${seq.count} PC Sequence</span>
                            </button>
                        </div>
                    `;
                    body.appendChild(card);

                    // Voice notification to prepare boxes
                    const shortName = seq.pName.split(' ')[0];
                    triggerSpeak(`Prepare, ${seq.count}, pieces sequence, for, ${shortName}`);
                } else {
                    // Configure distinct theme color based on index
                    const themes = [
                        { name: 'Red', color: '#ef4444', class: 'pulse-theme-0' },
                        { name: 'Green', color: '#10b981', class: 'pulse-theme-1' },
                        { name: 'Amber', color: '#f59e0b', class: 'pulse-theme-2' },
                        { name: 'Purple', color: '#8b5cf6', class: 'pulse-theme-3' },
                        { name: 'Pink', color: '#ec4899', class: 'pulse-theme-4' },
                        { name: 'Cyan', color: '#06b6d4', class: 'pulse-theme-5' },
                        { name: 'Indigo', color: '#6366f1', class: 'pulse-theme-6' },
                        { name: 'Yellow', color: '#eab308', class: 'pulse-theme-7' }
                    ];
                    const theme = themes[(currentIndex - 1) % themes.length];

                    // Render active sequence details with blinking pulse border
                    const card = document.createElement('div');
                    card.className = 'active-barcode-card ' + theme.class;
                    card.style.background = 'rgba(255, 255, 255, 0.02)';
                    card.style.padding = '20px';
                    card.style.borderRadius = 'var(--radius-md)';
                    card.style.display = 'flex';
                    card.style.flexDirection = 'column';
                    card.style.gap = '14px';
                    card.style.transition = 'all 0.3s ease';

                    // Display range text and large total count
                    const boxText = seq.startBox === seq.endBox ? `Box ${seq.startBox}` : `Boxes ${seq.startBox} - ${seq.endBox}`;
                    
                    card.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; width: 100%;">
                            <div style="display: flex; flex-direction: column; gap: 4px;">
                                <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em;">
                                    ${seq.pName}
                                </span>
                                <div style="font-size: 1.15rem; font-weight: 800; color: var(--text-primary); font-family: var(--font-mono); word-break: break-all; margin-top: 4px;">
                                    ${seq.startSerial}
                                </div>
                                <div style="font-size: 0.8rem; color: var(--text-muted); font-weight: 600; margin-top: 2px;">
                                    ${boxText} &bull; <span style="color: ${theme.color}; font-weight: 700;">Barcode ${currentIndex} of ${finalSequences.length}</span>
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div style="font-size: 2.2rem; font-weight: 900; color: ${theme.color}; line-height: 1;">
                                    ${seq.count}
                                </div>
                                <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px;">
                                    Total PCs
                                </div>
                            </div>
                        </div>
                        
                        <div style="display: flex; justify-content: center; background: white; padding: 16px; border-radius: var(--radius-sm); margin: 4px 0;">
                            <canvas id="activeQrCanvas" style="width: 160px; height: 160px;"></canvas>
                        </div>

                        <div style="display: flex; gap: 8px; width: 100%; flex-wrap: wrap;">
                            ${currentIndex > 1 ? `
                                <button type="button" class="btn-prev-seq-barcode" style="flex: 1; min-width: 75px; padding: 12px 8px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); border-radius: var(--radius-sm); color: var(--text-secondary); font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; justify-content: center; gap: 6px;">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 16px; height: 16px; stroke-width: 2.5;">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                                    </svg>
                                    <span>Back</span>
                                </button>
                            ` : ''}
                            <button type="button" class="btn-archive-seq-barcode" data-key="${seq.key}" style="flex: 1.5; min-width: 140px; padding: 12px 8px; background: ${theme.color}; border: none; border-radius: var(--radius-sm); color: white; font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; justify-content: center; gap: 6px;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 16px; height: 16px; stroke-width: 2.5;">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                <span>Archive QR Code</span>
                            </button>
                        </div>
                    `;
                    body.appendChild(card);

                    // Render vector QR Code
                    if (window.QRCode) {
                        try {
                            QRCode.toCanvas(document.getElementById('activeQrCanvas'), seq.startSerial, {
                                width: 160,
                                margin: 1
                            });
                        } catch (err) {
                            console.error("QRCode failed for serial: ", seq.startSerial, err);
                        }
                    }
                }
            } else {
                // Show completion card
                body.innerHTML = `
                    <div style="text-align: center; padding: 36px 16px; background: rgba(16, 185, 129, 0.03); border: 1px solid rgba(16, 185, 129, 0.15); border-radius: var(--radius-md); display: flex; flex-direction: column; align-items: center; gap: 12px;">
                        <div style="font-size: 3.2rem; line-height: 1;">🎉</div>
                        <h4 style="margin: 0; color: var(--accent-emerald); font-weight: 800; font-size: 1.1rem; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 8px;">
                            All Barcodes Archived!
                        </h4>
                        <p style="font-size: 0.85rem; color: var(--text-muted); margin: 0; line-height: 1.4; max-width: 320px;">
                            You have successfully archived all sequence barcode cards for this dispatch session.
                        </p>
                        <div style="display: flex; gap: 8px; margin-top: 8px; width: 100%; justify-content: center;">
                            <button type="button" class="btn-prev-seq-barcode" style="padding: 10px 20px; background: rgba(255, 255, 255, 0.05); border: 1px solid var(--border-color); border-radius: var(--radius-sm); color: var(--text-secondary); font-weight: 700; font-size: 0.85rem; cursor: pointer; transition: var(--transition-smooth); display: flex; align-items: center; gap: 6px;">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" style="width: 14px; height: 14px; stroke-width: 2.5;">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
                                </svg>
                                <span>Back</span>
                            </button>
                            <button type="button" id="btnResetBarcodeArchives" style="background: rgba(59, 130, 246, 0.1); border: 1px solid var(--accent-blue); color: var(--accent-blue); padding: 10px 20px; border-radius: var(--radius-sm); font-size: 0.85rem; font-weight: 700; cursor: pointer; transition: var(--transition-smooth);">
                                Reset & View All
                            </button>
                        </div>
                    </div>
                `;
            }
        }
    }

    function showOutboundFirstSerialsModal(row) {
        currentOutboundHistoryRow = row;
        firstSerialsViewMode = 'list'; // Reset view mode to default List view when opened
        archivedSequenceKeys.clear(); // Clear any cached archives
        archivedSequenceStack = [];
        singleModeSeqGroups.clear();
        
        renderFirstSerialsModalContent();
        
        if (outboundFirstSerialsModal) {
            outboundFirstSerialsModal.classList.add('active');
        }
    }

    function closeOutboundFirstSerialsModal() {
        if (outboundFirstSerialsModal) {
            outboundFirstSerialsModal.classList.remove('active');
        }
    }

    if (closeOutboundFirstSerialsModalBtn) {
        closeOutboundFirstSerialsModalBtn.addEventListener('click', closeOutboundFirstSerialsModal);
    }
    if (closeOutboundFirstSerialsModalFooterBtn) {
        closeOutboundFirstSerialsModalFooterBtn.addEventListener('click', closeOutboundFirstSerialsModal);
    }

    const btnToggleFirstSerialsView = document.getElementById('btnToggleFirstSerialsView');
    if (btnToggleFirstSerialsView) {
        btnToggleFirstSerialsView.addEventListener('click', () => {
            firstSerialsViewMode = firstSerialsViewMode === 'list' ? 'barcode' : 'list';
            renderFirstSerialsModalContent();
        });
    }

    const outboundFirstSerialsModalBody = document.getElementById('outboundFirstSerialsModalBody');
    if (outboundFirstSerialsModalBody) {
        outboundFirstSerialsModalBody.addEventListener('click', (e) => {
            const skipSingleBtn = e.target.closest('.btn-skip-to-single-mode');
            if (skipSingleBtn) {
                const groupKey = skipSingleBtn.getAttribute('data-groupkey');
                const prepKey = skipSingleBtn.getAttribute('data-prepkey');
                if (groupKey) {
                    singleModeSeqGroups.add(groupKey);
                    if (prepKey) {
                        archivedSequenceKeys.add(prepKey);
                        archivedSequenceStack.push(prepKey);
                    }
                    renderFirstSerialsModalContent();
                }
                return;
            }

            const archiveBtn = e.target.closest('.btn-archive-seq-barcode');
            if (archiveBtn) {
                const key = archiveBtn.getAttribute('data-key');
                archivedSequenceKeys.add(key);
                archivedSequenceStack.push(key);
                renderFirstSerialsModalContent();
                return;
            }

            const prevBtn = e.target.closest('.btn-prev-seq-barcode');
            if (prevBtn) {
                const lastKey = archivedSequenceStack.pop();
                if (lastKey) {
                    archivedSequenceKeys.delete(lastKey);
                }
                renderFirstSerialsModalContent();
                return;
            }
            
            const resetBtn = e.target.closest('#btnResetBarcodeArchives');
            if (resetBtn) {
                archivedSequenceKeys.clear();
                archivedSequenceStack = [];
                singleModeSeqGroups.clear();
                renderFirstSerialsModalContent();
                return;
            }
        });
    }

    function restoreSidebarCollapsedState() {
        const isCollapsed = localStorage.getItem('wms_sidebar_collapsed') === 'true';
        const appContainer = document.querySelector('.app-container');
        if (isCollapsed && appContainer) {
            appContainer.classList.add('sidebar-collapsed');
        }
    }

    function navigateToTab(tabId) {
        const link = document.getElementById(tabId);
        if (link) {
            link.click();
        }
    }

    // Keyboard navigation shortcuts: S = Stock, I = Inbound, O = Outbound, Y = Inventory, M = MIS Report
    document.addEventListener('keydown', (e) => {
        const activeNode = document.activeElement;
        const outboundConfigModal = document.getElementById('outboundConfigModal');
        const isConfigModalActive = outboundConfigModal && outboundConfigModal.classList.contains('active');
        
        // Handle "p" key paste shortcut when an input in the Outbound Config Modal is focused and empty
        if (activeNode && isConfigModalActive) {
            const tagName = activeNode.tagName.toLowerCase();
            if (tagName === 'input' && (activeNode.id === 'configShopName' || activeNode.id === 'configInvoiceNo')) {
                if (e.key.toLowerCase() === 'p' && activeNode.value === '') {
                    e.preventDefault();
                    navigator.clipboard.readText().then(text => {
                        if (text) {
                            activeNode.value = text;
                            activeNode.dispatchEvent(new Event('input')); // trigger validation updates
                        } else {
                            activeNode.value = e.key;
                        }
                    }).catch(err => {
                        activeNode.value = e.key;
                    });
                    return;
                }
            }
        }

        // Ignore global hotkeys if the user is typing inside any form field
        if (activeNode) {
            const tagName = activeNode.tagName.toLowerCase();
            if (tagName === 'input' || tagName === 'textarea' || tagName === 'select' || activeNode.isContentEditable) {
                return;
            }
        }
        
        // Handle custom hotkeys inside Outbound Config Modal (when open but inputs not focused)
        if (isConfigModalActive) {
            const key = e.key.toLowerCase();
            if (key === 's') {
                e.preventDefault();
                const shopNameInput = document.getElementById('configShopName');
                const invoiceNoInput = document.getElementById('configInvoiceNo');
                if (shopNameInput && invoiceNoInput) {
                    // Toggle focus between the inputs
                    if (activeNode === shopNameInput) {
                        invoiceNoInput.focus();
                        invoiceNoInput.select();
                    } else {
                        shopNameInput.focus();
                        shopNameInput.select();
                    }
                }
            } else if (key === 'l') {
                e.preventDefault();
                const form = document.getElementById('outboundConfigForm');
                if (form) {
                    form.requestSubmit(); // trigger validation and submission
                }
            }
            return; // block other navigation hotkeys while modal is active
        }

        // Skip shortcuts if other alert/warning modals are active
        if (document.querySelector('.modal.active') || document.querySelector('.sku-warning-modal.active')) {
            return;
        }

        const key = e.key.toLowerCase();
        if (key === 's') {
            e.preventDefault();
            navigateToTab('navOverview');
        } else if (key === 'i') {
            e.preventDefault();
            navigateToTab('navInbound');
        } else if (key === 'o') {
            e.preventDefault();
            navigateToTab('navOutbound');
        } else if (key === 'y') {
            e.preventDefault();
            navigateToTab('navInventory');
        } else if (key === 'm') {
            e.preventDefault();
            navigateToTab('navMisReport');
        } else if (key === 'd') {
            e.preventDefault();
            navigateToTab('navDamage');
        } else if (key === 'g') {
            e.preventDefault();
            navigateToTab('navOda');
        } else if (key === 'n') {
            // "o" tabane ke bad (if Outbound section is active), pressing "n" starts a New Outbound Session
            const sectionOutbound = document.getElementById('sectionOutbound');
            if (sectionOutbound && sectionOutbound.style.display !== 'none') {
                e.preventDefault();
                const startBtn = document.getElementById('startOutboundSessionBtn');
                if (startBtn && startBtn.style.display !== 'none' && !startBtn.disabled) {
                    startBtn.click();
                }
            }
        } else if (key === 'e') {
            // If Outbound tab is active, pressing "e" ends the active Outbound Session
            const sectionOutbound = document.getElementById('sectionOutbound');
            if (sectionOutbound && sectionOutbound.style.display !== 'none') {
                e.preventDefault();
                const endBtn = document.getElementById('endOutboundSessionBtn');
                if (endBtn && endBtn.style.display !== 'none' && !endBtn.disabled) {
                    endBtn.click();
                }
            }
        }
    });

    // -------------------------------------------------------------
    // DAMAGE REGISTER MODULE
    // -------------------------------------------------------------
    function getDamageRecords() {
        if (cachedDamageRecords !== null) {
            return cachedDamageRecords;
        }
        const data = localStorage.getItem('wms_damage_records');
        try {
            cachedDamageRecords = data ? JSON.parse(data) : [];
            return cachedDamageRecords;
        } catch (e) {
            cachedDamageRecords = [];
            return cachedDamageRecords;
        }
    }

    function saveDamageRecords(records) {
        cachedDamageRecords = records;
        damageSerialsFastSet = null;
        localStorage.setItem('wms_damage_records', JSON.stringify(records));
        cachedProductStockMap = null;
        firebaseSet('damage_records', records);
    }

    function markItemAsDamaged(serial) {
        const cleanSerial = serial.trim().toUpperCase();
        if (!cleanSerial) return;

        // Verify if it's already marked as damaged (O(1) Set lookup)
        const isDup = getDamageSerialsFastSet().has(cleanSerial);
        if (isDup) {
            alert(`Error: Serial number "${cleanSerial}" is already marked as damaged!`);
            return;
        }

        // Verify if serial number exists in Inbound logs (O(1) Map lookup)
        const foundInboundLog = getInboundSerialLogMap().get(cleanSerial);
        let foundInbound = null;
        if (foundInboundLog && foundInboundLog.serials) {
            const sObj = foundInboundLog.serials.find(s => s.serial && s.serial.trim().toUpperCase() === cleanSerial);
            if (sObj) {
                foundInbound = {
                    itemName: sObj.itemName || foundInboundLog.item,
                    inboundLogId: foundInboundLog.id
                };
            }
        }

        if (!foundInbound) {
            alert(`Error: Serial number "${cleanSerial}" not found in Inbound logs. Damage registration rejected!`);
            return;
        }

        // Add to damage records
        const records = getDamageRecords();
        records.push({
            serial: cleanSerial,
            itemName: foundInbound.itemName,
            inboundLogId: foundInbound.inboundLogId,
            timestamp: new Date().toLocaleString()
        });

        saveDamageRecords(records);
        renderDamageUI();
        renderInventoryPanel();
        renderOrderQueueUI();

        alert(`Success: Product "${foundInbound.itemName}" with Serial "${cleanSerial}" marked as DAMAGED and removed from stock.`);
    }

    function removeDamageRecord(serial) {
        if (!confirm(`Are you sure you want to restore serial number "${serial}" back to available stock?`)) return;
        
        let records = getDamageRecords();
        records = records.filter(r => r.serial.trim().toUpperCase() !== serial.trim().toUpperCase());
        saveDamageRecords(records);

        renderDamageUI();
        renderInventoryPanel();
        renderOrderQueueUI();
    }

    function renderDamageUI() {
        const records = getDamageRecords();
        const body = document.getElementById('damageTableBody');
        if (!body) return;

        body.innerHTML = '';
        if (records.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">No damaged items recorded.</td>
                </tr>
            `;
            return;
        }

        // Render reversed so latest damaged items appear first
        records.slice().reverse().forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 10px 8px; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary);">${r.timestamp}</td>
                <td style="padding: 10px 8px; font-weight: 700; color: var(--text-primary);">${r.itemName}</td>
                <td style="padding: 10px 8px; font-family: var(--font-mono); font-weight: 700; color: var(--accent-rose);">${r.serial}</td>
                <td style="padding: 10px 8px; text-align: right;">
                    <button class="btn-restore-damaged btn-primary" data-serial="${r.serial}" style="background: rgba(16, 185, 129, 0.1); border: 1px solid var(--accent-emerald); color: var(--accent-emerald); padding: 4px 8px; border-radius: var(--radius-sm); font-size: 0.72rem; font-weight: 700; cursor: pointer; border-style: solid;">
                        Restore Stock
                    </button>
                </td>
            `;
            
            tr.querySelector('.btn-restore-damaged').addEventListener('click', (e) => {
                const serial = e.currentTarget.getAttribute('data-serial');
                removeDamageRecord(serial);
            });

            body.appendChild(tr);
        });
    }

    // Damage input scanner triggers
    const damageSerialInput = document.getElementById('damageSerialInput');
    const btnMarkAsDamaged = document.getElementById('btnMarkAsDamaged');

    if (damageSerialInput) {
        damageSerialInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const val = damageSerialInput.value.trim();
                if (val) {
                    markItemAsDamaged(val);
                    damageSerialInput.value = '';
                }
            }
        });
    }

    if (btnMarkAsDamaged && damageSerialInput) {
        btnMarkAsDamaged.addEventListener('click', () => {
            const val = damageSerialInput.value.trim();
            if (val) {
                markItemAsDamaged(val);
                damageSerialInput.value = '';
            }
        });
    }

    // -------------------------------------------------------------
    // PINCODE DISTANCE CALCULATOR FROM BHIWANDI (421302)
    // -------------------------------------------------------------
    const PINCODE_PREFIX_COORDS = {
        // MAHARASHTRA & GOA (Zone 4)
        "400": [18.9388, 72.8353], // Mumbai South
        "401": [19.3919, 72.8397], // Thane Rural / Palghar / Vasai
        "402": [18.4646, 72.8789], // Raigad / Alibag / Roha
        "403": [15.2993, 74.1240], // Goa
        "410": [18.7557, 73.4091], // Lonavala / Talegaon / Khopoli
        "411": [18.5204, 73.8567], // Pune City
        "412": [18.4529, 73.9634], // Pune Rural / Hadapsar / Shirur
        "413": [17.6599, 75.9064], // Solapur / Osmanabad / Pandharpur / Baramati
        "414": [19.0948, 74.7480], // Ahmednagar
        "415": [17.6805, 74.0183], // Satara / Karad / Chiplun
        "416": [16.7050, 74.2433], // Kolhapur / Sangli / Miraj / Ratnagiri
        "421": [19.2968, 73.0631], // Bhiwandi / Kalyan / Dombivli / Ulhasnagar
        "422": [19.9975, 73.7898], // Nashik
        "423": [20.5579, 74.5089], // Malegaon / Manmad
        "424": [20.9042, 74.7749], // Dhule
        "425": [21.0077, 75.5626], // Jalgaon / Bhusawal
        "431": [19.8762, 75.3433], // Chhatrapati Sambhajinagar (Aurangabad) / Nanded / Latur
        "440": [21.1458, 79.0882], // Nagpur City
        "441": [21.1833, 79.2500], // Nagpur Rural / Bhandara / Gondia
        "442": [20.7453, 78.6022], // Wardha / Chandrapur
        "443": [20.5294, 76.1843], // Buldhana
        "444": [20.9374, 77.7796], // Amravati / Akola
        "445": [20.3888, 78.1204], // Yavatmal

        // GUJARAT (Zone 3)
        "360": [22.3039, 70.8022], // Rajkot
        "361": [22.4707, 70.0577], // Jamnagar
        "362": [21.5222, 70.4579], // Junagadh
        "363": [22.7215, 71.6384], // Surendranagar
        "364": [21.7645, 72.1519], // Bhavnagar
        "365": [21.6032, 71.2221], // Amreli
        "370": [23.2420, 69.6669], // Bhuj / Kutch
        "380": [23.0225, 72.5714], // Ahmedabad
        "382": [23.2156, 72.6369], // Gandhinagar
        "383": [23.5977, 72.9698], // Himatnagar
        "384": [23.6000, 72.4000], // Mehsana / Patan
        "385": [24.1724, 72.4346], // Palanpur
        "387": [22.6916, 72.8634], // Nadiad / Anand
        "388": [22.5645, 72.9289], // Anand
        "390": [22.3072, 73.1812], // Vadodara
        "391": [22.4000, 73.3000], // Vadodara Rural
        "392": [21.7051, 72.9959], // Bharuch
        "393": [21.6264, 73.0152], // Ankleshwar
        "394": [21.2000, 72.8800], // Surat Suburbs
        "395": [21.1702, 72.8311], // Surat City
        "396": [20.6100, 72.9300], // Valsad / Vapi / Navsari

        // RAJASTHAN (Zone 3)
        "302": [26.9124, 75.7873], // Jaipur
        "303": [26.8500, 75.9000], // Jaipur Rural
        "305": [26.4499, 74.6399], // Ajmer
        "313": [24.5854, 73.7125], // Udaipur
        "324": [25.2138, 75.8648], // Kota
        "334": [28.0229, 73.3119], // Bikaner
        "342": [26.2389, 73.0243], // Jodhpur

        // MP & CHHATTISGARH (Zone 4)
        "452": [22.7196, 75.8577], // Indore
        "456": [23.1765, 75.7885], // Ujjain
        "462": [23.2599, 77.4126], // Bhopal
        "474": [26.2183, 78.1828], // Gwalior
        "482": [23.1815, 79.9864], // Jabalpur
        "492": [21.2514, 81.6296], // Raipur

        // DELHI NCR, HARYANA, PUNJAB, UP (Zone 1 & 2)
        "110": [28.6139, 77.2090], // Delhi
        "121": [28.4089, 77.3178], // Faridabad
        "122": [28.4595, 77.0266], // Gurgaon
        "132": [29.6857, 76.9905], // Karnal
        "141": [30.9010, 75.8573], // Ludhiana
        "143": [31.6340, 74.8723], // Amritsar
        "160": [30.7333, 76.7794], // Chandigarh
        "201": [28.5355, 77.3910], // Noida / Ghaziabad
        "208": [26.4499, 80.3319], // Kanpur
        "226": [26.8467, 80.9462], // Lucknow
        "282": [27.1767, 78.0081], // Agra

        // SOUTH INDIA (Zone 5 & 6)
        "500": [17.3850, 78.4867], // Hyderabad
        "520": [16.5062, 80.6480], // Vijayawada
        "530": [17.6868, 83.2185], // Visakhapatnam
        "560": [12.9716, 77.5946], // Bengaluru
        "570": [12.2958, 76.6394], // Mysore
        "575": [12.9141, 74.8560], // Mangalore
        "580": [15.3647, 75.1240], // Hubli
        "590": [15.8497, 74.4977], // Belgaum
        "600": [13.0827, 80.2707], // Chennai
        "620": [10.7905, 78.7047], // Trichy
        "625": [9.9252, 78.1198],  // Madurai
        "641": [11.0168, 76.9558], // Coimbatore
        "673": [11.2588, 75.7804], // Kozhikode / Calicut
        "678": [10.7867, 76.6548], // Palakkad
        "682": [9.9312, 76.2673],  // Kochi / Ernakulam
        "695": [8.5241, 76.9366],  // Trivandrum

        // EAST INDIA (Zone 7 & 8)
        "700": [22.5726, 88.3639], // Kolkata
        "751": [20.2961, 85.8245], // Bhubaneswar
        "781": [26.1445, 91.7362], // Guwahati
        "800": [25.5941, 85.1376], // Patna
        "834": [23.3441, 85.3096], // Ranchi

        // Fallback 2-digit defaults
        "11": [28.6139, 77.2090], "12": [28.4595, 77.0266], "13": [29.6857, 76.9905], "14": [30.9010, 75.8573],
        "15": [30.2110, 74.9455], "16": [30.7333, 76.7794], "17": [31.1048, 77.1734], "18": [32.7266, 74.8570],
        "19": [34.0837, 74.7973], "20": [28.5355, 77.3910], "21": [25.4358, 81.8463], "22": [26.8467, 80.9462],
        "23": [25.3176, 82.9739], "24": [28.9845, 77.7064], "25": [29.4727, 77.7085], "26": [29.2183, 79.5130],
        "27": [26.7606, 83.3732], "28": [27.1767, 78.0081], "30": [26.9124, 75.7873], "31": [24.5854, 73.7125],
        "32": [25.2138, 75.8648], "33": [28.0229, 73.3119], "34": [26.2389, 73.0243], "36": [22.3039, 70.8022],
        "37": [23.2420, 69.6669], "38": [23.0225, 72.5714], "39": [21.1702, 72.8311], "40": [19.0760, 72.8777],
        "41": [18.5204, 73.8567], "42": [19.9975, 73.7898], "43": [19.8762, 75.3433], "44": [21.1458, 79.0882],
        "45": [22.7196, 75.8577], "46": [23.2599, 77.4126], "47": [26.2183, 78.1828], "48": [23.1815, 79.9864],
        "49": [21.2514, 81.6296], "50": [17.3850, 78.4867], "51": [13.6288, 79.4192], "52": [16.5062, 80.6480],
        "53": [17.6868, 83.2185], "56": [12.9716, 77.5946], "57": [12.9141, 74.8560], "58": [15.3647, 75.1240],
        "59": [15.8497, 74.4977], "60": [13.0827, 80.2707], "61": [10.7905, 78.7047], "62": [9.9252, 78.1198],
        "63": [12.9165, 79.1325], "64": [11.0168, 76.9558], "67": [10.7867, 76.6548], "68": [9.9312, 76.2673],
        "69": [8.5241, 76.9366], "70": [22.5726, 88.3639], "71": [23.2324, 87.8615], "72": [22.4257, 87.3199],
        "73": [26.7271, 88.3953], "74": [24.0983, 88.2514], "75": [20.2961, 85.8245], "76": [19.3149, 84.7941],
        "77": [21.4669, 83.9812], "78": [26.1445, 91.7362], "79": [23.8315, 91.2868], "80": [25.5941, 85.1376],
        "81": [25.2425, 86.9842], "82": [24.7914, 85.0002], "83": [23.3441, 85.3096], "84": [26.1542, 85.8918],
        "85": [25.7711, 87.4822]
    };

    // -------------------------------------------------------------
    // PINTOPINDISTANCE.TOOLS API DISTANCE ENGINE (BHIWANDI 421302)
    // Direct integration with pintopindistance.tools API & 1.35x GST Formula
    // -------------------------------------------------------------
    const BHIWANDI_LAT = 19.2968;
    const BHIWANDI_LNG = 73.0631;
    const GST_PIN_DISTANCE_FACTOR = 1.35; // pintopindistance.tools official factor

    const pinToPinApiCache = new Map();

    function calculateDistanceKm(destPincode) {
        if (!destPincode) return null;
        const pinStr = String(destPincode).trim().replace(/\D/g, '');
        if (pinStr.length !== 6) return null;

        const prefix3 = pinStr.substring(0, 3);
        if (prefix3 === '421') return 15; // Local Bhiwandi/Kalyan
        if (prefix3 === '400' || prefix3 === '401') return 35; // Thane/Mumbai

        let coords = pinToPinApiCache.get(pinStr);

        if (!coords) {
            const prefix2 = pinStr.substring(0, 2);
            coords = PINCODE_PREFIX_COORDS[prefix3] || PINCODE_PREFIX_COORDS[prefix2];
        }

        if (!coords) return null;

        const [lat2, lon2] = coords;
        const R = 6371; // Earth radius in km
        const dLat = (lat2 - BHIWANDI_LAT) * Math.PI / 180;
        const dLon = (lon2 - BHIWANDI_LNG) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(BHIWANDI_LAT * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        const airDistance = R * c;
        
        // Exact pintopindistance.tools GST distance formula
        return Math.round(airDistance * GST_PIN_DISTANCE_FACTOR);
    }

    // Dynamic pintopindistance.tools API Fetcher
    async function fetchLiveDistanceKm(destPincode, onResult) {
        if (!destPincode) return null;
        const pinStr = String(destPincode).trim().replace(/\D/g, '');
        if (pinStr.length !== 6) return null;

        const instantKm = calculateDistanceKm(pinStr);
        if (onResult && instantKm) onResult(instantKm);

        try {
            // Call official pintopindistance.tools API endpoint
            const res = await fetch("https://pintopindistance.tools/api/get-pin.php", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ from: "421302", to: pinStr })
            });

            if (res.ok) {
                const data = await res.json();
                if (data && data.from && data.to) {
                    const [lat1, lon1] = data.from;
                    const [lat2, lon2] = data.to;
                    pinToPinApiCache.set(pinStr, [lat2, lon2]);

                    const R = 6371;
                    const dLat = (lat2 - lat1) * Math.PI / 180;
                    const dLon = (lon2 - lon1) * Math.PI / 180;
                    const a = Math.sin(dLat / 2) ** 2 +
                              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                              Math.sin(dLon / 2) ** 2;
                    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
                    const airDistance = R * c;
                    const gstDistance = Math.round(airDistance * 1.35);

                    if (onResult && gstDistance) {
                        onResult(gstDistance);
                    }
                    return gstDistance;
                }
            }
        } catch (err) {
            console.log("pintopindistance.tools API fallback:", err);
        }

        return instantKm;
    }

    // -------------------------------------------------------------
    // -------------------------------------------------------------
    // ODA REGISTER MODULE (Memory Cached, Cumulative & File History)
    // -------------------------------------------------------------
    let pendingUploadedOdaRecords = [];
    let pendingUploadedFileName = '';
    let memoryOdaRecords = []; // Flat list of {pincode, courier, remark, fileId, fileName}
    let memoryOdaFilesHistory = []; // List of {fileId, fileName, uploadTime, recordsCount, records}
    let memoryOdaMap = new Map(); // Fast Map: pincode -> array of {courier, remark, fileName}

    function updateOdaMemoryCache(recordsData, filesHistoryData) {
        memoryOdaRecords = [];
        memoryOdaMap.clear();

        if (Array.isArray(filesHistoryData)) {
            memoryOdaFilesHistory = filesHistoryData;
        } else {
            memoryOdaFilesHistory = [];
        }

        if (Array.isArray(recordsData)) {
            recordsData.forEach(r => {
                let pincode = '';
                let courier = '';
                let remark = '';
                let fileId = '';
                let fileName = '';

                if (Array.isArray(r)) {
                    pincode = String(r[0] || '').trim();
                    courier = String(r[1] || '').trim();
                    remark = String(r[2] || '').trim();
                    fileId = String(r[3] || '').trim();
                    fileName = String(r[4] || '').trim();
                } else if (r && typeof r === 'object') {
                    pincode = String(r.pincode || '').trim();
                    courier = String(r.courier || '').trim();
                    remark = String(r.remark || '').trim();
                    fileId = String(r.fileId || '').trim();
                    fileName = String(r.fileName || '').trim();
                }

                if (pincode) {
                    const record = { pincode, courier, remark, fileId, fileName };
                    memoryOdaRecords.push(record);
                    if (!memoryOdaMap.has(pincode)) {
                        memoryOdaMap.set(pincode, []);
                    }
                    memoryOdaMap.get(pincode).push(record);
                }
            });
        }
        console.log(`WMS Cache: ODA loaded with ${memoryOdaRecords.length} records across ${memoryOdaFilesHistory.length} files.`);
    }

    function getOdaRecords() {
        return memoryOdaRecords;
    }

    function saveOdaData(records, filesHistory) {
        // Compress records structure: [ [pincode, courier, remark, fileId, fileName], ... ]
        const compressedRecords = records.map(r => [r.pincode, r.courier, r.remark, r.fileId || '', r.fileName || '']);
        
        try {
            localStorage.setItem('wms_oda_records', JSON.stringify(compressedRecords));
        } catch (e) {
            console.warn("LocalStorage quota reached for full ODA records array. Maintained in RAM cache & Firebase sync.", e);
        }

        try {
            localStorage.setItem('wms_oda_files_history', JSON.stringify(filesHistory));
        } catch (e) {
            console.warn("LocalStorage quota reached for ODA files history.", e);
        }

        updateOdaMemoryCache(compressedRecords, filesHistory);

        firebaseSet('oda_records', compressedRecords);
        firebaseSet('oda_files_history', filesHistory);
    }

    function isOdaRemark(remark) {
        const text = String(remark || '').toLowerCase().trim();
        if (text.includes('non-oda') || text.includes('non oda') || text.includes('no-oda') || text.includes('no_oda') || text.includes('not oda')) {
            return false;
        }
        return text.includes('oda') || text.includes('out of delivery') || text === 'yes' || text.includes('out-of-delivery') || text.includes('out of area');
    }

    function getMultiCourierOdaStatus(pincode) {
        const cleanPin = String(pincode || '').trim().replace(/\D/g, '');
        if (!cleanPin) {
            return {
                hasRecords: false,
                isAnyOda: false,
                summaryText: 'No Pincode',
                courierStatuses: [],
                badgeHtml: `<span style="color: var(--text-muted); font-size: 0.75rem;">No Pincode</span>`
            };
        }

        const matched = memoryOdaMap.get(cleanPin) || [];
        if (matched.length === 0) {
            return {
                hasRecords: false,
                isAnyOda: false,
                summaryText: 'Normal Delivery',
                courierStatuses: [],
                badgeHtml: `<span style="background: rgba(16, 185, 129, 0.1); color: var(--accent-emerald); border: 1px solid var(--accent-emerald); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; text-transform: uppercase;">🟢 Normal</span>`
            };
        }

        const courierStatuses = matched.map(m => {
            const oda = isOdaRemark(m.remark);
            return {
                courier: m.courier || 'Courier',
                remark: m.remark || (oda ? 'ODA' : 'Normal'),
                isOda: oda,
                fileName: m.fileName || ''
            };
        });

        const isAnyOda = courierStatuses.some(c => c.isOda);
        const summaryText = courierStatuses.map(c => `${c.courier}: ${c.isOda ? '🔴 ODA' : '🟢 Normal'}`).join(' | ');

        const badgeHtml = courierStatuses.map(c => {
            return c.isOda
                ? `<span style="background: rgba(244, 63, 94, 0.15); color: var(--accent-rose); border: 1px solid var(--accent-rose); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;">🔴 ${escapeHtml(c.courier)}: ODA</span>`
                : `<span style="background: rgba(16, 185, 129, 0.1); color: var(--accent-emerald); border: 1px solid var(--accent-emerald); padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;">🟢 ${escapeHtml(c.courier)}: Normal</span>`;
        }).join(' ');

        return {
            hasRecords: true,
            isAnyOda: isAnyOda,
            summaryText: summaryText,
            courierStatuses: courierStatuses,
            badgeHtml: badgeHtml
        };
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function renderOdaUI() {
        // 1. Update Record & File Counts
        const countSpan = document.getElementById('odaRecordsCount');
        if (countSpan) countSpan.textContent = memoryOdaRecords.length;

        const filesCountSpan = document.getElementById('odaFilesHistoryCount');
        if (filesCountSpan) filesCountSpan.textContent = memoryOdaFilesHistory.length;

        // 2. Render Uploaded ODA Files History Table
        const filesBody = document.getElementById('odaFilesHistoryTableBody');
        if (filesBody) {
            filesBody.innerHTML = '';
            if (memoryOdaFilesHistory.length === 0) {
                filesBody.innerHTML = `
                    <tr>
                        <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">
                            No ODA files uploaded yet. Upload a file above to build your active database.
                        </td>
                    </tr>
                `;
            } else {
                memoryOdaFilesHistory.forEach(file => {
                    const tr = document.createElement('tr');
                    tr.style.borderBottom = '1px solid var(--border-color)';
                    tr.innerHTML = `
                        <td style="padding: 10px 12px; font-weight: 700; color: var(--text-primary);">${escapeHtml(file.fileName)}</td>
                        <td style="padding: 10px 12px; color: var(--text-secondary); font-size: 0.82rem;">${escapeHtml(file.uploadTime)}</td>
                        <td style="padding: 10px 12px; font-weight: 700; color: var(--accent-emerald); font-family: var(--font-mono);">${file.recordsCount} Pincodes</td>
                        <td style="padding: 10px 12px; text-align: right;">
                            <div style="display: flex; gap: 8px; justify-content: flex-end;">
                                <button type="button" class="btn-download-oda-file" data-file-id="${escapeHtmlAttr(file.fileId)}" style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); color: var(--accent-blue); padding: 6px 12px; font-size: 0.78rem; font-weight: 700; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    📥 Download
                                </button>
                                <button type="button" class="btn-delete-oda-file" data-file-id="${escapeHtmlAttr(file.fileId)}" style="background: rgba(244, 63, 94, 0.1); border: 1px solid rgba(244, 63, 94, 0.3); color: var(--accent-rose); padding: 6px 12px; font-size: 0.78rem; font-weight: 700; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; gap: 4px;">
                                    🗑️ Delete
                                </button>
                            </div>
                        </td>
                    `;
                    filesBody.appendChild(tr);
                });
            }
        }

        // 3. Render Active ODA Database Table
        const searchInput = document.getElementById('odaSearchInput');
        const filterText = searchInput ? searchInput.value.trim().toLowerCase() : '';
        
        const body = document.getElementById('odaTableBody');
        if (!body) return;
        body.innerHTML = '';
        
        let filtered = memoryOdaRecords;
        if (filterText) {
            filtered = memoryOdaRecords.filter(r => {
                return r.pincode.includes(filterText) || 
                       r.courier.toLowerCase().includes(filterText) ||
                       r.remark.toLowerCase().includes(filterText) ||
                       (r.fileName && r.fileName.toLowerCase().includes(filterText));
            });
        }
        
        if (filtered.length === 0) {
            body.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">
                        ${memoryOdaRecords.length === 0 ? 'No ODA pincode records loaded. Please upload a file above.' : 'No records match search query.'}
                    </td>
                </tr>
            `;
            return;
        }
        
        const displayLimit = 200;
        const displayList = filtered.slice(0, displayLimit);
        
        displayList.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="padding: 10px 12px; font-family: var(--font-mono); font-weight: 700; color: var(--text-primary);">${r.pincode}</td>
                <td style="padding: 10px 12px; color: var(--text-secondary);">${escapeHtml(r.courier)}</td>
                <td style="padding: 10px 12px;"><span style="color: ${isOdaRemark(r.remark) ? 'var(--accent-rose)' : 'var(--accent-emerald)'}; font-weight: 700;">${escapeHtml(r.remark)}</span></td>
                <td style="padding: 10px 12px; color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(r.fileName || 'General')}</td>
            `;
            body.appendChild(tr);
        });
        
        if (filtered.length > displayLimit) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td colspan="4" style="text-align: center; color: var(--text-muted); font-size: 0.75rem; font-style: italic; padding: 12px 8px;">
                    Showing first ${displayLimit} of ${filtered.length} matching pincode records. Use search above to narrow down.
                </td>
            </tr>
            `;
            body.appendChild(tr);
        }
    }

    function handleOdaFileUpload(file) {
        pendingUploadedFileName = file.name || 'ODA_Sheet.xlsx';
        
        let derivedCourier = 'Generic';
        if (file.name) {
            const cleanName = file.name.split('.')[0]
                .replace(/[-_]oda[-_]?/gi, ' ')
                .replace(/[-_]pincodes?[-_]?/gi, ' ')
                .replace(/[-_]list[-_]?/gi, ' ')
                .trim();
            if (cleanName) derivedCourier = cleanName;
        }

        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = e.target.result;
                let workbook;
                if (file.name.endsWith('.csv')) {
                    const text = new TextDecoder("utf-8").decode(data);
                    workbook = XLSX.read(text, { type: 'string' });
                } else {
                    const bytes = new Uint8Array(data);
                    workbook = XLSX.read(bytes, { type: 'array' });
                }
                
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false });
                
                if (!jsonData || jsonData.length === 0) {
                    alert("The uploaded sheet appears to be empty.");
                    return;
                }
                
                // 1. Smart Header Row Detection (scan first 10 rows for keywords)
                let headerRowIdx = 0;
                let maxMatchedKeywords = 0;
                for (let r = 0; r < Math.min(jsonData.length, 10); r++) {
                    const row = jsonData[r];
                    if (!row || !Array.isArray(row)) continue;
                    const rowText = row.map(cell => String(cell || '').toLowerCase()).join(' ');
                    let score = 0;
                    if (rowText.includes('pin')) score += 2;
                    if (rowText.includes('pincode') || rowText.includes('pin code') || rowText.includes('postal')) score += 3;
                    if (rowText.includes('courier') || rowText.includes('carrier')) score += 2;
                    if (rowText.includes('remark') || rowText.includes('oda') || rowText.includes('status')) score += 2;
                    if (score > maxMatchedKeywords) {
                        maxMatchedKeywords = score;
                        headerRowIdx = r;
                    }
                }

                const headers = (jsonData[headerRowIdx] || []).map(h => String(h || '').trim().toLowerCase());
                
                // 2. Comprehensive Column Index Identification
                let courierIdx = headers.findIndex(h => h.includes('courier') || h.includes('carrier') || h.includes('partner') || h.includes('provider') || h.includes('vendor'));
                let pincodeIdx = headers.findIndex(h => h.includes('pincode') || h.includes('pin_code') || h.includes('pin code') || h.includes('postal') || h.includes('zip') || h === 'pin' || h.includes('dest pin') || h.includes('destination pin'));
                let remarkIdx = headers.findIndex(h => h.includes('remark') || h.includes('oda') || h.includes('status') || h.includes('servic') || h.includes('zone'));
                
                // 3. Fallback Auto-Discovery: Inspect first 30 data rows for 6-digit pincode numbers!
                if (pincodeIdx === -1) {
                    const colScores = {};
                    for (let r = headerRowIdx + 1; r < Math.min(jsonData.length, headerRowIdx + 30); r++) {
                        const row = jsonData[r];
                        if (!row || !Array.isArray(row)) continue;
                        row.forEach((cell, cIdx) => {
                            const digits = String(cell || '').trim().replace(/\D/g, '');
                            if (digits.length === 6) {
                                colScores[cIdx] = (colScores[cIdx] || 0) + 1;
                            }
                        });
                    }
                    let bestCol = -1;
                    let maxScore = 0;
                    Object.keys(colScores).forEach(cIdx => {
                        if (colScores[cIdx] > maxScore) {
                            maxScore = colScores[cIdx];
                            bestCol = parseInt(cIdx);
                        }
                    });
                    if (bestCol !== -1) pincodeIdx = bestCol;
                }

                if (pincodeIdx === -1) pincodeIdx = 0;
                if (courierIdx === -1) courierIdx = (pincodeIdx === 0) ? 1 : 0;
                if (remarkIdx === -1) remarkIdx = (pincodeIdx === 2 || courierIdx === 2) ? 3 : 2;
                
                const parsedRecords = [];
                let skippedRowsCount = 0;

                for (let i = headerRowIdx + 1; i < jsonData.length; i++) {
                    const row = jsonData[i];
                    if (!row || row.length === 0) {
                        skippedRowsCount++;
                        continue;
                    }
                    
                    const courier = String(row[courierIdx] || '').trim() || derivedCourier;
                    const pincode = String(row[pincodeIdx] || '').trim().replace(/\D/g, '');
                    const remark = String(row[remarkIdx] || '').trim();
                    
                    if (pincode && pincode.length >= 3) {
                        parsedRecords.push({
                            courier: courier,
                            pincode: pincode,
                            remark: remark || 'ODA'
                        });
                    } else {
                        skippedRowsCount++;
                    }
                }
                
                if (parsedRecords.length === 0) {
                    alert("Could not parse any valid pincode records from the file.");
                    return;
                }
                
                pendingUploadedOdaRecords = parsedRecords;
                const progressText = document.getElementById('odaUploadProgressText');
                const progressContainer = document.getElementById('odaUploadProgress');
                
                const totalSheetRows = jsonData.length - headerRowIdx - 1;
                const skippedMsg = skippedRowsCount > 0 ? ` (${skippedRowsCount} empty/header/summary rows skipped)` : '';
                
                if (progressText) {
                    progressText.textContent = `Successfully parsed ${parsedRecords.length} valid pincodes from ${totalSheetRows} total rows${skippedMsg} in "${pendingUploadedFileName}". Ready to merge.`;
                }
                if (progressContainer) progressContainer.style.display = 'flex';
                
            } catch (err) {
                console.error("Error reading file:", err);
                alert("Failed to parse the file: " + err.message);
            }
        };
        
        reader.readAsArrayBuffer(file);
    }

    // Bind event listeners for ODA module
    const odaDropZone = document.getElementById('odaDropZone');
    const odaFileInput = document.getElementById('odaFileInput');
    const btnSaveUploadedOda = document.getElementById('btnSaveUploadedOda');
    const btnClearOdaDatabase = document.getElementById('btnClearOdaDatabase');
    const btnExportAllOdaExcel = document.getElementById('btnExportAllOdaExcel');
    const odaSearchInput = document.getElementById('odaSearchInput');

    if (odaDropZone && odaFileInput) {
        odaDropZone.addEventListener('click', () => {
            odaFileInput.click();
        });
        
        odaFileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                handleOdaFileUpload(files[0]);
            }
        });
        
        odaDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            odaDropZone.style.borderColor = 'var(--accent-emerald)';
            odaDropZone.style.background = 'rgba(16, 185, 129, 0.04)';
        });
        
        odaDropZone.addEventListener('dragleave', () => {
            odaDropZone.style.borderColor = 'rgba(59, 130, 246, 0.3)';
            odaDropZone.style.background = 'rgba(59, 130, 246, 0.02)';
        });
        
        odaDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            odaDropZone.style.borderColor = 'rgba(59, 130, 246, 0.3)';
            odaDropZone.style.background = 'rgba(59, 130, 246, 0.02)';
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                handleOdaFileUpload(files[0]);
            }
        });
    }

    if (btnSaveUploadedOda) {
        btnSaveUploadedOda.addEventListener('click', () => {
            if (pendingUploadedOdaRecords && pendingUploadedOdaRecords.length > 0) {
                const fileId = 'file_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
                const now = new Date();
                const uploadTime = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + 
                                   now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
                const fileName = pendingUploadedFileName || `ODA_File_${now.toISOString().slice(0, 10)}.xlsx`;

                const newTaggedRecords = pendingUploadedOdaRecords.map(r => ({
                    pincode: r.pincode,
                    courier: r.courier,
                    remark: r.remark,
                    fileId: fileId,
                    fileName: fileName
                }));

                const updatedRecords = [...memoryOdaRecords, ...newTaggedRecords];

                const newFileHistory = {
                    fileId: fileId,
                    fileName: fileName,
                    uploadTime: uploadTime,
                    recordsCount: newTaggedRecords.length,
                    records: pendingUploadedOdaRecords
                };

                const updatedHistory = [newFileHistory, ...memoryOdaFilesHistory];

                saveOdaData(updatedRecords, updatedHistory);

                pendingUploadedOdaRecords = [];
                pendingUploadedFileName = '';
                const progressContainer = document.getElementById('odaUploadProgress');
                if (progressContainer) progressContainer.style.display = 'none';
                const odaFileInput = document.getElementById('odaFileInput');
                if (odaFileInput) odaFileInput.value = '';

                alert(`Successfully merged ${newTaggedRecords.length} pincodes from "${fileName}" into the Active ODA Database!\nTotal Active Pincodes: ${memoryOdaRecords.length}`);
                renderOdaUI();
            }
        });
    }

    const odaFilesHistoryTableBody = document.getElementById('odaFilesHistoryTableBody');
    if (odaFilesHistoryTableBody) {
        odaFilesHistoryTableBody.addEventListener('click', (e) => {
            // Download File
            const dlBtn = e.target.closest('.btn-download-oda-file');
            if (dlBtn) {
                const fileId = dlBtn.getAttribute('data-file-id');
                const fileObj = memoryOdaFilesHistory.find(f => f.fileId === fileId);
                if (fileObj && window.XLSX) {
                    const exportData = fileObj.records.map(r => ({
                        'Courier Name': r.courier || 'Generic',
                        'Pincode': r.pincode,
                        'Remark / ODA Status': r.remark || 'ODA'
                    }));
                    const ws = XLSX.utils.json_to_sheet(exportData);
                    const wb = XLSX.utils.book_new();
                    XLSX.utils.book_append_sheet(wb, ws, "ODA_Pincodes");
                    XLSX.writeFile(wb, fileObj.fileName || "ODA_Pincodes.xlsx");
                }
                return;
            }

            // Delete File
            const delBtn = e.target.closest('.btn-delete-oda-file');
            if (delBtn) {
                const fileId = delBtn.getAttribute('data-file-id');
                const fileObj = memoryOdaFilesHistory.find(f => f.fileId === fileId);
                if (fileObj) {
                    if (confirm(`Are you sure you want to delete file "${fileObj.fileName}"?\nThis will remove all ${fileObj.recordsCount} pincodes from the Active ODA Database.`)) {
                        const updatedHistory = memoryOdaFilesHistory.filter(f => f.fileId !== fileId);
                        const updatedRecords = memoryOdaRecords.filter(r => r.fileId !== fileId);

                        saveOdaData(updatedRecords, updatedHistory);
                        alert(`File "${fileObj.fileName}" and its ${fileObj.recordsCount} pincodes were deleted from history and Active ODA Database.`);
                        renderOdaUI();
                    }
                }
                return;
            }
        });
    }

    if (btnExportAllOdaExcel) {
        btnExportAllOdaExcel.addEventListener('click', () => {
            if (memoryOdaRecords.length === 0) {
                alert("The Active ODA Database is empty.");
                return;
            }
            if (window.XLSX) {
                const exportData = memoryOdaRecords.map(r => ({
                    'Pincode': r.pincode,
                    'Courier Name': r.courier || 'Generic',
                    'Remark / ODA Status': r.remark || 'ODA',
                    'Source File': r.fileName || 'General'
                }));
                const ws = XLSX.utils.json_to_sheet(exportData);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "All_Active_ODA");
                XLSX.writeFile(wb, `Active_ODA_Pincodes_Mix_${new Date().toISOString().slice(0, 10)}.xlsx`);
            }
        });
    }

    const btnDownloadSampleOdaTemplate = document.getElementById('btnDownloadSampleOdaTemplate');
    if (btnDownloadSampleOdaTemplate) {
        btnDownloadSampleOdaTemplate.addEventListener('click', () => {
            if (window.XLSX) {
                const sampleRows = [
                    { "Courier Name": "Delhivery", "Pincode": "110001", "Remark / ODA Status": "ODA" },
                    { "Courier Name": "Delhivery", "Pincode": "400001", "Remark / ODA Status": "Normal" },
                    { "Courier Name": "Bluedart", "Pincode": "110001", "Remark / ODA Status": "Normal" },
                    { "Courier Name": "Bluedart", "Pincode": "560001", "Remark / ODA Status": "ODA" },
                    { "Courier Name": "Xpressbees", "Pincode": "700001", "Remark / ODA Status": "ODA" },
                    { "Courier Name": "Xpressbees", "Pincode": "390001", "Remark / ODA Status": "Normal" }
                ];

                const ws = XLSX.utils.json_to_sheet(sampleRows);
                ws['!cols'] = [
                    { wch: 18 },
                    { wch: 14 },
                    { wch: 22 }
                ];
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, "ODA_Sample_Format");
                XLSX.writeFile(wb, "Sample_ODA_Template.xlsx");
            } else {
                alert("Excel library not loaded.");
            }
        });
    }

    if (btnClearOdaDatabase) {
        btnClearOdaDatabase.addEventListener('click', () => {
            if (confirm("Are you sure you want to clear the entire ODA database and history? This will disable ODA warnings during dispatch.")) {
                const pwd = prompt("Enter passcode to confirm clearing ODA database:");
                if (pwd === '2026' || pwd === '1998') {
                    saveOdaData([], []);
                    renderOdaUI();
                    alert("ODA database and file history cleared.");
                } else if (pwd !== null) {
                    alert("Incorrect passcode! Action denied.");
                }
            }
        });
    }

    let odaSearchTimeout = null;
    if (odaSearchInput) {
        odaSearchInput.addEventListener('input', () => {
            if (odaSearchTimeout) clearTimeout(odaSearchTimeout);
            odaSearchTimeout = setTimeout(() => {
                renderOdaUI();
            }, 250);
        });
    }

    // Remove any leftover festival themes
    document.documentElement.removeAttribute('data-festival');
    localStorage.removeItem('wms_festival_theme');


    // Initial load: Restore states on page load/reload
    const savedOda = localStorage.getItem('wms_oda_records');
    const savedOdaHistory = localStorage.getItem('wms_oda_files_history');
    let parsedSavedOda = [];
    let parsedSavedOdaHistory = [];
    try {
        parsedSavedOda = savedOda ? JSON.parse(savedOda) : [];
    } catch(e) {}
    try {
        parsedSavedOdaHistory = savedOdaHistory ? JSON.parse(savedOdaHistory) : [];
    } catch(e) {}
    updateOdaMemoryCache(parsedSavedOda, parsedSavedOdaHistory);

    restoreSidebarCollapsedState();
    restoreSessionState();
    restoreOutboundSessionState();
    renderDamageUI();
    renderOdaUI();
    renderInventoryPanel();
    renderDeletedSerialsPanel();
    populateMisProductsDropdown();
    renderOrderQueueUI();
    checkDeviceApprovalStatus();
});


/* ============================================================
   WAREHOUSE AUDIT -> EXPENSES -> SWEEPER ATTENDANCE
   Firebase Realtime Database + Firebase Storage
   ============================================================ */
(function initSweeperAttendanceModule(){
    const $ = (id) => document.getElementById(id);
    let sweeperProfile = null;
    let sweeperMonthDate = new Date();
    let sweeperAttendanceData = {};
    let sweeperStream = null;
    let sweeperStorage = null;

    function waDbRef(path){
        if (!window.db || !window.isFirebaseConnected) return null;
        return window.db.ref('wms_data/' + path);
    }

    function pad2(n){ return String(n).padStart(2,'0'); }
    function dateKey(d){ return d.getFullYear()+'-'+pad2(d.getMonth()+1)+'-'+pad2(d.getDate()); }
    function formatDate(d){ return pad2(d.getDate())+'/'+pad2(d.getMonth()+1)+'/'+d.getFullYear(); }
    function formatTime(ts){ return new Date(ts).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true}); }
    function escapeHtml(v){ return String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }

    function getMonthInfo(base){
        const y=base.getFullYear(), m=base.getMonth();
        const first=new Date(y,m,1), last=new Date(y,m+1,0);
        return {y,m,first,last,days:last.getDate()};
    }

    function statusForDate(key){
        if(!sweeperProfile) return 'N/A';
        const d=new Date(key+'T00:00:00');
        const start=new Date(sweeperProfile.startDate+'T00:00:00');
        if(d < start) return 'N/A';
        const rec=sweeperAttendanceData[key];
        if(rec && rec.status) return rec.status;
        const now=new Date();
        const todayKey=dateKey(now);
        if(key > todayKey) return 'N/A';
        if(key === todayKey && now.getHours() < 20) return 'PENDING';
        return 'A';
    }

    function statusStyle(status){
        if(status==='P') return 'background:#dcfce7;color:#166534;border-color:#86efac;';
        if(status==='A') return 'background:#fee2e2;color:#991b1b;border-color:#fecaca;';
        if(status==='N/A') return 'background:#f3f4f6;color:#6b7280;border-color:#d1d5db;';
        return 'background:#fff7ed;color:#9a3412;border-color:#fed7aa;';
    }

    async function loadSweeperProfile(){
        const ref=waDbRef('expenses/sweeper_attendance/profile');
        if(!ref) return;
        const snap=await ref.once('value');
        sweeperProfile=snap.val()||null;
        renderSweeperCalendar();
    }

    function listenSweeperAttendance(){
        const ref=waDbRef('expenses/sweeper_attendance/records');
        if(!ref) return;
        ref.off();
        ref.on('value',snap=>{
            sweeperAttendanceData=snap.val()||{};
            renderSweeperCalendar();
        });
    }

    function renderSweeperCalendar(){
        const root=$('sweeperCalendar');
        const subtitle=$('sweeperAttendanceSubTitle');
        const nameCard=$('sweeperNameCard');
        if(!root) return;
        if(!sweeperProfile){
            if(nameCard) nameCard.style.display='none';
            root.innerHTML='<div style="padding:30px;text-align:center;color:var(--text-muted);border:1px dashed var(--border-color);border-radius:12px;">Create Sweeper first. Name and start date will be saved once in Firebase.</div>';
            if(subtitle) subtitle.textContent='No sweeper profile created yet.';
            return;
        }
        if(nameCard) nameCard.style.display='block';
        if($('sweeperNameDisplay')) $('sweeperNameDisplay').textContent=sweeperProfile.name;
        if($('sweeperStartDateDisplay')) $('sweeperStartDateDisplay').textContent='Start Date: '+formatDate(new Date(sweeperProfile.startDate+'T00:00:00'))+' • Mumbai Branch: 11:00 AM – 8:00 PM';
        if(subtitle) subtitle.textContent='Live Firebase attendance • '+sweeperMonthDate.toLocaleString('en-IN',{month:'long',year:'numeric'});

        const {y,m,first,days}=getMonthInfo(sweeperMonthDate);
        const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
        let html='<div style="min-width:720px;">';
        html+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;gap:8px;">';
        html+='<button type="button" class="btn-outline" id="btnSweeperPrevMonth">←</button>';
        html+='<strong style="font-size:1.05rem;">'+sweeperMonthDate.toLocaleString('en-IN',{month:'long',year:'numeric'})+'</strong>';
        html+='<button type="button" class="btn-outline" id="btnSweeperNextMonth">→</button></div>';
        html+='<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:7px;">';
        weekdays.forEach(w=>html+='<div style="text-align:center;font-weight:800;font-size:.75rem;color:var(--text-muted);padding:6px;">'+w+'</div>');
        for(let i=0;i<first.getDay();i++) html+='<div></div>';
        let p=0,a=0,na=0,pending=0;
        for(let day=1;day<=days;day++){
            const d=new Date(y,m,day), key=dateKey(d), status=statusForDate(key), rec=sweeperAttendanceData[key];
            if(status==='P')p++; else if(status==='A')a++; else if(status==='N/A')na++; else pending++;
            html+='<div style="border:1px solid var(--border-color);border-radius:10px;padding:9px;min-height:105px;background:var(--bg-card);">';
            html+='<div style="display:flex;justify-content:space-between;align-items:center;"><strong>'+day+'</strong><span style="font-size:.68rem;padding:3px 6px;border:1px solid;border-radius:999px;'+statusStyle(status)+'">'+status+'</span></div>';
            if(rec && rec.time) html+='<div style="font-size:.72rem;color:var(--text-muted);margin-top:7px;">'+escapeHtml(formatTime(rec.timestamp))+'</div>';
            if(rec && rec.photoUrl) html+='<div style="font-size:.7rem;color:#166534;margin-top:4px;">📷 Photo saved</div>';
            if(status==='P' && rec) html+='<button type="button" data-retake-date="'+key+'" class="btn-outline" style="font-size:.68rem;padding:5px 7px;margin-top:7px;">Retake</button>';
            if(key===dateKey(new Date()) && status!=='P' && d>=new Date(sweeperProfile.startDate+'T00:00:00')) html+='<button type="button" data-take-date="'+key+'" class="btn-primary" style="font-size:.68rem;padding:5px 7px;margin-top:7px;">📷 Take Attendance</button>';
            html+='</div>';
        }
        html+='</div></div>';
        root.innerHTML=html;
        const sum=$('sweeperAttendanceSummary');
        if(sum) sum.innerHTML='<div style="display:flex;gap:10px;flex-wrap:wrap;"><div style="padding:10px 14px;border-radius:10px;background:#dcfce7;color:#166534;font-weight:800;">P: '+p+'</div><div style="padding:10px 14px;border-radius:10px;background:#fee2e2;color:#991b1b;font-weight:800;">A: '+a+'</div><div style="padding:10px 14px;border-radius:10px;background:#f3f4f6;color:#6b7280;font-weight:800;">N/A: '+na+'</div><div style="padding:10px 14px;border-radius:10px;background:#fff7ed;color:#9a3412;font-weight:800;">Pending: '+pending+'</div></div>';
        $('btnSweeperPrevMonth')?.addEventListener('click',()=>{sweeperMonthDate=new Date(y,m-1,1);renderSweeperCalendar();});
        $('btnSweeperNextMonth')?.addEventListener('click',()=>{sweeperMonthDate=new Date(y,m+1,1);renderSweeperCalendar();});
        root.querySelectorAll('[data-take-date],[data-retake-date]').forEach(btn=>btn.addEventListener('click',()=>openSweeperCamera(btn.dataset.takeDate||btn.dataset.retakeDate)));
    }

    async function createSweeper(){
        if(sweeperProfile){ alert('Sweeper profile already exists: '+sweeperProfile.name); return; }
        const name=prompt('Enter Sweeper Name:');
        if(!name || !name.trim()) return;
        const start=prompt('Enter Sweeper Start Date (DD/MM/YYYY):', formatDate(new Date()));
        if(!start) return;
        const parts=start.trim().split(/[\/.-]/);
        if(parts.length!==3){ alert('Invalid date. Use DD/MM/YYYY.'); return; }
        const d=new Date(Number(parts[2]),Number(parts[1])-1,Number(parts[0]));
        if(isNaN(d.getTime())){ alert('Invalid date.'); return; }
        const profile={name:name.trim(),startDate:dateKey(d),createdAt:Date.now(),branch:'Mumbai'};
        const ref=waDbRef('expenses/sweeper_attendance/profile');
        if(!ref){alert('Firebase is not connected.');return;}
        await ref.set(profile); sweeperProfile=profile; renderSweeperCalendar();
    }

    function stopCamera(){ if(sweeperStream){sweeperStream.getTracks().forEach(t=>t.stop()); sweeperStream=null;} const modal=$('sweeperCameraModal'); if(modal) modal.remove(); }

    async function openSweeperCamera(key){
        const todayKey=dateKey(new Date());
        if(key!==todayKey){alert('Attendance photo sirf current date ke liye li ja sakti hai.');return;}
        const now=new Date(), mins=now.getHours()*60+now.getMinutes();
        if(mins<11*60 || mins>20*60){alert('Mumbai Branch attendance window 11:00 AM se 8:00 PM hai.');return;}
        if(!navigator.mediaDevices?.getUserMedia){alert('Live camera is not supported by this browser. HTTPS website use karein.');return;}
        stopCamera();
        const modal=document.createElement('div'); modal.id='sweeperCameraModal'; modal.style='position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;';
        modal.innerHTML='<div style="background:#fff;border-radius:16px;padding:16px;width:min(520px,100%);"><h3 style="margin:0 0 10px;">Live Sweeper Attendance</h3><video id="sweeperVideo" autoplay playsinline muted style="width:100%;border-radius:12px;background:#111;max-height:65vh;object-fit:cover;"></video><canvas id="sweeperCanvas" style="display:none;"></canvas><div style="display:flex;gap:8px;margin-top:12px;"><button id="btnCaptureSweeper" class="btn-primary" style="flex:1;">📸 Capture & Upload</button><button id="btnCancelSweeper" class="btn-outline">Cancel</button></div><div id="sweeperCameraMsg" style="font-size:.78rem;color:#6b7280;margin-top:8px;"></div></div>';
        document.body.appendChild(modal);
        $('btnCancelSweeper').onclick=stopCamera;
        try{
            sweeperStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'},audio:false});
            $('sweeperVideo').srcObject=sweeperStream;
        }catch(e){ modal.remove(); alert('Camera permission denied/unavailable.'); return; }
        $('btnCaptureSweeper').onclick=()=>captureSweeperPhoto(key);
    }

    async function captureSweeperPhoto(key){
        const video=$('sweeperVideo'), canvas=$('sweeperCanvas'), msg=$('sweeperCameraMsg'), btn=$('btnCaptureSweeper');
        if(!video||!canvas||!video.videoWidth){alert('Camera ready nahi hai.');return;}
        btn.disabled=true; msg.textContent='Uploading photo to Firebase...';
        canvas.width=video.videoWidth; canvas.height=video.videoHeight; canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.86));
        if(!blob){btn.disabled=false;msg.textContent='Photo capture failed.';return;}
        try{
            if(!window.firebase || !firebase.storage){throw new Error('Firebase Storage SDK not loaded');}
            sweeperStorage=sweeperStorage||firebase.storage();
            const path='expenses/sweeper_attendance/'+sweeperProfile.startDate+'/'+key+'/'+Date.now()+'.jpg';
            const snap=await sweeperStorage.ref(path).put(blob,{contentType:'image/jpeg'});
            const url=await snap.ref.getDownloadURL();
            const ts=Date.now();
            const ref=waDbRef('expenses/sweeper_attendance/records/'+key);
            await ref.set({status:'P',date:key,time:formatTime(ts),timestamp:ts,sweeperName:sweeperProfile.name,photoUrl:url,storagePath:path,branch:'Mumbai',window:'11:00-20:00'});
            stopCamera();
            alert('Attendance marked Present and photo saved successfully.');
        }catch(e){console.error(e);btn.disabled=false;msg.textContent='Upload failed: '+e.message;alert('Photo upload failed. Firebase Storage Rules/permission check karein.');}
    }

    async function exportSweeperExcel(){
        if(!sweeperProfile){alert('Create Sweeper first.');return;}
        if(typeof XLSX==='undefined'){alert('Excel library not loaded.');return;}
        const {y,m,days}=getMonthInfo(sweeperMonthDate), rows=[]; let p=0,a=0,na=0;
        for(let day=1;day<=days;day++){
            const d=new Date(y,m,day), key=dateKey(d), status=statusForDate(key), rec=sweeperAttendanceData[key];
            if(status==='P')p++;else if(status==='A')a++;else if(status==='N/A')na++;
            rows.push({Date:formatDate(d),Day:d.toLocaleDateString('en-IN',{weekday:'long'}),Sweeper:sweeperProfile.name,Status:status,AttendanceTime:rec?.time||'',Photo:rec?.photoUrl?'Yes':'No',Remarks:rec?.status==='P'?'Live camera attendance':'-'});
        }
        rows.push({}); rows.push({Date:'SUMMARY',Sweeper:sweeperProfile.name,Status:'P='+p+' | A='+a+' | N/A='+na});
        const ws=XLSX.utils.json_to_sheet(rows), wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Sweeper Attendance');
        XLSX.writeFile(wb,'Sweeper_Attendance_'+y+'_'+pad2(m+1)+'.xlsx');
    }

    // ==================== WAREHOUSE AUDIT ====================
    let warehouseAuditCurrent = null;
    let warehouseAuditHistory = [];
    let warehouseAuditListenersReady = false;

    function auditDbRef(path){
        return waDbRef(path);
    }

    function escapeAuditText(value){
        return escapeHtml(String(value ?? ''));
    }

    function formatAuditDateTime(ts){
        if(!ts) return '-';
        const d=new Date(ts);
        return d.toLocaleString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
    }

    function buildAuditItemsFromInventory(){
        const stock=getProductStockMap()||{};
        return Object.values(stock)
            .filter(x=>x && x.name && Number(x.serialsCount||0)>0)
            .sort((a,b)=>String(a.name).localeCompare(String(b.name)))
            .map((x,i)=>({
                id:'item_'+i+'_'+btoa(unescape(encodeURIComponent(String(x.name)))).replace(/[^a-zA-Z0-9]/g,'').slice(0,24),
                name:x.name,
                systemQty:Number(x.serialsCount||0),
                status:'PENDING',
                countedQty:null,
                missingQty:0,
                remark:''
            }));
    }

    async function saveAuditCurrent(){
        const ref=auditDbRef('warehouse_audits/current');
        if(ref && warehouseAuditCurrent) await ref.set(warehouseAuditCurrent);
    }

    function auditIsComplete(){
        const items=warehouseAuditCurrent?.items||{};
        const keys=Object.keys(items);
        return keys.length>0 && keys.every(k=>['OK','MISSING'].includes(items[k]?.status));
    }

    function renderAuditStats(){
        const el=$('auditStats'); if(!el) return;
        const items=Object.values(warehouseAuditCurrent?.items||{});
        const total=items.length;
        const system=items.reduce((n,x)=>n+Number(x.systemQty||0),0);
        const counted=items.reduce((n,x)=>n+(x.status==='OK'?Number(x.systemQty||0):x.status==='MISSING'?Number(x.countedQty||0):0),0);
        const missing=items.reduce((n,x)=>n+Number(x.missingQty||0),0);
        const card=(label,value,cls)=>'<div style="padding:11px;border:1px solid var(--border-color);border-radius:10px;background:var(--bg-card);"><div style="font-size:.7rem;color:var(--text-muted);">'+label+'</div><div style="font-size:1.1rem;font-weight:900;" class="'+cls+'">'+value+'</div></div>';
        el.innerHTML=card('Items',total,'')+card('System Qty',system,'')+card('Counted Qty',counted,'')+card('Missing Qty',missing,missing?'':'');
    }

    function renderAuditItems(){
        const root=$('auditItemsList'); if(!root) return;
        const items=Object.values(warehouseAuditCurrent?.items||{});
        if(!items.length){
            root.innerHTML='<div style="padding:24px;text-align:center;border:1px dashed var(--border-color);border-radius:12px;color:var(--text-muted);">No active stock items found for audit.</div>';
        }else{
            root.innerHTML=items.map(item=>{
                const done=item.status==='OK', missing=item.status==='MISSING';
                const status=done?'OK':missing?'MISSING':'PENDING';
                const badgeStyle=done?'background:#dcfce7;color:#166534;border-color:#86efac':missing?'background:#fee2e2;color:#991b1b;border-color:#fca5a5':'background:#fff7ed;color:#9a3412;border-color:#fed7aa';
                return '<div style="border:1px solid var(--border-color);border-radius:12px;padding:13px;background:var(--bg-card);">'+
                    '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">'+
                    '<div style="min-width:220px;flex:1;"><div style="font-weight:800;">'+escapeAuditText(item.name)+'</div><div style="font-size:.76rem;color:var(--text-muted);margin-top:4px;">System Quantity: <strong>'+Number(item.systemQty||0)+'</strong>'+(missing?' • Counted: <strong>'+Number(item.countedQty||0)+'</strong> • Missing: <strong style="color:#b91c1c;">'+Number(item.missingQty||0)+'</strong>':'')+'</div></div>'+
                    '<span style="padding:4px 8px;border:1px solid;border-radius:999px;font-size:.7rem;font-weight:800;'+badgeStyle+'">'+status+'</span>'+
                    '<div style="display:flex;gap:7px;flex-wrap:wrap;">'+
                    '<button type="button" class="btn-primary" data-audit-ok="'+escapeAuditText(item.id)+'" '+(done?'disabled':'')+' style="padding:7px 12px;font-size:.75rem;">OK</button>'+
                    '<button type="button" class="btn-outline" data-audit-missing="'+escapeAuditText(item.id)+'" '+(missing?'disabled':'')+' style="padding:7px 12px;font-size:.75rem;">Missing</button>'+
                    '</div></div></div>';
            }).join('');
        }
        root.querySelectorAll('[data-audit-ok]').forEach(btn=>btn.addEventListener('click',()=>markAuditOk(btn.dataset.auditOk)));
        root.querySelectorAll('[data-audit-missing]').forEach(btn=>btn.addEventListener('click',()=>markAuditMissing(btn.dataset.auditMissing)));
        const doneBtn=$('btnAuditDone'); if(doneBtn) doneBtn.disabled=!auditIsComplete();
        renderAuditStats();
    }

    async function markAuditOk(id){
        const item=warehouseAuditCurrent?.items?.[id]; if(!item) return;
        item.status='OK'; item.countedQty=Number(item.systemQty||0); item.missingQty=0; item.remark='Matched physical count';
        warehouseAuditCurrent.updatedAt=Date.now();
        await saveAuditCurrent(); renderAuditItems();
    }

    async function markAuditMissing(id){
        const item=warehouseAuditCurrent?.items?.[id]; if(!item) return;
        const entered=prompt('System Qty: '+item.systemQty+'\nPhysical Counted Qty enter karein:');
        if(entered===null) return;
        const counted=Math.floor(Number(entered));
        if(!Number.isFinite(counted) || counted<0 || counted>Number(item.systemQty||0)){
            alert('Invalid counted quantity. 0 se system quantity tak value enter karein.'); return;
        }
        const missing=Number(item.systemQty||0)-counted;
        item.status='MISSING'; item.countedQty=counted; item.missingQty=missing; item.remark='Physical count short by '+missing;
        warehouseAuditCurrent.updatedAt=Date.now();
        await saveAuditCurrent(); renderAuditItems();
    }

    async function completeWarehouseAudit(){
        if(!auditIsComplete()){alert('Audit Done tabhi hoga jab har item ko OK ya Missing mark kiya gaya ho.');return;}
        const items=Object.values(warehouseAuditCurrent.items||{});
        const totalSystemQty=items.reduce((n,x)=>n+Number(x.systemQty||0),0);
        const totalCountedQty=items.reduce((n,x)=>n+(x.status==='OK'?Number(x.systemQty||0):Number(x.countedQty||0)),0);
        const totalMissingQty=items.reduce((n,x)=>n+Number(x.missingQty||0),0);
        const auditId='AUD-'+Date.now();
        const record={id:auditId,dateTime:Date.now(),totalAuditItems:items.length,totalSystemQty,totalCountedQty,totalMissingQty,status:totalMissingQty>0?'MISSING':'COMPLETED',remarks:totalMissingQty>0?'Missing PC count: '+totalMissingQty:'All physical quantities matched',items:warehouseAuditCurrent.items};
        const histRef=auditDbRef('warehouse_audits/history/'+auditId);
        const curRef=auditDbRef('warehouse_audits/current');
        if(!histRef||!curRef){alert('Firebase is not connected.');return;}
        await histRef.set(record);
        await curRef.remove();
        warehouseAuditCurrent=null;
        alert(totalMissingQty>0?'Audit completed. Missing quantity: '+totalMissingQty:'Audit completed successfully. All quantities matched.');
        renderWarehouseAudit();
    }

    function renderAuditHistory(){
        const root=$('auditHistoryList'); if(!root) return;
        const arr=[...warehouseAuditHistory].sort((a,b)=>Number(b.dateTime||0)-Number(a.dateTime||0));
        if(!arr.length){root.innerHTML='<div style="padding:18px;text-align:center;color:var(--text-muted);border:1px dashed var(--border-color);border-radius:10px;">No audit history yet.</div>';return;}
        root.innerHTML=arr.map(r=>{
            const miss=Number(r.totalMissingQty||0)>0;
            return '<div style="border:1px solid '+(miss?'#fca5a5':'var(--border-color)')+';border-radius:10px;padding:12px;background:'+(miss?'#fff7f7':'var(--bg-card)')+';">'+
                '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;"><strong style="font-size:.82rem;">'+formatAuditDateTime(r.dateTime)+'</strong><span style="font-size:.68rem;font-weight:800;padding:3px 6px;border-radius:999px;border:1px solid;'+(miss?'background:#fee2e2;color:#991b1b;border-color:#fca5a5':'background:#dcfce7;color:#166534;border-color:#86efac')+'">'+(miss?'MISSING':'COMPLETED')+'</span></div>'+
                '<div style="font-size:.75rem;color:var(--text-muted);margin-top:7px;">Items: <strong>'+Number(r.totalAuditItems||0)+'</strong> • System: <strong>'+Number(r.totalSystemQty||0)+'</strong> • Counted: <strong>'+Number(r.totalCountedQty||0)+'</strong></div>'+
                (miss?'<div style="margin-top:7px;font-size:.76rem;font-weight:800;color:#b91c1c;">⚠ Missing PC: '+Number(r.totalMissingQty||0)+'</div>':'<div style="margin-top:7px;font-size:.76rem;color:#166534;font-weight:700;">✓ All quantities matched</div>')+
                '<div style="margin-top:5px;font-size:.72rem;color:var(--text-muted);">'+escapeAuditText(r.remarks||'')+'</div></div>';
        }).join('');
    }

    function listenWarehouseAudit(){
        if(warehouseAuditListenersReady) return;
        const cur=auditDbRef('warehouse_audits/current');
        const hist=auditDbRef('warehouse_audits/history');
        if(!cur||!hist) return;
        warehouseAuditListenersReady=true;
        cur.on('value',snap=>{
            warehouseAuditCurrent=snap.val()||null;
            renderAuditItems();
        });
        hist.on('value',snap=>{
            const v=snap.val()||{}; warehouseAuditHistory=Object.values(v); renderAuditHistory();
        });
    }

    async function ensureWarehouseAudit(){
        listenWarehouseAudit();
        const ref=auditDbRef('warehouse_audits/current');
        if(!ref) return;
        const snap=await ref.once('value');
        if(snap.exists()) return;
        const items=buildAuditItemsFromInventory();
        if(!items.length){warehouseAuditCurrent={items:{},createdAt:Date.now(),updatedAt:Date.now()};}
        else warehouseAuditCurrent={createdAt:Date.now(),updatedAt:Date.now(),items:Object.fromEntries(items.map(x=>[x.id,x]))};
        await ref.set(warehouseAuditCurrent);
    }

    function renderAuditError(message){
        const root=$('auditItemsList');
        if(!root) return;
        root.innerHTML='<div style="padding:14px 16px;border:1px solid #fca5a5;background:#fff1f2;color:#991b1b;border-radius:12px;font-weight:800;">⚠ Warehouse Audit Error: '+escapeAuditText(message||'Audit data load failed.')+'</div>';
        const doneBtn=$('btnAuditDone'); if(doneBtn) doneBtn.disabled=true;
    }

    async function renderWarehouseAudit(){
        try{
            if(!window.isFirebaseConnected || !window.db){
                renderAuditError('Firebase connection is not available. Please check Firebase configuration/Rules.');
                return;
            }
            await ensureWarehouseAudit();
            renderAuditItems(); renderAuditHistory();
        }catch(err){
            console.error('Warehouse Audit load error:',err);
            renderAuditError(err?.message||String(err));
        }
    }

    function showWarehouseAuditPage(mode){
        const audit=$('warehouseAuditPage'), exp=$('warehouseExpensesPage'), att=$('sweeperAttendancePage');
        const auditBtn=$('btnWarehouseAuditPage'), expBtn=$('btnWarehouseExpensesPage');
        // IMPORTANT: only one activity page is visible at a time.
        if(audit) audit.style.display='none';
        if(exp) exp.style.display='none';
        if(att) att.style.display='none';
        if(mode==='audit' && audit) audit.style.display='block';
        if(mode==='expenses' && exp) exp.style.display='block';
        if(mode==='sweeper' && att) att.style.display='block';
        if(auditBtn){auditBtn.className=mode==='audit'?'btn-primary':'btn-secondary';}
        if(expBtn){expBtn.className=(mode==='expenses'||mode==='sweeper')?'btn-primary':'btn-secondary';}
        if(mode==='audit') renderWarehouseAudit();
        if(mode==='expenses'){ /* Expenses landing page only. */ }
        if(mode==='sweeper'){ loadSweeperProfile(); listenSweeperAttendance(); }
    }

    // Expose the page switcher because the main sidebar navigation is initialized
    // in a separate DOMContentLoaded scope earlier in this file.
    window.showWarehouseAuditPage = showWarehouseAuditPage;

    function initUI(){
        $('btnWarehouseAuditPage')?.addEventListener('click',()=>showWarehouseAuditPage('audit'));
        $('btnWarehouseExpensesPage')?.addEventListener('click',()=>showWarehouseAuditPage('expenses'));
        $('btnAuditDone')?.addEventListener('click',completeWarehouseAudit);
        $('btnSweeperAttendanceActivity')?.addEventListener('click',()=>showWarehouseAuditPage('sweeper'));
        $('btnSweeperBackExpenses')?.addEventListener('click',()=>showWarehouseAuditPage('expenses'));
        $('btnSweeperCreateName')?.addEventListener('click',createSweeper);
        $('btnSweeperExcel')?.addEventListener('click',exportSweeperExcel);
        // Default inner state: Audit page. Outer section is controlled by the sidebar navigation.
        showWarehouseAuditPage('audit');
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',initUI); else initUI();
})();
