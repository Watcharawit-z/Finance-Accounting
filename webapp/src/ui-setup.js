/* ===================================================================
   หน้าจอตั้งค่าบริษัท: แก้ผังบัญชี · ลูกหนี้/เจ้าหนี้ยกมารายใบ (กรอกเองหรือลากไฟล์)
   =================================================================== */

/* ---------- ผังบัญชี ---------- */
function subTypeOptions() {
  return fsChoices().map((c) => [c.sub, c.group + ' — ' + c.label]);
}
function modalAccount(code) {
  const a = code ? DB.accounts.find((x) => x.code === code) : null;
  const used = a ? accountUsed(a.code) : false;
  const siblings = a ? DB.accounts.filter((x) => x.subType === a.subType && x.postable).length : 0;
  modal({
    title: a ? 'แก้ไขบัญชี ' + a.code : 'เพิ่มบัญชีในผังบัญชี',
    sub: a ? (used ? 'บัญชีนี้มีรายการแล้ว แก้ได้เฉพาะชื่อและการเป็นบัญชีหลัก' : 'ยังไม่มีรายการ แก้หมวดได้')
      : 'เลือกบรรทัดในงบการเงินที่บัญชีนี้ต้องไปแสดง ระบบรู้เองว่าเป็นสินทรัพย์ หนี้สิน ทุน รายได้ หรือค่าใช้จ่าย',
    body:'<div class="flds">'
      + field({ name:'acode', label:'รหัสบัญชี', value: a ? a.code : '', placeholder:'เช่น 1112.02', readonly: !!a })
      + field({ name:'aname', label:'ชื่อบัญชี', value: a ? a.name : '', placeholder:'เช่น เงินฝากธนาคารกสิกรไทย ออมทรัพย์' })
      + (a && (used || !a.postable)
        ? field({ name:'asubShow', label:'แสดงในงบการเงินที่', wide:true, readonly:true,
            value: (fsLineOf(a.subType) || '') + ' — ' + subTypeLabel(a.subType) })
        : field({ name:'asub', label:'แสดงในงบการเงินที่', type:'select', wide:true, options: subTypeOptions(),
            value: a ? a.subType : 'admin_expense' }))
      + (a && !a.postable ? '' : field({ name:'adefault', label:'บัญชีหลักของหมวด', type:'select', value: a && a.isDefault ? 'yes' : 'no',
          options:[['no', 'ไม่ใช่'], ['yes', 'ใช่ — เอกสารใหม่ลงบัญชีนี้อัตโนมัติ']],
          hint: a && siblings > 1 ? 'หมวดนี้มี ' + siblings + ' บัญชี' : 'เช่น บัญชีธนาคารหลักที่ใช้รับ/จ่ายเงิน' }))
      + '</div>'
      + (a && a.custom && !used ? '<div class="note">ยังไม่มีรายการ ลบบัญชีนี้ได้ ' + btn('acct:del:' + a.code, 'ลบบัญชี', 'danger') + '</div>' : ''),
    submitLabel: a ? 'บันทึก' : 'เพิ่มบัญชี',
    note:'บัญชีที่มีรายการแล้วเปลี่ยนหมวดไม่ได้ เพราะงบงวดที่ปิดไปแล้วจะเปลี่ยนตาม — ให้เพิ่มบัญชีใหม่แล้วโอนยอดแทน',
    onSubmit: function () {
      submitAction(function () {
        const r = saveAccount({ code: a ? a.code : val('acode'), name: val('aname'), subType: a && (used || !a.postable) ? a.subType : val('asub'),
          edit: !!a, makeDefault: val('adefault') === 'yes' });
        STATE.screen = 'coa';
        toast((a ? 'แก้ไขบัญชี ' : 'เพิ่มบัญชี ') + r.code + ' แล้ว', 'ok', r.name + (r.isDefault ? ' · บัญชีหลักของหมวด' : ''));
        return r;
      });
    },
  });
}

