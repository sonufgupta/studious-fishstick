(() => {
  "use strict";

  const raw = document.getElementById("rawText");
  const generate = document.getElementById("generateBtn");
  const clear = document.getElementById("clearBtn");
  const preview = document.getElementById("parsedPreview");
  const toast = document.getElementById("toast");

  const showToast = msg => {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove("show"), 3500);
  };

  const cleanText = s => String(s ?? "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#xA0;/gi, " ");

  const stripMd = s => String(s ?? "")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/\[\s*\*\*(.*?)\*\*\s*\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&apos;"}[c])
  );

  function normalizeSource(text) {
    return cleanText(text).replace(/\n[ \t]+/g, "\n");
  }

  // ---------------- STRICT HEADER EXTRACTION ----------------

  function extractShop(text) {
    // Zoho markdown normally looks like:
    // | Ship To<br>[**JAIN TRADING COMPANY**](...) |
    let m = text.match(/Ship\s*To\s*(?:<br\s*\/?\s*>|\n|\r\n|\s)*\[\s*\*\*\s*([^*\]\n]+?)\s*\*\*\s*\]/i);
    if (m) return stripMd(m[1]);

    // Also accept a plain-text Ship To line, but only the immediate next line.
    m = text.match(/Ship\s*To\s*(?:<br\s*\/?\s*>|\n)+\s*([^\n|]+)/i);
    return m ? stripMd(m[1]) : "";
  }

  function extractInvoice(text) {
    const m = text.match(/Sales\s*Order\s*#?\s*:\s*\|?\s*(SO-MH\s*\/\s*\d{2}-\d{2}\s*\/\s*\d+)\s*(?:\||\n|$)/i);
    return m ? m[1].replace(/\s+/g, " ").trim() : "";
  }

  function extractOrderNumber(invoice) {
    const m = String(invoice || "").match(/\/\s*(\d+)\s*$/);
    return m ? m[1] : "";
  }

  // ---------------- STRICT ITEM / SERIAL EXTRACTION ----------------

  function validSerial(serial) {
    // Zoho serials in this workflow are alphanumeric codes.
    // Spaces, punctuation-only values and prose are rejected.
    return /^[A-Za-z0-9][A-Za-z0-9._-]{5,79}$/.test(serial);
  }

  function extractSerialList(serialText) {
    return String(serialText || "")
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/\*+/g, "")
      .split(/[\s,;]+/)
      .map(x => x.trim())
      .filter(Boolean)
      .filter(validSerial);
  }

  function productFromCell(cell) {
    // Everything before Serial Number(s) is the product section.
    const before = String(cell).split(/Serial\s*Number\(s\)\s*:/i)[0];
    // The product name is the first non-empty text before the serial marker.
    const lines = before
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .split(/\n+/)
      .map(x => stripMd(x))
      .filter(Boolean);
    return lines.length ? lines[0] : "";
  }

  function parseItemRow(row) {
    // A valid Zoho shipment row has exactly this structural ending:
    // | HSN | QTY | Pcs |
    const end = row.match(/\|\s*(\d{4,12})\s*\|\s*(\d+(?:\.\d+)?)\s*\|\s*(?:pcs?|pieces?)\s*\|\s*$/i);
    if (!end) return null;

    const qty = Number(end[2]);
    const beforeEnd = row.slice(0, end.index);

    // Find the numbered first cell of this same row.
    const start = beforeEnd.match(/^\s*\|\s*(\d+)\s*\|\s*([\s\S]*)$/);
    if (!start) return null;

    const cell = start[2];
    const serialMarker = /Serial\s*Number\(s\)\s*:/i.exec(cell);
    if (!serialMarker) return null;

    const product = productFromCell(cell);
    const serialText = cell.slice(serialMarker.index + serialMarker[0].length);
    const serials = extractSerialList(serialText);

    if (!product || !Number.isInteger(qty) || qty < 1 || !serials.length) return null;
    return { product, serials, qty };
  }

  function extractItems(text) {
    const items = [];

    // PRIMARY: parse each physical markdown table line.
    // This is the exact format produced by the pasted Zoho Shipment Order.
    const lines = text.split("\n");
    for (const line of lines) {
      if (!/^\s*\|\s*\d+\s*\|/.test(line)) continue;
      if (!/Serial\s*Number\(s\)\s*:/i.test(line)) continue;
      const item = parseItemRow(line);
      if (item) items.push(item);
    }

    // SECONDARY: if the browser wrapped a table row into multiple lines,
    // reconstruct blocks beginning with | number | and ending with | HSN | qty | Pcs |.
    if (!items.length) {
      const blockRe = /(?:^|\n)\s*\|\s*\d+\s*\|[\s\S]*?\|\s*\d{4,12}\s*\|\s*\d+(?:\.\d+)?\s*\|\s*(?:pcs?|pieces?)\s*\|\s*(?=\n|$)/gi;
      let m;
      while ((m = blockRe.exec(text))) {
        const item = parseItemRow(m[0].trim());
        if (item) items.push(item);
      }
    }

    // Remove exact duplicate rows without ever merging different items.
    const seen = new Set();
    return items.filter(item => {
      const key = item.product.toUpperCase() + "\u0000" + item.serials.join("\u0001").toUpperCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function validateParsedData(data) {
    const errors = [];
    if (!data.shop) errors.push("Shop Name detect nahi hua.");
    if (!data.invoice || !data.orderNo) errors.push("Sales Order number detect nahi hua.");
    if (!data.items.length) errors.push("Shipment table me valid Item + Serial Number(s) row detect nahi hui.");

    const allSerials = new Set();
    const productKeys = new Set();

    data.items.forEach((item, i) => {
      if (item.serials.length !== item.qty) {
        errors.push(`Item ${i + 1} (${item.product}): Qty ${item.qty}, lekin ${item.serials.length} serial mile.`);
      }

      const productKey = item.product.trim().toUpperCase();
      if (productKeys.has(productKey)) errors.push(`Same Item Name do baar mila: ${item.product}.`);
      productKeys.add(productKey);

      item.serials.forEach(serial => {
        const key = serial.toUpperCase();
        if (allSerials.has(key)) errors.push(`Duplicate serial found: ${serial}.`);
        allSerials.add(key);
      });
    });

    return errors;
  }

  function parseShipment(text) {
    const t = normalizeSource(text);
    const invoice = extractInvoice(t);
    return {
      shop: extractShop(t),
      invoice,
      orderNo: extractOrderNumber(invoice),
      items: extractItems(t)
    };
  }

  function updatePreview() {
    const data = parseShipment(raw.value);
    if (!raw.value.trim()) {
      preview.classList.add("hidden");
      return data;
    }

    const errors = validateParsedData(data);
    const pieces = data.items.reduce((n, x) => n + x.serials.length, 0);

    preview.innerHTML = `
      <div class="preview-title">Auto Extracted ${errors.length ? "• CHECK REQUIRED" : "• READY"}</div>
      <div class="preview-grid">
        <div><span>Shop:</span> <b>${esc(data.shop || "Not detected")}</b></div>
        <div><span>Sales Order:</span> <b>${esc(data.invoice || "Not detected")}</b></div>
        <div><span>Excel Number:</span> <b>${esc(data.orderNo || "Not detected")}</b></div>
        <div><span>Items / Serial PCS:</span> <b>${data.items.length} / ${pieces}</b></div>
      </div>
      ${data.items.length ? `<div class="preview-items">${data.items.map((x,i)=>`<div><b>${i+1}. ${esc(x.product)}</b> — Qty ${x.qty}, Serial ${x.serials.length}</div>`).join("")}</div>` : ""}
      ${errors.length ? `<div class="preview-errors">${errors.map(esc).map(x=>`<div>• ${x}</div>`).join("")}</div>` : ""}`;

    preview.classList.remove("hidden");
    return data;
  }

  raw.addEventListener("input", updatePreview);
  raw.addEventListener("keydown", e => {
    // Ctrl+Enter is safer for a large multi-line paste box.
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      generateExcel();
    }
  });

  clear.addEventListener("click", () => {
    raw.value = "";
    preview.classList.add("hidden");
    raw.focus();
  });

  const safeFilePart = s => String(s || "SHOP")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);

  const xmlEscape = s => String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

  function uniqueSheetName(name, used) {
    let base = String(name || "Item")
      .replace(/[\\/\?\*\[\]\:]/g, "")
      .trim()
      .slice(0, 31) || "Item";
    let candidate = base, n = 1;
    while (used.has(candidate.toLowerCase())) {
      const suffix = `_${n++}`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  // ---------------- REAL XLSX GENERATOR ----------------

  function crc32(bytes) {
    let crc = -1;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  const u16 = n => new Uint8Array([n & 255, (n >>> 8) & 255]);
  const u32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

  function concatBytes(...arrays) {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    arrays.forEach(a => { out.set(a, offset); offset += a.length; });
    return out;
  }

  function zipStore(files) {
    const enc = new TextEncoder();
    const locals = [], centrals = [];
    let offset = 0;

    files.forEach(file => {
      const nameBytes = enc.encode(file.name);
      const dataBytes = enc.encode(file.data);
      const crc = crc32(dataBytes);

      const local = concatBytes(
        new Uint8Array([80,75,3,4]), u16(20), u16(0x800), u16(0), u16(0), u16(0),
        u32(crc), u32(dataBytes.length), u32(dataBytes.length),
        u16(nameBytes.length), u16(0), nameBytes, dataBytes
      );

      const central = concatBytes(
        new Uint8Array([80,75,1,2]), u16(20), u16(20), u16(0x800), u16(0), u16(0), u16(0),
        u32(crc), u32(dataBytes.length), u32(dataBytes.length), u16(nameBytes.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes
      );

      locals.push(local);
      centrals.push(central);
      offset += local.length;
    });

    const centralStart = offset;
    const central = concatBytes(...centrals);
    const local = concatBytes(...locals);
    const end = concatBytes(
      new Uint8Array([80,75,5,6]), u16(0), u16(0),
      u16(files.length), u16(files.length), u32(central.length), u32(centralStart), u16(0)
    );
    return concatBytes(local, central, end);
  }

  const inlineCell = (ref, value, style = "") =>
    `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ""}><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  const numberCell = (ref, value, style = "") =>
    `<c r="${ref}"${style ? ` s="${style}"` : ""}><v>${Number(value) || 0}</v></c>`;

  function makeSheetXml(item) {
    const rows = [];
    rows.push({ r: 1, c: [inlineCell("A1", item.product, "2")] });
    rows.push({ r: 3, c: [inlineCell("A3", "S.No.", "1"), inlineCell("B3", "Serial Number", "1")] });

    item.serials.forEach((serial, i) => {
      const row = i + 4;
      rows.push({ r: row, c: [numberCell(`A${row}`, i + 1), inlineCell(`B${row}`, serial)] });
    });

    const totalRow = item.serials.length + 5;
    rows.push({ r: totalRow, c: [inlineCell(`A${totalRow}`, "TOTAL PCS", "3"), numberCell(`B${totalRow}`, item.serials.length, "3")] });

    const rowXml = rows.map(x => `<row r="${x.r}">${x.c.join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="55" customWidth="1"/></cols><sheetData>${rowXml}</sheetData></worksheet>`;
  }

  function buildXlsx(items) {
    const used = new Set();
    const sheets = items.map(item => ({ name: uniqueSheetName(item.product, used), xml: makeSheetXml(item) }));

    const wbSheets = sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
    const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets}</sheets></workbook>`;
    const rel = sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
    const ct = sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");

    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ct}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: wb },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` }
    ];

    sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml }));
    return zipStore(files);
  }

  function download(bytes, name) {
    const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
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
    const data = parseShipment(raw.value);
    if (!raw.value.trim()) {
      showToast("Please paste the complete Shipment Order text.");
      raw.focus();
      return;
    }

    const errors = validateParsedData(data);
    if (errors.length) {
      updatePreview();
      showToast(errors[0]);
      return;
    }

    const bytes = buildXlsx(data.items);
    const d = new Date();
    const date = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
    const fileName = `${safeFilePart(data.shop)}_${safeFilePart(data.orderNo)}_${date}.xlsx`;

    download(bytes, fileName);
    showToast(`Excel downloaded • ${data.items.length} sheets • ${data.items.reduce((n, x) => n + x.serials.length, 0)} PCS`);
    setTimeout(() => {
      raw.value = "";
      preview.classList.add("hidden");
    }, 800);
  }

  generate.addEventListener("click", generateExcel);
  updatePreview();
})();
