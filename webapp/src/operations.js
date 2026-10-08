/* ===================================================================
   ธุรกรรมทางธุรกิจ — ทุกตัวจบใน "หนึ่งชุด" เหมือน transaction เดียว
   ถ้าขั้นตอนใดล้มเหลว ต้องไม่มีอะไรค้างครึ่ง ๆ กลาง ๆ
   =================================================================== */

function partnerByCode(code) {
  const p = DB.partners.find((x) => x.code === code);
  if (!p) throw new DomainError('PARTNER_NOT_FOUND', 'ไม่พบคู่ค้ารหัส ' + code);
  return p;
}

function snapshotPartner(p) {
  return {
    code: p.code, name: p.name, taxId: p.taxId, branch: p.branch,
    entityType: p.entityType, address: p.address, capturedAt: new Date().toISOString(),
  };
}

/* ---------- คำนวณ VAT ระดับเอกสาร (ปัดเศษครั้งเดียว) ---------- */
function computeVat(lines, date) {
  let std = 0, zero = 0, exempt = 0, rateUsed = '0';
  lines.forEach(function (l) {
    const amt = round2(mulQty(M(l.price), l.qty));
    const code = l.taxCode || 'VAT7';
    if (code === 'VAT7') { std += amt; rateUsed = resolveRate('VAT7', date).rate; }
    else if (code === 'VAT0') zero += amt;
    else exempt += amt;
  });
  const vat = round2(pct(std, rateUsed));
  return { std, zero, exempt, vat, total: std + zero + exempt + vat, rate: rateUsed };
}

/* ---------- ตรวจตาม ม.86/4 ก่อนออกเลข ---------- */
function assertTaxInvoiceComplete(snap, lines) {
  const missing = [];
  if (!snap.name) missing.push('ชื่อผู้ซื้อ');
  if (!snap.address) missing.push('ที่อยู่ผู้ซื้อ');
  if (!snap.branch) missing.push('สำนักงานใหญ่หรือสาขาของผู้ซื้อ');
  if (!snap.taxId) missing.push('เลขประจำตัวผู้เสียภาษีของผู้ซื้อ');
  else if (!validTaxId(snap.taxId)) {
    throw new DomainError('TAX_ID_INVALID',
      'เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (' + snap.taxId + ') ไม่ผ่านการตรวจสอบหลักที่ 13',
      'ตรวจสอบเลขกับหนังสือรับรองของลูกค้า');
  }
  if (!lines.length) missing.push('รายการสินค้าหรือบริการ');
  lines.forEach(function (l, i) {
    if (!String(l.desc || '').trim()) missing.push('คำบรรยายบรรทัดที่ ' + (i + 1));
  });
  if (missing.length) {
    throw new DomainError('TAX_INVOICE_INCOMPLETE',
      'ออกใบกำกับภาษีไม่ได้เพราะข้อมูลไม่ครบตามมาตรา 86/4: ' + missing.join(', '),
      'แก้ไขข้อมูลให้ครบแล้วลองใหม่');
  }
}

/* ---------- สถานะใบกำกับ คิดจากยอดคงค้างเสมอ ----------
   ใบเพิ่มหนี้ทำให้ใบที่ชำระครบแล้วกลับมาค้างได้ ถ้าเขียนเงื่อนไขกระจายตามที่ต่าง ๆ
   จะมีที่ที่ลืมอัปเดตแล้วสถานะค้างเป็น "ชำระครบ" ทั้งที่ยังค้างเงินอยู่ */
function syncInvStatus(inv) {
  if (inv.status === 'void' || inv.status === 'draft') return;
  const out = invOutstanding(inv);
  /* ลดหนี้หลังรับเงินครบ ลูกค้ามีเครดิตเกิน — ต้องคืนเงินหรือหักกับใบถัดไป */
  if (out < 0) inv.status = 'credit_balance';
  else if (out === 0) inv.status = 'paid';
  else if (inv.paid > 0 || inv.credited > 0) inv.status = 'partially_paid';
  else inv.status = 'issued';
}

/* ===================================================================
   ทะเบียนต่าง ๆ — เพิ่มและแก้ไขด้วยมือ
   เดิมทะเบียนคู่ค้า สินค้า พนักงาน และทรัพย์สิน เข้ามาได้ทางเดียวคือการนำเข้า
   พอเจอผู้ขายรายใหม่ระหว่างทำงานจริงจึงบันทึกอะไรไม่ได้เลย ต้องเพิ่มเองได้
   =================================================================== */
function nextRegCode(prefix, list) {
  let n = 0;
  const re = new RegExp('^' + prefix + '-(\\d+)$');
  list.forEach(function (x) {
    const m = String(x.code || '').match(re);
    if (m) n = Math.max(n, Number(m[1]));
  });
  return prefix + '-' + String(n + 1).padStart(4, '0');
}

function assertBranch(branch, entityType) {
  if (entityType === 'individual') return null;
  const b = String(branch === undefined || branch === null ? '00000' : branch).trim() || '00000';
  if (!/^\d{5}$/.test(b)) {
    throw new DomainError('BRANCH_INVALID',
      'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่คือ 00000)',
      'ดูจากหน้าใบกำกับภาษีของคู่ค้า');
  }
  return b;
}

/** เพิ่มหรือแก้ไขลูกค้า/ผู้ขาย — ใช้ทั้งตอนสร้างใหม่และตอนแก้ */
function savePartner(input) {
  const kind = input.kind === 'vendor' ? 'vendor' : 'customer';
  const label = kind === 'vendor' ? 'ผู้ขาย' : 'ลูกค้า';
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('PARTNER_NAME_REQUIRED', 'ต้องกรอกชื่อ' + label);

  const entityType = input.entityType === 'individual' ? 'individual' : 'juristic';
  const taxId = String(input.taxId || '').replace(/[^0-9]/g, '');
  if (taxId && !validTaxId(taxId)) {
    throw new DomainError('TAX_ID_INVALID',
      'เลขประจำตัวผู้เสียภาษี ' + taxId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ตรวจเลขกับหน้าใบกำกับภาษีของคู่ค้าอีกครั้ง หรือเว้นว่างไว้ก่อน');
  }
  const branch = assertBranch(input.branch, entityType);
  const existing = input.code ? DB.partners.find((x) => x.code === input.code) : null;
  if (input.code && !existing) {
    throw new DomainError('PARTNER_NOT_FOUND', 'ไม่พบคู่ค้ารหัส ' + input.code);
  }
  /* กันสร้างคู่ค้าซ้ำด้วยเลขผู้เสียภาษีเดียวกัน เป็นความผิดพลาดที่เจอบ่อยที่สุด
     เพราะทำให้ยอดค้างของรายเดียวกันแตกเป็นสองราย แล้วกระทบยอดไม่ได้ */
  if (taxId) {
    const dup = DB.partners.find((x) => x.taxId === taxId && (x.branch || '00000') === (branch || '00000')
      && x.kind === kind && (!existing || x.code !== existing.code));
    if (dup) {
      throw new DomainError('PARTNER_DUPLICATE_TAX_ID',
        label + 'เลขผู้เสียภาษี ' + taxId + ' สาขา ' + (branch || '—') + ' มีอยู่แล้วคือ '
          + dup.code + ' ' + dup.name,
        'ถ้าเป็นรายเดียวกันให้แก้ไขรายเดิมแทนการสร้างใหม่');
    }
  }
  const rec = {
    code: existing ? existing.code : nextRegCode(kind === 'vendor' ? 'VEN' : 'CUS', DB.partners),
    name: name, taxId: taxId || null, branch: branch,
    entityType: entityType, kind: kind,
    address: String(input.address || '').trim(),
    phone: String(input.phone || '').trim(),
    termDays: Math.max(0, Number(input.termDays || 0) || 0),
    whtCode: kind === 'vendor' ? (input.whtCode || null) : null,
    creditLimit: M(input.creditLimit || '0'),
    active: input.active !== false,
  };
  if (existing) {
    const before = { name: existing.name, taxId: existing.taxId, branch: existing.branch };
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('partner', rec.code, 'update', before, { name: rec.name, taxId: rec.taxId, branch: rec.branch });
    return { partner: existing, created: false };
  }
  DB.partners.push(rec);
  audit('partner', rec.code, 'create', null, { name: rec.name, taxId: rec.taxId, kind: kind });
  return { partner: rec, created: true };
}

/** เพิ่มหรือแก้ไขสินค้า/บริการ — จำนวนคงเหลือแก้ตรงนี้ไม่ได้ ต้องมาจากเอกสาร */
function saveItem(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('ITEM_NAME_REQUIRED', 'ต้องกรอกชื่อสินค้าหรือบริการ');
  const type = input.type === 'service' ? 'service' : 'stock';
  const existing = input.code ? DB.items.find((x) => x.code === input.code) : null;
  if (input.code && !existing) throw new DomainError('ITEM_NOT_FOUND', 'ไม่พบสินค้ารหัส ' + input.code);

  const code = existing ? existing.code : (String(input.newCode || '').trim() || nextRegCode('IT', DB.items));
  if (!existing && DB.items.find((x) => x.code === code)) {
    throw new DomainError('ITEM_CODE_DUPLICATE', 'รหัสสินค้า ' + code + ' มีอยู่แล้ว');
  }
  /* เปลี่ยนจากสินค้าเป็นบริการทั้งที่ยังมีของในสต๊อก จะทำให้มูลค่าสินค้าคงเหลือหายจากงบ */
  if (existing && existing.type === 'stock' && type === 'service' && existing.qty !== 0) {
    throw new DomainError('ITEM_STILL_IN_STOCK',
      'สินค้านี้ยังมีคงเหลือ ' + existing.qty + ' ' + existing.uom + ' เปลี่ยนเป็นบริการไม่ได้',
      'ตัดสต๊อกให้เป็นศูนย์ก่อน');
  }
  const rec = {
    code: code, name: name, type: type,
    category: String(input.category || '').trim() || 'ทั่วไป',
    uom: String(input.uom || '').trim() || (type === 'service' ? 'งาน' : 'หน่วย'),
    price: M(input.price || '0'),
    reorder: Math.max(0, Number(input.reorder || 0) || 0),
    qty: existing ? existing.qty : 0,
    avgCost: existing ? existing.avgCost : 0,
    value: existing ? existing.value : 0,
  };
  if (existing) {
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('item', code, 'update', null, { name: rec.name, price: fmt(rec.price) });
    return { item: existing, created: false };
  }
  DB.items.push(rec);
  audit('item', code, 'create', null, { name: rec.name, type: type });
  return { item: rec, created: true };
}

/** เพิ่มหรือแก้ไขพนักงาน — ต้องมีก่อนทำเงินเดือนงวดแรก */
function saveEmployee(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('EMPLOYEE_NAME_REQUIRED', 'ต้องกรอกชื่อพนักงาน');
  const nationalId = String(input.nationalId || '').replace(/[^0-9]/g, '');
  if (nationalId && !validTaxId(nationalId)) {
    throw new DomainError('NATIONAL_ID_INVALID',
      'เลขประจำตัวประชาชน ' + nationalId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ใช้ตรวจตอนยื่น ภ.ง.ด.1 และขึ้นทะเบียนประกันสังคม');
  }
  const salary = M(input.salary || '0');
  if (salary < 0) throw new DomainError('SALARY_NEGATIVE', 'เงินเดือนติดลบไม่ได้');
  const pvdRate = Number(input.pvdRate || 0) || 0;
  if (pvdRate < 0 || pvdRate > 15) {
    throw new DomainError('PVD_RATE_RANGE',
      'อัตราสะสมกองทุนสำรองเลี้ยงชีพต้องอยู่ระหว่าง 0 ถึง 15 เปอร์เซ็นต์');
  }
  const existing = input.code ? DB.employees.find((x) => x.code === input.code) : null;
  if (input.code && !existing) throw new DomainError('EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานรหัส ' + input.code);

  const rec = {
    code: existing ? existing.code : nextRegCode('EMP', DB.employees),
    name: name, dept: String(input.dept || '').trim() || 'ไม่ระบุ',
    salary: salary, otHours: Math.max(0, Number(input.otHours || 0) || 0),
    pvdRate: pvdRate, deductions: M(input.deductions || '0'),
    nationalId: nationalId || null,
    ssoNumber: String(input.ssoNumber || '').trim() || null,
    hired: input.hired || null,
    active: input.active !== false,
  };
  if (existing) {
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('employee', rec.code, 'update', null, { name: rec.name, salary: fmt(rec.salary) });
    return { employee: existing, created: false };
  }
  DB.employees.push(rec);
  audit('employee', rec.code, 'create', null, { name: rec.name, dept: rec.dept });
  return { employee: rec, created: true };
}

/** เพิ่มหรือแก้ไขทรัพย์สินถาวร — ที่คิดค่าเสื่อมไปแล้วห้ามแก้ราคาทุนกับวันที่ */
function saveAsset(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('ASSET_NAME_REQUIRED', 'ต้องกรอกชื่อทรัพย์สิน');
  const cls = String(input.class || '').trim();
  if (!TAX_DEPRECIATION[cls]) {
    throw new DomainError('ASSET_CLASS_INVALID',
      'ประเภททรัพย์สินไม่ถูกต้อง ต้องเลือกจากรายการที่กฎหมายกำหนด (พ.ร.ฎ.145)');
  }
  const inService = String(input.inService || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inService)) {
    throw new DomainError('ASSET_DATE_REQUIRED', 'ต้องระบุวันที่เริ่มใช้งานทรัพย์สิน');
  }
  const cost = M(input.cost || '0');
  if (cost <= 0) throw new DomainError('ASSET_COST_REQUIRED', 'ราคาทุนต้องมากกว่าศูนย์');
  const bookYears = Number(input.bookYears || 0) || 0;
  if (cls !== 'LAND' && (bookYears < 1 || bookYears > 50)) {
    throw new DomainError('ASSET_LIFE_RANGE', 'อายุการใช้งานทางบัญชีต้องอยู่ระหว่าง 1 ถึง 50 ปี');
  }
  const existing = input.code ? DB.assets.find((x) => x.code === input.code) : null;
  if (input.code && !existing) throw new DomainError('ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินรหัส ' + input.code);

  const depreciated = existing && DB.docs.depreciation
    .some((d) => d.status !== 'void' && (d.rows || []).some((r) => r.code === existing.code));
  if (depreciated && (cost !== existing.cost || inService !== existing.inService || cls !== existing.class)) {
    throw new DomainError('ASSET_ALREADY_DEPRECIATED',
      'ทรัพย์สินนี้คิดค่าเสื่อมไปแล้ว แก้ราคาทุน วันที่เริ่มใช้ หรือประเภทไม่ได้',
      'ถ้าคีย์ผิดตั้งแต่แรก ให้กลับรายการค่าเสื่อมของงวดที่เกี่ยวข้องก่อน');
  }
  const accumBook = M(input.accumBook || '0');
  const accumTax = M(input.accumTax || '0');
  if (accumBook > cost) {
    throw new DomainError('ACCUM_EXCEEDS_COST',
      'ค่าเสื่อมสะสมทางบัญชี ' + fmt(accumBook) + ' เกินราคาทุน ' + fmt(cost));
  }
  const rec = {
    code: existing ? existing.code : nextRegCode('FA', DB.assets),
    name: name, class: cls, inService: inService, cost: cost,
    bookYears: cls === 'LAND' ? 0 : bookYears,
    accumBook: accumBook, accumTax: accumTax,
    status: input.status === 'disposed' ? 'disposed' : 'in_use',
  };
  if (existing) {
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('asset', rec.code, 'update', null, { name: rec.name, cost: fmt(rec.cost) });
    return { asset: existing, created: false };
  }
  DB.assets.push(rec);
  audit('asset', rec.code, 'create', null, { name: rec.name, class: cls, cost: fmt(cost) });
  return { asset: rec, created: true };
}

/* ---------- ขาย: ออกใบกำกับภาษี ---------- */
function issueInvoice(input) {
  const p = partnerByCode(input.partnerCode);
  const snap = snapshotPartner(p);
  const lines = input.lines.filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  assertTaxInvoiceComplete(snap, lines);

  const v = computeVat(lines, input.date);
  assertStockAvailable(lines);
  const no = nextNo('invoice', input.date);
  const due = addDays(input.date, p.termDays || 0);

  const revLines = {};
  lines.forEach(function (l) {
    const a = accBySub(l.revenueSub || 'sales_revenue');
    revLines[a] = (revLines[a] || 0) + round2(mulQty(M(l.price), l.qty));
  });

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ขายสินค้า/บริการ ' + snap.name + ' (' + no + ')',
    src: 'invoice', srcId: no,
    lines: [
      { acc: accBySub('trade_receivable'), dr: v.total, partner: p.code },
    ].concat(Object.keys(revLines).map((a) => ({ acc: a, cr: revLines[a] })))
     .concat(v.vat ? [{ acc: accBySub('output_vat'), cr: v.vat }] : []),
  });

  // ตัดต้นทุนขายถ้าเป็นสินค้า
  let cogs = 0;
  lines.forEach(function (l) {
    if (!l.itemCode) return;
    const it = DB.items.find((x) => x.code === l.itemCode);
    if (!it || it.type !== 'stock') return;
    const q = roundQty(l.qty);
    /* ชิ้นสุดท้ายรับมูลค่าที่เหลือทั้งหมด — ของหมดคลังแล้วมูลค่าต้องเป็นศูนย์ ไม่เหลือเศษสตางค์ค้าง */
    const c = q === it.qty ? it.value : round2(mulQty(it.avgCost, q));
    cogs += c;
    it.qty = roundQty(it.qty - q);
    it.value -= c;
    DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'out', qty: q, cost: c, src: no, balance: it.qty });
  });
  let cogsJe = null;
  if (cogs > 0) {
    cogsJe = post({
      type: 'inventory', date: input.date, desc: 'ตัดต้นทุนขาย ' + no,
      src: 'invoice', srcId: no,
      lines: [{ acc: accBySub('cogs'), dr: cogs }, { acc: accBySub('inventory'), cr: cogs }],
    });
  }

  DB.taxTx.push({
    kind: 'vat_output', period: periodOf(input.date), date: input.date,
    docNo: no, docType: 'tax_invoice',
    partnerName: snap.name, taxId: snap.taxId, branch: snap.branch,
    base: v.std, zero: v.zero, exempt: v.exempt, tax: v.vat,
    entryNo: je.no, filingId: null,
  });

  const doc = {
    no, date: input.date, due, partnerCode: p.code, partnerName: snap.name,
    snap, lines: lines.map((l) => ({
      desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
      taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null,
      amount: round2(mulQty(M(l.price), l.qty)),
    })),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    paid: 0, credited: 0, status: 'issued',
    entryNo: je.no, cogsEntryNo: cogsJe ? cogsJe.no : null,
    etax: 'accepted',
  };
  DB.docs.invoice.unshift(doc);
  audit('invoice', no, 'issue', null, { total: fmt(v.total), partner: snap.name });
  return doc;
}

