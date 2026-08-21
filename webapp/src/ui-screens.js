/* ===================================================================
   หน้าจอทั้งหมด — หนึ่งฟังก์ชันต่อหนึ่งหน้า คืนค่าเป็น HTML
   =================================================================== */

const pStart = () => STATE.period + '-01';
const pEnd   = () => endOfMonth(STATE.period + '-01');
const yStart = () => STATE.period.slice(0, 4) + '-01-01';
const periodIsOpen = () => {
  const p = DB.periods.find((x) => x.code === STATE.period);
  return p && p.status === 'open';
};
const lockNote = () => (periodIsOpen() ? '' : ' — งวดนี้ปิดแล้ว สร้างเอกสารใหม่ไม่ได้');

function kpi(list) {
  return '<div class="kpis">' + list.map(function (k) {
    return '<div class="kpi' + (k.tone ? ' ' + k.tone : '') + (k.act ? ' clickable" data-act="' + k.act : '') + '">'
      + '<div class="kpi-l">' + esc(k.label) + '</div>'
      + '<div class="kpi-v">' + esc(k.value) + '</div>'
      + (k.sub ? '<div class="kpi-s">' + esc(k.sub) + '</div>' : '') + '</div>';
  }).join('') + '</div>';
}
const searchBox = (ph) =>
  '<input class="search" id="q" placeholder="' + esc(ph || 'ค้นหา…') + '" value="' + esc(STATE.filter) + '">';
const hit = (s) => !STATE.filter || String(s).toLowerCase().indexOf(STATE.filter.toLowerCase()) >= 0;

/* บรรทัดของงบการเงิน (ใช้ทั้งงบดุลและงบกำไรขาดทุน) */
function fsRows(lines) {
  let h = '<div class="scroll"><table class="fs"><tbody>';
  lines.forEach(function (L) {
    if (L.k === 'd' && L.value === 0) return;   // งบการเงินไม่แสดงบรรทัดที่ไม่มียอด
    if (L.k === 'sp') { h += '<tr class="sp"><td colspan="3"></td></tr>'; return; }
    if (L.k === 'h')  { h += '<tr class="fs-h"><td colspan="3">' + esc(L.label) + '</td></tr>'; return; }
    if (L.k === 'h2') { h += '<tr class="fs-h2"><td colspan="3">' + esc(L.label) + '</td></tr>'; return; }
    const cls = L.k === 't' ? 'fs-t' : L.k === 's' ? 'fs-s' : '';
    h += '<tr class="' + cls + '"><td>' + esc(L.label) + '</td>'
      + '<td class="ctr dim">' + (L.note ? String(L.note) : '') + '</td>'
      + '<td class="num' + (L.value < 0 ? ' neg' : '') + '">' + fmt(L.value) + '</td></tr>';
  });
  return h + '</tbody></table></div>';
}

/* ===================================================================
   ภาพรวม
   =================================================================== */
function scDashboard() {
  const to = pEnd(), from = pStart();
  const mo  = incomeStatement(from, to);
  const ytd = incomeStatement(yStart(), to);
  const bs  = balanceSheet(to);
  const cash = balBySub(CASH_SUB, to);
  const ar = aging('ar', to), ap = aging('ap', to);
  const overdue = ar.totals.b30 + ar.totals.b60 + ar.totals.b90 + ar.totals.over;
  const chk = closeChecklist(STATE.period);
  const todo = chk.items.filter((i) => !i.ok);
  const rec = reconciliationChecks(to);
  const S12 = monthlySeries();
  const prev = S12.length > 1 ? S12[S12.length - 2] : null;
  const cur = S12[S12.length - 1] || { revenue:0, expense:0, net:0, cash:0, ar:0 };

  const delta = (now, was, invert) => {
    if (was === null || was === undefined) return '';
    const d = now - was;
    if (d === 0) return 'เท่ากับเดือนก่อน';
    const up = d > 0;
    const good = invert ? !up : up;
    return '<span class="' + (good ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + ' ' + fmt(Math.abs(d), 0)
      + '</span> จากเดือนก่อน';
  };

  const tiles = [
    { label:'รายได้เดือนนี้', value: fmt(cur.revenue), spark: S12.map((r) => r.revenue),
      sub: prev ? delta(cur.revenue, prev.revenue) : 'เดือนแรกของรอบบัญชี' },
    { label:'กำไรสุทธิเดือนนี้', value: fmt(cur.net), tone: cur.net < 0 ? 'bad' : 'good',
      spark: S12.map((r) => r.net),
      sub:'อัตรากำไร ' + (cur.revenue ? (cur.net / cur.revenue * 100).toFixed(1) : '0.0') + '% · สะสม ' + fmt(ytd.net, 0) + ' บาท' },
    { label:'เงินสดและเงินฝาก', value: fmt(cash), act:'go:cashflow', spark: S12.map((r) => r.cash),
      sub: prev ? delta(cash, prev.cash) : 'ณ ' + thDate(to) },
    { label:'ลูกหนี้คงค้าง', value: fmt(ar.totals.total), act:'go:ar', tone: overdue > 0 ? 'warn' : '',
      spark: S12.map((r) => r.ar),
      sub: overdue > 0 ? 'เกินกำหนดชำระ ' + fmt(overdue, 0) : 'ไม่มีรายการเกินกำหนด' },
    { label:'เจ้าหนี้คงค้าง', value: fmt(ap.totals.total), act:'go:ap', spark: S12.map((r) => r.ap),
      sub: prev ? delta(ap.totals.total, prev.ap, true) : 'ตามเทอมที่ตกลงกับผู้ขาย' },
    { label:'สินทรัพย์รวม', value: fmt(bs.assets), act:'go:bs', spark: S12.map((r) => r.assets),
      sub: bs.diff === 0 ? 'งบสมดุล · หนี้สิน ' + fmt(bs.liabilities, 0) + ' บาท' : 'ผลต่าง ' + fmt(bs.diff) },
  ];

  const actMap = {
    depreciation: ['run:deprec', 'ตั้งค่าเสื่อมราคา'],
    payroll: ['run:payroll', 'ทำเงินเดือน'],
    vat: ['go:pp30', 'ไปหน้า ภ.พ.30'],
    bank: ['go:bank', 'ไปกระทบยอด'],
  };

  const AGE = [
    { label:'ยังไม่ครบกำหนด', value: ar.totals.notDue, color:'--s1' },
    { label:'เกินกำหนด 1–30 วัน', value: ar.totals.b30, color:'--c-warn' },
    { label:'เกินกำหนด 31–60 วัน', value: ar.totals.b60, color:'--c-warn' },
    { label:'เกินกำหนด 61–90 วัน', value: ar.totals.b90, color:'--c-neg' },
    { label:'เกินกำหนดเกิน 90 วัน', value: ar.totals.over, color:'--c-neg' },
  ].filter((r) => r.value > 0);

  const revTable = tbl({
    cols:[{t:'เดือน'},{t:'รายได้รวม',a:'r'},{t:'ค่าใช้จ่ายรวม',a:'r'},{t:'กำไรสุทธิ',a:'r'},{t:'อัตรากำไร',a:'r'}],
    rows: S12.map((r) => [thPeriod(r.code), {n:r.revenue}, {n:r.expense}, {n:r.net},
      {c: r.revenue ? (r.net / r.revenue * 100).toFixed(1) + '%' : '—'}]),
    foot: ['รวม', {n:S12.reduce((s,r)=>s+r.revenue,0)}, {n:S12.reduce((s,r)=>s+r.expense,0)},
      {n:S12.reduce((s,r)=>s+r.net,0)}, ''],
  });

  const demoBanner = DB.isDemo
    ? '<section class="demo-note"><div><b>ตัวเลขทั้งหมดในหน้านี้เป็นข้อมูลตัวอย่าง</b>'
      + '<div>ระบบสร้างบริษัทสมมุติ ' + esc(DB.company.name) + ' ที่เดินมา 7 เดือนไว้ให้ลองกดใช้ทุกปุ่ม '
      + 'ไม่ใช่ข้อมูลจริงของคุณ พร้อมใช้งานจริงเมื่อไหร่ให้ล้างทิ้งแล้วเริ่มจากบริษัทเปล่า</div></div>'
      + '<span class="grow"></span>'
      + btn('blank:new', 'เริ่มจากบริษัทเปล่า', 'primary')
      + btn('go:import', 'นำเข้าข้อมูลเดิม')
      + '</section>'
    : '';

  return demoBanner + '<div class="kpis">' + tiles.map(function (k) {
      return '<div class="kpi' + (k.tone ? ' ' + k.tone : '') + (k.act ? ' clickable" data-act="' + k.act : '') + '">'
        + '<div class="kpi-l">' + esc(k.label) + '</div>'
        + '<div class="kpi-v">' + esc(k.value) + '</div>'
        + '<div class="kpi-s">' + (k.sub || '') + '</div>'
        + (k.spark ? sparkline(k.spark) : '') + '</div>';
    }).join('') + '</div>'
  + '<div class="dash-2">'
  + card({ title:'รายได้และค่าใช้จ่ายรายเดือน',
      sub:'รอบบัญชี ' + DB.company.fiscalYear + ' ถึง ' + thPeriod(STATE.period),
      actions: chip('view:chart', 'กราฟ', STATE.dashView !== 'table')
             + chip('view:table', 'ตาราง', STATE.dashView === 'table'),
      body: STATE.dashView === 'table' ? revTable
        : chartGrouped(S12, [
            { key:'revenue', name:'รายได้รวม', color:'--s1' },
            { key:'expense', name:'ค่าใช้จ่ายรวม', color:'--s2' },
          ], 'หน่วย: ล้านบาท'),
      foot:'ระยะห่างระหว่างสองแท่งในแต่ละเดือนคือกำไรสุทธิของเดือนนั้น' })
  + card({ title:'เงินสดและเงินฝากปลายเดือน', sub:'รวมเงินสดย่อย บัญชีกระแสรายวัน และบัญชีออมทรัพย์',
      body: chartLine(S12, 'cash', 'เงินสดคงเหลือ', 'หน่วย: ล้านบาท'),
      foot:'ตัวเลขดึงจากบัญชีแยกประเภทโดยตรง ไม่ได้กรอกซ้ำ' })
  + '</div>'
  + '<div class="dash-2">'
  + card({ title:'ค่าใช้จ่ายสูงสุดของงวด', sub: thPeriod(STATE.period),
      body: chartBarsH(topExpenses(from, to, 6), 'หน่วย: บาท'),
      foot:'คลิกหัวข้อในผังบัญชีเพื่อเจาะดูรายการที่ประกอบเป็นยอดนี้' })
  + card({ title:'ลูกหนี้แยกตามอายุหนี้', sub:'ณ ' + thDate(to) + ' · รวม ' + fmt(ar.totals.total) + ' บาท',
      actions: btn('go:ar', 'ดูรายลูกค้า'),
      body: AGE.length ? chartBarsH(AGE, 'หน่วย: บาท') : '<div class="empty">ไม่มียอดลูกหนี้คงค้าง</div>',
      foot: overdue > 0
        ? 'เกินกำหนดชำระรวม ' + fmt(overdue) + ' บาท คิดเป็น '
          + (ar.totals.total ? (overdue / ar.totals.total * 100).toFixed(1) : '0') + '% ของลูกหนี้ทั้งหมด'
        : 'ลูกหนี้ทั้งหมดยังอยู่ในกำหนดชำระ' })
  + '</div>'
  + '<div class="dash-2">'
  + '<section class="card"><div class="card-h"><div><h2>งานค้างของงวดนี้</h2>'
    + '<div class="card-sub">' + thPeriod(STATE.period) + ' — ' + (todo.length ? todo.length + ' รายการ' : 'เคลียร์ครบแล้ว') + '</div></div></div>'
    + (todo.length
        ? '<ul class="todo">' + todo.map(function (i) {
            const a = i.action && actMap[i.action];
            return '<li><span class="dot ' + (i.blocking ? 'bad' : 'warn') + '"></span>'
              + '<div><b>' + esc(i.label) + '</b><div class="dim">' + esc(i.detail)
              + (i.blocking ? ' · ปิดงวดไม่ได้จนกว่าจะเคลียร์' : ' · ไม่บล็อกการปิดงวด') + '</div></div>'
              + '<span class="grow"></span>' + (a ? btn(a[0], a[1]) : '') + '</li>';
          }).join('') + '</ul>'
        : '<div class="empty">ทุกอย่างเรียบร้อย พร้อมปิดงวด<div style="margin-top:12px">' + btn('go:close', 'ไปหน้าปิดงวด', 'primary') + '</div></div>')
  + '</section>'
  + card({ title:'ตรวจยอดคุมอัตโนมัติ', sub:'ระบบตรวจให้ทุกครั้งที่มีรายการเปลี่ยน',
      body:'<ul class="checks">' + rec.checks.map((c) =>
        '<li><span class="dot ' + (c.ok ? 'good' : 'bad') + '"></span>' + esc(c.label)
        + '<span class="grow"></span><span class="' + (c.ok ? 'dim' : 'neg') + '">'
        + (c.ok ? 'ตรงกัน' : 'ต่าง ' + fmt(c.control - c.sub)) + '</span></li>').join('') + '</ul>' })
  + '</div>'
  + card({ title:'รายการบัญชีล่าสุด', sub:'ทุกใบสำคัญที่ระบบสร้างจากเอกสาร',
      actions: btn('go:journals', 'ดูสมุดรายวันทั้งหมด'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'คำอธิบาย'},{t:'ยอด',a:'r'},{t:'สถานะ'}],
        rows: DB.entries.slice().reverse().slice(0, 10).map((e) =>
          [{mono:e.no}, thDateNum(e.date), e.desc, {n:e.total}, statusPill(e.status)]),
        rowAttr: (r) => 'class="row-link" data-act="entry:' + r[0].mono + '"',
      }) });
}

