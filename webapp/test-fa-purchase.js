/* ทดสอบฝั่งซื้อแบบที่นักบัญชีคุ้นมือ — ใบสั่งซื้อ → ตั้งหนี้/ค่าใช้จ่าย (เติมข้อมูลครบ ลิงก์สองทาง)
   ค่าใช้จ่ายจ่ายทันทีและจ่ายภายหลัง · วันที่ใบกำกับภาษีของผู้ขาย · หน้าต่างจ่ายชำระ (วิธีจ่าย เช็ค ค่าธรรมเนียม หัก ณ ที่จ่ายแบบกรอกจำนวน)
   · ใบรับสินค้าจากใบสั่งซื้อที่มีส่วนลด/ราคารวมภาษี
   รันด้วย node webapp/test-fa-purchase.js */
const { ctx, ok, throws, done } = require('./testlib');
const M = ctx.M, fmt = ctx.fmt;

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const partner = (o) => ctx.savePartner(o).partner;
const bal = (code, to) => ctx.DB.entries.filter((e) => e.date <= (to || '2099-12-31'))
  .reduce((s, e) => s + e.lines.filter((l) => l.acc === code).reduce((t, l) => t + (l.dr || 0) - (l.cr || 0), 0), 0);
const entryAmt = (no, code) => { const e = ctx.DB.entries.find((x) => x.no === no);
  return e.lines.filter((l) => l.acc === code).reduce((s, l) => s + (l.dr || 0) - (l.cr || 0), 0); };
const balanced = () => ctx.trialBalance('2026-01-01', '2026-12-31').balanced;
const recon = (d) => ctx.reconciliationChecks(d).checks.filter((c) => !c.ok).map((c) => c.code).join(',');

ctx.buildBlank({ name: 'บริษัท ทดสอบฝั่งซื้อ จำกัด', year: 2026 });
ctx.TODAY = '2026-06-30';
ctx.post({ type: 'general', date: '2026-06-01', desc: 'ทุนเริ่มต้น', lines: [{ acc: '1113', dr: M('500000') }, { acc: '1111', dr: M('20000') },
  { acc: '1112', dr: M('5000') }, { acc: '3120', cr: M('525000') }] });
const vend = partner({ kind: 'vendor', name: 'บริษัท ผู้ขายวัสดุ จำกัด', taxId: tid('010555867890'), branch: '00000',
  address: '9 ถนนพระราม 4 กรุงเทพฯ 10500', termDays: 15, whtCode: 'WHT_SERVICE' });
const person = partner({ kind: 'vendor', name: 'นายช่าง ซ่อมดี', entityType: 'individual', taxId: tid('310050012345'),
  address: '5 ซอยลาดพร้าว กรุงเทพฯ', termDays: 7, whtCode: 'WHT_SERVICE' });
const widget = ctx.saveItem({ name: 'สินค้า ก', type: 'stock', uom: 'ชิ้น', price: '100' }).item;
const paper = ctx.saveItem({ name: 'กระดาษ A4', type: 'nonstock', uom: 'รีม', price: '150', buyPrice: '120', expenseAcc: '5324' }).item;
const repair = ctx.saveItem({ name: 'ค่าซ่อมบำรุง', type: 'service', uom: 'งาน', price: '0', expenseAcc: '5325' }).item;

