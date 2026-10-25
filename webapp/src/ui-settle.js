/* ===================================================================
   หน้าจอและแบบฟอร์มของระบบรับ–จ่ายชำระ (settle.js)
   บัญชีรับ/จ่ายเงิน · ส่วนต่างรับ/จ่าย · เงินมัดจำรับ/จ่าย · หักกลบเครดิต · ตัดหนี้สูญ · ใบลดหนี้จากผู้ขาย
   =================================================================== */

/* ---------- บัญชีที่รับ/จ่ายเงิน ----------
   เดิมทุกอย่างเข้า–ออกบัญชีธนาคารบัญชีแรก ใบเสร็จที่รับเงินสดก็ลงธนาคาร เงินสดในมือจึงไม่ตรงของจริง
   เลือกวิธีเงินสด → บัญชีเงินสด · จำบัญชีที่เลือกล่าสุดของแต่ละทาง (รับ/จ่าย) ไว้จนปิดหน้า */
const SETTLE_LAST = { in: {}, out: {} };
function cashAccDefault(dir, method) {
  const accs = payFromAccounts();
  /* จ่ายด้วยเงินสดย่อย → บัญชีเงินสดที่ชื่อเป็นเงินสดย่อย (ไม่มี = บัญชีเงินสดตามปกติ) */
  const petty = method === 'petty' && accs.find((a) => a.subType === 'cash' && /ย่อย/.test(a.name || ''));
  if (petty) return petty.code;
  const kind = method === 'cash' || method === 'petty' ? 'cash' : 'bank';
  /* เปิดจากหน้ากระทบยอดธนาคาร — เงินเข้า/ออกบัญชีที่กำลังกระทบยอดอยู่ จะได้จับคู่กับบรรทัดสเตทเมนต์ได้ทันที */
  if (kind === 'bank' && STATE.screen === 'bank' && STATE.bankAcc && accs.some((a) => a.code === STATE.bankAcc)) return STATE.bankAcc;
  const last = SETTLE_LAST[dir] && SETTLE_LAST[dir][kind];
  if (last && accs.some((a) => a.code === last)) return last;
  const pick = accs.find((a) => a.subType === kind && a.isDefault) || accs.find((a) => a.subType === kind) || accs[0];
  return pick ? pick.code : '';
}
function cashAccField(dir, method, label) {
  return field({ name:'bankAccount', label: label, type:'select', value: cashAccDefault(dir, method),
    options: payFromAccounts().map((a) => [a.code, a.code + ' ' + a.name]),
    hint:'เลือกวิธีเงินสดแล้วระบบเปลี่ยนเป็นบัญชีเงินสดให้ · จำบัญชีที่ใช้ล่าสุดไว้' })
    + '<input type="hidden" name="cashDir" value="' + dir + '">';
}
function rememberCashAcc(dir, code) {
  const a = DB.accounts.find((x) => x.code === code);
  if (a && SETTLE_LAST[dir]) SETTLE_LAST[dir][a.subType === 'cash' ? 'cash' : 'bank'] = code;
}
const RECEIPT_DIFF_OPTS = [
  ['', 'รับบางส่วน — ส่วนที่เหลือยังค้างรับ'],
  ['fee', 'ส่วนที่ขาดคือค่าธรรมเนียมโอน — ปิดยอดเป็นค่าธรรมเนียมธนาคาร'],
  ['discount', 'ส่วนที่ขาดคือส่วนลดที่ให้ลูกค้า — ปิดยอดเป็นส่วนลดจ่าย'],
  ['writeoff', 'ส่วนที่ขาดเป็นเศษเล็กน้อย (ไม่เกิน 100 บาท) — ปิดยอดเป็นผลต่างปัดเศษ'],
  ['credit', 'ลูกค้าจ่ายเกิน — เก็บส่วนเกินเป็นเครดิตของลูกค้า'],
];
const PAYMENT_DIFF_OPTS = [
  ['', 'จ่ายบางส่วน — ส่วนที่เหลือยังค้างจ่าย'],
  ['discount', 'ผู้ขายลดให้ — ปิดยอดเป็นส่วนลดรับ'],
  ['other_income', 'ผู้ขายยกให้ — ปิดยอดเป็นรายได้อื่น'],
];

/* ---------- ยอดสรุประหว่างกรอก — ใช้สูตรเดียวกับตอนลงบัญชี ตัวเลขที่เห็นจึงตรงกับที่จะบันทึก ---------- */
const sumSpan = (label, v, cls) => '<span' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(label) + ' <b>' + fmt(v) + '</b></span>';
function refreshReceiptSum() {
  const el = document.getElementById('rcSum');
  if (!el) return;
  try {
    const form = document.querySelector('[data-rcform]');
    const inv = DB.docs.invoice.find((d) => d.no === ((form && form.getAttribute('data-rcform')) || val('invoiceNo')));
    if (!inv) { el.innerHTML = ''; return; }
    /* สูตรเดียวกับตอนลงบัญชี (receiptMath) — ผิดกติกาขึ้นข้อความเดียวกับที่จะเห็นตอนกดบันทึก */
    let r;
    try { r = receiptMath(inv, receiptFormInput()); }
    catch (e) {
      if (!(e instanceof DomainError)) throw e;
      el.innerHTML = sumSpan('คงค้าง', invOutstanding(inv)) + '<span class="bad">' + esc(e.message) + '</span>';
      return;
    }
    const out = r.outstanding;
    const what = r.excess ? '<span class="good">รับเกิน ' + fmt(r.excess) + ' → เป็นเครดิตของลูกค้า</span>'
      : r.gross < out ? (r.diff ? '<span>ปิดส่วนต่าง <b>' + fmt(r.diff) + '</b> เป็น' + esc(RECEIPT_DIFF[r.diffType].label) + '</span>'
        : '<span>ยังค้างรับ <b>' + fmt(out - r.gross) + '</b> (แบ่งจ่าย)</span>')
      : '<span class="good">รับครบยอดคงค้าง</span>';
    el.innerHTML = sumSpan('คงค้าง', out) + sumSpan('ลูกค้าหัก ณ ที่จ่าย', r.wht)
      + (r.fee ? sumSpan('ค่าธรรมเนียม', r.fee) : '') + (r.adjTotal ? sumSpan('รายการปรับลด', r.adjTotal) : '')
      + (r.gap ? sumSpan(r.gap > 0 ? 'เงินขาด' : 'เงินเกิน', Math.abs(r.gap)) : '')
      + sumSpan('เงินเข้าบัญชี', r.net) + what;
    const rec = document.querySelector('#modal [name="received"]');
    if (rec) rec.placeholder = 'ตามที่คำนวณ ' + fmt(r.expected);
  } catch (e) { el.textContent = ''; }
}
function refreshPaySum() {
  const el = document.getElementById('pvSum');
  if (!el) return;
  try {
    const form = document.querySelector('[data-pvform]');
    const b = DB.docs.bill.find((d) => d.no === ((form && form.getAttribute('data-pvform')) || val('billNo')));
    if (!b) { el.innerHTML = ''; return; }
    const out = billOutstanding(b);
    const paid = val('amount') ? M(val('amount')) : out;
    const gross = Math.min(paid, out);
    const diff = PAYMENT_DIFF[val('diffType')] && gross < out ? out - gross : 0;
    const code = val('wht') === 'none' ? null : (val('wht') || b.whtCode);
    const ch = val('channel') === 'e_wht' ? 'e_wht' : 'manual';
    let w = billWhtFor(b, gross + diff, val('date') || TODAY, ch, code, val('whtBase') || undefined);
    if (diff && !val('whtBase') && w.wht) w = billWhtFor(b, gross + diff, val('date') || TODAY, ch, code, unM(round2(mulDiv(w.share, gross, gross + diff))));
    /* ภาษีหัก ณ ที่จ่ายที่กรอกเป็นจำนวนเงินเอง แทนที่ตัวเลขที่คิดจากอัตรา (สูตรเดียวกับ payBill) */
    if (code && val('whtAmount')) w = Object.assign({}, w, { wht: round2(M(val('whtAmount'))), rate: resolveRate(code, val('date') || TODAY, { channel: ch }).rate });
    const fee = val('fee') ? M(val('fee')) : 0;
    el.innerHTML = sumSpan('คงค้าง', out) + sumSpan('หัก ณ ที่จ่าย' + (w.rate ? ' ' + w.rate + '%' : ''), w.wht)
      + sumSpan('จ่ายสุทธิให้ผู้ขาย', gross - w.wht) + (fee ? sumSpan('ค่าธรรมเนียม', fee) : '')
      + sumSpan('เงินออกจากบัญชี', gross - (ch === 'manual' ? w.wht : 0) + fee)
      + (paid > out ? '<span class="bad">จ่ายเกินยอดคงค้าง</span>'
        : diff ? '<span>ปิดส่วนต่าง <b>' + fmt(diff) + '</b> เป็น' + esc(PAYMENT_DIFF[val('diffType')].label) + '</span>'
        : paid < out ? '<span>ยังค้างจ่าย <b>' + fmt(out - paid) + '</b></span>' : '<span class="good">จ่ายครบ</span>');
  } catch (e) { el.textContent = ''; }
}
/** หักเงินมัดจำในเอกสารที่กำลังกรอก (ยังไม่ลงบัญชี) — สำเนาจากที่ engine ทำ เพื่อแสดงตัวเลขก่อนกดบันทึก */
function previewDeposits(side, v, date) {
  let ded = 0, std = false;
  collectDepositPicks().forEach(function (pk) {
    const d = (side === 'ar' ? DB.docs.customerDeposit : DB.docs.vendorDeposit).find((x) => x.no === pk.no);
    if (!d) return;
    const amt = Math.min(pk.base ? M(pk.base) : depositLeft(d), depositLeft(d));
    const b = DEPOSIT_TAX[d.taxCode].bucket;
    if (!b) return;
    v[b] -= amt; ded += amt; if (b === 'std') std = true;
  });
  if (std) v.vat = round2(pct(Math.max(0, v.std), resolveRate('VAT7', date).rate));
  v.total = v.std + v.zero + v.exempt + v.vat;
  return ded;
}

/* ---------- เลือกเงินมัดจำที่จะหักในใบกำกับ (ลูกค้า) หรือรายการตั้งหนี้ (ผู้ขาย) ---------- */
function depositPicker(side, partnerCode) {
  const ar = side === 'ar';
  const list = (ar ? DB.docs.customerDeposit : DB.docs.vendorDeposit)
    .filter((d) => d.partnerCode === partnerCode && depositTaxable(d) && depositLeft(d) > 0);
  if (!list.length) return '';
  return '<div class="sub-h">หักเงินมัดจำที่' + (ar ? 'รับ' : 'จ่าย') + 'ไว้แล้ว</div><div class="scroll"><table class="lines"><thead><tr>'
    + '<th></th><th>เลขที่</th><th>วันที่</th><th>รายการ</th><th>ภาษี</th><th class="r">คงเหลือ (ก่อนภาษี)</th><th class="r">หักครั้งนี้</th></tr></thead><tbody>'
    + list.map((d) => '<tr><td><input type="checkbox" name="depPick" value="' + esc(d.no) + '"></td>'
      + '<td class="mono">' + esc(d.no) + '</td><td>' + thDateNum(d.date) + '</td><td>' + esc(d.desc || '') + '</td>'
      + '<td>' + esc(DEPOSIT_TAX[d.taxCode].short) + '</td><td class="num">' + fmt(depositLeft(d)) + '</td>'
      + '<td><input class="r" name="depAmt_' + esc(d.no) + '" value="' + fmt(depositLeft(d)) + '"></td></tr>').join('')
    + '</tbody></table></div><div class="note">ภาษีของเงินมัดจำ' + (ar ? 'ออกใบกำกับและเสียภาษีขาย' : 'ขอคืนภาษีซื้อ')
    + 'ไปแล้วตอน' + (ar ? 'รับ' : 'จ่าย') + 'เงิน (ม.78/1) — ติ๊กเพื่อหักในเอกสารนี้ ระบบคิดภาษีเฉพาะมูลค่าที่เหลือหลังหักมัดจำ</div>';
}
function collectDepositPicks() {
  return Array.from(document.querySelectorAll('[name="depPick"]:checked')).map((e) => ({ no: e.value, base: val('depAmt_' + e.value) }));
}

