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
   บริบทของหน้า — หน้านี้ใช้ทำอะไร ลงบัญชีอย่างไร และอยู่ตรงไหนของวงจรเอกสาร
   ให้คนที่ไม่ได้จบบัญชีก็เข้าใจว่ากดแล้วตัวเลขไปลงที่ไหน
   =================================================================== */
const NOJE = (why) => [['none', why]];
const PAGE_INFO = {
  close:        { d:'ตรวจรายการก่อนปิดให้ผ่านครบแล้วจึงปิดงวด — งวดที่ปิดแล้วลงรายการย้อนหลังไม่ได้ (พ.ร.บ.การบัญชี ม.20)' },
  quotations:   { d:'เสนอราคาให้ลูกค้า ยืนราคา 30 วัน ลูกค้าตอบรับแล้วแปลงเป็นใบสั่งขายได้ในปุ่มเดียว', je: NOJE('ยังไม่ลงบัญชี') },
  salesorders:  { d:'ยืนยันคำสั่งซื้อของลูกค้า แปลงเป็นใบกำกับภาษีเมื่อส่งมอบสินค้าหรือบริการ', je: NOJE('ยังไม่ลงบัญชี') },
  invoices:     { d:'ขายเชื่อ ออกครบตามมาตรา 86/4 ระบบตัดสต๊อกและต้นทุนขายให้เอง',
                  je: [['dr','ลูกหนี้การค้า'], ['cr','รายได้จากการขาย · ภาษีขาย']], book:'สมุดรายวันขาย' },
  billingnotes: { d:'รวบใบกำกับที่ค้างของลูกค้ารายเดียวไปวางเก็บเงินครั้งเดียว พร้อมวันนัดชำระ', je: NOJE('ไม่ลงบัญชี — ใช้นัดเก็บเงิน') },
  receipts:     { d:'รับชำระหนี้จากลูกค้า ต้องอ้างใบกำกับเสมอ ภาษีที่ลูกค้าหักไว้เก็บเป็นเครดิตภาษีปลายปี',
                  je: [['dr','เงินฝากธนาคาร · ภาษีถูกหัก ณ ที่จ่าย'], ['cr','ลูกหนี้การค้า']], book:'สมุดรายวันรับ' },
  creditnotes:  { d:'ลดหนี้ตามมาตรา 86/10 — รับคืนสินค้า ลดราคา หรือคิดเงินเกิน ต้องอ้างใบกำกับเดิม',
                  je: [['dr','รับคืนสินค้าและส่วนลด · ภาษีขาย'], ['cr','ลูกหนี้การค้า']], book:'สมุดรายวันขาย' },
  debitnotes:   { d:'เพิ่มหนี้ตามมาตรา 86/9 — เก็บเงินต่ำกว่าที่ควร ห้ามออกใบกำกับใหม่ทับ',
                  je: [['dr','ลูกหนี้การค้า'], ['cr','รายได้จากการขาย · ภาษีขาย']], book:'สมุดรายวันขาย' },
  purchaseorders:{ d:'สั่งซื้อจากผู้ขาย ยังไม่ก่อหนี้ — ของมาแล้วออกใบรับสินค้า ใบกำกับมาแล้วตั้งหนี้', je: NOJE('ยังไม่ลงบัญชี') },
  goodsreceipts:{ d:'รับของเข้าคลังก่อนใบกำกับจากผู้ขายมาถึง ยอดพักไว้จนกว่าจะตั้งหนี้',
                  je: [['dr','สินค้าคงเหลือ'], ['cr','พักรับสินค้า']], book:'สมุดรายวันซื้อ' },
  bills:        { d:'ตั้งหนี้เมื่อได้รับใบกำกับภาษีซื้อ ระบบกันเลขใบกำกับซ้ำและแยกภาษีซื้อต้องห้ามให้',
                  je: [['dr','ค่าใช้จ่าย/สินค้า · ภาษีซื้อ'], ['cr','เจ้าหนี้การค้า']], book:'สมุดรายวันซื้อ' },
  payments:     { d:'จ่ายชำระเจ้าหนี้ หักภาษี ณ ที่จ่ายและออก 50 ทวิ ให้อัตโนมัติ',
                  je: [['dr','เจ้าหนี้การค้า'], ['cr','เงินฝากธนาคาร · ภาษีหัก ณ ที่จ่ายค้างนำส่ง']], book:'สมุดรายวันจ่าย' },
  expenses:     { d:'ค่าใช้จ่ายที่จ่ายทันที ถ้ามีหัก ณ ที่จ่าย ระบบออก 50 ทวิ ให้ในแถบหัก ณ ที่จ่ายเอง',
                  je: [['dr','ค่าใช้จ่าย · ภาษีซื้อ'], ['cr','เงินฝากธนาคาร · ภาษีหัก ณ ที่จ่ายค้างนำส่ง']], book:'สมุดรายวันจ่าย' },
  whtcert:      { d:'หนังสือรับรอง 50 ทวิ ทุกฉบับผูกกับการจ่ายเงินจริง ยื่นรวมในแบบ ภ.ง.ด.3/53 ภายในวันที่ 7 ของเดือนถัดไป',
                  je: NOJE('ลงบัญชีพร้อมรายการจ่ายเงิน') },
  paymentprep:  { d:'รวบเจ้าหนี้ที่ถึงกำหนดเป็นรอบจ่าย จัดทำ → อนุมัติ → จ่าย', je: NOJE('ลงบัญชีตอนกดจ่าย') },
  bank:         { d:'เทียบยอดเงินฝากในระบบกับสเตทเมนต์ธนาคาร รายการที่ยังไม่มีบันทึกเข้าบัญชีได้จากหน้านี้' },
  cashflow:     { d:'เงินสดเข้าออกของงวด แยกกิจกรรมดำเนินงาน ลงทุน และจัดหาเงิน (วิธีทางตรง)' },
  jgeneral:     { d:'รายการที่ไม่มีเงินเข้าออก — ปรับปรุง ตั้งค้างจ่าย ค่าเสื่อม เงินเดือน กลับรายการ', book:'JV' },
  jpurchase:    { d:'ซื้อเงินเชื่อ — ใบรับสินค้าและตั้งหนี้ผู้ขายลงเล่มนี้ให้เอง', book:'PU' },
  jsales:       { d:'ขายเงินเชื่อ — ใบกำกับภาษี ใบลดหนี้ ใบเพิ่มหนี้ลงเล่มนี้ให้เอง', book:'SA' },
  jpayment:     { d:'ทุกรายการที่มีเงินออก — ใบสำคัญจ่าย ค่าใช้จ่าย ใบเตรียมจ่าย นำส่งภาษี', book:'PY' },
  jreceipt:     { d:'ทุกรายการที่มีเงินเข้า — ใบเสร็จรับเงินลงเล่มนี้ให้เอง', book:'RV' },
  coa:          { d:'ผังบัญชี 5 หมวด: สินทรัพย์ หนี้สิน ส่วนของผู้ถือหุ้น รายได้ ค่าใช้จ่าย — คลิกบัญชีเพื่อดูบัญชีแยกประเภท' },
  pp30:         { d:'ภาษีขายหักภาษีซื้อของเดือน ยื่นภายในวันที่ 15 ของเดือนถัดไป (ยื่นออนไลน์ขยายถึงวันที่ 23)',
                  je: [['dr','ภาษีขาย'], ['cr','ภาษีซื้อ · ภาษีมูลค่าเพิ่มค้างชำระ']], book:'สมุดรายวันทั่วไป' },
  pnd:          { d:'นำส่งภาษีที่หักไว้ ภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ถึงวันที่ 15) — รายการ e-Withholding กันออกให้แล้ว',
                  je: [['dr','ภาษีหัก ณ ที่จ่ายค้างนำส่ง'], ['cr','เงินฝากธนาคาร']], book:'สมุดรายวันจ่าย' },
  taxcal:       { d:'กำหนดยื่นแบบภาษีทุกฉบับของงวดนี้ ทั้งแบบกระดาษและยื่นผ่านอินเทอร์เน็ต' },
  customers:    { d:'ทะเบียนลูกหนี้ — ชื่อ ที่อยู่ เลขผู้เสียภาษี และสาขา ถูกคัดลอกลงใบกำกับทุกใบ ณ วันที่ออก' },
  vendors:      { d:'ทะเบียนเจ้าหนี้ — ประเภทผู้รับเงินกำหนดว่ายื่น ภ.ง.ด.3 หรือ 53 และประเภทเงินได้ที่ต้องหัก' },
  items:        { d:'ทะเบียนสินค้า ราคาทุนถัวเฉลี่ยถ่วงน้ำหนัก — สต๊อกเปลี่ยนจากเอกสารซื้อขายเท่านั้น' },
  stockmoves:   { d:'รับเข้าและจ่ายออกของสินค้าทุกรายการ พร้อมต้นทุนและยอดคงเหลือ' },
  assets:       { d:'ทะเบียนทรัพย์สินถาวร ราคาทุน ค่าเสื่อมสะสมทางบัญชีและทางภาษี' },
  deprec:       { d:'ค่าเสื่อมราคาประจำงวด คิดทางบัญชีตามอายุใช้งาน และทางภาษีตาม พ.ร.ฎ.145',
                  je: [['dr','ค่าเสื่อมราคา'], ['cr','ค่าเสื่อมราคาสะสม']], book:'สมุดรายวันทั่วไป' },
  payroll:      { d:'เงินเดือน ภาษี ภ.ง.ด.1 ประกันสังคม และกองทุนสำรองเลี้ยงชีพ ของงวด',
                  je: [['dr','เงินเดือน · ประกันสังคมส่วนนายจ้าง'], ['cr','เงินฝากธนาคาร · ภาษีและเงินสมทบค้างนำส่ง']], book:'สมุดรายวันทั่วไป' },
  employees:    { d:'ทะเบียนพนักงาน ใช้คำนวณภาษีเงินได้ ประกันสังคม และกองทุนสำรองเลี้ยงชีพ' },
  bs:           { d:'สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น ณ วันสิ้นงวด จัดรูปแบบตาม TFRS for NPAEs' },
  pl:           { d:'รายได้หักค่าใช้จ่ายของงวด พร้อมคอลัมน์สะสมตั้งแต่ต้นรอบบัญชี' },
  equity:       { d:'ทุน สำรองตามกฎหมาย และกำไรสะสม ตั้งแต่ต้นรอบบัญชีถึงสิ้นงวด — ยอดปลายงวดต้องตรงกับงบแสดงฐานะการเงิน' },
  journals:     { d:'ใบสำคัญทุกเล่มเรียงรวมกัน — บันทึกเองได้ที่เมนูบัญชี → สมุดรายวันแต่ละเล่ม' },
  ledger:       { d:'ความเคลื่อนไหวรายบัญชีพร้อมยอดยกมาและยอดคงเหลือสะสม' },
  tb:           { d:'ยอดทุกบัญชีของงวด เดบิตรวมต้องเท่ากับเครดิตรวม — คลิกบรรทัดเพื่อเจาะดูบัญชีแยกประเภท' },
  ar:           { d:'ลูกหนี้คงค้างแยกตามอายุหนี้ ยอดรวมต้องเท่ากับบัญชีคุมลูกหนี้' },
  ap:           { d:'เจ้าหนี้คงค้างแยกตามอายุหนี้ ยอดรวมต้องเท่ากับบัญชีคุมเจ้าหนี้' },
  vatout:       { d:'รายงานภาษีขายตามประกาศอธิบดีฯ ใบลดหนี้แสดงเป็นยอดติดลบในเดือนที่ออก' },
  vatin:        { d:'รายงานภาษีซื้อ ภาษีซื้อต้องห้ามแยกออกไม่นำไปหักในแบบ ภ.พ.30' },
  settings:     { d:'ข้อมูลผู้ประกอบการที่พิมพ์ลงเอกสารทุกใบ — ต้องครบตามมาตรา 86/4 ก่อนออกใบกำกับภาษี' },
};

/* วงจรเอกสาร — ลำดับที่เอกสารเกิดจริง คลิกไปหน้านั้นได้ */
const FLOWS = {
  sale:  { l:'วงจรขาย', steps:['quotations', 'salesorders', 'invoices', 'billingnotes', 'receipts'], alt:['creditnotes', 'debitnotes'] },
  buy:   { l:'วงจรซื้อ', steps:['purchaseorders', 'goodsreceipts', 'bills', 'paymentprep', 'payments'] },
  exp:   { l:'ค่าใช้จ่าย', steps:['expenses', 'whtcert', 'pnd'] },
  book:  { l:'สมุดรายวัน', steps:['jgeneral', 'jpurchase', 'jsales', 'jpayment', 'jreceipt'] },
  close: { l:'งานปิดงวด', steps:['bank', 'deprec', 'payroll', 'pp30', 'pnd', 'close'] },
  fs:    { l:'งบการเงิน', steps:['tb', 'bs', 'pl', 'equity', 'cashflow'] },
};
const FLOW_OF = {
  quotations:'sale', salesorders:'sale', invoices:'sale', billingnotes:'sale', receipts:'sale', creditnotes:'sale', debitnotes:'sale',
  purchaseorders:'buy', goodsreceipts:'buy', bills:'buy', paymentprep:'buy', payments:'buy',
  expenses:'exp', whtcert:'exp',
  jgeneral:'book', jpurchase:'book', jsales:'book', jpayment:'book', jreceipt:'book',
  bank:'close', deprec:'close', payroll:'close', pp30:'close', pnd:'close', close:'close',
  tb:'fs', bs:'fs', pl:'fs', equity:'fs', cashflow:'fs',
};

/** ตัวเลขเล็ก ๆ บนแต่ละขั้น — งานที่ยังค้าง หรือเครื่องหมายว่าทำแล้ว */
function flowCount(sc) {
  const per = (k) => (DB.docs[k] || []).filter((d) => periodOf(d.date) === STATE.period).length;
  const live = (k) => (DB.docs[k] || []).filter((d) => tradeDocStatus(k, d) === 'issued').length;
  const done = (ok) => (ok ? '✓' : '!');
  switch (sc) {
    case 'quotations': return live('quotation');
    case 'salesorders': return live('salesOrder');
    case 'purchaseorders': return live('purchaseOrder');
    case 'invoices': return DB.docs.invoice.filter((d) => d.status !== 'void' && invOutstanding(d) > 0).length;
    case 'billingnotes': return DB.docs.billingNote.filter((b) => ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0).length;
    case 'receipts': return per('receipt');
    case 'creditnotes': return per('creditNote');
    case 'debitnotes': return per('debitNote');
    case 'goodsreceipts': return DB.docs.goodsReceipt.filter((g) => g.status === 'received').length;
    case 'bills': return DB.docs.bill.filter((b) => billOutstanding(b) > 0).length;
    case 'paymentprep': return DB.docs.paymentBatch.filter(paymentBatchActive).length;
    case 'payments': return per('payment');
    case 'expenses': return per('expense');
    case 'whtcert': return per('whtCert');
    case 'bank': return done(!DB.bankTxns.some((t) => !t.matched && periodOf(t.date) <= STATE.period));
    case 'deprec': return done(DB.docs.depreciation.some((d) => d.period === STATE.period && d.status !== 'void'));
    case 'payroll': return done(DB.docs.payRun.some((r) => r.period === STATE.period && r.status !== 'void'));
    case 'pp30': return done(DB.docs.filing.some((f) => f.form === 'PP30' && f.period === STATE.period));
    case 'pnd': {
      const need = ['PND1', 'PND3', 'PND53'].filter((f) => DB.taxTx.some((t) => t.kind === 'wht'
        && t.period === STATE.period && t.form === f && t.channel === 'manual' && !t.void));
      return done(need.every((f) => DB.docs.filing.some((x) => x.form === f && x.period === STATE.period)));
    }
    case 'close': { const p = DB.periods.find((x) => x.code === STATE.period); return done(p && p.status === 'closed'); }
    default: return '';
  }
}

