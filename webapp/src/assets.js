/* ===================================================================
   ระบบทรัพย์สินถาวรส่วนขยาย: ขาย/ตัดจำหน่าย ค่าเสื่อมย้อนหลัง · โครงการและงบประมาณ
   =================================================================== */

/* ---------- งวดในรูป 'YYYY-MM' ---------- */
/** เลื่อนงวดไป n เดือน (ติดลบได้) — '2026-01' + (-1) = '2025-12' */
function periodAdd(p, n) {
  const [y, m] = p.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + String((t % 12 + 12) % 12 + 1).padStart(2, '0');
}
/** จำนวนเดือนนับรวมหัวท้าย — '2026-01' ถึง '2026-03' = 3 */
function periodSpan(from, to) {
  const [ay, am] = from.split('-').map(Number);
  const [by, bm] = to.split('-').map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}
/** งวดแรกของสมุดบัญชีเล่มนี้ */
function booksStartPeriod() {
  return DB.periods.reduce((m, p) => (!m || p.code < m ? p.code : m), null);
}
/** ยอดในใบยอดยกมาคือยอดถึงสิ้นเดือนไหน — ยกมา ณ 1 ม.ค. คือยอดถึง ธ.ค. ปีก่อน · ยกมา ณ 30 มิ.ย. คือยอดถึง มิ.ย. */
const throughOfAsOf = (date) => periodAdd(periodOf(addDays(date, 1)), -1);
/** งวดสุดท้ายที่อยู่ในยอดยกมา — ใช้กับทะเบียนรุ่นก่อนที่กรอกค่าเสื่อมสะสมยกมาโดยไม่ได้ระบุว่า ณ วันที่ใด */
function openingCutoffPeriod() {
  let last = null;
  DB.entries.forEach(function (e) {
    if (e.type === 'opening' && e.status === 'posted' && (!last || e.date > last)) last = e.date;
  });
  if (last) return throughOfAsOf(last);
  const bs = booksStartPeriod();
  return bs ? periodAdd(bs, -1) : null;
}

/* ===================================================================
   บัญชีแยกประเภทของทรัพย์สินแต่ละตัว
   ทะเบียนรุ่นก่อนไม่ได้เก็บว่าทรัพย์สินอยู่บัญชีใด ใช้บัญชีหลักของประเภท (ที่ดิน / อาคารและอุปกรณ์)
   ผังที่นำเข้าจากระบบเดิมมักแยกบัญชีราคาทุนและค่าเสื่อมสะสมตามหมวด จึงให้เลือกบัญชีต่อทรัพย์สินได้
   =================================================================== */
const ASSET_COST_SUBS = ['ppe', 'ppe_land', 'intangible'];
const ASSET_ACCUM_SUBS = ['accum_depreciation', 'accum_amortization'];

/** บัญชีราคาทุน ค่าเสื่อมสะสม และค่าเสื่อม (หรือค่าตัดจำหน่าย) ของทรัพย์สิน
    create = true ใช้ตอนลงบัญชีเท่านั้น: สร้างบัญชีค่าตัดจำหน่ายให้ผังรุ่นเก่าที่ยังไม่มี */
function assetGl(a, create) {
  const find = (sub) => {
    const x = DB.accounts.find((y) => y.subType === sub && y.postable && y.isDefault)
      || DB.accounts.find((y) => y.subType === sub && y.postable);
    return x ? x.code : null;
  };
  const own = a.account && DB.accounts.some((x) => x.code === a.account && x.postable) ? a.account : null;
  const cost = own || find(a.class === 'LAND' ? 'ppe_land' : 'ppe');
  const intangible = !!cost && acc(cost).subType === 'intangible';
  /* สินทรัพย์ไม่มีตัวตน (โปรแกรม ลิขสิทธิ์) ตัดจำหน่ายเข้าค่าตัดจำหน่ายสะสม ไม่ใช่ค่าเสื่อมราคาสะสม */
  /* หาแบบเดียวกับ accBySub (บัญชีหลักก่อน) ทั้งตอนแสดงตัวอย่างและตอนลงบัญชี — สร้างใหม่เฉพาะเมื่อผังไม่มีเลย */
  const mk = (sub, code, name, type) => find(sub) || (create ? ensureAccount(sub, code, name, type) : null);
  const ownAccum = a.accumAccount && DB.accounts.some((x) => x.code === a.accumAccount && x.postable) ? a.accumAccount : null;
  return {
    cost,
    accum: intangible ? mk('accum_amortization', '1409', 'ค่าตัดจำหน่ายสะสม', 'asset')
      : ownAccum || mk('accum_depreciation', '1310', 'ค่าเสื่อมราคาสะสม', 'asset'),
    exp: intangible ? mk('amortization', '5342', 'ค่าตัดจำหน่าย', 'expense')
      : mk('depreciation', '5341', 'ค่าเสื่อมราคา', 'expense'),
    intangible,
  };
}
/** ตรวจบัญชีที่ผู้ใช้เลือกให้ทรัพย์สิน — ที่ดินต้องอยู่บัญชีที่ดินเท่านั้น และกลับกัน */
function assertAssetAccount(code, cls) {
  const a = DB.accounts.find((x) => x.code === code && x.postable);
  if (!a || ASSET_COST_SUBS.indexOf(a.subType) < 0) {
    throw new DomainError('ASSET_ACCOUNT_INVALID', 'บัญชี ' + code + ' ไม่ใช่บัญชีราคาทุนของทรัพย์สินถาวร',
      'เลือกบัญชีหมวดที่ดิน อาคารและอุปกรณ์ หรือสินทรัพย์ไม่มีตัวตน');
  }
  if ((cls === 'LAND') !== (a.subType === 'ppe_land')) {
    throw new DomainError('ASSET_ACCOUNT_CLASS',
      cls === 'LAND' ? 'ที่ดินต้องอยู่ในบัญชีที่ดิน' : 'บัญชี ' + a.code + ' ' + a.name + ' เป็นบัญชีที่ดิน ใช้กับทรัพย์สินประเภทอื่นไม่ได้',
      'ที่ดินไม่คิดค่าเสื่อม ถ้าบันทึกปนกับอาคารหรืออุปกรณ์ ค่าเสื่อมจะผิด');
  }
  return a.code;
}
function assertAccumAccount(code) {
  const a = DB.accounts.find((x) => x.code === code && x.postable);
  if (!a || a.subType !== 'accum_depreciation') {
    throw new DomainError('ASSET_ACCUM_ACCOUNT_INVALID', 'บัญชี ' + code + ' ไม่ใช่บัญชีค่าเสื่อมราคาสะสม');
  }
  return a.code;
}

/* ===================================================================
   ★ ค่าเสื่อมทุกเดือนที่ยังไม่ได้คิด
   นโยบาย: คิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ และคิดถึงเดือนที่ขาย/ตัดจำหน่าย (ใช้งานวันเดียวก็นับทั้งเดือน)
   ไม่มีมูลค่าซาก · ตั้งค่าเสื่อมงวดใดก็คิดทุกเดือนที่ค้างอยู่จนถึงงวดนั้นในใบเดียว
   เดิมคิดให้ทีละหนึ่งเดือนเสมอ ทรัพย์สินที่เริ่มใช้มกราคมแต่ลงทะเบียนมีนาคมจึงได้ค่าเสื่อมแค่เดือนเดียว
   =================================================================== */
/** ดัชนีงวดค่าเสื่อมล่าสุดของทรัพย์สินแต่ละตัว — สร้างครั้งเดียวต่อการคำนวณทั้งทะเบียน
    หน้าจอตรวจรายการปิดงวดทุกครั้งที่วาด ถ้าไล่ทุกงวดซ้ำทีละทรัพย์สิน ทะเบียนใหญ่จะช้า */
function assetDepIndex() {
  const runs = {};
  DB.docs.depreciation.forEach(function (r) {
    if (r.status === 'void') return;
    (r.rows || []).forEach((x) => { if (!runs[x.code] || r.period > runs[x.code]) runs[x.code] = r.period; });
  });
  let cutoff;
  return { runs, cutoff: () => (cutoff === undefined ? (cutoff = openingCutoffPeriod()) : cutoff) };
}
/** งวดล่าสุดที่ค่าเสื่อมของทรัพย์สินนี้อยู่ในค่าเสื่อมสะสมแล้ว — null = ยังไม่เคยคิด
    คิดจากเอกสารทุกครั้ง ไม่เก็บซ้ำ ยกเลิกงวดค่าเสื่อมแล้วจึงย้อนกลับเองโดยไม่ต้องตามแก้ */
function assetDepThrough(a, idx) {
  const ix = idx || assetDepIndex();
  let t = a.depThrough || null;
  const r = ix.runs[a.code];
  if (r && (!t || r > t)) t = r;
  if (t) return t;
  /* ทะเบียนรุ่นก่อนกรอกค่าเสื่อมสะสมยกมาโดยไม่บอกวันที่ — ถือว่าเป็นยอด ณ วันยกยอด */
  if ((a.accumBook || 0) > 0 || (a.accumTax || 0) > 0) return ix.cutoff();
  return null;
}
/** เดือนแรกที่ยังไม่ได้คิดค่าเสื่อม
    ค่าเสื่อมของเดือนก่อนเริ่มสมุดบัญชีต้องมาเป็นค่าเสื่อมสะสมยกมา ไม่ใช่ค่าใช้จ่ายของงวดแรก
    ไม่งั้นทรัพย์สินที่ใช้มาหลายปีจะลงค่าเสื่อมทั้งหมดในเดือนเดียว และซ้ำกับยอดยกมาในบัญชี */