/* ===================================================================
   แบบฟอร์มใหม่
   =================================================================== */
const optDepositTax = (side) => (side === 'ar' ? Object.keys(DEPOSIT_TAX).map((k) => [k, DEPOSIT_TAX[k].label])
  : [['NONE', 'ผู้ขายไม่ได้ออกใบกำกับภาษี — ภาษีขอคืนในใบกำกับใบสุดท้าย'], ['VAT7', 'ผู้ขายออกใบกำกับภาษีเงินมัดจำให้ — ขอคืนภาษีซื้อได้ทันที']]);
function refreshDepositSum() {
  const el = document.getElementById('depSum');
  if (!el) return;
  try {
    const side = val('depSide');
    const date = val('date') || TODAY;
    const base = M(val('base'));
    const vat = val('taxCode') === 'VAT7' ? round2(pct(base, resolveRate('VAT7', date).rate)) : 0;
    const ch = val('channel') === 'e_wht' ? 'e_wht' : 'manual';
    const wb = val('whtBase') ? M(val('whtBase')) : base;
    const wht = val('wht') && (side === 'ar' || base >= M('1000')) ? round2(pct(wb, resolveRate(val('wht'), date, { channel: ch }).rate)) : 0;
    el.innerHTML = sumSpan('มูลค่า', base) + sumSpan(side === 'ar' ? 'ภาษีขาย' : 'ภาษีซื้อ', vat) + sumSpan('รวม', base + vat)
      + sumSpan(side === 'ar' ? 'ลูกค้าหัก ณ ที่จ่าย' : 'หัก ณ ที่จ่าย', wht) + sumSpan(side === 'ar' ? 'เงินเข้าบัญชี' : 'จ่ายสุทธิ', base + vat - wht);
  } catch (e) { el.textContent = ''; }
}
function modalCustomerDeposit(partnerCode) {
  const custs = optCustomers();
  if (!needRefs(custs, 'ยังไม่มีลูกค้าในทะเบียน', 'เพิ่มลูกค้าที่เมนูผู้ติดต่อก่อน')) return;
  modal({
    title:'รับเงินมัดจำ / รับเงินล่วงหน้า',
    sub:'รับเงินก่อนส่งมอบสินค้าหรือบริการ — ต้องออกใบกำกับภาษีและเสียภาษีขายตั้งแต่ตอนรับเงิน (ม.78 ม.78/1) แล้วหักในใบกำกับใบสุดท้าย',
    body:'<div class="flds">' + '<input type="hidden" name="depSide" value="ar">'
      + field({ name:'depPartner', label:'ลูกค้า', type:'select', value: partnerCode || custs[0][0], options: custs })
      + field({ name:'date', label:'วันที่รับเงิน', type:'date', value: defaultDate() })
      + field({ name:'base', label:'จำนวนเงินมัดจำ (ก่อนภาษี)', placeholder:'เช่น 30% ของมูลค่างาน' })
      + field({ name:'taxCode', label:'ภาษีมูลค่าเพิ่ม', type:'select', value:'VAT7', options: optDepositTax('ar'),
          hint:'มัดจำค่าสินค้า/บริการที่มีภาษี ต้องออกใบกำกับภาษีตอนรับเงิน · เงินประกันสัญญาที่จะคืนไม่ใช่ค่าสินค้า ไม่มีภาษี' })
      + field({ name:'desc', label:'รายการ (พิมพ์บนใบกำกับ/ใบรับเงิน)', wide:true, placeholder:'เช่น รับเงินมัดจำงานติดตั้งระบบไฟฟ้า งวดที่ 1 (30%)' })
      + field({ name:'ref', label:'อ้างอิง (ใบเสนอราคา/สัญญา)', placeholder:'ถ้ามี' })
      + field({ name:'method', label:'วิธีรับเงิน', type:'select', value:'transfer', options:[['transfer','โอนเงินเข้าบัญชี'],['cheque','เช็ค'],['cash','เงินสด']] })
      + cashAccField('in', 'transfer', 'รับเงินเข้าบัญชี')
      + field({ name:'wht', label:'ลูกค้าหักภาษี ณ ที่จ่ายหรือไม่', type:'select', options: optWht('ไม่ได้ถูกหัก') })
      + field({ name:'whtBase', label:'ฐานที่ลูกค้าหัก (ตาม 50 ทวิ)', placeholder:'เว้นว่าง = เต็มจำนวนก่อนภาษี' })
      + field({ name:'note', label:'หมายเหตุ', wide:true })
      + '</div><div class="jv-tot" id="depSum"></div>',
    submitLabel:'รับเงินและออกเลขที่',
    note:'Dr เงินสด/ธนาคาร / Cr เงินมัดจำรับ (รายลูกค้า) · Cr ภาษีขาย',
    onSubmit: function () {
      submitAction(function () {
        const d = receiveCustomerDeposit({ partnerCode: val('depPartner'), date: val('date'), base: val('base'), taxCode: val('taxCode'),
          desc: val('desc'), ref: val('ref'), method: val('method'), bankAccount: val('bankAccount'),
          whtCode: val('wht') || null, whtBase: val('wht') ? val('whtBase') : null, note: val('note') });
        rememberCashAcc('in', d.bankAccount);
        STATE.screen = 'deposits'; STATE.sel = d.no; STATE.period = periodOf(d.date);
        toast('รับเงินมัดจำ ' + d.no + ' แล้ว', 'ok', 'รวม ' + fmt(d.total) + ' บาท' + (d.vat ? ' · ภาษีขาย ' + fmt(d.vat) + ' เข้ารายงานภาษีขายเดือนนี้' : ''));
        return d;
      });
    },
  });
  refreshDepositSum();
}
function modalVendorDeposit(partnerCode) {
  const vends = DB.partners.filter((p) => isVendor(p));
  if (!needRefs(vends, 'ยังไม่มีผู้ขายในทะเบียน', 'เพิ่มผู้ขายที่เมนูผู้ติดต่อก่อน')) return;
  const first = vends.find((p) => p.code === partnerCode) || vends[0];
  modal({
    title:'จ่ายเงินมัดจำ / จ่ายล่วงหน้าให้ผู้ขาย',
    sub:'ถ้าผู้ขายออกใบกำกับภาษีให้ ขอคืนภาษีซื้อได้ทันที แล้วหักมัดจำในรายการตั้งหนี้ใบสุดท้าย · ค่าบริการต้องหัก ณ ที่จ่ายตั้งแต่จ่ายมัดจำ',
    body:'<div class="flds">' + '<input type="hidden" name="depSide" value="ap">'
      + field({ name:'vdPartner', label:'ผู้ขาย', type:'select', value: first.code, options: vends.map((p) => [p.code, p.name]) })
      + field({ name:'date', label:'วันที่จ่าย', type:'date', value: defaultDate() })
      + field({ name:'base', label:'จำนวนเงินมัดจำ (ก่อนภาษี)' })
      + field({ name:'taxCode', label:'ใบกำกับภาษีจากผู้ขาย', type:'select', value:'NONE', wide:true, options: optDepositTax('ap') })
      + field({ name:'vendorNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'กรอกเมื่อผู้ขายออกใบกำกับให้' })
      + field({ name:'desc', label:'รายการ', wide:true, placeholder:'เช่น มัดจำค่าปรับปรุงสำนักงาน 30%' })
      + field({ name:'method', label:'วิธีจ่าย', type:'select', value:'transfer', options:[['transfer','โอนเงิน'],['cheque','เช็ค'],['cash','เงินสด']] })
      + cashAccField('out', 'transfer', 'จ่ายจากบัญชี')
      + field({ name:'wht', label:'หักภาษี ณ ที่จ่าย (ประเภทเงินได้)', type:'select', value: first.whtCode || '', options: optWht(),
          hint:'เติมจากทะเบียนผู้ขายให้ · จ่ายต่ำกว่า 1,000 บาทไม่ต้องหัก' })
      + field({ name:'whtBase', label:'ฐานภาษีหัก ณ ที่จ่าย', placeholder:'เว้นว่าง = เต็มจำนวนก่อนภาษี' })
      + field({ name:'channel', label:'ช่องทางนำส่งภาษี', type:'select', value:'manual',
          options:[['manual','หักและนำส่งเอง — ออก 50 ทวิ ให้'], ['e_wht','e-Withholding Tax — ธนาคารออกหลักฐานให้']] })
      + field({ name:'note', label:'หมายเหตุ', wide:true })
      + '</div><div class="jv-tot" id="depSum"></div>',
    submitLabel:'จ่ายเงินและลงบัญชี',
    note:'Dr เงินมัดจำจ่าย (รายผู้ขาย) · Dr ภาษีซื้อ / Cr เงินสด/ธนาคาร · Cr ภาษีหัก ณ ที่จ่ายค้างนำส่ง',
    onSubmit: function () {
      submitAction(function () {
        const d = payVendorDeposit({ partnerCode: val('vdPartner'), date: val('date'), base: val('base'), taxCode: val('taxCode'),
          vendorNo: val('vendorNo'), desc: val('desc'), method: val('method'), bankAccount: val('bankAccount'),
          whtCode: val('wht') || null, whtBase: val('wht') ? val('whtBase') : null, channel: val('channel'), note: val('note') });
        rememberCashAcc('out', d.bankAccount);
        STATE.screen = 'vdeposits'; STATE.sel = d.no; STATE.period = periodOf(d.date);
        toast('จ่ายเงินมัดจำ ' + d.no + ' แล้ว', 'ok', 'จ่ายสุทธิ ' + fmt(d.net) + ' บาท' + (d.certNo ? ' · ออก 50 ทวิ เลขที่ ' + d.certNo : ''));
        return d;
      });
    },
  });
  refreshDepositSum();
}

/** ตั้งเงินมัดจำที่อยู่ในบัญชีแล้ว (ยอดยกมา/ลงด้วยใบสำคัญ) เป็นรายใบ — ไม่ลงบัญชีซ้ำ */
function depositGapNote(side) {
  const free = depositUnallocated(side);
  if (free === 0) return '';
  const ar = side === 'ar';
  return '<div class="note warn">' + (free > 0
    ? '<b>บัญชีเงินมัดจำ' + (ar ? 'รับ' : 'จ่าย') + 'มียอด ' + fmt(free) + ' บาท ที่ยังไม่มีเอกสารรายใบ</b> (ยอดยกมาจากระบบเดิม หรือลงด้วยใบสำคัญ/ค่าใช้จ่าย) '
      + 'หักกับ' + (ar ? 'ใบกำกับ' : 'รายการตั้งหนี้') + 'ไม่ได้จนกว่าจะตั้งเป็นรายใบ — กด <b>ตั้งยอดยกมาเป็นรายใบ</b> ระบบไม่ลงบัญชีซ้ำ'
    : '<b>เงินมัดจำรายใบรวมสูงกว่ายอดในบัญชี ' + fmt(-free) + ' บาท</b> — ตรวจรายการที่ลงบัญชีเงินมัดจำโดยตรง') + '</div>';
}
function modalDepositBalance(side) {
  const ar = side === 'ar';
  const list = DB.partners.filter((p) => (ar ? isCustomer(p) : isVendor(p))).map((p) => [p.code, p.name]);
  if (!needRefs(list, 'ยังไม่มี' + (ar ? 'ลูกค้า' : 'ผู้ขาย') + 'ในทะเบียน', 'เพิ่มที่เมนูผู้ติดต่อก่อน')) return;
  const free = depositUnallocated(side);
  modal({
    title:'ตั้งเงินมัดจำ' + (ar ? 'รับ' : 'จ่าย') + 'ยกมาเป็นรายใบ',
    sub:'ยอดในบัญชีที่ยังไม่มีรายใบ ' + fmt(Math.max(0, free)) + ' บาท — ตั้งเป็นรายใบเพื่อหักกับ' + (ar ? 'ใบกำกับ' : 'รายการตั้งหนี้') + 'ได้ ไม่ลงบัญชีซ้ำ',
    body:'<div class="flds">'
      + field({ name:'bfPartner', label: ar ? 'ลูกค้า' : 'ผู้ขาย', type:'select', options: list })
      + field({ name:'date', label:'วันที่รับ/จ่ายเงินมัดจำเดิม', type:'date', value: pStart() })
      + field({ name:'base', label:'มูลค่าที่เหลือ (ก่อนภาษี)', value: free > 0 ? fmt(free) : '' })
      + field({ name:'taxCode', label:'ภาษีตอนรับ/จ่ายเงินมัดจำเดิม', type:'select', value:'NONE', wide:true,
          options: ar ? Object.keys(DEPOSIT_TAX).map((k) => [k, DEPOSIT_TAX[k].label]) : optDepositTax('ap'),
          hint:'ถ้าระบบเดิมออก/ได้รับใบกำกับภาษีของเงินมัดจำไว้แล้ว เลือก VAT 7% — ตอนหักในเอกสารใบสุดท้าย ภาษีจะคิดเฉพาะส่วนที่เหลือ' })
      + field({ name:'vat', label:'ภาษีของเงินมัดจำ (ถ้ามี)', placeholder:'เว้นว่าง = 7% ของมูลค่า' })
      + field({ name:'desc', label:'รายการ / เลขที่เอกสารเดิม', wide:true, placeholder:'เช่น มัดจำงานติดตั้ง ตามใบรับเงินเลขที่ 6905-012 ระบบเดิม' })
      + '</div>',
    submitLabel:'ตั้งเป็นรายใบ',
    note:'ไม่ลงบัญชี — ยอดอยู่ในบัญชีเงินมัดจำแล้ว',
    onSubmit: function () {
      submitAction(function () {
        const d = registerDepositBalance(side, { partnerCode: val('bfPartner'), date: val('date'), base: val('base'),
          taxCode: val('taxCode'), vat: val('taxCode') === 'VAT7' ? val('vat') : '', desc: val('desc') });
        STATE.screen = ar ? 'deposits' : 'vdeposits'; STATE.sel = d.no;
        toast('ตั้งเงินมัดจำยกมา ' + d.no + ' แล้ว', 'ok', fmt(d.base) + ' บาท · ใช้หัก' + (ar ? 'ใบกำกับ' : 'รายการตั้งหนี้') + 'ได้แล้ว');
        return d;
      });
    },
  });
}

/** หักกลบเครดิต — เปิดจากใบที่ค้าง (เลือกเครดิต) หรือจากเครดิต (เลือกใบที่ค้าง) */
function modalApplyCredit(side, o) {
  const ar = side === 'ar';
  const coll = ar ? DB.docs.invoice : DB.docs.bill;
  const outOf = ar ? invOutstanding : billOutstanding;
  const from = o.targetNo ? coll.find((d) => d.no === o.targetNo)
    : (ar ? DB.docs.customerDeposit : DB.docs.vendorDeposit).concat(coll).find((d) => d.no === o.sourceNo);
  if (!from) return;
  const partner = from.partnerCode;
  const sources = creditSources(side, partner);
  if (o.sourceNo && !sources.some((x) => x.no === o.sourceNo)) { toast('เครดิต ' + o.sourceNo + ' ไม่มียอดเหลือให้ใช้แล้ว', 'err'); return; }
  const targets = coll.filter((d) => d.partnerCode === partner && d.status !== 'void' && outOf(d) > 0);
  if (!needRefs(sources, (ar ? 'ลูกค้า' : 'ผู้ขาย') + 'รายนี้ไม่มีเครดิตที่ใช้หักกลบได้',
    'เครดิตเกิดจากลดหนี้หลังชำระครบ เงินรับเกิน หรือเงินมัดจำที่ไม่ได้ออกใบกำกับ · เงินมัดจำที่ออกใบกำกับแล้วให้หักตอนออกเอกสารใบสุดท้าย')) return;
  if (!needRefs(targets, 'ไม่มี' + (ar ? 'ใบกำกับ' : 'รายการตั้งหนี้') + 'ที่ค้างให้หักกลบ', '')) return;
  const tNo = o.targetNo || targets[0].no;
  const sNo = o.sourceNo || sources[0].no;
  const t = coll.find((d) => d.no === tNo);
  const s = sources.find((x) => x.no === sNo);
  modal({
    title:'หักกลบเครดิต' + (ar ? 'ของลูกค้า' : 'ของผู้ขาย'),
    sub: t.partnerName + ' — ใช้เครดิตที่มีอยู่ชำระ' + (ar ? 'ใบกำกับ' : 'รายการตั้งหนี้') + 'ที่ค้าง ไม่ต้องคืนเงินแล้วรับ/จ่ายใหม่',
    body:'<div class="flds">'
      + (o.targetNo ? '' : field({ name:'targetNo', label: ar ? 'ใบกำกับที่ค้าง' : 'รายการตั้งหนี้ที่ค้าง', type:'select', wide:true, value: tNo,
          options: targets.map((d) => [d.no, d.no + ' · ' + thDateNum(d.date) + ' · ค้าง ' + fmt(outOf(d))]) }))
      + (o.sourceNo ? '' : field({ name:'sourceNo', label:'ใช้เครดิตจาก', type:'select', wide:true, value: sNo,
          options: sources.map((x) => [x.no, x.label + ' · เหลือ ' + fmt(x.left)]) }))
      + field({ name:'amount', label:'ยอดที่หักกลบ', value: fmt(Math.min(s.left, outOf(t))),
          hint:'ไม่เกินเครดิตที่เหลือและยอดค้างของเอกสาร' })
      + field({ name:'date', label:'วันที่หักกลบ', type:'date', value: defaultDate() })
      + field({ name:'note', label:'หมายเหตุ', wide:true })
      + '</div>',
    submitLabel:'หักกลบและลงบัญชี',
    note: ar ? 'Dr เงินมัดจำรับ/ลูกหนี้ (ใบที่มีเครดิต) / Cr ลูกหนี้ (ใบที่ค้าง)' : 'Dr เจ้าหนี้ (ใบที่ค้าง) / Cr เงินมัดจำจ่าย/เจ้าหนี้ (ใบที่มีเครดิต)',
    onSubmit: function () {
      submitAction(function () {
        const a = applyCredit(side, { targetNo: o.targetNo || val('targetNo'), sourceNo: o.sourceNo || val('sourceNo'),
          amount: val('amount'), date: val('date'), note: val('note') });
        toast('หักกลบเครดิต ' + a.no + ' แล้ว', 'ok', fmt(a.amount) + ' บาท จาก ' + a.sourceNo + ' ชำระ ' + a.targetNo);
        return a;
      });
    },
  });
}
function modalRefundCredit(no) {
  const d = DB.docs.customerDeposit.find((x) => x.no === no);
  if (!d) return;
  const left = depositLeft(d);
  if (left <= 0) { toast(no + ' ไม่มียอดเหลือให้คืน', 'err'); return; }
  const vatLeft = depositVatLeft(d);
  modal({
    title:'คืนเงิน' + (d.kind === 'overpay' ? 'รับเกิน' : 'มัดจำ') + 'ให้ลูกค้า อ้าง ' + no,
    sub: d.partnerName + ' · เหลือ ' + fmt(left) + ' บาท' + (vatLeft ? ' + ภาษี ' + fmt(vatLeft) : ''),
    body:'<div class="flds">'
      + field({ name:'amount', label:'มูลค่าที่คืน (ก่อนภาษี)', value: fmt(left) })
      + field({ name:'date', label:'วันที่คืนเงิน', type:'date', value: defaultDate() })
      + field({ name:'method', label:'วิธีคืนเงิน', type:'select', value:'transfer', options:[['transfer','โอนเงิน'],['cheque','เช็ค'],['cash','เงินสด']] })
      + cashAccField('out', 'transfer', 'จ่ายคืนจากบัญชี')
      + field({ name:'note', label:'หมายเหตุ', wide:true, placeholder:'เช่น ลูกค้ายกเลิกสัญญา เลขที่อ้างอิงการโอน' })
      + '</div>'
      + (vatLeft ? '<div class="note">เงินมัดจำนี้ออกใบกำกับภาษีไว้ — คืนเงินแล้วระบบลดภาษีขายในเดือนที่คืน (ใบลดหนี้ ม.86/10 เหตุบอกเลิกสัญญา) และคืนภาษีส่วนนั้นให้ลูกค้าด้วย</div>' : ''),
    submitLabel:'คืนเงินและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const r = refundCustomerCredit({ sourceNo: no, amount: val('amount'), date: val('date'), method: val('method'),
          bankAccount: val('bankAccount'), note: val('note') });
        rememberCashAcc('out', r.bankAccount);
        toast('คืนเงิน ' + r.no + ' แล้ว', 'ok', fmt(r.cash) + ' บาท' + (r.vat ? ' · ลดภาษีขาย ' + fmt(r.vat) : ''));
        return r;
      });
    },
  });
}
function modalBadDebt(no) {
  const inv = DB.docs.invoice.find((d) => d.no === no);
  if (!inv) return;
  const out = invOutstanding(inv);
  if (out <= 0) { toast('ใบกำกับ ' + no + ' ไม่มียอดค้าง', 'err'); return; }
  modal({
    title:'ตัดหนี้สูญ ใบกำกับ ' + no,
    sub: inv.partnerName + ' · ยอดค้างรวมภาษี ' + fmt(out) + ' บาท — ภาษีขายเดิมไม่เปลี่ยน',
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่ตัดหนี้สูญ', type:'date', value: defaultDate() })
      + field({ name:'method', label:'วิธีตัด', type:'select', value:'expense', options: Object.keys(BAD_DEBT_METHOD).map((k) => [k, BAD_DEBT_METHOD[k].label]) })
      + field({ name:'reason', label:'เหตุผลและหลักฐานการติดตามหนี้', wide:true,
          placeholder:'เช่น ทวงถามเป็นหนังสือ 3 ครั้ง ลูกหนี้ปิดกิจการ — อย่างน้อย 5 ตัวอักษร' })
      + '</div><div class="note">ตัดหนี้สูญทางภาษีได้เมื่อทำตามกฎกระทรวงฉบับที่ 186 (ทวงถาม ฟ้องร้อง หรือได้รับอนุมัติตามจำนวนหนี้) — เก็บหลักฐานไว้กับเอกสารนี้ · ยกเลิกได้ถ้าลูกหนี้กลับมาชำระ</div>',
    submitLabel:'ตัดหนี้สูญ', submitKind:'danger',
    note:'Dr หนี้สูญ (หรือค่าเผื่อหนี้สงสัยจะสูญ) / Cr ลูกหนี้การค้า',
    onSubmit: function () {
      submitAction(function () {
        const w = writeOffBadDebt({ invoiceNo: no, date: val('date'), method: val('method'), reason: val('reason') });
        toast('ตัดหนี้สูญ ' + w.no + ' แล้ว', 'ok', fmt(w.amount) + ' บาท · ใบกำกับ ' + no + ' ขึ้นว่าตัดหนี้สูญ');
        return w;
      });
    },
  });
}
function refreshVcnSum() {
  const el = document.getElementById('vcnSum');
  if (!el) return;
  try {
    const bill = DB.docs.bill.find((b) => b.no === val('vcnBill'));
    const rows = billReturnable(bill);
    const ret = rows.reduce((s, r, i) => { const q = Number(val('vr' + i) || 0); return s + (q > 0 ? round2(mulDiv(r.value, Math.round(q * 1000), Math.round(r.bought * 1000))) : 0); }, 0);
    const base = val('base') ? M(val('base')) : ret;
    const code = val('taxCode') || billTaxCodes(bill)[0];
    const vat = code === 'VAT7' ? round2(pct(base, resolveRate('VAT7', bill.date).rate)) : 0;
    el.innerHTML = (ret ? sumSpan('มูลค่าของที่คืน (ราคาซื้อ)', ret) : '') + sumSpan('มูลค่าที่ลด', base) + sumSpan('ภาษีซื้อลดลง', vat)
      + sumSpan('ลดเจ้าหนี้', base + vat);
  } catch (e) { el.textContent = ''; }
}
function modalVendorCn(billNo, fromList) {
  const pick = DB.docs.bill.filter((b) => b.status !== 'void' && billCreditableBase(b) > 0);
  if (!billNo && !needRefs(pick, 'ไม่มีรายการตั้งหนี้ที่ลดหนี้ได้', 'ใบลดหนี้ต้องอ้างรายการตั้งหนี้ (ใบกำกับเดิมของผู้ขาย)')) return;
  const no = billNo || pick[0].no;
  const bill = DB.docs.bill.find((b) => b.no === no);
  if (!bill) return;
  const list = fromList || !billNo;
  const codes = billTaxCodes(bill);
  const rets = billReturnable(bill);
  modal({
    title: list ? 'บันทึกใบลดหนี้จากผู้ขาย' : 'บันทึกใบลดหนี้จากผู้ขาย อ้าง ' + no,
    sub: bill.partnerName + ' · ใบกำกับเดิม ' + bill.vendorNo + ' · ลดได้อีก ' + fmt(billCreditableBase(bill)) + ' บาท (ก่อนภาษี) — ภาษีซื้อลดลงในเดือนที่ได้รับใบลดหนี้',
    body:'<div class="flds" data-vcn="1">'
      + (list ? field({ name:'vcnBill', label:'อ้างรายการตั้งหนี้', type:'select', wide:true, value: no,
          options: pick.map((b) => [b.no, b.no + ' · ' + b.partnerName + ' · ใบกำกับ ' + b.vendorNo + ' · ลดได้อีก ' + fmt(billCreditableBase(b))]) })
        : '<input type="hidden" name="vcnBill" value="' + esc(no) + '">')
      + field({ name:'vendorCnNo', label:'เลขที่ใบลดหนี้ของผู้ขาย', placeholder:'ดูจากใบลดหนี้ที่ผู้ขายส่งมา' })
      + field({ name:'date', label:'วันที่ตามใบลดหนี้', type:'date', value: defaultDate() })
      + field({ name:'reason', label:'เหตุที่ลดหนี้', type:'select', wide:true, value: rets.length ? 'RETURN_DEFECT' : 'PRICE_REDUCE',
          options: Object.keys(CN_REASONS).map((k) => [k, CN_REASONS[k]]) })
      + (codes.length > 1 ? field({ name:'taxCode', label:'ลดหนี้รายการอัตรา', type:'select', wide:true,
          options: codes.map((c) => [c, TAX_CODE_LABEL[c] + ' · ลดได้อีก ' + fmt(billCreditableBase(bill, c))]) }) : '')
      + field({ name:'base', label:'มูลค่าที่ลด (ก่อนภาษี)', placeholder: rets.length ? 'เว้นว่าง = มูลค่าของที่ส่งคืนตามราคาที่ซื้อ' : '' })
      + field({ name:'acc', label:'ส่วนที่ไม่ใช่ของคืน ลงบัญชี', type:'select', wide:true, value: vendorCnDefaultAcc(bill),
          options: vendorCnAccounts().map((a) => [a.code, a.code + ' ' + a.name]),
          hint:'ลดราคาค่าบริการ/ค่าใช้จ่าย ลดบัญชีเดิม · ส่วนลดค่าสินค้า ลงส่งคืนสินค้าและส่วนลดรับ' })
      + '</div>'
      + (rets.length ? '<div class="sub-h">ส่งคืนสินค้า (ถ้ามี)</div><div class="flds">'
          + rets.map((r, i) => field({ name:'vr' + i, label: r.code + ' ' + r.name, value:'0', type:'number',
              hint:'ซื้อ ' + r.bought + ' ' + r.uom + (r.back ? ' · คืนแล้ว ' + r.back : '') + ' · ในคลัง ' + r.onHand + ' · คืนได้อีก ' + r.left
                + ' — ของออกจากคลังที่ต้นทุนเฉลี่ย' })).join('') + '</div>' : '')
      + '<div class="jv-tot" id="vcnSum"></div>',
    submitLabel:'บันทึกใบลดหนี้',
    note:'Dr เจ้าหนี้การค้า / Cr สินค้าคงเหลือหรือบัญชีเดิม · Cr ภาษีซื้อ',
    onSubmit: function () {
      submitAction(function () {
        const returnLines = rets.map((r, i) => ({ itemCode: r.code, qty: Number(val('vr' + i) || 0) })).filter((x) => x.qty > 0);
        const c = recordVendorCreditNote({ billNo: val('vcnBill'), vendorCnNo: val('vendorCnNo'), date: val('date'), reason: val('reason'),
          taxCode: val('taxCode') || undefined, base: val('base'), acc: val('acc'), returnLines });
        STATE.screen = 'vendorcns'; STATE.sel = c.no; STATE.period = periodOf(c.date);
        toast('บันทึกใบลดหนี้จากผู้ขาย ' + c.no + ' แล้ว', 'ok', 'ลดเจ้าหนี้ ' + fmt(c.total) + ' บาท · ภาษีซื้อลดลง ' + fmt(c.vat)
          + (c.returns.length ? ' · ส่งคืนสินค้า ' + c.returns.length + ' รายการ' : ''));
        return c;
      });
    },
  });
  refreshVcnSum();
}
/** รับชำระหลายใบกำกับของลูกค้ารายเดียวในครั้งเดียว — ไม่ต้องออกใบวางบิลก่อน */
function rmInvoiceRows(partnerCode) {
  const list = DB.docs.invoice.filter((d) => d.partnerCode === partnerCode && d.status !== 'void' && invOutstanding(d) > 0)
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!list.length) return '<div class="empty">ลูกค้ารายนี้ไม่มีใบกำกับที่ค้างชำระ</div>';
  return '<div class="scroll"><table class="lines"><thead><tr><th></th><th>ใบกำกับภาษี</th><th>วันที่</th><th>ครบกำหนด</th>'
    + '<th class="r">คงค้าง</th><th class="r">รับครั้งนี้</th></tr></thead><tbody>'
    + list.map((d) => '<tr><td><input type="checkbox" name="rmInv" value="' + esc(d.no) + '" checked></td><td class="mono">' + esc(d.no) + '</td>'
      + '<td>' + thDateNum(d.date) + '</td><td>' + thDateNum(d.due) + '</td><td class="num">' + fmt(invOutstanding(d)) + '</td>'
      + '<td><input class="r" name="rmAmt_' + esc(d.no) + '" value="' + fmt(invOutstanding(d)) + '"></td></tr>').join('')
    + '</tbody></table></div>';
}
function modalReceiveMany() {
  const custs = optCustomers().filter((c) => DB.docs.invoice.some((d) => d.partnerCode === c[0] && d.status !== 'void' && invOutstanding(d) > 0));
  if (!needRefs(custs, 'ไม่มีลูกค้าที่มีใบกำกับค้างชำระ', 'ออกใบกำกับภาษีก่อน แล้วจึงรับชำระ')) return;
  modal({
    title:'รับชำระหลายใบกำกับ',
    sub:'ลูกค้าโอนมาครั้งเดียวสำหรับหลายใบ — ติ๊กใบที่ชำระ ระบบออกใบเสร็จให้ทุกใบในคราวเดียว ไม่ต้องออกใบวางบิลก่อน',
    body:'<div class="flds">'
      + field({ name:'rmPartner', label:'ลูกค้า', type:'select', value: custs[0][0], options: custs })
      + field({ name:'date', label:'วันที่รับชำระ', type:'date', value: defaultDate() })
      + field({ name:'method', label:'วิธีรับชำระ', type:'select', value:'transfer', options:[['transfer','โอนเงินเข้าบัญชี'],['cheque','เช็ค'],['cash','เงินสด']] })
      + cashAccField('in', 'transfer', 'รับเงินเข้าบัญชี')
      + field({ name:'wht', label:'ลูกค้าหักภาษี ณ ที่จ่ายหรือไม่', type:'select', options: optWht('ไม่ได้ถูกหัก'),
          hint:'ฐานคิดจากค่าบริการในแต่ละใบ ไม่รวมค่าสินค้า' })
      + '</div><div class="sub-h">ใบกำกับที่ค้างชำระ</div><div id="rmInvoices">' + rmInvoiceRows(custs[0][0]) + '</div>',
    submitLabel:'รับชำระและออกใบเสร็จ',
    onSubmit: function () {
      submitAction(function () {
        const picks = Array.from(document.querySelectorAll('[name="rmInv"]:checked')).map((e) => ({ invoiceNo: e.value, amount: val('rmAmt_' + e.value) }));
        const made = receiveMany({ invoices: picks, date: val('date'), method: val('method'), bankAccount: val('bankAccount'), whtCode: val('wht') || null });
        rememberCashAcc('in', val('bankAccount'));
        STATE.screen = 'receipts'; STATE.sel = made[0].no; STATE.period = periodOf(made[0].date);
        toast('ออกใบเสร็จ ' + made.length + ' ใบแล้ว', 'ok', made.map((r) => r.no).join(', ') + ' · รับสุทธิ ' + fmt(made.reduce((s, r) => s + r.net, 0)) + ' บาท');
        return made;
      });
    },
  });
}

