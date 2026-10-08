/* ทดสอบเครื่องบัญชีในเบราว์เซอร์ — รันด้วย node webapp/test.js */
const fs = require('fs');
const src = ['engine','operations','seed','import'].map(f => fs.readFileSync(__dirname + '/src/' + f + '.js','utf8')).join('\n');
const ctx = new Function(src + '\nreturn {DB,buildSeed,trialBalance,balanceSheet,incomeStatement,cashFlow,' +
  'reconciliationChecks,aging,issueInvoice,receivePayment,issueCreditNote,recordBill,payBill,' +
  'runPayroll,runDepreciation,fileVat,fileWht,post,reverse,fmt,M,validTaxId,DomainError,' +
  'closeChecklist,closePeriod,resolveRate,round2,pct,periodOf,computePit,ssoRate,divRound,buildBlank,' +
  'issueDebitNote,DN_REASONS,issueTradeDoc,setTradeDocStatus,convertTradeDoc,tradeDocStatus,' +
  'detectColumns,readTrialBalance,parseCsv,parseAmount,detectFileKind,' +
  'inferSubType,proposeAccount,previewOpening,importOpeningBalances,subTypeType,' +
  'importPeriodMovement,listImports,reverseImport,endOfMonth,' +
  'savePartner,saveItem,saveEmployee,saveAsset,nextRegCode,TAX_DEPRECIATION,' +
  'DBD_SUBTYPE,BS_LINES,PL_LINES,balBySub,' +
  'TRADE_DOCS,invOutstanding,outstandingAsOf,unM,' +
  'issueBillingNote,cancelBillingNote,receiveBillingNote,billingNoteStatus,' +
  'issueGoodsReceipt,receiveGoodsFromPo,billGoodsReceipt,recordExpense,billOutstanding,' +
  'createPaymentBatch,approvePaymentBatch,payPaymentBatch,postJournalVoucher,journalOf};')();

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ผ่าน   ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ไม่ผ่าน ' + label + (extra ? '  ' + extra : '')); }
}
function throws(label, fn, code) {
  try { fn(); fail++; console.log('  ไม่ผ่าน ' + label + ' — ไม่ได้ถูกปฏิเสธ'); }
  catch (e) {
    if (e.code === code) { pass++; console.log('  ผ่าน   ' + label + ' → ' + e.message.slice(0, 70)); }
    else { fail++; console.log('  ไม่ผ่าน ' + label + ' — ได้ ' + (e.code || e.message)); }
  }
}

ctx.buildSeed();
const D = ctx.DB;

console.log('\n=== 1. ข้อมูลตัวอย่างที่สร้างได้ ===');
ok('ผังบัญชี', D.accounts.length > 60, D.accounts.length + ' บัญชี');
ok('รายการบัญชี', D.entries.length > 150, D.entries.length + ' รายการ');
ok('ใบกำกับภาษี', D.docs.invoice.length > 30, D.docs.invoice.length + ' ใบ');
ok('ใบเสร็จรับเงิน', D.docs.receipt.length > 15, D.docs.receipt.length + ' ใบ');
ok('ตั้งหนี้ผู้ขาย', D.docs.bill.length > 30, D.docs.bill.length + ' รายการ');
ok('ใบสำคัญจ่าย', D.docs.payment.length > 20, D.docs.payment.length + ' ใบ');
ok('หนังสือรับรอง 50 ทวิ', D.docs.whtCert.length > 5, D.docs.whtCert.length + ' ฉบับ');
ok('รายการภาษี', D.taxTx.length > 80, D.taxTx.length + ' รายการ');
ok('งวดเงินเดือน', D.docs.payRun.length === 6, D.docs.payRun.length + ' งวด');
ok('ค่าเสื่อมราคา', D.docs.depreciation.length === 6, D.docs.depreciation.length + ' งวด');
ok('แบบภาษีที่ยื่น', D.docs.filing.length >= 6, D.docs.filing.length + ' แบบ');

console.log('\n=== 2. ความถูกต้องทางบัญชี ===');
const tb = ctx.trialBalance('2026-01-01','2026-12-31');
ok('งบทดลองสมดุล', tb.balanced, 'เดบิต ' + ctx.fmt(tb.totalDr) + ' = เครดิต ' + ctx.fmt(tb.totalCr));
const bs = ctx.balanceSheet('2026-06-30');
ok('งบแสดงฐานะการเงินสมดุล', bs.diff === 0,
   'สินทรัพย์ ' + ctx.fmt(bs.assets) + ' vs หนี้สินและทุน ' + ctx.fmt(bs.liabEquity));
const liabSub = bs.lines.find((l) => l.section === 'le_sub');
const liabParts = bs.lines.filter((l) => l.k === 's' && l.section === 'le').slice(0, 2)
  .reduce((s2, l) => s2 + l.value, 0);
ok('รวมหนี้สิน = หนี้สินหมุนเวียน + หนี้สินไม่หมุนเวียน',
   liabSub && liabSub.value === liabParts && liabParts > 0,
   ctx.fmt(liabSub ? liabSub.value : 0));
ok('หนี้สิน + ส่วนของผู้ถือหุ้น = สินทรัพย์', bs.liabilities + bs.equity === bs.assets,
   'หนี้สิน ' + ctx.fmt(bs.liabilities) + ' + ทุน ' + ctx.fmt(bs.equity));
ok('ยอดหนี้สินที่รายงานออกไปไม่รวมส่วนของผู้ถือหุ้น',
   bs.liabilities > 0 && bs.liabilities < bs.assets && bs.equity > 0);

const rec = ctx.reconciliationChecks('2026-06-30');
rec.checks.forEach((c) => ok(c.label, c.ok, c.ok ? '' : 'ต่าง ' + ctx.fmt(c.control - c.sub)));

const pl = ctx.incomeStatement('2026-01-01','2026-06-30');
ok('งบกำไรขาดทุนคำนวณได้', pl.revenue > 0,
   'รายได้ ' + ctx.fmt(pl.revenue) + ' กำไรสุทธิ ' + ctx.fmt(pl.net));
const cf = ctx.cashFlow('2026-01-01','2026-06-30');
ok('งบกระแสเงินสดอธิบายการเปลี่ยนแปลงเงินสดได้ครบ', cf.unexplained === 0,
   'ต้นงวด ' + ctx.fmt(cf.opening) + ' ปลายงวด ' + ctx.fmt(cf.closing) + ' อธิบายไม่ได้ ' + ctx.fmt(cf.unexplained));

const ar = ctx.aging('ar','2026-06-30');
const arGl = D.entries.filter((e) => e.status !== 'draft').reduce(function (s, e) {
  return s + e.lines.filter((l) => l.acc === '1131' && e.date <= '2026-06-30')
    .reduce((t, l) => t + l.dr - l.cr, 0);
}, 0);
ok('ผลรวมอายุลูกหนี้ = บัญชีคุมลูกหนี้', ar.totals.total === arGl,
   ctx.fmt(ar.totals.total) + ' vs ' + ctx.fmt(arGl));

console.log('\n=== 3. กฎที่ต้องบังคับ ===');
throws('รายการไม่สมดุล', () => ctx.post({ type:'general', date:'2026-07-01', desc:'ทดสอบ',
  lines:[{acc:'1113',dr:ctx.M('1000')},{acc:'4111',cr:ctx.M('900')}] }), 'ENTRY_UNBALANCED');
throws('ลงบัญชีหัวข้อ', () => ctx.post({ type:'general', date:'2026-07-01', desc:'ทดสอบ',
  lines:[{acc:'1100',dr:ctx.M('100')},{acc:'4111',cr:ctx.M('100')}] }), 'ACCOUNT_NOT_POSTABLE');
throws('ลูกหนี้ไม่ระบุคู่ค้า', () => ctx.post({ type:'general', date:'2026-07-01', desc:'ทดสอบ',
  lines:[{acc:'1131',dr:ctx.M('100')},{acc:'4111',cr:ctx.M('100')}] }), 'PARTNER_REQUIRED');
throws('วันที่นอกรอบบัญชี', () => ctx.post({ type:'general', date:'2030-01-01', desc:'ทดสอบ',
  lines:[{acc:'1113',dr:ctx.M('100')},{acc:'4111',cr:ctx.M('100')}] }), 'PERIOD_NOT_FOUND');
throws('กลับรายการโดยไม่ระบุเหตุผล', () => ctx.reverse(D.entries[5].no, ''), 'REASON_REQUIRED');
throws('ใบลดหนี้ไม่อ้างใบกำกับเดิม', () => ctx.issueCreditNote({ date:'2026-07-01',
  invoiceNo:'ไม่มีจริง', base:'100', reason:'RETURN_DEFECT' }), 'CREDIT_NOTE_NO_ORIGIN');
throws('ใบกำกับภาษีซื้อซ้ำ', () => ctx.recordBill({ date:'2026-07-01', partnerCode:'VEN-0001',
  vendorNo: D.docs.bill.find((b) => b.partnerCode === 'VEN-0001' && !b.broughtForward).vendorNo,
  lines:[{desc:'ซ้ำ',qty:1,price:'100'}] }), 'DUPLICATE_VENDOR_INVOICE');
throws('ยื่น ภ.พ.30 ซ้ำ', () => ctx.fileVat('2026-01'), 'ALREADY_FILED');
throws('ตั้งค่าเสื่อมซ้ำ', () => ctx.runDepreciation('2026-01'), 'DEPRECIATION_ALREADY_RUN');

