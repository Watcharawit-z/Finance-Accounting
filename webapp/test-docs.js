/* ทดสอบเอกสารธุรกิจแบบที่นักบัญชีคุ้นมือ — ส่วนลดรายการ ส่วนลดท้ายบิล ราคารวม/ไม่รวมภาษี
   เงื่อนไขชำระ วันครบกำหนด โปรเจกต์ เลขอ้างอิง หมายเหตุ ข้อมูลลูกค้าที่แก้บนเอกสาร และการส่งต่อเมื่อแปลงเอกสาร
   รันด้วย node webapp/test-docs.js */
const { ctx, ok, throws, done } = require('./testlib');
const M = ctx.M, fmt = ctx.fmt;

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const partner = (o) => ctx.savePartner(o).partner;
const bal = (code, to) => ctx.DB.entries.filter((e) => e.date <= (to || '2099-12-31'))
  .reduce((s, e) => s + e.lines.filter((l) => l.acc === code).reduce((t, l) => t + (l.dr || 0) - (l.cr || 0), 0), 0);

ctx.buildBlank({ name: 'บริษัท ทดสอบเอกสาร จำกัด', year: 2026 });
ctx.TODAY = '2026-06-30';
const cust = partner({ kind: 'customer', name: 'บริษัท ลูกค้าเครดิต จำกัด', taxId: tid('010555812345'), branch: '00000',
  address: '1 ถนนสุขุมวิท กรุงเทพฯ 10110', termDays: 30 });
const vend = partner({ kind: 'vendor', name: 'บริษัท ผู้ขายวัสดุ จำกัด', taxId: tid('010555867890'), branch: '00000',
  address: '9 ถนนพระราม 4 กรุงเทพฯ 10500', termDays: 15 });
const widget = ctx.saveItem({ name: 'สินค้า ก', type: 'stock', uom: 'ชิ้น', price: '100' }).item;
const consult = ctx.saveItem({ name: 'ค่าที่ปรึกษา', type: 'service', uom: 'ชั่วโมง', price: '1500' }).item;

