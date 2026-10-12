/* ทดสอบระบบรับ–จ่ายชำระ (settle.js และการรับ/จ่ายใน operations.js) — รันด้วย node webapp/test-settle.js
   บริษัทเปล่าจริง ไม่ใช่ข้อมูลตัวอย่าง ทุกขั้นตรวจ: บัญชีสมดุล ลูกหนี้/เจ้าหนี้รายใบ = บัญชีคุม ทะเบียนภาษี = บัญชีแยกประเภท */
const { ctx: C, ok, throws, done } = require('./testlib');
const M = C.M, fmt = C.fmt;

C.buildBlank({ name: 'บริษัท ทดสอบรับจ่าย จำกัด', year: 2026 });
const D = C.DB;
const cust = C.savePartner({ kind:'customer', name:'บริษัท ลูกค้าดี จำกัด', taxId:'0105540022881', branch:'00000',
  address:'1 ถนนสุขุมวิท กรุงเทพมหานคร', termDays: 30 }).partner;
const cust2 = C.savePartner({ kind:'customer', name:'บริษัท ลูกค้าสอง จำกัด', taxId:'0105536091238', branch:'00000',
  address:'2 ถนนพระราม 3 กรุงเทพมหานคร', termDays: 30 }).partner;
const ven = C.savePartner({ kind:'vendor', name:'บริษัท ช่างซ่อม จำกัด', taxId:'0105533001823', branch:'00000',
  address:'3 ถนนบางนา', termDays: 30, whtCode:'WHT_SERVICE' }).partner;
const sup = C.savePartner({ kind:'vendor', name:'บริษัท ขายส่งสินค้า จำกัด', taxId:'0105542007731', branch:'00000',
  address:'4 ถนนรัชดา', termDays: 30, whtCode:'WHT_CONTRACT' }).partner;
const item = C.saveItem({ name:'สินค้าทดสอบ A', type:'stock', uom:'ชิ้น', price:'200' }).item;

const gl = (sub, to, from) => C.balBySub([sub], to || '2026-12-31', from);
const glAcc = (code, to) => C.balanceOf(code, to || '2026-12-31');
const entry = (no) => D.entries.find((e) => e.no === no);
const line = (e, code) => e.lines.filter((l) => l.acc === code).reduce((s, l) => s + l.dr - l.cr, 0);
/** ยอดคุมทั้งหมดต้องผ่านทุกข้อ ณ สิ้นเดือนที่ระบุ */
function recon(asOf) {
  const r = C.reconciliationChecks(asOf);
  const ag = C.aging('ar', asOf).totals.total === gl('trade_receivable', asOf);
  const ap = C.aging('ap', asOf).totals.total === -gl('trade_payable', asOf);
  const bad = r.checks.filter((c) => !c.ok).map((c) => c.code + ' ' + fmt(c.control) + '≠' + fmt(c.sub));
  if (!ag) bad.push('อายุลูกหนี้ไม่เท่าบัญชีคุม');
  if (!ap) bad.push('อายุเจ้าหนี้ไม่เท่าบัญชีคุม');
  /* ยอดค้างที่เก็บในเอกสาร (paid/credited/settled) ต้องตรงกับที่นับใหม่จากเอกสารทุกใบ */
  D.docs.invoice.forEach((d) => { if (d.status !== 'void' && C.invOutstanding(d) !== C.outstandingAsOf('ar', d, '2099-12-31')) bad.push('ยอดค้าง ' + d.no + ' ไม่ตรงเอกสาร'); });
  D.docs.bill.forEach((d) => { if (d.status !== 'void' && C.billOutstanding(d) !== C.outstandingAsOf('ap', d, '2099-12-31')) bad.push('ยอดค้าง ' + d.no + ' ไม่ตรงเอกสาร'); });
  /* เงินมัดจำรับ/จ่ายรายใบรวมกัน = ยอดในบัญชี */
  const depAr = D.docs.customerDeposit.filter((d) => d.status !== 'void' && d.date <= asOf).reduce((s, d) => s + d.base, 0)
    - D.docs.invoice.filter((d) => d.status !== 'void' && d.date <= asOf).reduce((s, d) => s + (d.depositBase || 0), 0)
    - D.docs.creditApply.filter((a) => a.status !== 'void' && a.date <= asOf && a.side === 'ar' && a.sourceKind === 'deposit').reduce((s, a) => s + a.amount, 0);
  if (depAr !== -gl('customer_deposit', asOf)) bad.push('เงินมัดจำรับรายใบ ' + fmt(depAr) + ' ≠ บัญชี ' + fmt(-gl('customer_deposit', asOf)));
  const depAp = D.docs.vendorDeposit.filter((d) => d.status !== 'void' && d.date <= asOf).reduce((s, d) => s + d.base, 0)
    - D.docs.bill.filter((d) => d.status !== 'void' && d.date <= asOf).reduce((s, d) => s + (d.depositBase || 0), 0)
    - D.docs.creditApply.filter((a) => a.status !== 'void' && a.date <= asOf && a.side === 'ap' && a.sourceKind === 'deposit').reduce((s, a) => s + a.amount, 0);
  if (depAp !== gl('deposit_paid', asOf)) bad.push('เงินมัดจำจ่ายรายใบ ' + fmt(depAp) + ' ≠ บัญชี ' + fmt(gl('deposit_paid', asOf)));
  return bad.join(' · ');
}
const allRecon = () => ['2026-06-30', '2026-07-31', '2026-08-31'].map(recon).filter(Boolean).join(' | ');
const inv = (date, price, extra) => C.issueInvoice(Object.assign({ partnerCode: cust.code, date,
  lines: [{ desc:'ค่าบริการติดตั้งระบบ', qty: 1, price, taxCode:'VAT7' }] }, extra || {}));

console.log('\n=== 1. รับเงินเข้าบัญชีที่เลือก — เงินสดลงบัญชีเงินสด ไม่ใช่ธนาคารเสมอ ===');
{
  const i1 = inv('2026-06-05', '1000');
  const rc = C.receivePayment({ invoiceNo: i1.no, date:'2026-06-06', method:'cash', bankAccount:'1111' });
  ok('★ รับเงินสดลง 1111 เงินสดในมือ', line(entry(rc.entryNo), '1111') === M('1070') && line(entry(rc.entryNo), '1113') === 0 && rc.bankAccount === '1111');
  const i2 = inv('2026-06-05', '1000');
  throws('รับเงินเข้าบัญชีที่ไม่ใช่เงินสด/ธนาคารไม่ได้', () => C.receivePayment({ invoiceNo: i2.no, date:'2026-06-06', bankAccount:'1131' }), 'CASH_ACCOUNT_INVALID');
  const rc2 = C.receivePayment({ invoiceNo: i2.no, date:'2026-06-06', bankAccount:'1114' });
  ok('รับโอนเข้าบัญชีออมทรัพย์ 1114 ได้', line(entry(rc2.entryNo), '1114') === M('1070'));
  ok('ยอดคุมผ่าน', recon('2026-06-30') === '', recon('2026-06-30'));
}

