/* ===================================================================
   หน้าจอ แบบฟอร์ม และเอกสารพิมพ์ของระบบเงินเดือน (payroll.js)
   - งวดจ่ายเงินเดือน: แผ่นงานแก้ได้ก่อนลงบัญชี งวดนอกรอบ ยกเลิกแล้วแก้ทำใหม่
   - ทะเบียนพนักงาน: วันพ้นสภาพ ที่อยู่ ค่าลดหย่อน กองทุน ยอดสะสมก่อนเริ่มใช้ระบบ
   - ภ.ง.ด.1 · สปส.1-10 · นำส่ง และสรุปทั้งปี · ภ.ง.ด.1ก · 50 ทวิ
   - เอกสารพิมพ์: สลิปเงินเดือน ใบแนบ ภ.ง.ด.1 ใบแนบ ภ.ง.ด.1ก 50 ทวิ พนักงาน สปส.1-10
   ตรรกะทั้งหมดอยู่ใน payroll.js หน้านี้แค่แสดงและรับค่า
   =================================================================== */
const payRunKey = (r) => r.no || r.entryNo;
const payRunByKey = (k) => DB.docs.payRun.find((r) => payRunKey(r) === k) || null;
const payAccName = (code) => { const a = DB.accounts.find((x) => x.code === code); return a ? a.code + ' ' + a.name : (code || '—'); };
const payAccOpts = () => payFromAccounts().map((a) => [a.code, a.code + ' ' + a.name]);
/** จำนวนเงินสเกล 4 ตำแหน่ง → ข้อความในช่องกรอก (ไม่มีจุลภาค ไม่มีศูนย์ท้าย) */
const payNum = (v) => (v ? unM(v).replace(/\.?0+$/, '') : '');
const payDraftById = (id) => payDraftFind(id) || (/^R\|\d{4}-\d{2}$/.test(id || '') ? payDraft(id.slice(2)) : null);
const payRunTitle = (r) => (r.kind === 'offcycle' ? (r.label || 'จ่ายนอกรอบ') + ' ' + thPeriod(r.period) : 'เงินเดือนงวด ' + thPeriod(r.period));
/** เงินได้อื่นนอกจากเงินเดือนและค่าล่วงเวลา (สลิปรุ่นก่อนมีแค่สองอย่างนี้) */
const slipOther = (s) => s.gross - (s.salary - (s.unpaid || 0)) - (s.ot || 0);

/* ===================================================================
   งวดจ่ายเงินเดือน
   =================================================================== */
function scPayroll() {
  const period = STATE.period;
  const runs = DB.docs.payRun.filter((r) => r.period === period);
  const live = runs.filter(runIsLive);
  const sel = STATE.sel ? payRunByKey(STATE.sel) : null;
  const shown = sel && sel.period === period ? sel : live[0] || null;
  let h = payMonthCard(period, runs, live, shown);
  if (shown) h += payRunCard(shown);
  if (!activeRegularRun(period)) h += paySheetCard(payDraft(period));
  payDraftsOf(period).filter((d) => d.kind !== 'regular').forEach((d) => { h += paySheetCard(d); });
  return h;
}

/** การ์ดสรุปของเดือน — ทุกรอบที่จ่าย (งวดปกติ นอกรอบ ที่ยกเลิก) */
function payMonthCard(period, runs, live, shown) {
  const open = periodIsOpen();
  const sum = (k) => live.reduce((s, r) => s + (r[k] || 0), 0);
  const people = new Set();
  live.forEach((r) => r.slips.forEach((s) => people.add(s.code)));
  const voided = runs.filter((r) => !runIsLive(r));
  return card({
    title:'งวดจ่ายเงินเดือน', sub: thPeriod(period) + (live.length ? ' · จ่ายแล้ว ' + live.length + ' รอบ' : ' · ยังไม่ได้จ่าย'),
    actions: btn('paydraft:new', '+ จ่ายนอกรอบ (โบนัส ค่าคอมมิชชั่น เงินชดเชย)', open ? '' : 'disabled')
      + btn('go:attendance', 'ขาด ลา มาสาย') + btn('go:payrollfile', 'ภ.ง.ด.1 · สปส.1-10 · นำส่ง') + btn('paysettings', 'ตั้งค่า'),
    body: (live.length ? kpi([
        { label:'พนักงานที่ได้รับเงิน', value: people.size + ' คน' },
        { label:'เงินได้รวม', value: fmt(sum('gross')) },
        { label:'ภาษีหัก ณ ที่จ่าย', value: fmt(sum('pit')), sub:'นำส่งใน ภ.ง.ด.1 ตามเดือนที่จ่าย' },
        { label:'ประกันสังคมนำส่ง', value: fmt(sum('ssoEmp') + sum('ssoEr')), sub:'ลูกจ้าง ' + fmt(sum('ssoEmp')) + ' · นายจ้าง ' + fmt(sum('ssoEr')) },
        { label:'จ่ายสุทธิ', value: fmt(sum('net')) },
      ]) : '')
      + (runs.length ? tbl({
        cols:[{t:'เลขที่'},{t:'รอบ'},{t:'วันที่จ่าย'},{t:'จ่ายจาก'},{t:'คน',a:'r'},{t:'เงินได้',a:'r'},{t:'ภาษีหัก',a:'r'},{t:'จ่ายสุทธิ',a:'r'},{t:'สถานะ'}],
        rows: runs.map((r) => [{mono: payRunKey(r)}, r.kind === 'offcycle' ? r.label : 'เงินเดือนประจำงวด', thDateNum(r.date),
          payAccName(r.payFrom), {c:String(r.count)}, {n:r.gross}, {n:r.pit}, {n:r.net},
          runIsLive(r) ? {st:['paid', shown === r ? 'กำลังดู' : 'ลงบัญชีแล้ว']} : {st:['void','ยกเลิก']}]),
        rowAttr: (row, i) => rowCls(runs[i]) + ' data-act="payrun:' + payRunKey(runs[i]) + '"',
        foot: ['','','','','รวม', {n:sum('gross')}, {n:sum('pit')}, {n:sum('net')}, ''],
      }) : '')
      + (voided.length ? '<div class="note">งวดนี้เคยทำแล้วยกเลิก ' + voided.length + ' ครั้ง: '
        + voided.map((r) => esc(payRunKey(r)) + ' (' + esc(r.voidReason || '') + ')').join(' · ') + '</div>' : ''),
    foot: 'เงินเดือนประจำทำได้เดือนละหนึ่งงวด · โบนัส ค่าคอมมิชชั่น หรือเงินชดเชยคนที่ออก จ่ายเป็นงวดนอกรอบได้หลายครั้งในเดือนเดียว'
      + ' · ตัวเลขผิดก่อนยื่น ภ.ง.ด.1 ให้ยกเลิกงวดแล้วแก้แผ่นงานเดิม · ยื่นแล้วให้ปรับในงวดถัดไป',
  });
}

/** รายละเอียดงวดที่ลงบัญชีแล้ว — กดแถวเพื่อพิมพ์สลิปของคนนั้น */
function payRunCard(run) {
  const live = runIsLive(run);
  const s = run.slips;
  const sum = (f) => s.reduce((a, x) => a + f(x), 0);
  return card({
    title: payRunTitle(run) + ' · ' + payRunKey(run),
    sub: 'จ่ายวันที่ ' + thDate(run.date) + (run.payFrom ? ' จาก ' + payAccName(run.payFrom) : '') + ' · ' + run.count + ' คน',
    actions: btn('entry:' + run.entryNo, 'ดูใบสำคัญ')
      + btnI('printdoc:payslips:' + payRunKey(run), 'printer', 'พิมพ์สลิปทุกคน')
      + (live ? btn('voidrun:payroll:' + payRunKey(run), 'ยกเลิกงวดนี้', 'danger') : ''),
    body: voidBanner(run) + tbl({
      cols:[{t:'รหัส'},{t:'ชื่อ'},{t:'เงินเดือน',a:'r'},{t:'หักขาด ลา สาย',a:'r'},{t:'ค่าล่วงเวลา',a:'r'},{t:'เงินได้อื่น',a:'r'},{t:'รวมเงินได้',a:'r'},
        {t:'ภาษีหัก',a:'r'},{t:'ประกันสังคม',a:'r'},{t:'กองทุนสำรองฯ',a:'r'},{t:'หักอื่น',a:'r'},{t:'คืนค่าใช้จ่าย',a:'r'},{t:'รับสุทธิ',a:'r'}],
      rows: s.map((x) => [{mono:x.code}, x.name, {n:x.salary}, {n:-(x.unpaid || 0)}, {n:x.ot || 0}, {n:slipOther(x)}, {n:x.gross},
        {n:x.pit}, {n:x.sso}, {n:x.pvd}, {n:(x.loan || 0) + (x.otherDed || 0)}, {n:x.reimburse || 0}, {n:x.net}]),
      rowAttr: (r) => 'class="row-link" title="พิมพ์สลิปเงินเดือน" data-act="printdoc:payslip:' + payRunKey(run) + '/' + r[0].mono + '"',
      foot: ['', 'รวม', {n:sum((x) => x.salary)}, {n:-sum((x) => x.unpaid || 0)}, {n:sum((x) => x.ot || 0)}, {n:sum(slipOther)}, {n:run.gross},
        {n:run.pit}, {n:run.ssoEmp}, {n:run.pvdEmp}, {n:(run.loan || 0) + (run.otherDed || 0)}, {n:run.reimburse || 0}, {n:run.net}],
    }),
    foot: 'กดที่แถวเพื่อพิมพ์สลิปเงินเดือนของคนนั้น · ฐานประกันสังคมสูงสุด ' + fmt(run.ssoCeiling) + ' บาท สมทบสูงสุด ' + fmt(run.ssoMax)
      + ' บาทต่อเดือน ตามอัตราที่มีผล ณ วันที่จ่าย · นายจ้างสมทบประกันสังคม ' + fmt(run.ssoEr) + ' กองทุนสำรองฯ ' + fmt(run.pvdEr) + ' บาท',
  });
}

/* ---------- แผ่นงานเงินเดือน (ยังไม่ลงบัญชี) ----------
   ช่องกรอกในตารางเก็บลงแผ่นงานทันทีที่ออกจากช่อง และคำนวณตัวเลขในแถวใหม่โดยไม่วาดหน้าใหม่ทั้งหน้า
   ถ้าวาดใหม่ทั้งหน้า ปุ่มที่ผู้ใช้กำลังกด (เช่น ทำเงินเดือน) จะถูกแทนที่ระหว่างกดแล้วการกดหายไป */
