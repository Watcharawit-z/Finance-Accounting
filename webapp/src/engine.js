/* ===================================================================
   Financii — เครื่องบัญชีที่รันในเบราว์เซอร์
   ตรรกะเดียวกับ apps/api แต่เก็บข้อมูลไว้ในเครื่องผู้ใช้
   =================================================================== */

/* ---------- เงิน: จำนวนเต็มสเกล 4 ตำแหน่ง ห้ามใช้ทศนิยมลอยตัว ---------- */
const S = 10000;

function M(v) {
  if (typeof v === 'number') return Math.round(v * S);
  if (typeof v === 'string') {
    const t = v.trim().replace(/,/g, '');
    if (!/^-?\d*(\.\d+)?$/.test(t) || t === '' || t === '-') return 0;
    return Math.round(parseFloat(t) * S);
  }
  return 0;
}
const divRound = (n, d) => {
  const neg = (n < 0) !== (d < 0);
  const a = Math.abs(n), b = Math.abs(d);
  const q = Math.floor(a / b), r = a - q * b;
  const out = r * 2 >= b ? q + 1 : q;
  return neg ? -out : out;
};
const mulQty  = (a, q) => divRound(a * M(q), S);
const pct     = (a, rate) => divRound(a * M(rate), S * 100);
const round2  = (a) => divRound(a, 100) * 100;
const baseFromIncl = (incl, rate) => round2(divRound(incl * 100 * S, 100 * S + M(rate)));

function fmt(a, dec) {
  dec = dec === undefined ? 2 : dec;
  const neg = a < 0, abs = Math.abs(a);
  const unit = Math.pow(10, 4 - dec);
  const r = divRound(abs, unit);
  const p = Math.pow(10, dec);
  const i = Math.floor(r / p);
  const f = String(r - i * p).padStart(dec, '0');
  const g = String(i).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = dec > 0 ? g + '.' + f : g;
  return neg ? '(' + body + ')' : body;
}
const fmt0 = (a) => (a === 0 ? '—' : fmt(a));

/* ทางกลับของ M() — คืนข้อความทศนิยม 4 ตำแหน่ง ไม่มีเครื่องหมายคั่นหลักพัน
   ต้องใช้ทุกครั้งที่ส่งจำนวนเงินที่คูณสเกลแล้วกลับเข้าฟังก์ชันที่รับข้อความ
   ถ้าส่งตัวเลขดิบเข้าไป M() จะคูณสเกลซ้ำอีกรอบแล้วยอดจะบานเป็นหมื่นเท่า */
function unM(a) {
  const neg = a < 0, abs = Math.abs(a);
  const i = Math.floor(abs / S);
  return (neg ? '-' : '') + i + '.' + String(abs - i * S).padStart(4, '0');
}

/* ---------- วันที่แบบไทย ---------- */
const TH_M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const TH_MF = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน',
               'กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
function thDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + TH_M[m - 1] + ' ' + (y + 543);
}
function thDateNum(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return String(d).padStart(2,'0') + '/' + String(m).padStart(2,'0') + '/' + (y + 543);
}
function thPeriod(p) {           // '2026-07' → 'กรกฎาคม 2569'
  const [y, m] = p.split('-').map(Number);
  return TH_MF[m - 1] + ' ' + (y + 543);
}
const periodOf = (iso) => iso.slice(0, 7);
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function endOfMonth(iso) {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/* ---------- เลขประจำตัวผู้เสียภาษี ---------- */
function validTaxId(id) {
  if (!/^\d{13}$/.test(id || '')) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(id[i]) * (13 - i);
  return ((11 - (sum % 11)) % 10) === Number(id[12]);
}

/* ---------- ข้อผิดพลาดเชิงธุรกิจ ---------- */
class DomainError extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code; this.hint = hint;
  }
}

/* ===================================================================
   ฐานข้อมูลในเครื่อง
   =================================================================== */
/** โครงข้อมูลเปล่าของกิจการหนึ่งราย — ใช้เป็นแม่แบบตอนสลับบริษัท */
function blankState() {
  return {
    company: null,
    accounts: [],        // {code,name,type,subType,postable,contra,parent,level,requiresPartner}
    partners: [],
    items: [],
    employees: [],
    assets: [],
    periods: [],         // {code,start,end,status}
    entries: [],         // {no,date,type,desc,src,srcId,status,lines:[...],reversedBy,reverseOf,reason}
    taxTx: [],           // {kind,period,date,docNo,docType,partnerName,taxId,branch,base,tax,...}
    docs: {              // เอกสารแยกตามประเภท
      quotation: [], salesOrder: [], invoice: [], receipt: [],
      creditNote: [], debitNote: [],
      purchaseOrder: [], bill: [], payment: [], whtCert: [],
      stockMove: [], payRun: [], depreciation: [], filing: [],
    },
    seq: {},             // {'invoice|2026-07': 12}
    budget: [],          // {account,period,amount}
    projects: [],
    bankTxns: [],        // รายการเดินบัญชีที่ยังไม่กระทบยอด
    audit: [],
    settings: { hardLockDate: null },
    isDemo: false,       // true = ข้อมูลตัวอย่างที่ระบบสร้างให้ ไม่ใช่ข้อมูลจริงของผู้ใช้
  };
}