console.log('\n=== 2. ลูกค้าจ่ายขาด — ปิดยอดเป็นค่าธรรมเนียม ส่วนลด หรือเศษ ===');
{
  const i1 = inv('2026-06-10', '1000');
  /* ลูกค้าหัก 3% = 30 แล้วโอนมา 1,015 เพราะถูกหักค่าโอน 25 → ยอดก่อนหัก ณ ที่จ่าย = 1,045 */
  const rc = C.receivePayment({ invoiceNo: i1.no, date:'2026-06-12', amount:'1045', whtCode:'WHT_SERVICE', diffType:'fee' });
  const e = entry(rc.entryNo);
  ok('★ ค่าโอน 25 บาทลงค่าธรรมเนียมธนาคาร ใบกำกับปิดครบ', rc.diff === M('25') && line(e, '5410') === M('25')
    && C.invOutstanding(i1) === 0 && i1.status === 'paid', fmt(rc.diff) + ' · ' + i1.status);
  ok('★ ภาษีหัก ณ ที่จ่ายยังคิดจากค่าบริการเต็ม 1,000 (ไม่ใช่สัดส่วนของยอดที่ขาด)', rc.wht === M('30') && rc.net === M('1015'), fmt(rc.wht) + ' · สุทธิ ' + fmt(rc.net));
  const i2 = inv('2026-06-10', '1000');
  const rd = C.receivePayment({ invoiceNo: i2.no, date:'2026-06-12', amount:'1000', diffType:'discount' });
  ok('★ ให้ส่วนลด 70 บาท ลงส่วนลดจ่าย 4131', line(entry(rd.entryNo), '4131') === M('70') && C.invOutstanding(i2) === 0);
  const i3 = inv('2026-06-10', '1000');
  throws('เศษผลต่างเกิน 100 บาท ตัดเป็นเศษไม่ได้', () => C.receivePayment({ invoiceNo: i3.no, date:'2026-06-12', amount:'900', diffType:'writeoff' }), 'RECEIPT_DIFF_TOO_LARGE');
  const rw = C.receivePayment({ invoiceNo: i3.no, date:'2026-06-12', amount:'1069.50', diffType:'writeoff' });
  ok('เศษ 0.50 บาทลงผลต่างจากการปัดเศษ 9920', line(entry(rw.entryNo), '9920') === M('0.5') && C.invOutstanding(i3) === 0);
  const i4 = inv('2026-06-10', '1000');
  C.receivePayment({ invoiceNo: i4.no, date:'2026-06-12', amount:'500' });
  ok('ไม่เลือกปิดส่วนต่าง = รับบางส่วน ยอดที่เหลือยังค้าง', C.invOutstanding(i4) === M('570') && i4.status === 'partially_paid');
  ok('ยอดคุมผ่าน (ลูกหนี้รายใบนับส่วนต่างที่ปิดยอดด้วย)', recon('2026-06-30') === '', recon('2026-06-30'));
  C.voidDocument('receipt', rc.no, 'ทดสอบยกเลิกใบเสร็จที่มีส่วนต่าง');
  ok('★ ยกเลิกใบเสร็จ ส่วนต่างที่ปิดไว้กลับมาเป็นยอดค้างครบ', C.invOutstanding(i1) === M('1070') && i1.status === 'issued' && recon('2026-06-30') === '', recon('2026-06-30'));
}

console.log('\n=== 3. ลูกค้าจ่ายเกิน — ส่วนเกินเป็นเครดิต ใช้หักใบถัดไปได้ ===');
let over;
{
  const i1 = inv('2026-06-15', '1000');
  throws('จ่ายเกินโดยไม่เลือกเก็บเป็นเครดิต ถูกปฏิเสธ', () => C.receivePayment({ invoiceNo: i1.no, date:'2026-06-16', amount:'1200' }), 'OVER_PAYMENT');
  over = C.receivePayment({ invoiceNo: i1.no, date:'2026-06-16', amount:'1200', diffType:'credit' });
  const cr = D.docs.customerDeposit.find((d) => d.no === over.no);
  ok('★ รับเกิน 130 เก็บในเงินมัดจำรับ 2161 รายลูกค้า ใบกำกับปิดครบ', over.excess === M('130') && line(entry(over.entryNo), '2161') === -M('130')
    && entry(over.entryNo).lines.find((l) => l.acc === '2161').partner === cust.code && C.invOutstanding(i1) === 0);
  ok('ทะเบียนเครดิตของลูกค้ามีเงินรับเกิน 130', !!cr && cr.kind === 'overpay' && C.depositLeft(cr) === M('130'));
  const src = C.creditSources('ar', cust.code);
  ok('เครดิตรับเกินอยู่ในรายการที่ใช้หักกลบได้', src.some((s) => s.no === over.no && s.left === M('130')));
  const i2 = inv('2026-06-20', '500');
  throws('หักกลบข้ามลูกค้าไม่ได้', () => C.applyCustomerCredit({ targetNo: C.issueInvoice({ partnerCode: cust2.code, date:'2026-06-20',
    lines:[{ desc:'ค่าบริการ', qty:1, price:'100', taxCode:'VAT7' }] }).no, sourceNo: over.no, date:'2026-06-21' }), 'CREDIT_SOURCE_NOT_FOUND');
  const ap = C.applyCustomerCredit({ targetNo: i2.no, sourceNo: over.no, date:'2026-06-21' });
  ok('★ หักกลบเครดิตรับเกินกับใบกำกับใบใหม่ Dr 2161 / Cr ลูกหนี้', ap.amount === M('130') && C.invOutstanding(i2) === M('405')
    && line(entry(ap.entryNo), '2161') === M('130') && C.depositLeft(cr) === 0, fmt(C.invOutstanding(i2)));
  ok('ยอดคุมผ่าน', recon('2026-06-30') === '', recon('2026-06-30'));
  throws('ยกเลิกใบเสร็จที่เครดิตรับเกินถูกใช้แล้วไม่ได้', () => C.voidDocument('receipt', over.no, 'ทดสอบยกเลิกใบเสร็จ'), 'VOID_HAS_DEPENDENTS');
  C.voidDocument('creditApply', ap.no, 'ทดสอบยกเลิกการหักกลบ');
  ok('ยกเลิกการหักกลบ ยอดค้างและเครดิตกลับมา', C.invOutstanding(i2) === M('535') && C.depositLeft(cr) === M('130') && recon('2026-06-30') === '');
  const rf = C.refundCustomerCredit({ sourceNo: over.no, date:'2026-06-22', bankAccount:'1113' });
  ok('คืนเงินรับเกินให้ลูกค้าได้ Dr 2161 / Cr ธนาคาร ไม่มีภาษี', rf.cash === M('130') && rf.vat === 0 && C.depositLeft(cr) === 0
    && !D.taxTx.some((t) => t.srcDoc === 'creditApply|' + rf.no));
}

