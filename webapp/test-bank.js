/* ทดสอบระบบกระทบยอดธนาคาร (bank.js) — รันด้วย node webapp/test-bank.js
   ทุกชุดเริ่มจากบริษัทเปล่า ใช้บัญชีเงินฝาก 1113 (กระแสรายวัน) และ 1114 (ออมทรัพย์) ที่มีอยู่ในผังมาตรฐาน */
const { ctx, ok, throws, done } = require('./testlib');
const C = ctx;
const M = C.M, fmt = C.fmt;
const D = () => C.DB;

function fresh() {
  C.buildBlank({ name: 'บริษัท ทดสอบธนาคาร จำกัด', year: 2026, taxId: '0105536000003', address: '1 ถนนสีลม กรุงเทพฯ 10500' });
}
const jv = (book, date, desc, lines) => C.postJournalVoucher({ book, date, desc, lines });
const csv = (rows) => C.parseCsv(rows.map((r) => r.join(',')).join('\n'));
const rec = (code, p) => C.bankReconcile(code, p);
const item = (p) => C.bankCloseItem(p);

console.log('\n=== 1. บริษัทเปล่า: ไม่มีอะไรให้กระทบยอด ไม่ใช่ "กระทบยอดครบ" ===');
fresh();
ok('ไม่มีความเคลื่อนไหว — ข้อตรวจผ่านพร้อมบอกเหตุผล', item('2026-06').ok && /ไม่มีความเคลื่อนไหว/.test(item('2026-06').detail), item('2026-06').detail);
jv('receipt', '2026-06-01', 'รับเงินทุนจดทะเบียน', [{ acc: '1113', dr: '1000000' }, { acc: '3120', cr: '1000000' }]);
const i0 = item('2026-06');
ok('★ มีเงินเข้าบัญชีแต่ยังไม่มีสเตทเมนต์ → ข้อตรวจไม่ผ่าน', !i0.ok && /1113 ยังไม่มีสเตทเมนต์/.test(i0.detail), i0.detail);
ok('ข้อธนาคารไม่บล็อกการปิดงวด', i0.blocking === false);
ok('รายการในบัญชีที่ยังไม่มีสเตทเมนต์แสดงเป็นรายการค้าง', rec('1113', '2026-06').outstanding.length === 1);
ok('ไม่มีสเตทเมนต์ = ยังกระทบยอดไม่ได้ (ผลต่างไม่มีค่า)', rec('1113', '2026-06').diff === null && !rec('1113', '2026-06').ok);

