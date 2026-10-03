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

  // ---------------- REAL XLSX GENERATOR ----------------
  // XLSX is a ZIP package containing XML files. This implementation uses
  // "STORE" (no compression), which is fully valid for Excel and avoids
  // any external library/CDN. The generated file is a genuine .xlsx file.

  function crc32(bytes) {
    let crc = 0 ^ (-1);

    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
      }
    }

    return (crc ^ (-1)) >>> 0;
  }

  function u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }

  function u32(n) {
    return new Uint8Array([
      n & 255,
      (n >>> 8) & 255,
      (n >>> 16) & 255,
      (n >>> 24) & 255
    ]);
  }

  function concatBytes(...arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;

    arrays.forEach(a => {
      out.set(a, offset);
      offset += a.length;
    });

    return out;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach(file => {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = encoder.encode(file.data);
      const crc = crc32(dataBytes);

      const local = concatBytes(
        new Uint8Array([0x50,0x4b,0x03,0x04]),
        u16(20),              // version needed
        u16(0x0800),          // UTF-8 filename
        u16(0),               // STORE
        u16(0), u16(0),       // time/date
        u32(crc),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0),
        nameBytes,
        dataBytes
      );

      const central = concatBytes(
        new Uint8Array([0x50,0x4b,0x01,0x02]),
        u16(20),              // made by
        u16(20),              // version needed
        u16(0x0800),
        u16(0),
        u16(0), u16(0),
        u32(crc),
        u32(dataBytes.length),
        u32(dataBytes.length),
        u16(nameBytes.length),
        u16(0),               // extra
        u16(0),               // comment
        u16(0),               // disk
        u16(0),               // internal attrs
        u32(0),               // external attrs
        u32(offset),
        nameBytes
      );

      localParts.push(local);
      centralParts.push(central);
      offset += local.length;
    });

    const centralStart = offset;
    const central = concatBytes(...centralParts);
    const local = concatBytes(...localParts);
    const centralSize = central.length;
    const count = files.length;

    const endRecord = concatBytes(
      new Uint8Array([0x50,0x4b,0x05,0x06]),
      u16(0), u16(0),
      u16(count), u16(count),
      u32(centralSize),
      u32(centralStart),
      u16(0)
    );

    return concatBytes(local, central, endRecord);
  }

  function cellRef(col, row) {
    let n = col;
    let letters = "";

    while (n > 0) {
      const r = (n - 1) % 26;
      letters = String.fromCharCode(65 + r) + letters;
      n = Math.floor((n - 1) / 26);
    }

    return `${letters}${row}`;
  }

  function inlineCell(ref, value, style = "") {
    const styleAttr = style ? ` s="${style}"` : "";
    return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  }

  function numberCell(ref, value, style = "") {
    const styleAttr = style ? ` s="${style}"` : "";
    return `<c r="${ref}"${styleAttr}><v>${Number(value) || 0}</v></c>`;
  }

  function makeSheetXml(rows) {
    const rowXml = rows.map(row =>
      `<row r="${row.r}">${row.cells.join("")}</row>`
    ).join("");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
<cols>
<col min="1" max="1" width="12" customWidth="1"/>
<col min="2" max="2" width="55" customWidth="1"/>
</cols>
<sheetData>${rowXml}</sheetData>
</worksheet>`;
  }

  function makeItemSheetXml(item) {
    const rows = [];

    rows.push({
      r: 1,
      cells: [
        `<c r="A1" t="inlineStr" s="2"><is><t xml:space="preserve">${xmlEscape(item.product)}</t></is></c>`
      ]
    });

    rows.push({ r: 2, cells: [] });

    rows.push({
      r: 3,
      cells: [
        inlineCell("A3", "S.No.", "1"),
        inlineCell("B3", "Serial Number", "1")
      ]
    });

    item.serials.forEach((serial, i) => {
      const row = i + 4;
      rows.push({
        r: row,
        cells: [
          numberCell(`A${row}`, i + 1),
          inlineCell(`B${row}`, serial)
        ]
      });
    });

    const totalRow = item.serials.length + 5;

    rows.push({ r: totalRow - 1, cells: [] });

    rows.push({
      r: totalRow,
      cells: [
        inlineCell(`A${totalRow}`, "TOTAL PCS", "3"),
        numberCell(`B${totalRow}`, item.serials.length, "3")
      ]
    });

    return makeSheetXml(rows);
  }

  function makeSummarySheetXml(shop, invoice, items) {
    const totalPieces = items.reduce((n, x) => n + x.serials.length, 0);

    const rows = [
      { r: 1, cells: [inlineCell("A1", "Shop Name", "1"), inlineCell("B1", shop)] },
      { r: 2, cells: [inlineCell("A2", "Sales Order / Invoice", "1"), inlineCell("B2", invoice)] },
      { r: 3, cells: [inlineCell("A3", "Total Items", "1"), numberCell("B3", items.length)] },
      { r: 4, cells: [inlineCell("A4", "Total Pieces", "1"), numberCell("B4", totalPieces)] },
      { r: 6, cells: [inlineCell("A6", "Item Name", "1"), inlineCell("B6", "Total PCS", "1")] }
    ];

    items.forEach((item, i) => {
      rows.push({
        r: 7 + i,
        cells: [
          inlineCell(`A${7+i}`, item.product),
          numberCell(`B${7+i}`, item.serials.length)
        ]
      });
    });

    return makeSheetXml(rows);
  }

  function buildXlsx(shop, invoice, items) {
    const used = new Set(["summary"]);
    const sheetInfos = [];

    items.forEach(item => {
      sheetInfos.push({
        name: uniqueSheetName(item.product, used),
        xml: makeItemSheetXml(item)
      });
    });

    const allSheets = [
      { name: "Summary", xml: makeSummarySheetXml(shop, invoice, items) },
      ...sheetInfos
    ];

    const workbookSheets = allSheets.map((sheet, i) =>
      `<sheet name="${xmlEscape(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
    ).join("");

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${workbookSheets}</sheets>
</workbook>`;

    const workbookRels = allSheets.map((sheet, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
    ).join("");

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${workbookRels}
</Relationships>`;

    const contentTypesSheets = allSheets.map((sheet, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    ).join("");

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${contentTypesSheets}
</Types>`;

    const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="0"/>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="2">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

    const files = [
      { name: "[Content_Types].xml", data: contentTypesXml },
      { name: "_rels/.rels", data: rootRelsXml },
      { name: "xl/workbook.xml", data: workbookXml },
      { name: "xl/_rels/workbook.xml.rels", data: workbookRelsXml },
      { name: "xl/styles.xml", data: stylesXml }
    ];

    allSheets.forEach((sheet, i) => {
      files.push({
        name: `xl/worksheets/sheet${i + 1}.xml`,
        data: sheet.xml
      });
    });

    return zipStore(files);
  }

  function downloadXlsx(bytes, name) {
    const blob = new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });

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

    // Only Item Names are persisted.
    const currentProducts = getProducts();
    items.forEach(item => {
      if (!currentProducts.some(p => p.toLowerCase() === item.product.toLowerCase())) {
        currentProducts.push(item.product);
      }
    });
    saveProducts(currentProducts);

    try {
      const xlsxBytes = buildXlsx(shop, invoice, items);
      const fileName = `${safeFilePart(shop)}_${invoiceFourDigits(invoice)}_${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")}.xlsx`;

      downloadXlsx(xlsxBytes, fileName);

      showToast(`Real Excel (.xlsx) downloaded • ${items.reduce((n, x) => n + x.serials.length, 0)} PCS`);

      // Clear temporary page data after download is handed to the device.
      setTimeout(() => window.location.reload(), 1000);
    } catch (err) {
      console.error("XLSX generation failed:", err);
      showToast("Excel generation failed. Please try again.");
    }
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