console.log('\n=== 1. ใบสั่งซื้อ → ตั้งหนี้ ด้วยข้อมูลที่แก้ในฟอร์ม ===');
{
  const po = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-02',
    lines: [{ desc: 'สินค้า ก', qty: 10, price: '107', itemCode: widget.code, disc: '10' }, { desc: 'ค่าติดตั้ง', qty: 1, price: '2140', acc: '5325' }],
    pricing: { mode: 'inclusive', lineDisc: 'percent' }, project: 'คลังใหม่', reference: 'QV-77', note: 'ส่งของภายใน 7 วัน', internalNote: 'ต่อราคาแล้ว',
    creditDays: 30, whtCode: 'WHT_SERVICE' });
  ctx.setTradeDocStatus('purchaseOrder', po.no, 'approved');
  const before = ctx.DB.items.find((x) => x.code === widget.code).value;
  const bill = ctx.billPurchaseOrder(po.no, { date: '2026-06-05', vendorNo: 'IV-0001', vendorDate: '2026-06-04',
    lines: [{ desc: 'สินค้า ก', qty: 10, price: '107', itemCode: widget.code, disc: '10' }, { desc: 'ค่าติดตั้งและทดสอบ', qty: 1, price: '2140', acc: '5325' }],
    pricing: { mode: 'inclusive', lineDisc: 'percent' }, creditType: 'credit', creditDays: 20, project: 'คลังใหม่ เฟส 1',
    contact: { branch: '00003', address: '99 สาขาบางนา' }, internalNote: 'ตรวจรับแล้ว' });
  /* 1,070 −10% = 963 + 2,140 = 3,103 รวมภาษี → ก่อนภาษี 2,900 ภาษี 203 */
  ok('★ ตั้งหนี้จากใบสั่งซื้อ: ยอดตามที่แก้ในฟอร์ม รวม 3,103 ภาษี 203', bill.total === M('3103') && bill.vat === M('203'), fmt(bill.base) + ' / ' + fmt(bill.vat));
  ok('★ ใบสั่งซื้อเป็นดำเนินการแล้ว ชี้ไปตั้งหนี้ · ตั้งหนี้เก็บเลขใบสั่งซื้อ', po.status === 'closed' && po.convertedTo === bill.no && bill.fromDoc === po.no);
  ok('หัวเอกสารที่แก้ใช้ตามฟอร์ม ช่องที่ไม่ส่งยกจากใบสั่งซื้อ', bill.project === 'คลังใหม่ เฟส 1' && bill.creditDays === 20 && bill.due === '2026-06-25'
    && bill.reference === 'QV-77' && bill.note === 'ส่งของภายใน 7 วัน' && bill.internalNote === 'ตรวจรับแล้ว');
  ok('สินค้านับสต๊อกเข้าคลังด้วยยอดหลังส่วนลดก่อนภาษี 900', ctx.DB.items.find((x) => x.code === widget.code).value - before === M('900'));
  const tx = ctx.DB.taxTx.find((t) => t.entryNo === bill.entryNo);
  ok('★ รายงานภาษีซื้อ: วันที่ตามใบกำกับของผู้ขาย สาขาตามที่แก้บนใบ', tx.invDate === '2026-06-04' && tx.branch === '00003' && bill.vendorDate === '2026-06-04'
    && bill.snap.branch === '00003' && ctx.DB.partners.find((p) => p.code === vend.code).branch === '00000');
  ok('หัก ณ ที่จ่ายตามใบสั่งซื้อ (ค่าบริการ)', bill.whtCode === 'WHT_SERVICE');
  throws('แปลงซ้ำไม่ได้', () => ctx.billPurchaseOrder(po.no, { vendorNo: 'IV-0002', date: '2026-06-05' }), 'TRADE_DOC_ALREADY_CONVERTED');

  const po2 = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-02',
    lines: [{ desc: 'ค่าบริการ', qty: 1, price: '1000', acc: '5325' }] });
  throws('ตั้งหนี้จากใบสั่งซื้อต้องมีเลขใบกำกับ', () => ctx.billPurchaseOrder(po2.no, { date: '2026-06-05' }), 'VENDOR_INVOICE_NO_REQUIRED');
  const b2 = ctx.billPurchaseOrder(po2.no, { date: '2026-06-06', vendorNo: 'IV-0003' });
  ok('ไม่ส่งรายการ = ยกทุกบรรทัดจากใบสั่งซื้อ', b2.total === M('1070') && b2.lines[0].acc === '5325');
  ctx.voidDocument('bill', b2.no, 'บันทึกผิดใบ ทดสอบ');
  ok('ยกเลิกตั้งหนี้ ใบสั่งซื้อกลับเป็นอนุมัติ', po2.status === 'approved' && !po2.convertedTo);
  ok('งบทดลองสมดุล', balanced());
}

