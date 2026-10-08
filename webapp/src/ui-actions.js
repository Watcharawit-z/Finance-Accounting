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
/** ตารางรายการ — mode 'cost' ใช้กับใบรับสินค้า: เลือกได้เฉพาะสินค้ามีสต๊อก และเติมราคาทุนเฉลี่ยแทนราคาขาย */
function lineEditor(n, mode) {
  const cost = mode === 'cost';
  const opts = cost
    ? [['', '— เลือกสินค้า —']].concat(DB.items.filter((i) => i.type === 'stock').map((i) => [i.code, i.code + ' · ' + i.name]))
    : optItems();
  let h = '<div class="sub-h">' + (cost ? 'สินค้าที่รับเข้าคลัง' : 'รายการสินค้าหรือบริการ')
    + '</div><div class="scroll"><table class="lines"><thead><tr>'
    + '<th>' + (cost ? 'สินค้า' : 'สินค้า/บริการ') + '</th><th>' + (cost ? 'คำอธิบาย' : 'คำอธิบายบนใบกำกับ')
    + '</th><th class="r">จำนวน</th><th class="r">' + (cost ? 'ต้นทุนต่อหน่วย (ก่อนภาษี)' : 'ราคาต่อหน่วย') + '</th><th>ภาษี</th></tr></thead><tbody>';
  for (let i = 0; i < n; i++) {
    h += '<tr>'
      + '<td><select name="l' + i + '_item" class="itemsel" data-i="' + i + '"' + (cost ? ' data-cost="1"' : '') + '>'
        + opts.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></td>'
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

/* ---------- ตัวเลือกเอกสารอ้างอิง — ใช้ตอนกดสร้างจากหน้ารายการ ไม่ได้เข้ามาจากหน้าใบกำกับ ---------- */
const optInvoices = (keep) => DB.docs.invoice.filter((d) => d.status !== 'void' && keep(d))
  .map((d) => [d.no, d.no + ' · ' + d.partnerName + ' · คงค้าง ' + fmt(invOutstanding(d))]);
const optOpenBills = () => DB.docs.bill.filter((b) => billOutstanding(b) > 0)
  .map((b) => [b.no, b.no + ' · ' + b.partnerName + ' · คงค้าง ' + fmt(billOutstanding(b))]);
const checkedValues = (name) =>
  Array.from(document.querySelectorAll('[name="' + name + '"]:checked')).map((e) => e.value);

/** ไม่มีเอกสารให้อ้างก็บอกตรง ๆ ดีกว่าเปิดฟอร์มเปล่าที่กดบันทึกไม่ได้ */
function needRefs(opts, msg, hint) {
  if (opts.length) return true;
  toast(msg, 'err', hint);
  return false;
}

function modalReceive(no) {
  const inv = no ? DB.docs.invoice.find((d) => d.no === no) : null;
  if (no && !inv) return;
  const refs = inv ? [] : optInvoices((d) => invOutstanding(d) > 0);
  if (!inv && !needRefs(refs, 'ไม่มีใบกำกับภาษีที่ค้างชำระ', 'ออกใบกำกับภาษีก่อน แล้วจึงรับชำระ')) return;
  const out = inv ? invOutstanding(inv) : 0;
  modal({
    title: inv ? 'รับชำระเงินจากใบกำกับ ' + no : 'ออกใบเสร็จรับเงิน',
    sub: inv ? inv.partnerName + ' · คงเหลือ ' + fmt(out) + ' บาท'
      : 'เลือกใบกำกับภาษีที่ลูกค้าชำระ ใบเสร็จต้องอ้างใบกำกับเสมอ',
    body:'<div class="flds">'
      + (inv ? '' : field({ name:'invoiceNo', label:'อ้างใบกำกับภาษี', type:'select', wide:true, options: refs }))
      + field({ name:'amount', label:'จำนวนเงินที่รับ (ก่อนหักภาษี ณ ที่จ่าย)', value: inv ? fmt(out) : '',
          placeholder: inv ? '' : 'เว้นว่าง = รับเต็มยอดคงค้าง' })
      + field({ name:'date', label:'วันที่รับชำระ', type:'date', value: defaultDate() })
      + field({ name:'method', label:'วิธีรับชำระ', type:'select', value:'transfer',
          options:[['transfer','โอนเงินเข้าบัญชี'],['cheque','เช็ค'],['cash','เงินสด']] })
      + field({ name:'wht', label:'ลูกค้าหักภาษี ณ ที่จ่ายหรือไม่', type:'select',
          options: optWht('ไม่ได้ถูกหัก'), hint:'ถ้าถูกหัก ระบบจะบันทึกเป็นสินทรัพย์รอเครดิตภาษีปลายปี' })
      + field({ name:'whtBase', label:'ฐานที่ลูกค้าหัก (ตาม 50 ทวิ)', placeholder:'เว้นว่าง = ให้ระบบคิด',
          hint: inv ? 'ระบบคิดจากค่าบริการก่อนภาษี ไม่รวมค่าสินค้า · รับเต็มยอดนี้ = ' + fmt(receiptServiceShare(inv, out)) + ' บาท'
            : 'ระบบคิดจากค่าบริการก่อนภาษีในยอดที่รับ ไม่รวมค่าสินค้า (ซื้อสินค้าไม่ต้องหัก ณ ที่จ่าย)' })
      + '</div>',
    submitLabel:'รับชำระและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const r = receivePayment({ invoiceNo: no || val('invoiceNo'), amount: val('amount'), date: val('date'),
          method: val('method'), whtCode: val('wht') || null, whtBase: val('wht') ? val('whtBase') : null });
        toast('บันทึกใบเสร็จ ' + r.no + ' แล้ว', 'ok',
          'รับสุทธิ ' + fmt(r.net) + ' บาท' + (r.wht ? ' (ถูกหักไว้ ' + fmt(r.wht) + ')' : ''));
        return r;
      });
    },
  });
}

/** ตัวเลือกอัตราภาษีของใบลดหนี้/เพิ่มหนี้ — แสดงเฉพาะใบกำกับที่มีหลายอัตรา */
function noteCodeField(inv, cn) {
  const codes = invoiceTaxCodes(inv);
  if (codes.length < 2) return '';
  return field({ name:'taxCode', label: cn ? 'ลดหนี้รายการอัตรา' : 'เพิ่มหนี้รายการอัตรา', type:'select', wide:true,
    options: codes.map((c) => [c, TAX_CODE_LABEL[c] + (cn ? ' · ลดได้อีก ' + fmt(creditableBase(inv, c)) : '')]),
    hint:'ใบกำกับนี้มีหลายอัตรา อัตราในใบ' + (cn ? 'ลดหนี้' : 'เพิ่มหนี้') + 'ต้องตรงกับรายการเดิม ภ.พ.30 แต่ละช่องจึงถูก' });
}
/** สินค้าคงคลังที่ขายในใบกำกับนี้และยังรับคืนได้ */
function returnableItems(inv) {
  const out = [];
  DB.docs.stockMove.filter((m) => m.src === inv.no && m.dir === 'out').forEach(function (m) {
    const back = DB.docs.creditNote.filter((c) => c.invoiceNo === inv.no && c.status !== 'void')
      .reduce((a, c) => a + (c.returns || []).filter((r) => r.itemCode === m.item).reduce((b, r) => b + r.qty, 0), 0);
    const row = out.find((x) => x.code === m.item);
    if (row) { row.sold = roundQty(row.sold + m.qty); return; }
    const it = DB.items.find((x) => x.code === m.item) || {};
    out.push({ code: m.item, name: it.name || m.item, uom: it.uom || '', sold: m.qty, back });
  });
  out.forEach((r) => { r.left = roundQty(r.sold - r.back); });
  return out.filter((r) => r.left > 0);
}
function modalCreditNote(no, fromList) {
  const pickable = (d) => d.status !== 'void' && creditableBase(d) > 0;
  /* ใบที่ยังค้างชำระขึ้นก่อน — ลดหนี้ใบที่ชำระครบแล้วทำได้ แต่ต้องคืนเงินลูกค้าตามมา */
  const refs = DB.docs.invoice.filter(pickable)
    .sort((a, b) => (invOutstanding(b) > 0) - (invOutstanding(a) > 0))
    .map((d) => [d.no, d.no + ' · ' + d.partnerName + ' · ลดได้อีก ' + fmt(creditableBase(d))
      + (invOutstanding(d) > 0 ? '' : ' · ชำระครบแล้ว')]);
  if (!no && !needRefs(refs, 'ไม่มีใบกำกับภาษีที่ออกใบลดหนี้ได้', 'ใบลดหนี้ต้องอ้างใบกำกับเดิมที่ยังมีมูลค่าให้ลด (มาตรา 86/10)')) return;
  const list = fromList || !no;
  const invNo = no || refs[0][0];
  const inv = DB.docs.invoice.find((d) => d.no === invNo);
  if (!inv) return;
  const rets = returnableItems(inv);
  modal({
    title: list ? 'ออกใบลดหนี้' : 'ออกใบลดหนี้อ้างใบกำกับ ' + invNo,
    sub:'ออกได้เฉพาะเหตุที่มาตรา 86/10 กำหนดเท่านั้น และต้องอ้างใบกำกับเดิมเสมอ',
    body:'<div class="flds" data-note="cn">'
      + (list ? field({ name:'invoiceNo', label:'อ้างใบกำกับภาษีเดิม', type:'select', wide:true, options: refs, value: invNo }) : '')
      + noteCodeField(inv, true)
      + field({ name:'base', label:'มูลค่าที่ลด (ก่อนภาษี)', value:'0',
          hint:'ลดได้ไม่เกินมูลค่าคงเหลือ ' + fmt(creditableBase(inv)) + ' บาท'
            + (invOutstanding(inv) <= 0 ? ' · ลูกค้าชำระครบแล้ว ลดหนี้แล้วต้องคืนเงินที่หน้าใบกำกับ' : '') })
      + field({ name:'date', label:'วันที่ออกใบลดหนี้', type:'date', value: defaultDate() })
      + field({ name:'reason', label:'เหตุแห่งการลดหนี้', type:'select', wide:true,
          options: Object.keys(CN_REASONS).map((k) => [k, CN_REASONS[k]]) })
      + '</div>'
      + (rets.length ? '<div class="sub-h">รับสินค้าคืนเข้าคลัง (ถ้ามี)</div><div class="flds">'
          + rets.map((r, i) => field({ name:'ret' + i, label: r.code + ' ' + r.name, value:'0', type:'number',
              hint:'ขายไป ' + r.sold + ' ' + r.uom + (r.back ? ' · คืนแล้ว ' + r.back : '') + ' · คืนได้อีก ' + r.left
                + ' — ของกลับเข้าคลังด้วยต้นทุนเดิมตอนขาย' })).join('') + '</div>' : ''),
    submitLabel:'ออกใบลดหนี้',
    onSubmit: function () {
      submitAction(function () {
        const returnLines = rets.map((r, i) => ({ itemCode: r.code, qty: Number(val('ret' + i) || 0) })).filter((r) => r.qty > 0);
        const c = issueCreditNote({ invoiceNo: list ? val('invoiceNo') : invNo, base: val('base'), date: val('date'),
          reason: val('reason'), taxCode: val('taxCode') || undefined, returnLines });
        toast('ออกใบลดหนี้ ' + c.no + ' แล้ว', 'ok', 'ลดภาษีขาย ' + fmt(c.vat) + ' บาทในงวดนี้'
          + (c.returns.length ? ' · รับสินค้าคืนเข้าคลัง ' + c.returns.length + ' รายการ' : ''));
        return c;
      });
    },
  });
}

