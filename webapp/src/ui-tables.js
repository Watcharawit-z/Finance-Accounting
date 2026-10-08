/* ===================================================================
   ตารางข้อมูล — ความหนาแน่น ตัวกรองสถานะ มุมมองที่บันทึกไว้ และเมนูคลิกขวา
   ทั้งหมดเป็นความสะดวกของผู้ใช้แต่ละเครื่อง เก็บในเบราว์เซอร์ ไม่ปนกับข้อมูลบัญชี
   =================================================================== */

/* ---------- ความหนาแน่นของตาราง ---------- */
const DENSITY_KEY = 'financii.density';
const DENSITY = [['comfy', 'สบายตา'], ['normal', 'มาตรฐาน'], ['compact', 'กระชับ']];
function densityNow() {
  const d = lsGet(DENSITY_KEY);
  return DENSITY.some((x) => x[0] === d) ? d : 'normal';
}
function applyDensity(d) {
  document.documentElement.setAttribute('data-density', d || densityNow());
}
function setDensity(d) {
  if (!DENSITY.some((x) => x[0] === d)) return;
  lsSet(DENSITY_KEY, d);
  applyDensity(d);
  renderTopTools();
}
function cycleDensity() {
  const i = DENSITY.findIndex((x) => x[0] === densityNow());
  const next = DENSITY[(i + 1) % DENSITY.length];
  setDensity(next[0]);
  toast('ตาราง: ' + next[1], 'ok');
}

/* ---------- ตัวกรองสถานะของแต่ละหน้า ----------
   [รหัส, ชื่อ, เงื่อนไข] · ไม่มีเงื่อนไข = ทั้งหมด */
const notVoid = (d) => !isVoid(d);
const tradeLive = (kind) => (d) => ['issued', 'approved', 'partially_received'].indexOf(tradeDocStatus(kind, d)) >= 0;
const LIST_CHIPS = {
  invoices: [['all', 'ทั้งหมด'], ['open', 'ค้างรับ', (d) => invOutstanding(d) > 0],
    ['overdue', 'เกินกำหนด', (d) => invOutstanding(d) > 0 && d.due < TODAY],
    ['paid', 'รับครบ', (d) => notVoid(d) && invOutstanding(d) <= 0], ['void', 'ยกเลิก', isVoid]],
  bills: [['all', 'ทั้งหมด'], ['open', 'ค้างจ่าย', (d) => billOutstanding(d) > 0],
    ['overdue', 'เกินกำหนด', (d) => billOutstanding(d) > 0 && d.due < TODAY],
    ['paid', 'จ่ายครบ', (d) => notVoid(d) && billOutstanding(d) <= 0], ['void', 'ยกเลิก', isVoid]],
  receipts: [['all', 'ทั้งหมด'], ['wht', 'ลูกค้าหัก ณ ที่จ่าย', (d) => notVoid(d) && d.wht > 0], ['void', 'ยกเลิก', isVoid]],
  creditnotes: [['all', 'ทั้งหมด'], ['return', 'มีรับคืนสินค้า', (d) => notVoid(d) && (d.returns || []).length > 0], ['void', 'ยกเลิก', isVoid]],
  debitnotes: [['all', 'ทั้งหมด'], ['live', 'ใช้งาน', notVoid], ['void', 'ยกเลิก', isVoid]],
  payments: [['all', 'ทั้งหมด'], ['manual', 'หักเอง (ออก 50 ทวิ)', (d) => notVoid(d) && d.wht > 0 && d.channel !== 'e_wht'],
    ['ewht', 'e-Withholding', (d) => notVoid(d) && d.channel === 'e_wht'], ['void', 'ยกเลิก', isVoid]],
  expenses: [['all', 'ทั้งหมด'], ['wht', 'มีหัก ณ ที่จ่าย', (d) => notVoid(d) && d.wht > 0],
    ['vat', 'มีภาษีซื้อ', (d) => notVoid(d) && d.vat > 0], ['void', 'ยกเลิก', isVoid]],
  goodsreceipts: [['all', 'ทั้งหมด'], ['received', 'รอใบกำกับ', (d) => d.status === 'received'],
    ['closed', 'ตั้งหนี้แล้ว', (d) => d.status === 'closed'], ['void', 'ยกเลิก', isVoid]],
  whtcert: [['all', 'ทั้งหมด'], ['pnd3', 'ภ.ง.ด.3', (d) => notVoid(d) && d.form === 'ภ.ง.ด.3'],
    ['pnd53', 'ภ.ง.ด.53', (d) => notVoid(d) && d.form === 'ภ.ง.ด.53'], ['void', 'ยกเลิก', isVoid]],
  quotations: [['all', 'ทั้งหมด'], ['live', 'กำลังดำเนินการ', tradeLive('quotation')],
    ['closed', 'แปลงแล้ว', (d) => d.status === 'closed'], ['expired', 'หมดอายุ', (d) => tradeDocStatus('quotation', d) === 'expired'],
    ['dead', 'ยกเลิก/ปฏิเสธ', (d) => d.status === 'cancelled' || d.status === 'rejected']],
  salesorders: [['all', 'ทั้งหมด'], ['live', 'รอออกใบกำกับ', tradeLive('salesOrder')],
    ['closed', 'ออกใบกำกับแล้ว', (d) => d.status === 'closed'], ['dead', 'ยกเลิก', (d) => d.status === 'cancelled' || d.status === 'rejected']],
  purchaseorders: [['all', 'ทั้งหมด'], ['live', 'รอรับของ', tradeLive('purchaseOrder')],
    ['partial', 'รับบางส่วน', (d) => d.status === 'partially_received'],
    ['closed', 'รับครบ/ตั้งหนี้แล้ว', (d) => d.status === 'closed'], ['dead', 'ยกเลิก', (d) => d.status === 'cancelled' || d.status === 'rejected']],
};
STATE.chip = STATE.chip || {};
function chipPass(screen, d) {
  const key = STATE.chip[screen];
  if (!key || key === 'all') return true;
  const c = (LIST_CHIPS[screen] || []).find((x) => x[0] === key);
  return !c || !c[2] || c[2](d);
}

