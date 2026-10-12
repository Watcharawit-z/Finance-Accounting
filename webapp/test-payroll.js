/* ทดสอบระบบเงินเดือน (payroll.js) — รันด้วย node webapp/test-payroll.js
   ตัวเลขที่คาดไว้ทุกข้อคำนวณด้วยมือตามที่เขียนไว้ในคอมเมนต์ของแต่ละข้อ */
const { ctx, ok, throws, done } = require('./testlib');
const { M, fmt } = ctx;
const D = ctx.DB;
const money = (v) => fmt(v);
/** เลขประจำตัวประชาชนที่ผ่านหลักตรวจ — 12 หลักแรก + หลักที่ 13 คำนวณตามสูตรเดียวกับ validTaxId */
function nid(p12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i);
  return p12 + ((11 - (sum % 11)) % 10);
}
const fresh = () => ctx.buildBlank({ name: 'บริษัท ทดสอบเงินเดือน จำกัด', year: 2026 });
const emp = (o) => ctx.saveEmployee(Object.assign({ dept: 'บัญชี', hired: '2025-01-01' }, o)).employee;
const months = (from, to) => { const out = []; for (let m = from; m <= to; m++) out.push('2026-' + String(m).padStart(2, '0')); return out; };
const slipOf = (run, code) => run.slips.find((s) => s.code === code);
const yearPit = (code) => D.docs.payRun.filter((r) => r.status !== 'void')
  .reduce((s, r) => s + ((r.slips.find((x) => x.code === code) || {}).pit || 0), 0);
const tbOk = () => ctx.trialBalance('2026-01-01', '2026-12-31').balanced;

console.log('\n=== 1. ภาษีเงินได้ทั้งปี (คำนวณมือ) ===');
{
  /* เงินเดือน 50,000 × 12 = 600,000 · ค่าใช้จ่าย 50% เพดาน 100,000 · ส่วนตัว 60,000 · ประกันสังคม 875 × 12 = 10,500
     เงินได้สุทธิ 429,500 → (300,000−150,000)×5% + (429,500−300,000)×10% = 7,500 + 12,950 = 20,450 */
  const a = ctx.annualPit({ income: M('600000'), sso: M('10500'), pvd: 0, other: 0 });
  ok('เงินเดือน 50,000 โสด ไม่มีลดหย่อนอื่น ภาษีทั้งปี 20,450', a.tax === M('20450') && a.net === M('429500'), money(a.tax));
  /* กองทุนสำรองฯ 5% = 2,500 × 12 = 30,000 → ลดหย่อน 10,000 + ยกเว้น 20,000 (ไม่เกิน 15% ของ 600,000 = 90,000)
     เงินได้สุทธิ 429,500 − 30,000 = 399,500 → 7,500 + 9,950 = 17,450 */
  const b = ctx.annualPit({ income: M('600000'), sso: M('10500'), pvd: M('30000'), other: 0 });
  ok('มีกองทุนสำรองเลี้ยงชีพ 30,000 ภาษีทั้งปี 17,450', b.tax === M('17450') && b.pvd === M('30000'), money(b.tax));
  /* ลดหย่อนอื่น 100,000 (คู่สมรส 60,000 + ประกันชีวิต 40,000) → สุทธิ 329,500 → 7,500 + 2,950 = 10,450 */
  const c = ctx.annualPit({ income: M('600000'), sso: M('10500'), pvd: 0, other: M('100000') });
  ok('ค่าลดหย่อนอื่น 100,000 ภาษีทั้งปี 10,450', c.tax === M('10450'), money(c.tax));
  /* เงินได้ 150,000: ค่าใช้จ่าย 75,000 (50% ยังไม่ถึงเพดาน) ส่วนตัว 60,000 สุทธิ 15,000 → ไม่เสียภาษี */
  const d = ctx.annualPit({ income: M('150000'), sso: 0, pvd: 0, other: 0 });
  ok('เงินได้ต่ำ ค่าใช้จ่าย 50% ไม่ถึงเพดาน ไม่เสียภาษี', d.expense === M('75000') && d.tax === 0, money(d.expense));
  /* เงินได้ 3,000,000 สุทธิ 2,840,000: 7,500+20,000+37,500+50,000+250,000+(840,000×30%=252,000) = 617,000 */
  const e = ctx.annualPit({ income: M('3000000'), sso: 0, pvd: 0, other: 0 });
  ok('อัตราก้าวหน้าถึงขั้น 30% คิดแบบขั้นบันได', e.tax === M('617000'), money(e.tax));
  ok('ตัวเดิม computePit ยังได้ 20,450 (ชุดทดสอบเดิม)', ctx.computePit(M('600000'), M('70500')).tax === M('20450'));
}