function pageContext(screen) {
  const info = PAGE_INFO[screen];
  const flow = FLOWS[FLOW_OF[screen]];
  if (!info && !flow) return '';
  const label = (sc) => { const w = navWhere(sc); return w ? w.item[1] : sc; };
  const step = (sc) => {
    let n = '';
    try { n = flowCount(sc); } catch (e) { n = ''; }
    return '<li><a href="#" data-act="go:' + sc + '"' + (sc === screen ? ' class="on" aria-current="step"' : '') + '>'
      + esc(label(sc)) + (n !== '' && n !== 0 ? '<span class="n">' + esc(String(n)) + '</span>' : '') + '</a></li>';
  };
  let h = '<div class="ctx">';
  if (flow) {
    h += '<ol class="flow" aria-label="' + esc(flow.l) + '"><li class="flow-l">' + esc(flow.l) + '</li>'
      + flow.steps.map(step).join('')
      + (flow.alt ? flow.alt.map((sc) => step(sc).replace('<li>', '<li class="alt">')).join('') : '')
      + '</ol>';
  }
  if (info) {
    const book = info.book && info.book.length > 3 ? '<span class="je-book">' + esc(info.book) + '</span>' : '';
    h += '<div class="ctx-row"><div class="ctx-d">' + esc(info.d) + '</div>'
      + (info.je ? '<div class="je-chips" aria-label="ผลทางบัญชี">' + info.je.map((j) =>
          '<span class="je-chip ' + j[0] + '"><b>' + (j[0] === 'dr' ? 'Dr' : j[0] === 'cr' ? 'Cr' : '—') + '</b>'
          + esc(j[1]) + '</span>').join('') + book + '</div>' : '')
      + '</div>';
  }
  return h + '</div>';
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
    { label:'รายได้เดือนนี้', icon:'trend', act:'go:pl', value: fmt(cur.revenue), spark: S12.map((r) => r.revenue),
      sub: prev ? delta(cur.revenue, prev.revenue) : 'เดือนแรกของรอบบัญชี' },
    { label:'กำไรสุทธิเดือนนี้', icon:'chart', act:'go:pl', value: fmt(cur.net), tone: cur.net < 0 ? 'bad' : 'good',
      spark: S12.map((r) => r.net),
      sub:'อัตรากำไร ' + (cur.revenue ? (cur.net / cur.revenue * 100).toFixed(1) : '0.0') + '% · สะสม ' + fmt(ytd.net, 0) + ' บาท' },
    { label:'เงินสดและเงินฝาก', icon:'cash', value: fmt(cash), act:'go:cashflow', spark: S12.map((r) => r.cash),
      sub: prev ? delta(cash, prev.cash) : 'ณ ' + thDate(to) },
    { label:'ลูกหนี้คงค้าง', icon:'sale', value: fmt(ar.totals.total), act:'go:ar', tone: overdue > 0 ? 'warn' : '',
      spark: S12.map((r) => r.ar),
      sub: overdue > 0 ? 'เกินกำหนดชำระ ' + fmt(overdue, 0) : 'ไม่มีรายการเกินกำหนด' },
    { label:'เจ้าหนี้คงค้าง', icon:'buy', value: fmt(ap.totals.total), act:'go:ap', spark: S12.map((r) => r.ap),
      sub: prev ? delta(ap.totals.total, prev.ap, true) : 'ตามเทอมที่ตกลงกับผู้ขาย' },
    { label:'สินทรัพย์รวม', icon:'asset', value: fmt(bs.assets), act:'go:bs', spark: S12.map((r) => r.assets),
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

  /* สิ่งที่ต้องตามวันนี้ — เงินที่ต้องเก็บ เงินที่ต้องจ่าย และเอกสารที่ค้างกลางทาง */
  const in7 = addDays(TODAY, 7);
  const overdueInv = DB.docs.invoice.filter((d) => d.status !== 'void' && invOutstanding(d) > 0 && d.due < TODAY);
  const dueBills = DB.docs.bill.filter((b) => billOutstanding(b) > 0 && b.due <= in7);
  const pbPending = DB.docs.paymentBatch.filter((b) => b.status === 'pending_approval');
  const pbApproved = DB.docs.paymentBatch.filter((b) => b.status === 'approved');
  const grnWait = DB.docs.goodsReceipt.filter((g) => g.status === 'received');
  const bnLate = DB.docs.billingNote.filter((b) => ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0 && b.dueDate < TODAY);
  const sumOf = (list, f) => list.reduce((x, d) => x + f(d), 0);
  const follow = [
    overdueInv.length && { tone:'bad', t:'ลูกหนี้เกินกำหนดชำระ ' + overdueInv.length + ' ใบ',
      d:'รวม ' + fmt(sumOf(overdueInv, invOutstanding)) + ' บาท', act:['go:ar', 'ดูอายุลูกหนี้'] },
    bnLate.length && { tone:'bad', t:'ใบวางบิลเลยวันนัดชำระ ' + bnLate.length + ' ใบ',
      d:'ตามเก็บเงินกับลูกค้า', act:['go:billingnotes', 'ดูใบวางบิล'] },
    pbPending.length && { tone:'warn', t:'ใบเตรียมจ่ายรออนุมัติ ' + pbPending.length + ' ใบ',
      d:'เงินที่ต้องเตรียม ' + fmt(sumOf(pbPending, (b) => b.net)) + ' บาท', act:['go:paymentprep', 'ไปอนุมัติ'] },
    pbApproved.length && { tone:'warn', t:'อนุมัติแล้วรอจ่าย ' + pbApproved.length + ' ใบ',
      d:'เงินที่ต้องเตรียม ' + fmt(sumOf(pbApproved, (b) => b.net)) + ' บาท', act:['go:paymentprep', 'ไปจ่าย'] },
    dueBills.length && { tone:'warn', t:'เจ้าหนี้ครบกำหนดภายใน 7 วัน ' + dueBills.length + ' ราย',
      d:'รวม ' + fmt(sumOf(dueBills, billOutstanding)) + ' บาท', act:['go:paymentprep', 'จัดทำใบเตรียมจ่าย'] },
    grnWait.length && { tone:'warn', t:'รับสินค้าแล้วรอใบกำกับจากผู้ขาย ' + grnWait.length + ' ใบ',
      d:'ยอดพักรับสินค้า ' + fmt(sumOf(grnWait, (g) => g.total)) + ' บาท', act:['go:goodsreceipts', 'ดูใบรับสินค้า'] },
  ].filter(Boolean);

  const li = (tone, t, d, a) => '<li><span class="dot ' + tone + '"></span><div><b>' + esc(t) + '</b>'
    + '<div class="dim">' + esc(d) + '</div></div><span class="grow"></span>' + (a ? btn(a[0], a[1]) : '') + '</li>';
  const todoCard = '<section class="card"><div class="card-h"><div><h2>สิ่งที่ต้องทำ</h2>'
    + '<div class="card-sub">' + thPeriod(STATE.period) + ' — ติดตามเงิน ' + follow.length + ' เรื่อง · งานปิดงวด '
    + (todo.length ? todo.length + ' รายการ' : 'เคลียร์ครบแล้ว') + '</div></div></div>'
    + (follow.length ? '<div class="sub-h">ติดตามเงินเข้าออก</div><ul class="todo">'
        + follow.map((f) => li(f.tone, f.t, f.d, f.act)).join('') + '</ul>' : '')
    + '<div class="sub-h">งานปิดงวด</div>'
    + (todo.length
        ? '<ul class="todo">' + todo.map(function (i) {
            const a = i.action && actMap[i.action];
            return li(i.blocking ? 'bad' : 'warn', i.label,
              i.detail + (i.blocking ? ' · ปิดงวดไม่ได้จนกว่าจะเคลียร์' : ' · ไม่บล็อกการปิดงวด'), a);
          }).join('') + '</ul>'
        : '<div class="empty">ทุกอย่างเรียบร้อย พร้อมปิดงวด<div style="margin-top:12px">' + btn('go:close', 'ไปหน้าปิดงวด') + '</div></div>')
    + '</section>';

  const hello = '<div class="hello"><div><h1>ภาพรวม ' + esc(thPeriod(STATE.period)) + '</h1>'
    + '<div class="dim">ข้อมูล ณ ' + thDate(to) + ' · '
    + (todo.length ? 'เหลืองานก่อนปิดงวด ' + todo.length + ' รายการ' : 'พร้อมปิดงวด') + '</div></div>'
    + '<span class="grow"></span><div class="quick">'
    + btn('new:invoice', '+ ออกใบกำกับภาษี') + btn('new:receipt', '+ รับชำระ')
    + btn('new:expense', '+ บันทึกค่าใช้จ่าย') + btn('cmdk', 'ค้นหา…')
    + '</div></div>';

  return demoBanner + hello + '<div class="kpis">' + tiles.map(function (k) {
      return '<div class="kpi' + (k.tone ? ' ' + k.tone : '') + (k.act ? ' clickable" data-act="' + k.act : '') + '">'
        + '<div class="kpi-l">' + (k.icon ? icon(k.icon) : '') + esc(k.label) + '</div>'
        + '<div class="kpi-v">' + esc(k.value) + '</div>'
        + '<div class="kpi-s">' + (k.sub || '') + '</div>'
        + (k.spark ? sparkline(k.spark) : '') + '</div>';
    }).join('') + '</div>'
  + '<div class="dash-2">' + todoCard
  + card({ title:'ตรวจยอดคุมอัตโนมัติ', sub:'ระบบตรวจให้ทุกครั้งที่มีรายการเปลี่ยน · ' + (rec.allPassed ? 'ตรงกันทุกข้อ' : 'มีข้อที่ไม่ตรง'),
      body:'<ul class="checks">' + rec.checks.map((c) =>
        '<li><span class="dot ' + (c.ok ? 'good' : 'bad') + '"></span>' + esc(c.label)
        + '<span class="grow"></span><span class="' + (c.ok ? 'st paid' : 'st late') + '">'
        + (c.ok ? 'ตรงกัน' : 'ต่าง ' + fmt(c.control - c.sub)) + '</span></li>').join('') + '</ul>' })
  + '</div>'
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
  + card({ title:'รายการบัญชีล่าสุด', sub:'ทุกใบสำคัญที่ระบบสร้างจากเอกสาร',
      actions: btn('go:journals', 'ดูสมุดรายวันทั้งหมด'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'สมุด'},{t:'คำอธิบาย'},{t:'ยอด',a:'r'},{t:'สถานะ'}],
        rows: DB.entries.slice().reverse().slice(0, 10).map((e) =>
          [{mono:e.no}, thDateNum(e.date), JOURNAL_BOOKS[journalOf(e)].label.replace('สมุดรายวัน', ''),
           e.desc, {n:e.total}, statusPill(e.status)]),
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
  + card({ title:'สถานะงวดทั้งปี', sub:'รอบบัญชี ' + DB.company.fiscalYear + ' · ' + DB.periods.length + ' งวด',
      /* เปิดปีถัดไปได้เมื่อเหลือไม่ถึงสามเดือนก่อนถึงงวดสุดท้าย กันกดเปิดปีล่วงหน้าไปไกลโดยไม่ตั้งใจ */
      actions: btn('newyear', '+ เปิดงวดปีบัญชีถัดไป',
        DB.periods.slice().sort((a, b) => a.start < b.start ? -1 : 1).pop().start <= addDays(TODAY, 92) ? '' : 'disabled'),
      body: '<div class="periods">' + DB.periods.map((x) =>
        '<button class="pchip ' + x.status + (x.code === STATE.period ? ' on' : '') + '" data-act="period:' + x.code + '">'
        + esc(thPeriod(x.code)) + '<span>' + (x.status === 'closed' ? 'ปิดแล้ว' : 'เปิดอยู่') + '</span></button>').join('')
        + '</div>',
      foot: 'ปิดแล้ว ' + closedList.length + ' งวด จาก ' + DB.periods.length + ' งวด · ข้ามปีได้โดยไม่ต้องลงรายการปิดบัญชี '
        + 'เพราะงบแสดงฐานะการเงินรวมกำไรของทุกปีก่อนหน้าเข้ากำไรสะสมให้เอง · ภาษีหัก ณ ที่จ่ายเดือนธันวาคม ระบบเปิดงวดปีถัดไปให้อัตโนมัติตอนยื่นแบบ' });
}

/* ===================================================================
   ขายและลูกหนี้
   =================================================================== */
function invoiceDetail(no) {
  const d = DB.docs.invoice.find((x) => x.no === no);
  if (!d) return '';
  const out = invOutstanding(d);
  const rcs = DB.docs.receipt.filter((r) => r.invoiceNo === no);
  const cns = DB.docs.creditNote.filter((c) => c.invoiceNo === no);
  const dns = DB.docs.debitNote.filter((c) => c.invoiceNo === no);
  const rfs = (DB.docs.customerRefund || []).filter((c) => c.invoiceNo === no);
  return card({
    title: 'ใบกำกับภาษี/ใบส่งของ เลขที่ ' + d.no,
    sub: 'ออกวันที่ ' + thDate(d.date) + ' · ครบกำหนด ' + thDate(d.due),
    actions: (out > 0 ? btn('pay:' + d.no, 'รับชำระเงิน', 'primary') : '')
      + (out < 0 ? btn('refund:' + d.no, 'คืนเงินลูกค้า ' + fmt(-out), 'primary') : '')
      + (!isVoid(d) && creditableBase(d) > 0 ? btn('cn:' + d.no, 'ออกใบลดหนี้') : '')
      + (d.status !== 'void' ? btn('dn:' + d.no, 'ออกใบเพิ่มหนี้') : '')
      + printBtn('invoice', d.no) + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + voidBtn('invoice', d) + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + '<div class="docgrid">'
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
      + (d.debited ? '<div><span>เพิ่มหนี้แล้ว</span><b>' + fmt(d.debited) + '</b></div>' : '')
      + (d.refunded ? '<div><span>คืนเงินลูกค้าแล้ว</span><b>' + fmt(d.refunded) + '</b></div>' : '')
      + '<div class="gt"><span>' + (out < 0 ? 'ลูกค้ามีเครดิต (ต้องคืน)' : 'คงเหลือ') + '</span><b>' + fmt(Math.abs(out)) + '</b></div>'
      + '</div>'
      + (rcs.length ? '<div class="sub-h">ใบเสร็จรับเงินที่อ้างถึงใบนี้</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'รับก่อนหัก',a:'r'},{t:'ถูกหัก ณ ที่จ่าย',a:'r'},{t:'รับสุทธิ',a:'r'},{t:'สถานะ'}],
          rows: rcs.map((r) => [{mono:r.no}, thDateNum(r.date), {n:r.gross}, {n:r.wht}, {n:r.net}, statusPill(r.status || 'posted')]),
          rowAttr: (r, i) => rowCls(rcs[i]) + ' data-act="open:receipts:' + r[0].mono + '"' }) : '')
      + (cns.length ? '<div class="sub-h">ใบลดหนี้ที่อ้างถึงใบนี้</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'เหตุผลตามมาตรา 86/10'},{t:'รวม',a:'r'},{t:'สถานะ'}],
          rows: cns.map((c) => [{mono:c.no}, thDateNum(c.date), c.reasonText, {n:c.total}, statusPill(c.status || 'posted')]),
          rowAttr: (r, i) => rowCls(cns[i]) + ' data-act="open:creditnotes:' + r[0].mono + '"' }) : '')
      + (dns.length ? '<div class="sub-h">ใบเพิ่มหนี้ที่อ้างถึงใบนี้</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'เหตุผลตามมาตรา 86/9'},{t:'รวม',a:'r'},{t:'สถานะ'}],
          rows: dns.map((c) => [{mono:c.no}, thDateNum(c.date), c.reasonText, {n:c.total}, statusPill(c.status || 'posted')]),
          rowAttr: (r, i) => rowCls(dns[i]) + ' data-act="open:debitnotes:' + r[0].mono + '"' }) : '')
      + (rfs.length ? '<div class="sub-h">คืนเงินลูกค้า</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'วิธี'},{t:'จำนวนเงิน',a:'r'},{t:'สถานะ'},{t:''}],
          rows: rfs.map((c) => [{mono:c.no}, thDateNum(c.date), PAY_METHOD[c.method] || c.method, {n:c.amount},
            statusPill(c.status || 'posted'), {html: isVoid(c) ? '' : btn('void:customerRefund:' + c.no, 'ยกเลิก', 'danger')}]),
          rowAttr: (r, i) => isVoid(rfs[i]) ? 'class="is-void"' : '' }) : ''),
    foot: isVoid(d)
      ? 'ใบกำกับที่ยกเลิกยังอยู่ในรายงานภาษีขายด้วยยอดศูนย์ เลขที่จึงเรียงต่อเนื่องไม่ขาดช่วง · ถ้าต้องเก็บเงินจริงให้ออกใบกำกับใบใหม่'
      : 'ครบองค์ประกอบตามมาตรา 86/4 · ส่งกรมสรรพากรแบบ e-Tax Invoice แล้ว (จำลอง)'
        + ' · ยกเลิกได้เฉพาะใบที่ยังไม่มีเอกสารอ้างถึงและยังไม่ยื่น ภ.พ.30 ถ้ายื่นแล้วให้ออกใบลดหนี้',
  });
}

function scInvoices() {
  const rows = DB.docs.invoice.filter((d) =>
    periodOf(d.date) === STATE.period && (hit(d.no) || hit(d.partnerName)));
  const totals = liveOnly(rows).reduce((s, d) => ({ base:s.base + d.base, vat:s.vat + d.vat, total:s.total + d.total }), {base:0,vat:0,total:0});
  return (STATE.sel ? invoiceDetail(STATE.sel) : '')
    + card({
      title:'ใบกำกับภาษี', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'ฉบับ'),
      actions: btn('new:invoice', '+ ออกใบกำกับภาษี', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาเลขที่หรือชื่อลูกค้า'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'ครบกำหนด'},{t:'ก่อนภาษี',a:'r'},{t:'ภาษี',a:'r'},{t:'รวม',a:'r'},{t:'คงเหลือ',a:'r'},{t:'สถานะ'}],
        rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, thDateNum(d.due),
          {n:d.base}, {n:d.vat}, {n:d.total}, {n:invOutstanding(d)}, statusPill(d.status)]),
        rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
        foot: ['รวม', '', '', '', {n:totals.base}, {n:totals.vat}, {n:totals.total}, {n:liveOnly(rows).reduce((s, d) => s + invOutstanding(d), 0)}, ''],
        empty: 'ยังไม่มีใบกำกับภาษีในงวดนี้',
        emptyAction: btn('new:invoice', 'ออกใบกำกับภาษีใบแรก', 'primary'),
      }),
      foot: 'ระบบจองเลขที่เอกสารตอนลงบัญชีเท่านั้น เลขจึงเรียงต่อเนื่องไม่มีช่องว่าง · ใบที่ยกเลิกยังแสดงอยู่แต่ไม่นับในยอดรวม',
    });
}

