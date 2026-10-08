/* ===================================================================
   ชั้นแสดงผล — DOM ล้วน ไม่มี framework เพื่อให้เป็นไฟล์เดียวจบ
   =================================================================== */

const STATE = {
  screen: 'dashboard',
  period: '2026-07',
  sel: null,          // เอกสารที่เลือกดูรายละเอียด
  filter: '',
  drill: null,        // บัญชีที่กำลังเจาะดู
  dashView: 'chart',  // แดชบอร์ด: กราฟ หรือ ตาราง
  navOpen: {},        // หมวดย่อยในเมนูที่กางอยู่
  navGroupOpen: {},   // กลุ่มเมนูที่ผู้ใช้กางหรือยุบเอง (ไม่ตั้ง = กางเฉพาะกลุ่มของหน้าที่เปิดอยู่)
  imp: null,          // สถานะการนำเข้าไฟล์
  impResult: null,
};
const TODAY = '2026-07-31';

const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

/* ---------- ส่วนประกอบ ---------- */
function money(v, cls) {
  const c = v < 0 ? ' neg' : '';
  return '<td class="num' + c + (cls ? ' ' + cls : '') + '">' + (v === 0 ? '—' : fmt(v)) + '</td>';
}
function cell(c) {
  if (c === null || c === undefined) return '<td></td>';
  if (typeof c === 'object') {
    if ('n' in c) return money(c.n, c.cls);
    if ('mono' in c) return '<td class="mono">' + esc(c.mono) + '</td>';
    if ('dim' in c) return '<td class="dim">' + esc(c.dim) + '</td>';
    if ('st' in c) return '<td><span class="st ' + c.st[0] + '">' + esc(c.st[1]) + '</span></td>';
    if ('html' in c) return '<td>' + c.html + '</td>';
    if ('c' in c) return '<td class="ctr">' + esc(c.c) + '</td>';
  }
  return '<td>' + esc(c) + '</td>';
}
function tbl(o) {
  if (!o.rows.length) {
    return '<div class="empty">' + esc(o.empty || 'ยังไม่มีข้อมูลในมุมมองนี้')
      + (o.emptyAction ? '<div style="margin-top:12px">' + o.emptyAction + '</div>' : '') + '</div>';
  }
  let h = '<div class="scroll"><table><thead><tr>';
  o.cols.forEach((c) => { h += '<th class="' + (c.a || 'l') + '">' + esc(c.t) + '</th>'; });
  h += '</tr></thead><tbody>';
  o.rows.forEach(function (r, i) {
    const attrs = o.rowAttr ? o.rowAttr(r, i) : '';
    h += '<tr ' + attrs + '>' + (o.render ? o.render(r, i) : r.map(cell).join('')) + '</tr>';
  });
  h += '</tbody>';
  if (o.foot) h += '<tfoot><tr>' + o.foot.map(cell).join('') + '</tr></tfoot>';
  return h + '</table></div>';
}
function card(o) {
  /* การ์ดที่มีตาราง ส่งออกเป็นไฟล์เปิดใน Excel ได้ทุกใบ — นักบัญชีต้องเอาตัวเลขไปทำต่อเสมอ */
  const exp = !o.noExport && /<table/.test(o.body || '')
    ? '<button class="ghost" data-act="csv" title="ส่งออกตารางเป็นไฟล์ CSV (เปิดใน Excel ได้)" aria-label="ส่งออกเป็น Excel">'
      + icon('download') + '</button>'
    : '';
  return '<section class="card">'
    + '<div class="card-h"><div><h2>' + esc(o.title) + '</h2>'
    + (o.sub ? '<div class="card-sub">' + esc(o.sub) + '</div>' : '') + '</div>'
    + '<span class="grow"></span><div class="card-acts">' + (o.actions || '') + exp + '</div></div>'
    + (o.filters ? '<div class="filters">' + o.filters + '</div>' : '')
    + o.body
    + (o.foot ? '<div class="card-f">' + o.foot + '</div>' : '')
    + '</section>';
}
const btn  = (act, label, kind, extra) =>
  '<button class="btn' + (kind ? ' ' + kind : '') + '" data-act="' + act + '"' + (extra || '') + '>' + esc(label) + '</button>';
/** ปุ่มที่มีไอคอนนำหน้า */
const btnI = (act, ic, label, kind, extra) =>
  '<button class="btn' + (kind ? ' ' + kind : '') + '" data-act="' + act + '"' + (extra || '') + '>' + icon(ic) + esc(label) + '</button>';
