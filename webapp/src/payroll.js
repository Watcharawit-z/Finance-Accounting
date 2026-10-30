/* ===================================================================
   ระบบเงินเดือนส่วนขยาย: รายการเงินได้/เงินหักรายงวด ภ.ง.ด.1 รายคน ภ.ง.ด.1ก 50 ทวิ พนักงาน
   - ทะเบียนพนักงาน (saveEmployee) วันเริ่มงาน วันพ้นสภาพ ค่าลดหย่อน ยอดสะสมก่อนเริ่มใช้ระบบ
   - แผ่นงานเงินเดือน (payDrafts) แก้รายการของแต่ละคนได้ก่อนลงบัญชี ทั้งงวดปกติและงวดจ่ายนอกรอบ
   - ทำเงินเดือน (runPayroll) ภาษีแบบยอดสะสมทั้งปี เงินเดือนตามสัดส่วนวันทำงาน เลือกวันจ่ายและบัญชีที่จ่าย
   - ยกเลิกงวด (voidPayRun) แล้วได้แผ่นงานเดิมกลับมาแก้และทำใหม่
   - นำส่งเงินสมทบประกันสังคม/กองทุนสำรองเลี้ยงชีพ (remitPayroll)
   - ข้อมูลสำหรับ ใบแนบ ภ.ง.ด.1 · ภ.ง.ด.1ก · 50 ทวิ พนักงาน · สปส.1-10
   =================================================================== */

/* ---------- ประเภทรายการในแผ่นงานเงินเดือน ----------
   group  earn   = เงินได้ตามมาตรา 40(1) ต้องเสียภาษี และเข้า ภ.ง.ด.1
          reduce = หักค่าจ้าง (ลดเงินได้ที่ต้องเสียภาษี ไม่ใช่หักหลังภาษี)
          exempt = เงินได้ที่ได้รับยกเว้นภาษี จ่ายให้พนักงานแต่ไม่เข้า ภ.ง.ด.1
          nontax = ไม่ใช่เงินได้ของพนักงาน (คืนค่าใช้จ่ายที่ออกแทนบริษัทตามใบเสร็จ)
          ded    = หักจากเงินที่จ่าย หลังคำนวณภาษีแล้ว ลงบัญชีตาม sub
   unit   hours/days/minutes = กรอกเป็นชั่วโมง วัน หรือนาที ระบบคิดเป็นเงินจากเงินเดือน · ไม่ระบุ = กรอกเป็นจำนวนเงิน
   att    ชนิดในบันทึกเวลา (ขาด ลา มาสาย กลับก่อน) — ไม่ได้กรอกในแผ่นงาน ระบบใช้ยอดจากบันทึกเวลาของงวดนั้น
   mult   ตัวคูณค่าจ้างรายชั่วโมง [ตัวตั้ง, ตัวหาร] — เก็บเป็นเศษส่วนเพื่อไม่ใช้ทศนิยมลอยตัวกับเงิน
   sso    true = นับเป็น "ค่าจ้าง" ตาม พ.ร.บ.ประกันสังคม ม.5 (ค่าตอบแทนการทำงานในเวลาทำงานปกติ)
          ค่าล่วงเวลา โบนัส และเงินที่จ่ายครั้งเดียวไม่ใช่ค่าจ้าง จึงไม่คิดเงินสมทบ
   offcycle false = ใช้ได้เฉพาะงวดปกติที่มีเงินเดือน (หักขาดงานจากงวดที่ไม่มีเงินเดือนไม่ได้) */
const PAY_ITEMS = {
  ot:        { label:'ค่าล่วงเวลา 1.5 เท่า', unitLabel:'ชม.', group:'earn', unit:'hours', mult:[3, 2], sso:false },
  otHoliday: { label:'ค่าล่วงเวลาในวันหยุด 3 เท่า', unitLabel:'ชม.', group:'earn', unit:'hours', mult:[3, 1], sso:false },
  holiday:   { label:'ค่าทำงานในวันหยุด 1 เท่า', unitLabel:'ชม.', group:'earn', unit:'hours', mult:[1, 1], sso:false },
  allowance: { label:'ค่าตำแหน่ง ค่าครองชีพ เงินเพิ่มประจำ', group:'earn', sso:true },
  commission:{ label:'ค่าคอมมิชชั่น', group:'earn', sso:true },
  bonus:     { label:'โบนัส', group:'earn', sso:false },
  otherIncome:{ label:'เงินได้อื่น (เบี้ยขยัน รางวัล ค่าพาหนะเหมาจ่าย)', group:'earn', sso:false },
  leavePay:  { label:'ค่าจ้างวันลาพักร้อนที่ไม่ได้ใช้', group:'earn', sso:false },
  severance: { label:'ค่าชดเชยเลิกจ้าง ส่วนที่ต้องเสียภาษี', group:'earn', sso:false },
  adjust:    { label:'ปรับปรุงเงินได้ที่จ่ายผิดในงวดก่อน (+/−)', group:'earn', sso:false, signed:true },
  /* หักตามเวลาที่ไม่ได้ทำงานจริง (ไม่ทำงาน ไม่ได้ค่าจ้าง) — ลดเงินได้ ฐานประกันสังคม และฐานกองทุนสำรองฯ
     ไม่ใช่ค่าปรับ: ม.76 พ.ร.บ.คุ้มครองแรงงานห้ามหักค่าจ้างเป็นค่าปรับ ระบบจึงคิดตามสัดส่วนเวลาเท่านั้น
     unpaid คือรายการเดิม "หักขาดงาน/ลาไม่รับค่าจ้าง" — แผ่นงานที่บันทึกไว้แล้วยังหักเท่าเดิม */
  absent:    { label:'หักขาดงาน', unitLabel:'วัน', group:'reduce', unit:'days', sso:true, offcycle:false, att:'absent' },
  unpaid:    { label:'ลาไม่รับค่าจ้าง', unitLabel:'วัน', group:'reduce', unit:'days', sso:true, offcycle:false, att:'unpaid' },
  late:      { label:'หักมาสาย', unitLabel:'นาที', group:'reduce', unit:'minutes', sso:true, offcycle:false, att:'late' },
  early:     { label:'หักกลับก่อนเวลา', unitLabel:'นาที', group:'reduce', unit:'minutes', sso:true, offcycle:false, att:'early' },
  severanceExempt: { label:'ค่าชดเชยเลิกจ้าง ส่วนที่ได้รับยกเว้นภาษี', group:'exempt' },
  reimburse: { label:'คืนค่าใช้จ่ายที่ออกแทนบริษัทตามใบเสร็จ (ไม่ใช่เงินได้)', group:'nontax' },
  loan:      { label:'หักคืนเงินกู้/เงินเบิกล่วงหน้า', group:'ded', sub:'other_receivable' },
  otherDed:  { label:'หักเพื่อนำส่งผู้อื่น (กยศ. กรมบังคับคดี)', group:'ded', sub:'other_payable' },
};
const PAY_ITEM_KEYS = Object.keys(PAY_ITEMS);
/** งวดจ่ายนอกรอบที่ใช้บ่อย — รายการหลักที่แสดงเป็นช่องกรอกในแผ่นงาน */
const PAY_OFFCYCLE = {
  bonus:     { label:'โบนัส', main:'bonus' },
  commission:{ label:'ค่าคอมมิชชั่น', main:'commission' },
  final:     { label:'เงินชดเชยและเงินได้เมื่อออกจากงาน', main:'severance' },
  other:     { label:'เงินได้อื่นนอกรอบ', main:'otherIncome' },
};

/* ===================================================================
   ภาษีเงินได้บุคคลธรรมดา (เงินได้ ม.40(1))
   =================================================================== */
/* ค่าลดหย่อนส่วนตัว ม.47(1)(ก) และเพดานกองทุนสำรองเลี้ยงชีพ
   กองทุนสำรองเลี้ยงชีพ: 10,000 บาทแรกเป็นค่าลดหย่อน (ม.47) ส่วนที่เกินเป็นเงินได้ที่ได้รับยกเว้น
   ตามกฎกระทรวงฉบับที่ 126 (พ.ศ.2509) ไม่เกินร้อยละ 15 ของค่าจ้าง และไม่เกิน 490,000 บาท
   รวมสองส่วนจึงไม่เกิน 500,000 บาท — เพดาน 500,000 บาทนี้ใช้ร่วมกับ RMF SSF กบข. กอช. และประกันบำนาญ
   ซึ่งระบบไม่รู้ยอด (อยู่ในค่าลดหย่อนอื่นที่พนักงานแจ้ง) ผู้ใช้ต้องไม่กรอกส่วนที่เกินเพดานรวมเอง
   ในแบบ ภ.ง.ด.90/91 ทั้งสองส่วนหักหลังหักค่าใช้จ่าย จึงคิดรวมเป็นค่าลดหย่อนก้อนเดียวได้ */
const PIT_PERSONAL = M('60000');
const PIT_EXPENSE_MAX = M('100000');
const PVD_FIRST = M('10000');
const PVD_EXEMPT_MAX = M('490000');

/** ภาษีตามขั้นบันได จากเงินได้ทั้งปีและค่าลดหย่อนรวม (ไม่รวมค่าใช้จ่าย — คิดในนี้ 50% ไม่เกิน 100,000) */
function computePit(annualIncome, deductions) {
  const expense = Math.min(pct(Math.max(0, annualIncome), 50), PIT_EXPENSE_MAX);
  const net = Math.max(0, annualIncome - expense - deductions);
  let tax = 0;
  PIT_BRACKETS.forEach(function (b) {
    if (net <= b.lo) return;
    const top = b.hi === null ? net : Math.min(net, b.hi);
    tax += pct(top - b.lo, b.rate);
  });
  return { expense, net, tax: round2(tax) };
}

/** ส่วนของเงินสะสมกองทุนสำรองเลี้ยงชีพที่นำไปลดภาษีได้ทั้งปี (ดูหลักเกณฑ์ด้านบน) */
function pvdAllowance(paid, wages) {
  if (paid <= 0) return 0;
  const first = Math.min(paid, PVD_FIRST);
  const rest = Math.min(Math.max(0, paid - PVD_FIRST), pct(Math.max(0, wages), 15), PVD_EXEMPT_MAX);
  return first + rest;
}