function assetDepStart(a, idx) {
  const svc = periodOf(a.inService);
  const t = assetDepThrough(a, idx);
  let s = t ? periodAdd(t, 1) : svc;
  if (s < svc) s = svc;
  const bs = booksStartPeriod();
  if (bs && s < bs) s = bs;
  return s;
}
/** ทรัพย์สินเริ่มใช้ก่อนเริ่มสมุดบัญชีแต่ไม่มีค่าเสื่อมสะสมยกมา — ค่าเสื่อมส่วนก่อนหน้าจะขาดไป ต้องเตือน */
function assetMissingOpeningAccum(a, idx) {
  const bs = booksStartPeriod();
  return !!bs && a.class !== 'LAND' && periodOf(a.inService) < bs && !assetDepThrough(a, idx);
}
/** ค่าเสื่อมของทรัพย์สินหนึ่งตัวสำหรับทุกเดือนที่ยังไม่ได้คิดจนถึงงวด period
    รายเดือนเท่ากับการคิดทีละเดือนพอดี (ราคาทุน ÷ อายุ ÷ 12 ปัดทุกครั้ง) และไม่เกินยอดที่เหลือ */
function assetDepreciationFor(a, period, idx) {
  if (a.class === 'LAND' || a.status !== 'in_use' || !a.bookYears) return null;
  if (periodOf(a.inService) > period) return null;
  const bookRemaining = a.cost - a.accumBook;
  if (bookRemaining <= 0) return null;
  const from = assetDepStart(a, idx);
  if (from > period) return null;
  const months = periodSpan(from, period);
  const bookMonthly = divRound(divRound(a.cost, a.bookYears), 12);
  const book = Math.min(bookMonthly * months, bookRemaining);
  const t = TAX_DEPRECIATION[a.class];
  const taxBase = t.costCap ? Math.min(a.cost, t.costCap) : a.cost;
  const tax = Math.max(0, Math.min(divRound(pct(taxBase, t.rate), 12) * months, taxBase - a.accumTax));
  return { from, to: period, months, book, tax, bookMonthly, taxBase };
}
/** รายการค่าเสื่อมที่จะลงในงวดนี้ — แถวละทรัพย์สิน พร้อมเดือนที่รวมไว้ */
function depreciationPlan(period, create) {
  const out = [];
  const idx = assetDepIndex();
  DB.assets.forEach(function (a) {
    const d = assetDepreciationFor(a, period, idx);
    if (!d || d.book <= 0) return;
    const gl = assetGl(a, create);
    out.push({ code: a.code, name: a.name, class: a.class, cost: a.cost,
      from: d.from, months: d.months, book: d.book, tax: d.tax, diff: d.book - d.tax,
      nbvBook: a.cost - a.accumBook - d.book, nbvTax: d.taxBase - a.accumTax - d.tax,
      expAcc: gl.exp, accumAcc: gl.accum });
  });
  return out;
}
/** บรรทัดใบสำคัญค่าเสื่อม — รวมตามบัญชี (ค่าเสื่อม/ค่าตัดจำหน่าย และค่าเสื่อมสะสมแต่ละบัญชี) */
function depreciationLines(rows) {
  const dr = {}, cr = {};
  rows.forEach(function (r) {
    dr[r.expAcc] = (dr[r.expAcc] || 0) + r.book;
    cr[r.accumAcc] = (cr[r.accumAcc] || 0) + r.book;
  });
  return Object.keys(dr).map((a) => ({ acc: a, dr: dr[a] }))
    .concat(Object.keys(cr).map((a) => ({ acc: a, cr: cr[a] })));
}

/* ===================================================================
   ขายและตัดจำหน่ายทรัพย์สิน
   ขั้นที่ 1 คิดค่าเสื่อมส่วนที่ค้างจนถึงเดือนที่จำหน่าย
   ขั้นที่ 2 Dr ค่าเสื่อมสะสม · Dr เงินสด/ลูกหนี้ · Cr ราคาทุน · Cr ภาษีขาย · ส่วนต่างเข้ากำไร/ขาดทุนจากการจำหน่าย
   เดิมเปลี่ยนสถานะเป็น "จำหน่ายแล้ว" ได้โดยไม่ลงบัญชีอะไรเลย ราคาทุนและค่าเสื่อมสะสมค้างอยู่ในงบตลอดไป
   =================================================================== */
const DISPOSAL_KIND = { sale: 'ขายทรัพย์สิน', writeoff: 'ตัดจำหน่ายทรัพย์สิน' };
/** ที่ดินและอาคารเป็นอสังหาริมทรัพย์ ไม่อยู่ในระบบภาษีมูลค่าเพิ่ม (อาจเสียภาษีธุรกิจเฉพาะแทน) */
const IMMOVABLE_CLASSES = ['LAND', 'BUILDING'];

function assetFind(code) {
  const a = DB.assets.find((x) => x.code === code);
  if (!a) throw new DomainError('ASSET_NOT_FOUND', 'ไม่พบทรัพย์สินรหัส ' + (code || '—'), 'เลือกทรัพย์สินจากทะเบียน');
  return a;
}
/** ขายทรัพย์สินที่ใช้ในกิจการต้องเสียภาษีขายเมื่อกิจการจดทะเบียนภาษีมูลค่าเพิ่ม (ยกเว้นอสังหาริมทรัพย์) */
const disposalVatApplies = (a) => !!DB.company && DB.company.vatRegistered !== false && IMMOVABLE_CLASSES.indexOf(a.class) < 0;

/** บัญชีลูกหนี้จากการขายทรัพย์สิน — แยกจากลูกหนี้การค้า เพราะลูกหนี้การค้าต้องมีใบกำกับขายสินค้ารองรับรายใบ
    ผังที่ยังไม่มีบัญชีนี้ สร้างให้ในหมวดลูกหนี้อื่น (create = true ใช้ตอนลงบัญชีเท่านั้น) */
function assetSaleReceivableAccount(create) {
  const a = DB.accounts.find((x) => x.postable && x.assetSaleReceivable)
    || DB.accounts.find((x) => x.postable && x.subType === 'other_receivable' && /ขาย(ทรัพย์สิน|สินทรัพย์)/.test(x.name || ''));
  if (a) return a.code;
  if (!create) return null;
  let c = '1142';
  for (let i = 1; DB.accounts.some((x) => x.code === c); i++) c = '1142-' + i;
  DB.accounts.push({ code: c, name: 'ลูกหนี้จากการขายทรัพย์สิน', type: 'asset', subType: 'other_receivable',
    postable: true, requiresPartner: false, level: 3, assetSaleReceivable: true });
  DB.accounts.sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
  audit('account', c, 'create', null, { name: 'ลูกหนี้จากการขายทรัพย์สิน', subType: 'other_receivable' },
    'ขายทรัพย์สินเงินเชื่อครั้งแรก — แยกจากลูกหนี้การค้าที่ต้องมีใบกำกับขายสินค้ารองรับ');
  return c;
}

/** คำนวณผลการขาย/ตัดจำหน่ายทั้งหมด โดยยังไม่เขียนอะไร
    ใช้ทั้งตอนแสดงตัวอย่างในฟอร์มและตอนลงบัญชีจริง ตัวเลขที่ผู้ใช้เห็นจึงตรงกับที่ลงบัญชีเสมอ */
