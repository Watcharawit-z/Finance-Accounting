/* ทดสอบงานแกนกลางที่ทำให้บริษัทจริงใช้งานได้ตลอดปี — ปิดบัญชีสิ้นปี เปิดปีใหม่ ภาษีมูลค่าเพิ่ม ผังบัญชี ยอดยกมารายใบ
   รันด้วย node webapp/test-core.js */
const { ctx, ok, throws, done } = require('./testlib');
const M = ctx.M;

console.log('\n=== 1. ปิดบัญชีสิ้นปีและเปิดปีใหม่ ===');
{
  ctx.buildBlank({ name: 'บริษัท ทดสอบสิ้นปี จำกัด', year: 2026 });
  const D = ctx.DB;
  const jv = (date, lines) => ctx.post({ type: 'general', date, desc: 'ทดสอบ', lines });
  jv('2026-01-05', [{ acc: '1113', dr: M('500000') }, { acc: '3120', cr: M('500000') }]);
  jv('2026-03-10', [{ acc: '1113', dr: M('120000') }, { acc: '4121', cr: M('120000') }]);
  jv('2026-11-20', [{ acc: '5321', dr: M('30000') }, { acc: '1113', cr: M('30000') }]);
  /* ปิดงวด ม.ค.–พ.ย. ตามลำดับ (บริษัทเปล่าไม่มีภาษี ยื่น ภ.พ.30 เปล่าได้) */
  throws('ปิดงวดข้ามเดือนไม่ได้', () => ctx.closePeriod('2026-02'), 'CLOSE_OUT_OF_ORDER');
  for (let m = 1; m <= 11; m++) { const p = '2026-' + String(m).padStart(2, '0'); ctx.fileVat(p); ctx.closePeriod(p); }
  ctx.fileVat('2026-12');
  const chk = ctx.closeChecklist('2026-12');
  const ye = chk.items.find((i) => /ปิดบัญชีสิ้นปี/.test(i.label));
  ok('★ เดือนสุดท้ายของปีบังคับปิดบัญชีสิ้นปีก่อนปิดงวด', ye && !ye.ok && ye.blocking && !chk.canClose, ye && ye.detail);
  const r = ctx.closeFiscalYear('2026-12-31');
  ok('ปิดบัญชีสิ้นปี: โอนกำไรสุทธิ 90,000 เข้ากำไรสะสม', r.profit === M('90000') && D.entries.find((e) => e.no === r.entry.no).type === 'closing');
  ok('★ งบกำไรขาดทุนทั้งปียังแสดงกำไรครบ (ไม่นับใบปิดบัญชี)', ctx.incomeStatement('2026-01-01', '2026-12-31').net === M('90000'));
  const tbDec = ctx.trialBalance('2026-12-01', '2026-12-31');
  ok('งบทดลองเดือนสุดท้ายแสดงก่อนปิดบัญชี (รายได้ยังมียอด)', tbDec.rows.some((x) => x.code === '4121' && x.closing === -M('120000')) && tbDec.balanced);
  ok('ผ่านข้อปิดบัญชีสิ้นปีแล้ว ปิดงวด ธ.ค. ได้', ctx.closeChecklist('2026-12').canClose);
  ctx.closePeriod('2026-12');
  const made = ctx.openNextFiscalYear('ทดสอบเปิดปีใหม่');
  ok('เปิดปีถัดไป 12 งวด และรอบบัญชีของบริษัทเปลี่ยนเป็น 2570', made.length === 12 && D.company.fiscalYear === '2570', made[0] + '…' + made[11]);
  const tbJan = ctx.trialBalance('2027-01-01', '2027-01-31');
  ok('★ ปีใหม่ รายได้/ค่าใช้จ่ายยกมาเป็นศูนย์ กำไรสะสมยกมา 90,000',
    !tbJan.rows.some((x) => (x.code === '4121' || x.code === '5321') && x.opening !== 0)
    && tbJan.rows.some((x) => x.code === '3310' && x.opening === -M('90000')), tbJan.rows.map((x) => x.code + ':' + ctx.fmt(x.opening)).join(' '));
  const eq = ctx.equityStatement('2026-01-01', '2026-12-31');
  ok('งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น: กำไรสุทธิเท่างบกำไรขาดทุน และยอดปลายงวดตรงงบฐานะ', eq.net === M('90000') && eq.matchesBs);
  ok('งบแสดงฐานะการเงินปีใหม่สมดุล', ctx.balanceSheet('2027-01-31').diff === 0);
  throws('ใบปิดบัญชีกลับรายการตรง ๆ ไม่ได้', () => ctx.reverse(r.entry.no, 'ทดสอบกลับรายการ'), 'ENTRY_FROM_DOCUMENT');
  ctx.reopenPeriod('2026-12', 'ผู้สอบบัญชีให้ปรับปรุงค่าใช้จ่ายค้างจ่าย');
  jv('2026-12-31', [{ acc: '5321', dr: M('10000') }, { acc: '2131', cr: M('10000') }]);
  const c2 = ctx.closeChecklist('2026-12').items.find((i) => /ปิดบัญชีสิ้นปี/.test(i.label));
  ok('★ ลงรายการเพิ่มหลังปิดบัญชี ระบบเตือนว่าต้องปิดใหม่', !c2.ok && /ลงเพิ่ม/.test(c2.detail), c2.detail);
  const r2 = ctx.closeFiscalYear('2026-12-31');
  ok('ปิดบัญชีสิ้นปีอีกครั้ง กลับใบเดิมแล้วโอนกำไรใหม่ 80,000', r2.profit === M('80000') && D.entries.find((e) => e.no === r.entry.no).status === 'reversed'
    && ctx.incomeStatement('2026-01-01', '2026-12-31').net === M('80000') && ctx.closeChecklist('2026-12').canClose);
  ctx.reopenFiscalYear('2026-12-31', 'ทดสอบยกเลิกการปิดบัญชี');
  ok('ยกเลิกการปิดบัญชีสิ้นปี รายได้กลับมามียอด กำไรทั้งปีไม่เปลี่ยน', ctx.yearEndOpen(ctx.fiscalYearOf('2026-12-31')).length > 0
    && ctx.incomeStatement('2026-01-01', '2026-12-31').net === M('80000'));
}
{
  ctx.buildBlank({ name: 'บริษัท รอบบัญชีเมษา จำกัด', year: 2026, startMonth: 4 });
  const ps = ctx.DB.periods;
  ok('★ รอบบัญชีเริ่มเดือนเมษายน: งวด เม.ย. 2569 – มี.ค. 2570', ps[0].code === '2026-04' && ps[11].code === '2027-03');
  ok('ปีบัญชีของ ก.พ. 2570 เริ่ม 1 เม.ย. 2569', ctx.fiscalYearOf('2027-02-10').start === '2026-04-01');
  throws('เดือนเริ่มรอบบัญชีผิด', () => ctx.buildBlank({ name: 'x', year: 2026, startMonth: 13 }), 'FISCAL_START_INVALID');
}

