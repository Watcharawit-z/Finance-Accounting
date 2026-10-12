/* ทดสอบระบบทรัพย์สินถาวร ค่าเสื่อมย้อนหลัง การขาย/ตัดจำหน่าย โครงการ และงบประมาณ — รันด้วย node webapp/test-assets.js
   ทุกชุดเริ่มจากบริษัทเปล่า (บริษัทจริงที่ไม่ใช่ข้อมูลตัวอย่าง) แล้วตรวจว่าบัญชีสมดุลและยอดคุมผ่านทุกครั้ง */
const { ctx, ok, throws, done } = require('./testlib');
const { M, fmt, DB } = ctx;

const recOk = (asOf) => {
  const r = ctx.reconciliationChecks(asOf || '2026-12-31');
  return r.allPassed ? '' : r.checks.filter((c) => !c.ok).map((c) => c.label + ' ต่าง ' + fmt(c.control - c.sub)).join(' · ');
};
const tbOk = () => ctx.trialBalance('2026-01-01', '2026-12-31').balanced;
const bal = (code, to, from) => ctx.balanceOf(code, to || '2026-12-31', from);
function blank(extra) {
  ctx.buildBlank(Object.assign({ name: 'บริษัท ทดสอบทรัพย์สิน จำกัด', year: 2026 }, extra || {}));
  const cus = ctx.savePartner({ kind: 'customer', name: 'บริษัท ผู้ซื้อ จำกัด', taxId: '0105548021442',
    address: '1 ถนนสุขุมวิท กรุงเทพมหานคร 10110', branch: '00000' }).partner;
  const ven = ctx.savePartner({ kind: 'vendor', name: 'บริษัท ผู้ขายรถ จำกัด', taxId: '0105533001823',
    address: '9 ถนนบางนา กรุงเทพมหานคร 10260', branch: '00000' }).partner;
  return { cus, ven };
}
/** ซื้อทรัพย์สินผ่านตั้งหนี้เข้าบัญชีทรัพย์สิน แล้วลงทะเบียนจากบรรทัดนั้น (เส้นทางปกติของบริษัทจริง) */
function buy(ven, date, price, cls, years, acc, name) {
  const b = ctx.recordBill({ partnerCode: ven.code, date, vendorNo: 'INV-' + date + '-' + price,
    lines: [{ desc: name || 'ทรัพย์สิน ' + cls, qty: 1, price, acc: acc || '1302' }] });
  const r = ctx.registerAssetFromDoc({ kind: 'bill', no: b.no, line: 0, class: cls, bookYears: years });
  return { bill: b, asset: r.asset };
}

console.log('\n=== 1. ค่าเสื่อมย้อนหลังทุกเดือนที่ยังไม่ได้คิด ===');
{
  blank();
  const a = ctx.saveAsset({ name: 'คอมพิวเตอร์ชุดบัญชี', class: 'COMPUTER', inService: '2026-01-15', cost: '36000', bookYears: 3 }).asset;
  ok('ลงทะเบียนแล้วยังไม่คิดค่าเสื่อม', a.accumBook === 0 && ctx.assetDepThrough(a) === null);
  const r3 = ctx.runDepreciation('2026-03');
  const row = r3.rows.find((x) => x.code === a.code);
  ok('★ เริ่มใช้มกราคม ตั้งค่าเสื่อมครั้งแรกเดือนมีนาคม ได้ครบ 3 เดือน ไม่ใช่เดือนเดียว',
    row.months === 3 && row.from === '2026-01' && row.book === M('3000'), row.months + ' เดือน ' + fmt(row.book));
  ok('ค่าเสื่อมทางภาษีคิดจำนวนเดือนเดียวกัน (33.33% × 3/12)', row.tax === 3 * ctx.divRound(ctx.pct(M('36000'), '33.33'), 12), fmt(row.tax));
  ok('ใบสำคัญบอกว่ารวมเดือนที่ยังไม่ได้คิด', /รวมเดือนที่ยังไม่ได้คิด/.test(DB.entries.find((e) => e.no === r3.entryNo).desc));
  const r4 = ctx.runDepreciation('2026-04');
  ok('งวดถัดไปคิดต่อเดือนเดียว', r4.rows[0].months === 1 && r4.rows[0].book === M('1000'));
  ok('★ คิดถึงเมษายนแล้ว ไม่ต้องคิดซ้ำในเมษายน (depreciableAssets ว่าง)', ctx.depreciableAssets('2026-04').length === 0);
  ok('งวดถัดไปยังต้องคิด', ctx.depreciableAssets('2026-05').length === 1);
  const r6 = ctx.runDepreciation('2026-06');
  ok('★ ข้ามพฤษภาคมไป ตั้งค่าเสื่อมมิถุนายนได้ 2 เดือน (พ.ค.–มิ.ย.)', r6.rows[0].months === 2 && r6.rows[0].from === '2026-05'
    && r6.rows[0].book === M('2000'));
  ok('ค่าเสื่อมสะสมในทะเบียน = บัญชีค่าเสื่อมสะสม = 6 เดือน', a.accumBook === M('6000') && -bal('1310') === M('6000'));
  const chk = ctx.closeChecklist('2026-05').items.find((i) => i.action === 'depreciation');
  ok('ปิดงวดพฤษภาคมได้ เพราะค่าเสื่อมของเดือนนั้นอยู่ในงวดมิถุนายนแล้ว', chk.ok, chk.detail);
  ctx.voidRun('depreciation', '2026-06', 'ทดสอบยกเลิกงวดที่รวมหลายเดือน');
  ok('★ ยกเลิกงวดที่รวม 2 เดือน ค่าเสื่อมสะสมกลับเป็น 4 เดือน และคิดถึงเมษายน', a.accumBook === M('4000') && ctx.assetDepThrough(a) === '2026-04');
  const r6b = ctx.runDepreciation('2026-06');
  ok('ตั้งใหม่ได้ 2 เดือนเท่าเดิม', r6b.rows[0].months === 2 && r6b.bookTotal === M('2000'));
  ok('งบทดลองสมดุล', tbOk());
  ok('ยอดคุมผ่านทุกข้อ', recOk('2026-06-30') === '', recOk('2026-06-30'));

  const old = ctx.saveAsset({ name: 'เครื่องพิมพ์ใช้มาก่อนเริ่มระบบ', class: 'OFFICE', inService: '2025-06-01', cost: '12000', bookYears: 5 }).asset;
  ok('★ ใช้มาก่อนเริ่มสมุดบัญชีแต่ไม่มีค่าเสื่อมสะสมยกมา ระบบเตือน', ctx.assetMissingOpeningAccum(old));
  const p7 = ctx.depreciationPlan('2026-07').find((x) => x.code === old.code);
  ok('★ ไม่ลงค่าเสื่อมของปีก่อนเป็นค่าใช้จ่ายปีนี้ — เริ่มคิดตั้งแต่งวดแรกของสมุดบัญชี', p7.from === '2026-01' && p7.months === 7, p7.from + ' · ' + p7.months + ' เดือน');
}