console.log('\n=== 2. กองทุนสำรองเลี้ยงชีพ ประกันสังคม (กฎการปัดและเพดาน) ===');
{
  /* 80,000 จากค่าจ้าง 400,000: 10,000 + min(70,000, 15%×400,000=60,000, 490,000) = 70,000 */
  ok('กองทุนเกิน 15% ของค่าจ้าง ลดได้ 10,000 + 15% ของค่าจ้าง', ctx.pvdAllowance(M('80000'), M('400000')) === M('70000'));
  ok('กองทุนน้อยกว่า 10,000 ลดได้เต็ม', ctx.pvdAllowance(M('5000'), M('100000')) === M('5000'));
  /* 600,000 จากค่าจ้าง 5,000,000: 10,000 + min(590,000, 750,000, 490,000) = 500,000 */
  ok('กองทุนรวมไม่เกิน 500,000', ctx.pvdAllowance(M('600000'), M('5000000')) === M('500000'));
  const r69 = ctx.ssoRate('2026-01-31'), r68 = ctx.ssoRate('2025-12-31');
  /* 11,612.90 × 5% = 580.645 → ปัดเป็นบาท 581 · ค่าจ้าง 1,000 ใช้ฐานขั้นต่ำ 1,650 × 5% = 82.50 → 83 */
  ok('เงินสมทบปัดเป็นบาท 580.645 → 581', ctx.ssoContribution(M('11612.90'), r69) === M('581'));
  ok('ค่าจ้างต่ำกว่าฐานขั้นต่ำใช้ 1,650 → 82.50 ปัดเป็น 83', ctx.ssoContribution(M('1000'), r69) === M('83'));
  ok('เพดาน 2569 = 875 · เพดาน 2568 = 750', ctx.ssoContribution(M('30000'), r69) === M('875') && ctx.ssoContribution(M('30000'), r68) === M('750'));
  ok('ไม่มีค่าจ้างไม่ต้องสมทบ', ctx.ssoContribution(0, r69) === 0);
}

console.log('\n=== 3. ทั้งปี 12 งวด แบบยอดสะสม — ภาษีรวมเท่าภาษีทั้งปีพอดี ===');
{
  fresh();
  const A = emp({ name: 'นายเอ ทดสอบ', salary: '50000', nationalId: nid('110170012345') });
  const B = emp({ name: 'นางสาวบี ทดสอบ', salary: '50000', pvdRate: 5, nationalId: nid('110170012346') });
  const jan = ctx.runPayroll('2026-01');
  /* 20,450 ÷ 12 = 1,704.1667 → 1,704.17 · 17,450 ÷ 12 = 1,454.17 */
  ok('★ เอ งวดมกราคมหัก 1,704.17 (20,450 ÷ 12)', slipOf(jan, A.code).pit === M('1704.17'), money(slipOf(jan, A.code).pit));
  ok('★ บี (กองทุน 5%) งวดมกราคมหัก 1,454.17 (17,450 ÷ 12)', slipOf(jan, B.code).pit === M('1454.17'), money(slipOf(jan, B.code).pit));
  ok('บี กองทุนสะสม 2,500 นายจ้างสมทบเท่ากันเมื่อไม่ได้ระบุอัตรานายจ้าง', slipOf(jan, B.code).pvd === M('2500') && slipOf(jan, B.code).pvdEr === M('2500'));
  const je = D.entries.find((e) => e.no === jan.entryNo);
  const line = (sub) => je.lines.filter((l) => ctx.acc(l.acc).subType === sub).reduce((s, l) => s + l.dr - l.cr, 0);
  ok('ใบสำคัญ: Dr เงินเดือน 100,000 · Dr สมทบประกันสังคม 1,750 · Dr สมทบกองทุน 2,500',
    line('salary_expense') === M('100000') && line('sso_expense') === M('1750') && line('pvd_expense') === M('2500'));
  ok('ใบสำคัญ: Cr ภ.ง.ด.1 3,158.34 · Cr ประกันสังคม 3,500 · Cr กองทุน 5,000',
    line('wht_payable_pnd1') === -M('3158.34') && line('sso_payable') === -M('3500') && line('pvd_payable') === -M('5000'));
  /* สุทธิ: เอ 50,000 − 1,704.17 − 875 = 47,420.83 · บี 50,000 − 1,454.17 − 875 − 2,500 = 45,170.83 */
  ok('จ่ายสุทธิออกจากธนาคาร 92,591.66', line('bank') === -M('92591.66') && jan.net === M('92591.66'), money(jan.net));
  const rows = D.taxTx.filter((t) => t.form === 'PND1' && t.period === '2026-01');
  ok('★ ภ.ง.ด.1 แยกรายคน มีเลขประจำตัวประชาชนและเงินได้', rows.length === 2
    && rows.every((t) => ctx.validTaxId(t.taxId) && t.base === M('50000') && t.channel === 'manual'), rows.map((t) => t.partnerName + ' ' + t.taxId).join(' · '));
  months(2, 12).forEach((p) => ctx.runPayroll(p));
  const dec = D.docs.payRun.find((r) => r.period === '2026-12');
  /* ทุกงวดคิด (20,450 − ภาษีที่หักแล้ว) ÷ งวดที่เหลือ เศษสตางค์ที่ปัดขึ้นจึงถูกเกลี่ยคืนในงวดถัด ๆ ไป
     เช่น มิ.ย. (20,450 − 8,520.85) ÷ 7 = 1,704.1643 → 1,704.16 · ธันวาคมหักส่วนที่เหลือพอดี
     ลำดับ: 1,704.17 ×5 · .16 · .17 · .16 · .17 · .16 · .17 · .16 = 20,450.00 */
  ok('★ ภาษีทั้งปีของเอ = 20,450.00 พอดี ไม่มีเศษสตางค์ค้าง', yearPit(A.code) === M('20450') && slipOf(dec, A.code).pit === M('1704.16'),
    'ธ.ค. ' + money(slipOf(dec, A.code).pit) + ' รวม ' + money(yearPit(A.code)));
  ok('ภาษีทั้งปีของบี = 17,450.00 พอดี', yearPit(B.code) === M('17450'), money(yearPit(B.code)));
  const y = ctx.payrollYear(2026);
  const ya = y.rows.find((r) => r.code === A.code);
  ok('สรุปทั้งปี (ภ.ง.ด.1ก / 50 ทวิ): เอ เงินได้ 600,000 ภาษี 20,450 ประกันสังคม 10,500', ya.income === M('600000') && ya.tax === M('20450') && ya.sso === M('10500'));
  ok('สรุปทั้งปีเรียงลำดับในแบบ ภ.ง.ด.1ก', y.rows.map((r) => r.seq).join(',') === '1,2' && y.totals.tax === M('37900'));
  ok('งบทดลองสมดุลหลัง 12 งวด', tbOk());
  ok('ยอดคุมผ่านครบ', ctx.reconciliationChecks('2026-12-31').allPassed);
}

