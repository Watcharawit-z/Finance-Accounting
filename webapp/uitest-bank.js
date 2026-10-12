/* ทดสอบหน้ากระทบยอดธนาคารในเบราว์เซอร์จริง — บริษัทเปล่า ใช้ปุ่มและแบบฟอร์มจริงทุกขั้น
   รัน: node webapp/build.js && node webapp/uitest-bank.js */
const T = require('./uitestlib');
/* จำนวนเงินสเกล 4 ตำแหน่งแบบเดียวกับ M() ในระบบ — แยกจำนวนเต็มกับทศนิยมเอง ไม่ผ่านทศนิยมลอยตัว */
const M = (s) => { const [i, f = ''] = String(s).split('.'); return Number(i) * 10000 + Number((f + '0000').slice(0, 4)); };

const STMT_JUNE = [
  'ธนาคารไทยพาณิชย์ รายการเดินบัญชี ตั้งแต่ 01/06/2569 ถึง 30/06/2569',
  'วันที่,รายการ,เลขที่อ้างอิง,ถอน,ฝาก,คงเหลือ',
  '01/06/2569,รับโอนเงินทุน,TR0601,,"1,000,000.00","1,000,000.00"',
  '10/06/2569,ค่าธรรมเนียมโอนเงิน,FEE0610,50.00,,"999,950.00"',
  '15/06/2569,โอนไปบัญชีออมทรัพย์,TR0615,"100,000.00",,"899,950.00"',
  '21/06/2569,CHQ 000123,000123,"30,000.00",,"869,950.00"',
  '30/06/2569,ดอกเบี้ยรับ,INT0630,,85.50,"870,035.50"',
].join('\n');

