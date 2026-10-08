/* ===================================================================
   เอกสารพิมพ์ A4 — ตามสเปก docs/11
   ทุกใบมีหัวผู้ออกครบ (ชื่อ ที่อยู่ เลขผู้เสียภาษี สาขา) ชื่อเอกสารเด่นชัด
   ต้นฉบับ/สำเนา จำนวนเงินเป็นตัวอักษร ช่องลงนาม และลายน้ำเมื่อยกเลิก
   =================================================================== */
const PRINT = { kind: null, no: null, copies: 'all' };
const branchLabel = (b) => (!b || b === '00000' ? 'สำนักงานใหญ่' : 'สาขาที่ ' + b);
const pm = (v) => fmt(v || 0);

function pHead(title, en, copy) {
  const c = DB.company;
  return '<div class="p-head"><div class="p-co"><b>' + esc(c.name) + '</b>'
    + (c.nameEn ? '<div>' + esc(c.nameEn) + '</div>' : '')
    + '<div>' + esc(c.address || '') + '</div>'
    + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(c.taxId || '—') + ' · ' + esc(c.branchName || branchLabel(c.branch))
    + (c.phone ? ' · โทร ' + esc(c.phone) : '') + '</div></div>'
    + '<div class="p-title"><h1>' + esc(title) + '</h1>'
    + (en ? '<div class="en">' + esc(en) + '</div>' : '')
    + (copy ? '<div class="p-copy">' + esc(copy) + '</div>' : '') + '</div></div>';
}
function pParty(label, p) {
  p = p || {};
  return '<div class="p-box"><div class="lb">' + esc(label) + '</div>'
    + '<div><b>' + esc(p.name || '—') + '</b></div>'
    + (p.address ? '<div>' + esc(p.address) + '</div>' : '')
    + '<div>เลขประจำตัวผู้เสียภาษี ' + esc(p.taxId || '—')
    + (p.entityType === 'individual' && !p.branch ? '' : ' · ' + esc(branchLabel(p.branch))) + '</div></div>';
}
function pInfo(rows) {
  return '<div class="p-box"><div class="p-kv">'
    + rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '')
      .map((r) => '<span>' + esc(r[0]) + '</span><div>' + esc(r[1]) + '</div>').join('')
    + '</div></div>';
}
/** ตารางรายการ — เติมบรรทัดว่างให้ครบ แบบฟอร์มจะได้หน้าตาเหมือนกันทุกใบ */
function pTable(cols, rows, minRows) {
  let h = '<table><thead><tr>' + cols.map((c) => '<th' + (c.w ? ' style="width:' + c.w + '"' : '') + '>'
    + esc(c.t) + '</th>').join('') + '</tr></thead><tbody>';
  rows.forEach(function (r) {
    h += '<tr>' + r.map((v, i) => (cols[i].n ? '<td class="num">' + (v === '' ? '' : esc(v)) + '</td>'
      : '<td' + (cols[i].c ? ' style="text-align:center"' : '') + '>' + esc(v) + '</td>')).join('') + '</tr>';
  });
  for (let i = rows.length; i < (minRows || 0); i++) h += '<tr>' + cols.map(() => '<td>&nbsp;</td>').join('') + '</tr>';
  return h + '</tbody></table>';
}
function pTotals(amountForWords, sums) {
  return '<div class="p-tot"><div class="p-words">(' + esc(bahtText(amountForWords)) + ')</div><div class="p-sum">'
    + sums.map((s) => '<div' + (s[2] ? ' class="g"' : '') + '><span>' + esc(s[0]) + '</span><span>' + esc(s[1]) + '</span></div>').join('')
    + '</div></div>';
}
function pSign(list) {
  return '<div class="p-sign" style="--n:' + list.length + '">' + list.map((x) =>
    '<div>' + esc(x) + '<small>วันที่ ______/______/________</small></div>').join('') + '</div>';
}
function pSheet(inner, no, watermark) {
  return '<div class="sheet">' + (watermark ? '<div class="wm"><span>' + esc(watermark) + '</span></div>' : '')
    + inner + '<div class="p-foot"><span>' + esc(no) + '</span><span>ออกจากระบบบัญชี Financii · พิมพ์เมื่อ '
    + thDate(TODAY) + '</span></div></div>';
}
const lineRows = (lines) => lines.map((l, i) => [String(i + 1), l.desc, String(l.qty), l.uom || '', pm(l.price), pm(l.amount)]);
const LINE_COLS = [{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวน', w:'18mm', n:1 }, { t:'หน่วย', w:'16mm', c:1 },
  { t:'ราคาต่อหน่วย', w:'28mm', n:1 }, { t:'จำนวนเงิน', w:'30mm', n:1 }];

/** แยกยอดตามชนิดภาษี — ใบกำกับต้องแสดงมูลค่าที่เสียภาษี อัตรา 0 และยกเว้นแยกกัน */
function vatSplit(lines) {
  const o = { std: 0, zero: 0, exempt: 0 };
  lines.forEach((l) => { o[l.taxCode === 'VAT0' ? 'zero' : l.taxCode === 'EXEMPT' ? 'exempt' : 'std'] += l.amount; });
  return o;
}
function vatSums(d) {
  const v = vatSplit(d.lines || []);
  const out = [['รวมเงิน', pm(d.base)]];
  if (v.zero) out.push(['มูลค่าอัตราร้อยละ 0', pm(v.zero)]);
  if (v.exempt) out.push(['มูลค่าที่ได้รับยกเว้น', pm(v.exempt)]);
  out.push(['มูลค่าที่เสียภาษี', pm(v.std)]);
  out.push(['ภาษีมูลค่าเพิ่ม 7%', pm(d.vat)]);
  out.push(['จำนวนเงินรวมทั้งสิ้น', pm(d.total), true]);
  return out;
}
/** รายการบัญชีของใบสำคัญ — นักบัญชีตรวจได้ทันทีว่าลงบัญชีอะไร */
function pEntry(entryNo) {
  const e = DB.entries.find((x) => x.no === entryNo);
  if (!e) return '';
  return '<div class="p-note"><b>การบันทึกบัญชี</b> · ใบสำคัญ ' + esc(e.no) + ' (' + esc(JOURNAL_BOOKS[journalOf(e)].label) + ')</div>'
    + pTable([{ t:'รหัสบัญชี', w:'24mm', c:1 }, { t:'ชื่อบัญชี' }, { t:'เดบิต', w:'32mm', n:1 }, { t:'เครดิต', w:'32mm', n:1 }],
      e.lines.map((l) => [l.acc, acc(l.acc).name + (l.partner ? ' (' + l.partner + ')' : ''), l.dr ? pm(l.dr) : '', l.cr ? pm(l.cr) : ''])
        .concat([['', 'รวม', pm(e.total), pm(e.total)]]));
}
const partnerOf = (code) => DB.partners.find((p) => p.code === code) || {};

/* ---------- แบบฟอร์มแต่ละชนิด ---------- */
const DOC_PRINT = {
  invoice: {
    title:'ใบกำกับภาษี/ใบส่งของ', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.invoice.find((d) => d.no === no),
    build: function (d, copy) {
      const term = Math.round((new Date(d.due) - new Date(d.date)) / 86400000);
      return pSheet(pHead('ใบกำกับภาษี/ใบส่งของ', 'TAX INVOICE / DELIVERY ORDER', copy)
        + '<div class="p-meta">' + pParty('ลูกค้า', d.snap)
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['เครดิต', term > 0 ? term + ' วัน' : 'เงินสด'], ['ครบกำหนด', thDate(d.due)]]) + '</div>'
        + pTable(LINE_COLS, lineRows(d.lines), 8)
        + pTotals(d.total, vatSums(d))
        + pSign(['ผู้รับสินค้า', 'ผู้ส่งสินค้า', 'ผู้มีอำนาจลงนาม']), d.no, d.status === 'void' ? 'ยกเลิก' : '');
    },
  },
  receipt: {
    title:'ใบเสร็จรับเงิน', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.receipt.find((d) => d.no === no),
    build: function (d, copy) {
      const inv = DB.docs.invoice.find((x) => x.no === d.invoiceNo) || {};
      const how = { cash:'เงินสด', cheque:'เช็ค', transfer:'โอนเงินเข้าบัญชี', promptpay:'พร้อมเพย์' }[d.method] || d.method;
      return pSheet(pHead('ใบเสร็จรับเงิน', 'RECEIPT', copy)
        + '<div class="p-meta">' + pParty('ได้รับเงินจาก', inv.snap || { name: d.partnerName })
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ชำระโดย', how], ['ใบวางบิล', d.billingNoteNo || '']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }],
          [['1', 'ชำระหนี้ตามใบกำกับภาษีเลขที่ ' + d.invoiceNo + (inv.date ? ' ลงวันที่ ' + thDate(inv.date) : ''), pm(d.gross)]], 6)
        + pTotals(d.gross, [['จำนวนเงินที่ชำระ', pm(d.gross)],
          ['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)], ['รับสุทธิ', pm(d.net), true]])
        + '<div class="p-note">ใบเสร็จนี้จะสมบูรณ์เมื่อบริษัทได้รับเงินครบถ้วนแล้ว · กรณีชำระด้วยเช็ค ถือว่าชำระเมื่อเช็คผ่านบัญชีแล้ว</div>'
        + pSign(['ผู้รับเงิน', 'ผู้มีอำนาจลงนาม']), d.no);
    },
  },
  billingNote: {
    title:'ใบวางบิล', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.billingNote.find((d) => d.no === no),
    build: function (d, copy) {
      return pSheet(pHead('ใบวางบิล', 'BILLING NOTE', copy)
        + '<div class="p-meta">' + pParty('ลูกค้า', d.snap)
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['นัดชำระ', thDate(d.dueDate)]]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'เลขที่ใบกำกับภาษี' }, { t:'ลงวันที่', w:'30mm', c:1 },
          { t:'ครบกำหนด', w:'30mm', c:1 }, { t:'จำนวนเงิน', w:'34mm', n:1 }],
          d.invoices.map((r, i) => [String(i + 1), r.no, thDate(r.date), thDate(r.due), pm(r.amount)]), 8)
        + pTotals(d.total, [['รวม ' + d.invoices.length + ' ใบ', pm(d.total), true]])
        + (d.note ? '<div class="p-note">หมายเหตุ: ' + esc(d.note) + '</div>' : '')
        + pSign(['ผู้วางบิล', 'ผู้รับวางบิล']), d.no, d.status === 'cancelled' ? 'ยกเลิก' : '');
    },
  },
  creditNote: { title:'ใบลดหนี้', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.creditNote.find((d) => d.no === no), build: (d, c) => adjustNote(d, c, 'creditNote') },
  debitNote: { title:'ใบเพิ่มหนี้', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.debitNote.find((d) => d.no === no), build: (d, c) => adjustNote(d, c, 'debitNote') },
  quotation: { title:'ใบเสนอราคา', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.quotation.find((d) => d.no === no), build: (d, c) => tradePrint(d, c, 'quotation') },
  salesOrder: { title:'ใบสั่งขาย', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.salesOrder.find((d) => d.no === no), build: (d, c) => tradePrint(d, c, 'salesOrder') },
  purchaseOrder: { title:'ใบสั่งซื้อ', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.purchaseOrder.find((d) => d.no === no), build: (d, c) => tradePrint(d, c, 'purchaseOrder') },
  goodsReceipt: {
    title:'ใบรับสินค้า',
    find: (no) => DB.docs.goodsReceipt.find((d) => d.no === no),
    build: function (d) {
      return pSheet(pHead('ใบรับสินค้า', 'GOODS RECEIPT NOTE')
        + '<div class="p-meta">' + pParty('ผู้ขาย', partnerOf(d.partnerCode))
        + pInfo([['เลขที่', d.no], ['วันที่รับ', thDate(d.date)], ['ใบส่งของ', d.vendorDoNo || ''], ['ใบสั่งซื้อ', d.poNo || ''],
          ['ตั้งหนี้', d.billNo || 'รอใบกำกับจากผู้ขาย']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รหัส', w:'22mm', c:1 }, { t:'รายการ' }, { t:'จำนวน', w:'18mm', n:1 },
          { t:'หน่วย', w:'16mm', c:1 }, { t:'ต้นทุนต่อหน่วย', w:'28mm', n:1 }, { t:'มูลค่า', w:'30mm', n:1 }],
          d.lines.map((l, i) => [String(i + 1), l.itemCode, l.desc, String(l.qty), l.uom || '', pm(l.price), pm(l.amount)]), 8)
        + pTotals(d.total, [['มูลค่ารับเข้าคลัง (ก่อนภาษี)', pm(d.total), true]])
        + pEntry(d.entryNo)
        + pSign(['ผู้ส่งสินค้า', 'ผู้ตรวจรับสินค้า', 'ผู้บันทึกบัญชี']), d.no);
    },
  },
  payment: {
    title:'ใบสำคัญจ่าย',
    find: (no) => DB.docs.payment.find((d) => d.no === no),
    build: function (d) {
      const b = DB.docs.bill.find((x) => x.no === d.billNo) || {};
      return pSheet(pHead('ใบสำคัญจ่าย', 'PAYMENT VOUCHER')
        + '<div class="p-meta">' + pParty('จ่ายให้', partnerOf(d.partnerCode))
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['อ้างตั้งหนี้', d.billNo], ['ใบเตรียมจ่าย', d.batchNo || ''],
          ['นำส่งภาษี', d.channel === 'e_wht' ? 'e-Withholding Tax' : 'หักและนำส่งเอง']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }],
          [['1', 'ชำระหนี้ตามใบกำกับภาษีเลขที่ ' + (b.vendorNo || '') + (b.date ? ' ลงวันที่ ' + thDate(b.date) : ''), pm(d.gross)]], 4)
        + pTotals(d.net, [['ยอดจ่ายก่อนหักภาษี', pm(d.gross)],
          ['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)], ['จ่ายสุทธิ', pm(d.net), true]])
        + (d.certNo ? '<div class="p-note">ออกหนังสือรับรองการหักภาษี ณ ที่จ่ายเลขที่ ' + esc(d.certNo) + '</div>' : '')
        + pEntry(d.entryNo)
        + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ', 'ผู้รับเงิน']), d.no);
    },
  },
  expense: {
    title:'ใบสำคัญจ่าย (ค่าใช้จ่าย)',
    find: (no) => DB.docs.expense.find((d) => d.no === no),
    build: function (d) {
      return pSheet(pHead('ใบสำคัญจ่าย', 'PAYMENT VOUCHER — EXPENSE')
        + '<div class="p-meta">' + pParty('จ่ายให้', partnerOf(d.partnerCode))
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ใบกำกับผู้ขาย', d.taxInvoiceNo || 'ไม่มี'],
          ['จ่ายจาก', acc(d.payFrom).name], ['50 ทวิ', d.certNo || '']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'บันทึกเข้าบัญชี', w:'52mm' }, { t:'จำนวนเงิน', w:'30mm', n:1 }],
          d.lines.map((l, i) => [String(i + 1), l.desc, l.acc + ' ' + l.accName, pm(l.amount)]), 5)
        + pTotals(d.net, [['มูลค่าก่อนภาษี', pm(d.base)], ['ภาษีซื้อ', pm(d.vat)], ['รวมทั้งสิ้น', pm(d.total)],
          ['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)], ['จ่ายสุทธิ', pm(d.net), true]])
        + pEntry(d.entryNo)
        + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ', 'ผู้รับเงิน']), d.no);
    },
  },
  paymentBatch: {
    title:'ใบเตรียมจ่าย',
    find: (no) => DB.docs.paymentBatch.find((d) => d.no === no),
    build: function (d) {
      const st = { pending_approval:'รออนุมัติ', approved:'อนุมัติแล้ว', paid:'จ่ายแล้ว', cancelled:'ยกเลิก' }[d.status];
      return pSheet(pHead('ใบเตรียมจ่าย', 'PAYMENT REQUISITION')
        + '<div class="p-meta">' + pInfo([['เลขที่', d.no], ['วันที่จัดทำ', thDate(d.date)], ['กำหนดจ่าย', thDate(d.payDate)], ['สถานะ', st]])
        + pInfo([['จำนวนราย', d.items.length + ' ราย'], ['หมายเหตุ', d.note || '']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'ตั้งหนี้', w:'27mm' }, { t:'ผู้ขาย' }, { t:'ครบกำหนด', w:'24mm', c:1 },
          { t:'ยอดจ่าย', w:'27mm', n:1 }, { t:'หัก ณ ที่จ่าย', w:'22mm', n:1 }, { t:'จ่ายสุทธิ', w:'27mm', n:1 }],
          d.items.map((i, k) => [String(k + 1), i.billNo, i.partnerName, thDateNum(i.due), pm(i.amount), pm(i.wht), pm(i.net)]), 8)
        + pTotals(d.net, [['ยอดตั้งหนี้ที่จะจ่าย', pm(d.total)], ['หักภาษี ณ ที่จ่าย (ประมาณ)', pm(d.wht)], ['เงินที่ต้องเตรียม', pm(d.net), true]])
        + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติจ่าย']), d.no, d.status === 'cancelled' ? 'ยกเลิก' : '');
    },
  },
  entry: {
    title:'ใบสำคัญ',
    find: (no) => DB.entries.find((e) => e.no === no),
    build: function (e) {
      const t = { general:['ใบสำคัญทั่วไป', 'JOURNAL VOUCHER'], purchase:['ใบสำคัญซื้อ', 'PURCHASE VOUCHER'],
        sales:['ใบสำคัญขาย', 'SALES VOUCHER'], payment:['ใบสำคัญจ่าย', 'PAYMENT VOUCHER'],
        receipt:['ใบสำคัญรับ', 'RECEIPT VOUCHER'] }[journalOf(e)];
      return pSheet(pHead(t[0], t[1])
        + '<div class="p-meta">' + pInfo([['คำอธิบาย', e.desc]])
        + pInfo([['เลขที่', e.no], ['วันที่', thDate(e.date)], ['อ้างอิง', e.srcId || ''],
          ['สถานะ', e.status === 'reversed' ? 'กลับรายการแล้ว (' + e.reversedBy + ')' : 'ลงบัญชีแล้ว']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รหัสบัญชี', w:'24mm', c:1 }, { t:'ชื่อบัญชี' }, { t:'คำอธิบาย', w:'40mm' },
          { t:'เดบิต', w:'29mm', n:1 }, { t:'เครดิต', w:'29mm', n:1 }],
          e.lines.map((l) => [String(l.n), l.acc, acc(l.acc).name + (l.partner ? ' (' + l.partner + ')' : ''), l.memo || '',
            l.dr ? pm(l.dr) : '', l.cr ? pm(l.cr) : '']).concat([['', '', 'รวม', '', pm(e.total), pm(e.total)]]), 6)
        + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ']), e.no, e.status === 'reversed' ? 'กลับรายการ' : '');
    },
  },
  whtCert: {
    title:'หนังสือรับรองการหักภาษี ณ ที่จ่าย',
    copies:['ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)',
            'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)'],
    find: (no) => DB.docs.whtCert.find((d) => d.no === no),
    build: (d, copy) => whtCertPrint(d, copy),
  },
};

function adjustNote(d, copy, kind) {
  const isCN = kind === 'creditNote';
  const inv = DB.docs.invoice.find((x) => x.no === d.invoiceNo) || { lines: [] };
  /* มูลค่าก่อนใบนี้ = ใบกำกับเดิม ปรับด้วยใบลด/เพิ่มหนี้ที่ออกก่อนหน้าใบนี้ */
  const earlier = (list) => list.filter((x) => x.invoiceNo === d.invoiceNo && (x.date < d.date || (x.date === d.date && x.no < d.no)));
  const before = inv.base - earlier(DB.docs.creditNote).reduce((s, x) => s + x.base, 0)
    + earlier(DB.docs.debitNote).reduce((s, x) => s + x.base, 0);
  const correct = isCN ? before - d.base : before + d.base;
  return pSheet(pHead(isCN ? 'ใบลดหนี้' : 'ใบเพิ่มหนี้', isCN ? 'CREDIT NOTE' : 'DEBIT NOTE', copy)
    + '<div class="p-meta">' + pParty('ลูกค้า', inv.snap || { name: d.partnerName })
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['อ้างใบกำกับภาษี', d.invoiceNo],
      ['ลงวันที่', inv.date ? thDate(inv.date) : '']]) + '</div>'
    + '<div class="p-note" style="margin:0 0 8px"><b>เหตุที่ออก' + (isCN ? 'ใบลดหนี้ (ม.86/10)' : 'ใบเพิ่มหนี้ (ม.86/9)') + ':</b> '
    + esc(d.reasonText) + '</div>'
    + pTable([{ t:'รายการ' }, { t:'มูลค่าตามใบกำกับเดิม', w:'38mm', n:1 }, { t:'มูลค่าที่ถูกต้อง', w:'34mm', n:1 }, { t:'ผลต่าง', w:'30mm', n:1 }],
      [[(isCN ? 'ลดหนี้' : 'เพิ่มหนี้') + 'ตามใบกำกับภาษีเลขที่ ' + d.invoiceNo, pm(before), pm(correct), pm(d.base)]], 4)
    + pTotals(d.total, [['มูลค่าผลต่าง', pm(d.base)], ['ภาษีมูลค่าเพิ่ม 7%', pm(d.vat)], ['รวมทั้งสิ้น', pm(d.total), true]])
    + pSign(['ผู้รับเอกสาร', 'ผู้มีอำนาจลงนาม']), d.no);
}

