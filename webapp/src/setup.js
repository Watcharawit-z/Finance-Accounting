/* ===================================================================
   ตั้งค่าบริษัทให้พร้อมใช้งานจริง
   1) ผังบัญชี — เพิ่มบัญชี แก้ชื่อ เปลี่ยนหมวดบัญชีที่ยังไม่มีรายการ ตั้งบัญชีหลักของหมวด ลบบัญชีที่เพิ่มเองและยังไม่ได้ใช้
   2) ลูกหนี้/เจ้าหนี้ยกมารายใบ — ใบที่ยังค้างจากระบบเดิม รับชำระ/จ่ายชำระต่อในระบบได้ทันที
      แยกยอดจากที่ยกมารวม (ไม่ลงบัญชีซ้ำ) หรือลงบัญชีเป็นยอดยกมาใหม่ (Dr ลูกหนี้ / Cr บัญชีปรับปรุงยอดยกมา)
   =================================================================== */

/* ---------- ผังบัญชี ---------- */
const accountUsed = (code) => DB.entries.some((e) => e.lines.some((l) => l.acc === code));

function saveAccount(input) {
  const code = String(input.code || '').trim();
  const name = String(input.name || '').trim();
  if (!code) throw new DomainError('ACCOUNT_CODE_REQUIRED', 'ต้องกรอกรหัสบัญชี');
  if (!/^[0-9A-Za-z][0-9A-Za-z.\-]*$/.test(code)) {
    throw new DomainError('ACCOUNT_CODE_INVALID', 'รหัสบัญชีใช้ได้เฉพาะตัวเลข ตัวอักษรอังกฤษ จุด และขีด', 'เช่น 1112.02 หรือ 5321-01');
  }
  if (!name) throw new DomainError('ACCOUNT_NAME_REQUIRED', 'ต้องกรอกชื่อบัญชี');
  const ex = DB.accounts.find((a) => a.code === code);
  const sub = input.subType || (ex && ex.subType);
  const type = subTypeType(sub);
  if (!type) throw new DomainError('SUBTYPE_UNKNOWN', 'ไม่รู้จักหมวดบัญชี ' + sub, 'เลือกบรรทัดในงบการเงินที่บัญชีนี้ต้องไปแสดง');

  if (input.edit) {
    if (!ex) throw new DomainError('ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีรหัส ' + code);
    const before = { name: ex.name, subType: ex.subType, isDefault: !!ex.isDefault };
    if (sub !== ex.subType) {
      if (!ex.postable) throw new DomainError('ACCOUNT_HEADER', 'บัญชีหัวข้อเปลี่ยนหมวดไม่ได้');
      /* บัญชีที่มีรายการแล้วเปลี่ยนหมวด งบการเงินงวดที่ปิดไปแล้วจะเปลี่ยนตาม — ให้ตั้งบัญชีใหม่แล้วโอนยอดแทน */
      if (accountUsed(code)) {
        throw new DomainError('ACCOUNT_IN_USE', 'บัญชี ' + code + ' มีรายการแล้ว เปลี่ยนหมวดไม่ได้',
          'เพิ่มบัญชีใหม่ในหมวดที่ถูกต้อง แล้วโอนยอดด้วยใบสำคัญทั่วไป งบงวดที่ปิดแล้วจะได้ไม่เปลี่ยน');
      }
      if (DB.accounts.filter((a) => a.subType === ex.subType && a.postable).length === 1) {
        throw new DomainError('ACCOUNT_SOLE_OF_TYPE', 'บัญชี ' + code + ' เป็นบัญชีเดียวของหมวด "' + subTypeLabel(ex.subType) + '" ที่ระบบใช้ลงรายการ',
          'เพิ่มบัญชีใหม่ในหมวดที่ต้องการแทนการย้ายบัญชีนี้');
      }
      ex.subType = sub; ex.type = type;
      if (ex.isDefault) { delete ex.isDefault; delete ex.defaultFrom; }
    }
    ex.name = name;
    if (input.makeDefault && ex.postable) setDefaultAccount(ex);
    audit('account', code, 'update', before, { name: ex.name, subType: ex.subType, isDefault: !!ex.isDefault });
    return ex;
  }

  if (ex) throw new DomainError('ACCOUNT_CODE_DUPLICATE', 'รหัส ' + code + ' มีอยู่แล้วคือ ' + ex.name);
  const like = DB.accounts.find((a) => a.subType === sub && a.postable);
  /* เพิ่มบัญชีที่รหัสเรียงก่อนบัญชีเดิม ต้องไม่ทำให้เอกสารใหม่ย้ายไปลงบัญชีใหม่เงียบ ๆ — ตรึงบัญชีหลักเดิมไว้ก่อน */
  if (like && !input.makeDefault && !DB.accounts.some((x) => x.subType === sub && x.postable && x.isDefault)) like.isDefault = true;
  const a = { code, name, type, subType: sub, postable: true, requiresPartner: like ? !!like.requiresPartner : false,
    level: 3, custom: true };
  DB.accounts.push(a);
  DB.accounts.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
  if (input.makeDefault) setDefaultAccount(a);
  audit('account', code, 'create', null, { name, subType: sub });
  return a;
}
/* บัญชีหลักของหมวด = บัญชีที่เอกสารใหม่ลงอัตโนมัติ (เช่น บัญชีธนาคารหลัก) */
function setDefaultAccount(a) {
  DB.accounts.forEach(function (x) {
    if (x.subType === a.subType && x !== a && x.isDefault) { delete x.isDefault; delete x.defaultFrom; }
  });
  a.isDefault = true;
  delete a.defaultFrom;
}
function deleteAccount(code) {
  const a = DB.accounts.find((x) => x.code === code);
  if (!a) throw new DomainError('ACCOUNT_NOT_FOUND', 'ไม่พบบัญชีรหัส ' + code);
  if (!a.custom) throw new DomainError('ACCOUNT_BUILTIN', 'ลบได้เฉพาะบัญชีที่เพิ่มเอง', 'บัญชีมาตรฐานในผังที่ไม่ได้ใช้ ปล่อยไว้ได้ ไม่แสดงในงบเมื่อไม่มียอด');
  if (accountUsed(code)) throw new DomainError('ACCOUNT_IN_USE', 'บัญชี ' + code + ' มีรายการแล้ว ลบไม่ได้');
  /* สินค้าหรือคู่ค้าที่ตั้งบัญชีนี้เป็นค่าเริ่มต้น ลบแล้วเอกสารถัดไปจะลงบัญชีที่ไม่มีอยู่ */
  const refs = (x) => Object.keys(x).some((k) => /acc/i.test(k) && x[k] === code);
  if (DB.items.some(refs) || DB.partners.some(refs)) {
    throw new DomainError('ACCOUNT_IN_USE', 'บัญชี ' + code + ' ถูกตั้งเป็นบัญชีของสินค้าหรือคู่ค้าอยู่ ลบไม่ได้');
  }
  DB.accounts.splice(DB.accounts.indexOf(a), 1);
  audit('account', code, 'delete', { name: a.name, subType: a.subType }, null);
  return a;
}

