/* ทดสอบงานขายประจำวันของบริษัทจริง (ไม่ใช่ข้อมูลตัวอย่าง) — เริ่มจากบริษัทเปล่าทุกครั้ง
   ใบกำกับให้บุคคลธรรมดา · ขายเงินสดใบกำกับอย่างย่อ · บัญชีรายได้รายบรรทัด · ใบสั่งซื้อแยกบัญชีรายบรรทัด
   แก้ไขเอกสารก่อนลงบัญชี · ใบเสนอราคา → ใบกำกับตรง ๆ · ทยอยออกใบกำกับจากใบสั่งขาย · เลิกใช้/ลบผู้ติดต่อ
   ทุกสถานการณ์ตรวจ: รายงานภาษีขาย = บัญชีแยกประเภท · อายุลูกหนี้ = บัญชีคุม · ยอดคุมทุกตัวผ่าน
   ใช้: node webapp/test-sales.js */
const { ctx, ok, throws, done } = require('./testlib');
const C = ctx;
const M = C.M, fmt = C.fmt;

C.buildBlank({ name: 'บริษัท ขายจริง จำกัด', year: 2026 });
const D = C.DB;
const JUNE = '2026-06-30';

/** ตรวจหลังทุกสถานการณ์ — ตัวเลขทุกชุดต้องตรงกันเสมอ */
function balanced(label, asOf) {
  const rec = C.reconciliationChecks(asOf);
  ok(label + ' — ยอดคุมทุกตัวผ่าน', rec.allPassed, rec.checks.filter((c) => !c.ok).map((c) => c.code + ' ' + fmt(c.control) + '≠' + fmt(c.sub)).join(', '));
  const period = asOf.slice(0, 7);
  const reg = D.taxTx.filter((t) => t.kind === 'vat_output' && t.period === period).reduce((s, t) => s + t.tax, 0);
  const gl = -C.balBySub(['output_vat'], asOf, period + '-01', (e) => e.src !== 'filing');
  ok(label + ' — รายงานภาษีขาย = ภาษีขายในบัญชีแยกประเภท', reg === gl, fmt(reg) + ' / ' + fmt(gl));
  const ag = C.aging('ar', asOf).totals.total;
  const ctl = C.balBySub(['trade_receivable'], asOf);
  ok(label + ' — อายุลูกหนี้รวม = บัญชีคุมลูกหนี้', ag === ctl, fmt(ag) + ' / ' + fmt(ctl));
}
const entry = (no) => D.entries.find((e) => e.no === no);
const crOf = (e, acc) => e.lines.filter((l) => l.acc === acc).reduce((s, l) => s + l.cr, 0);
const drOf = (e, acc) => e.lines.filter((l) => l.acc === acc).reduce((s, l) => s + l.dr, 0);

/* ---------- ทะเบียนเริ่มต้น ---------- */
const corp = C.savePartner({ kind: 'customer', name: 'บริษัท ลูกค้านิติบุคคล จำกัด', taxId: '0105548021442',
  branch: '00000', address: '1 ถนนสีลม กรุงเทพมหานคร 10500', termDays: 30 }).partner;
const vend = C.savePartner({ kind: 'vendor', name: 'บริษัท ผู้ขายของ จำกัด', taxId: '0105536000003',
  branch: '00000', address: '2 ถนนพระราม 4 กรุงเทพมหานคร 10110', termDays: 30 }).partner;
const widget = C.saveItem({ name: 'สินค้า ก', type: 'stock', uom: 'ชิ้น', price: '150' }).item;
const consult = C.saveItem({ name: 'ค่าที่ปรึกษา', type: 'service', uom: 'ชั่วโมง', price: '2000' }).item;
C.issueGoodsReceipt({ partnerCode: vend.code, date: '2026-06-01', lines: [{ itemCode: widget.code, qty: 100, price: '80' }] });

console.log('\n=== 1. ใบกำกับภาษีให้บุคคลธรรมดาและลูกค้าที่ไม่ได้จด VAT ===');
const person = C.savePartner({ kind: 'customer', name: 'นายสมชาย ใจดี', entityType: 'individual',
  taxId: '1101700230708', address: '9 ซอยสุขุมวิท 11 กรุงเทพมหานคร 10110' }).partner;
ok('บุคคลธรรมดาที่ไม่ได้จด VAT ไม่มีสาขา', person.branch === null && person.vatRegistered === false);
const invP = C.issueInvoice({ partnerCode: person.code, date: '2026-06-02',
  lines: [{ desc: 'สินค้า ก', qty: 2, price: '150', itemCode: widget.code }] });