console.log('\n=== 4. เข้างานกลางเดือน — เงินเดือนตามสัดส่วนวัน ===');
{
  fresh();
  const C = emp({ name: 'นายซี เข้าใหม่', salary: '30000', hired: '2026-01-20', nationalId: nid('310170012345') });
  const jan = ctx.runPayroll('2026-01');
  const s = slipOf(jan, C.code);
  /* 20–31 ม.ค. = 12 วันจาก 31 วัน → 30,000 × 12 ÷ 31 = 11,612.903 → 11,612.90 */
  ok('★ เข้างาน 20 ม.ค. ได้เงินเดือน 11,612.90 ไม่ใช่ 30,000 เต็ม', s.salary === M('11612.90') && s.days === 12 && s.prorated, money(s.salary));
  ok('ประกันสังคม 11,612.90 × 5% = 580.645 → 581', s.sso === M('581'), money(s.sso));
  /* ประมาณทั้งปี 11,612.90 + 30,000 × 11 = 341,612.90 · ประกันสังคม 581 + 875 × 11 = 10,206
     สุทธิ 341,612.90 − 100,000 − 60,000 − 10,206 = 171,406.90 → ภาษี 21,406.90 × 5% = 1,070.35 ÷ 12 งวด = 89.20 */
  ok('★ ภาษีงวดแรก 89.20 (ประมาณทั้งปี 341,612.90 ภาษี 1,070.35 ÷ 12)', s.pit === M('89.20') && s.calc.annualTax === M('1070.35'),
    money(s.pit) + ' / ' + money(s.calc.annualTax));
  const feb = ctx.runPayroll('2026-02');
  ok('เดือนถัดไปได้เงินเดือนเต็ม', slipOf(feb, C.code).salary === M('30000') && !slipOf(feb, C.code).prorated);
  throws('★ ทำงวดปกติของเดือนเดิมซ้ำไม่ได้', () => ctx.runPayroll('2026-02'), 'PAYROLL_ALREADY_RUN');
  const late = emp({ name: 'นางดี มาทีหลัง', salary: '25000', hired: '2026-03-01' });
  ok('คนที่เริ่มงานหลังงวดไม่อยู่ในแผ่นงานของงวดนั้น', !ctx.payrollPreview(ctx.payDraft('2026-02')).rows.some((r) => r.code === late.code)
    && ctx.payrollPreview(ctx.payDraft('2026-03')).rows.some((r) => r.code === late.code));
}

