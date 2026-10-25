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
  /* ผู้ซื้อบุคคลธรรมดาที่ไม่ได้จด VAT และไม่มีเลข — ไม่พิมพ์บรรทัดเลขผู้เสียภาษีเปล่า ๆ ให้ดูเหมือนกรอกไม่ครบ */
  const bare = p.entityType === 'individual' && !p.taxId && !p.branch;
  return '<div class="p-box"><div class="lb">' + esc(label) + '</div>'
    + '<div><b>' + esc(p.name || '—') + '</b></div>'
    + (p.address ? '<div>' + esc(p.address) + '</div>' : '')
    + (bare ? '' : '<div>เลขประจำตัวผู้เสียภาษี ' + esc(p.taxId || '—')
      + (p.entityType === 'individual' && !p.branch ? '' : ' · ' + esc(branchLabel(p.branch))) + '</div>')
    + '</div>';
}
function pInfo(rows) {
  return '<div class="p-box"><div class="p-kv">'
    + rows.filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '')
      .map((r) => '<span>' + esc(r[0]) + '</span><div>' + esc(r[1]) + '</div>').join('')
    + '</div></div>';
}
/** ตารางรายการ — เติมบรรทัดว่างให้ครบ แบบฟอร์มจะได้หน้าตาเหมือนกันทุกใบ
    opt.paged = ตารางหลักของเอกสาร แบ่งหน้าได้เมื่อยาวเกินหนึ่งแผ่น (คอลัมน์ที่มี sum จะยกยอดไปหน้าถัดไป)
    opt.total = บรรทัดรวมท้ายตาราง อยู่หน้าสุดท้ายเสมอ */