function disposalPreview(input) {
  const a = assetFind(input.assetCode);
  /* ทะเบียนรุ่นก่อนตั้งสถานะ "จำหน่ายแล้ว" ได้โดยไม่ลงบัญชี ราคาทุนจึงยังค้างในบัญชี — ให้บันทึกการจำหน่ายย้อนตามจริงได้
     ค่าเสื่อมของตัวนี้หยุดไปแล้วตั้งแต่วันที่ตั้งสถานะ จึงไม่คิดค่าเสื่อมเพิ่ม */
  const legacy = a.status === 'disposed' && !a.disposalNo;
  if (a.status !== 'in_use' && !legacy) {
    throw new DomainError('ASSET_NOT_IN_USE', 'ทรัพย์สิน ' + a.code + ' จำหน่ายออกไปแล้ว' + (a.disposalNo ? ' ตาม ' + a.disposalNo : ''),
      a.disposalNo ? 'ถ้าบันทึกผิด ให้ยกเลิกเอกสาร ' + a.disposalNo + ' ก่อน' : '');
  }
  const date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ขายหรือตัดจำหน่าย');
  if (date < a.inService) {
    throw new DomainError('DISPOSAL_BEFORE_IN_SERVICE', 'วันที่จำหน่าย (' + thDate(date) + ') อยู่ก่อนวันที่เริ่มใช้ (' + thDate(a.inService) + ')');
  }
  const kind = input.kind === 'writeoff' ? 'writeoff' : 'sale';
  const period = periodOf(date);
  const through = assetDepThrough(a);
  if (through && through > period) {
    throw new DomainError('ASSET_DEPRECIATED_PAST_DISPOSAL',
      'ทรัพย์สินนี้คิดค่าเสื่อมไปถึงงวด ' + thPeriod(through) + ' แล้ว ซึ่งเลยวันที่จำหน่าย',
      'ใช้วันที่จำหน่ายในงวด ' + thPeriod(through) + ' หรือหลังจากนั้น หรือยกเลิกค่าเสื่อมงวดหลังวันจำหน่ายก่อน (ยกเลิกจากงวดล่าสุดย้อนกลับมา)');
  }
  const dep = (!legacy && assetDepreciationFor(a, period)) || { from: null, to: period, months: 0, book: 0, tax: 0 };
  const accumBook = a.accumBook + dep.book;
  const accumTax = a.accumTax + dep.tax;
  const nbv = a.cost - accumBook;
  const t = TAX_DEPRECIATION[a.class];
  const taxNbv = (t.costCap ? Math.min(a.cost, t.costCap) : a.cost) - accumTax;

  const proceeds = kind === 'sale' ? M(String(input.proceeds || '0')) : 0;
  if (kind === 'sale' && proceeds <= 0) {
    throw new DomainError('DISPOSAL_PROCEEDS_REQUIRED', 'ขายทรัพย์สินต้องมีราคาขายมากกว่าศูนย์',
      'ถ้าทิ้ง ชำรุด หรือสูญหายโดยไม่ได้เงิน ให้เลือก "ตัดจำหน่าย"');
  }
  /* ภาษีขายคิดเองจากประเภททรัพย์สินและการจดทะเบียน ไม่ให้เลือก — ขายรถหรือเครื่องจักรที่ใช้แล้วลืมภาษีขาย
     เป็นข้อผิดพลาดที่พบบ่อยและมีเงินเพิ่มตามมา */
  const vatCode = kind === 'sale' && disposalVatApplies(a) ? 'VAT7' : 'NONE';
  const rate = vatCode === 'VAT7' ? resolveRate('VAT7', date).rate : '0';
  const vat = vatCode === 'VAT7' ? round2(pct(proceeds, rate)) : 0;
  const total = proceeds + vat;
  const gain = proceeds - nbv;

  const settle = kind === 'sale' ? (input.settle === 'credit' ? 'credit' : 'cash') : null;
  const partner = input.partnerCode ? partnerByCode(input.partnerCode) : null;
  const trim = (v) => String(v || '').trim();
  const snap = partner ? snapshotPartner(partner) : {
    name: trim(input.buyerName), taxId: trim(input.buyerTaxId) || null, address: trim(input.buyerAddress),
    branch: trim(input.buyerTaxId) ? (trim(input.buyerBranch) || '00000') : null,
  };
  if (settle === 'credit' && !partner) {
    throw new DomainError('DISPOSAL_CREDIT_NEEDS_PARTNER', 'ขายเงินเชื่อต้องเลือกผู้ซื้อจากทะเบียนคู่ค้า',
      'ระบบต้องรู้ว่าใครค้างชำระ — เพิ่มผู้ซื้อในทะเบียนลูกค้าก่อน หรือเลือกรับเงินทันที');
  }
  if (vatCode === 'VAT7') {
    /* ใบกำกับภาษีเต็มรูปต้องมีชื่อและที่อยู่ผู้ซื้อ (ม.86/4) — เลขผู้เสียภาษีของผู้ซื้อใส่เมื่อผู้ซื้อมีเลข */
    const miss = [];
    if (!snap.name) miss.push('ชื่อผู้ซื้อ');
    if (!snap.address) miss.push('ที่อยู่ผู้ซื้อ');
    if (miss.length) {
      throw new DomainError('TAX_INVOICE_INCOMPLETE', 'ขายทรัพย์สินต้องออกใบกำกับภาษี แต่ยังขาด' + miss.join(' และ '),
        'เลือกผู้ซื้อจากทะเบียนลูกค้า หรือกรอกชื่อและที่อยู่ผู้ซื้อ (มาตรา 86/4)');
    }
    if (snap.taxId && !validTaxId(snap.taxId)) {
      throw new DomainError('TAX_ID_INVALID', 'เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (' + snap.taxId + ') ไม่ผ่านการตรวจสอบหลักที่ 13');
    }
  }
  let payTo = null;
  if (settle === 'cash') {
    payTo = input.payTo || accBySub('bank');
    const pa = DB.accounts.find((x) => x.code === payTo);
    if (!pa || (pa.subType !== 'cash' && pa.subType !== 'bank')) {
      throw new DomainError('DISPOSAL_PAY_TO_INVALID', 'ต้องรับเงินเข้าบัญชีเงินสดหรือเงินฝากธนาคาร');
    }
  }
  /* ภาษีขายเข้าเดือนที่ยื่น ภ.พ.30 ไปแล้ว แบบที่ยื่นจะไม่ตรงกับรายงานภาษีขาย — ต้องยื่นแบบเพิ่มเติม ระบบยังไม่รองรับ */
  if (vatCode === 'VAT7' && DB.docs.filing.some((f) => f.form === 'PP30' && f.period === period)) {
    throw new DomainError('VAT_PERIOD_FILED', 'ยื่น ภ.พ.30 งวด ' + thPeriod(period) + ' ไปแล้ว บันทึกการขายที่มีภาษีขายในเดือนนี้ไม่ได้',
      'ใช้วันที่ขายจริงในงวดที่ยังไม่ได้ยื่น หรือยื่นแบบ ภ.พ.30 เพิ่มเติมกับกรมสรรพากรแล้วบันทึกปรับปรุง');
  }
  const gl = assetGl(a, false);
  if (!gl.cost) {
    throw new DomainError('ACCOUNT_MAPPING_MISSING', 'ยังไม่รู้ว่าทรัพย์สิน ' + a.code + ' บันทึกอยู่บัญชีใด',
      'แก้ไขทรัพย์สินในทะเบียนแล้วเลือกบัญชีราคาทุนก่อน');
  }
  /* ทะเบียนไม่ได้ลงบัญชีเอง ถ้าทรัพย์สินถูกบันทึกไว้คนละบัญชีกับในทะเบียน การจำหน่ายจะทำให้บัญชีนั้นติดลบ — เตือนก่อนบันทึก */
  const warnings = [];
  const glCost = gl.cost ? balanceOf(gl.cost, date) : 0;
  if (gl.cost && glCost < a.cost) {
    warnings.push('บัญชี ' + gl.cost + ' มียอด ' + fmt(glCost) + ' บาท น้อยกว่าราคาทุนของทรัพย์สินนี้ ' + fmt(a.cost)
      + ' บาท — ตรวจว่าทรัพย์สินบันทึกไว้ที่บัญชีใด (หน้าทะเบียน → ทะเบียนเทียบบัญชีแยกประเภท) ก่อนบันทึก');
  }
  const glAccum = gl.accum ? -balanceOf(gl.accum, date) : 0;
  if (gl.accum && a.accumBook > 0 && glAccum < a.accumBook) {
    warnings.push('บัญชีค่าเสื่อมสะสม ' + gl.accum + ' มียอด ' + fmt(glAccum) + ' บาท น้อยกว่าค่าเสื่อมสะสมในทะเบียน ' + fmt(a.accumBook) + ' บาท');
  }
  return { asset: a, legacy, kind, date, period, dep, warnings, accumBefore: a.accumBook, accumTaxBefore: a.accumTax, accumBook, accumTax,
    nbv, taxNbv, taxGain: proceeds - taxNbv, proceeds, vatCode, rate, vat, total, gain, settle, partner, snap, payTo, gl,
    note: trim(input.note) };
}

/** บรรทัดใบสำคัญของการจำหน่าย — ใช้ทั้งตัวอย่างในฟอร์ม (create = false) และตอนลงบัญชีจริง
    บัญชีที่ผังยังไม่มีจะได้ acc = null พร้อม label ในตัวอย่าง และระบบสร้างให้ตอนลงบัญชี */
function disposalJournal(pv, create) {
  const a = pv.asset;
  const gl = assetGl(a, create);
  const sub = (st, code, name, type) => {
    const x = DB.accounts.find((y) => y.subType === st && y.postable && y.isDefault)
      || DB.accounts.find((y) => y.subType === st && y.postable);
    return x ? x.code : create ? ensureAccount(st, code, name, type) : null;
  };
  const recv = pv.settle === 'credit' ? assetSaleReceivableAccount(create) : pv.settle === 'cash' ? pv.payTo : null;
  /* ค่าเสื่อมส่วนที่ค้างถึงเดือนที่จำหน่ายเป็นค่าใช้จ่ายของงวดจริง ต้องลงก่อน กำไรขาดทุนจากการจำหน่ายจึงถูก */
  const dep = pv.dep.book > 0 ? [
    { acc: gl.exp, dr: pv.dep.book, label: gl.intangible ? 'ค่าตัดจำหน่าย' : 'ค่าเสื่อมราคา' },
    { acc: gl.accum, cr: pv.dep.book, label: gl.intangible ? 'ค่าตัดจำหน่ายสะสม' : 'ค่าเสื่อมราคาสะสม' },
  ] : null;
  const main = [
    pv.accumBook ? { acc: gl.accum, dr: pv.accumBook, memo: 'ล้างค่าเสื่อมสะสมของ ' + a.code, label: 'ค่าเสื่อมราคาสะสม' } : null,
    pv.total ? { acc: recv, dr: pv.total, partner: pv.partner ? pv.partner.code : null,
      memo: pv.settle === 'credit' ? 'ค้างรับค่าขายทรัพย์สิน' : 'รับเงินค่าขายทรัพย์สิน',
      label: pv.settle === 'credit' ? 'ลูกหนี้จากการขายทรัพย์สิน' : 'เงินสด/เงินฝากธนาคาร' } : null,
    { acc: gl.cost, cr: a.cost, memo: 'ตัดราคาทุน ' + a.code, label: 'ราคาทุนทรัพย์สิน' },
    pv.vat ? { acc: accBySub('output_vat'), cr: pv.vat, label: 'ภาษีขาย' } : null,
    pv.gain > 0 ? { acc: sub('gain_on_disposal', '4240', 'กำไรจากการจำหน่ายสินทรัพย์', 'revenue'), cr: pv.gain,
      label: 'กำไรจากการจำหน่ายสินทรัพย์' } : null,
    pv.gain < 0 ? { acc: sub('loss_on_disposal', '5353', 'ขาดทุนจากการจำหน่ายสินทรัพย์', 'expense'), dr: -pv.gain,
      label: 'ขาดทุนจากการจำหน่ายสินทรัพย์' } : null,
  ].filter(Boolean);
  return { gl, recv, dep, main };
}