console.log('\n=== 4. เครดิตจากใบลดหนี้หลังรับเงินครบ — หักกับใบกำกับอีกใบของลูกค้าเดียวกัน ===');
{
  const a = inv('2026-06-18', '2000');
  C.receivePayment({ invoiceNo: a.no, date:'2026-06-19' });
  C.issueCreditNote({ invoiceNo: a.no, date:'2026-06-20', base:'500', reason:'PRICE_REDUCE' });
  ok('ใบเดิมมีเครดิต 535', C.invOutstanding(a) === -M('535') && a.status === 'credit_balance');
  const b = inv('2026-06-21', '1000');
  const ap = C.applyCustomerCredit({ targetNo: b.no, sourceNo: a.no, date:'2026-06-22' });
  ok('★ หักเครดิตของใบลดหนี้กับใบใหม่ ใบเดิมกลับเป็นศูนย์ ใบใหม่ค้าง 535', C.invOutstanding(a) === 0 && a.status === 'paid'
    && C.invOutstanding(b) === M('535') && b.status === 'partially_paid');
  ok('ใบสำคัญหักกลบลูกหนี้กับลูกหนี้ ยอดคุมไม่เปลี่ยน แต่รายใบย้ายถูกใบ', line(entry(ap.entryNo), '1131') === 0 && recon('2026-06-30') === '', recon('2026-06-30'));
  throws('ยกเลิกใบกำกับที่ถูกหักกลบไปแล้วไม่ได้', () => C.voidDocument('invoice', b.no, 'ทดสอบยกเลิกใบกำกับ'), 'VOID_HAS_DEPENDENTS');
}

console.log('\n=== 5. เงินมัดจำรับ มีภาษี — ออกใบกำกับตอนรับเงิน แล้วหักในใบกำกับใบสุดท้าย ===');
let dep;
{
  dep = C.receiveCustomerDeposit({ partnerCode: cust2.code, date:'2026-06-25', base:'10000', taxCode:'VAT7',
    desc:'มัดจำงานติดตั้งระบบ 1/3', whtCode:'WHT_SERVICE', bankAccount:'1113' });
  const e = entry(dep.entryNo);
  ok('★ รับมัดจำ 10,000 + ภาษี 700 ลูกค้าหัก 3% = 300 รับสุทธิ 10,400', dep.vat === M('700') && dep.wht === M('300') && dep.net === M('10400')
    && line(e, '1113') === M('10400') && line(e, '1165') === M('300') && line(e, '2161') === -M('10000') && line(e, '2141') === -M('700'));
  const row = D.taxTx.find((t) => t.srcDoc === 'customerDeposit|' + dep.no);
  ok('★ ภาษีขายของเงินมัดจำเข้าทะเบียนภาษีขายเดือนที่รับเงิน (ม.78/1)', row && row.period === '2026-06' && row.tax === M('700') && row.base === M('10000'));
  ok('ยอดคุมผ่าน (ภาษีขายในทะเบียน = บัญชี)', recon('2026-06-30') === '', recon('2026-06-30'));
  throws('ใช้เงินมัดจำที่ออกใบกำกับแล้วไปหักกลบเป็นการชำระไม่ได้ (ภาษีจะซ้ำ)', () => C.applyCustomerCredit({ targetNo: C.issueInvoice({ partnerCode: cust2.code,
    date:'2026-07-01', lines:[{ desc:'ค่าบริการ', qty:1, price:'100', taxCode:'VAT7' }] }).no, sourceNo: dep.no, date:'2026-07-01' }), 'CREDIT_SOURCE_NOT_FOUND');
  throws('หักเงินมัดจำเกินที่มี', () => C.issueInvoice({ partnerCode: cust2.code, date:'2026-07-05', lines:[{ desc:'งานติดตั้ง', qty:1, price:'30000', taxCode:'VAT7' }],
    deposits:[{ no: dep.no, base:'10000.01' }] }), 'DEPOSIT_EXCEEDS');
  throws('หักเงินมัดจำของลูกค้ารายอื่นไม่ได้', () => C.issueInvoice({ partnerCode: cust.code, date:'2026-07-05', lines:[{ desc:'งานติดตั้ง', qty:1, price:'30000', taxCode:'VAT7' }],
    deposits:[{ no: dep.no }] }), 'DEPOSIT_PARTNER_MISMATCH');
  const fin = C.issueInvoice({ partnerCode: cust2.code, date:'2026-07-05', lines:[{ desc:'งานติดตั้งระบบ ส่งมอบงวดสุดท้าย', qty:1, price:'30000', taxCode:'VAT7' }],
    deposits:[{ no: dep.no }] });
  const fe = entry(fin.entryNo);
  ok('★ ใบกำกับใบสุดท้ายหักมัดจำ: มูลค่า 20,000 ภาษี 1,400 รวม 21,400', fin.base === M('20000') && fin.vat === M('1400') && fin.total === M('21400')
    && fin.depositBase === M('10000'), fmt(fin.base) + ' / ' + fmt(fin.vat) + ' / ' + fmt(fin.total));
  ok('★ ใบสำคัญ: Dr ลูกหนี้ 21,400 · Dr เงินมัดจำรับ 10,000 / Cr รายได้ 30,000 · Cr ภาษีขาย 1,400', line(fe, '1131') === M('21400')
    && line(fe, '2161') === M('10000') && line(fe, '2141') === -M('1400'));
  const vatAll = D.taxTx.filter((t) => t.kind === 'vat_output' && (t.docNo === fin.no || t.srcDoc === 'customerDeposit|' + dep.no)).reduce((s, t) => s + t.tax, 0);
  ok('★ ภาษีขายรวมของงานนี้ = 7% ของ 30,000 พอดี ไม่เก็บซ้ำ', vatAll === M('2100'), fmt(vatAll));
  ok('เงินมัดจำรับของลูกค้าหักหมดแล้ว บัญชี 2161 ของลูกค้ารายนี้เป็นศูนย์', C.depositLeft(dep) === 0
    && D.entries.reduce((s, x) => s + x.lines.filter((l) => l.acc === '2161' && l.partner === cust2.code).reduce((a, l) => a + l.dr - l.cr, 0), 0) === 0);
  const rc = C.receivePayment({ invoiceNo: fin.no, date:'2026-07-10', whtCode:'WHT_SERVICE' });
  ok('★ ลูกค้าหัก ณ ที่จ่ายใบสุดท้ายเฉพาะส่วนที่เหลือ 20,000 (ส่วนมัดจำหักไปแล้ว)', rc.whtBase === M('20000') && rc.wht === M('600'), fmt(rc.whtBase));
  ok('ยอดคุมผ่านทั้งเดือนที่รับมัดจำและเดือนที่ออกใบสุดท้าย', recon('2026-06-30') === '' && recon('2026-07-31') === '', recon('2026-07-31'));
  throws('ยกเลิกเงินมัดจำที่หักในใบกำกับแล้วไม่ได้', () => C.voidDocument('customerDeposit', dep.no, 'ทดสอบยกเลิกมัดจำ'), 'VOID_HAS_DEPENDENTS');
  C.voidDocument('receipt', rc.no, 'ทดสอบยกเลิกใบเสร็จ');
  C.voidDocument('invoice', fin.no, 'ทดสอบยกเลิกใบกำกับที่หักมัดจำ');
  ok('★ ยกเลิกใบกำกับที่หักมัดจำ เงินมัดจำกลับไปรอหักใบถัดไป', C.depositLeft(dep) === M('10000') && C.depositVatLeft(dep) === M('700') && recon('2026-07-31') === '', recon('2026-07-31'));
  const part = C.issueInvoice({ partnerCode: cust2.code, date:'2026-07-06', lines:[{ desc:'งานงวดที่ 1', qty:1, price:'15000', taxCode:'VAT7' }],
    deposits:[{ no: dep.no, base:'4000' }] });
  ok('หักมัดจำบางส่วนได้ ภาษีคิดจากส่วนที่เหลือ 11,000', part.base === M('11000') && part.vat === M('770') && C.depositLeft(dep) === M('6000')
    && dep.appliedVat === M('280'), fmt(dep.appliedVat));
  ok('ยอดคุมผ่าน', recon('2026-07-31') === '', recon('2026-07-31'));
}

