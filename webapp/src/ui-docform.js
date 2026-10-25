/* ===================================================================
   หัวเอกสารธุรกิจกลาง — ลำดับช่องแบบที่นักบัญชีคุ้นมือ ใช้กับเอกสารขายและซื้อทุกใบ
   ลูกค้า/ผู้ขาย (เติมที่อยู่ เลขผู้เสียภาษี สาขาให้เอง แก้บนใบนี้ได้) → วันที่ → เงื่อนไขชำระ
   (เงินสด / เครดิต N วัน / เครดิตไม่แสดงวันครบกำหนด) → วันครบกำหนด → โปรเจกต์ พนักงานขาย เลขที่อ้างอิง
   ท้ายฟอร์ม: หมายเหตุ (พิมพ์บนเอกสาร) · โน้ตภายใน (ไม่พิมพ์ เห็นเฉพาะในระบบ)
   ฟอร์มที่ใช้: docHead() + lineEditor() + docNotes() แล้วอ่านค่าด้วย collectDoc()
   =================================================================== */
const CREDIT_OPTS = [['credit', 'เครดิต (ระบุวัน)'], ['cash', 'เงินสด'], ['creditHidden', 'เครดิต (ไม่แสดงวันครบกำหนด)']];
const LS_SALES_NAME = 'financii.salesName';

/** ช่องข้อความหลายบรรทัดในรูปแบบเดียวกับ field() */
const areaField = (o) =>
  '<div class="fld-w' + (o.wide ? ' wide' : '') + '"><label for="f_' + o.name + '">' + esc(o.label) + '</label>'
  + '<textarea id="f_' + o.name + '" name="' + o.name + '" rows="' + (o.rows || 2) + '"'
  + (o.placeholder ? ' placeholder="' + esc(o.placeholder) + '"' : '') + '>' + esc(o.value || '') + '</textarea>'
  + (o.hint ? '<div class="fld-hint">' + esc(o.hint) + '</div>' : '') + '</div>';

/** หัวเอกสาร
    o = { side:'customer'|'vendor', parties, d: เอกสารเดิมหรือเอกสารต้นทาง, partner, date,
          credit: false = ไม่มีเงื่อนไขชำระ (ขายเงินสด ค่าใช้จ่ายที่จ่ายทันที), extra: ช่องเพิ่มต่อจากวันที่, partnerHint } */
function docHead(o) {
  const d = o.d || {};
  const parties = o.parties || [];
  const code = o.partner || d.partnerCode || (parties[0] || [])[0] || '';
  const p = code ? DB.partners.find((x) => x.code === code) : null;
  const date = o.date || d.date || defaultDate();
  const type = d.creditType || 'credit';
  const days = type === 'cash' ? 0 : d.creditDays !== undefined && d.creditDays !== null ? d.creditDays : p ? p.termDays || 0 : 0;
  const due = d.due && d.date === date ? d.due : addDays(date, days);
  const who = o.side === 'vendor' ? 'ผู้ขาย' : 'ลูกค้า';
  return '<div class="flds doc-head">'
    + field({ name:'partner', label: who, type:'select', value: code,
        options: parties.length ? parties : [['', '— ยังไม่มี' + who + 'ในทะเบียน เพิ่มที่เมนูผู้ติดต่อ —']], hint: o.partnerHint })
    + field({ name:'date', label:'วันที่เอกสาร', type:'date', value: date })
    + (o.extra || '')
    + (o.credit === false ? ''
      : field({ name:'creditType', label:'เงื่อนไขชำระ', type:'select', value: type, options: CREDIT_OPTS })
        + '<div class="fld-w credit-pair"' + (type === 'cash' ? ' hidden' : '') + '><label for="f_creditDays">เครดิต (วัน) / วันครบกำหนด</label>'
        + '<span class="pair"><input id="f_creditDays" name="creditDays" type="number" min="0" step="1" inputmode="numeric" value="' + days + '">'
        + '<input id="f_dueDate" name="dueDate" type="date" value="' + due + '" aria-label="วันครบกำหนด"></span>'
        + '<div class="fld-hint">แก้จำนวนวันหรือวันครบกำหนดช่องใดก็ได้ อีกช่องคำนวณให้</div></div>')
    + field({ name:'project', label:'โปรเจกต์', value: d.project || '', placeholder:'ไม่บังคับ' })
    + field({ name:'salesName', label: o.side === 'vendor' ? 'ผู้จัดทำ' : 'พนักงานขาย', value: d.salesName || lsGet(LS_SALES_NAME) || '', placeholder:'ไม่บังคับ' })
    + field({ name:'reference', label:'เลขที่อ้างอิง', value: d.reference || '', placeholder: o.side === 'vendor' ? 'เช่น เลขใบเสนอราคาของผู้ขาย' : 'เช่น เลขใบสั่งซื้อของลูกค้า' })
    + contactBox(p, d.snap && d.snap.edited ? d.snap : null, who)
    + '</div>';
}