function disposeAsset(input) {
  const pv = disposalPreview(input);
  assertPostingOpen(pv.date);
  const a = pv.asset;
  const no = nextNo(pv.kind === 'sale' ? 'assetSale' : 'assetWriteOff', pv.date);
  const j = disposalJournal(pv, true);
  const gl = j.gl, recv = j.recv;
  const what = DISPOSAL_KIND[pv.kind] + ' ' + a.code + ' ' + a.name;
  const depJe = j.dep ? post({
    type: 'asset', date: pv.date, src: 'assetDisposal', srcId: no,
    desc: 'ค่าเสื่อมราคา ' + a.code + ' ' + a.name + ' ' + pv.dep.months + ' เดือนถึงเดือนที่จำหน่าย (' + no + ')',
    lines: j.dep,
  }) : null;
  const je = post({
    type: pv.kind === 'writeoff' ? 'asset' : pv.settle === 'credit' ? 'sales' : 'receipt',
    date: pv.date, desc: what + (pv.snap.name ? ' ให้ ' + pv.snap.name : '') + ' (' + no + ')',
    src: 'assetDisposal', srcId: no, lines: j.main,
  });
  if (pv.vatCode === 'VAT7') {
    DB.taxTx.push({
      kind: 'vat_output', period: pv.period, date: pv.date, docNo: no, docType: 'tax_invoice',
      partnerName: pv.snap.name, taxId: pv.snap.taxId, branch: pv.snap.branch,
      base: pv.proceeds, zero: 0, exempt: 0, tax: pv.vat, entryNo: je.no, filingId: null, assetDisposalNo: no,
    });
  }
  a.accumBook = pv.accumBook;
  a.accumTax = pv.accumTax;
  a.status = 'disposed';
  a.disposalNo = no;
  a.disposedDate = pv.date;
  const doc = {
    no, kind: pv.kind, date: pv.date, assetCode: a.code, assetName: a.name, class: a.class, inService: a.inService,
    account: gl.cost, accumAccount: gl.accum, cost: a.cost,
    accumBefore: pv.accumBefore, accumTaxBefore: pv.accumTaxBefore, statusBefore: pv.legacy ? 'disposed' : 'in_use',
    dep: { from: pv.dep.from, to: pv.period, months: pv.dep.months, book: pv.dep.book, tax: pv.dep.tax },
    accumBook: pv.accumBook, accumTax: pv.accumTax, nbv: pv.nbv, taxNbv: pv.taxNbv,
    proceeds: pv.proceeds, vatCode: pv.vatCode, vatRate: pv.rate, vat: pv.vat, total: pv.total, gain: pv.gain,
    settle: pv.settle, payTo: pv.payTo, recvAccount: recv,
    partnerCode: pv.partner ? pv.partner.code : null, partnerName: pv.snap.name || '', snap: pv.snap,
    note: pv.note, entryNo: je.no, depEntryNo: depJe ? depJe.no : null, collections: [], status: 'posted',
  };
  DB.docs.assetDisposal.unshift(doc);
  audit('assetDisposal', no, pv.kind, null, { asset: a.code, proceeds: fmt(pv.proceeds), gain: fmt(pv.gain) });
  return doc;
}

function assetDisposalFind(no) {
  const d = DB.docs.assetDisposal.find((x) => x.no === no);
  if (!d) throw new DomainError('DOC_NOT_FOUND', 'ไม่พบเอกสารขาย/ตัดจำหน่ายทรัพย์สิน ' + no);
  return d;
}
const liveCollections = (d) => (d.collections || []).filter((c) => c.status !== 'void');
/** ค่าขายทรัพย์สินที่ผู้ซื้อยังค้างชำระ */
const assetSaleOutstanding = (d) => (d.status === 'void' || d.settle !== 'credit') ? 0
  : d.total - liveCollections(d).reduce((s, c) => s + c.amount, 0);

/** ตรวจก่อนยกเลิก — คืนเอกสาร ถ้ายกเลิกไม่ได้โยนข้อผิดพลาดที่บอกวิธีแก้ */
function disposalVoidCheck(no) {
  const d = assetDisposalFind(no);
  if (d.status === 'void') throw new DomainError('ALREADY_VOID', 'เอกสาร ' + no + ' ยกเลิกไปแล้ว');
  const p = periodFor(d.date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ยกเลิกเอกสาร ' + no + ' ไม่ได้',
      'บันทึกรายการปรับปรุงในงวดปัจจุบันแทน');
  }
  /* ภาษีขายของเดือนที่ยื่น ภ.พ.30 ไปแล้ว ลบออกจากรายงานไม่ได้ แบบที่ยื่นจะไม่ตรงกับรายงาน */
  if (d.vat) {
    const filed = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === periodOf(d.date))
      || DB.taxTx.find((t) => t.assetDisposalNo === d.no && t.filingId);
    if (filed) {
      throw new DomainError('TAX_ALREADY_FILED', 'ยื่นแบบ ภ.พ.30 งวด ' + thPeriod(periodOf(d.date)) + ' ที่มีภาษีขายของเอกสารนี้ไปแล้ว ยกเลิกไม่ได้',
        'ยื่นแบบ ภ.พ.30 เพิ่มเติมกับกรมสรรพากร แล้วบันทึกรายการปรับปรุงในงวดปัจจุบัน');
    }
  }
  const got = liveCollections(d);
  if (got.length) {
    throw new DomainError('VOID_HAS_DEPENDENTS', 'รับชำระค่าขายไปแล้ว ' + got.map((c) => c.no).join(', '),
      'ยกเลิกการรับชำระก่อน แล้วค่อยยกเลิกเอกสารขาย');
  }
  const a = DB.assets.find((x) => x.code === d.assetCode);
  if (!a || a.disposalNo !== d.no) {
    throw new DomainError('DISPOSAL_ASSET_CHANGED', 'ทะเบียนทรัพย์สิน ' + d.assetCode + ' ไม่ได้อ้างเอกสารนี้แล้ว ยกเลิกไม่ได้');
  }
  [d.entryNo, d.depEntryNo].filter(Boolean).forEach(function (en) {
    const e = DB.entries.find((x) => x.no === en);
    if (!e || e.status !== 'posted') throw new DomainError('ALREADY_REVERSED', 'ใบสำคัญ ' + en + ' ของเอกสารนี้ถูกกลับรายการไปแล้ว');
  });
  return d;
}
/** สิ่งที่จะเกิดขึ้นเมื่อยกเลิก — แสดงให้เห็นก่อนกดยืนยัน */
function disposalVoidPreview(no) {
  const d = disposalVoidCheck(no);
  const out = ['กลับรายการใบสำคัญ ' + [d.entryNo, d.depEntryNo].filter(Boolean).join(' และ ') + ' ณ วันที่ ' + thDate(d.date)];
  if (d.vat) out.push('รายงานภาษีขายแสดงว่า "ยกเลิก" ยอดเป็นศูนย์');
  out.push('ทรัพย์สิน ' + d.assetCode + (d.statusBefore === 'disposed' ? ' กลับไปเป็นสถานะเดิมก่อนบันทึกเอกสารนี้' : ' กลับมาใช้งานอยู่')
    + ' ค่าเสื่อมสะสมกลับเท่ากับก่อนจำหน่าย');
  return out;
}
function voidAssetDisposal(no, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกเอกสารต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร',
      'ผู้สอบบัญชีจะเห็นเหตุผลนี้ในร่องรอยการตรวจสอบ');
  }
  const why = String(reason).trim();
  const d = disposalVoidCheck(no);
  [d.entryNo, d.depEntryNo].filter(Boolean).forEach(function (en) {
    reverse(en, 'ยกเลิก' + DISPOSAL_KIND[d.kind] + ' ' + no + ' — ' + why, d.date, { fromSource: true });
  });
  DB.taxTx.forEach(function (t) {
    if (t.void || t.assetDisposalNo !== d.no) return;
    t.orig = { base: t.base, zero: t.zero || 0, exempt: t.exempt || 0, tax: t.tax };
    t.base = 0; t.zero = 0; t.exempt = 0; t.tax = 0;
    t.void = true; t.voidReason = why;
  });
  const a = DB.assets.find((x) => x.code === d.assetCode);
  a.accumBook -= d.dep.book;
  a.accumTax -= d.dep.tax;
  a.status = d.statusBefore || 'in_use';
  delete a.disposalNo;
  delete a.disposedDate;
  d.status = 'void';
  d.voidReason = why;
  d.voidedAt = new Date().toISOString();
  audit('assetDisposal', no, 'void', { status: 'posted' }, { status: 'void' }, why);
  return d;
}

