/* ===================================================================
   หน้าจอและแบบฟอร์มของระบบกระทบยอดธนาคาร (bank.js)
   หน้าเดียวทำครบ: เลือกบัญชีเงินฝาก → นำเข้า/กรอกสเตทเมนต์ → จับคู่ → บันทึกรายการที่ธนาคารลงไว้ → งบกระทบยอด
   =================================================================== */
let BANK_IMP = null;      // ไฟล์สเตทเมนต์ที่กำลังดูตัวอย่างในหน้าต่างนำเข้า {name, rows, map, headerRow, acc}

/** บัญชีเงินฝากที่กำลังดู — ที่เลือกไว้ › บัญชีที่มีความเคลื่อนไหวในงวด › บัญชีที่เริ่มกระทบยอดแล้ว › บัญชีแรก */
function bankCurrentAcc() {
  const list = bankAccounts();
  if (!list.length) return null;
  if (STATE.bankAcc && list.some((a) => a.code === STATE.bankAcc)) return STATE.bankAcc;
  const a = list.find((x) => bankHasActivity(x.code, pStart(), pEnd())) || list.find((x) => bankStartDate(x.code)) || list[0];
  return a.code;
}
const bankAccLabel = (code) => { const a = DB.accounts.find((x) => x.code === code); return a ? a.code + ' ' + a.name : code; };
const bankOptAccounts = () => bankAccounts().map((a) => [a.code, a.code + ' ' + a.name]);
const bankAmt = (t) => (t.credit ? fmt(t.credit) : '(' + fmt(t.debit) + ')');

/* ---------- งบกระทบยอด — แถวเดียวกันทั้งบนจอ ไฟล์ CSV และใบพิมพ์ ---------- */
function bankRecRows(r) {
  const rows = [];
  const head = (label, total) => rows.push({ k: 'h', label, total });
  const sec = (label) => rows.push({ k: 'h2', label });
  const det = (date, label, ref, amt) => rows.push({ k: 'd', date, label, ref, amt });
  const sub = (label, total) => rows.push({ k: 's', label, total });
  const tot = (label, total) => rows.push({ k: 't', label, total });
  const none = (txt) => rows.push({ k: 'd', label: txt, dim: true });
  head('ยอดคงเหลือตามสเตทเมนต์ธนาคาร ณ ' + thDate(r.end) + (r.stmt !== null && !r.stmtEntered ? ' (ยังไม่ยืนยัน)' : ''), r.stmt);
  sec('บวก เงินฝากระหว่างทาง (บันทึกบัญชีแล้ว ธนาคารยังไม่เข้าบัญชี)');
  r.deposits.forEach((i) => det(i.date, i.desc, i.key.indexOf('BF-') === 0 ? 'ค้างยกมา' : i.key, i.amount));
  if (!r.deposits.length) none('ไม่มี');
  sub('รวมเงินฝากระหว่างทาง', r.sumDeposits);
  sec('หัก เช็คค้างจ่าย / รายการจ่ายที่ธนาคารยังไม่ตัดบัญชี');
  r.cheques.forEach((i) => det(i.date, i.desc, i.key.indexOf('BF-') === 0 ? 'ค้างยกมา' : i.key, -i.amount));
  if (!r.cheques.length) none('ไม่มี');
  sub('รวมเช็คค้างจ่าย', -r.sumCheques);
  tot('ยอดคงเหลือตามสเตทเมนต์หลังปรับปรุง', r.adjBank);
  rows.push({ k: 'sp' });
  head('ยอดคงเหลือตามบัญชี ' + r.acc + ' ณ ' + thDate(r.end), r.book);
  sec('บวก เงินเข้าที่ธนาคารลงไว้ แต่ยังไม่ได้บันทึกบัญชี');
  r.unrecIn.forEach((t) => det(t.date, t.desc, t.ref, bankNet(t)));
  if (!r.unrecIn.length) none('ไม่มี');
  sub('รวม', r.sumUnrecIn);
  sec('หัก เงินออกที่ธนาคารลงไว้ แต่ยังไม่ได้บันทึกบัญชี');
  r.unrecOut.forEach((t) => det(t.date, t.desc, t.ref, bankNet(t)));
  if (!r.unrecOut.length) none('ไม่มี');
  sub('รวม', -r.sumUnrecOut);
  tot('ยอดคงเหลือตามบัญชีหลังปรับปรุง', r.adjBook);
  rows.push({ k: 'sp' });
  tot('ผลต่าง (ต้องเป็นศูนย์)', r.unexplained);
  return rows;
}
/** สถานะของงบกระทบยอดเป็นภาษาคน — บอกว่ายังเหลืออะไรต้องทำ */
function bankRecStatus(r) {
  if (r.beforeStart) return { ok: true, text: 'เริ่มกระทบยอดบัญชีนี้ในระบบตั้งแต่ ' + thPeriod(r.start.slice(0, 7)) + ' — งวดนี้กระทบยอดนอกระบบ' };
  if (!r.start) return { ok: false, text: 'ยังไม่มีสเตทเมนต์ของบัญชีนี้ — นำเข้าไฟล์จากธนาคาร หรือกรอกรายการและยอดตามสเตทเมนต์ของงวดแรกที่จะเริ่มกระทบยอด' };
  if (r.ok) {
    return { ok: true, text: 'กระทบยอดแล้ว — ยอดตามสเตทเมนต์หลังปรับรายการระหว่างทางเท่ากับยอดในบัญชีพอดี'
      + (r.outstanding.length ? ' · รายการระหว่างทาง ' + r.outstanding.length + ' รายการยกไปจับคู่งวดหน้า' : '') };
  }
  const todo = [];
  if (!r.stmtEntered) todo.push('กรอกยอดคงเหลือปลายงวดตามสเตทเมนต์ (ปุ่ม "ยอดตามสเตทเมนต์")');
  if (r.unrecorded.length) todo.push('บันทึกบัญชีหรือจับคู่รายการที่ธนาคารลงไว้ ' + r.unrecorded.length + ' รายการ รวม ' + fmt(r.sumUnrecIn - r.sumUnrecOut) + ' บาท');
  if (r.unexplained) todo.push('หาที่มาของผลต่าง ' + fmt(r.unexplained) + ' บาท — สเตทเมนต์อาจขาดรายการ ยอดปลายงวดที่กรอกอาจผิด หรือมีรายการในบัญชีที่ลงผิดยอด');
  return { ok: false, text: 'ยังไม่ครบ: ' + (todo.join(' · ') || 'ผลต่าง ' + fmt(r.diff || 0) + ' บาท') };
}

