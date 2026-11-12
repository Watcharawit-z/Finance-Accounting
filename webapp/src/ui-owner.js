/* ===================================================================
   หน้าของเจ้าของ — ยอดขาย กำไร เทียบค่าแอด รายวัน (ตัวเลขคิดใน owner.js)
   เห็นเฉพาะคนที่เข้าด้วยรหัสเจ้าของ (APP_OWNER_PASSCODE) — เซิร์ฟเวอร์ไม่ส่งค่าแอดให้รหัสร่วมเลย หน้าจอแค่ซ่อนเมนูตาม
   ค่าแอดมาจาก: กรอกเองในหน้านี้ หรือ SellerHub ส่งเข้ามาที่ /api/ingest/ad-spend (กุญแจ APP_INGEST_KEY)
   เปิดแบบไม่มีเซิร์ฟเวอร์ (เก็บในเบราว์เซอร์) ไม่มีรหัสให้แยก — ค่าแอดเก็บในเบราว์เซอร์เครื่องนั้น
   =================================================================== */
const OWNER = { key: '', ads: [], loading: false, error: '', pick: [] };
function ownerVisible() { return SYNC.mode !== 'server' || SYNC.role === 'owner'; }
const adsLocalKey = () => 'financii.ads.' + SYNC.book;
function adsLocalAll() { try { return JSON.parse(lsGet(adsLocalKey()) || '[]'); } catch (e) { return []; } }
const AD_SOURCE = { manual: 'กรอกเอง', ingest: 'ระบบอื่นส่งมา', sellerhub: 'SellerHub' };

async function ownerAdsFetch(from, to) {
  if (SYNC.mode !== 'server') return adsLocalAll().filter((a) => a.date >= from && a.date <= to);
  const r = await fetch('/api/ads?book=' + encodeURIComponent(SYNC.book) + '&from=' + from + '&to=' + to, { headers: syncHeaders() });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b && b.error && b.error.message) || 'อ่านค่าแอดไม่ได้ (HTTP ' + r.status + ')');
  return b.items || [];
}
/** โหลดค่าแอดของช่วงที่ดูอยู่ — เสร็จแล้ววาดหน้าใหม่ */
function ownerAdsLoad(key, from, to) {
  OWNER.loading = true;
  OWNER.key = key;
  return ownerAdsFetch(from, to)
    .then(function (items) { OWNER.ads = items; OWNER.error = ''; })
    .catch(function (e) { OWNER.ads = []; OWNER.error = e.message; })
    .then(function () { OWNER.loading = false; if (STATE.screen === 'ownerdaily') render(); });
}
/** บันทึกค่าแอด — items = [{ date, shop, amount }] · amount null = ลบ */
async function ownerAdsSave(items) {
  if (SYNC.mode !== 'server') {
    const all = adsLocalAll();
    items.forEach(function (x) {
      const i = all.findIndex((a) => a.date === x.date && a.shop === x.shop);
      if (x.amount === null) { if (i >= 0) all.splice(i, 1); return; }
      const row = { date: x.date, shop: x.shop, amount: x.amount, source: 'manual', updatedAt: new Date().toISOString() };
      if (i >= 0) all[i] = row; else all.push(row);
    });
    if (!lsSet(adsLocalKey(), JSON.stringify(all))) throw new Error('เบราว์เซอร์นี้ไม่ให้เก็บข้อมูล');
    return;
  }
  const r = await fetch('/api/ads?book=' + encodeURIComponent(SYNC.book), { method: 'PUT', headers: syncHeaders(), body: JSON.stringify({ items }) });
  const b = await r.json().catch(() => null);
  if (!r.ok) throw new Error((b && b.error && b.error.message) || 'บันทึกค่าแอดไม่สำเร็จ (HTTP ' + r.status + ')');
}

const roasText = (x) => (x === null ? '—' : x.toFixed(2) + ' เท่า');
const shareText = (x) => (x === null ? '—' : (x * 100).toFixed(1) + '%');
const weekdayTh = (iso) => ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'][new Date(iso + 'T00:00:00Z').getUTCDay()];

