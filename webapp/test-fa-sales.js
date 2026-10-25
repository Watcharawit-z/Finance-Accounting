/* ทดสอบฝั่งขายแบบที่นักบัญชีคุ้นมือ — ใบเสนอราคา → ใบวางบิล/ใบแจ้งหนี้ → ใบกำกับภาษี → ใบเสร็จรับเงิน
   สถานะใบกำกับ (รอดำเนินการ → รอเก็บเงิน) · แก้ใบกำกับที่ยังไม่ส่งลูกค้าด้วยเลขเดิม · ออกใบกำกับพร้อมรับเงิน
   ใบเสนอราคา → ขายเงินสด · หน้าต่างรับชำระครบทุกช่อง · ข้อมูลรุ่นก่อนเปิดได้
   รันด้วย node webapp/test-fa-sales.js */
const { ctx, ok, throws, done } = require('./testlib');
const M = ctx.M, fmt = ctx.fmt;

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const partner = (o) => ctx.savePartner(o).partner;
const D = () => ctx.DB;
const bal = (code, to, from) => D().entries.filter((e) => e.date <= (to || '2099-12-31') && e.date >= (from || '0000'))
  .reduce((s, e) => s + e.lines.filter((l) => l.acc === code).reduce((t, l) => t + (l.dr || 0) - (l.cr || 0), 0), 0);
const AR = () => ctx.accBySub('trade_receivable');
const inv = (no) => D().docs.invoice.find((d) => d.no === no);
const bn = (no) => D().docs.billingNote.find((d) => d.no === no);
const qt = (no) => D().docs.quotation.find((d) => d.no === no);
const recon = (asOf) => { const r = ctx.reconciliationChecks(asOf); return { ok: r.allPassed, why: r.checks.filter((c) => !c.ok).map((c) => c.code + ' ' + fmt(c.control) + '/' + fmt(c.sub)).join(' | ') }; };
/* ภาษีขายในรายงาน = ภาษีขายที่ลงบัญชีจากเอกสาร ของงวดนั้น */
const vatMatch = (period) => {
  const start = period + '-01', end = ctx.endOfMonth(start);
  const reg = D().taxTx.filter((t) => t.kind === 'vat_output' && t.period === period).reduce((s, t) => s + t.tax, 0);
  const gl = -ctx.balBySub(['output_vat'], end, start, (e) => e.src !== 'filing');
  return reg === gl;
};
const arMatch = (asOf) => ctx.aging('ar', asOf).totals.total === ctx.balBySub(['trade_receivable'], asOf);
const uniqueNos = (kind) => { const n = D().docs[kind].map((d) => d.no); return new Set(n).size === n.length; };

ctx.buildBlank({ name: 'บริษัท ทดสอบฝั่งขาย จำกัด', year: 2026 });
ctx.TODAY = '2026-06-30';
const cust = partner({ kind: 'customer', name: 'บริษัท ลูกค้าหลัก จำกัด', taxId: tid('010555812300'), branch: '00000',
  address: '1 ถนนสุขุมวิท กรุงเทพฯ 10110', termDays: 30, contactPerson: 'คุณเอ' });
const cust2 = partner({ kind: 'customer', name: 'บริษัท ลูกค้ารอง จำกัด', taxId: tid('010555812301'), branch: '00000',
  address: '2 ถนนสีลม กรุงเทพฯ 10500', termDays: 15 });
const vend = partner({ kind: 'vendor', name: 'บริษัท ผู้ขายสินค้า จำกัด', taxId: tid('010555867800'), branch: '00000',
  address: '9 ถนนพระราม 4 กรุงเทพฯ', termDays: 15 });
const widget = ctx.saveItem({ name: 'สินค้า ก', type: 'stock', uom: 'ชิ้น', price: '200' }).item;
const consult = ctx.saveItem({ name: 'ค่าที่ปรึกษา', type: 'service', uom: 'ชั่วโมง', price: '1500' }).item;
ctx.post({ type: 'general', date: '2026-05-01', desc: 'ทุน', lines: [{ acc: '1113', dr: M('500000') }, { acc: '3120', cr: M('500000') }] });
ctx.recordBill({ partnerCode: vend.code, date: '2026-05-02', vendorNo: 'V-100', whtCode: 'none',
  lines: [{ desc: 'สินค้า ก', qty: 100, price: '80', itemCode: widget.code }] });
const W = () => D().items.find((x) => x.code === widget.code);