const DB = blankState();

/**
 * ★ ยกข้อมูลของกิจการหนึ่งเข้ามาทั้งก้อน — ล้างของเดิมให้เกลี้ยงก่อนเสมอ
 *   ถ้าใช้วิธีทับทีละคีย์ คีย์ที่กิจการใหม่ไม่มีจะค้างจากกิจการเดิม
 *   เช่นสลับจากบริษัทที่มีใบกำกับ 91 ใบ ไปบริษัทเปล่า แล้วใบกำกับยังอยู่
 */
function loadState(obj) {
  const fresh = blankState();
  Object.keys(DB).forEach((k) => { if (!(k in fresh)) delete DB[k]; });
  Object.keys(fresh).forEach((k) => { DB[k] = fresh[k]; });
  if (!obj || typeof obj !== 'object') return false;
  Object.keys(obj).forEach((k) => { if (k in fresh) DB[k] = obj[k]; });
  /* เอกสารประเภทที่เพิ่มเข้ามาทีหลัง ต้องมีอาร์เรย์รองรับเสมอ */
  if (!DB.docs || typeof DB.docs !== 'object') DB.docs = fresh.docs;
  Object.keys(fresh.docs).forEach((k) => { if (!Array.isArray(DB.docs[k])) DB.docs[k] = []; });
  if (!DB.settings) DB.settings = fresh.settings;
  if (DB.isDemo === undefined) {
    DB.isDemo = !!(DB.company && DB.company.name === 'บริษัท ศรีวัฒนาการค้า จำกัด');
  }
  return !!DB.company;
}

/* ---------- อัตราภาษีตามช่วงเวลา (ข้อมูล ไม่ใช่โค้ด) ---------- */
const TAX_RATES = [
  { code:'VAT7',      kind:'vat', rate:'7',  from:'1999-04-01', to:null, cond:{}, ref:'พ.ร.ฎ. ลดอัตราภาษีมูลค่าเพิ่ม' },
  { code:'VAT0',      kind:'vat', rate:'0',  from:'1992-01-01', to:null, cond:{}, ref:'ม.80/1' },
  { code:'EXEMPT',    kind:'vat', rate:'0',  from:'1992-01-01', to:null, cond:{}, ref:'ม.81' },

  { code:'WHT_SERVICE',   kind:'wht', rate:'3', from:'2000-01-01', to:null, cond:{channel:'manual'}, ref:'ท.ป.4/2528 ข้อ 8', label:'ค่าบริการ/จ้างทำของ' },
  { code:'WHT_SERVICE',   kind:'wht', rate:'1', from:'2026-01-01', to:'2027-12-31', cond:{channel:'e_wht'}, ref:'มาตรการ e-Withholding Tax', label:'ค่าบริการ/จ้างทำของ' },
  { code:'WHT_RENT',      kind:'wht', rate:'5', from:'2000-01-01', to:null, cond:{channel:'manual'}, ref:'ท.ป.4/2528 ข้อ 6', label:'ค่าเช่าอสังหาริมทรัพย์' },
  { code:'WHT_RENT',      kind:'wht', rate:'1', from:'2026-01-01', to:'2027-12-31', cond:{channel:'e_wht'}, ref:'มาตรการ e-Withholding Tax', label:'ค่าเช่าอสังหาริมทรัพย์' },
  { code:'WHT_TRANSPORT', kind:'wht', rate:'1', from:'2000-01-01', to:null, cond:{channel:'manual'}, ref:'ท.ป.4/2528 ข้อ 12', label:'ค่าขนส่ง' },
  { code:'WHT_ADVERT',    kind:'wht', rate:'2', from:'2000-01-01', to:null, cond:{channel:'manual'}, ref:'ท.ป.4/2528 ข้อ 10', label:'ค่าโฆษณา' },
  { code:'WHT_PROF',      kind:'wht', rate:'3', from:'2000-01-01', to:null, cond:{channel:'manual'}, ref:'ท.ป.4/2528 ข้อ 7', label:'วิชาชีพอิสระ' },
  { code:'WHT_CONTRACT',  kind:'wht', rate:'3', from:'2000-01-01', to:null, cond:{channel:'manual'}, ref:'ท.ป.4/2528 ข้อ 8', label:'รับเหมา' },
];

const SSO_RATES = [
  { from:'2003-01-01', to:'2025-12-31', pct:5, floor:M('1650'), ceiling:M('15000'), max:M('750') },
  { from:'2026-01-01', to:null,         pct:5, floor:M('1650'), ceiling:M('17500'), max:M('875') },
];