/* ===================================================================
   ปิดงวดบัญชี
   =================================================================== */
function scClose() {
  const chk = closeChecklist(STATE.period);
  const p = DB.periods.find((x) => x.code === STATE.period);
  const actMap = {
    depreciation: ['run:deprec', 'ตั้งค่าเสื่อมราคาเดี๋ยวนี้'],
    payroll: ['run:payroll', 'ทำเงินเดือนเดี๋ยวนี้'],
    vat: ['run:pp30', 'ยื่น ภ.พ.30 เดี๋ยวนี้'],
    bank: ['go:bank', 'ไปหน้ากระทบยอด'],
  };
  const rows = chk.items.map(function (i) {
    const a = i.action && actMap[i.action];
    return '<li><span class="dot ' + (i.ok ? 'good' : i.blocking ? 'bad' : 'warn') + '"></span>'
      + '<div><b>' + esc(i.label) + '</b><div class="dim">' + esc(i.detail) + '</div></div>'
      + '<span class="grow"></span>'
      + (i.ok ? '<span class="st paid">ผ่าน</span>' : (a ? btn(a[0], a[1], i.blocking ? 'primary' : '') : '<span class="st late">ยังไม่ผ่าน</span>'))
      + '</li>';
  }).join('');

  const closedList = DB.periods.filter((x) => x.status === 'closed');
  return card({
    title: 'ปิดงวดบัญชี ' + thPeriod(STATE.period),
    sub: p && p.status === 'closed' ? 'งวดนี้ปิดแล้ว — ลงรายการใหม่ไม่ได้' : 'ปิดงวดได้เมื่อรายการที่บล็อกผ่านครบ',
    actions: p && p.status === 'closed'
      ? btn('reopen:period', 'ขอเปิดงวดใหม่')
      : btn('close:period', 'ปิดงวดนี้', chk.canClose ? 'primary' : 'disabled'),
    body: '<ul class="todo big">' + rows + '</ul>',
    foot: p && p.status === 'closed'
      ? 'การเปิดงวดที่ปิดแล้วต้องระบุเหตุผล และระบบจะบันทึกไว้ในร่องรอยการตรวจสอบ'
      : (chk.canClose ? 'พร้อมปิดงวด — ตรวจครบทุกข้อแล้ว'
                      : 'ยังปิดไม่ได้: ' + chk.items.filter((i) => i.blocking && !i.ok).map((i) => i.label).join(' · ')),
  })
  + card({ title:'สถานะงวดทั้งปี', sub:'รอบบัญชี ' + DB.company.fiscalYear,
      body: '<div class="periods">' + DB.periods.map((x) =>
        '<button class="pchip ' + x.status + (x.code === STATE.period ? ' on' : '') + '" data-act="period:' + x.code + '">'
        + esc(thPeriod(x.code)) + '<span>' + (x.status === 'closed' ? 'ปิดแล้ว' : 'เปิดอยู่') + '</span></button>').join('')
        + '</div>',
      foot: 'ปิดแล้ว ' + closedList.length + ' งวด จาก ' + DB.periods.length + ' งวด' });
}

/* ===================================================================
   ขายและลูกหนี้
   =================================================================== */
function invoiceDetail(no) {
  const d = DB.docs.invoice.find((x) => x.no === no);
  if (!d) return '';
  const out = d.total - d.paid - d.credited;
  const rcs = DB.docs.receipt.filter((r) => r.invoiceNo === no);
  const cns = DB.docs.creditNote.filter((c) => c.invoiceNo === no);
  return card({
    title: 'ใบกำกับภาษี/ใบส่งของ เลขที่ ' + d.no,
    sub: 'ออกวันที่ ' + thDate(d.date) + ' · ครบกำหนด ' + thDate(d.due),
    actions: (out > 0 ? btn('pay:' + d.no, 'รับชำระเงิน', 'primary') : '')
      + (out > 0 ? btn('cn:' + d.no, 'ออกใบลดหนี้') : '')
      + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + btn('sel:', 'ปิด'),
    body:
      '<div class="docgrid">'
      + '<div><div class="dim">ผู้ขาย (ตามที่พิมพ์บนใบกำกับ)</div><b>' + esc(DB.company.name) + '</b>'
      + '<div>' + esc(DB.company.address) + '</div>'
      + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(DB.company.taxId) + ' · ' + esc(DB.company.branchName) + '</div></div>'
      + '<div><div class="dim">ผู้ซื้อ (ข้อมูล ณ วันที่ออกเอกสาร)</div><b>' + esc(d.snap.name) + '</b>'
      + '<div>' + esc(d.snap.address) + '</div>'
      + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(d.snap.taxId) + ' · สาขา ' + esc(d.snap.branch) + '</div></div>'
      + '</div>'
      + tbl({
          cols:[{t:'รายการ'},{t:'จำนวน',a:'r'},{t:'หน่วย'},{t:'ราคาต่อหน่วย',a:'r'},{t:'ภาษี'},{t:'จำนวนเงิน',a:'r'}],
          rows: d.lines.map((l) => [l.desc, {n:M(String(l.qty))}, l.uom || '—', {n:l.price},
            l.taxCode === 'VAT7' ? 'VAT 7%' : l.taxCode === 'VAT0' ? 'อัตรา 0%' : 'ยกเว้น', {n:l.amount}]),
        })
      + '<div class="totals">'
      + '<div><span>มูลค่าก่อนภาษี</span><b>' + fmt(d.base) + '</b></div>'
      + '<div><span>ภาษีมูลค่าเพิ่ม 7%</span><b>' + fmt(d.vat) + '</b></div>'
      + '<div class="gt"><span>จำนวนเงินรวมทั้งสิ้น</span><b>' + fmt(d.total) + '</b></div>'
      + (d.paid ? '<div><span>รับชำระแล้ว</span><b>' + fmt(d.paid) + '</b></div>' : '')
      + (d.credited ? '<div><span>ลดหนี้แล้ว</span><b>' + fmt(d.credited) + '</b></div>' : '')
      + '<div class="gt"><span>คงเหลือ</span><b>' + fmt(out) + '</b></div>'
      + '</div>'
      + (rcs.length ? '<div class="sub-h">ใบเสร็จรับเงินที่อ้างถึงใบนี้</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'รับก่อนหัก',a:'r'},{t:'ถูกหัก ณ ที่จ่าย',a:'r'},{t:'รับสุทธิ',a:'r'}],
          rows: rcs.map((r) => [{mono:r.no}, thDateNum(r.date), {n:r.gross}, {n:r.wht}, {n:r.net}]) }) : '')
      + (cns.length ? '<div class="sub-h">ใบลดหนี้ที่อ้างถึงใบนี้</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'เหตุผลตามมาตรา 86/10'},{t:'รวม',a:'r'}],
          rows: cns.map((c) => [{mono:c.no}, thDateNum(c.date), c.reasonText, {n:c.total}]) }) : ''),
    foot: 'ครบองค์ประกอบตามมาตรา 86/4 · ส่งกรมสรรพากรแบบ e-Tax Invoice แล้ว (จำลอง)',
  });
}

function scInvoices() {
  const rows = DB.docs.invoice.filter((d) =>
    periodOf(d.date) === STATE.period && (hit(d.no) || hit(d.partnerName)));
  const totals = rows.reduce((s, d) => ({ base:s.base + d.base, vat:s.vat + d.vat, total:s.total + d.total }), {base:0,vat:0,total:0});
  return (STATE.sel ? invoiceDetail(STATE.sel) : '')
    + card({
      title:'ใบกำกับภาษี', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' ฉบับ',
      actions: btn('new:invoice', '+ ออกใบกำกับภาษี', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาเลขที่หรือชื่อลูกค้า'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'ครบกำหนด'},{t:'ก่อนภาษี',a:'r'},{t:'ภาษี',a:'r'},{t:'รวม',a:'r'},{t:'คงเหลือ',a:'r'},{t:'สถานะ'}],
        rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, thDateNum(d.due),
          {n:d.base}, {n:d.vat}, {n:d.total}, {n:d.total - d.paid - d.credited}, statusPill(d.status)]),
        rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
        foot: ['รวม', '', '', '', {n:totals.base}, {n:totals.vat}, {n:totals.total}, '', ''],
        empty: 'ยังไม่มีใบกำกับภาษีในงวดนี้',
        emptyAction: btn('new:invoice', 'ออกใบกำกับภาษีใบแรก', 'primary'),
      }),
      foot: 'ระบบจองเลขที่เอกสารตอนลงบัญชีเท่านั้น เลขจึงเรียงต่อเนื่องไม่มีช่องว่าง',
    });
}

function scReceipts() {
  const rows = DB.docs.receipt.filter((d) => periodOf(d.date) === STATE.period && (hit(d.no) || hit(d.partnerName)));
  const t = rows.reduce((s, d) => ({g:s.g + d.gross, w:s.w + d.wht, n:s.n + d.net}), {g:0,w:0,n:0});
  return card({
    title:'ใบเสร็จรับเงิน', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' ฉบับ',
    filters: searchBox('ค้นหาเลขที่หรือชื่อลูกค้า'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'อ้างใบกำกับ'},{t:'วิธีรับ'},{t:'รับก่อนหัก',a:'r'},{t:'ลูกค้าหักไว้',a:'r'},{t:'รับสุทธิ',a:'r'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.invoiceNo},
        d.method === 'cash' ? 'เงินสด' : d.method === 'cheque' ? 'เช็ค' : 'โอนเงิน',
        {n:d.gross}, {n:d.wht}, {n:d.net}]),
      foot: ['รวม','','','','', {n:t.g}, {n:t.w}, {n:t.n}],
      empty:'ยังไม่มีการรับชำระในงวดนี้',
    }),
    foot: 'ภาษีที่ลูกค้าหักไว้บันทึกเป็นสินทรัพย์ (ภาษีถูกหัก ณ ที่จ่าย) รอนำไปเครดิตภาษีเงินได้นิติบุคคลปลายปี',
  });
}

function scCreditNotes() {
  const rows = DB.docs.creditNote.filter((d) => periodOf(d.date) === STATE.period);
  return card({
    title:'ใบลดหนี้', sub:'ออกได้เฉพาะเหตุตามมาตรา 86/10 และต้องอ้างใบกำกับเดิมเสมอ',
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'อ้างใบกำกับเดิม'},{t:'เหตุตามกฎหมาย'},{t:'มูลค่า',a:'r'},{t:'ภาษี',a:'r'},{t:'รวม',a:'r'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.invoiceNo},
        d.reasonText, {n:d.base}, {n:d.vat}, {n:d.total}]),
      empty:'ไม่มีใบลดหนี้ในงวดนี้',
    }),
    foot: 'ภาษีขายที่ลดลงจะเข้ารายงานภาษีขายเดือนที่ออกใบลดหนี้ ไม่ใช่เดือนของใบกำกับเดิม',
  });
}