console.log('\n=== 1. ใบเสนอราคา → ใบวางบิล/ใบแจ้งหนี้ (ไม่ลงบัญชี) ส่งต่อทุกอย่างและลิงก์สองทาง ===');
let q1, b1;
{
  q1 = ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-06-01',
    lines: [{ desc: 'สินค้า ก', qty: 10, price: '214', itemCode: widget.code, disc: '10' },
      { desc: 'ค่าที่ปรึกษา', qty: 2, price: '1605', itemCode: consult.code }],
    pricing: { mode: 'inclusive', lineDisc: 'percent', bill: { kind: 'amount', value: '100' } },
    project: 'ระบบหน้าร้าน', salesName: 'คุณบี', reference: 'PO-778', note: 'ส่งของภายใน 7 วัน', internalNote: 'ลูกค้าขอส่วนลด',
    creditDays: 45, contact: { branch: '00002', address: '77 ถนนบางนา สมุทรปราการ' } });
  ctx.setTradeDocStatus('quotation', q1.no, 'approved');
  const e0 = D().entries.length, t0 = D().taxTx.length;
  b1 = ctx.convertQuotation(q1.no, { to: 'billingNote', date: '2026-06-02' });
  ok('★ ใบวางบิล/ใบแจ้งหนี้ได้รายการ ราคารวมภาษี ส่วนลด และยอดเท่าใบเสนอราคา', b1.mode === 'items' && b1.total === q1.total
    && b1.pricing.mode === 'inclusive' && b1.lines.length === 2 && b1.lines[0].disc === '10' && b1.totals.billDiscount === M('100'),
    b1.no + ' ' + fmt(b1.total));
  ok('★ หัวเอกสารส่งต่อ: โปรเจกต์ พนักงานขาย หมายเหตุ โน้ตภายใน เครดิต 45 วัน เลขอ้างอิง', b1.project === 'ระบบหน้าร้าน' && b1.salesName === 'คุณบี'
    && b1.note === 'ส่งของภายใน 7 วัน' && b1.internalNote === 'ลูกค้าขอส่วนลด' && b1.creditDays === 45 && b1.due === '2026-07-17' && b1.reference === 'PO-778');
  ok('ข้อมูลลูกค้าที่แก้บนใบเสนอราคา (สาขา 00002) ตามมาด้วย', b1.snap.branch === '00002' && /บางนา/.test(b1.snap.address) && b1.snap.edited);
  ok('★ ลิงก์สองทาง: ใบเสนอราคาปิดและชี้ไปใบวางบิล ใบวางบิลชี้กลับ', qt(q1.no).status === 'closed' && qt(q1.no).convertedTo === b1.no
    && b1.fromDoc === q1.no && b1.fromKind === 'quotation');
  ok('★ ใบวางบิลไม่ลงบัญชีและไม่เข้ารายงานภาษี', D().entries.length === e0 && D().taxTx.length === t0);
  ok('เลขที่ใบวางบิลรูปแบบ BL + ปี + เดือน', /^BL202606\d{4}$/.test(b1.no), b1.no);
  ok('สถานะแรก: รอวางบิล', ctx.billingNoteStatus(b1) === 'issued' && b1.delivered === false);

  const u = ctx.updateItemBilling(b1.no, { note: 'แก้หมายเหตุ', lines: [{ desc: 'สินค้า ก', qty: 5, price: '214', itemCode: widget.code, disc: '10' },
    { desc: 'ค่าที่ปรึกษา', qty: 2, price: '1605', itemCode: consult.code }] });
  ok('แก้ไขใบวางบิลได้ตอนรอวางบิล — เลขเดิม ยอดใหม่ ราคา/ส่วนลดเดิม', u.no === b1.no && u.revision === 1 && u.total < q1.total
    && u.pricing.mode === 'inclusive' && u.note === 'แก้หมายเหตุ' && u.project === 'ระบบหน้าร้าน', fmt(u.total));
  ctx.setBillingNoteStatus(b1.no, 'delivered');
  ok('★ วางบิลแล้ว', ctx.billingNoteStatus(bn(b1.no)) === 'delivered' && bn(b1.no).delivered === true);
  throws('วางบิลแล้วแก้ไขไม่ได้', () => ctx.updateItemBilling(b1.no, { note: 'x' }), 'BILLING_NOT_EDITABLE');
  ctx.setBillingNoteStatus(b1.no, 'issued');
  ok('รีเซ็ตกลับเป็นรอวางบิลได้ (ยังไม่มีเอกสารปลายทาง)', ctx.billingNoteStatus(bn(b1.no)) === 'issued');
  throws('รับชำระตามใบวางบิล/ใบแจ้งหนี้ตรง ๆ ไม่ได้ ต้องออกใบกำกับก่อน', () => ctx.receiveBillingNote(b1.no, { date: '2026-06-03' }), 'BILLING_NOT_INVOICED');
  ctx.setBillingNoteStatus(b1.no, 'cancelled', 'ลูกค้าขอเปลี่ยนรายการ');
  ok('★ ยกเลิกใบวางบิล → ใบเสนอราคากลับมาแปลงต่อได้', bn(b1.no).status === 'cancelled' && qt(q1.no).status === 'approved' && !qt(q1.no).convertedTo);
  throws('ใบวางบิลที่ยกเลิกแล้วแปลงไม่ได้', () => ctx.convertItemBilling(b1.no, { date: '2026-06-05' }), 'BILLING_CANCELLED');
  const sb = ctx.issueItemBilling({ partnerCode: cust2.code, date: '2026-06-03', creditType: 'creditHidden',
    lines: [{ desc: 'ค่าบริการติดตั้ง', qty: 1, price: '5000' }] });
  ok('ออกใบวางบิล/ใบแจ้งหนี้เองได้โดยไม่ต้องมีใบเสนอราคา', sb.mode === 'items' && !sb.fromDoc && sb.total === M('5350') && sb.creditType === 'creditHidden');
  throws('ใบวางบิลต้องออกให้ลูกค้า', () => ctx.issueItemBilling({ partnerCode: vend.code, date: '2026-06-03', lines: [{ desc: 'x', qty: 1, price: '1' }] }), 'PARTNER_WRONG_SIDE');
}