/* ===================================================================
   หน้าจอ
   =================================================================== */
function depositPill(d) {
  if (isVoid(d)) return { st: ['void', 'ยกเลิก'] };
  const left = depositLeft(d);
  if (left <= 0) return { st: (d.refunded || 0) > 0 && !(d.applied || 0) ? ['late', 'คืนเงินแล้ว'] : ['paid', 'ใช้หมดแล้ว'] };
  if ((d.applied || 0) + (d.refunded || 0) > 0) return { st: ['wait', 'ใช้ไปบางส่วน'] };
  return { st: ['open', depositTaxable(d) ? 'รอหักในเอกสารใบสุดท้าย' : 'รอหักกลบ/คืน'] };
}
/** ที่ไปของเงินมัดจำ — เอกสารที่หักไว้ และการหักกลบ/คืนเงิน */
function depositUses(side, no) {
  const rows = [];
  (side === 'ar' ? DB.docs.invoice : DB.docs.bill).forEach(function (x) {
    (x.deposits || []).forEach(function (r) {
      if (r.no === no) rows.push({ no: x.no, date: x.date, what: 'หักใน' + (side === 'ar' ? 'ใบกำกับ' : 'รายการตั้งหนี้'), amount: r.base, vat: r.vat, d: x,
        act: 'open:' + (side === 'ar' ? 'invoices' : 'bills') + ':' + x.no });
    });
  });
  DB.docs.creditApply.forEach(function (a) {
    if (a.side === side && a.sourceKind === 'deposit' && a.sourceNo === no) {
      rows.push({ no: a.no, date: a.date, what: a.mode === 'refund' ? 'คืนเงิน' : 'หักกลบกับ ' + a.targetNo, amount: a.amount, vat: a.vat || 0, d: a, act: 'open:offsets:' + a.no });
    }
  });
  return rows;
}
const usesTable = (uses) => (uses.length ? '<div class="sub-h">การใช้เงินมัดจำ/เครดิต</div>' + tbl({
  cols:[{t:'เอกสาร'},{t:'วันที่'},{t:'รายการ'},{t:'มูลค่า',a:'r'},{t:'ภาษี',a:'r'},{t:'สถานะ'}],
  rows: uses.map((u) => [{mono:u.no}, thDateNum(u.date), u.what, {n:u.amount}, {n:u.vat}, statusPill(u.d.status === 'void' ? 'void' : 'posted')]),
  rowAttr: (r, i) => rowCls(uses[i].d) + ' data-act="' + uses[i].act + '"' }) : '');