console.log('\n=== 2. อ่านไฟล์สเตทเมนต์ ===');
{
  const th = csv([
    ['ธนาคารไทยพาณิชย์ รายการเดินบัญชี ตั้งแต่ 01/06/2569 ถึง 30/06/2569'],
    ['วันที่', 'รายการ', 'เลขที่อ้างอิง', 'ถอน', 'ฝาก', 'คงเหลือ'],
    ['', 'ยอดยกมา', '', '', '', '0.00'],
    ['01/06/2569', 'รับโอนเงินทุน', 'TR001', '', '"1,000,000.00"', '"1,000,000.00"'],
    ['05/06/2569', 'ค่าธรรมเนียม', 'FEE01', '25.00', '', '"999,975.00"'],
    ['30/06/2569', 'ดอกเบี้ย', 'INT01', '', '120.50', '"1,000,095.50"'],
    ['', 'รวม', '', '25.00', '"1,000,120.50"', ''],
  ]);
  const st = C.readBankStatement(th);
  ok('หาหัวตารางภาษาไทยเจอ', st.ok && st.headerRow === 1, JSON.stringify(st.map));
  ok('อ่านได้ 3 รายการ ข้ามยอดยกมาและบรรทัดรวม', st.lines.length === 3, st.skipped.map((s) => s.why).join(','));
  ok('★ วันที่ พ.ศ. 01/06/2569 = 2026-06-01', st.lines[0].date === '2026-06-01');
  ok('จำนวนเงินมีจุลภาคอ่านได้ตรง', st.lines[0].credit === M('1000000') && st.lines[1].debit === M('25'));
  ok('ยอดคงเหลืออ่านได้', st.lines[2].balance === M('1000095.50'));
  ok('ยอดยกมาจากแถว "ยอดยกมา"', st.opening && st.opening.amount === 0);
  ok('วันที่ในหัวไฟล์', st.dates && st.dates.from === '2026-06-01' && st.dates.to === '2026-06-30');

  const en = csv([
    ['Date', 'Description', 'Cheque No.', 'Withdrawal', 'Deposit', 'Balance'],
    ['15/07/2026', 'TRANSFER IN', '', '', '500.00', '1500.00'],
    ['10/07/2026', 'CHQ 1234', '1234', '(250.00)', '', '1000.00'],
  ]);
  const se = C.readBankStatement(en);
  ok('หัวตารางภาษาอังกฤษ', se.ok && se.map.debit === 3 && se.map.credit === 4 && se.map.ref === 2, JSON.stringify(se.map));
  ok('★ ไฟล์เรียงใหม่ไปเก่า กลับเป็นเก่าไปใหม่', se.reversed && se.lines[0].date === '2026-07-10');
  ok('ยอดในวงเล็บในช่องถอนเป็นเงินออก', se.lines[0].debit === M('250') && se.lines[0].credit === 0);

  const one = csv([
    ['Transaction Date', 'Details', 'Amount', 'Balance'],
    ['2026-07-01', 'FEE', '-35.00', '965.00'],
    ['2026-07-02', 'INTEREST', '12.34', '977.34'],
    ['46210', 'EXCEL SERIAL', '1.00', '978.34'],
  ]);
  const so = C.readBankStatement(one);
  ok('จำนวนเงินคอลัมน์เดียว: ติดลบ = ถอน บวก = ฝาก', so.ok && so.lines[0].debit === M('35') && so.lines[1].credit === M('12.34'));
  ok('เลขวันที่ของ Excel', so.lines[2].date === '2026-07-07', so.lines[2].date);

  const kb = csv([
    ['วันที่', 'เวลา', 'รายการ', 'ถอนเงิน', 'ฝากเงิน', 'ยอดคงเหลือ', 'ช่องทาง', 'รายละเอียด'],
    ['03/07/69', '10:15', 'รับโอนเงิน', '', '"2,000.00"', '"3,000.00"', 'K PLUS', 'จาก นาย ก'],
  ]);
  const sk = C.readBankStatement(kb);
  ok('ปีสองหลัก 69 = 2569 และต่อคอลัมน์รายการสองช่อง', sk.lines[0].date === '2026-07-03' && /รับโอนเงิน · จาก นาย ก · K PLUS/.test(sk.lines[0].desc), sk.lines[0].desc);
  const thMonth = C.bankParseDate('15 ก.ค. 2569'), enMonth = C.bankParseDate('15-Jul-26');
  ok('วันที่แบบชื่อเดือนไทย/อังกฤษ', thMonth === '2026-07-15' && enMonth === '2026-07-15', thMonth + ' ' + enMonth);
  ok('เดือนก่อนวัน (ทั้งไฟล์) อ่านถูก', C.readBankStatement(csv([['Date', 'Amount'], ['07/15/2026', '5'], ['07/02/2026', '6']])).lines
    .map((l) => l.date).join() === '2026-07-02,2026-07-15');
  const bad = C.readBankStatement(csv([['วันที่', 'ถอน', 'ฝาก'], ['ไม่ใช่วันที่', '10', ''], ['01/07/2569', 'abc', '']]));
  ok('แถวที่อ่านไม่ออกถูกรายงาน ไม่เงียบหาย', bad.lines.length === 0 && bad.skipped.filter((s) => s.bad).length === 2);
  ok('ไฟล์ที่ไม่มีคอลัมน์วันที่/จำนวนเงิน', !C.readBankStatement(csv([['ชื่อ', 'ที่อยู่'], ['ก', 'ข']])).ok);
}

