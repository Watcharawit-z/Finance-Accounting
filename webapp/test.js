/* ทดสอบเครื่องบัญชีในเบราว์เซอร์ — รันด้วย node webapp/test.js */
const fs = require('fs');
const src = ['engine','operations','seed'].map(f => fs.readFileSync(__dirname + '/src/' + f + '.js','utf8')).join('\n');
const ctx = new Function(src + '\nreturn {DB,buildSeed,trialBalance,balanceSheet,incomeStatement,cashFlow,' +
  'reconciliationChecks,aging,issueInvoice,receivePayment,issueCreditNote,recordBill,payBill,' +
  'runPayroll,runDepreciation,fileVat,fileWht,post,reverse,fmt,M,validTaxId,DomainError,' +
  'closeChecklist,closePeriod,resolveRate,round2,pct,periodOf,computePit,ssoRate,divRound};')();

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

console.log('\n════════════════════════════════════════');
console.log(' ผ่าน ' + pass + ' ข้อ · ไม่ผ่าน ' + fail + ' ข้อ');
console.log('════════════════════════════════════════');
process.exit(fail ? 1 : 0);