console.log('\n=== 1. คำนวณทั้งใบ: ส่วนลดรายการ ส่วนลดท้ายบิล ราคารวม/ไม่รวมภาษี ===');
{
  const lines = [{ qty: 3, price: '1000', taxCode: 'VAT7' }, { qty: 2, price: '450.50', taxCode: 'VAT7' }, { qty: 1, price: '800', taxCode: 'EXEMPT' }];
  const a = ctx.priceLines(lines, '2026-06-10');
  const b = ctx.computeVat(lines, '2026-06-10');
  ok('★ ไม่มีส่วนลด ราคาไม่รวมภาษี = ผลเดิมของ computeVat ทุกสตางค์', a.v.std === b.std && a.v.vat === b.vat && a.v.total === b.total && a.v.exempt === b.exempt,
    fmt(a.v.total) + ' = ' + fmt(b.total));

  const d = ctx.priceLines([{ qty: 3, price: '1000', disc: '10', taxCode: 'VAT7' }, { qty: 2, price: '450.50', disc: '1.25', taxCode: 'VAT7' }],
    '2026-06-10', { mode: 'exclusive', lineDisc: 'percent', bill: { kind: 'amount', value: '200' } });
  /* 3,000 −10% = 2,700 · 901 −1.25% = 889.74 (ส่วนลด 11.26) · รวม 3,589.74 − 200 = 3,389.74 · ภาษี 237.28 */
  ok('ส่วนลดรายการเป็นเปอร์เซ็นต์ หักต่อบรรทัด', d.rows[0].discount === M('300') && d.rows[1].discount === M('11.26'));
  ok('★ ส่วนลดท้ายบิลแบ่งตามสัดส่วนบรรทัด ผลรวมพอดี 200.00', d.rows[0].billShare + d.rows[1].billShare === M('200'),
    fmt(d.rows[0].billShare) + ' + ' + fmt(d.rows[1].billShare));
  ok('★ ยอดก่อนภาษี 3,389.74 ภาษี 237.28 รวม 3,627.02', d.v.std === M('3389.74') && d.v.vat === M('237.28') && d.v.total === M('3627.02'),
    fmt(d.v.std) + ' / ' + fmt(d.v.vat) + ' / ' + fmt(d.v.total));
  ok('ยอดท้ายเอกสาร: รวมเป็นเงิน 3,901 ส่วนลด 511.26 หลังหักส่วนลด 3,389.74',
    d.totals.subTotal === M('3901') && d.totals.discount === M('511.26') && d.totals.afterDiscount === M('3389.74'));
  ok('มูลค่าบรรทัดหลังส่วนลดรวมเท่ายอดก่อนภาษี', d.rows.reduce((s, r) => s + r.net, 0) === d.v.std);

  const inc = ctx.priceLines([{ qty: 1, price: '1070', taxCode: 'VAT7' }, { qty: 3, price: '33.33', taxCode: 'VAT7' }, { qty: 1, price: '50', taxCode: 'VAT0' }],
    '2026-06-10', { mode: 'inclusive' });
  /* ราคารวมภาษี 1,070 + 99.99 = 1,169.99 → ก่อนภาษี 1,093.45 ภาษี 76.54 · บรรทัด 0% 50 */
  ok('★ ราคารวมภาษี: ถอดภาษีครั้งเดียวทั้งใบ ยอดรวมเท่าราคาที่กรอกพอดี', inc.v.total === M('1219.99') && inc.v.std + inc.v.vat === M('1169.99'),
    fmt(inc.v.std) + ' + ' + fmt(inc.v.vat) + ' + 0% ' + fmt(inc.v.zero));
  ok('ราคารวมภาษี: มูลค่าก่อนภาษีรายบรรทัดรวมเท่ายอดก่อนภาษี', inc.rows.filter((r, i) => i < 2).reduce((s, r) => s + r.net, 0) === inc.v.std);
  ok('ยอดที่ไม่คิดภาษี (0% และยกเว้น) แยกบรรทัดในยอดท้ายเอกสาร', inc.totals.exempt === M('50') && inc.totals.vatable === inc.v.std);

  const incDisc = ctx.priceLines([{ qty: 2, price: '535', disc: '35', taxCode: 'VAT7' }], '2026-06-10',
    { mode: 'inclusive', lineDisc: 'amount', bill: { kind: 'percent', value: '10' } });
  /* 1,070 − 35 = 1,035 − 10% (103.50) = 931.50 รวมภาษี → ก่อนภาษี 870.56 ภาษี 60.94 */
  ok('ราคารวมภาษี + ส่วนลดบาท + ส่วนลดท้ายบิล % : ยอดรวม 931.50', incDisc.v.total === M('931.5') && incDisc.v.std === M('870.56') && incDisc.v.vat === M('60.94'),
    fmt(incDisc.v.std) + ' / ' + fmt(incDisc.v.vat));

  throws('ส่วนลดเกิน 100%', () => ctx.priceLines([{ qty: 1, price: '100', disc: '120' }], '2026-06-10'), 'DISCOUNT_OVER');
  throws('ส่วนลดบาทเกินยอดบรรทัด', () => ctx.priceLines([{ qty: 1, price: '100', disc: '150' }], '2026-06-10', { lineDisc: 'amount' }), 'DISCOUNT_OVER');
  throws('ส่วนลดท้ายบิลเกินยอด', () => ctx.priceLines([{ qty: 1, price: '100' }], '2026-06-10', { bill: { kind: 'amount', value: '101' } }), 'DISCOUNT_OVER');
  throws('ส่วนลดติดลบ', () => ctx.priceLines([{ qty: 1, price: '100', disc: '-5' }], '2026-06-10'), 'DISCOUNT_NEGATIVE');
}