/* ---------- มุมมองที่บันทึกไว้ ---------- */
const VIEWS_KEY = 'financii.views';
function savedViews() {
  try { const v = JSON.parse(lsGet(VIEWS_KEY) || '[]'); return Array.isArray(v) ? v : []; }
  catch (e) { return []; }
}
function viewLabel(v) {
  const sc = navWhere(v.screen);
  const chip = (LIST_CHIPS[v.screen] || []).find((x) => x[0] === v.chip);
  return (sc ? sc.item[1] : v.screen) + (chip && chip[0] !== 'all' ? ' · ' + chip[1] : '') + (v.filter ? ' · "' + v.filter + '"' : '');
}
function saveView(name) {
  const views = savedViews();
  const v = { id: 'v' + Date.now().toString(36), name: String(name || '').trim() || viewLabel({ screen: STATE.screen,
    chip: STATE.chip[STATE.screen] || 'all', filter: STATE.filter }),
    screen: STATE.screen, chip: STATE.chip[STATE.screen] || 'all', filter: STATE.filter || '' };
  views.push(v);
  lsSet(VIEWS_KEY, JSON.stringify(views.slice(-30)));
  return v;
}
function openView(id) {
  const v = savedViews().find((x) => x.id === id);
  if (!v) return;
  STATE.screen = v.screen; STATE.sel = null; STATE.filter = v.filter || '';
  STATE.chip[v.screen] = v.chip || 'all';
  render();
}
function deleteView(id) {
  lsSet(VIEWS_KEY, JSON.stringify(savedViews().filter((x) => x.id !== id)));
  render();
}
function modalSaveView() {
  modal({
    title:'บันทึกมุมมองนี้',
    sub:'เก็บหน้าจอ ตัวกรองสถานะ และคำค้นไว้ เปิดกลับมาได้ในคลิกเดียว (เก็บในเบราว์เซอร์เครื่องนี้)',
    body:'<div class="flds">' + field({ name:'viewName', label:'ชื่อมุมมอง', wide:true,
      value: viewLabel({ screen: STATE.screen, chip: STATE.chip[STATE.screen] || 'all', filter: STATE.filter }) }) + '</div>',
    submitLabel:'บันทึกมุมมอง',
    onSubmit: function () {
      const v = saveView(val('viewName'));
      closeModal(); render();
      toast('บันทึกมุมมอง "' + v.name + '" แล้ว', 'ok', 'เปิดได้จากแถบตัวกรองของหน้านี้ หรือค้นด้วย Ctrl K');
    },
  });
}