/* ---------- ขาย: รับชำระเงิน ---------- */
function receivePayment(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + input.invoiceNo);
  if (inv.status === 'void') {
    throw new DomainError('INVOICE_VOID', 'ใบกำกับ ' + inv.no + ' ถูกยกเลิกไปแล้ว รับชำระอ้างใบนี้ไม่ได้');
  }
  if (input.date && input.date < inv.date) {
    throw new DomainError('RECEIPT_BEFORE_INVOICE',
      'วันที่รับชำระ (' + thDate(input.date) + ') ก่อนวันที่ใบกำกับ (' + thDate(inv.date) + ')',
      'ถ้าลูกค้าจ่ายมาก่อน ให้บันทึกเป็นเงินรับล่วงหน้า');
  }
  const outstanding = invOutstanding(inv);
  if (outstanding <= 0) throw new DomainError('ALREADY_PAID', 'ใบกำกับภาษีนี้ชำระครบแล้ว');

  const gross = input.amount ? M(input.amount) : outstanding;
  if (gross > outstanding) {
    throw new DomainError('OVER_PAYMENT',
      'ยอดรับชำระ ' + fmt(gross) + ' เกินยอดคงค้าง ' + fmt(outstanding),
      'ถ้าลูกค้าจ่ายเกิน ให้บันทึกส่วนเกินเป็นเงินรับล่วงหน้าแทน');
  }
  /* ภาษีที่ลูกค้าหักไว้ — ฐานคือค่าบริการก่อน VAT ส่วนที่รับครั้งนี้ ไม่รวมค่าสินค้า
     ถ้าลูกค้าหักจากฐานอื่น (ตาม 50 ทวิ ที่ได้รับ) ระบุ whtBase มาแทนได้ */
  const svcShare = receiptServiceShare(inv, gross);
  let wht = 0, whtRate = null, whtBase = 0;
  if (input.whtCode) {
    const r = resolveRate(input.whtCode, input.date, { channel: 'manual' });
    const given = input.whtBase !== undefined && input.whtBase !== null && String(input.whtBase).trim() !== '';
    whtBase = given ? M(input.whtBase) : svcShare;
    if (whtBase < 0 || whtBase > gross) {
      throw new DomainError('WHT_BASE_INVALID', 'ฐานภาษีที่ลูกค้าหัก ' + fmt(whtBase) + ' ต้องไม่ติดลบและไม่เกินยอดรับ ' + fmt(gross),
        'ดูฐานภาษีจากหนังสือรับรอง 50 ทวิ ที่ลูกค้าส่งมา');
    }
    wht = round2(pct(whtBase, r.rate));
    whtRate = r.rate;
  }
  const net = gross - wht;
  const no = nextNo('receipt', input.date);
  const bankAcc = input.bankAccount || accBySub('bank');

  const je = post({
    type: 'receipt', date: input.date,
    desc: 'รับชำระจาก ' + inv.partnerName + ' (' + inv.no + ')',
    src: 'receipt', srcId: no,
    lines: [
      { acc: bankAcc, dr: net },
    ].concat(wht ? [{ acc: accBySub('wht_asset'), dr: wht }] : [])
     .concat([{ acc: accBySub('trade_receivable'), cr: gross, partner: inv.partnerCode }]),
  });

  inv.paid += gross;
  syncInvStatus(inv);

  const doc = {
    no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, method: input.method || 'transfer',
    gross, wht, whtRate, whtBase, svcShare, net, entryNo: je.no, whtCertReceived: !!input.whtCode,
  };
  DB.docs.receipt.unshift(doc);
  audit('receipt', no, 'create', null, { invoice: inv.no, net: fmt(net) });
  return doc;
}

/* ---------- ขาย: ใบลดหนี้ ---------- */
const CN_REASONS = {
  RETURN_DEFECT: 'รับคืนสินค้าชำรุด บกพร่อง ไม่ตรงตามที่ตกลง',
  RETURN_SHORT: 'ส่งมอบสินค้าขาดจำนวน',
  PRICE_REDUCE: 'ลดราคาสินค้าหรือค่าบริการหลังออกใบกำกับ',
  SERVICE_INCOMPLETE: 'ให้บริการไม่ครบตามที่ตกลง',
  CANCEL_CONTRACT: 'บอกเลิกสัญญาหรือคืนสินค้า',
  CALC_ERROR: 'คำนวณราคาสูงกว่าที่เป็นจริง',
};
function issueCreditNote(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) {
    throw new DomainError('CREDIT_NOTE_NO_ORIGIN',
      'ใบลดหนี้ต้องอ้างอิงใบกำกับภาษีเดิมเสมอ (มาตรา 86/10)',
      'เลือกใบกำกับภาษีที่ต้องการลดหนี้');
  }
  if (inv.status === 'void') {
    throw new DomainError('CREDIT_NOTE_ORIGIN_VOID', 'ใบกำกับ ' + inv.no + ' ถูกยกเลิกไปแล้ว ออกใบลดหนี้อ้างใบที่ยกเลิกไม่ได้');
  }
  if (!CN_REASONS[input.reason]) {
    throw new DomainError('CREDIT_NOTE_REASON_INVALID',
      'เหตุผลไม่อยู่ในเหตุที่กฎหมายกำหนดตามมาตรา 86/10');
  }
  if (input.date < inv.date) {
    throw new DomainError('CREDIT_NOTE_BEFORE_ORIGIN',
      'วันที่ใบลดหนี้ (' + thDate(input.date) + ') ก่อนวันที่ใบกำกับเดิม (' + thDate(inv.date) + ')',
      'ใบลดหนี้ต้องออกหลังใบกำกับเดิมเสมอ');
  }
  const base = M(input.base);
  if (base <= 0) throw new DomainError('CREDIT_NOTE_ZERO', 'มูลค่าที่ลดต้องมากกว่าศูนย์');
  const code = noteTaxCode(inv, input.taxCode, 'ลดหนี้');
  const remaining = creditableBase(inv, code);
  if (base > remaining) {
    throw new DomainError('CREDIT_NOTE_EXCEEDS',
      'มูลค่าใบลดหนี้ ' + fmt(base) + ' เกินมูลค่าคงเหลือของใบกำกับเดิม ' + fmt(remaining) + ' บาท (ก่อนภาษี'
        + (invoiceTaxCodes(inv).length > 1 ? ' เฉพาะรายการ' + TAX_CODE_LABEL[code] : '') + ')',
      'มูลค่าคงเหลือ = มูลค่าใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ที่ออกไปแล้ว คิดก่อนภาษีมูลค่าเพิ่ม');
  }
  /* ภาษีในใบลดหนี้ใช้อัตราเดียวกับรายการในใบกำกับเดิม — รายการอัตรา 0% หรือยกเว้น ใบลดหนี้ก็ไม่มีภาษี */
  const vat = code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', inv.date).rate)) : 0;
  const total = base + vat;
  const returns = creditNoteReturns(inv, input.returnLines);
  const no = nextNo('creditNote', input.date);

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ใบลดหนี้ ' + no + ' อ้าง ' + inv.no + ' — ' + CN_REASONS[input.reason],
    src: 'creditNote', srcId: no,
    lines: [
      { acc: accBySub('sales_return'), dr: base },
      { acc: accBySub('output_vat'), dr: vat },
      { acc: accBySub('trade_receivable'), cr: total, partner: inv.partnerCode },
    ],
  });

  /* รับคืนสินค้า: ของกลับเข้าคลังด้วยต้นทุนเดิมที่ตัดออกไปตอนขาย และกลับต้นทุนขายส่วนนั้น */
  let cogsJe = null;
  const back = returns.reduce((t, r) => t + r.cost, 0);
  if (back > 0) {
    cogsJe = post({
      type: 'inventory', date: input.date, desc: 'รับคืนสินค้าตามใบลดหนี้ ' + no,
      src: 'creditNote', srcId: no,
      lines: [{ acc: accBySub('inventory'), dr: back }, { acc: accBySub('cogs'), cr: back }],
    });
    returns.forEach(function (r) {
      const it = DB.items.find((x) => x.code === r.itemCode);
      it.qty = roundQty(it.qty + r.qty);
      it.value += r.cost;
      it.avgCost = unitCost(it.value, it.qty);
      DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'in', qty: r.qty, cost: r.cost, src: no, balance: it.qty });
    });
  }

  DB.taxTx.push({
    kind: 'vat_output', period: periodOf(input.date), date: input.date,
    docNo: no, docType: 'credit_note', refDoc: inv.no,
    partnerName: inv.partnerName, taxId: inv.snap.taxId, branch: inv.snap.branch,
    base: code === 'VAT7' ? -base : 0, zero: code === 'VAT0' ? -base : 0, exempt: code === 'EXEMPT' ? -base : 0,
    tax: -vat, entryNo: je.no, filingId: null,
  });

  inv.credited += total;
  syncInvStatus(inv);

  const doc = { no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, reason: input.reason, reasonText: CN_REASONS[input.reason],
    taxCode: code, base, vat, total, entryNo: je.no, cogsEntryNo: cogsJe ? cogsJe.no : null,
    returns: returns.map((r) => ({ itemCode: r.itemCode, desc: r.desc, qty: r.qty, cost: r.cost })) };
  DB.docs.creditNote.unshift(doc);
  audit('creditNote', no, 'issue', null, { ref: inv.no, total: fmt(total), reason: CN_REASONS[input.reason] });
  return doc;
}

/* ---------- ขาย: ใบเพิ่มหนี้ (มาตรา 86/9) ----------
   ใช้เมื่อออกใบกำกับไปแล้วแต่เก็บเงินต่ำกว่าที่ควร ต้องเก็บเพิ่มพร้อมภาษีขายเพิ่ม
   ห้ามออกใบกำกับใบใหม่ทับ เพราะรายได้และภาษีขายจะถูกนับซ้ำสองรอบ */
const DN_REASONS = {
  GOODS_EXCESS: 'ส่งมอบสินค้าเกินกว่าจำนวนที่ตกลงซื้อขายกัน',
  GOODS_UNDERPRICED: 'คำนวณราคาสินค้าต่ำกว่าที่เป็นจริง',
  SERVICE_EXCESS: 'ให้บริการเกินกว่าข้อกำหนดที่ตกลงกัน',
  SERVICE_UNDERPRICED: 'คำนวณราคาค่าบริการต่ำกว่าที่เป็นจริง',
  VAT_UNDERCALC: 'คำนวณภาษีมูลค่าเพิ่มต่ำกว่าที่เป็นจริง',
};
function issueDebitNote(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) {
    throw new DomainError('DEBIT_NOTE_NO_ORIGIN',
      'ใบเพิ่มหนี้ต้องอ้างอิงใบกำกับภาษีเดิมเสมอ (มาตรา 86/9)',
      'เลือกใบกำกับภาษีที่ต้องการเพิ่มหนี้');
  }
  if (inv.status === 'void') {
    throw new DomainError('DEBIT_NOTE_ORIGIN_VOID',
      'ใบกำกับเดิมถูกยกเลิกไปแล้ว ออกใบเพิ่มหนี้อ้างใบที่ยกเลิกไม่ได้',
      'ออกใบกำกับภาษีใบใหม่แทน');
  }
  if (!DN_REASONS[input.reason]) {
    throw new DomainError('DEBIT_NOTE_REASON_INVALID',
      'เหตุผลไม่อยู่ในเหตุที่กฎหมายกำหนดตามมาตรา 86/9');
  }
  if (input.date < inv.date) {
    throw new DomainError('DEBIT_NOTE_BEFORE_ORIGIN',
      'วันที่ใบเพิ่มหนี้ (' + thDate(input.date) + ') ก่อนวันที่ใบกำกับเดิม (' + thDate(inv.date) + ')',
      'ใบเพิ่มหนี้ต้องออกหลังใบกำกับเดิมเสมอ');
  }
  const base = M(input.base);
  if (base <= 0) {
    throw new DomainError('DEBIT_NOTE_ZERO', 'มูลค่าที่เพิ่มต้องมากกว่าศูนย์');
  }
  const code = noteTaxCode(inv, input.taxCode, 'เพิ่มหนี้');
  /* ภาษีในใบเพิ่มหนี้ตามอัตราของรายการเดิม — ใบกำกับอัตรา 0% เพิ่มหนี้แล้วก็ยังเป็น 0% */
  const vat = code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', inv.date).rate)) : 0;
  const total = base + vat;
  const no = nextNo('debitNote', input.date);

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ใบเพิ่มหนี้ ' + no + ' อ้าง ' + inv.no + ' — ' + DN_REASONS[input.reason],
    src: 'debitNote', srcId: no,
    lines: [
      { acc: accBySub('trade_receivable'), dr: total, partner: inv.partnerCode },
      { acc: accBySub('sales_revenue'), cr: base },
      { acc: accBySub('output_vat'), cr: vat },
    ],
  });

  DB.taxTx.push({
    kind: 'vat_output', period: periodOf(input.date), date: input.date,
    docNo: no, docType: 'debit_note', refDoc: inv.no,
    partnerName: inv.partnerName, taxId: inv.snap.taxId, branch: inv.snap.branch,
    base: code === 'VAT7' ? base : 0, zero: code === 'VAT0' ? base : 0, exempt: code === 'EXEMPT' ? base : 0,
    tax: vat, entryNo: je.no, filingId: null,
  });

  inv.debited = (inv.debited || 0) + total;
  syncInvStatus(inv);

  const doc = { no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, reason: input.reason, reasonText: DN_REASONS[input.reason],
    taxCode: code, base, vat, total, entryNo: je.no };
  DB.docs.debitNote.unshift(doc);
  audit('debitNote', no, 'issue', null, { ref: inv.no, total: fmt(total), reason: DN_REASONS[input.reason] });
  return doc;
}

/* ===================================================================
   เอกสารก่อนลงบัญชี — ใบเสนอราคา ใบสั่งขาย ใบสั่งซื้อ
   ไม่มีผลทางบัญชี ไม่สร้างใบสำคัญ ไม่แตะสต๊อก และไม่เข้ารายงานภาษี
   (docs/14 ข้อ 2–3) ผลทางบัญชีเกิดตอนแปลงเป็นใบกำกับหรือใบตั้งหนี้เท่านั้น
   =================================================================== */
const TRADE_DOCS = {
  quotation:     { label:'ใบเสนอราคา', side:'customer', next:'salesOrder', validDays:30 },
  salesOrder:    { label:'ใบสั่งขาย',   side:'customer', next:'invoice',    validDays:0 },
  purchaseOrder: { label:'ใบสั่งซื้อ',   side:'vendor',   next:'bill',       validDays:0 },
};

function tradeDocFind(kind, no) {
  const d = (DB.docs[kind] || []).find((x) => x.no === no);
  if (!d) throw new DomainError('TRADE_DOC_NOT_FOUND', 'ไม่พบ' + TRADE_DOCS[kind].label + ' ' + no);
  return d;
}

/** สถานะที่แสดง — หมดอายุคิดจากวันที่ ไม่ได้เก็บไว้ในเอกสาร จะได้ไม่ต้องมี job รายวัน */
function tradeDocStatus(kind, d, asOf) {
  if (d.status !== 'issued') return d.status;
  if (d.validUntil && (asOf || TODAY) > d.validUntil) return 'expired';
  return 'issued';
}