console.log('\n=== 5. ค่าล่วงเวลา หักขาดงาน และค่าลดหย่อนอื่น ===');
{
  fresh();
  const G = emp({ name: 'นายจี ล่วงเวลา', salary: '30000' });
  const H = emp({ name: 'นางเอช ลดหย่อน', salary: '50000', deductions: '100000' });
  ctx.setPayLine('R|2026-01', G.code, { ot: '10', unpaid: '2' });
  const jan = ctx.runPayroll('2026-01');
  const g = slipOf(jan, G.code);
  /* OT 10 ชม. × (30,000 ÷ 30 ÷ 8) × 1.5 = 1,875 · ขาดงาน 2 วัน × 1,000 = 2,000 · เงินได้ 30,000 − 2,000 + 1,875 = 29,875
     ส่วนประจำ: 28,000 + 30,000 × 11 = 358,000 สุทธิ 187,500 ภาษี 1,875 ÷ 12 = 156.25
     ส่วนไม่ประจำ: ค่าล่วงเวลาทำให้ภาษีทั้งปีเป็น 1,968.75 เพิ่ม 93.75 → รวม 250.00
     ประกันสังคมคิดจากค่าจ้าง 28,000 (ค่าล่วงเวลาไม่ใช่ค่าจ้าง) → 875 */
  ok('★ ค่าล่วงเวลา 10 ชม. = 1,875 · หักขาดงาน 2 วัน = 2,000', g.ot === M('1875') && g.unpaid === M('2000') && g.taxable === M('29875'));
  ok('★ ภาษี 250.00 (เงินเดือนเฉลี่ย 156.25 + ค่าล่วงเวลาหักส่วนเพิ่ม 93.75)', g.pit === M('250'), money(g.pit));
  ok('ประกันสังคมคิดจากค่าจ้างไม่รวมค่าล่วงเวลา', g.ssoWage === M('28000') && g.sso === M('875'));
  /* 10,450 ÷ 12 = 870.83 */
  ok('★ ค่าลดหย่อนอื่น 100,000 ต่อปี หักเดือนละ 870.83', slipOf(jan, H.code).pit === M('870.83'), money(slipOf(jan, H.code).pit));
  ctx.saveEmployee({ code: H.code, name: 'นางเอช ลดหย่อน (แก้ชื่อ)' });
  ok('★ แก้ชื่อพนักงานโดยไม่ส่งค่าลดหย่อน ค่าลดหย่อนเดิมไม่หาย', H.deductions === M('100000') && H.salary === M('50000') && H.name.indexOf('แก้ชื่อ') > 0);
  ctx.saveEmployee({ code: H.code, name: H.name, deductions: '' });
  ok('ล้างช่องค่าลดหย่อนเป็นค่าว่าง = ศูนย์', H.deductions === 0);
  ctx.setPayLine('R|2026-02', G.code, { unpaid: '31' });
  throws('หักขาดงานเกินเงินเดือนลงบัญชีไม่ได้', () => ctx.runPayroll('2026-02'), 'PAY_LINE_INVALID');
  ok('ลงบัญชีไม่ผ่านแล้วไม่มีอะไรค้าง แผ่นงานยังเก็บตัวเลขที่กรอกไว้ให้แก้', !ctx.activeRegularRun('2026-02')
    && ctx.payDraftFind('R|2026-02').lines[G.code].unpaid === 31 && !D.entries.some((e) => e.date >= '2026-02-01' && e.src === 'payroll'));
  ctx.setPayLine('R|2026-02', G.code, { unpaid: '', loan: '40000' });
  throws('หักเงินกู้จนเงินที่ต้องจ่ายติดลบไม่ได้', () => ctx.runPayroll('2026-02'), 'PAY_LINE_INVALID');
  ctx.setPayLine('R|2026-02', G.code, { loan: '5000', otherDed: '1000', reimburse: '1200' });
  const feb = ctx.runPayroll('2026-02');
  const je = D.entries.find((e) => e.no === feb.entryNo);
  const by = (sub) => je.lines.filter((l) => ctx.acc(l.acc).subType === sub).reduce((s, l) => s + l.dr - l.cr, 0);
  ok('หักเงินกู้ลงลูกหนี้พนักงาน · หักนำส่งผู้อื่นลงเจ้าหนี้อื่น · คืนค่าใช้จ่ายไม่ใช่เงินได้',
    by('other_receivable') === -M('5000') && by('other_payable') === -M('1000') && slipOf(feb, G.code).reimburse === M('1200')
    && slipOf(feb, G.code).taxable === M('30000'));
  ok('งบทดลองสมดุล', tbOk());
}