ok('★ ออกใบกำกับเต็มรูปให้บุคคลธรรมดาที่มีเลขประจำตัวได้ (ไม่ถามสาขา)', invP.total === M('321') && invP.snap.branch === null, invP.no);
const walkin = C.savePartner({ kind: 'customer', name: 'นางสาวสมหญิง ไม่มีเลข', entityType: 'individual',
  address: '10 ถนนนิมมาน เชียงใหม่ 50200' }).partner;
const invW = C.issueInvoice({ partnerCode: walkin.code, date: '2026-06-02', lines: [{ desc: 'ค่าบริการติดตั้ง', qty: 1, price: '500' }] });
ok('★ ลูกค้าบุคคลธรรมดาที่ไม่มีเลขผู้เสียภาษี ออกใบกำกับได้ด้วยชื่อและที่อยู่', invW.total === M('535'), invW.no);
const rowW = D.taxTx.find((t) => t.docNo === invW.no);
ok('รายงานภาษีขายของบุคคลธรรมดาไม่มีเลขและสาขา', rowW && rowW.taxId === null && rowW.branch === null);
const noAddr = C.savePartner({ kind: 'customer', name: 'นายไม่มีที่อยู่', entityType: 'individual' }).partner;
throws('ที่อยู่ผู้ซื้อยังบังคับเสมอ', () => C.issueInvoice({ partnerCode: noAddr.code, date: '2026-06-02',
  lines: [{ desc: 'x', qty: 1, price: '100' }] }), 'TAX_INVOICE_INCOMPLETE');
const corpNoTax = C.savePartner({ kind: 'customer', name: 'บริษัท ยังไม่ให้เลข จำกัด', address: 'กรุงเทพฯ' }).partner;
ok('นิติบุคคลถือว่าจด VAT และมีสาขา 00000 ตั้งแต่สร้าง', corpNoTax.vatRegistered === true && corpNoTax.branch === '00000');
let err = null;
try { C.issueInvoice({ partnerCode: corpNoTax.code, date: '2026-06-02', lines: [{ desc: 'x', qty: 1, price: '100' }] }); } catch (e) { err = e; }
ok('★ ผู้ซื้อจด VAT แต่ไม่มีเลขผู้เสียภาษี — ปฏิเสธพร้อมบอกช่องที่ขาด', err && err.code === 'TAX_INVOICE_INCOMPLETE'
  && /เลขประจำตัวผู้เสียภาษีของผู้ซื้อ/.test(err.message) && !/สาขา/.test(err.message), err && err.message);
const soleProp = C.savePartner({ kind: 'customer', name: 'ร้านเจ้าของคนเดียว (จด VAT)', entityType: 'individual',
  vatRegistered: true, taxId: '3100503377574', address: 'นนทบุรี', branch: '00000' }).partner;
ok('บุคคลธรรมดาที่จด VAT เก็บสาขา 00000 ไว้ ไม่ทิ้งเป็นค่าว่าง', soleProp.branch === '00000' && soleProp.vatRegistered === true);
const invS = C.issueInvoice({ partnerCode: soleProp.code, date: '2026-06-03', lines: [{ desc: 'สินค้า ก', qty: 1, price: '150', itemCode: widget.code }] });
ok('ใบกำกับของผู้ซื้อที่จด VAT มีเลขและสาขาครบ', invS.snap.branch === '00000' && invS.snap.taxId === '3100503377574');
throws('เลขผู้เสียภาษีของบุคคลธรรมดาที่ใส่มาผิดยังถูกตรวจ', () => C.savePartner({ kind: 'customer', name: 'ผิด',
  entityType: 'individual', taxId: '1101700230709' }), 'TAX_ID_INVALID');
balanced('หลังออกใบกำกับให้บุคคลธรรมดา', JUNE);

console.log('\n=== 2. บัญชีรายได้รายบรรทัด และใบเพิ่มหนี้ ===');
const inv2 = C.issueInvoice({ partnerCode: corp.code, date: '2026-06-05', lines: [
  { desc: 'ค่าที่ปรึกษาโครงการ (พิมพ์เอง)', qty: 1, price: '30000', acc: '4121' },
  { desc: 'สินค้า ก', qty: 10, price: '150', itemCode: widget.code },
  { desc: 'งานบริการจากทะเบียน', qty: 2, price: '2000', itemCode: consult.code },
  { desc: 'ค่าเช่าเครื่อง', qty: 1, price: '1000', acc: '4123' },
] });
const je2 = entry(inv2.entryNo);
ok('★ บรรทัดที่พิมพ์เองเลือกรายได้ค่าบริการ ไม่ลงรายได้จากการขาย', crOf(je2, '4121') === M('34000'), fmt(crOf(je2, '4121')));
ok('สินค้าลงรายได้จากการขาย · บริการจากทะเบียนลงรายได้ค่าบริการเอง · ค่าเช่าลงรายได้ค่าเช่า',
  crOf(je2, '4111') === M('1500') && crOf(je2, '4123') === M('1000'));
