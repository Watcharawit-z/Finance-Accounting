/* ===================================================================
   หน้าจอและแบบฟอร์มของทรัพย์สิน โครงการ และงบประมาณ (assets.js)
   ลงทะเบียนหน้าจอ แบบพิมพ์ เมนูสร้างเอกสาร และตัวรับปุ่มของตัวเองตอนโหลด ไม่ต้องแก้ ui-actions.js
   =================================================================== */

/* ---------- ตัวช่วย ---------- */
const faClassLabel = (cls) => (TAX_DEPRECIATION[cls] ? TAX_DEPRECIATION[cls].label : cls);
const faClassOpts = () => Object.keys(TAX_DEPRECIATION).map((k) => [k,
  TAX_DEPRECIATION[k].label + (TAX_DEPRECIATION[k].rate ? ' · ภาษี ' + TAX_DEPRECIATION[k].rate + '%' : '')]);
const faAccName = (code) => { const a = code && DB.accounts.find((x) => x.code === code); return a ? a.code + ' ' + a.name : '—'; };
const faCostAccOpts = () => [['', 'บัญชีหลักตามประเภททรัพย์สิน']].concat(DB.accounts
  .filter((a) => a.postable && ASSET_COST_SUBS.indexOf(a.subType) >= 0).map((a) => [a.code, a.code + ' ' + a.name]));
const faAccumAccs = () => DB.accounts.filter((a) => a.postable && a.subType === 'accum_depreciation');
const faCashOpts = () => payFromAccounts().map((a) => [a.code, a.code + ' ' + a.name]);
/** จำนวนเงินสำหรับเติมในช่องกรอก — ทศนิยม 2 ตำแหน่ง ไม่มีจุลภาค */
const faPlain = (v) => fmt(v).replace(/,/g, '');
/** ค่าที่เก็บไว้แล้วเติมกลับลงช่องแก้ไข — ห้ามปัด ไม่งั้นกดบันทึกเฉย ๆ ตัวเลขก็เปลี่ยน (สตางค์ที่ 3–4 หาย) */
const faExact = (v) => unM(v).replace(/(\.\d\d)00$/, '$1');
const faDepRan = (a) => !!a.disposalNo || DB.docs.depreciation
  .some((d) => d.status !== 'void' && (d.rows || []).some((r) => r.code === a.code));
/** วันที่ของยอดยกมา — วันที่ในใบยอดยกมาล่าสุด หรือวันก่อนเริ่มสมุดบัญชี */
function faOpeningDate() {
  let last = null;
  DB.entries.forEach((e) => { if (e.type === 'opening' && e.status === 'posted' && (!last || e.date > last)) last = e.date; });
  if (last) return last;
  const bs = booksStartPeriod();
  return bs ? addDays(bs + '-01', -1) : pEnd();
}
/** 'มิ.ย. 2569' — งวดแบบย่อสำหรับช่องแคบ */
const faPeriodShort = (p) => TH_M[Number(p.slice(5, 7)) - 1] + ' ' + eraYear(Number(p.slice(0, 4)));
function faAssetStatus(a, idx) {
  if (a.status === 'disposed' && a.disposalNo) {
    const d = DB.docs.assetDisposal.find((x) => x.no === a.disposalNo);
    return { html: '<span class="st late">' + (d && d.kind === 'writeoff' ? 'ตัดจำหน่ายแล้ว' : 'ขายแล้ว') + '</span> <span class="mono dim">'
      + esc(a.disposalNo) + '</span>' };
  }
  if (a.status === 'disposed') return { st: ['wait', 'จำหน่ายแล้ว (ยังไม่ได้ลงบัญชี)'] };
  const thr = a.class === 'LAND' ? null : assetDepThrough(a, idx);
  return { html: '<span class="st paid">ใช้งานอยู่</span>' + (a.opening ? ' <span class="st draft">ยกมา</span>' : '')
    + (!assetSourceLive(a) ? ' <span class="st late" title="เอกสารซื้อที่ใช้ลงทะเบียนถูกยกเลิกแล้ว">เอกสารซื้อถูกยกเลิก</span>' : '')
    + (assetMissingOpeningAccum(a, idx) ? ' <span class="st wait" title="เริ่มใช้ก่อนเริ่มสมุดบัญชีแต่ไม่มีค่าเสื่อมสะสมยกมา">ขาดค่าเสื่อมยกมา</span>' : '')
    + '<div class="dim" style="font-size:12px;margin-top:3px">' + (a.class === 'LAND' ? 'ที่ดินไม่คิดค่าเสื่อม'
      : thr ? 'คิดค่าเสื่อมถึง ' + faPeriodShort(thr) : 'ยังไม่เคยคิดค่าเสื่อม') + '</div>' };
}

/* ===================================================================
   ทะเบียนทรัพย์สิน
   =================================================================== */
LIST_CHIPS.assets = [['all', 'ทั้งหมด'], ['in_use', 'ใช้งานอยู่', (a) => a.status === 'in_use'],
  ['disposed', 'จำหน่ายแล้ว', (a) => a.status === 'disposed'], ['opening', 'ยกมาก่อนเริ่มระบบ', (a) => !!a.opening]];

function scAssetRegister() {
  const asOf = pEnd();
  const base = DB.assets.filter((a) => hit(a.code) || hit(a.name) || hit(a.note || '') || hit(a.disposalNo || ''));
  const rows = base.filter((a) => chipPass('assets', a));
  const live = DB.assets.filter((a) => a.status === 'in_use');
  const sum = (list, f) => list.reduce((s, a) => s + f(a), 0);
  const cost = sum(live, (a) => a.cost), accum = sum(live, (a) => a.accumBook), accumTax = sum(live, (a) => a.accumTax);
  const lastRun = DB.docs.depreciation.filter((d) => d.status !== 'void').map((d) => d.period).sort().pop();
  const cmp = assetRegisterVsGl(asOf);
  const idx = assetDepIndex();
  const sel = STATE.sel && DB.docs.assetDisposal.some((d) => d.no === STATE.sel) ? disposalDetail(STATE.sel) : '';
  return sel + kpi([
    { label: 'ทรัพย์สินที่ใช้งานอยู่', value: live.length + ' รายการ', sub: DB.assets.length - live.length ? 'จำหน่ายแล้ว ' + (DB.assets.length - live.length) + ' รายการ' : '' },
    { label: 'ราคาทุน', value: fmt(cost) },
    { label: 'ค่าเสื่อมราคาสะสม', value: fmt(accum), sub: lastRun ? 'คิดถึงงวด ' + thPeriod(lastRun) : 'ยังไม่เคยตั้งค่าเสื่อม' },
    { label: 'ราคาตามบัญชี', value: fmt(cost - accum) },
    { label: 'ทะเบียนเทียบบัญชี', value: cmp.ok ? 'ตรงกัน' : 'มีผลต่าง', tone: cmp.ok ? 'good' : 'warn', sub: 'ณ ' + thDate(asOf) },
  ]) + card({
    title: 'ทะเบียนทรัพย์สิน', sub: DB.assets.length + ' รายการ · แยกค่าเสื่อมทางบัญชีและทางภาษีคนละชุด',
    actions: btn('asset:new', '+ เพิ่มทรัพย์สิน', 'primary') + btn('fa:fromdoc', 'ลงทะเบียนจากตั้งหนี้')
      + btn('fa:opening', 'ลงทะเบียนยอดยกมา')
      + btn('fa:dispose', 'ขาย/ตัดจำหน่าย', DB.assets.some((a) => a.status === 'in_use' || !a.disposalNo) ? '' : 'disabled'),
    filters: listFilters('assets', 'ค้นหารหัส ชื่อ หรือเลขที่เอกสารจำหน่าย', base),
    body: tbl({
      cols: [{ t: 'รหัส' }, { t: 'ชื่อทรัพย์สิน' }, { t: 'ประเภทตามพระราชกฤษฎีกา 145' }, { t: 'วันเริ่มใช้' },
        { t: 'ราคาทุน', a: 'r' }, { t: 'ค่าเสื่อมสะสม (บัญชี)', a: 'r' }, { t: 'ราคาตามบัญชี', a: 'r' },
        { t: 'ค่าเสื่อมสะสม (ภาษี)', a: 'r' }, { t: 'สถานะ' }],
      rows: rows.map(function (a) {
        const t = TAX_DEPRECIATION[a.class];
        const capped = t.costCap && a.cost > t.costCap;
        const small = (x) => ' <div class="dim" style="font-size:12px;margin-top:2px">' + esc(x) + '</div>';
        return [{ mono: a.code }, { html: esc(a.name) + small('บัญชี ' + (assetGl(a, false).cost || '—')) },
          { html: esc(t.label + (t.rate ? ' ' + t.rate + '%' : '')) + small((a.class === 'LAND' ? 'ไม่คิดค่าเสื่อม' : 'อายุ ' + a.bookYears + ' ปี')
            + (capped ? ' · ภาษีจำกัดต้นทุน 1,000,000' : '')) },
          thDateNum(a.inService), { n: a.cost }, { n: a.accumBook }, { n: a.cost - a.accumBook }, { n: a.accumTax },
          faAssetStatus(a, idx)];
      }),
      rowAttr: (r, i) => {
        const a = rows[i];
        return 'class="row-link' + (a.status === 'disposed' ? ' is-void' : '') + '" data-act="'
          + (a.disposalNo ? 'sel:' + a.disposalNo : 'asset:edit:' + a.code) + '"';
      },
      foot: ['', '', '', 'รวมที่ใช้งานอยู่', { n: cost }, { n: accum }, { n: cost - accum }, { n: accumTax }, ''],
      empty: 'ยังไม่มีทรัพย์สินในทะเบียน — ซื้อผ่านตั้งหนี้แล้วกด "ลงทะเบียนจากตั้งหนี้" · ทรัพย์สินที่มีอยู่ก่อนเริ่มใช้ระบบกด "ลงทะเบียนยอดยกมา"',
      emptyAction: btn('fa:fromdoc', 'ลงทะเบียนจากตั้งหนี้', 'primary') + ' ' + btn('fa:opening', 'ลงทะเบียนยอดยกมา'),
    }),
    foot: 'นโยบายค่าเสื่อม: วิธีเส้นตรง ไม่มีมูลค่าซาก คิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ และคิดถึงเดือนที่ขายหรือตัดจำหน่าย (ใช้งานวันเดียวก็นับทั้งเดือน)'
      + ' · กดที่แถวเพื่อแก้ไข หรือดูเอกสารจำหน่าย · รถยนต์นั่งไม่เกิน 10 คน หักค่าเสื่อมทางภาษีได้จากต้นทุนไม่เกิน 1,000,000 บาท ส่วนที่เกินบวกกลับตอนคำนวณภาษี',
  }) + compareCard(asOf, cmp) + disposalsCard();
}