console.log('\n=== 3. นำเข้าสเตทเมนต์ · กันนำเข้าซ้ำ · ยอดยกมา/ปลายงวด ===');
fresh();
jv('receipt', '2026-06-01', 'รับเงินทุนจดทะเบียน', [{ acc: '1113', dr: '1000000' }, { acc: '3120', cr: '1000000' }]);
const juneFile = csv([
  ['วันที่', 'รายการ', 'อ้างอิง', 'ถอน', 'ฝาก', 'คงเหลือ'],
  ['01/06/2569', 'รับโอนเงินทุน', 'TR001', '', '1000000', '1000000'],
  ['05/06/2569', 'ค่าธรรมเนียม', 'FEE01', '25', '', '999975'],
  ['30/06/2569', 'ดอกเบี้ย', 'INT01', '', '100', '1000075'],
]);
const r1 = C.importBankStatement('1113', juneFile, { name: 'scb-june.csv' });
ok('นำเข้า 3 รายการ', r1.added === 3 && D().bankTxns.filter((t) => t.acc === '1113').length === 3);
ok('★ ทุกบรรทัดผูกกับบัญชี 1113', D().bankTxns.every((t) => t.acc === '1113'));
const s6 = C.bankStmtRec('1113', '2026-06');
ok('ยอดยกมาคำนวณย้อนจากยอดคงเหลือบรรทัดแรก = 0', s6.opening === 0);
ok('★ ไฟล์ถึงสิ้นเดือน → ตั้งยอดปลายงวดให้', s6.closing === M('1000075'));
throws('★ นำเข้าไฟล์เดิมซ้ำ → ปฏิเสธทั้งไฟล์', () => C.importBankStatement('1113', juneFile, { name: 'scb-june.csv' }), 'BANK_IMPORT_DUPLICATE');
ok('นำเข้าซ้ำแล้วไม่มีรายการเพิ่ม', D().bankTxns.length === 3);
const overlap = csv([
  ['วันที่', 'รายการ', 'อ้างอิง', 'ถอน', 'ฝาก', 'คงเหลือ'],
  ['30/06/2569', 'ดอกเบี้ย', 'INT01', '', '100', '1000075'],
  ['02/07/2569', 'ค่าธรรมเนียม', 'FEE02', '25', '', '1000050'],
  ['02/07/2569', 'ค่าธรรมเนียม', 'FEE02', '25', '', '1000025'],
]);
const r2 = C.importBankStatement('1113', overlap, { name: 'scb-overlap.csv' });
ok('★ ไฟล์ช่วงซ้อน นำเข้าเฉพาะรายการใหม่ (รายการหน้าตาเหมือนกันสองบรรทัดยังนับครบ)', r2.added === 2 && r2.duplicates === 1, r2.added + '/' + r2.duplicates);
ok('ไฟล์ยังไม่ถึงสิ้นเดือน → ไม่ตั้งยอดปลายงวดเอง แต่เตือน', C.bankStmtRec('1113', '2026-07').closing === null
  && r2.warnings.some((w) => /ยังไม่ถึงสิ้นเดือน/.test(w)), r2.warnings.join(' | '));
throws('★ ไฟล์ของบัญชี 1113 นำเข้าบัญชี 1114 → ปฏิเสธ (เลือกบัญชีผิด)', () => C.importBankStatement('1114', juneFile, { name: 'x.csv' }), 'BANK_IMPORT_OTHER_ACCOUNT');
throws('นำเข้าบัญชีที่ไม่ใช่เงินฝาก', () => C.importBankStatement('1111', juneFile, {}), 'BANK_ACCOUNT_INVALID');
throws('ไฟล์นอกรอบบัญชี', () => C.importBankStatement('1114', csv([['Date', 'Amount'], ['01/01/2020', '5']]), {}), 'BANK_IMPORT_DUPLICATE');
const undoId = r2.imp.id;
C.undoBankImport(undoId);
ok('ยกเลิกการนำเข้า: ลบเฉพาะรายการจากไฟล์นั้น', D().bankTxns.length === 3 && D().bankImports.find((x) => x.id === undoId).undone);
ok('ยกเลิกแล้ว งวดที่ไม่เหลืออะไรถูกลบ', !C.bankStmtRec('1113', '2026-07'));
throws('ยกเลิกซ้ำ', () => C.undoBankImport(undoId), 'BANK_IMPORT_NOT_FOUND');