console.log('\n=== 3.1 ตั้งบริษัทเปล่า ===');
const coBefore = D.company.name, entriesBefore = D.entries.length;
throws('เลขผู้เสียภาษีของบริษัทผิดหลักที่ 13', () => ctx.buildBlank({ name:'ทดสอบ', taxId:'1234567890123', year:2026 }), 'TAX_ID_INVALID');
throws('ปีรอบบัญชีไม่ถูกต้อง', () => ctx.buildBlank({ name:'ทดสอบ', year:'' }), 'FISCAL_YEAR_INVALID');
ok('★ ตั้งบริษัทไม่สำเร็จต้องไม่แตะข้อมูลเดิมเลย',
   D.company.name === coBefore && D.entries.length === entriesBefore,
   D.company.name);

console.log('\n=== 4. ภาษีมูลค่าเพิ่มและหัก ณ ที่จ่าย ===');
const inv = ctx.issueInvoice({ date:'2026-07-10', partnerCode:'CUS-0012',
  lines:[{ desc:'ชุดควบคุมมอเตอร์ MC-450', qty:4, price:'158000', itemCode:'MC-450' },
         { desc:'ค่าบริการติดตั้ง', qty:1, price:'30000', revenueSub:'service_revenue' }] });
ok('VAT 7% ของ 662,000', inv.vat === ctx.M('46340'), ctx.fmt(inv.vat));
ok('ยอดรวม = ฐาน + VAT', inv.total === inv.base + inv.vat, ctx.fmt(inv.total));
ok('ออกเลขที่ตามงวด', /^INV2607-\d{5}$/.test(inv.no), inv.no);

const inv2 = ctx.issueInvoice({ date:'2026-07-11', partnerCode:'CUS-0012',
  lines:[{desc:'บริการ ก',qty:1,price:'33.33'},{desc:'บริการ ข',qty:1,price:'33.33'},
         {desc:'บริการ ค',qty:1,price:'33.33'}] });
ok('★ ปัดเศษ VAT ที่ระดับเอกสาร (33.33×3 → 7.00 ไม่ใช่ 6.99)', inv2.vat === ctx.M('7'), ctx.fmt(inv2.vat));

const seqBeforeFail = D.seq['invoice|2026-07'];
throws('เลขผู้เสียภาษีผู้ซื้อไม่ถูกต้อง', function () {
  D.partners.push({ code:'CUS-BAD', name:'ลูกค้าเลขภาษีผิด', taxId:'0000000000000',
    branch:'00000', address:'ที่อยู่', entityType:'juristic', kind:'customer', termDays:0, active:true });
  ctx.issueInvoice({ date:'2026-07-12', partnerCode:'CUS-BAD', lines:[{desc:'สินค้า',qty:1,price:'1000'}] });
}, 'TAX_ID_INVALID');
const seqAfterFail = D.seq['invoice|2026-07'];
ok('เลขที่เอกสารไม่ถูกใช้เมื่อออกใบกำกับล้มเหลว', seqAfterFail === seqBeforeFail,
  'ก่อน ' + seqBeforeFail + ' หลัง ' + seqAfterFail);

const r3 = ctx.resolveRate('WHT_SERVICE','2026-07-01',{channel:'manual'});
const r1 = ctx.resolveRate('WHT_SERVICE','2026-07-01',{channel:'e_wht'});
ok('ค่าบริการช่องทางปกติ = 3%', r3.rate === '3');
ok('ค่าบริการผ่าน e-Withholding Tax = 1%', r1.rate === '1');
ok('ปี 2568 ยังไม่มีอัตรา e-WHT รอบใหม่',
   (function(){ try { ctx.resolveRate('WHT_SERVICE','2025-06-01',{channel:'e_wht'}); return false; }
               catch(e){ return e.code === 'TAX_RATE_NOT_FOUND'; } })());

const eWht = D.taxTx.filter((t) => t.kind === 'wht' && t.channel === 'e_wht').length;
const pnd53 = D.docs.filing.filter((f) => f.form === 'PND53');
ok('★ รายการ e-WHT ถูกกันออกจากแบบ ภ.ง.ด.53', eWht > 0 && pnd53.length > 0,
   'e-WHT ' + eWht + ' รายการ ยื่นเอง ' + pnd53.reduce((s,f)=>s+f.count,0) + ' รายการ');
const anyFiled = D.taxTx.filter((t) => t.kind === 'wht' && t.channel === 'e_wht' && t.filingId);
ok('ไม่มีรายการ e-WHT ที่ถูกนำไปยื่นซ้ำ', anyFiled.length === 0);

console.log('\n=== 5. ประกันสังคมและภาษีเงินได้บุคคล ===');
const s68 = ctx.ssoRate('2025-06-15'), s69 = ctx.ssoRate('2026-06-15');
ok('เพดานประกันสังคม 2568 = 15,000 (สมทบสูงสุด 750)', s68.ceiling === ctx.M('15000') && s68.max === ctx.M('750'));
ok('เพดานประกันสังคม 2569 = 17,500 (สมทบสูงสุด 875)', s69.ceiling === ctx.M('17500') && s69.max === ctx.M('875'));
const pr = D.docs.payRun[0];
const high = pr.slips.find((s) => s.salary > ctx.M('17500'));
ok('พนักงานเงินเดือนสูงสมทบตามเพดาน 875', high.sso === ctx.M('875'), ctx.fmt(high.sso));
const pit50k = ctx.computePit(ctx.M('600000'), ctx.M('60000') + ctx.M('10500'));
ok('ภาษีเงินได้ เงินเดือน 50,000/เดือน = 20,450/ปี', pit50k.tax === ctx.M('20450'), ctx.fmt(pit50k.tax));

console.log('\n=== 6. ค่าเสื่อมราคา บัญชี vs ภาษี ===');
const dep = D.docs.depreciation[0];
const car = dep.rows.find((r) => r.class === 'CAR');
ok('รถยนต์นั่งหักค่าเสื่อมทางภาษีจากฐานไม่เกิน 1 ล้านบาท',
   car.tax === ctx.divRound(ctx.pct(ctx.M('1000000'), 20), 12),
   'บัญชี ' + ctx.fmt(car.book) + ' vs ภาษี ' + ctx.fmt(car.tax));
ok('ผลต่างบัญชี-ภาษีถูกบันทึกไว้ให้กระทบยอด ภ.ง.ด.50', dep.diff !== 0, ctx.fmt(dep.diff));

console.log('\n=== 7. กลับรายการ ===');
const target = D.entries.find((e) => e.type === 'general' && e.status === 'posted');
const rev = ctx.reverse(target.no, 'ทดสอบการกลับรายการจากชุดทดสอบ');
const net = [target, rev].reduce((s, e) => s + e.lines.reduce((t, l) => t + l.dr - l.cr, 0), 0);
ok('ยอดสุทธิหลังกลับรายการ = 0', net === 0);
ok('รายการเดิมยังอยู่ในบัญชีแยกประเภท', target.lines.length > 0 && target.status === 'reversed');
ok('งบทดลองยังสมดุลหลังกลับรายการ', ctx.trialBalance('2026-01-01','2026-12-31').balanced);

console.log('\n=== 7.5 ใบเพิ่มหนี้ (ม.86/9) ===');
const dnInv = D.docs.invoice.find((d) => ctx.periodOf(d.date) === '2026-07' && d.status === 'issued' && !d.debited);
const outBefore = ctx.invOutstanding(dnInv);
const tbBeforeDn = ctx.trialBalance('2026-01-01', '2026-12-31');
const dn = ctx.issueDebitNote({ invoiceNo: dnInv.no, date: '2026-07-28',
  base: '1000', reason: 'GOODS_UNDERPRICED' });
ok('ใบเพิ่มหนี้คิดภาษีขาย 7% จากมูลค่าที่เพิ่ม', dn.vat === ctx.M('70'), ctx.fmt(dn.vat));
ok('ยอดคงค้างของใบกำกับเพิ่มขึ้นเท่ายอดรวมใบเพิ่มหนี้',
   ctx.invOutstanding(dnInv) === outBefore + dn.total, ctx.fmt(ctx.invOutstanding(dnInv)));
ok('งบทดลองยังสมดุลหลังออกใบเพิ่มหนี้',
   ctx.trialBalance('2026-01-01', '2026-12-31').balanced);
ok('เดบิตรวมเพิ่มขึ้นเท่ายอดใบเพิ่มหนี้',
   ctx.trialBalance('2026-01-01', '2026-12-31').totalDr === tbBeforeDn.totalDr + dn.total);
const dnTax = D.taxTx.find((t) => t.docNo === dn.no);
ok('ใบเพิ่มหนี้เข้ารายงานภาษีขายเป็นจำนวนบวก (ต่างจากใบลดหนี้ที่ติดลบ)',
   dnTax && dnTax.kind === 'vat_output' && dnTax.tax > 0 && dnTax.refDoc === dnInv.no);
ok('รายงานย้อนหลังก่อนวันออกใบเพิ่มหนี้ ยังไม่รวมยอดที่เพิ่ม',
   ctx.outstandingAsOf('ar', dnInv, '2026-07-28') - ctx.outstandingAsOf('ar', dnInv, '2026-07-27') === dn.total,
   ctx.fmt(ctx.outstandingAsOf('ar', dnInv, '2026-07-27')) + ' → ' + ctx.fmt(ctx.outstandingAsOf('ar', dnInv, '2026-07-28')));
const dnChecks = ctx.reconciliationChecks('2026-07-31').checks;
const arChk = dnChecks.find((c) => c.code === 'AR_SUBLEDGER');
const voChk = dnChecks.find((c) => c.code === 'OUTPUT_VAT');
ok('ลูกหนี้รายรายยังตรงกับบัญชีคุมหลังออกใบเพิ่มหนี้', arChk.ok,
   ctx.fmt(arChk.control) + ' vs ' + ctx.fmt(arChk.sub));
ok('ภาษีขายในทะเบียนยังตรงกับที่ลงบัญชีหลังออกใบเพิ่มหนี้', voChk.ok,
   ctx.fmt(voChk.control) + ' vs ' + ctx.fmt(voChk.sub));

