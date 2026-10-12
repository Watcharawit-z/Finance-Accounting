/* หน้าเว็บ: ผังบัญชี ลูกหนี้/เจ้าหนี้ยกมารายใบ ใบสำคัญหลายบรรทัด ภ.พ.30 ยอดยกมา — รันด้วย node webapp/uitest-core.js */
const T = require('./uitestlib');
const fs = require('fs');
const path = require('path');
const os = require('os');

(async () => {
  const { page } = await T.open();
  const ok = T.ok;

  console.log('\n[1] ผังบัญชี — เพิ่มและแก้ไขจากหน้าจอ');
  await T.blank(page, '2026-01');
  await page.evaluate(() => { STATE.screen = 'coa'; render(); });
  await page.click('[data-act="acct:new"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="acode"]', '1112.02');
  await page.fill('[name="aname"]', 'เงินฝากธนาคารกรุงเทพ ออมทรัพย์');
  await page.selectOption('[name="asub"]', 'bank');
  await page.selectOption('[name="adefault"]', 'yes');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const a = await page.evaluate(() => ({ acc: DB.accounts.find((x) => x.code === '1112.02'), def: accBySub('bank') }));
  ok('★ เพิ่มบัญชีธนาคารใหม่จากหน้าจอ และตั้งเป็นบัญชีหลัก', a.acc && a.acc.type === 'asset' && a.def === '1112.02', a.def);
  await page.click('[data-act="acct:edit:1112.02"]');
  await page.waitForSelector('#modal.show');
  ok('แก้ไขบัญชีที่ยังไม่มีรายการ เลือกหมวดได้ และมีปุ่มลบ', await page.evaluate(() =>
    !!document.querySelector('#modal [name="asub"]') && !!document.querySelector('#modal [data-act="acct:del:1112.02"]')));
  await page.fill('[name="aname"]', 'เงินฝากธนาคารกรุงเทพ ออมทรัพย์ 123-4-56789-0');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  ok('แก้ชื่อบัญชีแล้วผังบัญชีแสดงชื่อใหม่', await page.evaluate(() => /123-4-56789-0/.test(document.querySelector('#main').textContent)));

  console.log('\n[2] ลูกหนี้ยกมารายใบ — ลากไฟล์เข้าหน้านำเข้าข้อมูล');
  await page.evaluate(() => {
    importOpeningBalances([
      { code: '11122.01', name: 'เงินฝากธนาคาร', debit: M('100000'), credit: 0 },
      { code: '11311', name: 'ลูกหนี้การค้า', debit: M('45000'), credit: 0 },
      { code: '31110', name: 'ทุน', debit: 0, credit: M('145000') }], '2025-12-31', {});
    STATE.screen = 'close'; render();
  });
  ok('★ ปิดงวดบอกว่าต้องตั้งลูกหนี้ยกมารายใบ พร้อมปุ่มพาไป', await page.evaluate(() => !!document.querySelector('[data-act="go:openitems"]')));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-'));
  const file = path.join(dir, 'open-ar.csv');
  fs.writeFileSync(file, '﻿ชื่อลูกค้า,เลขที่เอกสาร,วันที่,ครบกำหนด,ยอดค้าง\n'
    + 'บริษัท เอ จำกัด,INV-9001,15/12/2568,14/01/2569,"25,000.00"\n'
    + 'บริษัท บี จำกัด,INV-9002,20/12/2568,19/01/2569,"20,000.00"\n'
    + 'รวม,,,,"45,000.00"\n');
  await page.evaluate(() => { STATE.screen = 'import'; STATE.imp = null; render(); });
  await page.setInputFiles('#file', file);
  await page.waitForSelector('[data-act="oiimp:run"]');
  const card = await page.evaluate(() => document.querySelector('#main').textContent);
  ok('★ ระบบรู้ว่าเป็นไฟล์ลูกหนี้คงค้างรายใบ ไม่ใช่งบทดลอง', /ไฟล์ยอดค้างรายใบ/.test(card) && /45,000\.00/.test(card) && /ลูกค้าใหม่ 2 ราย/.test(card));
  await page.click('[data-act="oiimp:run"]');
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ screen: STATE.screen, docs: DB.docs.invoice.filter((d) => d.broughtForward && d.status !== 'void').length,
    gap: openingItemsGap('ar', '2026-01-31'), canClose: reconciliationChecks('2026-01-31').checks.find((c) => c.code === 'AR_SUBLEDGER').ok }));
  ok('★ ตั้งลูกหนี้รายใบจากไฟล์ สร้างลูกค้าให้ ยอดรายใบเท่าบัญชีคุม', r.screen === 'openitems' && r.docs === 2 && r.gap === 0 && r.canClose, JSON.stringify(r));

  console.log('\n[3] ลูกหนี้ยกมาจากหน้าจอ แล้วยกเลิกทั้งชุด');
  await page.click('[data-act="oi:new:ar"]');
  await page.waitForSelector('#modal.show');
  const cust = await page.evaluate(() => DB.partners.find((p) => p.kind === 'customer' && p.code !== 'OPENING').code);
  await page.selectOption('[name="omode"]', 'post');
  await page.selectOption('[name="o0_p"]', cust);
  await page.fill('[name="o0_no"]', 'INV-9100');
  await page.fill('[name="o0_a"]', '1,500');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const b = await page.evaluate(() => DB.docs.invoice.find((d) => d.legacyNo === 'INV-9100'));
  ok('ตั้งลูกหนี้ยกมาใบใหม่จากหน้าจอ (ลงบัญชีเป็นยอดยกมาใหม่)', b && b.total === 15000000 && b.obBatch);
  await page.click('[data-act="oi:void:' + b.obBatch + '"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="reason"]', 'กรอกผิด ยกเลิกทั้งชุด');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  ok('ยกเลิกทั้งชุดจากหน้าจอ', await page.evaluate(() => DB.docs.invoice.find((d) => d.legacyNo === 'INV-9100').status === 'void'));

  console.log('\n[4] ใบสำคัญหลายบรรทัด');
  await page.evaluate(() => { STATE.screen = 'jgeneral'; render(); modalJournalVoucher('general'); });
  await page.waitForSelector('#modal.show');
  await page.click('[data-act="jvrows"]');
  const rows = await page.evaluate(() => document.querySelectorAll('#jvLines tbody tr').length);
  ok('★ เพิ่มบรรทัดใบสำคัญได้เกิน 6 บรรทัด', rows === 11, rows + ' บรรทัด');
  const accs = await page.evaluate(() => DB.accounts.filter((x) => x.postable && x.subType === 'admin_expense').slice(0, 1).map((x) => x.code)
    .concat(DB.accounts.filter((x) => x.subType === 'accrued_expense' || x.subType === 'other_payable').slice(0, 1).map((x) => x.code)));
  for (let i = 0; i < 8; i++) {
    await page.selectOption('[name="j' + i + '_acc"]', accs[0]);
    await page.fill('[name="j' + i + '_dr"]', '100');
  }
  await page.selectOption('[name="j9_acc"]', accs[1]);
  await page.fill('[name="j9_cr"]', '800');
  await page.fill('[name="desc"]', 'ตั้งค่าใช้จ่ายค้างจ่ายหลายรายการ');
  await page.fill('[name="date"]', '2026-01-31');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const je = await page.evaluate(() => DB.entries.filter((e) => e.type === 'general').slice(-1)[0]);
  ok('ลงใบสำคัญ 9 บรรทัดได้ ยอดสมดุล', je && je.lines.length === 9 && je.total === 8000000, je && je.lines.length + ' บรรทัด');

  console.log('\n[5] ภ.พ.30 ขอคืนเป็นเงินสด และพิมพ์รายงานมีชื่อบริษัท');
  await page.evaluate(() => {
    const v = savePartner({ kind: 'vendor', name: 'บริษัท ผู้ขาย จำกัด', taxId: '0105536000003', address: 'กทม.' }).partner;
    recordBill({ partnerCode: v.code, date: '2026-01-20', vendorNo: 'V-1', lines: [{ desc: 'วัสดุ', qty: 1, price: '10000', expenseSub: 'admin_expense' }] });
    STATE.screen = 'pp30'; render();
  });
  await page.click('[data-act="run:pp30"]');
  await page.waitForSelector('#modal [name="vatover"]');
  await page.selectOption('[name="vatover"]', 'refund');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const f = await page.evaluate(() => DB.docs.filing.find((x) => x.form === 'PP30' && x.period === '2026-01'));
  ok('★ ภาษีซื้อเกินภาษีขาย เลือกขอคืนเป็นเงินสดได้', f && f.refund === 7000000 && f.carryOut === 0, f && JSON.stringify({ refund: f.refund, carry: f.carryOut }));
  ok('หน้าแบบแสดงบรรทัด 12 ขอคืนเป็นเงินสด', await page.evaluate(() => /ขอคืนเป็นเงินสด/.test(document.querySelector('#main').textContent)));
  ok('หัวกระดาษตอนพิมพ์มีชื่อบริษัทและงวด', await page.evaluate(() => {
    const h = document.querySelector('.print-co'); return !!h && /บริษัท ทดสอบ จำกัด/.test(h.textContent) && getComputedStyle(h).display === 'none'; }));

  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