console.log('\n=== 6. โบนัสจ่ายนอกรอบในเดือนเดียวกัน ===');
{
  fresh();
  const K = emp({ name: 'นายเค โบนัส', salary: '50000', nationalId: nid('110170099991') });
  const jan = ctx.runPayroll('2026-01');
  const d = ctx.newOffcycleDraft({ period: '2026-01', type: 'bonus', payDate: '2026-01-31' });
  ctx.setPayLine(d.id, K.code, { bonus: '100000' });
  const bonus = ctx.runPayroll(null, { draftId: d.id });
  const b = slipOf(bonus, K.code);
  /* หลังงวดมกราคม: ประจำ 50,000 + 50,000 × 11 = 600,000 → 20,450 · รวมโบนัส 700,000 สุทธิ 529,500
     → 7,500 + 20,000 + 29,500 × 15% = 31,925 · โบนัสหักส่วนเพิ่ม 31,925 − 20,450 = 11,475 */
  ok('★ โบนัส 100,000 หักภาษี 11,475 (ส่วนเพิ่มของภาษีทั้งปี ไม่ใช่คูณ 12)', b.pit === M('11475'), money(b.pit));
  ok('โบนัสไม่ใช่ค่าจ้าง ไม่คิดประกันสังคมและกองทุน', b.sso === 0 && b.pvd === 0);
  ok('งวดนอกรอบเป็นคนละงวดกับงวดปกติ ทำในเดือนเดียวกันได้', bonus.kind === 'offcycle' && bonus.no !== jan.no && bonus.period === '2026-01');
  const rows = ctx.pnd1Rows('2026-01');
  ok('ภ.ง.ด.1 มกราคม: 2 รายการของคนเดียวกัน รวม 13,179.17', rows.length === 2 && rows.reduce((s, t) => s + t.tax, 0) === M('13179.17'));
  const feb = ctx.runPayroll('2026-02');
  /* (31,925 − 13,179.17) ÷ 11 = 1,704.1664 → 1,704.17 */
  ok('★ งวดถัดไปยังหัก 1,704.17 ตามยอดสะสม', slipOf(feb, K.code).pit === M('1704.17'), money(slipOf(feb, K.code).pit));
  months(3, 12).forEach((p) => ctx.runPayroll(p));
  ok('★ ภาษีทั้งปีรวมโบนัส = 31,925.00 พอดี', yearPit(K.code) === M('31925'), money(yearPit(K.code)));
  throws('ยกเลิกด้วยรหัสเดือนเมื่อเดือนนั้นมีหลายงวดไม่ได้ ต้องระบุเลขที่', () => ctx.voidRun('payroll', '2026-01', 'ทดสอบหลายงวด'), 'RUN_AMBIGUOUS');
}

console.log('\n=== 7. ประกันสังคมเมื่อจ่ายหลายรอบในเดือนเดียว ===');
{
  fresh();
  const P = emp({ name: 'นายพี ขายเก่ง', salary: '30000' });
  const d = ctx.newOffcycleDraft({ period: '2026-03', type: 'commission', payDate: '2026-03-10' });
  ctx.setPayLine(d.id, P.code, { commission: '1000' });
  const c = ctx.runPayroll(null, { draftId: d.id });
  /* ค่าคอมมิชชั่นเป็นค่าจ้าง: 1,000 ต่ำกว่าฐาน 1,650 → 83 · งวดปกติค่าจ้างทั้งเดือน 31,000 → 875 − 83 = 792 */
  ok('ค่าคอมมิชชั่นรอบแรกของเดือนสมทบ 83', slipOf(c, P.code).sso === M('83'));
  const r = ctx.runPayroll('2026-03');
  ok('★ งวดปกติสมทบส่วนที่เหลือ 792 รวมทั้งเดือนไม่เกินเพดาน 875', slipOf(r, P.code).sso === M('792') && ctx.ssoMonth('2026-03').totals.sso === M('875'));
  const sm = ctx.ssoMonth('2026-03');
  ok('สปส.1-10: ค่าจ้างรวม 31,000 นายจ้างสมทบเท่ากัน 875', sm.rows.length === 1 && sm.rows[0].wage === M('31000') && sm.totals.ssoEr === M('875') && sm.totals.total === M('1750'));
}

