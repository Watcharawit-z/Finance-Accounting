/* ทดสอบตัวย้ายข้อมูล — ไม่ต่อเครือข่าย ใช้ข้อมูลตัวอย่างใน fixtures/
   รันด้วย: node tools/flowaccount-import/test.js */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const core = require('./lib/core');
const map = require('./lib/map');

let pass = 0, fail = 0;
const ok = (label, cond, extra) => {
  if (cond) { pass++; console.log('  ผ่าน   ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ไม่ผ่าน ' + label + (extra ? '  ' + extra : '')); }
};
const B = (v) => core.fmt(v);

console.log('\n=== 1. แปลงข้อมูลคู่ค้าและสินค้า ===');
const contacts = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw/contacts.json'), 'utf8'));
const c1 = map.mapContact(contacts[0]);
ok('ลูกค้านิติบุคคลแปลงถูก', c1.partner.kind === 'customer' && c1.partner.entityType === 'juristic');
ok('สำนักงานใหญ่ → รหัสสาขา 00000', c1.partner.branch === '00000');
ok('เครดิตเทอมติดมาด้วย', c1.partner.termDays === 45);
ok('รวมที่อยู่หลายบรรทัดเป็นบรรทัดเดียว', c1.partner.address.indexOf('10120') > 0);

const c2 = map.mapContact(contacts[1]);
ok('ผู้ขายแปลงถูก', c2.partner.kind === 'vendor');
ok('"สาขา 2" → รหัสสาขา 00002', c2.partner.branch === '00002', c2.partner.branch);

const c3 = map.mapContact(contacts[2]);
ok('บุคคลธรรมดาแยกออกจากนิติบุคคล', c3.partner.entityType === 'individual');

const c4 = map.mapContact(contacts[3]);
ok('★ เลขผู้เสียภาษีผิดหลักที่ 13 ถูกเตือน ไม่ถูกกลืนหาย',
   c4.warnings.length === 1 && c4.warnings[0].message.indexOf('หลักที่ 13') > 0);

const products = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw/products.json'), 'utf8'));
const p1 = map.mapProduct(products[0]);
ok('สินค้ามีสต๊อกแปลงเป็นชนิด stock', p1.item.type === 'stock' && p1.item.qty === 120);
ok('ต้นทุนเฉลี่ยเป็นสตริงทศนิยม ไม่ใช่ float', p1.item.avgCost === '880.0000', p1.item.avgCost);
ok('บริการไม่มีสต๊อก', map.mapProduct(products[1]).item.type === 'service');

console.log('\n=== 2. เอกสารและการตรวจยอด ===');
const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw/tax-invoices.json'), 'utf8'));
const d1 = map.mapDocument(inv[0], 'invoice');
ok('ใบกำกับปกติแปลงได้', d1.ok && d1.doc.no === 'IV690712-001');
ok('ฐาน + ภาษี = ยอดรวม', core.M(d1.doc.base) + core.M(d1.doc.vat) === core.M(d1.doc.total));
ok('วันที่ตัดเหลือแค่วัน', d1.doc.date === '2026-07-12' && d1.doc.due === '2026-08-26');

const d2 = map.mapDocument(inv[1], 'invoice');
ok('★ ราคารวมภาษีถูกถอดฐานออกมาให้ ไม่ได้คูณ 7% ทับ',
   d2.ok && core.M(d2.doc.base) === core.M('10000') && core.M(d2.doc.vat) === core.M('700'),
   'ฐาน ' + d2.doc.base + ' ภาษี ' + d2.doc.vat);
ok('การถอดฐานถูกบันทึกเป็นข้อสังเกต', d2.warnings.some((w) => w.message.indexOf('ถอดฐาน') >= 0));

const d4 = map.mapDocument(inv[3], 'invoice');
ok('★ ใบที่ยอดบวกกันไม่ลงตัวถูกตีกลับ ไม่ถูกดัดตัวเลขให้ตรง',
   !d4.ok && d4.error.why.indexOf('ไม่เท่ากับ') > 0, d4.ok ? '' : d4.error.why);

