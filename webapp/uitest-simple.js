/* ทดสอบหน้าตาแบบใช้ง่าย — รันด้วย node webapp/uitest-simple.js (สร้าง index.html ก่อน)
   แถบไอคอนหมวด + คอลัมน์หน้า · ฟอร์มเอกสารเต็มหน้า หัวเอกสารซ้าย/ยอดรวมขวา · ตารางรายการแบบปกติ (ภาษีทั้งใบ)
   สลับไปโหมดรายบรรทัดได้ · ฟอร์มตั้งหนี้/ค่าใช้จ่ายเห็นช่องบัญชี/หมวดหมู่เสมอ · รายการเอกสารเหลือคอลัมน์ที่ใช้ตัดสินใจ */
const T = require('./uitestlib');
const ok = T.ok;
const vis = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, sel);

(async () => {
  const { page } = await T.open(null, { lineDetail: false, pageHelp: false });
  const go = (s) => page.evaluate((s) => { STATE.screen = s; STATE.sel = null; render(); }, s);
  await T.blank(page, '2026-06');
  const k = await page.evaluate(() => {
    const cus = savePartner({ kind:'customer', name:'บริษัท ลูกค้าดี จำกัด', taxId:'0105533001831', branch:'00000', address:'9 ถนนสีลม กรุงเทพฯ', termDays: 30 }).partner;
    const ven = savePartner({ kind:'vendor', name:'บริษัท ผู้ขาย จำกัด', taxId:'0105533001823', branch:'00000', address:'3 ถนนบางนา', termDays: 30 }).partner;
    const it = saveItem({ name:'บริการติดตั้ง', type:'service', uom:'งาน', price:'100' }).item;
    save(); render();
    return { cus: cus.code, ven: ven.code, it: it.code };
  });

  console.log('\n[1] เมนู: แถบไอคอนหมวด + คอลัมน์หน้าในหมวด');
  const rail = await page.$$eval('#rail .rail-i', (e) => e.map((x) => x.textContent.trim()));
  ok('★ แถบไอคอนซ้ายมีหมวดหลักครบ 12 หมวด', rail.length === 12 && rail[0] === 'ภาพรวม' && rail[11] === 'ตั้งค่า', rail.join(' · '));
  await page.click('#rail [data-act="navm:ซื้อ"]');
  await page.waitForTimeout(100);
  const buy = await page.evaluate(() => ({ t: document.querySelector('#nav .nav-t').textContent, screen: STATE.screen,
    n: document.querySelectorAll('#nav .nav-i').length }));
  ok('★ กดไอคอน "ซื้อ" เปิดคอลัมน์ "เอกสารซื้อ" และหน้าแรกของหมวด (ใบสั่งซื้อ)', buy.t === 'เอกสารซื้อ' && buy.screen === 'purchaseorders' && buy.n === 6, JSON.stringify(buy));

  console.log('\n[2] ใบกำกับภาษีแบบปกติ: เต็มหน้า หัวเอกสารซ้าย ยอดรวมขวา ภาษีทั้งใบ');
  await go('invoices');
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show');
  const form = await page.evaluate(() => {
    const m = document.getElementById('modal');
    const q = (s) => m.querySelector(s);
    const shown = (s) => { const e = q(s); return !!e && e.checkVisibility(); };
    return { page: m.classList.contains('as-page'), left: !!q('.dh-l [name="partner"]'), total: !!q('.dh-r #tGrandTop'),
      close: !!q('.modal-h [data-act="modal:close"]'), submitTop: !!q('.modal-h [data-act="modal:submit"]'),
      addr: shown('[name="cAddress"]'), tax: shown('[name="cTaxId"]'), branch: shown('[name="cBranch"]'),
      phoneHidden: !shown('[name="cPhone"]') && !!q('details.dh-more [name="cPhone"]'),
      heads: Array.from(m.querySelectorAll('#lnTable thead th')).filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).filter(Boolean),
      lineTax: shown('[name="l0_tax"]'), lineDisc: shown('[name="l0_disc"]'), docTax: shown('[name="docTax"]'),
      docTaxVal: (q('[name="docTax"]') || {}).value };
  });
  ok('★ ฟอร์มเปิดเต็มหน้า มีปุ่มปิดและปุ่มบันทึกอยู่แถบบน', form.page && form.close && form.submitTop, JSON.stringify(form).slice(0, 120));
  ok('★ หัวเอกสาร: ลูกค้าอยู่ซ้าย ยอดรวมทั้งสิ้นตัวใหญ่อยู่ขวา', form.left && form.total);
  ok('ที่อยู่ เลขผู้เสียภาษี สาขา เห็นทันที · เบอร์โทร/อีเมลพับไว้', form.addr && form.tax && form.branch && form.phoneHidden);
  ok('★ ตารางรายการแบบปกติ: ลำดับ · ชื่อสินค้า/รายละเอียด · จำนวน · หน่วย · ราคาต่อหน่วย · ราคารวม',
    form.heads.join('|') === 'ลำดับ|ชื่อสินค้า / รายละเอียด|จำนวน|หน่วย|ราคาต่อหน่วย|ราคารวม', form.heads.join(' | '));
  ok('★ ไม่มีช่องภาษี/ส่วนลดรายบรรทัด — เลือกภาษีครั้งเดียวที่ยอดท้ายเอกสาร (ค่าเริ่มต้น 7%)',
    !form.lineTax && !form.lineDisc && form.docTax && form.docTaxVal === 'VAT7');

  await page.selectOption('#modal [name="partner"]', k.cus);
  await page.waitForTimeout(100);
  ok('เลือกลูกค้าแล้วเติมที่อยู่และเลขผู้เสียภาษีให้', await page.evaluate(() =>
    /สีลม/.test(document.querySelector('#modal [name="cAddress"]').value) && document.querySelector('#modal [name="cTaxId"]').value === '0105533001831'));
  await page.selectOption('#modal [name="l0_item"]', k.it);
  await page.fill('#modal [name="l0_qty"]', '2');
  await page.fill('#modal [name="l0_price"]', '100');
  await page.waitForTimeout(100);
  const top1 = await page.textContent('#tGrandTop');
  ok('★ ยอดรวมทั้งสิ้นด้านบนขวาคำนวณทันที 2 × 100 + VAT 7% = 214.00', top1.trim() === '214.00', top1);
  await page.selectOption('#modal [name="docTax"]', 'EXEMPT');
  await page.waitForTimeout(100);
  await page.click('#modal [data-act="ln:add"]');
  const ex = await page.evaluate(() => ({ top: document.getElementById('tGrandTop').textContent.trim(),
    taxes: Array.from(document.querySelectorAll('#lnTable select[name$="_tax"]')).map((e) => e.value) }));
  ok('★ เปลี่ยนภาษีทั้งใบเป็น "ไม่มี / ยกเว้น" ทุกบรรทัดเปลี่ยนตาม บรรทัดใหม่ก็ตาม ยอดเหลือ 200.00',
    ex.top === '200.00' && ex.taxes.length >= 2 && ex.taxes.every((t) => t === 'EXEMPT'), JSON.stringify(ex));
  await page.selectOption('#modal [name="docTax"]', 'VAT7');
  await page.waitForTimeout(100);
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  const inv = await page.evaluate(() => { const d = DB.docs.invoice[DB.docs.invoice.length - 1];
    return { vat: fmt(d.vat), total: fmt(d.total), tax: d.lines[0].taxCode, addr: d.partnerAddress || (d.contact || {}).address || '' }; });
  ok('★ บันทึกใบกำกับภาษี: ภาษี 14.00 รวม 214.00 ทุกบรรทัดเป็น VAT 7%', inv.vat === '14.00' && inv.total === '214.00' && inv.tax === 'VAT7', JSON.stringify(inv));

  console.log('\n[3] สลับเป็นโหมดรายบรรทัด (ส่วนลด/ภาษี/บัญชีรายบรรทัด)');
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show');
  await page.click('#modal [data-act="ln:detail"]');
  const det = await page.evaluate(() => ({ tax: document.querySelector('#modal [name="l0_tax"]').offsetParent !== null,
    disc: document.querySelector('#modal [name="l0_disc"]').offsetParent !== null,
    docTax: !document.querySelector('#modal [name="docTax"]').hidden, mem: localStorage.getItem('financii.lineDetail') }));
  ok('★ กดปุ่มแล้วเห็นช่องส่วนลด/ภาษีรายบรรทัด ช่องภาษีทั้งใบหายไป และจำไว้ในเครื่อง', det.tax && det.disc && !det.docTax && det.mem === '1', JSON.stringify(det));
  await page.click('#modal [data-act="ln:add"]');
  await page.selectOption('#modal [name="l1_tax"]', 'EXEMPT');
  await page.click('#modal [data-act="ln:detail"]');
  ok('★ ภาษีต่างกันรายบรรทัด ระบบไม่ยอมซ่อน (กันมองไม่เห็นค่าที่ต่างกัน)', await page.evaluate(() => document.getElementById('lnTable').classList.contains('ln-detail')));
  await page.selectOption('#modal [name="l1_tax"]', 'VAT7');
  await page.click('#modal [data-act="ln:detail"]');
  ok('ภาษีเท่ากันแล้วซ่อนกลับเป็นโหมดปกติได้', await page.evaluate(() => !document.getElementById('lnTable').classList.contains('ln-detail')
    && localStorage.getItem('financii.lineDetail') === '0'));
  await page.click('#modal [data-act="modal:close"]');
  await T.closed(page);

  console.log('\n[4] ฟอร์มตั้งหนี้และค่าใช้จ่าย: เห็นช่องบัญชี/หมวดหมู่เสมอ');
  await go('bills');
  await page.click('#main [data-act="new:bill"]');
  await page.waitForSelector('#modal.show');
  ok('★ ฟอร์มตั้งหนี้โหมดปกติยังเลือกบัญชีค่าใช้จ่ายรายบรรทัดได้ แต่ซ่อนภาษี/ส่วนลดรายบรรทัด',
    await vis(page, '#modal [name="l0_acc"]') && !(await vis(page, '#modal [name="l0_tax"]')));
  await page.click('#modal [data-act="modal:close"]');
  await T.closed(page);
  await go('expenses');
  await page.click('#main [data-act="new:expense"]');
  await page.waitForSelector('#modal.show');
  const expHead = await page.evaluate(() => Array.from(document.querySelectorAll('#lnTable thead th')).filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).filter(Boolean));
  ok('★ ฟอร์มค่าใช้จ่ายมีคอลัมน์หมวดหมู่เสมอ', expHead.indexOf('หมวดหมู่') > 0 && await vis(page, '#modal [name="l0_acc"]'), expHead.join(' | '));
  await page.click('#modal [data-act="modal:close"]');
  await T.closed(page);

  console.log('\n[5] รายการเอกสาร: เหลือคอลัมน์ที่ใช้ตัดสินใจ');
  await go('invoices');
  const list = await page.evaluate(() => ({ th: Array.from(document.querySelectorAll('#main table.dt thead th')).map((e) => e.textContent.trim()),
    foot: (document.querySelector('#main table.dt tfoot') || {}).textContent || '' }));
  ok('★ ใบกำกับภาษี: วันที่ · เลขที่เอกสาร · ชื่อลูกค้า/โปรเจกต์ · ครบกำหนด · ยอดรวมสุทธิ · สถานะ',
    list.th.join('|') === 'วันที่|เลขที่เอกสาร|ชื่อลูกค้า / โปรเจกต์|ครบกำหนด|ยอดรวมสุทธิ|สถานะ', list.th.join(' | '));
  ok('ท้ายตารางมียอดรวมทั้งหมด', /ยอดรวมทั้งหมด/.test(list.foot) && /214\.00/.test(list.foot), list.foot.replace(/\s+/g, ' '));

  console.log('\n[6] จอมือถือ');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show');
  await page.waitForTimeout(200);
  const mob = await page.evaluate(() => { const r = document.getElementById('modal').getBoundingClientRect();
    return { left: r.left, w: r.width, sw: document.documentElement.scrollWidth }; });
  ok('★ บนมือถือฟอร์มเต็มจอ ไม่มีเลื่อนซ้ายขวาทั้งหน้า', mob.left === 0 && mob.w >= 389 && mob.sw <= 390, JSON.stringify(mob));
  await page.click('#modal [data-act="modal:close"]');

  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