const PIT_BRACKETS = [
  { lo:M('0'),       hi:M('150000'),  rate:0  },
  { lo:M('150000'),  hi:M('300000'),  rate:5  },
  { lo:M('300000'),  hi:M('500000'),  rate:10 },
  { lo:M('500000'),  hi:M('750000'),  rate:15 },
  { lo:M('750000'),  hi:M('1000000'), rate:20 },
  { lo:M('1000000'), hi:M('2000000'), rate:25 },
  { lo:M('2000000'), hi:M('5000000'), rate:30 },
  { lo:M('5000000'), hi:null,         rate:35 },
];

const TAX_DEPRECIATION = {
  BUILDING:   { rate:5,     years:20, label:'อาคารถาวร' },
  MACHINERY:  { rate:20,    years:5,  label:'เครื่องจักรและอุปกรณ์', smeBonus:40 },
  COMPUTER:   { rate:33.33, years:3,  label:'คอมพิวเตอร์และอุปกรณ์', smeBonus:40 },
  VEHICLE:    { rate:20,    years:5,  label:'ยานพาหนะ' },
  CAR:        { rate:20,    years:5,  label:'รถยนต์นั่งไม่เกิน 10 คน', costCap:M('1000000') },
  OFFICE:     { rate:20,    years:5,  label:'เครื่องใช้สำนักงาน' },
  FURNITURE:  { rate:20,    years:5,  label:'เครื่องตกแต่งและติดตั้ง' },
  LAND:       { rate:0,     years:0,  label:'ที่ดิน' },
};

function inWindow(r, date) {
  return date >= r.from && (!r.to || date <= r.to);
}
/** ★ lookup ด้วยวันที่ของเอกสารเสมอ ไม่ใช่วันที่ปัจจุบัน */
function resolveRate(code, date, cond) {
  cond = cond || {};
  const candidates = TAX_RATES.filter(function (r) {
    if (r.code !== code || !inWindow(r, date)) return false;
    return Object.keys(r.cond).every(function (k) { return cond[k] === r.cond[k]; });
  });
  if (!candidates.length) {
    throw new DomainError('TAX_RATE_NOT_FOUND',
      'ไม่พบอัตราภาษีที่มีผลบังคับ ณ วันที่ ' + thDate(date) + ' สำหรับรหัส ' + code,
      'ตรวจสอบตารางอัตราภาษี อาจมีประกาศใหม่ที่ยังไม่ได้บันทึกเข้าระบบ');
  }
  candidates.sort((a, b) => Object.keys(b.cond).length - Object.keys(a.cond).length);
  return candidates[0];
}
function ssoRate(date) {
  const r = SSO_RATES.find((x) => inWindow(x, date));
  if (!r) throw new DomainError('SSO_RATE_NOT_FOUND', 'ไม่พบอัตราประกันสังคมที่มีผล ณ ' + thDate(date));
  return r;
}

/* ===================================================================
   ผังบัญชี
   =================================================================== */
function acc(code) {
  const a = DB.accounts.find((x) => x.code === code);
  if (!a) throw new DomainError('ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีรหัส ' + code);
  return a;
}
function accBySub(subType) {
  const a = DB.accounts.find((x) => x.subType === subType && x.postable);
  if (!a) {
    throw new DomainError('ACCOUNT_MAPPING_MISSING',
      'ยังไม่ได้ผูกบัญชีสำหรับประเภท "' + subType + '" ในผังบัญชี',
      'เพิ่มบัญชีที่มี sub_type นี้ในผังบัญชีก่อน');
  }
  return a.code;
}

/* ===================================================================
   งวดบัญชี
   =================================================================== */
function periodFor(date) {
  const p = DB.periods.find((x) => date >= x.start && date <= x.end);
  if (!p) {
    throw new DomainError('PERIOD_NOT_FOUND',
      'ยังไม่ได้สร้างงวดบัญชีที่ครอบคลุมวันที่ ' + thDate(date),
      'สร้างรอบบัญชีในหน้าตั้งค่าก่อน');
  }
  return p;
}

/* ===================================================================
   เลขที่เอกสาร — จองตอนลงบัญชีเท่านั้น
   =================================================================== */
const SEQ_PREFIX = {
  invoice:'INV', receipt:'RC', creditNote:'CN', debitNote:'DN', quotation:'QT', salesOrder:'SO',
  purchaseOrder:'PO', bill:'AP', payment:'PV', whtCert:'WT', stockCount:'SC',
  je_sales:'SA', je_purchase:'PU', je_receipt:'RV', je_payment:'PY',
  je_general:'JV', je_adjustment:'JV', je_payroll:'PR', je_asset:'AS',
  je_inventory:'IV', je_opening:'OB', je_closing:'CL',
};
function nextNo(docType, date) {
  const p = periodOf(date).replace('-', '').slice(2);   // 2026-07 → 2607
  const key = docType + '|' + periodOf(date);
  DB.seq[key] = (DB.seq[key] || 0) + 1;
  const prefix = SEQ_PREFIX[docType] || docType.toUpperCase().slice(0, 3);
  return prefix + p + '-' + String(DB.seq[key]).padStart(5, '0');
}