/** ภาษีทั้งปีจากเงินได้ทั้งปี: o = { income, sso, pvd, other } ทุกตัวเป็นยอดทั้งปี */
function annualPit(o) {
  const income = Math.max(0, o.income || 0);
  const sso = Math.max(0, o.sso || 0);
  const pvd = pvdAllowance(o.pvd || 0, income);
  const other = Math.max(0, o.other || 0);
  const allowances = PIT_PERSONAL + sso + pvd + other;
  const r = computePit(income, allowances);
  return { income, expense: r.expense, personal: PIT_PERSONAL, sso, pvd, other, allowances, net: r.net, tax: r.tax };
}

/* ===================================================================
   ประกันสังคม — เงินสมทบคิดจากค่าจ้างทั้งเดือน
   ค่าจ้างต่ำกว่าฐานขั้นต่ำใช้ฐานขั้นต่ำ สูงกว่าเพดานใช้เพดาน (อัตราตามช่วงเวลาใน SSO_RATES)
   ปัดเศษเป็นบาท เศษตั้งแต่ 50 สตางค์ปัดขึ้น ต่ำกว่าปัดทิ้ง ตามวิธีของสำนักงานประกันสังคม
   =================================================================== */
function ssoContribution(wage, rate) {
  if (wage <= 0) return 0;
  const base = Math.min(Math.max(wage, rate.floor), rate.ceiling);
  return Math.min(divRound(pct(base, rate.pct), S) * S, rate.max);
}

/* ===================================================================
   ช่วงเวลาที่ทำงานในงวด — เงินเดือนตามสัดส่วนวันตามปฏิทินของเดือนนั้น
   ทั้งเดือน = เงินเดือนเต็ม · เข้ากลางเดือน/ออกกลางเดือน = เงินเดือน × วันที่ทำงาน ÷ วันของเดือน
   (หารด้วยวันจริงของเดือน ไม่ใช่ 30 — คนที่ทำครบเดือนได้เงินเดือนเต็มเสมอ ทั้งเดือน 28 และ 31 วัน)
   =================================================================== */
const dayCount = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
function employedSpan(e, period) {
  /* พ้นสภาพแบบไม่ได้ระบุวัน (ข้อมูลรุ่นก่อน) ไม่จ่ายอีก — ระบุวันพ้นสภาพแล้วระบบดูจากวันแทน */
  if (e.active === false && !e.left) return null;
  const start = period + '-01', end = endOfMonth(start);
  const from = e.hired && e.hired > start ? e.hired : start;
  const to = e.left && e.left < end ? e.left : end;
  if (from > to) return null;
  return { from, to, days: dayCount(from, to), dim: Number(end.slice(8)), full: from === start && to === end };
}
const spanSalary = (e, span) => (span.full ? e.salary : round2(mulDiv(e.salary, span.days, span.dim)));

/* ===================================================================
   อัตราหักขาดงาน ลาไม่รับค่าจ้าง มาสาย กลับก่อนเวลา
   ค่าจ้างรายวัน = เงินเดือน ÷ ตัวหาร (ตั้งค่าได้: 30 วัน · จำนวนวันของเดือนนั้น · วันทำงานต่อเดือนที่บริษัทกำหนด)
   ค่าจ้างรายนาที = ค่าจ้างรายวัน ÷ ชั่วโมงทำงานปกติต่อวัน ÷ 60
   คิดจากเงินเดือนเต็มเสมอ (คนที่เข้า/ออกกลางเดือนก็ใช้อัตราเดียวกัน) และคำนวณเป็นเศษส่วนครั้งเดียว ปัดสตางค์ตอนจบ
   =================================================================== */
const DAY_BASIS = { d30: 'เงินเดือน ÷ 30 วัน', month: 'เงินเดือน ÷ จำนวนวันของเดือนนั้น', work: 'เงินเดือน ÷ วันทำงานต่อเดือน' };
function dayDivisor(period) {
  const b = payrollSetting('dayBasis') || 'd30';
  if (b === 'month') return Number(endOfMonth(period + '-01').slice(8));
  if (b === 'work') return payrollSetting('workDays') || 26;
  return 30;
}
/** นาทีทำงานปกติต่อวัน (ชั่วโมงทำงานปกติ × 60) */
const workMinutes = () => Math.round((payrollSetting('hoursPerDay') || 8) * 60);
/** เงินที่หักตามเวลาที่ไม่ได้ทำงาน — unit 'days' หรือ 'minutes' */
function timeDeduction(salary, period, unit, q) {
  if (!q || !salary) return 0;
  const div = dayDivisor(period) * (unit === 'minutes' ? workMinutes() : 1);
  return round2(mulDiv(salary, M(String(q)), div * S));
}
/** อัตราที่แสดงให้ผู้ใช้เห็น — ต่อวัน ต่อชั่วโมง ต่อนาที */
function payDeductRates(e, period) {
  return { perDay: timeDeduction(e.salary, period, 'days', 1), perMinute: timeDeduction(e.salary, period, 'minutes', 1),
    perHour: timeDeduction(e.salary, period, 'minutes', 60), divisor: dayDivisor(period), basis: payrollSetting('dayBasis') || 'd30',
    minutes: workMinutes() };
}
function employedInYear(e, year) {
  if (e.active === false && !e.left) return false;
  return (!e.hired || e.hired <= year + '-12-31') && (!e.left || e.left >= year + '-01-01');
}
const pvdErRateOf = (e) => (e.pvdErRate === null || e.pvdErRate === undefined ? (e.pvdRate || 0) : e.pvdErRate);

/* ===================================================================
   ยอดสะสมของพนักงานในปีภาษี — ปีภาษีนับตามวันที่จ่ายเงิน (เงินได้ถือตามเกณฑ์เงินสด)
   รวมยอดที่บริษัทจ่ายไปแล้วก่อนเริ่มใช้ระบบ (ytdOpening) ด้วย
   =================================================================== */
const runIsLive = (r) => r.status !== 'void';
const runIsRegular = (r) => r.kind !== 'offcycle';
const slipTaxable = (s) => (s.taxable !== undefined ? s.taxable : s.gross);   // สลิปรุ่นก่อน: เงินได้ทั้งหมดต้องเสียภาษี
function payYtd(code, year, upto) {
  const out = { income: 0, tax: 0, sso: 0, pvd: 0, ssoEr: 0, pvdEr: 0, exempt: 0, reimburse: 0, net: 0, runs: 0, opening: null };
  const e = DB.employees.find((x) => x.code === code);
  const op = e && e.ytdOpening && Number(e.ytdOpening.year) === year ? e.ytdOpening : null;
  if (op) {
    out.opening = op;
    out.income += op.income || 0; out.tax += op.tax || 0; out.sso += op.sso || 0; out.pvd += op.pvd || 0;
  }
  DB.docs.payRun.forEach(function (r) {
    if (!runIsLive(r) || Number(String(r.date).slice(0, 4)) !== year) return;
    if (upto && r.date > upto) return;
    (r.slips || []).forEach(function (s) {
      if (s.code !== code) return;
      out.income += slipTaxable(s); out.tax += s.pit || 0; out.sso += s.sso || 0; out.pvd += s.pvd || 0;
      out.ssoEr += s.ssoEr !== undefined ? s.ssoEr : (s.sso || 0);
      out.pvdEr += s.pvdEr !== undefined ? s.pvdEr : (s.pvd || 0);
      out.exempt += s.exempt || 0; out.reimburse += s.reimburse || 0; out.net += s.net || 0;
      out.runs++;
    });
  });
  return out;
}
/** ค่าจ้างและเงินสมทบประกันสังคมที่จ่ายไปแล้วในเดือนค่าจ้างเดียวกัน (กรณีจ่ายหลายรอบในเดือน เพดานคิดรวมทั้งเดือน) */
function paidInMonth(code, period) {
  const out = { wage: 0, sso: 0, ssoEr: 0 };
  DB.docs.payRun.forEach(function (r) {
    if (!runIsLive(r) || r.period !== period) return;
    (r.slips || []).forEach(function (s) {
      if (s.code !== code) return;
      out.wage += s.ssoWage !== undefined ? s.ssoWage : (s.salary || 0);
      out.sso += s.sso || 0;
      out.ssoEr += s.ssoEr !== undefined ? s.ssoEr : (s.sso || 0);
    });
  });
  return out;
}
const regularRunHas = (code, period) => DB.docs.payRun.some((r) => runIsLive(r) && runIsRegular(r)
  && r.period === period && (r.slips || []).some((s) => s.code === code));

/** เงินเดือนประจำที่ยังจะจ่ายต่อจากงวดนี้จนสิ้นปี (หรือถึงเดือนที่พ้นสภาพ) — ใช้ประมาณเงินได้ทั้งปี
    เดือนที่ทำงวดปกติไปแล้วอยู่ในยอดสะสมแล้ว ไม่นับซ้ำ · งวดนอกรอบนับเดือนของตัวเองถ้างวดปกติยังไม่ได้ทำ
    เงินเดือนธันวาคมที่จ่ายต้นเดือนมกราคม ถือเป็นเงินได้ของปีถัดไป ประมาณการจึงอาจสูงไปหนึ่งเดือน
    ส่วนนี้แก้ตัวเองในงวดถัดไปเพราะทุกงวดคิดจากยอดสะสมจริง */
function futureRegular(e, d, year) {
  const out = { months: 0, income: 0, sso: 0, pvd: 0 };
  if (!e.salary) return out;
  for (let m = 1; m <= 12; m++) {
    const p = year + '-' + String(m).padStart(2, '0');
    if (p < d.period) continue;
    if (p === d.period && d.kind === 'regular') continue;
    const span = employedSpan(e, p);
    if (!span || regularRunHas(e.code, p)) continue;
    const sal = spanSalary(e, span);
    out.months++;
    out.income += sal;
    if (!e.ssoExempt) out.sso += ssoContribution(sal, ssoRate(endOfMonth(p + '-01')));
    if (e.pvdRate) out.pvd += round2(pct(sal, e.pvdRate));
  }
  return out;
}

