/* ===================================================================
   นำเข้าข้อมูลจากระบบบัญชีเดิม
   อ่านได้ทั้งไฟล์ Excel (.xlsx) ไฟล์ CSV และแฟ้มข้อมูลจากตัวดึง FlowAccount
   ทุกจำนวนเงินผ่าน M() เสมอ ไม่มีการคำนวณต่อจากทศนิยมลอยตัว
   =================================================================== */

/* ---------- CSV ---------- */
/* แต่ละแถวจำเลขบรรทัดจริงในไฟล์ไว้ที่ row.line (นับแถวว่างด้วย)
   เวลาบอกว่า "ข้ามแถว 8" ผู้ใช้ต้องเปิดไฟล์แล้วเจอแถว 8 ตรงกัน ไม่ใช่แถวที่ 8 หลังตัดแถวว่างทิ้ง */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false, line = 1;
  const src = String(text).replace(/^\uFEFF/, '');
  const end = function () { row.push(cell); row.line = line++; rows.push(row); row = []; cell = ''; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n') end();
    else if (c !== '\r') cell += c;
  }
  if (cell !== '' || row.length) end();
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
}

/** ไฟล์ CSV จาก Excel ภาษาไทยบน Windows มักเป็นรหัส Windows-874 ไม่ใช่ UTF-8
    ถ้าอ่านเป็น UTF-8 ตรง ๆ ชื่อบัญชีจะเป็นตัวอักษรเพี้ยนและหาหัวตารางไม่เจอ
    จึงลอง UTF-8 แบบเข้มงวดก่อน อ่านไม่ผ่านค่อยถอดเป็น Windows-874 */
function decodeText(buf) {
  const b = new Uint8Array(buf);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); }
  catch (e) {
    try { return new TextDecoder('windows-874').decode(b); }
    catch (e2) { return new TextDecoder().decode(b); }
  }
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
    cells.line = Number(r.getAttribute('r')) || rows.length + 1;    // เลขแถวจริงใน Excel
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
/** แปลงข้อความในช่องตัวเลขเป็นสตริงทศนิยม (ยังไม่ปัด) หรือ null ถ้าอ่านไม่ออก
    รองรับ: วงเล็บ = ติดลบ, ลบท้าย (1,234.56-), เครื่องหมายลบยูนิโค้ด (−), ขีดแทนศูนย์ (- – —),
    ต่อท้ายด้วย บาท/THB/Dr/Cr, ตัวคั่นแบบยุโรป (1.234,56), รูปยกกำลังของ Excel (7.0000000000000007E-2) */
function parseAmount(s) {
  let t = String(s === null || s === undefined ? '' : s).replace(/[   ]/g, ' ').trim();
  if (!t || /^[-‐-―−]+$/.test(t)) return '0';
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  t = t.replace(/[\s฿]/g, '').replace(/บาท|THB/gi, '');
  /* ยอดคงเหลือคอลัมน์เดียวบางรายงานพิมพ์ด้านต่อท้าย เช่น 300,000.00 Cr */
  const side = t.match(/(dr|cr|เดบิต|เครดิต)\.?$/i);
  if (side) { if (/^(cr|เครดิต)/i.test(side[1])) neg = !neg; t = t.slice(0, side.index); }
  t = t.replace(/^[‐-―−]/, '-');
  if (/^[\d.,]+[-−]$/.test(t)) { neg = !neg; t = t.slice(0, -1); }
  if (t.startsWith('-')) { neg = !neg; t = t.slice(1); }
  if (t.startsWith('+')) t = t.slice(1);
  /* ทศนิยมแบบยุโรป 1.234,56 หรือ 1234,56 — ตัวคั่นหลักพันแบบไทยต้องตามด้วย 3 หลักเสมอ จึงแยกได้ไม่กำกวม */
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(t) || /^\d+,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  t = t.replace(/,/g, '');
  /* Excel เขียนจำนวนเล็ก ๆ เป็นรูปยกกำลัง เช่น 7.0000000000000007E-2 คือ 0.07
     ถ้าอ่านไม่ออกแล้วข้ามไป งบทดลองจะไม่สมดุลโดยหาสาเหตุไม่เจอ */
  if (!/^\d*(\.\d+)?([eE][+-]?\d+)?$/.test(t) || t === '' || t === '.') return null;
  if (/[eE]/.test(t)) {
    const n = Number(t);
    if (!isFinite(n)) return null;
    t = n.toFixed(6);
  }
  return (neg ? '-' : '') + t;
}

/** ปัดสตริงทศนิยมเป็นสตางค์ (ครึ่งขึ้น) ตรงจากตัวอักษร ไม่ผ่าน M() ก่อน
    ไม่งั้น 1234.56499 จะถูกปัดสองต่อเป็น 1234.5650 แล้วกลายเป็น 1,234.57 */