/** ทะเบียนเทียบบัญชีแยกประเภท — ราคาทุนและค่าเสื่อมสะสมรายบัญชี พร้อมเหตุผลของผลต่าง */
function compareCard(asOf, cmp) {
  const pending = ppeSourceLines().filter((s) => !s.assetCode && s.date <= asOf);
  const kindLabel = { cost: 'ราคาทุน', accum: 'ค่าเสื่อมสะสม', cip: 'งานระหว่างก่อสร้าง' };
  return card({
    title: 'ทะเบียนเทียบบัญชีแยกประเภท', sub: 'ณ ' + thDate(asOf) + (cmp.ok ? ' · ตรงกันทุกบัญชี' : ' · มีผลต่างที่ต้องตรวจ'),
    body: tbl({
      cols: [{ t: 'บัญชี' }, { t: 'ชื่อบัญชี' }, { t: 'เทียบ' }, { t: 'ตามทะเบียน', a: 'r' }, { t: 'ตามบัญชีแยกประเภท', a: 'r' },
        { t: 'ผลต่าง', a: 'r' }, { t: 'สาเหตุที่เป็นไปได้ / สิ่งที่ต้องทำ' }],
      rows: cmp.rows.map((r) => [{ mono: r.acc }, r.name, kindLabel[r.kind] + (r.count ? ' (' + r.count + ' รายการ)' : ''),
        { n: r.register }, { n: r.gl }, { n: r.diff, cls: r.diff === 0 || r.kind === 'cip' ? '' : 'bad' },
        r.diff === 0 && r.kind !== 'cip' ? { st: ['paid', 'ตรงกัน'] } : { dim: r.why }]),
      rowAttr: (r) => 'class="row-link" data-act="drill:' + r[0].mono + '"',
      empty: 'ยังไม่มีทรัพย์สินทั้งในทะเบียนและในบัญชีแยกประเภท',
    })
      + (pending.length ? '<div class="sub-h">รายการซื้อที่ลงบัญชีทรัพย์สินแล้วแต่ยังไม่ได้ลงทะเบียน · ' + pending.length + ' รายการ</div>'
        + tbl({
          cols: [{ t: 'เอกสาร' }, { t: 'วันที่' }, { t: 'คู่ค้า' }, { t: 'รายการ' }, { t: 'บัญชี' }, { t: 'จำนวนเงิน', a: 'r' }, { t: '' }],
          rows: pending.map((s) => [{ mono: s.no }, thDateNum(s.date), s.partnerName || { dim: '—' }, s.desc, { mono: s.acc }, { n: s.amount },
            { html: btn('fa:fromdoc:' + s.key, 'ลงทะเบียน', 'primary') }]),
        }) : ''),
    foot: 'ทะเบียนไม่ลงบัญชีเอง: ราคาทุนเข้าบัญชีจากตั้งหนี้หรือใบสำคัญ ค่าเสื่อมเข้าจากการตั้งค่าเสื่อมและการจำหน่าย — สองฝั่งต้องตรงกันทุกสิ้นงวด'
      + ' · กดที่แถวเพื่อดูบัญชีแยกประเภท',
  });
}

/* ---------- เอกสารขาย/ตัดจำหน่าย ---------- */
function disposalsCard() {
  const list = DB.docs.assetDisposal.filter((d) => hit(d.no) || hit(d.assetName) || hit(d.partnerName || ''));
  if (!DB.docs.assetDisposal.length) return '';
  const live = list.filter((d) => d.status !== 'void');
  return card({
    title: 'ขายและตัดจำหน่ายทรัพย์สิน', sub: countNote(list, 'ฉบับ'),
    body: tbl({
      cols: [{ t: 'เลขที่' }, { t: 'วันที่' }, { t: 'ทรัพย์สิน' }, { t: 'วิธี' }, { t: 'ผู้ซื้อ' }, { t: 'ราคาขาย', a: 'r' },
        { t: 'ภาษีขาย', a: 'r' }, { t: 'ราคาตามบัญชี', a: 'r' }, { t: 'กำไร (ขาดทุน)', a: 'r' }, { t: 'ค้างรับ', a: 'r' }, { t: 'สถานะ' }],
      rows: list.map((d) => [{ mono: d.no }, thDateNum(d.date), d.assetCode + ' ' + d.assetName,
        d.kind === 'sale' ? (d.settle === 'credit' ? 'ขายเงินเชื่อ' : 'ขาย รับเงินทันที') : 'ตัดจำหน่าย',
        d.partnerName || { dim: '—' }, { n: d.proceeds }, { n: d.vat }, { n: d.nbv },
        { n: d.gain, cls: d.gain < 0 ? 'bad' : '' }, { n: assetSaleOutstanding(d) },
        d.status === 'void' ? { st: ['void', 'ยกเลิก'] } : { st: ['paid', 'ลงบัญชีแล้ว'] }]),
      rowAttr: (r, i) => rowCls(list[i]) + ' data-act="sel:' + r[0].mono + '"',
      foot: ['รวม', '', '', '', '', { n: live.reduce((s, d) => s + d.proceeds, 0) }, { n: live.reduce((s, d) => s + d.vat, 0) },
        { n: live.reduce((s, d) => s + d.nbv, 0) }, { n: live.reduce((s, d) => s + d.gain, 0) },
        { n: live.reduce((s, d) => s + assetSaleOutstanding(d), 0) }, ''],
    }),
    foot: 'ขายทรัพย์สินที่ใช้ในกิจการต้องออกใบกำกับภาษีและเสียภาษีขาย (ยกเว้นที่ดินและอาคาร) — ระบบออกเลขที่และเข้ารายงานภาษีขายให้',
  });
}
function disposalDetail(no) {
  const d = DB.docs.assetDisposal.find((x) => x.no === no);
  if (!d) return '';
  const due = assetSaleOutstanding(d);
  const r = (label, v, cls) => '<div' + (cls ? ' class="' + cls + '"' : '') + '><span>' + esc(label) + '</span><b>' + fmt(v) + '</b></div>';
  const cols = d.collections || [];
  return card({
    title: (d.kind === 'sale' ? 'ขายทรัพย์สิน' : 'ตัดจำหน่ายทรัพย์สิน') + ' เลขที่ ' + d.no,
    sub: thDate(d.date) + ' · ' + d.assetCode + ' ' + d.assetName,
    actions: btnI('printdoc:assetDisposal:' + d.no, 'printer', 'พิมพ์') + btn('entry:' + d.entryNo, 'ดูใบสำคัญ')
      + (due > 0 ? btn('fa:collect:' + d.no, 'รับชำระ', 'primary') : '')
      + (d.status !== 'void' ? btn('fa:void:' + d.no, 'ยกเลิกเอกสาร', 'danger') : '') + btn('sel:', 'ปิด'),
    body: voidBanner(d)
      + '<div class="docgrid">'
      + '<div><div class="dim">ทรัพย์สิน</div><b>' + esc(d.assetCode + ' ' + d.assetName) + '</b>'
      + '<div>' + esc(faClassLabel(d.class)) + ' · เริ่มใช้ ' + thDate(d.inService) + '</div>'
      + '<div>บัญชีราคาทุน ' + esc(faAccName(d.account)) + '</div></div>'
      + (d.kind === 'sale'
        ? '<div><div class="dim">ผู้ซื้อ</div><b>' + esc(d.partnerName || '—') + '</b>'
          + (d.snap && d.snap.taxId ? '<div>เลขประจำตัวผู้เสียภาษี ' + esc(d.snap.taxId) + '</div>' : '')
          + (d.snap && d.snap.address ? '<div>' + esc(d.snap.address) + '</div>' : '') + '</div>'
          + '<div><div class="dim">การรับเงิน</div><b>' + (d.settle === 'credit' ? 'ขายเงินเชื่อ' : 'รับเงินทันที') + '</b>'
          + '<div>' + esc(d.settle === 'credit' ? 'ลงบัญชี ' + faAccName(d.recvAccount) + ' · ค้างรับ ' + fmt(due) + ' บาท'
            : 'เข้า ' + faAccName(d.payTo)) + '</div></div>'
        : '<div><div class="dim">เหตุผล</div><b>' + esc(d.note || 'ไม่ได้ระบุ') + '</b></div>')
      + '</div>'
      + '<div class="totals">'
      + r('ราคาทุน', d.cost)
      + r('ค่าเสื่อมสะสมก่อนจำหน่าย', d.accumBefore)
      + (d.dep.months ? r('ค่าเสื่อมเพิ่มถึงเดือนที่จำหน่าย (' + d.dep.months + ' เดือน)', d.dep.book) : '')
      + r('ราคาตามบัญชี ณ วันจำหน่าย', d.nbv, 'gt')
      + (d.kind === 'sale' ? r('ราคาขาย (ก่อนภาษี)', d.proceeds) + r(d.vat ? 'ภาษีขาย ' + d.vatRate + '%' : 'ภาษีขาย (ไม่มี)', d.vat)
        + r('รวมเงินที่ได้รับ', d.total) : '')
      + r(d.gain >= 0 ? 'กำไรจากการจำหน่าย' : 'ขาดทุนจากการจำหน่าย', Math.abs(d.gain), 'gt')
      + '</div>'
      + '<div class="note">ทางภาษี: ราคาตามบัญชีทางภาษี ' + fmt(d.taxNbv) + ' บาท · กำไร (ขาดทุน) ทางภาษี ' + fmt(d.proceeds - d.taxNbv)
      + ' บาท — ใช้ปรับปรุงในแบบ ภ.ง.ด.50 เมื่อต่างจากทางบัญชี</div>'
      + (d.settle === 'credit' ? '<div class="sub-h">การรับชำระ</div>' + tbl({
        cols: [{ t: 'เลขที่' }, { t: 'วันที่' }, { t: 'เข้าบัญชี' }, { t: 'จำนวนเงิน', a: 'r' }, { t: 'สถานะ' }, { t: '' }],
        rows: cols.map((c) => [{ mono: c.no }, thDateNum(c.date), faAccName(c.payTo), { n: c.amount },
          c.status === 'void' ? { st: ['void', 'ยกเลิก'] } : { st: ['paid', 'ลงบัญชีแล้ว'] },
          c.status === 'void' ? '' : { html: btnI('printdoc:assetReceipt:' + c.no, 'printer', 'ใบเสร็จ')
            + btn('fa:voidcol:' + d.no + ':' + c.no, 'ยกเลิก', 'danger') }]),
        empty: 'ยังไม่ได้รับชำระ — ค้างรับ ' + fmt(due) + ' บาท',
        emptyAction: due > 0 ? btn('fa:collect:' + d.no, 'รับชำระ', 'primary') : '',
      }) : ''),
    foot: isVoid(d) ? 'ยกเลิกแล้ว — ใบสำคัญถูกกลับรายการ ณ วันที่เดิม และทรัพย์สินกลับเข้าทะเบียน'
      : 'ใบสำคัญ ' + d.entryNo + (d.depEntryNo ? ' (การจำหน่าย) และ ' + d.depEntryNo + ' (ค่าเสื่อมถึงเดือนที่จำหน่าย)' : '')
        + ' · ถ้าบันทึกผิด กดยกเลิกเอกสาร ระบบกลับรายการ คืนทรัพย์สินเข้าทะเบียน และยกเลิกภาษีขายให้ (ถ้ายังไม่ได้ยื่น ภ.พ.30)',
  });
}