console.log('\n=== 4. จับคู่ และงบกระทบยอดเดือน มิ.ย. ===');
let r6 = rec('1113', '2026-06');
ok('ก่อนจับคู่: รายการในสเตทเมนต์ยังไม่ได้บันทึก 3 รายการ', r6.unrecorded.length === 3 && !r6.ok);
const cap = D().bankTxns.find((t) => t.ref === 'TR001');
const sug = C.bankSuggest(cap);
ok('★ ระบบแนะนำใบสำคัญรับเงินทุน (ยอดเท่ากัน วันเดียวกัน)', sug.length === 1 && sug[0].amount === M('1000000'), sug.map((s) => s.key).join());
throws('จับคู่ยอดไม่เท่ากัน', () => C.matchBank('1113', [D().bankTxns.find((t) => t.ref === 'FEE01').id], [sug[0].key]), 'BANK_MATCH_AMOUNT');
throws('จับคู่โดยไม่มีใบสำคัญ (ทำเครื่องหมายเฉย ๆ) ไม่ได้', () => C.matchBank('1113', [cap.id], []), 'BANK_MATCH_NO_ITEM');
const auto = C.bankAutoMatch('1113', '2026-06-30');
ok('จับคู่อัตโนมัติได้คู่ที่แน่ใจ 1 คู่', auto.matched === 1 && cap.matched && cap.items[0] === sug[0].key);
throws('จับคู่ซ้ำ', () => C.matchBank('1113', [cap.id], [sug[0].key]), 'ALREADY_MATCHED');
const fee = D().bankTxns.find((t) => t.ref === 'FEE01'), intr = D().bankTxns.find((t) => t.ref === 'INT01');
throws('บันทึกคู่กับบัญชีคุม (ลูกหนี้) ไม่ได้', () => C.bookBankTxn(intr.id, { account: '1131' }), 'CONTROL_ACCOUNT_MANUAL');
const feeJe = C.bookBankTxn(fee.id, { account: '5410' });
ok('★ ค่าธรรมเนียมลงบัญชีเงินฝาก 1113 ฝั่งเครดิต สมุดรายวันจ่าย', feeJe.lines.some((l) => l.acc === '1113' && l.cr === M('25')) && feeJe.type === 'payment' && fee.matched);
const intJe = C.bookBankTxn(intr.id, { account: '4210', wht: '1', desc: 'ดอกเบี้ยรับ มิ.ย.' });
ok('★ ดอกเบี้ยหักภาษี 1%: เงินฝากรับสุทธิ ภาษีถูกหักเป็นเครดิตภาษี รายได้เต็มจำนวน',
  intJe.lines.find((l) => l.acc === '1113').dr === M('100') && intJe.lines.find((l) => l.acc === '1165').dr === M('1')
  && intJe.lines.find((l) => l.acc === '4210').cr === M('101') && intJe.type === 'receipt');
r6 = rec('1113', '2026-06');
ok('★ งบกระทบยอด มิ.ย. ผลต่างเป็นศูนย์ → กระทบยอดแล้ว', r6.ok && r6.diff === 0 && r6.unexplained === 0, fmt(r6.stmt) + ' vs ' + fmt(r6.book));
ok('★ ข้อตรวจก่อนปิดงวด มิ.ย. ผ่าน', item('2026-06').ok, item('2026-06').detail);

console.log('\n=== 5. เช็คค้างจ่ายข้ามเดือน: ดูยอดค้าง ณ สิ้นงวด ===');
const chq = jv('payment', '2026-06-28', 'จ่ายเช็ค 0012345 ค่าเช่า', [{ acc: '5321', dr: '30000' }, { acc: '1113', cr: '30000' }]);
r6 = rec('1113', '2026-06');
ok('เช็คที่ยังไม่ขึ้นสเตทเมนต์ = เช็คค้างจ่าย ผลต่างยังเป็นศูนย์', r6.cheques.length === 1 && r6.sumCheques === M('30000') && r6.ok);
C.importBankStatement('1113', csv([
  ['วันที่', 'รายการ', 'อ้างอิง', 'ถอน', 'ฝาก', 'คงเหลือ'],
  ['02/07/2569', 'CHQ 0012345', '0012345', '30000', '', '970075'],
  ['31/07/2569', 'ค่าธรรมเนียมรายเดือน', 'FEE07', '50', '', '970025'],
]), { name: 'scb-july.csv' });
const chqLine = D().bankTxns.find((t) => t.ref === '0012345');
ok('★ นำเข้าแล้วจับคู่อัตโนมัติกับเช็ค (ยอดเท่ากัน ห่าง 4 วัน)', !chqLine.matched && C.bankSuggest(chqLine)[0].key === chq.no);
C.matchBank('1113', [chqLine.id], [chq.no]);
ok('★ เดือน มิ.ย. เช็คยังค้างจ่าย (ธนาคารตัดเดือน ก.ค.)', rec('1113', '2026-06').cheques.length === 1 && rec('1113', '2026-06').ok);
const r7 = rec('1113', '2026-07');
ok('เดือน ก.ค. เช็คตัดแล้ว ค้างเฉพาะค่าธรรมเนียมที่ยังไม่บันทึก', r7.cheques.length === 0 && r7.unrecorded.length === 1);
ok('ยอดยกมา ก.ค. = ยอดปลายงวด มิ.ย.', r7.bal.opening === M('1000075') && r7.bal.openFrom === 'prev');
ok('ไฟล์ลงวันสิ้นเดือน → ตั้งยอดปลายงวด ก.ค.', r7.stmtEntered && r7.stmt === M('970025'));
const i7 = item('2026-07');
ok('★ ข้อตรวจบอกให้ชัดว่าค้างอะไร', !i7.ok && /รายการในสเตทเมนต์ที่ยังไม่ได้บันทึกบัญชี 1 รายการ/.test(i7.detail) && /ผลต่าง \(50\.00\)/.test(i7.detail), i7.detail);
C.bookBankTxn(D().bankTxns.find((t) => t.ref === 'FEE07').id, '5410', 'ค่าธรรมเนียม ก.ค.');
ok('รูปแบบเดิม bookBankTxn(id, บัญชี, คำอธิบาย) ใช้ได้ และกระทบยอดครบ', rec('1113', '2026-07').ok && item('2026-07').ok, item('2026-07').detail);