function agingScreen(kind) {
  const to = pEnd();
  const a = aging(kind, to);
  const label = kind === 'ar' ? 'ลูกหนี้การค้า' : 'เจ้าหนี้การค้า';
  return card({
    title:'อายุ' + label, sub:'ณ วันที่ ' + thDate(to),
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อ'},{t:'ยังไม่ครบกำหนด',a:'r'},{t:'1–30 วัน',a:'r'},{t:'31–60 วัน',a:'r'},{t:'61–90 วัน',a:'r'},{t:'เกิน 90 วัน',a:'r'},{t:'รวม',a:'r'}],
      rows: a.rows.map((r) => [{mono:r.code}, r.name, {n:r.notDue}, {n:r.b30}, {n:r.b60}, {n:r.b90},
        {n:r.over, cls:r.over ? 'bad' : ''}, {n:r.total}]),
      foot: ['รวม','', {n:a.totals.notDue}, {n:a.totals.b30}, {n:a.totals.b60}, {n:a.totals.b90}, {n:a.totals.over}, {n:a.totals.total}],
      empty:'ไม่มียอดคงค้าง',
    }),
    foot: 'ยอดรวมคอลัมน์สุดท้ายต้องเท่ากับยอดบัญชีคุม' + label + 'ในงบทดลองเสมอ — ระบบตรวจให้ในหน้าแดชบอร์ด',
  });
}

function partnerScreen(kind) {
  const list = DB.partners.filter((p) => p.kind === kind && (hit(p.name) || hit(p.code) || hit(p.taxId)));
  const to = pEnd();
  const ag = aging(kind === 'customer' ? 'ar' : 'ap', to);
  const bal = {};
  ag.rows.forEach((r) => { bal[r.code] = r.total; });
  return card({
    title: kind === 'customer' ? 'ทะเบียนลูกค้า' : 'ทะเบียนผู้ขาย',
    sub: list.length + ' ราย · ข้อมูลนี้จะถูกคัดลอกลงเอกสารทุกใบ ณ วันที่ออก',
    filters: searchBox('ค้นหาชื่อ รหัส หรือเลขประจำตัวผู้เสียภาษี'),
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อ'},{t:'เลขประจำตัวผู้เสียภาษี'},{t:'สาขา'},{t:'ประเภท'},{t:'เครดิต (วัน)',a:'r'}]
        .concat(kind === 'vendor' ? [{t:'หัก ณ ที่จ่าย'}] : [])
        .concat([{t:'คงค้าง',a:'r'}]),
      rows: list.map((p) => [{mono:p.code}, p.name, {mono:p.taxId},
        p.branch === '00000' ? 'สำนักงานใหญ่' : (p.branch || '—'),
        p.entityType === 'individual' ? 'บุคคลธรรมดา' : 'นิติบุคคล',
        {c:String(p.termDays)}]
        .concat(kind === 'vendor' ? [p.whtCode ? resolveRate(p.whtCode, TODAY, {channel:'manual'}).label
          + ' ' + resolveRate(p.whtCode, TODAY, {channel:'manual'}).rate + '%' : '—'] : [])
        .concat([{n: bal[p.code] || 0}])),
      empty:'ไม่พบรายชื่อที่ค้นหา',
    }),
    foot: 'เลขประจำตัวผู้เสียภาษีทุกเลขผ่านการตรวจหลักที่ 13 แล้ว ระบบจะไม่ยอมออกใบกำกับให้เลขที่ผิด',
  });
}

/* ===================================================================
   ซื้อและเจ้าหนี้
   =================================================================== */
function billDetail(no) {
  const d = DB.docs.bill.find((x) => x.no === no);
  if (!d) return '';
  const out = d.total - d.paid;
  const pays = DB.docs.payment.filter((p) => p.billNo === no);
  return card({
    title:'ตั้งหนี้ผู้ขาย เลขที่ ' + d.no,
    sub:'ใบกำกับภาษีซื้อเลขที่ ' + d.vendorNo + ' · ' + d.partnerName,
    actions: (out > 0 ? btn('paybill:' + d.no, 'จ่ายชำระ', 'primary') : '')
      + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + btn('sel:', 'ปิด'),
    body: tbl({
      cols:[{t:'รายการ'},{t:'จำนวน',a:'r'},{t:'ราคาต่อหน่วย',a:'r'},{t:'จำนวนเงิน',a:'r'}],
      rows: d.lines.map((l) => [l.desc, {n:M(String(l.qty))}, {n:l.price}, {n:l.amount}]),
    })
    + '<div class="totals">'
    + '<div><span>มูลค่าก่อนภาษี</span><b>' + fmt(d.base) + '</b></div>'
    + '<div><span>ภาษีซื้อ' + (d.claimable ? ' (ขอคืนได้)' : ' (ต้องห้าม — บันทึกเป็นค่าใช้จ่าย)') + '</span><b>' + fmt(d.vat) + '</b></div>'
    + '<div class="gt"><span>รวมทั้งสิ้น</span><b>' + fmt(d.total) + '</b></div>'
    + '<div class="gt"><span>คงเหลือต้องจ่าย</span><b>' + fmt(out) + '</b></div></div>'
    + (pays.length ? '<div class="sub-h">ใบสำคัญจ่ายที่อ้างถึงรายการนี้</div>' + tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ช่องทาง'},{t:'ยอดก่อนหัก',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'50 ทวิ'}],
        rows: pays.map((p) => [{mono:p.no}, thDateNum(p.date),
          p.channel === 'e_wht' ? 'e-Withholding Tax' : 'โอน/เช็คเอง',
          {n:p.gross}, {n:p.wht}, {n:p.net},
          p.certNo ? {mono:p.certNo} : {dim:'ธนาคารออกให้'}]) }) : ''),
    foot: d.claimable
      ? 'ภาษีซื้อใบนี้เข้ารายงานภาษีซื้องวด ' + thPeriod(periodOf(d.date))
      : 'ภาษีซื้อต้องห้ามตามมาตรา 82/5 — ไม่นำไปหักในแบบ ภ.พ.30 และบันทึกเป็นค่าใช้จ่ายทันที',
  });
}

function scBills() {
  const rows = DB.docs.bill.filter((d) => periodOf(d.date) === STATE.period && (hit(d.no) || hit(d.partnerName) || hit(d.vendorNo)));
  const t = rows.reduce((s, d) => ({b:s.b + d.base, v:s.v + d.vat, t:s.t + d.total}), {b:0,v:0,t:0});
  return (STATE.sel ? billDetail(STATE.sel) : '')
    + card({
      title:'ตั้งหนี้ผู้ขาย', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' รายการ',
      actions: btn('new:bill', '+ บันทึกใบกำกับภาษีซื้อ', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาผู้ขายหรือเลขที่ใบกำกับ'),
      body: tbl({
        cols:[{t:'เลขที่ระบบ'},{t:'วันที่'},{t:'ผู้ขาย'},{t:'ใบกำกับผู้ขาย'},{t:'ครบกำหนด'},{t:'ก่อนภาษี',a:'r'},{t:'ภาษีซื้อ',a:'r'},{t:'รวม',a:'r'},{t:'คงเหลือ',a:'r'},{t:'สถานะ'}],
        rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.vendorNo}, thDateNum(d.due),
          {n:d.base}, {n:d.vat}, {n:d.total}, {n:d.total - d.paid}, statusPill(d.status)]),
        rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
        foot: ['รวม','','','','', {n:t.b}, {n:t.v}, {n:t.t}, '', ''],
        empty:'ยังไม่มีรายการซื้อในงวดนี้',
        emptyAction: btn('new:bill', 'บันทึกใบกำกับภาษีซื้อ', 'primary'),
      }),
      foot: 'ระบบกันการบันทึกเลขที่ใบกำกับซ้ำของผู้ขายรายเดียวกันไว้แล้ว',
    });
}

function scPayments() {
  const rows = DB.docs.payment.filter((d) => periodOf(d.date) === STATE.period);
  const t = rows.reduce((s, d) => ({g:s.g + d.gross, w:s.w + d.wht, n:s.n + d.net}), {g:0,w:0,n:0});
  const ewht = rows.filter((d) => d.channel === 'e_wht').length;
  return card({
    title:'ใบสำคัญจ่าย', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' รายการ'
      + (ewht ? ' (นำส่งผ่าน e-Withholding Tax ' + ewht + ' รายการ)' : ''),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้ขาย'},{t:'อ้างตั้งหนี้'},{t:'ช่องทาง'},{t:'ก่อนหัก',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'หนังสือรับรอง'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.billNo},
        d.channel === 'e_wht' ? {st:['open','e-Withholding']} : {st:['draft','หักเอง']},
        {n:d.gross}, {n:d.wht}, {n:d.net},
        d.certNo ? {mono:d.certNo} : (d.wht ? {dim:'ธนาคารออกให้'} : {dim:'—'})]),
      foot: ['รวม','','','','', {n:t.g}, {n:t.w}, {n:t.n}, ''],
      empty:'ยังไม่มีการจ่ายชำระในงวดนี้',
    }),
    foot: 'รายการที่นำส่งผ่าน e-Withholding Tax ธนาคารนำส่งและออกหลักฐานให้ ระบบจึงไม่ออก 50 ทวิ ซ้ำ และตัดออกจากแบบ ภ.ง.ด. โดยอัตโนมัติ',
  });
}

/* ===================================================================
   ธนาคารและเงินสด
   =================================================================== */
function scBank() {
  const unmatched = DB.bankTxns.filter((t) => !t.matched);
  const matched = DB.bankTxns.filter((t) => t.matched);
  const glBank = balBySub(['bank'], pEnd());
  const stmtDelta = unmatched.reduce((s, t) => s + t.credit - t.debit, 0);
  return card({
      title:'กระทบยอดธนาคาร', sub:'บัญชีกระแสรายวัน ธนาคารกรุงเทพ เลขที่ 123-4-56789-0',
      body: '<div class="reco">'
        + '<div><span>ยอดตามบัญชีแยกประเภท ณ ' + thDate(pEnd()) + '</span><b>' + fmt(glBank) + '</b></div>'
        + '<div><span>บวก/หัก รายการในสเตทเมนต์ที่ยังไม่ได้บันทึก</span><b>' + fmt(stmtDelta) + '</b></div>'
        + '<div class="gt"><span>ยอดที่ควรตรงกับสเตทเมนต์</span><b>' + fmt(glBank + stmtDelta) + '</b></div>'
        + '</div>'
        + '<div class="sub-h">รายการในสเตทเมนต์ที่ยังไม่มีในระบบ (' + unmatched.length + ')</div>'
        + tbl({
          cols:[{t:'วันที่'},{t:'รายละเอียดจากธนาคาร'},{t:'อ้างอิง'},{t:'เงินออก',a:'r'},{t:'เงินเข้า',a:'r'},{t:'ระบบแนะนำ'},{t:'จัดการ',a:'r'}],
          rows: unmatched.map((t) => [thDateNum(t.date), t.desc, {mono:t.ref}, {n:t.debit}, {n:t.credit},
            {dim:t.suggest}, {html: btn('bank:book:' + t.id, 'บันทึกเข้าบัญชี', 'primary') + btn('bank:match:' + t.id, 'ทำเครื่องหมายว่าตรงแล้ว')}]),
          empty:'กระทบยอดครบทุกรายการแล้ว',
        })
        + (matched.length ? '<div class="sub-h">กระทบยอดแล้ว (' + matched.length + ')</div>' + tbl({
            cols:[{t:'วันที่'},{t:'รายละเอียด'},{t:'เงินออก',a:'r'},{t:'เงินเข้า',a:'r'},{t:'จับคู่กับ'}],
            rows: matched.map((t) => [thDateNum(t.date), t.desc, {n:t.debit}, {n:t.credit}, {mono:t.matchedTo}]),
          }) : ''),
      foot:'การบันทึกจากสเตทเมนต์จะสร้างใบสำคัญทั่วไปให้ทันที และไม่มีทางแก้ตัวเลขย้อนหลังโดยไม่ทิ้งร่องรอย',
    });
}