console.log('\n=== 2. ใบกำกับภาษีที่มีส่วนลด ลงบัญชีด้วยยอดหลังหักส่วนลด ===');
let inv;
{
  ctx.post({ type: 'general', date: '2026-06-01', desc: 'ตั้งสต๊อก', lines: [{ acc: '1113', dr: M('100000') }, { acc: '3120', cr: M('100000') }] });
  ctx.recordBill({ partnerCode: vend.code, date: '2026-06-02', vendorNo: 'V-001',
    lines: [{ desc: 'สินค้า ก', qty: 20, price: '60', itemCode: widget.code, disc: '5' }],
    pricing: { lineDisc: 'percent' }, whtCode: 'none' });
  const it = ctx.DB.items.find((x) => x.code === widget.code);
  ok('★ ซื้อสินค้ามีส่วนลด 5%: ต้นทุนเข้าคลังเป็นยอดหลังส่วนลด 1,140 (57/ชิ้น)', it.value === M('1140') && it.qty === 20, fmt(it.value));
  ok('★ ซื้อสินค้านับสต๊อกโดยไม่เลือกบัญชี เข้าบัญชีสินค้าคงเหลือ (ไม่ตกไปค่าใช้จ่าย)', bal(ctx.accBySub('inventory')) === M('1140'));

  const rev0 = bal('4111'), svc0 = bal('4121'), ar0 = bal(ctx.accBySub('trade_receivable'));
  inv = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-10',
    lines: [{ desc: 'สินค้า ก', qty: 10, price: '100', itemCode: widget.code, disc: '10' },
      { desc: 'ค่าที่ปรึกษา', qty: 2, price: '1500', itemCode: consult.code, disc: '0' }],
    pricing: { mode: 'exclusive', lineDisc: 'percent', bill: { kind: 'amount', value: '100' } },
    creditType: 'credit', creditDays: 45, project: 'ปรับปรุงสำนักงาน', salesName: 'คุณเอ', reference: 'PO-ลูกค้า-778',
    note: 'ชำระภายในกำหนด', internalNote: 'ลูกค้าขอส่วนลดพิเศษ' });
  /* 1,000 −10% = 900 · 3,000 · รวม 3,900 − 100 = 3,800 (แบ่ง 23.08/76.92) · ภาษี 266 · รวม 4,066 */
  ok('★ ใบกำกับ: ยอดก่อนภาษี 3,800 ภาษี 266 รวม 4,066', inv.base === M('3800') && inv.vat === M('266') && inv.total === M('4066'),
    fmt(inv.base) + ' / ' + fmt(inv.vat) + ' / ' + fmt(inv.total));
  ok('ลูกหนี้ตั้งเท่ายอดรวมทั้งสิ้น', bal(ctx.accBySub('trade_receivable')) - ar0 === M('4066'));
  ok('★ รายได้ลงด้วยยอดหลังหักส่วนลดทั้งสองแบบ (สินค้า 876.92 · บริการ 2,923.08)',
    (bal('4111') - rev0) + (bal('4121') - svc0) === -M('3800') && inv.lines[0].amount + inv.lines[1].amount === M('3800'),
    fmt(inv.lines[0].amount) + ' + ' + fmt(inv.lines[1].amount));
  ok('ใบเก็บยอดท้ายเอกสารไว้พิมพ์ (รวมเป็นเงิน ส่วนลด หลังหักส่วนลด)', inv.totals.subTotal === M('4000') && inv.totals.discount === M('200')
    && inv.totals.afterDiscount === M('3800'));
  const tx = ctx.DB.taxTx.find((t) => t.docNo === inv.no);
  ok('★ รายงานภาษีขายใช้ฐานหลังหักส่วนลด', tx.base === M('3800') && tx.tax === M('266'));
  ok('เครดิต 45 วัน: ครบกำหนด 25 ก.ค. 2569', inv.creditType === 'credit' && inv.creditDays === 45 && inv.due === '2026-07-25');
  ok('โปรเจกต์ พนักงานขาย เลขอ้างอิง หมายเหตุ โน้ตภายใน เก็บในใบ', inv.project === 'ปรับปรุงสำนักงาน' && inv.salesName === 'คุณเอ'
    && inv.reference === 'PO-ลูกค้า-778' && inv.note === 'ชำระภายในกำหนด' && inv.internalNote === 'ลูกค้าขอส่วนลดพิเศษ');
  ok('งบทดลองสมดุล', ctx.trialBalance('2026-06-01', '2026-06-30').balanced);

  const cash = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-11', creditType: 'cash',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1500', itemCode: consult.code }] });
  ok('เงินสด: ครบกำหนดวันเดียวกัน 0 วัน', cash.creditType === 'cash' && cash.creditDays === 0 && cash.due === '2026-06-11');
  const hid = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-11', creditType: 'creditHidden',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1500', itemCode: consult.code }] });
  ok('เครดิตไม่แสดงวันครบกำหนด: นับวันตามทะเบียนลูกค้า 30 วัน', hid.creditType === 'creditHidden' && hid.creditDays === 30 && hid.due === '2026-07-11');
  const byDue = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-11', dueDate: '2026-06-21',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1500', itemCode: consult.code }] });
  ok('★ กำหนดวันครบกำหนดเอง ระบบนับจำนวนวันกลับให้ (10 วัน)', byDue.creditDays === 10 && byDue.due === '2026-06-21');
  throws('วันครบกำหนดก่อนวันที่เอกสาร', () => ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-11', dueDate: '2026-06-01',
    lines: [{ desc: 'x', qty: 1, price: '100' }] }), 'DUE_BEFORE_DATE');
  throws('วันเครดิตติดลบ', () => ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-11', creditDays: -3,
    lines: [{ desc: 'x', qty: 1, price: '100' }] }), 'CREDIT_DAYS_INVALID');

  const br = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-12',
    contact: { address: '77 ถนนบางนา-ตราด สมุทรปราการ 10540', branch: '00002' },
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '1500', itemCode: consult.code }] });
  ok('★ ออกใบให้สาขาอื่นของลูกค้า: แก้ที่อยู่/สาขาบนใบได้ ทะเบียนไม่เปลี่ยน', br.snap.branch === '00002' && /บางนา/.test(br.snap.address)
    && ctx.DB.partners.find((p) => p.code === cust.code).branch === '00000');
  const tx2 = ctx.DB.taxTx.find((t) => t.docNo === br.no);
  ok('รายงานภาษีขายใช้สาขาตามที่ออกใบจริง', tx2.branch === '00002');
  throws('แก้เลขผู้เสียภาษีบนใบเป็นเลขผิดหลัก', () => ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-12',
    contact: { taxId: '1234567890123' }, lines: [{ desc: 'x', qty: 1, price: '100' }] }), 'TAX_ID_INVALID');
}