/* ---------- กราฟรายวัน: ยอดขายกับค่าแอด (หน่วยบาทเดียวกัน แกนเดียว) ---------- */
function chartDaily(rows) {
  const series = [{ key: 'sales', name: 'ยอดขาย', color: '--s1' }, { key: 'ad', name: 'ค่าแอด', color: '--s2' }];
  const peak = Math.max(1, ...rows.map((r) => Math.max(r.sales, r.ad)));
  const { max } = niceMax(peak, 4);
  const k = (v) => v / S / 1000;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = CH.top + plotH() - (plotH() * i) / 4;
    const v = k((max * i) / 4);
    grid += '<line class="grid' + (i === 0 ? ' base' : '') + '" x1="' + CH.left + '" y1="' + y + '" x2="' + (CH.w - CH.right) + '" y2="' + y + '"/>'
      + '<text class="ax" x="' + (CH.left - 9) + '" y="' + (y + 4) + '" text-anchor="end">' + (v >= 10 || v === 0 ? v.toFixed(0) : v.toFixed(1)) + '</text>';
  }
  const band = plotW() / rows.length;
  const gap = 2;
  const bw = Math.max(2, Math.min(12, (band * 0.72 - gap) / 2));
  let bars = '';
  rows.forEach(function (r, i) {
    const cx = CH.left + band * i + band / 2;
    series.forEach(function (s, j) {
      const h = Math.max(0, (r[s.key] / max) * plotH());
      if (!h) return;
      const x = cx - (bw * 2 + gap) / 2 + j * (bw + gap);
      bars += '<path class="mk" fill="var(' + s.color + ')" d="' + barTop(x, CH.top + plotH() - h, bw, h, 4) + '"'
        + tip(thDate(r.date) + ' — ' + s.name, r[s.key]) + '></path>';
    });
    const d = Number(r.date.slice(8));
    if (rows.length <= 10 || d === 1 || d % 5 === 0) {
      bars += '<text class="ax" x="' + cx + '" y="' + (CH.h - 10) + '" text-anchor="middle">' + d + '</text>';
    }
  });
  return '<div class="chart-wrap"><div class="legend">' + series.map((s) =>
      '<span><i style="background:var(' + s.color + ')"></i>' + esc(s.name) + '</span>').join('')
    + '<span class="grow"></span><span class="unit">พันบาท · วันที่</span></div>'
    + '<svg class="chart" viewBox="0 0 ' + CH.w + ' ' + CH.h + '" role="img" aria-label="ยอดขายและค่าแอดรายวัน">' + grid + bars + '</svg></div>';
}