/* เลขผู้เสียภาษี 13 หลักที่หลักสุดท้ายถูกต้อง */
const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const partner = (o) => ctx.savePartner(o).partner;

console.log('\n=== 2. ภ.พ.30 ภาษีชำระเกินยกมา ขอคืนเป็นเงินสด ยื่นเรียงเดือน ===');
{
  ctx.buildBlank({ name: 'บริษัท ทดสอบภาษี จำกัด', year: 2026 });
  const D = ctx.DB;
  const cust = partner({ kind: 'customer', name: 'บริษัท ลูกค้า จำกัด', taxId: tid('010553600000'), address: 'กรุงเทพฯ' });
  const ven = partner({ kind: 'vendor', name: 'บริษัท ผู้ขาย จำกัด', taxId: tid('010553600001'), address: 'กรุงเทพฯ' });
  const gl = (sub, to) => ctx.balBySub([sub], to);
  const sell = (date, price) => ctx.issueInvoice({ partnerCode: cust.code, date, lines: [{ desc: 'ค่าบริการ', qty: 1, price, taxCode: 'VAT7' }] });
  const buy = (date, price, no) => ctx.recordBill({ partnerCode: ven.code, date, vendorNo: no, lines: [{ desc: 'วัสดุ', qty: 1, price, expenseSub: 'admin_expense' }] });
  buy('2026-01-10', '100000', 'V-1');            // ภาษีซื้อ 7,000
  sell('2026-01-20', '20000');                  // ภาษีขาย 1,400 → ชำระเกิน 5,600
  sell('2026-02-05', '50000');                  // ภาษีขาย 3,500
  throws('★ ยื่น ภ.พ.30 ข้ามเดือนไม่ได้ (ยอดยกมาจะผิด)', () => ctx.fileVat('2026-02'), 'VAT_FILE_ORDER');
  const f1 = ctx.fileVat('2026-01');
  ok('ม.ค. ชำระเกิน 5,600 ยกไป', f1.diff === -M('5600') && f1.carryOut === M('5600') && f1.payable === -M('5600') && gl('vat_receivable', '2026-01-31') === M('5600'));
  const r2 = ctx.vatReturnOf('2026-02');
  ok('หน้าตัวอย่าง ก.พ.: บรรทัด 10 ภาษีชำระเกินยกมา 5,600', r2.carryIn === M('5600') && r2.net === M('3500') - M('5600'));
  const f2 = ctx.fileVat('2026-02');
  ok('★ ก.พ. ภาษีขาย 3,500 หักยอดยกมาหมด ยังเกิน 2,100 ยกต่อ — ไม่ตั้งภาษีค้างชำระ', f2.carryIn === M('5600') && f2.carryOut === M('2100')
    && gl('vat_payable', '2026-02-28') === 0 && gl('vat_receivable', '2026-02-28') === M('2100'));
  sell('2026-03-03', '100000');                 // ภาษีขาย 7,000
  const f3 = ctx.fileVat('2026-03');
  ok('★ มี.ค. ภาษีขาย 7,000 หักยกมา 2,100 ชำระสุทธิ 4,900 และล้างภาษีขอคืนเป็นศูนย์', f3.payable === M('4900') && f3.carryOut === 0
    && gl('vat_payable', '2026-03-31') === -M('4900') && gl('vat_receivable', '2026-03-31') === 0);
  buy('2026-04-02', '50000', 'V-2');            // ภาษีซื้อ 3,500
  const f4 = ctx.fileVat('2026-04', { refund: true });
  ok('★ เม.ย. ขอคืนเป็นเงินสด: ภาษีขอคืนค้างในบัญชี แต่ไม่ยกไปหักเดือนถัดไป', f4.refund === M('3500') && f4.carryOut === 0
    && gl('vat_receivable', '2026-04-30') === M('3500') && ctx.vatReturnOf('2026-05').carryIn === 0);
  ok('ทุกใบสำคัญปิดภาษีสมดุล และบัญชีภาษีขาย/ซื้อเป็นศูนย์', gl('output_vat', '2026-04-30') === 0 && gl('input_vat', '2026-04-30') === 0
    && ctx.trialBalance('2026-01-01', '2026-04-30').balanced);
  const chk = ctx.closeChecklist('2026-04').items.find((i) => /ภ\.พ\.30/.test(i.label));
  ok('รายการตรวจปิดงวดบอกยอดขอคืน', chk.ok && /ขอคืน/.test(chk.detail), chk.detail);

  console.log('\n=== 3. ภ.ง.ด. ภาษีเป็นศูนย์ เลือกวันที่และบัญชีที่จ่าย ===');
  const ind = partner({ kind: 'vendor', name: 'นายช่าง ใจดี', entityType: 'individual', taxId: tid('110170023070'), address: 'นนทบุรี' });
  /* แถวภาษีเป็นศูนย์ (เช่น เงินเดือนพนักงานที่ไม่ถึงเกณฑ์เสียภาษี) ยังต้องยื่นแบบ */
  D.taxTx.push({ kind: 'wht', period: '2026-05', date: '2026-05-31', docNo: 'PAY-TEST', docType: 'payroll', partnerName: 'พนักงาน 2 คน',
    taxId: null, branch: '00000', base: M('24000'), tax: 0, rate: null, channel: 'manual', incomeType: 'เงินเดือน ม.40(1)', form: 'PND1', filingId: null });
  const nEntries = D.entries.length;
  const fz = ctx.fileWht('2026-05', 'PND1');
  ok('★ ภ.ง.ด.1 ที่ภาษีรวมเป็นศูนย์ ยื่นได้โดยไม่มีใบสำคัญ', fz.entryNo === null && fz.total === 0 && fz.count === 1 && D.entries.length === nEntries);
  ctx.recordExpense({ partnerCode: ind.code, date: '2026-06-06', method: 'transfer',
    lines: [{ desc: 'ค่าซ่อมแซม', qty: 1, price: '20000', acc: '5321', taxCode: 'EXEMPT' }], whtCode: 'WHT_SERVICE' });
  const cash = D.accounts.find((a) => a.subType === 'cash' && a.postable);
  throws('วันที่นำส่งต้องอยู่หลังสิ้นงวด', () => ctx.fileWht('2026-06', 'PND3', { date: '2026-06-30' }), 'WHT_REMIT_DATE');
  throws('บัญชีที่จ่ายต้องเป็นเงินสด/ธนาคาร', () => ctx.fileWht('2026-06', 'PND3', { account: '5321' }), 'PAY_ACCOUNT_INVALID');
  const f6 = ctx.fileWht('2026-06', 'PND3', { date: '2026-07-05', account: cash.code });
  const je = D.entries.find((e) => e.no === f6.entryNo);
  ok('★ นำส่ง ภ.ง.ด.3 ตามวันที่และบัญชีที่เลือก', je.date === '2026-07-05' && je.lines.some((l) => l.acc === cash.code && l.cr === f6.total) && f6.total === M('600'),
    je.date + ' ' + ctx.fmt(f6.total));
  const nil = ctx.fileWht('2026-06', 'PND1', { nil: true });
  ok('ยื่น ภ.ง.ด.1 แบบไม่มีรายการได้ (ไม่มีใบสำคัญ)', nil.nil && nil.entryNo === null && nil.count === 0);
}