/* ใบเพิ่มหนี้ที่ออกกับใบที่ชำระครบแล้ว ต้องดึงสถานะกลับมาเป็นค้างชำระ */
const paidInv = D.docs.invoice.find((d) => d.status === 'paid' && ctx.periodOf(d.date) === '2026-07');
if (paidInv) {
  ctx.issueDebitNote({ invoiceNo: paidInv.no, date: '2026-07-29', base: '500', reason: 'VAT_UNDERCALC' });
  ok('ใบที่ชำระครบแล้วกลับมาเป็นค้างชำระเมื่อออกใบเพิ่มหนี้',
     paidInv.status === 'partially_paid' && ctx.invOutstanding(paidInv) > 0);
} else { ok('ใบที่ชำระครบแล้วกลับมาเป็นค้างชำระเมื่อออกใบเพิ่มหนี้', true, '(ไม่มีใบที่ชำระครบในงวดนี้)'); }

throws('ใบเพิ่มหนี้ที่ไม่อ้างใบกำกับเดิม',
  () => ctx.issueDebitNote({ invoiceNo: 'ไม่มีจริง', date: '2026-07-28', base: '100', reason: 'GOODS_EXCESS' }),
  'DEBIT_NOTE_NO_ORIGIN');
throws('เหตุผลนอกมาตรา 86/9',
  () => ctx.issueDebitNote({ invoiceNo: dnInv.no, date: '2026-07-28', base: '100', reason: 'ลูกค้าขอ' }),
  'DEBIT_NOTE_REASON_INVALID');
throws('ใบเพิ่มหนี้ลงวันที่ก่อนใบกำกับเดิม',
  () => ctx.issueDebitNote({ invoiceNo: dnInv.no, date: '2026-01-01', base: '100', reason: 'GOODS_EXCESS' }),
  'DEBIT_NOTE_BEFORE_ORIGIN');
throws('ใบเพิ่มหนี้ยอดศูนย์',
  () => ctx.issueDebitNote({ invoiceNo: dnInv.no, date: '2026-07-28', base: '0', reason: 'GOODS_EXCESS' }),
  'DEBIT_NOTE_ZERO');

console.log('\n=== 7.6 เอกสารก่อนลงบัญชี ===');
const cust = D.partners.find((p) => p.kind === 'customer');
const vend = D.partners.find((p) => p.kind === 'vendor');
const entriesBefore2 = D.entries.length;
const q = ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-07-05',
  lines: [{ desc: 'งานวางระบบตามข้อเสนอ', qty: 2, price: '25000' }] });
ok('ใบเสนอราคาคิดยอดรวมภาษีถูกต้อง',
   q.base === ctx.M('50000') && q.vat === ctx.M('3500') && q.total === ctx.M('53500'), ctx.fmt(q.total));
ok('ใบเสนอราคาไม่สร้างใบสำคัญทางบัญชี', D.entries.length === entriesBefore2);
ok('ใบเสนอราคาไม่เข้ารายงานภาษีขาย', !D.taxTx.some((t) => t.docNo === q.no));
ok('ใบเสนอราคาตั้งวันยืนราคาให้อัตโนมัติ 30 วัน', q.validUntil === '2026-08-04', q.validUntil);
ok('พ้นวันยืนราคาแล้วขึ้นสถานะหมดอายุเอง',
   ctx.tradeDocStatus('quotation', q, '2026-08-05') === 'expired'
   && ctx.tradeDocStatus('quotation', q, '2026-08-03') === 'issued');

ctx.setTradeDocStatus('quotation', q.no, 'approved');
const so = ctx.convertTradeDoc('quotation', q.no, { date: '2026-07-08' });
ok('แปลงใบเสนอราคาเป็นใบสั่งขายแล้วยอดไม่เพี้ยน', so.total === q.total, ctx.fmt(so.total));
ok('ใบเสนอราคาถูกปิดและชี้ไปเอกสารปลายทาง',
   q.status === 'closed' && q.convertedTo === so.no);
ok('ใบสั่งขายจำที่มาได้', so.fromDoc === q.no);
const invFromSo = ctx.convertTradeDoc('salesOrder', so.no, { date: '2026-07-10' });
ok('แปลงใบสั่งขายเป็นใบกำกับภาษีแล้วยอดยังเท่าเดิม', invFromSo.total === q.total, ctx.fmt(invFromSo.total));
ok('ใบกำกับที่แปลงมาลงบัญชีจริงและเข้ารายงานภาษีขาย',
   !!invFromSo.entryNo && D.taxTx.some((t) => t.docNo === invFromSo.no));
throws('แปลงเอกสารเดิมซ้ำอีกรอบ',
  () => ctx.convertTradeDoc('quotation', q.no, { date: '2026-07-11' }), 'TRADE_DOC_ALREADY_CONVERTED');
throws('เปลี่ยนสถานะเอกสารที่แปลงไปแล้ว',
  () => ctx.setTradeDocStatus('quotation', q.no, 'cancelled'), 'TRADE_DOC_ALREADY_CONVERTED');
throws('ออกใบเสนอราคาให้ผู้ขาย',
  () => ctx.issueTradeDoc('quotation', { partnerCode: vend.code, date: '2026-07-05',
    lines: [{ desc: 'x', qty: 1, price: '100' }] }), 'PARTNER_WRONG_SIDE');
throws('ใบเสนอราคาไม่มีบรรทัดรายการ',
  () => ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-07-05', lines: [] }), 'NO_LINES');

const po = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-07-06',
  lines: [{ desc: 'สั่งซื้ออุปกรณ์สำนักงาน', qty: 1, price: '18000', expenseSub: 'admin_expense' }] });
ok('ใบสั่งซื้อไม่มีวันยืนราคาและไม่ก่อหนี้', po.validUntil === null && !D.docs.bill.some((b) => b.no === po.no));
throws('ตั้งหนี้จากใบสั่งซื้อโดยไม่มีเลขที่ใบกำกับของผู้ขาย',
  () => ctx.convertTradeDoc('purchaseOrder', po.no, { date: '2026-07-20' }), 'VENDOR_INVOICE_NO_REQUIRED');
const billFromPo = ctx.convertTradeDoc('purchaseOrder', po.no,
  { date: '2026-07-20', vendorNo: 'PO-TEST-0001', expenseSub: 'admin_expense' });
ok('ตั้งหนี้จากใบสั่งซื้อแล้วยอดตรงกัน', billFromPo.total === po.total, ctx.fmt(billFromPo.total));
ok('งบทดลองยังสมดุลหลังแปลงเอกสารทั้งชุด',
   ctx.trialBalance('2026-01-01', '2026-12-31').balanced);
ok('ตัวแปลงกลับค่าเงิน unM() ส่งเข้า M() แล้วได้ค่าเดิม',
   ctx.M(ctx.unM(ctx.M('12345.6789'))) === ctx.M('12345.6789'), ctx.unM(ctx.M('12345.6789')));

console.log('\n=== 7.7 อ่านไฟล์งบทดลองจากโปรแกรมอื่น ===');
/* หน้าตาไฟล์จริงที่โปรแกรมบัญชีส่งออกมา ไม่ใช่ตารางสะอาด ๆ ที่เราสมมุติเอง */
const LAYOUTS = [
  { name: 'หัวตารางสองบรรทัด สามคู่เดบิต/เครดิต (แบบ FlowAccount)',
    rows: [
      ['รายงานงบทดลอง'],
      ['บริษัท ทดสอบ จำกัด'],
      ['ตั้งแต่ 01/01/2569 ถึง 31/07/2569'],
      ['รหัสบัญชี', 'ชื่อบัญชี', 'ยอดยกมา', '', 'เคลื่อนไหวระหว่างงวด', '', 'ยอดคงเหลือ', ''],
      ['', '', 'เดบิต', 'เครดิต', 'เดบิต', 'เครดิต', 'เดบิต', 'เครดิต'],
      ['1113', 'เงินฝากธนาคาร', '1,000.00', '', '500.00', '', '1,500.00', ''],
      ['2121', 'เจ้าหนี้การค้า', '', '200.00', '', '300.00', '', '500.00'],
      ['รวม', '', '1,000.00', '200.00', '500.00', '300.00', '1,500.00', '500.00'],
    ], cols: 6 },
  { name: 'หัวรายงาน 6 บรรทัดก่อนถึงหัวตาราง',
    rows: [
      ['บริษัท ทดสอบ จำกัด'], ['งบทดลอง'], ['ณ 31 กรกฎาคม 2569'], ['หน่วย: บาท'],
      ['เลขที่บัญชี', 'ชื่อผังบัญชี', 'เดบิต', 'เครดิต'],
      ['1113', 'เงินฝากธนาคาร', '1500.00', ''],
      ['2121', 'เจ้าหนี้การค้า', '', '500.00'],
    ], cols: 2 },
  { name: 'หัวตารางภาษาอังกฤษ',
    rows: [
      ['Trial Balance'],
      ['Account Code', 'Account Name', 'Debit', 'Credit'],
      ['1113', 'Cash at bank', '1500.00', '0'],
      ['2121', 'Trade payable', '0', '500.00'],
    ], cols: 2 },
  { name: 'ยอดคงเหลือคอลัมน์เดียว ติดลบคือด้านเครดิต',
    rows: [
      ['รหัส', 'ชื่อบัญชี', 'ยอดคงเหลือ'],
      ['1113', 'เงินฝากธนาคาร', '1500.00'],
      ['2121', 'เจ้าหนี้การค้า', '(500.00)'],
    ], cols: 2 },
];
LAYOUTS.forEach(function (L) {
  const rows = L.rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  const det = ctx.detectColumns(rows);
  const tb = det.ok ? ctx.readTrialBalance(rows, det.map, det.headerRow) : { rows: [] };
  const dr = tb.rows.reduce((a, r) => a + r.debit, 0);
  const cr = tb.rows.reduce((a, r) => a + r.credit, 0);
  ok('★ อ่านได้: ' + L.name,
     det.ok && tb.rows.length === 2 && dr === ctx.M('1500') && cr === ctx.M('500'),
     det.ok ? 'หัวแถวที่ ' + (det.headerRow + 1) + ' · เดบิต ' + ctx.fmt(dr) + ' เครดิต ' + ctx.fmt(cr)
            : 'เดาหัวตารางไม่ได้');
});
/* คู่เดบิต/เครดิตมีสามคู่ ต้องหยิบคู่ยอดคงเหลือ ไม่ใช่คู่ยอดยกมา */
const three = LAYOUTS[0].rows.filter((r) => r.some((x) => String(x).trim() !== ''));
const detThree = ctx.detectColumns(three);
ok('★ เลือกคู่ยอดคงเหลือปลายงวด ไม่ใช่คู่ยอดยกมา',
   detThree.map.debit === 6 && detThree.map.credit === 7,
   'เดบิตคอลัมน์ที่ ' + (detThree.map.debit + 1) + ' เครดิตคอลัมน์ที่ ' + (detThree.map.credit + 1));