console.log('\n=== 6. ยอดปลายงวดที่กรอกผิด / สเตทเมนต์ขาดรายการ ===');
C.setBankStatement({ acc: '1113', period: '2026-07', closing: '970,000.00' });
const rw = rec('1113', '2026-07');
ok('★ ยอดปลายงวดผิด → ผลต่างที่หาที่มาไม่ได้ และเตือนความต่อเนื่อง', !rw.ok && rw.unexplained === M('-25') && rw.gap === M('-25'), fmt(rw.unexplained));
ok('ข้อตรวจบอกผลต่างที่หาที่มาไม่ได้', /หาที่มาไม่ได้ \(25\.00\)/.test(item('2026-07').detail), item('2026-07').detail);
C.setBankStatement({ acc: '1113', period: '2026-07', closing: '970025' });
ok('แก้ยอดแล้วกลับมาตรง', rec('1113', '2026-07').ok);
C.setBankStatement({ acc: '1113', period: '2026-07', closing: '' });
ok('★ ลบยอดปลายงวดที่ยืนยัน → ไม่ผ่าน (ต้องกรอกยอดจากสเตทเมนต์จริง)', !rec('1113', '2026-07').ok && /ยังไม่ได้กรอกยอดคงเหลือปลายงวด/.test(item('2026-07').detail));
C.setBankStatement({ acc: '1113', period: '2026-07', closing: '970025' });
throws('ยอดอ่านไม่ออก', () => C.setBankStatement({ acc: '1113', period: '2026-07', closing: 'abc' }), 'AMOUNT_INVALID');
ok('เงินเบิกเกินบัญชีกรอกเป็นวงเล็บได้', C.setBankStatement({ acc: '1114', period: '2026-07', closing: '(1,500.00)' }).closing === M('-1500'));
C.setBankStatement({ acc: '1114', period: '2026-07', closing: '' });

console.log('\n=== 7. หลายบัญชี · โอนระหว่างบัญชี · หนึ่งต่อหลายรายการ ===');
C.addBankLines('1114', [
  { date: '2026-07-10', desc: 'รับโอนจากกระแสรายวัน', debit: '', credit: '200000' },
  { date: '2026-07-20', desc: 'ฝากเช็ค 2 ใบ', debit: '', credit: '15000' },
]);
C.setBankStatement({ acc: '1114', period: '2026-07', opening: '0', closing: '215000' });
C.addBankLines('1113', [{ date: '2026-07-10', desc: 'โอนไปออมทรัพย์', ref: 'TRF99', debit: '200000', credit: '' }]);
ok('★ เพิ่มรายการในสเตทเมนต์ที่ยืนยันยอดแล้ว → เตือนว่ายอดไม่ต่อเนื่อง', rec('1113', '2026-07').gap === M('200000') && !rec('1113', '2026-07').ok);
C.setBankStatement({ acc: '1113', period: '2026-07', closing: '770025' });
const tOut = D().bankTxns.find((t) => t.ref === 'TRF99'), tIn = D().bankTxns.find((t) => t.acc === '1114' && t.credit === M('200000'));
const trJe = C.bookBankTxn(tOut.id, { account: '1114', desc: 'โอนเงินไปบัญชีออมทรัพย์' });
ok('★ โอนระหว่างบัญชีลงสมุดรายวันทั่วไป Dr 1114 / Cr 1113', trJe.type === 'general'
  && trJe.lines.find((l) => l.acc === '1114').dr === M('200000') && trJe.lines.find((l) => l.acc === '1113').cr === M('200000'));