function pTable(cols, rows, minRows, opt) {
  const o = opt || {};
  let h = '<table' + (o.paged ? ' class="p-items"' : '') + '><thead><tr>' + cols.map((c) => '<th'
    + (c.w ? ' style="width:' + c.w + '"' : '') + (c.sum ? ' data-sum="1"' : '') + '>'
    + esc(c.t) + '</th>').join('') + '</tr></thead><tbody>';
  const tr = (r, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + r.map((v, i) => (cols[i].n
    ? '<td class="num">' + (v === '' ? '' : esc(v)) + '</td>'
    : '<td' + (cols[i].c ? ' style="text-align:center"' : '') + '>' + esc(v) + '</td>')).join('') + '</tr>';
  rows.forEach((r) => { h += tr(r); });
  for (let i = rows.length; i < (minRows || 0); i++) h += '<tr class="p-fill">' + cols.map(() => '<td>&nbsp;</td>').join('') + '</tr>';
  if (o.total) h += tr(o.total, 'p-totrow');
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
  { t:'ราคาต่อหน่วย', w:'28mm', n:1 }, { t:'จำนวนเงิน', w:'30mm', n:1, sum:1 }];
const PAGED = { paged: true };

/** แยกยอดตามชนิดภาษี — ใบกำกับต้องแสดงมูลค่าที่เสียภาษี อัตรา 0 และยกเว้นแยกกัน */
function vatSplit(lines) {
  const o = { std: 0, zero: 0, exempt: 0 };
  lines.forEach((l) => { o[l.taxCode === 'VAT0' ? 'zero' : l.taxCode === 'EXEMPT' ? 'exempt' : 'std'] += l.amount; });
  return o;
}
/* ภาษีหัก ณ ที่จ่ายที่ระบุบนเอกสาร — ต่อท้ายยอดรวม ให้อีกฝ่ายรู้ยอดที่ต้องโอนจริง */
function whtSums(d, side) {
  if (!d.whtCode) return [];
  return [['หักภาษี ณ ที่จ่าย ' + d.whtRate + '%', pm(d.wht)],
    [side === 'vendor' ? 'ยอดจ่ายสุทธิ' : 'ยอดชำระสุทธิ', pm(d.payNet), true]];
}
/** หมายเหตุใต้ยอดรวม — ฐานภาษีหัก ณ ที่จ่ายเมื่อไม่เท่ามูลค่าทั้งใบ (มีค่าสินค้าปน) หรือยอดต่ำกว่าเกณฑ์ */
function whtNote(d) {
  if (!d.whtCode) return '';
  if (d.whtUnder) return '<div class="p-note">มูลค่าต่ำกว่า 1,000 บาท ไม่ต้องหักภาษี ณ ที่จ่าย</div>';
  return d.whtBase !== d.base ? '<div class="p-note">หักภาษี ณ ที่จ่าย ' + esc(d.whtRate) + '% จากค่าบริการ ' + pm(d.whtBase)
    + ' บาท (ไม่รวมค่าสินค้า)</div>' : '';
}
function vatSums(d) {
  const v = vatSplit(d.lines || []);
  /* หักเงินมัดจำ: แสดงรวมรายการ หักมัดจำ แล้วภาษีเฉพาะส่วนที่เหลือ — ภาษีของมัดจำออกใบกำกับไปแล้วตอนรับเงิน */
  const dep = d.depositBase || 0;
  (d.deposits || []).forEach((r) => { v[r.taxCode === 'VAT0' ? 'zero' : r.taxCode === 'EXEMPT' ? 'exempt' : 'std'] -= r.base; });
  const out = [['รวมเงิน', pm(d.base + dep)]];
  if (dep) {
    out.push(['หัก เงินมัดจำ ' + d.deposits.map((r) => r.no).join(', '), pm(dep)]);
    out.push(['มูลค่าหลังหักเงินมัดจำ', pm(d.base)]);
  }
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

/* ---------- เอกสารขายแบบเอกสารธุรกิจ — ตารางรายการ ยอดท้ายเอกสาร เงื่อนไขชำระ หมายเหตุ ----------
   ใช้ร่วมกันทุกใบขาย (ใบเสนอราคา ใบสั่งขาย ใบวางบิล/ใบแจ้งหนี้ ใบกำกับ ขายเงินสด)
   ข้อมูลลูกค้าตามที่บันทึกบนเอกสาร (สาขา/ที่อยู่ที่แก้บนใบ) · โน้ตภายในไม่พิมพ์เด็ดขาด */
/** ลูกค้าบนเอกสาร + ผู้ติดต่อและเบอร์โทร (ถ้ามี) */
function pPartyBiz(label, p) {
  const s = p || {};
  const who = [s.contactPerson ? 'ผู้ติดต่อ ' + s.contactPerson : '', s.phone ? 'โทร ' + s.phone : ''].filter(Boolean).join(' · ');
  return pParty(label, s).replace(/<\/div>$/, (who ? '<div>' + esc(who) + '</div>' : '') + '</div>');
}
/** ช่องข้อมูลเอกสาร: เลขที่ วันที่ [เพิ่ม] เงื่อนไขชำระ ครบกำหนด (ไม่พิมพ์เมื่อเงินสด/เครดิตไม่แสดงวัน) อ้างอิง โปรเจกต์ พนักงานขาย */
function bizInfoRows(d, extra) {
  return [['เลขที่', d.no], ['วันที่', thDate(d.date)]].concat(extra || [])
    .concat([['เงื่อนไขชำระ', creditTermText(d, true)], showDue(d) ? ['ครบกำหนด', thDate(d.due)] : null,
      ['อ้างอิง', d.reference || ''], ['โปรเจกต์', d.project || ''], ['พนักงานขาย', d.salesName || '']]);
}
/** ตารางรายการ — หน่วยทุกใบ · คอลัมน์ส่วนลดเฉพาะเมื่อมีบรรทัดที่มีส่วนลด · จำนวนเงิน = หลังหักส่วนลดรายการ ตามแบบราคาของใบ */
function pBizLines(d, minRows) {
  const disc = (d.lines || []).some((l) => lineDiscText(l.disc));
  const pctUnit = !d.pricing || d.pricing.lineDisc !== 'amount';
  const incl = docTotalsOf(d).incl;
  const mark = (l) => (d.nonVat ? '' : l.taxCode === 'EXEMPT' ? ' (ยกเว้นภาษี)' : l.taxCode === 'VAT0' ? ' (อัตรา 0%)' : '');
  const cols = [{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวน', w:'16mm', n:1 }, { t:'หน่วย', w:'15mm', c:1 },
    { t:'ราคาต่อหน่วย', w:'25mm', n:1 }].concat(disc ? [{ t: pctUnit ? 'ส่วนลด (%)' : 'ส่วนลด', w:'19mm', n:1 }] : [])
    .concat([{ t:'จำนวนเงิน', w:'28mm', n:1, sum:1 }]);
  const rows = (d.lines || []).map((l, i) => [String(i + 1), l.desc + mark(l), String(l.qty), l.uom || '', pm(l.price)]
    .concat(disc ? [lineDiscText(l.disc) ? (pctUnit ? lineDiscText(l.disc) : pm(M(lineDiscText(l.disc)))) : ''] : [])
    .concat([pm(lineShownAmount(d, l, incl))]));
  return pTable(cols, rows, minRows === undefined ? bizFillRows(d) : minRows, PAGED);
}
/** บรรทัดว่างเติมตารางให้เต็มหน้า — ยอดท้ายเอกสารหรือหมายเหตุยาวขึ้น เติมน้อยลง ใบสั้น ๆ จะได้จบในหน้าเดียว
    (แบบเดิมออกแบบไว้ที่ยอดรวม 4 บรรทัด) */
function bizFillRows(d) {
  const sums = docTotalsRows(d).length + whtSums(d).length;
  const note = String(d.note || '');
  const notes = (note ? 1 + Math.floor(note.length / 80) + (note.match(/\n/g) || []).length : 0)
    + (docTotalsOf(d).incl ? 1 : 0) + (whtNote(d) ? 1 : 0) + (liveReceipts(d).length ? 1 : 0);
  return Math.max(0, 7 - Math.max(0, sums - 4) - notes);
}
/** ยอดท้ายเอกสารเต็มรูป + หัก ณ ที่จ่ายและยอดชำระ — กิจการที่ไม่ได้จด VAT ไม่พิมพ์บรรทัดภาษี */
function pBizSums(d, side) {
  return docTotalsRows(d).filter((r) => !d.nonVat || r[2] || !/ภาษี|ยกเว้น/.test(r[0]))
    .map((r) => [r[0], pm(r[1]), r[2]]).concat(whtSums(d, side));
}
/** ใบเสร็จที่ออกพร้อมใบกำกับ (ออกใบกำกับพร้อมรับเงิน) ที่ยังไม่ถูกยกเลิก */
const liveReceipts = (d) => (d.paidAtIssue ? (d.receiptNos || []).filter((n) => liveDoc(DB.docs.receipt.find((r) => r.no === n))) : []);
/** หมายเหตุที่พิมพ์ (ไม่ใช่โน้ตภายใน) และบอกให้ชัดเมื่อราคารวมภาษีแล้ว */
function pBizNote(d) {
  return (docTotalsOf(d).incl && !d.nonVat ? '<div class="p-note">ราคาสินค้าและค่าบริการข้างต้นรวมภาษีมูลค่าเพิ่มแล้ว</div>' : '')
    + (d.note ? '<div class="p-note p-memo"><b>หมายเหตุ:</b> ' + esc(d.note) + '</div>' : '');
}

/* ---------- แบบฟอร์มแต่ละชนิด ---------- */
const DOC_PRINT = {
  invoice: {
    title:'ใบกำกับภาษี/ใบส่งของ', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.invoice.find((d) => d.no === no),
    build: function (d, copy) {
      /* กิจการที่ไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม ออกใบกำกับภาษีไม่ได้ — พิมพ์เป็นใบแจ้งหนี้ */
      return pSheet((d.nonVat ? pHead('ใบแจ้งหนี้/ใบส่งของ', 'INVOICE / DELIVERY ORDER', copy)
        : pHead('ใบกำกับภาษี/ใบส่งของ', 'TAX INVOICE / DELIVERY ORDER', copy))
        + '<div class="p-meta">' + pPartyBiz('ลูกค้า', d.snap) + pInfo(bizInfoRows(d)) + '</div>'
        + pBizLines(d)
        + pTotals(d.total, pBizSums(d, 'customer')) + whtNote(d) + pBizNote(d)
        + (liveReceipts(d).length ? '<div class="p-note">รับชำระแล้วตามใบเสร็จเลขที่ ' + esc(liveReceipts(d).join(', ')) + '</div>' : '')
        + pSign(['ผู้รับสินค้า', 'ผู้ส่งสินค้า', 'ผู้มีอำนาจลงนาม']), d.no, d.status === 'void' ? 'ยกเลิก' : '');
    },
  },
  receipt: {
    title:'ใบเสร็จรับเงิน', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.receipt.find((d) => d.no === no),
    build: function (d, copy) {
      const inv = DB.docs.invoice.find((x) => x.no === d.invoiceNo) || {};
      const how = { cash:'เงินสด', cheque:'เช็ค', transfer:'โอนเงินเข้าบัญชี', promptpay:'พร้อมเพย์', card:'บัตรเครดิต', other:'ช่องทางอื่น' }[d.method] || d.method;
      /* รายการที่หักจากเงินที่ได้รับ — ภาษีถูกหัก ค่าธรรมเนียม รายการปรับลด และส่วนต่าง (ขาด = หัก · เกิน = บวก) */
      const less = [['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)]]
        .concat(d.fee ? [['หัก ค่าธรรมเนียมธนาคาร', pm(d.fee)]] : [])
        .concat((d.adjustments || []).map((a) => [(a.amount < 0 ? 'บวก ' : 'หัก ') + a.label, pm(Math.abs(a.amount))]))
        .concat(d.gap ? [[(d.gap > 0 ? 'หัก ' : 'บวก ') + ((RECEIPT_GAP[d.gapType] || {}).label || 'ส่วนต่าง'), pm(Math.abs(d.gap))]] : []);
      const payNote = d.method === 'cheque' && (d.chequeNo || d.chequeBank)
        ? 'ชำระด้วยเช็ค' + (d.chequeBank ? ' ' + d.chequeBank : '') + (d.chequeNo ? ' เลขที่ ' + d.chequeNo : '') + (d.chequeDate ? ' ลงวันที่ ' + thDate(d.chequeDate) : '')
        : d.payerBank ? 'โอนจาก' + d.payerBank : '';
      return pSheet(pHead('ใบเสร็จรับเงิน', 'RECEIPT', copy)
        + '<div class="p-meta">' + pPartyBiz('ได้รับเงินจาก', inv.snap || { name: d.partnerName })
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ชำระโดย', how], ['ใบวางบิล', d.billingNoteNo || ''],
          ['อ้างอิง', inv.reference || ''], ['พนักงานขาย', inv.salesName || '']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }],
          [['1', 'ชำระหนี้ตามใบกำกับภาษีเลขที่ ' + d.invoiceNo + (inv.date ? ' ลงวันที่ ' + thDate(inv.date) : ''), pm(d.gross)]]
            .concat(d.excess ? [['2', 'เงินรับเกินยอดใบกำกับ — เก็บเป็นเครดิตของลูกค้า ใช้หักใบถัดไปหรือขอคืนได้', pm(d.excess)]] : []),
          Math.max(1, 5 - less.length - (payNote ? 1 : 0) - (d.note ? 1 : 0)))
        + pTotals(d.gross + (d.excess || 0), [['จำนวนเงินที่ชำระ', pm(d.gross + (d.excess || 0))]].concat(less, [['รับสุทธิ', pm(d.net), true]]))
        + (payNote ? '<div class="p-note">' + esc(payNote) + '</div>' : '')
        + (d.note ? '<div class="p-note p-memo"><b>หมายเหตุ:</b> ' + esc(d.note) + '</div>' : '')
        + (d.diff ? '<div class="p-note">ส่วนต่าง ' + esc(fmt(d.diff)) + ' บาท ปิดยอดเป็น' + esc((RECEIPT_DIFF[d.diffType] || {}).label || '')
          + ' — ใบกำกับ ' + esc(d.invoiceNo) + ' ชำระครบ</div>' : '')
        + '<div class="p-note">ใบเสร็จนี้จะสมบูรณ์เมื่อบริษัทได้รับเงินครบถ้วนแล้ว · กรณีชำระด้วยเช็ค ถือว่าชำระเมื่อเช็คผ่านบัญชีแล้ว</div>'
        + pSign(['ผู้รับเงิน', 'ผู้มีอำนาจลงนาม']), d.no, isVoid(d) ? 'ยกเลิก' : '');
    },
  },
  billingNote: {
    title:'ใบวางบิล', copies:['ต้นฉบับ', 'สำเนา'],
    find: (no) => DB.docs.billingNote.find((d) => d.no === no),
    build: function (d, copy) {
      /* ใบวางบิล/ใบแจ้งหนี้ที่มีรายการของตัวเอง (ออกก่อนใบกำกับ) — พิมพ์แบบเอกสารขายเต็มรูป */
      if (isItemBilling(d)) {
        return pSheet(pHead('ใบวางบิล/ใบแจ้งหนี้', 'BILLING NOTE / INVOICE', copy)
          + '<div class="p-meta">' + pPartyBiz('ลูกค้า', d.snap) + pInfo(bizInfoRows(d)) + '</div>'
          + pBizLines(d)
          + pTotals(d.total, pBizSums(d, 'customer')) + whtNote(d) + pBizNote(d)
          + '<div class="p-note">เอกสารนี้ไม่ใช่ใบกำกับภาษี — ใบกำกับภาษีจะออกให้เมื่อส่งมอบสินค้า/บริการหรือรับชำระเงิน</div>'
          + pSign(['ผู้วางบิล', 'ผู้รับวางบิล']), d.no, d.status === 'cancelled' ? 'ยกเลิก' : '');
      }
      return pSheet(pHead('ใบวางบิล', 'BILLING NOTE', copy)
        + '<div class="p-meta">' + pParty('ลูกค้า', d.snap)
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['นัดชำระ', thDate(d.dueDate)]]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'เลขที่ใบกำกับภาษี' }, { t:'ลงวันที่', w:'30mm', c:1 },
          { t:'ครบกำหนด', w:'30mm', c:1 }, { t:'จำนวนเงิน', w:'34mm', n:1, sum:1 }],
          d.invoices.map((r, i) => [String(i + 1), r.no, thDate(r.date), thDate(r.due), pm(r.amount)]), 8, PAGED)
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
        + '<div class="p-meta">' + pParty('ผู้ขาย', d.snap || partnerOf(d.partnerCode))
        + purInfo(d, [['เลขที่', d.no], ['วันที่รับ', thDate(d.date)], ['ใบส่งของ', d.vendorDoNo || ''], ['ใบสั่งซื้อ', d.poNo || ''],
          ['ตั้งหนี้', d.billNo || 'รอใบกำกับจากผู้ขาย']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รหัส', w:'22mm', c:1 }, { t:'รายการ' }, { t:'จำนวน', w:'18mm', n:1 },
          { t:'หน่วย', w:'16mm', c:1 }, { t:'ต้นทุนต่อหน่วย', w:'28mm', n:1 }, { t:'มูลค่า', w:'30mm', n:1, sum:1 }],
          d.lines.map((l, i) => [String(i + 1), l.itemCode, l.desc, String(l.qty), l.uom || '', unitPm(l.price), pm(l.amount)]), 8, PAGED)
        + pTotals(d.total, [['มูลค่ารับเข้าคลัง (ก่อนภาษี)', pm(d.total), true]])
        + purNotes(d)
        + pEntry(d.entryNo)
        + pSign(['ผู้ส่งสินค้า', 'ผู้ตรวจรับสินค้า', 'ผู้บันทึกบัญชี']), d.no, isVoid(d) ? 'ยกเลิก' : '');
    },
  },
  payment: {
    title:'ใบสำคัญจ่าย',
    find: (no) => DB.docs.payment.find((d) => d.no === no),
    build: function (d) {
      const b = DB.docs.bill.find((x) => x.no === d.billNo) || {};
      const how = (PAYMENT_METHODS[d.method] || 'โอนเงิน') + (d.chequeNo ? ' เลขที่ ' + d.chequeNo : '')
        + (d.chequeDate ? ' ลงวันที่ ' + thDate(d.chequeDate) : '');
      return pSheet(pHead('ใบสำคัญจ่าย', 'PAYMENT VOUCHER')
        + '<div class="p-meta">' + pParty('จ่ายให้', b.snap || partnerOf(d.partnerCode))
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ชำระโดย', how], ['จ่ายจาก', d.bankAccount ? acc(d.bankAccount).name : ''],
          ['อ้างตั้งหนี้', d.billNo], ['ใบเตรียมจ่าย', d.batchNo || ''], ['โปรเจกต์', b.project || ''], ['อ้างอิง', b.reference || ''],
          ['นำส่งภาษี', d.channel === 'e_wht' ? 'e-Withholding Tax' : 'หักและนำส่งเอง']]) + '</div>'
        + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }, { t:'จำนวนเงิน', w:'34mm', n:1 }],
          [['1', (b.vendorNo ? 'ชำระหนี้ตามใบกำกับภาษีเลขที่ ' + b.vendorNo : 'ชำระหนี้ตามรายการตั้งหนี้ ' + d.billNo)
            + (b.vendorDate || b.date ? ' ลงวันที่ ' + thDate(b.vendorDate || b.date) : ''), pm(d.gross)]]
            .concat(d.diff ? [['2', (PAYMENT_DIFF[d.diffType] || {}).label + ' (ปิดยอดคงค้าง)', pm(d.diff)]] : []), 4)
        + pTotals(d.net, [['ยอดชำระก่อนหักภาษี', pm(d.gross)],
          ['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)], ['จ่ายสุทธิ', pm(d.net), true]]
          .concat(d.fee ? [['ค่าธรรมเนียมที่บริษัทจ่ายเพิ่ม', pm(d.fee)]] : []))
        + (d.certNo ? '<div class="p-note">ออกหนังสือรับรองการหักภาษี ณ ที่จ่ายเลขที่ ' + esc(d.certNo) + '</div>' : '')
        + (d.note ? '<div class="p-note">หมายเหตุ: ' + esc(d.note) + '</div>' : '')
        + pEntry(d.entryNo)
        + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ', 'ผู้รับเงิน']), d.no, isVoid(d) ? 'ยกเลิก' : '');
    },
  },
  expense: {
    title:'ใบสำคัญจ่าย (ค่าใช้จ่าย)',
    find: (no) => DB.docs.expense.find((d) => d.no === no),
    build: function (d) {
      const how = (PAYMENT_METHODS[d.method] || 'โอนเงิน') + (d.chequeNo ? ' เลขที่ ' + d.chequeNo : '')
        + (d.chequeDate ? ' ลงวันที่ ' + thDate(d.chequeDate) : '');
      return pSheet(pHead('ใบสำคัญจ่าย', 'PAYMENT VOUCHER — EXPENSE')
        + '<div class="p-meta">' + pPartyPlus('จ่ายให้', d.snap || partnerOf(d.partnerCode),
          ['ชำระโดย ' + how + ' จาก ' + acc(d.payFrom).name, d.certNo ? 'หนังสือรับรองหัก ณ ที่จ่ายเลขที่ ' + d.certNo : ''])
        + purInfo(Object.assign({}, d, { creditType: null }), [['เลขที่', d.no], ['วันที่', thDate(d.date)],
          ['ใบกำกับผู้ขาย', d.taxInvoiceNo ? d.taxInvoiceNo + (d.taxInvoiceDate ? ' (' + thDateNum(d.taxInvoiceDate) + ')' : '') : 'ไม่มี'],
          ['ใบสั่งซื้อ', d.fromDoc || '']]) + '</div>'
        + pTable(purLineCols(d, true), purLineRows(d, (l) => l.acc + ' ' + l.accName), purFill(purSums(d), 2), PAGED)
        + pTotalsEntry(d.net, purSums(d).concat([['หัก ภาษีหัก ณ ที่จ่าย' + (d.whtRate ? ' ' + d.whtRate + '%' : ''), pm(d.wht)],
          ['จ่ายสุทธิ', pm(d.net), true]]), d.entryNo)
        + purNotes(d)
        + pSignTight(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ', 'ผู้รับเงิน']), d.no, isVoid(d) ? 'ยกเลิก' : '');
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
          { t:'ยอดจ่าย', w:'27mm', n:1, sum:1 }, { t:'หัก ณ ที่จ่าย', w:'22mm', n:1, sum:1 }, { t:'จ่ายสุทธิ', w:'27mm', n:1, sum:1 }],
          d.items.map((i, k) => [String(k + 1), i.billNo, i.partnerName, thDateNum(i.due), pm(i.amount), pm(i.wht), pm(i.net)]), 8, PAGED)
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
          { t:'เดบิต', w:'29mm', n:1, sum:1 }, { t:'เครดิต', w:'29mm', n:1, sum:1 }],
          e.lines.map((l) => [String(l.n), l.acc, acc(l.acc).name + (l.partner ? ' (' + l.partner + ')' : ''), l.memo || '',
            l.dr ? pm(l.dr) : '', l.cr ? pm(l.cr) : '']), 6, { paged: true, total: ['', '', 'รวม', '', pm(e.total), pm(e.total)] })
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
    + '<div class="p-meta">' + pPartyBiz('ลูกค้า', inv.snap || { name: d.partnerName })
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['อ้างใบกำกับภาษี', d.invoiceNo],
      ['ลงวันที่', inv.date ? thDate(inv.date) : ''], ['อ้างอิง', inv.reference || ''], ['โปรเจกต์', inv.project || ''],
      ['พนักงานขาย', inv.salesName || '']]) + '</div>'
    + '<div class="p-note" style="margin:0 0 8px"><b>เหตุที่ออก' + (isCN ? 'ใบลดหนี้ (ม.86/10)' : 'ใบเพิ่มหนี้ (ม.86/9)') + ':</b> '
    + esc(d.reasonText) + '</div>'
    + pTable([{ t:'รายการ' }, { t:'มูลค่าตามใบกำกับเดิม', w:'38mm', n:1 }, { t:'มูลค่าที่ถูกต้อง', w:'34mm', n:1 }, { t:'ผลต่าง', w:'30mm', n:1 }],
      [[(isCN ? 'ลดหนี้' : 'เพิ่มหนี้') + 'ตามใบกำกับภาษีเลขที่ ' + d.invoiceNo, pm(before), pm(correct), pm(d.base)]], 4)
    + pTotals(d.total, [['มูลค่าผลต่าง', pm(d.base)], ['ภาษีมูลค่าเพิ่ม 7%', pm(d.vat)], ['รวมทั้งสิ้น', pm(d.total), true]])
    + pSign(['ผู้รับเอกสาร', 'ผู้มีอำนาจลงนาม']), d.no, isVoid(d) ? 'ยกเลิก' : '');
}