ok('บรรทัดผลรวมถูกข้าม ไม่ถูกนับเป็นบัญชี',
   ctx.readTrialBalance(three, detThree.map, detThree.headerRow).skipped
     .some((x) => x.why.indexOf('ผลรวม') >= 0));
/* ไฟล์ที่ไม่มีหัวตารางเลย ต้องไม่ระเบิด แต่บอกว่าเดาไม่ได้ เพื่อให้หน้าจอพาไปจับคู่เอง */
const noHead = ctx.detectColumns([['อะไรก็ไม่รู้'], ['1', '2', '3']]);
ok('ไฟล์ที่เดาหัวตารางไม่ได้ คืนค่าให้ไปจับคู่ด้วยมือ ไม่โยนข้อผิดพลาด',
   noHead.ok === false && typeof noHead.headerRow === 'number' && noHead.map !== null);
ok('ตัวเลขในวงเล็บอ่านเป็นค่าติดลบ', ctx.parseAmount('(1,234.50)') === '-1234.50');
ok('ขีดกลางอ่านเป็นศูนย์', ctx.parseAmount('-') === '0' && ctx.parseAmount('—') === '0');
ok('ข้อความที่ไม่ใช่ตัวเลขอ่านไม่ออก ต้องบอกว่าอ่านไม่ออก ไม่ใช่เดาเป็นศูนย์',
   ctx.parseAmount('ยกมา') === null);

console.log('\n=== 7.8 งบทดลองหน้าตาแบบ FlowAccount ของจริง ===');
/* โครงเดียวกับไฟล์ที่ผู้ใช้ส่งมา: หัวรายงาน 4 บรรทัด · หัวตารางกินสองบรรทัด ·
   สามคู่เดบิต–เครดิต (ยกมา / ประจำงวด / สะสม) · มีคอลัมน์ว่างคั่น ·
   หัวคอลัมน์รหัสเขียนว่า "บัญชี" เฉย ๆ · ช่องชื่อบัญชีไม่มีหัวคอลัมน์ ·
   บรรทัดผลรวมเขียนคำว่า "รวมทั้งสิ้น" ไว้ในช่องชื่อ ไม่ใช่ช่องรหัส ·
   ตัวเลขบางตัวเป็นรูปยกกำลังแบบที่ Excel เขียนออกมา  ตัวเลขสมมุติทั้งหมด */
const FA_TB = [
  ['บริษัท ตัวอย่าง จำกัด'],
  ['งบทดลอง'],
  ['สิ้นสุด ณ วันที่ 31 ธันวาคม 2569'],
  ['หน่วย:บาท'],
  ['', '', '', 'ยอดยกมา', '', '', 'ยอดประจำงวด', '', '', 'ยอดสะสม', '', '', 'รวมทั้งสิ้น'],
  ['บัญชี', '', '', 'เดบิต', 'เครดิต', '', 'เดบิต', 'เครดิต', '', 'เดบิต', 'เครดิต', '', ''],
  ['11122.01', 'กสิกรไทย 0762769492', '', '9739.93', '', '', '1765701.95', '1774292.75',
   '', '1149.1300000000001', '', '', '1149.1300000000001'],
  ['11511', 'สินค้าสำเร็จรูปคงเหลือ', '', '230777.7', '', '', '24561.2', '186671.9',
   '', '68667', '', '', '68667'],
  ['17140', 'ลูกหนี้สรรพากร', '', '', '', '', '11261.63', '11261.56',
   '', '7.0000000000000007E-2', '', '', '0.07'],
  ['21311', 'เจ้าหนี้การค้า - ทั่วไป', '', '', '80000', '', '14160', '',
   '', '', '65840', '', '-65840'],
  ['34998', 'กำไร (ขาดทุน) สะสม - รายงาน', '', '', '160517.63', '', '156401.37', '',
   '', '', '4116.26', '', '-4116.26'],
  ['41110', 'รายได้จากการขายสินค้า', '', '', '', '', '', '260000',
   '', '', '260000', '', '-260000'],
  ['51140', 'ต้นทุนขายสินค้า', '', '', '', '', '260140.06', '',
   '', '260140.06', '', '', '260140.06'],
  ['', 'รวมทั้งสิ้น', '', '240517.63', '240517.63', '', '2232226.21', '2232226.21',
   '', '329956.26', '329956.26', '', '0'],
];
const faRows = FA_TB.filter((r) => r.some((x) => String(x).trim() !== ''));
const faDet = ctx.detectColumns(faRows);
ok('★ หาหัวตารางเจอแม้หัวคอลัมน์รหัสเขียนแค่ว่า "บัญชี"',
   faDet.ok && faDet.map.code === 0, 'หัวแถวที่ ' + (faDet.headerRow + 1) + ' · ' + JSON.stringify(faDet.map));
ok('★ ช่องชื่อบัญชีที่ไม่มีหัวคอลัมน์ ระบบเดาให้จากข้อมูลข้างใต้', faDet.map.name === 1);
ok('★ หยิบคู่ "ยอดสะสม" ไม่ใช่คู่ยอดยกมาหรือคู่ประจำงวด',
   faDet.map.debit === 9 && faDet.map.credit === 10,
   'เดบิตคอลัมน์ที่ ' + (faDet.map.debit + 1) + ' เครดิตคอลัมน์ที่ ' + (faDet.map.credit + 1));
ok('ไฟล์นี้ถูกจัดว่าเป็นงบทดลอง', ctx.detectFileKind(faRows, faDet.map, faDet.headerRow) === 'trialBalance');
const faTb = ctx.readTrialBalance(faRows, faDet.map, faDet.headerRow);
const faDr = faTb.rows.reduce((a, r) => a + r.debit, 0);
const faCr = faTb.rows.reduce((a, r) => a + r.credit, 0);
ok('★ ตัวเลขรูปยกกำลังที่ Excel เขียนออกมา อ่านเป็นตัวเลขได้ ไม่ถูกทิ้ง',
   ctx.parseAmount('7.0000000000000007E-2') !== null
   && ctx.M(ctx.parseAmount('7.0000000000000007E-2')) === ctx.M('0.07'));
ok('★ งบทดลองสมดุลพอดีหลังอ่านครบทุกบรรทัด', faDr === faCr, ctx.fmt(faDr) + ' = ' + ctx.fmt(faCr));
ok('บรรทัดผลรวมที่เขียนคำว่ารวมไว้ในช่องชื่อ ถูกข้าม ไม่ถูกนับเป็นบัญชี',
   faTb.rows.length === 7 && faTb.skipped.some((x) => x.why.indexOf('ผลรวม') >= 0),
   faTb.rows.length + ' บัญชี');

console.log('\n=== 7.10 เพิ่มและแก้ไขทะเบียนด้วยมือ ===');
/* ผู้ทำบัญชีเจอผู้ขายรายใหม่ระหว่างทำงาน ต้องเพิ่มเองได้ทันที
   ไม่ใช่รอให้มาจากการนำเข้าอย่างเดียว */
const vendBefore = D.partners.filter((p) => p.kind === 'vendor').length;
const newVend = ctx.savePartner({ kind:'vendor', name:'บริษัท ฟันสะอาด จำกัด',
  taxId:'0105536000003', branch:'00000', address:'1 ถนนทดสอบ กรุงเทพมหานคร 10110', termDays:30,
  whtCode:'WHT_SERVICE' });
ok('★ เพิ่มผู้ขายรายใหม่ได้เอง ระบบตั้งรหัสให้อัตโนมัติ',
   newVend.created && /^VEN-\d{4}$/.test(newVend.partner.code)
   && D.partners.filter((p) => p.kind === 'vendor').length === vendBefore + 1,
   newVend.partner.code + ' ' + newVend.partner.name);
ok('ผู้ขายที่เพิ่มเองใช้ตั้งหนี้ได้ทันที', (function () {
  const b = ctx.recordBill({ date:'2026-07-20', partnerCode:newVend.partner.code,
    vendorNo:'TP-TEST-001',
    lines:[{ desc:'ยาสีฟันสำหรับพนักงาน', qty:10, price:'120', expenseSub:'admin_expense' }] });
  return b.total === ctx.M('1284');
})(), 'รวมภาษี 1,284.00');
throws('เลขผู้เสียภาษีผิดหลักที่ 13 ตอนเพิ่มคู่ค้า',
  () => ctx.savePartner({ kind:'vendor', name:'ผิด', taxId:'1234567890123' }), 'TAX_ID_INVALID');