/* ===================================================================
   คำนวณสลิปของพนักงานหนึ่งคนในแผ่นงาน
   ★ ภาษีหัก ณ ที่จ่ายแบบยอดสะสมทั้งปี (cumulative) — หลักเดียวกับประมวลรัษฎากร ม.50(1) ที่ให้คำนวณภาษี
     เสมือนจ่ายเงินได้ทั้งปีแล้วเฉลี่ยตามจำนวนครั้งที่จ่าย แต่ใช้ยอดที่จ่ายจริงตั้งแต่ต้นปีแทนการคูณ 12 ทุกเดือน:
     A = เงินได้ที่จ่ายแล้วทั้งปี + เงินเดือนงวดนี้ + เงินเดือนที่จะจ่ายต่อจนสิ้นปี
     B = A + เงินได้ไม่ประจำงวดนี้ (ค่าล่วงเวลา ค่าคอมมิชชั่น โบนัส ค่าชดเชย ฯลฯ)
     ภาษีงวดนี้ = (ภาษีทั้งปีของ A − ภาษีที่หักไปแล้ว) ÷ จำนวนงวดเงินเดือนที่เหลือรวมงวดนี้
                + (ภาษีทั้งปีของ B − ภาษีทั้งปีของ A)          ← เงินได้ไม่ประจำหักส่วนเพิ่มทั้งก้อนในงวดที่จ่าย
     งวดนอกรอบไม่หักส่วนของเงินเดือนประจำ เว้นแต่ไม่มีงวดเงินเดือนเหลือแล้ว (ออกจากงาน/หลังงวดธันวาคม)
     ผลคือภาษีงวดสุดท้ายของปีปิดยอดให้เท่าภาษีทั้งปีพอดี โบนัสไม่ถูกคูณ 12 แล้วหักเกิน
     เงินเดือนขึ้นลงหรือเข้าออกกลางปีก็ปรับเองในงวดถัดไป ไม่หักติดลบ (ส่วนที่หักเกินพนักงานขอคืนตอนยื่นแบบ)
   =================================================================== */
function paySlipCalc(e, d, L) {
  const regular = d.kind === 'regular';
  const span = regular ? employedSpan(e, d.period) : null;
  const base = span ? spanSalary(e, span) : 0;
  /* ขาด ลา มาสาย กลับก่อน ที่ไม่ได้กรอกในแผ่นงาน ใช้ยอดจากบันทึกเวลาของงวด (มาสายหักหลังหักนาทีผ่อนผันแล้ว) */
  const att = regular ? attendanceSummary(e.code, d.period) : null;
  const fromLog = (t) => (att && PAY_ITEMS[t].att ? att.qty[PAY_ITEMS[t].att] : 0);
  const qty = (t) => (L[t] !== undefined ? L[t] : PAY_ITEMS[t].att ? fromLog(t) : (t === 'ot' && regular ? (e.otHours || 0) : 0));
  const hoursPerDay = payrollSetting('hoursPerDay') || 8;
  const earn = [], ded = [];
  let unpaid = 0, ot = 0, otHours = 0, variable = 0, ssoExtra = 0, exempt = 0, reimburse = 0, loan = 0, otherDed = 0;
  let error = null;
  PAY_ITEM_KEYS.forEach(function (t) {
    const def = PAY_ITEMS[t];
    const q = qty(t);
    if (!q) return;
    let amount;
    if (def.unit === 'hours') {
      /* ค่าจ้างรายชั่วโมง = เงินเดือน ÷ 30 ÷ ชั่วโมงทำงานปกติต่อวัน (พ.ร.บ.คุ้มครองแรงงาน) */
      amount = round2(mulDiv(e.salary, M(String(q)) * def.mult[0], 30 * hoursPerDay * S * def.mult[1]));
      ot += amount; otHours += q;
    } else if (def.unit === 'days' || def.unit === 'minutes') {
      amount = timeDeduction(e.salary, d.period, def.unit, q);       // ค่าจ้างรายวัน = เงินเดือน ÷ ตัวหาร (ตั้งค่า)
    } else amount = q;
    if (!amount) return;
    const row = { type: t, label: def.label, qty: def.unit ? q : null, unit: def.unitLabel || null, amount };
    /* มาสาย/กลับก่อนจากบันทึกเวลา บอกจำนวนครั้งด้วย (พิมพ์บนสลิป) · src บอกว่ามาจากบันทึกเวลาหรือกรอกเอง */
    if (def.att) {
      row.src = L[t] !== undefined ? 'sheet' : 'log';
      if (row.src === 'log' && (t === 'late' || t === 'early')) row.times = att[t].times;
    }
    if (def.group === 'earn') { variable += amount; if (def.sso) ssoExtra += amount; earn.push(row); }
    else if (def.group === 'reduce') { unpaid += amount; ded.push(row); }
    else if (def.group === 'exempt') { exempt += amount; earn.push(row); }
    else if (def.group === 'nontax') { reimburse += amount; earn.push(row); }
    else { if (t === 'loan') loan += amount; else otherDed += amount; ded.push(row); }
  });
  if (unpaid > base) error = 'หักขาด ลา มาสาย ' + fmt(unpaid) + ' บาท เกินเงินเดือนของงวดนี้ ' + fmt(base) + ' บาท';
  const regularIncome = base - unpaid;
  const taxable = regularIncome + variable;

  /* ประกันสังคม — ค่าจ้างทั้งเดือน (รวมรอบที่จ่ายไปแล้วในเดือนเดียวกัน) แล้วหักส่วนที่หักไปแล้ว */
  const ssoR = ssoRate(d.payDate);
  const ssoWage = e.ssoExempt ? 0 : Math.max(0, regularIncome + ssoExtra);
  let sso = 0, ssoEr = 0;
  if (ssoWage > 0) {
    const before = paidInMonth(e.code, d.period);
    const full = ssoContribution(before.wage + ssoWage, ssoR);
    sso = Math.max(0, full - before.sso);
    ssoEr = Math.max(0, full - before.ssoEr);
  }
  /* กองทุนสำรองเลี้ยงชีพคิดจากเงินเดือน (ค่าจ้างตามข้อบังคับกองทุน) ไม่รวมค่าล่วงเวลาและโบนัส */
  const pvdWage = Math.max(0, regularIncome);
  const pvd = e.pvdRate ? round2(pct(pvdWage, e.pvdRate)) : 0;
  const pvdEr = pvdErRateOf(e) ? round2(pct(pvdWage, pvdErRateOf(e))) : 0;

  /* ภาษีหัก ณ ที่จ่ายแบบยอดสะสม (ดูคำอธิบายด้านบน) */
  const year = Number(d.payDate.slice(0, 4));
  const ytd = payYtd(e.code, year);
  const fut = futureRegular(e, d, year);
  const ssoYear = ytd.sso + sso + fut.sso;
  const pvdYear = ytd.pvd + pvd + fut.pvd;
  const other = e.deductions || 0;
  const pa = annualPit({ income: ytd.income + regularIncome + fut.income, sso: ssoYear, pvd: pvdYear, other });
  const pb = annualPit({ income: ytd.income + regularIncome + fut.income + variable, sso: ssoYear, pvd: pvdYear, other });
  const remaining = fut.months + (regular ? 1 : 0);
  let share = 0;
  if (regular) share = divRound(pa.tax - ytd.tax, remaining);
  else if (remaining === 0) share = pa.tax - ytd.tax;
  const pit = round2(Math.max(0, share + (pb.tax - pa.tax)));

  if (pvd) ded.push({ type: 'pvd', label: 'เงินสะสมกองทุนสำรองเลี้ยงชีพ ' + e.pvdRate + '%', amount: pvd });
  if (sso) ded.push({ type: 'sso', label: 'เงินสมทบประกันสังคม', amount: sso });
  if (pit) ded.push({ type: 'pit', label: 'ภาษีเงินได้หัก ณ ที่จ่าย', amount: pit });
  const gross = taxable + exempt;
  const net = gross + reimburse - pit - sso - pvd - loan - otherDed;
  if (!error && net < 0) error = 'เงินที่ต้องจ่ายติดลบ ' + fmt(net) + ' บาท — รายการหักมากกว่าเงินได้';
  const pay = !!(base || variable || exempt || reimburse || loan || otherDed);

  return {
    code: e.code, name: e.name, dept: e.dept, nationalId: e.nationalId || null, ssoNumber: e.ssoNumber || null,
    fullSalary: e.salary, days: span ? span.days : 0, dim: span ? span.dim : 0, prorated: !!(span && !span.full),
    salary: base, unpaid, ot, otHours, variable, taxable, exempt, reimburse, gross,
    /* จำนวนขาด ลา มาสาย ที่ใช้คิดในสลิปนี้ — รายงานสรุปการมาทำงานใช้ */
    time: { absent: qty('absent'), unpaid: qty('unpaid'), late: qty('late'), early: qty('early'),
      lateTimes: att && L.late === undefined ? att.late.times : null, earlyTimes: att && L.early === undefined ? att.early.times : null },
    sso, ssoEr, ssoWage, ssoBase: ssoWage ? Math.min(Math.max(ssoWage, ssoR.floor), ssoR.ceiling) : 0,
    pvd, pvdEr, pvdWage, pit, loan, otherDed, net, earn, ded, pay, error,
    calc: { year, prevIncome: ytd.income, prevTax: ytd.tax, future: fut.months, futureIncome: fut.income,
      annual: pb.income, allowances: pb.allowances, expense: pb.expense, net: pb.net, annualTax: pb.tax, remaining },
    ytd: { income: ytd.income + taxable, tax: ytd.tax + pit, sso: ytd.sso + sso, pvd: ytd.pvd + pvd },
  };
}

/* ===================================================================
   ค่าตั้งของระบบเงินเดือน — เก็บใน DB.settings.payroll (บัญชีที่จ่ายล่าสุด เลขที่บัญชีนายจ้างประกันสังคม)
   =================================================================== */