function issueTradeDoc(kind, input) {
  const cfg = TRADE_DOCS[kind];
  if (!cfg) throw new DomainError('TRADE_DOC_KIND_UNKNOWN', 'ไม่รู้จักเอกสารประเภท ' + kind);
  const p = partnerByCode(input.partnerCode);
  if (p.kind !== cfg.side) {
    throw new DomainError('PARTNER_WRONG_SIDE',
      cfg.label + 'ต้องออกให้' + (cfg.side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย')
      + ' แต่ ' + p.name + ' อยู่ในทะเบียน' + (p.kind === 'customer' ? 'ลูกค้า' : 'ผู้ขาย'));
  }
  const lines = (input.lines || []).filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการอย่างน้อย 1 บรรทัด');
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่เอกสาร');

  const v = computeVat(lines, input.date);
  const no = nextNo(kind, input.date);
  const validUntil = input.validUntil
    || (cfg.validDays ? addDays(input.date, cfg.validDays) : null);

  const doc = {
    no, date: input.date, validUntil,
    partnerCode: p.code, partnerName: p.name, snap: snapshotPartner(p),
    lines: lines.map((l) => ({
      desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
      taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null,
      expenseSub: l.expenseSub || null, revenueSub: l.revenueSub || null,
      amount: round2(mulQty(M(l.price), l.qty)),
    })),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    note: input.note || '', status: 'issued', convertedTo: null, fromDoc: input.fromDoc || null,
  };
  DB.docs[kind].unshift(doc);
  audit(kind, no, 'issue', null, { partner: p.name, total: fmt(v.total) });
  return doc;
}

/** ตอบรับ / ปฏิเสธ / ยกเลิก — ใบที่แปลงไปแล้วห้ามแตะ ไม่งั้นเอกสารปลายทางจะกำพร้า */
function setTradeDocStatus(kind, no, status, reason) {
  /* ใช้ค่าเดียวกับ doc_status ใน db/migrations/001 และแผนภาพใน docs/14
     ไม่คิดค่าใหม่ขึ้นมาเอง ไม่งั้นตอนย้ายขึ้นฐานข้อมูลจริงจะแปลงสถานะไม่ตรง */
  const allowed = ['approved', 'rejected', 'cancelled'];
  if (allowed.indexOf(status) < 0) {
    throw new DomainError('TRADE_DOC_STATUS_INVALID', 'เปลี่ยนสถานะเป็น ' + status + ' ไม่ได้');
  }
  const d = tradeDocFind(kind, no);
  if (d.status === 'closed') {
    throw new DomainError('TRADE_DOC_ALREADY_CONVERTED',
      TRADE_DOCS[kind].label + ' ' + no + ' ถูกแปลงเป็น ' + d.convertedTo + ' ไปแล้ว',
      'ถ้าต้องการยกเลิก ให้จัดการที่เอกสารปลายทางแทน');
  }
  d.status = status;
  if (reason) d.statusReason = reason;
  audit(kind, no, status, null, reason ? { reason } : null);
  return d;
}

/** แปลงเอกสารไปขั้นถัดไป — ใบเสนอราคา → ใบสั่งขาย → ใบกำกับภาษี, ใบสั่งซื้อ → ตั้งหนี้ */
function convertTradeDoc(kind, no, input) {
  const cfg = TRADE_DOCS[kind];
  const d = tradeDocFind(kind, no);
  if (d.status === 'closed') {
    throw new DomainError('TRADE_DOC_ALREADY_CONVERTED',
      TRADE_DOCS[kind].label + ' ' + no + ' ถูกแปลงเป็น ' + d.convertedTo + ' ไปแล้ว');
  }
  if (d.status === 'cancelled' || d.status === 'rejected') {
    throw new DomainError('TRADE_DOC_NOT_ACTIVE',
      TRADE_DOCS[kind].label + ' ' + no + ' อยู่ในสถานะ ' + d.status + ' แปลงต่อไม่ได้');
  }
  const opts = input || {};
  const date = opts.date || TODAY;
  let made;

  /* บรรทัดที่เก็บไว้เป็นจำนวนเงินสเกลแล้ว ต้องแปลงกลับเป็นข้อความก่อนส่งต่อ
     ไม่งั้นฟังก์ชันปลายทางจะคูณสเกลซ้ำ */
  const carry = d.lines.map((l) => ({ ...l, price: unM(l.price) }));

  if (cfg.next === 'salesOrder') {
    made = issueTradeDoc('salesOrder', {
      partnerCode: d.partnerCode, date, lines: carry, note: d.note, fromDoc: d.no,
    });
  } else if (cfg.next === 'invoice') {
    made = issueInvoice({ partnerCode: d.partnerCode, date, lines: carry });
  } else {
    if (!opts.vendorNo) {
      throw new DomainError('VENDOR_INVOICE_NO_REQUIRED',
        'ต้องกรอกเลขที่ใบกำกับภาษีของผู้ขายก่อนตั้งหนี้',
        'ดูเลขที่จากใบกำกับที่ผู้ขายส่งมา');
    }
    made = recordBill({
      partnerCode: d.partnerCode, date, vendorNo: opts.vendorNo,
      lines: carry.map((l) => ({ ...l, expenseSub: l.expenseSub || opts.expenseSub || 'admin_expense' })),
      nonClaimableVat: !!opts.nonClaimableVat, whtCode: opts.whtCode || null,
    });
  }
  d.status = 'closed';
  d.convertedTo = made.no;
  audit(kind, no, 'convert', null, { to: made.no });
  return made;
}

/* ---------- ซื้อ: ตั้งหนี้ผู้ขาย ---------- */
function recordBill(input) {
  const p = partnerByCode(input.partnerCode);
  const dup = DB.docs.bill.find((b) => b.partnerCode === p.code && b.vendorNo === input.vendorNo && b.status !== 'void');
  if (dup) {
    throw new DomainError('DUPLICATE_VENDOR_INVOICE',
      'บันทึกใบกำกับภาษีซื้อเลขที่ ' + input.vendorNo + ' ของผู้ขายรายนี้ไปแล้ว (' + dup.no + ')',
      'ตรวจสอบรายการเดิม หรือแก้เลขที่ใบกำกับให้ถูกต้อง');
  }
  const lines = input.lines.filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการอย่างน้อย 1 บรรทัด');

  /* ตั้งหนี้จากใบรับสินค้า — ของเข้าคลังไปแล้วตอนรับ ตอนนี้แค่ล้างบัญชีพักรับสินค้า
     ห้ามเพิ่มสต๊อกซ้ำ ไม่งั้นจำนวนในคลังจะเป็นสองเท่าของที่รับจริง */
  const grn = input.grnNo ? DB.docs.goodsReceipt.find((g) => g.no === input.grnNo) : null;
  if (input.grnNo) {
    if (!grn) throw new DomainError('GRN_NOT_FOUND', 'ไม่พบใบรับสินค้า ' + input.grnNo);
    if (grn.status !== 'received') {
      throw new DomainError('GRN_ALREADY_BILLED',
        'ใบรับสินค้า ' + grn.no + ' ตั้งหนี้ไปแล้ว (' + grn.billNo + ')');
    }
    if (grn.partnerCode !== p.code) {
      throw new DomainError('GRN_PARTNER_MISMATCH', 'ใบรับสินค้า ' + grn.no + ' เป็นของ ' + grn.partnerName);
    }
    if (input.date < grn.date) {
      throw new DomainError('GRN_BILL_BEFORE_RECEIPT',
        'วันที่ตั้งหนี้ (' + thDate(input.date) + ') ก่อนวันที่รับสินค้า (' + thDate(grn.date) + ')',
        'ใช้วันที่ได้รับใบกำกับภาษี ซึ่งต้องไม่ก่อนวันที่รับของเข้าคลัง');
    }
  }

  const v = computeVat(lines, input.date);
  const no = nextNo('bill', input.date);
  const claimable = !input.nonClaimableVat;

  const expLines = {};
  lines.forEach(function (l) {
    const a = grn ? accBySub('grni') : accBySub(l.expenseSub || 'admin_expense');
    expLines[a] = (expLines[a] || 0) + round2(mulQty(M(l.price), l.qty));
  });
  if (grn && expLines[accBySub('grni')] !== grn.total) {
    throw new DomainError('GRN_AMOUNT_MISMATCH',
      'มูลค่าตั้งหนี้ไม่ตรงกับใบรับสินค้า ' + grn.no + ' (' + fmt(grn.total) + ' บาท)',
      'ตั้งหนี้จากหน้าใบรับสินค้า ระบบจะยกรายการมาให้ครบ');
  }
  // ภาษีซื้อต้องห้ามเข้าเป็นค่าใช้จ่าย ไม่ใช่สินทรัพย์ภาษี
  if (!claimable && v.vat) {
    const a = accBySub('non_claimable_vat_expense');
    expLines[a] = (expLines[a] || 0) + v.vat;
  }

  const je = post({
    type: 'purchase', date: input.date,
    desc: 'ตั้งหนี้ ' + p.name + ' (' + input.vendorNo + ')',
    src: 'bill', srcId: no,
    lines: Object.keys(expLines).map((a) => ({ acc: a, dr: expLines[a] }))
      .concat(claimable && v.vat ? [{ acc: accBySub('input_vat'), dr: v.vat }] : [])
      .concat([{ acc: accBySub('trade_payable'), cr: v.total, partner: p.code }]),
  });

  lines.forEach(function (l) {
    if (!l.itemCode || grn) return;
    const it = DB.items.find((x) => x.code === l.itemCode);
    if (!it || it.type !== 'stock') return;
    const c = round2(mulQty(M(l.price), l.qty));
    it.qty = roundQty(it.qty + roundQty(l.qty));
    it.value += c;
    it.avgCost = unitCost(it.value, it.qty);
    DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'in', qty: roundQty(l.qty), cost: c, src: no, balance: it.qty });
  });

  DB.taxTx.push({
    kind: 'vat_input', period: periodOf(input.date), date: input.date,
    docNo: input.vendorNo, docType: 'tax_invoice',
    partnerName: p.name, taxId: p.taxId, branch: p.branch,
    base: v.std, zero: v.zero, exempt: v.exempt, tax: claimable ? v.vat : 0,
    nonClaimable: claimable ? 0 : v.vat,
    entryNo: je.no, filingId: null,
  });

  const doc = {
    no, date: input.date, due: addDays(input.date, p.termDays || 0),
    vendorNo: input.vendorNo, partnerCode: p.code, partnerName: p.name,
    lines: lines.map((l) => ({ desc: l.desc, qty: Number(l.qty), price: M(l.price),
      amount: round2(mulQty(M(l.price), l.qty)), itemCode: l.itemCode || null })),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    claimable, paid: 0, status: 'issued', entryNo: je.no,
    whtCode: input.whtCode || null, grnNo: grn ? grn.no : null,
  };
  DB.docs.bill.unshift(doc);
  if (grn) { grn.status = 'closed'; grn.billNo = no; grn.billDate = input.date; }
  audit('bill', no, 'create', null, { vendor: p.name, total: fmt(v.total) });
  return doc;
}

/* ---------- ซื้อ: จ่ายชำระพร้อมหักภาษี ณ ที่จ่าย ---------- */
function payBill(input) {
  const bill = DB.docs.bill.find((b) => b.no === input.billNo);
  if (!bill) throw new DomainError('BILL_NOT_FOUND', 'ไม่พบรายการตั้งหนี้ ' + input.billNo);
  if (bill.status === 'void') {
    throw new DomainError('BILL_VOID', 'รายการตั้งหนี้ ' + bill.no + ' ถูกยกเลิกไปแล้ว จ่ายชำระไม่ได้');
  }
  if (input.date && input.date < bill.date) {
    throw new DomainError('PAYMENT_BEFORE_BILL',
      'วันที่จ่าย (' + thDate(input.date) + ') ก่อนวันที่ตั้งหนี้ (' + thDate(bill.date) + ')',
      'ถ้าจ่ายมัดจำก่อนได้ใบกำกับ ให้บันทึกเป็นเงินจ่ายล่วงหน้า');
  }
  const outstanding = billOutstanding(bill);
  if (outstanding <= 0) throw new DomainError('ALREADY_PAID', 'รายการนี้จ่ายครบแล้ว');

  const p = partnerByCode(bill.partnerCode);
  const gross = input.amount ? M(input.amount) : outstanding;
  if (gross > outstanding) {
    throw new DomainError('OVER_PAYMENT', 'ยอดจ่าย ' + fmt(gross) + ' เกินยอดคงค้าง ' + fmt(outstanding));
  }
  const channel = input.channel === 'e_wht' ? 'e_wht' : 'manual';
  const whtCode = input.whtCode || bill.whtCode;
  const w = billWhtFor(bill, gross, input.date, channel, whtCode);
  const wht = w.wht, whtRate = w.rate, baseForWht = w.base;
  const net = gross - wht;
  const no = nextNo('payment', input.date);
  const whtAccount = p.entityType === 'individual' ? 'wht_payable_pnd3' : 'wht_payable_pnd53';
  const bank = input.bankAccount || accBySub('bank');

  /* e-Withholding Tax: ธนาคารตัดเงินเต็มจำนวน โอนสุทธิให้ผู้รับ และนำส่งภาษีให้กรมสรรพากรเอง
     ภาษีจึงออกจากบัญชีธนาคารพร้อมกัน ไม่ค้างเป็นภาษีหัก ณ ที่จ่ายค้างนำส่ง (แบบ ภ.ง.ด. ก็ไม่ต้องยื่น) */
  const je = post({
    type: 'payment', date: input.date,
    desc: 'จ่ายชำระ ' + p.name + ' (' + bill.no + ')',
    src: 'payment', srcId: no,
    lines: [{ acc: accBySub('trade_payable'), dr: gross, partner: p.code }]
      .concat(wht && channel === 'manual' ? [{ acc: accBySub(whtAccount), cr: wht }] : [])
      .concat([{ acc: bank, cr: net, memo: wht ? 'จ่ายผู้รับเงินสุทธิ' : null }])
      .concat(wht && channel === 'e_wht' ? [{ acc: bank, cr: wht, memo: 'ภาษีหัก ณ ที่จ่ายที่ธนาคารนำส่งผ่าน e-Withholding Tax' }] : []),
  });

  bill.paid += gross;
  bill.status = bill.paid >= bill.total ? 'paid' : 'partially_paid';

  let certNo = null;
  if (wht > 0) {
    // ★ e-WHT: ธนาคารนำส่งและออกหลักฐานให้ ไม่ต้องออก 50 ทวิ เอง
    //   และต้องกันออกจากแบบ ภ.ง.ด.3/53 ไม่งั้นนำส่งซ้ำ
    if (channel === 'manual') {
      certNo = nextNo('whtCert', input.date);
      DB.docs.whtCert.unshift({
        no: certNo, date: input.date, partnerCode: p.code, partnerName: p.name,
        taxId: p.taxId, form: p.entityType === 'individual' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53',
        incomeType: resolveRate(whtCode, input.date, { channel }).label,
        base: baseForWht, wht, rate: whtRate, sent: false, paymentNo: no,
      });
    }
    DB.taxTx.push({
      kind: 'wht', period: periodOf(input.date), date: input.date,
      docNo: no, docType: 'payment',
      partnerName: p.name, taxId: p.taxId, branch: p.branch,
      entityType: p.entityType,
      base: baseForWht, tax: wht, rate: whtRate, channel,
      incomeType: resolveRate(whtCode, input.date, { channel }).label,
      form: p.entityType === 'individual' ? 'PND3' : 'PND53',
      certNo, entryNo: je.no, filingId: null,
    });
  }

  const doc = { no, date: input.date, billNo: bill.no, partnerCode: p.code, partnerName: p.name,
    gross, wht, whtRate, whtBase: wht ? baseForWht : 0, baseShare: w.share, net, channel, certNo, entryNo: je.no,
    method: input.method || 'transfer' };
  DB.docs.payment.unshift(doc);
  audit('payment', no, 'create', null, { bill: bill.no, net: fmt(net), channel });
  return doc;
}

/* ---------- ค่าเสื่อมราคาประจำงวด ---------- */
function runDepreciation(period) {
  const already = DB.docs.depreciation.find((d) => d.period === period && d.status !== 'void');
  if (already) {
    throw new DomainError('DEPRECIATION_ALREADY_RUN',
      'ตั้งค่าเสื่อมราคางวด ' + thPeriod(period) + ' ไปแล้ว (' + already.entryNo + ')',
      'ยกเลิกงวดเดิมที่หน้าค่าเสื่อมราคาก่อน ถ้าต้องการคำนวณใหม่');
  }
  const endDate = endOfMonth(period + '-01');
  let bookTotal = 0, taxTotal = 0;
  const rows = [];

  DB.assets.forEach(function (a) {
    if (a.class === 'LAND' || a.status !== 'in_use') return;
    if (a.inService > endDate) return;
    const bookRemaining = a.cost - a.accumBook;
    if (bookRemaining <= 0) return;
    const bookMonthly = Math.min(divRound(divRound(a.cost, a.bookYears), 12), bookRemaining);

    const t = TAX_DEPRECIATION[a.class];
    const taxBase = t.costCap ? Math.min(a.cost, t.costCap) : a.cost;
    const taxRemaining = taxBase - a.accumTax;
    const taxMonthly = Math.max(0, Math.min(divRound(pct(taxBase, t.rate), 12), taxRemaining));

    bookTotal += bookMonthly;
    taxTotal += taxMonthly;
    rows.push({ code: a.code, name: a.name, class: a.class, cost: a.cost,
      book: bookMonthly, tax: taxMonthly, diff: bookMonthly - taxMonthly,
      nbvBook: a.cost - a.accumBook - bookMonthly, nbvTax: taxBase - a.accumTax - taxMonthly });
  });

  if (bookTotal === 0) {
    throw new DomainError('NO_DEPRECIABLE_ASSETS', 'ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อมในงวดนี้');
  }
  const je = post({
    type: 'asset', date: endDate, desc: 'ค่าเสื่อมราคาประจำงวด ' + thPeriod(period),
    src: 'depreciation', srcId: period,
    lines: [
      { acc: accBySub('depreciation'), dr: bookTotal },
      { acc: accBySub('accum_depreciation'), cr: bookTotal },
    ],
  });
  /* ทะเบียนทรัพย์สินขยับหลังลงบัญชีสำเร็จเท่านั้น — ถ้างวดปิดอยู่ ค่าเสื่อมสะสมต้องไม่เพิ่มทั้งที่ไม่มีใบสำคัญ */
  rows.forEach(function (r) {
    const a = DB.assets.find((x) => x.code === r.code);
    a.accumBook += r.book;
    a.accumTax += r.tax;
  });
  const run = { period, date: endDate, bookTotal, taxTotal, diff: bookTotal - taxTotal, rows, entryNo: je.no };
  DB.docs.depreciation.unshift(run);
  audit('depreciation', period, 'run', null, { book: fmt(bookTotal), tax: fmt(taxTotal) });
  return run;
}