/* ใบกำกับภาษีอย่างย่อ (ม.86/6): คำว่า "ใบกำกับภาษีอย่างย่อ" · ชื่อและเลขผู้เสียภาษีของผู้ขาย · เลขที่ · รายการ
   · ราคาที่ระบุชัดว่ารวมภาษีมูลค่าเพิ่มแล้ว · วันที่ — ไม่ต้องมีข้อมูลผู้ซื้อ (พิมพ์ชื่อให้ถ้าลูกค้าขอ) */
DOC_PRINT.cashSale = {
  title:'ใบกำกับภาษีอย่างย่อ', copies:['ต้นฉบับ', 'สำเนา'],
  find: (no) => DB.docs.cashSale.find((d) => d.no === no),
  build: function (d, copy) {
    const how = { cash:'เงินสด', transfer:'โอนเงิน/พร้อมเพย์', card:'บัตรเครดิต/เดบิต', other:'ช่องทางอื่น' }[d.method] || d.method;
    /* ผู้ซื้อที่ระบุไว้ (เช่น แปลงจากใบเสนอราคา) พิมพ์ชื่อ ที่อยู่ และสาขาตามที่บันทึกบนใบ — ลูกค้าทั่วไปพิมพ์ชื่อเท่านั้น */
    const buyer = d.snap ? pPartyBiz('ผู้ซื้อ', Object.assign({}, d.snap, { name: d.buyerName || d.snap.name }))
      : pInfo([['ผู้ซื้อ', d.buyerName || 'ลูกค้าทั่วไป'], ['ชำระโดย', how]]);
    const info = pInfo(bizInfoRows(d).concat(d.snap ? [['ชำระโดย', how]] : []));
    const memo = d.note ? '<div class="p-note p-memo"><b>หมายเหตุ:</b> ' + esc(d.note) + '</div>' : '';
    if (d.nonVat) {
      return pSheet(pHead('ใบเสร็จรับเงิน', 'RECEIPT', copy)
        + '<div class="p-meta">' + buyer + info + '</div>'
        + pBizLines(d)
        + pTotals(d.total, pBizSums(d, 'customer')) + memo
        + pSign(['ผู้รับเงิน']), d.no, isVoid(d) ? 'ยกเลิก' : '');
    }
    return pSheet(pHead('ใบกำกับภาษีอย่างย่อ', 'ABBREVIATED TAX INVOICE', copy)
      + '<div class="p-meta">' + buyer + info + '</div>'
      + pBizLines(d, Math.max(0, bizFillRows(d) - 1))
      + pTotals(d.total, pBizSums(d, 'customer'))
      + '<div class="p-note">ราคาสินค้าและค่าบริการข้างต้น' + (d.vatInclusive ? 'รวม' : 'เมื่อรวม') + 'ภาษีมูลค่าเพิ่มแล้ว'
      + ' · ใบกำกับภาษีอย่างย่อตามมาตรา 86/6 แห่งประมวลรัษฎากร ใช้ขอคืนภาษีซื้อไม่ได้</div>' + memo
      + pSign(['ผู้รับเงิน']), d.no, isVoid(d) ? 'ยกเลิก' : '');
  },
};