ok('บัญชีรายได้เก็บไว้ในบรรทัดของใบกำกับ', inv2.lines.map((l) => l.acc).join(',') === '4121,4111,4121,4123');
throws('เลือกบัญชีที่ไม่ใช่รายได้ไม่ได้', () => C.issueInvoice({ partnerCode: corp.code, date: '2026-06-05',
  lines: [{ desc: 'ผิดบัญชี', qty: 1, price: '100', acc: '1111' }] }), 'REVENUE_ACCOUNT_INVALID');
throws('เลือกบัญชีรับคืนสินค้า (ระบบลงเอง) เป็นรายได้ไม่ได้', () => C.issueInvoice({ partnerCode: corp.code, date: '2026-06-05',
  lines: [{ desc: 'ผิดบัญชี', qty: 1, price: '100', acc: '4130' }] }), 'REVENUE_ACCOUNT_INVALID');
const invC = C.issueInvoice({ partnerCode: corp.code, date: '2026-06-06', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '10000', acc: '4121' }] });
const dn1 = C.issueDebitNote({ invoiceNo: invC.no, date: '2026-06-07', base: '2000', reason: 'SERVICE_UNDERPRICED' });
ok('★ ใบเพิ่มหนี้ค่าที่ปรึกษาเข้ารายได้ค่าบริการตามใบกำกับเดิม', dn1.acc === '4121' && crOf(entry(dn1.entryNo), '4121') === M('2000'));
const dn2 = C.issueDebitNote({ invoiceNo: invC.no, date: '2026-06-07', base: '500', reason: 'SERVICE_EXCESS', acc: '4260' });
ok('ใบเพิ่มหนี้เลือกบัญชีรายได้เองได้', crOf(entry(dn2.entryNo), '4260') === M('500'));
throws('ใบเพิ่มหนี้เลือกบัญชีที่ไม่ใช่รายได้ไม่ได้', () => C.issueDebitNote({ invoiceNo: invC.no, date: '2026-06-07',
  base: '100', reason: 'SERVICE_EXCESS', acc: '1131' }), 'REVENUE_ACCOUNT_INVALID');
const revAll = -C.balanceOf((a) => a.type === 'revenue', JUNE, '2026-06-01');
ok('รายได้ทุกบัญชีรวมกันเท่ากับใบกำกับ + ใบเพิ่มหนี้ ไม่มีหายไม่มีซ้ำ', revAll === D.docs.invoice.reduce((s, d) => s + d.base, 0)
  + D.docs.debitNote.reduce((s, d) => s + d.base, 0), fmt(revAll));
const pl = C.incomeStatement('2026-06-01', JUNE);
ok('ใบเพิ่มหนี้ที่เลือกรายได้เบ็ดเตล็ด ขึ้นในรายได้อื่นของงบกำไรขาดทุน', pl.lines.find((l) => l.label === 'รายได้อื่น').value === M('500'));
balanced('หลังเลือกบัญชีรายได้รายบรรทัด', JUNE);

console.log('\n=== 3. ใบสั่งซื้อ → ตั้งหนี้ ตามบัญชีของแต่ละบรรทัด ===');
const po = C.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-08', lines: [
  { desc: 'ค่าเช่าเครื่องถ่ายเอกสาร', qty: 1, price: '3000', acc: '5321' },
  { desc: 'ค่าซ่อมแอร์', qty: 1, price: '2500', acc: '5325' },
  { desc: 'สินค้า ก', qty: 5, price: '80', itemCode: widget.code },
  { desc: 'ค่าใช้จ่ายอื่น', qty: 1, price: '100' },
] });
ok('ใบสั่งซื้อเก็บบัญชีรายบรรทัดไว้', po.lines[0].acc === '5321' && po.lines[1].acc === '5325' && po.lines[3].acc === null);
throws('ใบสั่งซื้อเลือกบัญชีที่ตั้งหนี้ลงไม่ได้ ถูกปฏิเสธตั้งแต่ตอนออก', () => C.issueTradeDoc('purchaseOrder',
  { partnerCode: vend.code, date: '2026-06-08', lines: [{ desc: 'x', qty: 1, price: '1', acc: '4111' }] }), 'BILL_ACCOUNT_INVALID');
const bill = C.convertTradeDoc('purchaseOrder', po.no, { date: '2026-06-09', vendorNo: 'V-PO-001', acc: '5358' });
const jb = entry(bill.entryNo);
ok('★ ตั้งหนี้แยกบัญชีตามบรรทัดของใบสั่งซื้อ ไม่รวมเป็นบัญชีเดียว',
  drOf(jb, '5321') === M('3000') && drOf(jb, '5325') === M('2500') && drOf(jb, '1154') === M('400') && drOf(jb, '5358') === M('100'),
  bill.lines.map((l) => l.acc).join(','));
