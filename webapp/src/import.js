/* ===================================================================
   นำเข้าข้อมูลจากระบบบัญชีเดิม
   อ่านได้ทั้งไฟล์ Excel (.xlsx) ไฟล์ CSV และแฟ้มข้อมูลจากตัวดึง FlowAccount
   ทุกจำนวนเงินผ่าน M() เสมอ ไม่มีการคำนวณต่อจากทศนิยมลอยตัว
   =================================================================== */

/* ---------- CSV ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

/* ---------- .xlsx คือไฟล์ zip ที่ข้างในเป็น XML ---------- */
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new DomainError('XLSX_UNSUPPORTED',
      'เบราว์เซอร์นี้ยังแตกไฟล์ .xlsx ไม่ได้',
      'เปิดไฟล์ใน Excel แล้วสั่ง Save As เป็น CSV จากนั้นลากไฟล์ CSV มาวางแทน');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** อ่านสารบัญกลางของ zip แล้วคลายเฉพาะไฟล์ที่ต้องใช้ */
async function unzipEntries(buf, wanted) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 66000; i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    throw new DomainError('NOT_A_ZIP', 'ไฟล์นี้ไม่ใช่ไฟล์ .xlsx ที่อ่านได้',
      'ตรวจว่าเป็นไฟล์ Excel จริง ไม่ใช่ .xls รุ่นเก่าหรือไฟล์ที่เสียหาย');
  }
  let p = u32(b, eocd + 16);
  const count = u16(b, eocd + 10);
  const out = {};
  for (let i = 0; i < count; i++) {
    if (u32(b, p) !== 0x02014b50) break;
    const nameLen = u16(b, p + 28), extraLen = u16(b, p + 30), cmtLen = u16(b, p + 32);
    const method = u16(b, p + 10), csize = u32(b, p + 20), local = u32(b, p + 42);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + cmtLen;
    if (wanted && !wanted(name)) continue;
    const lnLen = u16(b, local + 26), leLen = u16(b, local + 28);
    const start = local + 30 + lnLen + leLen;
    const raw = b.subarray(start, start + csize);
    out[name] = method === 0 ? raw : await inflateRaw(raw);
  }
  return out;
}

const xmlDoc = (text) => new DOMParser().parseFromString(text, 'application/xml');

function parseSharedStrings(xml) {
  if (!xml) return [];
  const doc = xmlDoc(xml);
  return Array.from(doc.getElementsByTagName('si')).map(function (si) {
    return Array.from(si.getElementsByTagName('t')).map((t) => t.textContent).join('');
  });
}

const colIndex = (ref) => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

function parseSheetXml(xml, shared) {
  const doc = xmlDoc(xml);
  const rows = [];
  Array.from(doc.getElementsByTagName('row')).forEach(function (r) {
    const cells = [];
    Array.from(r.getElementsByTagName('c')).forEach(function (c) {
      const at = colIndex(c.getAttribute('r') || 'A');
      const t = c.getAttribute('t');
      let v = '';
      if (t === 'inlineStr') {
        v = Array.from(c.getElementsByTagName('t')).map((x) => x.textContent).join('');
      } else {
        const node = c.getElementsByTagName('v')[0];
        v = node ? node.textContent : '';
        if (t === 's') v = shared[Number(v)] || '';
      }
      cells[at >= 0 ? at : cells.length] = v;
    });
    for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  });
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

async function readXlsx(buf) {
  const files = await unzipEntries(buf, (n) =>
    n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dec = new TextDecoder();
  const sheetName = Object.keys(files).filter((n) => n.indexOf('worksheets') >= 0).sort()[0];
  if (!sheetName) throw new DomainError('NO_SHEET', 'ไม่พบแผ่นงานในไฟล์นี้');
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? dec.decode(files['xl/sharedStrings.xml']) : null);
  return parseSheetXml(dec.decode(files[sheetName]), shared);
}

/* ---------- ตัวเลขจากไฟล์ภายนอก ---------- */
function parseAmount(s) {
  let t = String(s === null || s === undefined ? '' : s).trim();
  if (!t || t === '-' || t === '—') return '0';
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[,\s฿]/g, '').replace(/^บาท/, '');
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  if (!/^\d*(\.\d+)?$/.test(t) || t === '') return null;
  return (neg ? '-' : '') + t;
}

