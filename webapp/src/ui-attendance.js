/* ===================================================================
   ขาด ลา มาสาย — บันทึกเวลาของพนักงานรายวัน (ตรรกะอยู่ใน payroll.js)
   - สรุปรายคนของงวด: จำนวนและเงินที่จะหักในแผ่นงานเงินเดือน (หักตามเวลาที่ไม่ได้ทำงาน ไม่ใช่ค่าปรับ)
   - รายการรายวัน เพิ่ม แก้ ลบได้จนกว่าจะทำเงินเดือนงวดนั้น
   - นำเข้าไฟล์ CSV/Excel: รายการขาด/ลา/สาย หรือเวลาเข้า-ออกจากเครื่องสแกนนิ้ว — ตรวจทุกแถวก่อนนำเข้า
   =================================================================== */
const ATT_ST = { absent:['late','ขาดงาน'], unpaid:['wait','ลาไม่รับค่าจ้าง'], late:['open','มาสาย'], early:['open','กลับก่อนเวลา'] };
const ATT_SRC = { manual:'กรอกเอง', import:'นำเข้าไฟล์', clock:'เครื่องสแกนนิ้ว' };
const attQtyText = (x) => (x.type === 'absent' || x.type === 'unpaid' ? (x.days === 0.5 ? 'ครึ่งวัน' : x.days + ' วัน') : x.minutes + ' นาที');
const attEmpName = (code) => { const e = DB.employees.find((x) => x.code === code); return e ? e.name : code; };
/** จำนวนเป็นข้อความสั้น ๆ ในตาราง — ศูนย์แสดงขีด */
const attNum = (v, unit) => (v ? String(v) + (unit ? ' ' + unit : '') : '—');

