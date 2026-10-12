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

console.log('\n=== 5. ผังบัญชี: เพิ่ม แก้ชื่อ เปลี่ยนหมวด ตั้งบัญชีหลัก ลบ ===');
{
  ctx.buildBlank({ name: 'บริษัท ทดสอบผังบัญชี จำกัด', year: 2026 });
  const D = ctx.DB;
  const bank0 = ctx.accBySub('bank');
  const kb = ctx.saveAccount({ code: '1112.02', name: 'ธนาคารกสิกรไทย ออมทรัพย์', subType: 'bank' });
  ok('เพิ่มบัญชีธนาคารที่สองได้ หมวดสินทรัพย์ ลงรายการได้', kb.type === 'asset' && kb.postable && kb.custom && ctx.accBySub('bank') === bank0);
  throws('รหัสซ้ำ', () => ctx.saveAccount({ code: '1112.02', name: 'ซ้ำ', subType: 'bank' }), 'ACCOUNT_CODE_DUPLICATE');
  throws('หมวดที่ไม่มีอยู่', () => ctx.saveAccount({ code: '9999', name: 'x', subType: 'nope' }), 'SUBTYPE_UNKNOWN');
  ctx.saveAccount({ code: '1112.02', name: 'ธนาคารกสิกรไทย ออมทรัพย์ (หลัก)', edit: true, makeDefault: true });
  ok('★ ตั้งเป็นบัญชีหลัก เอกสารใหม่ลงบัญชีนี้', ctx.accBySub('bank') === '1112.02' && ctx.acc('1112.02').name.indexOf('(หลัก)') > 0);
  const ad = ctx.saveAccount({ code: '5321.01', name: 'ค่าโฆษณาออนไลน์', subType: 'admin_expense' });
  ctx.saveAccount({ code: '5321.01', name: 'ค่าโฆษณาออนไลน์', subType: 'selling_expense', edit: true });
  ok('บัญชีที่ยังไม่มีรายการเปลี่ยนหมวดได้', ctx.acc('5321.01').subType === 'selling_expense' && ad.type === 'expense');
  ctx.post({ type: 'general', date: '2026-01-05', desc: 'ทดสอบ', lines: [{ acc: '5321.01', dr: M('100') }, { acc: '1112.02', cr: M('100') }] });
  throws('★ บัญชีที่มีรายการแล้วเปลี่ยนหมวดไม่ได้ (งบงวดที่ปิดจะเปลี่ยน)', () => ctx.saveAccount({ code: '5321.01', name: 'x', subType: 'admin_expense', edit: true }), 'ACCOUNT_IN_USE');
  throws('บัญชีที่มีรายการลบไม่ได้', () => ctx.deleteAccount('5321.01'), 'ACCOUNT_IN_USE');
  throws('บัญชีมาตรฐานลบไม่ได้', () => ctx.deleteAccount(bank0), 'ACCOUNT_BUILTIN');
  const ar = D.accounts.find((a) => a.subType === 'trade_receivable');
  throws('บัญชีเดียวของหมวดที่ระบบใช้ ย้ายหมวดไม่ได้', () => ctx.saveAccount({ code: ar.code, name: ar.name, subType: 'other_receivable', edit: true }), 'ACCOUNT_SOLE_OF_TYPE');
  const tmp = ctx.saveAccount({ code: '5999', name: 'ทดลอง', subType: 'admin_expense' });
  ctx.deleteAccount('5999');
  ok('ลบบัญชีที่เพิ่มเองและยังไม่ได้ใช้ได้', tmp && !D.accounts.some((a) => a.code === '5999'));
}