function scOwnerDaily() {
  if (!ownerVisible()) {
    return card({ title: 'ยอดขาย กำไร ค่าแอด', body: '<div class="empty">หน้านี้สำหรับเจ้าของ — เข้าด้วยรหัสเจ้าของเพื่อดู'
      + (SYNC.ownerLogin ? '<div style="margin-top:12px">' + btn('owner:login', 'เข้าสู่ระบบเจ้าของ', 'primary') + '</div>' : '') + '</div>' });
  }
  const from = pStart(), to = pEnd();
  const key = SYNC.mode + '|' + SYNC.book + '|' + from + '|' + to;
  if (OWNER.key !== key && !OWNER.loading) ownerAdsLoad(key, from, to);
  const shops = adShops(OWNER.ads);
  const pick = OWNER.pick.filter((s) => shops.indexOf(s) >= 0);
  const r = adsCompare(from, to, OWNER.ads, pick);
  /* วันในอนาคตของเดือนปัจจุบันไม่แสดง (ยังไม่มีอะไรให้เทียบ) */
  const rows = r.rows.filter((x) => x.date <= TODAY || x.sales || x.ad);
  const t = r.totals;
  const sold = rows.filter((x) => x.sales).length;
  const note = OWNER.loading ? '<div class="note">กำลังโหลดค่าแอด…</div>'
    : OWNER.error ? '<div class="note warn">' + esc(OWNER.error) + ' ' + btn('owner:reload', 'ลองใหม่') + '</div>' : '';
  const summary = card({
    title: 'ยอดขาย กำไร เทียบค่าแอด รายวัน', sub: thPeriod(STATE.period) + (pick.length ? ' · ค่าแอดเฉพาะ ' + pick.join(', ') : ' · ค่าแอดทุกร้าน'),
    actions: btn('owner:ad', '+ กรอกค่าแอด', 'primary') + btn('owner:reload', 'ดึงค่าแอดล่าสุด')
      + (SYNC.mode === 'server' && SYNC.passcode ? btn('owner:logout', 'ออกจากระบบ') : ''),
    filters: shops.length > 1 ? '<div class="chips">' + chip('ownshop:', 'ทุกร้าน', !pick.length)
      + shops.map((s) => chip('ownshop:' + encodeURIComponent(s), s, pick.indexOf(s) >= 0)).join('') + '</div>' : '',
    body: note + kpi([
      { label: 'ยอดขาย (ก่อนภาษี)', value: fmt(t.sales), sub: sold + ' วันที่มียอดขาย' },
      { label: 'กำไรขั้นต้น', value: fmt(t.gross), sub: 'ขาย − ต้นทุนสินค้า · ' + shareText(t.margin) },
      { label: 'ค่าแอด', value: fmt(t.ad), sub: shareText(t.adShare) + ' ของยอดขาย' },
      { label: 'กำไรหลังค่าแอด', value: fmt(t.net), tone: t.net < 0 ? 'bad' : t.net > 0 ? 'good' : '',
        sub: t.lossDays ? 'ขาดทุนหลังค่าแอด ' + t.lossDays + ' วัน' : 'ไม่มีวันที่ขาดทุนหลังค่าแอด' },
      { label: 'ROAS', value: roasText(t.roas), sub: 'ยอดขาย ÷ ค่าแอด' },
    ]) + chartDaily(rows) + tbl({
      cols: [{t:'วันที่'}, {t:'ยอดขาย',a:'r'}, {t:'ต้นทุนสินค้า',a:'r'}, {t:'กำไรขั้นต้น',a:'r'}, {t:'ค่าแอด',a:'r'},
        {t:'กำไรหลังค่าแอด',a:'r'}, {t:'ROAS',a:'r'}, {t:'ค่าแอด/ยอดขาย',a:'r'}],
      rows: rows.slice().reverse().map((x) => [weekdayTh(x.date) + ' ' + thDateNum(x.date), {n:x.sales}, {n:x.cost}, {n:x.gross},
        {n:x.ad}, {n:x.net}, {c: roasText(x.roas)}, {c: shareText(x.adShare)}]),
      foot: ['รวม', {n:t.sales}, {n:t.cost}, {n:t.gross}, {n:t.ad}, {n:t.net}, {c: roasText(t.roas)}, {c: shareText(t.adShare)}],
      empty: 'ยังไม่มีวันในงวดนี้',
    }),
    foot: 'ยอดขาย = รายได้จากการขายและบริการในบัญชี ก่อนภาษีมูลค่าเพิ่ม หักรับคืนและส่วนลด (ตรงกับงบกำไรขาดทุน) · '
      + 'ต้นทุนสินค้า = ต้นทุนเฉลี่ยของของที่ขายตามทะเบียนสินค้า (ใช้ได้ทั้งวิธีบันทึกสินค้าแบบต่อเนื่องและแบบสิ้นงวด) · '
      + 'ค่าแอดไม่ได้มาจากบัญชี — กรอกเองหรือ SellerHub ส่งมา · วันล่าสุดอยู่บนสุด',
  });
  const mine = OWNER.ads.filter((a) => !pick.length || pick.indexOf(a.shop) >= 0).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.shop < b.shop ? -1 : 1));
  const list = card({
    title: 'รายการค่าแอด', sub: thPeriod(STATE.period) + ' · ' + mine.length + ' รายการ',
    body: tbl({
      cols: [{t:'วันที่'}, {t:'ร้าน / บัญชีโฆษณา'}, {t:'ค่าแอด',a:'r'}, {t:'ที่มา'}, {t:''}],
      rows: mine.map((a) => [thDateNum(a.date), a.shop, {n: M(String(a.amount))}, {dim: AD_SOURCE[a.source] || a.source || '—'},
        {html: btn('owner:edit:' + encodeURIComponent(a.date + '|' + a.shop), 'แก้') + ' '
          + btn('owner:del:' + encodeURIComponent(a.date + '|' + a.shop), 'ลบ', 'danger')}]),
      empty: OWNER.loading ? 'กำลังโหลด…' : 'ยังไม่มีค่าแอดในงวดนี้ — กด "+ กรอกค่าแอด" หรือให้ SellerHub ส่งเข้ามา',
    }),
  });
  return summary + list + ownerIngestCard();
}

