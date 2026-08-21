#!/usr/bin/env node
/* แปลงข้อมูลดิบ → แฟ้ม duly-import/1 ที่หน้า "นำเข้าข้อมูล" ของระบบอ่านได้
   ทุกรายการที่แปลงไม่ได้จะถูกเขียนลง errors.csv ไม่ถูกทิ้งเงียบ ๆ */
const fs = require('fs');
const path = require('path');
const core = require('./lib/core');
const map = require('./lib/map');

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : []);

function args() {
  const a = {};
  process.argv.slice(2).forEach(function (x, i, all) {
    if (x.startsWith('--')) a[x.slice(2)] = all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true;
  });
  return a;
}

function readTrialBalanceCsv(file) {
  const rows = core.parseCsv(fs.readFileSync(file, 'utf8'));
  const det = core.detectColumns(rows);
  if (!det.ok) {
    throw new Error('หาหัวตารางในไฟล์งบทดลองไม่เจอ ต้องมีคอลัมน์รหัสบัญชี ชื่อบัญชี เดบิต เครดิต\n'
      + 'ถ้าไฟล์เป็น .xlsx ให้เปิดใน Excel แล้ว Save As เป็น CSV ก่อน '
      + '(หน้า "นำเข้าข้อมูล" ในเว็บอ่าน .xlsx ได้โดยตรง)');
  }
  const tb = core.readTrialBalance(rows, det.map, det.headerRow);
  return {
    rows: tb.rows.map((r) => ({ code: r.code, name: r.name, debit: core.dec(r.debit), credit: core.dec(r.credit) })),
    skipped: tb.skipped,
    columns: det.map,
  };
}

