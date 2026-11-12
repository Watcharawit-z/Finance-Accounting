/* ทดสอบยอดขาย กำไร เทียบค่าแอด รายวัน (owner.js) — รันด้วย node webapp/test-owner.js
   ตัวเลขที่คาดไว้คิดด้วยมือตามคอมเมนต์ของแต่ละข้อ */
const T = require('./testlib');
const { ok, done } = T;
function freshCtx() {
  delete require.cache[require.resolve('./testlib')];
  return require('./testlib').ctx;
}

function scenario(C, periodic) {
  C.buildBlank({ name: 'บริษัท ขายออนไลน์ จำกัด', year: 2026 });
  if (periodic) C.setInventoryMethod('periodic');
  const cust = C.savePartner({ kind:'customer', name:'บริษัท ลูกค้าดี จำกัด', taxId:'0105540022881', branch:'00000',
    address:'1 ถนนสุขุมวิท กรุงเทพมหานคร', termDays: 30 }).partner.code;
  const it = C.saveItem({ name:'ครีม ก', type:'stock', uom:'ชิ้น', price:'300' }).item.code;
  const svc = C.saveItem({ name:'ค่าจัดส่ง', type:'service', uom:'ครั้ง', price:'50' }).item.code;
  /* ยอดยกมา 20 ชิ้น × 100 — วันที่ 1 ไม่ใช่ยอดขาย */
  C.saveStockAdj({ kind:'opening', date:'2026-11-01', lines:[{ itemCode: it, qty: 20, value: '2000' }] });
  /* 2 พ.ย. ขาย 3 ชิ้น × 300 + ค่าจัดส่ง 50 = 950 · ต้นทุน 300 */
  C.issueInvoice({ partnerCode: cust, date:'2026-11-02', lines:[{ itemCode: it, desc:'ครีม ก', qty: 3, price:'300', taxCode:'VAT7' },
    { itemCode: svc, desc:'ค่าจัดส่ง', qty: 1, price:'50', taxCode:'VAT7' }] });
  /* 3 พ.ย. ขายเงินสด 2 ชิ้น ราคารวมภาษี 321 = ก่อนภาษี 300 ต่อชิ้น → 600 · ต้นทุน 200 */
  C.issueCashSale({ date:'2026-11-03', vatInclusive: true, lines:[{ itemCode: it, desc:'ครีม ก', qty: 2, price:'321' }] });
  /* 4 พ.ย. ขาย 5 ชิ้นแล้วยกเลิก — วันนั้นยอดขายและต้นทุนเป็นศูนย์ */
  const v = C.issueInvoice({ partnerCode: cust, date:'2026-11-04', lines:[{ itemCode: it, desc:'ครีม ก', qty: 5, price:'300', taxCode:'VAT7' }] });
  C.voidDocument('invoice', v.no, 'ลูกค้ายกเลิกคำสั่งซื้อ');
  /* 5 พ.ย. ขาย 4 ชิ้น × 300 = 1,200 ต้นทุน 400 · 6 พ.ย. ลูกค้าคืน 1 ชิ้น ลดหนี้ 300 ต้นทุนคืน 100 */
  const inv = C.issueInvoice({ partnerCode: cust, date:'2026-11-05', lines:[{ itemCode: it, desc:'ครีม ก', qty: 4, price:'300', taxCode:'VAT7' }] });
  C.issueCreditNote({ invoiceNo: inv.no, base:'300', date:'2026-11-06', reason:'RETURN_DEFECT', returnLines:[{ itemCode: it, qty: 1 }] });
}
const ADS = [
  { date:'2026-11-02', shop:'TikTok ร้าน A', amount:'200.00' }, { date:'2026-11-02', shop:'TikTok ร้าน B', amount:'150.50' },
  { date:'2026-11-03', shop:'TikTok ร้าน A', amount:'500' }, { date:'2026-11-05', shop:'TikTok ร้าน B', amount:'1000' },
  { date:'2026-11-07', shop:'TikTok ร้าน A', amount:'300' }, { date:'2026-10-31', shop:'TikTok ร้าน A', amount:'999' },
];

const C = freshCtx();
scenario(C, false);
const M = C.M, fmt = C.fmt;
const r = C.adsCompare('2026-11-01', '2026-11-30', ADS);
const day = (d) => r.rows.find((x) => x.date === d);

console.log('\n=== 1. ยอดขายและต้นทุนรายวัน ===');
ok('ทุกวันในเดือนมีแถว (30 วัน) วันที่ไม่มีรายการเป็นศูนย์', r.rows.length === 30 && day('2026-11-20').sales === 0 && day('2026-11-20').ad === 0);
ok('ยอดยกมาวันที่ 1 ไม่นับเป็นยอดขายหรือต้นทุน', day('2026-11-01').sales === 0 && day('2026-11-01').cost === 0);
ok('★ 2 พ.ย. ยอดขาย 950 (สินค้า + ค่าบริการ ก่อนภาษี) ต้นทุน 300 กำไรขั้นต้น 650',
  day('2026-11-02').sales === M('950') && day('2026-11-02').cost === M('300') && day('2026-11-02').gross === M('650'),
  fmt(day('2026-11-02').sales) + ' / ' + fmt(day('2026-11-02').cost));