/* ---------- ลูกหนี้/เจ้าหนี้ยกมารายใบ ---------- */
const OPEN_ITEM_KIND = {
  ar: { sub: 'trade_receivable', docs: 'invoice', partnerKind: 'customer', sign: 1, label: 'ลูกหนี้', doc: 'ใบกำกับ/ใบแจ้งหนี้' },
  ap: { sub: 'trade_payable', docs: 'bill', partnerKind: 'vendor', sign: -1, label: 'เจ้าหนี้', doc: 'ใบแจ้งหนี้ของผู้ขาย' },
};
ENTRY_FROM.openItems = ['ยอดยกมาลูกหนี้/เจ้าหนี้รายใบ', 'ไปที่หน้าลูกหนี้/เจ้าหนี้ยกมารายใบ แล้วกดยกเลิกชุดนั้น'];

/** ยอดบนบัญชีคุมที่ยังไม่ได้ระบุคู่ค้า (ยกมารวมจากระบบเดิม) แยกตามรหัสบัญชี — ด้านปกติเป็นบวก */
function openingUnassigned(kind, asOf) {
  const K = OPEN_ITEM_KIND[kind];
  const by = {};
  DB.entries.forEach(function (e) {
    if (!LIVE(e) || (asOf && e.date > asOf)) return;
    e.lines.forEach(function (l) {
      if (l.partner && l.partner !== 'OPENING') return;
      if (acc(l.acc).subType !== K.sub) return;
      by[l.acc] = (by[l.acc] || 0) + K.sign * (l.dr - l.cr);
    });
  });
  Object.keys(by).forEach((c) => { if (!by[c]) delete by[c]; });
  return by;
}
/** บัญชีคุมต่างจากใบค้างรายใบเท่าไร — ตัวเดียวกับที่รายการตรวจปิดงวดใช้ */
function openingItemsGap(kind, asOf) {
  const K = OPEN_ITEM_KIND[kind];
  const control = K.sign * balBySub([K.sub], asOf);
  const sub = DB.docs[K.docs].filter((d) => d.status !== 'draft' && d.status !== 'void' && d.date <= asOf)
    .reduce((s, d) => s + outstandingAsOf(kind, d, asOf), 0);
  return control - sub;
}