const PAY_SHEET_COLS = ['gross', 'pit', 'sso', 'pvd', 'ded', 'net'];
function paySheetVals(s) {
  return { salary: s.salary, reduce: s.unpaid, other: s.variable - s.ot + s.exempt + s.reimburse, gross: s.gross,
    pit: s.pit, sso: s.sso, pvd: s.pvd, ded: s.loan + s.otherDed, net: s.net };
}
function paySheetWarn(s) {
  if (s.skip) return '<div class="dim" style="font-size:12px">ไม่จ่ายในงวดนี้</div>';
  return (s.error ? '<div style="font-size:12px;color:var(--neg)">' + esc(s.error) + '</div>' : '')
    + s.warn.map((w) => '<div class="dim" style="font-size:12px">' + esc(w) + '</div>').join('');
}
function paySheetCard(d) {
  let pv;
  try { pv = payrollPreview(d); }
  catch (e) {
    return card({ title: d.kind === 'regular' ? 'แผ่นงานเงินเดือน' : d.label, sub: thPeriod(d.period),
      body:'<div class="empty">' + esc(e.message) + (e.hint ? '<div class="dim">' + esc(e.hint) + '</div>' : '') + '</div>' });
  }
  const regular = d.kind === 'regular';
  const open = periodIsOpen();
  const id = d.id;
  const main = regular ? null : (PAY_OFFCYCLE[d.type] || PAY_OFFCYCLE.bonus).main;
  const at = (code, f) => ' data-pc="' + esc(id + '|' + code + '|' + f) + '"';
  const num = (code, f, v) => '<td class="num"' + at(code, f) + '>' + (v ? fmt(v) : '—') + '</td>';
  const inp = function (s, t) {
    const L = d.lines[s.code] || {};
    const def = PAY_ITEMS[t];
    /* ขาด ลา สาย ที่ไม่ได้กรอกทับ แสดงยอดจากบันทึกเวลา (ตัวเลขจาง) — กรอกแล้วคือแก้ทับ ลบจนว่างกลับไปใช้บันทึก */
    const logged = def.att && L[t] === undefined && regular ? attendanceSummary(s.code, d.period).qty[def.att] : 0;
    const v = L[t] !== undefined ? L[t] : def.att ? logged : (t === 'ot' && regular ? (DB.employees.find((e) => e.code === s.code) || {}).otHours || 0 : 0);
    const shown = def.unit ? (v ? String(v) : '') : payNum(v);
    return '<td class="num"><input class="qty-in pay-in' + (logged ? ' from-log' : '') + '" inputmode="decimal" aria-label="' + esc(def.label + ' ' + s.name) + '"'
      + (logged ? ' title="จากบันทึกขาด ลา มาสาย — พิมพ์ทับเพื่อแก้เฉพาะงวดนี้"' : '')
      + ' data-draft="' + esc(id) + '" data-emp="' + esc(s.code) + '" data-item="' + t + '" value="' + esc(shown) + '" data-v="' + esc(shown) + '"'
      + (open ? '' : ' disabled') + '></td>';
  };
  const head = '<div class="flds">'
    + payHeadField(id, 'payDate', 'วันที่จ่าย', 'date', d.payDate, null, 'ภาษีและประกันสังคมใช้อัตรา ณ วันที่จ่าย · ภ.ง.ด.1 นับตามเดือนที่จ่าย')
    + payHeadField(id, 'payFrom', 'จ่ายจากบัญชี', 'select', d.payFrom, payAccOpts())
    + (regular ? '' : payHeadField(id, 'label', 'ชื่อรอบที่จ่าย (พิมพ์บนสลิป)', 'text', d.label))
    + '</div>';
  const cols = (regular
    ? ['จ่าย', 'พนักงาน', 'เงินเดือน', 'ค่าล่วงเวลา (ชม.)', 'ขาดงาน (วัน)', 'มาสาย (นาที)', 'หักขาด ลา สาย', 'เงินได้อื่น']
    : ['พนักงาน', PAY_ITEMS[main].label, 'เงินได้อื่น']).concat(['รวมเงินได้', 'ภาษีหัก', 'ประกันสังคม', 'กองทุนฯ', 'หักอื่น', 'รับสุทธิ']);
  const left = regular ? 2 : 1;
  let rows = '';
  pv.rows.forEach(function (s) {
    const v = paySheetVals(s);
    rows += '<tr' + (s.skip ? ' class="is-void"' : '') + '>'
      + (regular ? '<td class="ctr"><input type="checkbox" class="pay-skip" style="width:17px;height:17px;accent-color:var(--accent)"'
        + ' data-draft="' + esc(id) + '" data-emp="' + esc(s.code) + '" aria-label="จ่าย ' + esc(s.name) + '"'
        + (s.skip ? '' : ' checked') + (open ? '' : ' disabled') + '></td>' : '')
      + '<td><span class="mono">' + esc(s.code) + '</span> ' + esc(s.name)
      + '<div' + at(s.code, 'warn') + '>' + paySheetWarn(s) + '</div></td>'
      + (regular ? num(s.code, 'salary', v.salary) + inp(s, 'ot') + inp(s, 'absent') + inp(s, 'late') + num(s.code, 'reduce', v.reduce) : inp(s, main))
      + '<td class="num"><span' + at(s.code, 'other') + '>' + (v.other ? fmt(v.other) : '—') + '</span> '
      + (open ? chip('payline:' + id + ':' + s.code, 'รายการ…') : '') + '</td>'
      + PAY_SHEET_COLS.map((f) => num(s.code, f, v[f])).join('') + '</tr>';
  });
  const T = pv.totals;
  const tot = { gross: T.gross, pit: T.pit, sso: T.sso, pvd: T.pvd, ded: T.loan + T.otherDed, net: T.net };
  const table = pv.rows.length
    ? '<div class="scroll' + (pv.rows.length > 12 ? ' tall' : '') + '"><table><thead><tr>'
      + cols.map((c, i) => '<th class="' + (i < left ? 'l' : 'r') + '">' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' + rows
      + '</tbody><tfoot><tr><td colspan="' + (cols.length - PAY_SHEET_COLS.length) + '" style="text-align:right">รวม <span'
      + ' data-pt="' + esc(id + '|count') + '">' + T.count + '</span> คน</td>'
      + PAY_SHEET_COLS.map((f) => '<td class="num" data-pt="' + esc(id + '|' + f) + '">' + fmt0(tot[f]) + '</td>').join('')
      + '</tr></tfoot></table></div>'
    : '<div class="empty">' + (regular ? 'ไม่มีพนักงานที่ทำงานในงวดนี้ — เพิ่มพนักงานในทะเบียนก่อน หรือตรวจวันเริ่มงาน/วันพ้นสภาพ'
        : 'ไม่มีพนักงานที่ทำงานในปีนี้') + '<div style="margin-top:12px">' + btn('emp:new', 'เพิ่มพนักงาน', 'primary') + '</div></div>';
  const post = regular ? btn('run:payroll', 'ทำเงินเดือนงวดนี้', open && pv.rows.length ? 'primary' : 'disabled')
    : btn('paypost:' + id, 'บันทึกจ่าย ' + d.label, open ? 'primary' : 'disabled');
  return card({
    title: regular ? 'แผ่นงานเงินเดือน — ตรวจแล้วกดทำเงินเดือน' : 'แผ่นงานจ่ายนอกรอบ — ' + d.label,
    sub: thPeriod(d.period) + ' · ยังไม่ลงบัญชี' + (payDraftFind(id) ? ' · แก้ไว้แล้ว' : ''),
    actions: post + (regular ? (payDraftFind(id) ? btn('paydraft:reset:' + id, 'ล้างที่แก้ไว้') : '') : btn('paydraft:del:' + id, 'ลบแผ่นงาน', 'danger')),
    noExport: false,
    body: head + table,
    foot: (regular
      ? 'เงินเดือนคิดตามวันที่ทำงานจริงในเดือน (เข้าหรือออกกลางเดือน) · ค่าล่วงเวลา = เงินเดือน ÷ 30 ÷ ' + (payrollSetting('hoursPerDay') || 8)
        + ' ชม. × 1.5 · ขาดงาน ลาไม่รับค่าจ้าง = ' + DAY_BASIS[payrollSetting('dayBasis') || 'd30'] + ' ต่อวัน · มาสาย กลับก่อน = ค่าจ้างรายวัน ÷ '
        + (payrollSetting('hoursPerDay') || 8) + ' ชม. ÷ 60 ต่อนาที · ตัวเลขจางคือยอดจากบันทึกขาด ลา มาสาย'
        + ' · กด "รายการ…" เพื่อใส่ลาไม่รับค่าจ้าง กลับก่อนเวลา ค่าตำแหน่ง ค่าคอมมิชชั่น โบนัส คืนค่าใช้จ่าย หักเงินกู้'
      : 'จ่ายเฉพาะคนที่มีจำนวนเงิน · โบนัสและเงินได้ไม่ประจำหักภาษีส่วนเพิ่มทั้งก้อนในงวดที่จ่าย')
      + ' · ภาษีหัก ณ ที่จ่ายคิดแบบยอดสะสมทั้งปี: ภาษีทั้งปีจากเงินได้จริงตั้งแต่ต้นปีรวมเงินเดือนที่จะได้ต่อ ลบภาษีที่หักไปแล้ว เฉลี่ยตามงวดที่เหลือ',
  });
}
function payHeadField(id, key, label, type, value, options, hint) {
  const attrs = ' data-draft="' + esc(id) + '" data-head="' + key + '" id="pdh_' + esc(id.replace(/\|/g, '_')) + '_' + key + '"'
    + (periodIsOpen() ? '' : ' disabled');
  return '<div class="fld-w"><label for="pdh_' + esc(id.replace(/\|/g, '_')) + '_' + key + '">' + esc(label) + '</label>'
    + (type === 'select'
      ? '<select' + attrs + '>' + options.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === value ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('') + '</select>'
      : '<input type="' + type + '"' + attrs + ' value="' + esc(value || '') + '">')
    + (hint ? '<div class="fld-hint">' + esc(hint) + '</div>' : '') + '</div>';
}
/** คำนวณแผ่นงานใหม่แล้วเขียนตัวเลขลงช่องเดิม */
function paySheetRefresh(id) {
  const d = payDraftById(id);
  if (!d) return;
  let pv;
  try { pv = payrollPreview(d); } catch (e) { return; }
  const q = (sel) => document.querySelector('#main [' + sel + ']');
  pv.rows.forEach(function (s) {
    const v = paySheetVals(s);
    ['salary', 'reduce', 'other'].concat(PAY_SHEET_COLS).forEach(function (f) {
      const el = q('data-pc="' + id + '|' + s.code + '|' + f + '"');
      if (el) el.textContent = v[f] ? fmt(v[f]) : '—';
    });
    const w = q('data-pc="' + id + '|' + s.code + '|warn"');
    if (w) w.innerHTML = paySheetWarn(s);
    const tr = w && w.closest('tr');
    if (tr) tr.classList.toggle('is-void', !!s.skip);
  });
  const T = pv.totals;
  const tot = { count: T.count, gross: T.gross, pit: T.pit, sso: T.sso, pvd: T.pvd, ded: T.loan + T.otherDed, net: T.net };
  Object.keys(tot).forEach(function (f) {
    const el = q('data-pt="' + id + '|' + f + '"');
    if (el) el.textContent = f === 'count' ? String(tot[f]) : fmt0(tot[f]);
  });
}
/** เก็บช่องกรอกหนึ่งช่องลงแผ่นงาน — คืน false ถ้าค่าไม่ผ่าน (แจ้งเตือนและคืนค่าเดิมในช่อง) */
function payInputStore(el) {
  const id = el.getAttribute('data-draft');
  try {
    if (el.classList.contains('pay-skip')) setPayLine(id, el.getAttribute('data-emp'), {}, !el.checked);
    else if (el.hasAttribute('data-head')) {
      const o = { id: id };
      o[el.getAttribute('data-head')] = el.value;
      savePayDraft(o);
    } else {
      /* ช่องในตารางที่ลบจนว่างคือศูนย์ — ไม่ใช่กลับไปใช้ชั่วโมงล่วงเวลาประจำจากทะเบียน ไม่งั้นลบแล้วยังจ่ายอยู่ */
      const o = {};
      const item = el.getAttribute('data-item');
      /* ขาด ลา สาย: ลบจนว่าง = กลับไปใช้บันทึกเวลา (ต้องการศูนย์ให้พิมพ์ 0) */
      o[item] = el.value.trim() === '' ? (PAY_ITEMS[item] && PAY_ITEMS[item].att ? '' : '0') : el.value;
      setPayLine(id, el.getAttribute('data-emp'), o);
      /* ลบจนว่างแล้วกลับไปใช้บันทึกเวลา — เติมยอดจากบันทึกกลับในช่อง (ตัวเลขจาง) ให้เห็นว่ายังหักอยู่ */
      if (o[item] === '') {
        const dr = payDraftById(id);
        const q = dr ? attendanceSummary(el.getAttribute('data-emp'), dr.period).qty[PAY_ITEMS[item].att] : 0;
        el.value = q ? String(q) : '';
        el.classList.toggle('from-log', !!q);
      } else el.classList.remove('from-log');
      el.setAttribute('data-v', el.value);
    }
    save();
    return true;
  } catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    if (el.classList.contains('pay-skip')) el.checked = !el.checked;
    else if (el.hasAttribute('data-head')) { const d = payDraftById(id); if (d) el.value = d[el.getAttribute('data-head')]; }
    else el.value = el.getAttribute('data-v') || '';
    return false;
  }
}
/** ช่องที่พิมพ์ค้างไว้แต่ยังไม่ได้ออกจากช่อง (กด Enter หรือกดปุ่มทันที) ต้องเก็บก่อนลงบัญชี */
function payFlush(id) {
  const els = Array.prototype.slice.call(document.querySelectorAll('#main .pay-in'))
    .filter((el) => el.getAttribute('data-draft') === id && el.value !== (el.getAttribute('data-v') || ''));
  return els.every(payInputStore);
}
function payRunPost(draftId) {
  const id = draftId || 'R|' + STATE.period;
  if (!payFlush(id)) return;
  runAction(function () {
    const r = draftId ? runPayroll(null, { draftId }) : runPayroll(STATE.period);
    STATE.sel = r.no;
    toast((r.kind === 'offcycle' ? 'จ่าย' + r.label : 'ทำเงินเดือน') + ' ' + r.count + ' คนแล้ว (' + r.no + ')', 'ok',
      'จ่ายสุทธิ ' + fmt(r.net) + ' บาท จาก ' + payAccName(r.payFrom) + ' · ภาษีหัก ณ ที่จ่าย ' + fmt(r.pit) + ' บาท');
  });
}