/* ===================================================================
   ★ ประตูเดียวที่เขียนลงบัญชีแยกประเภท
   =================================================================== */
function post(req) {
  const lines = req.lines.filter((l) => (l.dr || 0) !== 0 || (l.cr || 0) !== 0);
  if (lines.length < 2) {
    throw new DomainError('ENTRY_TOO_FEW_LINES', 'รายการบัญชีต้องมีอย่างน้อย 2 บรรทัด');
  }
  const dr = lines.reduce((s, l) => s + (l.dr || 0), 0);
  const cr = lines.reduce((s, l) => s + (l.cr || 0), 0);
  if (dr !== cr) {
    throw new DomainError('ENTRY_UNBALANCED',
      'รายการไม่สมดุล เดบิตรวม ' + fmt(dr) + ' ไม่เท่ากับเครดิตรวม ' + fmt(cr),
      'ตรวจสอบบรรทัดรายการอีกครั้ง');
  }
  if (dr === 0) throw new DomainError('ENTRY_ZERO_AMOUNT', 'ลงบัญชีรายการที่ยอดรวมเป็นศูนย์ไม่ได้');

  const period = periodFor(req.date);
  if (period.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED',
      'งวดบัญชี ' + thPeriod(period.code) + ' ปิดแล้ว ลงรายการไม่ได้',
      'เปลี่ยนวันที่เป็นงวดที่ยังเปิดอยู่ หรือเปิดงวดใหม่ในหน้าปิดงวด');
  }
  if (DB.settings.hardLockDate && req.date <= DB.settings.hardLockDate) {
    throw new DomainError('PERIOD_LOCKED_HARD',
      'วันที่ ' + thDate(req.date) + ' อยู่ก่อนวันล็อกข้อมูล ' + thDate(DB.settings.hardLockDate));
  }

  lines.forEach(function (l) {
    const a = acc(l.acc);
    if (!a.postable) {
      throw new DomainError('ACCOUNT_NOT_POSTABLE',
        'บัญชี ' + a.code + ' ' + a.name + ' เป็นบัญชีหัวข้อ ลงรายการไม่ได้', 'เลือกบัญชีย่อยแทน');
    }
    if (a.requiresPartner && !l.partner) {
      throw new DomainError('PARTNER_REQUIRED',
        'บัญชี ' + a.code + ' ' + a.name + ' ต้องระบุลูกหนี้หรือเจ้าหนี้');
    }
    if ((l.dr || 0) > 0 && (l.cr || 0) > 0) {
      throw new DomainError('LINE_BOTH_SIDES', 'บรรทัดเดียวมีทั้งเดบิตและเครดิตไม่ได้');
    }
  });

  const entry = {
    no: nextNo('je_' + req.type, req.date),
    date: req.date,
    type: req.type,
    desc: req.desc,
    src: req.src || null,
    srcId: req.srcId || null,
    status: 'posted',
    lines: lines.map((l, i) => ({
      n: i + 1, acc: l.acc, dr: l.dr || 0, cr: l.cr || 0,
      partner: l.partner || null, memo: l.memo || null,
    })),
    total: dr,
  };
  DB.entries.push(entry);
  audit('journal_entry', entry.no, 'post', null, { total: fmt(dr), desc: req.desc });
  return entry;
}

function reverse(entryNo, reason, date) {
  const e = DB.entries.find((x) => x.no === entryNo);
  if (!e) throw new DomainError('ENTRY_NOT_FOUND', 'ไม่พบรายการ ' + entryNo);
  if (e.status !== 'posted') {
    throw new DomainError('ALREADY_REVERSED', 'รายการ ' + entryNo + ' ถูกกลับรายการไปแล้ว');
  }
  if (!reason || reason.trim().length < 5) {
    throw new DomainError('REASON_REQUIRED',
      'การกลับรายการต้องระบุเหตุผล เพื่อให้ผู้สอบบัญชีตรวจสอบได้ภายหลัง');
  }
  const rev = post({
    type: 'adjustment',
    date: date || e.date,
    desc: 'กลับรายการ ' + e.no + ': ' + reason.trim(),
    src: 'reversal', srcId: e.no,
    lines: e.lines.map((l) => ({ acc: l.acc, dr: l.cr, cr: l.dr, partner: l.partner, memo: l.memo })),
  });
  e.status = 'reversed';
  e.reversedBy = rev.no;
  e.reason = reason.trim();
  audit('journal_entry', e.no, 'reverse', { status: 'posted' }, { status: 'reversed', by: rev.no }, reason);
  return rev;
}

function audit(entity, id, action, before, after, reason) {
  DB.audit.unshift({
    at: new Date().toISOString(),
    user: 'ผู้ใช้ตัวอย่าง',
    entity, id, action,
    before: before || null, after: after || null, reason: reason || null,
  });
  if (DB.audit.length > 500) DB.audit.length = 500;
}

/* ===================================================================
   ยอดคงเหลือและรายงาน
   =================================================================== */