/* ---------- ลูกหนี้/เจ้าหนี้ยกมารายใบ ---------- */
const OI_ROWS = 12;
function modalOpenItems(kind) {
  const K = OPEN_ITEM_KIND[kind];
  const partners = DB.partners.filter((p) => (K.partnerKind === 'vendor' ? isVendor(p) : isCustomer(p)) && p.code !== 'OPENING' && p.active !== false);
  if (!partners.length) {
    toast('ยังไม่มี' + (kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย') + 'ในทะเบียน', 'err', 'เพิ่มที่หน้า' + (kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย')
      + ' หรือลากไฟล์ยอดค้างรายใบเข้าหน้านี้ ระบบสร้างคู่ค้าให้');
    return;
  }
  const date = openingDefaultDate();
  const un = openingUnassigned(kind, date);
  const free = Object.keys(un).reduce((s, c) => s + un[c], 0);
  const opt = '<option value="">— เลือก —</option>' + partners.map((p) => '<option value="' + esc(p.code) + '">' + esc(p.code + ' · ' + p.name) + '</option>').join('');
  let rows = '';
  for (let i = 0; i < OI_ROWS; i++) {
    rows += '<tr><td><select name="o' + i + '_p">' + opt + '</select></td>'
      + '<td><input name="o' + i + '_no" placeholder="เลขที่เดิม"></td>'
      + '<td><input name="o' + i + '_d" type="date"></td>'
      + '<td><input name="o' + i + '_due" type="date"></td>'
      + '<td><input name="o' + i + '_a" class="r" inputmode="decimal"></td></tr>';
  }
  modal({
    title: K.label + 'ยกมารายใบ',
    sub: free > 0 ? 'ยอด' + K.label + 'ยกมาที่ยังไม่แยกรายใบ ' + fmt(free) + ' บาท — ยอดรวมที่กรอกต้องไม่เกินนี้ ระบบไม่ลงบัญชีซ้ำ'
      : 'ยังไม่มียอด' + K.label + 'ยกมาในบัญชี — ระบบจะลงบัญชีเป็นยอดยกมาใหม่ คู่กับบัญชีปรับปรุงยอดยกมา',
    body:'<div class="flds">'
      + field({ name:'odate', label:'วันที่ยอดยกมา', type:'date', value: date, hint:'วันเดียวกับใบยอดยกมาที่นำเข้า' })
      + field({ name:'omode', label:'วิธีลงบัญชี', type:'select', value: free > 0 ? 'allocate' : 'post',
          options:[['allocate', 'แยกจากยอดยกมารวมที่นำเข้าแล้ว (ไม่ลงบัญชีซ้ำ)'], ['post', 'ลงบัญชีเป็นยอดยกมาใหม่']] })
      + '</div>'
      + '<div class="scroll"><table class="lines"><thead><tr><th>' + (kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย') + '</th><th>เลขที่เอกสาร</th>'
      + '<th>วันที่เอกสาร</th><th>ครบกำหนด</th><th class="r">ยอดค้าง</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      + '<div class="note">มีหลายใบ ลากไฟล์ Excel/CSV (ชื่อคู่ค้า เลขที่เอกสาร วันที่ ครบกำหนด ยอดค้าง) เข้าหน้านำเข้าข้อมูลได้ ระบบสร้างคู่ค้าที่ยังไม่มีให้</div>',
    submitLabel:'ตั้งยอด' + K.label + 'ยกมา',
    note:'ใบที่ยกมารับ/จ่ายชำระต่อในระบบได้ทันที และขึ้นในรายงานอายุหนี้ตามวันครบกำหนด',
    onSubmit: function () {
      submitAction(function () {
        const list = [];
        for (let i = 0; i < OI_ROWS; i++) {
          const pc = val('o' + i + '_p'), no = val('o' + i + '_no'), amt = val('o' + i + '_a');
          if (!pc && !no && !amt) continue;
          list.push({ partnerCode: pc, docNo: no, docDate: val('o' + i + '_d') || null, due: val('o' + i + '_due') || null, amount: amt });
        }
        const r = saveOpeningItems({ kind, date: val('odate'), mode: val('omode'), rows: list });
        STATE.screen = 'openitems';
        toast('ตั้งยอด' + K.label + 'ยกมา ' + r.count + ' ใบแล้ว', 'ok', 'รวม ' + fmt(r.total) + ' บาท · ' + r.entry.no);
        return r;
      });
    },
  });
}
/* วันที่ยอดยกมา = วันของใบยอดยกมาที่นำเข้า ถ้ายังไม่มีใช้วันแรกของงวดแรก */
function openingDefaultDate() {
  const op = DB.entries.filter((e) => e.type === 'opening' && e.status === 'posted').sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  if (op) return op.date;
  const first = DB.periods.slice().sort((a, b) => (a.start < b.start ? -1 : 1))[0];
  return first ? first.start : defaultDate();
}
function modalOpenItemsVoid(batch) {
  modal({
    title:'ยกเลิกยอดยกมาชุด ' + batch,
    sub:'กลับรายการใบสำคัญของชุดนี้ และใบค้างทุกใบในชุดเป็นยกเลิก — ทำได้เมื่อยังไม่มีใบใดถูกรับ/จ่ายชำระ',
    body:'<div class="flds">' + field({ name:'reason', label:'เหตุผล', wide:true, placeholder:'เช่น กรอกยอดผิด จะกรอกใหม่' }) + '</div>',
    submitLabel:'ยกเลิกทั้งชุด', submitKind:'danger',
    onSubmit: function () {
      submitAction(function () {
        const r = voidOpeningItems(batch, val('reason'));
        toast('ยกเลิกชุด ' + batch + ' แล้ว', 'ok', 'ใบกลับรายการ ' + r.no);
        return r;
      });
    },
  });
}

function scOpenItems() {
  const asOf = pEnd();
  const part = function (kind) {
    const K = OPEN_ITEM_KIND[kind];
    const docs = DB.docs[K.docs].filter((d) => d.broughtForward && d.status !== 'void');
    const gap = openingItemsGap(kind, asOf);
    const un = openingUnassigned(kind, asOf);
    const free = Object.keys(un).reduce((s, c) => s + un[c], 0);
    const left = (d) => outstandingAsOf(kind, d, asOf);
    return '<div class="sub-h">' + K.label + 'ยกมา — ' + docs.length + ' ใบ<span class="grow"></span>'
      + btn('oi:new:' + kind, '+ ' + K.label + 'ยกมารายใบ', gap > 0 || !docs.length ? 'primary' : '') + '</div>'
      + '<div class="reco">'
      + '<div><span>บัญชีคุม' + K.label + ' ณ ' + thDate(asOf) + '</span><b>' + fmt(K.sign * balBySub([K.sub], asOf)) + '</b></div>'
      + '<div><span>ยอดยกมารวมที่ยังไม่ระบุคู่ค้า</span><b>' + fmt(free) + '</b></div>'
      + '<div class="gt"><span>' + K.label + 'รายใบรวม ต่างจากบัญชีคุม</span><b class="' + (gap ? 'neg' : '') + '">' + fmt(gap) + '</b></div></div>'
      + (gap ? '<div class="note warn">บัญชีคุมกับใบค้างรายใบยังไม่เท่ากัน ' + fmt(gap) + ' บาท — ปิดงวดไม่ได้จนกว่าจะตั้งใบค้างครบ</div>' : '')
      + tbl({
        cols:[{t:'เลขที่เดิม'},{t:'วันที่'},{t:'ครบกำหนด'},{t: kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย'},{t:'ยอดยกมา',a:'r'},{t:'คงค้าง',a:'r'},{t:'ชุด'}],
        rows: docs.map((d) => [{mono:d.legacyNo || d.no}, thDateNum(d.date), thDateNum(d.due), d.partnerName, {n:d.total}, {n:left(d)},
          d.obBatch ? {html: '<span class="mono">' + esc(d.obBatch) + '</span> ' + btn('oi:void:' + d.obBatch, 'ยกเลิกชุด')} : {dim:'นำเข้าแฟ้มข้อมูล'}]),
        foot: ['', '', '', 'รวม', {n:docs.reduce((s, d) => s + d.total, 0)}, {n:docs.reduce((s, d) => s + left(d), 0)}, ''],
        empty:'ยังไม่มี' + K.label + 'ยกมารายใบ',
      });
  };
  return card({
    title:'ลูกหนี้/เจ้าหนี้ยกมารายใบ', sub:'ใบที่ยังค้างจากระบบเดิม ณ วันเริ่มใช้ระบบ — รับชำระ/จ่ายชำระต่อได้ และยอดรวมต้องเท่าบัญชีคุม',
    body: part('ar') + part('ap'),
    foot:'นำเข้างบทดลองแล้วยอดลูกหนี้/เจ้าหนี้อยู่ในบัญชีเป็นก้อนเดียว — ตั้งใบค้างรายใบแบบ "แยกจากยอดยกมารวม" ระบบย้ายยอดเป็นรายคู่ค้าโดยไม่ลงบัญชีซ้ำ',
  });
}

/* ---------- ไฟล์ยอดค้างรายใบ (ลากเข้าหน้านำเข้าข้อมูล) ---------- */
function openItemsFileAt(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (looksLikeOpenItems(rows[i])) return i;
  return -1;
}
function guessOpenItemKind(header) {
  const h = header.join(' ').toLowerCase();
  return /ผู้ขาย|เจ้าหนี้|vendor|supplier|payable/.test(h) ? 'ap' : 'ar';
}
function importOpenItemsCard(IMP) {
  const kind = IMP.oiKind;
  const K = OPEN_ITEM_KIND[kind];
  let rd;
  try { rd = readOpenItemsFile(IMP.rows, kind); }
  catch (e) { return card({ title:'ไฟล์ยอดค้างรายใบ', body:'<div class="note warn">' + esc(e.message) + '</div>', actions: btn('imp:reset', 'เลือกไฟล์ใหม่') }); }
  const date = IMP.oiDate || openingDefaultDate();
  const un = openingUnassigned(kind, date);
  const free = Object.keys(un).reduce((s, c) => s + un[c], 0);
  const mode = IMP.oiMode || (free > 0 ? 'allocate' : 'post');
  const over = mode === 'allocate' && rd.total > free;
  const ready = rd.rows.length > 0 && !over;
  return card({
    title:'ไฟล์ยอดค้างรายใบ — ตั้ง' + K.label + 'ยกมา',
    sub: esc(IMP.name) + ' · อ่านได้ ' + rd.rows.length + ' ใบ · รวม ' + fmt(rd.total) + ' บาท',
    actions: btn('imp:reset', 'เลือกไฟล์ใหม่') + btn('oiimp:run', 'ตั้ง' + K.label + 'ยกมา', ready ? 'primary' : 'disabled'),
    body:'<div class="flds">'
      + field({ name:'oiKind', label:'ไฟล์นี้เป็น', type:'select', value: kind, options:[['ar', 'ลูกหนี้ค้างรับ (ใบกำกับที่ลูกค้ายังไม่จ่าย)'], ['ap', 'เจ้าหนี้ค้างจ่าย (ใบแจ้งหนี้ที่ยังไม่ได้จ่ายผู้ขาย)']] })
      + field({ name:'oiDate', label:'วันที่ยอดยกมา', type:'date', value: date })
      + field({ name:'oiMode', label:'วิธีลงบัญชี', type:'select', value: mode,
          options:[['allocate', 'แยกจากยอดยกมารวมที่นำเข้าแล้ว (ไม่ลงบัญชีซ้ำ)'], ['post', 'ลงบัญชีเป็นยอดยกมาใหม่']] })
      + '</div>'
      + '<div class="reco">'
      + '<div><span>ยอดในไฟล์</span><b>' + fmt(rd.total) + '</b></div>'
      + '<div><span>ยอด' + K.label + 'ยกมาที่ยังไม่แยกรายใบ ณ ' + thDate(date) + '</span><b>' + fmt(free) + '</b></div>'
      + '<div class="gt"><span>' + (mode === 'allocate' ? 'เหลือที่ยังไม่แยกหลังนำเข้า' : 'จะลงบัญชีเป็นยอดยกมาใหม่') + '</span><b class="' + (over ? 'neg' : '') + '">'
        + fmt(mode === 'allocate' ? free - rd.total : rd.total) + '</b></div></div>'
      + (over ? '<div class="note warn">ยอดในไฟล์มากกว่ายอด' + K.label + 'ยกมาที่ยังไม่แยกรายใบ — ตรวจวันที่ให้ตรงกับใบยอดยกมา หรือเลือก "ลงบัญชีเป็นยอดยกมาใหม่" ถ้ายังไม่ได้นำเข้างบทดลอง</div>' : '')
      + (rd.creating.length ? '<div class="note">มี' + (kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย') + 'ใหม่ ' + rd.creating.length + ' รายที่ยังไม่อยู่ในทะเบียน ระบบจะสร้างให้: '
          + esc(rd.creating.slice(0, 6).map((c) => c.name).join(', ')) + (rd.creating.length > 6 ? ' …' : '') + '</div>' : '')
      + (rd.skipped.length ? '<div class="note">ข้าม ' + rd.skipped.length + ' แถว: ' + esc(rd.skipped.slice(0, 5).join(' · ')) + '</div>' : '')
      + tbl({
        cols:[{t:'แถว',a:'r'},{t: kind === 'ar' ? 'ลูกค้า' : 'ผู้ขาย'},{t:'เลขที่เอกสาร'},{t:'วันที่'},{t:'ครบกำหนด'},{t:'ยอดค้าง',a:'r'}],
        rows: rd.rows.map((r) => [{c:String(r.line)}, r.partnerName + (r.partnerCode ? '' : ' (ใหม่)'), {mono:r.docNo},
          r.docDate ? thDateNum(r.docDate) : {dim:'—'}, r.due ? thDateNum(r.due) : {dim:'—'}, {n:r.amount}]),
        foot: ['', '', '', '', 'รวม', {n:rd.total}],
      }),
  });
}
function runOpenItemsImport() {
  const I = STATE.imp;
  if (!I || I.kind !== 'openItems') return;
  runAction(function () {
    const rd = readOpenItemsFile(I.rows, I.oiKind);
    const date = val('oiDate') || I.oiDate || openingDefaultDate();
    const r = importOpeningItems(rd, I.oiKind, date, val('oiMode') || I.oiMode || 'allocate');
    STATE.imp = null; STATE.screen = 'openitems';
    toast('ตั้ง' + OPEN_ITEM_KIND[r.kind || I.oiKind].label + 'ยกมา ' + r.count + ' ใบแล้ว', 'ok', 'รวม ' + fmt(r.total) + ' บาท'
      + (rd.creating.length ? ' · สร้างคู่ค้าใหม่ ' + rd.creating.length + ' ราย' : ''));
  });
}

/* ---------- ลงทะเบียนกับหน้าจอหลัก ---------- */
SCREENS.openitems = scOpenItems;
PAGE_INFO.openitems = { d:'ใบที่ยังค้างจากระบบเดิม — ตั้งเป็นรายใบเพื่อรับ/จ่ายชำระต่อ และให้รายงานอายุหนี้ถูกตั้งแต่วันแรก',
  je: [['dr', 'ลูกหนี้การค้า (รายลูกค้า)'], ['cr', 'ลูกหนี้ยอดยกมารวม หรือบัญชีปรับปรุงยอดยกมา']] };
EXTRA_DISPATCH.push(function (head, rest) {
  if (head === 'acct') {
    if (rest[0] === 'new') { modalAccount(null); return true; }
    if (rest[0] === 'edit') { modalAccount(rest.slice(1).join(':')); return true; }
    if (rest[0] === 'del') {
      runAction(function () { const a = deleteAccount(rest.slice(1).join(':')); closeModal(); toast('ลบบัญชี ' + a.code + ' แล้ว', 'ok', a.name); });
      return true;
    }
  }
  if (head === 'oi') {
    if (rest[0] === 'new') { modalOpenItems(rest[1] === 'ap' ? 'ap' : 'ar'); return true; }
    if (rest[0] === 'void') { modalOpenItemsVoid(rest.slice(1).join(':')); return true; }
  }
  if (head === 'oiimp' && rest[0] === 'run') { runOpenItemsImport(); return true; }
  return false;
});
EXTRA_CHANGE.push(function (t) {
  const I = STATE.imp;
  if (!I || I.kind !== 'openItems') return false;
  if (t.name === 'oiKind') { I.oiKind = t.value === 'ap' ? 'ap' : 'ar'; render(); return true; }
  if (t.name === 'oiDate') { I.oiDate = t.value; render(); return true; }
  if (t.name === 'oiMode') { I.oiMode = t.value; render(); return true; }
  return false;
});
