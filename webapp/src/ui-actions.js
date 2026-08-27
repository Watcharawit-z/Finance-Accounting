/* ===================================================================
   การกระทำของผู้ใช้ — ปุ่มทุกปุ่มในระบบวิ่งมาจบที่นี่
   =================================================================== */

function defaultDate() {
  return periodOf(TODAY) === STATE.period ? TODAY : pEnd();
}
const optCustomers = () => DB.partners.filter((p) => p.kind === 'customer').map((p) => [p.code, p.name]);
const optVendors   = () => DB.partners.filter((p) => p.kind === 'vendor').map((p) => [p.code, p.name]);
const optAccounts  = () => DB.accounts.filter((a) => a.postable).map((a) => [a.code, a.code + ' ' + a.name]);
const optItems     = () => [['', '— เลือกสินค้าหรือบริการ —']]
  .concat(DB.items.map((i) => [i.code, i.code + ' · ' + i.name]));
const optWht = (blank) => [['', blank || '— ไม่หักภาษี ณ ที่จ่าย —']].concat(
  ['WHT_SERVICE','WHT_RENT','WHT_TRANSPORT','WHT_ADVERT','WHT_PROF','WHT_CONTRACT'].map(function (c) {
    const r = resolveRate(c, TODAY, { channel: 'manual' });
    return [c, r.label + ' ' + r.rate + '%'];
  }));
const optVat = [['VAT7','ภาษีมูลค่าเพิ่ม 7%'], ['VAT0','อัตราร้อยละ 0 (ส่งออก)'], ['EXEMPT','ยกเว้นภาษี']];

function submitAction(fn) {
  try {
    const r = fn();
    closeModal(); save(); render();
    return r;
  } catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    return null;
  }
}

/* ---------- ออกใบกำกับภาษี ---------- */
function lineEditor(n) {
  let h = '<div class="sub-h">รายการสินค้าหรือบริการ</div><div class="scroll"><table class="lines"><thead><tr>'
    + '<th>สินค้า/บริการ</th><th>คำอธิบายบนใบกำกับ</th><th class="r">จำนวน</th><th class="r">ราคาต่อหน่วย</th><th>ภาษี</th></tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    h += '<tr>'
      + '<td><select name="l' + i + '_item" class="itemsel" data-i="' + i + '">'
        + optItems().map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></td>'
      + '<td><input name="l' + i + '_desc" placeholder="พิมพ์เองได้"></td>'
      + '<td><input name="l' + i + '_qty" class="r" value="' + (i === 0 ? '1' : '') + '"></td>'
      + '<td><input name="l' + i + '_price" class="r"></td>'
      + '<td><select name="l' + i + '_tax">'
        + optVat.map((o) => '<option value="' + o[0] + '">' + esc(o[1]) + '</option>').join('') + '</select></td>'
      + '</tr>';
  }
  return h + '</tbody></table></div>';
}
function collectLines(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const code = val('l' + i + '_item');
    const desc = val('l' + i + '_desc');
    const qty = val('l' + i + '_qty');
    const price = val('l' + i + '_price');
    if (!code && !desc.trim()) continue;
    if (!price || M(price) === 0) continue;
    const it = DB.items.find((x) => x.code === code);
    out.push({
      itemCode: it && it.type === 'stock' ? it.code : null,
      desc: desc.trim() || (it ? it.name : ''),
      qty: Number(qty || 1) || 1,
      price: price,
      taxCode: val('l' + i + '_tax') || 'VAT7',
      revenueSub: it && it.type === 'service' ? 'service_revenue' : 'sales_revenue',
    });
  }
  return out;
}

function modalInvoice() {
  modal({
    title:'ออกใบกำกับภาษี/ใบส่งของ',
    sub:'ระบบจะตรวจความครบถ้วนตามมาตรา 86/4 ก่อนจองเลขที่เอกสาร',
    body:'<div class="flds">'
      + field({ name:'partner', label:'ลูกค้า', type:'select', options: optCustomers() })
      + field({ name:'date', label:'วันที่ออกเอกสาร', type:'date', value: defaultDate(),
          hint:'ต้องอยู่ในงวดที่ยังเปิดอยู่ ระบบจะเลือกอัตราภาษีตามวันที่นี้' })
      + '</div>' + lineEditor(4),
    submitLabel:'ลงบัญชีและออกเลขที่',
    note:'เลขที่เอกสารจะถูกจองเมื่อลงบัญชีสำเร็จเท่านั้น',
    onSubmit: function () {
      submitAction(function () {
        const doc = issueInvoice({
          partnerCode: val('partner'), date: val('date'), lines: collectLines(4),
        });
        STATE.screen = 'invoices'; STATE.sel = doc.no;
        toast('ออกใบกำกับภาษี ' + doc.no + ' แล้ว', 'ok', 'รวมทั้งสิ้น ' + fmt(doc.total) + ' บาท');
        return doc;
      });
    },
  });
}

function modalReceive(no) {
  const inv = DB.docs.invoice.find((d) => d.no === no);
  if (!inv) return;
  const out = invOutstanding(inv);
  modal({
    title:'รับชำระเงินจากใบกำกับ ' + no,
    sub: inv.partnerName + ' · คงเหลือ ' + fmt(out) + ' บาท',
    body:'<div class="flds">'
      + field({ name:'amount', label:'จำนวนเงินที่รับ (ก่อนหักภาษี ณ ที่จ่าย)', value: fmt(out) })
      + field({ name:'date', label:'วันที่รับชำระ', type:'date', value: defaultDate() })
      + field({ name:'method', label:'วิธีรับชำระ', type:'select', value:'transfer',
          options:[['transfer','โอนเงินเข้าบัญชี'],['cheque','เช็ค'],['cash','เงินสด']] })
      + field({ name:'wht', label:'ลูกค้าหักภาษี ณ ที่จ่ายหรือไม่', type:'select',
          options: optWht('ไม่ได้ถูกหัก'), hint:'ถ้าถูกหัก ระบบจะบันทึกเป็นสินทรัพย์รอเครดิตภาษีปลายปี' })
      + '</div>',
    submitLabel:'รับชำระและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const r = receivePayment({ invoiceNo: no, amount: val('amount'), date: val('date'),
          method: val('method'), whtCode: val('wht') || null });
        toast('บันทึกใบเสร็จ ' + r.no + ' แล้ว', 'ok',
          'รับสุทธิ ' + fmt(r.net) + ' บาท' + (r.wht ? ' (ถูกหักไว้ ' + fmt(r.wht) + ')' : ''));
        return r;
      });
    },
  });
}

