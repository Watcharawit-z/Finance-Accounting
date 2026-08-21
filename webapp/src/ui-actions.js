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
  const out = inv.total - inv.paid - inv.credited;
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
  if (head === 'period')  { STATE.period = arg; STATE.sel = null; save(); render(); return; }
  if (head === 'sel')     { STATE.sel = arg || null; render(); return; }
  if (head === 'drill')   { STATE.drill = arg; STATE.screen = 'ledger'; STATE.filter = ''; render(); return; }
  if (head === 'entry')   { STATE.screen = 'journals'; STATE.sel = arg; render(); return; }
  if (head === 'print')   { window.print(); return; }
  if (head === 'view')    { STATE.dashView = arg; render(); return; }
  if (head === 'reset')   {
    if (window.confirm('ล้างข้อมูลตัวอย่างทั้งหมดและสร้างใหม่?')) resetAll();
    return;
  }
  if (head === 'modal')   { if (arg === 'close') closeModal(); else if (modalSubmit) modalSubmit(); return; }

  if (head === 'new') {
    if (!periodIsOpen()) { toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน'); return; }
    if (arg === 'invoice') modalInvoice();
    if (arg === 'bill') modalBill();
    return;
  }
  if (head === 'pay')     { modalReceive(arg); return; }
  if (head === 'cn')      { modalCreditNote(arg); return; }
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
    if (t.id === 'accSel')    { STATE.drill = t.value; render(); return; }
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

  document.getElementById('menuBtn').addEventListener('click', function () {
    document.body.classList.toggle('nav-open');
  });
  document.getElementById('nav').addEventListener('click', function () {
    document.body.classList.remove('nav-open');
  });
}

/* ---------- เริ่มระบบ ---------- */
function boot() {
  const restored = load();
  if (!restored) buildSeed();
  bindEvents();
  render();
  if (!restored) save();
  const el = document.getElementById('boot');
  if (el) el.remove();
}