function customerDepositDetail(no) {
  const d = DB.docs.customerDeposit.find((x) => x.no === no);
  if (!d) return '';
  const left = depositLeft(d);
  const over = d.kind === 'overpay';
  const live = !isVoid(d);
  return card({
    title: (over ? 'เงินรับเกิน (เครดิตของลูกค้า) ' : 'เงินมัดจำรับ เลขที่ ') + d.no,
    sub: 'วันที่ ' + thDate(d.date) + ' · ' + d.partnerName + (over ? ' · จากใบเสร็จ ' + d.srcReceipt : ''),
    actions: (live && left > 0 && !depositTaxable(d) ? btn('settle:apply:ar:src:' + d.no, 'หักกลบกับใบกำกับ', 'primary') : '')
      + (live && left > 0 ? btn('settle:refund:' + d.no, 'คืนเงินให้ลูกค้า') : '')
      + (over ? btn('open:receipts:' + d.srcReceipt, 'ดูใบเสร็จ ' + d.srcReceipt) : d.broughtForward ? '' : printBtn('customerDeposit', d.no))
      + (d.entryNo ? btn('entry:' + d.entryNo, 'ดูใบสำคัญ') : '')
      + (over ? '' : d.broughtForward ? (live ? btn('settle:cancelbf:ar:' + d.no, 'ยกเลิกยอดยกมา', 'danger') : '') : voidBtn('customerDeposit', d))
      + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + '<div class="kv">' + [
        ['รายการ', d.desc || '—'], ['ภาษี', DEPOSIT_TAX[d.taxCode].short], ['มูลค่า (ก่อนภาษี)', fmt(d.base)], ['ภาษีขาย', fmt(d.vat)],
        ['รวม', fmt(d.total)], over ? null : ['ลูกค้าหัก ณ ที่จ่าย', fmt(d.wht || 0)], over ? null : ['รับสุทธิ', fmt(d.net)],
        d.bankAccount ? ['รับเข้าบัญชี', d.bankAccount + ' ' + acc(d.bankAccount).name] : d.broughtForward ? ['ที่มา', 'ยอดยกมา (ไม่ลงบัญชีซ้ำ)'] : null,
        ['ใช้ไปแล้ว', fmt((d.applied || 0) + (d.refunded || 0))], ['คงเหลือ (ก่อนภาษี)', fmt(left)], d.ref ? ['อ้างอิง', d.ref] : null,
      ].filter(Boolean).map((r) => '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>'
      + usesTable(depositUses('ar', d.no)),
    foot: depositTaxable(d)
      ? 'ออกใบกำกับภาษีและเสียภาษีขายแล้วตอนรับเงิน (ม.78/1) — ตอนออกใบกำกับใบสุดท้าย ติ๊กหักเงินมัดจำนี้ ระบบคิดภาษีเฉพาะส่วนที่เหลือ'
      : 'ไม่มีภาษี — ใช้หักกลบกับใบกำกับของลูกค้ารายนี้ หรือคืนเงินให้ลูกค้า',
  });
}
function scDeposits() {
  const base = DB.docs.customerDeposit.filter((d) => (periodOf(d.date) === STATE.period || depositLeft(d) > 0 || STATE.sel === d.no)
    && (hit(d.no) || hit(d.partnerName) || hit(d.desc || '')));
  const rows = base.filter((d) => chipPass('deposits', d));
  const open = DB.docs.customerDeposit.reduce((s, d) => s + depositLeft(d), 0);
  return (STATE.sel ? customerDepositDetail(STATE.sel) : '') + card({
    title:'เงินมัดจำรับ · เงินรับล่วงหน้า · เครดิตของลูกค้า',
    sub: thPeriod(STATE.period) + ' และรายการที่ยังมียอดเหลือ · ' + countNote(rows, 'รายการ') + ' · ยอดคงเหลือรวม ' + fmt(open) + ' บาท',
    actions: (depositUnallocated('ar') > 0 ? btn('settle:new:depbf:ar', 'ตั้งยอดยกมาเป็นรายใบ') : '')
      + btn('settle:new:deposit', '+ รับเงินมัดจำ', periodIsOpen() ? 'primary' : 'disabled'),
    filters: listFilters('deposits', 'ค้นหาเลขที่ ลูกค้า หรือรายการ', base),
    body: depositGapNote('ar') + tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ลูกค้า'},{t:'รายการ'},{t:'ภาษี'},{t:'มูลค่า',a:'r'},{t:'ภาษีขาย',a:'r'},{t:'คงเหลือ',a:'r'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, d.kind === 'overpay' ? 'เงินรับเกินตามใบเสร็จ' : (d.broughtForward ? 'ยกมา · ' : '') + (d.desc || ''),
        DEPOSIT_TAX[d.taxCode].short, {n:d.base}, {n:d.vat}, {n:depositLeft(d)}, depositPill(d)]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
      foot: ['รวม','','','','', {n:liveOnly(rows).reduce((s, d) => s + d.base, 0)}, {n:liveOnly(rows).reduce((s, d) => s + d.vat, 0)},
        {n:rows.reduce((s, d) => s + depositLeft(d), 0)}, ''],
      empty:'ไม่มีเงินมัดจำรับในงวดนี้และไม่มีรายการที่ค้างอยู่',
      emptyAction: periodIsOpen() ? btn('settle:new:deposit', 'รับเงินมัดจำ', 'primary') : '',
    }),
    foot:'ยอดคงเหลือคือเงินที่ลูกค้าจ่ายไว้แล้วแต่ยังไม่ได้หักกับใบกำกับ — ต้องตรงกับบัญชีเงินมัดจำรับจากลูกค้า',
  });
}
function vendorDepositDetail(no) {
  const d = DB.docs.vendorDeposit.find((x) => x.no === no);
  if (!d) return '';
  const left = depositLeft(d);
  const live = !isVoid(d);
  return card({
    title:'เงินมัดจำจ่าย เลขที่ ' + d.no,
    sub:'วันที่ ' + thDate(d.date) + ' · ' + d.partnerName + (d.vendorNo ? ' · ใบกำกับผู้ขาย ' + d.vendorNo : ''),
    actions: (live && left > 0 && !depositTaxable(d) ? btn('settle:apply:ap:src:' + d.no, 'หักกลบกับรายการตั้งหนี้', 'primary') : '')
      + (d.certNo ? btn('open:whtcert:' + d.certNo, 'ดู 50 ทวิ ' + d.certNo) : '')
      + (d.broughtForward ? (live ? btn('settle:cancelbf:ap:' + d.no, 'ยกเลิกยอดยกมา', 'danger') : '')
        : printBtn('vendorDeposit', d.no) + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + voidBtn('vendorDeposit', d))
      + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + '<div class="kv">' + [
        ['รายการ', d.desc || '—'], ['ใบกำกับภาษีจากผู้ขาย', d.vendorNo || 'ไม่มี'], ['มูลค่า (ก่อนภาษี)', fmt(d.base)], ['ภาษีซื้อ', fmt(d.vat)],
        ['หัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), fmt(d.wht)], ['จ่ายสุทธิ', fmt(d.net)],
        ['จ่ายจากบัญชี', d.bankAccount ? d.bankAccount + ' ' + acc(d.bankAccount).name : 'ยอดยกมา (ไม่ลงบัญชีซ้ำ)'],
        ['ใช้ไปแล้ว', fmt(d.applied || 0)], ['คงเหลือ (ก่อนภาษี)', fmt(left)],
      ].map((r) => '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>'
      + usesTable(depositUses('ap', d.no)),
    foot: depositTaxable(d)
      ? 'ขอคืนภาษีซื้อแล้วตอนจ่าย — ตอนบันทึกใบกำกับใบสุดท้ายของผู้ขาย ติ๊กหักเงินมัดจำนี้ ภาษีซื้อในใบนั้นจะเหลือเฉพาะส่วนที่เหลือ'
      : 'ผู้ขายไม่ได้ออกใบกำกับให้ตอนจ่าย — หักกลบกับรายการตั้งหนี้เมื่อได้ใบกำกับใบสุดท้าย (ภาษีซื้อเต็มในใบนั้น)',
  });
}
function scVendorDeposits() {
  const base = DB.docs.vendorDeposit.filter((d) => (periodOf(d.date) === STATE.period || depositLeft(d) > 0 || STATE.sel === d.no)
    && (hit(d.no) || hit(d.partnerName) || hit(d.desc || '') || hit(d.vendorNo || '')));
  const rows = base.filter((d) => chipPass('vdeposits', d));
  return (STATE.sel ? vendorDepositDetail(STATE.sel) : '') + card({
    title:'เงินมัดจำจ่าย · จ่ายล่วงหน้าให้ผู้ขาย',
    sub: thPeriod(STATE.period) + ' และรายการที่ยังมียอดเหลือ · ' + countNote(rows, 'รายการ'),
    actions: (depositUnallocated('ap') > 0 ? btn('settle:new:depbf:ap', 'ตั้งยอดยกมาเป็นรายใบ') : '')
      + btn('settle:new:vdeposit', '+ จ่ายเงินมัดจำ', periodIsOpen() ? 'primary' : 'disabled'),
    filters: listFilters('vdeposits', 'ค้นหาเลขที่ ผู้ขาย หรือรายการ', base),
    body: depositGapNote('ap') + tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้ขาย'},{t:'รายการ'},{t:'ใบกำกับผู้ขาย'},{t:'มูลค่า',a:'r'},{t:'ภาษีซื้อ',a:'r'},{t:'หัก ณ ที่จ่าย',a:'r'},{t:'คงเหลือ',a:'r'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, d.desc || '', d.vendorNo ? {mono:d.vendorNo} : {dim:'ไม่มี'},
        {n:d.base}, {n:d.vat}, {n:d.wht}, {n:depositLeft(d)}, depositPill(d)]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
      empty:'ไม่มีเงินมัดจำจ่ายในงวดนี้และไม่มีรายการที่ค้างอยู่',
      emptyAction: periodIsOpen() ? btn('settle:new:vdeposit', 'จ่ายเงินมัดจำ', 'primary') : '',
    }),
    foot:'ยอดคงเหลือคือเงินที่จ่ายผู้ขายไปแล้วแต่ยังไม่ได้หักกับรายการตั้งหนี้ — ต้องตรงกับบัญชีเงินมัดจำจ่าย',
  });
}
function vendorCnDetail(no) {
  const d = DB.docs.vendorCreditNote.find((x) => x.no === no);
  if (!d) return '';
  return card({
    title:'ใบลดหนี้จากผู้ขาย ' + d.vendorCnNo + ' (บันทึกเลขที่ ' + d.no + ')',
    sub:'วันที่ ' + thDate(d.date) + ' · ' + d.partnerName + ' · อ้างใบกำกับ ' + d.vendorNo + ' (' + d.billNo + ')',
    actions: btn('open:bills:' + d.billNo, 'ดูรายการตั้งหนี้ ' + d.billNo) + printBtn('vendorCreditNote', d.no)
      + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + voidBtn('vendorCreditNote', d) + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + '<div class="kv">' + [['เหตุที่ลดหนี้', d.reasonText], ['อัตราภาษี', TAX_CODE_LABEL[d.taxCode] || d.taxCode],
        ['มูลค่าที่ลด', fmt(d.base)], ['ภาษีซื้อลดลง' + (d.claimable ? '' : ' (ภาษีต้องห้าม)'), fmt(d.vat)], ['ลดเจ้าหนี้', fmt(d.total)],
        d.rest ? ['ส่วนลดลงบัญชี', d.acc + ' ' + acc(d.acc).name + ' ' + fmt(d.rest)] : null]
        .filter(Boolean).map((r) => '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>'
      + ((d.returns || []).length ? '<div class="sub-h">สินค้าที่ส่งคืน</div>' + tbl({
          cols:[{t:'สินค้า'},{t:'จำนวน',a:'r'},{t:'มูลค่าตามราคาซื้อ',a:'r'},{t:'ต้นทุนที่ตัดออกจากคลัง',a:'r'}],
          rows: d.returns.map((r) => [r.itemCode + ' ' + r.desc, {n:M(String(r.qty))}, {n:r.value}, {n:r.cost}]) }) : ''),
    foot: isVoid(d) ? 'ยกเลิกแล้ว — ภาษีซื้อในรายงานเป็นศูนย์ สินค้าที่ส่งคืนกลับเข้าคลัง'
      : 'ภาษีซื้อลดลงในรายงานภาษีซื้อเดือน ' + thPeriod(periodOf(d.date)) + ' (ยอดติดลบ) ไม่ย้อนไปแก้เดือนที่ยื่นแล้ว',
  });
}
function scVendorCns() {
  const base = DB.docs.vendorCreditNote.filter((d) => (periodOf(d.date) === STATE.period || STATE.sel === d.no)
    && (hit(d.no) || hit(d.partnerName) || hit(d.vendorCnNo) || hit(d.vendorNo) || hit(d.billNo)));
  const rows = base.filter((d) => chipPass('vendorcns', d));
  const t = liveOnly(rows).reduce((a, d) => ({ b: a.b + d.base, v: a.v + d.vat, t: a.t + d.total }), { b: 0, v: 0, t: 0 });
  return (STATE.sel ? vendorCnDetail(STATE.sel) : '') + card({
    title:'ใบลดหนี้จากผู้ขาย', sub: thPeriod(STATE.period) + ' · ' + countNote(rows, 'ใบ'),
    actions: btn('settle:new:vcn', '+ บันทึกใบลดหนี้จากผู้ขาย', periodIsOpen() ? 'primary' : 'disabled'),
    filters: listFilters('vendorcns', 'ค้นหาเลขที่ ผู้ขาย หรือใบกำกับเดิม', base),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ผู้ขาย'},{t:'เลขที่ใบลดหนี้'},{t:'อ้างใบกำกับ'},{t:'เหตุ'},{t:'มูลค่า',a:'r'},{t:'ภาษีซื้อ',a:'r'},{t:'รวม',a:'r'},{t:'สถานะ'}],
      rows: rows.map((d) => [{mono:d.no}, thDateNum(d.date), d.partnerName, {mono:d.vendorCnNo}, {mono:d.vendorNo}, d.reasonText,
        {n:d.base}, {n:d.vat}, {n:d.total}, statusPill(d.status || 'posted')]),
      rowAttr: (r, i) => rowCls(rows[i]) + ' data-act="sel:' + r[0].mono + '"',
      foot: rows.length ? ['รวม','','','','','', {n:t.b}, {n:t.v}, {n:t.t}, ''] : null,
      empty:'ไม่มีใบลดหนี้จากผู้ขายในงวดนี้',
    }),
    foot:'ภาษีซื้อที่ลดลงเข้ารายงานภาษีซื้อเดือนที่ได้รับใบลดหนี้ เป็นยอดติดลบอ้างใบกำกับเดิม',
  });
}
/** ใบหักกลบ คืนเงินมัดจำ และตัดหนี้สูญ — เอกสารที่ปิดยอดลูกหนี้/เจ้าหนี้โดยไม่ใช่ใบเสร็จหรือใบสำคัญจ่ายปกติ */
function offsetDetail(no) {
  const a = DB.docs.creditApply.find((x) => x.no === no);
  const w = a ? null : DB.docs.badDebt.find((x) => x.no === no);
  const d = a || w;
  if (!d) return '';
  const kind = a ? 'creditApply' : 'badDebt';
  const target = a ? (a.targetNo ? btn('open:' + (a.side === 'ar' ? 'invoices' : 'bills') + ':' + a.targetNo, 'ดู ' + a.targetNo) : '')
    : btn('open:invoices:' + w.invoiceNo, 'ดูใบกำกับ ' + w.invoiceNo);
  const kv = a ? [['ประเภท', a.mode === 'refund' ? 'คืนเงินให้ลูกค้า' : 'หักกลบเครดิต' + (a.side === 'ar' ? 'ของลูกค้า' : 'ของผู้ขาย')],
      ['ใช้เครดิตจาก', a.sourceLabel || a.sourceNo], a.targetNo ? ['ชำระ', a.targetNo] : null, ['จำนวนเงิน', fmt(a.amount)],
      a.vat ? ['ภาษีขายที่ลด', fmt(a.vat)] : null, a.cash ? ['เงินที่คืน', fmt(a.cash)] : null, a.note ? ['หมายเหตุ', a.note] : null]
    : [['ใบกำกับ', w.invoiceNo], ['ยอดที่ตัด (รวมภาษี)', fmt(w.amount)], ['วิธี', BAD_DEBT_METHOD[w.method].label],
      ['บัญชี', w.acc + ' ' + acc(w.acc).name], ['เหตุผล', w.reason]];
  return card({
    title: (a ? (a.mode === 'refund' ? 'คืนเงิน' : 'หักกลบเครดิต') : 'ตัดหนี้สูญ') + ' เลขที่ ' + d.no,
    sub:'วันที่ ' + thDate(d.date) + ' · ' + d.partnerName,
    actions: target + printBtn(kind, d.no) + btn('entry:' + d.entryNo, 'ดูใบสำคัญ') + voidBtn(kind, d) + btn('sel:', 'ปิด'),
    body: voidBanner(d) + '<div class="kv">' + kv.filter(Boolean).map((r) => '<div><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') + '</div>',
    foot: isVoid(d) ? 'ยกเลิกแล้ว — ยอดคงค้างของเอกสารที่เกี่ยวข้องกลับไปเหมือนเดิม' : 'ยกเลิกได้ ระบบกลับรายการใบสำคัญและคืนยอดคงค้าง/เครดิตให้ในครั้งเดียว',
  });
}
function scOffsets() {
  const inP = (d) => periodOf(d.date) === STATE.period || STATE.sel === d.no;
  const all = DB.docs.creditApply.map((d) => ({ d, kind: 'creditApply' })).concat(DB.docs.badDebt.map((d) => ({ d, kind: 'badDebt' })))
    .filter((x) => inP(x.d) && (hit(x.d.no) || hit(x.d.partnerName) || hit(x.d.targetNo || x.d.invoiceNo || '') || hit(x.d.sourceNo || '')))
    .sort((x, y) => (x.d.date < y.d.date ? 1 : x.d.date > y.d.date ? -1 : 0));
  const label = (x) => x.kind === 'badDebt' ? 'ตัดหนี้สูญ' : x.d.mode === 'refund' ? 'คืนเงิน' : x.d.side === 'ar' ? 'หักกลบ (ลูกค้า)' : 'หักกลบ (ผู้ขาย)';
  return (STATE.sel ? offsetDetail(STATE.sel) : '') + card({
    title:'หักกลบเครดิต · คืนเงินมัดจำ · ตัดหนี้สูญ', sub: thPeriod(STATE.period) + ' · ' + countNote(all.map((x) => x.d), 'รายการ'),
    filters: searchBox('ค้นหาเลขที่ คู่ค้า หรือเอกสารอ้างอิง'),
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ประเภท'},{t:'คู่ค้า'},{t:'จาก'},{t:'ชำระ / ใบกำกับ'},{t:'จำนวนเงิน',a:'r'},{t:'สถานะ'}],
      rows: all.map((x) => [{mono:x.d.no}, thDateNum(x.d.date), label(x), x.d.partnerName, {mono:x.d.sourceNo || '—'},
        {mono:x.d.targetNo || x.d.invoiceNo || '—'}, {n:x.d.amount}, statusPill(x.d.status || 'posted')]),
      rowAttr: (r, i) => rowCls(all[i].d) + ' data-act="sel:' + r[0].mono + '"',
      empty:'ไม่มีการหักกลบหรือตัดหนี้สูญในงวดนี้',
    }),
    foot:'หักกลบเครดิตกดได้ที่หน้าใบกำกับ/รายการตั้งหนี้ที่ค้าง หรือหน้าเงินมัดจำ · ตัดหนี้สูญกดที่หน้าใบกำกับ',
  });
}

