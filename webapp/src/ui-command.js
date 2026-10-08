/* ===================================================================
   ค้นหาและสั่งงาน (Ctrl+K) · เมนูสร้างเอกสาร · ส่งออกตารางเป็น CSV
   =================================================================== */

/* ทุกเอกสารที่สร้างได้ จัดหมวดเดียวกับเมนูหลัก ใช้ทั้งเมนู "สร้างเอกสาร" และช่องค้นหา */
const CREATE_MENU = [
  { s:'เอกสารขาย', icon:'sale', items:[
    ['new:quotation', 'ใบเสนอราคา'], ['new:salesorder', 'ใบสั่งขาย'], ['new:invoice', 'ใบกำกับภาษี'],
    ['new:billingnote', 'ใบวางบิล'], ['new:receipt', 'ใบเสร็จรับเงิน'],
    ['new:creditnote', 'ใบลดหนี้'], ['new:debitnote', 'ใบเพิ่มหนี้'],
  ]},
  { s:'ซื้อและค่าใช้จ่าย', icon:'buy', items:[
    ['new:purchaseorder', 'ใบสั่งซื้อ'], ['new:goodsreceipt', 'ใบรับสินค้า'], ['new:bill', 'ตั้งหนี้ผู้ขาย'],
    ['new:payment', 'จ่ายชำระเจ้าหนี้'], ['new:expense', 'ค่าใช้จ่าย'],
    ['new:whtcert', 'หนังสือรับรอง 50 ทวิ'], ['new:paymentbatch', 'ใบเตรียมจ่าย'],
  ]},
  { s:'บัญชี', icon:'book', items:[
    ['jv:general', 'ใบสำคัญทั่วไป'], ['jv:purchase', 'ใบสำคัญซื้อ'], ['jv:sales', 'ใบสำคัญขาย'],
    ['jv:payment', 'ใบสำคัญจ่าย'], ['jv:receipt', 'ใบสำคัญรับ'],
  ]},
  { s:'ทะเบียน', icon:'contact', items:[
    ['partner:new:customer', 'ลูกค้า'], ['partner:new:vendor', 'ผู้ขาย'], ['item:new', 'สินค้าหรือบริการ'],
    ['emp:new', 'พนักงาน'], ['asset:new', 'ทรัพย์สิน'],
  ]},
];

/* คำที่คนพิมพ์หาจริง แต่ไม่ได้อยู่ในชื่อเมนู */
const SCREEN_WORDS = {
  pp30:'vat ภาษีมูลค่าเพิ่ม ภพ30', pnd:'wht ภาษีหักณที่จ่าย ภงด1 ภงด3 ภงด53', whtcert:'50ทวิ wht หนังสือรับรอง',
  bs:'งบดุล balance sheet ฐานะการเงิน', pl:'กำไรขาดทุน income profit loss', equity:'ส่วนของเจ้าของ ทุน กำไรสะสม',
  tb:'trial balance งบทดลอง', coa:'chart of accounts ผังบัญชี', ledger:'gl บัญชีแยกประเภท',
  journals:'journal ใบสำคัญ jv', cashflow:'เงินสด cash flow', bank:'สเตทเมนต์ statement reconcile',
  invoices:'invoice tax ขาย', receipts:'receipt รับเงิน', bills:'ap เจ้าหนี้ ซื้อ', expenses:'expense จ่าย',
  ar:'ลูกหนี้ aging', ap:'เจ้าหนี้ aging', close:'ปิดบัญชี ปิดเดือน', settings:'ตั้งค่า บริษัท company',
  paymentprep:'จ่ายเงิน payment run', billingnotes:'billing วางบิล', goodsreceipts:'grn รับของ',
};

/* ---------- เมนูสร้างเอกสาร ---------- */
function openPop(anchor) {
  const pop = document.getElementById('pop');
  pop.innerHTML = '<div class="pop-box" role="menu">' + CREATE_MENU.map((sec) =>
    '<div class="pop-sec"><h4>' + icon(sec.icon) + esc(sec.s) + '</h4>'
    + sec.items.map((i) => '<button class="pop-i" role="menuitem" data-act="popgo:' + i[0] + '">'
      + esc(i[1]) + '</button>').join('') + '</div>').join('') + '</div>';
  pop.classList.add('show');
  const r = anchor.getBoundingClientRect();
  const w = pop.firstChild.offsetWidth;
  pop.style.top = Math.round(r.bottom + 6) + 'px';
  pop.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))) + 'px';
  const first = pop.querySelector('.pop-i');
  if (first) first.focus();
}
function closePop() {
  const pop = document.getElementById('pop');
  if (!pop.classList.contains('show')) return false;
  pop.classList.remove('show');
  pop.innerHTML = '';
  return true;
}