function scCashFlow() {
  const cf = cashFlow(pStart(), pEnd());
  const sec = (title, amount, detail) => {
    const keys = Object.keys(detail).filter((k) => detail[k] !== 0)
      .sort((a, b) => Math.abs(detail[b]) - Math.abs(detail[a]));
    return '<tr class="fs-h2"><td colspan="2">' + esc(title) + '</td></tr>'
      + keys.map((k) => '<tr><td class="ind">' + esc(k) + '</td><td class="num' + (detail[k] < 0 ? ' neg' : '') + '">' + fmt(detail[k]) + '</td></tr>').join('')
      + '<tr class="fs-s"><td>เงินสดสุทธิจาก' + esc(title) + '</td><td class="num' + (amount < 0 ? ' neg' : '') + '">' + fmt(amount) + '</td></tr>';
  };
  return card({
    title:'งบกระแสเงินสด', sub: thPeriod(STATE.period) + ' · แสดงตามวิธีทางตรง',
    body: '<div class="scroll"><table class="fs"><tbody>'
      + '<tr class="fs-h"><td>เงินสดและรายการเทียบเท่าเงินสดต้นงวด</td><td class="num">' + fmt(cf.opening) + '</td></tr>'
      + sec('กิจกรรมดำเนินงาน', cf.operating, cf.detail.operating)
      + sec('กิจกรรมลงทุน', cf.investing, cf.detail.investing)
      + sec('กิจกรรมจัดหาเงิน', cf.financing, cf.detail.financing)
      + '<tr class="fs-s"><td>เงินสดเพิ่มขึ้น (ลดลง) สุทธิ</td><td class="num' + (cf.net < 0 ? ' neg' : '') + '">' + fmt(cf.net) + '</td></tr>'
      + '<tr class="fs-t"><td>เงินสดและรายการเทียบเท่าเงินสดปลายงวด</td><td class="num">' + fmt(cf.closing) + '</td></tr>'
      + '</tbody></table></div>',
    foot: cf.unexplained === 0
      ? 'ตรวจแล้ว: ต้นงวด + การเปลี่ยนแปลงสุทธิ = ปลายงวด พอดี ไม่มีส่วนที่อธิบายไม่ได้'
      : 'พบส่วนที่อธิบายไม่ได้ ' + fmt(cf.unexplained) + ' บาท',
  });
}

/* ===================================================================
   บัญชีแยกประเภท
   =================================================================== */
function scJournals() {
  const rows = DB.entries.filter((e) => periodOf(e.date) === STATE.period
    && (hit(e.no) || hit(e.desc))).slice().reverse();
  const open = STATE.sel;
  let h = '';
  if (open) {
    const e = DB.entries.find((x) => x.no === open);
    if (e) {
      h += card({
        title:'ใบสำคัญ ' + e.no, sub: thDate(e.date) + ' · ' + e.desc,
        actions: (e.status === 'posted' ? btn('rev:' + e.no, 'กลับรายการ') : '') + btn('sel:', 'ปิด'),
        body: tbl({
          cols:[{t:'#',a:'c'},{t:'รหัสบัญชี'},{t:'ชื่อบัญชี'},{t:'คู่ค้า'},{t:'คำอธิบาย'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'}],
          rows: e.lines.map((l) => [{c:String(l.n)}, {mono:l.acc}, acc(l.acc).name,
            l.partner ? l.partner : {dim:'—'}, l.memo || '', {n:l.dr}, {n:l.cr}]),
          foot: ['','','','','รวม', {n:e.total}, {n:e.total}],
        }),
        foot: e.status === 'reversed'
          ? 'รายการนี้ถูกกลับด้วย ' + e.reversedBy + ' — เหตุผล: ' + (e.reason || '')
          : 'ใบสำคัญที่ลงบัญชีแล้วแก้ไม่ได้ ถ้าผิดต้องกลับรายการเท่านั้น (พ.ร.บ.การบัญชี 2543 มาตรา 20)',
      });
    }
  }
  return h + card({
    title:'สมุดรายวัน', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' ใบสำคัญ',
    filters: searchBox('ค้นหาเลขที่หรือคำอธิบาย'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ประเภท'},{t:'คำอธิบาย'},{t:'ที่มา'},{t:'ยอด',a:'r'},{t:'สถานะ'}],
      rows: rows.map((e) => [{mono:e.no}, thDateNum(e.date), JE_TYPE[e.type] || e.type, e.desc,
        e.srcId ? {mono:e.srcId} : {dim:'—'}, {n:e.total}, statusPill(e.status)]),
      rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
      empty:'ไม่มีใบสำคัญในงวดนี้',
    }),
  });
}
const JE_TYPE = { sales:'ขาย', purchase:'ซื้อ', receipt:'รับเงิน', payment:'จ่ายเงิน',
  general:'ทั่วไป', adjustment:'ปรับปรุง', payroll:'เงินเดือน', asset:'ทรัพย์สิน',
  inventory:'สินค้า', opening:'ยอดยกมา', closing:'ปิดบัญชี' };

function scLedger() {
  const code = STATE.drill || accBySub('bank');
  const a = acc(code);
  const from = pStart(), to = pEnd();
  let bal = balanceOf(code, addDays(from, -1));
  const opening = bal;
  const rows = [];
  DB.entries.filter((e) => LIVE(e) && e.date >= from && e.date <= to)
    .slice().sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0))
    .forEach(function (e) {
      e.lines.forEach(function (l) {
        if (l.acc !== code) return;
        bal += l.dr - l.cr;
        rows.push([thDateNum(e.date), {mono:e.no}, e.desc, l.partner || '', {n:l.dr}, {n:l.cr}, {n:bal}]);
      });
    });
  const opts = DB.accounts.filter((x) => x.postable)
    .map((x) => '<option value="' + x.code + '"' + (x.code === code ? ' selected' : '') + '>'
      + esc(x.code + ' ' + x.name) + '</option>').join('');
  return card({
    title:'บัญชีแยกประเภท', sub: a.code + ' ' + a.name + ' · ' + thPeriod(STATE.period),
    filters: '<select id="accSel" class="search">' + opts + '</select>',
    body: '<div class="reco"><div><span>ยอดยกมา</span><b>' + fmt(opening) + '</b></div>'
      + '<div class="gt"><span>ยอดยกไป</span><b>' + fmt(bal) + '</b></div></div>'
      + tbl({
        cols:[{t:'วันที่'},{t:'ใบสำคัญ'},{t:'คำอธิบาย'},{t:'คู่ค้า'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'คงเหลือ',a:'r'}],
        rows: rows,
        empty:'บัญชีนี้ไม่มีความเคลื่อนไหวในงวดนี้',
      }),
    foot:'ยอดคงเหลือแสดงเป็นเดบิตเป็นบวก เครดิตเป็นลบ ตามหลักการบันทึกสองด้าน',
  });
}

function scTrialBalance() {
  const tb = trialBalance(pStart(), pEnd());
  return card({
    title:'งบทดลอง', sub: thPeriod(STATE.period) + ' · ' + tb.rows.length + ' บัญชีที่มีความเคลื่อนไหว',
    actions: btn('print', 'พิมพ์'),
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อบัญชี'},{t:'ยอดยกมา',a:'r'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'ยอดยกไป',a:'r'}],
      rows: tb.rows.map((r) => [{mono:r.code}, r.name, {n:r.opening}, {n:r.dr}, {n:r.cr}, {n:r.closing}]),
      rowAttr: (r) => 'class="row-link" data-act="drill:' + r[0].mono + '"',
      foot: ['','รวม','', {n:tb.totalDr}, {n:tb.totalCr}, ''],
    }),
    foot: tb.balanced ? 'เดบิตรวมเท่ากับเครดิตรวมพอดี — คลิกบรรทัดใดก็ได้เพื่อเจาะดูบัญชีแยกประเภท'
                      : 'ไม่สมดุล ต่างกัน ' + fmt(tb.totalDr - tb.totalCr) + ' บาท',
  });
}

function scCoa() {
  const to = pEnd();
  const TYPE_TH = { asset:'สินทรัพย์', liability:'หนี้สิน', equity:'ส่วนของผู้ถือหุ้น', revenue:'รายได้', expense:'ค่าใช้จ่าย' };
  const order = ['asset','liability','equity','revenue','expense'];
  let body = '';
  order.forEach(function (t) {
    const list = DB.accounts.filter((a) => a.type === t && (hit(a.code) || hit(a.name)));
    if (!list.length) return;
    body += '<div class="sub-h">' + TYPE_TH[t] + ' — ' + list.length + ' บัญชี</div>'
      + tbl({
        cols:[{t:'รหัส'},{t:'ชื่อบัญชี'},{t:'ประเภทย่อยที่ระบบใช้ผูก'},{t:'ลงรายการได้'},{t:'ยอด ณ ' + thDateNum(to),a:'r'}],
        rows: list.map((a) => [{mono:a.code}, (a.postable ? '' : '▸ ') + a.name, {dim:a.subType},
          a.postable ? {c:'ได้'} : {dim:'หัวข้อ'}, {n: a.postable ? balanceOf(a.code, to) : 0}]),
        rowAttr: (r, i) => (list[i].postable ? 'class="row-link" data-act="drill:' + list[i].code + '"' : ''),
      });
  });
  return card({
    title:'ผังบัญชี', sub: DB.accounts.length + ' บัญชี ครบทั้ง 5 หมวดตามที่กรมพัฒนาธุรกิจการค้ากำหนด',
    filters: searchBox('ค้นหารหัสหรือชื่อบัญชี'),
    body: body || '<div class="empty">ไม่พบบัญชีที่ค้นหา</div>',
    foot:'คอลัมน์ "ประเภทย่อย" คือกุญแจที่ระบบใช้เลือกบัญชีอัตโนมัติเวลาออกเอกสาร ทำให้เปลี่ยนรหัสบัญชีได้โดยไม่ต้องแก้โค้ด',
  });
}

/* ===================================================================
   ภาษี
   =================================================================== */