const bills = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw/purchases.json'), 'utf8'));
const b1 = map.mapDocument(bills[0], 'bill');
ok('อ่านยอดคงค้างจาก remainingAmount ได้', b1.ok && core.M(b1.doc.paid) === 0);
const b2 = map.mapDocument(bills[1], 'bill');
ok('จ่ายครบแล้วคำนวณเป็นชำระเต็มจำนวน', core.M(b2.doc.paid) === core.M(b2.doc.total));
ok('เตือนเรื่องภาษีหัก ณ ที่จ่ายที่ต้องเลือกประเภทเงินได้เอง',
   b2.warnings.some((w) => w.message.indexOf('หัก ณ ที่จ่าย') >= 0));

ok('ตัดเฉพาะใบที่ยังค้าง ณ วันตัดยอด', map.isOpenAt(b1.doc, '2026-07-31') && !map.isOpenAt(b2.doc, '2026-07-31'));
ok('ใบที่ออกหลังวันตัดยอดไม่ถูกยกมา', !map.isOpenAt(d1.doc, '2026-07-01'));

console.log('\n=== 3. อ่านงบทดลองจากไฟล์ CSV จริง ===');
const rows = core.parseCsv(fs.readFileSync(path.join(__dirname, 'fixtures/trial-balance.csv'), 'utf8'));
const det = core.detectColumns(rows);
ok('ข้ามหัวรายงาน 3 บรรทัดแล้วหาหัวตารางเจอ', det.ok && det.headerRow === 3, 'แถวที่ ' + (det.headerRow + 1));
const tb = core.readTrialBalance(rows, det.map, det.headerRow);
ok('อ่านได้ 8 บัญชี', tb.rows.length === 8, tb.rows.length + ' บัญชี');
ok('★ บรรทัด "รวม" ถูกข้าม ไม่ถูกนับเป็นบัญชี', tb.skipped.some((s) => s.why.indexOf('ผลรวม') >= 0));
const dr = tb.rows.reduce((s, r) => s + r.debit, 0);
const cr = tb.rows.reduce((s, r) => s + r.credit, 0);
ok('เดบิตรวม = เครดิตรวม', dr === cr, B(dr) + ' = ' + B(cr));
ok('อ่านตัวเลขที่มีคอมม่าและอัญประกาศได้', dr === core.M('1499340'), B(dr));

console.log('\n=== 3.1 พนักงาน ===');
const emps = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw/employees.json'), 'utf8'));
const e1 = map.mapEmployee(emps[0]);
ok('ประกอบคำนำหน้ากับชื่อสกุลเป็นชื่อเต็ม', e1.employee.name === 'นาย วิชัย นำชัย', e1.employee.name);
ok('เงินเดือนเป็นสตริงทศนิยม', e1.employee.salary === '32000.0000');
ok('วันเริ่มงานตัดเหลือแค่วัน', e1.employee.hired === '2023-05-01');
ok('คนที่มีวันสิ้นสุดถือว่าพ้นสภาพ', map.mapEmployee(emps[2]).employee.active === false);
ok('★ ไม่มีเงินเดือนในระบบเดิมต้องเตือน ไม่ปล่อยให้ทำเงินเดือนด้วยศูนย์',
   map.mapEmployee(emps[3]).warnings.some((w) => w.message.indexOf('เงินเดือน') >= 0));

console.log('\n=== 3.2 ยอดรวมที่เป็นยอดหลังหักภาษี ณ ที่จ่าย ===');
const pur = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/raw/purchases.json'), 'utf8'));
const wnet = map.mapDocument(pur[2], 'bill');
ok('★ บวกภาษีหัก ณ ที่จ่ายกลับเป็นยอดหนี้ ไม่ตีกลับทั้งใบ',
   wnet.ok && core.M(wnet.doc.total) === core.M('53500'), wnet.ok ? wnet.doc.total : wnet.error.why);
ok('★ ไม่ถูกเข้าใจผิดว่าเป็นราคารวมภาษี ฐานภาษีจึงยังถูก',
   core.M(wnet.doc.base) === core.M('50000'), wnet.doc.base);
ok('★ ยอดที่ชำระแล้วคิดบนฐานเดียวกับระบบเดิม จึงไม่กลายเป็นจ่ายบางส่วน',
   core.M(wnet.doc.paid) === 0, wnet.doc.paid);

console.log('\n=== 4. แปลงทั้งชุดแล้วนำเข้าระบบจริง ===');
const outDir = fs.mkdtempSync('/tmp/fa-test-');
execFileSync(process.execPath, [path.join(__dirname, 'convert.js'),
  '--raw', path.join(__dirname, 'fixtures/raw'),
  '--cutoff', '2026-07-31',
  '--tb', path.join(__dirname, 'fixtures/trial-balance.csv'),
  '--out', path.join(outDir, 'financii-import.json')], { stdio: 'pipe' });