/* ---------- หน้ากระทบยอด ---------- */
function scBankRec() {
  const code = bankCurrentAcc();
  if (!code) {
    return card({ title:'กระทบยอดเงินฝากธนาคาร', sub: thPeriod(STATE.period),
      body:'<div class="empty">ผังบัญชียังไม่มีบัญชีเงินฝากธนาคาร — เพิ่มบัญชีเงินฝาก (ประเภทเงินฝากธนาคาร) ที่หน้าผังบัญชีก่อน</div>' });
  }
  const r = bankReconcile(code, STATE.period);
  const st = bankRecStatus(r);
  const key = code + '|' + STATE.period;
  const accSel = '<select id="bankAccSel" class="search" aria-label="บัญชีเงินฝาก">' + bankAccounts().map(function (a) {
    let mark = '';
    try {
      const x = bankReconcile(a.code, STATE.period);
      mark = !bankHasActivity(a.code, pStart(), pEnd()) && !x.start ? '' : x.ok || x.beforeStart ? ' ✓' : ' · ยังไม่ครบ';
    } catch (e) { mark = ''; }
    return '<option value="' + esc(a.code) + '"' + (a.code === code ? ' selected' : '') + '>' + esc(a.code + ' ' + a.name + mark) + '</option>';
  }).join('') + '</select>';
  const rows = bankRecRows(r);
  const stmtTable = '<div class="scroll"><table class="fs"><thead><tr><th>วันที่</th><th>รายการ</th><th>อ้างอิง</th><th class="r">จำนวนเงิน</th><th class="r">ยอดรวม</th></tr></thead><tbody>'
    + rows.map(function (x) {
      const n = (v) => (v === null || v === undefined ? '<td class="num dim">—</td>' : '<td class="num' + (v < 0 ? ' neg' : '') + '">' + fmt(v) + '</td>');
      /* ไม่ใช้ colspan — ตัวส่งออก CSV อ่านทีละช่อง ยอดรวมต้องตกคอลัมน์ "ยอดรวม" ตรงกันทุกแถว */
      if (x.k === 'sp') return '<tr class="sp"><td></td><td></td><td></td><td></td><td></td></tr>';
      if (x.k === 'h2') return '<tr class="fs-h2"><td></td><td>' + esc(x.label) + '</td><td></td><td></td><td></td></tr>';
      if (x.k === 'd') return x.dim ? '<tr><td></td><td class="ind dim">' + esc(x.label) + '</td><td></td><td></td><td></td></tr>'
        : '<tr><td>' + thDateNum(x.date) + '</td><td class="ind">' + esc(x.label) + '</td><td class="mono">' + esc(x.ref || '') + '</td>' + n(x.amt) + '<td></td></tr>';
      const cls = x.k === 'h' ? 'fs-h' : x.k === 's' ? 'fs-s' : 'fs-t';
      return '<tr class="' + cls + '"><td></td><td>' + esc(x.label) + '</td><td></td><td></td>' + n(x.total) + '</tr>';
    }).join('') + '</tbody></table></div>';
  const warn = [];
  if (r.bal && r.bal.gap) {
    warn.push('ยอดยกมา ' + fmt(r.bal.opening) + ' + รายการในสเตทเมนต์ ' + fmt(r.bal.net) + ' = ' + fmt(r.bal.computed)
      + ' แต่ยอดปลายงวดที่กรอกไว้ ' + fmt(r.bal.closing) + ' — สเตทเมนต์ในระบบอาจขาดรายการ ' + fmt(r.bal.gap) + ' บาท');
  }
  const main = card({
    title:'กระทบยอดเงินฝากธนาคาร',
    sub: bankAccLabel(code) + ' · ' + thPeriod(STATE.period) + (r.start ? ' · เริ่มกระทบยอด ' + thPeriod(r.start.slice(0, 7)) : ''),
    actions: btnI('bank:import', 'download', 'นำเข้าสเตทเมนต์', 'primary') + btn('bank:add', '+ กรอกรายการ')
      + btn('bank:bal', 'ยอดตามสเตทเมนต์') + btn('bank:auto', 'จับคู่อัตโนมัติ', r.unrecorded.length ? '' : 'disabled')
      + printBtn('bankRec', key),
    filters: accSel,
    body: '<div class="note' + (st.ok ? '' : ' warn') + '" id="bankStatus"><b>' + (st.ok ? '✓ ' : '') + esc(st.text) + '</b></div>'
      + warn.map((w) => '<div class="note warn">' + esc(w) + '</div>').join('')
      + (r.beforeStart ? '' : stmtTable),
    foot: 'ยอดตามสเตทเมนต์ + เงินฝากระหว่างทาง − เช็คค้างจ่าย ต้องเท่ากับยอดในบัญชี · รายการที่ธนาคารลงไว้ (ดอกเบี้ย ค่าธรรมเนียม) ต้องบันทึกบัญชีก่อนปิดงวด',
  });
  if (r.beforeStart) return main + bankSetupCard(code, r);
  return main + bankWorkCards(code, r) + bankSetupCard(code, r);
}