console.log('\n=== 2. วันที่และเลขที่ใบกำกับภาษีของผู้ขาย ===');
{
  const line = [{ desc: 'วัสดุ', qty: 1, price: '500', acc: '5324' }];
  throws('วันที่ในใบกำกับหลังวันที่บันทึก', () => ctx.recordBill({ partnerCode: vend.code, date: '2026-06-10', vendorNo: 'D-1', vendorDate: '2026-06-11',
    lines: line, whtCode: 'none' }), 'TAX_INVOICE_DATE_AFTER');
  throws('★ ใบกำกับเกิน 6 เดือน ขอคืนภาษีซื้อไม่ได้', () => ctx.recordBill({ partnerCode: vend.code, date: '2026-06-10', vendorNo: 'D-2', vendorDate: '2025-11-30',
    lines: line, whtCode: 'none' }), 'INPUT_VAT_CLAIM_EXPIRED');
  const late = ctx.recordBill({ partnerCode: vend.code, date: '2026-06-10', vendorNo: 'D-2', vendorDate: '2025-11-30', nonClaimableVat: true,
    lines: line, whtCode: 'none' });
  ok('เกิน 6 เดือนบันทึกเป็นภาษีซื้อต้องห้ามได้', !late.claimable && late.vendorDate === '2025-11-30');
  const six = ctx.recordBill({ partnerCode: vend.code, date: '2026-06-10', vendorNo: 'D-3', vendorDate: '2025-12-15', lines: line, whtCode: 'none' });
  ok('ใบกำกับเดือน ธ.ค. ขอคืนในเดือน มิ.ย. ได้ (ภายใน 6 เดือน)', six.claimable);
  throws('มีภาษีซื้อแต่ไม่กรอกเลขใบกำกับ', () => ctx.recordBill({ partnerCode: vend.code, date: '2026-06-10', lines: line, whtCode: 'none' }),
    'VENDOR_INVOICE_NO_REQUIRED');
  const n1 = ctx.recordBill({ partnerCode: person.code, date: '2026-06-10', whtCode: 'none',
    lines: [{ desc: 'ค่าแรง', qty: 1, price: '800', acc: '5325', taxCode: 'EXEMPT' }] });
  const n2 = ctx.recordBill({ partnerCode: person.code, date: '2026-06-11', whtCode: 'none',
    lines: [{ desc: 'ค่าแรง', qty: 1, price: '600', acc: '5325', taxCode: 'EXEMPT' }] });
  ok('★ ผู้ขายไม่ได้จด VAT ไม่มีเลขใบกำกับ บันทึกได้หลายใบ ไม่ติดตรวจเลขซ้ำ', !!n1.no && !!n2.no && n1.vendorNo === '' && n2.vat === 0);
  const ex = ctx.recordExpense({ partnerCode: vend.code, date: '2026-06-12', taxInvoiceNo: 'TI-9', taxInvoiceDate: '2026-06-01',
    lines: [{ desc: 'หมึกพิมพ์', qty: 2, price: '500', acc: '5324' }] });
  const tx = ctx.DB.taxTx.find((t) => t.expenseNo === ex.no);
  ok('★ ค่าใช้จ่ายเก็บวันที่ใบกำกับ ขึ้นในรายงานภาษีซื้อ', ex.taxInvoiceDate === '2026-06-01' && tx.invDate === '2026-06-01');
  throws('ค่าใช้จ่าย: วันที่ใบกำกับหลังวันที่จ่าย', () => ctx.recordExpense({ partnerCode: vend.code, date: '2026-06-12', taxInvoiceNo: 'TI-10',
    taxInvoiceDate: '2026-06-13', lines: [{ desc: 'หมึก', qty: 1, price: '500', acc: '5324' }] }), 'TAX_INVOICE_DATE_AFTER');
}