/* ใบเสนอราคาและใบสั่งขาย — แบบเอกสารขายเต็มรูป (ใบสั่งซื้อยังใช้ tradePrint) */
function salesTradePrint(d, copy, kind) {
  const T = { quotation:['ใบเสนอราคา', 'QUOTATION', ['ผู้เสนอราคา', 'ผู้อนุมัติสั่งซื้อ (ลูกค้า)']],
    salesOrder:['ใบสั่งขาย', 'SALES ORDER', ['ผู้รับคำสั่งซื้อ', 'ผู้อนุมัติ']] }[kind];
  const st = tradeDocStatus(kind, d);
  return pSheet(pHead(T[0], T[1], copy)
    + '<div class="p-meta">' + pPartyBiz('ลูกค้า', d.snap)
    + pInfo(bizInfoRows(d, d.validUntil ? [['ยืนราคาถึง', thDate(d.validUntil)]] : [])) + '</div>'
    + pBizLines(d)
    + pTotals(d.total, pBizSums(d, 'customer')) + whtNote(d) + pBizNote(d)
    + pSign(T[2]), d.no, st === 'cancelled' || st === 'rejected' ? 'ยกเลิก' : '');
}
DOC_PRINT.quotation.build = (d, c) => salesTradePrint(d, c, 'quotation');
DOC_PRINT.salesOrder.build = (d, c) => salesTradePrint(d, c, 'salesOrder');