function modalCreditNote(no) {
  const inv = DB.docs.invoice.find((d) => d.no === no);
  if (!inv) return;
  modal({
    title:'ออกใบลดหนี้อ้างใบกำกับ ' + no,
    sub:'ออกได้เฉพาะเหตุที่มาตรา 86/10 กำหนดเท่านั้น',
    body:'<div class="flds">'
      + field({ name:'base', label:'มูลค่าที่ลด (ก่อนภาษี)', value:'0',
          hint:'ลดได้ไม่เกินมูลค่าคงเหลือของใบกำกับเดิม ' + fmt(inv.base - inv.credited) + ' บาท' })
      + field({ name:'date', label:'วันที่ออกใบลดหนี้', type:'date', value: defaultDate() })
      + field({ name:'reason', label:'เหตุแห่งการลดหนี้', type:'select', wide:true,
          options: Object.keys(CN_REASONS).map((k) => [k, CN_REASONS[k]]) })
      + '</div>',
    submitLabel:'ออกใบลดหนี้',
    onSubmit: function () {
      submitAction(function () {
        const c = issueCreditNote({ invoiceNo: no, base: val('base'), date: val('date'), reason: val('reason') });
        toast('ออกใบลดหนี้ ' + c.no + ' แล้ว', 'ok', 'ลดภาษีขาย ' + fmt(c.vat) + ' บาทในงวดนี้');
        return c;
      });
    },
  });
}

/* ---------- ยกเลิกการนำเข้า ---------- */
function modalUndoImport(no) {
  const im = listImports().find((x) => x.no === no);
  if (!im) return;
  modal({
    title:'ยกเลิกการนำเข้า ' + no,
    sub: (im.kind === 'movement' ? 'ยอดเคลื่อนไหว ' + thPeriod(im.key) : 'ยอดยกมา')
      + ' · ' + im.lines + ' บัญชี · รวม ' + fmt(im.total) + ' บาท',
    body:'<div class="prose"><p>ระบบจะสร้างใบสำคัญ<b>กลับรายการ</b>คู่กับใบเดิม '
      + 'ไม่ได้ลบใบเดิมทิ้ง ตาม พ.ร.บ.การบัญชี มาตรา 20 '
      + 'หลังจากนี้ยอดจะกลับไปเหมือนก่อนนำเข้า และนำเข้าไฟล์ใหม่ทับได้เลย</p>'
      + '<p class="dim">บัญชีที่ระบบสร้างไว้ตอนนำเข้ายังอยู่ในผังบัญชี ยอดเป็นศูนย์ '
      + 'ไม่ต้องลบ เพราะไฟล์ที่นำเข้าใหม่จะใช้รหัสเดียวกัน</p></div>'
      + '<div class="flds">'
      + field({ name:'reason', label:'เหตุผล (ผู้สอบบัญชีจะเห็นข้อความนี้)', wide:true,
          value:'นำเข้าผิดชุดตัวเลข ต้องนำเข้าใหม่ให้ถูกต้อง' })
      + '</div>',
    submitLabel:'ยกเลิกการนำเข้า',
    onSubmit: function () {
      submitAction(function () {
        const rev = reverseImport(no, val('reason'));
        STATE.screen = 'import'; STATE.imp = null;
        toast('ยกเลิกการนำเข้า ' + no + ' แล้ว', 'ok', 'ใบกลับรายการ ' + rev.no);
        return rev;
      });
    },
  });
}

function modalDebitNote(no) {
  const inv = DB.docs.invoice.find((d) => d.no === no);
  if (!inv) return;
  modal({
    title:'ออกใบเพิ่มหนี้อ้างใบกำกับ ' + no,
    sub:'ใช้เมื่อเรียกเก็บเงินต่ำกว่าที่ควร ออกได้เฉพาะเหตุตามมาตรา 86/9',
    body:'<div class="flds">'
      + field({ name:'base', label:'มูลค่าที่เพิ่ม (ก่อนภาษี)', value:'0',
          hint:'ยอดเดิมของใบกำกับก่อนภาษีคือ ' + fmt(inv.base) + ' บาท' })
      + field({ name:'date', label:'วันที่ออกใบเพิ่มหนี้', type:'date', value: defaultDate() })
      + field({ name:'reason', label:'เหตุแห่งการเพิ่มหนี้', type:'select', wide:true,
          options: Object.keys(DN_REASONS).map((k) => [k, DN_REASONS[k]]) })
      + '</div>',
    submitLabel:'ออกใบเพิ่มหนี้',
    note:'อย่าออกใบกำกับภาษีใบใหม่ทับ เพราะรายได้และภาษีขายจะถูกนับซ้ำสองรอบ',
    onSubmit: function () {
      submitAction(function () {
        const c = issueDebitNote({ invoiceNo: no, base: val('base'), date: val('date'), reason: val('reason') });
        toast('ออกใบเพิ่มหนี้ ' + c.no + ' แล้ว', 'ok', 'เพิ่มภาษีขาย ' + fmt(c.vat) + ' บาทในงวดนี้');
        return c;
      });
    },
  });
}