throws('★ เพิ่มคู่ค้าซ้ำด้วยเลขผู้เสียภาษีเดิม',
  () => ctx.savePartner({ kind:'vendor', name:'บริษัท ฟันสะอาด จำกัด (ซ้ำ)', taxId:'0105536000003' }),
  'PARTNER_DUPLICATE_TAX_ID');
throws('ไม่กรอกชื่อคู่ค้า',
  () => ctx.savePartner({ kind:'customer', name:'  ' }), 'PARTNER_NAME_REQUIRED');
throws('รหัสสาขาไม่ใช่ตัวเลข 5 หลัก',
  () => ctx.savePartner({ kind:'customer', name:'ทดสอบ', branch:'1' }), 'BRANCH_INVALID');
ok('คู่ค้าที่ไม่มีเลขผู้เสียภาษียังเพิ่มได้ ไว้มาเติมทีหลัง',
   ctx.savePartner({ kind:'customer', name:'ร้านค้าปลีกไม่มีเลขภาษี' }).created);
const edited = ctx.savePartner({ code:newVend.partner.code, kind:'vendor',
  name:'บริษัท ฟันสะอาด จำกัด (มหาชน)', taxId:'0105536000003', termDays:45 });
ok('แก้ไขคู่ค้าเดิมได้โดยไม่สร้างซ้ำ',
   !edited.created && edited.partner.termDays === 45
   && D.partners.filter((p) => p.taxId === '0105536000003').length === 1);

const newItem = ctx.saveItem({ name:'ยาสีฟันสมุนไพร 160 กรัม', type:'stock', uom:'หลอด', price:'89' });
ok('เพิ่มสินค้าได้ และเริ่มต้นด้วยคงเหลือศูนย์',
   newItem.created && newItem.item.qty === 0 && newItem.item.price === ctx.M('89'), newItem.item.code);
ok('เพิ่มบริการได้ ไม่แตะสต๊อก',
   ctx.saveItem({ name:'ค่าบริการติดตั้ง', type:'service' }).item.type === 'service');
const stocked = D.items.find((i) => i.type === 'stock' && i.qty > 0);
throws('★ เปลี่ยนสินค้าที่ยังมีของในสต๊อกให้เป็นบริการ',
  () => ctx.saveItem({ code:stocked.code, name:stocked.name, type:'service' }), 'ITEM_STILL_IN_STOCK');

const emp = ctx.saveEmployee({ name:'นางสาวทดสอบ ระบบ', dept:'บัญชี', salary:'28000',
  nationalId:'0105536000003', pvdRate:5, hired:'2026-07-01' });
ok('เพิ่มพนักงานได้ พร้อมทำเงินเดือนงวดถัดไป',
   emp.created && /^EMP-\d{4}$/.test(emp.employee.code), emp.employee.code);
throws('เลขประจำตัวประชาชนผิดหลักที่ 13',
  () => ctx.saveEmployee({ name:'ผิด', nationalId:'1111111111111' }), 'NATIONAL_ID_INVALID');
throws('อัตรากองทุนสำรองเลี้ยงชีพเกิน 15%',
  () => ctx.saveEmployee({ name:'ทดสอบ', pvdRate:20 }), 'PVD_RATE_RANGE');

const asset = ctx.saveAsset({ name:'ชั้นวางสินค้า', class:'FURNITURE', inService:'2026-07-01',
  cost:'80000', bookYears:5 });
ok('เพิ่มทรัพย์สินได้ พร้อมคิดค่าเสื่อมงวดถัดไป',
   asset.created && asset.asset.accumBook === 0, asset.asset.code);
throws('ประเภททรัพย์สินนอกพระราชกฤษฎีกา 145',
  () => ctx.saveAsset({ name:'x', class:'SPACESHIP', inService:'2026-07-01', cost:'1', bookYears:5 }),
  'ASSET_CLASS_INVALID');
throws('ค่าเสื่อมสะสมยกมาเกินราคาทุน',
  () => ctx.saveAsset({ name:'x', class:'OFFICE', inService:'2026-07-01', cost:'1000',
    bookYears:5, accumBook:'2000' }), 'ACCUM_EXCEEDS_COST');
const oldAsset = D.assets.find((a) => D.docs.depreciation.some((d) => d.rows.some((r) => r.code === a.code)));
throws('★ แก้ราคาทุนของทรัพย์สินที่คิดค่าเสื่อมไปแล้ว',
  () => ctx.saveAsset({ code:oldAsset.code, name:oldAsset.name, class:oldAsset.class,
    inService:oldAsset.inService, cost:'1', bookYears:oldAsset.bookYears }),
  'ASSET_ALREADY_DEPRECIATED');
ok('แต่แก้ชื่อทรัพย์สินเดิมได้ ไม่กระทบค่าเสื่อมที่ลงไปแล้ว',
   !ctx.saveAsset({ code:oldAsset.code, name:oldAsset.name + ' (แก้ชื่อ)', class:oldAsset.class,
     inService:oldAsset.inService, cost:ctx.unM(oldAsset.cost), bookYears:oldAsset.bookYears,
     accumBook:ctx.unM(oldAsset.accumBook), accumTax:ctx.unM(oldAsset.accumTax) }).created);
ok('งบทดลองยังสมดุลหลังเพิ่มทะเบียนทั้งหมด',
   ctx.trialBalance('2026-01-01', '2026-12-31').balanced);

