/* ===================================================================
   หน้าจอระบบสต๊อก — ยอดยกมา · ตรวจนับ · ตัดจำหน่าย · เบิกใช้ · สต๊อกการ์ด
   ตรรกะอยู่ใน stock.js หน้านี้แค่แสดงและรับค่า
   =================================================================== */
const STOCK_ADJ_ST = { opening:['open','ยอดยกมา'], count:['paid','ตรวจนับ'], writeoff:['late','ตัดจำหน่าย'], issue:['wait','เบิกใช้'] };
const stockItems = () => DB.items.filter((i) => i.type === 'stock');
const qtyFmt = (q) => fmt(M(String(roundQty(q || 0)))).replace(/\.00$/, '');

/** หมายเหตุยอดสินค้าในบัญชีที่ยังไม่มีรายตัว — ขึ้นทุกหน้าที่เกี่ยวกับสต๊อกจนกว่าจะตั้งยอดครบ */
function stockGapNote() {
  const free = stockUnallocated(pEnd());
  if (free === 0) return '';
  return '<div class="note warn">' + (free > 0
    ? '<b>บัญชีสินค้าคงเหลือมียอด ' + fmt(free) + ' บาท ที่ยังไม่มีรายตัวสินค้า</b> (มักมาจากงบทดลองที่นำเข้า) '
      + 'ขายสินค้าไม่ได้จนกว่าจะมีของในทะเบียน — กด <b>ตั้งยอดยกมา</b> หรือลากไฟล์รายการสินค้าคงเหลือ (.xlsx/.csv) ที่หน้านำเข้าข้อมูล '
      + 'ยอดรวมรายตัวต้องเท่ายอดนี้ ระบบไม่ลงบัญชีซ้ำ'
    : '<b>มูลค่าสินค้ารายตัวสูงกว่าบัญชีสินค้าคงเหลือ ' + fmt(-free) + ' บาท</b> — ตรวจรายการที่ลงบัญชีสินค้าโดยตรง') + '</div>';
}

/* ---------- ใบปรับปรุงสินค้า ---------- */
function stockAdjDetail(no) {
  const d = DB.docs.stockAdj.find((x) => x.no === no);
  if (!d) return '';
  const k = d.kind;
  const cols = k === 'count'
    ? [{t:'สินค้า'},{t:'หน่วย'},{t:'ยอดในระบบ',a:'r'},{t:'นับได้',a:'r'},{t:'ขาด (−) / เกิน (+)',a:'r'},{t:'มูลค่าที่ปรับ',a:'r'}]
    : [{t:'สินค้า'},{t:'หน่วย'},{t:'ยอดก่อนบันทึก',a:'r'},{t:k === 'opening' ? 'รับเข้า' : 'จ่ายออก',a:'r'},{t:'มูลค่า',a:'r'}];
  const rows = d.lines.map((l) => k === 'count'
    ? [{mono:l.itemCode}, l.uom, {n:M(String(l.bookQty))}, {n:M(String(l.qty))},
       {n:M(String(l.diff)), cls: l.diff < 0 ? 'bad' : l.diff > 0 ? 'good' : ''}, {n:l.cost}]
    : [{mono:l.itemCode}, l.uom, {n:M(String(l.bookQty))}, {n:M(String(Math.abs(l.diff)))}, {n:Math.abs(l.cost)}]);
  rows.forEach((r, i) => { r[0] = {html: '<span class="mono">' + esc(d.lines[i].itemCode) + '</span> ' + esc(d.lines[i].name)}; });
  return card({
    title: STOCK_ADJ[k].verb + ' เลขที่ ' + d.no,
    sub: 'วันที่ ' + thDate(d.date) + (d.reason ? ' · ' + d.reason : '')
      + (k === 'issue' && d.account ? ' · ลงบัญชี ' + d.account + ' ' + acc(d.account).name : ''),
    actions: (d.entryNo ? btn('entry:' + d.entryNo, 'ดูใบสำคัญ') : '')
      + (isVoid(d) ? '' : btn('stock:void:' + d.no, 'ยกเลิกเอกสาร', 'danger')) + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + tbl({ cols, rows })
      + '<div class="totals">'
      + '<div><span>มูลค่ารับเข้าคลัง</span><b>' + fmt(d.valueIn) + '</b></div>'
      + '<div><span>มูลค่าจ่ายออกจากคลัง</span><b>' + fmt(d.valueOut) + '</b></div>'
      + '</div>'
      + (k === 'opening' ? '<div class="note">' + (d.mode === 'allocate'
          ? 'แยกยอดสินค้าคงเหลือที่ยกมากับงบทดลองเป็นรายตัว — ไม่ลงบัญชีซ้ำ เพราะยอดอยู่ในบัญชีแล้ว'
          : 'ลงบัญชี Dr สินค้าคงเหลือ / Cr บัญชีปรับปรุงยอดยกมา') + '</div>' : ''),
    foot: isVoid(d) ? 'ยกเลิกแล้ว — คืนสต๊อกและกลับรายการบัญชีแล้ว'
      : 'ลงบัญชีแล้วแก้ไม่ได้ ถ้าผิดให้กดยกเลิกเอกสารแล้วทำใหม่ · ตีราคาด้วยต้นทุนเฉลี่ยถ่วงน้ำหนัก ณ วันที่บันทึก',
  });
}