function tradePrint(d, copy, kind) {
  const T = { quotation:['ใบเสนอราคา', 'QUOTATION', 'ลูกค้า', ['ผู้เสนอราคา', 'ผู้อนุมัติสั่งซื้อ (ลูกค้า)']],
    salesOrder:['ใบสั่งขาย', 'SALES ORDER', 'ลูกค้า', ['ผู้รับคำสั่งซื้อ', 'ผู้อนุมัติ']],
    purchaseOrder:['ใบสั่งซื้อ', 'PURCHASE ORDER', 'ผู้ขาย', ['ผู้สั่งซื้อ', 'ผู้อนุมัติ', 'ผู้ขายยืนยัน']] }[kind];
  const st = tradeDocStatus(kind, d);
  return pSheet(pHead(T[0], T[1], copy)
    + '<div class="p-meta">' + pParty(T[2], d.snap)
    + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['ยืนราคาถึง', d.validUntil ? thDate(d.validUntil) : ''],
      ['อ้างอิง', d.fromDoc || '']]) + '</div>'
    + pTable(LINE_COLS, lineRows(d.lines), 8, PAGED)
    + pTotals(d.total, vatSums(d).concat(whtSums(d, kind === 'purchaseOrder' ? 'vendor' : 'customer'))) + whtNote(d)
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
    c.no, isVoid(c) ? 'ยกเลิก' : '');
}