/** ข้อมูลคู่ค้าบนเอกสารใบนี้ — ปิดไว้ก่อน เปิดแก้ได้เมื่อออกให้สาขาอื่นหรือที่อยู่ใหม่ (ทะเบียนไม่เปลี่ยน) */
function contactBox(p, snap, who) {
  const s = snap || (p ? snapshotPartner(p) : {});
  const line = p ? [s.name, s.taxId ? 'เลขผู้เสียภาษี ' + s.taxId : '', s.branch ? (s.branch === '00000' ? 'สำนักงานใหญ่' : 'สาขา ' + s.branch) : '']
    .filter(Boolean).join(' · ') : 'ยังไม่ได้เลือก' + who;
  return '<details class="contact-box fld-w wide" id="contactBox"' + (snap ? ' open' : '') + '>'
    + '<summary><span class="cb-l">ข้อมูล' + who + 'บนเอกสาร</span> <span class="cb-v" id="cbLine">' + esc(line) + '</span>'
    + '<span class="cb-edit">แก้บนใบนี้</span></summary><div class="flds">'
    + field({ name:'cName', label:'ชื่อที่พิมพ์บนเอกสาร', value: s.name || '' })
    + field({ name:'cTaxId', label:'เลขประจำตัวผู้เสียภาษี', value: s.taxId || '', cls:'mono' })
    + field({ name:'cBranch', label:'สาขา (00000 = สำนักงานใหญ่)', value: s.branch || '', cls:'mono' })
    + field({ name:'cPerson', label:'ผู้ติดต่อ', value: s.contactPerson || '' })
    + field({ name:'cPhone', label:'โทรศัพท์', value: s.phone || '' })
    + field({ name:'cEmail', label:'อีเมล', value: s.email || '' })
    + areaField({ name:'cAddress', label:'ที่อยู่', value: s.address || '', wide:true })
    + '<div class="fld-hint wide">แก้เฉพาะเอกสารใบนี้ (เช่น ออกให้สาขาอื่น) ทะเบียนผู้ติดต่อไม่เปลี่ยน</div>'
    + '</div></details>';
}
const CONTACT_FIELDS = [['cName', 'name'], ['cTaxId', 'taxId'], ['cBranch', 'branch'], ['cPerson', 'contactPerson'],
  ['cPhone', 'phone'], ['cEmail', 'email'], ['cAddress', 'address']];
/** เติมข้อมูลคู่ค้าจากทะเบียนลงช่องในกล่องข้อมูลบนเอกสาร */
function fillContactBox(code) {
  const p = DB.partners.find((x) => x.code === code);
  const s = p ? snapshotPartner(p) : {};
  CONTACT_FIELDS.forEach(function (f) {
    const e = document.querySelector('#modal [name="' + f[0] + '"]');
    if (e) e.value = s[f[1]] || '';
  });
  const box = document.getElementById('contactBox');
  if (box) box.open = false;
  const l = document.getElementById('cbLine');
  if (l) l.textContent = p ? [s.name, s.taxId ? 'เลขผู้เสียภาษี ' + s.taxId : '', s.branch ? (s.branch === '00000' ? 'สำนักงานใหญ่' : 'สาขา ' + s.branch) : '']
    .filter(Boolean).join(' · ') : '—';
}
/** ส่งเฉพาะช่องที่ต่างจากทะเบียน — ไม่ได้แก้อะไร = undefined (ใบนี้ใช้ข้อมูลตามทะเบียน) */
function collectContact() {
  if (!document.querySelector('#modal [name="cName"]')) return undefined;
  const p = DB.partners.find((x) => x.code === val('partner'));
  const s = p ? snapshotPartner(p) : {};
  const out = {};
  let changed = false;
  CONTACT_FIELDS.forEach(function (f) {
    const v = val(f[0]).trim();
    if (v !== String(s[f[1]] || '').trim()) { out[f[1]] = v; changed = true; }
  });
  return changed ? out : undefined;
}