/** รับชำระค่าขายทรัพย์สินที่ขายเงินเชื่อ — Dr เงินสด/ธนาคาร / Cr ลูกหนี้จากการขายทรัพย์สิน */
function collectAssetSale(no, input) {
  const d = assetDisposalFind(no);
  if (d.status === 'void') throw new DomainError('DOC_VOID', 'เอกสาร ' + no + ' ถูกยกเลิกไปแล้ว');
  if (d.settle !== 'credit') throw new DomainError('DISPOSAL_NOT_CREDIT', 'เอกสาร ' + no + ' รับเงินไปแล้วตอนขาย ไม่มียอดค้างรับ');
  const due = assetSaleOutstanding(d);
  if (due <= 0) throw new DomainError('NOTHING_DUE', 'ค่าขายตามเอกสาร ' + no + ' รับครบแล้ว');
  const amount = input.amount ? M(String(input.amount)) : due;
  if (amount <= 0 || amount > due) {
    throw new DomainError('COLLECT_EXCEEDS', 'ยอดรับ ' + fmt(amount) + ' ต้องมากกว่าศูนย์และไม่เกินยอดค้าง ' + fmt(due));
  }
  const date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่รับเงิน');
  if (date < d.date) throw new DomainError('COLLECT_BEFORE_SALE', 'วันที่รับเงินอยู่ก่อนวันที่ขาย (' + thDate(d.date) + ')');
  const payTo = input.payTo || accBySub('bank');
  const pa = DB.accounts.find((x) => x.code === payTo);
  if (!pa || (pa.subType !== 'cash' && pa.subType !== 'bank')) {
    throw new DomainError('DISPOSAL_PAY_TO_INVALID', 'ต้องรับเงินเข้าบัญชีเงินสดหรือเงินฝากธนาคาร');
  }
  assertPostingOpen(date);
  const cno = nextNo('assetReceipt', date);
  const je = post({
    type: 'receipt', date, src: 'assetDisposal', srcId: d.no,
    desc: 'รับชำระค่าขายทรัพย์สิน ' + d.assetName + ' จาก ' + d.partnerName + ' อ้าง ' + d.no + ' (' + cno + ')',
    lines: [{ acc: payTo, dr: amount }, { acc: d.recvAccount, cr: amount, partner: d.partnerCode }],
  });
  const c = { no: cno, date, amount, payTo, entryNo: je.no, status: 'posted' };
  d.collections.push(c);
  audit('assetDisposal', d.no, 'collect', null, { receipt: cno, amount: fmt(amount) });
  return c;
}
function voidAssetCollection(no, cno, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  }
  const d = assetDisposalFind(no);
  const c = (d.collections || []).find((x) => x.no === cno && x.status !== 'void');
  if (!c) throw new DomainError('DOC_NOT_FOUND', 'ไม่พบการรับชำระ ' + cno + ' ที่ยังใช้งานอยู่');
  const p = periodFor(c.date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ยกเลิกการรับชำระไม่ได้', 'บันทึกรายการปรับปรุงในงวดปัจจุบันแทน');
  }
  reverse(c.entryNo, 'ยกเลิกการรับชำระ ' + cno + ' — ' + String(reason).trim(), c.date, { fromSource: true });
  c.status = 'void';
  c.voidReason = String(reason).trim();
  audit('assetDisposal', d.no, 'void_collect', null, { receipt: cno }, c.voidReason);
  return c;
}

/* ===================================================================
   ทะเบียนกับบัญชีแยกประเภท
   ทะเบียนไม่ลงบัญชีเอง (ซื้อทรัพย์สินลงบัญชีผ่านตั้งหนี้แล้ว) — จึงต้องมีที่เทียบว่าสองฝั่งตรงกัน
   =================================================================== */
/** บรรทัดในเอกสารที่ลงบัญชีราคาทุนทรัพย์สิน — ใช้ลงทะเบียนโดยดึงราคาทุนและวันที่จากเอกสาร */
function ppeSourceLines() {
  const isCost = (code) => { const a = DB.accounts.find((x) => x.code === code); return !!a && ASSET_COST_SUBS.indexOf(a.subType) >= 0; };
  const taken = {};
  DB.assets.forEach((a) => { if (a.source) taken[a.source.kind + '|' + a.source.no + '|' + a.source.line] = a.code; });
  const out = [];
  const push = (o) => { o.key = o.kind + '|' + o.no + '|' + o.line; o.assetCode = taken[o.key] || null; out.push(o); };
  DB.docs.bill.forEach(function (b) {
    if (b.status === 'void' || b.broughtForward) return;
    (b.lines || []).forEach(function (l, i) {
      if (l.acc && isCost(l.acc)) push({ kind: 'bill', no: b.no, line: i, date: b.date, partnerName: b.partnerName,
        ref: b.vendorNo, desc: l.desc, acc: l.acc, amount: l.amount });
    });
  });
  /* หน้าค่าใช้จ่ายยังเลือกบัญชีทรัพย์สินไม่ได้ แต่ถ้าวันหนึ่งเปิดให้เลือก ทะเบียนจะดึงมาได้ทันที */
  DB.docs.expense.forEach(function (x) {
    if (x.status === 'void') return;
    (x.lines || []).forEach(function (l, i) {
      if (l.acc && isCost(l.acc)) push({ kind: 'expense', no: x.no, line: i, date: x.date, partnerName: x.partnerName,
        ref: x.taxInvoiceNo, desc: l.desc, acc: l.acc, amount: l.amount });
    });
  });
  /* ใบสำคัญที่บันทึกเองแล้วเดบิตบัญชีทรัพย์สิน เช่นโอนงานระหว่างก่อสร้างเป็นอาคาร */
  DB.entries.forEach(function (e) {
    if (e.status !== 'posted' || e.src !== 'manual') return;
    e.lines.forEach(function (l, i) {
      if (l.dr > 0 && isCost(l.acc)) push({ kind: 'entry', no: e.no, line: i, date: e.date, partnerName: '',
        ref: e.srcId, desc: l.memo || e.desc, acc: l.acc, amount: l.dr });
    });
  });
  return out.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
}
function sourceLineFind(kind, no, line) {
  const s = ppeSourceLines().find((x) => x.kind === kind && x.no === no && x.line === Number(line));
  if (!s) {
    throw new DomainError('SOURCE_LINE_NOT_FOUND', 'ไม่พบรายการที่ลงบัญชีทรัพย์สินตามเอกสาร ' + no,
      'เอกสารอาจถูกยกเลิก หรือบรรทัดนั้นไม่ได้ลงบัญชีทรัพย์สินถาวร');
  }
  return s;
}
/** ลงทะเบียนทรัพย์สินจากบรรทัดตั้งหนี้/ค่าใช้จ่าย/ใบสำคัญ — ราคาทุนและบัญชีมาจากเอกสาร ไม่ต้องพิมพ์ซ้ำ */
function registerAssetFromDoc(input) {
  const s = sourceLineFind(input.kind, input.no, input.line);
  if (s.assetCode) {
    throw new DomainError('SOURCE_ALREADY_REGISTERED', 'รายการนี้ลงทะเบียนไปแล้วเป็น ' + s.assetCode,
      'แก้ไขทรัพย์สิน ' + s.assetCode + ' ในทะเบียนแทน');
  }
  const inService = String(input.inService || '').trim() || s.date;
  const r = saveAsset({ name: String(input.name || '').trim() || s.desc, class: input.class, inService,
    cost: unM(s.amount), bookYears: input.bookYears, account: s.acc, accumAccount: input.accumAccount || null,
    note: input.note || '' });
  r.asset.source = { kind: s.kind, no: s.no, line: s.line, date: s.date };
  audit('asset', r.asset.code, 'register_from_doc', null, { doc: s.no, cost: fmt(s.amount) });
  return r;
}

/** ค่าเสื่อมสะสมตามนโยบายเดียวกับการตั้งค่าเสื่อม ถึงสิ้นเดือนของ asOf — ใช้เติมให้ในฟอร์มลงทะเบียนยอดยกมา */
function suggestOpeningAccum(input) {
  const cls = String(input.class || '');
  const t = TAX_DEPRECIATION[cls];
  const cost = M(String(input.cost || '0'));
  const years = Number(input.bookYears || 0);
  const svc = String(input.inService || ''), asOf = String(input.asOf || '');
  if (!t || cost <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(svc) || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) || asOf < svc) return { book: 0, tax: 0, months: 0 };
  const months = Math.max(0, periodSpan(periodOf(svc), throughOfAsOf(asOf)));
  if (cls === 'LAND' || !years) return { book: 0, tax: 0, months };
  const taxBase = t.costCap ? Math.min(cost, t.costCap) : cost;
  return { months,
    book: Math.min(divRound(divRound(cost, years), 12) * months, cost),
    tax: Math.min(divRound(pct(taxBase, t.rate), 12) * months, taxBase) };
}
/** ลงทะเบียนทรัพย์สินที่มีอยู่ก่อนเริ่มใช้ระบบ พร้อมค่าเสื่อมสะสม ณ วันที่ยกยอด
    ★ ไม่ลงบัญชี — ราคาทุนและค่าเสื่อมสะสมอยู่ในบัญชีแล้วจากยอดยกมาหรือการนำเข้า ถ้าลงซ้ำยอดจะเป็นสองเท่า
    ระบบคิดค่าเสื่อมต่อจากเดือนถัดจากวันที่ยกยอด */