console.log('\n=== 7.11 เอกสารชุดใหม่ที่ฝ่ายบัญชีขอ ===');
{
  const J = '2026-07-30';
  const tbOk = () => ctx.trialBalance('2026-01-01', '2026-12-31').balanced;
  const recOk = () => ctx.reconciliationChecks('2026-07-31').allPassed;

  /* --- ใบวางบิล --- */
  const live = (b) => ['issued', 'partially_paid'].indexOf(ctx.billingNoteStatus(b)) >= 0;
  const taken = new Set();
  D.docs.billingNote.filter(live).forEach((b) => b.invoices.forEach((i) => taken.add(i.no)));
  const openInv = D.docs.invoice.filter((d) => d.status !== 'void' && ctx.invOutstanding(d) > 0
    && !taken.has(d.no) && d.date <= J && d.date >= '2026-07-01');
  const cust = openInv[0].partnerCode;
  const mine = openInv.filter((d) => d.partnerCode === cust).map((d) => d.no);
  const other = openInv.find((d) => d.partnerCode !== cust);
  const entriesBefore = D.entries.length;
  throws('ใบวางบิลออกให้ผู้ขายไม่ได้',
    () => ctx.issueBillingNote({ partnerCode:'VEN-0001', date:J, invoiceNos:mine }), 'PARTNER_WRONG_SIDE');
  throws('ใบวางบิลต้องมีใบกำกับอย่างน้อย 1 ใบ',
    () => ctx.issueBillingNote({ partnerCode:cust, date:J, invoiceNos:[] }), 'BILLING_NO_INVOICE');
  if (other) {
    throws('รวมใบกำกับของลูกค้าคนละรายในใบวางบิลเดียวไม่ได้',
      () => ctx.issueBillingNote({ partnerCode:cust, date:J, invoiceNos:mine.concat([other.no]) }), 'BILLING_PARTNER_MISMATCH');
  }
  throws('วันนัดชำระก่อนวันวางบิลไม่ได้',
    () => ctx.issueBillingNote({ partnerCode:cust, date:J, dueDate:'2026-07-01', invoiceNos:mine }), 'BILLING_DUE_BEFORE_DATE');
  const bn = ctx.issueBillingNote({ partnerCode:cust, date:J, dueDate:'2026-08-05', invoiceNos:mine });
  ok('ออกใบวางบิลได้ ยอดเท่ากับคงค้างของใบกำกับรวมกัน',
    bn.total === mine.reduce((s, no) => s + ctx.invOutstanding(D.docs.invoice.find((d) => d.no === no)), 0),
    bn.no + ' · ' + mine.length + ' ใบ · ' + ctx.fmt(bn.total));
  ok('★ ใบวางบิลไม่สร้างรายการบัญชี', D.entries.length === entriesBefore);
  throws('ใบกำกับที่อยู่ในใบวางบิลที่ยังเปิดอยู่ วางซ้ำไม่ได้',
    () => ctx.issueBillingNote({ partnerCode:cust, date:J, invoiceNos:[mine[0]] }), 'BILLING_INVOICE_TAKEN');

  /* ★ ใบกำกับใบสุดท้ายลงบัญชีไม่ได้ ใบก่อนหน้าที่ออกใบเสร็จไปแล้วต้องถูกยกเลิกตามทั้งหมด
     ทำให้ใบสุดท้ายพังด้วยการถอดรหัสลูกค้าออก — บัญชีลูกหนี้จะไม่ยอมลงรายการที่ไม่มีลูกหนี้ */
  const rcBefore = D.docs.receipt.length, jeBefore = D.entries.length;
  const seqBefore = JSON.stringify(D.seq);
  const lastNo = mine[mine.length - 1];
  D.docs.invoice.find((d) => d.no === lastNo).partnerCode = null;
  throws('ใบกำกับใบหนึ่งลงบัญชีไม่ได้ รับชำระทั้งใบวางบิลจึงล้ม',
    () => ctx.receiveBillingNote(bn.no, { date:J, method:'cheque' }), 'PARTNER_REQUIRED');
  ok('★ ล้มกลางทางแล้วไม่มีใบเสร็จ ใบสำคัญ หรือเลขที่เอกสารค้างแม้แต่ใบเดียว',
    mine.length > 1 && D.docs.receipt.length === rcBefore && D.entries.length === jeBefore
    && JSON.stringify(D.seq) === seqBefore
    && ctx.billingNoteStatus(D.docs.billingNote.find((b) => b.no === bn.no)) === 'issued');
  D.docs.invoice.find((d) => d.no === lastNo).partnerCode = cust;
  const made = ctx.receiveBillingNote(bn.no, { date:J, method:'cheque' });
  ok('★ รับชำระตามใบวางบิล ออกใบเสร็จครบทุกใบกำกับในคราวเดียว',
    made.length === mine.length && ctx.billingNoteStatus(D.docs.billingNote.find((b) => b.no === bn.no)) === 'paid',
    made.map((r) => r.no).join(', '));
  throws('ใบวางบิลที่เก็บเงินครบแล้วยกเลิกไม่ได้', () => ctx.cancelBillingNote(bn.no, 'ทดสอบ'), 'BILLING_ALREADY_PAID');

  /* --- ใบรับสินค้า → ตั้งหนี้ --- */
  const it = D.items.find((i) => i.code === 'WR-25');
  const qty0 = it.qty, val0 = it.value;
  const grni0 = -ctx.balBySub(['grni'], '2026-12-31');
  throws('ใบรับสินค้าใช้กับสินค้าที่มีสต๊อกเท่านั้น',
    () => ctx.issueGoodsReceipt({ partnerCode:'VEN-0004', date:J,
      lines:[{ desc:'ค่าบริการขนส่ง', qty:1, price:'500' }] }), 'GRN_NOT_STOCK');
  const g = ctx.issueGoodsReceipt({ partnerCode:'VEN-0004', date:'2026-07-20', vendorDoNo:'DO-T-1',
    lines:[{ itemCode:'WR-25', desc:it.name, qty:50, price:'2400' }] });
  ok('★ รับสินค้า: สต๊อกเพิ่ม และพักรับสินค้าเพิ่มเท่ามูลค่าที่รับ',
    it.qty === qty0 + 50 && it.value === val0 + g.total
    && -ctx.balBySub(['grni'], '2026-12-31') === grni0 + g.total, g.no + ' ' + ctx.fmt(g.total));
  ok('ยอดพักรับสินค้าตรงกับใบรับสินค้าที่รอตั้งหนี้', recOk());
  D.periods.find((p) => p.code === '2026-05').status = 'closed';
  const grSeq = D.seq['goodsReceipt|2026-05'];
  throws('ใบรับสินค้าลงวันที่ในงวดที่ปิดแล้วไม่ได้',
    () => ctx.issueGoodsReceipt({ partnerCode:'VEN-0004', date:'2026-05-20',
      lines:[{ itemCode:'WR-25', qty:1, price:'2400' }] }), 'PERIOD_CLOSED');
  ok('ถูกปฏิเสธก่อนจองเลขที่ ทะเบียนจึงไม่มีเลขขาดช่วง', D.seq['goodsReceipt|2026-05'] === grSeq);
  D.periods.find((p) => p.code === '2026-05').status = 'open';
  throws('ตั้งหนี้ลงวันที่ก่อนรับของไม่ได้',
    () => ctx.billGoodsReceipt(g.no, { date:'2026-07-19', vendorNo:'TPS-T-1' }), 'GRN_BILL_BEFORE_RECEIPT');
  const vat0 = D.taxTx.filter((t) => t.kind === 'vat_input').length;
  const b = ctx.billGoodsReceipt(g.no, { date:'2026-07-25', vendorNo:'TPS-T-1' });
  ok('★ ตั้งหนี้จากใบรับสินค้า: ไม่เพิ่มสต๊อกซ้ำ และล้างพักรับสินค้าออกพอดี',
    it.qty === qty0 + 50 && -ctx.balBySub(['grni'], '2026-12-31') === grni0 && b.grnNo === g.no,
    b.no + ' รวม ' + ctx.fmt(b.total));
  ok('ภาษีซื้อเกิดตอนตั้งหนี้ ไม่ใช่ตอนรับของ',
    D.taxTx.filter((t) => t.kind === 'vat_input').length === vat0 + 1 && b.vat > 0);
  throws('ใบรับสินค้าเดิมตั้งหนี้ซ้ำไม่ได้',
    () => ctx.billGoodsReceipt(g.no, { date:'2026-07-25', vendorNo:'TPS-T-2' }), 'GRN_ALREADY_BILLED');
  const poSvc = ctx.issueTradeDoc('purchaseOrder', { partnerCode:'VEN-0004', date:J,
    lines:[{ desc:'ค่าติดตั้ง', qty:1, price:'3000' }] });
  throws('ใบสั่งซื้อที่มีค่าบริการรับเข้าคลังไม่ได้',
    () => ctx.receiveGoodsFromPo(poSvc.no, { date:J }), 'GRN_PO_HAS_NON_STOCK');
  const poStock = ctx.issueTradeDoc('purchaseOrder', { partnerCode:'VEN-0004', date:J,
    lines:[{ desc:it.name, qty:10, price:'2400', itemCode:'WR-25' }] });
  const g2 = ctx.receiveGoodsFromPo(poStock.no, { date:J });
  ok('รับสินค้าตามใบสั่งซื้อ ใบสั่งซื้อปิดและชี้ไปที่ใบรับสินค้า',
    poStock.status === 'closed' && poStock.convertedTo === g2.no && g2.poNo === poStock.no);

  /* --- ค่าใช้จ่าย + หัก ณ ที่จ่าย --- */
  const cert0 = D.docs.whtCert.length;
  const ex = ctx.recordExpense({ partnerCode:'VEN-0012', date:J, taxInvoiceNo:'TNP-T-0001',
    lines:[{ desc:'ค่าซ่อมแซมห้องประชุม', qty:1, price:'25000', acc:'5325' }],
    whtCode:'WHT_SERVICE', channel:'manual' });
  const cert = D.docs.whtCert.find((c) => c.no === ex.certNo);
  ok('ค่าใช้จ่าย 25,000 + VAT หัก 3% = 750 จ่ายสุทธิ 26,000',
    ex.base === ctx.M('25000') && ex.vat === ctx.M('1750') && ex.wht === ctx.M('750') && ex.net === ctx.M('26000'));
  ok('★ หัก ณ ที่จ่ายในค่าใช้จ่าย → ออกหนังสือรับรอง 50 ทวิ ให้อัตโนมัติ และผูกเลขที่กัน',
    D.docs.whtCert.length === cert0 + 1 && cert && cert.expenseNo === ex.no && cert.wht === ex.wht
    && cert.base === ex.base && cert.form === 'ภ.ง.ด.53', ex.no + ' → ' + ex.certNo);
  ok('ภาษีที่หักเข้าแบบ ภ.ง.ด.53 ของงวดนั้น',
    D.taxTx.some((t) => t.kind === 'wht' && t.docNo === ex.no && t.form === 'PND53' && t.channel === 'manual' && t.tax === ex.wht));
  const je = D.entries.find((e) => e.no === ex.entryNo);
  ok('ค่าใช้จ่ายลงสมุดรายวันจ่าย', ctx.journalOf(je) === 'payment' && je.lines.some((l) => l.acc === '5325'));
  const ew = ctx.recordExpense({ partnerCode:'VEN-0012', date:J, taxInvoiceNo:'TNP-T-0002',
    lines:[{ desc:'ค่าซ่อมแซมหลังคา', qty:1, price:'40000', acc:'5325' }],
    whtCode:'WHT_SERVICE', channel:'e_wht' });
  ok('นำส่งผ่าน e-Withholding Tax ไม่ออก 50 ทวิ ซ้ำ และใช้อัตรา 1%', ew.certNo === null && ew.whtRate === '1');
  throws('มีภาษีซื้อที่จะขอคืนแต่ไม่มีเลขใบกำกับ',
    () => ctx.recordExpense({ partnerCode:'VEN-0025', date:J,
      lines:[{ desc:'วัสดุสำนักงาน', qty:1, price:'2000', acc:'5324' }] }), 'TAX_INVOICE_NO_REQUIRED');
  throws('เลขใบกำกับซ้ำกับที่ตั้งหนี้ไว้แล้ว',
    () => ctx.recordExpense({ partnerCode:'VEN-0004', date:J, taxInvoiceNo:'TPS-T-1',
      lines:[{ desc:'ซ้ำ', qty:1, price:'2000', acc:'5324' }] }), 'DUPLICATE_VENDOR_INVOICE');
  throws('ลงบัญชีคุมเป็นค่าใช้จ่ายไม่ได้',
    () => ctx.recordExpense({ partnerCode:'VEN-0025', date:J, taxInvoiceNo:'X-1',
      lines:[{ desc:'ผิดบัญชี', qty:1, price:'2000', acc:'1131' }] }), 'EXPENSE_ACCOUNT_INVALID');
  throws('ออก 50 ทวิ ยอดต่ำกว่า 1,000 บาทไม่ได้ (ไม่ต้องหัก)',
    () => ctx.recordExpense({ partnerCode:'VEN-0012', date:J, requireWht:true, whtCode:'WHT_SERVICE',
      lines:[{ desc:'ค่าบริการเล็กน้อย', qty:1, price:'800', acc:'5325', taxCode:'EXEMPT' }] }), 'WHT_BELOW_THRESHOLD');
  throws('ออก 50 ทวิ ต้องเลือกประเภทเงินได้',
    () => ctx.recordExpense({ partnerCode:'VEN-0012', date:J, requireWht:true,
      lines:[{ desc:'ค่าบริการ', qty:1, price:'5000', acc:'5325', taxCode:'EXEMPT' }] }), 'WHT_REQUIRED');

  /* --- เตรียมจ่ายเงิน --- */
  const inBatch = new Set();
  D.docs.paymentBatch.filter((x) => x.status === 'pending_approval' || x.status === 'approved')
    .forEach((x) => x.items.forEach((i) => inBatch.add(i.billNo)));
  const pick = D.docs.bill.filter((x) => ctx.billOutstanding(x) > 0 && !inBatch.has(x.no) && !x.broughtForward)
    .sort((a, c) => (a.whtCode ? -1 : 0) - (c.whtCode ? -1 : 0)).slice(0, 3).map((x) => x.no);
  const pb = ctx.createPaymentBatch({ date:J, payDate:'2026-07-31', billNos:pick });
  ok('จัดทำใบเตรียมจ่ายได้ สถานะรออนุมัติ', pb.status === 'pending_approval' && pb.items.length === pick.length,
    pb.no + ' · ' + pick.length + ' ราย · สุทธิ ' + ctx.fmt(pb.net));
  throws('รายการตั้งหนี้เดียวกันอยู่ในใบเตรียมจ่ายสองใบไม่ได้',
    () => ctx.createPaymentBatch({ date:J, billNos:[pick[0]] }), 'PAYMENT_BATCH_TAKEN');
  throws('ยังไม่อนุมัติ จ่ายไม่ได้', () => ctx.payPaymentBatch(pb.no, {}), 'PAYMENT_BATCH_NOT_APPROVED');
  ctx.approvePaymentBatch(pb.no);
  const pv0 = D.docs.payment.length, cert1 = D.docs.whtCert.length;
  const lastBill = pick[pick.length - 1];
  const lastVendor = D.docs.bill.find((x) => x.no === lastBill).partnerCode;
  D.docs.bill.find((x) => x.no === lastBill).partnerCode = 'VEN-ไม่มีจริง';
  throws('ผู้ขายรายสุดท้ายจ่ายไม่ได้ จ่ายทั้งใบเตรียมจ่ายจึงล้ม', () => ctx.payPaymentBatch(pb.no, {}), 'PARTNER_NOT_FOUND');
  ok('★ จ่ายล้มกลางทาง ไม่มีใบสำคัญจ่ายหรือ 50 ทวิ ค้างแม้แต่ใบเดียว',
    pick.length > 1 && D.docs.payment.length === pv0 && D.docs.whtCert.length === cert1
    && D.docs.paymentBatch.find((x) => x.no === pb.no).status === 'approved');
  D.docs.bill.find((x) => x.no === lastBill).partnerCode = lastVendor;
  const pvs = ctx.payPaymentBatch(pb.no, {});
  const pbNow = D.docs.paymentBatch.find((x) => x.no === pb.no);
  ok('★ จ่ายตามใบเตรียมจ่าย: ใบสำคัญจ่ายครบทุกราย หนี้ปิด',
    pvs.length === pick.length && pbNow.status === 'paid'
    && pick.every((no) => ctx.billOutstanding(D.docs.bill.find((x) => x.no === no)) === 0));
  ok('ภาษีหัก ณ ที่จ่ายที่ประมาณไว้ตอนจัดทำ ตรงกับที่หักจริงตอนจ่าย',
    pvs.reduce((s, p) => s + p.wht, 0) === pb.wht, ctx.fmt(pb.wht));
  throws('ใบเตรียมจ่ายที่จ่ายแล้วจ่ายซ้ำไม่ได้', () => ctx.payPaymentBatch(pb.no, {}), 'PAYMENT_BATCH_CLOSED');

  /* --- สมุดรายวัน 5 เล่ม --- */
  throws('บัญชีคุมลงด้วยมือไม่ได้',
    () => ctx.postJournalVoucher({ book:'general', date:J, desc:'ทดสอบ',
      lines:[{ acc:'2141', dr:'100' }, { acc:'4111', cr:'100' }] }), 'CONTROL_ACCOUNT_MANUAL');
  throws('สมุดรายวันรับต้องมีเงินเข้า',
    () => ctx.postJournalVoucher({ book:'receipt', date:J, desc:'ทดสอบ',
      lines:[{ acc:'1143', dr:'100' }, { acc:'4260', cr:'100' }] }), 'JOURNAL_RECEIPT_NEEDS_CASH');
  throws('สมุดรายวันทั่วไปไม่รับรายการที่มีเงินเข้าออก',
    () => ctx.postJournalVoucher({ book:'general', date:J, desc:'ทดสอบ',
      lines:[{ acc:'1113', dr:'100' }, { acc:'4260', cr:'100' }] }), 'JOURNAL_GENERAL_HAS_CASH');
  throws('สมุดรายวันขายรับเฉพาะขายเชื่อ',
    () => ctx.postJournalVoucher({ book:'sales', date:J, desc:'ทดสอบ',
      lines:[{ acc:'1111', dr:'100' }, { acc:'4111', cr:'100' }] }), 'JOURNAL_CREDIT_ONLY');
  throws('ไม่มีคำอธิบายรายการไม่ได้',
    () => ctx.postJournalVoucher({ book:'general', date:J, desc:' ',
      lines:[{ acc:'5325', dr:'100' }, { acc:'2131', cr:'100' }] }), 'DESC_REQUIRED');
  const tr = ctx.postJournalVoucher({ book:'general', date:J, desc:'โอนเงินระหว่างบัญชีธนาคารของบริษัท',
    lines:[{ acc:'1114', dr:'50000' }, { acc:'1113', cr:'50000' }] });
  ok('โอนเงินระหว่างบัญชีของบริษัทเองลงเล่มทั่วไปได้', tr.type === 'general' && tr.no.indexOf('JV') === 0, tr.no);
  const pj = ctx.postJournalVoucher({ book:'purchase', date:J, desc:'ตั้งค่าไฟฟ้าค้างจ่ายเดือนกรกฎาคม', ref:'MEA-6907',
    lines:[{ acc:'5322', dr:'18500' }, { acc:'2131', cr:'18500' }] });
  ok('ตั้งค้างจ่ายลงสมุดรายวันซื้อ พร้อมเลขอ้างอิง', ctx.journalOf(pj) === 'purchase' && pj.srcId === 'MEA-6907' && pj.src === 'manual', pj.no);
  const pyv = ctx.postJournalVoucher({ book:'payment', date:J, desc:'ค่าธรรมเนียมโอนเงินต่างประเทศ',
    lines:[{ acc:'5410', dr:'350' }, { acc:'1113', cr:'350' }] });
  ok('ใบสำคัญจ่ายลงสมุดรายวันจ่าย', ctx.journalOf(pyv) === 'payment', pyv.no);
  ok('ใบสำคัญประเภทอื่น (ปรับปรุง ค่าเสื่อม เงินเดือน) อยู่ในเล่มทั่วไป',
    ['adjustment', 'payroll', 'asset', 'inventory', 'opening'].every((t) => ctx.journalOf({ type:t }) === 'general'));

  ok('★ งบทดลองสมดุลหลังใช้เอกสารใหม่ครบทุกแบบ', tbOk());
  ok('★ ยอดคุมทุกตัวยังตรง (ลูกหนี้ เจ้าหนี้ พักรับสินค้า ภาษีซื้อ ภาษีขาย)', recOk(),
    ctx.reconciliationChecks('2026-07-31').checks.filter((c) => !c.ok).map((c) => c.label).join(', '));
}