/* ---------- เงินเดือน ---------- */
function computePit(annualIncome, deductions) {
  const expense = Math.min(pct(annualIncome, 50), M('100000'));
  const net = Math.max(0, annualIncome - expense - deductions);
  let tax = 0;
  PIT_BRACKETS.forEach(function (b) {
    if (net <= b.lo) return;
    const top = b.hi === null ? net : Math.min(net, b.hi);
    tax += pct(top - b.lo, b.rate);
  });
  return { expense, net, tax: round2(tax) };
}

function runPayroll(period) {
  const already = DB.docs.payRun.find((r) => r.period === period && r.status !== 'void');
  if (already) {
    throw new DomainError('PAYROLL_ALREADY_RUN',
      'ทำเงินเดือนงวด ' + thPeriod(period) + ' ไปแล้ว (' + already.entryNo + ')');
  }
  const payDate = endOfMonth(period + '-01');
  const sso = ssoRate(payDate);
  const slips = [];
  let gross = 0, pit = 0, ssoEmp = 0, ssoEr = 0, pvdEmp = 0, pvdEr = 0, net = 0;

  DB.employees.filter((e) => e.active).forEach(function (e) {
    const salary = e.salary;
    const ot = e.otHours ? round2(mulQty(divRound(divRound(salary, 30), 8), e.otHours * 1.5)) : 0;
    const g = salary + ot;

    const wageBase = Math.min(Math.max(salary, sso.floor), sso.ceiling);
    const s = Math.min(round2(pct(wageBase, sso.pct)), sso.max);
    const pv = e.pvdRate ? round2(pct(salary, e.pvdRate)) : 0;

    const annual = salary * 12 + ot * 12;
    const ded = M('60000') + (e.deductions || 0) + Math.min(s * 12, sso.max * 12);
    const p = computePit(annual, ded);
    const monthlyPit = round2(divRound(p.tax, 12));

    const n = g - monthlyPit - s - pv;
    slips.push({ code: e.code, name: e.name, dept: e.dept, salary, ot, gross: g,
      pit: monthlyPit, sso: s, ssoBase: wageBase, pvd: pv, net: n });

    gross += g; pit += monthlyPit; ssoEmp += s; ssoEr += s; pvdEmp += pv;
    pvdEr += pv; net += n;
  });

  if (!slips.length) throw new DomainError('NO_EMPLOYEES', 'ไม่มีพนักงานที่ยังทำงานอยู่');

  const je = post({
    type: 'payroll', date: payDate, desc: 'เงินเดือนงวด ' + thPeriod(period),
    src: 'payroll', srcId: period,
    lines: [
      { acc: accBySub('admin_expense'), dr: gross, memo: 'เงินเดือนและค่าล่วงเวลา' },
      { acc: accBySub('sso_expense'), dr: ssoEr, memo: 'เงินสมทบประกันสังคมส่วนนายจ้าง' },
      { acc: accBySub('pvd_expense'), dr: pvdEr, memo: 'เงินสมทบกองทุนสำรองฯ ส่วนนายจ้าง' },
      { acc: accBySub('wht_payable_pnd1'), cr: pit },
      { acc: accBySub('sso_payable'), cr: ssoEmp + ssoEr },
      { acc: accBySub('pvd_payable'), cr: pvdEmp + pvdEr },
      { acc: accBySub('bank'), cr: net },
    ],
  });

  const run = { period, date: payDate, count: slips.length, gross, pit,
    ssoEmp, ssoEr, pvdEmp, pvdEr, net, slips, entryNo: je.no,
    ssoCeiling: sso.ceiling, ssoMax: sso.max };
  DB.docs.payRun.unshift(run);
  DB.taxTx.push({
    kind: 'wht', period, date: payDate, docNo: je.no, docType: 'payroll',
    partnerName: 'พนักงาน ' + slips.length + ' คน', taxId: null, branch: '00000',
    base: gross, tax: pit, rate: null, channel: 'manual',
    incomeType: 'เงินเดือน ม.40(1)', form: 'PND1', entryNo: je.no, filingId: null,
  });
  audit('payroll', period, 'run', null, { count: slips.length, net: fmt(net) });
  return run;
}

/* ---------- ปิดภาษีมูลค่าเพิ่มรายเดือน (ภ.พ.30) ---------- */
function fileVat(period) {
  const existing = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === period);
  if (existing) {
    throw new DomainError('ALREADY_FILED',
      'ยื่น ภ.พ.30 งวด ' + thPeriod(period) + ' ไปแล้วเมื่อ ' + thDate(existing.filedDate));
  }
  /* แถวของเอกสารที่ยกเลิกแล้วยอดเป็นศูนย์ ไม่นับเข้าแบบ แต่ยังโชว์ในรายงานภาษีว่า "ยกเลิก" */
  const out = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === period && !t.void);
  const inn = DB.taxTx.filter((t) => t.kind === 'vat_input' && t.period === period && !t.void);
  const outTax = out.reduce((s, t) => s + t.tax, 0);
  const inTax = inn.reduce((s, t) => s + t.tax, 0);
  const payable = outTax - inTax;
  const endDate = endOfMonth(period + '-01');

  /* ล้างบัญชีภาษีขายและภาษีซื้อของงวดให้เป็นศูนย์ทุกครั้งที่มียอด แม้ผลสุทธิเป็นศูนย์
     (ภาษีขาย 70 ภาษีซื้อ 70 ต้องล้างทั้งคู่ ไม่ใช่ค้างอยู่ในงบ) และรองรับยอดติดลบ
     (เดือนที่มีแต่ใบลดหนี้ ภาษีขายติดลบ ต้องกลับไปอยู่ฝั่งเครดิต) */
  const signed = (acc, amt) => amt > 0 ? { acc, dr: amt } : { acc, cr: -amt };
  const vatLines = [
    signed(accBySub('output_vat'), outTax),
    signed(accBySub('input_vat'), -inTax),
    payable > 0 ? { acc: accBySub('vat_payable'), cr: payable } : { acc: accBySub('vat_receivable'), dr: -payable },
  ].filter((l) => (l.dr || 0) !== 0 || (l.cr || 0) !== 0);
  const je = vatLines.length ? post({
    type: 'adjustment', date: endDate,
    desc: 'ปิดภาษีมูลค่าเพิ่มงวด ' + thPeriod(period),
    src: 'filing', srcId: 'PP30|' + period,
    lines: vatLines,
  }) : null;

  const filing = {
    form: 'PP30', period, filedDate: endDate,
    dueDate: addDays(endOfMonth(period + '-01'), 15),
    outBase: out.reduce((s, t) => s + t.base, 0),
    outZero: out.reduce((s, t) => s + (t.zero || 0), 0),
    outTax, inBase: inn.reduce((s, t) => s + t.base, 0), inTax,
    payable, entryNo: je ? je.no : null, count: out.length + inn.length,
  };
  DB.docs.filing.unshift(filing);
  out.concat(inn).forEach((t) => { t.filingId = 'PP30|' + period; });
  audit('filing', 'PP30|' + period, 'file', null, { payable: fmt(payable) });
  return filing;
}

/* ---------- ยื่นภาษีหัก ณ ที่จ่าย ---------- */
function fileWht(period, form) {
  const key = form + '|' + period;
  if (DB.docs.filing.find((f) => f.form === form && f.period === period)) {
    throw new DomainError('ALREADY_FILED', 'ยื่น ' + form + ' งวด ' + thPeriod(period) + ' ไปแล้ว');
  }
  // ★ กันรายการที่ธนาคารนำส่งแทน (e-WHT) ออก ไม่งั้นนำส่งซ้ำ
  const rows = DB.taxTx.filter((t) => t.kind === 'wht' && t.period === period
    && t.form === form && t.channel === 'manual' && !t.void);
  if (!rows.length) {
    throw new DomainError('NOTHING_TO_FILE',
      'ไม่มีรายการที่ต้องยื่นใน ' + form + ' งวด ' + thPeriod(period),
      'รายการที่นำส่งผ่าน e-Withholding Tax ธนาคารนำส่งให้แล้ว ไม่ต้องยื่นซ้ำ');
  }
  const total = rows.reduce((s, t) => s + t.tax, 0);
  const endDate = endOfMonth(period + '-01');
  /* นำส่งภาษีเดือนธันวาคมเกิดในเดือนมกราคมปีถัดไป — ถ้ายังไม่มีงวดปีหน้า เปิดให้ก่อน */
  const remitDate = addDays(endDate, 7);
  if (!DB.periods.some((x) => remitDate >= x.start && remitDate <= x.end)) {
    openNextFiscalYear('ต้องบันทึกการนำส่ง ' + form + ' งวด ' + thPeriod(period) + ' ในเดือนถัดไป');
  }
  const acctSub = form === 'PND1' ? 'wht_payable_pnd1' : form === 'PND3' ? 'wht_payable_pnd3' : 'wht_payable_pnd53';

  const je = post({
    type: 'payment', date: addDays(endDate, 7),
    desc: 'นำส่งภาษีหัก ณ ที่จ่าย ' + form + ' งวด ' + thPeriod(period),
    src: 'filing', srcId: key,
    lines: [{ acc: accBySub(acctSub), dr: total }, { acc: accBySub('bank'), cr: total }],
  });
  const filing = { form, period, filedDate: addDays(endDate, 7), dueDate: addDays(endDate, 7),
    count: rows.length, total, entryNo: je.no,
    excluded: DB.taxTx.filter((t) => t.kind === 'wht' && t.period === period && t.channel === 'e_wht' && !t.void).length };
  DB.docs.filing.unshift(filing);
  rows.forEach((t) => { t.filingId = key; });
  audit('filing', key, 'file', null, { count: rows.length, total: fmt(total) });
  return filing;
}

/* ---------- ปิดงวด ---------- */
function closeChecklist(period) {
  const endDate = endOfMonth(period + '-01');
  const items = [];
  const rec = reconciliationChecks(endDate);
  rec.checks.forEach((c) => items.push({
    label: c.label, ok: c.ok,
    detail: c.ok ? 'ตรงกัน' : 'ต่างกัน ' + fmt(c.control - c.sub) + ' บาท', blocking: true,
  }));
  const dep = DB.docs.depreciation.find((d) => d.period === period && d.status !== 'void');
  items.push({ label: 'ตั้งค่าเสื่อมราคาประจำงวด', ok: !!dep,
    detail: dep ? fmt(dep.bookTotal) + ' บาท' : 'ยังไม่ได้ทำ', blocking: true, action: 'depreciation' });
  const pay = DB.docs.payRun.find((r) => r.period === period && r.status !== 'void');
  items.push({ label: 'ทำเงินเดือนประจำงวด', ok: !!pay,
    detail: pay ? pay.count + ' คน ' + fmt(pay.net) + ' บาท' : 'ยังไม่ได้ทำ', blocking: false, action: 'payroll' });
  const vat = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === period);
  items.push({ label: 'ยื่นแบบ ภ.พ.30', ok: !!vat,
    detail: vat ? 'ชำระ ' + fmt(vat.payable) + ' บาท' : 'ยังไม่ได้ยื่น', blocking: true, action: 'vat' });
  const unmatched = DB.bankTxns.filter((t) => !t.matched && periodOf(t.date) <= period).length;
  items.push({ label: 'รายการธนาคารกระทบยอดครบ', ok: unmatched === 0,
    detail: unmatched === 0 ? 'ครบ' : 'ค้าง ' + unmatched + ' รายการ', blocking: false, action: 'bank' });

  return { period, items, canClose: items.filter((i) => i.blocking).every((i) => i.ok) };
}

function closePeriod(period) {
  const chk = closeChecklist(period);
  if (!chk.canClose) {
    throw new DomainError('CLOSE_BLOCKED',
      'ปิดงวดไม่ได้ เพราะยังมีรายการที่ต้องเคลียร์: '
        + chk.items.filter((i) => i.blocking && !i.ok).map((i) => i.label).join(', '));
  }
  const p = DB.periods.find((x) => x.code === period);
  if (!p) throw new DomainError('PERIOD_NOT_FOUND', 'ไม่พบงวด ' + period);
  p.status = 'closed';
  audit('period', period, 'close', { status: 'open' }, { status: 'closed' });
  return p;
}
function reopenPeriod(period, reason) {
  if (!reason || reason.trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การเปิดงวดที่ปิดแล้วต้องระบุเหตุผล');
  }
  const p = DB.periods.find((x) => x.code === period);
  if (!p) throw new DomainError('PERIOD_NOT_FOUND', 'ไม่พบงวด ' + period);
  p.status = 'open';
  audit('period', period, 'reopen', { status: 'closed' }, { status: 'open' }, reason.trim());
  return p;
}

/* ---------- กระทบยอดธนาคาร ---------- */
function matchBankTxn(id, entryNo) {
  const t = DB.bankTxns.find((x) => x.id === id);
  if (!t) throw new DomainError('TXN_NOT_FOUND', 'ไม่พบรายการเดินบัญชีนี้');
  t.matched = true;
  t.matchedTo = entryNo || 'จับคู่ด้วยตนเอง';
  audit('bank_txn', String(id), 'match', null, { to: t.matchedTo });
  return t;
}
function bookBankTxn(id, accountCode, desc) {
  const t = DB.bankTxns.find((x) => x.id === id);
  if (!t) throw new DomainError('TXN_NOT_FOUND', 'ไม่พบรายการเดินบัญชีนี้');
  if (t.matched) throw new DomainError('ALREADY_MATCHED', 'รายการนี้จับคู่แล้ว');
  const je = post({
    type: 'general', date: t.date, desc: desc || t.desc,
    src: 'bank', srcId: String(id),
    lines: t.credit > 0
      ? [{ acc: accBySub('bank'), dr: t.credit }, { acc: accountCode, cr: t.credit }]
      : [{ acc: accountCode, dr: t.debit }, { acc: accBySub('bank'), cr: t.debit }],
  });
  t.matched = true;
  t.matchedTo = je.no;
  return je;
}

/* ===================================================================
   ใบวางบิล — รวบใบกำกับที่ค้างชำระของลูกค้ารายเดียวไปวางเก็บเงินครั้งเดียว
   ไม่มีผลทางบัญชี ตัวเลขเข้าบัญชีตอนรับชำระ (ออกใบเสร็จ) เท่านั้น
   =================================================================== */
function billingNoteFind(no) {
  const b = DB.docs.billingNote.find((x) => x.no === no);
  if (!b) throw new DomainError('BILLING_NOTE_NOT_FOUND', 'ไม่พบใบวางบิล ' + no);
  return b;
}

/** ยอดที่ยังเก็บไม่ได้ของใบวางบิล — คิดจากใบกำกับจริง ณ ตอนนี้เสมอ ไม่เก็บซ้ำไว้ในเอกสาร */
function billingNoteOutstanding(bn) {
  return bn.invoices.reduce(function (s, r) {
    const inv = DB.docs.invoice.find((d) => d.no === r.no);
    return s + (inv ? Math.max(0, invOutstanding(inv)) : 0);
  }, 0);
}

function billingNoteStatus(bn) {
  if (bn.status === 'cancelled') return 'cancelled';
  const out = billingNoteOutstanding(bn);
  if (out <= 0) return 'paid';
  return out < bn.total ? 'partially_paid' : 'issued';
}

function issueBillingNote(input) {
  const p = partnerByCode(input.partnerCode);
  if (p.kind !== 'customer') {
    throw new DomainError('PARTNER_WRONG_SIDE', 'ใบวางบิลออกให้ลูกค้าเท่านั้น แต่ ' + p.name + ' อยู่ในทะเบียนผู้ขาย');
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่วางบิล');
  const dueDate = input.dueDate || input.date;
  if (dueDate < input.date) {
    throw new DomainError('BILLING_DUE_BEFORE_DATE', 'วันนัดชำระต้องไม่ก่อนวันที่วางบิล');
  }
  const nos = Array.from(new Set(input.invoiceNos || []));
  if (!nos.length) {
    throw new DomainError('BILLING_NO_INVOICE', 'ต้องเลือกใบกำกับภาษีอย่างน้อย 1 ใบ',
      'ลูกค้ารายนี้อาจไม่มีใบกำกับที่ค้างชำระ');
  }
  const rows = nos.map(function (no) {
    const inv = DB.docs.invoice.find((d) => d.no === no);
    if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + no);
    if (inv.partnerCode !== p.code) {
      throw new DomainError('BILLING_PARTNER_MISMATCH',
        'ใบกำกับ ' + no + ' เป็นของ ' + inv.partnerName + ' วางบิลรวมกับ ' + p.name + ' ไม่ได้');
    }
    const out = invOutstanding(inv);
    if (inv.status === 'void' || out <= 0) {
      throw new DomainError('BILLING_INVOICE_SETTLED', 'ใบกำกับ ' + no + ' ไม่มียอดค้างชำระแล้ว');
    }
    if (inv.date > input.date) {
      throw new DomainError('BILLING_BEFORE_INVOICE',
        'ใบกำกับ ' + no + ' ออกวันที่ ' + thDate(inv.date) + ' หลังวันที่วางบิล');
    }
    const taken = DB.docs.billingNote.find((b) => b.invoices.some((x) => x.no === no)
      && ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0);
    if (taken) {
      throw new DomainError('BILLING_INVOICE_TAKEN',
        'ใบกำกับ ' + no + ' อยู่ในใบวางบิล ' + taken.no + ' ที่ยังเก็บเงินไม่ครบแล้ว',
        'ยกเลิกใบวางบิลเดิมก่อน ถ้าต้องการวางบิลใหม่');
    }
    return { no: inv.no, date: inv.date, due: inv.due, total: inv.total, amount: out };
  });
  const no = nextNo('billingNote', input.date);
  const doc = {
    no, date: input.date, dueDate, partnerCode: p.code, partnerName: p.name, snap: snapshotPartner(p),
    invoices: rows, total: rows.reduce((s, r) => s + r.amount, 0),
    note: input.note || '', status: 'issued', receipts: [],
  };
  DB.docs.billingNote.unshift(doc);
  audit('billingNote', no, 'issue', null, { partner: p.name, invoices: rows.length, total: fmt(doc.total) });
  return doc;
}