/** วิธีให้ SellerHub (หรือระบบอื่น) ส่งค่าแอดเข้ามา */
function ownerIngestCard() {
  if (SYNC.mode !== 'server') {
    return card({ title: 'เชื่อมกับ SellerHub', body: '<div class="note">ตอนนี้เปิดแบบเก็บข้อมูลในเบราว์เซอร์ — ระบบอื่นส่งค่าแอดเข้ามาได้เมื่อเปิดผ่านเซิร์ฟเวอร์ที่ต่อฐานข้อมูล</div>' });
  }
  const url = location.origin + '/api/ingest/ad-spend';
  const sample = JSON.stringify({ book: SYNC.book, source: 'sellerhub',
    items: [{ date: TODAY, shop: 'TikTok ร้าน A', amount: 1500.5 }] }, null, 2);
  return card({
    title: 'เชื่อมกับ SellerHub', sub: SYNC.ingest ? 'เปิดรับข้อมูลแล้ว' : 'ยังไม่ได้ตั้งกุญแจ APP_INGEST_KEY ที่เซิร์ฟเวอร์',
    body: '<div class="kv">'
      + [['ส่งไปที่ (POST)', url], ['สมุดบัญชี (book)', SYNC.book], ['กุญแจ', 'ส่วนหัว Authorization: Bearer <APP_INGEST_KEY>']]
        .map((x) => '<div><span>' + esc(x[0]) + '</span><b class="mono">' + esc(x[1]) + '</b></div>').join('') + '</div>'
      + '<div class="sub-h">ตัวอย่างข้อมูลที่ส่ง</div><pre class="code-sample">' + esc(sample) + '</pre>',
    foot: 'วันที่ตามเวลาไทย (YYYY-MM-DD) · ส่งวันเดิมของร้านเดิมซ้ำ = แทนยอดเดิม · แถวผิดแถวเดียวไม่รับทั้งชุด · ครั้งละไม่เกิน 2,000 แถว'
      + (SYNC.ingest ? '' : ' · ตั้งกุญแจที่ Railway → Variables → APP_INGEST_KEY แล้วเอากุญแจเดียวกันไปใส่ใน SellerHub'),
  });
}