console.log('\n=== 6. คืนเงินมัดจำเมื่อบอกเลิกสัญญา — ลดภาษีขายในเดือนที่คืน ===');
{
  const rf = C.refundCustomerCredit({ sourceNo: dep.no, date:'2026-08-05', amount:'6000', bankAccount:'1113' });
  const row = D.taxTx.find((t) => t.srcDoc === 'creditApply|' + rf.no);
  ok('★ คืน 6,000 + ภาษี 420 แถวภาษีขายติดลบเดือนสิงหาคม อ้างใบมัดจำเดิม', rf.cash === M('6420') && rf.vat === M('420')
    && row && row.period === '2026-08' && row.tax === -M('420') && row.base === -M('6000') && row.refDoc === dep.no);
  ok('ภาษีของเงินมัดจำใช้หมดพอดี (หักในใบกำกับ 280 + คืน 420 = 700)', C.depositLeft(dep) === 0 && C.depositVatLeft(dep) === 0);
  ok('ยอดคุมผ่านเดือนสิงหาคม', recon('2026-08-31') === '', recon('2026-08-31'));
}

console.log('\n=== 7. เงินรับล่วงหน้าที่ไม่มีภาษี — หักกลบเป็นการชำระหนี้ ===');
{
  const nd = C.receiveCustomerDeposit({ partnerCode: cust.code, date:'2026-07-01', base:'5000', taxCode:'NONE', desc:'เงินประกันสัญญา' });
  ok('ไม่มีภาษีและไม่เข้าทะเบียนภาษีขาย', nd.vat === 0 && !D.taxTx.some((t) => t.srcDoc === 'customerDeposit|' + nd.no));
  throws('หักเงินที่ไม่ได้ออกใบกำกับเป็นมูลค่าในใบกำกับไม่ได้', () => C.issueInvoice({ partnerCode: cust.code, date:'2026-07-05',
    lines:[{ desc:'งาน', qty:1, price:'3000', taxCode:'VAT7' }], deposits:[{ no: nd.no }] }), 'DEPOSIT_NOT_TAXABLE');
  const t = inv('2026-07-05', '3000');
  const ap = C.applyCustomerCredit({ targetNo: t.no, sourceNo: nd.no, date:'2026-07-06' });
  ok('★ หักเงินรับล่วงหน้ากับใบกำกับ (ภาษีเต็มในใบกำกับ) ใบกำกับปิดครบ เหลือเครดิต 1,790', ap.amount === M('3210') && C.invOutstanding(t) === 0
    && C.depositLeft(nd) === M('1790') && t.status === 'paid');
  ok('ยอดคุมผ่าน', recon('2026-07-31') === '', recon('2026-07-31'));
}

console.log('\n=== 8. ตัดหนี้สูญ ===');
{
  const t = inv('2026-07-08', '10000');
  C.receivePayment({ invoiceNo: t.no, date:'2026-07-09', amount:'4000' });
  throws('ตัดหนี้สูญต้องมีเหตุผล', () => C.writeOffBadDebt({ invoiceNo: t.no, date:'2026-07-20' }), 'REASON_REQUIRED');
  const out0 = C.invOutstanding(t), vat0 = gl('output_vat', '2026-07-31');
  const wo = C.writeOffBadDebt({ invoiceNo: t.no, date:'2026-07-20', reason:'ลูกหนี้ปิดกิจการ ทวงถามแล้ว 3 ครั้ง' });
  ok('★ ตัดหนี้สูญยอดค้างรวมภาษี 6,700 Dr หนี้สูญ / Cr ลูกหนี้ ภาษีขายไม่เปลี่ยน', wo.amount === out0 && out0 === M('6700')
    && line(entry(wo.entryNo), '5351') === M('6700') && gl('output_vat', '2026-07-31') === vat0);
  ok('★ ใบกำกับขึ้นว่าตัดหนี้สูญ ไม่ใช่รับชำระครบ', t.status === 'written_off' && C.invOutstanding(t) === 0);
  ok('ยอดคุมผ่าน', recon('2026-07-31') === '', recon('2026-07-31'));
  C.voidDocument('badDebt', wo.no, 'ลูกหนี้กลับมาชำระ ทดสอบ');
  ok('ยกเลิกการตัดหนี้สูญ ยอดค้างกลับมา', C.invOutstanding(t) === M('6700') && t.status === 'partially_paid' && recon('2026-07-31') === '');
  const t2 = inv('2026-07-08', '1000');
  const wa = C.writeOffBadDebt({ invoiceNo: t2.no, date:'2026-07-21', method:'allowance', reason:'ตัดกับค่าเผื่อที่ตั้งไว้ปลายปีก่อน' });
  ok('ตัดกับค่าเผื่อหนี้สงสัยจะสูญได้ (Dr 1139)', line(entry(wa.entryNo), '1139') === M('1070'));
}

console.log('\n=== 9. ตั้งหนี้หลายบรรทัด แต่ละบรรทัดเลือกบัญชีและอัตราภาษีเอง · หัก ณ ที่จ่ายตามทะเบียนผู้ขาย ===');
let bill;
{
  bill = C.recordBill({ partnerCode: ven.code, date:'2026-06-10', vendorNo:'SV-6906-001', lines:[
    { desc:'ค่าแรงซ่อมเครื่องจักร', qty:1, price:'4000', acc:'5325', taxCode:'VAT7' },
    { desc:'ค่าอะไหล่', qty:2, price:'3000', acc:'5325', taxCode:'VAT7' },
    { desc:'ค่าเดินทางที่ผู้ขายจ่ายแทน', qty:1, price:'500', acc:'5358', taxCode:'EXEMPT' }] });
  ok('★ ใบกำกับเดียวหลายบรรทัด ภาษีเฉพาะบรรทัด VAT 7%', bill.lines.length === 3 && bill.base === M('10500') && bill.vat === M('700') && bill.total === M('11200'));
  ok('★ ไม่ระบุหัก ณ ที่จ่าย = ใช้ประเภทในทะเบียนผู้ขาย', bill.whtCode === 'WHT_SERVICE');
  ok('บรรทัดเก็บอัตราภาษีไว้ (ใช้ตอนลดหนี้)', bill.lines.map((l) => l.taxCode).join(',') === 'VAT7,VAT7,EXEMPT');
  const row = D.taxTx.find((t) => t.entryNo === bill.entryNo);
  ok('ทะเบียนภาษีซื้อแยกมูลค่าที่เสียภาษีกับยกเว้น', row.base === M('10000') && row.exempt === M('500') && row.tax === M('700'));
  throws('เลขใบกำกับเดิมของผู้ขายเดิมบันทึกซ้ำไม่ได้', () => C.recordBill({ partnerCode: ven.code, date:'2026-06-10', vendorNo:'SV-6906-001',
    lines:[{ desc:'ซ้ำ', qty:1, price:'100', acc:'5325' }] }), 'DUPLICATE_VENDOR_INVOICE');
  const gb = C.recordBill({ partnerCode: sup.code, date:'2026-06-11', vendorNo:'GD-1', lines:[
    { desc:'ซื้อสินค้า A', qty:10, price:'100', acc:'1154', itemCode: item.code, taxCode:'VAT7' }] });
  ok('★ ซื้อสินค้าเข้าคลังล้วน ไม่หัก ณ ที่จ่ายแม้ผู้ขายตั้งประเภทไว้', gb.whtCode === null && item.qty === 10);
  const nb = C.recordBill({ partnerCode: ven.code, date:'2026-06-12', vendorNo:'SV-NONE', whtCode:'none', lines:[{ desc:'ค่าบริการ', qty:1, price:'2000', acc:'5325' }] });
  ok('เลือก "none" ตอนตั้งหนี้ = ไม่หัก', nb.whtCode === null);
  ok('ยอดคุมผ่าน', recon('2026-06-30') === '', recon('2026-06-30'));
}

