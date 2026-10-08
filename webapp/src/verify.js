/* ===================================================================
   ตรวจตัวเลขที่นำเข้า
   1. ตรวจเทียบกับไฟล์ต้นทาง — ลากไฟล์เดิมเข้ามาอีกครั้ง ระบบเทียบยอดทีละบัญชีกับใบสำคัญที่นำเข้าไว้
      ไม่ลงบัญชีอะไรเพิ่ม ผลคือรายการบัญชีที่ตรง/ไม่ตรงทุกสตางค์
   2. ตรวจสุขภาพข้อมูลที่นำเข้า — ไม่ต้องมีไฟล์ ดูว่าข้อมูลที่อยู่ในระบบตอนนี้เอาไปใช้ต่อได้จริงหรือไม่
   =================================================================== */

/** บัญชีที่ยอดฝั่งตรงข้ามเป็นเรื่องปกติ (บัญชีปรับมูลค่า ส่วนลด ส่งคืน กำไรสะสมติดลบได้) */
const CONTRA_SUBS = ['accum_depreciation', 'accum_amortization', 'ar_allowance', 'inventory_allowance',
  'sales_return', 'sales_discount', 'purchase_return', 'dividend', 'retained_earnings',
  'current_year_earnings', 'opening_balance', 'suspense', 'rounding'];
const NATURAL_DEBIT = (a) => a.type === 'asset' || a.type === 'expense';

/** ใบสำคัญนำเข้าที่ยังใช้งานอยู่ */
const liveImports = () => DB.entries.filter((e) => e.src === 'import' && e.status === 'posted');
function importLabel(e) {
  const [kind, key] = String(e.srcId || '').split('|');
  return kind === 'movement' ? 'ยอดเคลื่อนไหว ' + thPeriod(key) : 'ยอดยกมา ณ ' + thDate(key || e.date);
}

/** ใบนำเข้าที่ควรใช้เทียบกับไฟล์ที่เพิ่งลากเข้ามา ตามแบบและวันที่ที่เลือกบนจอ */
function importFor(mode, key) {
  const id = (mode === 'movement' ? 'movement|' : 'opening|') + key;
  return liveImports().find((e) => e.srcId === id) || null;
}

/** เทียบยอดในไฟล์กับใบสำคัญนำเข้า ทีละบัญชี */
function verifyAgainstFile(tbRows, overrides, entryNo, skipped) {
  const e = DB.entries.find((x) => x.no === entryNo && x.src === 'import');
  if (!e) throw new DomainError('IMPORT_NOT_FOUND', 'ไม่พบใบสำคัญนำเข้า ' + entryNo);
  const p = previewOpening(tbRows, overrides || {});
  const fileNet = {}, fileRows = {};
  const add = (code, r) => {
    fileNet[code] = (fileNet[code] || 0) + r.debit - r.credit;
    (fileRows[code] = fileRows[code] || []).push((r.code || '') + (r.name ? ' ' + r.name : ''));
  };
  /* ใบยอดยกมาที่ปิดกำไรขาดทุนปีก่อนเข้ากำไรสะสมแล้ว ต้องพับบรรทัดรายได้/ค่าใช้จ่ายในไฟล์แบบเดียวกันก่อนเทียบ */
  const fold = e.pnlClosed ? e.pnlClosed.into : null;
  const typeOf = (code, r) => { const a = DB.accounts.find((x) => x.code === code); return a ? a.type : (r && r.type); };
  const addF = (code, r) => add(fold && /^(revenue|expense)$/.test(typeOf(code, r) || '') ? fold : code, r);
  p.matched.forEach((r) => addF(r.target, r));
  /* บัญชีที่ยังไม่มีในผัง = ไม่เคยถูกนำเข้า ยอดในใบสำคัญจึงเป็นศูนย์ ต้องขึ้นว่าไม่ตรง */
  p.creating.forEach((r) => addF(String(r.code || '').trim() || r.name, r));
  const entryNet = {};
  e.lines.forEach((l) => { entryNet[l.acc] = (entryNet[l.acc] || 0) + l.dr - l.cr; });
  const [kind, key] = String(e.srcId || '').split('|');
  const glNet = (code) => (kind === 'movement'
    ? balanceOf(code, endOfMonth(key + '-01'), key + '-01')
    : balanceOf(code, e.date));
  const codes = Array.from(new Set(Object.keys(fileNet).concat(Object.keys(entryNet))))
    .filter((c) => (fileNet[c] || 0) !== 0 || (entryNet[c] || 0) !== 0)
    .sort();
  const rows = codes.map(function (code) {
    const a = DB.accounts.find((x) => x.code === code);
    const f = fileNet[code] || 0, en = entryNet[code] || 0;
    const gl = a ? glNet(code) : 0;
    const status = f === en ? 'ok' : !a ? 'no_account' : en === 0 ? 'missing' : f === 0 ? 'extra' : 'diff';
    return { code, name: a ? a.name : (fileRows[code] || [code])[0], file: f, entry: en, gl,
      diff: f - en, status, other: gl - en, from: fileRows[code] || [] };
  });
  const bad = rows.filter((r) => r.status !== 'ok');
  const sumAbs = (o) => Object.keys(o).reduce((s, k) => s + Math.abs(o[k]), 0);
  return {
    entry: e, label: importLabel(e), rows, bad,
    unmatched: p.unmatched, skipped: skipped || [],
    fileDr: p.totalDr, fileCr: p.totalCr, fileBalanced: p.balanced,
    fileAbs: sumAbs(fileNet), entryAbs: sumAbs(entryNet),
    ok: bad.length === 0 && p.unmatched.length === 0 && p.balanced,
  };
}

