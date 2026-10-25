/* ===================================================================
   ธุรกรรมทางธุรกิจ — ทุกตัวจบใน "หนึ่งชุด" เหมือน transaction เดียว
   ถ้าขั้นตอนใดล้มเหลว ต้องไม่มีอะไรค้างครึ่ง ๆ กลาง ๆ
   =================================================================== */

function partnerByCode(code) {
  const p = DB.partners.find((x) => x.code === code);
  if (!p) throw new DomainError('PARTNER_NOT_FOUND', 'ไม่พบคู่ค้ารหัส ' + code);
  return p;
}

/** คู่ค้ารายเดียวเป็นได้ทั้งลูกค้าและผู้ขาย (ผู้จำหน่ายและลูกค้า) — ตรวจบทบาทด้วยสองตัวนี้เสมอ ไม่เทียบ kind ตรง ๆ */
const isCustomer = (p) => !!p && (p.kind === 'customer' || p.kind === 'both');
const isVendor = (p) => !!p && (p.kind === 'vendor' || p.kind === 'both');
const PARTNER_KINDS = { customer: 'ลูกค้า', vendor: 'ผู้ขาย', both: 'ผู้จำหน่ายและลูกค้า' };

function snapshotPartner(p) {
  return {
    code: p.code, name: p.name, taxId: p.taxId, branch: p.branch,
    entityType: p.entityType, vatRegistered: partnerVatRegistered(p),
    address: p.address + (p.zip && String(p.address || '').indexOf(p.zip) < 0 ? ' ' + p.zip : ''),
    contactPerson: p.contactPerson || '', phone: p.mobile || p.phone || '', email: p.email || '',
    capturedAt: new Date().toISOString(),
  };
}
/* ช่องข้อความของสมุดรายชื่อ [ชื่อช่อง, ความยาวสูงสุด] */
const PARTNER_TEXT = [['contactPerson', 80], ['email', 120], ['mobile', 30], ['fax', 30], ['website', 120], ['zip', 5],
  ['branchName', 80], ['shipAddress', 300], ['bankName', 60], ['bankAccount', 30], ['bankAccountName', 120], ['bankBranch', 60], ['note', 500]];
const BANK_ACCOUNT_TYPES = { saving: 'ออมทรัพย์', current: 'กระแสรายวัน', fixed: 'ฝากประจำ' };

/** คู่ค้าจดทะเบียนภาษีมูลค่าเพิ่มหรือไม่ — ข้อมูลรุ่นก่อนไม่มีช่องนี้ ถือว่านิติบุคคลจดทะเบียน บุคคลธรรมดาไม่ได้จด
    ใช้ตัดสินว่าใบกำกับต้องมีเลขผู้เสียภาษีและสาขาของผู้ซื้อหรือไม่ */
