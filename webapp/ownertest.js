/* ทดสอบรหัสเจ้าของและค่าแอดรายวันบนเซิร์ฟเวอร์จริง (server.js + store.js + PostgreSQL)
   ต้องมี DATABASE_URL ชี้ไปฐานข้อมูลเปล่า — รันด้วย DATABASE_URL=... node webapp/ownertest.js */
const { spawn } = require('child_process');
const path = require('path');

let pass = 0, fail = 0;
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✓ ' + n + (x ? ' — ' + x : '')); }
  else { fail++; console.log('  ✗ ' + n + (x ? ' — ' + x : '')); }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

(async () => {
  const DB_URL = process.env.DATABASE_URL;
  if (!DB_URL) { console.error('ต้องตั้ง DATABASE_URL'); process.exit(1); }
  {
    const { Client } = require('pg');
    const c = new Client({ connectionString: DB_URL });
    await c.connect();
    await c.query('DROP TABLE IF EXISTS financii_ad_spend');
    await c.end();
  }
  const PORT = 3917;
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), APP_PASSCODE: 'ร่วม1234', APP_OWNER_PASSCODE: 'เจ้าของ9999', APP_INGEST_KEY: 'key-abc-123' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  for (let i = 0; i < 50 && !/พอร์ต/.test(log); i++) await wait(100);
  const base = 'http://127.0.0.1:' + PORT;
  const call = async (url, o) => {
    const r = await fetch(base + url, o);
    let body = null;
    try { body = await r.json(); } catch (e) { body = null; }
    return { status: r.status, body };
  };
  const as = (pass, extra) => ({ headers: Object.assign({ 'content-type': 'application/json' }, pass ? { 'x-passcode': b64(pass) } : {}), ...(extra || {}) });

  try {
    console.log('\n[1] สิทธิ์ตามรหัส');
    ok('เปิดเซิร์ฟเวอร์ได้ บอกว่ามีรหัสเจ้าของและรับค่าแอดจากระบบอื่นได้', /มีรหัสเจ้าของ/.test(log) && /รับค่าแอด/.test(log), log.split('\n')[0]);
    const cfg = await call('/api/config');
    ok('/api/config บอกว่ามีการเข้าแบบเจ้าของ', cfg.body.ownerLogin === true && cfg.body.needsPasscode === true);
    ok('ไม่มีรหัส → 401', (await call('/api/me', as(''))).status === 401);
    ok('รหัสผิด → 401', (await call('/api/me', as('ผิด'))).status === 401);
    const st = await call('/api/me', as('ร่วม1234'));
    const ow = await call('/api/me', as('เจ้าของ9999'));
    ok('★ รหัสร่วม = staff · รหัสเจ้าของ = owner', st.body.role === 'staff' && ow.body.role === 'owner', st.body.role + ' / ' + ow.body.role);
    ok('รหัสเจ้าของเปิดสมุดบัญชีได้เหมือนรหัสร่วม', (await call('/api/state', as('เจ้าของ9999'))).status === 200);

    console.log('\n[2] ค่าแอดเฉพาะเจ้าของ');
    const put = await call('/api/ads', as('เจ้าของ9999', { method: 'PUT', body: JSON.stringify({ items: [
      { date: '2026-11-01', shop: 'TikTok ร้าน A', amount: 1500.5 },
      { date: '2026-11-01', shop: 'TikTok ร้าน B', amount: '2,000' },
      { date: '2026-11-02', shop: 'TikTok ร้าน A', amount: 800 }] }) }));
    ok('★ เจ้าของบันทึกค่าแอดได้ 3 แถว', put.status === 200 && put.body.saved === 3, JSON.stringify(put.body));
    const sGet = await call('/api/ads?from=2026-11-01&to=2026-11-30', as('ร่วม1234'));
    ok('★ รหัสร่วมอ่านค่าแอดไม่ได้ (403 ข้อมูลไม่ออกจากเซิร์ฟเวอร์)', sGet.status === 403 && !sGet.body.items, JSON.stringify(sGet.body));
    const sPut = await call('/api/ads', as('ร่วม1234', { method: 'PUT', body: JSON.stringify({ items: [{ date: '2026-11-03', amount: 1 }] }) }));
    ok('รหัสร่วมเขียนค่าแอดไม่ได้', sPut.status === 403);
    const oGet = await call('/api/ads?from=2026-11-01&to=2026-11-30', as('เจ้าของ9999'));
    ok('เจ้าของอ่านได้ครบ เรียงตามวันและร้าน ยอดเป็นทศนิยม 2 ตำแหน่ง', oGet.status === 200 && oGet.body.items.length === 3
      && oGet.body.items[0].amount === '1500.50' && oGet.body.items[1].amount === '2000.00', JSON.stringify(oGet.body.items.map((x) => x.date + ' ' + x.shop + ' ' + x.amount)));
    const rng = await call('/api/ads?from=2026-11-02&to=2026-11-02', as('เจ้าของ9999'));
    ok('กรองช่วงวันที่ได้', rng.body.items.length === 1 && rng.body.items[0].date === '2026-11-02');
    const stState = await call('/api/state', as('ร่วม1234'));
    ok('★ สมุดบัญชีที่รหัสร่วมได้รับไม่มีข้อมูลค่าแอด', JSON.stringify(stState.body).indexOf('TikTok ร้าน A') < 0);
    const del = await call('/api/ads', as('เจ้าของ9999', { method: 'PUT', body: JSON.stringify({ items: [{ date: '2026-11-02', shop: 'TikTok ร้าน A', amount: null }] }) }));
    ok('เจ้าของลบยอดวันหนึ่งได้ (amount null)', del.body.deleted === 1);

    console.log('\n[3] ระบบอื่นส่งค่าแอดเข้ามา (SellerHub)');
    const body = JSON.stringify({ source: 'sellerhub', items: [{ date: '2026-11-03', shop: 'TikTok ร้าน A', amount: 999.99 }] });
    ok('ไม่มีกุญแจ → 401', (await call('/api/ingest/ad-spend', { method: 'POST', body })).status === 401);
    ok('กุญแจผิด → 401', (await call('/api/ingest/ad-spend', { method: 'POST', body, headers: { authorization: 'Bearer ผิด'.replace('ผิด', 'wrong') } })).status === 401);
    ok('รหัสเจ้าของใช้แทนกุญแจไม่ได้', (await call('/api/ingest/ad-spend', { method: 'POST', body, headers: { 'x-passcode': b64('เจ้าของ9999') } })).status === 401);
    const ing = await call('/api/ingest/ad-spend', { method: 'POST', body, headers: { authorization: 'Bearer key-abc-123', 'content-type': 'application/json' } });
    ok('★ กุญแจถูก บันทึกได้ (Authorization: Bearer)', ing.status === 200 && ing.body.saved === 1 && ing.body.book === 'default', JSON.stringify(ing.body));
    const again = await call('/api/ingest/ad-spend', { method: 'POST', headers: { 'x-api-key': 'key-abc-123' },
      body: JSON.stringify({ items: [{ date: '2026-11-03', shop: 'TikTok ร้าน A', amount: 1200 }] }) });
    const after = await call('/api/ads?from=2026-11-03&to=2026-11-03', as('เจ้าของ9999'));
    ok('★ ส่งวันเดิมซ้ำ = แทนที่ยอดเดิม ไม่ซ้ำแถว (x-api-key ก็ได้)', again.status === 200 && after.body.items.length === 1
      && after.body.items[0].amount === '1200.00' && after.body.items[0].source === 'ingest', JSON.stringify(after.body.items));
    const bad = await call('/api/ingest/ad-spend', { method: 'POST', headers: { 'x-api-key': 'key-abc-123' },
      body: JSON.stringify({ items: [{ date: '2026-11-04', amount: 10 }, { date: '2026-13-01', amount: 5 }] }) });
    const none = await call('/api/ads?from=2026-11-04&to=2026-11-04', as('เจ้าของ9999'));
    ok('★ แถวผิดแถวเดียว ไม่รับทั้งชุด บอกแถวที่ผิด', bad.status === 400 && /แถวที่ 2/.test(bad.body.error.message) && none.body.items.length === 0,
      bad.body.error.message);
    ok('ยอดติดลบไม่รับ', (await call('/api/ingest/ad-spend', { method: 'POST', headers: { 'x-api-key': 'key-abc-123' },
      body: JSON.stringify({ items: [{ date: '2026-11-04', amount: -5 }] }) })).status === 400);
    ok('ลบผ่านช่องทางระบบอื่นไม่ได้ (amount null ไม่รับ)', (await call('/api/ingest/ad-spend', { method: 'POST', headers: { 'x-api-key': 'key-abc-123' },
      body: JSON.stringify({ items: [{ date: '2026-11-03', shop: 'TikTok ร้าน A', amount: null }] }) })).status === 400);
    const other = await call('/api/ingest/ad-spend', { method: 'POST', headers: { 'x-api-key': 'key-abc-123' },
      body: JSON.stringify({ book: 'shop2', items: [{ date: '2026-11-05', shop: 'X', amount: 50 }] }) });
    const o1 = await call('/api/ads?book=default&from=2026-11-05&to=2026-11-05', as('เจ้าของ9999'));
    const o2 = await call('/api/ads?book=shop2&from=2026-11-05&to=2026-11-05', as('เจ้าของ9999'));
    ok('ระบุสมุด (บริษัท) ได้ ค่าแอดแยกตามบริษัท', other.body.book === 'shop2' && o1.body.items.length === 0 && o2.body.items.length === 1);
  } finally {
    srv.kill();
  }

  console.log('\n[4] รหัสเจ้าของซ้ำกับรหัสร่วม → ปิดสิทธิ์เจ้าของ');
  const srv2 = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT + 1), APP_PASSCODE: 'same', APP_OWNER_PASSCODE: 'same' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log2 = '';
  srv2.stdout.on('data', (d) => { log2 += d; });
  srv2.stderr.on('data', (d) => { log2 += d; });
  for (let i = 0; i < 50 && !/พอร์ต/.test(log2); i++) await wait(100);
  try {
    const r = await fetch('http://127.0.0.1:' + (PORT + 1) + '/api/me', { headers: { 'x-passcode': b64('same') } }).then((x) => x.json());
    ok('★ ตั้งรหัสเจ้าของซ้ำกับรหัสร่วม ทุกคนเป็น staff และเซิร์ฟเวอร์เตือน', r.role === 'staff' && r.ownerLogin === false && /ซ้ำกับ APP_PASSCODE/.test(log2), r.role);
    const ing = await fetch('http://127.0.0.1:' + (PORT + 1) + '/api/ingest/ad-spend', { method: 'POST', body: '{}' });
    ok('ไม่ตั้ง APP_INGEST_KEY → ช่องทางรับข้อมูลปิด (403)', ing.status === 403);
  } finally { srv2.kill(); }

  console.log('\n' + (fail === 0 ? 'ผ่านทั้งหมด ' + pass + ' ข้อ' : 'ผ่าน ' + pass + ' ไม่ผ่าน ' + fail));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
