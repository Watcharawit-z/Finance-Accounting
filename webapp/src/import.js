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

/** ไฟล์จากโปรแกรมบัญชีมักมีหลายแผ่นงาน และงบทดลองไม่ได้อยู่แผ่นแรกเสมอ
    จึงอ่านทุกแผ่นแล้วเลือกแผ่นที่อ่านเป็นงบทดลองได้จริง */
async function readXlsx(buf) {
  const files = await unzipEntries(buf, (n) =>
    n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const dec = new TextDecoder();
  const sheetNames = Object.keys(files).filter((n) => n.indexOf('worksheets') >= 0)
    .sort((a, b) => (Number(a.replace(/\D+/g, '')) || 0) - (Number(b.replace(/\D+/g, '')) || 0));
  if (!sheetNames.length) throw new DomainError('NO_SHEET', 'ไม่พบแผ่นงานในไฟล์นี้');
  const shared = parseSharedStrings(files['xl/sharedStrings.xml'] ? dec.decode(files['xl/sharedStrings.xml']) : null);

  let best = null;
  sheetNames.forEach(function (n) {
    const rows = parseSheetXml(dec.decode(files[n]), shared);
    if (!rows.length) return;
    const det = detectColumns(rows);
    const score = (det.ok ? 1e9 : 0) + det.usable * 1000 + rows.length;
    if (!best || score > best.score) best = { rows, score };
  });
  if (!best) throw new DomainError('EMPTY_FILE', 'ไฟล์นี้ไม่มีข้อมูล',
    'ตรวจว่าเลือกไฟล์ที่ดาวน์โหลดมาจริง ไม่ใช่ไฟล์เปล่า');
  return best.rows;
}

/* ---------- ตัวเลขจากไฟล์ภายนอก ---------- */
function parseAmount(s) {
  let t = String(s === null || s === undefined ? '' : s).trim();
  if (!t || t === '-' || t === '—') return '0';
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  t = t.replace(/[,\s฿]/g, '').replace(/^บาท/, '');
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  /* Excel เขียนจำนวนเล็ก ๆ เป็นรูปยกกำลัง เช่น 7.0000000000000007E-2 คือ 0.07
     ถ้าอ่านไม่ออกแล้วข้ามไป งบทดลองจะไม่สมดุลโดยหาสาเหตุไม่เจอ */
  if (!/^\d*(\.\d+)?([eE][+-]?\d+)?$/.test(t) || t === '') return null;
  if (/[eE]/.test(t)) {
    const n = Number(t);
    if (!isFinite(n)) return null;
    t = n.toFixed(6);
  }
  return (neg ? '-' : '') + t;
}

/* ---------- เดาคอลัมน์จากหัวตาราง ---------- */
const COL_HINTS = {
  code:   ['รหัสบัญชี', 'เลขที่บัญชี', 'เลขบัญชี', 'รหัสผังบัญชี', 'รหัส',
           'account code', 'accountcode', 'acc code', 'gl code', 'code', 'a/c'],
  name:   ['ชื่อบัญชี', 'ชื่อผังบัญชี', 'รายการบัญชี', 'ชื่อ',
           'account name', 'accountname', 'account title', 'description', 'name'],
  debit:  ['เดบิต', 'เดบิท', 'ดร.', 'debit', 'dr'],
  credit: ['เครดิต', 'เครดิท', 'คร.', 'credit', 'cr'],
};
/* คำที่บอกว่าคู่เดบิต/เครดิตนี้คือ "ยอดคงเหลือปลายงวด" ซึ่งเป็นคู่ที่เราต้องการ
   งบทดลองมักมีสามคู่: ยอดยกมา · เคลื่อนไหวระหว่างงวด · ยอดคงเหลือ */
const BALANCE_HINTS = ['ยอดคงเหลือ', 'คงเหลือ', 'ยอดสะสม', 'สะสม', 'ยอดยกไป', 'ยกไป',
                       'ปลายงวด', 'สิ้นงวด', 'balance', 'ending', 'closing', 'carryforward'];
/* คำที่บอกว่าเป็นคู่ยอดยกมาต้นงวด — ห้ามหยิบคู่นี้ไปเป็นยอดคงเหลือ */
const OPENING_HINTS = ['ยอดยกมา', 'ยกมา', 'ต้นงวด', 'opening', 'brought'];
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const hitsAny = (n, list) => list.some((h) => n.indexOf(norm(h)) >= 0);

/** เซลล์ที่ผสานกันใน Excel เก็บค่าไว้เฉพาะช่องซ้ายสุด ช่องที่เหลือว่าง
    ต้องลากค่าไปทางขวาก่อน ไม่งั้นหัวกลุ่มอย่าง "ยอดคงเหลือ" จะหายไปครึ่งหนึ่ง
    แต่บรรทัดที่มีข้อความช่องเดียวคือชื่อรายงาน ไม่ใช่หัวกลุ่ม ห้ามลากไปทับทั้งแถว */
function fillRight(row, width) {
  const filled = [];
  for (let j = 0; j < width; j++) {
    filled[j] = String(row[j] === undefined ? '' : row[j]).trim();
  }
  if (filled.filter(Boolean).length < 2) return filled;
  let last = '';
  return filled.map(function (v) {
    if (v) last = v;
    return v || last;
  });
}

/** หัวตารางอาจอยู่บรรทัดเดียว หรือกระจายสองบรรทัด (หัวกลุ่มบน หัวย่อยล่าง)
    จึงต้องลองทั้งสองแบบ ไม่ใช่ดูทีละบรรทัดอย่างเดียว */
function headerCandidates(rows) {
  const out = [];
  const n = Math.min(rows.length, 30);
  for (let i = 0; i < n; i++) {
    out.push({ row: i, span: 1, cells: (rows[i] || []).map((c) => String(c === undefined ? '' : c)) });
    if (i + 1 < n) {
      const w = Math.max((rows[i] || []).length, (rows[i + 1] || []).length);
      const top = fillRight(rows[i] || [], w);
      const bot = rows[i + 1] || [];
      const merged = [];
      for (let j = 0; j < w; j++) {
        merged[j] = top[j] + ' ' + String(bot[j] === undefined ? '' : bot[j]);
      }
      out.push({ row: i + 1, span: 2, cells: merged });
    }
  }
  return out;
}

/** คอลัมน์หนึ่งอาจเข้าได้หลายคำใบ้ เช่น "ชื่อบัญชี" เข้าทั้ง code (คำว่าบัญชี)
    และ name (คำว่าชื่อบัญชี) ต้องให้คำใบ้ที่ยาวกว่าชนะ ไม่ใช่ตัวที่เจอก่อน */
const BARE_CODE_HEADERS = ['บัญชี', 'ผังบัญชี', 'acct', 'account', 'a/c no'];
function bestKeyFor(text) {
  const n = norm(text);
  if (!n) return null;
  /* หัวคอลัมน์ที่เขียนสั้น ๆ ว่า "บัญชี" เฉย ๆ หมายถึงรหัสบัญชี
     ต้องตรงทั้งช่อง ไม่ใช่ไปเจอคำว่าบัญชีในชื่อรายงานยาว ๆ แล้วนับว่าใช่ */
  if (BARE_CODE_HEADERS.indexOf(n) >= 0) return 'code';
  let key = null, len = 0;
  Object.keys(COL_HINTS).forEach(function (k) {
    COL_HINTS[k].forEach(function (h) {
      const hn = norm(h);
      if (n.indexOf(hn) >= 0 && hn.length > len) { len = hn.length; key = k; }
    });
  });
  return key;
}

/** ชื่อชุดตัวเลข เอาจากหัวกลุ่มที่อยู่เหนือคำว่าเดบิต/เครดิต เช่น "ยอดยกมา" */
function pairLabel(text) {
  let t = String(text || '');
  ['เดบิต', 'เดบิท', 'debit', 'dr', 'เครดิต', 'เครดิท', 'credit', 'cr']
    .forEach(function (w) { t = t.replace(new RegExp(w, 'gi'), ' '); });
  return t.replace(/\s+/g, ' ').trim();
}

function mapFromHeader(cells) {
  const found = {}, bal = {};
  const drCols = [], crCols = [];
  cells.forEach(function (cell, j) {
    const n = norm(cell);
    if (!n) return;
    const isBalance = hitsAny(n, BALANCE_HINTS) && !hitsAny(n, OPENING_HINTS);
    const k = bestKeyFor(cell);
    if (!k) return;
    if (k === 'debit' || k === 'credit') {
      found[k] = j;                                    // ไม่เจอคำว่ายอดคงเหลือ ให้เอาคู่ขวาสุด
      (k === 'debit' ? drCols : crCols).push({ col: j, label: pairLabel(cell) });
      if (isBalance && bal[k] === undefined) bal[k] = j;
    } else if (found[k] === undefined) found[k] = j;
  });
  /* งบทดลองมักมีหลายชุด (ยอดยกมา / ยอดประจำงวด / ยอดสะสม) เก็บไว้ให้ผู้ใช้เลือกได้
     ว่าจะตั้งยอดยกมาจากชุดไหน หรือจะลงยอดเคลื่อนไหวของเดือนจากชุดประจำงวด */
  found.pairs = [];
  for (let i = 0; i < Math.min(drCols.length, crCols.length); i++) {
    found.pairs.push({ debit: drCols[i].col, credit: crCols[i].col,
      label: drCols[i].label || crCols[i].label || ('ชุดที่ ' + (i + 1)) });
  }
  if (bal.debit !== undefined && bal.credit !== undefined) {
    found.debit = bal.debit; found.credit = bal.credit;
  }
  /* บางรายงานไม่แยกเดบิต/เครดิต มีคอลัมน์ยอดคงเหลือคอลัมน์เดียวติดลบเป็นเครดิต
     ให้ถือเป็นคอลัมน์เดบิตไว้ก่อน readTrialBalance จะพลิกยอดติดลบไปเครดิตให้เอง */
  if (found.debit === undefined && found.credit === undefined) {
    cells.forEach(function (cell, j) {
      const n = norm(cell);
      if (!n || found.debit !== undefined) return;
      if (hitsAny(n, BALANCE_HINTS) || hitsAny(n, ['จำนวนเงิน', 'ยอดเงิน', 'amount'])) found.debit = j;
    });
  }
  return found;
}

/** นับว่าใต้หัวตารางนี้มีบรรทัดที่อ่านเป็นบัญชีพร้อมยอดได้จริงกี่บรรทัด
    หัวตารางที่เดาถูกจะมีบรรทัดใช้ได้เยอะ ตัวที่เดามั่วจะได้ศูนย์ */
function countUsable(rows, map, headerRow) {
  if (map.code === undefined && map.name === undefined) return 0;
  if (map.debit === undefined && map.credit === undefined) return 0;
  let n = 0;
  rows.slice(headerRow + 1).forEach(function (r) {
    const code = String(r[map.code] === undefined ? '' : r[map.code]).trim();
    const name = String(r[map.name] === undefined ? '' : r[map.name]).trim();
    if (!code && !name) return;
    const dr = map.debit === undefined ? '0' : parseAmount(r[map.debit]);
    const cr = map.credit === undefined ? '0' : parseAmount(r[map.credit]);
    if (dr === null || cr === null) return;
    if (M(dr) === 0 && M(cr) === 0) return;
    n++;
  });
  return n;
}

const COL_KEYS = ['code', 'name', 'debit', 'credit'];
const countKeys = (map) => COL_KEYS.filter((k) => map[k] !== undefined).length;

function detectColumns(rows) {
  let bestScore = -1, best = null;
  headerCandidates(rows).forEach(function (c) {
    const map = mapFromHeader(c.cells);
    const keys = countKeys(map);
    if (keys < 2) return;
    const usable = countUsable(rows, map, c.row);
    /* จำนวนคอลัมน์ที่จับได้มาก่อน แล้วค่อยดูว่าอ่านข้อมูลจริงได้กี่บรรทัด
       บรรทัดที่อ่านได้เป็นตัวตัดสินเวลาหัวตารางหน้าตาคล้ายกันหลายบรรทัด */
    const score = keys * 100000 + Math.min(usable, 99999);
    if (score > bestScore) { bestScore = score; best = { headerRow: c.row, map, keys, usable }; }
  });
  if (!best) return { headerRow: 0, map: {}, keys: 0, usable: 0, ok: false };
  inferNameColumn(rows, best.map, best.headerRow);
  const keys = countKeys(best.map);
  return { headerRow: best.headerRow, map: best.map, keys, usable: best.usable,
           pairs: best.map.pairs || [], ok: keys >= 3 && best.usable > 0 };
}

/** งบทดลองบางฉบับใส่หัวคอลัมน์ไว้แค่ "บัญชี" ช่องเดียว ช่องชื่อบัญชีข้าง ๆ ไม่มีหัว
    ถ้าปล่อยว่างไว้ บัญชีทุกตัวจะไม่มีชื่อ จับคู่ผังบัญชีไม่ได้และผู้ใช้อ่านไม่รู้เรื่อง
    จึงมองหาคอลัมน์ถัดจากรหัสที่เป็นข้อความล้วนแล้วถือว่าเป็นชื่อบัญชี */
function inferNameColumn(rows, map, headerRow) {
  if (map.name !== undefined || map.code === undefined) return;
  const body = rows.slice(headerRow + 1, headerRow + 40)
    .filter((r) => String(r[map.code] === undefined ? '' : r[map.code]).trim() !== '');
  if (!body.length) return;
  for (let j = map.code + 1; j <= map.code + 4; j++) {
    if (j === map.debit || j === map.credit) continue;
    let text = 0, filled = 0;
    body.forEach(function (r) {
      const v = String(r[j] === undefined ? '' : r[j]).trim();
      if (!v) return;
      filled++;
      if (parseAmount(v) === null) text++;
    });
    if (filled >= body.length * 0.6 && text >= filled * 0.8) { map.name = j; return; }
  }
}

/* ---------- ไฟล์นี้คือรายงานอะไร ----------
   งบทดลองมีบัญชีละบรรทัด ส่วนบัญชีแยกประเภทมีรายการละบรรทัด รหัสบัญชีเดิมซ้ำได้เป็นร้อย
   ถ้าเผลอนำบัญชีแยกประเภทเข้าเป็นยอดยกมา ยอดจะกลายเป็นผลรวมรายการทั้งปี ไม่ใช่ยอดคงเหลือ */
const LEDGER_HINTS = ['เลขที่เอกสาร', 'สมุดรายวัน', 'เลขที่อ้างอิง', 'ผู้ทำรายการ',
                      'คำอธิบายรายการ', 'voucher', 'journal', 'document no'];
const CHART_HINTS = ['ประเภทบัญชี', 'หมวดบัญชี', 'account type', 'category'];

function detectFileKind(rows, map, headerRow) {
  const head = (rows[headerRow] || []).concat(rows[headerRow - 1] || []);
  const headText = head.map((c) => norm(c)).join('|');
  const ledgerWords = LEDGER_HINTS.filter((h) => headText.indexOf(norm(h)) >= 0).length;

  let repeated = 0;
  if (map.code !== undefined) {
    const seen = {};
    rows.slice(headerRow + 1).forEach(function (r) {
      const c = String(r[map.code] === undefined ? '' : r[map.code]).trim();
      if (!c) return;
      seen[c] = (seen[c] || 0) + 1;
      if (seen[c] === 2) repeated++;
    });
  }
  if (ledgerWords >= 2 || repeated >= 3) return 'ledger';
  if (map.debit === undefined && map.credit === undefined
      && CHART_HINTS.some((h) => headText.indexOf(norm(h)) >= 0)) return 'chart';
  return 'trialBalance';
}

/* ---------- อ่านงบทดลอง ---------- */
function readTrialBalance(rows, map, headerRow) {
  const out = [], skipped = [];
  rows.slice(headerRow + 1).forEach(function (r, i) {
    const code = String(r[map.code] === undefined ? '' : r[map.code]).trim();
    const name = String(r[map.name] === undefined ? '' : r[map.name]).trim();
    const dr = map.debit === undefined ? '0' : parseAmount(r[map.debit]);
    const cr = map.credit === undefined ? '0' : parseAmount(r[map.credit]);
    if (!code && !name) return;
    if (dr === null || cr === null) { skipped.push({ line: headerRow + 2 + i, code, name, why: 'ตัวเลขอ่านไม่ออก' }); return; }
    let debit = M(dr), credit = M(cr);
    /* บางรายงานมีคอลัมน์ยอดคงเหลือคอลัมน์เดียว ติดลบแปลว่าด้านเครดิต */
    if (debit < 0 && credit === 0) { credit = -debit; debit = 0; }
    else if (credit < 0 && debit === 0) { debit = -credit; credit = 0; }
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
/* ===================================================================
   ผังบัญชีมาตรฐานกรมพัฒนาธุรกิจการค้า — โปรแกรมบัญชีไทยส่วนใหญ่รวมทั้ง
   FlowAccount ใช้โครงรหัสชุดนี้ จึงเดาได้ว่าบัญชีแต่ละตัวไปอยู่บรรทัดไหนของงบ
   เรียงจากรหัสยาวไปสั้น ตัวที่ตรงยาวที่สุดชนะ
   =================================================================== */
const DBD_SUBTYPE = [
  // สินทรัพย์
  ['11149','cash'], ['11189','cash'], ['1111','cash'],
  ['1112','bank'],
  ['112','short_term_investment'],
  ['11310','trade_receivable'], ['1131','trade_receivable'],
  ['11392','accrued_income'],
  ['1132','other_receivable'], ['11379','other_receivable'], ['1139','other_receivable'],
  ['114','other_receivable'],
  ['115','inventory'],
  ['11911','prepaid_expense'], ['1191','prepaid_expense'],
  ['1192','deposit_paid'],
  ['119','other_current_asset'],
  ['122','long_term_investment'],
  ['12619','ppe_land'], ['12618','cip'], ['126','ppe'],
  ['127','intangible'],
  ['123','other_asset'], ['124','other_asset'], ['125','other_asset'], ['129','other_asset'],
  ['17113','input_vat'], ['1711','input_vat'],
  ['17120','wht_asset'], ['1712','wht_asset'],
  ['1713','prepaid_cit'],
  ['17140','vat_receivable'], ['1714','vat_receivable'],
  ['17','other_current_asset'],
  ['182','long_term_investment'], ['183','ar_allowance'], ['184','other_asset'],
  ['185','inventory_allowance'], ['186','accum_depreciation'], ['187','accum_amortization'],
  ['18','other_asset'],
  ['19','other_current_asset'],
  // หนี้สิน
  ['21310','trade_payable'], ['2131','trade_payable'],
  ['21951','accrued_payroll'], ['21952','sso_payable'], ['2195','accrued_payroll'],
  ['2191','accrued_expense'], ['2192','customer_deposit'],
  ['211','other_payable'], ['213','other_payable'], ['214','other_payable'],
  ['215','other_payable'], ['218','other_payable'], ['219','other_payable'],
  ['22','long_term_loan'],
  ['27110','output_vat'], ['2711','output_vat'],
  ['27123','wht_payable_pnd3'], ['27124','wht_payable_pnd53'],
  ['27121','wht_payable_pnd1'], ['27122','wht_payable_pnd1'], ['2712','wht_payable_pnd53'],
  ['2713','cit_payable'], ['27140','vat_payable'], ['2714','vat_payable'],
  ['27','other_payable'],
  // ส่วนของผู้ถือหุ้น
  ['31','paid_up_capital'], ['32','paid_up_capital'], ['33','legal_reserve'],
  ['34','retained_earnings'], ['39','retained_earnings'],
  // รายได้
  ['411','sales_revenue'], ['412','service_revenue'],
  ['49010','interest_income'], ['4901','interest_income'], ['4904','rental_revenue'],
  ['47','other_income'], ['49','other_income'],
  // ค่าใช้จ่าย
  ['51111','purchases'], ['51121','purchases'], ['51','cogs'],
  ['52','selling_expense'],
  ['53012','sso_expense'], ['53','admin_expense'],
  ['54','finance_cost'],
  ['5831','bad_debt'], ['5852','inventory_writeoff'], ['5853','inventory_writeoff'],
  ['5871','amortization'], ['586','depreciation'], ['58','depreciation'],
  ['57','admin_expense'],
  ['59920','non_deductible'], ['59995','non_deductible'], ['59','admin_expense'],
];
const DBD_BY_LEAD = { '1':'other_current_asset', '2':'other_payable', '3':'retained_earnings',
                      '4':'other_income', '5':'admin_expense' };
/* subType ที่โครงงบการเงินรองรับแล้ว แต่ผังบัญชีตั้งต้นของเรายังไม่มีบัญชีใช้
   ต้องบอกประเภทไว้ตรงนี้ ไม่งั้นบัญชีที่นำเข้ามาจะไม่มีประเภทแล้วสร้างไม่ได้ */
const EXTRA_SUBTYPE_TYPE = {
  short_term_investment: 'asset',
  other_current_asset: 'asset',
};

/** ประเภทบัญชีของ subType หนึ่ง ๆ อ้างจากผังบัญชีของระบบเราก่อน */
function subTypeType(sub) {
  const a = DB.accounts.find((x) => x.subType === sub);
  return a ? a.type : (EXTRA_SUBTYPE_TYPE[sub] || null);
}

/** เดาว่าบัญชีรหัสนี้ควรไปอยู่บรรทัดไหนของงบการเงิน */
function inferSubType(code) {
  const c = String(code || '').trim().replace(/[^0-9]/g, '');
  if (!c) return null;
  let best = null, len = 0;
  DBD_SUBTYPE.forEach(function (p) {
    if (c.indexOf(p[0]) === 0 && p[0].length > len) { len = p[0].length; best = p[1]; }
  });
  return best || DBD_BY_LEAD[c[0]] || null;
}

/** บัญชีที่จะสร้างใหม่จากรหัสในงบทดลองของระบบเดิม */
function proposeAccount(code, name) {
  const sub = inferSubType(code);
  if (!sub) return null;
  const type = subTypeType(sub);
  if (!type) return null;
  return {
    code: String(code).trim(),
    name: String(name || '').trim() || ('บัญชี ' + String(code).trim()),
    type, subType: sub, postable: true, requiresPartner: false,
    level: 3, imported: true,
  };
}

function matchAccount(code, name) {
  const byCode = DB.accounts.find((a) => a.postable && a.code === String(code).trim());
  if (byCode) return byCode.code;
  const n = norm(name);
  if (!n) return null;
  const byName = DB.accounts.find((a) => a.postable && norm(a.name) === n);
  return byName ? byName.code : null;
}

const EXTRA_SUBTYPE_LABEL = {
  short_term_investment: 'เงินลงทุนชั่วคราว',
  other_current_asset: 'สินทรัพย์หมุนเวียนอื่น',
};
/** ชื่อไทยของ subType — ยืมชื่อบัญชีตัวแรกในผังของเราที่ใช้ subType นั้น */
function subTypeLabel(sub) {
  const a = DB.accounts.find((x) => x.subType === sub);
  return a ? a.name : (EXTRA_SUBTYPE_LABEL[sub] || sub);
}
/** บัญชี subType นี้ไปโผล่บรรทัดไหนของงบการเงิน */
function fsLineOf(sub) {
  let label = null;
  BS_LINES.concat(PL_LINES).forEach(function (L) {
    if (!label && L.k === 'd' && (L.sub || []).indexOf(sub) >= 0) label = L.label;
  });
  return label;
}
/** ตัวเลือกทั้งหมดสำหรับ "บัญชีใหม่นี้ควรอยู่บรรทัดไหนของงบ" */
function fsChoices() {
  const out = [];
  BS_LINES.concat(PL_LINES).forEach(function (L) {
    if (L.k !== 'd') return;
    (L.sub || []).forEach(function (sub) {
      if (subTypeType(sub)) out.push({ sub, group: L.label, label: subTypeLabel(sub) });
    });
  });
  return out;
}

/**
 * ตรวจก่อนนำเข้า — บอกให้ครบว่าจะเกิดอะไรขึ้น ก่อนแตะบัญชีจริง
 * overrides: { 'รหัสเดิม': 'รหัสในผังบัญชีเรา' } หรือ { 'รหัสเดิม': '+subType' }
 *   '+subType' = ให้สร้างบัญชีใหม่ด้วยรหัสและชื่อเดิม แล้ววางไว้บรรทัดนั้นของงบ
 */
function previewOpening(tbRows, overrides) {
  overrides = overrides || {};
  const matched = [], creating = [], unmatched = [];
  let totalDr = 0, totalCr = 0;
  tbRows.forEach(function (r) {
    const key = r.code || r.name;
    const ov = overrides[key];
    totalDr += r.debit; totalCr += r.credit;

    /* ผู้ใช้สั่งให้สร้างบัญชีใหม่ในบรรทัดงบที่เลือกเอง */
    if (ov && ov.charAt(0) === '+') {
      const sub = ov.slice(1);
      const t = subTypeType(sub);
      if (t) {
        creating.push({ ...r, subType: sub, type: t, fsLine: fsLineOf(sub) });
        return;
      }
    }
    const target = (ov && ov.charAt(0) !== '+' ? ov : null) || matchAccount(r.code, r.name);
    if (target && acc(target)) {
      matched.push({ ...r, target, targetName: acc(target).name });
      return;
    }
    /* ไม่มีในผังของเรา แต่รหัสเป็นผังมาตรฐานกรมพัฒน์ เดาบรรทัดงบให้แล้วสร้างใหม่
       ดีกว่าบังคับให้ผู้ใช้จับคู่บัญชีเองเป็นร้อยบรรทัด และเก็บรหัสเดิมไว้ได้ด้วย */
    const p = proposeAccount(r.code, r.name);
    if (p) {
      creating.push({ ...r, subType: p.subType, type: p.type, fsLine: fsLineOf(p.subType) });
      return;
    }
    unmatched.push(r);
  });
  return {
    matched, creating, unmatched, totalDr, totalCr,
    diff: totalDr - totalCr,
    balanced: totalDr === totalCr,
    ready: totalDr === totalCr && unmatched.length === 0 && (matched.length + creating.length) > 0,
  };
}

/* ===================================================================
   นำตัวเลขจากงบทดลองเข้าระบบ — มีสองแบบ อย่าสับกัน
   1. ยอดยกมา (opening)  ใช้คอลัมน์ยอดคงเหลือ/ยอดสะสม ลงใบสำคัญใบเดียว ณ วันตัดยอด
      เหมาะกับการเริ่มใช้ระบบ ไม่สนใจว่ารายได้ค่าใช้จ่ายเกิดเดือนไหน
   2. ยอดเคลื่อนไหวรายเดือน (movement)  ใช้คอลัมน์ยอดประจำงวด ลงใบสำคัญเดือนละใบ
      เหมาะกับการย้ายปีปัจจุบันเข้ามาให้งบกำไรขาดทุนรายเดือนถูกต้อง
      ต้องโหลดงบทดลองแยกเดือนละไฟล์ ไม่ใช่ไฟล์รายปีไฟล์เดียว
   =================================================================== */
function importedEntry(srcId) {
  return DB.entries.find((e) => e.src === 'import' && e.srcId === srcId && e.status === 'posted');
}

function runImport(tbRows, overrides, o) {
  const p = previewOpening(tbRows, overrides);
  if (!p.matched.length && !p.creating.length && !p.unmatched.length) {
    throw new DomainError('NOTHING_TO_IMPORT', 'ไม่พบบรรทัดที่มียอดในไฟล์นี้');
  }
  if (!p.balanced) {
    throw new DomainError('IMPORT_UNBALANCED',
      'ตัวเลขในไฟล์ไม่สมดุล เดบิตรวม ' + fmt(p.totalDr) + ' เครดิตรวม ' + fmt(p.totalCr)
        + ' ต่างกัน ' + fmt(p.diff),
      'ตรวจว่าเลือกชุดตัวเลขถูกชุด — งบทดลองมักมีทั้งยอดยกมา ยอดประจำงวด และยอดสะสม');
  }
  if (p.unmatched.length) {
    throw new DomainError('ACCOUNT_UNMATCHED',
      'ยังจับคู่บัญชีไม่ครบ เหลือ ' + p.unmatched.length + ' บัญชี',
      'เลือกบัญชีปลายทางให้ครบทุกบรรทัดก่อนนำเข้า');
  }
  /* ใบที่กลับรายการไปแล้วไม่นับว่าซ้ำ ไม่งั้นยกเลิกแล้วนำเข้าใหม่ไม่ได้ */
  if (importedEntry(o.srcId)) {
    throw new DomainError('ALREADY_IMPORTED', o.dupMessage,
      'ถ้าต้องการนำเข้าใหม่ ให้กดยกเลิกการนำเข้าครั้งนั้นก่อน');
  }

  /* สร้างบัญชีที่ยังไม่มีในผังก่อน โดยใช้รหัสและชื่อเดิมของระบบเก่า
     ทำหลังผ่านการตรวจทุกข้อแล้วเท่านั้น จะได้ไม่ทิ้งบัญชีค้างไว้เวลานำเข้าไม่ผ่าน */
  const created = [];
  p.creating.forEach(function (r) {
    const code = String(r.code || '').trim() || r.name;
    if (DB.accounts.find((a) => a.code === code)) return;
    const a = { code, name: r.name || ('บัญชี ' + code), type: r.type, subType: r.subType,
      postable: true, requiresPartner: false, level: 3, imported: true };
    DB.accounts.push(a);
    created.push(a);
  });
  DB.accounts.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  // รวมบรรทัดที่ชี้ไปบัญชีเดียวกัน แล้วสุทธิเป็นด้านเดียว
  const net = {};
  p.matched.forEach(function (r) { net[r.target] = (net[r.target] || 0) + r.debit - r.credit; });
  p.creating.forEach(function (r) {
    const code = String(r.code || '').trim() || r.name;
    net[code] = (net[code] || 0) + r.debit - r.credit;
  });
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
    type: o.type, date: o.date, desc: o.desc,
    src: 'import', srcId: o.srcId,
    lines: lines,
  });
  audit('import', o.srcId, 'run', null,
    { accounts: lines.length, created: created.length, total: fmt(p.totalDr) });
  return { entry: je, accounts: lines.length, created: created.length, total: p.totalDr };
}

/** ยอดยกมา — ใบสำคัญใบเดียว ณ วันตัดยอด */
function importOpeningBalances(tbRows, date, overrides) {
  return runImport(tbRows, overrides, {
    date: date, type: 'opening', srcId: 'opening|' + date,
    desc: 'ยอดยกมาจากระบบเดิม ณ ' + thDate(date),
    dupMessage: 'นำเข้ายอดยกมา ณ ' + thDate(date) + ' ไปแล้ว',
  });
}

/** ยอดเคลื่อนไหวของเดือนหนึ่ง — ใบสำคัญเดือนละใบ ลงวันสิ้นเดือน */
function importPeriodMovement(tbRows, period, overrides) {
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw new DomainError('PERIOD_REQUIRED', 'ต้องเลือกเดือนของยอดเคลื่อนไหวก่อน');
  }
  const date = endOfMonth(period + '-01');
  return runImport(tbRows, overrides, {
    date: date, type: 'general', srcId: 'movement|' + period,
    desc: 'ยอดเคลื่อนไหวจากระบบเดิม งวด ' + thPeriod(period),
    dupMessage: 'นำเข้ายอดเคลื่อนไหวงวด ' + thPeriod(period) + ' ไปแล้ว',
  });
}

/** รายการนำเข้าทั้งหมดที่เคยทำ พร้อมสถานะ เพื่อให้ย้อนกลับได้ */
function listImports() {
  return DB.entries.filter((e) => e.src === 'import').map(function (e) {
    const kind = String(e.srcId || '').split('|')[0];
    return {
      no: e.no, date: e.date, desc: e.desc, status: e.status,
      kind: kind === 'movement' ? 'movement' : 'opening',
      key: String(e.srcId || '').split('|')[1] || '',
      lines: e.lines.length,
      total: e.lines.reduce((s, l) => s + (l.dr || 0), 0),
      reversedBy: e.reversedBy || null,
    };
  });
}

/** ยกเลิกการนำเข้า — กลับรายการตามกฎหมาย ไม่ลบทิ้ง แล้วนำเข้าใหม่ได้ */
function reverseImport(entryNo, reason) {
  const e = DB.entries.find((x) => x.no === entryNo);
  if (!e || e.src !== 'import') {
    throw new DomainError('NOT_AN_IMPORT', 'ใบสำคัญ ' + entryNo + ' ไม่ใช่รายการที่มาจากการนำเข้า');
  }
  return reverse(entryNo, reason || 'ยกเลิกการนำเข้าเพื่อนำเข้าใหม่ให้ถูกต้อง', e.date);
}

/* ===================================================================
   แฟ้มข้อมูลจากตัวดึง FlowAccount (financii-import/1 — รับของเดิม duly-import/1 ด้วย)
   =================================================================== */
const PACKAGE_FORMATS = ['financii-import/1', 'duly-import/1'];   // รับของเดิมด้วย
function validatePackage(pkg) {
  if (!pkg || PACKAGE_FORMATS.indexOf(pkg.format) < 0) {
    throw new DomainError('BAD_PACKAGE',
      'ไฟล์นี้ไม่ใช่แฟ้มข้อมูลของระบบ (ต้องเป็น financii-import/1)',
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

function upsertEmployee(e) {
  const rec = {
    code: e.code, name: e.name, dept: e.dept || 'ไม่ระบุ',
    salary: M(e.salary || '0'), otHours: Number(e.otHours || 0),
    pvdRate: Number(e.pvdRate || 0), deductions: M(e.deductions || '0'),
    active: e.active !== false, hired: e.hired || null,
    nationalId: e.nationalId || null, ssoNumber: e.ssoNumber || null,
  };
  const at = DB.employees.findIndex((x) => x.code === rec.code);
  if (at >= 0) { DB.employees[at] = { ...DB.employees[at], ...rec }; return 0; }
  DB.employees.push(rec);
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
      paid: M(d.paid || '0'), credited: M(d.credited || '0'),
      bfPaid: M(d.paid || '0') + M(d.credited || '0'),
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
  const before = { partners: DB.partners.length, items: DB.items.length,
    employees: DB.employees.length };
  let newPartners = 0, newItems = 0, newEmployees = 0;
  (pkg.partners || []).forEach((p) => { newPartners += upsertPartner(p); });
  (pkg.items || []).forEach((i) => { newItems += upsertItem(i); });
  (pkg.employees || []).forEach((e) => { newEmployees += upsertEmployee(e); });

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
    partners: newPartners, items: newItems, employees: newEmployees,
    invoices: docs.inv, bills: docs.bill,
  });
  return {
    cutoff: pkg.cutoff, source: pkg.source || 'ไม่ระบุ',
    partners: newPartners, partnersSeen: (pkg.partners || []).length,
    items: newItems, itemsSeen: (pkg.items || []).length,
    employees: newEmployees, employeesSeen: (pkg.employees || []).length,
    invoices: docs.inv, bills: docs.bill,
    coverage: pkg.coverage || [],
    opening: opening,
    warnings: pkg.warnings || [],
    checks: rec.checks, allPassed: rec.allPassed,
    before: before,
  };
}
