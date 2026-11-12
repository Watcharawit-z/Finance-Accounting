/* ทดสอบหน้าจอวิธีบันทึกสินค้าแบบสิ้นงวด — รันด้วย node webapp/uitest-periodic.js (สร้าง index.html ก่อน)
   หน้าตั้งค่าเปลี่ยนวิธี → ฟอร์มตั้งหนี้เลือกสินค้าแล้วบัญชีเป็นซื้อสินค้า → หน้าปิดงวดกดปรับปรุงสินค้าปลายงวด */
const T = require('./uitestlib');
const ok = T.ok;

(async () => {
  const { page } = await T.open();
  const go = (s) => page.evaluate((s) => { STATE.screen = s; STATE.sel = null; render(); }, s);
  await T.blank(page, '2026-01');
  const k = await page.evaluate(() => {
    const ven = savePartner({ kind:'vendor', name:'บริษัท ขายส่ง จำกัด', taxId:'0105533001823', branch:'00000', address:'3 ถนนบางนา', termDays: 30 }).partner;
    const it = saveItem({ name:'สินค้า ก', type:'stock', uom:'ชิ้น', price:'200' }).item;
    saveStockAdj({ kind:'opening', date:'2026-01-02', lines:[{ itemCode: it.code, qty: 10, value:'1000' }] });
    const gr = issueGoodsReceipt({ partnerCode: ven.code, date:'2026-01-05', lines:[{ itemCode: it.code, desc:'สินค้า ก', qty: 5, price:'120' }] });
    save(); render();
    return { ven: ven.code, it: it.code, gr: gr.no };
  });

  console.log('\n[1] หน้าตั้งค่า: วิธีบันทึกสินค้าคงเหลือ');
  await go('settings');
  const card0 = await page.evaluate(() => { const h = Array.from(document.querySelectorAll('#main .card h2')).find((x) => /วิธีบันทึกสินค้า/.test(x.textContent));
    return h ? h.closest('.card').textContent : ''; });
  ok('หน้าตั้งค่ามีการ์ด "วิธีบันทึกสินค้าคงเหลือ" บอกว่าตอนนี้เป็นแบบต่อเนื่อง', /แบบต่อเนื่อง \(Perpetual\)/.test(card0) && /สินค้าคงเหลือ/.test(card0));
  await page.click('#main [data-act="invmethod:periodic"]');
  await page.waitForSelector('#modal.show');
  const mtxt = await page.textContent('#modal');
  ok('★ ก่อนเปลี่ยนบอกสิ่งที่ระบบจะทำ: ใบรับสินค้าที่ลงไว้ 1 ใบ ลงใหม่เข้าซื้อสินค้า', /ใบรับสินค้า 1 ใบ ลงใหม่เข้า "ซื้อสินค้า"/.test(mtxt), mtxt.slice(0, 160));
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  const st = await page.evaluate((gr) => ({ periodic: invPeriodic(), card: Array.from(document.querySelectorAll('#main .card')).map((c) => c.textContent).find((t) => /วิธีบันทึกสินค้า/.test(t)) || '',
    grAcc: DB.entries.find((e) => e.no === DB.docs.goodsReceipt.find((g) => g.no === gr).entryNo).lines.find((l) => l.dr).acc, buy: stockBuyAcc() }), k.gr);
  ok('★ เปลี่ยนเป็นแบบสิ้นงวดแล้ว การ์ดแสดงซื้อ/รับสินค้า Dr ซื้อสินค้า', st.periodic && /แบบสิ้นงวด \(Periodic\)/.test(st.card) && /ซื้อสินค้า/.test(st.card));
  ok('ใบรับสินค้าที่ลงไว้แล้วย้ายเข้าบัญชีซื้อสินค้า', st.grAcc === st.buy, st.grAcc);

  console.log('\n[2] ฟอร์มตั้งหนี้: เลือกสินค้าแล้วบัญชีเป็นซื้อสินค้า');
  await go('bills');
  await page.click('#main [data-act="new:bill"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('#modal [name="partner"]', k.ven);
  await page.selectOption('#modal [name="l0_item"]', k.it);
  await page.waitForTimeout(100);
  const a0 = await page.evaluate(() => ({ v: val('l0_acc'), t: (document.querySelector('[name="l0_acc"]').selectedOptions[0] || {}).textContent }));
  ok('★ เลือกสินค้านับสต๊อกในบรรทัดแล้ว ช่องบัญชีเป็น "ซื้อสินค้า"', a0.v === st.buy && /ซื้อสินค้า/.test(a0.t || ''), JSON.stringify(a0));
  await page.fill('#modal [name="vendorNo"]', 'V-UI-1');
  await page.fill('#modal [name="l0_qty"]', '3');
  await page.fill('#modal [name="l0_price"]', '110');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  const b = await page.evaluate(() => { const x = DB.docs.bill[0]; return { acc: x.lines[0].acc, dr: DB.entries.find((e) => e.no === x.entryNo).lines.find((l) => l.acc === stockBuyAcc()) }; });
  ok('บันทึกตั้งหนี้แล้วลง Dr ซื้อสินค้า 330.00', b.acc === st.buy && b.dr && b.dr.dr === 3300000, JSON.stringify(b));

  console.log('\n[3] หน้าปิดงวด: ปรับปรุงสินค้าคงเหลือปลายงวด');
  await go('close');
  const btnTxt = await page.evaluate(() => { const x = document.querySelector('#main [data-act="run:invadjust"]'); return x ? x.textContent : ''; });
  ok('★ หน้าปิดงวดมีปุ่ม "ปรับปรุงสินค้าปลายงวดเดี๋ยวนี้"', /ปรับปรุงสินค้าปลายงวด/.test(btnTxt), btnTxt);
  await page.click('#main [data-act="run:invadjust"]');
  await page.waitForTimeout(200);
  const r = await page.evaluate(() => ({ je: DB.entries.find((e) => e.src === 'stockPeriodEnd' && e.srcId === '2026-01'),
    check: reconciliationChecks('2026-01-31').checks.find((c) => c.code === 'INVENTORY_SUBLEDGER').ok,
    toast: document.getElementById('toast').textContent }));
  ok('★ กดแล้วลงใบปรับปรุงปลายงวด บัญชีสินค้า = ทะเบียนสินค้า', !!r.je && r.check, r.toast);
  ok('ปุ่มหายไปหลังปรับแล้ว (รายการขึ้นว่าตรงกัน)', !await page.$('#main [data-act="run:invadjust"]'));

  console.log('\n[4] จอโทรศัพท์');
  await page.setViewportSize({ width: 375, height: 812 });
  await go('settings');
  ok('หน้าตั้งค่าบนจอ 375px ไม่ล้นแนวนอน', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