function tradePrint(d, copy, kind) {
  const T = { quotation:['ใบเสนอราคา', 'QUOTATION', 'ลูกค้า', ['ผู้เสนอราคา', 'ผู้อนุมัติสั่งซื้อ (ลูกค้า)']],
    salesOrder:['ใบสั่งขาย', 'SALES ORDER', 'ลูกค้า', ['ผู้รับคำสั่งซื้อ', 'ผู้อนุมัติ']],
    purchaseOrder:['ใบสั่งซื้อ', 'PURCHASE ORDER', 'ผู้ขาย', ['ผู้สั่งซื้อ', 'ผู้อนุมัติ', 'ผู้ขายยืนยัน']] }[kind];
  const st = tradeDocStatus(kind, d);
  return pSheet(pHead(T[0], T[1], copy)
    + '<div class="p-meta">' + pParty(T[2], d.snap)
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ยืนราคาถึง', d.validUntil ? thDate(d.validUntil) : ''],
      ['อ้างอิง', d.fromDoc || '']]) + '</div>'
    + pTable(LINE_COLS, lineRows(d.lines), 8)
    + pTotals(d.total, vatSums(d))
    + (d.note ? '<div class="p-note">เงื่อนไข: ' + esc(d.note) + '</div>' : '')
    + pSign(T[3]), d.no, st === 'cancelled' || st === 'rejected' ? 'ยกเลิก' : '');
}