/** ตารางทำงาน: รายการในสเตทเมนต์ที่ยังไม่ได้บันทึก · รายการในบัญชีที่ยังไม่ขึ้นสเตทเมนต์ · ที่จับคู่แล้ว */
function bankWorkCards(code, r) {
  const open = bankBookItems(code, null).filter((i) => !i.matchId);
  const later = new Set();         // บรรทัดที่จับคู่กับใบสำคัญของเดือนถัดไป — ยังเป็นรายการกระทบยอดของงวดนี้ แต่ไม่ต้องทำอะไรเพิ่ม
  r.unrecorded.forEach((t) => { if (t.matched) later.add(t.id); });
  const hints = function (t) {
    if (t.matched) return { html: '<span class="dim">จับคู่กับ ' + esc(t.matchedTo) + ' (ลงบัญชีหลังสิ้นงวด)</span>' };
    const s = bankSuggest(t, open, 2);
    if (s.length) {
      return { html: s.map((x) => btn('bank:m:' + t.id + ':' + x.key, 'จับคู่ ' + (x.key.indexOf('BF-') === 0 ? 'ค้างยกมา' : x.key) + ' · ' + thDateNum(x.date),
        x === s[0] ? 'primary' : '', ' title="' + esc(x.desc) + '"')).join(' ') };
    }
    const amt = bankNet(t);
    if (amt > 0) {
      const inv = DB.docs.invoice.find((d) => d.status !== 'void' && invOutstanding(d) === amt);
      if (inv) return { html: btn('pay:' + inv.no, 'รับชำระ ' + inv.no, '', ' title="ใบกำกับของ ' + esc(inv.partnerName) + ' ค้างยอดเท่านี้พอดี — รับชำระแล้วกลับมาจับคู่"') };
    } else {
      const bill = DB.docs.bill.find((d) => d.status !== 'void' && billOutstanding(d) === -amt);
      if (bill) return { html: btn('paybill:' + bill.no, 'จ่ายชำระ ' + bill.no, '', ' title="รายการตั้งหนี้ของ ' + esc(bill.partnerName) + ' ค้างยอดเท่านี้พอดี — จ่ายชำระแล้วกลับมาจับคู่"') };
    }
    return { dim: 'ไม่พบรายการยอดเท่ากันในบัญชี' };
  };
  const ck = (attr, amt) => '<input type="checkbox" class="bank-ck" ' + attr + ' data-amt="' + amt + '" aria-label="เลือก">';
  const unrec = card({
    title:'รายการในสเตทเมนต์ที่ยังไม่ได้บันทึกบัญชี',
    sub: r.unrecorded.length + ' รายการ ถึง ' + thDate(r.end) + ' · กดจับคู่กับรายการที่ระบบแนะนำ หรือบันทึกเข้าบัญชีถ้ายังไม่มีในบัญชี',
    body: '<div class="note" id="bankSelBar">เลือกหลายรายการทั้งสองตารางเพื่อจับคู่แบบหนึ่งต่อหลายรายการ (ยอดรวมต้องเท่ากัน) — ยังไม่ได้เลือก</div>'
      + '<div class="scroll"><table class="lines"><thead><tr><th></th><th>วันที่</th><th>รายการจากธนาคาร</th><th>อ้างอิง</th>'
      + '<th class="r">ถอน</th><th class="r">ฝาก</th><th>ระบบแนะนำ</th><th class="r">จัดการ</th></tr></thead><tbody>'
      + (r.unrecorded.length ? r.unrecorded.map(function (t) {
        const h = hints(t);
        return '<tr data-bank-t="' + t.id + '"><td>' + (later.has(t.id) ? '' : ck('data-t="' + t.id + '"', bankNet(t))) + '</td>'
          + '<td>' + thDateNum(t.date) + '</td><td>' + esc(t.desc) + '</td><td class="mono">' + esc(t.ref || '') + '</td>'
          + money(t.debit) + money(t.credit) + cell(h)
          + '<td class="r" style="white-space:nowrap">' + (later.has(t.id) ? btn('bank:unmatch:' + t.matchId, 'ยกเลิกการจับคู่')
            : btn('bank:book:' + t.id, 'บันทึกเข้าบัญชี', 'primary') + btn('bank:pick:' + t.id, 'เลือกรายการ')
              + (t.src === 'demo' ? '' : btn('bank:del:' + t.id, 'ลบ', 'danger'))) + '</td></tr>';
      }).join('') : '<tr><td colspan="8" class="dim">' + (r.start ? 'ไม่มี — ทุกรายการในสเตทเมนต์ถึงสิ้นงวดบันทึกบัญชีหรือจับคู่แล้ว' : 'ยังไม่มีรายการในสเตทเมนต์') + '</td></tr>')
      + '</tbody></table></div>'
      + '<div style="padding:10px 16px">' + btn('bank:msel', 'จับคู่รายการที่เลือก') + '</div>',
  });
  const out = card({
    title:'รายการในบัญชีที่ยังไม่ขึ้นสเตทเมนต์',
    sub: r.outstanding.length + ' รายการ ถึง ' + thDate(r.end) + ' · เงินฝากระหว่างทาง ' + fmt(r.sumDeposits) + ' · เช็คค้างจ่าย ' + fmt(r.sumCheques),
    body: '<div class="scroll"><table class="lines"><thead><tr><th></th><th>วันที่</th><th>ใบสำคัญ</th><th>คำอธิบาย</th>'
      + '<th class="r">เงินเข้า</th><th class="r">เงินออก</th><th>สถานะ</th></tr></thead><tbody>'
      + (r.outstanding.length ? r.outstanding.map(function (i) {
        const bf = i.key.indexOf('BF-') === 0;
        return '<tr data-bank-k="' + esc(i.key) + '"><td>' + (i.matchId ? '' : ck('data-k="' + esc(i.key) + '"', i.amount)) + '</td>'
          + '<td>' + thDateNum(i.date) + '</td><td class="mono">' + (bf ? 'ค้างยกมา' : '<a href="#" data-act="entry:' + esc(i.key) + '">' + esc(i.key) + '</a>') + '</td>'
          + '<td>' + esc(i.desc) + '</td>' + money(i.amount > 0 ? i.amount : 0) + money(i.amount < 0 ? -i.amount : 0)
          + cell(i.matchId ? { dim: 'จับคู่กับสเตทเมนต์เดือนถัดไป' } : { st: i.amount > 0 ? ['wait', 'เงินฝากระหว่างทาง'] : ['open', 'เช็คค้างจ่าย'] }) + '</tr>';
      }).join('') : '<tr><td colspan="7" class="dim">ไม่มี — ทุกรายการในบัญชีขึ้นสเตทเมนต์แล้ว</td></tr>')
      + '</tbody></table></div>',
    foot: 'รายการที่ค้างนานผิดปกติ (เช่น เช็คที่จ่ายเกิน 6 เดือนแล้วยังไม่ถูกนำไปขึ้นเงิน) ควรตรวจกับผู้รับเงิน',
  });
  const from = pStart();
  const done = DB.bankTxns.filter((t) => t.acc === code && t.matched && t.date >= from && t.date <= r.end && !later.has(t.id))
    .slice().sort(bankSortLines);
  const matched = card({
    title:'จับคู่แล้วในงวดนี้', sub: done.length + ' รายการในสเตทเมนต์',
    body: done.length ? '<details class="adv"><summary>ดูรายการที่จับคู่แล้ว ' + done.length + ' รายการ</summary>'
      + tbl({
        cols:[{t:'วันที่'},{t:'รายการจากธนาคาร'},{t:'อ้างอิง'},{t:'ถอน',a:'r'},{t:'ฝาก',a:'r'},{t:'จับคู่กับ'},{t:'',a:'r'}],
        rows: done.map((t) => [thDateNum(t.date), t.desc, {mono:t.ref || ''}, {n:t.debit}, {n:t.credit}, {mono:t.matchedTo || ''},
          {html: btn('bank:unmatch:' + t.matchId, 'ยกเลิกการจับคู่')}]),
      }) + '</details>' : '<div class="empty">ยังไม่มีรายการที่จับคู่ในงวดนี้</div>',
  });
  return unrec + out + matched;
}

