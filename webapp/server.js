/* เสิร์ฟหน้าเว็บ และถ้ามีฐานข้อมูลก็เก็บสมุดบัญชีไว้บนเซิร์ฟเวอร์ให้ด้วย
   ไม่มีฐานข้อมูล = ทำงานเหมือนเดิมทุกอย่าง เก็บในเบราว์เซอร์ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const PORT = Number(process.env.PORT || 3000);
const PASSCODE = String(process.env.APP_PASSCODE || '');
/* รหัสเจ้าของ — เข้าได้ทุกหน้าเหมือนรหัสร่วม และเห็นหน้ายอดขาย กำไร ค่าแอด (ข้อมูลค่าแอดส่งให้เฉพาะรหัสนี้)
   ตั้งซ้ำกับรหัสร่วมไม่ได้ ไม่งั้นทุกคนกลายเป็นเจ้าของ — ระบบปิดสิทธิ์เจ้าของไว้แทน */
const OWNER_PASSCODE = process.env.APP_OWNER_PASSCODE && process.env.APP_OWNER_PASSCODE !== PASSCODE
  ? String(process.env.APP_OWNER_PASSCODE) : '';
/* กุญแจสำหรับระบบอื่นส่งค่าแอดเข้ามา (เช่น SellerHub) — แยกจากรหัสเจ้าของ ไม่ต้องฝากรหัสเจ้าของไว้ในระบบอื่น */
const INGEST_KEY = String(process.env.APP_INGEST_KEY || '');
const html = fs.readFileSync(path.join(__dirname, 'index.html'));
const etag = '"' + crypto.createHash('sha1').update(html).digest('hex').slice(0, 16) + '"';

const json = (res, code, body) => {
  const b = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': b.length });
  res.end(b);
};

/**
 * เทียบรหัสผ่านแบบใช้เวลาคงที่ ไม่ให้เดาทีละตัวอักษรจากเวลาที่ตอบกลับ
 * ★ ส่วนหัวของ HTTP รับได้แค่อักขระ ASCII รหัสผ่านภาษาไทยจึงต้องเข้ารหัส base64 มา
 *   ไม่งั้นเบราว์เซอร์จะโยนข้อผิดพลาดตั้งแต่ตอนตั้งค่าส่วนหัว
 */
function sameSecret(got, want) {
  const a = crypto.createHash('sha256').update(String(got)).digest();
  const b = crypto.createHash('sha256').update(String(want)).digest();
  return crypto.timingSafeEqual(a, b);
}
/** สิทธิ์ของผู้เรียก: owner (รหัสเจ้าของ) · staff (รหัสร่วม หรือไม่ได้ตั้งรหัสร่วม) · null = รหัสผิด */
function roleOf(req) {
  const raw = String(req.headers['x-passcode'] || '');
  const got = raw ? Buffer.from(raw, 'base64').toString('utf8') : '';
  if (OWNER_PASSCODE && got && sameSecret(got, OWNER_PASSCODE)) return 'owner';
  if (!PASSCODE) return 'staff';
  return got && sameSecret(got, PASSCODE) ? 'staff' : null;
}
const passOk = (req) => roleOf(req) !== null;
/** กุญแจของระบบที่ส่งข้อมูลเข้า — Authorization: Bearer <กุญแจ> หรือ x-api-key */
function ingestOk(req) {
  if (!INGEST_KEY) return false;
  const h = String(req.headers.authorization || '');
  const got = /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, '') : String(req.headers['x-api-key'] || '');
  return !!got && sameSecret(got, INGEST_KEY);
}