function scStockAdj() {
  const base = DB.docs.stockAdj.filter((d) => (periodOf(d.date) === STATE.period || STATE.sel === d.no)
    && (hit(d.no) || hit(d.reason || '') || d.lines.some((l) => hit(l.itemCode) || hit(l.name))));
  const open = periodIsOpen();
  const act = (k, label, kind) => btn('stock:new:' + k, label, open ? kind : 'disabled');
  return (STATE.sel ? stockAdjDetail(STATE.sel) : '')
    + card({
      title:'ยอดยกมา · ตรวจนับ · ตัดจำหน่าย · เบิกใช้',
      sub: thPeriod(STATE.period) + ' · ' + countNote(base, 'ใบ'),
      actions: act('opening', '+ ตั้งยอดยกมา', stockUnallocated(pEnd()) > 0 ? 'primary' : '')
        + act('count', '+ ตรวจนับ', stockUnallocated(pEnd()) > 0 ? '' : 'primary') + act('writeoff', '+ ตัดจำหน่าย') + act('issue', '+ เบิกใช้'),
      filters: searchBox('ค้นหาเลขที่ เหตุผล หรือสินค้า'),
      body: stockGapNote() + tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'งาน'},{t:'รายการ',a:'r'},{t:'รับเข้า',a:'r'},{t:'จ่ายออก',a:'r'},{t:'เหตุผล'},{t:'ใบสำคัญ'}],
        rows: base.map((d) => [{mono:d.no}, thDateNum(d.date), {st: isVoid(d) ? ['void','ยกเลิก'] : STOCK_ADJ_ST[d.kind]},
          {c:String(d.lines.length)}, {n:d.valueIn}, {n:d.valueOut}, {dim: d.reason || '—'},
          d.entryNo ? {mono:d.entryNo} : {dim: d.mode === 'allocate' ? 'แยกรายตัว ไม่ลงบัญชีซ้ำ' : '—'}]),
        rowAttr: (r, i) => rowCls(base[i]) + ' data-act="sel:' + r[0].mono + '"',
        empty:'ยังไม่มีใบปรับปรุงสินค้าในงวดนี้',
        emptyAction: open ? btn('stock:new:count', 'ตรวจนับสินค้า', 'primary') : '',
      }),
      foot:'ของที่มีอยู่ก่อนเริ่มใช้ระบบ → ตั้งยอดยกมา · นับของจริงแล้วไม่ตรง → ตรวจนับ (ขาดลงขาดทุน เกินลงรายได้อื่น) · '
        + 'ของเสีย/หาย → ตัดจำหน่าย · เอาไปใช้เอง → เบิกใช้ (ลงค่าใช้จ่ายตามบัญชีที่เลือก)',
    });
}