/** รายการทั้งหมดของพนักงานหนึ่งคนในแผ่นงาน พร้อมที่มาของภาษีงวดนี้ */
function modalPayLine(id, code) {
  const d = payDraftById(id);
  const e = DB.employees.find((x) => x.code === code);
  if (!d || !e) return;
  const regular = d.kind === 'regular';
  const L = d.lines[code] || {};
  let s = null;
  try { s = payrollPreview(d).rows.find((x) => x.code === code); } catch (err) { s = null; }
  const fld = function (t) {
    const def = PAY_ITEMS[t];
    if (def.offcycle === false && !regular) return '';
    const v = L[t] !== undefined ? L[t] : null;
    const value = v === null ? '' : def.unit ? String(v) : payNum(v);
    const att = def.att && regular ? attendanceSummary(code, d.period) : null;
    const hint = att ? 'ว่างไว้ = ตามบันทึกขาด ลา มาสาย ' + att.qty[def.att] + ' ' + def.unitLabel
        + (t === 'late' && att.late.times ? ' (สาย ' + att.late.times + ' ครั้ง ' + att.late.minutes + ' นาที)' : '')
        + ' · ' + (def.unit === 'days' ? 'วันละ ' + fmt(payDeductRates(e, d.period).perDay) : 'ชั่วโมงละ ' + fmt(payDeductRates(e, d.period).perHour)) + ' บาท'
      : t === 'ot' && regular ? 'ว่างไว้ = ตามทะเบียนพนักงาน ' + (e.otHours || 0) + ' ชม.'
      : t === 'adjust' ? 'ใส่ติดลบถ้างวดก่อนจ่ายเกิน — ใช้แก้งวดที่ยื่น ภ.ง.ด.1 ไปแล้ว'
      : t === 'severanceExempt' ? 'ส่วนที่กฎหมายยกเว้นภาษี (ค่าจ้างวันทำงานสุดท้ายตามเพดานในกฎกระทรวง) ไม่เข้า ภ.ง.ด.1'
      : t === 'reimburse' ? 'จ่ายคืนตามใบเสร็จที่ออกในนามบริษัท ไม่ใช่เงินได้ ไม่เสียภาษี'
      : t === 'loan' ? 'ลดยอดเงินทดรอง/ลูกหนี้พนักงานในบัญชี' : t === 'otherDed' ? 'ตั้งเป็นเจ้าหนี้อื่นรอนำส่ง' : null;
    return field({ name: 'pi_' + t, label: def.label + (def.unit ? ' (' + def.unitLabel + ')' : ' (บาท)'), value, hint });
  };
  const group = (title, keys) => '<div class="sub-h">' + esc(title) + '</div><div class="flds">' + keys.map(fld).join('') + '</div>';
  const c = s && s.calc;
  const info = s ? '<div class="note">'
    + 'เงินเดือนงวดนี้ ' + fmt(s.salary) + (s.prorated ? ' (' + s.days + '/' + s.dim + ' วัน)' : '') + ' บาท · รับสุทธิ <b>' + fmt(s.net) + '</b> บาท<br>'
    + 'ภาษีงวดนี้ <b>' + fmt(s.pit) + '</b> = ภาษีทั้งปีโดยประมาณ ' + fmt(c.annualTax) + ' (เงินได้ทั้งปี ' + fmt(c.annual)
    + ' − ค่าใช้จ่าย ' + fmt(c.expense) + ' − ค่าลดหย่อน ' + fmt(c.allowances) + ' = สุทธิ ' + fmt(c.net) + ')'
    + ' − หักไปแล้วในปีนี้ ' + fmt(c.prevTax) + (regular ? ' เฉลี่ย ' + c.remaining + ' งวดที่เหลือ' : '') + ' + ส่วนเพิ่มจากเงินได้ไม่ประจำ'
    + (s.error ? '<div style="color:var(--neg)">' + esc(s.error) + '</div>' : '') + '</div>' : '';
  modal({
    title: e.name + ' — ' + (regular ? 'เงินเดือนงวด ' + thPeriod(d.period) : d.label),
    sub: 'รายการของงวดนี้เท่านั้น ไม่แก้ทะเบียนพนักงาน · ว่างไว้หรือ 0 = ไม่มี',
    body: info
      + group('เงินได้ที่ต้องเสียภาษี (เข้า ภ.ง.ด.1)', ['ot', 'otHoliday', 'holiday', 'allowance', 'commission', 'bonus', 'otherIncome', 'leavePay', 'severance', 'adjust'])
      + group('จ่ายแต่ไม่ต้องเสียภาษี', ['severanceExempt', 'reimburse'])
      + (regular ? group('ขาด ลา มาสาย — หักค่าจ้างตามเวลาที่ไม่ได้ทำงาน (ลดเงินได้ ประกันสังคม และกองทุนฯ)', ['absent', 'unpaid', 'late', 'early']) : '')
      + group('รายการหักหลังภาษี', ['loan', 'otherDed']),
    submitLabel: 'บันทึกรายการ',
    onSubmit: function () {
      submitAction(function () {
        const values = {};
        PAY_ITEM_KEYS.forEach(function (t) {
          if (PAY_ITEMS[t].offcycle === false && !regular) return;
          values[t] = val('pi_' + t).trim();
        });
        setPayLine(id, code, values);
        toast('บันทึกรายการของ ' + e.name + ' แล้ว', 'ok', 'ยังไม่ลงบัญชีจนกว่าจะกดทำเงินเดือน');
      });
    },
  });
}

function modalNewOffcycle() {
  const p = DB.periods.find((x) => x.code === STATE.period);
  if (!p || p.status !== 'open') { toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว จ่ายเงินในงวดนี้ไม่ได้', 'err'); return; }
  modal({
    title: 'จ่ายเงินได้นอกรอบ — ' + thPeriod(STATE.period),
    sub: 'โบนัส ค่าคอมมิชชั่น หรือเงินชดเชยคนที่ออก จ่ายแยกจากเงินเดือนประจำได้ ภาษีคิดต่อจากยอดสะสมทั้งปี',
    body: '<div class="flds">'
      + field({ name:'ocType', label:'จ่ายอะไร', type:'select', value:'bonus',
          options: Object.keys(PAY_OFFCYCLE).map((k) => [k, PAY_OFFCYCLE[k].label]) })
      + field({ name:'ocLabel', label:'ชื่อรอบ (พิมพ์บนสลิป)', placeholder:'เช่น โบนัสประจำปี 2569' })
      + field({ name:'ocDate', label:'วันที่จ่าย', type:'date', value: defaultDate() })
      + field({ name:'ocFrom', label:'จ่ายจากบัญชี', type:'select', value: defaultPayFrom(), options: payAccOpts() })
      + '</div>',
    submitLabel: 'สร้างแผ่นงาน',
    note: 'ยังไม่ลงบัญชี — กรอกจำนวนเงินของแต่ละคนในแผ่นงานแล้วกดบันทึกจ่าย',
    onSubmit: function () {
      submitAction(function () {
        const d = newOffcycleDraft({ period: STATE.period, type: val('ocType'), label: val('ocLabel'), payDate: val('ocDate'), payFrom: val('ocFrom') });
        STATE.screen = 'payroll'; STATE.sel = null;
        toast('สร้างแผ่นงาน ' + d.label + ' แล้ว', 'ok', 'กรอกจำนวนเงินของแต่ละคน แล้วกดบันทึกจ่าย');
        return d;
      });
    },
  });
}

function modalVoidPayRun(key) {
  let run;
  try { run = payRunCheck(key); }
  catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    return;
  }
  modal({
    title: 'ยกเลิก' + payRunTitle(run) + ' (' + payRunKey(run) + ')',
    sub: 'ยกเลิกแล้วแก้แผ่นงานเดิมและทำใหม่ได้ ประวัติการยกเลิกเก็บไว้ในร่องรอยการตรวจสอบ',
    body: '<div class="void-prev"><b>ระบบจะทำสิ่งเหล่านี้ให้ในครั้งเดียว</b><ul>'
      + ['กลับรายการใบสำคัญ ' + run.entryNo + ' ณ วันที่จ่าย ' + thDate(run.date),
         'ตัดภาษีหัก ณ ที่จ่ายของ ' + run.count + ' คนออกจาก ภ.ง.ด.1 เดือน' + thPeriod(periodOf(run.date)),
         'คืนแผ่นงานพร้อมรายการที่กรอกไว้ ให้แก้เฉพาะจุดที่ผิดแล้วทำใหม่']
        .map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul></div>'
      + '<div class="flds">' + field({ name:'reason', label:'เหตุผลที่ยกเลิก', wide:true, placeholder:'อย่างน้อย 5 ตัวอักษร เช่น กรอกชั่วโมงล่วงเวลาผิด' }) + '</div>',
    submitLabel: 'ยืนยันยกเลิกงวด', submitKind: 'danger',
    onSubmit: function () {
      submitAction(function () {
        const r = voidRun('payroll', payRunKey(run), val('reason'));
        STATE.sel = null;
        toast('ยกเลิก' + payRunTitle(r) + ' แล้ว', 'ok', 'แผ่นงานเดิมกลับมาให้แก้และทำใหม่ได้ทันที');
        return r;
      });
    },
  });
}