console.log('\n=== 3. ใบสั่งซื้อ → ค่าใช้จ่าย (จ่ายทันที) ===');
let poEx;
{
  poEx = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-03',
    lines: [{ desc: 'กระดาษ A4', qty: 20, price: '120', itemCode: paper.code }, { desc: 'ค่าซ่อมเครื่องถ่ายเอกสาร', qty: 1, price: '3000', itemCode: repair.code, disc: '500' }],
    pricing: { lineDisc: 'amount', bill: { kind: 'percent', value: '5' } }, project: 'สำนักงานใหญ่', note: 'ชำระเงินสด', whtCode: 'WHT_SERVICE' });
  ctx.setTradeDocStatus('purchaseOrder', poEx.no, 'approved');
  const ex = ctx.expensePurchaseOrder(poEx.no, { date: '2026-06-08', taxInvoiceNo: 'EX-PO-1', payFrom: '1113', method: 'transfer' });
  /* 2,400 + (3,000 − 500) = 4,900 − 5% (245) = 4,655 ก่อนภาษี · ภาษี 325.85 · หัก 3% จาก 4,655 = 139.65 */
  ok('★ ค่าใช้จ่ายได้รายการ ส่วนลด และส่วนลดท้ายบิลครบจากใบสั่งซื้อ', ex.base === M('4655') && ex.vat === M('325.85'), fmt(ex.base) + ' / ' + fmt(ex.vat));
  ok('หมวดค่าใช้จ่ายตามทะเบียนสินค้า (กระดาษ 5324 · ซ่อม 5325)', ex.lines[0].acc === '5324' && ex.lines[1].acc === '5325');
  ok('★ หัก ณ ที่จ่ายตามใบสั่งซื้อ ออก 50 ทวิ ให้ทันที', ex.wht === M('139.65') && !!ex.certNo
    && ctx.DB.docs.whtCert.find((c) => c.no === ex.certNo).form === 'ภ.ง.ด.53', fmt(ex.wht));
  ok('★ ใบสั่งซื้อดำเนินการแล้ว ↔ ค่าใช้จ่ายเก็บเลขใบสั่งซื้อ', poEx.status === 'closed' && poEx.convertedTo === ex.no && ex.fromDoc === poEx.no);
  ok('หัวเอกสารตามใบสั่งซื้อ (โปรเจกต์ หมายเหตุ เลขอ้างอิง = เลขใบสั่งซื้อ)', ex.project === 'สำนักงานใหญ่' && ex.note === 'ชำระเงินสด' && ex.reference === poEx.no);
  ctx.voidDocument('expense', ex.no, 'บันทึกผิดบัญชี ทดสอบ');
  ok('★ ยกเลิกค่าใช้จ่าย ใบสั่งซื้อกลับเป็นอนุมัติ 50 ทวิ ถูกยกเลิก', poEx.status === 'approved' && !poEx.convertedTo
    && ctx.DB.docs.whtCert.find((c) => c.no === ex.certNo).status === 'void');

  const poStock = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-03',
    lines: [{ desc: 'สินค้า ก', qty: 5, price: '60', itemCode: widget.code }] });
  ctx.setTradeDocStatus('purchaseOrder', poStock.no, 'approved');
  throws('ใบสั่งซื้อที่มีสินค้านับสต๊อก สร้างค่าใช้จ่ายไม่ได้', () => ctx.expensePurchaseOrder(poStock.no, { date: '2026-06-08' }), 'PO_HAS_STOCK');
  throws('ส่งบรรทัดสินค้านับสต๊อกมาเองก็ไม่ได้', () => ctx.expensePurchaseOrder(poStock.no, { date: '2026-06-08',
    lines: [{ desc: 'สินค้า ก', qty: 5, price: '60', itemCode: widget.code, acc: '5324', taxCode: 'EXEMPT' }] }), 'EXPENSE_STOCK_ITEM');
  ok('ล้มแล้วใบสั่งซื้อไม่เปลี่ยนสถานะ', poStock.status === 'approved');
  ok('งบทดลองสมดุล', balanced());
}

