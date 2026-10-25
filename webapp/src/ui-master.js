/* ===================================================================
   ข้อมูลหลัก — ตั้งค่าเลขที่เอกสาร · ค่าเริ่มต้นของเอกสาร · นำเข้าสมุดรายชื่อและสินค้าจากไฟล์
   ฟอร์มผู้ติดต่อและสินค้าอยู่ใน ui-actions.js (modalPartner modalItem) · ตรรกะนำเข้าอยู่ใน import.js
   =================================================================== */

/* ---------- เลขที่เอกสารและหัวเอกสาร ----------
   คำนำหน้าตั้งได้รายชนิดเอกสาร · นับใหม่ทุกเดือนหรือทุกปี (ปี ค.ศ.) · เห็นเลขที่ถัดไปทันทีที่พิมพ์ */
const NUMBERING_DOCS = [
  ['เอกสารขาย', [['quotation', 'ใบเสนอราคา'], ['salesOrder', 'ใบสั่งขาย'], ['invoice', 'ใบกำกับภาษี / ใบแจ้งหนี้'],
    ['billingNote', 'ใบวางบิล'], ['receipt', 'ใบเสร็จรับเงิน'], ['cashSale', 'ขายเงินสด / ใบกำกับภาษีอย่างย่อ'],
    ['creditNote', 'ใบลดหนี้'], ['debitNote', 'ใบเพิ่มหนี้'], ['customerDeposit', 'ใบรับเงินมัดจำ']]],
  ['เอกสารซื้อและค่าใช้จ่าย', [['purchaseOrder', 'ใบสั่งซื้อ'], ['goodsReceipt', 'ใบรับสินค้า'], ['bill', 'ตั้งหนี้ผู้ขาย'],
    ['paymentBatch', 'ใบเตรียมจ่าย'], ['payment', 'ใบสำคัญจ่าย'], ['expense', 'ค่าใช้จ่าย'], ['whtCert', 'หนังสือรับรอง 50 ทวิ'],
    ['vendorDeposit', 'ใบจ่ายเงินมัดจำ']]],
  ['สต๊อก', [['stockAdj', 'ใบปรับปรุงสินค้า']]],
];
const NUMBERING_KINDS = [].concat.apply([], NUMBERING_DOCS.map((g) => g[1]));
/** คำนำหน้ามาตรฐานของรูปแบบนั้น (ไม่ได้ตั้งเอง) */
const stdPrefix = (kind, style) => (style === 'fa' && DOC_PREFIX_STD[kind]) || SEQ_PREFIX[kind] || kind.toUpperCase().slice(0, 3);
const numberingSummary = (n) => n.style === 'fa'
  ? 'คำนำหน้า + ปี ค.ศ. + ' + (n.reset === 'year' ? 'เลขรัน 6 หลัก · นับใหม่ทุกปี' : 'เดือน + เลขรัน 4 หลัก · นับใหม่ทุกเดือน')
  : 'แบบเดิม — คำนำหน้า + ปีเดือน 2 หลัก - เลขรัน 5 หลัก · นับใหม่ทุกเดือน';
const docsInPeriod = (kind) => (DB.docs[kind] || []).filter((d) => d && d.date && periodOf(d.date) === STATE.period).length;