/* ---------- คืนเงินลูกค้า — ลดหนี้หลังรับเงินครบ ---------- */
function modalRefund(no) {
  const inv = DB.docs.invoice.find((d) => d.no === no);
  if (!inv) return;
  const credit = -invOutstanding(inv);
  if (credit <= 0) { toast('ใบกำกับ ' + no + ' ไม่มียอดที่ต้องคืนลูกค้า', 'err'); return; }
  const banks = payFromAccounts().map((a) => [a.code, a.code + ' ' + a.name]);
  modal({
    title:'คืนเงินลูกค้า ตามใบกำกับ ' + no,
    sub: inv.partnerName + ' · มีเครดิตจากใบลดหนี้ ' + fmt(credit) + ' บาท',
    body:'<div class="flds">'
      + field({ name:'amount', label:'จำนวนเงินที่คืน', value: fmt(credit), hint:'คืนได้ไม่เกินเครดิตของลูกค้า' })
      + field({ name:'date', label:'วันที่คืนเงิน', type:'date', value: defaultDate() })
      + field({ name:'bank', label:'จ่ายจากบัญชี', type:'select', options: banks, value: accBySub('bank') })
      + field({ name:'method', label:'วิธีคืนเงิน', type:'select', value:'transfer',
          options:[['transfer','โอนเงิน'],['cheque','เช็ค'],['cash','เงินสด']] })
      + field({ name:'note', label:'หมายเหตุ', wide:true, placeholder:'เช่น เลขที่อ้างอิงการโอน' })
      + '</div>',
    submitLabel:'คืนเงินและลงบัญชี',
    note:'Dr ลูกหนี้การค้า / Cr เงินฝากธนาคาร — ยอดเครดิตของลูกค้าจะกลับเป็นศูนย์',
    onSubmit: function () {
      submitAction(function () {
        const r = refundCustomer({ invoiceNo: no, amount: val('amount'), date: val('date'), bankAccount: val('bank'),
          method: val('method'), note: val('note') });
        toast('บันทึกคืนเงินลูกค้า ' + r.no + ' แล้ว', 'ok', fmt(r.amount) + ' บาท');
        return r;
      });
    },
  });
}

/* ===================================================================
   ทะเบียนต่าง ๆ — เพิ่มและแก้ไข
   =================================================================== */
function modalPartner(kind, code) {
  const p = code ? DB.partners.find((x) => x.code === code) : null;
  if (code && !p) return;
  const k = p ? p.kind : kind;
  const isVendor = k === 'vendor';
  const label = isVendor ? 'ผู้ขาย' : 'ลูกค้า';
  modal({
    title: p ? 'แก้ไข' + label + ' ' + p.code : 'เพิ่ม' + label + 'รายใหม่',
    sub: p ? 'ข้อมูลที่แก้จะใช้กับเอกสารที่ออกหลังจากนี้ ใบเดิมยังเก็บข้อมูล ณ วันที่ออกไว้เหมือนเดิม'
      : 'ระบบตั้งรหัสให้อัตโนมัติ กรอกเท่าที่รู้ก่อนได้ แล้วมาเติมทีหลัง',
    body:'<div class="flds">'
      + field({ name:'name', label:'ชื่อ' + label + ' (ตามหนังสือรับรอง)', wide:true,
          value: p ? p.name : '', placeholder:'เช่น บริษัท ตัวอย่างการค้า จำกัด' })
      + field({ name:'entityType', label:'ประเภท', type:'select',
          value: p ? p.entityType : 'juristic',
          options:[['juristic','นิติบุคคล'],['individual','บุคคลธรรมดา']] })
      + field({ name:'taxId', label:'เลขประจำตัวผู้เสียภาษี 13 หลัก',
          value: p && p.taxId ? p.taxId : '',
          hint:'ระบบตรวจหลักที่ 13 ให้ แต่ไม่ได้ดึงชื่อ–ที่อยู่มาให้เอง' })
      + field({ name:'branch', label:'สาขา', value: p ? (p.branch || '00000') : '00000',
          hint:'สำนักงานใหญ่ใช้ 00000 · สาขาที่ 1 ใช้ 00001' })
      + field({ name:'address', label:'ที่อยู่ตามใบกำกับภาษี', wide:true, value: p ? (p.address || '') : '' })
      + field({ name:'phone', label:'เบอร์โทร', value: p ? (p.phone || '') : '' })
      + field({ name:'termDays', label:'เครดิต (วัน)', value: p ? String(p.termDays || 0) : '30' })
      + (isVendor ? field({ name:'wht', label:'ประเภทเงินได้ที่ต้องหักภาษี ณ ที่จ่าย', type:'select',
          value: p && p.whtCode ? p.whtCode : '', options: optWht(),
          hint:'ตั้งไว้ให้ระบบเลือกให้อัตโนมัติตอนจ่ายเงิน' }) : '')
      + '</div>',
    submitLabel: p ? 'บันทึกการแก้ไข' : 'เพิ่ม' + label,
    note:'ยังไม่รู้เลขผู้เสียภาษีเว้นว่างไว้ก่อนได้ แต่ออกใบกำกับภาษีให้ไม่ได้จนกว่าจะกรอก · '
      + 'ค้นชื่อบริษัทจากเลขผู้เสียภาษีได้ที่คลังข้อมูลธุรกิจกรมพัฒนาธุรกิจการค้า '
      + '(datawarehouse.dbd.go.th) แล้วคัดลอกมากรอก'
      + (p ? '' : ' · ถ้าเลขซ้ำกับรายที่มีอยู่แล้ว ระบบจะเตือนและไม่ให้สร้างซ้ำ'),
    onSubmit: function () {
      submitAction(function () {
        const r = savePartner({
          code: p ? p.code : null, kind: k,
          name: val('name'), entityType: val('entityType'), taxId: val('taxId'),
          branch: val('branch'), address: val('address'), phone: val('phone'),
          termDays: val('termDays'), whtCode: isVendor ? (val('wht') || null) : null,
        });
        toast((r.created ? 'เพิ่ม' : 'แก้ไข') + label + ' ' + r.partner.code + ' แล้ว', 'ok', r.partner.name);
        return r;
      });
    },
  });
}

function modalItem(code) {
  const it = code ? DB.items.find((x) => x.code === code) : null;
  if (code && !it) return;
  modal({
    title: it ? 'แก้ไข ' + it.code : 'เพิ่มสินค้าหรือบริการ',
    sub: it && it.type === 'stock'
      ? 'คงเหลือ ' + it.qty + ' ' + it.uom + ' · ต้นทุนเฉลี่ย ' + fmt(it.avgCost)
        + ' — จำนวนและต้นทุนแก้ที่นี่ไม่ได้ ต้องมาจากเอกสารซื้อขาย'
      : 'สินค้าจะตัดสต๊อกและต้นทุนขายอัตโนมัติ ส่วนบริการไม่แตะสต๊อก',
    body:'<div class="flds">'
      + field({ name:'name', label:'ชื่อสินค้าหรือบริการ', wide:true, value: it ? it.name : '' })
      + field({ name:'type', label:'ประเภท', type:'select', value: it ? it.type : 'stock',
          options:[['stock','สินค้า (มีสต๊อก)'],['service','บริการ (ไม่มีสต๊อก)']] })
      + (it ? '' : field({ name:'newCode', label:'รหัสสินค้า (เว้นว่างให้ระบบตั้งให้)', value:'' }))
      + field({ name:'category', label:'หมวด', value: it ? it.category : '' })
      + field({ name:'uom', label:'หน่วยนับ', value: it ? it.uom : '', placeholder:'ชิ้น กล่อง งาน' })
      + field({ name:'price', label:'ราคาขายต่อหน่วย (ก่อนภาษี)', value: it ? unM(it.price) : '' })
      + field({ name:'reorder', label:'จุดสั่งซื้อ (เตือนเมื่อคงเหลือต่ำกว่านี้)',
          value: it ? String(it.reorder) : '0' })
      + '</div>',
    submitLabel: it ? 'บันทึกการแก้ไข' : 'เพิ่มสินค้า',
    onSubmit: function () {
      submitAction(function () {
        const r = saveItem({
          code: it ? it.code : null, newCode: val('newCode'),
          name: val('name'), type: val('type'), category: val('category'),
          uom: val('uom'), price: val('price'), reorder: val('reorder'),
        });
        toast((r.created ? 'เพิ่ม' : 'แก้ไข') + 'สินค้า ' + r.item.code + ' แล้ว', 'ok', r.item.name);
        return r;
      });
    },
  });
}