console.log('\n=== 6. ลูกหนี้/เจ้าหนี้ยกมารายใบ ===');
{
  ctx.buildBlank({ name: 'บริษัท ทดสอบยกมารายใบ จำกัด', year: 2026 });
  const D = ctx.DB;
  /* ระบบเดิมตัดยอด 31 ธ.ค. 2568 (วันก่อนงวดแรก) — ต้องลงยอดยกมา 1 ม.ค. 2569 ได้ */
  const tb = [
    { code: '11122.01', name: 'เงินฝากธนาคาร', debit: M('200000'), credit: 0 },
    { code: '11311', name: 'ลูกหนี้การค้า', debit: M('50000'), credit: 0 },
    { code: '21311', name: 'เจ้าหนี้การค้า', debit: 0, credit: M('30000') },
    { code: '21360', name: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', debit: 0, credit: M('1500') },
    { code: '31110', name: 'ทุนจดทะเบียน', debit: 0, credit: M('218500') },
  ];
  const op = ctx.importOpeningBalances(tb, '2025-12-31', { '21360': '2146' });
  ok('★ วันตัดยอดก่อนงวดแรก 1 วัน ลงยอดยกมาวันแรกของงวดแรกแทน', op.entry.date === '2026-01-01', op.entry.date);
  const gap = ctx.openingItemsGap('ar', '2026-01-31');
  ok('ยกยอดรวมมาแล้ว ยังไม่มีรายใบ: ลูกหนี้ต่างจากรายใบ 50,000', gap === M('50000') && !ctx.closeChecklist('2026-01').canClose);
  const c1 = partner({ kind: 'customer', name: 'บริษัท เอ จำกัด', taxId: tid('010553600002'), address: 'กทม.' });
  const c2 = partner({ kind: 'customer', name: 'บริษัท บี จำกัด', taxId: tid('010553600003'), address: 'กทม.' });
  throws('★ ยอดรายใบเกินยอดยกมารวมถูกปฏิเสธ', () => ctx.saveOpeningItems({ kind: 'ar', date: '2026-01-01',
    rows: [{ partnerCode: c1.code, docNo: 'INV-OLD-1', docDate: '2025-12-10', due: '2026-01-09', amount: '60000' }] }), 'OPEN_ITEM_EXCEEDS');
  const nE = D.entries.length;
  const r = ctx.saveOpeningItems({ kind: 'ar', date: '2026-01-01', rows: [
    { partnerCode: c1.code, docNo: 'INV-OLD-1', docDate: '2025-12-10', due: '2026-01-09', amount: '30,000' },
    { partnerCode: c2.code, docNo: 'INV-OLD-2', docDate: '2025-12-20', due: '2026-01-19', amount: '20000' }] });
  const je = D.entries.find((e) => e.no === r.entry.no);
  ok('★ แยกยอดยกมารวมเป็นรายใบ: ย้ายจากคู่ค้า "ยอดยกมา" ไปรายลูกค้า ไม่ลงบัญชีซ้ำ', D.entries.length === nE + 1
    && ctx.balBySub(['trade_receivable'], '2026-01-31') === M('50000') && je.lines.some((l) => l.partner === 'OPENING' && l.cr === M('50000')));
  ok('ลูกหนี้รายใบ = บัญชีคุม ปิดงวดผ่านข้อลูกหนี้', ctx.openingItemsGap('ar', '2026-01-31') === 0
    && ctx.reconciliationChecks('2026-01-31').checks.find((c) => c.code === 'AR_SUBLEDGER').ok);
  const inv1 = D.docs.invoice.find((d) => d.legacyNo === 'INV-OLD-1');
  const ag = ctx.aging('ar', '2026-01-31');
  ok('ใบค้างยกมาอยู่ในรายงานอายุหนี้ แยกตามลูกค้า ยอดรวม 50,000', ag.totals.total === M('50000') && ag.rows.some((x) => x.code === c1.code && x.total === M('30000')));
  const rc = ctx.receivePayment({ invoiceNo: inv1.no, date: '2026-01-15', amount: '30000', method: 'transfer' });
  ok('★ รับชำระใบที่ยกมาได้ทันที ใบปิดเป็นรับครบ', inv1.paid === M('30000') && ctx.invOutstanding(inv1) === 0 && !!rc.no);
  throws('ยกเลิกชุดที่มีใบรับชำระแล้วไม่ได้', () => ctx.voidOpeningItems(r.batch, 'กรอกผิดชุด'), 'OPEN_ITEM_SETTLED');
  throws('เลขที่เอกสารเดิมซ้ำ', () => ctx.saveOpeningItems({ kind: 'ar', date: '2026-01-01', mode: 'post',
    rows: [{ partnerCode: c1.code, docNo: 'INV-OLD-1', amount: '100' }] }), 'OPEN_ITEM_DUPLICATE');

  /* เจ้าหนี้จากไฟล์ — สร้างผู้ขายที่ยังไม่มีให้ */
  const table = [['ชื่อผู้ขาย', 'เลขประจำตัวผู้เสียภาษี', 'เลขที่เอกสาร', 'วันที่', 'ครบกำหนด', 'ยอดค้าง'],
    ['บริษัท วัสดุ จำกัด', tid('010553600004'), 'AP-77', '25/12/2568', '24/01/2569', '18,000.00'],
    ['บริษัท ขนส่ง จำกัด', '', 'AP-78', '2025-12-28', '', '12000'],
    ['รวม', '', '', '', '', '30,000.00']];
  ok('จับได้ว่าเป็นไฟล์ยอดค้างรายใบ (ไม่ใช่งบทดลอง)', ctx.looksLikeOpenItems(table[0]) && !ctx.looksLikeOpenItems(['รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต']));
  const rd = ctx.readOpenItemsFile(table, 'ap');
  ok('อ่านไฟล์: 2 ใบ ข้ามแถวรวม วันที่ พ.ศ. แปลงถูก สร้างผู้ขายใหม่ 2 ราย', rd.rows.length === 2 && rd.total === M('30000')
    && rd.rows[0].docDate === '2025-12-25' && rd.rows[0].due === '2026-01-24' && rd.creating.length === 2, JSON.stringify(rd.skipped));
  const ri = ctx.importOpeningItems(rd, 'ap', '2026-01-01', 'allocate');
  ok('★ ตั้งเจ้าหนี้รายใบจากไฟล์ เจ้าหนี้รายใบ = บัญชีคุม', ri.count === 2 && ctx.openingItemsGap('ap', '2026-01-31') === 0
    && D.partners.filter((p) => p.kind === 'vendor').length >= 2);
  const b = D.docs.bill.find((d) => d.legacyNo === 'AP-78');
  ctx.payBill({ billNo: b.no, date: '2026-01-20' });
  ok('จ่ายชำระเจ้าหนี้ที่ยกมาได้', ctx.billOutstanding(b) === 0);

  /* ลงบัญชีเป็นยอดยกมาใหม่ (ไม่มียอดรวมในบัญชี) แล้วยกเลิกทั้งชุด */
  const r3 = ctx.saveOpeningItems({ kind: 'ar', date: '2026-01-01', mode: 'post',
    rows: [{ partnerCode: c2.code, docNo: 'INV-OLD-9', amount: '5000' }] });
  ok('ลงบัญชีเป็นยอดยกมาใหม่: Dr ลูกหนี้ / Cr บัญชีปรับปรุงยอดยกมา', ctx.balBySub(['trade_receivable'], '2026-01-31') === M('25000')
    && ctx.balBySub(['opening_balance'], '2026-01-31') === -M('5000'));
  ctx.voidOpeningItems(r3.batch, 'กรอกผิด ยกเลิกทั้งชุด');
  ok('ยกเลิกทั้งชุด: กลับรายการและใบเป็นยกเลิก', ctx.balBySub(['opening_balance'], '2026-01-31') === 0
    && D.docs.invoice.find((d) => d.legacyNo === 'INV-OLD-9').status === 'void' && ctx.openingItemsGap('ar', '2026-01-31') === 0);

  console.log('\n=== 7. นำส่งภาษีหัก ณ ที่จ่ายที่ยกมาจากระบบเดิม ===');
  const whtAcc = ctx.acc('2146');
  const bank = ctx.accBySub('bank');
  throws('นำส่งเกินยอดยกมาไม่ได้', () => ctx.postJournalVoucher({ book: 'payment', date: '2026-01-07', desc: 'นำส่ง ภ.ง.ด.53 ธ.ค. 2568',
    lines: [{ acc: whtAcc.code, dr: '2000' }, { acc: bank, cr: '2000' }] }), 'WHT_REMIT_EXCEEDS_OPENING');
  throws('สมุดรายวันทั่วไปยังลงบัญชีคุมไม่ได้', () => ctx.postJournalVoucher({ book: 'general', date: '2026-01-07', desc: 'ทดสอบ',
    lines: [{ acc: whtAcc.code, dr: '1500' }, { acc: '3930', cr: '1500' }] }), 'CONTROL_ACCOUNT_MANUAL');
  const jv = ctx.postJournalVoucher({ book: 'payment', date: '2026-01-07', desc: 'นำส่ง ภ.ง.ด.53 ธ.ค. 2568',
    lines: [{ acc: whtAcc.code, dr: '1500' }, { acc: bank, cr: '1500' }] });
  ok('★ จ่ายภาษีหัก ณ ที่จ่ายค้างนำส่งที่ยกมาด้วยสมุดรายวันจ่ายได้ ยอดค้างเป็นศูนย์', !!jv && ctx.balBySub(['wht_payable_pnd53'], '2026-01-31') === 0,
    whtAcc.code + ' ' + whtAcc.subType);
}

done();