/* ---------- ส่วนที่แทรกในหน้าใบกำกับ (ui-screens.js invoiceDetail) และรายการตั้งหนี้ ---------- */
function settleInvoiceActions(d) {
  if (isVoid(d)) return '';
  const out = invOutstanding(d);
  return (out > 0 && creditSources('ar', d.partnerCode).length ? btn('settle:apply:ar:tgt:' + d.no, 'หักกลบเครดิต') : '')
    + (out < 0 ? btn('settle:apply:ar:src:' + d.no, 'ใช้เครดิตกับใบอื่น') : '')
    + (out > 0 ? btn('settle:baddebt:' + d.no, 'ตัดหนี้สูญ') : '');
}
/** บรรทัดในกล่องยอดรวมของใบกำกับ — top: หักเงินมัดจำ (ก่อนมูลค่าที่เสียภาษี) · bottom: ยอดที่ปิดด้วยวิธีอื่นนอกจากรับเงิน */
function settleInvoiceTotals(d, where) {
  if (where === 'top') {
    return d.depositBase ? '<div><span>รวมรายการ</span><b>' + fmt(d.base + d.depositBase) + '</b></div>'
      + '<div><span>หักเงินมัดจำ</span><b>' + fmt(d.depositBase) + '</b></div>' : '';
  }
  const wo = d.writtenOff || 0;
  const other = (d.settled || 0) - wo;
  return (other ? '<div><span>หักกลบเครดิต/ปิดส่วนต่าง</span><b>' + fmt(other) + '</b></div>' : '')
    + (wo ? '<div><span>ตัดหนี้สูญ</span><b>' + fmt(wo) + '</b></div>' : '');
}
function settleInvoiceSection(d) {
  const apps = DB.docs.creditApply.filter((a) => a.side === 'ar' && (a.targetNo === d.no || (a.sourceKind === 'invoice' && a.sourceNo === d.no)));
  const bds = DB.docs.badDebt.filter((b) => b.invoiceNo === d.no);
  const rcd = DB.docs.receipt.filter((r) => r.invoiceNo === d.no && (r.diff || r.excess));
  let h = '';
  if ((d.deposits || []).length) {
    h += '<div class="note">หักเงินมัดจำ ' + d.deposits.map((r) => esc(r.no) + ' ' + fmt(r.base) + ' (ภาษี ' + fmt(r.vat) + ')').join(', ')
      + ' — รายการรวม ' + fmt(d.base + d.depositBase) + ' หักมัดจำ ' + fmt(d.depositBase) + ' คงเหลือมูลค่าที่เสียภาษีในใบนี้ ' + fmt(d.base)
      + ' · ภาษีของเงินมัดจำออกใบกำกับไปแล้วตอนรับเงิน</div>';
  }
  if (rcd.length) {
    h += '<div class="note">' + rcd.map((r) => esc(r.no) + (r.diff ? ' ปิดส่วนต่าง ' + fmt(r.diff) + ' เป็น' + esc((RECEIPT_DIFF[r.diffType] || {}).label || '') : '')
      + (r.excess ? ' รับเกิน ' + fmt(r.excess) + ' เก็บเป็นเครดิตของลูกค้า' : '') + (isVoid(r) ? ' (ยกเลิก)' : '')).join(' · ') + '</div>';
  }
  const rows = apps.map((a) => ({ d: a, cells: [{mono:a.no}, thDateNum(a.date), a.mode === 'refund' ? 'คืนเงิน'
      : a.targetNo === d.no ? 'ชำระด้วยเครดิต ' + a.sourceNo : 'ใช้เครดิตของใบนี้ชำระ ' + a.targetNo, {n:a.amount}, statusPill(a.status)] }))
    .concat(bds.map((b) => ({ d: b, cells: [{mono:b.no}, thDateNum(b.date), 'ตัดหนี้สูญ — ' + b.reason, {n:b.amount}, statusPill(b.status)] })));
  if (rows.length) {
    h += '<div class="sub-h">หักกลบ · ตัดหนี้สูญ</div>' + tbl({ cols:[{t:'เลขที่'},{t:'วันที่'},{t:'รายการ'},{t:'จำนวนเงิน',a:'r'},{t:'สถานะ'}],
      rows: rows.map((r) => r.cells), rowAttr: (r, i) => rowCls(rows[i].d) + ' data-act="open:offsets:' + rows[i].d.no + '"' });
  }
  return h;
}
function settleBillActions(d) {
  if (isVoid(d)) return '';
  const out = billOutstanding(d);
  return (billCreditableBase(d) > 0 ? btn('settle:vcn:' + d.no, 'บันทึกใบลดหนี้จากผู้ขาย') : '')
    + (out > 0 && creditSources('ap', d.partnerCode).length ? btn('settle:apply:ap:tgt:' + d.no, 'หักกลบเงินมัดจำ/เครดิต') : '')
    + (out < 0 ? btn('settle:apply:ap:src:' + d.no, 'ใช้เครดิตกับรายการอื่น') : '');
}
function settleBillSection(d) {
  const cns = DB.docs.vendorCreditNote.filter((c) => c.billNo === d.no);
  const apps = DB.docs.creditApply.filter((a) => a.side === 'ap' && (a.targetNo === d.no || (a.sourceKind === 'bill' && a.sourceNo === d.no)));
  let h = '';
  if ((d.deposits || []).length) {
    h += '<div class="note">หักเงินมัดจำจ่าย ' + d.deposits.map((r) => esc(r.no) + ' ' + fmt(r.base) + ' (ภาษี ' + fmt(r.vat) + ')').join(', ')
      + ' — ภาษีซื้อของเงินมัดจำขอคืนไปแล้วตอนจ่าย ใบนี้มีภาษีซื้อเฉพาะส่วนที่เหลือ ' + fmt(d.vat) + '</div>';
  }
  if (cns.length) {
    h += '<div class="sub-h">ใบลดหนี้จากผู้ขาย</div>' + tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'เลขที่ใบลดหนี้'},{t:'เหตุ'},{t:'รวม',a:'r'},{t:'สถานะ'}],
      rows: cns.map((c) => [{mono:c.no}, thDateNum(c.date), {mono:c.vendorCnNo}, c.reasonText, {n:c.total}, statusPill(c.status)]),
      rowAttr: (r, i) => rowCls(cns[i]) + ' data-act="open:vendorcns:' + cns[i].no + '"' });
  }
  if (apps.length) {
    h += '<div class="sub-h">หักกลบเงินมัดจำ/เครดิต</div>' + tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'รายการ'},{t:'จำนวนเงิน',a:'r'},{t:'สถานะ'}],
      rows: apps.map((a) => [{mono:a.no}, thDateNum(a.date), a.targetNo === d.no ? 'ชำระด้วย ' + (a.sourceLabel || a.sourceNo) : 'ใช้เครดิตของใบนี้ชำระ ' + a.targetNo,
        {n:a.amount}, statusPill(a.status)]),
      rowAttr: (r, i) => rowCls(apps[i]) + ' data-act="open:offsets:' + apps[i].no + '"' });
  }
  return h;
}