/* ---------- แบบฟอร์มทรัพย์สิน (เพิ่ม/แก้ไข) ---------- */
function modalAssetForm(code) {
  const a = code ? DB.assets.find((x) => x.code === code) : null;
  if (code && !a) return;
  if (a && a.opening && !faDepRan(a)) { modalOpeningAsset(code); return; }
  const locked = a && faDepRan(a);
  const accums = faAccumAccs();
  const lockedField = (name, label, shown, value) => field({ name: name + 'Shown', label, value: shown, readonly: true })
    + '<input type="hidden" name="' + name + '" value="' + esc(value) + '">';
  const legacy = a && a.status === 'disposed' && !a.disposalNo;
  modal({
    title: a ? 'แก้ไขทรัพย์สิน ' + a.code : 'เพิ่มทรัพย์สินถาวร',
    sub: locked ? (a.disposalNo ? 'ทรัพย์สินนี้จำหน่ายไปแล้วตาม ' + a.disposalNo + ' แก้ได้เฉพาะชื่อและหมายเหตุ'
        : 'ทรัพย์สินนี้คิดค่าเสื่อมไปแล้ว แก้ได้เฉพาะชื่อ อายุการใช้งาน บัญชี และหมายเหตุ')
      : 'ค่าเสื่อมทางบัญชีคิดตามอายุที่กรอก ส่วนทางภาษีคิดตามอัตราในพระราชกฤษฎีกา 145',
    body: (a ? '' : '<div class="note">ทรัพย์สินที่ซื้อผ่านตั้งหนี้แล้ว ใช้ <b>ลงทะเบียนจากตั้งหนี้</b> จะได้ราคาทุนและวันที่ตรงกับบัญชี · '
        + 'ทรัพย์สินที่มีอยู่ก่อนเริ่มใช้ระบบ ใช้ <b>ลงทะเบียนยอดยกมา</b> พร้อมค่าเสื่อมสะสม</div>')
      + '<div class="flds">'
      + field({ name: 'name', label: 'ชื่อทรัพย์สิน', wide: true, value: a ? a.name : '' })
      + (locked ? lockedField('class', 'ประเภทตามพระราชกฤษฎีกา 145', faClassLabel(a.class), a.class)
        : field({ name: 'class', label: 'ประเภทตามพระราชกฤษฎีกา 145', type: 'select', wide: true, value: a ? a.class : 'OFFICE', options: faClassOpts() }))
      + field({ name: 'inService', label: 'วันที่เริ่มใช้งาน', type: 'date', value: a ? a.inService : defaultDate(), readonly: !!locked })
      + field({ name: 'cost', label: 'ราคาทุน (ไม่รวมภาษีซื้อที่ขอคืนได้)', value: a ? faExact(a.cost) : '', readonly: !!locked })
      + field({ name: 'bookYears', label: 'อายุการใช้งานทางบัญชี (ปี)', value: a ? String(a.bookYears) : '5',
          hint: 'ที่ดินไม่ต้องกรอก · แก้อายุภายหลังมีผลกับค่าเสื่อมงวดถัดไป' })
      + field({ name: 'account', label: 'บัญชีราคาทุน', type: 'select', value: a ? a.account || '' : '', options: faCostAccOpts() })
      + (accums.length > 1 ? field({ name: 'accumAccount', label: 'บัญชีค่าเสื่อมราคาสะสม', type: 'select',
          value: a ? a.accumAccount || '' : '', options: [['', 'บัญชีหลัก']].concat(accums.map((x) => [x.code, x.code + ' ' + x.name])) }) : '')
      + (legacy ? field({ name: 'status', label: 'สถานะ', type: 'select', value: 'disposed',
          options: [['disposed', 'จำหน่ายแล้ว (ยังไม่ได้ลงบัญชี)'], ['in_use', 'ใช้งานอยู่']],
          hint: 'ตั้งสถานะนี้ไว้ในระบบรุ่นก่อนโดยไม่ได้ลงบัญชี — กด "ขาย/ตัดจำหน่าย" เพื่อบันทึกตามจริง' }) : '')
      + field({ name: 'note', label: 'หมายเหตุ (สถานที่ ผู้รับผิดชอบ เลขทะเบียน ฯลฯ)', wide: true, value: a ? a.note || '' : '' })
      + '</div>'
      + (a ? '<div class="note">ค่าเสื่อมสะสมทางบัญชี ' + fmt(a.accumBook) + ' · ทางภาษี ' + fmt(a.accumTax)
        + (a.class === 'LAND' ? '' : ' · คิดค่าเสื่อมถึง ' + (assetDepThrough(a) ? thPeriod(assetDepThrough(a)) : 'ยังไม่เคยคิด'))
        + (a.source ? ' · ที่มา ' + (a.source.kind === 'bill' ? 'ตั้งหนี้' : a.source.kind === 'expense' ? 'ค่าใช้จ่าย' : 'ใบสำคัญ') + ' ' + esc(a.source.no) : '')
        + '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">'
        + (a.status === 'in_use' || legacy ? btn('fa:dispose:' + a.code, 'ขาย/ตัดจำหน่ายทรัพย์สินนี้') : '')
        /* ลงทะเบียนผิด (ยังไม่เคยคิดค่าเสื่อม ไม่มีเอกสารจำหน่าย) ลบออกได้ — ไม่แตะบัญชี */
        + (!faDepRan(a) && !DB.docs.assetDisposal.some((d) => d.assetCode === a.code) ? btn('fa:delete:' + a.code, 'ลบออกจากทะเบียน', 'danger') : '')
        + '</div>'
        + '</div>' : ''),
    submitLabel: a ? 'บันทึกการแก้ไข' : 'เพิ่มทรัพย์สิน',
    note: a ? 'แก้ทะเบียนไม่ลงบัญชี' : 'เพิ่มทรัพย์สินไม่ลงบัญชี — ราคาทุนต้องเข้าบัญชีจากรายการซื้อ',
    onSubmit: function () {
      submitAction(function () {
        const r = saveAsset({
          code: a ? a.code : null, name: val('name'), class: val('class'), inService: val('inService'), cost: val('cost'),
          bookYears: val('bookYears'), account: val('account'), note: val('note'),
          accumAccount: accums.length > 1 ? val('accumAccount') : undefined,
          status: legacy ? val('status') : undefined,
        });
        toast((r.created ? 'เพิ่ม' : 'แก้ไข') + 'ทรัพย์สิน ' + r.asset.code + ' แล้ว', 'ok', r.asset.name);
        return r;
      });
    },
  });
}

/* ---------- ลงทะเบียนยอดยกมา ---------- */
function modalOpeningAsset(code) {
  const a = code ? DB.assets.find((x) => x.code === code) : null;
  modal({
    title: a ? 'แก้ไขทรัพย์สินยกมา ' + a.code : 'ลงทะเบียนทรัพย์สินยอดยกมา',
    sub: 'ทรัพย์สินที่มีอยู่ก่อนเริ่มใช้ระบบ พร้อมค่าเสื่อมสะสม ณ วันยกยอด — ระบบคิดค่าเสื่อมต่อตั้งแต่เดือนถัดไป',
    body: '<div class="note warn"><b>ไม่ลงบัญชี</b> — ราคาทุนและค่าเสื่อมสะสมของทรัพย์สินเหล่านี้อยู่ในบัญชีแล้วจากยอดยกมาหรือการนำเข้างบทดลอง '
      + 'ถ้าลงบัญชีซ้ำยอดจะเป็นสองเท่า · กรอกยอดให้ตรงกับทะเบียนทรัพย์สินเดิม แล้วดูผลที่ "ทะเบียนเทียบบัญชีแยกประเภท"</div>'
      + '<div class="flds">'
      + field({ name: 'name', label: 'ชื่อทรัพย์สิน', wide: true, value: a ? a.name : '' })
      + field({ name: 'class', label: 'ประเภทตามพระราชกฤษฎีกา 145', type: 'select', value: a ? a.class : 'OFFICE', options: faClassOpts() })
      + field({ name: 'account', label: 'บัญชีราคาทุน', type: 'select', value: a ? a.account || '' : '', options: faCostAccOpts() })
      + field({ name: 'inService', label: 'วันที่เริ่มใช้งาน', type: 'date', value: a ? a.inService : '' })
      + field({ name: 'cost', label: 'ราคาทุน', value: a ? faExact(a.cost) : '' })
      + field({ name: 'bookYears', label: 'อายุการใช้งานทางบัญชี (ปี)', value: a ? String(a.bookYears) : '5' })
      + field({ name: 'asOf', label: 'ค่าเสื่อมสะสม ณ วันที่ (วันยกยอด)', type: 'date', value: a ? a.openingAsOf || faOpeningDate() : faOpeningDate(),
          hint: 'วันเดียวกับวันตัดยอดที่นำเข้างบทดลอง' })
      + field({ name: 'accumBook', label: 'ค่าเสื่อมสะสมทางบัญชี ณ วันยกยอด', value: a ? faExact(a.accumBook) : '0' })
      + field({ name: 'accumTax', label: 'ค่าเสื่อมสะสมทางภาษี ณ วันยกยอด', value: a ? faExact(a.accumTax) : '0' })
      + '<div class="fld-w"><label>&nbsp;</label>' + btn('fa:suggest', 'คำนวณค่าเสื่อมสะสมให้') + '</div>'
      + field({ name: 'note', label: 'หมายเหตุ', wide: true, value: a ? a.note || '' : '' })
      + '</div>',
    submitLabel: a ? 'บันทึกการแก้ไข' : 'ลงทะเบียน (ไม่ลงบัญชี)',
    note: 'คำนวณให้ใช้นโยบายเดียวกับระบบ: เต็มเดือนตั้งแต่เดือนที่เริ่มใช้ถึงเดือนของวันยกยอด',
    onSubmit: function () {
      submitAction(function () {
        const r = registerOpeningAsset({ code: a ? a.code : null, name: val('name'), class: val('class'), account: val('account'),
          inService: val('inService'), cost: val('cost'), bookYears: val('bookYears'), asOf: val('asOf'),
          accumBook: val('accumBook'), accumTax: val('accumTax'), note: val('note') });
        toast('ลงทะเบียนทรัพย์สินยกมา ' + r.asset.code + ' แล้ว', 'ok', 'ไม่ลงบัญชี · คิดค่าเสื่อมต่อจากงวด ' + thPeriod(periodAdd(r.asset.depThrough, 1)));
        return r;
      });
    },
  });
}
function fillSuggestedAccum() {
  const s = suggestOpeningAccum({ class: val('class'), cost: val('cost'), bookYears: val('bookYears'),
    inService: val('inService'), asOf: val('asOf') });
  const set = (n, v) => { const e = document.querySelector('#modal [name="' + n + '"]'); if (e) e.value = v; };
  set('accumBook', faPlain(s.book));
  set('accumTax', faPlain(s.tax));
  toast(s.months ? 'คำนวณจาก ' + s.months + ' เดือน' : 'กรอกประเภท ราคาทุน อายุ วันเริ่มใช้ และวันยกยอดให้ครบก่อน', s.months ? 'ok' : 'err',
    s.months ? 'ทางบัญชี ' + fmt(s.book) + ' · ทางภาษี ' + fmt(s.tax) + ' — ตรวจกับทะเบียนเดิมก่อนบันทึก' : '');
}