console.log('\n=== 2. ลงทะเบียนยอดยกมา (ไม่ลงบัญชี) ===');
{
  blank();
  const n0 = DB.entries.length;
  const sug = ctx.suggestOpeningAccum({ class: 'VEHICLE', cost: '600000', bookYears: 5, inService: '2024-07-01', asOf: '2025-12-31' });
  ok('คำนวณค่าเสื่อมสะสมให้ตามนโยบายเดียวกัน (ก.ค. 67 – ธ.ค. 68 = 18 เดือน)', sug.months === 18 && sug.book === M('180000'), fmt(sug.book));
  const a = ctx.registerOpeningAsset({ name: 'รถกระบะ', class: 'VEHICLE', inService: '2024-07-01', cost: '600000', bookYears: 5,
    accumBook: '180000', accumTax: '180000', asOf: '2025-12-31' }).asset;
  ok('★ ลงทะเบียนยอดยกมาไม่สร้างใบสำคัญ', DB.entries.length === n0 && a.opening && a.depThrough === '2025-12');
  const r = ctx.runDepreciation('2026-01');
  ok('คิดค่าเสื่อมต่อจากเดือนถัดจากวันยกยอด เดือนเดียว', r.rows[0].months === 1 && r.rows[0].book === M('10000'));
  throws('ยอด ณ วันที่ต้องไม่ก่อนวันเริ่มใช้', () => ctx.registerOpeningAsset({ name: 'x', class: 'OFFICE', inService: '2026-03-01',
    cost: '1000', bookYears: 5, asOf: '2025-12-31' }), 'ASSET_ASOF_BEFORE_SERVICE');
  throws('ต้องระบุวันที่ยกยอด', () => ctx.registerOpeningAsset({ name: 'x', class: 'OFFICE', inService: '2025-03-01',
    cost: '1000', bookYears: 5 }), 'ASSET_ASOF_REQUIRED');
  const cmp = ctx.assetRegisterVsGl('2026-01-31');
  const c1302 = cmp.rows.find((x) => x.acc === '1302');
  ok('★ ทะเบียนมีแต่บัญชียังไม่มี ระบบชี้ผลต่างพร้อมเหตุผล', c1302 && c1302.diff === -M('600000') && /ไม่ได้บันทึกบัญชี/.test(c1302.why), c1302 && c1302.why);
}

console.log('\n=== 3. ลงทะเบียนจากรายการตั้งหนี้ และเทียบทะเบียนกับบัญชี ===');
let S = null;
{
  const { cus, ven } = blank();
  const b = ctx.recordBill({ partnerCode: ven.code, date: '2026-01-10', vendorNo: 'TRK-001',
    lines: [{ desc: 'รถบรรทุก 6 ล้อ', qty: 1, price: '120000', acc: '1302' }, { desc: 'ค่าจดทะเบียน', qty: 1, price: '1500', expenseSub: 'admin_expense' }] });
  const lines = ctx.ppeSourceLines();
  ok('ระบบหาบรรทัดตั้งหนี้ที่ลงบัญชีทรัพย์สินเจอ (เฉพาะบรรทัดทรัพย์สิน)', lines.length === 1 && lines[0].amount === M('120000') && !lines[0].assetCode);
  let cmp = ctx.assetRegisterVsGl('2026-01-31').rows.find((x) => x.acc === '1302');
  ok('★ ซื้อแล้วยังไม่ลงทะเบียน: บัญชีมากกว่าทะเบียน 120,000 พร้อมบอกว่ามาจากรายการซื้อที่ยังไม่ลงทะเบียน',
    cmp.diff === M('120000') && cmp.pending === M('120000') && /ยังไม่ลงทะเบียน 1 รายการ/.test(cmp.why), cmp.why);
  const a = ctx.registerAssetFromDoc({ kind: 'bill', no: b.no, line: 0, class: 'VEHICLE', bookYears: 5 }).asset;
  ok('★ ราคาทุน บัญชี และวันที่มาจากเอกสาร', a.cost === M('120000') && a.account === '1302' && a.inService === '2026-01-10'
    && a.source.no === b.no && a.name === 'รถบรรทุก 6 ล้อ');
  throws('ลงทะเบียนบรรทัดเดิมซ้ำไม่ได้', () => ctx.registerAssetFromDoc({ kind: 'bill', no: b.no, line: 0, class: 'VEHICLE', bookYears: 5 }), 'SOURCE_ALREADY_REGISTERED');
  cmp = ctx.assetRegisterVsGl('2026-01-31');
  ok('★ ลงทะเบียนแล้ว ทะเบียนตรงกับบัญชีทุกบรรทัด', cmp.ok && cmp.rows.find((x) => x.acc === '1302').diff === 0);
  ['2026-01', '2026-02', '2026-03'].forEach((p) => ctx.runDepreciation(p));
  cmp = ctx.assetRegisterVsGl('2026-03-31');
  ok('ค่าเสื่อมสะสมในทะเบียนตรงกับบัญชีหลังตั้งค่าเสื่อม 3 งวด', cmp.ok && cmp.rows.find((x) => x.acc === '1310').register === M('6000'));
  ok('เทียบย้อนหลัง ณ สิ้นกุมภาพันธ์ก็ยังตรง (หักค่าเสื่อมงวดหลังออก)', ctx.assetRegisterVsGl('2026-02-28').ok);
  throws('ที่ดินต้องอยู่บัญชีที่ดิน', () => ctx.saveAsset({ name: 'ที่ดิน', class: 'LAND', inService: '2026-01-01', cost: '1000', account: '1302' }), 'ASSET_ACCOUNT_CLASS');
  throws('บัญชีที่ไม่ใช่ทรัพย์สินใช้ไม่ได้', () => ctx.saveAsset({ name: 'x', class: 'OFFICE', inService: '2026-01-01', cost: '1000', bookYears: 5, account: '5341' }), 'ASSET_ACCOUNT_INVALID');
  throws('★ เปลี่ยนสถานะเป็นจำหน่ายเฉย ๆ ไม่ได้ ต้องผ่านเอกสาร', () => ctx.saveAsset({ code: a.code, name: a.name, class: a.class,
    inService: a.inService, cost: ctx.unM(a.cost), bookYears: 5, status: 'disposed' }), 'ASSET_DISPOSE_USE_DOC');
  throws('★ แก้ค่าเสื่อมสะสมของทรัพย์สินที่คิดค่าเสื่อมแล้วไม่ได้', () => ctx.saveAsset({ code: a.code, name: a.name, class: a.class,
    inService: a.inService, cost: ctx.unM(a.cost), bookYears: 5, accumBook: '0' }), 'ASSET_ALREADY_DEPRECIATED');
  ok('แก้ชื่อโดยไม่ส่งค่าเสื่อมสะสม ค่าเสื่อมสะสมไม่หาย', ctx.saveAsset({ code: a.code, name: 'รถบรรทุก 6 ล้อ ทะเบียน 70-1234', class: a.class,
    inService: a.inService, cost: ctx.unM(a.cost), bookYears: 5 }).asset.accumBook === M('6000'));
  S = { cus, ven, a, b };
}