ok('★ 3 พ.ย. ขายเงินสดราคารวมภาษี นับยอดก่อนภาษี 600 ต้นทุน 200', day('2026-11-03').sales === M('600') && day('2026-11-03').cost === M('200'),
  fmt(day('2026-11-03').sales));
ok('★ 4 พ.ย. ใบที่ยกเลิก ยอดขายและต้นทุนเป็นศูนย์', day('2026-11-04').sales === 0 && day('2026-11-04').cost === 0);
ok('★ 6 พ.ย. ลูกค้าคืนของ ยอดขาย −300 ต้นทุน −100', day('2026-11-06').sales === -M('300') && day('2026-11-06').cost === -M('100'),
  fmt(day('2026-11-06').sales) + ' / ' + fmt(day('2026-11-06').cost));
ok('★ ยอดขายทั้งเดือนเท่ากับรายได้จากการขายในงบกำไรขาดทุน', r.totals.sales === C.balBySub(C.SALES_SUBS, '2026-11-30', '2026-11-01') * -1,
  fmt(r.totals.sales));

console.log('\n=== 2. ค่าแอด ===');
ok('★ 2 พ.ย. ค่าแอดสองร้านรวม 350.50 กำไรหลังค่าแอด 299.50 ROAS 2.71 เท่า', day('2026-11-02').ad === M('350.50')
  && day('2026-11-02').net === M('299.50') && Math.abs(day('2026-11-02').roas - 950 / 350.5) < 1e-9, day('2026-11-02').roas.toFixed(2));
ok('ค่าแอดนอกช่วง (31 ต.ค.) ไม่นับ', r.totals.ad === M('2150.50'), fmt(r.totals.ad));
ok('★ 7 พ.ย. มีค่าแอดแต่ไม่มียอดขาย = ขาดทุนวันนั้น 300 ROAS 0', day('2026-11-07').net === -M('300') && day('2026-11-07').roas === 0);
ok('วันที่ไม่มีค่าแอด ROAS ว่าง (ไม่หารศูนย์)', day('2026-11-06').roas === null && day('2026-11-20').adShare === null);
const shopB = C.adsCompare('2026-11-01', '2026-11-30', ADS, ['TikTok ร้าน B']);
ok('★ เลือกเฉพาะร้าน B: ค่าแอด 1,150.50 ยอดขายไม่เปลี่ยน', shopB.totals.ad === M('1150.50') && shopB.totals.sales === r.totals.sales, fmt(shopB.totals.ad));
ok('รายชื่อร้านจากค่าแอด', JSON.stringify(C.adShops(ADS)) === JSON.stringify(['TikTok ร้าน A', 'TikTok ร้าน B']));
/* ทั้งเดือน: ขาย 950+600+1200−300 = 2,450 · ต้นทุน 300+200+400−100 = 800 · กำไรขั้นต้น 1,650 · ค่าแอด 2,150.50 · สุทธิ −500.50 */
ok('★ รวมทั้งเดือน: ขาย 2,450 ต้นทุน 800 กำไรขั้นต้น 1,650 ค่าแอด 2,150.50 กำไรหลังค่าแอด −500.50',
  r.totals.sales === M('2450') && r.totals.cost === M('800') && r.totals.gross === M('1650') && r.totals.net === -M('500.50'),
  [r.totals.sales, r.totals.cost, r.totals.gross, r.totals.ad, r.totals.net].map((x) => fmt(x)).join(' · '));
/* 3 พ.ย. กำไรขั้นต้น 400 ค่าแอด 500 · 5 พ.ย. 800 กับ 1,000 · 7 พ.ย. ไม่มียอดขาย ค่าแอด 300 */
ok('วันที่ขาดทุนหลังค่าแอด นับได้ 3 วัน (3 5 และ 7 พ.ย.)', r.totals.lossDays === 3, String(r.totals.lossDays));

console.log('\n=== 3. วิธีบันทึกสินค้าแบบสิ้นงวด ได้ตัวเลขเดียวกัน ===');
const P = freshCtx();
scenario(P, true);
const rp = P.adsCompare('2026-11-01', '2026-11-30', ADS);
ok('★ แบบสิ้นงวด (ไม่มีต้นทุนขายรายวันในบัญชี) ยอดขาย ต้นทุน กำไร รายวันเท่าแบบต่อเนื่องทุกวัน',
  JSON.stringify(rp.rows) === JSON.stringify(r.rows), [rp.totals.sales, rp.totals.cost, rp.totals.net].map((x) => fmt(x)).join(' · '));

done();
