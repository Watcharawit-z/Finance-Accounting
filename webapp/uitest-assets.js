/* ทดสอบหน้าจอทรัพย์สิน ค่าเสื่อม โครงการ และงบประมาณ ผ่านปุ่มและแบบฟอร์มจริง บนบริษัทเปล่า
   รันด้วย: node webapp/build.js && node webapp/uitest-assets.js */
const T = require('./uitestlib');
const { ok, closed } = T;

(async () => {
  const { page } = await T.open();
  const go = (screen, period) => page.evaluate((a) => {
    STATE.screen = a[0]; STATE.sel = null; STATE.filter = ''; if (a[1]) STATE.period = a[1]; render();
  }, [screen, period || null]);
  const modalOpen = () => page.waitForSelector('#modal.show');
  const submit = async () => { await page.click('[data-act="modal:submit"]'); };
  const main = () => page.$eval('#main', (e) => e.textContent);
  const toastText = () => page.$eval('#toast', (e) => e.textContent);

  /* ---------- เตรียมบริษัทเปล่า: ลูกค้า ผู้ขาย และซื้อรถผ่านตั้งหนี้เข้าบัญชีทรัพย์สิน ---------- */
  await T.blank(page, '2026-03');
  const setup = await page.evaluate(() => {
    const cus = savePartner({ kind: 'customer', name: 'บริษัท ผู้ซื้อรถ จำกัด', taxId: '0105548021442',
      address: '1 ถนนสุขุมวิท กรุงเทพมหานคร 10110', branch: '00000' }).partner;
    const ven = savePartner({ kind: 'vendor', name: 'บริษัท ขายรถ จำกัด', taxId: '0105533001823',
      address: '9 ถนนบางนา กรุงเทพมหานคร 10260', branch: '00000' }).partner;
    const bill = recordBill({ partnerCode: ven.code, date: '2026-01-10', vendorNo: 'CAR-0001',
      lines: [{ desc: 'รถบรรทุก 6 ล้อ', qty: 1, price: '120000', acc: '1302' }] });
    save();
    return { cus: cus.code, ven: ven.code, bill: bill.no };
  });

  console.log('\n[1] ทะเบียนเทียบบัญชี และลงทะเบียนจากรายการตั้งหนี้');
  await go('assets');
  let txt = await main();
  ok('★ หน้าทะเบียนชี้ว่ามีรายการซื้อที่ลงบัญชีทรัพย์สินแต่ยังไม่ลงทะเบียน', txt.indexOf('ยังไม่ลงทะเบียน 1 รายการ') >= 0 && txt.indexOf('มีผลต่าง') >= 0);
  await page.click('[data-act^="fa:fromdoc:bill|"]');
  await modalOpen();
  ok('ฟอร์มดึงชื่อ วันที่ และราคาทุนจากเอกสาร', await page.$eval('[name="name"]', (e) => e.value) === 'รถบรรทุก 6 ล้อ'
    && await page.$eval('[name="inService"]', (e) => e.value) === '2026-01-10'
    && (await page.$eval('#fdInfo', (e) => e.textContent)).indexOf('120,000.00') >= 0);
  await page.selectOption('[name="class"]', 'VEHICLE');
  await page.fill('[name="bookYears"]', '5');
  await submit();
  await closed(page);
  const asset = await page.evaluate(() => DB.assets[0]);
  ok('★ ลงทะเบียนแล้ว ราคาทุน 120,000 บัญชี 1302 อ้างตั้งหนี้', !!asset && asset.cost === 1200000000 && asset.account === '1302'
    && asset.source.no === setup.bill, asset && asset.code);
  txt = await main();
  ok('★ ทะเบียนตรงกับบัญชีหลังลงทะเบียน', txt.indexOf('ตรงกันทุกบัญชี') >= 0);

  console.log('\n[2] ค่าเสื่อมย้อนหลังเมื่อตั้งค่าเสื่อมครั้งแรกในเดือนมีนาคม');
  await go('deprec', '2026-03');
  txt = await main();
  ok('ก่อนกดตั้ง เห็นรายการที่จะลงบัญชีพร้อมจำนวนเดือน', txt.indexOf('รายการที่จะลงบัญชีเมื่อกดตั้งค่าเสื่อม') >= 0 && txt.indexOf('มกราคม 2569') >= 0);
  await page.click('[data-act="run:deprec"]');
  await page.waitForTimeout(300);
  const run = await page.evaluate(() => DB.docs.depreciation.find((d) => d.period === '2026-03'));
  ok('★ เริ่มใช้มกราคม ตั้งครั้งแรกมีนาคม ได้ 3 เดือน 6,000 บาท', run && run.rows[0].months === 3 && run.bookTotal === 60000000,
    run && run.rows[0].months + ' เดือน');
  txt = await main();
  ok('หน้าจอบอกว่ารวมเดือนที่ยังไม่ได้คิด', txt.indexOf('ยังไม่ได้คิด') >= 0 && txt.indexOf('ประวัติการตั้งค่าเสื่อม') >= 0);

  console.log('\n[3] ขายทรัพย์สินผ่านแบบฟอร์ม');
  await go('assets', '2026-05');
  await page.click('.card-acts [data-act="fa:dispose"]');
  await modalOpen();
  await page.selectOption('[name="faKind"]', 'sale');
  await page.fill('[name="faDate"]', '2026-05-20');
  await page.fill('[name="faProceeds"]', '100000');
  await page.selectOption('[name="faPartner"]', setup.cus);
  await page.waitForTimeout(150);
  const prev = await page.$eval('#faPreview', (e) => e.textContent);
  ok('★ ตัวอย่างก่อนบันทึก: ค่าเสื่อมเพิ่ม 2 เดือน · ขาดทุน 10,000 · ภาษีขาย 7,000', prev.indexOf('ค่าเสื่อมเพิ่ม 2 เดือน') >= 0
    && prev.indexOf('ขาดทุนจากการจำหน่าย10,000.00') >= 0 && prev.indexOf('7,000.00') >= 0, prev.slice(0, 160));
  ok('ผู้ซื้ออยู่ในทะเบียนแล้ว ช่องกรอกชื่อผู้ซื้อถูกซ่อน', await page.$eval('#faBuyerBox', (e) => e.style.display === 'none'));
  await submit();
  await closed(page);
  const sale = await page.evaluate(() => {
    const d = DB.docs.assetDisposal[0];
    const rec = reconciliationChecks('2026-05-31');
    return { d, rec: rec.allPassed, g1302: balanceOf('1302', '2026-05-31'), g1310: balanceOf('1310', '2026-05-31'),
      vat: DB.taxTx.find((t) => t.docNo === d.no), status: DB.assets[0].status };
  });
  ok('★ ขายแล้ว: ราคาทุนและค่าเสื่อมสะสมออกจากบัญชี ทรัพย์สินเป็น "จำหน่ายแล้ว"', sale.g1302 === 0 && sale.g1310 === 0 && sale.status === 'disposed');
  ok('★ ภาษีขาย 7,000 เข้ารายงานภาษีขาย และยอดคุมผ่านทุกข้อ', sale.vat && sale.vat.tax === 70000000 && sale.rec);
  txt = await main();
  ok('เปิดเอกสารขายให้ทันทีพร้อมการคำนวณ', txt.indexOf('ขายทรัพย์สิน เลขที่ ' + sale.d.no) >= 0 && txt.indexOf('ขาดทุนจากการจำหน่าย') >= 0);
  await page.click('[data-act="printdoc:assetDisposal:' + sale.d.no + '"]');
  await page.waitForSelector('#printArea.show');
  const pr = await page.$eval('#printArea', (e) => e.textContent);
  ok('★ พิมพ์ใบกำกับภาษี/ใบเสร็จรับเงิน มีผู้ซื้อ ภาษี 7% และจำนวนเงินเป็นตัวอักษร', pr.indexOf('ใบกำกับภาษี/ใบเสร็จรับเงิน') >= 0
    && pr.indexOf('บริษัท ผู้ซื้อรถ จำกัด') >= 0 && pr.indexOf('หนึ่งแสนเจ็ดพันบาทถ้วน') >= 0);
  await page.click('[data-act="printclose"]');
  await go('vatout', '2026-05');
  ok('รายงานภาษีขายมีเลขที่เอกสารขายทรัพย์สิน', (await main()).indexOf(sale.d.no) >= 0);

  console.log('\n[4] ยกเลิกการขาย');
  await page.evaluate((no) => { STATE.screen = 'assets'; STATE.sel = no; render(); }, sale.d.no);
  await page.click('[data-act="fa:void:' + sale.d.no + '"]');
  await modalOpen();
  ok('บอกสิ่งที่จะเกิดก่อนยืนยัน', (await page.$eval('.void-prev', (e) => e.textContent)).indexOf('กลับรายการใบสำคัญ') >= 0);
  await page.fill('[name="reason"]', 'ผู้ซื้อยกเลิกการซื้อ');
  await submit();
  await closed(page);
  const after = await page.evaluate(() => ({ a: DB.assets[0], g: balanceOf('1302', '2026-05-31'), rec: reconciliationChecks('2026-05-31').allPassed,
    vat: DB.taxTx.find((t) => t.assetDisposalNo) }));
  ok('★ ยกเลิกแล้ว ทรัพย์สินกลับมาใช้งาน ค่าเสื่อมสะสมเท่าเดิม ภาษีขายเป็นยกเลิก', after.a.status === 'in_use' && after.a.accumBook === 60000000
    && after.g === 1200000000 && after.vat.void && after.rec);

  console.log('\n[5] ขายเงินเชื่อแล้วรับชำระ');
  await go('assets', '2026-05');
  await page.click('.card-acts [data-act="fa:dispose"]');
  await modalOpen();
  await page.fill('[name="faDate"]', '2026-05-25');
  await page.fill('[name="faProceeds"]', '50000');
  await page.selectOption('[name="faSettle"]', 'credit');
  await page.selectOption('[name="faPartner"]', setup.cus);
  await page.waitForTimeout(100);
  ok('ขายเชื่อ ไม่ต้องเลือกบัญชีรับเงิน', await page.$eval('#faPayToBox', (e) => e.style.display === 'none'));
  await submit();
  await closed(page);
  const cr = await page.evaluate(() => DB.docs.assetDisposal[0]);
  ok('★ ขายเชื่อ ตั้งลูกหนี้จากการขายทรัพย์สิน 53,500', cr.settle === 'credit' && cr.total === 535000000 && !!cr.recvAccount);
  await page.click('[data-act="fa:collect:' + cr.no + '"]');
  await modalOpen();
  await page.fill('[name="date"]', '2026-05-28');
  await submit();
  await closed(page);
  const col = await page.evaluate((no) => ({ out: assetSaleOutstanding(DB.docs.assetDisposal.find((d) => d.no === no)),
    rec: reconciliationChecks('2026-05-31').allPassed, tb: trialBalance('2026-01-01', '2026-12-31').balanced }), cr.no);
  ok('★ รับชำระครบ ยอดค้างเป็นศูนย์ ยอดคุมผ่าน งบทดลองสมดุล', col.out === 0 && col.rec && col.tb);
  ok('มีปุ่มพิมพ์ใบเสร็จของการรับชำระ', !!(await page.$('[data-act^="printdoc:assetReceipt:"]')));

  console.log('\n[6] ลงทะเบียนยอดยกมา (ไม่ลงบัญชี) และเพิ่มทรัพย์สินด้วยมือ');
  await go('assets', '2026-06');
  const e0 = await page.evaluate(() => DB.entries.length);
  await page.click('.card-acts [data-act="fa:opening"]');
  await modalOpen();
  ok('ฟอร์มยอดยกมาบอกชัดว่าไม่ลงบัญชี', (await page.$eval('#modal', (e) => e.textContent)).indexOf('ไม่ลงบัญชี') >= 0);
  await page.fill('[name="name"]', 'อาคารสำนักงานเดิม');
  await page.selectOption('[name="class"]', 'BUILDING');
  await page.fill('[name="inService"]', '2021-01-01');
  await page.fill('[name="cost"]', '2400000');
  await page.fill('[name="bookYears"]', '20');
  await page.fill('[name="asOf"]', '2025-12-31');
  await page.click('[data-act="fa:suggest"]');
  await page.waitForTimeout(100);
  ok('★ ปุ่มคำนวณเติมค่าเสื่อมสะสม 60 เดือน = 600,000', await page.$eval('[name="accumBook"]', (e) => e.value) === '600000.00');
  await submit();
  await closed(page);
  const op = await page.evaluate((n) => ({ a: DB.assets.find((x) => x.name === 'อาคารสำนักงานเดิม'), n: DB.entries.length }), e0);
  ok('★ ลงทะเบียนยอดยกมาไม่สร้างใบสำคัญ คิดค่าเสื่อมต่อจาก ม.ค. 2569', op.a && op.a.opening && op.a.depThrough === '2025-12' && op.n === e0);
  await page.click('.card-acts [data-act="asset:new"]');
  await modalOpen();
  await page.fill('[name="name"]', 'ชั้นวางสินค้า');
  await page.selectOption('[name="class"]', 'FURNITURE');
  await page.fill('[name="cost"]', '80000');
  await page.fill('[name="bookYears"]', '5');
  await submit();
  await closed(page);
  ok('เพิ่มทรัพย์สินด้วยมือได้', await page.evaluate(() => DB.assets.some((a) => a.name === 'ชั้นวางสินค้า' && a.status === 'in_use')));
  txt = await main();
  ok('★ ทรัพย์สินที่ไม่มีรายการซื้อในบัญชี ทะเบียนเทียบบัญชีแสดงผลต่างพร้อมเหตุผล', txt.indexOf('ทะเบียนมีทรัพย์สินที่ไม่ได้บันทึกบัญชี') >= 0);
  const shelf = await page.evaluate(() => DB.assets.find((a) => a.name === 'ชั้นวางสินค้า').code);
  await page.click('[data-act="asset:edit:' + shelf + '"]');
  await modalOpen();
  await page.click('#modal [data-act="fa:delete:' + shelf + '"]');
  await page.waitForTimeout(100);
  await page.fill('[name="reason"]', 'เพิ่มผิด ยังไม่ได้ซื้อจริง');
  await submit();
  await closed(page);
  ok('★ ลบทรัพย์สินที่ลงทะเบียนผิดได้จากแบบฟอร์ม (ยังไม่เคยคิดค่าเสื่อม)', await page.evaluate((c) => !DB.assets.some((a) => a.code === c), shelf));

  console.log('\n[7] โครงการ');
  await go('projects', '2026-06');
  ok('บริษัทเปล่ามีปุ่มสร้างโครงการ', !!(await page.$('[data-act="proj:new"]')));
  await page.click('.card-acts [data-act="proj:new"]');
  await modalOpen();
  await page.fill('[name="newCode"]', 'PJ-2569-01');
  await page.fill('[name="name"]', 'ติดตั้งระบบไฟฟ้า');
  await page.selectOption('[name="customer"]', setup.cus);
  await page.fill('[name="contract"]', '300000');
  await page.fill('[name="budget"]', '200000');
  await submit();
  await closed(page);
  const inv = await page.evaluate((c) => {
    const i = issueInvoice({ partnerCode: c, date: '2026-06-10', lines: [{ desc: 'งวดที่ 1', qty: 1, price: '150000', taxCode: 'VAT7' }] });
    save(); render();
    return i.no;
  }, setup.cus);
  await page.click('[data-act="proj:tag:PJ-2569-01"]');
  await modalOpen();
  await page.check('[data-tag="invoice|' + inv + '"]');
  await submit();
  await closed(page);
  ok('★ ผูกใบกำกับเข้าโครงการแล้ว รายได้จริงขึ้นในหน้ารายละเอียด', await page.evaluate(() => projectActuals('PJ-2569-01').revenue === 1500000000)
    && (await main()).indexOf('150,000.00') >= 0);
  await page.click('[data-act="proj:close:PJ-2569-01"]');
  await modalOpen();
  await page.fill('[name="reason"]', 'ส่งมอบงานครบแล้ว');
  await submit();
  await closed(page);
  ok('ปิดโครงการได้', await page.evaluate(() => DB.projects[0].status === 'closed'));

  console.log('\n[8] งบประมาณ');
  await go('budget', '2026-06');
  await page.click('.card-acts [data-act="bud:edit"]');
  await modalOpen();
  await page.selectOption('[name="bdAcc"]', '5321');
  await page.fill('[name="bdAnnual"]', '120000');
  await page.click('[data-act="bud:spread"]');
  ok('★ แบ่งเท่ากันทุกเดือน 10,000 และรวม 120,000', await page.$eval('[name="bd0"]', (e) => e.value) === '10000.00'
    && await page.$eval('#bdSum', (e) => e.textContent) === '120,000.00');
  await submit();
  await closed(page);
  await page.evaluate((v) => {
    recordExpense({ partnerCode: v, date: '2026-06-05', lines: [{ desc: 'ค่าเช่า มิ.ย.', qty: 1, price: '12500', acc: '5321', taxCode: 'EXEMPT' }] });
    save(); render();
  }, setup.ven);
  txt = await main();
  ok('★ งบเทียบใช้จริง: งบ 10,000 ใช้จริง 12,500 เกินงบ 125%', txt.indexOf('12,500.00') >= 0 && txt.indexOf('(2,500.00)') >= 0 && txt.indexOf('125.0%') >= 0);
  const csv = await page.evaluate(() => exportCsv(document.querySelector('#main .card')));
  ok('★ ส่งออก CSV ได้ มีหัวตารางและบัญชี', csv.indexOf('งบเดือนนี้') >= 0 && csv.indexOf('5321') >= 0);
  await page.evaluate(() => { DB.periods.find((p) => p.code === '2026-01').status = 'closed'; STATE.period = '2026-01'; render(); });
  await page.click('[data-act="bud:edit:5321"]');
  await modalOpen();
  await page.fill('[name="bd0"]', '9000');
  await submit();
  await closed(page);
  ok('★ แก้งบของงวดที่ปิดแล้วได้', await page.evaluate(() => budgetAmount('5321', '2026-01') === 90000000));

  console.log('\n[9] เมนูสร้างเอกสารและหน้าจอบริษัทเปล่า');
  await page.click('#newBtn');
  await page.waitForSelector('#pop.show');
  ok('เมนูสร้างเอกสารมีขาย/ตัดจำหน่ายทรัพย์สิน โครงการ และงบประมาณ', !!(await page.$('#pop [data-act="popgo:fa:dispose"]'))
    && !!(await page.$('#pop [data-act="popgo:proj:new"]')) && !!(await page.$('#pop [data-act="popgo:bud:edit"]')));
  await page.click('#pop [data-act="popgo:fa:opening"]');
  await modalOpen();
  ok('เลือกจากเมนูแล้วเปิดฟอร์มทันที', (await page.$eval('.modal-h h3', (e) => e.textContent)) === 'ลงทะเบียนทรัพย์สินยอดยกมา');
  await page.click('[data-act="modal:close"]');
  ok('★ ยอดคุมผ่านทุกข้อทั้งปีหลังทำทุกอย่าง', await page.evaluate(() => reconciliationChecks('2026-12-31').allPassed));

  await T.done();
})().catch(async (e) => { console.error(e); process.exit(1); });