console.log('\n=== 4. ขายทรัพย์สินรับเงินทันที มีภาษีขาย ขาดทุน ===');
{
  const { cus, a } = S;
  const pv = ctx.disposalPreview({ assetCode: a.code, kind: 'sale', date: '2026-05-20', proceeds: '100000', partnerCode: cus.code });
  ok('★ ตัวอย่างก่อนบันทึก: คิดค่าเสื่อมเพิ่ม เม.ย.–พ.ค. 2 เดือน', pv.dep.months === 2 && pv.dep.book === M('4000') && pv.dep.from === '2026-04');
  ok('ราคาตามบัญชี ณ วันขาย 110,000 · ขาดทุน 10,000 · ภาษีขาย 7,000', pv.nbv === M('110000') && pv.gain === -M('10000') && pv.vat === M('7000'));
  const n0 = DB.entries.length;
  const d = ctx.disposeAsset({ assetCode: a.code, kind: 'sale', date: '2026-05-20', proceeds: '100000', partnerCode: cus.code, payTo: '1113' });
  ok('ได้เลขที่เอกสารขายทรัพย์สิน', /^FAS2605-\d{5}$/.test(d.no), d.no);
  const dep = DB.entries.find((e) => e.no === d.depEntryNo);
  const je = DB.entries.find((e) => e.no === d.entryNo);
  ok('สร้างใบสำคัญ 2 ใบ: ค่าเสื่อมถึงเดือนที่ขาย และการขาย', DB.entries.length === n0 + 2 && dep && je);
  const line = (e, code) => e.lines.filter((l) => l.acc === code).reduce((s, l) => s + l.dr - l.cr, 0);
  ok('ใบค่าเสื่อม: Dr ค่าเสื่อมราคา 4,000 / Cr ค่าเสื่อมสะสม 4,000', line(dep, '5341') === M('4000') && line(dep, '1310') === -M('4000'));
  ok('★ ใบขาย: Dr ค่าเสื่อมสะสม 10,000 · Dr ธนาคาร 107,000 · Dr ขาดทุน 10,000 / Cr ราคาทุน 120,000 · Cr ภาษีขาย 7,000',
    line(je, '1310') === M('10000') && line(je, '1113') === M('107000') && line(je, '5353') === M('10000')
    && line(je, '1302') === -M('120000') && line(je, '2141') === -M('7000'),
    je.lines.map((l) => l.acc + ' ' + fmt(l.dr - l.cr)).join(' · '));
  ok('ใบขายลงสมุดรายวันรับ (มีเงินเข้า)', je.type === 'receipt');
  const vt = DB.taxTx.find((t) => t.docNo === d.no);
  ok('★ ภาษีขายเข้ารายงานภาษีขายงวด พ.ค. พร้อมชื่อและเลขผู้ซื้อ', vt && vt.kind === 'vat_output' && vt.period === '2026-05'
    && vt.base === M('100000') && vt.tax === M('7000') && vt.taxId === cus.taxId && vt.docType === 'tax_invoice');
  ok('ทะเบียน: จำหน่ายแล้ว อ้างเอกสาร ค่าเสื่อมสะสม 10,000', a.status === 'disposed' && a.disposalNo === d.no && a.accumBook === M('10000'));
  ok('★ บัญชีราคาทุนและค่าเสื่อมสะสมของทรัพย์สินเป็นศูนย์', bal('1302') === 0 && bal('1310') === 0);
  ok('★ ยอดคุมผ่านทุกข้อ รวมภาษีขายในทะเบียน = ภาษีขายในบัญชี', recOk('2026-05-31') === '', recOk('2026-05-31'));
  ok('งบทดลองสมดุล', tbOk());
  ok('งบแสดงฐานะการเงินสมดุล', ctx.balanceSheet('2026-05-31').diff === 0);
  const cf = ctx.cashFlow('2026-05-01', '2026-05-31');
  ok('งบกระแสเงินสด: เงินจากการขายทรัพย์สินอยู่ในกิจกรรมลงทุน', cf.investing === M('107000') && cf.unexplained === 0, fmt(cf.investing));
  ok('ทะเบียนตรงกับบัญชีหลังขาย', ctx.assetRegisterVsGl('2026-05-31').ok);
  ok('ทรัพย์สินที่จำหน่ายแล้วไม่ถูกคิดค่าเสื่อมอีก', ctx.depreciableAssets('2026-06').every((x) => x.code !== a.code));
  throws('ขายซ้ำไม่ได้', () => ctx.disposeAsset({ assetCode: a.code, kind: 'sale', date: '2026-05-25', proceeds: '1', payTo: '1113' }), 'ASSET_NOT_IN_USE');
  throws('★ แก้ราคาทุนของทรัพย์สินที่จำหน่ายแล้วไม่ได้', () => ctx.saveAsset({ code: a.code, name: a.name, class: a.class,
    inService: a.inService, cost: '1', bookYears: 5 }), 'ASSET_ALREADY_DEPRECIATED');

  // ยกเลิก
  const pvv = ctx.disposalVoidPreview(d.no);
  ok('บอกสิ่งที่จะเกิดก่อนยกเลิก', pvv.length >= 3, pvv.join(' / '));
  throws('ยกเลิกต้องมีเหตุผล', () => ctx.voidAssetDisposal(d.no, 'สั้น'), 'REASON_REQUIRED');
  ctx.voidAssetDisposal(d.no, 'ผู้ซื้อยกเลิกการซื้อ ทดสอบ');
  ok('★ ยกเลิกแล้ว ทรัพย์สินกลับมาใช้งาน ค่าเสื่อมสะสมกลับเป็น 6,000', a.status === 'in_use' && !a.disposalNo && a.accumBook === M('6000'));
  ok('ใบสำคัญทั้งสองถูกกลับรายการ', ['entryNo', 'depEntryNo'].every((k) => DB.entries.find((e) => e.no === d[k]).status === 'reversed'));
  ok('★ ภาษีขายในรายงานเป็น "ยกเลิก" ยอดศูนย์', vt.void && vt.tax === 0 && vt.base === 0);
  ok('บัญชีกลับเหมือนก่อนขาย', bal('1302') === M('120000') && -bal('1310') === M('6000') && bal('5353') === 0);
  ok('ยอดคุมผ่านหลังยกเลิก', recOk('2026-05-31') === '', recOk('2026-05-31'));
  ok('ค่าเสื่อมคิดต่อได้ตั้งแต่เมษายน', ctx.assetDepThrough(a) === '2026-03');
  throws('ยกเลิกซ้ำไม่ได้', () => ctx.voidAssetDisposal(d.no, 'ยกเลิกซ้ำทดสอบ'), 'ALREADY_VOID');
}