/** แบบฟอร์มงานสต๊อก — ตรวจนับแสดงสินค้าทุกตัวพร้อมยอดในระบบ แก้เฉพาะตัวที่นับได้ไม่ตรง */
function modalStockAdj(kind) {
  const items = stockItems();
  if (!items.length) {
    toast('ยังไม่มีสินค้าที่มีสต๊อกในทะเบียน', 'err', 'เพิ่มสินค้าที่ ทะเบียนสินค้า ก่อน หรือลากไฟล์รายการสินค้าคงเหลือที่หน้านำเข้าข้อมูล ระบบสร้างสินค้าให้');
    return;
  }
  const isCount = kind === 'count', isOpen = kind === 'opening';
  const n = isCount ? items.length : 8;
  const opt = (sel) => '<option value="">— เลือกสินค้า —</option>' + items.map((i) => '<option value="' + esc(i.code) + '"'
    + (i.code === sel ? ' selected' : '') + '>' + esc(i.code + ' · ' + i.name + ' (คงเหลือ ' + qtyFmt(i.qty) + ' ' + (i.uom || '') + ')') + '</option>').join('');
  let rows = '';
  for (let i = 0; i < n; i++) {
    const it = isCount ? items[i] : null;
    rows += '<tr>'
      + (isCount
        ? '<td><input type="hidden" name="s' + i + '_item" value="' + esc(it.code) + '"><span class="mono">' + esc(it.code) + '</span> ' + esc(it.name) + '</td>'
          + '<td class="num">' + qtyFmt(it.qty) + ' ' + esc(it.uom || '') + '</td>'
        : '<td><select name="s' + i + '_item">' + opt('') + '</select></td>')
      + '<td><input name="s' + i + '_qty" class="r" inputmode="decimal" value="' + (isCount ? esc(String(it.qty)) : '') + '"></td>'
      + (isOpen || isCount ? '<td><input name="s' + i + '_cost" class="r" inputmode="decimal" placeholder="'
          + (isCount ? (it.avgCost ? fmt(it.avgCost) : 'ต้นทุนต่อหน่วย') : 'ต้นทุนต่อหน่วย') + '"' + (isCount && it.avgCost ? ' disabled' : '') + '></td>' : '')
      + '</tr>';
  }
  const free = stockUnallocated(defaultDate());
  const head = isCount ? '<th>สินค้า</th><th class="r">ยอดในระบบ</th><th class="r">นับได้จริง</th><th class="r">ต้นทุนต่อหน่วย (เฉพาะของเกินที่ยังไม่มีต้นทุน)</th>'
    : '<th>สินค้า</th><th class="r">' + (isOpen ? 'จำนวนยกมา' : 'จำนวน') + '</th>' + (isOpen ? '<th class="r">ต้นทุนต่อหน่วย</th>' : '');
  modal({
    title: STOCK_ADJ[kind].verb,
    sub: isOpen ? (free > 0 ? 'ยอดสินค้าคงเหลือในบัญชีที่ยังไม่แยกรายตัว ' + fmt(free) + ' บาท — ยอดรวมที่กรอกต้องไม่เกินนี้ ระบบไม่ลงบัญชีซ้ำ'
        : 'ยังไม่มียอดสินค้าในบัญชี — ระบบจะลงบัญชี Dr สินค้าคงเหลือ / Cr บัญชีปรับปรุงยอดยกมา')
      : isCount ? 'แก้เฉพาะช่อง "นับได้จริง" ของตัวที่ไม่ตรง ขาดลงผลขาดทุนจากสินค้า เกินลงรายได้อื่น ตีราคาด้วยต้นทุนเฉลี่ย'
      : kind === 'writeoff' ? 'ของชำรุด สูญหาย หมดอายุ — ลงบัญชีผลขาดทุนจากสินค้าที่ต้นทุนเฉลี่ย'
      : 'เอาสินค้าไปใช้เองในกิจการ — ลงค่าใช้จ่ายตามบัญชีที่เลือกที่ต้นทุนเฉลี่ย',
    body:'<div class="flds">'
      + field({ name:'sdate', label: isOpen ? 'วันที่ยอดยกมา' : isCount ? 'วันที่ตรวจนับ' : 'วันที่', type:'date', value: defaultDate() })
      + field({ name:'sreason', label: kind === 'writeoff' ? 'เหตุผลที่ตัดจำหน่าย' : kind === 'issue' ? 'เบิกไปใช้ทำอะไร' : 'หมายเหตุ',
          placeholder: kind === 'writeoff' ? 'เช่น สินค้าชำรุดจากน้ำท่วมคลัง' : kind === 'issue' ? 'เช่น ใช้ซ่อมอาคารสำนักงาน' : isCount ? 'เช่น ตรวจนับสิ้นเดือน' : 'เช่น ยอดยกมาจากระบบเดิม' })
      + (kind === 'issue' ? field({ name:'saccount', label:'ลงบัญชีค่าใช้จ่าย', type:'select', value: defaultAccountFor('admin_expense'),
          options: expenseAccounts().map((a) => [a.code, a.code + ' ' + a.name]) }) : '')
      + '</div>'
      + '<div class="scroll"><table class="lines"><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<input type="hidden" name="scount" value="' + n + '">',
    submitLabel: STOCK_ADJ[kind].verb,
    note: kind === 'writeoff' ? 'หักเป็นรายจ่ายทางภาษีได้เมื่อมีหลักฐานการทำลายหรือแจ้งสรรพากรตามระเบียบ' : 'ลงบัญชีแล้วแก้ไม่ได้ ถ้าผิดยกเลิกแล้วทำใหม่',
    onSubmit: function () {
      submitAction(function () {
        const lines = [];
        const cnt = Number(val('scount')) || 0;
        for (let i = 0; i < cnt; i++) {
          const code = val('s' + i + '_item'), q = val('s' + i + '_qty').replace(/,/g, '').trim();
          if (!code || q === '') continue;
          lines.push({ itemCode: code, qty: Number(q), unitCost: val('s' + i + '_cost').replace(/,/g, '').trim() });
        }
        const d = saveStockAdj({ kind, date: val('sdate'), reason: val('sreason'), account: val('saccount') || null, lines });
        STATE.screen = 'stockadj'; STATE.sel = d.no; STATE.period = periodOf(d.date);
        toast(STOCK_ADJ[kind].verb + ' ' + d.no + ' แล้ว', 'ok',
          (d.valueIn ? 'รับเข้า ' + fmt(d.valueIn) + ' บาท ' : '') + (d.valueOut ? 'จ่ายออก ' + fmt(d.valueOut) + ' บาท' : '')
          + (!d.valueIn && !d.valueOut ? 'ยอดตรงกับระบบทุกรายการ' : ''));
        return d;
      });
    },
  });
}