console.log('\n=== 4. กิจการที่ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม ===');
{
  ctx.buildBlank({ name: 'ร้าน ไม่จดภาษี', year: 2026 });
  const D = ctx.DB;
  D.company.vatRegistered = false;
  const cust = partner({ kind: 'customer', name: 'ลูกค้าทั่วไป' });
  const ven = partner({ kind: 'vendor', name: 'บริษัท ผู้ขาย จำกัด', taxId: tid('010553600001'), address: 'กรุงเทพฯ' });
  throws('★ เรียกเก็บภาษีมูลค่าเพิ่มไม่ได้', () => ctx.issueInvoice({ partnerCode: cust.code, date: '2026-01-10',
    lines: [{ desc: 'ค่าบริการ', qty: 1, price: '1000', taxCode: 'VAT7' }] }), 'NOT_VAT_REGISTERED');
  const inv = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-01-10', lines: [{ desc: 'ค่าบริการ', qty: 1, price: '1000' }] });
  ok('ใบแจ้งหนี้ไม่มีภาษี ยอดรวม 1,000 และไม่มีแถวในรายงานภาษีขาย', inv.vat === 0 && inv.total === M('1000') && inv.nonVat
    && !D.taxTx.some((t) => t.kind === 'vat_output' && t.docNo === inv.no));
  const cn = ctx.issueCreditNote({ date: '2026-01-15', invoiceNo: inv.no, base: '100', reason: 'PRICE_REDUCE' });
  ok('ใบลดหนี้ตามใบแจ้งหนี้ก็ไม่มีภาษี', cn.vat === 0 && !D.taxTx.some((t) => t.kind === 'vat_output' && t.docNo === cn.no));
  const bill = ctx.recordBill({ partnerCode: ven.code, date: '2026-01-12', vendorNo: 'NV-1', lines: [{ desc: 'วัสดุ', qty: 1, price: '1000', expenseSub: 'admin_expense' }] });
  ok('★ ภาษีซื้อขอคืนไม่ได้ รวมเป็นค่าใช้จ่าย', ctx.balBySub(['input_vat'], '2026-01-31') === 0 && bill.total === M('1070'),
    'ภาษีซื้อ ' + ctx.fmt(ctx.balBySub(['input_vat'], '2026-01-31')));
  const chk = ctx.closeChecklist('2026-01');
  ok('★ ไม่ต้องยื่น ภ.พ.30 ก่อนปิดงวด', !chk.items.some((i) => /ภ\.พ\.30/.test(i.label)) && chk.canClose,
    chk.items.filter((i) => i.blocking && !i.ok).map((i) => i.label).join(','));
}

done();