function scAttendance() {
  const period = STATE.period;
  const run = activeRegularRun(period);
  const open = periodIsOpen() && !run;
  const grace = payrollSetting('lateGrace') || 0;
  const emps = DB.employees.filter((e) => employedSpan(e, period));
  const sums = emps.map(function (e) {
    const a = attendanceSummary(e.code, period);
    const amt = (unit, q) => timeDeduction(e.salary, period, unit, q);
    const money = amt('days', a.qty.absent) + amt('days', a.qty.unpaid) + amt('minutes', a.qty.late) + amt('minutes', a.qty.early);
    return { e, a, money };
  });
  const T = sums.reduce((t, x) => ({ absent: t.absent + x.a.absent, unpaid: t.unpaid + x.a.unpaid, lateTimes: t.lateTimes + x.a.late.times,
    late: t.late + x.a.late.deduct, early: t.early + x.a.early.deduct, money: t.money + x.money }),
    { absent: 0, unpaid: 0, lateTimes: 0, late: 0, early: 0, money: 0 });
  const basis = DAY_BASIS[payrollSetting('dayBasis') || 'd30'];
  const summary = card({
    title: 'ขาด ลา มาสาย', sub: thPeriod(period) + ' · ' + emps.length + ' คนที่ทำงานในงวด'
      + (run ? ' · ทำเงินเดือนแล้ว (' + (run.no || run.entryNo) + ')' : ' · ยอดนี้ไหลเข้าแผ่นงานเงินเดือนเอง'),
    actions: btn('att:new', '+ บันทึกขาด ลา สาย', open ? 'primary' : 'disabled') + btn('att:import', 'นำเข้าไฟล์', open ? '' : 'disabled')
      + btn('paysettings', 'ตั้งค่าเวลาทำงาน') + btn('go:payroll', 'ไปแผ่นงานเงินเดือน'),
    body: (run ? '<div class="note">ทำเงินเดือนงวดนี้แล้ว บันทึกเวลาถูกล็อกให้ตรงกับสลิป — ถ้าต้องแก้ ให้ยกเลิกงวดเงินเดือนก่อน'
        + ' หรือใส่ส่วนที่ตกหล่นเป็นรายการปรับปรุงในงวดถัดไป</div>' : '')
      + (emps.length ? tbl({
        cols: [{t:'รหัส'}, {t:'พนักงาน'}, {t:'ขาดงาน',a:'r'}, {t:'ลาไม่รับค่าจ้าง',a:'r'}, {t:'มาสาย (ครั้ง)',a:'r'},
          {t:'มาสายที่หัก',a:'r'}, {t:'กลับก่อนเวลา',a:'r'}, {t:'เงินที่หัก (บาท)',a:'r'}],
        rows: sums.map((x) => [{mono:x.e.code}, x.e.name, {c:attNum(x.a.absent, 'วัน')}, {c:attNum(x.a.unpaid, 'วัน')},
          {c:attNum(x.a.late.times)},
          {c: x.a.late.minutes ? x.a.late.deduct + ' นาที' + (x.a.late.deduct !== x.a.late.minutes ? ' (สาย ' + x.a.late.minutes + ')' : '') : '—'},
          {c:attNum(x.a.early.deduct, 'นาที')}, {n:x.money}]),
        rowAttr: (r, i) => 'class="row-link" data-act="attemp:' + esc(sums[i].e.code) + '" title="ดูรายการของคนนี้"',
        foot: ['', 'รวม', {c:attNum(Math.round(T.absent * 100) / 100, 'วัน')}, {c:attNum(Math.round(T.unpaid * 100) / 100, 'วัน')},
          {c:attNum(T.lateTimes)}, {c:attNum(T.late, 'นาที')}, {c:attNum(T.early, 'นาที')}, {n:T.money}],
      }) : '<div class="empty">ไม่มีพนักงานที่ทำงานในงวดนี้</div>'),
    foot: 'หักตามเวลาที่ไม่ได้ทำงานจริง ไม่ใช่ค่าปรับ (ม.76 พ.ร.บ.คุ้มครองแรงงานห้ามหักค่าจ้างเป็นค่าปรับ) · ค่าจ้างรายวัน = ' + basis
      + ' · รายนาที = รายวัน ÷ ' + (payrollSetting('hoursPerDay') || 8) + ' ชม. ÷ 60'
      + (grace ? ' · มาสายผ่อนผันครั้งละ ' + grace + ' นาที (สายเกินนั้นหักเฉพาะส่วนที่เกิน)' : '')
      + ' · ยอดในแผ่นงานเงินเดือนแก้ทับได้ ระบบเตือนถ้าไม่ตรงกับบันทึก',
  });

  /* รายการรายวัน — กรองตามประเภทและชื่อพนักงาน */
  const type = STATE.attType || 'all';
  const all = attendanceList().filter((x) => x.date.slice(0, 7) === period).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.code < b.code ? -1 : 1));
  const shown = all.filter((x) => (type === 'all' || x.type === type) && (hit(x.code) || hit(attEmpName(x.code)) || hit(x.note || '')));
  const n = (t) => all.filter((x) => x.type === t).length;
  const log = card({
    title: 'รายการรายวัน', sub: all.length + ' รายการในงวด ' + thPeriod(period),
    filters: searchBox('ค้นหาชื่อ รหัสพนักงาน หรือหมายเหตุ')
      + chip('atttype:all', 'ทั้งหมด ' + all.length, type === 'all')
      + Object.keys(ATT_ST).map((k) => chip('atttype:' + k, ATT_ST[k][1] + ' ' + n(k), type === k)).join(''),
    body: shown.length ? tbl({
      cols: [{t:'วันที่'}, {t:'พนักงาน'}, {t:'ประเภท'}, {t:'จำนวน',a:'r'}, {t:'หมายเหตุ'}, {t:'ที่มา'}, {t:''}],
      rows: shown.map((x) => [thDateNum(x.date), {html:'<span class="mono">' + esc(x.code) + '</span> ' + esc(attEmpName(x.code))},
        {st: ATT_ST[x.type]}, {c: attQtyText(x)}, x.note || '', ATT_SRC[x.src] || x.src || '',
        {html: open ? btn('att:edit:' + x.id, 'แก้') + btn('att:del:' + x.id, 'ลบ', 'danger') : ''}]),
    }) : '<div class="empty">' + (all.length ? 'ไม่มีรายการที่ตรงกับตัวกรอง' : 'ยังไม่มีบันทึกขาด ลา สายในงวดนี้')
      + (open && !all.length ? '<div style="margin-top:12px">' + btn('att:new', '+ บันทึกรายการแรก', 'primary') + ' ' + btn('att:import', 'นำเข้าไฟล์') + '</div>' : '') + '</div>',
  });
  return summary + log;
}