/* ---------- ใบเสนอราคา / ใบสั่งขาย / ใบสั่งซื้อ ---------- */
function modalTradeDoc(kind) {
  const cfg = TRADE_DOCS[kind];
  const isCust = cfg.side === 'customer';
  modal({
    title:'ออก' + cfg.label,
    sub:'ยังไม่ลงบัญชี ตัวเลขจะเข้าบัญชีตอนแปลงเป็นเอกสารขั้นถัดไป',
    body:'<div class="flds">'
      + field({ name:'partner', label: isCust ? 'ลูกค้า' : 'ผู้ขาย', type:'select',
          options: isCust ? optCustomers() : optVendors() })
      + field({ name:'date', label:'วันที่ออกเอกสาร', type:'date', value: defaultDate() })
      + (cfg.validDays
          ? field({ name:'validUntil', label:'ยืนราคาถึงวันที่', type:'date',
              value: addDays(defaultDate(), cfg.validDays),
              hint:'พ้นวันนี้แล้วระบบจะขึ้นสถานะหมดอายุให้เอง' })
          : '')
      + field({ name:'note', label:'หมายเหตุ', wide:true, placeholder:'เงื่อนไขการชำระเงิน กำหนดส่งมอบ ฯลฯ' })
      + '</div>' + lineEditor(4),
    submitLabel:'บันทึก' + cfg.label,
    onSubmit: function () {
      submitAction(function () {
        const doc = issueTradeDoc(kind, {
          partnerCode: val('partner'), date: val('date'),
          validUntil: cfg.validDays ? (val('validUntil') || null) : null,
          note: val('note'), lines: collectLines(4),
        });
        STATE.screen = { quotation:'quotations', salesOrder:'salesorders', purchaseOrder:'purchaseorders' }[kind];
        STATE.sel = doc.no;
        toast('บันทึก' + cfg.label + ' ' + doc.no + ' แล้ว', 'ok', 'รวมทั้งสิ้น ' + fmt(doc.total) + ' บาท');
        return doc;
      });
    },
  });
}

function modalConvertTradeDoc(kind, no) {
  const cfg = TRADE_DOCS[kind];
  const d = DB.docs[kind].find((x) => x.no === no);
  if (!d) return;
  const toBill = cfg.next === 'bill';
  const nextLabel = cfg.next === 'salesOrder' ? 'ใบสั่งขาย'
    : cfg.next === 'invoice' ? 'ใบกำกับภาษี' : 'รายการตั้งหนี้';
  const expOpts = [
    ['inventory','ซื้อสินค้าเข้าคลัง'],
    ['admin_expense','ค่าใช้จ่ายในการบริหาร'],
    ['selling_expense','ค่าใช้จ่ายในการขาย'],
    ['ppe','ซื้อทรัพย์สินถาวร'],
    ['finance_cost','ค่าธรรมเนียมและดอกเบี้ย'],
  ];
  modal({
    title:'แปลง' + cfg.label + ' ' + no + ' เป็น' + nextLabel,
    sub: d.partnerName + ' · รวม ' + fmt(d.total) + ' บาท · ' + d.lines.length + ' รายการ',
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่ของ' + nextLabel, type:'date', value: defaultDate(),
          hint: cfg.next === 'salesOrder' ? '' : 'ต้องอยู่ในงวดที่ยังเปิดอยู่ ระบบจะเลือกอัตราภาษีตามวันที่นี้' })
      + (toBill ? field({ name:'vendorNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'ดูจากใบกำกับที่ผู้ขายส่งมา' }) : '')
      + (toBill ? field({ name:'expenseSub', label:'บันทึกเข้าบัญชี', type:'select', value:'admin_expense', options: expOpts }) : '')
      + (toBill ? field({ name:'wht', label:'ภาษีหัก ณ ที่จ่ายตอนจ่ายเงิน', type:'select', options: optWht() }) : '')
      + '</div>',
    submitLabel:'แปลงเป็น' + nextLabel,
    note: cfg.next === 'salesOrder' ? 'ยังไม่ลงบัญชีในขั้นนี้'
      : 'ขั้นนี้จะลงบัญชีจริงและจองเลขที่เอกสาร',
    onSubmit: function () {
      submitAction(function () {
        const made = convertTradeDoc(kind, no, {
          date: val('date'), vendorNo: toBill ? val('vendorNo') : null,
          expenseSub: toBill ? val('expenseSub') : null,
          whtCode: toBill ? (val('wht') || null) : null,
        });
        STATE.sel = null;
        toast('แปลงเป็น ' + made.no + ' แล้ว', 'ok', cfg.label + ' ' + no + ' ปิดรายการแล้ว');
        return made;
      });
    },
  });
}

/* ---------- ตั้งหนี้ผู้ขาย ---------- */
function modalBill() {
  const expOpts = [
    ['inventory','ซื้อสินค้าเข้าคลัง'],
    ['admin_expense','ค่าใช้จ่ายในการบริหาร'],
    ['selling_expense','ค่าใช้จ่ายในการขาย'],
    ['ppe','ซื้อทรัพย์สินถาวร'],
    ['finance_cost','ค่าธรรมเนียมและดอกเบี้ย'],
  ];
  modal({
    title:'บันทึกใบกำกับภาษีซื้อ',
    sub:'ระบบกันการบันทึกเลขที่ใบกำกับซ้ำของผู้ขายรายเดียวกัน',
    body:'<div class="flds">'
      + field({ name:'partner', label:'ผู้ขาย', type:'select', options: optVendors() })
      + field({ name:'vendorNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'เช่น IV6907-0245' })
      + field({ name:'date', label:'วันที่ตามใบกำกับ', type:'date', value: defaultDate() })
      + field({ name:'expenseSub', label:'บันทึกเข้าบัญชี', type:'select', value:'admin_expense', options: expOpts })
      + field({ name:'item', label:'สินค้า (เฉพาะกรณีซื้อเข้าคลัง)', type:'select', options: optItems() })
      + field({ name:'desc', label:'คำอธิบายรายการ', wide:true, placeholder:'เช่น ค่าเช่าสำนักงานเดือนกรกฎาคม' })
      + field({ name:'qty', label:'จำนวน', value:'1' })
      + field({ name:'price', label:'ราคาต่อหน่วย (ก่อนภาษี)' })
      + field({ name:'tax', label:'ภาษีมูลค่าเพิ่ม', type:'select', options: optVat })
      + field({ name:'claim', label:'สิทธิภาษีซื้อ', type:'select', value:'yes',
          options:[['yes','ขอคืนได้'],['no','ภาษีซื้อต้องห้าม ตามมาตรา 82/5']] })
      + field({ name:'wht', label:'ภาษีหัก ณ ที่จ่ายตอนจ่ายเงิน', type:'select', options: optWht() })
      + '</div>',
    submitLabel:'ตั้งหนี้และลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const sub = val('expenseSub');
        const itemCode = sub === 'inventory' ? (val('item') || null) : null;
        const it = DB.items.find((x) => x.code === itemCode);
        const b = recordBill({
          partnerCode: val('partner'), vendorNo: val('vendorNo').trim(), date: val('date'),
          nonClaimableVat: val('claim') === 'no', whtCode: val('wht') || null,
          lines: [{
            desc: val('desc').trim() || (it ? it.name : ''),
            qty: Number(val('qty') || 1) || 1, price: val('price'),
            taxCode: val('tax'), expenseSub: sub, itemCode: itemCode,
          }],
        });
        STATE.screen = 'bills'; STATE.sel = b.no;
        toast('ตั้งหนี้ ' + b.no + ' แล้ว', 'ok', 'รวมทั้งสิ้น ' + fmt(b.total) + ' บาท');
        return b;
      });
    },
  });
}