/** แถบตัวกรอง: ช่องค้นหา · ตัวกรองสถานะพร้อมจำนวน · มุมมองที่บันทึกไว้ */
function listFilters(screen, ph, base) {
  const chips = LIST_CHIPS[screen] || [];
  const cur = STATE.chip[screen] || 'all';
  const views = savedViews().filter((v) => v.screen === screen);
  return (ph ? searchBox(ph) : '')
    + (chips.length ? '<div class="chips" role="group" aria-label="กรองตามสถานะ">' + chips.map(function (c) {
      const n = c[2] ? base.filter(c[2]).length : base.length;
      return '<button class="chip' + (c[0] === cur ? ' on' : '') + '" data-act="chip:' + screen + ':' + c[0] + '"'
        + (c[0] === cur ? ' aria-pressed="true"' : '') + '>' + esc(c[1]) + '<span class="chip-n">' + n + '</span></button>';
    }).join('') + '</div>' : '')
    + '<span class="grow"></span>'
    + views.map((v) => '<span class="view-chip"><button class="chip" data-act="sview:' + v.id + '" title="เปิดมุมมองที่บันทึกไว้">'
      + icon('bookmark') + esc(v.name) + '</button><button class="view-x" data-act="sviewdel:' + v.id + '" aria-label="ลบมุมมอง '
      + esc(v.name) + '">×</button></span>').join('')
    + '<button class="ghost" data-act="viewsave" title="บันทึกตัวกรองและคำค้นนี้เป็นมุมมอง">' + icon('bookmark') + '</button>';
}

/* ---------- เมนูคลิกขวาที่แถวในตาราง ---------- */
const SCREEN_DOC = { invoices:'invoice', receipts:'receipt', creditnotes:'creditNote', debitnotes:'debitNote',
  bills:'bill', payments:'payment', expenses:'expense', goodsreceipts:'goodsReceipt', whtcert:'whtCert',
  billingnotes:'billingNote', paymentprep:'paymentBatch', quotations:'quotation', salesorders:'salesOrder',
  purchaseorders:'purchaseOrder' };
const DOC_SCREEN = {};
Object.keys(SCREEN_DOC).forEach((k) => { DOC_SCREEN[SCREEN_DOC[k]] = k; });