function payrollSetting(k) {
  const s = DB.settings && DB.settings.payroll;
  return s ? s[k] : undefined;
}
function payrollSettingSet(k, v) {
  if (!DB.settings) DB.settings = { hardLockDate: null };
  if (!DB.settings.payroll) DB.settings.payroll = {};
  DB.settings.payroll[k] = v;
}
function assertPayAccount(code) {
  const a = DB.accounts.find((x) => x.code === code);
  if (!a || !a.postable || (a.subType !== 'bank' && a.subType !== 'cash')) {
    throw new DomainError('PAY_FROM_INVALID', 'ต้องจ่ายจากบัญชีเงินสดหรือเงินฝากธนาคาร',
      'เลือกบัญชีธนาคารที่โอนเงินเดือนจริง หรือเงินสดถ้าจ่ายเป็นเงินสด');
  }
  return a.code;
}
function defaultPayFrom() {
  const last = payrollSetting('payFrom');
  if (last && payFromAccounts().some((a) => a.code === last)) return last;
  return accBySub('bank');
}
function saveSettingsPayroll(input) {
  const ssoAccount = String(input.ssoAccount || '').replace(/[^0-9]/g, '');
  if (ssoAccount && ssoAccount.length !== 10) {
    throw new DomainError('SSO_ACCOUNT_INVALID', 'เลขที่บัญชีนายจ้างประกันสังคมต้องเป็นตัวเลข 10 หลัก',
      'ดูได้จากหนังสือแจ้งการขึ้นทะเบียนนายจ้าง (สปส.1-01) หรือแบบ สปส.1-10 ที่เคยยื่น');
  }
  const hours = Number(input.hoursPerDay || 8);
  if (!(hours > 0 && hours <= 12)) {
    throw new DomainError('HOURS_PER_DAY_RANGE', 'ชั่วโมงทำงานปกติต่อวันต้องอยู่ระหว่าง 1 ถึง 12 ชั่วโมง');
  }
  /* ขาด ลา มาสาย — ตัวหารค่าจ้างรายวัน นาทีผ่อนผันมาสายต่อครั้ง เวลาเข้า-ออกงาน (ใช้แปลงไฟล์เครื่องสแกนนิ้ว)
     ไม่ส่งมา = คงค่าเดิม */
  const given = (k) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== '';
  const basis = given('dayBasis') ? input.dayBasis : payrollSetting('dayBasis') || 'd30';
  if (!DAY_BASIS[basis]) throw new DomainError('DAY_BASIS_INVALID', 'วิธีคิดค่าจ้างรายวันไม่ถูกต้อง');
  const workDays = given('workDays') ? Number(input.workDays) : payrollSetting('workDays') || 26;
  if (basis === 'work' && !(Number.isInteger(workDays) && workDays >= 20 && workDays <= 31)) {
    throw new DomainError('WORK_DAYS_RANGE', 'วันทำงานต่อเดือนต้องเป็นจำนวนเต็ม 20 ถึง 31 วัน');
  }
  const grace = given('lateGrace') ? Number(input.lateGrace) : payrollSetting('lateGrace') || 0;
  if (!(Number.isInteger(grace) && grace >= 0 && grace <= 60)) {
    throw new DomainError('LATE_GRACE_RANGE', 'นาทีผ่อนผันมาสายต้องเป็นจำนวนเต็ม 0 ถึง 60 นาที');
  }
  const hhmm = function (k, def) {
    const v = given(k) ? String(input[k]).trim() : payrollSetting(k) || def;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw new DomainError('WORK_TIME_INVALID', 'เวลาต้องอยู่ในรูป ชม.:นาที เช่น 08:30');
    return v;
  };
  const workStart = hhmm('workStart', '08:30'), workEnd = hhmm('workEnd', '17:30');
  if (workEnd <= workStart) throw new DomainError('WORK_TIME_INVALID', 'เวลาเลิกงานต้องหลังเวลาเข้างาน');
  payrollSettingSet('ssoAccount', ssoAccount || null);
  payrollSettingSet('ssoBranch', String(input.ssoBranch || '').trim() || '000000');
  payrollSettingSet('hoursPerDay', hours);
  payrollSettingSet('dayBasis', basis);
  payrollSettingSet('workDays', workDays);
  payrollSettingSet('lateGrace', grace);
  payrollSettingSet('workStart', workStart);
  payrollSettingSet('workEnd', workEnd);
  audit('payroll', 'settings', 'update', null, { ssoAccount: ssoAccount || '—', hoursPerDay: hours, dayBasis: basis,
    workDays, lateGrace: grace, workStart, workEnd });
  return DB.settings.payroll;
}

/* ===================================================================
   แผ่นงานเงินเดือน (ร่าง) — แก้ได้ก่อนลงบัญชี
   งวดปกติ: id = "R|2026-07" หนึ่งแผ่นต่อเดือน ยังไม่ได้แก้ก็ไม่เก็บลงฐานข้อมูล (ใช้ค่าจากทะเบียนพนักงาน)
   งวดนอกรอบ: id = "X|2026-07|1" สร้างได้หลายแผ่นต่อเดือน (โบนัส ค่าคอมมิชชั่น เงินชดเชยเมื่อออกจากงาน)
   lines[รหัสพนักงาน] = { ประเภทรายการ: จำนวน } — ชั่วโมง/วันเป็นตัวเลขธรรมดา จำนวนเงินเป็นจำนวนเต็มสเกล 4 ตำแหน่ง
   =================================================================== */
const payDraftList = () => DB.payDrafts || (DB.payDrafts = []);
const payDraftFind = (id) => payDraftList().find((d) => d.id === id) || null;
function payDraftDefault(period) {
  return { id: 'R|' + period, period, kind: 'regular', type: 'regular', label: 'เงินเดือน',
    payDate: endOfMonth(period + '-01'), payFrom: defaultPayFrom(), lines: {} };
}
/** แผ่นงานงวดปกติของเดือน — ที่แก้ไว้แล้ว หรือแผ่นใหม่จากทะเบียนพนักงาน */
function payDraft(period) { return payDraftFind('R|' + period) || payDraftDefault(period); }
function payDraftsOf(period) { return payDraftList().filter((d) => d.period === period); }
function payDraftEnsure(id) {
  let d = payDraftFind(id);
  if (d) return d;
  const m = /^R\|(\d{4}-\d{2})$/.exec(id || '');
  if (!m) throw new DomainError('PAY_DRAFT_NOT_FOUND', 'ไม่พบแผ่นงานเงินเดือนนี้ อาจลงบัญชีหรือลบไปแล้ว');
  d = payDraftDefault(m[1]);
  payDraftList().push(d);
  return d;
}
function assertPeriodExists(period) {
  if (!DB.periods.some((p) => p.code === period)) {
    throw new DomainError('PERIOD_NOT_FOUND', 'ยังไม่ได้สร้างงวดบัญชี ' + period, 'สร้างรอบบัญชีในหน้าตั้งค่าก่อน');
  }
}
/** วันที่จ่ายต้องอยู่ในเดือนของงวดหรือเดือนถัดไป (เงินเดือนสิ้นเดือนที่โอนต้นเดือนหน้า) */
function assertPayDate(period, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่จ่ายเงินเดือน');
  const start = period + '-01';
  const last = endOfMonth(addDays(endOfMonth(start), 1));
  if (date < start || date > last) {
    throw new DomainError('PAY_DATE_RANGE', 'วันที่จ่าย ' + thDate(date) + ' ต้องอยู่ระหว่าง ' + thDate(start) + ' ถึง ' + thDate(last),
      'เงินเดือนของเดือนใดจ่ายได้ภายในเดือนนั้นหรือต้นเดือนถัดไป · ภ.ง.ด.1 นับตามเดือนที่จ่ายจริง');
  }
}

/** แก้หัวแผ่นงาน: วันที่จ่าย บัญชีที่จ่าย ชื่องวด */
function savePayDraft(input) {
  const d = payDraftEnsure(input.id);
  if (input.payDate !== undefined) { assertPayDate(d.period, input.payDate); d.payDate = input.payDate; }
  if (input.payFrom !== undefined) d.payFrom = assertPayAccount(input.payFrom);
  if (input.label !== undefined && d.kind !== 'regular') d.label = String(input.label).trim() || d.label;
  return d;
}

/** สร้างแผ่นงานจ่ายนอกรอบ เช่น โบนัสกลางปี ค่าคอมมิชชั่น เงินชดเชยคนที่ออก */
function newOffcycleDraft(input) {
  const period = input.period;
  assertPeriodExists(period);
  const type = PAY_OFFCYCLE[input.type] ? input.type : 'bonus';
  const payDate = input.payDate || endOfMonth(period + '-01');
  assertPayDate(period, payDate);
  const payFrom = assertPayAccount(input.payFrom || defaultPayFrom());
  let n = 1;
  while (payDraftFind('X|' + period + '|' + n)) n++;
  const d = { id: 'X|' + period + '|' + n, period, kind: 'offcycle', type,
    label: String(input.label || '').trim() || PAY_OFFCYCLE[type].label, payDate, payFrom, lines: {} };
  payDraftList().push(d);
  audit('payroll', d.id, 'draft', null, { label: d.label, period });
  return d;
}

/** แก้รายการของพนักงานหนึ่งคนในแผ่นงาน — values = { ประเภท: ค่า } ค่าว่างคือกลับไปใช้ค่าปกติ */
function setPayLine(id, code, values, skip) {
  const d = payDraftEnsure(id);
  const e = DB.employees.find((x) => x.code === code);
  if (!e) throw new DomainError('EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานรหัส ' + code);
  const L = Object.assign({}, d.lines[code] || {});
  Object.keys(values || {}).forEach(function (t) {
    const def = PAY_ITEMS[t];
    if (!def) throw new DomainError('PAY_ITEM_UNKNOWN', 'ไม่รู้จักรายการ ' + t);
    const raw = values[t];
    if (raw === '' || raw === null || raw === undefined) { delete L[t]; return; }
    if (def.offcycle === false && d.kind !== 'regular') {
      throw new DomainError('PAY_ITEM_REGULAR_ONLY', def.label + ' ใช้ได้เฉพาะงวดเงินเดือนปกติ');
    }
    if (def.unit) {
      const n = Number(String(raw).replace(/,/g, ''));
      const max = def.unit === 'minutes' ? 31 * workMinutes() : 744;
      if (!isFinite(n) || n < 0 || n > max) {
        throw new DomainError('PAY_QTY_INVALID', e.name + ': ' + def.label + ' ต้องเป็นจำนวน' + def.unitLabel + 'ตั้งแต่ 0 ถึง ' + max.toLocaleString('en-US'));
      }
      if (def.unit === 'days' && n > 31) throw new DomainError('PAY_QTY_INVALID', e.name + ': ' + def.label + ' เกิน 31 วัน');
      if (def.unit === 'minutes' && Math.round(n) !== n) throw new DomainError('PAY_QTY_INVALID', e.name + ': ' + def.label + ' ต้องเป็นนาทีเต็ม');
      L[t] = Math.round(n * 100) / 100;
    } else {
      const v = M(String(raw));
      if (v < 0 && !def.signed) throw new DomainError('PAY_AMOUNT_NEGATIVE', e.name + ': ' + def.label + ' ติดลบไม่ได้');
      L[t] = v;
    }
  });
  if (skip !== undefined) { if (skip) L.skip = true; else delete L.skip; }
  if (Object.keys(L).length) d.lines[code] = L; else delete d.lines[code];
  return d;
}
function deletePayDraft(id) {
  const list = payDraftList();
  const i = list.findIndex((d) => d.id === id);
  if (i < 0) throw new DomainError('PAY_DRAFT_NOT_FOUND', 'ไม่พบแผ่นงานนี้');
  const d = list[i];
  list.splice(i, 1);
  audit('payroll', id, 'draft_delete', null, { label: d.label });
  return d;
}