/** รายละเอียดเอกสารที่ไม่มีบรรทัดสินค้า — ใบเสร็จ ใบลดหนี้ ใบเพิ่มหนี้ ใบสำคัญจ่าย */
function simpleDocCard(o) {
  const d = o.doc;
  return card({
    title: o.title + ' เลขที่ ' + d.no, sub: o.sub,
    actions: (o.actions || '') + printBtn(o.kind, d.no) + btn('entry:' + d.entryNo, 'ดูใบสำคัญ')
      + voidBtn(o.kind, d) + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + '<div class="kv">' + o.kv.filter(Boolean).map((r) => '<div><span>' + esc(r[0]) + '</span><b>'
        + (r[2] ? r[1] : esc(r[1])) + '</b></div>').join('') + '</div>',
    foot: o.foot,
  });
}
function receiptDetail(no) {
  const d = DB.docs.receipt.find((x) => x.no === no);
  if (!d) return '';
  return simpleDocCard({ kind:'receipt', doc:d, title:'ใบเสร็จรับเงิน',
    sub:'รับวันที่ ' + thDate(d.date) + ' · ' + d.partnerName,
    actions: btn('open:invoices:' + d.invoiceNo, 'ดูใบกำกับ ' + d.invoiceNo),
    kv:[['อ้างใบกำกับภาษี', d.invoiceNo], d.billingNoteNo ? ['ตามใบวางบิล', d.billingNoteNo] : null,
      ['วิธีรับเงิน', PAY_METHOD[d.method] || d.method], ['รับก่อนหัก', fmt(d.gross)],
      ['ลูกค้าหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), fmt(d.wht)], ['รับสุทธิ', fmt(d.net)],
      ['สถานะ', isVoid(d) ? 'ยกเลิก' : 'ลงบัญชีแล้ว']],
    foot: isVoid(d) ? 'ยอดคงค้างของใบกำกับ ' + d.invoiceNo + ' กลับไปเหมือนก่อนรับชำระแล้ว'
      : 'ยกเลิกใบเสร็จแล้ว ระบบกลับรายการ ณ วันที่เดิม และยอดคงค้างของใบกำกับกลับไปเหมือนเดิม',
  });
}

function scReceipts() {
  const rows = DB.docs.receipt.filter((d) => periodOf(d.date) === STATE.period && (hit(d.no) || hit(d.partnerName)));
  const t = liveOnly(rows).reduce((s, d) => ({g:s.g + d.gross, w:s.w + d.wht, n:s.n + d.net}), {g:0,w:0,n:0});
  return (STATE.sel ? receiptDetail(STATE.sel) : '') + card({
    title:'ใบเสร็จรับเงิน', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'ฉบับ'),
    actions: btn('new:receipt', '+ ออกใบเสร็จรับเงิน', periodIsOpen() ? 'primary' : 'disabled'),
    filters: searchBox('ค้นหาเลขที่หรือชื่อลูกค้า'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'อ้างใบกำกับ'},{t:'วิธีรับ'},{t:'รับก่อนหัก',a:'r'},{t:'ลูกค้าหักไว้',a:'r'},{t:'รับสุทธิ',a:'r'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName,
        {mono:d.invoiceNo + (d.billingNoteNo ? ' · ' + d.billingNoteNo : '')},
        d.method === 'cash' ? 'เงินสด' : d.method === 'cheque' ? 'เช็ค' : 'โอนเงิน',
        {n:d.gross}, {n:d.wht}, {n:d.net}, statusPill(d.status || 'posted')]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '" title="คลิกเพื่อดูรายละเอียด พิมพ์ หรือยกเลิก"',
      foot: ['รวม','','','','', {n:t.g}, {n:t.w}, {n:t.n}, ''],
      empty:'ยังไม่มีการรับชำระในงวดนี้',
      emptyAction: periodIsOpen() ? btn('new:receipt', 'ออกใบเสร็จรับเงิน', 'primary') : '',
    }),
    foot: 'ภาษีที่ลูกค้าหักไว้บันทึกเป็นสินทรัพย์ (ภาษีถูกหัก ณ ที่จ่าย) รอนำไปเครดิตภาษีเงินได้นิติบุคคลปลายปี',
  });
}

function noteDetail(kind, no) {
  const d = DB.docs[kind].find((x) => x.no === no);
  if (!d) return '';
  const cn = kind === 'creditNote';
  return simpleDocCard({ kind, doc:d, title: cn ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้',
    sub:'ออกวันที่ ' + thDate(d.date) + ' · ' + d.partnerName,
    actions: btn('open:invoices:' + d.invoiceNo, 'ดูใบกำกับเดิม ' + d.invoiceNo),
    kv:[['อ้างใบกำกับภาษีเดิม', d.invoiceNo], ['เหตุตามมาตรา ' + (cn ? '86/10' : '86/9'), d.reasonText],
      ['มูลค่า' + (cn ? 'ที่ลด' : 'ที่เพิ่ม'), fmt(d.base)], ['ภาษีมูลค่าเพิ่ม', fmt(d.vat)], ['รวม', fmt(d.total)],
      ['สถานะ', isVoid(d) ? 'ยกเลิก' : 'ลงบัญชีแล้ว']],
    foot: isVoid(d) ? 'ยกเลิกแล้ว — รายงานภาษีขายแสดงใบนี้ว่า "ยกเลิก" ยอดเป็นศูนย์'
      : 'ภาษีขายที่' + (cn ? 'ลด' : 'เพิ่ม') + 'เข้ารายงานภาษีขายเดือนที่ออกใบนี้ · ยกเลิกได้ถ้ายังไม่ยื่น ภ.พ.30 ของเดือนนั้น',
  });
}

function scCreditNotes() {
  const rows = DB.docs.creditNote.filter((d) => periodOf(d.date) === STATE.period);
  const t = liveOnly(rows).reduce((a, d) => ({ base:a.base + d.base, vat:a.vat + d.vat, total:a.total + d.total }), {base:0,vat:0,total:0});
  return (STATE.sel ? noteDetail('creditNote', STATE.sel) : '') + card({
    title:'ใบลดหนี้', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'ฉบับ') + ' · ออกได้เฉพาะเหตุตามมาตรา 86/10 และต้องอ้างใบกำกับเดิมเสมอ',
    actions: btn('new:creditnote', '+ ออกใบลดหนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'อ้างใบกำกับเดิม'},{t:'เหตุตามกฎหมาย'},{t:'มูลค่า',a:'r'},{t:'ภาษี',a:'r'},{t:'รวม',a:'r'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.invoiceNo},
        d.reasonText, {n:d.base}, {n:d.vat}, {n:d.total}, statusPill(d.status || 'posted')]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '" title="คลิกเพื่อดูรายละเอียด พิมพ์ หรือยกเลิก"',
      foot: rows.length ? ['รวม','','','','', {n:t.base}, {n:t.vat}, {n:t.total}, ''] : null,
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
    actions: btn('partner:new:' + kind,
      kind === 'customer' ? '+ เพิ่มลูกค้า' : '+ เพิ่มผู้ขาย', 'primary'),
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
      rowAttr: (r) => 'class="row-link" data-act="partner:edit:' + r[0].mono + '"',
      empty: DB.partners.some((x) => x.kind === kind)
        ? 'ไม่พบรายชื่อที่ค้นหา' : 'ยังไม่มีรายชื่อในทะเบียนนี้',
      emptyAction: btn('partner:new:' + kind,
        kind === 'customer' ? 'เพิ่มลูกค้ารายแรก' : 'เพิ่มผู้ขายรายแรก', 'primary'),
    }),
    foot: 'กดที่แถวเพื่อแก้ไข · เลขประจำตัวผู้เสียภาษีทุกเลขผ่านการตรวจหลักที่ 13 แล้ว '
      + 'ระบบจะไม่ยอมออกใบกำกับให้เลขที่ผิด และกันการสร้างคู่ค้าซ้ำด้วยเลขเดียวกัน',
  });
}

/* ===================================================================
   ซื้อและเจ้าหนี้
   =================================================================== */
function billDetail(no) {
  const d = DB.docs.bill.find((x) => x.no === no);
  if (!d) return '';
  const out = billOutstanding(d);
  const pays = DB.docs.payment.filter((p) => p.billNo === no);
  return card({
    title:'ตั้งหนี้ผู้ขาย เลขที่ ' + d.no,
    sub:'ใบกำกับภาษีซื้อเลขที่ ' + d.vendorNo + ' · ' + d.partnerName + (d.grnNo ? ' · จากใบรับสินค้า ' + d.grnNo : ''),
    actions: (out > 0 ? btn('paybill:' + d.no, 'จ่ายชำระ', 'primary') : '')
      + (d.grnNo ? btn('open:goodsreceipts:' + d.grnNo, 'ดูใบรับสินค้า') : '')
      + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + voidBtn('bill', d) + btn('sel:', 'ปิด'),
    body: voidBanner(d) + tbl({
      cols:[{t:'รายการ'},{t:'บันทึกเข้าบัญชี'},{t:'จำนวน',a:'r'},{t:'ราคาต่อหน่วย',a:'r'},{t:'จำนวนเงิน',a:'r'}],
      rows: d.lines.map((l) => [l.desc, l.acc ? l.acc + ' ' + acc(l.acc).name : (d.grnNo ? 'พักรับสินค้า' : {dim:'—'}),
        {n:M(String(l.qty))}, {n:l.price}, {n:l.amount}]),
    })
    + '<div class="totals">'
    + '<div><span>มูลค่าก่อนภาษี</span><b>' + fmt(d.base) + '</b></div>'
    + '<div><span>ภาษีซื้อ' + (d.claimable ? ' (ขอคืนได้)' : ' (ต้องห้าม — บันทึกเป็นค่าใช้จ่าย)') + '</span><b>' + fmt(d.vat) + '</b></div>'
    + '<div class="gt"><span>รวมทั้งสิ้น</span><b>' + fmt(d.total) + '</b></div>'
    + '<div class="gt"><span>คงเหลือต้องจ่าย</span><b>' + fmt(out) + '</b></div></div>'
    + (pays.length ? '<div class="sub-h">ใบสำคัญจ่ายที่อ้างถึงรายการนี้</div>' + tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ช่องทาง'},{t:'ยอดก่อนหัก',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'50 ทวิ'},{t:'สถานะ'}],
        rows: pays.map((p) => [{mono:p.no}, thDateNum(p.date),
          p.channel === 'e_wht' ? 'e-Withholding Tax' : 'โอน/เช็คเอง',
          {n:p.gross}, {n:p.wht}, {n:p.net},
          p.certNo ? {mono:p.certNo} : (p.wht ? {dim:'ธนาคารออกให้'} : {dim:'—'}), statusPill(p.status || 'posted')]),
        rowAttr: (r, i) => rowCls(pays[i]) + ' data-act="open:payments:' + r[0].mono + '"' }) : ''),
    foot: d.claimable
      ? 'ภาษีซื้อใบนี้เข้ารายงานภาษีซื้องวด ' + thPeriod(periodOf(d.date))
      : 'ภาษีซื้อต้องห้ามตามมาตรา 82/5 — ไม่นำไปหักในแบบ ภ.พ.30 และบันทึกเป็นค่าใช้จ่ายทันที',
  });
}

function scBills() {
  const rows = DB.docs.bill.filter((d) => periodOf(d.date) === STATE.period && (hit(d.no) || hit(d.partnerName) || hit(d.vendorNo)));
  const t = liveOnly(rows).reduce((s, d) => ({b:s.b + d.base, v:s.v + d.vat, t:s.t + d.total}), {b:0,v:0,t:0});
  return (STATE.sel ? billDetail(STATE.sel) : '')
    + card({
      title:'ตั้งหนี้ผู้ขาย', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'รายการ'),
      actions: btn('new:bill', '+ บันทึกใบกำกับภาษีซื้อ', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาผู้ขายหรือเลขที่ใบกำกับ'),
      body: tbl({
        cols:[{t:'เลขที่ระบบ'},{t:'วันที่'},{t:'ผู้ขาย'},{t:'ใบกำกับผู้ขาย'},{t:'ครบกำหนด'},{t:'ก่อนภาษี',a:'r'},{t:'ภาษีซื้อ',a:'r'},{t:'รวม',a:'r'},{t:'คงเหลือ',a:'r'},{t:'สถานะ'}],
        rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.vendorNo}, thDateNum(d.due),
          {n:d.base}, {n:d.vat}, {n:d.total}, {n:billOutstanding(d)}, statusPill(d.status)]),
        rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
        foot: ['รวม','','','','', {n:t.b}, {n:t.v}, {n:t.t}, {n:liveOnly(rows).reduce((s, d) => s + billOutstanding(d), 0)}, ''],
        empty:'ยังไม่มีรายการซื้อในงวดนี้',
        emptyAction: btn('new:bill', 'บันทึกใบกำกับภาษีซื้อ', 'primary'),
      }),
      foot: 'ระบบกันการบันทึกเลขที่ใบกำกับซ้ำของผู้ขายรายเดียวกันไว้แล้ว',
    });
}

