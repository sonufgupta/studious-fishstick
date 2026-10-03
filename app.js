(() => {
  "use strict";

  // ONLY ITEM NAMES are stored in LocalStorage.
  // Shop name, invoice number and ALL serial numbers stay in memory only.
  // After Excel download, the page is reset/reloaded and the temporary data is gone.
  const PRODUCT_KEY = "serial_export_products_v2";

  const els = {
    shop: document.getElementById("shopName"),
    invoice: document.getElementById("invoiceNo"),
    items: document.getElementById("itemsContainer"),
    add: document.getElementById("addItemBtn"),
    generate: document.getElementById("generateBtn"),
    clear: document.getElementById("clearDraftBtn"),
    itemCount: document.getElementById("itemCount"),
    pieceCount: document.getElementById("pieceCount"),
    savedCount: document.getElementById("savedProductCount"),
    toast: document.getElementById("toast")
  };

  let itemSeq = 0;

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c])
  );

  function getProducts() {
    try {
      const data = JSON.parse(localStorage.getItem(PRODUCT_KEY) || "[]");
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function saveProducts(list) {
    const clean = [...new Set(
      list.map(x => String(x).trim()).filter(Boolean)
    )].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    localStorage.setItem(PRODUCT_KEY, JSON.stringify(clean));
    updateSavedProductCount();
  }

  function addProduct(name) {
    const clean = String(name || "").trim();
    if (!clean) return false;

    const products = getProducts();
    const exists = products.some(p => p.toLowerCase() === clean.toLowerCase());

    if (!exists) {
      products.push(clean);
      saveProducts(products);
      showToast(`Item added: ${clean}`);
      return true;
    }

    return false;
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => els.toast.classList.remove("show"), 2800);
  }

  // Comma is the main separator. New lines are also accepted for pasted lists.
  function parseSerials(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function updateSavedProductCount() {
    els.savedCount.textContent = getProducts().length;
  }

  function updateSummary() {
    const blocks = [...els.items.querySelectorAll(".item-block")];
    let total = 0;

    blocks.forEach(block => {
      const textarea = block.querySelector(".serial-input");
      const count = parseSerials(textarea.value).length;
      block.querySelector(".count").textContent = `${count} PCS`;
      total += count;
    });

    els.itemCount.textContent = blocks.length;
    els.pieceCount.textContent = total;
    updateSavedProductCount();
  }

  function filteredProducts(searchText) {
    const q = String(searchText || "").trim().toLowerCase();
    return getProducts().filter(p => !q || p.toLowerCase().includes(q));
  }

  function refreshProductSelect(block, selected = "") {
    const search = block.querySelector(".product-search").value;
    const select = block.querySelector(".product-select");
    const products = filteredProducts(search);

    select.innerHTML =
      `<option value="">Select Item Name</option>` +
      products.map(p =>
        `<option value="${esc(p)}">${esc(p)}</option>`
      ).join("");

    if (selected && products.some(p => p.toLowerCase() === selected.toLowerCase())) {
      const exact = products.find(p => p.toLowerCase() === selected.toLowerCase());
      select.value = exact;
    }
  }

  function addItem(product = "", serials = "") {
    itemSeq++;

    const block = document.createElement("div");
    block.className = "item-block";
    block.dataset.seq = itemSeq;

    block.innerHTML = `
      <div class="item-top">
        <div class="item-title-wrap">
          <div class="item-number">ITEM ${itemSeq}</div>
          <div class="item-controls">
            <input class="product-search" type="search"
              placeholder="Filter / search item name..."
              autocomplete="off"
              aria-label="Filter item name">
            <select class="product-select" aria-label="Item name">
              <option value="">Select Item Name</option>
            </select>
            <button class="new-product-btn" type="button">＋ Add New Item</button>
          </div>
          <div class="item-status">Search/filter above, then select the item. New items are saved in this browser.</div>
        </div>

        <button class="remove-item" type="button">Remove Item</button>
      </div>

      <div class="serial-label">
        <label style="margin:0" for="serial_${itemSeq}">Serial Numbers <b>*</b></label>
        <span class="count">0 PCS</span>
      </div>

      <textarea id="serial_${itemSeq}" class="serial-input" spellcheck="false"
        placeholder="Paste serial numbers here: XXX-01, XXX-02, XXX-03, XXX-04"></textarea>

      <div class="serial-help">
        Comma-separated serials = piece count. Paste 10,000 / 20,000 / 50,000 serials if required.
        Press <b>Enter</b> in this box to generate the Excel.
      </div>
    `;

    els.items.appendChild(block);

    const search = block.querySelector(".product-search");
    const select = block.querySelector(".product-select");
    const textarea = block.querySelector(".serial-input");
    const addNew = block.querySelector(".new-product-btn");

    if (product) {
      search.value = product;
    }

    refreshProductSelect(block, product);

    search.addEventListener("input", () => {
      const current = select.value;
      refreshProductSelect(block, current);
    });

    select.addEventListener("change", () => {
      search.value = select.value;
      updateSummary();
    });

    addNew.addEventListener("click", () => {
      const typed = search.value.trim();

      if (!typed) {
        showToast("पहले Item Name लिखें, फिर Add New Item दबाएँ.");
        search.focus();
        return;
      }

      const existing = getProducts().find(p => p.toLowerCase() === typed.toLowerCase());

      if (existing) {
        select.value = existing;
        search.value = existing;
        showToast("यह Item पहले से saved है.");
        updateSummary();
        return;
      }

      addProduct(typed);
      search.value = typed;
      refreshProductSelect(block, typed);
      select.value = typed;
      updateSummary();
    });

    textarea.value = serials || "";
    textarea.addEventListener("input", updateSummary);

    textarea.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        generateExcel();
      }
    });

    block.querySelector(".remove-item").addEventListener("click", () => {
      const blocks = els.items.querySelectorAll(".item-block");

      if (blocks.length === 1) {
        showToast("At least one item is required.");
        return;
      }

      block.remove();
      renumberItems();
      updateSummary();
    });

    updateSummary();
  }

  function renumberItems() {
    [...els.items.querySelectorAll(".item-block")].forEach((block, i) => {
      block.querySelector(".item-number").textContent = `ITEM ${i + 1}`;
    });
  }

  function clearCurrentPage() {
    if (!confirm("Clear current Shop, Invoice and Serial Number data? Saved Item Names will remain.")) {
      return;
    }

    els.shop.value = "";
    els.invoice.value = "";
    els.items.innerHTML = "";
    itemSeq = 0;
    addItem();
    showToast("Current data cleared. Saved Item Names are safe.");
  }

  function safeFilePart(s) {
    return String(s || "SHOP")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "_")
      .slice(0, 80);
  }

  function invoiceFourDigits(invoice) {
    const digits = String(invoice || "").match(/\d/g) || [];
    return digits.join("").slice(-4).padStart(4, "0");
  }

  function filename(shop, invoice) {
    const d = new Date();
    const date = [
      String(d.getDate()).padStart(2, "0"),
      String(d.getMonth() + 1).padStart(2, "0"),
      d.getFullYear()
    ].join("-");

    return `${safeFilePart(shop)}_${invoiceFourDigits(invoice)}_${date}.xls`;
  }

  function xmlEscape(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function uniqueSheetName(name, used) {
    let base = String(name || "Item")
      .replace(/[\\\/\?\*\[\]\:]/g, "")
      .trim()
      .slice(0, 31) || "Item";

    let candidate = base;
    let n = 1;

    while (used.has(candidate.toLowerCase())) {
      const suffix = `_${n++}`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }

    used.add(candidate.toLowerCase());
    return candidate;
  }

  function workbookXml(shop, invoice, items) {
    const usedSheets = new Set();

    const sheets = items.map(item => {
      const rows = [];

      rows.push(
        `<Row><Cell ss:MergeAcross="1" ss:StyleID="Title"><Data ss:Type="String">${xmlEscape(item.product)}</Data></Cell></Row>`
      );
      rows.push(`<Row/>`);
      rows.push(
        `<Row><Cell ss:StyleID="Header"><Data ss:Type="String">S.No.</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Serial Number</Data></Cell></Row>`
      );

      item.serials.forEach((serial, i) => {
        rows.push(
          `<Row><Cell><Data ss:Type="Number">${i + 1}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(serial)}</Data></Cell></Row>`
        );
      });

      rows.push(`<Row/>`);
      rows.push(
        `<Row><Cell ss:StyleID="Total"><Data ss:Type="String">TOTAL PCS</Data></Cell><Cell ss:StyleID="Total"><Data ss:Type="Number">${item.serials.length}</Data></Cell></Row>`
      );

      const sheetName = uniqueSheetName(item.product, usedSheets);

      return `<Worksheet ss:Name="${xmlEscape(sheetName)}"><Table ss:ExpandedColumnCount="2" ss:ExpandedRowCount="${rows.length}">${rows.join("")}</Table></Worksheet>`;
    }).join("");

    const totalPieces = items.reduce((n, x) => n + x.serials.length, 0);

    return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
<Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Calibri" ss:Size="11"/></Style>
<Style ss:ID="Title"><Font ss:Bold="1" ss:Size="15"/><Alignment ss:Horizontal="Left"/></Style>
<Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
<Style ss:ID="Total"><Font ss:Bold="1"/><Interior ss:Color="#E2F3EC" ss:Pattern="Solid"/></Style>
</Styles>
<Worksheet ss:Name="Summary"><Table>
<Row><Cell><Data ss:Type="String">Shop Name</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(shop)}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Sales Order / Invoice</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(invoice)}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Total Items</Data></Cell><Cell><Data ss:Type="Number">${items.length}</Data></Cell></Row>
<Row><Cell><Data ss:Type="String">Total Pieces</Data></Cell><Cell><Data ss:Type="Number">${totalPieces}</Data></Cell></Row>
</Table></Worksheet>${sheets}</Workbook>`;
  }

  function downloadBlob(content, name, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = name;
    a.style.display = "none";

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function generateExcel() {
    const shop = els.shop.value.trim();
    const invoice = els.invoice.value.trim();
    const blocks = [...els.items.querySelectorAll(".item-block")];

    if (!shop) {
      els.shop.focus();
      showToast("Shop Name is mandatory.");
      return;
    }

    if (!invoice) {
      els.invoice.focus();
      showToast("Sales Order / Invoice Number is mandatory.");
      return;
    }

    const items = blocks.map(block => ({
      product: block.querySelector(".product-select").value.trim(),
      serials: parseSerials(block.querySelector(".serial-input").value)
    }));

    const emptyProduct = items.findIndex(x => !x.product);
    if (emptyProduct >= 0) {
      showToast(`Select Item Name for Item ${emptyProduct + 1}.`);
      blocks[emptyProduct].querySelector(".product-search").focus();
      return;
    }

    const emptySerials = items.findIndex(x => x.serials.length === 0);
    if (emptySerials >= 0) {
      showToast(`Enter serial numbers for Item ${emptySerials + 1}.`);
      blocks[emptySerials].querySelector(".serial-input").focus();
      return;
    }

    const duplicateProducts = items
      .map(x => x.product.toUpperCase())
      .filter((v, i, a) => a.indexOf(v) !== i);

    if (duplicateProducts.length) {
      showToast("Same item name cannot be added twice in one Excel.");
      return;
    }

    // Save only the item names. Serial numbers are NOT saved anywhere.
    const currentProducts = getProducts();
    items.forEach(item => {
      if (!currentProducts.some(p => p.toLowerCase() === item.product.toLowerCase())) {
        currentProducts.push(item.product);
      }
    });
    saveProducts(currentProducts);

    const xml = workbookXml(shop, invoice, items);
    const fileName = filename(shop, invoice);

    // The file is handed to the device/browser download system.
    // After the download is initiated, this page is reset and temporary
    // Shop/Invoice/Serial data disappears. Only Item Names remain in LocalStorage.
    downloadBlob(xml, fileName, "application/vnd.ms-excel");

    showToast(`Excel downloaded • ${items.reduce((n, x) => n + x.serials.length, 0)} PCS`);

    setTimeout(() => {
      window.location.reload();
    }, 900);
  }

  els.shop.addEventListener("input", updateSummary);
  els.invoice.addEventListener("input", updateSummary);
  els.add.addEventListener("click", () => addItem());
  els.generate.addEventListener("click", generateExcel);
  els.clear.addEventListener("click", clearCurrentPage);

  // Initial state: no draft is loaded because serial data must never persist.
  addItem();
  updateSummary();
})();