function nextMonthDay(period, day) {
  let [y, m] = period.split('-').map(Number);
  m += 1; if (m > 12) { m = 1; y += 1; }
  return y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function vatRegister(kind) {
  const isOut = kind === 'vat_output';
  const rows = DB.taxTx.filter((t) => t.kind === kind && t.period === STATE.period);
  const base = rows.reduce((s, t) => s + t.base, 0);
  const tax  = rows.reduce((s, t) => s + t.tax, 0);
  const nonClaim = rows.reduce((s, t) => s + (t.nonClaimable || 0), 0);
  return card({
    title: isOut ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ',
    sub: thPeriod(STATE.period) + ' · ' + rows.length + ' รายการ · '
      + (isOut ? 'ตามมาตรา 87 (1)' : 'ตามมาตรา 87 (2)'),
    actions: btn('print', 'พิมพ์'),
    body: tbl({
      cols:[{t:'ลำดับ',a:'c'},{t:'วันที่'},{t:'เลขที่ใบกำกับ'},{t:'ชื่อผู้' + (isOut ? 'ซื้อ' : 'ขาย')},
        {t:'เลขประจำตัวผู้เสียภาษี'},{t:'สาขา'},{t:'มูลค่า',a:'r'},{t:'ภาษี',a:'r'}]
        .concat(isOut ? [] : [{t:'หมายเหตุ'}]),
      rows: rows.map((t, i) => [{c:String(i + 1)}, thDateNum(t.date), {mono:t.docNo},
        t.partnerName + (t.docType === 'credit_note' ? ' (ใบลดหนี้อ้าง ' + t.refDoc + ')' : ''),
        {mono:t.taxId}, t.branch === '00000' ? 'สนญ.' : (t.branch || '—'),
        {n:t.base}, {n:t.tax}]
        .concat(isOut ? [] : [t.nonClaimable ? {dim:'ภาษีต้องห้าม ' + fmt(t.nonClaimable)} : {dim:'ขอคืนได้'}])),
      foot: ['','','','รวม','','', {n:base}, {n:tax}].concat(isOut ? [] : ['']),
      empty:'ไม่มีรายการในงวดนี้',
    }),
    foot: isOut
      ? 'ยอดนี้ต้องตรงกับบัญชีภาษีขายในงบทดลองเสมอ ระบบตรวจให้ทุกครั้งในหน้าแดชบอร์ด'
      : (nonClaim ? 'มีภาษีซื้อต้องห้าม ' + fmt(nonClaim) + ' บาท ที่ไม่นำไปหักในแบบ ภ.พ.30 และบันทึกเป็นค่าใช้จ่ายแล้ว'
                  : 'ภาษีซื้อทั้งหมดในงวดนี้ขอคืนได้'),
  });
}

function scPp30() {
  const f = DB.docs.filing.find((x) => x.form === 'PP30' && x.period === STATE.period);
  const out = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === STATE.period);
  const inn = DB.taxTx.filter((t) => t.kind === 'vat_input' && t.period === STATE.period);
  const outTax = f ? f.outTax : out.reduce((s, t) => s + t.tax, 0);
  const inTax  = f ? f.inTax  : inn.reduce((s, t) => s + t.tax, 0);
  const outBase = f ? f.outBase : out.reduce((s, t) => s + t.base, 0);
  const inBase  = f ? f.inBase  : inn.reduce((s, t) => s + t.base, 0);
  const payable = outTax - inTax;
  const due = nextMonthDay(STATE.period, 15);
  const dueE = nextMonthDay(STATE.period, 23);

  const line = (n, label, v, cls) =>
    '<tr class="' + (cls || '') + '"><td class="ctr dim">' + n + '</td><td>' + esc(label)
    + '</td><td class="num' + (v < 0 ? ' neg' : '') + '">' + fmt(v) + '</td></tr>';

  return card({
    title:'แบบแสดงรายการภาษีมูลค่าเพิ่ม ภ.พ.30',
    sub:'ประจำเดือน ' + thPeriod(STATE.period) + ' · ' + DB.company.name + ' · สำนักงานใหญ่',
    actions: f ? btn('print', 'พิมพ์แบบ')
               : btn('run:pp30', 'ยื่นแบบและปิดภาษีงวดนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: '<div class="scroll"><table class="fs"><tbody>'
      + '<tr class="fs-h"><td colspan="3">ยอดขายและภาษีขาย</td></tr>'
      + line(1, 'ยอดขายในเดือนนี้', outBase + (f ? f.outZero : 0))
      + line(2, 'ยอดขายที่เสียภาษีอัตราร้อยละ 0', f ? f.outZero : 0)
      + line(4, 'ยอดขายที่ต้องเสียภาษี', outBase)
      + line(5, 'ภาษีขายเดือนนี้', outTax, 'fs-s')
      + '<tr class="fs-h"><td colspan="3">ยอดซื้อและภาษีซื้อ</td></tr>'
      + line(6, 'ยอดซื้อที่มีสิทธินำภาษีซื้อมาหัก', inBase)
      + line(7, 'ภาษีซื้อเดือนนี้', inTax, 'fs-s')
      + '<tr class="fs-h"><td colspan="3">การคำนวณภาษี</td></tr>'
      + (payable >= 0
          ? line(8, 'ภาษีที่ต้องชำระ', payable, 'fs-t')
          : line(9, 'ภาษีที่ชำระเกิน (ยกไปเครดิตเดือนถัดไป)', -payable, 'fs-t'))
      + '</tbody></table></div>'
      + '<div class="reco">'
      + '<div><span>กำหนดยื่นแบบกระดาษ</span><b>' + thDate(due) + '</b></div>'
      + '<div><span>กำหนดยื่นผ่านอินเทอร์เน็ต (ขยาย 8 วัน)</span><b>' + thDate(dueE) + '</b></div>'
      + (f ? '<div class="gt"><span>สถานะ</span><b>ยื่นแล้วเมื่อ ' + thDate(f.filedDate) + ' · ใบสำคัญ ' + f.entryNo + '</b></div>'
           : '<div class="gt"><span>สถานะ</span><b>ยังไม่ได้ยื่น</b></div>')
      + '</div>',
    foot:'เมื่อยื่นแบบ ระบบจะปิดบัญชีภาษีขายและภาษีซื้อของงวดเป็นศูนย์ แล้วตั้งเป็นภาษีค้างชำระหรือภาษีขอคืน ตามผลการคำนวณ',
  });
}

function scPnd() {
  const forms = [
    ['PND1', 'ภ.ง.ด.1', 'ภาษีหัก ณ ที่จ่ายจากเงินเดือนและค่าจ้าง มาตรา 40(1)'],
    ['PND3', 'ภ.ง.ด.3', 'ผู้รับเงินเป็นบุคคลธรรมดา'],
    ['PND53', 'ภ.ง.ด.53', 'ผู้รับเงินเป็นนิติบุคคล'],
  ];
  let body = '';
  forms.forEach(function (F) {
    const filed = DB.docs.filing.find((x) => x.form === F[0] && x.period === STATE.period);
    const rows = DB.taxTx.filter((t) => t.kind === 'wht' && t.period === STATE.period
      && t.form === F[0] && t.channel === 'manual');
    const excl = DB.taxTx.filter((t) => t.kind === 'wht' && t.period === STATE.period
      && t.form === F[0] && t.channel === 'e_wht');
    const total = rows.reduce((s, t) => s + t.tax, 0);
    body += '<div class="sub-h">' + F[1] + ' — ' + F[2]
      + '<span class="grow"></span>'
      + (filed ? '<span class="st paid">ยื่นแล้ว ' + thDateNum(filed.filedDate) + '</span>'
               : (rows.length ? btn('run:pnd:' + F[0], 'ยื่น ' + F[1], periodIsOpen() ? 'primary' : 'disabled')
                              : '<span class="st draft">ไม่มีรายการต้องยื่น</span>'))
      + '</div>'
      + tbl({
        cols:[{t:'วันที่'},{t:'ผู้รับเงิน'},{t:'เลขประจำตัวผู้เสียภาษี'},{t:'ประเภทเงินได้'},{t:'อัตรา',a:'r'},{t:'ฐานภาษี',a:'r'},{t:'ภาษีที่หัก',a:'r'}],
        rows: rows.map((t) => [thDateNum(t.date), t.partnerName, t.taxId ? {mono:t.taxId} : {dim:'—'},
          t.incomeType, t.rate ? {c:t.rate + '%'} : {dim:'ตามขั้น'}, {n:t.base}, {n:t.tax}]),
        foot: ['','','','','รวม', '', {n:total}],
        empty:'ไม่มีรายการที่ต้องยื่นในแบบนี้',
      })
      + (excl.length ? '<div class="note">กันออกจากแบบนี้ ' + excl.length + ' รายการ รวม '
          + fmt(excl.reduce((s, t) => s + t.tax, 0))
          + ' บาท เพราะนำส่งผ่าน e-Withholding Tax แล้ว ธนาคารเป็นผู้นำส่งและออกหลักฐานให้</div>' : '');
  });
  return card({
    title:'แบบภาษีหัก ณ ที่จ่าย', sub: thPeriod(STATE.period) + ' · กำหนดยื่นภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ถึงวันที่ 15)',
    body: body,
    foot:'ระบบแยกช่องทางการนำส่งไว้ตั้งแต่ตอนจ่ายเงิน จึงไม่มีทางนำส่งซ้ำหรือออกหนังสือรับรองซ้ำ',
  });
}

function scWhtCert() {
  const rows = DB.docs.whtCert.filter((c) => periodOf(c.date) === STATE.period);
  return card({
    title:'หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)',
    sub: thPeriod(STATE.period) + ' · ' + rows.length + ' ฉบับ',
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้ถูกหักภาษี'},{t:'เลขประจำตัวผู้เสียภาษี'},{t:'ยื่นในแบบ'},{t:'ประเภทเงินได้'},{t:'อัตรา',a:'r'},{t:'ฐานภาษี',a:'r'},{t:'ภาษีที่หัก',a:'r'}],
      rows: rows.map((c) => [{mono:c.no}, thDateNum(c.date), c.partnerName, {mono:c.taxId},
        c.form, c.incomeType, {c:c.rate + '%'}, {n:c.base}, {n:c.wht}]),
      foot: ['','','','','','','รวม', '', {n:rows.reduce((s, c) => s + c.wht, 0)}],
      empty:'ไม่มีหนังสือรับรองที่ต้องออกในงวดนี้',
    }),
    foot:'ออกให้เฉพาะกรณีที่บริษัทหักและนำส่งเอง — กรณี e-Withholding Tax ธนาคารเป็นผู้ออกหลักฐานให้ผู้รับเงินโดยตรง',
  });
}

function scTaxCal() {
  const p = STATE.period;
  const items = [
    ['ภ.ง.ด.1', 'นำส่งภาษีหัก ณ ที่จ่ายจากเงินเดือน', nextMonthDay(p, 7), nextMonthDay(p, 15)],
    ['ภ.ง.ด.3', 'นำส่งภาษีหัก ณ ที่จ่าย ผู้รับเป็นบุคคลธรรมดา', nextMonthDay(p, 7), nextMonthDay(p, 15)],
    ['ภ.ง.ด.53', 'นำส่งภาษีหัก ณ ที่จ่าย ผู้รับเป็นนิติบุคคล', nextMonthDay(p, 7), nextMonthDay(p, 15)],
    ['ภ.พ.30', 'ยื่นแบบภาษีมูลค่าเพิ่มประจำเดือน', nextMonthDay(p, 15), nextMonthDay(p, 23)],
    ['เงินสมทบประกันสังคม', 'นำส่งเงินสมทบผู้ประกันตนมาตรา 33', nextMonthDay(p, 15), nextMonthDay(p, 15)],
  ];
  const annual = [
    ['ภ.ง.ด.51', 'ประมาณการกำไรสุทธิครึ่งรอบบัญชี — ประมาณต่ำกว่าจริงเกินร้อยละ 25 มีเงินเพิ่มร้อยละ 20', '2026-08-31'],
    ['ภ.ง.ด.50', 'แบบแสดงรายการภาษีเงินได้นิติบุคคลประจำปี ภายใน 150 วันนับแต่วันสิ้นรอบบัญชี', '2027-05-30'],
    ['งบการเงิน (DBD e-Filing)', 'นำส่งงบการเงินต่อกรมพัฒนาธุรกิจการค้าภายใน 5 เดือน', '2027-05-31'],
    ['บอจ.5', 'สำเนาบัญชีรายชื่อผู้ถือหุ้น ภายใน 14 วันนับแต่วันประชุมสามัญ', '2027-05-14'],
  ];
  const status = (form) => {
    const map = { 'ภ.ง.ด.1':'PND1', 'ภ.ง.ด.3':'PND3', 'ภ.ง.ด.53':'PND53', 'ภ.พ.30':'PP30' };
    const k = map[form];
    if (!k) return {dim:'ทำนอกระบบ'};
    return DB.docs.filing.find((f) => f.form === k && f.period === p)
      ? {st:['paid','ยื่นแล้ว']} : {st:['wait','ยังไม่ยื่น']};
  };
  return card({
    title:'ปฏิทินภาษีและการนำส่ง', sub:'อ้างอิงงวด ' + thPeriod(p),
    body: '<div class="sub-h">รายเดือน</div>'
      + tbl({
        cols:[{t:'แบบ'},{t:'เรื่อง'},{t:'ยื่นกระดาษภายใน'},{t:'ยื่นออนไลน์ภายใน'},{t:'สถานะ'}],
        rows: items.map((i) => [i[0], i[1], thDate(i[2]), thDate(i[3]), status(i[0])]),
      })
      + '<div class="sub-h">รายปีของรอบบัญชี ' + DB.company.fiscalYear + '</div>'
      + tbl({
        cols:[{t:'แบบ'},{t:'เรื่อง'},{t:'กำหนดภายใน'}],
        rows: annual.map((i) => [i[0], i[1], thDate(i[2])]),
      }),
    foot:'วันครบกำหนดที่ตรงวันหยุดราชการให้เลื่อนเป็นวันทำการถัดไป ระบบเก็บปฏิทินวันหยุดธนาคารไว้แล้วในฐานข้อมูลเต็ม',
  });
}

/* ===================================================================
   สินค้าคงคลัง
   =================================================================== */
function scItems() {
  const list = DB.items.filter((i) => hit(i.code) || hit(i.name) || hit(i.category));
  const value = DB.items.reduce((s, i) => s + (i.type === 'stock' ? i.value : 0), 0);
  const glInv = balBySub(['inventory'], pEnd());
  const low = DB.items.filter((i) => i.type === 'stock' && i.qty <= i.reorder);
  return card({
    title:'ทะเบียนสินค้า', sub: DB.items.length + ' รายการ · ตีราคาด้วยวิธีถัวเฉลี่ยถ่วงน้ำหนัก',
    filters: searchBox('ค้นหารหัส ชื่อ หรือหมวดสินค้า'),
    body: (low.length ? '<div class="note warn">ต่ำกว่าจุดสั่งซื้อ ' + low.length + ' รายการ: '
        + esc(low.map((i) => i.code).join(', ')) + '</div>' : '')
      + tbl({
        cols:[{t:'รหัส'},{t:'ชื่อสินค้า'},{t:'หมวด'},{t:'หน่วย'},{t:'ประเภท'},{t:'คงเหลือ',a:'r'},{t:'จุดสั่งซื้อ',a:'r'},{t:'ต้นทุนเฉลี่ย',a:'r'},{t:'ราคาขาย',a:'r'},{t:'มูลค่าคงเหลือ',a:'r'}],
        rows: list.map((i) => [{mono:i.code}, i.name, i.category, i.uom,
          i.type === 'stock' ? 'สินค้า' : {dim:'บริการ'},
          i.type === 'stock' ? {n:M(String(i.qty)), cls: i.qty <= i.reorder ? 'bad' : ''} : {dim:'—'},
          i.type === 'stock' ? {n:M(String(i.reorder))} : {dim:'—'},
          {n:i.avgCost}, {n:i.price}, {n:i.value}]),
        foot: ['','','','','','','','','รวมมูลค่าสินค้าคงเหลือ', {n:value}],
      })
      + '<div class="reco"><div><span>มูลค่าตามทะเบียนสินค้า</span><b>' + fmt(value) + '</b></div>'
      + '<div><span>ยอดบัญชีสินค้าคงเหลือในงบทดลอง</span><b>' + fmt(glInv) + '</b></div>'
      + '<div class="gt"><span>ผลต่าง</span><b>' + fmt(value - glInv) + '</b></div></div>',
    foot: value === glInv ? 'ทะเบียนสินค้าตรงกับบัญชีคุมพอดี'
      : 'ผลต่างเกิดจากยอดยกมาต้นงวดที่ยังไม่ได้แยกรายตัวสินค้า — ตรวจสอบก่อนปิดปี',
  });
}