/* 50 ทวิ — โครงตามแบบราชการ (docs/11 ข้อ 5) */
function whtCertPrint(c, copy) {
  const co = DB.company;
  const p = partnerOf(c.partnerCode);
  const sameForm = DB.docs.whtCert.filter((x) => x.form === c.form && periodOf(x.date) === periodOf(c.date))
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1));
  const seq = sameForm.findIndex((x) => x.no === c.no) + 1;
  const box = (on) => '<span class="chk">' + (on ? '✓' : '&nbsp;') + '</span>';
  const forms = ['ภ.ง.ด.1ก', 'ภ.ง.ด.1ก พิเศษ', 'ภ.ง.ด.2', 'ภ.ง.ด.3', 'ภ.ง.ด.2ก', 'ภ.ง.ด.3ก', 'ภ.ง.ด.53'];
  const rows = [
    ['1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)', false],
    ['2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)', false],
    ['3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)', false],
    ['4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก) · (ข) เงินปันผล ฯลฯ ตามมาตรา 40 (4) (ข)', false],
    ['5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส (ท.ป.4/2528) — ' + c.incomeType, true],
    ['6. อื่น ๆ (ระบุ)', false],
  ];
  const [y, m, d] = c.date.split('-').map(Number);
  return pSheet(
    '<div style="display:flex; justify-content:space-between; font-size:11.5pt"><span>' + esc(copy || '') + '</span>'
    + '<span>เล่มที่ ______ เลขที่ ' + esc(c.no) + '</span></div>'
    + '<div style="text-align:center; margin:6px 0 8px"><h1 style="margin:0; font-size:18pt">หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>'
    + '<div>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div></div>'
    + '<div class="p-box" style="margin-bottom:6px"><div class="lb">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>'
    + '<div><b>' + esc(co.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร ' + esc(co.taxId || '—') + '</div>'
    + '<div>ที่อยู่ ' + esc(co.address || '') + '</div></div>'
    + '<div class="p-box" style="margin-bottom:6px"><div class="lb">ผู้ถูกหักภาษี ณ ที่จ่าย</div>'
    + '<div><b>' + esc(c.partnerName) + '</b> · เลขประจำตัวผู้เสียภาษีอากร ' + esc(c.taxId || '—') + '</div>'
    + '<div>ที่อยู่ ' + esc(p.address || '') + '</div>'
    + '<div style="margin-top:4px">ลำดับที่ <b>' + (seq || '—') + '</b> ในแบบ &nbsp; '
    + forms.map((f) => box(f === c.form) + esc(f)).join(' &nbsp; ') + '</div></div>'
    + '<table class="w50"><thead><tr><th>ประเภทเงินได้พึงประเมินที่จ่าย</th><th style="width:30mm">วัน เดือน หรือปีภาษี ที่จ่าย</th>'
    + '<th style="width:32mm">จำนวนเงินที่จ่าย</th><th style="width:30mm">ภาษีที่หักและนำส่งไว้</th></tr></thead><tbody>'
    + rows.map((r) => '<tr><td>' + esc(r[0]) + '</td><td style="text-align:center">' + (r[1] ? thDateNum(c.date) : '')
      + '</td><td class="num">' + (r[1] ? pm(c.base) : '') + '</td><td class="num">' + (r[1] ? pm(c.wht) : '') + '</td></tr>').join('')
    + '<tr class="sec"><td colspan="2" style="text-align:right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td class="num">' + pm(c.base)
    + '</td><td class="num">' + pm(c.wht) + '</td></tr></tbody></table>'
    + '<div class="p-box" style="margin-top:-1px"><b>รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)</b> &nbsp; ' + esc(bahtText(c.wht)) + '</div>'
    + '<div class="p-box" style="margin-top:6px">เงินที่จ่ายเข้า &nbsp; ' + box(false) + 'กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ______ บาท &nbsp; '
    + box(false) + 'กองทุนประกันสังคม ______ บาท &nbsp; ' + box(false) + 'กองทุนสำรองเลี้ยงชีพ ______ บาท</div>'
    + '<div class="p-box" style="margin-top:6px">ผู้จ่ายเงิน &nbsp; ' + box(true) + '(1) หัก ณ ที่จ่าย &nbsp; ' + box(false) + '(2) ออกให้ตลอดไป &nbsp; '
    + box(false) + '(3) ออกให้ครั้งเดียว &nbsp; ' + box(false) + '(4) อื่น ๆ</div>'
    + '<div style="display:grid; grid-template-columns:1fr 70mm; gap:10px; margin-top:10px">'
    + '<div class="p-box" style="font-size:10.5pt"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ '
    + 'แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>'
    + '<div style="text-align:center">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ'
    + '<div style="margin-top:14mm; border-top:1px dotted #111; padding-top:4px">ลงชื่อ ผู้จ่ายเงิน</div>'
    + '<div>วันที่ ' + d + ' เดือน ' + TH_MF[m - 1] + ' พ.ศ. ' + (y + 543) + '</div>'
    + '<div style="font-size:10.5pt; margin-top:4px">(ประทับตรานิติบุคคล ถ้ามี)</div></div></div>'
    + (c.expenseNo || c.paymentNo ? '<div class="p-note" style="font-size:10.5pt">อ้างอิงรายการจ่ายเงิน ' + esc(c.expenseNo || c.paymentNo) + '</div>' : ''),
    c.no);
}

