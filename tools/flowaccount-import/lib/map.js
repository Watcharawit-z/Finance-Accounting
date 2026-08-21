/* ===================================================================
   แปลงข้อมูล FlowAccount → รูปแบบของระบบเรา
   ทุกฟังก์ชันบริสุทธิ์ ไม่แตะเครือข่าย ไม่แตะดิสก์ จึงทดสอบได้ตรง ๆ
   ค่าคงที่ทั้งหมดอ้างจาก api-spec.openapi.json ของ FlowAccount
   =================================================================== */
const { M, dec, round2, pct, baseFromIncl, validTaxId } = require('./core');

/* ContactTypes: 0=OwnCompany 3=Client 5=Vendor 7=VendorAndClient 9=ExpenseVendor */
const CONTACT_KIND = { 3: 'customer', 5: 'vendor', 7: 'customer', 9: 'vendor' };
/* ContactGroups: 1=Individual 3=Juristic 9=Undefined */
const ENTITY = { 1: 'individual', 3: 'juristic' };
/* ProductTypes: 1=Service 3=ProductWithNoStock 5=ProductWithStock */
const PRODUCT_TYPE = { 1: 'service', 3: 'service', 5: 'stock' };
/* VatTypes: 1=Include 3=Exclude 5=Zero 7=None */
const VAT_TYPE = { 1: 'VAT7', 3: 'VAT7', 5: 'VAT0', 7: 'EXEMPT' };

const s = (v) => String(v === null || v === undefined ? '' : v).trim();
const num = (v) => (v === null || v === undefined || v === '' ? 0 : M(String(v)));

/** "สำนักงานใหญ่" หรือ "00000" หรือ "สาขา 1" → รหัสสาขา 5 หลัก */
function branchCode(branch, code) {
  const c = s(code);
  if (/^\d{1,5}$/.test(c)) return c.padStart(5, '0');
  const b = s(branch);
  if (!b || /สำนักงานใหญ่|head\s*office/i.test(b)) return '00000';
  const digits = b.replace(/\D/g, '');
  return digits ? digits.padStart(5, '0') : '00000';
}

function joinAddress(c) {
  return [c.addressLocal, c.addressLocalLine2, c.addressLocalLine3, c.zipCode]
    .map(s).filter(Boolean).join(' ');
}

function mapContact(c) {
  const warnings = [];
  const taxId = s(c.taxId).replace(/\D/g, '');
  if (taxId && !validTaxId(taxId)) {
    warnings.push({ doc: s(c.code) || s(c.name), message: 'เลขประจำตัวผู้เสียภาษี ' + taxId + ' ไม่ผ่านการตรวจหลักที่ 13' });
  }
  return {
    partner: {
      code: s(c.code) || 'FA-' + c.id,
      name: s(c.name),
      taxId: taxId || null,
      branch: branchCode(c.branch, c.branchCode),
      address: joinAddress(c),
      entityType: ENTITY[c.contactGroup] || 'juristic',
      kind: CONTACT_KIND[c.contactType] || 'customer',
      termDays: Number(c.defaultCreditDays || 0),
    },
    warnings,
  };
}

function mapProduct(p) {
  const type = PRODUCT_TYPE[p.type] || 'service';
  const qty = Number(p.remainingStock !== undefined && p.remainingStock !== null
    ? p.remainingStock : (p.inventoryQuantity || 0));
  return {
    item: {
      code: s(p.code) || 'FA-' + p.id,
      name: s(p.name),
      category: s(p.categoryName) || 'ทั่วไป',
      uom: s(p.unitName) || 'หน่วย',
      type: type,
      avgCost: dec(num(p.averageBuyPrice || p.buyPrice)),
      price: dec(num(p.sellPrice)),
      qty: type === 'stock' ? qty : 0,
    },
    warnings: [],
  };
}

/**
 * เอกสารขาย/ซื้อ → ยอดค้างยกมา
 * ★ ไม่คำนวณ VAT ใหม่เอง — ใช้ตัวเลขที่ FlowAccount ส่งมา แล้ว "ตรวจ" ว่าบวกกันได้จริง
 *   ถ้าไม่ตรง ให้ตกเป็นรายการที่ต้องตรวจมือ ไม่ใช่ดัดตัวเลขให้ลงล็อก
 */
