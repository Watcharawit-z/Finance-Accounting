/* ===================================================================
   กิจการที่ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม
   - เรียกเก็บภาษีขายไม่ได้: ทุกบรรทัดของเอกสารขายคิดเป็นไม่มีภาษี และไม่มีแถวในรายงานภาษีขาย
   - ขอคืนภาษีซื้อไม่ได้: ภาษีที่จ่ายผู้ขายรวมเป็นต้นทุนหรือค่าใช้จ่าย (เหมือนภาษีซื้อต้องห้าม)
   - ไม่ต้องยื่น ภ.พ.30 (รายการตรวจปิดงวดข้ามให้)
   ห่อฟังก์ชันเดิมแทนการแก้ข้างใน — ส่วนอื่นของระบบเรียกชื่อเดิมได้ตามปกติ
   =================================================================== */
const isVatRegistered = () => DB.company.vatRegistered !== false;

function nonVatSalesInput(input) {
  if (isVatRegistered() || !input) return input;
  if ((input.lines || []).some((l) => l.taxCode === 'VAT7' || l.taxCode === 'VAT0')) {
    throw new DomainError('NOT_VAT_REGISTERED', 'กิจการไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม เรียกเก็บภาษีมูลค่าเพิ่มไม่ได้',
      'เปลี่ยนรหัสภาษีเป็น "ไม่มีภาษี" หรือแก้ข้อมูลบริษัทถ้าจดทะเบียนแล้ว');
  }
  return Object.assign({}, input, { lines: (input.lines || []).map((l) => Object.assign({}, l, { taxCode: 'EXEMPT' })) });
}
/* แถวรายงานภาษีขายของเอกสารที่ออกตอนไม่ได้จดทะเบียน ลบทิ้ง — ไม่ใช่ใบกำกับภาษีและไม่ต้องเข้าแบบ ภ.พ.30 */
function dropVatOutputRows(no) {
  for (let i = DB.taxTx.length - 1; i >= 0; i--) {
    if (DB.taxTx[i].kind === 'vat_output' && DB.taxTx[i].docNo === no) DB.taxTx.splice(i, 1);
  }
}
function wrapNonVatSale(fn) {
  return function (input) {
    if (isVatRegistered()) return fn.apply(this, arguments);
    const args = Array.prototype.slice.call(arguments);
    args[0] = nonVatSalesInput(input);
    const doc = fn.apply(this, args);
    if (doc && doc.no) { dropVatOutputRows(doc.no); doc.nonVat = true; doc.etax = null; }
    return doc;
  };
}
/* ใบลดหนี้/ใบเพิ่มหนี้ตามใบที่ออกตอนไม่ได้จดทะเบียน ก็ไม่มีภาษี — ส่วนใบกำกับภาษีที่ออกก่อนเลิกจดทะเบียนยังลดภาษีได้ตามจริง */
function wrapNonVatNote(fn) {
  return function (input) {
    const inv = input && DB.docs.invoice.find((d) => d.no === input.invoiceNo);
    if (!inv || !inv.nonVat) return fn.apply(this, arguments);
    const args = Array.prototype.slice.call(arguments);
    args[0] = Object.assign({}, input, { taxCode: 'EXEMPT' });
    const doc = fn.apply(this, args);
    if (doc && doc.no) { dropVatOutputRows(doc.no); doc.nonVat = true; }
    return doc;
  };
}
function wrapNonVatPurchase(fn, inputAt) {
  return function () {
    if (isVatRegistered()) return fn.apply(this, arguments);
    const args = Array.prototype.slice.call(arguments);
    args[inputAt] = Object.assign({}, args[inputAt], { nonClaimableVat: true });
    return fn.apply(this, args);
  };
}
issueInvoice = wrapNonVatSale(issueInvoice);
/* ขายเงินสดของกิจการที่ไม่ได้จดทะเบียน: ราคาที่ตั้งคือราคาขาย ไม่มีภาษีให้ถอด พิมพ์เป็นใบเสร็จรับเงิน */
issueCashSale = wrapNonVatSale(issueCashSale);
issueCreditNote = wrapNonVatNote(issueCreditNote);
issueDebitNote = wrapNonVatNote(issueDebitNote);
/* เงินมัดจำรับของกิจการที่ไม่ได้จดทะเบียน: ไม่มีภาษีขาย ไม่ใช่ใบกำกับภาษี — หักในใบแจ้งหนี้ใบสุดท้ายได้ตามปกติ */
receiveCustomerDeposit = (function (fn) {
  return function (input) {
    if (isVatRegistered()) return fn.apply(this, arguments);
    if (input && (input.taxCode === 'VAT7' || input.taxCode === 'VAT0')) {
      throw new DomainError('NOT_VAT_REGISTERED', 'กิจการไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม เรียกเก็บภาษีจากเงินมัดจำไม่ได้');
    }
    const doc = fn.call(this, Object.assign({}, input, { taxCode: input && input.taxCode === 'NONE' ? 'NONE' : 'EXEMPT' }));
    if (doc && doc.no) { dropVatOutputRows(doc.no); doc.nonVat = true; }
    return doc;
  };
})(receiveCustomerDeposit);
/* เงินมัดจำจ่าย: ขอคืนภาษีซื้อไม่ได้ ภาษีที่ผู้ขายเรียกเก็บรวมเป็นต้นทุนตอนตั้งหนี้ใบสุดท้าย */
payVendorDeposit = (function (fn) {
  return function (input) {
    if (isVatRegistered()) return fn.apply(this, arguments);
    return fn.call(this, Object.assign({}, input, { taxCode: 'NONE' }));
  };
})(payVendorDeposit);
recordBill = wrapNonVatPurchase(recordBill, 0);
recordExpense = wrapNonVatPurchase(recordExpense, 0);
/* ใบแจ้งหนี้ของกิจการที่ไม่ได้จดทะเบียนไม่ใช่ใบกำกับภาษี ไม่ต้องมีรายการครบตามมาตรา 86/4 (ลูกค้าไม่มีเลขผู้เสียภาษีก็ออกได้) */
assertTaxInvoiceComplete = (function (orig) {
  return function () { return isVatRegistered() ? orig.apply(this, arguments) : undefined; };
})(assertTaxInvoiceComplete);
