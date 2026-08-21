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

/* ---------- เก็บข้อมูลไว้ในเครื่อง ---------- */
const LS_KEY = 'duly.demo.v1';
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ DB, STATE: { period: STATE.period } })); }
  catch (e) { /* โหมดส่วนตัวหรือปิดการเก็บข้อมูล — ใช้งานต่อได้ในหน่วยความจำ */ }
}
function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (!d || !d.DB || !d.DB.company) return false;
    Object.keys(d.DB).forEach((k) => { DB[k] = d.DB[k]; });
    if (d.STATE && d.STATE.period) STATE.period = d.STATE.period;
    // ข้อมูลที่บันทึกไว้ก่อนมีธงนี้ ให้เดาจากชื่อบริษัทตัวอย่าง
    if (DB.isDemo === undefined) DB.isDemo = DB.company.name === 'บริษัท ศรีวัฒนาการค้า จำกัด';
    return true;
  } catch (e) { return false; }
}
function resetAll() {
  try { localStorage.removeItem(LS_KEY); } catch (e) {}
  location.reload();
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
    { g: 'ขายและลูกหนี้', items: [
      ['invoices', 'ใบกำกับภาษี', null],
      ['receipts', 'ใบเสร็จรับเงิน', null],
      ['creditnotes', 'ใบลดหนี้', null],
      ['ar', 'อายุลูกหนี้', overdue || null],
      ['customers', 'ทะเบียนลูกค้า', null],
    ]},
    { g: 'ซื้อและเจ้าหนี้', items: [
      ['bills', 'ตั้งหนี้ผู้ขาย', null],
      ['payments', 'ใบสำคัญจ่าย', null],
      ['ap', 'อายุเจ้าหนี้', null],
      ['vendors', 'ทะเบียนผู้ขาย', null],
    ]},
    { g: 'ธนาคารและเงินสด', items: [
      ['bank', 'กระทบยอดธนาคาร', unmatched || null],
      ['cashflow', 'งบกระแสเงินสด', null],
    ]},
    { g: 'บัญชีแยกประเภท', items: [
      ['journals', 'สมุดรายวัน', null],
      ['ledger', 'บัญชีแยกประเภท', null],
      ['tb', 'งบทดลอง', null],
      ['coa', 'ผังบัญชี', null],
    ]},
    { g: 'ภาษี', items: [
      ['vatout', 'รายงานภาษีขาย', null],
      ['vatin', 'รายงานภาษีซื้อ', null],
      ['pp30', 'แบบ ภ.พ.30', null],
      ['pnd', 'ภ.ง.ด.1 / 3 / 53', null],
      ['whtcert', 'หนังสือรับรอง 50 ทวิ', null],
      ['taxcal', 'ปฏิทินภาษี', null],
    ]},
    { g: 'สินค้าคงคลัง', items: [
      ['items', 'ทะเบียนสินค้า', null],
      ['stockmoves', 'ความเคลื่อนไหวสต๊อก', null],
    ]},
    { g: 'สินทรัพย์ถาวร', items: [
      ['assets', 'ทะเบียนทรัพย์สิน', null],
      ['deprec', 'ค่าเสื่อมราคา', null],
    ]},
    { g: 'เงินเดือน', items: [
      ['payroll', 'งวดจ่ายเงินเดือน', null],
      ['employees', 'ทะเบียนพนักงาน', null],
    ]},
    { g: 'โครงการและงบประมาณ', items: [
      ['projects', 'โครงการ', null],
      ['budget', 'งบประมาณเทียบใช้จริง', null],
    ]},
    { g: 'รายงานการเงิน', items: [
      ['bs', 'งบแสดงฐานะการเงิน', null],
      ['pl', 'งบกำไรขาดทุน', null],
    ]},
    { g: 'ระบบ', items: [
      ['import', 'นำเข้าข้อมูลจากระบบเดิม', null],
      ['audit', 'ร่องรอยการตรวจสอบ', null],
      ['about', 'เกี่ยวกับระบบนี้', null],
    ]},
  ];
}

/* ---------- โครงหน้าจอ ---------- */
function render() {
  const groups = navGroups();
  let nav = '';
  groups.forEach(function (g) {
    nav += '<div class="nav-g">' + esc(g.g) + '</div>';
    g.items.forEach(function (it) {
      nav += '<a href="#" class="nav-i' + (STATE.screen === it[0] ? ' on' : '') + '" data-act="go:' + it[0] + '">'
        + esc(it[1]) + (it[2] ? '<span class="badge">' + it[2] + '</span>' : '') + '</a>';
    });
  });
  document.getElementById('nav').innerHTML = nav;

  const periods = DB.periods.map((p) =>
    '<option value="' + p.code + '"' + (p.code === STATE.period ? ' selected' : '') + '>'
    + thPeriod(p.code) + (p.status !== 'open' ? ' (ปิดแล้ว)' : '') + '</option>').join('');
  document.getElementById('periodSel').innerHTML = periods;

  document.getElementById('coName').innerHTML = esc(DB.company.name)
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