function satangOf(str) {
  const t = String(str).trim();
  const neg = t[0] === '-';
  const parts = t.replace('-', '').split('.');
  const frac = ((parts[1] || '') + '000').slice(0, 3);
  let cents = Number(parts[0] || '0') * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  const v = cents * (S / 100);
  return neg && v ? -v : v;
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
/* ชุดตัวเลขในงบทดลองมีสามบทบาท ต้องแยกให้ออก ไม่งั้นยอดเคลื่อนไหวจะถูกลงเป็นยอดคงเหลือ
   ทั้งที่ยังสมดุล (ทุกชุดในงบทดลองสมดุลในตัวเองเสมอ) จึงจับไม่ได้จากเดบิต = เครดิต */
/* ยอดยกมาต้นงวด — ต้องเช็กก่อนคำว่า balance เพราะ "Balance b/f" และ "ยอดคงเหลือต้นงวด" คือยอดยกมา */
const OPENING_HINTS = ['ยอดยกมา', 'ยกมา', 'ต้นงวด', 'ต้นปี', 'opening', 'brought', 'b/f', 'beginning'];
/* ยอดคงเหลือปลายงวด = ยอดที่ใช้ตั้งยอดยกมา */
const BALANCE_HINTS = ['ยอดคงเหลือ', 'คงเหลือ', 'ยอดสะสม', 'สะสม', 'ยอดยกไป', 'ยกไป',
                       'ปลายงวด', 'สิ้นงวด', 'balance', 'ending', 'closing', 'carryforward', 'carried', 'c/f'];
/* ยอดเคลื่อนไหวระหว่างงวด */
const MOVEMENT_HINTS = ['ประจำงวด', 'ระหว่างงวด', 'เคลื่อนไหว', 'งวดนี้', 'เดือนนี้',
                        'movement', 'activity', 'period'];
/* คอลัมน์ยอดสุทธิคอลัมน์เดียวท้ายตาราง = ยอดคงเหลือแบบมีเครื่องหมาย */
const NET_HINTS = ['รวมทั้งสิ้น', 'สุทธิ'];
const AMOUNT_HINTS = ['จำนวนเงิน', 'ยอดเงิน', 'amount'];
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const hitsAny = (n, list) => list.some((h) => n.indexOf(norm(h)) >= 0);

const ROLE_TH = { opening:'ยอดยกมา', movement:'ยอดเคลื่อนไหวระหว่างงวด', closing:'ยอดคงเหลือ', unknown:'ไม่ระบุ' };
function roleOf(label) {
  const n = norm(label);
  if (!n) return 'unknown';
  if (hitsAny(n, OPENING_HINTS)) return 'opening';
  if (hitsAny(n, BALANCE_HINTS)) return 'closing';
  if (hitsAny(n, MOVEMENT_HINTS)) return 'movement';
  if (hitsAny(n, NET_HINTS) || n === 'net' || n === 'netbalance') return 'closing';
  return 'unknown';
}

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

/** ชุดที่ยังไม่รู้บทบาท เดาจากตำแหน่ง — งบทดลองเรียง ยกมา · เคลื่อนไหว · คงเหลือ เสมอ
    เดาเฉพาะกรณีที่ไม่กำกวม ที่เหลือปล่อยไว้ให้ผู้ใช้เลือกเอง */
function inferRoles(sets) {
  const unk = sets.filter((x) => x.role === 'unknown');
  if (!unk.length || sets.length < 2) return;
  if (unk.length === 3 && sets.length === 3) {
    unk[0].role = 'opening'; unk[1].role = 'movement'; unk[2].role = 'closing';
    return;
  }
  unk.forEach(function (x) {
    const i = sets.indexOf(x);
    const before = sets.slice(0, i).map((y) => y.role), after = sets.slice(i + 1).map((y) => y.role);
    if (before.indexOf('opening') >= 0 && after.indexOf('closing') >= 0) x.role = 'movement';
    else if (after.indexOf('movement') >= 0 && before.indexOf('opening') < 0 && i === 0) x.role = 'opening';
    else if (before.indexOf('movement') >= 0 && after.indexOf('closing') < 0 && i === sets.length - 1) x.role = 'closing';
  });
}

function mapFromHeader(cells) {
  const found = {};
  const drCols = [], crCols = [], singles = [];
  cells.forEach(function (cell, j) {
    const n = norm(cell);
    if (!n) return;
    const k = bestKeyFor(cell);
    if (k === 'debit' || k === 'credit') {
      (k === 'debit' ? drCols : crCols).push({ col: j, label: pairLabel(cell) });
    } else if (k) {
      if (found[k] === undefined) found[k] = j;
    } else if (hitsAny(n, OPENING_HINTS) || hitsAny(n, BALANCE_HINTS) || hitsAny(n, MOVEMENT_HINTS)
               || hitsAny(n, NET_HINTS) || hitsAny(n, AMOUNT_HINTS)) {
      /* คอลัมน์ตัวเลขคอลัมน์เดียว (ติดลบ = เครดิต) เช่น "ยอดยกมา" "ยอดคงเหลือ" "รวมทั้งสิ้น" */
      singles.push({ col: j, label: String(cell).replace(/\s+/g, ' ').trim() });
    }
  });
  /* งบทดลองมักมีหลายชุด (ยอดยกมา / ยอดประจำงวด / ยอดสะสม) เก็บไว้ทุกชุดพร้อมบทบาท
     ผู้ใช้เลือกได้ว่าจะตั้งยอดยกมาจากชุดไหน หรือจะลงยอดเคลื่อนไหวของเดือนจากชุดประจำงวด */
  const sets = [];
  for (let i = 0; i < Math.min(drCols.length, crCols.length); i++) {
    sets.push({ kind: 'pair', debit: drCols[i].col, credit: crCols[i].col,
      label: drCols[i].label || crCols[i].label || '' });
  }
  const pairLabels = sets.map((x) => norm(x.label)).filter(Boolean);
  singles.forEach(function (x) {
    /* ช่องว่างคั่นระหว่างกลุ่มในหัวตารางสองชั้นจะได้ชื่อกลุ่มติดมา (เช่น "ยอดยกมา " ช่องที่สาม) ไม่ใช่ชุดตัวเลข */
    if (pairLabels.indexOf(norm(x.label)) >= 0) return;
    sets.push({ kind: 'single', debit: x.col, credit: undefined, label: x.label });
  });
  sets.sort((a, b) => a.debit - b.debit);
  sets.forEach(function (x, i) { x.role = roleOf(x.label); if (!x.label) x.label = 'ชุดที่ ' + (i + 1); });
  /* มีคู่เดบิต/เครดิตแล้ว คอลัมน์ "จำนวนเงิน" ที่บอกบทบาทไม่ได้ไม่ใช่ชุดยอด */
  const hasPair = sets.some((x) => x.kind === 'pair');
  found.sets = sets.filter((x) => !(hasPair && x.kind === 'single' && x.role === 'unknown'));
  return found;
}

/** ชุดตัวเลขที่ควรใช้ตามแบบการนำเข้า — ไม่แน่ใจคืน null ให้ผู้ใช้เลือกเอง ดีกว่าเดาผิดเงียบ ๆ */
function defaultSet(sets, mode) {
  const pick = function (role) {
    const xs = (sets || []).filter((x) => x.role === role);
    return xs.find((x) => x.kind === 'pair') || xs[0] || null;
  };
  if (mode === 'movement') return pick('movement') || ((sets || []).length === 1 ? sets[0] : null);
  return pick('closing') || ((sets || []).length === 1 ? sets[0] : null);
}
const setOf = (map) => ({ debit: map.debit, credit: map.credit });
const sameSet = (a, b) => !!a && !!b && a.debit === b.debit && a.credit === b.credit;

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

/** คอลัมน์เดี่ยวต้องมีตัวเลขจริงอยู่ข้างใต้ ถึงจะนับเป็นชุดตัวเลข */
function columnHasNumbers(rows, headerRow, col) {
  let nums = 0, text = 0;
  rows.slice(headerRow + 1, headerRow + 201).forEach(function (r) {
    const v = String(r[col] === undefined ? '' : r[col]).trim();
    if (!v) return;
    const a = parseAmount(v);
    if (a === null) text++; else if (M(a) !== 0) nums++;
  });
  return nums > 0 && nums >= text;
}

function detectColumns(rows) {
  let bestScore = -1, best = null;
  headerCandidates(rows).forEach(function (c) {
    const map = mapFromHeader(c.cells);
    map.sets = map.sets.filter((x) => x.kind === 'pair' || columnHasNumbers(rows, c.row, x.debit));
    inferRoles(map.sets);
    /* ให้คะแนนหัวตารางด้วยชุดที่น่าจะใช้ ถ้ายังเลือกไม่ได้ใช้ชุดขวาสุดนับแทนไปก่อน */
    const probe = defaultSet(map.sets, 'opening') || map.sets[map.sets.length - 1];
    const scoreMap = { code: map.code, name: map.name, debit: probe && probe.debit, credit: probe && probe.credit };
    const keys = countKeys(scoreMap);
    if (keys < 2) return;
    const usable = countUsable(rows, scoreMap, c.row);
    /* จำนวนคอลัมน์ที่จับได้มาก่อน แล้วค่อยดูว่าอ่านข้อมูลจริงได้กี่บรรทัด
       บรรทัดที่อ่านได้เป็นตัวตัดสินเวลาหัวตารางหน้าตาคล้ายกันหลายบรรทัด */
    /* เสมอกัน ให้หัวตารางที่อ่านชุดตัวเลขได้ครบคอลัมน์กว่าชนะ (หัวสองชั้นเห็นทั้งคู่เดบิต/เครดิตใต้ "ยอดยกมา") */
    const cover = map.sets.reduce((n, x) => n + (x.kind === 'pair' ? 2 : 1), 0);
    const score = keys * 1e7 + Math.min(usable, 99999) * 100 + Math.min(cover, 99);
    if (score > bestScore) { bestScore = score; best = { headerRow: c.row, map, keys, usable }; }
  });
  if (!best) return { headerRow: 0, map: { sets: [] }, keys: 0, usable: 0, sets: [], pairs: [], ok: false, needsSet: false };
  const m = best.map;
  inferNameColumn(rows, m, best.headerRow);
  const pick = defaultSet(m.sets, 'opening');
  m.debit = pick ? pick.debit : undefined;
  m.credit = pick ? pick.credit : undefined;
  return { headerRow: best.headerRow, map: m, keys: best.keys, usable: best.usable,
           sets: m.sets, pairs: m.sets,
           /* มีหลายชุดแต่บอกไม่ได้ว่าชุดไหนคือยอดคงเหลือ ต้องให้ผู้ใช้เลือก ห้ามเดา */
           needsSet: !pick && m.sets.length > 1,
           ok: best.keys >= 3 && best.usable > 0 };
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
const cellText = (v) => String(v === undefined || v === null ? '' : v).trim();
/* บรรทัดที่ไม่ใช่บัญชี: ผลรวม ยอดยกไป–ยกมาระหว่างหน้า หัวหมวด */
const TOTAL_HEAD = /^(รวม|ยอดรวม|total|sub\s*-?\s*total|grand\s*total)/i;
const TOTAL_TAIL = /(รวม|total)$/i;
const CARRY_ROW = /^(ยอดยกไป|ยอดยกมา|ยกไป|ยกมา|carried\s*forward|brought\s*forward|c\/f|b\/f)$/i;
const GROUP_ROW = /^(หมวด|group\s|category\s)/i;
function nonAccountRow(code, name) {
  if (/^(รวม|total|ยอดรวม)/i.test(name) || /^(รวม|total)/i.test(code)) return 'บรรทัดผลรวม ข้ามอัตโนมัติ';
  if (code) return null;
  if (TOTAL_HEAD.test(name) || TOTAL_TAIL.test(name)) return 'บรรทัดผลรวม ข้ามอัตโนมัติ';
  if (CARRY_ROW.test(name)) return 'บรรทัดยอดยกไป–ยกมาระหว่างหน้า ข้ามอัตโนมัติ';
  if (GROUP_ROW.test(name)) return 'บรรทัดหัวหมวด ข้ามอัตโนมัติ';
  return null;
}

/** บัญชีหัวข้อที่ระบบเดิมพิมพ์ยอดรวมของบัญชีย่อยไว้ (เช่น 10000 สินทรัพย์ = ผลรวม 1xxxx)
    ถ้านำเข้าด้วย ยอดจะนับซ้ำสองเท่าทั้งที่งบยังสมดุล (เพราะหัวข้อทุกหมวดซ้ำเหมือนกัน)
    จับจากรหัสที่ลงท้ายด้วย 0 แล้วยอดเท่ากับผลรวมบัญชีที่ขึ้นต้นด้วยรหัสนั้นพอดีทุกสตางค์ */
function findParentRows(rows) {
  const digits = (c) => String(c || '').replace(/[^0-9]/g, '');
  const cands = rows.map((r, i) => ({ i, d: digits(r.code) }))
    .filter((x) => x.d.length >= 2 && /0$/.test(x.d))
    .map((x) => ({ i: x.i, d: x.d, pre: x.d.replace(/0+$/, '') }))
    .filter((x) => x.pre.length > 0)
    .sort((a, b) => b.pre.length - a.pre.length);           // หัวข้อย่อยก่อน หัวข้อใหญ่ทีหลัง
  const parent = new Set();
  cands.forEach(function (x) {
    let sum = 0, n = 0;
    rows.forEach(function (r, j) {
      if (j === x.i || parent.has(j)) return;
      const d = digits(r.code);
      if (d !== x.d && d.indexOf(x.pre) === 0) { sum += r.debit - r.credit; n++; }
    });
    const self = rows[x.i].debit - rows[x.i].credit;
    if (n > 0 && self !== 0 && sum === self) parent.add(x.i);
  });
  return parent;
}

function readTrialBalance(rows, map, headerRow) {
  const out = [], skipped = [], totals = [], rounded = [];
  let colDr = 0, colCr = 0;
  rows.slice(headerRow + 1).forEach(function (r, i) {
    const line = r.line || headerRow + 2 + i;
    let code = cellText(r[map.code]), name = cellText(r[map.name]);
    /* รหัสกับชื่ออยู่ช่องเดียวกัน เช่น "11111 เงินสด" — แยกออก ไม่งั้นรหัสบัญชีที่สร้างจะมีชื่อติดมาด้วย */
    if (map.code !== undefined && (map.name === undefined || map.name === map.code)) {
      const m = code.match(/^(\d[\d.\-\/]*)\s+(\S.*)$/);
      if (m) { code = m[1]; name = m[2]; }
    }
    if (!code && !name) return;
    const drS = map.debit === undefined ? '0' : parseAmount(r[map.debit]);
    const crS = map.credit === undefined ? '0' : parseAmount(r[map.credit]);
    if (drS === null || crS === null) {
      skipped.push({ line, code, name, why: 'ตัวเลขอ่านไม่ออก', bad: true,
        raw: cellText(r[drS === null ? map.debit : map.credit]) });
      return;
    }
    /* บัญชีแยกประเภทเก็บได้ละเอียดแค่สตางค์ ยอดที่มีทศนิยมเกินสองตำแหน่งต้องปัดตั้งแต่ตอนอ่าน
       ไม่งั้นยอดคุมจะไม่ตรงทั้งที่หน้าจอโชว์ "ต่าง 0.00" และผลรวมไม่เท่าตัวเลขที่เห็น */
    const rDr = satangOf(drS), rCr = satangOf(crS);
    if (rDr !== M(drS) || rCr !== M(crS)) {
      rounded.push({ line, code, name, from: rDr !== M(drS) ? drS : crS, to: rDr !== M(drS) ? rDr : rCr });
    }
    let debit = rDr, credit = rCr;
    if (debit === 0 && credit === 0) return;
    const why = nonAccountRow(code, name);
    if (why) {
      totals.push({ line, code, name, debit: rDr, credit: rCr });
      skipped.push({ line, code, name, why });
      return;
    }
    colDr += rDr; colCr += rCr;
    /* บางรายงานมีคอลัมน์ยอดคงเหลือคอลัมน์เดียว ติดลบแปลว่าด้านเครดิต */
    if (debit < 0 && credit === 0) { credit = -debit; debit = 0; }
    else if (credit < 0 && debit === 0) { debit = -credit; credit = 0; }
    out.push({ code, name, debit, credit, line, rawDr: rDr, rawCr: rCr });
  });

  const parents = findParentRows(out);
  let parentDr = 0, parentCr = 0;
  const rowsOut = [], parentRows = [];
  out.forEach(function (r, i) {
    if (!parents.has(i)) { rowsOut.push(r); return; }
    parentRows.push(r);
    parentDr += r.rawDr; parentCr += r.rawCr;
    skipped.push({ line: r.line, code: r.code, name: r.name,
      why: 'บัญชีหัวข้อ ยอดเท่ากับผลรวมบัญชีย่อยพอดี ข้ามไม่ให้นับซ้ำ' });
  });
  colDr -= parentDr; colCr -= parentCr;

  const seen = {};
  rowsOut.forEach(function (r) { if (r.code) (seen[r.code] = seen[r.code] || []).push(r.line); });
  const dupes = Object.keys(seen).filter((c) => seen[c].length > 1).map((c) => ({ code: c, lines: seen[c] }));
  skipped.sort((a, b) => a.line - b.line);
  return { rows: rowsOut, skipped, totals, rounded, parents: parentRows, dupes,
           colDr, colCr, parentDr, parentCr };
}

/* ---------- วันที่ของรายงานจากหัวไฟล์ ----------
   งบทดลองมักพิมพ์ "ณ วันที่ 30 มิถุนายน 2569" หรือ "ตั้งแต่ 01/01/2569 ถึง 30/06/2569" ไว้เหนือตาราง
   ใช้ตั้งวันตัดยอดให้ และเตือนเมื่อวันที่ที่เลือกไม่ตรงกับไฟล์ */
const TH_MONTH_WORDS = [
  ['มกราคม', 'ม.ค.', 'january', 'jan'], ['กุมภาพันธ์', 'ก.พ.', 'february', 'feb'], ['มีนาคม', 'มี.ค.', 'march', 'mar'],
  ['เมษายน', 'เม.ย.', 'april', 'apr'], ['พฤษภาคม', 'พ.ค.', 'may'], ['มิถุนายน', 'มิ.ย.', 'june', 'jun'],
  ['กรกฎาคม', 'ก.ค.', 'july', 'jul'], ['สิงหาคม', 'ส.ค.', 'august', 'aug'], ['กันยายน', 'ก.ย.', 'september', 'sep'],
  ['ตุลาคม', 'ต.ค.', 'october', 'oct'], ['พฤศจิกายน', 'พ.ย.', 'november', 'nov'], ['ธันวาคม', 'ธ.ค.', 'december', 'dec'],
];
function ymd(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += y >= 50 ? 2500 : 2000;                 // ปีสองหลัก 69 = 2569, 26 = 2026
  if (y > 2400) y -= 543;                                   // พ.ศ. → ค.ศ.
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2200)) return null;
  const s = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  return endOfMonth(s.slice(0, 8) + '01') >= s ? s : null;
}
function readFileDates(rows, headerRow) {
  const text = rows.slice(0, Math.max(0, headerRow - 1) + 1)
    .map((r) => r.map(cellText).join(' ')).join(' ');
  const found = [];
  const re = /(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/g;
  let m;
  while ((m = re.exec(text))) { const d = ymd(m[3], m[2], m[1]); if (d) found.push({ at: m.index, d }); }
  const low = text.toLowerCase();
  TH_MONTH_WORDS.forEach(function (words, mi) {
    words.forEach(function (w) {
      const esc = w.replace(/\./g, '\\.');
      const r1 = new RegExp('(\\d{1,2})\\s*' + esc + '\\s*(\\d{2,4})', 'g');
      let x;
      while ((x = r1.exec(low))) { const d = ymd(x[2], mi + 1, x[1]); if (d) found.push({ at: x.index, d }); }
    });
  });
  const uniq = [];
  found.sort((a, b) => a.at - b.at).forEach((f) => { if (uniq.indexOf(f.d) < 0) uniq.push(f.d); });
  if (!uniq.length) return null;
  return { from: uniq.length > 1 ? uniq[0] : null, to: uniq[uniq.length - 1] };
}

/* ===================================================================
   ตรวจไฟล์ก่อนนำเข้า — สิ่งที่งบทดลองสมดุลอย่างเดียวจับไม่ได้
   ctx = { rows, headerRow, map, sets, tb, mode, date (วันตัดยอด), period, dates (จากหัวไฟล์) }
   คืนรายการ { code, level: ok|warn|bad, title, detail } — bad ต้องแก้หรือกดยืนยันก่อนนำเข้า
   =================================================================== */
function setNet(r, x) {
  const dr = parseAmount(r[x.debit]);
  const cr = x.credit === undefined ? '0' : parseAmount(r[x.credit]);
  if (dr === null || cr === null) return null;
  return satangOf(dr) - satangOf(cr);
}
function tbFileChecks(ctx) {
  const out = [];
  const push = (level, code, title, detail) => out.push({ level, code, title, detail: detail || '' });
  const tb = ctx.tb;
  if (!tb) return out;
  const sets = ctx.sets || [];
  const cur = sets.find((x) => sameSet(x, ctx.map)) || null;
  const role = cur ? cur.role : 'unknown';
  const lines = (xs, n) => xs.slice(0, n || 6).join(', ') + (xs.length > (n || 6) ? ' และอีก ' + (xs.length - (n || 6)) + ' แถว' : '');

  /* 1. ชุดตัวเลขที่เลือกตรงกับแบบการนำเข้าหรือไม่ */
  if (ctx.mode === 'movement') {
    if (role === 'closing' || role === 'opening') {
      push('bad', 'SET_ROLE', 'ชุดที่เลือกคือ' + ROLE_TH[role] + ' ไม่ใช่ยอดเคลื่อนไหวของเดือน',
        'ลงเป็นยอดเคลื่อนไหวแล้วตัวเลขจะนับซ้ำกับเดือนก่อน ๆ — เลือกชุดยอดประจำงวดแทน');
    }
  } else if (role === 'movement') {
    push('bad', 'SET_ROLE', 'ชุดที่เลือกคือยอดเคลื่อนไหวระหว่างงวด ไม่ใช่ยอดคงเหลือ',
      'ยอดยกมาต้องใช้ยอดคงเหลือ ณ วันตัดยอด — เลือกชุดยอดคงเหลือ/ยอดสะสมแทน');
  } else if (role === 'opening') {
    push('warn', 'SET_ROLE', 'ชุดที่เลือกคือยอดยกมาต้นงวดของไฟล์',
      'ใช้ได้ถ้าตั้งใจตั้งยอด ณ วันก่อนเริ่มงวดของไฟล์ แล้วลงยอดเคลื่อนไหวเดือนต่อ ๆ ไป — วันตัดยอดต้องเป็นวันก่อนเริ่มงวด');
  }
  if (!cur && sets.length > 1) {
    push('bad', 'SET_UNKNOWN', 'ยังไม่ได้ยืนยันว่าใช้ตัวเลขชุดไหน',
      'ไฟล์นี้มีตัวเลข ' + sets.length + ' ชุด เลือกชุดในช่อง "ใช้ตัวเลขชุดไหนในไฟล์"');
  }

  /* 2. ยกมา + เคลื่อนไหว = คงเหลือ ทุกบรรทัด — พิสูจน์ว่าอ่านบทบาทของแต่ละชุดถูก */
  const by = (r) => sets.filter((x) => x.role === r);
  const oS = by('opening')[0], mS = by('movement')[0];
  const cS = by('closing').find((x) => x.kind === 'pair') || by('closing')[0];
  if (oS && mS && cS) {
    const bad = [];
    let n = 0;
    (ctx.rows || []).slice(ctx.headerRow + 1).forEach(function (r) {
      const code = cellText(r[ctx.map.code]), name = cellText(r[ctx.map.name]);
      if ((!code && !name) || nonAccountRow(code, name)) return;
      const o = setNet(r, oS), mv = setNet(r, mS), c = setNet(r, cS);
      if (o === null || mv === null || c === null) return;
      if (o === 0 && mv === 0 && c === 0) return;
      n++;
      if (o + mv !== c) bad.push('แถว ' + (r.line || '?') + ' ' + (code || name) + ' (' + fmt(o) + ' + ' + fmt(mv) + ' ≠ ' + fmt(c) + ')');
    });
    if (bad.length) {
      push('bad', 'SET_IDENTITY', 'ยอดยกมา + ยอดเคลื่อนไหว ไม่เท่ายอดคงเหลือ ' + bad.length + ' บัญชี',
        lines(bad, 4) + ' — ระบบอาจอ่านบทบาทของคอลัมน์ผิด ตรวจหัวตารางกับไฟล์ต้นฉบับ');
    } else if (n) {
      push('ok', 'SET_IDENTITY', 'ยอดยกมา + ยอดเคลื่อนไหว = ยอดคงเหลือ ครบทุกบัญชี',
        n + ' บัญชี — ยืนยันว่าอ่านคอลัมน์ทั้งสามชุดถูกบทบาท');
    }
  }
  /* คอลัมน์ยอดคงเหลือหลายแบบ (คู่เดบิต/เครดิต กับคอลัมน์สุทธิ) ต้องตรงกันทุกบรรทัด */
  const closers = by('closing');
  if (closers.length > 1) {
    const bad = [];
    (ctx.rows || []).slice(ctx.headerRow + 1).forEach(function (r) {
      const code = cellText(r[ctx.map.code]), name = cellText(r[ctx.map.name]);
      if ((!code && !name) || nonAccountRow(code, name)) return;
      const v = closers.map((x) => setNet(r, x));
      if (v.some((x) => x === null)) return;
      if (v.some((x) => x !== v[0])) bad.push('แถว ' + (r.line || '?') + ' ' + (code || name));
    });
    if (bad.length) push('bad', 'CLOSING_AGREE', 'คอลัมน์ยอดคงเหลือแต่ละแบบในไฟล์ไม่ตรงกัน ' + bad.length + ' บัญชี', lines(bad));
  }

  /* 3. ยอดรวมท้ายไฟล์ — ตัวคุมที่ระบบเดิมคำนวณไว้เอง */
  const grand = (tb.totals || []).filter((t) => t.debit === t.credit && t.debit !== 0).pop();
  if (grand && ctx.map.credit !== undefined) {
    const ok = (grand.debit === tb.colDr && grand.credit === tb.colCr)
      || (grand.debit === tb.colDr + tb.parentDr && grand.credit === tb.colCr + tb.parentCr);
    if (ok) {
      push('ok', 'CONTROL_TOTAL', 'ผลรวมทุกบรรทัดตรงกับบรรทัดรวมท้ายไฟล์ทุกสตางค์',
        'แถว ' + grand.line + ' ' + (grand.name || grand.code) + ' เดบิต ' + fmt(grand.debit) + ' · เครดิต ' + fmt(grand.credit));
    } else {
      push('bad', 'CONTROL_TOTAL', 'ผลรวมที่อ่านได้ไม่เท่าบรรทัดรวมท้ายไฟล์',
        'ไฟล์บอก เดบิต ' + fmt(grand.debit) + ' เครดิต ' + fmt(grand.credit)
          + ' · อ่านได้ เดบิต ' + fmt(tb.colDr) + ' เครดิต ' + fmt(tb.colCr)
          + ' — มีบรรทัดหาย บรรทัดหัวข้อที่มียอดรวม หรือบัญชีซ้ำ ตรวจรายการที่ข้ามไปด้านล่าง');
    }
  } else if (ctx.map.credit !== undefined) {
    push('warn', 'CONTROL_TOTAL', 'ไม่พบบรรทัดรวมท้ายไฟล์ให้เทียบ',
      'เทียบเดบิตรวมและเครดิตรวมด้านล่างกับงบทดลองของระบบเดิมด้วยตาอีกครั้ง');
  }

  /* 4. บรรทัดที่อ่านไม่ออก รหัสซ้ำ บัญชีหัวข้อ และการปัดเศษ */
  const unread = (tb.skipped || []).filter((x) => x.bad);
  if (unread.length) {
    push('bad', 'UNREADABLE', 'อ่านตัวเลขไม่ออก ' + unread.length + ' แถว',
      lines(unread.map((x) => 'แถว ' + x.line + ' ' + (x.code || x.name) + ' "' + x.raw + '"')) + ' — แก้ในไฟล์ให้เป็นตัวเลขแล้วลากเข้ามาใหม่');
  }
  if ((tb.dupes || []).length) {
    push('bad', 'DUPLICATE_CODE', 'รหัสบัญชีซ้ำในไฟล์ ' + tb.dupes.length + ' รหัส',
      lines(tb.dupes.map((d) => d.code + ' (แถว ' + d.lines.join(', ') + ')')) + ' — ยอดจะถูกรวมกัน ถ้าเป็นบรรทัดซ้ำหรือบรรทัดรวมย่อยต้องลบออกจากไฟล์ก่อน');
  }
  if ((tb.parents || []).length) {
    push('warn', 'PARENT_ROWS', 'ข้ามบัญชีหัวข้อที่เป็นยอดรวม ' + tb.parents.length + ' บรรทัด',
      lines(tb.parents.map((r) => r.code + ' ' + r.name)) + ' — ยอดเท่ากับผลรวมบัญชีย่อยพอดี ถ้านำเข้าด้วยจะนับซ้ำ');
  }
  if ((tb.rounded || []).length) {
    push('warn', 'ROUNDED', 'ปัดเศษเกินสตางค์ ' + tb.rounded.length + ' บรรทัด',
      lines(tb.rounded.map((r) => 'แถว ' + r.line + ' ' + (r.code || r.name) + ' ' + r.from + ' → ' + fmt(r.to))) + ' — บัญชีเก็บได้ละเอียดแค่สตางค์');
  }

  /* 5. วันที่ในหัวไฟล์ */
  const d = ctx.dates;
  if (d && ctx.mode === 'movement' && ctx.period) {
    const ps = ctx.period + '-01', pe = endOfMonth(ps);
    if ((d.from && d.from !== ps) || d.to !== pe) {
      push('bad', 'FILE_DATE', 'ช่วงวันที่ในไฟล์ไม่ใช่เดือน' + thPeriod(ctx.period) + 'เดือนเดียว',
        'ไฟล์บอก ' + (d.from ? thDate(d.from) + ' ถึง ' : 'ณ ') + thDate(d.to)
          + ' — ยอดเคลื่อนไหวต้องเป็นงบทดลองของเดือนนั้นเดือนเดียว ไม่งั้นตัวเลขหลายเดือนจะกองอยู่เดือนเดียว');
    }
  } else if (d && ctx.mode !== 'movement' && ctx.date) {
    const want = role === 'opening' ? (d.from ? addDays(d.from, -1) : null) : d.to;
    /* ยอดสิ้นวันที่ 31 ลงวันที่ 1 ของเดือนถัดไปได้ (งวดก่อนหน้ามักไม่มีในระบบ) — ความหมายเดียวกัน */
    const sameAs = want && (want === ctx.date || (addDays(want, 1) === ctx.date && ctx.date.slice(8) === '01'));
    if (want && !sameAs) {
      push('bad', 'FILE_DATE', 'วันตัดยอดไม่ตรงกับวันที่ในไฟล์',
        'ไฟล์เป็นยอด' + (role === 'opening' ? 'ยกมา ณ ' : ' ณ ') + thDate(want) + ' แต่เลือกลงบัญชีวันที่ ' + thDate(ctx.date)
          + ' — ยอดคงเหลือต้องลงวันเดียวกับวันที่ของงบทดลอง ไม่งั้นรายการระหว่างสองวันจะหายหรือนับซ้ำ');
    }
  }
  if (!d) {
    push('warn', 'FILE_DATE', 'ไม่พบวันที่ของรายงานในหัวไฟล์',
      ctx.mode === 'movement' ? 'ตรวจให้แน่ใจว่าไฟล์เป็นงบทดลองของเดือนที่เลือกเดือนเดียว'
        : 'ตรวจว่าวันตัดยอดตรงกับวันที่ของงบทดลองที่ดาวน์โหลดมา — ระบบตั้งให้เองไม่ได้');
  }
  return out;
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
  ['12','other_asset'],                               // 12xxx ทั้งหมดเป็นสินทรัพย์ไม่หมุนเวียน ไม่ใช่หมุนเวียน
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
  salary_expense: 'expense',
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

/* รหัสบอกได้แค่หมวดใหญ่ ชื่อบัญชีบอกรายละเอียดที่รหัสบอกไม่ได้ — ใช้ชื่อปรับเฉพาะภายในประเภทเดียวกัน
   เช่น 11319 "ค่าเผื่อหนี้สงสัยจะสูญ" อยู่ใต้ 1131 ลูกหนี้การค้า แต่ต้องเป็นบัญชีปรับมูลค่า
   ไม่งั้นยอดคุมลูกหนี้จะไม่มีวันตรงกับใบกำกับรายใบ (ค่าเผื่อไม่มีใบกำกับรองรับ) */
const NAME_SUBTYPE = [
  { re: /ค่าเผื่อ.*(หนี้|สงสัย|ผลขาดทุนด้านเครดิต)/, sub: 'ar_allowance' },
  { re: /ค่าเผื่อ.*(สินค้า|ล้าสมัย|มูลค่าลดลง)/, sub: 'inventory_allowance' },
  { re: /ค่าเสื่อมราคาสะสม/, sub: 'accum_depreciation' },
  { re: /ค่าตัดจำหน่ายสะสม/, sub: 'accum_amortization' },
  { re: /เช็ครับ|เช็คลงวันที่ล่วงหน้า|ตั๋วเงินรับ/, sub: 'other_receivable' },
  { re: /ภาษีเงินได้นิติบุคคล|ภาษีเงินได้$/, sub: 'income_tax_expense' },
  { re: /ผลประโยชน์พนักงาน/, sub: 'employee_benefit_obligation' },
  /* ธนาคาร/เงินสด ใช้เฉพาะเมื่อรหัสบอกได้แค่ "สินทรัพย์หมุนเวียนอื่น" — เงินฝากประจำ 112 ยังเป็นเงินลงทุนตามรหัส */
  { re: /เงินฝากธนาคาร|^ธนาคาร|^เงินฝาก(ออมทรัพย์|กระแสรายวัน)|bank/i, sub: 'bank', weak: true },
  { re: /^เงินสด|เงินสดย่อย|petty\s*cash|cash\s*on\s*hand/i, sub: 'cash', weak: true },
];
function refineByName(sub, name, strong) {
  const t = subTypeType(sub);
  const n = String(name || '').trim();
  for (let i = 0; i < NAME_SUBTYPE.length; i++) {
    const r = NAME_SUBTYPE[i];
    if (!r.re.test(n) || subTypeType(r.sub) !== t) continue;
    if (r.weak && strong && sub !== 'other_current_asset') continue;
    return r.sub;
  }
  return sub;
}

/** บัญชีที่จะสร้างใหม่จากรหัสในงบทดลองของระบบเดิม */
function proposeAccount(code, name) {
  const h = dbdHint(code);
  const sub = h ? refineByName(h.sub, name, h.strong) : null;
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

/** สิ่งที่รหัสตามผังกรมพัฒน์บอกได้ — strong = ตรงกับรหัสในตารางจริง ไม่ใช่เดาจากเลขหลักแรก */
function dbdHint(code) {
  const c = String(code || '').trim().replace(/[^0-9]/g, '');
  if (!c) return null;
  let sub = null, len = 0;
  DBD_SUBTYPE.forEach(function (p) {
    if (c.indexOf(p[0]) === 0 && p[0].length > len) { len = p[0].length; sub = p[1]; }
  });
  const strong = !!sub;
  sub = sub || DBD_BY_LEAD[c[0]] || null;
  const type = sub ? subTypeType(sub) : null;
  return sub ? { sub, type, strong } : null;
}

/**
 * จับคู่บรรทัดในไฟล์กับบัญชีในผังของเรา
 * ★ รหัสหรือชื่อตรงกันอย่างเดียวไม่พอ ต้องเป็นบัญชีประเภทเดียวกันด้วย
 *   เช่น "27130 ภาษีเงินได้นิติบุคคล" (หนี้สิน) ห้ามรวมเข้า "ภาษีเงินได้นิติบุคคล" ที่เป็นค่าใช้จ่าย
 *   และ "2131 เจ้าหนี้การค้า" ห้ามรวมเข้า 2131 ของเราที่เป็นค่าใช้จ่ายค้างจ่าย
 */
function matchAccount(code, name) {
  const c = String(code || '').trim();
  const nn = norm(name);
  const hint = dbdHint(c);
  const byCode = c ? DB.accounts.find((a) => a.code === c) : null;
  if (byCode) {
    if (!byCode.postable) return null;
    const sameName = !nn || norm(byCode.name) === nn;
    const sameType = !hint || hint.type === byCode.type;
    /* รหัสอยู่ในผังกรมพัฒน์จริง (strong) ต้องตรงถึงระดับบรรทัดงบ ไม่งั้นแค่ประเภทเดียวกันก็พอ */
    const fits = !hint ? true
      : hint.strong ? refineByName(hint.sub, name, true) === byCode.subType
      : sameType;
    return (sameName || fits) ? byCode.code : null;
  }
  if (!nn) return null;
  const byName = DB.accounts.find((a) => a.postable && norm(a.name) === nn);
  return byName && (!hint || !hint.type || hint.type === byName.type) ? byName.code : null;
}

/** รหัสในไฟล์ชนกับบัญชีอื่นในผังของเรา (รหัสเดียวกันแต่คนละบัญชี) */
function codeClash(code) {
  const c = String(code || '').trim();
  const a = c ? DB.accounts.find((x) => x.code === c) : null;
  return a && !a.imported ? a : null;
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
    const hint = dbdHint(r.code);

    /* ผู้ใช้สั่งให้สร้างบัญชีใหม่ในบรรทัดงบที่เลือกเอง */
    if (ov && ov.charAt(0) === '+') {
      const sub = ov.slice(1);
      const t = subTypeType(sub);
      const clash = codeClash(r.code);
      if (t && !clash) {
        creating.push({ ...r, subType: sub, type: t, fsLine: fsLineOf(sub) });
        return;
      }
      if (clash) {
        unmatched.push({ ...r, reason: 'รหัส ' + clash.code + ' มีในผังแล้ว (' + clash.name + ') สร้างซ้ำไม่ได้ — เลือกบัญชีปลายทาง' });
        return;
      }
    }
    const target = (ov && ov.charAt(0) !== '+' ? ov : null) || matchAccount(r.code, r.name);
    if (target && DB.accounts.find((a) => a.code === target)) {
      const a = acc(target);
      matched.push({ ...r, target, targetName: a.name, targetType: a.type, how: ov ? 'user' : 'auto',
        /* ผู้ใช้เลือกบัญชีเองแต่คนละประเภทกับรหัสเดิม — ไม่ห้าม แต่ต้องเห็นชัด */
        typeWarn: hint && hint.type && hint.type !== a.type
          ? 'รหัสเดิมเป็น' + TYPE_TH_I[hint.type] + ' แต่บัญชีปลายทางเป็น' + TYPE_TH_I[a.type] : null });
      return;
    }
    /* รหัสเดียวกับบัญชีในผังของเราแต่คนละบัญชี — สร้างใหม่ด้วยรหัสเดิมไม่ได้ ต้องให้ผู้ใช้เลือก */
    const clash = codeClash(r.code);
    if (clash) {
      unmatched.push({ ...r, reason: 'รหัส ' + clash.code + ' ในผังของระบบคือ "' + clash.name + '" ('
        + TYPE_TH_I[clash.type] + ') ไม่ใช่บัญชีเดียวกัน — เลือกบัญชีปลายทางเอง' });
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
const TYPE_TH_I = { asset:'สินทรัพย์', liability:'หนี้สิน', equity:'ส่วนของผู้ถือหุ้น', revenue:'รายได้', expense:'ค่าใช้จ่าย' };

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

/** ปีบัญชีของวันที่นี้เริ่มวันไหน — งวดเรียงต่อกันปีละ 12 งวดนับจากงวดแรกของบริษัท */
function fyStartOf(date) {
  const ps = DB.periods.slice().sort((a, b) => (a.start < b.start ? -1 : 1));
  const i = ps.findIndex((p) => date >= p.start && date <= p.end);
  return i < 0 ? null : ps[i - (i % 12)].start;
}

/**
 * ★ กันนับซ้ำก่อนลงบัญชี — ทุกข้อคืนเป็นรายการตรวจแบบเดียวกับ tbFileChecks
 *   ใบยอดยกมาลงวันที่ D = ยอดคงเหลือสิ้นวัน D ยกเว้นลงวันแรกของเดือน ถือเป็นยอดยกมาต้นเดือน
 *   (ยอดสิ้นวันก่อนหน้า) เพราะงวดก่อนหน้ามักไม่มีในระบบ ต้องลงวันแรกของงวดแรกแทน
 *   stop = ทำต่อไม่ได้จนกว่าจะยกเลิกของเดิม · bad = ต้องกดยืนยันว่าตั้งใจ
 */
function importPreflight(kind, date, period) {
  const out = [];
  const live = DB.entries.filter((e) => e.src === 'import' && e.status === 'posted');
  const start = kind === 'movement' ? period + '-01' : null;
  live.forEach(function (e) {
    const parts = String(e.srcId || '').split('|');
    const k = parts[0], key = parts[1] || '';
    if (kind === 'opening' && k === 'opening') {
      out.push({ level: 'stop', code: 'DOUBLE_OPENING', title: 'มียอดยกมาที่ใช้งานอยู่แล้ว ' + e.no + ' ณ ' + thDate(e.date),
        detail: 'ยอดยกมามีได้ใบเดียว นำเข้าซ้ำแล้วยอดคงเหลือทุกบัญชีจะเป็นสองเท่า — ยกเลิกใบเดิมก่อนที่ประวัติการนำเข้า' });
    }
    if (kind === 'opening' && k === 'movement' && date > key + '-01') {
      out.push({ level: 'stop', code: 'OPENING_AFTER_MOVEMENT', title: 'ยอดยกมา ณ ' + thDate(date) + ' ทับยอดเคลื่อนไหวงวด ' + thPeriod(key) + ' (' + e.no + ')',
        detail: 'ยอดยกมาเป็นยอดสะสมที่รวมเดือนนั้นไว้แล้ว ลงทั้งคู่ตัวเลขจะนับซ้ำ — ยอดยกมาต้องลงวันก่อนเดือนแรกของยอดเคลื่อนไหว' });
    }
    if (kind === 'movement' && k === 'opening' && start < e.date) {
      out.push({ level: 'stop', code: 'MOVEMENT_IN_OPENING', title: 'งวด ' + thPeriod(period) + ' อยู่ในยอดยกมา ' + e.no + ' ณ ' + thDate(e.date) + ' แล้ว',
        detail: 'ยอดยกมาเป็นยอดสะสมถึงวันนั้น รวมยอดเคลื่อนไหวของเดือนนี้ไว้แล้ว ลงซ้ำตัวเลขจะเป็นสองเท่า' });
    }
    if (kind === 'movement' && k === 'movement' && key === period) {
      out.push({ level: 'stop', code: 'DOUBLE_MOVEMENT', title: 'นำเข้ายอดเคลื่อนไหวงวด ' + thPeriod(period) + ' ไปแล้ว (' + e.no + ')',
        detail: 'ถ้าต้องการนำเข้าใหม่ ให้กดยกเลิกการนำเข้าครั้งนั้นก่อน' });
    }
  });
  /* รายการที่บันทึกในระบบนี้เองในช่วงเดียวกับตัวเลขที่ยกมา จะถูกนับซ้ำกับระบบเดิม */
  const bf = kind === 'opening' && date.slice(8) === '01';
  const inRange = (e) => kind === 'movement' ? (e.date >= start && e.date <= endOfMonth(start))
    : (bf ? e.date < date : e.date <= date);
  const own = DB.entries.filter((e) => LIVE(e) && !isImportEntry(e) && inRange(e));
  if (own.length) {
    out.push({ level: 'bad', code: 'OWN_ENTRIES_OVERLAP',
      title: 'มีรายการที่บันทึกในระบบนี้' + (kind === 'movement' ? 'ในงวด ' + thPeriod(period) : 'ก่อนหรือในวันตัดยอด') + ' ' + own.length + ' รายการ',
      detail: 'เช่น ' + own.slice(0, 4).map((e) => e.no).join(', ') + ' — ตัวเลขจากระบบเดิมรวมรายการช่วงนี้ไว้แล้ว ลงทั้งสองทางจะนับซ้ำ'
        + ' (ถ้าเป็นข้อมูลตัวอย่าง ให้เริ่มจากบริษัทเปล่าแทน)' });
  }
  return out;
}

/* บัญชีคุมที่เอกสารลงอัตโนมัติ — นำเข้าบัญชีใหม่ของประเภทเหล่านี้แล้ว เอกสารหลังวันตัดยอดต้องลงบัญชีเดิมของบริษัทต่อ
   ไม่งั้นยอดยกมาค้างอยู่บัญชีหนึ่ง รายการใหม่ไปลงอีกบัญชี งบทดลองรายบัญชีติดลบทั้งที่ยอดรวมถูก */
const CONTINUE_SUBS = ['cash', 'bank', 'trade_receivable', 'trade_payable', 'output_vat', 'input_vat',
  'wht_asset', 'wht_payable_pnd1', 'wht_payable_pnd3', 'wht_payable_pnd53', 'vat_payable', 'vat_receivable',
  'inventory', 'accrued_payroll', 'sso_payable', 'accum_depreciation', 'retained_earnings',
  'sales_revenue', 'service_revenue', 'cogs'];

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
  const checks = (o.checks || []).concat(importPreflight(o.kind, o.date, o.period));
  const stop = checks.filter((c) => c.level === 'stop');
  if (stop.length) throw new DomainError('IMPORT_OVERLAP', stop[0].title, stop[0].detail);
  const bad = checks.filter((c) => c.level === 'bad');
  if (bad.length && !o.ack) {
    throw new DomainError('IMPORT_CHECK_FAILED', bad[0].title + (bad.length > 1 ? ' (และอีก ' + (bad.length - 1) + ' ข้อ)' : ''),
      bad[0].detail ? bad[0].detail + ' — ถ้าตรวจกับไฟล์ต้นฉบับแล้วว่าถูกต้อง ให้ติ๊กยืนยันก่อนกดนำเข้า' : 'ตรวจกับไฟล์ต้นฉบับแล้วติ๊กยืนยันก่อนกดนำเข้า');
  }

  /* สร้างบัญชีที่ยังไม่มีในผังก่อน โดยใช้รหัสและชื่อเดิมของระบบเก่า
     ทั้งคำสั่งห่อเป็นชุดเดียว (ท้ายไฟล์) ลงบัญชีไม่ผ่านบัญชีที่สร้างจะหายไปด้วย ไม่ค้างในผัง */
  const created = [];
  p.creating.forEach(function (r) {
    const code = String(r.code || '').trim() || r.name;
    const ex = DB.accounts.find((a) => a.code === code);
    if (ex) {
      if (ex.subType === r.subType && ex.type === r.type) return;
      /* บัญชีที่เคยนำเข้าแล้วยกเลิก นำเข้าใหม่โดยเลือกบรรทัดงบใหม่ ต้องย้ายหมวดตาม ไม่ใช่เงียบไว้หมวดเดิม */
      if (!ex.imported) {
        throw new DomainError('ACCOUNT_CODE_TAKEN', 'รหัส ' + code + ' มีในผังบัญชีแล้ว (' + ex.name + ')',
          'เลือกรวมเข้าบัญชีที่มีอยู่แทนการสร้างใหม่');
      }
      const used = DB.entries.some((e) => LIVE(e) && !isImportEntry(e) && e.lines.some((l) => l.acc === code));
      if (used) {
        throw new DomainError('ACCOUNT_IN_USE', 'บัญชี ' + code + ' ' + ex.name + ' มีรายการอื่นในระบบแล้ว ย้ายบรรทัดงบตอนนำเข้าไม่ได้',
          'แก้หมวดของบัญชีที่หน้าผังบัญชีแทน หรือเลือกบรรทัดงบเดิม');
      }
      audit('account', code, 'reclassify', { type: ex.type, subType: ex.subType }, { type: r.type, subType: r.subType }, 'นำเข้าใหม่');
      ex.type = r.type; ex.subType = r.subType;
      return;
    }
    const tmpl = DB.accounts.find((a) => a.subType === r.subType && !a.imported && a.postable);
    const a = { code, name: r.name || ('บัญชี ' + code), type: r.type, subType: r.subType,
      postable: true, requiresPartner: !!(tmpl && tmpl.requiresPartner), level: 3, imported: true };
    DB.accounts.push(a);
    created.push(a);
  });
  DB.accounts.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  // รวมบรรทัดที่ชี้ไปบัญชีเดียวกัน แล้วสุทธิเป็นด้านเดียว — จำรหัสเดิมไว้ในคำอธิบายบรรทัด ตรวจย้อนได้
  const net = {}, from = {};
  const add = function (code, r) {
    net[code] = (net[code] || 0) + r.debit - r.credit;
    (from[code] = from[code] || []).push(r.code || r.name);
  };
  p.matched.forEach((r) => add(r.target, r));
  p.creating.forEach((r) => add(String(r.code || '').trim() || r.name, r));

  /* ★ งบทดลอง ณ วันแรกของปีบัญชี (หรือไฟล์ที่ลงวันก่อนปีนี้) แต่ยังมีบัญชีรายได้/ค่าใช้จ่าย
     คือกำไรขาดทุนของปีก่อนที่ยังไม่ได้ปิดบัญชี ถ้าลงตามบัญชีเดิม จะไปโผล่เป็นกำไรของปีนี้ทั้งก้อน
     จึงปิดเข้ากำไรสะสมให้ในใบเดียวกัน แล้วบอกผู้ใช้ */
  let pnlClosed = null;
  if (o.kind === 'opening') {
    const fy = fyStartOf(o.date);
    const prior = fy && (o.date === fy || (o.fileDate && o.fileDate < fy));
    const pnlCodes = Object.keys(net).filter((c) => { const t = acc(c).type; return t === 'revenue' || t === 'expense'; });
    if (prior && pnlCodes.length) {
      const profit = -pnlCodes.reduce((s, c) => s + net[c], 0);
      const reCode = Object.keys(net).filter((c) => acc(c).subType === 'retained_earnings')
        .sort((a, b) => Math.abs(net[b]) - Math.abs(net[a]))[0] || accBySub('retained_earnings');
      pnlCodes.forEach(function (c) { (from[reCode] = from[reCode] || []).push.apply(from[reCode], from[c]); delete net[c]; });
      net[reCode] = (net[reCode] || 0) - profit;
      pnlClosed = { profit, accounts: pnlCodes.length, into: reCode, fy };
    }
  }

  /* ลูกหนี้/เจ้าหนี้ที่ยกมาแยกรายคู่ค้าได้ (แฟ้มจากตัวดึงมีเอกสารค้างรายใบ) ให้แยกบรรทัดตามคู่ค้า
     บัญชีย่อยรายลูกค้าจะได้ถูกตั้งแต่วันแรก ส่วนที่เหลือที่ไม่มีเอกสารรองรับค้างไว้ที่ "ยอดยกมาจากระบบเดิม" */
  const split = o.partnerSplit || {};
  Object.keys(split).forEach(function (sub) {
    const cands = Object.keys(net).filter((c) => acc(c).subType === sub && net[c] !== 0)
      .sort((a, b) => Math.abs(net[b]) - Math.abs(net[a]));
    split[sub].code = cands[0] || null;
  });
  const lines = [];
  Object.keys(net).filter((c) => net[c] !== 0).forEach(function (c) {
    const a = acc(c);
    const memo = 'รหัสเดิม ' + from[c].slice(0, 8).join(', ') + (from[c].length > 8 ? ' และอีก ' + (from[c].length - 8) : '');
    const sp = split[a.subType];
    const sideOf = (v) => (v > 0 ? { dr: v } : { cr: -v });
    if (sp && sp.code === c) {
      let rest = net[c];
      Object.keys(sp.by).forEach(function (pc) {
        const v = sp.sign * sp.by[pc];
        if (!v) return;
        lines.push({ acc: c, partner: pc, memo, ...sideOf(v) });
        rest -= v;
      });
      if (rest !== 0) lines.push({ acc: c, partner: 'OPENING', memo, ...sideOf(rest) });
      return;
    }
    const l = { acc: c, memo, ...sideOf(net[c]) };
    if (a.requiresPartner) l.partner = 'OPENING';
    lines.push(l);
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
  if (pnlClosed) je.pnlClosed = pnlClosed;

  /* บัญชีที่นำเข้ามาเป็นบัญชีหลักของประเภทนั้นต่อจากนี้ เอกสารใหม่ลงต่อจากยอดยกมา */
  const defaults = [];
  CONTINUE_SUBS.forEach(function (sub) {
    const mine = Object.keys(net).filter((c) => { const a = acc(c); return a.imported && a.subType === sub && a.postable; });
    /* มีบัญชีหลักอยู่แล้ว (ตั้งเองหรือจากการนำเข้าครั้งก่อน) ไม่สลับไปมาทุกครั้งที่นำเข้ายอดเดือนใหม่ */
    if (!mine.length || DB.accounts.some((a) => a.subType === sub && a.isDefault)) return;
    mine.sort((a, b) => (Math.abs(net[b]) - Math.abs(net[a])) || (a < b ? -1 : 1));
    DB.accounts.forEach(function (a) {
      if (a.subType !== sub) return;
      if (a.code === mine[0]) { a.isDefault = true; a.defaultFrom = je.no; }
      else if (a.isDefault && a.defaultFrom) { delete a.isDefault; delete a.defaultFrom; }
    });
    defaults.push({ sub, code: mine[0] });
  });
  if (defaults.length) je.defaults = defaults;

  audit('import', o.srcId, 'run', null,
    { accounts: lines.length, created: created.length, total: fmt(p.totalDr),
      acknowledged: bad.length ? bad.map((c) => c.title) : undefined,
      pnlClosed: pnlClosed ? fmt(pnlClosed.profit) : undefined });
  return { entry: je, accounts: lines.length, created: created.length, total: p.totalDr,
    pnlClosed, defaults, acknowledged: bad.map((c) => c.title) };
}

/** ยอดยกมา — ใบสำคัญใบเดียว ณ วันตัดยอด
    opts: { checks: tbFileChecks(...), ack: ผู้ใช้ยืนยันข้อที่ต้องตรวจแล้ว, fileDate: วันที่ในหัวไฟล์ } */
function importOpeningBalances(tbRows, date, overrides, opts) {
  opts = opts || {};
  return runImport(tbRows, overrides, {
    kind: 'opening', date: date, type: 'opening', srcId: 'opening|' + date,
    desc: 'ยอดยกมาจากระบบเดิม ณ ' + thDate(date),
    dupMessage: 'นำเข้ายอดยกมา ณ ' + thDate(date) + ' ไปแล้ว',
    checks: opts.checks, ack: opts.ack, fileDate: opts.fileDate, partnerSplit: opts.partnerSplit,
  });
}

/** ยอดเคลื่อนไหวของเดือนหนึ่ง — ใบสำคัญเดือนละใบ ลงวันสิ้นเดือน */
function importPeriodMovement(tbRows, period, overrides, opts) {
  opts = opts || {};
  if (!/^\d{4}-\d{2}$/.test(String(period || ''))) {
    throw new DomainError('PERIOD_REQUIRED', 'ต้องเลือกเดือนของยอดเคลื่อนไหวก่อน');
  }
  const date = endOfMonth(period + '-01');
  return runImport(tbRows, overrides, {
    kind: 'movement', period: period, date: date, type: 'general', srcId: 'movement|' + period,
    desc: 'ยอดเคลื่อนไหวจากระบบเดิม งวด ' + thPeriod(period),
    dupMessage: 'นำเข้ายอดเคลื่อนไหวงวด ' + thPeriod(period) + ' ไปแล้ว',
    checks: opts.checks, ack: opts.ack,
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
      bfDocs: DB.docs.invoice.filter((d) => d.broughtForward && d.entryNo === e.no && d.status !== 'void').length
        + DB.docs.bill.filter((d) => d.broughtForward && d.entryNo === e.no && d.status !== 'void').length,
    };
  });
}

/** ยกเลิกการนำเข้า — กลับรายการตามกฎหมาย ไม่ลบทิ้ง แล้วนำเข้าใหม่ได้
    ★ เอกสารค้างยกมาที่มากับใบนี้ต้องยกเลิกตามด้วย ไม่งั้นบัญชีคุมเป็นศูนย์แต่ทะเบียนลูกหนี้ยังค้างอยู่ */
function reverseImport(entryNo, reason) {
  const e = DB.entries.find((x) => x.no === entryNo);
  if (!e || e.src !== 'import') {
    throw new DomainError('NOT_AN_IMPORT', 'ใบสำคัญ ' + entryNo + ' ไม่ใช่รายการที่มาจากการนำเข้า');
  }
  const bfInv = DB.docs.invoice.filter((d) => d.broughtForward && d.entryNo === e.no && d.status !== 'void');
  const bfBill = DB.docs.bill.filter((d) => d.broughtForward && d.entryNo === e.no && d.status !== 'void');
  const blocked = [];
  bfInv.forEach((d) => voidBlockers('invoice', d).forEach((w) => blocked.push(d.no + ': ' + w)));
  bfBill.forEach((d) => voidBlockers('bill', d).forEach((w) => blocked.push(d.no + ': ' + w)));
  if (blocked.length) {
    throw new DomainError('IMPORT_IN_USE',
      'ยกเลิกการนำเข้าไม่ได้ เอกสารค้างยกมามีรายการต่อในระบบนี้แล้ว — ' + blocked.slice(0, 3).join(' · ')
        + (blocked.length > 3 ? ' และอีก ' + (blocked.length - 3) + ' ข้อ' : ''),
      'ยกเลิกใบเสร็จ ใบสำคัญจ่าย หรือใบวางบิลที่อ้างถึงเอกสารเหล่านั้นก่อน');
  }
  const why = reason || 'ยกเลิกการนำเข้าเพื่อนำเข้าใหม่ให้ถูกต้อง';
  const rev = reverse(entryNo, why, e.date, { fromSource: true });
  rev.importReversal = true;
  if (e.type === 'opening') rev.openingReversal = true;
  bfInv.concat(bfBill).forEach(function (d) {
    d.status = 'void';
    d.voidReason = 'ยกเลิกการนำเข้า ' + e.no;
    d.voidedAt = new Date().toISOString();
  });
  DB.accounts.forEach(function (a) {
    if (a.defaultFrom === e.no) { delete a.isDefault; delete a.defaultFrom; }
  });
  if (bfInv.length || bfBill.length) {
    audit('import', e.srcId, 'reverse_docs', null, { invoices: bfInv.length, bills: bfBill.length }, why);
  }
  return Object.assign({}, rev, { voidedDocs: bfInv.length + bfBill.length });
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

/** จำนวนเงินในแฟ้มข้อมูล — อ่านไม่ออกต้องหยุด ห้ามกลายเป็นศูนย์เงียบ ๆ แบบ M() */
function pkgAmount(v, where) {
  if (v === undefined || v === null || v === '') return 0;
  const t = parseAmount(v);
  if (t === null) {
    throw new DomainError('BAD_AMOUNT', 'จำนวนเงินในแฟ้มข้อมูลอ่านไม่ออก: ' + where + ' = "' + v + '"',
      'สร้างแฟ้มใหม่จากตัวดึง FlowAccount หรือแก้ค่าในแฟ้มให้เป็นตัวเลข');
  }
  return satangOf(t);
}

function upsertPartner(p) {
  const kind = p.kind === 'vendor' ? 'vendor' : 'customer';
  const rec = {
    code: p.code, name: p.name, taxId: p.taxId || null, address: p.address || '',
    branch: p.branch || (p.entityType === 'individual' ? null : '00000'),
    entityType: p.entityType === 'individual' ? 'individual' : 'juristic',
    kind: kind, termDays: Number(p.termDays || 0), whtCode: p.whtCode || null,
    creditLimit: pkgAmount(p.creditLimit, 'วงเงินเครดิต ' + p.code), active: true,
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
    qty: roundQty(Number(i.qty || 0)), reorder: Number(i.reorder || 0),
  };
  /* มูลค่าต้องเป็นจำนวนเต็มสตางค์ — จำนวนมีทศนิยม (12.5 หน่วย) คูณตรง ๆ ได้เศษเกินสตางค์ */
  rec.value = mulQty(rec.avgCost, rec.qty);
  const at = DB.items.findIndex((x) => x.code === rec.code);
  if (at >= 0) { DB.items[at] = { ...DB.items[at], ...rec }; return 0; }
  DB.items.push(rec);
  return 1;
}

function upsertEmployee(e) {
  const rec = {
    code: e.code, name: e.name, dept: e.dept || 'ไม่ระบุ',
    salary: pkgAmount(e.salary, 'เงินเดือน ' + e.code), otHours: Number(e.otHours || 0),
    pvdRate: Number(e.pvdRate || 0), deductions: pkgAmount(e.deductions, 'ค่าลดหย่อน ' + e.code),
    active: e.active !== false, hired: e.hired || null,
    nationalId: e.nationalId || null, ssoNumber: e.ssoNumber || null,
  };
  const at = DB.employees.findIndex((x) => x.code === rec.code);
  if (at >= 0) { DB.employees[at] = { ...DB.employees[at], ...rec }; return 0; }
  DB.employees.push(rec);
  return 1;
}

/** เอกสารค้างยกมา — เป็นบัญชีย่อยเท่านั้น ไม่ลงบัญชีซ้ำ เพราะยอดอยู่ในงบทดลองแล้ว
    ใบที่ถูกยกเลิกไปพร้อมการยกเลิกนำเข้าครั้งก่อน นำเข้าใหม่แล้วต้องกลับมาค้างตามเดิม ไม่ใช่ข้ามไปเพราะเลขซ้ำ */
function importOpenDocs(pkg, entryNo) {
  let inv = 0, bill = 0;
  const slot = function (list, no) {
    const at = list.findIndex((x) => x.no === no);
    if (at < 0) return { put: (rec) => list.push(rec) };
    const ex = list[at];
    if (ex.broughtForward && ex.status === 'void') return { put: (rec) => { list[at] = rec; } };
    return null;
  };
  (pkg.openInvoices || []).forEach(function (d) {
    const at = slot(DB.docs.invoice, d.no);
    if (!at) return;
    const base = pkgAmount(d.base, d.no + ' มูลค่า'), vat = pkgAmount(d.vat, d.no + ' ภาษี');
    const total = d.total !== undefined ? pkgAmount(d.total, d.no + ' ยอดรวม') : base + vat;
    at.put({
      no: d.no, legacyNo: d.legacyNo || d.no, date: d.date, due: d.due || d.date,
      partnerCode: d.partnerCode, partnerName: d.partnerName,
      snap: { name:d.partnerName, taxId:d.taxId || null, branch:d.branch || '00000', address:d.address || '' },
      lines: [{ desc:'ยอดค้างยกมาจากระบบเดิม', qty:1, price:base, amount:base, taxCode:'EXEMPT', uom:'', itemCode:null }],
      base: base, vat: vat, total: total,
      paid: pkgAmount(d.paid, d.no + ' รับแล้ว'), credited: pkgAmount(d.credited, d.no + ' ลดหนี้แล้ว'),
      bfPaid: pkgAmount(d.paid, d.no + ' รับแล้ว') + pkgAmount(d.credited, d.no + ' ลดหนี้แล้ว'),
      status: 'issued', entryNo: entryNo, etax: 'not_applicable', broughtForward: true,
    });
    inv++;
  });
  (pkg.openBills || []).forEach(function (d) {
    const at = slot(DB.docs.bill, d.no);
    if (!at) return;
    const base = pkgAmount(d.base, d.no + ' มูลค่า'), vat = pkgAmount(d.vat, d.no + ' ภาษี');
    const total = d.total !== undefined ? pkgAmount(d.total, d.no + ' ยอดรวม') : base + vat;
    at.put({
      no: d.no, legacyNo: d.legacyNo || d.no, date: d.date, due: d.due || d.date,
      vendorNo: d.vendorNo || d.no, partnerCode: d.partnerCode, partnerName: d.partnerName,
      lines: [{ desc:'ยอดค้างยกมาจากระบบเดิม', qty:1, price:base, amount:base, itemCode:null }],
      base: base, vat: vat, total: total, claimable: true,
      paid: pkgAmount(d.paid, d.no + ' จ่ายแล้ว'), bfPaid: pkgAmount(d.paid, d.no + ' จ่ายแล้ว'), status: 'issued', entryNo: entryNo,
      whtCode: d.whtCode || null, broughtForward: true,
    });
    bill++;
  });
  return { inv, bill };
}

function importPackage(pkg, overrides, opts) {
  opts = opts || {};
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
      debit: pkgAmount(r.debit, 'งบทดลอง ' + r.code + ' เดบิต'), credit: pkgAmount(r.credit, 'งบทดลอง ' + r.code + ' เครดิต'),
    }));
    /* ยอดค้างรายคู่ค้าจากเอกสารที่ยกมา ใช้แยกบรรทัดลูกหนี้/เจ้าหนี้ในใบยอดยกมาตามคู่ค้า */
    const byPartner = function (docs, kind) {
      const out = {};
      (docs || []).forEach(function (d) {
        const total = d.total !== undefined ? pkgAmount(d.total, d.no + ' ยอดรวม')
          : pkgAmount(d.base, d.no + ' มูลค่า') + pkgAmount(d.vat, d.no + ' ภาษี');
        const left = total - pkgAmount(d.paid, d.no + ' ชำระแล้ว') - (kind === 'ar' ? pkgAmount(d.credited, d.no + ' ลดหนี้แล้ว') : 0);
        if (d.partnerCode && left) out[d.partnerCode] = (out[d.partnerCode] || 0) + left;
      });
      return out;
    };
    const split = {};
    if ((pkg.openInvoices || []).length) split.trade_receivable = { by: byPartner(pkg.openInvoices, 'ar'), sign: 1 };
    if ((pkg.openBills || []).length) split.trade_payable = { by: byPartner(pkg.openBills, 'ap'), sign: -1 };
    opening = importOpeningBalances(tb, pkg.cutoff, overrides, { partnerSplit: split, ack: !!opts.ack });
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

/* ทั้งคำสั่งนำเข้าและยกเลิกต้องจบแบบทั้งหมดหรือไม่มีเลย (ดู atomically ใน engine.js)
   ไม่งั้นนำเข้าไม่ผ่านแล้วบัญชีที่สร้าง คู่ค้า สินค้า หรือพนักงานที่อัปเดตไปแล้วจะค้างอยู่ */
importOpeningBalances = transactional(importOpeningBalances);
importPeriodMovement = transactional(importPeriodMovement);
importPackage = transactional(importPackage);
reverseImport = transactional(reverseImport);