function modalPayBill(no) {
  const b = DB.docs.bill.find((x) => x.no === no);
  if (!b) return;
  const out = b.total - b.paid;
  modal({
    title:'จ่ายชำระ ' + no,
    sub: b.partnerName + ' · คงเหลือ ' + fmt(out) + ' บาท',
    body:'<div class="flds">'
      + field({ name:'amount', label:'จำนวนเงินที่จ่าย (ก่อนหักภาษี ณ ที่จ่าย)', value: fmt(out) })
      + field({ name:'date', label:'วันที่จ่าย', type:'date', value: defaultDate() })
      + field({ name:'wht', label:'ประเภทเงินได้ที่ต้องหักภาษี', type:'select',
          value: b.whtCode || '', options: optWht() })
      + field({ name:'channel', label:'ช่องทางนำส่งภาษี', type:'select', value:'manual', wide:true,
          options:[['manual','หักและนำส่งเอง — ระบบจะออกหนังสือรับรอง 50 ทวิ ให้'],
                   ['e_wht','e-Withholding Tax — ธนาคารนำส่งและออกหลักฐานให้']],
          hint:'ช่องทาง e-Withholding Tax ใช้อัตราลด 1% และระบบจะกันรายการนี้ออกจากแบบ ภ.ง.ด. อัตโนมัติ' })
      + '</div>',
    submitLabel:'จ่ายและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const p = payBill({ billNo: no, amount: val('amount'), date: val('date'),
          whtCode: val('wht') || null, channel: val('channel') });
        toast('บันทึกใบสำคัญจ่าย ' + p.no + ' แล้ว', 'ok',
          'จ่ายสุทธิ ' + fmt(p.net) + ' บาท' + (p.certNo ? ' · ออก 50 ทวิ เลขที่ ' + p.certNo : ''));
        return p;
      });
    },
  });
}

/* ---------- อื่น ๆ ---------- */
function modalBankBook(id) {
  const t = DB.bankTxns.find((x) => x.id === Number(id));
  if (!t) return;
  const guess = t.credit > 0 ? 'interest_income' : 'finance_cost';
  let guessCode = '';
  try { guessCode = accBySub(guess); } catch (e) { guessCode = ''; }
  modal({
    title:'บันทึกรายการจากสเตทเมนต์',
    sub: thDate(t.date) + ' · ' + t.desc + ' · ' + (t.credit > 0 ? 'เงินเข้า ' + fmt(t.credit) : 'เงินออก ' + fmt(t.debit)),
    body:'<div class="flds">'
      + field({ name:'acc', label:'บันทึกคู่กับบัญชี', type:'select', wide:true,
          value: guessCode, options: optAccounts() })
      + field({ name:'desc', label:'คำอธิบายรายการ', wide:true, value: t.desc })
      + '</div>',
    submitLabel:'ลงบัญชีและกระทบยอด',
    onSubmit: function () {
      submitAction(function () {
        const je = bookBankTxn(Number(id), val('acc'), val('desc'));
        toast('ลงบัญชีเป็นใบสำคัญ ' + je.no + ' แล้ว', 'ok', 'รายการนี้กระทบยอดเรียบร้อย');
        return je;
      });
    },
  });
}

function modalReverse(no) {
  modal({
    title:'กลับรายการใบสำคัญ ' + no,
    sub:'ใบสำคัญที่ลงบัญชีแล้วแก้ไขไม่ได้ ต้องกลับรายการเท่านั้น',
    body:'<div class="flds">'
      + field({ name:'reason', label:'เหตุผล', wide:true, placeholder:'อธิบายให้ผู้สอบบัญชีเข้าใจได้ อย่างน้อย 5 ตัวอักษร' })
      + field({ name:'date', label:'วันที่กลับรายการ', type:'date', value: defaultDate() })
      + '</div>',
    submitLabel:'กลับรายการ',
    onSubmit: function () {
      submitAction(function () {
        const r = reverse(no, val('reason'), val('date'));
        STATE.sel = r.no;
        toast('กลับรายการแล้วด้วยใบสำคัญ ' + r.no, 'ok', 'ใบสำคัญเดิมยังอยู่ในระบบและถูกทำเครื่องหมายไว้');
        return r;
      });
    },
  });
}

function modalReopen() {
  modal({
    title:'ขอเปิดงวด ' + thPeriod(STATE.period) + ' ใหม่',
    sub:'การเปิดงวดที่ปิดแล้วจะถูกบันทึกในร่องรอยการตรวจสอบถาวร',
    body:'<div class="flds">'
      + field({ name:'reason', label:'เหตุผลที่ต้องเปิดงวด', wide:true,
          placeholder:'เช่น พบใบกำกับภาษีซื้อที่ผู้ขายส่งมาภายหลัง' }) + '</div>',
    submitLabel:'เปิดงวด',
    onSubmit: function () {
      submitAction(function () {
        reopenPeriod(STATE.period, val('reason'));
        toast('เปิดงวด ' + thPeriod(STATE.period) + ' แล้ว', 'ok');
      });
    },
  });
}

