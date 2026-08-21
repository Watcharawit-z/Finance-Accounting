/* เสิร์ฟไฟล์ที่ build แล้ว และส่งต่อคำขอ /api ไปยังบริการ API
   ให้หน้าเว็บกับ API อยู่โดเมนเดียวกัน จะได้ไม่ต้องเปิด CORS ให้กว้าง
   ใช้เฉพาะโมดูลที่ Node มีมาให้ ไม่มี dependency */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const DIST = path.join(__dirname, 'dist');
const API = process.env.API_URL || '';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

function serveFile(res, file, immutable) {
  const body = fs.readFileSync(file);
  res.writeHead(200, {
    'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function proxy(req, res) {
  if (!API) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: { code: 'API_URL_NOT_SET',
      message: 'ยังไม่ได้ตั้งตัวแปร API_URL ให้ชี้ไปที่บริการ API' } }));
  }
  const target = new URL(req.url, API);
  const up = http.request(target, {
    method: req.method,
    headers: { ...req.headers, host: target.host },
  }, function (r) {
    res.writeHead(r.statusCode || 502, r.headers);
    r.pipe(res);
  });
  up.on('error', function (e) {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code: 'API_UNREACHABLE', message: 'ติดต่อบริการ API ไม่ได้: ' + e.message } }));
  });
  req.pipe(up);
}

http.createServer(function (req, res) {
  const url = (req.url || '/').split('?')[0];
  if (url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'duly-web', api: API ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้ง' }));
  }
  if (url.startsWith('/api/')) return proxy(req, res);

  /* กันการไต่ path ออกนอกโฟลเดอร์ dist */
  const rel = path.normalize(decodeURIComponent(url)).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(DIST, rel);
  if (file.startsWith(DIST) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    return serveFile(res, file, rel.startsWith('/assets/') || rel.startsWith('assets/'));
  }
  const index = path.join(DIST, 'index.html');
  if (!fs.existsSync(index)) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('ยังไม่ได้ build — สั่ง npm run build ก่อน');
  }
  serveFile(res, index, false);       // เส้นทางอื่นตกมาที่หน้าเดียว ให้ลิงก์ตรงใช้งานได้
}).listen(PORT, '0.0.0.0', function () {
  console.log('ดุลย์ web — พอร์ต ' + PORT + (API ? ' · ส่งต่อ /api ไปที่ ' + API : ' · ยังไม่ได้ตั้ง API_URL'));
});