function scStockMoves() {
  const rows = DB.docs.stockMove.filter((m) => periodOf(m.date) === STATE.period && (hit(m.item) || hit(m.src)))
    .slice().reverse();
  const inQ  = rows.filter((m) => m.dir === 'in').reduce((s, m) => s + m.cost, 0);
  const outQ = rows.filter((m) => m.dir === 'out').reduce((s, m) => s + m.cost, 0);
  return card({
    title:'ความเคลื่อนไหวสินค้า', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' รายการ',
    filters: searchBox('ค้นหารหัสสินค้าหรือเลขที่เอกสาร'),
    body: tbl({
      cols:[{t:'วันที่'},{t:'สินค้า'},{t:'ทิศทาง'},{t:'จำนวน',a:'r'},{t:'มูลค่าต้นทุน',a:'r'},{t:'คงเหลือหลังรายการ',a:'r'},{t:'เอกสารอ้างอิง'}],
      rows: rows.map((m) => [thDateNum(m.date),
        m.item + ' ' + ((DB.items.find((i) => i.code === m.item) || {}).name || ''),
        m.dir === 'in' ? {st:['paid','รับเข้า']} : {st:['wait','จ่ายออก']},
        {n:M(String(m.qty))}, {n:m.cost}, {n:M(String(m.balance))}, {mono:m.src}]),
      foot: ['','','','รวมรับเข้า', {n:inQ}, {n:outQ}, 'รวมจ่ายออก'],
      empty:'ไม่มีความเคลื่อนไหวในงวดนี้',
    }),
    foot:'ทุกครั้งที่ออกใบกำกับภาษีที่มีสินค้า ระบบตัดสต๊อกและลงต้นทุนขายให้ในชุดเดียวกัน ไม่มีทางลืม',
  });
}

/* ===================================================================
   สินทรัพย์ถาวร
   =================================================================== */
function scAssets() {
  const rows = DB.assets.filter((a) => hit(a.code) || hit(a.name));
  const cost = DB.assets.reduce((s, a) => s + a.cost, 0);
  const accum = DB.assets.reduce((s, a) => s + a.accumBook, 0);
  return card({
    title:'ทะเบียนทรัพย์สิน', sub: DB.assets.length + ' รายการ · แยกค่าเสื่อมทางบัญชีและทางภาษีคนละชุด',
    filters: searchBox('ค้นหารหัสหรือชื่อทรัพย์สิน'),
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อทรัพย์สิน'},{t:'ประเภทตามพระราชกฤษฎีกา 145'},{t:'วันเริ่มใช้'},{t:'ราคาทุน',a:'r'},
        {t:'อายุบัญชี (ปี)',a:'r'},{t:'ค่าเสื่อมสะสม (บัญชี)',a:'r'},{t:'ราคาตามบัญชี',a:'r'},{t:'ค่าเสื่อมสะสม (ภาษี)',a:'r'}],
      rows: rows.map(function (a) {
        const t = TAX_DEPRECIATION[a.class];
        const capped = t.costCap && a.cost > t.costCap;
        return [{mono:a.code}, a.name,
          t.label + ' ' + (t.rate ? t.rate + '%' : '') + (capped ? ' · จำกัดต้นทุน 1,000,000' : ''),
          thDateNum(a.inService), {n:a.cost}, {c:String(a.bookYears)},
          {n:a.accumBook}, {n:a.cost - a.accumBook}, {n:a.accumTax}];
      }),
      foot: ['','','','รวม', {n:cost}, '', {n:accum}, {n:cost - accum}, {n:DB.assets.reduce((s,a)=>s+a.accumTax,0)}],
    }),
    foot:'รถยนต์นั่งไม่เกิน 10 คน หักค่าเสื่อมทางภาษีได้จากต้นทุนไม่เกิน 1,000,000 บาท ส่วนที่เกินหักทางบัญชีได้แต่บวกกลับตอนคำนวณภาษี',
  });
}

function scDeprec() {
  const run = DB.docs.depreciation.find((d) => d.period === STATE.period);
  const history = DB.docs.depreciation.slice(0, 12);
  return card({
    title:'ค่าเสื่อมราคาประจำงวด', sub: thPeriod(STATE.period),
    actions: run ? btn('entry:' + run.entryNo, 'ดูใบสำคัญ')
                 : btn('run:deprec', 'ตั้งค่าเสื่อมราคางวดนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: run
      ? tbl({
          cols:[{t:'รหัส'},{t:'ทรัพย์สิน'},{t:'ราคาทุน',a:'r'},{t:'ค่าเสื่อมทางบัญชี',a:'r'},{t:'ค่าเสื่อมทางภาษี',a:'r'},{t:'ผลต่าง',a:'r'},{t:'ราคาตามบัญชีคงเหลือ',a:'r'}],
          rows: run.rows.map((r) => [{mono:r.code}, r.name, {n:r.cost}, {n:r.book}, {n:r.tax}, {n:r.diff}, {n:r.nbvBook}]),
          foot: ['','','รวม', {n:run.bookTotal}, {n:run.taxTotal}, {n:run.diff}, ''],
        })
      : '<div class="empty">ยังไม่ได้ตั้งค่าเสื่อมราคางวดนี้ — เป็นรายการที่บล็อกการปิดงวด'
        + '<div style="margin-top:12px">' + btn('run:deprec', 'ตั้งค่าเสื่อมราคาเดี๋ยวนี้', 'primary') + '</div></div>',
    foot: (run && run.diff !== 0
        ? 'ผลต่างระหว่างบัญชีกับภาษี ' + fmt(run.diff) + ' บาทในงวดนี้ ต้องนำไปปรับปรุงในแบบ ภ.ง.ด.50 ปลายปี'
        : 'ผลต่างบัญชี–ภาษีจะถูกสะสมไว้ให้ตลอดปีเพื่อใช้กรอกแบบ ภ.ง.ด.50')
      + (history.length ? ' · ตั้งค่าเสื่อมมาแล้ว ' + history.length + ' งวด' : ''),
  });
}

/* ===================================================================
   เงินเดือน
   =================================================================== */
function scPayroll() {
  const run = DB.docs.payRun.find((r) => r.period === STATE.period);
  return card({
    title:'งวดจ่ายเงินเดือน', sub: thPeriod(STATE.period),
    actions: run ? btn('entry:' + run.entryNo, 'ดูใบสำคัญ')
                 : btn('run:payroll', 'ทำเงินเดือนงวดนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: run
      ? kpi([
          { label:'พนักงาน', value: run.count + ' คน' },
          { label:'เงินได้รวม', value: fmt(run.gross) },
          { label:'ภาษีหัก ณ ที่จ่าย', value: fmt(run.pit), sub:'นำส่งในแบบ ภ.ง.ด.1' },
          { label:'ประกันสังคมนำส่ง', value: fmt(run.ssoEmp + run.ssoEr), sub:'ลูกจ้าง+นายจ้าง ฝ่ายละ ' + fmt(run.ssoEmp) },
          { label:'จ่ายสุทธิ', value: fmt(run.net) },
        ])
        + tbl({
          cols:[{t:'รหัส'},{t:'ชื่อ'},{t:'แผนก'},{t:'เงินเดือน',a:'r'},{t:'ค่าล่วงเวลา',a:'r'},{t:'รวมเงินได้',a:'r'},
            {t:'ภาษีหัก',a:'r'},{t:'ประกันสังคม',a:'r'},{t:'กองทุนสำรองฯ',a:'r'},{t:'รับสุทธิ',a:'r'}],
          rows: run.slips.map((s) => [{mono:s.code}, s.name, s.dept, {n:s.salary}, {n:s.ot}, {n:s.gross},
            {n:s.pit}, {n:s.sso}, {n:s.pvd}, {n:s.net}]),
          foot: ['','','รวม', {n:run.gross - run.slips.reduce((a,s)=>a+s.ot,0)},
            {n:run.slips.reduce((a,s)=>a+s.ot,0)}, {n:run.gross}, {n:run.pit}, {n:run.ssoEmp}, {n:run.pvdEmp}, {n:run.net}],
        })
      : '<div class="empty">ยังไม่ได้ทำเงินเดือนงวดนี้'
        + '<div style="margin-top:12px">' + btn('run:payroll', 'ทำเงินเดือนเดี๋ยวนี้', 'primary') + '</div></div>',
    foot: run
      ? 'ฐานค่าจ้างประกันสังคมสูงสุด ' + fmt(run.ssoCeiling) + ' บาท เงินสมทบสูงสุด ' + fmt(run.ssoMax)
        + ' บาทต่อคนต่อเดือน (มีผลตั้งแต่ 1 มกราคม 2569) — ระบบเลือกอัตราตามวันที่จ่ายเงิน ไม่ใช่วันที่ทำรายการ'
      : 'ภาษีหัก ณ ที่จ่ายคำนวณจากเงินได้ทั้งปีตามอัตราก้าวหน้าแล้วเฉลี่ยเป็นรายเดือน ตามวิธีของกรมสรรพากร',
  });
}

function scEmployees() {
  const list = DB.employees.filter((e) => hit(e.code) || hit(e.name) || hit(e.dept));
  const sso = ssoRate(pEnd());
  return card({
    title:'ทะเบียนพนักงาน', sub: DB.employees.filter((e) => e.active).length + ' คนที่ยังทำงานอยู่',
    filters: searchBox('ค้นหาชื่อ รหัส หรือแผนก'),
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อ-สกุล'},{t:'แผนก'},{t:'วันเริ่มงาน'},{t:'เงินเดือน',a:'r'},{t:'ชั่วโมงล่วงเวลา',a:'r'},
        {t:'กองทุนสำรองฯ',a:'r'},{t:'ฐานประกันสังคม',a:'r'},{t:'สถานะ'}],
      rows: list.map((e) => [{mono:e.code}, e.name, e.dept, thDateNum(e.hired), {n:e.salary},
        e.otHours ? {c:String(e.otHours)} : {dim:'—'},
        e.pvdRate ? {c:e.pvdRate + '%'} : {dim:'ไม่เข้าร่วม'},
        {n: Math.min(Math.max(e.salary, sso.floor), sso.ceiling)},
        e.active ? {st:['paid','ทำงานอยู่']} : {st:['late','พ้นสภาพ']}]),
    }),
    foot:'ข้อมูลพนักงานเป็นข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล ระบบเต็มจำกัดสิทธิ์การเข้าถึงเป็นรายบทบาทและบันทึกทุกครั้งที่มีการเปิดดู',
  });
}

/* ===================================================================
   โครงการและงบประมาณ
   =================================================================== */
function scProjects() {
  const rows = DB.projects.map(function (p) {
    const recognised = round2(pct(p.contract, p.percent));
    const costToDate = round2(pct(p.budget, p.percent));
    return { ...p, recognised, costToDate, margin: recognised - costToDate };
  });
  const cust = (c) => (DB.partners.find((x) => x.code === c) || {}).name || c;
  return card({
    title:'โครงการ', sub:'รับรู้รายได้ตามขั้นความสำเร็จของงาน (percentage of completion)',
    body: tbl({
      cols:[{t:'รหัสโครงการ'},{t:'ชื่องาน'},{t:'ลูกค้า'},{t:'มูลค่าสัญญา',a:'r'},{t:'งบต้นทุน',a:'r'},
        {t:'ความคืบหน้า',a:'r'},{t:'รายได้ที่รับรู้',a:'r'},{t:'ต้นทุนตามขั้น',a:'r'},{t:'กำไรขั้นต้น',a:'r'}],
      rows: rows.map((p) => [{mono:p.code}, p.name, cust(p.customer), {n:p.contract}, {n:p.budget},
        {html:'<div class="bar"><i style="width:' + p.percent + '%"></i></div><span class="dim">' + p.percent + '%</span>'},
        {n:p.recognised}, {n:p.costToDate}, {n:p.margin}]),
      foot: ['','','รวม', {n:rows.reduce((s,p)=>s+p.contract,0)}, {n:rows.reduce((s,p)=>s+p.budget,0)},
        '', {n:rows.reduce((s,p)=>s+p.recognised,0)}, {n:rows.reduce((s,p)=>s+p.costToDate,0)},
        {n:rows.reduce((s,p)=>s+p.margin,0)}],
    }),
    foot:'ตัวเลขในหน้านี้คำนวณจากมูลค่าสัญญา งบต้นทุน และขั้นความสำเร็จที่บันทึกไว้ การผูกต้นทุนจริงรายใบเสร็จเข้าโครงการอยู่ในแผนระยะถัดไป',
  });
}