function numberingCard() {
  const n = numberingOf();
  const date = defaultDate();
  return card({
    title:'เลขที่เอกสารและหัวเอกสาร', sub: numberingSummary(n),
    actions: btn('numbering:edit', 'ตั้งค่าเลขที่เอกสาร', 'primary'),
    body: tbl({
      cols:[{t:'เอกสาร'},{t:'คำนำหน้า'},{t:'เลขที่ถัดไป'},{t:'ออกในงวดนี้',a:'c'}],
      rows: NUMBERING_KINDS.map((x) => [x[1], {mono: prefixOf(x[0])}, {mono: peekDocNo(x[0], date)}, {c: String(docsInPeriod(x[0]))}]),
    }),
    foot:'ระบบจองเลขที่ตอนลงบัญชีสำเร็จเท่านั้น เลขจึงเรียงต่อเนื่องไม่มีช่องว่าง · เลขที่ถัดไปคิดจากวันที่ ' + thDate(date)
      + ' · สมุดรายวันใช้คำนำหน้าเดิมเสมอ ไม่กระทบเลขใบสำคัญที่อ้างอยู่ในรายงาน',
  });
}
/** ค่าที่กำลังแก้ในหน้าต่างตั้งค่า — คำนำหน้าที่ตรงกับค่ามาตรฐานไม่เก็บ (เปลี่ยนรูปแบบภายหลังแล้วตามค่ามาตรฐานใหม่) */
function numberingDraft() {
  const style = val('nbStyle') === 'legacy' ? 'legacy' : 'fa';
  const out = { style, reset: style === 'fa' && val('nbReset') === 'year' ? 'year' : 'month', prefixes: {} };
  NUMBERING_KINDS.forEach(function (x) {
    const v = String(val('nbp_' + x[0]) || '').trim().toUpperCase();
    if (v && v !== stdPrefix(x[0], style)) out.prefixes[x[0]] = v;
  });
  return out;
}
/** ตัวอย่างเลขถัดไปทุกบรรทัด + เตือนคำนำหน้าผิดรูปแบบหรือซ้ำกัน */
function numberingPreview() {
  const box = document.querySelector('#modal [data-numbering-form]');
  if (!box) return;
  const cfg = numberingDraft();
  const reset = box.querySelector('[name="nbReset"]');
  if (reset) reset.disabled = cfg.style !== 'fa';
  const date = defaultDate();
  const eff = {};
  NUMBERING_KINDS.forEach((x) => { eff[x[0]] = cfg.prefixes[x[0]] || stdPrefix(x[0], cfg.style); });
  let bad = 0;
  NUMBERING_KINDS.forEach(function (x) {
    const k = x[0];
    const inp = box.querySelector('[name="nbp_' + k + '"]');
    if (inp) inp.placeholder = stdPrefix(k, cfg.style);
    const cell = box.querySelector('[data-nbprev="' + k + '"]');
    const note = box.querySelector('[data-nbnote="' + k + '"]');
    if (!cell || !note) return;
    const raw = String(inp ? inp.value : '').trim().toUpperCase();
    if (raw && !/^[A-Z0-9]{1,6}$/.test(raw)) {
      bad++;
      cell.textContent = '—';
      note.className = 'nb-note bad';
      note.textContent = 'ใช้ตัวอักษรอังกฤษหรือตัวเลข 1–6 ตัว';
      if (inp) inp.setAttribute('aria-invalid', 'true');
      return;
    }
    if (inp) inp.removeAttribute('aria-invalid');
    cell.textContent = peekDocNo(k, date, cfg);
    const share = NUMBERING_KINDS.filter((y) => y[0] !== k && eff[y[0]] === eff[k]).map((y) => y[1]);
    note.className = 'nb-note' + (share.length ? ' warn' : '');
    note.textContent = share.length ? 'คำนำหน้าเดียวกับ ' + share.join(', ') + ' — นับเลขร่วมกัน' : '';
  });
  const sub = box.querySelector('#nbSummary');
  if (sub) sub.textContent = numberingSummary(cfg);
  const submit = document.querySelector('#modal [data-act="modal:submit"]');
  if (submit) submit.classList.toggle('disabled', bad > 0);
}
function modalNumbering() {
  const n = numberingOf();
  const date = defaultDate();
  const rows = NUMBERING_DOCS.map(function (g) {
    return '<tr class="nb-g"><th colspan="3" scope="colgroup">' + esc(g[0]) + '</th></tr>' + g[1].map(function (x) {
      const own = n.prefixes && n.prefixes[x[0]] ? n.prefixes[x[0]] : '';
      return '<tr><th scope="row"><label for="nbp_' + x[0] + '">' + esc(x[1]) + '</label></th>'
        + '<td><input id="nbp_' + x[0] + '" name="nbp_' + x[0] + '" class="mono nb-pfx" maxlength="6" autocomplete="off" spellcheck="false"'
        + ' value="' + esc(own) + '" placeholder="' + esc(stdPrefix(x[0], n.style)) + '" aria-describedby="nbn_' + x[0] + '"></td>'
        + '<td><span class="nb-next-l">ถัดไป </span><span class="mono" data-nbprev="' + x[0] + '">' + esc(peekDocNo(x[0], date)) + '</span>'
        + '<div class="nb-note" id="nbn_' + x[0] + '" data-nbnote="' + x[0] + '" aria-live="polite"></div></td></tr>';
    }).join('');
  }).join('');
  modal({
    title:'ตั้งค่าเลขที่เอกสาร',
    sub:'คำนำหน้าของแต่ละเอกสาร และรอบการนับเลขใหม่ — เห็นเลขที่ถัดไปทันทีที่แก้',
    body:'<div data-numbering-form>'
      + '<div class="flds">'
      + field({ name:'nbStyle', label:'รูปแบบเลขที่', type:'select', value: n.style === 'legacy' ? 'legacy' : 'fa',
          options:[['fa', 'คำนำหน้า + ปี ค.ศ. + เลขรัน'], ['legacy', 'แบบเดิมของระบบ (INV2606-00001)']] })
      + field({ name:'nbReset', label:'นับเลขใหม่', type:'select', value: n.reset === 'year' ? 'year' : 'month',
          options:[['month', 'ทุกเดือน (INV2026060001)'], ['year', 'ทุกปี (INV2026000001)']],
          hint:'ใช้กับรูปแบบคำนำหน้า + ปี ค.ศ. · แบบเดิมนับใหม่ทุกเดือนเสมอ' })
      + '<div class="fld-hint wide" id="nbSummary">' + esc(numberingSummary(n)) + '</div>'
      + '</div>'
      + '<div class="scroll"><table class="nb-tbl"><thead><tr><th scope="col">เอกสาร</th><th scope="col">คำนำหน้า</th>'
      + '<th scope="col">เลขที่ถัดไป (ถ้าออกวันที่ ' + esc(thDate(date)) + ')</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="note">เว้นว่าง = ใช้คำนำหน้ามาตรฐาน · ตัวอักษรอังกฤษหรือตัวเลข ไม่เกิน 6 ตัว</div>'
      + '<div class="note warn"><b>เปลี่ยนกลางงวด เลขรันนับต่อจากเลขล่าสุด</b> ไม่เริ่มที่ 1 ใหม่ (ตัวนับรายเดือนกับรายปีแยกกัน) · '
      + 'เอกสารที่ออกไปแล้วคงเลขเดิมทุกใบ ระบบไม่เปลี่ยนเลขย้อนหลัง'
      + (n.style === 'legacy' ? ' · สมุดบัญชีนี้ยังใช้เลขแบบเดิม เปลี่ยนเป็นแบบใหม่แล้วใบเก่ายังเป็นเลขแบบเดิม' : '') + '</div>'
      + '</div>',
    submitLabel:'บันทึกการตั้งค่า',
    note:'มีผลกับเอกสารที่ลงบัญชีหลังจากนี้ · บันทึกในร่องรอยการตรวจสอบ',
    onSubmit: function () {
      submitAction(function () {
        const r = saveNumbering(numberingDraft());
        toast('บันทึกการตั้งค่าเลขที่เอกสารแล้ว', 'ok', 'ใบกำกับถัดไป: ' + peekDocNo('invoice', defaultDate()) + ' · ' + numberingSummary(r));
        return r;
      });
    },
  });
}
EXTRA_INPUT.push(function (t) {
  if (!t.name || t.name.indexOf('nbp_') !== 0) return false;
  numberingPreview();
  return true;
});
EXTRA_CHANGE.push(function (t) {
  if (t.name !== 'nbStyle' && t.name !== 'nbReset') return false;
  numberingPreview();
  return true;
});