/* ---------- ค้นหาและสั่งงาน ---------- */
const CMDK = { items: [], at: 0 };
/* เทียบแบบไม่สนช่องว่าง จุด และขีด — พิมพ์ "ภพ30" ก็เจอ "ภ.พ.30" */
const cmdNorm = (s) => String(s || '').toLowerCase().replace(/[\s.\-–·/_]/g, '');

function cmdkSources(q) {
  const n = cmdNorm(q);
  const has = (...parts) => !n || parts.some((p) => cmdNorm(p).indexOf(n) >= 0);
  const out = [];
  const add = (g, list, max) => { list.slice(0, max).forEach((x) => out.push(Object.assign({ g }, x))); };

  /* สร้างเอกสาร */
  const creates = [];
  CREATE_MENU.forEach((sec) => sec.items.forEach((i) => {
    const t = (i[0].indexOf('partner:') === 0 || /^(item|emp|asset):/.test(i[0]) ? 'เพิ่ม' : 'สร้าง') + i[1];
    if (has(t, i[1], sec.s)) creates.push({ icon:'plus', t, h: sec.s, act: i[0] });
  }));
  add('สร้างเอกสาร', creates, n ? 6 : 5);

  /* หน้าจอ */
  const screens = [];
  navGroups().forEach(function (g) {
    const push = (it, sub) => {
      if (has(it[1], g.g, sub || '', SCREEN_WORDS[it[0]] || '')) {
        screens.push({ icon: g.icon, t: it[1], h: g.flat ? 'ภาพรวม' : g.g + (sub ? ' · ' + sub : ''), act: 'go:' + it[0] });
      }
    };
    (g.items || []).forEach((it) => push(it));
    (g.subs || []).forEach((s) => s.items.forEach((it) => push(it, s.s)));
  });
  add('ไปที่หน้า', screens, n ? 8 : 6);

  /* คำสั่ง */
  const cmds = [
    { icon: themeNow() === 'dark' ? 'sun' : 'moon', t:'สลับโหมดสว่าง / มืด', h:'การแสดงผล', act:'theme' },
    { icon:'printer', t:'พิมพ์หน้านี้', h:'รายงานบนจอ', act:'print' },
  ].concat(DENSITY.map((d) => ({ icon:'rows', t:'ตาราง: ' + d[1], h:'ความหนาแน่นของตาราง', act:'density:' + d[0] })))
   .concat([{ icon:'calendar', t:'แสดงปีเป็น ค.ศ.', h:'การแสดงผล · ปีคริสต์ศักราช', act:'era:ce' },
     { icon:'calendar', t:'แสดงปีเป็น พ.ศ.', h:'การแสดงผล · ปีพุทธศักราช', act:'era:be' }])
   .filter((c) => has(c.t, c.h));
  if (n) add('คำสั่ง', cmds, 5);

  /* มุมมองที่บันทึกไว้ */
  add('มุมมองที่บันทึกไว้', savedViews().filter((v) => has(v.name, viewLabel(v)))
    .map((v) => ({ icon:'bookmark', t: v.name, h: viewLabel(v), act:'sview:' + v.id })), n ? 5 : 4);

  if (n.length < 2) return out;

  /* เอกสาร — ค้นจากเลขที่ เลขใบกำกับผู้ขาย และชื่อคู่ค้า */
  const DOCS = [
    ['invoice', 'ใบกำกับภาษี', (d) => 'open:invoices:' + d.no, 'sale'],
    ['billingNote', 'ใบวางบิล', (d) => 'open:billingnotes:' + d.no, 'sale'],
    ['receipt', 'ใบเสร็จรับเงิน', (d) => 'open:receipts:' + d.no, 'sale'],
    ['creditNote', 'ใบลดหนี้', (d) => 'open:creditnotes:' + d.no, 'sale'],
    ['debitNote', 'ใบเพิ่มหนี้', (d) => 'open:debitnotes:' + d.no, 'sale'],
    ['quotation', 'ใบเสนอราคา', (d) => 'open:quotations:' + d.no, 'sale'],
    ['salesOrder', 'ใบสั่งขาย', (d) => 'open:salesorders:' + d.no, 'sale'],
    ['purchaseOrder', 'ใบสั่งซื้อ', (d) => 'open:purchaseorders:' + d.no, 'buy'],
    ['goodsReceipt', 'ใบรับสินค้า', (d) => 'open:goodsreceipts:' + d.no, 'buy'],
    ['bill', 'ตั้งหนี้', (d) => 'open:bills:' + d.no, 'buy'],
    ['payment', 'ใบสำคัญจ่าย', (d) => 'open:payments:' + d.no, 'buy'],
    ['expense', 'ค่าใช้จ่าย', (d) => 'open:expenses:' + d.no, 'receipt'],
    ['whtCert', '50 ทวิ', (d) => 'open:whtcert:' + d.no, 'receipt'],
    ['paymentBatch', 'ใบเตรียมจ่าย', (d) => 'open:paymentprep:' + d.no, 'receipt'],
  ];
  const docs = [];
  DOCS.forEach(function (D) {
    (DB.docs[D[0]] || []).forEach(function (d) {
      if (docs.length > 60) return;
      if (has(d.no, d.partnerName || '', d.vendorNo || '', d.taxInvoiceNo || '', d.invoiceNo || '')) {
        const amt = d.total !== undefined ? d.total : d.net !== undefined ? d.net : d.wht;
        docs.push({ icon: D[3], t: d.no + ' · ' + (d.partnerName || d.note || ''),
          h: D[1] + (amt !== undefined ? ' · ' + fmt(amt) : '') + ' · ' + thDateNum(d.date), act: D[2](d) });
      }
    });
  });
  DB.entries.forEach(function (e) {
    if (docs.length > 70) return;
    if (has(e.no, e.srcId || '')) {
      docs.push({ icon:'book', t: e.no + ' · ' + e.desc, h: JOURNAL_BOOKS[journalOf(e)].label + ' · ' + fmt(e.total), act:'entry:' + e.no });
    }
  });
  add('เอกสาร', docs, 8);

  add('ผู้ติดต่อ', DB.partners.filter((p) => has(p.name, p.code, p.taxId || '')).map((p) => ({
    icon:'user', t: p.name, h: (p.kind === 'customer' ? 'ลูกค้า' : 'ผู้ขาย') + ' · ' + p.code, act:'partner:edit:' + p.code })), 5);
  add('บัญชี', DB.accounts.filter((a) => a.postable && has(a.code, a.name)).map((a) => ({
    icon:'hash', t: a.code + ' ' + a.name, h:'ดูบัญชีแยกประเภท', act:'drill:' + a.code })), 5);
  add('สินค้า', DB.items.filter((i) => has(i.code, i.name)).map((i) => ({
    icon:'box', t: i.code + ' · ' + i.name, h: i.type === 'stock' ? 'คงเหลือ ' + i.qty + ' ' + i.uom : 'บริการ',
    act:'item:edit:' + i.code })), 4);
  return out;
}