const po2 = C.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-08', lines: [
  { desc: 'ค่าน้ำมัน', qty: 1, price: '1000', acc: '5321' }] });
const bill2 = C.convertTradeDoc('purchaseOrder', po2.no, { date: '2026-06-09', vendorNo: 'V-PO-002', lineAccs: ['5327'] });
ok('แก้บัญชีรายบรรทัดตอนแปลงได้', bill2.lines[0].acc === '5327');
balanced('หลังตั้งหนี้จากใบสั่งซื้อ', JUNE);

console.log('\n=== 4. แก้ไขเอกสารก่อนลงบัญชี และใบเสนอราคา → ใบกำกับตรง ๆ ===');
const q = C.issueTradeDoc('quotation', { partnerCode: corp.code, date: '2026-06-10',
  lines: [{ desc: 'งานออกแบบ', qty: 1, price: '20000', acc: '4121' }] });
const qNo = q.no;
const qe = C.updateTradeDoc('quotation', qNo, { date: '2026-06-11', note: 'ราคารวมค่าเดินทาง',
  lines: [{ desc: 'งานออกแบบ (แก้)', qty: 1, price: '25000', acc: '4121' }, { desc: 'ค่าเดินทาง', qty: 1, price: '1000' }] });
ok('★ แก้ใบเสนอราคาที่ยังไม่ตอบรับได้ เลขที่เดิม ยอดใหม่', qe.no === qNo && qe.total === M('27820') && qe.lines.length === 2
  && qe.validUntil === '2026-07-11' && qe.revision === 1, fmt(qe.total));
ok('การแก้ไขบันทึกในร่องรอยการตรวจสอบ', D.audit.some((a) => a.entity === 'quotation' && a.id === qNo && a.action === 'update'));
ok('แก้เอกสารก่อนลงบัญชีไม่สร้างใบสำคัญ', !D.entries.some((e) => e.srcId === qNo));
C.setTradeDocStatus('quotation', qNo, 'approved');
throws('ลูกค้าตอบรับแล้วแก้ไม่ได้', () => C.updateTradeDoc('quotation', qNo, { lines: [{ desc: 'x', qty: 1, price: '1' }] }), 'TRADE_DOC_NOT_EDITABLE');
const invQ = C.convertTradeDoc('quotation', qNo, { date: '2026-06-12', to: 'invoice' });
ok('★ ใบเสนอราคา → ใบกำกับภาษีได้เลยโดยไม่ต้องผ่านใบสั่งขาย', invQ.total === qe.total && invQ.fromDoc === qNo
  && q.status === 'closed' && q.convertedTo === invQ.no && !D.docs.salesOrder.some((s) => s.fromDoc === qNo), invQ.no);
ok('บัญชีรายได้ที่เลือกในใบเสนอราคาตามไปถึงใบกำกับ', crOf(entry(invQ.entryNo), '4121') === M('25000') && crOf(entry(invQ.entryNo), '4111') === M('1000'));
C.voidDocument('invoice', invQ.no, 'ออกใบกำกับผิดวัน');
ok('ยกเลิกใบกำกับแล้วใบเสนอราคากลับมาแปลงต่อได้', q.status === 'approved' && q.convertedTo === null);
const po3 = C.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-10', lines: [{ desc: 'กระดาษ', qty: 10, price: '100', acc: '5324' }] });
const po3e = C.updateTradeDoc('purchaseOrder', po3.no, { lines: [{ desc: 'กระดาษ A4', qty: 20, price: '95', acc: '5324' }] });
ok('แก้ใบสั่งซื้อที่ผู้ขายยังไม่ยืนยันได้', po3e.base === M('1900'));
throws('แก้ใบสั่งซื้อเป็นลูกค้าไม่ได้', () => C.updateTradeDoc('purchaseOrder', po3.no, { partnerCode: corp.code }), 'PARTNER_WRONG_SIDE');
balanced('หลังแก้ไขและแปลงใบเสนอราคา', JUNE);