console.log('\n=== 4. ค่าใช้จ่ายจ่ายภายหลัง → ตั้งหนี้รอชำระ → จ่ายพร้อมหัก ณ ที่จ่าย ===');
{
  const ap0 = bal(ctx.accBySub('trade_payable'));
  const later = ctx.expensePurchaseOrder(poEx.no, { date: '2026-06-09', taxInvoiceNo: 'EX-PO-2', payLater: true, creditDays: 10 });
  ok('★ จ่ายภายหลัง: บันทึกเป็นตั้งหนี้รอชำระ ยอดเดียวกับค่าใช้จ่าย', /^RI/.test(later.no) && later.expenseLater && later.total === M('4980.85')
    && later.status === 'issued' && ctx.billOutstanding(later) === M('4980.85'), later.no + ' ' + fmt(later.total));
  ok('เจ้าหนี้เพิ่มเท่ายอดรวม · ยังไม่หัก ณ ที่จ่าย ยังไม่มี 50 ทวิ', bal(ctx.accBySub('trade_payable')) - ap0 === -M('4980.85')
    && later.whtCode === 'WHT_SERVICE' && !ctx.DB.docs.whtCert.some((c) => c.paymentNo && c.partnerCode === vend.code));
  ok('ครบกำหนด 10 วัน · ใบสั่งซื้อชี้ไปตั้งหนี้', later.due === '2026-06-19' && poEx.convertedTo === later.no && later.fromDoc === poEx.no);
  ok('ภาษีซื้อเข้ารายงานงวดที่บันทึก', ctx.DB.taxTx.some((t) => t.entryNo === later.entryNo && t.tax === M('325.85')));
  const pv = ctx.payBill({ billNo: later.no, date: '2026-06-15', bankAccount: '1113', method: 'cheque', chequeNo: 'CQ-123456', chequeDate: '2026-06-16',
    note: 'จ่ายตามนัด' });
  ok('★ จ่ายแล้วหัก ณ ที่จ่าย 3% จากค่าบริการก่อนภาษี และออก 50 ทวิ ตอนจ่าย', pv.wht === M('139.65') && !!pv.certNo, fmt(pv.wht) + ' ' + pv.certNo);
  ok('★ เก็บเลขที่และวันที่เช็ค หมายเหตุ · ใบสำคัญบอกเลขเช็ค', pv.method === 'cheque' && pv.chequeNo === 'CQ-123456' && pv.chequeDate === '2026-06-16'
    && pv.note === 'จ่ายตามนัด' && ctx.DB.entries.find((e) => e.no === pv.entryNo).lines.some((l) => /CQ-123456/.test(l.memo || '')));
  ok('ชำระครบแล้วสถานะเปลี่ยนเป็นชำระแล้ว', later.status === 'paid');

  const pBill = ctx.recordExpenseLater({ partnerCode: person.code, date: '2026-06-10', lines: [{ desc: 'ค่าแรงซ่อมหลังคา', qty: 1, price: '5000', acc: '5325', taxCode: 'EXEMPT' }],
    whtCode: 'WHT_SERVICE', dueDate: '2026-06-30' });
  ok('ค่าใช้จ่ายจ่ายภายหลังกำหนดวันครบกำหนดเองได้', pBill.due === '2026-06-30' && pBill.creditDays === 20);
  const pv2 = ctx.payBill({ billNo: pBill.no, date: '2026-06-20', bankAccount: '1111', method: 'cash' });
  const cert = ctx.DB.docs.whtCert.find((c) => c.no === pv2.certNo);
  ok('★ ผู้รับเงินบุคคลธรรมดา: 50 ทวิ เข้าแบบ ภ.ง.ด.3', cert.form === 'ภ.ง.ด.3' && pv2.wht === M('150')
    && entryAmt(pv2.entryNo, ctx.accBySub('wht_payable_pnd3')) === -M('150'));
  throws('จ่ายภายหลังต้องเลือกหมวดค่าใช้จ่าย', () => ctx.recordExpenseLater({ partnerCode: vend.code, date: '2026-06-10',
    lines: [{ desc: 'x', qty: 1, price: '100', acc: '1154' }] }), 'EXPENSE_ACCOUNT_INVALID');
  ok('งบทดลองสมดุล', balanced());
}