/** ตรวจสุขภาพข้อมูลที่นำเข้า — ปัญหาที่ทำให้ตัวเลขเอาไปใช้ต่อไม่ได้ พร้อมวิธีแก้ */
function importHealth(asOf) {
  const to = asOf || (DB.periods.length ? DB.periods[DB.periods.length - 1].end : TODAY);
  const imps = liveImports();
  const out = [];
  const push = (level, title, detail, fix) => out.push({ level, title, detail: detail || '', fix: fix || '' });

  /* 1. สมดุลทั้งระบบ */
  const tb = trialBalance(DB.periods.length ? DB.periods[0].start : '1900-01-01', to);
  const bs = balanceSheet(to);
  if (tb.totalDr !== tb.totalCr) push('bad', 'งบทดลองไม่สมดุล', 'ต่างกัน ' + fmt(tb.totalDr - tb.totalCr) + ' บาท', 'ติดต่อผู้ดูแลระบบ — ไม่ควรเกิดขึ้นได้');
  else push('ok', 'งบทดลองสมดุล', 'เดบิตรวม = เครดิตรวม ' + fmt(tb.totalDr) + ' บาท');
  if (bs.diff !== 0) push('bad', 'งบแสดงฐานะการเงินไม่สมดุล', 'สินทรัพย์ ' + fmt(bs.assets) + ' · หนี้สินและทุน ' + fmt(bs.liabEquity), 'ตรวจบัญชีที่สร้างจากการนำเข้าว่าอยู่บรรทัดงบถูกหมวด');
  else push('ok', 'งบแสดงฐานะการเงินสมดุล', 'สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น = ' + fmt(bs.assets) + ' บาท ณ ' + thDate(to));

  /* 2. ยอดยกมาที่มีบัญชีรายได้/ค่าใช้จ่าย — งบกำไรขาดทุนของเดือนนั้นจะรวมผลก่อนวันตัดยอดทั้งหมด */
  imps.filter((e) => String(e.srcId).indexOf('opening|') === 0 && e.pnlClosed).forEach(function (e) {
    push('ok', 'ยอดยกมา ' + e.no + ' ปิดกำไรขาดทุนปีก่อนเข้ากำไรสะสมแล้ว',
      fmt(e.pnlClosed.profit) + ' บาท จาก ' + e.pnlClosed.accounts + ' บัญชี — งบกำไรขาดทุนปีนี้จึงเริ่มจากศูนย์');
  });
  imps.filter((e) => String(e.srcId).indexOf('opening|') === 0).forEach(function (e) {
    const pl = e.lines.filter((l) => { const a = acc(l.acc); return a.type === 'revenue' || a.type === 'expense'; });
    if (!pl.length) return;
    const profit = -pl.reduce((s, l) => s + l.dr - l.cr, 0);
    push('warn', 'ยอดยกมา ' + e.no + ' มีบัญชีรายได้และค่าใช้จ่าย ' + pl.length + ' บัญชี',
      'กำไร (ขาดทุน) ตั้งแต่ต้นปีถึงวันตัดยอด ' + fmt(profit) + ' บาท ลงไว้วันที่ ' + thDate(e.date)
        + ' — งบกำไรขาดทุนเดือน' + thPeriod(periodOf(e.date)) + 'จะรวมผลของทุกเดือนก่อนหน้า ส่วนยอดสะสมทั้งปีถูกต้อง'
        + ' (ถ้าเป็นกำไรของปีก่อน ต้องยกเลิกแล้วนำเข้าใหม่ ณ วันแรกของปี ระบบจะปิดเข้ากำไรสะสมให้)',
      'ถ้าต้องการงบกำไรขาดทุนรายเดือนที่ถูกต้อง ให้ยกเลิกการนำเข้านี้ แล้วนำเข้ายอดยกมา ณ ต้นปี + ยอดเคลื่อนไหวเดือนละไฟล์แทน');
  });

  /* 3. นับซ้ำ — ยอดยกมา (ยอดสะสม) กับยอดเคลื่อนไหวของเดือนที่อยู่ก่อนหรือเดือนเดียวกับวันตัดยอด */
  const openings = imps.filter((e) => String(e.srcId).indexOf('opening|') === 0);
  const moves = imps.filter((e) => String(e.srcId).indexOf('movement|') === 0);
  openings.forEach(function (o) {
    const clash = moves.filter((m) => m.date <= o.date || periodOf(m.date) === periodOf(o.date));
    if (clash.length) {
      push('bad', 'อาจนับซ้ำ: ยอดยกมา ' + o.no + ' กับยอดเคลื่อนไหว ' + clash.map((m) => m.no).join(', '),
        'ยอดยกมา ณ ' + thDate(o.date) + ' เป็นยอดสะสมที่รวมเดือน ' + clash.map((m) => thPeriod(periodOf(m.date))).join(', ') + ' ไว้แล้ว',
        'ยกเลิกการนำเข้าตัวใดตัวหนึ่งที่หน้านำเข้าข้อมูล — ยอดยกมาควรเป็น ณ วันก่อนเดือนแรกของยอดเคลื่อนไหว');
    }
  });
  if (openings.length > 1) {
    push('bad', 'มียอดยกมาที่ใช้งานอยู่ ' + openings.length + ' ใบ', openings.map((o) => o.no + ' (' + thDate(o.date) + ')').join(' · '),
      'ยอดยกมาควรมีใบเดียว — ยกเลิกใบที่ไม่ใช้ ไม่งั้นยอดคงเหลือจะบวกกันเป็นสองเท่า');
  }
  if (moves.length && !openings.length) {
    const first = moves.map((m) => periodOf(m.date)).sort()[0];
    push('warn', 'มีแต่ยอดเคลื่อนไหว ไม่มียอดยกมา',
      'เดือนแรกที่นำเข้าคือ ' + thPeriod(first) + ' ถ้าบริษัทมียอดคงเหลือก่อนเดือนนั้น (เงินสด ลูกหนี้ ทุน ฯลฯ) งบแสดงฐานะการเงินจะขาดส่วนนั้นไป',
      'นำเข้ายอดยกมา ณ วันสุดท้ายของเดือนก่อน ' + thPeriod(first));
  }
  const months = moves.map((m) => periodOf(m.date)).sort();
  for (let i = 1; i < months.length; i++) {
    const [y, m] = months[i - 1].split('-').map(Number);
    const next = (m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0'));
    if (months[i] !== next) push('warn', 'ยอดเคลื่อนไหวขาดช่วง', 'มี ' + thPeriod(months[i - 1]) + ' แล้วข้ามไป ' + thPeriod(months[i]),
      'นำเข้างบทดลองของเดือนที่ขาดให้ครบ ไม่งั้นงบกำไรขาดทุนสะสมจะขาดเดือนนั้น');
  }

  /* 4. ยอดคุมที่ไม่มีรายตัวรองรับ — จะทำให้ปิดงวดไม่ได้ */
  const rec = reconciliationChecks(to);
  rec.checks.filter((c) => !c.ok).forEach(function (c) {
    const imported = imps.length > 0;
    push('bad', c.label + ' ไม่ตรง', 'บัญชีคุม ' + fmt(c.control) + ' · รายตัว ' + fmt(c.sub) + ' · ต่างกัน ' + fmt(c.control - c.sub) + (c.why ? ' — ' + c.why : ''),
      c.code === 'AR_SUBLEDGER' ? (imported ? 'นำเข้าใบกำกับที่ยังค้างรับเป็นรายใบ (แฟ้มจากตัวดึง FlowAccount) ยอดรวมต้องเท่ายอดลูกหนี้ที่ยกมา' : '')
        : c.code === 'AP_SUBLEDGER' ? (imported ? 'นำเข้ารายการตั้งหนี้ที่ยังค้างจ่ายเป็นรายใบ ยอดรวมต้องเท่ายอดเจ้าหนี้ที่ยกมา' : '')
        : c.code === 'OUTPUT_VAT' || c.code === 'INPUT_VAT' ? 'ยอดภาษีที่ยกมาจากระบบเดิมไม่มีใบกำกับรายใบในทะเบียนภาษี — ยื่น ภ.พ.30 ของงวดนั้นจากระบบเดิม แล้วบันทึกปิดบัญชีภาษีในงวดนี้'
        : c.code === 'SUSPENSE_ZERO' ? 'ไล่ดูบัญชีพักว่ามาจากบรรทัดไหนของไฟล์ แล้วจับคู่ใหม่ให้ถูกบัญชี'
        : 'ดูรายละเอียดที่หน้าปิดงวด');
  });
  if (!rec.checks.some((c) => !c.ok)) push('ok', 'ยอดคุมทุกตัวตรงกับรายตัว', 'ลูกหนี้ เจ้าหนี้ ภาษีขาย ภาษีซื้อ พักรับสินค้า บัญชีพัก');

  /* 5. บัญชีที่มาจากการนำเข้า ยอดอยู่ผิดด้านปกติ หรือรหัสบอกหมวดหนึ่งแต่ลงไว้อีกหมวด */
  const touched = new Set();
  imps.forEach((e) => e.lines.forEach((l) => touched.add(l.acc)));
  const odd = [], misfiled = [];
  touched.forEach(function (code) {
    const a = acc(code);
    const bal = balanceOf(code, to);
    if (bal !== 0 && CONTRA_SUBS.indexOf(a.subType) < 0 && (NATURAL_DEBIT(a) ? bal < 0 : bal > 0)) {
      odd.push(a.code + ' ' + a.name + ' (' + (bal > 0 ? 'เดบิต ' : 'เครดิต ') + fmt(Math.abs(bal)) + ')');
    }
    const guess = typeof inferSubType === 'function' ? inferSubType(a.code) : null;
    const gType = guess && typeof subTypeType === 'function' ? subTypeType(guess) : null;
    if (a.imported && gType && gType !== a.type) misfiled.push(a.code + ' ' + a.name + ' — ลงไว้เป็น' + TYPE_TH_V[a.type] + ' แต่รหัสตามผังกรมพัฒน์เป็น' + TYPE_TH_V[gType]);
  });
  /* บรรทัดที่รวมเข้าบัญชีที่มีอยู่เดิม — รหัสเดิมจำไว้ในคำอธิบายบรรทัด ("รหัสเดิม ...") ตรวจประเภทย้อนได้ */
  imps.forEach((e) => e.lines.forEach(function (l) {
    const a = acc(l.acc);
    if (a.imported || e.pnlClosed && e.pnlClosed.into === a.code) return;
    String(l.memo || '').replace(/^รหัสเดิม\s*/, '').split(/,\s*/).forEach(function (src) {
      const h = typeof dbdHint === 'function' ? dbdHint(src) : null;
      if (h && h.strong && h.type && h.type !== a.type) {
        misfiled.push(src + ' → ' + a.code + ' ' + a.name + ' — รหัสเดิมเป็น' + TYPE_TH_V[h.type] + ' แต่รวมเข้าบัญชี' + TYPE_TH_V[a.type]);
      }
    });
  }));
  if (odd.length) push('warn', 'บัญชีที่ยอดอยู่ผิดด้านปกติ ' + odd.length + ' บัญชี', odd.slice(0, 12).join(' · ') + (odd.length > 12 ? ' และอื่น ๆ' : ''),
    'อาจถูกต้อง (เช่นเงินเบิกเกินบัญชี เงินทดรองที่ต้องคืน) หรือเลือกคอลัมน์เดบิต/เครดิตสลับกัน — เทียบกับงบทดลองของระบบเดิม');
  if (misfiled.length) push('bad', 'บัญชีที่อาจอยู่ผิดหมวด ' + misfiled.length + ' บัญชี', misfiled.slice(0, 12).join(' · '),
    'แก้หมวดของบัญชีที่หน้าผังบัญชี หรือยกเลิกการนำเข้าแล้วเลือกบรรทัดงบใหม่ตอนนำเข้า');
  if (imps.length && !odd.length && !misfiled.length) push('ok', 'บัญชีที่นำเข้าทุกตัวอยู่ถูกหมวดและยอดอยู่ด้านปกติ', touched.size + ' บัญชี');

  return { asOf: to, imports: imps.map((e) => ({ no: e.no, label: importLabel(e), date: e.date, lines: e.lines.length })),
    items: out, bad: out.filter((x) => x.level === 'bad').length, warn: out.filter((x) => x.level === 'warn').length };
}
const TYPE_TH_V = { asset:'สินทรัพย์', liability:'หนี้สิน', equity:'ส่วนของผู้ถือหุ้น', revenue:'รายได้', expense:'ค่าใช้จ่าย' };