/* ---------- เดาคอลัมน์จากหัวตาราง ---------- */
const COL_HINTS = {
  code:   ['รหัสบัญชี', 'เลขที่บัญชี', 'รหัส', 'account code', 'code', 'accountcode'],
  name:   ['ชื่อบัญชี', 'ชื่อ', 'account name', 'description', 'name'],
  debit:  ['เดบิต', 'debit', 'dr'],
  credit: ['เครดิต', 'credit', 'cr'],
};
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');

function detectColumns(rows) {
  let headerRow = -1, best = 0, map = {};
  rows.slice(0, 25).forEach(function (r, i) {
    const found = {};
    r.forEach(function (cell, j) {
      const n = norm(cell);
      if (!n) return;
      Object.keys(COL_HINTS).forEach(function (k) {
        if (COL_HINTS[k].some((h) => n.indexOf(norm(h)) >= 0)) {
          // งบทดลองมีเดบิต/เครดิตหลายคู่ เอาคู่ขวาสุดคือยอดคงเหลือปลายงวด
          if (k === 'debit' || k === 'credit' || found[k] === undefined) found[k] = j;
        }
      });
    });
    const score = Object.keys(found).length;
    if (score > best) { best = score; headerRow = i; map = found; }
  });
  return { headerRow, map, ok: best >= 3 };
}

/* ---------- อ่านงบทดลอง ---------- */
function readTrialBalance(rows, map, headerRow) {
  const out = [], skipped = [];
  rows.slice(headerRow + 1).forEach(function (r, i) {
    const code = String(r[map.code] === undefined ? '' : r[map.code]).trim();
    const name = String(r[map.name] === undefined ? '' : r[map.name]).trim();
    const dr = parseAmount(r[map.debit]);
    const cr = parseAmount(r[map.credit]);
    if (!code && !name) return;
    if (dr === null || cr === null) { skipped.push({ line: headerRow + 2 + i, code, name, why: 'ตัวเลขอ่านไม่ออก' }); return; }
    const debit = M(dr), credit = M(cr);
    if (debit === 0 && credit === 0) return;
    if (/^(รวม|total|ยอดรวม)/i.test(name) || /^(รวม|total)/i.test(code)) {
      skipped.push({ line: headerRow + 2 + i, code, name, why: 'บรรทัดผลรวม ข้ามอัตโนมัติ' });
      return;
    }
    out.push({ code, name, debit, credit });
  });
  return { rows: out, skipped };
}

/* ---------- จับคู่กับผังบัญชีของเรา ---------- */
function matchAccount(code, name) {
  const byCode = DB.accounts.find((a) => a.postable && a.code === String(code).trim());
  if (byCode) return byCode.code;
  const n = norm(name);
  if (!n) return null;
  const byName = DB.accounts.find((a) => a.postable && norm(a.name) === n);
  return byName ? byName.code : null;
}

/**
 * ตรวจก่อนนำเข้า — บอกให้ครบว่าจะเกิดอะไรขึ้น ก่อนแตะบัญชีจริง
 * overrides: { 'รหัสเดิม': 'รหัสในผังบัญชีเรา' }
 */
function previewOpening(tbRows, overrides) {
  overrides = overrides || {};
  const matched = [], unmatched = [];
  let totalDr = 0, totalCr = 0;
  tbRows.forEach(function (r) {
    const key = r.code || r.name;
    const target = overrides[key] || matchAccount(r.code, r.name);
    totalDr += r.debit; totalCr += r.credit;
    if (target) matched.push({ ...r, target, targetName: acc(target).name });
    else unmatched.push(r);
  });
  return {
    matched, unmatched, totalDr, totalCr,
    diff: totalDr - totalCr,
    balanced: totalDr === totalCr,
    ready: totalDr === totalCr && unmatched.length === 0 && matched.length > 0,
  };
}