/* ===================================================================
   แบบฟอร์มพิมพ์
   =================================================================== */
function depositPrint(d, copy) {
  const vat = d.taxCode === 'VAT7';
  const how = PAY_METHOD[d.method] || d.method;
  return pSheet(pHead(vat ? 'ใบกำกับภาษี/ใบรับเงิน' : 'ใบรับเงินมัดจำ', vat ? 'TAX INVOICE / RECEIPT — DEPOSIT' : 'DEPOSIT RECEIPT', copy)
    + '<div class="p-meta">' + pParty('ได้รับเงินจาก', d.snap || { name: d.partnerName })
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ชำระโดย', how], ['อ้างอิง', d.ref || '']]) + '</div>'
    + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }], [['1', d.desc || 'เงินมัดจำ', pm(d.base)]], 6)
    + pTotals(d.total, [['มูลค่า' + (vat ? 'ที่เสียภาษี' : ''), pm(d.base)]].concat(vat ? [['ภาษีมูลค่าเพิ่ม 7%', pm(d.vat)]] : [])
      .concat([['จำนวนเงินรวมทั้งสิ้น', pm(d.total), !d.wht]])
      .concat(d.wht ? [['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)], ['รับสุทธิ', pm(d.net), true]] : []))
    + '<div class="p-note">เงินมัดจำนี้จะหักออกจากใบกำกับภาษีเมื่อส่งมอบสินค้าหรือบริการ'
    + (vat ? ' ภาษีมูลค่าเพิ่มของเงินมัดจำเรียกเก็บแล้วในใบนี้ ใบกำกับใบสุดท้ายจะเก็บเฉพาะส่วนที่เหลือ' : '') + '</div>'
    + pSign(['ผู้รับเงิน', 'ผู้มีอำนาจลงนาม']), d.no, isVoid(d) ? 'ยกเลิก' : '');
}
function vendorDepositPrint(d) {
  return pSheet(pHead('ใบสำคัญจ่าย (เงินมัดจำ)', 'PAYMENT VOUCHER — DEPOSIT')
    + '<div class="p-meta">' + pParty('จ่ายให้', partnerOf(d.partnerCode))
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ใบกำกับผู้ขาย', d.vendorNo || 'ไม่มี'], ['50 ทวิ', d.certNo || '']]) + '</div>'
    + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }], [['1', d.desc || 'เงินมัดจำ', pm(d.base)]], 4)
    + pTotals(d.net, [['มูลค่าก่อนภาษี', pm(d.base)], ['ภาษีซื้อ', pm(d.vat)], ['รวม', pm(d.total)],
      ['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)], ['จ่ายสุทธิ', pm(d.net), true]])
    + pEntry(d.entryNo) + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ', 'ผู้รับเงิน']), d.no, isVoid(d) ? 'ยกเลิก' : '');
}
function vendorCnPrint(d) {
  const rows = (d.returns || []).map((r, i) => [String(i + 1), 'ส่งคืน ' + r.itemCode + ' ' + r.desc + ' ' + r.qty + ' หน่วย', pm(r.value)])
    .concat(d.rest ? [[String((d.returns || []).length + 1), d.reasonText, pm(d.rest)]] : []);
  return pSheet(pHead('บันทึกรับใบลดหนี้จากผู้ขาย', 'VENDOR CREDIT NOTE RECORD')
    + '<div class="p-meta">' + pParty('ผู้ขาย', partnerOf(d.partnerCode))
    + pInfo([['เลขที่บันทึก', d.no], ['วันที่', thDate(d.date)], ['ใบลดหนี้ผู้ขาย', d.vendorCnNo], ['อ้างใบกำกับ', d.vendorNo]]) + '</div>'
    + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }], rows, 4)
    + pTotals(d.total, [['มูลค่าที่ลด', pm(d.base)], ['ภาษีซื้อที่ลด', pm(d.vat)], ['ลดเจ้าหนี้รวม', pm(d.total), true]])
    + pEntry(d.entryNo) + pSign(['ผู้บันทึก', 'ผู้ตรวจสอบ']), d.no, isVoid(d) ? 'ยกเลิก' : '');
}
function offsetPrint(d, copy) {
  const bad = !!d.invoiceNo && !d.side;
  const refund = d.mode === 'refund';
  const cn = refund && d.vat;
  const title = bad ? ['ใบสำคัญตัดหนี้สูญ', 'BAD DEBT WRITE-OFF'] : cn ? ['ใบลดหนี้ (คืนเงินมัดจำ)', 'CREDIT NOTE — DEPOSIT REFUND']
    : refund ? ['ใบสำคัญจ่ายคืนเงิน', 'REFUND VOUCHER'] : ['ใบสำคัญหักกลบลบหนี้', 'OFFSET VOUCHER'];
  const dep = refund ? DB.docs.customerDeposit.find((x) => x.no === d.sourceNo) : null;
  const rows = bad ? [['1', 'ตัดหนี้สูญใบกำกับ ' + d.invoiceNo + ' — ' + d.reason, pm(d.amount)]]
    : refund ? [['1', 'คืน' + (d.sourceLabel || d.sourceNo) + (d.reasonText ? ' — ' + d.reasonText : ''), pm(d.amount)]]
    : [['1', 'ใช้' + (d.sourceLabel || d.sourceNo) + ' ชำระ ' + d.targetNo, pm(d.amount)]];
  return pSheet(pHead(title[0], title[1], cn ? copy : null)
    + '<div class="p-meta">' + pParty(d.side === 'ap' ? 'ผู้ขาย' : 'ลูกค้า', dep && dep.snap ? dep.snap : partnerOf(d.partnerCode))
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['อ้างอิง', d.sourceNo || d.invoiceNo || '']]) + '</div>'
    + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }], rows, 4)
    + pTotals(refund ? d.cash : d.amount, refund ? [['มูลค่า', pm(d.amount)], ['ภาษีมูลค่าเพิ่ม', pm(d.vat || 0)], ['รวมเงินที่คืน', pm(d.cash), true]]
      : [['จำนวนเงิน', pm(d.amount), true]])
    + pEntry(d.entryNo) + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ']), d.no, isVoid(d) ? 'ยกเลิก' : '');
}
DOC_PRINT.customerDeposit = { title:'ใบรับเงินมัดจำ', copies:['ต้นฉบับ', 'สำเนา'],
  find: (no) => DB.docs.customerDeposit.find((d) => d.no === no && d.kind === 'deposit'), build: depositPrint };