console.log('\n=== 8. ออกจากงาน — ประมาณการถึงเดือนที่ออก และจ่ายเงินได้เมื่อออก ===');
{
  fresh();
  const E = emp({ name: 'นายอี ลาออก', salary: '30000', left: '2026-03-15' });
  const F = emp({ name: 'นายเอฟ ผู้จัดการ', salary: '100000', left: '2026-02-28', nationalId: nid('110170055555') });
  const jan = ctx.runPayroll('2026-01');
  /* อี: ประมาณทั้งปีแค่ ม.ค.–15 มี.ค. = 30,000 + 30,000 + 14,516.13 = 74,516.13 → ไม่ถึงเกณฑ์เสียภาษี */
  ok('★ แจ้งวันออกแล้วประมาณเงินได้ถึงเดือนที่ออก ไม่หักภาษีเกิน', slipOf(jan, E.code).pit === 0 && slipOf(jan, E.code).calc.future === 2);
  ctx.runPayroll('2026-02');
  const mar = ctx.runPayroll('2026-03');
  /* 1–15 มี.ค. = 15 วันจาก 31 → 30,000 × 15 ÷ 31 = 14,516.13 */
  ok('★ เดือนที่ออกได้เงินเดือนตามวันที่ทำงาน 14,516.13', slipOf(mar, E.code).salary === M('14516.13'));
  ok('คนที่ออกแล้วไม่อยู่ในงวดปกติเดือนถัดไป', !slipOf(mar, F.code) && !ctx.payrollPreview(ctx.payDraft('2026-04')).rows.some((r) => r.code === E.code));
  const d = ctx.newOffcycleDraft({ period: '2026-03', type: 'final', payDate: '2026-03-31' });
  ctx.setPayLine(d.id, F.code, { leavePay: '200000' });
  ctx.setPayLine(d.id, E.code, { leavePay: '5000', severanceExempt: '30000' });
  const fin = ctx.runPayroll(null, { draftId: d.id });
  /* เอฟ: ได้เงินเดือน ม.ค.–ก.พ. 200,000 แล้ว ไม่มีงวดเงินเดือนเหลือ ค่าจ้างวันลา 200,000 → เงินได้ 400,000
     สุทธิ 400,000 − 100,000 − 60,000 − 1,750 = 238,250 → (238,250 − 150,000) × 5% = 4,412.50 */
  ok('★ จ่ายหลังออกจากงาน หักภาษีที่เหลือทั้งปีในครั้งเดียว 4,412.50', slipOf(fin, F.code).pit === M('4412.50') && slipOf(fin, F.code).calc.remaining === 0,
    money(slipOf(fin, F.code).pit));
  const e = slipOf(fin, E.code);
  ok('ค่าชดเชยส่วนที่ได้รับยกเว้นจ่ายให้แต่ไม่นับเป็นเงินได้ที่ต้องเสียภาษี', e.exempt === M('30000') && e.taxable === M('5000') && e.net === M('35000'));
  ok('ไม่มีภาษีก็ไม่ขึ้นใน ภ.ง.ด.1 รายเดือน แต่อยู่ในสรุปทั้งปี', !ctx.pnd1Rows('2026-03').some((t) => t.empCode === E.code)
    && ctx.payrollYear(2026).rows.find((r) => r.code === E.code).income === M('79516.13'));
}

console.log('\n=== 9. วันที่จ่าย บัญชีที่จ่าย และเริ่มใช้ระบบกลางปี ===');
{
  fresh();
  const Q = emp({ name: 'นางคิว ย้ายระบบ', salary: '50000', nationalId: nid('110170077777'),
    ytdYear: 2026, ytdIncome: '300000', ytdTax: '10225', ytdSso: '5250' });
  throws('วันที่จ่ายห่างจากงวดเกินเดือนถัดไปไม่ได้', () => ctx.savePayDraft({ id: 'R|2026-07', payDate: '2026-09-15' }), 'PAY_DATE_RANGE');
  throws('จ่ายจากบัญชีที่ไม่ใช่เงินสด/ธนาคารไม่ได้', () => ctx.savePayDraft({ id: 'R|2026-07', payFrom: '5311' }), 'PAY_FROM_INVALID');
  ctx.savePayDraft({ id: 'R|2026-07', payDate: '2026-08-05', payFrom: '1114' });
  const jul = ctx.runPayroll('2026-07');
  const je = D.entries.find((e) => e.no === jul.entryNo);
  ok('★ ลงบัญชีวันที่จ่ายจริง และจ่ายจากบัญชีที่เลือก (1114)', je.date === '2026-08-05' && je.lines.some((l) => l.acc === '1114' && l.cr === jul.net));
  ok('★ ภ.ง.ด.1 นับเดือนที่จ่ายจริง (สิงหาคม)', D.taxTx.some((t) => t.runNo === jul.no && t.period === '2026-08'));
  /* ยอดก่อนเริ่มใช้ระบบ ม.ค.–มิ.ย. 300,000 ภาษี 10,225 · ประมาณทั้งปี 300,000 + 50,000 × 6 = 600,000 → 20,450
     (20,450 − 10,225) ÷ 6 งวดที่เหลือ = 1,704.17 */
  ok('★ เริ่มใช้ระบบเดือนกรกฎาคม ใช้ยอดสะสมก่อนหน้าคำนวณต่อ 1,704.17', slipOf(jul, Q.code).pit === M('1704.17'), money(slipOf(jul, Q.code).pit));
  ok('สรุปทั้งปีรวมยอดก่อนเริ่มใช้ระบบ', ctx.payrollYear(2026).rows[0].income === M('350000'));
  ok('ครั้งต่อไปตั้งต้นจ่ายจากบัญชีเดิมที่ใช้ล่าสุด', ctx.payDraft('2026-08').payFrom === '1114');
  throws('ภาษีสะสมมากกว่าเงินได้สะสมไม่ได้', () => ctx.saveEmployee({ code: Q.code, ytdYear: 2026, ytdIncome: '100', ytdTax: '200' }), 'YTD_TAX_EXCEEDS');
}