console.log('\n=== 5. ทยอยออกใบกำกับจากใบสั่งขาย ===');
const so = C.issueTradeDoc('salesOrder', { partnerCode: corp.code, date: '2026-06-13', lines: [
  { desc: 'สินค้า ก', qty: 10, price: '150', itemCode: widget.code },
  { desc: 'งานติดตั้งทั้งโครงการ', qty: 1, price: '50000', acc: '4121' },
] });
const soEdit = C.updateTradeDoc('salesOrder', so.no, { note: 'ส่งของสองรอบ', lines: so.lines.map((l) => ({ ...l, price: C.unM(l.price) })) });
ok('ใบสั่งขายที่ยังไม่ออกใบกำกับแก้ไขได้', soEdit.note === 'ส่งของสองรอบ' && soEdit.total === so.total);
const stockBefore = widget.qty;
const p1 = C.invoiceSalesOrder(so.no, { date: '2026-06-14', lines: [{ line: 0, qty: 4 }, { line: 1, qty: 0.3 }] });
ok('★ ออกใบกำกับงวดแรก: สินค้า 4 ชิ้น + งานติดตั้ง 30%', p1.base === M('15600') && p1.soNo === so.no
  && so.status === 'partially_invoiced' && C.soInvoiced(so).join(',') === '4,0.3', fmt(p1.base) + ' ' + so.status);
ok('ตัดสต๊อกเฉพาะที่ส่งจริง', widget.qty === stockBefore - 4);
throws('ออกเกินที่ค้างไม่ได้', () => C.invoiceSalesOrder(so.no, { date: '2026-06-15', lines: [{ line: 0, qty: 7 }] }), 'SO_OVER_INVOICE');
throws('ออกบางส่วนแล้วแก้ใบสั่งขายไม่ได้', () => C.updateTradeDoc('salesOrder', so.no, { note: 'x' }), 'TRADE_DOC_NOT_EDITABLE');
throws('ออกบางส่วนแล้วเปลี่ยนเป็นตอบรับไม่ได้', () => C.setTradeDocStatus('salesOrder', so.no, 'approved'), 'TRADE_DOC_STATUS_INVALID');
throws('ไม่เลือกรายการเลยไม่ได้', () => C.invoiceSalesOrder(so.no, { date: '2026-06-15', lines: [{ line: 0, qty: 0 }] }), 'SO_QTY_INVALID');
balanced('หลังออกใบกำกับงวดแรก', JUNE);
const p2 = C.convertTradeDoc('salesOrder', so.no, { date: '2026-06-20' });
ok('★ แปลงส่วนที่เหลือทั้งหมด ใบสั่งขายปิดและชี้ไปใบกำกับทั้งสองใบ', so.status === 'closed'
  && so.convertedTo === p1.no + ', ' + p2.no && p1.base + p2.base === so.base, so.convertedTo);
throws('ออกครบแล้วออกซ้ำไม่ได้', () => C.invoiceSalesOrder(so.no, { date: '2026-06-21' }), 'TRADE_DOC_ALREADY_CONVERTED');
C.voidDocument('invoice', p2.no, 'ส่งของรอบสองไม่ได้ ลูกค้าเลื่อน');
ok('★ ยกเลิกใบกำกับงวดสอง ใบสั่งขายกลับมาค้างเฉพาะส่วนนั้น', so.status === 'partially_invoiced' && C.soInvoiced(so).join(',') === '4,0.3'
  && widget.qty === stockBefore - 4, so.status);
C.setTradeDocStatus('salesOrder', so.no, 'cancelled', 'ลูกค้ายกเลิกส่วนที่เหลือ');
throws('ยกเลิกส่วนที่เหลือแล้วออกใบกำกับต่อไม่ได้', () => C.invoiceSalesOrder(so.no, { date: '2026-06-22' }), 'TRADE_DOC_NOT_ACTIVE');
const so2 = C.issueTradeDoc('salesOrder', { partnerCode: corp.code, date: '2026-06-13', lines: [{ desc: 'งานเล็ก', qty: 1, price: '1000' }] });
const one = C.convertTradeDoc('salesOrder', so2.no, { date: '2026-06-14' });
C.voidDocument('invoice', one.no, 'ทดสอบการยกเลิก');
ok('ใบสั่งขายที่แปลงทั้งใบแล้วใบกำกับถูกยกเลิก กลับไปสถานะเดิมก่อนออก', so2.status === 'issued' && so2.convertedTo === null, so2.status);
balanced('หลังทยอยออกใบกำกับและยกเลิก', JUNE);

console.log('\n=== 6. ขายเงินสด — ใบกำกับภาษีอย่างย่อ (ม.86/6) ===');
const cashBefore = C.balBySub(['cash'], JUNE);
const cs = C.issueCashSale({ date: '2026-06-16', vatInclusive: true, lines: [
  { desc: 'สินค้า ก', qty: 2, price: '160.50', itemCode: widget.code },
  { desc: 'ค่าบริการห่อของขวัญ', qty: 1, price: '53.50', acc: '4121' },
  { desc: 'หนังสือ (ยกเว้นภาษี)', qty: 1, price: '120', taxCode: 'EXEMPT' },
] });
ok('★ ราคารวมภาษี: ลูกค้าจ่ายเท่าป้ายราคา ระบบถอดภาษีให้', cs.total === M('494.50') && cs.vat === M('24.50')
  && cs.base === M('470'), 'รวม ' + fmt(cs.total) + ' ภาษี ' + fmt(cs.vat));