/** เพิ่ม/แก้รายการ — x = รายการเดิม (แก้) · code = พนักงานที่เลือกไว้ */
function modalAttendance(x, code) {
  const period = STATE.period;
  const emps = DB.employees.filter((e) => employedSpan(e, period) || (x && e.code === x.code));
  if (!emps.length) { toast('ไม่มีพนักงานที่ทำงานในงวด ' + thPeriod(period), 'err', 'เพิ่มพนักงานในทะเบียนพนักงานก่อน'); return; }
  const type = x ? x.type : 'late';
  const isDays = (t) => t === 'absent' || t === 'unpaid';
  modal({
    title: x ? 'แก้รายการ ' + ATT_ST[x.type][1] + ' · ' + attEmpName(x.code) : 'บันทึกขาด ลา มาสาย',
    sub: 'หักค่าจ้างตามเวลาที่ไม่ได้ทำงานในแผ่นงานเงินเดือนงวด ' + thPeriod(period) + ' ให้เอง',
    body: '<div class="flds">'
      + field({ name:'attCode', label:'พนักงาน', type:'select', value: x ? x.code : code || emps[0].code,
          options: emps.map((e) => [e.code, e.code + ' · ' + e.name]) })
      + field({ name:'attDate', label:'วันที่', type:'date', value: x ? x.date : defaultDate() })
      + field({ name:'attType', label:'ประเภท', type:'select', value: type,
          options: Object.keys(ATT_TYPES).map((k) => [k, ATT_TYPES[k].label]) })
      + '<div data-att-unit="minutes"' + (isDays(type) ? ' hidden' : '') + '>'
      + field({ name:'attMinutes', label:'จำนวนนาที', type:'number', value: x && x.minutes ? String(x.minutes) : '',
          placeholder:'เช่น 15', hint:'นาทีเต็ม ไม่เกิน ' + workMinutes() + ' นาที · ไม่มาทั้งวันให้เลือกขาดงาน' })
      + '</div><div data-att-unit="days"' + (isDays(type) ? '' : ' hidden') + '>'
      + field({ name:'attDays', label:'จำนวน', type:'select', value: x && x.days === 0.5 ? '0.5' : '1',
          options: [['1', 'ทั้งวัน'], ['0.5', 'ครึ่งวัน']] })
      + '</div>'
      + field({ name:'attNote', label:'หมายเหตุ', value: x ? x.note || '' : '', placeholder:'เช่น รถติด ลากิจเกินสิทธิ์', wide:true })
      + '</div><div class="note" id="attRate"></div>',
    submitLabel: x ? 'บันทึกการแก้ไข' : 'บันทึก',
    onSubmit: function () {
      submitAction(function () {
        const t = val('attType');
        const r = saveAttendance({ id: x ? x.id : null, code: val('attCode'), date: val('attDate'), type: t,
          minutes: isDays(t) ? undefined : val('attMinutes'), days: isDays(t) ? val('attDays') : undefined, note: val('attNote') });
        if (r.date.slice(0, 7) !== STATE.period && DB.periods.some((p) => p.code === r.date.slice(0, 7))) STATE.period = r.date.slice(0, 7);
        STATE.screen = 'attendance';
        toast((x ? 'แก้' : 'บันทึก') + ATT_TYPES[t].label + ' ' + attEmpName(r.code) + ' แล้ว', 'ok',
          thDate(r.date) + ' · ' + attQtyText(r) + ' · ไหลเข้าแผ่นงานเงินเดือนงวด ' + thPeriod(r.date.slice(0, 7)));
        return r;
      });
    },
  });
  attRateHint();
}
/** บอกอัตราหักของพนักงานที่เลือก — ผู้ใช้เห็นก่อนบันทึกว่าจะหักเท่าไร */
function attRateHint() {
  const el = document.getElementById('attRate');
  const e = DB.employees.find((x) => x.code === val('attCode'));
  if (!el || !e) return;
  const t = val('attType');
  const days = t === 'absent' || t === 'unpaid';
  const period = (val('attDate') || STATE.period + '-01').slice(0, 7);
  const r = payDeductRates(e, period);
  const q = days ? Number(val('attDays') || 1) : Number(val('attMinutes') || 0);
  const grace = t === 'late' ? payrollSetting('lateGrace') || 0 : 0;
  const amount = q ? timeDeduction(e.salary, period, days ? 'days' : 'minutes', days ? q : Math.max(0, q - grace)) : 0;
  el.innerHTML = 'อัตราของ ' + esc(e.name) + ': วันละ <b>' + fmt(r.perDay) + '</b> · ชั่วโมงละ ' + fmt(r.perHour)
    + ' บาท (เงินเดือน ' + fmt(e.salary) + ' ÷ ' + r.divisor + ' วัน)'
    + (q ? ' · รายการนี้หัก <b>' + fmt(amount) + '</b> บาท' + (grace && q ? ' (ผ่อนผัน ' + grace + ' นาที)' : '') : '');
}