function partnerVatRegistered(p) {
  if (p.vatRegistered === true || p.vatRegistered === false) return p.vatRegistered;
  return p.entityType !== 'individual';
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

/* ===================================================================
   ราคาแบบเอกสารธุรกิจ — ส่วนลดรายการ ส่วนลดท้ายบิล ราคารวม/ไม่รวมภาษี
   แบบเดียวกับที่นักบัญชีคุ้นจากโปรแกรมออกเอกสารทั่วไป:
   - ส่วนลดรายการ (disc ของบรรทัด) เป็นเปอร์เซ็นต์หรือบาทตาม pricing.lineDisc ทั้งใบ
   - ส่วนลดท้ายบิล (pricing.bill) เป็นเปอร์เซ็นต์หรือบาท หักหลังส่วนลดรายการ
   - ทุกส่วนลดหักก่อนคิดภาษี · ราคารวมภาษีถอดภาษีครั้งเดียวทั้งใบ แล้วแบ่งมูลค่าก่อนภาษีกลับไปตามสัดส่วน
     บรรทัดสุดท้ายรับเศษ ผลรวมบรรทัดจึงเท่ายอดก่อนภาษีพอดี (วิธีเดียวกับบิลขายเงินสด)
   ไม่มีส่วนลดและราคาไม่รวมภาษี = ได้ผลเท่ากับ computeVat ทุกสตางค์
   =================================================================== */
const PRICE_MODES = { exclusive: 'ราคาไม่รวมภาษี', inclusive: 'ราคารวมภาษี' };
const DISC_KINDS = { percent: 'เปอร์เซ็นต์', amount: 'บาท' };
/** ตั้งค่าราคาของเอกสาร — ค่าที่ไม่ส่งมาใช้ค่าเริ่มต้นของกิจการ (ตั้งค่า > เอกสาร) */
function normPricing(p) {
  const src = p || {};
  const def = (DB.settings && DB.settings.docDefaults) || {};
  const mode = PRICE_MODES[src.mode] ? src.mode : PRICE_MODES[def.priceMode] ? def.priceMode : 'exclusive';
  const lineDisc = DISC_KINDS[src.lineDisc] ? src.lineDisc : 'percent';
  const b = src.bill && String(src.bill.value === undefined || src.bill.value === null ? '' : src.bill.value).trim();
  const bill = b && M(b) !== 0 ? { kind: DISC_KINDS[src.bill.kind] ? src.bill.kind : 'percent', value: b } : null;
  return { mode, lineDisc, bill };
}
/** ส่วนลดเป็นบาทจากค่าที่กรอก — เปอร์เซ็นต์ 0–100 · บาทต้องไม่เกินยอดที่จะลด */
function discountOf(base, raw, kind, what) {
  const s = String(raw === undefined || raw === null ? '' : raw).trim().replace(/%$/, '');
  if (!s || M(s) === 0) return 0;
  const v = M(s);
  if (v < 0) throw new DomainError('DISCOUNT_NEGATIVE', what + ' ติดลบไม่ได้');
  if (kind === 'percent') {
    if (v > M('100')) throw new DomainError('DISCOUNT_OVER', what + ' เกิน 100%');
    return round2(pct(base, s));
  }
  if (base >= 0 && v > base) {
    throw new DomainError('DISCOUNT_OVER', what + ' ' + fmt(v) + ' บาท เกินยอด ' + fmt(base) + ' บาท');
  }
  return round2(v);
}
/** แบ่งยอด total ไปตามสัดส่วน weights — บรรทัดสุดท้ายที่มีน้ำหนักรับเศษ ผลรวมเท่า total พอดี */
function allocate(total, weights) {
  const sum = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  const out = weights.map(() => 0);
  if (!total || !sum) return out;
  const idx = weights.map((w, i) => i).filter((i) => weights[i] > 0);
  let left = total;
  idx.forEach(function (i, k) {
    out[i] = k === idx.length - 1 ? left : round2(mulDiv(total, weights[i], sum));
    left -= out[i];
  });
  return out;
}
/** คำนวณทั้งใบ — คืน rows (ต่อบรรทัด: gross ส่วนลด ส่วนลดท้ายบิลที่แบ่งมา net=มูลค่าก่อนภาษีหลังหักทุกส่วนลด)
    v (รูปเดียวกับ computeVat ใช้ลงบัญชี) และ totals (ยอดที่พิมพ์ท้ายเอกสาร) */
function priceLines(lines, date, pricing) {
  const P = normPricing(pricing);
  const code = (l) => l.taxCode || 'VAT7';
  const rows = lines.map(function (l, i) {
    const gross = round2(mulQty(M(l.price), l.qty));
    const discount = discountOf(gross, l.disc, P.lineDisc, 'ส่วนลดบรรทัดที่ ' + (i + 1));
    return { gross, discount, after: gross - discount };
  });
  const subTotal = rows.reduce((s, r) => s + r.gross, 0);
  const lineDiscount = rows.reduce((s, r) => s + r.discount, 0);
  const afterLine = subTotal - lineDiscount;
  let billDiscount = 0;
  if (P.bill) {
    if (afterLine <= 0) throw new DomainError('DISCOUNT_OVER', 'ไม่มียอดให้หักส่วนลดท้ายบิล');
    billDiscount = discountOf(afterLine, P.bill.value, P.bill.kind, 'ส่วนลดท้ายบิล');
  }
  const share = allocate(billDiscount, rows.map((r) => r.after));
  rows.forEach(function (r, i) { r.billShare = share[i]; r.final = r.after - share[i]; });

  const stdIdx = lines.map((l, i) => i).filter((i) => code(lines[i]) === 'VAT7');
  const rate = stdIdx.length ? resolveRate('VAT7', date).rate : '0';
  const stdGross = stdIdx.reduce((s, i) => s + rows[i].final, 0);
  let std, vat;
  if (P.mode === 'inclusive' && stdIdx.length) {
    std = round2(mulDiv(stdGross, 100 * S, 100 * S + M(rate)));
    vat = stdGross - std;
    const nets = allocate(std, stdIdx.map((i) => rows[i].final));
    /* บรรทัดราคาติดลบ (ส่วนลดเป็นบรรทัด) ไม่ได้น้ำหนัก — ถอดภาษีของบรรทัดนั้นเอง */
    stdIdx.forEach(function (i, k) { rows[i].net = rows[i].final > 0 ? nets[k] : round2(mulDiv(rows[i].final, 100 * S, 100 * S + M(rate))); });
    const drift = std - stdIdx.reduce((s, i) => s + rows[i].net, 0);
    if (drift) { const last = stdIdx.filter((i) => rows[i].final > 0).pop(); if (last !== undefined) rows[last].net += drift; }
  } else {
    std = stdGross;
    vat = round2(pct(std, rate));
  }
  rows.forEach(function (r, i) { if (r.net === undefined) r.net = r.final; });
  const sumOf = (c) => rows.reduce((s, r, i) => s + (code(lines[i]) === c ? r.net : 0), 0);
  const zero = sumOf('VAT0'), exempt = sumOf('EXEMPT');
  const total = std + zero + exempt + vat;
  const discount = lineDiscount + billDiscount;
  return {
    pricing: P, rows,
    v: { std, zero, exempt, vat, total, rate },
    totals: {
      subTotal, lineDiscount, billDiscount, discount, afterDiscount: subTotal - discount,
      /* ราคารวมภาษี: ยอดหลังหักส่วนลดรวมภาษีแล้ว · ไม่รวมภาษี: ยังไม่รวม */
      exempt: zero + exempt, vatable: std, vat, total,
    },
  };
}
/** มีอะไรที่ต่างจากใบแบบเดิม (ส่วนลด ราคารวมภาษี) — ใช้ตัดสินว่าต้องพิมพ์บรรทัดส่วนลด/หมายเหตุราคาหรือไม่ */
function pricingUsed(P) {
  return !!P && (P.pricing.mode === 'inclusive' || P.totals.discount !== 0);
}

/** ส่วนลดบรรทัดที่เก็บไว้ในเอกสาร — ข้อความตามที่กรอก (ตีความด้วย pricing.lineDisc ของใบ) */
const lineDiscText = (d) => { const t = String(d === undefined || d === null ? '' : d).trim().replace(/%$/, ''); return t && M(t) !== 0 ? t : ''; };

/* ---------- หัวเอกสาร: เงื่อนไขชำระ วันครบกำหนด โปรเจกต์ พนักงานขาย เลขอ้างอิง หมายเหตุ โน้ตภายใน ----------
   เงินสด = ครบกำหนดวันเดียวกัน · เครดิต N วัน = พิมพ์วันครบกำหนด · เครดิตไม่แสดงวันครบกำหนด = นับวันแต่ไม่พิมพ์
   ไม่ส่งมา = ใช้เครดิตตามทะเบียนคู่ค้า (แบบเดิม) */
const CREDIT_TYPES = { cash: 'เงินสด', credit: 'เครดิต', creditHidden: 'เครดิต (ไม่แสดงวันครบกำหนด)' };
function docHeader(input, p, date) {
  const src = input || {};
  const type = CREDIT_TYPES[src.creditType] ? src.creditType : 'credit';
  let days = type === 'cash' ? 0
    : src.creditDays !== undefined && src.creditDays !== null && src.creditDays !== '' ? Number(src.creditDays)
    : (p && p.termDays) || 0;
  if (!(days >= 0) || Math.floor(days) !== days) {
    throw new DomainError('CREDIT_DAYS_INVALID', 'จำนวนวันเครดิตต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป');
  }
  let due = addDays(date, days);
  if (type !== 'cash' && src.dueDate && src.dueDate !== due) {
    if (src.dueDate < date) throw new DomainError('DUE_BEFORE_DATE', 'วันครบกำหนดต้องไม่ก่อนวันที่เอกสาร');
    due = src.dueDate;
    days = Math.round((Date.parse(due) - Date.parse(date)) / 86400000);
  }
  const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  return {
    creditType: type, creditDays: days, due,
    project: txt(src.project, 120), salesName: txt(src.salesName, 80), reference: txt(src.reference, 60),
    note: txt(src.note, 1000), internalNote: txt(src.internalNote, 1000),
  };
}
/** ข้อมูลลูกค้า/ผู้ขายที่แก้บนเอกสารใบนี้ (ที่อยู่สาขาอื่น ชื่อผู้ติดต่อ) — ไม่แก้ทะเบียน
    เลขผู้เสียภาษีที่แก้ต้องผ่านหลักตรวจสอบ เหมือนตอนเพิ่มในทะเบียน */
function applyContactEdits(snap, edits) {
  if (!edits) return snap;
  const out = Object.assign({}, snap);
  ['name', 'address', 'branch', 'contactPerson', 'phone', 'email'].forEach(function (k) {
    const v = edits[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') out[k] = String(v).trim();
  });
  if (edits.taxId !== undefined && edits.taxId !== null && String(edits.taxId).trim() !== '') {
    const t = String(edits.taxId).replace(/[^0-9]/g, '');
    if (!validTaxId(t)) {
      throw new DomainError('TAX_ID_INVALID', 'เลขประจำตัวผู้เสียภาษี ' + t + ' ไม่ผ่านการตรวจหลักที่ 13',
        'ตรวจเลขกับหนังสือรับรองของคู่ค้าอีกครั้ง');
    }
    out.taxId = t;
  }
  if (out.branch && !/^\d{5}$/.test(out.branch)) {
    throw new DomainError('BRANCH_INVALID', 'รหัสสาขาต้องเป็นตัวเลข 5 หลัก (สำนักงานใหญ่คือ 00000)');
  }
  out.edited = true;
  return out;
}

/* ---------- ตรวจตาม ม.86/4 ก่อนออกเลข ---------- */
function assertTaxInvoiceComplete(snap, lines) {
  const missing = [];
  /* ชื่อและที่อยู่ผู้ซื้อต้องมีเสมอ แต่เลขผู้เสียภาษีกับสำนักงานใหญ่/สาขา บังคับเฉพาะผู้ซื้อที่จดทะเบียน
     ภาษีมูลค่าเพิ่ม (ประกาศอธิบดีกรมสรรพากร ฉบับที่ 199) — ขายให้บุคคลธรรมดาที่ไม่ได้จดทะเบียน
     ถ้าบังคับครบทุกช่อง ใบกำกับจะออกไม่ได้เลยทั้งที่กฎหมายไม่ได้กำหนด */
  const registered = partnerVatRegistered(snap);
  if (!snap.name) missing.push('ชื่อผู้ซื้อ');
  if (!snap.address) missing.push('ที่อยู่ผู้ซื้อ');
  if (registered && !snap.branch) missing.push('สำนักงานใหญ่หรือสาขาของผู้ซื้อ');
  if (registered && !snap.taxId) missing.push('เลขประจำตัวผู้เสียภาษีของผู้ซื้อ');
  else if (snap.taxId && !validTaxId(snap.taxId)) {
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
  /* ตัดหนี้สูญส่วนที่เหลือแล้ว ต้องแยกให้เห็นว่าไม่ได้รับเงินครบ */
  else if (out === 0) inv.status = inv.writtenOff > 0 ? 'written_off' : 'paid';
  else if (inv.paid > 0 || inv.credited > 0 || inv.settled) inv.status = 'partially_paid';
  else inv.status = 'issued';
}
/** สถานะรายการตั้งหนี้ คิดจากยอดคงค้างเสมอ — จ่าย ลดหนี้ หักมัดจำ หรือหักกลบ ทำให้ยอดเปลี่ยนได้หลายทาง */
function syncBillStatus(bill) {
  if (bill.status === 'void' || bill.status === 'draft') return;
  const out = billOutstanding(bill);
  /* ผู้ขายลดหนี้หลังจ่ายครบ — ผู้ขายเป็นหนี้เรา รอรับเงินคืนหรือหักกับรายการถัดไป */
  if (out < 0) bill.status = 'vendor_credit';
  else if (out === 0) bill.status = 'paid';
  else if (bill.paid > 0 || bill.credited || bill.settled) bill.status = 'partially_paid';
  else bill.status = 'issued';
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
  const kind = PARTNER_KINDS[input.kind] ? input.kind : 'customer';
  const label = PARTNER_KINDS[kind];
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('PARTNER_NAME_REQUIRED', 'ต้องกรอกชื่อ' + label);

  const entityType = input.entityType === 'individual' ? 'individual' : 'juristic';
  const taxId = String(input.taxId || '').replace(/[^0-9]/g, '');
  if (taxId && !validTaxId(taxId)) {
    throw new DomainError('TAX_ID_INVALID',
      'เลขประจำตัวผู้เสียภาษี ' + taxId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ตรวจเลขกับหน้าใบกำกับภาษีของคู่ค้าอีกครั้ง หรือเว้นว่างไว้ก่อน');
  }
  const existing = input.code ? DB.partners.find((x) => x.code === input.code) : null;
  if (input.code && !existing) {
    throw new DomainError('PARTNER_NOT_FOUND', 'ไม่พบคู่ค้ารหัส ' + input.code);
  }
  /* ไม่ส่งมา = คงค่าเดิมไว้ — แก้ชื่อหรือเครดิตแล้วต้องไม่เผลอเปิดใช้งานรายที่ปิดไว้ หรือเปลี่ยนสถานะ VAT เอง */
  const given = (v) => v !== undefined && v !== null && v !== '';
  const vatRegistered = given(input.vatRegistered) ? input.vatRegistered === true || input.vatRegistered === 'yes'
    : existing && typeof existing.vatRegistered === 'boolean' && existing.entityType === entityType ? existing.vatRegistered
    : entityType !== 'individual';
  const active = given(input.active) ? input.active !== false && input.active !== 'no'
    : existing ? existing.active !== false : true;
  /* บุคคลธรรมดาที่ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่มไม่มีสาขา — ใบกำกับไม่ต้องระบุ
     ส่วนบุคคลธรรมดาที่จดทะเบียนแล้ว (ร้านค้าเจ้าของคนเดียว) ต้องมีสาขาเหมือนนิติบุคคล */
  const branch = entityType === 'individual' && !vatRegistered ? null : assertBranch(input.branch, 'juristic');
  /* กันสร้างคู่ค้าซ้ำด้วยเลขผู้เสียภาษีเดียวกัน เป็นความผิดพลาดที่เจอบ่อยที่สุด
     เพราะทำให้ยอดค้างของรายเดียวกันแตกเป็นสองราย แล้วกระทบยอดไม่ได้ */
  if (taxId) {
    const dup = DB.partners.find((x) => x.taxId === taxId && (x.branch || '00000') === (branch || '00000')
      && ((isCustomer(x) && kind !== 'vendor') || (isVendor(x) && kind !== 'customer')) && (!existing || x.code !== existing.code));
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
    entityType: entityType, vatRegistered: vatRegistered, kind: kind,
    address: String(input.address || '').trim(),
    phone: String(input.phone || '').trim(),
    termDays: Math.max(0, Number(input.termDays || 0) || 0),
    /* ผู้ขาย: ประเภทเงินได้ที่เราต้องหัก · ลูกค้า: ลูกค้าหักเราตอนจ่ายเงิน (นิติบุคคลที่ซื้อบริการ) — ใช้เป็นค่าเริ่มต้นในเอกสาร */
    whtCode: input.whtCode && input.whtCode !== 'none' ? input.whtCode : null,
    creditLimit: M(input.creditLimit || '0'),
    active: active,
  };
  /* ช่องติดต่อและบัญชีธนาคารแบบสมุดรายชื่อทั่วไป — ส่งมา = ใช้ค่าใหม่ (ว่างได้) · ไม่ส่ง = คงค่าเดิม */
  const opt = (k, n) => input[k] !== undefined && input[k] !== null ? String(input[k]).trim().slice(0, n) : existing ? existing[k] || '' : '';
  PARTNER_TEXT.forEach(function (f) { rec[f[0]] = opt(f[0], f[1]); });
  if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rec.email)) {
    throw new DomainError('EMAIL_INVALID', 'อีเมล ' + rec.email + ' รูปแบบไม่ถูกต้อง');
  }
  if (rec.zip && !/^\d{5}$/.test(rec.zip)) throw new DomainError('ZIP_INVALID', 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก');
  rec.bankAccountType = BANK_ACCOUNT_TYPES[input.bankAccountType] ? input.bankAccountType
    : existing && existing.bankAccountType ? existing.bankAccountType : 'saving';
  if (existing) {
    const before = { name: existing.name, taxId: existing.taxId, branch: existing.branch, active: existing.active !== false };
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('partner', rec.code, 'update', before, { name: rec.name, taxId: rec.taxId, branch: rec.branch, active: rec.active });
    return { partner: existing, created: false };
  }
  DB.partners.push(rec);
  audit('partner', rec.code, 'create', null, { name: rec.name, taxId: rec.taxId, kind: kind });
  return { partner: rec, created: true };
}

/** เอกสารที่อ้างถึงคู่ค้ารายนี้ — คืนเลขที่เอกสาร (ไม่ซ้ำ) */
function partnerUsage(code) {
  const out = [];
  const add = (x) => { if (out.indexOf(x) < 0) out.push(x); };
  Object.keys(DB.docs).forEach(function (k) {
    (DB.docs[k] || []).forEach(function (d) {
      if (!d || typeof d !== 'object') return;
      const inItems = Array.isArray(d.items) && d.items.some((x) => x && x.partnerCode === code);
      if (d.partnerCode === code || d.partner === code || inItems) add(d.no || k);
    });
  });
  DB.entries.forEach((e) => { if (e.lines.some((l) => l.partner === code)) add(e.no); });
  (DB.projects || []).forEach((p) => { if (p.customer === code) add(p.code); });
  return out;
}
/** ลบคู่ค้าได้เฉพาะรายที่ไม่เคยถูกใช้ — เอกสารเก่าและใบสำคัญต้องอ้างกลับมาที่ทะเบียนได้เสมอ
    รายที่ใช้แล้วให้ตั้งเลิกใช้งานแทน จะหายจากตัวเลือกในเอกสารใหม่แต่ยังอยู่ในรายงานเดิม */
function deletePartner(code, reason) {
  const p = partnerByCode(code);
  const used = partnerUsage(code);
  if (used.length) {
    throw new DomainError('PARTNER_IN_USE',
      p.name + ' ถูกใช้ในเอกสารแล้ว (' + used.slice(0, 3).join(', ') + (used.length > 3 ? ' และอีก ' + (used.length - 3) + ' รายการ' : '')
        + ') ลบไม่ได้',
      'ตั้งสถานะเป็น "เลิกใช้งาน" แทน รายชื่อจะไม่ขึ้นในเอกสารใหม่ แต่ยังอยู่ในรายงานและเอกสารเดิม');
  }
  DB.partners.splice(DB.partners.indexOf(p), 1);
  audit('partner', code, 'delete', { name: p.name, taxId: p.taxId, kind: p.kind }, null, reason || null);
  return p;
}

/* ชนิดสินค้า: บริการ · สินค้าไม่นับสต๊อก (ขายของแต่ไม่คุมจำนวน) · สินค้านับสต๊อก */
const ITEM_TYPES = { service: 'บริการ', nonstock: 'สินค้าไม่นับสต๊อก', stock: 'สินค้านับสต๊อก' };
const ITEM_VAT_TYPES = { exclusive: 'ราคาไม่รวมภาษี', inclusive: 'ราคารวมภาษี', zero: 'ภาษี 0%', exempt: 'ยกเว้นภาษี' };
/** เพิ่มหรือแก้ไขสินค้า/บริการ — จำนวนคงเหลือแก้ตรงนี้ไม่ได้ ต้องมาจากเอกสาร */
function saveItem(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('ITEM_NAME_REQUIRED', 'ต้องกรอกชื่อสินค้าหรือบริการ');
  const type = ITEM_TYPES[input.type] ? input.type : 'stock';
  const existing = input.code ? DB.items.find((x) => x.code === input.code) : null;
  if (input.code && !existing) throw new DomainError('ITEM_NOT_FOUND', 'ไม่พบสินค้ารหัส ' + input.code);

  const code = existing ? existing.code : (String(input.newCode || '').trim() || nextRegCode('IT', DB.items));
  if (!existing && DB.items.find((x) => x.code === code)) {
    throw new DomainError('ITEM_CODE_DUPLICATE', 'รหัสสินค้า ' + code + ' มีอยู่แล้ว');
  }
  /* เปลี่ยนจากสินค้าเป็นบริการทั้งที่ยังมีของในสต๊อก จะทำให้มูลค่าสินค้าคงเหลือหายจากงบ */
  if (existing && existing.type === 'stock' && type !== 'stock' && existing.qty !== 0) {
    throw new DomainError('ITEM_STILL_IN_STOCK',
      'สินค้านี้ยังมีคงเหลือ ' + existing.qty + ' ' + existing.uom + ' เปลี่ยนเป็น' + ITEM_TYPES[type] + 'ไม่ได้',
      'ตัดสต๊อกให้เป็นศูนย์ก่อน');
  }
  /* ช่องเสริม: ส่งมา = ใช้ค่าใหม่ (ว่างได้) · ไม่ส่ง = คงค่าเดิม */
  const opt = (k, n) => input[k] !== undefined && input[k] !== null ? String(input[k]).trim().slice(0, n) : existing ? existing[k] || '' : '';
  const vatOf = (k) => { const v = input[k] !== undefined ? input[k] : existing ? existing[k] : ''; return ITEM_VAT_TYPES[v] ? v : 'exclusive'; };
  const accOf = function (k, ok, what) {
    const v = opt(k, 10);
    if (v && !ok().some((a) => a.code === v)) {
      throw new DomainError('ITEM_ACCOUNT_INVALID', 'บัญชี' + what + ' ' + v + ' ใช้กับสินค้านี้ไม่ได้');
    }
    return v;
  };
  const rec = {
    code: code, name: name, type: type,
    category: String(input.category || '').trim() || 'ทั่วไป',
    uom: String(input.uom || '').trim() || (type === 'service' ? 'งาน' : 'หน่วย'),
    price: M(input.price || '0'),
    /* แบบเอกสารธุรกิจทั่วไป: ราคาขายและราคาซื้อแยกกัน แต่ละฝั่งบอกว่าราคารวม/ไม่รวมภาษี อัตรา 0% หรือยกเว้น */
    sellVat: vatOf('sellVat'), sellDesc: opt('sellDesc', 200),
    buyPrice: input.buyPrice !== undefined && input.buyPrice !== null && input.buyPrice !== '' ? M(input.buyPrice) : existing ? existing.buyPrice || 0 : 0,
    buyVat: vatOf('buyVat'), buyDesc: opt('buyDesc', 200),
    barcode: opt('barcode', 30),
    revenueAcc: accOf('revenueAcc', revenueAccounts, 'รายได้'),
    expenseAcc: type === 'stock' ? '' : accOf('expenseAcc', billAccounts, 'ค่าใช้จ่าย'),
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

  /* จำหน่ายต้องทำผ่านเอกสารขาย/ตัดจำหน่าย (assets.js) — เปลี่ยนสถานะเฉย ๆ ไม่ลงบัญชีอะไรเลย
     ราคาทุนและค่าเสื่อมสะสมจะค้างอยู่ในงบตลอดไป และไม่มีกำไรขาดทุนจากการจำหน่าย */
  if (input.status === 'disposed' && !(existing && existing.status === 'disposed')) {
    throw new DomainError('ASSET_DISPOSE_USE_DOC', 'การจำหน่ายทรัพย์สินต้องบันทึกผ่านปุ่ม "ขาย/ตัดจำหน่าย"',
      'ระบบจะคิดค่าเสื่อมถึงเดือนที่จำหน่าย ล้างราคาทุนกับค่าเสื่อมสะสม ลงกำไรขาดทุนและภาษีขายให้ในครั้งเดียว');
  }
  if (existing && existing.disposalNo && input.status === 'in_use') {
    throw new DomainError('ASSET_DISPOSED_LOCKED', 'ทรัพย์สินนี้จำหน่ายไปแล้วตาม ' + existing.disposalNo,
      'ถ้าบันทึกจำหน่ายผิด ให้ยกเลิกเอกสาร ' + existing.disposalNo + ' ระบบจะคืนทรัพย์สินเข้าทะเบียนให้');
  }
  const accumBook = input.accumBook === undefined && existing ? existing.accumBook : M(String(input.accumBook || '0'));
  const accumTax = input.accumTax === undefined && existing ? existing.accumTax : M(String(input.accumTax || '0'));
  /* คิดค่าเสื่อมหรือจำหน่ายไปแล้ว ตัวเลขผูกกับใบสำคัญแล้ว — แก้ราคาทุนหรือค่าเสื่อมสะสมในทะเบียนจะไม่ตรงบัญชี */
  const depreciated = existing && (!!existing.disposalNo || DB.docs.depreciation
    .some((d) => d.status !== 'void' && (d.rows || []).some((r) => r.code === existing.code)));
  if (depreciated && (cost !== existing.cost || inService !== existing.inService || cls !== existing.class
      || accumBook !== existing.accumBook || accumTax !== existing.accumTax)) {
    throw new DomainError('ASSET_ALREADY_DEPRECIATED',
      'ทรัพย์สินนี้คิดค่าเสื่อม' + (existing.disposalNo ? 'และจำหน่าย' : '') + 'ไปแล้ว แก้ราคาทุน วันที่เริ่มใช้ ประเภท หรือค่าเสื่อมสะสมไม่ได้',
      existing.disposalNo ? 'ยกเลิกเอกสาร ' + existing.disposalNo + ' ก่อนถ้าต้องแก้'
        : 'ถ้าคีย์ผิดตั้งแต่แรก ให้ยกเลิกค่าเสื่อมของงวดที่เกี่ยวข้องก่อน');
  }
  if (accumBook > cost) {
    throw new DomainError('ACCUM_EXCEEDS_COST',
      'ค่าเสื่อมสะสมทางบัญชี ' + fmt(accumBook) + ' เกินราคาทุน ' + fmt(cost));
  }
  if (accumBook < 0 || accumTax < 0) throw new DomainError('ACCUM_NEGATIVE', 'ค่าเสื่อมสะสมติดลบไม่ได้');
  /* บัญชีแยกประเภทของทรัพย์สินตัวนี้ (ว่าง = บัญชีหลักของประเภท) ใช้ตอนตั้งค่าเสื่อม จำหน่าย และเทียบทะเบียนกับบัญชี */
  const accountIn = input.account !== undefined ? input.account : existing ? existing.account : null;
  const accumIn = input.accumAccount !== undefined ? input.accumAccount : existing ? existing.accumAccount : null;
  if (existing && existing.disposalNo && ((accountIn || null) !== (existing.account || null)
      || (accumIn || null) !== (existing.accumAccount || null))) {
    throw new DomainError('ASSET_DISPOSED_LOCKED', 'ทรัพย์สินนี้จำหน่ายไปแล้วตาม ' + existing.disposalNo + ' เปลี่ยนบัญชีไม่ได้',
      'ใบสำคัญของการจำหน่ายลงบัญชีเดิมไปแล้ว');
  }
  const rec = {
    code: existing ? existing.code : nextRegCode('FA', DB.assets),
    name: name, class: cls, inService: inService, cost: cost,
    bookYears: cls === 'LAND' ? 0 : bookYears,
    accumBook: accumBook, accumTax: accumTax,
    account: accountIn ? assertAssetAccount(String(accountIn), cls) : null,
    accumAccount: accumIn && cls !== 'LAND' ? assertAccumAccount(String(accumIn)) : null,
    note: input.note !== undefined ? String(input.note || '').trim() : existing ? existing.note || '' : '',
    /* ทะเบียนรุ่นก่อนที่ตั้ง "จำหน่ายแล้ว" เอง กลับมาเป็นใช้งานอยู่ได้ เพื่อบันทึกการจำหน่ายให้ถูกต้อง */
    status: existing ? (existing.status === 'disposed' && !existing.disposalNo && input.status === 'in_use' ? 'in_use' : existing.status)
      : 'in_use',
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

/* ---------- บัญชีรายได้ของแต่ละบรรทัด ----------
   เดิมบรรทัดที่พิมพ์เองโดยไม่เลือกสินค้าลงรายได้จากการขายทุกครั้ง ค่าที่ปรึกษาจึงไปปนกับยอดขายสินค้า
   ตอนนี้เลือกบัญชีรายได้ได้ทีละบรรทัด ไม่เลือก = ตามชนิดสินค้า (บริการ → รายได้ค่าบริการ · สินค้า → รายได้จากการขาย) */
/* บัญชีรายได้ที่ระบบลงให้เองจากงานอื่น ไม่เปิดให้เลือกเป็นรายได้ของเอกสารขาย */
const REVENUE_SYSTEM_SUBS = ['sales_return', 'sales_discount', 'fx_gain', 'gain_on_disposal', 'bad_debt_recovery', 'interest_income'];
function revenueAccounts() {
  return DB.accounts.filter((a) => a.postable && a.type === 'revenue' && REVENUE_SYSTEM_SUBS.indexOf(a.subType) < 0);
}
/** บัญชีรายได้ปริยาย — บริการลงรายได้ค่าบริการ นอกนั้นลงรายได้จากการขาย */
function defaultRevenueAccount(itemCode, revenueSub) {
  const it = itemCode ? DB.items.find((x) => x.code === itemCode) : null;
  /* บัญชีรายได้ที่ตั้งไว้ในทะเบียนสินค้า มาก่อนค่าปริยายตามชนิด */
  if (!revenueSub && it && it.revenueAcc && revenueAccounts().some((a) => a.code === it.revenueAcc)) return it.revenueAcc;
  const sub = revenueSub || (it && it.type === 'service' ? 'service_revenue' : 'sales_revenue');
  const accs = DB.accounts.filter((a) => a.postable && a.subType === sub);
  const a = accs.find((x) => x.isDefault) || accs[0];
  return a ? a.code : accBySub('sales_revenue');
}
function revenueLineAccount(l, i) {
  if (!l.acc) return defaultRevenueAccount(l.itemCode, l.revenueSub);
  if (!revenueAccounts().some((a) => a.code === l.acc)) {
    throw new DomainError('REVENUE_ACCOUNT_INVALID', 'บรรทัดที่ ' + (i + 1) + ' บัญชี ' + l.acc + ' ใช้บันทึกรายได้จากการขายไม่ได้',
      'เลือกบัญชีหมวดรายได้ เช่น รายได้จากการขาย หรือรายได้ค่าบริการ');
  }
  return l.acc;
}

/* ---------- ขาย: ออกใบกำกับภาษี ---------- */
function issueInvoice(input) {
  const p = partnerByCode(input.partnerCode);
  const snap = applyContactEdits(snapshotPartner(p), input.contact);
  const lines = input.lines.filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  assertTaxInvoiceComplete(snap, lines);

  const P = priceLines(lines, input.date, input.pricing);
  const v = P.v;
  const head = docHeader(input, p, input.date);
  /* หักเงินมัดจำที่ออกใบกำกับไปแล้วตอนรับเงิน (settle.js) — v เหลือเฉพาะมูลค่าและภาษีที่ยังไม่ได้เก็บ */
  const dep = (input.deposits || []).length ? depositDeduction('ar', p.code, input.deposits, v, input.date) : { lines: [], fields: {} };
  assertStockAvailable(lines);
  const lineAcc = lines.map((l, i) => revenueLineAccount(l, i));
  const no = input.forceNo || nextNo('invoice', input.date);
  const due = head.due;

  const revLines = {};
  lines.forEach(function (l, i) {
    const a = lineAcc[i];
    revLines[a] = (revLines[a] || 0) + P.rows[i].net;
  });

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ขายสินค้า/บริการ ' + snap.name + ' (' + no + ')',
    src: 'invoice', srcId: no,
    lines: [
      { acc: accBySub('trade_receivable'), dr: v.total, partner: p.code },
    ].concat(Object.keys(revLines).map((a) => ({ acc: a, cr: revLines[a] })))
     .concat(v.vat ? [{ acc: accBySub('output_vat'), cr: v.vat }] : [])
     .concat(dep.lines),
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
    snap, lines: lines.map((l, i) => Object.assign({
      desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
      taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null, acc: lineAcc[i],
      disc: lineDiscText(l.disc), gross: P.rows[i].gross, amount: P.rows[i].net,
    }, l.soLine !== undefined && l.soLine !== null ? { soLine: Number(l.soLine) } : {})),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    pricing: P.pricing, totals: P.totals, ...head,
    paid: 0, credited: 0, status: 'issued',
    entryNo: je.no, cogsEntryNo: cogsJe ? cogsJe.no : null,
    etax: 'accepted',
    /* ใบสั่งขายที่ทยอยออกใบกำกับ — นับจำนวนที่ออกไปแล้วจากใบกำกับที่ยังไม่ยกเลิก */
    soNo: input.soNo || null, fromDoc: input.fromDoc || null,
    /* ชนิดเอกสารต้นทาง (ใบเสนอราคา ใบสั่งขาย ใบวางบิล/ใบแจ้งหนี้) — ลิงก์กลับไปหาต้นทางได้ตรง ๆ */
    fromKind: input.fromDoc ? (input.fromKind || (input.soNo ? 'salesOrder' : 'quotation')) : null,
    /* ใบใหม่เริ่มที่ "รอดำเนินการ" (ยังไม่ส่งให้ลูกค้า แก้ไขได้) — ส่งแล้วเป็น "รอเก็บเงิน"
       ใบรุ่นก่อนไม่มีช่องนี้ ถือว่าส่งแล้ว */
    delivered: input.delivered === true,
    ...dep.fields,
  };
  /* ลูกค้าจะหักภาษี ณ ที่จ่าย — พิมพ์ยอดชำระสุทธิให้ลูกค้าเห็น และเป็นค่าเริ่มต้นตอนรับชำระ (ยังไม่ลงบัญชี) */
  if (input.whtCode && input.whtCode !== 'none') Object.assign(doc, docWht(input.whtCode, doc, input.date));
  DB.docs.invoice.unshift(doc);
  audit('invoice', no, 'issue', null, { total: fmt(v.total), partner: snap.name });
  return doc;
}

/* ---------- ขาย: รับชำระเงิน ---------- */
/** ส่วนที่ลูกค้าจ่ายขาด ปิดยอดได้ตอนรับชำระ — ไม่งั้นใบกำกับค้างเศษไปตลอดและอายุลูกหนี้ไม่มีวันสะอาด
    เศษผลต่างจำกัดยอดไว้ ยอดมากกว่านั้นต้องเป็นส่วนลดที่ตกลงกัน หรือตัดหนี้สูญ */
const RECEIPT_DIFF = {
  fee:      { label:'ค่าธรรมเนียมธนาคาร', acc: () => ensureAccount('finance_cost', '5410', 'ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', 'expense') },
  discount: { label:'ส่วนลดจ่าย', acc: () => ensureAccount('sales_discount', '4131', 'ส่วนลดจ่าย', 'revenue') },
  writeoff: { label:'เศษผลต่างเล็กน้อย', acc: () => ensureAccount('rounding', '9920', 'ผลต่างจากการปัดเศษ', 'expense'), max: M('100') },
};
/** บัญชีที่รับหรือจ่ายเงินต้องเป็นเงินสดหรือเงินฝากธนาคาร — ไม่งั้นเงินไปค้างบัญชีอื่นแล้วกระทบยอดธนาคารไม่ได้ */
function cashAccount(code, what) {
  const c = code || accBySub('bank');
  const a = acc(c);
  if (!a.postable || (a.subType !== 'cash' && a.subType !== 'bank')) {
    throw new DomainError('CASH_ACCOUNT_INVALID', what + 'ต้องเป็นบัญชีเงินสดหรือเงินฝากธนาคาร (' + a.code + ' ' + a.name + ' ใช้ไม่ได้)',
      'เลือกเงินสดในมือ เงินสดย่อย หรือบัญชีธนาคารที่รับ/จ่ายเงินจริง');
  }
  return c;
}
/* รายการปรับลดตอนรับชำระ (ลูกค้าหักไว้ หรือเราตกลงลดให้) — ปิดลูกหนี้ด้วยยอดเต็ม เงินเข้าบัญชีน้อยลงตามรายการ
   ปัดเศษเป็นได้ทั้งบวก (ลูกค้าปัดลง) และลบ (ลูกค้าปัดขึ้น) · ส่วนลดพิเศษหักจากรายได้ ไม่ได้ลดภาษีขาย (ไม่ใช่ใบลดหนี้) */
const RECEIPT_ADJ = {
  special_discount: { label:'ส่วนลดพิเศษ', acc: () => ensureAccount('sales_discount', '4131', 'ส่วนลดจ่าย', 'revenue') },
  commission:       { label:'ค่านายหน้าและส่วนแบ่งการขาย', acc: () => ensureAccount('selling_expense', '5200', 'ค่าใช้จ่ายในการขาย', 'expense') },
  processing_fee:   { label:'ค่าดำเนินการ', acc: () => ensureAccount('finance_cost', '5410', 'ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', 'expense') },
  rounding:         { label:'ปัดเศษ', acc: () => ensureAccount('rounding', '9920', 'ผลต่างจากการปัดเศษ', 'expense'), signed: true, max: M('100') },
};
/* เงินที่เข้าบัญชีจริงไม่เท่ายอดที่คำนวณ — ส่วนต่างจัดเป็นเงินขาด/เกิน หรือค่าธรรมเนียมธนาคาร (ขาดได้อย่างเดียว) */
const RECEIPT_GAP = {
  short_over: { label:'เงินขาดหรือเงินเกิน', acc: () => cashShortOverAccount() },
  bank_fee:   { label:'ค่าธรรมเนียมธนาคาร', acc: () => ensureAccount('finance_cost', '5410', 'ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', 'expense'), shortOnly: true },
};
const RECEIPT_METHODS = { cash:'เงินสด', transfer:'โอนเงิน', cheque:'เช็ค', card:'บัตรเครดิต', other:'ช่องทางอื่น', promptpay:'พร้อมเพย์' };
/* อัตราที่ลูกค้าหัก ณ ที่จ่ายได้ตามที่เลือกในหน้ารับชำระ — ระบุเป็นจำนวนเงินเองก็ได้ */
const RECEIPT_WHT_RATES = ['0.5', '0.75', '1', '1.5', '2', '3', '5', '10', '15'];
/** บัญชีเงินขาด/เกิน — อยู่หมวดผลต่างปัดเศษ (ค่าใช้จ่ายบริหาร) แต่แยกบัญชีให้เห็นชัด ผังรุ่นเก่าที่ไม่มีสร้างให้ */
function cashShortOverAccount() {
  const a = DB.accounts.find((x) => x.postable && x.subType === 'rounding' && /เงินขาด|เงินเกิน/.test(x.name || ''));
  if (a) return a.code;
  let c = '9921';
  for (let i = 1; DB.accounts.some((x) => x.code === c); i++) c = '9921-' + i;
  DB.accounts.push({ code: c, name: 'เงินขาดหรือเงินเกินบัญชี', type: 'expense', subType: 'rounding', postable: true, requiresPartner: false, level: 3 });
  DB.accounts.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
  audit('account', c, 'create', null, { name: 'เงินขาดหรือเงินเกินบัญชี', subType: 'rounding' }, 'ระบบสร้างบัญชีที่ต้องใช้แต่ผังบัญชีรุ่นเก่ายังไม่มี');
  return c;
}
const salesGiven = (x) => x !== undefined && x !== null && String(x).trim() !== '';
/** ตัวเลขทั้งหมดของการรับชำระครั้งนี้ — ใช้ทั้งตอนลงบัญชีและสรุปยอดระหว่างกรอก ตัวเลขที่เห็นจึงตรงกับที่จะบันทึก
    ยอดที่ชำระ (amount) ปิดลูกหนี้ · เงินเข้าบัญชี = ยอดที่ชำระ − หัก ณ ที่จ่าย − ค่าธรรมเนียม − รายการปรับลด ± ส่วนต่าง
    ไม่แตะข้อมูลใด ๆ (ไม่สร้างบัญชี) — ผิดกติกาโยนข้อผิดพลาดแบบเดียวกับตอนบันทึก */
function receiptMath(inv, input) {
  const outstanding = invOutstanding(inv);
  if (outstanding <= 0) throw new DomainError('ALREADY_PAID', 'ใบกำกับภาษีนี้ชำระครบแล้ว');
  const paidIn = salesGiven(input.amount) ? M(input.amount) : outstanding;
  if (paidIn <= 0) throw new DomainError('RECEIPT_ZERO', 'ยอดรับชำระต้องมากกว่าศูนย์');
  const diffType = input.diffType || null;
  if (diffType && diffType !== 'credit' && !RECEIPT_DIFF[diffType]) {
    throw new DomainError('RECEIPT_DIFF_INVALID', 'ไม่รู้จักวิธีปิดส่วนต่าง ' + diffType);
  }
  /* ลูกค้าจ่ายเกิน — ส่วนเกินเก็บเป็นเครดิตของลูกค้า (บัญชีเงินรับล่วงหน้า) ใช้หักใบถัดไปหรือคืนเงินได้ภายหลัง */
  let excess = 0;
  if (paidIn > outstanding) {
    if (diffType !== 'credit') {
      throw new DomainError('OVER_PAYMENT',
        'ยอดรับชำระ ' + fmt(paidIn) + ' เกินยอดคงค้าง ' + fmt(outstanding),
        'ถ้าลูกค้าจ่ายเกินจริง ให้เลือก "เก็บส่วนเกินเป็นเครดิตของลูกค้า" ระบบจะบันทึกส่วนเกินเป็นเงินรับล่วงหน้า');
    }
    excess = paidIn - outstanding;
  }
  const gross = paidIn - excess;
  /* ลูกค้าจ่ายขาด (ถูกหักค่าโอน ได้ส่วนลด หรือเศษ) — ปิดยอดส่วนที่ขาด ใบกำกับจะไม่ค้างเศษไปตลอด */
  let diff = 0;
  const closing = RECEIPT_DIFF[diffType];
  if (closing && gross < outstanding) {
    diff = outstanding - gross;
    if (closing.max && diff > closing.max) {
      throw new DomainError('RECEIPT_DIFF_TOO_LARGE',
        'ส่วนต่าง ' + fmt(diff) + ' บาท มากเกินกว่าจะตัดเป็นเศษผลต่าง (ไม่เกิน ' + fmt(closing.max) + ' บาท)',
        'ถ้าตกลงลดให้ลูกค้า เลือกส่วนลดจ่าย ถ้าเก็บไม่ได้แล้ว ให้ตัดหนี้สูญที่หน้าใบกำกับ');
    }
  }
  /* ภาษีที่ลูกค้าหักไว้ — ฐานคือค่าบริการก่อน VAT ส่วนที่ชำระครั้งนี้ ไม่รวมค่าสินค้า
     ถ้าลูกค้าหักจากฐานอื่น (ตาม 50 ทวิ ที่ได้รับ) ระบุ whtBase มาแทนได้
     ปิดส่วนต่างแล้วถือเป็นการรับครั้งสุดท้าย ฐานคือค่าบริการที่เหลือทั้งหมด
     เลือกได้สามแบบ: ประเภทเงินได้ (whtCode) · อัตราตามรายการ (whtRate) · จำนวนเงินตาม 50 ทวิ (whtAmount) */
  const svcShare = receiptServiceShare(inv, gross + diff);
  let wht = 0, whtRate = null, whtBase = 0;
  if (input.whtCode || salesGiven(input.whtRate) || salesGiven(input.whtAmount)) {
    whtBase = salesGiven(input.whtBase) ? M(input.whtBase) : svcShare;
    if (whtBase < 0 || whtBase > gross + diff) {
      throw new DomainError('WHT_BASE_INVALID', 'ฐานภาษีที่ลูกค้าหัก ' + fmt(whtBase) + ' ต้องไม่ติดลบและไม่เกินยอดรับ ' + fmt(gross + diff),
        'ดูฐานภาษีจากหนังสือรับรอง 50 ทวิ ที่ลูกค้าส่งมา');
    }
    if (salesGiven(input.whtRate)) {
      const r = String(input.whtRate).trim().replace(/%$/, '');
      if (!(M(r) > 0) || M(r) > M('15')) {
        throw new DomainError('WHT_RATE_INVALID', 'อัตราภาษีหัก ณ ที่จ่าย ' + r + '% ไม่ถูกต้อง',
          'เลือกอัตราตามหนังสือรับรอง 50 ทวิ (0.5 ถึง 15%) หรือระบุเป็นจำนวนเงิน');
      }
      whtRate = r;
    } else if (input.whtCode) whtRate = resolveRate(input.whtCode, input.date || TODAY, { channel: 'manual' }).rate;
    wht = salesGiven(input.whtAmount) ? M(input.whtAmount) : round2(pct(whtBase, whtRate));
    if (wht < 0) throw new DomainError('WHT_NEGATIVE', 'ภาษีที่ลูกค้าหัก ณ ที่จ่ายติดลบไม่ได้');
  }
  const fee = salesGiven(input.fee) ? M(input.fee) : 0;
  if (fee < 0) throw new DomainError('RECEIPT_FEE_NEGATIVE', 'ค่าธรรมเนียมติดลบไม่ได้');
  const adjustments = (input.adjustments || []).filter((a) => a && salesGiven(a.amount) && M(a.amount) !== 0).map(function (a, i) {
    const t = RECEIPT_ADJ[a.type];
    if (!t) throw new DomainError('RECEIPT_ADJ_INVALID', 'ไม่รู้จักรายการปรับลด ' + (a.type || '(ไม่ระบุ)'));
    const amount = M(a.amount);
    if (amount < 0 && !t.signed) {
      throw new DomainError('RECEIPT_ADJ_NEGATIVE', t.label + ' (รายการที่ ' + (i + 1) + ') ติดลบไม่ได้', 'ติดลบได้เฉพาะปัดเศษขึ้น');
    }
    if (t.max && Math.abs(amount) > t.max) {
      throw new DomainError('RECEIPT_ADJ_TOO_LARGE', t.label + ' ' + fmt(Math.abs(amount)) + ' บาท เกิน ' + fmt(t.max) + ' บาท',
        'ยอดที่มากกว่านี้ให้บันทึกเป็นส่วนลดพิเศษ หรือรับบางส่วนแล้วตัดหนี้สูญ');
    }
    return { type: a.type, label: t.label, amount };
  });
  const adjTotal = adjustments.reduce((s, a) => s + a.amount, 0);
  /* เงินที่ควรเข้าบัญชี — ถ้าระบุยอดที่ได้รับจริงมา ส่วนต่างต้องจัดประเภท */
  const expected = gross + excess - wht - fee - adjTotal;
  let gap = 0, gapType = null;
  const received = salesGiven(input.received) ? M(input.received) : null;
  if (received !== null) {
    if (received < 0) throw new DomainError('RECEIPT_RECEIVED_NEGATIVE', 'ยอดที่ได้รับจริงติดลบไม่ได้');
    gap = expected - received;
    if (gap) {
      gapType = input.gapType || 'short_over';
      const g = RECEIPT_GAP[gapType];
      if (!g) throw new DomainError('RECEIPT_GAP_INVALID', 'ไม่รู้จักประเภทส่วนต่าง ' + gapType);
      if (gap < 0 && g.shortOnly) {
        throw new DomainError('RECEIPT_GAP_OVER_FEE', 'ได้รับเงินมากกว่ายอดที่คำนวณ ' + fmt(-gap) + ' บาท จัดเป็นค่าธรรมเนียมธนาคารไม่ได้',
          'เลือก "เงินขาดหรือเงินเกิน" หรือตรวจยอดที่ได้รับอีกครั้ง');
      }
    }
  }
  const net = expected - gap;
  if (net < 0) {
    throw new DomainError('RECEIPT_NET_NEGATIVE',
      wht && !fee && !adjTotal ? 'ภาษีที่ลูกค้าหัก ' + fmt(wht) + ' มากกว่ายอดที่รับ'
        : 'ภาษีที่ถูกหัก ค่าธรรมเนียม และรายการปรับลดรวมกันมากกว่ายอดที่รับ',
      'ตรวจยอดรับและฐานภาษีตาม 50 ทวิ อีกครั้ง');
  }
  return { outstanding, paidIn, excess, gross, diff, diffType: diff ? diffType : null, svcShare, wht, whtRate, whtBase,
    fee, adjustments, adjTotal, expected, received, gap, gapType, net };
}
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
  const r = receiptMath(inv, input);
  const { gross, diff, excess, wht, fee, net, gap } = r;
  const diffAcc = diff ? RECEIPT_DIFF[r.diffType].acc() : null;
  const bankAcc = cashAccount(input.bankAccount, 'บัญชีที่รับเงิน');
  const depAcc = excess ? ensureAccount('customer_deposit', '2161', 'เงินมัดจำรับจากลูกค้า', 'liability') : null;
  const feeAcc = fee ? ensureAccount('finance_cost', '5410', 'ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', 'expense') : null;
  const adj = r.adjustments.map((a) => Object.assign({}, a, { acc: RECEIPT_ADJ[a.type].acc() }));
  const gapAcc = gap ? RECEIPT_GAP[r.gapType].acc() : null;
  assertPostingOpen(input.date);
  const no = nextNo('receipt', input.date);
  const side = (acc, v, memo) => (v > 0 ? { acc, dr: v, memo } : { acc, cr: -v, memo });

  const je = post({
    type: 'receipt', date: input.date,
    desc: 'รับชำระจาก ' + inv.partnerName + ' (' + inv.no + ')',
    src: 'receipt', srcId: no,
    lines: [
      { acc: bankAcc, dr: net },
    ].concat(wht ? [{ acc: accBySub('wht_asset'), dr: wht }] : [])
     .concat(fee ? [{ acc: feeAcc, dr: fee, memo: 'ค่าธรรมเนียมธนาคาร ' + inv.no }] : [])
     .concat(adj.map((a) => side(a.acc, a.amount, a.label + 'ตอนรับชำระ ' + inv.no)))
     .concat(gap ? [side(gapAcc, gap, RECEIPT_GAP[r.gapType].label + ' ตอนรับชำระ ' + inv.no)] : [])
     .concat(diff ? [{ acc: diffAcc, dr: diff, memo: RECEIPT_DIFF[r.diffType].label + 'ที่ลูกค้าจ่ายขาด ปิดยอด ' + inv.no }] : [])
     .concat([{ acc: accBySub('trade_receivable'), cr: gross + diff, partner: inv.partnerCode }])
     .concat(excess ? [{ acc: depAcc, cr: excess, partner: inv.partnerCode, memo: 'รับเกินยอดใบกำกับ เก็บเป็นเครดิตของลูกค้า' }] : []),
  });

  inv.paid += gross;
  if (diff) inv.settled = (inv.settled || 0) + diff;
  /* รับเงินแล้วแปลว่าส่งเอกสารให้ลูกค้าแล้ว — ใบที่ยังรอดำเนินการเลื่อนเป็นรอเก็บเงิน/เก็บเงินแล้วเอง */
  markInvoiceDelivered(inv);
  syncInvStatus(inv);

  const txt = (v, n) => String(v === undefined || v === null ? '' : v).trim().slice(0, n);
  const doc = {
    no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, method: input.method || 'transfer', bankAccount: bankAcc,
    gross, wht, whtRate: r.whtRate, whtBase: r.whtBase, svcShare: r.svcShare, net, entryNo: je.no,
    whtCertReceived: !!(input.whtCode || salesGiven(input.whtRate) || salesGiven(input.whtAmount)),
    whtManual: salesGiven(input.whtAmount) || undefined,
    diff, diffType: r.diffType, diffAcc, excess,
    fee, feeAcc, adjustments: adj, received: r.received, gap, gapType: r.gapType, gapAcc,
    /* ข้อมูลการรับเงิน — ธนาคารของผู้โอน · เลขที่/วันที่/ธนาคารของเช็ค · หมายเหตุ (พิมพ์บนใบเสร็จ) */
    payerBank: txt(input.payerBank, 60), chequeNo: txt(input.chequeNo, 30), chequeDate: input.chequeDate || null,
    chequeBank: txt(input.chequeBank, 60), note: txt(input.note, 500),
  };
  DB.docs.receipt.unshift(doc);
  /* เงินรับเกินเป็นเครดิตของลูกค้า — ทะเบียนเดียวกับเงินมัดจำรับ จะได้เห็นยอดที่ต้องหักหรือคืนรวมที่เดียว */
  if (excess) {
    DB.docs.customerDeposit.unshift({
      no, kind: 'overpay', date: input.date, partnerCode: inv.partnerCode, partnerName: inv.partnerName,
      taxCode: 'NONE', base: excess, vat: 0, total: excess, applied: 0, appliedVat: 0, refunded: 0, refundedVat: 0,
      srcReceipt: no, invoiceNo: inv.no, acc: depAcc, entryNo: je.no, status: 'open',
      desc: 'รับเกินยอดใบกำกับ ' + inv.no,
    });
  }
  audit('receipt', no, 'create', null, { invoice: inv.no, net: fmt(net), diff: diff ? fmt(diff) : undefined, excess: excess ? fmt(excess) : undefined,
    fee: fee ? fmt(fee) : undefined, adjust: adj.length ? fmt(r.adjTotal) : undefined, gap: gap ? fmt(gap) : undefined });
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
  markInvoiceDelivered(inv);
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
  /* เพิ่มหนี้ค่าบริการต้องเข้ารายได้ค่าบริการ ไม่ใช่รายได้จากการขายทุกครั้ง — ไม่เลือกใช้บัญชีหลักของใบกำกับเดิม */
  const revAcc = input.acc ? revenueLineAccount({ acc: input.acc }, 0) : invoiceRevenueAccount(inv, code);
  const no = nextNo('debitNote', input.date);

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ใบเพิ่มหนี้ ' + no + ' อ้าง ' + inv.no + ' — ' + DN_REASONS[input.reason],
    src: 'debitNote', srcId: no,
    lines: [
      { acc: accBySub('trade_receivable'), dr: total, partner: inv.partnerCode },
      { acc: revAcc, cr: base },
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
  markInvoiceDelivered(inv);
  syncInvStatus(inv);

  const doc = { no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, reason: input.reason, reasonText: DN_REASONS[input.reason],
    taxCode: code, base, vat, total, acc: revAcc, entryNo: je.no };
  DB.docs.debitNote.unshift(doc);
  audit('debitNote', no, 'issue', null, { ref: inv.no, total: fmt(total), reason: DN_REASONS[input.reason] });
  return doc;
}
/** บัญชีรายได้หลักของใบกำกับ (บัญชีที่ยอดรวมสูงสุดในอัตราภาษีนั้น) — ใบรุ่นก่อนที่ไม่ได้เก็บบัญชีไว้ เดาจากสินค้า */
function invoiceRevenueAccount(inv, code) {
  const ls = inv.lines.filter((l) => !code || (l.taxCode || 'VAT7') === code);
  const tot = {};
  (ls.length ? ls : inv.lines).forEach(function (l) {
    const a = l.acc && DB.accounts.some((x) => x.code === l.acc) ? l.acc : defaultRevenueAccount(l.itemCode, null);
    tot[a] = (tot[a] || 0) + l.amount;
  });
  return Object.keys(tot).sort((a, b) => tot[b] - tot[a])[0] || defaultRevenueAccount(null, null);
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

/* ---------- ภาษีหัก ณ ที่จ่ายบนเอกสาร (ใบเสนอราคา ใบสั่งขาย ใบสั่งซื้อ ใบกำกับ) ----------
   ยังไม่ลงบัญชี — บอกอีกฝ่ายว่าจะถูกหัก/ต้องหักเท่าไร และยอดชำระสุทธิเท่าไร ภาษีจริงคิดตอนรับ/จ่ายเงิน
   ฐานคือค่าบริการก่อนภาษีมูลค่าเพิ่ม ไม่รวมค่าสินค้าที่มีสต๊อก (ซื้อขายสินค้าไม่ต้องหัก)
   มูลค่าทั้งใบต่ำกว่า 1,000 บาทไม่ต้องหัก (ท.ป.4/2528) */
const WHT_DOC_MIN = M('1000');
function docWht(whtCode, doc, date) {
  const code = whtCode && whtCode !== 'none' ? whtCode : null;
  if (!code) return { whtCode: null, whtRate: null, whtBase: 0, wht: 0, payNet: doc.total };
  const r = resolveRate(code, date, { channel: 'manual' });
  const all = doc.lines.reduce((s, l) => s + l.amount, 0);
  const goods = doc.lines.reduce(function (s, l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    return s + (it && (it.type === 'stock' || it.type === 'nonstock') ? l.amount : 0);
  }, 0);
  /* doc.base หลังหักเงินมัดจำแล้ว (ใบกำกับ) — ส่วนของค่าบริการคิดตามสัดส่วนบรรทัด */
  const base = all ? round2(mulDiv(doc.base, all - goods, all)) : 0;
  const under = doc.base < WHT_DOC_MIN;
  const wht = under ? 0 : round2(pct(base, r.rate));
  return { whtCode: code, whtRate: r.rate, whtBase: under ? 0 : base, wht, payNet: doc.total - wht, whtUnder: under || undefined };
}

/** คู่ค้าและบรรทัดของเอกสารก่อนลงบัญชี — ใช้ทั้งตอนออกใหม่และตอนแก้ไข
    บัญชีที่เลือกไว้ในบรรทัดตรวจตั้งแต่ตอนนี้ ไม่ต้องรอไปพังตอนแปลงเป็นใบกำกับหรือตั้งหนี้ */
function tradeDocParts(kind, input) {
  const cfg = TRADE_DOCS[kind];
  if (!cfg) throw new DomainError('TRADE_DOC_KIND_UNKNOWN', 'ไม่รู้จักเอกสารประเภท ' + kind);
  const p = partnerByCode(input.partnerCode);
  if (cfg.side === 'customer' ? !isCustomer(p) : !isVendor(p)) {
    throw new DomainError('PARTNER_WRONG_SIDE',
      cfg.label + 'ต้องออกให้' + (cfg.side === 'customer' ? 'ลูกค้า' : 'ผู้ขาย')
      + ' แต่ ' + p.name + ' อยู่ในทะเบียน' + (PARTNER_KINDS[p.kind] || 'อื่น'));
  }
  const lines = (input.lines || []).filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการอย่างน้อย 1 บรรทัด');
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่เอกสาร');
  const accs = lines.map(function (l, i) {
    if (!l.acc) return null;
    return cfg.side === 'customer' ? revenueLineAccount(l, i) : billLineAccount(l, i);
  });
  const P = priceLines(lines, input.date, input.pricing);
  return { cfg, p, v: P.v, P, rows: lines.map((l, i) => ({
    desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
    taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null, acc: accs[i],
    expenseSub: l.expenseSub || null, revenueSub: l.revenueSub || null,
    disc: lineDiscText(l.disc), gross: P.rows[i].gross, amount: P.rows[i].net,
  })) };
}

function issueTradeDoc(kind, input) {
  const t = tradeDocParts(kind, input);
  const cfg = t.cfg, p = t.p, v = t.v;
  const no = nextNo(kind, input.date);
  const validUntil = input.validUntil
    || (cfg.validDays ? addDays(input.date, cfg.validDays) : null);

  const doc = {
    no, date: input.date, validUntil,
    partnerCode: p.code, partnerName: p.name, snap: applyContactEdits(snapshotPartner(p), input.contact),
    lines: t.rows,
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    pricing: t.P.pricing, totals: t.P.totals, ...docHeader(input, p, input.date),
    status: 'issued', convertedTo: null, fromDoc: input.fromDoc || null,
  };
  Object.assign(doc, docWht(input.whtCode, doc, input.date));
  DB.docs[kind].unshift(doc);
  audit(kind, no, 'issue', null, { partner: p.name, total: fmt(v.total) });
  return doc;
}

/** แก้ไขใบเสนอราคา/ใบสั่งขาย/ใบสั่งซื้อ — ได้เฉพาะใบที่ยังไม่ตอบรับ ไม่ได้แปลง และยังไม่ได้รับของ/ออกใบกำกับ
    ใบที่ลูกค้าตอบรับหรือผู้ขายยืนยันแล้วคือข้อตกลงที่อีกฝ่ายเห็นแล้ว แก้เงียบ ๆ ไม่ได้ ต้องยกเลิกแล้วออกใหม่
    เลขที่เดิมคงไว้ ใบไม่มีผลทางบัญชีจึงแก้ได้โดยไม่ต้องกลับรายการ แต่บันทึกร่องรอยการแก้ทุกครั้ง */
function updateTradeDoc(kind, no, input) {
  const cfg = TRADE_DOCS[kind];
  if (!cfg) throw new DomainError('TRADE_DOC_KIND_UNKNOWN', 'ไม่รู้จักเอกสารประเภท ' + kind);
  const d = tradeDocFind(kind, no);
  if (d.status !== 'issued') {
    const why = { approved: (kind === 'purchaseOrder' ? 'ผู้ขายยืนยัน' : 'ลูกค้าตอบรับ') + 'แล้ว',
      closed: 'แปลงเป็น ' + d.convertedTo + ' แล้ว', cancelled: 'ถูกยกเลิกแล้ว', rejected: 'ถูกปฏิเสธแล้ว',
      partially_received: 'รับสินค้าไปบางส่วนแล้ว', partially_invoiced: 'ออกใบกำกับไปบางส่วนแล้ว' }[d.status] || d.status;
    throw new DomainError('TRADE_DOC_NOT_EDITABLE', cfg.label + ' ' + no + ' ' + why + ' แก้ไขไม่ได้',
      'ยกเลิกใบนี้แล้วออกใบใหม่แทน');
  }
  /* ช่องที่ไม่ส่งมาใช้ค่าเดิม — แก้แค่หมายเหตุหรือวันยืนราคาได้โดยไม่ต้องส่งบรรทัดทั้งหมดมาใหม่ */
  const date = input.date || d.date;
  const t = tradeDocParts(kind, { partnerCode: input.partnerCode || d.partnerCode, date,
    lines: input.lines || d.lines.map((l) => ({ ...l, price: unM(l.price) })),
    pricing: input.pricing !== undefined ? input.pricing : d.pricing });
  const before = { partner: d.partnerName, total: fmt(d.total), lines: d.lines.length };
  /* วันยืนราคา: ระบุมา = ใช้ตามนั้น · เปลี่ยนวันที่เอกสาร = นับใหม่จากวันที่ใหม่ · ไม่เปลี่ยน = คงเดิม */
  const validUntil = !cfg.validDays ? null
    : input.validUntil ? input.validUntil
    : date !== d.date ? addDays(date, cfg.validDays) : d.validUntil;
  if (validUntil && validUntil < date) {
    throw new DomainError('TRADE_DOC_VALID_BEFORE_DATE', 'วันยืนราคาต้องไม่ก่อนวันที่เอกสาร');
  }
  d.date = date;
  d.validUntil = validUntil;
  const sameP = t.p.code === d.partnerCode;
  d.partnerCode = t.p.code; d.partnerName = t.p.name;
  /* ข้อมูลลูกค้าที่แก้บนเอกสาร: ส่งมาใหม่ใช้ของใหม่ · ไม่ส่งแต่คู่ค้าเดิม คงที่แก้ไว้ · เปลี่ยนคู่ค้า เริ่มจากทะเบียน */
  d.snap = input.contact !== undefined ? applyContactEdits(snapshotPartner(t.p), input.contact)
    : sameP && d.snap && d.snap.edited ? d.snap : snapshotPartner(t.p);
  d.lines = t.rows;
  d.base = t.v.std + t.v.zero + t.v.exempt; d.vat = t.v.vat; d.total = t.v.total;
  d.pricing = t.P.pricing; d.totals = t.P.totals;
  /* หัวเอกสาร — ช่องที่ไม่ส่งมาใช้ค่าเดิม */
  const keep = {};
  ['creditType', 'creditDays', 'dueDate', 'project', 'salesName', 'reference', 'note', 'internalNote'].forEach(function (k) {
    keep[k] = input[k] !== undefined ? input[k] : k === 'dueDate' ? (date !== d.date ? undefined : d.due) : d[k];
  });
  Object.assign(d, docHeader(keep, t.p, date));
  Object.assign(d, docWht(input.whtCode !== undefined ? input.whtCode : d.whtCode, d, date));
  d.revision = (d.revision || 0) + 1;
  d.updatedAt = new Date().toISOString();
  audit(kind, no, 'update', before, { partner: d.partnerName, total: fmt(d.total), lines: d.lines.length });
  return d;
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
  if (d.status === 'partially_received' && status !== 'cancelled') {
    throw new DomainError('TRADE_DOC_STATUS_INVALID', 'ใบสั่งซื้อ ' + no + ' รับสินค้าไปบางส่วนแล้ว ยกเลิกส่วนที่เหลือได้อย่างเดียว');
  }
  if (d.status === 'partially_invoiced' && status !== 'cancelled') {
    throw new DomainError('TRADE_DOC_STATUS_INVALID', 'ใบสั่งขาย ' + no + ' ออกใบกำกับไปบางส่วนแล้ว ยกเลิกส่วนที่เหลือได้อย่างเดียว');
  }
  d.status = status;
  if (reason) d.statusReason = reason;
  audit(kind, no, status, null, reason ? { reason } : null);
  return d;
}

/** แปลงเอกสารไปขั้นถัดไป — ใบเสนอราคา → ใบสั่งขาย (หรือ → ใบกำกับภาษีตรง ๆ เมื่อ input.to = 'invoice')
    ใบสั่งขาย → ใบกำกับภาษี (ส่วนที่ยังไม่ได้ออกทั้งหมด) · ใบสั่งซื้อ → ตั้งหนี้ */
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
  if (d.status === 'partially_received') {
    throw new DomainError('PO_PARTIALLY_RECEIVED', 'ใบสั่งซื้อ ' + no + ' รับสินค้าไปบางส่วนแล้ว ตั้งหนี้จากใบสั่งซื้อตรง ๆ ไม่ได้',
      'ตั้งหนี้จากใบรับสินค้าแต่ละใบ เมื่อได้ใบกำกับภาษีจากผู้ขาย');
  }
  const opts = input || {};
  const date = opts.date || TODAY;
  /* ใบสั่งขายออกใบกำกับเป็นงวด ๆ ได้ — แปลงทั้งใบคือออกส่วนที่ยังค้างทั้งหมดในใบเดียว */
  if (cfg.next === 'invoice') return invoiceSalesOrder(no, { date });
  let made;

  /* บรรทัดที่เก็บไว้เป็นจำนวนเงินสเกลแล้ว ต้องแปลงกลับเป็นข้อความก่อนส่งต่อ
     ไม่งั้นฟังก์ชันปลายทางจะคูณสเกลซ้ำ */
  const carry = d.lines.map((l) => ({ ...l, price: unM(l.price) }));
  /* ราคา ส่วนลด หัวเอกสาร และข้อมูลลูกค้าที่แก้ไว้ ตามไปเอกสารปลายทางทั้งหมด ไม่ต้องกรอกซ้ำ */
  const head = carryHeader(d, opts);

  if (kind === 'quotation' && opts.to === 'invoice') {
    /* งานเล็กที่ไม่ต้องมีใบสั่งขาย — ลูกค้าตอบรับแล้วออกใบกำกับได้เลย */
    made = issueInvoice({ ...head, partnerCode: d.partnerCode, date, lines: carry, fromDoc: d.no, whtCode: d.whtCode || null });
  } else if (cfg.next === 'salesOrder') {
    made = issueTradeDoc('salesOrder', {
      ...head, partnerCode: d.partnerCode, date, lines: carry, fromDoc: d.no, whtCode: d.whtCode || null,
    });
  } else {
    if (!opts.vendorNo) {
      throw new DomainError('VENDOR_INVOICE_NO_REQUIRED',
        'ต้องกรอกเลขที่ใบกำกับภาษีของผู้ขายก่อนตั้งหนี้',
        'ดูเลขที่จากใบกำกับที่ผู้ขายส่งมา');
    }
    /* บัญชีของแต่ละบรรทัดตามที่เลือกไว้ในใบสั่งซื้อ (หรือที่แก้ตอนแปลง opts.lineAccs) — เดิมทุกบรรทัดลงบัญชีเดียวกัน
       ค่าซ่อมกับค่าวัสดุในใบเดียวกันจึงปนกัน · opts.acc ใช้กับบรรทัดที่ไม่ได้เลือกบัญชีไว้ · สินค้าคงคลังเข้าบัญชีสินค้าเสมอ */
    const pick = Array.isArray(opts.lineAccs) ? opts.lineAccs : [];
    made = recordBill({
      ...head, partnerCode: d.partnerCode, date, vendorNo: opts.vendorNo,
      lines: carry.map(function (l, i) {
        const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
        const stock = it && it.type === 'stock';
        return { ...l, acc: stock ? accBySub('inventory') : (pick[i] || l.acc || opts.acc || null),
          expenseSub: l.expenseSub || opts.expenseSub || 'admin_expense' };
      }),
      /* ภาษีหัก ณ ที่จ่ายตามที่เลือกตอนแปลง ไม่เลือก = ตามใบสั่งซื้อ ใบสั่งซื้อไม่ได้ระบุ = ตามประเภทของผู้ขาย */
      nonClaimableVat: !!opts.nonClaimableVat,
      whtCode: opts.whtCode !== undefined ? (opts.whtCode || 'none') : (d.whtCode !== undefined ? (d.whtCode || 'none') : undefined),
    });
  }
  d.status = 'closed';
  d.convertedTo = made.no;
  audit(kind, no, 'convert', null, { to: made.no });
  return made;
}

/** หัวเอกสารที่ส่งต่อตอนแปลงเอกสาร — วันครบกำหนดนับใหม่จากวันที่ของเอกสารปลายทาง
    ส่วนลดท้ายบิลแบบบาทของงานที่ออกไม่ครบ (บางบรรทัด/บางจำนวน) แปลงเป็นเปอร์เซ็นต์ของยอดหลังส่วนลดรายการของต้นทาง
    ใบที่ทยอยออกจะได้ส่วนลดตามสัดส่วน ไม่ใช่ได้ส่วนลดเต็มก้อนซ้ำทุกใบ */
function carryHeader(d, opts, partRows) {
  const o = opts || {};
  let pricing = d.pricing || null;
  if (partRows && pricing && pricing.bill && pricing.bill.kind === 'amount' && d.totals) {
    const afterLine = d.totals.subTotal - d.totals.lineDiscount;
    const pctStr = afterLine > 0 ? unM(mulDiv(M(pricing.bill.value), 100 * S, afterLine)) : '0';
    pricing = { ...pricing, bill: { kind: 'percent', value: pctStr } };
  }
  return {
    pricing,
    contact: d.snap && d.snap.edited ? { name: d.snap.name, address: d.snap.address, taxId: d.snap.taxId, branch: d.snap.branch,
      contactPerson: d.snap.contactPerson, phone: d.snap.phone, email: d.snap.email } : undefined,
    creditType: o.creditType || d.creditType, creditDays: o.creditDays !== undefined ? o.creditDays : d.creditDays,
    project: d.project, salesName: d.salesName, reference: o.reference !== undefined ? o.reference : (d.reference || d.no),
    note: d.note, internalNote: d.internalNote,
  };
}

/* ===================================================================
   ใบสั่งขาย → ใบกำกับภาษีทีละงวด
   ส่งของไม่ครบหรือเก็บเงินตามความคืบหน้าของงาน ออกใบกำกับเฉพาะส่วนที่ส่งมอบแล้ว
   ใบสั่งขายยังเปิดอยู่จนกว่าจะออกครบทุกบรรทัด — ทำแบบเดียวกับการทยอยรับของตามใบสั่งซื้อ
   =================================================================== */
/** จำนวนที่ออกใบกำกับแล้วของแต่ละบรรทัด — นับจากใบกำกับที่ยังไม่ยกเลิก ไม่เก็บซ้ำไว้ในใบสั่งขาย */
function soInvoiced(so) {
  const got = so.lines.map(() => 0);
  DB.docs.invoice.forEach(function (inv) {
    if (inv.soNo !== so.no || inv.status === 'void') return;
    inv.lines.forEach(function (l) {
      if (l.soLine !== undefined && l.soLine !== null && l.soLine < got.length) got[l.soLine] = roundQty(got[l.soLine] + l.qty);
    });
  });
  return got;
}
/** สถานะใบสั่งขายคิดจากใบกำกับจริง: ยังไม่ออก / ออกบางส่วน / ออกครบ (ปิด) */
function syncSoStatus(so) {
  const got = soInvoiced(so);
  const invs = DB.docs.invoice.filter((i) => i.soNo === so.no && i.status !== 'void').map((i) => i.no).reverse();
  so.invoiceNos = invs;
  if (so.status === 'cancelled') return so;                 // ยกเลิกส่วนที่เหลือไปแล้ว คงสถานะไว้
  const all = so.lines.every((l, i) => got[i] >= roundQty(l.qty));
  if (invs.length && all) { so.status = 'closed'; so.convertedTo = invs.join(', '); }
  else if (invs.length) { so.status = 'partially_invoiced'; so.convertedTo = null; }
  else if (so.status === 'partially_invoiced' || so.status === 'closed') {
    so.status = so.statusBeforeInvoice || 'approved'; so.convertedTo = null;
  }
  return so;
}
/** ออกใบกำกับจากใบสั่งขาย — input.lines = [{ line: ลำดับบรรทัดในใบสั่งขาย, qty }] · ไม่ระบุ = ส่วนที่ค้างทั้งหมด
    จำนวนเป็นทศนิยมได้ (3 ตำแหน่ง) งานบริการเก็บเงินตามความคืบหน้าใส่ 0.3 = 30% ของบรรทัดนั้น */
function invoiceSalesOrder(soNo, input) {
  const so = tradeDocFind('salesOrder', soNo);
  if (so.status === 'closed') {
    throw new DomainError('TRADE_DOC_ALREADY_CONVERTED', 'ใบสั่งขาย ' + soNo + ' ออกใบกำกับครบแล้ว (' + so.convertedTo + ')');
  }
  if (so.status === 'cancelled' || so.status === 'rejected') {
    throw new DomainError('TRADE_DOC_NOT_ACTIVE', 'ใบสั่งขาย ' + soNo + ' อยู่ในสถานะ ' + so.status + ' ออกใบกำกับไม่ได้');
  }
  const opts = input || {};
  const got = soInvoiced(so);
  const want = Array.isArray(opts.lines)
    ? opts.lines.map((x) => ({ line: Number(x.line), qty: roundQty(x.qty || 0) }))
    : so.lines.map((l, i) => ({ line: i, qty: roundQty(roundQty(l.qty) - got[i]) }));
  const rows = [];
  want.forEach(function (w) {
    const l = so.lines[w.line];
    if (!l) throw new DomainError('SO_LINE_INVALID', 'ไม่พบบรรทัดที่ ' + (w.line + 1) + ' ในใบสั่งขาย ' + soNo);
    if (w.qty < 0) throw new DomainError('SO_QTY_INVALID', l.desc + ' จำนวนติดลบไม่ได้');
    if (!(w.qty > 0)) return;
    const left = roundQty(roundQty(l.qty) - got[w.line]);
    if (w.qty > left) {
      throw new DomainError('SO_OVER_INVOICE', l.desc + ' ออกใบกำกับ ' + w.qty + ' เกินที่สั่งและยังค้างอยู่ ' + left,
        'ถ้าลูกค้าสั่งเพิ่ม ให้ออกใบสั่งขายใบใหม่ หรือออกใบกำกับแยกต่างหาก');
    }
    /* ส่วนลดเป็นบาทของบรรทัดที่ออกไม่ครบ แบ่งตามจำนวนที่ออก — เปอร์เซ็นต์ใช้ได้ตรง ๆ */
    const part = so.pricing && so.pricing.lineDisc === 'amount' && l.disc && w.qty !== roundQty(l.qty)
      ? unM(round2(mulDiv(M(l.disc), Math.round(w.qty * 1000), Math.round(roundQty(l.qty) * 1000)))) : l.disc;
    rows.push({ ...l, price: unM(l.price), qty: w.qty, soLine: w.line, disc: part });
  });
  if (!rows.length) throw new DomainError('SO_QTY_INVALID', 'ต้องเลือกรายการที่จะออกใบกำกับอย่างน้อย 1 รายการ');
  if (so.status !== 'partially_invoiced') so.statusBeforeInvoice = so.status;
  const inv = issueInvoice({ ...carryHeader(so, opts, rows), partnerCode: so.partnerCode, date: opts.date || TODAY, lines: rows,
    soNo: so.no, fromDoc: so.no, whtCode: so.whtCode || null });
  syncSoStatus(so);
  audit('salesOrder', soNo, so.status === 'closed' ? 'convert' : 'partial_invoice', null, { to: inv.no });
  return inv;
}

/* ===================================================================
   ขายเงินสด — ใบกำกับภาษีอย่างย่อ (มาตรา 86/6)
   ขายปลีกหน้าร้านให้ลูกค้าทั่วไป ไม่ต้องมีชื่อ ที่อยู่ หรือเลขผู้เสียภาษีของผู้ซื้อ
   เงินเข้าทันทีจึงลงบัญชีครั้งเดียว: Dr เงินสด/ธนาคาร · Cr รายได้ · Cr ภาษีขาย — ไม่ผ่านลูกหนี้
   ตัดสต๊อกและต้นทุนขายเหมือนใบกำกับ และเข้ารายงานภาษีขายเป็นใบกำกับอย่างย่อ
   ผู้ซื้อที่จะนำภาษีซื้อไปใช้ต้องได้ใบกำกับเต็มรูป ใบอย่างย่อใช้ขอคืนภาษีซื้อไม่ได้
   =================================================================== */
/** ยอดของบิลขายเงินสด — ร้านค้าปลีกติดราคารวมภาษีเป็นปกติ (inclusive) จึงถอดภาษีออกจากยอดรวมครั้งเดียวทั้งบิล
    แล้วแบ่งมูลค่าก่อนภาษีกลับไปแต่ละบรรทัดตามสัดส่วน บรรทัดสุดท้ายรับเศษ ผลรวมบรรทัดจึงเท่ายอดก่อนภาษีพอดี */
function cashSaleAmounts(lines, date, inclusive, pricing) {
  const P = priceLines(lines, date, Object.assign({}, pricing || {}, { mode: inclusive ? 'inclusive' : 'exclusive' }));
  return Object.assign({ base: P.rows.map((r) => r.net), gross: P.rows.map((r) => r.gross), P }, P.v);
}

function issueCashSale(input) {
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ขาย');
  const lines = (input.lines || []).filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการอย่างน้อย 1 บรรทัด');
  lines.forEach(function (l, i) {
    if (!(Number(l.qty) > 0)) throw new DomainError('CASH_SALE_QTY_INVALID', 'บรรทัดที่ ' + (i + 1) + ' จำนวนต้องมากกว่าศูนย์');
  });
  /* ลูกค้าในทะเบียนไม่บังคับ — ใส่ไว้เพื่อดูยอดซื้อของลูกค้าประจำได้ แต่ไม่ต้องมีเลขผู้เสียภาษี */
  const p = input.partnerCode ? partnerByCode(input.partnerCode) : null;
  if (p && !isCustomer(p)) {
    throw new DomainError('PARTNER_WRONG_SIDE', 'ขายเงินสดต้องระบุลูกค้า แต่ ' + p.name + ' อยู่ในทะเบียนผู้ขาย');
  }
  /* ข้อมูลผู้ซื้อที่แก้บนเอกสาร (เช่น แปลงมาจากใบเสนอราคาที่ออกให้สาขาอื่น) — พิมพ์บนใบได้ ทะเบียนไม่เปลี่ยน */
  const snap = p ? applyContactEdits(snapshotPartner(p), input.contact) : null;
  const buyerName = String(input.buyerName || (snap ? snap.name : '') || '').trim();
  const payTo = input.payTo || accBySub('cash');
  const pa = acc(payTo);
  if (!pa.postable || (pa.subType !== 'cash' && pa.subType !== 'bank')) {
    throw new DomainError('CASH_SALE_PAYTO_INVALID', 'เงินที่รับต้องเข้าบัญชีเงินสดหรือเงินฝากธนาคาร',
      'เลือกบัญชีเงินสดหรือบัญชีธนาคารที่รับเงินจริง');
  }
  const inclusive = input.vatInclusive !== false;
  const a = cashSaleAmounts(lines, input.date, inclusive, input.pricing);
  const head = docHeader(Object.assign({}, input, { creditType: 'cash' }), p, input.date);
  const lineAcc = lines.map((l, i) => revenueLineAccount(l, i));
  assertStockAvailable(lines);
  assertPostingOpen(input.date);
  const no = nextNo('cashSale', input.date);

  const revLines = {};
  lines.forEach(function (l, i) { revLines[lineAcc[i]] = (revLines[lineAcc[i]] || 0) + a.base[i]; });
  const je = post({
    type: 'receipt', date: input.date,
    desc: 'ขายเงินสด ' + no + (buyerName ? ' — ' + buyerName : ''),
    src: 'cashSale', srcId: no,
    lines: [{ acc: payTo, dr: a.total }]
      .concat(Object.keys(revLines).map((x) => ({ acc: x, cr: revLines[x] })))
      .concat(a.vat ? [{ acc: accBySub('output_vat'), cr: a.vat }] : []),
  });

  /* ตัดต้นทุนขายแบบเดียวกับใบกำกับ — ชิ้นสุดท้ายรับมูลค่าที่เหลือทั้งหมด */
  let cogs = 0;
  lines.forEach(function (l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    if (!it || it.type !== 'stock') return;
    const q = roundQty(l.qty);
    const c = q === it.qty ? it.value : round2(mulQty(it.avgCost, q));
    cogs += c;
    it.qty = roundQty(it.qty - q);
    it.value -= c;
    DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'out', qty: q, cost: c, src: no, balance: it.qty });
  });
  const cogsJe = cogs > 0 ? post({
    type: 'inventory', date: input.date, desc: 'ตัดต้นทุนขาย ' + no,
    src: 'cashSale', srcId: no,
    lines: [{ acc: accBySub('cogs'), dr: cogs }, { acc: accBySub('inventory'), cr: cogs }],
  }) : null;

  /* รายงานภาษีขายแสดงใบอย่างย่อแยกจากใบเต็มรูป ไม่มีเลขผู้เสียภาษีของผู้ซื้อ */
  DB.taxTx.push({
    kind: 'vat_output', period: periodOf(input.date), date: input.date,
    docNo: no, docType: 'abbreviated',
    partnerName: buyerName || 'ขายปลีก (ใบกำกับภาษีอย่างย่อ)', taxId: null, branch: null,
    base: a.std, zero: a.zero, exempt: a.exempt, tax: a.vat,
    entryNo: je.no, filingId: null,
  });

  const doc = {
    no, date: input.date, partnerCode: p ? p.code : null, partnerName: buyerName || 'ลูกค้าทั่วไป',
    buyerName: buyerName || null, vatInclusive: inclusive,
    lines: lines.map((l, i) => ({
      desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
      taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null, acc: lineAcc[i],
      disc: lineDiscText(l.disc), amount: a.base[i], gross: a.gross[i],
    })),
    base: a.std + a.zero + a.exempt, vat: a.vat, total: a.total,
    pricing: a.P.pricing, totals: a.P.totals, ...head,
    payTo, method: input.method || (pa.subType === 'cash' ? 'cash' : 'transfer'),
    status: 'paid', entryNo: je.no, cogsEntryNo: cogsJe ? cogsJe.no : null,
    snap, fromDoc: input.fromDoc || null, fromKind: input.fromDoc ? (input.fromKind || 'quotation') : null,
  };
  DB.docs.cashSale.unshift(doc);
  audit('cashSale', no, 'issue', null, { total: fmt(a.total), buyer: buyerName || 'ลูกค้าทั่วไป' });
  return doc;
}

/* ---------- ซื้อ: ตั้งหนี้ผู้ขาย ---------- */
function recordBill(input) {
  const p = partnerByCode(input.partnerCode);
  /* เลขใบกำกับเดียวกันห้ามซ้ำทั้งในตั้งหนี้ ค่าใช้จ่าย และเงินมัดจำจ่าย — ใบกำกับหลายบรรทัดบันทึกเป็นรายการเดียวหลายบรรทัด */
  assertVendorInvoiceUnused(p.code, input.vendorNo);
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

  const P = priceLines(lines, input.date, input.pricing);
  const v = P.v;
  const head = docHeader(input, p, input.date);
  /* หักเงินมัดจำที่จ่ายไปแล้วและได้ใบกำกับภาษีตอนจ่าย (settle.js) — ภาษีซื้อเหลือเฉพาะส่วนที่ยังไม่ได้ขอคืน */
  const dep = (input.deposits || []).length ? depositDeduction('ap', p.code, input.deposits, v, input.date) : { lines: [], fields: {} };
  /* ไม่ได้ระบุประเภทเงินได้ = ใช้ที่ตั้งไว้ในทะเบียนผู้ขาย — ยกเว้นซื้อสินค้าเข้าคลังล้วน (ซื้อสินค้าไม่ต้องหัก ณ ที่จ่าย)
     ระบุ null หรือ "none" = ไม่หัก */
  const goodsOnly = !!grn || lines.every(function (l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    return it && it.type === 'stock';
  });
  const whtCode = input.whtCode === undefined ? (goodsOnly ? null : p.whtCode || null)
    : (input.whtCode && input.whtCode !== 'none' ? input.whtCode : null);
  const no = nextNo('bill', input.date);
  const claimable = !input.nonClaimableVat;

  const expLines = {};
  const lineAcc = lines.map((l, i) => grn ? accBySub('grni') : billLineAccount(l, i));
  lines.forEach(function (l, i) {
    const a = lineAcc[i];
    expLines[a] = (expLines[a] || 0) + P.rows[i].net;
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
      .concat(dep.lines)
      .concat([{ acc: accBySub('trade_payable'), cr: v.total, partner: p.code }]),
  });

  lines.forEach(function (l, i) {
    if (!l.itemCode || grn) return;
    const it = DB.items.find((x) => x.code === l.itemCode);
    if (!it || it.type !== 'stock') return;
    /* ต้นทุนสินค้าคือมูลค่าหลังหักส่วนลดและก่อนภาษี */
    const c = P.rows[i].net;
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
    no, date: input.date, ...head,
    vendorNo: input.vendorNo, partnerCode: p.code, partnerName: p.name,
    lines: lines.map((l, i) => ({ desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
      disc: lineDiscText(l.disc), gross: P.rows[i].gross,
      amount: P.rows[i].net, itemCode: l.itemCode || null, acc: lineAcc[i],
      taxCode: l.taxCode || 'VAT7' })),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    pricing: P.pricing, totals: P.totals,
    claimable, paid: 0, status: 'issued', entryNo: je.no,
    whtCode, grnNo: grn ? grn.no : null,
    ...dep.fields,
  };
  DB.docs.bill.unshift(doc);
  if (grn) { grn.status = 'closed'; grn.billNo = no; grn.billDate = input.date; }
  audit('bill', no, 'create', null, { vendor: p.name, total: fmt(v.total) });
  return doc;
}

/* ---------- ซื้อ: จ่ายชำระพร้อมหักภาษี ณ ที่จ่าย ---------- */
/** ส่วนที่จ่ายขาดแล้วผู้ขายยอมปิดยอด — ส่วนลดรับหรือรายได้อื่น */
const PAYMENT_DIFF = {
  discount:     { label:'ส่วนลดรับ', acc: () => ensureAccount('purchase_return', '5112', 'ส่งคืนสินค้าและส่วนลดรับ', 'expense') },
  other_income: { label:'รายได้อื่น', acc: () => ensureAccount('other_income', '4260', 'รายได้เบ็ดเตล็ด', 'revenue') },
};
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
  if (gross <= 0) throw new DomainError('PAYMENT_ZERO', 'ยอดจ่ายต้องมากกว่าศูนย์');
  if (gross > outstanding) {
    throw new DomainError('OVER_PAYMENT', 'ยอดจ่าย ' + fmt(gross) + ' เกินยอดคงค้าง ' + fmt(outstanding));
  }
  const diffType = input.diffType || null;
  if (diffType && !PAYMENT_DIFF[diffType]) throw new DomainError('PAYMENT_DIFF_INVALID', 'ไม่รู้จักวิธีปิดส่วนต่าง ' + diffType);
  /* จ่ายขาดแล้วผู้ขายยอมปิดยอด — ส่วนที่ขาดเป็นส่วนลดรับหรือรายได้อื่น เจ้าหนี้ใบนี้ปิดครบ */
  let diff = 0, diffAcc = null;
  if (diffType && gross < outstanding) { diff = outstanding - gross; diffAcc = PAYMENT_DIFF[diffType].acc(); }
  /* ค่าธรรมเนียมโอนที่บริษัทจ่ายเพิ่มเอง (ไม่ได้หักจากผู้ขาย) — เงินออกจากบัญชีมากกว่ายอดที่ผู้ขายได้ */
  const fee = input.fee ? M(input.fee) : 0;
  if (fee < 0) throw new DomainError('PAYMENT_FEE_NEGATIVE', 'ค่าธรรมเนียมติดลบไม่ได้');
  const channel = input.channel === 'e_wht' ? 'e_wht' : 'manual';
  /* "none" = ผู้ใช้เลือกไม่หักเองในฟอร์ม ต้องไม่ย้อนไปใช้ประเภทที่ตั้งไว้ตอนตั้งหนี้ */
  const whtCode = input.whtCode === 'none' ? null : (input.whtCode || bill.whtCode || null);
  const given = input.whtBase !== undefined && input.whtBase !== null && String(input.whtBase).trim() !== '';
  let w = billWhtFor(bill, gross + diff, input.date, channel, whtCode, given ? input.whtBase : undefined);
  /* ได้ส่วนลดตอนจ่าย เงินได้ของผู้ขายลดลงตาม — หักภาษีจากส่วนที่จ่ายจริง */
  if (diff && !given && w.wht) {
    w = billWhtFor(bill, gross + diff, input.date, channel, whtCode, unM(round2(mulDiv(w.share, gross, gross + diff))));
  }
  if (given && (w.base <= 0 || w.base > gross + diff)) {
    throw new DomainError('WHT_BASE_INVALID', 'ฐานภาษีหัก ณ ที่จ่าย ' + fmt(w.base) + ' ต้องไม่ติดลบและไม่เกินยอดจ่าย ' + fmt(gross + diff),
      'ฐานคือค่าบริการก่อนภาษีมูลค่าเพิ่ม ไม่รวมค่าสินค้าหรือเงินที่จ่ายแทน');
  }
  const wht = w.wht, whtRate = w.rate, baseForWht = w.base;
  const net = gross - wht;
  const bank = cashAccount(input.bankAccount, 'บัญชีที่จ่ายเงิน');
  assertPostingOpen(input.date);
  const no = nextNo('payment', input.date);
  const whtAccount = p.entityType === 'individual' ? 'wht_payable_pnd3' : 'wht_payable_pnd53';

  /* e-Withholding Tax: ธนาคารตัดเงินเต็มจำนวน โอนสุทธิให้ผู้รับ และนำส่งภาษีให้กรมสรรพากรเอง
     ภาษีจึงออกจากบัญชีธนาคารพร้อมกัน ไม่ค้างเป็นภาษีหัก ณ ที่จ่ายค้างนำส่ง (แบบ ภ.ง.ด. ก็ไม่ต้องยื่น) */
  const je = post({
    type: 'payment', date: input.date,
    desc: 'จ่ายชำระ ' + p.name + ' (' + bill.no + ')',
    src: 'payment', srcId: no,
    lines: [{ acc: accBySub('trade_payable'), dr: gross + diff, partner: p.code }]
      .concat(fee ? [{ acc: ensureAccount('finance_cost', '5410', 'ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', 'expense'), dr: fee, memo: 'ค่าธรรมเนียมโอนเงิน' }] : [])
      .concat(wht && channel === 'manual' ? [{ acc: accBySub(whtAccount), cr: wht }] : [])
      .concat([{ acc: bank, cr: net, memo: wht ? 'จ่ายผู้รับเงินสุทธิ' : null }])
      .concat(wht && channel === 'e_wht' ? [{ acc: bank, cr: wht, memo: 'ภาษีหัก ณ ที่จ่ายที่ธนาคารนำส่งผ่าน e-Withholding Tax' }] : [])
      .concat(fee ? [{ acc: bank, cr: fee, memo: 'ค่าธรรมเนียมโอนเงิน' }] : [])
      .concat(diff ? [{ acc: diffAcc, cr: diff, memo: PAYMENT_DIFF[diffType].label + ' ปิดยอด ' + bill.no }] : []),
  });

  bill.paid += gross;
  if (diff) bill.settled = (bill.settled || 0) + diff;
  syncBillStatus(bill);

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
    method: input.method || 'transfer', bankAccount: bank, whtCode: wht ? whtCode : null,
    diff, diffType: diff ? diffType : null, diffAcc, fee };
  DB.docs.payment.unshift(doc);
  audit('payment', no, 'create', null, { bill: bill.no, net: fmt(net), channel });
  return doc;
}

/* ---------- ค่าเสื่อมราคาประจำงวด ---------- */
/** ทรัพย์สินในทะเบียนที่ต้องคิดค่าเสื่อมในงวดนี้ (ยังใช้งาน เริ่มใช้แล้ว ยังตัดไม่หมด ไม่ใช่ที่ดิน
    และยังมีเดือนที่ไม่ได้คิดจนถึงงวดนี้ — ตัวที่คิดถึงงวดนี้แล้วไม่นับ) */
function depreciableAssets(period) {
  const due = new Set(depreciationPlan(period).map((r) => r.code));
  return DB.assets.filter((a) => due.has(a.code));
}
function runDepreciation(period) {
  const already = DB.docs.depreciation.find((d) => d.period === period && d.status !== 'void');
  if (already) {
    throw new DomainError('DEPRECIATION_ALREADY_RUN',
      'ตั้งค่าเสื่อมราคางวด ' + thPeriod(period) + ' ไปแล้ว (' + already.entryNo + ')',
      'ยกเลิกงวดเดิมที่หน้าค่าเสื่อมราคาก่อน ถ้าต้องการคำนวณใหม่');
  }
  const endDate = endOfMonth(period + '-01');
  /* ★ คิดทุกเดือนที่ยังไม่ได้คิด ตั้งแต่เดือนที่เริ่มใช้ (หรือเดือนถัดจากที่คิดล่าสุด) ถึงงวดนี้ รวมในใบเดียว
     เดิมคิดทีละหนึ่งเดือนเสมอ ทรัพย์สินที่ลงทะเบียนช้าหรืองวดที่ข้ามไปจึงขาดค่าเสื่อมถาวร (ดู depreciationPlan ใน assets.js) */
  const rows = depreciationPlan(period, true);
  const bookTotal = rows.reduce((s, r) => s + r.book, 0);
  const taxTotal = rows.reduce((s, r) => s + r.tax, 0);

  if (bookTotal === 0) {
    throw new DomainError('NO_DEPRECIABLE_ASSETS', 'ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อมในงวดนี้');
  }
  const je = post({
    type: 'asset', date: endDate,
    desc: 'ค่าเสื่อมราคาประจำงวด ' + thPeriod(period) + (rows.some((r) => r.months > 1) ? ' (รวมเดือนที่ยังไม่ได้คิด)' : ''),
    src: 'depreciation', srcId: period,
    lines: depreciationLines(rows),
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

/* เงินเดือน ภาษีเงินได้ และทะเบียนพนักงาน อยู่ใน payroll.js */

/* ---------- ปิดภาษีมูลค่าเพิ่มรายเดือน (ภ.พ.30) ---------- */
/* ภาษีที่ชำระเกินยกมา = ยอดยกไปของ ภ.พ.30 ฉบับล่าสุดก่อนงวดนี้ (ฉบับที่ขอคืนเป็นเงินสด ไม่มียอดยกไป) */
function vatCarryInOf(period) {
  const prev = DB.docs.filing.filter((f) => f.form === 'PP30' && f.period < period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))[0];
  return prev ? (prev.carryOut || 0) : 0;
}

/* ตัวเลขทุกบรรทัดของแบบ ภ.พ.30 — ใช้ทั้งตอนยื่นจริงและหน้าตัวอย่างก่อนยื่น ตัวเลขจึงตรงกันเสมอ */
function vatReturnOf(period) {
  /* แถวของเอกสารที่ยกเลิกแล้วยอดเป็นศูนย์ ไม่นับเข้าแบบ แต่ยังโชว์ในรายงานภาษีว่า "ยกเลิก" */
  const out = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === period && !t.void);
  const inn = DB.taxTx.filter((t) => t.kind === 'vat_input' && t.period === period && !t.void);
  const sum = (rows, k) => rows.reduce((s, t) => s + (t[k] || 0), 0);
  const outBase = sum(out, 'base'), outZero = sum(out, 'zero'), outExempt = sum(out, 'exempt');
  const outTax = sum(out, 'tax'), inTax = sum(inn, 'tax');
  const diff = outTax - inTax;                 // บรรทัด 8 (บวก) หรือ 9 (ลบ)
  const carryIn = vatCarryInOf(period);        // บรรทัด 10
  const net = diff - carryIn;                  // บวก = บรรทัด 11 ต้องชำระ · ลบ = บรรทัด 12 ชำระเกินสุทธิ
  return { out, inn, outBase, outZero, outExempt, outTax, inBase: sum(inn, 'base'), inTax,
    diff, carryIn, net, payable: net, overpaid: net < 0 ? -net : 0 };
}

function fileVat(period, opts) {
  opts = opts || {};
  const existing = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === period);
  if (existing) {
    throw new DomainError('ALREADY_FILED',
      'ยื่น ภ.พ.30 งวด ' + thPeriod(period) + ' ไปแล้วเมื่อ ' + thDate(existing.filedDate));
  }
  /* ยื่นเรียงเดือน — ภาษีชำระเกินยกมาของเดือนนี้มาจากแบบเดือนก่อน ข้ามเดือนไปแล้วยอดยกมาผิดทั้งสาย */
  const missing = DB.taxTx.filter((t) => (t.kind === 'vat_output' || t.kind === 'vat_input') && !t.void
    && t.period < period && !t.filingId && (t.tax || t.base || t.zero || t.exempt)
    && !DB.docs.filing.some((f) => f.form === 'PP30' && f.period === t.period))
    .map((t) => t.period).sort()[0];
  if (missing) {
    throw new DomainError('VAT_FILE_ORDER', 'ต้องยื่น ภ.พ.30 งวด ' + thPeriod(missing) + ' ก่อน แล้วค่อยยื่นงวด ' + thPeriod(period),
      'ภาษีที่ชำระเกินยกมาของเดือนถัดไปมาจากแบบของเดือนก่อน');
  }
  const r = vatReturnOf(period);
  const refund = opts.refund && r.overpaid > 0 ? r.overpaid : 0;
  const carryOut = r.overpaid - refund;
  const endDate = endOfMonth(period + '-01');

  /* ล้างบัญชีภาษีขายและภาษีซื้อของงวดให้เป็นศูนย์ทุกครั้งที่มียอด แม้ผลสุทธิเป็นศูนย์
     (ภาษีขาย 70 ภาษีซื้อ 70 ต้องล้างทั้งคู่ ไม่ใช่ค้างอยู่ในงบ) และรองรับยอดติดลบ
     (เดือนที่มีแต่ใบลดหนี้ ภาษีขายติดลบ ต้องกลับไปอยู่ฝั่งเครดิต)
     ภาษีชำระเกินยกมาที่ใช้หักในเดือนนี้ ล้างออกจากบัญชีภาษีขอคืน (เครดิต) ส่วนที่ชำระเกินเพิ่มตั้งเป็นภาษีขอคืน (เดบิต)
     ขอคืนเป็นเงินสด: ยอดยังค้างในบัญชีภาษีขอคืนจนกว่าจะได้รับเงินคืน แต่ไม่ยกไปหักเดือนถัดไป */
  const signed = (acc, amt, memo) => amt > 0 ? { acc, dr: amt, memo } : { acc, cr: -amt, memo };
  const recvDelta = r.overpaid - r.carryIn;
  const vatLines = [
    signed(accBySub('output_vat'), r.outTax),
    signed(accBySub('input_vat'), -r.inTax),
    r.net > 0 ? { acc: accBySub('vat_payable'), cr: r.net } : null,
    signed(accBySub('vat_receivable'), recvDelta,
      refund ? 'ขอคืนเป็นเงินสด ' + fmt(refund) + ' บาท' : r.carryIn ? 'ภาษีชำระเกินยกมา ' + fmt(r.carryIn) + ' บาท' : null),
  ].filter((l) => l && ((l.dr || 0) !== 0 || (l.cr || 0) !== 0));
  const je = vatLines.length ? post({
    type: 'adjustment', date: endDate,
    desc: 'ปิดภาษีมูลค่าเพิ่มงวด ' + thPeriod(period),
    src: 'filing', srcId: 'PP30|' + period,
    lines: vatLines,
  }) : null;

  const filing = {
    form: 'PP30', period, filedDate: endDate,
    dueDate: addDays(endOfMonth(period + '-01'), 15),
    outBase: r.outBase, outZero: r.outZero, outExempt: r.outExempt,
    outTax: r.outTax, inBase: r.inBase, inTax: r.inTax,
    diff: r.diff, carryIn: r.carryIn, carryOut, refund,
    payable: r.net, entryNo: je ? je.no : null, count: r.out.length + r.inn.length,
  };
  DB.docs.filing.unshift(filing);
  r.out.concat(r.inn).forEach((t) => { t.filingId = 'PP30|' + period; });
  audit('filing', 'PP30|' + period, 'file', null, { payable: fmt(r.net), carryIn: fmt(r.carryIn),
    carryOut: fmt(carryOut), refund: fmt(refund) });
  return filing;
}

/* ---------- ยื่นภาษีหัก ณ ที่จ่าย ---------- */
const WHT_FORM_SUB = { PND1: 'wht_payable_pnd1', PND3: 'wht_payable_pnd3', PND53: 'wht_payable_pnd53' };
function whtRowsOf(period, form) {
  // ★ กันรายการที่ธนาคารนำส่งแทน (e-WHT) ออก ไม่งั้นนำส่งซ้ำ
  return DB.taxTx.filter((t) => t.kind === 'wht' && t.period === period
    && t.form === form && t.channel === 'manual' && !t.void);
}

/* opts.date วันที่จ่ายจริง (ค่าเริ่มต้นวันที่ 7 ของเดือนถัดไป) · opts.account บัญชีเงินสด/ธนาคารที่จ่าย
   opts.nil ยื่นแบบไม่มีรายการ (ภ.ง.ด.1 ต้องยื่นทุกเดือนที่มีลูกจ้าง แม้ไม่มีภาษีหัก) — ไม่มีใบสำคัญ */
function fileWht(period, form, opts) {
  opts = opts || {};
  if (!WHT_FORM_SUB[form]) throw new DomainError('WHT_FORM_UNKNOWN', 'ไม่รู้จักแบบ ' + form);
  const key = form + '|' + period;
  if (DB.docs.filing.find((f) => f.form === form && f.period === period)) {
    throw new DomainError('ALREADY_FILED', 'ยื่น ' + TAX_FORM_TH[form] + ' งวด ' + thPeriod(period) + ' ไปแล้ว');
  }
  const rows = whtRowsOf(period, form);
  if (!rows.length && !opts.nil) {
    throw new DomainError('NOTHING_TO_FILE',
      'ไม่มีรายการที่ต้องยื่นใน ' + TAX_FORM_TH[form] + ' งวด ' + thPeriod(period),
      'รายการที่นำส่งผ่าน e-Withholding Tax ธนาคารนำส่งให้แล้ว ไม่ต้องยื่นซ้ำ');
  }
  const total = rows.reduce((s, t) => s + t.tax, 0);
  const endDate = endOfMonth(period + '-01');
  const remitDate = opts.date || addDays(endDate, 7);
  if (remitDate <= endDate) {
    throw new DomainError('WHT_REMIT_DATE', 'วันที่นำส่งต้องอยู่หลังสิ้นงวด ' + thPeriod(period),
      'ภาษีหัก ณ ที่จ่ายนำส่งในเดือนถัดไป');
  }
  const payAcc = opts.account || accBySub('bank');
  if (total) {
    const pa = DB.accounts.find((a) => a.code === payAcc);
    if (!pa || !pa.postable || (pa.subType !== 'cash' && pa.subType !== 'bank')) {
      throw new DomainError('PAY_ACCOUNT_INVALID', 'บัญชีที่จ่ายต้องเป็นบัญชีเงินสดหรือเงินฝากธนาคาร');
    }
    /* นำส่งภาษีเดือนสุดท้ายของปีเกิดในปีบัญชีถัดไป — ถ้ายังไม่มีงวดปีหน้า เปิดให้ก่อน */
    if (!DB.periods.some((x) => remitDate >= x.start && remitDate <= x.end)) {
      openNextFiscalYear('ต้องบันทึกการนำส่ง ' + TAX_FORM_TH[form] + ' งวด ' + thPeriod(period) + ' ในเดือนถัดไป');
    }
  }
  /* แบบที่ภาษีเป็นศูนย์ (ทุกแถวต่ำกว่าเกณฑ์ หรือยื่นไม่มีรายการ) ยื่นได้แต่ไม่มีเงินต้องจ่าย จึงไม่มีใบสำคัญ */
  const je = total ? post({
    type: 'payment', date: remitDate,
    desc: 'นำส่งภาษีหัก ณ ที่จ่าย ' + TAX_FORM_TH[form] + ' งวด ' + thPeriod(period),
    src: 'filing', srcId: key,
    lines: [{ acc: accBySub(WHT_FORM_SUB[form]), dr: total }, { acc: payAcc, cr: total }],
  }) : null;
  const filing = { form, period, filedDate: remitDate, dueDate: addDays(endDate, 7),
    count: rows.length, total, entryNo: je ? je.no : null, payAccount: total ? payAcc : null, nil: !rows.length,
    excluded: DB.taxTx.filter((t) => t.kind === 'wht' && t.period === period && t.form === form && t.channel === 'e_wht' && !t.void).length };
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
    detail: c.ok ? 'ตรงกัน' : 'ต่างกัน ' + fmt(c.control - c.sub) + ' บาท' + (c.why ? ' — ' + c.why : ''), blocking: true,
    action: c.ok ? undefined : c.code === 'AR_SUBLEDGER' || c.code === 'AP_SUBLEDGER' ? 'openitems'
      : c.code === 'INVENTORY_SUBLEDGER' ? 'stockadj' : undefined,
  }));
  /* ค่าเสื่อมบังคับเฉพาะงวดที่มีทรัพย์สินในทะเบียนต้องคิดจริง — บริษัทที่ไม่มีทรัพย์สินต้องปิดงวดได้
     ส่วนทรัพย์สินที่ยกยอดมาแต่ยังไม่ลงทะเบียน ระบบคิดค่าเสื่อมให้ไม่ได้ ให้บันทึกเองด้วยใบสำคัญทั่วไป */
  const dep = DB.docs.depreciation.find((d) => d.period === period && d.status !== 'void');
  const due = depreciableAssets(period).length;
  /* ค่าเสื่อมในใบยอดยกมาเป็นยอดสะสมตั้งแต่ต้นปี ไม่ใช่ค่าเสื่อมของงวดนี้ จึงไม่นับ */
  const depGl = balanceOf((a) => a.subType === 'depreciation' || a.subType === 'amortization', endDate, period + '-01',
    (e) => !isOpeningEntry(e));
  const ppeGl = balBySub(['ppe', 'intangible'], endDate);
  items.push({ label: 'ตั้งค่าเสื่อมราคาประจำงวด',
    ok: !!dep || !due,
    detail: dep ? fmt(dep.bookTotal) + ' บาท'
      : due ? 'ยังไม่ได้ทำ (' + due + ' รายการในทะเบียน)'
      : depGl ? 'บันทึกด้วยใบสำคัญแล้ว ' + fmt(depGl) + ' บาท'
      : ppeGl ? 'ไม่มีทรัพย์สินในทะเบียน แต่บัญชีมีทรัพย์สิน ' + fmt(ppeGl) + ' บาท — ลงทะเบียนทรัพย์สินหรือบันทึกค่าเสื่อมด้วยใบสำคัญ'
      : 'ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อม',
    blocking: true, action: 'depreciation' });
  const pay = DB.docs.payRun.find((r) => r.period === period && r.status !== 'void');
  items.push({ label: 'ทำเงินเดือนประจำงวด', ok: !!pay,
    detail: pay ? pay.count + ' คน ' + fmt(pay.net) + ' บาท' : 'ยังไม่ได้ทำ', blocking: false, action: 'payroll' });
  const vat = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === period);
  /* กิจการที่ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่มไม่ต้องยื่น ภ.พ.30 */
  if (DB.company.vatRegistered !== false || vat) {
    items.push({ label: 'ยื่นแบบ ภ.พ.30', ok: !!vat,
      detail: !vat ? 'ยังไม่ได้ยื่น'
        : vat.payable >= 0 ? 'ชำระ ' + fmt(vat.payable) + ' บาท'
        : vat.refund ? 'ขอคืนเป็นเงินสด ' + fmt(vat.refund) + ' บาท'
        : 'ชำระเกิน ยกไปเดือนถัดไป ' + fmt(-vat.payable) + ' บาท',
      blocking: true, action: 'vat' });
  }
  /* เดือนสุดท้ายของปีบัญชี: ต้องปิดบัญชีสิ้นปีก่อนปิดงวด ไม่งั้นปีถัดไปจะยกยอดรายได้/ค่าใช้จ่ายมาทั้งก้อน */
  const fy = fiscalYearOf(endDate);
  if (fy && fy.complete && fy.periods[11].code === period) {
    const left = yearEndOpen(fy);
    const ye = yearEndOf(fy);
    items.push({ label: 'ปิดบัญชีสิ้นปี — โอนกำไรขาดทุนทั้งปีเข้ากำไรสะสม', ok: left.length === 0,
      detail: left.length === 0 ? (ye ? 'ปิดแล้ว ' + ye.no : 'ไม่มีรายได้/ค่าใช้จ่ายต้องปิด')
        : (ye ? 'มีรายการลงเพิ่มหลังปิดบัญชี ' + left.length + ' บัญชี — กดปิดบัญชีสิ้นปีอีกครั้ง' : 'ยังไม่ได้ปิด ' + left.length + ' บัญชี'),
      blocking: true, action: 'yearend' });
  }
  items.push(bankCloseItem(period));

  return { period, items, canClose: items.filter((i) => i.blocking).every((i) => i.ok) };
}