/** สเตทเมนต์รายงวด ประวัติการนำเข้า และรายการค้าง ณ วันเริ่มกระทบยอด */
function bankSetupCard(code, r) {
  const recs = DB.bankStmts.filter((x) => x.acc === code).slice().sort((a, b) => (a.period < b.period ? -1 : 1));
  const imps = DB.bankImports.filter((x) => x.acc === code);
  const bfs = DB.bankBf.filter((x) => x.acc === code);
  const per = recs.map(function (x) {
    const b = bankPeriodBalance(code, x.period) || {};
    return [thPeriod(x.period), {n: b.opening === null || b.opening === undefined ? 0 : b.opening}, {c: String(b.count || 0)},
      {n: b.net || 0}, x.closing === null ? {dim:'ยังไม่ได้กรอก'} : {n: x.closing},
      b.gap ? {st:['late', 'ขาด ' + fmt(b.gap)]} : x.closing === null ? {dim:'—'} : {st:['paid', 'ต่อเนื่อง']}];
  });
  return card({
    title:'สเตทเมนต์ · การนำเข้า · รายการค้างยกมา', sub: bankAccLabel(code),
    actions: btn('bank:bf', '+ รายการค้าง ณ วันเริ่ม'),
    body: '<details class="adv"' + (r.start ? '' : ' open') + '><summary>ยอดตามสเตทเมนต์รายงวด (' + recs.length + ' งวด)</summary>'
      + tbl({ cols:[{t:'งวด'},{t:'ยอดยกมา',a:'r'},{t:'รายการ',a:'c'},{t:'ฝาก − ถอน',a:'r'},{t:'ยอดปลายงวดตามสเตทเมนต์',a:'r'},{t:'ความต่อเนื่อง'}],
        rows: per, empty:'ยังไม่มีสเตทเมนต์ — กด "นำเข้าสเตทเมนต์" หรือ "ยอดตามสเตทเมนต์" เพื่อเริ่ม' }) + '</details>'
      + '<details class="adv"><summary>ประวัติการนำเข้าไฟล์ (' + imps.length + ')</summary>'
      + tbl({ cols:[{t:'นำเข้าเมื่อ'},{t:'ไฟล์'},{t:'ช่วงวันที่'},{t:'รายการ',a:'r'},{t:'ข้ามที่ซ้ำ',a:'r'},{t:'',a:'r'}],
        rows: imps.map((x) => [thDate(x.at.slice(0, 10)), x.name, thDateNum(x.from) + ' – ' + thDateNum(x.to), {c:String(x.added)}, {c:String(x.duplicates || 0)},
          x.undone ? {st:['void', 'ยกเลิกแล้ว']} : {html: btn('bank:undoimp:' + x.id, 'ยกเลิกการนำเข้า', 'danger')}]),
        empty:'ยังไม่เคยนำเข้าไฟล์' }) + '</details>'
      + '<details class="adv"' + (bfs.length ? ' open' : '') + '><summary>รายการค้าง ณ วันเริ่มกระทบยอด (' + bfs.length + ')</summary>'
      + '<div class="note">เช็คที่จ่ายก่อนวันเริ่มแต่ธนาคารยังไม่ตัด หรือเงินฝากที่ยังไม่เข้า ณ วันเริ่ม — ใส่ไว้ที่นี่ แล้วจับคู่เมื่อขึ้นสเตทเมนต์</div>'
      + tbl({ cols:[{t:'วันที่'},{t:'รายการ'},{t:'อ้างอิง'},{t:'จำนวนเงิน',a:'r'},{t:'',a:'r'}],
        rows: bfs.map((b) => [thDateNum(b.date), b.desc, {mono: b.entryNo || b.ref || ''}, {n:b.amount}, {html: btn('bank:bfdel:' + b.id, 'ลบ', 'danger')}]),
        empty:'ไม่มี' }) + '</details>',
    foot: 'วันเริ่มกระทบยอด = งวดแรกที่มีสเตทเมนต์ในระบบ · รายการในบัญชีก่อนวันนั้นถือว่ากระทบยอดแล้วนอกระบบ ยกเว้นที่ใส่ไว้เป็นรายการค้าง',
  });
}

/* ---------- แบบฟอร์ม ---------- */
function bankAccField(name, value) {
  return field({ name, label:'บัญชีเงินฝาก', type:'select', wide:true, value, options: bankOptAccounts() });
}

/** นำเข้าไฟล์สเตทเมนต์ — เลือกไฟล์แล้วเห็นตัวอย่างก่อนกดนำเข้า เลือกคอลัมน์เองได้ถ้าระบบเดาไม่ถูก */
function modalBankImport() {
  const I = BANK_IMP;
  const acc0 = (I && I.acc) || bankCurrentAcc();
  let prev = '';
  if (I && I.rows) {
    const st = readBankStatement(I.rows, I.map ? { map: I.map, headerRow: I.headerRow } : null);
    if (!I.map) { I.map = Object.assign({}, st.map); I.headerRow = st.headerRow; }
    const width = I.rows.reduce((m, r) => Math.max(m, r.length), 0);
    const head = I.rows[I.headerRow] || [];
    const colOpts = [['', '— ไม่มี —']].concat(Array.from({ length: width }, (x, i) => [String(i), (i + 1) + ': ' + (cellText(head[i]) || 'คอลัมน์ ' + (i + 1))]));
    const pickCol = (role) => '<div class="fld-w"><label for="f_bm_' + role + '">' + esc(BANK_ROLE_TH[role]) + '</label><select id="f_bm_' + role + '" name="bm_' + role + '" class="bank-map">'
      + colOpts.map((o) => '<option value="' + o[0] + '"' + (I.map[role] !== undefined && String(I.map[role]) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select></div>';
    const have = {};
    DB.bankTxns.filter((t) => t.acc === acc0).forEach((t) => { const k = bankLineKey(t); have[k] = (have[k] || 0) + 1; });
    const seen = {};
    let dup = 0;
    st.lines.forEach((l) => { const k = bankLineKey(l); seen[k] = (seen[k] || 0) + 1; if (seen[k] <= (have[k] || 0)) dup++; });
    const sumW = st.lines.reduce((s, l) => s + l.debit, 0), sumD = st.lines.reduce((s, l) => s + l.credit, 0);
    const bad = st.skipped.filter((s) => s.bad);
    prev = '<div class="sub-h">ไฟล์ ' + esc(I.name) + '</div>'
      + '<div class="flds">' + ['date', 'desc', 'ref', 'debit', 'credit', 'amount', 'balance'].map(pickCol).join('')
      + '<div class="fld-w"><label for="f_bm_head">แถวหัวตาราง</label><input id="f_bm_head" name="bm_head" class="bank-map" type="number" min="1" value="' + (I.headerRow + 1) + '"></div></div>'
      + (st.ok ? '<div class="note">อ่านได้ ' + st.lines.length + ' รายการ'
          + (st.lines.length ? ' · ' + thDate(st.lines[0].date) + ' ถึง ' + thDate(st.lines[st.lines.length - 1].date) : '')
          + ' · ถอนรวม ' + fmt(sumW) + ' · ฝากรวม ' + fmt(sumD)
          + (st.opening ? ' · ยอดยกมาในไฟล์ ' + fmt(st.opening.amount) : '')
          + (st.reversed ? ' · ไฟล์เรียงใหม่ไปเก่า ระบบกลับลำดับให้แล้ว' : '') + '</div>'
        : '<div class="note warn">หาคอลัมน์วันที่และจำนวนเงินไม่เจอ — เลือกคอลัมน์ด้านบนเอง (ต้องมีวันที่ และถอน/ฝาก หรือจำนวนเงินคอลัมน์เดียว)</div>')
      + (dup ? '<div class="note warn">มี ' + dup + ' รายการที่นำเข้าไว้แล้วในบัญชีนี้ — ระบบจะข้ามให้ นำเข้าเฉพาะรายการใหม่</div>' : '')
      + (bad.length ? '<div class="note warn">อ่านไม่ออก ' + bad.length + ' แถว: ' + esc(bad.slice(0, 4).map((b) => 'แถว ' + b.line + ' ' + b.why).join(' · ')) + '</div>' : '')
      + tbl({ cols:[{t:'แถว',a:'r'},{t:'วันที่'},{t:'รายการ'},{t:'อ้างอิง'},{t:'ถอน',a:'r'},{t:'ฝาก',a:'r'},{t:'คงเหลือ',a:'r'}],
          rows: st.lines.slice(0, 8).map((l) => [{c:String(l.line)}, thDateNum(l.date), l.desc, {mono:l.ref}, {n:l.debit}, {n:l.credit},
            l.balance === null ? {dim:'—'} : {n:l.balance}]),
          empty:'ยังไม่มีรายการที่อ่านได้' })
      + (st.lines.length > 8 ? '<div class="dim" style="padding:4px 2px">… และอีก ' + (st.lines.length - 8) + ' รายการ</div>' : '');
  }
  modal({
    title:'นำเข้าสเตทเมนต์ธนาคาร',
    sub:'ไฟล์ .csv หรือ .xlsx ที่ดาวน์โหลดจากอินเทอร์เน็ตแบงก์กิ้ง — หัวตาราง วันที่ / รายการ / ถอน / ฝาก / คงเหลือ (หรือ Date / Description / Withdrawal / Deposit / Balance)',
    body: '<div class="flds">' + bankAccField('bimpacc', acc0)
      + '<div class="fld-w wide"><label for="bankFile">ไฟล์สเตทเมนต์</label><input type="file" id="bankFile" accept=".csv,.txt,.xlsx,.xls"></div></div>'
      + prev,
    submitLabel:'นำเข้า',
    note:'รายการที่นำเข้าไว้แล้วจะถูกข้าม · วันที่ พ.ศ. หรือ ค.ศ. ก็ได้',
    onSubmit: function () {
      if (!BANK_IMP || !BANK_IMP.rows) { toast('ยังไม่ได้เลือกไฟล์', 'err', 'เลือกไฟล์สเตทเมนต์ .csv หรือ .xlsx ก่อน'); return; }
      submitAction(function () {
        const acc = val('bimpacc');
        const res = importBankStatement(acc, BANK_IMP.rows, { map: BANK_IMP.map, headerRow: BANK_IMP.headerRow, name: BANK_IMP.name });
        BANK_IMP = null;
        STATE.screen = 'bank'; STATE.bankAcc = acc; STATE.sel = null;
        const last = res.imp.to ? periodOf(res.imp.to) : STATE.period;
        if (DB.periods.some((p) => p.code === last)) STATE.period = last;
        const auto = bankAutoMatch(acc, null);
        toast('นำเข้า ' + res.added + ' รายการแล้ว' + (auto.matched ? ' · จับคู่ให้อัตโนมัติ ' + auto.matched + ' รายการ' : ''), 'ok',
          res.warnings.join(' · ') || 'ตรวจรายการที่เหลือในหน้ากระทบยอด');
        return res;
      });
    },
  });
}
async function bankReadFile(file) {
  const lower = file.name.toLowerCase();
  try {
    if (lower.endsWith('.xls')) {
      throw new DomainError('XLS_OLD_FORMAT', 'ไฟล์ .xls เป็นรูปแบบ Excel รุ่นเก่า ระบบอ่านไม่ได้',
        'เปิดไฟล์ใน Excel แล้วสั่ง Save As เป็น .xlsx หรือ CSV แล้วเลือกไฟล์ใหม่');
    }
    const buf = await file.arrayBuffer();
    const rows = lower.endsWith('.xlsx') ? await readXlsx(buf) : parseCsv(decodeText(buf));
    if (!rows.length) throw new DomainError('EMPTY_FILE', 'ไฟล์นี้ไม่มีข้อมูล');
    BANK_IMP = { name: file.name, rows, map: null, headerRow: 0, acc: val('bimpacc') || bankCurrentAcc() };
  } catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('อ่านไฟล์ไม่ได้', 'err', e.message); }
    return;
  }
  modalBankImport();
}