console.log('\n=== 3. ใบเสนอราคา → ใบสั่งขาย → ใบกำกับ ส่งต่อราคา ส่วนลด และหัวเอกสาร ===');
{
  const q = ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-06-15',
    lines: [{ desc: 'ค่าที่ปรึกษา', qty: 10, price: '1500', itemCode: consult.code, disc: '500' }],
    pricing: { mode: 'inclusive', lineDisc: 'amount', bill: { kind: 'amount', value: '1000' } },
    project: 'ระบบใหม่', salesName: 'คุณบี', note: 'ราคานี้รวมภาษีแล้ว', creditDays: 20 });
  /* 15,000 − 500 − 1,000 = 13,500 รวมภาษี → ก่อนภาษี 12,616.82 ภาษี 883.18 */
  ok('★ ใบเสนอราคาราคารวมภาษี + ส่วนลด: ยอดรวม 13,500', q.total === M('13500') && q.base === M('12616.82') && q.vat === M('883.18'),
    fmt(q.base) + ' / ' + fmt(q.vat));
  const q2 = ctx.updateTradeDoc('quotation', q.no, { note: 'แก้หมายเหตุอย่างเดียว' });
  ok('แก้หมายเหตุอย่างเดียว ราคาและส่วนลดคงเดิม', q2.total === M('13500') && q2.pricing.mode === 'inclusive' && q2.project === 'ระบบใหม่'
    && q2.note === 'แก้หมายเหตุอย่างเดียว');
  ctx.setTradeDocStatus('quotation', q.no, 'approved');
  const so = ctx.convertTradeDoc('quotation', q.no, { date: '2026-06-16' });
  ok('★ ใบสั่งขายได้ราคา ส่วนลด โปรเจกต์ หมายเหตุ ครบจากใบเสนอราคา', so.total === M('13500') && so.pricing.mode === 'inclusive'
    && so.project === 'ระบบใหม่' && so.salesName === 'คุณบี' && so.note === 'แก้หมายเหตุอย่างเดียว' && so.reference === q.no);
  const part = ctx.invoiceSalesOrder(so.no, { date: '2026-06-20', lines: [{ line: 0, qty: 4 }] });
  /* 4 จาก 10: 6,000 − 200 (ส่วนลดบาทแบ่งตามจำนวน) = 5,800 − ส่วนลดท้ายบิล 1,000/14,500 = 6.8966% → 400 = 5,400 */
  ok('★ ออกใบกำกับบางส่วน: ส่วนลดรายการแบ่งตามจำนวน ส่วนลดท้ายบิลตามสัดส่วน', part.total === M('5400'), fmt(part.total));
  const rest = ctx.invoiceSalesOrder(so.no, { date: '2026-06-25' });
  ok('★ ออกส่วนที่เหลือ: สองใบรวมกันเท่าใบสั่งขายพอดี 13,500', part.total + rest.total === M('13500'), fmt(rest.total));
  ok('ใบกำกับจากใบสั่งขายได้เครดิต 20 วันตามใบเสนอราคา', rest.creditDays === 20 && rest.due === '2026-07-15');
  ok('งบทดลองสมดุล', ctx.trialBalance('2026-06-01', '2026-06-30').balanced);
}

