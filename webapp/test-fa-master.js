/* ทดสอบข้อมูลหลักแบบที่นักบัญชีคุ้นมือ — รหัสผู้ติดต่อที่ตั้งเอง เลขที่ถัดไปในหน้าตั้งค่า ค่าเริ่มต้นราคาของเอกสารใหม่
   และนำเข้าสมุดรายชื่อ/สินค้าจากไฟล์ (ดูตัวอย่างก่อนบันทึก ข้ามรายการซ้ำ ประวัติ และไฟล์แถวที่นำเข้าไม่ได้)
   รันด้วย node webapp/test-fa-master.js */
const { ctx, ok, throws, done } = require('./testlib');
const M = ctx.M;
const D = () => ctx.DB;

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const csvRows = (lines) => ctx.parseCsv(lines.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\n'));
const plan = (rows, opts) => {
  const det = ctx.detectMasterFile(rows);
  const read = ctx.readMasterFile(det.kind, rows, det.headerRow, det.map);
  return { det, read, plan: ctx.planMasterImport(det.kind, read, opts || {}) };
};

ctx.buildBlank({ name: 'บริษัท ทดสอบข้อมูลหลัก จำกัด', year: 2026 });
ctx.TODAY = '2026-06-30';

console.log('\n=== 1. รหัสผู้ติดต่อที่ตั้งเอง (ย้ายจากโปรแกรมเดิม) ===');
{
  const a = ctx.savePartner({ kind: 'customer', name: 'บริษัท รหัสเดิม จำกัด', newCode: 'C00001', taxId: tid('010555800001') }).partner;
  ok('★ ตั้งรหัสเองตอนสร้างได้', a.code === 'C00001', a.code);
  const b = ctx.savePartner({ kind: 'vendor', name: 'ผู้ขายรหัสอัตโนมัติ' }).partner;
  ok('ไม่ใส่รหัส ระบบตั้งให้เหมือนเดิม', /^VEN-\d{4}$/.test(b.code), b.code);
  throws('รหัสซ้ำกับที่มีอยู่ไม่ได้', () => ctx.savePartner({ kind: 'vendor', name: 'ซ้ำรหัส', newCode: 'C00001' }), 'PARTNER_CODE_DUPLICATE');
  throws('รหัสมีช่องว่างไม่ได้', () => ctx.savePartner({ kind: 'vendor', name: 'รหัสผิด', newCode: 'C 1' }), 'PARTNER_CODE_INVALID');
  throws('ใช้รหัสสงวน OPENING ไม่ได้', () => ctx.savePartner({ kind: 'vendor', name: 'สงวน', newCode: 'OPENING' }), 'PARTNER_CODE_INVALID');
  ctx.savePartner({ code: 'C00001', newCode: 'X9', kind: 'both', name: a.name, taxId: a.taxId });
  ok('แก้ไขรายเดิม รหัสไม่เปลี่ยนแม้ส่งรหัสใหม่มา และเปลี่ยนเป็นผู้จำหน่ายและลูกค้าได้',
    D().partners.some((p) => p.code === 'C00001' && p.kind === 'both') && !D().partners.some((p) => p.code === 'X9'));
}

console.log('\n=== 2. ค่าเริ่มต้นราคาของเอกสารใหม่ (ฟังก์ชันเอกสาร) ===');
{
  ok('ค่าเริ่มต้นเดิม = ราคาไม่รวมภาษี', ctx.normPricing(null).mode === 'exclusive');
  const before = D().audit.length;
  const d = ctx.saveDocDefaults({ priceMode: 'inclusive' });
  ok('★ ตั้งเป็นราคารวมภาษี เอกสารใหม่เริ่มที่ราคารวมภาษี', d.priceMode === 'inclusive' && ctx.normPricing(null).mode === 'inclusive');
  ok('เอกสารที่ระบุราคาเองยังใช้ค่าของใบนั้น', ctx.normPricing({ mode: 'exclusive' }).mode === 'exclusive');
  ok('บันทึกในร่องรอยการตรวจสอบ พร้อมค่าก่อน/หลัง', D().audit.length === before + 1 && D().audit[0].id === 'docDefaults'
    && D().audit[0].after.priceMode === 'inclusive');
  throws('ค่าที่ไม่รู้จักถูกปฏิเสธ', () => ctx.saveDocDefaults({ priceMode: 'gross' }), 'PRICE_MODE_INVALID');
  const cust = ctx.savePartner({ kind: 'customer', name: 'ลูกค้าราคารวมภาษี', taxId: tid('010555800002'), address: 'กทม.' }).partner;
  const inv = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-10', lines: [{ desc: 'ของ', qty: 1, price: '107' }] });
  ok('★ ใบกำกับที่ไม่ได้ระบุ ใช้ราคารวมภาษีตามค่าเริ่มต้น: 107 = 100 + ภาษี 7', inv.base === M('100') && inv.vat === M('7') && inv.total === M('107'),
    ctx.fmt(inv.base) + ' + ' + ctx.fmt(inv.vat));
  ctx.saveDocDefaults({ priceMode: 'exclusive' });
  ok('ใบที่ออกไปแล้วไม่เปลี่ยนตามเมื่อกลับเป็นราคาไม่รวมภาษี', D().docs.invoice.find((x) => x.no === inv.no).total === M('107'));
}

console.log('\n=== 3. เลขที่ถัดไปในหน้าตั้งค่า (ไม่จองเลข) ===');
{
  const cust = D().partners.find((p) => p.name === 'ลูกค้าราคารวมภาษี');
  const seq = JSON.stringify(D().seq);
  const next = ctx.peekDocNo('invoice', '2026-06-20');
  ok('ดูเลขที่ถัดไปไม่ทำให้ตัวนับเปลี่ยน', JSON.stringify(D().seq) === seq, next);
  const inv = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-20', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  ok('★ เลขที่ที่แสดงตรงกับเลขที่ได้จริงตอนออกเอกสาร', inv.no === next, next + ' = ' + inv.no);
  const draft = { style: 'fa', reset: 'year', prefixes: { invoice: 'IV' } };
  ok('ตัวอย่างของค่าที่ยังไม่บันทึก: คำนำหน้าใหม่ + นับใหม่ทุกปี', ctx.peekDocNo('invoice', '2026-06-20', draft) === 'IV2026000001',
    ctx.peekDocNo('invoice', '2026-06-20', draft));
  ok('ตัวอย่างแบบเดิม', ctx.peekDocNo('invoice', '2026-06-20', { style: 'legacy', reset: 'month', prefixes: {} }) === 'INV2606-' + String(D().seq['invoice|2026-06'] + 1).padStart(5, '0'),
    ctx.peekDocNo('invoice', '2026-06-20', { style: 'legacy', reset: 'month', prefixes: {} }));
  ok('คำนำหน้าเดียวกันนับร่วมกัน (ใบเสร็จตั้งเป็น INV ต่อจากใบกำกับ)', ctx.peekDocNo('receipt', '2026-06-20', { style: 'fa', reset: 'month', prefixes: { receipt: 'INV' } })
    === ctx.peekDocNo('invoice', '2026-06-20'));
  ctx.saveNumbering(draft);
  const y = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-21', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  ok('บันทึกแล้วออกเลขตามที่เห็นในตัวอย่าง', y.no === 'IV2026000001', y.no);
  ok('ตัวอย่างใบถัดไปเลื่อนตาม', ctx.peekDocNo('invoice', '2026-07-01') === 'IV2026000002');
  /* ข้ามเลขที่มีอยู่แล้ว (เลขที่นำเข้ามาหรือพิมพ์เอง) แบบเดียวกับ nextNo */
  D().docs.invoice.push({ no: 'IV2026000002', date: '2026-07-01', status: 'void', lines: [] });
  ok('ข้ามเลขที่มีอยู่แล้ว', ctx.peekDocNo('invoice', '2026-07-01') === 'IV2026000003');
  D().docs.invoice.pop();
  ctx.saveNumbering({ style: 'fa', reset: 'month', prefixes: {} });
}

console.log('\n=== 4. นำเข้าสมุดรายชื่อจากไฟล์ ===');
{
  const tpl = ctx.parseCsv(ctx.masterTemplateCsv('contact'));
  const det = ctx.detectMasterFile(tpl);
  ok('★ แบบฟอร์มสมุดรายชื่อ อ่านคอลัมน์ได้ครบทุกช่อง', det && det.kind === 'contact'
    && ctx.MASTER_FIELDS.contact.every((f) => det.map[f[0]] !== undefined), det && Object.keys(det.map).length + ' ช่อง');
  const ptpl = ctx.parseCsv(ctx.masterTemplateCsv('product'));
  const pdet = ctx.detectMasterFile(ptpl);
  ok('★ แบบฟอร์มสินค้า อ่านคอลัมน์ได้ครบทุกช่อง', pdet && pdet.kind === 'product'
    && ctx.MASTER_FIELDS.product.every((f) => pdet.map[f[0]] !== undefined), pdet && Object.keys(pdet.map).length + ' ช่อง');
  ok('งบทดลองไม่ถูกเข้าใจผิดว่าเป็นสมุดรายชื่อ', !ctx.detectMasterFile(ctx.parseCsv('รหัสบัญชี,ชื่อบัญชี,เดบิต,เครดิต\n1111,เงินสด,100,\n')));
  ok('ผังบัญชีไม่ถูกเข้าใจผิดว่าเป็นสินค้า', !ctx.detectMasterFile(ctx.parseCsv('รหัสบัญชี,ชื่อบัญชี,ประเภทบัญชี,หมวดบัญชี\n1111,เงินสด,สินทรัพย์,1\n')));
  ok('ไฟล์ยอดค้างรายใบไม่ถูกเข้าใจผิด', !ctx.detectMasterFile(ctx.parseCsv('ชื่อลูกค้า,เลขที่เอกสาร,วันที่,ครบกำหนด,ยอดค้าง\nก,IV1,2026-01-01,,100\n')));

  const existing = ctx.savePartner({ kind: 'customer', name: 'บริษัท มีอยู่แล้ว จำกัด', taxId: tid('010555811111'), branch: '00000' }).partner;
  const rows = csvRows([
    ['รหัส', 'ประเภท', 'ชื่อ', 'เลขประจำตัวผู้เสียภาษี', 'สาขา', 'ชื่อสาขา', 'ผู้ติดต่อ', 'อีเมล', 'มือถือ', 'โทรศัพท์', 'ที่อยู่', 'รหัสไปรษณีย์',
      'ที่อยู่จัดส่ง', 'เครดิต (วัน)', 'ธนาคาร', 'เลขที่บัญชี', 'ชื่อบัญชี', 'ประเภทบัญชี', 'หัก ณ ที่จ่าย', 'หมายเหตุ'],
    ['C-100', 'ลูกค้า', 'บริษัท ก้าวหน้า จำกัด', tid('010555822222').slice(1), 'สำนักงานใหญ่', 'สำนักงานใหญ่', 'คุณเอ', 'a@kaona.co.th', '812345678', '021112222',
      '1 ถนนสีลม กรุงเทพฯ', '10500', '', '30', '', '', '', '', 'ค่าบริการ', 'ลูกค้าประจำ'],
    ['', 'ผู้จำหน่าย', 'บริษัท วัสดุดี จำกัด', tid('010555833333'), 'สาขาที่ 2', 'บางนา', 'คุณบี', '', '', '', '9 บางนา กรุงเทพฯ', '10260',
      '9/1 คลังสินค้าบางนา', '45 วัน', 'กสิกรไทย', '123-4-56789-0', 'บจก. วัสดุดี', 'กระแสรายวัน', 'ค่าขนส่ง', ''],
    ['', 'ผู้ขายและลูกค้า', 'นายสมชาย ใจดี', '', '', '', '', '', '0899999999', '', 'นนทบุรี', '11000', '', '0', '', '', '', '', '', ''],
    ['', 'ผู้ขาย', 'บริษัท มีอยู่แล้ว จำกัด', existing.taxId, '00000', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'ลูกค้า', 'บริษัท มีอยู่แล้ว จำกัด (ซ้ำ)', existing.taxId, '00000', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'ลูกค้า', 'บริษัท เลขผิด จำกัด', '0105558000000', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'ลูกค้า', 'บริษัท อีเมลผิด จำกัด', '', '', '', '', 'abc', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'คู่แข่ง', 'บริษัท ประเภทแปลก จำกัด', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', 'ลูกค้า', 'บริษัท ก้าวหน้า จำกัด (คีย์ซ้ำในไฟล์)', tid('010555822222'), '00000', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['', '', 'รวม 9 ราย', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  const snapBefore = JSON.stringify(D());
  const P = plan(rows, { defaultKind: 'customer' });
  ok('★ ดูตัวอย่างแล้วข้อมูลในระบบไม่เปลี่ยนเลย (ลองบันทึกแล้วคืนค่า)', JSON.stringify(D()) === snapBefore);
  const st = P.plan.rows.map((r) => r.status).join(',');
  ok('★ ผลแต่ละแถว: ใหม่ 3 · เพิ่มบทบาท 1 · ซ้ำ 2 · นำเข้าไม่ได้ 3', st === 'new,new,new,widen,dup,bad,bad,bad,dup', st);
  ok('แถวว่างและบรรทัดผลรวมข้ามอัตโนมัติ ไม่นับเป็นแถวที่ผิด', P.read.skipped.length === 1 && P.read.rows.length === 9, JSON.stringify(P.read.skipped));
  const why = (i) => P.plan.rows[i].why;
  ok('เหตุผลของแถวที่นำเข้าไม่ได้บอกชัด', /หลักที่ 13/.test(why(5)) && /อีเมล/.test(why(6)) && /ประเภทผู้ติดต่อ "คู่แข่ง"/.test(why(7)), why(7));
  ok('ซ้ำกับแถวก่อนหน้าในไฟล์เดียวกัน บอกเลขแถว', /แถว 2 ในไฟล์นี้/.test(why(8)), why(8));
  ok('ซ้ำกับทะเบียน บอกรหัสรายเดิม', why(4).indexOf(existing.code) >= 0, why(4));

  const r = ctx.importMasterFile('contact', P.read, { name: 'contacts.csv', defaultKind: 'customer' });
  ok('★ นำเข้าจริงได้ผลเท่ากับตัวอย่าง', r.created === 3 && r.widened === 1 && r.dup === 2 && r.bad === 3, JSON.stringify([r.created, r.widened, r.dup, r.bad]));
  const k = D().partners.find((p) => p.code === 'C-100');
  ok('★ ใช้รหัสเดิมจากไฟล์ · เลขผู้เสียภาษีที่ Excel ตัดเลข 0 หน้าได้คืน · มือถือได้เลข 0 คืน',
    k && k.taxId === tid('010555822222') && k.mobile === '0812345678' && k.branch === '00000', k && k.taxId + ' ' + k.mobile);
  ok('ช่องติดต่อ ที่อยู่ เครดิต หัก ณ ที่จ่าย หมายเหตุ ครบ', k.contactPerson === 'คุณเอ' && k.email === 'a@kaona.co.th' && k.phone === '021112222'
    && k.zip === '10500' && k.termDays === 30 && k.whtCode === 'WHT_SERVICE' && k.note === 'ลูกค้าประจำ' && k.branchName === 'สำนักงานใหญ่');
  const v = D().partners.find((p) => p.name === 'บริษัท วัสดุดี จำกัด');
  ok('★ ผู้ขายสาขาที่ 2: สาขา 00002 ที่อยู่จัดส่ง เครดิต "45 วัน" และบัญชีธนาคารกระแสรายวัน', v && v.kind === 'vendor' && v.branch === '00002'
    && v.branchName === 'บางนา' && v.shipAddress === '9/1 คลังสินค้าบางนา' && v.termDays === 45 && v.bankName === 'กสิกรไทย'
    && v.bankAccount === '123-4-56789-0' && v.bankAccountType === 'current' && v.whtCode === 'WHT_TRANSPORT', v && v.code);
  const s = D().partners.find((p) => p.name === 'นายสมชาย ใจดี');
  ok('บุคคลธรรมดา (เดาจากคำนำหน้าชื่อ) เป็นผู้จำหน่ายและลูกค้า ไม่มีสาขา', s && s.kind === 'both' && s.entityType === 'individual' && s.branch === null);
  ok('★ รายที่มีอยู่แล้วเป็นลูกค้า ไฟล์บอกเป็นผู้ขาย → ตั้งเป็นผู้จำหน่ายและลูกค้า ไม่สร้างซ้ำ',
    existing.kind === 'both' && D().partners.filter((p) => p.taxId === existing.taxId).length === 1);
  const rec = D().masterImports[0];
  ok('★ ประวัติการนำเข้า: ไฟล์ จำนวน และแถวที่ไม่ได้นำเข้าพร้อมเหตุผล', rec.name === 'contacts.csv' && rec.kind === 'contact' && rec.rows === 9
    && rec.rejects.length === 5 && rec.codes.indexOf('C-100') >= 0);
  const csv = ctx.masterRejectsCsv(rec);
  const back = ctx.parseCsv(csv);
  ok('★ ไฟล์แถวที่นำเข้าไม่ได้: คอลัมน์เดิมครบ + ผล + เหตุผล + แถวในไฟล์เดิม', back[0].slice(-3).join('|') === 'ผลการนำเข้า|เหตุผล|แถวในไฟล์เดิม'
    && back.length === 6 && back[1][2] === 'บริษัท มีอยู่แล้ว จำกัด (ซ้ำ)' && /หลักที่ 13/.test(back[2][back[2].length - 2]), back.length + ' แถว');
  ok('เปิดใน Excel ภาษาไทยไม่เพี้ยน (มี BOM)', csv.charCodeAt(0) === 0xfeff);
  const again = plan(back, { defaultKind: 'customer' });
  ok('★ ลากไฟล์แถวที่ไม่ได้นำเข้ากลับเข้ามาได้ทันที (อ่านคอลัมน์เดิมได้ ข้ามคอลัมน์เหตุผล)', again.det.kind === 'contact' && again.read.rows.length === 5
    && again.plan.counts.dup === 2 && again.plan.counts.bad === 3);
  const re = plan(rows, { defaultKind: 'customer' });
  ok('นำเข้าไฟล์เดิมซ้ำอีกรอบ — ทุกแถวที่เคยเข้าแล้วขึ้นว่าซ้ำ ไม่สร้างใหม่', re.plan.counts.new === 0 && re.plan.counts.widen === 0, JSON.stringify(re.plan.counts));
}

console.log('\n=== 5. นำเข้าสินค้าและบริการจากไฟล์ ===');
{
  ctx.saveItem({ newCode: 'OLD-1', name: 'สินค้าเดิม', type: 'stock', barcode: '8850000009999' });
  const rows = csvRows([
    ['รหัสสินค้า', 'ชื่อสินค้า', 'ประเภท', 'หมวดหมู่', 'หน่วย', 'บาร์โค้ด', 'ราคาขาย', 'ภาษีขาย', 'บัญชีรายได้', 'ราคาซื้อ', 'ภาษีซื้อ', 'บัญชีค่าใช้จ่าย', 'จุดสั่งซื้อ'],
    ['SV-1', 'ค่าออกแบบ', 'บริการ', 'งานออกแบบ', 'งาน', '', '5,000', 'ไม่รวมภาษี', '', '', '', '', ''],
    ['NS-1', 'ถุงผ้า', 'สินค้าไม่นับสต๊อก', '', 'ใบ', '8850000000011', '120', 'รวมภาษี', '4111', '80', 'ไม่รวม VAT', '5321', ''],
    ['ST-1', 'สายไฟ', 'สินค้านับสต๊อก', 'ไฟฟ้า', 'ม้วน', '', '1200', '0%', '', '850.50', 'ยกเว้น', '5321', '5'],
    ['', 'ของไม่ระบุประเภท', '', '', 'ชิ้น', '', '10', '', '', '', '', '', ''],
    ['OLD-1', 'สินค้าเดิม (รหัสซ้ำ)', 'สินค้านับสต๊อก', '', '', '', '1', '', '', '', '', '', ''],
    ['', 'สินค้าเดิมบาร์โค้ดซ้ำ', '', '', '', '8850000009999', '1', '', '', '', '', '', ''],
    ['X-1', 'ราคาผิด', 'บริการ', '', '', '', 'ฟรี', '', '', '', '', '', ''],
    ['X-2', 'บัญชีผิด', 'บริการ', '', '', '', '100', '', '9999', '', '', '', ''],
    ['X-3', 'บัญชีรายได้ผิดหมวด', 'บริการ', '', '', '', '100', '', '5321', '', '', '', ''],
  ]);
  const P = plan(rows, { defaultType: 'nonstock' });
  ok('จับได้ว่าเป็นไฟล์สินค้า', P.det.kind === 'product');
  const st = P.plan.rows.map((r) => r.status).join(',');
  ok('★ ผลแต่ละแถว: ใหม่ 4 · ซ้ำ 2 (รหัส/บาร์โค้ด) · นำเข้าไม่ได้ 3', st === 'new,new,new,new,dup,dup,bad,bad,bad', st);
  ok('เหตุผล: ราคาอ่านไม่ออก · ไม่พบบัญชี · บัญชีใช้กับสินค้าไม่ได้', /ราคาขาย "ฟรี"/.test(P.plan.rows[6].why) && /บัญชีรายได้ "9999"/.test(P.plan.rows[7].why)
    && /ใช้กับสินค้านี้ไม่ได้/.test(P.plan.rows[8].why), P.plan.rows[8].why);
  const r = ctx.importMasterFile('product', P.read, { name: 'products.csv', defaultType: 'nonstock' });
  ok('นำเข้า 4 รายการ', r.created === 4 && r.dup === 2 && r.bad === 3);
  const it = (c) => D().items.find((x) => x.code === c);
  ok('★ บริการ: ราคา 5,000 (มีจุลภาค) ไม่รวมภาษี', it('SV-1').type === 'service' && it('SV-1').price === M('5000') && it('SV-1').sellVat === 'exclusive'
    && it('SV-1').category === 'งานออกแบบ');
  ok('★ สินค้าไม่นับสต๊อก: ราคาซื้อ ชนิดภาษีสองฝั่ง บาร์โค้ด บัญชีรายได้/ค่าใช้จ่าย', it('NS-1').type === 'nonstock' && it('NS-1').sellVat === 'inclusive'
    && it('NS-1').buyVat === 'exclusive' && it('NS-1').buyPrice === M('80') && it('NS-1').barcode === '8850000000011'
    && it('NS-1').revenueAcc === '4111' && it('NS-1').expenseAcc === '5321');
  ok('★ สินค้านับสต๊อก: ภาษี 0% / ยกเว้น จุดสั่งซื้อ และไม่เก็บบัญชีค่าใช้จ่าย (เข้าคลังเสมอ)', it('ST-1').type === 'stock' && it('ST-1').sellVat === 'zero'
    && it('ST-1').buyVat === 'exempt' && it('ST-1').buyPrice === M('850.5') && it('ST-1').reorder === 5 && it('ST-1').expenseAcc === '' && it('ST-1').qty === 0);
  const auto = D().items.find((x) => x.name === 'ของไม่ระบุประเภท');
  ok('แถวที่ไม่ระบุประเภทใช้ค่าที่เลือก (สินค้าไม่นับสต๊อก) และได้รหัสอัตโนมัติ', auto && auto.type === 'nonstock' && /^IT-\d{4}$/.test(auto.code), auto && auto.code);
  ok('ประวัติแยกชนิดสินค้า', D().masterImports[0].kind === 'product' && D().masterImports.length === 2);
  const re = plan(rows, { defaultType: 'nonstock' });
  ok('นำเข้าไฟล์เดิมซ้ำ — แถวที่ไม่มีรหัสจับซ้ำด้วยชื่อ', re.plan.counts.new === 0, JSON.stringify(re.plan.counts));
}

console.log('\n=== 6. ไฟล์ที่หัวคอลัมน์ไม่ตรงแบบฟอร์ม ===');
{
  /* คอลัมน์ "ประเภท" ใส่ นิติบุคคล/บุคคลธรรมดา — ต้องอ่านเป็นกลุ่ม ไม่ใช่ประเภทผู้ติดต่อ */
  const rows = csvRows([['ชื่อ', 'ประเภท', 'เลขผู้เสียภาษี', 'อีเมล'], ['นางสาวมานี มีนา', 'บุคคลธรรมดา', tid('310990012345'), 'manee@example.com'],
    ['บริษัท สอง จำกัด', 'นิติบุคคล', tid('010555844444'), '']]);
  const P = plan(rows, { defaultKind: 'vendor' });
  ok('คอลัมน์ประเภทที่ใส่ บุคคลธรรมดา/นิติบุคคล อ่านเป็นกลุ่ม', P.det.map.entityType === 1 && P.det.map.kind === undefined);
  ok('ไม่ระบุประเภทผู้ติดต่อ ใช้ค่าที่เลือก (ผู้ขาย)', P.plan.counts.new === 2);
  ctx.importMasterFile('contact', P.read, { name: 'vendors.csv', defaultKind: 'vendor' });
  const m = D().partners.find((p) => p.name === 'นางสาวมานี มีนา');
  ok('บุคคลธรรมดาเป็นผู้ขาย', m.kind === 'vendor' && m.entityType === 'individual' && m.email === 'manee@example.com');
  const few = ctx.parseCsv('ชื่อ,เลขผู้เสียภาษี\nบริษัท น้อย จำกัด,' + tid('010555855555') + '\n');
  ok('ไฟล์คอลัมน์น้อยไม่เดาเอง', !ctx.detectMasterFile(few));
  ok('★ มาจากปุ่มนำเข้าในหน้าทะเบียน (บอกชนิดแล้ว) อ่านไฟล์คอลัมน์น้อยได้', (ctx.detectMasterFile(few, 'contact') || {}).kind === 'contact');
}

console.log('\n=== 7. ผู้จำหน่ายและลูกค้าในงานอื่นที่เกี่ยวกับทะเบียน ===');
{
  const both = D().partners.find((p) => p.name === 'นายสมชาย ใจดี');
  const rd = ctx.readOpenItemsFile([['ชื่อผู้ขาย', 'เลขที่เอกสาร', 'วันที่', 'ยอดค้าง'], [both.name, 'B-1', '2026-06-01', '500']], 'ap');
  ok('★ ไฟล์เจ้าหนี้ยกมาจับคู่ผู้จำหน่ายและลูกค้าได้ ไม่สร้างผู้ขายซ้ำ', rd.rows[0].partnerCode === both.code && rd.creating.length === 0);
  const rd2 = ctx.readOpenItemsFile([['ชื่อลูกค้า', 'เลขที่เอกสาร', 'วันที่', 'ยอดค้าง'], [both.name, 'A-1', '2026-06-01', '500']], 'ar');
  ok('ไฟล์ลูกหนี้ยกมาจับคู่รายเดียวกันได้', rd2.rows[0].partnerCode === both.code);
  let code = null;
  try { ctx.registerDepositBalance('ap', { partnerCode: both.code, date: '2026-06-30', base: '100' }); } catch (e) { code = e.code; }
  ok('ตั้งเงินมัดจำจ่ายยกมาให้ผู้จำหน่ายและลูกค้าได้ (ไม่ถูกปฏิเสธว่าไม่ใช่ผู้ขาย)', code !== 'PARTNER_WRONG_SIDE', code || 'ผ่าน');
  const n = ctx.upsertPartner({ code: 'FA-9', name: 'จากแฟ้มรุ่นใหม่', kind: 'both', contactPerson: 'คุณดี', email: 'd@x.co', bankAccountType: 'current', phone: '02' });
  const p9 = D().partners.find((p) => p.code === 'FA-9');
  ok('แฟ้มข้อมูลจากตัวดึงรับผู้จำหน่ายและลูกค้าและช่องสมุดรายชื่อ', n === 1 && p9.kind === 'both' && p9.contactPerson === 'คุณดี' && p9.bankAccountType === 'current');
  ctx.upsertPartner({ code: 'FA-9', name: 'จากแฟ้มรุ่นเดิม', kind: 'both' });
  ok('แฟ้มรุ่นเดิมที่ไม่มีช่องใหม่ ไม่ลบค่าเดิม', p9.contactPerson === 'คุณดี' && p9.email === 'd@x.co');
  const u = ctx.upsertItem({ code: 'FI-1', name: 'สินค้าแฟ้ม', type: 'nonstock', buyPrice: '12.50', sellVat: 'inclusive', barcode: '123' });
  ok('แฟ้มข้อมูลรับสินค้าไม่นับสต๊อก ราคาซื้อ ชนิดภาษี บาร์โค้ด', u.item.type === 'nonstock' && u.item.buyPrice === M('12.5') && u.item.sellVat === 'inclusive' && u.item.barcode === '123');
  ok('งบทดลองสมดุล', ctx.trialBalance('2026-06-01', '2026-06-30').balanced);
}

done();