const printBtn = (kind, no) => btnI('printdoc:' + kind + ':' + no, 'printer', 'พิมพ์');

/* ---------- เอกสารที่ยกเลิก ----------
   เลขที่ยังอยู่และเห็นได้ทุกที่ แต่ตัวเลขไม่ถูกนับในยอดรวมของตาราง
   ยอดรวมที่นับเอกสารยกเลิกเข้าไปด้วยจะไม่ตรงกับบัญชีแยกประเภท */
const isVoid = (d) => !!d && d.status === 'void';
const liveOnly = (rows) => rows.filter((d) => !isVoid(d));
const voidBtn = (kind, d) => (d && !isVoid(d)) ? btn('void:' + kind + ':' + d.no, 'ยกเลิกเอกสาร', 'danger') : '';
/** class ของแถว: กดได้ และจางลงพร้อมขีดฆ่าตัวเลขถ้ายกเลิกแล้ว */
const rowCls = (d, extra) => 'class="row-link' + (isVoid(d) ? ' is-void' : '') + (extra ? ' ' + extra : '') + '"';
/** "12 ฉบับ · ยกเลิก 1" — บอกให้รู้ว่ามีใบที่ยกเลิกอยู่ในรายการ */
function countNote(rows, unit) {
  const v = rows.filter(isVoid).length;
  return (rows.length - v) + ' ' + unit + (v ? ' · ยกเลิก ' + v : '');
}
function voidBanner(d) {
  if (!isVoid(d)) return '';
  return '<div class="void-banner"><b>ยกเลิกแล้ว</b>'
    + (d.voidedAt ? '<span>เมื่อ ' + thDate(String(d.voidedAt).slice(0, 10)) + '</span>' : '')
    + '<span>เหตุผล: ' + esc(d.voidReason || '—') + '</span></div>';
}
const chip = (act, label, on) =>
  '<button class="chip' + (on ? ' on' : '') + '"' + (act ? ' data-act="' + act + '"' : '') + '>' + esc(label) + '</button>';

function statusPill(s) {
  const map = {
    issued:['open','ลงบัญชีแล้ว'], paid:['paid','ชำระแล้ว'], partially_paid:['wait','ชำระบางส่วน'],
    draft:['draft','ฉบับร่าง'], void:['void','ยกเลิก'], posted:['paid','ลงบัญชีแล้ว'],
    reversed:['late','กลับรายการ'], open:['open','เปิดอยู่'], closed:['paid','ปิดแล้ว'],
    approved:['paid','อนุมัติแล้ว'], rejected:['late','ถูกปฏิเสธ'], expired:['late','หมดอายุ'],
    cancelled:['late','ยกเลิก'], received:['open','รับเข้าคลังแล้ว'],
    pending_approval:['wait','รออนุมัติ'],
  };
  const m = map[s] || ['draft', s];
  return { st: m };
}

/* ---------- แจ้งเตือน ---------- */
let toastTimer = null;
function toast(msg, kind, detail) {
  const el = document.getElementById('toast');
  el.className = 'toast show ' + (kind || 'ok');
  el.innerHTML = '<b>' + esc(msg) + '</b>' + (detail ? '<div>' + esc(detail) + '</div>' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, kind === 'err' ? 7000 : 4000);
}
function runAction(fn) {
  try {
    const r = fn();
    save();
    render();
    return r;
  } catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    return null;
  }
}