console.log('\n=== 8. ปิดงวด ===');
const chk = ctx.closeChecklist('2026-06');
ok('รายการตรวจสอบก่อนปิดงวดครบ', chk.items.length >= 9, chk.items.length + ' ข้อ');
ok('งวด มิ.ย. 2569 ปิดได้', chk.canClose,
   chk.canClose ? '' : 'ติด: ' + chk.items.filter((i)=>i.blocking&&!i.ok).map((i)=>i.label).join(', '));
if (chk.canClose) {
  ctx.closePeriod('2026-06');
  throws('ลงรายการในงวดที่ปิดแล้ว', () => ctx.post({ type:'general', date:'2026-06-15', desc:'ทดสอบ',
    lines:[{acc:'1113',dr:ctx.M('100')},{acc:'4111',cr:ctx.M('100')}] }), 'PERIOD_CLOSED');
}

/* ★ ส่วนนี้ล้างข้อมูลตัวอย่างทิ้งเพื่อสร้างบริษัทเปล่า จึงต้องอยู่ท้ายสุดเสมอ
   ถ้าย้ายขึ้นไปข้างบน ชุดทดสอบที่เหลือจะรันบนบริษัทเปล่าแล้วผลเพี้ยน */
console.log('\n=== 9. สร้างบัญชีตามผังเดิมแทนการจับคู่ทีละบรรทัด ===');
ok('รหัสผังกรมพัฒน์ 1112x = เงินฝากธนาคาร', ctx.inferSubType('11122.01') === 'bank');
ok('รหัส 1131x = ลูกหนี้การค้า', ctx.inferSubType('11310') === 'trade_receivable');
ok('รหัส 21310 = เจ้าหนี้การค้า', ctx.inferSubType('21311') === 'trade_payable');
ok('รหัส 27110 = ภาษีขาย', ctx.inferSubType('27111') === 'output_vat');
ok('รหัส 411xx = รายได้จากการขาย', ctx.inferSubType('41110-01') === 'sales_revenue');
ok('รหัส 586xx = ค่าเสื่อมราคา', ctx.inferSubType('58611') === 'depreciation');
ok('รหัสที่ไม่มีในตาราง ใช้หลักแรกตัดสินหมวด', ctx.inferSubType('19291') === 'other_current_asset');
/* subType ทุกตัวที่ตารางนี้ชี้ไป ต้องมีที่อยู่ในงบการเงินจริง ๆ
   ถ้าหลุดไปตัวหนึ่ง บัญชีนั้นจะหายจากงบแล้วงบไม่สมดุลโดยไม่มีอะไรเตือน */