console.log('\n=== 4. ใบสั่งซื้อ → ตั้งหนี้ และค่าใช้จ่าย ที่มีส่วนลด ===');
{
  const po = ctx.issueTradeDoc('purchaseOrder', { partnerCode: vend.code, date: '2026-06-18',
    lines: [{ desc: 'สินค้า ก', qty: 10, price: '64.20', itemCode: widget.code }],
    pricing: { mode: 'inclusive', bill: { kind: 'amount', value: '42' } }, reference: 'ใบเสนอราคาผู้ขาย Q-55' });
  ctx.setTradeDocStatus('purchaseOrder', po.no, 'approved');
  const before = ctx.DB.items.find((x) => x.code === widget.code);
  const v0 = before.value, q0 = before.qty;
  const bill = ctx.convertTradeDoc('purchaseOrder', po.no, { date: '2026-06-19', vendorNo: 'V-002' });
  /* 642 − 42 = 600 รวมภาษี → ก่อนภาษี 560.75 ภาษี 39.25 */
  ok('★ ตั้งหนี้จากใบสั่งซื้อราคารวมภาษี: ยอดรวม 600 ภาษีซื้อ 39.25', bill.total === M('600') && bill.vat === M('39.25'), fmt(bill.base));
  const after = ctx.DB.items.find((x) => x.code === widget.code);
  ok('ต้นทุนเข้าคลังเป็นยอดก่อนภาษีหลังส่วนลด 560.75', after.value - v0 === M('560.75') && after.qty - q0 === 10);
  ok('ตั้งหนี้: เครดิตตามทะเบียนผู้ขาย 15 วัน · เลขอ้างอิงคือใบสั่งซื้อเดิม', bill.due === '2026-07-04' && bill.reference === 'ใบเสนอราคาผู้ขาย Q-55');

  const ex = ctx.recordExpense({ partnerCode: vend.code, date: '2026-06-20', taxInvoiceNo: 'V-EX-1',
    lines: [{ desc: 'ค่าซ่อมแอร์', qty: 1, price: '2140', acc: '5321', disc: '140' }],
    pricing: { mode: 'inclusive', lineDisc: 'amount' }, project: 'สาขาบางนา', note: 'ซ่อมตามรอบ' });
  ok('★ ค่าใช้จ่ายราคารวมภาษีมีส่วนลด: ก่อนภาษี 1,869.16 ภาษี 130.84', ex.base === M('1869.16') && ex.vat === M('130.84') && ex.total === M('2000'),
    fmt(ex.base) + ' / ' + fmt(ex.vat));
  ok('ค่าใช้จ่ายเก็บโปรเจกต์และหมายเหตุ', ex.project === 'สาขาบางนา' && ex.note === 'ซ่อมตามรอบ');
  ok('งบทดลองสมดุล', ctx.trialBalance('2026-06-01', '2026-06-30').balanced);
}