/* ---------- กล่องโต้ตอบ ---------- */
let modalSubmit = null;
function modal(o) {
  const m = document.getElementById('modal');
  m.innerHTML = '<div class="modal-box" role="dialog" aria-modal="true">'
    + '<div class="modal-h"><h3>' + esc(o.title) + '</h3>'
    + (o.sub ? '<div class="card-sub">' + esc(o.sub) + '</div>' : '')
    + '<span class="grow"></span>'
    + '<button class="icon-btn" data-act="modal:close" aria-label="ปิด">✕</button></div>'
    + '<div class="modal-b">' + o.body + '</div>'
    + '<div class="modal-f">' + (o.note ? '<span class="dim">' + esc(o.note) + '</span>' : '')
    + '<span class="grow"></span>'
    + btn('modal:close', o.cancelLabel || 'ยกเลิก')
    + (o.submitLabel ? btn('modal:submit', o.submitLabel, o.submitKind || 'primary') : '')
    + '</div></div>';
  m.classList.add('show');
  modalSubmit = o.onSubmit || null;
  /* โฟกัสช่องแรกให้ แต่ห้ามแย่งโฟกัสถ้าผู้ใช้กดเข้าช่องอื่นไปแล้ว
     ของเดิมหน่วง 30 มิลลิวินาทีแล้วโฟกัสทันที ใครพิมพ์เร็วกว่านั้นตัวอักษร
     จะเด้งไปลงช่องแรกแทนช่องที่กดอยู่ */
  const first = m.querySelector('input,select,textarea');
  if (first) {
    requestAnimationFrame(function () {
      if (!m.contains(document.activeElement)) first.focus();
    });
  }
}
function closeModal() {
  document.getElementById('modal').classList.remove('show');
  document.getElementById('modal').innerHTML = '';
  modalSubmit = null;
}
const val = (n) => { const e = document.querySelector('[name="' + n + '"]'); return e ? e.value : ''; };
const field = (o) =>
  '<div class="fld-w' + (o.wide ? ' wide' : '') + '"><label for="f_' + o.name + '">' + esc(o.label) + '</label>'
  + (o.type === 'select'
      ? '<select id="f_' + o.name + '" name="' + o.name + '">'
        + o.options.map((op) => '<option value="' + esc(op[0]) + '"' + (op[0] === o.value ? ' selected' : '') + '>'
          + esc(op[1]) + '</option>').join('') + '</select>'
      : '<input id="f_' + o.name + '" name="' + o.name + '" type="' + (o.type || 'text') + '"'
        + ' value="' + esc(o.value === undefined ? '' : o.value) + '"'
        + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '')
        + (o.readonly ? ' readonly' : '') + (o.cls ? ' class="' + o.cls + '"' : '') + '>')
  + (o.hint ? '<div class="fld-hint">' + esc(o.hint) + '</div>' : '') + '</div>';

/* ---------- เก็บข้อมูลไว้ในเครื่อง — หนึ่งบริษัทหนึ่งสมุด ---------- */
const LS_OLD = 'duly.demo.v1';                 // รูปแบบเดิมสมัยรองรับบริษัทเดียว
const LS_BOOKS = 'financii.books';
const LS_ACTIVE = 'financii.activeBook';
const bookKey = (id) => 'financii.book.' + id;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

function booksList() {
  try { return JSON.parse(lsGet(LS_BOOKS) || '[]'); } catch (e) { return []; }
}
function booksWrite(list) { lsSet(LS_BOOKS, JSON.stringify(list)); }

/**
 * ย้ายข้อมูลที่เก็บไว้ใต้ชื่อเดิม (duly.*) มาไว้ใต้ชื่อใหม่ (financii.*)
 * ทำครั้งเดียวตอนเปิดครั้งแรกหลังเปลี่ยนชื่อ ไม่ลบของเดิมทิ้งจนกว่าจะคัดลอกสำเร็จ
 */
function booksRebrand() {
  if (lsGet(LS_BOOKS)) return;
  const oldBooks = lsGet('duly.books');
  if (!oldBooks) return;
  let moved = 0;
  try {
    JSON.parse(oldBooks).forEach(function (b) {
      const data = lsGet('duly.book.' + b.id);
      if (data && lsSet(bookKey(b.id), data)) moved++;
    });
    if (!lsSet(LS_BOOKS, oldBooks)) return;
    const act = lsGet('duly.activeBook');
    if (act) lsSet(LS_ACTIVE, act);
    JSON.parse(oldBooks).forEach(function (b) { lsDel('duly.book.' + b.id); });
    lsDel('duly.books');
    lsDel('duly.activeBook');
  } catch (e) { /* ย้ายไม่สำเร็จก็ปล่อยของเดิมไว้ ดีกว่าทำหาย */ }
  return moved;
}

/** ย้ายข้อมูลรูปแบบเดิมมาเป็นสมุดแรก ผู้ใช้เดิมต้องไม่เสียข้อมูล */
function booksMigrate() {
  if (booksList().length) return;
  const old = lsGet(LS_OLD);
  if (!old) return;
  try {
    const d = JSON.parse(old);
    if (!d || !d.DB || !d.DB.company) return;
    lsSet(bookKey('default'), old);
    booksWrite([{ id: 'default', name: d.DB.company.name, taxId: d.DB.company.taxId || null }]);
    lsSet(LS_ACTIVE, 'default');
    lsDel(LS_OLD);
  } catch (e) { /* อ่านไม่ออกก็ปล่อยไว้ ไม่ลบของเดิมทิ้ง */ }
}