console.log('\n=== 10. ยกเลิกงวด แก้แผ่นงาน แล้วทำใหม่ ===');
{
  fresh();
  const R = emp({ name: 'นายอาร์ แก้ไข', salary: '40000' });
  ctx.setPayLine('R|2026-05', R.code, { ot: '4' });
  const first = ctx.runPayroll('2026-05');
  ok('ลงบัญชีแล้วแผ่นงานหายไป (กลายเป็นงวดที่จ่ายแล้ว)', !ctx.payDraftFind('R|2026-05'));
  throws('★ กลับรายการใบสำคัญเงินเดือนตรง ๆ ไม่ได้', () => ctx.reverse(first.entryNo, 'ลองกลับตรง ๆ'), 'ENTRY_FROM_DOCUMENT');
  ctx.voidRun('payroll', first.no, 'กรอกชั่วโมงล่วงเวลาผิด');
  ok('★ ยกเลิกแล้วได้แผ่นงานเดิมคืนมาพร้อมรายการที่กรอกไว้', ctx.payDraftFind('R|2026-05') && ctx.payDraftFind('R|2026-05').lines[R.code].ot === 4);
  ok('รายการ ภ.ง.ด.1 ของงวดที่ยกเลิกเป็นศูนย์', D.taxTx.filter((t) => t.runNo === first.no).every((t) => t.void && t.tax === 0));
  ctx.setPayLine('R|2026-05', R.code, { ot: '6' });
  const again = ctx.runPayroll('2026-05');
  /* 40,000 ÷ 240 × 1.5 = 250 ต่อชั่วโมง → 6 ชม. = 1,500 */
  ok('แก้แล้วทำใหม่ได้ ค่าล่วงเวลา 6 ชม. = 1,500', slipOf(again, R.code).ot === M('1500'));
  ctx.voidRun('payroll', '2026-05', 'ทดสอบยกเลิกด้วยรหัสเดือน');
  ok('ยกเลิกด้วยรหัสเดือนได้เมื่อมีงวดเดียว (ผู้เรียกรุ่นก่อน)', again.status === 'void');
  const third = ctx.runPayroll('2026-05');
  const filed = ctx.fileWht('2026-05', 'PND1');
  ok('ยื่น ภ.ง.ด.1 นับรายคน', filed.count === 1 && filed.total === third.pit);
  throws('★ ยื่น ภ.ง.ด.1 แล้วยกเลิกงวดไม่ได้', () => ctx.voidRun('payroll', third.no, 'ลองยกเลิกหลังยื่น'), 'TAX_ALREADY_FILED');
  /* แก้หลังยื่นแบบ: เดือนถัดไปปรับเงินได้ที่จ่ายเกิน −1,500 ภาษีสะสมคิดใหม่ให้เอง */
  ctx.setPayLine('R|2026-06', R.code, { adjust: '-1500' });
  const jun = ctx.runPayroll('2026-06');
  ok('★ ปรับปรุงเงินได้งวดก่อนติดลบได้ ลดเงินได้ที่ต้องเสียภาษีของงวดนี้', slipOf(jun, R.code).taxable === M('38500'));
  ok('ยอดคุมผ่านหลังยกเลิกและทำใหม่', ctx.reconciliationChecks('2026-06-30').allPassed && tbOk());

  /* ข้อมูลที่บันทึกไว้ก่อนมีระบบนี้: งวดไม่มีเลขที่ ไม่มีประเภท ไม่มีสถานะ ภ.ง.ด.1 เป็นแถวรวมแถวเดียว */
  const old = ctx.runPayroll('2026-08');
  ['no', 'kind', 'type', 'status', 'input', 'payFrom', 'label'].forEach((k) => { delete old[k]; });
  D.taxTx.filter((t) => t.entryNo === old.entryNo).forEach((t) => { delete t.runNo; delete t.empCode; });
  ok('งวดรุ่นก่อนหาได้ด้วยเลขที่ใบสำคัญ', ctx.payRunCheck(old.entryNo) === old);
  ctx.voidRun('payroll', old.entryNo, 'ยกเลิกงวดรุ่นก่อน');
  ok('★ ยกเลิกงวดรุ่นก่อนได้ ภ.ง.ด.1 ถูกตัด แผ่นงานกลับมาเป็นค่าจากทะเบียน', old.status === 'void'
    && D.taxTx.filter((t) => t.entryNo === old.entryNo).every((t) => t.void) && ctx.payDraftFind('R|2026-08'));
  ok('ทำงวดเดิมใหม่ได้หลังยกเลิกงวดรุ่นก่อน', ctx.runPayroll('2026-08').status === 'posted');
}