/** การ์ดการเข้าใช้งานในหน้าตั้งค่า — สิทธิ์ที่ใช้อยู่ · รหัสทีมบัญชี · เข้าสู่ระบบเจ้าของ · ออกจากระบบ */
function accessCard() {
  if (SYNC.mode !== 'server') return '';
  const owner = SYNC.role === 'owner';
  const team = SYNC.teamPassFrom === 'env' ? 'ตั้งไว้ที่ Railway (APP_PASSCODE)' : SYNC.teamPassFrom === 'app' ? 'ตั้งแล้ว (เจ้าของเปลี่ยนได้ที่นี่)'
    : SYNC.ownerLogin ? 'ยังไม่ได้ตั้ง — ตอนนี้เข้าได้เฉพาะเจ้าของ' : 'ยังไม่ได้ตั้ง — ใครรู้ลิงก์ก็เข้าได้';
  return card({
    title: 'การเข้าใช้งาน', sub: owner ? 'เข้าด้วยรหัสเจ้าของ' : 'เข้าด้วยรหัสทีมบัญชี',
    actions: (owner && SYNC.teamPassFrom !== 'env' ? btn('owner:teampass', SYNC.teamPassFrom ? 'เปลี่ยนรหัสทีมบัญชี' : 'ตั้งรหัสทีมบัญชี', SYNC.teamPassFrom ? '' : 'primary') : '')
      + (!owner && SYNC.ownerLogin ? btn('owner:login', 'เข้าสู่ระบบเจ้าของ') : '')
      + (SYNC.passcode ? btn('owner:logout', 'ออกจากระบบ') : ''),
    body: '<div class="kv"><div><span>สิทธิ์ของคุณ</span><b>' + (owner ? 'เจ้าของ — ทุกหน้า และหน้ายอดขาย กำไร ค่าแอด' : 'ทีมบัญชี — ทำบัญชีได้ทุกหน้า (ไม่เห็นค่าแอด)') + '</b></div>'
      + '<div><span>รหัสทีมบัญชี</span><b>' + esc(team) + '</b></div></div>',
    foot: 'เปิดเว็บต้องใส่รหัสทุกครั้งที่เปิดเบราว์เซอร์ใหม่ (เว้นแต่ติ๊ก "จำไว้ในเครื่องนี้") · เปลี่ยนรหัสทีมแล้ว ทุกเครื่องที่ใช้รหัสเดิมต้องเข้าใหม่',
  });
}
function modalTeamPass() {
  modal({
    title: SYNC.teamPassFrom ? 'เปลี่ยนรหัสทีมบัญชี' : 'ตั้งรหัสทีมบัญชี',
    sub: 'รหัสที่น้องบัญชีใช้เข้าเว็บ — เห็นทุกหน้ายกเว้นหน้ายอดขาย กำไร ค่าแอด · อย่างน้อย 6 ตัวอักษร ไม่ซ้ำกับรหัสเจ้าของ',
    body: '<div class="flds">' + field({ name: 'teamPass', label: 'รหัสทีมบัญชีใหม่', type: 'password' })
      + field({ name: 'teamPass2', label: 'พิมพ์ซ้ำอีกครั้ง', type: 'password' }) + '</div>',
    submitLabel: 'บันทึกรหัส',
    onSubmit: function () {
      const a = val('teamPass'), b = val('teamPass2');
      if (a.length < 6) return toast('รหัสทีมบัญชีต้องยาวอย่างน้อย 6 ตัวอักษร', 'err');
      if (a !== b) return toast('พิมพ์รหัสสองช่องไม่ตรงกัน', 'err');
      fetch('/api/team-pass', { method: 'POST', headers: syncHeaders(), body: JSON.stringify({ passcode: a }) })
        .then(function (r) { return r.json().catch(() => null).then((b2) => ({ r, b: b2 })); })
        .then(function (x) {
          if (!x.r.ok) return toast((x.b && x.b.error && x.b.error.message) || 'ตั้งรหัสไม่สำเร็จ', 'err');
          return syncMe().then(function () {
            closeModal();
            toast('ตั้งรหัสทีมบัญชีแล้ว', 'ok', 'บอกรหัสนี้ให้น้องบัญชี — เครื่องที่ใช้รหัสเดิมต้องเข้าใหม่');
            render();
          });
        })
        .catch(function (e) { toast(e.message, 'err'); });
    },
  });
}
/** กดปุ่มผู้ใช้บนแถบบน */
function modalUserAccount() {
  const owner = SYNC.role === 'owner';
  modal({
    title: 'บัญชีผู้ใช้', sub: 'เข้าใช้งานด้วยสิทธิ์' + (owner ? 'เจ้าของ' : 'ทีมบัญชี'),
    body: '<div class="note">' + (owner ? 'เห็นทุกหน้า รวมหน้ายอดขาย กำไร ค่าแอด และตั้งรหัสทีมบัญชีได้ที่หน้าข้อมูลกิจการ'
      : 'ทำบัญชีได้ทุกหน้า — หน้ายอดขาย กำไร ค่าแอด สำหรับเจ้าของเท่านั้น') + '</div>'
      + '<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:12px">'
      + (!owner && SYNC.ownerLogin ? btn('owner:login', 'เข้าสู่ระบบเจ้าของ') : '')
      + btn('owner:logout', 'ออกจากระบบ', 'danger') + '</div>',
    submitLabel: 'ปิด',
    onSubmit: closeModal,
  });
}

