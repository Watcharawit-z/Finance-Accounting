/* ทดสอบเครื่องบัญชีในเบราว์เซอร์ — รันด้วย node webapp/test.js */
const fs = require('fs');
const src = ['engine','operations','seed','import','verify'].map(f => fs.readFileSync(__dirname + '/src/' + f + '.js','utf8')).join('\n');
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
  'createPaymentBatch,approvePaymentBatch,payPaymentBatch,postJournalVoucher,journalOf,' +
  'bahtText,equityStatement,saveCompany,companyGaps,verifyAgainstFile,importHealth,importFor,voidDocument,voidPreview,voidCheck,voidRun,runCheck,' +
  'creditableBase,matchBankTxn,reopenPeriod,repairDuplicateEntryNos,loadState,' +
  'tbFileChecks,importPreflight,readFileDates,decodeText,satangOf,defaultSet,importPackage,accBySub,acc,matchAccount};')();

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
{
  const manual = D.entries.find((e) => e.status === 'posted' && (!e.src || e.src === 'manual'));
  const fromDoc = D.entries.find((e) => e.status === 'posted' && e.src === 'invoice');
  throws('กลับรายการโดยไม่ระบุเหตุผล', () => ctx.reverse(manual.no, ''), 'REASON_REQUIRED');
  throws('กลับรายการที่เกิดจากเอกสารตรงๆ ไม่ได้ ต้องยกเลิกที่เอกสาร', () => ctx.reverse(fromDoc.no, 'ทดสอบเหตุผลยาว'), 'ENTRY_FROM_DOCUMENT');
}
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