function booksSaveActive() {
  if (SYNC.mode === 'server') return;
  lsSet(bookKey(SYNC.book), JSON.stringify({ DB, STATE: { period: STATE.period } }));
  const list = booksList();
  const at = list.findIndex((b) => b.id === SYNC.book);
  const meta = { id: SYNC.book, name: DB.company ? DB.company.name : SYNC.book,
    taxId: DB.company ? DB.company.taxId : null, entries: DB.entries.length };
  if (at >= 0) list[at] = meta; else list.push(meta);
  booksWrite(list);
  lsSet(LS_ACTIVE, SYNC.book);
  SYNC.books = list.map((b) => ({ book: b.id, name: b.name, taxId: b.taxId, entries: b.entries || 0 }));
}

function booksLoadLocal(id) {
  const raw = lsGet(bookKey(id));
  if (!raw) { loadState(null); return false; }
  try {
    const d = JSON.parse(raw);
    const ok = loadState(d && d.DB);
    if (ok && d.STATE && d.STATE.period) STATE.period = d.STATE.period;
    lsSet(LS_ACTIVE, id);
    return ok;
  } catch (e) { loadState(null); return false; }
}

function save() {
  if (SYNC.mode === 'server') { syncSave(); return; }
  booksSaveActive();
}
function load() {
  booksRebrand();
  booksMigrate();
  const list = booksList();
  SYNC.books = list.map((b) => ({ book: b.id, name: b.name, taxId: b.taxId, entries: b.entries || 0 }));
  if (!list.length) return false;
  const active = lsGet(LS_ACTIVE);
  const id = list.some((b) => b.id === active) ? active : list[0].id;
  SYNC.book = id;
  return booksLoadLocal(id);
}
function resetAll() {
  if (SYNC.mode === 'server') {
    buildSeed();
    syncPush().then(() => location.reload());
    return;
  }
  buildSeed();
  booksSaveActive();
  location.reload();
}

/** เพิ่มบริษัทใหม่ — สมุดใหม่ที่ไม่แตะข้อมูลของบริษัทอื่นเลย */
function booksNewId(name) {
  const base = 'co-' + String(name || '').replace(/[^A-Za-z0-9]+/g, '').slice(0, 12).toLowerCase();
  const taken = new Set((SYNC.books || []).map((b) => b.book));
  let id = base.length > 3 ? base : 'co';
  let n = 1;
  while (taken.has(id)) { id = (base.length > 3 ? base : 'co') + '-' + (++n); }
  return id;
}

/* ---------- ไอคอนเส้น 1.6px ชุดเดียวทั้งระบบ — วาดเอง ไม่พึ่งไลบรารีภายนอก ---------- */
const ICON_PATHS = {
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  sale: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  buy: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3.5h2.6l2.3 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2L20.8 7H6"/>',
  receipt: '<path d="M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5 10.5v7.5M9.7 10.5v7.5M14.3 10.5v7.5M19 10.5v7.5"/><path d="M3 20.5h18"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v14.5H6.5A2.5 2.5 0 0 0 4 20z"/><path d="M4 20a1 1 0 0 0 1 1h15v-3.5"/><path d="M8.5 7.5h7"/>',
  tax: '<path d="M18.5 5.5 5.5 18.5"/><circle cx="7.5" cy="7.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5"/><path d="M12 13v8"/>',
  asset: '<path d="M4 21V5.5A1.5 1.5 0 0 1 5.5 4h7A1.5 1.5 0 0 1 14 5.5V21"/><path d="M14 10h4.5a1.5 1.5 0 0 1 1.5 1.5V21"/><path d="M2.5 21h19"/><path d="M7.5 8h3M7.5 12h3M7.5 16h3"/>',
  payroll: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8"/><path d="M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  contact: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0"/><path d="M15 9.5h3.5M15 13h3.5"/>',
  chart: '<path d="M3.5 3.5v17h17"/><path d="M8 16v-3M12 16V9M16 16v-5M20 16V6"/>',
  gear: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  printer: '<path d="M6.5 9V3.5h11V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6.5 14h11v6.5h-11z"/>',
  download: '<path d="M12 3.5v11"/><path d="m7.5 10 4.5 4.5 4.5-4.5"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.5 2.5L16 9.5"/>',
  bolt: '<path d="M13 2.5 4.5 13.5H11L10 21.5l8.5-11H12z"/>',
};
function icon(name, cls) {
  return '<svg class="i' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true">'
    + (ICON_PATHS[name] || '') + '</svg>';
}