/* ---------- เอกสารฝั่งซื้อ: ใบสั่งซื้อ ใบตั้งหนี้ ใบรับสินค้า ค่าใช้จ่าย ใบสำคัญจ่าย ----------
   หน่วยทุกบรรทัด · คอลัมน์ส่วนลดเฉพาะใบที่มีส่วนลด · ยอดท้ายเอกสารเต็ม (รวมเป็นเงิน ส่วนลด หลังหักส่วนลด มูลค่าที่เสียภาษี ภาษี รวม)
   เงื่อนไขชำระ โปรเจกต์ เลขอ้างอิง หมายเหตุ — โน้ตภายในไม่พิมพ์เด็ดขาด */
/** ราคาต่อหน่วย — ต้นทุนที่ได้จากส่วนลด/ถอดภาษีมีทศนิยมได้ 4 ตำแหน่ง แสดงให้ครบ ไม่ปัดจนคูณกลับไม่ตรง */
const unitPm = (v) => (v % 100 ? fmt(v, 4).replace(/0+$/, '') : pm(v));
/** ช่องข้อมูลเอกสารด้านขวา + เงื่อนไขชำระ (เครดิตไม่แสดงวันครบกำหนดไม่พิมพ์วันครบกำหนด) โปรเจกต์ เลขอ้างอิง ผู้จัดทำ */
function purInfo(d, first) {
  const credit = !d.creditType ? '' : d.creditType === 'cash' ? 'เงินสด' : 'เครดิต ' + (d.creditDays || 0) + ' วัน'
    + (d.creditType === 'credit' && d.due ? ' · ครบ ' + thDateNum(d.due) : '');
  return pInfo(first.concat([
    credit ? ['เงื่อนไขชำระ', credit] : null,
    d.project ? ['โปรเจกต์', d.project] : null,
    d.reference ? ['อ้างอิง', d.reference] : null,
    d.salesName ? ['ผู้จัดทำ', d.salesName] : null,
  ]));
}
/** คอลัมน์ตารางรายการ — acc = มีคอลัมน์บัญชี/หมวดค่าใช้จ่าย */
function purLineCols(d, acc) {
  const disc = (d.lines || []).some((l) => lineDiscText(l.disc));
  return [{ t:'ลำดับ', w:'11mm', c:1 }, { t:'รายการ' }].concat(acc ? [{ t:'บันทึกเข้าบัญชี', w:'40mm' }] : [])
    .concat([{ t:'จำนวน', w:'16mm', n:1 }, { t:'หน่วย', w:'14mm', c:1 }, { t:'ราคา/หน่วย', w:'25mm', n:1 }])
    .concat(disc ? [{ t:'ส่วนลด', w:'17mm', n:1 }] : [])
    .concat([{ t:'จำนวนเงิน', w:'27mm', n:1, sum:1 }]);
}
/** บรรทัดรายการ — จำนวนเงินต่อบรรทัด = ราคา × จำนวน − ส่วนลดรายการ ตามแบบราคาของใบ (รวม/ไม่รวมภาษี)
    คิดด้วยสูตรเดียวกับตอนบันทึก (priceLines) · ใบรุ่นก่อนไม่มีตั้งค่าราคา ใช้มูลค่าที่ลงบัญชี */
function purLineRows(d, accOf) {
  const disc = (d.lines || []).some((l) => lineDiscText(l.disc));
  const unit = d.pricing && d.pricing.lineDisc === 'amount' ? '' : '%';
  let rows = null;
  try {
    if (d.pricing) rows = priceLines(d.lines.map((l) => ({ qty: l.qty, price: unM(l.price), disc: l.disc, taxCode: l.taxCode })), d.date, d.pricing).rows;
  } catch (e) { rows = null; }
  return d.lines.map((l, i) => [String(i + 1), l.desc].concat(accOf ? [accOf(l)] : [])
    .concat([String(l.qty), l.uom || '', unitPm(l.price)])
    .concat(disc ? [lineDiscText(l.disc) ? lineDiscText(l.disc) + unit : ''] : [])
    .concat([pm(rows ? rows[i].gross - rows[i].discount : l.amount)]));
}
/** ยอดท้ายเอกสารแบบเต็ม — ใบไม่มีส่วนลดและราคาไม่รวมภาษี ได้หน้าตาเดิม (vatSums) */
function purSums(d) {
  const t = d.totals;
  const incl = d.pricing && d.pricing.mode === 'inclusive';
  if (!t || (!t.discount && !incl)) return vatSums(d);
  const out = [['รวมเป็นเงิน' + (incl ? ' (ราคารวมภาษี)' : ''), pm(t.subTotal)]];
  if (t.discount) {
    const bill = d.pricing.bill;
    out.push(['ส่วนลด' + (bill && bill.kind === 'percent' && !t.lineDiscount ? ' ' + bill.value + '%' : ''), pm(t.discount)]);
    out.push(['ราคาหลังหักส่วนลด', pm(t.afterDiscount)]);
  }
  /* มูลค่าที่เสียภาษี ภาษี และรวมทั้งสิ้น (หลังหักเงินมัดจำ) ตามแบบเดิม */
  return out.concat(vatSums(d).slice(1));
}
/** จำนวนบรรทัดว่างเติมตาราง — ยอดท้ายเอกสารยาว (ส่วนลด หัก ณ ที่จ่าย) เติมน้อยลง ใบสั้นจะได้จบในหน้าเดียว */
const purFill = (sums, base) => Math.max(0, base - Math.max(0, sums.length - 5));
/** ยอดท้ายเอกสารที่มีการบันทึกบัญชีอยู่ข้างกัน (ช่องซ้ายใต้จำนวนเงินตัวอักษร) — ใบสำคัญซื้อ/จ่ายจบในหน้าเดียว
    นักบัญชียังตรวจได้ทันทีว่าลงบัญชีอะไร เหมือน pEntry แต่ไม่กินความสูงเพิ่ม */