console.log('\n=== 2. ใบวางบิล → ใบกำกับภาษี (เปิดบิล) / ขายเงินสด ===');
let b2, i2;
{
  b2 = ctx.convertQuotation(q1.no, { to: 'billingNote', date: '2026-06-04' });
  ctx.setBillingNoteStatus(b2.no, 'delivered');
  const q0 = W().qty;
  i2 = ctx.convertItemBilling(b2.no, { date: '2026-06-05' });
  ok('★ ใบกำกับจากใบวางบิล: ยอด ราคา ส่วนลด สาขาที่แก้ ครบ', i2.total === b2.total && i2.pricing.mode === 'inclusive'
    && i2.snap.branch === '00002' && i2.project === 'ระบบหน้าร้าน' && i2.creditDays === 45, i2.no);
  ok('★ ใบวางบิลเป็น "เปิดบิลแล้ว" ชี้ไปใบกำกับ · ใบกำกับชี้กลับ', ctx.billingNoteStatus(bn(b2.no)) === 'closed' && bn(b2.no).convertedTo === i2.no
    && i2.fromDoc === b2.no && i2.fromKind === 'billingNote');
  ok('ใบกำกับลงบัญชี ตัดสต๊อก เข้ารายงานภาษีขาย (สาขา 00002)', W().qty === q0 - 10
    && D().taxTx.some((t) => t.docNo === i2.no && t.branch === '00002'));
  ok('ใบกำกับใหม่เริ่มที่รอดำเนินการ', i2.delivered === false && i2.status === 'issued');
  throws('เปิดบิลซ้ำไม่ได้', () => ctx.convertItemBilling(b2.no, { date: '2026-06-05' }), 'BILLING_ALREADY_CONVERTED');
  throws('ใบวางบิลที่เปิดบิลแล้วเปลี่ยนสถานะไม่ได้', () => ctx.setBillingNoteStatus(b2.no, 'issued'), 'BILLING_ALREADY_CONVERTED');
  ctx.voidDocument('invoice', i2.no, 'ออกผิด ทดสอบการคืนสถานะ');
  ok('★ ยกเลิกใบกำกับ → ใบวางบิลกลับเป็น "วางบิลแล้ว" เปิดบิลใหม่ได้', bn(b2.no).status === 'delivered' && !bn(b2.no).convertedTo && W().qty === q0);
  const cs = ctx.convertItemBilling(b2.no, { to: 'cashSale', date: '2026-06-06', method: 'transfer', payTo: '1113' });
  ok('★ ใบวางบิล → ขายเงินสด: ผู้ซื้อตามใบวางบิล ราคารวมภาษีตามต้นทาง ยอดเท่ากัน', cs.total === b2.total && cs.vatInclusive === true
    && cs.buyerName === cust.name && cs.snap && cs.snap.branch === '00002' && cs.fromDoc === b2.no, cs.no);
  ok('ใบวางบิลชี้ไปขายเงินสด', bn(b2.no).status === 'closed' && bn(b2.no).convertedTo === cs.no && bn(b2.no).convertedKind === 'cashSale');
  ctx.voidDocument('cashSale', cs.no, 'ทดสอบยกเลิกขายเงินสด');
  ok('ยกเลิกขายเงินสด → ใบวางบิลกลับมาเปิดบิลได้', bn(b2.no).status === 'delivered');
  ok('งบทดลองสมดุล · ลูกหนี้รายตัว = บัญชีคุม · ภาษีขายรายงาน = บัญชี', ctx.trialBalance('2026-06-01', '2026-06-30').balanced
    && arMatch('2026-06-30') && vatMatch('2026-06'));
}

console.log('\n=== 3. ใบกำกับ: รอดำเนินการ → ส่งให้ลูกค้าแล้ว (รอเก็บเงิน) · รีเซ็ต ===');
let i3;
{
  i3 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-10', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1500', itemCode: consult.code }] });
  ok('ใบใหม่ delivered = false (รอดำเนินการ)', i3.delivered === false);
  ctx.setInvoiceDelivered(i3.no, true);
  ok('★ ส่งให้ลูกค้าแล้ว → delivered', inv(i3.no).delivered === true && !!inv(i3.no).deliveredAt);
  throws('ส่งซ้ำไม่ได้', () => ctx.setInvoiceDelivered(i3.no, true), 'INVOICE_ALREADY_DELIVERED');
  ctx.setInvoiceDelivered(i3.no, false);
  ok('★ รีเซ็ตเป็นรอดำเนินการได้ (ยังไม่มีเอกสารอ้างถึง)', inv(i3.no).delivered === false);
  const rc = ctx.receivePayment({ invoiceNo: i3.no, date: '2026-06-11', amount: '500', bankAccount: '1113' });
  ok('★ รับเงินบางส่วน → ส่งแล้วอัตโนมัติ สถานะแบ่งจ่าย', inv(i3.no).delivered === true && inv(i3.no).status === 'partially_paid');
  throws('มีใบเสร็จอ้างถึงแล้ว รีเซ็ตไม่ได้', () => ctx.setInvoiceDelivered(i3.no, false), 'INVOICE_HAS_DEPENDENTS');
  ctx.voidDocument('receipt', rc.no, 'รับผิดใบ ทดสอบ');
  ctx.setInvoiceDelivered(i3.no, false);
  ok('ยกเลิกใบเสร็จแล้ว รีเซ็ตได้', inv(i3.no).delivered === false);
  const g = ctx.issueBillingNote({ partnerCode: cust.code, date: '2026-06-12', invoiceNos: [i3.no] });
  ok('★ นำไปวางบิลรวม → ส่งให้ลูกค้าแล้ว', inv(i3.no).delivered === true);
  throws('อยู่ในใบวางบิลรวมที่ยังเปิด รีเซ็ตไม่ได้', () => ctx.setInvoiceDelivered(i3.no, false), 'INVOICE_HAS_DEPENDENTS');
  ctx.setBillingNoteStatus(g.no, 'delivered');
  ok('ใบวางบิลรวม: วางบิลแล้ว (ธง) สถานะยังคิดจากยอดค้าง', D().docs.billingNote.find((x) => x.no === g.no).delivered === true
    && ctx.billingNoteStatus(D().docs.billingNote.find((x) => x.no === g.no)) === 'issued');
  ctx.setBillingNoteStatus(g.no, 'issued');
  ctx.cancelBillingNote(g.no, 'ทดสอบยกเลิกใบวางบิลรวม');
  ctx.setInvoiceDelivered(i3.no, false);
  ok('ใบวางบิลรวมยกเลิกแล้ว รีเซ็ตใบกำกับได้', inv(i3.no).delivered === false);
}