/** หมายเหตุ (พิมพ์บนเอกสาร) และโน้ตภายใน */
function docNotes(d, ph) {
  const x = d || {};
  return '<div class="flds doc-notes">'
    + areaField({ name:'note', label:'หมายเหตุ (พิมพ์บนเอกสาร)', value: x.note || '', placeholder: ph || 'เงื่อนไขการชำระเงิน กำหนดส่งมอบ ฯลฯ' })
    + areaField({ name:'internalNote', label:'โน้ตภายใน (ไม่พิมพ์)', value: x.internalNote || '', placeholder:'เห็นเฉพาะคนในบริษัท' })
    + '</div>';
}

/** อ่านหัวเอกสาร รายการ และตั้งค่าราคาจากฟอร์มตอนนี้ — ส่งเข้า issueInvoice / issueTradeDoc / recordBill ได้ตรง ๆ */
function collectDoc() {
  const has = (n) => !!document.querySelector('#modal [name="' + n + '"]');
  const out = {
    partnerCode: val('partner') || null, date: val('date'),
    project: val('project'), salesName: val('salesName'), reference: val('reference'),
    note: val('note'), internalNote: val('internalNote'),
    contact: collectContact(), pricing: collectPricing(), lines: collectLines(),
  };
  if (has('creditType')) {
    out.creditType = val('creditType');
    if (out.creditType !== 'cash') { out.creditDays = val('creditDays'); out.dueDate = val('dueDate'); }
  }
  if (out.salesName) lsSet(LS_SALES_NAME, out.salesName);
  return out;
}

/* เปลี่ยนคู่ค้า → เติมข้อมูลบนเอกสารและวันเครดิตตามทะเบียน · เครดิต/ครบกำหนด/วันที่ คำนวณกันและกัน */
function syncDue(from) {
  const daysEl = document.querySelector('#modal [name="creditDays"]');
  const dueEl = document.querySelector('#modal [name="dueDate"]');
  const date = val('date');
  if (!daysEl || !dueEl || !date) return;
  if (from === 'due' && dueEl.value) {
    const n = Math.round((Date.parse(dueEl.value) - Date.parse(date)) / 86400000);
    daysEl.value = n >= 0 ? String(n) : '0';
    if (n < 0) dueEl.value = date;
  } else {
    const n = Math.max(0, Math.floor(Number(daysEl.value) || 0));
    dueEl.value = addDays(date, n);
  }
}
EXTRA_CHANGE.push(function (t) {
  if (!document.querySelector('#modal .doc-head')) return false;
  if (t.name === 'partner') {
    fillContactBox(t.value);
    const p = DB.partners.find((x) => x.code === t.value);
    const daysEl = document.querySelector('#modal [name="creditDays"]');
    if (p && daysEl && val('creditType') !== 'cash') { daysEl.value = String(p.termDays || 0); syncDue('days'); }
    return false;                       // ให้ตัวรับอื่น (หัก ณ ที่จ่าย เงินมัดจำ) ทำงานต่อ
  }
  if (t.name === 'creditType') {
    const pair = document.querySelector('#modal .credit-pair');
    if (pair) pair.hidden = t.value === 'cash';
    return true;
  }
  if (t.name === 'dueDate') { syncDue('due'); return true; }
  if (t.name === 'creditDays') { syncDue('days'); return true; }
  if (t.name === 'date') { syncDue('days'); return false; }
  return false;
});
EXTRA_INPUT.push(function (t) {
  if (t.name === 'creditDays' && document.querySelector('#modal .doc-head')) { syncDue('days'); return true; }
  if (t.name === 'cName' || t.name === 'cTaxId' || t.name === 'cBranch') {
    const l = document.getElementById('cbLine');
    if (l) l.textContent = [val('cName'), val('cTaxId') ? 'เลขผู้เสียภาษี ' + val('cTaxId') : '', val('cBranch')
      ? (val('cBranch') === '00000' ? 'สำนักงานใหญ่' : 'สาขา ' + val('cBranch')) : ''].filter(Boolean).join(' · ') + ' (แก้บนใบนี้)';
    return true;
  }
  return false;
});