function registerOpeningAsset(input) {
  const asOf = String(input.asOf || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new DomainError('ASSET_ASOF_REQUIRED', 'ต้องระบุว่าค่าเสื่อมสะสมที่กรอกเป็นยอด ณ วันที่ใด',
      'ใช้วันที่เดียวกับวันตัดยอดที่นำเข้างบทดลอง');
  }
  if (input.inService && asOf < String(input.inService)) {
    throw new DomainError('ASSET_ASOF_BEFORE_SERVICE', 'วันที่ยกยอด (' + thDate(asOf) + ') อยู่ก่อนวันที่เริ่มใช้ทรัพย์สิน',
      'ทรัพย์สินที่ซื้อหลังวันยกยอดให้ลงทะเบียนจากรายการตั้งหนี้แทน');
  }
  /* ค่าเสื่อมงวดหลังคิดต่อจากยอดยกมานี้แล้ว — แก้ยอดยกมาตอนนี้ ค่าเสื่อมสะสมจะไม่ตรงกับใบสำคัญ */
  const prev = input.code ? assetFind(input.code) : null;
  if (prev && DB.docs.depreciation.some((d) => d.status !== 'void' && (d.rows || []).some((x) => x.code === prev.code))) {
    throw new DomainError('ASSET_ALREADY_DEPRECIATED', 'ทรัพย์สิน ' + prev.code + ' คิดค่าเสื่อมต่อไปแล้ว แก้ยอดยกมาไม่ได้',
      'ยกเลิกงวดค่าเสื่อมที่คิดต่อจากยอดยกมาก่อน ถ้าต้องแก้ยอดยกมา');
  }
  const r = saveAsset({ code: input.code || null, name: input.name, class: input.class, inService: input.inService,
    cost: input.cost, bookYears: input.bookYears, accumBook: input.accumBook || '0', accumTax: input.accumTax || '0',
    account: input.account || null, accumAccount: input.accumAccount || null, note: input.note || '' });
  r.asset.opening = true;
  r.asset.openingAsOf = asOf;
  r.asset.depThrough = throughOfAsOf(asOf);
  audit('asset', r.asset.code, 'register_opening', null, { asOf, accum: fmt(r.asset.accumBook) },
    'ลงทะเบียนยอดยกมา ไม่ลงบัญชี');
  return r;
}

/** เอกสารที่ใช้ลงทะเบียนทรัพย์สินตัวนี้ยังใช้งานอยู่หรือไม่ (ไม่ได้ลงทะเบียนจากเอกสาร = ถือว่าใช้งาน) */
function assetSourceLive(a) {
  const s = a.source;
  if (!s) return true;
  if (s.kind === 'entry') { const e = DB.entries.find((x) => x.no === s.no); return !!e && e.status === 'posted'; }
  const d = (DB.docs[s.kind] || []).find((x) => x.no === s.no);
  return !!d && d.status !== 'void';
}
/** ลบทรัพย์สินที่ลงทะเบียนผิด — ได้เฉพาะตัวที่ยังไม่เคยคิดค่าเสื่อมและไม่มีเอกสารจำหน่าย
    ทะเบียนไม่ได้ลงบัญชี การลบจึงไม่แตะบัญชีแยกประเภท แต่บันทึกไว้ในร่องรอยการตรวจสอบ */
function deleteAsset(code, reason) {
  const a = assetFind(code);
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การลบทรัพย์สินออกจากทะเบียนต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  }
  if (DB.docs.depreciation.some((r) => r.status !== 'void' && (r.rows || []).some((x) => x.code === code))) {
    throw new DomainError('ASSET_ALREADY_DEPRECIATED', 'ทรัพย์สิน ' + code + ' คิดค่าเสื่อมไปแล้ว ลบออกจากทะเบียนไม่ได้',
      'ถ้าลงทะเบียนผิด ให้ยกเลิกงวดค่าเสื่อมที่เกี่ยวข้องก่อน หรือบันทึกตัดจำหน่ายถ้าทรัพย์สินไม่มีอยู่แล้ว');
  }
  if (DB.docs.assetDisposal.some((d) => d.assetCode === code)) {
    throw new DomainError('ASSET_HAS_DISPOSAL', 'ทรัพย์สิน ' + code + ' มีเอกสารขาย/ตัดจำหน่ายอ้างถึง ลบออกจากทะเบียนไม่ได้');
  }
  DB.assets.splice(DB.assets.indexOf(a), 1);
  audit('asset', code, 'delete', { name: a.name, cost: fmt(a.cost) }, null, String(reason).trim());
  return a;
}
/** ทรัพย์สินนี้อยู่ในบัญชี ณ วันที่ asOf หรือไม่ — ได้มาแล้วและยังไม่จำหน่าย */
function assetHeldAt(a, asOf) {
  const acq = a.source && a.source.date ? a.source.date : a.inService;
  if (acq > asOf) return false;
  if (a.status === 'disposed' && !a.disposalNo) return false;   // ทะเบียนรุ่นก่อนที่ตั้งสถานะเองโดยไม่มีเอกสาร
  if (a.disposalNo) {
    const d = DB.docs.assetDisposal.find((x) => x.no === a.disposalNo && x.status !== 'void');
    if (d && d.date <= asOf) return false;
  }
  return true;
}
/** ค่าเสื่อมสะสมตามทะเบียน ณ วันที่ asOf — หักค่าเสื่อมงวดหลังจากนั้นออก */
function registerAccumAt(a, asOf) {
  const period = periodOf(asOf);
  let v = a.accumBook;
  DB.docs.depreciation.forEach(function (r) {
    if (r.status === 'void' || r.period <= period) return;
    (r.rows || []).forEach((x) => { if (x.code === a.code) v -= x.book; });
  });
  if (a.disposalNo) {
    const d = DB.docs.assetDisposal.find((x) => x.no === a.disposalNo && x.status !== 'void');
    if (d && d.date > asOf) v -= d.dep.book;
  }
  return v;
}
/** เทียบทะเบียนกับบัญชีแยกประเภทรายบัญชี: ราคาทุน และค่าเสื่อมสะสม ณ วันที่ asOf */
function assetRegisterVsGl(asOf) {
  const rows = {};
  const row = (code, kind) => (rows[code] = rows[code] || { acc: code, kind, register: 0, count: 0, pending: 0, pendingCount: 0,
    legacy: 0, legacyCount: 0 });
  DB.assets.forEach(function (a) {
    /* ตั้งสถานะจำหน่ายเองในระบบรุ่นก่อนโดยไม่ได้ลงบัญชี — ราคาทุนยังค้างอยู่ในบัญชี ต้องชี้ให้เห็น */
    if (a.status === 'disposed' && !a.disposalNo) {
      const c = assetGl(a, false).cost;
      if (c) { const r = row(c, 'cost'); r.legacy += a.cost; r.legacyCount += 1; }
      return;
    }
    if (!assetHeldAt(a, asOf)) return;
    const gl = assetGl(a, false);
    if (gl.cost) {
      const r = row(gl.cost, 'cost'); r.register += a.cost; r.count += 1;
      if (!assetSourceLive(a)) { r.orphan = (r.orphan || 0) + a.cost; r.orphanCount = (r.orphanCount || 0) + 1; }
    }
    if (a.class !== 'LAND' && gl.accum) { const r = row(gl.accum, 'accum'); r.register += registerAccumAt(a, asOf); r.count += 1; }
  });
  DB.accounts.forEach(function (x) {
    if (!x.postable || rows[x.code]) return;
    const kind = ASSET_COST_SUBS.indexOf(x.subType) >= 0 ? 'cost' : ASSET_ACCUM_SUBS.indexOf(x.subType) >= 0 ? 'accum'
      : x.subType === 'cip' ? 'cip' : null;
    if (kind && balanceOf(x.code, asOf) !== 0) row(x.code, kind);
  });
  ppeSourceLines().forEach(function (s) {
    if (s.assetCode || s.date > asOf || !rows[s.acc]) return;
    rows[s.acc].pending += s.amount; rows[s.acc].pendingCount += 1;
  });
  const out = Object.keys(rows).sort().map(function (code) {
    const r = rows[code];
    const bal = balanceOf(code, asOf);
    const gl = r.kind === 'accum' ? -bal : bal;
    const diff = gl - r.register;
    let why = '';
    if (r.kind === 'cip') why = 'งานระหว่างก่อสร้างยังไม่คิดค่าเสื่อม — ลงทะเบียนเมื่อโอนเป็นทรัพย์สินที่พร้อมใช้';
    else if (diff > 0 && r.kind === 'cost') {
      const parts = [];
      if (r.pending) parts.push('มีรายการซื้อที่ลงบัญชีนี้แต่ยังไม่ลงทะเบียน ' + r.pendingCount + ' รายการ ' + fmt(r.pending) + ' บาท');
      if (r.legacy) parts.push('ทรัพย์สิน ' + r.legacyCount + ' รายการ (' + fmt(r.legacy) + ' บาท) ถูกตั้งสถานะจำหน่ายโดยไม่ได้ลงบัญชี — กดขาย/ตัดจำหน่ายเพื่อบันทึกตามจริง');
      const rest = diff - r.pending - r.legacy;
      if (rest > 0) parts.push((parts.length ? 'ส่วนที่เหลือ ' : '') + fmt(rest)
        + ' บาท มักเป็นยอดยกมาที่ยังไม่ได้ลงทะเบียนรายตัว (ลงทะเบียนยอดยกมา) หรือใบสำคัญที่ลงบัญชีนี้โดยไม่มีทรัพย์สินในทะเบียน');
      why = parts.join(' · ');
    } else if (diff < 0 && r.kind === 'cost') {
      why = (r.orphan ? 'เอกสารซื้อของทรัพย์สิน ' + r.orphanCount + ' รายการ (' + fmt(r.orphan) + ' บาท) ถูกยกเลิกไปแล้ว — ถ้าไม่ได้ซื้อจริงให้ลบออกจากทะเบียน · ' : '')
        + 'ทะเบียนมีทรัพย์สินที่ไม่ได้บันทึกบัญชี เช่นเพิ่มด้วยมือโดยไม่มีรายการซื้อ หรือเลือกบัญชีในทะเบียนไม่ตรงกับที่ลงบัญชีจริง';
    } else if (diff > 0) {
      why = 'บัญชีมีค่าเสื่อมสะสมมากกว่าทะเบียน — มักเป็นค่าเสื่อมที่บันทึกด้วยใบสำคัญทั่วไป หรือค่าเสื่อมสะสมยกมาของทรัพย์สินที่ยังไม่ได้ลงทะเบียน';
    } else if (diff < 0) {
      why = 'ทะเบียนมีค่าเสื่อมสะสมมากกว่าบัญชี — ตรวจค่าเสื่อมสะสมยกมาที่กรอกตอนลงทะเบียน ว่าตรงกับยอดในงบทดลองวันยกยอด';
    }
    return { acc: code, name: acc(code).name, kind: r.kind, register: r.register, gl, diff, count: r.count,
      pending: r.pending, pendingCount: r.pendingCount, legacy: r.legacy, why };
  });
  return { rows: out, ok: out.every((r) => r.kind === 'cip' || r.diff === 0) };
}