/* ===================================================================
   บันทึกเวลา — ขาดงาน ลาไม่รับค่าจ้าง มาสาย กลับก่อนเวลา รายวัน
   ใส่ทีละรายการ หรือนำเข้าจากไฟล์ (รายการขาด/ลา/สาย หรือเวลาเข้า-ออกจากเครื่องสแกนนิ้ว)
   ยอดของงวดไหลเข้าแผ่นงานเงินเดือนเอง (ช่องที่ไม่ได้กรอกทับ) · มาสายหักหลังหักนาทีผ่อนผันต่อครั้ง
   งวดที่ทำเงินเดือนแล้วแก้บันทึกเวลาไม่ได้ ตัวเลขในสลิปกับบันทึกจะได้ตรงกันเสมอ — ยกเลิกงวดแล้วแก้ได้
   =================================================================== */
const ATT_TYPES = {
  absent: { label: 'ขาดงาน', unit: 'days' },
  unpaid: { label: 'ลาไม่รับค่าจ้าง', unit: 'days' },
  late:   { label: 'มาสาย', unit: 'minutes' },
  early:  { label: 'กลับก่อนเวลา', unit: 'minutes' },
};
const attendanceList = () => DB.attendance || (DB.attendance = []);
/** ยอดของพนักงานหนึ่งคนในงวด — qty คือจำนวนที่ใช้หัก (มาสายหลังหักนาทีผ่อนผันแล้ว) */
function attendanceSummary(code, period) {
  const grace = payrollSetting('lateGrace') || 0;
  const entries = attendanceList().filter((x) => x.code === code && x.date.slice(0, 7) === period);
  const out = { entries, absent: 0, unpaid: 0, late: { times: 0, minutes: 0, deduct: 0 }, early: { times: 0, minutes: 0, deduct: 0 } };
  entries.forEach(function (x) {
    if (x.type === 'absent' || x.type === 'unpaid') out[x.type] = Math.round((out[x.type] + x.days) * 100) / 100;
    else {
      const o = out[x.type];
      o.times += 1; o.minutes += x.minutes;
      o.deduct += x.type === 'late' ? Math.max(0, x.minutes - grace) : x.minutes;
    }
  });
  out.qty = { absent: out.absent, unpaid: out.unpaid, late: out.late.deduct, early: out.early.deduct };
  return out;
}
/** งวดที่แก้บันทึกเวลาได้ — งวดบัญชียังเปิด และยังไม่ได้ทำเงินเดือนปกติของเดือนนั้น */
function assertAttendanceOpen(period) {
  const p = DB.periods.find((x) => x.code === period);
  if (!p) throw new DomainError('PERIOD_NOT_FOUND', 'ยังไม่ได้สร้างงวดบัญชี ' + period, 'สร้างรอบบัญชีในหน้าตั้งค่าก่อน');
  if (p.status !== 'open') throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(period) + ' ปิดแล้ว แก้บันทึกเวลาไม่ได้');
  const run = activeRegularRun(period);
  if (run) {
    throw new DomainError('ATTENDANCE_PERIOD_PAID', 'ทำเงินเดือนงวด ' + thPeriod(period) + ' แล้ว (' + (run.no || run.entryNo) + ') แก้บันทึกเวลาไม่ได้',
      'ยกเลิกงวดเงินเดือนก่อนแล้วแก้ หรือใส่ยอดที่ตกหล่นเป็นรายการปรับปรุงในงวดถัดไป');
  }
}
/** เพิ่มหรือแก้หนึ่งรายการ — input = { id?, code, date, type, minutes | days, note } */
function saveAttendance(input) {
  const e = DB.employees.find((x) => x.code === input.code);
  if (!e) throw new DomainError('EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานรหัส ' + (input.code || '—'));
  const def = ATT_TYPES[input.type];
  if (!def) throw new DomainError('ATTENDANCE_TYPE_INVALID', 'ประเภทต้องเป็น ขาดงาน ลาไม่รับค่าจ้าง มาสาย หรือกลับก่อนเวลา');
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่');
  const old = input.id ? attendanceList().find((x) => x.id === input.id) : null;
  if (input.id && !old) throw new DomainError('ATTENDANCE_NOT_FOUND', 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
  if ((e.hired && date < e.hired) || (e.left && date > e.left)) {
    throw new DomainError('ATTENDANCE_NOT_EMPLOYED', e.name + ' ไม่ได้เป็นพนักงานในวันที่ ' + thDate(date),
      'เริ่มงาน ' + (e.hired ? thDate(e.hired) : '—') + (e.left ? ' · พ้นสภาพ ' + thDate(e.left) : ''));
  }
  if (old) assertAttendanceOpen(old.date.slice(0, 7));
  assertAttendanceOpen(date.slice(0, 7));
  const rec = { id: old ? old.id : null, code: e.code, date, type: input.type, note: String(input.note || '').trim().slice(0, 200),
    src: old ? old.src : input.src || 'manual' };
  if (def.unit === 'days') {
    const d = Number(input.days === undefined || input.days === '' ? 1 : input.days);
    if (d !== 1 && d !== 0.5) throw new DomainError('ATTENDANCE_DAYS_INVALID', def.label + 'ต่อวันใส่ได้ 1 วัน หรือครึ่งวัน (0.5)');
    rec.days = d;
  } else {
    const m = Number(String(input.minutes === undefined ? '' : input.minutes).replace(/,/g, ''));
    if (!(Number.isInteger(m) && m >= 1 && m <= workMinutes())) {
      throw new DomainError('ATTENDANCE_MINUTES_INVALID', def.label + ' ต้องเป็นนาทีเต็ม 1 ถึง ' + workMinutes() + ' นาที (ทั้งวันทำงาน)',
        'ถ้าไม่มาทั้งวัน ให้บันทึกเป็นขาดงาน');
    }
    rec.minutes = m;
  }
  /* กันบันทึกซ้ำ/ขัดกันในวันเดียว: ประเภทเดียวกันซ้ำไม่ได้ · ขาด/ลารวมกันไม่เกิน 1 วัน · ขาดเต็มวันแล้วมาสาย/กลับก่อนไม่ได้ */
  const same = attendanceList().filter((x) => x.code === e.code && x.date === date && x !== old);
  if (same.some((x) => x.type === rec.type)) {
    throw new DomainError('ATTENDANCE_DUPLICATE', e.name + ' มีรายการ' + def.label + 'วันที่ ' + thDate(date) + ' อยู่แล้ว', 'แก้รายการเดิมแทนการเพิ่มใหม่');
  }
  const dayOff = same.reduce((a, x) => a + (x.days || 0), 0) + (rec.days || 0);
  if (dayOff > 1) throw new DomainError('ATTENDANCE_CONFLICT', e.name + ' ขาดงาน/ลาวันที่ ' + thDate(date) + ' รวมเกิน 1 วัน');
  if (dayOff >= 1 && (same.some((x) => x.minutes) || rec.minutes)) {
    throw new DomainError('ATTENDANCE_CONFLICT', e.name + ' ขาดงาน/ลาทั้งวันที่ ' + thDate(date) + ' จะมาสายหรือกลับก่อนในวันเดียวกันไม่ได้');
  }
  if (old) {
    const before = { date: old.date, type: old.type, days: old.days, minutes: old.minutes };
    Object.keys(old).forEach((k) => { delete old[k]; });
    Object.assign(old, rec);
    audit('attendance', old.id, 'update', before, { date, type: rec.type, days: rec.days, minutes: rec.minutes });
    return old;
  }
  DB.seq.attendance = (DB.seq.attendance || 0) + 1;
  rec.id = 'AT' + String(DB.seq.attendance).padStart(6, '0');
  rec.at = new Date().toISOString();
  attendanceList().push(rec);
  audit('attendance', rec.id, 'create', null, { code: e.code, date, type: rec.type, days: rec.days, minutes: rec.minutes });
  return rec;
}
function deleteAttendance(id) {
  const list = attendanceList();
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) throw new DomainError('ATTENDANCE_NOT_FOUND', 'ไม่พบรายการนี้ อาจถูกลบไปแล้ว');
  assertAttendanceOpen(list[i].date.slice(0, 7));
  const x = list[i];
  list.splice(i, 1);
  audit('attendance', id, 'delete', { code: x.code, date: x.date, type: x.type, days: x.days, minutes: x.minutes }, null);
  return x;
}
/** นาทีจากเวลา "08:45" */
const hhmmMinutes = (t) => { const m = /^(\d{1,2})[:.](\d{2})/.exec(String(t || '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** แปลงเวลาเข้า-ออกหนึ่งวันเป็นรายการ: เข้าหลังเวลาเข้างาน = มาสาย · ออกก่อนเวลาเลิกงาน = กลับก่อน · ไม่มีทั้งเข้าและออก = ขาดงาน
    มีเวลาเข้าแต่ไม่มีเวลาออก (ลืมสแกน) ไม่เดาว่ากลับก่อน */
function clockToAttendance(code, date, tin, tout) {
  const start = hhmmMinutes(payrollSetting('workStart') || '08:30'), end = hhmmMinutes(payrollSetting('workEnd') || '17:30');
  const a = hhmmMinutes(tin), b = hhmmMinutes(tout);
  if (a === null && b === null) return [{ code, date, type: 'absent', days: 1, note: 'ไม่มีเวลาเข้า-ออก', src: 'clock' }];
  const out = [];
  if (a !== null && a > start) out.push({ code, date, type: 'late', minutes: Math.min(a - start, workMinutes()), note: 'เข้า ' + tin, src: 'clock' });
  if (b !== null && b < end) out.push({ code, date, type: 'early', minutes: Math.min(end - b, workMinutes()), note: 'ออก ' + tout, src: 'clock' });
  return out;
}
/** นำเข้าหลายรายการในชุดเดียว — แถวที่ผิดไม่เข้า (บอกเหตุผลรายแถว) แถวที่ถูกเข้าทั้งหมด
    rows = [{ row, code, date, type, minutes, days, note }] (แปลงจากไฟล์แล้ว) · dryRun = ตรวจอย่างเดียว ไม่บันทึก */
function importAttendance(rows, dryRun) {
  const ok = [], bad = [];
  try {
    atomically(function () {
      (rows || []).forEach(function (r) {
        try { ok.push(Object.assign({}, saveAttendance(Object.assign({}, r, { id: null, src: r.src || 'import' })))); }
        catch (err) {
          if (!(err instanceof DomainError)) throw err;
          bad.push({ row: r.row, code: r.code, date: r.date, type: r.type, reason: err.message });
        }
      });
      /* ตรวจอย่างเดียว: ลองบันทึกจริงทุกแถว (จับรายการซ้ำในไฟล์เดียวกันได้ด้วย) แล้วคืนสภาพทั้งหมด */
      if (dryRun) throw new DomainError('DRY_RUN', 'ตรวจอย่างเดียว');
    });
  } catch (err) { if (!(err instanceof DomainError) || err.code !== 'DRY_RUN') throw err; }
  return { added: ok.length, rows: ok, bad, dryRun: !!dryRun };
}

/** ตัวอย่างผลของแผ่นงาน (ยังไม่ลงบัญชี) — แสดงบนหน้าจอและใช้ตอนลงบัญชีจริง ผลจึงตรงกันเสมอ */
function payrollPreview(d) {
  const regular = d.kind === 'regular';
  const year = Number(d.payDate.slice(0, 4));
  const people = DB.employees.filter((e) => (regular ? !!employedSpan(e, d.period)
    : employedInYear(e, year) || !!d.lines[e.code]));
  const rows = people.map(function (e) {
    const L = d.lines[e.code] || {};
    const s = paySlipCalc(e, d, L);
    s.skip = !!L.skip;
    if (s.skip) s.pay = false;
    s.warn = [];
    if (s.pay && !e.nationalId) s.warn.push('ไม่มีเลขประจำตัวประชาชน — ภ.ง.ด.1 และ 50 ทวิ ต้องใช้');
    if (regular && !e.salary) s.warn.push('ยังไม่ได้กรอกเงินเดือนในทะเบียนพนักงาน');
    if (s.prorated) s.warn.push('ทำงาน ' + s.days + ' จาก ' + s.dim + ' วัน — คิดเงินเดือนตามสัดส่วน');
    /* กรอกจำนวนในแผ่นงานทับบันทึกเวลา — เตือนให้เห็นว่าตัวเลขสองที่ไม่ตรงกัน */
    if (regular) {
      const att = attendanceSummary(e.code, d.period);
      ['absent', 'unpaid', 'late', 'early'].forEach(function (t) {
        if (L[t] !== undefined && att.entries.some((x) => x.type === t) && L[t] !== att.qty[t]) {
          s.warn.push(PAY_ITEMS[t].label + ' กรอกในแผ่นงาน ' + L[t] + ' ' + PAY_ITEMS[t].unitLabel
            + ' ไม่ใช้บันทึกเวลา (' + att.qty[t] + ' ' + PAY_ITEMS[t].unitLabel + ')');
        }
      });
    }
    return s;
  });
  const paid = rows.filter((s) => s.pay);
  const sum = (k) => paid.reduce((a, s) => a + (s[k] || 0), 0);
  return {
    draft: d, rows, slips: paid,
    totals: { count: paid.length, gross: sum('gross'), taxable: sum('taxable'), exempt: sum('exempt'),
      reimburse: sum('reimburse'), pit: sum('pit'), sso: sum('sso'), ssoEr: sum('ssoEr'), pvd: sum('pvd'),
      pvdEr: sum('pvdEr'), loan: sum('loan'), otherDed: sum('otherDed'), net: sum('net'), ot: sum('ot') },
  };
}

/* ===================================================================
   ★ ทำเงินเดือน — ลงบัญชีจากแผ่นงาน
   runPayroll(period) = งวดปกติของเดือน (ใช้แผ่นงานที่แก้ไว้ หรือค่าจากทะเบียนพนักงาน)
   runPayroll(period, { draftId }) = แผ่นงานที่ระบุ (งวดนอกรอบ)
   Dr เงินเดือนและค่าจ้าง · คืนค่าใช้จ่าย · เงินสมทบส่วนนายจ้าง
   Cr ภาษีหัก ณ ที่จ่าย ภ.ง.ด.1 · ประกันสังคม/กองทุนค้างนำส่ง · ลูกหนี้พนักงาน · เจ้าหนี้อื่น · เงินสด/ธนาคารที่จ่ายจริง
   =================================================================== */
function activeRegularRun(period) {
  return DB.docs.payRun.find((r) => r.period === period && runIsLive(r) && runIsRegular(r)) || null;
}
function runPayroll(period, opts) {
  opts = opts || {};
  const d = opts.draftId ? payDraftFind(opts.draftId) : payDraft(period);
  if (!d) throw new DomainError('PAY_DRAFT_NOT_FOUND', 'ไม่พบแผ่นงานเงินเดือนนี้ อาจลงบัญชีหรือลบไปแล้ว');
  period = d.period;
  assertPeriodExists(period);
  if (d.kind === 'regular') {
    const already = activeRegularRun(period);
    if (already) {
      throw new DomainError('PAYROLL_ALREADY_RUN',
        'ทำเงินเดือนงวด ' + thPeriod(period) + ' ไปแล้ว (' + (already.no || already.entryNo) + ')',
        'ถ้าต้องจ่ายเพิ่ม ให้สร้างงวดจ่ายนอกรอบ · ถ้าตัวเลขผิด ให้ยกเลิกงวดเดิมแล้วทำใหม่');
    }
  }
  assertPayDate(period, d.payDate);
  const payFrom = assertPayAccount(d.payFrom || defaultPayFrom());
  const pv = payrollPreview(d);
  const bad = pv.rows.find((s) => s.error && !s.skip);
  if (bad) throw new DomainError('PAY_LINE_INVALID', bad.name + ': ' + bad.error, 'แก้รายการของพนักงานคนนี้ในแผ่นงานก่อน');
  if (!pv.slips.length && pv.rows.some((s) => s.skip)) {
    throw new DomainError('NO_EMPLOYEES', 'ไม่ได้เลือกจ่ายพนักงานคนใดในงวดนี้', 'ติ๊กช่อง "จ่าย" หน้าชื่อพนักงานที่จะจ่าย');
  }
  if (!pv.slips.length) {
    throw new DomainError('NO_EMPLOYEES', d.kind === 'regular'
      ? 'ไม่มีพนักงานที่ทำงานในงวด ' + thPeriod(period) : 'แผ่นงานนี้ยังไม่มีรายการที่จะจ่าย',
      d.kind === 'regular' ? 'เพิ่มพนักงานในทะเบียนพนักงาน หรือตรวจวันเริ่มงาน/วันพ้นสภาพ' : 'กรอกจำนวนเงินให้พนักงานอย่างน้อยหนึ่งคน');
  }
  const T = pv.totals;
  const signed = (acc, amt, memo) => (amt >= 0 ? { acc, dr: amt, memo } : { acc, cr: -amt, memo });
  const lines = [];
  if (T.gross) lines.push(signed(salaryAccount(), T.gross, d.kind === 'regular' ? 'เงินเดือน ค่าจ้าง และเงินได้อื่นของพนักงาน' : d.label));
  if (T.reimburse) lines.push({ acc: defaultAccountFor('admin_expense'), dr: T.reimburse, memo: 'คืนค่าใช้จ่ายที่พนักงานออกแทนตามใบเสร็จ' });
  if (T.ssoEr) lines.push({ acc: accBySub('sso_expense'), dr: T.ssoEr, memo: 'เงินสมทบประกันสังคมส่วนนายจ้าง' });
  if (T.pvdEr) lines.push({ acc: accBySub('pvd_expense'), dr: T.pvdEr, memo: 'เงินสมทบกองทุนสำรองฯ ส่วนนายจ้าง' });
  if (T.pit) lines.push({ acc: accBySub('wht_payable_pnd1'), cr: T.pit, memo: 'ภาษีหัก ณ ที่จ่าย ภ.ง.ด.1' });
  if (T.sso + T.ssoEr) lines.push({ acc: accBySub('sso_payable'), cr: T.sso + T.ssoEr, memo: 'ประกันสังคมลูกจ้าง+นายจ้าง' });
  if (T.pvd + T.pvdEr) lines.push({ acc: accBySub('pvd_payable'), cr: T.pvd + T.pvdEr, memo: 'กองทุนสำรองฯ ลูกจ้าง+นายจ้าง' });
  if (T.loan) lines.push({ acc: ensureAccount('other_receivable', '1141', 'เงินทดรองจ่าย', 'asset'), cr: T.loan, memo: 'หักคืนเงินกู้/เงินเบิกล่วงหน้าของพนักงาน' });
  if (T.otherDed) lines.push({ acc: ensureAccount('other_payable', '2135', 'เจ้าหนี้อื่น', 'liability'), cr: T.otherDed, memo: 'เงินที่หักจากพนักงานรอนำส่งผู้อื่น' });
  if (T.net) lines.push({ acc: payFrom, cr: T.net, memo: 'จ่ายสุทธิ ' + T.count + ' คน' });

  const je = post({
    type: 'payroll', date: d.payDate,
    desc: (d.kind === 'regular' ? 'เงินเดือนงวด ' : d.label + ' งวด ') + thPeriod(period),
    src: 'payroll', srcId: period, lines,
  });
  const sso = ssoRate(d.payDate);
  const run = {
    no: nextNo('payRun', d.payDate), period, kind: d.kind, type: d.type || d.kind, label: d.label,
    date: d.payDate, payFrom, status: 'posted',
    count: T.count, gross: T.gross, taxable: T.taxable, exempt: T.exempt, reimburse: T.reimburse,
    pit: T.pit, ssoEmp: T.sso, ssoEr: T.ssoEr, pvdEmp: T.pvd, pvdEr: T.pvdEr, loan: T.loan, otherDed: T.otherDed,
    net: T.net, slips: pv.slips.map(function (s) { const c = Object.assign({}, s); delete c.warn; delete c.skip; delete c.error; delete c.pay; return c; }),
    entryNo: je.no, ssoCeiling: sso.ceiling, ssoMax: sso.max,
    input: { lines: JSON.parse(JSON.stringify(d.lines)) },
  };
  DB.docs.payRun.unshift(run);
  /* ภ.ง.ด.1 รายคน — เฉพาะคนที่ถูกหักภาษีในงวดนี้ (คนที่ไม่ถูกหักไม่ต้องอยู่ในใบแนบ ภ.ง.ด.1 รายเดือน
     แต่ยังอยู่ใน ภ.ง.ด.1ก และ 50 ทวิ ประจำปีครบทุกคน) · เดือนภาษีคือเดือนที่จ่ายจริง */
  run.slips.forEach(function (s) {
    if (!s.pit) return;
    DB.taxTx.push({
      kind: 'wht', period: periodOf(d.payDate), date: d.payDate, docNo: run.no, docType: 'payroll',
      partnerName: s.name, taxId: s.nationalId, branch: null,
      base: s.taxable, tax: s.pit, rate: null, channel: 'manual', cond: 1,
      incomeType: 'เงินเดือน ค่าจ้าง ม.40(1)', form: 'PND1', entryNo: je.no, filingId: null,
      empCode: s.code, runNo: run.no,
    });
  });
  const di = payDraftList().indexOf(d);
  if (di >= 0) payDraftList().splice(di, 1);
  payrollSettingSet('payFrom', payFrom);
  audit('payroll', run.no, 'run', null, { period, label: run.label, count: run.count, net: fmt(run.net) });
  return run;
}

/* ===================================================================
   ยกเลิกงวดเงินเดือน — กลับรายการใบสำคัญ ตัดออกจาก ภ.ง.ด.1 แล้วคืนแผ่นงานเดิมให้แก้และทำใหม่
   ใบสำคัญกลับรายการตรง ๆ ไม่ได้ (ENTRY_FROM) เพราะ ภ.ง.ด.1 รายคนจะไม่ตรงกับบัญชี
   =================================================================== */
/** หางวดจากเลขที่ (PAY…) หรือจากรหัสเดือนถ้าเดือนนั้นมีงวดที่ใช้งานอยู่งวดเดียว (ผู้เรียกรุ่นก่อน)
    งวดที่ทำก่อนมีเลขที่งวดใช้เลขที่ใบสำคัญแทน */
function payRunFind(key) {
  const byNo = DB.docs.payRun.find((r) => (r.no === key || (!r.no && r.entryNo === key)) && runIsLive(r));
  if (byNo) return byNo;
  const live = DB.docs.payRun.filter((r) => r.period === key && runIsLive(r));
  if (live.length > 1) {
    throw new DomainError('RUN_AMBIGUOUS', 'งวด ' + thPeriod(key) + ' มีการจ่าย ' + live.length + ' ครั้ง ต้องระบุเลขที่งวด',
      live.map((r) => r.no || r.entryNo).join(', '));
  }
  return live[0] || null;
}
function payRunCheck(key) {
  const run = payRunFind(key);
  if (!run) {
    throw new DomainError('RUN_NOT_FOUND', 'ไม่พบงวดเงินเดือน ' + (/^\d{4}-\d{2}$/.test(key) ? thPeriod(key) : key) + ' ที่ยังใช้งานอยู่');
  }
  const p = periodFor(run.date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ยกเลิกงวดเงินเดือนไม่ได้',
      'จ่ายเพิ่มหรือหักคืนในงวดถัดไปด้วยรายการ "ปรับปรุงเงินได้ที่จ่ายผิดในงวดก่อน"');
  }
  const filed = DB.taxTx.find((t) => t.kind === 'wht' && t.docType === 'payroll' && t.entryNo === run.entryNo && !t.void && t.filingId);
  if (filed) {
    throw new DomainError('TAX_ALREADY_FILED', 'ยื่น ภ.ง.ด.1 งวด ' + thPeriod(filed.period) + ' ไปแล้ว ยกเลิกงวดเงินเดือนไม่ได้',
      'แก้ในงวดถัดไปด้วยรายการ "ปรับปรุงเงินได้ที่จ่ายผิดในงวดก่อน" ระบบจะคำนวณภาษีสะสมใหม่ให้เอง · ภาษีที่หักเกินพนักงานขอคืนตอนยื่นแบบประจำปี');
  }
  const remit = DB.docs.payRemit.find((x) => x.status !== 'void' && x.period === run.period
    && ((x.kind === 'sso' && run.ssoEmp + run.ssoEr) || (x.kind === 'pvd' && run.pvdEmp + run.pvdEr)));
  if (remit) {
    throw new DomainError('RUN_REMITTED', 'นำส่ง' + (remit.kind === 'sso' ? 'เงินสมทบประกันสังคม' : 'เงินกองทุนสำรองเลี้ยงชีพ')
      + 'ของงวดนี้ไปแล้ว (' + remit.no + ')', 'ยกเลิกรายการนำส่งก่อน แล้วค่อยยกเลิกงวดเงินเดือน');
  }
  const e = DB.entries.find((x) => x.no === run.entryNo);
  if (!e || e.status !== 'posted') throw new DomainError('ALREADY_REVERSED', 'ใบสำคัญของงวดนี้ถูกกลับรายการไปแล้ว');
  return run;
}
function voidPayRun(key, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกงวดต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  }
  const why = String(reason).trim();
  const run = payRunCheck(key);
  reverse(run.entryNo, 'ยกเลิกเงินเดือนงวด ' + thPeriod(run.period) + ' — ' + why, run.date, { fromSource: true });
  DB.taxTx.forEach(function (t) {
    if (t.kind !== 'wht' || t.docType !== 'payroll' || t.entryNo !== run.entryNo || t.void) return;
    t.orig = { base: t.base, tax: t.tax };
    t.base = 0; t.tax = 0; t.void = true; t.voidReason = why;
  });
  run.status = 'void';
  run.voidReason = why;
  run.voidedAt = new Date().toISOString();
  /* คืนแผ่นงานเดิมให้แก้เฉพาะจุดที่ผิดแล้วทำใหม่ — ไม่ต้องกรอกทั้งงวดซ้ำ */
  const regular = runIsRegular(run);
  let id = 'R|' + run.period;
  if (!regular) { let n = 1; while (payDraftFind('X|' + run.period + '|' + n)) n++; id = 'X|' + run.period + '|' + n; }
  if (!payDraftFind(id)) {
    payDraftList().push({ id, period: run.period, kind: regular ? 'regular' : 'offcycle', type: run.type || (regular ? 'regular' : 'bonus'),
      label: run.label || 'เงินเดือน', payDate: run.date, payFrom: run.payFrom || defaultPayFrom(),
      lines: JSON.parse(JSON.stringify((run.input && run.input.lines) || {})) });
  }
  audit('payroll', run.no || run.period, 'void', { status: 'posted' }, { status: 'void' }, why);
  return run;
}

/* ===================================================================
   นำส่งเงินสมทบ — Dr ประกันสังคม/กองทุนค้างนำส่ง · Cr เงินฝากธนาคาร
   ยอดตั้งต้นคือยอดของงวดเงินเดือนในเดือนนั้นที่ยังไม่ได้นำส่ง แก้ยอดได้ (เช่นยอดยกมาจากระบบเดิม)
   แต่ไม่เกินยอดค้างนำส่งในบัญชี ณ วันที่นำส่ง
   =================================================================== */
const REMIT_KIND = {
  sso: { label: 'เงินสมทบประกันสังคม', sub: 'sso_payable', form: 'สปส.1-10' },
  pvd: { label: 'เงินกองทุนสำรองเลี้ยงชีพ', sub: 'pvd_payable', form: 'ใบนำส่งกองทุน' },
};
function payRemitDue(kind, period) {
  const due = DB.docs.payRun.filter((r) => runIsLive(r) && r.period === period)
    .reduce((s, r) => s + (kind === 'sso' ? (r.ssoEmp || 0) + (r.ssoEr || 0) : (r.pvdEmp || 0) + (r.pvdEr || 0)), 0);
  const paid = DB.docs.payRemit.filter((x) => x.status !== 'void' && x.kind === kind && x.period === period)
    .reduce((s, x) => s + x.amount, 0);
  return { due, paid, left: due - paid };
}
function remitPayroll(input) {
  const K = REMIT_KIND[input.kind];
  if (!K) throw new DomainError('REMIT_KIND_UNKNOWN', 'เลือกได้เฉพาะประกันสังคมหรือกองทุนสำรองเลี้ยงชีพ');
  assertPeriodExists(input.period);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่นำส่ง');
  if (input.date < input.period + '-01') {
    throw new DomainError('REMIT_DATE_EARLY', 'วันที่นำส่งต้องไม่ก่อนเดือนของงวดค่าจ้าง ' + thPeriod(input.period));
  }
  const payFrom = assertPayAccount(input.payFrom || defaultPayFrom());
  const due = payRemitDue(input.kind, input.period);
  const amount = input.amount !== undefined && input.amount !== null && String(input.amount).trim() !== ''
    ? M(String(input.amount)) : due.left;
  if (amount <= 0) {
    throw new DomainError('NOTHING_TO_REMIT', 'ไม่มี' + K.label + 'ของงวด ' + thPeriod(input.period) + ' ที่ต้องนำส่ง',
      due.due ? 'นำส่งครบแล้ว ' + fmt(due.paid) + ' บาท' : 'ทำเงินเดือนงวดนี้ก่อน หรือกรอกยอดที่ยกมาจากระบบเดิม');
  }
  const sub = K.sub;
  const owed = -balBySub([sub], input.date);
  if (amount > owed) {
    throw new DomainError('REMIT_EXCEEDS_PAYABLE', 'ยอด' + K.label + 'ค้างนำส่งในบัญชี ณ ' + thDate(input.date) + ' มีเพียง ' + fmt(owed) + ' บาท',
      'นำส่งได้ไม่เกินยอดที่ค้างอยู่ในบัญชี');
  }
  const no = nextNo('payRemit', input.date);
  const je = post({
    type: 'payment', date: input.date,
    desc: 'นำส่ง' + K.label + ' งวดค่าจ้าง ' + thPeriod(input.period) + ' (' + no + ')',
    src: 'payRemit', srcId: no,
    lines: [{ acc: accBySub(sub), dr: amount, memo: K.form }, { acc: payFrom, cr: amount }],
  });
  const doc = { no, kind: input.kind, period: input.period, date: input.date, amount, payFrom,
    ref: String(input.ref || '').trim(), entryNo: je.no, status: 'posted' };
  DB.docs.payRemit.unshift(doc);
  audit('payRemit', no, 'create', null, { kind: input.kind, period: input.period, amount: fmt(amount) });
  return doc;
}
function voidPayRemit(no, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  }
  const doc = DB.docs.payRemit.find((x) => x.no === no);
  if (!doc) throw new DomainError('REMIT_NOT_FOUND', 'ไม่พบรายการนำส่ง ' + no);
  if (doc.status === 'void') throw new DomainError('ALREADY_VOID', 'รายการนำส่ง ' + no + ' ยกเลิกไปแล้ว');
  assertPostingOpen(doc.date);
  const why = String(reason).trim();
  reverse(doc.entryNo, 'ยกเลิกการนำส่ง ' + no + ' — ' + why, doc.date, { fromSource: true });
  doc.status = 'void';
  doc.voidReason = why;
  doc.voidedAt = new Date().toISOString();
  audit('payRemit', no, 'void', { status: 'posted' }, { status: 'void' }, why);
  return doc;
}