console.log('\n=== 10. จ่ายชำระ: เลือกไม่หักได้จริง · ระบุฐานภาษีเอง · ส่วนลดรับ · ค่าโอน ===');
{
  const b1 = C.recordBill({ partnerCode: ven.code, date:'2026-06-13', vendorNo:'SV-A', lines:[{ desc:'ค่าบริการ', qty:1, price:'5000', acc:'5325' }] });
  const certs0 = D.docs.whtCert.length;
  const p1 = C.payBill({ billNo: b1.no, date:'2026-06-20', whtCode:'none' });
  ok('★ เลือก "ไม่หักภาษี ณ ที่จ่าย" ตอนจ่าย ระบบไม่หักและไม่ออก 50 ทวิ', p1.wht === 0 && p1.net === M('5350') && D.docs.whtCert.length === certs0);
  const p2 = C.payBill({ billNo: bill.no, date:'2026-06-20', whtBase:'4000', bankAccount:'1114' });
  const cert = D.docs.whtCert.find((c) => c.no === p2.certNo);
  ok('★ หักเฉพาะค่าแรง 4,000 ไม่รวมค่าอะไหล่และเงินที่จ่ายแทน → 120 บาท 50 ทวิ ฐาน 4,000', p2.wht === M('120') && cert && cert.base === M('4000')
    && D.taxTx.find((t) => t.docNo === p2.no && t.kind === 'wht').base === M('4000'));
  ok('จ่ายจากบัญชีที่เลือก 1114', line(entry(p2.entryNo), '1114') === -M('11080'));
  throws('ฐานภาษีเกินยอดจ่ายไม่ได้', () => C.payBill({ billNo: C.recordBill({ partnerCode: ven.code, date:'2026-06-13', vendorNo:'SV-X',
    lines:[{ desc:'ค่าบริการ', qty:1, price:'1000', acc:'5325' }] }).no, date:'2026-06-20', whtBase:'5000' }), 'WHT_BASE_INVALID');
  const b3 = C.recordBill({ partnerCode: sup.code, date:'2026-06-13', vendorNo:'SUP-D', whtCode:null, lines:[{ desc:'วัสดุ', qty:1, price:'10000', acc:'5324' }] });
  const p3 = C.payBill({ billNo: b3.no, date:'2026-06-25', amount:'10600', diffType:'discount', fee:'25' });
  const e3 = entry(p3.entryNo);
  ok('★ จ่ายขาด 100 ผู้ขายยอมลด → ส่วนลดรับ 5112 รายการปิดครบ', p3.diff === M('100') && line(e3, '5112') === -M('100') && C.billOutstanding(b3) === 0 && b3.status === 'paid');
  ok('★ ค่าโอนที่บริษัทจ่ายเพิ่ม 25 ลงค่าธรรมเนียม เงินออกจากธนาคาร 10,625', line(e3, '5410') === M('25') && line(e3, '1113') === -M('10625'));
  const b4 = C.recordBill({ partnerCode: sup.code, date:'2026-06-13', vendorNo:'SUP-E', whtCode:null, lines:[{ desc:'วัสดุ', qty:1, price:'1000', acc:'5324' }] });
  const p4 = C.payBill({ billNo: b4.no, date:'2026-06-25', amount:'1069', diffType:'other_income' });
  ok('ส่วนต่างลงรายได้อื่น 4260 ได้', line(entry(p4.entryNo), '4260') === -M('1'));
  throws('จ่ายจากบัญชีที่ไม่ใช่เงินสด/ธนาคารไม่ได้', () => C.payBill({ billNo: nbFind(), date:'2026-06-25', bankAccount:'5324' }), 'CASH_ACCOUNT_INVALID');
  ok('ยอดคุมผ่าน (เจ้าหนี้รายใบนับส่วนลดที่ปิดยอด)', recon('2026-06-30') === '', recon('2026-06-30'));
  C.voidDocument('payment', p3.no, 'ทดสอบยกเลิกใบสำคัญจ่าย');
  ok('ยกเลิกใบสำคัญจ่าย ส่วนลดที่ปิดยอดกลับเป็นยอดค้าง', C.billOutstanding(b3) === M('10700') && b3.status === 'issued' && recon('2026-06-30') === '');
}
function nbFind() { return D.docs.bill.find((b) => b.vendorNo === 'SV-NONE').no; }

console.log('\n=== 11. ใบเตรียมจ่ายหัก ณ ที่จ่ายตามทะเบียนผู้ขาย ===');
{
  const b = C.recordBill({ partnerCode: ven.code, date:'2026-06-14', vendorNo:'SV-PB', lines:[{ desc:'ค่าบริการบำรุงรักษา', qty:1, price:'8000', acc:'5325' }] });
  const pb = C.createPaymentBatch({ date:'2026-06-26', billNos:[b.no] });
  C.approvePaymentBatch(pb.no);
  const made = C.payPaymentBatch(pb.no, { bankAccount:'1113' });
  ok('★ จ่ายตามใบเตรียมจ่าย หัก 3% = 240 และออก 50 ทวิ ให้ (เดิมได้ศูนย์)', made[0].wht === M('240') && !!made[0].certNo);
}