function cancelBillingNote(no, reason) {
  const bn = billingNoteFind(no);
  const st = billingNoteStatus(bn);
  if (st === 'cancelled') throw new DomainError('ALREADY_CANCELLED', 'ใบวางบิล ' + no + ' ยกเลิกไปแล้ว');
  if (st === 'paid') throw new DomainError('BILLING_ALREADY_PAID', 'ใบวางบิล ' + no + ' เก็บเงินครบแล้ว ยกเลิกไม่ได้');
  bn.status = 'cancelled';
  if (reason) bn.statusReason = reason;
  audit('billingNote', no, 'cancelled', null, reason ? { reason } : null);
  return bn;
}

/** รับชำระทั้งใบวางบิล — ออกใบเสร็จให้ทุกใบกำกับที่ยังค้าง ล้มใบเดียวก็ยกเลิกทั้งชุด */
function receiveBillingNote(no, input) {
  const bn = billingNoteFind(no);
  const st = billingNoteStatus(bn);
  if (st === 'cancelled') throw new DomainError('BILLING_CANCELLED', 'ใบวางบิล ' + no + ' ถูกยกเลิกแล้ว');
  if (st === 'paid') throw new DomainError('ALREADY_PAID', 'ใบวางบิล ' + no + ' เก็บเงินครบแล้ว');
  return atomically(function () {
    const made = [];
    bn.invoices.forEach(function (r) {
      const inv = DB.docs.invoice.find((d) => d.no === r.no);
      if (!inv || invOutstanding(inv) <= 0) return;
      const rc = receivePayment({ invoiceNo: inv.no, date: input.date, method: input.method,
        whtCode: input.whtCode || null, bankAccount: input.bankAccount });
      rc.billingNoteNo = bn.no;
      made.push(rc);
    });
    bn.receipts = (bn.receipts || []).concat(made.map((r) => r.no));
    audit('billingNote', no, 'receive', null, { receipts: made.map((r) => r.no).join(', ') });
    return made;
  });
}

/* ===================================================================
   ใบรับสินค้า — ของเข้าคลังก่อนใบกำกับจากผู้ขายจะมาถึง
   Dr สินค้าคงเหลือ / Cr พักรับสินค้า แล้วล้างพักรับสินค้าตอนตั้งหนี้
   =================================================================== */
/** ตรวจงวดก่อนจองเลขที่เอกสาร — ถ้าปล่อยไปล้มที่ post() เลขที่ถูกจองไปแล้วจะเกิดช่องว่างในทะเบียน */
function assertPostingOpen(date) {
  const p = periodFor(date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวดบัญชี ' + thPeriod(p.code) + ' ปิดแล้ว ลงรายการไม่ได้',
      'เปลี่ยนวันที่เป็นงวดที่ยังเปิดอยู่ หรือเปิดงวดใหม่ในหน้าปิดงวด');
  }
}

function goodsReceiptFind(no) {
  const g = DB.docs.goodsReceipt.find((x) => x.no === no);
  if (!g) throw new DomainError('GRN_NOT_FOUND', 'ไม่พบใบรับสินค้า ' + no);
  return g;
}

function issueGoodsReceipt(input) {
  const p = partnerByCode(input.partnerCode);
  if (p.kind !== 'vendor') {
    throw new DomainError('PARTNER_WRONG_SIDE', 'ใบรับสินค้าต้องรับจากผู้ขาย แต่ ' + p.name + ' อยู่ในทะเบียนลูกค้า');
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่รับสินค้า');
  const lines = (input.lines || []).filter((l) => (l.itemCode || String(l.desc || '').trim()) && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการสินค้าอย่างน้อย 1 บรรทัด');
  const rows = lines.map(function (l, i) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    if (!it || it.type !== 'stock') {
      throw new DomainError('GRN_NOT_STOCK',
        'บรรทัดที่ ' + (i + 1) + ' ไม่ใช่สินค้าที่มีสต๊อก ใบรับสินค้าใช้รับของเข้าคลังเท่านั้น',
        'ค่าบริการหรือของที่ไม่เข้าคลัง ให้บันทึกค่าใช้จ่ายหรือตั้งหนี้ผู้ขายโดยตรง');
    }
    if (!(Number(l.qty) > 0)) {
      throw new DomainError('GRN_QTY_INVALID', 'บรรทัดที่ ' + (i + 1) + ' จำนวนที่รับต้องมากกว่าศูนย์');
    }
    if (M(l.price) < 0) throw new DomainError('GRN_PRICE_INVALID', 'บรรทัดที่ ' + (i + 1) + ' ราคาทุนติดลบไม่ได้');
    return { itemCode: it.code, desc: String(l.desc || '').trim() || it.name, qty: Number(l.qty), uom: it.uom,
      price: M(l.price), amount: round2(mulQty(M(l.price), l.qty)), taxCode: l.taxCode || 'VAT7' };
  });
  const total = rows.reduce((s, r) => s + r.amount, 0);
  assertPostingOpen(input.date);
  const no = nextNo('goodsReceipt', input.date);
  const doNo = String(input.vendorDoNo || '').trim();

  const je = post({
    type: 'purchase', date: input.date,
    desc: 'รับสินค้าจาก ' + p.name + ' (' + no + (doNo ? ' · ใบส่งของ ' + doNo : '') + ')',
    src: 'goodsReceipt', srcId: no,
    lines: [{ acc: accBySub('inventory'), dr: total }, { acc: accBySub('grni'), cr: total }],
  });
  rows.forEach(function (r) {
    const it = DB.items.find((x) => x.code === r.itemCode);
    it.qty = roundQty(it.qty + r.qty);
    it.value += r.amount;
    it.avgCost = unitCost(it.value, it.qty);
    DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'in', qty: r.qty, cost: r.amount, src: no, balance: it.qty });
  });

  const doc = {
    no, date: input.date, partnerCode: p.code, partnerName: p.name, vendorDoNo: doNo || null,
    poNo: input.poNo || null, lines: rows, total, note: input.note || '',
    status: 'received', entryNo: je.no, billNo: null, billDate: null,
  };
  DB.docs.goodsReceipt.unshift(doc);
  audit('goodsReceipt', no, 'receive', null, { vendor: p.name, total: fmt(total) });
  return doc;
}

/** รับสินค้าตามใบสั่งซื้อ — ใบสั่งซื้อปิดและชี้ไปที่ใบรับสินค้า */
function receiveGoodsFromPo(poNo, input) {
  const po = tradeDocFind('purchaseOrder', poNo);
  if (po.status === 'closed') {
    throw new DomainError('TRADE_DOC_ALREADY_CONVERTED', 'ใบสั่งซื้อ ' + poNo + ' ถูกแปลงเป็น ' + po.convertedTo + ' ไปแล้ว');
  }
  if (po.status === 'cancelled' || po.status === 'rejected') {
    throw new DomainError('TRADE_DOC_NOT_ACTIVE', 'ใบสั่งซื้อ ' + poNo + ' อยู่ในสถานะ ' + po.status + ' รับสินค้าไม่ได้');
  }
  const notStock = po.lines.filter(function (l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    return !it || it.type !== 'stock';
  });
  if (notStock.length) {
    throw new DomainError('GRN_PO_HAS_NON_STOCK',
      'ใบสั่งซื้อ ' + poNo + ' มีรายการที่ไม่ใช่สินค้าในคลัง (' + notStock[0].desc + ') จึงรับเข้าคลังไม่ได้',
      'ตั้งหนี้ผู้ขายจากใบสั่งซื้อโดยตรงแทน');
  }
  const opts = input || {};
  const grn = issueGoodsReceipt({
    partnerCode: po.partnerCode, date: opts.date || TODAY, vendorDoNo: opts.vendorDoNo, poNo: po.no,
    lines: po.lines.map((l) => ({ ...l, price: unM(l.price) })), note: po.note,
  });
  po.status = 'closed';
  po.convertedTo = grn.no;
  audit('purchaseOrder', poNo, 'convert', null, { to: grn.no });
  return grn;
}

/** ตั้งหนี้จากใบรับสินค้า เมื่อใบกำกับภาษีของผู้ขายมาถึง */
function billGoodsReceipt(grnNo, input) {
  const g = goodsReceiptFind(grnNo);
  if (g.status !== 'received') {
    throw new DomainError('GRN_ALREADY_BILLED', 'ใบรับสินค้า ' + grnNo + ' ตั้งหนี้ไปแล้ว (' + g.billNo + ')');
  }
  if (!String(input.vendorNo || '').trim()) {
    throw new DomainError('VENDOR_INVOICE_NO_REQUIRED', 'ต้องกรอกเลขที่ใบกำกับภาษีของผู้ขายก่อนตั้งหนี้',
      'ดูเลขที่จากใบกำกับที่ผู้ขายส่งมา');
  }
  return recordBill({
    partnerCode: g.partnerCode, date: input.date, vendorNo: String(input.vendorNo).trim(), grnNo: g.no,
    lines: g.lines.map((l) => ({ desc: l.desc, qty: l.qty, price: unM(l.price), itemCode: l.itemCode,
      taxCode: input.taxCode || l.taxCode })),
    nonClaimableVat: !!input.nonClaimableVat, whtCode: input.whtCode || null,
  });
}

/* ===================================================================
   ค่าใช้จ่าย — จ่ายเงินทันทีพร้อมหักภาษี ณ ที่จ่าย
   ★ ถ้ามีการหัก ระบบออกหนังสือรับรอง 50 ทวิ ให้เองในแถบหัก ณ ที่จ่าย
     เอกสารสองใบผูกเลขที่กันไว้ ไม่ต้องไปสร้างซ้ำอีกที่
   =================================================================== */
/* บัญชีที่ระบบลงให้เองจากงานอื่น ไม่เปิดให้เลือกเป็นค่าใช้จ่ายตรง ๆ */
const EXPENSE_SYSTEM_SUBS = ['cogs', 'purchases', 'purchase_return', 'depreciation', 'amortization',
  'sso_expense', 'pvd_expense', 'non_claimable_vat_expense', 'income_tax_expense', 'rounding',
  'inventory_writeoff', 'bad_debt', 'fx_loss', 'loss_on_disposal'];
function expenseAccounts() {
  return DB.accounts.filter((a) => a.postable && (
    (a.type === 'expense' && EXPENSE_SYSTEM_SUBS.indexOf(a.subType) < 0)
    || a.subType === 'prepaid_expense' || a.subType === 'deposit_paid'));
}
const payFromAccounts = () => DB.accounts.filter((a) => a.postable && (a.subType === 'cash' || a.subType === 'bank'));

/** เลขใบกำกับของผู้ขายรายเดียวกันห้ามซ้ำ ไม่ว่าจะบันทึกผ่านตั้งหนี้หรือค่าใช้จ่าย */
function assertVendorInvoiceUnused(partnerCode, docNo) {
  const b = DB.docs.bill.find((x) => x.partnerCode === partnerCode && x.vendorNo === docNo && x.status !== 'void');
  const e = DB.docs.expense.find((x) => x.partnerCode === partnerCode && x.taxInvoiceNo === docNo && x.status !== 'void');
  const dup = b || e;
  if (dup) {
    throw new DomainError('DUPLICATE_VENDOR_INVOICE',
      'บันทึกใบกำกับภาษีซื้อเลขที่ ' + docNo + ' ของผู้ขายรายนี้ไปแล้ว (' + dup.no + ')',
      'ตรวจสอบรายการเดิม หรือแก้เลขที่ใบกำกับให้ถูกต้อง');
  }
}