function paymentDetail(no) {
  const d = DB.docs.payment.find((x) => x.no === no);
  if (!d) return '';
  return simpleDocCard({ kind:'payment', doc:d, title:'ใบสำคัญจ่าย',
    sub:'จ่ายวันที่ ' + thDate(d.date) + ' · ' + d.partnerName,
    actions: btn('open:bills:' + d.billNo, 'ดูรายการตั้งหนี้ ' + d.billNo)
      + (d.certNo ? btn('open:whtcert:' + d.certNo, 'ดู 50 ทวิ ' + d.certNo) : ''),
    kv:[['อ้างรายการตั้งหนี้', d.billNo], d.batchNo ? ['ตามใบเตรียมจ่าย', d.batchNo] : null,
      ['ช่องทางนำส่งภาษี', d.channel === 'e_wht' ? 'e-Withholding Tax (ธนาคารนำส่ง)' : 'หักและนำส่งเอง'],
      ['ยอดก่อนหัก', fmt(d.gross)], ['หัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), fmt(d.wht)],
      ['จ่ายสุทธิ', fmt(d.net)], ['หนังสือรับรอง 50 ทวิ', d.certNo || (d.wht ? 'ธนาคารออกให้' : '—')],
      ['สถานะ', isVoid(d) ? 'ยกเลิก' : 'ลงบัญชีแล้ว']],
    foot: isVoid(d) ? 'ยกเลิกแล้ว — ยอดค้างของ ' + d.billNo + ' กลับไปเหมือนก่อนจ่าย' + (d.certNo ? ' และ 50 ทวิ ' + d.certNo + ' ถูกยกเลิกด้วย' : '')
      : 'ยกเลิกใบสำคัญจ่ายแล้ว ระบบยกเลิก 50 ทวิ และตัดออกจากแบบ ภ.ง.ด. ให้ในครั้งเดียว (ถ้ายังไม่ยื่นแบบของเดือนนั้น)',
  });
}

function scPayments() {
  const rows = DB.docs.payment.filter((d) => periodOf(d.date) === STATE.period);
  const t = liveOnly(rows).reduce((s, d) => ({g:s.g + d.gross, w:s.w + d.wht, n:s.n + d.net}), {g:0,w:0,n:0});
  const ewht = liveOnly(rows).filter((d) => d.channel === 'e_wht').length;
  return (STATE.sel ? paymentDetail(STATE.sel) : '') + card({
    title:'ใบสำคัญจ่าย', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'รายการ')
      + (ewht ? ' (นำส่งผ่าน e-Withholding Tax ' + ewht + ' รายการ)' : ''),
    actions: btn('new:payment', '+ จ่ายชำระเจ้าหนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้ขาย'},{t:'อ้างตั้งหนี้'},{t:'ช่องทาง'},{t:'ก่อนหัก',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'หนังสือรับรอง'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName,
        {mono:d.billNo + (d.batchNo ? ' · ' + d.batchNo : '')},
        d.channel === 'e_wht' ? {st:['open','e-Withholding']} : {st:['draft','หักเอง']},
        {n:d.gross}, {n:d.wht}, {n:d.net},
        d.certNo ? {mono:d.certNo} : (d.wht ? {dim:'ธนาคารออกให้'} : {dim:'—'}), statusPill(d.status || 'posted')]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '" title="คลิกเพื่อดูรายละเอียด พิมพ์ หรือยกเลิก"',
      foot: ['รวม','','','','', {n:t.g}, {n:t.w}, {n:t.n}, '', ''],
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
/** การ์ดใบสำคัญ — ใช้ทั้งสมุดรายวันรวมและสมุดรายวันแต่ละเล่ม */
const ENTRY_SOURCE_SCREEN = { invoice:'invoices', receipt:'receipts', creditNote:'creditnotes', debitNote:'debitnotes',
  bill:'bills', payment:'payments', expense:'expenses', goodsReceipt:'goodsreceipts', payroll:'payroll',
  depreciation:'deprec', import:'import' };
function entryCard(no) {
  const e = DB.entries.find((x) => x.no === no);
  if (!e) return '';
  /* ใบสำคัญที่เกิดจากเอกสาร กลับรายการที่ใบสำคัญตรง ๆ ไม่ได้ ต้องไปยกเลิกที่เอกสาร
     ไม่งั้นบัญชีกลับแล้วแต่ลูกหนี้รายตัว สต๊อก และทะเบียนภาษียังค้างอยู่ */
  const from = ENTRY_FROM[e.src];
  const srcAct = ENTRY_SOURCE_SCREEN[e.src];
  return card({
    title:'ใบสำคัญ ' + e.no, sub: thDate(e.date) + ' · ' + JOURNAL_BOOKS[journalOf(e)].label + ' · ' + e.desc,
    actions: printBtn('entry', e.no)
      + (srcAct && e.srcId ? btn('open:' + srcAct + ':' + e.srcId, 'ไปที่' + from[0]) : '')
      + (e.status === 'posted' && !from ? btn('rev:' + e.no, 'กลับรายการ') : '') + btn('sel:', 'ปิด'),
    body: tbl({
      cols:[{t:'#',a:'c'},{t:'รหัสบัญชี'},{t:'ชื่อบัญชี'},{t:'คู่ค้า'},{t:'คำอธิบาย'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'}],
      rows: e.lines.map((l) => [{c:String(l.n)}, {mono:l.acc}, acc(l.acc).name,
        l.partner ? l.partner : {dim:'—'}, l.memo || '', {n:l.dr}, {n:l.cr}]),
      foot: ['','','','','รวม', {n:e.total}, {n:e.total}],
    }),
    foot: e.status === 'reversed'
      ? 'รายการนี้ถูกกลับด้วย ' + e.reversedBy + ' — เหตุผล: ' + (e.reason || '')
      : from && e.status === 'posted'
      ? 'ใบสำคัญนี้เกิดจาก' + from[0] + ' — ' + from[1]
      : 'ใบสำคัญที่ลงบัญชีแล้วแก้ไม่ได้ ถ้าผิดต้องกลับรายการเท่านั้น (พ.ร.บ.การบัญชี 2543 มาตรา 20)'
        + (e.src === 'manual' ? ' · ใบนี้บันทึกด้วยมือ' + (e.srcId ? ' อ้างอิง ' + e.srcId : '') : ''),
  });
}

function scJournals() {
  const rows = DB.entries.filter((e) => periodOf(e.date) === STATE.period
    && (hit(e.no) || hit(e.desc))).slice().reverse();
  return (STATE.sel ? entryCard(STATE.sel) : '') + card({
    title:'สมุดรายวันรวมทุกเล่ม', sub: thPeriod(STATE.period) + ' · ' + rows.length + ' ใบสำคัญ',
    filters: searchBox('ค้นหาเลขที่หรือคำอธิบาย'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'สมุด'},{t:'ประเภท'},{t:'คำอธิบาย'},{t:'ที่มา'},{t:'ยอด',a:'r'},{t:'สถานะ'}],
      rows: rows.map((e) => [{mono:e.no}, thDateNum(e.date), JOURNAL_BOOKS[journalOf(e)].label.replace('สมุดรายวัน', ''),
        JE_TYPE[e.type] || e.type, e.desc, e.srcId ? {mono:e.srcId} : {dim:'—'}, {n:e.total}, statusPill(e.status)]),
      rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
      empty:'ไม่มีใบสำคัญในงวดนี้',
    }),
    foot:'บันทึกรายการด้วยมือได้ที่เมนู บัญชี → สมุดรายวันแต่ละเล่ม',
  });
}

/* ===================================================================
   สมุดรายวันเฉพาะ 5 เล่ม — หน้าตาเหมือนสมุดจริง หัวใบสำคัญตามด้วยเดบิตและเครดิต
   =================================================================== */
const BOOK_SCREEN = { general:'jgeneral', purchase:'jpurchase', sales:'jsales', payment:'jpayment', receipt:'jreceipt' };
const BOOK_NOTE = {
  general: 'รายการที่ไม่ใช่การซื้อขายเงินเชื่อและไม่มีเงินเข้าออก เช่น ตั้งค้างจ่าย ค่าเสื่อมราคา เงินเดือน ปรับปรุง กลับรายการ และโอนเงินระหว่างบัญชีของบริษัทเอง',
  purchase: 'ซื้อเงินเชื่อ — ใบรับสินค้าและตั้งหนี้ผู้ขายลงเล่มนี้ให้เอง บันทึกเองได้เฉพาะรายการที่ไม่มีเงินออก เช่น ตั้งค่าใช้จ่ายค้างจ่าย',
  sales: 'ขายเงินเชื่อ — ใบกำกับภาษี ใบลดหนี้ และใบเพิ่มหนี้ลงเล่มนี้ให้เอง บันทึกเองได้เฉพาะรายการที่ไม่มีเงินเข้า เช่น รายได้ค้างรับ',
  payment: 'ทุกรายการที่มีเงินออก — ใบสำคัญจ่าย ค่าใช้จ่าย ใบเตรียมจ่าย และการนำส่งภาษีลงเล่มนี้ให้เอง',
  receipt: 'ทุกรายการที่มีเงินเข้า — ใบเสร็จรับเงินลงเล่มนี้ให้เอง บันทึกเองได้สำหรับเงินเข้าที่ไม่มีเอกสารขาย เช่น ดอกเบี้ยรับ',
};

function journalBookScreen(book) {
  const cfg = JOURNAL_BOOKS[book];
  /* เรียงตามวันที่แล้วตามเลขที่ เหมือนสมุดที่เขียนต่อกันไปทีละวัน */
  const list = DB.entries.filter((e) => journalOf(e) === book && periodOf(e.date) === STATE.period
    && (hit(e.no) || hit(e.desc) || hit(e.srcId || '')))
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
  const manual = list.filter((e) => e.src === 'manual').length;
  const rows = [];
  let dr = 0, cr = 0;
  list.forEach(function (e) {
    rows.push({ head: e });
    e.lines.forEach(function (l) { rows.push({ line: l }); dr += l.dr; cr += l.cr; });
  });
  return (STATE.sel ? entryCard(STATE.sel) : '') + card({
    title: cfg.label,
    sub: thPeriod(STATE.period) + ' · ' + list.length + ' ใบสำคัญ' + (manual ? ' · บันทึกเอง ' + manual + ' ใบ' : ''),
    actions: btn('jv:' + book, '+ สร้าง' + cfg.voucher, periodIsOpen() ? 'primary' : 'disabled'),
    filters: searchBox('ค้นหาเลขที่ คำอธิบาย หรือเอกสารต้นทาง'),
    body: tbl({
      cols:[{t:'วันที่'},{t:'เลขที่'},{t:'บัญชี / คำอธิบาย'},{t:'อ้างอิง'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'สถานะ'}],
      rows: rows,
      render: function (r) {
        if (r.head) {
          const e = r.head;
          return '<td>' + thDateNum(e.date) + '</td><td class="mono">' + esc(e.no) + '</td>'
            + '<td>' + esc(e.desc) + '</td>'
            + '<td class="mono">' + esc(e.srcId || (e.src === 'manual' ? 'บันทึกเอง' : '')) + '</td>'
            + '<td></td><td></td>' + cell(statusPill(e.status));
        }
        const l = r.line;
        return '<td></td><td></td><td class="' + (l.dr ? 'acc-dr' : 'acc-cr') + '">'
          + '<span class="mono">' + esc(l.acc) + '</span> ' + esc(acc(l.acc).name)
          + (l.partner ? ' <span class="dim">· ' + esc(l.partner) + '</span>' : '') + '</td>'
          + '<td class="dim">' + esc(l.memo || '') + '</td>' + money(l.dr) + money(l.cr) + '<td></td>';
      },
      rowAttr: (r) => (r.head ? 'class="je-h row-link" data-act="sel:' + r.head.no + '"' : 'class="je-l"'),
      foot: ['', '', 'รวม ' + list.length + ' ใบสำคัญ', '', {n:dr}, {n:cr}, ''],
      empty: 'ไม่มีรายการใน' + cfg.label + 'งวดนี้',
      emptyAction: periodIsOpen() ? btn('jv:' + book, 'สร้าง' + cfg.voucher + 'ใบแรก', 'primary') : '',
    }),
    foot: BOOK_NOTE[book] + ' · บัญชีคุม (ลูกหนี้ เจ้าหนี้ ภาษีซื้อ ภาษีขาย ภาษีหัก ณ ที่จ่ายค้างนำส่ง พักรับสินค้า) ต้องเกิดจากเอกสารเท่านั้น',
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
  /* เอกสารที่ยกเลิกยังต้องอยู่ในรายงานภาษี ยอดเป็นศูนย์และเขียนว่า "ยกเลิก" เลขที่จะได้เรียงต่อกันไม่ขาดช่วง */
  const rows = DB.taxTx.filter((t) => t.kind === kind && t.period === STATE.period);
  const voided = rows.filter((t) => t.void).length;
  const base = rows.reduce((s, t) => s + t.base, 0);
  const tax  = rows.reduce((s, t) => s + t.tax, 0);
  const nonClaim = rows.reduce((s, t) => s + (t.nonClaimable || 0), 0);
  return card({
    title: isOut ? 'รายงานภาษีขาย' : 'รายงานภาษีซื้อ',
    sub: thPeriod(STATE.period) + ' · ' + (rows.length - voided) + ' รายการ'
      + (voided ? ' · ยกเลิก ' + voided + ' ใบ' : '') + ' · '
      + (isOut ? 'ตามมาตรา 87 (1)' : 'ตามมาตรา 87 (2)'),
    actions: btn('print', 'พิมพ์'),
    body: tbl({
      cols:[{t:'ลำดับ',a:'c'},{t:'วันที่'},{t:'เลขที่ใบกำกับ'},{t:'ชื่อผู้' + (isOut ? 'ซื้อ' : 'ขาย')},
        {t:'เลขประจำตัวผู้เสียภาษี'},{t:'สาขา'},{t:'มูลค่า',a:'r'},{t:'ภาษี',a:'r'}]
        .concat(isOut ? [] : [{t:'หมายเหตุ'}]),
      rows: rows.map((t, i) => [{c:String(i + 1)}, thDateNum(t.date), {mono:t.docNo},
        t.void ? {html: esc(t.partnerName) + ' <span class="st void">ยกเลิก</span>'}
          : t.partnerName + (t.docType === 'credit_note' ? ' (ใบลดหนี้อ้าง ' + t.refDoc + ')' : '')
            + (t.docType === 'debit_note' ? ' (ใบเพิ่มหนี้อ้าง ' + t.refDoc + ')' : ''),
        {mono:t.taxId}, t.branch === '00000' ? 'สนญ.' : (t.branch || '—'),
        {n:t.base}, {n:t.tax}]
        .concat(isOut ? [] : [t.void ? {dim:'ยกเลิก: ' + (t.voidReason || '')}
          : t.nonClaimable ? {dim:'ภาษีต้องห้าม ' + fmt(t.nonClaimable)} : {dim:'ขอคืนได้'}])),
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
  const out = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === STATE.period && !t.void);
  const inn = DB.taxTx.filter((t) => t.kind === 'vat_input' && t.period === STATE.period && !t.void);
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
      && t.form === F[0] && t.channel === 'manual' && !t.void);
    const excl = DB.taxTx.filter((t) => t.kind === 'wht' && t.period === STATE.period
      && t.form === F[0] && t.channel === 'e_wht' && !t.void);
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
    actions: btn('item:new', '+ เพิ่มสินค้าหรือบริการ', 'primary'),
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
        rowAttr: (r) => 'class="row-link" data-act="item:edit:' + r[0].mono + '"',
        foot: ['','','','','','','','','รวมมูลค่าสินค้าคงเหลือ', {n:value}],
        empty:'ยังไม่มีสินค้าในทะเบียน',
        emptyAction: btn('item:new', 'เพิ่มสินค้ารายการแรก', 'primary'),
      })
      + '<div class="reco"><div><span>มูลค่าตามทะเบียนสินค้า</span><b>' + fmt(value) + '</b></div>'
      + '<div><span>ยอดบัญชีสินค้าคงเหลือในงบทดลอง</span><b>' + fmt(glInv) + '</b></div>'
      + '<div class="gt"><span>ผลต่าง</span><b>' + fmt(value - glInv) + '</b></div></div>',
    foot: (value === glInv ? 'ทะเบียนสินค้าตรงกับบัญชีคุมพอดี'
      : 'ผลต่างเกิดจากยอดยกมาต้นงวดที่ยังไม่ได้แยกรายตัวสินค้า — ตรวจสอบก่อนปิดปี')
      + ' · กดที่แถวเพื่อแก้ไข จำนวนคงเหลือแก้ตรงนี้ไม่ได้ ต้องมาจากเอกสารซื้อขายเท่านั้น',
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
    actions: btn('asset:new', '+ เพิ่มทรัพย์สิน', 'primary'),
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
      rowAttr: (r) => 'class="row-link" data-act="asset:edit:' + r[0].mono + '"',
      foot: ['','','','รวม', {n:cost}, '', {n:accum}, {n:cost - accum}, {n:DB.assets.reduce((s,a)=>s+a.accumTax,0)}],
      empty:'ยังไม่มีทรัพย์สินในทะเบียน — ระบบเชื่อมต่อของ FlowAccount ไม่เปิดให้ดึงส่วนนี้ ต้องกรอกเอง',
      emptyAction: btn('asset:new', 'เพิ่มทรัพย์สินรายการแรก', 'primary'),
    }),
    foot:'กดที่แถวเพื่อแก้ไข · รถยนต์นั่งไม่เกิน 10 คน หักค่าเสื่อมทางภาษีได้จากต้นทุนไม่เกิน 1,000,000 บาท ส่วนที่เกินหักทางบัญชีได้แต่บวกกลับตอนคำนวณภาษี',
  });
}

/** งวดที่ยกเลิกไปแล้วของเดือนนี้ — แสดงไว้ให้เห็นว่าเคยทำแล้วยกเลิก ไม่ใช่หายไปเฉย ๆ */
function voidedRunsNote(coll) {
  const v = DB.docs[coll].filter((r) => r.period === STATE.period && r.status === 'void');
  return v.length ? '<div class="note">งวดนี้เคยทำแล้วยกเลิก ' + v.length + ' ครั้ง: '
    + v.map((r) => esc(r.entryNo) + ' (' + esc(r.voidReason || '') + ')').join(' · ') + '</div>' : '';
}
function scDeprec() {
  const run = DB.docs.depreciation.find((d) => d.period === STATE.period && d.status !== 'void');
  const history = DB.docs.depreciation.filter((d) => d.status !== 'void').slice(0, 12);
  return card({
    title:'ค่าเสื่อมราคาประจำงวด', sub: thPeriod(STATE.period),
    actions: run ? btn('entry:' + run.entryNo, 'ดูใบสำคัญ') + btn('voidrun:depreciation:' + run.period, 'ยกเลิกงวดนี้', 'danger')
                 : btn('run:deprec', 'ตั้งค่าเสื่อมราคางวดนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: voidedRunsNote('depreciation') + (run
      ? tbl({
          cols:[{t:'รหัส'},{t:'ทรัพย์สิน'},{t:'ราคาทุน',a:'r'},{t:'ค่าเสื่อมทางบัญชี',a:'r'},{t:'ค่าเสื่อมทางภาษี',a:'r'},{t:'ผลต่าง',a:'r'},{t:'ราคาตามบัญชีคงเหลือ',a:'r'}],
          rows: run.rows.map((r) => [{mono:r.code}, r.name, {n:r.cost}, {n:r.book}, {n:r.tax}, {n:r.diff}, {n:r.nbvBook}]),
          foot: ['','','รวม', {n:run.bookTotal}, {n:run.taxTotal}, {n:run.diff}, ''],
        })
      : '<div class="empty">ยังไม่ได้ตั้งค่าเสื่อมราคางวดนี้ — เป็นรายการที่บล็อกการปิดงวด'
        + '<div style="margin-top:12px">' + btn('run:deprec', 'ตั้งค่าเสื่อมราคาเดี๋ยวนี้', 'primary') + '</div></div>'),
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
  const run = DB.docs.payRun.find((r) => r.period === STATE.period && r.status !== 'void');
  return card({
    title:'งวดจ่ายเงินเดือน', sub: thPeriod(STATE.period),
    actions: run ? btn('entry:' + run.entryNo, 'ดูใบสำคัญ') + btn('voidrun:payroll:' + run.period, 'ยกเลิกงวดนี้', 'danger')
                 : btn('run:payroll', 'ทำเงินเดือนงวดนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: voidedRunsNote('payRun') + (run
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
        + '<div style="margin-top:12px">' + btn('run:payroll', 'ทำเงินเดือนเดี๋ยวนี้', 'primary') + '</div></div>'),
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
    actions: btn('emp:new', '+ เพิ่มพนักงาน', 'primary'),
    filters: searchBox('ค้นหาชื่อ รหัส หรือแผนก'),
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อ-สกุล'},{t:'แผนก'},{t:'วันเริ่มงาน'},{t:'เงินเดือน',a:'r'},{t:'ชั่วโมงล่วงเวลา',a:'r'},
        {t:'กองทุนสำรองฯ',a:'r'},{t:'ฐานประกันสังคม',a:'r'},{t:'สถานะ'}],
      rows: list.map((e) => [{mono:e.code}, e.name, e.dept, thDateNum(e.hired), {n:e.salary},
        e.otHours ? {c:String(e.otHours)} : {dim:'—'},
        e.pvdRate ? {c:e.pvdRate + '%'} : {dim:'ไม่เข้าร่วม'},
        {n: Math.min(Math.max(e.salary, sso.floor), sso.ceiling)},
        e.active ? {st:['paid','ทำงานอยู่']} : {st:['late','พ้นสภาพ']}]),
      rowAttr: (r) => 'class="row-link" data-act="emp:edit:' + r[0].mono + '"',
      empty:'ยังไม่มีพนักงานในทะเบียน ต้องเพิ่มก่อนทำเงินเดือนงวดแรก',
      emptyAction: btn('emp:new', 'เพิ่มพนักงานคนแรก', 'primary'),
    }),
    foot:'กดที่แถวเพื่อแก้ไข · ข้อมูลพนักงานเป็นข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล ระบบเต็มจำกัดสิทธิ์การเข้าถึงเป็นรายบทบาทและบันทึกทุกครั้งที่มีการเปิดดู',
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
      + '<p><b>Financii</b> คือระบบบัญชีที่ยึดหลักว่า <b>ตัวเลขต้องถูกตั้งแต่ตอนบันทึก ไม่ใช่ตอนแก้</b> '
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
/* ===================================================================
   ใบเพิ่มหนี้ — มาตรา 86/9
   =================================================================== */
function scDebitNotes() {
  const rows = DB.docs.debitNote.filter((d) => periodOf(d.date) === STATE.period);
  const t = liveOnly(rows).reduce((a, d) => ({ base:a.base + d.base, vat:a.vat + d.vat, total:a.total + d.total }), {base:0,vat:0,total:0});
  return (STATE.sel ? noteDetail('debitNote', STATE.sel) : '') + card({
    title:'ใบเพิ่มหนี้', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'ฉบับ') + ' · ใช้เมื่อเก็บเงินต่ำกว่าที่ควร ต้องอ้างใบกำกับเดิมและเข้าเหตุตามมาตรา 86/9',
    actions: btn('new:debitnote', '+ ออกใบเพิ่มหนี้', periodIsOpen() ? 'primary' : 'disabled'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'อ้างใบกำกับเดิม'},{t:'เหตุตามกฎหมาย'},{t:'มูลค่า',a:'r'},{t:'ภาษี',a:'r'},{t:'รวม',a:'r'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.invoiceNo},
        d.reasonText, {n:d.base}, {n:d.vat}, {n:d.total}, statusPill(d.status || 'posted')]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '" title="คลิกเพื่อดูรายละเอียด พิมพ์ หรือยกเลิก"',
      foot: rows.length ? ['รวม','','','','', {n:t.base}, {n:t.vat}, {n:t.total}, ''] : null,
      empty:'ไม่มีใบเพิ่มหนี้ในงวดนี้',
    }),
    foot:'กดออกใบเพิ่มหนี้แล้วเลือกใบกำกับเดิม หรือออกจากหน้าใบกำกับภาษีก็ได้ · ภาษีขายที่เพิ่มเข้ารายงานเดือนที่ออกใบเพิ่มหนี้',
  });
}

