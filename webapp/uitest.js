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
    const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
      + rows.map(function (r, ri) {
          return '<row r="' + (ri + 1) + '">' + r.map(function (c, ci) {
            if (c === '') return '';
            const ref = String.fromCharCode(65 + ci) + (ri + 1);
            return /^\d+$/.test(c)
              ? '<c r="' + ref + '"><v>' + c + '</v></c>'
              : '<c r="' + ref + '" t="inlineStr"><is><t>' + esc2(c) + '</t></is></c>';
          }).join('') + '</row>';
        }).join('')
      + '</sheetData></worksheet>';
    const blob = zip([
      { name: '[Content_Types].xml', text: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
      { name: 'xl/worksheets/sheet1.xml', text: sheet },
    ]);
    window.__xlsx = new File([blob], 'งบทดลอง.xlsx');
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