/* ===================================================================
   ตัวรับเหตุการณ์
   =================================================================== */
function dispatch(act) {
  const [head, ...rest] = act.split(':');
  const arg = rest.join(':');

  if (head === 'go')      { STATE.screen = arg; STATE.sel = null; STATE.filter = ''; render(); return; }
  if (head === 'nav') {
    const cur = STATE.navOpen[arg] === undefined ? arg === navSubOf(STATE.screen) : STATE.navOpen[arg];
    STATE.navOpen[arg] = !cur;
    render();
    return;
  }
  if (head === 'period')  { STATE.period = arg; STATE.sel = null; save(); render(); return; }
  if (head === 'sel')     { STATE.sel = arg || null; render(); return; }
  if (head === 'drill')   { STATE.drill = arg; STATE.screen = 'ledger'; STATE.filter = ''; render(); return; }
  if (head === 'entry')   { STATE.screen = 'journals'; STATE.sel = arg; render(); return; }
  if (head === 'print')   { window.print(); return; }
  if (head === 'view')    { STATE.dashView = arg; render(); return; }
  if (head === 'pick')    { document.getElementById('file').click(); return; }
  if (head === 'blank')   { modalBlank(); return; }
  if (head === 'company')  { if (arg === 'new') modalNewCompany(); return; }
  if (head === 'pass') {
    const code = val('passcode');
    syncUnlock(code).then(function (ok) {
      STATE.passWrong = !ok;
      render();
      if (ok) toast('เปิดสมุดบัญชีแล้ว', 'ok', 'ข้อมูลชุดนี้เก็บบนเซิร์ฟเวอร์');
    });
    return;
  }
  if (head === 'imp') {
    if (arg === 'reset') { STATE.imp = null; render(); return; }
    if (arg === 'run') {
      const I = STATE.imp;
      if (!I || !I.tb) return;
      runAction(function () {
        const movement = I.mode === 'movement';
        const period = I.period || STATE.period;
        const asOf = movement ? endOfMonth(period + '-01') : (val('cutoff') || pStart());
        const r = movement
          ? importPeriodMovement(I.tb.rows, period, I.overrides || {})
          : importOpeningBalances(I.tb.rows, asOf, I.overrides || {});
        const rec = reconciliationChecks(asOf);
        STATE.impResult = {
          cutoff: asOf, source: 'ไฟล์ ' + I.name, mode: I.mode || 'opening', period: period,
          partners: 0, partnersSeen: 0, items: 0, itemsSeen: 0, invoices: 0, bills: 0,
          opening: r, warnings: [], checks: rec.checks, allPassed: rec.allPassed,
        };
        STATE.screen = 'importResult';
        STATE.imp = null;
        toast(movement
          ? 'ลงยอดเคลื่อนไหวงวด ' + thPeriod(period) + ' แล้ว'
          : 'ตั้งยอดยกมา ' + r.accounts + ' บัญชีแล้ว', 'ok', 'ใบสำคัญ ' + r.entry.no);
      });
    }
    return;
  }
  if (head === 'reset')   {
    if (window.confirm('ล้างข้อมูลตัวอย่างทั้งหมดและสร้างใหม่?')) resetAll();
    return;
  }
  if (head === 'modal')   { if (arg === 'close') closeModal(); else if (modalSubmit) modalSubmit(); return; }

  if (head === 'new') {
    /* เอกสารก่อนลงบัญชีไม่ผูกกับงวด ออกได้แม้งวดปัจจุบันปิดแล้ว
       ส่วนใบที่ลงบัญชีจริงต้องอยู่ในงวดที่ยังเปิด */
    const postsToLedger = arg === 'invoice' || arg === 'bill';
    if (postsToLedger && !periodIsOpen()) {
      toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน'); return;
    }
    if (arg === 'invoice') modalInvoice();
    if (arg === 'bill') modalBill();
    if (arg === 'quotation') modalTradeDoc('quotation');
    if (arg === 'salesorder') modalTradeDoc('salesOrder');
    if (arg === 'purchaseorder') modalTradeDoc('purchaseOrder');
    return;
  }
  if (head === 'pay')     { modalReceive(arg); return; }
  if (head === 'impundo') { modalUndoImport(arg); return; }
  if (head === 'cn')      { modalCreditNote(arg); return; }
  if (head === 'dn')      { modalDebitNote(arg); return; }
  if (head === 'trade') {
    const [kind, what, docNo] = rest;
    if (!TRADE_DOCS[kind]) return;
    if (what === 'convert') { modalConvertTradeDoc(kind, docNo); return; }
    runAction(function () {
      setTradeDocStatus(kind, docNo, what);
      toast(TRADE_DOCS[kind].label + ' ' + docNo + ' — ' + tradePill(what).st[1], 'ok');
    });
    return;
  }
  if (head === 'paybill') { modalPayBill(arg); return; }
  if (head === 'rev')     { modalReverse(arg); return; }
  if (head === 'reopen')  { modalReopen(); return; }

  if (head === 'bank') {
    const [what, id] = rest;
    if (what === 'book') modalBankBook(id);
    if (what === 'match') runAction(function () {
      matchBankTxn(Number(id));
      toast('ทำเครื่องหมายว่ากระทบยอดแล้ว', 'ok');
    });
    return;
  }

  if (head === 'run') {
    if (arg === 'deprec') return void runAction(function () {
      const r = runDepreciation(STATE.period);
      toast('ตั้งค่าเสื่อมราคางวด ' + thPeriod(STATE.period) + ' แล้ว', 'ok',
        'ทางบัญชี ' + fmt(r.bookTotal) + ' บาท · ทางภาษี ' + fmt(r.taxTotal) + ' บาท');
    });
    if (arg === 'payroll') return void runAction(function () {
      const r = runPayroll(STATE.period);
      toast('ทำเงินเดือน ' + r.count + ' คนแล้ว', 'ok', 'จ่ายสุทธิ ' + fmt(r.net) + ' บาท');
    });
    if (arg === 'pp30') return void runAction(function () {
      const f = fileVat(STATE.period);
      STATE.screen = 'pp30';
      toast('ยื่น ภ.พ.30 งวด ' + thPeriod(STATE.period) + ' แล้ว', 'ok',
        f.payable >= 0 ? 'ต้องชำระ ' + fmt(f.payable) + ' บาท' : 'ชำระเกิน ' + fmt(-f.payable) + ' บาท ยกไปเดือนถัดไป');
    });
    if (rest[0] === 'pnd') return void runAction(function () {
      const f = fileWht(STATE.period, rest[1]);
      toast('ยื่น ' + rest[1] + ' แล้ว', 'ok', f.count + ' รายการ รวม ' + fmt(f.total) + ' บาท'
        + (f.excluded ? ' · กันรายการ e-Withholding ออก ' + f.excluded + ' รายการ' : ''));
    });
    return;
  }

  if (head === 'close' && arg === 'period') {
    runAction(function () {
      closePeriod(STATE.period);
      toast('ปิดงวด ' + thPeriod(STATE.period) + ' เรียบร้อย', 'ok', 'ลงรายการย้อนหลังในงวดนี้ไม่ได้อีก');
    });
    return;
  }
}