function cmdkRender() {
  const list = document.getElementById('cmdkList');
  if (!list) return;
  if (!CMDK.items.length) {
    list.innerHTML = '<div class="cmdk-empty">ไม่พบสิ่งที่ค้นหา ลองพิมพ์เลขที่เอกสาร ชื่อคู่ค้า หรือรหัสบัญชี</div>';
    return;
  }
  let h = '', g = null;
  CMDK.items.forEach(function (x, i) {
    if (x.g !== g) { g = x.g; h += '<div class="cmdk-g">' + esc(g) + '</div>'; }
    h += '<button class="cmdk-i' + (i === CMDK.at ? ' on' : '') + '" data-act="cmdkgo:' + i + '" data-i="' + i + '">'
      + icon(x.icon) + '<span class="t">' + esc(x.t) + '</span><span class="h">' + esc(x.h || '') + '</span></button>';
  });
  list.innerHTML = h;
  const on = list.querySelector('.cmdk-i.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
function cmdkRefresh() {
  const inp = document.getElementById('cmdkQ');
  CMDK.items = cmdkSources(inp ? inp.value : '');
  CMDK.at = 0;
  cmdkRender();
}
function openCmdk(q) {
  closePop();
  const el = document.getElementById('cmdk');
  el.innerHTML = '<div class="cmdk-box"><div class="cmdk-in">' + icon('search')
    + '<input id="cmdkQ" placeholder="พิมพ์เลขที่เอกสาร ชื่อลูกค้า ผู้ขาย รหัสบัญชี หรือสิ่งที่อยากทำ" autocomplete="off" spellcheck="false" aria-label="ค้นหา">'
    + '<kbd>Esc</kbd></div><div class="cmdk-list" id="cmdkList" role="listbox"></div>'
    + '<div class="cmdk-f"><span><kbd>↑</kbd> <kbd>↓</kbd> เลือก</span><span><kbd>Enter</kbd> เปิด</span>'
    + '<span><kbd>Esc</kbd> ปิด</span></div></div>';
  el.classList.add('show');
  const inp = document.getElementById('cmdkQ');
  inp.value = q || '';
  inp.focus();
  cmdkRefresh();
}
function closeCmdk() {
  const el = document.getElementById('cmdk');
  if (!el.classList.contains('show')) return false;
  el.classList.remove('show');
  el.innerHTML = '';
  return true;
}
function cmdkRun(i) {
  const x = CMDK.items[i];
  if (!x) return;
  closeCmdk();
  dispatch(x.act);
}
function cmdkKey(ev) {
  const el = document.getElementById('cmdk');
  if (!el.classList.contains('show')) return false;
  if (ev.key === 'Escape') { ev.preventDefault(); closeCmdk(); return true; }
  if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
    ev.preventDefault();
    const n = CMDK.items.length;
    if (n) CMDK.at = (CMDK.at + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
    cmdkRender();
    return true;
  }
  if (ev.key === 'Enter') { ev.preventDefault(); cmdkRun(CMDK.at); return true; }
  return false;
}

/* ---------- ส่งออกตารางเป็น CSV ----------
   ใส่ BOM ไว้หน้าไฟล์ Excel จะอ่านภาษาไทยถูก · ตัวเลขส่งออกเป็นตัวเลขล้วน
   (ไม่มีจุลภาค วงเล็บกลายเป็นเครื่องหมายลบ) ให้ Excel คำนวณต่อได้ทันที */
function csvCell(td) {
  const raw = (td.textContent || '').replace(/\s+/g, ' ').trim();
  if (!td.classList.contains('num')) return raw;
  if (raw === '—' || raw === '') return '';
  const neg = /^\(.*\)$/.test(raw);
  const v = raw.replace(/[(),\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(v) ? (neg ? '-' : '') + v : raw;
}
function csvQuote(v) {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
function exportCsv(cardEl) {
  if (!cardEl) return;
  const tables = Array.from(cardEl.querySelectorAll('table'));
  if (!tables.length) return;
  const h2 = cardEl.querySelector('.card-h h2');
  const title = h2 ? h2.textContent.trim() : 'ตาราง';
  const sub = cardEl.querySelector('.card-h .card-sub');
  const lines = [[DB.company.name], [title + (sub ? ' — ' + sub.textContent.trim() : '')], []];
  tables.forEach(function (t, ti) {
    if (ti > 0) lines.push([]);
    t.querySelectorAll('tr').forEach(function (tr) {
      const cells = Array.from(tr.children).map(csvCell);
      if (cells.some((c) => c !== '')) lines.push(cells);
    });
  });
  const text = '\ufeff' + lines.map((r) => r.map(csvQuote).join(',')).join('\r\n');
  /* ชื่อไฟล์เป็นอักษรอังกฤษ เบราว์เซอร์บางตัวไม่ยอมตั้งชื่อไฟล์ภาษาไทยแล้วตั้งเป็น "download" ไม่มีนามสกุล
     ชื่อรายงานภาษาไทยอยู่ในบรรทัดแรกของไฟล์แทน */
  const name = 'Financii_' + STATE.screen + '_' + STATE.period + '.csv';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('ส่งออก "' + title + '" แล้ว', 'ok', name + ' · ' + (lines.length - 3) + ' แถว · เปิดด้วย Excel ได้ทันที ภาษาไทยไม่เพี้ยน');
  return text;
}
