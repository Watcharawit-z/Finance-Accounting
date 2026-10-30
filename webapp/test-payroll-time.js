/* ทดสอบหักขาดงาน ลาไม่รับค่าจ้าง มาสาย กลับก่อนเวลา และบันทึกเวลา (payroll.js)
   รันด้วย node webapp/test-payroll-time.js — ตัวเลขที่คาดไว้คำนวณด้วยมือตามคอมเมนต์ของแต่ละข้อ */
const { ctx, ok, throws, done } = require('./testlib');
const { M, fmt } = ctx;
function nid(p12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i);
  return p12 + ((11 - (sum % 11)) % 10);
}
const emp = (o) => ctx.saveEmployee(Object.assign({ dept: 'บัญชี', hired: '2025-01-01' }, o)).employee;
const rowOf = (s, t) => s.ded.find((r) => r.type === t);
const preview = (period) => ctx.payrollPreview(ctx.payDraft(period));
const slip = (period, code) => preview(period).rows.find((s) => s.code === code);
const att = (code, date, type, q, note) => ctx.saveAttendance(Object.assign({ code, date, type, note },
  type === 'late' || type === 'early' ? { minutes: q } : { days: q }));

ctx.buildBlank({ name: 'บริษัท ทดสอบเวลาทำงาน จำกัด', year: 2026 });
ctx.TODAY = '2026-03-31';
const D = ctx.DB;
const A = emp({ name: 'นายสาย ประจำ', nationalId: nid('110170023070'), salary: '30000' });
const B = emp({ name: 'นางสาวขาด บ่อย', nationalId: nid('310050012345'), salary: '12000' });

console.log('\n=== 1. อัตราหัก: ค่าจ้างรายวัน ÷ 30 · รายนาที ÷ 8 ชม. ÷ 60 ===');
{
  const r = ctx.payDeductRates(A, '2026-01');
  /* 30,000 ÷ 30 = 1,000 ต่อวัน · ÷ 8 = 125 ต่อชั่วโมง · ÷ 60 = 2.0833… ต่อนาที (แสดงปัด 2.08) */
  ok('เงินเดือน 30,000: วันละ 1,000 · ชั่วโมงละ 125 · นาทีละ 2.08', r.perDay === M('1000') && r.perHour === M('125') && r.perMinute === M('2.08'),
    fmt(r.perDay) + ' / ' + fmt(r.perHour) + ' / ' + fmt(r.perMinute));
  /* 45 นาที = 30,000 × 45 ÷ (30 × 480) = 93.75 คิดเป็นเศษส่วนครั้งเดียว ไม่ใช่ 2.08 × 45 = 93.60 */
  ok('★ มาสาย 45 นาที = 93.75 (คิดเศษส่วนครั้งเดียว ไม่ปัดอัตราต่อนาทีก่อนคูณ)', ctx.timeDeduction(M('30000'), '2026-01', 'minutes', 45) === M('93.75'));
}