console.log('\n=== 5. ขายได้กำไร · ตัดจำหน่าย · ขายเงินเชื่อ ===');
{
  const { cus, ven, a } = S;
  const g = ctx.disposeAsset({ assetCode: a.code, kind: 'sale', date: '2026-04-30', proceeds: '130000', partnerCode: cus.code, payTo: '1111' });
  const je = DB.entries.find((e) => e.no === g.entryNo);
  ok('★ ขายสูงกว่าราคาตามบัญชี: กำไรเข้าบัญชีกำไรจากการจำหน่ายสินทรัพย์ 4240',
    g.gain === M('130000') - (M('120000') - M('8000')) && je.lines.some((l) => l.acc === '4240' && l.cr === g.gain), fmt(g.gain));
  ok('ยอดคุมผ่าน', recOk('2026-04-30') === '', recOk('2026-04-30'));
  ctx.voidAssetDisposal(g.no, 'ทดสอบกรณีกำไร เสร็จแล้วยกเลิก');

  const pc = buy(ven, '2026-02-01', '24000', 'COMPUTER', 3, '1302', 'โน้ตบุ๊ก').asset;
  const w = ctx.disposeAsset({ assetCode: pc.code, kind: 'writeoff', date: '2026-04-10', note: 'ตกแตกเสียหาย ซ่อมไม่ได้' });
  const wj = DB.entries.find((e) => e.no === w.entryNo);
  ok('★ ตัดจำหน่ายไม่มีเงินรับ: ขาดทุนเท่าราคาตามบัญชี ไม่มีภาษีขาย', w.proceeds === 0 && w.vat === 0 && w.gain === -w.nbv
    && !DB.taxTx.some((t) => t.docNo === w.no) && /^FAW/.test(w.no) && wj.type === 'asset');
  ok('ตัดจำหน่ายคิดค่าเสื่อม ก.พ.–เม.ย. 3 เดือนก่อน', w.dep.months === 3 && w.dep.from === '2026-02'
    && w.accumBook === 3 * ctx.divRound(ctx.divRound(M('24000'), 3), 12), fmt(w.accumBook));

  const tr = buy(ven, '2026-03-01', '60000', 'MACHINERY', 5, '1302', 'เครื่องตัด').asset;
  throws('ขายเชื่อต้องเลือกผู้ซื้อในทะเบียน', () => ctx.disposeAsset({ assetCode: tr.code, kind: 'sale', settle: 'credit', date: '2026-04-15', proceeds: '50000',
    buyerName: 'คุณเอ', buyerAddress: 'กรุงเทพ' }), 'DISPOSAL_CREDIT_NEEDS_PARTNER');
  throws('★ ขายมีภาษีขายต้องมีที่อยู่ผู้ซื้อ (ม.86/4)', () => ctx.disposeAsset({ assetCode: tr.code, kind: 'sale', date: '2026-04-15',
    proceeds: '50000', buyerName: 'คุณเอ', payTo: '1111' }), 'TAX_INVOICE_INCOMPLETE');
  throws('ขายต้องมีราคาขาย', () => ctx.disposeAsset({ assetCode: tr.code, kind: 'sale', date: '2026-04-15', proceeds: '0', partnerCode: cus.code }), 'DISPOSAL_PROCEEDS_REQUIRED');
  const cr = ctx.disposeAsset({ assetCode: tr.code, kind: 'sale', settle: 'credit', date: '2026-04-15', proceeds: '50000', partnerCode: cus.code });
  const recv = cr.recvAccount;
  ok('★ ขายเชื่อ: ตั้งลูกหนี้จากการขายทรัพย์สิน (แยกจากลูกหนี้การค้า) ระบุผู้ซื้อ', recv && ctx.acc(recv).subType === 'other_receivable'
    && DB.entries.find((e) => e.no === cr.entryNo).lines.some((l) => l.acc === recv && l.dr === M('53500') && l.partner === cus.code), recv);
  ok('ใบขายเชื่อลงสมุดรายวันขาย', DB.entries.find((e) => e.no === cr.entryNo).type === 'sales');
  ok('★ ลูกหนี้การค้ายังตรงกับใบกำกับรายใบ (ยอดคุมผ่าน)', recOk('2026-04-30') === '', recOk('2026-04-30'));
  ok('ยอดค้างรับ 53,500', ctx.assetSaleOutstanding(cr) === M('53500'));
  const c1 = ctx.collectAssetSale(cr.no, { date: '2026-04-20', amount: '20000', payTo: '1113' });
  ok('รับชำระบางส่วน ยอดค้างลดลง', ctx.assetSaleOutstanding(cr) === M('33500') && /^FAR/.test(c1.no));
  throws('รับเกินยอดค้างไม่ได้', () => ctx.collectAssetSale(cr.no, { date: '2026-04-21', amount: '40000' }), 'COLLECT_EXCEEDS');
  throws('★ ยกเลิกเอกสารขายที่รับเงินแล้วไม่ได้ ต้องยกเลิกการรับเงินก่อน', () => ctx.voidAssetDisposal(cr.no, 'ทดสอบยกเลิกขาย'), 'VOID_HAS_DEPENDENTS');
  ctx.collectAssetSale(cr.no, { date: '2026-04-22', payTo: '1113' });
  ok('★ รับครบแล้ว ลูกหนี้จากการขายทรัพย์สินเป็นศูนย์', ctx.assetSaleOutstanding(cr) === 0 && bal(recv) === 0);
  throws('รับครบแล้วรับอีกไม่ได้', () => ctx.collectAssetSale(cr.no, { date: '2026-04-23' }), 'NOTHING_DUE');
  ctx.voidAssetCollection(cr.no, c1.no, 'โอนเงินคืน ทดสอบ');
  ok('ยกเลิกการรับเงินครั้งแรก ยอดค้างกลับมา 20,000', ctx.assetSaleOutstanding(cr) === M('20000') && bal(recv) === M('20000'));
  ok('ยอดคุมผ่าน · งบทดลองสมดุล', recOk('2026-04-30') === '' && tbOk(), recOk('2026-04-30'));

  // ภาษีขายของเดือนที่ยื่นแล้ว
  const vv = buy(ven, '2026-03-05', '30000', 'OFFICE', 5, '1302', 'แอร์').asset;
  const sv = ctx.disposeAsset({ assetCode: vv.code, kind: 'sale', date: '2026-03-20', proceeds: '10000', partnerCode: cus.code, payTo: '1113' });
  /* ซื้อก่อนยื่นแบบ — หลังยื่นแล้วลงเอกสารที่มีภาษีซื้อในเดือนนั้นไม่ได้ · ภ.พ.30 ยื่นเรียงเดือน */
  const late = buy(ven, '2026-03-06', '8000', 'OFFICE', 5, '1302', 'พัดลม').asset;
  ctx.fileVat('2026-01'); ctx.fileVat('2026-02');
  ctx.fileVat('2026-03');
  throws('★ ยกเลิกการขายในเดือนที่ยื่น ภ.พ.30 แล้วไม่ได้', () => ctx.voidAssetDisposal(sv.no, 'ทดสอบยื่นภาษีแล้ว'), 'TAX_ALREADY_FILED');
  throws('★ ขายทรัพย์สินที่มีภาษีขายลงวันที่ในเดือนที่ยื่น ภ.พ.30 แล้วไม่ได้', () => ctx.disposeAsset({ assetCode: late.code, kind: 'sale',
    date: '2026-03-25', proceeds: '1000', partnerCode: cus.code, payTo: '1113' }), 'VAT_PERIOD_FILED');
  ok('ตัดจำหน่าย (ไม่มีภาษีขาย) ในเดือนนั้นยังทำได้', !!ctx.disposeAsset({ assetCode: late.code, kind: 'writeoff', date: '2026-03-25' }).no);
  ok('★ ยื่น ภ.พ.30 รวมภาษีขายจากการขายทรัพย์สิน', DB.docs.filing.find((f) => f.form === 'PP30' && f.period === '2026-03').outTax === sv.vat,
    fmt(sv.vat));
}