function modalStockVoid(no) {
  const d = DB.docs.stockAdj.find((x) => x.no === no);
  if (!d) return;
  modal({
    title:'ยกเลิก ' + STOCK_ADJ[d.kind].verb + ' ' + no,
    sub: d.lines.length + ' รายการ · รับเข้า ' + fmt(d.valueIn) + ' · จ่ายออก ' + fmt(d.valueOut),
    body:'<div class="prose"><p>ระบบจะคืนสต๊อกทุกรายการตามที่ใบนี้ทำไว้'
      + (d.entryNo ? ' และกลับรายการใบสำคัญ ' + esc(d.entryNo) + ' ณ วันที่เดิม' : '') + ' เลขที่เอกสารยังอยู่และเห็นว่ายกเลิก</p></div>'
      + '<div class="flds">' + field({ name:'vreason', label:'เหตุผล (ผู้สอบบัญชีจะเห็นข้อความนี้)', wide:true }) + '</div>',
    submitLabel:'ยกเลิกเอกสาร', submitKind:'danger',
    onSubmit: function () {
      submitAction(function () {
        const r = voidStockAdj(no, val('vreason'));
        toast('ยกเลิก ' + no + ' แล้ว', 'ok', 'คืนสต๊อกและกลับรายการบัญชีแล้ว');
        return r;
      });
    },
  });
}