/* ---------- นำเข้าไฟล์ ---------- */
let ATT_PENDING = null;
const ATT_TEMPLATES = {
  event: ['รหัสพนักงาน,วันที่,ประเภท,นาที,วัน,หมายเหตุ', 'EMP-0001,2026-07-03,มาสาย,15,,รถติด', 'EMP-0002,2026-07-08,ขาดงาน,,1,',
    'EMP-0002,2026-07-09,ลาไม่รับค่าจ้าง,,0.5,ลากิจเกินสิทธิ์', 'EMP-0001,2026-07-10,กลับก่อนเวลา,30,,'],
  clock: ['รหัสพนักงาน,วันที่,เวลาเข้า,เวลาออก', 'EMP-0001,2026-07-01,08:42,17:35', 'EMP-0001,2026-07-02,08:25,16:50', 'EMP-0002,2026-07-01,,'],
};
function modalAttendanceImport() {
  ATT_PENDING = null;
  modal({
    title: 'นำเข้าขาด ลา มาสาย จากไฟล์',
    sub: 'CSV หรือ Excel · ระบบดูหัวคอลัมน์เองว่าเป็นรายการขาด/ลา/สาย หรือเวลาเข้า-ออกจากเครื่องสแกนนิ้ว',
    body: '<div class="flds">'
      + '<div class="fld-w wide"><label for="attFile">เลือกไฟล์</label><input id="attFile" type="file" accept=".csv,.txt,.xlsx"></div>'
      + '</div>'
      + '<div class="note">แบบที่ 1 รายการ: รหัสพนักงาน · วันที่ · ประเภท (ขาดงาน / ลาไม่รับค่าจ้าง / มาสาย / กลับก่อนเวลา) · นาที · วัน · หมายเหตุ'
      + '<br>แบบที่ 2 เวลาเข้า-ออก: รหัสพนักงาน · วันที่ · เวลาเข้า · เวลาออก — เข้าหลัง ' + esc(payrollSetting('workStart') || '08:30')
      + ' = มาสาย · ออกก่อน ' + esc(payrollSetting('workEnd') || '17:30') + ' = กลับก่อน · ไม่มีทั้งเข้าและออก = ขาดงาน'
      + '<div style="margin-top:8px">' + btn('att:tpl:event', 'ดาวน์โหลดแบบที่ 1') + ' ' + btn('att:tpl:clock', 'ดาวน์โหลดแบบที่ 2') + '</div></div>'
      + '<div id="attPreview"></div>',
    submitLabel: 'นำเข้า',
    onSubmit: function () {
      if (!ATT_PENDING || !ATT_PENDING.rows.length) { toast('ยังไม่มีแถวที่นำเข้าได้', 'err', 'เลือกไฟล์ก่อน แล้วดูผลตรวจด้านล่าง'); return; }
      submitAction(function () {
        const r = importAttendance(ATT_PENDING.rows);
        STATE.screen = 'attendance';
        toast('นำเข้า ' + r.added + ' รายการแล้ว', r.bad.length ? 'warn' : 'ok',
          r.bad.length ? 'ข้าม ' + r.bad.length + ' แถวที่ไม่ผ่าน — ดาวน์โหลดรายการแถวที่ไม่ผ่านได้จากหน้าต่างก่อนนำเข้า' : 'ยอดไหลเข้าแผ่นงานเงินเดือนแล้ว');
        ATT_PENDING = null;
        return r;
      });
    },
  });
}
/** วันที่จากไฟล์: 2026-07-03 · 3/7/2026 · 3/7/2569 (พ.ศ.) · เลขวันที่ของ Excel */
function attDate(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) { const y = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]); return y + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0'); }
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000).toISOString().slice(0, 10);
  return s;
}
/** เวลาจากไฟล์: 08:45 · 8.45 · เศษส่วนของวันจาก Excel (0.364583) */
function attTime(v) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  if (!s) return '';
  if (/^0?\.\d+$/.test(s)) { const m = Math.round(Number(s) * 1440); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); }
  const m = /(\d{1,2})[:.](\d{2})/.exec(s);
  return m ? m[1].padStart(2, '0') + ':' + m[2] : s;
}
const ATT_WORDS = [[/ขาด|absent/i, 'absent'], [/ลา|leave|unpaid/i, 'unpaid'], [/กลับก่อน|ออกก่อน|early/i, 'early'], [/สาย|late/i, 'late']];
/** อ่านแถวจากไฟล์เป็นรายการที่ส่งเข้า importAttendance */
function attParse(rows) {
  const norm = (c) => String(c || '').trim().toLowerCase();
  let hi = -1, cols = null;
  for (let i = 0; i < Math.min(rows.length, 10) && hi < 0; i++) {
    const r = rows[i].map(norm);
    const find = (re, not) => r.findIndex((c) => re.test(c) && !(not && not.test(c)));
    const code = find(/รหัส|code|emp|^id$/, /ประชาชน|ภาษี/), date = find(/วันที่|date/);
    if (code < 0 || date < 0) continue;
    hi = i;
    cols = { code, date, type: find(/ประเภท|type|รายการ/), minutes: find(/นาที|minute/), days: find(/^วัน$|จำนวนวัน|^days?$/),
      tin: find(/เวลาเข้า|^เข้า|time ?in|check ?in|^in$/), tout: find(/เวลาออก|^ออก|time ?out|check ?out|^out$/), note: find(/หมายเหตุ|note|remark/) };
  }
  if (hi < 0) throw new DomainError('ATT_FILE_HEADER', 'ไม่พบหัวคอลัมน์ "รหัสพนักงาน" และ "วันที่" ในไฟล์',
    'ดาวน์โหลดแบบฟอร์มในหน้าต่างนี้ไปกรอก หรือแก้หัวคอลัมน์ของไฟล์จากเครื่องสแกนนิ้วให้ตรง');
  const clock = cols.tin >= 0 || cols.tout >= 0;
  if (!clock && cols.type < 0) throw new DomainError('ATT_FILE_HEADER', 'ไม่พบคอลัมน์ "ประเภท" หรือ "เวลาเข้า/เวลาออก"');
  const empOf = function (raw) {
    const s = String(raw || '').trim();
    return DB.employees.find((e) => e.code === s) || DB.employees.find((e) => e.nationalId && e.nationalId === s.replace(/\D/g, ''))
      || DB.employees.find((e) => e.name === s) || null;
  };
  const out = [], bad = [];
  rows.slice(hi + 1).forEach(function (r, k) {
    const row = (r.line || hi + 2 + k);
    const cell = (i) => (i >= 0 ? r[i] : '');
    const raw = String(cell(cols.code) || '').trim();
    if (!raw && !String(cell(cols.date) || '').trim()) return;
    const e = empOf(raw);
    const code = e ? e.code : raw;
    const date = attDate(cell(cols.date));
    if (clock) {
      clockToAttendance(code, date, attTime(cell(cols.tin)), attTime(cell(cols.tout))).forEach((x) => out.push(Object.assign({ row }, x)));
      return;
    }
    const w = ATT_WORDS.find((p) => p[0].test(String(cell(cols.type) || '')));
    if (!w) { bad.push({ row, code, date, type: '', reason: 'ไม่รู้จักประเภท "' + String(cell(cols.type) || '') + '"' }); return; }
    const t = w[1];
    const dv = String(cell(cols.days) || '').trim();
    out.push({ row, code, date, type: t, note: String(cell(cols.note) || '').trim(),
      minutes: t === 'late' || t === 'early' ? String(cell(cols.minutes) || '').trim() : undefined,
      days: t === 'absent' || t === 'unpaid' ? (/ครึ่ง/.test(dv) ? 0.5 : dv === '' ? 1 : dv) : undefined });
  });
  return { rows: out, bad, format: clock ? 'clock' : 'event' };
}
async function attFileChosen(file) {
  const box = document.getElementById('attPreview');
  ATT_PENDING = null;
  if (!box || !file) return;
  box.innerHTML = '<div class="dim">กำลังอ่านไฟล์…</div>';
  try {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 2));
    const rows = head[0] === 0x50 && head[1] === 0x4b ? await readXlsx(buf) : parseCsv(decodeText(buf));
    const p = attParse(rows);
    const dry = importAttendance(p.rows, true);
    const bad = p.bad.concat(dry.bad).sort((a, b) => a.row - b.row);
    ATT_PENDING = { rows: p.rows.filter((r) => !dry.bad.some((b) => b.row === r.row && b.type === r.type)), bad, name: file.name };
    const byType = {};
    dry.rows.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
    box.innerHTML = '<div class="note' + (bad.length ? ' warn' : '') + '">' + esc(file.name) + ' · '
      + (p.format === 'clock' ? 'เวลาเข้า-ออกจากเครื่องสแกนนิ้ว' : 'รายการขาด ลา สาย') + ' · นำเข้าได้ <b>' + dry.added + '</b> รายการ'
      + (dry.added ? ' (' + Object.keys(byType).map((k) => ATT_TYPES[k].label + ' ' + byType[k]).join(' · ') + ')' : '')
      + (bad.length ? ' · <b>ไม่ผ่าน ' + bad.length + ' แถว</b> จะถูกข้าม ' + btn('att:baddl', 'ดาวน์โหลดแถวที่ไม่ผ่าน') : '') + '</div>'
      + (bad.length ? tbl({ cols: [{t:'แถว',a:'r'}, {t:'รหัส'}, {t:'วันที่'}, {t:'เหตุผล'}],
          rows: bad.slice(0, 50).map((b) => [{c:String(b.row)}, b.code || '', b.date || '', b.reason]) }) : '');
  } catch (err) {
    box.innerHTML = '<div class="note warn">' + esc(err.message || String(err)) + (err.hint ? '<div class="dim">' + esc(err.hint) + '</div>' : '') + '</div>';
  }
}

