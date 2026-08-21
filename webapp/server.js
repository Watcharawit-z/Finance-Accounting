/* เสิร์ฟไฟล์เดียว — ไม่มี dependency ใด ๆ ใช้เฉพาะสิ่งที่ Node มีมาให้ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
const FILE = path.join(__dirname, 'index.html');
const html = fs.readFileSync(FILE);
const etag = '"' + require('crypto').createHash('sha1').update(html).digest('hex').slice(0, 16) + '"';

const server = http.createServer(function (req, res) {
  const url = (req.url || '/').split('?')[0];

  if (url === '/health' || url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'duly-webapp' }));
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    return res.end();
  }
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304);
    return res.end();
  }
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': html.length,
    etag: etag,
    'cache-control': 'no-cache',
    /* หน้านี้ไม่โหลดสคริปต์จากที่อื่นเลย ปิดประตูไว้ให้แน่น
       เว้นแต่ฟอนต์จาก Google Fonts ที่หน้าเว็บใช้ */
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

server.listen(PORT, '0.0.0.0', function () {
  console.log('ดุลย์ — เสิร์ฟที่พอร์ต ' + PORT);
});
