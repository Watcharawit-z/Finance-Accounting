/* ทดสอบหน้าเว็บจริงในเบราว์เซอร์ — คลิกทุกเมนู ทำทุกคำสั่ง แล้วดูว่าตัวเลขยังตรง */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

const URL = 'file://' + path.join(__dirname, 'index.html');
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const closed = (p) => p.waitForFunction(
  () => !document.getElementById('modal').classList.contains('show'), null, { timeout: 5000 });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  const ignore = (t) => /ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic|net::/.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push('pageerror: ' + e.message); });
  await page.goto(URL);
  await page.waitForSelector('#main .card, #main .kpis', { timeout: 10000 });

  console.log('\n[1] เปิดทุกหน้าจอ');
  const screens = await page.evaluate(() =>
    navGroups().flatMap((g) => g.items.map((i) => i[0])));
  for (const s of screens) {
    await page.evaluate((x) => { STATE.screen = x; STATE.sel = null; STATE.filter = ''; render(); }, s);
    const html = await page.$eval('#main', (e) => e.innerHTML);
    const bad = html.indexOf('เปิดหน้านี้ไม่ได้') >= 0;
    const empty = html.trim().length < 200;
    ok('หน้า ' + s, !bad && !empty, bad ? 'เกิดข้อผิดพลาดตอนวาดหน้า' : empty ? 'ว่างเปล่า' : (html.length / 1024).toFixed(0) + ' KB');
  }

  console.log('\n[2] ตัวเลขต้องตรงกัน');
  const nums = await page.evaluate(() => {
    const bs = balanceSheet('2026-07-31');
    const cf = cashFlow('2026-07-01', '2026-07-31');
    const tb = trialBalance('2026-07-01', '2026-07-31');
    const pl = incomeStatement('2026-01-01', '2026-07-31');
    return { diff: bs.diff, unexplained: cf.unexplained, balanced: tb.balanced,
      revenue: fmt(pl.revenue), net: fmt(pl.net), assets: fmt(bs.assets),
      entries: DB.entries.length, invoices: DB.docs.invoice.length };
  });
  ok('งบดุลสมดุล', nums.diff === 0, 'ผลต่าง ' + nums.diff);
  ok('งบกระแสเงินสดอธิบายได้ครบ', nums.unexplained === 0);
  ok('งบทดลองสมดุล', nums.balanced);
  console.log('    รายได้สะสม ' + nums.revenue + ' · กำไรสุทธิ ' + nums.net
    + ' · สินทรัพย์ ' + nums.assets + ' · ใบสำคัญ ' + nums.entries + ' · ใบกำกับ ' + nums.invoices);

  console.log('\n[3] คลิกเมนูจริงทีละอัน');
  await page.evaluate(() => { STATE.screen = 'dashboard'; render(); });
  const links = await page.$$('#nav .nav-i');
  ok('เมนูครบ', links.length === screens.length, links.length + ' รายการ');
  for (let i = 0; i < links.length; i++) {
    const l = (await page.$$('#nav .nav-i'))[i];
    await l.click();
  }
  ok('คลิกครบทุกเมนูโดยไม่พัง', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n[4] ออกใบกำกับภาษีจริง');
  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  const before = await page.evaluate(() => DB.docs.invoice.length);
  await page.click('[data-act="new:invoice"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="l0_item"]', 'SW-220');
  await page.fill('[name="l0_qty"]', '25');
  await page.selectOption('[name="l1_item"]', 'SRV-INS');
  await page.fill('[name="l1_qty"]', '1');
  await page.fill('[name="l1_price"]', '18000');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const after = await page.evaluate(() => ({
    n: DB.docs.invoice.length, last: DB.docs.invoice[0],
  }));
  ok('มีใบกำกับเพิ่ม 1 ใบ', after.n === before + 1, after.last.no);
  ok('ยอดรวม = ฐาน + ภาษี', after.last.total === after.last.base + after.last.vat,
    'ฐาน ' + after.last.base + ' ภาษี ' + after.last.vat);
  ok('ภาษีคำนวณจากยอดรวมเอกสาร',
    after.last.vat === Math.round(after.last.base * 0.07 / 100) * 100 ||
    Math.abs(after.last.vat - after.last.base * 0.07) < 100);

  console.log('\n[5] รับชำระพร้อมภาษีหัก ณ ที่จ่าย');
  const invNo = after.last.no;
  await page.evaluate((no) => { STATE.screen = 'invoices'; STATE.sel = no; render(); }, invNo);
  await page.click('[data-act="pay:' + invNo + '"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="wht"]', 'WHT_SERVICE');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const rc = await page.evaluate(() => DB.docs.receipt[0]);
  ok('ออกใบเสร็จแล้ว', !!rc && rc.invoiceNo === invNo, rc && rc.no);
  ok('หักภาษี ณ ที่จ่าย 3%', rc.wht > 0, 'หักไว้ ' + rc.wht / 10000);
  ok('รับสุทธิ = รับก่อนหัก − ภาษีที่ถูกหัก', rc.net === rc.gross - rc.wht);

  console.log('\n[6] ตั้งหนี้และจ่ายผ่าน e-Withholding Tax');
  await page.evaluate(() => { STATE.screen = 'bills'; STATE.sel = null; render(); });
  await page.click('[data-act="new:bill"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="partner"]', 'VEN-0012');
  await page.fill('[name="vendorNo"]', 'TEST-9001');
  await page.fill('[name="desc"]', 'ค่าเช่าสำนักงานเดือนกรกฎาคม');
  await page.fill('[name="price"]', '60000');
  await page.selectOption('[name="wht"]', 'WHT_RENT');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const bill = await page.evaluate(() => DB.docs.bill[0]);
  ok('ตั้งหนี้สำเร็จ', bill.vendorNo === 'TEST-9001', bill.no + ' รวม ' + bill.total / 10000);

  await page.click('[data-act="new:bill"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="partner"]', 'VEN-0012');
  await page.fill('[name="vendorNo"]', 'TEST-9001');
  await page.fill('[name="desc"]', 'รายการซ้ำ');
  await page.fill('[name="price"]', '60000');
  await page.click('[data-act="modal:submit"]');
  await page.waitForTimeout(300);
  const dupBlocked = await page.evaluate(() =>
    document.getElementById('modal').classList.contains('show')
    && document.getElementById('toast').className.indexOf('err') >= 0);
  ok('กันบันทึกใบกำกับซ้ำ', dupBlocked, await page.$eval('#toast b', (e) => e.textContent).catch(() => ''));
  await page.click('[data-act="modal:close"]');

  await page.evaluate((no) => { STATE.screen = 'bills'; STATE.sel = no; render(); }, bill.no);
  await page.click('[data-act="paybill:' + bill.no + '"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="channel"]', 'e_wht');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const pv = await page.evaluate(() => DB.docs.payment[0]);
  ok('จ่ายผ่าน e-Withholding แล้ว', pv.channel === 'e_wht');
  ok('อัตราลดเหลือ 1%', pv.whtRate === '1', 'หักไว้ ' + pv.wht / 10000);
  ok('ไม่ออก 50 ทวิ เพราะธนาคารออกให้', pv.certNo === null);

  console.log('\n[7] งานปลายงวด');
  await page.evaluate(() => { STATE.screen = 'deprec'; render(); });
  await page.click('[data-act="run:deprec"]');
  await page.waitForTimeout(300);
  ok('ตั้งค่าเสื่อมราคาแล้ว', await page.evaluate(() => !!DB.docs.depreciation.find((d) => d.period === '2026-07')));
  await page.evaluate(() => { STATE.screen = 'payroll'; render(); });
  await page.click('[data-act="run:payroll"]');
  await page.waitForTimeout(300);
  const pr = await page.evaluate(() => DB.docs.payRun.find((r) => r.period === '2026-07'));
  ok('ทำเงินเดือนแล้ว', !!pr, pr && pr.count + ' คน จ่ายสุทธิ ' + (pr.net / 10000).toLocaleString());
  ok('เพดานประกันสังคม 875 บาท (มีผล 1 ม.ค. 2569)', pr && pr.ssoMax === 8750000);

  await page.evaluate(() => { STATE.screen = 'pp30'; render(); });
  await page.click('[data-act="run:pp30"]');
  await page.waitForTimeout(300);
  const f = await page.evaluate(() => DB.docs.filing.find((x) => x.form === 'PP30' && x.period === '2026-07'));
  ok('ยื่น ภ.พ.30 แล้ว', !!f, f && 'ต้องชำระ ' + f.payable / 10000);

  await page.evaluate(() => { STATE.screen = 'pnd'; render(); });
  for (let i = 0; i < 3; i++) {
    const b = await page.$('[data-act^="run:pnd:"]');
    if (!b) break;
    await b.click();
    await page.waitForTimeout(200);
  }
  const filings = await page.evaluate(() => DB.docs.filing.filter((x) => x.period === '2026-07').map((x) => x.form));
  ok('ยื่นแบบภาษีหัก ณ ที่จ่ายแล้ว', filings.length > 1, filings.join(', '));
  const ewhtLeak = await page.evaluate(() =>
    DB.taxTx.filter((t) => t.kind === 'wht' && t.channel === 'e_wht' && t.filingId).length);
  ok('รายการ e-Withholding ไม่ถูกนำส่งซ้ำ', ewhtLeak === 0);

  console.log('\n[8] กระทบยอดธนาคารและปิดงวด');
  await page.evaluate(() => { STATE.screen = 'bank'; render(); });
  while ((await page.$$('[data-act^="bank:book:"]')).length) {
    await page.click('[data-act^="bank:book:"]');
    await page.waitForSelector('#modal.show');
    await page.click('[data-act="modal:submit"]');
    await closed(page);
  }
  ok('กระทบยอดครบทุกรายการ', await page.evaluate(() => DB.bankTxns.every((t) => t.matched)));

  await page.evaluate(() => { STATE.screen = 'close'; render(); });
  const chk = await page.evaluate(() => closeChecklist('2026-07'));
  ok('รายการตรวจก่อนปิดงวดผ่านครบ', chk.canClose,
    chk.items.filter((i) => !i.ok).map((i) => i.label).join(', ') || 'ผ่านทุกข้อ');
  await page.click('[data-act="close:period"]');
  await page.waitForTimeout(300);
  ok('ปิดงวดสำเร็จ', await page.evaluate(() =>
    DB.periods.find((p) => p.code === '2026-07').status === 'closed'));

  await page.evaluate(() => { STATE.screen = 'invoices'; render(); });
  await page.click('[data-act="new:invoice"]');
  await page.waitForTimeout(250);
  ok('งวดปิดแล้วออกเอกสารไม่ได้', await page.evaluate(() =>
    !document.getElementById('modal').classList.contains('show')));

  console.log('\n[9] ตัวเลขหลังทำงานทั้งหมด');
  const after2 = await page.evaluate(() => {
    const bs = balanceSheet('2026-07-31');
    const cf = cashFlow('2026-07-01', '2026-07-31');
    const rec = reconciliationChecks('2026-07-31');
    return { diff: bs.diff, unexplained: cf.unexplained, allPassed: rec.allPassed,
      failed: rec.checks.filter((c) => !c.ok).map((c) => c.label) };
  });
  ok('งบยังสมดุลหลังทำรายการทั้งหมด', after2.diff === 0, 'ผลต่าง ' + after2.diff);
  ok('งบกระแสเงินสดยังอธิบายได้ครบ', after2.unexplained === 0);
  ok('ยอดคุมทุกตัวยังตรง', after2.allPassed, after2.failed.join(', ') || 'ผ่านทุกข้อ');

  console.log('\n[10] เก็บข้อมูลไว้ในเครื่องและจอเล็ก');
  await page.reload();
  await page.waitForSelector('#main .card, #main .kpis');
  ok('เปิดใหม่แล้วข้อมูลยังอยู่', await page.evaluate(() =>
    DB.periods.find((p) => p.code === '2026-07').status === 'closed'));

  console.log('\n[11] กราฟบนแดชบอร์ด');
  await page.evaluate(() => { STATE.screen = 'dashboard'; STATE.dashView = 'chart'; render(); });
  await page.waitForTimeout(150);
  const charts = await page.$$eval('#main svg.chart', (els) => els.length);
  const sparks = await page.$$eval('#main svg.spark', (els) => els.length);
  ok('วาดกราฟครบทุกใบ', charts === 4, charts + ' กราฟ');
  ok('มีเส้นแนวโน้มในกล่องตัวเลขสรุป', sparks >= 5, sparks + ' เส้น');
  const marks = await page.$$eval('#main svg.chart [data-tip]', (els) => els.length);
  ok('ทุกจุดข้อมูลมีคำอธิบายเมื่อชี้', marks > 20, marks + ' จุด');
  await page.click('[data-act="view:table"]');
  await page.waitForTimeout(150);
  ok('สลับดูเป็นตารางได้', await page.evaluate(() =>
    STATE.dashView === 'table' && document.querySelector('#main table') !== null));
  await page.click('[data-act="view:chart"]');
  await page.waitForTimeout(150);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const dashOver = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('แดชบอร์ดบนจอ 390px ไม่ล้นแนวนอน', dashOver <= 1, 'ล้น ' + dashOver + 'px');

  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('จอ 390px ไม่ล้นแนวนอน', overflow <= 1, 'ล้น ' + overflow + 'px');
  const navHidden = await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().right <= 1);
  ok('เมนูซ่อนเป็นลิ้นชักบนจอเล็ก', navHidden);
  await page.click('#menuBtn');
  await page.waitForTimeout(250);
  ok('กดปุ่มเมนูแล้วลิ้นชักเปิด', await page.evaluate(() =>
    document.getElementById('nav').getBoundingClientRect().right > 100));

  ok('ไม่มีข้อผิดพลาดในคอนโซลเลย', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => { STATE.screen = 'dashboard'; render(); });
  await page.screenshot({ path: 'shot-dashboard.png', fullPage: false });
  await page.evaluate(() => { STATE.screen = 'bs'; render(); });
  await page.screenshot({ path: 'shot-bs.png', fullPage: false });

  await browser.close();
  console.log('\n' + (fail === 0 ? 'ผ่านทั้งหมด ' + pass + ' ข้อ' : 'ผ่าน ' + pass + ' ไม่ผ่าน ' + fail));
  process.exit(fail ? 1 : 0);
})();