function recordExpense(input) {
  const p = partnerByCode(input.partnerCode);
  if (p.kind !== 'vendor') {
    throw new DomainError('PARTNER_WRONG_SIDE', 'ผู้รับเงินต้องอยู่ในทะเบียนผู้ขาย แต่ ' + p.name + ' อยู่ในทะเบียนลูกค้า');
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่จ่าย');
  const allowed = new Set(expenseAccounts().map((a) => a.code));
  const lines = (input.lines || []).filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการค่าใช้จ่ายอย่างน้อย 1 บรรทัด');
  lines.forEach(function (l, i) {
    if (!l.acc) {
      throw new DomainError('EXPENSE_ACCOUNT_INVALID', 'บรรทัดที่ ' + (i + 1) + ' ยังไม่ได้เลือกบัญชีค่าใช้จ่าย');
    }
    if (!allowed.has(l.acc)) {
      throw new DomainError('EXPENSE_ACCOUNT_INVALID',
        'บรรทัดที่ ' + (i + 1) + ' บัญชี ' + l.acc + ' ใช้บันทึกค่าใช้จ่ายไม่ได้',
        'เลือกบัญชีหมวดค่าใช้จ่าย ค่าใช้จ่ายจ่ายล่วงหน้า หรือเงินมัดจำ');
    }
    if (M(l.price) < 0) throw new DomainError('EXPENSE_NEGATIVE', 'บรรทัดที่ ' + (i + 1) + ' จำนวนเงินติดลบไม่ได้');
  });

  const v = computeVat(lines, input.date);
  const base = v.std + v.zero + v.exempt;
  const claimable = !input.nonClaimableVat;
  const taxInvoiceNo = String(input.taxInvoiceNo || '').trim();
  if (v.vat > 0 && claimable && !taxInvoiceNo) {
    throw new DomainError('TAX_INVOICE_NO_REQUIRED',
      'มีภาษีซื้อที่จะขอคืน ต้องกรอกเลขที่ใบกำกับภาษีของผู้ขาย',
      'ถ้าไม่มีใบกำกับภาษี ให้เลือกภาษีซื้อต้องห้าม หรือเลือกรายการที่ไม่มีภาษีมูลค่าเพิ่ม');
  }
  if (taxInvoiceNo) assertVendorInvoiceUnused(p.code, taxInvoiceNo);

  const channel = input.channel === 'e_wht' ? 'e_wht' : 'manual';
  const whtCode = input.whtCode || null;
  if (input.requireWht && !whtCode) {
    throw new DomainError('WHT_REQUIRED', 'ต้องเลือกประเภทเงินได้ที่หักภาษี ณ ที่จ่าย');
  }
  let wht = 0, whtRate = null, whtLabel = null;
  if (whtCode) {
    const r = resolveRate(whtCode, input.date, { channel });
    /* จ่ายครั้งหนึ่งต่ำกว่า 1,000 บาทไม่ต้องหัก (ท.ป.4/2528) — กติกาเดียวกับการจ่ายชำระเจ้าหนี้ */
    if (base >= M('1000')) { wht = round2(pct(base, r.rate)); whtRate = r.rate; whtLabel = r.label; }
    else if (input.requireWht) {
      throw new DomainError('WHT_BELOW_THRESHOLD',
        'ยอดจ่ายก่อนภาษี ' + fmt(base) + ' บาท ต่ำกว่า 1,000 บาท ไม่ต้องหักภาษี ณ ที่จ่าย',
        'ตาม ท.ป.4/2528 การจ่ายครั้งหนึ่งต่ำกว่า 1,000 บาทไม่ต้องหัก ให้บันทึกเป็นค่าใช้จ่ายธรรมดา');
    }
  }
  if (wht > 0 && !validTaxId(p.taxId || '')) {
    throw new DomainError('WHT_PAYEE_TAX_ID',
      'ผู้รับเงิน ' + p.name + ' ยังไม่มีเลขประจำตัวผู้เสียภาษีที่ถูกต้อง ออกหนังสือรับรองหัก ณ ที่จ่ายไม่ได้',
      'เพิ่มเลขประจำตัวผู้เสียภาษีในทะเบียนผู้ขายก่อน');
  }
  const payFrom = input.payFrom || accBySub('bank');
  const pa = acc(payFrom);
  if (pa.subType !== 'cash' && pa.subType !== 'bank') {
    throw new DomainError('EXPENSE_PAY_FROM_INVALID', 'ต้องจ่ายจากบัญชีเงินสดหรือเงินฝากธนาคาร');
  }

  const net = v.total - wht;
  assertPostingOpen(input.date);
  const no = nextNo('expense', input.date);
  const individual = p.entityType === 'individual';
  const debit = {};
  lines.forEach(function (l) { debit[l.acc] = (debit[l.acc] || 0) + round2(mulQty(M(l.price), l.qty)); });
  if (!claimable && v.vat) {
    const a = accBySub('non_claimable_vat_expense');
    debit[a] = (debit[a] || 0) + v.vat;
  }
  const je = post({
    type: 'payment', date: input.date,
    desc: 'ค่าใช้จ่าย ' + p.name + ' (' + no + ')',
    src: 'expense', srcId: no,
    lines: Object.keys(debit).map((a) => ({ acc: a, dr: debit[a] }))
      .concat(claimable && v.vat ? [{ acc: accBySub('input_vat'), dr: v.vat }] : [])
      .concat(wht && channel === 'manual' ? [{ acc: accBySub(individual ? 'wht_payable_pnd3' : 'wht_payable_pnd53'), cr: wht }] : [])
      .concat([{ acc: payFrom, cr: net, memo: wht ? 'จ่ายผู้รับเงินสุทธิ' : null }])
      .concat(wht && channel === 'e_wht' ? [{ acc: payFrom, cr: wht, memo: 'ภาษีหัก ณ ที่จ่ายที่ธนาคารนำส่งผ่าน e-Withholding Tax' }] : []),
  });

  if (v.vat > 0 || taxInvoiceNo) {
    DB.taxTx.push({
      kind: 'vat_input', period: periodOf(input.date), date: input.date,
      docNo: taxInvoiceNo || no, docType: 'tax_invoice',
      partnerName: p.name, taxId: p.taxId, branch: p.branch,
      base: v.std, zero: v.zero, exempt: v.exempt, tax: claimable ? v.vat : 0,
      nonClaimable: claimable ? 0 : v.vat, entryNo: je.no, filingId: null, expenseNo: no,
    });
  }

  let certNo = null;
  if (wht > 0) {
    if (channel === 'manual') {
      certNo = nextNo('whtCert', input.date);
      DB.docs.whtCert.unshift({
        no: certNo, date: input.date, partnerCode: p.code, partnerName: p.name,
        taxId: p.taxId, form: individual ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53',
        incomeType: whtLabel, base, wht, rate: whtRate, sent: false,
        paymentNo: null, expenseNo: no,
      });
    }
    DB.taxTx.push({
      kind: 'wht', period: periodOf(input.date), date: input.date,
      docNo: no, docType: 'expense',
      partnerName: p.name, taxId: p.taxId, branch: p.branch, entityType: p.entityType,
      base, tax: wht, rate: whtRate, channel, incomeType: whtLabel,
      form: individual ? 'PND3' : 'PND53', certNo, entryNo: je.no, filingId: null,
    });
  }

  const doc = {
    no, date: input.date, partnerCode: p.code, partnerName: p.name, taxInvoiceNo: taxInvoiceNo || null,
    lines: lines.map((l) => ({ desc: String(l.desc).trim(), acc: l.acc, accName: acc(l.acc).name,
      qty: Number(l.qty), price: M(l.price), amount: round2(mulQty(M(l.price), l.qty)),
      taxCode: l.taxCode || 'VAT7' })),
    base, vat: v.vat, total: v.total, claimable,
    whtCode, wht, whtRate, net, channel, payFrom, method: input.method || 'transfer',
    certNo, entryNo: je.no, status: 'paid', note: input.note || '',
  };
  DB.docs.expense.unshift(doc);
  audit('expense', no, 'create', null, { payee: p.name, net: fmt(net), wht: fmt(wht), cert: certNo });
  return doc;
}

/* ===================================================================
   เตรียมจ่ายเงิน — รวบรายการตั้งหนี้ที่ถึงกำหนด ส่งอนุมัติ แล้วจ่ายรวดเดียว
   จัดทำ → อนุมัติ → จ่าย ระบบออกใบสำคัญจ่ายและ 50 ทวิ ให้ทุกราย
   =================================================================== */
function paymentBatchFind(no) {
  const b = DB.docs.paymentBatch.find((x) => x.no === no);
  if (!b) throw new DomainError('PAYMENT_BATCH_NOT_FOUND', 'ไม่พบใบเตรียมจ่าย ' + no);
  return b;
}
const paymentBatchActive = (b) => b.status === 'pending_approval' || b.status === 'approved';

/** ภาษีหัก ณ ที่จ่ายโดยประมาณ — สูตรเดียวกับตอนจ่ายจริง ผู้อนุมัติจะได้เห็นเงินที่ออกจริง */
function estimateBillWht(bill, amount, date, channel) {
  return billWhtFor(bill, amount, date, channel || 'manual', bill.whtCode).wht;
}

function createPaymentBatch(input) {
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่จัดทำ');
  const payDate = input.payDate || input.date;
  if (payDate < input.date) {
    throw new DomainError('PAYDATE_BEFORE_DATE', 'วันที่จะจ่ายต้องไม่ก่อนวันที่จัดทำใบเตรียมจ่าย');
  }
  const nos = Array.from(new Set(input.billNos || []));
  if (!nos.length) {
    throw new DomainError('PAYMENT_BATCH_EMPTY', 'ต้องเลือกรายการตั้งหนี้อย่างน้อย 1 รายการ');
  }
  const items = nos.map(function (no) {
    const b = DB.docs.bill.find((x) => x.no === no);
    if (!b) throw new DomainError('BILL_NOT_FOUND', 'ไม่พบรายการตั้งหนี้ ' + no);
    if (b.status === 'void') throw new DomainError('BILL_VOID', 'รายการตั้งหนี้ ' + no + ' ถูกยกเลิกไปแล้ว');
    const out = billOutstanding(b);
    if (out <= 0) throw new DomainError('ALREADY_PAID', 'รายการตั้งหนี้ ' + no + ' จ่ายครบแล้ว');
    const taken = DB.docs.paymentBatch.find((x) => paymentBatchActive(x) && x.items.some((i) => i.billNo === no));
    if (taken) {
      throw new DomainError('PAYMENT_BATCH_TAKEN', 'รายการตั้งหนี้ ' + no + ' อยู่ในใบเตรียมจ่าย ' + taken.no + ' แล้ว',
        'ยกเลิกใบเตรียมจ่ายเดิมก่อน ถ้าต้องการจัดชุดใหม่');
    }
    const wht = estimateBillWht(b, out, payDate);
    return { billNo: b.no, partnerCode: b.partnerCode, partnerName: b.partnerName, vendorNo: b.vendorNo,
      due: b.due, amount: out, whtCode: b.whtCode || null, wht, net: out - wht, paymentNo: null };
  });
  const no = nextNo('paymentBatch', input.date);
  const sum = (k) => items.reduce((s, i) => s + i[k], 0);
  const doc = {
    no, date: input.date, payDate, items, total: sum('amount'), wht: sum('wht'), net: sum('net'),
    note: input.note || '', status: 'pending_approval', approvedAt: null, paidDate: null, paymentNos: [],
  };
  DB.docs.paymentBatch.unshift(doc);
  audit('paymentBatch', no, 'create', null, { bills: items.length, net: fmt(doc.net) });
  return doc;
}

function approvePaymentBatch(no) {
  const b = paymentBatchFind(no);
  if (b.status !== 'pending_approval') {
    throw new DomainError('PAYMENT_BATCH_NOT_PENDING', 'ใบเตรียมจ่าย ' + no + ' ไม่ได้อยู่ในสถานะรออนุมัติ');
  }
  b.status = 'approved';
  b.approvedAt = new Date().toISOString();
  audit('paymentBatch', no, 'approved', { status: 'pending_approval' }, { status: 'approved' });
  return b;
}

function cancelPaymentBatch(no, reason) {
  const b = paymentBatchFind(no);
  if (!paymentBatchActive(b)) {
    throw new DomainError('PAYMENT_BATCH_CLOSED', 'ใบเตรียมจ่าย ' + no + ' จ่ายแล้วหรือยกเลิกไปแล้ว');
  }
  b.status = 'cancelled';
  if (reason) b.statusReason = reason;
  audit('paymentBatch', no, 'cancelled', null, reason ? { reason } : null);
  return b;
}

/** จ่ายตามใบเตรียมจ่าย — ทุกรายการจ่ายครบหรือไม่จ่ายเลยสักราย */
function payPaymentBatch(no, input) {
  const b = paymentBatchFind(no);
  if (b.status === 'pending_approval') {
    throw new DomainError('PAYMENT_BATCH_NOT_APPROVED', 'ใบเตรียมจ่าย ' + no + ' ยังไม่ได้อนุมัติ',
      'กดอนุมัติก่อน แล้วจึงจ่าย');
  }
  if (b.status !== 'approved') {
    throw new DomainError('PAYMENT_BATCH_CLOSED', 'ใบเตรียมจ่าย ' + no + ' จ่ายแล้วหรือยกเลิกไปแล้ว');
  }
  const opts = input || {};
  const date = opts.date || b.payDate;
  const channel = opts.channel === 'e_wht' ? 'e_wht' : 'manual';
  return atomically(function () {
    const made = [];
    b.items.forEach(function (it) {
      const bill = DB.docs.bill.find((x) => x.no === it.billNo);
      const out = bill ? billOutstanding(bill) : 0;
      if (out <= 0) { it.skipped = 'จ่ายครบไปก่อนแล้ว'; return; }
      const pv = payBill({ billNo: bill.no, date, amount: unM(Math.min(it.amount, out)),
        whtCode: bill.whtCode || null, channel, bankAccount: opts.bankAccount });
      pv.batchNo = b.no;
      it.paymentNo = pv.no;
      made.push(pv);
    });
    if (!made.length) {
      throw new DomainError('PAYMENT_BATCH_NOTHING', 'ทุกรายการในใบเตรียมจ่าย ' + no + ' จ่ายครบไปแล้ว',
        'ยกเลิกใบเตรียมจ่ายนี้ได้เลย');
    }
    b.status = 'paid';
    b.paidDate = date;
    b.paymentNos = made.map((p) => p.no);
    audit('paymentBatch', no, 'paid', null, { payments: b.paymentNos.join(', ') });
    return made;
  });
}

/* ===================================================================
   สมุดรายวัน 5 เล่ม — บันทึกรายการด้วยมือ (ใบสำคัญ) ได้ในแต่ละเล่ม
   =================================================================== */
const JOURNAL_BOOKS = {
  general:  { label:'สมุดรายวันทั่วไป', voucher:'ใบสำคัญทั่วไป' },
  purchase: { label:'สมุดรายวันซื้อ',   voucher:'ใบสำคัญซื้อ' },
  sales:    { label:'สมุดรายวันขาย',    voucher:'ใบสำคัญขาย' },
  payment:  { label:'สมุดรายวันจ่าย',    voucher:'ใบสำคัญจ่าย' },
  receipt:  { label:'สมุดรายวันรับ',     voucher:'ใบสำคัญรับ' },
};
/** ใบสำคัญประเภทอื่น (ปรับปรุง เงินเดือน ค่าเสื่อม สินค้า ยอดยกมา) อยู่ในเล่มทั่วไป */
const journalOf = (e) => (e.type !== 'general' && JOURNAL_BOOKS[e.type] ? e.type : 'general');

/* บัญชีคุมที่มีทะเบียนย่อยหรือแบบภาษีรองรับ ต้องเกิดจากเอกสารเท่านั้น
   ถ้าเปิดให้ลงด้วยมือ ยอดคุมจะไม่ตรงทะเบียน และแบบที่ยื่นจะไม่ตรงบัญชี */
const CONTROL_SUBS = {
  trade_receivable: 'ลูกหนี้ต้องมาจากใบกำกับภาษี ใบลดหนี้ ใบเพิ่มหนี้ หรือใบเสร็จรับเงิน',
  trade_payable: 'เจ้าหนี้ต้องมาจากการตั้งหนี้ผู้ขาย ใบสำคัญจ่าย หรือใบเตรียมจ่าย',
  output_vat: 'ภาษีขายต้องมาจากใบกำกับภาษี ใบลดหนี้ หรือใบเพิ่มหนี้',
  input_vat: 'ภาษีซื้อต้องมาจากการตั้งหนี้หรือบันทึกค่าใช้จ่ายที่มีใบกำกับภาษี',
  grni: 'พักรับสินค้าต้องมาจากใบรับสินค้า และล้างออกตอนตั้งหนี้จากใบรับสินค้า',
  wht_payable_pnd1: 'ภาษีหัก ณ ที่จ่ายจากเงินเดือนมาจากการทำเงินเดือน',
  wht_payable_pnd3: 'ภาษีหัก ณ ที่จ่ายต้องมาจากค่าใช้จ่ายหรือการจ่ายชำระที่ออก 50 ทวิ',
  wht_payable_pnd53: 'ภาษีหัก ณ ที่จ่ายต้องมาจากค่าใช้จ่ายหรือการจ่ายชำระที่ออก 50 ทวิ',
};
const isCashAcc = (code) => CASH_SUB.indexOf(acc(code).subType) >= 0;

function postJournalVoucher(input) {
  const book = JOURNAL_BOOKS[input.book] ? input.book : null;
  if (!book) throw new DomainError('JOURNAL_BOOK_UNKNOWN', 'ไม่รู้จักสมุดรายวัน ' + input.book);
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่');
  const desc = String(input.desc || '').trim();
  if (!desc) throw new DomainError('DESC_REQUIRED', 'ต้องมีคำอธิบายรายการ', 'ผู้สอบบัญชีต้องอ่านแล้วเข้าใจว่าเป็นรายการอะไร');
  const lines = (input.lines || [])
    .map((l) => ({ acc: l.acc, dr: M(String(l.dr || '')), cr: M(String(l.cr || '')),
      memo: String(l.memo || '').trim() || null }))
    .filter((l) => l.acc && (l.dr !== 0 || l.cr !== 0));
  lines.forEach(function (l, i) {
    const a = acc(l.acc);
    if (CONTROL_SUBS[a.subType]) {
      throw new DomainError('CONTROL_ACCOUNT_MANUAL',
        'บัญชี ' + a.code + ' ' + a.name + ' เป็นบัญชีคุม บันทึกด้วยมือไม่ได้', CONTROL_SUBS[a.subType]);
    }
    if (l.dr < 0 || l.cr < 0) {
      throw new DomainError('LINE_NEGATIVE', 'บรรทัดที่ ' + (i + 1) + ' จำนวนเงินติดลบไม่ได้', 'ย้ายไปใส่อีกฝั่งแทน');
    }
  });
  const cashIn = lines.filter((l) => isCashAcc(l.acc)).reduce((s, l) => s + l.dr - l.cr, 0);
  const hasCash = lines.some((l) => isCashAcc(l.acc));
  /* แต่ละเล่มรับเฉพาะรายการของเล่มนั้น — แบบเดียวกับสมุดรายวันเฉพาะในตำราบัญชี */
  if (book === 'receipt' && !lines.some((l) => isCashAcc(l.acc) && l.dr > 0)) {
    throw new DomainError('JOURNAL_RECEIPT_NEEDS_CASH',
      'สมุดรายวันรับต้องมีเงินเข้าเงินสดหรือเงินฝากธนาคาร (ฝั่งเดบิต) อย่างน้อยหนึ่งบรรทัด',
      'รายการที่ไม่มีเงินเข้า ให้บันทึกในสมุดรายวันทั่วไป');
  }
  if (book === 'payment' && !lines.some((l) => isCashAcc(l.acc) && l.cr > 0)) {
    throw new DomainError('JOURNAL_PAYMENT_NEEDS_CASH',
      'สมุดรายวันจ่ายต้องมีเงินออกจากเงินสดหรือเงินฝากธนาคาร (ฝั่งเครดิต) อย่างน้อยหนึ่งบรรทัด',
      'รายการที่ไม่มีเงินออก ให้บันทึกในสมุดรายวันทั่วไป');
  }
  if ((book === 'sales' || book === 'purchase') && hasCash) {
    throw new DomainError('JOURNAL_CREDIT_ONLY',
      JOURNAL_BOOKS[book].label + 'ใช้กับรายการเงินเชื่อเท่านั้น',
      'รายการที่รับหรือจ่ายเงินทันที ให้บันทึกในสมุดรายวันรับหรือสมุดรายวันจ่าย');
  }
  if (book === 'sales' && !lines.some((l) => acc(l.acc).type === 'revenue')) {
    throw new DomainError('JOURNAL_SALES_NEEDS_REVENUE', 'สมุดรายวันขายต้องมีบัญชีรายได้อย่างน้อยหนึ่งบรรทัด');
  }
  if (book === 'purchase' && !lines.some((l) => l.dr > 0 && ['expense', 'asset'].indexOf(acc(l.acc).type) >= 0)) {
    throw new DomainError('JOURNAL_PURCHASE_NEEDS_DEBIT',
      'สมุดรายวันซื้อต้องมีบัญชีค่าใช้จ่ายหรือสินทรัพย์ฝั่งเดบิตอย่างน้อยหนึ่งบรรทัด');
  }
  if (book === 'general' && cashIn !== 0) {
    throw new DomainError('JOURNAL_GENERAL_HAS_CASH',
      'รายการนี้มีเงิน' + (cashIn > 0 ? 'เข้า' : 'ออก') + ' ' + fmt(Math.abs(cashIn)) + ' บาท ไม่ควรอยู่ในสมุดรายวันทั่วไป',
      'บันทึกใน' + (cashIn > 0 ? 'สมุดรายวันรับ' : 'สมุดรายวันจ่าย') + 'แทน · โอนเงินระหว่างบัญชีของบริษัทเองบันทึกในเล่มทั่วไปได้');
  }
  return post({
    type: book, date: input.date, desc, src: 'manual',
    srcId: String(input.ref || '').trim() || null, lines,
  });
}

/* ===================================================================
   ข้อมูลกิจการ — พิมพ์ลงเอกสารทุกใบ ต้องครบตามมาตรา 86/4 ก่อนออกใบกำกับภาษี
   =================================================================== */
function saveCompany(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('COMPANY_NAME_REQUIRED', 'ต้องมีชื่อผู้ประกอบการ');
  const taxId = String(input.taxId || '').trim();
  if (taxId && !validTaxId(taxId)) {
    throw new DomainError('TAX_ID_INVALID', 'เลขประจำตัวผู้เสียภาษี ' + taxId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ตรวจเลขกับหนังสือรับรองของบริษัท');
  }
  const branch = String(input.branch || '00000').trim();
  if (!/^\d{5}$/.test(branch)) {
    throw new DomainError('BRANCH_INVALID', 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก', 'สำนักงานใหญ่ใช้ 00000 · สาขาที่ 1 ใช้ 00001');
  }
  const before = { name: DB.company.name, taxId: DB.company.taxId, address: DB.company.address };
  Object.assign(DB.company, {
    name, nameEn: String(input.nameEn || '').trim(), taxId, regNo: taxId || DB.company.regNo,
    address: String(input.address || '').trim(), branch,
    branchName: branch === '00000' ? 'สำนักงานใหญ่' : 'สาขาที่ ' + branch,
    phone: String(input.phone || '').trim(), vatRegistered: input.vatRegistered !== false,
    bookkeeper: String(input.bookkeeper || '').trim(), auditor: String(input.auditor || '').trim(),
  });
  audit('company', 'profile', 'update', before, { name, taxId, address: DB.company.address });
  return DB.company;
}

/** ข้อมูลที่ยังขาดสำหรับใบกำกับภาษี — แสดงเตือนในหน้าข้อมูลกิจการ */
function companyGaps() {
  const c = DB.company || {};
  const out = [];
  if (!c.name) out.push('ชื่อผู้ประกอบการ');
  if (!c.taxId) out.push('เลขประจำตัวผู้เสียภาษี');
  if (!c.address) out.push('ที่อยู่สถานประกอบการ');
  return out;
}

/* ===================================================================
   ยกเลิกเอกสาร — กลับทุกอย่างที่เอกสารเคยแตะในชุดเดียว
   ใบสำคัญ (กลับรายการ ณ วันที่เดิม) · ลูกหนี้/เจ้าหนี้รายตัว · สต๊อก · ทะเบียนภาษี · 50 ทวิ
   เลขที่เอกสารยังอยู่และขึ้นว่า "ยกเลิก" ทะเบียนจึงไม่มีเลขขาดช่วง
   =================================================================== */
const VOIDABLE = {
  invoice:      { label:'ใบกำกับภาษี', src:'invoice' },
  receipt:      { label:'ใบเสร็จรับเงิน', src:'receipt' },
  creditNote:   { label:'ใบลดหนี้', src:'creditNote' },
  debitNote:    { label:'ใบเพิ่มหนี้', src:'debitNote' },
  bill:         { label:'รายการตั้งหนี้', src:'bill' },
  payment:      { label:'ใบสำคัญจ่าย', src:'payment' },
  expense:      { label:'ค่าใช้จ่าย', src:'expense' },
  goodsReceipt: { label:'ใบรับสินค้า', src:'goodsReceipt' },
  customerRefund: { label:'ใบคืนเงินลูกค้า', src:'customerRefund' },
};
const liveDoc = (d) => !!d && d.status !== 'void';

/** แถวในทะเบียนภาษีที่เกิดจากเอกสารใบนี้ */
function taxRowsOf(kind, d) {
  return DB.taxTx.filter(function (t) {
    if (t.void) return false;
    if (kind === 'invoice') return t.kind === 'vat_output' && t.docType === 'tax_invoice' && t.docNo === d.no;
    if (kind === 'creditNote') return t.kind === 'vat_output' && t.docType === 'credit_note' && t.docNo === d.no;
    if (kind === 'debitNote') return t.kind === 'vat_output' && t.docType === 'debit_note' && t.docNo === d.no;
    if (kind === 'bill') return t.kind === 'vat_input' && t.entryNo === d.entryNo;
    if (kind === 'expense') return (t.kind === 'vat_input' && t.expenseNo === d.no) || (t.kind === 'wht' && t.docNo === d.no);
    if (kind === 'payment') return t.kind === 'wht' && t.docNo === d.no;
    return false;
  });
}

/** สิ่งที่ยังอ้างถึงเอกสารใบนี้อยู่ — ต้องยกเลิกก่อน ไม่งั้นจะมีเอกสารกำพร้า */
function voidBlockers(kind, d) {
  const out = [];
  const refs = (coll, key) => (DB.docs[coll] || []).filter((x) => x[key] === d.no && liveDoc(x)).map((x) => x.no);
  /* คืนเงินลูกค้าไปแล้ว ยกเลิกใบลดหนี้หรือใบเสร็จที่ทำให้เกิดเครดิตก่อนไม่ได้ — ยอดจะกลับด้านผิดทาง */
  if (kind === 'creditNote' || kind === 'receipt') {
    const f = (DB.docs.customerRefund || []).filter((x) => x.invoiceNo === d.invoiceNo && liveDoc(x)).map((x) => x.no);
    if (f.length) out.push('คืนเงินลูกค้าไปแล้วตาม ' + f.join(', ') + ' ต้องยกเลิกใบคืนเงินก่อน');
  }
  if (kind === 'invoice') {
    const r = refs('receipt', 'invoiceNo'), c = refs('creditNote', 'invoiceNo'), n = refs('debitNote', 'invoiceNo');
    const f = refs('customerRefund', 'invoiceNo');
    if (f.length) out.push('มีใบคืนเงินลูกค้าอ้างถึง ' + f.join(', '));
    if (r.length) out.push('มีใบเสร็จรับเงินอ้างถึง ' + r.join(', '));
    if (c.length) out.push('มีใบลดหนี้อ้างถึง ' + c.join(', '));
    if (n.length) out.push('มีใบเพิ่มหนี้อ้างถึง ' + n.join(', '));
    const bn = DB.docs.billingNote.find((b) => b.invoices.some((i) => i.no === d.no)
      && ['issued', 'partially_paid'].indexOf(billingNoteStatus(b)) >= 0);
    if (bn) out.push('อยู่ในใบวางบิล ' + bn.no + ' ที่ยังเปิดอยู่');
  }
  if (kind === 'bill') {
    const p = refs('payment', 'billNo');
    if (p.length) out.push('มีใบสำคัญจ่ายอ้างถึง ' + p.join(', '));
    const pb = DB.docs.paymentBatch.find((b) => paymentBatchActive(b) && b.items.some((i) => i.billNo === d.no));
    if (pb) out.push('อยู่ในใบเตรียมจ่าย ' + pb.no + ' ที่ยังไม่ได้จ่าย');
  }
  if (kind === 'goodsReceipt' && d.status === 'closed') out.push('ตั้งหนี้ไปแล้ว (' + d.billNo + ') ต้องยกเลิกรายการตั้งหนี้ก่อน');
  /* ของที่รับเข้ามาถูกขายออกไปแล้ว ดึงกลับออกจากคลังไม่ได้ — ต้องขอใบลดหนี้จากผู้ขายแทน */
  if ((kind === 'bill' && !d.grnNo) || kind === 'goodsReceipt' || kind === 'creditNote') {
    DB.docs.stockMove.filter((m) => m.src === d.no && m.dir === 'in').forEach(function (m) {
      const it = DB.items.find((x) => x.code === m.item);
      if (it && it.qty < m.qty) out.push(it.code + ' เหลือในคลัง ' + it.qty + ' ' + it.uom + ' น้อยกว่าที่รับเข้ามา ' + m.qty);
    });
  }
  return out;
}

/** ตรวจทุกเงื่อนไขก่อนยกเลิก — คืนเอกสาร ถ้าไม่ผ่านโยนข้อผิดพลาดที่บอกวิธีแก้ */
function voidCheck(kind, no) {
  const cfg = VOIDABLE[kind];
  if (!cfg) throw new DomainError('VOID_KIND_UNKNOWN', 'เอกสารประเภทนี้ยกเลิกไม่ได้');
  const d = (DB.docs[kind] || []).find((x) => x.no === no);
  if (!d) throw new DomainError('DOC_NOT_FOUND', 'ไม่พบ' + cfg.label + ' ' + no);
  if (d.status === 'void') throw new DomainError('ALREADY_VOID', cfg.label + ' ' + no + ' ยกเลิกไปแล้ว');
  const e = DB.entries.find((x) => x.no === d.entryNo);
  if (d.broughtForward || !e || e.src !== cfg.src || String(e.srcId) !== String(d.no)) {
    throw new DomainError('VOID_NOT_OWN_ENTRY', cfg.label + ' ' + no + ' เป็นยอดยกมาหรือนำเข้าจากระบบเดิม ยกเลิกในระบบนี้ไม่ได้',
      'บันทึกรายการปรับปรุงในสมุดรายวันทั่วไปแทน');
  }
  const blockers = voidBlockers(kind, d);
  if (blockers.length) {
    throw new DomainError('VOID_HAS_DEPENDENTS', 'ยกเลิก' + cfg.label + ' ' + no + ' ไม่ได้ เพราะ' + blockers[0],
      blockers.length > 1 ? 'และ ' + blockers.slice(1).join(' · ') : 'ยกเลิกเอกสารที่อ้างถึงก่อน แล้วค่อยยกเลิกใบนี้');
  }
  const p = periodFor(d.date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ยกเลิก' + cfg.label + 'ในงวดนั้นไม่ได้',
      kind === 'invoice' ? 'ออกใบลดหนี้ในงวดปัจจุบันแทน (มาตรา 86/10)' : 'บันทึกรายการปรับปรุงในงวดปัจจุบันแทน');
  }
  const filed = taxRowsOf(kind, d).find((t) => t.filingId);
  if (filed) {
    const form = filed.kind === 'wht' ? 'ภ.ง.ด.' + String(filed.form || '').replace('PND', '') : 'ภ.พ.30';
    throw new DomainError('TAX_ALREADY_FILED', 'ยื่นแบบ ' + form + ' งวด ' + thPeriod(filed.period) + ' ที่มีเอกสารนี้ไปแล้ว ยกเลิกไม่ได้',
      kind === 'invoice' ? 'ออกใบลดหนี้ในงวดปัจจุบันแทน (มาตรา 86/10)'
        : filed.kind === 'wht' ? 'ยื่นแบบเพิ่มเติมกับกรมสรรพากร แล้วบันทึกปรับปรุงในงวดปัจจุบัน'
        : 'ขอใบลดหนี้จากผู้ขาย แล้วบันทึกในงวดปัจจุบัน');
  }
  if (e.status !== 'posted') throw new DomainError('ALREADY_REVERSED', 'ใบสำคัญของเอกสารนี้ถูกกลับรายการไปแล้ว');
  return d;
}

/** สิ่งที่จะเกิดขึ้นเมื่อยกเลิก — แสดงให้ผู้ใช้เห็นก่อนกดยืนยัน */
function voidPreview(kind, no) {
  const d = voidCheck(kind, no);
  const out = ['กลับรายการใบสำคัญ ' + [d.entryNo, d.cogsEntryNo].filter(Boolean).join(' และ ') + ' ณ วันที่ ' + thDate(d.date)];
  const tax = taxRowsOf(kind, d);
  if (tax.some((t) => t.kind !== 'wht')) out.push('ทะเบียนภาษี' + (kind === 'bill' || kind === 'expense' ? 'ซื้อ' : 'ขาย') + 'แสดงว่า "ยกเลิก" ยอดเป็นศูนย์');
  if (tax.some((t) => t.kind === 'wht')) out.push('ตัดรายการออกจากแบบ ภ.ง.ด. ของงวด');
  if (d.certNo) out.push('ยกเลิกหนังสือรับรอง 50 ทวิ เลขที่ ' + d.certNo);
  if (kind === 'invoice' && d.cogsEntryNo) out.push('คืนสินค้าเข้าคลังตามที่ตัดออกไป');
  if ((kind === 'bill' && !d.grnNo) || kind === 'goodsReceipt' || kind === 'creditNote') {
    if (DB.docs.stockMove.some((m) => m.src === d.no && m.dir === 'in')) {
      out.push(kind === 'creditNote' ? 'นำสินค้าที่รับคืนออกจากคลัง และกลับต้นทุนขายส่วนนั้น' : 'นำสินค้าที่รับเข้าออกจากคลัง');
    }
  }
  if (kind === 'receipt' || kind === 'creditNote' || kind === 'debitNote' || kind === 'customerRefund') out.push('ยอดคงค้างของใบกำกับ ' + d.invoiceNo + ' กลับไปเหมือนก่อนออกใบนี้');
  if (kind === 'payment') out.push('ยอดคงค้างของ ' + d.billNo + ' กลับไปเหมือนก่อนจ่าย');
  if (kind === 'bill' && d.grnNo) out.push('ใบรับสินค้า ' + d.grnNo + ' กลับไปรอตั้งหนี้');
  return out;
}

function stockBack(no, dir) {
  DB.docs.stockMove.filter((m) => m.src === no && m.dir === dir).forEach(function (m) {
    const it = DB.items.find((x) => x.code === m.item);
    if (!it) return;
    const sign = dir === 'out' ? 1 : -1;     // ยกเลิกการขาย = ของกลับเข้า · ยกเลิกการรับ = ของออก
    it.qty = roundQty(it.qty + sign * m.qty);
    it.value += sign * m.cost;
    it.avgCost = it.qty > 0 ? unitCost(it.value, it.qty) : it.avgCost;
    DB.docs.stockMove.push({ date: m.date, item: it.code, dir: dir === 'out' ? 'in' : 'out', qty: m.qty, cost: m.cost,
      src: no + ' (ยกเลิก)', balance: it.qty });
  });
}
function reopenTradeDoc(kind, convertedTo) {
  (DB.docs[kind] || []).forEach(function (x) {
    if (x.convertedTo === convertedTo && x.status === 'closed') { x.status = 'approved'; x.convertedTo = null; }
  });
}
function voidCert(certNo) {
  const c = certNo && DB.docs.whtCert.find((x) => x.no === certNo);
  if (c) c.status = 'void';
}

function voidDocument(kind, no, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกเอกสารต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร',
      'ผู้สอบบัญชีจะเห็นเหตุผลนี้ในร่องรอยการตรวจสอบ');
  }
  const why = String(reason).trim();
  voidCheck(kind, no);
  return atomically(function () {
    const d = DB.docs[kind].find((x) => x.no === no);
    const label = VOIDABLE[kind].label;
    [d.entryNo, d.cogsEntryNo].filter(Boolean).forEach(function (en) {
      const e = DB.entries.find((x) => x.no === en);
      if (e && e.status === 'posted') reverse(en, 'ยกเลิก' + label + ' ' + no + ' — ' + why, d.date, { fromSource: true });
    });
    taxRowsOf(kind, d).forEach(function (t) {
      t.orig = { base: t.base, zero: t.zero || 0, exempt: t.exempt || 0, tax: t.tax, nonClaimable: t.nonClaimable || 0 };
      t.base = 0; t.zero = 0; t.exempt = 0; t.tax = 0; t.nonClaimable = 0;
      t.void = true; t.voidReason = why;
    });
    const inv = d.invoiceNo ? DB.docs.invoice.find((x) => x.no === d.invoiceNo) : null;
    if (kind === 'invoice') { stockBack(no, 'out'); reopenTradeDoc('salesOrder', no); }
    if (kind === 'receipt') { inv.paid -= d.gross; syncInvStatus(inv); }
    if (kind === 'customerRefund') { inv.refunded = (inv.refunded || 0) - d.amount; syncInvStatus(inv); }
    if (kind === 'creditNote') { inv.credited -= d.total; stockBack(no, 'in'); syncInvStatus(inv); }
    if (kind === 'debitNote') { inv.debited = (inv.debited || 0) - d.total; syncInvStatus(inv); }
    if (kind === 'bill') {
      if (d.grnNo) {
        const g = DB.docs.goodsReceipt.find((x) => x.no === d.grnNo);
        if (g) { g.status = 'received'; g.billNo = null; g.billDate = null; }
      } else stockBack(no, 'in');
      reopenTradeDoc('purchaseOrder', no);
    }
    if (kind === 'payment') {
      const b = DB.docs.bill.find((x) => x.no === d.billNo);
      b.paid -= d.gross;
      b.status = b.paid >= b.total ? 'paid' : b.paid > 0 ? 'partially_paid' : 'issued';
      voidCert(d.certNo);
      DB.docs.paymentBatch.forEach((pb) => pb.items.forEach((i) => { if (i.paymentNo === no) i.voided = true; }));
    }
    if (kind === 'expense') voidCert(d.certNo);
    if (kind === 'goodsReceipt') { stockBack(no, 'in'); reopenGrnOnPo(d); }
    const before = d.status;
    d.status = 'void';
    d.voidReason = why;
    d.voidedAt = new Date().toISOString();
    audit(kind, no, 'void', { status: before }, { status: 'void' }, why);
    return d;
  });
}
/* ใบรับสินค้าที่ยกเลิก — ใบสั่งซื้อต้องกลับมารอรับของอีกครั้ง */
function reopenGrnOnPo(g) {
  if (!g.poNo) return;
  const po = DB.docs.purchaseOrder.find((x) => x.no === g.poNo);
  if (!po) return;
  if (po.convertedTo === g.no) { po.status = 'approved'; po.convertedTo = null; }
}

