/* ===================================================================
   ระบบรับ–จ่ายชำระ: ส่วนต่างรับ/จ่าย เงินมัดจำรับ/จ่ายล่วงหน้า หักกลบเครดิต หนี้สูญ ใบลดหนี้จากผู้ขาย
   ทุกอย่างเป็นเอกสาร ไม่ใช่ใบสำคัญทั่วไป — ลูกหนี้/เจ้าหนี้รายใบ (อายุหนี้) และทะเบียนภาษีจึงตรงบัญชีคุมเสมอ
   ยอดที่ปิดด้วยเอกสารเหล่านี้เก็บใน settled ของใบกำกับ/รายการตั้งหนี้ และนับซ้ำได้จากเอกสารด้วย settleUpto
   =================================================================== */

/* ---------- ยอดที่ปิดด้วยเอกสารรับ–จ่ายชำระ ณ วันที่ (เรียกจาก settledUpto ใน engine.js) ---------- */
function settleUpto(kind, docNo, asOf) {
  const live = (x) => x.status !== 'void' && x.date <= asOf;
  let v = 0;
  if (kind === 'ar') {
    DB.docs.receipt.forEach((r) => { if (r.invoiceNo === docNo && live(r)) v += r.diff || 0; });
    DB.docs.badDebt.forEach((b) => { if (b.invoiceNo === docNo && live(b)) v += b.amount; });
  } else {
    DB.docs.payment.forEach((p) => { if (p.billNo === docNo && live(p)) v += p.diff || 0; });
    DB.docs.vendorCreditNote.forEach((c) => { if (c.billNo === docNo && live(c)) v += c.total; });
  }
  const own = kind === 'ar' ? 'invoice' : 'bill';
  DB.docs.creditApply.forEach(function (a) {
    if (a.side !== kind || a.mode !== 'apply' || !live(a)) return;
    if (a.targetNo === docNo) v += a.amount;
    if (a.sourceKind === own && a.sourceNo === docNo) v -= a.amount;
  });
  return v;
}

/* ===================================================================
   เงินมัดจำ / รับเงินล่วงหน้า
   รับเงินก่อนส่งมอบสินค้าหรือให้บริการ เป็นจุดความรับผิดภาษีมูลค่าเพิ่ม (ม.78 ม.78/1)
   จึงออกใบกำกับภาษีและเสียภาษีขายของเงินมัดจำตั้งแต่ตอนรับ แล้ว "หักเงินมัดจำ" ในใบกำกับใบสุดท้าย
   ใบสุดท้ายเสียภาษีเฉพาะส่วนที่เหลือ ภาษีจึงไม่ถูกเก็บซ้ำ
   เงินประกันหรือเงินที่ยังไม่ใช่ค่าสินค้า (NONE) และเงินรับเกิน ไม่มีภาษี — ใช้หักกลบกับใบกำกับภายหลังหรือคืนเงิน
   =================================================================== */
const DEPOSIT_TAX = {
  VAT7:   { label:'ภาษีมูลค่าเพิ่ม 7% — ออกใบกำกับภาษีเงินมัดจำ', short:'VAT 7%', bucket:'std' },
  VAT0:   { label:'อัตราร้อยละ 0 (ส่งออก)', short:'อัตรา 0%', bucket:'zero' },
  EXEMPT: { label:'ยกเว้นภาษี', short:'ยกเว้น', bucket:'exempt' },
  NONE:   { label:'เงินประกัน/รับไว้ก่อน ยังไม่ใช่ค่าสินค้า — ไม่มีภาษี', short:'ไม่มีภาษี', bucket:null },
};
/** มูลค่า (ก่อนภาษี) ที่ยังไม่ได้หักหรือคืน */
const depositLeft = (d) => (d.status === 'void' ? 0 : d.base - (d.applied || 0) - (d.refunded || 0));
const depositVatLeft = (d) => (d.status === 'void' ? 0 : d.vat - (d.appliedVat || 0) - (d.refundedVat || 0));
/** หักในใบกำกับ/ตั้งหนี้ใบสุดท้ายได้ = เงินมัดจำที่ออกใบกำกับ (มีภาษีหรืออัตรา 0/ยกเว้น) · ที่เหลือใช้หักกลบเป็นการชำระหนี้ */
const depositTaxable = (d) => !!(DEPOSIT_TAX[d.taxCode] || {}).bucket;
const givenStr = (x) => x !== undefined && x !== null && String(x).trim() !== '';

function depositFind(side, no) {
  const d = (side === 'ar' ? DB.docs.customerDeposit : DB.docs.vendorDeposit).find((x) => x.no === no);
  if (!d) throw new DomainError('DEPOSIT_NOT_FOUND', 'ไม่พบ' + (side === 'ar' ? 'เงินมัดจำรับ ' : 'เงินมัดจำจ่าย ') + no);
  return d;
}

/**
 * หักเงินมัดจำในเอกสารใบสุดท้าย — issueInvoice (ar) และ recordBill (ap) เรียกหลังคำนวณยอดของเอกสารแล้ว
 * picks = [{ no, base }] base เป็นข้อความเหมือนจำนวนเงินอื่น เว้นว่าง = หักที่เหลือทั้งหมด
 * ปรับ v ในที่: ลดมูลค่าช่องภาษีของเงินมัดจำ แล้วคิดภาษีใหม่จากมูลค่าที่เหลือ ตามอัตรา ณ วันที่ของเอกสาร
 * คืนบรรทัดบัญชี (Dr เงินมัดจำรับ / Cr เงินมัดจำจ่าย) และฟิลด์ที่เก็บไว้ในเอกสาร
 */
function depositDeduction(side, partnerCode, picks, v, date) {
  const rows = [];
  const seen = {};
  let vatRecalc = false;
  (picks || []).forEach(function (pk) {
    const d = depositFind(side, pk.no);
    if (d.status === 'void') throw new DomainError('DEPOSIT_VOID', 'เงินมัดจำ ' + d.no + ' ถูกยกเลิกไปแล้ว');
    if (seen[d.no]) throw new DomainError('DEPOSIT_DUPLICATE', 'เลือกเงินมัดจำ ' + d.no + ' ซ้ำ');
    seen[d.no] = true;
    if (d.partnerCode !== partnerCode) {
      throw new DomainError('DEPOSIT_PARTNER_MISMATCH', 'เงินมัดจำ ' + d.no + ' เป็นของ ' + d.partnerName + ' หักในเอกสารของรายอื่นไม่ได้');
    }
    if (!depositTaxable(d)) {
      throw new DomainError('DEPOSIT_NOT_TAXABLE', 'เงินมัดจำ ' + d.no + ' ไม่ได้ออกใบกำกับภาษีตอนรับ/จ่าย หักเป็นมูลค่าในเอกสารไม่ได้',
        'บันทึกเอกสารตามปกติ แล้วกดหักกลบเครดิตที่หน้าเอกสาร ภาษีจะคิดเต็มมูลค่าในใบนี้');
    }
    if (d.date > date) {
      throw new DomainError('DEPOSIT_AFTER_DOC', 'เงินมัดจำ ' + d.no + ' ลงวันที่ ' + thDate(d.date) + ' หลังวันที่เอกสารนี้');
    }
    const left = depositLeft(d);
    const amt = givenStr(pk.base) ? M(pk.base) : left;
    if (amt <= 0 || amt > left) {
      throw new DomainError('DEPOSIT_EXCEEDS', 'หักเงินมัดจำ ' + d.no + ' ได้ไม่เกินที่เหลือ ' + fmt(left) + ' บาท (ก่อนภาษี)');
    }
    const b = DEPOSIT_TAX[d.taxCode].bucket;
    if (amt > v[b]) {
      throw new DomainError('DEPOSIT_EXCEEDS_DOC', 'มูลค่าเงินมัดจำที่หัก ' + fmt(amt) + ' เกินมูลค่ารายการ' + DEPOSIT_TAX[d.taxCode].short
        + ' ในเอกสารนี้ ' + fmt(v[b]) + ' บาท', 'เงินมัดจำหักได้เฉพาะรายการที่อัตราภาษีเดียวกับตอนรับเงินมัดจำ');
    }
    v[b] -= amt;
    if (b === 'std') vatRecalc = true;
    /* ภาษีของเงินมัดจำส่วนที่ใช้ไป — ครั้งสุดท้ายรับส่วนที่เหลือทั้งหมด ผลรวมจึงเท่าภาษีในใบกำกับเงินมัดจำพอดี */
    const vat = amt === left ? depositVatLeft(d) : round2(mulDiv(d.vat, amt, d.base));
    d.applied = (d.applied || 0) + amt;
    d.appliedVat = (d.appliedVat || 0) + vat;
    rows.push({ no: d.no, date: d.date, base: amt, vat, taxCode: d.taxCode, acc: d.acc });
  });
  if (vatRecalc) v.vat = round2(pct(v.std, resolveRate('VAT7', date).rate));
  v.total = v.std + v.zero + v.exempt + v.vat;
  const byAcc = {};
  rows.forEach((r) => { byAcc[r.acc] = (byAcc[r.acc] || 0) + r.base; });
  const memo = 'หักเงินมัดจำ ' + rows.map((r) => r.no).join(', ');
  const lines = Object.keys(byAcc).map((a) => (side === 'ar'
    ? { acc: a, dr: byAcc[a], partner: partnerCode, memo }
    : { acc: a, cr: byAcc[a], partner: partnerCode, memo }));
  return { lines, fields: { deposits: rows, depositBase: rows.reduce((s, r) => s + r.base, 0),
    depositVat: rows.reduce((s, r) => s + r.vat, 0) } };
}