(async () => {
  const { page } = await T.open();
  await T.blank(page, '2026-06');
  await page.evaluate(() => {
    saveCompany({ name: 'บริษัท ทดสอบ จำกัด', taxId: '0105536000003', address: '1 ถนนสีลม กรุงเทพฯ', branch: '00000' });
    postJournalVoucher({ book: 'receipt', date: '2026-06-01', desc: 'รับเงินทุนจดทะเบียน',
      lines: [{ acc: '1113', dr: '1000000' }, { acc: '3120', cr: '1000000' }] });
    postJournalVoucher({ book: 'payment', date: '2026-06-20', desc: 'จ่ายเช็ค 000123 ค่าเช่าสำนักงาน',
      lines: [{ acc: '5321', dr: '30000' }, { acc: '1113', cr: '30000' }] });
    postJournalVoucher({ book: 'payment', date: '2026-06-29', desc: 'จ่ายเช็ค 000124 ค่าซ่อมแซม',
      lines: [{ acc: '5325', dr: '12000' }, { acc: '1113', cr: '12000' }] });
    save(); render();
  });
  const bankItem = () => page.evaluate(() => closeChecklist('2026-06').items.find((i) => i.action === 'bank'));

  console.log('\n[1] บริษัทเปล่าที่มีเงินเข้าบัญชีแต่ยังไม่มีสเตทเมนต์');
  await page.click('[data-act="go:bank"]');
  await page.waitForSelector('#bankStatus');
  const st0 = await page.$eval('#bankStatus', (e) => e.textContent);
  T.ok('หน้ากระทบยอดไม่ขึ้น "กระทบยอดครบ" แต่บอกว่ายังไม่มีสเตทเมนต์', /ยังไม่มีสเตทเมนต์/.test(st0), st0.slice(0, 60));
  const head0 = await page.$eval('#main .card .card-sub', (e) => e.textContent);
  T.ok('หัวหน้าจอเป็นบัญชีของบริษัทนี้ ไม่ใช่บัญชีธนาคารตัวอย่าง', /^1113 /.test(head0) && !/กรุงเทพ/.test(head0), head0);
  const i0 = await bankItem();
  T.ok('ข้อตรวจก่อนปิดงวดไม่ผ่าน พร้อมบอกว่าค้างอะไร', !i0.ok && /1113 ยังไม่มีสเตทเมนต์/.test(i0.detail), i0.detail);
  T.ok('ขั้นกระทบยอดในแถบงานปิดงวดไม่ขึ้นเครื่องหมายเสร็จ', await page.$eval('.flow a[data-act="go:bank"]', (e) => e.textContent.indexOf('✓') < 0));

  console.log('\n[2] นำเข้าสเตทเมนต์ .csv (วันที่ พ.ศ.)');
  await page.click('[data-act="bank:import"]');
  await page.waitForSelector('#modal.show #bankFile');
  await page.selectOption('[name="bimpacc"]', '1113');
  await page.setInputFiles('#bankFile', { name: 'scb-june.csv', mimeType: 'text/csv', buffer: Buffer.from(STMT_JUNE, 'utf8') });
  await page.waitForFunction(() => /อ่านได้ 5 รายการ/.test(document.getElementById('modal').textContent), null, { timeout: 5000 });
  T.ok('เห็นตัวอย่างก่อนนำเข้า: 5 รายการ ช่วงวันที่ถูก', await page.$eval('#modal', (e) => /1 มิ.ย. 2569 ถึง 30 มิ.ย. 2569/.test(e.textContent)));
  T.ok('ระบบเดาคอลัมน์ถอน/ฝาก/คงเหลือได้', await page.evaluate(() => val('bm_debit') === '3' && val('bm_credit') === '4' && val('bm_balance') === '5'));
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const imp = await page.evaluate(() => ({ n: DB.bankTxns.filter((t) => t.acc === '1113').length,
    matched: DB.bankTxns.filter((t) => t.matched).length, closing: bankStmtRec('1113', '2026-06').closing }));
  T.ok('นำเข้า 5 รายการเข้าบัญชี 1113', imp.n === 5);
  T.ok('★ จับคู่อัตโนมัติ: เงินทุน และเช็คค่าเช่า (ธนาคารตัดช้ากว่า 1 วัน)', imp.matched === 2, imp.matched + ' รายการ');
  T.ok('ไฟล์ครบเดือน → ตั้งยอดปลายงวดตามสเตทเมนต์ให้', imp.closing === M('870035.50'));
  const unrec = await page.$$eval('tr[data-bank-t]', (rows) => rows.length);
  T.ok('เหลือรายการที่ธนาคารลงไว้ 3 รายการ (ค่าธรรมเนียม โอนออก ดอกเบี้ย)', unrec === 3, unrec + ' แถว');
  T.ok('เช็คที่ยังไม่ขึ้นสเตทเมนต์แสดงเป็นเช็คค้างจ่าย', await page.$$eval('tr[data-bank-k]', (r) => r.length === 1 && /เช็คค้างจ่าย/.test(r[0].textContent)));

  console.log('\n[3] นำเข้าไฟล์เดิมซ้ำ');
  await page.click('[data-act="bank:import"]');
  await page.waitForSelector('#modal.show #bankFile');
  await page.setInputFiles('#bankFile', { name: 'scb-june.csv', mimeType: 'text/csv', buffer: Buffer.from(STMT_JUNE, 'utf8') });
  await page.waitForFunction(() => /นำเข้าไว้แล้วในบัญชีนี้/.test(document.getElementById('modal').textContent), null, { timeout: 5000 });
  T.ok('ตัวอย่างเตือนว่ามีรายการที่นำเข้าไว้แล้ว', true);
  await page.click('[data-act="modal:submit"]');
  await page.waitForTimeout(200);
  T.ok('★ กดนำเข้าซ้ำ → ระบบปฏิเสธ ไม่มีรายการซ้ำ', await page.evaluate(() => DB.bankTxns.length === 5
    && /นำเข้าไปแล้ว/.test(document.getElementById('toast').textContent)));
  await page.click('#modal [data-act="modal:close"]');
  await T.closed(page);

  console.log('\n[4] บันทึกรายการที่ธนาคารลงไว้');
  const idOf = (ref) => page.evaluate((r) => DB.bankTxns.find((t) => t.ref === r).id, ref);
  const feeId = await idOf('FEE0610');
  await page.click('[data-act="bank:book:' + feeId + '"]');
  await page.waitForSelector('#modal.show');
  T.ok('ค่าธรรมเนียม: ระบบเสนอบัญชีดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', await page.evaluate(() => val('acc') === '5410'));
  T.ok('รายการคู่ไม่มีบัญชีคุม (ลูกหนี้/เจ้าหนี้)', await page.$$eval('#f_acc option', (o) => !o.some((x) => x.value === '1131' || x.value === '2121')));
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const intId = await idOf('INT0630');
  await page.click('[data-act="bank:book:' + intId + '"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="acc"]', '4210');
  await page.fill('[name="bwht"]', '0.86');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const trId = await idOf('TR0615');
  await page.click('[data-act="bank:book:' + trId + '"]');
  await page.waitForSelector('#modal.show');
  await page.selectOption('[name="acc"]', '1114');
  await page.fill('[name="bdesc"]', 'โอนเงินไปบัญชีออมทรัพย์');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const booked = await page.evaluate(() => {
    const e = (r) => DB.entries.find((x) => x.no === DB.bankTxns.find((t) => t.ref === r).items[0]);
    return { fee: e('FEE0610'), int: e('INT0630'), tr: e('TR0615') };
  });
  T.ok('★ ค่าธรรมเนียมลงบัญชี 1113 (บัญชีของสเตทเมนต์) สมุดรายวันจ่าย', booked.fee.type === 'payment'
    && booked.fee.lines.some((l) => l.acc === '1113' && l.cr === M('50')));
  T.ok('★ ดอกเบี้ยรับ: รายได้เต็ม 86.36 ภาษีถูกหัก 0.86 เงินเข้า 85.50', booked.int.lines.some((l) => l.acc === '4210' && l.cr === M('86.36'))
    && booked.int.lines.some((l) => l.acc === '1165' && l.dr === M('0.86')) && booked.int.lines.some((l) => l.acc === '1113' && l.dr === M('85.5')));
  T.ok('★ โอนระหว่างบัญชี: Dr 1114 / Cr 1113 ลงสมุดรายวันทั่วไป', booked.tr.type === 'general'
    && booked.tr.lines.some((l) => l.acc === '1114' && l.dr === M('100000')) && booked.tr.lines.some((l) => l.acc === '1113' && l.cr === M('100000')));
  const st1 = await page.$eval('#bankStatus', (e) => e.textContent);
  T.ok('★ บัญชี 1113 กระทบยอดแล้ว ผลต่างเป็นศูนย์', /^✓ กระทบยอดแล้ว/.test(st1), st1.slice(0, 70));
  const r1113 = await page.evaluate(() => bankReconcile('1113', '2026-06'));
  T.ok('งบกระทบยอด: สเตทเมนต์ 870,035.50 − เช็คค้าง 12,000 = บัญชี 858,035.50', r1113.adjBank === M('858035.50') && r1113.book === M('858035.50') && r1113.diff === 0);
  const i1 = await bankItem();
  T.ok('★ ยังไม่ผ่าน เพราะบัญชี 1114 มีเงินโอนเข้าแต่ไม่มีสเตทเมนต์', !i1.ok && /1114 ยังไม่มีสเตทเมนต์/.test(i1.detail) && /1113 ตรงกัน/.test(i1.detail), i1.detail);

  console.log('\n[5] บัญชีที่สอง: กรอกรายการเอง เลือกจับคู่ และยอดตามสเตทเมนต์');
  await page.selectOption('#bankAccSel', '1114');
  await page.waitForFunction(() => /^1114 /.test(document.querySelector('#main .card .card-sub').textContent));
  await page.click('[data-act="bank:add"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="bl0_date"]', '2026-06-15');
  await page.fill('[name="bl0_desc"]', 'รับโอนจากบัญชีกระแสรายวัน');
  await page.fill('[name="bl0_credit"]', '100,000');
  await page.fill('[name="bl1_date"]', '2026-06-30');
  await page.fill('[name="bl1_desc"]', 'ค่าบริการรายเดือน');
  await page.fill('[name="bl1_debit"]', '20');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  T.ok('เพิ่ม 2 รายการในสเตทเมนต์ 1114', await page.evaluate(() => DB.bankTxns.filter((t) => t.acc === '1114').length === 2));
  const inId = await page.evaluate(() => DB.bankTxns.find((t) => t.acc === '1114' && t.credit).id);
  T.ok('ระบบแนะนำใบสำคัญโอนเงินให้จับคู่', !!(await page.$('[data-act^="bank:m:' + inId + ':"]')));
  await page.check('input.bank-ck[data-t="' + inId + '"]');
  await page.check('input.bank-ck[data-k="' + booked.tr.no + '"]');
  T.ok('แถบเลือกบอกว่ายอดเท่ากัน', await page.$eval('#bankSelBar', (e) => /ยอดเท่ากัน/.test(e.textContent)));
  await page.click('[data-act="bank:msel"]');
  await page.waitForTimeout(150);
  T.ok('★ เลือกจับคู่หลายตารางด้วยมือ', await page.evaluate((id) => DB.bankTxns.find((t) => String(t.id) === String(id)).matched, inId));
  const svcId = await page.evaluate(() => DB.bankTxns.find((t) => t.acc === '1114' && t.debit).id);
  await page.click('[data-act="bank:book:' + svcId + '"]');
  await page.waitForSelector('#modal.show');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  await page.click('[data-act="bank:bal"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="bopen"]', '0');
  await page.fill('[name="bclose"]', '99,980.00');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const st2 = await page.$eval('#bankStatus', (e) => e.textContent);
  T.ok('★ บัญชี 1114 กระทบยอดแล้ว', /^✓ กระทบยอดแล้ว/.test(st2), st2.slice(0, 60));

  console.log('\n[6] ข้อตรวจก่อนปิดงวดผ่าน');
  const i2 = await bankItem();
  T.ok('★ ทุกบัญชีที่มีความเคลื่อนไหวกระทบยอดครบ → ข้อตรวจผ่าน', i2.ok && /1113 ตรงกัน \(รายการระหว่างทาง 1 รายการ\)/.test(i2.detail) && /1114 ตรงกัน/.test(i2.detail), i2.detail);
  await page.click('[data-act="go:close"]');
  await page.waitForTimeout(150);
  T.ok('หน้าปิดงวดแสดงข้อกระทบยอดธนาคาร', await page.$eval('#main', (e) => /กระทบยอดเงินฝากธนาคารครบทุกบัญชี/.test(e.textContent)));
  T.ok('ขั้นกระทบยอดในแถบงานปิดงวดขึ้นเครื่องหมายเสร็จ', await page.$eval('.flow a[data-act="go:bank"]', (e) => e.textContent.indexOf('✓') >= 0));

  console.log('\n[7] ยกเลิกการจับคู่ แล้วจับคู่ใหม่ด้วยหน้าต่างเลือกรายการ');
  await page.click('[data-act="go:bank"]');
  await page.selectOption('#bankAccSel', '1113');
  await page.waitForFunction(() => /^1113 /.test(document.querySelector('#main .card .card-sub').textContent));
  const rent = await page.evaluate(() => DB.bankTxns.find((t) => t.ref === '000123'));
  await page.click('details.adv summary >> text=ดูรายการที่จับคู่แล้ว');
  await page.click('[data-act="bank:unmatch:' + rent.matchId + '"]');
  await page.waitForTimeout(150);
  T.ok('ยกเลิกการจับคู่แล้ว เช็คกลับไปรอและสถานะไม่ผ่าน', await page.evaluate(() => !DB.bankTxns.find((t) => t.ref === '000123').matched)
    && /ยังไม่ครบ/.test(await page.$eval('#bankStatus', (e) => e.textContent)));
  await page.click('[data-act="bank:pick:' + rent.id + '"]');
  await page.waitForSelector('#modal.show input.bank-pk');
  await page.check('input.bank-pk[value="' + rent.items[0] + '"]');
  T.ok('หน้าต่างเลือกบอกว่ายอดเท่ากัน', await page.$eval('#bankPickSum', (e) => /ยอดเท่ากัน/.test(e.textContent)));
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  T.ok('จับคู่ใหม่แล้ว กลับมากระทบยอดครบ', /^✓/.test(await page.$eval('#bankStatus', (e) => e.textContent)));

  console.log('\n[8] พิมพ์และส่งออกงบกระทบยอด');
  await page.click('[data-act="printdoc:bankRec:1113|2026-06"]');
  await page.waitForSelector('#printArea.show .sheet');
  const pr = await page.$eval('#printArea', (e) => e.textContent);
  T.ok('★ ใบพิมพ์ A4 งบกระทบยอดเงินฝากธนาคาร มียอดและเช็คค้างจ่าย', /งบกระทบยอดเงินฝากธนาคาร/.test(pr) && /870,035\.50/.test(pr)
    && /858,035\.50/.test(pr) && /ค่าซ่อมแซม/.test(pr) && /ผู้จัดทำ/.test(pr));
  T.ok('ใบพิมพ์ใช้ปี พ.ศ.', /30 มิ\.ย\. 2569/.test(pr));
  await page.click('[data-act="printclose"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#main .card [data-act="csv"]')]);
  const csvText = require('fs').readFileSync(await dl.path(), 'utf8');
  if (process.env.BANK_CSV_DUMP) console.log(csvText);
  T.ok('★ ส่งออก CSV มีงบกระทบยอดครบทั้งสองด้าน', /ยอดคงเหลือตามสเตทเมนต์ธนาคาร/.test(csvText) && /ยอดคงเหลือตามบัญชี 1113/.test(csvText)
    && /ผลต่าง \(ต้องเป็นศูนย์\)/.test(csvText) && /ค่าซ่อมแซม/.test(csvText) && /ยอดคงเหลือตามสเตทเมนต์หลังปรับปรุง,,,858035\.50/.test(csvText) && /รวมเช็คค้างจ่าย,,,-12000\.00/.test(csvText));

  console.log('\n[9] นำเข้าผิดบัญชีแล้วยกเลิก · ลบรายการที่กรอกผิด · รายการค้าง ณ วันเริ่ม');
  await page.click('[data-act="bank:import"]');
  await page.waitForSelector('#modal.show #bankFile');
  await page.selectOption('[name="bimpacc"]', '1114');
  await page.setInputFiles('#bankFile', { name: 'oops.csv', mimeType: 'text/csv',
    buffer: Buffer.from('Date,Description,Withdrawal,Deposit,Balance\n2026-06-25,WRONG FILE,,1.00,1.00\n', 'utf8') });
  await page.waitForFunction(() => /อ่านได้ 1 รายการ/.test(document.getElementById('modal').textContent), null, { timeout: 5000 });
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const wrong = await page.evaluate(() => DB.bankImports.find((x) => x.name === 'oops.csv'));
  T.ok('นำเข้าไฟล์ผิดเข้า 1114 แล้วหน้าจอสลับไปบัญชีนั้น', !!wrong && await page.evaluate(() => STATE.bankAcc === '1114'));
  await page.click('details.adv summary >> text=ประวัติการนำเข้าไฟล์');
  await page.click('[data-act="bank:undoimp:' + wrong.id + '"]');
  await page.waitForTimeout(150);
  T.ok('★ ยกเลิกการนำเข้า: รายการจากไฟล์หาย บัญชีกลับมากระทบยอดครบ', await page.evaluate(() =>
    !DB.bankTxns.some((t) => t.desc === 'WRONG FILE') && bankReconcile('1114', '2026-06').ok));
  await page.click('[data-act="bank:add"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="bl0_date"]', '2026-06-28');
  await page.fill('[name="bl0_desc"]', 'กรอกผิด');
  await page.fill('[name="bl0_debit"]', '9');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  const typo = await page.evaluate(() => DB.bankTxns.find((t) => t.desc === 'กรอกผิด').id);
  await page.click('[data-act="bank:del:' + typo + '"]');
  await page.waitForTimeout(150);
  T.ok('ลบรายการที่กรอกผิดได้', await page.evaluate(() => !DB.bankTxns.some((t) => t.desc === 'กรอกผิด')));
  await page.click('[data-act="bank:bf"]');
  await page.waitForSelector('#modal.show');
  await page.fill('[name="bbfamt"]', '500');
  await page.fill('[name="bbfdesc"]', 'เช็คค้างจากระบบเดิม');
  await page.click('[data-act="modal:submit"]');
  await T.closed(page);
  T.ok('เพิ่มรายการค้าง ณ วันเริ่มได้ และงบแสดงเป็นเช็คค้างจ่าย', await page.evaluate(() =>
    DB.bankBf.length === 1 && bankReconcile('1114', '2026-06').cheques.some((i) => /ระบบเดิม/.test(i.desc))));
  const bfId = await page.evaluate(() => DB.bankBf[0].id);
  await page.click('[data-act="bank:bfdel:' + bfId + '"]');
  await page.waitForTimeout(150);
  T.ok('ลบรายการค้างได้', await page.evaluate(() => DB.bankBf.length === 0 && bankReconcile('1114', '2026-06').ok));

  console.log('\n[10] เปิดใหม่แล้วข้อมูลยังอยู่ และจอเล็ก');
  await page.reload();
  await page.waitForTimeout(400);
  T.ok('เปิดใหม่แล้วสเตทเมนต์และการจับคู่ยังอยู่', await page.evaluate(() =>
    DB.bankTxns.length === 7 && closeChecklist('2026-06').items.find((i) => i.action === 'bank').ok));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { STATE.screen = 'bank'; STATE.period = '2026-06'; render(); });
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  T.ok('จอมือถือไม่ล้นแนวนอน', over <= 1, over + 'px');
  await T.done();
})();