DOC_PRINT.vendorDeposit = { title:'ใบสำคัญจ่ายเงินมัดจำ', find: (no) => DB.docs.vendorDeposit.find((d) => d.no === no && !d.broughtForward), build: vendorDepositPrint };
DOC_PRINT.vendorCreditNote = { title:'บันทึกรับใบลดหนี้จากผู้ขาย', find: (no) => DB.docs.vendorCreditNote.find((d) => d.no === no), build: vendorCnPrint };
DOC_PRINT.creditApply = { title:'ใบหักกลบ/คืนเงิน', copies:['ต้นฉบับ', 'สำเนา'], find: (no) => DB.docs.creditApply.find((d) => d.no === no), build: offsetPrint };
DOC_PRINT.badDebt = { title:'ใบสำคัญตัดหนี้สูญ', find: (no) => DB.docs.badDebt.find((d) => d.no === no), build: offsetPrint };

/* ===================================================================
   ลงทะเบียนหน้าจอ เมนูสร้างเอกสาร ตัวกรอง และตัวรับเหตุการณ์
   =================================================================== */
SCREENS.deposits = scDeposits;
SCREENS.vdeposits = scVendorDeposits;
SCREENS.vendorcns = scVendorCns;
SCREENS.offsets = scOffsets;
PAGE_INFO.deposits = { d:'รับเงินก่อนส่งมอบเป็นจุดความรับผิดภาษี (ม.78/1) — ออกใบกำกับเงินมัดจำและเสียภาษีขายตอนรับ แล้วหักในใบกำกับใบสุดท้าย ภาษีจึงไม่ซ้ำ · เงินรับเกินก็อยู่ที่นี่',
  je: [['dr', 'เงินสด/ธนาคาร · ภาษีถูกหัก ณ ที่จ่าย'], ['cr', 'เงินมัดจำรับ · ภาษีขาย']], book:'สมุดรายวันรับ' };