/* ===================================================================
   เอกสารก่อนลงบัญชี — ใบเสนอราคา ใบสั่งขาย ใบสั่งซื้อ
   ไม่มีตัวเลขเข้าบัญชี จึงไม่ผูกกับงวด แสดงทุกใบที่ยังเดินอยู่
   =================================================================== */
/* สถานะร่วมกับเอกสารอื่นทั้งระบบ แต่คำอธิบายต้องเป็นภาษาของเอกสารใบนั้น
   "ปิดแล้ว" บนใบเสนอราคาไม่สื่อ ต้องบอกว่าแปลงไปเป็นเอกสารถัดไปแล้ว */
const TRADE_LABEL = { closed:'แปลงเป็นเอกสารถัดไปแล้ว', approved:'ตอบรับแล้ว' };
function tradePill(st) {
  const p = statusPill(st);
  return TRADE_LABEL[st] ? { st: [p.st[0], TRADE_LABEL[st]] } : p;
}

function tradeDocDetail(kind, no) {
  const cfg = TRADE_DOCS[kind];
  const d = (DB.docs[kind] || []).find((x) => x.no === no);
  if (!d) return '';
  const st = tradeDocStatus(kind, d);
  const live = st === 'issued' || st === 'approved';
  const partial = st === 'partially_received';
  const got = kind === 'purchaseOrder' ? poReceived(d) : null;
  const nextLabel = cfg.next === 'salesOrder' ? 'แปลงเป็นใบสั่งขาย'
    : cfg.next === 'invoice' ? 'แปลงเป็นใบกำกับภาษี' : 'ตั้งหนี้ผู้ขาย';
  return card({
    title: cfg.label + ' เลขที่ ' + d.no,
    sub: 'ออกวันที่ ' + thDate(d.date)
      + (d.validUntil ? ' · ยืนราคาถึง ' + thDate(d.validUntil) : '')
      + (d.fromDoc ? ' · มาจาก ' + d.fromDoc : ''),
    actions: ((live || partial) && kind === 'purchaseOrder' ? btn('grn:po:' + d.no, partial ? 'รับสินค้าส่วนที่เหลือ' : 'รับสินค้าเข้าคลัง', 'primary') : '')
      + (live ? btn('trade:' + kind + ':convert:' + d.no, nextLabel, kind === 'purchaseOrder' ? '' : 'primary') : '')
      + (st === 'issued' ? btn('trade:' + kind + ':approved:' + d.no,
          kind === 'purchaseOrder' ? 'ผู้ขายยืนยันแล้ว' : 'ลูกค้าตอบรับ') : '')
      + (live ? btn('trade:' + kind + ':cancelled:' + d.no, 'ยกเลิก') : '')
      + (partial ? btn('trade:' + kind + ':cancelled:' + d.no, 'ยกเลิกส่วนที่ยังไม่ได้รับ') : '')
      + printBtn(kind, d.no) + btn('sel:', 'ปิด'),
    body:
      '<div class="docgrid">'
      + '<div><div class="dim">' + (cfg.side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย') + '</div>'
      + '<b>' + esc(d.partnerName) + '</b>'
      + '<div>' + esc(d.snap ? d.snap.address : '') + '</div></div>'
      + '<div><div class="dim">สถานะ</div><b>' + esc(tradePill(st).st[1]) + '</b>'
      + (d.convertedTo ? '<div>เอกสารปลายทาง ' + esc(d.convertedTo) + '</div>' : '')
      + (got && (d.grnNos || []).length && !d.convertedTo ? '<div>ใบรับสินค้า ' + esc(d.grnNos.join(', ')) + '</div>' : '')
      + (d.statusReason ? '<div>' + esc(d.statusReason) + '</div>' : '') + '</div>'
      + '</div>'
      + tbl({
          cols:[{t:'รายการ'},{t:'จำนวน',a:'r'}].concat(got ? [{t:'รับแล้ว',a:'r'},{t:'ค้างรับ',a:'r'}] : [])
            .concat([{t:'ราคาต่อหน่วย',a:'r'},{t:'ภาษี'},{t:'จำนวนเงิน',a:'r'}]),
          rows: d.lines.map((l, i) => [l.desc, {n:M(String(l.qty))}]
            .concat(got ? [{n:M(String(got[i]))}, {n:M(String(roundQty(l.qty - got[i])))}] : [])
            .concat([{n:l.price}, l.taxCode === 'VAT7' ? 'VAT 7%' : l.taxCode === 'VAT0' ? 'อัตรา 0%' : 'ยกเว้น', {n:l.amount}])),
        })
      + '<div class="totals">'
      + '<div><span>มูลค่าก่อนภาษี</span><b>' + fmt(d.base) + '</b></div>'
      + '<div><span>ภาษีมูลค่าเพิ่ม</span><b>' + fmt(d.vat) + '</b></div>'
      + '<div class="gt"><span>จำนวนเงินรวมทั้งสิ้น</span><b>' + fmt(d.total) + '</b></div>'
      + '</div>',
    foot:'เอกสารใบนี้ยังไม่มีผลทางบัญชี ตัวเลขจะเข้าบัญชีเมื่อกด' + nextLabel + 'เท่านั้น',
  });
}

function tradeDocScreen(kind) {
  const cfg = TRADE_DOCS[kind];
  const all = DB.docs[kind] || [];
  const rows = all.filter((d) => hit(d.no) || hit(d.partnerName));
  const openN = all.filter((d) => tradeDocStatus(kind, d) === 'issued').length;
  const newAct = { quotation:'quotation', salesOrder:'salesorder', purchaseOrder:'purchaseorder' }[kind];
  return (STATE.sel ? tradeDocDetail(kind, STATE.sel) : '')
    + card({
      title: 'ทะเบียน' + cfg.label,
      sub: all.length + ' ฉบับ · ยังรอผลอยู่ ' + openN + ' ฉบับ',
      actions: btn('new:' + newAct, '+ ออก' + cfg.label, 'primary'),
      filters: searchBox('ค้นหาเลขที่หรือชื่อคู่ค้า'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t: cfg.side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย'}]
          .concat(cfg.validDays ? [{t:'ยืนราคาถึง'}] : [])
          .concat([{t:'ก่อนภาษี',a:'r'},{t:'รวม',a:'r'},{t:'สถานะ'},{t:'เอกสารปลายทาง'}]),
        rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName]
          .concat(cfg.validDays ? [thDateNum(d.validUntil)] : [])
          .concat([{n:d.base}, {n:d.total}, tradePill(tradeDocStatus(kind, d)),
            d.convertedTo ? {mono:d.convertedTo} : '—'])),
        rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
        empty:'ยังไม่มี' + cfg.label,
        emptyAction: btn('new:' + newAct, 'ออก' + cfg.label + 'ใบแรก', 'primary'),
      }),
      foot: cfg.next === 'bill'
        ? 'ใบสั่งซื้อยังไม่ก่อหนี้ — ของเข้าคลังเมื่อออกใบรับสินค้า ยอดเข้าเจ้าหนี้เมื่อได้รับใบกำกับภาษีจากผู้ขายแล้วกดตั้งหนี้'
        : 'เอกสารกลุ่มนี้ยังไม่มีผลทางบัญชี จึงไม่ปรากฏในงบทดลองจนกว่าจะแปลงเป็นใบกำกับภาษี',
    });
}

/* ===================================================================
   ใบวางบิล
   =================================================================== */
const BN_LABEL = { issued:['open','รอรับชำระ'], partially_paid:['wait','รับชำระบางส่วน'],
  paid:['paid','รับชำระครบ'], cancelled:['late','ยกเลิก'] };
function bnPill(bn) {
  const st = billingNoteStatus(bn);
  if ((st === 'issued' || st === 'partially_paid') && bn.dueDate < TODAY) return { st:['late','เลยวันนัดชำระ'] };
  return { st: BN_LABEL[st] };
}

function billingNoteDetail(no) {
  const bn = DB.docs.billingNote.find((x) => x.no === no);
  if (!bn) return '';
  const st = billingNoteStatus(bn);
  const open = st === 'issued' || st === 'partially_paid';
  const out = billingNoteOutstanding(bn);
  const rcs = DB.docs.receipt.filter((r) => r.billingNoteNo === bn.no);
  return card({
    title:'ใบวางบิล เลขที่ ' + bn.no,
    sub:'วางบิลวันที่ ' + thDate(bn.date) + ' · นัดชำระ ' + thDate(bn.dueDate) + ' · ' + bnPill(bn).st[1],
    actions: (open ? btn('bn:receive:' + bn.no, 'รับชำระตามใบวางบิล', 'primary')
        + btn('bn:cancel:' + bn.no, 'ยกเลิก') : '')
      + printBtn('billingNote', bn.no) + btn('sel:', 'ปิด'),
    body:
      '<div class="docgrid">'
      + '<div><div class="dim">ผู้วางบิล</div><b>' + esc(DB.company.name) + '</b>'
      + '<div>' + esc(DB.company.address) + '</div></div>'
      + '<div><div class="dim">ลูกค้า</div><b>' + esc(bn.partnerName) + '</b>'
      + '<div>' + esc(bn.snap ? bn.snap.address : '') + '</div>'
      + (bn.note ? '<div>' + esc(bn.note) + '</div>' : '') + '</div>'
      + '</div>'
      + tbl({
        cols:[{t:'ใบกำกับภาษี'},{t:'วันที่'},{t:'ครบกำหนด'},{t:'ยอดตามใบกำกับ',a:'r'},{t:'ยอดที่วางบิล',a:'r'},{t:'คงค้างตอนนี้',a:'r'}],
        rows: bn.invoices.map(function (r) {
          const inv = DB.docs.invoice.find((d) => d.no === r.no);
          return [{mono:r.no}, thDateNum(r.date), thDateNum(r.due), {n:r.total}, {n:r.amount},
            {n: inv ? Math.max(0, invOutstanding(inv)) : 0}];
        }),
        foot: ['รวม ' + bn.invoices.length + ' ใบ', '', '', '', {n:bn.total}, {n:out}],
      })
      + '<div class="totals">'
      + '<div><span>ยอดวางบิล</span><b>' + fmt(bn.total) + '</b></div>'
      + '<div><span>รับชำระแล้ว</span><b>' + fmt(Math.max(0, bn.total - out)) + '</b></div>'
      + '<div class="gt"><span>คงเหลือต้องเก็บ</span><b>' + fmt(st === 'cancelled' ? 0 : out) + '</b></div>'
      + '</div>'
      + (rcs.length ? '<div class="sub-h">ใบเสร็จรับเงินที่ออกตามใบวางบิลนี้</div>' + tbl({
          cols:[{t:'เลขที่'},{t:'วันที่'},{t:'อ้างใบกำกับ'},{t:'รับก่อนหัก',a:'r'},{t:'ถูกหัก ณ ที่จ่าย',a:'r'},{t:'รับสุทธิ',a:'r'}],
          rows: rcs.map((r) => [{mono:r.no}, thDateNum(r.date), {mono:r.invoiceNo}, {n:r.gross}, {n:r.wht}, {n:r.net}]) }) : '')
      + (bn.statusReason ? '<div class="note">เหตุผลที่ยกเลิก: ' + esc(bn.statusReason) + '</div>' : ''),
    foot:'ใบวางบิลไม่มีผลทางบัญชี — ตัวเลขเข้าบัญชีตอนรับชำระ ซึ่งระบบออกใบเสร็จให้ทุกใบกำกับในคราวเดียว',
  });
}

function scBillingNotes() {
  const all = DB.docs.billingNote;
  const rows = all.filter((b) => hit(b.no) || hit(b.partnerName));
  const waiting = all.filter((b) => ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0);
  return (STATE.sel ? billingNoteDetail(STATE.sel) : '')
    + card({
      title:'ใบวางบิล',
      sub: all.length + ' ฉบับ · รอเก็บเงิน ' + waiting.length + ' ฉบับ รวม '
        + fmt(waiting.reduce((s, b) => s + billingNoteOutstanding(b), 0)) + ' บาท',
      actions: btn('new:billingnote', '+ ออกใบวางบิล', 'primary'),
      filters: searchBox('ค้นหาเลขที่หรือชื่อลูกค้า'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่วางบิล'},{t:'ลูกค้า'},{t:'นัดชำระ'},{t:'ใบกำกับ',a:'c'},{t:'ยอดวางบิล',a:'r'},{t:'คงค้าง',a:'r'},{t:'สถานะ'}],
        rows: rows.map((b) => [{mono:b.no}, thDateNum(b.date), b.partnerName, thDateNum(b.dueDate),
          {c:String(b.invoices.length)}, {n:b.total},
          {n: billingNoteStatus(b) === 'cancelled' ? 0 : billingNoteOutstanding(b)}, bnPill(b)]),
        rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
        empty:'ยังไม่มีใบวางบิล',
        emptyAction: btn('new:billingnote', 'ออกใบวางบิลใบแรก', 'primary'),
      }),
      foot:'รวบใบกำกับที่ค้างชำระของลูกค้ารายเดียวไปวางเก็บเงินครั้งเดียว · ใบกำกับหนึ่งใบอยู่ได้ในใบวางบิลที่ยังเปิดอยู่ใบเดียว',
    });
}

/* ===================================================================
   ใบรับสินค้า
   =================================================================== */
const GRN_LABEL = { received:['wait','รอใบกำกับจากผู้ขาย'], closed:['paid','ตั้งหนี้แล้ว'], void:['void','ยกเลิก'] };