console.log('\n=== 6. กรณีพิเศษของการจำหน่าย ===');
{
  const { cus, ven } = blank();
  const m = buy(ven, '2026-01-05', '50000', 'MACHINERY', 5).asset;
  ctx.runDepreciation('2026-01'); ctx.runDepreciation('2026-02'); ctx.runDepreciation('2026-03');
  throws('★ วันที่ขายก่อนงวดที่คิดค่าเสื่อมไปแล้ว ต้องยกเลิกงวดหลังก่อน', () => ctx.disposeAsset({ assetCode: m.code, kind: 'writeoff', date: '2026-02-15' }),
    'ASSET_DEPRECIATED_PAST_DISPOSAL');
  const same = ctx.disposalPreview({ assetCode: m.code, kind: 'writeoff', date: '2026-03-15' });
  ok('ขายในงวดที่คิดค่าเสื่อมแล้ว ไม่คิดซ้ำ', same.dep.months === 0 && same.dep.book === 0);
  throws('ขายก่อนวันเริ่มใช้ไม่ได้', () => ctx.disposalPreview({ assetCode: m.code, kind: 'writeoff', date: '2025-12-01' }), 'DISPOSAL_BEFORE_IN_SERVICE');
  DB.periods.find((p) => p.code === '2026-04').status = 'closed';
  const e0 = DB.entries.length, s0 = JSON.stringify(m);
  throws('ขายในงวดที่ปิด', () => ctx.disposeAsset({ assetCode: m.code, kind: 'writeoff', date: '2026-04-10' }), 'PERIOD_CLOSED');
  ok('★ ขายไม่สำเร็จแล้วทะเบียนและบัญชีไม่ขยับเลย', DB.entries.length === e0 && JSON.stringify(m) === s0 && !DB.docs.assetDisposal.length);
  DB.periods.find((p) => p.code === '2026-04').status = 'open';

  const land = ctx.saveAsset({ name: 'ที่ดินโกดัง', class: 'LAND', inService: '2026-01-01', cost: '500000', account: '1301' }).asset;
  ctx.post({ type: 'general', date: '2026-01-01', desc: 'ซื้อที่ดิน', src: 'manual', lines: [{ acc: '1301', dr: M('500000') }, { acc: '1113', cr: M('500000') }] });
  const lp = ctx.disposalPreview({ assetCode: land.code, kind: 'sale', date: '2026-05-01', proceeds: '650000', buyerName: 'นายบี' , payTo: '1113' });
  ok('★ ขายที่ดินไม่มีภาษีมูลค่าเพิ่ม (อสังหาริมทรัพย์) กำไร 150,000', lp.vatCode === 'NONE' && lp.vat === 0 && lp.gain === M('150000'));
  const ld = ctx.disposeAsset({ assetCode: land.code, kind: 'sale', date: '2026-05-01', proceeds: '650000', buyerName: 'นายบี', payTo: '1113' });
  ok('ไม่มีแถวภาษีขาย · ที่ดินออกจากบัญชี', !DB.taxTx.some((t) => t.docNo === ld.no) && bal('1301') === 0);
  ok('ยอดคุมผ่าน', recOk('2026-05-31') === '', recOk('2026-05-31'));

  DB.company.vatRegistered = false;
  const m2 = buy(ven, '2026-02-01', '10000', 'OFFICE', 5).asset;
  const nv = ctx.disposalPreview({ assetCode: m2.code, kind: 'sale', date: '2026-05-01', proceeds: '5000', buyerName: 'x', payTo: '1111' });
  ok('กิจการที่ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม ขายทรัพย์สินไม่มีภาษีขาย', nv.vat === 0 && nv.vatCode === 'NONE');
  DB.company.vatRegistered = true;

  // ทะเบียนรุ่นก่อนที่ตั้ง "จำหน่ายแล้ว" เองโดยไม่ลงบัญชี
  const lg = buy(ven, '2026-01-20', '40000', 'FURNITURE', 5).asset;
  lg.status = 'disposed';
  const cmp = ctx.assetRegisterVsGl('2026-05-31').rows.find((x) => x.acc === '1302');
  ok('★ ทรัพย์สินที่ตั้งสถานะจำหน่ายเองโดยไม่ลงบัญชี ระบบชี้ว่าราคาทุนยังค้างในบัญชี', cmp.legacy === M('40000') && /ไม่ได้ลงบัญชี/.test(cmp.why), cmp.why);
  const ld2 = ctx.disposeAsset({ assetCode: lg.code, kind: 'writeoff', date: '2026-05-10' });
  ok('บันทึกการจำหน่ายย้อนตามจริงได้ ราคาทุนออกจากบัญชี', lg.disposalNo === ld2.no && ld2.dep.months === 0);
  ctx.voidAssetDisposal(ld2.no, 'ทดสอบคืนสถานะเดิม');
  ok('ยกเลิกแล้วกลับเป็นสถานะเดิม (จำหน่ายแบบรุ่นก่อน)', lg.status === 'disposed' && !lg.disposalNo);

  // สินทรัพย์ไม่มีตัวตน
  const sw = buy(ven, '2026-01-01', '36000', 'COMPUTER', 3, '1401', 'โปรแกรมบัญชี').asset;
  const plan = ctx.depreciationPlan('2026-01').find((r) => r.code === sw.code);
  ok('★ โปรแกรมคอมพิวเตอร์ (บัญชีสินทรัพย์ไม่มีตัวตน) ตัดจำหน่ายเข้าค่าตัดจำหน่าย 5342/1409', plan.expAcc === '5342' && plan.accumAcc === '1409');
  ok('ยอดคุมผ่านทั้งชุด · งบทดลองสมดุล', recOk() === '' && tbOk(), recOk());
}