/* ---------- ลงทะเบียนจากรายการตั้งหนี้/ค่าใช้จ่าย/ใบสำคัญ ---------- */
function modalFromDoc(key) {
  const lines = ppeSourceLines().filter((s) => !s.assetCode);
  if (!lines.length) {
    toast('ยังไม่มีรายการซื้อที่ลงบัญชีทรัพย์สินและยังไม่ได้ลงทะเบียน', 'err',
      'ตั้งหนี้ผู้ขายโดยเลือกบัญชีทรัพย์สิน (เช่น อาคารและอุปกรณ์) ในบรรทัดรายการ แล้วกลับมาลงทะเบียนที่นี่');
    return;
  }
  const cur = lines.find((s) => s.key === key) || lines[0];
  const accums = faAccumAccs();
  modal({
    title: 'ลงทะเบียนทรัพย์สินจากรายการซื้อ',
    sub: 'ราคาทุน บัญชี และวันที่มาจากเอกสารที่ลงบัญชีแล้ว ทะเบียนจึงตรงกับบัญชีแยกประเภท',
    body: '<div class="flds">'
      + field({ name: 'fdLine', label: 'รายการที่ลงบัญชีทรัพย์สิน', type: 'select', wide: true, value: cur.key,
          options: lines.map((s) => [s.key, s.no + ' · ' + thDateNum(s.date) + ' · ' + s.desc + ' · ' + fmt(s.amount) + ' บาท · บัญชี ' + s.acc]) })
      + '<div class="fld-w wide" id="fdInfo">' + fdInfo(cur) + '</div>'
      + field({ name: 'name', label: 'ชื่อทรัพย์สิน', wide: true, value: cur.desc })
      + field({ name: 'class', label: 'ประเภทตามพระราชกฤษฎีกา 145', type: 'select', value: acc(cur.acc).subType === 'ppe_land' ? 'LAND' : 'OFFICE',
          options: faClassOpts() })
      + field({ name: 'inService', label: 'วันที่เริ่มใช้งาน', type: 'date', value: cur.date, hint: 'ตั้งต้นเป็นวันที่ในเอกสาร แก้ได้ถ้าเริ่มใช้ทีหลัง' })
      + field({ name: 'bookYears', label: 'อายุการใช้งานทางบัญชี (ปี)', value: '5' })
      + (accums.length > 1 ? field({ name: 'accumAccount', label: 'บัญชีค่าเสื่อมราคาสะสม', type: 'select', value: '',
          options: [['', 'บัญชีหลัก']].concat(accums.map((x) => [x.code, x.code + ' ' + x.name])) }) : '')
      + field({ name: 'note', label: 'หมายเหตุ', wide: true, value: '' })
      + '</div>',
    submitLabel: 'ลงทะเบียน',
    note: 'ไม่ลงบัญชีซ้ำ — รายการซื้อลงบัญชีไปแล้ว',
    onSubmit: function () {
      submitAction(function () {
        const k = val('fdLine').split('|');
        const r = registerAssetFromDoc({ kind: k[0], no: k[1], line: Number(k[2]), name: val('name'), class: val('class'),
          inService: val('inService'), bookYears: val('bookYears'), accumAccount: accums.length > 1 ? val('accumAccount') : null,
          note: val('note') });
        toast('ลงทะเบียน ' + r.asset.code + ' แล้ว', 'ok', r.asset.name + ' ราคาทุน ' + fmt(r.asset.cost) + ' บาท');
        return r;
      });
    },
  });
}
function fdInfo(s) {
  return '<div class="note" style="margin:0">ราคาทุน <b>' + fmt(s.amount) + '</b> บาท · บัญชี ' + esc(faAccName(s.acc))
    + ' · ' + esc((s.kind === 'bill' ? 'ตั้งหนี้ ' : s.kind === 'expense' ? 'ค่าใช้จ่าย ' : 'ใบสำคัญ ') + s.no)
    + (s.partnerName ? ' · ' + esc(s.partnerName) : '') + (s.ref ? ' · อ้างอิง ' + esc(s.ref) : '') + '</div>';
}