console.log('\n=== 2. บันทึกเวลา → แผ่นงานเงินเดือน ===');
{
  ctx.saveSettingsPayroll({ lateGrace: '5' });
  att(A.code, '2026-01-05', 'late', 10, 'รถติด');
  att(A.code, '2026-01-06', 'late', 3);
  att(A.code, '2026-01-07', 'late', 20);
  att(A.code, '2026-01-08', 'early', 30, 'ไปหาหมอ');
  att(A.code, '2026-01-12', 'absent', 1);
  att(A.code, '2026-01-13', 'absent', 0.5);
  att(A.code, '2026-01-13', 'unpaid', 0.5, 'ลากิจครึ่งวันเกินสิทธิ์');
  att(A.code, '2026-01-20', 'unpaid', 1);
  const sum = ctx.attendanceSummary(A.code, '2026-01');
  /* ผ่อนผัน 5 นาทีต่อครั้ง: (10−5) + 0 + (20−5) = 20 นาที */
  ok('★ มาสาย 3 ครั้ง 33 นาที หักหลังผ่อนผัน 5 นาทีต่อครั้ง = 20 นาที', sum.late.times === 3 && sum.late.minutes === 33 && sum.qty.late === 20);
  ok('ขาดงาน 1.5 วัน · ลาไม่รับค่าจ้าง 1.5 วัน · กลับก่อน 30 นาที (ไม่มีผ่อนผัน)', sum.qty.absent === 1.5 && sum.qty.unpaid === 1.5 && sum.qty.early === 30);
  const s = slip('2026-01', A.code);
  /* มาสาย 20 นาที = 41.67 · กลับก่อน 30 นาที = 62.50 · ขาด 1.5 วัน = 1,500 · ลา 1.5 วัน = 1,500 · รวม 3,104.17 */
  ok('★ แผ่นงานดึงจากบันทึกเวลาเอง: ขาด 1,500 · ลา 1,500 · สาย 41.67 · กลับก่อน 62.50',
    rowOf(s, 'absent').amount === M('1500') && rowOf(s, 'unpaid').amount === M('1500') && rowOf(s, 'late').amount === M('41.67')
    && rowOf(s, 'early').amount === M('62.5'), [rowOf(s, 'absent'), rowOf(s, 'unpaid'), rowOf(s, 'late'), rowOf(s, 'early')].map((r) => fmt(r.amount)).join(' '));
  ok('รวมหักตามเวลา 3,104.17 · เงินได้ที่ต้องเสียภาษี 26,895.83', s.unpaid === M('3104.17') && s.taxable === M('26895.83'), fmt(s.taxable));
  ok('สลิปบอกจำนวนครั้งที่มาสาย (3 ครั้ง) และที่มาของตัวเลข', rowOf(s, 'late').times === 3 && rowOf(s, 'late').src === 'log' && s.time.lateTimes === 3);
  ok('ประกันสังคมคิดจากค่าจ้างหลังหัก (เกินเพดานอยู่ดี)', s.ssoWage === M('26895.83'));

  /* พนักงานเงินเดือน 12,000 — ฐานประกันสังคมต่ำกว่าเพดาน เห็นผลชัด: ขาด 1 วัน = 400 → ค่าจ้าง 11,600 × 5% = 580 */
  att(B.code, '2026-01-15', 'absent', 1);
  const b = slip('2026-01', B.code);
  ok('★ ขาดงาน 1 วันลดฐานประกันสังคม: 11,600 × 5% = 580', b.ssoWage === M('11600') && b.sso === M('580'), fmt(b.sso));

  /* กรอกทับในแผ่นงาน — ใช้ตัวเลขที่กรอก เตือนว่าไม่ตรงกับบันทึก */
  ctx.setPayLine('R|2026-01', A.code, { late: '60' });
  const s2 = slip('2026-01', A.code);
  ok('กรอกมาสายในแผ่นงาน 60 นาทีทับบันทึกเวลา = 125.00 และเตือน', rowOf(s2, 'late').amount === M('125') && rowOf(s2, 'late').src === 'sheet'
    && s2.warn.some((w) => /มาสาย/.test(w) && /บันทึกเวลา/.test(w)), s2.warn.join(' | '));
  ctx.setPayLine('R|2026-01', A.code, { late: '' });
  ok('ลบช่องที่กรอกทับ กลับไปใช้บันทึกเวลา', rowOf(slip('2026-01', A.code), 'late').amount === M('41.67'));
}

console.log('\n=== 3. กติกาบันทึกเวลา ===');
{
  throws('บันทึกประเภทเดียวกันซ้ำวันเดียวกัน', () => att(A.code, '2026-01-05', 'late', 15), 'ATTENDANCE_DUPLICATE');
  throws('ขาดทั้งวันแล้วมาสายวันเดียวกันไม่ได้', () => att(A.code, '2026-01-12', 'late', 15), 'ATTENDANCE_CONFLICT');
  throws('ขาด + ลา วันเดียวกันรวมเกิน 1 วัน', () => att(A.code, '2026-01-20', 'absent', 0.5), 'ATTENDANCE_CONFLICT');
  throws('มาสายเกินเวลาทำงานทั้งวัน (480 นาที)', () => att(A.code, '2026-01-21', 'late', 500), 'ATTENDANCE_MINUTES_INVALID');
  throws('ขาดงานใส่ได้ 1 วันหรือครึ่งวัน', () => att(A.code, '2026-01-21', 'absent', 2), 'ATTENDANCE_DAYS_INVALID');
  throws('ก่อนวันเริ่มงานไม่ได้', () => att(A.code, '2024-12-30', 'late', 10), 'ATTENDANCE_NOT_EMPLOYED');
  throws('ประเภทไม่รู้จัก', () => ctx.saveAttendance({ code: A.code, date: '2026-01-22', type: 'sick' }), 'ATTENDANCE_TYPE_INVALID');
  const x = att(A.code, '2026-01-22', 'late', 12);
  const y = ctx.saveAttendance({ id: x.id, code: A.code, date: '2026-01-22', type: 'late', minutes: 25, note: 'แก้เวลา' });
  ok('แก้รายการเดิมได้ (เลขเดิม)', y.id === x.id && y.minutes === 25 && ctx.attendanceList().filter((r) => r.id === x.id).length === 1);
  ctx.deleteAttendance(x.id);
  ok('ลบรายการได้', !ctx.attendanceList().some((r) => r.id === x.id));
}

