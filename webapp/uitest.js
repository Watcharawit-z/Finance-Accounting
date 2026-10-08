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

const fmtT = (v) => (v / 10000).toLocaleString();

/** หาว่าอะไรกันแน่ที่ทำให้หน้าจอล้นแนวนอน จะได้ไม่ต้องเดา */
const overflowInfo = (page) => page.evaluate(() => {
  const cw = document.documentElement.clientWidth;
  const over = document.documentElement.scrollWidth - cw;
  if (over <= 1) return { over, who: '' };
  let worst = null;
  document.querySelectorAll('body *').forEach(function (el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= cw + 0.5) return;
    const scrollable = el.closest('.scroll');
    if (scrollable && scrollable !== el) return;      // อยู่ในกล่องที่เลื่อนได้ ไม่นับ
    if (!worst || r.right > worst.right) {
      worst = { right: Math.round(r.right),
        tag: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
        text: (el.textContent || '').trim().slice(0, 30) };
    }
  });
  return { over, who: worst ? worst.tag + ' (' + worst.text + ') ขวาสุด ' + worst.right : 'ไม่พบตัวการ' };
});

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errors = [];
  page.on('dialog', (d) => d.accept());   // ยอมรับกล่องยืนยันทุกครั้ง ไม่ต้องลุ้นจังหวะ
  const ignore = (t) => /ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|fonts\.googleapis|fonts\.gstatic|net::/.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !ignore(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => { if (!ignore(e.message)) errors.push('pageerror: ' + e.message); });
  await page.goto(URL);
  await page.waitForSelector('#main .card, #main .kpis', { timeout: 10000 });

  console.log('\n[1] เปิดทุกหน้าจอ');
  const screens = await page.evaluate(() => navScreens());
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
  await page.evaluate(() => {
    navGroups().forEach((g) => {
      STATE.navGroupOpen[g.g] = true;
      (g.subs || []).forEach((s) => { STATE.navOpen[s.s] = true; });
    });
    render();
  });
  const links = await page.$$('#nav .nav-i');
  ok('เมนูครบทุกหน้าเมื่อกางหมวดย่อยหมด', links.length === screens.length,
    links.length + ' / ' + screens.length + ' รายการ');
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
  const dashOver = await overflowInfo(page);
  ok('แดชบอร์ดบนจอ 390px ไม่ล้นแนวนอน', dashOver.over <= 1, 'ล้น ' + dashOver.over + 'px · ' + dashOver.who);

  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  await page.waitForTimeout(200);
  const overflow = await overflowInfo(page);
  ok('จอ 390px ไม่ล้นแนวนอน', overflow.over <= 1, 'ล้น ' + overflow.over + 'px · ' + overflow.who);
  const navHidden = await page.evaluate(() => document.getElementById('nav').getBoundingClientRect().right <= 1);
  ok('เมนูซ่อนเป็นลิ้นชักบนจอเล็ก', navHidden);
  await page.click('#menuBtn');
  await page.waitForTimeout(250);
  ok('กดปุ่มเมนูแล้วลิ้นชักเปิด', await page.evaluate(() =>
    document.getElementById('nav').getBoundingClientRect().right > 100));

  console.log('\n[12] บอกให้ชัดว่านี่คือข้อมูลตัวอย่าง');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => { STATE.screen = 'dashboard'; render(); });
  await page.waitForTimeout(150);
  ok('ธงข้อมูลตัวอย่างถูกตั้งไว้', await page.evaluate(() => DB.isDemo === true));
  ok('★ แดชบอร์ดเตือนว่าเป็นข้อมูลตัวอย่าง', await page.$('#main .demo-note') !== null);
  ok('แถบบนมีป้ายพร้อมทางออกไปเริ่มของจริง', await page.$eval('#coName .demo-tag',
    (e) => e.textContent.indexOf('เริ่มใช้ของจริง') > 0).catch(() => false));
  ok('ปุ่มในแถบเตือนพาไปตั้งบริษัทเปล่าได้', await page.$('.demo-note [data-act="blank:new"]') !== null);

  console.log('\n[13] นำเข้าข้อมูลจากระบบเดิม');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.waitForTimeout(150);
  ok('มีหน้านำเข้าข้อมูลและพื้นที่ลากไฟล์', await page.$('#drop') !== null);

  /* สร้างบริษัทเปล่าเพื่อไม่ให้ข้อมูลจริงปนกับข้อมูลตัวอย่าง */
  await page.click('[data-act="blank:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="coname"]', 'บริษัท ทดสอบย้ายข้อมูล จำกัด');
  await page.fill('[name="cotax"]', '0105548021442');
  await page.fill('[name="coyear"]', '2026');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const blank = await page.evaluate(() => ({
    name: DB.company.name, entries: DB.entries.length, accounts: DB.accounts.length,
    invoices: DB.docs.invoice.length, periods: DB.periods.length, isDemo: DB.isDemo,
  }));
  ok('★ เริ่มบริษัทเปล่าแล้วธงข้อมูลตัวอย่างถูกปลด', blank.isDemo === false);
  await page.evaluate(() => { STATE.screen = 'dashboard'; render(); });
  await page.waitForTimeout(120);
  ok('แถบเตือนหายไปเมื่อเป็นข้อมูลจริงแล้ว', await page.$('#main .demo-note') === null);
  ok('ป้ายบนแถบบนหายไปด้วย', await page.$('#coName .demo-tag') === null);
  ok('แถบบนแสดงชื่อบริษัทของผู้ใช้', await page.$eval('#coName',
    (e) => e.textContent.indexOf('ทดสอบย้ายข้อมูล') >= 0));
  await page.evaluate(() => { STATE.screen = 'import'; render(); });
  await page.waitForTimeout(120);
  ok('สร้างบริษัทเปล่าได้', blank.entries === 0 && blank.invoices === 0 && blank.accounts > 60,
    blank.name + ' · ผังบัญชี ' + blank.accounts + ' บัญชี · งวด ' + blank.periods);

  /* เลขผู้เสียภาษีผิดต้องถูกปฏิเสธ */
  await page.click('[data-act="blank:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="coname"]', 'บริษัท เลขผิด จำกัด');
  await page.fill('[name="cotax"]', '1234567890123');
  await page.click('[data-act="modal:submit"]');
  await page.waitForTimeout(300);
  ok('เลขผู้เสียภาษีผิดหลักที่ 13 ถูกปฏิเสธ', await page.evaluate(() =>
    document.getElementById('modal').classList.contains('show')
    && document.getElementById('toast').className.indexOf('err') >= 0));
  await page.click('[data-act="modal:close"]');

  /* อ่านไฟล์ .xlsx จริง — สร้างไฟล์ zip แบบไม่บีบอัดขึ้นมาในเบราว์เซอร์ */
  await page.evaluate(() => {
    function crc32(b) {
      let c, t = [];
      for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
      let x = 0xFFFFFFFF;
      for (let i = 0; i < b.length; i++) x = t[(x ^ b[i]) & 0xFF] ^ (x >>> 8);
      return (x ^ 0xFFFFFFFF) >>> 0;
    }
    function zip(files) {
      const enc = new TextEncoder(), parts = [], central = [];
      let off = 0;
      files.forEach(function (f) {
        const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(8, 0, true);
        lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
        lh.setUint16(26, name.length, true);
        parts.push(new Uint8Array(lh.buffer), name, data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(6, 20, true); ch.setUint16(10, 0, true);
        ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
        ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
        central.push(new Uint8Array(ch.buffer), name);
        off += 30 + name.length + data.length;
      });
      const cstart = off;
      let csize = 0;
      central.forEach((c) => { csize += c.length; });
      const eo = new DataView(new ArrayBuffer(22));
      eo.setUint32(0, 0x06054b50, true);
      eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
      eo.setUint32(12, csize, true); eo.setUint32(16, cstart, true);
      return new Blob([...parts, ...central, new Uint8Array(eo.buffer)]);
    }
    const rows = [
      ['รายงานงบทดลอง', '', '', ''],
      ['รหัสบัญชี', 'ชื่อบัญชี', 'เดบิต', 'เครดิต'],
      ['1113', 'เงินฝากธนาคาร–กระแสรายวัน', '1200000', ''],
      ['1131', 'ลูกหนี้การค้า–ในประเทศ', '148730', ''],
      ['2121', 'เจ้าหนี้การค้า–ในประเทศ', '', '94160'],
      ['3120', 'ทุนที่ออกและชำระแล้ว', '', '1000000'],
      ['3310', 'กำไรสะสมยังไม่ได้จัดสรร', '', '254570'],
    ];
    const esc2 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const toSheet = (rs) => '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
      + rs.map(function (r, ri) {
          return '<row r="' + (ri + 1) + '">' + r.map(function (c, ci) {
            if (c === '') return '';
            const ref = String.fromCharCode(65 + ci) + (ri + 1);
            return /^\d+$/.test(c)
              ? '<c r="' + ref + '"><v>' + c + '</v></c>'
              : '<c r="' + ref + '" t="inlineStr"><is><t>' + esc2(c) + '</t></is></c>';
          }).join('') + '</row>';
        }).join('')
      + '</sheetData></worksheet>';
    /* ทำไฟล์ .xlsx หลายแผ่นงานได้ เพื่อทดสอบไฟล์หน้าตาแบบที่โปรแกรมอื่นส่งออกมาจริง */
    window.__mkXlsx = function (sheets, fileName) {
      const files = [{ name: '[Content_Types].xml',
        text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' }];
      sheets.forEach(function (rs, i) {
        files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', text: toSheet(rs) });
      });
      return new File([zip(files)], fileName || 'ทดสอบ.xlsx');
    };
    window.__xlsx = window.__mkXlsx([rows], 'งบทดลอง.xlsx');
  });
  await page.evaluate(() => handleFile(window.__xlsx));
  await page.waitForTimeout(400);
  const impState = await page.evaluate(() => ({
    err: STATE.imp && STATE.imp.error, rows: STATE.imp && STATE.imp.rows && STATE.imp.rows.length,
    header: STATE.imp && STATE.imp.headerRow, tb: STATE.imp && STATE.imp.tb && STATE.imp.tb.rows.length,
  }));
  ok('★ อ่านไฟล์ .xlsx ได้โดยไม่ต้องแปลงเป็น CSV ก่อน', !impState.err && impState.rows === 7,
    impState.err || impState.rows + ' แถว');
  ok('หาหัวตารางเจอแม้มีหัวรายงานคั่น', impState.header === 1, 'แถวที่ ' + (impState.header + 1));
  ok('อ่านบัญชีที่มียอดได้ครบ', impState.tb === 5, impState.tb + ' บัญชี');

  const prev = await page.evaluate(() => previewOpening(STATE.imp.tb.rows, {}));
  ok('งบทดลองสมดุลและจับคู่บัญชีได้ครบ', prev.ready && prev.unmatched.length === 0,
    'เดบิต ' + fmtT(prev.totalDr) + ' เครดิต ' + fmtT(prev.totalCr));

  await page.fill('[name="cutoff"]', '2026-07-31');
  await page.click('[data-act="imp:run"]');
  await page.waitForTimeout(400);
  const after3 = await page.evaluate(() => ({
    screen: STATE.screen, entries: DB.entries.length,
    balanced: trialBalance('2026-01-01', '2026-12-31').balanced,
    diff: balanceSheet('2026-07-31').diff,
    bank: balanceOf('1113', '2026-07-31'),
  }));
  ok('ตั้งยอดยกมาแล้ว', after3.entries === 1 && after3.screen === 'importResult');
  ok('งบทดลองสมดุลหลังตั้งยอดยกมา', after3.balanced);
  ok('งบแสดงฐานะการเงินสมดุล', after3.diff === 0, 'ผลต่าง ' + after3.diff);
  ok('ยอดเงินฝากตรงกับไฟล์', after3.bank === 12000000000, after3.bank / 10000 + ' บาท');

  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsx));
  await page.waitForTimeout(300);
  await page.fill('[name="cutoff"]', '2026-07-31');
  await page.click('[data-act="imp:run"]');
  await page.waitForTimeout(300);
  ok('★ ตั้งยอดยกมาวันเดิมซ้ำถูกปฏิเสธ', await page.evaluate(() =>
    DB.entries.length === 1 && document.getElementById('toast').className.indexOf('err') >= 0));

  /* ---- ไฟล์หน้าตาแบบที่โปรแกรมบัญชีส่งออกมาจริง ต้องไม่ตัน ---- */
  console.log('\n[13.1] ไฟล์งบทดลองหน้าตาแปลก ๆ ต้องนำเข้าได้');
  await page.evaluate(() => {
    /* แผ่นแรกเป็นหน้าปกเปล่า ๆ งบทดลองอยู่แผ่นที่สอง และหัวตารางกินสองบรรทัด */
    const cover = [['บริษัท ทดสอบ จำกัด'], ['รายงานประจำเดือน']];
    const tb = [
      ['รายงานงบทดลอง'],
      ['ตั้งแต่ 01/01/2569 ถึง 31/07/2569'],
      ['รหัสบัญชี', 'ชื่อบัญชี', 'ยอดยกมา', '', 'เคลื่อนไหวระหว่างงวด', '', 'ยอดคงเหลือ', ''],
      ['', '', 'เดบิต', 'เครดิต', 'เดบิต', 'เครดิต', 'เดบิต', 'เครดิต'],
      ['1113', 'เงินฝากธนาคาร–กระแสรายวัน', '900000', '', '300000', '', '1200000', ''],
      ['1131', 'ลูกหนี้การค้า–ในประเทศ', '100000', '', '48730', '', '148730', ''],
      ['2121', 'เจ้าหนี้การค้า–ในประเทศ', '', '80000', '', '14160', '', '94160'],
      ['3120', 'ทุนที่ออกและชำระแล้ว', '', '1000000', '', '', '', '1000000'],
      ['3310', 'กำไรสะสมยังไม่ได้จัดสรร', '', '200000', '', '54570', '', '254570'],
      ['รวมทั้งสิ้น', '', '1000000', '1280000', '348730', '68730', '1348730', '1348730'],
    ];
    window.__xlsx2 = window.__mkXlsx([cover, tb], 'งบทดลอง-หัวสองบรรทัด.xlsx');
  });
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsx2));
  await page.waitForTimeout(400);
  const hard = await page.evaluate(() => ({
    err: STATE.imp && STATE.imp.error,
    needsMapping: STATE.imp && STATE.imp.needsMapping,
    header: STATE.imp && STATE.imp.headerRow,
    map: STATE.imp && STATE.imp.map,
    tb: STATE.imp && STATE.imp.tb ? STATE.imp.tb.rows.length : 0,
    dr: STATE.imp && STATE.imp.tb ? STATE.imp.tb.rows.reduce((s, r) => s + r.debit, 0) : 0,
    cr: STATE.imp && STATE.imp.tb ? STATE.imp.tb.rows.reduce((s, r) => s + r.credit, 0) : 0,
  }));
  ok('★ หัวตารางกินสองบรรทัดก็อ่านออก ไม่ต้องให้ผู้ใช้ไปแก้ไฟล์',
    !hard.err && !hard.needsMapping && hard.tb === 5,
    hard.err || 'หัวแถวที่ ' + (hard.header + 1) + ' · อ่านได้ ' + hard.tb + ' บัญชี');
  ok('★ หยิบคู่ยอดคงเหลือปลายงวด ไม่ใช่คู่ยอดยกมา',
    hard.map.debit === 6 && hard.map.credit === 7 && hard.dr === hard.cr && hard.dr === 13487300000,
    'เดบิต ' + fmtT(hard.dr) + ' เครดิต ' + fmtT(hard.cr));
  ok('งบทดลองอยู่แผ่นงานที่สองก็หาเจอ', hard.tb === 5);

  /* ---- ไฟล์ที่เดาหัวตารางไม่ได้เลย ต้องพาไปจับคู่คอลัมน์เอง ไม่ใช่ขึ้นข้อความแล้วจบ ---- */
  await page.evaluate(() => {
    window.__xlsx3 = window.__mkXlsx([[
      ['ผังบัญชีและยอด'],
      ['ลำดับ', 'บช.', 'รายละเอียด', 'ยกมา', 'สิ้นงวด'],
      ['1', '1113', 'เงินฝากธนาคาร–กระแสรายวัน', '900000', '1200000'],
      ['2', '2121', 'เจ้าหนี้การค้า–ในประเทศ', '-80000', '-1200000'],
    ]], 'ไฟล์หัวตารางแปลก.xlsx');
  });
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsx3));
  await page.waitForTimeout(400);
  const odd = await page.evaluate(() => ({
    err: STATE.imp && STATE.imp.error,
    needsMapping: STATE.imp && STATE.imp.needsMapping,
    rows: STATE.imp && STATE.imp.rows ? STATE.imp.rows.length : 0,
  }));
  ok('★ ไฟล์ที่เดาไม่ออกไม่ขึ้นข้อความผิดพลาดแล้วจบ แต่พาไปจับคู่คอลัมน์',
    !odd.err && odd.needsMapping === true && odd.rows === 4, odd.err || odd.rows + ' แถว');
  ok('มีตารางให้ดูหน้าตาไฟล์จริง', await page.$('#main table.grid') !== null);
  ok('มีช่องให้เลือกว่าหัวตารางอยู่แถวไหน', await page.$('#impHeaderRow') !== null);
  ok('มีช่องเลือกคอลัมน์ครบทั้งสี่',
    (await page.$$('#main select.impcol')).length === 4);

  /* ผู้ใช้เลือกเอง: บช. = รหัส, รายละเอียด = ชื่อ, สิ้นงวด = ยอด (ติดลบคือเครดิต) */
  await page.selectOption('#impHeaderRow', '1');
  await page.waitForTimeout(150);
  await page.selectOption('#c_code', '1');
  await page.waitForTimeout(120);
  await page.selectOption('#c_name', '2');
  await page.waitForTimeout(120);
  await page.selectOption('#c_debit', '4');
  await page.waitForTimeout(120);
  await page.selectOption('#c_credit', '');
  await page.waitForTimeout(200);
  const fixed = await page.evaluate(() => ({
    tb: STATE.imp.tb ? STATE.imp.tb.rows.length : 0,
    dr: STATE.imp.tb ? STATE.imp.tb.rows.reduce((s, r) => s + r.debit, 0) : 0,
    cr: STATE.imp.tb ? STATE.imp.tb.rows.reduce((s, r) => s + r.credit, 0) : 0,
  }));
  ok('★ เลือกคอลัมน์เองแล้วอ่านตัวเลขได้ทันที', fixed.tb === 2,
    'อ่านได้ ' + fixed.tb + ' บัญชี · เดบิต ' + fmtT(fixed.dr) + ' เครดิต ' + fmtT(fixed.cr));
  ok('คอลัมน์ยอดคงเหลือคอลัมน์เดียว ยอดติดลบไปอยู่ด้านเครดิตให้เอง',
    fixed.dr === 12000000000 && fixed.cr === 12000000000);

  /* ---- ไฟล์หน้าตาเดียวกับที่ FlowAccount ส่งออกมาจริง ---- */
  await page.evaluate(() => {
    window.__xlsxFa = window.__mkXlsx([[
      ['บริษัท ตัวอย่าง จำกัด'], ['งบทดลอง'], ['สิ้นสุด ณ วันที่ 31 ธันวาคม 2569'], ['หน่วย:บาท'],
      ['', '', '', 'ยอดยกมา', '', '', 'ยอดประจำงวด', '', '', 'ยอดสะสม', '', '', 'รวมทั้งสิ้น'],
      ['บัญชี', '', '', 'เดบิต', 'เครดิต', '', 'เดบิต', 'เครดิต', '', 'เดบิต', 'เครดิต', '', ''],
      ['11122.01', 'กสิกรไทย 0762769492', '', '9739.93', '', '', '1765701.95', '1774292.75',
       '', '1149.13', '', '', '1149.13'],
      ['11511', 'สินค้าสำเร็จรูปคงเหลือ', '', '230777.7', '', '', '24561.2', '186671.9',
       '', '68667', '', '', '68667'],
      ['21311', 'เจ้าหนี้การค้า - ทั่วไป', '', '', '80000', '', '14160', '', '', '', '65840', '', '-65840'],
      ['34998', 'กำไร (ขาดทุน) สะสม - รายงาน', '', '', '160517.7', '', '', '', '', '', '4116.19', '', '-4116.19'],
      ['41110', 'รายได้จากการขายสินค้า', '', '', '', '', '', '260000', '', '', '260000', '', '-260000'],
      ['51140', 'ต้นทุนขายสินค้า', '', '', '', '', '260140.06', '', '', '260140.06', '', '', '260140.06'],
      ['', 'รวมทั้งสิ้น', '', '240517.63', '240517.7', '', '2064563.21', '2220964.65',
       '', '329956.19', '329956.19', '', '0'],
    ]], 'งบทดลอง-flowaccount.xlsx');
  });
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsxFa));
  await page.waitForTimeout(500);
  const fa = await page.evaluate(() => {
    const I = STATE.imp;
    const pr = previewOpening(I.tb.rows, I.overrides || {});
    return { err: I.error, kind: I.kind, needs: I.needsMapping, map: I.map,
      tb: I.tb.rows.length, matched: pr.matched.length, creating: pr.creating.length,
      unmatched: pr.unmatched.length, balanced: pr.balanced, ready: pr.ready };
  });
  ok('★ ไฟล์หน้าตาแบบ FlowAccount จริงอ่านออกโดยไม่ต้องตั้งค่าอะไรเลย',
    !fa.err && fa.kind === 'trialBalance' && !fa.needs && fa.tb === 6,
    fa.err || 'อ่านได้ ' + fa.tb + ' บัญชี');
  ok('★ หัวคอลัมน์เขียนแค่ "บัญชี" และช่องชื่อไม่มีหัว ก็จับคู่ถูก',
    fa.map.code === 0 && fa.map.name === 1 && fa.map.debit === 9 && fa.map.credit === 10,
    JSON.stringify(fa.map));
  ok('★ ไม่ต้องจับคู่บัญชีด้วยมือแม้แต่บรรทัดเดียว',
    fa.unmatched === 0 && fa.creating > 0 && fa.balanced && fa.ready,
    'สร้างใหม่ ' + fa.creating + ' · ตรงกับผังเดิม ' + fa.matched);
  ok('มีตารางบอกว่าบัญชีใหม่แต่ละตัวจะไปอยู่บรรทัดไหนของงบ',
    (await page.$$('#main select.impmap')).length >= fa.creating);

  await page.fill('[name="cutoff"]', '2026-12-31');
  await page.click('[data-act="imp:run"]');
  await page.waitForTimeout(600);
  const faAfter = await page.evaluate(() => ({
    screen: STATE.screen,
    created: STATE.impResult && STATE.impResult.opening ? STATE.impResult.opening.created : 0,
    balanced: trialBalance('2026-01-01', '2026-12-31').balanced,
    bsDiff: balanceSheet('2026-12-31').diff,
    kept: DB.accounts.some((a) => a.code === '11122.01' && a.subType === 'bank'),
    why: reconciliationChecks('2026-12-31').checks.filter((c) => !c.ok && c.why).length,
  }));
  ok('★ นำเข้าแล้วงบทดลองและงบแสดงฐานะการเงินยังสมดุล',
    faAfter.screen === 'importResult' && faAfter.balanced && faAfter.bsDiff === 0,
    'สร้างบัญชีใหม่ ' + faAfter.created + ' ตัว');
  ok('บัญชีใหม่เก็บรหัสเดิมและไปอยู่บรรทัดเงินฝากธนาคาร', faAfter.kept);
  ok('ยอดคุมที่ยังไม่ตรงมีคำอธิบายกำกับ ไม่ใช่ขึ้นแดงเปล่า ๆ', faAfter.why >= 1);

  /* ---- ลากไฟล์เดิมเข้ามาอีกครั้ง ต้องตรวจเทียบได้ทุกบัญชี โดยไม่ลงบัญชีซ้ำ ---- */
  const entriesBeforeVerify = await page.evaluate(() => DB.entries.length);
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsxFa));
  await page.waitForTimeout(500);
  await page.fill('[name="cutoff"]', '2026-12-31');
  await page.dispatchEvent('[name="cutoff"]', 'change');
  await page.waitForTimeout(200);
  const ver = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#main .card')];
    const vc = cards.find((c) => c.textContent.indexOf('ตรวจเทียบไฟล์นี้กับที่นำเข้าไปแล้ว') >= 0);
    const hc = cards.find((c) => c.textContent.indexOf('ตรวจสุขภาพข้อมูลที่นำเข้า') >= 0);
    return { verify: !!vc, ok: vc ? vc.querySelector('.pk-chk.ok') !== null : false,
      rows: vc ? vc.querySelectorAll('tbody tr').length : 0, health: !!hc, entries: DB.entries.length };
  });
  ok('★ ลากไฟล์เดิมเข้ามาอีกครั้ง ระบบเทียบให้ทีละบัญชี ตรงกันทุกบัญชี', ver.verify && ver.ok && ver.rows === 6, ver.rows + ' บัญชี');
  ok('การตรวจเทียบไม่ลงบัญชีอะไรเพิ่ม', ver.entries === entriesBeforeVerify);
  ok('★ หน้านำเข้ามีการ์ดตรวจสุขภาพข้อมูลที่นำเข้า', ver.health);

  /* ---- ไฟล์บัญชีแยกประเภทต้องถูกกันไว้ ---- */
  await page.evaluate(() => {
    window.__xlsxGl = window.__mkXlsx([[
      ['บัญชีแยกประเภท'],
      ['รหัสบัญชี', 'วันที่', 'สมุดรายวัน', 'เลขที่เอกสาร', 'ชื่อบัญชี', 'เดบิต', 'เครดิต', 'ยอดคงเหลือ'],
      ['11121.01', '13/01/2026', 'รายวันทั่วไป', 'JV2026010009', 'กสิกรไทย 1681027862', '10000', '', '10000'],
      ['11121.01', '14/01/2026', 'รายวันทั่วไป', 'JV2026010015', 'กสิกรไทย 1681027862', '', '10520.4', '-520.4'],
      ['11121.01', '19/01/2026', 'รายวันทั่วไป', 'JV2026010020', 'กสิกรไทย 1681027862', '800', '', '279.6'],
    ]], 'บัญชีแยกประเภท.xlsx');
  });
  const entriesBeforeGl = await page.evaluate(() => DB.entries.length);
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsxGl));
  await page.waitForTimeout(500);
  ok('★ ไฟล์บัญชีแยกประเภทถูกกันไว้ ไม่ให้นำเข้าเป็นยอดยกมา',
    (await page.evaluate(() => STATE.imp.kind)) === 'ledger'
    && (await page.$('[data-act="imp:run"]')) === null
    && (await page.evaluate(() => DB.entries.length)) === entriesBeforeGl);
  ok('บอกด้วยว่าต้องไปเอาไฟล์ไหนมาแทน',
    (await page.$eval('#main', (e) => e.textContent)).indexOf('งบทดลอง') >= 0);

  /* ---- นำเข้าผิดแล้วต้องยกเลิกได้ แล้วนำเข้าใหม่แบบรายเดือน ---- */
  console.log('\n[13.2] ยกเลิกการนำเข้าแล้วนำเข้าใหม่');
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.waitForTimeout(200);
  const hist = await page.evaluate(() => listImports().filter((i) => i.status === 'posted'));
  ok('หน้านำเข้ามีรายการที่นำเข้าไปแล้วให้เห็น', hist.length >= 1 && (await 1),
    hist.length + ' รายการ');
  ok('มีปุ่มยกเลิกการนำเข้าให้กด',
    (await page.$('[data-act="impundo:' + hist[hist.length - 1].no + '"]')) !== null);

  const undoNo = hist[hist.length - 1].no;
  const beforeUndo = await page.evaluate((n) => ({
    entries: DB.entries.length,
    total: DB.entries.find((e) => e.no === n).lines.reduce((s, l) => s + (l.dr || 0), 0),
  }), undoNo);
  await page.click('[data-act="impundo:' + undoNo + '"]');
  await page.waitForSelector('#modal.show');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const afterUndo = await page.evaluate((n) => {
    const im = listImports().find((i) => i.no === n);
    return { status: im.status, reversedBy: im.reversedBy,
      entries: DB.entries.length,
      balanced: trialBalance('2026-01-01', '2026-12-31').balanced,
      stillHasAccounts: DB.accounts.some((a) => a.imported) };
  }, undoNo);
  ok('★ ยกเลิกการนำเข้าแล้วระบบสร้างใบกลับรายการให้ ไม่ได้ลบใบเดิมทิ้ง',
    afterUndo.status === 'reversed' && !!afterUndo.reversedBy
    && afterUndo.entries === beforeUndo.entries + 1, 'ใบกลับรายการ ' + afterUndo.reversedBy);
  ok('งบทดลองยังสมดุลหลังยกเลิก', afterUndo.balanced);
  ok('บัญชีที่สร้างไว้ตอนนำเข้ายังอยู่ ไม่ต้องสร้างใหม่', afterUndo.stillHasAccounts);

  /* สลับไปโหมดยอดเคลื่อนไหว ต้องเด้งไปชุดยอดประจำงวดให้เอง */
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.evaluate(() => handleFile(window.__xlsxFa));
  await page.waitForTimeout(500);
  const pairsSeen = await page.evaluate(() => STATE.imp.pairs.map((p) => p.label));
  ok('★ ระบบอ่านออกว่าไฟล์มีตัวเลขกี่ชุด และชุดไหนคืออะไร',
    pairsSeen.join(' · ') === 'ยอดยกมา · ยอดประจำงวด · ยอดสะสม', pairsSeen.join(' · '));
  const defPair = await page.evaluate(() => ({ d: STATE.imp.map.debit, c: STATE.imp.map.credit }));
  ok('ค่าเริ่มต้นคือชุดยอดสะสม เพราะเป็นยอดคงเหลือปลายงวด',
    defPair.d === 9 && defPair.c === 10);
  await page.selectOption('#impMode', 'movement');
  await page.waitForTimeout(300);
  const movPair = await page.evaluate(() => ({ d: STATE.imp.map.debit, c: STATE.imp.map.credit,
    mode: STATE.imp.mode }));
  ok('★ เลือกโหมดยอดเคลื่อนไหว ระบบเด้งไปชุดยอดประจำงวดให้เอง',
    movPair.mode === 'movement' && movPair.d === 6 && movPair.c === 7,
    'คอลัมน์ที่ ' + (movPair.d + 1) + '/' + (movPair.c + 1));
  ok('มีช่องให้เลือกว่าเป็นยอดของเดือนไหน', (await page.$('[name="impPeriod"]')) !== null);
  ok('มีคำเตือนว่าต้องใช้ไฟล์ของเดือนนั้นเดือนเดียว',
    (await page.$eval('#main', (e) => e.textContent)).indexOf('เดือนนั้นเดือนเดียว') >= 0);
  await page.selectOption('#impMode', 'opening');
  await page.waitForTimeout(300);
  ok('สลับกลับเป็นยอดยกมา ระบบเด้งกลับไปชุดยอดสะสม',
    (await page.evaluate(() => STATE.imp.map.debit)) === 9);

  console.log('\n[14] สามบริษัทในเครื่องเดียว ข้อมูลต้องไม่ปนกัน');
  await page.evaluate(() => { STATE.screen = 'dashboard'; render(); });
  await page.waitForTimeout(150);

  /* บริษัทที่ 1 คือบริษัทเปล่าที่สร้างไว้ตอน [13] แล้วนำเข้ายอดยกมา — ออกใบกำกับให้ 1 ใบ */
  const co1 = await page.evaluate(() => ({ book: SYNC.book, name: DB.company.name }));
  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  await page.evaluate(() => {
    DB.partners.push({ code:'C-A', name:'ลูกค้าของบริษัทหนึ่ง', taxId:'0107536000234',
      address:'ที่อยู่', branch:'00000', entityType:'juristic', kind:'customer', termDays:30, active:true });
  });
  await page.click('[data-act="new:invoice"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="partner"]', 'C-A');
  await page.fill('[name="l0_desc"]', 'ขายของบริษัทหนึ่ง');
  await page.fill('[name="l0_qty"]', '1');
  await page.fill('[name="l0_price"]', '100000');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const a1 = await page.evaluate(() => ({
    invoices: DB.docs.invoice.length, entries: DB.entries.length,
    partners: DB.partners.length, rev: fmt(incomeStatement('2026-01-01','2026-12-31').revenue),
  }));
  ok('บริษัทที่ 1 มีเอกสารของตัวเอง', a1.invoices >= 1, a1.invoices + ' ใบ · รายได้ ' + a1.rev);

  /* สร้างบริษัทที่ 2 */
  await page.click('[data-act="company:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="coname"]', 'บริษัท สองสองสอง จำกัด');
  await page.fill('[name="cotax"]', '0105533001823');
  await page.fill('[name="coyear"]', '2026');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  await page.waitForTimeout(300);
  const b1 = await page.evaluate(() => ({
    book: SYNC.book, name: DB.company.name, invoices: DB.docs.invoice.length,
    entries: DB.entries.length, partners: DB.partners.length, items: DB.items.length,
    employees: DB.employees.length, taxTx: DB.taxTx.length, books: SYNC.books.length,
  }));
  ok('สร้างบริษัทที่ 2 แล้วสลับไปให้เลย', b1.name === 'บริษัท สองสองสอง จำกัด' && b1.book !== co1.book);
  ok('★ บริษัทใหม่ไม่มีเอกสารของบริษัทเดิมติดมาเลย',
    b1.invoices === 0 && b1.entries === 0 && b1.taxTx === 0,
    'ใบกำกับ ' + b1.invoices + ' · ใบสำคัญ ' + b1.entries + ' · ทะเบียนภาษี ' + b1.taxTx);
  ok('★ ทะเบียนคู่ค้า สินค้า พนักงาน ก็ไม่ติดมาด้วย',
    b1.partners === 0 && b1.items === 0 && b1.employees === 0,
    'คู่ค้า ' + b1.partners + ' · สินค้า ' + b1.items + ' · พนักงาน ' + b1.employees);
  ok('มีตัวสลับบริษัทที่แถบบน', await page.$('#bookSel') !== null);

  /* บริษัทที่ 3 */
  await page.click('[data-act="company:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="coname"]', 'บริษัท สามสามสาม จำกัด');
  await page.fill('[name="coyear"]', '2026');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  await page.waitForTimeout(300);
  ok('มีครบสามบริษัท', await page.evaluate(() => SYNC.books.length) === 3,
    (await page.evaluate(() => SYNC.books.map((b) => b.name).join(' · '))));

  /* กลับไปบริษัทที่ 1 — ข้อมูลต้องอยู่ครบเหมือนเดิม */
  await page.selectOption('#bookSel', co1.book);
  await page.waitForTimeout(600);
  const back = await page.evaluate(() => ({
    name: DB.company.name, invoices: DB.docs.invoice.length, entries: DB.entries.length,
    rev: fmt(incomeStatement('2026-01-01','2026-12-31').revenue),
    balanced: trialBalance('2026-01-01','2026-12-31').balanced,
    diff: balanceSheet('2026-12-31').diff,
  }));
  ok('★ สลับกลับบริษัทที่ 1 ข้อมูลอยู่ครบเท่าเดิม',
    back.name === co1.name && back.invoices === a1.invoices && back.entries === a1.entries,
    back.invoices + ' ใบ · ' + back.entries + ' ใบสำคัญ');
  ok('รายได้ของบริษัทที่ 1 ไม่เปลี่ยน', back.rev === a1.rev, back.rev);
  ok('งบยังสมดุลหลังสลับไปมา', back.balanced && back.diff === 0);

  /* เปิดใหม่ทั้งหน้า ต้องจำได้ว่าเปิดบริษัทไหนอยู่ */
  await page.reload();
  await page.waitForSelector('#main .kpis', { timeout: 10000 });
  const afterReload = await page.evaluate(() => ({
    name: DB.company.name, book: SYNC.book, books: SYNC.books.length,
    invoices: DB.docs.invoice.length,
  }));
  ok('★ เปิดใหม่แล้วยังอยู่บริษัทเดิมและข้อมูลครบ',
    afterReload.book === co1.book && afterReload.invoices === a1.invoices,
    afterReload.name + ' · ' + afterReload.invoices + ' ใบ');
  ok('รายชื่อบริษัทยังครบสามหลังเปิดใหม่', afterReload.books === 3);

  /* ตรวจถึงชั้นที่เก็บจริง ว่าแยกกันคนละก้อน */
  const stored = await page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('financii.books') || '[]');
    return list.map(function (b) {
      const d = JSON.parse(localStorage.getItem('financii.book.' + b.id) || 'null');
      return { id: b.id, name: b.name, invoices: d && d.DB ? d.DB.docs.invoice.length : -1 };
    });
  });
  ok('★ แต่ละบริษัทเก็บแยกคนละก้อนในเครื่อง',
    stored.length === 3 && stored.filter((s) => s.invoices > 0).length === 1,
    stored.map((s) => s.name + '=' + s.invoices).join(' · '));

  console.log('\n[15] เมนูแยกตามหมวดหมู่');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => { STATE.screen = 'dashboard'; STATE.navOpen = {}; STATE.navGroupOpen = {}; render(); });
  await page.waitForTimeout(150);
  const shortNav = await page.evaluate(() => ({
    links: document.querySelectorAll('#nav .nav-i').length,
    groups: document.querySelectorAll('#nav .nav-gh').length }));
  ok('★ เมนูสั้น: ยุบเหลือหัวกลุ่ม กางเฉพาะกลุ่มของหน้าที่เปิดอยู่',
    shortNav.links === 2 && shortNav.groups === 12, shortNav.groups + ' กลุ่ม · ' + shortNav.links + ' ลิงก์ที่เห็น');
  await page.click('#nav [data-act="navg:เอกสารขาย"]');
  await page.waitForTimeout(120);
  ok('กดหัวกลุ่มแล้วกางรายการข้างใน',
    (await page.$$('#nav .nav-i.child')).length === 7);
  await page.click('#nav [data-act="navg:เอกสารขาย"]');
  await page.evaluate(() => { STATE.navGroupOpen = { 'รายงาน': true }; render(); });
  await page.waitForTimeout(150);
  const navShape = await page.evaluate(() => navGroups().map((g) =>
    g.g + ':' + ((g.items || []).length + (g.subs || []).length)));
  ok('กลุ่มเมนูเรียงตามงานที่ทำ ไม่ใช่ตามศัพท์บัญชี',
    navShape[1].startsWith('เอกสารขาย') && navShape[2].startsWith('เอกสารซื้อ'), navShape.slice(1, 4).join(' · '));
  ok('★ รายงานทุกตัวรวมอยู่กลุ่มเดียว',
    (await page.evaluate(() => navGroups().find((g) => g.g === 'รายงาน').subs.length)) === 6,
    'หมวดย่อย ' + (await page.evaluate(() => navGroups().find((g) => g.g === 'รายงาน').subs.map((s) => s.s).join(', '))));

  const collapsed = await page.$$('#nav .nav-s');
  ok('หมวดย่อยของรายงานยุบไว้ให้กดกาง', collapsed.length === 6, collapsed.length + ' หมวด');
  const beforeOpen = (await page.$$('#nav .nav-i.sub')).length;
  await page.click('#nav .nav-s');
  await page.waitForTimeout(150);
  const afterOpen = (await page.$$('#nav .nav-i.sub')).length;
  ok('กดแล้วกางออกมาให้เห็นรายงานข้างใน', afterOpen > beforeOpen, beforeOpen + ' → ' + afterOpen);
  await page.click('#nav .nav-s.open');
  await page.waitForTimeout(150);
  ok('กดอีกทีก็ยุบกลับ', (await page.$$('#nav .nav-i.sub')).length === beforeOpen);

  await page.evaluate(() => { STATE.screen = 'tb'; STATE.navOpen = {}; STATE.navGroupOpen = {}; render(); });
  await page.waitForTimeout(150);
  ok('★ เปิดรายงานไหนอยู่ หมวดนั้นกางให้เอง',
    await page.$eval('#nav .nav-s.open', (e) => e.textContent.indexOf('บัญชี') >= 0));
  ok('รายการที่เปิดอยู่ถูกไฮไลต์', await page.$('#nav .nav-i.sub.on') !== null);

  console.log('\n[16] เปลี่ยนชื่อเป็น Financii แล้วข้อมูลเดิมต้องตามมาด้วย');
  ok('ชื่อหน้าเว็บเปลี่ยนแล้ว', (await page.title()) === 'Financii', await page.title());
  ok('ตราสัญลักษณ์บนแถบบนเป็น Financii',
    (await page.$eval('.brand', (e) => e.textContent)).indexOf('Financii') >= 0);
  ok('ไม่เหลือชื่อเดิมในหน้าจอ',
    (await page.$eval('.brand', (e) => e.textContent)).indexOf('ดุลย์') < 0);

  /* จำลองผู้ใช้เดิมที่มีข้อมูลเก็บไว้ใต้ชื่อเก่า แล้วเปิดเว็บรุ่นใหม่ */
  await page.evaluate(() => {
    const books = JSON.parse(localStorage.getItem('financii.books') || '[]');
    const keep = books.map((b) => ({ id: b.id, data: localStorage.getItem('financii.book.' + b.id) }));
    localStorage.clear();
    localStorage.setItem('duly.books', JSON.stringify(books));
    localStorage.setItem('duly.activeBook', books[0].id);
    keep.forEach((k) => localStorage.setItem('duly.book.' + k.id, k.data));
    localStorage.setItem('duly.passcode', 'รหัสเดิม');
  });
  await page.reload();
  await page.waitForSelector('#main .kpis', { timeout: 10000 });
  const rebranded = await page.evaluate(() => ({
    books: SYNC.books.length,
    company: DB.company.name,
    invoices: DB.docs.invoice.length,
    newKeys: Object.keys(localStorage).filter((k) => k.startsWith('financii.')).length,
    oldKeys: Object.keys(localStorage).filter((k) => k.startsWith('duly.')).length,
  }));
  ok('★ ข้อมูลที่เก็บไว้ใต้ชื่อเดิมถูกย้ายมาครบ',
    rebranded.books === 3 && rebranded.invoices === a1.invoices,
    rebranded.books + ' บริษัท · ' + rebranded.invoices + ' ใบกำกับ · ' + rebranded.company);
  ok('เก็บไว้ใต้ชื่อใหม่แล้ว', rebranded.newKeys >= 4, rebranded.newKeys + ' คีย์');
  ok('เก็บกวาดคีย์ชื่อเดิมออกให้ เหลือแค่ที่ยังไม่ได้ย้าย',
    rebranded.oldKeys <= 1, rebranded.oldKeys + ' คีย์');

  console.log('\n[17] วงจรเอกสารครบตั้งแต่ใบเสนอราคาถึงใบเพิ่มหนี้');
  const salesMenu = await page.evaluate(() =>
    navGroups().find((g) => g.g === 'เอกสารขาย').items.map((i) => i[1]));
  const buyMenu = await page.evaluate(() =>
    navGroups().find((g) => g.g === 'เอกสารซื้อ').items.map((i) => i[1]));
  ok('★ เมนูเอกสารขายเรียงตามวงจรจริง เสนอราคา → สั่งขาย → ใบกำกับ → วางบิล → ใบเสร็จ',
    salesMenu.join('|') === 'ใบเสนอราคา|ใบสั่งขาย|ใบกำกับภาษี|ใบวางบิล|ใบเสร็จรับเงิน|ใบลดหนี้|ใบเพิ่มหนี้',
    salesMenu.join(' → '));
  ok('เมนูเอกสารซื้อเรียงตามวงจรจริง สั่งซื้อ → รับสินค้า → ตั้งหนี้ → จ่าย',
    buyMenu.join('|') === 'ใบสั่งซื้อ|ใบรับสินค้า|ตั้งหนี้ผู้ขาย|ใบสำคัญจ่าย', buyMenu.join(' → '));

  /* ทุกหน้าจอในเมนูต้องเปิดได้จริง ไม่ใช่มีชื่ออยู่ในเมนูเฉย ๆ */
  const screensOk = await page.evaluate(() => {
    const bad = [];
    navScreens().forEach(function (sc) {
      try {
        STATE.screen = sc; STATE.sel = null; STATE.filter = ''; render();
        const html = document.getElementById('main').innerHTML;
        if (!html || html.length < 80) bad.push(sc + ' (ว่าง)');
      } catch (e) { bad.push(sc + ' (' + e.message + ')'); }
    });
    return { total: navScreens().length, bad };
  });
  ok('★ ทุกหน้าจอที่อยู่ในเมนูเปิดได้จริงทั้งหมด', screensOk.bad.length === 0,
    screensOk.total + ' หน้า' + (screensOk.bad.length ? ' · พัง ' + screensOk.bad.join(', ') : ''));

  const cycle = await page.evaluate(() => {
    const cust = DB.partners.find((p) => p.kind === 'customer');
    /* ใบกำกับต้องมีข้อมูลผู้ซื้อครบตามมาตรา 86/4 — คู่ค้าที่ย้ายมาจากระบบเดิมอาจยังไม่ครบ */
    if (!cust.taxId) cust.taxId = '0105536000003';
    if (!cust.address) cust.address = '99 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10110';
    if (!cust.branch) cust.branch = '00000';
    const per = DB.periods.find((p) => p.status === 'open');
    const d = per.start;
    const q = issueTradeDoc('quotation', { partnerCode: cust.code, date: d,
      lines: [{ desc: 'งานทดสอบวงจรเอกสาร', qty: 1, price: '40000' }] });
    STATE.screen = 'quotations'; STATE.sel = null; render();
    const listed = document.getElementById('main').innerHTML.indexOf(q.no) >= 0;
    setTradeDocStatus('quotation', q.no, 'approved');
    const so = convertTradeDoc('quotation', q.no, { date: d });
    const inv = convertTradeDoc('salesOrder', so.no, { date: d });
    STATE.screen = 'quotations'; STATE.sel = q.no; render();
    const showsTarget = document.getElementById('main').innerHTML.indexOf(so.no) >= 0;
    const dn = issueDebitNote({ invoiceNo: inv.no, date: d, base: '1000', reason: 'GOODS_UNDERPRICED' });
    STATE.screen = 'debitnotes'; STATE.sel = null; STATE.period = periodOf(d); render();
    const dnListed = document.getElementById('main').innerHTML.indexOf(dn.no) >= 0;
    STATE.screen = 'invoices'; STATE.sel = inv.no; render();
    const detail = document.getElementById('main').innerHTML;
    return { listed, showsTarget, dnListed,
      dnOnInvoice: detail.indexOf('เพิ่มหนี้แล้ว') >= 0 && detail.indexOf(dn.no) >= 0,
      qTotal: q.total, invTotal: inv.total, out: invOutstanding(inv), dnTotal: dn.total,
      balanced: trialBalance(DB.periods[0].start, DB.periods[DB.periods.length - 1].end).balanced };
  });
  ok('ใบเสนอราคาที่ออกใหม่ขึ้นในทะเบียนทันที', cycle.listed);
  ok('★ แปลงใบเสนอราคา → ใบสั่งขาย → ใบกำกับภาษี แล้วยอดไม่เพี้ยน',
    cycle.qTotal === cycle.invTotal, 'รวม ' + (cycle.invTotal / 10000).toFixed(2));
  ok('หน้าใบเสนอราคาบอกได้ว่าแปลงไปเป็นเอกสารใบไหน', cycle.showsTarget);
  ok('ใบเพิ่มหนี้ขึ้นในทะเบียนของงวดนั้น', cycle.dnListed);
  ok('★ หน้าใบกำกับแสดงใบเพิ่มหนี้และยอดคงค้างที่เพิ่มขึ้น',
    cycle.dnOnInvoice && cycle.out === cycle.invTotal + cycle.dnTotal);
  ok('งบทดลองยังสมดุลหลังเดินเอกสารครบวงจรบนหน้าจอ', cycle.balanced);

  console.log('\n[18] เพิ่มผู้ขาย สินค้า พนักงาน ทรัพย์สิน เองได้จากหน้าจอ');
  await page.evaluate(() => { STATE.screen = 'vendors'; STATE.sel = null; STATE.filter = ''; render(); });
  await page.waitForTimeout(150);
  ok('★ หน้าทะเบียนผู้ขายมีปุ่มเพิ่มผู้ขาย', await page.$('[data-act="partner:new:vendor"]') !== null);
  const vendBefore = await page.evaluate(() => DB.partners.filter((p) => p.kind === 'vendor').length);
  await page.click('[data-act="partner:new:vendor"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'บริษัท ยาสีฟันไทย จำกัด');
  await page.fill('[name="taxId"]', '0105536000003');
  await page.fill('[name="address"]', '99 ถนนทดสอบ แขวงทดสอบ เขตทดสอบ กรุงเทพมหานคร 10110');
  await page.fill('[name="termDays"]', '30');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const vendAfter = await page.evaluate(() => {
    const v = DB.partners.filter((p) => p.kind === 'vendor');
    return { n: v.length, made: v.find((x) => x.name === 'บริษัท ยาสีฟันไทย จำกัด') || null };
  });
  ok('★ เพิ่มผู้ขายจากหน้าจอได้ ระบบตั้งรหัสให้เอง',
    vendAfter.n === vendBefore + 1 && !!vendAfter.made
    && /^VEN-\d{4}$/.test(vendAfter.made.code) && vendAfter.made.taxId === '0105536000003',
    vendAfter.made ? vendAfter.made.code + ' ' + vendAfter.made.name : 'ไม่พบ');
  ok('ผู้ขายรายใหม่ขึ้นในทะเบียนทันที',
    (await page.$eval('#main', (e) => e.textContent)).indexOf('ยาสีฟันไทย') >= 0);

  /* ค้นหาแล้วต้องเจอ — คำถามตรง ๆ ของผู้ใช้ */
  await page.fill('#q', 'ยาสีฟัน');
  await page.waitForTimeout(250);
  ok('★ ค้นหาชื่อผู้ขายที่เพิ่งเพิ่มแล้วเจอ',
    (await page.$eval('#main', (e) => e.textContent)).indexOf('ยาสีฟันไทย') >= 0);
  await page.fill('#q', '');
  await page.waitForTimeout(200);

  /* เพิ่มซ้ำด้วยเลขผู้เสียภาษีเดิมต้องถูกปฏิเสธ */
  await page.click('[data-act="partner:new:vendor"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'บริษัท ยาสีฟันไทย จำกัด (คีย์ซ้ำ)');
  await page.fill('[name="taxId"]', '0105536000003');
  await page.click('[data-act="modal:submit"]');
  await page.waitForTimeout(400);
  ok('★ คีย์ผู้ขายซ้ำด้วยเลขผู้เสียภาษีเดิม ระบบเตือนและไม่สร้างซ้ำ',
    await page.evaluate(() => document.getElementById('modal').classList.contains('show')
      && document.getElementById('toast').className.indexOf('err') >= 0));
  await page.click('[data-act="modal:close"]');
  await page.waitForTimeout(200);

  /* แก้ไขรายเดิมโดยกดที่แถว */
  await page.click('[data-act="partner:edit:' + vendAfter.made.code + '"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="termDays"]', '45');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  ok('กดที่แถวเพื่อแก้ไขได้ และไม่สร้างรายใหม่',
    await page.evaluate(([c, n]) => DB.partners.find((p) => p.code === c).termDays === 45
      && DB.partners.filter((p) => p.kind === 'vendor').length === n,
      [vendAfter.made.code, vendAfter.n]));

  /* สินค้า พนักงาน ทรัพย์สิน */
  await page.evaluate(() => { STATE.screen = 'items'; STATE.filter = ''; render(); });
  await page.waitForTimeout(150);
  await page.click('[data-act="item:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'ยาสีฟันสมุนไพร 160 กรัม');
  await page.fill('[name="uom"]', 'หลอด');
  await page.fill('[name="price"]', '89');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  ok('★ เพิ่มสินค้าจากหน้าจอได้ และเริ่มที่คงเหลือศูนย์',
    await page.evaluate(() => {
      const i = DB.items.find((x) => x.name === 'ยาสีฟันสมุนไพร 160 กรัม');
      return !!i && i.qty === 0 && i.price === 890000;
    }));

  await page.evaluate(() => { STATE.screen = 'employees'; STATE.filter = ''; render(); });
  await page.waitForTimeout(150);
  await page.click('[data-act="emp:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'นางสาวทดสอบ ระบบ');
  await page.fill('[name="dept"]', 'บัญชี');
  await page.fill('[name="salary"]', '28000');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  ok('เพิ่มพนักงานจากหน้าจอได้',
    await page.evaluate(() => DB.employees.some((e) => e.name === 'นางสาวทดสอบ ระบบ')));

  await page.evaluate(() => { STATE.screen = 'assets'; STATE.filter = ''; render(); });
  await page.waitForTimeout(150);
  await page.click('[data-act="asset:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'ชั้นวางสินค้า');
  await page.selectOption('[name="class"]', 'FURNITURE');
  await page.fill('[name="cost"]', '80000');
  await page.fill('[name="bookYears"]', '5');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const madeAsset = await page.evaluate(() => DB.assets.find((a) => a.name === 'ชั้นวางสินค้า') || null);
  ok('เพิ่มทรัพย์สินจากหน้าจอได้ พร้อมคิดค่าเสื่อมงวดถัดไป',
    !!madeAsset && madeAsset.accumBook === 0 && madeAsset.cost === 800000000,
    madeAsset ? madeAsset.code + ' ราคาทุน ' + fmtT(madeAsset.cost) : 'ไม่พบ');

  /* ผู้ขายที่เพิ่งเพิ่มต้องเลือกได้ในหน้าตั้งหนี้ทันที */
  await page.evaluate(() => { STATE.screen = 'bills'; STATE.sel = null; render(); });
  await page.waitForTimeout(150);
  await page.click('[data-act="new:bill"]');
  await page.waitForSelector('#modal.show');
  const inList = await page.$$eval('[name="partner"] option', (os) =>
    os.some((o) => o.textContent.indexOf('ยาสีฟันไทย') >= 0));
  ok('★ ผู้ขายที่เพิ่งเพิ่มเลือกได้ในหน้าตั้งหนี้ทันที', inList);
  await page.click('[data-act="modal:close"]');
  await page.waitForTimeout(200);

  console.log('\n[19] เอกสารชุดใหม่ที่ฝ่ายบัญชีขอ — ทุกแถบมีปุ่มสร้างเอกสาร');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => {
    buildSeed(); STATE.period = '2026-07'; STATE.screen = 'dashboard'; STATE.sel = null; STATE.filter = '';
    save(); render();
  });
  await page.waitForTimeout(150);
  const submit = async () => { await page.click('[data-act="modal:submit"]'); await closed(page); };
  const openNew = async (screen, act) => {
    await page.evaluate((x) => { STATE.screen = x; STATE.sel = null; STATE.filter = ''; render(); }, screen);
    await page.click('#main .card-h [data-act="' + act + '"]');
    await page.waitForSelector('#modal.show');
  };

  const menus = await page.evaluate(() => {
    const g = (n) => (navGroups().find((x) => x.g === n) || { items: [] }).items.map((i) => i[1]).join('|');
    return { exp: g('ค่าใช้จ่าย'), acct: g('บัญชี') };
  });
  ok('★ แถบค่าใช้จ่าย: ค่าใช้จ่าย → หัก ณ ที่จ่าย → เตรียมจ่ายเงิน',
    menus.exp === 'ค่าใช้จ่าย|หัก ณ ที่จ่าย|เตรียมจ่ายเงิน', menus.exp);
  ok('★ แถบบัญชีมีสมุดรายวันครบ 5 เล่ม ทั่วไป ซื้อ ขาย จ่าย รับ',
    menus.acct.indexOf('สมุดรายวันทั่วไป|สมุดรายวันซื้อ|สมุดรายวันขาย|สมุดรายวันจ่าย|สมุดรายวันรับ') === 0, menus.acct);

  const needBtn = { receipts:'new:receipt', creditnotes:'new:creditnote', debitnotes:'new:debitnote',
    billingnotes:'new:billingnote', goodsreceipts:'new:goodsreceipt', expenses:'new:expense',
    whtcert:'new:whtcert', paymentprep:'new:paymentbatch', jgeneral:'jv:general', jpurchase:'jv:purchase',
    jsales:'jv:sales', jpayment:'jv:payment', jreceipt:'jv:receipt' };
  const missing = await page.evaluate((m) => Object.keys(m).filter(function (sc) {
    STATE.screen = sc; STATE.sel = null; render();
    return !document.querySelector('#main .card-h [data-act="' + m[sc] + '"]');
  }), needBtn);
  ok('★ ทุกแถบที่ขอมีปุ่มสร้างเอกสาร', missing.length === 0,
    missing.length ? 'ขาด ' + missing.join(', ') : Object.keys(needBtn).length + ' แถบ');

  /* ใบเสร็จ ใบลดหนี้ ใบเพิ่มหนี้ — สร้างจากหน้ารายการ เลือกใบกำกับอ้างอิงในฟอร์ม */
  const rcCount = await page.evaluate(() => DB.docs.receipt.length);
  await openNew('receipts', 'new:receipt');
  const rcInv = await page.$eval('[name="invoiceNo"]', (e) => e.value);
  await submit();
  const rcRes = await page.evaluate((no) => ({ n: DB.docs.receipt.length, rc: DB.docs.receipt[0],
    out: invOutstanding(DB.docs.invoice.find((d) => d.no === no)) }), rcInv);
  ok('★ ออกใบเสร็จรับเงินจากหน้ารายการได้ โดยเลือกใบกำกับที่ค้าง',
    rcRes.n === rcCount + 1 && rcRes.rc.invoiceNo === rcInv, rcRes.rc.no + ' อ้าง ' + rcInv);
  ok('ไม่กรอกยอด = รับเต็มยอดคงค้าง', rcRes.out === 0);

  await openNew('creditnotes', 'new:creditnote');
  const cnInv = await page.$eval('[name="invoiceNo"]', (e) => e.value);
  await page.fill('[name="base"]', '1000');
  await submit();
  const cn = await page.evaluate(() => DB.docs.creditNote[0]);
  ok('★ ออกใบลดหนี้จากหน้ารายการได้', cn.invoiceNo === cnInv && cn.base === 10000000, cn.no + ' อ้าง ' + cnInv);

  await openNew('debitnotes', 'new:debitnote');
  const dnInv = await page.$eval('[name="invoiceNo"]', (e) => e.value);
  await page.fill('[name="base"]', '2500');
  await submit();
  const dn = await page.evaluate(() => DB.docs.debitNote[0]);
  ok('★ ออกใบเพิ่มหนี้จากหน้ารายการได้', dn.invoiceNo === dnInv && dn.base === 25000000, dn.no + ' อ้าง ' + dnInv);

  /* ใบวางบิล */
  const target = await page.evaluate(() => {
    const live = (b) => ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0;
    const taken = new Set();
    DB.docs.billingNote.filter(live).forEach((b) => b.invoices.forEach((i) => taken.add(i.no)));
    return DB.partners.filter((p) => p.kind === 'customer').map((p) => ({ code: p.code,
      n: DB.docs.invoice.filter((d) => d.partnerCode === p.code && d.status !== 'void'
        && invOutstanding(d) > 0 && !taken.has(d.no)).length }))
      .filter((x) => x.n > 0).sort((a, b) => b.n - a.n)[0];
  });
  const entriesBeforeBn = await page.evaluate(() => DB.entries.length);
  await openNew('billingnotes', 'new:billingnote');
  await page.selectOption('[name="bnPartner"]', target.code);
  await page.waitForTimeout(100);
  const boxes = await page.$$eval('[name="bnInv"]:not([disabled])', (els) => els.length);
  ok('เลือกลูกค้าแล้วรายการใบกำกับในฟอร์มเปลี่ยนตาม', boxes === target.n, boxes + ' ใบ');
  await submit();
  const bn = await page.evaluate(() => DB.docs.billingNote[0]);
  ok('★ ออกใบวางบิลรวมหลายใบกำกับของลูกค้ารายเดียวได้',
    bn.partnerCode === target.code && bn.invoices.length === target.n, bn.no + ' · ' + bn.invoices.length + ' ใบ');
  ok('ใบวางบิลไม่ลงบัญชี', (await page.evaluate(() => DB.entries.length)) === entriesBeforeBn);
  await page.click('[data-act="bn:receive:' + bn.no + '"]');
  await page.waitForSelector('#modal.show');
  await submit();
  const bnAfter = await page.evaluate((no) => ({
    st: billingNoteStatus(DB.docs.billingNote.find((b) => b.no === no)),
    rcs: DB.docs.receipt.filter((r) => r.billingNoteNo === no).length }), bn.no);
  ok('★ รับชำระตามใบวางบิลครั้งเดียว ออกใบเสร็จให้ครบทุกใบกำกับ',
    bnAfter.st === 'paid' && bnAfter.rcs === target.n, bnAfter.rcs + ' ใบเสร็จ · ' + bnAfter.st);

  /* ใบรับสินค้า → ตั้งหนี้ */
  const cbBefore = await page.evaluate(() => DB.items.find((i) => i.code === 'CB-16').qty);
  await openNew('goodsreceipts', 'new:goodsreceipt');
  await page.selectOption('[name="partner"]', 'VEN-0004');
  await page.selectOption('[name="l0_item"]', 'CB-16');
  const costFilled = await page.$eval('[name="l0_price"]', (e) => e.value);
  await page.fill('[name="l0_qty"]', '100');
  await page.fill('[name="vendorDoNo"]', 'DO-UI-0001');
  await submit();
  const grn = await page.evaluate(() => DB.docs.goodsReceipt[0]);
  const cbAvg = await page.evaluate(() => fmt(DB.items.find((i) => i.code === 'CB-16').avgCost));
  ok('★ ออกใบรับสินค้าแล้วสต๊อกเพิ่มทันที',
    (await page.evaluate(() => DB.items.find((i) => i.code === 'CB-16').qty)) === cbBefore + 100, grn.no);
  ok('ฟอร์มรับสินค้าเติมต้นทุนเฉลี่ยให้ ไม่ใช่ราคาขาย', costFilled === cbAvg, costFilled);
  await page.click('[data-act="grn:bill:' + grn.no + '"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="vendorNo"]', 'TPS-UI-GR-01');
  await submit();
  const grnRes = await page.evaluate((no) => ({
    g: DB.docs.goodsReceipt.find((x) => x.no === no), bill: DB.docs.bill[0],
    qty: DB.items.find((i) => i.code === 'CB-16').qty,
    grni: reconciliationChecks('2026-07-31').checks.find((c) => c.code === 'GRNI_SUBLEDGER').ok }), grn.no);
  ok('★ ตั้งหนี้จากใบรับสินค้า: ปิดใบรับสินค้า สต๊อกไม่เพิ่มซ้ำ ยอดพักรับสินค้าตรง',
    grnRes.g.status === 'closed' && grnRes.bill.grnNo === grn.no && grnRes.qty === cbBefore + 100 && grnRes.grni,
    grnRes.bill.no + ' รวม ' + fmtT(grnRes.bill.total));

  /* ค่าใช้จ่าย + หัก ณ ที่จ่าย 3% → 50 ทวิ อัตโนมัติ (ตามหมายเหตุในใบขอ) */
  await openNew('expenses', 'new:expense');
  await page.selectOption('[name="expPartner"]', 'VEN-0012');
  ok('เลือกผู้รับเงินแล้วเติมประเภทหัก ณ ที่จ่ายจากทะเบียนให้',
    (await page.$eval('[name="wht"]', (e) => e.value)) === 'WHT_RENT');
  await page.selectOption('[name="wht"]', 'WHT_SERVICE');
  await page.fill('[name="taxInvoiceNo"]', 'TNP-UI-0001');
  await page.fill('[name="e0_desc"]', 'ค่าซ่อมเครื่องปรับอากาศ');
  await page.selectOption('[name="e0_acc"]', '5325');
  await page.fill('[name="e0_price"]', '10000');
  const expSum = await page.$eval('#expSum', (e) => e.textContent);
  ok('ฟอร์มสรุปยอดให้ระหว่างกรอก หัก 3% ของ 10,000 = 300', expSum.indexOf('300.00') >= 0 && expSum.indexOf('10,400.00') >= 0, expSum);
  await submit();
  const ex = await page.evaluate(() => {
    const e = DB.docs.expense[0];
    return { e, cert: DB.docs.whtCert.find((c) => c.no === e.certNo) || null };
  });
  ok('★ ค่าใช้จ่ายมีหัก ณ ที่จ่าย 3% → แถบหัก ณ ที่จ่ายสร้างหนังสือรับรองให้เองอัตโนมัติ',
    ex.e.wht === 3000000 && !!ex.cert && ex.cert.expenseNo === ex.e.no && ex.cert.rate === '3',
    ex.e.no + ' → ' + (ex.cert ? ex.cert.no : 'ไม่มี'));
  const certListed = await page.evaluate((c) => {
    STATE.screen = 'whtcert'; STATE.sel = null; STATE.filter = ''; render();
    const h = document.getElementById('main').innerHTML;
    return h.indexOf(c.no) >= 0 && h.indexOf(c.expenseNo) >= 0;
  }, ex.cert);
  ok('หนังสือรับรองขึ้นในแถบหัก ณ ที่จ่าย พร้อมเลขที่ค่าใช้จ่ายต้นทาง', certListed);

  await openNew('expenses', 'new:expense');
  await page.selectOption('[name="expPartner"]', 'VEN-0025');
  await page.fill('[name="e0_desc"]', 'กระดาษถ่ายเอกสาร');
  await page.selectOption('[name="e0_acc"]', '5324');
  await page.fill('[name="e0_price"]', '2000');
  await page.click('[data-act="modal:submit"]');
  await page.waitForTimeout(300);
  ok('มีภาษีซื้อแต่ไม่กรอกเลขใบกำกับ ระบบไม่ยอมบันทึก', await page.evaluate(() =>
    document.getElementById('modal').classList.contains('show')
    && document.getElementById('toast').className.indexOf('err') >= 0));
  await page.click('[data-act="modal:close"]');

  await openNew('whtcert', 'new:whtcert');
  ok('ปุ่มในแถบหัก ณ ที่จ่ายเปิดฟอร์มออกหนังสือรับรอง',
    (await page.$eval('.modal-h h3', (e) => e.textContent)).indexOf('หนังสือรับรอง') >= 0);
  await page.selectOption('[name="expPartner"]', 'VEN-0015');
  await page.fill('[name="taxInvoiceNo"]', 'MDP-UI-0001');
  await page.fill('[name="e0_desc"]', 'ค่าจัดทำป้ายโฆษณาหน้าร้าน');
  await page.selectOption('[name="e0_acc"]', '5220');
  await page.fill('[name="e0_price"]', '20000');
  await submit();
  const wc = await page.evaluate(() => ({ c: DB.docs.whtCert[0], screen: STATE.screen, sel: STATE.sel }));
  ok('★ สร้างจากแถบหัก ณ ที่จ่าย: ออก 50 ทวิ พร้อมบันทึกการจ่ายเงินให้ในครั้งเดียว',
    !!wc.c.expenseNo && wc.c.rate === '2' && wc.screen === 'whtcert' && wc.sel === wc.c.no, wc.c.no + ' ← ' + wc.c.expenseNo);

  /* เตรียมจ่ายเงิน: จัดทำ → อนุมัติ → จ่าย */
  await openNew('paymentprep', 'new:paymentbatch');
  if (!(await page.$$eval('[name="pbBill"]:checked', (els) => els.length))) await page.click('[name="pbBill"]');
  await submit();
  const pb = await page.evaluate(() => DB.docs.paymentBatch[0]);
  ok('จัดทำใบเตรียมจ่ายแล้วรออนุมัติ', pb.status === 'pending_approval', pb.no + ' · ' + pb.items.length + ' ราย');
  await page.click('[data-act="pb:approve:' + pb.no + '"]');
  await page.waitForTimeout(200);
  ok('อนุมัติใบเตรียมจ่ายได้', (await page.evaluate((no) => DB.docs.paymentBatch.find((b) => b.no === no).status, pb.no)) === 'approved');
  await page.click('[data-act="pb:pay:' + pb.no + '"]');
  await page.waitForSelector('#modal.show');
  await submit();
  const pbRes = await page.evaluate((no) => {
    const b = DB.docs.paymentBatch.find((x) => x.no === no);
    return { st: b.status, pv: b.paymentNos.length, open: b.items.filter((i) => {
      const bill = DB.docs.bill.find((x) => x.no === i.billNo); return billOutstanding(bill) > 0; }).length };
  }, pb.no);
  ok('★ จ่ายตามใบเตรียมจ่าย: ออกใบสำคัญจ่ายครบทุกราย หนี้ปิดหมด',
    pbRes.st === 'paid' && pbRes.pv === pb.items.length && pbRes.open === 0, pbRes.pv + ' ใบสำคัญจ่าย');

  /* สมุดรายวันรับ — บันทึกด้วยมือ */
  await openNew('jreceipt', 'jv:receipt');
  ok('สมุดรายวันรับเติมบัญชีธนาคารฝั่งเดบิตให้', (await page.$eval('[name="j0_acc"]', (e) => e.value))
    === (await page.evaluate(() => accBySub('bank'))));
  await page.fill('[name="desc"]', 'ดอกเบี้ยรับเงินฝากประจำ');
  await page.fill('[name="j0_dr"]', '1500');
  await page.selectOption('[name="j1_acc"]', '4210');
  await page.fill('[name="j1_cr"]', '1500');
  ok('ยอดรวมเดบิต/เครดิตขึ้นให้ดูระหว่างกรอก', (await page.$eval('#jvTot', (e) => e.textContent)).indexOf('สมดุล') >= 0);
  await submit();
  const jv = await page.evaluate(() => {
    const e = DB.entries[DB.entries.length - 1];
    return { e, screen: STATE.screen, listed: document.getElementById('main').innerHTML.indexOf(e.no) >= 0 };
  });
  ok('★ บันทึกใบสำคัญรับในสมุดรายวันรับได้ และขึ้นในเล่มทันที',
    jv.e.type === 'receipt' && jv.e.src === 'manual' && jv.screen === 'jreceipt' && jv.listed, jv.e.no);
  await openNew('jgeneral', 'jv:general');
  const ctlOffered = await page.$$eval('[name="j0_acc"] option', (os) => os.some((o) => o.value === '1131' || o.value === '2141'));
  ok('บัญชีคุม (ลูกหนี้ ภาษีขาย) ไม่อยู่ในรายการให้เลือก', !ctlOffered);
  await page.click('[data-act="modal:close"]');
  ok('★ ลงบัญชีคุมด้วยมือไม่ได้แม้เรียกตรง ๆ', (await page.evaluate(() => {
    try {
      postJournalVoucher({ book:'general', date:'2026-07-31', desc:'ทดสอบ',
        lines:[{ acc:'1131', dr:'100' }, { acc:'4111', cr:'100' }] });
      return 'posted';
    } catch (e) { return e.code; }
  })) === 'CONTROL_ACCOUNT_MANUAL');

  const fin = await page.evaluate(() => {
    const rec = reconciliationChecks('2026-07-31');
    return { tb: trialBalance('2026-01-01', '2026-12-31').balanced, all: rec.allPassed,
      failed: rec.checks.filter((c) => !c.ok).map((c) => c.label) };
  });
  ok('★ งบทดลองสมดุลและยอดคุมทุกตัวตรง หลังใช้เอกสารใหม่ครบทุกแถบ', fin.tb && fin.all,
    fin.failed.join(', ') || 'ผ่านทุกข้อ');

  console.log('\n[20] หน้าตาใหม่: ค้นหา สร้างเอกสาร พิมพ์ ส่งออก และโหมดมืด');
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => { STATE.period = '2026-07'; STATE.screen = 'dashboard'; STATE.sel = null; render(); });
  await page.waitForTimeout(120);

  /* โหมดมืด — สลับได้และจำไว้ */
  const t0 = await page.evaluate(() => themeNow());
  await page.click('#themeBtn');
  await page.waitForTimeout(100);
  const t1 = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor }));
  ok('★ ปุ่มสลับโหมดมืด/สว่างทำงาน', t1.attr && t1.attr !== t0, t0 + ' → ' + t1.attr + ' · พื้น ' + t1.bg);
  await page.reload();
  await page.waitForSelector('#main .kpis');
  ok('เปิดใหม่แล้วยังจำโหมดที่เลือก', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === t1.attr);
  await page.click('#themeBtn');
  await page.evaluate(() => { STATE.period = '2026-07'; render(); });

  /* ค้นหาและสั่งงาน */
  const junInv = await page.evaluate(() => DB.docs.invoice.find((d) => periodOf(d.date) === '2026-06').no);
  await page.keyboard.press('Control+k');
  await page.waitForSelector('#cmdk.show');
  await page.keyboard.type(junInv);
  await page.waitForTimeout(120);
  const firstHit = await page.$eval('#cmdkList .cmdk-i.on .t', (e) => e.textContent);
  ok('★ Ctrl+K ค้นหาเลขที่เอกสารเจอทันที', firstHit.indexOf(junInv) === 0, firstHit);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const opened = await page.evaluate(() => ({ screen: STATE.screen, sel: STATE.sel, period: STATE.period,
    shown: document.getElementById('main').innerHTML.indexOf('ใบกำกับภาษี/ใบส่งของ เลขที่') >= 0 }));
  ok('★ กด Enter เปิดเอกสารนั้น และเลื่อนไปงวดของเอกสารให้เอง',
    opened.screen === 'invoices' && opened.sel === junInv && opened.period === '2026-06' && opened.shown, opened.period);
  await page.evaluate(() => { STATE.period = '2026-07'; STATE.screen = 'dashboard'; STATE.sel = null; render(); });
  await page.keyboard.press('/');
  await page.waitForSelector('#cmdk.show');
  await page.keyboard.type('ภพ30');
  await page.waitForTimeout(100);
  ok('พิมพ์ "ภพ30" แบบไม่มีจุดก็เจอแบบ ภ.พ.30',
    (await page.$$eval('#cmdkList .cmdk-i .t', (els) => els.map((e) => e.textContent))).some((t) => t.indexOf('ภ.พ.30') >= 0));
  await page.keyboard.press('Escape');
  ok('Esc ปิดกล่องค้นหา', !(await page.evaluate(() => document.getElementById('cmdk').classList.contains('show'))));
  await page.keyboard.press('Control+k');
  await page.keyboard.type('สร้างใบวางบิล');
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#modal.show');
  ok('สั่งงานจากกล่องค้นหาได้ เช่น สร้างใบวางบิล', (await page.$eval('.modal-h h3', (e) => e.textContent)) === 'ออกใบวางบิล');
  await page.click('[data-act="modal:close"]');

  /* เมนูสร้างเอกสาร */
  await page.click('#newBtn');
  await page.waitForSelector('#pop.show');
  const popItems = await page.$$eval('#pop .pop-i', (els) => els.length);
  ok('★ ปุ่มสร้างเอกสารรวมทุกเอกสารไว้ที่เดียว แบ่งตามหมวด', popItems >= 20, popItems + ' รายการ');
  await page.click('#pop [data-act="popgo:new:expense"]');
  await page.waitForSelector('#modal.show');
  ok('เลือกจากเมนูแล้วเปิดฟอร์มนั้นทันที', (await page.$eval('.modal-h h3', (e) => e.textContent)) === 'บันทึกค่าใช้จ่าย'
    && !(await page.evaluate(() => document.getElementById('pop').classList.contains('show'))));
  await page.click('[data-act="modal:close"]');

  /* บริบทของหน้า */
  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  const ctxInfo = await page.evaluate(() => ({
    on: (document.querySelector('.flow a.on') || {}).textContent || '',
    steps: document.querySelectorAll('.flow a').length,
    je: Array.from(document.querySelectorAll('.je-chip')).map((e) => e.textContent).join(' | '),
    crumb: document.getElementById('crumb').textContent }));
  ok('★ ทุกหน้าบอกว่าอยู่ตรงไหนของวงจรเอกสาร', ctxInfo.on.indexOf('ใบกำกับภาษี') === 0 && ctxInfo.steps === 7,
    ctxInfo.steps + ' ขั้น · อยู่ที่ ' + ctxInfo.on);
  ok('★ ทุกหน้าบอกผลทางบัญชีเป็นเดบิต/เครดิต', /Dr.*ลูกหนี้การค้า/.test(ctxInfo.je) && /Cr.*ภาษีขาย/.test(ctxInfo.je), ctxInfo.je);
  ok('แถบบนบอกเส้นทาง หมวด / หน้า', ctxInfo.crumb.replace(/\s/g, '') === 'เอกสารขาย/ใบกำกับภาษี', ctxInfo.crumb);

  /* พิมพ์เอกสารทุกชนิด */
  const printed = await page.evaluate(() => {
    const pick = { invoice:'invoice', receipt:'receipt', billingNote:'billingNote', creditNote:'creditNote',
      debitNote:'debitNote', quotation:'quotation', salesOrder:'salesOrder', purchaseOrder:'purchaseOrder',
      goodsReceipt:'goodsReceipt', payment:'payment', expense:'expense', paymentBatch:'paymentBatch', whtCert:'whtCert' };
    const out = {};
    Object.keys(pick).forEach(function (k) {
      const d = DB.docs[pick[k]][0];
      if (!d) { out[k] = 'ไม่มีเอกสาร'; return; }
      printDoc(k, d.no);
      const el = document.getElementById('printArea');
      out[k] = { pages: el.querySelectorAll('.sheet').length, title: (el.querySelector('.pr-bar b') || {}).textContent,
        words: /บาท(ถ้วน|.*สตางค์)/.test(el.textContent), co: el.textContent.indexOf(DB.company.taxId) >= 0 };
      closePrint();
    });
    const e = DB.entries[DB.entries.length - 1];
    printDoc('entry', e.no);
    out.entry = { pages: document.querySelectorAll('#printArea .sheet').length, title: document.querySelector('.pr-bar b').textContent };
    closePrint();
    return out;
  });
  const badPrint = Object.keys(printed).filter((k) => !printed[k].pages || !printed[k].co && k !== 'entry');
  ok('★ พิมพ์ได้ทุกเอกสาร 14 ชนิด มีหัวผู้ออกพร้อมเลขผู้เสียภาษี', badPrint.length === 0,
    badPrint.length ? 'พัง ' + badPrint.join(', ') : Object.keys(printed).length + ' ชนิด');
  ok('★ ใบกำกับภาษีพิมพ์ต้นฉบับและสำเนา และมีจำนวนเงินเป็นตัวอักษร',
    printed.invoice.pages === 2 && printed.invoice.words && printed.receipt.words);
  ok('50 ทวิ พิมพ์ฉบับที่ 1 และฉบับที่ 2', printed.whtCert.pages === 2);

  await page.evaluate(() => { STATE.screen = 'receipts'; STATE.sel = null; render(); });
  await page.click('#main tbody tr.row-link');
  ok('คลิกใบเสร็จในรายการแล้วเปิดรายละเอียด มีปุ่มพิมพ์และปุ่มยกเลิกเอกสาร', await page.evaluate(() =>
    !!document.querySelector('#main .card [data-act^="printdoc:receipt:"]') && !!document.querySelector('#main .card [data-act^="void:receipt:"]')));
  await page.click('#main .card [data-act^="printdoc:receipt:"]');
  await page.waitForSelector('#printArea.show');
  const prBar = await page.$eval('#printArea .pr-bar b', (e) => e.textContent);
  await page.selectOption('#prCopies', '1');
  const copyOnly = await page.evaluate(() => ({ n: document.querySelectorAll('#printArea .sheet').length,
    label: (document.querySelector('#printArea .p-copy') || {}).textContent }));
  ok('คลิกใบเสร็จในรายการแล้วเปิดตัวอย่างก่อนพิมพ์ เลือกพิมพ์เฉพาะสำเนาได้',
    prBar.indexOf('ใบเสร็จรับเงิน') === 0 && copyOnly.n === 1 && copyOnly.label === 'สำเนา', prBar);
  await page.keyboard.press('Escape');
  ok('Esc ปิดตัวอย่างก่อนพิมพ์', !(await page.evaluate(() => document.getElementById('printArea').classList.contains('show'))));

  /* ส่งออก CSV */
  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#main .card-h [data-act="csv"]')]);
  const csv = require('fs').readFileSync(await dl.path(), 'utf8');
  const csvRows = csv.split('\r\n');
  ok('★ ส่งออกตารางเป็น CSV เปิดใน Excel ได้ (มี BOM ภาษาไทยไม่เพี้ยน)', csv.charCodeAt(0) === 0xFEFF
    && dl.suggestedFilename() === 'Financii_invoices_2026-07.csv' && csvRows[1].indexOf('ใบกำกับภาษี') === 0,
    dl.suggestedFilename() + ' · ' + csvRows.length + ' แถว');
  ok('ตัวเลขใน CSV เป็นตัวเลขล้วน Excel คำนวณต่อได้', csvRows.some((r) => /,\d+\.\d{2},\d+\.\d{2},/.test(r))
    && !csvRows.slice(3).some((r) => /"\d{1,3}(,\d{3})+\.\d{2}"/.test(r)));

  /* ข้อมูลกิจการ */
  await page.evaluate(() => { STATE.screen = 'settings'; render(); });
  await page.click('#main [data-act="company:edit"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="cophone"]', '02-555-0199');
  await page.click('[data-act="modal:submit"]');
  await closed(page);
  const phoneOnPrint = await page.evaluate(() => {
    printDoc('invoice', DB.docs.invoice[0].no);
    const t = document.getElementById('printArea').textContent;
    closePrint();
    return t.indexOf('02-555-0199') >= 0;
  });
  ok('★ แก้ข้อมูลกิจการแล้ว หัวเอกสารที่พิมพ์เปลี่ยนตาม', phoneOnPrint);

  /* งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น */
  await page.evaluate(() => { STATE.screen = 'equity'; render(); });
  ok('★ มีงบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น และตรงกับงบแสดงฐานะการเงิน',
    (await page.$eval('#main .card-f', (e) => e.textContent)).indexOf('ตรงกับงบแสดงฐานะการเงิน') >= 0);

  /* จอโทรศัพท์ */
  await page.setViewportSize({ width: 390, height: 844 });
  const narrow = await page.evaluate(() => {
    const over = [];
    ['dashboard', 'invoices', 'expenses', 'jsales', 'settings', 'equity', 'paymentprep'].forEach(function (sc) {
      STATE.screen = sc; STATE.sel = null; render();
      const w = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      if (w > 1) over.push(sc + ' ' + w + 'px');
    });
    return over;
  });
  ok('★ จอ 390px ไม่ล้นแนวนอนทุกหน้าใหม่', narrow.length === 0, narrow.join(', ') || 'ไม่ล้น');
  ok('ปุ่มค้นหาและสร้างเอกสารยังกดได้บนจอเล็ก', await page.evaluate(() =>
    document.getElementById('cmdBtn').getBoundingClientRect().width > 20
    && document.getElementById('newBtn').getBoundingClientRect().width > 20));
  await page.setViewportSize({ width: 1440, height: 950 });

  console.log('\n[21] ยกเลิกเอกสาร — กดจากหน้าเอกสาร ระบบกลับให้ครบในครั้งเดียว');
  const vinv = await page.evaluate(() => {
    STATE.period = '2026-07';
    const c = DB.partners.find((p) => p.kind === 'customer' && p.taxId && p.address);
    const d = issueInvoice({ partnerCode: c.code, date:'2026-07-28', lines:[{ desc:'ค่าบริการทดสอบยกเลิกผ่านหน้าจอ', qty:1, price:'12345.67', taxCode:'VAT7' }] });
    save(); STATE.screen = 'invoices'; STATE.sel = d.no; render();
    return d.no;
  });
  await page.click('#main [data-act="void:invoice:' + vinv + '"]');
  await page.waitForSelector('#modal.show .void-prev');
  const prevTxt = await page.$eval('#modal .void-prev', (e) => e.textContent);
  ok('★ ก่อนยืนยันบอกว่าจะกลับรายการใบสำคัญใด และทะเบียนภาษีจะเป็นอย่างไร', /กลับรายการใบสำคัญ/.test(prevTxt) && /ทะเบียนภาษีขาย/.test(prevTxt));
  ok('ปุ่มยืนยันเป็นสีแดง แยกจากปุ่มบันทึกปกติ', await page.evaluate(() => !!document.querySelector('#modal .modal-f .btn.danger')));
  await page.fill('#modal [name="reason"]', 'ผิด');
  await page.click('#modal [data-act="modal:submit"]');
  ok('เหตุผลสั้นเกินไปถูกปฏิเสธ หน้าต่างยังเปิดอยู่', await page.evaluate(() => document.getElementById('modal').classList.contains('show')
    && /เหตุผล/.test(document.getElementById('toast').textContent)));
  await page.fill('#modal [name="reason"]', 'ออกผิดลูกค้า ทดสอบผ่านหน้าจอ');
  await page.click('#modal [data-act="modal:submit"]');
  const vAfter = await page.evaluate((no) => {
    const d = DB.docs.invoice.find((x) => x.no === no);
    const row = [...document.querySelectorAll('#main tbody tr')].find((tr) => tr.textContent.indexOf(no) >= 0);
    return { st: d.status, banner: !!document.querySelector('#main .void-banner'), rowVoid: row && row.classList.contains('is-void'),
      voidBtn: !!document.querySelector('#main [data-act="void:invoice:' + no + '"]'),
      foot: [...document.querySelectorAll('#main .card')].pop().querySelector('tfoot').textContent,
      checks: reconciliationChecks('2026-07-31').allPassed };
  }, vinv);
  ok('★ ยกเลิกแล้วหน้าเอกสารขึ้นแถบยกเลิกพร้อมเหตุผล และไม่มีปุ่มยกเลิกซ้ำ', vAfter.st === 'void' && vAfter.banner && !vAfter.voidBtn);
  ok('แถวในรายการจางลงและขีดฆ่าตัวเลข', vAfter.rowVoid);
  ok('★ ยอดรวมท้ายตารางไม่นับใบที่ยกเลิก', vAfter.foot.indexOf('12,345.67') < 0 && vAfter.foot.indexOf('13,209.87') < 0);
  ok('★ กระทบยอดทุกบัญชียังตรงหลังยกเลิกผ่านหน้าจอ', vAfter.checks);
  const vatRow = await page.evaluate((no) => { STATE.screen = 'vatout'; STATE.sel = null; render();
    const tr = [...document.querySelectorAll('#main tbody tr')].find((x) => x.textContent.indexOf(no) >= 0);
    return tr ? tr.textContent : ''; }, vinv);
  ok('★ รายงานภาษีขายยังมีเลขที่ใบที่ยกเลิก เขียนว่ายกเลิก ยอดเป็นศูนย์', /ยกเลิก/.test(vatRow) && vatRow.indexOf('12,345.67') < 0, vatRow.slice(0, 80));
  const printV = await page.evaluate((no) => { printDoc('invoice', no); const w = !!document.querySelector('#printArea .wm'); closePrint(); return w; }, vinv);
  ok('พิมพ์ใบที่ยกเลิกแล้วมีลายน้ำ "ยกเลิก"', printV);
  const ent = await page.evaluate(() => {
    const e = DB.entries.find((x) => x.src === 'receipt' && x.status === 'posted');
    STATE.screen = 'journals'; STATE.sel = e.no; render();
    return { rev: !!document.querySelector('#main [data-act="rev:' + e.no + '"]'), go: !!document.querySelector('#main [data-act^="open:receipts:"]') };
  });
  ok('★ ใบสำคัญที่เกิดจากเอกสารไม่มีปุ่มกลับรายการตรง ๆ มีปุ่มไปที่เอกสารแทน', !ent.rev && ent.go);
  const blocked = await page.evaluate(() => {
    const inv = DB.docs.invoice.find((d) => d.status !== 'void' && periodOf(d.date) === '2026-07' && DB.docs.receipt.some((r) => r.invoiceNo === d.no && r.status !== 'void'));
    STATE.screen = 'invoices'; STATE.sel = inv.no; render();
    document.querySelector('#main [data-act="void:invoice:' + inv.no + '"]').click();
    return { modal: document.getElementById('modal').classList.contains('show'), toast: document.getElementById('toast').textContent };
  });
  ok('★ ใบกำกับที่มีใบเสร็จอ้างถึง กดยกเลิกแล้วบอกทันทีว่าต้องยกเลิกใบเสร็จก่อน ไม่เปิดหน้าต่างให้กรอก', !blocked.modal && /ใบเสร็จ/.test(blocked.toast), blocked.toast.slice(0, 60));
  await page.evaluate(() => { STATE.screen = 'payroll'; STATE.period = '2026-07'; STATE.sel = null; render(); });
  await page.click('#main [data-act="run:payroll"]');
  await page.click('#main [data-act^="voidrun:payroll:"]');
  await page.waitForSelector('#modal.show');
  await page.fill('#modal [name="reason"]', 'ทดสอบยกเลิกงวดเงินเดือน');
  await page.click('#modal [data-act="modal:submit"]');
  ok('ยกเลิกงวดเงินเดือนแล้วกลับมาเป็นปุ่มทำเงินเดือนใหม่ และแสดงประวัติการยกเลิก', await page.evaluate(() =>
    !!document.querySelector('#main [data-act="run:payroll"]') && /เคยทำแล้วยกเลิก/.test(document.getElementById('main').textContent)));

  console.log('\n[22] ใบลดหนี้หลายอัตรา รับคืนสินค้า และคืนเงินลูกค้า');
  const mixNo = await page.evaluate(() => {
    const c = DB.partners.find((p) => p.kind === 'customer' && p.taxId && p.address);
    const st = DB.items.find((i) => i.type === 'stock' && i.qty >= 5);
    const d = issueInvoice({ partnerCode: c.code, date:'2026-07-29', lines:[
      { desc: st.name, qty: 2, price:'1000', itemCode: st.code, taxCode:'VAT7' },
      { desc:'ค่าขนส่งต่างประเทศ', qty: 1, price:'500', taxCode:'VAT0' }] });
    save(); STATE.screen = 'creditnotes'; STATE.sel = null; render();
    return d.no;
  });
  await page.click('#main [data-act="new:creditnote"]');
  await page.waitForSelector('#modal.show [name="invoiceNo"]');
  await page.selectOption('#modal [name="invoiceNo"]', mixNo);
  await page.waitForSelector('#modal [name="taxCode"]');
  const cnForm = await page.evaluate(() => ({
    codes: [...document.querySelectorAll('#modal [name="taxCode"] option')].map((o) => o.value),
    ret: !!document.querySelector('#modal [name="ret0"]'),
    keep: document.querySelector('#modal [name="invoiceNo"]').value }));
  ok('★ เลือกใบกำกับหลายอัตราแล้วฟอร์มถามว่าลดหนี้รายการอัตราใด และมีช่องรับสินค้าคืน', cnForm.codes.join(',') === 'VAT7,VAT0' && cnForm.ret && cnForm.keep === mixNo);
  await page.selectOption('#modal [name="taxCode"]', 'VAT7');
  await page.fill('#modal [name="base"]', '1000');
  await page.fill('#modal [name="ret0"]', '1');
  await page.click('#modal [data-act="modal:submit"]');
  const cnDone = await page.evaluate((no) => {
    const c = DB.docs.creditNote.find((x) => x.invoiceNo === no);
    return c ? { vat: c.vat, ret: c.returns.length, cogs: !!c.cogsEntryNo, ok: reconciliationChecks('2026-07-31').allPassed } : null;
  }, mixNo);
  ok('★ ออกใบลดหนี้จากหน้าจอ ภาษี 7% ของรายการที่ลด และรับสินค้าคืนเข้าคลังพร้อมกลับต้นทุนขาย',
    cnDone && cnDone.vat === 700000 && cnDone.ret === 1 && cnDone.cogs && cnDone.ok, JSON.stringify(cnDone));

  const rfNo = await page.evaluate(() => {
    const c = DB.partners.find((p) => p.kind === 'customer' && p.taxId && p.address);
    const d = issueInvoice({ partnerCode: c.code, date:'2026-07-29', lines:[{ desc:'ค่าบริการทดสอบคืนเงิน', qty:1, price:'2000', taxCode:'VAT7' }] });
    receivePayment({ invoiceNo: d.no, date:'2026-07-29' });
    issueCreditNote({ invoiceNo: d.no, date:'2026-07-30', base:'500', reason:'PRICE_REDUCE' });
    save(); STATE.screen = 'invoices'; STATE.sel = d.no; render();
    return d.no;
  });
  const rfBtn = await page.evaluate((no) => ({ btn: !!document.querySelector('#main [data-act="refund:' + no + '"]'),
    pill: document.getElementById('main').textContent.indexOf('ลูกค้ามีเครดิต') >= 0 }), rfNo);
  ok('★ ลดหนี้หลังรับเงินครบ หน้าใบกำกับบอกว่าลูกค้ามีเครดิต และมีปุ่มคืนเงิน', rfBtn.btn && rfBtn.pill);
  await page.click('#main [data-act="refund:' + rfNo + '"]');
  await page.waitForSelector('#modal.show [name="amount"]');
  await page.click('#modal [data-act="modal:submit"]');
  const rfDone = await page.evaluate((no) => { const d = DB.docs.invoice.find((x) => x.no === no);
    return { out: invOutstanding(d), st: d.status, ok: reconciliationChecks('2026-07-31').allPassed,
      row: document.getElementById('main').textContent.indexOf('คืนเงินลูกค้า') >= 0 }; }, rfNo);
  ok('★ คืนเงินแล้วยอดค้างเป็นศูนย์ สถานะชำระครบ และลูกหนี้ยังตรงบัญชีคุม', rfDone.out === 0 && rfDone.st === 'paid' && rfDone.ok && rfDone.row, JSON.stringify(rfDone));

  console.log('\n[23] ทยอยรับสินค้าตามใบสั่งซื้อ และเลือกบัญชีค่าใช้จ่ายตอนตั้งหนี้');
  const poNo = await page.evaluate(() => {
    const it = DB.items.find((i) => i.code === 'SW-220');
    const po = issueTradeDoc('purchaseOrder', { partnerCode:'VEN-0004', date:'2026-07-20', lines:[{ desc: it.name, qty: 50, price:'100', itemCode: it.code }] });
    save(); STATE.screen = 'purchaseorders'; STATE.sel = po.no; render();
    return po.no;
  });
  await page.click('#main [data-act="grn:po:' + poNo + '"]');
  await page.waitForSelector('#modal.show [name="rq0"]');
  await page.fill('#modal [name="rq0"]', '20');
  await page.click('#modal [data-act="modal:submit"]');
  const part = await page.evaluate((no) => { const po = DB.docs.purchaseOrder.find((x) => x.no === no);
    STATE.screen = 'purchaseorders'; STATE.sel = no; render();
    return { st: po.status, got: poReceived(po)[0], btn: !!document.querySelector('#main [data-act="grn:po:' + no + '"]'),
      txt: document.getElementById('main').textContent.indexOf('ค้างรับ') >= 0 }; }, poNo);
  ok('★ รับ 20 จาก 50 ผ่านฟอร์ม ใบสั่งซื้อขึ้นว่ารับบางส่วน มีคอลัมน์ค้างรับ และกดรับส่วนที่เหลือต่อได้',
    part.st === 'partially_received' && part.got === 20 && part.btn && part.txt, JSON.stringify(part));
  await page.evaluate(() => { STATE.screen = 'bills'; STATE.sel = null; render(); });
  await page.click('#main [data-act="new:bill"]');
  await page.waitForSelector('#modal.show [name="acc"]');
  const accOpt = await page.evaluate(() => ({ def: document.querySelector('#modal [name="acc"]').value,
    has5311: [...document.querySelectorAll('#modal [name="acc"] option')].some((o) => o.value === '5321') }));
  ok('★ ฟอร์มตั้งหนี้ให้เลือกบัญชีค่าใช้จ่ายเจาะจง ค่าเริ่มต้นเป็นค่าใช้จ่ายเบ็ดเตล็ด ไม่ใช่บัญชีเงินเดือน', accOpt.def === '5358' && accOpt.has5311, accOpt.def);
  await page.keyboard.press('Escape');

  console.log('\n[24] ตาราง: ตัวกรองสถานะ มุมมองที่บันทึก ความหนาแน่น หัวตารางติด และเมนูคลิกขวา');
  await page.evaluate(() => { STATE.period = '2026-06'; STATE.screen = 'invoices'; STATE.sel = null; STATE.filter = ''; STATE.chip = {}; render(); });
  const chipAll = await page.evaluate(() => document.querySelectorAll('#main tbody tr').length);
  await page.click('#main [data-act="chip:invoices:open"]');
  const chipOpen = await page.evaluate(() => ({ rows: document.querySelectorAll('#main tbody tr').length,
    want: DB.docs.invoice.filter((d) => periodOf(d.date) === '2026-06' && invOutstanding(d) > 0).length,
    badge: document.querySelector('#main [data-act="chip:invoices:open"] .chip-n').textContent }));
  ok('★ กดตัวกรอง "ค้างรับ" แล้วเหลือเฉพาะใบที่ยังค้าง จำนวนบนป้ายตรงกับแถวในตาราง', chipOpen.rows === chipOpen.want
    && String(chipOpen.want) === chipOpen.badge && chipOpen.rows < chipAll, chipOpen.rows + ' จาก ' + chipAll);
  await page.click('#main [data-act="viewsave"]');
  await page.waitForSelector('#modal.show [name="viewName"]');
  await page.fill('#modal [name="viewName"]', 'ลูกหนี้ค้าง มิ.ย.');
  await page.click('#modal [data-act="modal:submit"]');
  await page.evaluate(() => { STATE.chip = {}; STATE.screen = 'dashboard'; render(); });
  const viewOk = await page.evaluate(() => { const v = savedViews().find((x) => x.name === 'ลูกหนี้ค้าง มิ.ย.'); openView(v.id);
    return { screen: STATE.screen, chip: STATE.chip.invoices, chipOn: !!document.querySelector('#main [data-act="chip:invoices:open"].on'),
      listed: !!document.querySelector('#main [data-act="sview:' + v.id + '"]') }; });
  ok('★ บันทึกมุมมองแล้วเปิดกลับมาได้ ตัวกรองกลับมาครบ และมีป้ายมุมมองในแถบตัวกรอง', viewOk.screen === 'invoices' && viewOk.chip === 'open'
    && viewOk.chipOn && viewOk.listed);
  const inCmdk = await page.evaluate(() => { openCmdk('ลูกหนี้ค้าง'); const t = document.getElementById('cmdk').textContent; closeCmdk(); return t; });
  ok('ค้นมุมมองที่บันทึกไว้ใน Ctrl K ได้', inCmdk.indexOf('ลูกหนี้ค้าง มิ.ย.') >= 0);

  await page.click('#densityBtn');
  const dens = await page.evaluate(() => ({ attr: document.documentElement.getAttribute('data-density'), saved: localStorage.getItem('financii.density'),
    pad: getComputedStyle(document.querySelector('#main tbody td')).paddingTop }));
  ok('★ ปุ่มความหนาแน่นสลับตารางเป็นแบบกระชับ และจำไว้ในเครื่อง', dens.attr === 'compact' && dens.saved === 'compact' && dens.pad === '5px', JSON.stringify(dens));
  await page.evaluate(() => setDensity('normal'));

  const sticky = await page.evaluate(() => { STATE.screen = 'journals'; STATE.period = '2026-06'; render();
    const sc = document.querySelector('#main .scroll.tall');
    return sc ? { th: getComputedStyle(sc.querySelector('thead th')).position, h: sc.clientHeight < sc.scrollHeight } : null; });
  ok('★ ตารางยาวเลื่อนในกรอบ หัวตารางติดอยู่ด้านบนเสมอ', sticky && sticky.th === 'sticky' && sticky.h, JSON.stringify(sticky));

  await page.evaluate(() => { STATE.screen = 'invoices'; STATE.chip = {}; render(); });
  await page.click('#main tbody tr.row-link', { button: 'right' });
  const menu = await page.evaluate(() => ({ show: document.getElementById('rowMenu').classList.contains('show'),
    items: [...document.querySelectorAll('#rowMenu .rm-i')].map((b) => b.textContent) }));
  ok('★ คลิกขวาที่แถวเอกสาร มีเมนูเปิด พิมพ์ ดูใบสำคัญ และยกเลิกเอกสาร', menu.show && menu.items.some((t) => t === 'พิมพ์')
    && menu.items.some((t) => t.indexOf('ดูใบสำคัญ') === 0) && menu.items.some((t) => t.indexOf('ยกเลิกเอกสาร') === 0), menu.items.join(' | '));
  await page.keyboard.press('Escape');
  ok('Esc ปิดเมนูคลิกขวา', !(await page.evaluate(() => document.getElementById('rowMenu').classList.contains('show'))));
  await page.click('#main tbody tr.row-link', { button: 'right' });
  await page.click('#rowMenu .rm-i:has-text("พิมพ์")');
  ok('เลือก "พิมพ์" จากเมนูคลิกขวาแล้วเปิดตัวอย่างก่อนพิมพ์', await page.evaluate(() => document.getElementById('printArea').classList.contains('show')));
  await page.keyboard.press('Escape');

  console.log('\n[25] เจาะดูตัวเลข — คลิกแล้วเห็นที่มา และผลรวมตรงกับตัวเลขที่คลิกทุกบรรทัด');
  const peekAll = await page.evaluate(() => {
    STATE.period = '2026-07';
    const out = { n: 0, bad: [] };
    const chk = (label) => { out.n++; const c = document.querySelector('#peek .pk-chk'); if (!c || c.className.indexOf('ok') < 0) out.bad.push(label); };
    STATE.screen = 'tb'; render(); [...document.querySelectorAll('#main tbody tr.row-link')].forEach((tr, i) => { tr.click(); chk('tb' + i); });
    STATE.screen = 'bs'; render(); [...document.querySelectorAll('#main tr.peekable')].forEach((tr, i) => { tr.click(); chk('bs' + i); });
    STATE.screen = 'pl'; render(); [...document.querySelectorAll('#main td.peekable')].forEach((td, i) => { td.click(); chk('pl' + i); });
    ['ar', 'ap'].forEach((k) => { STATE.screen = k; render(); [...document.querySelectorAll('#main tbody tr.row-link')].forEach((tr, i) => { tr.click(); chk(k + i); }); });
    closePeek();
    return out;
  });
  ok('★ ทุกตัวเลขในงบทดลอง งบการเงิน และอายุหนี้ เจาะดูได้ และผลรวมรายการตรงกับตัวเลขที่คลิกทุกบรรทัด', peekAll.n > 50 && !peekAll.bad.length,
    peekAll.n + ' จุด' + (peekAll.bad.length ? ' ไม่ตรง ' + peekAll.bad.join(',') : ''));
  await page.evaluate(() => { STATE.screen = 'bs'; render(); });
  await page.click('#main tr.peekable >> nth=1');
  await page.click('#peek .row-link >> nth=0');
  const deep = await page.evaluate(() => ({ back: !!document.querySelector('#peek [data-act="peekback"]'), ledger: !!document.querySelector('#peek [data-act^="peekgo:drill:"]') }));
  ok('เจาะจากบรรทัดในงบลงไปถึงรายการรายบัญชีได้ และย้อนกลับได้', deep.back && deep.ledger);
  await page.click('#peek [data-act^="peekgo:drill:"]');
  ok('ปุ่มเปิดบัญชีแยกประเภทเต็ม พาไปหน้าแยกประเภทและปิดแผง', await page.evaluate(() => STATE.screen === 'ledger' && !document.getElementById('peek').classList.contains('show')));

  console.log('\n[26] ปี พ.ศ./ค.ศ. บนจอ และเอกสารหลายหน้ายกยอดไป–ยกมา');
  await page.evaluate(() => { STATE.screen = 'settings'; render(); });
  await page.click('#main [data-act="era:ce"]');
  const era = await page.evaluate(() => {
    STATE.screen = 'invoices'; STATE.period = '2026-07'; render();
    const d = DB.docs.invoice.find((x) => periodOf(x.date) === '2026-07');
    const row = [...document.querySelectorAll('#main tbody tr')].find((tr) => tr.textContent.indexOf(d.no) >= 0);
    printDoc('invoice', d.no);
    const pr = document.querySelector('#printArea .sheet').textContent;
    closePrint();
    return { saved: localStorage.getItem('financii.era'), period: document.getElementById('periodSel').selectedOptions[0].textContent,
      row: row.textContent, printBE: pr.indexOf('2569') >= 0 && pr.indexOf(' 2026') < 0 };
  });
  ok('★ เลือกแสดงปี ค.ศ. แล้ววันที่บนจอเป็น ค.ศ. ทั้งงวดบัญชีและรายการ', era.saved === 'ce' && era.period.indexOf('2026') >= 0
    && /\/2026/.test(era.row), era.period);
  ok('★ เอกสารที่พิมพ์ยังเป็นปี พ.ศ. เสมอ แม้จอจะแสดง ค.ศ.', era.printBE);
  await page.evaluate(() => setEra('be'));
  ok('สลับกลับเป็น พ.ศ. ได้', await page.evaluate(() => document.getElementById('periodSel').selectedOptions[0].textContent.indexOf('2569') >= 0));

  await page.evaluate(() => {
    const lines = []; for (let i = 0; i < 70; i++) lines.push({ acc: '5358', dr: M(String(100 + i) + '.25'), cr: 0, memo: 'ปรับปรุงรายการที่ ' + (i + 1) });
    lines.push({ acc: '1113', dr: 0, cr: lines.reduce((s, l) => s + l.dr, 0) });
    const e = post({ type: 'general', date: '2026-07-30', desc: 'ทดสอบใบสำคัญยาวหลายหน้า', lines });
    save(); printDoc('entry', e.no); window.__longEntry = e.no;
  });
  await page.waitForTimeout(1200);
  const pg = await page.evaluate(() => {
    const e = DB.entries.find((x) => x.no === window.__longEntry);
    const probe = document.createElement('div'); probe.style.cssText = 'position:absolute;height:297mm'; document.body.appendChild(probe);
    const A4 = probe.getBoundingClientRect().height; probe.remove();
    const sheets = [...document.querySelectorAll('#printArea .sheet')];
    let cumDr = 0, okCarry = true;
    sheets.forEach(function (s, i) {
      const carryIn = s.querySelector('tr.p-carry:first-child');
      if (i > 0 && (!carryIn || M(carryIn.cells[4].textContent) !== cumDr)) okCarry = false;
      [...s.querySelectorAll('table.p-items tbody tr:not(.p-carry):not(.p-totrow)')].forEach((tr) => { cumDr += M(tr.cells[4].textContent); });
      const carryOut = i < sheets.length - 1 ? s.querySelector('tr.p-carry:last-child') : null;
      if (carryOut && M(carryOut.cells[4].textContent) !== cumDr) okCarry = false;
    });
    const last = sheets[sheets.length - 1];
    const res = { n: sheets.length, over: sheets.some((s) => s.getBoundingClientRect().height > A4 + 1), okCarry, cumDr, total: e.total,
      totLast: !!last.querySelector('tr.p-totrow') && sheets.slice(0, -1).every((s) => !s.querySelector('tr.p-totrow') && !s.querySelector('.p-sign')),
      pages: sheets.map((s) => (s.querySelector('.p-page') || {}).textContent).join(','), head: sheets.every((s) => !!s.querySelector('.p-head')) };
    closePrint();
    return res;
  });
  ok('★ ใบสำคัญ 71 บรรทัดแบ่งเป็นหลายหน้า ไม่มีหน้าไหนล้นกระดาษ A4 และทุกหน้ามีหัวเอกสาร', pg.n > 1 && !pg.over && pg.head, pg.n + ' หน้า');
  ok('★ ยอดยกไปของแต่ละหน้าเท่ายอดสะสมพอดี และหน้าถัดไปยกมาเท่ากัน ผลรวมสุดท้ายเท่ายอดใบสำคัญ', pg.okCarry && pg.cumDr === pg.total,
    'เดบิตรวม ' + pg.cumDr + ' = ' + pg.total);
  ok('บรรทัดรวมและช่องลงนามอยู่หน้าสุดท้ายเท่านั้น ท้ายกระดาษบอกหน้า X/Y', pg.totLast && /หน้า 1\/\d+/.test(pg.pages), pg.pages);

  console.log('\n[27] ลบบริษัทที่เพิ่มผิด — สำรองไฟล์ให้ก่อน ย้ายไปถังขยะ กู้คืนได้');
  const firstCo = await page.evaluate(() => ({ book: SYNC.book, name: DB.company.name, entries: DB.entries.length }));
  await page.evaluate(() => { save(); return createCompany({ name:'บริษัท เพิ่มผิด จำกัด', taxId:'', address:'ทดสอบ', year:'2026' }); });
  await page.waitForTimeout(200);
  const two = await page.evaluate(() => ({ books: SYNC.books.length, active: DB.company.name, book: SYNC.book }));
  ok('เพิ่มบริษัทที่สองแล้วมีสองเล่ม', two.books >= 2 && two.active === 'บริษัท เพิ่มผิด จำกัด');
  await page.evaluate(() => { const f = () => {}; post({ type:'general', date: DB.periods[0].start, desc:'รายการในบริษัทที่เพิ่มผิด',
    lines:[{ acc: accBySub('bank'), dr: M('500') }, { acc: accBySub('other_income'), cr: M('500') }] }); save(); });
  await page.click('[data-act="company:manage"]');
  await page.waitForSelector('#main [data-act^="company:delete:"]');
  ok('★ หน้าตั้งค่ามีรายชื่อบริษัททั้งหมดพร้อมปุ่มลบ', await page.evaluate(() =>
    document.querySelectorAll('#main [data-act^="company:delete:"]').length >= 2));
  await page.click('#main [data-act="company:delete:' + two.book + '"]');
  await page.waitForSelector('#modal.show [name="confirmName"]');
  const delInfo = await page.$eval('#modal .void-prev', (e) => e.textContent);
  ok('หน้าต่างลบบอกว่ามีอะไรอยู่ในบริษัทนี้ และจะดาวน์โหลดไฟล์สำรองให้ก่อน', /ใบสำคัญ 1 ใบ/.test(delInfo) && /ไฟล์สำรอง/.test(delInfo), delInfo.slice(0, 80));
  await page.fill('#modal [name="confirmName"]', 'บริษัท เพิ่มผิด');
  await page.fill('#modal [name="reason"]', 'เพิ่มซ้ำ ทดสอบระบบ');
  await page.click('#modal [data-act="modal:submit"]');
  ok('★ พิมพ์ชื่อไม่ตรง ระบบไม่ลบ', await page.evaluate((b) => SYNC.books.some((x) => x.book === b)
    && document.getElementById('modal').classList.contains('show'), two.book));
  await page.fill('#modal [name="confirmName"]', 'บริษัท เพิ่มผิด จำกัด');
  const [bk] = await Promise.all([page.waitForEvent('download'), page.click('#modal [data-act="modal:submit"]')]);
  await page.waitForTimeout(300);
  const bkPath = require('path').join(require('os').tmpdir(), bk.suggestedFilename());
  await bk.saveAs(bkPath);
  const bkJson = JSON.parse(require('fs').readFileSync(bkPath, 'utf8'));
  ok('★ ดาวน์โหลดไฟล์สำรองของบริษัทที่ลบก่อนลบ มีข้อมูลครบทั้งเล่ม', bkJson.format === 'financii-backup/1'
    && bkJson.DB.company.name === 'บริษัท เพิ่มผิด จำกัด' && bkJson.DB.entries.length === 1 && /^Financii-backup-.*\.json$/.test(bk.suggestedFilename()),
    bk.suggestedFilename());
  const afterDel = await page.evaluate((b) => ({ gone: !SYNC.books.some((x) => x.book === b), active: DB.company.name,
    trash: COMPANY.trash.length, row: document.getElementById('main').textContent.indexOf('ถังขยะ') >= 0 }), two.book);
  ok('★ บริษัทที่ลบหายจากรายชื่อ ระบบสลับไปบริษัทเดิม และย้ายไปอยู่ในถังขยะ', afterDel.gone && afterDel.active === firstCo.name
    && afterDel.trash === 1 && afterDel.row, JSON.stringify(afterDel));
  ok('บริษัทเดิมข้อมูลครบเท่าเดิม', await page.evaluate((n) => DB.entries.length === n, firstCo.entries));
  const tid = await page.evaluate(() => COMPANY.trash[0].id);
  await page.click('#main [data-act="company:restore:' + tid + '"]');
  await page.waitForTimeout(300);
  const restored = await page.evaluate(() => ({ book: SYNC.books.find((x) => x.name === 'บริษัท เพิ่มผิด จำกัด'), trash: COMPANY.trash.length }));
  ok('★ กู้คืนจากถังขยะได้ บริษัทกลับมาในรายชื่อ', !!restored.book && restored.trash === 0);
  await page.evaluate((b) => switchCompany(b), restored.book.book);
  await page.waitForTimeout(200);
  ok('เปิดบริษัทที่กู้คืนแล้วรายการบัญชีครบ', await page.evaluate(() => DB.company.name === 'บริษัท เพิ่มผิด จำกัด' && DB.entries.length === 1));
  await page.evaluate((b) => switchCompany(b), firstCo.book);
  await page.waitForTimeout(200);

  /* เปิดไฟล์สำรองกลับเป็นบริษัทแยกเล่ม */
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  const nBooks = await page.evaluate(() => SYNC.books.length);
  await page.setInputFiles('#file', bkPath);
  await page.waitForTimeout(500);
  const fromFile = await page.evaluate(() => ({ name: DB.company.name, entries: DB.entries.length, books: SYNC.books.length }));
  ok('★ ลากไฟล์สำรองเข้าหน้านำเข้าข้อมูล เปิดเป็นบริษัทใหม่แยกเล่ม ไม่ทับบริษัทเดิม', fromFile.name === 'บริษัท เพิ่มผิด จำกัด'
    && fromFile.entries === 1 && fromFile.books === nBooks + 1, JSON.stringify(fromFile));
  await page.evaluate((b) => switchCompany(b), firstCo.book);
  await page.waitForTimeout(200);

  /* ลบให้เหลือบริษัทเดียว แล้วลบไม่ได้ */
  for (let k = 0; k < 5; k++) {
    const target = await page.evaluate((keep) => { const b = SYNC.books.find((x) => x.book !== keep); return b ? { book: b.book, name: b.name } : null; }, firstCo.book);
    if (!target) break;
    await page.evaluate(() => { STATE.screen = 'settings'; render(); });
    await page.click('#main [data-act="company:delete:' + target.book + '"]');
    await page.waitForSelector('#modal.show [name="confirmName"]');
    await page.fill('#modal [name="confirmName"]', target.name);
    await page.fill('#modal [name="reason"]', 'ล้างข้อมูลทดสอบ');
    await Promise.all([page.waitForEvent('download'), page.click('#modal [data-act="modal:submit"]')]);
    await page.waitForTimeout(250);
  }
  const last = await page.evaluate(() => { STATE.screen = 'settings'; render();
    const b = document.querySelector('#main [data-act^="company:delete:"]');
    return { books: SYNC.books.length, disabled: b && b.disabled, name: DB.company.name }; });
  ok('★ เหลือบริษัทเดียวแล้วปุ่มลบใช้ไม่ได้ ระบบต้องมีอย่างน้อย 1 บริษัท', last.books === 1 && last.disabled && last.name === firstCo.name);
  await page.evaluate(() => refreshTrash().then(render));
  await page.waitForTimeout(200);
  const pid = await page.evaluate(() => COMPANY.trash[0] && COMPANY.trash[0].id);
  const pname = await page.evaluate(() => COMPANY.trash[0] && COMPANY.trash[0].name);
  await page.click('#main [data-act="company:purge:' + pid + '"]');
  await page.waitForSelector('#modal.show [name="confirmName"]');
  await page.fill('#modal [name="confirmName"]', pname);
  await page.click('#modal [data-act="modal:submit"]');
  await page.waitForTimeout(250);
  ok('ลบถาวรจากถังขยะได้เมื่อพิมพ์ชื่อยืนยันถูก', await page.evaluate((id) => !COMPANY.trash.some((x) => x.id === id)
    && !localStorage.getItem('financii.trash.' + id), pid));

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