console.log('\n=== 4. แก้ไขใบกำกับที่ยังรอดำเนินการ — เลขเดิม กลับรายการเดิมและออกใหม่ในชุดเดียว ===');
let i4;
{
  i4 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-15', project: 'งานเดิม',
    lines: [{ desc: 'สินค้า ก', qty: 20, price: '200', itemCode: widget.code }, { desc: 'ค่าที่ปรึกษา', qty: 1, price: '3000', itemCode: consult.code }] });
  const no = i4.no, entry0 = i4.entryNo, cogs0 = i4.cogsEntryNo;
  const stock0 = W().qty, value0 = W().value;
  const rowsBefore = D().taxTx.filter((t) => t.docNo === no).length;
  const e = ctx.editInvoice(no, { lines: [{ desc: 'สินค้า ก', qty: 12, price: '210', itemCode: widget.code, disc: '5' },
    { desc: 'ค่าที่ปรึกษา', qty: 2, price: '3000', itemCode: consult.code }], pricing: { lineDisc: 'percent' },
    project: 'งานใหม่', note: 'แก้ตามที่ลูกค้าขอ', reason: 'ลูกค้าลดจำนวน' });
  /* 12 × 210 = 2,520 − 5% = 2,394 · 6,000 · รวม 8,394 ภาษี 587.58 */
  ok('★ เลขที่เดิม ยอดใหม่ 8,394 + ภาษี 587.58', e.no === no && e.base === M('8394') && e.vat === M('587.58') && e.project === 'งานใหม่',
    fmt(e.base) + ' / ' + fmt(e.vat));
  ok('★ ใบสำคัญเดิมถูกกลับรายการ ใบใหม่ลงแทน', D().entries.find((x) => x.no === entry0).status === 'reversed'
    && D().entries.find((x) => x.no === cogs0).status === 'reversed' && e.entryNo !== entry0);
  ok('★ เลขที่ใบกำกับไม่ซ้ำ มีใบเดียวในทะเบียน · แถวภาษีขายเลขนี้แถวเดียว', uniqueNos('invoice') && D().docs.invoice.filter((d) => d.no === no).length === 1
    && D().taxTx.filter((t) => t.docNo === no).length === rowsBefore && D().taxTx.find((t) => t.docNo === no).tax === M('587.58'));
  ok('★ สต๊อก: คืน 20 ตัดใหม่ 12 (ยอดคงเหลือเพิ่ม 8 ชิ้น)', W().qty === stock0 + 8, stock0 + ' → ' + W().qty);
  const sold = D().docs.stockMove.filter((m) => m.src === no && m.dir === 'out').reduce((s, m) => s + m.qty, 0);
  ok('★ รายการสต๊อกของเลขที่นี้นับเฉพาะฉบับปัจจุบัน (12 ชิ้น) ฉบับเดิมย้ายไปเป็นก่อนแก้ไข', sold === 12
    && D().docs.stockMove.some((m) => m.src === no + ' (ก่อนแก้ไขครั้งที่ 1)'));
  ok('ร่องรอยการแก้ไข: ครั้งที่ 1 เก็บยอดเดิมและใบสำคัญเดิม', e.revision === 1 && e.revisions.length === 1 && e.revisions[0].total === i4.total
    && e.revisions[0].entryNo === entry0 && D().audit.some((a) => a.entity === 'invoice' && a.id === no && a.action === 'update'));
  ok('ยังรอดำเนินการ แก้ได้อีก', e.delivered === false);
  const r = recon('2026-06-30');
  ok('★ ตรวจยอดคุมผ่านทุกข้อ (ลูกหนี้ สต๊อก ภาษีขาย งบทดลอง งบดุล)', r.ok, r.why);
  ok('ภาษีขายรายงาน = บัญชี · ลูกหนี้รายตัว = บัญชีคุม', vatMatch('2026-06') && arMatch('2026-06-30'));
  ok('มูลค่าสต๊อกเท่าบัญชีสินค้าคงเหลือ', ctx.stockValueAsOf('2026-06-30') === ctx.balBySub(['inventory'], '2026-06-30'),
    fmt(ctx.stockValueAsOf('2026-06-30')) + ' / ' + fmt(ctx.balBySub(['inventory'], '2026-06-30')));

  const e2 = ctx.editInvoice(no, { partnerCode: cust2.code, date: '2026-07-03', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '4000', itemCode: consult.code }] });
  ok('★ แก้ลูกค้าและย้ายวันที่ไปเดือนถัดไป: ภาษีขายย้ายงวด ลูกหนี้ย้ายราย', e2.no === no && e2.partnerCode === cust2.code && e2.date === '2026-07-03'
    && D().taxTx.filter((t) => t.docNo === no).length === 1 && D().taxTx.find((t) => t.docNo === no).period === '2026-07' && e2.revision === 2);
  ok('★ สต๊อกกลับครบ (ฉบับนี้ไม่มีสินค้า) และไม่ตัดซ้ำ', W().qty === stock0 + 20
    && ctx.stockValueAsOf('2026-07-31') === ctx.balBySub(['inventory'], '2026-07-31') && W().value > value0,
    'คงเหลือ ' + W().qty);
  ok('ตรวจยอดคุม มิ.ย. และ ก.ค. ผ่าน', recon('2026-06-30').ok && recon('2026-07-31').ok && vatMatch('2026-06') && vatMatch('2026-07'),
    recon('2026-06-30').why + ' ' + recon('2026-07-31').why);
  ctx.editInvoice(no, { partnerCode: cust.code, date: '2026-06-15', lines: [{ desc: 'สินค้า ก', qty: 3, price: '200', itemCode: widget.code }] });
  const cn = ctx.issueCreditNote({ invoiceNo: no, base: '200', date: '2026-06-20', reason: 'RETURN_DEFECT', returnLines: [{ itemCode: widget.code, qty: 1 }] });
  ok('★ หลังแก้ ใบลดหนี้รับคืนสินค้าได้ตามจำนวนของฉบับปัจจุบัน (ขายไป 3)', cn.returns[0].qty === 1);
  throws('รับคืนเกินที่ขายในฉบับปัจจุบันไม่ได้', () => ctx.issueCreditNote({ invoiceNo: no, base: '100', date: '2026-06-20', reason: 'RETURN_DEFECT',
    returnLines: [{ itemCode: widget.code, qty: 3 }] }), 'RETURN_EXCEEDS_SOLD');
  ok('ออกใบลดหนี้แล้ว = ส่งให้ลูกค้าแล้ว', inv(no).delivered === true);
  throws('ส่งให้ลูกค้าแล้วแก้ไขไม่ได้', () => ctx.editInvoice(no, { note: 'x' }), 'INVOICE_NOT_EDITABLE');
  ctx.voidDocument('creditNote', cn.no, 'ทดสอบยกเลิกใบลดหนี้');
  const q1 = W().qty;
  ctx.voidDocument('invoice', no, 'ทดสอบยกเลิกหลังแก้ไข');
  ok('★ ยกเลิกใบที่แก้มาแล้ว คืนสต๊อกเฉพาะฉบับปัจจุบัน (3 ชิ้น) ไม่คืนซ้ำ', W().qty === q1 + 3, q1 + ' → ' + W().qty);
  const rr = recon('2026-06-30');
  ok('ตรวจยอดคุมผ่านหลังยกเลิก', rr.ok && vatMatch('2026-06') && arMatch('2026-06-30'), rr.why);
}

