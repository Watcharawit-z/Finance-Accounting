/* ทดสอบการเก็บข้อมูลบนเซิร์ฟเวอร์ด้วย PostgreSQL จริงและเบราว์เซอร์จริง
   ต้องมี DATABASE_URL ชี้ไปฐานข้อมูลเปล่า */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n + (x ? ' — ' + x : '')); }
  else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer(env, port) {
  const p = spawn(process.execPath, [path.join(__dirname, 'server.js')],
    { env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', (d) => { log += d; });
  p.stderr.on('data', (d) => { log += d; });
  return { p, log: () => log };
}

(async () => {
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) { console.error('ต้องตั้ง DATABASE_URL'); process.exit(1); }
  {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query('DROP TABLE IF EXISTS duly_state, duly_state_history');
    await c.end();
  }
  const PASSCODE = 'ลับสุดยอด-1234';

  console.log('\n[1] เซิร์ฟเวอร์ที่ไม่ได้ต่อฐานข้อมูล ต้องทำงานเหมือนเดิม');
  const s0 = startServer({ DATABASE_URL: '', APP_DATABASE_URL: '', APP_PASSCODE: '' }, 4610);
  await wait(1200);
  const c0 = await (await fetch('http://127.0.0.1:4610/api/config')).json();
  ok('รายงานว่าเก็บในเบราว์เซอร์', c0.storage === 'browser');
  const st0 = await fetch('http://127.0.0.1:4610/api/state');
  ok('เรียก /api/state แล้วบอกชัดว่ายังไม่ได้ต่อฐานข้อมูล', st0.status === 404);
  s0.p.kill();

  console.log('\n[2] ต่อฐานข้อมูลจริงและมีรหัสผ่าน');
  const s1 = startServer({ DATABASE_URL: DB_URL, APP_PASSCODE: PASSCODE }, 4611);
  await wait(2000);
  const base = 'http://127.0.0.1:4611';
  const cfg = await (await fetch(base + '/api/config')).json();
  ok('รายงานว่าเก็บบนเซิร์ฟเวอร์', cfg.storage === 'server');
  ok('บอกว่าต้องใช้รหัสผ่าน', cfg.needsPasscode === true);
  const h = await (await fetch(base + '/health')).json();
  ok('health บอกสถานะที่เก็บข้อมูล', h.storage === 'server', JSON.stringify(h));

  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  const noPass = await fetch(base + '/api/state');
  ok('★ ไม่ใส่รหัสผ่านอ่านข้อมูลไม่ได้', noPass.status === 401);
  const wrongPass = await fetch(base + '/api/state', { headers: { 'x-passcode': b64('เดามั่ว') } });
  ok('★ รหัสผ่านผิดอ่านข้อมูลไม่ได้', wrongPass.status === 401);

  const H = { 'x-passcode': b64(PASSCODE), 'content-type': 'application/json' };
  const empty = await (await fetch(base + '/api/state', { headers: H })).json();
  ok('ฐานข้อมูลเปล่าคืน version 0', empty.version === 0 && empty.data === null, JSON.stringify(empty).slice(0, 120));

  console.log('\n[3] เบราว์เซอร์เครื่องที่หนึ่ง');
  const browser = await chromium.launch();
  const errs = [];
  const ctxA = await browser.newContext();
  const A = await ctxA.newPage();
  A.on('pageerror', (e) => errs.push('A: ' + e.message));
  await A.goto(base);
  try { await A.waitForSelector('#main .card', { timeout: 10000 }); }
  catch (e) {
    console.log('    main:', (await A.evaluate(() => document.getElementById('main').innerHTML)).slice(0, 200));
    console.log('    SYNC:', await A.evaluate(() => JSON.stringify({ m: SYNC.mode, s: SYNC.status })));
    console.log('    errs:', errs.slice(0, 3).join(' | '));
    console.log('    server log:', s1.log().slice(0, 300));
    throw e;
  }
  ok('ยังไม่ใส่รหัสผ่านจะเจอหน้าล็อก', await A.$eval('#main h2',
    (e) => e.textContent.indexOf('รหัสผ่าน') >= 0).catch(() => false));

  await A.fill('[name="passcode"]', 'ผิดแน่นอน');
  await A.click('[data-act="pass:submit"]');
  await A.waitForTimeout(600);
  ok('ใส่รหัสผิดยังไม่ให้เข้า', await A.$('[name="passcode"]') !== null);

  await A.fill('[name="passcode"]', PASSCODE);
  await A.click('[data-act="pass:submit"]');
  await A.waitForSelector('#main .kpis', { timeout: 10000 });
  await A.waitForTimeout(1500);
  const stA = await A.evaluate(() => ({ mode: SYNC.mode, version: SYNC.version, entries: DB.entries.length }));
  ok('เข้าได้และสร้างข้อมูลตัวอย่างขึ้นเซิร์ฟเวอร์', stA.mode === 'server' && stA.version >= 1,
    'รุ่นที่ ' + stA.version + ' · ใบสำคัญ ' + stA.entries);

  console.log('\n[4] ออกใบกำกับภาษีแล้วต้องอยู่บนเซิร์ฟเวอร์จริง');
  await A.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  await A.click('[data-act="new:invoice"]');
  await A.waitForSelector('#modal.show');
  await A.selectOption('[name="l0_item"]', 'SW-220');
  await A.fill('[name="l0_qty"]', '10');
  await A.click('[data-act="modal:submit"]');
  await A.waitForFunction(() => !document.getElementById('modal').classList.contains('show'));
  await A.waitForTimeout(1500);
  const after = await A.evaluate(() => ({ version: SYNC.version, no: DB.docs.invoice[0].no, n: DB.docs.invoice.length }));
  ok('เลขรุ่นเพิ่มขึ้นหลังบันทึก', after.version > stA.version, 'รุ่นที่ ' + after.version);
  ok('ป้ายบอกว่าบันทึกขึ้นเซิร์ฟเวอร์แล้ว', await A.$eval('#syncTag',
    (e) => e.textContent.indexOf('บันทึกขึ้นเซิร์ฟเวอร์') >= 0));

  const fromDb = await (await fetch(base + '/api/state', { headers: H })).json();
  ok('★ อ่านจากฐานข้อมูลตรง ๆ แล้วเจอใบกำกับที่เพิ่งออก',
    fromDb.data.docs.invoice[0].no === after.no, after.no);
  ok('เลขรุ่นในฐานข้อมูลตรงกับที่เบราว์เซอร์ถือ', fromDb.version === after.version);

  console.log('\n[5] เบราว์เซอร์เครื่องที่สอง ต้องเห็นข้อมูลชุดเดียวกัน');
  const ctxB = await browser.newContext();
  const B = await ctxB.newPage();
  B.on('pageerror', (e) => errs.push('B: ' + e.message));
  await B.goto(base);
  await B.waitForSelector('#main .card', { timeout: 10000 });
  await B.fill('[name="passcode"]', PASSCODE);
  await B.click('[data-act="pass:submit"]');
  await B.waitForSelector('#main .kpis', { timeout: 10000 });
  const stB = await B.evaluate(() => ({ version: SYNC.version, no: DB.docs.invoice[0].no, n: DB.docs.invoice.length }));
  ok('★ เครื่องที่สองเห็นใบกำกับของเครื่องแรก', stB.no === after.no, stB.no);
  ok('เลขรุ่นตรงกันทั้งสองเครื่อง', stB.version === after.version);

  console.log('\n[6] สองเครื่องแก้พร้อมกัน ต้องไม่ทับกันเงียบ ๆ');
  await B.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  await B.click('[data-act="new:invoice"]');
  await B.waitForSelector('#modal.show');
  await B.selectOption('[name="l0_item"]', 'CB-16');
  await B.fill('[name="l0_qty"]', '5');
  await B.click('[data-act="modal:submit"]');
  await B.waitForFunction(() => !document.getElementById('modal').classList.contains('show'));
  await B.waitForTimeout(1500);
  const vB = await B.evaluate(() => SYNC.version);
  ok('เครื่องที่สองบันทึกได้', vB > stB.version, 'รุ่นที่ ' + vB);

  /* เครื่องแรกยังถือรุ่นเก่าอยู่ พอบันทึกต้องถูกปฏิเสธและดึงของใหม่มาแทน */
  await A.evaluate(() => { STATE.screen = 'invoices'; STATE.sel = null; render(); });
  await A.click('[data-act="new:invoice"]');
  await A.waitForSelector('#modal.show');
  await A.selectOption('[name="l0_item"]', 'WR-25');
  await A.fill('[name="l0_qty"]', '3');
  await A.click('[data-act="modal:submit"]');
  await A.waitForFunction(() => !document.getElementById('modal').classList.contains('show'));
  await A.waitForTimeout(2000);
  const conflict = await A.evaluate(() => ({
    version: SYNC.version, status: SYNC.status,
    toast: document.getElementById('toast').textContent,
  }));
  ok('★ ระบบจับได้ว่ามีการแก้จากอีกเครื่อง', conflict.toast.indexOf('อีกเครื่อง') >= 0, conflict.toast.slice(0, 60));
  ok('ดึงข้อมูลรุ่นล่าสุดมาแทน ไม่เขียนทับของเครื่องอื่น', conflict.version === vB,
    'รุ่นที่ ' + conflict.version);
  const survived = await (await fetch(base + '/api/state', { headers: H })).json();
  ok('★ ใบกำกับของเครื่องที่สองไม่หายไป',
    survived.data.docs.invoice.some((d) => d.lines.some((l) => l.itemCode === 'CB-16')));

  console.log('\n[7] เก็บฉบับย้อนหลังไว้กู้ได้');
  const { Client } = require('pg');
  const c = new Client({ connectionString: DB_URL });
  await c.connect();
  const hist = await c.query('SELECT count(*)::int n, max(version)::int v FROM duly_state_history');
  ok('มีประวัติทุกรุ่นที่เคยบันทึก', hist.rows[0].n >= 3, hist.rows[0].n + ' ฉบับ ล่าสุดรุ่นที่ ' + hist.rows[0].v);
  await c.end();

  ok('ไม่มีข้อผิดพลาดในคอนโซลของทั้งสองเครื่อง', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  s1.p.kill();
  console.log('\n' + (fail === 0 ? 'ผ่านทั้งหมด ' + pass + ' ข้อ' : 'ผ่าน ' + pass + ' ไม่ผ่าน ' + fail));
  process.exit(fail ? 1 : 0);
})();