function readBody(req, limit) {
  return new Promise(function (resolve, reject) {
    let size = 0;
    const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('ข้อมูลใหญ่เกินไป'), { code: 'TOO_LARGE' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')); }
      catch (e) { reject(Object.assign(new Error('เนื้อหาไม่ใช่ JSON ที่ถูกต้อง'), { code: 'BAD_JSON' })); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url, query) {
  if (url === '/api/config') {
    return json(res, 200, {
      storage: store.enabled() ? 'server' : 'browser',
      needsPasscode: Boolean(PASSCODE),
      ownerLogin: Boolean(OWNER_PASSCODE),
      book: store.DEFAULT_BOOK,
      multiCompany: true,
    });
  }
  if (!store.enabled()) {
    return json(res, 404, { error: { code: 'NO_SERVER_STORAGE',
      message: 'บริการนี้ยังไม่ได้ต่อฐานข้อมูล ข้อมูลถูกเก็บในเบราว์เซอร์' } });
  }
  /* ระบบอื่นส่งค่าแอดรายวันเข้ามา — ใช้กุญแจ ไม่ใช้รหัสผ่าน
     POST /api/ingest/ad-spend { book?, source?, items: [{ date: "YYYY-MM-DD", shop, amount }] } */
  if (url === '/api/ingest/ad-spend') {
    if (!INGEST_KEY) {
      return json(res, 403, { error: { code: 'INGEST_DISABLED', message: 'ยังไม่ได้ตั้งกุญแจ APP_INGEST_KEY ที่เซิร์ฟเวอร์' } });
    }
    if (!ingestOk(req)) return json(res, 401, { error: { code: 'BAD_KEY', message: 'กุญแจไม่ถูกต้อง' } });
    if (req.method !== 'POST') return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'ใช้ POST' } });
    let body;
    try { body = await readBody(req, 2 * 1024 * 1024); }
    catch (e) { return json(res, 400, { error: { code: e.code || 'BAD_BODY', message: e.message } }); }
    const target = (body && body.book) || query.get('book') || store.DEFAULT_BOOK;
    if (!store.validBook(target)) return json(res, 400, { error: { code: 'BAD_BOOK', message: 'รหัสสมุดไม่ถูกต้อง' } });
    try {
      const r = await store.adsUpsert(target, body && body.items, (body && body.source) || 'ingest', false);
      return json(res, 200, Object.assign({ ok: true, book: target }, r));
    } catch (e) {
      if (e.code) return json(res, 400, { error: { code: e.code, message: e.message } });
      throw e;
    }
  }

  const role = roleOf(req);
  if (!role) {
    return json(res, 401, { error: { code: 'PASSCODE_REQUIRED', message: 'รหัสผ่านไม่ถูกต้อง' } });
  }

  const book = query.get('book') || store.DEFAULT_BOOK;
  if (!store.validBook(book)) {
    return json(res, 400, { error: { code: 'BAD_BOOK',
      message: 'รหัสสมุดใช้ได้เฉพาะ a-z A-Z 0-9 ขีดกลาง และขีดล่าง' } });
  }

  if (url === '/api/me' && req.method === 'GET') {
    return json(res, 200, { role, ownerLogin: Boolean(OWNER_PASSCODE), ingest: Boolean(INGEST_KEY) });
  }
  /* ค่าแอดรายวัน — เฉพาะรหัสเจ้าของ (รหัสร่วมได้ 403 ข้อมูลไม่ออกจากเซิร์ฟเวอร์) */
  if (url === '/api/ads') {
    if (role !== 'owner') return json(res, 403, { error: { code: 'OWNER_ONLY', message: 'หน้านี้สำหรับเจ้าของเท่านั้น' } });
    if (req.method === 'GET') {
      const day = (k) => { const v = query.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; };
      return json(res, 200, { book, items: await store.adsList(book, day('from'), day('to')) });
    }
    if (req.method === 'PUT') {
      let body;
      try { body = await readBody(req, 2 * 1024 * 1024); }
      catch (e) { return json(res, 400, { error: { code: e.code || 'BAD_BODY', message: e.message } }); }
      try { return json(res, 200, Object.assign({ ok: true }, await store.adsUpsert(book, body && body.items, 'manual', true))); }
      catch (e) {
        if (e.code) return json(res, 400, { error: { code: e.code, message: e.message } });
        throw e;
      }
    }
    return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'วิธีเรียกไม่ถูกต้อง' } });
  }

  if (url === '/api/books' && req.method === 'GET') {
    return json(res, 200, { books: await store.listBooks(), active: book });
  }
  const fail = (e) => json(res, e.code === 'NOT_FOUND' ? 404 : e.code === 'CONFIRM_MISMATCH' ? 409 : e.code ? 400 : 500,
    { error: { code: e.code || 'FAILED', message: e.message } });
  if (url === '/api/books' && req.method === 'DELETE') {
    let body;
    try { body = await readBody(req, 64 * 1024); } catch (e) { return fail(e); }
    try { return json(res, 200, Object.assign({ ok: true }, await store.removeBook(book, body || {}))); }
    catch (e) { return fail(e); }
  }
  if (url === '/api/trash' && req.method === 'GET') {
    return json(res, 200, { items: await store.listTrash() });
  }
  if (url === '/api/trash/restore' && req.method === 'POST') {
    try { return json(res, 200, Object.assign({ ok: true }, await store.restoreTrash(Number(query.get('id'))))); }
    catch (e) { return fail(e); }
  }
  if (url === '/api/trash' && req.method === 'DELETE') {
    let body;
    try { body = await readBody(req, 64 * 1024); } catch (e) { return fail(e); }
    try { await store.purgeTrash(Number(query.get('id')), body && body.confirmName); return json(res, 200, { ok: true }); }
    catch (e) { return fail(e); }
  }

  if (url === '/api/state' && req.method === 'GET') {
    const s = await store.read(book);
    return json(res, 200, { book: s.book, version: s.version, data: s.data, updatedAt: s.updatedAt });
  }
  if (url === '/api/state' && req.method === 'PUT') {
    let body;
    try { body = await readBody(req, 16 * 1024 * 1024); }
    catch (e) { return json(res, 413, { error: { code: e.code || 'BAD_BODY', message: e.message } }); }
    if (!body || typeof body !== 'object' || !body.data) {
      return json(res, 400, { error: { code: 'BAD_BODY', message: 'ต้องส่ง { version, data }' } });
    }
    try {
      const r = await store.write(book, body.version || 0, body.data);
      return json(res, 200, { book: book, version: r.version });
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT') {
        const s = await store.read(book);
        return json(res, 409, {
          error: { code: 'VERSION_CONFLICT',
            message: 'มีการบันทึกจากอีกเครื่องแทรกเข้ามา ระบบจึงไม่เขียนทับให้' },
          version: s.version, data: s.data,
        });
      }
      if (e.code === 'TOO_LARGE') return json(res, 413, { error: { code: e.code, message: e.message } });
      console.error(e);
      return json(res, 500, { error: { code: 'STORAGE_ERROR', message: 'บันทึกลงฐานข้อมูลไม่สำเร็จ' } });
    }
  }
  return json(res, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'วิธีเรียกไม่ถูกต้อง' } });
}

