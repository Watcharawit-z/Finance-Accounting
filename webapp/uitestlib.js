/* ตัวช่วยสำหรับชุดทดสอบหน้าเว็บแยกระบบ (uitest-*.js) — เปิด index.html ใน Chromium จริง
   ใช้: const T = require('./uitestlib'); (async () => { const { page } = await T.open(); ... T.ok(...); await T.done(); })(); */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const path = require('path');

const URL = 'file://' + path.join(__dirname, 'index.html');
let pass = 0, fail = 0, browser = null, errors = [];
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
/** รอให้หน้าต่างแบบฟอร์มปิด (บันทึกสำเร็จ) */
const closed = (p) => p.waitForFunction(
  () => !document.getElementById('modal').classList.contains('show'), null, { timeout: 5000 });
async function open(viewport) {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: viewport || { width: 1440, height: 950 } });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => d.accept());
  await page.goto(URL);
  await page.waitForTimeout(400);
  return { page, errors };
}
/** บริษัทเปล่าสำหรับทดสอบ — ปี 2026 งวดที่เลือก */
async function blank(page, period) {
  await page.evaluate((p) => { buildBlank({ name: 'บริษัท ทดสอบ จำกัด', year: 2026 }); STATE.period = p || '2026-06'; STATE.sel = null; render(); }, period);
}
async function done() {
  ok('ไม่มีข้อผิดพลาดในคอนโซล', errors.length === 0, errors.slice(0, 3).join(' | '));
  if (browser) await browser.close();
  console.log('\n' + (fail === 0 ? 'ผ่านทั้งหมด ' + pass + ' ข้อ' : 'ผ่าน ' + pass + ' ไม่ผ่าน ' + fail));
  process.exit(fail ? 1 : 0);
}
module.exports = { open, blank, ok, closed, done, URL };