/* ---------- ขาย/ตัดจำหน่าย ---------- */
function disposalInput() {
  return { assetCode: val('faAsset'), kind: val('faKind'), date: val('faDate'), proceeds: val('faProceeds'),
    settle: val('faSettle'), payTo: val('faPayTo'), partnerCode: val('faPartner'), buyerName: val('faBuyerName'),
    buyerTaxId: val('faBuyerTaxId'), buyerAddress: val('faBuyerAddress'), note: val('faNote') };
}
function modalDispose(code) {
  const list = DB.assets.filter((a) => a.status === 'in_use' || (a.status === 'disposed' && !a.disposalNo));
  if (!list.length) { toast('ไม่มีทรัพย์สินที่ยังใช้งานอยู่', 'err'); return; }
  if (!periodIsOpen()) { toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน'); return; }
  const partners = DB.partners.filter((p) => p.active !== false);
  modal({
    title: 'ขายหรือตัดจำหน่ายทรัพย์สิน',
    sub: 'ระบบคิดค่าเสื่อมถึงเดือนที่จำหน่าย ล้างราคาทุนและค่าเสื่อมสะสม ลงกำไรขาดทุนและภาษีขายให้ในครั้งเดียว',
    body: '<div class="flds">'
      + field({ name: 'faAsset', label: 'ทรัพย์สิน', type: 'select', wide: true, value: code || list[0].code,
          options: list.map((a) => [a.code, a.code + ' · ' + a.name + ' · ราคาตามบัญชี ' + fmt(a.cost - a.accumBook)
            + (a.status === 'disposed' ? ' (ตั้งสถานะจำหน่ายไว้โดยยังไม่ลงบัญชี)' : '')]) })
      + field({ name: 'faKind', label: 'วิธีจำหน่าย', type: 'select', value: 'sale',
          options: [['sale', 'ขาย'], ['writeoff', 'ตัดจำหน่าย (ชำรุด ทิ้ง สูญหาย ไม่ได้เงิน)']] })
      + field({ name: 'faDate', label: 'วันที่ขาย/ตัดจำหน่าย', type: 'date', value: defaultDate() })
      + '</div><div class="flds" id="faSaleBox" style="padding-top:0">'
      + field({ name: 'faProceeds', label: 'ราคาขาย (ก่อนภาษีมูลค่าเพิ่ม)', placeholder: '0.00' })
      + field({ name: 'faSettle', label: 'การรับเงิน', type: 'select', value: 'cash',
          options: [['cash', 'รับเงินทันที (เงินสด/โอน)'], ['credit', 'ขายเงินเชื่อ — ตั้งลูกหนี้']] })
      + '<div id="faPayToBox">' + field({ name: 'faPayTo', label: 'รับเงินเข้าบัญชี', type: 'select',
          value: accBySub('bank'), options: faCashOpts() }) + '</div>'
      + field({ name: 'faPartner', label: 'ผู้ซื้อ', type: 'select', value: '',
          options: [['', '— ไม่อยู่ในทะเบียน (กรอกชื่อเอง) —']].concat(partners.map((p) => [p.code, p.code + ' · ' + p.name])) })
      + '</div><div class="flds" id="faBuyerBox" style="padding-top:0">'
      + field({ name: 'faBuyerName', label: 'ชื่อผู้ซื้อ' })
      + field({ name: 'faBuyerTaxId', label: 'เลขประจำตัวผู้เสียภาษีผู้ซื้อ (ถ้ามี)' })
      + field({ name: 'faBuyerAddress', label: 'ที่อยู่ผู้ซื้อ', wide: true })
      + '</div><div class="flds" style="padding-top:0">'
      + field({ name: 'faNote', label: 'หมายเหตุ / เหตุผล', wide: true, placeholder: 'เช่น เปลี่ยนรถใหม่ · ชำรุดซ่อมไม่คุ้ม' })
      + '</div><div id="faPreview" style="padding:0 18px 12px">' + disposalPreviewHtml() + '</div>',
    submitLabel: 'บันทึกและลงบัญชี',
    note: 'ขายทรัพย์สินที่ใช้ในกิจการต้องเสียภาษีขาย (ยกเว้นที่ดินและอาคาร) — ระบบออกเลขที่ใบกำกับภาษีให้',
    onSubmit: function () {
      submitAction(function () {
        const d = disposeAsset(disposalInput());
        STATE.screen = 'assets'; STATE.sel = d.no;
        toast((d.kind === 'sale' ? 'ขาย' : 'ตัดจำหน่าย') + 'ทรัพย์สิน ' + d.assetCode + ' แล้ว', 'ok',
          d.no + ' · ' + (d.gain >= 0 ? 'กำไร ' : 'ขาดทุน ') + fmt(Math.abs(d.gain)) + ' บาท' + (d.vat ? ' · ภาษีขาย ' + fmt(d.vat) : ''));
        return d;
      });
    },
  });
  disposalToggle();
}
/** ซ่อนช่องที่ไม่เกี่ยว — ตัดจำหน่ายไม่มีผู้ซื้อ ขายเชื่อไม่มีบัญชีรับเงิน ผู้ซื้อในทะเบียนไม่ต้องกรอกชื่อ */
function disposalToggle() {
  const show = (id, on) => { const e = document.getElementById(id); if (e) e.style.display = on ? '' : 'none'; };
  const sale = val('faKind') === 'sale';
  show('faSaleBox', sale);
  show('faBuyerBox', sale && !val('faPartner'));
  show('faPayToBox', sale && val('faSettle') === 'cash');
}
function disposalPreviewHtml() {
  let pv;
  try { pv = disposalPreview(disposalInput()); }
  catch (e) {
    if (!(e instanceof DomainError)) throw e;
    /* ยังกรอกไม่ครบระหว่างพิมพ์ — บอกสิ่งที่ขาดแทนตัวเลข */
    return '<div class="note warn" style="margin:0">' + esc(e.message) + (e.hint ? '<div class="dim">' + esc(e.hint) + '</div>' : '') + '</div>';
  }
  const r = (label, v, cls) => '<div' + (cls ? ' class="' + cls + '"' : '') + '><span>' + esc(label) + '</span><b>' + fmt(v) + '</b></div>';
  const why = pv.kind !== 'sale' ? '' : IMMOVABLE_CLASSES.indexOf(pv.asset.class) >= 0 ? 'อสังหาริมทรัพย์ไม่อยู่ในระบบภาษีมูลค่าเพิ่ม'
    : 'กิจการไม่ได้จดทะเบียนภาษีมูลค่าเพิ่ม';
  const j = disposalJournal(pv, false);
  const jeRows = (lines) => lines.map((l) => '<tr><td>' + (l.acc ? esc(l.acc + ' ' + acc(l.acc).name)
    : esc(l.label) + ' <span class="dim">(ระบบสร้างบัญชีให้)</span>') + (l.partner ? ' <span class="dim">· ' + esc(l.partner) + '</span>' : '')
    + '</td>' + money(l.dr || 0) + money(l.cr || 0) + '</tr>').join('');
  return pv.warnings.map((w) => '<div class="note warn" style="margin:0 0 8px">' + esc(w) + '</div>').join('')
    + '<div class="totals" style="width:100%;padding:8px 0">'
    + r('ราคาทุน', pv.asset.cost)
    + r('ค่าเสื่อมสะสมในทะเบียน', pv.accumBefore)
    + (pv.dep.months ? r('ค่าเสื่อมเพิ่ม ' + pv.dep.months + ' เดือน (' + thPeriod(pv.dep.from) + ' – ' + thPeriod(pv.period) + ')', pv.dep.book) : '')
    + r('ราคาตามบัญชี ณ วันจำหน่าย', pv.nbv, 'gt')
    + (pv.kind === 'sale' ? r('ราคาขาย (ก่อนภาษี)', pv.proceeds)
      + r(pv.vat ? 'ภาษีขาย ' + pv.rate + '%' : 'ภาษีขาย — ไม่มี (' + why + ')', pv.vat) + r('รวมเงินที่จะได้รับ', pv.total) : '')
    + r(pv.gain >= 0 ? 'กำไรจากการจำหน่าย' : 'ขาดทุนจากการจำหน่าย', Math.abs(pv.gain), 'gt')
    + '</div>'
    + '<div class="scroll"><table><thead><tr><th class="l">บัญชีที่จะลง</th><th class="r">เดบิต</th><th class="r">เครดิต</th></tr></thead><tbody>'
    + (j.dep ? '<tr><td colspan="3" class="dim">ใบที่ 1 · ค่าเสื่อมถึงเดือนที่จำหน่าย</td></tr>' + jeRows(j.dep)
      + '<tr><td colspan="3" class="dim">ใบที่ 2 · ' + (pv.kind === 'sale' ? 'การขาย' : 'การตัดจำหน่าย') + '</td></tr>' : '')
    + jeRows(j.main) + '</tbody></table></div>';
}
function refreshDisposalForm() {
  disposalToggle();
  const el = document.getElementById('faPreview');
  if (el) el.innerHTML = disposalPreviewHtml();
}
function modalDisposalVoid(no) {
  let lines;
  try { lines = disposalVoidPreview(no); }
  catch (e) {
    if (e instanceof DomainError) toast(e.message, 'err', e.hint);
    else { console.error(e); toast('เกิดข้อผิดพลาดที่ไม่คาดคิด', 'err', e.message); }
    return;
  }
  modal({
    title: 'ยกเลิกเอกสาร ' + no,
    sub: 'เลขที่เอกสารยังอยู่และขึ้นว่า "ยกเลิก" — ระบบไม่ลบข้อมูลใด ๆ ทิ้ง',
    body: '<div class="void-prev"><b>ระบบจะทำสิ่งเหล่านี้ให้ในครั้งเดียว ถ้าขั้นใดไม่ผ่านจะไม่มีอะไรเปลี่ยน</b><ul>'
      + lines.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ul></div>'
      + '<div class="flds">' + field({ name: 'reason', label: 'เหตุผลที่ยกเลิก', wide: true,
          placeholder: 'เช่น ผู้ซื้อยกเลิก / บันทึกผิดทรัพย์สิน — อย่างน้อย 5 ตัวอักษร' }) + '</div>',
    submitLabel: 'ยืนยันยกเลิก', submitKind: 'danger',
    onSubmit: function () {
      submitAction(function () {
        const d = voidAssetDisposal(no, val('reason'));
        toast('ยกเลิกเอกสาร ' + no + ' แล้ว', 'ok', 'ทรัพย์สิน ' + d.assetCode + ' กลับเข้าทะเบียน');
        return d;
      });
    },
  });
}
function modalCollect(no) {
  const d = DB.docs.assetDisposal.find((x) => x.no === no);
  if (!d) return;
  if (!periodIsOpen()) { toast('งวด ' + thPeriod(STATE.period) + ' ปิดแล้ว', 'err', 'เลือกงวดที่ยังเปิดอยู่ก่อน'); return; }
  const due = assetSaleOutstanding(d);
  modal({
    title: 'รับชำระค่าขายทรัพย์สิน ' + no, sub: d.partnerName + ' · ค้างรับ ' + fmt(due) + ' บาท',
    body: '<div class="flds">'
      + field({ name: 'date', label: 'วันที่รับเงิน', type: 'date', value: defaultDate() })
      + field({ name: 'amount', label: 'จำนวนเงิน', value: faPlain(due) })
      + field({ name: 'payTo', label: 'รับเข้าบัญชี', type: 'select', value: accBySub('bank'), options: faCashOpts() })
      + '</div>',
    submitLabel: 'รับชำระและลงบัญชี',
    note: 'Dr เงินสด/ธนาคาร · Cr ลูกหนี้จากการขายทรัพย์สิน',
    onSubmit: function () {
      submitAction(function () {
        const c = collectAssetSale(no, { date: val('date'), amount: val('amount'), payTo: val('payTo') });
        toast('รับชำระ ' + fmt(c.amount) + ' บาทแล้ว', 'ok', c.no + ' · ค้างรับอีก ' + fmt(assetSaleOutstanding(d)) + ' บาท');
        return c;
      });
    },
  });
}

/* ===================================================================
   ค่าเสื่อมราคาประจำงวด
   =================================================================== */
function scDepreciation() {
  const run = DB.docs.depreciation.find((d) => d.period === STATE.period && d.status !== 'void');
  const plan = run ? null : depreciationPlan(STATE.period);
  const rowsOf = run ? run.rows : plan;
  const idx = assetDepIndex();
  const missing = DB.assets.filter((a) => a.status === 'in_use' && assetMissingOpeningAccum(a, idx));
  const later = DB.docs.depreciation.filter((d) => d.period > STATE.period && d.status !== 'void').map((d) => d.period).sort().pop();
  const catchUp = rowsOf.filter((r) => (r.months || 1) > 1);
  const sum = (f) => rowsOf.reduce((s, r) => s + (r[f] || 0), 0);
  const history = DB.docs.depreciation.slice().sort((a, b) => (a.period < b.period ? 1 : a.period > b.period ? -1 : 0)).slice(0, 24);
  const canRun = periodIsOpen() && plan && plan.length;
  return card({
    title: 'ค่าเสื่อมราคาประจำงวด', sub: thPeriod(STATE.period) + (run ? ' · ลงบัญชีแล้ว ' + run.entryNo : plan.length ? ' · ยังไม่ได้ตั้ง' : ''),
    actions: run ? btn('entry:' + run.entryNo, 'ดูใบสำคัญ') + btn('voidrun:depreciation:' + run.period, 'ยกเลิกงวดนี้', 'danger')
      : btn('run:deprec', 'ตั้งค่าเสื่อมราคางวดนี้', canRun ? 'primary' : 'disabled'),
    body: voidedRunsNote('depreciation')
      + (missing.length ? '<div class="note warn">ทรัพย์สิน ' + missing.length + ' รายการเริ่มใช้ก่อนเริ่มสมุดบัญชีแต่ไม่มีค่าเสื่อมสะสมยกมา ('
        + missing.slice(0, 4).map((a) => esc(a.code)).join(', ') + (missing.length > 4 ? ' …' : '')
        + ') — ค่าเสื่อมก่อนเริ่มสมุดบัญชีจะขาดไป แก้ด้วยการลงทะเบียนยอดยกมาพร้อมค่าเสื่อมสะสม</div>' : '')
      + (catchUp.length ? '<div class="note">' + (run ? 'งวดนี้รวม' : 'จะรวม') + 'ค่าเสื่อมของเดือนที่ยังไม่ได้คิด ' + catchUp.length
        + ' รายการ (ลงทะเบียนช้าหรือข้ามงวดไป) ไว้ในใบเดียว — ดูคอลัมน์ "คิดตั้งแต่" และ "จำนวนเดือน"</div>' : '')
      + (!run && plan.length ? '<div class="sub-h">รายการที่จะลงบัญชีเมื่อกดตั้งค่าเสื่อม</div>' : '')
      + (rowsOf.length ? tbl({
        cols: [{ t: 'รหัส' }, { t: 'ทรัพย์สิน' }, { t: 'คิดตั้งแต่' }, { t: 'จำนวนเดือน', a: 'r' }, { t: 'ราคาทุน', a: 'r' },
          { t: 'ค่าเสื่อมทางบัญชี', a: 'r' }, { t: 'ค่าเสื่อมทางภาษี', a: 'r' }, { t: 'ผลต่าง', a: 'r' }, { t: 'ราคาตามบัญชีคงเหลือ', a: 'r' }],
        rows: rowsOf.map((r) => [{ mono: r.code }, r.name, r.from ? thPeriod(r.from) : thPeriod(STATE.period), { c: String(r.months || 1) },
          { n: r.cost }, { n: r.book }, { n: r.tax }, { n: r.diff }, { n: r.nbvBook }]),
        foot: ['', '', '', 'รวม', '', { n: sum('book') }, { n: sum('tax') }, { n: sum('diff') }, ''],
      }) : '<div class="empty">' + (later ? 'มีค่าเสื่อมงวด ' + esc(thPeriod(later)) + ' ที่คิดรวมถึงงวดนี้แล้ว'
        : DB.assets.some((a) => a.status === 'in_use' && a.class !== 'LAND') ? 'ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อมในงวดนี้ — คิดครบแล้วหรือยังไม่เริ่มใช้'
        : 'ยังไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อม — ลงทะเบียนทรัพย์สินที่หน้าทะเบียนทรัพย์สินก่อน')
        + '<div style="margin-top:12px">' + btn('go:assets', 'ไปที่ทะเบียนทรัพย์สิน') + '</div></div>')
      + (!run && plan.length ? '<div style="padding:0 16px 14px">' + btn('run:deprec', 'ตั้งค่าเสื่อมราคาเดี๋ยวนี้', canRun ? 'primary' : 'disabled') + '</div>' : ''),
    foot: 'นโยบาย: วิธีเส้นตรง ไม่มีมูลค่าซาก คิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ถึงเดือนที่ขายหรือตัดจำหน่าย · เดือนที่ยังไม่ได้คิดรวมเข้างวดที่กดตั้งค่าเสื่อม'
      + ' · ทางภาษีคิดจำนวนเดือนเดียวกันตามอัตรา พ.ร.ฎ.145'
      + (run && run.diff !== 0 ? ' · ผลต่างบัญชีกับภาษี ' + fmt(run.diff) + ' บาท ต้องนำไปปรับปรุงในแบบ ภ.ง.ด.50 ปลายปี' : ''),
  }) + (history.length ? card({
    title: 'ประวัติการตั้งค่าเสื่อม', sub: history.filter((d) => d.status !== 'void').length + ' งวด',
    body: tbl({
      cols: [{ t: 'งวด' }, { t: 'ใบสำคัญ' }, { t: 'ทรัพย์สิน', a: 'r' }, { t: 'รวมเดือนย้อนหลัง', a: 'r' }, { t: 'ทางบัญชี', a: 'r' },
        { t: 'ทางภาษี', a: 'r' }, { t: 'สถานะ' }],
      rows: history.map((d) => [thPeriod(d.period), { mono: d.entryNo }, { c: String(d.rows.length) },
        { c: String(d.rows.filter((r) => (r.months || 1) > 1).length || '—') }, { n: d.bookTotal }, { n: d.taxTotal },
        d.status === 'void' ? { st: ['void', 'ยกเลิก'] } : { st: ['paid', 'ลงบัญชีแล้ว'] }]),
      rowAttr: (r, i) => rowCls(history[i]) + ' data-act="period:' + history[i].period + '"',
    }),
    foot: 'กดที่แถวเพื่อเปิดงวดนั้น',
  }) : '');
}

/* ===================================================================
   โครงการ
   =================================================================== */
/** ตัวเลือกโครงการสำหรับแบบฟอร์มของระบบอื่น (ใบกำกับ ตั้งหนี้ ค่าใช้จ่าย) — ใส่เป็น field type select
    แล้วหลังออกเอกสารเรียก setDocProject(kind, no, val('project')) เพื่อผูกตั้งแต่ตอนสร้าง */
const optProjects = () => [['', '— ไม่ผูกโครงการ —']].concat(DB.projects
  .filter((p) => (p.status || 'active') === 'active').map((p) => [p.code, p.code + ' · ' + p.name]));
LIST_CHIPS.projects = [['all', 'ทั้งหมด'], ['active', 'กำลังดำเนินการ', (p) => (p.status || 'active') === 'active'],
  ['closed', 'ปิดแล้ว', (p) => p.status === 'closed']];
const projCustomer = (c) => (c ? (DB.partners.find((x) => x.code === c) || {}).name || c : '');
function scProjectList() {
  const base = DB.projects.filter((p) => hit(p.code) || hit(p.name) || hit(projCustomer(p.customer)));
  const rows = base.filter((p) => chipPass('projects', p)).map((p) => ({ p, a: projectActuals(p.code) }));
  const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
  const sel = STATE.sel && DB.projects.some((p) => p.code === STATE.sel) ? projectDetail(STATE.sel) : '';
  return sel + card({
    title: 'โครงการ', sub: DB.projects.length + ' โครงการ · กำลังดำเนินการ ' + DB.projects.filter((p) => (p.status || 'active') === 'active').length,
    actions: btn('proj:new', '+ สร้างโครงการ', 'primary'),
    filters: listFilters('projects', 'ค้นหารหัส ชื่อโครงการ หรือลูกค้า', base),
    body: tbl({
      cols: [{ t: 'รหัส' }, { t: 'ชื่อโครงการ' }, { t: 'ลูกค้า' }, { t: 'ระยะเวลา' }, { t: 'มูลค่าสัญญา', a: 'r' }, { t: 'งบต้นทุน', a: 'r' },
        { t: 'รายได้จริง', a: 'r' }, { t: 'ต้นทุนจริง', a: 'r' }, { t: 'กำไรขั้นต้น', a: 'r' }, { t: 'ใช้งบต้นทุน' }, { t: 'สถานะ' }],
      rows: rows.map(function (r) {
        const used = r.p.budget ? Math.round(r.a.cost * 100 / r.p.budget) : null;
        return [{ mono: r.p.code }, r.p.name, projCustomer(r.p.customer) || { dim: '—' },
          r.p.start || r.p.end ? thDateNum(r.p.start) + ' – ' + thDateNum(r.p.end) : { dim: '—' },
          { n: r.p.contract || 0 }, { n: r.p.budget || 0 }, { n: r.a.revenue }, { n: r.a.cost }, { n: r.a.margin, cls: r.a.margin < 0 ? 'bad' : '' },
          used === null ? { dim: '—' } : { html: '<div class="bar"><i style="width:' + Math.min(100, used) + '%' + (used > 100 ? ';background:var(--neg)' : '')
            + '"></i></div><span class="' + (used > 100 ? 'neg' : 'dim') + '">' + used + '%</span>' },
          r.p.status === 'closed' ? { st: ['draft', 'ปิดแล้ว'] } : { st: ['open', 'กำลังดำเนินการ'] }];
      }),
      rowAttr: (r) => 'class="row-link" data-act="sel:' + r[0].mono + '"',
      foot: ['', '', '', 'รวม', { n: sum((r) => r.p.contract || 0) }, { n: sum((r) => r.p.budget || 0) }, { n: sum((r) => r.a.revenue) },
        { n: sum((r) => r.a.cost) }, { n: sum((r) => r.a.margin) }, '', ''],
      empty: 'ยังไม่มีโครงการ — สร้างโครงการแล้วผูกใบกำกับ ตั้งหนี้ และค่าใช้จ่ายเข้าโครงการ เพื่อดูกำไรรายโครงการ',
      emptyAction: btn('proj:new', 'สร้างโครงการแรก', 'primary'),
    }),
    foot: 'รายได้และต้นทุนจริงมาจากเอกสารที่ผูกเข้าโครงการ: ใบกำกับ (รวมใบลด/เพิ่มหนี้ที่อ้างใบนั้น) ต้นทุนขายของสินค้าในใบกำกับ ตั้งหนี้ และค่าใช้จ่าย — ผูกได้ที่หน้ารายละเอียดโครงการ'
      + ' · ยังผูกเงินเดือนและใบสำคัญทั่วไปเข้าโครงการไม่ได้',
  });
}
function projectDetail(code) {
  const p = DB.projects.find((x) => x.code === code);
  if (!p) return '';
  const a = projectActuals(code);
  const closed = p.status === 'closed';
  const docRows = []
    .concat(a.invoices.map((d) => ['invoice', 'ใบกำกับภาษี', d, d.base, 0]))
    .concat(a.debitNotes.map((d) => [null, 'ใบเพิ่มหนี้ (อ้าง ' + d.invoiceNo + ')', d, d.base || 0, 0]))
    .concat(a.creditNotes.map((d) => [null, 'ใบลดหนี้ (อ้าง ' + d.invoiceNo + ')', d, -(d.base || 0), 0]))
    .concat(a.invoices.filter((d) => d.cogsEntryNo).map((d) => [null, 'ต้นทุนขายสินค้า (' + d.no + ')',
      { no: d.cogsEntryNo, date: d.date, partnerName: d.partnerName }, 0, (DB.entries.find((e) => e.no === d.cogsEntryNo) || {}).total || 0]))
    .concat(a.bills.map((d) => ['bill', 'ตั้งหนี้', d, 0, d.base + (d.claimable === false ? d.vat : 0)]))
    .concat(a.expenses.map((d) => ['expense', 'ค่าใช้จ่าย', d, 0, d.base + (d.claimable === false ? d.vat : 0)]));
  const poc = p.percent !== null && p.percent !== undefined && p.contract ? round2(pct(p.contract, String(p.percent))) : null;
  return card({
    title: 'โครงการ ' + p.code + ' · ' + p.name,
    sub: (projCustomer(p.customer) || 'ไม่ระบุลูกค้า') + (p.start || p.end ? ' · ' + thDate(p.start) + ' – ' + thDate(p.end) : '')
      + (closed ? ' · ปิดแล้ว' : ''),
    actions: btn('proj:tag:' + p.code, 'ผูกเอกสาร', closed ? 'disabled' : 'primary') + btn('proj:edit:' + p.code, 'แก้ไข')
      + (closed ? btn('proj:reopen:' + p.code, 'เปิดโครงการอีกครั้ง') : btn('proj:close:' + p.code, 'ปิดโครงการ'))
      + btn('sel:', 'ปิด'),
    body: kpi([
      { label: 'มูลค่าสัญญา', value: fmt(p.contract || 0) },
      { label: 'รายได้จริง', value: fmt(a.revenue), sub: p.contract ? 'เรียกเก็บแล้ว ' + Math.round(a.revenue * 100 / p.contract) + '% ของสัญญา' : '' },
      { label: 'ต้นทุนจริง', value: fmt(a.cost), sub: p.budget ? 'ใช้งบ ' + Math.round(a.cost * 100 / p.budget) + '% ของ ' + fmt(p.budget) : 'ยังไม่ได้ตั้งงบต้นทุน',
        tone: p.budget && a.cost > p.budget ? 'bad' : '' },
      { label: 'กำไรขั้นต้น', value: fmt(a.margin), tone: a.margin < 0 ? 'bad' : 'good',
        sub: a.revenue ? 'อัตรากำไร ' + (Math.round(a.margin * 1000 / a.revenue) / 10).toFixed(1) + '%' : '' },
    ])
      + (poc !== null ? '<div class="note">ความคืบหน้าที่บันทึกไว้ ' + p.percent + '% → รายได้ตามขั้นความสำเร็จ (ประมาณ) ' + fmt(poc)
        + ' บาท · เรียกเก็บแล้ว ' + fmt(a.revenue) + ' บาท' + (poc > a.revenue ? ' — ยังไม่ได้เรียกเก็บ ' + fmt(poc - a.revenue) + ' บาท' : '') + '</div>' : '')
      + (p.note ? '<div class="note">' + esc(p.note) + '</div>' : '')
      + tbl({
        cols: [{ t: 'เอกสาร' }, { t: 'เลขที่' }, { t: 'วันที่' }, { t: 'คู่ค้า' }, { t: 'รายได้', a: 'r' }, { t: 'ต้นทุน', a: 'r' }, { t: '' }],
        rows: docRows.map((r) => [r[1], { mono: r[2].no }, thDateNum(r[2].date), r[2].partnerName || { dim: '—' }, { n: r[3] }, { n: r[4] },
          r[0] ? { html: btn('proj:untag:' + r[0] + ':' + r[2].no, 'ถอดออก') } : { dim: 'ตามใบกำกับ' }]),
        foot: ['รวม', '', '', '', { n: a.revenue }, { n: a.cost }, ''],
        empty: 'ยังไม่มีเอกสารผูกกับโครงการนี้ — กด "ผูกเอกสาร" เพื่อเลือกใบกำกับ ตั้งหนี้ หรือค่าใช้จ่าย',
      }),
    foot: 'ผูกหรือถอดเอกสารไม่แตะบัญชีแยกประเภท จึงทำได้แม้งวดปิดแล้ว · ยอดก่อนภาษีมูลค่าเพิ่ม (ภาษีซื้อต้องห้ามนับเป็นต้นทุน)',
  });
}
function modalProject(code) {
  const p = code ? DB.projects.find((x) => x.code === code) : null;
  const custs = DB.partners.filter((x) => x.kind === 'customer');
  modal({
    title: p ? 'แก้ไขโครงการ ' + p.code : 'สร้างโครงการ',
    sub: 'งบต้นทุนใช้เทียบกับต้นทุนจริงจากเอกสารที่ผูกเข้าโครงการ',
    body: '<div class="flds">'
      + (p ? '' : field({ name: 'newCode', label: 'รหัสโครงการ', placeholder: 'ว่างไว้ ระบบตั้งให้ (PJ-0001)' }))
      + field({ name: 'name', label: 'ชื่อโครงการ', wide: !p, value: p ? p.name : '' })
      + field({ name: 'customer', label: 'ลูกค้า', type: 'select', value: p ? p.customer || '' : '',
          options: [['', '— ไม่ระบุ —']].concat(custs.map((c) => [c.code, c.code + ' · ' + c.name])) })
      + field({ name: 'contract', label: 'มูลค่าสัญญา (ก่อนภาษี)', value: p ? faExact(p.contract || 0) : '' })
      + field({ name: 'budget', label: 'งบต้นทุน', value: p ? faExact(p.budget || 0) : '' })
      + field({ name: 'start', label: 'วันเริ่ม', type: 'date', value: p ? p.start || '' : '' })
      + field({ name: 'end', label: 'วันสิ้นสุด', type: 'date', value: p ? p.end || '' : '' })
      + field({ name: 'percent', label: 'ความคืบหน้า (%)', value: p && p.percent !== null && p.percent !== undefined ? String(p.percent) : '',
          hint: 'ไม่บังคับ — ใช้ประมาณรายได้ตามขั้นความสำเร็จ' })
      + field({ name: 'note', label: 'หมายเหตุ', wide: true, value: p ? p.note || '' : '' })
      + '</div>',
    submitLabel: p ? 'บันทึกการแก้ไข' : 'สร้างโครงการ',
    onSubmit: function () {
      submitAction(function () {
        const r = saveProject({ code: p ? p.code : null, newCode: p ? null : val('newCode'), name: val('name'), customer: val('customer'),
          contract: val('contract'), budget: val('budget'), start: val('start'), end: val('end'), percent: val('percent'), note: val('note') });
        STATE.screen = 'projects'; STATE.sel = r.project.code;
        toast((r.created ? 'สร้าง' : 'แก้ไข') + 'โครงการ ' + r.project.code + ' แล้ว', 'ok', r.created ? 'กด "ผูกเอกสาร" เพื่อเริ่มเก็บรายได้และต้นทุนจริง' : '');
        return r;
      });
    },
  });
}
/** เลือกเอกสารที่ยังไม่ได้ผูกโครงการไหน — ใบกำกับของลูกค้าโครงการ และตั้งหนี้/ค่าใช้จ่ายในช่วงเวลาโครงการ */
function modalProjectTag(code) {
  const p = DB.projects.find((x) => x.code === code);
  if (!p) return;
  const inRange = (d) => (!p.start || d.date >= p.start) && (!p.end || d.date <= p.end);
  const free = (d) => d.status !== 'void' && d.status !== 'draft' && !d.project && !d.broughtForward;
  const cand = []
    .concat(DB.docs.invoice.filter((d) => free(d) && (!p.customer || d.partnerCode === p.customer) && inRange(d))
      .map((d) => ['invoice', 'ใบกำกับภาษี', d, d.base]))
    .concat(DB.docs.bill.filter((d) => free(d) && inRange(d)).map((d) => ['bill', 'ตั้งหนี้', d, d.base]))
    .concat(DB.docs.expense.filter((d) => free(d) && inRange(d)).map((d) => ['expense', 'ค่าใช้จ่าย', d, d.base]))
    .sort((x, y) => (x[2].date < y[2].date ? 1 : -1)).slice(0, 200);
  if (!cand.length) {
    toast('ไม่มีเอกสารที่ผูกได้', 'err', 'ใบกำกับต้องเป็นของลูกค้าโครงการ และเอกสารต้องอยู่ในช่วงวันที่โครงการ (ถ้าระบุ) และยังไม่ได้ผูกโครงการอื่น');
    return;
  }
  /* ช่องติ๊กไม่ใส่ data-act — ตัวรับคลิกกลางจะกันการติ๊กถ้าแถวมี data-act */
  modal({
    title: 'ผูกเอกสารเข้าโครงการ ' + p.code, sub: p.name + ' · ' + cand.length + ' เอกสารที่ผูกได้',
    body: '<div class="scroll" style="max-height:52vh"><table><thead><tr><th class="c"></th><th class="l">เอกสาร</th><th class="l">เลขที่</th>'
      + '<th class="l">วันที่</th><th class="l">คู่ค้า</th><th class="r">มูลค่าก่อนภาษี</th></tr></thead><tbody>'
      + cand.map((c) => '<tr><td class="ctr"><input type="checkbox" data-tag="' + c[0] + '|' + esc(c[2].no) + '" aria-label="เลือก ' + esc(c[2].no) + '"></td>'
        + '<td>' + esc(c[1]) + '</td><td class="mono">' + esc(c[2].no) + '</td><td>' + thDateNum(c[2].date) + '</td><td>'
        + esc(c[2].partnerName || '') + '</td>' + money(c[3]) + '</tr>').join('')
      + '</tbody></table></div>',
    submitLabel: 'ผูกเอกสารที่เลือก',
    note: 'ไม่แตะบัญชีแยกประเภท',
    onSubmit: function () {
      const picked = Array.from(document.querySelectorAll('#modal input[data-tag]:checked')).map((e) => e.getAttribute('data-tag').split('|'));
      if (!picked.length) { toast('ยังไม่ได้เลือกเอกสาร', 'err'); return; }
      submitAction(function () {
        atomically(() => picked.forEach((x) => setDocProject(x[0], x[1], p.code)));
        STATE.sel = p.code;
        toast('ผูก ' + picked.length + ' เอกสารเข้าโครงการ ' + p.code + ' แล้ว', 'ok');
      });
    },
  });
}

/* ===================================================================
   งบประมาณ
   =================================================================== */
LIST_CHIPS.budget = [['all', 'ทุกบัญชี'], ['budgeted', 'มีงบ', (r) => r.budgeted],
  ['over', 'เกินงบ (สะสม)', (r) => r.budgeted && r.ytdVariance < 0], ['nobudget', 'ใช้จริงแต่ไม่มีงบ', (r) => !r.budgeted]];
function scBudgetReport() {
  const r = budgetVsActual(STATE.period);
  const base = r.rows.filter((x) => hit(x.account) || hit(x.name));
  const rows = base.filter((x) => chipPass('budget', x));
  const pctCell = (v) => (v === null ? { dim: '—' } : { c: v + '%' });
  const line = (x) => [{ mono: x.account }, x.name, { n: x.budget }, { n: x.actual }, { n: x.variance, cls: x.variance < 0 ? 'bad' : 'good' },
    pctCell(x.pct), { n: x.ytdBudget }, { n: x.ytdActual }, { n: x.ytdVariance, cls: x.ytdVariance < 0 ? 'bad' : 'good' }, pctCell(x.ytdPct)];
  const sub = (label, t, sign) => ['', { html: '<b>' + esc(label) + '</b>' }, { n: t.budget }, { n: t.actual },
    { n: sign * (t.actual - t.budget) }, pctCell(pct1(t.actual, t.budget)), { n: t.ytdBudget }, { n: t.ytdActual },
    { n: sign * (t.ytdActual - t.ytdBudget) }, pctCell(pct1(t.ytdActual, t.ytdBudget))];
  const rev = rows.filter((x) => x.type === 'revenue'), exp = rows.filter((x) => x.type === 'expense');
  const all = rev.map(line).concat(rev.length ? [sub('รวมรายได้', r.revenue, 1)] : [])
    .concat(exp.map(line)).concat(exp.length ? [sub('รวมค่าใช้จ่าย', r.expense, -1)] : []);
  const accOf = rev.concat(rev.length ? [null] : []).concat(exp).concat(exp.length ? [null] : []);
  const yp = r.year;
  const amt = budgetIndex();
  const planned = budgetAccounts().filter((a) => yp.some((p) => amt(a.code, p)));
  return card({
    title: 'งบประมาณเทียบใช้จริง',
    sub: thPeriod(STATE.period) + ' และสะสม ' + r.ytd.length + ' เดือนของปีบัญชี ' + thPeriod(yp[0]) + ' – ' + thPeriod(yp[11]),
    actions: btn('bud:edit', '+ ตั้งงบประมาณ', 'primary'),
    filters: listFilters('budget', 'ค้นหารหัสหรือชื่อบัญชี', base),
    body: tbl({
      cols: [{ t: 'รหัส' }, { t: 'บัญชี' }, { t: 'งบเดือนนี้', a: 'r' }, { t: 'ใช้จริงเดือนนี้', a: 'r' }, { t: 'ผลต่าง', a: 'r' }, { t: '% ของงบ', a: 'r' },
        { t: 'งบสะสม', a: 'r' }, { t: 'ใช้จริงสะสม', a: 'r' }, { t: 'ผลต่างสะสม', a: 'r' }, { t: '% สะสม', a: 'r' }],
      rows: all,
      rowAttr: (x, i) => (accOf[i] ? 'class="row-link" data-act="bud:edit:' + accOf[i].account + '"' : ''),
      foot: ['', 'กำไรสุทธิ', { n: r.net.budget }, { n: r.net.actual }, { n: r.net.actual - r.net.budget },
        '', { n: r.net.ytdBudget }, { n: r.net.ytdActual }, { n: r.net.ytdActual - r.net.ytdBudget }, ''],
      empty: 'ยังไม่มีงบประมาณและยังไม่มีรายการรายได้หรือค่าใช้จ่ายในปีนี้ — กด "ตั้งงบประมาณ" เพื่อเริ่ม',
      emptyAction: btn('bud:edit', 'ตั้งงบประมาณบัญชีแรก', 'primary'),
    }),
    foot: 'ผลต่างเป็นบวก = ดี (รายได้เกินงบ หรือค่าใช้จ่ายต่ำกว่างบ) เป็นลบ = ต้องดู · ยอดใช้จริงดึงจากบัญชีแยกประเภทโดยตรง ไม่นับยอดยกมาและรายการปิดบัญชีสิ้นปี'
      + ' · กดที่แถวเพื่อแก้งบของบัญชีนั้น',
  }) + card({
    title: 'แผนงบประมาณทั้งปี', sub: thPeriod(yp[0]) + ' – ' + thPeriod(yp[11]) + ' · ' + planned.length + ' บัญชี',
    actions: btn('bud:edit', 'ตั้งงบประมาณ'),
    body: tbl({
      cols: [{ t: 'รหัส' }, { t: 'บัญชี' }].concat(yp.map((p) => ({ t: TH_M[Number(p.slice(5)) - 1], a: 'r' }))).concat([{ t: 'รวมทั้งปี', a: 'r' }]),
      rows: planned.map((a) => [{ mono: a.code }, a.name].concat(yp.map((p) => ({ n: amt(a.code, p) })))
        .concat([{ n: yp.reduce((s, p) => s + amt(a.code, p), 0) }])),
      rowAttr: (x) => 'class="row-link" data-act="bud:edit:' + x[0].mono + '"',
      empty: 'ยังไม่ได้ตั้งงบประมาณของปีนี้',
    }),
    foot: 'งบประมาณไม่ใช่บัญชี แก้ได้แม้งวดปิดแล้ว · ส่งออกเป็น CSV เปิดใน Excel ได้จากปุ่มมุมขวาบนของแต่ละตาราง',
  });
}
function modalBudget(account) {
  const accs = budgetAccounts();
  const yp = budgetYearPeriods(STATE.period);
  const cur = accs.find((a) => a.code === account) || accs.find((a) => a.type === 'expense') || accs[0];
  if (!cur) { toast('ผังบัญชียังไม่มีบัญชีรายได้หรือค่าใช้จ่าย', 'err'); return; }
  modal({
    title: 'ตั้งงบประมาณ', sub: 'ปีบัญชี ' + thPeriod(yp[0]) + ' – ' + thPeriod(yp[11]) + ' · ใส่ศูนย์ทั้งปีเพื่อลบงบของบัญชีนั้น',
    body: '<div class="flds">'
      + field({ name: 'bdAcc', label: 'บัญชี', type: 'select', wide: true, value: cur.code,
          options: accs.map((a) => [a.code, a.code + ' ' + a.name + (a.type === 'revenue' ? ' (รายได้)' : '')]) })
      + field({ name: 'bdAnnual', label: 'งบทั้งปี', placeholder: 'เช่น 120000' })
      + '<div class="fld-w"><label>&nbsp;</label>' + btn('bud:spread', 'แบ่งเท่ากันทุกเดือน') + '</div>'
      + '<div class="fld-w"><label>รวม 12 เดือน</label><div id="bdSum" class="mono" style="padding:9px 0;font-weight:600">0.00</div></div>'
      + yp.map((p, i) => field({ name: 'bd' + i, label: thPeriod(p), value: faExact(budgetAmount(cur.code, p)), cls: 'r' })).join('')
      + '</div>',
    submitLabel: 'บันทึกงบประมาณ',
    note: 'งบประมาณไม่ลงบัญชี แก้ได้ทุกเมื่อ',
    onSubmit: function () {
      submitAction(function () {
        const months = yp.map((p, i) => val('bd' + i));
        const r = saveBudget({ account: val('bdAcc'), period: STATE.period, months });
        toast('บันทึกงบประมาณ ' + r.account + ' แล้ว', 'ok', 'รวมทั้งปี ' + fmt(r.total) + ' บาท');
        return r;
      });
    },
  });
  refreshBudgetSum();
}
function refreshBudgetSum() {
  const el = document.getElementById('bdSum');
  if (!el) return;
  let t = 0;
  for (let i = 0; i < 12; i++) t += M(val('bd' + i) || '0');
  el.textContent = fmt(t);
}
function budgetFill(values) {
  values.forEach((v, i) => { const e = document.querySelector('#modal [name="bd' + i + '"]'); if (e) e.value = faExact(v); });
  refreshBudgetSum();
}

/* ===================================================================
   เอกสารพิมพ์
   =================================================================== */
DOC_PRINT.assetDisposal = {
  title: 'เอกสารขาย/ตัดจำหน่ายทรัพย์สิน', copies: ['ต้นฉบับ', 'สำเนา'],
  find: (no) => DB.docs.assetDisposal.find((d) => d.no === no),
  build: function (d, copy) {
    const wm = d.status === 'void' ? 'ยกเลิก' : '';
    if (d.kind === 'writeoff') {
      return pSheet(pHead('ใบบันทึกตัดจำหน่ายทรัพย์สิน', 'ASSET WRITE-OFF', copy)
        + '<div class="p-meta">' + pInfo([['ทรัพย์สิน', d.assetCode + ' ' + d.assetName], ['ประเภท', faClassLabel(d.class)],
          ['วันเริ่มใช้', thDate(d.inService)], ['เหตุผล', d.note || '']])
        + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)]]) + '</div>'
        + pTable([{ t: 'รายการ' }, { t: 'จำนวนเงิน', w: '36mm', n: 1 }], [['ราคาทุน', pm(d.cost)], ['ค่าเสื่อมราคาสะสม ณ วันตัดจำหน่าย', pm(d.accumBook)],
          ['ราคาตามบัญชีที่ตัดเป็นขาดทุน', pm(d.nbv)]])
        + pEntry(d.depEntryNo) + pEntry(d.entryNo)
        + pSign(['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ']), d.no, wm);
    }
    const cash = d.settle === 'cash';
    const title = d.vat ? (cash ? 'ใบกำกับภาษี/ใบเสร็จรับเงิน' : 'ใบกำกับภาษี') : (cash ? 'ใบเสร็จรับเงิน' : 'ใบแจ้งหนี้');
    const en = d.vat ? (cash ? 'TAX INVOICE / RECEIPT' : 'TAX INVOICE') : (cash ? 'RECEIPT' : 'INVOICE');
    return pSheet(pHead(title, en, copy)
      + '<div class="p-meta">' + pParty('ผู้ซื้อ', d.snap)
      + pInfo([['เลขที่', d.no], ['วันที่', thDate(d.date)], ['การชำระ', cash ? 'ชำระแล้ว' : 'เงินเชื่อ']]) + '</div>'
      + pTable(LINE_COLS, [['1', 'ขาย' + d.assetName + ' (ทรัพย์สินใช้แล้ว รหัส ' + d.assetCode + ')', '1', 'รายการ', pm(d.proceeds), pm(d.proceeds)]], 6)
      + pTotals(d.total, d.vat ? [['มูลค่าที่เสียภาษี', pm(d.proceeds)], ['ภาษีมูลค่าเพิ่ม ' + d.vatRate + '%', pm(d.vat)], ['จำนวนเงินรวมทั้งสิ้น', pm(d.total), true]]
        : [['จำนวนเงินรวมทั้งสิ้น', pm(d.total), true]])
      + pSign(cash ? ['ผู้รับสินค้า', 'ผู้รับเงิน', 'ผู้มีอำนาจลงนาม'] : ['ผู้รับสินค้า', 'ผู้มีอำนาจลงนาม']), d.no, wm);
  },
};
DOC_PRINT.assetReceipt = {
  title: 'ใบเสร็จรับเงิน', copies: ['ต้นฉบับ', 'สำเนา'],
  find: (no) => { for (const d of DB.docs.assetDisposal) { const c = (d.collections || []).find((x) => x.no === no); if (c) return { d, c }; } return null; },
  build: function (x, copy) {
    const d = x.d, c = x.c;
    return pSheet(pHead('ใบเสร็จรับเงิน', 'RECEIPT', copy)
      + '<div class="p-meta">' + pParty('ได้รับเงินจาก', d.snap) + pInfo([['เลขที่', c.no], ['วันที่', thDate(c.date)]]) + '</div>'
      + pTable([{ t: 'ลำดับ', w: '11mm', c: 1 }, { t: 'รายการ' }, { t: 'จำนวนเงิน', w: '34mm', n: 1 }],
        [['1', 'ชำระค่าขายทรัพย์สินตามเอกสารเลขที่ ' + d.no + ' ลงวันที่ ' + thDate(d.date), pm(c.amount)]], 6)
      + pTotals(c.amount, [['จำนวนเงินที่ชำระ', pm(c.amount), true]])
      + pSign(['ผู้รับเงิน', 'ผู้มีอำนาจลงนาม']), c.no, c.status === 'void' ? 'ยกเลิก' : '');
  },
};

