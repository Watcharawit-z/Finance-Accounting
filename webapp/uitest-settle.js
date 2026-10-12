/* ทดสอบหน้าเว็บของระบบรับ–จ่ายชำระ — กดปุ่มและกรอกแบบฟอร์มจริงในบริษัทเปล่า
   รันหลัง node build.js: node uitest-settle.js */
const T = require('./uitestlib');

(async () => {
  const { page } = await T.open();
  await T.blank(page, '2026-06');
  /* ทะเบียนตั้งต้น (ไม่ใช่สิ่งที่ทดสอบ) — ลูกค้า ผู้ขาย สินค้า */
  await page.evaluate(() => {
    savePartner({ kind:'customer', name:'บริษัท ลูกค้าดี จำกัด', taxId:'0105540022881', branch:'00000', address:'1 ถนนสุขุมวิท กรุงเทพฯ', termDays: 30 });
    savePartner({ kind:'customer', name:'บริษัท ลูกค้าสอง จำกัด', taxId:'0105536091238', branch:'00000', address:'2 ถนนพระราม 3 กรุงเทพฯ', termDays: 30 });
    savePartner({ kind:'vendor', name:'บริษัท ช่างซ่อม จำกัด', taxId:'0105533001823', branch:'00000', address:'3 ถนนบางนา', termDays: 30, whtCode:'WHT_SERVICE' });
    saveItem({ name:'สินค้าทดสอบ A', type:'stock', uom:'ชิ้น', price:'200' });
    save(); render();
  });
  const CUS = 'CUS-0001', CUS2 = 'CUS-0002', VEN = 'VEN-0001', ITEM = 'IT-0001';
  const modalOpen = () => page.waitForSelector('#modal.show');
  const submit = async () => { await page.click('#modal [data-act="modal:submit"]'); await T.closed(page); };
  const errToast = () => page.evaluate(() => document.getElementById('modal').classList.contains('show')
    && document.getElementById('toast').className.indexOf('err') >= 0);
  const go = (screen, sel, period) => page.evaluate((a) => { if (a.p) STATE.period = a.p; STATE.screen = a.s; STATE.sel = a.sel || null; STATE.filter = ''; render(); },
    { s: screen, sel, p: period });
  const inv = (date, price, partner) => page.evaluate((a) => issueInvoice({ partnerCode: a.c, date: a.d,
    lines:[{ desc:'ค่าบริการติดตั้งระบบ', qty:1, price: a.p, taxCode:'VAT7' }] }).no, { d: date, p: price, c: partner || CUS });
  const recon = (asOf) => page.evaluate((d) => { const r = reconciliationChecks(d); return r.allPassed ? '' : r.checks.filter((c) => !c.ok).map((c) => c.code).join(','); }, asOf);
  const line = (entryNo, code) => page.evaluate((a) => { const e = DB.entries.find((x) => x.no === a.e);
    return e.lines.filter((l) => l.acc === a.c).reduce((s, l) => s + l.dr - l.cr, 0); }, { e: entryNo, c: code });
  const M = (s) => Math.round(Number(s) * 10000);

  console.log('\n[1] ใบเสร็จ: เลือกบัญชีรับเงิน · เงินสดลงบัญชีเงินสด · จำบัญชีที่เลือกล่าสุด');
  const i1 = await inv('2026-06-05', '1000');
  await go('invoices', i1);
  await page.click('#main [data-act="pay:' + i1 + '"]');
  await modalOpen();
  T.ok('ฟอร์มรับชำระมีช่องเลือกบัญชี ค่าเริ่มต้นเป็นธนาคาร', (await page.$eval('[name="bankAccount"]', (e) => e.value)) === '1113');
  await page.selectOption('[name="method"]', 'cash');
  T.ok('★ เลือกวิธีเงินสด บัญชีเปลี่ยนเป็นเงินสดในมือ 1111', (await page.$eval('[name="bankAccount"]', (e) => e.value)) === '1111');
  await submit();
  const rc1 = await page.evaluate(() => DB.docs.receipt[0]);
  T.ok('★ ใบเสร็จเงินสดลงบัญชี 1111 ไม่ใช่ธนาคาร', rc1.bankAccount === '1111' && (await line(rc1.entryNo, '1111')) === M(1070));
  const i2 = await inv('2026-06-05', '1000');
  await go('invoices', i2);
  await page.click('#main [data-act="pay:' + i2 + '"]');
  await modalOpen();
  await page.selectOption('[name="bankAccount"]', '1114');
  await submit();
  const i3 = await inv('2026-06-06', '1000');
  await go('invoices', i3);
  await page.click('#main [data-act="pay:' + i3 + '"]');
  await modalOpen();
  T.ok('★ เปิดฟอร์มครั้งถัดไป จำบัญชีธนาคารที่เลือกล่าสุด (1114)', (await page.$eval('[name="bankAccount"]', (e) => e.value)) === '1114');

  console.log('\n[2] ลูกค้าจ่ายขาดเพราะค่าโอน — ปิดยอดได้ ใบกำกับไม่ค้างเศษ');
  await page.fill('[name="amount"]', '1045');
  await page.selectOption('[name="wht"]', 'WHT_SERVICE');
  await page.selectOption('[name="diffType"]', 'fee');
  const sum = await page.$eval('#rcSum', (e) => e.textContent);
  T.ok('สรุปยอดในฟอร์มบอกว่าจะปิดส่วนต่าง 25 และเงินเข้าบัญชี 1,015', sum.indexOf('25.00') >= 0 && sum.indexOf('1,015.00') >= 0, sum);
  await submit();
  const r3 = await page.evaluate((no) => ({ rc: DB.docs.receipt[0], inv: DB.docs.invoice.find((d) => d.no === no) }), i3);
  T.ok('★ ปิดส่วนต่าง 25 เป็นค่าธรรมเนียม หัก ณ ที่จ่าย 30 ใบกำกับรับครบ', r3.rc.diff === M(25) && r3.rc.wht === M(30) && r3.inv.status === 'paid'
    && (await line(r3.rc.entryNo, '5410')) === M(25), r3.inv.status);

  console.log('\n[3] ลูกค้าจ่ายเกิน — ต้องเลือกเก็บเป็นเครดิต แล้วใช้หักใบถัดไปได้');
  const i4 = await inv('2026-06-10', '1000');
  await go('invoices', i4);
  await page.click('#main [data-act="pay:' + i4 + '"]');
  await modalOpen();
  await page.fill('[name="amount"]', '1200');
  T.ok('สรุปยอดเตือนว่ารับเกิน', (await page.$eval('#rcSum', (e) => e.innerHTML)).indexOf('bad') >= 0);
  await page.click('#modal [data-act="modal:submit"]');
  await page.waitForTimeout(250);
  T.ok('ไม่เลือกเก็บเป็นเครดิต ระบบไม่ยอมรับเกิน', await errToast());
  await page.selectOption('[name="diffType"]', 'credit');
  await submit();
  const over = await page.evaluate(() => DB.docs.receipt[0]);
  T.ok('★ รับเกิน 130 เก็บเป็นเครดิตของลูกค้า (เงินมัดจำรับ 2161)', over.excess === M(130) && (await line(over.entryNo, '2161')) === -M(130));
  await go('deposits');
  T.ok('หน้าเงินมัดจำรับแสดงเครดิตรับเกิน', (await page.$eval('#main', (e) => e.textContent)).indexOf(over.no) >= 0);
  const i5 = await inv('2026-06-12', '500');
  await go('invoices', i5);
  await page.click('#main [data-act="settle:apply:ar:tgt:' + i5 + '"]');
  await modalOpen();
  await submit();
  const ap5 = await page.evaluate((no) => ({ out: invOutstanding(DB.docs.invoice.find((d) => d.no === no)), a: DB.docs.creditApply[0] }), i5);
  T.ok('★ กดหักกลบเครดิตที่หน้าใบกำกับ ยอดค้างลดลง 130 เหลือ 405', ap5.out === M(405) && ap5.a.sourceNo === over.no, ap5.a.no);
  T.ok('หน้าใบกำกับแสดงรายการหักกลบ', (await page.$eval('#main', (e) => e.textContent)).indexOf(ap5.a.no) >= 0);

  console.log('\n[4] เงินมัดจำรับมีภาษี → หักในใบกำกับใบสุดท้ายผ่านแบบฟอร์มออกใบกำกับ');
  await go('deposits');
  await page.click('#main [data-act="settle:new:deposit"]');
  await modalOpen();
  await page.selectOption('[name="depPartner"]', CUS2);
  await page.fill('[name="base"]', '10000');
  await page.fill('[name="desc"]', 'มัดจำงานติดตั้งระบบ 1/3');
  await page.selectOption('[name="wht"]', 'WHT_SERVICE');
  const dsum = await page.$eval('#depSum', (e) => e.textContent);
  T.ok('สรุป: ภาษีขาย 700 ลูกค้าหัก 300 เงินเข้า 10,400', dsum.indexOf('700.00') >= 0 && dsum.indexOf('10,400.00') >= 0, dsum);
  await submit();
  const dep = await page.evaluate(() => DB.docs.customerDeposit[0]);
  T.ok('★ ออกใบรับเงินมัดจำพร้อมภาษีขาย 700 เข้ารายงานภาษีขายเดือนที่รับ', dep.vat === M(700)
    && await page.evaluate((no) => DB.taxTx.some((t) => t.srcDoc === 'customerDeposit|' + no && t.tax === 7000000), dep.no));
  await page.click('#main [data-act="printdoc:customerDeposit:' + dep.no + '"]');
  await page.waitForTimeout(300);
  T.ok('พิมพ์ใบกำกับภาษี/ใบรับเงินมัดจำได้', await page.evaluate(() => document.getElementById('printArea').textContent.indexOf('เงินมัดจำ') >= 0));
  await page.evaluate(() => closePrint());
  await go('invoices');
  await page.click('#main [data-act="new:invoice"]');
  await modalOpen();
  await page.selectOption('#modal [name="partner"]', CUS2);
  await page.waitForTimeout(100);
  T.ok('★ เลือกลูกค้าที่มีเงินมัดจำ ฟอร์มออกใบกำกับแสดงเงินมัดจำให้ติ๊กหัก', !!(await page.$('#invDeps [name="depPick"]')));
  await page.fill('[name="l0_desc"]', 'งานติดตั้งระบบ ส่งมอบงวดสุดท้าย');
  await page.fill('[name="l0_qty"]', '1');
  await page.fill('[name="l0_price"]', '30000');
  await page.check('#invDeps [name="depPick"]');
  await submit();
  const fin = await page.evaluate(() => DB.docs.invoice[0]);
  T.ok('★ ใบกำกับใบสุดท้าย: มูลค่า 20,000 ภาษี 1,400 รวม 21,400 (ภาษีไม่ซ้ำกับมัดจำ)', fin.base === M(20000) && fin.vat === M(1400) && fin.total === M(21400),
    (fin.base / 1e4) + ' / ' + (fin.vat / 1e4));
  await page.click('#main [data-act="printdoc:invoice:' + fin.no + '"]');
  await page.waitForTimeout(300);
  T.ok('ใบกำกับที่พิมพ์แสดงบรรทัดหักเงินมัดจำ', await page.evaluate(() => document.getElementById('printArea').textContent.indexOf('หัก เงินมัดจำ') >= 0));
  await page.evaluate(() => closePrint());

  console.log('\n[5] ตั้งหนี้หลายบรรทัด เพิ่มบรรทัดได้ หัก ณ ที่จ่ายตามทะเบียนผู้ขาย');
  await go('bills');
  await page.click('#main [data-act="new:bill"]');
  await modalOpen();
  await page.selectOption('#modal [name="partner"]', VEN);
  T.ok('★ เลือกผู้ขายแล้วเติมประเภทหัก ณ ที่จ่ายจากทะเบียน', (await page.$eval('[name="wht"]', (e) => e.value)) === 'WHT_SERVICE');
  await page.fill('[name="vendorNo"]', 'SV-UI-001');
  await page.fill('[name="b0_desc"]', 'ค่าแรงซ่อมเครื่องจักร');
  await page.selectOption('[name="b0_acc"]', '5325');
  await page.fill('[name="b0_price"]', '4000');
  await page.fill('[name="b1_desc"]', 'ค่าอะไหล่');
  await page.selectOption('[name="b1_acc"]', '5325');
  await page.fill('[name="b1_qty"]', '2');
  await page.fill('[name="b1_price"]', '3000');
  await page.fill('[name="b2_desc"]', 'ค่าเดินทางที่จ่ายแทน');
  await page.fill('[name="b2_price"]', '400');
  await page.selectOption('[name="b2_tax"]', 'EXEMPT');
  await page.click('#modal [data-act="settle:addrow:bill"]');
  T.ok('★ กดเพิ่มบรรทัดได้ ข้อมูลที่กรอกไว้ไม่หาย', !!(await page.$('[name="b3_desc"]')) && (await page.$eval('[name="b1_price"]', (e) => e.value)) === '3000');
  await page.fill('[name="b3_desc"]', 'ค่าขนส่งอะไหล่');
  await page.fill('[name="b3_price"]', '100');
  await page.selectOption('[name="b3_tax"]', 'EXEMPT');
  T.ok('สรุปยอดคิดทุกบรรทัด', (await page.$eval('#billSum', (e) => e.textContent)).indexOf('4 บรรทัด') >= 0);
  await submit();
  const bill = await page.evaluate(() => DB.docs.bill[0]);
  T.ok('★ ใบกำกับเดียว 4 บรรทัด ภาษีเฉพาะบรรทัด VAT 7% = 700', bill.lines.length === 4 && bill.vat === M(700) && bill.total === M(11200)
    && bill.whtCode === 'WHT_SERVICE', bill.no);

  console.log('\n[6] จ่ายชำระ: ระบุฐานภาษีเอง · เลือกไม่หักได้จริง · ส่วนลดและค่าโอน');
  await page.click('#main [data-act="paybill:' + bill.no + '"]');
  await modalOpen();
  T.ok('ฟอร์มจ่ายตั้งค่าหัก ณ ที่จ่ายตามรายการตั้งหนี้', (await page.$eval('[name="wht"]', (e) => e.value)) === 'WHT_SERVICE');
  await page.fill('[name="whtBase"]', '4000');
  T.ok('สรุปยอดคิดหัก ณ ที่จ่ายจากฐาน 4,000 = 120', (await page.$eval('#pvSum', (e) => e.textContent)).indexOf('120.00') >= 0);
  await submit();
  const pv = await page.evaluate(() => DB.docs.payment[0]);
  const cert = await page.evaluate((no) => DB.docs.whtCert.find((c) => c.no === no), pv.certNo);
  T.ok('★ หักเฉพาะค่าแรง 4,000 → 120 บาท และ 50 ทวิ ฐาน 4,000', pv.wht === M(120) && cert && cert.base === M(4000));
  const b2 = await page.evaluate(() => recordBill({ partnerCode:'VEN-0001', date:'2026-06-15', vendorNo:'SV-UI-002',
    lines:[{ desc:'ค่าบริการ', qty:1, price:'5000', acc:'5325' }] }).no);
  await go('bills', b2);
  await page.click('#main [data-act="paybill:' + b2 + '"]');
  await modalOpen();
  await page.selectOption('[name="wht"]', 'none');
  await page.fill('[name="amount"]', '5300');
  await page.selectOption('[name="diffType"]', 'discount');
  await page.fill('[name="fee"]', '25');
  await submit();
  const pv2 = await page.evaluate(() => DB.docs.payment[0]);
  const b2d = await page.evaluate((no) => DB.docs.bill.find((d) => d.no === no), b2);
  T.ok('★ เลือก "ไม่หักภาษี ณ ที่จ่าย" แล้วไม่ถูกหักและไม่ออก 50 ทวิ', pv2.wht === 0 && !pv2.certNo);
  T.ok('★ จ่ายขาด 50 ปิดเป็นส่วนลดรับ รายการตั้งหนี้จ่ายครบ ค่าโอน 25 ลงค่าธรรมเนียม', pv2.diff === M(50) && b2d.status === 'paid'
    && (await line(pv2.entryNo, '5112')) === -M(50) && (await line(pv2.entryNo, '5410')) === M(25));

  console.log('\n[7] ตั้งหนี้ค้างจากเดือนก่อน ยังเห็นได้ด้วยตัวกรอง "ค้างชำระทุกเดือน"');
  await page.evaluate(() => recordBill({ partnerCode:'VEN-0001', date:'2026-06-20', vendorNo:'SV-UI-OPEN', whtCode: null,
    lines:[{ desc:'ค่าบริการเดือนมิถุนายน', qty:1, price:'2000', acc:'5325' }] }));
  await go('bills', null, '2026-07');
  T.ok('เดือนกรกฎาคมไม่มีรายการตั้งหนี้ของเดือนนี้', (await page.$$eval('#main tbody tr', (r) => r.length)) <= 1);
  const badge = await page.$eval('#main [data-act="chip:bills:allopen"] .chip-n', (e) => e.textContent);
  await page.click('#main [data-act="chip:bills:allopen"]');
  const openRows = await page.$$eval('#main tbody tr', (r) => r.map((x) => x.textContent));
  T.ok('★ กด "ค้างชำระทุกเดือน" เห็นรายการตั้งหนี้ค้างจากเดือนมิถุนายน และจำนวนบนป้ายตรง', openRows.some((t) => t.indexOf('SV-UI-OPEN') >= 0)
    && String(openRows.length) === badge, badge + ' รายการ');
  await page.evaluate(() => { STATE.chip.bills = 'all'; STATE.period = '2026-06'; render(); });

  console.log('\n[8] ใบลดหนี้จากผู้ขาย — ส่งคืนสินค้า สต๊อกออก ภาษีซื้อติดลบในเดือนที่ได้รับ');
  const gb = await page.evaluate(() => {
    const b = recordBill({ partnerCode:'VEN-0001', date:'2026-06-11', vendorNo:'GD-UI-1', lines:[{ desc:'ซื้อสินค้า A', qty:10, price:'100', acc:'1154', itemCode:'IT-0001' }] });
    issueInvoice({ partnerCode:'CUS-0001', date:'2026-06-20', lines:[{ desc:'ขายสินค้า A', qty:3, price:'200', itemCode:'IT-0001', taxCode:'VAT7' }] });
    save(); return b.no;
  });
  await go('bills', gb, '2026-07');
  await page.click('#main [data-act="settle:vcn:' + gb + '"]');
  await modalOpen();
  await page.fill('[name="vendorCnNo"]', 'GD-CN-UI-1');
  await page.fill('[name="date"]', '2026-07-15');
  await page.fill('[name="vr0"]', '8');
  await page.click('#modal [data-act="modal:submit"]');
  await page.waitForTimeout(250);
  T.ok('ส่งคืนเกินของที่มีในคลังไม่ได้', await errToast());
  await page.fill('[name="vr0"]', '5');
  T.ok('สรุปยอด: ของคืนตามราคาซื้อ 500 ภาษี 35', (await page.$eval('#vcnSum', (e) => e.textContent)).indexOf('35.00') >= 0);
  await submit();
  const vcn = await page.evaluate(() => ({ c: DB.docs.vendorCreditNote[0], qty: DB.items.find((i) => i.code === 'IT-0001').qty,
    row: DB.taxTx.find((t) => t.srcDoc === 'vendorCreditNote|' + DB.docs.vendorCreditNote[0].no), screen: STATE.screen }));
  T.ok('★ บันทึกใบลดหนี้จากผู้ขาย สินค้าเหลือ 2 ภาษีซื้อติดลบ 35 ในเดือนกรกฎาคม', vcn.qty === 2 && vcn.row.tax === -M(35) && vcn.row.period === '2026-07'
    && vcn.screen === 'vendorcns', vcn.c.no);
  await page.click('#main [data-act="void:vendorCreditNote:' + vcn.c.no + '"]');
  await modalOpen();
  await page.fill('[name="reason"]', 'ผู้ขายยกเลิกใบลดหนี้ ทดสอบ');
  await submit();
  T.ok('★ ยกเลิกใบลดหนี้จากผู้ขายผ่านปุ่ม สินค้ากลับเข้าคลัง', await page.evaluate(() => DB.items.find((i) => i.code === 'IT-0001').qty === 7));

  console.log('\n[9] ตัดหนี้สูญที่หน้าใบกำกับ แล้วยกเลิกที่หน้าหักกลบ · ตัดหนี้สูญ');
  const i9 = await inv('2026-06-25', '2000');
  await go('invoices', i9, '2026-06');
  await page.click('#main [data-act="settle:baddebt:' + i9 + '"]');
  await modalOpen();
  await page.fill('[name="reason"]', 'ลูกหนี้ปิดกิจการ ทวงถามแล้ว');
  await submit();
  const wo = await page.evaluate((no) => ({ inv: DB.docs.invoice.find((d) => d.no === no), w: DB.docs.badDebt[0] }), i9);
  T.ok('★ ใบกำกับขึ้นว่าตัดหนี้สูญ Dr หนี้สูญ 2,140', wo.inv.status === 'written_off' && (await line(wo.w.entryNo, '5351')) === M(2140));
  T.ok('หน้าใบกำกับแสดงป้ายตัดหนี้สูญ', (await page.$eval('#main', (e) => e.textContent)).indexOf('ตัดหนี้สูญ') >= 0);
  await page.click('#main [data-act="open:offsets:' + wo.w.no + '"]');
  await page.waitForTimeout(150);
  await page.click('#main [data-act="void:badDebt:' + wo.w.no + '"]');
  await modalOpen();
  await page.fill('[name="reason"]', 'ลูกหนี้กลับมาชำระ ทดสอบ');
  await submit();
  T.ok('ยกเลิกตัดหนี้สูญ ใบกำกับกลับมาค้างรับ', await page.evaluate((no) => invOutstanding(DB.docs.invoice.find((d) => d.no === no)) === 21400000, i9));

  console.log('\n[10] เงินมัดจำจ่าย (ไม่มีใบกำกับ) หักกลบกับรายการตั้งหนี้ที่หน้ารายการตั้งหนี้');
  await go('vdeposits', null, '2026-06');
  await page.click('#main [data-act="settle:new:vdeposit"]');
  await modalOpen();
  T.ok('ฟอร์มจ่ายมัดจำเติมหัก ณ ที่จ่ายจากทะเบียนผู้ขาย', (await page.$eval('[name="wht"]', (e) => e.value)) === 'WHT_SERVICE');
  await page.fill('[name="base"]', '10000');
  await page.fill('[name="desc"]', 'มัดจำงานปรับปรุงสำนักงาน');
  await submit();
  const vd = await page.evaluate(() => DB.docs.vendorDeposit[0]);
  T.ok('★ จ่ายมัดจำ 10,000 หัก 3% ออก 50 ทวิ', vd.wht === M(300) && !!vd.certNo);
  const b10 = await page.evaluate(() => recordBill({ partnerCode:'VEN-0001', date:'2026-06-28', vendorNo:'SV-UI-FIN',
    lines:[{ desc:'งานปรับปรุงสำนักงาน', qty:1, price:'30000', acc:'5325' }] }).no);
  await go('bills', b10);
  await page.click('#main [data-act="settle:apply:ap:tgt:' + b10 + '"]');
  await modalOpen();
  await submit();
  const b10d = await page.evaluate((no) => billOutstanding(DB.docs.bill.find((d) => d.no === no)), b10);
  T.ok('★ หักกลบเงินมัดจำจ่าย ยอดค้างเหลือ 22,100', b10d === M(22100));

  console.log('\n[11] ค่าใช้จ่าย: เพิ่มบรรทัด · ระบุฐานภาษีหัก ณ ที่จ่าย');
  await go('expenses');
  await page.click('#main [data-act="new:expense"]');
  await modalOpen();
  await page.click('#modal [data-act="settle:addrow:exp"]');
  T.ok('★ ฟอร์มค่าใช้จ่ายเพิ่มบรรทัดที่ 4 ได้', !!(await page.$('[name="e3_desc"]')));
  await page.selectOption('[name="wht"]', 'WHT_SERVICE');
  await page.fill('[name="taxInvoiceNo"]', 'SV-EX-UI');
  for (const [i, d, a, p] of [[0, 'ค่าบริการ', '5325', '4000'], [3, 'ค่าอะไหล่', '5325', '6000']]) {
    await page.fill('[name="e' + i + '_desc"]', d); await page.selectOption('[name="e' + i + '_acc"]', a); await page.fill('[name="e' + i + '_price"]', p);
  }
  await page.fill('[name="whtBase"]', '4000');
  T.ok('สรุปยอดหัก ณ ที่จ่าย 120 จากฐาน 4,000', (await page.$eval('#expSum', (e) => e.textContent)).indexOf('120.00') >= 0);
  await submit();
  const ex = await page.evaluate(() => DB.docs.expense[0]);
  T.ok('★ ค่าใช้จ่าย 2 บรรทัด (บรรทัดที่เพิ่มด้วย) หัก ณ ที่จ่าย 120', ex.lines.length === 2 && ex.wht === M(120) && ex.whtBase === M(4000));

  console.log('\n[12] รับชำระหลายใบกำกับในครั้งเดียว');
  const a1 = await inv('2026-06-26', '1000', CUS2), a2 = await inv('2026-06-26', '2000', CUS2);
  await page.click('#newBtn');
  await page.click('#pop [data-act="popgo:settle:new:receivemany"]');
  await modalOpen();
  await page.selectOption('[name="rmPartner"]', CUS2);
  await page.waitForTimeout(100);
  const boxes = await page.$$eval('[name="rmInv"]', (e) => e.map((x) => x.value));
  T.ok('เลือกลูกค้าแล้วแสดงใบกำกับที่ค้างทั้งหมดของลูกค้า', boxes.indexOf(a1) >= 0 && boxes.indexOf(a2) >= 0, boxes.join(','));
  await submit();
  const many = await page.evaluate((nos) => nos.map((no) => invOutstanding(DB.docs.invoice.find((d) => d.no === no))), [a1, a2]);
  T.ok('★ ออกใบเสร็จครบทุกใบในครั้งเดียว ใบกำกับรับครบ', many.every((x) => x === 0));

  console.log('\n[12.1] เงินมัดจำที่ยกมาจากระบบเดิม (มีในบัญชีแต่ไม่มีรายใบ) ตั้งเป็นรายใบแล้วใช้หักได้');
  await page.evaluate(() => { post({ type:'general', date:'2026-06-01', desc:'ยอดยกมาเงินมัดจำรับ', lines:[{ acc:'1113', dr: 50000000 }, { acc:'2161', cr: 50000000 }] }); save(); });
  await go('deposits', null, '2026-06');
  T.ok('หน้าเงินมัดจำรับเตือนยอดในบัญชีที่ยังไม่มีรายใบ', (await page.$eval('#main', (e) => e.textContent)).indexOf('ยังไม่มีเอกสารรายใบ') >= 0);
  await page.click('#main [data-act="settle:new:depbf:ar"]');
  await modalOpen();
  await page.selectOption('[name="bfPartner"]', CUS);
  T.ok('ฟอร์มเติมยอดที่ยังไม่มีรายใบให้', (await page.$eval('[name="base"]', (e) => e.value)) === '5,000.00');
  const n0 = await page.evaluate(() => DB.entries.length);
  await submit();
  const bf = await page.evaluate(() => DB.docs.customerDeposit[0]);
  T.ok('★ ตั้งเงินมัดจำยกมาเป็นรายใบ ไม่ลงบัญชีซ้ำ', bf.broughtForward && bf.base === M(5000)
    && (await page.evaluate(() => DB.entries.length)) === n0 && (await page.evaluate(() => depositUnallocated('ar'))) === 0);

  console.log('\n[13] ทุกหน้าใหม่เปิดได้ และยอดคุมผ่าน');
  for (const s of ['deposits', 'vdeposits', 'vendorcns', 'offsets']) {
    await go(s);
    const h = await page.$eval('#main', (e) => e.innerHTML);
    T.ok('หน้า ' + s, h.indexOf('เปิดหน้านี้ไม่ได้') < 0 && h.length > 300);
  }
  const navOk = await page.evaluate(() => ['deposits', 'vdeposits', 'vendorcns', 'offsets'].every((s) => navScreens().indexOf(s) >= 0));
  T.ok('หน้าใหม่อยู่ในเมนูหลัก', navOk);
  const r6 = await recon('2026-06-30'), r7 = await recon('2026-07-31');
  T.ok('★ ยอดคุมผ่านทุกข้อ (ลูกหนี้ เจ้าหนี้ ภาษีขาย ภาษีซื้อ สินค้า)', r6 === '' && r7 === '', r6 + ' | ' + r7);
  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