function scBudget() {
  const from = pStart(), to = pEnd();
  const yFrom = yStart();
  const months = Number(STATE.period.slice(5, 7));
  const rows = DB.budget.map(function (b) {
    const actual = Math.abs(balanceOf(b.account, to, from));
    const ytdActual = Math.abs(balanceOf(b.account, to, yFrom));
    const ytdBudget = b.monthly * months;
    return { ...b, actual, variance: b.monthly - actual, ytdActual, ytdBudget, ytdVariance: ytdBudget - ytdActual };
  });
  const sum = (f) => rows.reduce((s, r) => s + r[f], 0);
  return card({
    title:'งบประมาณเทียบใช้จริง', sub: thPeriod(STATE.period) + ' และสะสม ' + months + ' เดือน',
    body: tbl({
      cols:[{t:'รหัส'},{t:'รายการ'},{t:'งบเดือนนี้',a:'r'},{t:'ใช้จริงเดือนนี้',a:'r'},{t:'ผลต่าง',a:'r'},
        {t:'งบสะสม',a:'r'},{t:'ใช้จริงสะสม',a:'r'},{t:'ผลต่างสะสม',a:'r'}],
      rows: rows.map((r) => [{mono:r.account}, r.name, {n:r.monthly}, {n:r.actual},
        {n:r.variance, cls: r.variance < 0 ? 'bad' : 'good'},
        {n:r.ytdBudget}, {n:r.ytdActual},
        {n:r.ytdVariance, cls: r.ytdVariance < 0 ? 'bad' : 'good'}]),
      foot: ['','รวม', {n:sum('monthly')}, {n:sum('actual')}, {n:sum('variance')},
        {n:sum('ytdBudget')}, {n:sum('ytdActual')}, {n:sum('ytdVariance')}],
    }),
    foot:'ผลต่างเป็นบวกคือใช้ต่ำกว่างบ เป็นลบคือใช้เกินงบ ตัวเลขใช้จริงดึงจากบัญชีแยกประเภทโดยตรง ไม่ได้กรอกซ้ำ',
  });
}

/* ===================================================================
   งบการเงิน
   =================================================================== */
function scBalanceSheet() {
  const to = pEnd();
  const bs = balanceSheet(to);
  return card({
    title:'งบแสดงฐานะการเงิน', sub: DB.company.name + ' · ณ วันที่ ' + thDate(to)
      + ' · จัดทำตาม ' + DB.company.standard,
    actions: btn('print', 'พิมพ์'),
    body: fsRows(bs.lines),
    foot: bs.diff === 0
      ? 'งบสมดุล — รวมสินทรัพย์เท่ากับรวมหนี้สินและส่วนของผู้ถือหุ้นพอดี (กำไรของงวดที่ยังไม่ปิดบัญชีรวมอยู่ในกำไรสะสมแล้ว)'
      : 'ไม่สมดุล ต่างกัน ' + fmt(bs.diff) + ' บาท',
  });
}

function scIncomeStatement() {
  const from = pStart(), to = pEnd();
  const mo = incomeStatement(from, to);
  const ytd = incomeStatement(yStart(), to);
  const pctOf = (v, base) => (base ? (v / base * 100).toFixed(1) + '%' : '—');
  return card({
    title:'งบกำไรขาดทุน', sub: DB.company.name + ' · สำหรับงวด ' + thPeriod(STATE.period)
      + ' และสะสมตั้งแต่ต้นปี',
    actions: btn('print', 'พิมพ์'),
    body: '<div class="scroll"><table class="fs"><thead><tr><th>รายการ</th>'
      + '<th class="r">' + esc(thPeriod(STATE.period)) + '</th><th class="r">% ของรายได้</th>'
      + '<th class="r">สะสมตั้งแต่ต้นปี</th><th class="r">% ของรายได้</th></tr></thead><tbody>'
      + mo.lines.map(function (L, i) {
          const y = ytd.lines[i];
          const cls = L.k === 't' ? 'fs-t' : L.k === 's' ? 'fs-s' : '';
          return '<tr class="' + cls + '"><td>' + esc(L.label) + '</td>'
            + '<td class="num' + (L.value < 0 ? ' neg' : '') + '">' + fmt(L.value) + '</td>'
            + '<td class="num dim">' + pctOf(L.value, mo.revenue) + '</td>'
            + '<td class="num' + (y.value < 0 ? ' neg' : '') + '">' + fmt(y.value) + '</td>'
            + '<td class="num dim">' + pctOf(y.value, ytd.revenue) + '</td></tr>';
        }).join('')
      + '</tbody></table></div>',
    foot:'ค่าเสื่อมราคาที่แสดงเป็นตัวเลขทางบัญชี ส่วนตัวเลขทางภาษีเก็บแยกไว้ในทะเบียนทรัพย์สินเพื่อใช้กรอก ภ.ง.ด.50',
  });
}

/* ===================================================================
   ระบบ
   =================================================================== */
function scAudit() {
  const rows = DB.audit.filter((a) => hit(a.entity) || hit(a.id) || hit(a.action)).slice(0, 200);
  const ACT = { post:'ลงบัญชี', reverse:'กลับรายการ', issue:'ออกเอกสาร', create:'สร้าง',
    run:'ประมวลผล', file:'ยื่นแบบ', close:'ปิดงวด', reopen:'เปิดงวด', match:'กระทบยอด' };
  return card({
    title:'ร่องรอยการตรวจสอบ', sub:'บันทึกทุกการกระทำที่กระทบตัวเลข ลบไม่ได้ แก้ไม่ได้',
    filters: searchBox('ค้นหาประเภทเอกสารหรือเลขที่'),
    body: tbl({
      cols:[{t:'เวลา'},{t:'ผู้ใช้'},{t:'ประเภท'},{t:'อ้างอิง'},{t:'การกระทำ'},{t:'รายละเอียด'},{t:'เหตุผล'}],
      rows: rows.map((a) => [{mono:a.at.slice(0, 19).replace('T', ' ')}, a.user, a.entity, {mono:a.id},
        ACT[a.action] || a.action,
        a.after ? {dim: Object.keys(a.after).map((k) => k + ': ' + a.after[k]).join(' · ')} : {dim:'—'},
        a.reason ? a.reason : {dim:'—'}]),
      empty:'ยังไม่มีรายการ',
    }),
    foot:'แสดง ' + rows.length + ' รายการล่าสุด · ระบบเต็มเก็บถาวรในฐานข้อมูลพร้อมเลขอ้างอิงต่อเนื่องเพื่อให้ผู้สอบบัญชีตรวจย้อนหลังได้',
  });
}

function scAbout() {
  const c = DB.company;
  const counts = [
    ['ผังบัญชี', DB.accounts.length + ' บัญชี'],
    ['ใบสำคัญที่ลงบัญชีแล้ว', DB.entries.length + ' ใบ'],
    ['ใบกำกับภาษีขาย', DB.docs.invoice.length + ' ฉบับ'],
    ['ตั้งหนี้ผู้ขาย', DB.docs.bill.length + ' รายการ'],
    ['รายการในทะเบียนภาษี', DB.taxTx.length + ' รายการ'],
    ['ร่องรอยการตรวจสอบ', DB.audit.length + ' รายการ'],
  ];
  return card({
    title:'ข้อมูลกิจการ', sub:'ข้อมูลชุดนี้จะถูกพิมพ์ลงเอกสารทุกใบตามที่มาตรา 86/4 กำหนด',
    body: '<div class="docgrid">'
      + '<div><div class="dim">ชื่อผู้ประกอบการ</div><b>' + esc(c.name) + '</b><div>' + esc(c.nameEn) + '</div></div>'
      + '<div><div class="dim">เลขประจำตัวผู้เสียภาษี</div><b>' + esc(c.taxId) + '</b><div>'
        + esc(c.branchName) + ' (' + esc(c.branch) + ')</div></div>'
      + '<div><div class="dim">สถานประกอบการ</div><div>' + esc(c.address) + '</div></div>'
      + '<div><div class="dim">รอบบัญชี / มาตรฐาน</div><b>' + esc(c.fiscalYear) + '</b><div>' + esc(c.standard) + '</div></div>'
      + '<div><div class="dim">ผู้ทำบัญชี</div><div>' + esc(c.bookkeeper) + '</div></div>'
      + '<div><div class="dim">ผู้สอบบัญชีรับอนุญาต</div><div>' + esc(c.auditor) + '</div></div>'
      + '</div>'
      + '<div class="sub-h">ปริมาณข้อมูลในระบบขณะนี้</div>'
      + tbl({ cols:[{t:'รายการ'},{t:'จำนวน',a:'r'}], rows: counts.map((x) => [x[0], {c:x[1]}]) }),
  })
  + card({
    title:'เกี่ยวกับระบบนี้',
    body: '<div class="prose">'
      + '<p><b>ดุลย์ (Duly)</b> คือระบบบัญชีที่ยึดหลักว่า <b>ตัวเลขต้องถูกตั้งแต่ตอนบันทึก ไม่ใช่ตอนแก้</b> '
      + 'ทุกเอกสารที่ออกจะสร้างรายการบัญชีให้ทันทีผ่านประตูเดียว รายการที่ลงแล้วแก้ไม่ได้ ถ้าผิดต้องกลับรายการ '
      + 'ตามที่พระราชบัญญัติการบัญชี พ.ศ. 2543 มาตรา 20 กำหนด</p>'
      + '<p>สิ่งที่ทำงานจริงในหน้านี้: ออกใบกำกับภาษีตามมาตรา 86/4 · รับชำระพร้อมภาษีที่ลูกค้าหักไว้ · '
      + 'ใบลดหนี้ตามเหตุในมาตรา 86/10 · ตั้งหนี้และจ่ายชำระพร้อมหักภาษี ณ ที่จ่าย แยกช่องทาง e-Withholding Tax · '
      + 'ค่าเสื่อมราคาแยกบัญชีกับภาษี · เงินเดือนพร้อมประกันสังคมและภาษีตามอัตราก้าวหน้า · '
      + 'ภ.พ.30 · ภ.ง.ด.1/3/53 · กระทบยอดธนาคาร · ปิดงวดแบบมีรายการตรวจ · งบการเงินครบชุด</p>'
      + '<p>อัตราภาษีทุกตัวเก็บเป็นข้อมูลพร้อมช่วงวันที่มีผลบังคับ ระบบเลือกอัตราตาม<b>วันที่ของเอกสาร</b> '
      + 'ไม่ใช่วันที่ปัจจุบัน การออกเอกสารย้อนหลังจึงได้อัตราที่ถูกต้องเสมอ เช่น เพดานค่าจ้างประกันสังคม '
      + 'ที่เปลี่ยนจาก 15,000 เป็น 17,500 บาทตั้งแต่ 1 มกราคม 2569</p>'
      + '<p class="dim">' + (DB.isDemo
          ? 'ตอนนี้ระบบใช้ข้อมูลตัวอย่างที่สร้างขึ้นทั้งหมด ไม่ใช่ข้อมูลจริง '
          : 'ข้อมูลของคุณ ')
      + 'เก็บไว้ในเบราว์เซอร์เครื่องนี้เครื่องเดียว ไม่ได้ส่งออกไปที่ใด '
      + 'เปิดคนละเครื่องหรือคนละเบราว์เซอร์คือคนละชุดข้อมูล</p></div>',
    foot: btn('blank:new', 'เริ่มจากบริษัทเปล่า', 'primary')
      + btn('reset', 'ล้างและสร้างข้อมูลตัวอย่างใหม่'),
  });
}

/* ===================================================================
   ตารางหน้าจอ
   =================================================================== */