/* ---------- โหมดสว่าง/มืด — ไม่ตั้ง = ตามเครื่อง · ตั้งแล้วจำไว้ในเครื่องนี้ ---------- */
const THEME_KEY = 'financii.theme';
function themeNow() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t) return t;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function applyTheme(t) {
  if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t);
  else document.documentElement.removeAttribute('data-theme');
}
function toggleTheme() {
  const next = themeNow() === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  lsSet(THEME_KEY, next);
  render();
}

/* ---------- เมนู ----------
   จัดตามแบบแผนบัญชี: งานประจำวัน (วงจรรายได้ วงจรรายจ่าย เงินสด) → บัญชีและภาษี
   → ทะเบียนย่อย → รายงานและระบบ · แต่ละรายการ [หน้าจอ, ชื่อ, ตัวเลขเตือน] */
function navGroups() {
  const overdue = DB.docs.invoice.filter((d) =>
    (d.status === 'issued' || d.status === 'partially_paid') && d.due < TODAY).length;
  const unmatched = DB.bankTxns.filter((t) => !t.matched).length;
  const chk = closeChecklist(STATE.period);
  const todo = chk.items.filter((i) => !i.ok).length;
  const stillOpen = (k) => (DB.docs[k] || []).filter((d) => tradeDocStatus(k, d) === 'issued').length;
  const quoteOpen = stillOpen('quotation');
  const soOpen = stillOpen('salesOrder');
  const poOpen = stillOpen('purchaseOrder');
  const bnOpen = DB.docs.billingNote.filter((b) => ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0).length;
  const grnWaiting = DB.docs.goodsReceipt.filter((g) => g.status === 'received').length;
  const pbWaiting = DB.docs.paymentBatch.filter(paymentBatchActive).length;
  return [
    { g: 'ภาพรวม', flat: true, icon: 'grid', items: [
      ['dashboard', 'แดชบอร์ด', todo || null, 'grid'],
      ['close', 'ปิดงวดบัญชี', null, 'lock'],
    ]},
    /* วงจรรายได้ — เรียงตามลำดับที่เอกสารเกิดจริง เสนอราคา → สั่งขาย → ใบกำกับ → วางบิล → ใบเสร็จ
       ปลายกลุ่มคือใบที่ออกตามหลังเพื่อแก้ยอด (ลดหนี้ ม.86/10 · เพิ่มหนี้ ม.86/9) */
    { sec: 'งานประจำวัน', g: 'เอกสารขาย', icon: 'sale', items: [
      ['quotations', 'ใบเสนอราคา', quoteOpen || null],
      ['salesorders', 'ใบสั่งขาย', soOpen || null],
      ['invoices', 'ใบกำกับภาษี', null],
      ['billingnotes', 'ใบวางบิล', bnOpen || null],
      ['receipts', 'ใบเสร็จรับเงิน', null],
      ['creditnotes', 'ใบลดหนี้', null],
      ['debitnotes', 'ใบเพิ่มหนี้', null],
    ]},
    /* วงจรรายจ่าย — ใบสั่งซื้อ → ใบรับสินค้า (ของเข้าคลัง) → ตั้งหนี้ (ใบกำกับมาถึง) → จ่าย */
    { g: 'เอกสารซื้อ', icon: 'buy', items: [
      ['purchaseorders', 'ใบสั่งซื้อ', poOpen || null],
      ['goodsreceipts', 'ใบรับสินค้า', grnWaiting || null],
      ['bills', 'ตั้งหนี้ผู้ขาย', null],
      ['payments', 'ใบสำคัญจ่าย', null],
    ]},
    /* ค่าใช้จ่ายที่มีหัก ณ ที่จ่าย ออก 50 ทวิ ให้เองในแถบหัก ณ ที่จ่าย — สองแถบนี้ผูกกัน */
    { g: 'ค่าใช้จ่าย', icon: 'receipt', items: [
      ['expenses', 'ค่าใช้จ่าย', null],
      ['whtcert', 'หัก ณ ที่จ่าย', null],
      ['paymentprep', 'เตรียมจ่ายเงิน', pbWaiting || null],
    ]},
    { g: 'ธนาคาร', icon: 'bank', items: [
      ['bank', 'กระทบยอดธนาคาร', unmatched || null],
      ['cashflow', 'งบกระแสเงินสด', null],
    ]},
    /* สมุดรายวันเฉพาะ 5 เล่ม เรียงตามที่นักบัญชีใช้ บันทึกรายการด้วยมือได้ทุกเล่ม */
    { sec: 'บัญชีและภาษี', g: 'บัญชี', icon: 'book', items: [
      ['jgeneral', 'สมุดรายวันทั่วไป', null],
      ['jpurchase', 'สมุดรายวันซื้อ', null],
      ['jsales', 'สมุดรายวันขาย', null],
      ['jpayment', 'สมุดรายวันจ่าย', null],
      ['jreceipt', 'สมุดรายวันรับ', null],
      ['coa', 'ผังบัญชี', null],
    ]},
    { g: 'ยื่นแบบภาษี', icon: 'tax', items: [
      ['pp30', 'แบบ ภ.พ.30', null],
      ['pnd', 'ภ.ง.ด.1 / 3 / 53', null],
      ['taxcal', 'ปฏิทินภาษี', null],
    ]},
    { sec: 'ทะเบียน', g: 'ผู้ติดต่อ', icon: 'contact', items: [
      ['customers', 'ลูกค้า', null],
      ['vendors', 'ผู้ขาย', null],
    ]},
    { g: 'สินค้า', icon: 'box', items: [
      ['items', 'ทะเบียนสินค้า', null],
      ['stockmoves', 'ความเคลื่อนไหวสต๊อก', null],
    ]},
    { g: 'สินทรัพย์', icon: 'asset', items: [
      ['assets', 'ทะเบียนทรัพย์สิน', null],
      ['deprec', 'ค่าเสื่อมราคา', null],
    ]},
    { g: 'เงินเดือน', icon: 'payroll', items: [
      ['payroll', 'งวดจ่ายเงินเดือน', null],
      ['employees', 'ทะเบียนพนักงาน', null],
    ]},
    /* รายงานทั้งหมดรวมไว้ที่เดียว แยกหมวดย่อยแบบเดียวกับที่นักบัญชีคุ้นเคย */
    { sec: 'รายงานและระบบ', g: 'รายงาน', icon: 'chart', subs: [
      { s: 'งบการเงิน', items: [
        ['bs', 'งบแสดงฐานะการเงิน', null],
        ['pl', 'งบกำไรขาดทุน', null],
        ['equity', 'งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น', null],
      ]},
      { s: 'สมุดบัญชี', items: [
        ['journals', 'สมุดรายวันรวมทุกเล่ม', null],
        ['ledger', 'บัญชีแยกประเภท', null],
        ['tb', 'งบทดลอง', null],
      ]},
      { s: 'ลูกหนี้', items: [
        ['ar', 'อายุลูกหนี้', overdue || null],
      ]},
      { s: 'เจ้าหนี้', items: [
        ['ap', 'อายุเจ้าหนี้', null],
      ]},
      { s: 'ภาษี', items: [
        ['vatout', 'รายงานภาษีขาย', null],
        ['vatin', 'รายงานภาษีซื้อ', null],
      ]},
      { s: 'โครงการและงบประมาณ', items: [
        ['projects', 'โครงการ', null],
        ['budget', 'งบประมาณเทียบใช้จริง', null],
      ]},
    ]},
    { g: 'ระบบ', icon: 'gear', items: [
      ['settings', 'ข้อมูลกิจการ', null],
      ['import', 'นำเข้าข้อมูลจากระบบเดิม', null],
      ['audit', 'ร่องรอยการตรวจสอบ', null],
      ['about', 'เกี่ยวกับระบบนี้', null],
    ]},
  ];
}