ok('มูลค่าก่อนภาษีรายบรรทัดรวมกันเท่ายอดก่อนภาษีพอดี', cs.lines.reduce((s, l) => s + l.amount, 0) === cs.base);
const jc = entry(cs.entryNo);
ok('★ ลงบัญชีครั้งเดียว: Dr เงินสด · Cr รายได้ · Cr ภาษีขาย ไม่ผ่านลูกหนี้', drOf(jc, '1111') === cs.total
  && crOf(jc, '4111') === M('420') && crOf(jc, '4121') === M('50') && crOf(jc, '2141') === cs.vat
  && !jc.lines.some((l) => l.acc === '1131') && jc.type === 'receipt', jc.lines.map((l) => l.acc + ':' + fmt(l.dr || -l.cr)).join(' '));
ok('สินค้ายกเว้นภาษีลงรายได้จากการขายตามปกติ แยกช่องยกเว้นในรายงานภาษี', D.taxTx.find((t) => t.docNo === cs.no).exempt === M('120'));
ok('เงินสดเพิ่มเท่ายอดขาย', C.balBySub(['cash'], JUNE) - cashBefore === cs.total);
const row = D.taxTx.find((t) => t.docNo === cs.no);
ok('★ เข้ารายงานภาษีขายเป็นใบกำกับอย่างย่อ', row && row.kind === 'vat_output' && row.docType === 'abbreviated'
  && row.tax === cs.vat && row.taxId === null, row && row.partnerName);
ok('ตัดสต๊อกและต้นทุนขายเหมือนใบกำกับ', !!cs.cogsEntryNo && D.docs.stockMove.some((m) => m.src === cs.no && m.dir === 'out' && m.qty === 2));
const cs2 = C.issueCashSale({ date: '2026-06-16', lines: [{ desc: 'ของชิ้นเดียว', qty: 1, price: '100' }] });
ok('ถอดภาษีปัดเศษถูก: 100 รวมภาษี = 93.46 + 6.54', cs2.base === M('93.46') && cs2.vat === M('6.54'));
const cs3 = C.issueCashSale({ date: '2026-06-16', vatInclusive: false, payTo: '1113', method: 'transfer',
  buyerName: 'คุณลูกค้าหน้าร้าน', lines: [{ desc: 'ของ', qty: 3, price: '33.33' }] });
ok('ราคาก่อนภาษี: บวกภาษีเพิ่ม และรับเข้าบัญชีธนาคารได้', cs3.base === M('99.99') && cs3.vat === M('7') && cs3.total === M('106.99')
  && drOf(entry(cs3.entryNo), '1113') === M('106.99'));
ok('เลขที่ใบอย่างย่อแยกเล่มจากใบกำกับเต็มรูป', /^CA202606\d{4}$/.test(cs.no) && cs2.no !== cs.no, cs.no + ' ' + cs2.no);
const seqBefore = JSON.stringify(D.seq);
throws('สินค้าไม่พอ ขายเงินสดไม่ได้', () => C.issueCashSale({ date: '2026-06-16', lines: [{ desc: 'สินค้า ก', qty: 9999, price: '1', itemCode: widget.code }] }), 'INSUFFICIENT_STOCK');
ok('ขายไม่สำเร็จไม่เสียเลขที่เอกสาร', JSON.stringify(D.seq) === seqBefore);
throws('เงินต้องเข้าบัญชีเงินสดหรือธนาคาร', () => C.issueCashSale({ date: '2026-06-16', payTo: '1131', lines: [{ desc: 'x', qty: 1, price: '1' }] }), 'CASH_SALE_PAYTO_INVALID');
throws('ไม่มีรายการ', () => C.issueCashSale({ date: '2026-06-16', lines: [] }), 'NO_LINES');
throws('กลับรายการที่ใบสำคัญตรง ๆ ไม่ได้ ต้องยกเลิกที่เอกสาร', () => C.reverse(cs.entryNo, 'ทดสอบกลับรายการ'), 'ENTRY_FROM_DOCUMENT');
balanced('หลังขายเงินสด', JUNE);
const qtyBeforeVoid = widget.qty;
C.voidDocument('cashSale', cs.no, 'ลูกค้าคืนของทันที');
ok('★ ยกเลิกขายเงินสด: กลับรายการ คืนของเข้าคลัง รายงานภาษีขึ้นยกเลิก', cs.status === 'void' && widget.qty === qtyBeforeVoid + 2
  && row.void === true && row.tax === 0 && entry(cs.entryNo).status === 'reversed' && entry(cs.cogsEntryNo).status === 'reversed');