const pkg = JSON.parse(fs.readFileSync(path.join(outDir, 'financii-import.json'), 'utf8'));
const errCsv = fs.readFileSync(path.join(outDir, 'errors.csv'), 'utf8');
ok('แฟ้มข้อมูลมีรูปแบบที่ระบบรู้จัก', pkg.format === 'financii-import/1' && pkg.cutoff === '2026-07-31');
ok('★ ใบที่แปลงไม่ได้ถูกเขียนลง errors.csv ไม่หายเงียบ',
   errCsv.indexOf('IV690720-004') > 0, errCsv.trim().split('\n').length - 1 + ' บรรทัด');
ok('คู่ค้าที่โผล่เฉพาะบนเอกสารถูกสร้างให้ครบ', pkg.partners.length >= 4, pkg.partners.length + ' ราย');
ok('พนักงานอยู่ในแฟ้มข้อมูล ไม่ถูกทิ้ง', pkg.employees.length === 4, pkg.employees.length + ' คน');

const cov = Object.fromEntries((pkg.coverage || []).map((c) => [c.source, c]));
ok('★ รายงานความครบถ้วนครอบคลุมทุกชุดข้อมูลที่ดึงมา',
   ['tax-invoices','receivable-invoices','purchases','receipts','credit-notes','debit-notes','employees']
     .every((k) => cov[k]), Object.keys(cov).join(', '));
ok('★ เอกสารเลขซ้ำข้ามชุดข้อมูลถูกตัดออก ไม่นับยอดลูกหนี้สองรอบ',
   cov['receivable-invoices'].duplicate === 1, 'ตัดซ้ำ ' + cov['receivable-invoices'].duplicate + ' ใบ');
ok('เอกสารที่ปิดแล้วถูกนับไว้ ไม่ได้หายเงียบ',
   cov['tax-invoices'].closed === 1 && cov['receipts'].closed === 1);
const noDup = new Set(pkg.openInvoices.map((d) => d.no));
ok('ไม่มีเลขที่ซ้ำในใบที่ยกมา', noDup.size === pkg.openInvoices.length, pkg.openInvoices.length + ' ใบ');

const credited = pkg.openInvoices.find((d) => d.no === 'IN690725-009');
ok('★ ใบลดหนี้ถูกหักออกจากใบกำกับที่ยังค้าง',
   credited && core.M(credited.credited) === core.M('10700'), credited && credited.credited);
ok('ใบลดหนี้ที่หาใบต้นทางไม่เจอถูกเตือน ไม่ถูกหักมั่ว',
   pkg.warnings.some((w) => w.message.indexOf('ไม่อยู่ในใบที่ยังค้าง') >= 0));

const dnOpen = pkg.openInvoices.find((d) => d.no === 'DN690726-001');
ok('★ ใบเพิ่มหนี้ที่ยังเก็บเงินไม่ได้ ถูกยกมาเป็นลูกหนี้ค้าง ไม่หายไปเฉย ๆ',
   dnOpen && core.M(dnOpen.total) === core.M('5350'), dnOpen && dnOpen.total);
ok('ใบเพิ่มหนี้ที่เก็บเงินครบแล้วไม่ถูกยกมาซ้ำ',
   !pkg.openInvoices.some((d) => d.no === 'DN690610-002')
   && cov['debit-notes'].closed === 1, 'ปิดแล้ว ' + cov['debit-notes'].closed + ' ใบ');

/* โหลดเครื่องบัญชีจริงแล้วนำเข้าเข้าไปในบริษัทเปล่า */
const webapp = path.join(__dirname, '..', '..', 'webapp', 'src');
const src = ['engine.js', 'operations.js', 'seed.js', 'import.js']
  .map((f) => fs.readFileSync(path.join(webapp, f), 'utf8')).join('\n');
const app = new Function(src + `
  return { DB, buildBlank, importPackage, reconciliationChecks, trialBalance, balanceSheet,
           aging, fmt, M, receivePayment, runPayroll, DomainError };`)();

app.buildBlank({ name: 'บริษัท ทดสอบย้ายข้อมูล จำกัด', year: 2026 });
ok('บริษัทเปล่ามีผังบัญชีครบแต่ไม่มีรายการ',
   app.DB.accounts.length > 60 && app.DB.entries.length === 0);