/* ===================================================================
   สถานะเอกสารแบบเอกสารธุรกิจ — ชื่อสถานะตามชนิดเอกสาร และ "ป้ายสถานะคือเมนู"
   กดป้ายสถานะในรายการ เห็นสิ่งที่ทำต่อได้ตามลำดับการไหลของเอกสาร (อนุมัติ สร้างเอกสารถัดไป รับชำระ ยกเลิก)
   DOC_STATUS[kind](d) → [คลาสสี, ชื่อสถานะ] · STATUS_ACTIONS[kind](d) → [[การกระทำ, ชื่อ, ไอคอน, คลาส?], …]
   แต่ละระบบลงทะเบียนการกระทำของเอกสารตัวเองเพิ่มได้ (STATUS_ACTIONS.invoice = …)
   =================================================================== */
const TRADE_ST = {
  quotation: { issued:['wait','รออนุมัติ'], approved:['open','อนุมัติ'], rejected:['late','ไม่อนุมัติ'],
    cancelled:['void','ยกเลิก'], closed:['paid','ดำเนินการแล้ว'], expired:['late','หมดอายุ'] },
  salesOrder: { issued:['wait','รออนุมัติ'], approved:['open','อนุมัติ'], rejected:['late','ไม่อนุมัติ'],
    cancelled:['void','ยกเลิก'], closed:['paid','ดำเนินการแล้ว'], partially_invoiced:['wait','ออกใบกำกับบางส่วน'] },
  purchaseOrder: { issued:['wait','รออนุมัติ'], approved:['open','อนุมัติ'], rejected:['late','ไม่อนุมัติ'],
    cancelled:['void','ยกเลิก'], closed:['paid','ดำเนินการแล้ว'], partially_received:['wait','รับสินค้าบางส่วน'] },
};
const DOC_STATUS = {
  quotation: (d) => TRADE_ST.quotation[tradeDocStatus('quotation', d)] || statusPill(d.status).st,
  salesOrder: (d) => TRADE_ST.salesOrder[d.status] || statusPill(d.status).st,
  purchaseOrder: (d) => TRADE_ST.purchaseOrder[d.status] || statusPill(d.status).st,
  /* ใบกำกับ: รอดำเนินการ (ยังไม่ส่งลูกค้า แก้ได้) → รอเก็บเงิน → แบ่งจ่าย → เก็บเงินแล้ว
     ใบรุ่นก่อนไม่มีธงส่งเอกสาร ถือว่าส่งแล้ว */
  invoice: function (d) {
    if (d.status === 'void') return ['void', 'ยกเลิก'];
    if (d.status === 'paid') return ['paid', 'เก็บเงินแล้ว'];
    if (d.status === 'partially_paid') return ['wait', 'แบ่งจ่าย'];
    if (d.status === 'credit_balance') return ['wait', 'ลูกค้ามีเครดิต รอคืนเงิน'];
    if (d.status === 'written_off') return ['late', 'ตัดหนี้สูญ'];
    if (d.delivered === false) return ['draft', 'รอดำเนินการ'];
    return d.due && d.due < TODAY && d.creditType !== 'creditHidden' ? ['late', 'เลยกำหนด'] : ['open', 'รอเก็บเงิน'];
  },
  cashSale: (d) => d.status === 'void' ? ['void', 'ยกเลิก'] : ['paid', 'เก็บเงินแล้ว'],
  receipt: (d) => d.status === 'void' ? ['void', 'ยกเลิก'] : ['paid', 'เก็บเงินแล้ว'],
  billingNote: (d) => ({ issued:['wait','รอวางบิล'], delivered:['open','วางบิลแล้ว'], partially_paid:['wait','รับชำระบางส่วน'],
    paid:['paid','เก็บเงินแล้ว'], closed:['paid','เปิดบิลแล้ว'], cancelled:['void','ยกเลิก'], void:['void','ยกเลิก'] })[d.status] || statusPill(d.status).st,
  bill: function (d) {
    if (d.status === 'void') return ['void', 'ยกเลิก'];
    if (d.status === 'paid') return ['paid', 'ชำระเงินแล้ว'];
    if (d.status === 'partially_paid') return ['wait', 'ชำระบางส่วน'];
    if (d.status === 'vendor_credit') return ['wait', 'ผู้ขายมีเครดิตให้เรา'];
    return d.due && d.due < TODAY && d.creditType !== 'creditHidden' ? ['late', 'เลยกำหนดจ่าย'] : ['open', 'รอชำระ'];
  },
  expense: (d) => d.status === 'void' ? ['void', 'ยกเลิก'] : d.status === 'paid' ? ['paid', 'ชำระเงินแล้ว'] : statusPill(d.status).st,
  payment: (d) => d.status === 'void' ? ['void', 'ยกเลิก'] : ['paid', 'ชำระเงินแล้ว'],
  goodsReceipt: (d) => ({ received:['open','รับสินค้าแล้ว · รอตั้งหนี้'], closed:['paid','ดำเนินการแล้ว'], void:['void','ยกเลิก'] })[d.status] || statusPill(d.status).st,
  whtCert: (d) => d.status === 'void' || d.void ? ['void', 'ยกเลิก'] : ['paid', 'ดำเนินการแล้ว'],
  creditNote: (d) => d.status === 'void' ? ['void', 'ยกเลิก'] : ['paid', 'อนุมัติ'],
  debitNote: (d) => d.status === 'void' ? ['void', 'ยกเลิก'] : ['paid', 'อนุมัติ'],
};
const STATUS_ACTIONS = {};
/** เซลล์สถานะในตาราง — มีสิ่งที่ทำต่อได้ = ปุ่มเปิดเมนู ไม่มี = ป้ายธรรมดา */
function docStatusCell(kind, d) {
  const f = DOC_STATUS[kind];
  const m = f ? f(d) : statusPill(d.status).st;
  const acts = STATUS_ACTIONS[kind] ? STATUS_ACTIONS[kind](d) : [];
  if (!acts.length) return { st: m };
  return { html: '<button type="button" class="st st-btn ' + m[0] + '" data-act="stmenu:' + kind + ':' + esc(d.no) + '" aria-haspopup="menu"'
    + ' title="กดเพื่อดูสิ่งที่ทำต่อได้">' + esc(m[1]) + '<span class="caret" aria-hidden="true"></span></button>' };
}
/** ชื่อสถานะของเอกสาร (ข้อความล้วน) — ใช้ในหน้ารายละเอียดและการค้นหา */
function docStatusLabel(kind, d) {
  const f = DOC_STATUS[kind];
  return (f ? f(d) : statusPill(d.status).st)[1];
}
EXTRA_DISPATCH.push(function (head, rest) {
  if (head !== 'stmenu') return false;
  const kind = rest[0], no = rest.slice(1).join(':');
  const d = (DB.docs[kind] || []).find((x) => x.no === no);
  if (!d) return true;
  const acts = (STATUS_ACTIONS[kind] ? STATUS_ACTIONS[kind](d) : []);
  const tail = rowMenuItems({ kind, no }).filter((i) => !acts.some((a) => a[0] === i[0]));
  const btnEl = Array.prototype.find.call(document.querySelectorAll('[data-act^="stmenu:"]'),
    (e) => e.getAttribute('data-act') === 'stmenu:' + kind + ':' + no);
  const r = btnEl ? btnEl.getBoundingClientRect() : { left: 80, bottom: 120 };
  openActionMenu(no + ' · ' + docStatusLabel(kind, d), acts.concat(tail.length && acts.length ? [['-']] : []).concat(tail), r.left, r.bottom + 4);
  return true;
});