/** มูลค่าก่อนภาษีที่ยังลดหนี้ได้ = ใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ที่ยังไม่ยกเลิก
    ต้องคิดจากฐานก่อนภาษีของแต่ละใบ — inv.credited เก็บยอดรวมภาษี เอามาลบกับฐานตรง ๆ ไม่ได้ */
function creditableBase(inv, code) {
  let v = inv.lines.reduce((s, l) => s + (!code || (l.taxCode || 'VAT7') === code ? l.amount : 0), 0);
  const mine = (d) => d.invoiceNo === inv.no && liveDoc(d) && (!code || noteCodeOf(d, inv) === code);
  DB.docs.debitNote.forEach((d) => { if (mine(d)) v += d.base; });
  DB.docs.creditNote.forEach((c) => { if (mine(c)) v -= c.base; });
  return Math.max(0, v);
}
const TAX_CODE_LABEL = { VAT7:'ภาษี 7%', VAT0:'อัตรา 0%', EXEMPT:'ยกเว้นภาษี' };
/** อัตราภาษีที่มีอยู่ในใบกำกับ (เฉพาะบรรทัดที่มีมูลค่า) */
function invoiceTaxCodes(inv) {
  const set = [];
  inv.lines.forEach((l) => { const c = l.taxCode || 'VAT7'; if (l.amount && set.indexOf(c) < 0) set.push(c); });
  return set.length ? set : ['VAT7'];
}
/** ใบลดหนี้/เพิ่มหนี้รุ่นก่อนไม่ได้เก็บอัตราไว้ — เดาจากภาษีในใบและอัตราของใบกำกับเดิม */
function noteCodeOf(d, inv) {
  if (d.taxCode) return d.taxCode;
  if (d.vat) return 'VAT7';
  const codes = invoiceTaxCodes(inv).filter((c) => c !== 'VAT7');
  return codes[0] || 'VAT7';
}
function noteTaxCode(inv, given, verb) {
  const codes = invoiceTaxCodes(inv);
  if (given) {
    if (codes.indexOf(given) < 0) {
      throw new DomainError('NOTE_TAX_CODE_INVALID', 'ใบกำกับ ' + inv.no + ' ไม่มีรายการ' + (TAX_CODE_LABEL[given] || given),
        'เลือกอัตราภาษีที่มีอยู่ในใบกำกับเดิม');
    }
    return given;
  }
  if (codes.length > 1) {
    throw new DomainError('NOTE_TAX_CODE_REQUIRED', 'ใบกำกับ ' + inv.no + ' มีหลายอัตราภาษี ต้องเลือกว่า' + verb + 'รายการอัตราใด',
      'อัตราในใบ' + verb + 'ต้องตรงกับรายการเดิม ไม่งั้นภาษีขายและยอดขายแต่ละช่องใน ภ.พ.30 จะผิด');
  }
  return codes[0];
}
/** รายการสินค้าที่รับคืน — ต้องเป็นสินค้าในใบกำกับเดิม จำนวนไม่เกินที่ขายหักที่คืนไปแล้ว
    ต้นทุนใช้ต้นทุนเดิมที่ตัดออกตอนขาย ครั้งสุดท้ายรับต้นทุนส่วนที่เหลือทั้งหมด */