/** ภาษีหัก ณ ที่จ่ายของเงินมัดจำ — ลูกค้าหักเรา (รับ) หรือเราหักผู้ขาย (จ่าย) จากค่าบริการที่จ่ายล่วงหน้า */
function depositWht(input, base, total, channel) {
  if (!input.whtCode) return { wht: 0, rate: null, base: 0, label: null };
  const r = resolveRate(input.whtCode, input.date, { channel: channel || 'manual' });
  const whtBase = givenStr(input.whtBase) ? M(input.whtBase) : base;
  if (whtBase <= 0 || whtBase > total) {
    throw new DomainError('WHT_BASE_INVALID', 'ฐานภาษีหัก ณ ที่จ่าย ' + fmt(whtBase) + ' ต้องมากกว่าศูนย์และไม่เกินยอด ' + fmt(total),
      'ฐานคือค่าบริการก่อนภาษีมูลค่าเพิ่ม');
  }
  return { wht: round2(pct(whtBase, r.rate)), rate: r.rate, base: whtBase, label: r.label };
}

/* ---------- รับเงินมัดจำ / รับเงินล่วงหน้าจากลูกค้า ----------
   Dr เงินสด/ธนาคาร (สุทธิ) · Dr ภาษีถูกหัก ณ ที่จ่าย / Cr เงินมัดจำรับ (รายลูกค้า) · Cr ภาษีขาย */
