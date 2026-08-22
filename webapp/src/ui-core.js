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
  return '<section class="card">'
    + '<div class="card-h"><div><h2>' + esc(o.title) + '</h2>'
    + (o.sub ? '<div class="card-sub">' + esc(o.sub) + '</div>' : '') + '</div>'
    + '<span class="grow"></span>' + (o.actions || '') + '</div>'
    + (o.filters ? '<div class="filters">' + o.filters + '</div>' : '')
    + o.body
    + (o.foot ? '<div class="card-f">' + o.foot + '</div>' : '')
    + '</section>';
}
const btn  = (act, label, kind, extra) =>
  '<button class="btn' + (kind ? ' ' + kind : '') + '" data-act="' + act + '"' + (extra || '') + '>' + esc(label) + '</button>';
const chip = (act, label, on) =>
  '<button class="chip' + (on ? ' on' : '') + '"' + (act ? ' data-act="' + act + '"' : '') + '>' + esc(label) + '</button>';

function statusPill(s) {
  const map = {
    issued:['open','ลงบัญชีแล้ว'], paid:['paid','ชำระแล้ว'], partially_paid:['wait','ชำระบางส่วน'],
    draft:['draft','ฉบับร่าง'], void:['late','ยกเลิก'], posted:['paid','ลงบัญชีแล้ว'],
    reversed:['late','กลับรายการ'], open:['open','เปิดอยู่'], closed:['paid','ปิดแล้ว'],
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
    + (o.submitLabel ? btn('modal:submit', o.submitLabel, 'primary') : '')
    + '</div></div>';
  m.classList.add('show');
  modalSubmit = o.onSubmit || null;
  const first = m.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 30);
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

/* ---------- เมนู ---------- */
function navGroups() {
  const overdue = DB.docs.invoice.filter((d) =>
    (d.status === 'issued' || d.status === 'partially_paid') && d.due < TODAY).length;
  const unmatched = DB.bankTxns.filter((t) => !t.matched).length;
  const chk = closeChecklist(STATE.period);
  const todo = chk.items.filter((i) => !i.ok).length;
  return [
    { g: 'ภาพรวม', items: [
      ['dashboard', 'แดชบอร์ด', todo || null],
      ['close', 'ปิดงวดบัญชี', null],
    ]},
    { g: 'เอกสารขาย', items: [
      ['invoices', 'ใบกำกับภาษี', null],
      ['receipts', 'ใบเสร็จรับเงิน', null],
      ['creditnotes', 'ใบลดหนี้', null],
    ]},
    { g: 'เอกสารซื้อ', items: [
      ['bills', 'ตั้งหนี้ผู้ขาย', null],
      ['payments', 'ใบสำคัญจ่าย', null],
    ]},
    { g: 'ผู้ติดต่อ', items: [
      ['customers', 'ลูกค้า', null],
      ['vendors', 'ผู้ขาย', null],
    ]},
    { g: 'สินค้า', items: [
      ['items', 'ทะเบียนสินค้า', null],
      ['stockmoves', 'ความเคลื่อนไหวสต๊อก', null],
    ]},
    { g: 'สินทรัพย์', items: [
      ['assets', 'ทะเบียนทรัพย์สิน', null],
      ['deprec', 'ค่าเสื่อมราคา', null],
    ]},
    { g: 'เงินเดือน', items: [
      ['payroll', 'งวดจ่ายเงินเดือน', null],
      ['employees', 'ทะเบียนพนักงาน', null],
    ]},
    { g: 'ธนาคาร', items: [
      ['bank', 'กระทบยอดธนาคาร', unmatched || null],
    ]},
    { g: 'ยื่นแบบภาษี', items: [
      ['pp30', 'แบบ ภ.พ.30', null],
      ['pnd', 'ภ.ง.ด.1 / 3 / 53', null],
      ['whtcert', 'หนังสือรับรอง 50 ทวิ', null],
      ['taxcal', 'ปฏิทินภาษี', null],
    ]},
    /* รายงานทั้งหมดรวมไว้ที่เดียว แยกหมวดย่อยแบบเดียวกับที่นักบัญชีคุ้นเคย
       เดิมกระจายอยู่ใน 6 กลุ่ม ต้องจำว่ารายงานไหนอยู่ใต้หัวข้ออะไร */
    { g: 'รายงาน', subs: [
      { s: 'ขาย', items: [
        ['ar', 'อายุลูกหนี้', overdue || null],
      ]},
      { s: 'ซื้อ', items: [
        ['ap', 'อายุเจ้าหนี้', null],
      ]},
      { s: 'ภาษี', items: [
        ['vatout', 'รายงานภาษีขาย', null],
        ['vatin', 'รายงานภาษีซื้อ', null],
      ]},
      { s: 'บัญชี', items: [
        ['journals', 'สมุดรายวัน', null],
        ['ledger', 'บัญชีแยกประเภท', null],
        ['tb', 'งบทดลอง', null],
        ['coa', 'ผังบัญชี', null],
      ]},
      { s: 'งบการเงิน', items: [
        ['bs', 'งบแสดงฐานะการเงิน', null],
        ['pl', 'งบกำไรขาดทุน', null],
        ['cashflow', 'งบกระแสเงินสด', null],
      ]},
      { s: 'โครงการและงบประมาณ', items: [
        ['projects', 'โครงการ', null],
        ['budget', 'งบประมาณเทียบใช้จริง', null],
      ]},
    ]},
    { g: 'ระบบ', items: [
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

/** หมวดย่อยที่มีหน้าจอปัจจุบันอยู่ ต้องกางไว้เสมอ ผู้ใช้จะได้เห็นว่าตัวเองอยู่ตรงไหน */
function navSubOf(screen) {
  let found = null;
  navGroups().forEach(function (g) {
    (g.subs || []).forEach(function (s) {
      if (s.items.some((i) => i[0] === screen)) found = s.s;
    });
  });
  return found;
}

/* ---------- โครงหน้าจอ ---------- */
function render() {
  /* ★ ตอนที่ยังใส่รหัสผ่านไม่ผ่าน ยังไม่มีข้อมูลบริษัทให้วาดแถบบนและเมนู
     ต้องออกก่อนแตะ DB.company ไม่งั้นหน้าจอขาวทั้งหน้า */
  if (SYNC.status === 'locked') {
    document.getElementById('nav').innerHTML = '';
    document.getElementById('coName').innerHTML = '';
    document.getElementById('periodSel').innerHTML = '';
    document.getElementById('main').innerHTML = syncPasscodeScreen(STATE.passWrong);
    const f = document.querySelector('[name="passcode"]');
    if (f) f.focus();
    return;
  }
  const groups = navGroups();
  const openSub = navSubOf(STATE.screen);
  const item = (it) => '<a href="#" class="nav-i' + (STATE.screen === it[0] ? ' on' : '')
    + '" data-act="go:' + it[0] + '">' + esc(it[1])
    + (it[2] ? '<span class="badge">' + it[2] + '</span>' : '') + '</a>';
  let nav = '';
  groups.forEach(function (g) {
    nav += '<div class="nav-g">' + esc(g.g) + '</div>';
    (g.items || []).forEach(function (it) { nav += item(it); });
    (g.subs || []).forEach(function (s) {
      const open = STATE.navOpen[s.s] === undefined ? s.s === openSub : STATE.navOpen[s.s];
      nav += '<button class="nav-s' + (open ? ' open' : '') + '" data-act="nav:' + esc(s.s) + '"'
        + ' aria-expanded="' + (open ? 'true' : 'false') + '">'
        + '<span class="chev" aria-hidden="true">›</span>' + esc(s.s)
        + (!open && s.items.some((i) => i[2]) ? '<span class="badge">'
            + s.items.reduce((n, i) => n + (i[2] || 0), 0) + '</span>' : '')
        + '</button>';
      if (open) s.items.forEach(function (it) { nav += item(it).replace('nav-i', 'nav-i sub'); });
    });
  });
  document.getElementById('nav').innerHTML = nav;

  const periods = DB.periods.map((p) =>
    '<option value="' + p.code + '"' + (p.code === STATE.period ? ' selected' : '') + '>'
    + thPeriod(p.code) + (p.status !== 'open' ? ' (ปิดแล้ว)' : '') + '</option>').join('');
  document.getElementById('periodSel').innerHTML = periods;

  const books = SYNC.books || [];
  document.getElementById('coName').innerHTML =
    (books.length > 1
      ? '<select id="bookSel" class="book-sel" aria-label="เลือกบริษัท">'
        + books.map((b) => '<option value="' + esc(b.book) + '"'
            + (b.book === SYNC.book ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('')
        + '</select>'
      : '<span class="co-name">' + esc(DB.company.name) + '</span>')
    + '<button class="add-co" data-act="company:new" title="เพิ่มบริษัท">+ บริษัท</button>'
    + (DB.isDemo
        ? '<button class="demo-tag" data-act="go:import" title="ข้อมูลชุดนี้ระบบสร้างขึ้นเพื่อให้ลองใช้">'
          + 'ข้อมูลตัวอย่าง · เริ่มใช้ของจริง</button>'
        : '');

  const fn = SCREENS[STATE.screen] || SCREENS.dashboard;
  let html;
  try { html = fn(); }
  catch (e) {
    console.error(e);
    html = card({ title:'เปิดหน้านี้ไม่ได้', body:'<div class="empty">' + esc(e.message) + '</div>' });
  }
  const main = document.getElementById('main');
  main.innerHTML = html;
  main.scrollTop = 0;
}
