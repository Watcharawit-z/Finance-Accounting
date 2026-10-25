/* ทดสอบหน้าเว็บฝั่งซื้อแบบที่นักบัญชีคุ้นมือ — ป้ายสถานะเป็นเมนู · ใบสั่งซื้อ → ค่าใช้จ่าย/ตั้งหนี้ · ฟอร์มตั้งหนี้และค่าใช้จ่ายแบบเอกสารธุรกิจ
   · จ่ายภายหลัง → หน้าต่างบันทึกการชำระเงิน (เช็ค ค่าธรรมเนียม หัก ณ ที่จ่ายแบบกรอกจำนวน) · ใบรับสินค้า → ตั้งหนี้ · แบบฟอร์มพิมพ์
   รันหลัง node build.js: node uitest-fa-purchase.js */
const T = require('./uitestlib');

const tid = (p12) => { let sum = 0; for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i); return p12 + ((11 - (sum % 11)) % 10); };

(async () => {
  const { page } = await T.open();
  await T.blank(page, '2026-06');
  /* ทะเบียนตั้งต้น (ไม่ใช่สิ่งที่ทดสอบ) — ผู้ขายนิติบุคคล ช่างบุคคลธรรมดา สินค้า 3 ชนิด */
  await page.evaluate((ids) => {
    post({ type:'general', date:'2026-06-01', desc:'ทุนเริ่มต้น', lines:[{ acc:'1113', dr: M('300000') }, { acc:'1112', dr: M('5000') }, { acc:'3120', cr: M('305000') }] });
    savePartner({ kind:'vendor', name:'บริษัท ผู้ขายครบวงจร จำกัด', taxId: ids[0], branch:'00000', address:'9 ถนนพระราม 4 กรุงเทพฯ', termDays: 30, whtCode:'WHT_SERVICE' });
    savePartner({ kind:'vendor', name:'นายช่าง ซ่อมดี', entityType:'individual', taxId: ids[1], address:'5 ซอยลาดพร้าว กรุงเทพฯ', termDays: 7, whtCode:'WHT_SERVICE' });
    saveItem({ name:'สินค้า ก', type:'stock', uom:'ชิ้น', price:'100' });
    saveItem({ name:'กระดาษ A4', type:'nonstock', uom:'รีม', price:'150', buyPrice:'120', expenseAcc:'5324' });
    saveItem({ name:'ค่าซ่อมบำรุง', type:'service', uom:'งาน', price:'0', buyPrice:'3000', expenseAcc:'5325' });
    save(); render();
  }, [tid('010555867890'), tid('310050012345')]);
  const VEN = 'VEN-0001', TECH = 'VEN-0002', STOCK = 'IT-0001', PAPER = 'IT-0002', REPAIR = 'IT-0003';
  const M = (s) => Math.round(Number(s) * 10000);
  const modalOpen = () => page.waitForSelector('#modal.show');
  const submit = async () => { await page.click('#modal [data-act="modal:submit"]'); await T.closed(page); };
  const go = (screen, sel) => page.evaluate((a) => { STATE.period = '2026-06'; STATE.screen = a.s; STATE.sel = a.sel || null; STATE.filter = ''; render(); },
    { s: screen, sel });
  const menu = async (kind, no) => {
    await page.click('#main [data-act="stmenu:' + kind + ':' + no + '"]');
    await page.waitForSelector('#rowMenu.show');
    return page.$$eval('#rowMenu .rm-i', (els) => els.map((e) => ({ act: e.getAttribute('data-act').replace(/^rowgo:/, ''), t: e.textContent, danger: e.classList.contains('danger') })));
  };
  const pick = (act) => page.click('#rowMenu [data-act="rowgo:' + act + '"]');
  const tot = (id) => page.$eval('#' + id, (e) => e.textContent);
  const recon = () => page.evaluate(() => { const r = reconciliationChecks('2026-06-30'); return r.allPassed ? '' : r.checks.filter((c) => !c.ok).map((c) => c.code).join(','); });

  console.log('\n[1] ใบสั่งซื้อ: ป้ายสถานะเป็นเมนูตามลำดับงาน');
  const po = await page.evaluate((a) => issueTradeDoc('purchaseOrder', { partnerCode: a.v, date:'2026-06-10',
    lines:[{ desc:'กระดาษ A4', qty:20, price:'120', itemCode: a.p, uom:'รีม' }, { desc:'ค่าซ่อมเครื่องถ่ายเอกสาร', qty:1, price:'3000', itemCode: a.r, disc:'500' }],
    pricing:{ lineDisc:'amount', bill:{ kind:'percent', value:'5' } }, project:'สำนักงานใหญ่', note:'ส่งของก่อนเที่ยง', internalNote:'ผู้ขายประจำ',
    whtCode:'WHT_SERVICE' }).no, { v: VEN, p: PAPER, r: REPAIR });
  await go('purchaseorders');
  T.ok('รายการใบสั่งซื้อมีป้ายสถานะที่กดได้ ชื่อสถานะ "รออนุมัติ"', (await page.$eval('#main [data-act="stmenu:purchaseOrder:' + po + '"]', (e) => e.textContent)).indexOf('รออนุมัติ') >= 0);
  let items = await menu('purchaseOrder', po);
  T.ok('★ รออนุมัติ: เมนูขึ้นต้นด้วยอนุมัติ ยกเลิกอยู่ท้ายกลุ่มเป็นสีอันตราย', items[0].act === 'trade:purchaseOrder:approved:' + po
    && items.some((i) => i.act === 'trade:purchaseOrder:edit:' + po) && items.find((i) => i.act === 'trade:purchaseOrder:cancelled:' + po).danger
    && !items.some((i) => /convert|po:expense|grn:po/.test(i.act)), items.map((i) => i.t).join(' | '));
  await pick('trade:purchaseOrder:approved:' + po);
  await page.waitForTimeout(150);
  T.ok('อนุมัติจากเมนูแล้วป้ายเปลี่ยนเป็น "อนุมัติ"', (await page.$eval('#main [data-act="stmenu:purchaseOrder:' + po + '"]', (e) => e.textContent)).indexOf('อนุมัติ') === 0);
  items = await menu('purchaseOrder', po);
  const acts = items.map((i) => i.act);
  T.ok('★ อนุมัติแล้ว: ตั้งหนี้ / สร้างค่าใช้จ่าย (ไม่มีสินค้านับสต๊อก จึงไม่มีใบรับสินค้า) แล้วยกเลิก',
    acts.indexOf('trade:purchaseOrder:convert:' + po) === 0 && acts.indexOf('po:expense:' + po) === 1 && acts.indexOf('grn:po:' + po) < 0
    && items[2].danger, items.map((i) => i.t).join(' | '));

  console.log('\n[2] ใบสั่งซื้อ → ค่าใช้จ่าย: เติมรายการ ราคา ส่วนลด หัวเอกสาร ครบ');
  await pick('po:expense:' + po);
  await modalOpen();
  const pre = await page.evaluate(() => ({ d0: val('l0_desc'), a0: val('l0_acc'), a1: val('l1_acc'), disc1: val('l1_disc'), kind: val('discKind'),
    bill: val('billDisc'), proj: val('project'), ref: val('reference'), note: val('note'), inote: val('internalNote'), wht: val('wht'),
    mode: document.getElementById('lnTable').getAttribute('data-mode'), pnd: document.getElementById('whtPnd').textContent }));
  T.ok('★ ฟอร์มค่าใช้จ่ายได้รายการ หมวดค่าใช้จ่าย ส่วนลด และหัวเอกสารจากใบสั่งซื้อ', pre.d0 === 'กระดาษ A4' && pre.a0 === '5324' && pre.a1 === '5325'
    && pre.disc1 === '500' && pre.kind === 'amount' && pre.bill === '5' && pre.proj === 'สำนักงานใหญ่' && pre.ref === po && pre.note === 'ส่งของก่อนเที่ยง'
    && pre.inote === 'ผู้ขายประจำ' && pre.mode === 'expense', JSON.stringify(pre));
  T.ok('ช่องหัก ณ ที่จ่ายบอกแบบ ภ.ง.ด. ของผู้รับเงิน (นิติบุคคล → ภ.ง.ด.53)', pre.wht === 'WHT_SERVICE' && pre.pnd.indexOf('ภ.ง.ด.53') >= 0, pre.pnd);
  /* 2,400 + 2,500 = 4,900 − 5% = 4,655 · ภาษี 325.85 · รวม 4,980.85 · หัก 3% 139.65 · จ่าย 4,841.20 */
  T.ok('★ ยอดท้ายเอกสาร: รวม 4,980.85 หัก ณ ที่จ่าย 139.65 ยอดชำระ 4,841.20', (await tot('tTotal')) === '4,980.85'
    && (await tot('tWht')).indexOf('139.65') === 0 && (await tot('tNet')) === '4,841.20', (await tot('tTotal')) + ' / ' + (await tot('tWht')));
  await page.fill('[name="taxInvoiceNo"]', 'EX-UI-001');
  await page.selectOption('[name="method"]', 'cheque');
  T.ok('เลือกจ่ายด้วยเช็คแล้วช่องเลขที่/วันที่เช็คขึ้น', await page.$eval('#modal .cheque-f', (e) => !e.hidden));
  await page.fill('[name="chequeNo"]', 'CQ-0001');
  await submit();
  const ex = await page.evaluate((no) => { const e = DB.docs.expense[0]; const p = DB.docs.purchaseOrder.find((x) => x.no === no);
    return { no: e.no, base: e.base, wht: e.wht, from: e.fromDoc, cheque: e.chequeNo, method: e.method, cert: !!e.certNo, st: p.status, to: p.convertedTo,
      screen: STATE.screen, inote: e.internalNote }; }, po);
  T.ok('★ บันทึกค่าใช้จ่ายแล้ว ใบสั่งซื้อดำเนินการแล้ว ลิงก์สองทาง ออก 50 ทวิ ให้', ex.base === M('4655') && ex.wht === M('139.65') && ex.from === po
    && ex.st === 'closed' && ex.to === ex.no && ex.cert && ex.cheque === 'CQ-0001' && ex.method === 'cheque' && ex.screen === 'expenses', JSON.stringify(ex));
  T.ok('หน้ารายละเอียดค่าใช้จ่ายแสดงโปรเจกต์ และโน้ตภายในระบุว่าไม่พิมพ์', await page.evaluate(() => {
    const t = document.getElementById('main').textContent; return t.indexOf('สำนักงานใหญ่') >= 0 && t.indexOf('โน้ตภายใน — ไม่พิมพ์') >= 0 && t.indexOf('ผู้ขายประจำ') >= 0; }));
  await page.click('#main [data-act="printdoc:expense:' + ex.no + '"]');
  await page.waitForTimeout(300);
  const pr = await page.evaluate(() => { const a = document.getElementById('printArea'); return { t: a.textContent,
    heads: [...a.querySelectorAll('.p-items th')].map((x) => x.textContent) }; });
  T.ok('★ ใบสำคัญจ่ายพิมพ์คอลัมน์หน่วยและส่วนลด ยอดหลังหักส่วนลด หมายเหตุ เลขเช็ค แต่ไม่พิมพ์โน้ตภายใน', pr.heads.indexOf('หน่วย') >= 0 && pr.heads.indexOf('ส่วนลด') >= 0
    && pr.t.indexOf('ราคาหลังหักส่วนลด') >= 0 && pr.t.indexOf('ส่งของก่อนเที่ยง') >= 0 && pr.t.indexOf('CQ-0001') >= 0 && pr.t.indexOf('ผู้ขายประจำ') < 0, pr.heads.join(','));
  await page.evaluate(() => closePrint());
  await go('purchaseorders');
  T.ok('ใบสั่งซื้อขึ้นสถานะ "ดำเนินการแล้ว" และเมนูพาไปค่าใช้จ่ายได้', (await page.$eval('#main [data-act="stmenu:purchaseOrder:' + po + '"]', (e) => e.textContent)).indexOf('ดำเนินการแล้ว') >= 0
    && (await menu('purchaseOrder', po)).some((i) => i.act === 'open:expenses:' + ex.no));
  await page.keyboard.press('Escape');

  console.log('\n[3] ฟอร์มตั้งหนี้แบบเอกสารธุรกิจ: หัวเอกสาร ส่วนลด วันที่ใบกำกับ แก้ข้อมูลผู้ขายบนใบ');
  await go('bills');
  await page.click('#main [data-act="new:bill"]');
  await modalOpen();
  await page.selectOption('#modal [name="partner"]', VEN);
  T.ok('ฟอร์มตั้งหนี้มีหัวเอกสารครบ (เงื่อนไขชำระ เครดิตตามทะเบียน 30 วัน โปรเจกต์ เลขอ้างอิง หมายเหตุ โน้ตภายใน)', await page.evaluate(() =>
    ['creditType', 'creditDays', 'dueDate', 'project', 'salesName', 'reference', 'note', 'internalNote', 'vendorNo', 'vendorDate', 'claim', 'wht']
      .every((n) => !!document.querySelector('#modal [name="' + n + '"]')) && val('creditDays') === '30' && val('wht') === 'WHT_SERVICE'));
  await page.fill('#modal [name="date"]', '2026-06-20');
  await page.dispatchEvent('#modal [name="date"]', 'change');
  T.ok('★ วันที่ในใบกำกับตามวันที่เอกสารจนกว่าจะแก้เอง', (await page.$eval('[name="vendorDate"]', (e) => e.value)) === '2026-06-20');
  await page.fill('[name="vendorDate"]', '2026-06-18');
  await page.dispatchEvent('[name="vendorDate"]', 'change');
  await page.fill('[name="vendorNo"]', 'IV-UI-0099');
  await page.selectOption('[name="l0_item"]', STOCK);
  await page.fill('[name="l0_qty"]', '10');
  await page.fill('[name="l0_price"]', '60');
  await page.fill('[name="l0_disc"]', '10');
  await page.fill('[name="l1_desc"]', 'ค่าขนส่ง');
  await page.fill('[name="l1_price"]', '500');
  await page.selectOption('[name="l1_acc"]', '5230');
  await page.selectOption('[name="wht"]', '');
  T.ok('เลือกสินค้านับสต๊อกแล้วบัญชีเป็นสินค้าคงเหลือ', (await page.$eval('[name="l0_acc"]', (e) => e.value)) === '1154');
  /* 600 −10% = 540 + 500 = 1,040 · ภาษี 72.80 · รวม 1,112.80 */
  T.ok('★ ยอดท้ายเอกสารคิดส่วนลดรายการ: รวมทั้งสิ้น 1,112.80', (await tot('tTotal')) === '1,112.80', await tot('tTotal'));
  await page.fill('[name="project"]', 'คลังสาขา 2');
  await page.fill('[name="internalNote"]', 'ตรวจนับแล้ว ห้ามพิมพ์');
  await page.fill('[name="note"]', 'ชำระภายในกำหนด');
  await page.click('#contactBox summary');
  await page.fill('[name="cBranch"]', '00002');
  await submit();
  const bill = await page.evaluate(() => { const b = DB.docs.bill[0]; const tx = DB.taxTx.find((t) => t.entryNo === b.entryNo);
    return { no: b.no, total: b.total, vd: b.vendorDate, proj: b.project, inote: b.internalNote, br: b.snap.branch, txBr: tx.branch, txDate: tx.invDate,
      cost: DB.items.find((i) => i.code === 'IT-0001').value, due: b.due }; });
  T.ok('★ ตั้งหนี้แล้ว: ยอด วันที่ใบกำกับ โปรเจกต์ โน้ตภายใน สาขาบนใบ เข้ารายงานภาษีซื้อตามใบ', bill.total === M('1112.8') && bill.vd === '2026-06-18'
    && bill.proj === 'คลังสาขา 2' && bill.inote === 'ตรวจนับแล้ว ห้ามพิมพ์' && bill.br === '00002' && bill.txBr === '00002' && bill.txDate === '2026-06-18'
    && bill.cost === M('540') && bill.due === '2026-07-20', JSON.stringify(bill));
  /* บริษัทเปล่าใช้วันที่จริงของเครื่อง — ครบกำหนด ก.ค. 2569 อาจผ่านมาแล้ว ป้ายจึงเป็นได้ทั้งรอชำระและเลยกำหนดจ่าย */
  const billSt = await page.$eval('#main [data-act="stmenu:bill:' + bill.no + '"]', (e) => e.textContent);
  T.ok('หน้ารายการตั้งหนี้ขึ้นสถานะ "รอชำระ" (หรือ "เลยกำหนดจ่าย" เมื่อพ้นวันครบกำหนด)', /รอชำระ|เลยกำหนดจ่าย/.test(billSt), billSt);
  await go('vatin');
  T.ok('รายงานภาษีซื้อแสดงวันที่ตามใบกำกับของผู้ขาย', (await page.$eval('#main', (e) => e.textContent)).indexOf('18/06/') >= 0);
  await go('bills', bill.no);
  await page.click('#main [data-act="printdoc:bill:' + bill.no + '"]');
  await page.waitForTimeout(300);
  const bp = await page.evaluate(() => document.getElementById('printArea').textContent);
  T.ok('★ พิมพ์ใบตั้งหนี้: เลขใบกำกับผู้ขาย เงื่อนไขชำระ โปรเจกต์ หมายเหตุ — ไม่มีโน้ตภายใน', bp.indexOf('IV-UI-0099') >= 0 && bp.indexOf('เครดิต 30 วัน') >= 0
    && bp.indexOf('คลังสาขา 2') >= 0 && bp.indexOf('ชำระภายในกำหนด') >= 0 && bp.indexOf('ห้ามพิมพ์') < 0);
  await page.evaluate(() => closePrint());

  console.log('\n[4] ค่าใช้จ่ายจ่ายภายหลัง → รอชำระ → บันทึกการชำระเงินจากเมนูสถานะ');
  await go('expenses');
  await page.click('#main [data-act="new:expense"]');
  await modalOpen();
  await page.selectOption('#modal [name="partner"]', TECH);
  T.ok('★ ผู้รับเงินบุคคลธรรมดา: บอกว่าเข้า ภ.ง.ด.3 และเติมประเภทเงินได้จากทะเบียน', (await page.$eval('#whtPnd', (e) => e.textContent)).indexOf('ภ.ง.ด.3') >= 0
    && (await page.$eval('[name="wht"]', (e) => e.value)) === 'WHT_SERVICE');
  await page.selectOption('[name="l0_item"]', REPAIR);
  T.ok('เลือกบริการแล้วเติมราคาซื้อและหมวดค่าใช้จ่ายจากทะเบียน', (await page.$eval('[name="l0_price"]', (e) => e.value)) === '3000'
    && (await page.$eval('[name="l0_acc"]', (e) => e.value)) === '5325');
  await page.selectOption('[name="l0_tax"]', 'EXEMPT');
  await page.selectOption('[name="payMode"]', 'later');
  const lay = await page.evaluate(() => ({ payFrom: document.querySelector('[name="payFrom"]').closest('.fld-w').hidden,
    due: document.querySelector('[name="payDue"]').closest('.fld-w').hidden, dueV: val('payDue'),
    btn: document.querySelector('#modal [data-act="modal:submit"]').textContent }));
  T.ok('★ เลือก "ยังไม่จ่าย": ซ่อนบัญชีที่จ่าย แสดงวันครบกำหนด (เครดิต 7 วัน) ปุ่มเป็นบันทึกรอชำระ', lay.payFrom && !lay.due && lay.dueV === '2026-07-07'
    && lay.btn.indexOf('รอชำระ') >= 0, JSON.stringify(lay));
  await submit();
  const later = await page.evaluate(() => { const b = DB.docs.bill[0]; return { no: b.no, later: b.expenseLater, total: b.total, st: b.status, wht: b.whtCode,
    screen: STATE.screen, certs: DB.docs.whtCert.length }; });
  T.ok('★ บันทึกเป็นตั้งหนี้รอชำระ ยังไม่หัก ณ ที่จ่าย ไปที่หน้าตั้งหนี้', later.later && later.total === M('3000') && later.st === 'issued'
    && later.wht === 'WHT_SERVICE' && later.screen === 'bills', JSON.stringify(later));
  items = await menu('bill', later.no);
  T.ok('เมนูสถานะของตั้งหนี้: บันทึกการชำระเงินเป็นข้อแรก ยกเลิกอยู่ท้ายกลุ่ม', items[0].act === 'paybill:' + later.no
    && items.filter((i) => !/^(open|printdoc|entry|copy):/.test(i.act)).pop().act === 'void:bill:' + later.no, items.map((i) => i.t).join(' | '));
  await pick('paybill:' + later.no);
  await modalOpen();
  T.ok('หน้าต่างชำระเงินมีวิธีจ่ายครบ 6 แบบ', (await page.$$eval('#modal [name="method"] option', (o) => o.map((x) => x.value).sort().join(','))) === 'card,cash,cheque,other,petty,transfer');
  await page.selectOption('[name="method"]', 'cheque');
  await page.fill('[name="chequeNo"]', 'KBANK-778899');
  await page.fill('[name="whtAmount"]', '85');
  await page.fill('[name="fee"]', '10');
  await page.fill('#modal [name="note"]', 'ค่าซ่อมหลังคา');
  const pv0 = await page.$eval('#pvSum', (e) => e.textContent);
  T.ok('สรุปยอดใช้ภาษีที่กรอกเอง 85 และเงินออกรวมค่าธรรมเนียม', pv0.indexOf('85.00') >= 0 && pv0.indexOf('2,925.00') >= 0, pv0);
  await submit();
  const pv = await page.evaluate((no) => { const p = DB.docs.payment[0]; const c = DB.docs.whtCert.find((x) => x.no === p.certNo);
    return { wht: p.wht, cq: p.chequeNo, m: p.method, note: p.note, form: c && c.form, st: DB.docs.bill.find((b) => b.no === no).status, fee: p.fee }; }, later.no);
  T.ok('★ จ่ายด้วยเช็ค หัก 85 ตามที่กรอก ออก 50 ทวิ ภ.ง.ด.3 ตั้งหนี้ชำระเงินแล้ว', pv.wht === M('85') && pv.cq === 'KBANK-778899' && pv.m === 'cheque'
    && pv.note === 'ค่าซ่อมหลังคา' && pv.form === 'ภ.ง.ด.3' && pv.st === 'paid' && pv.fee === M('10'), JSON.stringify(pv));
  const pvNo = await page.evaluate(() => DB.docs.payment[0].no);
  await go('payments', pvNo);
  await page.click('#main [data-act="printdoc:payment:' + pvNo + '"]');
  await page.waitForTimeout(300);
  const pp = await page.evaluate(() => document.getElementById('printArea').textContent);
  T.ok('ใบสำคัญจ่ายพิมพ์วิธีจ่าย เลขเช็ค ค่าธรรมเนียม และหมายเหตุ', pp.indexOf('KBANK-778899') >= 0 && pp.indexOf('ค่าธรรมเนียม') >= 0 && pp.indexOf('ค่าซ่อมหลังคา') >= 0);
  await page.evaluate(() => closePrint());

  console.log('\n[5] ค่าใช้จ่ายจ่ายทันทีจากเงินสดย่อย');
  await go('expenses');
  await page.click('#main [data-act="new:expense"]');
  await modalOpen();
  await page.selectOption('#modal [name="partner"]', VEN);
  await page.selectOption('[name="method"]', 'petty');
  T.ok('★ เลือกเงินสดย่อยแล้วบัญชีที่จ่ายเปลี่ยนเป็นเงินสดย่อย 1112', (await page.$eval('[name="payFrom"]', (e) => e.value)) === '1112');
  await page.fill('[name="l0_desc"]', 'ค่ากาแฟรับรองลูกค้า');
  await page.selectOption('[name="l0_acc"]', '5324');
  await page.fill('[name="l0_price"]', '321');
  await page.selectOption('[name="priceMode"]', 'inclusive');
  await page.selectOption('[name="claim"]', 'no');
  await page.selectOption('[name="wht"]', '');
  await submit();
  const pc = await page.evaluate(() => { const e = DB.docs.expense[0]; return { from: e.payFrom, total: e.total, vat: e.vat, claim: e.claimable, m: e.method }; });
  T.ok('จ่ายจากเงินสดย่อย ราคารวมภาษี 321 ภาษีซื้อต้องห้าม 21', pc.from === '1112' && pc.total === M('321') && pc.vat === M('21') && !pc.claim && pc.m === 'petty',
    JSON.stringify(pc));

  console.log('\n[6] ใบสั่งซื้อสินค้า → ใบรับสินค้า → ตั้งหนี้ จากเมนูสถานะ');
  const po2 = await page.evaluate((s) => { const d = issueTradeDoc('purchaseOrder', { partnerCode:'VEN-0001', date:'2026-06-12',
    lines:[{ desc:'สินค้า ก', qty:10, price:'64.20', itemCode: s, disc:'5' }], pricing:{ mode:'inclusive', bill:{ kind:'amount', value:'9.90' } },
    reference:'Q-55', project:'สต๊อกกลางปี' }); setTradeDocStatus('purchaseOrder', d.no, 'approved'); save(); return d.no; }, STOCK);
  await go('purchaseorders');
  items = await menu('purchaseOrder', po2);
  T.ok('ใบสั่งซื้อสินค้านับสต๊อกล้วน: สร้างใบรับสินค้าได้ แต่สร้างค่าใช้จ่ายไม่ได้', items[0].act === 'grn:po:' + po2 && !items.some((i) => /^po:expense/.test(i.act)));
  await pick('grn:po:' + po2);
  await modalOpen();
  await submit();
  const gr = await page.evaluate(() => { const g = DB.docs.goodsReceipt[0]; return { no: g.no, total: g.total, proj: g.project, ref: g.reference }; });
  T.ok('★ รับสินค้าจากใบสั่งซื้อราคารวมภาษีมีส่วนลด: ต้นทุนก่อนภาษีหลังส่วนลด 560.75', gr.total === M('560.75') && gr.proj === 'สต๊อกกลางปี' && gr.ref === 'Q-55',
    JSON.stringify(gr));
  await go('goodsreceipts');
  items = await menu('goodsReceipt', gr.no);
  T.ok('เมนูใบรับสินค้า: ตั้งหนี้จากใบรับสินค้าเป็นข้อแรก', items[0].act === 'grn:bill:' + gr.no);
  await pick('grn:bill:' + gr.no);
  await modalOpen();
  T.ok('ฟอร์มตั้งหนี้จากใบรับสินค้าใช้หัวเอกสารเดียวกัน ยกโปรเจกต์และเลขอ้างอิงมาให้', await page.evaluate(() => val('project') === 'สต๊อกกลางปี'
    && val('reference') === 'Q-55' && !!document.querySelector('#modal [name="gt0"]')));
  await page.fill('[name="vendorNo"]', 'GR-IV-UI');
  const gs = await page.$eval('#grbSum', (e) => e.textContent);
  T.ok('สรุปยอดตั้งหนี้: ภาษีซื้อ 39.25 ตั้งหนี้ 600.00', gs.indexOf('39.25') >= 0 && gs.indexOf('600.00') >= 0, gs);
  await submit();
  const gb = await page.evaluate((no) => { const b = DB.docs.bill[0]; return { grn: b.grnNo, total: b.total, st: DB.docs.goodsReceipt.find((g) => g.no === no).status }; }, gr.no);
  T.ok('★ ตั้งหนี้จากใบรับสินค้าแล้ว ยอดตรงใบสั่งซื้อ 600 ใบรับสินค้าดำเนินการแล้ว', gb.grn === gr.no && gb.total === M('600') && gb.st === 'closed', JSON.stringify(gb));

  console.log('\n[7] เตรียมจ่ายเงินและหัก ณ ที่จ่าย: ป้ายสถานะเป็นเมนู');
  const pb = await page.evaluate(() => { const b = createPaymentBatch({ date:'2026-06-25', billNos:[DB.docs.bill[0].no] }); save(); return b.no; });
  await go('paymentprep');
  items = await menu('paymentBatch', pb);
  T.ok('ใบเตรียมจ่ายรออนุมัติ: อนุมัติ แล้วยกเลิก', items[0].act === 'pb:approve:' + pb && items[1].danger);
  await pick('pb:approve:' + pb);
  await page.waitForTimeout(150);
  T.ok('อนุมัติจากเมนูแล้วสถานะเปลี่ยน', (await page.$eval('#main [data-act="stmenu:paymentBatch:' + pb + '"]', (e) => e.textContent)).indexOf('อนุมัติแล้ว') >= 0);
  await go('whtcert');
  const cert = await page.evaluate(() => DB.docs.whtCert.find((c) => c.expenseNo));
  items = await menu('whtCert', cert.no);
  T.ok('หนังสือรับรองมีคอลัมน์สถานะ เมนูพาไปเอกสารต้นทาง', items[0].act === 'open:expenses:' + cert.expenseNo);
  await page.keyboard.press('Escape');

  console.log('\n[8] จอโทรศัพท์และยอดคุม');
  await page.setViewportSize({ width: 390, height: 844 });
  const over = await page.evaluate(() => ['purchaseorders', 'bills', 'expenses', 'goodsreceipts', 'payments', 'whtcert', 'paymentprep'].filter(function (s) {
    STATE.screen = s; STATE.sel = null; render();
    return document.documentElement.scrollWidth - document.documentElement.clientWidth > 1;
  }));
  T.ok('★ จอ 390px ไม่ล้นแนวนอนทุกหน้าฝั่งซื้อ', over.length === 0, over.join(', '));
  await page.evaluate(() => { STATE.screen = 'expenses'; render(); dispatch('new:expense'); });
  await modalOpen();
  const mOver = await page.evaluate(() => document.querySelector('#modal .modal-box').scrollWidth - document.querySelector('#modal .modal-box').clientWidth);
  T.ok('ฟอร์มค่าใช้จ่ายบนจอโทรศัพท์ไม่ล้นกรอบ (ตารางรายการเลื่อนในกรอบของตัวเอง)', mOver <= 1, mOver + 'px');
  await page.click('#modal [data-act="modal:close"]');
  await page.setViewportSize({ width: 1440, height: 950 });
  T.ok('★ ยอดคุมผ่านทุกข้อ (เจ้าหนี้ พักรับสินค้า สินค้า ภาษีซื้อ หัก ณ ที่จ่าย)', (await recon()) === '', await recon());
  await T.done();
})().catch((e) => { console.error(e); process.exit(1); });