/* ===================================================================
   ลงทะเบียนเข้าระบบหน้าจอ
   =================================================================== */
SCREENS.assets = scAssetRegister;
SCREENS.deprec = scDepreciation;
SCREENS.projects = scProjectList;
SCREENS.budget = scBudgetReport;
PAGE_INFO.assets = { d: 'ทะเบียนทรัพย์สินถาวร — ลงทะเบียนจากรายการตั้งหนี้ได้ราคาทุนตรงบัญชี · ขาย/ตัดจำหน่ายจากหน้านี้ ระบบคิดค่าเสื่อมถึงเดือนที่จำหน่าย ลงกำไรขาดทุนและภาษีขายให้ · เทียบทะเบียนกับบัญชีทุกสิ้นงวด',
  je: [['dr', 'เงินสด/ลูกหนี้ · ค่าเสื่อมสะสม · ขาดทุน'], ['cr', 'ราคาทุน · ภาษีขาย · กำไร']], book: 'สมุดรายวันรับ / ขาย / ทั่วไป' };
PAGE_INFO.deprec = { d: 'คิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ถึงเดือนที่จำหน่าย ไม่มีมูลค่าซาก · เดือนที่ยังไม่ได้คิด (ลงทะเบียนช้าหรือข้ามงวด) รวมเข้างวดที่ตั้ง · ทางภาษีตาม พ.ร.ฎ.145',
  je: [['dr', 'ค่าเสื่อมราคา'], ['cr', 'ค่าเสื่อมราคาสะสม']], book: 'สมุดรายวันทั่วไป' };
