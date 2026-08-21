/* เสิร์ฟหน้าเว็บ และถ้ามีฐานข้อมูลก็เก็บสมุดบัญชีไว้บนเซิร์ฟเวอร์ให้ด้วย
   ไม่มีฐานข้อมูล = ทำงานเหมือนเดิมทุกอย่าง เก็บในเบราว์เซอร์ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');

const PORT = Number(process.env.PORT || 3000);
const PASSCODE = String(process.env.APP_PASSCODE || '');
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
function passOk(req) {
  if (!PASSCODE) return true;
  const raw = String(req.headers['x-passcode'] || '');
  const got = Buffer.from(raw, 'base64').toString('utf8');
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(PASSCODE).digest();
  return crypto.timingSafeEqual(a, b);
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

async function api(req, res, url) {
  if (url === '/api/config') {
    return json(res, 200, {
      storage: store.enabled() ? 'server' : 'browser',
      needsPasscode: Boolean(PASSCODE),
      book: store.BOOK,
    });
  }
  if (!store.enabled()) {
    return json(res, 404, { error: { code: 'NO_SERVER_STORAGE',
      message: 'บริการนี้ยังไม่ได้ต่อฐานข้อมูล ข้อมูลถูกเก็บในเบราว์เซอร์' } });
  }
  if (!passOk(req)) {
    return json(res, 401, { error: { code: 'PASSCODE_REQUIRED', message: 'รหัสผ่านไม่ถูกต้อง' } });
  }

  if (url === '/api/state' && req.method === 'GET') {
    const s = await store.read();
    return json(res, 200, { version: s.version, data: s.data, updatedAt: s.updatedAt });
  }
  if (url === '/api/state' && req.method === 'PUT') {
    let body;
    try { body = await readBody(req, 16 * 1024 * 1024); }
    catch (e) { return json(res, 413, { error: { code: e.code || 'BAD_BODY', message: e.message } }); }
    if (!body || typeof body !== 'object' || !body.data) {
      return json(res, 400, { error: { code: 'BAD_BODY', message: 'ต้องส่ง { version, data }' } });
    }
    try {
      const r = await store.write(body.version || 0, body.data);
      return json(res, 200, { version: r.version });
    } catch (e) {
      if (e.code === 'VERSION_CONFLICT') {
        const s = await store.read();
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
      ok: true, service: 'duly-webapp',
      storage: store.enabled() ? (db ? 'server' : 'server-unreachable') : 'browser',
    }));
  }
  if (url.startsWith('/api/')) {
    return api(req, res, url).catch(function (e) {
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
      console.log('ดุลย์ — พอร์ต ' + PORT + ' · เก็บข้อมูล: '
        + (on ? 'ฐานข้อมูลบนเซิร์ฟเวอร์ (สมุด ' + store.BOOK + ')' : 'เบราว์เซอร์ของผู้ใช้')
        + (PASSCODE ? ' · ต้องใส่รหัสผ่าน' : ''));
      if (on && !PASSCODE) {
        console.warn('★ ยังไม่ได้ตั้ง APP_PASSCODE — ใครที่รู้ URL จะอ่านและแก้ข้อมูลบัญชีได้ทั้งหมด');
      }
    });
  })
  .catch(function (e) {
    console.error('ต่อฐานข้อมูลไม่สำเร็จ: ' + e.message);
    console.error('ตรวจ DATABASE_URL ของบริการนี้ — จะเปิดเว็บให้ก่อนโดยเก็บข้อมูลในเบราว์เซอร์');
    server.listen(PORT, '0.0.0.0', function () {
      console.log('ดุลย์ — พอร์ต ' + PORT + ' · เก็บข้อมูล: เบราว์เซอร์ (ต่อฐานข้อมูลไม่ได้)');
    });
  });