function modalEmployee(code) {
  const e = code ? DB.employees.find((x) => x.code === code) : null;
  if (code && !e) return;
  modal({
    title: e ? 'แก้ไขพนักงาน ' + e.code : 'เพิ่มพนักงาน',
    sub:'ข้อมูลชุดนี้ใช้คำนวณภาษีเงินได้ ประกันสังคม และกองทุนสำรองเลี้ยงชีพตอนทำเงินเดือน',
    body:'<div class="flds">'
      + field({ name:'name', label:'ชื่อ-สกุล', wide:true, value: e ? e.name : '' })
      + field({ name:'dept', label:'แผนก', value: e ? e.dept : '' })
      + field({ name:'hired', label:'วันเริ่มงาน', type:'date', value: e && e.hired ? e.hired : '' })
      + field({ name:'nationalId', label:'เลขประจำตัวประชาชน',
          value: e && e.nationalId ? e.nationalId : '',
          hint:'ใช้ตอนยื่น ภ.ง.ด.1 และขึ้นทะเบียนประกันสังคม' })
      + field({ name:'ssoNumber', label:'เลขที่ประกันสังคม', value: e && e.ssoNumber ? e.ssoNumber : '' })
      + field({ name:'salary', label:'เงินเดือน', value: e ? unM(e.salary) : '' })
      + field({ name:'otHours', label:'ชั่วโมงล่วงเวลาต่อเดือน (ถ้ามีประจำ)',
          value: e ? String(e.otHours || 0) : '0' })
      + field({ name:'pvdRate', label:'อัตราสะสมกองทุนสำรองเลี้ยงชีพ (%)',
          value: e ? String(e.pvdRate || 0) : '0', hint:'0 ถึง 15 · ใส่ 0 ถ้าไม่เข้าร่วม' })
      + field({ name:'active', label:'สถานะ', type:'select',
          value: e && e.active === false ? 'no' : 'yes',
          options:[['yes','ทำงานอยู่'],['no','พ้นสภาพแล้ว']] })
      + '</div>',
    submitLabel: e ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน',
    onSubmit: function () {
      submitAction(function () {
        const r = saveEmployee({
          code: e ? e.code : null, name: val('name'), dept: val('dept'), hired: val('hired') || null,
          nationalId: val('nationalId'), ssoNumber: val('ssoNumber'),
          salary: val('salary'), otHours: val('otHours'), pvdRate: val('pvdRate'),
          active: val('active') !== 'no',
        });
        toast((r.created ? 'เพิ่ม' : 'แก้ไข') + 'พนักงาน ' + r.employee.code + ' แล้ว', 'ok', r.employee.name);
        return r;
      });
    },
  });
}