function creditNoteReturns(inv, lines) {
  const want = (lines || []).filter((l) => l && l.itemCode && Number(l.qty) > 0);
  return want.map(function (l) {
    const sold = DB.docs.stockMove.filter((m) => m.src === inv.no && m.dir === 'out' && m.item === l.itemCode);
    if (!sold.length) {
      throw new DomainError('RETURN_ITEM_NOT_SOLD', 'สินค้า ' + l.itemCode + ' ไม่ได้ตัดออกจากคลังในใบกำกับ ' + inv.no,
        'รับคืนได้เฉพาะสินค้าคงคลังที่ขายในใบกำกับนี้');
    }
    const soldQty = roundQty(sold.reduce((s, m) => s + m.qty, 0));
    const soldCost = sold.reduce((s, m) => s + m.cost, 0);
    const prior = DB.docs.creditNote.filter((c) => c.invoiceNo === inv.no && liveDoc(c))
      .reduce((a, c) => (c.returns || []).filter((r) => r.itemCode === l.itemCode)
        .reduce((b, r) => ({ qty: roundQty(b.qty + r.qty), cost: b.cost + r.cost }), a), { qty: 0, cost: 0 });
    const q = roundQty(l.qty);
    const left = roundQty(soldQty - prior.qty);
    if (q > left) {
      throw new DomainError('RETURN_EXCEEDS_SOLD', 'รับคืน ' + l.itemCode + ' ' + q + ' หน่วย เกินที่ขายและยังไม่ได้คืน ' + left + ' หน่วย');
    }
    const cost = q === left ? soldCost - prior.cost : round2(mulDiv(soldCost, Math.round(q * 1000), Math.round(soldQty * 1000)));
    const it = DB.items.find((x) => x.code === l.itemCode);
    return { itemCode: l.itemCode, desc: it ? it.name : l.itemCode, qty: q, cost };
  });
}
/** ต้นทุนต่อหน่วย = มูลค่า ÷ จำนวน (จำนวนละเอียด 3 ตำแหน่ง) */
const unitCost = (value, qty) => qty > 0 ? mulDiv(value, 1000, Math.round(qty * 1000)) : 0;

/* ===================================================================
   ยกเลิกงวดค่าเสื่อมราคา / งวดเงินเดือน
   ใบสำคัญของสองอย่างนี้กลับรายการตรง ๆ ไม่ได้ เพราะค่าเสื่อมสะสมของทรัพย์สินแต่ละตัว
   และ ภ.ง.ด.1 จะไม่ตรงกับบัญชีแยกประเภท ต้องยกเลิกทั้งงวดจากต้นทางเท่านั้น
   =================================================================== */
const RUN_KINDS = {
  depreciation: { label:'ค่าเสื่อมราคางวด', coll:'depreciation' },
  payroll:      { label:'เงินเดือนงวด', coll:'payRun' },
};
function runCheck(kind, period) {
  const cfg = RUN_KINDS[kind];
  if (!cfg) throw new DomainError('RUN_KIND_UNKNOWN', 'ยกเลิกงวดประเภทนี้ไม่ได้');
  const run = DB.docs[cfg.coll].find((r) => r.period === period && r.status !== 'void');
  if (!run) throw new DomainError('RUN_NOT_FOUND', 'ไม่พบ' + cfg.label + ' ' + thPeriod(period) + ' ที่ยังใช้งานอยู่');
  const p = periodFor(run.date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ยกเลิก' + cfg.label + 'ไม่ได้',
      'บันทึกรายการปรับปรุงในงวดปัจจุบันแทน');
  }
  if (kind === 'depreciation') {
    /* ค่าเสื่อมงวดหลังคิดต่อจากยอดสะสมของงวดนี้ ต้องยกเลิกจากงวดล่าสุดย้อนกลับมา */
    const later = DB.docs.depreciation.find((r) => r.period > period && r.status !== 'void');
    if (later) {
      throw new DomainError('RUN_HAS_LATER', 'มีค่าเสื่อมราคางวด ' + thPeriod(later.period) + ' คิดต่อจากงวดนี้อยู่',
        'ยกเลิกงวดล่าสุดก่อน แล้วย้อนกลับมาทีละงวด');
    }
    const gone = run.rows.map((r) => DB.assets.find((a) => a.code === r.code))
      .find((a) => !a || a.status !== 'in_use');
    if (gone) {
      throw new DomainError('RUN_ASSET_DISPOSED', 'ทรัพย์สินบางรายการในงวดนี้จำหน่ายออกไปแล้ว ยกเลิกค่าเสื่อมย้อนหลังไม่ได้',
        'บันทึกรายการปรับปรุงในสมุดรายวันทั่วไปแทน');
    }
  }
  if (kind === 'payroll') {
    const filed = DB.taxTx.find((t) => t.kind === 'wht' && t.docType === 'payroll' && t.entryNo === run.entryNo && !t.void && t.filingId);
    if (filed) {
      throw new DomainError('TAX_ALREADY_FILED', 'ยื่น ภ.ง.ด.1 งวด ' + thPeriod(filed.period) + ' ไปแล้ว ยกเลิกงวดเงินเดือนไม่ได้',
        'ยื่นแบบเพิ่มเติมกับกรมสรรพากร แล้วบันทึกปรับปรุงในงวดปัจจุบัน');
    }
  }
  const e = DB.entries.find((x) => x.no === run.entryNo);
  if (!e || e.status !== 'posted') throw new DomainError('ALREADY_REVERSED', 'ใบสำคัญของงวดนี้ถูกกลับรายการไปแล้ว');
  return run;
}
function voidRun(kind, period, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกงวดต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  }
  const why = String(reason).trim();
  runCheck(kind, period);
  return atomically(function () {
    const run = DB.docs[RUN_KINDS[kind].coll].find((r) => r.period === period && r.status !== 'void');
    reverse(run.entryNo, 'ยกเลิก' + RUN_KINDS[kind].label + ' ' + thPeriod(period) + ' — ' + why, run.date, { fromSource: true });
    if (kind === 'depreciation') {
      run.rows.forEach(function (r) {
        const a = DB.assets.find((x) => x.code === r.code);
        a.accumBook -= r.book;
        a.accumTax -= r.tax;
      });
    }
    if (kind === 'payroll') {
      DB.taxTx.forEach(function (t) {
        if (t.kind !== 'wht' || t.docType !== 'payroll' || t.entryNo !== run.entryNo || t.void) return;
        t.orig = { base: t.base, tax: t.tax };
        t.base = 0; t.tax = 0; t.void = true; t.voidReason = why;
      });
    }
    run.status = 'void';
    run.voidReason = why;
    run.voidedAt = new Date().toISOString();
    audit(kind, period, 'void', { status: 'posted' }, { status: 'void' }, why);
    return run;
  });
}

/* ===================================================================
   ฐานภาษีหัก ณ ที่จ่าย — จำนวนเต็มล้วน และครั้งสุดท้ายรับส่วนที่เหลือ
   ผลรวมฐานของทุกครั้งที่รับ/จ่าย จึงเท่าฐานเต็มของเอกสารพอดี ไม่คลาดสตางค์
   =================================================================== */
/** ค่าบริการก่อน VAT ของใบกำกับ (หลังใบเพิ่มหนี้/ลดหนี้) — ขายสินค้าไม่อยู่ในฐานหัก ณ ที่จ่าย */
function invoiceServiceBase(inv) {
  const lineBase = inv.lines.reduce((s, l) => s + l.amount, 0);
  if (!lineBase) return 0;
  const goods = inv.lines.reduce(function (s, l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    return s + (it && it.type === 'stock' ? l.amount : 0);
  }, 0);
  return round2(mulDiv(creditableBase(inv), lineBase - goods, lineBase));
}
/** ส่วนของค่าบริการที่อยู่ในยอดรับครั้งนี้ */
function receiptServiceShare(inv, gross) {
  const svc = invoiceServiceBase(inv);
  const due = inv.total + (inv.debited || 0) - inv.credited;
  if (due <= 0 || svc <= 0) return 0;
  const prior = DB.docs.receipt.filter((r) => r.invoiceNo === inv.no && liveDoc(r))
    .reduce((s, r) => s + (r.svcShare !== undefined ? r.svcShare : round2(mulDiv(svc, r.gross, due))), 0);
  /* ฐานที่พิมพ์ใน 50 ทวิ เป็นบาทกับสตางค์ — ปัดฐานก่อน แล้วค่อยคิดภาษีจากฐานที่ปัดแล้ว */
  if (gross >= invOutstanding(inv)) return Math.max(0, svc - prior);
  return Math.min(round2(mulDiv(svc, gross, due)), Math.max(0, svc - prior));
}
/** ภาษีหัก ณ ที่จ่ายของการจ่ายชำระเจ้าหนี้ครั้งนี้
    เกณฑ์ 1,000 บาทดูจากมูลค่าทั้งใบ — แบ่งจ่ายหลายงวดเพื่อเลี่ยงการหักไม่ได้ (ท.ป.4/2528) */
function billWhtFor(bill, gross, date, channel, whtCode) {
  const prior = DB.docs.payment.filter((x) => x.billNo === bill.no && liveDoc(x))
    .reduce((s, x) => s + (x.baseShare !== undefined ? x.baseShare : round2(mulDiv(bill.base, x.gross, bill.total))), 0);
  const final = gross >= billOutstanding(bill);
  const share = final ? Math.max(0, bill.base - prior) : Math.min(round2(mulDiv(bill.base, gross, bill.total)), Math.max(0, bill.base - prior));
  if (!whtCode || bill.base < M('1000') || share <= 0) return { wht: 0, rate: null, base: share, share };
  const r = resolveRate(whtCode, date, { channel });
  return { wht: round2(pct(share, r.rate)), rate: r.rate, base: share, share };
}

/** ขายเกินของที่มีในคลังไม่ได้ — สต๊อกติดลบทำให้ต้นทุนเฉลี่ยของการรับเข้าครั้งถัดไปเพี้ยน */
function assertStockAvailable(lines) {
  const need = {};
  lines.forEach(function (l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    if (!it || it.type !== 'stock') return;
    need[it.code] = roundQty((need[it.code] || 0) + roundQty(l.qty));
  });
  Object.keys(need).forEach(function (code) {
    const it = DB.items.find((x) => x.code === code);
    if (need[code] > it.qty) {
      throw new DomainError('INSUFFICIENT_STOCK',
        it.name + ' (' + code + ') มีในคลัง ' + it.qty + ' ' + (it.uom || '') + ' แต่จะขาย ' + need[code],
        'บันทึกรับสินค้าเข้าคลังก่อน (ใบรับสินค้าหรือตั้งหนี้ผู้ขาย) แล้วจึงออกใบกำกับ');
    }
  });
}

/* ===================================================================
   คืนเงินลูกค้า — ใช้เมื่อลดหนี้หลังรับเงินครบแล้ว ลูกค้ามียอดเครดิตเกิน
   Dr ลูกหนี้ (รายตัว) / Cr เงินฝากธนาคาร · ยอดคงค้างของใบกำกับกลับเป็นศูนย์
   =================================================================== */
function refundCustomer(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + input.invoiceNo);
  if (inv.status === 'void') throw new DomainError('INVOICE_VOID', 'ใบกำกับ ' + inv.no + ' ถูกยกเลิกไปแล้ว');
  const credit = -invOutstanding(inv);
  if (credit <= 0) {
    throw new DomainError('NO_CREDIT_BALANCE', 'ใบกำกับ ' + inv.no + ' ไม่มียอดที่ต้องคืนลูกค้า',
      'คืนเงินได้เฉพาะเมื่อลดหนี้หลังรับเงินครบแล้วเท่านั้น');
  }
  const amount = input.amount ? M(input.amount) : credit;
  if (amount <= 0 || amount > credit) {
    throw new DomainError('REFUND_EXCEEDS', 'ยอดคืน ' + fmt(amount) + ' ต้องมากกว่าศูนย์และไม่เกินเครดิตของลูกค้า ' + fmt(credit));
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่คืนเงิน');
  const bank = input.bankAccount || accBySub('bank');
  const ba = acc(bank);
  if (ba.subType !== 'cash' && ba.subType !== 'bank') {
    throw new DomainError('REFUND_FROM_INVALID', 'ต้องคืนจากบัญชีเงินสดหรือเงินฝากธนาคาร');
  }
  assertPostingOpen(input.date);
  const no = nextNo('customerRefund', input.date);
  const je = post({
    type: 'payment', date: input.date,
    desc: 'คืนเงินลูกค้า ' + inv.partnerName + ' ตามใบลดหนี้ อ้าง ' + inv.no + ' (' + no + ')',
    src: 'customerRefund', srcId: no,
    lines: [{ acc: accBySub('trade_receivable'), dr: amount, partner: inv.partnerCode }, { acc: bank, cr: amount }],
  });
  inv.refunded = (inv.refunded || 0) + amount;
  syncInvStatus(inv);
  const doc = { no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode, partnerName: inv.partnerName,
    amount, method: input.method || 'transfer', bankAccount: bank, note: input.note || '', entryNo: je.no };
  DB.docs.customerRefund.unshift(doc);
  audit('customerRefund', no, 'create', null, { invoice: inv.no, amount: fmt(amount) });
  return doc;
}

/* ===================================================================
   เปิดปีบัญชีถัดไป — 12 งวดต่อจากงวดสุดท้าย
   งบแสดงฐานะการเงินรวมกำไรทุกปีเข้ากำไรสะสมเอง จึงข้ามปีได้โดยไม่ต้องลงรายการปิดบัญชี
   =================================================================== */
function openNextFiscalYear(reason) {
  if (!DB.periods.length) throw new DomainError('PERIOD_NOT_FOUND', 'ยังไม่มีงวดบัญชีเลย สร้างบริษัทก่อน');
  const last = DB.periods.slice().sort((a, b) => a.start < b.start ? -1 : 1).pop();
  const made = [];
  let d = addDays(last.end, 1);
  for (let i = 0; i < 12; i++) {
    const code = d.slice(0, 7);
    if (!DB.periods.some((p) => p.code === code)) {
      DB.periods.push({ code, start: code + '-01', end: endOfMonth(code + '-01'), status: 'open' });
      made.push(code);
    }
    d = addDays(endOfMonth(code + '-01'), 1);
  }
  audit('period', made[0] + '…' + made[made.length - 1], 'open_year', null, { periods: made.length }, reason || 'เปิดปีบัญชีถัดไป');
  return made;
}

/* ===================================================================
   ห่อทุกคำสั่งที่เขียนข้อมูลให้เป็นชุดเดียว (ดู atomically ใน engine.js)
   ต้องอยู่ท้ายไฟล์ และต้องห่อที่นี่ที่เดียว หน้าจอเรียกชื่อเดิมได้เลย
   =================================================================== */
savePartner = transactional(savePartner);
saveItem = transactional(saveItem);
saveEmployee = transactional(saveEmployee);
saveAsset = transactional(saveAsset);
saveCompany = transactional(saveCompany);
issueInvoice = transactional(issueInvoice);
receivePayment = transactional(receivePayment);
issueCreditNote = transactional(issueCreditNote);
issueDebitNote = transactional(issueDebitNote);
refundCustomer = transactional(refundCustomer);
issueTradeDoc = transactional(issueTradeDoc);
setTradeDocStatus = transactional(setTradeDocStatus);
convertTradeDoc = transactional(convertTradeDoc);
recordBill = transactional(recordBill);
payBill = transactional(payBill);
runDepreciation = transactional(runDepreciation);
runPayroll = transactional(runPayroll);
fileVat = transactional(fileVat);
fileWht = transactional(fileWht);
closePeriod = transactional(closePeriod);
reopenPeriod = transactional(reopenPeriod);
matchBankTxn = transactional(matchBankTxn);
bookBankTxn = transactional(bookBankTxn);
issueBillingNote = transactional(issueBillingNote);
cancelBillingNote = transactional(cancelBillingNote);
receiveBillingNote = transactional(receiveBillingNote);
issueGoodsReceipt = transactional(issueGoodsReceipt);
receiveGoodsFromPo = transactional(receiveGoodsFromPo);
billGoodsReceipt = transactional(billGoodsReceipt);
recordExpense = transactional(recordExpense);
createPaymentBatch = transactional(createPaymentBatch);
approvePaymentBatch = transactional(approvePaymentBatch);
cancelPaymentBatch = transactional(cancelPaymentBatch);
payPaymentBatch = transactional(payPaymentBatch);
postJournalVoucher = transactional(postJournalVoucher);
openNextFiscalYear = transactional(openNextFiscalYear);
buildSeed = bulkTransaction(buildSeed);
