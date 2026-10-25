/* ทดสอบงานขายประจำวันผ่านหน้าจอจริง (Chromium) บนบริษัทเปล่า — กดปุ่มและกรอกฟอร์มแบบที่ผู้ใช้ทำ
   เพิ่ม/ลบบรรทัด · ใบกำกับให้บุคคลธรรมดา · บัญชีรายได้รายบรรทัด · ขายเงินสดใบกำกับอย่างย่อ + พิมพ์
   แก้ไขใบเสนอราคา → ออกใบกำกับเลย · ทยอยออกใบกำกับจากใบสั่งขาย · ใบสั่งซื้อแยกบัญชีรายบรรทัด
   เลิกใช้/ลบผู้ติดต่อ · ใบกำกับค้างชำระทุกเดือน · ใบเพิ่มหนี้เลือกบัญชีรายได้
   ใช้: node webapp/build.js && node webapp/uitest-sales.js */
const T = require('./uitestlib');

(async () => {
  const { page } = await T.open();
  const ok = T.ok;
  const submit = async () => { await page.click('#modal [data-act="modal:submit"]'); await T.closed(page); };
  const go = (screen, sel) => page.evaluate((a) => { STATE.screen = a[0]; STATE.sel = a[1] || null; STATE.filter = ''; render(); }, [screen, sel]);
  const rows = () => page.$$eval('#lnTable tbody tr', (r) => r.length);
  const recon = (asOf) => page.evaluate((d) => {
    const r = reconciliationChecks(d);
    const p = d.slice(0, 7);
    const reg = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === p).reduce((s, t) => s + t.tax, 0);
    const gl = -balBySub(['output_vat'], d, p + '-01', (e) => e.src !== 'filing');
    const ag = aging('ar', d).totals.total, ctl = balBySub(['trade_receivable'], d);
    return { ok: r.allPassed && reg === gl && ag === ctl,
      why: r.checks.filter((c) => !c.ok).map((c) => c.code).join(',') + (reg !== gl ? ' VAT ' + reg + '/' + gl : '') + (ag !== ctl ? ' AR' : '') };
  }, asOf);
  await T.blank(page, '2026-06');

  console.log('\n[1] เพิ่มลูกค้าบุคคลธรรมดาที่ไม่ได้จด VAT ผ่านฟอร์ม');
  await go('customers');
  await page.click('#main [data-act="partner:new:customer"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'นายสมชาย ใจดี');
  await page.selectOption('[name="entityType"]', 'individual');
  const branchOff = await page.$eval('[name="branch"]', (e) => e.disabled && e.value === '');
  ok('เลือกบุคคลธรรมดาแล้วช่องสาขาปิดเอง และตั้งว่าไม่ได้จด VAT', branchOff && (await page.$eval('[name="vatReg"]', (e) => e.value)) === 'no');
  await page.fill('[name="address"]', '9 ซอยสุขุมวิท 11 กรุงเทพมหานคร 10110');
  await submit();
  const person = await page.evaluate(() => DB.partners.find((p) => p.name === 'นายสมชาย ใจดี'));
  ok('★ บันทึกลูกค้าบุคคลธรรมดาโดยไม่มีเลขผู้เสียภาษีและสาขา', person && person.branch === null && person.vatRegistered === false && !person.taxId,
    person && person.code);
  await page.click('#main [data-act="partner:new:customer"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'บริษัท ลูกค้าประจำ จำกัด');
  await page.fill('[name="taxId"]', '0105548021442');
  await page.fill('[name="address"]', '1 ถนนสีลม กรุงเทพมหานคร 10500');
  await submit();
  const corp = await page.evaluate(() => DB.partners.find((p) => p.taxId === '0105548021442'));
  ok('ลูกค้านิติบุคคลได้สาขาสำนักงานใหญ่และถือว่าจด VAT', corp && corp.branch === '00000' && corp.vatRegistered === true);

  console.log('\n[2] ใบกำกับหลายบรรทัด เพิ่ม/ลบบรรทัด และบัญชีรายได้รายบรรทัด');
  await page.evaluate(() => { saveItem({ name: 'ค่าที่ปรึกษา', type: 'service', uom: 'ชั่วโมง', price: '2000', newCode: 'SV-1' });
    saveItem({ name: 'สินค้า ก', type: 'stock', uom: 'ชิ้น', price: '150', newCode: 'ST-1' });
    savePartner({ kind: 'vendor', name: 'บริษัท ผู้ขาย จำกัด', taxId: '0105536000003', address: 'กรุงเทพฯ' });
    issueGoodsReceipt({ partnerCode: DB.partners.find((p) => p.kind === 'vendor').code, date: '2026-06-01',
      lines: [{ itemCode: 'ST-1', qty: 100, price: '80' }] }); save(); });
  await go('invoices');
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show #lnTable');
  ok('ฟอร์มเริ่มที่ 4 บรรทัด', (await rows()) === 4);
  await page.click('#modal [data-act="ln:add"]');
  await page.click('#modal [data-act="ln:add"]');
  ok('★ กดเพิ่มบรรทัดได้เรื่อย ๆ', (await rows()) === 6);
  await page.selectOption('[name="partner"]', person.code);
  for (let i = 0; i < 6; i++) {
    await page.fill('[name="l' + i + '_desc"]', 'รายการที่ ' + (i + 1));
    await page.fill('[name="l' + i + '_qty"]', '1');
    await page.fill('[name="l' + i + '_price"]', String(100 * (i + 1)));
  }
  await page.fill('[name="l0_desc"]', 'ค่าที่ปรึกษาโครงการ');
  await page.selectOption('[name="l0_acc"]', '4121');
  await page.selectOption('[name="l5_item"]', 'SV-1');
  ok('เลือกบริการแล้วบัญชีรายได้เปลี่ยนเป็นรายได้ค่าบริการเอง', (await page.$eval('[name="l5_acc"]', (e) => e.value)) === '4121');
  await page.fill('[name="l5_price"]', '600');
  await page.click('#modal [data-act="ln:del:2"]');
  ok('★ ลบบรรทัดกลางตารางได้', (await rows()) === 5 && !(await page.$('[name="l2_desc"]')));
  const sumTxt = await page.$eval('#modal .doc-tot', (e) => e.textContent);
  ok('ยอดรวมใต้ตารางคำนวณสด', /1,800\.00/.test(sumTxt) && /1,926\.00/.test(sumTxt), sumTxt);
  await submit();
  const inv = await page.evaluate(() => {
    const d = DB.docs.invoice[0];
    const e = DB.entries.find((x) => x.no === d.entryNo);
    const cr = (a) => e.lines.filter((l) => l.acc === a).reduce((s, l) => s + l.cr, 0);
    return { no: d.no, n: d.lines.length, base: d.base, branch: d.snap.branch, c4121: cr('4121'), c4111: cr('4111'),
      shown: document.getElementById('main').textContent };
  });
  ok('★ ใบกำกับมี 5 บรรทัดตามที่เหลือในตาราง ออกให้บุคคลธรรมดาได้', inv.n === 5 && inv.base === 18000000 && inv.branch === null, inv.no);
  ok('★ ค่าที่ปรึกษาที่พิมพ์เองลงรายได้ค่าบริการ ไม่ปนรายได้จากการขาย', inv.c4121 === 7000000 && inv.c4111 === 11000000,
    'บริการ ' + inv.c4121 / 10000 + ' ขาย ' + inv.c4111 / 10000);
  ok('หน้าใบกำกับแสดงบัญชีรายได้และไม่ขึ้นสาขาว่างเปล่า', inv.shown.indexOf('4121 รายได้ค่าบริการ') >= 0
    && inv.shown.indexOf('ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม') >= 0 && inv.shown.indexOf('null') < 0);
  ok('ยอดคุมทุกตัวผ่าน', (await recon('2026-06-30')).ok);

  console.log('\n[3] ใบเพิ่มหนี้เลือกบัญชีรายได้');
  await page.click('#main [data-act="dn:' + inv.no + '"]');
  await page.waitForSelector('#modal.show [name="dnAcc"]');
  ok('บัญชีเริ่มต้นตามรายได้หลักของใบกำกับเดิม', (await page.$eval('[name="dnAcc"]', (e) => e.value)) === '4111');
  await page.selectOption('[name="dnAcc"]', '4121');
  await page.fill('[name="base"]', '500');
  await submit();
  const dn = await page.evaluate(() => { const d = DB.docs.debitNote[0]; const e = DB.entries.find((x) => x.no === d.entryNo);
    return { acc: d.acc, cr: e.lines.find((l) => l.acc === '4121').cr }; });
  ok('★ ใบเพิ่มหนี้ลงรายได้ค่าบริการตามที่เลือก', dn.acc === '4121' && dn.cr === 5000000);

  console.log('\n[4] ขายเงินสด — ใบกำกับภาษีอย่างย่อ');
  await page.click('#newBtn');
  await page.click('#pop [data-act="popgo:new:cashsale"]');
  await page.waitForSelector('#modal.show #lnTable');
  ok('เมนูสร้างเอกสารเปิดฟอร์มขายเงินสด ซ่อนช่องลูกค้าแบบขายเชื่อ',
    (await page.$eval('[name="saleKind"]', (e) => e.value)) === 'cash' && !(await page.isVisible('[name="partner"]')));
  await page.selectOption('[name="l0_item"]', 'ST-1');
  await page.fill('[name="l0_qty"]', '2');
  await page.fill('[name="l0_price"]', '160.50');
  await page.fill('[name="l1_desc"]', 'ค่าห่อของขวัญ');
  await page.fill('[name="l1_price"]', '53.50');
  await page.selectOption('[name="l1_acc"]', '4121');
  const csSum = await page.$eval('#modal .doc-tot', (e) => e.textContent);
  ok('ยอดรวมถอดภาษีจากราคาป้ายให้ดูก่อนบันทึก', /374\.50/.test(csSum) && /24\.50/.test(csSum), csSum);
  await submit();
  const cs = await page.evaluate(() => ({ d: DB.docs.cashSale[0], screen: STATE.screen,
    row: DB.taxTx.find((t) => t.docNo === (DB.docs.cashSale[0] || {}).no), qty: DB.items.find((i) => i.code === 'ST-1').qty }));
  ok('★ ขายเงินสดสำเร็จ รับเงิน 374.50 ภาษี 24.50 เปิดหน้าขายเงินสดให้ดู', cs.d && cs.d.total === 3745000 && cs.d.vat === 245000
    && cs.screen === 'cashsales', cs.d && cs.d.no);
  ok('★ เข้ารายงานภาษีขายเป็นใบกำกับอย่างย่อ และตัดสต๊อก', cs.row && cs.row.docType === 'abbreviated' && cs.qty === 98);
  await go('vatout');
  ok('รายงานภาษีขายบนจอมีใบอย่างย่อ', (await page.$eval('#main', (e) => e.textContent)).indexOf(cs.d.no) >= 0);
  await go('cashsales', cs.d.no);
  await page.click('#main [data-act="printdoc:cashSale:' + cs.d.no + '"]');
  await page.waitForTimeout(200);
  const pr = await page.evaluate(() => document.getElementById('printArea').textContent);
  ok('★ พิมพ์ใบกำกับภาษีอย่างย่อได้ ระบุว่าราคารวมภาษีแล้ว', pr.indexOf('ใบกำกับภาษีอย่างย่อ') >= 0 && pr.indexOf('รวมภาษีมูลค่าเพิ่มแล้ว') >= 0);
  await page.click('[data-act="printclose"]');
  ok('ยอดคุมทุกตัวผ่านหลังขายเงินสด', (await recon('2026-06-30')).ok);

  console.log('\n[5] ใบเสนอราคา: แก้ไข → ลูกค้าตอบรับ → ออกใบกำกับเลย');
  await go('quotations');
  await page.click('#main [data-act="new:quotation"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.selectOption('[name="partner"]', corp.code);
  /* บริษัทจริงใช้วันที่วันนี้ของเครื่อง — ยืนราคา 30 วันจากสิ้น มิ.ย. จะหมดอายุแล้ว จึงยืนราคาไว้ยาวพอที่การทดสอบไม่ขึ้นกับวันที่รัน */
  await page.fill('[name="validUntil"]', '2099-12-31');
  await page.fill('[name="l0_desc"]', 'งานออกแบบระบบ');
  await page.fill('[name="l0_price"]', '20000');
  await page.selectOption('[name="l0_acc"]', '4121');
  await submit();
  const qNo = await page.evaluate(() => STATE.sel);
  await page.click('#main [data-act="trade:quotation:edit:' + qNo + '"]');
  await page.waitForSelector('#modal.show #lnTable');
  ok('ฟอร์มแก้ไขเติมบรรทัดเดิมให้', (await page.$eval('[name="l0_price"]', (e) => e.value)) === '20000'
    && (await page.$eval('[name="l0_acc"]', (e) => e.value)) === '4121');
  await page.fill('[name="l0_price"]', '25000');
  await page.click('#modal [data-act="ln:add"]');
  const last = await page.$eval('#lnTable tbody tr:last-child', (tr) => tr.getAttribute('data-ln'));
  await page.fill('[name="l' + last + '_desc"]', 'ค่าเดินทาง');
  await page.fill('[name="l' + last + '_price"]', '1000');
  await submit();
  const q = await page.evaluate((no) => DB.docs.quotation.find((x) => x.no === no), qNo);
  ok('★ แก้ใบเสนอราคาได้ เลขที่เดิม ยอดใหม่', q.no === qNo && q.base === 260000000 && q.lines.length === 2 && q.revision === 1);
  await page.click('#main [data-act="trade:quotation:approved:' + qNo + '"]');
  await page.waitForTimeout(150);
  ok('ตอบรับแล้วไม่มีปุ่มแก้ไข', !(await page.$('#main [data-act="trade:quotation:edit:' + qNo + '"]')));
  await page.click('#main [data-act="trade:quotation:toinvoice:' + qNo + '"]');
  await page.waitForSelector('#modal.show');
  await submit();
  const qi = await page.evaluate((no) => { const q = DB.docs.quotation.find((x) => x.no === no);
    const inv = DB.docs.invoice.find((d) => d.fromDoc === no); return { st: q.status, to: q.convertedTo, inv: inv && inv.no, total: inv && inv.total }; }, qNo);
  ok('★ ใบเสนอราคา → ใบกำกับภาษีตรง ๆ ไม่ต้องผ่านใบสั่งขาย', qi.st === 'closed' && qi.inv && qi.to === qi.inv && qi.total === 278200000, qi.inv);

  console.log('\n[6] ใบสั่งขาย → ทยอยออกใบกำกับ');
  await go('salesorders');
  await page.click('#main [data-act="new:salesorder"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.selectOption('[name="partner"]', corp.code);
  await page.selectOption('[name="l0_item"]', 'ST-1');
  await page.fill('[name="l0_qty"]', '10');
  await page.fill('[name="l1_desc"]', 'งานติดตั้งทั้งโครงการ');
  await page.fill('[name="l1_price"]', '50000');
  await page.selectOption('[name="l1_acc"]', '4121');
  await submit();
  const soNo = await page.evaluate(() => STATE.sel);
  await page.click('#main [data-act="trade:salesOrder:invoice:' + soNo + '"]');
  await page.waitForSelector('#modal.show [name="iq0"]');
  await page.fill('[name="iq0"]', '4');
  await page.fill('[name="iq1"]', '0.3');
  await submit();
  const s1 = await page.evaluate((no) => { const so = DB.docs.salesOrder.find((x) => x.no === no);
    return { st: so.status, got: soInvoiced(so).join(','), inv: DB.docs.invoice[0].base, screen: STATE.screen }; }, soNo);
  ok('★ ออกใบกำกับงวดแรกบางส่วน ใบสั่งขายยังเปิดค้าง', s1.st === 'partially_invoiced' && s1.got === '4,0.3' && s1.inv === 156000000
    && s1.screen === 'invoices', JSON.stringify(s1));
  await go('salesorders', soNo);
  ok('หน้าใบสั่งขายมีคอลัมน์ค้างออกและปุ่มออกส่วนที่เหลือ', (await page.$eval('#main', (e) => e.textContent)).indexOf('ค้างออก') >= 0
    && !!(await page.$('#main [data-act="trade:salesOrder:invoice:' + soNo + '"]')));
  await page.click('#main [data-act="trade:salesOrder:invoice:' + soNo + '"]');
  await page.waitForSelector('#modal.show [name="iq0"]');
  ok('รอบสองเติมจำนวนที่ค้างให้', (await page.$eval('[name="iq0"]', (e) => e.value)) === '6' && (await page.$eval('[name="iq1"]', (e) => e.value)) === '0.7');
  await submit();
  const s2 = await page.evaluate((no) => DB.docs.salesOrder.find((x) => x.no === no), soNo);
  ok('★ ออกครบแล้วใบสั่งขายปิดเอง ชี้ไปใบกำกับทั้งสองใบ', s2.status === 'closed' && s2.convertedTo.split(', ').length === 2, s2.convertedTo);
  ok('ยอดคุมทุกตัวผ่านหลังทยอยออกใบกำกับ', (await recon('2026-06-30')).ok);

  console.log('\n[7] ใบสั่งซื้อแยกบัญชีรายบรรทัด → ตั้งหนี้');
  await go('purchaseorders');
  await page.click('#main [data-act="new:purchaseorder"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.fill('[name="l0_desc"]', 'ค่าเช่าเครื่องถ่ายเอกสาร');
  await page.fill('[name="l0_price"]', '3000');
  await page.selectOption('[name="l0_acc"]', '5321');
  await page.fill('[name="l1_desc"]', 'ค่าซ่อมแอร์');
  await page.fill('[name="l1_price"]', '2500');
  await page.selectOption('[name="l1_acc"]', '5325');
  await submit();
  const poNo = await page.evaluate(() => STATE.sel);
  await page.click('#main [data-act="trade:purchaseOrder:convert:' + poNo + '"]');
  await page.waitForSelector('#modal.show [name="l1_acc"]');
  ok('ฟอร์มตั้งหนี้แสดงบัญชีของแต่ละบรรทัดตามใบสั่งซื้อ', (await page.$eval('[name="l0_acc"]', (e) => e.value)) === '5321'
    && (await page.$eval('[name="l1_acc"]', (e) => e.value)) === '5325');
  await page.fill('[name="vendorNo"]', 'INV-V-001');
  await submit();
  const bill = await page.evaluate(() => { const b = DB.docs.bill[0]; const e = DB.entries.find((x) => x.no === b.entryNo);
    return { accs: b.lines.map((l) => l.acc).join(','), dr: e.lines.filter((l) => /^53/.test(l.acc)).map((l) => l.acc + ':' + l.dr / 10000).join(' ') }; });
  ok('★ ตั้งหนี้แยกบัญชีตามบรรทัด ไม่รวมเป็นบัญชีเดียว', bill.accs === '5321,5325', bill.dr);
  await go('goodsreceipts');
  await page.click('#main [data-act="new:goodsreceipt"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.click('#modal [data-act="ln:add"]');
  await page.selectOption('[name="l0_item"]', 'ST-1');
  await page.fill('[name="l0_qty"]', '5');
  await page.selectOption('[name="l4_item"]', 'ST-1');
  await page.fill('[name="l4_qty"]', '7');
  await page.fill('[name="l4_price"]', '85');
  await submit();
  const grn = await page.evaluate(() => DB.docs.goodsReceipt[0]);
  ok('★ ใบรับสินค้าเพิ่มบรรทัดที่ 5 ได้ และรับครบทุกบรรทัดที่กรอก', grn.lines.length === 2 && grn.lines[1].qty === 7, grn.no);

  console.log('\n[8] ผู้ติดต่อ: เลิกใช้งานและลบ');
  await go('customers');
  await page.click('#main [data-act="partner:edit:' + person.code + '"]');
  await page.waitForSelector('#modal.show');
  ok('รายที่ใช้แล้วไม่มีปุ่มลบ บอกให้ตั้งเลิกใช้งานแทน', !(await page.$('#modal [data-act="partner:delete:' + person.code + '"]'))
    && (await page.$eval('#modal', (e) => e.textContent)).indexOf('ลบไม่ได้') >= 0);
  await page.selectOption('[name="active"]', 'no');
  await submit();
  ok('ทะเบียนแสดงสถานะเลิกใช้งาน', (await page.$eval('#main', (e) => e.textContent)).indexOf('เลิกใช้งาน') >= 0);
  await go('invoices');
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show');
  const opts = await page.$$eval('[name="partner"] option', (os) => os.map((o) => o.value));
  ok('★ ลูกค้าที่เลิกใช้งานไม่ขึ้นให้เลือกในเอกสารใหม่', opts.indexOf(person.code) < 0 && opts.indexOf(corp.code) >= 0);
  await page.click('#modal [data-act="modal:close"]');
  await go('ar');
  ok('ยอดค้างของลูกค้าที่เลิกใช้งานยังอยู่ในรายงานอายุลูกหนี้', (await page.$eval('#main', (e) => e.textContent)).indexOf('นายสมชาย ใจดี') >= 0);
  await go('customers');
  await page.click('#main [data-act="partner:new:customer"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="name"]', 'ลูกค้าที่เพิ่มผิด');
  await submit();
  const spare = await page.evaluate(() => DB.partners.find((p) => p.name === 'ลูกค้าที่เพิ่มผิด').code);
  await page.click('#main [data-act="partner:edit:' + spare + '"]');
  await page.waitForSelector('#modal [data-act="partner:delete:' + spare + '"]');
  await page.click('#modal [data-act="partner:delete:' + spare + '"]');
  await T.closed(page);
  ok('★ ลบลูกค้าที่ยังไม่เคยใช้ได้จากฟอร์ม', await page.evaluate((c) => !DB.partners.some((p) => p.code === c), spare));

  console.log('\n[9] ใบกำกับค้างชำระทุกเดือน');
  await page.evaluate((c) => { issueInvoice({ partnerCode: c, date: '2026-05-20', lines: [{ desc: 'งานเดือนก่อน', qty: 1, price: '9000' }] }); save(); }, corp.code);
  await page.evaluate(() => { STATE.chip = {}; });
  await go('invoices');
  const may = await page.evaluate(() => DB.docs.invoice.find((d) => d.date === '2026-05-20').no);
  ok('ตัวกรองปกติดูเฉพาะงวดที่เลือก ใบเดือนก่อนไม่ขึ้น', (await page.$eval('#main', (e) => e.textContent)).indexOf(may) < 0);
  await page.click('#main [data-act="chip:invoices:allopen"]');
  await page.waitForTimeout(150);
  const allOpen = await page.evaluate(() => ({ txt: document.getElementById('main').textContent,
    rows: document.querySelectorAll('#main tbody tr').length,
    want: DB.docs.invoice.filter((d) => invOutstanding(d) > 0).length,
    badge: document.querySelector('#main [data-act="chip:invoices:allopen"] .chip-n').textContent }));
  ok('★ "ค้างชำระทุกเดือน" แสดงใบค้างจากเดือนก่อนด้วย จำนวนบนป้ายตรงกับแถว', allOpen.txt.indexOf(may) >= 0
    && allOpen.rows === allOpen.want && String(allOpen.want) === allOpen.badge, allOpen.rows + ' ใบ');
  await page.evaluate(() => { STATE.chip = {}; });

  console.log('\n[9.1] ภาษีหัก ณ ที่จ่ายบนใบเสนอราคา (คำขอจากฝ่ายบัญชี)');
  await page.evaluate((c) => { const p = DB.partners.find((x) => x.code === c); p.whtCode = 'WHT_SERVICE'; save(); }, corp.code);
  await go('quotations');
  await page.click('#main [data-act="new:quotation"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.selectOption('[name="partner"]', corp.code);
  ok('★ เลือกลูกค้าที่ตั้งว่าหัก ณ ที่จ่ายไว้ ช่องหัก ณ ที่จ่ายเลือกให้เอง', (await page.$eval('[name="docWht"]', (e) => e.value)) === 'WHT_SERVICE');
  await page.fill('[name="validUntil"]', '2099-12-31');
  await page.fill('[name="l0_desc"]', 'ค่าออกแบบระบบบัญชี');
  await page.fill('[name="l0_price"]', '20000');
  await page.waitForTimeout(100);
  const live = await page.$eval('#modal .doc-tot', (e) => e.textContent);
  ok('★ ยอดท้ายเอกสารแสดงหัก ณ ที่จ่าย 3% และยอดชำระสุทธิทันที', /หักภาษี ณ ที่จ่าย\s*600\.00 \(3%/.test(live) && /ยอดชำระ\s*20,800\.00/.test(live), live);
  await submit();
  const qw = await page.evaluate(() => DB.docs.quotation.find((d) => d.no === STATE.sel));
  ok('บันทึกใบเสนอราคาพร้อมภาษีหัก ณ ที่จ่าย', qw && qw.wht === 6000000 && qw.payNet === 208000000, qw && qw.no);
  const det = await page.$eval('#main', (e) => e.textContent);
  ok('หน้ารายละเอียดใบเสนอราคาแสดงหัก ณ ที่จ่ายและยอดชำระสุทธิ', /ลูกค้าหักภาษี ณ ที่จ่าย 3%/.test(det) && /ยอดชำระสุทธิ/.test(det));
  await page.click('#main [data-act="printdoc:quotation:' + qw.no + '"]');
  await page.waitForTimeout(200);
  const pq = await page.evaluate(() => document.getElementById('printArea').textContent);
  ok('★ ใบเสนอราคาที่พิมพ์มีบรรทัดหักภาษี ณ ที่จ่ายและยอดชำระสุทธิ', /หักภาษี ณ ที่จ่าย 3%/.test(pq) && /ยอดชำระสุทธิ/.test(pq) && /20,800\.00/.test(pq));
  await page.click('[data-act="printclose"]');
  await page.click('#main [data-act="trade:quotation:approved:' + qw.no + '"]');
  await page.waitForTimeout(150);
  await page.click('#main [data-act="trade:quotation:toinvoice:' + qw.no + '"]');
  await page.waitForSelector('#modal.show');
  await submit();
  const iw = await page.evaluate((no) => DB.docs.invoice.find((d) => d.fromDoc === no), qw.no);
  ok('ใบกำกับจากใบเสนอราคาได้ภาษีหัก ณ ที่จ่ายต่อมา', iw && iw.whtCode === 'WHT_SERVICE' && iw.wht === 6000000);
  await go('invoices', iw.no);
  await page.click('#main [data-act="pay:' + iw.no + '"]');
  await page.waitForSelector('#modal.show');
  ok('★ ตอนรับชำระ ช่องลูกค้าหัก ณ ที่จ่ายเลือกตามใบกำกับให้แล้ว', (await page.$eval('[name="wht"]', (e) => e.value)) === 'WHT_SERVICE');
  await submit();
  const rw = await page.evaluate((no) => DB.docs.receipt.find((r) => r.invoiceNo === no), iw.no);
  ok('รับชำระแล้วถูกหักตรงกับใบเสนอราคา รับสุทธิเท่ายอดชำระสุทธิ', rw && rw.wht === 6000000 && rw.net === 208000000);

  console.log('\n[10] ตัวเลขรวม');
  ok('ยอดคุมทุกตัวผ่าน งวด พ.ค.', (await recon('2026-05-31')).ok);
  const fin = await recon('2026-06-30');
  ok('★ ยอดคุมทุกตัวผ่าน · รายงานภาษีขาย = บัญชีแยกประเภท · อายุลูกหนี้ = บัญชีคุม', fin.ok, fin.why);
  await T.done();
})();
