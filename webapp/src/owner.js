/* ===================================================================
   ยอดขาย กำไร เทียบค่าแอด รายวัน — หน้าของเจ้าของ
   ยอดขาย       รายได้จากการขายและบริการในบัญชี (หมวดเดียวกับงบกำไรขาดทุน) ตามวันที่ลงบัญชี
                ใบกำกับ ขายเงินสด ใบเพิ่มหนี้ ใบลดหนี้ ส่วนลด รวมครบ · ใบที่ยกเลิกหักกลับในวันเดียวกัน
                ไม่นับยอดยกมา ยอดนำเข้าจากระบบเดิม และใบปิดบัญชีสิ้นปี
   ต้นทุนสินค้า  ต้นทุนของที่ขายตามทะเบียนสินค้า (ต้นทุนเฉลี่ย ณ วันขาย) หักของที่ลูกค้าคืน
                ได้ค่าเดียวกันทั้งวิธีบันทึกสินค้าแบบต่อเนื่องและแบบสิ้นงวด (แบบสิ้นงวดไม่มีต้นทุนขายรายวันในบัญชี)
   ค่าแอด       ยอดที่เจ้าของกรอก หรือระบบอื่นส่งเข้ามา (SellerHub) แยกตามร้าน — ไม่ได้มาจากบัญชี
   =================================================================== */
const SALES_SUBS = PL_LINES[0].sub;

/** ยอดขายและต้นทุนสินค้ารายวัน ทุกวันในช่วง (วันที่ไม่มีรายการเป็นศูนย์) */
function dailySalesProfit(from, to) {
  const out = {};
  const day = (d) => out[d] || (out[d] = { date: d, sales: 0, cost: 0 });
  for (let d = from; d <= to; d = addDays(d, 1)) day(d);
  const salesAcc = new Set(DB.accounts.filter((a) => SALES_SUBS.indexOf(a.subType) >= 0).map((a) => a.code));
  DB.entries.forEach(function (e) {
    if (!LIVE(e) || e.date < from || e.date > to || e.type === 'closing' || isOpeningEntry(e) || isImportEntry(e)) return;
    e.lines.forEach(function (l) { if (salesAcc.has(l.acc)) day(e.date).sales += (l.cr || 0) - (l.dr || 0); });
  });
  /* ต้นทุนจากทะเบียนสินค้า — นับเฉพาะเอกสารขายที่ยังไม่ยกเลิก (ใบที่ยกเลิก ของคืนเข้าคลังแล้ว) */
  const live = (d) => d.status !== 'void' && d.status !== 'draft';
  const sign = {};
  DB.docs.invoice.forEach((d) => { if (live(d)) sign[d.no] = 1; });
  (DB.docs.cashSale || []).forEach((d) => { if (live(d)) sign[d.no] = 1; });
  (DB.docs.creditNote || []).forEach((d) => { if (live(d)) sign[d.no] = -1; });
  DB.docs.stockMove.forEach(function (m) {
    if (m.date < from || m.date > to) return;
    const k = sign[m.src];
    if (k === 1 && m.dir === 'out') day(m.date).cost += m.cost;
    if (k === -1 && m.dir === 'in') day(m.date).cost -= m.cost;
  });
  return Object.keys(out).sort().map((d) => out[d]);
}

/** ร้านทั้งหมดที่มีค่าแอด เรียงตามชื่อ */
const adShops = (ads) => Array.from(new Set((ads || []).map((a) => a.shop))).sort();

/** รวมยอดขาย กำไร ค่าแอด รายวัน
    ads = [{ date, shop, amount }] (amount เป็นบาทแบบข้อความหรือตัวเลข) · shops = ร้านที่เลือก ว่าง = ทุกร้าน
    roas = ยอดขาย ÷ ค่าแอด (เท่า) · adShare = ค่าแอด ÷ ยอดขาย · ไม่มีตัวหาร = null */
function adsCompare(from, to, ads, shops) {
  const pick = shops && shops.length ? new Set(shops) : null;
  const adOf = {};
  (ads || []).forEach(function (a) {
    if (a.date < from || a.date > to || (pick && !pick.has(a.shop))) return;
    adOf[a.date] = (adOf[a.date] || 0) + M(String(a.amount));
  });
  const ratio = (a, b) => (b ? a / b : null);
  const rows = dailySalesProfit(from, to).map(function (r) {
    const ad = adOf[r.date] || 0;
    const gross = r.sales - r.cost;
    return { date: r.date, sales: r.sales, cost: r.cost, gross, ad, net: gross - ad,
      roas: ratio(r.sales, ad), adShare: ratio(ad, r.sales) };
  });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  const t = { sales: sum('sales'), cost: sum('cost'), gross: sum('gross'), ad: sum('ad'), net: sum('net') };
  t.roas = ratio(t.sales, t.ad);
  t.adShare = ratio(t.ad, t.sales);
  t.margin = ratio(t.gross, t.sales);
  /* วันที่ขาดทุนหลังหักค่าแอด — มีค่าแอดแต่กำไรขั้นต้นไม่พอจ่าย */
  t.lossDays = rows.filter((r) => r.ad > 0 && r.net < 0).length;
  return { from, to, rows, totals: t };
}