PAGE_INFO.projects = { d: 'สร้างโครงการ ผูกใบกำกับ ตั้งหนี้ และค่าใช้จ่ายเข้าโครงการ แล้วดูรายได้ ต้นทุน และกำไรจริงเทียบงบต้นทุน',
  je: NOJE('ไม่ลงบัญชี — ผูกเอกสารที่ลงบัญชีแล้ว') };
PAGE_INFO.budget = { d: 'งบประมาณรายบัญชีรายเดือน เทียบกับยอดจริงจากบัญชีแยกประเภท ทั้งเดือนนี้และสะสมตั้งแต่ต้นปีบัญชี',
  je: NOJE('ไม่ลงบัญชี — แก้ได้แม้งวดปิด') };
ENTRY_SOURCE_SCREEN.assetDisposal = 'assets';
SCREEN_WORDS.assets = 'fixed asset ทรัพย์สินถาวร ขายทรัพย์สิน ตัดจำหน่าย จำหน่ายทรัพย์สิน ทะเบียนทรัพย์สิน';
SCREEN_WORDS.deprec = 'depreciation ค่าเสื่อม';
SCREEN_WORDS.projects = 'project โครงการ งาน';
SCREEN_WORDS.budget = 'budget งบประมาณ งบ';
CREATE_MENU.push({ s: 'ทรัพย์สิน โครงการ งบประมาณ', icon: 'asset', items: [
  ['fa:dispose', 'ขาย/ตัดจำหน่ายทรัพย์สิน'], ['fa:fromdoc', 'ลงทะเบียนทรัพย์สินจากตั้งหนี้'], ['fa:opening', 'ลงทะเบียนทรัพย์สินยกมา'],
  ['proj:new', 'โครงการ'], ['bud:edit', 'งบประมาณ'],
]});