/* ===================================================================
   โครงการ — ผูกใบกำกับ ตั้งหนี้ และค่าใช้จ่ายเข้าโครงการ แล้วดูรายได้ ต้นทุน กำไรจริง
   เอกสารเก็บรหัสโครงการไว้ในช่อง project ของตัวเอง (ใบลด/เพิ่มหนี้ตามใบกำกับที่อ้างถึง)
   หน้าจอสร้างเอกสารเรียก setDocProject() ได้ทันทีหลังออกเอกสาร เพื่อผูกตั้งแต่ตอนสร้าง
   =================================================================== */
const PROJECT_DOC_KINDS = { invoice: 'ใบกำกับภาษี', bill: 'รายการตั้งหนี้', expense: 'ค่าใช้จ่าย' };

function projectFind(code) {
  const p = DB.projects.find((x) => x.code === code);
  if (!p) throw new DomainError('PROJECT_NOT_FOUND', 'ไม่พบโครงการรหัส ' + (code || '—'));
  return p;
}
function saveProject(input) {
  const name = String(input.name || '').trim();
  if (!name) throw new DomainError('PROJECT_NAME_REQUIRED', 'ต้องกรอกชื่อโครงการ');
  /* code = แก้โครงการเดิม · newCode = รหัสที่ผู้ใช้ตั้งเองตอนสร้าง (ว่างไว้ระบบตั้งให้) */
  const existing = input.code ? projectFind(input.code) : null;
  let code = existing ? existing.code : String(input.newCode || '').trim();
  if (!existing) {
    if (!code) code = nextRegCode('PJ', DB.projects);
    if (!/^[A-Za-z0-9ก-๙._\-/]{2,30}$/.test(code)) {
      throw new DomainError('PROJECT_CODE_INVALID', 'รหัสโครงการใช้ได้เฉพาะตัวอักษร ตัวเลข จุด ขีด และทับ 2–30 ตัว');
    }
    if (DB.projects.some((x) => x.code === code)) throw new DomainError('PROJECT_CODE_DUPLICATE', 'มีโครงการรหัส ' + code + ' อยู่แล้ว');
  }
  const customer = String(input.customer || '').trim() || null;
  if (customer) {
    const c = partnerByCode(customer);
    if (c.kind !== 'customer') throw new DomainError('PARTNER_WRONG_SIDE', c.name + ' อยู่ในทะเบียนผู้ขาย ไม่ใช่ลูกค้า');
  }
  const contract = M(String(input.contract || '0'));
  const budget = M(String(input.budget || '0'));
  if (contract < 0 || budget < 0) throw new DomainError('PROJECT_AMOUNT_NEGATIVE', 'มูลค่าสัญญาและงบต้นทุนติดลบไม่ได้');
  const start = String(input.start || '').trim() || null;
  const end = String(input.end || '').trim() || null;
  if (start && end && end < start) throw new DomainError('PROJECT_DATES', 'วันสิ้นสุดอยู่ก่อนวันเริ่มโครงการ');
  const percent = input.percent === '' || input.percent === undefined || input.percent === null ? null : Number(input.percent);
  if (percent !== null && !(percent >= 0 && percent <= 100)) {
    throw new DomainError('PROJECT_PERCENT_RANGE', 'ความคืบหน้าต้องอยู่ระหว่าง 0 ถึง 100 เปอร์เซ็นต์');
  }
  const rec = { code, name, customer, contract, budget, start, end, percent,
    note: String(input.note || '').trim(), status: existing ? existing.status || 'active' : 'active' };
  if (existing) {
    Object.keys(rec).forEach((k) => { existing[k] = rec[k]; });
    audit('project', code, 'update', null, { name, budget: fmt(budget) });
    return { project: existing, created: false };
  }
  DB.projects.push(rec);
  audit('project', code, 'create', null, { name, contract: fmt(contract), budget: fmt(budget) });
  return { project: rec, created: true };
}
function setProjectStatus(code, status, reason) {
  const p = projectFind(code);
  if (status !== 'active' && status !== 'closed') throw new DomainError('PROJECT_STATUS_INVALID', 'สถานะโครงการไม่ถูกต้อง');
  const before = p.status || 'active';
  p.status = status;
  if (status === 'closed') p.closedAt = new Date().toISOString().slice(0, 10);
  audit('project', code, status === 'closed' ? 'close' : 'reopen', { status: before }, { status }, reason || null);
  return p;
}
/** ผูกเอกสารเข้าโครงการ (projectCode ว่าง = ถอดออก) — ไม่แตะบัญชีแยกประเภท จึงทำได้แม้งวดปิดแล้ว */
function setDocProject(kind, no, projectCode) {
  if (!PROJECT_DOC_KINDS[kind]) throw new DomainError('PROJECT_DOC_KIND', 'ผูกเอกสารประเภทนี้เข้าโครงการไม่ได้');
  const d = (DB.docs[kind] || []).find((x) => x.no === no);
  if (!d) throw new DomainError('DOC_NOT_FOUND', 'ไม่พบ' + PROJECT_DOC_KINDS[kind] + ' ' + no);
  const code = String(projectCode || '').trim() || null;
  if (code) {
    const p = projectFind(code);
    if (p.status === 'closed') {
      throw new DomainError('PROJECT_CLOSED', 'โครงการ ' + p.code + ' ปิดไปแล้ว ผูกเอกสารเพิ่มไม่ได้', 'เปิดโครงการใหม่ก่อน ถ้ายังมีรายการตามมา');
    }
  }
  const before = d.project || null;
  if (code) d.project = code; else delete d.project;
  audit(kind, no, 'project', { project: before }, { project: code });
  return d;
}
/** รายได้และต้นทุนจริงของโครงการ จากเอกสารที่ผูกไว้ (ไม่นับเอกสารที่ยกเลิก)
    รายได้ = มูลค่าก่อนภาษีของใบกำกับ + ใบเพิ่มหนี้ − ใบลดหนี้ที่อ้างใบกำกับนั้น
    ต้นทุน = ต้นทุนขายของสินค้าในใบกำกับ + ตั้งหนี้ + ค่าใช้จ่าย (ก่อนภาษี บวกภาษีซื้อต้องห้าม) */
function projectActuals(code, asOf) {
  const live = (d) => d.status !== 'void' && d.status !== 'draft' && (!asOf || d.date <= asOf);
  const invs = DB.docs.invoice.filter((d) => d.project === code && live(d));
  const invNos = new Set(invs.map((d) => d.no));
  const cns = DB.docs.creditNote.filter((d) => invNos.has(d.invoiceNo) && live(d));
  const dns = DB.docs.debitNote.filter((d) => invNos.has(d.invoiceNo) && live(d));
  const bills = DB.docs.bill.filter((d) => d.project === code && live(d));
  const exps = DB.docs.expense.filter((d) => d.project === code && live(d));
  const cogsOf = (inv) => {
    const e = inv.cogsEntryNo ? DB.entries.find((x) => x.no === inv.cogsEntryNo) : null;
    return e ? e.total : 0;
  };
  const revenue = invs.reduce((s, d) => s + d.base, 0) + dns.reduce((s, d) => s + (d.base || 0), 0)
    - cns.reduce((s, d) => s + (d.base || 0), 0);
  const cogs = invs.reduce((s, d) => s + cogsOf(d), 0);
  const billCost = bills.reduce((s, d) => s + d.base + (d.claimable === false ? d.vat : 0), 0);
  const expCost = exps.reduce((s, d) => s + d.base + (d.claimable === false ? d.vat : 0), 0);
  const cost = cogs + billCost + expCost;
  return { revenue, cost, margin: revenue - cost, cogs, billCost, expCost, invoices: invs, creditNotes: cns, debitNotes: dns,
    bills, expenses: exps };
}