/* ---------- ฟังก์ชันเอกสาร: ค่าเริ่มต้นของเอกสารใหม่ ---------- */
function docDefaultsCard() {
  const mode = ((DB.settings && DB.settings.docDefaults) || {}).priceMode || 'exclusive';
  const opt = (m, label) => '<button class="chip' + (mode === m ? ' on' : '') + '" data-act="docdef:price:' + m + '" aria-pressed="'
    + (mode === m ? 'true' : 'false') + '">' + esc(label) + '</button>';
  return card({
    title:'ฟังก์ชันเอกสาร', sub:'ค่าเริ่มต้นของเอกสารที่สร้างใหม่ ใช้กับทุกคนที่ทำบัญชีบริษัทนี้',
    body:'<div class="set-rows">'
      + '<div><span id="ddPrice">ราคาสินค้าในเอกสารใหม่</span><div class="chips" role="group" aria-labelledby="ddPrice">'
      + opt('exclusive', 'ราคาไม่รวมภาษี') + opt('inclusive', 'ราคารวมภาษี') + '</div>'
      + '<small>ใช้กับเอกสารที่สร้างหลังจากนี้เท่านั้น เอกสารเดิมไม่เปลี่ยน · เปลี่ยนรายใบได้ที่ช่อง "ราคา" เหนือตารางรายการ</small></div>'
      + '</div>',
  });
}
EXTRA_DISPATCH.push(function (head, rest) {
  if (head === 'numbering' && rest[0] === 'edit') { modalNumbering(); return true; }
  if (head !== 'docdef') return false;
  if (rest[0] === 'price') {
    runAction(function () {
      const d = saveDocDefaults({ priceMode: rest[1] });
      toast('เอกสารใหม่เริ่มที่' + PRICE_MODES[d.priceMode], 'ok', 'เอกสารที่ออกไปแล้วไม่เปลี่ยน');
    });
  }
  return true;
});