/** กรอกรายการจากสเตทเมนต์เอง — สเตทเมนต์กระดาษหรือรายการไม่กี่บรรทัด */
function modalBankAdd() {
  const code = bankCurrentAcc();
  const n = 8;
  let rows = '';
  for (let i = 0; i < n; i++) {
    rows += '<tr><td><input type="date" name="bl' + i + '_date"' + (i === 0 ? ' value="' + defaultDate() + '"' : '') + '></td>'
      + '<td><input name="bl' + i + '_desc" placeholder="' + (i === 0 ? 'เช่น ค่าธรรมเนียมโอนเงิน' : '') + '"></td>'
      + '<td><input name="bl' + i + '_ref"></td>'
      + '<td><input name="bl' + i + '_debit" class="r" inputmode="decimal"></td>'
      + '<td><input name="bl' + i + '_credit" class="r" inputmode="decimal"></td></tr>';
  }
  modal({
    title:'กรอกรายการจากสเตทเมนต์', sub:'ถอน = เงินออกจากบัญชี · ฝาก = เงินเข้าบัญชี · บรรทัดที่ไม่มีจำนวนเงินจะถูกข้าม',
    body:'<div class="flds">' + bankAccField('baddacc', code) + '</div>'
      + '<div class="scroll"><table class="lines"><thead><tr><th>วันที่</th><th>รายการ</th><th>อ้างอิง</th><th class="r">ถอน</th><th class="r">ฝาก</th></tr></thead><tbody>'
      + rows + '</tbody></table></div><input type="hidden" name="blcount" value="' + n + '">',
    submitLabel:'บันทึกรายการ',
    note:'ยังไม่ลงบัญชี — จับคู่หรือบันทึกเข้าบัญชีได้ที่หน้ากระทบยอด',
    onSubmit: function () {
      submitAction(function () {
        const lines = [];
        for (let i = 0; i < Number(val('blcount')); i++) {
          const d = val('bl' + i + '_debit').trim(), c = val('bl' + i + '_credit').trim();
          if (!d && !c) continue;
          lines.push({ date: val('bl' + i + '_date'), desc: val('bl' + i + '_desc'), ref: val('bl' + i + '_ref'), debit: d, credit: c });
        }
        const acc = val('baddacc');
        const made = addBankLines(acc, lines);
        STATE.bankAcc = acc; STATE.screen = 'bank'; STATE.sel = null;
        toast('เพิ่ม ' + made.length + ' รายการในสเตทเมนต์แล้ว', 'ok', 'จับคู่หรือบันทึกเข้าบัญชีได้ที่ตารางด้านล่าง');
        return made;
      });
    },
  });
}

/** ยอดยกมาและยอดคงเหลือปลายงวดตามสเตทเมนต์ — ยอดปลายงวดคือยอดที่พิมพ์อยู่ท้ายสเตทเมนต์จริง */
function modalBankBal() {
  const code = bankCurrentAcc();
  const rec = bankStmtRec(code, STATE.period);
  const b = bankPeriodBalance(code, STATE.period);
  const fmtIn = (v) => (v === null || v === undefined ? '' : fmt(v));
  const hint = b && b.opening !== null ? 'ยกมา ' + fmt(b.opening) + ' + รายการในสเตทเมนต์ ' + fmt(b.net) + ' = ' + fmt(b.opening + b.net) : '';
  modal({
    title:'ยอดตามสเตทเมนต์ ' + thPeriod(STATE.period), sub: bankAccLabel(code),
    body:'<div class="flds">'
      + field({ name:'bopen', label:'ยอดยกมาต้นงวดตามสเตทเมนต์', value: fmtIn(rec && rec.opening !== null ? rec.opening : b ? b.opening : null),
          hint: rec && rec.opening !== null ? 'กรอกไว้แล้ว' : b && b.openFrom === 'prev' ? 'ยกมาจากยอดปลายงวดก่อน — เว้นว่างได้' : 'จำเป็นเฉพาะงวดแรกที่เริ่มกระทบยอด' })
      + field({ name:'bclose', label:'ยอดคงเหลือปลายงวดตามสเตทเมนต์', value: fmtIn(rec ? rec.closing : null),
          hint: hint || 'ยอดที่พิมพ์อยู่บรรทัดสุดท้ายของสเตทเมนต์เดือนนี้' })
      + '</div>',
    submitLabel:'บันทึกยอด',
    note:'ยอดเงินเบิกเกินบัญชีใส่เป็นตัวเลขติดลบ',
    onSubmit: function () {
      submitAction(function () {
        const opening = val('bopen').trim();
        const typed = parseAmount(opening);
        /* ยอดยกมาที่ระบบเติมให้จากยอดปลายงวดก่อน ไม่บันทึกซ้ำเป็นตัวเลขตายตัว — ถ้างวดก่อนแก้ยอด งวดนี้จะตามไปเอง */
        const inherited = b && b.openFrom === 'prev' && !(rec && rec.opening !== null) && typed !== null && satangOf(typed) === b.opening;
        const r = setBankStatement({ acc: code, period: STATE.period,
          opening: opening === '' || inherited ? null : opening, closing: val('bclose') });
        toast('บันทึกยอดตามสเตทเมนต์แล้ว', 'ok', r.closing === null ? 'ยังไม่ได้กรอกยอดปลายงวด' : 'ยอดปลายงวด ' + fmt(r.closing) + ' บาท');
        return r;
      });
    },
  });
}