/** รายชื่อหน้าจอทั้งหมด ไม่ว่าจะอยู่ในหมวดย่อยชั้นไหน */
function navScreens() {
  const out = [];
  navGroups().forEach(function (g) {
    (g.items || []).forEach((i) => out.push(i[0]));
    (g.subs || []).forEach((s) => s.items.forEach((i) => out.push(i[0])));
  });
  return out;
}

/** ตำแหน่งของหน้าจอในเมนู — ใช้ทำเส้นทาง (กลุ่ม › หมวดย่อย › หน้า) และกางกลุ่มให้เอง */
function navWhere(screen) {
  let found = null;
  navGroups().forEach(function (g) {
    (g.items || []).forEach(function (i) { if (i[0] === screen) found = { g: g, sub: null, item: i }; });
    (g.subs || []).forEach(function (s) {
      s.items.forEach(function (i) { if (i[0] === screen) found = { g: g, sub: s, item: i }; });
    });
  });
  return found;
}
/** หมวดย่อยที่มีหน้าจอปัจจุบันอยู่ ต้องกางไว้เสมอ ผู้ใช้จะได้เห็นว่าตัวเองอยู่ตรงไหน */
function navSubOf(screen) {
  const w = navWhere(screen);
  return w && w.sub ? w.sub.s : null;
}
function navGroupIsOpen(g) {
  if (STATE.navGroupOpen[g.g] !== undefined) return STATE.navGroupOpen[g.g];
  const w = navWhere(STATE.screen);
  return !!(w && w.g.g === g.g);
}

