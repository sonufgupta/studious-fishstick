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
    showToast.t = setTimeout(() => toast.classList.remove("show"), 3000);
  };

  const cleanText = s => String(s || "").replace(/\r/g, "").trim();
  const stripMd = s => String(s || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[\*\*(.*?)\*\*\]/g, "$1")
    .replace(/\*\*/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#xA0;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  function extractShop(text) {
    const m = text.match(/Ship\s*To\s*(?:<br\s*\/?>|\n|\r\n)\s*(?:\[\s*)?\*{0,2}([^\]\n*|]+?)\*{0,2}(?:\]|\()/i);
    if (m) return stripMd(m[1]);
    const m2 = text.match(/Ship\s*To[\s\S]{0,80}?\[?\*{0,2}([^\]\n*|]+?)\*{0,2}\]?/i);
    return m2 ? stripMd(m2[1]) : "";
  }

  function extractInvoice(text) {
    const m = text.match(/Sales\s*Order\s*#?\s*:?\s*\|?\s*([A-Z]{1,10}\s*-\s*[A-Z]{1,10}\s*\/\s*[^\s|]+\s*\/\s*\d+)/i)
      || text.match(/Sales\s*Order\s*#?\s*:?\s*([^\n|]+)/i);
    return m ? stripMd(m[1]).trim() : "";
  }

  function extractOrderNumber(invoice) {
    const s = String(invoice || "").trim();
    const m = s.match(/\/\s*(\d+)\s*$/);
    if (m) return m[1];
    const nums = s.match(/\d+/g) || [];
    return nums.length ? nums[nums.length - 1] : "";
  }

  function parseSerials(cell) {
    const m = String(cell || "").match(/Serial\s*Number\(s\)\s*:\s*([\s\S]*)/i);
    if (!m) return [];
    return m[1]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\*+/g, "")
      .split(/[,\n]+/)
      .map(x => x.trim())
      .filter(x => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(x));
  }

  function extractItems(text) {
    const items = [];
    // Primary parser: Markdown table rows containing item number, description, HSN and quantity.
    const rowRe = /\|\s*\d+\s*\|\s*([\s\S]*?)\|\s*\d{4,12}\s*\|\s*\d+(?:\.\d+)?\s*\|\s*(?:pcs?|Pcs?)\s*\|/gi;
    let m;
    while ((m = rowRe.exec(text))) {
      const cell = m[1];
      const serials = parseSerials(cell);
      const beforeSerial = cell.split(/Serial\s*Number\(s\)\s*:/i)[0];
      const firstLine = beforeSerial.split(/<br\s*\/?>|\n/i)[0];
      const product = stripMd(firstLine).replace(/\s{2,}/g, " ").trim();
      if (product && serials.length) items.push({ product, serials });
    }

    // Fallback: handle pasted plain text where table pipes were removed.
    if (!items.length) {
      const chunks = text.split(/(?=\b\d+\s*[.)|]\s+)/g);
      chunks.forEach(chunk => {
        const sm = chunk.match(/Serial\s*Number\(s\)\s*:\s*([\s\S]*?)(?=\n\s*\d+\s*[.)|]|$)/i);
        if (!sm) return;
        const serials = sm[1].split(/[,\n]+/).map(x => x.trim()).filter(x => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(x));
        const product = stripMd(chunk.split(/Serial\s*Number\(s\)\s*:/i)[0]).replace(/^\d+\s*[.)|]\s*/, "").trim();
        if (product && serials.length) items.push({ product, serials });
      });
    }
    return items;
  }

  function parseShipment(text) {
    const t = cleanText(text);
    const invoice = extractInvoice(t);
    return { shop: extractShop(t), invoice, orderNo: extractOrderNumber(invoice), items: extractItems(t) };
  }

  function updatePreview() {
    const data = parseShipment(raw.value);
    if (!raw.value.trim()) { preview.classList.add("hidden"); return data; }
    const pieces = data.items.reduce((n, x) => n + x.serials.length, 0);
    preview.innerHTML = `
      <div class="preview-title">Auto Extracted</div>
      <div class="preview-grid">
        <div><span>Shop:</span> <b>${esc(data.shop || "Not detected")}</b></div>
        <div><span>Sales Order:</span> <b>${esc(data.invoice || "Not detected")}</b></div>
        <div><span>Last Number:</span> <b>${esc(data.orderNo || "Not detected")}</b></div>
        <div><span>Items / Serial PCS:</span> <b>${data.items.length} / ${pieces}</b></div>
      </div>`;
    preview.classList.remove("hidden");
    return data;
  }

  raw.addEventListener("input", updatePreview);
  raw.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); generateExcel(); }
  });
  clear.addEventListener("click", () => { raw.value = ""; preview.classList.add("hidden"); raw.focus(); });

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
  const safeFilePart = s => String(s || "SHOP").trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_").slice(0, 80);
  const xmlEscape = esc;

  function uniqueSheetName(name, used) {
    let base = String(name || "Item").replace(/[\\/\?\*\[\]\:]/g, "").trim().slice(0,31) || "Item";
    let candidate = base, n = 1;
    while (used.has(candidate.toLowerCase())) {
      const suffix = `_${n++}`;
      candidate = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  }

  function crc32(bytes) { let crc = -1; for (let i=0;i<bytes.length;i++){ crc ^= bytes[i]; for(let j=0;j<8;j++) crc=(crc>>>1)^(0xEDB88320&-(crc&1)); } return (crc^-1)>>>0; }
  const u16 = n => new Uint8Array([n&255,(n>>>8)&255]);
  const u32 = n => new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
  function concatBytes(...a){const n=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(n);let p=0;a.forEach(x=>{o.set(x,p);p+=x.length});return o;}
  function zipStore(files){
    const enc=new TextEncoder(), locals=[], centrals=[]; let offset=0;
    files.forEach(f=>{const nb=enc.encode(f.name),db=enc.encode(f.data),crc=crc32(db);const local=concatBytes(new Uint8Array([80,75,3,4]),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(db.length),u32(db.length),u16(nb.length),u16(0),nb,db);const central=concatBytes(new Uint8Array([80,75,1,2]),u16(20),u16(20),u16(0x800),u16(0),u16(0),u16(0),u32(crc),u32(db.length),u32(db.length),u16(nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),nb);locals.push(local);centrals.push(central);offset+=local.length;});
    const centralStart=offset,central=concatBytes(...centrals),local=concatBytes(...locals),end=concatBytes(new Uint8Array([80,75,5,6]),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(centralStart),u16(0));return concatBytes(local,central,end);
  }
  const inlineCell=(ref,v,s="")=>`<c r="${ref}" t="inlineStr"${s?` s="${s}"`:""}><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
  const numberCell=(ref,v,s="")=>`<c r="${ref}"${s?` s="${s}"`:""}><v>${Number(v)||0}</v></c>`;
  function makeSheetXml(item){
    const rows=[]; rows.push({r:1,c:[inlineCell("A1",item.product,"2")]}); rows.push({r:3,c:[inlineCell("A3","S.No.","1"),inlineCell("B3","Serial Number","1")]});
    item.serials.forEach((s,i)=>rows.push({r:i+4,c:[numberCell(`A${i+4}`,i+1),inlineCell(`B${i+4}`,s)]}));
    const total=item.serials.length+5; rows.push({r:total,c:[inlineCell(`A${total}`,"TOTAL PCS","3"),numberCell(`B${total}`,item.serials.length,"3")]});
    const rowXml=rows.map(x=>`<row r="${x.r}">${x.c.join("")}</row>`).join("");
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="55" customWidth="1"/></cols><sheetData>${rowXml}</sheetData></worksheet>`;
  }
  function buildXlsx(items){
    const used=new Set(), sheets=items.map(item=>({name:uniqueSheetName(item.product,used),xml:makeSheetXml(item)}));
    const wbSheets=sheets.map((s,i)=>`<sheet name="${xmlEscape(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("");
    const wb=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${wbSheets}</sheets></workbook>`;
    const rel=sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("");
    const ct=sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
    const files=[
      {name:"[Content_Types].xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ct}</Types>`},
      {name:"_rels/.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},
      {name:"xl/workbook.xml",data:wb},{name:"xl/_rels/workbook.xml.rels",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`},
      {name:"xl/styles.xml",data:`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf><xf numFmtId="0" fontId="1" fillId="0" borderId="0" applyAlignment="1"><alignment horizontal="left"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`}
    ];
    sheets.forEach((s,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:s.xml}));
    return zipStore(files);
  }

  function download(bytes,name){const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}

  function generateExcel(){
    const data=parseShipment(raw.value);
    if(!raw.value.trim()){showToast("Please paste the complete Shipment Order text.");raw.focus();return;}
    if(!data.shop){showToast("Shop Name detect nahi hua.");return;}
    if(!data.orderNo){showToast("Sales Order number detect nahi hua.");return;}
    if(!data.items.length){showToast("Item + Serial Number(s) detect nahi hue.");return;}
    const bytes=buildXlsx(data.items);
    const d=new Date(),date=`${String(d.getDate()).padStart(2,"0")}-${String(d.getMonth()+1).padStart(2,"0")}-${d.getFullYear()}`;
    const fileName=`${safeFilePart(data.shop)}_${safeFilePart(data.orderNo)}_${date}.xlsx`;
    download(bytes,fileName);
    showToast(`Excel downloaded • ${data.items.length} sheets • ${data.items.reduce((n,x)=>n+x.serials.length,0)} PCS`);
    setTimeout(()=>{raw.value="";preview.classList.add("hidden");},800);
  }
  generate.addEventListener("click",generateExcel);
  updatePreview();
})();