console.log('\n=== 12. ค่าใช้จ่ายระบุฐานภาษีหัก ณ ที่จ่ายเอง ===');
{
  const ex = C.recordExpense({ partnerCode: ven.code, date:'2026-06-27', taxInvoiceNo:'SV-EX-1', whtCode:'WHT_SERVICE', whtBase:'4000',
    lines:[{ desc:'ค่าบริการ', qty:1, price:'4000', acc:'5325', taxCode:'VAT7' }, { desc:'ค่าอะไหล่', qty:1, price:'6000', acc:'5325', taxCode:'VAT7' }] });
  const cert = D.docs.whtCert.find((c) => c.no === ex.certNo);
  ok('★ หัก 3% จากค่าบริการ 4,000 = 120 ไม่ใช่ 300', ex.wht === M('120') && ex.whtBase === M('4000') && cert.base === M('4000'));
  throws('ฐานเกินยอดก่อนภาษีไม่ได้', () => C.recordExpense({ partnerCode: ven.code, date:'2026-06-27', whtCode:'WHT_SERVICE', whtBase:'99999',
    lines:[{ desc:'ค่าบริการ', qty:1, price:'4000', acc:'5325', taxCode:'EXEMPT' }] }), 'WHT_BASE_INVALID');
  ok('ยอดคุมผ่าน', recon('2026-06-30') === '', recon('2026-06-30'));
}

console.log('\n=== 13. เงินมัดจำจ่าย — มีใบกำกับภาษี หักในใบตั้งหนี้ใบสุดท้าย ===');
{
  const vd = C.payVendorDeposit({ partnerCode: ven.code, date:'2026-06-28', base:'20000', taxCode:'VAT7', vendorNo:'SV-DEP-1',
    whtCode:'WHT_SERVICE', bankAccount:'1113' });
  const e = entry(vd.entryNo);
  ok('★ จ่ายมัดจำ 20,000 + ภาษีซื้อ 1,400 หัก 3% = 600 จ่ายสุทธิ 20,800 พร้อม 50 ทวิ', vd.vat === M('1400') && vd.wht === M('600') && vd.net === M('20800')
    && line(e, '1180') === M('20000') && line(e, '1161') === M('1400') && line(e, '2146') === -M('600') && !!vd.certNo);
  ok('ภาษีซื้อของเงินมัดจำเข้าทะเบียนภาษีซื้อเดือนที่จ่าย', D.taxTx.some((t) => t.srcDoc === 'vendorDeposit|' + vd.no && t.kind === 'vat_input' && t.tax === M('1400') && t.period === '2026-06'));
  throws('ใบกำกับมัดจำเลขเดิมบันทึกเป็นตั้งหนี้ซ้ำไม่ได้', () => C.recordBill({ partnerCode: ven.code, date:'2026-07-02', vendorNo:'SV-DEP-1',
    lines:[{ desc:'x', qty:1, price:'1', acc:'5325' }] }), 'DUPLICATE_VENDOR_INVOICE');
  const fb = C.recordBill({ partnerCode: ven.code, date:'2026-07-02', vendorNo:'SV-FIN-1', lines:[{ desc:'งานปรับปรุงสำนักงาน', qty:1, price:'50000', acc:'5325' }],
    deposits:[{ no: vd.no }] });
  const fe = entry(fb.entryNo);
  ok('★ ตั้งหนี้ใบสุดท้ายหักมัดจำ: มูลค่า 30,000 ภาษีซื้อ 2,100 เจ้าหนี้ 32,100 ค่าใช้จ่ายเต็ม 50,000', fb.base === M('30000') && fb.vat === M('2100')
    && fb.total === M('32100') && line(fe, '5325') === M('50000') && line(fe, '1180') === -M('20000') && line(fe, '2121') === -M('32100'));
  const p = C.payBill({ billNo: fb.no, date:'2026-07-10' });
  ok('★ หัก ณ ที่จ่ายใบสุดท้ายเฉพาะส่วนที่เหลือ 30,000 → 900', p.whtBase === M('30000') && p.wht === M('900'));
  ok('ยอดคุมผ่าน', allRecon() === '', allRecon());
}

console.log('\n=== 14. เงินมัดจำจ่ายไม่มีใบกำกับ — หักกลบกับรายการตั้งหนี้ ===');
{
  const vd = C.payVendorDeposit({ partnerCode: ven.code, date:'2026-07-03', base:'10000', taxCode:'NONE', whtCode:'WHT_SERVICE' });
  ok('ไม่มีภาษีซื้อ หัก 3% จากเงินที่จ่ายล่วงหน้า', vd.vat === 0 && vd.wht === M('300'));
  throws('หักมัดจำที่ไม่มีใบกำกับเป็นมูลค่าในใบตั้งหนี้ไม่ได้', () => C.recordBill({ partnerCode: ven.code, date:'2026-07-04', vendorNo:'SV-FIN-2',
    lines:[{ desc:'งาน', qty:1, price:'30000', acc:'5325' }], deposits:[{ no: vd.no }] }), 'DEPOSIT_NOT_TAXABLE');
  const b = C.recordBill({ partnerCode: ven.code, date:'2026-07-04', vendorNo:'SV-FIN-2', lines:[{ desc:'งานติดตั้ง', qty:1, price:'30000', acc:'5325' }] });
  const ap = C.applyVendorCredit({ targetNo: b.no, sourceNo: vd.no, date:'2026-07-05' });
  ok('★ หักกลบเงินมัดจำจ่ายกับรายการตั้งหนี้ Dr เจ้าหนี้ / Cr เงินมัดจำจ่าย', ap.amount === M('10000') && C.billOutstanding(b) === M('22100')
    && line(entry(ap.entryNo), '1180') === -M('10000') && line(entry(ap.entryNo), '2121') === M('10000'));
  const p = C.payBill({ billNo: b.no, date:'2026-07-10' });
  ok('★ จ่ายส่วนที่เหลือหัก ณ ที่จ่ายจากฐาน 20,000 (ส่วนมัดจำหักไปแล้ว) → 600', p.whtBase === M('20000') && p.wht === M('600'), fmt(p.whtBase));
  ok('ยอดคุมผ่าน', allRecon() === '', allRecon());
}

