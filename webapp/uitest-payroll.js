/* ทดสอบหน้าจอเงินเดือนบนบริษัทเปล่า ด้วยปุ่มและแบบฟอร์มจริง — รันด้วย node webapp/uitest-payroll.js (สร้าง index.html ก่อน)
   เพิ่มพนักงาน → แผ่นงานเดือนมกราคม (คนเข้ากลางเดือน ค่าล่วงเวลา รายการอื่น วันจ่าย บัญชีที่จ่าย) → โบนัสนอกรอบ
   → ภ.ง.ด.1 / สปส.1-10 / นำส่ง → กุมภาพันธ์ (คนลาออกกลางเดือน ยกเลิกแล้วทำใหม่) → สรุปทั้งปี ภ.ง.ด.1ก 50 ทวิ */
const T = require('./uitestlib');
const ok = T.ok;
/** เลขประจำตัวประชาชนที่ผ่านหลักตรวจ */
function nid(p12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i);
  return p12 + ((11 - (sum % 11)) % 10);
}
const A_ID = nid('110170012345'), B_ID = nid('110170012346'), C_ID = nid('310170054321');

(async () => {
  const { page } = await T.open();
  const go = (s) => page.evaluate((s) => dispatch('go:' + s), s);
  const main = () => page.evaluate(() => document.getElementById('main').textContent);
  const toastText = () => page.evaluate(() => document.getElementById('toast').textContent);
  const printed = async (sel) => {
    await page.click(sel);
    await page.waitForSelector('#printArea.show .sheet');
    const r = await page.evaluate(() => ({ n: document.querySelectorAll('#printArea .sheet').length, text: document.getElementById('printArea').textContent }));
    await page.click('#printArea [data-act="printclose"]');
    return r;
  };
  await T.blank(page, '2026-01');

  console.log('\n[1] เพิ่มพนักงานจากหน้าจอ');
  await go('employees');
  async function addEmp(o) {
    await page.click('#main [data-act="emp:new"]');
    await page.waitForSelector('#modal.show');
    for (const k of Object.keys(o)) await page.fill('#modal [name="' + k + '"]', o[k]);
    await page.click('#modal [data-act="modal:submit"]');
  }
  await addEmp({ name: 'นายสมชาย ใจดี', dept: 'ขาย', nationalId: A_ID, salary: '50000', hired: '2025-01-01',
    address: '99 ถนนสุขุมวิท แขวงคลองเตย กรุงเทพฯ 10110', deductions: '60000', otHours: '8' });
  await T.closed(page);
  await addEmp({ name: 'นางสาวมาลี มีสุข', dept: 'บัญชี', nationalId: B_ID, salary: '30000', hired: '2026-01-20', pvdRate: '5' });
  await T.closed(page);
  await addEmp({ name: 'นายประเสริฐ ลาออก', dept: 'คลังสินค้า', nationalId: C_ID, salary: '25000', hired: '2024-03-01', left: '2026-02-15' });
  await T.closed(page);
  const emps = await page.evaluate(() => DB.employees.map((e) => e.code + '|' + e.nationalId + '|' + e.left + '|' + fmt(e.deductions)));
  ok('★ เพิ่มพนักงาน 3 คนพร้อมเลขประจำตัวประชาชน วันพ้นสภาพ และค่าลดหย่อน', emps.length === 3
    && emps[0] === 'EMP-0001|' + A_ID + '|null|60,000.00' && emps[2].indexOf('2026-02-15') > 0, emps.join(' · '));
  await addEmp({ name: 'นายเลขผิด', nationalId: '1111111111111' });
  await page.waitForTimeout(150);
  ok('เลขประจำตัวประชาชนผิดหลักที่ 13 ถูกปฏิเสธ หน้าต่างยังเปิดให้แก้', /หลักที่ 13/.test(await toastText())
    && await page.evaluate(() => document.getElementById('modal').classList.contains('show')));
  await page.click('#modal [data-act="modal:close"]');
  await page.click('#main [data-act="emp:edit:EMP-0001"]');
  await page.waitForSelector('#modal.show');
  ok('แบบฟอร์มแก้ไขแสดงค่าลดหย่อนเดิม ไม่ใช่ช่องว่าง', await page.inputValue('#modal [name="deductions"]') === '60000');
  await page.fill('#modal [name="dept"]', 'ขายและการตลาด');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  ok('★ แก้แผนกแล้วค่าลดหย่อนไม่หาย', await page.evaluate(() => DB.employees[0].dept === 'ขายและการตลาด' && DB.employees[0].deductions === M('60000')));

  console.log('\n[2] แผ่นงานเงินเดือนมกราคม');
  await go('payroll');
  const sheet = await page.evaluate(() => ({
    rows: document.querySelectorAll('#main input.pay-in[data-item="ot"]').length,
    run: !!document.querySelector('#main [data-act="run:payroll"]'),
    prorate: /ทำงาน 12 จาก 31 วัน/.test(document.getElementById('main').textContent),
    bSalary: document.querySelector('[data-pc="R|2026-01|EMP-0002|salary"]').textContent,
  }));
  ok('★ แผ่นงานมีทั้ง 3 คน คนเข้า 20 ม.ค. คิดเงินเดือนตามสัดส่วน 11,612.90', sheet.rows === 3 && sheet.run && sheet.prorate && sheet.bSalary === '11,612.90', sheet.bSalary);
  await page.fill('#main input.pay-in[data-emp="EMP-0001"][data-item="ot"]', '10');
  await page.press('#main input.pay-in[data-emp="EMP-0001"][data-item="ot"]', 'Tab');
  await page.waitForTimeout(150);
  /* 50,000 ÷ 30 ÷ 8 × 1.5 × 10 ชม. = 3,125 */
  ok('★ กรอกค่าล่วงเวลาในตาราง ตัวเลขในแถวคำนวณใหม่ทันที (53,125.00)',
    await page.textContent('[data-pc="R|2026-01|EMP-0001|gross"]') === '53,125.00', await page.textContent('[data-pc="R|2026-01|EMP-0001|gross"]'));
  await page.selectOption('#main select[data-head="payFrom"]', '1114');
  await page.fill('#main input[data-head="payDate"]', '2026-01-30');
  await page.press('#main input[data-head="payDate"]', 'Tab');
  await page.waitForTimeout(150);
  ok('เลือกวันจ่ายและบัญชีที่จ่ายบนแผ่นงานได้', await page.evaluate(() => {
    const d = payDraftFind('R|2026-01'); return d && d.payFrom === '1114' && d.payDate === '2026-01-30'; }));
  await page.click('#main [data-act="payline:R|2026-01:EMP-0002"]');
  await page.waitForSelector('#modal.show');
  ok('หน้าต่างรายการของพนักงานอธิบายที่มาของภาษีงวดนี้', /ภาษีทั้งปีโดยประมาณ/.test(await page.textContent('#modal')));
  await page.fill('#modal [name="pi_allowance"]', '1000');
  await page.fill('#modal [name="pi_reimburse"]', '500');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  await page.click('#main [data-act="run:payroll"]');
  await page.waitForTimeout(250);
  const jan = await page.evaluate(() => {
    const r = DB.docs.payRun.find((x) => x.period === '2026-01' && x.kind === 'regular');
    const je = r && DB.entries.find((e) => e.no === r.entryNo);
    const s = (c) => r.slips.find((x) => x.code === c);
    return r && { no: r.no, date: je.date, bank: je.lines.some((l) => l.acc === '1114' && l.cr === r.net),
      aOt: s('EMP-0001').ot, bSal: s('EMP-0002').salary, bAllow: s('EMP-0002').taxable, bReimb: s('EMP-0002').reimburse,
      rows: DB.taxTx.filter((t) => t.runNo === r.no).map((t) => t.taxId).join(','),
      voidBtn: !!document.querySelector('#main [data-act="voidrun:payroll:' + r.no + '"]') };
  });
  ok('★ ทำเงินเดือนจากแผ่นงาน: ลงบัญชีวันที่ 30 ม.ค. จ่ายจากบัญชี 1114', jan && jan.date === '2026-01-30' && jan.bank, jan && jan.no);
  ok('ค่าล่วงเวลา 3,125 · เงินเดือนตามสัดส่วน 11,612.90 + ค่าตำแหน่ง 1,000 · คืนค่าใช้จ่าย 500',
    jan.aOt === 31250000 && jan.bSal === 116129000 && jan.bAllow === 126129000 && jan.bReimb === 5000000);
  ok('★ ภ.ง.ด.1 แยกรายคนพร้อมเลขประจำตัวประชาชน', jan.rows.split(',').indexOf(A_ID) >= 0, jan.rows);
  ok('หลังทำเงินเดือนแสดงงวดที่จ่ายพร้อมปุ่มยกเลิก', jan.voidBtn);
  const slip = await printed('#main [data-act="printdoc:payslip:' + jan.no + '/EMP-0001"]');
  ok('★ พิมพ์สลิปเงินเดือนรายคนได้', slip.n === 1 && /ใบแจ้งเงินเดือน/.test(slip.text) && /นายสมชาย ใจดี/.test(slip.text) && /53,125.00/.test(slip.text));
  const slips = await printed('#main [data-act="printdoc:payslips:' + jan.no + '"]');
  ok('พิมพ์สลิปทุกคนในงวดได้ หนึ่งหน้าต่อคน', slips.n === 3, slips.n + ' หน้า');

  console.log('\n[3] โบนัสจ่ายนอกรอบในเดือนเดียวกัน');
  await page.click('#main [data-act="paydraft:new"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('#modal [name="ocType"]', 'bonus');
  await page.fill('#modal [name="ocLabel"]', 'โบนัสพิเศษต้นปี');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  const bonusInput = '#main input.pay-in[data-draft="X|2026-01|1"][data-emp="EMP-0001"][data-item="bonus"]';
  ok('สร้างแผ่นงานโบนัสแล้วมีช่องกรอกโบนัสของแต่ละคน', !!(await page.$(bonusInput)));
  await page.fill(bonusInput, '100000');
  await page.press(bonusInput, 'Tab');
  await page.waitForTimeout(150);
  await page.click('#main [data-act="paypost:X|2026-01|1"]');
  await page.waitForTimeout(250);
  const bonus = await page.evaluate(() => {
    const r = DB.docs.payRun.find((x) => x.kind === 'offcycle');
    return r && { label: r.label, count: r.count, pit: r.slips[0].pit, sso: r.slips[0].sso, runs: DB.docs.payRun.filter((x) => x.period === '2026-01').length,
      tax: DB.taxTx.filter((t) => t.period === '2026-01' && t.empCode === 'EMP-0001' && !t.void).length };
  });
  ok('★ จ่ายโบนัสนอกรอบเฉพาะคนที่มีจำนวนเงิน หักภาษีส่วนเพิ่ม ไม่คิดประกันสังคม', bonus && bonus.count === 1 && bonus.pit > 0 && bonus.sso === 0
    && bonus.label === 'โบนัสพิเศษต้นปี', bonus && 'ภาษี ' + bonus.pit / 10000);
  ok('เดือนเดียวกันมีสองรอบ และ ภ.ง.ด.1 มีสองรายการของคนเดียวกัน', bonus.runs === 2 && bonus.tax === 2);

  console.log('\n[4] ภ.ง.ด.1 · สปส.1-10 · นำส่ง');
  await go('payrollfile');
  const file = await main();
  ok('หน้ารายเดือนแสดงเลขประจำตัวประชาชนใน ภ.ง.ด.1 และ สปส.1-10', file.indexOf(A_ID) >= 0 && file.indexOf(B_ID) >= 0 && /สปส.1-10/.test(file));
  const att = await printed('#main [data-act="printdoc:pnd1Attach:2026-01"]');
  ok('★ พิมพ์ใบแนบ ภ.ง.ด.1 มีรายคนพร้อมเลขประจำตัว', /ใบแนบ ภ.ง.ด.1/.test(att.text) && att.text.indexOf(A_ID) >= 0 && /นางสาวมาลี มีสุข/.test(att.text));
  const sso = await printed('#main [data-act="printdoc:sso110:2026-01"]');
  ok('★ พิมพ์ สปส.1-10 ได้ ยอดรวมเงินสมทบถูกต้อง', /สปส.1-10/.test(sso.text) && await page.evaluate(() => {
    const m = ssoMonth('2026-01'); return m.totals.count === 3 && m.totals.total === m.totals.sso * 2; }));
  const csv = await page.evaluate(() => exportCsv(document.querySelectorAll('#main .card')[1]));
  ok('ส่งออกตาราง สปส.1-10 เป็น CSV ได้', csv.indexOf('นางสาวมาลี มีสุข') > 0 && csv.indexOf(B_ID) > 0);
  await page.click('#main [data-act="payremit:sso"]');
  await page.waitForSelector('#modal.show');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  await page.click('#main [data-act="payremit:pvd"]');
  await page.waitForSelector('#modal.show');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  const rem = await page.evaluate(() => ({ n: DB.docs.payRemit.length, sso: balBySub(['sso_payable'], '2026-02-28'), pvd: balBySub(['pvd_payable'], '2026-02-28'),
    dates: DB.docs.payRemit.map((x) => x.date).join(',') }));
  ok('★ นำส่งประกันสังคมและกองทุนสำรองฯ แล้วยอดค้างนำส่งเป็นศูนย์', rem.n === 2 && rem.sso === 0 && rem.pvd === 0, rem.dates);
  await go('pnd');
  ok('หน้ายื่น ภ.ง.ด.1 แสดงชื่อพนักงานรายคน ไม่ใช่ "พนักงาน 3 คน"', /นายสมชาย ใจดี/.test(await main()) && !/พนักงาน \d+ คน/.test(await main()));

  console.log('\n[5] กุมภาพันธ์: คนลาออกกลางเดือน ยกเลิกแล้วทำใหม่');
  await page.selectOption('#periodSel', '2026-02');
  await go('payroll');
  ok('คนลาออก 15 ก.พ. คิดเงินเดือน 15 จาก 28 วัน', /ทำงาน 15 จาก 28 วัน/.test(await main())
    && await page.textContent('[data-pc="R|2026-02|EMP-0003|salary"]') === '13,392.86');
  await page.click('#main [data-act="run:payroll"]');
  await page.waitForTimeout(250);
  await page.click('#main [data-act^="voidrun:payroll:"]');
  await page.waitForSelector('#modal.show');
  await page.fill('#modal [name="reason"]', 'ลืมใส่ค่าล่วงเวลาของสมชาย');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  ok('★ ยกเลิกงวดแล้วแผ่นงานกลับมาให้แก้ พร้อมประวัติการยกเลิก', await page.evaluate(() =>
    !!document.querySelector('#main [data-act="run:payroll"]') && /เคยทำแล้วยกเลิก/.test(document.getElementById('main').textContent)
    && DB.taxTx.filter((t) => t.period === '2026-02').every((t) => t.void)));
  await page.fill('#main input.pay-in[data-emp="EMP-0001"][data-item="ot"]', '4');
  await page.click('#main [data-act="run:payroll"]');
  await page.waitForTimeout(250);
  ok('★ แก้แล้วทำใหม่ได้ทันที ค่าที่พิมพ์ค้างในช่องถูกเก็บก่อนลงบัญชี (ค่าล่วงเวลา 4 ชม. = 1,250)', await page.evaluate(() => {
    const r = DB.docs.payRun.find((x) => x.period === '2026-02' && x.status !== 'void');
    return !!r && r.slips.find((s) => s.code === 'EMP-0001').ot === M('1250') && r.slips.find((s) => s.code === 'EMP-0003').salary === M('13392.86'); }));
  await page.selectOption('#periodSel', '2026-03');
  await go('close');
  await page.click('#main [data-act="run:payroll"]');
  await page.waitForTimeout(200);
  ok('ปุ่มทำเงินเดือนจากหน้าปิดงวดพาไปตรวจแผ่นงานก่อน ไม่ลงบัญชีทันที', await page.evaluate(() =>
    STATE.screen === 'payroll' && !DB.docs.payRun.some((r) => r.period === '2026-03')));
  ok('คนที่ลาออกแล้วไม่อยู่ในแผ่นงานมีนาคม', await page.evaluate(() => !document.querySelector('[data-pc="R|2026-03|EMP-0003|salary"]')
    && !!document.querySelector('[data-pc="R|2026-03|EMP-0001|salary"]')));
  const otCell = '#main input.pay-in[data-emp="EMP-0001"][data-item="ot"]';
  ok('แผ่นงานตั้งต้นค่าล่วงเวลาประจำ 8 ชม. จากทะเบียน (2,500)', await page.inputValue(otCell) === '8'
    && await page.textContent('[data-pc="R|2026-03|EMP-0001|gross"]') === '52,500.00');
  await page.fill(otCell, '');
  await page.press(otCell, 'Tab');
  await page.waitForTimeout(150);
  ok('★ ลบช่องค่าล่วงเวลาจนว่าง = ไม่จ่ายค่าล่วงเวลาเดือนนี้ (ไม่ย้อนกลับไปใช้ค่าประจำ)',
    await page.textContent('[data-pc="R|2026-03|EMP-0001|gross"]') === '50,000.00'
    && await page.evaluate(() => payDraftFind('R|2026-03').lines['EMP-0001'].ot === 0));

  console.log('\n[6] สรุปทั้งปี · ภ.ง.ด.1ก · 50 ทวิ');
  await go('payrollyear');
  const y = await page.evaluate(() => payrollYear(2026));
  ok('สรุปทั้งปีมีทั้ง 3 คน', y.rows.length === 3 && /ภ.ง.ด.1ก/.test(await main()));
  const k = await printed('#main [data-act="printdoc:pnd1k:2026"]');
  ok('★ พิมพ์ ภ.ง.ด.1ก มีที่อยู่และเลขประจำตัว', /ใบแนบ ภ.ง.ด.1ก/.test(k.text) && k.text.indexOf(A_ID) >= 0 && /ถนนสุขุมวิท/.test(k.text));
  const cert = await printed('#main [data-act="printdoc:empCert:EMP-0001/2026"]');
  const aYear = y.rows.find((r) => r.code === 'EMP-0001');
  ok('★ พิมพ์ 50 ทวิ พนักงาน 2 ฉบับ เงินได้และภาษีทั้งปีตรงกับสรุป', cert.n === 2 && /หนังสือรับรองการหักภาษี ณ ที่จ่าย/.test(cert.text)
    && cert.text.indexOf(await page.evaluate((v) => fmt(v), aYear.income)) >= 0 && cert.text.indexOf(await page.evaluate((v) => fmt(v), aYear.tax)) >= 0,
    'เงินได้ ' + aYear.income / 10000 + ' ภาษี ' + aYear.tax / 10000);
  const all = await printed('#main [data-act="printdoc:empCerts:2026"]');
  ok('พิมพ์ 50 ทวิ ทุกคนในครั้งเดียว', all.n === 6, all.n + ' หน้า');
  ok('งบทดลองสมดุลและยอดคุมผ่านหลังทุกขั้นตอน', await page.evaluate(() =>
    trialBalance('2026-01-01', '2026-12-31').balanced && reconciliationChecks('2026-02-28').allPassed));
  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