ok('★ ฝั่งบัญชีปลายทางจับคู่ให้ด้วย', tIn.matched && tIn.items[0] === trJe.no);
ok('ใบสำคัญเดียวจับคู่ได้ทั้งสองบัญชี (คนละสเตทเมนต์)', tOut.items[0] === trJe.no);
const cust = C.savePartner({ kind: 'customer', name: 'บริษัท ลูกค้าดี จำกัด', taxId: '0105548021442', address: 'กรุงเทพฯ' }).partner;
const invA = C.issueInvoice({ partnerCode: cust.code, date: '2026-07-15', lines: [{ desc: 'บริการ', qty: 1, price: '5000', taxCode: 'EXEMPT' }] });
const invB = C.issueInvoice({ partnerCode: cust.code, date: '2026-07-15', lines: [{ desc: 'บริการ', qty: 1, price: '10000', taxCode: 'EXEMPT' }] });
const rcA = C.receivePayment({ date: '2026-07-19', invoiceNo: invA.no, bankAccount: '1114' });
const rcB = C.receivePayment({ date: '2026-07-19', invoiceNo: invB.no, bankAccount: '1114' });
const dep = D().bankTxns.find((t) => t.acc === '1114' && t.credit === M('15000'));
ok('ไม่มีใบสำคัญยอด 15,000 ใบเดียว → ไม่แนะนำ ไม่จับอัตโนมัติ', C.bankSuggest(dep).length === 0 && C.bankAutoMatch('1114').matched === 0);
throws('★ เลือกใบเดียวยอดไม่ครบ', () => C.matchBank('1114', [dep.id], [rcA.entryNo]), 'BANK_MATCH_AMOUNT');
const m2 = C.matchBank('1114', [dep.id], [rcA.entryNo, rcB.entryNo]);
ok('★ สเตทเมนต์หนึ่งบรรทัดจับคู่ใบเสร็จสองใบที่รวมกันเท่ากัน', dep.matched && dep.items.length === 2 && m2.amount === M('15000'));
const r14 = rec('1114', '2026-07');
ok('★ บัญชีออมทรัพย์กระทบยอดแล้วแยกจากกระแสรายวัน', r14.ok && r14.book === M('215000'), fmt(r14.book));
ok('ข้อตรวจผ่านเมื่อทุกบัญชีที่มีความเคลื่อนไหวตรง', item('2026-07').ok && /1113 ตรงกัน/.test(item('2026-07').detail) && /1114 ตรงกัน/.test(item('2026-07').detail), item('2026-07').detail);
C.unmatchBank(m2.matchId);
ok('ยกเลิกการจับคู่ → กลับไปรอ', !dep.matched && dep.items.length === 0 && !rec('1114', '2026-07').ok);
C.addBankLines('1114', [{ date: '2026-07-25', desc: 'ฝากเช็ค 5,000', credit: '5000' }, { date: '2026-07-26', desc: 'ฝากเช็ค 10,000', credit: '10000' }]);
D().bankTxns.splice(D().bankTxns.indexOf(dep), 1);
const two = D().bankTxns.filter((t) => t.acc === '1114' && !t.matched);
C.matchBank('1114', two.map((t) => t.id), [rcA.entryNo, rcB.entryNo]);
ok('★ หลายบรรทัดต่อหลายใบ (ยอดรวมเท่ากัน)', two.every((t) => t.matched && t.matchId === two[0].matchId));
ok('กลุ่มที่บรรทัดลงวันหลังสิ้นงวด ไม่นับว่าตรง ณ สิ้นงวดก่อนหน้า', rec('1114', '2026-06').beforeStart);

console.log('\n=== 8. กลับรายการ/ยกเลิกเอกสาร ทำให้รายการกลับไปรอกระทบยอด ===');
C.voidDocument('receipt', rcA.no, 'ลูกค้าเช็คคืน ทดสอบ');
ok('★ ยกเลิกใบเสร็จ → ทั้งกลุ่มที่จับคู่กลับไปรอ', two.every((t) => !t.matched && !t.matchId));
const itemsAfter = C.bankBookItems('1114', '2026-07-31').map((i) => i.key);
ok('★ ใบเสร็จกับใบกลับรายการของมันหักล้างกัน ไม่ค้างเป็นรายการระหว่างทาง', itemsAfter.indexOf(rcA.entryNo) < 0, itemsAfter.join(','));
const bounce = C.addBankLines('1114', [{ date: '2026-07-27', desc: 'เช็คคืน', debit: '5000' }])[0];
const five = D().bankTxns.find((t) => t.acc === '1114' && t.credit === M('5000'));
C.matchBank('1114', [five.id, bounce.id], []);
ok('★ เงินเข้าแล้วเช็คคืนในสเตทเมนต์ หักล้างกันเองได้โดยไม่ต้องมีใบสำคัญ', five.matched && bounce.matched);
throws('จับคู่ในสเตทเมนต์ที่ไม่หักล้างเป็นศูนย์โดยไม่มีใบสำคัญ', () => C.matchBank('1114', [D().bankTxns.find((t) => t.acc === '1114' && t.credit === M('10000')).id], []), 'BANK_MATCH_NO_ITEM');
C.matchBank('1114', [D().bankTxns.find((t) => t.acc === '1114' && t.credit === M('10000')).id], [rcB.entryNo]);
C.setBankStatement({ acc: '1114', period: '2026-07', closing: '210000' });
ok('กลับมากระทบยอดได้ครบหลังเช็คคืน', rec('1114', '2026-07').ok);
const revd = C.reverse(feeJe.no, 'บันทึกค่าธรรมเนียมผิดบัญชี');
ok('★ กลับรายการใบสำคัญที่บันทึกจากหน้ากระทบยอดได้ บรรทัดสเตทเมนต์กลับไปรอ', !fee.matched && revd.src === 'reversal');
C.bookBankTxn(fee.id, { account: '5410', date: '2026-06-05' });