/** บัญชีที่เลือกเป็นคู่ได้ — ไม่รวมบัญชีคุม (ต้องมาจากเอกสาร) และบัญชีเงินฝากเดียวกัน
    เงินสด/เงินฝากอื่นแยกไว้กลุ่มบน = โอนระหว่างบัญชีของบริษัท */
function bankCounterSelect(code, value) {
  const ok = DB.accounts.filter((a) => a.postable && a.code !== code && !CONTROL_SUBS[a.subType]);
  const own = ok.filter((a) => CASH_SUB.indexOf(a.subType) >= 0), other = ok.filter((a) => CASH_SUB.indexOf(a.subType) < 0);
  const o = (a) => '<option value="' + esc(a.code) + '"' + (a.code === value ? ' selected' : '') + '>' + esc(a.code + ' ' + a.name) + '</option>';
  return '<div class="fld-w wide"><label for="f_acc">บันทึกคู่กับบัญชี</label><select id="f_acc" name="acc">'
    + '<optgroup label="รายได้ ค่าใช้จ่าย และบัญชีอื่น">' + other.map(o).join('') + '</optgroup>'
    + '<optgroup label="โอนระหว่างบัญชีของบริษัท">' + own.map(o).join('') + '</optgroup></select>'
    + '<div class="fld-hint">ลูกหนี้ เจ้าหนี้ ภาษีซื้อ/ขาย เลือกไม่ได้ — เงินจากลูกค้าให้รับชำระที่ใบกำกับ จ่ายผู้ขายให้จ่ายชำระที่รายการตั้งหนี้ แล้วกลับมาจับคู่</div></div>';
}
function bankGuessCounter(t) {
  const text = String(t.desc + ' ' + (t.ref || '')).toUpperCase();
  const tryAcc = (sub) => { try { return accBySub(sub); } catch (e) { return ''; } };
  if (/INT|ดอกเบี้ย/.test(text) && t.credit > 0) return tryAcc('interest_income');
  if (t.credit > 0) return tryAcc('interest_income') || tryAcc('other_income');
  return tryAcc('finance_cost') || tryAcc('admin_expense');
}
/** บันทึกรายการในสเตทเมนต์ที่ยังไม่มีในบัญชี — ลงบัญชีเงินฝากนี้ และจับคู่ให้ทันที */
function modalBankBook(id) {
  const t = DB.bankTxns.find((x) => String(x.id) === String(id));
  if (!t) return;
  const deposit = bankNet(t) > 0;
  modal({
    title:'บันทึกรายการจากสเตทเมนต์',
    sub: bankAccLabel(t.acc) + ' · ' + thDate(t.date) + ' · ' + t.desc + ' · ' + (deposit ? 'เงินเข้า ' + fmt(t.credit) : 'เงินออก ' + fmt(t.debit)),
    body:'<div class="flds">'
      + bankCounterSelect(t.acc, bankGuessCounter(t))
      + field({ name:'bdesc', label:'คำอธิบายรายการ', wide:true, value: t.desc })
      + field({ name:'bdate', label:'วันที่ลงบัญชี', type:'date', value: t.date,
          hint: 'ตามวันที่ในสเตทเมนต์ — งวดนั้นปิดแล้วให้เลือกวันในงวดที่เปิดอยู่' })
      + (deposit ? field({ name:'bwht', label:'ภาษีถูกหัก ณ ที่จ่าย (ถ้ามี)', placeholder:'เช่น ดอกเบี้ยรับที่ธนาคารหักไว้ 1%',
          hint:'ระบบบันทึกรายได้เต็มจำนวน และภาษีที่ถูกหักเป็นเครดิตภาษี' }) : '')
      + '</div>',
    submitLabel:'ลงบัญชีและจับคู่',
    note:'ลงบัญชีเงินฝาก ' + t.acc + ' แล้วจับคู่ให้ทันที',
    onSubmit: function () {
      submitAction(function () {
        const counter = val('acc');
        const je = bookBankTxn(t.id, { account: counter, desc: val('bdesc'), date: val('bdate'), wht: val('bwht') || null });
        const mate = DB.bankTxns.some((x) => x.acc === counter && x.matched && (x.items || []).indexOf(je.no) >= 0);
        toast('ลงบัญชีเป็นใบสำคัญ ' + je.no + ' แล้ว', 'ok',
          'รายการนี้จับคู่เรียบร้อย' + (mate ? ' · จับคู่ฝั่งบัญชี ' + counter + ' ให้ด้วย' : ''));
        return je;
      });
    },
  });
}

/** เลือกใบสำคัญในบัญชีเองสำหรับบรรทัดสเตทเมนต์หนึ่งบรรทัด — เลือกหลายใบได้เมื่อธนาคารรวมยอดมาเป็นบรรทัดเดียว */
function modalBankPick(id) {
  const t = DB.bankTxns.find((x) => String(x.id) === String(id));
  if (!t) return;
  const amt = bankNet(t);
  const day = (d) => Math.abs(Date.parse(d) - Date.parse(t.date));
  const open = bankBookItems(t.acc, null).filter((i) => !i.matchId && Math.sign(i.amount) === Math.sign(amt))
    .sort((a, b) => (a.amount === amt) === (b.amount === amt) ? day(a.date) - day(b.date) : a.amount === amt ? -1 : 1).slice(0, 60);
  modal({
    title:'เลือกรายการในบัญชีที่ตรงกับสเตทเมนต์',
    sub: thDate(t.date) + ' · ' + t.desc + ' · ' + (amt > 0 ? 'เงินเข้า ' : 'เงินออก ') + fmt(Math.abs(amt)),
    body: open.length ? '<div class="scroll"><table class="lines"><thead><tr><th></th><th>วันที่</th><th>ใบสำคัญ</th><th>คำอธิบาย</th><th class="r">จำนวนเงิน</th></tr></thead><tbody>'
      + open.map((i) => '<tr><td><input type="checkbox" class="bank-pk" name="bpk" value="' + esc(i.key) + '" data-amt="' + i.amount + '"></td>'
        + '<td>' + thDateNum(i.date) + '</td><td class="mono">' + esc(i.key.indexOf('BF-') === 0 ? 'ค้างยกมา' : i.key) + '</td><td>' + esc(i.desc) + '</td>'
        + money(Math.abs(i.amount)) + '</tr>').join('')
      + '</tbody></table></div><div class="note" id="bankPickSum" data-want="' + amt + '">เลือกแล้ว 0.00 จาก ' + fmt(Math.abs(amt)) + '</div>'
      : '<div class="empty">ไม่มีรายการในบัญชีที่ยังไม่จับคู่ฝั่งเดียวกัน — กด "บันทึกเข้าบัญชี" แทน</div>',
    submitLabel: open.length ? 'จับคู่' : null,
    onSubmit: function () {
      submitAction(function () {
        const keys = Array.from(document.querySelectorAll('input.bank-pk:checked')).map((x) => x.value);
        const m = matchBank(t.acc, [t.id], keys);
        toast('จับคู่แล้ว', 'ok', 'สเตทเมนต์ 1 รายการ กับใบสำคัญ ' + m.keys.join(', '));
        return m;
      });
    },
  });
}