/* ---------- สต๊อกการ์ด / รายงานสินค้าและวัตถุดิบ ---------- */
function stockRange() {
  const ytd = STATE.stockRange === 'ytd';
  const start = ytd ? (fyStartOf(pStart()) || pStart()) : pStart();
  return { from: start, to: pEnd(), ytd };
}
function stockCardDetail(code) {
  const it = DB.items.find((x) => x.code === code && x.type === 'stock');
  if (!it) return '';
  const r = stockRange();
  const c = stockCard(code, r.from, r.to);
  const rows = [[thDateNum(r.from), {dim:'ยอดยกมา'}, '', '', '', '', '', '', {n:M(String(c.opening.qty))}, {n:c.opening.value}]]
    .concat(c.rows.map((x) => [thDateNum(x.date), {mono:x.src}, x.kind,
      x.inQty ? {n:M(String(x.inQty))} : '', x.inQty ? {n:x.inValue} : '',
      x.outQty ? {n:M(String(x.outQty))} : '', x.outQty ? {n:x.outValue} : '',
      {n:x.unitCost}, {n:M(String(x.balQty))}, {n:x.balValue}]));
  return card({
    title:'สต๊อกการ์ด ' + it.code + ' ' + it.name,
    sub: 'หน่วย ' + (it.uom || '—') + ' · ' + thDate(r.from) + ' ถึง ' + thDate(r.to) + ' · ตีราคาถัวเฉลี่ยถ่วงน้ำหนัก',
    actions: btn('stock:range:' + (r.ytd ? 'month' : 'ytd'), r.ytd ? 'ดูเฉพาะเดือนนี้' : 'ดูตั้งแต่ต้นปี') + btn('sel:', 'ปิด'),
    body: tbl({
      cols:[{t:'วันที่'},{t:'เอกสาร'},{t:'รายการ'},{t:'รับ',a:'r'},{t:'มูลค่ารับ',a:'r'},{t:'จ่าย',a:'r'},{t:'มูลค่าจ่าย',a:'r'},
        {t:'ต้นทุน/หน่วย',a:'r'},{t:'คงเหลือ',a:'r'},{t:'มูลค่าคงเหลือ',a:'r'}],
      rows,
      foot:['', '', 'รวม', {n:M(String(c.inQty))}, {n:c.inValue}, {n:M(String(c.outQty))}, {n:c.outValue}, '', {n:M(String(c.closing.qty))}, {n:c.closing.value}],
    }),
    foot:'บัญชีคุมสินค้ารายตัว ใช้เป็นรายงานสินค้าและวัตถุดิบตามมาตรา 87(3) ได้ · ยอดคงเหลือตรงกับทะเบียนสินค้า',
  });
}
function scStockCard() {
  const r = stockRange();
  const s = stockSummary(r.from, r.to);
  const rows = s.rows.filter((x) => hit(x.code) || hit(x.name));
  const diff = s.totals.closing - s.gl;
  return (STATE.sel ? stockCardDetail(STATE.sel) : '')
    + card({
      title:'รายงานสินค้าคงเหลือ',
      sub: thDate(r.from) + ' ถึง ' + thDate(r.to) + ' · ' + s.rows.length + ' รายการ · กดที่สินค้าเพื่อดูสต๊อกการ์ด',
      actions: btn('stock:range:' + (r.ytd ? 'month' : 'ytd'), r.ytd ? 'ดูเฉพาะเดือนนี้' : 'ดูตั้งแต่ต้นปี')
        + btn('stock:new:count', 'ตรวจนับ', periodIsOpen() ? '' : 'disabled'),
      filters: searchBox('ค้นหารหัสหรือชื่อสินค้า'),
      body: stockGapNote() + tbl({
        cols:[{t:'รหัส'},{t:'ชื่อสินค้า'},{t:'หน่วย'},{t:'ยกมา',a:'r'},{t:'รับ',a:'r'},{t:'จ่าย',a:'r'},{t:'คงเหลือ',a:'r'},
          {t:'มูลค่ายกมา',a:'r'},{t:'มูลค่ารับ',a:'r'},{t:'มูลค่าจ่าย',a:'r'},{t:'มูลค่าคงเหลือ',a:'r'}],
        rows: rows.map((x) => [{mono:x.code}, x.name, x.uom, {n:M(String(x.opening.qty))}, {n:M(String(x.inQty))},
          {n:M(String(x.outQty))}, {n:M(String(x.closing.qty)), cls: x.closing.qty < 0 ? 'bad' : ''},
          {n:x.opening.value}, {n:x.inValue}, {n:x.outValue}, {n:x.closing.value}]),
        rowAttr: (row) => 'class="row-link" data-act="sel:' + row[0].mono + '"',
        foot:['', '', '', '', '', '', 'รวม', {n:s.totals.opening}, {n:s.totals.inValue}, {n:s.totals.outValue}, {n:s.totals.closing}],
        empty:'ยังไม่มีสินค้าที่มีสต๊อก',
      })
      + '<div class="reco"><div><span>มูลค่าสินค้ารายตัว ณ ' + thDate(r.to) + '</span><b>' + fmt(s.totals.closing) + '</b></div>'
      + '<div><span>บัญชีสินค้าคงเหลือในงบทดลอง</span><b>' + fmt(s.gl) + '</b></div>'
      + '<div class="gt"><span>ผลต่าง</span><b class="' + (diff ? 'neg' : '') + '">' + fmt(diff) + '</b></div></div>',
      foot: diff === 0 ? 'มูลค่าสินค้ารายตัวตรงกับบัญชีสินค้าคงเหลือพอดี' : 'ยังไม่ตรงกัน — ระบบไม่ให้ปิดงวดจนกว่าจะตรง',
    });
}

