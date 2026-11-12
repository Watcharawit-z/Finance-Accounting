/* ทดสอบวิธีบันทึกสินค้าแบบสิ้นงวด (stock.js · operations.js · settle.js) — รันด้วย node webapp/test-periodic.js
   หลักการตรวจ: ทำรายการชุดเดียวกันด้วยสองวิธี แล้วเทียบกันทุกเดือน
   หลังปรับปรุงสินค้าปลายงวด บัญชีสินค้าคงเหลือ ต้นทุนขายรวม (ต้นทุนขาย + ซื้อ + ส่งคืน) และกำไร ต้องเท่ากับวิธีต่อเนื่องทุกสตางค์ */
const T = require('./testlib');
const { ok, throws, done } = T;
/** เครื่องบัญชีชุดใหม่แยกกันคนละฐานข้อมูล — โหลด testlib ใหม่ได้ ctx ใหม่ */
function freshCtx() {
  delete require.cache[require.resolve('./testlib')];
  return require('./testlib').ctx;
}

function setup(C) {
  C.buildBlank({ name: 'บริษัท ทดสอบสินค้า จำกัด', year: 2026 });
  const cust = C.savePartner({ kind:'customer', name:'บริษัท ลูกค้าดี จำกัด', taxId:'0105540022881', branch:'00000',
    address:'1 ถนนสุขุมวิท กรุงเทพมหานคร', termDays: 30 }).partner;
  const ven = C.savePartner({ kind:'vendor', name:'บริษัท ขายส่ง จำกัด', taxId:'0105533001823', branch:'00000',
    address:'3 ถนนบางนา กรุงเทพมหานคร', termDays: 30 }).partner;
  const it = C.saveItem({ name:'สินค้า ก', type:'stock', uom:'ชิ้น', price:'200' }).item;
  return { cust: cust.code, ven: ven.code, it: it.code };
}
/* มกราคม: ยอดยกมา 10 × 100 · รับสินค้า 5 × 120 แล้วตั้งหนี้ · ขาย 4 · ตัดจำหน่าย 1 */
function jan(C, k) {
  C.saveStockAdj({ kind:'opening', date:'2026-01-02', lines:[{ itemCode:k.it, qty:10, value:'1000' }] });
  const gr = C.issueGoodsReceipt({ partnerCode:k.ven, date:'2026-01-05', lines:[{ itemCode:k.it, desc:'สินค้า ก', qty:5, price:'120' }] });
  C.billGoodsReceipt(gr.no, { date:'2026-01-08', vendorNo:'V-1' });
  const inv = C.issueInvoice({ partnerCode:k.cust, date:'2026-01-10', lines:[{ itemCode:k.it, desc:'สินค้า ก', qty:4, price:'200', taxCode:'VAT7' }] });
  C.saveStockAdj({ kind:'writeoff', date:'2026-01-20', reason:'แตกเสียหาย', lines:[{ itemCode:k.it, qty:1 }] });
  return { gr, inv };
}
/* กุมภาพันธ์: ตั้งหนี้ซื้อตรง 10 × 110 · รับสินค้า 2 × 150 (ยังไม่ตั้งหนี้) · ขาย 5 · ลูกค้าคืน 1 · คืนผู้ขาย 2 · ขายเงินสด 2 */
function feb(C, k) {
  const b = C.recordBill({ partnerCode:k.ven, date:'2026-02-03', vendorNo:'V-2',
    lines:[{ itemCode:k.it, desc:'สินค้า ก', qty:10, price:'110', acc: C.accBySub('inventory') }] });
  const gr = C.issueGoodsReceipt({ partnerCode:k.ven, date:'2026-02-06', lines:[{ itemCode:k.it, desc:'สินค้า ก', qty:2, price:'150' }] });
  const inv = C.issueInvoice({ partnerCode:k.cust, date:'2026-02-12', lines:[{ itemCode:k.it, desc:'สินค้า ก', qty:5, price:'210', taxCode:'VAT7' }] });
  const cn = C.issueCreditNote({ invoiceNo: inv.no, base:'210', date:'2026-02-14', reason:'RETURN_DEFECT', returnLines:[{ itemCode:k.it, qty:1 }] });
  const vcn = C.recordVendorCreditNote({ billNo: b.no, date:'2026-02-16', vendorCnNo:'VCN-1', base:'220', reason:'RETURN_DEFECT',
    returnLines:[{ itemCode:k.it, qty:2 }] });
  const cs = C.issueCashSale({ date:'2026-02-20', lines:[{ itemCode:k.it, desc:'สินค้า ก', qty:2, price:'214' }] });
  return { b, gr, inv, cn, vcn, cs };
}
const COST_SUBS = ['cogs', 'purchases', 'purchase_return'];
/** ตัวเลขของเดือนที่ใช้เทียบสองวิธี */
function month(C, p) {
  const s = p + '-01', e = C.endOfMonth(s);
  return {
    inv: C.balBySub(['inventory'], e),
    cost: C.balBySub(COST_SUBS, e, s),
    profit: -C.balanceOf((a) => a.type === 'revenue' || a.type === 'expense', e, s),
    ap: -C.balBySub(['trade_payable'], e), ar: C.balBySub(['trade_receivable'], e),
    sub: C.stockValueAsOf(e),
  };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const show = (m) => 'สินค้า ' + T.ctx.fmt(m.inv) + ' · ต้นทุนขายรวม ' + T.ctx.fmt(m.cost) + ' · กำไร ' + T.ctx.fmt(m.profit);
const recon = (C, d) => C.reconciliationChecks(d).checks.filter((c) => !c.ok).map((c) => c.code).join(', ');

/* ---------- วิธีต่อเนื่อง (ตัวเทียบ) ---------- */
const Q = freshCtx();
const kq = setup(Q);
jan(Q, kq); feb(Q, kq);
const qJan = month(Q, '2026-01'), qFeb = month(Q, '2026-02');

console.log('\n=== 1. ตั้งเป็นวิธีสิ้นงวดตั้งแต่ต้น ===');
const P = freshCtx();
const kp = setup(P);
{
  const r = P.setInventoryMethod('periodic');
  ok('★ เปลี่ยนเป็นแบบสิ้นงวดได้ บริษัทใหม่ไม่มีใบสำคัญต้องลงใหม่', P.invPeriodic() && r.converted === 0, JSON.stringify(r));
  ok('บัญชีซื้อสินค้า (purchases) เป็นบัญชีรับของเข้า', P.acc(P.stockBuyAcc()).subType === 'purchases', P.stockBuyAcc());
  const j = jan(P, kp);
  const grE = P.DB.entries.find((e) => e.no === j.gr.entryNo);
  ok('★ ใบรับสินค้าลง Dr ซื้อสินค้า / Cr พักรับสินค้า (ไม่ใช่สินค้าคงเหลือ)',
    grE.lines.some((l) => l.acc === P.stockBuyAcc() && l.dr === P.M('600')) && !grE.lines.some((l) => P.acc(l.acc).subType === 'inventory'),
    grE.lines.map((l) => l.acc + ' ' + (l.dr || -l.cr)).join(' / '));
  ok('★ ขายสินค้าไม่ลงต้นทุนขายทีละใบ แต่ทะเบียนสินค้าตัดจำนวนแล้ว',
    !j.inv.cogsEntryNo && P.DB.items.find((x) => x.code === kp.it).qty === 10, 'คงเหลือ ' + P.DB.items.find((x) => x.code === kp.it).qty);
  const c = P.reconciliationChecks('2026-01-31').checks.find((x) => x.code === 'INVENTORY_SUBLEDGER');
  ok('★ ก่อนปรับปลายงวด ตัวตรวจบอกให้ปรับปรุงสินค้าปลายงวด (ปุ่ม invadjust)', !c.ok && c.action === 'invadjust' && /ปรับปรุงสินค้าปลายงวด/.test(c.why), c.why);
  const item = P.closeChecklist('2026-01').items.find((i) => /ปรับปรุงสินค้า/.test(i.label));
  ok('หน้าปิดงวดมีรายการ "ปรับปรุงสินค้าคงเหลือปลายงวด" ที่บล็อกการปิดงวด และกดได้', item && !item.ok && item.blocking && item.action === 'invadjust', item && item.detail);
  const je = P.adjustStockPeriodEnd('2026-01');
  ok('★ ปรับปรุงปลายงวด: บัญชีสินค้า = ทะเบียนสินค้า ส่วนต่างเข้าต้นทุนขาย', je && P.balBySub(['inventory'], '2026-01-31') === P.stockValueAsOf('2026-01-31'),
    je && je.lines.map((l) => l.acc + ' ' + P.fmt(l.dr || -l.cr)).join(' / '));
  ok('กดปรับซ้ำโดยไม่มีรายการเพิ่ม ไม่ลงอะไร', P.adjustStockPeriodEnd('2026-01') === null);
  const pJan = month(P, '2026-01');
  ok('★ มกราคม: สินค้าคงเหลือ ต้นทุนขายรวม กำไร เจ้าหนี้ ลูกหนี้ เท่าวิธีต่อเนื่องทุกสตางค์', same(pJan, qJan), show(pJan) + ' | ต่อเนื่อง ' + show(qJan));
  ok('ยอดคุมมกราคมผ่านทุกข้อ', recon(P, '2026-01-31') === '', recon(P, '2026-01-31'));

  const f = feb(P, kp);
  ok('★ ตั้งหนี้ที่ส่งบัญชีสินค้าคงเหลือมา ระบบเปลี่ยนเป็นซื้อสินค้าให้', f.b.lines[0].acc === P.stockBuyAcc()
    && P.DB.entries.find((e) => e.no === f.b.entryNo).lines.some((l) => l.acc === P.stockBuyAcc() && l.dr === P.M('1100')));
  const vE = P.DB.entries.find((e) => e.no === f.vcn.entryNo);
  ok('★ คืนสินค้าให้ผู้ขาย ลง Cr ส่งคืนสินค้า ไม่แตะสินค้าคงเหลือ', !vE.lines.some((l) => P.acc(l.acc).subType === 'inventory')
    && vE.lines.some((l) => P.acc(l.acc).subType === 'purchase_return' && l.cr > 0), vE.lines.map((l) => l.acc + ' ' + P.fmt(l.dr || -l.cr)).join(' / '));
  ok('ลูกค้าคืนสินค้าและขายเงินสด ไม่มีใบต้นทุนขาย', !f.cn.cogsEntryNo && !f.cs.cogsEntryNo);
  ok('ระหว่างเดือนบัญชีสินค้าคงเหลือยังไม่ขยับ (เท่าปลายมกราคม)', P.balBySub(['inventory'], '2026-02-27') === pJan.inv);
  P.adjustStockPeriodEnd('2026-02');
  const pFeb = month(P, '2026-02');
  ok('★ กุมภาพันธ์ (ซื้อตรง รับของค้างตั้งหนี้ ขาย รับคืน คืนผู้ขาย ขายเงินสด): เท่าวิธีต่อเนื่องทุกสตางค์', same(pFeb, qFeb), show(pFeb) + ' | ต่อเนื่อง ' + show(qFeb));
  ok('บัญชีซื้อสินค้ากุมภาพันธ์ = ซื้อตรง 1,100 + รับของ 300', P.balBySub(['purchases'], '2026-02-28', '2026-02-01') === P.M('1400'),
    P.fmt(P.balBySub(['purchases'], '2026-02-28', '2026-02-01')));
  ok('ยอดคุมกุมภาพันธ์ผ่านทุกข้อ', recon(P, '2026-02-28') === '', recon(P, '2026-02-28'));
  ok('งบการเงินในหมวดต้นทุนขายรวมซื้อสินค้าและส่งคืนแล้ว (กำไรขั้นต้นเท่าวิธีต่อเนื่อง)',
    P.incomeStatement('2026-02-01', '2026-02-28').net === Q.incomeStatement('2026-02-01', '2026-02-28').net);
  throws('กลับรายการใบปรับปรุงปลายงวดด้วยมือไม่ได้', () => P.reverse(P.DB.entries.filter((e) => e.src === 'stockPeriodEnd').slice(-1)[0].no, 'ทดสอบกลับรายการ'),
    'ENTRY_FROM_DOCUMENT');
}

console.log('\n=== 2. ใช้แบบต่อเนื่องมาก่อน แล้วเปลี่ยนเป็นสิ้นงวด (ลงใหม่ในงวดที่เปิด) ===');
const X = freshCtx();
const kx = setup(X);
{
  const j = jan(X, kx);
  const f = feb(X, kx);
  const oldGr = j.gr.entryNo, oldCogs = j.inv.cogsEntryNo;
  const pv = X.inventoryMethodPreview('periodic');
  ok('ดูก่อนเปลี่ยน: รับสินค้า 2 ใบ ตั้งหนี้ 1 ใบ คืนผู้ขาย 1 ใบ ต้นทุนขายรายใบ 4 ใบ (ขาย 2 รับคืน 1 ขายเงินสด 1)', pv.receive === 2 && pv.bill === 1 && pv.returns === 1 && pv.cogs === 4,
    JSON.stringify(pv));
  const r = X.setInventoryMethod('periodic');
  ok('★ เปลี่ยนแล้วลงใหม่ทุกใบในงวดที่เปิด', r.converted === pv.receive + pv.bill + pv.returns + pv.cogs, JSON.stringify(r));
  const grE = X.DB.entries.find((e) => e.no === j.gr.entryNo);
  ok('★ ใบรับสินค้าที่ลงไว้แล้ว ย้ายเข้าบัญชีซื้อสินค้า — ใบเดิมกลับรายการ เอกสารชี้ใบใหม่',
    j.gr.entryNo !== oldGr && grE.lines.some((l) => l.acc === X.stockBuyAcc()) && X.DB.entries.find((e) => e.no === oldGr).status === 'reversed',
    oldGr + ' → ' + j.gr.entryNo);
  ok('★ ต้นทุนขายรายใบกลับรายการ ใบกำกับจำว่าเคยมี', !j.inv.cogsEntryNo && j.inv.cogsReversed === oldCogs
    && X.DB.entries.find((e) => e.no === oldCogs).status === 'reversed');
  ok('ตั้งหนี้ที่มีสินค้า บรรทัดเปลี่ยนเป็นบัญชีซื้อสินค้า แถวภาษีซื้อชี้ใบสำคัญใหม่', f.b.lines[0].acc === X.stockBuyAcc()
    && X.DB.taxTx.filter((t) => t.docNo === 'V-2' || t.entryNo === f.b.entryNo).every((t) => t.entryNo === f.b.entryNo));
  ok('มกราคม บัญชีซื้อสินค้า = 600 (ใบรับสินค้าที่ลงไว้แล้ว)', X.balBySub(['purchases'], '2026-01-31', '2026-01-01') === X.M('600'));
  X.adjustStockPeriodEnd('2026-01');
  X.adjustStockPeriodEnd('2026-02');
  const xJan = month(X, '2026-01'), xFeb = month(X, '2026-02');
  ok('★ หลังเปลี่ยนวิธีและปรับปลายงวด มกราคมเท่าวิธีต่อเนื่องทุกสตางค์', same(xJan, qJan), show(xJan));
  ok('★ กุมภาพันธ์เท่าวิธีต่อเนื่องทุกสตางค์', same(xFeb, qFeb), show(xFeb));
  ok('ยอดคุมผ่านทั้งสองเดือน', recon(X, '2026-01-31') === '' && recon(X, '2026-02-28') === '', recon(X, '2026-02-28'));
  ok('ภาษีซื้อ/ขายในทะเบียนยังตรงบัญชี (ลงใหม่ไม่กระทบภาษี)', recon(X, '2026-02-28').indexOf('VAT') < 0);
  /* ยกเลิกเอกสารหลังเปลี่ยนวิธี — กลับเฉพาะใบใหม่ สต๊อกคืนครบ */
  const qty0 = X.DB.items.find((x) => x.code === kx.it).qty;
  X.voidDocument('creditNote', f.cn.no, 'ทดสอบยกเลิกใบลดหนี้หลังเปลี่ยนวิธี');
  X.voidDocument('invoice', f.inv.no, 'ทดสอบยกเลิกหลังเปลี่ยนวิธี');
  ok('★ ยกเลิกใบลดหนี้ (ของที่รับคืน 1 ออก) และใบกำกับ (ของที่ขาย 5 กลับ) หลังเปลี่ยนวิธี: สต๊อกเพิ่ม 4 ชิ้น',
    X.DB.items.find((x) => x.code === kx.it).qty === qty0 + 4, qty0 + ' → ' + X.DB.items.find((x) => x.code === kx.it).qty);
  X.voidDocument('goodsReceipt', f.gr.no, 'ทดสอบยกเลิกใบรับสินค้า');
  ok('ยกเลิกใบรับสินค้าที่ลงใหม่แล้ว: ซื้อสินค้ากุมภาพันธ์ลดลง 300 พักรับสินค้าเป็นศูนย์',
    X.balBySub(['purchases'], '2026-02-28', '2026-02-01') === X.M('1100') && X.balBySub(['grni'], '2026-02-28') === 0);
  X.adjustStockPeriodEnd('2026-02');
  ok('ปรับปลายงวดอีกครั้งหลังยกเลิก ยอดคุมผ่าน', recon(X, '2026-02-28') === '', recon(X, '2026-02-28'));
}

console.log('\n=== 3. ยอดยกมาที่ยังไม่แยกรายตัว ไม่ถูกโยนเข้าต้นทุนขาย ===');
const U = freshCtx();
const ku = setup(U);
{
  U.post({ type:'opening', date:'2026-01-01', desc:'ยอดยกมาจากระบบเดิม', src:'manual',
    lines:[{ acc: U.accBySub('inventory'), dr: U.M('5000') }, { acc: U.accBySub('opening_balance'), cr: U.M('5000') }] });
  U.setInventoryMethod('periodic');
  ok('ยอดยกมาในบัญชี 5,000 ยังไม่มีรายตัว', U.stockUnallocated('2026-01-31') === U.M('5000'));
  U.issueGoodsReceipt({ partnerCode:ku.ven, date:'2026-01-05', lines:[{ itemCode:ku.it, desc:'สินค้า ก', qty:10, price:'100' }] });
  U.adjustStockPeriodEnd('2026-01');
  ok('★ ปรับปลายงวดลงเฉพาะของที่ซื้อ 1,000 — ยอดยกมา 5,000 ยังอยู่ในบัญชีสินค้า ไม่เข้าต้นทุนขาย',
    U.balBySub(['inventory'], '2026-01-31') === U.M('6000') && U.balBySub(COST_SUBS, '2026-01-31', '2026-01-01') === 0,
    U.fmt(U.balBySub(['inventory'], '2026-01-31')));
  const c = U.reconciliationChecks('2026-01-31').checks.find((x) => x.code === 'INVENTORY_SUBLEDGER');
  ok('ตัวตรวจบอกให้ตั้งยอดสินค้ายกมารายตัว (ไม่ใช่ปรับปลายงวด)', !c.ok && !c.action && /ยังไม่ได้ตั้งยอดสินค้ายกมาเป็นรายตัว/.test(c.why), c.why);
  const st = U.saveStockAdj({ kind:'opening', date:'2026-01-01', lines:[{ itemCode:ku.it, qty:50, value:'5000' }] });
  ok('★ ตั้งยอดยกมารายตัวแบบแยกยอด (ไม่ลงบัญชีซ้ำ) แล้วยอดคุมผ่าน', st.mode === 'allocate' && !st.entryNo && recon(U, '2026-01-31') === '',
    st.mode + ' · ' + recon(U, '2026-01-31'));
}

console.log('\n=== 4. กลับเป็นแบบต่อเนื่อง และปิดบัญชีสิ้นปี ===');
{
  P.issueInvoice({ partnerCode:kp.cust, date:'2026-03-05', lines:[{ itemCode:kp.it, desc:'สินค้า ก', qty:3, price:'200', taxCode:'VAT7' }] });
  Q.issueInvoice({ partnerCode:kq.cust, date:'2026-03-05', lines:[{ itemCode:kq.it, desc:'สินค้า ก', qty:3, price:'200', taxCode:'VAT7' }] });
  const r = P.setInventoryMethod('perpetual');
  ok('★ กลับเป็นแบบต่อเนื่อง: ปรับบัญชีสินค้าทุกงวดที่เปิดให้เท่าทะเบียนก่อน', !P.invPeriodic() && r.adjusted >= 1, JSON.stringify(r));
  const inv = P.issueInvoice({ partnerCode:kp.cust, date:'2026-03-10', lines:[{ itemCode:kp.it, desc:'สินค้า ก', qty:1, price:'200', taxCode:'VAT7' }] });
  Q.issueInvoice({ partnerCode:kq.cust, date:'2026-03-10', lines:[{ itemCode:kq.it, desc:'สินค้า ก', qty:1, price:'200', taxCode:'VAT7' }] });
  ok('หลังกลับเป็นแบบต่อเนื่อง ขายแล้วมีใบต้นทุนขายทันที', !!inv.cogsEntryNo);
  const pMar = month(P, '2026-03'), qMar = month(Q, '2026-03');
  ok('★ มีนาคมเท่าวิธีต่อเนื่องทุกสตางค์', same(pMar, qMar), show(pMar) + ' | ต่อเนื่อง ' + show(qMar));
  ok('ยอดคุมมีนาคมผ่าน', recon(P, '2026-03-31') === '', recon(P, '2026-03-31'));

  const Y = freshCtx();
  const ky = setup(Y);
  Y.setInventoryMethod('periodic');
  jan(Y, ky);
  Y.issueGoodsReceipt({ partnerCode:ky.ven, date:'2026-12-05', lines:[{ itemCode:ky.it, desc:'สินค้า ก', qty:4, price:'130' }] });
  Y.issueInvoice({ partnerCode:ky.cust, date:'2026-12-15', lines:[{ itemCode:ky.it, desc:'สินค้า ก', qty:6, price:'220', taxCode:'VAT7' }] });
  const ye = Y.closeFiscalYear('2026-12-31');
  ok('★ ปิดบัญชีสิ้นปีด้วยวิธีสิ้นงวด: ระบบปรับปรุงสินค้าปลายปีให้ก่อนโอนกำไร บัญชีสินค้า = ทะเบียน',
    Y.balBySub(['inventory'], '2026-12-31') === Y.stockValueAsOf('2026-12-31') && Y.DB.entries.some((e) => e.src === 'stockPeriodEnd' && e.srcId === '2026-12'),
    Y.fmt(Y.balBySub(['inventory'], '2026-12-31')) + ' = ' + Y.fmt(Y.stockValueAsOf('2026-12-31')));
  const fy = Y.fiscalYearOf('2026-12-31');
  ok('ปิดบัญชีสิ้นปีครบทุกบัญชี (ไม่มีรายการลงเพิ่มหลังปิด)', Y.yearEndOpen(fy).length === 0 && !!ye.entry);
  throws('เปลี่ยนเป็นวิธีที่ไม่มีอยู่ไม่ได้', () => Y.setInventoryMethod('fifo'), 'INV_METHOD_INVALID');
}

done();