function modalPaySettings() {
  modal({
    title: 'ตั้งค่าเงินเดือน',
    sub: 'ใช้พิมพ์ลงแบบ สปส.1-10 และ 50 ทวิ ใช้คิดค่าล่วงเวลา และหักขาด ลา มาสาย',
    body: '<div class="flds">'
      + field({ name:'ssoAccount', label:'เลขที่บัญชีนายจ้าง (ประกันสังคม)', value: payrollSetting('ssoAccount') || '',
          hint:'ตัวเลข 10 หลัก ตามหนังสือขึ้นทะเบียนนายจ้าง' })
      + field({ name:'ssoBranch', label:'ลำดับที่สาขา (ประกันสังคม)', value: payrollSetting('ssoBranch') || '000000' })
      + field({ name:'hoursPerDay', label:'ชั่วโมงทำงานปกติต่อวัน', value: String(payrollSetting('hoursPerDay') || 8),
          hint:'ค่าจ้างรายชั่วโมง = เงินเดือน ÷ 30 ÷ ชั่วโมงนี้ (พ.ร.บ.คุ้มครองแรงงาน)' })
      + '</div><div class="sub-h">ขาด ลา มาสาย</div><div class="flds">'
      + field({ name:'dayBasis', label:'ค่าจ้างรายวันสำหรับหักขาดงาน/ลา', type:'select', value: payrollSetting('dayBasis') || 'd30',
          options: Object.keys(DAY_BASIS).map((k) => [k, DAY_BASIS[k]]), hint:'มาสาย กลับก่อน = ค่าจ้างรายวัน ÷ ชั่วโมงทำงาน ÷ 60 ต่อนาที · ค่าล่วงเวลายังคิด ÷ 30 ตามกฎหมาย' })
      + field({ name:'workDays', label:'วันทำงานต่อเดือน (ถ้าเลือก ÷ วันทำงาน)', type:'number', value: String(payrollSetting('workDays') || 26) })
      + field({ name:'lateGrace', label:'ผ่อนผันมาสายครั้งละ (นาที)', type:'number', value: String(payrollSetting('lateGrace') || 0),
          hint:'สายไม่เกินนี้ไม่หัก สายเกินหักเฉพาะส่วนที่เกิน · 0 = หักทุกนาที' })
      + field({ name:'workStart', label:'เวลาเข้างาน', type:'time', value: payrollSetting('workStart') || '08:30' })
      + field({ name:'workEnd', label:'เวลาเลิกงาน', type:'time', value: payrollSetting('workEnd') || '17:30',
          hint:'ใช้แปลงเวลาเข้า-ออกจากเครื่องสแกนนิ้วเป็นมาสาย/กลับก่อน' })
      + '</div><div class="note">หักตามเวลาที่ไม่ได้ทำงานจริงเท่านั้น — ม.76 พ.ร.บ.คุ้มครองแรงงานห้ามหักค่าจ้างเป็นค่าปรับ'
      + ' (เช่น สายครั้งละ 100 บาท) ระบบจึงไม่มีการหักแบบเหมาจ่าย</div>',
    submitLabel: 'บันทึก',
    onSubmit: function () {
      submitAction(function () {
        saveSettingsPayroll({ ssoAccount: val('ssoAccount'), ssoBranch: val('ssoBranch'), hoursPerDay: val('hoursPerDay'),
          dayBasis: val('dayBasis'), workDays: val('workDays'), lateGrace: val('lateGrace'), workStart: val('workStart'), workEnd: val('workEnd') });
        toast('บันทึกค่าตั้งเงินเดือนแล้ว', 'ok');
      });
    },
  });
}

/* ===================================================================
   ทะเบียนพนักงาน
   =================================================================== */
function payEmpStatus(e) {
  if (e.left) return e.left < pStart() ? {st:['late','พ้นสภาพ ' + thDateNum(e.left)]} : {st:['wait','ออก ' + thDateNum(e.left)]};
  return e.active === false ? {st:['late','พ้นสภาพ']} : {st:['paid','ทำงานอยู่']};
}
function scEmployees() {
  const list = DB.employees.filter((e) => hit(e.code) || hit(e.name) || hit(e.dept) || hit(e.nationalId || ''));
  const working = DB.employees.filter((e) => employedSpan(e, STATE.period)).length;
  const noId = DB.employees.filter((e) => employedSpan(e, STATE.period) && !e.nationalId).length;
  return card({
    title:'ทะเบียนพนักงาน', sub: working + ' คนที่ทำงานในงวด ' + thPeriod(STATE.period),
    actions: btn('emp:new', '+ เพิ่มพนักงาน', 'primary') + btn('go:payroll', 'ไปแผ่นงานเงินเดือน'),
    filters: searchBox('ค้นหาชื่อ รหัส แผนก หรือเลขประจำตัวประชาชน'),
    body: (noId ? '<div class="note warn">พนักงาน ' + noId + ' คนยังไม่มีเลขประจำตัวประชาชน — ภ.ง.ด.1 ภ.ง.ด.1ก และ 50 ทวิ ต้องใช้เลขนี้ทุกคนที่ได้รับเงินได้</div>' : '')
      + tbl({
        cols:[{t:'รหัส'},{t:'ชื่อ-สกุล'},{t:'แผนก'},{t:'เลขประจำตัวประชาชน'},{t:'วันเริ่มงาน'},{t:'เงินเดือน',a:'r'},
          {t:'กองทุนสำรองฯ',a:'r'},{t:'ลดหย่อนอื่น/ปี',a:'r'},{t:'ประกันสังคม'},{t:'สถานะ'}],
        rows: list.map((e) => [{mono:e.code}, e.name, e.dept, e.nationalId ? {mono:e.nationalId} : {dim:'ยังไม่มี'}, thDateNum(e.hired), {n:e.salary},
          e.pvdRate ? {c: e.pvdRate + '% / ' + pvdErRateOf(e) + '%'} : {dim:'ไม่เข้าร่วม'},
          {n:e.deductions || 0}, e.ssoExempt ? {dim:'ไม่หัก'} : {c:'หัก'}, payEmpStatus(e)]),
        rowAttr: (r) => 'class="row-link" data-act="emp:edit:' + r[0].mono + '"',
        empty:'ยังไม่มีพนักงานในทะเบียน ต้องเพิ่มก่อนทำเงินเดือนงวดแรก',
        emptyAction: btn('emp:new', 'เพิ่มพนักงานคนแรก', 'primary'),
      }),
    foot:'กดที่แถวเพื่อแก้ไข · กองทุนแสดง ลูกจ้าง / นายจ้าง · ข้อมูลพนักงานเป็นข้อมูลส่วนบุคคลตาม พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล'
      + ' ระบบเต็มจำกัดสิทธิ์การเข้าถึงเป็นรายบทบาทและบันทึกทุกครั้งที่มีการเปิดดู',
  });
}

function modalEmployee(code) {
  const e = code ? DB.employees.find((x) => x.code === code) : null;
  if (code && !e) return;
  const y = Number(STATE.period.slice(0, 4));
  const op = e && e.ytdOpening;
  const years = [y, y - 1].map((v) => [String(v), 'พ.ศ. ' + (v + 543)]);
  modal({
    title: e ? 'แก้ไขพนักงาน ' + e.code : 'เพิ่มพนักงาน',
    sub:'ข้อมูลชุดนี้ใช้คำนวณภาษีเงินได้ ประกันสังคม และกองทุนสำรองเลี้ยงชีพ และพิมพ์ลง ภ.ง.ด.1 · 50 ทวิ',
    body:'<div class="flds">'
      + field({ name:'name', label:'คำนำหน้า ชื่อ-สกุล', wide:true, value: e ? e.name : '', placeholder:'เช่น นางสาวสุนิสา ประเสริฐ',
          hint:'ใส่คำนำหน้านาม (นาย นาง นางสาว) ตามที่ต้องกรอกใน ภ.ง.ด.1' })
      + field({ name:'dept', label:'แผนก', value: e ? e.dept : '' })
      + field({ name:'nationalId', label:'เลขประจำตัวประชาชน', value: e && e.nationalId ? e.nationalId : '',
          hint:'ใช้ตอนยื่น ภ.ง.ด.1 และขึ้นทะเบียนประกันสังคม' })
      + field({ name:'ssoNumber', label:'เลขที่บัตรประกันสังคม', value: e && e.ssoNumber ? e.ssoNumber : '', hint:'ว่างไว้ = ใช้เลขประจำตัวประชาชน' })
      + field({ name:'hired', label:'วันเริ่มงาน', type:'date', value: e && e.hired ? e.hired : '' })
      + field({ name:'left', label:'วันพ้นสภาพ (วันทำงานวันสุดท้าย)', type:'date', value: e && e.left ? e.left : '',
          hint:'ว่างไว้ถ้ายังทำงานอยู่ · เดือนที่ออกคิดเงินเดือนตามวันที่ทำงาน' })
      + field({ name:'salary', label:'เงินเดือน', value: e ? payNum(e.salary) : '' })
      + field({ name:'otHours', label:'ชั่วโมงล่วงเวลาต่อเดือน (ถ้ามีประจำ)', value: e ? String(e.otHours || 0) : '0',
          hint:'ใช้ตั้งต้นในแผ่นงานทุกเดือน แก้รายเดือนได้ในแผ่นงาน' })
      + field({ name:'address', label:'ที่อยู่ตามทะเบียนบ้าน', wide:true, value: e ? e.address || '' : '', hint:'พิมพ์ใน ภ.ง.ด.1ก และหนังสือรับรอง 50 ทวิ' })
      + '</div>'
      + '<div class="sub-h">ภาษี ประกันสังคม และกองทุนสำรองเลี้ยงชีพ</div><div class="flds">'
      + field({ name:'deductions', label:'ค่าลดหย่อนอื่นต่อปี (บาท)', value: e && e.deductions ? payNum(e.deductions) : '',
          hint:'รวมคู่สมรส บุตร บิดามารดา ประกันชีวิต/สุขภาพ ดอกเบี้ยบ้าน RMF SSF ฯลฯ ตามที่พนักงานแจ้ง (ล.ย.01) · ส่วนตัว 60,000 ประกันสังคม และกองทุนสำรองฯ ระบบหักให้เอง' })
      + field({ name:'pvdRate', label:'อัตราสะสมกองทุนสำรองเลี้ยงชีพ ลูกจ้าง (%)', value: e ? String(e.pvdRate || 0) : '0', hint:'0 ถึง 15 · ใส่ 0 ถ้าไม่เข้าร่วม' })
      + field({ name:'pvdErRate', label:'อัตราสมทบของนายจ้าง (%)', value: e && e.pvdErRate !== null && e.pvdErRate !== undefined ? String(e.pvdErRate) : '',
          placeholder:'เท่าอัตราลูกจ้าง', hint:'ว่างไว้ = เท่ากับอัตราของลูกจ้าง' })
      + field({ name:'ssoExempt', label:'ประกันสังคม', type:'select', value: e && e.ssoExempt ? 'yes' : 'no',
          options:[['no','หักและสมทบตามปกติ'],['yes','ไม่หัก (ไม่ได้เป็นผู้ประกันตนมาตรา 33)']] })
      + field({ name:'active', label:'สถานะ', type:'select', value: e && e.active === false ? 'no' : 'yes',
          options:[['yes','ทำงานอยู่ / ดูจากวันพ้นสภาพ'],['no','พ้นสภาพแล้ว (ไม่ทราบวัน)']] })
      + '</div>'
      + '<details class="adv"' + (op ? ' open' : '') + '><summary>ยอดที่บริษัทจ่ายไปแล้วในปีนี้ก่อนเริ่มใช้ระบบ (ย้ายระบบกลางปี)</summary>'
      + '<div class="flds">'
      + field({ name:'ytdYear', label:'ปีภาษี', type:'select', value: op ? String(op.year) : String(y), options: years })
      + field({ name:'ytdIncome', label:'เงินได้สะสม (บาท)', value: op ? payNum(op.income) : '' })
      + field({ name:'ytdTax', label:'ภาษีที่หักไปแล้ว (บาท)', value: op ? payNum(op.tax) : '' })
      + field({ name:'ytdSso', label:'ประกันสังคมที่หักไปแล้ว (บาท)', value: op ? payNum(op.sso) : '' })
      + field({ name:'ytdPvd', label:'กองทุนสำรองฯ ที่สะสมแล้ว (บาท)', value: op ? payNum(op.pvd) : '' })
      + '</div><div class="fld-hint" style="margin:0 0 10px">ใช้คำนวณภาษีแบบยอดสะสมต่อ และรวมใน ภ.ง.ด.1ก กับ 50 ทวิ ของปีนั้น</div></details>',
    submitLabel: e ? 'บันทึกการแก้ไข' : 'เพิ่มพนักงาน',
    onSubmit: function () {
      submitAction(function () {
        const r = saveEmployee({
          code: e ? e.code : null, name: val('name'), dept: val('dept'), hired: val('hired'), left: val('left'),
          nationalId: val('nationalId'), ssoNumber: val('ssoNumber'), address: val('address'),
          salary: val('salary'), otHours: val('otHours'), pvdRate: val('pvdRate'), pvdErRate: val('pvdErRate'),
          deductions: val('deductions'), ssoExempt: val('ssoExempt') === 'yes', active: val('active') !== 'no',
          ytdYear: val('ytdYear'), ytdIncome: val('ytdIncome'), ytdTax: val('ytdTax'), ytdSso: val('ytdSso'), ytdPvd: val('ytdPvd'),
        });
        toast((r.created ? 'เพิ่ม' : 'แก้ไข') + 'พนักงาน ' + r.employee.code + ' แล้ว', 'ok', r.employee.name);
        return r;
      });
    },
  });
}