function mapDocument(d, kind) {
  const warnings = [];
  const no = s(d.documentSerial || d.documentNumber || d.recordId || d.id);
  if (!no) return { ok: false, error: { doc: '(ไม่มีเลขที่)', why: 'ไม่พบเลขที่เอกสาร' } };

  let base = num(d.totalAfterDiscount !== undefined ? d.totalAfterDiscount : d.subTotal);
  const vat = num(d.vatAmount);
  const total = num(d.grandTotal);

  if (base + vat !== total) {
    /* ★ ลำดับการตรวจสำคัญมาก — การถอดฐานจากราคารวมภาษีจะ "ลงตัว" เกือบเสมอ
       ถ้าเอามาลองก่อน มันจะกลืนใบที่ยอดรวมเป็นยอดหลังหักภาษี ณ ที่จ่ายไปด้วย
       แล้วได้ฐานภาษีผิดโดยไม่มีใครรู้ จึงต้องเชื่อธง isVatInclusive ก่อน
       แล้วค่อยลองบวกภาษีหัก ณ ที่จ่ายกลับ แล้วจึงเดาว่าเป็นราคารวมภาษีเป็นทางสุดท้าย */
    const wht = num(d.documentWithholdingTaxAmount) + num(d.documentDeductionAmount);
    const derived = baseFromIncl(total, '7');
    const inclusiveFits = derived + round2(pct(derived, '7')) === total;

    if (d.isVatInclusive === true && inclusiveFits) {
      warnings.push({ doc: no, message: 'ราคารวมภาษีแล้ว ถอดฐานภาษีให้เป็น ' + dec(derived) });
      base = derived;
    } else if (wht > 0 && base + vat === total + wht) {
      warnings.push({ doc: no,
        message: 'ยอดรวมในระบบเดิมเป็นยอดหลังหักภาษี ณ ที่จ่าย/หักเงินอื่น '
          + dec(wht) + ' บาท ใช้ยอดก่อนหัก ' + dec(total + wht) + ' เป็นยอดหนี้' });
      /* ★ remainingAmount ที่ระบบเดิมส่งมาก็เป็นยอดหลังหักเช่นกัน
         ถ้าเอาไปลบจากยอดก่อนหัก จะกลายเป็นว่าจ่ายไปแล้วเท่ากับภาษีที่หัก ทั้งที่ยังไม่ได้จ่าย
         จึงต้องคิดยอดที่ชำระแล้วบนฐานเดียวกับที่ระบบเดิมใช้ */
      return finish(no, d, base, vat, total + wht, warnings, kind, total);
    } else if (inclusiveFits) {
      warnings.push({ doc: no, message: 'ราคารวมภาษีแล้ว ถอดฐานภาษีให้เป็น ' + dec(derived) });
      base = derived;
    } else {
      return {
        ok: false,
        error: { doc: no, why: 'ฐาน ' + dec(base) + ' + ภาษี ' + dec(vat) + ' ไม่เท่ากับยอดรวม ' + dec(total) },
      };
    }
  }

  return finish(no, d, base, vat, total, warnings, kind);
}