function importOpeningBalances(tbRows, date, overrides) {
  const p = previewOpening(tbRows, overrides);
  if (!p.matched.length && !p.unmatched.length) {
    throw new DomainError('NOTHING_TO_IMPORT', 'ไม่พบบรรทัดที่มียอดในไฟล์นี้');
  }
  if (!p.balanced) {
    throw new DomainError('IMPORT_UNBALANCED',
      'งบทดลองในไฟล์ไม่สมดุล เดบิตรวม ' + fmt(p.totalDr) + ' เครดิตรวม ' + fmt(p.totalCr)
        + ' ต่างกัน ' + fmt(p.diff),
      'ตรวจว่าเลือกคอลัมน์เดบิตและเครดิตถูกคู่ และไฟล์ครอบคลุมทุกบัญชี');
  }
  if (p.unmatched.length) {
    throw new DomainError('ACCOUNT_UNMATCHED',
      'ยังจับคู่บัญชีไม่ครบ เหลือ ' + p.unmatched.length + ' บัญชี',
      'เลือกบัญชีปลายทางให้ครบทุกบรรทัดก่อนนำเข้า');
  }
  const srcId = 'opening|' + date;
  if (DB.entries.find((e) => e.src === 'import' && e.srcId === srcId)) {
    throw new DomainError('ALREADY_IMPORTED',
      'นำเข้ายอดยกมา ณ ' + thDate(date) + ' ไปแล้ว',
      'ถ้าต้องการนำเข้าใหม่ ให้กลับรายการใบสำคัญเดิมก่อน');
  }
  // รวมบรรทัดที่ชี้ไปบัญชีเดียวกัน แล้วสุทธิเป็นด้านเดียว
  const net = {};
  p.matched.forEach(function (r) { net[r.target] = (net[r.target] || 0) + r.debit - r.credit; });
  const lines = Object.keys(net).filter((c) => net[c] !== 0).map(function (c) {
    const a = acc(c);
    const l = net[c] > 0 ? { acc: c, dr: net[c] } : { acc: c, cr: -net[c] };
    if (a.requiresPartner) l.partner = 'OPENING';
    return l;
  });
  if (!DB.partners.find((x) => x.code === 'OPENING')) {
    DB.partners.push({ code:'OPENING', name:'ยอดยกมาจากระบบเดิม', taxId:null, address:'',
      branch:'00000', entityType:'juristic', kind:'customer', termDays:0, active:false });
  }
  const je = post({
    type: 'opening', date: date,
    desc: 'ยอดยกมาจากระบบเดิม ณ ' + thDate(date),
    src: 'import', srcId: srcId,
    lines: lines,
  });
  audit('import', srcId, 'run', null, { accounts: lines.length, total: fmt(p.totalDr) });
  return { entry: je, accounts: lines.length, total: p.totalDr };
}

/* ===================================================================
   แฟ้มข้อมูลจากตัวดึง FlowAccount (duly-import/1)
   =================================================================== */
function validatePackage(pkg) {
  if (!pkg || pkg.format !== 'duly-import/1') {
    throw new DomainError('BAD_PACKAGE',
      'ไฟล์นี้ไม่ใช่แฟ้มข้อมูลของระบบ (ต้องเป็น duly-import/1)',
      'ใช้ไฟล์ที่ได้จากคำสั่ง flowaccount-import convert');
  }
  if (!pkg.cutoff || !/^\d{4}-\d{2}-\d{2}$/.test(pkg.cutoff)) {
    throw new DomainError('BAD_CUTOFF', 'แฟ้มข้อมูลไม่ได้ระบุวันตัดยอดที่ถูกต้อง');
  }
  return pkg;
}

function upsertPartner(p) {
  const kind = p.kind === 'vendor' ? 'vendor' : 'customer';
  const rec = {
    code: p.code, name: p.name, taxId: p.taxId || null, address: p.address || '',
    branch: p.branch || (p.entityType === 'individual' ? null : '00000'),
    entityType: p.entityType === 'individual' ? 'individual' : 'juristic',
    kind: kind, termDays: Number(p.termDays || 0), whtCode: p.whtCode || null,
    creditLimit: M(p.creditLimit || '0'), active: true,
  };
  const at = DB.partners.findIndex((x) => x.code === rec.code);
  if (at >= 0) { DB.partners[at] = { ...DB.partners[at], ...rec }; return 0; }
  DB.partners.push(rec);
  return 1;
}