/* ===================================================================
   ข้อมูลสำหรับแบบภาษีและประกันสังคม
   =================================================================== */
/** ใบแนบ ภ.ง.ด.1 ของเดือนภาษี — รายการหักภาษีรายคนที่ยังไม่ยกเลิก */
function pnd1Rows(period) {
  return DB.taxTx.filter((t) => t.kind === 'wht' && t.form === 'PND1' && t.period === period && !t.void)
    .slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.empCode || a.partnerName) < String(b.empCode || b.partnerName) ? -1 : 1));
}

/** สรุปทั้งปีรายคน — ใช้ทำ ภ.ง.ด.1ก และ 50 ทวิ ของพนักงาน (ปีภาษีตามวันที่จ่าย) */
function payrollYear(year) {
  year = Number(year);
  const rows = [];
  DB.employees.forEach(function (e) {
    const y = payYtd(e.code, year);
    if (!y.runs && !y.opening) return;
    rows.push({ code: e.code, name: e.name, dept: e.dept, nationalId: e.nationalId || null, ssoNumber: e.ssoNumber || null,
      address: e.address || '', income: y.income, tax: y.tax, sso: y.sso, pvd: y.pvd, ssoEr: y.ssoEr, pvdEr: y.pvdEr,
      exempt: y.exempt, reimburse: y.reimburse, runs: y.runs, opening: y.opening, left: e.left || null });
  });
  rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  rows.forEach((r, i) => { r.seq = i + 1; });
  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  return { year, rows, totals: { count: rows.length, income: sum('income'), tax: sum('tax'), sso: sum('sso'), pvd: sum('pvd'),
    ssoEr: sum('ssoEr'), pvdEr: sum('pvdEr') } };
}