/** รายการค้าง ณ วันเริ่มกระทบยอด — เลือกจากใบสำคัญก่อนวันเริ่ม หรือกรอกเอง (เช็คจากระบบเดิม) */
function modalBankBf() {
  const code = bankCurrentAcc();
  const start = bankStartDate(code);
  const already = new Set(DB.bankBf.filter((b) => b.acc === code && b.entryNo).map((b) => b.entryNo));
  const cands = start ? DB.entries.filter((e) => LIVE(e) && e.date < start && e.date >= addDays(start, -120)
    && !isOpeningEntry(e) && !isImportEntry(e) && bankEntryNet(e, code) !== 0 && !already.has(e.no))
    .sort((a, b) => (a.date > b.date ? -1 : 1)).slice(0, 80) : [];
  modal({
    title:'รายการค้าง ณ วันเริ่มกระทบยอด', sub: bankAccLabel(code) + (start ? ' · เริ่ม ' + thDate(start) : ' · ยังไม่มีสเตทเมนต์'),
    body:(cands.length ? '<div class="sub-h">เลือกจากใบสำคัญก่อนวันเริ่มที่ธนาคารยังไม่ตัด/ยังไม่เข้า</div>'
        + '<div class="scroll"><table class="lines"><thead><tr><th></th><th>วันที่</th><th>ใบสำคัญ</th><th>คำอธิบาย</th><th class="r">เงินเข้า (ออก)</th></tr></thead><tbody>'
        + cands.map((e) => '<tr><td><input type="checkbox" name="bbfe" value="' + esc(e.no) + '"></td><td>' + thDateNum(e.date) + '</td><td class="mono">'
          + esc(e.no) + '</td><td>' + esc(e.desc) + '</td>' + money(bankEntryNet(e, code)) + '</tr>').join('') + '</tbody></table></div>' : '')
      + '<div class="sub-h">หรือกรอกเอง (รายการจากระบบเดิม)</div><div class="flds">'
      + field({ name:'bbfkind', label:'ชนิด', type:'select', value:'cheque', options:[['cheque', 'เช็คค้างจ่าย (เงินออก)'], ['deposit', 'เงินฝากระหว่างทาง (เงินเข้า)']] })
      + field({ name:'bbfdate', label:'วันที่', type:'date', value: start ? addDays(start, -1) : '' })
      + field({ name:'bbfref', label:'เลขที่เช็ค/อ้างอิง' })
      + field({ name:'bbfamt', label:'จำนวนเงิน' })
      + field({ name:'bbfdesc', label:'คำอธิบาย', wide:true, placeholder:'เช่น เช็คจ่ายบริษัท ก. ลงวันที่ 28 มิ.ย.' })
      + '</div>',
    submitLabel:'เพิ่มรายการค้าง',
    note:'รายการค้างไม่ลงบัญชีซ้ำ ใช้อธิบายส่วนต่างระหว่างยอดยกมาตามสเตทเมนต์กับยอดในบัญชี ณ วันเริ่ม',
    onSubmit: function () {
      submitAction(function () {
        return atomically(function () {
          const made = [];
          document.querySelectorAll('input[name="bbfe"]:checked').forEach((x) => made.push(addBankBf({ acc: code, entryNo: x.value })));
          if (val('bbfamt').trim()) {
            made.push(addBankBf({ acc: code, kind: val('bbfkind'), date: val('bbfdate'), ref: val('bbfref'), amount: val('bbfamt'), desc: val('bbfdesc') }));
          }
          if (!made.length) throw new DomainError('BANK_BF_EMPTY', 'ยังไม่ได้เลือกหรือกรอกรายการ');
          toast('เพิ่มรายการค้าง ' + made.length + ' รายการแล้ว', 'ok', 'จับคู่กับสเตทเมนต์ได้เมื่อธนาคารตัด/เข้าบัญชี');
          return made;
        });
      });
    },
  });
}

/* ---------- เลือกหลายรายการบนหน้าจอ ---------- */
function bankSelected() {
  const pick = (sel, attr) => Array.from(document.querySelectorAll(sel)).map((x) => ({ id: x.getAttribute(attr), amt: Number(x.getAttribute('data-amt')) }));
  return { t: pick('input.bank-ck[data-t]:checked', 'data-t'), k: pick('input.bank-ck[data-k]:checked', 'data-k') };
}
function bankRefreshSel() {
  const bar = document.getElementById('bankSelBar');
  if (!bar) return;
  const s = bankSelected();
  const st = s.t.reduce((a, x) => a + x.amt, 0), sk = s.k.reduce((a, x) => a + x.amt, 0);
  bar.className = 'note' + (s.t.length && (s.k.length || s.t.length > 1) && st === sk ? '' : ' warn');
  bar.innerHTML = s.t.length + s.k.length === 0
    ? 'เลือกหลายรายการทั้งสองตารางเพื่อจับคู่แบบหนึ่งต่อหลายรายการ (ยอดรวมต้องเท่ากัน) — ยังไม่ได้เลือก'
    : '<b>เลือกแล้ว</b> สเตทเมนต์ ' + s.t.length + ' รายการ ' + esc(fmt(st)) + ' · บัญชี ' + s.k.length + ' รายการ ' + esc(fmt(sk))
      + ' · ' + (st === sk ? 'ยอดเท่ากัน กด "จับคู่รายการที่เลือก" ได้' : 'ต่างกัน ' + esc(fmt(st - sk)));
}