/* ===================================================================
   นำเข้าสมุดรายชื่อและสินค้า — หน้าจอ
   ลากไฟล์ที่หน้านำเข้าข้อมูล → ระบบดูหัวคอลัมน์เองว่าเป็นสมุดรายชื่อหรือสินค้า → เห็นผลทุกแถวก่อนกดนำเข้า
   =================================================================== */
const MASTER_ST = { new: ['paid', 'เพิ่มใหม่'], widen: ['open', 'เพิ่มบทบาท'], dup: ['draft', 'ซ้ำ ข้ามไป'], bad: ['late', 'นำเข้าไม่ได้'] };
const MASTER_FILE = { contact: 'contacts', product: 'products' };
function masterDownload(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
/** เปิดไฟล์ที่ตรวจแล้วว่าเป็นสมุดรายชื่อ/สินค้า */
function masterOpen(name, rows, det) {
  const want = STATE.impWant || {};
  STATE.impMasterDone = null;
  STATE.imp = { name, rows, kind: 'master', mk: det.kind, headerRow: det.headerRow, map: det.map, show: 'all',
    opts: { defaultKind: want.side || 'customer', defaultType: 'nonstock' } };
  masterRefresh(STATE.imp);
}
function masterRefresh(I) {
  I.read = readMasterFile(I.mk, I.rows, I.headerRow, I.map);
  I.plan = planMasterImport(I.mk, I.read, I.opts);
}
const masterTemplateBtns = (want) => btn('masterimp:template:contact', 'แบบฟอร์มสมุดรายชื่อ (.csv)', want === 'contact' ? 'primary' : '')
  + btn('masterimp:template:product', 'แบบฟอร์มสินค้า (.csv)', want === 'product' ? 'primary' : '');
/** การ์ดแนะนำในหน้านำเข้า — แบบฟอร์มและกติกาการตรวจซ้ำ */
function masterInfoCard() {
  const want = STATE.impWant ? STATE.impWant.kind : '';
  return card({
    title:'นำเข้าสมุดรายชื่อและสินค้า',
    sub:'ลูกค้า ผู้ขาย และสินค้าจากโปรแกรมเดิม หรือกรอกในแบบฟอร์มแล้วลากไฟล์มาวางในช่องด้านบน',
    actions: masterTemplateBtns(want),
    body:'<div class="prose"><p>ใช้ไฟล์ที่ส่งออกจากโปรแกรมเดิมได้เลย ระบบอ่านหัวคอลัมน์เอง (ชื่อ เลขผู้เสียภาษี สาขา ผู้ติดต่อ อีเมล ธนาคาร '
      + 'ราคาขาย ราคาซื้อ ชนิดภาษี บาร์โค้ด ฯลฯ) แล้วแสดงผลทุกแถวให้ตรวจก่อนบันทึก</p>'
      + '<p class="dim">แถวที่ซ้ำกับทะเบียนข้ามให้เอง — ผู้ติดต่อดูจากรหัส หรือเลขผู้เสียภาษี + สาขา · สินค้าดูจากรหัส บาร์โค้ด หรือชื่อ · '
      + 'ผู้ติดต่อที่มีอยู่แล้วแต่คนละบทบาท (เป็นลูกค้า ไฟล์บอกเป็นผู้ขาย) ตั้งเป็นผู้จำหน่ายและลูกค้าให้ ไม่สร้างซ้ำสองราย · '
      + 'แถวที่นำเข้าไม่ได้ดาวน์โหลดเป็นไฟล์พร้อมเหตุผล แก้แล้วลากเข้ามาใหม่ได้ทันที</p></div>',
  });
}
/** ผลการนำเข้าครั้งล่าสุด (แสดงหลังกดนำเข้า) */
function masterDoneCard() {
  /* จับคู่ทั้งเลขและเวลา — สลับบริษัทแล้วประวัติเลขเดียวกันของอีกบริษัทต้องไม่ขึ้นมาแทน */
  const d = STATE.impMasterDone;
  const rec = d ? (DB.masterImports || []).find((x) => x.id === d.id && x.at === d.at) : null;
  if (!rec) return '';
  const contact = rec.kind === 'contact';
  /* นำเข้าแต่ผู้ขาย — พาไปทะเบียนผู้ขาย */
  const made = DB.partners.filter((p) => rec.codes.indexOf(p.code) >= 0);
  const vendorsOnly = contact && made.length > 0 && made.every((p) => p.kind === 'vendor');
  return card({
    title:'นำเข้า' + (contact ? 'สมุดรายชื่อ' : 'สินค้า') + 'แล้ว', sub: rec.name,
    actions: (rec.rejects.length ? btn('masterimp:rejects:' + rec.id, 'ดาวน์โหลดแถวที่ไม่ได้นำเข้า') : '')
      + (contact ? btn(vendorsOnly ? 'go:vendors' : 'go:customers', vendorsOnly ? 'ไปที่ทะเบียนผู้ขาย' : 'ไปที่ทะเบียนลูกค้า', 'primary')
        : btn('go:items', 'ไปที่ทะเบียนสินค้า', 'primary')),
    body:'<div class="reco">'
      + '<div><span>เพิ่มใหม่</span><b>' + rec.created + (contact ? ' ราย' : ' รายการ') + '</b></div>'
      + (contact ? '<div><span>ตั้งเป็นผู้จำหน่ายและลูกค้า</span><b>' + rec.widened + ' ราย</b></div>' : '')
      + '<div><span>ซ้ำกับทะเบียน (ข้าม)</span><b>' + rec.dup + '</b></div>'
      + '<div class="gt"><span>นำเข้าไม่ได้</span><b class="' + (rec.bad ? 'neg' : '') + '">' + rec.bad + '</b></div></div>',
  });
}
function masterHistoryCard() {
  const list = DB.masterImports || [];
  if (!list.length) return '';
  return card({
    title:'ประวัติการนำเข้าสมุดรายชื่อและสินค้า', sub: list.length + ' ครั้งล่าสุด',
    body: tbl({
      cols:[{t:'เมื่อ'},{t:'ไฟล์'},{t:'ข้อมูล'},{t:'แถว',a:'r'},{t:'เพิ่มใหม่',a:'r'},{t:'เพิ่มบทบาท',a:'r'},{t:'ซ้ำ',a:'r'},{t:'ไม่ผ่าน',a:'r'},{t:''}],
      rows: list.map((x) => [thDateNum(x.at.slice(0, 10)) + ' ' + x.at.slice(11, 16), x.name, x.kind === 'contact' ? 'สมุดรายชื่อ' : 'สินค้า',
        {c:String(x.rows)}, {c:String(x.created)}, {c:String(x.widened || 0)}, {c:String(x.dup)},
        x.bad ? {c:String(x.bad)} : {c:'0'},
        x.rejects.length ? {html: btn('masterimp:rejects:' + x.id, 'แถวที่ไม่ได้นำเข้า')} : {dim:'—'}]),
    }),
    foot:'ไฟล์แถวที่ไม่ได้นำเข้ามีคอลัมน์เดิมครบ พร้อมผลและเหตุผล แก้ในไฟล์นั้นแล้วลากเข้ามาใหม่ได้ (แถวที่นำเข้าแล้วจะขึ้นว่าซ้ำและข้ามให้)',
  });
}
/** ไฟล์สมุดรายชื่อ/สินค้าที่ลากเข้ามา — ตรวจทุกแถวก่อนนำเข้า */
function masterImportCard(I) {
  const contact = I.mk === 'contact';
  const plan = I.plan;
  const c = plan.counts;
  const go = c.new + c.widen;
  const head = I.read.header;
  const fields = MASTER_FIELDS[I.mk];
  const used = fields.filter((f) => I.map[f[0]] !== undefined);
  const unused = head.map((h, j) => [h, j]).filter((x) => x[0] && !Object.keys(I.map).some((k) => I.map[k] === x[1]));
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
  const colOpts = (k) => '<option value="">— ไม่ใช้ —</option>' + head.map((h, j) => '<option value="' + j + '"' + (I.map[k] === j ? ' selected' : '') + '>'
    + esc(letter(j) + ' · ' + (h || '(ไม่มีหัวคอลัมน์)')) + '</option>').join('');
  const show = I.show || 'all';
  const view = plan.rows.map((r, i) => ({ r, inp: I.read.rows[i].input })).filter((x) => show === 'all' || x.r.status === show
    || (show === 'skip' && (x.r.status === 'dup' || x.r.status === 'bad')));
  const kindLabel = (inp) => PARTNER_KINDS[inp.kind || I.opts.defaultKind] || '—';
  const typeLabel = (inp) => ITEM_TYPES[inp.type || I.opts.defaultType] || '—';
  const fchip = (k, label, n) => '<button class="chip' + (show === k ? ' on' : '') + '" data-act="masterimp:show:' + k + '"'
    + (show === k ? ' aria-pressed="true"' : '') + '>' + esc(label) + '<span class="chip-n">' + n + '</span></button>';
  return card({
    title: contact ? 'ไฟล์สมุดรายชื่อ — ตรวจก่อนนำเข้า' : 'ไฟล์สินค้าและบริการ — ตรวจก่อนนำเข้า',
    sub: I.name + ' · ' + I.read.rows.length + ' แถว · ยังไม่มีอะไรถูกบันทึกจนกว่าจะกดนำเข้า',
    actions: btn('imp:reset', 'เลือกไฟล์ใหม่')
      + (c.dup + c.bad ? btn('masterimp:rejects:plan', 'ดาวน์โหลดแถวที่จะไม่ได้นำเข้า') : '')
      + btn('masterimp:run', go ? 'นำเข้า ' + go + (contact ? ' ราย' : ' รายการ') : 'ไม่มีแถวที่นำเข้าได้', go ? 'primary' : 'disabled'),
    body:'<div class="flds">'
      + field({ name:'mkKind', label:'ไฟล์นี้เป็น', type:'select', value: I.mk,
          options:[['contact', MASTER_KINDS.contact], ['product', MASTER_KINDS.product]] })
      + (contact
        ? field({ name:'mkDefKind', label:'แถวที่ไม่ระบุประเภทผู้ติดต่อ ให้เป็น', type:'select', value: I.opts.defaultKind,
            options: Object.keys(PARTNER_KINDS).map((k) => [k, PARTNER_KINDS[k]]) })
        : field({ name:'mkDefType', label:'แถวที่ไม่ระบุประเภทสินค้า ให้เป็น', type:'select', value: I.opts.defaultType,
            options: Object.keys(ITEM_TYPES).map((k) => [k, ITEM_TYPES[k]]),
            hint:'สินค้านับสต๊อกต้องรับเข้าคลังก่อนขาย — ไม่แน่ใจเลือกสินค้าไม่นับสต๊อก เปลี่ยนเป็นนับสต๊อกทีหลังได้' }))
      + '</div>'
      + '<div class="reco">'
      + '<div><span>จะเพิ่มใหม่</span><b>' + c.new + '</b></div>'
      + (contact ? '<div><span>มีแล้วคนละบทบาท → ผู้จำหน่ายและลูกค้า</span><b>' + c.widen + '</b></div>' : '')
      + '<div><span>ซ้ำกับทะเบียนหรือแถวก่อนหน้า (ข้าม)</span><b>' + c.dup + '</b></div>'
      + '<div><span>นำเข้าไม่ได้ (ดูเหตุผลรายแถว)</span><b class="' + (c.bad ? 'neg' : '') + '">' + c.bad + '</b></div>'
      + '<div class="gt"><span>แถวว่างหรือบรรทัดผลรวม (ข้ามอัตโนมัติ)</span><b>' + I.read.skipped.length + '</b></div></div>'
      + '<div class="note">อ่านคอลัมน์ได้ ' + used.length + ' ช่อง: ' + esc(used.map((f) => f[1] + ' ← ' + (head[I.map[f[0]]] || '?')).join(' · '))
        + (unused.length ? '<br><span class="dim">ไม่ได้ใช้: ' + esc(unused.map((x) => x[0]).join(' · ')) + '</span>' : '') + '</div>'
      + '<details class="adv" style="margin:0 var(--space-md) var(--space-sm)"><summary>จับคู่คอลัมน์เอง (ปกติไม่ต้องแตะ)</summary><div class="flds">'
      + fields.map((f) => '<div class="fld-w"><label for="mkc_' + f[0] + '">' + esc(f[1]) + '</label><select id="mkc_' + f[0] + '" class="mkcol" data-k="' + f[0] + '">'
          + colOpts(f[0]) + '</select></div>').join('')
      + '</div></details>'
      + '<div class="filters"><div class="chips" role="group" aria-label="กรองตามผลการตรวจ">'
      + fchip('all', 'ทั้งหมด', plan.rows.length) + fchip('new', 'เพิ่มใหม่', c.new) + (contact && c.widen ? fchip('widen', 'เพิ่มบทบาท', c.widen) : '')
      + fchip('dup', 'ซ้ำ', c.dup) + fchip('bad', 'นำเข้าไม่ได้', c.bad) + '</div></div>'
      + tbl({
        cols: [{t:'แถว',a:'r'},{t:'ผล'},{t:'รหัส'},{t:'ชื่อ'}]
          .concat(contact ? [{t:'ประเภท'},{t:'เลขผู้เสียภาษี'},{t:'สาขา'},{t:'ผู้ติดต่อ'}] : [{t:'ประเภท'},{t:'หน่วย'},{t:'ราคาขาย',a:'r'},{t:'ราคาซื้อ',a:'r'}])
          .concat([{t:'หมายเหตุ'}]),
        rows: view.slice(0, 300).map(function (x) {
          const r = x.r, inp = x.inp;
          return [{c:String(r.line)}, {st: MASTER_ST[r.status]}, r.code ? {mono:r.code} : {dim:'ตั้งให้'}, r.name || {dim:'—'}]
            .concat(contact
              ? [kindLabel(inp), inp.taxId ? {mono:inp.taxId} : {dim:'—'}, inp.branch ? {mono:inp.branch} : {dim:'—'}, inp.contactPerson || {dim:'—'}]
              : [typeLabel(inp), inp.uom || {dim:'—'}, {n: inp.price ? M(inp.price) : 0}, {n: inp.buyPrice ? M(inp.buyPrice) : 0}])
            .concat([r.status === 'new' ? {dim: r.why} : r.why]);
        }),
        empty:'ไม่มีแถวในกลุ่มนี้',
      })
      + (view.length > 300 ? '<div class="note">แสดง 300 แถวแรกจาก ' + view.length + ' แถว — ดาวน์โหลดแถวที่จะไม่ได้นำเข้าเพื่อดูครบทุกแถว</div>' : ''),
    foot: go ? 'กดนำเข้าแล้วบันทึกเฉพาะแถว "เพิ่มใหม่"' + (contact ? ' และ "เพิ่มบทบาท"' : '') + ' แถวอื่นเก็บไว้ในประวัติพร้อมเหตุผล ดาวน์โหลดไปแก้ได้'
      : 'ทุกแถวซ้ำหรือนำเข้าไม่ได้ — ดูเหตุผลในคอลัมน์หมายเหตุ หรือดาวน์โหลดแถวที่จะไม่ได้นำเข้าไปแก้',
  });
}
function runMasterImport() {
  const I = STATE.imp;
  if (!I || I.kind !== 'master') return;
  runAction(function () {
    const r = importMasterFile(I.mk, I.read, Object.assign({ name: I.name }, I.opts));
    STATE.imp = null; STATE.impWant = null; STATE.impMasterDone = { id: r.id, at: r.at };
    const unit = I.mk === 'contact' ? ' ราย' : ' รายการ';
    toast('นำเข้า' + (I.mk === 'contact' ? 'สมุดรายชื่อ ' : 'สินค้า ') + r.created + unit + 'แล้ว', 'ok',
      [r.widened ? 'ตั้งเป็นผู้จำหน่ายและลูกค้า ' + r.widened + ' ราย' : '', r.dup ? 'ข้ามที่ซ้ำ ' + r.dup : '',
        r.bad ? 'นำเข้าไม่ได้ ' + r.bad + ' แถว (ดาวน์โหลดได้)' : ''].filter(Boolean).join(' · '));
  });
}
EXTRA_DISPATCH.push(function (head, rest) {
  if (head !== 'masterimp') return false;
  const I = STATE.imp;
  if (rest[0] === 'go') {
    STATE.impWant = { kind: rest[1], side: rest[2] || null };
    STATE.screen = 'import'; STATE.sel = null; STATE.filter = ''; STATE.imp = null; STATE.impMasterDone = null;
    render();
    return true;
  }
  if (rest[0] === 'template') {
    const kind = rest[1] === 'product' ? 'product' : 'contact';
    masterDownload('Financii_' + MASTER_FILE[kind] + '_template.csv', masterTemplateCsv(kind));
    toast('ดาวน์โหลดแบบฟอร์ม' + (kind === 'contact' ? 'สมุดรายชื่อ' : 'สินค้า') + 'แล้ว', 'ok', 'เปิดด้วย Excel กรอกต่อจากแถวตัวอย่าง (ลบแถวตัวอย่างก่อน) แล้วลากกลับมาที่หน้านี้');
    return true;
  }
  if (rest[0] === 'rejects') {
    let rec = null;
    if (rest[1] === 'plan' && I && I.kind === 'master') {
      rec = { id: 'preview', header: I.read.header, rejects: I.plan.rows.filter((x) => x.status === 'dup' || x.status === 'bad') };
    } else rec = (DB.masterImports || []).find((x) => String(x.id) === rest[1]);
    if (!rec || !rec.rejects.length) return true;
    masterDownload('Financii_import_' + rec.id + '_rejects.csv', masterRejectsCsv(rec));
    toast('ดาวน์โหลดแถวที่ไม่ได้นำเข้า ' + rec.rejects.length + ' แถว', 'ok', 'แก้ในไฟล์แล้วลากเข้ามาใหม่ได้ทันที');
    return true;
  }
  if (rest[0] === 'show' && I && I.kind === 'master') { I.show = rest[1]; render(); return true; }
  if (rest[0] === 'run') { runMasterImport(); return true; }
  return true;
});
EXTRA_CHANGE.push(function (t) {
  const I = STATE.imp;
  if (!I || I.kind !== 'master') return false;
  if (t.name === 'mkKind') {
    I.mk = t.value === 'product' ? 'product' : 'contact';
    I.map = masterMapFrom(I.mk, (I.rows[I.headerRow] || []).map(cellText));
    I.show = 'all';
  } else if (t.name === 'mkDefKind') I.opts.defaultKind = t.value;
  else if (t.name === 'mkDefType') I.opts.defaultType = t.value;
  else if (t.classList && t.classList.contains('mkcol')) {
    const k = t.getAttribute('data-k');
    Object.keys(I.map).forEach((x) => { if (t.value !== '' && I.map[x] === Number(t.value)) delete I.map[x]; });
    if (t.value === '') delete I.map[k]; else I.map[k] = Number(t.value);
  } else return false;
  runAction(function () { masterRefresh(I); });
  return true;
});