console.log('\n=== 7.12 เอกสารพิมพ์ งบส่วนของผู้ถือหุ้น และข้อมูลกิจการ ===');
{
  const BAHT = [
    ['1', 'หนึ่งบาทถ้วน'], ['11', 'สิบเอ็ดบาทถ้วน'], ['21', 'ยี่สิบเอ็ดบาทถ้วน'], ['101', 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    ['20', 'ยี่สิบบาทถ้วน'], ['107000', 'หนึ่งแสนเจ็ดพันบาทถ้วน'], ['900940', 'เก้าแสนเก้าร้อยสี่สิบบาทถ้วน'],
    ['1000001', 'หนึ่งล้านเอ็ดบาทถ้วน'], ['21000000', 'ยี่สิบเอ็ดล้านบาทถ้วน'],
    ['1250000000', 'หนึ่งพันสองร้อยห้าสิบล้านบาทถ้วน'],
    ['26750.50', 'สองหมื่นหกพันเจ็ดร้อยห้าสิบบาทห้าสิบสตางค์'], ['0.25', 'ยี่สิบห้าสตางค์'],
    ['0.11', 'สิบเอ็ดสตางค์'], ['0', 'ศูนย์บาทถ้วน'], ['1.005', 'หนึ่งบาทหนึ่งสตางค์'],
  ];
  const bad = BAHT.filter((b) => ctx.bahtText(ctx.M(b[0])) !== b[1]);
  ok('★ จำนวนเงินเป็นตัวอักษรถูกทุกกรณี (เอ็ด ยี่สิบ ล้าน สตางค์ ปัดเศษ)', bad.length === 0,
    bad.length ? bad.map((b) => b[0] + '→' + ctx.bahtText(ctx.M(b[0]))).join(' · ') : BAHT.length + ' กรณี');

  const eq = ctx.equityStatement('2026-01-01', '2026-07-31');
  ok('★ งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้นปลายงวดตรงกับงบแสดงฐานะการเงิน', eq.matchesBs, ctx.fmt(eq.total));
  ok('กำไรสุทธิในงบส่วนของผู้ถือหุ้นเท่ากับงบกำไรขาดทุน',
    eq.net === ctx.incomeStatement('2026-01-01', '2026-07-31').net, ctx.fmt(eq.net));
  const opening = eq.rows.find((r) => r.k === 'op'), closing = eq.rows.find((r) => r.k === 'tot');
  ok('ยอดต้นงวด + การเปลี่ยนแปลงทุกบรรทัด = ยอดปลายงวด',
    eq.rows.filter((r) => !r.k).reduce((x, r) => x + r.total, opening.total) === closing.total);

  throws('เลขผู้เสียภาษีของกิจการผิดหลักที่ 13', () => ctx.saveCompany({ name:'ทดสอบ', taxId:'0105548021443' }), 'TAX_ID_INVALID');
  throws('รหัสสาขาต้องเป็นตัวเลข 5 หลัก', () => ctx.saveCompany({ name:'ทดสอบ', branch:'1' }), 'BRANCH_INVALID');
  const keep = Object.assign({}, D.company);
  const co = ctx.saveCompany({ name: keep.name, taxId: keep.taxId, branch:'00001', address:'99 ถนนทดสอบ กรุงเทพมหานคร 10110',
    phone: keep.phone });
  ok('แก้ข้อมูลกิจการได้ และชื่อสาขาตั้งให้ตามรหัส', co.branchName === 'สาขาที่ 00001' && co.address.indexOf('99 ถนนทดสอบ') === 0);
  ok('ข้อมูลครบตามมาตรา 86/4 ไม่มีอะไรขาด', ctx.companyGaps().length === 0);
  ctx.saveCompany(Object.assign({}, keep, { branch: keep.branch || '00000' }));
  ok('คืนค่าเดิมได้', D.company.address === keep.address && D.company.branchName === 'สำนักงานใหญ่');
}

console.log('\n=== 7.13 ยกเลิกเอกสาร — กลับทุกอย่างที่เอกสารเคยแตะ ===');
{
  const allOk = () => { const r = ctx.reconciliationChecks('2026-07-31'); return r.allPassed ? '' : r.checks.filter((c) => !c.ok).map((c) => c.label + ' ต่าง ' + ctx.fmt(c.control - c.sub)).join(' · '); };
  const tbOk = () => { const tb = ctx.trialBalance('2026-01-01', '2026-07-31'); return tb.totals ? tb.totals.dr === tb.totals.cr : true; };
  const cust = D.partners.find((p) => p.kind === 'customer' && p.taxId && p.address);
  const sw = D.items.find((i) => i.code === 'SW-220');
  const qty0 = sw.qty, val0 = sw.value;
  const entries0 = D.entries.length;

  // 1) ใบกำกับมีสินค้าคงคลัง → ยกเลิก
  const inv = ctx.issueInvoice({ partnerCode: cust.code, date:'2026-07-20',
    lines:[{ desc: sw.name, qty: 3, price:'1500', itemCode: sw.code, taxCode:'VAT7' }] });
  ok('ออกใบกำกับทดสอบแล้วสต๊อกลด', sw.qty === qty0 - 3, inv.no);
  const pv = ctx.voidPreview('invoice', inv.no);
  ok('ก่อนยกเลิกบอกให้รู้ว่าจะเกิดอะไรขึ้นบ้าง', pv.length >= 3, pv.join(' | '));
  throws('ยกเลิกโดยไม่ระบุเหตุผล', () => ctx.voidDocument('invoice', inv.no, 'ผิด'), 'REASON_REQUIRED');
  ctx.voidDocument('invoice', inv.no, 'ออกผิดลูกค้า ทดสอบระบบ');
  const e1 = D.entries.find((e) => e.no === inv.entryNo), e2 = D.entries.find((e) => e.no === inv.cogsEntryNo);
  ok('★ ใบสำคัญขายและต้นทุนขายถูกกลับรายการ ณ วันที่เดิม', e1.status === 'reversed' && e2.status === 'reversed'
    && D.entries.find((e) => e.no === e1.reversedBy).date === inv.date);
  ok('★ สต๊อกกลับมาเท่าเดิมทั้งจำนวนและมูลค่า', sw.qty === qty0 && sw.value === val0, sw.qty + ' / ' + ctx.fmt(sw.value));
  const tx = D.taxTx.find((t) => t.kind === 'vat_output' && t.docNo === inv.no);
  ok('★ ทะเบียนภาษีขายยังมีเลขที่นี้ แต่ยอดเป็นศูนย์และเขียนว่ายกเลิก', tx && tx.void && tx.base === 0 && tx.tax === 0 && tx.orig.tax > 0);
  ok('ใบที่ยกเลิกไม่มียอดค้าง', ctx.invOutstanding(inv) === 0 && inv.status === 'void');
  ok('★ หลังยกเลิก ลูกหนี้ ภาษี สต๊อก ยังกระทบยอดตรงทุกบัญชี', allOk() === '', allOk());
  throws('ยกเลิกซ้ำ', () => ctx.voidDocument('invoice', inv.no, 'ยกเลิกซ้ำอีกรอบ'), 'ALREADY_VOID');
  throws('รับชำระอ้างใบที่ยกเลิกแล้ว', () => ctx.receivePayment({ date:'2026-07-25', invoiceNo: inv.no }), 'INVOICE_VOID');
  throws('ลดหนี้อ้างใบที่ยกเลิกแล้ว', () => ctx.issueCreditNote({ date:'2026-07-25', invoiceNo: inv.no, base:'100', reason:'CALC_ERROR' }), 'CREDIT_NOTE_ORIGIN_VOID');
  throws('★ กลับรายการที่ใบสำคัญของเอกสารตรง ๆ ไม่ได้', () => ctx.reverse(D.entries.find((e) => e.src === 'receipt' && e.status === 'posted').no, 'ลองกลับตรง ๆ'), 'ENTRY_FROM_DOCUMENT');

  // 2) ใบกำกับที่มีใบเสร็จอ้างถึง — ต้องยกเลิกใบเสร็จก่อน
  const inv2 = ctx.issueInvoice({ partnerCode: cust.code, date:'2026-07-21',
    lines:[{ desc:'ค่าบริการทดสอบยกเลิก', qty: 1, price:'10000', taxCode:'VAT7' }] });
  const rc = ctx.receivePayment({ date:'2026-07-22', invoiceNo: inv2.no, amount:'5000' });
  throws('★ ยกเลิกใบกำกับที่มีใบเสร็จอ้างถึงไม่ได้', () => ctx.voidDocument('invoice', inv2.no, 'ทดสอบยกเลิกมีใบเสร็จ'), 'VOID_HAS_DEPENDENTS');
  const bt = { id: 9901, date:'2026-07-22', desc:'TEST DEPOSIT', ref:'T1', debit:0, credit: rc.net, matched:false };
  D.bankTxns.push(bt);
  ctx.matchBankTxn(9901, rc.entryNo);
  ctx.voidDocument('receipt', rc.no, 'ลูกค้าเช็คเด้ง ทดสอบ');
  ok('★ ยกเลิกใบเสร็จแล้วยอดค้างของใบกำกับกลับมาเต็ม', ctx.invOutstanding(inv2) === inv2.total && inv2.status === 'issued');
  ok('★ บรรทัดสเตทเมนต์ที่จับคู่กับใบเสร็จกลับไปรอกระทบยอดใหม่', bt.matched === false && !bt.matchedTo);
  D.bankTxns.splice(D.bankTxns.indexOf(bt), 1);

  // 3) ใบลดหนี้และใบเพิ่มหนี้
  const cn = ctx.issueCreditNote({ date:'2026-07-23', invoiceNo: inv2.no, base:'2000', reason:'PRICE_REDUCE' });
  ok('มูลค่าที่ยังลดหนี้ได้คิดจากฐานก่อนภาษี', ctx.creditableBase(inv2) === ctx.M('8000'), ctx.fmt(ctx.creditableBase(inv2)));
  throws('★ ลดหนี้เกินฐานก่อนภาษีที่เหลือ (ไม่ใช่เทียบกับยอดรวมภาษี)', () => ctx.issueCreditNote({ date:'2026-07-23', invoiceNo: inv2.no, base:'8000.01', reason:'PRICE_REDUCE' }), 'CREDIT_NOTE_EXCEEDS');
  ctx.voidDocument('creditNote', cn.no, 'ลดผิดจำนวน ทดสอบ');
  ok('ยกเลิกใบลดหนี้แล้วลดหนี้ได้เต็มอีกครั้ง', ctx.creditableBase(inv2) === ctx.M('10000') && inv2.credited === 0);
  const dn = ctx.issueDebitNote({ date:'2026-07-23', invoiceNo: inv2.no, base:'1000', reason:'SERVICE_UNDERPRICED' });
  ok('ใบเพิ่มหนี้เพิ่มฐานที่ลดหนี้ได้', ctx.creditableBase(inv2) === ctx.M('11000'));
  ctx.voidDocument('debitNote', dn.no, 'เพิ่มหนี้ผิด ทดสอบ');
  ok('ยกเลิกใบเพิ่มหนี้แล้วยอดค้างกลับเท่าใบกำกับ', ctx.invOutstanding(inv2) === inv2.total && !inv2.debited);
  ctx.voidDocument('invoice', inv2.no, 'ไม่มีเอกสารอ้างถึงแล้ว ยกเลิกได้');
  ok('★ ยกเลิกใบเสร็จ ใบลดหนี้ ใบเพิ่มหนี้ แล้วยกเลิกใบกำกับ — ทุกบัญชียังตรง', allOk() === '', allOk());

  // 4) ซื้อสินค้า: ตั้งหนี้ตรง / ผ่านใบรับสินค้า
  const ven = D.partners.find((p) => p.code === 'VEN-0004');
  const sq = sw.qty, sv = sw.value;
  const bill = ctx.recordBill({ partnerCode: ven.code, date:'2026-07-24', vendorNo:'VOID-T-001',
    lines:[{ desc: sw.name, qty: 10, price:'100', itemCode: sw.code, expenseSub:'inventory' }] });
  ctx.voidDocument('bill', bill.no, 'บันทึกซ้ำกับใบเดิม');
  ok('★ ยกเลิกตั้งหนี้ที่รับของเข้าคลัง สต๊อกกลับเท่าเดิม', sw.qty === sq && sw.value === sv);
  const again = ctx.recordBill({ partnerCode: ven.code, date:'2026-07-24', vendorNo:'VOID-T-001',
    lines:[{ desc: sw.name, qty: 10, price:'100', itemCode: sw.code, expenseSub:'inventory' }] });
  ok('ยกเลิกแล้วบันทึกเลขใบกำกับผู้ขายเดิมซ้ำได้', !!again.no);
  ctx.voidDocument('bill', again.no, 'ทดสอบเสร็จแล้ว ยกเลิก');

  const grn = ctx.issueGoodsReceipt({ partnerCode: ven.code, date:'2026-07-24', vendorDoNo:'DO-VOID',
    lines:[{ itemCode: sw.code, desc: sw.name, qty: 5, price:'100' }] });
  const gb = ctx.billGoodsReceipt(grn.no, { date:'2026-07-25', vendorNo:'VOID-T-002' });
  throws('ยกเลิกใบรับสินค้าที่ตั้งหนี้แล้วไม่ได้', () => ctx.voidDocument('goodsReceipt', grn.no, 'ทดสอบยกเลิกใบรับ'), 'VOID_HAS_DEPENDENTS');
  ctx.voidDocument('bill', gb.no, 'ใบกำกับผู้ขายผิด รอใบใหม่');
  ok('★ ยกเลิกตั้งหนี้จากใบรับสินค้า ใบรับสินค้ากลับไปรอใบกำกับ และสต๊อกไม่ขยับ', grn.status === 'received' && !grn.billNo && sw.qty === sq + 5);
  ok('บัญชีพักรับสินค้ากระทบยอดตรงหลังยกเลิกตั้งหนี้', allOk() === '', allOk());
  ctx.voidDocument('goodsReceipt', grn.no, 'รับของผิดรุ่น คืนผู้ขาย');
  ok('★ ยกเลิกใบรับสินค้า สต๊อกกลับเท่าเดิม', sw.qty === sq && sw.value === sv);

  // 5) จ่ายชำระพร้อมหัก ณ ที่จ่าย → ยกเลิก 50 ทวิ และตัดออกจากแบบ
  const sb = ctx.recordBill({ partnerCode: ven.code, date:'2026-07-24', vendorNo:'VOID-T-003',
    lines:[{ desc:'ค่าบริการซ่อมบำรุง', qty: 1, price:'20000', expenseSub:'admin_expense' }], whtCode:'WHT_SERVICE' });
  const pay = ctx.payBill({ date:'2026-07-26', billNo: sb.no, channel:'manual' });
  ok('จ่ายพร้อมหัก ณ ที่จ่ายแล้วได้ 50 ทวิ', !!pay.certNo && pay.wht > 0, pay.certNo + ' ' + ctx.fmt(pay.wht));
  throws('ยกเลิกตั้งหนี้ที่จ่ายแล้วไม่ได้', () => ctx.voidDocument('bill', sb.no, 'ทดสอบยกเลิกตั้งหนี้'), 'VOID_HAS_DEPENDENTS');
  ctx.voidDocument('payment', pay.no, 'โอนผิดบัญชี ทดสอบ');
  const cert = D.docs.whtCert.find((c) => c.no === pay.certNo);
  const wtx = D.taxTx.find((t) => t.kind === 'wht' && t.docNo === pay.no);
  ok('★ ยกเลิกใบสำคัญจ่าย 50 ทวิ ถูกยกเลิกด้วย และไม่เข้าแบบ ภ.ง.ด.', cert.status === 'void' && wtx.void && wtx.tax === 0);
  ok('ยอดค้างของตั้งหนี้กลับมาเต็ม', ctx.billOutstanding(sb) === sb.total && sb.status === 'issued');
  ok('★ หลังยกเลิกจ่าย เจ้าหนี้และภาษีหัก ณ ที่จ่ายยังตรง', allOk() === '', allOk());
  ctx.voidDocument('bill', sb.no, 'ทดสอบเสร็จแล้ว ยกเลิก');

  // 6) ค่าใช้จ่ายที่ออก 50 ทวิ อัตโนมัติ
  const ex = ctx.recordExpense({ partnerCode: ven.code, date:'2026-07-26', method:'transfer', taxInvoiceNo:'TX-VOID-1',
    lines:[{ desc:'ค่าขนส่ง', qty: 1, price:'5000', acc:'5321', taxCode:'VAT7' }], whtCode:'WHT_TRANSPORT' });
  ctx.voidDocument('expense', ex.no, 'บันทึกซ้ำ ทดสอบ');
  ok('★ ยกเลิกค่าใช้จ่าย 50 ทวิ ที่ออกอัตโนมัติถูกยกเลิกด้วย', !ex.certNo || D.docs.whtCert.find((c) => c.no === ex.certNo).status === 'void');
  ok('ภาษีซื้อของค่าใช้จ่ายที่ยกเลิกเป็นศูนย์', D.taxTx.filter((t) => t.expenseNo === ex.no).every((t) => t.void && t.tax === 0));

  // 7) งวดที่ปิดหรือยื่นภาษีแล้ว
  const may = D.docs.invoice.find((d) => d.date.slice(0, 7) === '2026-05' && !d.broughtForward && d.status !== 'void'
    && !D.docs.receipt.some((r) => r.invoiceNo === d.no) && !D.docs.creditNote.some((c) => c.invoiceNo === d.no));
  if (may) {
    throws('★ ยกเลิกเอกสารในงวดที่ปิดแล้วไม่ได้', () => ctx.voidDocument('invoice', may.no, 'ทดสอบงวดปิด'), 'PERIOD_CLOSED');
    ctx.reopenPeriod('2026-05', 'ทดสอบยกเลิกเอกสารที่ยื่นภาษีแล้ว');
    throws('★ ยกเลิกใบกำกับที่ยื่น ภ.พ.30 ไปแล้วไม่ได้ ต้องออกใบลดหนี้', () => ctx.voidDocument('invoice', may.no, 'ทดสอบยื่นแล้ว'), 'TAX_ALREADY_FILED');
    D.periods.find((p) => p.code === '2026-05').status = 'closed';
  }

  // 8) ยกเลิกงวดเงินเดือนและค่าเสื่อมราคา
  const assets0 = D.assets.map((a) => a.accumBook + '|' + a.accumTax).join(',');
  const dep = ctx.runDepreciation('2026-07');
  throws('★ กลับรายการใบสำคัญค่าเสื่อมตรง ๆ ไม่ได้', () => ctx.reverse(dep.entryNo, 'ลองกลับตรง ๆ'), 'ENTRY_FROM_DOCUMENT');
  ctx.voidRun('depreciation', '2026-07', 'ใส่อายุทรัพย์สินผิด ทดสอบ');
  ok('★ ยกเลิกงวดค่าเสื่อม ค่าเสื่อมสะสมของทรัพย์สินทุกตัวกลับเท่าเดิม', D.assets.map((a) => a.accumBook + '|' + a.accumTax).join(',') === assets0);
  const dep2 = ctx.runDepreciation('2026-07');
  ok('ยกเลิกแล้วตั้งค่าเสื่อมงวดเดิมใหม่ได้ ยอดเท่าเดิม', dep2.bookTotal === dep.bookTotal);
  throws('ยกเลิกค่าเสื่อมงวดที่มีงวดหลังคิดต่ออยู่ไม่ได้', () => ctx.voidRun('depreciation', '2026-05', 'ทดสอบงวดเก่า'), 'RUN_HAS_LATER');
  ctx.voidRun('depreciation', '2026-07', 'คืนสภาพก่อนทดสอบปิดงวด');
  const pr = ctx.runPayroll('2026-07');
  ctx.voidRun('payroll', '2026-07', 'เงินเดือนพนักงานผิด ทดสอบ');
  const ptx = D.taxTx.find((t) => t.docType === 'payroll' && t.entryNo === pr.entryNo);
  ok('★ ยกเลิกงวดเงินเดือน ภาษีหัก ณ ที่จ่ายถูกตัดออกจาก ภ.ง.ด.1', ptx.void && ptx.tax === 0);
  ok('ยกเลิกแล้วทำเงินเดือนงวดเดิมใหม่ได้', ctx.runPayroll('2026-07').net === pr.net);
  ctx.voidRun('payroll', '2026-07', 'คืนสภาพก่อนทดสอบปิดงวด');

  ok('★ หลังยกเลิกทุกประเภท ลูกหนี้ เจ้าหนี้ ภาษี พักรับสินค้า ยังตรงทุกบัญชี', allOk() === '', allOk());
  ok('งบทดลองสมดุลหลังยกเลิกทุกประเภท', tbOk());
  const nos = D.entries.map((e) => e.no);
  ok('★ เลขที่ใบสำคัญไม่ซ้ำกันเลยแม้แต่ใบเดียว (ใบปรับปรุงกับใบทั่วไปใช้ JV ร่วมกัน)', new Set(nos).size === nos.length,
    nos.length - new Set(nos).size + ' ใบซ้ำ');
  {
    /* จำลองข้อมูลที่บันทึกไว้ก่อนแก้ตัวนับ: ใบปิดภาษี ภ.พ.30 ได้เลขเดียวกับใบสำคัญทั่วไป */
    const c2 = new Function(src + '\nreturn {DB,buildSeed,loadState};')();
    c2.buildSeed();
    const F = c2.DB.entries.find((e) => e.src === 'filing' && String(e.srcId).indexOf('PP30|2026-03') === 0);
    const G = c2.DB.entries.find((e) => e.no.indexOf('JV2603') === 0 && e.src !== 'filing');
    const fil = c2.DB.docs.filing.find((f) => f.form === 'PP30' && f.period === '2026-03');
    const gNo = G.no;
    F.no = gNo; fil.entryNo = gNo;
    c2.loadState(JSON.parse(JSON.stringify(c2.DB)));
    const F2 = c2.DB.entries.find((e) => e.src === 'filing' && e.srcId === 'PP30|2026-03');
    const nos2 = c2.DB.entries.map((e) => e.no);
    ok('★ เปิดข้อมูลเก่าที่มีเลขใบสำคัญซ้ำ ระบบแก้ให้ใบหลังได้เลขใหม่ ใบแรกคงเลขเดิม',
      new Set(nos2).size === nos2.length && c2.DB.entries.find((e) => e.no === gNo).src !== 'filing' && F2.renumberedFrom === gNo, gNo + ' → ' + F2.no);
    ok('★ แบบ ภ.พ.30 ที่อ้างใบสำคัญนั้นถูกแก้ตามไปด้วย', c2.DB.docs.filing.find((f) => f.form === 'PP30' && f.period === '2026-03').entryNo === F2.no);
    ok('การแก้เลขบันทึกไว้ในร่องรอยการตรวจสอบ', c2.DB.audit.some((a) => a.action === 'renumber'));
  }
  ok('ทุกการยกเลิกบันทึกเป็นใบกลับรายการ ไม่มีการลบใบสำคัญ', D.entries.length > entries0
    && D.entries.every((e) => e.status === 'posted' || e.status === 'reversed'));
}

console.log('\n=== 7.14 ตัวเลขต้องไม่พลาด — กรณีจากการตรวจสอบเชิงลึก ===');
{
  /* บริษัทแยกต่างหาก ไม่กระทบชุดทดสอบอื่น */
  const A = new Function(src + '\nreturn {DB,buildSeed,issueInvoice,receivePayment,issueCreditNote,issueDebitNote,refundCustomer,' +
    'recordBill,payBill,recordExpense,fileVat,fileWht,runDepreciation,voidDocument,reconciliationChecks,aging,balBySub,' +
    'trialBalance,M,fmt,mulQty,mulDiv,invOutstanding,creditableBase,estimateBillWht,saveItem,createPaymentBatch,' +
    'savePartner,openNextFiscalYear,unM};')();
  A.buildSeed();
  const X = A.DB, Mx = A.M;
  const recOk = (d) => { const r = A.reconciliationChecks(d || '2026-12-31'); return r.allPassed ? '' : r.checks.filter((c) => !c.ok).map((c) => c.label).join(' · '); };
  const cust = X.partners.find((p) => p.kind === 'customer' && p.taxId && p.address);
  const ven = X.partners.find((p) => p.kind === 'vendor' && p.entityType !== 'individual' && p.taxId);
  const gl = (sub, to, from) => A.balBySub([sub], to || '2026-12-31', from);

  // 1) e-Withholding Tax ไม่ค้างในบัญชีภาษีหัก ณ ที่จ่ายค้างนำส่ง
  const w0 = gl('wht_payable_pnd53'), b0 = gl('bank');
  const rb = A.recordBill({ partnerCode: ven.code, date:'2026-08-05', vendorNo:'AUD-EWHT-1',
    lines:[{ desc:'ค่าเช่าโกดัง', qty:1, price:'10000', expenseSub:'admin_expense' }], whtCode:'WHT_RENT' });
  const ep = A.payBill({ date:'2026-08-06', billNo: rb.no, channel:'e_wht' });
  ok('★ จ่ายผ่าน e-WHT ภาษีหัก ณ ที่จ่ายไม่ค้างในบัญชีค้างนำส่ง (ธนาคารนำส่งแทน)', gl('wht_payable_pnd53') === w0 && ep.wht === Mx('100'),
    'หัก ' + A.fmt(ep.wht) + ' · ค้างนำส่งเท่าเดิม ' + A.fmt(-gl('wht_payable_pnd53')));
  ok('★ เงินฝากธนาคารลดเต็มจำนวน (สุทธิให้ผู้ขาย + ภาษีที่ธนาคารนำส่ง)', b0 - gl('bank') === rb.total, A.fmt(b0 - gl('bank')));
  ok('ทะเบียนภาษียังบันทึกว่าเป็นรายการ e-WHT ไว้ตรวจสอบ', X.taxTx.some((t) => t.docNo === ep.no && t.channel === 'e_wht' && t.tax === Mx('100')));
  const ew0 = gl('wht_payable_pnd3');
  const exE = A.recordExpense({ partnerCode: ven.code, date:'2026-08-06', method:'transfer', channel:'e_wht',
    lines:[{ desc:'ค่าโฆษณาออนไลน์', qty:1, price:'20000', acc:'5321', taxCode:'EXEMPT' }], whtCode:'WHT_ADVERT' });
  ok('ค่าใช้จ่ายจ่ายผ่าน e-WHT ก็ไม่ค้างในบัญชีค้างนำส่ง และใช้อัตรา e-WHT 1%', gl('wht_payable_pnd53') === w0 && gl('wht_payable_pnd3') === ew0 && exE.wht === Mx('200'), A.fmt(exE.wht));

  // 2) ภ.พ.30 เดือนที่ภาษีขายเท่าภาษีซื้อ
  const ci = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-10', lines:[{ desc:'ค่าบริการ', qty:1, price:'1000', taxCode:'VAT7' }] });
  A.recordBill({ partnerCode: ven.code, date:'2026-08-11', vendorNo:'AUD-VAT-1', lines:[{ desc:'ค่าวัสดุ', qty:1, price:'1000', expenseSub:'admin_expense' }] });
  // ภาษีซื้อรวมของเดือนสิงหาคมต้องเท่าภาษีขาย จึงเอาบิลค่าเช่าที่มีภาษีออกจากการคำนวณ — ค่าเช่าในข้อ 1 ไม่มีภาษี (ไม่ระบุ taxCode = VAT7)
  const augOut = X.taxTx.filter((t) => t.kind === 'vat_output' && t.period === '2026-08' && !t.void).reduce((a, t) => a + t.tax, 0);
  const augIn = X.taxTx.filter((t) => t.kind === 'vat_input' && t.period === '2026-08' && !t.void).reduce((a, t) => a + t.tax, 0);
  const f8 = A.fileVat('2026-08');
  ok('★ ยื่น ภ.พ.30 แล้วบัญชีภาษีขายและภาษีซื้อของเดือนเป็นศูนย์ทั้งคู่', gl('output_vat', '2026-08-31', '2026-08-01') === 0
    && gl('input_vat', '2026-08-31', '2026-08-01') === 0 && !!f8.entryNo, 'ขาย ' + A.fmt(augOut) + ' ซื้อ ' + A.fmt(augIn));

  // 3) เดือนที่มีแต่ใบลดหนี้
  const cn9 = A.issueCreditNote({ date:'2026-09-03', invoiceNo: ci.no, base:'100', reason:'PRICE_REDUCE' });
  let f9 = null; try { f9 = A.fileVat('2026-09'); } catch (e) { f9 = e; }
  ok('★ เดือนที่มีแต่ใบลดหนี้ ยื่น ภ.พ.30 ได้ ภาษีที่ชำระเกินยกไปเป็นภาษีขอคืน', f9 && f9.payable === -cn9.vat
    && gl('output_vat', '2026-09-30', '2026-09-01') === 0 && gl('vat_receivable', '2026-09-30', '2026-09-01') === cn9.vat,
    f9 && f9.message ? f9.message : A.fmt(f9.payable));

  // 4) ค่าเสื่อมในงวดที่ปิด ต้องไม่ขยับทะเบียนทรัพย์สิน
  const accum0 = X.assets.map((a) => a.accumBook).join(',');
  const p10 = X.periods.find((p) => p.code === '2026-10'); p10.status = 'closed';
  throws('ตั้งค่าเสื่อมในงวดที่ปิด', () => A.runDepreciation('2026-10'), 'PERIOD_CLOSED');
  ok('★ ตั้งค่าเสื่อมไม่สำเร็จแล้วค่าเสื่อมสะสมของทรัพย์สินไม่ขยับเลย', X.assets.map((a) => a.accumBook).join(',') === accum0);
  p10.status = 'open';

  // 5) ลดหนี้หลังรับเงินครบ → ลูกค้ามีเครดิต → คืนเงิน
  const i5 = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-12', lines:[{ desc:'ค่าบริการติดตั้ง', qty:1, price:'1000', taxCode:'VAT7' }] });
  A.receivePayment({ date:'2026-08-13', invoiceNo: i5.no });
  const c5 = A.issueCreditNote({ date:'2026-08-14', invoiceNo: i5.no, base:'1000', reason:'SERVICE_INCOMPLETE' });
  ok('★ ลดหนี้หลังรับเงินครบ ลูกค้ามียอดเครดิต สถานะบอกว่ารอคืนเงิน', A.invOutstanding(i5) === -c5.total && i5.status === 'credit_balance');
  const ag = A.aging('ar', '2026-12-31').totals.total, arGl = gl('trade_receivable');
  ok('★ รายงานอายุลูกหนี้รวมยอดเครดิตด้วย ยอดรวมเท่าบัญชีคุมลูกหนี้', ag === arGl, A.fmt(ag) + ' vs ' + A.fmt(arGl));
  const rf = A.refundCustomer({ date:'2026-08-15', invoiceNo: i5.no });
  ok('★ คืนเงินลูกค้าแล้วยอดค้างเป็นศูนย์ ลูกหนี้ยังตรงบัญชีคุม', A.invOutstanding(i5) === 0 && i5.status === 'paid' && recOk() === '', recOk());
  throws('ยกเลิกใบลดหนี้ที่คืนเงินลูกค้าไปแล้วไม่ได้', () => A.voidDocument('creditNote', c5.no, 'ทดสอบยกเลิกใบลดหนี้'), 'VOID_HAS_DEPENDENTS');
  A.voidDocument('customerRefund', rf.no, 'คืนเงินซ้ำ ทดสอบ');
  ok('ยกเลิกใบคืนเงิน เครดิตของลูกค้ากลับมา', A.invOutstanding(i5) === -c5.total);
  throws('คืนเงินเกินเครดิต', () => A.refundCustomer({ date:'2026-08-15', invoiceNo: i5.no, amount:'5000' }), 'REFUND_EXCEEDS');

  // 6) ภาษีของใบลดหนี้/เพิ่มหนี้ตามอัตราของรายการเดิม
  const z = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-16', lines:[{ desc:'ส่งออก', qty:1, price:'10000', taxCode:'VAT0' }] });
  const dz = A.issueDebitNote({ date:'2026-08-17', invoiceNo: z.no, base:'1000', reason:'GOODS_UNDERPRICED' });
  const dzt = X.taxTx.find((t) => t.docNo === dz.no);
  ok('★ เพิ่มหนี้ใบกำกับอัตรา 0% ไม่มีภาษี และยอดเข้าช่องอัตรา 0%', dz.vat === 0 && dzt.zero === Mx('1000') && dzt.base === 0);
  const mix = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-16', lines:[
    { desc:'สินค้าส่งออก', qty:1, price:'1000', taxCode:'VAT0' }, { desc:'ค่าบริการในประเทศ', qty:1, price:'1000', taxCode:'VAT7' }] });
  throws('★ ใบกำกับหลายอัตรา ต้องเลือกว่าลดหนี้รายการอัตราใด', () => A.issueCreditNote({ date:'2026-08-18', invoiceNo: mix.no, base:'400', reason:'PRICE_REDUCE' }), 'NOTE_TAX_CODE_REQUIRED');
  const cz = A.issueCreditNote({ date:'2026-08-18', invoiceNo: mix.no, base:'400', reason:'PRICE_REDUCE', taxCode:'VAT0' });
  const czt = X.taxTx.find((t) => t.docNo === cz.no);
  ok('★ ลดหนี้รายการอัตรา 0% ไม่กลับภาษีขาย และลดยอดช่องอัตรา 0% ไม่ใช่ช่องอัตราปกติ', cz.vat === 0 && czt.zero === -Mx('400') && czt.base === 0);
  ok('มูลค่าที่ลดได้แยกตามอัตรา', A.creditableBase(mix, 'VAT0') === Mx('600') && A.creditableBase(mix, 'VAT7') === Mx('1000'));
  throws('ลดหนี้เกินมูลค่าของอัตรานั้น', () => A.issueCreditNote({ date:'2026-08-18', invoiceNo: mix.no, base:'600.01', reason:'PRICE_REDUCE', taxCode:'VAT0' }), 'CREDIT_NOTE_EXCEEDS');

  // 7) ลูกค้าหัก ณ ที่จ่ายเฉพาะค่าบริการ
  const sw = X.items.find((i) => i.type === 'stock' && i.qty >= 5);
  const gs = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-19', lines:[
    { desc: sw.name, qty:1, price:'10000', itemCode: sw.code, taxCode:'VAT7' }, { desc:'ค่าติดตั้ง', qty:1, price:'5000', taxCode:'VAT7' }] });
  const rg = A.receivePayment({ date:'2026-08-20', invoiceNo: gs.no, whtCode:'WHT_SERVICE' });
  ok('★ ลูกค้าหักภาษี ณ ที่จ่ายจากค่าบริการเท่านั้น ไม่รวมค่าสินค้า', rg.whtBase === Mx('5000') && rg.wht === Mx('150'), A.fmt(rg.whtBase) + ' → ' + A.fmt(rg.wht));
  const gs2 = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-19', lines:[{ desc:'ค่าบริการ', qty:1, price:'5000', taxCode:'VAT7' }] });
  const rg2 = A.receivePayment({ date:'2026-08-20', invoiceNo: gs2.no, whtCode:'WHT_SERVICE', whtBase:'4000' });
  ok('ระบุฐานที่ลูกค้าหักจริงตาม 50 ทวิ ที่ได้รับได้', rg2.wht === Mx('120'));

  // 8) สัดส่วนฐานภาษีต้องไม่คลาดสตางค์
  const fr = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-21', lines:[
    { desc:'ค่าบริการ ก', qty:1, price:'903.17', taxCode:'VAT7' }, { desc:'ค่าบริการ ข', qty:1, price:'2013.65', taxCode:'EXEMPT' }] });
  const r8 = A.receivePayment({ date:'2026-08-22', invoiceNo: fr.no, amount:'796.39', whtCode:'WHT_SERVICE' });
  ok('★ ฐานภาษีตามสัดส่วนคำนวณแบบจำนวนเต็ม ได้ 779.50 และภาษี 23.39 (ไม่ใช่ 23.38)', r8.whtBase === Mx('779.50') && r8.wht === Mx('23.39'),
    A.fmt(r8.whtBase) + ' → ' + A.fmt(r8.wht));
  const r8b = A.receivePayment({ date:'2026-08-23', invoiceNo: fr.no, whtCode:'WHT_SERVICE' });
  ok('★ รับครั้งสุดท้ายได้ฐานส่วนที่เหลือ ผลรวมฐานทุกครั้งเท่าค่าบริการเต็มพอดี', r8.whtBase + r8b.whtBase === fr.base, A.fmt(r8.whtBase + r8b.whtBase) + ' = ' + A.fmt(fr.base));

  // 9) แบ่งจ่ายเพื่อเลี่ยงเกณฑ์ 1,000 บาทไม่ได้
  const sp = A.recordBill({ partnerCode: ven.code, date:'2026-08-24', vendorNo:'AUD-SPLIT-1',
    lines:[{ desc:'ค่าที่ปรึกษา', qty:1, price:'1500', expenseSub:'admin_expense' }], whtCode:'WHT_PROF' });
  const s1 = A.payBill({ date:'2026-08-25', billNo: sp.no, amount:'802.50', channel:'manual' });
  const s2 = A.payBill({ date:'2026-08-26', billNo: sp.no, channel:'manual' });
  ok('★ แบ่งจ่ายสองงวด งวดละไม่ถึง 1,000 บาท ยังต้องหัก ณ ที่จ่ายรวม 45.00', s1.wht + s2.wht === Mx('45'), A.fmt(s1.wht) + ' + ' + A.fmt(s2.wht));

  // 10) นำส่งภาษีเดือนธันวาคม
  const dbill = A.recordBill({ partnerCode: ven.code, date:'2026-12-10', vendorNo:'AUD-DEC-1',
    lines:[{ desc:'ค่าบริการขนส่ง', qty:1, price:'20000', expenseSub:'admin_expense' }], whtCode:'WHT_TRANSPORT' });
  A.payBill({ date:'2026-12-15', billNo: dbill.no, channel:'manual' });
  let fd = null; try { fd = A.fileWht('2026-12', ven.entityType === 'individual' ? 'PND3' : 'PND53'); } catch (e) { fd = e; }
  ok('★ ยื่นภาษีหัก ณ ที่จ่ายเดือนธันวาคมได้ ระบบเปิดงวดปีถัดไปให้เพื่อบันทึกการนำส่งเดือนมกราคม',
    fd && fd.entryNo && X.periods.some((p) => p.code === '2027-01'), fd && fd.message ? fd.message : fd.entryNo);

  // 11) เศษสตางค์และตัวเลขใหญ่
  ok('★ บรรทัดเกินร้อยล้านบาทคูณจำนวนแล้วยังถูกทุกสตางค์', A.mulQty(Mx('200000000.01'), '3') === Mx('600000000.03'));
  ok('แปลงตัวเลขข้อความเป็นเงินโดยไม่ผ่านทศนิยมลอยตัว', Mx('123456789.1234') === 1234567891234 && Mx('1.00005') === 10001 && Mx('-0.00005') === -1);
  const it = X.items.find((i) => i.type === 'stock' && i.qty === 0) || null;
  const item = A.saveItem({ name:'สินค้าทดสอบเศษ', type:'stock', uom:'ชิ้น', price:'50' }).item;
  const code = item.code;
  A.recordBill({ partnerCode: ven.code, date:'2026-08-27', vendorNo:'AUD-STK-1', lines:[{ desc:'ซื้อ', qty:3, price:'33.3367', itemCode: code, expenseSub:'inventory' }] });
  [1, 2, 3].forEach((k) => A.issueInvoice({ partnerCode: cust.code, date:'2026-08-28', lines:[{ desc:'ขายชิ้นที่ ' + k, qty:1, price:'50', itemCode: code, taxCode:'VAT7' }] }));
  ok('★ ขายของหมดคลังแล้วมูลค่าคงเหลือเป็นศูนย์พอดี ไม่มีเศษสตางค์ค้าง', item.qty === 0 && item.value === 0, item.qty + ' / ' + A.fmt(item.value));
  throws('★ ขายเกินจำนวนในคลังไม่ได้', () => A.issueInvoice({ partnerCode: cust.code, date:'2026-08-28', lines:[{ desc:'ขายเกิน', qty:1, price:'50', itemCode: code, taxCode:'VAT7' }] }), 'INSUFFICIENT_STOCK');
  A.recordBill({ partnerCode: ven.code, date:'2026-08-27', vendorNo:'AUD-STK-2', lines:[
    { desc:'ซื้อ ก', qty:0.1, price:'10', itemCode: code, expenseSub:'inventory' }, { desc:'ซื้อ ข', qty:0.2, price:'10', itemCode: code, expenseSub:'inventory' }] });
  A.issueInvoice({ partnerCode: cust.code, date:'2026-08-28', lines:[{ desc:'ขาย', qty:0.3, price:'50', itemCode: code, taxCode:'VAT7' }] });
  ok('จำนวนทศนิยม 0.1 + 0.2 − 0.3 เหลือศูนย์จริง ไม่ใช่ 5.55e-17', item.qty === 0 && item.value === 0, String(item.qty));

  // 12) คำสั่งที่ล้มไม่ทำให้เลขที่ขาดช่วง
  const seq0 = JSON.stringify(X.seq), n0 = X.entries.length;
  throws('บรรทัดที่ปัดแล้วเป็นศูนย์ ลงบัญชีไม่ได้', () => A.issueInvoice({ partnerCode: cust.code, date:'2026-08-29', lines:[{ desc:'เล็กมาก', qty:0.001, price:'0.01', taxCode:'EXEMPT' }] }), 'ENTRY_TOO_FEW_LINES');
  ok('★ คำสั่งที่ล้มกลางทาง เลขที่เอกสารและใบสำคัญไม่ถูกจองทิ้ง', JSON.stringify(X.seq) === seq0 && X.entries.length === n0);

  // 13) ประมาณการหัก ณ ที่จ่ายของใบเตรียมจ่ายตามช่องทางจริง
  const eb = A.recordBill({ partnerCode: ven.code, date:'2026-08-29', vendorNo:'AUD-PB-1',
    lines:[{ desc:'ค่าบริการ', qty:1, price:'10000', expenseSub:'admin_expense' }], whtCode:'WHT_SERVICE' });
  ok('ประมาณการหัก ณ ที่จ่ายตามช่องทาง: หักเอง 3% · e-WHT 1%', A.estimateBillWht(eb, eb.total, '2026-08-30') === Mx('300')
    && A.estimateBillWht(eb, eb.total, '2026-08-30', 'e_wht') === Mx('100'));

  // 14) รับคืนสินค้าตามใบลดหนี้ — ของกลับเข้าคลังด้วยต้นทุนเดิม
  const st = X.items.find((i) => i.type === 'stock' && i.qty >= 10 && i.code !== code);
  const q0 = st.qty, v0 = st.value;
  const si = A.issueInvoice({ partnerCode: cust.code, date:'2026-08-20', lines:[{ desc: st.name, qty:4, price:'2000', itemCode: st.code, taxCode:'VAT7' }] });
  const sold = X.docs.stockMove.find((m) => m.src === si.no).cost;
  const rc = A.issueCreditNote({ date:'2026-08-21', invoiceNo: si.no, base:'4000', reason:'RETURN_DEFECT', returnLines:[{ itemCode: st.code, qty:2 }] });
  ok('★ รับคืนสินค้าตามใบลดหนี้ ของกลับเข้าคลังด้วยต้นทุนเดิมครึ่งหนึ่งพอดี และกลับต้นทุนขาย', st.qty === q0 - 2 && rc.returns[0].cost * 2 === sold && !!rc.cogsEntryNo,
    'ต้นทุนรับคืน ' + A.fmt(rc.returns[0].cost) + ' จาก ' + A.fmt(sold));
  throws('รับคืนเกินที่ขาย', () => A.issueCreditNote({ date:'2026-08-21', invoiceNo: si.no, base:'100', reason:'RETURN_DEFECT', returnLines:[{ itemCode: st.code, qty:3 }] }), 'RETURN_EXCEEDS_SOLD');
  const rc2 = A.issueCreditNote({ date:'2026-08-22', invoiceNo: si.no, base:'4000', reason:'RETURN_DEFECT', returnLines:[{ itemCode: st.code, qty:2 }] });
  ok('★ รับคืนครบทุกชิ้นแล้ว สต๊อกและมูลค่ากลับเท่าก่อนขายพอดี', st.qty === q0 && st.value === v0);
  A.voidDocument('creditNote', rc2.no, 'ทดสอบยกเลิกใบลดหนี้รับคืน');
  ok('ยกเลิกใบลดหนี้รับคืน ของออกจากคลังอีกครั้ง', st.qty === q0 - 2);

  // ภาพรวมหลังทุกกรณี
  ok('★ หลังทุกกรณี ลูกหนี้ เจ้าหนี้ ภาษี พักรับสินค้า ตรงบัญชีคุมทุกตัว', recOk() === '', recOk());
  const stockSum = X.items.reduce((a, i) => a + i.value, 0);
  ok('★ มูลค่าสินค้าในทะเบียนรวมเท่าบัญชีสินค้าคงเหลือ', stockSum === gl('inventory', '2027-12-31'), A.fmt(stockSum) + ' vs ' + A.fmt(gl('inventory', '2027-12-31')));
  const nosA = X.entries.map((e) => e.no);
  ok('เลขที่ใบสำคัญไม่ซ้ำ', new Set(nosA).size === nosA.length);
}

