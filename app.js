(() => {
  "use strict";

  const PRODUCT_KEY = "serial_export_products_v1";
  const DRAFT_KEY = "serial_export_draft_v1";
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

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  function getProducts() {
    try {
      const x = JSON.parse(localStorage.getItem(PRODUCT_KEY) || "[]");
      return Array.isArray(x) ? x : [];
    } catch { return []; }
  }

  function saveProducts(list) {
    localStorage.setItem(PRODUCT_KEY, JSON.stringify([...new Set(list.filter(Boolean).map(x => String(x).trim()).filter(Boolean))]));
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  // Primary rule: comma separates serial numbers. New lines are also accepted
  // only as a convenience when pasted from a source that uses one serial per line.
  function parseSerials(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
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
    els.savedCount.textContent = getProducts().length;
    saveDraft();
  }

  function productOptions(selected = "") {
    const products = getProducts();
    return `<option value="">Select Item Name</option>${products.map(p =>
      `<option value="${esc(p)}" ${p === selected ? "selected" : ""}>${esc(p)}</option>`
    ).join("")}`;
  }

  function addItem(product = "", serials = "") {
    itemSeq++;
    const block = document.createElement("div");
    block.className = "item-block";
    block.dataset.seq = itemSeq;
    block.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-number">ITEM ${itemSeq}</div>
          <select class="product-select" aria-label="Item name">
            ${productOptions(product)}
          </select>
        </div>
        <button class="remove-item" type="button">Remove Item</button>
      </div>
      <div class="serial-label">
        <label style="margin:0" for="serial_${itemSeq}">Serial Numbers <b>*</b></label>
        <span class="count">0 PCS</span>
      </div>
      <textarea id="serial_${itemSeq}" class="serial-input" spellcheck="false"
        placeholder="Paste serial numbers here: XXX-01, XXX-02, XXX-03, XXX-04">${esc(serials)}</textarea>
      <div class="serial-help">Comma-separated serials = piece count. Press <b>Enter</b> here to generate the Excel.</div>
    `;

    els.items.appendChild(block);
    const select = block.querySelector(".product-select");
    const textarea = block.querySelector(".serial-input");

    select.addEventListener("change", () => {
      const name = select.value.trim();
      if (name) {
        const products = getProducts();
        if (!products.includes(name)) {
          products.push(name);
          saveProducts(products);
        }
      }
      updateSummary();
    });

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

  function saveDraft() {
    const draft = {
      shop: els.shop.value,
      invoice: els.invoice.value,
      items: [...els.items.querySelectorAll(".item-block")].map(block => ({
        product: block.querySelector(".product-select").value,
        serials: block.querySelector(".serial-input").value
      }))
    };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  function loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (!d) { addItem(); return; }
      els.shop.value = d.shop || "";
      els.invoice.value = d.invoice || "";
      const items = Array.isArray(d.items) && d.items.length ? d.items : [{product:"",serials:""}];
      items.forEach(x => addItem(x.product, x.serials));
    } catch {
      addItem();
    }
    updateSummary();
  }

  function clearDraft() {
    if (!confirm("Clear the current form and local draft?")) return;
    localStorage.removeItem(DRAFT_KEY);
    els.shop.value = "";
    els.invoice.value = "";
    els.items.innerHTML = "";
    itemSeq = 0;
    addItem();
    showToast("Draft cleared.");
  }

  function safeFilePart(s) {
    return String(s || "SHOP").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80);
  }

  // Invoice suffix is intentionally configurable here for your later 4-digit rule.
  function invoiceFourDigits(invoice) {
    const digits = String(invoice || "").match(/\d/g) || [];
    return digits.join("").slice(-4).padStart(4, "0");
  }

  function filename(shop, invoice) {
    const d = new Date();
    const date = [
      String(d.getDate()).padStart(2,"0"),
      String(d.getMonth()+1).padStart(2,"0"),
      d.getFullYear()
    ].join("-");
    return `${safeFilePart(shop)}_${invoiceFourDigits(invoice)}_${date}.xls`;
  }

  function xmlEscape(s) {
    return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&apos;");
  }

  // Excel 2003 XML is an Excel-readable workbook and requires no external library/CDN.
  // This keeps the three-file app fully browser/local-first.
  function workbookXml(shop, invoice, items) {
    const sheets = items.map((item, idx) => {
      const rows = [];
      rows.push(`<Row><Cell ss:MergeAcross="3" ss:StyleID="Title"><Data ss:Type="String">${xmlEscape(item.product)}</Data></Cell></Row>`);
      rows.push(`<Row/>`);
      rows.push(`<Row><Cell ss:StyleID="Header"><Data ss:Type="String">S.No.</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Serial Number</Data></Cell></Row>`);
      item.serials.forEach((serial, i) => {
        rows.push(`<Row><Cell><Data ss:Type="Number">${i+1}</Data></Cell><Cell><Data ss:Type="String">${xmlEscape(serial)}</Data></Cell></Row>`);
      });
      rows.push(`<Row/>`);
      rows.push(`<Row><Cell ss:StyleID="Total"><Data ss:Type="String">TOTAL PCS</Data></Cell><Cell ss:StyleID="Total"><Data ss:Type="Number">${item.serials.length}</Data></Cell></Row>`);
      return `<Worksheet ss:Name="${xmlEscape((item.product || "Item").slice(0,31))}"><Table ss:ExpandedColumnCount="2" ss:ExpandedRowCount="${rows.length}">${rows.join("")}</Table></Worksheet>`;
    }).join("");

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
<Row><Cell><Data ss:Type="String">Total Pieces</Data></Cell><Cell><Data ss:Type="Number">${items.reduce((n,x)=>n+x.serials.length,0)}</Data></Cell></Row>
</Table></Worksheet>${sheets}</Workbook>`;
  }

  function downloadBlob(content, name, mime) {
    const blob = new Blob([content], {type:mime});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.style.display="none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function generateExcel() {
    const shop = els.shop.value.trim();
    const invoice = els.invoice.value.trim();
    const blocks = [...els.items.querySelectorAll(".item-block")];

    if (!shop) { els.shop.focus(); showToast("Shop Name is mandatory."); return; }
    if (!invoice) { els.invoice.focus(); showToast("Sales Order / Invoice Number is mandatory."); return; }

    const items = blocks.map(block => ({
      product: block.querySelector(".product-select").value.trim(),
      serials: parseSerials(block.querySelector(".serial-input").value)
    }));

    const emptyProduct = items.findIndex(x => !x.product);
    if (emptyProduct >= 0) {
      showToast(`Select Item Name for Item ${emptyProduct + 1}.`);
      blocks[emptyProduct].querySelector(".product-select").focus();
      return;
    }
    const emptySerials = items.findIndex(x => x.serials.length === 0);
    if (emptySerials >= 0) {
      showToast(`Enter serial numbers for Item ${emptySerials + 1}.`);
      blocks[emptySerials].querySelector(".serial-input").focus();
      return;
    }

    const duplicateProducts = items.map(x => x.product.toUpperCase()).filter((v,i,a)=>a.indexOf(v)!==i);
    if (duplicateProducts.length) {
      showToast("Same item name cannot be added twice in one Excel.");
      return;
    }

    const xml = workbookXml(shop, invoice, items);
    downloadBlob(xml, filename(shop, invoice), "application/vnd.ms-excel");
    localStorage.removeItem(DRAFT_KEY);
    showToast(`Excel generated • ${items.reduce((n,x)=>n+x.serials.length,0)} PCS`);
  }

  [els.shop, els.invoice].forEach(x => x.addEventListener("input", saveDraft));
  els.add.addEventListener("click", () => addItem());
  els.generate.addEventListener("click", generateExcel);
  els.clear.addEventListener("click", clearDraft);

  loadDraft();
})();