console.log('\n=== 7. ข้อมูลตัวอย่างเดิมยังได้ค่าเสื่อมเท่าเดิม ===');
{
  ctx.buildSeed();
  const plan = ctx.depreciationPlan('2026-07');
  ok('★ ข้อมูลตัวอย่าง (ค่าเสื่อมถึงมิถุนายนแล้ว) งวดกรกฎาคมคิดเดือนเดียวทุกตัว', plan.length > 0 && plan.every((r) => r.months === 1), plan.length + ' รายการ');
  const expected = DB.assets.filter((a) => a.status === 'in_use' && a.class !== 'LAND')
    .reduce((s, a) => s + Math.min(ctx.divRound(ctx.divRound(a.cost, a.bookYears), 12), a.cost - a.accumBook), 0);
  ok('ยอดรวมเท่าสูตรเดิม (ราคาทุน ÷ อายุ ÷ 12)', plan.reduce((s, r) => s + r.book, 0) === expected, fmt(expected));
  ok('งบประมาณรุ่นก่อน (เท่ากันทุกเดือน) อ่านได้', ctx.budgetAmount('5311', '2026-03') === M('520000'));
  ctx.saveBudget({ account: '5311', period: '2026-07', months: ctx.budgetSpread(M('6000000')).map(ctx.unM) });
  ok('★ งบรุ่นก่อนของบัญชีที่แก้ แปลงเป็นรายเดือนแล้วไม่ค้างซ้อน', !DB.budget.some((b) => b.account === '5311' && !b.period)
    && ctx.budgetAmount('5311', '2026-07') === M('500000'));
  ok('บัญชีอื่นของงบรุ่นก่อนยังอ่านได้เหมือนเดิม', ctx.budgetAmount('5341', '2026-07') === M('240000'));
  const bva = ctx.budgetVsActual('2026-07');
  ok('งบเทียบใช้จริงของข้อมูลตัวอย่างคำนวณได้', bva.rows.length > 5 && bva.rows.some((r) => r.account === '5341' && r.budgeted));
  const dr = ctx.runDepreciation('2026-07');
  ok('ตั้งค่าเสื่อมกรกฎาคมของข้อมูลตัวอย่างได้ ยอดคุมผ่าน', dr.bookTotal === expected && recOk('2026-07-31') === '', recOk('2026-07-31'));
  const cmp = ctx.assetRegisterVsGl('2026-07-31');
  const land = cmp.rows.find((r) => r.acc === '1301');
  ok('★ ข้อมูลตัวอย่าง: ที่ดินในบัญชียังไม่มีในทะเบียน ระบบชี้ผลต่างพร้อมเหตุผล', land && land.diff === M('3200000') && /ยอดยกมา/.test(land.why), land && land.why);
  ok('ทะเบียนอาคารและอุปกรณ์ตรงกับบัญชี', cmp.rows.filter((r) => r.acc === '1302' || r.acc === '1310').every((r) => r.diff === 0),
    cmp.rows.map((r) => r.acc + ' ' + fmt(r.diff)).join(' · '));
}