console.log('\n=== 7.15 บัญชีค่าใช้จ่ายต้องลงถูกบัญชี — ไม่ปนกับเงินเดือน ===');
{
  const B = new Function(src + '\nreturn {DB,buildSeed,recordBill,runPayroll,convertTradeDoc,issueTradeDoc,loadState,balBySub,M,fmt,defaultAccountFor};')();
  B.buildSeed();
  const Y = B.DB;
  const ven = Y.partners.find((p) => p.kind === 'vendor' && p.taxId);
  const sal = (to, from) => B.balBySub(['salary_expense'], to || '2026-12-31', from);
  const salEntries = Y.entries.filter((e) => e.status === 'posted' && e.lines.some((l) => l.acc === '5311'));
  ok('★ บัญชี 5311 เงินเดือนและค่าจ้าง มีแต่รายการจากงวดเงินเดือน (และยอดยกมา) ไม่มีค่าเช่าหรือวัสดุปนเข้ามา',
    salEntries.every((e) => e.src === 'payroll' || e.src === 'opening' || e.type === 'opening' || e.src === 'import'),
    salEntries.filter((e) => e.src !== 'payroll' && e.type !== 'opening').map((e) => e.no + ' ' + e.desc).slice(0, 3).join(' · '));
  const rent = Y.entries.filter((e) => /ค่าเช่าอาคาร/.test(e.desc) || e.lines.some((l) => l.acc === '5321'));
  ok('ค่าเช่าสำนักงานลงบัญชี 5321 ค่าเช่าสำนักงาน', rent.length > 0 && Y.docs.bill.filter((b) => /TNP-69-/.test(b.vendorNo)).every((b) => b.lines[0].acc === '5321'));
  const b0 = sal('2026-08-31', '2026-08-01');
  const plain = B.recordBill({ partnerCode: ven.code, date:'2026-08-03', vendorNo:'ACC-T-1', lines:[{ desc:'ค่าใช้จ่ายทั่วไป', qty:1, price:'1000', expenseSub:'admin_expense' }] });
  ok('★ ตั้งหนี้แบบไม่ระบุบัญชี ค่าใช้จ่ายบริหารลงบัญชีเบ็ดเตล็ด 5358 ไม่ใช่บัญชีเงินเดือน', plain.lines[0].acc === '5358' && sal('2026-08-31', '2026-08-01') === b0);
  const chosen = B.recordBill({ partnerCode: ven.code, date:'2026-08-03', vendorNo:'ACC-T-2', lines:[{ desc:'ค่าไฟฟ้า', qty:1, price:'2000', acc:'5322' }] });
  ok('เลือกบัญชีค่าใช้จ่ายเจาะจงได้', chosen.lines[0].acc === '5322');
  throws('เลือกบัญชีลูกหนี้เป็นค่าใช้จ่ายไม่ได้', () => B.recordBill({ partnerCode: ven.code, date:'2026-08-03', vendorNo:'ACC-T-3', lines:[{ desc:'ผิดบัญชี', qty:1, price:'100', acc:'1131' }] }), 'BILL_ACCOUNT_INVALID');
  const stock = Y.items.find((i) => i.type === 'stock');
  throws('สินค้าคงคลังลงบัญชีค่าใช้จ่ายไม่ได้', () => B.recordBill({ partnerCode: ven.code, date:'2026-08-03', vendorNo:'ACC-T-4', lines:[{ desc: stock.name, qty:1, price:'100', acc:'5324', itemCode: stock.code }] }), 'BILL_STOCK_ACCOUNT');
  const run = B.runPayroll('2026-08');
  ok('★ เงินเดือนลงบัญชี 5311 เงินเดือนและค่าจ้าง', Y.entries.find((e) => e.no === run.entryNo).lines.some((l) => l.acc === '5311' && l.dr === run.gross));
  const po = B.issueTradeDoc('purchaseOrder', { partnerCode: ven.code, date:'2026-08-04', lines:[{ desc:'ค่าซ่อมแอร์', qty:1, price:'3000' }] });
  const pb = B.convertTradeDoc('purchaseOrder', po.no, { date:'2026-08-05', vendorNo:'ACC-T-5', acc:'5325' });
  ok('แปลงใบสั่งซื้อเป็นตั้งหนี้ เลือกบัญชีได้', pb.lines[0].acc === '5325');

  /* ข้อมูลรุ่นก่อน: 5311 ยังเป็นค่าใช้จ่ายบริหารทั่วไป */
  const old = JSON.parse(JSON.stringify(Y));
  old.accounts.find((a) => a.code === '5311').subType = 'admin_expense';
  B.loadState(old);
  ok('★ เปิดข้อมูลรุ่นก่อน ระบบแยกบัญชีเงินเดือนออกจากค่าใช้จ่ายบริหารให้เอง', B.DB.accounts.find((a) => a.code === '5311').subType === 'salary_expense'
    && B.DB.audit.some((a) => a.action === 'retype'));
  ok('ค่าใช้จ่ายบริหารปริยายหลังแยกแล้วคือ 5358 ค่าใช้จ่ายเบ็ดเตล็ด', B.defaultAccountFor('admin_expense') === '5358');
}

