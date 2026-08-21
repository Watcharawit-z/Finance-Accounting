#!/usr/bin/env node
/* ดึงข้อมูลดิบจาก FlowAccount Open API เก็บลงดิสก์ก่อน ยังไม่แปลงอะไร
   แยกขั้นตอนไว้เพื่อให้แปลงซ้ำได้โดยไม่ต้องยิง API ใหม่ */
const fs = require('fs');
const path = require('path');
const { withDefaults, getToken, listAll } = require('./lib/client');

const RESOURCES = [
  ['contacts',           '/api/{culture}/contacts',        false],
  ['products',           '/{culture}/Products',            false],
  ['employees',          '/Employee',                      false],
  ['tax-invoices',       '/{culture}/tax-invoices',        true],
  ['receivable-invoices','/{culture}/receivable-invoices', true],
  ['receipts',           '/{culture}/receipts',            true],
  ['cash-invoices',      '/{culture}/cash-invoices',       true],
  ['credit-notes',       '/{culture}/credit-notes',        true],
  ['debit-notes',        '/{culture}/debit-notes',         true],
  ['purchases',          '/{culture}/purchases',           true],
  ['expenses',           '/{culture}/expenses',            true],
];

function args() {
  const a = {};
  process.argv.slice(2).forEach(function (x, i, all) {
    if (x.startsWith('--')) a[x.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
  });
  return a;
}

async function main() {
  const a = args();
  if (a.help || !a.config) {
    console.log(`
ดึงข้อมูลจาก FlowAccount

  node pull.js --config config.json --from 2026-01-01 --to 2026-07-31 --out out/raw

  --config   ไฟล์ตั้งค่า (ดูตัวอย่างที่ config.example.json)
  --from     วันเริ่มต้นของเอกสารที่จะดึง (ค่าเริ่มต้น: ต้นปีปัจจุบัน)
  --to       วันสิ้นสุด (ค่าเริ่มต้น: วันนี้)
  --out      โฟลเดอร์ปลายทาง (ค่าเริ่มต้น: out/raw)
  --only     ดึงเฉพาะบางชุด คั่นด้วยจุลภาค เช่น contacts,products
`);
    process.exit(a.help ? 0 : 1);
  }
  const cfg = withDefaults(JSON.parse(fs.readFileSync(a.config, 'utf8')));
  if (!cfg.clientId || !cfg.clientSecret) {
    throw new Error('ไฟล์ตั้งค่าต้องมี clientId และ clientSecret จาก MyCompany → connection');
  }
  const today = new Date().toISOString().slice(0, 10);
  const from = a.from || today.slice(0, 4) + '-01-01';
  const to = a.to || today;
  const outDir = a.out || path.join('out', 'raw');
  fs.mkdirSync(outDir, { recursive: true });

  console.error('เซิร์ฟเวอร์: ' + cfg.baseUrl);
  const token = await getToken(cfg);
  console.error('ขอ token สำเร็จ\n');

  const only = a.only === true ? null : (a.only ? String(a.only).split(',') : null);
  const summary = {};
  for (const [name, pathTpl, dated] of RESOURCES) {
    if (only && only.indexOf(name) < 0) continue;
    console.error(name + ':');
    const params = dated ? { StartDate: from, EndDate: to } : {};
    try {
      const rows = await listAll(cfg, token, pathTpl, params, name);
      fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(rows, null, 2));
      summary[name] = rows.length;
    } catch (e) {
      console.error('  ข้าม ' + name + ': ' + e.message.split('\n')[0]);
      summary[name] = 'ผิดพลาด';
    }
  }
  fs.writeFileSync(path.join(outDir, '_meta.json'),
    JSON.stringify({ pulledAt: new Date().toISOString(), from, to, baseUrl: cfg.baseUrl, summary }, null, 2));

  console.error('\nสรุป');
  Object.keys(summary).forEach((k) => console.error('  ' + k.padEnd(22) + summary[k]));
  console.error('\nเก็บไว้ที่ ' + outDir + ' — ขั้นถัดไป: node convert.js --raw ' + outDir + ' --cutoff ' + to);
}

main().catch(function (e) { console.error('\nล้มเหลว: ' + e.message); process.exit(1); });