balanced('หลังยกเลิกขายเงินสด', JUNE);

console.log('\n=== 7. ผู้ติดต่อ: เลิกใช้งานและลบ ===');
C.savePartner({ code: walkin.code, kind: 'customer', name: walkin.name, entityType: 'individual', address: walkin.address, active: false });
ok('ตั้งเลิกใช้งานได้', walkin.active === false);
C.savePartner({ code: walkin.code, kind: 'customer', name: walkin.name + ' (แก้ชื่อ)', entityType: 'individual', address: walkin.address });
ok('★ แก้ข้อมูลโดยไม่ส่งสถานะมา ไม่เผลอเปิดใช้งานกลับ', walkin.active === false);
const rc = C.receivePayment({ invoiceNo: invW.no, date: '2026-06-21', amount: '535' });
ok('★ ลูกค้าที่เลิกใช้งานยังรับชำระหนี้เดิมได้ และยังอยู่ในรายงาน', rc.gross === M('535')
  && C.aging('ar', JUNE).rows.every((r) => D.partners.some((p) => p.code === r.code)));
ok('ทะเบียนบอกได้ว่าใช้ในเอกสารใดบ้าง', C.partnerUsage(walkin.code).indexOf(invW.no) >= 0);
throws('★ ลบผู้ติดต่อที่มีเอกสารแล้วไม่ได้', () => C.deletePartner(walkin.code), 'PARTNER_IN_USE');
const spare = C.savePartner({ kind: 'customer', name: 'ลูกค้าที่เพิ่มผิด', address: 'x' }).partner;
const n0 = D.partners.length;
C.deletePartner(spare.code, 'เพิ่มซ้ำโดยไม่ตั้งใจ');
ok('★ ลบผู้ติดต่อที่ยังไม่เคยใช้ได้ และบันทึกร่องรอย', D.partners.length === n0 - 1 && !D.partners.some((p) => p.code === spare.code)
  && D.audit.some((a) => a.entity === 'partner' && a.id === spare.code && a.action === 'delete'));
throws('ลบผู้ขายที่มีใบสั่งซื้อไม่ได้', () => C.deletePartner(vend.code), 'PARTNER_IN_USE');
balanced('หลังจัดการผู้ติดต่อ', JUNE);

console.log('\n=== 8. ยื่น ภ.พ.30 รวมใบกำกับอย่างย่อ ===');
const vatRows = D.taxTx.filter((t) => t.kind === 'vat_output' && t.period === '2026-06' && !t.void);
const f = C.fileVat('2026-06');
ok('★ ภาษีขายในแบบ ภ.พ.30 รวมใบกำกับอย่างย่อแล้ว', f.outTax === vatRows.reduce((s, t) => s + t.tax, 0)
  && vatRows.some((t) => t.docType === 'abbreviated'), fmt(f.outTax));
throws('ยื่นแบบแล้วยกเลิกใบอย่างย่อไม่ได้', () => C.voidDocument('cashSale', cs2.no, 'ทดสอบหลังยื่นแบบ'), 'TAX_ALREADY_FILED');
ok('ยอดคุมทุกตัวยังผ่านหลังยื่นแบบ', C.reconciliationChecks(JUNE).allPassed);
ok('งบทดลองสมดุล', C.trialBalance('2026-01-01', '2026-12-31').balanced);