console.log('\n=== 9. ทำเป็นชุดเดียว ===');
const nEntries = D().entries.length, nTx = D().bankTxns.length;
C.addBankLines('1113', [{ date: '2026-07-31', desc: 'ค่าธรรมเนียมพิเศษ', debit: '10' }]);
const extra = D().bankTxns[D().bankTxns.length - 1];
D().periods.find((p) => p.code === '2026-07').status = 'closed';
throws('บันทึกเข้างวดที่ปิดแล้ว', () => C.bookBankTxn(extra.id, { account: '5410' }), 'PERIOD_CLOSED');
ok('★ ล้มแล้วไม่มีใบสำคัญค้าง และบรรทัดยังไม่จับคู่', D().entries.length === nEntries && !extra.matched);
const late = C.bookBankTxn(extra.id, { account: '5410', date: '2026-08-01' });
ok('บันทึกในงวดถัดไปที่เปิดอยู่ได้', late.date === '2026-08-01' && extra.matched);
ok('★ ก.ค.: ค่าธรรมเนียมที่บันทึกใน ส.ค. ยังเป็นรายการที่ยังไม่บันทึก ณ สิ้น ก.ค.', rec('1113', '2026-07').unrecorded.some((t) => t.id === extra.id));
ok('ส.ค.: รายการนั้นตรงแล้ว', !rec('1113', '2026-08').unrecorded.some((t) => t.id === extra.id));
throws('ลบบรรทัดที่จับคู่แล้วไม่ได้', () => C.deleteBankLine(extra.id), 'BANK_LINE_MATCHED');
throws('เพิ่มรายการไม่มีจำนวนเงิน', () => C.addBankLines('1113', [{ date: '2026-08-02', desc: 'x' }]), 'BANK_LINE_AMOUNT');
throws('เพิ่มรายการทั้งถอนและฝาก', () => C.addBankLines('1113', [{ date: '2026-08-02', debit: '1', credit: '1' }]), 'BANK_LINE_AMOUNT');
throws('วันที่ผิด', () => C.addBankLines('1113', [{ date: '02/08/2026', debit: '1' }]), 'BANK_LINE_DATE');
throws('จำนวนเงินอ่านไม่ออก ไม่กลายเป็นศูนย์เงียบ ๆ', () => C.addBankLines('1113', [{ date: '2026-08-02', debit: 'ห้าร้อย' }]), 'AMOUNT_INVALID');
const aug = C.addBankLines('1113', [{ date: '2026-08-05', desc: 'ดอกเบี้ย', credit: '(9.90)' }])[0];
ok('จำนวนเงินในวงเล็บอ่านได้', aug.credit === M('9.9'));
throws('ภาษีถูกหักอ่านไม่ออก', () => C.bookBankTxn(aug.id, { account: '4210', wht: 'x' }), 'AMOUNT_INVALID');
C.deleteBankLine(aug.id);
ok('บรรทัดที่ล้มทั้งชุดไม่เหลือค้าง', D().bankTxns.length === nTx + 1);