SCREENS.attendance = scAttendance;
PAGE_INFO.attendance = { d:'บันทึกขาดงาน ลาไม่รับค่าจ้าง มาสาย และกลับก่อนเวลาของพนักงานรายวัน — ยอดของงวดไหลเข้าแผ่นงานเงินเดือนและหักตามเวลาที่ไม่ได้ทำงาน',
  je: NOJE('ไม่ลงบัญชีเอง — หักในเงินเดือนตอนทำเงินเดือนของงวด') };
FLOW_OF.attendance = 'pay';
FLOWS.pay.steps.splice(FLOWS.pay.steps.indexOf('payroll'), 0, 'attendance');
SCREEN_WORDS.attendance = 'ขาดงาน มาสาย สาย ลา ลาไม่รับค่าจ้าง กลับก่อน เวลาเข้างาน สแกนนิ้ว attendance late absent';
CREATE_MENU.forEach(function (g) { if (g.s === 'เงินเดือน') g.items.unshift(['att:new', 'บันทึกขาด ลา มาสาย']); });

EXTRA_DISPATCH.push(function (head, rest, arg) {
  if (head === 'atttype') { STATE.attType = rest[0]; render(); return true; }
  if (head === 'attemp') { STATE.filter = rest[0]; STATE.attType = 'all'; render(); return true; }
  if (head !== 'att') return false;
  if (rest[0] === 'new') {
    if (STATE.screen !== 'attendance') { STATE.screen = 'attendance'; STATE.sel = null; render(); }
    modalAttendance(null, STATE.filter && DB.employees.some((e) => e.code === STATE.filter) ? STATE.filter : null);
  }
  if (rest[0] === 'edit') { const x = attendanceList().find((r) => r.id === rest[1]); if (x) modalAttendance(x); }
  if (rest[0] === 'del') {
    const x = attendanceList().find((r) => r.id === rest[1]);
    if (x && window.confirm('ลบรายการ' + ATT_TYPES[x.type].label + ' ' + attEmpName(x.code) + ' วันที่ ' + thDate(x.date) + '?')) {
      runAction(function () { deleteAttendance(x.id); toast('ลบรายการแล้ว', 'ok', 'ยอดในแผ่นงานเงินเดือนเปลี่ยนตาม'); });
    }
  }
  if (rest[0] === 'import') modalAttendanceImport();
  if (rest[0] === 'tpl') masterDownload('attendance_' + rest[1] + '.csv', '﻿' + ATT_TEMPLATES[rest[1]].join('\r\n'));
  if (rest[0] === 'baddl' && ATT_PENDING) {
    masterDownload('attendance_rejected.csv', '﻿' + ['แถว,รหัสพนักงาน,วันที่,เหตุผล'].concat(ATT_PENDING.bad.map((b) =>
      [b.row, b.code || '', b.date || '', b.reason].map(csvQuote).join(','))).join('\r\n'));
  }
  return true;
});
EXTRA_CHANGE.push(function (t) {
  if (t.id === 'attFile') { attFileChosen(t.files && t.files[0]); return true; }
  if (t.name === 'attType') {
    const days = t.value === 'absent' || t.value === 'unpaid';
    document.querySelectorAll('#modal [data-att-unit]').forEach((el) => { el.hidden = el.getAttribute('data-att-unit') !== (days ? 'days' : 'minutes'); });
    attRateHint();
    return true;
  }
  if (t.name === 'attCode' || t.name === 'attDays' || t.name === 'attDate') { attRateHint(); return true; }
  return false;
});
EXTRA_INPUT.push(function (t) {
  if (t.name === 'attMinutes') { attRateHint(); return true; }
  return false;
});