console.log('\n=== 11. นำส่งประกันสังคมและกองทุนสำรองเลี้ยงชีพ ===');
{
  fresh();
  const S1 = emp({ name: 'นายเอส นำส่ง', salary: '20000', pvdRate: 3, pvdErRate: 5 });
  const run = ctx.runPayroll('2026-04');
  ok('อัตรานายจ้างสมทบกองทุนแยกจากลูกจ้างได้ (3% / 5%)', run.pvdEmp === M('600') && run.pvdEr === M('1000'));
  const due = ctx.payRemitDue('sso', '2026-04');
  ok('ยอดประกันสังคมที่ต้องนำส่ง = ลูกจ้าง + นายจ้าง 1,750', due.left === M('1750'));
  throws('นำส่งเกินยอดค้างในบัญชีไม่ได้', () => ctx.remitPayroll({ kind: 'sso', period: '2026-04', date: '2026-05-15', amount: '5000' }), 'REMIT_EXCEEDS_PAYABLE');
  const rm = ctx.remitPayroll({ kind: 'sso', period: '2026-04', date: '2026-05-15', payFrom: '1113' });
  ok('★ นำส่งประกันสังคม: Dr ประกันสังคมค้างนำส่ง / Cr ธนาคาร ยอดค้างเหลือศูนย์',
    rm.amount === M('1750') && ctx.balBySub(['sso_payable'], '2026-05-31') === 0);
  throws('นำส่งซ้ำไม่ได้', () => ctx.remitPayroll({ kind: 'sso', period: '2026-04', date: '2026-05-15' }), 'NOTHING_TO_REMIT');
  throws('★ นำส่งแล้วยกเลิกงวดเงินเดือนไม่ได้ ต้องยกเลิกการนำส่งก่อน', () => ctx.voidRun('payroll', run.no, 'ทดสอบหลังนำส่ง'), 'RUN_REMITTED');
  throws('กลับรายการใบสำคัญนำส่งตรง ๆ ไม่ได้', () => ctx.reverse(rm.entryNo, 'ลองกลับตรง ๆ'), 'ENTRY_FROM_DOCUMENT');
  ctx.voidPayRemit(rm.no, 'นำส่งผิดบัญชี');
  ok('ยกเลิกการนำส่งแล้วยอดค้างกลับมา', ctx.balBySub(['sso_payable'], '2026-05-31') === -M('1750') && ctx.payRemitDue('sso', '2026-04').left === M('1750'));
  const pv = ctx.remitPayroll({ kind: 'pvd', period: '2026-04', date: '2026-05-07' });
  ok('นำส่งกองทุนสำรองเลี้ยงชีพ 1,600', pv.amount === M('1600') && ctx.balBySub(['pvd_payable'], '2026-05-31') === 0);
  ok('เลขที่นำส่งไม่ชนกับเลขที่งวดเงินเดือน', /^PRM/.test(pv.no) && /^PAY/.test(run.no));
  ok('งบทดลองสมดุล', tbOk());
}

console.log('\n=== 12. ทะเบียนพนักงาน ===');
{
  fresh();
  const a = emp({ name: 'นายทดสอบ หนึ่ง', salary: '20000', nationalId: nid('120170012345') });
  throws('เลขประจำตัวประชาชนซ้ำกับคนอื่นไม่ได้', () => emp({ name: 'นายซ้ำ', nationalId: a.nationalId }), 'NATIONAL_ID_DUPLICATE');
  throws('วันพ้นสภาพก่อนวันเริ่มงานไม่ได้', () => emp({ name: 'นายผิดวัน', hired: '2026-05-01', left: '2026-04-30' }), 'LEFT_BEFORE_HIRED');
  throws('เลขประจำตัวประชาชนผิดหลักที่ 13', () => emp({ name: 'ผิด', nationalId: '1111111111111' }), 'NATIONAL_ID_INVALID');
  throws('อัตรากองทุนเกิน 15%', () => emp({ name: 'ทดสอบ', pvdRate: 20 }), 'PVD_RATE_RANGE');
  const x = emp({ name: 'นายไม่ประกัน', salary: '40000', ssoExempt: true });
  const r = ctx.runPayroll('2026-01');
  ok('พนักงานที่ไม่อยู่ในประกันสังคม (เช่น อายุเกิน 60 ที่รับเข้าใหม่) ไม่หักและไม่สมทบ', slipOf(r, x.code).sso === 0 && slipOf(r, x.code).ssoEr === 0);
  ctx.setPayLine('R|2026-02', a.code, {}, true);
  ctx.setPayLine('R|2026-02', x.code, {}, true);
  throws('ไม่ติ๊กจ่ายใครเลยลงบัญชีไม่ได้', () => ctx.runPayroll('2026-02'), 'NO_EMPLOYEES');
  ctx.setPayLine('R|2026-02', a.code, {}, false);
  ok('ไม่ติ๊กจ่ายบางคน งวดนี้จ่ายเฉพาะคนที่เลือก', ctx.runPayroll('2026-02').slips.map((s) => s.code).join() === a.code);
  ctx.saveEmployee({ code: x.code, active: false });
  ok('พ้นสภาพแบบไม่ระบุวัน (ข้อมูลรุ่นก่อน) ไม่อยู่ในงวดถัดไป', !ctx.payrollPreview(ctx.payDraft('2026-03')).rows.some((s) => s.code === x.code));
}

done();