console.log('\n=== 15. ใบลดหนี้จากผู้ขาย — ส่งคืนสินค้า ภาษีซื้อลดในเดือนที่ได้รับใบลดหนี้ ===');
{
  const gb = D.docs.bill.find((b) => b.vendorNo === 'GD-1');
  C.issueInvoice({ partnerCode: cust.code, date:'2026-06-20', lines:[{ desc:'ขายสินค้า A', qty:3, price:'200', itemCode: item.code, taxCode:'VAT7' }] });
  ok('ซื้อ 10 ขายไป 3 เหลือ 7', item.qty === 7);
  const jb = C.recordBill({ partnerCode: ven.code, date:'2026-06-29', vendorNo:'SV-JUNE', lines:[{ desc:'ค่าบริการ', qty:1, price:'3000', acc:'5325' }] });
  C.fileVat('2026-06');
  throws('★ ยื่น ภ.พ.30 แล้ว ยกเลิกรายการตั้งหนี้ไม่ได้ (ต้องขอใบลดหนี้)', () => C.voidDocument('bill', jb.no, 'ทดสอบยกเลิกหลังยื่น'), 'TAX_ALREADY_FILED');
  const jcn = C.recordVendorCreditNote({ billNo: jb.no, date:'2026-07-01', vendorCnNo:'SV-JUNE-CN', base:'3000', reason:'CALC_ERROR' });
  ok('★ ทางที่ระบบบอกใช้ได้จริง: ใบลดหนี้จากผู้ขายเต็มจำนวนในเดือนถัดไป รายการตั้งหนี้เหลือศูนย์', C.billOutstanding(jb) === 0 && jcn.total === M('3210'));
  throws('ส่งคืนเกินที่มีในคลังไม่ได้', () => C.recordVendorCreditNote({ billNo: gb.no, date:'2026-07-15', vendorCnNo:'GD-CN-1',
    returnLines:[{ itemCode: item.code, qty: 8 }] }), 'RETURN_EXCEEDS_STOCK');
  throws('ต้องมีเลขที่ใบลดหนี้ของผู้ขาย', () => C.recordVendorCreditNote({ billNo: gb.no, date:'2026-07-15', returnLines:[{ itemCode: item.code, qty: 1 }] }), 'VENDOR_CN_NO_REQUIRED');
  const v0 = item.value;
  const cn = C.recordVendorCreditNote({ billNo: gb.no, date:'2026-07-15', vendorCnNo:'GD-CN-1', returnLines:[{ itemCode: item.code, qty: 5 }] });
  const e = entry(cn.entryNo);
  ok('★ ส่งคืน 5 ชิ้น มูลค่าลดหนี้ 500 + ภาษี 35 · ของออกจากคลังที่ต้นทุนเฉลี่ย', cn.base === M('500') && cn.vat === M('35') && item.qty === 2
    && cn.returns[0].cost === v0 - item.value && line(e, '1154') === -cn.returns[0].cost);
  ok('★ Dr เจ้าหนี้ 535 / Cr ภาษีซื้อ 35 · รายการตั้งหนี้ค้างลดลง 535', line(e, '2121') === M('535') && line(e, '1161') === -M('35')
    && C.billOutstanding(gb) === M('535'));
  const row = D.taxTx.find((t) => t.srcDoc === 'vendorCreditNote|' + cn.no);
  ok('★ ทะเบียนภาษีซื้อเดือนกรกฎาคมมีแถวติดลบ อ้างใบกำกับเดิม (เดือนมิถุนายนที่ยื่นแล้วไม่ถูกแตะ)', row.period === '2026-07' && row.tax === -M('35')
    && row.base === -M('500') && row.docType === 'credit_note' && row.refDoc === 'GD-1' && !row.filingId);
  ok('ยอดคุมผ่าน (สินค้ารายตัว = บัญชี, ภาษีซื้อ = บัญชี)', allRecon() === '', allRecon());
  throws('ส่งคืนเกินที่ซื้อไม่ได้', () => C.recordVendorCreditNote({ billNo: gb.no, date:'2026-07-15', vendorCnNo:'GD-CN-2',
    returnLines:[{ itemCode: item.code, qty: 6 }] }), 'RETURN_EXCEEDS_BOUGHT');
  const sv = D.docs.bill.find((b) => b.vendorNo === 'SV-6906-001');
  const cn2 = C.recordVendorCreditNote({ billNo: sv.no, date:'2026-07-16', vendorCnNo:'SV-CN-1', base:'1000', taxCode:'VAT7', reason:'PRICE_REDUCE' });
  ok('ลดราคาค่าบริการ ไม่มีของคืน → ลดบัญชีค่าใช้จ่ายเดิม 5325', line(entry(cn2.entryNo), '5325') === -M('1000') && cn2.vat === M('70'));
  ok('★ ลดหนี้หลังจ่ายครบแล้ว ผู้ขายเป็นหนี้เรา (ยอดติดลบ) และเป็นเครดิตที่หักกลบได้', C.billOutstanding(sv) === -M('1070') && sv.status === 'vendor_credit'
    && C.creditSources('ap', ven.code).some((s) => s.no === sv.no));
  throws('ใบที่มีหลายอัตรา ต้องเลือกอัตรา', () => C.recordVendorCreditNote({ billNo: sv.no, date:'2026-07-16', vendorCnNo:'SV-CN-2', base:'10' }), 'NOTE_TAX_CODE_REQUIRED');
  throws('ลดหนี้เกินมูลค่าคงเหลือไม่ได้', () => C.recordVendorCreditNote({ billNo: sv.no, date:'2026-07-16', vendorCnNo:'SV-CN-3', base:'501', taxCode:'EXEMPT' }), 'VENDOR_CN_EXCEEDS');
  const nb = C.recordBill({ partnerCode: ven.code, date:'2026-07-17', vendorNo:'SV-NEXT', whtCode:'none', lines:[{ desc:'ค่าบริการ', qty:1, price:'2000', acc:'5325' }] });
  C.applyVendorCredit({ targetNo: nb.no, sourceNo: sv.no, date:'2026-07-18' });
  ok('หักเครดิตของผู้ขายกับรายการตั้งหนี้ใบถัดไป', C.billOutstanding(sv) === 0 && C.billOutstanding(nb) === M('1070') && allRecon() === '', allRecon());
  throws('ยกเลิกรายการตั้งหนี้ที่มีการหักกลบอ้างถึงไม่ได้', () => C.voidDocument('bill', nb.no, 'ทดสอบยกเลิก'), 'VOID_HAS_DEPENDENTS');
  throws('ยกเลิกรายการตั้งหนี้ที่มีใบลดหนี้อ้างถึงไม่ได้', () => C.voidDocument('bill', jb.no, 'ทดสอบยกเลิก'), 'VOID_HAS_DEPENDENTS');
  C.voidDocument('vendorCreditNote', cn.no, 'ผู้ขายยกเลิกใบลดหนี้ ทดสอบ');
  ok('★ ยกเลิกใบลดหนี้จากผู้ขาย ของกลับเข้าคลัง ภาษีซื้อในทะเบียนเป็นศูนย์ ยอดค้างกลับ', item.qty === 7 && item.value === v0
    && row.void && C.billOutstanding(gb) === M('1070') && allRecon() === '', allRecon());
}