function closePeriod(period) {
  /* ปิดงวดตามลำดับ — ปิดเดือนหลังทั้งที่เดือนก่อนยังเปิด ยอดยกมาของเดือนหลังเปลี่ยนได้ทั้งที่ปิดไปแล้ว */
  const earlier = DB.periods.filter((x) => x.start < period + '-01' && x.status !== 'closed')
    .sort((a, b) => (a.start < b.start ? -1 : 1));
  if (earlier.length) {
    throw new DomainError('CLOSE_OUT_OF_ORDER', 'ต้องปิดงวด ' + thPeriod(earlier[0].code) + ' ก่อน แล้วค่อยปิดงวด ' + thPeriod(period),
      'ปิดงวดเรียงตามลำดับเดือน');
  }
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
  /* ใบวางบิล/ใบแจ้งหนี้ที่มีรายการของตัวเอง (ออกก่อนใบกำกับ) — สถานะตามที่ทำจริง รอวางบิล → วางบิลแล้ว → เปิดบิลแล้ว */
  if (isItemBilling(bn)) return bn.status;
  const out = billingNoteOutstanding(bn);
  if (out <= 0) return 'paid';
  return out < bn.total ? 'partially_paid' : 'issued';
}

function issueBillingNote(input) {
  const p = partnerByCode(input.partnerCode);
  if (!isCustomer(p)) {
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
  /* นำใบกำกับไปวางบิลแปลว่าส่งให้ลูกค้าแล้ว — ใบที่ยังรอดำเนินการเลื่อนเป็นรอเก็บเงิน */
  nos.forEach((n) => markInvoiceDelivered(DB.docs.invoice.find((d) => d.no === n)));
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
  if (isItemBilling(bn)) return setBillingNoteStatus(no, 'cancelled', reason);
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
  if (isItemBilling(bn)) {
    throw new DomainError('BILLING_NOT_INVOICED', 'ใบวางบิล ' + no + ' ยังไม่ได้ออกใบกำกับภาษี รับชำระอ้างใบนี้ตรง ๆ ไม่ได้',
      'กดออกใบกำกับภาษีจากใบวางบิลนี้ แล้วเลือก "รับชำระเงินแล้ว" ระบบจะออกใบเสร็จให้พร้อมกัน');
  }
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
   เอกสารขายแบบที่นักบัญชีคุ้นมือ — ใบเสนอราคา → ใบวางบิล/ใบแจ้งหนี้ → ใบกำกับภาษี → ใบเสร็จรับเงิน
   - ใบวางบิล/ใบแจ้งหนี้ (mode 'items') ออกก่อนใบกำกับ มีรายการสินค้าของตัวเอง ไม่ลงบัญชี
     รอวางบิล → วางบิลแล้ว → เปิดบิลแล้ว (ออกใบกำกับหรือขายเงินสดจากใบนี้) / ยกเลิก
     ใบวางบิลรวมใบกำกับที่ออกแล้ว (แบบเดิม ไม่มี mode) ยังใช้ได้เหมือนเดิม
   - ใบกำกับเริ่มที่รอดำเนินการ (ยังไม่ส่งลูกค้า) แก้ไขได้ → ส่งแล้วเป็นรอเก็บเงิน · รีเซ็ตกลับได้ถ้ายังไม่มีเอกสารปลายทาง
   - แปลงเอกสารส่งต่อทุกอย่าง (ลูกค้า รายการ ราคารวม/ไม่รวมภาษี ส่วนลด โปรเจกต์ เลขอ้างอิง) และเก็บลิงก์สองทาง
   =================================================================== */
const isItemBilling = (bn) => !!bn && bn.mode === 'items';
/** ใบกำกับที่ยังรอดำเนินการ เลื่อนเป็นส่งให้ลูกค้าแล้ว — รับเงิน วางบิล ลดหนี้/เพิ่มหนี้ ล้วนแปลว่าเอกสารออกไปแล้ว */
function markInvoiceDelivered(inv) {
  if (inv && inv.delivered === false) { inv.delivered = true; inv.deliveredAt = new Date().toISOString(); }
}
/** ใบวางบิลที่แปลงเป็นเอกสาร no ไว้ — เอกสารปลายทางถูกยกเลิก ใบวางบิลกลับไปสถานะก่อนเปิดบิล */
function reopenItemBilling(convertedTo) {
  DB.docs.billingNote.forEach(function (b) {
    if (!isItemBilling(b) || b.status !== 'closed' || b.convertedTo !== convertedTo) return;
    b.status = b.statusBeforeClose || 'delivered';
    b.convertedTo = null; b.convertedKind = null;
    audit('billingNote', b.no, 'reopen', { status: 'closed' }, { status: b.status }, 'ยกเลิก ' + convertedTo);
  });
}
/** ข้อมูลเอกสารปลายทางจากเอกสารต้นทาง — ไม่ส่งรายการมา = ใช้ทุกอย่างตามต้นทาง (ราคา ส่วนลด หัวเอกสาร ข้อมูลลูกค้าที่แก้ไว้)
    ส่งรายการมา (จากฟอร์มที่เติมไว้ให้แล้ว) = ใช้ตามที่ผู้ใช้แก้ก่อนบันทึก */
function salesCarry(src, input) {
  const o = input || {};
  if (Array.isArray(o.lines)) return Object.assign({}, o, { partnerCode: o.partnerCode || src.partnerCode, date: o.date || TODAY });
  return Object.assign(carryHeader(src, o), {
    partnerCode: src.partnerCode, date: o.date || TODAY,
    lines: src.lines.map((l) => ({ ...l, price: unM(l.price) })),
    whtCode: o.whtCode !== undefined ? o.whtCode : (src.whtCode || null),
  });
}
/** ขายเงินสดจากเอกสารต้นทาง — ผู้ซื้อตามต้นทาง (ชื่อ ที่อยู่ที่แก้ไว้) ราคารวม/ไม่รวมภาษีตามต้นทาง */
function cashSaleFrom(src, kind, input) {
  const o = input || {};
  const d = salesCarry(src, o);
  const pc = o.partnerCode !== undefined ? o.partnerCode : src.partnerCode;
  const same = pc === src.partnerCode;
  return {
    date: d.date, partnerCode: pc || null,
    buyerName: salesGiven(o.buyerName) ? o.buyerName : (same && src.snap ? src.snap.name : ''),
    contact: o.contact !== undefined ? o.contact : (same ? carryHeader(src).contact : undefined),
    payTo: o.payTo, method: o.method,
    vatInclusive: normPricing(d.pricing).mode === 'inclusive', pricing: d.pricing, lines: d.lines,
    project: d.project, salesName: d.salesName, reference: d.reference, note: d.note, internalNote: d.internalNote,
    fromDoc: src.no, fromKind: kind,
  };
}
/** ออกใบเสร็จให้ใบกำกับที่เพิ่งออกในชุดเดียวกัน (ออกใบกำกับพร้อมรับเงิน) — ไม่ส่งข้อมูลรับเงิน = ตั้งลูกหนี้ตามปกติ */
function receiveAtIssue(inv, pay) {
  if (!pay) return inv;
  const rc = receivePayment(Object.assign({}, pay, {
    invoiceNo: inv.no, date: pay.date || inv.date,
    whtCode: pay.whtCode !== undefined ? pay.whtCode : (inv.whtCode || null),
  }));
  inv.receiptNos = (inv.receiptNos || []).concat([rc.no]);
  inv.paidAtIssue = true;
  audit('invoice', inv.no, 'paid_at_issue', null, { receipt: rc.no, net: fmt(rc.net) });
  return inv;
}
/** ออกใบกำกับภาษีพร้อมรับชำระ — ใบกำกับและใบเสร็จออกในชุดเดียว ล้มขั้นใดก็ไม่ออกทั้งคู่ (เงื่อนไขชำระเป็นเงินสด) */
function issuePaidInvoice(input) {
  const o = Object.assign({ creditType: 'cash' }, input || {});
  const pay = o.payment || {};
  delete o.payment;
  return receiveAtIssue(issueInvoice(o), pay);
}

/* ---------- ใบวางบิล/ใบแจ้งหนี้ (มีรายการของตัวเอง) ---------- */
function itemBillingFind(no) {
  const b = billingNoteFind(no);
  if (!isItemBilling(b)) {
    throw new DomainError('BILLING_NOT_ITEMS', 'ใบวางบิล ' + no + ' เป็นใบวางบิลรวมใบกำกับที่ออกแล้ว ไม่มีรายการสินค้าให้แก้หรือแปลง',
      'ใบวางบิลรวมใบกำกับใช้รับชำระตามใบวางบิลได้เลย');
  }
  return b;
}
/** ลูกค้าและรายการของใบวางบิล — ตรวจแบบเดียวกับใบเสนอราคา (บัญชีรายได้ที่เลือกไว้ตรวจตั้งแต่ตอนนี้) */
function itemBillingParts(input) {
  const p = partnerByCode(input.partnerCode);
  if (!isCustomer(p)) {
    throw new DomainError('PARTNER_WRONG_SIDE', 'ใบวางบิลออกให้ลูกค้าเท่านั้น แต่ ' + p.name + ' อยู่ในทะเบียน' + (PARTNER_KINDS[p.kind] || 'อื่น'));
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่วางบิล');
  const lines = (input.lines || []).filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการอย่างน้อย 1 บรรทัด');
  const accs = lines.map((l, i) => (l.acc ? revenueLineAccount(l, i) : null));
  const P = priceLines(lines, input.date, input.pricing);
  return { p, P, v: P.v, rows: lines.map((l, i) => ({
    desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
    taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null, acc: accs[i], revenueSub: l.revenueSub || null,
    disc: lineDiscText(l.disc), gross: P.rows[i].gross, amount: P.rows[i].net,
  })) };
}
/** ออกใบวางบิล/ใบแจ้งหนี้ก่อนออกใบกำกับ — ไม่ลงบัญชี ไม่ตัดสต๊อก ไม่เข้ารายงานภาษี (ภาษีเกิดตอนออกใบกำกับ) */
function issueItemBilling(input) {
  const t = itemBillingParts(input);
  const head = docHeader(input, t.p, input.date);
  const snap = applyContactEdits(snapshotPartner(t.p), input.contact);
  const no = nextNo('billingNote', input.date);
  const doc = {
    no, mode: 'items', date: input.date, dueDate: head.due,
    partnerCode: t.p.code, partnerName: snap.name, snap,
    lines: t.rows, base: t.v.std + t.v.zero + t.v.exempt, vat: t.v.vat, total: t.v.total,
    pricing: t.P.pricing, totals: t.P.totals, ...head,
    invoices: [], receipts: [], status: 'issued', delivered: false,
    convertedTo: null, convertedKind: null,
    fromDoc: input.fromDoc || null, fromKind: input.fromDoc ? (input.fromKind || 'quotation') : null,
  };
  Object.assign(doc, docWht(input.whtCode, doc, input.date));
  DB.docs.billingNote.unshift(doc);
  audit('billingNote', no, 'issue', null, { partner: snap.name, total: fmt(doc.total), mode: 'items', from: doc.fromDoc || undefined });
  return doc;
}
/** แก้ไขใบวางบิล/ใบแจ้งหนี้ — ได้เฉพาะสถานะแรก (รอวางบิล) ช่องที่ไม่ส่งมาคงเดิม · เลขที่เดิม บันทึกร่องรอยการแก้ทุกครั้ง */
function updateItemBilling(no, input) {
  const bn = itemBillingFind(no);
  if (bn.status !== 'issued') {
    const why = { delivered: 'วางบิลแล้ว — รีเซ็ตเป็นรอวางบิลก่อน', closed: 'เปิดบิลเป็น ' + bn.convertedTo + ' แล้ว',
      cancelled: 'ถูกยกเลิกแล้ว' }[bn.status] || bn.status;
    throw new DomainError('BILLING_NOT_EDITABLE', 'ใบวางบิล ' + no + ' ' + why + ' แก้ไขไม่ได้',
      bn.status === 'delivered' ? 'กดสถานะ "วางบิลแล้ว" แล้วเลือกรีเซ็ตเป็นรอวางบิล' : 'ออกใบวางบิลใบใหม่แทน');
  }
  const o = input || {};
  const date = o.date || bn.date;
  const t = itemBillingParts({ partnerCode: o.partnerCode || bn.partnerCode, date,
    lines: o.lines || bn.lines.map((l) => ({ ...l, price: unM(l.price) })),
    pricing: o.pricing !== undefined ? o.pricing : bn.pricing });
  const before = { partner: bn.partnerName, total: fmt(bn.total), lines: bn.lines.length };
  const sameP = t.p.code === bn.partnerCode;
  const keep = {};
  ['creditType', 'creditDays', 'dueDate', 'project', 'salesName', 'reference', 'note', 'internalNote'].forEach(function (k) {
    keep[k] = o[k] !== undefined ? o[k] : k === 'dueDate' ? (date !== bn.date || termsTouched(o) ? undefined : bn.due) : bn[k];
  });
  const head = docHeader(keep, t.p, date);
  bn.snap = o.contact !== undefined ? applyContactEdits(snapshotPartner(t.p), o.contact)
    : sameP && bn.snap && bn.snap.edited ? bn.snap : snapshotPartner(t.p);
  bn.date = date; bn.partnerCode = t.p.code; bn.partnerName = bn.snap.name;
  bn.lines = t.rows;
  bn.base = t.v.std + t.v.zero + t.v.exempt; bn.vat = t.v.vat; bn.total = t.v.total;
  bn.pricing = t.P.pricing; bn.totals = t.P.totals;
  Object.assign(bn, head, { dueDate: head.due });
  Object.assign(bn, docWht(o.whtCode !== undefined ? o.whtCode : bn.whtCode, bn, date));
  bn.revision = (bn.revision || 0) + 1;
  bn.updatedAt = new Date().toISOString();
  audit('billingNote', no, 'update', before, { partner: bn.partnerName, total: fmt(bn.total), lines: bn.lines.length });
  return bn;
}
/** สถานะใบวางบิล — 'delivered' วางบิลแล้ว · 'issued' รีเซ็ตเป็นรอวางบิล · 'cancelled' ยกเลิก
    ใช้ได้ทั้งใบวางบิล/ใบแจ้งหนี้ และใบวางบิลรวมใบกำกับ (ใบรวมเก็บเป็นธงวางบิลแล้ว สถานะยังคิดจากยอดคงค้าง) */
function setBillingNoteStatus(no, status, reason) {
  const bn = billingNoteFind(no);
  const items = isItemBilling(bn);
  const st = billingNoteStatus(bn);
  if (st === 'cancelled') throw new DomainError('ALREADY_CANCELLED', 'ใบวางบิล ' + no + ' ยกเลิกไปแล้ว');
  if (items && st === 'closed') {
    throw new DomainError('BILLING_ALREADY_CONVERTED', 'ใบวางบิล ' + no + ' เปิดบิลเป็น ' + bn.convertedTo + ' แล้ว',
      'ยกเลิกเอกสารปลายทาง (' + bn.convertedTo + ') ก่อน ใบวางบิลจะกลับมาเปลี่ยนสถานะได้');
  }
  const before = items ? bn.status : (bn.delivered ? 'delivered' : st);
  if (status === 'delivered') {
    if (items ? bn.status === 'delivered' : bn.delivered) throw new DomainError('BILLING_ALREADY_DELIVERED', 'ใบวางบิล ' + no + ' วางบิลแล้ว');
    if (!items && st === 'paid') throw new DomainError('BILLING_ALREADY_PAID', 'ใบวางบิล ' + no + ' เก็บเงินครบแล้ว');
    if (items) bn.status = 'delivered';
    bn.delivered = true;
    bn.deliveredAt = new Date().toISOString();
  } else if (status === 'issued') {
    if (items ? bn.status === 'issued' : !bn.delivered) throw new DomainError('BILLING_NOT_DELIVERED', 'ใบวางบิล ' + no + ' ยังรอวางบิลอยู่แล้ว');
    const rcs = (bn.receipts || []).filter((r) => liveDoc(DB.docs.receipt.find((x) => x.no === r)));
    if (rcs.length) {
      throw new DomainError('BILLING_HAS_RECEIPTS', 'ใบวางบิล ' + no + ' มีใบเสร็จ ' + rcs.join(', ') + ' แล้ว รีเซ็ตไม่ได้',
        'ยกเลิกใบเสร็จก่อน ถ้าต้องการกลับไปรอวางบิล');
    }
    if (items) bn.status = 'issued';
    bn.delivered = false;
    bn.deliveredAt = null;
  } else if (status === 'cancelled') {
    if (!items && st === 'paid') throw new DomainError('BILLING_ALREADY_PAID', 'ใบวางบิล ' + no + ' เก็บเงินครบแล้ว ยกเลิกไม่ได้');
    bn.status = 'cancelled';
    if (reason) bn.statusReason = reason;
    /* ใบเสนอราคาที่แปลงมาเป็นใบวางบิลนี้ กลับมาแปลงต่อได้ */
    if (items) reopenTradeDoc('quotation', bn.no);
  } else {
    throw new DomainError('BILLING_STATUS_INVALID', 'เปลี่ยนสถานะใบวางบิลเป็น ' + status + ' ไม่ได้');
  }
  audit('billingNote', no, status === 'issued' ? 'reset' : status, { status: before }, { status }, reason || null);
  return bn;
}
/** ใบวางบิล/ใบแจ้งหนี้ → ใบกำกับภาษี (input.to 'invoice' ค่าเริ่มต้น) หรือขายเงินสด ('cashSale')
    input.payment = ข้อมูลรับเงิน → ออกใบกำกับพร้อมใบเสร็จในชุดเดียว */
function convertItemBilling(no, input) {
  const bn = itemBillingFind(no);
  if (bn.status === 'closed') {
    throw new DomainError('BILLING_ALREADY_CONVERTED', 'ใบวางบิล ' + no + ' เปิดบิลเป็น ' + bn.convertedTo + ' ไปแล้ว');
  }
  if (bn.status === 'cancelled') throw new DomainError('BILLING_CANCELLED', 'ใบวางบิล ' + no + ' ถูกยกเลิกแล้ว แปลงต่อไม่ได้');
  const o = input || {};
  const to = o.to === 'cashSale' ? 'cashSale' : 'invoice';
  let made;
  if (to === 'cashSale') made = issueCashSale(cashSaleFrom(bn, 'billingNote', o));
  else {
    const data = salesCarry(bn, o);
    delete data.payment; delete data.to;
    made = receiveAtIssue(issueInvoice(Object.assign(data, { fromDoc: bn.no, fromKind: 'billingNote', soNo: null })), o.payment);
  }
  bn.statusBeforeClose = bn.status;
  bn.status = 'closed';
  bn.convertedTo = made.no;
  bn.convertedKind = to;
  audit('billingNote', no, 'convert', null, { to: made.no });
  return made;
}

/* ---------- ใบเสนอราคา → ใบวางบิล / ใบกำกับภาษี / ขายเงินสด ----------
   ใช้กับฟอร์มที่เติมข้อมูลจากใบเสนอราคาไว้ให้ (แก้ก่อนบันทึกได้) — convertTradeDoc ยังใช้แปลงแบบไม่ต้องกรอกอะไรเพิ่ม */
function convertQuotation(no, input) {
  const q = tradeDocFind('quotation', no);
  if (q.status === 'closed') {
    throw new DomainError('TRADE_DOC_ALREADY_CONVERTED', 'ใบเสนอราคา ' + no + ' ถูกแปลงเป็น ' + q.convertedTo + ' ไปแล้ว');
  }
  if (q.status === 'cancelled' || q.status === 'rejected') {
    throw new DomainError('TRADE_DOC_NOT_ACTIVE', 'ใบเสนอราคา ' + no + ' ' + (q.status === 'cancelled' ? 'ถูกยกเลิก' : 'ไม่อนุมัติ') + ' แปลงต่อไม่ได้',
      q.status === 'rejected' ? 'รีเซ็ตเป็นรออนุมัติแล้วอนุมัติก่อน' : 'ออกใบเสนอราคาใบใหม่');
  }
  const o = input || {};
  let made;
  if (o.to === 'cashSale') made = issueCashSale(cashSaleFrom(q, 'quotation', o));
  else if (o.to === 'billingNote' || o.to === 'invoice') {
    const data = salesCarry(q, o);
    delete data.payment; delete data.to;
    made = o.to === 'billingNote' ? issueItemBilling(Object.assign(data, { fromDoc: q.no, fromKind: 'quotation' }))
      : receiveAtIssue(issueInvoice(Object.assign(data, { fromDoc: q.no, fromKind: 'quotation' })), o.payment);
  } else {
    throw new DomainError('TRADE_CONVERT_TARGET_INVALID', 'แปลงใบเสนอราคาเป็น ' + (o.to || '(ไม่ระบุ)') + ' ไม่ได้',
      'เลือกใบวางบิล ใบกำกับภาษี หรือขายเงินสด');
  }
  q.status = 'closed';
  q.convertedTo = made.no;
  q.convertedKind = o.to;
  audit('quotation', no, 'convert', null, { to: made.no, kind: o.to });
  return made;
}
/** รีเซ็ตใบเสนอราคา/ใบสั่งขายกลับเป็นรออนุมัติ (สถานะแรก แก้ไขได้) — ได้เมื่อยังไม่มีเอกสารปลายทาง */
function resetSalesDoc(kind, no) {
  if (kind !== 'quotation' && kind !== 'salesOrder') throw new DomainError('TRADE_DOC_KIND_UNKNOWN', 'รีเซ็ตเอกสารประเภท ' + kind + ' ไม่ได้');
  const d = tradeDocFind(kind, no);
  const label = TRADE_DOCS[kind].label;
  if (d.status === 'issued') throw new DomainError('TRADE_DOC_ALREADY_ISSUED', label + ' ' + no + ' อยู่ในสถานะรออนุมัติอยู่แล้ว');
  if (d.status === 'closed' || d.status === 'partially_invoiced') {
    throw new DomainError('TRADE_DOC_HAS_DEPENDENTS', label + ' ' + no + ' มีเอกสารปลายทางแล้ว (' + (d.convertedTo || (d.invoiceNos || []).join(', ')) + ') รีเซ็ตไม่ได้',
      'ยกเลิกเอกสารปลายทางก่อน ใบนี้จะกลับมารีเซ็ตได้');
  }
  if (d.status === 'cancelled') throw new DomainError('TRADE_DOC_NOT_ACTIVE', label + ' ' + no + ' ถูกยกเลิกแล้ว รีเซ็ตไม่ได้', 'ออกใบใหม่แทน');
  const before = d.status;
  d.status = 'issued';
  d.statusReason = null;
  audit(kind, no, 'reset', { status: before }, { status: 'issued' });
  return d;
}

/* ---------- ใบกำกับภาษี: ส่งให้ลูกค้าแล้ว · รีเซ็ตเป็นรอดำเนินการ · แก้ไข ---------- */
function invoiceFind(no) {
  const inv = DB.docs.invoice.find((d) => d.no === no);
  if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + no);
  if (inv.status === 'void') throw new DomainError('INVOICE_VOID', 'ใบกำกับ ' + no + ' ถูกยกเลิกไปแล้ว');
  return inv;
}
/** เอกสารที่อ้างถึงใบกำกับใบนี้ — ใบเสร็จ ใบลด/เพิ่มหนี้ คืนเงิน ใบวางบิลรวม หักกลบ ตัดหนี้สูญ เงินมัดจำที่หักไว้ */
function invoiceDownstream(inv) {
  const out = voidBlockers('invoice', inv).slice();
  DB.docs.billingNote.forEach(function (b) {
    if (isItemBilling(b) || b.status === 'cancelled' || !b.invoices.some((i) => i.no === inv.no)) return;
    if (!out.some((x) => x.indexOf(b.no) >= 0)) out.push('อยู่ในใบวางบิล ' + b.no);
  });
  return out;
}
/** ตรวจก่อนรีเซ็ต/แก้ใบกำกับ — ยังไม่มีเอกสารปลายทาง · งวดเปิด · ยังไม่ยื่น ภ.พ.30 · เป็นใบที่ออกในระบบนี้ */
function assertInvoiceEditable(inv, verb) {
  const e = DB.entries.find((x) => x.no === inv.entryNo);
  if (inv.broughtForward || !e || e.src !== 'invoice' || String(e.srcId) !== String(inv.no) || e.status !== 'posted') {
    throw new DomainError('INVOICE_NOT_OWN', 'ใบกำกับ ' + inv.no + ' เป็นยอดยกมาหรือนำเข้าจากระบบเดิม ' + verb + 'ในระบบนี้ไม่ได้',
      'ออกใบลดหนี้/ใบเพิ่มหนี้ หรือบันทึกรายการปรับปรุงแทน');
  }
  const dep = invoiceDownstream(inv);
  if (dep.length) {
    throw new DomainError('INVOICE_HAS_DEPENDENTS', verb + 'ใบกำกับ ' + inv.no + ' ไม่ได้ เพราะ' + dep[0],
      (dep.length > 1 ? 'และ ' + dep.slice(1).join(' · ') + ' · ' : '') + 'ยกเลิกเอกสารที่อ้างถึงก่อน หรือออกใบลดหนี้/ใบเพิ่มหนี้แทน');
  }
  const p = periodFor(inv.date);
  if (p.status !== 'open' || (DB.settings.hardLockDate && inv.date <= DB.settings.hardLockDate)) {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ' + verb + 'ใบกำกับในงวดนั้นไม่ได้',
      'ออกใบลดหนี้/ใบเพิ่มหนี้ในงวดปัจจุบันแทน (มาตรา 86/9 86/10)');
  }
  const filed = taxRowsOf('invoice', inv).some((t) => t.filingId)
    || DB.docs.filing.some((f) => f.form === 'PP30' && f.period === periodOf(inv.date));
  if (filed) {
    throw new DomainError('TAX_ALREADY_FILED', 'ยื่นแบบ ภ.พ.30 งวด ' + thPeriod(periodOf(inv.date)) + ' ไปแล้ว ' + verb + 'ใบกำกับในเดือนนั้นไม่ได้',
      'ออกใบลดหนี้/ใบเพิ่มหนี้ในงวดปัจจุบันแทน (มาตรา 86/9 86/10)');
  }
}
/** ส่งให้ลูกค้าแล้ว (รอดำเนินการ → รอเก็บเงิน) หรือรีเซ็ตกลับเป็นรอดำเนินการ (เพื่อแก้ไข) */
function setInvoiceDelivered(no, on) {
  const inv = invoiceFind(no);
  if (on) {
    if (inv.delivered !== false) throw new DomainError('INVOICE_ALREADY_DELIVERED', 'ใบกำกับ ' + no + ' ส่งให้ลูกค้าแล้ว');
    markInvoiceDelivered(inv);
    audit('invoice', no, 'delivered', { delivered: false }, { delivered: true });
    return inv;
  }
  if (inv.delivered === false) throw new DomainError('INVOICE_NOT_DELIVERED', 'ใบกำกับ ' + no + ' อยู่ในสถานะรอดำเนินการอยู่แล้ว');
  assertInvoiceEditable(inv, 'รีเซ็ต');
  inv.delivered = false;
  inv.deliveredAt = null;
  audit('invoice', no, 'reset', { delivered: true }, { delivered: false });
  return inv;
}
/** ส่งเงื่อนไขชำระหรือจำนวนวันมาใหม่โดยไม่ระบุวันครบกำหนด — นับวันครบกำหนดใหม่ ไม่ใช้วันเดิม */
const termsTouched = (o) => o.dueDate === undefined && (o.creditDays !== undefined || o.creditType !== undefined);
const INV_HEAD_KEYS = ['creditType', 'creditDays', 'dueDate', 'project', 'salesName', 'reference', 'note', 'internalNote'];
/** รายการของเอกสารในรูปที่เทียบกันได้ — ใช้ตรวจว่าการแก้แบบหัวเอกสารอย่างเดียวไม่ได้แตะรายการ */
const invLineKey = (ls) => JSON.stringify((ls || []).filter((l) => String(l.desc || '').trim() && M(l.price) !== 0)
  .map((l) => [String(l.desc).trim(), roundQty(l.qty), typeof l.price === 'number' ? l.price : M(l.price),
    lineDiscText(l.disc), l.taxCode || 'VAT7', l.itemCode || null]));
/** แก้ไขใบกำกับที่ยังรอดำเนินการ (ยังไม่ส่งลูกค้า และยังไม่มีเอกสารปลายทาง) — เลขที่เดิม
    ทำในชุดเดียว: กลับรายการใบสำคัญเดิม ณ วันที่เดิม · คืนสต๊อกที่ตัดไป · แทนแถวรายงานภาษีขาย · ออกใหม่ด้วยเลขเดิม
    ใบที่ผูกใบสั่งขาย (นับจำนวนที่ออกแล้ว) หรือหักเงินมัดจำไว้ แก้ได้เฉพาะหัวเอกสาร (เงื่อนไขชำระ โปรเจกต์ หมายเหตุ ฯลฯ) */
function editInvoice(no, input) {
  const inv = invoiceFind(no);
  if (inv.delivered !== false) {
    throw new DomainError('INVOICE_NOT_EDITABLE', 'ใบกำกับ ' + no + ' ส่งให้ลูกค้าแล้ว (' + docStatusText(inv) + ') แก้ไขไม่ได้',
      'รีเซ็ตเป็นรอดำเนินการก่อน (ได้เมื่อยังไม่มีใบเสร็จ ใบลด/เพิ่มหนี้ หรือใบวางบิลอ้างถึง) หรือออกใบลดหนี้/ใบเพิ่มหนี้');
  }
  assertInvoiceEditable(inv, 'แก้ไข');
  const o = input || {};
  const rev = (inv.revision || 0) + 1;
  const why = 'แก้ไขใบกำกับ ' + no + ' ครั้งที่ ' + rev + (salesGiven(o.reason) ? ' — ' + String(o.reason).trim() : '');
  const before = { date: inv.date, partner: inv.partnerName, base: fmt(inv.base), vat: fmt(inv.vat), total: fmt(inv.total), lines: inv.lines.length };
  const trail = (x) => (x.revisions || []).concat([{ rev, at: new Date().toISOString(), date: inv.date, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, base: inv.base, vat: inv.vat, total: inv.total, lines: inv.lines.length,
    entryNo: inv.entryNo, cogsEntryNo: inv.cogsEntryNo, reason: salesGiven(o.reason) ? String(o.reason).trim() : null }]);

  /* ใบที่นับจำนวนกับใบสั่งขาย หรือหักเงินมัดจำไว้ — ตัวเลขผูกกับเอกสารอื่น แก้ได้แค่หัวเอกสาร */
  if (inv.soNo || (inv.deposits || []).length) {
    const lockWhy = inv.soNo ? 'ผูกกับใบสั่งขาย ' + inv.soNo : 'หักเงินมัดจำ ' + inv.deposits.map((r) => r.no).join(', ') + ' ไว้';
    const touched = (o.lines && invLineKey(o.lines) !== invLineKey(inv.lines))
      || (o.partnerCode && o.partnerCode !== inv.partnerCode) || (o.date && o.date !== inv.date)
      || (o.pricing && JSON.stringify(normPricing(o.pricing)) !== JSON.stringify(normPricing(inv.pricing)))
      || (o.contact !== undefined && o.contact !== null)
      || (o.whtCode !== undefined && (o.whtCode || null) !== (inv.whtCode || null));
    if (touched) {
      throw new DomainError('INVOICE_EDIT_HEADER_ONLY', 'ใบกำกับ ' + no + ' ' + lockWhy + ' แก้ได้เฉพาะเงื่อนไขชำระ โปรเจกต์ พนักงานขาย เลขอ้างอิง และหมายเหตุ',
        'ถ้ารายการหรือยอดผิด ให้ยกเลิกใบกำกับแล้วออกใหม่จาก' + (inv.soNo ? 'ใบสั่งขาย' : 'เอกสารเดิม') + ' หรือออกใบลดหนี้/ใบเพิ่มหนี้');
    }
    const keep = {};
    INV_HEAD_KEYS.forEach((k) => { keep[k] = o[k] !== undefined ? o[k] : k === 'dueDate' ? (termsTouched(o) ? undefined : inv.due) : inv[k]; });
    Object.assign(inv, docHeader(keep, partnerByCode(inv.partnerCode), inv.date));
    inv.revisions = trail(inv);
    inv.revision = rev;
    inv.updatedAt = new Date().toISOString();
    audit('invoice', no, 'update', before, { header: true, due: inv.due, project: inv.project || undefined }, why);
    return inv;
  }

  const idx = DB.docs.invoice.indexOf(inv);
  /* 1) กลับรายการใบสำคัญเดิม ณ วันที่เดิม (ใบสำคัญเดิมยังอยู่และขึ้นว่ากลับรายการแล้ว) */
  [inv.entryNo, inv.cogsEntryNo].filter(Boolean).forEach(function (en) {
    const e = DB.entries.find((x) => x.no === en);
    if (e && e.status === 'posted') reverse(en, why, inv.date, { fromSource: true });
  });
  /* 2) คืนสต๊อกที่ตัดไป — รายการเดิมย้ายไปเป็นของฉบับก่อนแก้ จะได้ไม่นับซ้ำกับฉบับใหม่
     (ใบลดหนี้รับคืนสินค้า และการยกเลิกภายหลัง ดูเฉพาะรายการของฉบับปัจจุบันที่อ้างเลขที่ใบกำกับ) */
  const oldSrc = no + ' (ก่อนแก้ไขครั้งที่ ' + rev + ')';
  DB.docs.stockMove.filter((m) => m.src === no && m.dir === 'out').forEach(function (m) {
    m.src = oldSrc;
    const it = DB.items.find((x) => x.code === m.item);
    if (!it) return;
    it.qty = roundQty(it.qty + m.qty);
    it.value += m.cost;
    it.avgCost = it.qty > 0 ? unitCost(it.value, it.qty) : it.avgCost;
    DB.docs.stockMove.push({ date: m.date, item: it.code, dir: 'in', qty: m.qty, cost: m.cost,
      src: no + ' (แก้ไขครั้งที่ ' + rev + ' คืนสต๊อกฉบับเดิม)', balance: it.qty });
  });
  /* 3) แถวรายงานภาษีขายเดิมออก (เลขที่ยังไม่เข้าแบบ ภ.พ.30) — ฉบับใหม่เข้าแทนที่ตำแหน่งเดิม */
  const oldRows = taxRowsOf('invoice', inv);
  const pos = oldRows.length ? DB.taxTx.indexOf(oldRows[0]) : -1;
  oldRows.forEach((t) => DB.taxTx.splice(DB.taxTx.indexOf(t), 1));
  /* 4) ออกใหม่ด้วยเลขเดิม — ช่องที่ไม่ส่งมาใช้ของเดิม */
  DB.docs.invoice.splice(idx, 1);
  const sameP = !o.partnerCode || o.partnerCode === inv.partnerCode;
  const data = {
    partnerCode: o.partnerCode || inv.partnerCode, date: o.date || inv.date,
    lines: o.lines || inv.lines.map((l) => ({ ...l, price: unM(l.price) })),
    pricing: o.pricing !== undefined ? o.pricing : inv.pricing,
    contact: o.contact !== undefined ? o.contact : sameP ? carryHeader(inv).contact : undefined,
    whtCode: o.whtCode !== undefined ? o.whtCode : (inv.whtCode || null),
    forceNo: no, fromDoc: inv.fromDoc || null, fromKind: inv.fromKind || null, soNo: null,
  };
  INV_HEAD_KEYS.forEach(function (k) {
    data[k] = o[k] !== undefined ? o[k] : k === 'dueDate' ? (data.date !== inv.date || termsTouched(o) ? undefined : inv.due) : inv[k];
  });
  const made = issueInvoice(data);
  DB.docs.invoice.splice(DB.docs.invoice.indexOf(made), 1);
  DB.docs.invoice.splice(idx, 0, made);
  if (pos >= 0) {
    taxRowsOf('invoice', made).forEach(function (t, k) {
      DB.taxTx.splice(DB.taxTx.indexOf(t), 1);
      DB.taxTx.splice(Math.min(pos + k, DB.taxTx.length), 0, t);
    });
  }
  made.delivered = false;
  made.revisions = trail(inv);
  made.revision = rev;
  made.updatedAt = new Date().toISOString();
  audit('invoice', no, 'update', before, { date: made.date, partner: made.partnerName, base: fmt(made.base), vat: fmt(made.vat),
    total: fmt(made.total), lines: made.lines.length, entry: made.entryNo }, why);
  return made;
}
/** ชื่อสถานะของใบกำกับแบบข้อความ (ใช้ในข้อความแจ้งเตือนของเครื่องบัญชี — หน้าจอใช้ DOC_STATUS) */
function docStatusText(inv) {
  if (inv.status === 'paid') return 'เก็บเงินแล้ว';
  if (inv.status === 'partially_paid') return 'แบ่งจ่าย';
  return inv.delivered === false ? 'รอดำเนินการ' : 'รอเก็บเงิน';
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
  if (!isVendor(p)) {
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
    const row = { itemCode: it.code, desc: String(l.desc || '').trim() || it.name, qty: roundQty(l.qty), uom: it.uom,
      price: M(l.price), amount: round2(mulQty(M(l.price), l.qty)), taxCode: l.taxCode || 'VAT7' };
    if (l.poLine !== undefined) row.poLine = l.poLine;
    return row;
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

/** จำนวนที่รับแล้วของแต่ละบรรทัดในใบสั่งซื้อ — นับเฉพาะใบรับสินค้าที่ยังไม่ยกเลิก */
function poReceived(po) {
  const got = po.lines.map(() => 0);
  DB.docs.goodsReceipt.forEach(function (g) {
    if (g.poNo !== po.no || g.status === 'void') return;
    g.lines.forEach(function (r, i) {
      const k = r.poLine !== undefined && r.poLine !== null ? r.poLine : i;   // ใบรุ่นก่อนรับครบทุกบรรทัดตามลำดับ
      if (k < got.length) got[k] = roundQty(got[k] + r.qty);
    });
  });
  return got;
}
/** สถานะใบสั่งซื้อคิดจากของที่รับจริง: ยังไม่รับ / รับบางส่วน / รับครบ (ปิด) */
function syncPoStatus(po) {
  const got = poReceived(po);
  const grns = DB.docs.goodsReceipt.filter((g) => g.poNo === po.no && g.status !== 'void').map((g) => g.no).reverse();
  po.grnNos = grns;
  if (po.status === 'cancelled') return po;                 // ยกเลิกส่วนที่เหลือไปแล้ว คงสถานะไว้
  const all = po.lines.every((l, i) => got[i] >= roundQty(l.qty));
  if (grns.length && all) { po.status = 'closed'; po.convertedTo = grns.join(', '); }
  else if (grns.length) { po.status = 'partially_received'; po.convertedTo = null; }
  else { po.status = po.statusBeforeReceive || 'approved'; po.convertedTo = null; }
  return po;
}
/** รับสินค้าตามใบสั่งซื้อ — รับครบหรือรับบางส่วนก็ได้ ส่วนที่เหลือรับต่อในใบรับสินค้าใบถัดไป
    input.lines = [{ line: ลำดับบรรทัดในใบสั่งซื้อ, qty }] · ไม่ระบุ = รับส่วนที่ค้างทั้งหมด */
function receiveGoodsFromPo(poNo, input) {
  const po = tradeDocFind('purchaseOrder', poNo);
  if (po.status === 'closed') {
    throw new DomainError('TRADE_DOC_ALREADY_CONVERTED', 'ใบสั่งซื้อ ' + poNo + ' รับสินค้าครบหรือแปลงเป็น ' + po.convertedTo + ' ไปแล้ว');
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
  const got = poReceived(po);
  const want = Array.isArray(opts.lines)
    ? opts.lines.map((x) => ({ line: Number(x.line), qty: roundQty(x.qty || 0) }))
    : po.lines.map((l, i) => ({ line: i, qty: roundQty(roundQty(l.qty) - got[i]) }));
  const rows = [];
  want.forEach(function (w) {
    const l = po.lines[w.line];
    if (!l) throw new DomainError('GRN_PO_LINE_INVALID', 'ไม่พบบรรทัดที่ ' + (w.line + 1) + ' ในใบสั่งซื้อ ' + poNo);
    if (!(w.qty > 0)) return;
    const left = roundQty(roundQty(l.qty) - got[w.line]);
    if (w.qty > left) {
      throw new DomainError('GRN_PO_OVER_RECEIVE', l.desc + ' รับ ' + w.qty + ' เกินที่สั่งและยังค้างรับ ' + left,
        'ถ้าผู้ขายส่งเกิน ให้ขอใบสั่งซื้อเพิ่ม หรือรับเท่าที่สั่งแล้วคืนส่วนเกิน');
    }
    rows.push({ ...l, price: unM(l.price), qty: w.qty, poLine: w.line });
  });
  if (!rows.length) throw new DomainError('GRN_QTY_INVALID', 'ต้องรับสินค้าอย่างน้อย 1 รายการ');
  if (po.status !== 'partially_received') po.statusBeforeReceive = po.status;
  const grn = issueGoodsReceipt({
    partnerCode: po.partnerCode, date: opts.date || TODAY, vendorDoNo: opts.vendorDoNo, poNo: po.no,
    lines: rows, note: opts.note || po.note,
  });
  syncPoStatus(po);
  audit('purchaseOrder', poNo, po.status === 'closed' ? 'convert' : 'partial_receive', null, { to: grn.no });
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
  const d = (DB.docs.vendorDeposit || []).find((x) => x.partnerCode === partnerCode && x.vendorNo && x.vendorNo === docNo && x.status !== 'void');
  const dup = b || e || d;
  if (dup) {
    throw new DomainError('DUPLICATE_VENDOR_INVOICE',
      'บันทึกใบกำกับภาษีซื้อเลขที่ ' + docNo + ' ของผู้ขายรายนี้ไปแล้ว (' + dup.no + ')',
      'ตรวจสอบรายการเดิม หรือแก้เลขที่ใบกำกับให้ถูกต้อง');
  }
}

function recordExpense(input) {
  const p = partnerByCode(input.partnerCode);
  if (!isVendor(p)) {
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

  const P = priceLines(lines, input.date, input.pricing);
  const v = P.v;
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
  let wht = 0, whtRate = null, whtLabel = null, whtBase = 0;
  if (whtCode) {
    const r = resolveRate(whtCode, input.date, { channel });
    /* ฐานที่ระบุเอง — ค่าบริการปนค่าอะไหล่หรือเงินที่จ่ายแทน หักเฉพาะส่วนที่เป็นเงินได้ประเภทนั้น */
    const given = input.whtBase !== undefined && input.whtBase !== null && String(input.whtBase).trim() !== '';
    whtBase = given ? M(input.whtBase) : base;
    if (given && (whtBase <= 0 || whtBase > base)) {
      throw new DomainError('WHT_BASE_INVALID', 'ฐานภาษีหัก ณ ที่จ่าย ' + fmt(whtBase) + ' ต้องมากกว่าศูนย์และไม่เกินยอดก่อนภาษี ' + fmt(base),
        'ถ้าไม่ต้องหักเลย ให้เลือก "ไม่หักภาษี ณ ที่จ่าย"');
    }
    /* จ่ายครั้งหนึ่งต่ำกว่า 1,000 บาทไม่ต้องหัก (ท.ป.4/2528) — กติกาเดียวกับการจ่ายชำระเจ้าหนี้ */
    if (base >= M('1000')) { wht = round2(pct(whtBase, r.rate)); whtRate = r.rate; whtLabel = r.label; }
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
  lines.forEach(function (l, i) { debit[l.acc] = (debit[l.acc] || 0) + P.rows[i].net; });
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
        incomeType: whtLabel, base: whtBase, wht, rate: whtRate, sent: false,
        paymentNo: null, expenseNo: no,
      });
    }
    DB.taxTx.push({
      kind: 'wht', period: periodOf(input.date), date: input.date,
      docNo: no, docType: 'expense',
      partnerName: p.name, taxId: p.taxId, branch: p.branch, entityType: p.entityType,
      base: whtBase, tax: wht, rate: whtRate, channel, incomeType: whtLabel,
      form: individual ? 'PND3' : 'PND53', certNo, entryNo: je.no, filingId: null,
    });
  }

  const doc = {
    no, date: input.date, partnerCode: p.code, partnerName: p.name, taxInvoiceNo: taxInvoiceNo || null,
    lines: lines.map((l, i) => ({ desc: String(l.desc).trim(), acc: l.acc, accName: acc(l.acc).name,
      qty: Number(l.qty), price: M(l.price), uom: l.uom || '', disc: lineDiscText(l.disc), gross: P.rows[i].gross,
      amount: P.rows[i].net, taxCode: l.taxCode || 'VAT7' })),
    pricing: P.pricing, totals: P.totals,
    ...docHeader(Object.assign({}, input, { creditType: 'cash' }), p, input.date),
    base, vat: v.vat, total: v.total, claimable,
    whtCode, wht, whtRate, whtBase: wht ? whtBase : 0, net, channel, payFrom, method: input.method || 'transfer',
    certNo, entryNo: je.no, status: 'paid',
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
  inventory: 'สินค้าคงเหลือต้องมาจากเอกสารซื้อขายหรือใบปรับปรุงสินค้า (ยอดยกมา ตรวจนับ ตัดจำหน่าย เบิกใช้) ทะเบียนสินค้ารายตัวจะได้ตรงกับบัญชี',
  wht_payable_pnd1: 'ภาษีหัก ณ ที่จ่ายจากเงินเดือนมาจากการทำเงินเดือน',
  wht_payable_pnd3: 'ภาษีหัก ณ ที่จ่ายต้องมาจากค่าใช้จ่ายหรือการจ่ายชำระที่ออก 50 ทวิ',
  wht_payable_pnd53: 'ภาษีหัก ณ ที่จ่ายต้องมาจากค่าใช้จ่ายหรือการจ่ายชำระที่ออก 50 ทวิ',
};
const isCashAcc = (code) => CASH_SUB.indexOf(acc(code).subType) >= 0;
const WHT_SUB_FORM_OF = { wht_payable_pnd1: 'PND1', wht_payable_pnd3: 'PND3', wht_payable_pnd53: 'PND53' };
/** ยอดค้างนำส่งที่ไม่ได้มาจากเอกสารในระบบ (ยกมาจากระบบเดิม) = ยอดในบัญชี − ภาษีจากเอกสารที่ยังไม่ได้ยื่น */
function openingWhtRoom(sub, asOf) {
  const form = WHT_SUB_FORM_OF[sub];
  const pending = DB.taxTx.filter((t) => t.kind === 'wht' && t.form === form && t.channel === 'manual' && !t.void
    && !t.filingId && t.date <= asOf).reduce((s, t) => s + t.tax, 0);
  return Math.max(0, -balBySub([sub], asOf) - pending);
}

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
  const whtRoom = {};
  lines.forEach(function (l, i) {
    const a = acc(l.acc);
    /* ภาษีหัก ณ ที่จ่ายค้างนำส่งที่ยกมาจากระบบเดิม ไม่มีแถวในทะเบียนภาษีให้ยื่นผ่านหน้าแบบ ภ.ง.ด.
       จ่ายด้วยสมุดรายวันจ่ายได้ ไม่เกินยอดค้างส่วนที่ไม่ได้มาจากเอกสารในระบบ */
    if (book === 'payment' && WHT_SUB_FORM_OF[a.subType] && l.dr > 0 && !l.cr) {
      if (whtRoom[a.subType] === undefined) whtRoom[a.subType] = openingWhtRoom(a.subType, input.date);
      whtRoom[a.subType] -= l.dr;
      if (whtRoom[a.subType] >= 0) return;
      throw new DomainError('WHT_REMIT_EXCEEDS_OPENING', 'จ่าย ' + a.name + ' เกินยอดค้างนำส่งที่ยกมา',
        'ภาษีที่หักจากเอกสารในระบบ ให้นำส่งที่หน้าแบบ ภ.ง.ด. ระบบจะลงบัญชีให้');
    }
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
  cashSale:     { label:'ใบกำกับภาษีอย่างย่อ', src:'cashSale' },
  customerDeposit: { label:'ใบรับเงินมัดจำ', src:'customerDeposit' },
  vendorDeposit: { label:'ใบจ่ายเงินมัดจำ', src:'vendorDeposit' },
  creditApply:  { label:'ใบหักกลบเครดิต', src:'creditApply' },
  badDebt:      { label:'รายการตัดหนี้สูญ', src:'badDebt' },
  vendorCreditNote: { label:'ใบลดหนี้จากผู้ขาย', src:'vendorCreditNote' },
};
const liveDoc = (d) => !!d && d.status !== 'void';

/** แถวในทะเบียนภาษีที่เกิดจากเอกสารใบนี้ */
function taxRowsOf(kind, d) {
  return DB.taxTx.filter(function (t) {
    if (t.void) return false;
    /* แถวของเอกสารระบบรับ–จ่ายชำระ (settle.js) บอกเจ้าของไว้ตรง ๆ */
    if (t.srcDoc) return t.srcDoc === kind + '|' + d.no;
    if (kind === 'invoice') return t.kind === 'vat_output' && t.docType === 'tax_invoice' && t.docNo === d.no;
    if (kind === 'creditNote') return t.kind === 'vat_output' && t.docType === 'credit_note' && t.docNo === d.no;
    if (kind === 'debitNote') return t.kind === 'vat_output' && t.docType === 'debit_note' && t.docNo === d.no;
    if (kind === 'cashSale') return t.kind === 'vat_output' && t.docType === 'abbreviated' && t.docNo === d.no;
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
  /* เอกสารรับ–จ่ายชำระที่อ้างถึงใบนี้ (หักกลบ ตัดหนี้สูญ ใบลดหนี้จากผู้ขาย เครดิตรับเกิน) */
  if (typeof settleVoidBlockers === 'function') settleVoidBlockers(kind, d).forEach((x) => out.push(x));
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
  if (tax.some((t) => t.kind !== 'wht')) out.push('ทะเบียนภาษี' + (tax.some((t) => t.kind === 'vat_input') ? 'ซื้อ' : 'ขาย') + 'แสดงว่า "ยกเลิก" ยอดเป็นศูนย์');
  if (tax.some((t) => t.kind === 'wht')) out.push('ตัดรายการออกจากแบบ ภ.ง.ด. ของงวด');
  if (d.certNo) out.push('ยกเลิกหนังสือรับรอง 50 ทวิ เลขที่ ' + d.certNo);
  if ((kind === 'invoice' || kind === 'cashSale') && d.cogsEntryNo) out.push('คืนสินค้าเข้าคลังตามที่ตัดออกไป');
  if (kind === 'invoice' && d.soNo) out.push('ใบสั่งขาย ' + d.soNo + ' กลับมาค้างออกใบกำกับส่วนนี้');
  if ((kind === 'invoice' || kind === 'cashSale') && d.fromDoc && !d.soNo) {
    const src = (DB.docs[d.fromKind === 'billingNote' ? 'billingNote' : 'quotation'] || []).find((x) => x.no === d.fromDoc && x.convertedTo === d.no);
    if (src) out.push((d.fromKind === 'billingNote' ? 'ใบวางบิล ' : 'ใบเสนอราคา ') + d.fromDoc + ' กลับมาดำเนินการต่อได้');
  }
  if ((kind === 'bill' && !d.grnNo) || kind === 'goodsReceipt' || kind === 'creditNote') {
    if (DB.docs.stockMove.some((m) => m.src === d.no && m.dir === 'in')) {
      out.push(kind === 'creditNote' ? 'นำสินค้าที่รับคืนออกจากคลัง และกลับต้นทุนขายส่วนนั้น' : 'นำสินค้าที่รับเข้าออกจากคลัง');
    }
  }
  if (kind === 'receipt' || kind === 'creditNote' || kind === 'debitNote' || kind === 'customerRefund') out.push('ยอดคงค้างของใบกำกับ ' + d.invoiceNo + ' กลับไปเหมือนก่อนออกใบนี้');
  if (kind === 'payment') out.push('ยอดคงค้างของ ' + d.billNo + ' กลับไปเหมือนก่อนจ่าย');
  if (kind === 'bill' && d.grnNo) out.push('ใบรับสินค้า ' + d.grnNo + ' กลับไปรอตั้งหนี้');
  if (typeof settleVoidPreview === 'function') settleVoidPreview(kind, d).forEach((x) => out.push(x));
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
    /* ตั้งสถานะยกเลิกก่อนปรับทะเบียนที่เกี่ยวข้อง — ตัวที่นับใหม่จากเอกสาร (เช่นยอดรับของตามใบสั่งซื้อ) จะได้ไม่นับใบนี้ */
    const before = d.status;
    d.status = 'void';
    /* คืนยอดที่เอกสารรับ–จ่ายชำระเคยแตะ (เงินมัดจำที่หัก ส่วนต่างที่ปิดยอด เครดิตรับเกิน) และเอกสารชนิดใหม่ของ settle.js */
    if (typeof settleOnVoid === 'function') settleOnVoid(kind, d);
    if (kind === 'invoice') {
      stockBack(no, 'out');
      /* ใบสั่งขายที่ทยอยออกใบกำกับ นับยอดที่ออกแล้วใหม่จากใบกำกับที่เหลือ · ใบรุ่นก่อนเปิดกลับทั้งใบ */
      const so = d.soNo ? DB.docs.salesOrder.find((x) => x.no === d.soNo) : null;
      if (so) syncSoStatus(so); else reopenTradeDoc('salesOrder', no);
      reopenTradeDoc('quotation', no);
      reopenItemBilling(no);
    }
    /* ขายเงินสดที่แปลงมาจากใบเสนอราคาหรือใบวางบิล — ต้นทางกลับมาดำเนินการต่อได้ */
    if (kind === 'cashSale') { stockBack(no, 'out'); reopenTradeDoc('quotation', no); reopenItemBilling(no); }
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
      syncBillStatus(b);
      voidCert(d.certNo);
      DB.docs.paymentBatch.forEach((pb) => pb.items.forEach((i) => { if (i.paymentNo === no) i.voided = true; }));
    }
    if (kind === 'expense') voidCert(d.certNo);
    if (kind === 'goodsReceipt') { stockBack(no, 'in'); reopenGrnOnPo(d); }
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
  if (po) syncPoStatus(po);
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
  /* งวดเงินเดือนมีได้หลายรอบต่อเดือน (งวดปกติ โบนัส เงินชดเชย) และต้องคืนแผ่นงานให้แก้ — ตรวจและยกเลิกที่ payroll.js */
  if (kind === 'payroll') return payRunCheck(period);
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
  const e = DB.entries.find((x) => x.no === run.entryNo);
  if (!e || e.status !== 'posted') throw new DomainError('ALREADY_REVERSED', 'ใบสำคัญของงวดนี้ถูกกลับรายการไปแล้ว');
  return run;
}
function voidRun(kind, period, reason) {
  if (kind === 'payroll') return voidPayRun(period, reason);
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
    return s + (it && (it.type === 'stock' || it.type === 'nonstock') ? l.amount : 0);
  }, 0);
  /* ส่วนที่หักเงินมัดจำไว้ ลูกค้าหัก ณ ที่จ่ายไปแล้วตอนจ่ายมัดจำ */
  return round2(mulDiv(Math.max(0, creditableBase(inv) - (inv.depositBase || 0)), lineBase - goods, lineBase));
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
function billWhtFor(bill, gross, date, channel, whtCode, baseOverride) {
  /* มูลค่าหลังใบลดหนี้จากผู้ขาย — ส่วนที่ผู้ขายลดให้ไม่ใช่เงินได้ของเขา */
  const cn = (DB.docs.vendorCreditNote || []).filter((c) => c.billNo === bill.no && liveDoc(c));
  const base = bill.base - cn.reduce((s, c) => s + c.base, 0);
  const total = bill.total - cn.reduce((s, c) => s + c.total, 0);
  /* ส่วนที่หักกลบด้วยเงินมัดจำจ่ายหรือเครดิตของผู้ขายนับเป็นฐานที่ใช้ไปแล้ว — ภาษีส่วนนั้นหักไว้ตอนจ่ายมัดจำ */
  const prior = DB.docs.payment.filter((x) => x.billNo === bill.no && liveDoc(x))
    .reduce((s, x) => s + (x.baseShare !== undefined ? x.baseShare : round2(mulDiv(bill.base, x.gross, bill.total))), 0)
    + (DB.docs.creditApply || []).filter((x) => x.side === 'ap' && x.targetNo === bill.no && liveDoc(x))
      .reduce((s, x) => s + (x.baseShare || 0), 0);
  const final = gross >= billOutstanding(bill);
  const share = total <= 0 ? 0 : final ? Math.max(0, base - prior)
    : Math.min(round2(mulDiv(base, gross, total)), Math.max(0, base - prior));
  /* ฐานที่ผู้ใช้ระบุเอง เช่น ค่าบริการ 4,000 + ค่าอะไหล่ 6,000 หักเฉพาะ 4,000 */
  const given = baseOverride !== undefined && baseOverride !== null && String(baseOverride).trim() !== '';
  const whtBase = given ? M(baseOverride) : share;
  if (!whtCode || bill.base < M('1000') || whtBase <= 0) return { wht: 0, rate: null, base: whtBase, share };
  const r = resolveRate(whtCode, date, { channel });
  return { wht: round2(pct(whtBase, r.rate)), rate: r.rate, base: whtBase, share };
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
        'รับสินค้าเข้าคลังก่อน (ใบรับสินค้าหรือตั้งหนี้ผู้ขาย) — ของที่มีอยู่แล้วก่อนเริ่มใช้ระบบ ตั้งยอดที่ สินค้า → ยอดยกมา · ตรวจนับ');
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
  const fy = made.length ? fiscalYearOf(made[0] + '-01') : null;
  if (fy && DB.company) DB.company.fiscalYear = String(Number(fy.start.slice(0, 4)) + 543);
  audit('period', made[0] + '…' + made[made.length - 1], 'open_year', null, { periods: made.length }, reason || 'เปิดปีบัญชีถัดไป');
  return made;
}

/* ===================================================================
   ปิดบัญชีสิ้นปี — ใบสำคัญปิดบัญชี (CL) โอนรายได้และค่าใช้จ่ายทั้งปีเข้ากำไรสะสม ณ วันสิ้นปีบัญชี
   งบกำไรขาดทุนไม่นับใบปิดบัญชี (ไม่งั้นกำไรทั้งปีเป็นศูนย์) งบทดลองของเดือนสุดท้ายแสดงก่อนปิดบัญชี
   ปีถัดไปบัญชีรายได้/ค่าใช้จ่ายเริ่มที่ศูนย์ และกำไรสะสมรวมกำไรของปีที่ปิดแล้ว
   ปิดแล้วยังมีรายการลงเพิ่มในปีนั้น กดปิดบัญชีสิ้นปีอีกครั้ง ระบบกลับใบเดิมแล้วปิดใหม่ทั้งปี
   =================================================================== */
const yearEndOf = (fy) => DB.entries.find((e) => e.src === 'yearEnd' && e.srcId === fy.start && e.status === 'posted');
/** ยอดรายได้/ค่าใช้จ่ายของปีที่ยังไม่ได้โอนเข้ากำไรสะสม (รวมใบปิดบัญชีแล้ว) — ศูนย์ทุกบัญชี = ปิดบัญชีครบ */
function yearEndOpen(fy) {
  return DB.accounts.filter((a) => a.postable && (a.type === 'revenue' || a.type === 'expense'))
    .map((a) => ({ acc: a.code, bal: balanceOf(a.code, fy.end, fy.start) })).filter((x) => x.bal !== 0);
}
function closeFiscalYear(date, reason) {
  const fy = fiscalYearOf(date);
  if (!fy) throw new DomainError('PERIOD_NOT_FOUND', 'ไม่พบงวดบัญชีของวันที่ ' + thDate(date));
  if (!fy.complete) {
    throw new DomainError('FISCAL_YEAR_INCOMPLETE', 'ปีบัญชีนี้มีงวดไม่ครบ 12 งวด ยังปิดบัญชีสิ้นปีไม่ได้');
  }
  const old = yearEndOf(fy);
  if (old) reverse(old.no, reason || 'ปิดบัญชีสิ้นปีใหม่ — มีรายการลงเพิ่มหลังปิดบัญชีครั้งก่อน', fy.end, { fromSource: true });
  const lines = [];
  let profit = 0;
  DB.accounts.filter((a) => a.postable && (a.type === 'revenue' || a.type === 'expense')).forEach(function (a) {
    const b = balanceOf(a.code, fy.end, fy.start, notClosingEntry);
    if (!b) return;
    lines.push(b > 0 ? { acc: a.code, cr: b } : { acc: a.code, dr: -b });
    profit -= b;
  });
  if (!lines.length) {
    throw new DomainError('NOTHING_TO_CLOSE', 'ปี ' + fy.label + ' ไม่มีรายได้หรือค่าใช้จ่ายต้องปิดบัญชี');
  }
  const re = accBySub('retained_earnings');
  if (profit) lines.push(profit > 0 ? { acc: re, cr: profit } : { acc: re, dr: -profit });
  const je = post({
    type: 'closing', date: fy.end,
    desc: 'ปิดบัญชีสิ้นปี ' + fy.label + ' — โอน' + (profit >= 0 ? 'กำไร' : 'ขาดทุน') + 'สุทธิ ' + fmt(Math.abs(profit)) + ' บาท เข้ากำไรสะสม',
    src: 'yearEnd', srcId: fy.start, lines,
  });
  audit('fiscal_year', fy.start, 'close', null, { profit: fmt(profit), entry: je.no });
  return { entry: je, profit, fy };
}
/** ยกเลิกการปิดบัญชีสิ้นปี — กลับรายการใบปิดบัญชี (งวดสุดท้ายต้องยังเปิดอยู่) */
function reopenFiscalYear(date, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'ต้องระบุเหตุผลที่ยกเลิกการปิดบัญชีสิ้นปี');
  }
  const fy = fiscalYearOf(date);
  const old = fy && yearEndOf(fy);
  if (!old) throw new DomainError('YEAR_NOT_CLOSED', 'ปีบัญชีนี้ยังไม่ได้ปิดบัญชีสิ้นปี');
  const rev = reverse(old.no, String(reason).trim(), fy.end, { fromSource: true });
  audit('fiscal_year', fy.start, 'reopen', null, { reversal: rev.no }, String(reason).trim());
  return rev;
}


/* ===================================================================
   บัญชีค่าใช้จ่ายของรายการซื้อ — เลือกบัญชีเจาะจงได้ ไม่ต้องเดาจากประเภท
   =================================================================== */
/** บัญชีที่ตั้งหนี้ผู้ขายลงได้: ค่าใช้จ่าย สินค้า ทรัพย์สิน ค่าใช้จ่ายล่วงหน้า เงินมัดจำ */
function billAccounts() {
  const assetSubs = ['inventory', 'ppe', 'ppe_land', 'cip', 'intangible', 'other_asset'];
  const out = DB.accounts.filter((a) => a.postable && assetSubs.indexOf(a.subType) >= 0);
  expenseAccounts().forEach((a) => { if (out.indexOf(a) < 0) out.push(a); });
  return out;
}
/** บัญชีปริยายของประเภท — ค่าใช้จ่ายบริหารทั่วไปลง "เบ็ดเตล็ด" ไม่ใช่บัญชีแรกที่บังเอิญเจอ */
function defaultAccountFor(sub) {
  const accs = DB.accounts.filter((a) => a.postable && a.subType === sub);
  const pick = accs.find((a) => a.isDefault)
    || (sub === 'admin_expense' ? accs.find((a) => /เบ็ดเตล็ด/.test(a.name || '')) || accs.find((a) => /อื่น/.test(a.name || '')) : null)
    || accs[0];
  return pick ? pick.code : accBySub(sub);
}
function billLineAccount(l, i) {
  if (l.acc) {
    const ok = billAccounts().some((a) => a.code === l.acc);
    if (!ok) {
      throw new DomainError('BILL_ACCOUNT_INVALID', 'บรรทัดที่ ' + (i + 1) + ' บัญชี ' + l.acc + ' ใช้บันทึกรายการซื้อไม่ได้',
        'เลือกบัญชีค่าใช้จ่าย สินค้าคงเหลือ ทรัพย์สิน หรือค่าใช้จ่ายจ่ายล่วงหน้า');
    }
    /* ลงบัญชีสินค้าคงเหลือโดยไม่ระบุสินค้า ยอดบัญชีจะขึ้นแต่ไม่มีของในทะเบียน ขายไม่ได้และยอดคุมไม่มีวันตรง */
    if (acc(l.acc).subType === 'inventory') {
      const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
      if (!it || it.type !== 'stock') {
        throw new DomainError('BILL_INVENTORY_NEEDS_ITEM', 'บรรทัดที่ ' + (i + 1) + ' ลงบัญชีสินค้าคงเหลือ ต้องเลือกสินค้าที่มีสต๊อกด้วย',
          'เลือกสินค้าในบรรทัดนั้น ระบบจะรับเข้าคลังให้ หรือเลือกบัญชีค่าใช้จ่ายแทน');
      }
    }
    if (l.itemCode && acc(l.acc).subType !== 'inventory') {
      const it = DB.items.find((x) => x.code === l.itemCode);
      if (it && it.type === 'stock') {
        throw new DomainError('BILL_STOCK_ACCOUNT', 'บรรทัดที่ ' + (i + 1) + ' เป็นสินค้าคงคลัง ต้องลงบัญชีสินค้าคงเหลือ',
          'ถ้าเป็นค่าใช้จ่าย ไม่ต้องเลือกสินค้า');
      }
    }
    return l.acc;
  }
  /* ไม่ได้เลือกบัญชีแต่เป็นสินค้านับสต๊อก — ต้องเข้าบัญชีสินค้าคงเหลือ เดิมตกไปค่าใช้จ่ายทั้งที่ของเข้าคลัง ยอดคุมสินค้าจึงไม่ตรง */
  const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
  if (it && it.type === 'stock') return accBySub('inventory');
  if (it && it.expenseAcc && !l.expenseSub && billAccounts().some((a) => a.code === it.expenseAcc)) return it.expenseAcc;
  return defaultAccountFor(l.expenseSub || 'admin_expense');
}
/** บัญชีเงินเดือน — ข้อมูลรุ่นก่อนที่ยังไม่แยกประเภท ใช้ค่าใช้จ่ายบริหารแทน */
function salaryAccount() {
  const a = DB.accounts.find((x) => x.postable && x.subType === 'salary_expense');
  return a ? a.code : accBySub('admin_expense');
}

/* ===================================================================
   ห่อทุกคำสั่งที่เขียนข้อมูลให้เป็นชุดเดียว (ดู atomically ใน engine.js)
   อยู่ท้ายไฟล์เสมอ · เพิ่มคำสั่งใหม่ที่เขียนข้อมูลต้องเพิ่มชื่อในรายการนี้ด้วย · หน้าจอเรียกชื่อเดิมได้เลย
   =================================================================== */
savePartner = transactional(savePartner);
saveItem = transactional(saveItem);
saveAsset = transactional(saveAsset);
saveCompany = transactional(saveCompany);
issueInvoice = transactional(issueInvoice);
receivePayment = transactional(receivePayment);
issueCreditNote = transactional(issueCreditNote);
issueDebitNote = transactional(issueDebitNote);
refundCustomer = transactional(refundCustomer);
/* เอกสารขายแบบเอกสารธุรกิจ (ใบวางบิล/ใบแจ้งหนี้ แก้ใบกำกับ ออกใบกำกับพร้อมรับเงิน แปลงใบเสนอราคา) */
issuePaidInvoice = transactional(issuePaidInvoice);
issueItemBilling = transactional(issueItemBilling);
updateItemBilling = transactional(updateItemBilling);
setBillingNoteStatus = transactional(setBillingNoteStatus);
convertItemBilling = transactional(convertItemBilling);
convertQuotation = transactional(convertQuotation);
resetSalesDoc = transactional(resetSalesDoc);
setInvoiceDelivered = transactional(setInvoiceDelivered);
editInvoice = transactional(editInvoice);
issueTradeDoc = transactional(issueTradeDoc);
setTradeDocStatus = transactional(setTradeDocStatus);
convertTradeDoc = transactional(convertTradeDoc);
updateTradeDoc = transactional(updateTradeDoc);
invoiceSalesOrder = transactional(invoiceSalesOrder);
issueCashSale = transactional(issueCashSale);
deletePartner = transactional(deletePartner);
recordBill = transactional(recordBill);
payBill = transactional(payBill);
runDepreciation = transactional(runDepreciation);
fileVat = transactional(fileVat);
fileWht = transactional(fileWht);
closePeriod = transactional(closePeriod);
reopenPeriod = transactional(reopenPeriod);
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
closeFiscalYear = transactional(closeFiscalYear);
reopenFiscalYear = transactional(reopenFiscalYear);
buildSeed = bulkTransaction(buildSeed);
