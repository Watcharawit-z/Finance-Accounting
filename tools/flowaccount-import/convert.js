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
  --ar-account  รหัสบัญชีคุมลูกหนี้ในงบทดลอง (ค่าเริ่มต้น: 1131 หรือหาจากชื่อ)
  --ap-account  รหัสบัญชีคุมเจ้าหนี้ในงบทดลอง (ค่าเริ่มต้น: 2121 หรือหาจากชื่อ)

ผลลัพธ์: duly-import.json + errors.csv (ใบที่แปลงไม่ได้) + coverage.csv (ทุกแถวไปอยู่ไหน)
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

  /* นับทุกแถวที่อ่านมา ว่าไปอยู่ไหนบ้าง เพื่อให้ตอบได้ว่า "ครบไหม" ด้วยตัวเลข ไม่ใช่ความรู้สึก */
  const coverage = [];
  const track = (source, row) => { coverage.push({ source, ...row }); };

  /**
   * เอกสารเดียวกันอาจโผล่ทั้งในใบแจ้งหนี้และใบกำกับภาษี ถ้ารวมทั้งสองรายการ
   * ยอดลูกหนี้จะถูกนับซ้ำสองเท่า จึงต้องตัดซ้ำด้วยเลขที่เอกสาร
   * โดยถือใบกำกับภาษีเป็นหลัก เพราะเป็นเอกสารที่กฎหมายรับรอง
   */
  function collect(files, kind) {
    const byNo = new Map();
    const stat = {};
    files.forEach(function (f) {
      const rows = readJson(path.join(raw, f + '.json'));
      let okN = 0, openN = 0, closedN = 0, errN = 0, dupN = 0, futureN = 0;
      let openSum = 0, closedSum = 0;
      rows.forEach(function (d) {
        const r = map.mapDocument(d, kind);
        if (!r.ok) { errors.push({ kind: f, ...r.error }); errN++; return; }
        okN++;
        warnings.push(...r.warnings);
        const doc = r.doc;
        if (doc.date > cutoff) { futureN++; return; }
        const outstanding = core.M(doc.total) - core.M(doc.paid);
        if (outstanding <= 0) { closedN++; closedSum += core.M(doc.total); return; }
        if (byNo.has(doc.no)) {
          dupN++;
          warnings.push({ doc: doc.no,
            message: 'เลขที่เอกสารนี้พบทั้งใน ' + byNo.get(doc.no).source + ' และ ' + f
              + ' — ยกมาใบเดียวเพื่อไม่ให้ยอดถูกนับซ้ำ' });
          return;
        }
        doc.source = f;
        byNo.set(doc.no, doc);
        openN++; openSum += outstanding;
      });
      stat[f] = { rows: rows.length, ok: okN, open: openN, closed: closedN,
        error: errN, duplicate: dupN, afterCutoff: futureN, openSum, closedSum };
      track(f, stat[f]);
    });
    return [...byNo.values()];
  }

  const openInvoices = collect(['tax-invoices', 'receivable-invoices'], 'invoice');
  const openBills = collect(['purchases', 'expenses'], 'bill');

  /* เอกสารที่ไม่ได้ยกมาเป็นยอดค้าง ก็ยังต้องนับให้เห็นว่าอ่านแล้ว ไม่ได้หายไปเฉย ๆ */
  ['receipts', 'cash-invoices', 'purchase-orders', 'debit-notes'].forEach(function (f) {
    const rows = readJson(path.join(raw, f + '.json'));
    if (!rows.length) return;
    track(f, { rows: rows.length, ok: rows.length, open: 0, closed: rows.length,
      error: 0, duplicate: 0, afterCutoff: 0, openSum: 0, closedSum: 0,
      note: 'เป็นเอกสารที่ปิดแล้วหรือไม่ก่อหนี้ค้าง ยอดรวมอยู่ในงบทดลองแล้ว' });
  });

  /* ใบลดหนี้ที่ออกก่อนวันตัดยอด ต้องหักออกจากใบกำกับที่ยังค้าง ไม่งั้นลูกหนี้เกินจริง */
  const cnRows = readJson(path.join(raw, 'credit-notes.json'));
  let cnApplied = 0, cnUnmatched = 0, cnSum = 0;
  cnRows.forEach(function (d) {
    const r = map.mapDocument(d, 'invoice');
    if (!r.ok) { errors.push({ kind: 'credit-notes', ...r.error }); return; }
    if (r.doc.date > cutoff) return;
    const refs = map.referencedSerials(d);
    const target = openInvoices.find((x) => refs.indexOf(x.no) >= 0);
    if (!target) {
      cnUnmatched++;
      warnings.push({ doc: r.doc.no,
        message: 'ใบลดหนี้นี้อ้างถึง ' + (refs.join(', ') || '(ไม่ระบุ)')
          + ' ซึ่งไม่อยู่ในใบที่ยังค้าง จึงไม่ได้หักออก — ยอดอยู่ในงบทดลองแล้ว' });
      return;
    }
    target.credited = core.dec(core.M(target.credited || '0') + core.M(r.doc.total));
    cnApplied++; cnSum += core.M(r.doc.total);
  });
  track('credit-notes', { rows: cnRows.length, ok: cnRows.length, open: cnApplied,
    closed: cnUnmatched, error: 0, duplicate: 0, afterCutoff: 0,
    openSum: -cnSum, closedSum: 0, note: 'หักออกจากใบกำกับที่ยังค้าง' });

  /* พนักงาน — เดิมดึงมาแล้วไม่ได้แปลงเข้าเลย ต้องมาก่อนทำเงินเดือนงวดแรก */
  const employees = [];
  const empRows = readJson(path.join(raw, 'employees.json'));
  const seenEmp = new Set();
  empRows.forEach(function (e) {
    const r = map.mapEmployee(e);
    if (seenEmp.has(r.employee.code)) return;
    seenEmp.add(r.employee.code);
    employees.push(r.employee);
    warnings.push(...r.warnings);
  });
  track('employees', { rows: empRows.length, ok: employees.length, open: employees.length,
    closed: 0, error: 0, duplicate: empRows.length - employees.length,
    afterCutoff: 0, openSum: 0, closedSum: 0 });

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

  const sumOpen = (arr) => arr.reduce((s, d) =>
    s + core.M(d.total) - core.M(d.paid) - core.M(d.credited || '0'), 0);
  const pkg = {
    format: 'duly-import/1',
    source: 'flowaccount',
    cutoff,
    generatedAt: new Date().toISOString(),
    partners, items, employees, openInvoices, openBills, trialBalance,
    coverage, warnings,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(pkg, null, 2));

  const errFile = path.join(path.dirname(out), 'errors.csv');
  fs.writeFileSync(errFile,
    '﻿ชุดข้อมูล,เอกสาร,เหตุผล\n'
    + errors.map((e) => [e.kind, e.doc, e.why].map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n')
    + '\n');

  /* ---- เทียบกับงบทดลอง ณ วันตัดยอด ----
     ถ้ายอดลูกหนี้รายใบไม่เท่าบัญชีคุม แปลว่ายกมาไม่ครบ ต้องรู้ตั้งแต่ตอนนี้
     ไม่ใช่ไปเจอตอนนำเข้าเสร็จแล้ว */
  const findTb = (codes, words) => trialBalance.find((r) =>
    codes.indexOf(String(r.code).trim()) >= 0
    || words.some((w) => String(r.name).indexOf(w) >= 0));
  const tie = [];
  if (trialBalance.length) {
    const arRow = findTb(String(a.arAccount || '1131').split(','), ['ลูกหนี้การค้า']);
    const apRow = findTb(String(a.apAccount || '2121').split(','), ['เจ้าหนี้การค้า']);
    const arTb = arRow ? core.M(arRow.debit) - core.M(arRow.credit) : null;
    const apTb = apRow ? core.M(apRow.credit) - core.M(apRow.debit) : null;
    if (arTb !== null) tie.push({ label: 'ลูกหนี้การค้า', book: arTb, sub: sumOpen(openInvoices), row: arRow });
    if (apTb !== null) tie.push({ label: 'เจ้าหนี้การค้า', book: apTb, sub: sumOpen(openBills), row: apRow });
  }

  const covFile = path.join(path.dirname(out), 'coverage.csv');
  fs.writeFileSync(covFile,
    '\ufeffชุดข้อมูล,อ่านได้,แปลงสำเร็จ,ยกมาเป็นยอดค้าง,ปิดแล้วไม่ยกมา,หลังวันตัดยอด,ซ้ำ,แปลงไม่ได้,ยอดค้างรวม,หมายเหตุ\n'
    + coverage.map((c) => [c.source, c.rows, c.ok, c.open, c.closed, c.afterCutoff,
        c.duplicate, c.error, core.dec(c.openSum || 0), c.note || '']
      .map((x) => '"' + String(x).replace(/"/g, '""') + '"').join(',')).join('\n') + '\n');

  console.error('แฟ้มข้อมูล: ' + out);
  console.error('  คู่ค้า            ' + partners.length + ' ราย');
  console.error('  สินค้า            ' + items.length + ' รายการ');
  console.error('  ลูกหนี้ค้างยกมา   ' + openInvoices.length + ' ใบ  รวม ' + core.fmt(sumOpen(openInvoices)) + ' บาท');
  console.error('  เจ้าหนี้ค้างยกมา  ' + openBills.length + ' รายการ  รวม ' + core.fmt(sumOpen(openBills)) + ' บาท');
  console.error('  งบทดลอง          ' + (tbInfo ? tbInfo.rows + ' บัญชี จาก ' + tbInfo.file : 'ไม่ได้ใส่ — นำเข้าทีหลังในหน้าเว็บได้'));
  console.error('  พนักงาน           ' + employees.length + ' คน');
  console.error('  ข้อสังเกต         ' + warnings.length + ' รายการ (อยู่ในแฟ้ม)');
  console.error('  แปลงไม่ได้        ' + errors.length + ' รายการ → ' + errFile);

  console.error('\nความครบถ้วนของแต่ละชุดข้อมูล → ' + covFile);
  console.error('  ' + 'ชุดข้อมูล'.padEnd(20) + 'อ่านได้'.padStart(8) + 'ยกมา'.padStart(8)
    + 'ปิดแล้ว'.padStart(9) + 'ซ้ำ'.padStart(6) + 'พลาด'.padStart(7));
  coverage.forEach(function (c) {
    console.error('  ' + c.source.padEnd(20) + String(c.rows).padStart(8) + String(c.open).padStart(8)
      + String(c.closed).padStart(9) + String(c.duplicate).padStart(6) + String(c.error).padStart(7));
  });

  if (tie.length) {
    console.error('\nเทียบกับงบทดลอง ณ ' + cutoff);
    let bad = 0;
    tie.forEach(function (t) {
      const diff = t.book - t.sub;
      if (diff !== 0) bad++;
      console.error('  ' + t.label.padEnd(18)
        + 'งบทดลอง ' + core.fmt(t.book).padStart(16)
        + '   รายใบรวม ' + core.fmt(t.sub).padStart(16)
        + '   ' + (diff === 0 ? 'ตรงกัน' : '★ ต่าง ' + core.fmt(diff)));
    });
    if (bad) {
      console.error('\n★ ยอดไม่ตรง แปลว่ายกมาไม่ครบหรือยอดชำระในระบบเดิมเป็นยอด ณ วันนี้ ไม่ใช่ ณ วันตัดยอด');
      console.error('  วิธีตรวจ: เปิดรายงานอายุลูกหนี้/เจ้าหนี้ของระบบเดิม ณ วันตัดยอด');
      console.error('  แล้วเทียบกับ coverage.csv ว่าใบไหนหายไป');
    }
  } else if (trialBalance.length) {
    console.error('\nหาบัญชีคุมลูกหนี้/เจ้าหนี้ในงบทดลองไม่เจอ ระบุเองด้วย --ar-account / --ap-account');
  }

  if (errors.length) console.error('\n★ ต้องตรวจ errors.csv ก่อนนำเข้า อย่าเพิ่งถือว่าย้ายครบ');
}

try { main(); } catch (e) { console.error('ล้มเหลว: ' + e.message); process.exit(1); }