function bindEvents() {
  document.addEventListener('click', function (ev) {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    if (el.classList.contains('disabled')) { ev.preventDefault(); return; }
    ev.preventDefault();
    dispatch(el.getAttribute('data-act'));
  });

  document.addEventListener('input', function (ev) {
    if (ev.target.id !== 'q') return;
    STATE.filter = ev.target.value;
    render();
    const q = document.getElementById('q');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.id === 'periodSel') { STATE.period = t.value; STATE.sel = null; save(); render(); return; }
    if (t.id === 'bookSel')   { switchCompany(t.value); return; }
    if (t.id === 'accSel')    { STATE.drill = t.value; render(); return; }
    if (t.id === 'file') {
      if (t.files && t.files[0]) handleFile(t.files[0]);
      return;
    }
    if (t.id === 'impMode') {
      const I = STATE.imp;
      if (I) {
        I.mode = t.value;
        /* สลับไปแบบยอดเคลื่อนไหว ให้เด้งไปชุด "ยอดประจำงวด" ให้เลย
           ถ้าปล่อยค้างที่ชุดยอดสะสม ตัวเลขจะถูกนับซ้ำกับเดือนก่อนโดยไม่รู้ตัว */
        if (I.mode === 'movement') {
          const mv = (I.pairs || []).find((p) => !/สะสม|คงเหลือ|balance/i.test(p.label)
            && !/ยกมา|opening/i.test(p.label));
          if (mv) { I.map.debit = mv.debit; I.map.credit = mv.credit; }
          if (!I.period) I.period = STATE.period;
        } else {
          const bal = (I.pairs || []).find((p) => /สะสม|คงเหลือ|balance/i.test(p.label));
          if (bal) { I.map.debit = bal.debit; I.map.credit = bal.credit; }
        }
        refreshImportPreview(); render();
      }
      return;
    }
    if (t.id === 'impPair') {
      const I = STATE.imp;
      if (I) {
        const pr = (I.pairs || [])[Number(t.value)];
        if (pr) { I.map.debit = pr.debit; I.map.credit = pr.credit; refreshImportPreview(); }
        render();
      }
      return;
    }
    if (t.name === 'impPeriod') {
      const I = STATE.imp;
      if (I) { I.period = t.value; render(); }
      return;
    }
    if (t.id === 'impHeaderRow') {
      const I = STATE.imp;
      if (I) {
        I.headerRow = Number(t.value) || 0;
        const re = detectColumns(I.rows.slice(I.headerRow));
        /* เลือกบรรทัดหัวตารางใหม่ ให้ลองเดาคอลัมน์ใหม่จากบรรทัดนั้นด้วย */
        if (re.keys >= 2 && re.headerRow === 0) I.map = re.map;
        refreshImportPreview(); render();
      }
      return;
    }
    if (t.classList.contains('impcol')) {
      const I = STATE.imp;
      if (I) { I.map[t.getAttribute('data-k')] = t.value === '' ? undefined : Number(t.value); refreshImportPreview(); render(); }
      return;
    }
    if (t.classList.contains('impmap')) {
      const I = STATE.imp;
      if (I) {
        I.overrides = I.overrides || {};
        if (t.value) I.overrides[t.getAttribute('data-key')] = t.value;
        else delete I.overrides[t.getAttribute('data-key')];
        render();
      }
      return;
    }
    if (t.classList.contains('itemsel')) {
      const i = t.getAttribute('data-i');
      const it = DB.items.find((x) => x.code === t.value);
      const price = document.querySelector('[name="l' + i + '_price"]');
      const desc  = document.querySelector('[name="l' + i + '_desc"]');
      const qty   = document.querySelector('[name="l' + i + '_qty"]');
      if (it && price) price.value = it.price ? fmt(it.price) : '';
      if (it && desc) desc.value = it.name;
      if (it && qty && !qty.value) qty.value = '1';
      return;
    }
    if (t.name === 'expenseSub') {
      const item = document.querySelector('[name="item"]');
      if (item) item.disabled = t.value !== 'inventory';
      return;
    }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') closeModal();
    if (ev.key === 'Enter' && document.getElementById('modal').classList.contains('show')
        && ev.target.tagName !== 'TEXTAREA' && modalSubmit) {
      ev.preventDefault(); modalSubmit();
    }
  });

  /* คำอธิบายจุดข้อมูลบนกราฟ */
  const ttEl = document.getElementById('tip');
  document.addEventListener('mousemove', function (ev) {
    const m = ev.target.closest ? ev.target.closest('[data-tip]') : null;
    if (!m) { ttEl.classList.remove('show'); return; }
    ttEl.textContent = m.getAttribute('data-tip');
    ttEl.classList.add('show');
    const w = ttEl.offsetWidth, h = ttEl.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY - h - 12;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y < 8) y = ev.clientY + 18;
    ttEl.style.left = x + 'px';
    ttEl.style.top = y + 'px';
  });
  document.addEventListener('mouseleave', function () { ttEl.classList.remove('show'); });

  ['dragenter', 'dragover'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      const d = document.getElementById('drop');
      if (!d) return;
      e.preventDefault();
      d.classList.add('over');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      const d = document.getElementById('drop');
      if (!d) return;
      e.preventDefault();
      if (ev === 'dragleave' && e.relatedTarget) return;
      d.classList.remove('over');
      if (ev === 'drop' && e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  });

  document.getElementById('menuBtn').addEventListener('click', function () {
    document.body.classList.toggle('nav-open');
  });
  document.getElementById('nav').addEventListener('click', function () {
    document.body.classList.remove('nav-open');
  });
}