console.log('\n=== 5. หน้าต่างจ่ายชำระ: วิธีจ่าย ค่าธรรมเนียม หัก ณ ที่จ่ายแบบกรอกจำนวน ส่วนต่าง ===');
{
  const mk = (no) => ctx.recordBill({ partnerCode: vend.code, date: '2026-06-12', vendorNo: no, whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'ค่าบริการดูแลระบบ', qty: 1, price: '10000', acc: '5325' }] });
  const b = mk('PAY-1');
  const pv = ctx.payBill({ billNo: b.no, date: '2026-06-20', bankAccount: '1113', method: 'transfer', amount: '5000', fee: '25', whtAmount: '140' });
  const fin = ctx.accBySub('finance_cost');
  ok('★ จ่ายบางส่วน + ค่าธรรมเนียม 25 ลงค่าธรรมเนียมธนาคาร เงินออกจากบัญชีรวมค่าธรรมเนียม', entryAmt(pv.entryNo, fin) === M('25')
    && entryAmt(pv.entryNo, '1113') === -(M('5000') - M('140') + M('25')) && b.status === 'partially_paid');
  ok('★ หัก ณ ที่จ่ายตามจำนวนที่กรอก 140 (ไม่ใช่ 3% = 140.19)', pv.wht === M('140') && pv.whtTyped && pv.whtRate === '3'
    && ctx.DB.docs.whtCert.find((c) => c.no === pv.certNo).wht === M('140'), fmt(pv.whtBase));
  throws('กรอกจำนวนภาษีแต่ไม่เลือกประเภทเงินได้', () => ctx.payBill({ billNo: b.no, date: '2026-06-21', whtCode: 'none', whtAmount: '50' }), 'WHT_CODE_REQUIRED');
  throws('ภาษีที่กรอกเกินฐาน', () => ctx.payBill({ billNo: b.no, date: '2026-06-21', whtAmount: '9000' }), 'WHT_AMOUNT_INVALID');
  const pv2 = ctx.payBill({ billNo: b.no, date: '2026-06-22', bankAccount: '1112', method: 'petty', amount: '5600', diffType: 'discount' });
  ok('★ จ่ายจากเงินสดย่อย ส่วนที่ขาดปิดเป็นส่วนลดรับ ตั้งหนี้ปิดครบ', pv2.method === 'petty' && pv2.bankAccount === '1112' && b.status === 'paid'
    && pv2.diff === M('100'), fmt(pv2.diff));
  const b3 = mk('PAY-3');
  const pv3 = ctx.payBill({ billNo: b3.no, date: '2026-06-22', bankAccount: '1113', method: 'card' });
  ok('จ่ายด้วยบัตร/ช่องทางอื่น เก็บวิธีจ่าย · วิธีที่ไม่รู้จักถือเป็นโอนเงิน', pv3.method === 'card'
    && ctx.payBill({ billNo: mk('PAY-4').no, date: '2026-06-22', bankAccount: '1113', method: 'bitcoin' }).method === 'transfer');
  throws('จ่ายจากบัญชีที่ไม่ใช่เงินสด/ธนาคารไม่ได้', () => ctx.payBill({ billNo: mk('PAY-5').no, date: '2026-06-22', bankAccount: '5325' }), 'CASH_ACCOUNT_INVALID');
  ok('งบทดลองสมดุล', balanced());
}