console.log('\n=== 8. โครงการ ===');
{
  const { cus, ven } = blank();
  const p = ctx.saveProject({ newCode: 'PJ-001', name: 'ติดตั้งระบบไฟฟ้าโรงงาน', customer: cus.code, contract: '500000', budget: '300000',
    start: '2026-02-01', end: '2026-08-31' }).project;
  ok('สร้างโครงการได้', p.code === 'PJ-001' && p.status === 'active' && p.budget === M('300000'));
  throws('รหัสโครงการซ้ำไม่ได้', () => ctx.saveProject({ newCode: 'PJ-001', name: 'ซ้ำ' }), 'PROJECT_CODE_DUPLICATE');
  throws('วันสิ้นสุดก่อนวันเริ่ม', () => ctx.saveProject({ name: 'x', start: '2026-05-01', end: '2026-04-01' }), 'PROJECT_DATES');
  throws('ลูกค้าต้องอยู่ในทะเบียนลูกค้า', () => ctx.saveProject({ name: 'x', customer: ven.code }), 'PARTNER_WRONG_SIDE');
  const auto = ctx.saveProject({ name: 'บำรุงรักษา' }).project;
  ok('ไม่ใส่รหัส ระบบตั้งให้', /^PJ-\d{4}$/.test(auto.code), auto.code);
  ctx.saveProject({ code: 'PJ-001', name: 'ติดตั้งระบบไฟฟ้าโรงงาน (เฟส 1)', customer: cus.code, contract: '500000', budget: '320000' });
  ok('แก้ไขโครงการได้', p.name.indexOf('เฟส 1') > 0 && p.budget === M('320000'));

  const inv = ctx.issueInvoice({ partnerCode: cus.code, date: '2026-03-10', lines: [{ desc: 'งวดที่ 1', qty: 1, price: '200000', taxCode: 'VAT7' }] });
  const inv2 = ctx.issueInvoice({ partnerCode: cus.code, date: '2026-03-11', lines: [{ desc: 'งานอื่น', qty: 1, price: '9000', taxCode: 'VAT7' }] });
  const bill = ctx.recordBill({ partnerCode: ven.code, date: '2026-03-12', vendorNo: 'WIRE-1', lines: [{ desc: 'สายไฟ', qty: 1, price: '80000', expenseSub: 'admin_expense' }] });
  const ex = ctx.recordExpense({ partnerCode: ven.code, date: '2026-03-13', taxInvoiceNo: 'EX-1', lines: [{ desc: 'ค่าแรงช่าง', qty: 1, price: '15000', acc: '5325' }] });
  ctx.setDocProject('invoice', inv.no, 'PJ-001');
  ctx.setDocProject('bill', bill.no, 'PJ-001');
  ctx.setDocProject('expense', ex.no, 'PJ-001');
  let act = ctx.projectActuals('PJ-001');
  ok('★ รายได้จริง = ใบกำกับที่ผูกไว้ (ก่อนภาษี) ไม่รวมใบที่ไม่ได้ผูก', act.revenue === M('200000'), fmt(act.revenue));
  ok('★ ต้นทุนจริง = ตั้งหนี้ + ค่าใช้จ่ายที่ผูกไว้ (ก่อนภาษี)', act.cost === M('95000') && act.margin === M('105000'), fmt(act.cost));
  ctx.issueCreditNote({ date: '2026-03-20', invoiceNo: inv.no, base: '10000', reason: 'PRICE_REDUCE' });
  act = ctx.projectActuals('PJ-001');
  ok('ใบลดหนี้ของใบกำกับในโครงการ ลดรายได้โครงการเอง', act.revenue === M('190000'));
  ok('ผูกเอกสารไม่แตะบัญชี ยอดคุมยังผ่าน', recOk('2026-03-31') === '', recOk('2026-03-31'));
  ctx.voidDocument('expense', ex.no, 'ทดสอบยกเลิกค่าใช้จ่ายในโครงการ');
  ok('เอกสารที่ยกเลิกไม่นับเป็นต้นทุนโครงการ', ctx.projectActuals('PJ-001').cost === M('80000'));
  ctx.setDocProject('invoice', inv.no, '');
  ok('ถอดเอกสารออกจากโครงการได้', !inv.project && ctx.projectActuals('PJ-001').revenue === 0);
  ctx.setProjectStatus('PJ-001', 'closed', 'ส่งมอบงานแล้ว');
  throws('★ โครงการที่ปิดแล้วผูกเอกสารเพิ่มไม่ได้', () => ctx.setDocProject('invoice', inv2.no, 'PJ-001'), 'PROJECT_CLOSED');
  ctx.setProjectStatus('PJ-001', 'active', 'มีงานแก้ไขเพิ่ม');
  ctx.setDocProject('invoice', inv2.no, 'PJ-001');
  ok('เปิดโครงการใหม่แล้วผูกได้', inv2.project === 'PJ-001');
  throws('ผูกเอกสารประเภทที่ไม่รองรับไม่ได้', () => ctx.setDocProject('receipt', 'x', 'PJ-001'), 'PROJECT_DOC_KIND');
}