const LIVE = (e) => e.status === 'posted' || e.status === 'reversed';

function balanceOf(codeOrFilter, upto, from, entryFilter) {
  let dr = 0, cr = 0;
  DB.entries.forEach(function (e) {
    if (!LIVE(e)) return;
    if (upto && e.date > upto) return;
    if (from && e.date < from) return;
    if (entryFilter && !entryFilter(e)) return;
    e.lines.forEach(function (l) {
      const ok = typeof codeOrFilter === 'function' ? codeOrFilter(acc(l.acc)) : l.acc === codeOrFilter;
      if (ok) { dr += l.dr; cr += l.cr; }
    });
  });
  return dr - cr;
}
const balBySub = (subTypes, upto, from, entryFilter) =>
  balanceOf((a) => subTypes.indexOf(a.subType) >= 0, upto, from, entryFilter);

function trialBalance(from, to) {
  const rows = [];
  DB.accounts.filter((a) => a.postable).forEach(function (a) {
    let od = 0, dr = 0, cr = 0;
    DB.entries.forEach(function (e) {
      if (!LIVE(e)) return;
      e.lines.forEach(function (l) {
        if (l.acc !== a.code) return;
        if (e.date < from) od += l.dr - l.cr;
        else if (e.date <= to) { dr += l.dr; cr += l.cr; }
      });
    });
    if (od || dr || cr) rows.push({ code:a.code, name:a.name, sub:a.subType, opening:od, dr, cr, closing:od + dr - cr });
  });
  const td = rows.reduce((s, r) => s + r.dr, 0);
  const tc = rows.reduce((s, r) => s + r.cr, 0);
  return { rows, totalDr: td, totalCr: tc, balanced: td === tc };
}

/* โครงงบการเงิน — อ้าง subType ไม่ใช่รหัสบัญชี */
const BS_LINES = [
  { k:'h',  label:'สินทรัพย์' },
  { k:'h2', label:'สินทรัพย์หมุนเวียน' },
  { k:'d',  label:'เงินสดและรายการเทียบเท่าเงินสด', sub:['cash','bank','cash_in_transit'], sign:1, note:2 },
  { k:'d',  label:'ลูกหนี้การค้าและลูกหนี้อื่น', sub:['trade_receivable','other_receivable','accrued_income','ar_allowance'], sign:1, note:3 },
  { k:'d',  label:'สินค้าคงเหลือ', sub:['inventory','inventory_allowance'], sign:1, note:4 },
  { k:'d',  label:'สินทรัพย์หมุนเวียนอื่น', sub:['input_vat','vat_receivable','wht_asset','prepaid_expense','prepaid_cit','deposit_paid','suspense'], sign:1 },
  { k:'s',  label:'รวมสินทรัพย์หมุนเวียน', section:'asset' },
  { k:'h2', label:'สินทรัพย์ไม่หมุนเวียน' },
  { k:'d',  label:'ที่ดิน อาคารและอุปกรณ์', sub:['ppe_land','ppe','cip','accum_depreciation'], sign:1, note:5 },
  { k:'d',  label:'สินทรัพย์ไม่มีตัวตน', sub:['intangible','accum_amortization'], sign:1 },
  { k:'d',  label:'สินทรัพย์ไม่หมุนเวียนอื่น', sub:['long_term_investment','other_asset'], sign:1 },
  { k:'s',  label:'รวมสินทรัพย์ไม่หมุนเวียน', section:'asset' },
  { k:'t',  label:'รวมสินทรัพย์', section:'asset_total' },
  { k:'sp' },
  { k:'h',  label:'หนี้สินและส่วนของผู้ถือหุ้น' },
  { k:'h2', label:'หนี้สินหมุนเวียน' },
  { k:'d',  label:'เจ้าหนี้การค้าและเจ้าหนี้อื่น', sub:['trade_payable','grni','accrued_expense','accrued_payroll','other_payable'], sign:-1, note:6 },
  { k:'d',  label:'หนี้สินทางภาษีและเงินสมทบ', sub:['output_vat','vat_payable','wht_payable_pnd1','wht_payable_pnd3','wht_payable_pnd53','cit_payable','sso_payable','pvd_payable'], sign:-1, note:7 },
  { k:'d',  label:'เงินรับล่วงหน้าจากลูกค้า', sub:['customer_deposit','unearned_revenue'], sign:-1 },
  { k:'s',  label:'รวมหนี้สินหมุนเวียน', section:'le' },
  { k:'h2', label:'หนี้สินไม่หมุนเวียน' },
  { k:'d',  label:'เงินกู้ยืมระยะยาว', sub:['long_term_loan'], sign:-1 },
  { k:'d',  label:'ประมาณการหนี้สินผลประโยชน์พนักงาน', sub:['employee_benefit_obligation'], sign:-1 },
  { k:'s',  label:'รวมหนี้สินไม่หมุนเวียน', section:'le' },
  { k:'s',  label:'รวมหนี้สิน', section:'le_sub' },
  { k:'h2', label:'ส่วนของผู้ถือหุ้น' },
  { k:'d',  label:'ทุนที่ออกและชำระแล้ว', sub:['paid_up_capital'], sign:-1 },
  { k:'d',  label:'สำรองตามกฎหมาย', sub:['legal_reserve'], sign:-1 },
  { k:'d',  label:'กำไรสะสม', sub:['retained_earnings','current_year_earnings','dividend','opening_balance'], sign:-1, plNet:true },
  { k:'s',  label:'รวมส่วนของผู้ถือหุ้น', section:'le' },
  { k:'t',  label:'รวมหนี้สินและส่วนของผู้ถือหุ้น', section:'le_total' },
];