/* ---------- ไฟล์รายการสินค้าคงเหลือที่หน้านำเข้า ---------- */
function importStockCard(IMP) {
  const st = readStockFile(IMP.rows, IMP.stock.map, IMP.stock.headerRow);
  const date = IMP.stockDate || (IMP.dates && IMP.dates.to) || pEnd();
  const total = st.rows.reduce((s, r) => s + r.amount, 0);
  const free = stockUnallocated(date);
  const known = (r) => r.code ? DB.items.find((x) => x.code === r.code) : DB.items.find((x) => norm(x.name) === norm(r.name));
  const bad = st.skipped.filter((x) => x.bad);
  const over = free > 0 && total > free;
  const fresh = st.rows.filter((r) => !known(r)).length;
  const notStock = st.rows.filter((r) => { const k = known(r); return k && k.type !== 'stock'; });
  const ready = st.rows.length > 0 && !bad.length && !over && !notStock.length;
  return card({
    title:'ไฟล์รายการสินค้าคงเหลือ — ตั้งยอดสินค้ายกมา',
    sub: esc(IMP.name) + ' · อ่านได้ ' + st.rows.length + ' รายการ · มูลค่ารวม ' + fmt(total) + ' บาท',
    actions: btn('imp:reset', 'เลือกไฟล์ใหม่') + btn('stockimp:run', 'ตั้งยอดสินค้ายกมา', ready ? 'primary' : 'disabled'),
    body:'<div class="flds">' + field({ name:'stockDate', label:'วันที่ยอดยกมา', type:'date', value: date,
        hint: IMP.dates ? 'ไฟล์ระบุ ณ ' + thDate(IMP.dates.to) : 'ใช้วันเดียวกับวันตัดยอดของงบทดลองที่นำเข้า' }) + '</div>'
      + '<div class="reco">'
      + '<div><span>มูลค่าสินค้าในไฟล์</span><b>' + fmt(total) + '</b></div>'
      + '<div><span>ยอดสินค้าในบัญชีที่ยังไม่แยกรายตัว ณ ' + thDate(date) + '</span><b>' + fmt(Math.max(0, free)) + '</b></div>'
      + '<div class="gt"><span>' + (free > 0 ? 'เหลือที่ยังไม่แยกหลังนำเข้า' : 'จะลงบัญชี Dr สินค้า / Cr ปรับปรุงยอดยกมา') + '</span><b class="'
        + (over ? 'neg' : '') + '">' + fmt(free > 0 ? free - total : total) + '</b></div></div>'
      + (over ? '<div class="note warn">มูลค่าในไฟล์มากกว่ายอดสินค้าคงเหลือในบัญชีที่ยังไม่แยกรายตัว — ตรวจจำนวนและต้นทุน หรือวันที่ให้ตรงกับงบทดลองที่นำเข้า</div>' : '')
      + (free > 0 && total < free && !over ? '<div class="note">ยังเหลือยอดที่ไม่แยกรายตัว ' + fmt(free - total) + ' บาท หลังนำเข้า — ถ้าไฟล์ครบทุกรายการแล้ว ยอดควรเท่ากันพอดี</div>' : '')
      + (fresh ? '<div class="note">มีสินค้าใหม่ ' + fresh + ' รายการที่ยังไม่อยู่ในทะเบียน ระบบจะสร้างให้ด้วยรหัสและชื่อจากไฟล์</div>' : '')
      + (notStock.length ? '<div class="note warn">รายการเหล่านี้เป็นบริการในทะเบียน ตั้งสต๊อกไม่ได้: ' + esc(notStock.map((r) => r.code || r.name).join(', ')) + '</div>' : '')
      + (bad.length ? '<div class="note warn">อ่านไม่ออก ' + bad.length + ' แถว: ' + esc(bad.slice(0, 5).map((x) => 'แถว ' + x.line + ' ' + x.why).join(' · ')) + ' — แก้ในไฟล์แล้วลากเข้ามาใหม่</div>' : '')
      + tbl({
        cols:[{t:'แถว',a:'r'},{t:'รหัส'},{t:'ชื่อสินค้า'},{t:'หน่วย'},{t:'จำนวน',a:'r'},{t:'ต้นทุน/หน่วย',a:'r'},{t:'มูลค่า',a:'r'},{t:'ในทะเบียน'}],
        rows: st.rows.map((r) => { const k = known(r); return [{c:String(r.line)}, {mono:r.code || '—'}, r.name, r.uom || '',
          {n:M(String(r.qty))}, {n:r.qty ? unitCost(r.amount, r.qty) : 0}, {n:r.amount},
          k ? (k.type === 'stock' ? {dim:'มีแล้ว ' + k.code} : {st:['late','เป็นบริการ']}) : {st:['open','สร้างใหม่']}]; }),
        foot:['', '', '', '', '', 'รวม', {n:total}, ''],
      })
      + (st.skipped.length ? '<details class="adv"><summary>ข้ามไป ' + st.skipped.length + ' แถว — กดดูทุกแถว</summary>'
        + tbl({ cols:[{t:'แถว',a:'r'},{t:'รหัส'},{t:'ชื่อ'},{t:'เหตุผล'}],
            rows: st.skipped.map((x) => [{c:String(x.line)}, {mono:x.code || ''}, x.name || '', x.bad ? {st:['late', x.why]} : {dim:x.why}]) })
        + '</details>' : ''),
    foot:'ยอดยกมาของสินค้ารายตัวเข้าคลังเป็นเอกสาร "ยอดยกมา" หนึ่งใบ ยกเลิกได้ · บัญชีสินค้าคงเหลือที่ยกมากับงบทดลองแล้วจะไม่ถูกลงซ้ำ',
  });
}