console.log('\n=== 8.1 ลงทะเบียนผิด เอกสารซื้อถูกยกเลิก และบัญชีไม่ตรง ===');
{
  const { ven } = blank();
  const { bill, asset } = buy(ven, '2026-02-01', '45000', 'OFFICE', 5);
  ctx.voidDocument('bill', bill.no, 'ผู้ขายส่งใบกำกับผิด ทดสอบ');
  ok('★ เอกสารซื้อถูกยกเลิก ทะเบียนรู้ว่าที่มาหายไป', !ctx.assetSourceLive(asset));
  const c = ctx.assetRegisterVsGl('2026-02-28').rows.find((x) => x.acc === '1302');
  ok('★ ทะเบียนเทียบบัญชีบอกว่าเอกสารซื้อถูกยกเลิก ให้ลบออกจากทะเบียน', c.diff === -M('45000') && /ถูกยกเลิกไปแล้ว/.test(c.why), c.why);
  const pv = ctx.disposalPreview({ assetCode: asset.code, kind: 'writeoff', date: '2026-02-20' });
  ok('★ จำหน่ายทรัพย์สินที่บัญชีไม่มียอด ระบบเตือนก่อนบันทึก (บัญชีจะติดลบ)', pv.warnings.length === 1 && /น้อยกว่าราคาทุน/.test(pv.warnings[0]), pv.warnings[0]);
  throws('ลบต้องมีเหตุผล', () => ctx.deleteAsset(asset.code, ''), 'REASON_REQUIRED');
  ctx.deleteAsset(asset.code, 'เอกสารซื้อถูกยกเลิก ลงทะเบียนผิด');
  ok('ลบทรัพย์สินที่ลงทะเบียนผิดได้ ทะเบียนตรงกับบัญชีอีกครั้ง', !DB.assets.length && ctx.assetRegisterVsGl('2026-02-28').ok
    && DB.audit.some((x) => x.entity === 'asset' && x.action === 'delete'));
  const b2 = buy(ven, '2026-02-02', '30000', 'OFFICE', 5).asset;
  ctx.runDepreciation('2026-02');
  throws('★ ทรัพย์สินที่คิดค่าเสื่อมแล้วลบไม่ได้', () => ctx.deleteAsset(b2.code, 'ลองลบหลังคิดค่าเสื่อม'), 'ASSET_ALREADY_DEPRECIATED');
  const op = ctx.registerOpeningAsset({ name: 'ตู้เซฟ', class: 'OFFICE', inService: '2024-01-01', cost: '10000', bookYears: 5,
    accumBook: '4000', accumTax: '4000', asOf: '2025-12-31' }).asset;
  ctx.registerOpeningAsset({ code: op.code, name: 'ตู้เซฟเหล็ก', class: 'OFFICE', inService: '2024-01-01', cost: '10000', bookYears: 5,
    accumBook: '4000', accumTax: '4000', asOf: '2025-12-31' });
  ok('แก้ทรัพย์สินยกมาที่ยังไม่คิดค่าเสื่อมต่อได้', op.name === 'ตู้เซฟเหล็ก' && DB.assets.filter((a) => a.opening).length === 1);
  ctx.voidRun('depreciation', '2026-02', 'ทดสอบคิดค่าเสื่อมต่อจากยอดยกมา');
  ctx.runDepreciation('2026-02');
  throws('★ ยอดยกมาที่คิดค่าเสื่อมต่อไปแล้วแก้ไม่ได้', () => ctx.registerOpeningAsset({ code: op.code, name: 'x', class: 'OFFICE',
    inService: '2024-01-01', cost: '10000', bookYears: 5, accumBook: '0', asOf: '2025-12-31' }), 'ASSET_ALREADY_DEPRECIATED');
  ok('ทรัพย์สินยกมาคิดค่าเสื่อม ม.ค.–ก.พ. (2 เดือน) ต่อจากวันยกยอด',
    DB.docs.depreciation.find((r) => r.period === '2026-02' && r.status !== 'void').rows.find((r) => r.code === op.code).months === 2);
}

console.log('\n=== 9. งบประมาณ ===');
{
  blank();
  const sp = ctx.budgetSpread(M('100000'));
  ok('★ แบ่งเท่ากัน 12 เดือน ปัดเป็นสตางค์ เดือนสุดท้ายรับเศษ รวมเท่างบทั้งปีพอดี',
    sp.length === 12 && sp[0] === M('8333.33') && sp[11] === M('8333.37') && sp.reduce((s, v) => s + v, 0) === M('100000'));
  ctx.saveBudget({ account: '5321', period: '2026-05', months: ctx.budgetSpread(M('120000')).map(ctx.unM) });
  ok('ตั้งงบรายเดือนทั้งปีได้', ctx.budgetAmount('5321', '2026-01') === M('10000') && ctx.budgetAmount('5321', '2026-12') === M('10000'));
  ctx.saveBudget({ account: '4121', period: '2026-01', months: ['50000', '50000', '50000', '50000', '50000', '50000', '50000', '50000', '50000', '50000', '50000', '50000'] });
  const ven = DB.partners.find((p) => p.kind === 'vendor');
  const cus = DB.partners.find((p) => p.kind === 'customer');
  ctx.recordExpense({ partnerCode: ven.code, date: '2026-02-05', lines: [{ desc: 'ค่าเช่า ก.พ.', qty: 1, price: '12000', acc: '5321', taxCode: 'EXEMPT' }] });
  ctx.recordExpense({ partnerCode: ven.code, date: '2026-03-05', lines: [{ desc: 'ค่าเช่า มี.ค.', qty: 1, price: '9000', acc: '5321', taxCode: 'EXEMPT' }] });
  ctx.issueInvoice({ partnerCode: cus.code, date: '2026-03-10', lines: [{ desc: 'ค่าบริการ', qty: 1, price: '60000', taxCode: 'VAT7', revenueSub: 'service_revenue' }] });
  const r = ctx.budgetVsActual('2026-03');
  const rent = r.rows.find((x) => x.account === '5321');
  ok('★ ค่าใช้จ่ายต่ำกว่างบ = ผลต่างบวก (เดือนนี้ 10,000 − 9,000)', rent.budget === M('10000') && rent.actual === M('9000') && rent.variance === M('1000') && rent.pct === '90.0');
  ok('★ สะสม 3 เดือน: งบ 30,000 ใช้จริง 21,000', rent.ytdBudget === M('30000') && rent.ytdActual === M('21000') && rent.ytdVariance === M('9000'));
  const svc = r.rows.find((x) => x.account === '4121');
  ok('★ รายได้เกินงบ = ผลต่างบวก', svc.actual === M('60000') && svc.variance === M('10000'));
  ok('สรุปกำไรตามงบเทียบจริง', r.net.actual === svc.actual - rent.actual - r.rows.filter((x) => x.type === 'expense' && x.account !== '5321').reduce((s, x) => s + x.actual, 0));
  DB.periods.find((p) => p.code === '2026-01').status = 'closed';
  ctx.saveBudget({ account: '5321', period: '2026-01', months: ['11000', '11000', '11000', '11000', '11000', '11000', '11000', '11000', '11000', '11000', '11000', '11000'] });
  ok('★ แก้งบของงวดที่ปิดแล้วได้ (งบไม่ใช่บัญชี)', ctx.budgetAmount('5321', '2026-01') === M('11000'));
  throws('ตั้งงบให้บัญชีสินทรัพย์ไม่ได้', () => ctx.saveBudget({ account: '1113', period: '2026-01', months: [] }), 'BUDGET_ACCOUNT_INVALID');
  throws('งบติดลบไม่ได้', () => ctx.saveBudget({ account: '5321', period: '2026-01', months: ['-1'] }), 'BUDGET_NEGATIVE');
  ctx.saveBudget({ account: '5321', period: '2026-01', months: [] });
  ok('ใส่ศูนย์ทั้งปี = ลบงบของบัญชีนั้น', !DB.budget.some((b) => b.account === '5321'));
  ok('งบประมาณไม่สร้างใบสำคัญ', !DB.entries.some((e) => /งบประมาณ/.test(e.desc)));
}

done();