function finish(no, d, base, vat, total, warnings, kind, paymentBase) {
  const settleOn = paymentBase === undefined ? total : paymentBase;
  const has = (v) => v !== undefined && v !== null && v !== '';
  let paid = 0;
  if (has(d.paidTotal)) paid = num(d.paidTotal);
  else if (has(d.paidAmount)) paid = num(d.paidAmount);
  else if (has(d.remainingAmount)) paid = settleOn - num(d.remainingAmount);
  else {
    warnings.push({ doc: no,
      message: 'ไม่พบยอดที่ชำระแล้วในข้อมูล ตั้งเป็น 0 ให้ — ตรวจกับรายงานอายุลูกหนี้/เจ้าหนี้อีกครั้ง' });
  }
  if (paid < 0) paid = 0;
  if (paid > total) {
    warnings.push({ doc: no, message: 'ยอดที่ชำระแล้วมากกว่ายอดรวม จำกัดไว้ที่ยอดรวม' });
    paid = total;
  }

  const taxId = s(d.contactTaxId).replace(/\D/g, '');
  if (taxId && !validTaxId(taxId)) {
    warnings.push({ doc: no, message: 'เลขประจำตัวผู้เสียภาษีของคู่ค้าไม่ผ่านการตรวจหลักที่ 13' });
  }

  const doc = {
    no: no,
    legacyNo: no,
    date: s(d.publishedOn).slice(0, 10),
    due: s(d.dueDate).slice(0, 10) || s(d.publishedOn).slice(0, 10),
    partnerCode: s(d.contactCode) || null,
    partnerName: s(d.contactName),
    taxId: taxId || null,
    branch: branchCode(d.contactBranch, null),
    address: s(d.contactAddress),
    base: dec(base),
    vat: dec(vat),
    total: dec(total),
    paid: dec(paid),
    whtCode: null,
  };
  if (kind === 'bill') doc.vendorNo = no;
  if (d.documentWithholdingTaxAmount) {
    warnings.push({ doc: no,
      message: 'เอกสารนี้มีภาษีหัก ณ ที่จ่าย ' + dec(num(d.documentWithholdingTaxAmount))
        + ' บาท — ต้องเลือกประเภทเงินได้เองตอนจ่ายชำระในระบบใหม่' });
  }
  return { ok: true, doc, warnings };
}

/* GenderPrefix ของ FlowAccount ไม่มีชื่อกำกับในสเปก จึงใช้ค่าที่ส่งมาตรง ๆ ถ้าเป็นข้อความ */
function mapEmployee(e) {
  const warnings = [];
  const name = [s(e.prefix), s(e.firstName), s(e.lastName)].filter(Boolean).join(' ').trim()
    || s(e.code) || ('พนักงานรหัส ' + e.id);
  const code = s(e.code) || 'EMP-' + e.id;
  const salary = num(e.salary);
  if (salary === 0) {
    warnings.push({ doc: code, message: 'ไม่มีเงินเดือนในข้อมูล ต้องกรอกเองก่อนทำเงินเดือนงวดแรก' });
  }
  const ssPct = Number(e.employeeSocialSecurityRate || 0);
  if (ssPct && ssPct !== 5) {
    warnings.push({ doc: code, message: 'อัตราประกันสังคมในระบบเดิมคือ ' + ssPct
      + '% ระบบใหม่คิดตามกฎหมาย 5% ของค่าจ้างในเพดาน' });
  }
  return {
    employee: {
      code: code,
      name: name,
      dept: s(e.office) || s(e.title) || 'ไม่ระบุ',
      salary: dec(salary),
      hired: s(e.startDate).slice(0, 10) || null,
      active: e.isActive !== false && e.isDelete !== true && !s(e.endDate),
      nationalId: s(e.identitficationNumber).replace(/\D/g, '') || null,
      ssoNumber: s(e.socialSecurityNumber).replace(/\D/g, '') || null,
      otHours: 0, pvdRate: 0, deductions: '0',
    },
    warnings,
  };
}

/** ใบลดหนี้/ใบเพิ่มหนี้อ้างถึงเอกสารเดิมเลขที่ใด */
function referencedSerials(d) {
  const out = [];
  (d.documentReference || []).forEach(function (r) {
    const v = s(r.referenceDocumentSerial);
    if (v) out.push(v);
  });
  const direct = s(d.referenceDocumentSerial || d.reference);
  if (direct) out.push(direct);
  return out;
}

/** ตัดเฉพาะใบที่ยังค้าง ณ วันตัดยอด */
function isOpenAt(doc, cutoff) {
  if (!doc.date || doc.date > cutoff) return false;
  return M(doc.total) - M(doc.paid) > 0;
}

module.exports = {
  CONTACT_KIND, ENTITY, PRODUCT_TYPE, VAT_TYPE,
  branchCode, mapContact, mapProduct, mapDocument, mapEmployee,
  referencedSerials, isOpenAt,
};