/* ===================================================================
   ภ.ง.ด.1 · สปส.1-10 · นำส่งเงินสมทบ (รายเดือน)
   =================================================================== */
function scPayrollFile() {
  const period = STATE.period;
  const open = periodIsOpen();
  const rows = pnd1Rows(period);
  const filed = DB.docs.filing.find((f) => f.form === 'PND1' && f.period === period);
  const noId = rows.filter((t) => !t.taxId).length;
  const sm = ssoMonth(period);
  const pvdRows = {};
  DB.docs.payRun.forEach(function (r) {
    if (!runIsLive(r) || r.period !== period) return;
    r.slips.forEach(function (s) {
      if (!s.pvd && !s.pvdEr) return;
      const m = pvdRows[s.code] || (pvdRows[s.code] = { code: s.code, name: s.name, pvd: 0, pvdEr: 0 });
      m.pvd += s.pvd || 0; m.pvdEr += s.pvdEr !== undefined ? s.pvdEr : (s.pvd || 0);
    });
  });
  const pv = Object.keys(pvdRows).sort().map((k) => pvdRows[k]);
  const pvdDue = payRemitDue('pvd', period);
  const remits = DB.docs.payRemit.filter((x) => x.period === period);
  const acct = payrollSetting('ssoAccount');
  return card({
      title:'ภ.ง.ด.1 — ภาษีหัก ณ ที่จ่ายเงินเดือนรายคน', sub: 'เดือนที่จ่าย ' + thPeriod(period) + ' · ' + rows.length + ' รายการ'
        + (filed ? ' · ยื่นแล้ว ' + thDateNum(filed.filedDate) : ''),
      actions: btnI('printdoc:pnd1Attach:' + period, 'printer', 'พิมพ์ใบแนบ ภ.ง.ด.1', rows.length ? '' : 'disabled') + btn('go:pnd', 'ไปหน้ายื่นแบบ'),
      body: (noId ? '<div class="note warn">' + noId + ' รายการยังไม่มีเลขประจำตัวประชาชน — กรอกในทะเบียนพนักงานก่อนยื่น (รายการที่ลงบัญชีแล้วใช้เลขตอนทำเงินเดือน ต้องยกเลิกงวดแล้วทำใหม่ถ้ายังไม่ยื่น)</div>' : '')
        + tbl({
          cols:[{t:'ลำดับ',a:'c'},{t:'เลขประจำตัวประชาชน'},{t:'ชื่อผู้มีเงินได้'},{t:'วันที่จ่าย'},{t:'งวด'},{t:'เงินได้ที่จ่าย',a:'r'},{t:'ภาษีที่หัก',a:'r'}],
          rows: rows.map((t, i) => [{c:String(i + 1)}, t.taxId ? {mono:t.taxId} : {dim:'ยังไม่มี'}, t.partnerName, thDateNum(t.date),
            {mono:t.runNo || t.docNo}, {n:t.base}, {n:t.tax}]),
          foot: ['', '', '', '', 'รวม', {n:rows.reduce((s, t) => s + t.base, 0)}, {n:rows.reduce((s, t) => s + t.tax, 0)}],
          empty:'ไม่มีการหักภาษีจากเงินเดือนที่จ่ายในเดือนนี้',
        }),
      foot:'ยื่นภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ถึงวันที่ 15) · แสดงเฉพาะคนที่ถูกหักภาษี คนที่ไม่ถูกหักยังอยู่ใน ภ.ง.ด.1ก และ 50 ทวิ ประจำปีครบทุกคน',
    })
    + card({
      title:'สปส.1-10 — เงินสมทบประกันสังคม', sub:'งวดค่าจ้าง ' + thPeriod(period) + ' · ' + sm.rows.length + ' คน · เลขที่บัญชีนายจ้าง ' + (acct || 'ยังไม่ได้ตั้ง'),
      actions: btnI('printdoc:sso110:' + period, 'printer', 'พิมพ์ สปส.1-10', sm.rows.length ? '' : 'disabled')
        + btn('payremit:sso', 'นำส่งประกันสังคม', open && sm.remit.left > 0 ? 'primary' : open ? '' : 'disabled')
        + (acct ? '' : btn('paysettings', 'ตั้งเลขที่บัญชีนายจ้าง')),
      body: tbl({
        cols:[{t:'ลำดับ',a:'c'},{t:'เลขประจำตัวประชาชน'},{t:'ชื่อ-สกุล'},{t:'ค่าจ้างที่จ่ายจริง',a:'r'},{t:'ค่าจ้างที่ใช้คำนวณ',a:'r'},{t:'ผู้ประกันตน',a:'r'},{t:'นายจ้าง',a:'r'}],
        rows: sm.rows.map((x) => [{c:String(x.seq)}, x.nationalId || x.ssoNumber ? {mono: x.ssoNumber || x.nationalId} : {dim:'ยังไม่มี'}, x.name,
          {n:x.wage}, {n:x.base}, {n:x.sso}, {n:x.ssoEr}]),
        foot: ['', '', 'รวม', {n:sm.totals.wage}, {n:sm.totals.base}, {n:sm.totals.sso}, {n:sm.totals.ssoEr}],
        empty:'ยังไม่มีเงินสมทบของงวดค่าจ้างนี้',
      })
      + '<div class="totals"><div><span>เงินสมทบที่ต้องนำส่ง</span><b>' + fmt(sm.remit.due) + '</b></div>'
      + '<div><span>นำส่งแล้ว</span><b>' + fmt(sm.remit.paid) + '</b></div>'
      + '<div class="gt"><span>ค้างนำส่ง</span><b>' + fmt(sm.remit.left) + '</b></div></div>',
      foot:'นำส่งภายในวันที่ 15 ของเดือนถัดไป · อัตราร้อยละ ' + sm.rate.pct + ' ฐานค่าจ้าง ' + fmt(sm.rate.floor) + '–' + fmt(sm.rate.ceiling)
        + ' บาท · ปุ่มดาวน์โหลดมุมขวาบนส่งออกตารางนี้เป็น CSV สำหรับกรอกในระบบ e-Service ของสำนักงานประกันสังคม',
    })
    + card({
      title:'กองทุนสำรองเลี้ยงชีพ', sub:'งวดค่าจ้าง ' + thPeriod(period) + ' · ' + pv.length + ' คน',
      actions: btn('payremit:pvd', 'นำส่งกองทุนสำรองฯ', open && pvdDue.left > 0 ? 'primary' : open ? '' : 'disabled'),
      body: tbl({
        cols:[{t:'รหัส'},{t:'ชื่อ-สกุล'},{t:'เงินสะสมลูกจ้าง',a:'r'},{t:'เงินสมทบนายจ้าง',a:'r'},{t:'รวม',a:'r'}],
        rows: pv.map((x) => [{mono:x.code}, x.name, {n:x.pvd}, {n:x.pvdEr}, {n:x.pvd + x.pvdEr}]),
        foot: ['', 'รวม', {n:pv.reduce((s, x) => s + x.pvd, 0)}, {n:pv.reduce((s, x) => s + x.pvdEr, 0)}, {n:pvdDue.due}],
        empty:'ไม่มีพนักงานที่เป็นสมาชิกกองทุนในงวดนี้',
      }),
      foot:'นำส่งบริษัทจัดการกองทุนภายใน 3 วันทำการนับแต่วันจ่ายค่าจ้าง · ค้างนำส่ง ' + fmt(pvdDue.left) + ' บาท',
    })
    + card({
      title:'รายการนำส่งเงินสมทบ', sub: thPeriod(period),
      body: tbl({
        cols:[{t:'เลขที่'},{t:'วันที่นำส่ง'},{t:'นำส่ง'},{t:'จ่ายจาก'},{t:'อ้างอิง'},{t:'จำนวนเงิน',a:'r'},{t:'ใบสำคัญ'},{t:''}],
        rows: remits.map((x) => [{mono:x.no}, thDateNum(x.date), REMIT_KIND[x.kind].label, payAccName(x.payFrom), x.ref || {dim:'—'},
          {n:x.amount}, {mono:x.entryNo}, x.status === 'void' ? {st:['void','ยกเลิก']}
            : {html: open ? btn('payremitvoid:' + x.no, 'ยกเลิก', 'danger') : ''}]),
        rowAttr: (r, i) => (remits[i].status === 'void' ? 'class="is-void"' : ''),
        empty:'ยังไม่ได้นำส่งเงินสมทบของงวดนี้',
      }),
      foot:'ลงบัญชี Dr ประกันสังคม/กองทุนค้างนำส่ง · Cr เงินฝากธนาคาร ในสมุดรายวันจ่าย',
    });
}