const server = http.createServer(function (req, res) {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health' || url === '/healthz') {
    return store.healthy().then((db) => json(res, 200, {
      ok: true, service: 'financii-webapp',
      storage: store.enabled() ? (db ? 'server' : 'server-unreachable') : 'browser',
    }));
  }
  if (url.startsWith('/api/')) {
    const query = new URLSearchParams((req.url || '').split('?')[1] || '');
    return api(req, res, url, query).catch(function (e) {
      console.error(e);
      json(res, 500, { error: { code: 'INTERNAL', message: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์' } });
    });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }
  if (req.headers['if-none-match'] === etag) { res.writeHead(304); return res.end(); }

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
    etag: etag,
    'cache-control': 'no-cache',
    'content-security-policy': [
      "default-src 'self'",
      "script-src 'unsafe-inline'",
      "style-src 'unsafe-inline' https://fonts.googleapis.com",
      "font-src https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(req.method === 'HEAD' ? undefined : html);
});

store.init()
  .then(function (on) {
    server.listen(PORT, '0.0.0.0', function () {
      console.log('Financii — พอร์ต ' + PORT + ' · เก็บข้อมูล: '
        + (on ? 'ฐานข้อมูลบนเซิร์ฟเวอร์ · รองรับหลายบริษัท' : 'เบราว์เซอร์ของผู้ใช้')
        + (PASSCODE ? ' · ต้องใส่รหัสผ่าน' : '') + (OWNER_PASSCODE ? ' · มีรหัสเจ้าของ' : '')
        + (INGEST_KEY ? ' · รับค่าแอดจากระบบอื่นได้' : ''));
      if (process.env.APP_OWNER_PASSCODE && !OWNER_PASSCODE) {
        console.warn('★ APP_OWNER_PASSCODE ซ้ำกับ APP_PASSCODE — ปิดสิทธิ์เจ้าของไว้ ตั้งรหัสเจ้าของให้ต่างจากรหัสร่วม');
      }
      if (on && !PASSCODE) {
        console.warn('★ ยังไม่ได้ตั้ง APP_PASSCODE — ใครที่รู้ URL จะอ่านและแก้ข้อมูลบัญชีได้ทั้งหมด');
      }
    });
  })
  .catch(function (e) {
    console.error('ต่อฐานข้อมูลไม่สำเร็จ: ' + e.message);
    console.error('ตรวจ DATABASE_URL ของบริการนี้ — จะเปิดเว็บให้ก่อนโดยเก็บข้อมูลในเบราว์เซอร์');
    server.listen(PORT, '0.0.0.0', function () {
      console.log('Financii — พอร์ต ' + PORT + ' · เก็บข้อมูล: เบราว์เซอร์ (ต่อฐานข้อมูลไม่ได้)');
    });
  });