console.log('\n=== 9. ภาษีหัก ณ ที่จ่ายบนใบเสนอราคา → ใบสั่งขาย → ใบกำกับ → รับชำระ ===');
{
  const svcCust = C.savePartner({ kind: 'customer', name: 'บริษัท ซื้อบริการ จำกัด', taxId: '0105548021442', branch: '00001',
    address: 'กรุงเทพฯ', whtCode: 'WHT_SERVICE' }).partner;
  ok('ลูกค้าเก็บประเภทภาษีที่หักเราไว้ในทะเบียนได้', svcCust.whtCode === 'WHT_SERVICE');
  /* ค่าบริการ 10,000 + สินค้า 2 ชิ้น 300 — หัก 3% เฉพาะค่าบริการ */
  const q = C.issueTradeDoc('quotation', { partnerCode: svcCust.code, date: '2026-07-01', whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 5, price: '2000', itemCode: consult.code }, { desc: 'สินค้า ก', qty: 2, price: '150', itemCode: widget.code }] });
  ok('★ ใบเสนอราคาแสดงภาษีหัก ณ ที่จ่าย 3% จากค่าบริการเท่านั้น และยอดชำระสุทธิ', q.whtRate === '3' && q.whtBase === M('10000')
    && q.wht === M('300') && q.payNet === q.total - M('300'), fmt(q.wht) + ' · สุทธิ ' + fmt(q.payNet));
  const q2 = C.updateTradeDoc('quotation', q.no, { whtCode: null });
  ok('แก้ใบเสนอราคาเอาภาษีหัก ณ ที่จ่ายออกได้', !q2.whtCode && q2.wht === 0 && q2.payNet === q2.total);
  C.updateTradeDoc('quotation', q.no, { whtCode: 'WHT_SERVICE' });
  const small = C.issueTradeDoc('quotation', { partnerCode: svcCust.code, date: '2026-07-01', whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'ค่าบริการเล็กน้อย', qty: 1, price: '800' }] });
  ok('★ มูลค่าต่ำกว่า 1,000 บาท ไม่ต้องหัก (ท.ป.4/2528)', small.wht === 0 && small.whtUnder);
  C.setTradeDocStatus('quotation', q.no, 'approved');
  const so = C.convertTradeDoc('quotation', q.no, { date: '2026-07-02' });
  ok('ใบสั่งขายรับภาษีหัก ณ ที่จ่ายต่อจากใบเสนอราคา', so.whtCode === 'WHT_SERVICE' && so.wht === M('300'));
  C.setTradeDocStatus('salesOrder', so.no, 'approved');
  const inv = C.invoiceSalesOrder(so.no, { date: '2026-07-03', lines: [{ line: 0, qty: 3 }] });
  ok('★ ใบกำกับจากใบสั่งขาย (บางส่วน) คิดภาษีหัก ณ ที่จ่ายตามยอดของใบนี้', inv.whtCode === 'WHT_SERVICE' && inv.whtBase === M('6000')
    && inv.wht === M('180') && inv.payNet === inv.total - M('180'));
  ok('ภาษีหัก ณ ที่จ่ายบนเอกสารยังไม่ลงบัญชี (ลงตอนรับชำระ)', !D.entries.find((e) => e.no === inv.entryNo).lines.some((l) => l.acc === C.accBySub('wht_asset')));
  const rcv = C.receivePayment({ invoiceNo: inv.no, date: '2026-07-10', whtCode: inv.whtCode });
  ok('★ รับชำระตามที่ใบกำกับระบุ ลูกค้าหักตรงกับยอดบนใบกำกับ', rcv.wht === inv.wht && rcv.net === inv.payNet, fmt(rcv.wht));
  const qi = C.issueTradeDoc('quotation', { partnerCode: svcCust.code, date: '2026-07-04', whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'งานติดตั้ง', qty: 1, price: '5000' }] });
  C.setTradeDocStatus('quotation', qi.no, 'approved');
  const inv2 = C.convertTradeDoc('quotation', qi.no, { date: '2026-07-04', to: 'invoice' });
  ok('ใบเสนอราคา → ใบกำกับเลย ก็ได้ภาษีหัก ณ ที่จ่ายตามใบเสนอราคา', inv2.whtCode === 'WHT_SERVICE' && inv2.wht === M('150'));

  /* ฝั่งซื้อ: ใบสั่งซื้อระบุหัก ณ ที่จ่ายผู้ขาย → ตั้งหนี้แล้วหักตอนจ่าย */
  const po = C.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-07-05', whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'ค่าซ่อมเครื่องจักร', qty: 1, price: '4000', acc: '5321' }] });
  ok('ใบสั่งซื้อแสดงยอดจ่ายสุทธิหลังหัก ณ ที่จ่าย', po.wht === M('120') && po.payNet === po.total - M('120'));
  C.setTradeDocStatus('purchaseOrder', po.no, 'approved');
  const bill = C.convertTradeDoc('purchaseOrder', po.no, { date: '2026-07-06', vendorNo: 'RPR-77' });
  ok('★ ตั้งหนี้จากใบสั่งซื้อ ได้ประเภทภาษีหัก ณ ที่จ่ายตามใบสั่งซื้อ', bill.whtCode === 'WHT_SERVICE');
  const pay = C.payBill({ billNo: bill.no, date: '2026-07-07' });
  ok('จ่ายชำระหักภาษีตรงกับใบสั่งซื้อ', pay.wht === po.wht, fmt(pay.wht));
  const po2 = C.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-07-05',
    lines: [{ desc: 'ค่าบริการ', qty: 1, price: '4000', acc: '5321' }] });
  C.setTradeDocStatus('purchaseOrder', po2.no, 'approved');
  const bill2 = C.convertTradeDoc('purchaseOrder', po2.no, { date: '2026-07-06', vendorNo: 'RPR-78' });
  ok('ใบสั่งซื้อที่เลือกไม่หัก ตั้งหนี้แล้วไม่หัก', !bill2.whtCode);
  balanced('หลังเอกสารที่มีภาษีหัก ณ ที่จ่าย', '2026-07-31');
}

done();