function balanceSheet(asOf) {
  const out = [];
  let running = 0, assetTotal = 0, leTotal = 0, leSub = 0, liabTotal = 0;
  BS_LINES.forEach(function (L) {
    if (L.k === 'd') {
      let v = balBySub(L.sub, asOf) * L.sign;
      if (L.plNet) {
        // กำไรของงวดที่ยังไม่ปิดบัญชีต้องเข้าส่วนของผู้ถือหุ้น ไม่งั้นงบไม่สมดุล
        v += balanceOf((a) => a.type === 'revenue' || a.type === 'expense', asOf) * L.sign;
      }
      running += v;
      out.push({ ...L, value: v });
    } else if (L.k === 's') {
      // ★ "รวมหนี้สิน" ไม่ใช่ผลรวมของบรรทัดที่ค้างอยู่ แต่เป็นผลรวมของยอดรวมย่อยก่อนหน้า
      if (L.section === 'le_sub') { liabTotal = leSub; out.push({ ...L, value: leSub }); return; }
      out.push({ ...L, value: running });
      if (L.section === 'asset') assetTotal += running;
      if (L.section === 'le') { leTotal += running; leSub += running; }
      running = 0;
    } else if (L.k === 't') {
      const v = L.section === 'asset_total' ? assetTotal : leTotal;
      out.push({ ...L, value: v });
    } else {
      out.push({ ...L });
    }
  });
  return { lines: out, assets: assetTotal, liabEquity: leTotal, diff: assetTotal - leTotal,
    liabilities: liabTotal, equity: leTotal - liabTotal };
}

const PL_LINES = [
  { k:'d', label:'รายได้จากการขายและบริการ', sub:['sales_revenue','sales_revenue_export','service_revenue','rental_revenue','sales_return','sales_discount'], sign:-1, group:'rev' },
  { k:'d', label:'ต้นทุนขายและต้นทุนบริการ', sub:['cogs','cost_of_service','purchases','purchase_return'], sign:1, group:'exp' },
  { k:'s', label:'กำไรขั้นต้น', calc:'gross' },
  { k:'d', label:'รายได้อื่น', sub:['other_income','interest_income','fx_gain','gain_on_disposal','bad_debt_recovery'], sign:-1, group:'rev' },
  { k:'d', label:'ค่าใช้จ่ายในการขาย', sub:['selling_expense'], sign:1, group:'exp' },
  { k:'d', label:'ค่าใช้จ่ายในการบริหาร', sub:['admin_expense','sso_expense','pvd_expense','depreciation','amortization','bad_debt','fx_loss','loss_on_disposal','non_deductible','non_claimable_vat_expense','rounding','inventory_writeoff'], sign:1, group:'exp' },
  { k:'s', label:'กำไรก่อนต้นทุนทางการเงินและภาษีเงินได้', calc:'ebit' },
  { k:'d', label:'ต้นทุนทางการเงิน', sub:['finance_cost'], sign:1, group:'exp' },
  { k:'s', label:'กำไรก่อนภาษีเงินได้', calc:'ebt' },
  { k:'d', label:'ภาษีเงินได้นิติบุคคล', sub:['income_tax_expense'], sign:1, group:'exp' },
  { k:'t', label:'กำไรสุทธิ', calc:'net' },
];

function incomeStatement(from, to) {
  const vals = {};
  const out = [];
  PL_LINES.forEach(function (L) {
    if (L.k === 'd') {
      const v = balBySub(L.sub, to, from) * L.sign;
      vals[L.label] = v;
      out.push({ ...L, value: v });
    } else out.push({ ...L });
  });
  const rev   = vals['รายได้จากการขายและบริการ'] || 0;
  const cogs  = vals['ต้นทุนขายและต้นทุนบริการ'] || 0;
  const other = vals['รายได้อื่น'] || 0;
  const sell  = vals['ค่าใช้จ่ายในการขาย'] || 0;
  const admin = vals['ค่าใช้จ่ายในการบริหาร'] || 0;
  const fin   = vals['ต้นทุนทางการเงิน'] || 0;
  const tax   = vals['ภาษีเงินได้นิติบุคคล'] || 0;
  const gross = rev - cogs, ebit = gross + other - sell - admin, ebt = ebit - fin, net = ebt - tax;
  const calc = { gross, ebit, ebt, net };
  out.forEach(function (L) { if (L.calc) L.value = calc[L.calc]; });
  return { lines: out, revenue: rev, gross, ebit, ebt, net };
}