console.log('\n=== 4. ทำเงินเดือนแล้วล็อกบันทึกเวลา · ยกเลิกงวดแล้วแก้ได้ ===');
{
  const run = ctx.runPayroll('2026-01');
  const s = run.slips.find((r) => r.code === A.code);
  ok('★ สลิปที่ลงบัญชีเก็บรายการหักครบ 4 ชนิด พร้อมจำนวน', ['absent', 'unpaid', 'late', 'early'].every((t) => rowOf(s, t))
    && rowOf(s, 'late').qty === 20 && rowOf(s, 'absent').qty === 1.5);
  const je = D.entries.find((e) => e.no === run.entryNo);
  const salaryDr = je.lines.filter((l) => l.dr && l.acc === ctx.salaryAccount()).reduce((a, l) => a + l.dr, 0);
  ok('ค่าใช้จ่ายเงินเดือนลงด้วยค่าจ้างที่ได้จริง (หักขาด ลา สายแล้ว)', salaryDr === run.gross && run.gross === s.gross + run.slips.find((r) => r.code === B.code).gross);
  throws('★ ทำเงินเดือนแล้ว เพิ่มบันทึกเวลาในงวดนั้นไม่ได้', () => att(A.code, '2026-01-26', 'late', 10), 'ATTENDANCE_PERIOD_PAID');
  throws('ทำเงินเดือนแล้ว ลบบันทึกเวลาในงวดนั้นไม่ได้', () => ctx.deleteAttendance(ctx.attendanceList()[0].id), 'ATTENDANCE_PERIOD_PAID');
  ctx.voidPayRun(run.no, 'บันทึกมาสายตกหล่น ทดสอบ');
  att(A.code, '2026-01-26', 'late', 15);
  const s2 = slip('2026-01', A.code);
  ok('ยกเลิกงวดแล้วเพิ่มบันทึกได้ ยอดในแผ่นงานเปลี่ยนตาม (30 นาที = 62.50)', rowOf(s2, 'late').qty === 30 && rowOf(s2, 'late').amount === M('62.5'));
  const run2 = ctx.runPayroll('2026-01');
  ok('ทำเงินเดือนใหม่ได้ งบทดลองสมดุล', !!run2.no && ctx.trialBalance('2026-01-01', '2026-01-31').balanced);
}

console.log('\n=== 5. ตัวหารค่าจ้างรายวัน: 30 · วันของเดือน · วันทำงาน ===');
{
  ctx.saveSettingsPayroll({ lateGrace: '0' });
  att(A.code, '2026-02-10', 'absent', 1);
  att(A.code, '2026-02-11', 'late', 60);
  ok('ตั้งค่าเริ่มต้น ÷30: ขาด 1 วัน 1,000 · สาย 60 นาที 125', rowOf(slip('2026-02', A.code), 'absent').amount === M('1000')
    && rowOf(slip('2026-02', A.code), 'late').amount === M('125'));
  ctx.saveSettingsPayroll({ dayBasis: 'month' });
  /* กุมภาพันธ์ 2569 มี 28 วัน: 30,000 ÷ 28 = 1,071.43 · ชั่วโมงละ 133.93 (60 นาที = 30,000 × 60 ÷ (28×480) = 133.93) */
  const sm = slip('2026-02', A.code);
  ok('★ ÷ วันของเดือน (ก.พ. 28 วัน): ขาด 1 วัน 1,071.43 · สาย 60 นาที 133.93', rowOf(sm, 'absent').amount === M('1071.43')
    && rowOf(sm, 'late').amount === M('133.93'), fmt(rowOf(sm, 'absent').amount) + ' / ' + fmt(rowOf(sm, 'late').amount));
  ctx.saveSettingsPayroll({ dayBasis: 'work', workDays: '26' });
  /* 30,000 ÷ 26 = 1,153.85 */
  ok('÷ วันทำงาน 26 วัน: ขาด 1 วัน 1,153.85', rowOf(slip('2026-02', A.code), 'absent').amount === M('1153.85'));
  throws('วันทำงานต่อเดือนต้อง 20–31', () => ctx.saveSettingsPayroll({ dayBasis: 'work', workDays: '40' }), 'WORK_DAYS_RANGE');
  throws('นาทีผ่อนผันเกิน 60', () => ctx.saveSettingsPayroll({ lateGrace: '90' }), 'LATE_GRACE_RANGE');
  ctx.saveSettingsPayroll({ dayBasis: 'd30' });
  ok('ค่าล่วงเวลายังคิด ÷30 ตามกฎหมาย ไม่ขึ้นกับตัวหารที่ตั้ง', ctx.payDeductRates(A, '2026-02').divisor === 30);
}