console.log('\n=== 10. เริ่มกระทบยอดกลางปี: รายการค้าง ณ วันเริ่ม ===');
fresh();
jv('receipt', '2026-03-01', 'รับเงินทุน', [{ acc: '1113', dr: '500000' }, { acc: '3120', cr: '500000' }]);
const oldChq = jv('payment', '2026-03-29', 'จ่ายเช็ค 777 ค่าที่ปรึกษา', [{ acc: '5334', dr: '20000' }, { acc: '1113', cr: '20000' }]);
C.setBankStatement({ acc: '1113', period: '2026-04', opening: '500,000', closing: '500,000' });
let ra = rec('1113', '2026-04');
ok('★ เริ่มกระทบยอด เม.ย.: รายการก่อนหน้าไม่ค้างเป็นร้อยรายการ', ra.start === '2026-04-01' && ra.outstanding.length === 0);
ok('ผลต่างยอดยกมาที่ยังไม่มีคำอธิบาย (เช็คค้างจาก มี.ค.)', ra.diff === M('20000') && !ra.ok, fmt(ra.diff));
ok('งวดก่อนวันเริ่ม: ข้อตรวจผ่านพร้อมบอกว่าเริ่มเมื่อไร', item('2026-03').ok && /เริ่มกระทบยอดในระบบตั้งแต่ เมษายน 2569/.test(item('2026-03').detail), item('2026-03').detail);
throws('ใบสำคัญหลังวันเริ่มเป็นรายการค้างยกมาไม่ได้', () => C.addBankBf({ acc: '1113', entryNo: 'XX' }), 'ENTRY_NOT_FOUND');
const bf = C.addBankBf({ acc: '1113', entryNo: oldChq.no });
ra = rec('1113', '2026-04');
ok('★ เลือกเช็คเดิมเป็นรายการค้าง ณ วันเริ่ม → ผลต่างเป็นศูนย์', ra.ok && ra.cheques.length === 1 && ra.cheques[0].key === oldChq.no, fmt(ra.diff));
throws('เลือกซ้ำ', () => C.addBankBf({ acc: '1113', entryNo: oldChq.no }), 'BANK_BF_DUPLICATE');
const manualBf = C.addBankBf({ acc: '1113', kind: 'deposit', date: '2026-03-31', desc: 'เงินฝากระหว่างทางจากระบบเดิม', amount: '1,000' });
ok('กรอกรายการค้างจากระบบเดิมเอง (เงินฝากระหว่างทาง)', manualBf.amount === M('1000') && rec('1113', '2026-04').deposits.length === 1);
C.deleteBankBf(manualBf.id);
C.addBankLines('1113', [{ date: '2026-04-03', desc: 'CHQ 777', ref: '777', debit: '20000' }]);
const l777 = D().bankTxns.find((t) => t.ref === '777');
ok('ระบบแนะนำเช็คค้างยกมาให้จับคู่', C.bankSuggest(l777)[0].key === oldChq.no);
C.matchBank('1113', [l777.id], [oldChq.no]);
C.setBankStatement({ acc: '1113', period: '2026-04', closing: '480,000' });
ok('★ เช็คค้างยกมาขึ้นเงินแล้ว เดือน เม.ย. กระทบยอดครบ', rec('1113', '2026-04').ok);
throws('ลบรายการค้างที่จับคู่แล้วไม่ได้', () => C.deleteBankBf(bf.id), 'BANK_LINE_MATCHED');

console.log('\n=== 11. ข้อมูลรุ่นเก่า และข้อมูลตัวอย่าง ===');
fresh();
const legacy = JSON.parse(JSON.stringify(D()));
legacy.bankTxns = [{ id: 1, date: '2026-07-03', desc: 'INTEREST', ref: 'I1', debit: 0, credit: M('10'), matched: false, suggest: 'x' }];
delete legacy.bankStmts; delete legacy.bankBf; delete legacy.bankImports;
C.loadState(legacy);
ok('★ เปิดข้อมูลเก่า: บรรทัดได้บัญชีเงินฝากหลัก และคอลเลกชันใหม่ถูกสร้าง', D().bankTxns[0].acc === '1113'
  && Array.isArray(D().bankStmts) && Array.isArray(D().bankBf) && Array.isArray(D().bankImports) && C.bankStmtRec('1113', '2026-07'));
C.buildSeed();
const demo = rec(C.accBySub('bank'), '2026-07');
ok('ข้อมูลตัวอย่าง: สเตทเมนต์ ก.ค. ผูกบัญชีเงินฝากหลัก', D().bankTxns.every((t) => t.acc === '1113') && D().bankTxns.length > 10);
ok('ข้อมูลตัวอย่าง: เหลือ 3 รายการที่ธนาคารลงแต่ยังไม่ได้บันทึก และมีรายการระหว่างทาง', demo.unrecorded.length === 3 && demo.outstanding.length >= 2 && demo.unexplained === 0);
demo.unrecorded.slice().forEach((t) => C.bookBankTxn(t.id, t.credit ? '4210' : '5410'));
ok('★ ข้อมูลตัวอย่าง: บันทึก 3 รายการแล้วกระทบยอดครบ', rec('1113', '2026-07').ok && item('2026-07').ok, item('2026-07').detail);
ok('ยอดคุมทั้งระบบยังตรง', C.reconciliationChecks('2026-07-31').allPassed);

done();