console.log('\n=== 6. รับสินค้าจากใบสั่งซื้อที่มีส่วนลด/ราคารวมภาษี → ตั้งหนี้ ===');
{
  const po = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-14',
    lines: [{ desc: 'สินค้า ก', qty: 10, price: '64.20', itemCode: widget.code, disc: '5' }],
    pricing: { mode: 'inclusive', lineDisc: 'percent', bill: { kind: 'amount', value: '9.90' } }, project: 'สต๊อกกลางปี', reference: 'Q-55',
    note: 'ส่งที่คลังบางนา', internalNote: 'ราคาพิเศษ' });
  ctx.setTradeDocStatus('purchaseOrder', po.no, 'approved');
  /* 642 −5% = 609.90 − 9.90 = 600 รวมภาษี → ก่อนภาษี 560.75 */
  ok('มูลค่าใบสั่งซื้อก่อนภาษี 560.75', po.base === M('560.75'));
  const it0 = ctx.DB.items.find((x) => x.code === widget.code);
  const v0 = it0.value;
  const g1 = ctx.receiveGoodsFromPo(po.no, { date: '2026-06-15', lines: [{ line: 0, qty: 4 }] });
  const g2 = ctx.receiveGoodsFromPo(po.no, { date: '2026-06-16' });
  ok('★ รับเข้าคลังด้วยต้นทุนหลังส่วนลดก่อนภาษี (ไม่ใช่ราคารวมภาษีที่กรอก)', g1.lines[0].price === M('56.075') && g1.total + g2.total === M('560.75')
    && it0.value - v0 === M('560.75'), fmt(g1.total) + ' + ' + fmt(g2.total));
  ok('ใบรับสินค้ายกหัวเอกสารจากใบสั่งซื้อ (โปรเจกต์ เลขอ้างอิง หมายเหตุ โน้ตภายใน)', g1.project === 'สต๊อกกลางปี' && g1.reference === 'Q-55'
    && g1.note === 'ส่งที่คลังบางนา' && g1.internalNote === 'ราคาพิเศษ');
  const bill = ctx.billGoodsReceipt(g1.no, { date: '2026-06-18', vendorNo: 'GR-IV-1', vendorDate: '2026-06-17', creditDays: 45 });
  ok('★ ตั้งหนี้จากใบรับสินค้า: ยอดตรงบัญชีพักรับสินค้า ภาษี 7% ของต้นทุน', bill.base === g1.total && bill.vat === ctx.round2(ctx.pct(g1.total, '7'))
    && bill.grnNo === g1.no && g1.status === 'closed', fmt(bill.base) + ' / ' + fmt(bill.vat));
  ok('ตั้งหนี้ยกหัวเอกสารจากใบรับสินค้า · เครดิตตามที่ระบุ · วันที่ใบกำกับ', bill.project === 'สต๊อกกลางปี' && bill.reference === 'Q-55'
    && bill.creditDays === 45 && bill.vendorDate === '2026-06-17' && bill.fromDoc === po.no);
  const bill2 = ctx.billGoodsReceipt(g2.no, { date: '2026-06-18', vendorNo: 'GR-IV-2', lineTax: ['VAT0'] });
  ok('เปลี่ยนอัตราภาษีรายบรรทัดได้ (0%)', bill2.vat === 0 && bill2.lines[0].taxCode === 'VAT0');
  const gp = ctx.issueGoodsReceipt({ partnerCode: vend.code, date: '2026-06-19', vendorDoNo: 'DO-9', project: 'หน้าร้าน', reference: 'REF-1',
    note: 'ตรวจครบ', internalNote: 'กล่องบุบ 1', lines: [{ itemCode: widget.code, qty: 2, price: '55' }] });
  ok('ใบรับสินค้าที่ออกเองเก็บหัวเอกสาร', gp.project === 'หน้าร้าน' && gp.reference === 'REF-1' && gp.note === 'ตรวจครบ' && gp.internalNote === 'กล่องบุบ 1');
  ok('ยอดคุมทุกข้อผ่าน (พักรับสินค้า สินค้าคงเหลือ เจ้าหนี้ ภาษี)', recon('2026-06-30') === '', recon('2026-06-30'));
}

console.log('\n=== 7. เตรียมจ่ายเงินส่งวิธีจ่ายต่อให้ทุกราย ===');
{
  const b = ctx.recordBill({ partnerCode: vend.code, date: '2026-06-20', vendorNo: 'PB-1', whtCode: 'none',
    lines: [{ desc: 'วัสดุ', qty: 1, price: '2000', acc: '5324' }] });
  const pb = ctx.createPaymentBatch({ date: '2026-06-25', billNos: [b.no] });
  ctx.approvePaymentBatch(pb.no);
  const made = ctx.payPaymentBatch(pb.no, { date: '2026-06-26', bankAccount: '1113', method: 'cheque', note: 'รอบจ่าย 26' });
  ok('ใบสำคัญจ่ายจากใบเตรียมจ่ายเก็บวิธีจ่ายและหมายเหตุ', made[0].method === 'cheque' && made[0].note === 'รอบจ่าย 26' && made[0].batchNo === pb.no);
  ok('งบทดลองสมดุล', balanced());
  ok('ยอดคุมทุกข้อผ่าน', recon('2026-06-30') === '', recon('2026-06-30'));
}

done();