PAGE_INFO.vdeposits = { d:'จ่ายเงินล่วงหน้าให้ผู้ขาย — มีใบกำกับภาษีขอคืนภาษีซื้อได้ทันที แล้วหักในรายการตั้งหนี้ใบสุดท้าย · ค่าบริการหัก ณ ที่จ่ายตั้งแต่ตอนจ่าย',
  je: [['dr', 'เงินมัดจำจ่าย · ภาษีซื้อ'], ['cr', 'เงินสด/ธนาคาร · ภาษีหัก ณ ที่จ่ายค้างนำส่ง']], book:'สมุดรายวันจ่าย' };
PAGE_INFO.vendorcns = { d:'ผู้ขายลดราคา รับคืนสินค้า หรือคิดเงินเกินหลังตั้งหนี้ — ของที่คืนออกจากคลังที่ต้นทุนเฉลี่ย ภาษีซื้อลดในเดือนที่ได้รับใบลดหนี้',
  je: [['dr', 'เจ้าหนี้การค้า'], ['cr', 'สินค้าคงเหลือ/ส่วนลดรับ · ภาษีซื้อ']], book:'สมุดรายวันซื้อ' };
PAGE_INFO.offsets = { d:'ใช้เครดิตของลูกค้า/ผู้ขายชำระใบที่ค้าง คืนเงินมัดจำ และตัดหนี้สูญ — เป็นเอกสาร ยกเลิกได้ ยอดคงค้างรายใบตรงบัญชีคุมเสมอ',
  je: [['dr', 'เงินมัดจำรับ/ลูกหนี้ใบที่มีเครดิต · หนี้สูญ'], ['cr', 'ลูกหนี้ใบที่ค้าง']] };
FLOWS.sale.alt.push('deposits', 'offsets');
FLOWS.buy.alt = (FLOWS.buy.alt || []).concat(['vendorcns', 'vdeposits']);
FLOW_OF.deposits = 'sale'; FLOW_OF.offsets = 'sale'; FLOW_OF.vendorcns = 'buy'; FLOW_OF.vdeposits = 'buy';
LIST_CHIPS.deposits = [['all', 'ทั้งหมด'], ['open', 'ยังมียอดเหลือ', (d) => depositLeft(d) > 0],
  ['tax', 'ออกใบกำกับแล้ว', (d) => notVoid(d) && depositTaxable(d)], ['credit', 'เงินรับเกิน', (d) => notVoid(d) && d.kind === 'overpay'],
  ['bf', 'ยอดยกมา', (d) => notVoid(d) && !!d.broughtForward], ['void', 'ยกเลิก', isVoid]];
LIST_CHIPS.vdeposits = [['all', 'ทั้งหมด'], ['open', 'ยังมียอดเหลือ', (d) => depositLeft(d) > 0], ['void', 'ยกเลิก', isVoid]];
LIST_CHIPS.vendorcns = [['all', 'ทั้งหมด'], ['return', 'มีส่งคืนสินค้า', (d) => notVoid(d) && (d.returns || []).length > 0], ['void', 'ยกเลิก', isVoid]];
/* รายการตั้งหนี้ที่ค้างจากเดือนก่อนต้องเห็นได้ ไม่งั้นหน้ารายการแสดงเฉพาะเดือนนี้แล้วหนี้เก่าหายไปจากสายตา */
LIST_CHIPS.bills.splice(2, 0, ['allopen', 'ค้างชำระทุกเดือน', (d) => billOutstanding(d) > 0, { allPeriods: true }]);
Object.assign(SCREEN_DOC, { deposits:'customerDeposit', vdeposits:'vendorDeposit', vendorcns:'vendorCreditNote', offsets:'creditApply' });
Object.assign(DOC_SCREEN, { customerDeposit:'deposits', vendorDeposit:'vdeposits', vendorCreditNote:'vendorcns', creditApply:'offsets', badDebt:'offsets' });
Object.assign(ENTRY_SOURCE_SCREEN, { customerDeposit:'deposits', vendorDeposit:'vdeposits', vendorCreditNote:'vendorcns', creditApply:'offsets', badDebt:'offsets' });
(function () {
  const sec = (s) => CREATE_MENU.find((x) => x.s === s);
  const sale = sec('เอกสารขาย'), buy = sec('ซื้อและค่าใช้จ่าย');
  if (sale) sale.items.push(['settle:new:receivemany', 'รับชำระหลายใบกำกับ'], ['settle:new:deposit', 'รับเงินมัดจำ']);
  if (buy) buy.items.push(['settle:new:vdeposit', 'จ่ายเงินมัดจำ'], ['settle:new:vcn', 'ใบลดหนี้จากผู้ขาย']);
})();

const SETTLE_SCREENS = { deposits:'customerDeposit', vdeposits:'vendorDeposit', vendorcns:'vendorCreditNote', offsets:null };
EXTRA_DISPATCH.push(function (head, rest) {
  /* เปิดเอกสารจากหน้าอื่น — เลื่อนงวดตามวันที่เอกสารให้ด้วย */
  if (head === 'open' && rest[0] in SETTLE_SCREENS) {
    const no = rest.slice(1).join(':');
    const coll = SETTLE_SCREENS[rest[0]];
    const doc = coll ? DB.docs[coll].find((d) => d.no === no)
      : DB.docs.creditApply.find((d) => d.no === no) || DB.docs.badDebt.find((d) => d.no === no);
    if (doc && DB.periods.some((p) => p.code === periodOf(doc.date))) STATE.period = periodOf(doc.date);
    STATE.screen = rest[0]; STATE.sel = no; STATE.filter = '';
    render();
    return true;
  }
  if (head !== 'settle') return false;
  const what = rest[0];
  const needOpen = () => {
    if (periodIsOpen()) return true;
    toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน');
    return false;
  };
  if (what === 'new' && rest[1] === 'depbf') { modalDepositBalance(rest[2]); return true; }
  if (what === 'cancelbf') {
    const side = rest[1], no = rest.slice(2).join(':');
    modalReason({ title:'ยกเลิกเงินมัดจำยกมา ' + no, sub:'ยอดกลับไปเป็นยอดในบัญชีที่ยังไม่มีรายใบ — ไม่มีใบสำคัญให้กลับรายการ',
      placeholder:'เช่น ตั้งผิดลูกค้า', submitLabel:'ยกเลิกยอดยกมา', done:'ยกเลิกเงินมัดจำยกมา ' + no + ' แล้ว',
      run: (r) => cancelDepositBalance(side, no, r) });
    return true;
  }
  if (what === 'new') {
    if (!needOpen()) return true;
    if (rest[1] === 'deposit') modalCustomerDeposit();
    if (rest[1] === 'vdeposit') modalVendorDeposit();
    if (rest[1] === 'vcn') modalVendorCn(null);
    if (rest[1] === 'receivemany') modalReceiveMany();
    return true;
  }
  if (what === 'apply') { modalApplyCredit(rest[1], rest[2] === 'tgt' ? { targetNo: rest.slice(3).join(':') } : { sourceNo: rest.slice(3).join(':') }); return true; }
  if (what === 'refund') { modalRefundCredit(rest.slice(1).join(':')); return true; }
  if (what === 'baddebt') { modalBadDebt(rest.slice(1).join(':')); return true; }
  if (what === 'vcn') { modalVendorCn(rest.slice(1).join(':')); return true; }
  return false;
});
EXTRA_CHANGE.push(function (t) {
  const n = t.name || '';
  let handled = false;
  /* เปลี่ยนวิธีรับ/จ่ายเงิน — เงินสดลงบัญชีเงินสด โอน/เช็คลงบัญชีธนาคาร */
  if (n === 'method') {
    const sel = document.querySelector('[name="bankAccount"]') || document.querySelector('[name="payFrom"]');
    if (sel) sel.value = cashAccDefault(document.querySelector('[name="cashDir"]') ? val('cashDir') : 'out', t.value);
  } else if (n === 'partner' && document.getElementById('invDeps')) {
    document.getElementById('invDeps').innerHTML = depositPicker('ar', t.value);
  } else if (n === 'vdPartner') {
    const p = DB.partners.find((x) => x.code === t.value);
    const w = document.querySelector('[name="wht"]');
    if (p && w) w.value = p.whtCode || '';
    handled = true;
  } else if (n === 'rmPartner') {
    const box = document.getElementById('rmInvoices');
    if (box) box.innerHTML = rmInvoiceRows(t.value);
    return true;
  } else if (n === 'vcnBill' && t.tagName === 'SELECT') {
    modalVendorCn(t.value, true);
    return true;
  }
  if (document.getElementById('rcSum')) refreshReceiptSum();
  else if (document.getElementById('pvSum')) refreshPaySum();
  else if (document.getElementById('depSum')) refreshDepositSum();
  else if (document.getElementById('vcnSum')) refreshVcnSum();
  return handled;
});
EXTRA_INPUT.push(function (t) {
  if (document.getElementById('rcSum')) refreshReceiptSum();
  else if (document.getElementById('pvSum')) refreshPaySum();
  else if (document.getElementById('depSum')) refreshDepositSum();
  else if (document.getElementById('vcnSum')) refreshVcnSum();
  else return false;
  return /^(amount|whtBase|whtAmount|fee|base|vr\d+|depAmt_.*)$/.test(t.name || '');
});