function modalPayRemit(kind, period) {
  const K = REMIT_KIND[kind];
  if (!K) return;
  period = period || STATE.period;
  const due = payRemitDue(kind, period);
  const next15 = addDays(endOfMonth(period + '-01'), 15);
  const date = DB.periods.some((p) => p.status === 'open' && next15 >= p.start && next15 <= p.end) ? next15 : endOfMonth(period + '-01');
  modal({
    title: 'นำส่ง' + K.label,
    sub: 'Dr ' + (kind === 'sso' ? 'เงินสมทบประกันสังคมค้างนำส่ง' : 'กองทุนสำรองเลี้ยงชีพค้างนำส่ง') + ' · Cr บัญชีที่จ่าย',
    body: '<div class="note">งวดค่าจ้าง ' + thPeriod(period) + ': ต้องนำส่ง ' + fmt(due.due) + ' บาท · นำส่งแล้ว ' + fmt(due.paid)
      + ' บาท · <b>ค้าง ' + fmt(due.left) + ' บาท</b></div>'
      + '<div class="flds" data-remit="' + kind + '">'
      + field({ name:'remitPeriod', label:'งวดค่าจ้าง', type:'select', value: period, options: DB.periods.map((p) => [p.code, thPeriod(p.code)]) })
      + field({ name:'remitDate', label:'วันที่นำส่ง', type:'date', value: date })
      + field({ name:'remitAmount', label:'จำนวนเงิน (บาท)', value: due.left > 0 ? payNum(due.left) : '',
          hint:'ยอดยกมาจากระบบเดิมแก้ตัวเลขเองได้ ไม่เกินยอดค้างในบัญชี' })
      + field({ name:'remitFrom', label:'จ่ายจากบัญชี', type:'select', value: defaultPayFrom(), options: payAccOpts() })
      + field({ name:'remitRef', label:'เลขที่ใบเสร็จ/อ้างอิง', placeholder: kind === 'sso' ? 'เลขที่ใบเสร็จรับเงินของ สปส.' : 'เลขที่ใบนำส่งกองทุน' })
      + '</div>',
    submitLabel: 'บันทึกการนำส่ง',
    onSubmit: function () {
      submitAction(function () {
        const r = remitPayroll({ kind, period: val('remitPeriod'), date: val('remitDate'), amount: val('remitAmount'),
          payFrom: val('remitFrom'), ref: val('remitRef') });
        toast('นำส่ง' + K.label + ' ' + fmt(r.amount) + ' บาทแล้ว', 'ok', r.no + ' · ใบสำคัญ ' + r.entryNo);
        return r;
      });
    },
  });
}

/* ===================================================================
   สรุปทั้งปี · ภ.ง.ด.1ก · 50 ทวิ
   =================================================================== */
function scPayrollYear() {
  const year = Number(STATE.period.slice(0, 4));
  const Y = payrollYear(year);
  const noId = Y.rows.filter((r) => !r.nationalId || !r.address).length;
  return card({
    title:'สรุปเงินเดือนทั้งปี — ภ.ง.ด.1ก และ 50 ทวิ', sub:'ปีภาษี พ.ศ. ' + (year + 543) + ' (นับตามวันที่จ่าย) · ' + Y.rows.length + ' คน',
    actions: btnI('printdoc:pnd1k:' + year, 'printer', 'พิมพ์ ภ.ง.ด.1ก', Y.rows.length ? '' : 'disabled')
      + btnI('printdoc:empCerts:' + year, 'printer', 'พิมพ์ 50 ทวิ ทุกคน', Y.rows.length ? '' : 'disabled'),
    body: (noId ? '<div class="note warn">' + noId + ' คนยังไม่มีเลขประจำตัวประชาชนหรือที่อยู่ — ภ.ง.ด.1ก และ 50 ทวิ ต้องมีทั้งสองอย่าง กรอกได้ที่ทะเบียนพนักงาน</div>' : '')
      + kpi([
        { label:'ผู้มีเงินได้', value: Y.totals.count + ' คน' },
        { label:'เงินได้ทั้งปี', value: fmt(Y.totals.income) },
        { label:'ภาษีที่หักและนำส่ง', value: fmt(Y.totals.tax) },
        { label:'ประกันสังคม (ลูกจ้าง)', value: fmt(Y.totals.sso) },
        { label:'กองทุนสำรองฯ (ลูกจ้าง)', value: fmt(Y.totals.pvd) },
      ])
      + tbl({
        cols:[{t:'ลำดับ',a:'c'},{t:'รหัส'},{t:'ชื่อ-สกุล'},{t:'เลขประจำตัวประชาชน'},{t:'เงินได้ทั้งปี',a:'r'},{t:'ภาษีหัก ณ ที่จ่าย',a:'r'},
          {t:'ประกันสังคม',a:'r'},{t:'กองทุนสำรองฯ',a:'r'},{t:'งวดที่จ่าย',a:'r'},{t:''}],
        rows: Y.rows.map((r) => [{c:String(r.seq)}, {mono:r.code}, r.name + (r.left ? ' (ออก ' + thDateNum(r.left) + ')' : ''),
          r.nationalId ? {mono:r.nationalId} : {dim:'ยังไม่มี'}, {n:r.income}, {n:r.tax}, {n:r.sso}, {n:r.pvd},
          {c: String(r.runs) + (r.opening ? ' + ยอดยกมา' : '')}, {html: btnI('printdoc:empCert:' + r.code + '/' + year, 'printer', '50 ทวิ')}]),
        foot: ['', '', '', 'รวม', {n:Y.totals.income}, {n:Y.totals.tax}, {n:Y.totals.sso}, {n:Y.totals.pvd}, '', ''],
        empty:'ยังไม่มีการจ่ายเงินเดือนในปีนี้',
      }),
    foot:'ภ.ง.ด.1ก ยื่นภายในเดือนกุมภาพันธ์ของปีถัดไป · 50 ทวิ ให้พนักงานภายในเดือนกุมภาพันธ์ หรือภายใน 1 เดือนนับแต่วันที่ออกจากงาน'
      + ' · ยอดรวมทั้งปีรวมยอดที่จ่ายก่อนเริ่มใช้ระบบ (กรอกในทะเบียนพนักงาน)',
  });
}

/* ===================================================================
   เอกสารพิมพ์
   =================================================================== */
const payBox = (on) => '<span class="chk">' + (on ? '✓' : '&nbsp;') + '</span>';
/** หาสลิปจากคีย์ "เลขที่งวด/รหัสพนักงาน" */
function payslipFind(key) {
  const i = String(key).lastIndexOf('/');
  const run = payRunByKey(String(key).slice(0, i));
  const slip = run && run.slips.find((s) => s.code === String(key).slice(i + 1));
  return slip ? { run, slip } : null;
}
function payslipSheet(run, s) {
  const earn = [], ded = [];
  if (s.salary) earn.push(['เงินเดือน' + (s.prorated ? ' (' + s.days + '/' + s.dim + ' วัน)' : ''), s.salary]);
  if (s.earn) {
    s.earn.forEach((r) => earn.push([r.label + (r.qty ? ' ' + r.qty + ' ' + r.unit : ''), r.amount]));
    s.ded.forEach((r) => ded.push([r.label + (r.qty ? ' ' + r.qty + ' ' + r.unit : '') + (r.times ? ' (' + r.times + ' ครั้ง)' : ''), r.amount]));
  } else {
    /* สลิปรุ่นก่อน: เงินเดือน ค่าล่วงเวลา ภาษี ประกันสังคม กองทุน */
    if (s.ot) earn.push(['ค่าล่วงเวลา', s.ot]);
    [['ภาษีเงินได้หัก ณ ที่จ่าย', s.pit], ['เงินสมทบประกันสังคม', s.sso], ['เงินสะสมกองทุนสำรองเลี้ยงชีพ', s.pvd]]
      .forEach((r) => { if (r[1]) ded.push(r); });
  }
  const tE = earn.reduce((a, r) => a + r[1], 0), tD = ded.reduce((a, r) => a + r[1], 0);
  const year = Number(String(run.date).slice(0, 4));
  const y = s.ytd || payYtd(s.code, year, run.date);
  const col = (h) => [{ t: h }, { t: 'จำนวนเงิน', w: '30mm', n: 1 }];
  return pSheet(pHead('ใบแจ้งเงินเดือน', 'PAY SLIP', 'สำหรับพนักงาน')
    + '<div class="p-meta">' + pInfo([['พนักงาน', s.name], ['รหัส', s.code], ['แผนก', s.dept || ''], ['เลขประจำตัวประชาชน', s.nationalId || '—']])
    + pInfo([['รอบ', payRunTitle(run)], ['เลขที่', payRunKey(run)], ['วันที่จ่าย', thDate(run.date)], ['จ่ายจาก', run.payFrom ? payAccName(run.payFrom) : '']]) + '</div>'
    + '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; align-items:start">'
    + pTable(col('รายได้'), earn.map((r) => [r[0], pm(r[1])]), 6, { total: ['รวมรายได้', pm(tE)] })
    + pTable(col('รายการหัก'), ded.map((r) => [r[0], pm(r[1])]), 6, { total: ['รวมรายการหัก', pm(tD)] })
    + '</div>'
    + pTotals(s.net, [['รายได้รวม', pm(tE)], ['หักรวม', pm(tD)], ['เงินได้สุทธิที่ได้รับ', pm(s.net), true]])
    + '<div class="p-box" style="margin-top:8px"><div class="lb">ยอดสะสมตั้งแต่ต้นปี พ.ศ. ' + (year + 543) + '</div>'
    + 'เงินได้ที่ต้องเสียภาษี ' + pm(y.income) + ' · ภาษีหัก ณ ที่จ่าย ' + pm(y.tax) + ' · ประกันสังคม ' + pm(y.sso) + ' · กองทุนสำรองเลี้ยงชีพ ' + pm(y.pvd) + '</div>'
    + '<div class="p-note">เอกสารนี้เป็นข้อมูลส่วนบุคคล โปรดเก็บรักษาเป็นความลับ</div>'
    + pSign(['ผู้จ่ายเงิน', 'ผู้รับเงิน']), payRunKey(run) + ' · ' + s.code, isVoid(run) ? 'ยกเลิก' : '');
}