console.log('\n=== 15.1 เงินมัดจำที่อยู่ในบัญชีแล้วแต่ไม่มีเอกสาร (ยกมาจากระบบเดิม/ลงด้วยใบสำคัญ) ===');
{
  /* จำลองยอดยกมา: เงินมัดจำรับ 8,000 ที่ลงด้วยใบสำคัญ ไม่มีเอกสารรายใบ */
  C.post({ type:'general', date:'2026-07-01', desc:'ยอดยกมาเงินมัดจำรับจากระบบเดิม', lines:[{ acc:'1113', dr: M('8000') }, { acc:'2161', cr: M('8000'), partner: cust.code }] });
  ok('ระบบเห็นยอดในบัญชีที่ยังไม่มีรายใบ 8,000', C.depositUnallocated('ar') === M('8000'), fmt(C.depositUnallocated('ar')));
  throws('ตั้งรายใบเกินยอดในบัญชีไม่ได้', () => C.registerDepositBalance('ar', { partnerCode: cust.code, date:'2026-07-01', base:'8000.01' }), 'DEPOSIT_NO_BALANCE');
  const n0 = D.entries.length;
  const bf = C.registerDepositBalance('ar', { partnerCode: cust.code, date:'2026-07-01', base:'8000', desc:'มัดจำระบบเดิม' });
  ok('★ ตั้งเป็นรายใบโดยไม่ลงบัญชีซ้ำ', D.entries.length === n0 && C.depositUnallocated('ar') === 0 && bf.broughtForward);
  const t = inv('2026-07-20', '5000');
  C.applyCustomerCredit({ targetNo: t.no, sourceNo: bf.no, date:'2026-07-21' });
  ok('★ เงินมัดจำที่ยกมาหักกับใบกำกับได้แล้ว', C.invOutstanding(t) === 0 && C.depositLeft(bf) === M('2650'));
  throws('ยกเลิกยอดยกมาที่ใช้ไปแล้วไม่ได้', () => C.cancelDepositBalance('ar', bf.no, 'ทดสอบยกเลิกยอดยกมา'), 'VOID_HAS_DEPENDENTS');
  /* เงินมัดจำค่าเช่าที่จ่ายผ่านแบบฟอร์มค่าใช้จ่าย (บัญชีเงินมัดจำจ่าย) */
  C.recordExpense({ partnerCode: sup.code, date:'2026-07-02', lines:[{ desc:'เงินประกันการเช่าโกดัง', qty:1, price:'30000', acc:'1180', taxCode:'EXEMPT' }] });
  ok('เงินมัดจำจ่ายที่ลงผ่านค่าใช้จ่ายเห็นเป็นยอดที่ยังไม่มีรายใบ', C.depositUnallocated('ap') === M('30000'));
  const vb = C.registerDepositBalance('ap', { partnerCode: sup.code, date:'2026-07-02', base:'30000' });
  const b = C.recordBill({ partnerCode: sup.code, date:'2026-07-25', vendorNo:'RENT-7', whtCode:'none', lines:[{ desc:'ค่าเช่าเดือนสุดท้าย', qty:1, price:'30000', acc:'5321', taxCode:'EXEMPT' }] });
  C.applyVendorCredit({ targetNo: b.no, sourceNo: vb.no, date:'2026-07-26' });
  ok('★ หักเงินประกันกับค่าเช่าเดือนสุดท้ายได้ รายการตั้งหนี้ปิดครบ', C.billOutstanding(b) === 0 && C.depositUnallocated('ap') === 0);
  ok('ยอดคุมผ่าน', allRecon() === '', allRecon());
  const extra = C.registerDepositBalance;
  ok('ยอดยกมาที่ยังไม่ได้ใช้ ยกเลิกได้', (() => { C.post({ type:'general', date:'2026-07-03', desc:'ยกมา', lines:[{ acc:'1113', dr: M('100') }, { acc:'2161', cr: M('100') }] });
    const x = extra('ar', { partnerCode: cust2.code, date:'2026-07-03', base:'100' }); C.cancelDepositBalance('ar', x.no, 'ตั้งผิดลูกค้า ทดสอบ');
    return x.status === 'void' && C.depositUnallocated('ar') === M('100'); })());
  extra('ar', { partnerCode: cust2.code, date:'2026-07-03', base:'100' });
  ok('ตั้งใหม่ให้ถูกแล้ว ยอดในบัญชีมีรายใบรองรับครบ', C.depositUnallocated('ar') === 0);
}

console.log('\n=== 15.2 ยกเลิกเอกสารใหม่ทุกชนิด — กลับครบทุกทะเบียน ===');
{
  const d = C.receiveCustomerDeposit({ partnerCode: cust.code, date:'2026-08-10', base:'2000', taxCode:'VAT7' });
  C.voidDocument('customerDeposit', d.no, 'ลูกค้ายกเลิกการสั่ง ทดสอบ');
  const row = D.taxTx.find((t) => t.srcDoc === 'customerDeposit|' + d.no);
  ok('★ ยกเลิกใบรับเงินมัดจำ ภาษีขายในทะเบียนเป็นศูนย์ ใบสำคัญกลับรายการ', row.void && row.tax === 0 && entry(d.entryNo).status === 'reversed' && C.depositLeft(d) === 0);
  const v = C.payVendorDeposit({ partnerCode: ven.code, date:'2026-08-10', base:'5000', taxCode:'NONE', whtCode:'WHT_SERVICE' });
  C.voidDocument('vendorDeposit', v.no, 'จ่ายผิดผู้ขาย ทดสอบ');
  ok('★ ยกเลิกใบจ่ายเงินมัดจำ 50 ทวิ ถูกยกเลิก และตัดออกจาก ภ.ง.ด.53', D.docs.whtCert.find((c) => c.no === v.certNo).status === 'void'
    && D.taxTx.find((t) => t.srcDoc === 'vendorDeposit|' + v.no && t.kind === 'wht').void);
  const t = inv('2026-08-11', '1000');
  const r = C.receivePayment({ invoiceNo: t.no, date:'2026-08-12', amount:'1500', diffType:'credit' });
  C.voidDocument('receipt', r.no, 'ใส่ยอดผิด ทดสอบ');
  ok('ยกเลิกใบเสร็จที่มีเงินรับเกิน เครดิตรับเกินถูกยกเลิกด้วย', D.docs.customerDeposit.find((x) => x.no === r.no).status === 'void'
    && C.invOutstanding(t) === M('1070'));
  const mixed = C.recordBill({ partnerCode: ven.code, date:'2026-08-13', vendorNo:'MIX-1', lines:[
    { desc:'สินค้า A', qty:1, price:'100', acc:'1154', itemCode: item.code }, { desc:'ค่าติดตั้ง', qty:1, price:'900', acc:'5325' }] });
  ok('ใบที่มีค่าบริการปนค่าสินค้า ใช้ประเภทหัก ณ ที่จ่ายตามทะเบียนผู้ขาย (แก้ฐานได้ตอนจ่าย)', mixed.whtCode === 'WHT_SERVICE');
  const p8 = D.periods.find((x) => x.code === '2026-08'); p8.status = 'closed';
  throws('งวดปิดแล้วรับเงินมัดจำไม่ได้', () => C.receiveCustomerDeposit({ partnerCode: cust.code, date:'2026-08-20', base:'100', taxCode:'NONE' }), 'PERIOD_CLOSED');
  throws('งวดปิดแล้วตัดหนี้สูญไม่ได้', () => C.writeOffBadDebt({ invoiceNo: t.no, date:'2026-08-20', reason:'ทดสอบงวดปิด' }), 'PERIOD_CLOSED');
  p8.status = 'open';
  ok('ยอดคุมผ่าน', allRecon() === '', allRecon());
}

console.log('\n=== 16. ภาพรวม ===');
{
  const tb = C.trialBalance('2026-01-01', '2026-12-31');
  ok('★ งบทดลองสมดุล', tb.balanced);
  ok('★ ยอดคุมทุกเดือนผ่าน: ลูกหนี้/เจ้าหนี้รายใบ = บัญชีคุม · ภาษีขาย/ซื้อในทะเบียน = บัญชี · สินค้า', allRecon() === '', allRecon());
  const seq0 = JSON.stringify(D.seq), n0 = D.entries.length;
  throws('คำสั่งที่ล้มไม่จองเลขที่', () => C.receiveCustomerDeposit({ partnerCode: cust.code, date:'2026-07-01', base:'100', bankAccount:'5324' }), 'CASH_ACCOUNT_INVALID');
  ok('เลขที่และใบสำคัญไม่ถูกจองทิ้ง', JSON.stringify(D.seq) === seq0 && D.entries.length === n0);
}

done();