function upsertItem(i) {
  const rec = {
    code: i.code, name: i.name, category: i.category || 'ทั่วไป', uom: i.uom || 'หน่วย',
    type: i.type === 'service' ? 'service' : 'stock',
    avgCost: M(i.avgCost || '0'), price: M(i.price || '0'),
    qty: Number(i.qty || 0), reorder: Number(i.reorder || 0),
  };
  rec.value = rec.avgCost * rec.qty;
  const at = DB.items.findIndex((x) => x.code === rec.code);
  if (at >= 0) { DB.items[at] = { ...DB.items[at], ...rec }; return 0; }
  DB.items.push(rec);
  return 1;
}

/** เอกสารค้างยกมา — เป็นบัญชีย่อยเท่านั้น ไม่ลงบัญชีซ้ำ เพราะยอดอยู่ในงบทดลองแล้ว */
function importOpenDocs(pkg, entryNo) {
  let inv = 0, bill = 0;
  (pkg.openInvoices || []).forEach(function (d) {
    if (DB.docs.invoice.find((x) => x.no === d.no)) return;
    const base = M(d.base || '0'), vat = M(d.vat || '0');
    const total = d.total !== undefined ? M(d.total) : base + vat;
    DB.docs.invoice.push({
      no: d.no, legacyNo: d.legacyNo || d.no, date: d.date, due: d.due || d.date,
      partnerCode: d.partnerCode, partnerName: d.partnerName,
      snap: { name:d.partnerName, taxId:d.taxId || null, branch:d.branch || '00000', address:d.address || '' },
      lines: [{ desc:'ยอดค้างยกมาจากระบบเดิม', qty:1, price:base, amount:base, taxCode:'EXEMPT', uom:'', itemCode:null }],
      base: base, vat: vat, total: total,
      paid: M(d.paid || '0'), bfPaid: M(d.paid || '0'), credited: M(d.credited || '0'),
      status: 'issued', entryNo: entryNo, etax: 'not_applicable', broughtForward: true,
    });
    inv++;
  });
  (pkg.openBills || []).forEach(function (d) {
    if (DB.docs.bill.find((x) => x.no === d.no)) return;
    const base = M(d.base || '0'), vat = M(d.vat || '0');
    const total = d.total !== undefined ? M(d.total) : base + vat;
    DB.docs.bill.push({
      no: d.no, legacyNo: d.legacyNo || d.no, date: d.date, due: d.due || d.date,
      vendorNo: d.vendorNo || d.no, partnerCode: d.partnerCode, partnerName: d.partnerName,
      lines: [{ desc:'ยอดค้างยกมาจากระบบเดิม', qty:1, price:base, amount:base, itemCode:null }],
      base: base, vat: vat, total: total, claimable: true,
      paid: M(d.paid || '0'), bfPaid: M(d.paid || '0'), status: 'issued', entryNo: entryNo,
      whtCode: d.whtCode || null, broughtForward: true,
    });
    bill++;
  });
  return { inv, bill };
}

function importPackage(pkg, overrides) {
  validatePackage(pkg);
  const before = { partners: DB.partners.length, items: DB.items.length };
  let newPartners = 0, newItems = 0;
  (pkg.partners || []).forEach((p) => { newPartners += upsertPartner(p); });
  (pkg.items || []).forEach((i) => { newItems += upsertItem(i); });

  let opening = null;
  if (pkg.trialBalance && pkg.trialBalance.length) {
    const tb = pkg.trialBalance.map((r) => ({
      code: String(r.code || ''), name: String(r.name || ''),
      debit: M(r.debit || '0'), credit: M(r.credit || '0'),
    }));
    opening = importOpeningBalances(tb, pkg.cutoff, overrides);
  }
  const docs = importOpenDocs(pkg, opening ? opening.entry.no : null);

  const asOf = pkg.cutoff;
  const rec = reconciliationChecks(asOf);
  audit('import', 'package|' + pkg.cutoff, 'run', null, {
    partners: newPartners, items: newItems, invoices: docs.inv, bills: docs.bill,
  });
  return {
    cutoff: pkg.cutoff, source: pkg.source || 'ไม่ระบุ',
    partners: newPartners, partnersSeen: (pkg.partners || []).length,
    items: newItems, itemsSeen: (pkg.items || []).length,
    invoices: docs.inv, bills: docs.bill,
    opening: opening,
    warnings: pkg.warnings || [],
    checks: rec.checks, allPassed: rec.allPassed,
    before: before,
  };
}