console.log('\n=== 5. ขายเงินสดมีส่วนลด ===');
{
  const cs = ctx.issueCashSale({ date: '2026-06-22', vatInclusive: true,
    lines: [{ desc: 'สินค้า ก', qty: 2, price: '107', itemCode: widget.code, disc: '7' }],
    pricing: { lineDisc: 'amount' } });
  /* 214 − 7 = 207 รวมภาษี → ก่อนภาษี 193.46 ภาษี 13.54 */
  ok('★ ขายเงินสดราคาป้ายมีส่วนลด: รับเงิน 207 ภาษี 13.54', cs.total === M('207') && cs.vat === M('13.54'), fmt(cs.base));
  ok('รายการเก็บส่วนลดและยอดก่อนส่วนลด', cs.lines[0].disc === '7' && cs.lines[0].gross === M('214') && cs.totals.discount === M('7'));
  ok('ตรวจยอดคุมผ่านทุกข้อ', ctx.reconciliationChecks('2026-06-30').checks.every((c) => c.ok),
    ctx.reconciliationChecks('2026-06-30').checks.filter((c) => !c.ok).map((c) => c.label).join(' | '));
}

console.log('\n=== 6. เลขที่เอกสาร: คำนำหน้า + ปี ค.ศ. + เดือน + เลขรัน ===');
{
  ok('★ บริษัทใหม่ใช้รูปแบบ INV + ปี ค.ศ. + เดือน + เลขรัน 4 หลัก', /^INV202606\d{4}$/.test(inv.no), inv.no);
  const q = ctx.DB.docs.quotation[0];
  ok('ใบเสนอราคา QT · ใบรับชำระ RE · ขายเงินสด CA · ตั้งหนี้ RI · ค่าใช้จ่าย EXP', /^QT202606/.test(q.no)
    && /^CA202606/.test(ctx.DB.docs.cashSale[0].no) && /^RI202606/.test(ctx.DB.docs.bill[0].no) && /^EXP202606/.test(ctx.DB.docs.expense[0].no));
  ok('ตัวอย่างเลขที่ใบเสร็จ', ctx.formatDocNo('receipt', '2026-06-05', 1) === 'RE2026060001', ctx.formatDocNo('receipt', '2026-06-05', 1));
  ctx.saveNumbering({ style: 'fa', reset: 'year', prefixes: { invoice: 'iv' } });
  const y1 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-26', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  const y2 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-07-02', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  ok('★ นับใหม่ทุกปี + คำนำหน้าที่ตั้งเอง: IV2026000001 → IV2026000002 ข้ามเดือนไม่เริ่มใหม่', y1.no === 'IV2026000001' && y2.no === 'IV2026000002',
    y1.no + ' ' + y2.no);
  throws('คำนำหน้าเป็นภาษาไทยหรือยาวเกิน 6 ตัวไม่ได้', () => ctx.saveNumbering({ style: 'fa', prefixes: { invoice: 'ใบกำกับ' } }), 'PREFIX_INVALID');
  ctx.saveNumbering({ style: 'fa', reset: 'month', prefixes: {} });

  /* ข้อมูลที่บันทึกก่อนมีตั้งค่าเลขที่ — คงรูปแบบเดิม */
  const saved = JSON.parse(JSON.stringify(ctx.DB));
  delete saved.settings.numbering;
  ctx.loadState(saved);
  ok('★ ข้อมูลเดิมที่เปิดขึ้นมาใช้รูปแบบเลขที่แบบเดิมต่อ', ctx.numberingOf().style === 'legacy');
  const old = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-27', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  ok('รูปแบบเดิม INV2606-xxxxx', /^INV2606-\d{5}$/.test(old.no), old.no);
  ctx.saveNumbering({ style: 'fa', reset: 'month' });
  const neu = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-28', lines: [{ desc: 'x', qty: 1, price: '100' }] });
  ok('★ เปลี่ยนเป็นรูปแบบใหม่กลางเดือน เลขรันต่อจากเดิม ไม่เริ่ม 1 ใหม่', neu.no === 'INV202606' + String(Number(old.no.slice(-5)) + 1).padStart(4, '0'),
    old.no + ' → ' + neu.no);
  const nos = ctx.DB.docs.invoice.map((d) => d.no);
  ok('เลขที่ใบกำกับไม่ซ้ำกันเลย', new Set(nos).size === nos.length);
}