/* ---------- ตัวรับเหตุการณ์ ---------- */
EXTRA_DISPATCH.push(function (head, rest) {
  if (head !== 'bank') return false;
  const what = rest[0], arg = rest[1];
  const code = bankCurrentAcc();
  if (what === 'import') { BANK_IMP = null; modalBankImport(); return true; }
  if (what === 'add') { modalBankAdd(); return true; }
  if (what === 'bal') { modalBankBal(); return true; }
  if (what === 'bf') { modalBankBf(); return true; }
  if (what === 'book') { modalBankBook(arg); return true; }
  if (what === 'pick') { modalBankPick(arg); return true; }
  if (what === 'auto') {
    runAction(function () {
      const r = bankAutoMatch(code, pEnd());
      toast(r.matched ? 'จับคู่อัตโนมัติ ' + r.matched + ' รายการ' : 'ไม่มีคู่ที่แน่ใจพอจะจับให้อัตโนมัติ', r.matched ? 'ok' : 'err',
        r.left ? 'เหลือ ' + r.left + ' รายการ — เลือกจับคู่เองหรือบันทึกเข้าบัญชี' : 'ครบทุกรายการ');
    });
    return true;
  }
  if (what === 'm') {
    runAction(function () {
      const m = matchBank(code, [arg], [rest.slice(2).join(':')]);
      toast('จับคู่แล้ว', 'ok', 'กับ ' + m.keys.join(', '));
    });
    return true;
  }
  if (what === 'msel') {
    const s = bankSelected();
    runAction(function () {
      const m = matchBank(code, s.t.map((x) => x.id), s.k.map((x) => x.id));
      toast('จับคู่แล้ว', 'ok', 'สเตทเมนต์ ' + m.txns.length + ' รายการ กับบัญชี ' + m.keys.length + ' รายการ รวม ' + fmt(m.amount) + ' บาท');
    });
    return true;
  }
  if (what === 'unmatch') {
    runAction(function () { const l = unmatchBank(arg); toast('ยกเลิกการจับคู่แล้ว', 'ok', l.length + ' รายการกลับไปรอกระทบยอด'); });
    return true;
  }
  if (what === 'del') {
    if (!window.confirm('ลบรายการนี้ออกจากสเตทเมนต์ในระบบ?')) return true;
    runAction(function () { deleteBankLine(arg); toast('ลบรายการแล้ว', 'ok'); });
    return true;
  }
  if (what === 'undoimp') {
    if (!window.confirm('ยกเลิกการนำเข้าไฟล์นี้ — รายการทั้งหมดจากไฟล์จะถูกลบออกจากสเตทเมนต์ในระบบ?')) return true;
    runAction(function () { const imp = undoBankImport(arg); toast('ยกเลิกการนำเข้า ' + imp.name + ' แล้ว', 'ok', 'ลบ ' + imp.added + ' รายการ'); });
    return true;
  }
  if (what === 'bfdel') {
    runAction(function () { deleteBankBf(arg); toast('ลบรายการค้างแล้ว', 'ok'); });
    return true;
  }
  return false;
});
EXTRA_CHANGE.push(function (t) {
  if (t.id === 'bankAccSel') { STATE.bankAcc = t.value; render(); return true; }
  if (t.id === 'bankFile') { if (t.files && t.files[0]) bankReadFile(t.files[0]); return true; }
  if (t.classList && t.classList.contains('bank-map') && BANK_IMP) {
    const m = {};
    ['date', 'desc', 'ref', 'debit', 'credit', 'amount', 'balance'].forEach(function (k) {
      const v = val('bm_' + k);
      if (v !== '') m[k] = Number(v);
    });
    BANK_IMP.map = m;
    BANK_IMP.headerRow = Math.max(0, (Number(val('bm_head')) || 1) - 1);
    BANK_IMP.acc = val('bimpacc');
    modalBankImport();
    return true;
  }
  if (t.name === 'bimpacc' && BANK_IMP) { BANK_IMP.acc = t.value; modalBankImport(); return true; }
  if (t.classList && t.classList.contains('bank-ck')) { bankRefreshSel(); return true; }
  if (t.classList && t.classList.contains('bank-pk')) {
    const box = document.getElementById('bankPickSum');
    if (box) {
      const sum = Array.from(document.querySelectorAll('input.bank-pk:checked')).reduce((s, x) => s + Number(x.getAttribute('data-amt')), 0);
      const want = Number(box.getAttribute('data-want'));
      box.className = 'note' + (sum === want ? '' : ' warn');
      box.textContent = 'เลือกแล้ว ' + fmt(Math.abs(sum)) + ' จาก ' + fmt(Math.abs(want)) + (sum === want ? ' — ยอดเท่ากัน' : ' — ต่างกัน ' + fmt(Math.abs(want - sum)));
    }
    return true;
  }
  return false;
});

/* ---------- ลงทะเบียนหน้าจอ เมนูสร้างเอกสาร และแบบพิมพ์ ---------- */
SCREENS.bank = scBankRec;
PAGE_INFO.bank = { d:'เทียบสเตทเมนต์ธนาคารกับบัญชีเงินฝากทีละบัญชี — จับคู่รายการ บันทึกค่าธรรมเนียมและดอกเบี้ยที่ธนาคารลงไว้ จนผลต่างเป็นศูนย์',
  je:[['dr', 'เงินฝากธนาคาร (เงินเข้า)'], ['cr', 'เงินฝากธนาคาร (เงินออก)']], book:'สมุดรายวันรับ / จ่าย' };
CREATE_MENU.push({ s:'ธนาคาร', icon:'bank', items:[
  ['bank:import', 'นำเข้าสเตทเมนต์'], ['bank:add', 'กรอกรายการจากสเตทเมนต์'],
] });
DOC_PRINT.bankRec = {
  title:'งบกระทบยอดเงินฝากธนาคาร',
  find: function (key) {
    const p = String(key || '').split('|');
    try { return p.length === 2 && /^\d{4}-\d{2}$/.test(p[1]) ? bankReconcile(p[0], p[1]) : null; } catch (e) { return null; }
  },
  build: function (r) {
    const rows = bankRecRows(r);
    const st = bankRecStatus(r);
    const n = (v) => (v === null || v === undefined ? '—' : pm(v));
    const body = rows.filter((x) => x.k !== 'sp').map(function (x) {
      if (x.k === 'h2') return ['', x.label, '', '', ''];
      if (x.k === 'd') return x.dim ? ['', '    ' + x.label, '', '', ''] : [thDateNum(x.date), '    ' + x.label, x.ref || '', n(x.amt), ''];
      return ['', x.label, '', '', n(x.total)];
    });
    return pSheet(pHead('งบกระทบยอดเงินฝากธนาคาร', 'BANK RECONCILIATION STATEMENT')
      + '<div class="p-meta">' + pInfo([['บัญชี', r.acc + ' ' + r.name], ['ณ วันที่', thDate(r.end)], ['งวด', thPeriod(r.period)]])
      + pInfo([['ยอดตามสเตทเมนต์', n(r.stmt)], ['ยอดตามบัญชี', pm(r.book)], ['ผลต่าง', n(r.diff)]]) + '</div>'
      + pTable([{ t:'วันที่', w:'22mm', c:1 }, { t:'รายการ' }, { t:'อ้างอิง', w:'30mm' }, { t:'จำนวนเงิน', w:'28mm', n:1 }, { t:'ยอดรวม', w:'30mm', n:1 }], body)
      + '<div class="p-note">' + esc((st.ok ? 'สถานะ: ' : 'สถานะ: ') + st.text) + '</div>'
      + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ']), 'BR-' + r.acc + '-' + r.period, '');
  },
};