function modalBlank() {
  const yr = new Date().getFullYear();
  modal({
    title:'เริ่มจากบริษัทเปล่า',
    sub:'ข้อมูลปัจจุบันทั้งหมดจะถูกลบถาวร',
    body:'<div class="flds">'
      + field({ name:'coname', label:'ชื่อผู้ประกอบการ', wide:true, placeholder:'บริษัท ... จำกัด' })
      + field({ name:'cotax', label:'เลขประจำตัวผู้เสียภาษี 13 หลัก', placeholder:'เว้นว่างไว้ก่อนได้',
          hint:'ถ้าใส่ ระบบจะตรวจหลักที่ 13 ให้ทันที' })
      + field({ name:'coyear', label:'ปีของรอบบัญชี (ค.ศ.)', value: String(yr),
          hint:'ระบบจะสร้างงวดรายเดือน 12 งวดให้' })
      + field({ name:'coaddr', label:'ที่อยู่สถานประกอบการ', wide:true,
          placeholder:'ที่อยู่ที่จะพิมพ์ลงใบกำกับภาษีทุกใบ' })
      + '</div>',
    submitLabel:'ลบข้อมูลเดิมและเริ่มใหม่',
    note:'กดแล้วย้อนกลับไม่ได้',
    onSubmit: function () {
      if (!window.confirm('ลบข้อมูลทั้งหมดของ "' + DB.company.name + '" และเริ่มจากบริษัทเปล่า?')) return;
      submitAction(function () {
        const c = buildBlank({ name: val('coname'), taxId: val('cotax'),
          address: val('coaddr'), year: val('coyear') });
        STATE.period = DB.periods[0].code;
        STATE.imp = null; STATE.impResult = null; STATE.sel = null;
        toast('สร้างบริษัท ' + c.name + ' แล้ว', 'ok', 'ผังบัญชี ' + DB.accounts.length + ' บัญชี · ยังไม่มีรายการใด ๆ');
        return c;
      });
    },
  });
}

function modalNewCompany() {
  const yr = new Date().getFullYear();
  modal({
    title:'เพิ่มบริษัท',
    sub:'สร้างสมุดบัญชีเล่มใหม่ ข้อมูลแยกจากบริษัทที่มีอยู่โดยสิ้นเชิง',
    body:'<div class="flds">'
      + field({ name:'coname', label:'ชื่อผู้ประกอบการ', wide:true, placeholder:'บริษัท ... จำกัด' })
      + field({ name:'cotax', label:'เลขประจำตัวผู้เสียภาษี 13 หลัก', placeholder:'เว้นว่างไว้ก่อนได้' })
      + field({ name:'coyear', label:'ปีของรอบบัญชี (ค.ศ.)', value: String(yr) })
      + field({ name:'coaddr', label:'ที่อยู่สถานประกอบการ', wide:true,
          placeholder:'ที่อยู่ที่จะพิมพ์ลงใบกำกับภาษีทุกใบ' })
      + '</div>'
      + '<div class="note">บริษัทที่เปิดอยู่ตอนนี้จะถูกบันทึกไว้ก่อน แล้วสลับไปที่บริษัทใหม่ให้</div>',
    submitLabel:'สร้างบริษัทและสลับไป',
    onSubmit: function () {
      const name = val('coname').trim();
      if (!name) { toast('ต้องใส่ชื่อผู้ประกอบการ', 'err'); return; }
      const opts = { name: name, taxId: val('cotax'), address: val('coaddr'), year: val('coyear') };
      /* ตรวจให้ผ่านก่อน แล้วค่อยแตะข้อมูลบริษัทที่เปิดอยู่ */
      try { blankState(); buildBlankCheck(opts); }
      catch (e) {
        if (e instanceof DomainError) toast(e.message, 'err', e.hint);
        else toast('สร้างไม่สำเร็จ', 'err', e.message);
        return;
      }
      createCompany(opts);
    },
  });
}

/** ตรวจอย่างเดียว ไม่เขียนอะไร — ใช้ก่อนสลับบริษัท */
function buildBlankCheck(o) {
  const taxId = String(o.taxId || '').trim();
  if (taxId && !validTaxId(taxId)) {
    throw new DomainError('TAX_ID_INVALID',
      'เลขประจำตัวผู้เสียภาษี ' + taxId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ตรวจเลขกับหนังสือรับรองของบริษัท หรือเว้นว่างไว้ก่อนได้');
  }
  const year = Number(o.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new DomainError('FISCAL_YEAR_INVALID',
      'ปีของรอบบัญชีต้องเป็น ค.ศ. ระหว่าง 2000 ถึง 2100 (ได้รับ "' + o.year + '")',
      'ปี พ.ศ. 2569 คือ ค.ศ. 2026');
  }
}

async function createCompany(opts) {
  try {
    if (SYNC.mode === 'server') {
      clearTimeout(SYNC.timer);
      if (SYNC.pending) await syncPush();     // บันทึกบริษัทเดิมให้จบก่อน
    } else {
      booksSaveActive();
    }
    const id = booksNewId(opts.name);
    SYNC.book = id;
    SYNC.version = 0;
    buildBlank(opts);
    STATE.period = DB.periods[0].code;
    STATE.screen = 'dashboard';
    STATE.sel = null; STATE.imp = null; STATE.impResult = null;
    if (SYNC.mode === 'server') { await syncPush(); await syncBooks(); }
    else { booksSaveActive(); }
    closeModal();
    render();
    toast('สร้างบริษัท ' + DB.company.name + ' แล้ว', 'ok',
      'ข้อมูลแยกจากบริษัทอื่นทั้งหมด · สลับได้ที่มุมซ้ายบน');
  } catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('สร้างบริษัทไม่สำเร็จ', 'err', e.message); }
  }
}