EXTRA_DISPATCH.push(function (head, rest) {
  if (head === 'asset') {
    if (rest[0] === 'new') modalAssetForm(null);
    if (rest[0] === 'edit') modalAssetForm(rest[1]);
    return true;
  }
  if (head === 'fa') {
    const [what, a1, a2] = rest;
    if (what === 'dispose') { closeModal(); modalDispose(a1 || null); }
    if (what === 'fromdoc') modalFromDoc(rest.slice(1).join(':') || null);
    if (what === 'opening') modalOpeningAsset(null);
    if (what === 'delete') {
      closeModal();
      modalReason({ title: 'ลบทรัพย์สิน ' + a1 + ' ออกจากทะเบียน', sub: 'ใช้เมื่อลงทะเบียนผิด — ไม่แตะบัญชีแยกประเภท ร่องรอยการตรวจสอบเก็บเหตุผลไว้',
        placeholder: 'เช่น ลงทะเบียนซ้ำ / เอกสารซื้อถูกยกเลิก', submitLabel: 'ลบออกจากทะเบียน', done: 'ลบทรัพย์สิน ' + a1 + ' ออกจากทะเบียนแล้ว',
        run: (r) => deleteAsset(a1, r) });
    }
    if (what === 'suggest') fillSuggestedAccum();
    if (what === 'void') modalDisposalVoid(a1);
    if (what === 'collect') modalCollect(a1);
    if (what === 'voidcol') modalReason({ title: 'ยกเลิกการรับชำระ ' + a2, sub: 'กลับรายการใบสำคัญรับเงิน ยอดค้างรับของ ' + a1 + ' กลับมาเท่าเดิม',
      placeholder: 'เช่น เช็คคืน / บันทึกผิดบัญชี', submitLabel: 'ยกเลิกการรับชำระ', done: 'ยกเลิกการรับชำระ ' + a2 + ' แล้ว',
      run: (r) => voidAssetCollection(a1, a2, r) });
    return true;
  }
  if (head === 'proj') {
    const [what, code] = rest;
    if (what === 'new') modalProject(null);
    if (what === 'edit') modalProject(code);
    if (what === 'tag') modalProjectTag(code);
    if (what === 'untag') runAction(function () {
      setDocProject(rest[1], rest.slice(2).join(':'), '');
      toast('ถอด ' + rest.slice(2).join(':') + ' ออกจากโครงการแล้ว', 'ok');
    });
    if (what === 'close') modalReason({ title: 'ปิดโครงการ ' + code, sub: 'ปิดแล้วผูกเอกสารเพิ่มไม่ได้ เปิดใหม่ได้ภายหลัง',
      placeholder: 'เช่น ส่งมอบงานครบแล้ว', submitLabel: 'ปิดโครงการ', done: 'ปิดโครงการ ' + code + ' แล้ว',
      run: (r) => setProjectStatus(code, 'closed', r) });
    if (what === 'reopen') runAction(function () {
      setProjectStatus(code, 'active', 'เปิดโครงการอีกครั้ง');
      toast('เปิดโครงการ ' + code + ' อีกครั้งแล้ว', 'ok');
    });
    return true;
  }
  if (head === 'bud') {
    if (rest[0] === 'edit') modalBudget(rest[1] || null);
    if (rest[0] === 'spread') {
      const total = M(val('bdAnnual') || '0');
      if (total <= 0) { toast('กรอกงบทั้งปีก่อน', 'err'); return true; }
      budgetFill(budgetSpread(total));
    }
    return true;
  }
  return false;
});
EXTRA_CHANGE.push(function (t) {
  const n = t.name || '';
  if (/^fa[A-Z]/.test(n)) { refreshDisposalForm(); return true; }
  if (n === 'fdLine') {
    const s = ppeSourceLines().find((x) => x.key === t.value);
    if (!s) return true;
    const set = (k, v) => { const e = document.querySelector('#modal [name="' + k + '"]'); if (e) e.value = v; };
    set('name', s.desc); set('inService', s.date);
    if (acc(s.acc).subType === 'ppe_land') set('class', 'LAND');
    const info = document.getElementById('fdInfo');
    if (info) info.innerHTML = fdInfo(s);
    return true;
  }
  if (n === 'bdAcc') {
    budgetFill(budgetYearPeriods(STATE.period).map((p) => budgetAmount(t.value, p)));
    return true;
  }
  return false;
});
EXTRA_INPUT.push(function (t) {
  const n = t.name || '';
  if (n === 'faProceeds' || n === 'faBuyerName' || n === 'faBuyerAddress' || n === 'faBuyerTaxId') { refreshDisposalForm(); return true; }
  if (/^bd\d+$/.test(n)) { refreshBudgetSum(); return true; }
  return false;
});