function goodsReceiptDetail(no) {
  const g = DB.docs.goodsReceipt.find((x) => x.no === no);
  if (!g) return '';
  return card({
    title:'ใบรับสินค้า เลขที่ ' + g.no,
    sub:'รับวันที่ ' + thDate(g.date) + ' · ' + g.partnerName
      + (g.vendorDoNo ? ' · ใบส่งของ ' + g.vendorDoNo : '') + (g.poNo ? ' · จากใบสั่งซื้อ ' + g.poNo : ''),
    actions: (g.status === 'received' ? btn('grn:bill:' + g.no, 'ตั้งหนี้จากใบรับสินค้า', 'primary') : '')
      + (g.billNo ? btn('open:bills:' + g.billNo, 'ดูรายการตั้งหนี้') : '')
      + printBtn('goodsReceipt', g.no) + btn('entry:' + g.entryNo, 'ดูใบสำคัญ') + voidBtn('goodsReceipt', g) + btn('sel:', 'ปิด'),
    body: voidBanner(g) + tbl({
      cols:[{t:'รหัสสินค้า'},{t:'รายการ'},{t:'จำนวน',a:'r'},{t:'หน่วย'},{t:'ต้นทุนต่อหน่วย',a:'r'},{t:'มูลค่า',a:'r'}],
      rows: g.lines.map((l) => [{mono:l.itemCode}, l.desc, {n:M(String(l.qty))}, l.uom || '', {n:l.price}, {n:l.amount}]),
    })
    + '<div class="totals">'
    + '<div class="gt"><span>มูลค่ารับเข้าคลัง (ก่อนภาษี)</span><b>' + fmt(g.total) + '</b></div>'
    + '<div><span>สถานะ</span><b>' + (isVoid(g) ? 'ยกเลิก — นำสินค้าออกจากคลังแล้ว'
        : g.billNo ? 'ตั้งหนี้แล้ว ' + esc(g.billNo) + ' วันที่ ' + thDateNum(g.billDate)
        : 'รอใบกำกับภาษีจากผู้ขาย') + '</b></div>'
    + '</div>',
    foot:'รับของ: Dr สินค้าคงเหลือ / Cr พักรับสินค้า · ตั้งหนี้: Dr พักรับสินค้า + ภาษีซื้อ / Cr เจ้าหนี้ — ภาษีซื้อเกิดเมื่อได้ใบกำกับภาษีเท่านั้น',
  });
}

function scGoodsReceipts() {
  const rows = DB.docs.goodsReceipt.filter((g) => (periodOf(g.date) === STATE.period || g.status === 'received')
    && (hit(g.no) || hit(g.partnerName) || hit(g.vendorDoNo || '') || hit(g.poNo || '')));
  const waiting = DB.docs.goodsReceipt.filter((g) => g.status === 'received');
  return (STATE.sel ? goodsReceiptDetail(STATE.sel) : '')
    + card({
      title:'ใบรับสินค้า',
      sub: thPeriod(STATE.period) + ' · รอใบกำกับจากผู้ขาย ' + waiting.length + ' ใบ รวม '
        + fmt(waiting.reduce((s, g) => s + g.total, 0)) + ' บาท',
      actions: btn('new:goodsreceipt', '+ ออกใบรับสินค้า', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาเลขที่ ผู้ขาย ใบส่งของ หรือใบสั่งซื้อ'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่รับ'},{t:'ผู้ขาย'},{t:'ใบส่งของผู้ขาย'},{t:'อ้างใบสั่งซื้อ'},{t:'มูลค่า',a:'r'},{t:'สถานะ'},{t:'ตั้งหนี้'}],
        rows: rows.map((g) => [{mono:g.no}, thDateNum(g.date), g.partnerName,
          g.vendorDoNo ? {mono:g.vendorDoNo} : {dim:'—'}, g.poNo ? {mono:g.poNo} : {dim:'—'},
          {n:g.total}, { st: GRN_LABEL[g.status] || ['draft', g.status] }, g.billNo ? {mono:g.billNo} : {dim:'—'}]),
        rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
        empty:'ยังไม่มีใบรับสินค้าในงวดนี้',
        emptyAction: periodIsOpen() ? btn('new:goodsreceipt', 'ออกใบรับสินค้าใบแรก', 'primary') : '',
      }),
      foot:'รับสินค้าได้ทั้งจากใบสั่งซื้อ (ปุ่มรับสินค้าเข้าคลังในหน้าใบสั่งซื้อ) หรือออกใหม่ที่นี่ · ยอดที่รอใบกำกับต้องเท่ากับบัญชีพักรับสินค้า ระบบตรวจให้ก่อนปิดงวด',
    });
}

/* ===================================================================
   ค่าใช้จ่าย — จ่ายทันที และผูกกับหนังสือรับรองหัก ณ ที่จ่าย
   =================================================================== */
const PAY_METHOD = { transfer:'โอนเงิน', cheque:'เช็ค', cash:'เงินสด' };

function expenseDetail(no) {
  const e = DB.docs.expense.find((x) => x.no === no);
  if (!e) return '';
  const p = DB.partners.find((x) => x.code === e.partnerCode) || {};
  return card({
    title:'ค่าใช้จ่าย เลขที่ ' + e.no,
    sub:'จ่ายวันที่ ' + thDate(e.date) + ' · ' + (PAY_METHOD[e.method] || e.method) + ' จาก ' + acc(e.payFrom).name,
    actions: (e.certNo ? btn('open:whtcert:' + e.certNo, 'ดูหนังสือรับรอง ' + e.certNo) : '')
      + printBtn('expense', e.no) + btn('entry:' + e.entryNo, 'ดูใบสำคัญ') + voidBtn('expense', e) + btn('sel:', 'ปิด'),
    body: voidBanner(e)
      + '<div class="docgrid">'
      + '<div><div class="dim">ผู้รับเงิน</div><b>' + esc(e.partnerName) + '</b>'
      + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(p.taxId || '—') + '</div></div>'
      + '<div><div class="dim">หลักฐาน</div><b>' + (e.taxInvoiceNo ? 'ใบกำกับภาษีเลขที่ ' + esc(e.taxInvoiceNo) : 'ไม่มีใบกำกับภาษี') + '</b>'
      + (e.note ? '<div>' + esc(e.note) + '</div>' : '') + '</div>'
      + '</div>'
      + tbl({
        cols:[{t:'รายการ'},{t:'บันทึกเข้าบัญชี'},{t:'จำนวน',a:'r'},{t:'ราคาต่อหน่วย',a:'r'},{t:'ภาษี'},{t:'จำนวนเงิน',a:'r'}],
        rows: e.lines.map((l) => [l.desc, l.acc + ' ' + l.accName, {n:M(String(l.qty))}, {n:l.price},
          l.taxCode === 'VAT7' ? 'VAT 7%' : l.taxCode === 'VAT0' ? 'อัตรา 0%' : 'ยกเว้น', {n:l.amount}]),
      })
      + '<div class="totals">'
      + '<div><span>มูลค่าก่อนภาษี</span><b>' + fmt(e.base) + '</b></div>'
      + '<div><span>ภาษีซื้อ' + (e.vat ? (e.claimable ? ' (ขอคืนได้)' : ' (ต้องห้าม — เป็นค่าใช้จ่าย)') : '') + '</span><b>' + fmt(e.vat) + '</b></div>'
      + '<div class="gt"><span>รวมทั้งสิ้น</span><b>' + fmt(e.total) + '</b></div>'
      + '<div><span>หักภาษี ณ ที่จ่าย' + (e.whtRate ? ' ' + e.whtRate + '%' : '') + '</span><b>' + fmt(e.wht) + '</b></div>'
      + '<div class="gt"><span>จ่ายสุทธิ</span><b>' + fmt(e.net) + '</b></div>'
      + '</div>'
      + (e.wht ? '<div class="note">' + (e.certNo
          ? 'หักภาษี ณ ที่จ่ายแล้ว ระบบออกหนังสือรับรอง 50 ทวิ เลขที่ ' + esc(e.certNo) + ' ในแถบหัก ณ ที่จ่ายให้อัตโนมัติ และจะเข้าแบบ ' + (p.entityType === 'individual' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53') + ' ของงวดนี้'
          : 'นำส่งผ่าน e-Withholding Tax — ธนาคารนำส่งและออกหลักฐานให้ ระบบจึงไม่ออก 50 ทวิ ซ้ำ') + '</div>' : ''),
    foot: isVoid(e) ? 'ยกเลิกแล้ว — ใบสำคัญถูกกลับรายการ ณ วันที่เดิม' + (e.certNo ? ' และ 50 ทวิ ' + e.certNo + ' ถูกยกเลิกด้วย' : '')
      : 'ค่าใช้จ่ายที่ลงบัญชีแล้วแก้ไม่ได้ ถ้าผิดให้กดยกเลิกเอกสาร ระบบจะยกเลิก 50 ทวิ และภาษีซื้อให้ด้วย แล้วบันทึกใหม่',
  });
}

function scExpenses() {
  const rows = DB.docs.expense.filter((e) => periodOf(e.date) === STATE.period
    && (hit(e.no) || hit(e.partnerName) || hit(e.taxInvoiceNo || '') || e.lines.some((l) => hit(l.desc))));
  const t = liveOnly(rows).reduce((a, e) => ({ b:a.b + e.base, v:a.v + e.vat, w:a.w + e.wht, n:a.n + e.net }), {b:0,v:0,w:0,n:0});
  return (STATE.sel ? expenseDetail(STATE.sel) : '')
    + card({
      title:'ค่าใช้จ่าย', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'รายการ') + ' · หัก ณ ที่จ่ายรวม ' + fmt(t.w) + ' บาท',
      actions: btn('new:expense', '+ บันทึกค่าใช้จ่าย', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาเลขที่ ผู้รับเงิน เลขใบกำกับ หรือรายการ'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้รับเงิน'},{t:'รายการ'},{t:'ก่อนภาษี',a:'r'},{t:'ภาษีซื้อ',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'50 ทวิ'}],
        rows: rows.map((e) => [{mono:e.no}, thDateNum(e.date), e.partnerName,
          e.lines[0].desc + (e.lines.length > 1 ? ' และอีก ' + (e.lines.length - 1) + ' รายการ' : ''),
          {n:e.base}, {n:e.vat}, {n:e.wht}, {n:e.net},
          e.certNo ? {mono:e.certNo} : (e.wht ? {dim:'ธนาคารออกให้'} : {dim:'—'})]),
        rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
        foot: ['รวม','','','', {n:t.b}, {n:t.v}, {n:t.w}, {n:t.n}, ''],
        empty:'ยังไม่มีค่าใช้จ่ายในงวดนี้',
        emptyAction: periodIsOpen() ? btn('new:expense', 'บันทึกค่าใช้จ่ายรายการแรก', 'primary') : '',
      }),
      foot:'ค่าใช้จ่ายที่จ่ายทันที · ถ้ามีหัก ณ ที่จ่าย ระบบออกหนังสือรับรอง 50 ทวิ ให้เองในแถบหัก ณ ที่จ่าย · ซื้อเงินเชื่อให้ตั้งหนี้ผู้ขาย แล้วจ่ายผ่านเตรียมจ่ายเงิน',
    });
}

/* ===================================================================
   หัก ณ ที่จ่าย — หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)
   =================================================================== */
function whtCertDetail(no) {
  const c = DB.docs.whtCert.find((x) => x.no === no);
  if (!c) return '';
  const src = c.expenseNo ? ['expenses', c.expenseNo, 'ค่าใช้จ่าย']
    : c.paymentNo ? ['payments', c.paymentNo, 'ใบสำคัญจ่าย'] : null;
  const pv = c.paymentNo ? DB.docs.payment.find((x) => x.no === c.paymentNo) : null;
  return card({
    title:'หนังสือรับรองการหักภาษี ณ ที่จ่าย เลขที่ ' + c.no,
    sub:'ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร · ลงวันที่ ' + thDate(c.date),
    actions: (c.expenseNo ? btn('open:expenses:' + c.expenseNo, 'ดูค่าใช้จ่าย ' + c.expenseNo) : '')
      + (pv ? btn('open:bills:' + pv.billNo, 'ดูรายการตั้งหนี้ ' + pv.billNo) : '')
      + printBtn('whtCert', c.no) + btn('sel:', 'ปิด'),
    body: (isVoid(c) ? '<div class="void-banner"><b>ยกเลิกแล้ว</b><span>เพราะยกเลิก'
        + (c.expenseNo ? 'ค่าใช้จ่าย ' + esc(c.expenseNo) : 'ใบสำคัญจ่าย ' + esc(c.paymentNo || '')) + ' — ไม่เข้าแบบ ' + esc(c.form) + '</span></div>' : '')
      + '<div class="docgrid">'
      + '<div><div class="dim">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div><b>' + esc(DB.company.name) + '</b>'
      + '<div>' + esc(DB.company.address) + '</div>'
      + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(DB.company.taxId) + '</div></div>'
      + '<div><div class="dim">ผู้ถูกหักภาษี ณ ที่จ่าย</div><b>' + esc(c.partnerName) + '</b>'
      + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(c.taxId || '—') + '</div>'
      + '<div>ยื่นในแบบ ' + esc(c.form) + '</div></div>'
      + '</div>'
      + tbl({
        cols:[{t:'ประเภทเงินได้'},{t:'วันที่จ่าย'},{t:'อัตรา',a:'r'},{t:'จำนวนเงินที่จ่าย',a:'r'},{t:'ภาษีที่หักและนำส่ง',a:'r'}],
        rows: [[c.incomeType, thDateNum(c.date), {c:c.rate + '%'}, {n:c.base}, {n:c.wht}]],
      })
      + (src ? '<div class="note">ออกจาก' + src[2] + 'เลขที่ ' + esc(src[1]) + ' โดยอัตโนมัติ — สองเอกสารนี้ผูกกัน ยอดตรงกันเสมอ</div>' : ''),
    foot:'ผู้จ่ายเงินหักภาษีไว้และนำส่งเอง · ภาษีรายการนี้เข้าแบบ ' + c.form + ' ของงวด ' + thPeriod(periodOf(c.date)),
  });
}

function scWhtCert() {
  const rows = DB.docs.whtCert.filter((c) => periodOf(c.date) === STATE.period
    && (hit(c.no) || hit(c.partnerName) || hit(c.expenseNo || '') || hit(c.paymentNo || '')));
  const ewht = DB.taxTx.filter((t) => t.kind === 'wht' && t.period === STATE.period && t.channel === 'e_wht' && !t.void);
  return (STATE.sel ? whtCertDetail(STATE.sel) : '')
    + card({
      title:'หัก ณ ที่จ่าย — หนังสือรับรอง 50 ทวิ',
      sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'ฉบับ'),
      actions: btn('new:whtcert', '+ ออกหนังสือรับรองหัก ณ ที่จ่าย', periodIsOpen() ? 'primary' : 'disabled'),
      filters: searchBox('ค้นหาเลขที่ ผู้ถูกหัก หรือเอกสารต้นทาง'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้ถูกหักภาษี'},{t:'เลขประจำตัวผู้เสียภาษี'},{t:'ยื่นในแบบ'},{t:'ประเภทเงินได้'},{t:'อัตรา',a:'r'},{t:'ฐานภาษี',a:'r'},{t:'ภาษีที่หัก',a:'r'},{t:'ออกจาก'}],
        rows: rows.map((c) => [{mono:c.no}, thDateNum(c.date), c.partnerName, {mono:c.taxId},
          c.form, c.incomeType, {c:c.rate + '%'}, {n:c.base}, {n:c.wht},
          {mono: c.expenseNo || c.paymentNo || '—'}]),
        rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
        foot: ['','','','','','','รวม', {n:liveOnly(rows).reduce((s, c) => s + c.base, 0)}, {n:liveOnly(rows).reduce((s, c) => s + c.wht, 0)}, ''],
        empty:'ไม่มีหนังสือรับรองที่ต้องออกในงวดนี้',
        emptyAction: periodIsOpen() ? btn('new:whtcert', 'ออกหนังสือรับรองฉบับแรก', 'primary') : '',
      })
      + (ewht.length ? '<div class="note">อีก ' + ewht.length + ' รายการ รวม ' + fmt(ewht.reduce((s, t) => s + t.tax, 0))
          + ' บาท นำส่งผ่าน e-Withholding Tax — ธนาคารออกหลักฐานให้ผู้รับเงินโดยตรง ระบบจึงไม่ออก 50 ทวิ ซ้ำ</div>' : ''),
      foot:'ทุกฉบับผูกกับการจ่ายเงินจริง — บันทึกค่าใช้จ่ายหรือจ่ายชำระเจ้าหนี้ที่มีหัก ณ ที่จ่าย ระบบออกให้ในแถบนี้เองอัตโนมัติ',
    });
}

/* ===================================================================
   เตรียมจ่ายเงิน
   =================================================================== */
const PB_LABEL = { pending_approval:['wait','รออนุมัติ'], approved:['open','อนุมัติแล้ว รอจ่าย'],
  paid:['paid','จ่ายแล้ว'], cancelled:['late','ยกเลิก'] };