/** ปุ่มทั้งหมดของหน้าสต๊อก */
function stockDispatch(rest) {
  const what = rest[0], arg = rest.slice(1).join(':');
  if (what === 'new') { modalStockAdj(arg); return true; }
  if (what === 'void') { modalStockVoid(arg); return true; }
  if (what === 'range') { STATE.stockRange = arg; render(); return true; }
  if (what === 'card') { STATE.screen = 'stockcard'; STATE.sel = arg; render(); return true; }
  return false;
}
function runStockImport() {
  const I = STATE.imp;
  if (!I || I.kind !== 'stock') return;
  runAction(function () {
    const st = readStockFile(I.rows, I.stock.map, I.stock.headerRow);
    const date = val('stockDate') || I.stockDate || (I.dates && I.dates.to) || pEnd();
    const r = importOpeningStock(st.rows, date, I.name);
    STATE.imp = null; STATE.screen = 'stockadj'; STATE.sel = r.doc.no; STATE.period = periodOf(r.doc.date);
    toast('ตั้งยอดสินค้ายกมา ' + r.doc.lines.length + ' รายการแล้ว', 'ok',
      'มูลค่า ' + fmt(r.doc.valueIn) + ' บาท' + (r.created ? ' · สร้างสินค้าใหม่ ' + r.created + ' รายการ' : ''));
  });
}