/* ---------- โครงหน้าจอ ---------- */
function renderNav() {
  const groups = navGroups();
  const openSub = navSubOf(STATE.screen);
  const where = navWhere(STATE.screen);
  const badge = (n) => (n ? '<span class="badge">' + n + '</span>' : '');
  const item = (it, cls) => '<a href="#" class="nav-i ' + cls + (STATE.screen === it[0] ? ' on' : '')
    + '" data-act="go:' + it[0] + '"' + (STATE.screen === it[0] ? ' aria-current="page"' : '') + '>'
    + (cls === 'flat' ? icon(it[3] || 'file') : '') + '<span>' + esc(it[1]) + '</span>' + badge(it[2]) + '</a>';
  let nav = '';
  groups.forEach(function (g) {
    if (g.sec) nav += '<div class="nav-sec">' + esc(g.sec) + '</div>';
    if (g.flat) { g.items.forEach(function (it) { nav += item(it, 'flat'); }); return; }
    const open = navGroupIsOpen(g);
    const sum = (g.items || []).reduce((n, i) => n + (i[2] || 0), 0)
      + (g.subs || []).reduce((n, s) => n + s.items.reduce((m, i) => m + (i[2] || 0), 0), 0);
    nav += '<button class="nav-gh' + (open ? ' open' : '') + (where && where.g.g === g.g ? ' has-on' : '')
      + '" data-act="navg:' + esc(g.g) + '" aria-expanded="' + (open ? 'true' : 'false') + '">'
      + icon(g.icon) + '<span>' + esc(g.g) + '</span>' + (open ? '' : badge(sum)) + icon('chev', 'chev') + '</button>';
    if (!open) return;
    (g.items || []).forEach(function (it) { nav += item(it, 'child'); });
    (g.subs || []).forEach(function (s) {
      const sOpen = STATE.navOpen[s.s] === undefined ? s.s === openSub : STATE.navOpen[s.s];
      nav += '<button class="nav-s' + (sOpen ? ' open' : '') + '" data-act="nav:' + esc(s.s) + '"'
        + ' aria-expanded="' + (sOpen ? 'true' : 'false') + '">'
        + '<span class="chev" aria-hidden="true">›</span>' + esc(s.s)
        + (!sOpen && s.items.some((i) => i[2]) ? badge(s.items.reduce((n, i) => n + (i[2] || 0), 0)) : '')
        + '</button>';
      if (sOpen) s.items.forEach(function (it) { nav += item(it, 'sub'); });
    });
  });
  document.getElementById('nav').innerHTML = nav;
}

/** เส้นทางบนแถบบน: กลุ่ม › หมวดย่อย › หน้า */
function renderCrumb() {
  const w = navWhere(STATE.screen);
  const sep = '<span class="sep">/</span>';
  const extra = { importResult: ['ระบบ', 'ผลการนำเข้า'] }[STATE.screen];
  let h = '';
  if (w) {
    if (!w.g.flat) h += '<span class="grp">' + esc(w.g.g) + '</span>' + sep;
    if (w.sub) h += '<span class="grp">' + esc(w.sub.s) + '</span>' + sep;
    h += '<b>' + esc(w.item[1]) + '</b>';
  } else if (extra) {
    h = '<span class="grp">' + esc(extra[0]) + '</span>' + sep + '<b>' + esc(extra[1]) + '</b>';
  }
  document.getElementById('crumb').innerHTML = h;
}

