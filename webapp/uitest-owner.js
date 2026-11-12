/* ทดสอบหน้าเจ้าของ: ยอดขาย กำไร เทียบค่าแอด รายวัน — รันด้วย node webapp/uitest-owner.js (สร้าง index.html ก่อน)
   ส่วนที่ 1–3 เปิดไฟล์ตรง (เก็บในเบราว์เซอร์) · ส่วนที่ 4 ต้องมี DATABASE_URL — เปิดผ่าน server.js จริง ทดสอบรหัสร่วมกับรหัสเจ้าของ */
const { spawn } = require('child_process');
const path = require('path');
const T = require('./uitestlib');
const ok = T.ok;
const { chromium } = require('/opt/node22/lib/node_modules/playwright');

(async () => {
  const { page, errors } = await T.open();
  await T.blank(page, '2026-10');
  await page.evaluate(() => {
    const cust = savePartner({ kind:'customer', name:'บริษัท ลูกค้าดี จำกัด', taxId:'0105540022881', branch:'00000', address:'1 ถนนสุขุมวิท', termDays: 30 }).partner.code;
    const it = saveItem({ name:'ครีม ก', type:'stock', uom:'ชิ้น', price:'300' }).item.code;
    saveStockAdj({ kind:'opening', date:'2026-10-01', lines:[{ itemCode: it, qty: 50, value:'5000' }] });
    issueInvoice({ partnerCode: cust, date:'2026-10-02', lines:[{ itemCode: it, desc:'ครีม ก', qty: 5, price:'300', taxCode:'VAT7' }] });
    issueInvoice({ partnerCode: cust, date:'2026-10-03', lines:[{ itemCode: it, desc:'ครีม ก', qty: 2, price:'300', taxCode:'VAT7' }] });
    save(); STATE.screen = 'dashboard'; render();
  });

  console.log('\n[1] เมนูและหน้าเจ้าของ (เปิดแบบเก็บในเบราว์เซอร์ = ผู้ใช้คนเดียว เห็นหน้าเจ้าของ)');
  const navHas = () => page.evaluate(() => Array.from(document.querySelectorAll('#nav .nav-i')).some((e) => /ยอดขาย กำไร ค่าแอด/.test(e.textContent)));
  ok('เมนูภาพรวมมี "ยอดขาย กำไร ค่าแอด"', await navHas());
  await page.evaluate(() => dispatch('go:ownerdaily'));
  await page.waitForTimeout(250);
  const k0 = await page.evaluate(() => document.querySelector('#main .kpis').textContent);
  ok('★ ยอดขาย 2,100 (ก่อนภาษี) กำไรขั้นต้น 1,400 ก่อนมีค่าแอด', /2,100\.00/.test(k0) && /1,400\.00/.test(k0), k0.slice(0, 120));

  console.log('\n[2] กรอกค่าแอด แก้ ลบ เลือกร้าน');
  async function addAd(date, shop, amount) {
    await page.click('#main [data-act="owner:ad"]');
    await page.waitForSelector('#modal.show');
    await page.fill('#modal [name="adDate"]', date);
    await page.fill('#modal [name="adShop"]', shop);
    await page.fill('#modal [name="adAmount"]', amount);
    await page.click('#modal [data-act="modal:submit"]');
    await T.closed(page);
    await page.waitForTimeout(200);
  }
  await addAd('2026-10-02', 'TikTok ร้าน A', '400');
  await addAd('2026-10-02', 'TikTok ร้าน B', '100.50');
  await addAd('2026-10-03', 'TikTok ร้าน A', '900');
  const row = (d) => page.evaluate((d) => { const tr = Array.from(document.querySelectorAll('#main table.dt tbody tr')).find((x) => x.textContent.indexOf(d) >= 0);
    return tr ? Array.from(tr.querySelectorAll('td')).map((td) => td.textContent.trim()) : null; }, d);
  const r2 = await row('02/10/2569');
  ok('★ 2 ต.ค.: ขาย 1,500 ต้นทุน 500 กำไรขั้นต้น 1,000 ค่าแอด 500.50 กำไรหลังค่าแอด 499.50 ROAS 3.00', r2 && r2[1] === '1,500.00'
    && r2[2] === '500.00' && r2[4] === '500.50' && r2[5] === '499.50' && r2[6] === '3.00 เท่า', JSON.stringify(r2));
  const r3 = await row('03/10/2569');
  ok('★ 3 ต.ค. ค่าแอด 900 มากกว่ากำไรขั้นต้น 400 → ขาดทุน (500.00) แสดงสีติดลบ', r3 && r3[5] === '(500.00)'
    && await page.evaluate(() => Array.from(document.querySelectorAll('#main table.dt tbody tr')).find((x) => /03\/10\/2569/.test(x.textContent)).querySelectorAll('td')[5].classList.contains('neg')), JSON.stringify(r3));
  const k1 = await page.evaluate(() => document.querySelector('#main .kpis').textContent);
  ok('สรุปบนสุด: ค่าแอด 1,400.50 กำไรหลังค่าแอด (0.50) ขาดทุน 1 วัน', /1,400\.50/.test(k1) && /\(0\.50\)/.test(k1) && /ขาดทุนหลังค่าแอด 1 วัน/.test(k1), k1.slice(0, 200));
  ok('กราฟรายวันมีแท่งยอดขายและค่าแอด พร้อมคำอธิบาย', await page.evaluate(() => document.querySelectorAll('#main svg.chart path.mk').length === 4
    && /ยอดขาย/.test(document.querySelector('#main .legend').textContent) && /ค่าแอด/.test(document.querySelector('#main .legend').textContent)));
  await page.click('#main [data-act="ownshop:' + encodeURIComponent('TikTok ร้าน B') + '"]');
  await page.waitForTimeout(150);
  const kB = await page.evaluate(() => document.querySelector('#main .kpis').textContent);
  ok('★ เลือกเฉพาะร้าน B: ค่าแอด 100.50 ยอดขายเท่าเดิม', /100\.50/.test(kB) && /2,100\.00/.test(kB), kB.slice(0, 160));
  await page.click('#main [data-act="ownshop:"]');
  await page.waitForTimeout(150);
  await page.click('#main [data-act="owner:edit:' + encodeURIComponent('2026-10-03|TikTok ร้าน A') + '"]');
  await page.waitForSelector('#modal.show');
  await page.fill('#modal [name="adAmount"]', '300');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  await page.waitForTimeout(200);
  const r3b = await row('03/10/2569');
  ok('แก้ค่าแอด 3 ต.ค. เป็น 300 → กำไรหลังค่าแอด 100.00', r3b && r3b[4] === '300.00' && r3b[5] === '100.00', JSON.stringify(r3b));
  await page.click('#main [data-act="owner:del:' + encodeURIComponent('2026-10-02|TikTok ร้าน B') + '"]');
  await page.waitForTimeout(250);
  ok('ลบค่าแอดร้าน B แล้วเหลือ 2 รายการ', await page.evaluate(() => OWNER.ads.length === 2));
  await page.click('#main [data-act="owner:ad"]');
  await page.waitForSelector('#modal.show');
  await page.fill('#modal [name="adAmount"]', '-5');
  await page.click('#modal [data-act="modal:submit"]');
  await page.waitForTimeout(150);
  ok('ค่าแอดติดลบไม่รับ หน้าต่างยังเปิดอยู่', await page.evaluate(() => document.getElementById('modal').classList.contains('show')
    && /ตั้งแต่ 0/.test(document.getElementById('toast').textContent)));
  await page.click('#modal [data-act="modal:close"]');

  console.log('\n[3] จอโทรศัพท์');
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => render());
  await page.waitForTimeout(150);
  ok('หน้าเจ้าของบนจอ 375px ไม่ล้นแนวนอน', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('ไม่มีข้อผิดพลาดในคอนโซล (ส่วนเก็บในเบราว์เซอร์)', errors.length === 0, errors.slice(0, 2).join(' | '));

  console.log('\n[4] ผ่านเซิร์ฟเวอร์จริง: รหัสร่วมไม่เห็น รหัสเจ้าของเห็น SellerHub ส่งค่าแอดเข้ามา');
  if (!process.env.DATABASE_URL) {
    console.log('  (ข้าม — ไม่ได้ตั้ง DATABASE_URL)');
  } else {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('DROP TABLE IF EXISTS financii_state, financii_state_history, financii_trash, financii_ad_spend');
    await c.end();
    const PORT = 3931;
    const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
      env: { ...process.env, PORT: String(PORT), APP_PASSCODE: 'staff-111', APP_OWNER_PASSCODE: 'owner-999', APP_INGEST_KEY: 'k-123' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    srv.stdout.on('data', (d) => { log += d; });
    srv.stderr.on('data', (d) => { log += d; });
    for (let i = 0; i < 60 && !/พอร์ต/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
    const browser = await chromium.launch();
    try {
      const p = await browser.newPage({ viewport: { width: 1440, height: 950 } });
      const errs = [];
      p.on('pageerror', (e) => errs.push(e.message));
      p.on('dialog', (d) => d.accept());
      const base = 'http://127.0.0.1:' + PORT + '/';
      await p.goto(base);
      await p.waitForSelector('[name="passcode"]');
      await p.fill('[name="passcode"]', 'staff-111');
      await p.click('[data-act="pass:submit"]');
      await p.waitForFunction(() => SYNC.role !== null, null, { timeout: 15000 });
      const st = await p.evaluate(() => ({ role: SYNC.role, nav: Array.from(document.querySelectorAll('#nav .nav-i')).some((e) => /ค่าแอด/.test(e.textContent)) }));
      ok('★ เข้าด้วยรหัสร่วม: สิทธิ์ staff ไม่มีเมนูยอดขาย กำไร ค่าแอด', st.role === 'staff' && !st.nav, JSON.stringify(st));
      await p.evaluate(() => dispatch('go:ownerdaily'));
      await p.waitForTimeout(300);
      ok('รหัสร่วมเปิดหน้าเจ้าของตรง ๆ ก็เห็นแค่ข้อความให้เข้าด้วยรหัสเจ้าของ', await p.evaluate(() => /หน้านี้สำหรับเจ้าของ/.test(document.getElementById('main').textContent)
      && !document.querySelector('#main .kpis')));
      const ing = await fetch(base + 'api/ingest/ad-spend', { method: 'POST', headers: { authorization: 'Bearer k-123', 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'sellerhub', items: [{ date: '2026-07-10', shop: 'TikTok ร้าน A', amount: 1234.5 }] }) });
      ok('SellerHub ส่งค่าแอดเข้ามาด้วยกุญแจได้', ing.status === 200);
      await p.evaluate(() => dispatch('go:settings'));
      await p.waitForTimeout(200);
      ok('หน้าตั้งค่ามีการ์ดการเข้าใช้งาน ปุ่มเข้าสู่ระบบเจ้าของและออกจากระบบ', await p.evaluate(() => !!document.querySelector('#main [data-act="owner:login"]')
        && !!document.querySelector('#main [data-act="owner:logout"]')));
      await p.click('#main [data-act="owner:login"]');
      await p.waitForSelector('#modal.show');
      await p.fill('#modal [name="ownerPass"]', 'ผิด');
      await p.click('#modal [data-act="modal:submit"]');
      await p.waitForTimeout(500);
      ok('รหัสเจ้าของผิด ไม่ได้สิทธิ์ และยังใช้งานด้วยรหัสร่วมต่อได้', await p.evaluate(() => SYNC.role === 'staff' && SYNC.passcode === 'staff-111'));
      await p.fill('#modal [name="ownerPass"]', 'owner-999');
      await p.click('#modal [data-act="modal:submit"]');
      await p.waitForFunction(() => SYNC.role === 'owner', null, { timeout: 10000 });
      await p.evaluate(() => { STATE.period = '2026-07'; OWNER.key = ''; render(); });
      await p.waitForFunction(() => OWNER.ads.length > 0, null, { timeout: 10000 });
      const ow = await p.evaluate(() => ({ nav: Array.from(document.querySelectorAll('#nav .nav-i')).some((e) => /ค่าแอด/.test(e.textContent)),
        list: document.getElementById('main').textContent }));
      ok('★ เข้าด้วยรหัสเจ้าของ: มีเมนู เห็นค่าแอดที่ SellerHub ส่งมา 1,234.50', ow.nav && /1,234\.50/.test(ow.list) && /SellerHub/.test(ow.list));
      ok('การ์ดเชื่อม SellerHub บอกที่อยู่ส่งข้อมูลและสมุดบัญชี', /\/api\/ingest\/ad-spend/.test(ow.list) && /เปิดรับข้อมูลแล้ว/.test(ow.list));
      await p.click('#main [data-act="owner:logout"]');
      await p.waitForSelector('[name="passcode"]', { timeout: 10000 });
      ok('★ ออกจากระบบแล้วเบราว์เซอร์ลืมรหัส กลับมาหน้าใส่รหัสผ่าน', await p.evaluate(() => !localStorage.getItem('financii.passcode')));
      ok('ไม่มีข้อผิดพลาดในคอนโซล (ส่วนเซิร์ฟเวอร์)', errs.length === 0, errs.slice(0, 2).join(' | '));
    } finally {
      await browser.close();
      srv.kill();
    }
  }
  /* T.done ตรวจข้อผิดพลาดของหน้าแรกซ้ำ — หน้าแรกตรวจไปแล้วข้างบน */
  errors.length = 0;
  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