/* ===================================================================
   งบประมาณ — รายบัญชีรายได้/ค่าใช้จ่าย รายเดือน
   เก็บ {account, period, amount} · ข้อมูลรุ่นก่อน {account, name, monthly} ถือเป็นงบเท่ากันทุกเดือน
   งบประมาณไม่ใช่บัญชี จึงแก้ได้แม้งวดปิดแล้ว
   =================================================================== */
/** 12 งวดของปีบัญชีที่มีงวดนี้ — ปีบัญชีเริ่มเดือนเดียวกับงวดแรกของสมุดบัญชี */
function budgetYearPeriods(period) {
  const start = booksStartPeriod() || period.slice(0, 4) + '-01';
  const k = Math.floor((periodSpan(start, period) - 1) / 12);
  const first = periodAdd(start, k * 12);
  const out = [];
  for (let i = 0; i < 12; i++) out.push(periodAdd(first, i));
  return out;
}
const budgetAccounts = () => DB.accounts.filter((a) => a.postable && (a.type === 'revenue' || a.type === 'expense'));
/** ตัวอ่านงบประมาณ (บัญชี, งวด) → ยอด — สร้างดัชนีครั้งเดียวแล้วอ่านซ้ำได้เร็ว
    งวดที่มีแถวรายเดือนใช้แถวนั้น (แม้เป็นศูนย์) ไม่งั้นใช้งบรุ่นก่อนที่เท่ากันทุกเดือน */
function budgetIndex() {
  const exp = {}, legacy = {};
  DB.budget.forEach(function (b) {
    if (b.period) exp[b.account + '|' + b.period] = (exp[b.account + '|' + b.period] || 0) + (b.amount || 0);
    else if (b.monthly) legacy[b.account] = (legacy[b.account] || 0) + b.monthly;
  });
  return (account, period) => {
    const k = account + '|' + period;
    return k in exp ? exp[k] : (legacy[account] || 0);
  };
}
const budgetAmount = (account, period) => budgetIndex()(account, period);
/** แบ่งงบทั้งปีเท่ากัน 12 เดือน ปัดลงเป็นสตางค์ เดือนสุดท้ายรับเศษ — รวมแล้วเท่างบทั้งปีพอดี */
function budgetSpread(total) {
  const each = Math.floor(total / 1200) * 100;
  const out = [];
  for (let i = 0; i < 11; i++) out.push(each);
  out.push(total - each * 11);
  return out;
}
function saveBudget(input) {
  const a = budgetAccounts().find((x) => x.code === input.account);
  if (!a) {
    throw new DomainError('BUDGET_ACCOUNT_INVALID', 'ตั้งงบประมาณได้เฉพาะบัญชีรายได้และค่าใช้จ่ายที่ลงรายการได้',
      'เลือกบัญชีย่อยในหมวด 4 หรือ 5');
  }
  if (!/^\d{4}-\d{2}$/.test(String(input.period || ''))) {
    throw new DomainError('BUDGET_PERIOD_REQUIRED', 'ต้องระบุงวดในปีบัญชีที่จะตั้งงบประมาณ');
  }
  const periods = budgetYearPeriods(input.period);
  const months = (input.months || []).map((v) => M(String(v === undefined || v === null ? '' : v)));
  while (months.length < 12) months.push(0);
  if (months.some((v) => v < 0)) throw new DomainError('BUDGET_NEGATIVE', 'งบประมาณรายเดือนติดลบไม่ได้');
  /* งบรุ่นก่อนเป็นยอดเท่ากันทุกเดือนแบบไม่มีปี — แตกเป็นรายเดือนของปีอื่นที่มีอยู่ก่อน จะได้ไม่หายไปพร้อมกัน */
  const legacy = DB.budget.filter((b) => b.account === a.code && !b.period && b.monthly);
  if (legacy.length) {
    DB.periods.forEach(function (p) {
      if (periods.indexOf(p.code) >= 0) return;
      if (DB.budget.some((b) => b.account === a.code && b.period === p.code)) return;
      const v = legacy.reduce((s, b) => s + b.monthly, 0);
      if (v) DB.budget.push({ account: a.code, period: p.code, amount: v });
    });
  }
  DB.budget = DB.budget.filter((b) => !(b.account === a.code && (!b.period || periods.indexOf(b.period) >= 0)));
  periods.forEach(function (p, i) { if (months[i]) DB.budget.push({ account: a.code, period: p, amount: months[i] }); });
  const total = months.reduce((s, v) => s + v, 0);
  audit('budget', a.code, 'set', null, { year: periods[0] + '…' + periods[11], total: fmt(total) });
  return { account: a.code, periods, months, total };
}
/** เปอร์เซ็นต์ทศนิยมหนึ่งตำแหน่งสำหรับแสดงผล (ไม่ใช่จำนวนเงิน) */
const pct1 = (num, den) => (den ? (Math.round(num * 1000 / den) / 10).toFixed(1) : null);
/** งบเทียบใช้จริง ของเดือน period และสะสมตั้งแต่ต้นปีบัญชี
    ผลต่างเป็นบวก = ดี (รายได้เกินงบ หรือค่าใช้จ่ายต่ำกว่างบ) · บัญชีที่ใช้จริงแต่ไม่มีงบก็แสดงด้วย */
function budgetVsActual(period) {
  const yp = budgetYearPeriods(period);
  const ytd = yp.slice(0, yp.indexOf(period) + 1);
  const from = period + '-01', to = endOfMonth(from);
  const yFrom = ytd[0] + '-01';
  const amt = budgetIndex();
  /* ยอดใช้จริงอ่านบัญชีแยกประเภทรอบเดียว — ไม่นับใบยอดยกมา (ยอดสะสมก่อนเริ่มใช้ระบบ)
     และใบปิดบัญชีสิ้นปี (ล้างรายได้ค่าใช้จ่ายเป็นศูนย์) */
  const mon = {}, cum = {};
  DB.entries.forEach(function (e) {
    if (!LIVE(e) || e.date < yFrom || e.date > to || e.type === 'closing' || isOpeningEntry(e)) return;
    e.lines.forEach(function (l) {
      const v = l.dr - l.cr;
      cum[l.acc] = (cum[l.acc] || 0) + v;
      if (e.date >= from) mon[l.acc] = (mon[l.acc] || 0) + v;
    });
  });
  const rows = [];
  budgetAccounts().forEach(function (a) {
    const budget = amt(a.code, period);
    const ytdBudget = ytd.reduce((s, p) => s + amt(a.code, p), 0);
    const annual = yp.reduce((s, p) => s + amt(a.code, p), 0);
    const side = a.type === 'revenue' ? -1 : 1;
    const actual = side * (mon[a.code] || 0);
    const ytdActual = side * (cum[a.code] || 0);
    if (!annual && !actual && !ytdActual) return;
    const sign = a.type === 'revenue' ? 1 : -1;
    rows.push({ account: a.code, name: a.name, type: a.type, budget, actual, variance: sign * (actual - budget),
      pct: pct1(actual, budget), ytdBudget, ytdActual, ytdVariance: sign * (ytdActual - ytdBudget),
      ytdPct: pct1(ytdActual, ytdBudget), annual, budgeted: annual !== 0 });
  });
  const sum = (type, f) => rows.filter((r) => r.type === type).reduce((s, r) => s + r[f], 0);
  const tot = (type) => ({ budget: sum(type, 'budget'), actual: sum(type, 'actual'), ytdBudget: sum(type, 'ytdBudget'),
    ytdActual: sum(type, 'ytdActual'), annual: sum(type, 'annual') });
  const rev = tot('revenue'), exp = tot('expense');
  return { period, year: yp, ytd, rows, revenue: rev, expense: exp,
    net: { budget: rev.budget - exp.budget, actual: rev.actual - exp.actual,
      ytdBudget: rev.ytdBudget - exp.ytdBudget, ytdActual: rev.ytdActual - exp.ytdActual, annual: rev.annual - exp.annual } };
}

/* ===================================================================
   ห่อทุกคำสั่งที่เขียนข้อมูลให้เป็นชุดเดียว (ดู atomically ใน engine.js)
   =================================================================== */
disposeAsset = transactional(disposeAsset);
voidAssetDisposal = transactional(voidAssetDisposal);
collectAssetSale = transactional(collectAssetSale);
voidAssetCollection = transactional(voidAssetCollection);
registerAssetFromDoc = transactional(registerAssetFromDoc);
registerOpeningAsset = transactional(registerOpeningAsset);
deleteAsset = transactional(deleteAsset);
saveProject = transactional(saveProject);
setProjectStatus = transactional(setProjectStatus);
setDocProject = transactional(setDocProject);
saveBudget = transactional(saveBudget);