function pnd1AttachSheet(period) {
  const co = DB.company;
  const rows = pnd1Rows(period);
  const [y, m] = period.split('-').map(Number);
  const types = ['(1) เงินได้ตามมาตรา 40 (1) เงินเดือน ค่าจ้าง ฯลฯ กรณีทั่วไป',
    '(2) เงินได้ตามมาตรา 40 (1) เงินเดือน ค่าจ้าง ฯลฯ กรณีได้รับอนุมัติจากกรมสรรพากรให้หักอัตราร้อยละ 3',
    '(3) เงินได้ตามมาตรา 40 (1) (2) กรณีนายจ้างจ่ายให้ครั้งเดียวเพราะเหตุออกจากงาน',
    '(4) เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้เป็นผู้อยู่ในประเทศไทย',
    '(5) เงินได้ตามมาตรา 40 (2) กรณีผู้รับเงินได้มิได้เป็นผู้อยู่ในประเทศไทย'];
  return pSheet(
    '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start">'
    + '<div><h1 style="margin:0; font-size:18pt">ใบแนบ ภ.ง.ด.1</h1><div>เดือนที่จ่ายเงินได้ ' + esc(TH_MF[m - 1]) + ' พ.ศ. ' + (y + 543) + '</div></div>'
    + '<div style="text-align:right; font-size:11.5pt">เลขประจำตัวผู้เสียภาษีอากร (ของผู้มีหน้าที่หักภาษี ณ ที่จ่าย)<br><b style="font-size:13pt">'
    + esc(co.taxId || '—') + '</b> &nbsp; สาขาที่ ' + esc(co.branch || '00000') + '</div></div>'
    + '<div class="p-box" style="margin:8px 0"><div><b>' + esc(co.name) + '</b> · ' + esc(co.address || '') + '</div>'
    + '<div style="margin-top:3px; display:grid; grid-template-columns:1fr 1fr; gap:0 12px; font-size:10.5pt">'
    + types.map((t, i) => '<div>' + payBox(i === 0) + esc(t) + '</div>').join('') + '</div></div>'
    + pTable([{ t:'ลำดับ', w:'10mm', c:1 }, { t:'เลขประจำตัวผู้เสียภาษีอากร', w:'31mm', c:1 },
      { t:'ชื่อผู้มีเงินได้' }, { t:'วันที่จ่าย', w:'21mm', c:1 },
      { t:'เงินได้ที่จ่ายครั้งนี้', w:'25mm', n:1, sum:1 }, { t:'ภาษีที่หักนำส่งครั้งนี้', w:'24mm', n:1, sum:1 },
      { t:'เงื่อนไข', w:'12mm', c:1 }],
      rows.map((t, i) => [String(i + 1), t.taxId || '', t.partnerName, thDateNum(t.date), pm(t.base), pm(t.tax), String(t.cond || 1)]), 6,
      { paged: true, total: ['', '', 'รวม ' + rows.length + ' ราย', '', pm(rows.reduce((s, t) => s + t.base, 0)), pm(rows.reduce((s, t) => s + t.tax, 0)), ''] })
    + '<div class="p-note">เงื่อนไขการหักภาษี: 1 = หัก ณ ที่จ่าย · 2 = ออกให้ตลอดไป · 3 = ออกให้ครั้งเดียว · ยื่นพร้อมแบบ ภ.ง.ด.1 ภายในวันที่ 7 ของเดือนถัดไป (ยื่นออนไลน์ถึงวันที่ 15)</div>'
    + pSign(['ผู้จ่ายเงิน (ลงชื่อ ตำแหน่ง และประทับตรา)']), 'ใบแนบ ภ.ง.ด.1 ' + thPeriod(period), '');
}

function pnd1kSheet(year) {
  const co = DB.company;
  const Y = payrollYear(year);
  return pSheet(
    '<div style="display:flex; justify-content:space-between; gap:12px; align-items:flex-start">'
    + '<div><h1 style="margin:0; font-size:18pt">ใบแนบ ภ.ง.ด.1ก</h1><div>แบบยื่นรายการภาษีเงินได้หัก ณ ที่จ่าย ประจำปีภาษี พ.ศ. ' + (Number(year) + 543) + '</div></div>'
    + '<div style="text-align:right; font-size:11.5pt">เลขประจำตัวผู้เสียภาษีอากร (ของผู้มีหน้าที่หักภาษี ณ ที่จ่าย)<br><b style="font-size:13pt">'
    + esc(co.taxId || '—') + '</b> &nbsp; สาขาที่ ' + esc(co.branch || '00000') + '</div></div>'
    + '<div class="p-box" style="margin:8px 0"><div><b>' + esc(co.name) + '</b> · ' + esc(co.address || '') + '</div>'
    + '<div>' + payBox(true) + 'เงินได้ตามมาตรา 40 (1) เงินเดือน ค่าจ้าง ฯลฯ · สรุป ' + Y.totals.count + ' ราย · เงินได้ทั้งสิ้น '
    + pm(Y.totals.income) + ' บาท · ภาษีที่หักและนำส่งทั้งสิ้น ' + pm(Y.totals.tax) + ' บาท</div></div>'
    + pTable([{ t:'ลำดับ', w:'11mm', c:1 }, { t:'เลขประจำตัวผู้เสียภาษีอากร', w:'31mm', c:1 }, { t:'ชื่อผู้มีเงินได้' },
      { t:'ที่อยู่ของผู้มีเงินได้' }, { t:'เงินได้ที่จ่ายทั้งปี', w:'27mm', n:1, sum:1 },
      { t:'ภาษีที่หักและนำส่งทั้งปี', w:'27mm', n:1, sum:1 }, { t:'เงื่อนไข', w:'14mm', c:1 }],
      Y.rows.map((r) => [String(r.seq), r.nationalId || '', r.name, r.address || '', pm(r.income), pm(r.tax), '1']), 6,
      { paged: true, total: ['', '', 'รวม ' + Y.rows.length + ' ราย', '', pm(Y.totals.income), pm(Y.totals.tax), ''] })
    + '<div class="p-note">ยื่นภายในเดือนกุมภาพันธ์ พ.ศ. ' + (Number(year) + 544) + ' · เงื่อนไข 1 = หัก ณ ที่จ่าย</div>'
    + pSign(['ผู้จ่ายเงิน (ลงชื่อ ตำแหน่ง และประทับตรา)']), 'ภ.ง.ด.1ก ' + (Number(year) + 543), '');
}

/* 50 ทวิ ของพนักงาน — โครงเดียวกับแบบที่พิมพ์ให้ผู้ขาย (whtCertPrint) แต่เป็นเงินได้ ม.40(1) ทั้งปี ยื่นใน ภ.ง.ด.1ก
   พร้อมช่องเงินสมทบประกันสังคมและกองทุนสำรองเลี้ยงชีพที่พนักงานใช้ลดหย่อนตอนยื่น ภ.ง.ด.91 */