console.log('\n=== 5. แก้ใบกำกับ: เงื่อนไขที่ไม่อนุญาต ===');
{
  const mayInv = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-05-20', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1000' }] });
  const mayInv2 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-05-21', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1000' }] });
  ctx.fileVat('2026-05');
  throws('★ ยื่น ภ.พ.30 ของเดือนนั้นแล้ว แก้ไม่ได้', () => ctx.editInvoice(mayInv.no, { note: 'x' }), 'TAX_ALREADY_FILED');
  throws('ยื่น ภ.พ.30 แล้ว รีเซ็ตไม่ได้', () => { ctx.setInvoiceDelivered(mayInv2.no, true); ctx.setInvoiceDelivered(mayInv2.no, false); }, 'TAX_ALREADY_FILED');
  const jun = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-22', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1000' }] });
  throws('★ ย้ายวันที่ไปเดือนที่ยื่นแบบแล้วไม่ได้ (ไม่มีอะไรเปลี่ยน)', () => ctx.editInvoice(jun.no, { date: '2026-05-25' }), 'TAX_PERIOD_FILED');
  ok('ล้มแล้วใบเดิมอยู่ครบ ใบสำคัญเดิมยังไม่ถูกกลับรายการ', inv(jun.no).date === '2026-06-22'
    && D().entries.find((e) => e.no === inv(jun.no).entryNo).status === 'posted' && D().taxTx.filter((t) => t.docNo === jun.no).length === 1);
  D().periods.find((p) => p.code === '2026-06').status = 'closed';
  throws('★ งวดปิดแล้ว แก้ไม่ได้', () => ctx.editInvoice(jun.no, { note: 'x' }), 'PERIOD_CLOSED');
  D().periods.find((p) => p.code === '2026-06').status = 'open';
  throws('ใบที่ยกเลิกแล้วแก้ไม่ได้', () => ctx.editInvoice(i2.no, { note: 'x' }), 'INVOICE_VOID');

  /* ผูกใบสั่งขาย — แก้ได้แค่หัวเอกสาร */
  const so = ctx.issueTradeDoc('salesOrder', { partnerCode: cust.code, date: '2026-06-20', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 4, price: '1000', itemCode: consult.code }] });
  ctx.setTradeDocStatus('salesOrder', so.no, 'approved');
  const si = ctx.invoiceSalesOrder(so.no, { date: '2026-06-21', lines: [{ line: 0, qty: 2 }] });
  const h = ctx.editInvoice(si.no, { project: 'โครงการ SO', reference: 'REF-9', creditType: 'credit', creditDays: 60 });
  ok('★ ใบที่ผูกใบสั่งขาย แก้หัวเอกสารได้ (โปรเจกต์ เลขอ้างอิง เครดิต 60 วัน) ยอดและใบสำคัญเดิม', h.project === 'โครงการ SO' && h.reference === 'REF-9'
    && h.creditDays === 60 && h.due === '2026-08-20' && h.entryNo === si.entryNo && h.total === si.total && h.revision === 1);
  throws('★ ใบที่ผูกใบสั่งขาย แก้รายการไม่ได้', () => ctx.editInvoice(si.no, { lines: [{ desc: 'ค่าที่ปรึกษา', qty: 3, price: '1000', itemCode: consult.code }] }),
    'INVOICE_EDIT_HEADER_ONLY');
  ok('ใบสั่งขายยังนับจำนวนที่ออกแล้ว 2', ctx.soInvoiced(D().docs.salesOrder.find((x) => x.no === so.no))[0] === 2);
  /* หักเงินมัดจำไว้ — แก้ได้แค่หัวเอกสาร */
  const dp = ctx.receiveCustomerDeposit({ partnerCode: cust.code, date: '2026-06-02', base: '1000', bankAccount: '1113', desc: 'มัดจำ' });
  const di = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-23', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '5000' }], deposits: [{ no: dp.no }] });
  throws('ใบที่หักเงินมัดจำไว้ แก้ยอดไม่ได้', () => ctx.editInvoice(di.no, { lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '6000' }] }), 'INVOICE_EDIT_HEADER_ONLY');
  ok('ใบที่หักเงินมัดจำไว้ แก้หมายเหตุได้', ctx.editInvoice(di.no, { note: 'หักมัดจำแล้ว' }).note === 'หักมัดจำแล้ว');
  const r = recon('2026-06-30');
  ok('ตรวจยอดคุมผ่าน', r.ok, r.why);
}