/** อ่านว่าแถวนี้คือเอกสารอะไร จาก data-act ของแถว */
function rowDoc(tr) {
  const act = tr.getAttribute('data-act') || '';
  const p = act.split(':');
  if (p[0] === 'sel' && p[1] && SCREEN_DOC[STATE.screen]) return { kind: SCREEN_DOC[STATE.screen], no: p.slice(1).join(':') };
  if (p[0] === 'sel' && p[1] && /^(journals|j[a-z]+)$/.test(STATE.screen)) return { kind: 'entry', no: p.slice(1).join(':') };
  if (p[0] === 'open' && SCREEN_DOC[p[1]]) return { kind: SCREEN_DOC[p[1]], no: p.slice(2).join(':') };
  if (p[0] === 'printdoc') return { kind: p[1], no: p.slice(2).join(':') };
  if (p[0] === 'entry') return { kind: 'entry', no: p.slice(1).join(':') };
  return null;
}
function rowMenuItems(ref) {
  const items = [];
  if (ref.kind === 'entry') {
    const e = DB.entries.find((x) => x.no === ref.no);
    if (!e) return items;
    items.push(['entry:' + e.no, 'เปิดใบสำคัญ', 'book']);
    items.push(['printdoc:entry:' + e.no, 'พิมพ์ใบสำคัญ', 'printer']);
    const src = ENTRY_SOURCE_SCREEN[e.src];
    if (src && e.srcId) items.push(['open:' + src + ':' + e.srcId, 'ไปที่เอกสารต้นทาง', 'sale']);
    items.push(['copy:' + e.no, 'คัดลอกเลขที่', 'hash']);
    return items;
  }
  const d = (DB.docs[ref.kind] || []).find((x) => x.no === ref.no);
  if (!d) return items;
  const sc = DOC_SCREEN[ref.kind];
  if (sc) items.push(['open:' + sc + ':' + d.no, 'เปิดรายละเอียด', 'sale']);
  if (DOC_PRINT[ref.kind]) items.push(['printdoc:' + ref.kind + ':' + d.no, 'พิมพ์', 'printer']);
  if (d.entryNo) items.push(['entry:' + d.entryNo, 'ดูใบสำคัญ ' + d.entryNo, 'book']);
  if (ref.kind === 'invoice' && !isVoid(d)) {
    if (invOutstanding(d) > 0) items.push(['pay:' + d.no, 'รับชำระเงิน', 'cash']);
    if (invOutstanding(d) < 0) items.push(['refund:' + d.no, 'คืนเงินลูกค้า', 'cash']);
    if (creditableBase(d) > 0) items.push(['cn:' + d.no, 'ออกใบลดหนี้', 'sale']);
    items.push(['dn:' + d.no, 'ออกใบเพิ่มหนี้', 'sale']);
  }
  if (ref.kind === 'bill' && !isVoid(d) && billOutstanding(d) > 0) items.push(['paybill:' + d.no, 'จ่ายชำระ', 'cash']);
  if (ref.kind === 'goodsReceipt' && d.status === 'received') items.push(['grn:bill:' + d.no, 'ตั้งหนี้จากใบรับสินค้า', 'buy']);
  items.push(['copy:' + d.no, 'คัดลอกเลขที่', 'hash']);
  if (VOIDABLE[ref.kind] && !isVoid(d)) items.push(['void:' + ref.kind + ':' + d.no, 'ยกเลิกเอกสาร…', 'lock', 'danger']);
  return items;
}
function openRowMenu(tr, x, y) {
  const ref = rowDoc(tr);
  if (!ref) return false;
  const items = rowMenuItems(ref);
  if (!items.length) return false;
  const m = document.getElementById('rowMenu');
  m.innerHTML = '<div class="rm-h">' + esc(ref.no) + '</div>' + items.map((i) => '<button class="rm-i' + (i[3] ? ' ' + i[3] : '')
    + '" role="menuitem" data-act="rowgo:' + esc(i[0]) + '">' + icon(i[2]) + esc(i[1]) + '</button>').join('');
  m.classList.add('show');
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, x))) + 'px';
  m.style.top = Math.round(Math.max(8, Math.min(window.innerHeight - h - 8, y))) + 'px';
  const first = m.querySelector('.rm-i');
  if (first) first.focus();
  return true;
}
function closeRowMenu() {
  const m = document.getElementById('rowMenu');
  if (!m || !m.classList.contains('show')) return false;
  m.classList.remove('show');
  m.innerHTML = '';
  return true;
}
function copyText(t) {
  const done = () => toast('คัดลอก ' + t + ' แล้ว', 'ok');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
  else done();
}
function bindTableEvents() {
  document.addEventListener('contextmenu', function (ev) {
    const tr = ev.target.closest('#main tr[data-act]');
    if (!tr) return;
    if (openRowMenu(tr, ev.clientX, ev.clientY)) ev.preventDefault();
  });
  document.addEventListener('click', function (ev) {
    if (!ev.target.closest('#rowMenu')) closeRowMenu();
  }, true);
  document.addEventListener('keydown', function (ev) {
    const m = document.getElementById('rowMenu');
    if (!m || !m.classList.contains('show')) {
      /* ปุ่มเมนูบนแป้นพิมพ์ หรือ Shift+F10 บนแถวที่โฟกัสอยู่ */
      if ((ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) && document.activeElement) {
        const tr = document.activeElement.closest && document.activeElement.closest('#main tr[data-act]');
        if (tr) { const r = tr.getBoundingClientRect(); if (openRowMenu(tr, r.left + 24, r.bottom)) ev.preventDefault(); }
      }
      return;
    }
    const btns = [...m.querySelectorAll('.rm-i')];
    const i = btns.indexOf(document.activeElement);
    if (ev.key === 'Escape') { ev.preventDefault(); closeRowMenu(); }
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); (btns[i + 1] || btns[0]).focus(); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); (btns[i - 1] || btns[btns.length - 1]).focus(); }
  });
  window.addEventListener('scroll', closeRowMenu, true);
  window.addEventListener('resize', closeRowMenu);
}