function paymentBatchDetail(no) {
  const b = DB.docs.paymentBatch.find((x) => x.no === no);
  if (!b) return '';
  return card({
    title:'ใบเตรียมจ่าย เลขที่ ' + b.no,
    sub:'จัดทำ ' + thDate(b.date) + ' · กำหนดจ่าย ' + thDate(b.payDate) + ' · ' + PB_LABEL[b.status][1]
      + (b.paidDate ? ' เมื่อ ' + thDate(b.paidDate) : ''),
    actions: (b.status === 'pending_approval' ? btn('pb:approve:' + b.no, 'อนุมัติ', 'primary') : '')
      + (b.status === 'approved' ? btn('pb:pay:' + b.no, 'จ่ายตามใบเตรียมจ่าย', 'primary') : '')
      + (paymentBatchActive(b) ? btn('pb:cancel:' + b.no, 'ยกเลิก') : '')
      + printBtn('paymentBatch', b.no) + btn('sel:', 'ปิด'),
    body: tbl({
      cols:[{t:'ตั้งหนี้'},{t:'ผู้ขาย'},{t:'ใบกำกับผู้ขาย'},{t:'ครบกำหนด'},{t:'ยอดจ่าย',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'ใบสำคัญจ่าย'}],
      rows: b.items.map((i) => [{mono:i.billNo}, i.partnerName, {mono:i.vendorNo}, thDateNum(i.due),
        {n:i.amount}, {n:i.wht}, {n:i.net},
        i.paymentNo ? {mono:i.paymentNo} : i.skipped ? {dim:i.skipped} : {dim:'—'}]),
      foot: ['รวม ' + b.items.length + ' ราย', '', '', '', {n:b.total}, {n:b.wht}, {n:b.net}, ''],
    })
    + '<div class="totals">'
    + '<div><span>ยอดตั้งหนี้ที่จะจ่าย</span><b>' + fmt(b.total) + '</b></div>'
    + '<div><span>หักภาษี ณ ที่จ่าย (ประมาณ)</span><b>' + fmt(b.wht) + '</b></div>'
    + '<div class="gt"><span>เงินที่ต้องเตรียม</span><b>' + fmt(b.net) + '</b></div>'
    + '</div>'
    + (b.statusReason ? '<div class="note">เหตุผลที่ยกเลิก: ' + esc(b.statusReason) + '</div>' : ''),
    foot:'จัดทำ → อนุมัติ → จ่าย · ตอนจ่าย ระบบออกใบสำคัญจ่ายทุกรายการ และออก 50 ทวิ ให้รายที่ต้องหักภาษีโดยอัตโนมัติ',
  });
}

function scPaymentPrep() {
  const all = DB.docs.paymentBatch;
  const rows = all.filter((b) => hit(b.no) || b.items.some((i) => hit(i.partnerName) || hit(i.billNo)));
  const pending = all.filter((b) => b.status === 'pending_approval');
  const approved = all.filter((b) => b.status === 'approved');
  const inBatch = new Set();
  all.filter(paymentBatchActive).forEach((b) => b.items.forEach((i) => inBatch.add(i.billNo)));
  const due = DB.docs.bill.filter((b) => billOutstanding(b) > 0 && !inBatch.has(b.no))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  return (STATE.sel ? paymentBatchDetail(STATE.sel) : '')
    + card({
      title:'เตรียมจ่ายเงิน',
      sub:'รออนุมัติ ' + pending.length + ' ใบ · อนุมัติแล้วรอจ่าย ' + approved.length + ' ใบ · เงินที่ต้องเตรียม '
        + fmt(pending.concat(approved).reduce((s, b) => s + b.net, 0)) + ' บาท',
      actions: btn('new:paymentbatch', '+ จัดทำใบเตรียมจ่าย', 'primary'),
      filters: searchBox('ค้นหาเลขที่ ผู้ขาย หรือรายการตั้งหนี้'),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่จัดทำ'},{t:'กำหนดจ่าย'},{t:'ผู้ขาย',a:'c'},{t:'ยอดตั้งหนี้',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'สถานะ'}],
        rows: rows.map((b) => [{mono:b.no}, thDateNum(b.date), thDateNum(b.payDate), {c:String(b.items.length)},
          {n:b.total}, {n:b.wht}, {n:b.net}, { st: PB_LABEL[b.status] }]),
        rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
        empty:'ยังไม่มีใบเตรียมจ่าย',
        emptyAction: btn('new:paymentbatch', 'จัดทำใบเตรียมจ่ายใบแรก', 'primary'),
      })
      + '<div class="sub-h">เจ้าหนี้ค้างจ่ายที่ยังไม่อยู่ในใบเตรียมจ่าย (' + due.length + ')</div>'
      + tbl({
        cols:[{t:'ตั้งหนี้'},{t:'ผู้ขาย'},{t:'ครบกำหนด'},{t:'คงค้าง',a:'r'}],
        rows: due.slice(0, 12).map((b) => [{mono:b.no}, b.partnerName,
          b.due < TODAY ? {st:['late', thDateNum(b.due) + ' เลยกำหนด']} : thDateNum(b.due), {n:billOutstanding(b)}]),
        empty:'เจ้าหนี้ทุกรายอยู่ในใบเตรียมจ่ายแล้ว หรือจ่ายครบแล้ว',
      }),
      foot:'รวบรายการตั้งหนี้ที่ถึงกำหนด ส่งอนุมัติ แล้วจ่ายรวดเดียว · ไม่ผูกกับงวดบัญชี ตัวเลขเข้าบัญชีตอนกดจ่ายเท่านั้น',
    });
}

/* ===================================================================
   งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น
   =================================================================== */
function scEquity() {
  const from = yStart(), to = pEnd();
  const r = equityStatement(from, to);
  return card({
    title:'งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น',
    sub:'สำหรับงวดตั้งแต่ ' + thDate(from) + ' ถึง ' + thDate(to) + ' · หน่วย: บาท',
    actions: btnI('print', 'printer', 'พิมพ์'),
    body:'<div class="scroll"><table class="eq"><thead><tr><th>รายการ</th><th class="r">ทุนที่ออกและชำระแล้ว</th>'
      + '<th class="r">สำรองตามกฎหมาย</th><th class="r">กำไรสะสม</th><th class="r">รวม</th></tr></thead><tbody>'
      + r.rows.map((x) => '<tr' + (x.k ? ' class="' + x.k + '"' : '') + '><td>' + esc(x.label) + '</td>'
        + money(x.cap) + money(x.res) + money(x.ret) + money(x.total) + '</tr>').join('')
      + '</tbody></table></div>',
    foot: r.matchesBs
      ? 'ตรวจแล้ว: ส่วนของผู้ถือหุ้นปลายงวด ' + fmt(r.total) + ' บาท ตรงกับงบแสดงฐานะการเงิน ณ ' + thDate(to)
      : 'ยอดปลายงวดไม่ตรงกับงบแสดงฐานะการเงิน — ตรวจบัญชีหมวดส่วนของผู้ถือหุ้น',
  });
}

/* ===================================================================
   ข้อมูลกิจการ
   =================================================================== */