console.log('\n=== 6. ออกใบกำกับพร้อมรับเงิน (ชุดเดียว) ===');
{
  const n0 = D().docs.invoice.length, r0 = D().docs.receipt.length, seq0 = JSON.stringify(D().seq);
  const p = ctx.issuePaidInvoice({ partnerCode: cust.code, date: '2026-06-24', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 2, price: '1500', itemCode: consult.code }],
    payment: { method: 'transfer', bankAccount: '1113' } });
  const rc = D().docs.receipt.find((r) => r.invoiceNo === p.no);
  ok('★ ใบกำกับเก็บเงินแล้ว + ใบเสร็จออกพร้อมกัน เงื่อนไขเงินสด', p.status === 'paid' && !!rc && rc.net === M('3210') && p.creditType === 'cash'
    && p.delivered === true && p.receiptNos[0] === rc.no && p.paidAtIssue, p.no + ' / ' + rc.no);
  ok('ลูกหนี้ใบนี้เป็นศูนย์', ctx.invOutstanding(p) === 0);
  const before = JSON.stringify([D().docs.invoice.length, D().docs.receipt.length, D().entries.length, D().seq]);
  throws('★ รับเงินเข้าบัญชีที่ไม่ใช่เงินสด/ธนาคาร → ไม่ออกทั้งใบกำกับและใบเสร็จ', () => ctx.issuePaidInvoice({ partnerCode: cust.code, date: '2026-06-24',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1500' }], payment: { method: 'transfer', bankAccount: '4111' } }), 'CASH_ACCOUNT_INVALID');
  ok('ล้มแล้วไม่มีอะไรค้าง เลขที่ไม่ถูกจอง', JSON.stringify([D().docs.invoice.length, D().docs.receipt.length, D().entries.length, D().seq]) === before);
  const pw = ctx.issuePaidInvoice({ partnerCode: cust.code, date: '2026-06-24', whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '10000', itemCode: consult.code }], payment: { method: 'cheque', bankAccount: '1113', chequeNo: '0012345' } });
  const rw = D().docs.receipt.find((r) => r.invoiceNo === pw.no);
  ok('ใบที่ระบุว่าลูกค้าหัก ณ ที่จ่าย — ใบเสร็จหัก 3% ให้เอง เก็บเลขเช็ค', rw.wht === M('300') && rw.net === M('10400') && rw.chequeNo === '0012345' && pw.status === 'paid');
  const q = ctx.issueTradeDoc('quotation', { partnerCode: cust2.code, date: '2026-06-24', lines: [{ desc: 'งานติดตั้ง', qty: 1, price: '2000' }] });
  const qi = ctx.convertQuotation(q.no, { to: 'invoice', date: '2026-06-25', payment: { method: 'cash', bankAccount: '1111' } });
  ok('ใบเสนอราคา → ใบกำกับพร้อมรับเงินสด', qi.status === 'paid' && qt(q.no).convertedTo === qi.no && qi.fromKind === 'quotation');
  ok('งบทดลองสมดุล ยอดคุมผ่าน', recon('2026-06-30').ok, recon('2026-06-30').why);
  ok('ตัวนับใบกำกับเดินตามที่ออกจริง', D().docs.invoice.length === n0 + 3 && D().docs.receipt.length === r0 + 3 && seq0 !== JSON.stringify(D().seq));
}

