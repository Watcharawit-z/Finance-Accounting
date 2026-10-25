/* ทดสอบฝั่งขายแบบที่นักบัญชีคุ้นมือผ่านหน้าจอจริง (Chromium) บนบริษัทเปล่า
   ป้ายสถานะคือเมนู · ใบเสนอราคา → ใบวางบิล/ใบแจ้งหนี้ → ใบกำกับพร้อมรับเงิน · ใบกำกับรอดำเนินการ แก้ไข/ส่ง/รีเซ็ต
   หน้าต่างรับชำระครบทุกช่อง · ใบเสนอราคา → ขายเงินสด · เอกสารพิมพ์ (ส่วนลด ยอดท้ายเอกสาร เงื่อนไขชำระ ไม่พิมพ์โน้ตภายใน)
   ใช้: node webapp/build.js && node webapp/uitest-fa-sales.js */
const T = require('./uitestlib');

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };
const M = (s) => Math.round(Number(s) * 10000);

(async () => {
  const { page } = await T.open();
  const ok = T.ok;
  const submit = async () => { await page.click('#modal [data-act="modal:submit"]'); await T.closed(page); };
  const go = (screen, sel) => page.evaluate((a) => { STATE.screen = a[0]; STATE.sel = a[1] || null; STATE.filter = ''; render(); }, [screen, sel]);
  const modalOpen = () => page.waitForSelector('#modal.show');
  const stBtn = (kind, no) => '#main button.st-btn[data-act="stmenu:' + kind + ':' + no + '"]';
  /* กดป้ายสถานะของแถว แล้วคืนรายการในเมนู [การกระทำ, ชื่อ] */
  /* เลื่อนให้ปุ่มอยู่ในจอก่อนกด — เหตุการณ์เลื่อนจอที่มาทีหลังจะปิดเมนู (เหมือนผู้ใช้เลื่อนจอระหว่างเมนูเปิด) */
  const tapStatus = async (kind, no) => {
    await page.$eval(stBtn(kind, no), (e) => e.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(60);
    await page.click(stBtn(kind, no));
  };
  const openMenu = async (kind, no) => {
    await tapStatus(kind, no);
    await page.waitForSelector('#rowMenu.show');
    return page.$$eval('#rowMenu .rm-i', (els) => els.map((e) => [e.getAttribute('data-act').replace(/^rowgo:/, ''), e.textContent.trim(), e.className]));
  };
  const pick = (act) => page.click('#rowMenu .rm-i[data-act="rowgo:' + act + '"]');
  const label = (kind, no) => page.$eval(stBtn(kind, no), (e) => e.textContent.trim()).catch(() => '');
  const printText = async (kind, no) => {
    await page.evaluate((a) => printDoc(a[0], a[1]), [kind, no]);
    await page.waitForTimeout(250);
    const t = await page.evaluate(() => document.getElementById('printArea').textContent);
    await page.evaluate(() => closePrint());
    return t;
  };
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

  console.log('\n[1] ตั้งข้อมูล: ลูกค้า สินค้า และสต๊อก');
  const ids = await page.evaluate((t) => {
    const c = savePartner({ kind: 'customer', name: 'บริษัท ลูกค้า เอ จำกัด', taxId: t[0], branch: '00000', address: '1 ถนนสีลม กรุงเทพฯ 10500',
      termDays: 30, contactPerson: 'คุณสมศรี', mobile: '081-111-2222' }).partner;
    const v = savePartner({ kind: 'vendor', name: 'บริษัท ผู้ขาย บี จำกัด', taxId: t[1], branch: '00000', address: 'กรุงเทพฯ' }).partner;
    saveItem({ name: 'สินค้า ก', type: 'stock', uom: 'ชิ้น', price: '200', newCode: 'ST-1' });
    saveItem({ name: 'ค่าที่ปรึกษา', type: 'service', uom: 'ชั่วโมง', price: '1500', newCode: 'SV-1' });
    issueGoodsReceipt({ partnerCode: v.code, date: '2026-06-01', lines: [{ itemCode: 'ST-1', qty: 50, price: '100' }] });
    save();
    return { cust: c.code, custName: c.name, vend: v.code };
  }, [tid('010555900010'), tid('010555900020')]);
  ok('ตั้งข้อมูลแล้ว', !!ids.cust && !!ids.vend);

  console.log('\n[2] ใบเสนอราคาผ่านฟอร์ม · ป้ายสถานะคือเมนู');
  await go('quotations');
  await page.click('#main [data-act="new:quotation"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.selectOption('[name="partner"]', ids.cust);
  await page.fill('[name="validUntil"]', '2099-12-31');
  await page.fill('[name="project"]', 'ปรับปรุงหน้าร้าน');
  await page.fill('[name="salesName"]', 'คุณบี');
  await page.fill('[name="reference"]', 'PO-ลูกค้า-55');
  await page.selectOption('[name="priceMode"]', 'inclusive');
  await page.selectOption('[name="l0_item"]', 'ST-1');
  await page.fill('[name="l0_qty"]', '10');
  await page.fill('[name="l0_price"]', '214');
  await page.fill('[name="l0_disc"]', '10');
  await page.selectOption('[name="l1_item"]', 'SV-1');
  ok('เลือกบริการในเอกสารราคารวมภาษี ราคาแปลงเป็นรวมภาษีให้ (1,605)', (await page.$eval('[name="l1_price"]', (e) => e.value)) === '1605');
  await page.selectOption('[name="billDiscKind"]', 'amount');
  await page.fill('[name="billDisc"]', '100');
  await page.click('#contactBox > summary');
  await page.fill('[name="cBranch"]', '00002');
  await page.fill('[name="cAddress"]', '77 ถนนบางนา-ตราด สมุทรปราการ 10540');
  await page.fill('[name="note"]', 'ส่งของภายใน 7 วันหลังได้รับใบสั่งซื้อ');
  await page.fill('[name="internalNote"]', 'ลูกค้าต่อรองราคา ห้ามพิมพ์');
  await submit();
  const q = await page.evaluate(() => DB.docs.quotation.find((d) => d.no === STATE.sel));
  ok('★ บันทึกใบเสนอราคา: ราคารวมภาษี ส่วนลดรายการและท้ายบิล สาขาที่แก้ โปรเจกต์ พนักงานขาย', q && q.pricing.mode === 'inclusive'
    && q.lines[0].disc === '10' && q.totals.billDiscount === M(100) && q.snap.branch === '00002' && q.project === 'ปรับปรุงหน้าร้าน'
    && q.salesName === 'คุณบี' && q.internalNote === 'ลูกค้าต่อรองราคา ห้ามพิมพ์', q && q.no);
  await go('quotations');
  ok('★ คอลัมน์สถานะเป็นปุ่มเมนู "รออนุมัติ"', /รออนุมัติ/.test(await label('quotation', q.no)));
  let menu = await openMenu('quotation', q.no);
  const acts = (m) => m.map((x) => x[0]);
  ok('★ เมนูรออนุมัติ: แก้ไข อนุมัติ ไม่อนุมัติ ยกเลิก (ยกเลิกท้ายสุดเป็นสีอันตราย)', ['trade:quotation:edit:', 'trade:quotation:approved:', 'trade:quotation:rejected:']
    .every((a) => acts(menu).indexOf(a + q.no) >= 0) && /danger/.test(menu.find((x) => x[0] === 'trade:quotation:cancelled:' + q.no)[2])
    && acts(menu).indexOf('trade:quotation:cancelled:' + q.no) < acts(menu).findIndex((a) => a.indexOf('printdoc:') === 0),
    menu.map((x) => x[1]).join(' | '));
  ok('ยังไม่อนุมัติ ไม่มีเมนูสร้างเอกสารถัดไป', acts(menu).indexOf('qt:invoice:' + q.no) < 0);
  await pick('trade:quotation:approved:' + q.no);
  await page.waitForTimeout(150);
  ok('★ กดอนุมัติจากเมนู → ป้ายเป็น "อนุมัติ"', /^อนุมัติ/.test(await label('quotation', q.no)));
  menu = await openMenu('quotation', q.no);
  ok('★ เมนูอนุมัติ: สร้างใบสั่งขาย ใบวางบิล ใบกำกับภาษี ขายเงินสด ตามลำดับ และรีเซ็ต', ['trade:quotation:convert:', 'qt:billing:', 'qt:invoice:', 'qt:cash:',
    'trade:quotation:reset:'].map((a) => acts(menu).indexOf(a + q.no)).every((v, i, arr) => v >= 0 && (i === 0 || v > arr[i - 1])),
    menu.map((x) => x[1]).join(' | '));
  await pick('trade:quotation:reset:' + q.no);
  await page.waitForTimeout(150);
  ok('รีเซ็ตกลับเป็นรออนุมัติได้', /รออนุมัติ/.test(await label('quotation', q.no)));
  await page.evaluate((no) => { setTradeDocStatus('quotation', no, 'approved'); save(); render(); }, q.no);

  console.log('\n[3] ใบเสนอราคา → ใบวางบิล/ใบแจ้งหนี้ (ฟอร์มเติมทุกช่องให้)');
  await openMenu('quotation', q.no);
  await pick('qt:billing:' + q.no);
  await modalOpen();
  const pre = await page.evaluate(() => ({ partner: val('partner'), price: val('l0_price'), disc: val('l0_disc'), mode: val('priceMode'),
    bill: val('billDisc'), project: val('project'), ref: val('reference'), branch: val('cBranch'), note: val('note'), title: document.querySelector('.modal-h h3').textContent }));
  ok('★ ฟอร์มใบวางบิลเติมลูกค้า รายการ ส่วนลด ราคารวมภาษี โปรเจกต์ เลขอ้างอิง สาขาที่แก้ หมายเหตุ', pre.partner === ids.cust && pre.price === '214'
    && pre.disc === '10' && pre.mode === 'inclusive' && pre.bill === '100' && pre.project === 'ปรับปรุงหน้าร้าน' && pre.ref === 'PO-ลูกค้า-55'
    && pre.branch === '00002' && /7 วัน/.test(pre.note), JSON.stringify(pre));
  await submit();
  const bl = await page.evaluate((no) => { const b = DB.docs.billingNote[0]; const q = DB.docs.quotation.find((x) => x.no === no);
    return { b, qst: q.status, qto: q.convertedTo, screen: STATE.screen, entries: DB.entries.length }; }, q.no);
  ok('★ ใบวางบิล/ใบแจ้งหนี้ยอดเท่าใบเสนอราคา ลิงก์สองทาง ใบเสนอราคาปิด', bl.b.mode === 'items' && bl.b.total === q.total && bl.b.fromDoc === q.no
    && bl.qst === 'closed' && bl.qto === bl.b.no && bl.screen === 'billingnotes', bl.b.no);
  await go('billingnotes');
  ok('★ หน้าใบวางบิล: ป้าย "รอวางบิล" แบบใบแจ้งหนี้', /รอวางบิล/.test(await label('billingNote', bl.b.no))
    && (await page.$eval('#main', (e) => e.textContent)).indexOf('ใบแจ้งหนี้ 2 รายการ') >= 0);
  menu = await openMenu('billingNote', bl.b.no);
  ok('เมนูรอวางบิล: แก้ไข วางบิลแล้ว สร้างใบกำกับ ขายเงินสด ยกเลิก', ['bn:edit:', 'bn:delivered:', 'bn:toinvoice:', 'bn:tocash:', 'bn:cancel:']
    .every((a) => acts(menu).indexOf(a + bl.b.no) >= 0), menu.map((x) => x[1]).join(' | '));
  await pick('bn:edit:' + bl.b.no);
  await page.waitForSelector('#modal.show #lnTable');
  await page.fill('[name="l0_qty"]', '8');
  await submit();
  const ble = await page.evaluate((no) => DB.docs.billingNote.find((b) => b.no === no), bl.b.no);
  ok('★ แก้ใบวางบิลตอนรอวางบิลได้ เลขเดิม ยอดใหม่', ble.revision === 1 && ble.lines[0].qty === 8 && ble.total < bl.b.total, String(ble.total / 1e4));
  await go('billingnotes');
  await openMenu('billingNote', bl.b.no);
  await pick('bn:delivered:' + bl.b.no);
  await page.waitForTimeout(150);
  ok('★ วางบิลแล้ว → ป้าย "วางบิลแล้ว" และไม่มีเมนูแก้ไข', /วางบิลแล้ว/.test(await label('billingNote', bl.b.no))
    && acts(await openMenu('billingNote', bl.b.no)).indexOf('bn:edit:' + bl.b.no) < 0);
  await page.keyboard.press('Escape');
  await go('billingnotes', bl.b.no);
  const bdet = await page.$eval('#main', (e) => e.textContent);
  ok('หน้ารายละเอียดใบวางบิลแสดงหัวเอกสารและโน้ตภายใน (ไม่พิมพ์)', bdet.indexOf('ปรับปรุงหน้าร้าน') >= 0 && bdet.indexOf('โน้ตภายใน — ไม่พิมพ์') >= 0
    && bdet.indexOf('ลูกค้าต่อรองราคา ห้ามพิมพ์') >= 0);
  const pbl = await printText('billingNote', bl.b.no);
  ok('★ พิมพ์ใบวางบิล/ใบแจ้งหนี้: ส่วนลด ยอดท้ายเอกสาร เงื่อนไขชำระ ไม่พิมพ์โน้ตภายใน', pbl.indexOf('ใบวางบิล/ใบแจ้งหนี้') >= 0 && pbl.indexOf('ส่วนลด (%)') >= 0
    && pbl.indexOf('ราคาหลังหักส่วนลด') >= 0 && pbl.indexOf('เครดิต 30 วัน') >= 0 && pbl.indexOf('ลูกค้าต่อรองราคา') < 0 && pbl.indexOf('สาขาที่ 00002') >= 0);

  console.log('\n[4] ใบวางบิล → ใบกำกับภาษีพร้อมรับเงิน');
  await go('billingnotes');
  await openMenu('billingNote', bl.b.no);
  await pick('bn:toinvoice:' + bl.b.no);
  await page.waitForSelector('#modal.show #lnTable');
  ok('ฟอร์มใบกำกับเติมจากใบวางบิล (ลูกค้า จำนวน 8 สาขา 00002)', (await page.evaluate(() => val('partner') + '|' + val('l0_qty') + '|' + val('cBranch')))
    === ids.cust + '|8|00002');
  ok('ช่องวิธีรับเงินซ่อนจนกว่าจะเลือกรับชำระแล้ว', await page.$eval('#paidBox', (e) => e.hidden));
  await page.selectOption('[name="paidNow"]', 'yes');
  ok('เลือกรับชำระแล้ว → ช่องวิธีรับและบัญชีขึ้น', !(await page.$eval('#paidBox', (e) => e.hidden)));
  await page.selectOption('[name="rcvMethod"]', 'cash');
  ok('เลือกเงินสด บัญชีรับเปลี่ยนเป็นเงินสด', (await page.$eval('[name="rcvAcc"]', (e) => e.value)) === '1111');
  await submit();
  const iv = await page.evaluate((no) => { const b = DB.docs.billingNote.find((x) => x.no === no);
    const inv = DB.docs.invoice.find((x) => x.no === b.convertedTo);
    return { inv, bst: b.status, rc: DB.docs.receipt.find((r) => r.invoiceNo === inv.no) }; }, bl.b.no);
  ok('★ ใบกำกับออกพร้อมใบเสร็จ สถานะเก็บเงินแล้ว ใบวางบิลเปิดบิลแล้ว', iv.inv.status === 'paid' && !!iv.rc && iv.rc.bankAccount === '1111'
    && iv.bst === 'closed' && iv.inv.fromDoc === bl.b.no && iv.inv.total === ble.total, iv.inv.no + ' / ' + (iv.rc && iv.rc.no));
  await go('invoices');
  ok('★ รายการใบกำกับ: ป้าย "เก็บเงินแล้ว"', /เก็บเงินแล้ว/.test(await label('invoice', iv.inv.no)));
  await go('billingnotes');
  ok('ใบวางบิลป้าย "เปิดบิลแล้ว"', (await page.$eval('#main', (e) => e.textContent)).indexOf('เปิดบิลแล้ว') >= 0);
  const pin = await printText('invoice', iv.inv.no);
  ok('★ พิมพ์ใบกำกับ: หน่วย ส่วนลด รวมเป็นเงิน ส่วนลด ราคาหลังหักส่วนลด มูลค่าที่คำนวณภาษี โปรเจกต์ พนักงานขาย อ้างอิง หมายเหตุ',
    ['หน่วย', 'ส่วนลด (%)', 'รวมเป็นเงิน', 'ราคาหลังหักส่วนลด', 'มูลค่าที่คำนวณภาษี', 'จำนวนเงินรวมทั้งสิ้น', 'ปรับปรุงหน้าร้าน', 'คุณบี', 'PO-ลูกค้า-55',
      'ส่งของภายใน 7 วัน', 'รวมภาษีมูลค่าเพิ่มแล้ว', 'คุณสมศรี'].every((s) => pin.indexOf(s) >= 0));
  ok('★ ไม่พิมพ์โน้ตภายในบนใบกำกับ · ใช้สาขาตามที่แก้บนใบ', pin.indexOf('ลูกค้าต่อรองราคา') < 0 && pin.indexOf('สาขาที่ 00002') >= 0);
  ok('ใบกำกับที่ออกพร้อมรับเงินพิมพ์เลขที่ใบเสร็จไว้', pin.indexOf('รับชำระแล้วตามใบเสร็จเลขที่ ' + iv.rc.no) >= 0);

  console.log('\n[5] ใบกำกับรอดำเนินการ: แก้ไข → ส่งให้ลูกค้า → รีเซ็ต');
  await go('invoices');
  await page.click('#main [data-act="new:invoice"]');
  await page.waitForSelector('#modal.show #lnTable');
  await page.selectOption('[name="partner"]', ids.cust);
  await page.selectOption('[name="creditType"]', 'creditHidden');
  await page.selectOption('[name="l0_item"]', 'SV-1');
  await page.fill('[name="l0_qty"]', '2');
  await page.fill('[name="internalNote"]', 'โน้ตภายในใบกำกับ');
  await submit();
  const i5 = await page.evaluate(() => DB.docs.invoice.find((d) => d.no === STATE.sel));
  await go('invoices');
  ok('★ ใบกำกับใหม่ป้าย "รอดำเนินการ"', /รอดำเนินการ/.test(await label('invoice', i5.no)));
  menu = await openMenu('invoice', i5.no);
  ok('เมนูรอดำเนินการ: แก้ไข ส่งให้ลูกค้าแล้ว รับชำระ ... ยกเลิกท้ายสุด', acts(menu).indexOf('inv:edit:' + i5.no) === 0
    && acts(menu).indexOf('inv:deliver:' + i5.no) === 1 && acts(menu).indexOf('pay:' + i5.no) > 1
    && acts(menu).indexOf('void:invoice:' + i5.no) > acts(menu).indexOf('dn:' + i5.no), menu.map((x) => x[1]).join(' | '));
  await pick('inv:edit:' + i5.no);
  await page.waitForSelector('#modal.show #lnTable');
  ok('ฟอร์มแก้ไขเติมของเดิม (จำนวน 2 · เครดิตไม่แสดงวัน)', (await page.evaluate(() => val('l0_qty') + '|' + val('creditType'))) === '2|creditHidden');
  await page.fill('[name="l0_price"]', '1600');
  await page.fill('[name="project"]', 'งานแก้ไข');
  await submit();
  const e5 = await page.evaluate((no) => { const d = DB.docs.invoice.find((x) => x.no === no);
    return { d, n: DB.docs.invoice.filter((x) => x.no === no).length, old: DB.entries.find((e) => e.no === d.revisions[0].entryNo).status,
      rows: DB.taxTx.filter((t) => t.docNo === no).length }; }, i5.no);
  ok('★ แก้ไขแล้วเลขที่เดิม ยอดใหม่ 3,200 + 224 ใบสำคัญเดิมกลับรายการ แถวภาษีแถวเดียว', e5.n === 1 && e5.d.base === M(3200) && e5.d.vat === M(224)
    && e5.old === 'reversed' && e5.rows === 1 && e5.d.project === 'งานแก้ไข' && e5.d.revision === 1);
  ok('ยอดคุมทุกตัวผ่านหลังแก้ไข', (await recon('2026-06-30')).ok, (await recon('2026-06-30')).why);
  await go('invoices', i5.no);
  const det5 = await page.$eval('#main', (e) => e.textContent);
  ok('หน้ารายละเอียดใบกำกับ: เงื่อนไขชำระ โปรเจกต์ โน้ตภายใน และประวัติการแก้ไข', det5.indexOf('ไม่พิมพ์วันครบกำหนด') >= 0 && det5.indexOf('งานแก้ไข') >= 0
    && det5.indexOf('โน้ตภายในใบกำกับ') >= 0 && det5.indexOf('ประวัติการแก้ไข') >= 0);
  await go('invoices');
  await openMenu('invoice', i5.no);
  await pick('inv:deliver:' + i5.no);
  await page.waitForTimeout(150);
  ok('★ ส่งให้ลูกค้าแล้ว → ป้าย "รอเก็บเงิน"', /รอเก็บเงิน/.test(await label('invoice', i5.no)));
  menu = await openMenu('invoice', i5.no);
  ok('ส่งแล้วไม่มีเมนูแก้ไข มีเมนูรีเซ็ตและสร้างใบวางบิล', acts(menu).indexOf('inv:edit:' + i5.no) < 0 && acts(menu).indexOf('inv:reset:' + i5.no) >= 0
    && acts(menu).indexOf('inv:billing:' + i5.no) >= 0);
  await pick('inv:reset:' + i5.no);
  await page.waitForTimeout(150);
  ok('★ รีเซ็ตเป็นรอดำเนินการ', /รอดำเนินการ/.test(await label('invoice', i5.no)));
  const p5 = await printText('invoice', i5.no);
  ok('พิมพ์เครดิตไม่แสดงวันครบกำหนด: ขึ้น "เครดิต" ไม่ขึ้นวันครบกำหนด · ไม่มีคอลัมน์ส่วนลด', /เงื่อนไขชำระ\s*เครดิต/.test(p5) && p5.indexOf('ครบกำหนด') < 0
    && p5.indexOf('ส่วนลด (%)') < 0 && p5.indexOf('โน้ตภายในใบกำกับ') < 0);

  console.log('\n[6] หน้าต่างรับชำระครบทุกช่อง');
  await go('invoices', i5.no);
  await page.click('#main [data-act="pay:' + i5.no + '"]');
  await modalOpen();
  ok('ช่องธนาคารผู้โอนขึ้นเมื่อโอนเงิน ช่องเช็คซ่อน', await page.evaluate(() => !document.querySelector('[data-rcm="transfer"]').hidden
    && document.querySelector('[data-rcm="cheque"]').hidden));
  await page.fill('[name="amount"]', '1000');
  await page.selectOption('[name="wht"]', 'rate:3');
  await page.fill('[name="fee"]', '10');
  await page.selectOption('[name="adj0_type"]', 'commission');
  await page.fill('[name="adj0_amt"]', '20');
  await page.fill('[name="payerBank"]', 'ธนาคารกรุงไทย');
  await page.fill('[name="note"]', 'โอนงวดแรก');
  await page.waitForTimeout(100);
  const s6 = await page.$eval('#rcSum', (e) => e.textContent);
  const want = await page.evaluate((no) => receiptMath(DB.docs.invoice.find((d) => d.no === no), receiptFormInput()), i5.no);
  ok('★ สรุปยอดในฟอร์มใช้สูตรเดียวกับตอนลงบัญชี (ค่าธรรมเนียม รายการปรับลด เงินเข้าบัญชี)', s6.indexOf('ค่าธรรมเนียม') >= 0 && s6.indexOf('รายการปรับลด') >= 0
    && s6.indexOf(await page.evaluate((v) => fmt(v), want.net)) >= 0 && s6.indexOf('แบ่งจ่าย') >= 0, s6);
  await submit();
  const r6 = await page.evaluate((no) => ({ rc: DB.docs.receipt[0], st: DB.docs.invoice.find((d) => d.no === no).status }), i5.no);
  ok('★ ใบเสร็จงวดแรก: หัก 3% ค่าธรรมเนียม 10 ค่านายหน้า 20 ธนาคารผู้โอน หมายเหตุ → แบ่งจ่าย', r6.st === 'partially_paid' && r6.rc.whtRate === '3' && r6.rc.fee === M(10)
    && r6.rc.adjustments[0].type === 'commission' && r6.rc.net === r6.rc.gross - r6.rc.wht - M(30) && r6.rc.payerBank === 'ธนาคารกรุงไทย' && r6.rc.note === 'โอนงวดแรก');
  await go('invoices');
  ok('★ ป้ายใบกำกับเป็น "แบ่งจ่าย"', /แบ่งจ่าย/.test(await label('invoice', i5.no)));
  await go('invoices', i5.no);
  await page.click('#main [data-act="pay:' + i5.no + '"]');
  await modalOpen();
  await page.selectOption('[name="method"]', 'cheque');
  ok('เลือกเช็ค → ช่องเลขที่/วันที่/ธนาคารของเช็คขึ้น', await page.evaluate(() => [...document.querySelectorAll('[data-rcm="cheque"]')].every((e) => !e.hidden)
    && document.querySelector('[data-rcm="transfer"]').hidden));
  await page.fill('[name="chequeNo"]', '00451234');
  await page.fill('[name="chequeDate"]', '2026-06-30');
  await page.fill('[name="chequeBank"]', 'ธนาคารกรุงเทพ สาขาสีลม');
  const left = await page.evaluate((no) => invOutstanding(DB.docs.invoice.find((d) => d.no === no)), i5.no);
  await page.fill('[name="received"]', String((left - M(15)) / 10000));
  await page.waitForTimeout(80);
  ok('กรอกยอดที่ได้รับจริง → ช่องประเภทส่วนต่างขึ้น', await page.evaluate(() => !document.querySelector('[data-rcg]').hidden));
  await page.selectOption('[name="gapType"]', 'bank_fee');
  await submit();
  const r6b = await page.evaluate((no) => ({ rc: DB.docs.receipt[0], st: DB.docs.invoice.find((d) => d.no === no).status }), i5.no);
  ok('★ งวดสุดท้ายด้วยเช็ค: ส่วนต่าง 15 เป็นค่าธรรมเนียม เก็บเลขเช็ค → เก็บเงินแล้ว', r6b.st === 'paid' && r6b.rc.gap === M(15) && r6b.rc.gapType === 'bank_fee'
    && r6b.rc.chequeNo === '00451234' && r6b.rc.chequeBank === 'ธนาคารกรุงเทพ สาขาสีลม');
  const prc = await printText('receipt', r6b.rc.no);
  ok('★ พิมพ์ใบเสร็จ: เลขเช็ค ธนาคาร ส่วนต่างเป็นค่าธรรมเนียม', prc.indexOf('00451234') >= 0 && prc.indexOf('ธนาคารกรุงเทพ') >= 0 && prc.indexOf('ค่าธรรมเนียมธนาคาร') >= 0);
  const prc1 = await printText('receipt', r6.rc.no);
  ok('พิมพ์ใบเสร็จงวดแรก: ค่าธรรมเนียม ค่านายหน้า ธนาคารผู้โอน หมายเหตุ', prc1.indexOf('หัก ค่าธรรมเนียมธนาคาร') >= 0 && prc1.indexOf('ค่านายหน้า') >= 0
    && prc1.indexOf('ธนาคารกรุงไทย') >= 0 && prc1.indexOf('โอนงวดแรก') >= 0);
  await go('receipts', r6b.rc.no);
  const rdet = await page.$eval('#main', (e) => e.textContent);
  ok('หน้ารายละเอียดใบเสร็จแสดงเช็คและส่วนต่าง', rdet.indexOf('00451234') >= 0 && rdet.indexOf('ค่าธรรมเนียมธนาคาร') >= 0);
  await go('receipts');
  menu = await openMenu('receipt', r6b.rc.no);
  ok('ใบเสร็จ: ป้าย "เก็บเงินแล้ว" เป็นเมนู ดูใบกำกับ + ยกเลิก', acts(menu)[0] === 'open:invoices:' + i5.no && acts(menu).indexOf('void:receipt:' + r6b.rc.no) >= 0);
  await page.keyboard.press('Escape');
  ok('ยอดคุมผ่านหลังรับชำระ', (await recon('2026-06-30')).ok, (await recon('2026-06-30')).why);

  console.log('\n[7] ใบเสนอราคา → ขายเงินสด');
  const q2 = await page.evaluate((c) => {
    const d = issueTradeDoc('quotation', { partnerCode: c, date: '2026-06-20', validUntil: '2099-12-31', salesName: 'คุณซี',
      lines: [{ desc: 'สินค้า ก', qty: 2, price: '200', itemCode: 'ST-1', disc: '20' }], pricing: { mode: 'exclusive', lineDisc: 'amount' },
      contact: { address: '99 สาขาเชียงใหม่', branch: '00005' } });
    setTradeDocStatus('quotation', d.no, 'approved'); save(); return d;
  }, ids.cust);
  await go('quotations');
  await openMenu('quotation', q2.no);
  await pick('qt:cash:' + q2.no);
  await page.waitForSelector('#modal.show #lnTable');
  const pc = await page.evaluate(() => ({ kind: val('saleKind'), buyer: val('buyer'), name: val('buyerName'), sales: val('csSalesName'),
    toggle: !!document.querySelector('#modal select[name="saleKind"]') }));
  ok('★ ฟอร์มขายเงินสดเติมผู้ซื้อจากใบเสนอราคา ล็อกประเภทการขาย', pc.kind === 'cash' && pc.buyer === ids.cust && pc.name === ids.custName
    && pc.sales === 'คุณซี' && !pc.toggle, JSON.stringify(pc));
  await submit();
  const cs = await page.evaluate((no) => { const q = DB.docs.quotation.find((x) => x.no === no);
    return { cs: DB.docs.cashSale.find((x) => x.no === q.convertedTo), st: q.status }; }, q2.no);
  ok('★ ขายเงินสด: ผู้ซื้อ สาขาที่แก้ ส่วนลด ยอดไม่รวมภาษี 406.60 · ใบเสนอราคาปิด', cs.st === 'closed' && cs.cs && cs.cs.total === M(406.6)
    && cs.cs.buyerName === ids.custName && cs.cs.snap.branch === '00005' && cs.cs.fromDoc === q2.no && cs.cs.salesName === 'คุณซี');
  const pcs = await printText('cashSale', cs.cs.no);
  ok('พิมพ์ใบกำกับอย่างย่อ: ผู้ซื้อ ที่อยู่สาขา ส่วนลด พนักงานขาย', pcs.indexOf('ใบกำกับภาษีอย่างย่อ') >= 0 && pcs.indexOf('99 สาขาเชียงใหม่') >= 0
    && pcs.indexOf('ส่วนลด') >= 0 && pcs.indexOf('คุณซี') >= 0);
  await go('cashsales');
  ok('รายการขายเงินสด: ป้ายเป็นเมนูยกเลิก', acts(await openMenu('cashSale', cs.cs.no)).indexOf('void:cashSale:' + cs.cs.no) >= 0);
  await page.keyboard.press('Escape');

  console.log('\n[8] ใบเสนอราคา → ใบกำกับ (ปุ่มเดิม) · ใบสั่งขายเมนูสถานะ · พิมพ์ใบเสนอราคา');
  const q3 = await page.evaluate((c) => { const d = issueTradeDoc('quotation', { partnerCode: c, date: '2026-06-21', validUntil: '2099-12-31',
    lines: [{ desc: 'ค่าออกแบบ', qty: 1, price: '5000' }], project: 'โครงการ X', note: 'ยืนราคา 30 วัน', internalNote: 'ภายใน Q3' });
    setTradeDocStatus('quotation', d.no, 'approved'); save(); STATE.screen = 'quotations'; STATE.sel = d.no; render(); return d; }, ids.cust);
  const pq = await printText('quotation', q3.no);
  ok('★ พิมพ์ใบเสนอราคา: ยอดท้ายเอกสารเต็มรูป เงื่อนไขชำระ ยืนราคา โปรเจกต์ หมายเหตุ ไม่พิมพ์โน้ตภายใน', ['รวมเป็นเงิน', 'มูลค่าที่คำนวณภาษี',
    'ภาษีมูลค่าเพิ่ม 7%', 'จำนวนเงินรวมทั้งสิ้น', 'ยืนราคาถึง', 'โครงการ X', 'ยืนราคา 30 วัน', 'เครดิต 30 วัน'].every((s) => pq.indexOf(s) >= 0)
    && pq.indexOf('ภายใน Q3') < 0);
  await page.click('#main [data-act="trade:quotation:toinvoice:' + q3.no + '"]');
  await page.waitForSelector('#modal.show #lnTable');
  ok('ปุ่ม "ออกใบกำกับภาษีเลย" เปิดฟอร์มใบกำกับที่เติมไว้ (เลขอ้างอิง = ใบเสนอราคา)', (await page.evaluate(() => val('l0_price') + '|' + val('reference')))
    === '5000|' + q3.no);
  await submit();
  const i8 = await page.evaluate((no) => DB.docs.invoice.find((d) => d.fromDoc === no), q3.no);
  ok('ใบกำกับจากใบเสนอราคาได้โปรเจกต์ หมายเหตุ และเริ่มที่รอดำเนินการ', i8 && i8.project === 'โครงการ X' && i8.note === 'ยืนราคา 30 วัน' && i8.delivered === false
    && i8.fromKind === 'quotation');
  const so = await page.evaluate((c) => { const d = issueTradeDoc('salesOrder', { partnerCode: c, date: '2026-06-22',
    lines: [{ desc: 'ค่าบริการ', qty: 2, price: '1000' }] }); save(); return d; }, ids.cust);
  await go('salesorders');
  menu = await openMenu('salesOrder', so.no);
  ok('ใบสั่งขายรออนุมัติ: แก้ไข อนุมัติ ไม่อนุมัติ ยกเลิก', ['trade:salesOrder:edit:', 'trade:salesOrder:approved:', 'trade:salesOrder:cancelled:']
    .every((a) => acts(menu).indexOf(a + so.no) >= 0));
  await pick('trade:salesOrder:approved:' + so.no);
  await page.waitForTimeout(150);
  menu = await openMenu('salesOrder', so.no);
  ok('★ ใบสั่งขายอนุมัติ: เมนูสร้างใบกำกับภาษี', acts(menu).indexOf('trade:salesOrder:invoice:' + so.no) >= 0);
  await pick('trade:salesOrder:invoice:' + so.no);
  await page.waitForSelector('#modal.show [name="iq0"]');
  await page.fill('[name="iq0"]', '1');
  await submit();
  const soi = await page.evaluate((no) => DB.docs.invoice.find((d) => d.soNo === no), so.no);
  await go('invoices', soi.no);
  await page.click('#main [data-act="inv:edit:' + soi.no + '"]');
  await modalOpen();
  ok('★ ใบกำกับที่ผูกใบสั่งขาย: แก้ได้เฉพาะหัวเอกสาร (ไม่มีตารางรายการ)', !(await page.$('#modal #lnTable'))
    && (await page.$eval('.modal-h h3', (e) => e.textContent)).indexOf('แก้ไขหัวเอกสาร') === 0);
  await page.fill('[name="reference"]', 'PO-SO-1');
  await submit();
  ok('บันทึกหัวเอกสารแล้ว ยอดเดิม', await page.evaluate((no) => { const d = DB.docs.invoice.find((x) => x.no === no); return d.reference === 'PO-SO-1' && d.revision === 1; }, soi.no));

  console.log('\n[9] เมนูสถานะบนจอมือถือ · ยอดรวม');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await go('invoices');
  await tapStatus('invoice', i8.no);
  await page.waitForSelector('#rowMenu.show');
  const box = await page.$eval('#rowMenu', (e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, w: window.innerWidth }; });
  ok('★ จอมือถือ: กดป้ายสถานะแล้วเมนูอยู่ในจอ', box.l >= 0 && box.r <= box.w && box.r - box.l > 150, JSON.stringify(box));
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 950 });
  const fin = await recon('2026-06-30');
  ok('★ ยอดคุมทุกตัวผ่าน · รายงานภาษีขาย = บัญชี · อายุลูกหนี้ = บัญชีคุม', fin.ok, fin.why);
  ok('เลขที่ใบกำกับไม่ซ้ำ', await page.evaluate(() => new Set(DB.docs.invoice.map((d) => d.no)).size === DB.docs.invoice.length));
  await T.done();
})();