const SCREENS = {
  dashboard: scDashboard, close: scClose,
  invoices: scInvoices, receipts: scReceipts, creditnotes: scCreditNotes,
  ar: () => agingScreen('ar'), customers: () => partnerScreen('customer'),
  bills: scBills, payments: scPayments, ap: () => agingScreen('ap'),
  vendors: () => partnerScreen('vendor'),
  bank: scBank, cashflow: scCashFlow,
  journals: scJournals, ledger: scLedger, tb: scTrialBalance, coa: scCoa,
  vatout: () => vatRegister('vat_output'), vatin: () => vatRegister('vat_input'),
  pp30: scPp30, pnd: scPnd, whtcert: scWhtCert, taxcal: scTaxCal,
  items: scItems, stockmoves: scStockMoves,
  assets: scAssets, deprec: scDeprec,
  payroll: scPayroll, employees: scEmployees,
  projects: scProjects, budget: scBudget,
  bs: scBalanceSheet, pl: scIncomeStatement,
  audit: scAudit, about: scAbout,
  import: scImport, importResult: scImportResult,
};

/* ===================================================================
   นำเข้าข้อมูลจากระบบเดิม
   =================================================================== */
function scImport() {
  const IMP = STATE.imp || {};
  const accOptions = '<option value="">— เลือกบัญชีปลายทาง —</option>'
    + DB.accounts.filter((a) => a.postable)
      .map((a) => '<option value="' + a.code + '">' + esc(a.code + ' ' + a.name) + '</option>').join('');

  const step1 = card({
    title:'นำเข้าข้อมูลจากระบบบัญชีเดิม',
    sub:'รองรับไฟล์ .xlsx และ .csv ที่ส่งออกจากโปรแกรมบัญชีเดิม และแฟ้ม .json จากตัวดึงข้อมูล FlowAccount',
    body:'<div class="drop" id="drop">'
      + '<input type="file" id="file" accept=".xlsx,.csv,.txt,.json" hidden>'
      + '<div class="drop-in">'
      + '<b>ลากไฟล์มาวางที่นี่</b>'
      + '<div class="dim">หรือ</div>'
      + btn('pick:file', 'เลือกไฟล์จากเครื่อง', 'primary')
      + '<div class="dim" style="margin-top:14px">'
      + 'งบทดลอง — FlowAccount: รายงานด้านบัญชี → งบทดลอง → เลือกรอบระยะเวลา → ดาวน์โหลด Excel<br>'
      + 'ผังบัญชี — บริหารบัญชี → ผังบัญชี → เพิ่มเติม → ดาวน์โหลด Excel</div>'
      + '</div></div>'
      + (IMP.error ? '<div class="note warn">' + esc(IMP.error) + '</div>' : ''),
    foot:'ไฟล์ถูกอ่านในเครื่องคุณเท่านั้น ไม่ได้อัปโหลดไปที่ใด',
  });

  const blank = card({
    title: DB.isDemo ? 'เริ่มจากบริษัทเปล่า — ทำขั้นนี้ก่อน' : 'เริ่มจากบริษัทเปล่า',
    sub:'ล้างข้อมูลตัวอย่างทิ้ง เหลือแต่ผังบัญชีและงวดบัญชี พร้อมรับข้อมูลจริงของคุณ',
    actions: btn('blank:new', 'ตั้งค่าบริษัทใหม่'),
    body:(DB.isDemo ? '<div class="note warn">ตอนนี้ระบบยังใช้ข้อมูลตัวอย่างอยู่ '
        + 'ถ้านำเข้าข้อมูลจริงทับไปเลย ตัวเลขจะปนกันและยอดคุมจะไม่มีทางตรง</div>' : '')
      + '<div class="prose"><p>ก่อนย้ายข้อมูลจริงเข้ามา ควรเริ่มจากบริษัทเปล่าก่อน '
      + 'ไม่งั้นตัวเลขของคุณจะปนกับข้อมูลตัวอย่างที่ระบบสร้างไว้ให้ลอง '
      + 'และยอดคุมจะไม่มีทางตรง</p>'
      + '<p class="dim">ตอนนี้กำลังใช้ข้อมูลของ <b>' + esc(DB.company.name) + '</b> '
      + 'มีใบสำคัญ ' + DB.entries.length + ' ใบ · ใบกำกับภาษี ' + DB.docs.invoice.length + ' ฉบับ</p></div>',
    foot:'ข้อมูลเดิมทั้งหมดจะหายถาวร ระบบจะถามยืนยันอีกครั้งก่อนทำ',
  });

  if (!IMP.rows) return step1 + blank;

  /* ---- อ่านไฟล์ได้แล้ว ให้เลือกคอลัมน์ ---- */
  const head = IMP.rows[IMP.headerRow] || [];
  const colOpts = (sel) => '<option value="">— ไม่ใช้ —</option>'
    + head.map((h, i) => '<option value="' + i + '"' + (String(i) === String(sel) ? ' selected' : '') + '>'
        + esc((h || '').trim() || 'คอลัมน์ที่ ' + (i + 1)) + '</option>').join('');

  const preview = IMP.tb ? previewOpening(IMP.tb.rows, IMP.overrides || {}) : null;

  const step2 = card({
    title:'ตรวจไฟล์ก่อนนำเข้า',
    sub: esc(IMP.name) + ' · ' + IMP.rows.length + ' แถว · หัวตารางอยู่แถวที่ ' + (IMP.headerRow + 1),
    actions: btn('imp:reset', 'เลือกไฟล์ใหม่'),
    body:'<div class="flds">'
      + '<div class="fld-w"><label for="c_code">คอลัมน์รหัสบัญชี</label><select id="c_code" class="impcol" data-k="code">' + colOpts(IMP.map.code) + '</select></div>'
      + '<div class="fld-w"><label for="c_name">คอลัมน์ชื่อบัญชี</label><select id="c_name" class="impcol" data-k="name">' + colOpts(IMP.map.name) + '</select></div>'
      + '<div class="fld-w"><label for="c_debit">คอลัมน์เดบิต</label><select id="c_debit" class="impcol" data-k="debit">' + colOpts(IMP.map.debit) + '</select></div>'
      + '<div class="fld-w"><label for="c_credit">คอลัมน์เครดิต</label><select id="c_credit" class="impcol" data-k="credit">' + colOpts(IMP.map.credit) + '</select></div>'
      + field({ name:'cutoff', label:'วันตัดยอด (ยอดยกมาจะลงบัญชีวันนี้)', type:'date',
          value: IMP.cutoff || pStart(), hint:'ต้องอยู่ในงวดที่ยังเปิดอยู่' })
      + '</div>'
      + '<div class="sub-h">ตัวอย่าง 8 แถวแรกที่อ่านได้</div>'
      + tbl({
          cols:[{t:'รหัส'},{t:'ชื่อบัญชี'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'จับคู่กับ'}],
          rows: (IMP.tb ? IMP.tb.rows.slice(0, 8) : []).map(function (r) {
            const t = (IMP.overrides || {})[r.code || r.name] || matchAccount(r.code, r.name);
            return [{mono:r.code}, r.name, {n:r.debit}, {n:r.credit},
              t ? {dim: t + ' ' + acc(t).name} : {st:['late','ยังไม่จับคู่']}];
          }),
          empty:'อ่านบรรทัดที่มียอดไม่ได้เลย ลองเลือกคอลัมน์ใหม่',
        })
      + (IMP.tb && IMP.tb.skipped.length
          ? '<div class="note">ข้ามไป ' + IMP.tb.skipped.length + ' แถว: '
            + esc(IMP.tb.skipped.slice(0, 4).map((s) => 'แถว ' + s.line + ' (' + s.why + ')').join(', '))
            + (IMP.tb.skipped.length > 4 ? ' และอื่น ๆ' : '') + '</div>'
          : ''),
  });

  if (!preview) return step1 + step2 + blank;

  const step3 = card({
    title:'สรุปสิ่งที่จะเกิดขึ้น',
    sub:'ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดปุ่มนำเข้า',
    actions: btn('imp:run', 'นำเข้ายอดยกมา', preview.ready ? 'primary' : 'disabled'),
    body:'<div class="reco">'
      + '<div><span>บัญชีที่จับคู่ได้</span><b>' + preview.matched.length + ' บัญชี</b></div>'
      + '<div><span>บัญชีที่ยังจับคู่ไม่ได้</span><b class="' + (preview.unmatched.length ? 'neg' : '') + '">'
        + preview.unmatched.length + ' บัญชี</b></div>'
      + '<div><span>เดบิตรวม</span><b>' + fmt(preview.totalDr) + '</b></div>'
      + '<div><span>เครดิตรวม</span><b>' + fmt(preview.totalCr) + '</b></div>'
      + '<div class="gt"><span>ผลต่าง</span><b class="' + (preview.balanced ? '' : 'neg') + '">'
        + fmt(preview.diff) + '</b></div></div>'
      + (preview.unmatched.length
          ? '<div class="sub-h">เลือกบัญชีปลายทางให้ครบก่อนนำเข้า</div>'
            + tbl({
                cols:[{t:'รหัสเดิม'},{t:'ชื่อบัญชีเดิม'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'ลงบัญชีของเราที่'}],
                rows: preview.unmatched.map((r) => [{mono:r.code}, r.name, {n:r.debit}, {n:r.credit},
                  {html:'<select class="impmap" data-key="' + esc(r.code || r.name) + '">' + accOptions + '</select>'}]),
              })
          : '')
      + (preview.balanced ? '' : '<div class="note warn">เดบิตรวมไม่เท่ากับเครดิตรวม '
          + 'มักเกิดจากเลือกคอลัมน์ผิดคู่ — งบทดลองมักมีทั้งคู่ยอดยกมา คู่เคลื่อนไหว และคู่ยอดคงเหลือ '
          + 'ให้เลือกคู่ยอดคงเหลือปลายงวด</div>'),
    foot: preview.ready
      ? 'ระบบจะสร้างใบสำคัญ "ยอดยกมา" หนึ่งใบ ลงวันที่ตามที่เลือก แก้ไม่ได้ ถ้าผิดต้องกลับรายการ'
      : 'ยังนำเข้าไม่ได้ — ' + (!preview.balanced ? 'งบทดลองไม่สมดุล' : 'ยังจับคู่บัญชีไม่ครบ'),
  });

  return step1 + step2 + step3 + blank;
}

function scImportResult() {
  const r = STATE.impResult;
  if (!r) { STATE.screen = 'import'; return scImport(); }
  return card({
    title:'นำเข้าข้อมูลเรียบร้อย',
    sub:'จากระบบ ' + r.source + ' ตัดยอด ณ ' + thDate(r.cutoff),
    actions: btn('go:tb', 'ดูงบทดลอง', 'primary') + btn('go:import', 'นำเข้าไฟล์อื่นต่อ'),
    body: kpi([
      { label:'คู่ค้าที่เพิ่มใหม่', value: r.partners + ' / ' + r.partnersSeen + ' ราย' },
      { label:'สินค้าที่เพิ่มใหม่', value: r.items + ' / ' + r.itemsSeen + ' รายการ' },
      { label:'ลูกหนี้ค้างยกมา', value: r.invoices + ' ใบ' },
      { label:'เจ้าหนี้ค้างยกมา', value: r.bills + ' รายการ' },
    ])
    + (r.opening ? '<div class="reco"><div><span>ใบสำคัญยอดยกมา</span><b>' + esc(r.opening.entry.no) + '</b></div>'
        + '<div><span>จำนวนบัญชี</span><b>' + r.opening.accounts + '</b></div>'
        + '<div class="gt"><span>ยอดรวมด้านเดบิต</span><b>' + fmt(r.opening.total) + '</b></div></div>' : '')
    + '<div class="sub-h">ตรวจยอดคุมหลังนำเข้า</div>'
    + '<ul class="checks">' + r.checks.map((c) =>
        '<li><span class="dot ' + (c.ok ? 'good' : 'bad') + '"></span>' + esc(c.label)
        + '<span class="grow"></span><span class="' + (c.ok ? 'dim' : 'neg') + '">'
        + (c.ok ? 'ตรงกัน' : 'ต่าง ' + fmt(c.control - c.sub)) + '</span></li>').join('') + '</ul>'
    + (r.warnings.length
        ? '<div class="sub-h">ข้อสังเกตจากตัวดึงข้อมูล (' + r.warnings.length + ')</div>'
          + tbl({ cols:[{t:'เอกสาร'},{t:'เรื่อง'}],
                  rows: r.warnings.slice(0, 50).map((w) => [{mono:w.doc || '—'}, w.message || String(w)]) })
        : ''),
    foot: r.allPassed
      ? 'ยอดคุมผ่านครบทุกข้อ ข้อมูลที่ย้ายมาสอดคล้องกันทั้งบัญชีคุมและบัญชีย่อย'
      : 'มียอดคุมที่ยังไม่ตรง — แปลว่าย้ายมาไม่ครบ ตรวจรายการข้างต้นก่อนใช้งานจริง',
  });
}