/** สปส.1-10 ของเดือนค่าจ้าง — ค่าจ้างและเงินสมทบรายคน (รวมทุกรอบที่จ่ายในเดือนนั้น) */
function ssoMonth(period) {
  const map = {};
  DB.docs.payRun.forEach(function (r) {
    if (!runIsLive(r) || r.period !== period) return;
    (r.slips || []).forEach(function (s) {
      const wage = s.ssoWage !== undefined ? s.ssoWage : (s.salary || 0);
      const er = s.ssoEr !== undefined ? s.ssoEr : (s.sso || 0);
      if (!wage && !s.sso && !er) return;
      const m = map[s.code] || (map[s.code] = { code: s.code, name: s.name, nationalId: s.nationalId || null,
        ssoNumber: s.ssoNumber || null, wage: 0, sso: 0, ssoEr: 0 });
      m.wage += wage; m.sso += s.sso || 0; m.ssoEr += er;
    });
  });
  const r = ssoRate(endOfMonth(period + '-01'));
  const rows = Object.keys(map).sort().map((k) => map[k]);
  rows.forEach(function (x, i) { x.seq = i + 1; x.base = Math.min(Math.max(x.wage, r.floor), r.ceiling); });
  const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
  return { period, rate: r, rows, totals: { count: rows.length, wage: sum('wage'), base: sum('base'), sso: sum('sso'), ssoEr: sum('ssoEr'),
    total: sum('sso') + sum('ssoEr') }, remit: payRemitDue('sso', period) };
}

