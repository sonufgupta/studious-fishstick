(() => {
  'use strict';

  const state = { pdfFile: null, pages: [], result: null, pdfDoc: null };
  const $ = id => document.getElementById(id);

  function toast(msg, type='info') {
    const el = $('status');
    el.textContent = msg;
    el.className = `status ${type}`;
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function clean(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
  }

  function safeFilePart(s) {
    return clean(s).replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'SHOP';
  }

  function extractOrderNumber(so) {
    const m = clean(so).match(/\/\s*(\d+)\s*$/);
    return m ? m[1] : '';
  }

  function parseShop(lines) {
    const idx = lines.findIndex(x => /^Ship To$/i.test(clean(x)));
    if (idx >= 0) {
      for (let i = idx + 1; i < Math.min(idx + 6, lines.length); i++) {
        const s = clean(lines[i]).replace(/^\[\*\*|\*\*\]$/g, '');
        if (s && !/^\d/.test(s) && !/^Place of Supply/i.test(s)) return s;
      }
    }
    return '';
  }

  function parseSalesOrder(lines) {
    for (const l of lines) {
      const m = clean(l).match(/^Sales Order#\s*:\s*(.+)$/i);
      if (m) return clean(m[1]);
    }
    return '';
  }

  // Build visual-ish lines from PDF.js text items. We preserve y/x positions so
  // the parser can associate an item header with serials printed underneath it.
  function groupPageItems(items) {
    const words = items.map(it => ({
      text: clean(it.str),
      x: it.transform[4],
      y: it.transform[5],
      w: it.width || 0,
      h: it.height || 0
    })).filter(x => x.text);

    const rows = [];
    const tolerance = 3.2;
    for (const w of words.sort((a,b) => b.y - a.y || a.x - b.x)) {
      let row = rows.find(r => Math.abs(r.y - w.y) <= tolerance);
      if (!row) { row = { y: w.y, items: [] }; rows.push(row); }
      row.items.push(w);
    }
    rows.sort((a,b) => b.y - a.y);
    return rows.map(r => {
      r.items.sort((a,b) => a.x - b.x);
      return {
        y: r.y,
        items: r.items,
        text: clean(r.items.map(x => x.text).join(' '))
      };
    });
  }

  function parsePage(pageRows, pageNumber) {
    const out = [];
    for (let i = 0; i < pageRows.length; i++) {
      const row = pageRows[i].text;
      // Zoho PDF item header: "1 MONITOR..." / "2 Geonix..."
      const m = row.match(/^(\d+)\s+(.+?)$/);
      if (!m) continue;
      const no = Number(m[1]);
      if (!Number.isInteger(no) || no < 1 || no > 999) continue;
      if (/^Sales Order|^Shipment Order|^Order Date|^Total Qty|^Number of Boxes|^Weight|^Place of Supply|^Shipment Date|^Shipping Carrier|^TRACKING/i.test(m[2])) continue;
      if (/^Item\s*&\s*Description/i.test(m[2])) continue;

      // Only accept a row as an item if the next meaningful block contains Serial Number(s).
      // Item name is the first line after the item number. Model/warranty lines are ignored.
      let serialRow = -1;
      for (let j = i + 1; j < pageRows.length && j < i + 80; j++) {
        const t = pageRows[j].text;
        if (/^\d+\s+/.test(t) && j !== i) break;
        if (/Serial Number\(s\)\s*:/i.test(t)) { serialRow = j; break; }
      }
      if (serialRow < 0) continue;

      let itemName = clean(m[2]);
      // Zoho PDF often places HSN/Qty/Pcs on the same visual row as the item name.
      // Remove those trailing table columns before storing the product name.
      let headerQty = null;
      const tail = itemName.match(/\s+(\d{6,12})\s+(\d+)\s*(?:pcs?)?$/i);
      if (tail) { headerQty = Number(tail[2]); itemName = itemName.slice(0, tail.index).trim(); }
      itemName = itemName.replace(/\s+MODEL\s+NO\..*$/i, '').trim();
      const serialLines = [];
      let qty = headerQty;
      for (let j = serialRow; j < pageRows.length && j < serialRow + 100; j++) {
        const t = pageRows[j].text;
        if (j > serialRow && /^\d+\s+/.test(t)) break;
        if (j > serialRow && /^\d{6,12}\s+\d+$/i.test(t)) {
          const q = t.match(/^\d{6,12}\s+(\d+)$/);
          if (q) qty = Number(q[1]);
          break;
        }
        if (j > serialRow && /^\d+$/.test(t)) {
          // Some PDF text layers put the Qty alone on a line.
          const n = Number(t);
          if (n > 0 && n < 100000) qty = n;
        }
        const idx = t.search(/Serial Number\(s\)\s*:/i);
        if (idx >= 0) serialLines.push(t.slice(idx).replace(/^Serial Number\(s\)\s*:\s*/i, ''));
        else if (serialLines.length) serialLines.push(t);
      }

      const serialText = serialLines.join(' ');
      const serials = serialText
        .split(/[\s,;]+/)
        .map(s => s.trim())
        .filter(Boolean)
        .filter(s => /^[A-Za-z0-9][A-Za-z0-9._-]{5,}$/.test(s));

      if (!serials.length) continue;
      // Avoid capturing HSN/Qty/Pcs as serials.
      const filtered = serials.filter(s => !/^\d{6,12}$/.test(s) && !/^pcs?$/i.test(s));
      if (!filtered.length) continue;

      out.push({ no, product: itemName, serials: filtered, qty, page: pageNumber });
    }
    return out;
  }

  async function extractPdf(file) {
    if (!window.pdfjsLib) throw new Error('PDF engine is not loaded. Please refresh the page.');
    const bytes = await file.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
    state.pdfDoc = doc;
    const allRows = [];
    const items = [];
    const pageTexts = [];

    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const rows = groupPageItems(content.items);
      pageTexts.push(...rows.map(r => r.text));
      allRows.push({ page: p, rows });
      items.push(...parsePage(rows, p));
      await new Promise(r => setTimeout(r, 0));
    }

    // Deduplicate accidental repeats by item number + product + serial set.
    const unique = [];
    const seen = new Set();
    for (const item of items) {
      const key = `${item.no}|${item.product.toLowerCase()}|${item.serials.join(',').toLowerCase()}`;
      if (!seen.has(key)) { seen.add(key); unique.push(item); }
    }

    const shop = parseShop(pageTexts);
    const so = parseSalesOrder(pageTexts);
    const orderNumber = extractOrderNumber(so);
    const errors = [];

    if (!shop) errors.push('Shop Name detect nahi hua.');
    if (!so) errors.push('Sales Order detect nahi hua.');
    if (!orderNumber) errors.push('Sales Order ka last number detect nahi hua.');
    if (!unique.length) errors.push('Koi valid Item + Serial Number block detect nahi hua.');

    const serialSet = new Set();
    unique.forEach((it, idx) => {
      if (!it.product) errors.push(`Item ${idx + 1}: Item Name missing.`);
      if (!it.serials.length) errors.push(`Item ${idx + 1}: Serial Numbers missing.`);
      if (it.qty == null) errors.push(`Item ${idx + 1}: Qty detect nahi hui.`);
      else if (it.qty !== it.serials.length) errors.push(`Item ${idx + 1}: Qty ${it.qty} hai, lekin ${it.serials.length} serial मिले.`);
      it.serials.forEach(sn => {
        const k = sn.toUpperCase();
        if (serialSet.has(k)) errors.push(`Duplicate Serial Number: ${sn}`);
        serialSet.add(k);
      });
    });

    const result = { shop, so, orderNumber, items: unique, errors, pages: doc.numPages };
    state.result = result;
    return result;
  }

  function renderResult(r) {
    $('result').hidden = false;
    $('shopOut').textContent = r.shop || '—';
    $('soOut').textContent = r.so || '—';
    $('numOut').textContent = r.orderNumber || '—';
    $('itemOut').textContent = `${r.items.length} / ${r.items.reduce((n,x)=>n+x.serials.length,0)}`;
    $('itemList').innerHTML = r.items.map((x,i) => `<div class="item-result"><b>${i+1}. ${esc(x.product)}</b><span>${x.serials.length}/${x.qty ?? '?'} PCS • Page ${x.page}</span></div>`).join('');
    const ok = r.errors.length === 0;
    $('check').className = `check ${ok ? 'ok' : 'bad'}`;
    $('check').innerHTML = ok ? '✓ All items and serial numbers matched. Excel ready.' : `<b>CHECK REQUIRED</b><ul>${r.errors.map(e=>`<li>${esc(e)}</li>`).join('')}</ul>`;
    $('generateBtn').disabled = !ok;
  }

  function xmlEscape(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;'); }
  function crc32(bytes) { let crc=0^-1; for(let i=0;i<bytes.length;i++){ crc^=bytes[i]; for(let j=0;j<8;j++) crc=(crc>>>1)^(0xEDB88320&-(crc&1)); } return (crc^-1)>>>0; }
  const u16=n=>new Uint8Array([n&255,(n>>>8)&255]);
  const u32=n=>new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);
  function cat(...a){const n=a.reduce((x,y)=>x+y.length,0),o=new Uint8Array(n);let p=0;for(const x of a){o.set(x,p);p+=x.length;}return o;}
  function zip(files){const e=new TextEncoder(),lp=[],cp=[];let off=0;for(const f of files){const nb=e.encode(f.name),db=e.encode(f.data),c=crc32(db);const local=cat(new Uint8Array([80,75,3,4]),u16(20),u16(2048),u16(0),u16(0),u16(0),u32(c),u32(db.length),u32(db.length),u16(nb.length),u16(0),nb,db);const central=cat(new Uint8Array([80,75,1,2]),u16(20),u16(20),u16(2048),u16(0),u16(0),u16(0),u32(c),u32(db.length),u32(db.length),u16(nb.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off),nb);lp.push(local);cp.push(central);off+=local.length;}const cs=cat(...cp),ls=cat(...lp);return cat(ls,cs,new Uint8Array([80,75,5,6,0,0,0,0,...u16(files.length),...u16(files.length),...u32(cs.length),...u32(ls.length),0,0]));}
  function cell(ref,val,bold=false){return `<c r="${ref}" t="inlineStr"${bold?' s="1"':''}><is><t xml:space="preserve">${xmlEscape(val)}</t></is></c>`;}
  function num(ref,val,bold=false){return `<c r="${ref}"${bold?' s="1"':''}><v>${Number(val)||0}</v></c>`;}
  function sheetXml(item){let rows=[];rows.push(`<row r="1">${cell('A1',item.product,true)}</row>`);rows.push(`<row r="3">${cell('A3','S.No.',true)}${cell('B3','Serial Number',true)}</row>`);item.serials.forEach((s,i)=>rows.push(`<row r="${i+4}">${num('A'+(i+4),i+1)}${cell('B'+(i+4),s)}</row>`));const tr=item.serials.length+5;rows.push(`<row r="${tr}">${cell('A'+tr,'TOTAL PCS',true)}${num('B'+tr,item.serials.length,true)}</row>`);return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="12"/><col min="2" max="2" width="32"/></cols><sheetData>${rows.join('')}</sheetData></worksheet>`;}
  function sheetName(name,used){let b=clean(name).replace(/[\\/?*\[\]:]/g,'').slice(0,31)||'Item',c=b,n=1;while(used.has(c.toLowerCase())){const s='_'+n++;c=b.slice(0,31-s.length)+s;}used.add(c.toLowerCase());return c;}
  function makeXlsx(items){const used=new Set(), infos=items.map(x=>({name:sheetName(x.product,used),xml:sheetXml(x)}));const sheets=infos.map((x,i)=>`<sheet name="${xmlEscape(x.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('');const wb=`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;const rel=infos.map((x,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('');const ct=infos.map((x,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');const styles=`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0"/></cellXfs></styleSheet>`;const files=[{name:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ct}</Types>`},{name:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`},{name:'xl/workbook.xml',data:wb},{name:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel}</Relationships>`},{name:'xl/styles.xml',data:styles}];infos.forEach((x,i)=>files.push({name:`xl/worksheets/sheet${i+1}.xml`,data:x.xml}));return zip(files);}

  async function generate(){
    const r=state.result;
    if(!r || r.errors.length){toast('Pehle complete validation pass honi chahiye.','bad');return;}
    const bytes=makeXlsx(r.items);
    const date=new Date(); const d=`${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`;
    const name=`${safeFilePart(r.shop)}_${r.orderNumber}_${d}.xlsx`;
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    // Explicit cleanup: no localStorage, no IndexedDB, no retained PDF/text/result.
    $('pdfInput').value=''; $('preview').textContent=''; $('result').hidden=true; $('itemList').innerHTML='';
    state.pdfFile=null; state.pages=[]; state.result=null; state.pdfDoc=null;
    // Reload clears remaining JS object references from the page.
    setTimeout(()=>location.reload(),700);
  }

  $('pdfInput').addEventListener('change', async e => {
    const file=e.target.files?.[0]; if(!file) return;
    if(file.type!=='application/pdf' && !/\.pdf$/i.test(file.name)){toast('Sirf PDF file select karein.','bad');return;}
    state.pdfFile=file; $('fileName').textContent=file.name; $('preview').textContent='PDF read ho raha hai...'; $('generateBtn').disabled=true;
    try { toast('PDF ke sabhi pages extract ho rahe hain...','info'); const r=await extractPdf(file); renderResult(r); if(r.errors.length) toast('Extraction incomplete hai. Excel block kar diya gaya hai.','bad'); else toast(`Success: ${r.items.length} items / ${r.items.reduce((n,x)=>n+x.serials.length,0)} serials matched.`,'ok'); }
    catch(err){console.error(err);toast('PDF read nahi ho saka: '+err.message,'bad');}
  });
  $('generateBtn').addEventListener('click',generate);
  $('clearBtn').addEventListener('click',()=>{location.reload();});
})();