function modalOwnerAd(cur) {
  const shops = adShops(OWNER.ads);
  const last = cur ? cur.shop : (OWNER.lastShop || shops[0] || '');
  modal({
    title: cur ? 'แก้ค่าแอด' : 'กรอกค่าแอด', sub: 'ยอดใช้จ่ายโฆษณาของวันนั้น (ดูจาก Ads Manager) — กรอกวันเดิมของร้านเดิมซ้ำ = แทนยอดเดิม',
    body: '<div class="flds">'
      + field({ name: 'adDate', label: 'วันที่', type: 'date', value: cur ? cur.date : (TODAY <= pEnd() && TODAY >= pStart() ? TODAY : pEnd()) })
      + '<div class="fld-w"><label for="f_adShop">ร้าน / บัญชีโฆษณา</label><input id="f_adShop" name="adShop" list="adShops" value="' + esc(last)
      + '" placeholder="เช่น TikTok ร้าน A"' + (cur ? ' readonly' : '') + '><datalist id="adShops">'
      + shops.map((s) => '<option value="' + esc(s) + '">').join('') + '</datalist></div>'
      + field({ name: 'adAmount', label: 'ค่าแอด (บาท)', value: cur ? String(cur.amount) : '', placeholder: '0.00' })
      + '</div>',
    submitLabel: 'บันทึกค่าแอด',
    onSubmit: function () {
      const date = val('adDate'), shop = val('adShop').trim().slice(0, 80) || 'ไม่ระบุร้าน';
      const raw = val('adAmount').replace(/,/g, '').trim();
      const n = Number(raw);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return toast('ต้องระบุวันที่', 'err');
      if (raw === '' || !isFinite(n) || n < 0) return toast('ค่าแอดต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'err');
      const amount = (Math.round(n * 100) / 100).toFixed(2);
      ownerAdsSave([{ date, shop, amount }]).then(function () {
        OWNER.lastShop = shop;
        OWNER.key = '';
        closeModal();
        toast('บันทึกค่าแอด ' + thDate(date) + ' แล้ว', 'ok', shop + ' · ' + fmt(M(amount)) + ' บาท');
        render();
      }).catch(function (e) { toast(e.message, 'err'); });
    },
  });
}
function modalOwnerLogin() {
  modal({
    title: 'เข้าสู่ระบบเจ้าของ', sub: 'ใส่รหัสเจ้าของ (ตั้งไว้ที่ Railway → Variables → APP_OWNER_PASSCODE)',
    body: '<div class="flds">' + field({ name: 'ownerPass', label: 'รหัสเจ้าของ', type: 'password', wide: true }) + '</div>',
    submitLabel: 'เข้าสู่ระบบ',
    onSubmit: function () {
      const code = val('ownerPass');
      if (!code) return toast('ใส่รหัสเจ้าของก่อน', 'err');
      const before = SYNC.passcode;
      SYNC.passcode = code;
      syncMe().then(function (role) {
        if (role !== 'owner') {
          SYNC.passcode = before;
          return syncMe().then(function () { toast('รหัสเจ้าของไม่ถูกต้อง', 'err'); });
        }
        passSave(code, false);
        closeModal();
        STATE.screen = 'ownerdaily'; STATE.sel = null; OWNER.key = '';
        toast('เข้าสู่ระบบเจ้าของแล้ว', 'ok');
        render();
      });
    },
  });
}

EXTRA_DISPATCH.push(function (head, rest, arg) {
  if (head === 'ownshop') {
    const s = decodeURIComponent(arg || '');
    if (!s) OWNER.pick = [];
    else OWNER.pick = OWNER.pick.indexOf(s) >= 0 ? OWNER.pick.filter((x) => x !== s) : OWNER.pick.concat([s]);
    render();
    return true;
  }
  if (head !== 'owner') return false;
  const what = rest[0];
  if (what === 'login') { modalOwnerLogin(); return true; }
  if (what === 'logout') { syncLogout(); return true; }
  if (what === 'account') { modalUserAccount(); return true; }
  if (what === 'teampass') { if (SYNC.role === 'owner') modalTeamPass(); return true; }
  if (!ownerVisible()) return true;
  if (what === 'ad') { modalOwnerAd(null); return true; }
  if (what === 'reload') { OWNER.key = ''; render(); return true; }
  const k = decodeURIComponent(rest.slice(1).join(':'));
  const cur = OWNER.ads.find((a) => a.date + '|' + a.shop === k);
  if (!cur) return true;
  if (what === 'edit') { modalOwnerAd(cur); return true; }
  if (what === 'del') {
    if (!confirm('ลบค่าแอด ' + cur.shop + ' วันที่ ' + thDate(cur.date) + ' (' + fmt(M(String(cur.amount))) + ' บาท)?')) return true;
    ownerAdsSave([{ date: cur.date, shop: cur.shop, amount: null }])
      .then(function () { OWNER.key = ''; toast('ลบค่าแอดแล้ว', 'ok'); render(); })
      .catch(function (e) { toast(e.message, 'err'); });
    return true;
  }
  return true;
});

SCREENS.ownerdaily = scOwnerDaily;
PAGE_INFO.ownerdaily = { d: 'ยอดขาย ต้นทุนสินค้า กำไร เทียบค่าแอดรายวัน — เฉพาะเจ้าของ',
  je: NOJE('ไม่ลงบัญชี — ค่าแอดในหน้านี้ใช้เทียบอย่างเดียว ค่าโฆษณาที่จ่ายจริงยังบันทึกเป็นค่าใช้จ่ายตามใบเสร็จ') };
SCREEN_WORDS.ownerdaily = 'ค่าแอด ค่าโฆษณา ยอดขาย กำไร ROAS รายวัน tiktok facebook shopee sellerhub ads';