/* ===================================================================
   ทะเบียนพนักงาน
   ช่องที่ไม่ได้ส่งมา (undefined) คงค่าเดิมไว้เสมอ — เดิมแก้ชื่อพนักงานแล้วค่าลดหย่อนที่นำเข้ามาหายเป็นศูนย์
   =================================================================== */
function saveEmployee(input) {
  const existing = input.code ? DB.employees.find((x) => x.code === input.code) : null;
  if (input.code && !existing) throw new DomainError('EMPLOYEE_NOT_FOUND', 'ไม่พบพนักงานรหัส ' + input.code);
  const sent = (k) => input[k] !== undefined && input[k] !== null;
  const keep = (k, dflt) => (existing && existing[k] !== undefined ? existing[k] : dflt);
  const str = (k, dflt) => (sent(k) ? String(input[k]).trim() : keep(k, dflt));
  const date = function (k, label) {
    if (!sent(k)) return keep(k, null);
    const v = String(input[k]).trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new DomainError('DATE_INVALID', label + 'ไม่ถูกต้อง');
    return v || null;
  };
  const money = function (k, label) {
    if (!sent(k)) return keep(k, 0) || 0;
    const v = M(String(input[k] === '' ? '0' : input[k]));
    if (v < 0) throw new DomainError('AMOUNT_NEGATIVE', label + 'ติดลบไม่ได้');
    return v;
  };
  const rate = function (k, dflt) {
    if (!sent(k)) return keep(k, dflt);
    if (String(input[k]).trim() === '') return k === 'pvdErRate' ? null : 0;
    const n = Number(input[k]);
    if (!isFinite(n) || n < 0 || n > 15) {
      throw new DomainError('PVD_RATE_RANGE', 'อัตรากองทุนสำรองเลี้ยงชีพต้องอยู่ระหว่าง 0 ถึง 15 เปอร์เซ็นต์',
        'พ.ร.บ.กองทุนสำรองเลี้ยงชีพ: เงินสะสมของลูกจ้างร้อยละ 2–15 ของค่าจ้าง · ใส่ 0 ถ้าไม่เป็นสมาชิก');
    }
    return n;
  };

  const name = str('name', '');
  if (!name) throw new DomainError('EMPLOYEE_NAME_REQUIRED', 'ต้องกรอกชื่อพนักงาน');
  const nationalId = sent('nationalId') ? String(input.nationalId).replace(/[^0-9]/g, '') || null : keep('nationalId', null);
  if (nationalId && !validTaxId(nationalId)) {
    throw new DomainError('NATIONAL_ID_INVALID',
      'เลขประจำตัวประชาชน ' + nationalId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ใช้ตอนยื่น ภ.ง.ด.1 และขึ้นทะเบียนประกันสังคม');
  }
  const twin = nationalId && DB.employees.find((x) => x.nationalId === nationalId && x !== existing);
  if (twin) {
    throw new DomainError('NATIONAL_ID_DUPLICATE', 'เลขประจำตัวประชาชนนี้เป็นของ ' + twin.code + ' ' + twin.name + ' อยู่แล้ว',
      'คนเดิมกลับมาทำงานใหม่ ให้แก้ข้อมูลในรหัสเดิม (ล้างวันพ้นสภาพแล้วใส่วันเริ่มงานใหม่)');
  }
  const salary = money('salary', 'เงินเดือน');
  const pvdRate = rate('pvdRate', 0);
  const pvdErRate = rate('pvdErRate', null);
  const hired = date('hired', 'วันเริ่มงาน');
  const left = date('left', 'วันพ้นสภาพ');
  if (hired && left && left < hired) {
    throw new DomainError('LEFT_BEFORE_HIRED', 'วันพ้นสภาพ ' + thDate(left) + ' อยู่ก่อนวันเริ่มงาน ' + thDate(hired));
  }
  const otHours = sent('otHours') ? Math.max(0, Number(input.otHours) || 0) : keep('otHours', 0);

  /* ยอดที่บริษัทจ่ายไปแล้วในปีนี้ก่อนเริ่มใช้ระบบ — ภาษีสะสม 50 ทวิ และ ภ.ง.ด.1ก ต้องรวมส่วนนี้ด้วย */
  let ytdOpening = keep('ytdOpening', null);
  if (['ytdYear', 'ytdIncome', 'ytdTax', 'ytdSso', 'ytdPvd'].some(sent)) {
    const amt = (k, label) => {
      const v = M(String(input[k] || '0'));
      if (v < 0) throw new DomainError('AMOUNT_NEGATIVE', label + 'ติดลบไม่ได้');
      return v;
    };
    const op = { year: Number(input.ytdYear || 0), income: amt('ytdIncome', 'เงินได้สะสม'), tax: amt('ytdTax', 'ภาษีสะสม'),
      sso: amt('ytdSso', 'ประกันสังคมสะสม'), pvd: amt('ytdPvd', 'กองทุนสะสม') };
    if (!op.income && !op.tax && !op.sso && !op.pvd) ytdOpening = null;
    else {
      if (!Number.isInteger(op.year) || op.year < 2000 || op.year > 2100) {
        throw new DomainError('YTD_YEAR_INVALID', 'ต้องระบุปีของยอดสะสม เป็น ค.ศ. เช่น 2026 (พ.ศ. 2569)');
      }
      if (op.tax > op.income) throw new DomainError('YTD_TAX_EXCEEDS', 'ภาษีสะสมมากกว่าเงินได้สะสม — ตรวจตัวเลขอีกครั้ง');
      ytdOpening = op;
    }
  }

  const rec = {
    code: existing ? existing.code : nextRegCode('EMP', DB.employees),
    name, dept: str('dept', '') || 'ไม่ระบุ',
    salary, otHours, pvdRate, pvdErRate, deductions: money('deductions', 'ค่าลดหย่อนอื่น'),
    nationalId, ssoNumber: str('ssoNumber', '') || null,
    ssoExempt: sent('ssoExempt') ? !!input.ssoExempt && input.ssoExempt !== 'no' : keep('ssoExempt', false),
    address: str('address', ''),
    hired, left,
    active: sent('active') ? input.active !== false : keep('active', true),
    ytdOpening,
  };
  if (existing) {
    const before = { salary: fmt(existing.salary), deductions: fmt(existing.deductions || 0), left: existing.left || null };
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('employee', rec.code, 'update', before, { name: rec.name, salary: fmt(rec.salary), deductions: fmt(rec.deductions), left: rec.left });
    return { employee: existing, created: false };
  }
  DB.employees.push(rec);
  audit('employee', rec.code, 'create', null, { name: rec.name, dept: rec.dept });
  return { employee: rec, created: true };
}

/* ห่อคำสั่งที่เขียนข้อมูลให้เป็นชุดเดียว (ดู atomically ใน engine.js) — อยู่ท้ายไฟล์เสมอ */
saveEmployee = transactional(saveEmployee);
runPayroll = transactional(runPayroll);
voidPayRun = transactional(voidPayRun);
savePayDraft = transactional(savePayDraft);
newOffcycleDraft = transactional(newOffcycleDraft);
setPayLine = transactional(setPayLine);
deletePayDraft = transactional(deletePayDraft);
remitPayroll = transactional(remitPayroll);
voidPayRemit = transactional(voidPayRemit);
saveSettingsPayroll = transactional(saveSettingsPayroll);