const fsSubs = new Set();
ctx.BS_LINES.concat(ctx.PL_LINES).forEach((L) => (L.sub || []).forEach((x) => fsSubs.add(x)));
const orphan = [...new Set(ctx.DBD_SUBTYPE.map((p) => p[1]))].filter((x) => !fsSubs.has(x));
ok('★ ทุกปลายทางในตารางผังกรมพัฒน์มีบรรทัดรองรับในงบการเงิน', orphan.length === 0, orphan.join(', '));
const noType = [...new Set(ctx.DBD_SUBTYPE.map((p) => p[1]))].filter((x) => !ctx.subTypeType(x));
ok('ทุกปลายทางรู้ว่าเป็นบัญชีหมวดใด', noType.length === 0, noType.join(', '));

/* นำเข้าจริงลงบริษัทเปล่า — ต้องไม่ต้องจับคู่บัญชีด้วยมือแม้แต่บรรทัดเดียว */
ctx.buildBlank({ name: 'บริษัท ทดสอบผังเดิม จำกัด', year: 2026 });
const faPrev = ctx.previewOpening(faTb.rows, {});
ok('★ ไม่เหลือบัญชีที่ต้องจับคู่ด้วยมือเลย', faPrev.unmatched.length === 0 && faPrev.ready,
   'สร้างใหม่ ' + faPrev.creating.length + ' · ตรงกับผังเดิม ' + faPrev.matched.length);
const faRes = ctx.importOpeningBalances(faTb.rows, '2026-12-31', {});
ok('ลงบัญชียอดยกมาได้ครบทุกบรรทัด', faRes.accounts === faTb.rows.length, faRes.accounts + ' บรรทัด');
ok('สร้างบัญชีใหม่โดยเก็บรหัสเดิมไว้',
   ctx.DB.accounts.some((a) => a.code === '11122.01' && a.imported && a.subType === 'bank'));
ok('★ งบทดลองสมดุลหลังนำเข้า', ctx.trialBalance('2026-01-01', '2026-12-31').balanced);
const faBs = ctx.balanceSheet('2026-12-31');
ok('★ งบแสดงฐานะการเงินสมดุล ไม่มีบัญชีตกหล่นจากงบ', faBs.diff === 0,
   'สินทรัพย์ ' + ctx.fmt(faBs.assets) + ' = หนี้สินและทุน ' + ctx.fmt(faBs.liabEquity));
const faArChk = ctx.reconciliationChecks('2026-12-31').checks.find((c) => c.code === 'AP_SUBLEDGER');
ok('ยกยอดรวมเจ้าหนี้มาแต่ยังไม่มีใบค้าง ระบบอธิบายให้ ไม่ใช่ขึ้นแดงเฉย ๆ',
   !faArChk.ok && !!faArChk.why, faArChk.why || '');
const faVatChk = ctx.reconciliationChecks('2026-12-31').checks.find((c) => c.code === 'OUTPUT_VAT');
ok('ยอดที่ยกมาจากระบบเดิมไม่ถูกเอาไปเทียบกับทะเบียนภาษี เพราะไม่มีเอกสารรองรับ', faVatChk.ok);

console.log('\n=== 10. ยกเลิกการนำเข้า แล้วนำเข้าใหม่แบบรายเดือน ===');
/* น้องบัญชีนำงบทดลองรายปีเข้าเป็นยอดยกมา ตัวเลขทั้งปีจึงไปกองอยู่เดือนเดียว
   ต้องยกเลิกได้ แล้วนำเข้าใหม่แบบยอดเคลื่อนไหวรายเดือน */
const imp1 = ctx.listImports();
ok('เห็นรายการนำเข้าที่ทำไปแล้ว', imp1.length === 1 && imp1[0].status === 'posted'
   && imp1[0].kind === 'opening', imp1.length + ' รายการ');
const plBefore = ctx.incomeStatement('2026-12-01', '2026-12-31');
ok('ตัวเลขทั้งปีไปกองอยู่เดือนเดียวจริง ๆ ตามที่ผู้ใช้เจอ', plBefore.net !== 0, ctx.fmt(plBefore.net));

const undo = ctx.reverseImport(imp1[0].no, 'นำเข้าผิดชุด ต้องนำเข้าใหม่แบบรายเดือน');
ok('★ ยกเลิกแล้วยอดกลับไปเป็นศูนย์ทั้งงบ',
   ctx.balanceSheet('2026-12-31').assets === 0
   && ctx.incomeStatement('2026-12-01', '2026-12-31').net === 0);
ok('ใบเดิมไม่ถูกลบทิ้ง แต่ถูกทำเครื่องหมายกลับรายการ ตาม พ.ร.บ.การบัญชี ม.20',
   ctx.listImports()[0].status === 'reversed' && ctx.listImports()[0].reversedBy === undo.no);
ok('งบทดลองยังสมดุลหลังยกเลิก', ctx.trialBalance('2026-01-01', '2026-12-31').balanced);
ok('บัญชีที่สร้างไว้ตอนนำเข้ายังอยู่ ไม่ต้องสร้างใหม่',
   ctx.DB.accounts.some((a) => a.code === '11122.01' && a.imported));

/* ยอดเคลื่อนไหวของเดือน — ใช้คอลัมน์ยอดประจำงวด ลงวันสิ้นเดือนที่เลือก */
const movRows = ctx.readTrialBalance(faRows, { code:0, name:1, debit:6, credit:7 }, faDet.headerRow);
const movDr = movRows.rows.reduce((a, r) => a + r.debit, 0);
const movCr = movRows.rows.reduce((a, r) => a + r.credit, 0);
ok('ชุดยอดประจำงวดก็สมดุลเหมือนกัน', movDr === movCr, ctx.fmt(movDr));
const mov = ctx.importPeriodMovement(movRows.rows, '2026-11', {});
ok('★ ยอดเคลื่อนไหวลงใบสำคัญวันสิ้นเดือนที่เลือก',
   mov.entry.date === ctx.endOfMonth('2026-11-01') && mov.entry.type === 'general',
   mov.entry.no + ' ลงวันที่ ' + mov.entry.date);
ok('ยอดเคลื่อนไหวเข้างบกำไรขาดทุนของเดือนนั้น ไม่ใช่เดือนอื่น',
   ctx.incomeStatement('2026-11-01', '2026-11-30').net !== 0
   && ctx.incomeStatement('2026-12-01', '2026-12-31').net === 0);
ok('งบทดลองยังสมดุล', ctx.trialBalance('2026-01-01', '2026-12-31').balanced);
throws('นำเข้ายอดเคลื่อนไหวเดือนเดิมซ้ำ',
  () => ctx.importPeriodMovement(movRows.rows, '2026-11', {}), 'ALREADY_IMPORTED');
throws('ไม่เลือกเดือนก็ลงไม่ได้',
  () => ctx.importPeriodMovement(movRows.rows, '', {}), 'PERIOD_REQUIRED');
ok('รายการนำเข้าทั้งสองแบบขึ้นในประวัติครบ',
   ctx.listImports().length === 2
   && ctx.listImports().some((i) => i.kind === 'movement' && i.key === '2026-11'));

/* ยกเลิกแล้วต้องนำเข้าซ้ำวันเดิมได้ ไม่ถูกกันว่าซ้ำ */
const again = ctx.importOpeningBalances(faTb.rows, '2026-12-31', {});
ok('★ ยกเลิกแล้วนำเข้าวันเดิมใหม่ได้ ไม่ติดว่าซ้ำ', !!again.entry.no, again.entry.no);
ok('คราวนี้ไม่ต้องสร้างบัญชีใหม่แล้ว เพราะรหัสเดิมอยู่ในผังแล้ว', again.created === 0);

/* ไฟล์บัญชีแยกประเภทต้องไม่ถูกนับเป็นงบทดลอง */
const LEDGER = [
  ['บัญชีแยกประเภท'],
  ['รหัสบัญชี', 'วันที่', 'สมุดรายวัน', 'เลขที่เอกสาร', 'ชื่อบัญชี', 'เดบิต', 'เครดิต', 'ยอดคงเหลือ'],
  ['11121.01', '13/01/2026', 'รายวันทั่วไป', 'JV2026010009', 'กสิกรไทย 1681027862', '10000', '', '10000'],
  ['11121.01', '14/01/2026', 'รายวันทั่วไป', 'JV2026010015', 'กสิกรไทย 1681027862', '', '10520.4', '-520.4'],
  ['11121.01', '19/01/2026', 'รายวันทั่วไป', 'JV2026010020', 'กสิกรไทย 1681027862', '800', '', '279.6'],
];
const ldDet = ctx.detectColumns(LEDGER);
ok('★ ไฟล์บัญชีแยกประเภทถูกจับได้ว่าไม่ใช่งบทดลอง',
   ctx.detectFileKind(LEDGER, ldDet.map, ldDet.headerRow) === 'ledger',
   'ถ้าเผลอนำเข้า ยอดจะกลายเป็นผลรวมรายการทั้งปีแทนยอดคงเหลือ');
const CHART = [
  ['ผังบัญชี / Chart of Accounts'],
  ['Code', 'ชื่อบัญชี', 'Account Name', 'ประเภท', 'Category', 'ประเภทบัญชี', 'Account Type'],
  ['11111', 'เงินสดในมือ', 'Cash on Hand', 'สินทรัพย์', 'Assets', 'บัญชีย่อย', 'Sub-Account'],
];
const chDet = ctx.detectColumns(CHART);
ok('ไฟล์ผังบัญชีถูกจับได้ว่าไม่ใช่งบทดลอง',
   ctx.detectFileKind(CHART, chDet.map, chDet.headerRow) === 'chart');

console.log('\n════════════════════════════════════════');
console.log(' ผ่าน ' + pass + ' ข้อ · ไม่ผ่าน ' + fail + ' ข้อ');
console.log('════════════════════════════════════════');
process.exit(fail ? 1 : 0);