async function switchCompany(id) {
  if (id === SYNC.book) return;
  const r = await syncSwitch(id);
  if (r === 'locked') { render(); return; }
  if (r === 'empty' || !DB.company) {
    toast('เปิดบริษัทนี้ไม่ได้', 'err', 'ไม่พบข้อมูลของสมุดนี้');
    return;
  }
  STATE.screen = 'dashboard';
  STATE.sel = null; STATE.drill = null; STATE.imp = null; STATE.impResult = null;
  const p = DB.periods.find((x) => x.code === STATE.period);
  if (!p) STATE.period = DB.periods[DB.periods.length - 1].code;
  render();
  toast('สลับไปที่ ' + DB.company.name + ' แล้ว', 'ok');
}

/* ===================================================================
   นำเข้าไฟล์
   =================================================================== */
async function handleFile(file) {
  STATE.imp = { name: file.name };
  try {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      const pkg = JSON.parse(await file.text());
      validatePackage(pkg);
      STATE.imp = { name: file.name, pkg: pkg };
      runImportPackage(pkg);
      return;
    }
    if (lower.endsWith('.xls')) {
      throw new DomainError('XLS_OLD_FORMAT',
        'ไฟล์ .xls เป็นรูปแบบ Excel รุ่นเก่า ระบบอ่านไม่ได้',
        'เปิดไฟล์ใน Excel แล้วสั่ง File → Save As เลือกชนิด "Excel Workbook (.xlsx)" หรือ "CSV" แล้วลากไฟล์ใหม่มาวาง');
    }
    let rows;
    if (lower.endsWith('.xlsx')) rows = await readXlsx(await file.arrayBuffer());
    else rows = parseCsv(await file.text());
    if (!rows.length) throw new DomainError('EMPTY_FILE', 'ไฟล์นี้ไม่มีข้อมูล');

    /* เดาหัวตารางไม่ได้ ก็ต้องไม่ตัน — พาไปหน้าจับคู่คอลัมน์ด้วยมือแทน
       การบอกให้ผู้ใช้กลับไปแก้ไฟล์เองคือทางตันสำหรับคนที่ไม่ถนัดคอมพิวเตอร์ */
    const det = detectColumns(rows);
    const kind = detectFileKind(rows, det.map, det.headerRow);
    STATE.imp = {
      name: file.name, rows: rows,
      headerRow: det.headerRow >= 0 ? det.headerRow : 0, map: det.map,
      pairs: det.pairs || [], mode: 'opening', period: null,
      overrides: {}, cutoff: null, needsMapping: !det.ok && kind === 'trialBalance',
      kind: kind,
    };
    if (kind === 'trialBalance') refreshImportPreview();
  } catch (e) {
    STATE.imp = { name: file.name, error: (e.message || String(e)) + (e.hint ? ' — ' + e.hint : '') };
    if (!(e instanceof DomainError)) console.error(e);
  }
  render();
}

function refreshImportPreview() {
  const I = STATE.imp;
  if (!I || !I.rows) return;
  const m = I.map;
  /* ต้องรู้อย่างน้อยว่าบัญชีไหน (รหัสหรือชื่อ) และยอดอยู่คอลัมน์ไหน
     บางรายงานมีคอลัมน์ยอดคงเหลือคอลัมน์เดียว จึงไม่บังคับว่าต้องมีทั้งเดบิตและเครดิต */
  if (m.code === undefined && m.name === undefined) { I.tb = null; return; }
  if (m.debit === undefined && m.credit === undefined) { I.tb = null; return; }
  I.tb = readTrialBalance(I.rows, m, I.headerRow);
}

function runImportPackage(pkg) {
  runAction(function () {
    const r = importPackage(pkg, {});
    STATE.impResult = r;
    STATE.screen = 'importResult';
    STATE.imp = null;
    toast('นำเข้าข้อมูลจาก ' + (pkg.source || 'ระบบเดิม') + ' แล้ว', 'ok',
      r.allPassed ? 'ยอดคุมผ่านครบทุกข้อ' : 'มียอดคุมที่ยังไม่ตรง ตรวจในหน้าสรุป');
  });
}

/* ---------- เริ่มระบบ ---------- */
async function boot() {
  bindEvents();
  const onServer = await syncConfig();

  if (onServer) {
    try {
      SYNC.passcode = localStorage.getItem(PASS_KEY)
        || localStorage.getItem('duly.passcode') || '';    // รับของที่เก็บไว้ใต้ชื่อเดิมด้วย
    } catch (e) { SYNC.passcode = ''; }
    if (SYNC.needsPasscode && !SYNC.passcode) {
      setStatus('locked');
      render();
      return;
    }
    await syncBooks();
    if (SYNC.books.length && !SYNC.books.some((b) => b.book === SYNC.book)) {
      SYNC.book = SYNC.books[0].book;      // สมุดเริ่มต้นถูกลบไปแล้ว ให้เปิดเล่มแรกที่มี
    }
    const r = await syncPull();
    if (r === 'locked') { render(); return; }
    if (r === 'empty') { buildSeed(); render(); await syncPush(); await syncBooks(); }
    else if (r === 'error') {
      /* ต่อเซิร์ฟเวอร์ไม่ได้ อย่าให้หน้าจอว่างเปล่า — ใช้ของในเครื่องไปก่อนแล้วบอกให้รู้ */
      SYNC.mode = 'browser';
      if (!load()) buildSeed();
      toast('ต่อเซิร์ฟเวอร์ไม่ได้', 'err', 'ใช้ข้อมูลในเบราว์เซอร์ไปก่อน ยังไม่บันทึกขึ้นเซิร์ฟเวอร์');
    }
    render();
    return;
  }

  const restored = load();
  if (!restored) buildSeed();
  render();
  if (!restored) save();
  const el = document.getElementById('boot');
  if (el) el.remove();
}