/**
 * input: { kind:'ar'|'ap', date: วันที่ยอดยกมา, mode:'allocate'|'post', account?: บัญชีคุมที่แยกยอด,
 *          rows:[{ partnerCode, docNo, docDate, due, amount }] }
 * allocate — ยอดรวมอยู่ในบัญชีแล้ว (นำเข้างบทดลอง) ย้ายจาก "ยอดยกมาจากระบบเดิม" ไปเป็นรายคู่ค้า ไม่ลงบัญชีซ้ำ
 * post     — ยังไม่มียอดในบัญชี ลงยอดยกมาใหม่คู่กับบัญชีปรับปรุงยอดยกมา
 */
function saveOpeningItems(input) {
  const kind = input.kind === 'ap' ? 'ap' : 'ar';
  const K = OPEN_ITEM_KIND[kind];
  const date = input.date;
  if (!date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ยอดยกมา');
  const mode = input.mode === 'post' ? 'post' : 'allocate';
  const list = DB.docs[K.docs];
  const seen = {};
  const rows = (input.rows || []).filter((r) => r && (r.docNo || r.partnerCode || r.amount)).map(function (r, i) {
    const n = 'บรรทัดที่ ' + (i + 1) + ': ';
    const p = DB.partners.find((x) => x.code === r.partnerCode);
    if (!p) throw new DomainError('PARTNER_NOT_FOUND', n + 'ไม่พบ' + (kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย') + ' ' + (r.partnerCode || ''));
    if (p.code === 'OPENING') throw new DomainError('PARTNER_NOT_FOUND', n + 'ต้องระบุคู่ค้าจริง');
    const legacy = String(r.docNo || '').trim();
    if (!legacy) throw new DomainError('DOC_NO_REQUIRED', n + 'ต้องระบุเลขที่เอกสารเดิม');
    const no = 'BF-' + legacy;
    if (seen[no] || list.some((d) => d.no === no && d.status !== 'void')) {
      throw new DomainError('OPEN_ITEM_DUPLICATE', n + 'เลขที่ ' + legacy + ' ยกมาแล้ว');
    }
    seen[no] = true;
    const amount = typeof r.amount === 'number' ? r.amount : M(String(r.amount || '').replace(/,/g, ''));
    if (!(amount > 0)) throw new DomainError('AMOUNT_INVALID', n + 'ยอดค้างต้องมากกว่าศูนย์');
    const docDate = r.docDate || date;
    if (docDate > date) throw new DomainError('OPEN_ITEM_DATE', n + 'วันที่เอกสาร ' + thDate(docDate) + ' อยู่หลังวันยอดยกมา');
    return { p, legacy, no, amount, docDate, due: r.due || docDate };
  });
  if (!rows.length) throw new DomainError('NO_ROWS', 'ยังไม่มีรายการ');
  const total = rows.reduce((s, r) => s + r.amount, 0);

  /* ลงบัญชีคู่กับคู่ค้าแต่ละราย — บัญชีย่อยรายลูกค้า/ผู้ขายและรายงานอายุหนี้ถูกตั้งแต่วันแรก */
  const byPartner = {};
  rows.forEach((r) => { byPartner[r.p.code] = (byPartner[r.p.code] || 0) + r.amount; });
  let control, other;
  if (mode === 'allocate') {
    const un = openingUnassigned(kind, date);
    control = input.account || Object.keys(un).sort((a, b) => un[b] - un[a])[0];
    const room = (control && un[control]) || 0;
    if (total > room) {
      throw new DomainError('OPEN_ITEM_EXCEEDS', 'ยอดค้างรายใบรวม ' + fmt(total) + ' บาท มากกว่ายอด' + K.label + 'ยกมาที่ยังไม่ได้แยกรายใบ ' + fmt(room) + ' บาท',
        room ? 'ตรวจยอดอีกครั้ง หรือเลือก "ลงบัญชีเป็นยอดยกมาใหม่" ถ้ายอดนี้ยังไม่อยู่ในบัญชี'
          : 'ยังไม่มียอด' + K.label + 'ยกมารวม — เลือก "ลงบัญชีเป็นยอดยกมาใหม่"');
    }
    other = { acc: control, partner: 'OPENING' };
  } else {
    control = accBySub(K.sub);
    other = { acc: ensureAccount('opening_balance', '3930', 'บัญชีปรับปรุงยอดยกมา', 'equity') };
  }
  const side = (v) => (K.sign * v > 0 ? { dr: Math.abs(v) } : { cr: Math.abs(v) });
  const lines = Object.keys(byPartner).map((pc) => Object.assign({ acc: control, partner: pc, memo: K.label + 'ยกมารายใบ' }, side(byPartner[pc])))
    .concat([Object.assign({ memo: mode === 'allocate' ? 'แยกจากยอดยกมารวม' : 'ยอดยกมา' }, other, side(-total))]);
  const batch = kind.toUpperCase() + '-BF-' + date + '-' + (DB.entries.filter((e) => e.src === 'openItems').length + 1);
  const je = post({ type: 'opening', date, desc: K.label + 'ยกมารายใบ ' + rows.length + ' ใบ ณ ' + thDate(date)
      + (mode === 'allocate' ? ' (แยกจากยอดยกมารวม)' : ''),
    src: 'openItems', srcId: batch, lines });

  rows.forEach(function (r) {
    const common = { no: r.no, legacyNo: r.legacy, date: r.docDate, due: r.due, partnerCode: r.p.code, partnerName: r.p.name,
      lines: [{ desc: 'ยอดค้างยกมาจากระบบเดิม', qty: 1, price: r.amount, amount: r.amount, taxCode: 'EXEMPT', uom: '', itemCode: null }],
      base: r.amount, vat: 0, total: r.amount, paid: 0, bfPaid: 0, status: 'issued', entryNo: je.no,
      broughtForward: true, obBatch: batch };
    const doc = kind === 'ar'
      ? Object.assign(common, { snap: { name: r.p.name, taxId: r.p.taxId || null, branch: r.p.branch || '00000', address: r.p.address || '' },
          credited: 0, etax: 'not_applicable' })
      : Object.assign(common, { vendorNo: r.legacy, claimable: true, whtCode: null });
    const at = list.findIndex((d) => d.no === r.no);
    if (at >= 0) list[at] = doc; else list.unshift(doc);
  });
  audit('openItems', batch, 'create', null, { kind, mode, count: rows.length, total: fmt(total) });
  return { batch, entry: je, count: rows.length, total, mode, account: control };
}

/** ยกเลิกทั้งชุด — ทำได้เมื่อยังไม่มีใบใดถูกรับ/จ่ายชำระหรือลดหนี้ */
function voidOpeningItems(batch, reason) {
  const e = DB.entries.find((x) => x.src === 'openItems' && x.srcId === batch && x.status === 'posted');
  if (!e) throw new DomainError('ENTRY_NOT_FOUND', 'ไม่พบชุดยอดยกมา ' + batch);
  const kind = batch.slice(0, 2).toLowerCase() === 'ap' ? 'ap' : 'ar';
  const docs = DB.docs[OPEN_ITEM_KIND[kind].docs].filter((d) => d.obBatch === batch && d.status !== 'void');
  const used = docs.filter((d) => (d.paid || 0) !== 0 || (d.credited || 0) !== 0 || (d.debited || 0) !== 0);
  if (used.length) {
    throw new DomainError('OPEN_ITEM_SETTLED', 'มีใบที่รับ/จ่ายชำระหรือลดหนี้แล้ว ' + used.map((d) => d.legacyNo).join(', '),
      'ยกเลิกใบเสร็จหรือใบสำคัญจ่ายของใบนั้นก่อน');
  }
  const rev = reverse(e.no, reason, null, { fromSource: true });
  docs.forEach((d) => { d.status = 'void'; d.voidReason = String(reason || '').trim(); });
  audit('openItems', batch, 'void', null, { count: docs.length }, reason);
  return rev;
}

/* ---------- อ่านไฟล์รายการลูกหนี้/เจ้าหนี้คงค้าง ---------- */
const OPEN_ITEM_HINTS = {
  partner: ['ชื่อลูกค้า', 'ชื่อผู้ขาย', 'ลูกค้า', 'ผู้ขาย', 'ชื่อ', 'customer', 'vendor', 'supplier', 'name', 'contact'],
  code: ['รหัสลูกค้า', 'รหัสผู้ขาย', 'รหัส', 'code'],
  taxId: ['เลขประจำตัวผู้เสียภาษี', 'เลขผู้เสียภาษี', 'tax id', 'taxid'],
  docNo: ['เลขที่เอกสาร', 'เลขที่ใบกำกับ', 'เลขที่', 'document', 'invoice', 'doc no', 'no.'],
  docDate: ['วันที่เอกสาร', 'วันที่', 'date'],
  due: ['ครบกำหนด', 'วันครบกำหนด', 'due'],
  amount: ['ยอดค้าง', 'คงค้าง', 'ค้างชำระ', 'outstanding', 'balance', 'ยอดเงิน', 'จำนวนเงิน', 'amount'],
};
function detectOpenItemColumns(header) {
  const norm = (s) => String(s || '').trim().toLowerCase();
  const cols = {};
  const taken = {};
  ['amount', 'due', 'docDate', 'docNo', 'taxId', 'code', 'partner'].forEach(function (k) {
    let best = -1, len = 0;
    header.forEach(function (h, i) {
      if (taken[i]) return;
      const n = norm(h);
      OPEN_ITEM_HINTS[k].forEach(function (w) { if (n.indexOf(w) >= 0 && w.length > len) { best = i; len = w.length; } });
    });
    if (best >= 0) { cols[k] = best; taken[best] = true; }
  });
  return cols;
}
/** ใช่ไฟล์ยอดค้างรายใบไหม — ต้องมีเลขที่เอกสาร ยอดค้าง และชื่อหรือรหัสคู่ค้า */
function looksLikeOpenItems(header) {
  const c = detectOpenItemColumns(header);
  return c.docNo !== undefined && c.amount !== undefined && (c.partner !== undefined || c.code !== undefined)
    && !header.some((h) => /เดบิต|debit|เครดิต|credit/i.test(String(h)));
}
/**
 * table: แถวแรกเป็นหัวตาราง · คืนแถวที่พร้อมส่งให้ saveOpeningItems + คู่ค้าที่จะสร้างใหม่ + แถวที่ข้าม
 * คู่ค้าจับคู่ด้วยรหัส เลขผู้เสียภาษี แล้วชื่อ ตามลำดับ
 */
function readOpenItemsFile(table, kind) {
  const K = OPEN_ITEM_KIND[kind === 'ap' ? 'ap' : 'ar'];
  const header = table[0] || [];
  const c = detectOpenItemColumns(header);
  if (c.docNo === undefined || c.amount === undefined || (c.partner === undefined && c.code === undefined)) {
    throw new DomainError('OPEN_ITEM_COLUMNS', 'ไม่พบคอลัมน์ที่ต้องใช้ (เลขที่เอกสาร ยอดค้าง และชื่อหรือรหัส' + (kind === 'ap' ? 'ผู้ขาย' : 'ลูกค้า') + ')');
  }
  const cell = (r, k) => (c[k] === undefined ? '' : String(r[c[k]] == null ? '' : r[c[k]]).trim());
  const rows = [], skipped = [], creating = [];
  table.slice(1).forEach(function (r, i) {
    const line = i + 2;
    const docNo = cell(r, 'docNo'), name = cell(r, 'partner'), code = cell(r, 'code');
    const taxId = cell(r, 'taxId').replace(/[^0-9]/g, '');
    if (!docNo && !name && !code) return;
    if (/รวม|total/i.test(docNo + ' ' + name) && !code) { skipped.push(line + ':บรรทัดผลรวม ข้ามอัตโนมัติ'); return; }
    let amount;
    try { amount = M(cell(r, 'amount').replace(/[,฿\s]/g, '').replace(/^\((.*)\)$/, '-$1')); }
    catch (e) { skipped.push(line + ':ยอดเงินอ่านไม่ได้'); return; }
    if (!amount) { skipped.push(line + ':ยอดเป็นศูนย์'); return; }
    if (amount < 0) { skipped.push(line + ':ยอดติดลบ (เงินรับล่วงหน้า/จ่ายเกิน) ให้บันทึกแยก'); return; }
    if (!docNo) { skipped.push(line + ':ไม่มีเลขที่เอกสาร'); return; }
    /* ผู้จำหน่ายและลูกค้า (kind both) จับคู่ได้ทั้งฝั่งลูกหนี้และเจ้าหนี้ */
    const role = K.partnerKind === 'vendor' ? isVendor : isCustomer;
    const p = DB.partners.find((x) => role(x) && code && x.code === code)
      || DB.partners.find((x) => role(x) && taxId && x.taxId === taxId)
      || DB.partners.find((x) => role(x) && name && x.name === name);
    const key = p ? p.code : (taxId || name || code);
    if (!p && !name) { skipped.push(line + ':ไม่พบคู่ค้ารหัส ' + code); return; }
    if (!p && !creating.some((x) => x.key === key)) creating.push({ key, name, taxId: taxId || null });
    rows.push({ line, partnerCode: p ? p.code : null, partnerKey: key, partnerName: p ? p.name : name, docNo,
      docDate: toIsoDate(cell(r, 'docDate')), due: toIsoDate(cell(r, 'due')), amount });
  });
  return { rows, skipped, creating, total: rows.reduce((s, r) => s + r.amount, 0), columns: c };
}
/* วันที่ในไฟล์: 2026-01-31 · 31/01/2026 · 31/01/2569 (พ.ศ.) */
function toIsoDate(s) {
  s = String(s || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  if (y > 2400) y -= 543;
  return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
}
/** นำเข้าจากไฟล์ทั้งชุด — สร้างคู่ค้าที่ยังไม่มีแล้วตั้งยอดค้างรายใบในคราวเดียว ไม่สำเร็จก็ไม่เหลืออะไรค้าง */
function importOpeningItems(read, kind, date, mode) {
  const K = OPEN_ITEM_KIND[kind === 'ap' ? 'ap' : 'ar'];
  const made = {};
  read.creating.forEach(function (c) {
    const r = savePartner({ kind: K.partnerKind, name: c.name, taxId: c.taxId || undefined });
    made[c.key] = r.partner.code;
  });
  return saveOpeningItems({ kind, date, mode,
    rows: read.rows.map((r) => ({ partnerCode: r.partnerCode || made[r.partnerKey], docNo: r.docNo,
      docDate: r.docDate && r.docDate <= date ? r.docDate : date, due: r.due, amount: r.amount })) });
}

saveAccount = transactional(saveAccount);
deleteAccount = transactional(deleteAccount);
saveOpeningItems = transactional(saveOpeningItems);
voidOpeningItems = transactional(voidOpeningItems);
importOpeningItems = transactional(importOpeningItems);