console.log('\n=== 7. ใบเสนอราคา → ขายเงินสด · รีเซ็ตใบเสนอราคา/ใบสั่งขาย ===');
{
  const q = ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-06-25',
    lines: [{ desc: 'สินค้า ก', qty: 2, price: '200', itemCode: widget.code, disc: '20' }], pricing: { mode: 'exclusive', lineDisc: 'amount' },
    salesName: 'คุณซี', contact: { address: '99 สาขาเชียงใหม่', branch: '00005' } });
  throws('ใบเสนอราคาแปลงเป็นชนิดที่ไม่รู้จักไม่ได้', () => ctx.convertQuotation(q.no, { to: 'bill' }), 'TRADE_CONVERT_TARGET_INVALID');
  const cs = ctx.convertQuotation(q.no, { to: 'cashSale', date: '2026-06-26', method: 'cash' });
  /* 400 − 20 = 380 ไม่รวมภาษี → 406.60 */
  ok('★ ขายเงินสดจากใบเสนอราคา: ผู้ซื้อ ที่อยู่สาขาที่แก้ ราคาไม่รวมภาษี ส่วนลด ครบ', cs.total === M('406.6') && cs.vatInclusive === false
    && cs.buyerName === cust.name && cs.snap.branch === '00005' && cs.salesName === 'คุณซี' && cs.lines[0].disc === '20', cs.no + ' ' + fmt(cs.total));
  ok('ใบเสนอราคาปิด ชี้ไปขายเงินสด · ขายเงินสดชี้กลับ', qt(q.no).status === 'closed' && qt(q.no).convertedTo === cs.no && cs.fromDoc === q.no);
  ok('เข้ารายงานภาษีขายเป็นใบกำกับอย่างย่อ', D().taxTx.some((t) => t.docNo === cs.no && t.docType === 'abbreviated'));
  throws('รีเซ็ตใบเสนอราคาที่แปลงแล้วไม่ได้', () => ctx.resetSalesDoc('quotation', q.no), 'TRADE_DOC_HAS_DEPENDENTS');
  ctx.voidDocument('cashSale', cs.no, 'ทดสอบยกเลิก');
  ok('★ ยกเลิกขายเงินสด → ใบเสนอราคากลับเป็นอนุมัติ', qt(q.no).status === 'approved' && !qt(q.no).convertedTo);
  ctx.resetSalesDoc('quotation', q.no);
  ok('★ รีเซ็ตเป็นรออนุมัติ แก้ไขได้อีก', qt(q.no).status === 'issued' && ctx.updateTradeDoc('quotation', q.no, { note: 'แก้หลังรีเซ็ต' }).note === 'แก้หลังรีเซ็ต');
  throws('อยู่ในรออนุมัติอยู่แล้ว', () => ctx.resetSalesDoc('quotation', q.no), 'TRADE_DOC_ALREADY_ISSUED');
  ctx.setTradeDocStatus('quotation', q.no, 'rejected');
  ctx.resetSalesDoc('quotation', q.no);
  ok('ไม่อนุมัติ → รีเซ็ตได้', qt(q.no).status === 'issued');
  ctx.setTradeDocStatus('quotation', q.no, 'cancelled');
  throws('ยกเลิกแล้วรีเซ็ตไม่ได้', () => ctx.resetSalesDoc('quotation', q.no), 'TRADE_DOC_NOT_ACTIVE');
  throws('ใบเสนอราคาที่ยกเลิกแปลงไม่ได้', () => ctx.convertQuotation(q.no, { to: 'invoice' }), 'TRADE_DOC_NOT_ACTIVE');
  const so = ctx.issueTradeDoc('salesOrder', { partnerCode: cust.code, date: '2026-06-25', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  ctx.setTradeDocStatus('salesOrder', so.no, 'approved');
  ctx.resetSalesDoc('salesOrder', so.no);
  ok('ใบสั่งขายรีเซ็ตเป็นรออนุมัติได้', D().docs.salesOrder.find((x) => x.no === so.no).status === 'issued');
  const qf = ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-06-26', lines: [{ desc: 'ค่าออกแบบ', qty: 1, price: '1000' }], project: 'P1' });
  const qfi = ctx.convertQuotation(qf.no, { to: 'invoice', date: '2026-06-27', partnerCode: cust.code, lines: [{ desc: 'ค่าออกแบบ (แก้ก่อนบันทึก)', qty: 2, price: '1000' }],
    project: 'P1-แก้', pricing: { mode: 'exclusive' } });
  ok('★ แปลงจากฟอร์มที่แก้ก่อนบันทึก ใช้ค่าที่แก้', qfi.total === M('2140') && qfi.project === 'P1-แก้' && qfi.lines[0].desc === 'ค่าออกแบบ (แก้ก่อนบันทึก)'
    && qt(qf.no).convertedTo === qfi.no);
}

console.log('\n=== 8. หน้าต่างรับชำระครบทุกช่อง ===');
{
  const mk = (amt) => ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-26', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: amt, itemCode: consult.code }] });
  const line = (rc, acc) => D().entries.find((e) => e.no === rc.entryNo).lines.filter((l) => l.acc === acc).reduce((s, l) => s + l.dr - l.cr, 0);
  /* 10,000 + 700 = 10,700 · ลูกค้าหัก 3% 300 · ค่าธรรมเนียม 25 · ค่านายหน้า 100 · ส่วนลดพิเศษ 50 · ปัดเศษ 0.40 */
  const a = mk('10000');
  const ra = ctx.receivePayment({ invoiceNo: a.no, date: '2026-06-27', method: 'transfer', bankAccount: '1113', whtRate: '3', fee: '25',
    payerBank: 'ธนาคารกสิกรไทย', note: 'โอนวันศุกร์',
    adjustments: [{ type: 'commission', amount: '100' }, { type: 'special_discount', amount: '50' }, { type: 'rounding', amount: '0.40' }] });
  ok('★ เงินเข้าบัญชี = 10,700 − 300 − 25 − 100 − 50 − 0.40 = 10,224.60', ra.net === M('10224.6') && line(ra, '1113') === M('10224.6'), fmt(ra.net));
  ok('★ ลงบัญชีแยกรายการ: ค่าธรรมเนียม 5410 · ค่านายหน้า 5200 · ส่วนลดพิเศษ 4131 · ปัดเศษ 9920 · ภาษีถูกหัก', line(ra, '5410') === M('25')
    && line(ra, '5200') === M('100') && line(ra, '4131') === M('50') && line(ra, '9920') === M('0.4') && ra.wht === M('300') && ra.whtRate === '3');
  ok('ลูกหนี้ปิดเต็ม 10,700 สถานะเก็บเงินแล้ว', line(ra, AR()) === -M('10700') && inv(a.no).status === 'paid');
  ok('เก็บธนาคารผู้โอนและหมายเหตุ', ra.payerBank === 'ธนาคารกสิกรไทย' && ra.note === 'โอนวันศุกร์' && ra.adjustments.length === 3);

  const b = mk('1000');
  const rb = ctx.receivePayment({ invoiceNo: b.no, date: '2026-06-27', method: 'cash', bankAccount: '1111', received: '1069', gapType: 'short_over' });
  ok('★ ได้เงินจริง 1,069 ขาด 1 บาท → เงินขาด/เกิน (บัญชีใหม่ 9921)', rb.net === M('1069') && rb.gap === M('1') && rb.gapType === 'short_over'
    && line(rb, rb.gapAcc) === M('1') && /เงินขาด/.test(ctx.acc(rb.gapAcc).name), rb.gapAcc);
  const c = mk('1000');
  const rcv = ctx.receivePayment({ invoiceNo: c.no, date: '2026-06-27', method: 'cash', bankAccount: '1111', received: '1071' });
  ok('ได้เงินเกิน 1 บาท → เครดิตบัญชีเงินขาด/เกิน', rcv.gap === -M('1') && line(rcv, rcv.gapAcc) === -M('1') && rcv.net === M('1071'));
  const d = mk('1000');
  const rd = ctx.receivePayment({ invoiceNo: d.no, date: '2026-06-27', method: 'card', bankAccount: '1113', received: '1040', gapType: 'bank_fee' });
  ok('★ ส่วนต่างเป็นค่าธรรมเนียมธนาคาร (บัตรเครดิต) ลง 5410', rd.gap === M('30') && line(rd, '5410') === M('30') && rd.method === 'card');
  throws('ได้เงินเกินแต่เลือกค่าธรรมเนียม — ไม่ได้', () => ctx.receivePayment({ invoiceNo: mk('1000').no, date: '2026-06-27', bankAccount: '1113',
    received: '1080', gapType: 'bank_fee' }), 'RECEIPT_GAP_OVER_FEE');
  const e = mk('2000');
  const re = ctx.receivePayment({ invoiceNo: e.no, date: '2026-06-27', amount: '1000', method: 'cheque', bankAccount: '1113',
    chequeNo: '7788', chequeDate: '2026-06-30', chequeBank: 'ธนาคารกรุงเทพ', whtAmount: '15', whtBase: '500' });
  ok('★ รับบางส่วน → แบ่งจ่าย · หัก ณ ที่จ่ายระบุจำนวนเอง · เก็บเลขเช็ค วันที่ ธนาคาร', inv(e.no).status === 'partially_paid' && re.wht === M('15')
    && re.net === M('985') && re.chequeNo === '7788' && re.chequeDate === '2026-06-30' && re.chequeBank === 'ธนาคารกรุงเทพ' && re.whtManual);
  const re2 = ctx.receivePayment({ invoiceNo: e.no, date: '2026-06-28', method: 'other', bankAccount: '1113' });
  ok('รับส่วนที่เหลือ → เก็บเงินแล้ว', inv(e.no).status === 'paid' && re2.gross === M('1140') && re2.method === 'other');
  const f = mk('1000');
  throws('ค่าธรรมเนียมติดลบ', () => ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', fee: '-1' }), 'RECEIPT_FEE_NEGATIVE');
  throws('รายการปรับลดไม่รู้จัก', () => ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', adjustments: [{ type: 'gift', amount: '5' }] }), 'RECEIPT_ADJ_INVALID');
  throws('ค่านายหน้าติดลบ', () => ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', adjustments: [{ type: 'commission', amount: '-5' }] }), 'RECEIPT_ADJ_NEGATIVE');
  throws('ปัดเศษเกิน 100 บาท', () => ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', adjustments: [{ type: 'rounding', amount: '150' }] }), 'RECEIPT_ADJ_TOO_LARGE');
  throws('อัตราหัก ณ ที่จ่ายเกิน 15%', () => ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', whtRate: '20' }), 'WHT_RATE_INVALID');
  throws('หักรวมเกินยอดรับ', () => ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', fee: '2000' }), 'RECEIPT_NET_NEGATIVE');
  const rr = ctx.receivePayment({ invoiceNo: f.no, date: '2026-06-27', bankAccount: '1113', adjustments: [{ type: 'rounding', amount: '-0.50' }] });
  ok('ปัดเศษขึ้น (ติดลบ) → เงินเข้ามากกว่ายอด 0.50', rr.net === M('1070.5') && line(rr, '9920') === -M('0.5'));
  const old = mk('1000');
  const ro = ctx.receivePayment({ invoiceNo: old.no, date: '2026-06-27', amount: '1045', whtCode: 'WHT_SERVICE', diffType: 'fee', bankAccount: '1113' });
  ok('★ แบบเดิมยังเหมือนเดิม: ปิดส่วนต่างเป็นค่าธรรมเนียม หัก 3% ตามประเภทเงินได้', ro.diff === M('25') && ro.wht === M('30') && ro.net === M('1015')
    && inv(old.no).status === 'paid');
  const m = ctx.receiptMath(mk('500'), { amount: '300', fee: '10', adjustments: [{ type: 'processing_fee', amount: '5' }] });
  ok('สูตรเดียวกันใช้สรุปยอดในฟอร์ม (ไม่ลงบัญชี): เงินเข้า 285', m.net === M('285') && m.gross === M('300'));
  ok('ทุกใบเสร็จ: งบทดลองสมดุล ลูกหนี้ตรงบัญชีคุม ยอดคุมผ่าน', recon('2026-06-30').ok && arMatch('2026-06-30'), recon('2026-06-30').why);
}

console.log('\n=== 9. ข้อมูลรุ่นก่อน (ไม่มีช่องใหม่) เปิดได้และทำงานต่อได้ ===');
{
  const old = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-28', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '800' }] });
  const g = ctx.issueBillingNote({ partnerCode: cust.code, date: '2026-06-29', invoiceNos: [old.no] });
  const saved = JSON.parse(JSON.stringify(ctx.DB));
  const si = saved.docs.invoice.find((d) => d.no === old.no);
  delete si.delivered; delete si.deliveredAt; delete si.fromKind;
  const sb = saved.docs.billingNote.find((b) => b.no === g.no);
  delete sb.mode; delete sb.delivered;
  saved.docs.receipt.forEach((r) => { delete r.fee; delete r.adjustments; delete r.gap; delete r.received; });
  ctx.loadState(saved);
  ok('★ ใบวางบิลรุ่นก่อน (ไม่มี mode) = ใบวางบิลรวมใบกำกับ ทำงานเหมือนเดิม', !ctx.isItemBilling(bn(g.no)) && ctx.billingNoteStatus(bn(g.no)) === 'issued');
  const made = ctx.receiveBillingNote(g.no, { date: '2026-06-30', bankAccount: '1113' });
  ok('รับชำระตามใบวางบิลรุ่นก่อนได้', made.length === 1 && ctx.billingNoteStatus(bn(g.no)) === 'paid');
  const i2 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-28', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '800' }] });
  const s2 = JSON.parse(JSON.stringify(ctx.DB));
  delete s2.docs.invoice.find((d) => d.no === i2.no).delivered;
  ctx.loadState(s2);
  throws('ใบกำกับรุ่นก่อน (ไม่มีธง) ถือว่าส่งแล้ว ต้องรีเซ็ตก่อนแก้', () => ctx.editInvoice(i2.no, { note: 'x' }), 'INVOICE_NOT_EDITABLE');
  ctx.setInvoiceDelivered(i2.no, false);
  ok('รีเซ็ตใบรุ่นก่อนแล้วแก้ไขได้', ctx.editInvoice(i2.no, { lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '900' }] }).base === M('900'));
  ok('★ ตรวจยอดคุมผ่านทุกข้อหลังเปิดข้อมูลรุ่นก่อน', recon('2026-06-30').ok, recon('2026-06-30').why);
  ok('เลขที่ใบกำกับ ใบเสร็จ ใบวางบิล ไม่ซ้ำ', uniqueNos('invoice') && uniqueNos('receipt') && uniqueNos('billingNote'));
}

done();