console.log('\n=== 6. เวลาเข้า-ออกจากเครื่องสแกนนิ้ว และนำเข้าไฟล์ ===');
{
  ctx.saveSettingsPayroll({ workStart: '08:30', workEnd: '17:30' });
  const c1 = ctx.clockToAttendance(A.code, '2026-03-02', '08:47', '17:00');
  ok('★ เข้า 08:47 ออก 17:00 → มาสาย 17 นาที กลับก่อน 30 นาที', c1.length === 2 && c1[0].type === 'late' && c1[0].minutes === 17
    && c1[1].type === 'early' && c1[1].minutes === 30);
  ok('ไม่มีทั้งเวลาเข้าและออก → ขาดงาน 1 วัน', ctx.clockToAttendance(A.code, '2026-03-03', '', '')[0].type === 'absent');
  ok('เข้าตรงเวลา ออกตรงเวลา → ไม่มีรายการ', ctx.clockToAttendance(A.code, '2026-03-04', '08:30', '17:35').length === 0);
  ok('ลืมสแกนออก ไม่เดาว่ากลับก่อน', ctx.clockToAttendance(A.code, '2026-03-05', '08:20', '').length === 0);
  throws('ตั้งเวลาเลิกงานก่อนเวลาเข้างานไม่ได้', () => ctx.saveSettingsPayroll({ workStart: '17:00', workEnd: '08:00' }), 'WORK_TIME_INVALID');

  const before = ctx.attendanceList().length;
  const rows = c1.map((r, i) => Object.assign({ row: i + 2 }, r)).concat([
    { row: 4, code: B.code, date: '2026-03-02', type: 'absent', days: 1 },
    { row: 5, code: 'EMP-9999', date: '2026-03-02', type: 'late', minutes: 10 },
    { row: 6, code: B.code, date: '2026-03-02', type: 'absent', days: 1 },
  ]);
  const dry = ctx.importAttendance(rows, true);
  ok('★ ตรวจก่อนนำเข้า: ถูก 3 แถว ผิด 2 แถว (ไม่มีพนักงาน · ซ้ำในไฟล์) และยังไม่บันทึกอะไร',
    dry.added === 3 && dry.bad.length === 2 && ctx.attendanceList().length === before, dry.bad.map((b) => b.row + ':' + b.reason).join(' | '));
  const real = ctx.importAttendance(rows);
  ok('นำเข้าจริง: เข้า 3 แถว แถวที่ผิดบอกเหตุผล', real.added === 3 && ctx.attendanceList().length === before + 3 && real.bad.every((b) => b.reason));
  ok('รายการจากเครื่องสแกนนิ้วจำที่มา', ctx.attendanceList().some((r) => r.src === 'clock'));
}

console.log('\n=== 7. ข้อมูลเดิม และงวดนอกรอบ ===');
{
  ctx.setPayLine('R|2026-03', B.code, { unpaid: '2' });
  ok('แผ่นงานรุ่นก่อนที่กรอก "ขาดงาน/ลาไม่รับค่าจ้าง" ไว้ ยังหักเท่าเดิม (2 วัน × 400 = 800)', rowOf(slip('2026-03', B.code), 'unpaid').amount === M('800'));
  const oc = ctx.newOffcycleDraft({ period: '2026-03', type: 'bonus', label: 'โบนัส', payDate: '2026-03-31' });
  throws('งวดนอกรอบหักมาสายไม่ได้', () => ctx.setPayLine(oc.id, A.code, { late: '10' }), 'PAY_ITEM_REGULAR_ONLY');
  ok('งวดนอกรอบไม่ดึงบันทึกเวลา', !ctx.payrollPreview(oc).rows.some((s) => s.ded.some((r) => r.type === 'late' || r.type === 'absent')));
  throws('หักขาด ลา สายรวมเกินเงินเดือนลงบัญชีไม่ได้', function () {
    ctx.setPayLine('R|2026-03', B.code, { absent: '31' });
    ctx.runPayroll('2026-03');
  }, 'PAY_LINE_INVALID');
  ok('ยอดคุมผ่าน งบทดลองทั้งปีสมดุล', ctx.trialBalance('2026-01-01', '2026-12-31').balanced);
}

done();