function modalAsset(code) {
  const a = code ? DB.assets.find((x) => x.code === code) : null;
  if (code && !a) return;
  const depreciated = a && DB.docs.depreciation.some((d) => (d.rows || []).some((r) => r.code === a.code));
  const clsOpts = Object.keys(TAX_DEPRECIATION).map((k) => [k,
    TAX_DEPRECIATION[k].label + (TAX_DEPRECIATION[k].rate ? ' · ภาษี ' + TAX_DEPRECIATION[k].rate + '%' : '')]);
  modal({
    title: a ? 'แก้ไขทรัพย์สิน ' + a.code : 'เพิ่มทรัพย์สินถาวร',
    sub: depreciated
      ? 'ทรัพย์สินนี้คิดค่าเสื่อมไปแล้ว แก้ราคาทุน วันที่เริ่มใช้ และประเภทไม่ได้'
      : 'ค่าเสื่อมทางบัญชีคิดตามอายุที่กรอก ส่วนทางภาษีคิดตามอัตราในพระราชกฤษฎีกา 145',
    body:'<div class="flds">'
      + field({ name:'name', label:'ชื่อทรัพย์สิน', wide:true, value: a ? a.name : '' })
      + field({ name:'class', label:'ประเภทตามพระราชกฤษฎีกา 145', type:'select', wide:true,
          value: a ? a.class : 'OFFICE', options: clsOpts })
      + field({ name:'inService', label:'วันที่เริ่มใช้งาน', type:'date',
          value: a ? a.inService : defaultDate() })
      + field({ name:'cost', label:'ราคาทุน (ไม่รวมภาษีซื้อที่ขอคืนได้)', value: a ? unM(a.cost) : '' })
      + field({ name:'bookYears', label:'อายุการใช้งานทางบัญชี (ปี)',
          value: a ? String(a.bookYears) : '5' })
      + field({ name:'accumBook', label:'ค่าเสื่อมสะสมทางบัญชียกมา', value: a ? unM(a.accumBook) : '0',
          hint:'ทรัพย์สินที่ใช้มาก่อนย้ายระบบ ให้กรอกยอดสะสม ณ วันตัดยอด' })
      + field({ name:'accumTax', label:'ค่าเสื่อมสะสมทางภาษียกมา', value: a ? unM(a.accumTax) : '0' })
      + field({ name:'status', label:'สถานะ', type:'select',
          value: a && a.status === 'disposed' ? 'disposed' : 'in_use',
          options:[['in_use','ใช้งานอยู่'],['disposed','จำหน่ายออกแล้ว']] })
      + '</div>',
    submitLabel: a ? 'บันทึกการแก้ไข' : 'เพิ่มทรัพย์สิน',
    note:'ยอดค่าเสื่อมสะสมที่กรอกต้องตรงกับบัญชีค่าเสื่อมราคาสะสมในงบทดลอง',
    onSubmit: function () {
      submitAction(function () {
        const r = saveAsset({
          code: a ? a.code : null, name: val('name'), class: val('class'),
          inService: val('inService'), cost: val('cost'), bookYears: val('bookYears'),
          accumBook: val('accumBook'), accumTax: val('accumTax'), status: val('status'),
        });
        toast((r.created ? 'เพิ่ม' : 'แก้ไข') + 'ทรัพย์สิน ' + r.asset.code + ' แล้ว', 'ok', r.asset.name);
        return r;
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

function modalDebitNote(no, fromList) {
  const refs = DB.docs.invoice.filter((d) => d.status !== 'void')
    .map((d) => [d.no, d.no + ' · ' + d.partnerName + ' · ก่อนภาษี ' + fmt(d.base)]);
  if (!no && !needRefs(refs, 'ยังไม่มีใบกำกับภาษีให้อ้าง', 'ใบเพิ่มหนี้ต้องอ้างใบกำกับเดิมเสมอ (มาตรา 86/9)')) return;
  const list = fromList || !no;
  const invNo = no || refs[0][0];
  const inv = DB.docs.invoice.find((d) => d.no === invNo);
  if (!inv) return;
  modal({
    title: list ? 'ออกใบเพิ่มหนี้' : 'ออกใบเพิ่มหนี้อ้างใบกำกับ ' + invNo,
    sub:'ใช้เมื่อเรียกเก็บเงินต่ำกว่าที่ควร ออกได้เฉพาะเหตุตามมาตรา 86/9 และต้องอ้างใบกำกับเดิม',
    body:'<div class="flds" data-note="dn">'
      + (list ? field({ name:'invoiceNo', label:'อ้างใบกำกับภาษีเดิม', type:'select', wide:true, options: refs, value: invNo }) : '')
      + noteCodeField(inv, false)
      + field({ name:'base', label:'มูลค่าที่เพิ่ม (ก่อนภาษี)', value:'0',
          hint:'ยอดเดิมของใบกำกับก่อนภาษีคือ ' + fmt(inv.base) + ' บาท'
            + (invoiceTaxCodes(inv).indexOf('VAT7') < 0 ? ' · ใบนี้ไม่มีภาษี 7% ใบเพิ่มหนี้จึงไม่มีภาษีเช่นกัน' : '') })
      + field({ name:'date', label:'วันที่ออกใบเพิ่มหนี้', type:'date', value: defaultDate() })
      + field({ name:'reason', label:'เหตุแห่งการเพิ่มหนี้', type:'select', wide:true,
          options: Object.keys(DN_REASONS).map((k) => [k, DN_REASONS[k]]) })
      + '</div>',
    submitLabel:'ออกใบเพิ่มหนี้',
    note:'อย่าออกใบกำกับภาษีใบใหม่ทับ เพราะรายได้และภาษีขายจะถูกนับซ้ำสองรอบ',
    onSubmit: function () {
      submitAction(function () {
        const c = issueDebitNote({ invoiceNo: list ? val('invoiceNo') : invNo, base: val('base'), date: val('date'),
          reason: val('reason'), taxCode: val('taxCode') || undefined });
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
  const stockOnly = d.lines.every((l) => { const it = l.itemCode && DB.items.find((x) => x.code === l.itemCode); return it && it.type === 'stock'; });
  modal({
    title:'แปลง' + cfg.label + ' ' + no + ' เป็น' + nextLabel,
    sub: d.partnerName + ' · รวม ' + fmt(d.total) + ' บาท · ' + d.lines.length + ' รายการ',
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่ของ' + nextLabel, type:'date', value: defaultDate(),
          hint: cfg.next === 'salesOrder' ? '' : 'ต้องอยู่ในงวดที่ยังเปิดอยู่ ระบบจะเลือกอัตราภาษีตามวันที่นี้' })
      + (toBill ? field({ name:'vendorNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'ดูจากใบกำกับที่ผู้ขายส่งมา' }) : '')
      + (toBill && !stockOnly ? field({ name:'acc', label:'บันทึกเข้าบัญชี', type:'select', wide:true,
          value: d.lines[0].acc || defaultAccountFor(d.lines[0].expenseSub || 'admin_expense'), options: optBillAccounts(),
          hint:'ใช้กับรายการที่ไม่ใช่สินค้าคงคลัง · สินค้าคงคลังเข้าบัญชีสินค้าคงเหลือเสมอ' }) : '')
      + (toBill ? field({ name:'wht', label:'ภาษีหัก ณ ที่จ่ายตอนจ่ายเงิน', type:'select', options: optWht() }) : '')
      + '</div>',
    submitLabel:'แปลงเป็น' + nextLabel,
    note: cfg.next === 'salesOrder' ? 'ยังไม่ลงบัญชีในขั้นนี้'
      : 'ขั้นนี้จะลงบัญชีจริงและจองเลขที่เอกสาร',
    onSubmit: function () {
      submitAction(function () {
        const made = convertTradeDoc(kind, no, {
          date: val('date'), vendorNo: toBill ? val('vendorNo') : null,
          acc: toBill && !stockOnly ? val('acc') : null,
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
/** บัญชีที่รายการซื้อลงได้ แบ่งกลุ่มให้อ่านง่าย */
function optBillAccounts() {
  const grp = (a) => a.subType === 'inventory' ? 'สินค้า' : a.type === 'asset' ? 'สินทรัพย์' : 'ค่าใช้จ่าย';
  return billAccounts().map((a) => [a.code, grp(a) + ' · ' + a.code + ' ' + a.name]);
}
function modalBill() {
  modal({
    title:'บันทึกใบกำกับภาษีซื้อ',
    sub:'ระบบกันการบันทึกเลขที่ใบกำกับซ้ำของผู้ขายรายเดียวกัน',
    body:'<div class="flds">'
      + field({ name:'partner', label:'ผู้ขาย', type:'select', options: optVendors() })
      + field({ name:'vendorNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'เช่น IV6907-0245' })
      + field({ name:'date', label:'วันที่ตามใบกำกับ', type:'date', value: defaultDate() })
      + field({ name:'acc', label:'บันทึกเข้าบัญชี', type:'select', wide:true, value: defaultAccountFor('admin_expense'),
          options: optBillAccounts(), hint:'ซื้อสินค้าเข้าคลังให้เลือกบัญชีสินค้าคงเหลือแล้วเลือกสินค้าด้านล่าง' })
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
        const accCode = val('acc');
        const itemCode = acc(accCode).subType === 'inventory' ? (val('item') || null) : null;
        const it = DB.items.find((x) => x.code === itemCode);
        const b = recordBill({
          partnerCode: val('partner'), vendorNo: val('vendorNo').trim(), date: val('date'),
          nonClaimableVat: val('claim') === 'no', whtCode: val('wht') || null,
          lines: [{
            desc: val('desc').trim() || (it ? it.name : ''),
            qty: Number(val('qty') || 1) || 1, price: val('price'),
            taxCode: val('tax'), acc: accCode, itemCode: itemCode,
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
  const b = no ? DB.docs.bill.find((x) => x.no === no) : null;
  if (no && !b) return;
  const refs = b ? [] : optOpenBills();
  if (!b && !needRefs(refs, 'ไม่มีเจ้าหนี้ค้างจ่าย', 'บันทึกตั้งหนี้ผู้ขายก่อน แล้วจึงจ่ายชำระ')) return;
  const out = b ? b.total - b.paid : 0;
  modal({
    title: b ? 'จ่ายชำระ ' + no : 'จ่ายชำระเจ้าหนี้',
    sub: b ? b.partnerName + ' · คงเหลือ ' + fmt(out) + ' บาท'
      : 'เลือกรายการตั้งหนี้ที่จะจ่าย · จ่ายหลายรายพร้อมกันใช้เมนูเตรียมจ่ายเงิน',
    body:'<div class="flds">'
      + (b ? '' : field({ name:'billNo', label:'อ้างรายการตั้งหนี้', type:'select', wide:true, options: refs }))
      + field({ name:'amount', label:'จำนวนเงินที่จ่าย (ก่อนหักภาษี ณ ที่จ่าย)', value: b ? fmt(out) : '',
          placeholder: b ? '' : 'เว้นว่าง = จ่ายเต็มยอดคงค้าง' })
      + field({ name:'date', label:'วันที่จ่าย', type:'date', value: defaultDate() })
      + field({ name:'wht', label:'ประเภทเงินได้ที่ต้องหักภาษี', type:'select',
          value: b ? b.whtCode || '' : '', options: optWht(b ? null : '— ตามที่ตั้งไว้ในรายการตั้งหนี้ —'),
          hint: b ? '' : 'ไม่เลือก = ใช้ประเภทที่บันทึกไว้ตอนตั้งหนี้' })
      + field({ name:'channel', label:'ช่องทางนำส่งภาษี', type:'select', value:'manual', wide:true,
          options:[['manual','หักและนำส่งเอง — ระบบจะออกหนังสือรับรอง 50 ทวิ ให้'],
                   ['e_wht','e-Withholding Tax — ธนาคารนำส่งและออกหลักฐานให้']],
          hint:'ช่องทาง e-Withholding Tax ใช้อัตราลด 1% และระบบจะกันรายการนี้ออกจากแบบ ภ.ง.ด. อัตโนมัติ' })
      + '</div>',
    submitLabel:'จ่ายและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const p = payBill({ billNo: no || val('billNo'), amount: val('amount'), date: val('date'),
          whtCode: val('wht') || null, channel: val('channel') });
        toast('บันทึกใบสำคัญจ่าย ' + p.no + ' แล้ว', 'ok',
          'จ่ายสุทธิ ' + fmt(p.net) + ' บาท' + (p.certNo ? ' · ออก 50 ทวิ เลขที่ ' + p.certNo : ''));
        return p;
      });
    },
  });
}

/* ===================================================================
   ใบวางบิล
   =================================================================== */
/** ใบกำกับของลูกค้ารายนี้ที่ยังค้าง — ใบที่อยู่ในใบวางบิลอื่นที่ยังเปิดอยู่ติ๊กไม่ได้ */
function bnInvoiceRows(partnerCode) {
  const list = DB.docs.invoice.filter((d) => d.partnerCode === partnerCode && d.status !== 'void' && invOutstanding(d) > 0)
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!list.length) return '<div class="empty">ลูกค้ารายนี้ไม่มีใบกำกับที่ค้างชำระ</div>';
  const takenBy = (no) => {
    const b = DB.docs.billingNote.find((x) => x.invoices.some((i) => i.no === no)
      && ['issued', 'partially_paid'].indexOf(billingNoteStatus(x)) >= 0);
    return b ? b.no : null;
  };
  return '<div class="scroll"><table class="lines"><thead><tr><th></th><th>ใบกำกับภาษี</th><th>วันที่</th>'
    + '<th>ครบกำหนด</th><th class="r">คงค้าง</th><th>หมายเหตุ</th></tr></thead><tbody>'
    + list.map(function (d) {
      const t = takenBy(d.no);
      return '<tr><td><input type="checkbox" name="bnInv" value="' + esc(d.no) + '"' + (t ? ' disabled' : ' checked') + '></td>'
        + '<td class="mono">' + esc(d.no) + '</td><td>' + thDateNum(d.date) + '</td><td>' + thDateNum(d.due) + '</td>'
        + '<td class="num">' + fmt(invOutstanding(d)) + '</td>'
        + '<td class="dim">' + (t ? 'อยู่ในใบวางบิล ' + esc(t) + ' แล้ว' : d.due < TODAY ? 'เลยกำหนดแล้ว' : '') + '</td></tr>';
    }).join('')
    + '</tbody></table></div>';
}

function modalBillingNote() {
  const custs = optCustomers();
  if (!needRefs(custs, 'ยังไม่มีลูกค้าในทะเบียน', 'เพิ่มลูกค้าที่เมนูผู้ติดต่อก่อน')) return;
  const hasOpen = (code) => DB.docs.invoice.some((d) => d.partnerCode === code && d.status !== 'void' && invOutstanding(d) > 0);
  const first = (custs.find((c) => hasOpen(c[0])) || custs[0])[0];
  const d = defaultDate();
  modal({
    title:'ออกใบวางบิล',
    sub:'เลือกลูกค้า แล้วติ๊กใบกำกับที่จะวางบิลเก็บเงิน — ใบวางบิลไม่มีผลทางบัญชี',
    body:'<div class="flds">'
      + field({ name:'bnPartner', label:'ลูกค้า', type:'select', value: first, options: custs })
      + field({ name:'date', label:'วันที่วางบิล', type:'date', value: d })
      + field({ name:'dueDate', label:'วันนัดชำระ / นัดรับเช็ค', type:'date', value: addDays(d, 7) })
      + field({ name:'note', label:'หมายเหตุ', wide:true, placeholder:'เช่น นัดรับเช็คทุกวันที่ 5 ของเดือน' })
      + '</div><div class="sub-h">ใบกำกับที่ค้างชำระ</div><div id="bnInvoices">' + bnInvoiceRows(first) + '</div>',
    submitLabel:'ออกใบวางบิล',
    onSubmit: function () {
      submitAction(function () {
        const bn = issueBillingNote({ partnerCode: val('bnPartner'), date: val('date'), dueDate: val('dueDate'),
          invoiceNos: checkedValues('bnInv'), note: val('note') });
        STATE.screen = 'billingnotes'; STATE.sel = bn.no;
        toast('ออกใบวางบิล ' + bn.no + ' แล้ว', 'ok', bn.invoices.length + ' ใบกำกับ รวม ' + fmt(bn.total) + ' บาท');
        return bn;
      });
    },
  });
}

function modalReceiveBillingNote(no) {
  const bn = DB.docs.billingNote.find((x) => x.no === no);
  if (!bn) return;
  const open = bn.invoices.filter((r) => {
    const inv = DB.docs.invoice.find((d) => d.no === r.no);
    return inv && invOutstanding(inv) > 0;
  });
  modal({
    title:'รับชำระตามใบวางบิล ' + no,
    sub: bn.partnerName + ' · ค้าง ' + fmt(billingNoteOutstanding(bn)) + ' บาท · ' + open.length + ' ใบกำกับ',
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่รับชำระ', type:'date', value: defaultDate() })
      + field({ name:'method', label:'วิธีรับชำระ', type:'select', value:'cheque',
          options:[['cheque','เช็ค'],['transfer','โอนเงินเข้าบัญชี'],['cash','เงินสด']] })
      + field({ name:'wht', label:'ลูกค้าหักภาษี ณ ที่จ่ายหรือไม่', type:'select', wide:true,
          options: optWht('ไม่ได้ถูกหัก'), hint:'ใช้อัตราเดียวกันกับทุกใบกำกับในใบวางบิลนี้' })
      + '</div>'
      + '<div class="note">ระบบจะออกใบเสร็จรับเงินให้ทุกใบกำกับที่ยังค้าง (' + open.map((r) => esc(r.no)).join(', ')
      + ') ในคราวเดียว ถ้าใบใดลงบัญชีไม่ได้ จะไม่ออกให้เลยสักใบ</div>',
    submitLabel:'รับชำระทั้งหมดและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const made = receiveBillingNote(no, { date: val('date'), method: val('method'), whtCode: val('wht') || null });
        toast('ออกใบเสร็จ ' + made.length + ' ใบแล้ว', 'ok',
          made.map((r) => r.no).join(', ') + ' · รับสุทธิ ' + fmt(made.reduce((s, r) => s + r.net, 0)) + ' บาท');
        return made;
      });
    },
  });
}

/** ยกเลิกเอกสาร — เหตุผลเข้าร่องรอยการตรวจสอบ */
function modalReason(o) {
  modal({
    title: o.title, sub: o.sub,
    body:'<div class="flds">' + field({ name:'reason', label:'เหตุผล', wide:true, placeholder: o.placeholder || '' }) + '</div>',
    submitLabel: o.submitLabel,
    onSubmit: function () {
      submitAction(function () {
        const r = o.run(val('reason').trim());
        toast(o.done, 'ok');
        return r;
      });
    },
  });
}

/* ===================================================================
   ใบรับสินค้า
   =================================================================== */
function modalGoodsReceipt() {
  const vends = optVendors();
  if (!needRefs(vends, 'ยังไม่มีผู้ขายในทะเบียน', 'เพิ่มผู้ขายที่เมนูผู้ติดต่อก่อน')) return;
  modal({
    title:'ออกใบรับสินค้า',
    sub:'รับของเข้าคลังก่อนใบกำกับภาษีจากผู้ขายจะมาถึง — ยอดพักไว้ที่บัญชีพักรับสินค้าจนกว่าจะตั้งหนี้',
    body:'<div class="flds">'
      + field({ name:'partner', label:'ผู้ขาย', type:'select', options: vends })
      + field({ name:'date', label:'วันที่รับสินค้า', type:'date', value: defaultDate() })
      + field({ name:'vendorDoNo', label:'เลขที่ใบส่งของของผู้ขาย', placeholder:'เช่น DO-6907-118' })
      + field({ name:'note', label:'หมายเหตุ', placeholder:'สภาพสินค้า ผู้ตรวจรับ ฯลฯ' })
      + '</div>' + lineEditor(4, 'cost'),
    submitLabel:'รับเข้าคลังและลงบัญชี',
    note:'ภาษีซื้อยังไม่เกิดในขั้นนี้ ต้องรอใบกำกับภาษีแล้วกดตั้งหนี้',
    onSubmit: function () {
      submitAction(function () {
        const g = issueGoodsReceipt({ partnerCode: val('partner'), date: val('date'),
          vendorDoNo: val('vendorDoNo'), note: val('note'), lines: collectLines(4) });
        STATE.screen = 'goodsreceipts'; STATE.sel = g.no;
        toast('ออกใบรับสินค้า ' + g.no + ' แล้ว', 'ok', 'มูลค่ารับเข้าคลัง ' + fmt(g.total) + ' บาท');
        return g;
      });
    },
  });
}

function modalReceiveFromPo(poNo) {
  const po = DB.docs.purchaseOrder.find((x) => x.no === poNo);
  if (!po) return;
  const got = poReceived(po);
  const left = po.lines.map((l, i) => roundQty(roundQty(l.qty) - got[i]));
  modal({
    title:'รับสินค้าตามใบสั่งซื้อ ' + poNo,
    sub: po.partnerName + ' · ' + po.lines.length + ' รายการ · มูลค่าก่อนภาษี ' + fmt(po.base) + ' บาท'
      + (got.some((q) => q > 0) ? ' · รับไปแล้วบางส่วน' : ''),
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่รับสินค้า', type:'date', value: defaultDate() })
      + field({ name:'vendorDoNo', label:'เลขที่ใบส่งของของผู้ขาย', placeholder:'ดูจากใบส่งของที่มากับสินค้า' })
      + '</div>'
      + '<div class="scroll"><table><thead><tr><th class="l">รายการ</th><th class="r">สั่ง</th><th class="r">รับแล้ว</th>'
      + '<th class="r">ค้างรับ</th><th class="r">รับครั้งนี้</th><th class="r">ราคาต่อหน่วย</th></tr></thead><tbody>'
      + po.lines.map((l, i) => '<tr><td>' + esc(l.desc) + '</td><td class="num">' + l.qty + '</td><td class="num">' + got[i]
        + '</td><td class="num">' + left[i] + '</td><td class="num"><input class="qty-in" type="number" min="0" step="any" name="rq' + i
        + '" value="' + left[i] + '"' + (left[i] > 0 ? '' : ' disabled') + '></td><td class="num">' + fmt(l.price) + '</td></tr>').join('')
      + '</tbody></table></div>',
    submitLabel:'รับเข้าคลังและลงบัญชี',
    note:'รับไม่ครบก็ได้ ส่วนที่เหลือรับต่อในใบรับสินค้าใบถัดไป · รับครบทุกรายการแล้วใบสั่งซื้อจะปิดเอง',
    onSubmit: function () {
      submitAction(function () {
        const lines = po.lines.map((l, i) => ({ line: i, qty: Number(val('rq' + i) || 0) })).filter((x) => x.qty > 0);
        const g = receiveGoodsFromPo(poNo, { date: val('date'), vendorDoNo: val('vendorDoNo'), lines });
        STATE.screen = 'goodsreceipts'; STATE.sel = g.no; STATE.period = periodOf(g.date);
        toast('รับสินค้าเข้าคลังแล้ว ' + g.no, 'ok', po.status === 'closed' ? 'ใบสั่งซื้อ ' + poNo + ' รับครบ ปิดรายการแล้ว'
          : 'ใบสั่งซื้อ ' + poNo + ' ยังค้างรับบางรายการ');
        return g;
      });
    },
  });
}

function modalBillFromGrn(no) {
  const g = DB.docs.goodsReceipt.find((x) => x.no === no);
  if (!g) return;
  modal({
    title:'ตั้งหนี้จากใบรับสินค้า ' + no,
    sub: g.partnerName + ' · มูลค่ารับเข้าคลัง ' + fmt(g.total) + ' บาท — ระบบล้างบัญชีพักรับสินค้าและบันทึกภาษีซื้อให้',
    body:'<div class="flds">'
      + field({ name:'vendorNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'ดูจากใบกำกับที่ผู้ขายส่งมา' })
      + field({ name:'date', label:'วันที่ตามใบกำกับ', type:'date', value: defaultDate(),
          hint:'ต้องไม่ก่อนวันที่รับสินค้า ' + thDateNum(g.date) })
      + field({ name:'tax', label:'ภาษีมูลค่าเพิ่ม', type:'select', value: g.lines[0].taxCode || 'VAT7', options: optVat })
      + field({ name:'claim', label:'สิทธิภาษีซื้อ', type:'select', value:'yes',
          options:[['yes','ขอคืนได้'],['no','ภาษีซื้อต้องห้าม ตามมาตรา 82/5']] })
      + field({ name:'wht', label:'ภาษีหัก ณ ที่จ่ายตอนจ่ายเงิน', type:'select', wide:true, options: optWht(),
          hint:'ซื้อสินค้าโดยทั่วไปไม่ต้องหัก' })
      + '</div>',
    submitLabel:'ตั้งหนี้และลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const b = billGoodsReceipt(no, { vendorNo: val('vendorNo'), date: val('date'), taxCode: val('tax'),
          nonClaimableVat: val('claim') === 'no', whtCode: val('wht') || null });
        toast('ตั้งหนี้ ' + b.no + ' จากใบรับสินค้า ' + no + ' แล้ว', 'ok', 'รวมทั้งสิ้น ' + fmt(b.total) + ' บาท');
        return b;
      });
    },
  });
}

/* ===================================================================
   ค่าใช้จ่าย และหนังสือรับรองหัก ณ ที่จ่าย — ฟอร์มเดียวกัน
   จากแถบหัก ณ ที่จ่าย บังคับเลือกประเภทเงินได้ เพราะ 50 ทวิ ทุกใบต้องผูกกับการจ่ายเงินจริง
   =================================================================== */
const EXP_ROWS = 3;
function expenseLines() {
  const accs = [['', '— เลือกบัญชี —']].concat(expenseAccounts().map((a) => [a.code, a.code + ' ' + a.name]));
  let h = '<div class="sub-h">รายการค่าใช้จ่าย</div><div class="scroll"><table class="lines"><thead><tr>'
    + '<th>รายการ</th><th>บันทึกเข้าบัญชี</th><th class="r">จำนวน</th><th class="r">ราคาต่อหน่วย (ก่อนภาษี)</th><th>ภาษี</th></tr></thead><tbody>';
  for (let i = 0; i < EXP_ROWS; i++) {
    h += '<tr><td><input name="e' + i + '_desc" placeholder="' + (i === 0 ? 'เช่น ค่าซ่อมเครื่องปรับอากาศ' : '') + '"></td>'
      + '<td><select name="e' + i + '_acc">' + accs.map((o) => '<option value="' + esc(o[0]) + '">' + esc(o[1]) + '</option>').join('') + '</select></td>'
      + '<td><input name="e' + i + '_qty" class="r" value="' + (i === 0 ? '1' : '') + '"></td>'
      + '<td><input name="e' + i + '_price" class="r"></td>'
      + '<td><select name="e' + i + '_tax">' + optVat.map((o) => '<option value="' + o[0] + '">' + esc(o[1]) + '</option>').join('') + '</select></td></tr>';
  }
  return h + '</tbody></table></div><div class="jv-tot" id="expSum"></div>';
}
function collectExpenseLines() {
  const out = [];
  for (let i = 0; i < EXP_ROWS; i++) {
    const desc = val('e' + i + '_desc').trim();
    const price = val('e' + i + '_price');
    if (!desc && !price) continue;
    out.push({ desc, acc: val('e' + i + '_acc'), qty: Number(val('e' + i + '_qty') || 1) || 1,
      price, taxCode: val('e' + i + '_tax') || 'VAT7' });
  }
  return out;
}
/** สรุปยอดสด ๆ ระหว่างกรอก — ใช้สูตรเดียวกับตอนลงบัญชี ตัวเลขที่เห็นจึงตรงกับที่จะบันทึก */
function refreshExpenseSum() {
  const el = document.getElementById('expSum');
  if (!el) return;
  try {
    const date = val('date') || TODAY;
    const lines = collectExpenseLines().filter((l) => l.desc && M(l.price) > 0);
    const v = computeVat(lines, date);
    const base = v.std + v.zero + v.exempt;
    let wht = 0;
    const code = val('wht');
    if (code && base >= M('1000')) wht = round2(pct(base, resolveRate(code, date, { channel: val('channel') || 'manual' }).rate));
    el.innerHTML = '<span>ก่อนภาษี <b>' + fmt(base) + '</b></span><span>ภาษีซื้อ <b>' + fmt(v.vat) + '</b></span>'
      + '<span>หัก ณ ที่จ่าย <b>' + fmt(wht) + '</b></span><span>จ่ายสุทธิ <b>' + fmt(v.total - wht) + '</b></span>';
  } catch (e) { el.textContent = ''; }
}

function modalExpense(opts) {
  const o = opts || {};
  const vends = DB.partners.filter((p) => p.kind === 'vendor');
  if (!needRefs(vends, 'ยังไม่มีผู้ขายในทะเบียน', 'เพิ่มผู้รับเงินที่เมนูผู้ติดต่อ → ผู้ขาย ก่อน')) return;
  const first = (o.requireWht ? vends.find((p) => p.whtCode) : null) || vends[0];
  const pay = payFromAccounts().map((a) => [a.code, a.code + ' ' + a.name]);
  let bank = '';
  try { bank = accBySub('bank'); } catch (e) { bank = pay.length ? pay[0][0] : ''; }
  modal({
    title: o.requireWht ? 'ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)' : 'บันทึกค่าใช้จ่าย',
    sub: o.requireWht
      ? 'หนังสือรับรองทุกฉบับต้องผูกกับการจ่ายเงินจริง — ระบบบันทึกค่าใช้จ่ายและการจ่ายเงินให้พร้อมกัน'
      : 'ค่าใช้จ่ายที่จ่ายทันที ถ้ามีหัก ณ ที่จ่าย ระบบออกหนังสือรับรอง 50 ทวิ ให้เองในแถบหัก ณ ที่จ่าย',
    body:'<div class="flds">'
      + field({ name:'expPartner', label:'ผู้รับเงิน', type:'select', value: first.code,
          options: vends.map((p) => [p.code, p.name]) })
      + field({ name:'date', label:'วันที่จ่าย', type:'date', value: defaultDate() })
      + field({ name:'payFrom', label:'จ่ายจากบัญชี', type:'select', value: bank, options: pay })
      + field({ name:'method', label:'วิธีจ่าย', type:'select', value:'transfer',
          options:[['transfer','โอนเงิน'],['cheque','เช็ค'],['cash','เงินสด']] })
      + field({ name:'taxInvoiceNo', label:'เลขที่ใบกำกับภาษีของผู้ขาย', placeholder:'เว้นว่างถ้าไม่มีใบกำกับภาษี',
          hint:'ต้องกรอกถ้าจะขอคืนภาษีซื้อ' })
      + field({ name:'claim', label:'สิทธิภาษีซื้อ', type:'select', value:'yes',
          options:[['yes','ขอคืนได้'],['no','ภาษีซื้อต้องห้าม ตามมาตรา 82/5']] })
      + field({ name:'wht', label:'หักภาษี ณ ที่จ่าย (ประเภทเงินได้)', type:'select',
          value: first.whtCode || '', options: optWht(o.requireWht ? '— เลือกประเภทเงินได้ —' : null),
          hint:'เลือกผู้รับเงินแล้วระบบเติมประเภทที่ตั้งไว้ในทะเบียนให้' })
      + (o.requireWht ? '' : field({ name:'channel', label:'ช่องทางนำส่งภาษี', type:'select', value:'manual',
          options:[['manual','หักและนำส่งเอง — ออก 50 ทวิ ให้'], ['e_wht','e-Withholding Tax — ธนาคารออกหลักฐานให้']] }))
      + field({ name:'note', label:'หมายเหตุ', wide:true })
      + '</div>' + expenseLines(),
    submitLabel: o.requireWht ? 'จ่ายเงินและออกหนังสือรับรอง' : 'บันทึกและลงบัญชี',
    note:'จ่ายครั้งหนึ่งต่ำกว่า 1,000 บาท ไม่ต้องหักภาษี ณ ที่จ่าย',
    onSubmit: function () {
      submitAction(function () {
        const e = recordExpense({
          partnerCode: val('expPartner'), date: val('date'), payFrom: val('payFrom'), method: val('method'),
          taxInvoiceNo: val('taxInvoiceNo'), nonClaimableVat: val('claim') === 'no',
          whtCode: val('wht') || null, channel: o.requireWht ? 'manual' : val('channel'),
          requireWht: !!o.requireWht, note: val('note'), lines: collectExpenseLines(),
        });
        if (o.requireWht && e.certNo) { STATE.screen = 'whtcert'; STATE.sel = e.certNo; }
        else { STATE.screen = 'expenses'; STATE.sel = e.no; }
        toast('บันทึกค่าใช้จ่าย ' + e.no + ' แล้ว', 'ok', 'จ่ายสุทธิ ' + fmt(e.net) + ' บาท'
          + (e.certNo ? ' · ออกหนังสือรับรอง 50 ทวิ เลขที่ ' + e.certNo + ' ให้แล้ว' : ''));
        return e;
      });
    },
  });
  refreshExpenseSum();
}

/* ===================================================================
   เตรียมจ่ายเงิน
   =================================================================== */
function modalPaymentBatch() {
  const inBatch = new Set();
  DB.docs.paymentBatch.filter(paymentBatchActive).forEach((b) => b.items.forEach((i) => inBatch.add(i.billNo)));
  const list = DB.docs.bill.filter((b) => billOutstanding(b) > 0 && !inBatch.has(b.no))
    .slice().sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  if (!needRefs(list, 'ไม่มีเจ้าหนี้ค้างจ่ายที่ยังไม่อยู่ในใบเตรียมจ่าย', 'ตั้งหนี้ผู้ขายก่อน หรือดูใบเตรียมจ่ายที่มีอยู่')) return;
  const d = defaultDate();
  const payDate = addDays(d, 7);
  modal({
    title:'จัดทำใบเตรียมจ่าย',
    sub:'เลือกรายการตั้งหนี้ที่จะจ่ายรอบนี้ — ระบบติ๊กรายการที่ครบกำหนดภายในวันที่จะจ่ายไว้ให้',
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่จัดทำ', type:'date', value: d })
      + field({ name:'payDate', label:'วันที่จะจ่าย', type:'date', value: payDate })
      + field({ name:'note', label:'หมายเหตุ', wide:true, placeholder:'เช่น รอบจ่ายวันที่ 5 ของเดือน' })
      + '</div>'
      + '<div class="scroll"><table class="lines"><thead><tr><th></th><th>ตั้งหนี้</th><th>ผู้ขาย</th><th>ครบกำหนด</th>'
      + '<th class="r">คงค้าง</th><th>หัก ณ ที่จ่าย</th></tr></thead><tbody>'
      + list.map((b) => '<tr><td><input type="checkbox" name="pbBill" value="' + esc(b.no) + '"' + (b.due <= payDate ? ' checked' : '') + '></td>'
        + '<td class="mono">' + esc(b.no) + '</td><td>' + esc(b.partnerName) + '</td>'
        + '<td>' + thDateNum(b.due) + (b.due < TODAY ? ' <span class="st late">เลยกำหนด</span>' : '') + '</td>'
        + '<td class="num">' + fmt(billOutstanding(b)) + '</td>'
        + '<td class="dim">' + (b.whtCode ? esc(resolveRate(b.whtCode, TODAY, { channel:'manual' }).label) : '—') + '</td></tr>').join('')
      + '</tbody></table></div>',
    submitLabel:'บันทึกและส่งอนุมัติ',
    note:'ยังไม่ลงบัญชี ตัวเลขเข้าบัญชีตอนกดจ่ายหลังอนุมัติแล้ว',
    onSubmit: function () {
      submitAction(function () {
        const b = createPaymentBatch({ date: val('date'), payDate: val('payDate'), note: val('note'),
          billNos: checkedValues('pbBill') });
        STATE.screen = 'paymentprep'; STATE.sel = b.no;
        toast('จัดทำใบเตรียมจ่าย ' + b.no + ' แล้ว', 'ok', b.items.length + ' ราย · เงินที่ต้องเตรียม ' + fmt(b.net) + ' บาท · รออนุมัติ');
        return b;
      });
    },
  });
}

function modalPayBatch(no) {
  const b = DB.docs.paymentBatch.find((x) => x.no === no);
  if (!b) return;
  const banks = payFromAccounts().map((a) => [a.code, a.code + ' ' + a.name]);
  let bank = '';
  try { bank = accBySub('bank'); } catch (e) { bank = banks.length ? banks[0][0] : ''; }
  modal({
    title:'จ่ายตามใบเตรียมจ่าย ' + no,
    sub: b.items.length + ' ราย · เงินที่ต้องเตรียม ' + fmt(b.net) + ' บาท · อนุมัติแล้ว',
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่จ่าย', type:'date', value: b.payDate })
      + field({ name:'bankAccount', label:'จ่ายจากบัญชี', type:'select', value: bank, options: banks })
      + field({ name:'channel', label:'ช่องทางนำส่งภาษี', type:'select', value:'manual', wide:true,
          options:[['manual','หักและนำส่งเอง — ระบบออกหนังสือรับรอง 50 ทวิ ให้'],
                   ['e_wht','e-Withholding Tax — ธนาคารนำส่งและออกหลักฐานให้']] })
      + '</div>'
      + '<div class="note">ระบบจะออกใบสำคัญจ่ายให้ทุกราย ถ้ารายใดลงบัญชีไม่ได้ จะไม่จ่ายให้เลยสักราย</div>',
    submitLabel:'จ่ายทั้งหมดและลงบัญชี',
    onSubmit: function () {
      submitAction(function () {
        const made = payPaymentBatch(no, { date: val('date'), channel: val('channel'), bankAccount: val('bankAccount') });
        const certs = made.filter((p) => p.certNo).length;
        toast('ออกใบสำคัญจ่าย ' + made.length + ' ใบแล้ว', 'ok',
          'จ่ายสุทธิ ' + fmt(made.reduce((s, p) => s + p.net, 0)) + ' บาท' + (certs ? ' · ออก 50 ทวิ ' + certs + ' ฉบับ' : ''));
        return made;
      });
    },
  });
}

/* ===================================================================
   บันทึกรายการในสมุดรายวัน (ใบสำคัญ) — แต่ละเล่มมีกติกาของตัวเอง
   =================================================================== */
const JV_ROWS = 6;
function refreshJvTotals() {
  const el = document.getElementById('jvTot');
  if (!el) return;
  let dr = 0, cr = 0;
  for (let i = 0; i < JV_ROWS; i++) { dr += M(val('j' + i + '_dr')); cr += M(val('j' + i + '_cr')); }
  const diff = dr - cr;
  el.innerHTML = '<span>เดบิตรวม <b>' + fmt(dr) + '</b></span><span>เครดิตรวม <b>' + fmt(cr) + '</b></span>'
    + (dr === 0 && cr === 0 ? '' : diff === 0 ? '<span class="good">สมดุล</span>'
      : '<span class="bad">ต่างกัน ' + fmt(Math.abs(diff)) + '</span>');
}

function modalJournalVoucher(book) {
  const cfg = JOURNAL_BOOKS[book];
  if (!cfg) return;
  const accs = [['', '— เลือกบัญชี —']].concat(DB.accounts
    .filter((a) => a.postable && !CONTROL_SUBS[a.subType]).map((a) => [a.code, a.code + ' ' + a.name]));
  let bank = '';
  try { bank = accBySub('bank'); } catch (e) { bank = ''; }
  /* เติมบัญชีธนาคารให้ในบรรทัดที่เล่มนั้นต้องมี — รับ: เดบิตธนาคาร · จ่าย: เครดิตธนาคาร */
  const preset = book === 'receipt' ? { 0: bank } : book === 'payment' ? { 1: bank } : {};
  const SUB = {
    general: 'รายการปรับปรุง ตั้งค้างจ่าย ค่าเสื่อม หรือโอนเงินระหว่างบัญชีของบริษัทเอง — รายการที่มีเงินเข้าออกให้ใช้เล่มรับหรือเล่มจ่าย',
    purchase: 'ซื้อเงินเชื่อที่ไม่มีเอกสารซื้อรองรับ เช่น ตั้งค่าใช้จ่ายค้างจ่าย — ถ้ามีใบกำกับภาษีให้บันทึกตั้งหนี้ผู้ขายแทน',
    sales: 'ขายเงินเชื่อที่ไม่ผ่านใบกำกับภาษี เช่น รายได้ค้างรับ — การขายที่ออกใบกำกับให้ทำที่เมนูเอกสารขาย',
    payment: 'เงินออกที่ไม่มีเอกสารอื่นรองรับ เช่น ค่าธรรมเนียมธนาคาร — จ่ายเจ้าหนี้ใช้ใบสำคัญจ่ายหรือเตรียมจ่ายเงิน',
    receipt: 'เงินเข้าที่ไม่มีเอกสารขายรองรับ เช่น ดอกเบี้ยรับ เงินกู้ยืม — รับชำระจากลูกค้าใช้ใบเสร็จรับเงิน',
  };
  let rows = '';
  for (let i = 0; i < JV_ROWS; i++) {
    rows += '<tr><td><select name="j' + i + '_acc">'
      + accs.map((o) => '<option value="' + esc(o[0]) + '"' + (preset[i] === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('')
      + '</select></td><td><input name="j' + i + '_memo"></td>'
      + '<td><input name="j' + i + '_dr" class="r jvamt"></td><td><input name="j' + i + '_cr" class="r jvamt"></td></tr>';
  }
  modal({
    title:'สร้าง' + cfg.voucher + ' — ' + cfg.label,
    sub: SUB[book],
    body:'<div class="flds">'
      + field({ name:'date', label:'วันที่', type:'date', value: defaultDate() })
      + field({ name:'ref', label:'เลขที่เอกสารอ้างอิง (ถ้ามี)', placeholder:'เช่น เลขที่ใบเสร็จของธนาคาร' })
      + field({ name:'desc', label:'คำอธิบายรายการ', wide:true, placeholder:'ผู้สอบบัญชีอ่านแล้วต้องเข้าใจว่าเป็นรายการอะไร' })
      + '</div><div class="scroll"><table class="lines"><thead><tr><th>บัญชี</th><th>คำอธิบายบรรทัด</th>'
      + '<th class="r">เดบิต</th><th class="r">เครดิต</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="jv-tot" id="jvTot"></div>',
    submitLabel:'ลงบัญชีและออกเลขที่',
    note:'บัญชีคุมไม่อยู่ในรายการให้เลือก เพราะต้องเกิดจากเอกสารเท่านั้น',
    onSubmit: function () {
      submitAction(function () {
        const lines = [];
        for (let i = 0; i < JV_ROWS; i++) {
          lines.push({ acc: val('j' + i + '_acc'), memo: val('j' + i + '_memo'),
            dr: val('j' + i + '_dr'), cr: val('j' + i + '_cr') });
        }
        const je = postJournalVoucher({ book, date: val('date'), desc: val('desc'), ref: val('ref'), lines });
        STATE.screen = BOOK_SCREEN[book]; STATE.sel = je.no; STATE.period = periodOf(je.date);
        toast('ลง' + cfg.label + 'แล้ว เลขที่ ' + je.no, 'ok', 'ยอด ' + fmt(je.total) + ' บาท');
        return je;
      });
    },
  });
  refreshJvTotals();
}

/* ---------- ข้อมูลกิจการ ---------- */
function modalCompany() {
  const c = DB.company;
  modal({
    title:'แก้ไขข้อมูลกิจการ',
    sub:'ข้อมูลชุดนี้พิมพ์ลงหัวใบกำกับภาษี ใบเสร็จ และหนังสือรับรอง 50 ทวิ ทุกใบ',
    body:'<div class="flds">'
      + field({ name:'coname', label:'ชื่อผู้ประกอบการ (ตามหนังสือรับรอง)', wide:true, value: c.name })
      + field({ name:'conameEn', label:'ชื่อภาษาอังกฤษ', wide:true, value: c.nameEn || '' })
      + field({ name:'cotax', label:'เลขประจำตัวผู้เสียภาษี 13 หลัก', value: c.taxId || '',
          hint:'ระบบตรวจหลักที่ 13 ให้' })
      + field({ name:'cobranch', label:'รหัสสาขา', value: c.branch || '00000', hint:'สำนักงานใหญ่ใช้ 00000' })
      + field({ name:'coaddr', label:'ที่อยู่สถานประกอบการ', wide:true, value: c.address || '' })
      + field({ name:'cophone', label:'โทรศัพท์', value: c.phone || '' })
      + field({ name:'covat', label:'จดทะเบียนภาษีมูลค่าเพิ่ม', type:'select', value: c.vatRegistered === false ? 'no' : 'yes',
          options:[['yes','จดทะเบียนแล้ว'],['no','ยังไม่ได้จดทะเบียน']] })
      + field({ name:'cobook', label:'ผู้ทำบัญชี', value: c.bookkeeper || '' })
      + field({ name:'coaudit', label:'ผู้สอบบัญชี', value: c.auditor || '' })
      + '</div>',
    submitLabel:'บันทึกข้อมูลกิจการ',
    onSubmit: function () {
      submitAction(function () {
        const r = saveCompany({ name: val('coname'), nameEn: val('conameEn'), taxId: val('cotax'), branch: val('cobranch'),
          address: val('coaddr'), phone: val('cophone'), vatRegistered: val('covat') !== 'no',
          bookkeeper: val('cobook'), auditor: val('coaudit') });
        toast('บันทึกข้อมูลกิจการแล้ว', 'ok', r.name);
        return r;
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

/* ---------- ยกเลิกเอกสาร ----------
   ตรวจก่อนเปิดหน้าต่าง ถ้ายกเลิกไม่ได้บอกเหตุผลและวิธีแก้ทันที ไม่ต้องให้กรอกเหตุผลก่อนแล้วค่อยรู้ */
function modalVoid(kind, no) {
  let lines;
  try { lines = voidPreview(kind, no); }
  catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    return;
  }
  const label = VOIDABLE[kind].label;
  modal({
    title:'ยกเลิก' + label + ' ' + no,
    sub:'เลขที่เอกสารยังอยู่และขึ้นว่า "ยกเลิก" — ระบบไม่ลบข้อมูลใด ๆ ทิ้ง',
    body:'<div class="void-prev"><b>ระบบจะทำสิ่งเหล่านี้ให้ในครั้งเดียว ถ้าขั้นใดไม่ผ่านจะไม่มีอะไรเปลี่ยน</b><ul>'
      + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul></div>'
      + '<div class="flds">' + field({ name:'reason', label:'เหตุผลที่ยกเลิก', wide:true,
          placeholder:'เช่น ออกผิดลูกค้า / ลูกค้ายกเลิกคำสั่งซื้อ — อย่างน้อย 5 ตัวอักษร' }) + '</div>',
    submitLabel:'ยืนยันยกเลิก' + label, submitKind:'danger',
    onSubmit: function () {
      submitAction(function () {
        const d = voidDocument(kind, no, val('reason'));
        toast('ยกเลิก' + label + ' ' + no + ' แล้ว', 'ok', 'กลับรายการใบสำคัญ ณ วันที่ ' + thDate(d.date) + ' และปรับทะเบียนที่เกี่ยวข้องครบแล้ว');
        return d;
      });
    },
  });
}
function modalVoidRun(kind, period) {
  try { runCheck(kind, period); }
  catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    return;
  }
  const label = RUN_KINDS[kind].label;
  const what = kind === 'depreciation'
    ? ['กลับรายการใบสำคัญค่าเสื่อมราคา ณ วันสิ้นงวด', 'คืนค่าเสื่อมสะสมทางบัญชีและทางภาษีของทรัพย์สินทุกรายการในงวดนี้']
    : ['กลับรายการใบสำคัญเงินเดือน ณ วันจ่าย', 'ตัดรายการออกจากแบบ ภ.ง.ด.1 ของงวด', 'ทำเงินเดือนงวดนี้ใหม่ได้หลังยกเลิก'];
  modal({
    title:'ยกเลิก' + label + ' ' + thPeriod(period),
    sub:'ยกเลิกแล้วทำใหม่ได้ ประวัติการยกเลิกเก็บไว้ในร่องรอยการตรวจสอบ',
    body:'<div class="void-prev"><b>ระบบจะทำสิ่งเหล่านี้ให้ในครั้งเดียว</b><ul>'
      + what.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul></div>'
      + '<div class="flds">' + field({ name:'reason', label:'เหตุผลที่ยกเลิก', wide:true,
          placeholder:'อย่างน้อย 5 ตัวอักษร' }) + '</div>',
    submitLabel:'ยืนยันยกเลิกงวด', submitKind:'danger',
    onSubmit: function () {
      submitAction(function () {
        const r = voidRun(kind, period, val('reason'));
        toast('ยกเลิก' + label + ' ' + thPeriod(period) + ' แล้ว', 'ok', 'ทำใหม่ได้ทันทีถ้าต้องการ');
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

  if (peekDispatch(head, arg, rest)) return;
  if (head === 'go')      { STATE.screen = arg; STATE.sel = null; STATE.filter = ''; render();
    if (arg === 'settings') refreshTrash().then(function () { if (STATE.screen === 'settings') render(); });
    return; }
  if (head === 'cmdk')    { openCmdk(''); return; }
  if (head === 'cmdkgo')  { cmdkRun(Number(arg)); return; }
  if (head === 'pop')     { if (!closePop()) openPop(document.getElementById('newBtn')); return; }
  if (head === 'popgo')   { closePop(); dispatch(arg); return; }
  if (head === 'theme')   { toggleTheme(); return; }
  if (head === 'density') { if (arg) setDensity(arg); else cycleDensity(); return; }
  if (head === 'era')     { setEra(arg); return; }
  if (head === 'chip')    { STATE.chip[rest[0]] = rest[1]; render(); return; }
  if (head === 'sview')   { openView(arg); return; }
  if (head === 'sviewdel') { deleteView(arg); return; }
  if (head === 'viewsave') { modalSaveView(); return; }
  if (head === 'rowgo')   { closeRowMenu(); dispatch(arg); return; }
  if (head === 'copy')    { copyText(arg); return; }
  if (head === 'printdoc') { printDoc(rest[0], rest.slice(1).join(':')); return; }
  if (head === 'printgo') { printNow(); return; }
  if (head === 'printclose') { closePrint(); return; }
  if (head === 'navg') {
    const g = navGroups().find((x) => x.g === arg);
    if (g) { STATE.navGroupOpen[arg] = !navGroupIsOpen(g); renderNav(); }
    return;
  }
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
  if (head === 'company')  {
    if (arg === 'new') modalNewCompany(); else if (arg === 'edit') modalCompany(); else companyDispatch(arg, rest);
    return;
  }
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
    const postsToLedger = ['invoice', 'bill', 'receipt', 'creditnote', 'debitnote', 'payment',
      'goodsreceipt', 'expense', 'whtcert'].indexOf(arg) >= 0;
    if (postsToLedger && !periodIsOpen()) {
      toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน'); return;
    }
    if (arg === 'invoice') modalInvoice();
    if (arg === 'bill') modalBill();
    if (arg === 'quotation') modalTradeDoc('quotation');
    if (arg === 'salesorder') modalTradeDoc('salesOrder');
    if (arg === 'purchaseorder') modalTradeDoc('purchaseOrder');
    if (arg === 'receipt') modalReceive(null);
    if (arg === 'creditnote') modalCreditNote(null);
    if (arg === 'debitnote') modalDebitNote(null);
    if (arg === 'payment') modalPayBill(null);
    if (arg === 'billingnote') modalBillingNote();
    if (arg === 'goodsreceipt') modalGoodsReceipt();
    if (arg === 'expense') modalExpense();
    if (arg === 'whtcert') modalExpense({ requireWht: true });
    if (arg === 'paymentbatch') modalPaymentBatch();
    return;
  }
  if (head === 'jv') {
    if (!periodIsOpen()) {
      toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน'); return;
    }
    modalJournalVoucher(arg);
    return;
  }
  /* เปิดเอกสารปลายทางจากอีกหน้าหนึ่ง — เลื่อนงวดตามวันที่ของเอกสารให้ด้วย ไม่งั้นหาไม่เจอ */
  if (head === 'open') {
    const [screen, no] = rest;
    const coll = { expenses:'expense', whtcert:'whtCert', bills:'bill', goodsreceipts:'goodsReceipt',
      invoices:'invoice', billingnotes:'billingNote', paymentprep:'paymentBatch', receipts:'receipt',
      creditnotes:'creditNote', debitnotes:'debitNote', payments:'payment' }[screen];
    const doc = coll ? (DB.docs[coll] || []).find((d) => d.no === no) : null;
    if (doc && DB.periods.some((p) => p.code === periodOf(doc.date))) STATE.period = periodOf(doc.date);
    /* เงินเดือนและค่าเสื่อมอ้างด้วยรหัสงวด — เปิดงวดนั้นเลย */
    const byPeriod = screen === 'payroll' || screen === 'deprec';
    if (byPeriod && DB.periods.some((p) => p.code === no)) STATE.period = no;
    STATE.screen = screen; STATE.sel = byPeriod || screen === 'import' ? null : no; STATE.filter = '';
    render();
    return;
  }
  if (head === 'bn') {
    const [what, no] = rest;
    if (what === 'receive') modalReceiveBillingNote(no);
    if (what === 'cancel') modalReason({ title:'ยกเลิกใบวางบิล ' + no,
      sub:'ใบกำกับในใบวางบิลนี้จะกลับไปวางบิลใหม่ได้ ใบเสร็จที่ออกไปแล้วไม่ถูกแตะ',
      placeholder:'เช่น ลูกค้าขอเปลี่ยนวันนัดชำระ', submitLabel:'ยกเลิกใบวางบิล',
      done:'ยกเลิกใบวางบิล ' + no + ' แล้ว', run: (r) => cancelBillingNote(no, r) });
    return;
  }
  if (head === 'grn') {
    const [what, no] = rest;
    if (what === 'po') modalReceiveFromPo(no);
    if (what === 'bill') modalBillFromGrn(no);
    return;
  }
  if (head === 'pb') {
    const [what, no] = rest;
    if (what === 'approve') runAction(function () {
      const b = approvePaymentBatch(no);
      toast('อนุมัติใบเตรียมจ่าย ' + no + ' แล้ว', 'ok', 'กดจ่ายตามใบเตรียมจ่ายได้เลย · เงินที่ต้องเตรียม ' + fmt(b.net) + ' บาท');
    });
    if (what === 'pay') modalPayBatch(no);
    if (what === 'cancel') modalReason({ title:'ยกเลิกใบเตรียมจ่าย ' + no,
      sub:'รายการตั้งหนี้ในใบนี้จะกลับไปจัดชุดใหม่ได้', placeholder:'เช่น เลื่อนรอบจ่าย',
      submitLabel:'ยกเลิกใบเตรียมจ่าย', done:'ยกเลิกใบเตรียมจ่าย ' + no + ' แล้ว',
      run: (r) => cancelPaymentBatch(no, r) });
    return;
  }
  if (head === 'pay')     { modalReceive(arg); return; }
  if (head === 'impundo') { modalUndoImport(arg); return; }
  if (head === 'partner') {
    const [what, v] = rest;
    if (what === 'new') modalPartner(v, null);
    if (what === 'edit') modalPartner(null, v);
    return;
  }
  if (head === 'item') {
    if (rest[0] === 'new') modalItem(null);
    if (rest[0] === 'edit') modalItem(rest[1]);
    return;
  }
  if (head === 'emp') {
    if (rest[0] === 'new') modalEmployee(null);
    if (rest[0] === 'edit') modalEmployee(rest[1]);
    return;
  }
  if (head === 'asset') {
    if (rest[0] === 'new') modalAsset(null);
    if (rest[0] === 'edit') modalAsset(rest[1]);
    return;
  }
  if (head === 'cn')      { modalCreditNote(arg); return; }
  if (head === 'refund')  { modalRefund(arg); return; }
  if (head === 'newyear') {
    runAction(function () {
      const made = openNextFiscalYear('เปิดจากหน้าปิดงวด');
      toast('เปิดงวดบัญชี ' + made.length + ' งวดแล้ว', 'ok', thPeriod(made[0]) + ' ถึง ' + thPeriod(made[made.length - 1]));
    });
    return;
  }
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
  if (head === 'void')    { modalVoid(rest[0], rest.slice(1).join(':')); return; }
  if (head === 'voidrun') { modalVoidRun(rest[0], rest[1]); return; }
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
    /* คลิกนอกเมนูสร้างเอกสารหรือนอกกล่องค้นหา ให้ปิด */
    if (!ev.target.closest('#pop') && !(el && el.id === 'newBtn')) closePop();
    if (ev.target.id === 'cmdk') { closeCmdk(); return; }
    if (!el) return;
    if (el.classList.contains('disabled')) { ev.preventDefault(); return; }
    ev.preventDefault();
    const act = el.getAttribute('data-act');
    if (act === 'csv') { exportCsv(el.closest('.card')); return; }
    dispatch(act);
  });
  window.addEventListener('afterprint', function () { document.body.classList.remove('printing'); });

  document.addEventListener('input', function (ev) {
    if (ev.target.id === 'cmdkQ') { cmdkRefresh(); return; }
    const n = ev.target.name || '';
    if (/^j\d+_(dr|cr)$/.test(n)) { refreshJvTotals(); return; }
    if (/^e\d+_(qty|price)$/.test(n)) { refreshExpenseSum(); return; }
    if (ev.target.id !== 'q') return;
    STATE.filter = ev.target.value;
    render();
    const q = document.getElementById('q');
    if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  });

  document.addEventListener('change', function (ev) {
    const t = ev.target;
    if (t.id === 'periodSel') { STATE.period = t.value; STATE.sel = null; save(); render(); return; }
    if (t.id === 'prCopies')  { PRINT.copies = t.value; renderPrint(); return; }
    /* เปลี่ยนใบกำกับที่อ้างในใบลดหนี้/เพิ่มหนี้ — อัตราภาษีและสินค้าที่รับคืนได้เปลี่ยนตาม */
    if (t.name === 'invoiceNo' && t.closest('[data-note]')) {
      const kind = t.closest('[data-note]').getAttribute('data-note');
      if (kind === 'cn') modalCreditNote(t.value, true); else modalDebitNote(t.value, true);
      return;
    }
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
      const unit = it ? (t.getAttribute('data-cost') ? it.avgCost : it.price) : 0;
      if (it && price) price.value = unit ? fmt(unit) : '';
      if (it && desc) desc.value = it.name;
      if (it && qty && !qty.value) qty.value = '1';
      return;
    }
    if (t.name === 'bnPartner') {
      const box = document.getElementById('bnInvoices');
      if (box) box.innerHTML = bnInvoiceRows(t.value);
      return;
    }
    if (t.name === 'expPartner') {
      const p = DB.partners.find((x) => x.code === t.value);
      const w = document.querySelector('[name="wht"]');
      if (p && w) w.value = p.whtCode || '';
      refreshExpenseSum();
      return;
    }
    if (/^e\d+_tax$/.test(t.name || '') || ((t.name === 'wht' || t.name === 'channel' || t.name === 'date')
        && document.getElementById('expSum'))) {
      refreshExpenseSum();
      return;
    }
    if (t.name === 'expenseSub') {
      const item = document.querySelector('[name="item"]');
      if (item) item.disabled = t.value !== 'inventory';
      return;
    }
  });

  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && (ev.key === 'k' || ev.key === 'K')) {
      ev.preventDefault();
      if (!closeCmdk()) openCmdk('');
      return;
    }
    if (cmdkKey(ev)) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
    const modalOpen = document.getElementById('modal').classList.contains('show');
    if (ev.key === '/' && !typing && !modalOpen) { ev.preventDefault(); openCmdk(''); return; }
    if (ev.key === 'Escape' && (closePop() || closePrint())) return;
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
      /* ไฟล์สำรองของระบบเอง — เปิดเป็นบริษัทแยกเล่ม ไม่ทับบริษัทที่เปิดอยู่ */
      if (isBackupFile(pkg)) { STATE.imp = null; await restoreBackupFile(pkg, file.name); return; }
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
  applyTheme(lsGet(THEME_KEY));
  applyDensity();
  applyEra();
  bindEvents();
  bindTableEvents();
  bindPeekEvents();
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