function empCertFind(key) {
  const i = String(key).lastIndexOf('/');
  const year = Number(String(key).slice(i + 1));
  const row = payrollYear(year).rows.find((r) => r.code === String(key).slice(0, i));
  return row ? { row, year } : null;
}
function empCertSheet(row, year, copy) {
  const co = DB.company;
  const forms = ['ภ.ง.ด.1ก', 'ภ.ง.ด.1ก พิเศษ', 'ภ.ง.ด.2', 'ภ.ง.ด.3', 'ภ.ง.ด.2ก', 'ภ.ง.ด.3ก', 'ภ.ง.ด.53'];
  const lines = [
    ['1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)', true],
    ['2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)', false],
    ['3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)', false],
    ['4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก) · (ข) เงินปันผล ฯลฯ ตามมาตรา 40 (4) (ข)', false],
    ['5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส', false],
    ['6. อื่น ๆ (ระบุ)', false],
  ];
  /* วันที่ออก: วันสิ้นปีภาษี หรือวันที่ออกจากงานถ้าออกระหว่างปี (ต้องให้ภายใน 1 เดือนนับแต่วันออก) */
  const issued = row.left && Number(row.left.slice(0, 4)) === year ? row.left : year + '-12-31';
  const [iy, im, id] = issued.split('-').map(Number);
  const no = row.code + '/' + (year + 543);
  return pSheet(
    '<div style="display:flex; justify-content:space-between; font-size:11.5pt"><span>' + esc(copy || '') + '</span>'
    + '<span>เล่มที่ ______ เลขที่ ' + esc(no) + '</span></div>'
    + '<div style="text-align:center; margin:6px 0 8px"><h1 style="margin:0; font-size:18pt">หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>'
    + '<div>ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div></div>'
    + '<div class="p-box" style="margin-bottom:6px"><div class="lb">ผู้มีหน้าที่หักภาษี ณ ที่จ่าย</div>'
    + '<div><b>' + esc(co.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร ' + esc(co.taxId || '—') + '</div>'
    + '<div>ที่อยู่ ' + esc(co.address || '') + '</div></div>'
    + '<div class="p-box" style="margin-bottom:6px"><div class="lb">ผู้ถูกหักภาษี ณ ที่จ่าย</div>'
    + '<div><b>' + esc(row.name) + '</b> · เลขประจำตัวผู้เสียภาษีอากร ' + esc(row.nationalId || '—') + '</div>'
    + '<div>ที่อยู่ ' + esc(row.address || '') + '</div>'
    + '<div style="margin-top:4px">ลำดับที่ <b>' + row.seq + '</b> ในแบบ &nbsp; '
    + forms.map((f, i) => payBox(i === 0) + esc(f)).join(' &nbsp; ') + '</div></div>'
    + '<table class="w50"><thead><tr><th>ประเภทเงินได้พึงประเมินที่จ่าย</th><th style="width:30mm">วัน เดือน หรือปีภาษี ที่จ่าย</th>'
    + '<th style="width:32mm">จำนวนเงินที่จ่าย</th><th style="width:30mm">ภาษีที่หักและนำส่งไว้</th></tr></thead><tbody>'
    + lines.map((r) => '<tr><td>' + esc(r[0]) + '</td><td style="text-align:center">' + (r[1] ? 'ปีภาษี ' + (year + 543) : '')
      + '</td><td class="num">' + (r[1] ? pm(row.income) : '') + '</td><td class="num">' + (r[1] ? pm(row.tax) : '') + '</td></tr>').join('')
    + '<tr class="sec"><td colspan="2" style="text-align:right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td class="num">' + pm(row.income)
    + '</td><td class="num">' + pm(row.tax) + '</td></tr></tbody></table>'
    + '<div class="p-box" style="margin-top:-1px"><b>รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)</b> &nbsp; ' + esc(bahtText(row.tax)) + '</div>'
    + '<div class="p-box" style="margin-top:6px">เงินที่จ่ายเข้า &nbsp; ' + payBox(false) + 'กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน ______ บาท &nbsp; '
    + payBox(row.sso > 0) + 'กองทุนประกันสังคม <b>' + (row.sso ? pm(row.sso) : '______') + '</b> บาท &nbsp; '
    + payBox(row.pvd > 0) + 'กองทุนสำรองเลี้ยงชีพ <b>' + (row.pvd ? pm(row.pvd) : '______') + '</b> บาท'
    + '<div style="margin-top:3px">เลขที่บัญชีนายจ้าง ' + esc(payrollSetting('ssoAccount') || '______________')
    + ' &nbsp; เลขที่บัตรประกันสังคมของผู้ถูกหักภาษี ณ ที่จ่าย ' + esc(row.ssoNumber || row.nationalId || '______________') + '</div></div>'
    + '<div class="p-box" style="margin-top:6px">ผู้จ่ายเงิน &nbsp; ' + payBox(true) + '(1) หัก ณ ที่จ่าย &nbsp; ' + payBox(false) + '(2) ออกให้ตลอดไป &nbsp; '
    + payBox(false) + '(3) ออกให้ครั้งเดียว &nbsp; ' + payBox(false) + '(4) อื่น ๆ</div>'
    + '<div style="display:grid; grid-template-columns:1fr 70mm; gap:10px; margin-top:10px">'
    + '<div class="p-box" style="font-size:10.5pt"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ '
    + 'แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>'
    + '<div style="text-align:center">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ'
    + '<div style="margin-top:14mm; border-top:1px dotted #111; padding-top:4px">ลงชื่อ ผู้จ่ายเงิน</div>'
    + '<div>วันที่ ' + id + ' เดือน ' + TH_MF[im - 1] + ' พ.ศ. ' + (iy + 543) + '</div>'
    + '<div style="font-size:10.5pt; margin-top:4px">(ประทับตรานิติบุคคล ถ้ามี)</div></div></div>',
    no, '');
}

function sso110Sheet(period) {
  const co = DB.company;
  const sm = ssoMonth(period);
  const [y, m] = period.split('-').map(Number);
  const T = sm.totals;
  return pSheet(
    '<div style="text-align:center; margin-bottom:6px"><h1 style="margin:0; font-size:17pt">แบบรายการแสดงการส่งเงินสมทบ (สปส.1-10)</h1>'
    + '<div>ส่วนที่ 1 สรุปการนำส่ง และส่วนที่ 2 รายละเอียดผู้ประกันตน</div></div>'
    + '<div class="p-meta">' + pInfo([['ชื่อสถานประกอบการ', co.name], ['เลขที่บัญชี', payrollSetting('ssoAccount') || '__________'],
        ['ลำดับที่สาขา', payrollSetting('ssoBranch') || '000000'], ['ที่อยู่', co.address || '']])
    + pInfo([['ค่าจ้างเดือน', TH_MF[m - 1] + ' พ.ศ. ' + (y + 543)], ['อัตราเงินสมทบ', 'ร้อยละ ' + sm.rate.pct],
        ['จำนวนผู้ประกันตน', T.count + ' คน']]) + '</div>'
    + '<table style="margin-bottom:8px"><tbody>'
    + [['1. ค่าจ้างที่จ่ายจริง', T.wage], ['   ค่าจ้างที่ใช้คำนวณเงินสมทบ (' + pm(sm.rate.floor) + '–' + pm(sm.rate.ceiling) + ' บาทต่อคน)', T.base],
       ['2. เงินสมทบผู้ประกันตน', T.sso], ['3. เงินสมทบนายจ้าง', T.ssoEr], ['4. รวมเงินสมทบที่นำส่งทั้งสิ้น', T.total]]
      .map((r) => '<tr><td>' + esc(r[0]) + '</td><td class="num" style="width:40mm">' + pm(r[1]) + '</td></tr>').join('')
    + '<tr><td colspan="2" style="text-align:center"><b>(' + esc(bahtText(T.total)) + ')</b></td></tr>'
    + '<tr><td>5. จำนวนผู้ประกันตนที่ส่งเงินสมทบ</td><td class="num">' + T.count + ' คน</td></tr></tbody></table>'
    + pTable([{ t:'ลำดับที่', w:'13mm', c:1 }, { t:'เลขประจำตัวประชาชน', w:'40mm', c:1 }, { t:'คำนำหน้านาม-ชื่อ-ชื่อสกุล' },
      { t:'ค่าจ้างที่จ่ายจริง', w:'32mm', n:1, sum:1 }, { t:'เงินสมทบผู้ประกันตน', w:'30mm', n:1, sum:1 }],
      sm.rows.map((x) => [String(x.seq), x.ssoNumber || x.nationalId || '', x.name, pm(x.wage), pm(x.sso)]), 4,
      { paged: true, total: ['', '', 'รวม', pm(T.wage), pm(T.sso)] })
    + '<div class="p-note">นำส่งภายในวันที่ 15 ของเดือนถัดไป · ค่าจ้างที่จ่ายจริงไม่รวมค่าล่วงเวลาและโบนัส (ไม่ใช่ค่าจ้างตามมาตรา 5)</div>'
    + pSign(['ผู้มีอำนาจลงนาม (ลงชื่อ ตำแหน่ง และประทับตรา)']), 'สปส.1-10 ' + thPeriod(period), '');
}

const EMP_CERT_COPIES = ['ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)',
  'ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)'];
Object.assign(DOC_PRINT, {
  payslip: { title:'สลิปเงินเดือน', find: payslipFind, build: (x) => payslipSheet(x.run, x.slip) },
  payslips: { title:'สลิปเงินเดือนทุกคน', find: payRunByKey, build: (r) => r.slips.map((s) => payslipSheet(r, s)).join('') },
  pnd1Attach: { title:'ใบแนบ ภ.ง.ด.1', find: (p) => DB.periods.some((x) => x.code === p) && p, build: (p) => pnd1AttachSheet(p) },
  pnd1k: { title:'ใบแนบ ภ.ง.ด.1ก', find: (y) => payrollYear(y).rows.length && y, build: (y) => pnd1kSheet(Number(y)) },
  empCert: { title:'หนังสือรับรองการหักภาษี ณ ที่จ่าย (พนักงาน)', copies: EMP_CERT_COPIES, find: empCertFind,
    build: (x, copy) => empCertSheet(x.row, x.year, copy) },
  empCerts: { title:'50 ทวิ พนักงานทุกคน', copies: EMP_CERT_COPIES, find: (y) => payrollYear(y).rows.length && y,
    build: (y, copy) => payrollYear(y).rows.map((r) => empCertSheet(r, Number(y), copy)).join('') },
  sso110: { title:'สปส.1-10', find: (p) => DB.periods.some((x) => x.code === p) && p, build: (p) => sso110Sheet(p) },
});

/* ===================================================================
   ลงทะเบียนหน้าจอ เมนู และตัวรับเหตุการณ์
   =================================================================== */
SCREENS.payrollfile = scPayrollFile;
SCREENS.payrollyear = scPayrollYear;
Object.assign(PAGE_INFO, {
  payroll: { d:'แผ่นงานเงินเดือนของงวด — แก้ค่าล่วงเวลา วันขาดงาน โบนัส และรายการหักของแต่ละคนก่อนลงบัญชี เลือกวันที่จ่ายและบัญชีที่จ่ายได้',
    je: [['dr','เงินเดือน · เงินสมทบส่วนนายจ้าง'], ['cr','เงินฝากธนาคาร · ภาษี ภ.ง.ด.1 · ประกันสังคม/กองทุนค้างนำส่ง']], book:'สมุดรายวันทั่วไป' },
  employees: { d:'ทะเบียนพนักงาน ใช้คำนวณภาษีเงินได้ ประกันสังคม และกองทุนสำรองเลี้ยงชีพ และพิมพ์ลง ภ.ง.ด.1 · 50 ทวิ' },
  payrollfile: { d:'ใบแนบ ภ.ง.ด.1 รายคน แบบ สปส.1-10 และการนำส่งเงินสมทบประกันสังคม/กองทุนสำรองเลี้ยงชีพของเดือน',
    je: [['dr','ประกันสังคม/กองทุนค้างนำส่ง'], ['cr','เงินฝากธนาคาร']], book:'สมุดรายวันจ่าย' },
  payrollyear: { d:'เงินได้และภาษีทั้งปีของพนักงานแต่ละคน — พิมพ์ ภ.ง.ด.1ก และหนังสือรับรอง 50 ทวิ ให้พนักงาน', je: NOJE('ไม่ลงบัญชี — สรุปจากงวดเงินเดือน') },
});
FLOWS.pay = { l:'เงินเดือน', steps:['employees', 'payroll', 'payrollfile', 'pnd', 'payrollyear'] };
FLOW_OF.employees = 'pay';
FLOW_OF.payrollfile = 'pay';
FLOW_OF.payrollyear = 'pay';
ENTRY_SOURCE_SCREEN.payRemit = 'payrollfile';
Object.assign(SCREEN_WORDS, {
  payroll: 'เงินเดือน payroll สลิป payslip โบนัส bonus ค่าล่วงเวลา ot คอมมิชชั่น ค่าชดเชย',
  payrollfile: 'สปส110 ประกันสังคม sso ภงด1 ใบแนบ นำส่ง กองทุนสำรองเลี้ยงชีพ pvd',
  payrollyear: 'ภงด1ก 50ทวิ หนังสือรับรอง สรุปเงินเดือนทั้งปี',
  employees: 'พนักงาน employee ลูกจ้าง',
});
CREATE_MENU.push({ s:'เงินเดือน', icon:'payroll', items:[
  ['paydraft:new', 'จ่ายนอกรอบ (โบนัส ค่าชดเชย)'], ['payremit:sso', 'นำส่งประกันสังคม'], ['payremit:pvd', 'นำส่งกองทุนสำรองเลี้ยงชีพ'],
]});

EXTRA_DISPATCH.push(function (head, rest, arg) {
  if (head === 'run' && rest[0] === 'payroll') {
    /* ปุ่ม "ทำเงินเดือน" จากหน้าปิดงวดหรือแดชบอร์ด พาไปที่แผ่นงานก่อน — ต้องเห็นตัวเลขของแต่ละคนก่อนลงบัญชี */
    if (STATE.screen !== 'payroll') {
      STATE.screen = 'payroll'; STATE.sel = null; STATE.filter = ''; render();
      toast('ตรวจแผ่นงานเงินเดือนแล้วกด "ทำเงินเดือนงวดนี้"', 'ok', 'แก้ค่าล่วงเวลา วันขาดงาน และรายการอื่นของแต่ละคนได้ก่อนลงบัญชี');
      return true;
    }
    payRunPost(null);
    return true;
  }
  if (head === 'paypost') { payRunPost(arg); return true; }
  if (head === 'voidrun' && rest[0] === 'payroll') { modalVoidPayRun(rest.slice(1).join(':')); return true; }
  if (head === 'payrun') { STATE.sel = arg || null; render(); return true; }
  if (head === 'payline') { if (payFlush(rest[0])) modalPayLine(rest[0], rest[1]); return true; }
  if (head === 'paydraft') {
    if (rest[0] === 'new') modalNewOffcycle();
    if (rest[0] === 'del') {
      const d = payDraftFind(rest[1]);
      if (d && window.confirm('ลบแผ่นงาน "' + d.label + '"? รายการที่กรอกไว้จะหายทั้งหมด')) {
        runAction(function () { deletePayDraft(d.id); toast('ลบแผ่นงาน ' + d.label + ' แล้ว', 'ok'); });
      }
    }
    if (rest[0] === 'reset') {
      runAction(function () { deletePayDraft(rest[1]); toast('ล้างที่แก้ไว้แล้ว แผ่นงานกลับไปใช้ค่าจากทะเบียนพนักงาน', 'ok'); });
    }
    return true;
  }
  if (head === 'payremit') { modalPayRemit(rest[0], rest[1]); return true; }
  if (head === 'payremitvoid') {
    modalReason({ title:'ยกเลิกการนำส่ง ' + arg, sub:'กลับรายการใบสำคัญนำส่ง ยอดค้างนำส่งของงวดจะกลับมา',
      placeholder:'เช่น นำส่งผิดบัญชี', submitLabel:'ยกเลิกการนำส่ง', done:'ยกเลิกการนำส่ง ' + arg + ' แล้ว',
      run: (r) => voidPayRemit(arg, r) });
    return true;
  }
  if (head === 'paysettings') { modalPaySettings(); return true; }
  if (head === 'open' && rest[0] === 'payrollfile') {
    const x = DB.docs.payRemit.find((r) => r.no === rest[1]);
    if (x) STATE.period = x.period;
    STATE.screen = 'payrollfile'; STATE.sel = null; STATE.filter = ''; render();
    return true;
  }
  return false;
});

EXTRA_CHANGE.push(function (t) {
  if (t.id === 'f_remitPeriod' && t.closest('[data-remit]')) {
    modalPayRemit(t.closest('[data-remit]').getAttribute('data-remit'), t.value);
    return true;
  }
  if (!t.hasAttribute || !t.hasAttribute('data-draft')) return false;
  const id = t.getAttribute('data-draft');
  if (payInputStore(t)) paySheetRefresh(id);
  return true;
});