function pTotalsEntry(amountForWords, sums, entryNo) {
  const e = DB.entries.find((x) => x.no === entryNo);
  const tb = e ? '<div class="p-je"><b>การบันทึกบัญชี</b> · ใบสำคัญ ' + esc(e.no) + '</div><table class="p-je-t"><thead><tr><th>บัญชี</th><th>เดบิต</th><th>เครดิต</th></tr></thead><tbody>'
    + e.lines.map((l) => '<tr><td>' + esc(l.acc + ' ' + acc(l.acc).name) + '</td><td class="num">' + (l.dr ? pm(l.dr) : '') + '</td><td class="num">'
      + (l.cr ? pm(l.cr) : '') + '</td></tr>').join('') + '</tbody></table>' : '';
  return pTotals(amountForWords, sums).replace('<div class="p-words">(' + esc(bahtText(amountForWords)) + ')</div>',
    '<div class="p-words with-je"><div>(' + esc(bahtText(amountForWords)) + ')</div>' + tb + '</div>');
}
/** ช่องลงนามแบบกระชับ — ใบสำคัญที่มีตารางบันทึกบัญชีด้วย จะได้จบในหน้าเดียว */
const pSignTight = (list) => pSign(list).replace('class="p-sign"', 'class="p-sign tight"');
/** กล่องคู่ค้าพร้อมบรรทัดเพิ่ม (เช่น วิธีจ่าย) — ใช้ที่ว่างของกล่องซ้ายแทนการเพิ่มแถวในกล่องขวา */
const pPartyPlus = (label, p, lines) => pParty(label, p).replace(/<\/div>$/, lines.filter(Boolean).map((x) => '<div>' + esc(x) + '</div>').join('') + '</div>');
/** หมายเหตุที่พิมพ์ — ราคารวมภาษี และหมายเหตุของเอกสาร (โน้ตภายในไม่พิมพ์) */
function purNotes(d) {
  return (d.pricing && d.pricing.mode === 'inclusive' ? '<div class="p-note">ราคาสินค้าและบริการข้างต้นรวมภาษีมูลค่าเพิ่มแล้ว</div>' : '')
    + (d.note ? '<div class="p-note">หมายเหตุ: ' + esc(d.note) + '</div>' : '');
}
DOC_PRINT.purchaseOrder.build = function (d, copy) {
  const st = tradeDocStatus('purchaseOrder', d);
  const sums = purSums(d).concat(whtSums(d, 'vendor'));
  return pSheet(pHead('ใบสั่งซื้อ', 'PURCHASE ORDER', copy)
    + '<div class="p-meta">' + pParty('ผู้ขาย', d.snap)
    + purInfo(d, [['เลขที่', d.no], ['วันที่', thDate(d.date)]]) + '</div>'
    + pTable(purLineCols(d), purLineRows(d), purFill(sums, 7), PAGED)
    + pTotals(d.total, sums) + whtNote(d) + purNotes(d)
    + pSign(['ผู้สั่งซื้อ', 'ผู้อนุมัติ', 'ผู้ขายยืนยัน']), d.no, st === 'cancelled' || st === 'rejected' ? 'ยกเลิก' : '');
};
/* ใบตั้งหนี้ — เอกสารภายในที่แนบใบกำกับของผู้ขาย: ลงบัญชีอะไร เท่าไร ครบกำหนดเมื่อไร */
DOC_PRINT.bill = {
  title:'ใบบันทึกซื้อ / ตั้งหนี้',
  find: (no) => DB.docs.bill.find((d) => d.no === no),
  build: function (d) {
    const accOf = (l) => (l.acc ? l.acc + ' ' + acc(l.acc).name : d.grnNo ? 'พักรับสินค้า' : '');
    return pSheet(pHead('ใบบันทึกซื้อ / ตั้งหนี้', 'PURCHASE RECORD')
      + '<div class="p-meta">' + pParty('ผู้ขาย', d.snap || partnerOf(d.partnerCode))
      + purInfo(d, [['เลขที่', d.no], ['วันที่', thDate(d.date)],
        ['ใบกำกับผู้ขาย', d.vendorNo ? d.vendorNo + (d.vendorDate ? ' (' + thDateNum(d.vendorDate) + ')' : '') : 'ไม่มี'],
        ['ใบรับสินค้า', d.grnNo || ''], ['ใบสั่งซื้อ', d.fromDoc && !d.grnNo ? d.fromDoc : '']]) + '</div>'
      + pTable(purLineCols(d, true), purLineRows(d, accOf), purFill(purSums(d), 2), PAGED)
      + pTotalsEntry(d.total, purSums(d), d.entryNo)
      + (d.claimable ? '' : '<div class="p-note">ภาษีซื้อต้องห้ามตามมาตรา 82/5 — บันทึกเป็นค่าใช้จ่าย ไม่นำไปหักในแบบ ภ.พ.30</div>')
      + purNotes(d)
      + pSignTight(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ']), d.no, isVoid(d) ? 'ยกเลิก' : '');
  },
};

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
  /* เอกสารที่พิมพ์ใช้ปี พ.ศ. เสมอ ไม่ว่าจอจะตั้งเป็น ค.ศ. หรือไม่ */
  YEAR_ERA.lockBE++;
  let pages;
  try { pages = copies.map((c) => def.build(d, c)).join(''); } finally { YEAR_ERA.lockBE--; }
  el.innerHTML = '<div class="pr-bar"><b>' + esc(def.title) + ' ' + esc(PRINT.no) + '</b>'
    + '<span class="dim">ตัวอย่างก่อนพิมพ์ · กระดาษ A4 · ' + copies.length + ' หน้า</span><span class="grow"></span>'
    + (def.copies ? '<select id="prCopies" aria-label="ฉบับที่จะพิมพ์">'
        + '<option value="all"' + (PRINT.copies === 'all' ? ' selected' : '') + '>พิมพ์ทุกฉบับ (' + def.copies.length + ' ฉบับ)</option>'
        + def.copies.map((c, i) => '<option value="' + i + '"' + (PRINT.copies === String(i) ? ' selected' : '') + '>'
          + esc(c.replace(/\s*\(.*\)$/, '')) + ' อย่างเดียว</option>').join('') + '</select>' : '')
    + btn('printgo', 'พิมพ์ / บันทึกเป็น PDF', 'primary') + btn('printclose', 'ปิด') + '</div>'
    + '<div class="pr-pages">' + pages + '</div>';
  el.classList.add('show');
  paginatePrint(el.querySelector('.pr-pages'));
  const n = el.querySelectorAll('.sheet').length;
  el.querySelector('.pr-bar .dim').textContent = 'ตัวอย่างก่อนพิมพ์ · กระดาษ A4 · ' + n + ' หน้า';
  /* ฟอนต์สำหรับพิมพ์โหลดครั้งแรกตอนเปิดตัวอย่าง ถ้าวัดก่อนฟอนต์มา ความสูงบรรทัดจะผิด — วาดใหม่อีกครั้งเมื่อฟอนต์พร้อม */
  if (document.fonts && document.fonts.status !== 'loaded' && !PRINT.fontWait) {
    PRINT.fontWait = true;
    document.fonts.ready.then(function () {
      PRINT.fontWait = false;
      if (el.classList.contains('show') && PRINT.kind) renderPrint();
    });
  }
}

/* ---------- แบ่งหน้า ----------
   วัดความสูงจริงหลังวาด ถ้าเกินหนึ่งแผ่น A4 แยกบรรทัดของตารางหลักไปหน้าถัดไป
   ทุกหน้ามีหัวเอกสารซ้ำ · หน้าที่ต่อมีบรรทัด "ยอดยกมา" · หน้าที่ยังไม่จบมี "ยอดยกไป"
   ยอดรวม ตัวอักษร และช่องลงนามอยู่หน้าสุดท้ายเท่านั้น · ท้ายกระดาษบอก หน้า X/Y */
function outerH(el) {
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
}
function paginatePrint(root) {
  if (!root) return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute; visibility:hidden; height:297mm; width:1px';
  root.appendChild(probe);
  const A4 = probe.getBoundingClientRect().height;
  probe.remove();
  [...root.querySelectorAll('.sheet')].forEach(function (sheet) {
    if (sheet.getBoundingClientRect().height <= A4 + 1) return;
    const kids = [...sheet.children];
    const table = kids.find((k) => k.tagName === 'TABLE' && k.classList.contains('p-items'));
    if (!table) return;
    const wm = kids.find((k) => k.classList.contains('wm'));
    const foot = kids.find((k) => k.classList.contains('p-foot'));
    const ti = kids.indexOf(table);
    const before = kids.slice(0, ti).filter((k) => k !== wm);
    const after = kids.slice(ti + 1).filter((k) => k !== foot);
    const body = table.tBodies[0];
    body.querySelectorAll('tr.p-fill').forEach((r) => r.remove());
    const rows = [...body.rows].filter((r) => !r.classList.contains('p-totrow'));
    const totRows = [...body.rows].filter((r) => r.classList.contains('p-totrow'));
    const ths = [...table.tHead.rows[0].cells];
    const sumIdx = ths.map((th, i) => (th.hasAttribute('data-sum') ? i : -1)).filter((i) => i >= 0);
    let labelIdx = ths.findIndex((th) => !th.style.width);
    if (labelIdx < 0 || sumIdx.indexOf(labelIdx) >= 0) labelIdx = 0;
    const cs = getComputedStyle(sheet);
    const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const hBefore = before.reduce((s, k) => s + outerH(k), 0);
    const hHead = table.tHead.getBoundingClientRect().height;
    const hFoot = foot ? outerH(foot) : 0;
    const hAfter = after.reduce((s, k) => s + outerH(k), 0) + totRows.reduce((s, r) => s + r.getBoundingClientRect().height, 0);
    const rh = rows.map((r) => r.getBoundingClientRect().height);
    const carryH = Math.max(Math.min.apply(null, rh.concat([40])), 20);
    const cap = A4 - pad - hFoot - hBefore - hHead - 8;
    const capOf = (pi) => cap - (pi > 0 ? carryH : 0);
    const pagesIdx = [];
    let cur = [], used = 0;
    rows.forEach(function (r, i) {
      if (cur.length && used + rh[i] > capOf(pagesIdx.length) - carryH) { pagesIdx.push(cur); cur = []; used = 0; }
      cur.push(i); used += rh[i];
    });
    /* หน้าสุดท้ายต้องมีที่ให้ยอดรวมและช่องลงนาม ไม่พอก็ย้ายบรรทัดท้ายไปหน้าใหม่ */
    for (let guard = 0; guard < 60 && cur.length && used + hAfter > capOf(pagesIdx.length); guard++) {
      const spill = [];
      while (cur.length && used + hAfter > capOf(pagesIdx.length)) { const i = cur.pop(); used -= rh[i]; spill.unshift(i); }
      if (cur.length) pagesIdx.push(cur);
      else { pagesIdx.push(spill.splice(0, 1)); }
      cur = spill; used = spill.reduce((s, i) => s + rh[i], 0);
    }
    pagesIdx.push(cur);
    const pagesUse = pagesIdx.filter((p, k) => p.length || k === pagesIdx.length - 1);
    if (pagesUse.length < 2) return;
    const N = pagesUse.length;
    const sums = sumIdx.map(() => 0);
    const carryRow = function (label) {
      const tr = document.createElement('tr');
      tr.className = 'p-carry';
      ths.forEach(function (th, i) {
        const td = document.createElement('td');
        const k = sumIdx.indexOf(i);
        if (k >= 0) { td.className = 'num'; td.textContent = fmt(sums[k]); }
        else if (i === labelIdx) { td.textContent = label; td.style.textAlign = 'right'; }
        tr.appendChild(td);
      });
      return tr;
    };
    const frag = document.createDocumentFragment();
    pagesUse.forEach(function (idxs, p) {
      const last = p === N - 1;
      const sh = sheet.cloneNode(false);
      if (wm) sh.appendChild(wm.cloneNode(true));
      before.forEach((k) => sh.appendChild(last ? k : k.cloneNode(true)));
      const t = table.cloneNode(false);
      t.appendChild(table.tHead.cloneNode(true));
      const tb = document.createElement('tbody');
      if (p > 0) tb.appendChild(carryRow('ยอดยกมา'));
      idxs.forEach(function (i) {
        sumIdx.forEach((c, k) => { sums[k] += M(rows[i].cells[c].textContent || ''); });
        tb.appendChild(rows[i]);
      });
      if (!last) tb.appendChild(carryRow('ยอดยกไป'));
      else totRows.forEach((r) => tb.appendChild(r));
      t.appendChild(tb);
      sh.appendChild(t);
      if (last) after.forEach((k) => sh.appendChild(k));
      if (foot) {
        const f = last ? foot : foot.cloneNode(true);
        f.insertAdjacentHTML('beforeend', '<span class="p-page">หน้า ' + (p + 1) + '/' + N + '</span>');
        sh.appendChild(f);
      }
      frag.appendChild(sh);
    });
    sheet.replaceWith(frag);
  });
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