function receiveCustomerDeposit(input) {
  const p = partnerByCode(input.partnerCode);
  if (!isCustomer(p)) {
    throw new DomainError('PARTNER_WRONG_SIDE', 'เงินมัดจำรับต้องเป็นของลูกค้า แต่ ' + p.name + ' อยู่ในทะเบียนผู้ขาย');
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่รับเงิน');
  const code = input.taxCode || 'VAT7';
  if (!DEPOSIT_TAX[code]) throw new DomainError('DEPOSIT_TAX_INVALID', 'ไม่รู้จักประเภทภาษีของเงินมัดจำ ' + code);
  const base = M(input.base);
  if (base <= 0) throw new DomainError('DEPOSIT_ZERO', 'จำนวนเงินมัดจำต้องมากกว่าศูนย์');
  const desc = String(input.desc || '').trim() || 'รับเงินมัดจำค่าสินค้า/บริการ';
  const snap = snapshotPartner(p);
  /* ใบกำกับภาษีของเงินมัดจำต้องครบตามมาตรา 86/4 เหมือนใบกำกับปกติ */
  if (code === 'VAT7') assertTaxInvoiceComplete(snap, [{ desc }]);
  const vat = code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', input.date).rate)) : 0;
  const total = base + vat;
  const w = depositWht(input, base, total, 'manual');
  const net = total - w.wht;
  const bank = cashAccount(input.bankAccount, 'บัญชีที่รับเงิน');
  const depAcc = ensureAccount('customer_deposit', '2161', 'เงินมัดจำรับจากลูกค้า', 'liability');
  assertPostingOpen(input.date);
  const no = nextNo('customerDeposit', input.date);
  const je = post({
    type: 'receipt', date: input.date,
    desc: 'รับเงินมัดจำจาก ' + p.name + ' (' + no + ')',
    src: 'customerDeposit', srcId: no,
    lines: [{ acc: bank, dr: net }]
      .concat(w.wht ? [{ acc: accBySub('wht_asset'), dr: w.wht }] : [])
      .concat([{ acc: depAcc, cr: base, partner: p.code, memo: desc }])
      .concat(vat ? [{ acc: accBySub('output_vat'), cr: vat }] : []),
  });
  if (code !== 'NONE') {
    DB.taxTx.push({
      kind: 'vat_output', period: periodOf(input.date), date: input.date,
      docNo: no, docType: 'tax_invoice', partnerName: snap.name, taxId: snap.taxId, branch: snap.branch,
      base: code === 'VAT7' ? base : 0, zero: code === 'VAT0' ? base : 0, exempt: code === 'EXEMPT' ? base : 0,
      tax: vat, entryNo: je.no, filingId: null, srcDoc: 'customerDeposit|' + no,
    });
  }
  const doc = {
    no, kind: 'deposit', date: input.date, partnerCode: p.code, partnerName: p.name, snap,
    desc, ref: String(input.ref || '').trim(), taxCode: code, base, vat, total,
    wht: w.wht, whtRate: w.rate, whtBase: w.base, net, bankAccount: bank, method: input.method || 'transfer',
    acc: depAcc, applied: 0, appliedVat: 0, refunded: 0, refundedVat: 0,
    note: input.note || '', entryNo: je.no, status: 'open',
  };
  DB.docs.customerDeposit.unshift(doc);
  audit('customerDeposit', no, 'create', null, { partner: p.name, total: fmt(total), vat: fmt(vat) });
  return doc;
}

/* ---------- จ่ายเงินมัดจำ / จ่ายล่วงหน้าให้ผู้ขาย ----------
   Dr เงินมัดจำจ่าย (รายผู้ขาย) · Dr ภาษีซื้อ (ถ้าผู้ขายออกใบกำกับภาษีให้) / Cr ภาษีหัก ณ ที่จ่ายค้างนำส่ง · Cr เงินสด/ธนาคาร */
function payVendorDeposit(input) {
  const p = partnerByCode(input.partnerCode);
  if (!isVendor(p)) {
    throw new DomainError('PARTNER_WRONG_SIDE', 'เงินมัดจำจ่ายต้องเป็นของผู้ขาย แต่ ' + p.name + ' อยู่ในทะเบียนลูกค้า');
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่จ่าย');
  const code = input.taxCode === 'VAT7' ? 'VAT7' : 'NONE';
  const base = M(input.base);
  if (base <= 0) throw new DomainError('DEPOSIT_ZERO', 'จำนวนเงินมัดจำต้องมากกว่าศูนย์');
  const vendorNo = String(input.vendorNo || '').trim();
  if (code === 'VAT7' && !vendorNo) {
    throw new DomainError('TAX_INVOICE_NO_REQUIRED', 'มีภาษีซื้อที่จะขอคืน ต้องกรอกเลขที่ใบกำกับภาษีที่ผู้ขายออกให้สำหรับเงินมัดจำ',
      'ถ้าผู้ขายไม่ได้ออกใบกำกับภาษี เลือก "ไม่มีใบกำกับภาษี" ภาษีจะไปขอคืนในใบกำกับใบสุดท้ายแทน');
  }
  if (vendorNo) assertVendorInvoiceUnused(p.code, vendorNo);
  const desc = String(input.desc || '').trim() || 'จ่ายเงินมัดจำค่าสินค้า/บริการ';
  const vat = code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', input.date).rate)) : 0;
  const total = base + vat;
  const channel = input.channel === 'e_wht' ? 'e_wht' : 'manual';
  /* จ่ายครั้งหนึ่งต่ำกว่า 1,000 บาทไม่ต้องหัก (ท.ป.4/2528) */
  const w = base >= M('1000') ? depositWht(input, base, total, channel) : { wht: 0, rate: null, base: 0, label: null };
  if (w.wht > 0 && !validTaxId(p.taxId || '')) {
    throw new DomainError('WHT_PAYEE_TAX_ID',
      'ผู้รับเงิน ' + p.name + ' ยังไม่มีเลขประจำตัวผู้เสียภาษีที่ถูกต้อง ออกหนังสือรับรองหัก ณ ที่จ่ายไม่ได้',
      'เพิ่มเลขประจำตัวผู้เสียภาษีในทะเบียนผู้ขายก่อน');
  }
  const net = total - w.wht;
  const bank = cashAccount(input.bankAccount, 'บัญชีที่จ่ายเงิน');
  const depAcc = ensureAccount('deposit_paid', '1180', 'เงินมัดจำและเงินประกันจ่าย', 'asset');
  const individual = p.entityType === 'individual';
  assertPostingOpen(input.date);
  const no = nextNo('vendorDeposit', input.date);
  const je = post({
    type: 'payment', date: input.date,
    desc: 'จ่ายเงินมัดจำ ' + p.name + ' (' + no + ')',
    src: 'vendorDeposit', srcId: no,
    lines: [{ acc: depAcc, dr: base, partner: p.code, memo: desc }]
      .concat(vat ? [{ acc: accBySub('input_vat'), dr: vat }] : [])
      .concat(w.wht && channel === 'manual' ? [{ acc: accBySub(individual ? 'wht_payable_pnd3' : 'wht_payable_pnd53'), cr: w.wht }] : [])
      .concat([{ acc: bank, cr: net, memo: w.wht ? 'จ่ายผู้รับเงินสุทธิ' : null }])
      .concat(w.wht && channel === 'e_wht' ? [{ acc: bank, cr: w.wht, memo: 'ภาษีหัก ณ ที่จ่ายที่ธนาคารนำส่งผ่าน e-Withholding Tax' }] : []),
  });
  const srcDoc = 'vendorDeposit|' + no;
  if (vat) {
    DB.taxTx.push({
      kind: 'vat_input', period: periodOf(input.date), date: input.date,
      docNo: vendorNo, docType: 'tax_invoice', partnerName: p.name, taxId: p.taxId, branch: p.branch,
      base, zero: 0, exempt: 0, tax: vat, nonClaimable: 0, entryNo: je.no, filingId: null, srcDoc,
    });
  }
  let certNo = null;
  if (w.wht > 0) {
    if (channel === 'manual') {
      certNo = nextNo('whtCert', input.date);
      DB.docs.whtCert.unshift({
        no: certNo, date: input.date, partnerCode: p.code, partnerName: p.name, taxId: p.taxId,
        form: individual ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53', incomeType: w.label, base: w.base, wht: w.wht, rate: w.rate,
        sent: false, paymentNo: null, depositNo: no,
      });
    }
    DB.taxTx.push({
      kind: 'wht', period: periodOf(input.date), date: input.date, docNo: no, docType: 'vendorDeposit',
      partnerName: p.name, taxId: p.taxId, branch: p.branch, entityType: p.entityType,
      base: w.base, tax: w.wht, rate: w.rate, channel, incomeType: w.label,
      form: individual ? 'PND3' : 'PND53', certNo, entryNo: je.no, filingId: null, srcDoc,
    });
  }
  const doc = {
    no, date: input.date, partnerCode: p.code, partnerName: p.name, vendorNo: vendorNo || null, desc,
    taxCode: code, base, vat, total, whtCode: w.wht ? input.whtCode : null, wht: w.wht, whtRate: w.rate, whtBase: w.base,
    channel, certNo, net, bankAccount: bank, method: input.method || 'transfer', acc: depAcc,
    applied: 0, appliedVat: 0, refunded: 0, refundedVat: 0, note: input.note || '', entryNo: je.no, status: 'open',
  };
  DB.docs.vendorDeposit.unshift(doc);
  audit('vendorDeposit', no, 'create', null, { partner: p.name, total: fmt(total), wht: fmt(w.wht), cert: certNo });
  return doc;
}

/* ---------- เงินมัดจำที่อยู่ในบัญชีแล้วแต่ไม่มีเอกสารรายใบ ----------
   ยอดยกมาจากระบบเดิม หรือลงด้วยใบสำคัญ/ค่าใช้จ่ายก่อนมีระบบนี้ — ไม่มีใบให้หักกับใบกำกับ/รายการตั้งหนี้ได้เลย
   ตั้งเป็นรายใบโดยไม่ลงบัญชีซ้ำ (ยอดอยู่ในบัญชีแล้ว) แบบเดียวกับแยกยอดสินค้ายกมาเป็นรายตัว */
function depositUnallocated(side) {
  const gl = side === 'ar' ? -balBySub(['customer_deposit']) : balBySub(['deposit_paid']);
  const docs = side === 'ar' ? DB.docs.customerDeposit : DB.docs.vendorDeposit;
  return gl - docs.reduce((t, d) => t + depositLeft(d), 0);
}
function registerDepositBalance(side, input) {
  const ar = side === 'ar';
  const p = partnerByCode(input.partnerCode);
  if (!(ar ? isCustomer(p) : isVendor(p))) {
    throw new DomainError('PARTNER_WRONG_SIDE', p.name + ' ไม่ได้อยู่ในทะเบียน' + (ar ? 'ลูกค้า' : 'ผู้ขาย'));
  }
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ของยอดยกมา');
  const code = input.taxCode || 'NONE';
  if (!DEPOSIT_TAX[code] || (!ar && code !== 'VAT7' && code !== 'NONE')) {
    throw new DomainError('DEPOSIT_TAX_INVALID', 'ไม่รู้จักประเภทภาษีของเงินมัดจำ ' + code);
  }
  const base = M(input.base);
  if (base <= 0) throw new DomainError('DEPOSIT_ZERO', 'จำนวนเงินมัดจำต้องมากกว่าศูนย์');
  const free = depositUnallocated(side);
  if (base > free) {
    throw new DomainError('DEPOSIT_NO_BALANCE', 'บัญชีเงินมัดจำ' + (ar ? 'รับ' : 'จ่าย') + 'มียอดที่ยังไม่มีรายใบเหลือ ' + fmt(Math.max(0, free)) + ' บาท',
      'ตั้งยอดรายใบได้ไม่เกินยอดในบัญชีที่ยังไม่มีเอกสารรองรับ · เงินมัดจำใหม่ให้บันทึกรับ/จ่ายเงินมัดจำตามปกติ');
  }
  const vat = givenStr(input.vat) ? M(input.vat) : (code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', input.date).rate)) : 0);
  const no = nextNo(ar ? 'customerDeposit' : 'vendorDeposit', input.date);
  const doc = {
    no, kind: 'opening', broughtForward: true, date: input.date, partnerCode: p.code, partnerName: p.name,
    snap: ar ? snapshotPartner(p) : undefined, vendorNo: ar ? undefined : (String(input.vendorNo || '').trim() || null),
    desc: String(input.desc || '').trim() || 'เงินมัดจำยกมา', taxCode: code, base, vat, total: base + vat,
    wht: 0, whtRate: null, whtBase: 0, net: 0, bankAccount: null,
    acc: ar ? ensureAccount('customer_deposit', '2161', 'เงินมัดจำรับจากลูกค้า', 'liability')
      : ensureAccount('deposit_paid', '1180', 'เงินมัดจำและเงินประกันจ่าย', 'asset'),
    applied: 0, appliedVat: 0, refunded: 0, refundedVat: 0, note: input.note || '', entryNo: null, status: 'open',
  };
  (ar ? DB.docs.customerDeposit : DB.docs.vendorDeposit).unshift(doc);
  audit(ar ? 'customerDeposit' : 'vendorDeposit', no, 'opening', null, { partner: p.name, base: fmt(base) },
    'ตั้งเงินมัดจำที่อยู่ในบัญชีแล้วเป็นรายใบ ไม่ลงบัญชีซ้ำ');
  return doc;
}
/** ยกเลิกยอดยกมารายใบที่ตั้งผิด — ไม่มีใบสำคัญให้กลับรายการ ยอดกลับไปเป็นยอดในบัญชีที่ยังไม่มีรายใบ */
function cancelDepositBalance(side, no, reason) {
  const d = depositFind(side, no);
  if (!d.broughtForward) throw new DomainError('VOID_KIND_UNKNOWN', d.no + ' ไม่ใช่ยอดยกมา ให้ยกเลิกด้วยปุ่มยกเลิกเอกสาร');
  if (d.status === 'void') throw new DomainError('ALREADY_VOID', d.no + ' ยกเลิกไปแล้ว');
  if (!reason || String(reason).trim().length < 5) throw new DomainError('REASON_REQUIRED', 'ต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  if ((d.applied || 0) + (d.refunded || 0) > 0) {
    throw new DomainError('VOID_HAS_DEPENDENTS', 'เงินมัดจำ ' + d.no + ' ถูกหักหรือคืนไปแล้ว ยกเลิกไม่ได้', 'ยกเลิกเอกสารที่ใช้เงินมัดจำนี้ก่อน');
  }
  d.status = 'void';
  d.voidReason = String(reason).trim();
  d.voidedAt = new Date().toISOString();
  audit(side === 'ar' ? 'customerDeposit' : 'vendorDeposit', no, 'void', { status: 'open' }, { status: 'void' }, d.voidReason);
  return d;
}

/* ===================================================================
   เครดิตของลูกค้า/ผู้ขาย และการหักกลบ
   เครดิตเกิดจาก: ใบกำกับที่ลดหนี้หลังรับเงินครบ (ยอดติดลบ) · เงินรับเกิน · เงินมัดจำที่ไม่มีภาษี
   หักกลบกับใบกำกับ/รายการตั้งหนี้อีกใบของรายเดียวกันได้ ไม่ต้องคืนเงินแล้วรับใหม่
   =================================================================== */
/** แหล่งเครดิตที่ใช้หักกลบได้ของคู่ค้ารายนี้ */
function creditSources(side, partnerCode) {
  const out = [];
  if (side === 'ar') {
    DB.docs.invoice.forEach(function (d) {
      if (d.partnerCode !== partnerCode || d.status === 'void') return;
      const o = invOutstanding(d);
      if (o < 0) out.push({ kind: 'invoice', no: d.no, date: d.date, left: -o, label: 'เครดิตจากใบกำกับ ' + d.no + ' (ลดหนี้หลังรับเงินครบ)' });
    });
    DB.docs.customerDeposit.forEach(function (d) {
      if (d.partnerCode !== partnerCode || depositTaxable(d) || depositLeft(d) <= 0) return;
      out.push({ kind: 'deposit', no: d.no, date: d.date, left: depositLeft(d),
        label: (d.kind === 'overpay' ? 'เงินรับเกินตามใบเสร็จ ' : 'เงินรับล่วงหน้า ') + d.no });
    });
  } else {
    DB.docs.bill.forEach(function (d) {
      if (d.partnerCode !== partnerCode || d.status === 'void') return;
      const o = billOutstanding(d);
      if (o < 0) out.push({ kind: 'bill', no: d.no, date: d.date, left: -o, label: 'เครดิตจากรายการตั้งหนี้ ' + d.no + ' (ลดหนี้หลังจ่ายครบ)' });
    });
    DB.docs.vendorDeposit.forEach(function (d) {
      if (d.partnerCode !== partnerCode || depositTaxable(d) || depositLeft(d) <= 0) return;
      out.push({ kind: 'deposit', no: d.no, date: d.date, left: depositLeft(d), label: 'เงินมัดจำจ่าย ' + d.no });
    });
  }
  return out;
}

/** หักกลบเครดิตกับใบกำกับ (ar) หรือรายการตั้งหนี้ (ap) ที่ยังค้าง */
function applyCredit(side, input) {
  const ar = side === 'ar';
  const target = (ar ? DB.docs.invoice : DB.docs.bill).find((d) => d.no === input.targetNo);
  if (!target) throw new DomainError('DOC_NOT_FOUND', 'ไม่พบ' + (ar ? 'ใบกำกับภาษี ' : 'รายการตั้งหนี้ ') + input.targetNo);
  if (target.status === 'void') throw new DomainError('DOC_VOID', target.no + ' ถูกยกเลิกไปแล้ว');
  const out = ar ? invOutstanding(target) : billOutstanding(target);
  if (out <= 0) throw new DomainError('ALREADY_PAID', target.no + ' ไม่มียอดค้าง' + (ar ? 'รับ' : 'จ่าย') + 'แล้ว');
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่หักกลบ');
  if (input.date < target.date) {
    throw new DomainError('CREDIT_BEFORE_DOC', 'วันที่หักกลบ (' + thDate(input.date) + ') ก่อนวันที่ของ ' + target.no);
  }
  const src = creditSources(side, target.partnerCode).find((x) => x.no === input.sourceNo);
  if (!src) {
    throw new DomainError('CREDIT_SOURCE_NOT_FOUND', 'ไม่พบเครดิต ' + input.sourceNo + ' ของ' + (ar ? 'ลูกค้า' : 'ผู้ขาย') + 'รายนี้ที่ยังใช้ได้',
      'เครดิตต้องเป็นของรายเดียวกัน และยังมียอดเหลือ · เงินมัดจำที่ออกใบกำกับภาษีไว้ ให้หักในใบกำกับ/ตั้งหนี้ใบสุดท้ายแทน');
  }
  if (src.no === target.no) throw new DomainError('CREDIT_SAME_DOC', 'หักกลบเครดิตกับเอกสารใบเดียวกันไม่ได้');
  if (input.date < src.date) {
    throw new DomainError('CREDIT_BEFORE_SOURCE', 'วันที่หักกลบ (' + thDate(input.date) + ') ก่อนวันที่เกิดเครดิต ' + src.no + ' (' + thDate(src.date) + ')');
  }
  const amount = givenStr(input.amount) ? M(input.amount) : Math.min(src.left, out);
  if (amount <= 0 || amount > src.left || amount > out) {
    throw new DomainError('CREDIT_EXCEEDS', 'ยอดหักกลบ ' + fmt(amount) + ' ต้องมากกว่าศูนย์ ไม่เกินเครดิต ' + fmt(src.left)
      + ' และไม่เกินยอดค้าง ' + fmt(out));
  }
  const ctl = accBySub(ar ? 'trade_receivable' : 'trade_payable');
  const p = target.partnerCode;
  const dep = src.kind === 'deposit' ? depositFind(side, src.no) : null;
  const srcDoc = dep ? null : (ar ? DB.docs.invoice : DB.docs.bill).find((d) => d.no === src.no);
  /* ภาษีหัก ณ ที่จ่ายของรายการตั้งหนี้: ส่วนที่หักกลบด้วยเงินมัดจำที่หักภาษีไว้แล้ว ไม่ต้องหักซ้ำตอนจ่ายส่วนที่เหลือ */
  let baseShare = 0;
  if (!ar) {
    const sh = billWhtFor(target, amount, input.date, 'manual', null).share;
    baseShare = dep && dep.wht ? Math.min(amount, billWhtFor(target, out, input.date, 'manual', null).share) : sh;
  }
  assertPostingOpen(input.date);
  const no = nextNo('creditApply', input.date);
  const settleLine = ar ? { acc: ctl, cr: amount, partner: p, memo: 'ชำระ ' + target.no + ' ด้วยเครดิต ' + src.no }
    : { acc: ctl, dr: amount, partner: p, memo: 'ชำระ ' + target.no + ' ด้วยเครดิต ' + src.no };
  const useLine = dep
    ? (ar ? { acc: dep.acc, dr: amount, partner: p, memo: 'ใช้' + src.label } : { acc: dep.acc, cr: amount, partner: p, memo: 'ใช้' + src.label })
    : (ar ? { acc: ctl, dr: amount, partner: p, memo: 'ใช้' + src.label } : { acc: ctl, cr: amount, partner: p, memo: 'ใช้' + src.label });
  const je = post({
    type: 'general', date: input.date,
    desc: 'หักกลบเครดิต ' + target.partnerName + ' ' + src.no + ' → ' + target.no + ' (' + no + ')',
    src: 'creditApply', srcId: no,
    lines: ar ? [useLine, settleLine] : [settleLine, useLine],
  });
  target.settled = (target.settled || 0) + amount;
  if (dep) dep.applied = (dep.applied || 0) + amount;
  else srcDoc.settled = (srcDoc.settled || 0) - amount;
  if (ar) { syncInvStatus(target); if (srcDoc) syncInvStatus(srcDoc); }
  else { syncBillStatus(target); if (srcDoc) syncBillStatus(srcDoc); }
  const doc = {
    no, side, mode: 'apply', date: input.date, partnerCode: p, partnerName: target.partnerName,
    sourceKind: src.kind, sourceNo: src.no, sourceLabel: src.label, targetNo: target.no, amount, baseShare,
    note: input.note || '', entryNo: je.no, status: 'posted',
  };
  DB.docs.creditApply.unshift(doc);
  audit('creditApply', no, 'apply', null, { from: src.no, to: target.no, amount: fmt(amount) });
  return doc;
}
const applyCustomerCredit = (input) => applyCredit('ar', input);
const applyVendorCredit = (input) => applyCredit('ap', input);

/* ---------- คืนเงินมัดจำ / เงินรับเกินให้ลูกค้า ----------
   เงินมัดจำที่ออกใบกำกับภาษีไว้ คืนเมื่อบอกเลิกสัญญา ต้องลดภาษีขายด้วย (ใบลดหนี้ ม.86/10) ในเดือนที่คืน */
function refundCustomerCredit(input) {
  const d = depositFind('ar', input.sourceNo);
  if (d.status === 'void') throw new DomainError('DEPOSIT_VOID', 'เงินมัดจำ ' + d.no + ' ถูกยกเลิกไปแล้ว');
  const left = depositLeft(d);
  if (left <= 0) throw new DomainError('NO_CREDIT_BALANCE', d.no + ' ไม่มียอดเหลือให้คืน');
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่คืนเงิน');
  if (input.date < d.date) throw new DomainError('REFUND_BEFORE_DEPOSIT', 'วันที่คืนเงินก่อนวันที่รับเงิน ' + d.no);
  const amount = givenStr(input.amount) ? M(input.amount) : left;
  if (amount <= 0 || amount > left) {
    throw new DomainError('REFUND_EXCEEDS', 'ยอดคืน ' + fmt(amount) + ' ต้องมากกว่าศูนย์และไม่เกินยอดเหลือ ' + fmt(left) + ' (ก่อนภาษี)');
  }
  const vat = amount === left ? depositVatLeft(d) : round2(mulDiv(d.vat, amount, d.base));
  const cash = amount + vat;
  const bank = cashAccount(input.bankAccount, 'บัญชีที่จ่ายคืน');
  assertPostingOpen(input.date);
  const no = nextNo('creditApply', input.date);
  const je = post({
    type: 'payment', date: input.date,
    desc: 'คืนเงิน' + (d.kind === 'overpay' ? 'รับเกิน' : 'มัดจำ') + 'ให้ ' + d.partnerName + ' อ้าง ' + d.no + ' (' + no + ')',
    src: 'creditApply', srcId: no,
    lines: [{ acc: d.acc || accBySub('customer_deposit'), dr: amount, partner: d.partnerCode, memo: 'คืน ' + d.no }]
      .concat(vat ? [{ acc: accBySub('output_vat'), dr: vat, memo: 'ลดภาษีขายของเงินมัดจำที่คืน' }] : [])
      .concat([{ acc: bank, cr: cash }]),
  });
  if (depositTaxable(d)) {
    DB.taxTx.push({
      kind: 'vat_output', period: periodOf(input.date), date: input.date,
      docNo: no, docType: 'credit_note', refDoc: d.no,
      partnerName: d.snap ? d.snap.name : d.partnerName, taxId: d.snap ? d.snap.taxId : null, branch: d.snap ? d.snap.branch : null,
      base: d.taxCode === 'VAT7' ? -amount : 0, zero: d.taxCode === 'VAT0' ? -amount : 0, exempt: d.taxCode === 'EXEMPT' ? -amount : 0,
      tax: -vat, entryNo: je.no, filingId: null, srcDoc: 'creditApply|' + no,
    });
  }
  d.refunded = (d.refunded || 0) + amount;
  d.refundedVat = (d.refundedVat || 0) + vat;
  const doc = {
    no, side: 'ar', mode: 'refund', date: input.date, partnerCode: d.partnerCode, partnerName: d.partnerName,
    sourceKind: 'deposit', sourceNo: d.no, sourceLabel: (d.kind === 'overpay' ? 'เงินรับเกิน ' : 'เงินมัดจำ ') + d.no,
    targetNo: null, amount, vat, cash, bankAccount: bank, method: input.method || 'transfer',
    reasonText: depositTaxable(d) ? CN_REASONS.CANCEL_CONTRACT : null,
    note: input.note || '', entryNo: je.no, status: 'posted',
  };
  DB.docs.creditApply.unshift(doc);
  audit('creditApply', no, 'refund', null, { from: d.no, cash: fmt(cash) });
  return doc;
}

/* ===================================================================
   ตัดหนี้สูญ — ยอดคงค้างทั้งหมดของใบกำกับ (รวมภาษี) ภาษีขายเดิมไม่ถูกแตะ
   ตัดเป็นค่าใช้จ่ายหนี้สูญโดยตรง หรือตัดกับค่าเผื่อหนี้สงสัยจะสูญที่ตั้งไว้แล้ว
   การตัดหนี้สูญทางภาษีต้องผ่านเงื่อนไขกฎกระทรวงฉบับที่ 186 (ทวงถาม ฟ้องร้อง) — เก็บหลักฐานไว้กับเอกสารนี้
   =================================================================== */
const BAD_DEBT_METHOD = {
  expense:   { label:'ตัดเป็นหนี้สูญ (ค่าใช้จ่าย)', acc: () => ensureAccount('bad_debt', '5351', 'หนี้สูญและหนี้สงสัยจะสูญ', 'expense') },
  allowance: { label:'ตัดกับค่าเผื่อหนี้สงสัยจะสูญที่ตั้งไว้', acc: () => ensureAccount('ar_allowance', '1139', 'ค่าเผื่อผลขาดทุนด้านเครดิต', 'asset') },
};
function writeOffBadDebt(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + input.invoiceNo);
  if (inv.status === 'void') throw new DomainError('INVOICE_VOID', 'ใบกำกับ ' + inv.no + ' ถูกยกเลิกไปแล้ว');
  const out = invOutstanding(inv);
  if (out <= 0) throw new DomainError('ALREADY_PAID', 'ใบกำกับ ' + inv.no + ' ไม่มียอดค้างให้ตัดหนี้สูญ');
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ตัดหนี้สูญ');
  if (input.date < inv.date) throw new DomainError('WRITEOFF_BEFORE_INVOICE', 'วันที่ตัดหนี้สูญก่อนวันที่ใบกำกับ');
  const m = BAD_DEBT_METHOD[input.method || 'expense'];
  if (!m) throw new DomainError('WRITEOFF_METHOD_INVALID', 'ไม่รู้จักวิธีตัดหนี้สูญ ' + input.method);
  const reason = String(input.reason || '').trim();
  if (reason.length < 5) {
    throw new DomainError('REASON_REQUIRED', 'ต้องระบุเหตุผลและหลักฐานการติดตามหนี้ อย่างน้อย 5 ตัวอักษร',
      'เช่น ทวงถามเป็นหนังสือแล้ว ลูกหนี้ปิดกิจการ — ผู้สอบบัญชีและสรรพากรจะขอดู');
  }
  const a = m.acc();
  assertPostingOpen(input.date);
  const no = nextNo('badDebt', input.date);
  const je = post({
    type: 'general', date: input.date,
    desc: 'ตัดหนี้สูญ ' + inv.partnerName + ' ใบกำกับ ' + inv.no + ' (' + no + ')',
    src: 'badDebt', srcId: no,
    lines: [{ acc: a, dr: out, memo: reason }, { acc: accBySub('trade_receivable'), cr: out, partner: inv.partnerCode, memo: 'ตัดหนี้สูญ ' + inv.no }],
  });
  inv.settled = (inv.settled || 0) + out;
  inv.writtenOff = (inv.writtenOff || 0) + out;
  syncInvStatus(inv);
  const doc = { no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode, partnerName: inv.partnerName,
    amount: out, method: input.method || 'expense', acc: a, reason, entryNo: je.no, status: 'posted' };
  DB.docs.badDebt.unshift(doc);
  audit('badDebt', no, 'create', null, { invoice: inv.no, amount: fmt(out) }, reason);
  return doc;
}

/* ===================================================================
   ใบลดหนี้จากผู้ขาย — ผู้ขายลดราคา รับคืนสินค้า หรือคิดเงินเกิน หลังเราตั้งหนี้แล้ว
   Dr เจ้าหนี้ (รายผู้ขาย) / Cr สินค้าคงเหลือ (ของที่ส่งคืน ตามต้นทุนเฉลี่ย) · Cr ส่งคืนสินค้าและส่วนลดรับ หรือบัญชีเดิม · Cr ภาษีซื้อ
   ภาษีซื้อลดลงในเดือนที่ได้รับใบลดหนี้ (ทะเบียนภาษีซื้อเป็นยอดติดลบ) ไม่ย้อนไปแก้เดือนเดิมที่ยื่นแล้ว
   =================================================================== */
/** อัตราภาษีของบรรทัดในรายการตั้งหนี้ — ใบรุ่นก่อนไม่ได้เก็บอัตราต่อบรรทัด ดูจากแถวทะเบียนภาษีซื้อของใบนั้น */
function billLineCode(bill, l) {
  if (l.taxCode) return l.taxCode;
  if (bill.vat) return 'VAT7';
  const t = DB.taxTx.find((x) => x.kind === 'vat_input' && x.entryNo === bill.entryNo && !x.srcDoc);
  const o = t && t.orig ? t.orig : t;
  if (o && !o.base && o.zero) return 'VAT0';
  if (o && !o.base && o.exempt) return 'EXEMPT';
  return 'VAT7';
}
function billTaxCodes(bill) {
  const set = [];
  bill.lines.forEach((l) => { const c = billLineCode(bill, l); if (l.amount && set.indexOf(c) < 0) set.push(c); });
  return set.length ? set : ['VAT7'];
}
/** มูลค่าก่อนภาษีที่ยังลดหนี้ได้ของอัตรานี้ = รายการในใบ − ใบลดหนี้จากผู้ขายที่ยังไม่ยกเลิก */
function billCreditableBase(bill, code) {
  let v = bill.lines.reduce((s, l) => s + (!code || billLineCode(bill, l) === code ? l.amount : 0), 0);
  DB.docs.vendorCreditNote.forEach((c) => { if (c.billNo === bill.no && liveDoc(c) && (!code || c.taxCode === code)) v -= c.base; });
  return Math.max(0, v);
}
/** สินค้าคงคลังในรายการตั้งหนี้ที่ยังส่งคืนได้ — ไม่เกินที่ซื้อหักที่คืนไปแล้ว และไม่เกินที่มีในคลังตอนนี้ */
function billReturnable(bill) {
  const out = [];
  bill.lines.forEach(function (l) {
    const it = l.itemCode ? DB.items.find((x) => x.code === l.itemCode) : null;
    if (!it || it.type !== 'stock') return;
    let r = out.find((x) => x.code === it.code);
    if (!r) { r = { code: it.code, name: it.name, uom: it.uom || '', bought: 0, value: 0, back: 0, onHand: it.qty, code_: billLineCode(bill, l) }; out.push(r); }
    r.bought = roundQty(r.bought + Number(l.qty));
    r.value += l.amount;
  });
  out.forEach(function (r) {
    r.back = roundQty(DB.docs.vendorCreditNote.filter((c) => c.billNo === bill.no && liveDoc(c))
      .reduce((a, c) => a + (c.returns || []).filter((x) => x.itemCode === r.code).reduce((b, x) => b + x.qty, 0), 0));
    r.left = Math.max(0, Math.min(roundQty(r.bought - r.back), r.onHand));
  });
  return out;
}
/** บัญชีที่รับส่วนลดได้ — ส่วนลดรับ หรือบัญชีค่าใช้จ่าย/ทรัพย์สินเดิม (ไม่ใช่สินค้าคงเหลือ: ของที่คืนตัดตามต้นทุนจริงเท่านั้น) */
function vendorCnAccounts() {
  const out = [];
  const pr = DB.accounts.find((a) => a.postable && a.subType === 'purchase_return');
  if (pr) out.push(pr);
  billAccounts().forEach((a) => { if (a.subType !== 'inventory' && out.indexOf(a) < 0) out.push(a); });
  return out;
}
function vendorCnDefaultAcc(bill) {
  const pr = ensureAccount('purchase_return', '5112', 'ส่งคืนสินค้าและส่วนลดรับ', 'expense');
  if (bill.grnNo) return pr;
  const first = bill.lines.find((l) => l.acc && acc(l.acc).subType !== 'inventory');
  return first && bill.lines.every((l) => !l.itemCode) ? first.acc : pr;
}

function recordVendorCreditNote(input) {
  const bill = DB.docs.bill.find((b) => b.no === input.billNo);
  if (!bill) {
    throw new DomainError('VENDOR_CN_NO_ORIGIN', 'ใบลดหนี้ต้องอ้างรายการตั้งหนี้ (ใบกำกับภาษีเดิมของผู้ขาย) เสมอ',
      'เลือกรายการตั้งหนี้ที่ผู้ขายลดหนี้ให้');
  }
  if (bill.status === 'void') throw new DomainError('VENDOR_CN_ORIGIN_VOID', 'รายการตั้งหนี้ ' + bill.no + ' ถูกยกเลิกไปแล้ว');
  if (!input.date) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ตามใบลดหนี้');
  if (input.date < bill.date) {
    throw new DomainError('VENDOR_CN_BEFORE_ORIGIN', 'วันที่ใบลดหนี้ (' + thDate(input.date) + ') ก่อนวันที่ตั้งหนี้ (' + thDate(bill.date) + ')');
  }
  const cnNo = String(input.vendorCnNo || '').trim();
  if (!cnNo) {
    throw new DomainError('VENDOR_CN_NO_REQUIRED', 'ต้องกรอกเลขที่ใบลดหนี้ของผู้ขาย', 'ดูจากใบลดหนี้ที่ผู้ขายส่งมา ใช้ในรายงานภาษีซื้อ');
  }
  const dup = DB.docs.vendorCreditNote.find((c) => c.partnerCode === bill.partnerCode && c.vendorCnNo === cnNo && liveDoc(c));
  if (dup) {
    throw new DomainError('DUPLICATE_VENDOR_CN', 'บันทึกใบลดหนี้เลขที่ ' + cnNo + ' ของผู้ขายรายนี้ไปแล้ว (' + dup.no + ')');
  }
  const reason = CN_REASONS[input.reason] ? input.reason : ((input.returnLines || []).length ? 'RETURN_DEFECT' : 'PRICE_REDUCE');
  /* อัตราภาษีต้องตรงกับรายการเดิม — ใบที่มีหลายอัตราต้องเลือก */
  const codes = billTaxCodes(bill);
  let code = input.taxCode;
  if (code && codes.indexOf(code) < 0) {
    throw new DomainError('NOTE_TAX_CODE_INVALID', 'รายการตั้งหนี้ ' + bill.no + ' ไม่มีรายการ' + (TAX_CODE_LABEL[code] || code));
  }
  if (!code) {
    if (codes.length > 1) {
      throw new DomainError('NOTE_TAX_CODE_REQUIRED', 'รายการตั้งหนี้ ' + bill.no + ' มีหลายอัตราภาษี ต้องเลือกว่าลดหนี้รายการอัตราใด');
    }
    code = codes[0];
  }
  /* ของที่ส่งคืน — ต้องเป็นสินค้าในใบนี้ ไม่เกินที่ซื้อหักที่คืนแล้ว และไม่เกินที่มีในคลัง (สต๊อกห้ามติดลบ) */
  const can = billReturnable(bill);
  const seen = {};
  const returns = (input.returnLines || []).filter((l) => l && l.itemCode && Number(l.qty) > 0).map(function (l) {
    const r = can.find((x) => x.code === l.itemCode);
    if (!r) {
      throw new DomainError('RETURN_ITEM_NOT_BOUGHT', 'สินค้า ' + l.itemCode + ' ไม่ได้รับเข้าคลังในรายการตั้งหนี้ ' + bill.no,
        'ส่งคืนได้เฉพาะสินค้าคงคลังที่ซื้อในใบนี้');
    }
    if (seen[r.code]) throw new DomainError('RETURN_DUPLICATE', 'สินค้า ' + r.code + ' ซ้ำกับบรรทัดก่อนหน้า');
    seen[r.code] = true;
    if (r.code_ !== code) {
      throw new DomainError('RETURN_TAX_CODE_MISMATCH', 'สินค้า ' + r.code + ' อยู่ในรายการ' + TAX_CODE_LABEL[r.code_] + ' แต่ใบลดหนี้นี้เป็น' + TAX_CODE_LABEL[code]);
    }
    const q = roundQty(l.qty);
    const boughtLeft = roundQty(r.bought - r.back);
    if (q > boughtLeft) {
      throw new DomainError('RETURN_EXCEEDS_BOUGHT', 'ส่งคืน ' + r.code + ' ' + q + ' ' + r.uom + ' เกินที่ซื้อและยังไม่ได้คืน ' + boughtLeft);
    }
    if (q > r.onHand) {
      throw new DomainError('RETURN_EXCEEDS_STOCK', 'ส่งคืน ' + r.code + ' ' + q + ' ' + r.uom + ' แต่มีในคลังเหลือ ' + r.onHand,
        'ของที่ขายหรือใช้ไปแล้วส่งคืนไม่ได้ — ถ้าผู้ขายลดราคาให้ ให้บันทึกเป็นส่วนลดโดยไม่ระบุสินค้าคืน');
    }
    /* มูลค่าตามราคาที่ซื้อในใบนี้ — ใช้เป็นมูลค่าลดหนี้ปริยายของของที่คืน */
    return { itemCode: r.code, desc: r.name, qty: q, value: round2(mulDiv(r.value, Math.round(q * 1000), Math.round(r.bought * 1000))) };
  });
  const retValue = returns.reduce((s, r) => s + r.value, 0);
  const base = givenStr(input.base) ? M(input.base) : retValue;
  if (base <= 0) throw new DomainError('VENDOR_CN_ZERO', 'มูลค่าที่ลดต้องมากกว่าศูนย์');
  const remaining = billCreditableBase(bill, code);
  if (base > remaining) {
    throw new DomainError('VENDOR_CN_EXCEEDS', 'มูลค่าใบลดหนี้ ' + fmt(base) + ' เกินมูลค่าคงเหลือของรายการตั้งหนี้ ' + fmt(remaining) + ' บาท (ก่อนภาษี'
      + (codes.length > 1 ? ' เฉพาะรายการ' + TAX_CODE_LABEL[code] : '') + ')');
  }
  const accCode = input.acc || vendorCnDefaultAcc(bill);
  if (!vendorCnAccounts().some((a) => a.code === accCode)) {
    throw new DomainError('VENDOR_CN_ACCOUNT_INVALID', 'บัญชี ' + accCode + ' ใช้รับส่วนลดจากผู้ขายไม่ได้',
      'เลือกส่วนลดรับ หรือบัญชีค่าใช้จ่ายเดิม · ของที่ส่งคืนระบบตัดออกจากสินค้าคงเหลือให้เองตามต้นทุนเฉลี่ย');
  }
  const vat = code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', bill.date).rate)) : 0;
  const total = base + vat;
  const claimable = bill.claimable !== false;
  assertPostingOpen(input.date);
  const no = nextNo('vendorCreditNote', input.date);

  /* ของออกจากคลังที่ต้นทุนเฉลี่ย ณ วันนี้ ส่วนต่างกับมูลค่าที่ผู้ขายลดให้ลงส่งคืนสินค้าและส่วนลดรับ */
  let cost = 0;
  returns.forEach(function (r) {
    r.cost = moveOut(DB.items.find((x) => x.code === r.itemCode), r.qty, input.date, no);
    cost += r.cost;
  });
  const retPortion = Math.min(base, retValue);
  const rest = base - retPortion;
  const costDiff = retPortion - cost;
  const prAcc = returns.length ? ensureAccount('purchase_return', '5112', 'ส่งคืนสินค้าและส่วนลดรับ', 'expense') : null;
  const je = post({
    type: 'purchase', date: input.date,
    desc: 'ใบลดหนี้จากผู้ขาย ' + bill.partnerName + ' เลขที่ ' + cnNo + ' อ้าง ' + bill.vendorNo + ' (' + no + ')',
    src: 'vendorCreditNote', srcId: no,
    lines: [{ acc: accBySub('trade_payable'), dr: total, partner: bill.partnerCode }]
      .concat(cost ? [{ acc: accBySub('inventory'), cr: cost, memo: 'ส่งคืนสินค้าตามต้นทุนเฉลี่ย' }] : [])
      .concat(costDiff > 0 ? [{ acc: prAcc, cr: costDiff, memo: 'มูลค่าลดหนี้สูงกว่าต้นทุนของที่คืน' }] : [])
      .concat(costDiff < 0 ? [{ acc: prAcc, dr: -costDiff, memo: 'มูลค่าลดหนี้ต่ำกว่าต้นทุนของที่คืน' }] : [])
      .concat(rest ? [{ acc: accCode, cr: rest, memo: CN_REASONS[reason] }] : [])
      .concat(vat ? [{ acc: claimable ? accBySub('input_vat') : accBySub('non_claimable_vat_expense'), cr: vat }] : []),
  });
  DB.taxTx.push({
    kind: 'vat_input', period: periodOf(input.date), date: input.date,
    docNo: cnNo, docType: 'credit_note', refDoc: bill.vendorNo,
    partnerName: bill.partnerName, taxId: (partnerOfCode(bill.partnerCode) || {}).taxId || null,
    branch: (partnerOfCode(bill.partnerCode) || {}).branch || null,
    base: code === 'VAT7' ? -base : 0, zero: code === 'VAT0' ? -base : 0, exempt: code === 'EXEMPT' ? -base : 0,
    tax: claimable ? -vat : 0, nonClaimable: claimable ? 0 : -vat,
    entryNo: je.no, filingId: null, srcDoc: 'vendorCreditNote|' + no,
  });
  bill.credited = (bill.credited || 0) + total;
  syncBillStatus(bill);
  const doc = {
    no, date: input.date, billNo: bill.no, vendorNo: bill.vendorNo, vendorCnNo: cnNo,
    partnerCode: bill.partnerCode, partnerName: bill.partnerName, reason, reasonText: CN_REASONS[reason],
    taxCode: code, base, vat, total, claimable, acc: accCode, rest,
    returns: returns.map((r) => ({ itemCode: r.itemCode, desc: r.desc, qty: r.qty, value: r.value, cost: r.cost })),
    note: input.note || '', entryNo: je.no, status: 'posted',
  };
  DB.docs.vendorCreditNote.unshift(doc);
  audit('vendorCreditNote', no, 'create', null, { bill: bill.no, cn: cnNo, total: fmt(total), returns: returns.length });
  return doc;
}
const partnerOfCode = (code) => DB.partners.find((p) => p.code === code) || null;

/* ===================================================================
   รับชำระหลายใบกำกับของลูกค้ารายเดียวในครั้งเดียว — ไม่ต้องออกใบวางบิลก่อน
   ออกใบเสร็จให้ทุกใบที่เลือกในชุดเดียว ล้มใบเดียวก็ไม่ออกเลยสักใบ
   =================================================================== */
function receiveMany(input) {
  const picks = (input.invoices || []).filter((x) => x && x.invoiceNo);
  if (!picks.length) throw new DomainError('RECEIPT_NO_INVOICE', 'ต้องเลือกใบกำกับอย่างน้อย 1 ใบ');
  const first = DB.docs.invoice.find((d) => d.no === picks[0].invoiceNo);
  if (!first) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + picks[0].invoiceNo);
  const group = 'RG-' + picks.map((x) => x.invoiceNo).join('+');
  return picks.map(function (pk) {
    const inv = DB.docs.invoice.find((d) => d.no === pk.invoiceNo);
    if (inv && inv.partnerCode !== first.partnerCode) {
      throw new DomainError('RECEIPT_PARTNER_MISMATCH', 'ใบกำกับ ' + inv.no + ' เป็นของ ' + inv.partnerName + ' รับชำระรวมกับ ' + first.partnerName + ' ไม่ได้');
    }
    const rc = receivePayment({ invoiceNo: pk.invoiceNo, amount: pk.amount, date: input.date, method: input.method,
      bankAccount: input.bankAccount, whtCode: input.whtCode || null, whtBase: pk.whtBase });
    rc.group = group;
    return rc;
  });
}

/* ===================================================================
   ยกเลิกเอกสาร — ตัวช่วยที่ voidBlockers / voidPreview / voidDocument ใน operations.js เรียก
   =================================================================== */
const liveRefs = (list, test) => list.filter((x) => x.status !== 'void' && test(x)).map((x) => x.no);
function settleVoidBlockers(kind, d) {
  const out = [];
  const ca = DB.docs.creditApply;
  if (kind === 'invoice' || kind === 'bill') {
    const side = kind === 'invoice' ? 'ar' : 'ap';
    const used = liveRefs(ca, (a) => a.side === side && (a.targetNo === d.no || (a.sourceKind === kind && a.sourceNo === d.no)));
    if (used.length) out.push('มีการหักกลบเครดิตอ้างถึง ' + used.join(', '));
  }
  if (kind === 'invoice') {
    const bd = liveRefs(DB.docs.badDebt, (b) => b.invoiceNo === d.no);
    if (bd.length) out.push('ตัดหนี้สูญไปแล้วตาม ' + bd.join(', '));
  }
  if (kind === 'bill') {
    const cn = liveRefs(DB.docs.vendorCreditNote, (c) => c.billNo === d.no);
    if (cn.length) out.push('มีใบลดหนี้จากผู้ขายอ้างถึง ' + cn.join(', '));
  }
  if (kind === 'receipt' && d.excess) {
    const cr = DB.docs.customerDeposit.find((x) => x.kind === 'overpay' && x.srcReceipt === d.no);
    const used = cr ? liveRefs(ca, (a) => a.sourceKind === 'deposit' && a.sourceNo === cr.no) : [];
    if (used.length) out.push('เงินรับเกินของใบเสร็จนี้ถูกใช้หักกลบหรือคืนไปแล้วตาม ' + used.join(', '));
  }
  if (kind === 'customerDeposit' || kind === 'vendorDeposit') {
    const coll = kind === 'customerDeposit' ? DB.docs.invoice : DB.docs.bill;
    const ded = liveRefs(coll, (x) => (x.deposits || []).some((r) => r.no === d.no));
    if (ded.length) out.push('หักเงินมัดจำนี้ไว้ใน ' + ded.join(', ') + ' แล้ว ต้องยกเลิกเอกสารนั้นก่อน');
    const used = liveRefs(ca, (a) => a.sourceKind === 'deposit' && a.sourceNo === d.no);
    if (used.length) out.push('ใช้หักกลบหรือคืนเงินไปแล้วตาม ' + used.join(', '));
  }
  return out;
}
function settleVoidPreview(kind, d) {
  const out = [];
  if ((kind === 'invoice' || kind === 'bill') && (d.deposits || []).length) {
    out.push('เงินมัดจำที่หักไว้ (' + d.deposits.map((r) => r.no).join(', ') + ') กลับไปรอหักในเอกสารใบถัดไป');
  }
  if (kind === 'receipt' && d.diff) out.push('ส่วนต่าง ' + fmt(d.diff) + ' บาทที่ปิดยอดไว้กลับมาเป็นยอดค้าง');
  if (kind === 'receipt' && d.excess) out.push('เครดิตรับเกิน ' + fmt(d.excess) + ' บาทของลูกค้าถูกยกเลิกด้วย');
  if (kind === 'payment' && d.diff) out.push('ส่วนต่าง ' + fmt(d.diff) + ' บาทที่ปิดยอดไว้กลับมาเป็นยอดค้างจ่าย');
  if (kind === 'customerDeposit' || kind === 'vendorDeposit') out.push('เงินมัดจำ ' + d.no + ' ออกจากทะเบียนเครดิตของ' + (kind === 'customerDeposit' ? 'ลูกค้า' : 'ผู้ขาย'));
  if (kind === 'creditApply' && d.mode === 'apply') out.push('ยอดค้างของ ' + d.targetNo + ' กลับมา และเครดิต ' + d.sourceNo + ' กลับไปใช้ได้อีก');
  if (kind === 'creditApply' && d.mode === 'refund') out.push('ยอดเหลือของ ' + d.sourceNo + ' กลับมาเท่าก่อนคืนเงิน');
  if (kind === 'badDebt') out.push('ใบกำกับ ' + d.invoiceNo + ' กลับมาเป็นลูกหนี้ค้างรับ ' + fmt(d.amount) + ' บาท');
  if (kind === 'vendorCreditNote') {
    out.push('ยอดค้างจ่ายของ ' + d.billNo + ' กลับไปเหมือนก่อนลดหนี้');
    if ((d.returns || []).length) out.push('สินค้าที่ส่งคืนกลับเข้าคลังตามต้นทุนที่ตัดออกไป');
  }
  return out;
}
/** คืนยอดที่เอกสารเคยแตะ — เรียกหลังตั้งสถานะยกเลิก ก่อนส่วนที่ operations.js ทำเองตามชนิด */
function settleOnVoid(kind, d) {
  const restore = (coll, rows) => (rows || []).forEach(function (r) {
    const dp = coll.find((x) => x.no === r.no);
    if (dp) { dp.applied = (dp.applied || 0) - r.base; dp.appliedVat = (dp.appliedVat || 0) - r.vat; }
  });
  if (kind === 'invoice') restore(DB.docs.customerDeposit, d.deposits);
  if (kind === 'bill') restore(DB.docs.vendorDeposit, d.deposits);
  if (kind === 'receipt') {
    const inv = DB.docs.invoice.find((x) => x.no === d.invoiceNo);
    if (inv && d.diff) inv.settled = (inv.settled || 0) - d.diff;
    DB.docs.customerDeposit.forEach((x) => { if (x.kind === 'overpay' && x.srcReceipt === d.no) x.status = 'void'; });
  }
  if (kind === 'payment' && d.diff) {
    const b = DB.docs.bill.find((x) => x.no === d.billNo);
    if (b) b.settled = (b.settled || 0) - d.diff;
  }
  if (kind === 'vendorDeposit') voidCert(d.certNo);
  if (kind === 'creditApply') {
    const ar = d.side === 'ar';
    const coll = ar ? DB.docs.invoice : DB.docs.bill;
    const sync = ar ? syncInvStatus : syncBillStatus;
    if (d.mode === 'refund') {
      const dp = depositFind('ar', d.sourceNo);
      dp.refunded -= d.amount;
      dp.refundedVat = (dp.refundedVat || 0) - (d.vat || 0);
    } else {
      const t = coll.find((x) => x.no === d.targetNo);
      if (t) { t.settled = (t.settled || 0) - d.amount; sync(t); }
      if (d.sourceKind === 'deposit') depositFind(d.side, d.sourceNo).applied -= d.amount;
      else {
        const s = coll.find((x) => x.no === d.sourceNo);
        if (s) { s.settled = (s.settled || 0) + d.amount; sync(s); }
      }
    }
  }
  if (kind === 'badDebt') {
    const inv = DB.docs.invoice.find((x) => x.no === d.invoiceNo);
    if (inv) { inv.settled -= d.amount; inv.writtenOff = (inv.writtenOff || 0) - d.amount; syncInvStatus(inv); }
  }
  if (kind === 'vendorCreditNote') {
    const b = DB.docs.bill.find((x) => x.no === d.billNo);
    if (b) { b.credited = (b.credited || 0) - d.total; syncBillStatus(b); }
    stockBack(d.no, 'out');
  }
}

/* ห่อทุกคำสั่งที่เขียนข้อมูลให้เป็นชุดเดียว (ดู atomically ใน engine.js) */
receiveCustomerDeposit = transactional(receiveCustomerDeposit);
payVendorDeposit = transactional(payVendorDeposit);
applyCredit = transactional(applyCredit);
refundCustomerCredit = transactional(refundCustomerCredit);
writeOffBadDebt = transactional(writeOffBadDebt);
recordVendorCreditNote = transactional(recordVendorCreditNote);
receiveMany = transactional(receiveMany);
registerDepositBalance = transactional(registerDepositBalance);
cancelDepositBalance = transactional(cancelDepositBalance);