function renderTopTools() {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
  document.getElementById('cmdBtn').innerHTML = icon('search')
    + '<span>ค้นหาเอกสาร ลูกค้า บัญชี หรือคำสั่ง…</span><kbd>' + (mac ? '⌘K' : 'Ctrl K') + '</kbd>';
  document.getElementById('newBtn').innerHTML = icon('plus') + '<span class="lbl">สร้างเอกสาร</span>';
  const dark = themeNow() === 'dark';
  const tb = document.getElementById('themeBtn');
  tb.innerHTML = icon(dark ? 'sun' : 'moon');
  tb.title = dark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
  const pw = document.getElementById('periodWrap');
  if (pw && !pw.querySelector('svg')) pw.insertAdjacentHTML('afterbegin', icon('calendar'));
}

function render() {
  /* ★ ตอนที่ยังใส่รหัสผ่านไม่ผ่าน ยังไม่มีข้อมูลบริษัทให้วาดแถบบนและเมนู
     ต้องออกก่อนแตะ DB.company ไม่งั้นหน้าจอขาวทั้งหน้า */
  if (SYNC.status === 'locked') {
    document.getElementById('nav').innerHTML = '';
    document.getElementById('coName').innerHTML = '';
    document.getElementById('periodSel').innerHTML = '';
    document.getElementById('crumb').innerHTML = '';
    document.getElementById('main').innerHTML = syncPasscodeScreen(STATE.passWrong);
    const f = document.querySelector('[name="passcode"]');
    if (f) f.focus();
    return;
  }
  renderNav();
  renderCrumb();
  renderTopTools();

  const periods = DB.periods.map((p) =>
    '<option value="' + p.code + '"' + (p.code === STATE.period ? ' selected' : '') + '>'
    + thPeriod(p.code) + (p.status !== 'open' ? ' (ปิดแล้ว)' : '') + '</option>').join('');
  document.getElementById('periodSel').innerHTML = periods;

  const books = SYNC.books || [];
  const co = DB.company;
  document.getElementById('coName').innerHTML =
    '<div class="co-row"><span class="co-ava" aria-hidden="true">' + esc(String(co.name || '?')
      .replace(/^(บริษัท|ห้างหุ้นส่วนจำกัด|หจก\.|บจก\.)\s*/, '').charAt(0) || '?') + '</span>'
    + '<div class="co-txt">'
    + (books.length > 1
      ? '<select id="bookSel" class="book-sel" aria-label="เลือกบริษัท">'
        + books.map((b) => '<option value="' + esc(b.book) + '"'
            + (b.book === SYNC.book ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('')
        + '</select>'
      : '<span class="co-name">' + esc(co.name) + '</span>')
    + '<span class="co-meta">' + esc(co.taxId ? 'เลขผู้เสียภาษี ' + co.taxId : 'ยังไม่ได้กรอกเลขผู้เสียภาษี') + '</span>'
    + '</div></div>'
    + '<div class="co-acts"><button class="add-co" data-act="company:new" title="เพิ่มบริษัท">+ บริษัท</button>'
    + (DB.isDemo
        ? '<button class="demo-tag" data-act="go:import" title="ข้อมูลชุดนี้ระบบสร้างขึ้นเพื่อให้ลองใช้">'
          + 'ข้อมูลตัวอย่าง · เริ่มใช้ของจริง</button>'
        : '')
    + '</div>';

  const fn = SCREENS[STATE.screen] || SCREENS.dashboard;
  let html;
  try { html = pageContext(STATE.screen) + fn(); }
  catch (e) {
    console.error(e);
    html = card({ title:'เปิดหน้านี้ไม่ได้', body:'<div class="empty">' + esc(e.message) + '</div>' });
  }
  const main = document.getElementById('main');
  main.innerHTML = html;
  /* เลื่อนขึ้นบนสุดเฉพาะตอนเปลี่ยนหน้าหรือเปิดเอกสารใบใหม่ (รายละเอียดอยู่บนสุดของหน้า)
     ถ้าเลื่อนทุกครั้งที่วาดใหม่ แค่พิมพ์ในช่องค้นหาหน้าก็จะกระโดดขึ้นไปบนสุด */
  const spot = STATE.screen + '|' + (STATE.sel || '');
  if (spot !== render.lastSpot) window.scrollTo(0, 0);
  render.lastSpot = spot;
}
