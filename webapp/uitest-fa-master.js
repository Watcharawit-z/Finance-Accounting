/* ทดสอบหน้าจอข้อมูลหลักแบบที่นักบัญชีคุ้นมือ — ฟอร์มสมุดรายชื่อ ฟอร์มสินค้า ทะเบียน ตั้งค่าเลขที่เอกสาร
   ค่าเริ่มต้นราคาของเอกสารใหม่ และนำเข้าสมุดรายชื่อ/สินค้าจากไฟล์ · รันด้วย node webapp/uitest-fa-master.js */
const fs = require('fs');
const T = require('./uitestlib');

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const csv = (rows) => '﻿' + rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\r\n') + '\r\n';
const download = async (page, sel) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
  return { name: dl.suggestedFilename(), text: fs.readFileSync(await dl.path(), 'utf8') };
};

(async () => {
  const { page } = await T.open();
  const ok = T.ok;
  const go = async (s) => { await page.evaluate((x) => { STATE.screen = x; STATE.sel = null; STATE.filter = ''; render(); }, s); await page.waitForTimeout(120); };
  const submit = async () => { await page.click('#modal [data-act="modal:submit"]'); await T.closed(page); };
  const main = () => page.$eval('#main', (e) => e.textContent);
  const rowText = (code) => page.$eval('#main [data-act="partner:edit:' + code + '"]', (e) => e.textContent).catch(() => '');
  await T.blank(page, '2026-06');

  console.log('\n[1] ฟอร์มสมุดรายชื่อ — ครบทุกช่องแบบที่นักบัญชีคุ้น');
  await go('customers');
  await page.click('#main [data-act="partner:new:customer"]');
  await page.waitForSelector('#modal.show');
  const legends = await page.$$eval('#modal fieldset.fgrp > legend', (ls) => ls.map((l) => l.textContent));
  ok('★ ฟอร์มแบ่งกลุ่ม ข้อมูลทั่วไป · ติดต่อ · ที่อยู่ · ธนาคาร · เงื่อนไขการค้า', legends.join('|') === 'ข้อมูลทั่วไป|ติดต่อ|ที่อยู่|ธนาคาร|เงื่อนไขการค้า', legends.join(' · '));
  const kinds = await page.$$eval('#modal [name="kind"] option', (os) => os.map((o) => o.value));
  ok('ประเภทผู้ติดต่อ: ลูกค้า · ผู้ขาย · ผู้จำหน่ายและลูกค้า', kinds.join(',') === 'customer,vendor,both');
  await page.selectOption('#modal [name="kind"]', 'both');
  ok('เปลี่ยนเป็นผู้จำหน่ายและลูกค้า — ช่องหัก ณ ที่จ่ายเปลี่ยนชื่อตาม', (await page.$eval('#pWht label', (e) => e.textContent)).indexOf('ค่าเริ่มต้นในเอกสาร') >= 0);
  await page.fill('#modal [name="taxId"]', '0105548021443');
  ok('★ พิมพ์เลขผู้เสียภาษีผิดหลักตรวจ เตือนทันทีใต้ช่อง', await page.$eval('#taxHint', (e) => e.classList.contains('bad') && /หลักที่ 13/.test(e.textContent)));
  await page.fill('#modal [name="taxId"]', '0105548021442');
  ok('เลขถูกต้อง ขึ้นว่าผ่านการตรวจ', await page.$eval('#taxHint', (e) => e.classList.contains('ok')));
  const fill = { newCode: 'C-001', name: 'บริษัท ซื้อขายครบ จำกัด', branch: '00002', branchName: 'บางนา', contactPerson: 'คุณสมศรี',
    email: 'ac@sue-kai.co.th', mobile: '0812345678', phone: '021234567', fax: '021234568', website: 'www.sue-kai.co.th',
    address: '9 ถนนบางนา-ตราด แขวงบางนา เขตบางนา กรุงเทพมหานคร', zip: '10260', shipAddress: 'คลังสินค้า 9/1 บางนา',
    bankName: 'กสิกรไทย', bankAccount: '123-4-56789-0', bankAccountName: 'บจก. ซื้อขายครบ', bankBranch: 'บางนา',
    termDays: '45', creditLimit: '50,000', note: 'วางบิลทุกวันที่ 25' };
  for (const k of Object.keys(fill)) await page.fill('#modal [name="' + k + '"]', fill[k]);
  await page.selectOption('#modal [name="bankAccountType"]', 'current');
  await page.selectOption('#modal [name="wht"]', 'WHT_SERVICE');
  await submit();
  const p = await page.evaluate(() => DB.partners.find((x) => x.name === 'บริษัท ซื้อขายครบ จำกัด'));
  ok('★ บันทึกได้ครบทุกช่อง: รหัสที่ตั้งเอง สาขา ผู้ติดต่อ ที่อยู่จัดส่ง ธนาคาร เครดิต วงเงิน หมายเหตุ', !!p && p.code === 'C-001' && p.kind === 'both'
    && p.taxId === '0105548021442' && p.branch === '00002' && p.branchName === 'บางนา' && p.contactPerson === 'คุณสมศรี' && p.email === 'ac@sue-kai.co.th'
    && p.mobile === '0812345678' && p.phone === '021234567' && p.fax === '021234568' && p.website === 'www.sue-kai.co.th' && p.zip === '10260'
    && p.shipAddress === 'คลังสินค้า 9/1 บางนา' && p.bankName === 'กสิกรไทย' && p.bankAccount === '123-4-56789-0' && p.bankAccountType === 'current'
    && p.bankBranch === 'บางนา' && p.termDays === 45 && p.creditLimit === 500000000 && p.whtCode === 'WHT_SERVICE' && p.note === 'วางบิลทุกวันที่ 25',
    p && p.code);

  console.log('\n[2] ทะเบียนลูกค้าและผู้ขาย — รายเดียวกันอยู่ทั้งสองทะเบียน');
  await page.evaluate(() => { savePartner({ kind: 'customer', name: 'ลูกค้าธรรมดา', taxId: '0105536000003', address: '1 ถนนสีลม กรุงเทพฯ' }); save(); });
  await go('customers');
  let row = await rowText('C-001');
  ok('★ ทะเบียนลูกค้าแสดงรายนี้พร้อมป้ายผู้จำหน่ายและลูกค้า ผู้ติดต่อ เบอร์ และอีเมล', row.indexOf('ผู้จำหน่ายและลูกค้า') >= 0 && row.indexOf('คุณสมศรี') >= 0
    && row.indexOf('0812345678') >= 0 && row.indexOf('ac@sue-kai.co.th') >= 0 && row.indexOf('บางนา') >= 0, row.slice(0, 80));
  await go('vendors');
  row = await rowText('C-001');
  ok('★ ทะเบียนผู้ขายแสดงรายเดียวกัน (ไม่ต้องสร้างสองราย)', row.indexOf('ซื้อขายครบ') >= 0 && row.indexOf('ผู้จำหน่ายและลูกค้า') >= 0);
  ok('ลูกค้าธรรมดาไม่ขึ้นในทะเบียนผู้ขาย', (await main()).indexOf('ลูกค้าธรรมดา') < 0);
  await page.click('#main [data-act="chip:vendors:both"]');
  await page.waitForTimeout(120);
  ok('ตัวกรอง "ผู้จำหน่ายและลูกค้า" มีจำนวนบนป้ายตรงกับแถว', await page.evaluate(() => document.querySelectorAll('#main tbody tr').length === 1
    && document.querySelector('#main [data-act="chip:vendors:both"] .chip-n').textContent === '1'));
  await page.evaluate(() => { STATE.chip = {}; });
  await page.fill('#q', 'คุณสมศรี');
  await page.waitForTimeout(250);
  ok('ค้นด้วยชื่อผู้ติดต่อเจอ', (await main()).indexOf('ซื้อขายครบ') >= 0);
  await page.fill('#q', '');
  await page.waitForTimeout(200);
  /* มีเอกสารแล้ว ตัดบทบาทเดิมไม่ได้ */
  await page.evaluate(() => { const c = DB.partners.find((x) => x.name === 'ลูกค้าธรรมดา');
    issueInvoice({ partnerCode: c.code, date: '2026-06-10', lines: [{ desc: 'งาน', qty: 1, price: '1000' }] }); save(); });
  const plain = await page.evaluate(() => DB.partners.find((x) => x.name === 'ลูกค้าธรรมดา').code);
  await go('customers');
  await page.click('#main [data-act="partner:edit:' + plain + '"]');
  await page.waitForSelector('#modal.show');
  ok('★ รายที่มีเอกสารแล้วเปลี่ยนได้แค่เป็นผู้จำหน่ายและลูกค้า (ตัดบทบาทเดิมไม่ได้)',
    (await page.$$eval('#modal [name="kind"] option', (os) => os.map((o) => o.value))).join(',') === 'customer,both');
  ok('รหัสเดิมแสดงแบบอ่านอย่างเดียว', await page.$eval('#modal [name="pcode"]', (e) => e.readOnly && e.value.length > 0));
  await page.selectOption('#modal [name="kind"]', 'both');
  await submit();
  ok('เปลี่ยนเป็นผู้จำหน่ายและลูกค้าแล้ว ข้อมูลเดิมไม่หาย', await page.evaluate((c) => { const x = DB.partners.find((y) => y.code === c);
    return x.kind === 'both' && x.taxId === '0105536000003'; }, plain));

  console.log('\n[3] ฟอร์มสินค้า — บริการ / ไม่นับสต๊อก / นับสต๊อก ฝั่งขายและฝั่งซื้อ');
  await go('items');
  await page.click('#main [data-act="item:new"]');
  await page.waitForSelector('#modal.show');
  ok('ประเภทสินค้า 3 แบบ', (await page.$$eval('#modal [name="type"] option', (os) => os.map((o) => o.value))).join(',') === 'service,nonstock,stock');
  const legendsI = await page.$$eval('#modal fieldset.fgrp > legend', (ls) => ls.map((l) => l.textContent));
  ok('แบ่งกลุ่ม ข้อมูลสินค้า · ฝั่งขาย · ฝั่งซื้อ · สต๊อก', legendsI.join('|') === 'ข้อมูลสินค้า|ฝั่งขาย|ฝั่งซื้อ|สต๊อก');
  await page.selectOption('#modal [name="type"]', 'nonstock');
  const vis = () => page.evaluate(() => ({ exp: !document.getElementById('itemExp').hidden, stock: !document.getElementById('itemStock').hidden }));
  let v = await vis();
  ok('★ สินค้าไม่นับสต๊อก: มีช่องบัญชีค่าใช้จ่าย ไม่มีจุดสั่งซื้อ', v.exp && !v.stock);
  const accOk = await page.evaluate(() => {
    const vals = (n) => [...document.querySelectorAll('#modal [name="' + n + '"] option')].map((o) => o.value).filter(Boolean);
    const rev = revenueAccounts().map((a) => a.code), bills = billAccounts();
    return vals('revenueAcc').length > 0 && vals('revenueAcc').every((c) => rev.indexOf(c) >= 0)
      && vals('expenseAcc').length > 0 && vals('expenseAcc').every((c) => bills.some((a) => a.code === c && a.subType !== 'inventory'));
  });
  ok('★ ช่องบัญชีแสดงเฉพาะบัญชีที่ใช้ได้ (รายได้ · ค่าใช้จ่ายที่ไม่ใช่สินค้าคงเหลือ)', accOk);
  const itemFill = { newCode: 'NS-01', name: 'ถุงผ้าพิมพ์โลโก้', category: 'ของที่ระลึก', uom: 'ใบ', barcode: '8850000000011',
    sellDesc: 'ถุงผ้าดิบพิมพ์ 1 สี', price: '120', buyDesc: 'ถุงผ้าดิบ', buyPrice: '80' };
  for (const k of Object.keys(itemFill)) await page.fill('#modal [name="' + k + '"]', itemFill[k]);
  await page.selectOption('#modal [name="sellVat"]', 'inclusive');
  await page.selectOption('#modal [name="revenueAcc"]', '4111');
  await page.selectOption('#modal [name="buyVat"]', 'exclusive');
  await page.selectOption('#modal [name="expenseAcc"]', '5321');
  await submit();
  const it = await page.evaluate(() => DB.items.find((x) => x.code === 'NS-01'));
  ok('★ บันทึกสินค้าครบ: ประเภท ราคาขาย/ซื้อ ชนิดภาษีสองฝั่ง รายละเอียด บาร์โค้ด บัญชี', !!it && it.type === 'nonstock' && it.price === 1200000
    && it.sellVat === 'inclusive' && it.buyPrice === 800000 && it.buyVat === 'exclusive' && it.barcode === '8850000000011'
    && it.sellDesc === 'ถุงผ้าดิบพิมพ์ 1 สี' && it.buyDesc === 'ถุงผ้าดิบ' && it.revenueAcc === '4111' && it.expenseAcc === '5321' && it.category === 'ของที่ระลึก');
  await page.click('#main [data-act="item:edit:NS-01"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('#modal [name="type"]', 'stock');
  v = await vis();
  ok('★ เปลี่ยนเป็นสินค้านับสต๊อก: ซ่อนบัญชีค่าใช้จ่าย (เข้าคลังเสมอ) แสดงจุดสั่งซื้อ', !v.exp && v.stock);
  await page.fill('#modal [name="reorder"]', '3');
  await submit();
  ok('บันทึกเป็นสินค้านับสต๊อก ล้างบัญชีค่าใช้จ่าย', await page.evaluate(() => { const x = DB.items.find((y) => y.code === 'NS-01');
    return x.type === 'stock' && x.expenseAcc === '' && x.reorder === 3 && x.sellVat === 'inclusive'; }));
  const itemRow = await page.$eval('#main [data-act="item:edit:NS-01"]', (e) => e.textContent);
  ok('★ ทะเบียนสินค้าแสดงประเภท ราคาขาย ราคาซื้อ ชนิดภาษี และบาร์โค้ด', itemRow.indexOf('สินค้านับสต๊อก') >= 0 && itemRow.indexOf('120.00') >= 0
    && itemRow.indexOf('80.00') >= 0 && itemRow.indexOf('รวมภาษี') >= 0 && itemRow.indexOf('ไม่รวมภาษี') >= 0 && itemRow.indexOf('8850000000011') >= 0, itemRow.slice(0, 90));
  await page.click('#main [data-act="chip:items:service"]');
  await page.waitForTimeout(120);
  ok('ตัวกรองตามประเภทสินค้า', (await main()).indexOf('ถุงผ้าพิมพ์โลโก้') < 0);
  await page.evaluate(() => { STATE.chip = {}; });

  console.log('\n[4] ตั้งค่าเลขที่เอกสาร — เห็นเลขที่ถัดไปทันที');
  await go('settings');
  ok('หน้าตั้งค่าแสดงเลขที่ถัดไปของแต่ละเอกสาร', (await main()).indexOf('INV2026060002') >= 0 && (await main()).indexOf('RE2026060001') >= 0);
  await page.click('#main [data-act="numbering:edit"]');
  await page.waitForSelector('#modal.show');
  const prev = (k) => page.$eval('#modal [data-nbprev="' + k + '"]', (e) => e.textContent);
  ok('ตัวอย่างเริ่มต้นตรงกับเลขที่จะได้จริง', (await prev('invoice')) === 'INV2026060002', await prev('invoice'));
  await page.fill('#modal [name="nbp_invoice"]', 'iv');
  /* ตัวนับรายเดือนของใบกำกับยังเป็นตัวเดิม — เปลี่ยนคำนำหน้ากลางเดือน เลขรันต่อจากเดิม */
  ok('★ พิมพ์คำนำหน้าใหม่ เห็นเลขที่ถัดไปทันที (ตัวพิมพ์ใหญ่ เลขรันต่อจากเดิม)', (await prev('invoice')) === 'IV2026060002', await prev('invoice'));
  await page.selectOption('#modal [name="nbReset"]', 'year');
  ok('★ เลือกนับใหม่ทุกปี ตัวอย่างเปลี่ยนเป็นปี + เลขรัน 6 หลัก', (await prev('invoice')) === 'IV2026000001', await prev('invoice'));
  await page.fill('#modal [name="nbp_receipt"]', 'ใบ');
  ok('คำนำหน้าภาษาไทยเตือนในบรรทัด และกดบันทึกไม่ได้', await page.evaluate(() => document.querySelector('#modal [data-nbnote="receipt"]').classList.contains('bad')
    && document.querySelector('#modal [data-act="modal:submit"]').classList.contains('disabled')));
  await page.fill('#modal [name="nbp_receipt"]', 'IV');
  ok('คำนำหน้าซ้ำกับเอกสารอื่น เตือนว่านับเลขร่วมกัน', await page.$eval('#modal [data-nbnote="receipt"]', (e) => e.classList.contains('warn') && e.textContent.indexOf('ใบกำกับ') >= 0));
  await page.fill('#modal [name="nbp_receipt"]', '');
  ok('เตือนว่าเปลี่ยนกลางงวด เลขรันนับต่อ และใบเดิมคงเลขเดิม', (await page.$eval('#modal', (e) => e.textContent)).indexOf('เลขรันนับต่อจากเลขล่าสุด') >= 0);
  await submit();
  const nb = await page.evaluate(() => DB.settings.numbering);
  ok('★ บันทึกรูปแบบ รอบการนับ และคำนำหน้าที่ตั้งเอง', nb.style === 'fa' && nb.reset === 'year' && JSON.stringify(nb.prefixes) === '{"invoice":"IV"}', JSON.stringify(nb));
  const issued = await page.evaluate(() => { const c = DB.partners.find((x) => x.name === 'ลูกค้าธรรมดา');
    const r = issueInvoice({ partnerCode: c.code, date: '2026-06-12', lines: [{ desc: 'งาน', qty: 1, price: '100' }] }); save(); render(); return r.no; });
  ok('★ ใบกำกับใบถัดไปได้เลขตามที่เห็นในตัวอย่าง', issued === 'IV2026000001', issued);
  ok('หน้าตั้งค่าเลื่อนเลขที่ถัดไปตาม', (await main()).indexOf('IV2026000002') >= 0);
  await page.evaluate(() => { DB.settings.numbering = { style: 'legacy', reset: 'month', prefixes: {} }; render(); });
  await page.click('#main [data-act="numbering:edit"]');
  await page.waitForSelector('#modal.show');
  ok('สมุดที่ยังใช้เลขแบบเดิม บอกว่าใบเก่าคงเลขแบบเดิม', (await page.$eval('#modal', (e) => e.textContent)).indexOf('ใบเก่ายังเป็นเลขแบบเดิม') >= 0
    && (await prev('invoice')).indexOf('INV2606-') === 0);
  await page.click('#modal [data-act="modal:close"]');
  await page.evaluate(() => { saveNumbering({ style: 'fa', reset: 'month', prefixes: {} }); save(); render(); });

  console.log('\n[5] ฟังก์ชันเอกสาร — ราคารวมภาษีเป็นค่าเริ่มต้น');
  await page.click('#main [data-act="docdef:price:inclusive"]');
  await page.waitForTimeout(150);
  ok('★ เลือกราคารวมภาษีเป็นค่าเริ่มต้น บันทึกในข้อมูลบริษัท', await page.evaluate(() => DB.settings.docDefaults.priceMode === 'inclusive'
    && document.querySelector('#main [data-act="docdef:price:inclusive"]').getAttribute('aria-pressed') === 'true'));
  await go('invoices');
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show #lnTable');
  ok('★ ใบกำกับใหม่เริ่มที่ราคารวมภาษี', (await page.$eval('#modal [name="priceMode"]', (e) => e.value)) === 'inclusive');
  await page.click('#modal [data-act="modal:close"]');
  await go('settings');
  await page.click('#main [data-act="docdef:price:exclusive"]');
  await page.waitForTimeout(150);

  console.log('\n[6] นำเข้าสมุดรายชื่อจากไฟล์ — ดูผลก่อน ข้ามรายการซ้ำ ดาวน์โหลดแถวที่ไม่ผ่าน');
  await go('vendors');
  await page.click('#main [data-act="masterimp:go:contact:vendor"]');
  await page.waitForTimeout(150);
  ok('ปุ่มนำเข้าในทะเบียนพาไปหน้านำเข้า พร้อมแบบฟอร์ม', await page.evaluate(() => STATE.screen === 'import')
    && (await main()).indexOf('นำเข้าสมุดรายชื่อและสินค้า') >= 0);
  const tpl = await download(page, '#main [data-act="masterimp:template:contact"]');
  ok('★ ดาวน์โหลดแบบฟอร์มสมุดรายชื่อ (ชื่อไฟล์อังกฤษ เปิดใน Excel ได้)', tpl.name === 'Financii_contacts_template.csv' && tpl.text.indexOf('ประเภทผู้ติดต่อ') >= 0
    && tpl.text.indexOf('เลขประจำตัวผู้เสียภาษี') >= 0, tpl.name);
  const contacts = csv([
    ['รหัสผู้ติดต่อ', 'ประเภทผู้ติดต่อ', 'ชื่อ', 'เลขประจำตัวผู้เสียภาษี', 'รหัสสาขา', 'ผู้ติดต่อ', 'อีเมล', 'มือถือ', 'ที่อยู่', 'รหัสไปรษณีย์', 'เครดิต (วัน)', 'ธนาคาร', 'เลขที่บัญชี'],
    ['V-100', '', 'บริษัท วัสดุก่อสร้าง จำกัด', tid('010555870001').slice(1), 'สำนักงานใหญ่', 'คุณบี', 'b@wasadu.co.th', '891112222', 'นนทบุรี', '11000', '30', 'กรุงไทย', '111-2-33333-4'],
    ['V-101', 'ผู้จำหน่ายและลูกค้า', 'บริษัท ขนส่งไว จำกัด', tid('010555870002'), '00000', '', '', '', 'ปทุมธานี', '12000', '15', '', ''],
    ['', 'ลูกค้า', 'ลูกค้าธรรมดา (ซ้ำ)', '0105536000003', '00000', '', '', '', '', '', '', '', ''],
    ['', 'ผู้ขาย', 'บริษัท อีเมลผิด จำกัด', '', '', '', 'อีเมลผิด', '', '', '', '', '', ''],
  ]);
  const nPartners = await page.evaluate(() => DB.partners.length);
  await page.setInputFiles('#file', { name: 'contacts.csv', mimeType: 'text/csv', buffer: Buffer.from(contacts, 'utf8') });
  await page.waitForFunction(() => STATE.imp && STATE.imp.kind === 'master', null, { timeout: 5000 });
  await page.waitForTimeout(150);
  const st = await page.evaluate(() => ({ mk: STATE.imp.mk, c: STATE.imp.plan.counts, partners: DB.partners.length, def: STATE.imp.opts.defaultKind }));
  ok('★ ระบบรู้ว่าเป็นไฟล์สมุดรายชื่อ แถวที่ไม่ระบุประเภทเป็นผู้ขาย (มาจากทะเบียนผู้ขาย)', st.mk === 'contact' && st.def === 'vendor', JSON.stringify(st.c));
  ok('★ ดูผลก่อนนำเข้า: ใหม่ 2 · ซ้ำ 1 · นำเข้าไม่ได้ 1 — ยังไม่บันทึกอะไร', st.c.new === 2 && st.c.dup === 1 && st.c.bad === 1 && st.partners === nPartners, JSON.stringify(st.c));
  ok('ปุ่มนำเข้าบอกจำนวนที่จะเข้า', (await page.$eval('#main [data-act="masterimp:run"]', (e) => e.textContent)).indexOf('นำเข้า 2') >= 0);
  await page.click('#main [data-act="masterimp:show:bad"]');
  await page.waitForTimeout(120);
  ok('กรองดูเฉพาะแถวที่นำเข้าไม่ได้ พร้อมเหตุผล', await page.evaluate(() => document.querySelectorAll('#main tbody tr').length >= 1
    && document.getElementById('main').textContent.indexOf('อีเมล') >= 0 && document.getElementById('main').textContent.indexOf('บริษัท วัสดุก่อสร้าง') < 0));
  const pre = await download(page, '#main [data-act="masterimp:rejects:plan"]');
  ok('ดาวน์โหลดแถวที่จะไม่ได้นำเข้าก่อนกดนำเข้าได้', pre.text.indexOf('บริษัท อีเมลผิด จำกัด') >= 0 && pre.text.indexOf('ลูกค้าธรรมดา (ซ้ำ)') >= 0 && pre.text.indexOf('เหตุผล') >= 0);
  await page.click('#main [data-act="masterimp:run"]');
  await page.waitForTimeout(250);
  const done = await page.evaluate(() => ({ v: DB.partners.find((x) => x.code === 'V-100'), b: DB.partners.find((x) => x.code === 'V-101'),
    hist: DB.masterImports.length, txt: document.getElementById('main').textContent }));
  ok('★ นำเข้าแล้ว: เลขผู้เสียภาษีและเบอร์มือถือที่ Excel ตัดเลข 0 ได้คืน ข้อมูลธนาคารครบ', !!done.v && done.v.kind === 'vendor'
    && done.v.taxId === tid('010555870001') && done.v.mobile === '0891112222' && done.v.bankAccount === '111-2-33333-4' && done.v.termDays === 30,
    done.v && done.v.taxId);
  ok('ผู้จำหน่ายและลูกค้าจากไฟล์', !!done.b && done.b.kind === 'both');
  ok('★ หน้าผลการนำเข้าและประวัติ', done.hist === 1 && done.txt.indexOf('นำเข้าสมุดรายชื่อแล้ว') >= 0 && done.txt.indexOf('ประวัติการนำเข้าสมุดรายชื่อและสินค้า') >= 0);
  const rej = await download(page, '#main [data-act="masterimp:rejects:1"]');
  ok('★ ดาวน์โหลดแถวที่ไม่ได้นำเข้าจากประวัติ — คอลัมน์เดิม + ผล + เหตุผล', rej.name === 'Financii_import_1_rejects.csv'
    && rej.text.indexOf('ผลการนำเข้า,เหตุผล,แถวในไฟล์เดิม') >= 0 && rej.text.indexOf('นำเข้าไม่ได้') >= 0 && rej.text.indexOf('ซ้ำ ข้ามไป') >= 0, rej.name);
  await go('vendors');
  ok('รายชื่อที่นำเข้าขึ้นในทะเบียนผู้ขาย', (await main()).indexOf('บริษัท วัสดุก่อสร้าง จำกัด') >= 0 && (await main()).indexOf('บริษัท ขนส่งไว จำกัด') >= 0);

  console.log('\n[7] นำเข้าสินค้าจากไฟล์');
  await go('items');
  await page.click('#main [data-act="masterimp:go:product"]');
  await page.waitForTimeout(150);
  const products = csv([
    ['รหัสสินค้า', 'ชื่อสินค้า', 'ประเภทสินค้า', 'หน่วยนับ', 'บาร์โค้ด', 'ราคาขาย', 'ภาษีขาย', 'ราคาซื้อ', 'ภาษีซื้อ'],
    ['SV-10', 'ค่าติดตั้ง', 'บริการ', 'งาน', '', '2,500', 'ไม่รวมภาษี', '', ''],
    ['', 'กล่องกระดาษ', '', 'ใบ', '8850000000028', '15', 'รวมภาษี', '9.50', 'ไม่รวมภาษี'],
    ['NS-01', 'ถุงผ้า (รหัสซ้ำ)', 'สินค้าไม่นับสต๊อก', 'ใบ', '', '100', '', '', ''],
  ]);
  await page.setInputFiles('#file', { name: 'products.csv', mimeType: 'text/csv', buffer: Buffer.from(products, 'utf8') });
  await page.waitForFunction(() => STATE.imp && STATE.imp.kind === 'master' && STATE.imp.mk === 'product', null, { timeout: 5000 });
  await page.selectOption('#main [name="mkDefType"]', 'stock');
  await page.waitForTimeout(150);
  const ps = await page.evaluate(() => STATE.imp.plan.counts);
  ok('★ ไฟล์สินค้า: ใหม่ 2 · รหัสซ้ำ 1', ps.new === 2 && ps.dup === 1, JSON.stringify(ps));
  await page.click('#main [data-act="masterimp:run"]');
  await page.waitForTimeout(250);
  const pi = await page.evaluate(() => ({ sv: DB.items.find((x) => x.code === 'SV-10'), box: DB.items.find((x) => x.name === 'กล่องกระดาษ') }));
  ok('★ นำเข้าสินค้า: ราคามีจุลภาค ชนิดภาษี ราคาซื้อ และประเภทตามค่าที่เลือก', !!pi.sv && pi.sv.type === 'service' && pi.sv.price === 25000000
    && !!pi.box && pi.box.type === 'stock' && pi.box.sellVat === 'inclusive' && pi.box.buyPrice === 95000 && pi.box.barcode === '8850000000028');

  console.log('\n[8] จอมือถือ');
  await page.setViewportSize({ width: 390, height: 844 });
  await go('customers');
  await page.click('#main [data-act="partner:new:customer"]');
  await page.waitForSelector('#modal.show');
  await page.waitForTimeout(400);
  ok('ฟอร์มผู้ติดต่อบนมือถือ ไม่ล้นจอด้านข้าง', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
    && document.querySelector('#modal .modal-b').scrollWidth <= document.querySelector('#modal .modal-b').clientWidth));
  await page.click('#modal [data-act="modal:close"]');
  await go('settings');
  await page.click('#main [data-act="numbering:edit"]');
  await page.waitForSelector('#modal.show');
  await page.waitForTimeout(400);
  ok('ตั้งค่าเลขที่บนมือถือ เห็นเลขที่ถัดไปโดยไม่ต้องเลื่อนข้าง', await page.evaluate(() => {
    const b = document.querySelector('#modal .modal-b');
    const cell = document.querySelector('#modal [data-nbprev="invoice"]').getBoundingClientRect();
    return b.scrollWidth <= b.clientWidth && cell.right <= window.innerWidth;
  }));
  await page.click('#modal [data-act="modal:close"]');

  await T.done();
})();