function scSettings() {
  const c = DB.company;
  const gaps = companyGaps();
  const yesNo = (v) => (v ? 'ใช่' : 'ไม่ใช่');
  return (gaps.length ? '<div class="demo-note"><div><b>ข้อมูลกิจการยังไม่ครบ</b><div>ขาด ' + esc(gaps.join(' · '))
      + ' — ใบกำกับภาษีต้องมีข้อมูลนี้ครบตามมาตรา 86/4</div></div><span class="grow"></span>'
      + btn('company:edit', 'กรอกข้อมูล', 'primary') + '</div>' : '')
    + card({
      title:'ข้อมูลกิจการ', sub:'พิมพ์ลงหัวเอกสารทุกใบ · แก้แล้วมีผลกับเอกสารที่พิมพ์หลังจากนี้',
      actions: btn('company:edit', 'แก้ไขข้อมูล', gaps.length ? '' : 'primary'),
      body:'<div class="kv">'
        + [['ชื่อผู้ประกอบการ', c.name], ['ชื่อภาษาอังกฤษ', c.nameEn || '—'],
           ['เลขประจำตัวผู้เสียภาษี', c.taxId || '—'], ['สถานประกอบการ', c.branchName || branchLabel(c.branch)],
           ['ที่อยู่', c.address || '—'], ['โทรศัพท์', c.phone || '—'],
           ['จดทะเบียนภาษีมูลค่าเพิ่ม', yesNo(c.vatRegistered !== false)], ['มาตรฐานการบัญชี', c.standard || 'TFRS for NPAEs'],
           ['รอบบัญชี', 'ปี พ.ศ. ' + (c.fiscalYear || '—')], ['ทุนชำระแล้ว', c.paidUpCapital ? fmt(c.paidUpCapital) + ' บาท' : '—'],
           ['ผู้ทำบัญชี', c.bookkeeper || '—'], ['ผู้สอบบัญชี', c.auditor || '—']]
          .map((x) => '<div><span>' + esc(x[0]) + '</span><b>' + esc(x[1]) + '</b></div>').join('')
        + '</div>',
      foot:'ข้อมูลผู้ซื้อบนเอกสารเก่าไม่เปลี่ยนตาม เพราะระบบเก็บข้อมูล ณ วันที่ออกไว้ทุกใบ',
    })
    + card({
      title:'เลขที่เอกสาร', sub:'ระบบจองเลขที่ตอนลงบัญชีสำเร็จเท่านั้น เลขจึงเรียงต่อเนื่องไม่มีช่องว่าง',
      body: tbl({
        cols:[{t:'เอกสาร'},{t:'รูปแบบเลขที่'},{t:'ใช้ไปแล้วงวดนี้',a:'c'}],
        rows: [['ใบกำกับภาษี','invoice'],['ใบเสร็จรับเงิน','receipt'],['ใบวางบิล','billingNote'],['ใบลดหนี้','creditNote'],
          ['ใบเพิ่มหนี้','debitNote'],['ใบเสนอราคา','quotation'],['ใบสั่งขาย','salesOrder'],['ใบสั่งซื้อ','purchaseOrder'],
          ['ใบรับสินค้า','goodsReceipt'],['ตั้งหนี้ผู้ขาย','bill'],['ใบสำคัญจ่าย','payment'],['ค่าใช้จ่าย','expense'],
          ['หนังสือรับรอง 50 ทวิ','whtCert'],['ใบเตรียมจ่าย','paymentBatch']]
          .map((x) => [x[0], {mono: SEQ_PREFIX[x[1]] + STATE.period.replace('-', '').slice(2) + '-00001'},
            {c: String(DB.seq[x[1] + '|' + STATE.period] || 0)}]),
      }),
    });
}

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
  debitnotes: scDebitNotes,
  quotations: () => tradeDocScreen('quotation'),
  salesorders: () => tradeDocScreen('salesOrder'),
  purchaseorders: () => tradeDocScreen('purchaseOrder'),
  billingnotes: scBillingNotes, goodsreceipts: scGoodsReceipts,
  equity: scEquity, settings: scSettings,
  expenses: scExpenses, paymentprep: scPaymentPrep,
  jgeneral: () => journalBookScreen('general'), jpurchase: () => journalBookScreen('purchase'),
  jsales: () => journalBookScreen('sales'), jpayment: () => journalBookScreen('payment'),
  jreceipt: () => journalBookScreen('receipt'),
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
      + '<input type="file" id="file" accept=".xlsx,.xls,.csv,.txt,.json" hidden>'
      + '<div class="drop-in">'
      + '<b>ลากไฟล์มาวางที่นี่</b>'
      + '<div class="dim">หรือ</div>'
      + btn('pick:file', 'เลือกไฟล์จากเครื่อง', 'primary')
      + '<div class="dim" style="margin-top:14px">'
      + 'งบทดลอง — FlowAccount: เมนู รายงาน → หมวด บัญชี → งบทดลอง → เลือกช่วงเวลา → ดาวน์โหลด Excel<br>'
      + 'ผังบัญชี — เมนู บริหารบัญชี → ผังบัญชี → ปุ่ม เพิ่มเติม → ดาวน์โหลด Excel<br>'
      + 'ไม่ต้องแก้ไฟล์ก่อน ลากไฟล์ที่ดาวน์โหลดมาได้เลย ระบบจะถามเองถ้าอ่านไม่ออก</div>'
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

  /* ประวัติการนำเข้า — ต้องเห็นและย้อนกลับได้ ไม่งั้นนำเข้าผิดแล้วไปต่อไม่ถูก */
  const past = listImports();
  const history = past.length ? card({
    title:'สิ่งที่นำเข้าไปแล้ว',
    sub:'นำเข้าผิดก็ยกเลิกได้ ระบบจะกลับรายการให้ตามกฎหมาย แล้วนำเข้าใหม่ได้ทันที',
    body: tbl({
      cols:[{t:'ใบสำคัญ'},{t:'วันที่'},{t:'นำเข้าเป็น'},{t:'จำนวนบัญชี',a:'r'},{t:'ยอดรวม',a:'r'},{t:'สถานะ'},{t:''}],
      rows: past.map((im) => [{mono:im.no}, thDateNum(im.date),
        im.kind === 'movement' ? 'ยอดเคลื่อนไหว ' + thPeriod(im.key) : 'ยอดยกมา',
        {c:String(im.lines)}, {n:im.total},
        im.status === 'reversed' ? {st:['late','ยกเลิกแล้ว']} : {st:['paid','ใช้งานอยู่']},
        im.status === 'reversed'
          ? {dim:'กลับรายการด้วย ' + im.reversedBy}
          : {html: btn('impundo:' + im.no, 'ยกเลิกการนำเข้านี้')}]),
    }),
    foot:'การยกเลิกไม่ได้ลบใบเดิมทิ้ง แต่สร้างใบกลับรายการคู่กัน ตาม พ.ร.บ.การบัญชี มาตรา 20 '
      + 'บัญชีที่สร้างไว้จากการนำเข้ายังอยู่ในผังบัญชี ยอดเป็นศูนย์ ใช้ต่อได้เลย',
  }) : '';

  if (!IMP.rows) return step1 + history + blank;

  /* ---- ไฟล์ไม่ใช่งบทดลอง บอกให้ชัดว่าไฟล์ไหนที่ต้องใช้ ---- */
  if (IMP.kind === 'ledger' || IMP.kind === 'chart') {
    const isLedger = IMP.kind === 'ledger';
    return step1 + card({
      title: isLedger ? 'ไฟล์นี้คือบัญชีแยกประเภท ไม่ใช่งบทดลอง' : 'ไฟล์นี้คือผังบัญชี ไม่ใช่งบทดลอง',
      sub: esc(IMP.name) + ' · ' + IMP.rows.length + ' แถว',
      actions: btn('imp:reset', 'เลือกไฟล์ใหม่', 'primary'),
      body:'<div class="note warn">'
        + (isLedger
            ? 'ไฟล์นี้เก็บรายการเคลื่อนไหวทีละรายการตลอดทั้งปี ไม่ใช่ยอดคงเหลือ '
              + 'ถ้านำเข้าเป็นยอดยกมา ตัวเลขจะกลายเป็นผลรวมรายการทั้งปีซึ่งไม่ใช่ยอดจริง '
              + 'ระบบจึงไม่ยอมนำเข้าให้'
            : 'ไฟล์ผังบัญชีมีแต่รายชื่อบัญชี ไม่มีตัวเลขยอดคงเหลือ จึงตั้งยอดยกมาไม่ได้')
        + '</div>'
        + '<div class="prose"><p><b>ไฟล์ที่ต้องใช้คือ งบทดลอง</b> — ใน FlowAccount ไปที่ '
        + 'เมนู <b>รายงาน</b> → หมวด <b>บัญชี</b> → <b>งบทดลอง</b> → เลือกช่วงเวลาให้สิ้นสุดที่วันตัดยอด '
        + '→ กดแสดงผลรายงาน → <b>ดาวน์โหลด Excel</b></p>'
        + (isLedger
            ? '<p class="dim">เก็บไฟล์บัญชีแยกประเภทไว้ได้ ใช้ตรวจย้อนกลับตอนยอดไม่ตรงว่ารายการไหนทำให้ต่าง</p>'
            : '<p class="dim">ไม่ต้องนำผังบัญชีเข้ามาเอง ระบบสร้างบัญชีตามรหัสเดิมให้อัตโนมัติ'
              + 'ตอนนำเข้างบทดลองอยู่แล้ว</p>')
        + '</div>',
    }) + history + blank;
  }

  /* ---- อ่านไฟล์ได้แล้ว ให้เลือกคอลัมน์ ---- */
  const head = IMP.rows[IMP.headerRow] || [];
  const width = IMP.rows.slice(0, 40).reduce((w, r) => Math.max(w, r.length), head.length);
  const colLetter = (i) => (i < 26 ? String.fromCharCode(65 + i)
    : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  /* ตัวอย่างข้อมูลจริงในคอลัมน์นั้น ช่วยให้เลือกถูกแม้หัวตารางจะว่างหรืออ่านไม่ออก */
  const sampleOf = (i) => {
    const r = IMP.rows.slice(IMP.headerRow + 1).find((x) => String(x[i] || '').trim() !== '');
    const v = r ? String(r[i]).trim() : '';
    return v.length > 18 ? v.slice(0, 18) + '…' : v;
  };
  const colOpts = function (sel) {
    let h = '<option value="">— ไม่ใช้ —</option>';
    for (let i = 0; i < width; i++) {
      const label = String(head[i] === undefined ? '' : head[i]).trim();
      const sample = sampleOf(i);
      h += '<option value="' + i + '"' + (String(i) === String(sel) ? ' selected' : '') + '>'
        + esc(colLetter(i) + ' · ' + (label || '(ไม่มีหัวคอลัมน์)')
          + (sample ? ' — เช่น ' + sample : '')) + '</option>';
    }
    return h;
  };
  const rowOpts = function () {
    let h = '';
    const n = Math.min(IMP.rows.length, 30);
    for (let i = 0; i < n; i++) {
      const txt = IMP.rows[i].map((c) => String(c || '').trim()).filter(Boolean).join(' | ');
      h += '<option value="' + i + '"' + (i === IMP.headerRow ? ' selected' : '') + '>'
        + esc('แถวที่ ' + (i + 1) + ': ' + (txt.length > 60 ? txt.slice(0, 60) + '…' : txt || '(แถวว่าง)'))
        + '</option>';
    }
    return h;
  };
  /* ตารางดิบให้เห็นหน้าตาไฟล์จริง ๆ พร้อมตัวอักษรคอลัมน์เหมือนใน Excel */
  const rawGrid = function () {
    const n = Math.min(IMP.rows.length, 12);
    let h = '<div class="scroll"><table class="grid"><thead><tr><th></th>';
    for (let i = 0; i < width; i++) h += '<th>' + colLetter(i) + '</th>';
    h += '</tr></thead><tbody>';
    for (let i = 0; i < n; i++) {
      h += '<tr' + (i === IMP.headerRow ? ' class="hd"' : '') + '><th>' + (i + 1) + '</th>';
      for (let j = 0; j < width; j++) {
        const v = String(IMP.rows[i][j] === undefined ? '' : IMP.rows[i][j]).trim();
        h += '<td>' + esc(v.length > 22 ? v.slice(0, 22) + '…' : v) + '</td>';
      }
      h += '</tr>';
    }
    return h + '</tbody></table></div>';
  };

  const preview = IMP.tb ? previewOpening(IMP.tb.rows, IMP.overrides || {}) : null;
  const readCount = IMP.tb ? IMP.tb.rows.length : 0;
  const mode = IMP.mode || 'opening';
  const pairs = IMP.pairs || [];
  const curPair = pairs.find((pr) => pr.debit === IMP.map.debit && pr.credit === IMP.map.credit);
  /* คำเตือนที่ตรงกับสิ่งที่ผู้ใช้กำลังจะทำ ไม่ใช่คำอธิบายรวม ๆ ที่อ่านแล้วยังไม่รู้ว่าต้องทำอะไร */
  const looksCumulative = !!(curPair && /สะสม|คงเหลือ|balance/i.test(curPair.label));
  const modeNote = mode === 'movement'
    ? '<div class="note' + (looksCumulative ? ' warn' : '') + '">'
      + (looksCumulative
          ? '<b>ชุดที่เลือกอยู่คือยอดสะสม ไม่ใช่ยอดของเดือนเดียว</b> ถ้าลงเป็นยอดเคลื่อนไหว '
            + 'ตัวเลขจะถูกนับซ้ำกับเดือนก่อนหน้า — ให้เลือกชุด <b>ยอดประจำงวด</b> แทน'
          : 'ไฟล์ที่ใช้ต้องเป็นงบทดลองที่ดึงมา<b>เฉพาะเดือนนั้นเดือนเดียว</b> '
            + '(ตั้งช่วงเวลาใน FlowAccount เป็นวันที่ 1 ถึงวันสิ้นเดือน) ถ้าใช้ไฟล์รายปี '
            + 'ตัวเลขทั้งปีจะไปกองอยู่เดือนเดียว')
      + '</div>'
    : '<div class="note">ยอดยกมาลงใบสำคัญ<b>ใบเดียว</b> ณ วันตัดยอด ใช้ชุด<b>ยอดสะสมหรือยอดคงเหลือ</b> '
      + 'เหมาะกับการเริ่มใช้ระบบ ถ้าอยากให้งบกำไรขาดทุน<b>รายเดือน</b>ของปีนี้ถูกต้องด้วย '
      + 'ให้เปลี่ยนเป็นแบบยอดเคลื่อนไหวแล้วนำเข้าเดือนละไฟล์</div>';

  const step2 = card({
    title: IMP.needsMapping ? 'บอกระบบหน่อยว่าคอลัมน์ไหนคืออะไร' : 'ตรวจไฟล์ก่อนนำเข้า',
    sub: esc(IMP.name) + ' · ' + IMP.rows.length + ' แถว · '
      + (readCount ? 'อ่านบัญชีที่มียอดได้ ' + readCount + ' บัญชี' : 'ยังอ่านบัญชีไม่ได้'),
    actions: btn('imp:reset', 'เลือกไฟล์ใหม่'),
    body:(IMP.needsMapping
        ? '<div class="note warn">ระบบเดาหัวตารางเองไม่ได้ แต่ไม่ต้องแก้ไฟล์ '
          + 'ดูตารางข้างล่างว่าคอลัมน์ไหนคือรหัสบัญชี ชื่อบัญชี เดบิต เครดิต '
          + 'แล้วเลือกตัวอักษรคอลัมน์ให้ตรงกัน — เลือกเสร็จตัวเลขจะขึ้นให้ตรวจทันที</div>'
        : '')
      + '<div class="sub-h">หน้าตาไฟล์จริง 12 แถวแรก (แถวที่ระบายสีคือหัวตาราง)</div>'
      + rawGrid()
      + '<div class="flds">'
      + '<div class="fld-w"><label for="impMode">จะนำตัวเลขชุดนี้เข้าเป็นอะไร</label>'
        + '<select id="impMode">'
        + '<option value="opening"' + (mode === 'opening' ? ' selected' : '') + '>'
          + 'ยอดยกมา — ตั้งต้นครั้งเดียว ณ วันตัดยอด</option>'
        + '<option value="movement"' + (mode === 'movement' ? ' selected' : '') + '>'
          + 'ยอดเคลื่อนไหวของเดือนเดียว — ลงเดือนละไฟล์</option>'
        + '</select></div>'
      + (pairs.length > 1
          ? '<div class="fld-w"><label for="impPair">ใช้ตัวเลขชุดไหนในไฟล์</label>'
            + '<select id="impPair">'
            + pairs.map((pr, i) => '<option value="' + i + '"'
                + (pr.debit === IMP.map.debit && pr.credit === IMP.map.credit ? ' selected' : '') + '>'
                + esc(pr.label) + ' (คอลัมน์ ' + colLetter(pr.debit) + '/' + colLetter(pr.credit) + ')'
                + '</option>').join('')
            + '</select></div>'
          : '')
      + (mode === 'movement'
          ? field({ name:'impPeriod', label:'ตัวเลขชุดนี้เป็นของเดือนไหน', type:'select',
              value: IMP.period || STATE.period,
              options: DB.periods.map((pd) => [pd.code, thPeriod(pd.code)
                + (pd.status === 'open' ? '' : ' (ปิดแล้ว)')]),
              hint:'ระบบจะลงใบสำคัญวันสิ้นเดือนของเดือนนี้' })
          : field({ name:'cutoff', label:'วันตัดยอด (ยอดยกมาจะลงบัญชีวันนี้)', type:'date',
              value: IMP.cutoff || pStart(), hint:'ต้องอยู่ในงวดที่ยังเปิดอยู่' }))
      + '</div>'
      /* เดาไม่ออกหรืออ่านไม่ได้สักบรรทัด ต้องกางช่องเลือกคอลัมน์ให้เห็นทันที
         ไม่ใช่ซ่อนไว้ใต้หัวข้อที่ผู้ใช้ไม่รู้ว่าต้องกด */
      + '<details class="adv"' + (IMP.needsMapping || !readCount ? ' open' : '')
      + '><summary>เลือกคอลัมน์เองทีละช่อง (ปกติไม่ต้องแตะ)</summary>'
      + '<div class="flds">'
      + '<div class="fld-w"><label for="impHeaderRow">หัวตารางอยู่แถวไหน</label>'
        + '<select id="impHeaderRow">' + rowOpts() + '</select></div>'
      + '<div class="fld-w"><label for="c_code">คอลัมน์รหัสบัญชี</label><select id="c_code" class="impcol" data-k="code">' + colOpts(IMP.map.code) + '</select></div>'
      + '<div class="fld-w"><label for="c_name">คอลัมน์ชื่อบัญชี</label><select id="c_name" class="impcol" data-k="name">' + colOpts(IMP.map.name) + '</select></div>'
      + '<div class="fld-w"><label for="c_debit">คอลัมน์เดบิต</label><select id="c_debit" class="impcol" data-k="debit">' + colOpts(IMP.map.debit) + '</select></div>'
      + '<div class="fld-w"><label for="c_credit">คอลัมน์เครดิต</label><select id="c_credit" class="impcol" data-k="credit">' + colOpts(IMP.map.credit) + '</select></div>'
      + '</div></details>'
      + modeNote
      + '<div class="sub-h">ตัวอย่าง 8 แถวแรกที่อ่านได้</div>'
      + tbl({
          cols:[{t:'รหัส'},{t:'ชื่อบัญชี'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'จับคู่กับ'}],
          rows: (IMP.tb ? IMP.tb.rows.slice(0, 8) : []).map(function (r) {
            const t = (IMP.overrides || {})[r.code || r.name] || matchAccount(r.code, r.name);
            return [{mono:r.code}, r.name, {n:r.debit}, {n:r.credit},
              t ? {dim: t + ' ' + acc(t).name} : {st:['late','ยังไม่จับคู่']}];
          }),
          empty:'ยังอ่านบรรทัดที่มียอดไม่ได้ — เลือกคอลัมน์ให้ตรงกับตารางข้างบนก่อน',
        })
      + (IMP.tb && IMP.tb.skipped.length
          ? '<div class="note">ข้ามไป ' + IMP.tb.skipped.length + ' แถว: '
            + esc(IMP.tb.skipped.slice(0, 4).map((s) => 'แถว ' + s.line + ' (' + s.why + ')').join(', '))
            + (IMP.tb.skipped.length > 4 ? ' และอื่น ๆ' : '') + '</div>'
          : ''),
  });

  if (!preview) return step1 + step2 + history + blank;

  /* ตัวเลือกบรรทัดงบสำหรับบัญชีที่จะสร้างใหม่ จัดกลุ่มตามบรรทัดงบให้เลือกง่าย */
  const fsOpts = (function () {
    const list = fsChoices();
    let h = '', group = null;
    list.forEach(function (o) {
      if (o.group !== group) {
        if (group !== null) h += '</optgroup>';
        h += '<optgroup label="' + esc(o.group) + '">';
        group = o.group;
      }
      h += '<option value="+' + esc(o.sub) + '">' + esc(o.label) + '</option>';
    });
    return h + (group !== null ? '</optgroup>' : '');
  })();
  const fsSelect = (key, sub) =>
    '<select class="impmap" data-key="' + esc(key) + '">'
    + fsOpts.replace('value="+' + esc(sub) + '"', 'value="+' + esc(sub) + '" selected')
    + '<optgroup label="หรือรวมเข้าบัญชีที่ระบบมีอยู่แล้ว">'
    + DB.accounts.filter((a) => a.postable && !a.imported)
        .map((a) => '<option value="' + a.code + '">' + esc(a.code + ' ' + a.name) + '</option>').join('')
    + '</optgroup></select>';

  const step3 = card({
    title:'สรุปสิ่งที่จะเกิดขึ้น',
    sub: mode === 'movement'
      ? 'จะลงใบสำคัญของงวด ' + thPeriod(IMP.period || STATE.period) + ' หนึ่งใบ'
      : 'ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดปุ่มนำเข้า',
    actions: btn('imp:run', mode === 'movement' ? 'ลงยอดเคลื่อนไหวของเดือนนี้' : 'นำเข้ายอดยกมา',
      preview.ready ? 'primary' : 'disabled'),
    body:'<div class="reco">'
      + '<div><span>บัญชีที่ตรงกับผังของระบบ</span><b>' + preview.matched.length + ' บัญชี</b></div>'
      + '<div><span>บัญชีที่จะสร้างใหม่ตามรหัสเดิม</span><b>' + preview.creating.length + ' บัญชี</b></div>'
      + '<div><span>บัญชีที่ยังจับคู่ไม่ได้</span><b class="' + (preview.unmatched.length ? 'neg' : '') + '">'
        + preview.unmatched.length + ' บัญชี</b></div>'
      + '<div><span>เดบิตรวม</span><b>' + fmt(preview.totalDr) + '</b></div>'
      + '<div><span>เครดิตรวม</span><b>' + fmt(preview.totalCr) + '</b></div>'
      + '<div class="gt"><span>ผลต่าง</span><b class="' + (preview.balanced ? '' : 'neg') + '">'
        + fmt(preview.diff) + '</b></div></div>'
      + (preview.creating.length
          ? '<div class="sub-h">บัญชีที่ระบบจะสร้างใหม่ให้ โดยใช้รหัสและชื่อเดิมของคุณ</div>'
            + '<div class="note">ระบบเดาให้แล้วว่าบัญชีแต่ละตัวควรอยู่บรรทัดไหนของงบการเงิน '
            + 'ไล่ดูให้ครบ ถ้าตัวไหนไม่ถูกให้เปลี่ยนในช่องขวาสุด</div>'
            + tbl({
                cols:[{t:'รหัสเดิม'},{t:'ชื่อบัญชี'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'จะไปอยู่บรรทัดงบ'}],
                rows: preview.creating.map((r) => [{mono:r.code}, r.name, {n:r.debit}, {n:r.credit},
                  {html: '<div class="dim" style="margin-bottom:4px">' + esc(r.fsLine || '—') + '</div>'
                    + fsSelect(r.code || r.name, r.subType)}]),
              })
          : '')
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
        + (preview.creating.length ? ' · บัญชีที่สร้างใหม่จะเข้าไปอยู่ในผังบัญชีถาวร' : '')
      : 'ยังนำเข้าไม่ได้ — ' + (!preview.balanced ? 'งบทดลองไม่สมดุล' : 'ยังจับคู่บัญชีไม่ครบ'),
  });

  return step1 + step2 + step3 + history + blank;
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
      { label:'พนักงานที่เพิ่มใหม่', value: (r.employees || 0) + ' / ' + (r.employeesSeen || 0) + ' คน' },
      { label:'ลูกหนี้ค้างยกมา', value: r.invoices + ' ใบ' },
      { label:'เจ้าหนี้ค้างยกมา', value: r.bills + ' รายการ' },
    ])
    + (r.opening ? '<div class="reco"><div><span>ใบสำคัญยอดยกมา</span><b>' + esc(r.opening.entry.no) + '</b></div>'
        + '<div><span>จำนวนบัญชี</span><b>' + r.opening.accounts + '</b></div>'
        + (r.opening.created ? '<div><span>บัญชีที่สร้างใหม่ตามผังเดิม</span><b>'
            + r.opening.created + '</b></div>' : '')
        + '<div class="gt"><span>ยอดรวมด้านเดบิต</span><b>' + fmt(r.opening.total) + '</b></div></div>' : '')
    + '<div class="sub-h">ตรวจยอดคุมหลังนำเข้า</div>'
    + '<ul class="checks">' + r.checks.map((c) =>
        '<li><span class="dot ' + (c.ok ? 'good' : 'bad') + '"></span>' + esc(c.label)
        + (c.why ? '<span class="why-note">' + esc(c.why) + '</span>' : '')
        + '<span class="grow"></span><span class="' + (c.ok ? 'dim' : 'neg') + '">'
        + (c.ok ? 'ตรงกัน' : 'ต่าง ' + fmt(c.control - c.sub)) + '</span></li>').join('') + '</ul>'
    + ((r.coverage && r.coverage.length)
        ? '<div class="sub-h">ความครบถ้วนของแต่ละชุดข้อมูลที่ดึงมา</div>'
          + tbl({
              cols:[{t:'ชุดข้อมูล'},{t:'อ่านได้',a:'r'},{t:'ยกมาเป็นยอดค้าง',a:'r'},
                {t:'ปิดแล้วไม่ยกมา',a:'r'},{t:'ซ้ำ',a:'r'},{t:'แปลงไม่ได้',a:'r'},{t:'หมายเหตุ'}],
              rows: r.coverage.map((c) => [c.source, {c:String(c.rows)}, {c:String(c.open)},
                {c:String(c.closed)}, {c:String(c.duplicate)},
                c.error ? {st:['late', String(c.error)]} : {c:'0'},
                {dim: c.note || ''}]),
            })
          + '<div class="note">แถวที่ "ปิดแล้วไม่ยกมา" คือเอกสารที่ชำระครบก่อนวันตัดยอด '
          + 'ยอดของมันรวมอยู่ในงบทดลองแล้ว จึงไม่ต้องยกมาเป็นรายใบซ้ำอีก</div>'
        : '')
    + (r.warnings.length
        ? '<div class="sub-h">ข้อสังเกตจากตัวดึงข้อมูล (' + r.warnings.length + ')</div>'
          + tbl({ cols:[{t:'เอกสาร'},{t:'เรื่อง'}],
                  rows: r.warnings.slice(0, 50).map((w) => [{mono:w.doc || '—'}, w.message || String(w)]) })
        : ''),
    foot: r.allPassed
      ? 'ยอดคุมผ่านครบทุกข้อ ข้อมูลที่ย้ายมาสอดคล้องกันทั้งบัญชีคุมและบัญชีย่อย'
      : (r.checks.some((c) => !c.ok && c.why)
          ? 'ข้อที่ยังไม่ตรงพร้อมคำอธิบายข้างบน เป็นเรื่องที่คาดไว้เมื่อยกมาแต่ยอดรวม '
            + 'ระบบจะไม่ยอมให้ปิดงวดจนกว่าจะนำเอกสารค้างเข้ามาครบ'
          : 'มียอดคุมที่ยังไม่ตรง — แปลว่าย้ายมาไม่ครบ ตรวจรายการข้างต้นก่อนใช้งานจริง'),
  });
}