const res = app.importPackage(pkg, {});
ok('นำเข้าสำเร็จ', res.opening && res.opening.entry.no.startsWith('OB'), res.opening.entry.no);
ok('คู่ค้าเข้าระบบครบ', res.partners === pkg.partners.length, res.partners + ' ราย');
ok('สินค้าเข้าระบบครบ', res.items === pkg.items.length, res.items + ' รายการ');
ok('ลูกหนี้ค้างยกมาเข้าเป็นบัญชีย่อย', res.invoices === 4, res.invoices + ' ใบ');
ok('เจ้าหนี้ค้างยกมาเข้าเป็นบัญชีย่อย', res.bills === 2, res.bills + ' รายการ');
ok('★ พนักงานเข้าระบบครบ พร้อมทำเงินเดือนงวดแรก',
   res.employees === 4 && app.DB.employees.length === 4, res.employees + ' คน');
ok('คนที่พ้นสภาพไม่ถูกนับเป็นพนักงานปัจจุบัน',
   app.DB.employees.filter((e) => e.active).length === 3);

const tb2 = app.trialBalance('2026-01-01', '2026-12-31');
ok('งบทดลองหลังนำเข้าสมดุล', tb2.balanced, 'เดบิต ' + app.fmt(tb2.totalDr));
const bs2 = app.balanceSheet('2026-07-31');
ok('งบแสดงฐานะการเงินสมดุล', bs2.diff === 0, 'สินทรัพย์ ' + app.fmt(bs2.assets));

res.checks.forEach((c) => ok('ยอดคุม: ' + c.label, c.ok, c.ok ? '' : 'ต่าง ' + app.fmt(c.control - c.sub)));
ok('★ ยอดคุมผ่านครบทุกข้อหลังย้ายข้อมูล', res.allPassed);

const ar = app.aging('ar', '2026-07-31');
ok('อายุลูกหนี้ตรงกับบัญชีคุม', ar.totals.total === core.M('186180'), app.fmt(ar.totals.total));
const ap = app.aging('ap', '2026-07-31');
ok('★ อายุเจ้าหนี้ตรงกับบัญชีคุม แม้มีใบที่ยอดเป็นยอดหลังหักภาษี',
   ap.totals.total === core.M('147660'), app.fmt(ap.totals.total));

console.log('\n=== 5. กันย้ายซ้ำและรับชำระต่อจากยอดยกมา ===');
let dup = false;
try { app.importPackage(pkg, {}); } catch (e) { dup = e.code === 'ALREADY_IMPORTED'; }
ok('★ นำเข้าไฟล์เดิมซ้ำถูกปฏิเสธ', dup);

app.receivePayment({ invoiceNo: 'IV690712-001', date: '2026-08-05', amount: '38030' });
const ar2 = app.aging('ar', '2026-08-31');
ok('★ รับชำระหลังย้ายแล้วยอดลูกหนี้ลดถูกต้อง ไม่นับซ้ำกับยอดที่ชำระก่อนตัดยอด',
   ar2.totals.total === core.M('148150'), app.fmt(ar2.totals.total));
const rec2 = app.reconciliationChecks('2026-08-31');
ok('ยอดคุมยังตรงหลังรับชำระ', rec2.allPassed,
   rec2.checks.filter((c) => !c.ok).map((c) => c.label).join(', ') || '');

console.log('\n=== 6. ทำเงินเดือนงวดแรกด้วยพนักงานที่ย้ายมา ===');
app.DB.employees.forEach(function (e) { if (e.salary === 0) e.salary = core.M('25000'); });
const run = app.runPayroll('2026-08');
ok('★ ทำเงินเดือนได้ทันทีโดยไม่ต้องกรอกพนักงานใหม่', run.count === 3, run.count + ' คน');
ok('หักประกันสังคมตามเพดาน 875 บาท', run.slips.every((s) => s.sso <= core.M('875')));
ok('ยอดคุมยังตรงหลังทำเงินเดือน', app.reconciliationChecks('2026-08-31').allPassed);

fs.rmSync(outDir, { recursive: true, force: true });
console.log('\n' + '═'.repeat(40));
console.log(' ผ่าน ' + pass + ' ข้อ · ไม่ผ่าน ' + fail + ' ข้อ');
console.log('═'.repeat(40));
process.exit(fail ? 1 : 0);