/**
 * งบกระแสเงินสด — จำแนกจากบัญชีคู่ของทุกรายการที่กระทบเงินสดจริง
 * วิธีนี้ทำให้ ต้นงวด + ดำเนินงาน + ลงทุน + จัดหาเงิน = ปลายงวด เสมอ
 * ไม่มีทางเหลือส่วนที่อธิบายไม่ได้
 */
const CASH_SUB = ['cash','bank','cash_in_transit'];
const INVESTING_SUB = ['ppe','ppe_land','cip','intangible','long_term_investment','accum_depreciation','accum_amortization'];
const FINANCING_SUB = ['long_term_loan','paid_up_capital','legal_reserve','dividend','share_premium'];

function cashFlow(from, to) {
  const isCash = (code) => CASH_SUB.indexOf(acc(code).subType) >= 0;
  const opening = balBySub(CASH_SUB, addDays(from, -1));
  const closing = balBySub(CASH_SUB, to);
  const buckets = { operating: 0, investing: 0, financing: 0 };
  const detail = { operating: {}, investing: {}, financing: {} };

  DB.entries.forEach(function (e) {
    if (!LIVE(e) || e.date < from || e.date > to) return;
    const cashLines = e.lines.filter((l) => isCash(l.acc));
    if (!cashLines.length) return;
    const delta = cashLines.reduce((s, l) => s + l.dr - l.cr, 0);
    if (delta === 0) return;

    const others = e.lines.filter((l) => !isCash(l.acc));
    const subs = others.map((l) => acc(l.acc).subType);
    const bucket = subs.some((x) => INVESTING_SUB.indexOf(x) >= 0) ? 'investing'
                 : subs.some((x) => FINANCING_SUB.indexOf(x) >= 0) ? 'financing'
                 : 'operating';
    buckets[bucket] += delta;

    // แยกรายละเอียดตามบัญชีคู่ เพื่อให้คลิกดูที่มาได้
    const total = others.reduce((s, l) => s + Math.abs(l.dr - l.cr), 0) || 1;
    others.forEach(function (l) {
      const a = acc(l.acc);
      const share = divRound(delta * Math.abs(l.dr - l.cr), total);
      detail[bucket][a.name] = (detail[bucket][a.name] || 0) + share;
    });
  });

  const net = buckets.operating + buckets.investing + buckets.financing;
  return {
    opening, closing, net,
    operating: buckets.operating, investing: buckets.investing, financing: buckets.financing,
    detail,
    unexplained: (opening + net) - closing,
  };
}

/* ---------- ยอดคงค้างของเอกสาร ณ วันที่ที่กำหนด ----------
   ★ ต้องคิดจากใบเสร็จ/ใบสำคัญจ่ายที่เกิดก่อนวันนั้น ไม่ใช่ยอดชำระสะสมล่าสุด
   ไม่งั้นรายงานย้อนหลังจะหักเงินที่รับหลังวันที่รายงานออกไปด้วย */
function settledUpto(kind, docNo, asOf) {
  if (kind === 'ar') {
    let v = 0;
    DB.docs.receipt.forEach((r) => { if (r.invoiceNo === docNo && r.date <= asOf) v += r.gross; });
    DB.docs.creditNote.forEach((c) => { if (c.invoiceNo === docNo && c.date <= asOf) v += c.total; });
    /* ใบเพิ่มหนี้เดินกลับทาง — ทำให้ลูกหนี้ค้างมากขึ้น ไม่ใช่น้อยลง */
    DB.docs.debitNote.forEach((c) => { if (c.invoiceNo === docNo && c.date <= asOf) v -= c.total; });
    return v;
  }
  let v = 0;
  DB.docs.payment.forEach((p) => { if (p.billNo === docNo && p.date <= asOf) v += p.gross; });
  return v;
}
/* bfPaid = ยอดที่ชำระไปแล้วก่อนวันตัดยอด ตอนย้ายข้อมูลเข้ามา
   ในระบบเราไม่มีใบเสร็จรองรับส่วนนั้น จึงต้องหักแยกจากใบเสร็จที่เกิดหลังย้าย
   ไม่งั้นถ้าใช้ d.paid ตรง ๆ จะถูกนับซ้ำเมื่อมีการรับชำระเพิ่มภายหลัง */
const outstandingAsOf = (kind, d, asOf) =>
  d.total - (d.bfPaid || 0) - settledUpto(kind, d.no, asOf);

/* ยอดคงค้าง ณ ปัจจุบัน — เขียนไว้ที่เดียว หน้าจอและรายงานต้องเรียกตัวนี้เท่านั้น
   ไม่งั้นพอเพิ่มประเภทเอกสารใหม่ จะมีบางหน้าลืมนับแล้วตัวเลขเพี้ยนแบบหายาก */