console.log('\n=== 7. สมุดรายชื่อและสินค้าแบบเอกสารธุรกิจ ===');
{
  const both = partner({ kind: 'both', name: 'บริษัท ซื้อมาขายไป จำกัด', taxId: tid('010555899999'), branch: '00000',
    address: '5 ถนนเพชรบุรี กรุงเทพฯ', zip: '10400', contactPerson: 'คุณซี', email: 'ac@example.co.th', mobile: '081-234-5678',
    bankName: 'กสิกรไทย', bankAccount: '123-4-56789-0', bankAccountName: 'บจก. ซื้อมาขายไป', termDays: 7 });
  ok('★ ผู้จำหน่ายและลูกค้า: รายเดียวอยู่ทั้งรายชื่อลูกค้าและผู้ขาย', ctx.isCustomer(both) && ctx.isVendor(both));
  const i1 = ctx.issueInvoice({ partnerCode: both.code, date: '2026-06-29', lines: [{ desc: 'ค่าที่ปรึกษา', qty: 1, price: '2000', itemCode: consult.code }] });
  const b1 = ctx.recordBill({ partnerCode: both.code, date: '2026-06-29', vendorNo: 'BOTH-1', whtCode: 'none',
    lines: [{ desc: 'วัสดุ', qty: 1, price: '500', acc: '5321' }] });
  ok('ออกใบกำกับให้ และตั้งหนี้จากรายเดียวกันได้', !!i1.no && !!b1.no);
  ok('ใบกำกับเก็บผู้ติดต่อ อีเมล เบอร์ และรหัสไปรษณีย์ต่อท้ายที่อยู่', i1.snap.contactPerson === 'คุณซี' && i1.snap.email === 'ac@example.co.th'
    && /10400$/.test(i1.snap.address));
  ok('บัญชีธนาคารของคู่ค้าเก็บในทะเบียน', both.bankName === 'กสิกรไทย' && both.bankAccount === '123-4-56789-0' && both.bankAccountType === 'saving');
  throws('เลขผู้เสียภาษีซ้ำกับลูกค้าเดิมไม่ได้แม้ตั้งเป็นผู้จำหน่ายและลูกค้า', () => partner({ kind: 'both', name: 'ซ้ำ', taxId: cust.taxId, branch: '00000' }),
    'PARTNER_DUPLICATE_TAX_ID');
  throws('อีเมลผิดรูปแบบ', () => partner({ kind: 'customer', name: 'อีเมลผิด', email: 'abc' }), 'EMAIL_INVALID');
  ctx.savePartner({ code: both.code, kind: 'both', name: both.name, taxId: both.taxId, branch: '00000', email: '' });
  ok('แก้ทะเบียนส่งอีเมลว่าง = ลบอีเมล ช่องอื่นที่ไม่ส่งคงเดิม', both.email === '' && both.contactPerson === 'คุณซี');

  const ns = ctx.saveItem({ name: 'ถุงผ้าพรีเมียม', type: 'nonstock', uom: 'ใบ', price: '120', buyPrice: '80', sellVat: 'inclusive',
    buyVat: 'exclusive', barcode: '8850000000011', revenueAcc: '4111', expenseAcc: '5321' }).item;
  ok('★ สินค้าไม่นับสต๊อก: มีราคาซื้อ ราคาขาย ชนิดภาษี และบาร์โค้ด', ns.type === 'nonstock' && ns.buyPrice === M('80') && ns.sellVat === 'inclusive'
    && ns.barcode === '8850000000011');
  const i2 = ctx.issueInvoice({ partnerCode: cust.code, date: '2026-06-29', lines: [{ desc: 'ถุงผ้า', qty: 5, price: '100', itemCode: ns.code }] });
  ok('ขายสินค้าไม่นับสต๊อก ไม่ตัดสต๊อก ไม่มีต้นทุนขาย', !i2.cogsEntryNo && ctx.DB.items.find((x) => x.code === ns.code).qty === 0);
  const je = ctx.DB.entries.find((e) => e.no === i2.entryNo);
  ok('ลงรายได้ตามบัญชีที่ตั้งในทะเบียนสินค้า (4111)', je.lines.some((l) => l.acc === '4111' && l.cr === M('500')));
  const b2 = ctx.recordBill({ partnerCode: vend.code, date: '2026-06-29', vendorNo: 'NS-1', whtCode: 'none',
    lines: [{ desc: 'ถุงผ้า', qty: 10, price: '80', itemCode: ns.code }] });
  const je2 = ctx.DB.entries.find((e) => e.no === b2.entryNo);
  ok('ซื้อสินค้าไม่นับสต๊อก ลงบัญชีค่าใช้จ่ายที่ตั้งไว้ (5321) ไม่เข้าคลัง', je2.lines.some((l) => l.acc === '5321' && l.dr === M('800')));
  const q = ctx.issueTradeDoc('quotation', { partnerCode: cust.code, date: '2026-06-29', whtCode: 'WHT_SERVICE',
    lines: [{ desc: 'ถุงผ้า', qty: 20, price: '100', itemCode: ns.code }, { desc: 'ค่าออกแบบ', qty: 1, price: '3000', itemCode: consult.code }] });
  ok('★ หัก ณ ที่จ่ายคิดเฉพาะค่าบริการ ไม่รวมสินค้าไม่นับสต๊อก', q.whtBase === M('3000') && q.wht === M('90'), ctx.fmt(q.whtBase));
  throws('บัญชีรายได้ในทะเบียนสินค้าต้องเป็นบัญชีรายได้', () => ctx.saveItem({ name: 'x', type: 'service', revenueAcc: '5321' }), 'ITEM_ACCOUNT_INVALID');
  throws('เปลี่ยนสินค้าที่ยังมีของเป็นสินค้าไม่นับสต๊อกไม่ได้', () => ctx.saveItem({ code: widget.code, name: widget.name, type: 'nonstock' }), 'ITEM_STILL_IN_STOCK');
  ok('งบทดลองสมดุล', ctx.trialBalance('2026-06-01', '2026-06-30').balanced);
}

done();