function main() {
  const a = args();
  if (a.help || !a.cutoff) {
    console.log(`
แปลงข้อมูลดิบเป็นแฟ้มสำหรับนำเข้า

  node convert.js --raw out/raw --cutoff 2026-07-31 --tb งบทดลอง.csv --out out/duly-import.json

  --raw      โฟลเดอร์ข้อมูลดิบจาก pull.js (ค่าเริ่มต้น: out/raw)
  --cutoff   วันตัดยอด — เอกสารที่ค้างหลังวันนี้เท่านั้นที่ยกมา (จำเป็น)
  --tb       ไฟล์งบทดลอง CSV ณ วันตัดยอด (ไม่ใส่ก็ได้ ค่อยนำเข้าทีหลังในเว็บ)
  --out      ไฟล์ผลลัพธ์ (ค่าเริ่มต้น: out/duly-import.json)
`);
    process.exit(a.help ? 0 : 1);
  }
  const raw = a.raw || path.join('out', 'raw');
  const cutoff = String(a.cutoff);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) throw new Error('--cutoff ต้องเป็นรูปแบบ YYYY-MM-DD');
  const out = a.out || path.join('out', 'duly-import.json');

  const warnings = [];
  const errors = [];

  const partners = [];
  const seenPartner = new Set();
  readJson(path.join(raw, 'contacts.json')).forEach(function (c) {
    const r = map.mapContact(c);
    if (!r.partner.name) { errors.push({ kind:'contact', doc: r.partner.code, why:'ไม่มีชื่อคู่ค้า' }); return; }
    if (seenPartner.has(r.partner.code)) return;
    seenPartner.add(r.partner.code);
    partners.push(r.partner);
    warnings.push(...r.warnings);
  });

  const items = [];
  const seenItem = new Set();
  readJson(path.join(raw, 'products.json')).forEach(function (p) {
    const r = map.mapProduct(p);
    if (!r.item.name) { errors.push({ kind:'product', doc: r.item.code, why:'ไม่มีชื่อสินค้า' }); return; }
    if (seenItem.has(r.item.code)) return;
    seenItem.add(r.item.code);
    items.push(r.item);
  });

  function collect(files, kind) {
    const open = [];
    files.forEach(function (f) {
      readJson(path.join(raw, f + '.json')).forEach(function (d) {
        const r = map.mapDocument(d, kind);
        if (!r.ok) { errors.push({ kind: f, ...r.error }); return; }
        warnings.push(...r.warnings);
        if (map.isOpenAt(r.doc, cutoff)) open.push(r.doc);
      });
    });
    return open;
  }

  const openInvoices = collect(['tax-invoices', 'receivable-invoices'], 'invoice');
  const openBills = collect(['purchases', 'expenses'], 'bill');

  // คู่ค้าที่โผล่ในเอกสารแต่ไม่มีในทะเบียน ต้องสร้างให้ ไม่งั้นเอกสารยกมาไม่มีเจ้าของ
  [...openInvoices, ...openBills].forEach(function (d, i) {
    if (!d.partnerCode) d.partnerCode = 'FA-DOC-' + (i + 1);
    if (seenPartner.has(d.partnerCode)) return;
    seenPartner.add(d.partnerCode);
    partners.push({
      code: d.partnerCode, name: d.partnerName, taxId: d.taxId, branch: d.branch,
      address: d.address, entityType: 'juristic',
      kind: openInvoices.indexOf(d) >= 0 ? 'customer' : 'vendor', termDays: 0,
    });
    warnings.push({ doc: d.no, message: 'คู่ค้า "' + d.partnerName + '" ไม่มีในทะเบียนผู้ติดต่อ สร้างจากข้อมูลบนเอกสารให้' });
  });

  let trialBalance = [], tbInfo = null;
  if (a.tb && a.tb !== true) {
    const tb = readTrialBalanceCsv(a.tb);
    trialBalance = tb.rows;
    tbInfo = { file: a.tb, rows: tb.rows.length, skipped: tb.skipped.length };
    tb.skipped.forEach((sk) => warnings.push({ doc: 'งบทดลองแถว ' + sk.line, message: sk.why }));
  }

  const sumOpen = (arr) => arr.reduce((s, d) => s + core.M(d.total) - core.M(d.paid), 0);
  const pkg = {
    format: 'duly-import/1',
    source: 'flowaccount',
    cutoff,
    generatedAt: new Date().toISOString(),
    partners, items, openInvoices, openBills, trialBalance,
    warnings,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(pkg, null, 2));

  const errFile = path.join(path.dirname(out), 'errors.csv');
  fs.writeFileSync(errFile,
    '﻿ชุดข้อมูล,เอกสาร,เหตุผล\n'
    + errors.map((e) => [e.kind, e.doc, e.why].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n')
    + '\n');

  console.error('แฟ้มข้อมูล: ' + out);
  console.error('  คู่ค้า            ' + partners.length + ' ราย');
  console.error('  สินค้า            ' + items.length + ' รายการ');
  console.error('  ลูกหนี้ค้างยกมา   ' + openInvoices.length + ' ใบ  รวม ' + core.fmt(sumOpen(openInvoices)) + ' บาท');
  console.error('  เจ้าหนี้ค้างยกมา  ' + openBills.length + ' รายการ  รวม ' + core.fmt(sumOpen(openBills)) + ' บาท');
  console.error('  งบทดลอง          ' + (tbInfo ? tbInfo.rows + ' บัญชี จาก ' + tbInfo.file : 'ไม่ได้ใส่ — นำเข้าทีหลังในหน้าเว็บได้'));
  console.error('  ข้อสังเกต         ' + warnings.length + ' รายการ (อยู่ในแฟ้ม)');
  console.error('  แปลงไม่ได้        ' + errors.length + ' รายการ → ' + errFile);
  if (errors.length) console.error('\n★ ต้องตรวจ errors.csv ก่อนนำเข้า อย่าเพิ่งถือว่าย้ายครบ');
}

try { main(); } catch (e) { console.error('ล้มเหลว: ' + e.message); process.exit(1); }