console.log('\n=== 7.16 รับสินค้าตามใบสั่งซื้อแบบทยอยรับ ===');
{
  const C = new Function(src + '\nreturn {DB,buildSeed,issueTradeDoc,receiveGoodsFromPo,billGoodsReceipt,voidDocument,convertTradeDoc,' +
    'setTradeDocStatus,poReceived,reconciliationChecks,balBySub,M,fmt};')();
  C.buildSeed();
  const Z = C.DB;
  const ven = Z.partners.find((p) => p.code === 'VEN-0004');
  const a = Z.items.find((i) => i.code === 'SW-220'), b = Z.items.find((i) => i.type === 'stock' && i.code !== 'SW-220');
  const qa = a.qty, qb = b.qty;
  const po = C.issueTradeDoc('purchaseOrder', { partnerCode: ven.code, date:'2026-07-20', lines:[
    { desc: a.name, qty: 100, price:'50', itemCode: a.code }, { desc: b.name, qty: 10, price:'200', itemCode: b.code }] });
  const g1 = C.receiveGoodsFromPo(po.no, { date:'2026-07-21', vendorDoNo:'DO-1', lines:[{ line:0, qty:60 }] });
  ok('★ รับบางส่วน: รับ 60 จาก 100 สต๊อกเพิ่มเท่าที่รับจริง ใบสั่งซื้อขึ้นว่ารับบางส่วน', a.qty === qa + 60 && b.qty === qb
    && po.status === 'partially_received' && g1.total === C.M('3000'), po.status);
  throws('★ รับเกินที่สั่งไม่ได้', () => C.receiveGoodsFromPo(po.no, { date:'2026-07-22', lines:[{ line:0, qty:41 }] }), 'GRN_PO_OVER_RECEIVE');
  throws('ตั้งหนี้จากใบสั่งซื้อที่รับไปบางส่วนแล้วตรง ๆ ไม่ได้', () => C.convertTradeDoc('purchaseOrder', po.no, { date:'2026-07-22', vendorNo:'X-1' }), 'PO_PARTIALLY_RECEIVED');
  const g2 = C.receiveGoodsFromPo(po.no, { date:'2026-07-23', vendorDoNo:'DO-2' });
  ok('★ รับส่วนที่เหลือครบ ใบสั่งซื้อปิดและชี้ไปที่ใบรับสินค้าทั้งสองใบ', po.status === 'closed' && po.convertedTo === g1.no + ', ' + g2.no
    && a.qty === qa + 100 && b.qty === qb + 10, po.convertedTo);
  ok('ยอดที่รับรวมทุกใบเท่ามูลค่าใบสั่งซื้อพอดี', g1.total + g2.total === po.base);
  C.billGoodsReceipt(g1.no, { date:'2026-07-24', vendorNo:'TPS-PART-1' });
  ok('★ ตั้งหนี้ทีละใบรับสินค้า บัญชีพักรับสินค้าเหลือเท่าใบที่ยังไม่ได้ตั้งหนี้', C.reconciliationChecks('2026-07-31').allPassed);
  C.voidDocument('goodsReceipt', g2.no, 'ของชุดที่สองผิดรุ่น ส่งคืน');
  ok('★ ยกเลิกใบรับสินค้าใบที่สอง ใบสั่งซื้อกลับมาค้างรับเฉพาะส่วนนั้น', po.status === 'partially_received'
    && C.poReceived(po).join(',') === '60,0' && a.qty === qa + 60, po.status + ' ' + C.poReceived(po).join(','));
  C.setTradeDocStatus('purchaseOrder', po.no, 'cancelled', 'ผู้ขายของหมด ยกเลิกส่วนที่เหลือ');
  throws('ยกเลิกส่วนที่เหลือแล้วรับต่อไม่ได้', () => C.receiveGoodsFromPo(po.no, { date:'2026-07-25' }), 'TRADE_DOC_NOT_ACTIVE');
  ok('กระทบยอดทุกตัวยังตรงหลังทยอยรับ ยกเลิก และตั้งหนี้', C.reconciliationChecks('2026-07-31').allPassed);
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

/* ยอดยกมา ณ 31 ธ.ค. เป็นยอดสะสมที่รวมเดือน พ.ย. ไว้แล้ว ลงทับยอดเคลื่อนไหว พ.ย. = นับซ้ำ ต้องถูกกันก่อนลงบัญชี */
throws('★ ยอดยกมาที่ทับยอดเคลื่อนไหวเดือนก่อนหน้าถูกกันตั้งแต่ก่อนลงบัญชี ไม่ปล่อยให้นับซ้ำ',
  () => ctx.importOpeningBalances(faTb.rows, '2026-12-31', {}), 'IMPORT_OVERLAP');
ctx.reverseImport(mov.entry.no, 'ทดสอบ: เปลี่ยนไปใช้ยอดยกมาแทน');
/* ยกเลิกแล้วต้องนำเข้าซ้ำวันเดิมได้ ไม่ถูกกันว่าซ้ำ */
const again = ctx.importOpeningBalances(faTb.rows, '2026-12-31', {});
ok('★ ยกเลิกแล้วนำเข้าวันเดิมใหม่ได้ ไม่ติดว่าซ้ำ', !!again.entry.no, again.entry.no);
ok('คราวนี้ไม่ต้องสร้างบัญชีใหม่แล้ว เพราะรหัสเดิมอยู่ในผังแล้ว', again.created === 0);

console.log('\n=== 10.1 ตรวจตัวเลขที่นำเข้าเทียบกับไฟล์ต้นทาง ===');
{
  const opening = ctx.importFor('opening', '2026-12-31');
  const v = ctx.verifyAgainstFile(faTb.rows, {}, opening.no, faTb.skipped);
  ok('★ ลากไฟล์เดิมเข้ามาเทียบ ตรงกันทุกบัญชีทุกสตางค์', v.ok && v.bad.length === 0 && v.rows.length === faTb.rows.length,
    v.rows.length + ' บัญชี · ข้าม ' + v.skipped.length + ' บรรทัด');
  ok('การตรวจเทียบไม่ลงบัญชีอะไรเพิ่ม', ctx.listImports().length === 3);
  const tampered = faTb.rows.map((r, i) => i === 2 ? Object.assign({}, r, { debit: r.debit ? r.debit + ctx.M('0.01') : r.debit,
    credit: r.credit ? r.credit + ctx.M('0.01') : r.credit }) : r);
  const v2 = ctx.verifyAgainstFile(tampered, {}, opening.no, []);
  ok('★ ตัวเลขในไฟล์ต่างจากที่นำเข้าแค่ 1 สตางค์ ระบบชี้ได้ว่าบัญชีไหน', !v2.ok && v2.bad.length === 1
    && Math.abs(v2.bad[0].diff) === ctx.M('0.01'), v2.bad.map((x) => x.code + ' ต่าง ' + ctx.fmt(x.diff)).join(' · '));
  const missing = faTb.rows.concat([{ code:'11999', name:'บัญชีที่ไม่ได้นำเข้า', debit: ctx.M('100'), credit: 0 }]);
  const v3 = ctx.verifyAgainstFile(missing, {}, opening.no, []);
  ok('บรรทัดที่มีในไฟล์แต่ไม่เคยนำเข้า ถูกจับได้', v3.bad.some((x) => x.code === '11999' && x.status === 'no_account'));
  /* ข้อมูลที่นำเข้าไว้ก่อนมีด่านกันนับซ้ำ — จำลองใบยอดเคลื่อนไหวแบบเก่าที่ซ้อนอยู่ ตรวจสุขภาพต้องยังจับได้ */
  const legacy = ctx.post({ type:'general', date:'2026-11-30', desc:'ยอดเคลื่อนไหวจากระบบเดิม (ข้อมูลรุ่นก่อน)',
    src:'import', srcId:'movement|2026-11', lines: mov.entry.lines.map((l) => ({ acc:l.acc, dr:l.dr, cr:l.cr, partner:l.partner })) });
  const h = ctx.importHealth('2026-12-31');
  ctx.reverseImport(legacy.no, 'ทดสอบ: ล้างใบจำลอง');
  ok('★ ตรวจสุขภาพจับได้ว่ายอดยกมา (ยอดสะสม) กับยอดเคลื่อนไหวเดือนก่อนหน้าซ้อนกัน อาจนับซ้ำ',
    h.items.some((x) => x.level === 'bad' && x.title.indexOf('อาจนับซ้ำ') === 0), h.items.filter((x) => x.level !== 'ok').map((x) => x.title).join(' | '));
  ok('ตรวจสุขภาพบอกว่ายอดยกมามีบัญชีรายได้/ค่าใช้จ่าย ทำให้งบกำไรขาดทุนเดือนนั้นรวมยอดก่อนวันตัดยอด',
    h.items.some((x) => x.level === 'warn' && x.title.indexOf('มีบัญชีรายได้และค่าใช้จ่าย') >= 0));
  ok('ตรวจสุขภาพยืนยันว่างบทดลองและงบแสดงฐานะการเงินสมดุล', h.items.some((x) => x.level === 'ok' && x.title === 'งบทดลองสมดุล')
    && h.items.some((x) => x.level === 'ok' && x.title === 'งบแสดงฐานะการเงินสมดุล'));
  ok('ยอดเจ้าหนี้ที่ยกมาไม่มีใบค้างรองรับ ตรวจสุขภาพบอกวิธีแก้', h.items.some((x) => x.level === 'bad' && /เจ้าหนี้/.test(x.title) && /รายใบ/.test(x.fix)));
}

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

/* ===================================================================
   10.2 ผลตรวจสอบเส้นทางนำเข้า — ทุกข้อที่เคยทำให้ตัวเลขผิดโดยไม่มีอะไรเตือน
   =================================================================== */
console.log('\n=== 10.2 นำเข้า: เลือกชุดตัวเลขให้ถูก (ยกมา · เคลื่อนไหว · คงเหลือ) ===');
const fresh = () => ctx.buildBlank({ name: 'บริษัท ทดสอบนำเข้า จำกัด', year: 2026 });
/* ทำแบบเดียวกับหน้าจอ: อ่านไฟล์ → เดาคอลัมน์ → เลือกชุดตามแบบการนำเข้า → อ่านงบทดลอง → ตรวจไฟล์ */
function readTb(text, mode) {
  const rows = ctx.parseCsv(text);
  const det = ctx.detectColumns(rows);
  const map = Object.assign({}, det.map);
  if (mode === 'movement') { const s = ctx.defaultSet(det.sets, 'movement'); map.debit = s ? s.debit : undefined; map.credit = s ? s.credit : undefined; }
  const tb = map.debit === undefined && map.credit === undefined ? null : ctx.readTrialBalance(rows, map, det.headerRow);
  const dates = ctx.readFileDates(rows, det.headerRow);
  const checks = (o) => ctx.tbFileChecks(Object.assign({ rows, headerRow: det.headerRow, map, sets: det.sets, tb,
    mode: mode || 'opening', dates }, o || {}));
  return { rows, det, map, tb, dates, checks };
}
const assetsAt = (d) => ctx.balanceSheet(d).assets;
const T = (lines) => ['งบทดลอง', 'ณ วันที่ 30/06/2569'].concat(lines).join('\n');

{
  fresh();
  /* Express: ยอดยกมา (คอลัมน์เดียว) | เดบิต | เครดิต | ยอดคงเหลือ (คอลัมน์เดียว) — คู่กลางคือยอดเคลื่อนไหว */
  const r = readTb(T(['รหัสบัญชี,ชื่อบัญชี,ยอดยกมา,เดบิต,เครดิต,ยอดคงเหลือ',
    '11111,เงินสด,"20,000.00","10,000.00","5,000.00","25,000.00"',
    '11122.01,ธนาคาร,"300,000.00","400,000.00","225,000.00","475,000.00"',
    '21311,เจ้าหนี้การค้า,"-150,000.00","225,000.00","375,000.00","-300,000.00"',
    '31110,ทุน,"-170,000.00",,"30,000.00","-200,000.00"']));
  ok('★ หัวตารางแบบ Express: ไม่หยิบคู่เดบิต/เครดิตกลาง (ยอดเคลื่อนไหว) มาเป็นยอดยกมา',
    r.det.sets.map((x) => x.role).join(',') === 'opening,movement,closing' && r.map.debit === 5 && r.map.credit === undefined,
    r.det.sets.map((x) => x.label + ':' + x.role).join(' · '));
  ctx.importOpeningBalances(r.tb.rows, '2026-06-30', {}, { checks: r.checks({ date: '2026-06-30' }) });
  ok('★ ยอดสินทรัพย์ตรงกับไฟล์ (500,000) ไม่ใช่ยอดเคลื่อนไหว (180,000)', assetsAt('2026-06-30') === ctx.M('500000'), ctx.fmt(assetsAt('2026-06-30')));
  ok('ยกมา + เคลื่อนไหว = คงเหลือ ครบทุกบัญชี ยืนยันว่าอ่านบทบาทคอลัมน์ถูก',
    r.checks({ date: '2026-06-30' }).some((c) => c.code === 'SET_IDENTITY' && c.level === 'ok'));
}
{
  fresh();
  const r = readTb(T(['Account Code,Account Name,Balance b/f Dr,Balance b/f Cr,Debit,Credit,Balance c/f Dr,Balance c/f Cr',
    '11111,Cash,"20,000.00",,"10,000.00","5,000.00","25,000.00",', '11122.01,Bank,"300,000.00",,"400,000.00","225,000.00","475,000.00",',
    '21311,Trade payables,,"150,000.00","225,000.00","375,000.00",,"300,000.00"', '31110,Capital,,"170,000.00",,"30,000.00",,"200,000.00"']));
  ok('★ ภาษาอังกฤษ "Balance b/f" คือยอดยกมา ไม่ใช่ยอดคงเหลือ — เลือก "Balance c/f"',
    r.map.debit === 6 && r.map.credit === 7, r.det.sets.map((x) => x.label + ':' + x.role).join(' · '));
  const two = readTb(T(['รหัสบัญชี,ชื่อบัญชี,ยอดยกมา,,ยอดคงเหลือ', ',,เดบิต,เครดิต,',
    '11111,เงินสด,"20,000.00",,"25,000.00"', '21311,เจ้าหนี้,,"20,000.00","-25,000.00"']));
  ok('หัวสองชั้น: คู่ "ยอดยกมา" กับคอลัมน์ยอดคงเหลือเดียว → ใช้ยอดคงเหลือ',
    two.map.debit === 4 && two.map.credit === undefined && two.tb.rows[0].debit === ctx.M('25000'));
  const amb = readTb(T(['รหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต,เดบิต,เครดิต',
    '11111,เงินสด,100,,150,', '31110,ทุน,,100,,150']));
  ok('★ สองคู่ที่ไม่มีชื่อบอกบทบาท ระบบไม่เดา ให้ผู้ใช้เลือกเอง', amb.det.needsSet && amb.map.debit === undefined);
  const mv = readTb(T(['รหัสบัญชี,ชื่อบัญชี,ยอดยกมา เดบิต,ยอดยกมา เครดิต,ยอดประจำงวด เดบิต,ยอดประจำงวด เครดิต,ยอดสะสม เดบิต,ยอดสะสม เครดิต',
    '11111,เงินสด,100,,50,,150,', '31110,ทุน,,100,,50,,150']), 'movement');
  ok('แบบยอดเคลื่อนไหว เลือกชุดยอดประจำงวดให้เอง', mv.map.debit === 4 && mv.map.credit === 5);
  const wrong = readTb(T(['รหัสบัญชี,ชื่อบัญชี,ยอดยกมา เดบิต,ยอดยกมา เครดิต,ยอดประจำงวด เดบิต,ยอดประจำงวด เครดิต,ยอดสะสม เดบิต,ยอดสะสม เครดิต',
    '11111,เงินสด,100,,50,,999,', '31110,ทุน,,100,,50,,999']));
  ok('★ ยกมา + เคลื่อนไหว ≠ คงเหลือ ต้องยืนยันก่อนนำเข้า', wrong.checks({ date: '2026-06-30' }).some((c) => c.code === 'SET_IDENTITY' && c.level === 'bad'));
  const cum = mv.checks({ mode: 'movement', period: '2026-06', date: '2026-06-30', map: { code: 0, name: 1, debit: 6, credit: 7 } });
  ok('★ เลือกชุดยอดสะสมแต่จะลงเป็นยอดเคลื่อนไหว ต้องยืนยันก่อน (นับซ้ำกับเดือนก่อน)', cum.some((c) => c.code === 'SET_ROLE' && c.level === 'bad'));
}

console.log('\n=== 10.3 นำเข้า: บรรทัดที่ไม่ใช่บัญชี ยอดรวมท้ายไฟล์ และตัวเลขแปลก ๆ ===');
{
  fresh();
  const H = ['งบทดลอง', 'ณ วันที่ 30 มิถุนายน 2569', 'รหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต'];
  const LEAF = ['11111,เงินสด,"25,000.00",', '11122.01,ธนาคารกสิกรไทย ออมทรัพย์,"475,000.00",', '12611,อาคาร,"600,000.00",',
    '18611,ค่าเสื่อมราคาสะสม - อาคาร,,"100,000.00"', '21311,เจ้าหนี้การค้า,,"300,000.00"', '31110,ทุนเรือนหุ้น,,"500,000.00"',
    '41110,รายได้จากการขาย,,"400,000.00"', '53011,เงินเดือน,"200,000.00",'];
  const par = readTb(H.concat(['10000,สินทรัพย์,"1,000,000.00",', LEAF[0], LEAF[1], LEAF[2], LEAF[3],
    '20000,หนี้สิน,,"300,000.00"', LEAF[4], '30000,ส่วนของผู้ถือหุ้น,,"500,000.00"', LEAF[5],
    '40000,รายได้,,"400,000.00"', LEAF[6], '50000,ค่าใช้จ่าย,"200,000.00",', LEAF[7]]).join('\n'));
  ok('★ บัญชีหัวข้อที่พิมพ์ยอดรวมของบัญชีย่อยถูกข้าม ไม่นับซ้ำสองเท่า', par.tb.rows.length === 8 && par.tb.parents.length === 5,
    par.tb.parents.map((r) => r.code).join(','));
  ctx.importOpeningBalances(par.tb.rows, '2026-06-30', {});
  ok('★ สินทรัพย์รวม 1,000,000 ตามไฟล์ ไม่ใช่ 2,000,000', assetsAt('2026-06-30') === ctx.M('1000000'), ctx.fmt(assetsAt('2026-06-30')));
  ok('ภาษีเงินฝากธนาคารที่ชื่อบอกว่าเป็นธนาคาร ไปอยู่บรรทัดเงินสดและเงินฝาก', ctx.acc('11122.01').subType === 'bank');

  const sub = readTb(H.concat([',หมวด 1 สินทรัพย์,,', LEAF[0], LEAF[1], LEAF[2], LEAF[3], ',รวมสินทรัพย์,"1,100,000.00","100,000.00"',
    ',ยอดยกไป,"1,100,000.00","100,000.00"', ',ยอดยกมา,"1,100,000.00","100,000.00"', LEAF[4], LEAF[5], ',Subtotal,,"800,000.00"',
    LEAF[6], LEAF[7], ',สินทรัพย์รวม,"1,000,000.00",', ',Grand Total,"1,300,000.00","1,300,000.00"']).join('\n'));
  ok('★ บรรทัดรวมย่อย ยอดยกไป–ยกมาระหว่างหน้า หัวหมวด ถูกข้ามทั้งหมด', sub.tb.rows.length === 8 && sub.tb.skipped.length === 6,
    sub.tb.skipped.map((x) => x.name).join(' · '));
  ok('★ ผลรวมทุกบรรทัดเทียบกับบรรทัดรวมท้ายไฟล์ (Grand Total) ตรงทุกสตางค์', sub.checks({ date: '2026-06-30' }).some((c) => c.code === 'CONTROL_TOTAL' && c.level === 'ok'));
  const dup = readTb(H.concat(LEAF).concat([LEAF[1], ',รวมทั้งสิ้น,"1,300,000.00","1,300,000.00"']).join('\n'));
  const dc = dup.checks({ date: '2026-06-30' });
  ok('★ บัญชีซ้ำในไฟล์ถูกจับได้ทั้งจากรหัสซ้ำและยอดรวมท้ายไฟล์ไม่ตรง',
    dc.some((c) => c.code === 'DUPLICATE_CODE' && c.level === 'bad') && dc.some((c) => c.code === 'CONTROL_TOTAL' && c.level === 'bad'));

  ok('ขีดแทนศูนย์ทุกแบบ (- – — −) อ่านเป็นศูนย์', ['-', '–', '—', '−'].every((x) => ctx.parseAmount(x) === '0'));
  ok('ลบท้าย / เครื่องหมายลบยูนิโค้ด / บาท / Cr ท้ายตัวเลข',
    ctx.parseAmount('1,234.56-') === '-1234.56' && ctx.parseAmount('−500') === '-500'
    && ctx.parseAmount('1,000.00 บาท') === '1000.00' && ctx.parseAmount('300,000.00 Cr') === '-300000.00'
    && ctx.parseAmount('300,000.00 Dr') === '300000.00');
  ok('ทศนิยมแบบยุโรป 1.234,56 = 1234.56 ไม่ใช่ 1.23456', ctx.parseAmount('1.234,56') === '1234.56' && ctx.parseAmount('1,234') === '1234');
  ok('★ ปัดเป็นสตางค์ตรงจากตัวอักษร ไม่ปัดสองต่อ', ctx.satangOf('1234.56499') === ctx.M('1234.56')
    && ctx.satangOf('100.005') === ctx.M('100.01') && ctx.satangOf('186180.004') === ctx.M('186180.00')
    && ctx.satangOf('499999.9999999999') === ctx.M('500000'));
  const rnd = readTb(H.concat(['11311,ลูกหนี้การค้า,186180.004,', '31110,ทุน,,186180.00']).join('\n'));
  ok('★ ยอดที่มีทศนิยมเกินสองตำแหน่งปัดเป็นสตางค์ตอนอ่าน และบอกผู้ใช้ว่าบรรทัดไหน',
    rnd.tb.rows[0].debit === ctx.M('186180') && rnd.tb.rounded.length === 1 && rnd.checks({ date: '2026-06-30' }).some((c) => c.code === 'ROUNDED'));
  const csv = ctx.parseCsv('หัว\n\n\nรหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต\n11111,เงินสด,abc,\n');
  const ln = ctx.readTrialBalance(csv, { code: 0, name: 1, debit: 2, credit: 3 }, 1);
  ok('เลขแถวที่ข้ามตรงกับแถวจริงในไฟล์ (นับแถวว่างด้วย)', ln.skipped[0].line === 5 && ln.skipped[0].bad, 'แถว ' + ln.skipped[0].line);
  const tis = Buffer.from([0xa1, 0xd2, 0xc3]);              // "การ" ในรหัส Windows-874
  ok('ไฟล์ CSV ภาษาไทยแบบ Windows-874 อ่านออก ไม่เป็นตัวเพี้ยน', ctx.decodeText(tis) === 'การ');
  const one = readTb(T(['บัญชี,เดบิต,เครดิต', '11111 เงินสดในมือ,"25,000.00",', '31110 ทุน,,"25,000.00"']));
  ok('รหัสกับชื่อบัญชีอยู่ช่องเดียวกัน แยกออกให้', one.tb.rows[0].code === '11111' && one.tb.rows[0].name === 'เงินสดในมือ');
  const d1 = ctx.readFileDates(ctx.parseCsv('งบทดลอง\nตั้งแต่ 01/01/2569 ถึง 30/06/2569\nรหัส,ชื่อ,เดบิต,เครดิต'), 2);
  const d2 = ctx.readFileDates(ctx.parseCsv('งบทดลอง\nณ วันที่ 31 ธ.ค. 2568\nรหัส,ชื่อ,เดบิต,เครดิต'), 2);
  ok('อ่านวันที่ของรายงานจากหัวไฟล์ได้ทั้งแบบตัวเลขและชื่อเดือนไทย',
    d1 && d1.from === '2026-01-01' && d1.to === '2026-06-30' && d2 && d2.to === '2025-12-31', JSON.stringify([d1, d2]));
  ok('★ วันตัดยอดไม่ตรงกับวันที่ในไฟล์ ต้องยืนยันก่อน',
    par.checks({ date: '2026-06-01' }).some((c) => c.code === 'FILE_DATE' && c.level === 'bad')
    && !par.checks({ date: '2026-06-30' }).some((c) => c.code === 'FILE_DATE'));
}

console.log('\n=== 10.4 นำเข้า: กันนับซ้ำ และจับคู่บัญชีต้องเป็นประเภทเดียวกัน ===');
{
  fresh();
  const tb = [{ code: '11111', name: 'เงินสด', debit: ctx.M('1000'), credit: 0 }, { code: '31110', name: 'ทุน', debit: 0, credit: ctx.M('1000') }];
  const mv = [{ code: '11111', name: 'เงินสด', debit: ctx.M('100'), credit: 0 }, { code: '41110', name: 'รายได้', debit: 0, credit: ctx.M('100') }];
  ctx.importOpeningBalances(tb, '2026-01-01', {});
  const jan = ctx.importPeriodMovement(mv, '2026-01', {});
  ok('ยอดยกมาวันที่ 1 ม.ค. (ยอดต้นปี) + ยอดเคลื่อนไหวเดือน ม.ค. ใช้ด้วยกันได้', !!jan.entry.no);
  throws('★ ยอดยกมาใบที่สองถูกกัน (ยอดคงเหลือจะเป็นสองเท่า)', () => ctx.importOpeningBalances(tb, '2026-06-30', {}), 'IMPORT_OVERLAP');
  const jun = ctx.importOpeningBalances; void jun;
  fresh();
  ctx.importOpeningBalances(tb, '2026-06-30', {});
  throws('★ ยอดเคลื่อนไหวของเดือนที่อยู่ในยอดยกมาแล้วถูกกัน', () => ctx.importPeriodMovement(mv, '2026-05', {}), 'IMPORT_OVERLAP');
  throws('ยอดเคลื่อนไหวเดือนเดียวกับวันตัดยอด (ยอดสะสมถึงสิ้นเดือน) ถูกกัน', () => ctx.importPeriodMovement(mv, '2026-06', {}), 'IMPORT_OVERLAP');
  ok('ยอดเคลื่อนไหวเดือนถัดจากวันตัดยอดลงได้', !!ctx.importPeriodMovement(mv, '2026-07', {}).entry.no);

  fresh();
  const p = ctx.previewOpening([
    { code: '27130', name: 'ภาษีเงินได้นิติบุคคล', debit: 0, credit: ctx.M('185000') },
    { code: '21990', name: 'บัญชีพัก', debit: 0, credit: ctx.M('15000') },
    { code: '2131', name: 'เจ้าหนี้การค้า', debit: 0, credit: ctx.M('50000') },
    { code: '11111', name: 'เงินสด', debit: ctx.M('250000'), credit: 0 },
  ], {});
  const by = (c) => p.creating.concat(p.matched).concat(p.unmatched).find((r) => r.code === c);
  ok('★ "27130 ภาษีเงินได้นิติบุคคล" (หนี้สิน) ไม่ถูกรวมเข้าค่าใช้จ่ายภาษีเงินได้ที่ชื่อเหมือนกัน',
    by('27130').subType === 'cit_payable' && by('27130').type === 'liability');
  ok('★ "21990 บัญชีพัก" (หนี้สิน) ไม่ถูกรวมเข้าบัญชีพักฝั่งสินทรัพย์', by('21990').type === 'liability' && !by('21990').target);
  ok('★ "2131 เจ้าหนี้การค้า" ไม่ถูกรวมเข้า 2131 ค่าใช้จ่ายค้างจ่ายของระบบ ให้ผู้ใช้เลือกเองพร้อมเหตุผล',
    p.unmatched.some((r) => r.code === '2131' && /2131/.test(r.reason || '')));
  ok('ปลายทางที่ผู้ใช้เลือกเองคนละประเภทกับรหัสเดิม มีคำเตือนกำกับ',
    !!ctx.previewOpening([{ code: '21990', name: 'บัญชีพัก', debit: 0, credit: 1 }], { '21990': '1111' }).matched[0].typeWarn);
}

console.log('\n=== 10.5 นำเข้า: ทำเป็นชุดเดียว ยกเลิกแล้วกลับครบ ===');
{
  fresh();
  const before = ctx.DB.accounts.length;
  ok('รหัสบัญชีหัวข้อของระบบ (1000) ไม่ถูกจับคู่ ให้ผู้ใช้เลือกเองตั้งแต่หน้าตรวจ', ctx.previewOpening([
    { code: '1000', name: 'หมวดสินทรัพย์', debit: ctx.M('100'), credit: 0 }], {}).unmatched.length === 1);
  /* ลงบัญชีไม่ผ่านตอนท้าย (งวดปิดแล้ว) หลังสร้างบัญชีใหม่ไปแล้ว — ต้องย้อนทั้งหมด */
  ctx.DB.periods.find((x) => x.code === '2026-06').status = 'closed';
  throws('งวดปิดแล้ว นำเข้าไม่ได้', () => ctx.importOpeningBalances([
    { code: '11111', name: 'เงินสด', debit: ctx.M('200'), credit: 0 },
    { code: '31110', name: 'ทุน', debit: 0, credit: ctx.M('200') }], '2026-06-30', {}), 'PERIOD_CLOSED');
  ctx.DB.periods.find((x) => x.code === '2026-06').status = 'open';
  ok('★ นำเข้าไม่ผ่านแล้วไม่มีบัญชีค้างอยู่ในผัง (ทำเป็นชุดเดียว)', ctx.DB.accounts.length === before, before + ' → ' + ctx.DB.accounts.length);

  /* ยกเลิกแล้วเลือกบรรทัดงบใหม่ ต้องย้ายหมวดตาม */
  const rows = [{ code: '11319', name: 'ลูกหนี้อื่น', debit: ctx.M('500'), credit: 0 }, { code: '31110', name: 'ทุน', debit: 0, credit: ctx.M('500') }];
  const first = ctx.importOpeningBalances(rows, '2026-06-30', {});
  ctx.reverseImport(first.entry.no, 'ทดสอบ: เลือกบรรทัดงบใหม่');
  ctx.importOpeningBalances(rows, '2026-06-30', { '11319': '+other_current_asset' });
  ok('★ นำเข้าใหม่หลังยกเลิก บรรทัดงบที่แก้แล้วมีผลจริง', ctx.acc('11319').subType === 'other_current_asset');
  ok('ค่าเผื่อหนี้สงสัยจะสูญใต้ 1131 แยกเป็นบัญชีปรับมูลค่า ไม่ปนในบัญชีคุมลูกหนี้',
    ctx.proposeAccount('11319', 'ค่าเผื่อหนี้สงสัยจะสูญ').subType === 'ar_allowance'
    && ctx.proposeAccount('11313', 'เช็ครับลงวันที่ล่วงหน้า').subType === 'other_receivable');
  ok('12xxx เป็นสินทรัพย์ไม่หมุนเวียน', ctx.proposeAccount('12810', 'เงินมัดจำระยะยาว').subType === 'other_asset');

  /* ยกเลิกการนำเข้าแล้ว ยอดคุมภาษีของงวดต้องยังตรง ปิดงวดได้ */
  fresh();
  const v = ctx.importOpeningBalances([
    { code: '11111', name: 'เงินสด', debit: ctx.M('10700'), credit: 0 },
    { code: '27111', name: 'ภาษีขาย', debit: 0, credit: ctx.M('700') },
    { code: '17113', name: 'ภาษีซื้อ', debit: ctx.M('350'), credit: 0 },
    { code: '31110', name: 'ทุน', debit: 0, credit: ctx.M('10350') }], '2026-06-30', {});
  ctx.reverseImport(v.entry.no, 'ทดสอบ: ยกเลิกการนำเข้า');
  const rc = ctx.reconciliationChecks('2026-06-30').checks;
  ok('★ ยกเลิกการนำเข้าแล้ว ภาษีขาย/ภาษีซื้อของงวดยังตรงกับทะเบียน (ไม่บล็อกปิดงวด)',
    rc.find((c) => c.code === 'OUTPUT_VAT').ok && rc.find((c) => c.code === 'INPUT_VAT').ok);
  ok('★ บริษัทที่ไม่มีทรัพย์สินในทะเบียน ข้อค่าเสื่อมราคาไม่บล็อกการปิดงวด',
    ctx.closeChecklist('2026-06').items.find((i) => /ค่าเสื่อม/.test(i.label)).ok);
}

console.log('\n=== 10.6 หลังเริ่มใช้ระบบ: เอกสารใหม่ลงบัญชีเดิม งบกระแสเงินสด งบส่วนของผู้ถือหุ้น ===');
{
  fresh();
  const tb = [
    { code: '11122.01', name: 'กสิกรไทย ออมทรัพย์', debit: ctx.M('500000'), credit: 0 },
    { code: '11311', name: 'ลูกหนี้การค้า - ทั่วไป', debit: ctx.M('107000'), credit: 0 },
    { code: '12611', name: 'อาคาร', debit: ctx.M('600000'), credit: 0 },
    { code: '21311', name: 'เจ้าหนี้การค้า - ทั่วไป', debit: 0, credit: ctx.M('100000') },
    { code: '31110', name: 'ทุนเรือนหุ้น', debit: 0, credit: ctx.M('900000') },
    { code: '41110', name: 'รายได้จากการขาย', debit: 0, credit: ctx.M('407000') },
    { code: '53011', name: 'เงินเดือน', debit: ctx.M('200000'), credit: 0 },
  ];
  const o = ctx.importOpeningBalances(tb, '2026-06-30', {});
  ok('★ บัญชีคุมที่ยกมาเป็นบัญชีหลักต่อจากนี้ (ลูกหนี้ เจ้าหนี้ ธนาคาร)',
    ctx.accBySub('trade_receivable') === '11311' && ctx.accBySub('trade_payable') === '21311' && ctx.accBySub('bank') === '11122.01',
    o.defaults.map((d) => d.sub + '→' + d.code).join(' '));
  const cf = ctx.cashFlow('2026-01-01', '2026-12-31');
  ok('★ งบกระแสเงินสด: เงินสดในใบยอดยกมาเป็นเงินสดต้นงวด ไม่ใช่เงินได้จากกิจกรรมลงทุน',
    cf.opening === ctx.M('500000') && cf.investing === 0 && cf.unexplained === 0, 'ต้นงวด ' + ctx.fmt(cf.opening) + ' ลงทุน ' + ctx.fmt(cf.investing));
  const is = ctx.incomeStatement('2026-01-01', '2026-12-31'), eq = ctx.equityStatement('2026-01-01', '2026-12-31');
  ok('★ กำไรสุทธิในงบส่วนของผู้ถือหุ้นเท่ากับงบกำไรขาดทุน', eq.net === is.net && is.net === ctx.M('207000') && eq.matchesBs, ctx.fmt(eq.net) + ' / ' + ctx.fmt(is.net));

  /* งบทดลองสิ้นปีก่อน ลงวันแรกของปีนี้ — กำไรขาดทุนปีก่อนต้องเข้ากำไรสะสม ไม่ใช่กำไรของปีนี้ */
  fresh();
  const ye = ctx.importOpeningBalances(tb, '2026-01-01', {}, { fileDate: '2025-12-31' });
  ok('★ งบทดลองสิ้นปีก่อนที่ลงวันที่ 1 ม.ค. ปิดกำไรปีก่อนเข้ากำไรสะสม งบกำไรขาดทุนปีนี้เป็นศูนย์',
    ye.pnlClosed && ye.pnlClosed.profit === ctx.M('207000') && ctx.incomeStatement('2026-01-01', '2026-12-31').net === 0
    && ctx.balanceSheet('2026-01-01').diff === 0, ye.pnlClosed && ctx.fmt(ye.pnlClosed.profit));

  /* แฟ้มจากตัวดึง FlowAccount: ลูกหนี้ยกมาแยกตามลูกค้า ยกเลิกแล้วเอกสารค้างหายตาม นำเข้าใหม่กลับมาครบ */
  fresh();
  const pkg = { format: 'financii-import/1', cutoff: '2026-06-30', source: 'ทดสอบ',
    partners: [{ code: 'C-001', name: 'ลูกค้า ก', kind: 'customer' }, { code: 'C-002', name: 'ลูกค้า ข', kind: 'customer' }],
    items: [{ code: 'X', name: 'ของเศษหน่วย', avgCost: '880.3333', qty: 12.5 }],
    trialBalance: [{ code: '1113', name: 'เงินฝากธนาคาร–กระแสรายวัน', debit: '100000', credit: '' },
      { code: '1131', name: 'ลูกหนี้การค้า–ในประเทศ', debit: '15000', credit: '' },
      { code: '3120', name: 'ทุนที่ออกและชำระแล้ว', debit: '', credit: '115000' }],
    openInvoices: [{ no: 'IV-1', date: '2026-06-01', partnerCode: 'C-001', partnerName: 'ลูกค้า ก', base: '9345.79', vat: '654.21', total: '10000' },
      { no: 'IV-2', date: '2026-06-05', partnerCode: 'C-002', partnerName: 'ลูกค้า ข', base: '4672.90', vat: '327.10', total: '5000' }] };
  const r = ctx.importPackage(JSON.parse(JSON.stringify(pkg)), {});
  const arLines = r.opening.entry.lines.filter((l) => l.acc === '1131');
  ok('★ ลูกหนี้ยกมาแยกบรรทัดตามลูกค้าจากเอกสารค้าง (บัญชีย่อยรายลูกค้าถูกตั้งแต่วันแรก)',
    arLines.length === 2 && arLines.some((l) => l.partner === 'C-001' && l.dr === ctx.M('10000')) && r.allPassed);
  ok('มูลค่าสินค้าที่จำนวนมีทศนิยมเป็นจำนวนเต็มสตางค์', Number.isInteger(ctx.DB.items[0].value), String(ctx.DB.items[0].value));
  const rv = ctx.reverseImport(r.opening.entry.no, 'ทดสอบ: ยกเลิกแฟ้มข้อมูล');
  ok('★ ยกเลิกการนำเข้าแฟ้มข้อมูล เอกสารค้างยกมาถูกยกเลิกตาม ทะเบียนลูกหนี้ตรงกับบัญชีคุม',
    rv.voidedDocs === 2 && ctx.reconciliationChecks('2026-06-30').checks.find((c) => c.code === 'AR_SUBLEDGER').ok);
  const again = ctx.importPackage(JSON.parse(JSON.stringify(pkg)), {});
  ok('★ นำเข้าแฟ้มเดิมใหม่หลังยกเลิก เอกสารค้างกลับมาครบ ยอดคุมตรง', again.invoices === 2 && again.allPassed);
  throws('★ ยอดเงินในแฟ้มที่อ่านไม่ออกต้องหยุด ไม่กลายเป็นศูนย์เงียบ ๆ',
    () => ctx.importPackage(Object.assign(JSON.parse(JSON.stringify(pkg)), { cutoff: '2026-07-31',
      trialBalance: [{ code: '1113', name: 'x', debit: '1O0', credit: '' }] }), {}), 'BAD_AMOUNT');
}

console.log('\n════════════════════════════════════════');
console.log(' ผ่าน ' + pass + ' ข้อ · ไม่ผ่าน ' + fail + ' ข้อ');
console.log('════════════════════════════════════════');
process.exit(fail ? 1 : 0);