/* ---------- ตัวอย่างก่อนพิมพ์ ---------- */
function printDoc(kind, no) {
  const def = DOC_PRINT[kind];
  if (!def || !def.find(no)) { toast('ไม่พบเอกสาร ' + no, 'err'); return; }
  PRINT.kind = kind; PRINT.no = no; PRINT.copies = 'all';
  renderPrint();
}
function renderPrint() {
  const def = DOC_PRINT[PRINT.kind];
  const d = def.find(PRINT.no);
  const el = document.getElementById('printArea');
  const copies = def.copies
    ? (PRINT.copies === 'all' ? def.copies : [def.copies[Number(PRINT.copies)]])
    : [null];
  const pages = copies.map((c) => def.build(d, c)).join('');
  el.innerHTML = '<div class="pr-bar"><b>' + esc(def.title) + ' ' + esc(PRINT.no) + '</b>'
    + '<span class="dim">ตัวอย่างก่อนพิมพ์ · กระดาษ A4 · ' + copies.length + ' หน้า</span><span class="grow"></span>'
    + (def.copies ? '<select id="prCopies" aria-label="ฉบับที่จะพิมพ์">'
        + '<option value="all"' + (PRINT.copies === 'all' ? ' selected' : '') + '>พิมพ์ทุกฉบับ (' + def.copies.length + ' หน้า)</option>'
        + def.copies.map((c, i) => '<option value="' + i + '"' + (PRINT.copies === String(i) ? ' selected' : '') + '>'
          + esc(c.replace(/\s*\(.*\)$/, '')) + ' อย่างเดียว</option>').join('') + '</select>' : '')
    + btn('printgo', 'พิมพ์ / บันทึกเป็น PDF', 'primary') + btn('printclose', 'ปิด') + '</div>'
    + '<div class="pr-pages">' + pages + '</div>';
  el.classList.add('show');
}
function closePrint() {
  const el = document.getElementById('printArea');
  if (!el.classList.contains('show')) return false;
  el.classList.remove('show');
  el.innerHTML = '';
  return true;
}
function printNow() {
  document.body.classList.add('printing');
  window.print();
}