const invOutstanding = (d) => d.total + (d.debited || 0) - d.paid - d.credited;
const billOutstanding = (d) => d.total - d.paid;

/* ---------- อายุหนี้ ---------- */
function aging(kind, asOf) {
  const docs = kind === 'ar' ? DB.docs.invoice : DB.docs.bill;
  const map = {};
  docs.forEach(function (d) {
    if (d.status === 'draft' || d.status === 'void') return;
    if (d.date > asOf) return;
    const out = outstandingAsOf(kind, d, asOf);
    if (out <= 0) return;
    const days = Math.floor((new Date(asOf) - new Date(d.due)) / 86400000);
    const b = days <= 0 ? 'notDue' : days <= 30 ? 'b30' : days <= 60 ? 'b60' : days <= 90 ? 'b90' : 'over';
    const key = d.partnerCode;
    if (!map[key]) map[key] = { name: d.partnerName, notDue:0, b30:0, b60:0, b90:0, over:0, total:0 };
    map[key][b] += out;
    map[key].total += out;
  });
  const rows = Object.keys(map).map((k) => ({ code:k, ...map[k] })).sort((a,b) => b.total - a.total);
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);
  return { rows, totals: { notDue:sum('notDue'), b30:sum('b30'), b60:sum('b60'), b90:sum('b90'), over:sum('over'), total:sum('total') } };
}

/* ---------- ตรวจยอดคุม ---------- */
function reconciliationChecks(asOf) {
  const checks = [];
  const arControl = balBySub(['trade_receivable'], asOf);
  const arSub = DB.docs.invoice.filter((d) => d.status !== 'draft' && d.status !== 'void' && d.date <= asOf)
    .reduce((s, d) => s + outstandingAsOf('ar', d, asOf), 0);
  checks.push({ code:'AR_SUBLEDGER', label:'ลูกหนี้รายรายรวม = บัญชีคุมลูกหนี้', control:arControl, sub:arSub, ok:arControl === arSub });

  const apControl = -balBySub(['trade_payable'], asOf);
  const apSub = DB.docs.bill.filter((d) => d.status !== 'draft' && d.status !== 'void' && d.date <= asOf)
    .reduce((s, d) => s + outstandingAsOf('ap', d, asOf), 0);
  checks.push({ code:'AP_SUBLEDGER', label:'เจ้าหนี้รายรายรวม = บัญชีคุมเจ้าหนี้', control:apControl, sub:apSub, ok:apControl === apSub });

  const glDiff = balanceOf(() => true, asOf);
  checks.push({ code:'GL_BALANCED', label:'เดบิตรวม = เครดิตรวม ทั้งฐานข้อมูล', control:glDiff, sub:0, ok:glDiff === 0 });

  // ★ เทียบเฉพาะรายการที่มาจากเอกสารของงวดนี้จริง ๆ
  //   - ไม่รวมใบสำคัญปิดภาษีสิ้นเดือน ไม่งั้นหลังยื่นแบบบัญชีจะถูกเคลียร์เป็นศูนย์ แล้วการเทียบไม่มีความหมาย
  //   - ไม่รวมยอดยกมาจากระบบเดิม เพราะเป็นยอดสะสมก่อนเริ่มใช้ระบบ ไม่มีเอกสารในทะเบียนภาษีรองรับ
  const period = periodOf(asOf);
  const start = period + '-01', end = endOfMonth(start);
  const notFiling = (e) => e.src !== 'filing' && e.type !== 'opening';

  const vatOutReport = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === period)
    .reduce((s, t) => s + t.tax, 0);
  const vatOutGl = -balBySub(['output_vat'], end, start, notFiling);
  checks.push({ code:'OUTPUT_VAT', label:'ภาษีขายในทะเบียน = ที่ลงบัญชีจากเอกสาร (งวดนี้)',
    control:vatOutGl, sub:vatOutReport, ok:vatOutGl === vatOutReport });

  const vatInReport = DB.taxTx.filter((t) => t.kind === 'vat_input' && t.period === period)
    .reduce((s, t) => s + t.tax, 0);
  const vatInGl = balBySub(['input_vat'], end, start, notFiling);
  checks.push({ code:'INPUT_VAT', label:'ภาษีซื้อในทะเบียน = ที่ลงบัญชีจากเอกสาร (งวดนี้)',
    control:vatInGl, sub:vatInReport, ok:vatInGl === vatInReport });

  const suspense = balBySub(['suspense'], asOf);
  checks.push({ code:'SUSPENSE_ZERO', label:'บัญชีพักต้องเป็นศูนย์ก่อนปิดงวด', control:suspense, sub:0, ok:suspense === 0 });

  const bs = balanceSheet(asOf);
  checks.push({ code:'BS_BALANCED', label:'รวมสินทรัพย์ = รวมหนี้สินและส่วนของผู้ถือหุ้น', control:bs.assets, sub:bs.liabEquity, ok:bs.diff === 0 });

  return { checks, allPassed: checks.every((c) => c.ok) };
}
