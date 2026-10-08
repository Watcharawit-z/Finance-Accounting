/* ===================================================================
   เจาะดูตัวเลข — คลิกตัวเลขในงบทดลอง งบการเงิน หรืออายุหนี้ แล้วเห็นว่าประกอบจากอะไร
   แผงด้านขวาไม่พาออกจากหน้าเดิม และตรวจทุกครั้งว่าผลรวมของรายการเท่ากับตัวเลขที่คลิกพอดี
   =================================================================== */
const PEEK = { reg: [], stack: [] };
const PEEK_MAX_LINES = 400;

/** ลงทะเบียนสิ่งที่จะเจาะดู คืนค่า data-act ไปใส่ในแถวหรือช่องตัวเลข */
function peekAct(spec) {
  PEEK.reg.push(spec);
  return 'peek:' + (PEEK.reg.length - 1);
}
function openPeek(i) {
  const s = PEEK.reg[Number(i)];
  if (!s) return;
  PEEK.stack = [s];
  renderPeek();
}
function pushPeek(spec) { PEEK.stack.push(spec); renderPeek(); }
function backPeek() { PEEK.stack.pop(); if (PEEK.stack.length) renderPeek(); else closePeek(); }
function closePeek() {
  const el = document.getElementById('peek');
  if (!el || !el.classList.contains('show')) return false;
  el.classList.remove('show');
  el.innerHTML = '';
  PEEK.stack = [];
  return true;
}

/** บัญชีด้านปกติ: สินทรัพย์และค่าใช้จ่ายเป็นเดบิต ที่เหลือเป็นเครดิต */
const debitNatural = (a) => a.type === 'asset' || a.type === 'expense';

function peekAccount(s) {
  const a = acc(s.acc);
  const opening = s.from ? balanceOf(a.code, addDays(s.from, -1)) : 0;
  const lines = [];
  DB.entries.forEach(function (e) {
    if (!LIVE(e)) return;
    if (s.to && e.date > s.to) return;
    if (s.from && e.date < s.from) return;
    e.lines.forEach(function (l) {
      if (l.acc === a.code) lines.push({ date: e.date, no: e.no, desc: l.memo || e.desc, partner: l.partner, dr: l.dr, cr: l.cr });
    });
  });
  lines.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : (x.no < y.no ? -1 : 1));
  let run = opening, dr = 0, cr = 0;
  lines.forEach((l) => { dr += l.dr; cr += l.cr; run += l.dr - l.cr; l.bal = run; });
  const closing = opening + dr - cr;
  const shown = lines.length > PEEK_MAX_LINES ? lines.slice(-PEEK_MAX_LINES) : lines;
  const nat = (v) => debitNatural(a) ? v : -v;
  return {
    title: a.code + ' ' + a.name,
    sub: (s.from ? thDate(s.from) + ' ถึง ' : 'ตั้งแต่เริ่มบัญชีถึง ') + thDate(s.to) + ' · ' + lines.length + ' รายการ'
      + ' · ด้านปกติ' + (debitNatural(a) ? 'เดบิต' : 'เครดิต'),
    body: '<div class="kv pk-kv">'
      + '<div><span>ยอดยกมา</span><b>' + fmt(nat(opening)) + '</b></div>'
      + '<div><span>เดบิต</span><b>' + fmt(dr) + '</b></div>'
      + '<div><span>เครดิต</span><b>' + fmt(cr) + '</b></div>'
      + '<div><span>ยอดยกไป</span><b>' + fmt(nat(closing)) + '</b></div></div>'
      + (lines.length > PEEK_MAX_LINES ? '<div class="note">แสดง ' + PEEK_MAX_LINES + ' รายการล่าสุด — ยอดรวมด้านบนคิดจากทั้ง '
        + lines.length + ' รายการ</div>' : '')
      + tbl({
        cols:[{t:'วันที่'},{t:'ใบสำคัญ'},{t:'คำอธิบาย'},{t:'เดบิต',a:'r'},{t:'เครดิต',a:'r'},{t:'คงเหลือ',a:'r'}],
        rows: shown.map((l) => [thDateNum(l.date), {mono:l.no}, l.desc + (l.partner ? ' · ' + l.partner : ''), {n:l.dr}, {n:l.cr}, {n:nat(l.bal)}]),
        rowAttr: (r) => 'class="row-link" data-act="peekgo:entry:' + r[1].mono + '"',
        empty:'ไม่มีรายการในช่วงนี้',
      }),
    total: closing,
    expect: s.expectRaw,
    proof: 'ยอดยกมา ' + fmt(nat(opening)) + ' + เดบิต ' + fmt(dr) + ' − เครดิต ' + fmt(cr) + ' = ' + fmt(nat(closing)),
    actions: btn('peekgo:drill:' + a.code, 'เปิดบัญชีแยกประเภทเต็ม'),
  };
}

function peekSubs(s) {
  const accts = DB.accounts.filter((a) => a.postable && s.subs.indexOf(a.subType) >= 0);
  const rows = accts.map((a) => ({ a, raw: balanceOf(a.code, s.to, s.from) }))
    .filter((r) => r.raw !== 0)
    .map((r) => ({ code: r.a.code, name: r.a.name, raw: r.raw, v: r.raw * s.sign }));
  if (s.plNet) {
    const raw = balanceOf((x) => x.type === 'revenue' || x.type === 'expense', s.to);
    if (raw) rows.push({ code: '', name: 'กำไร (ขาดทุน) ทุกปีที่ยังไม่ได้ลงรายการปิดบัญชี', raw, v: raw * s.sign, pl: true });
  }
  const total = rows.reduce((t, r) => t + r.v, 0);
  return {
    title: s.label,
    sub: (s.from ? thDate(s.from) + ' ถึง ' : 'ณ วันที่ ') + thDate(s.to) + ' · ' + rows.length + ' บัญชี',
    body: tbl({
      cols:[{t:'รหัส'},{t:'ชื่อบัญชี'},{t:'ยอด',a:'r'}],
      rows: rows.map((r) => [r.code ? {mono:r.code} : {dim:'—'}, r.name, {n:r.v}]),
      rowAttr: (r, i) => rows[i].pl ? '' : 'class="row-link" data-act="peeksub:' + rows[i].code + '"',
      foot: ['', 'รวม', {n:total}],
      empty:'ไม่มียอดในบรรทัดนี้',
    }),
    total, expect: s.expect,
    proof: 'ผลรวม ' + rows.length + ' บัญชีในบรรทัดนี้ = ' + fmt(total),
  };
}

function peekPartner(s) {
  const docs = s.side === 'ar' ? DB.docs.invoice : DB.docs.bill;
  const rows = docs.filter((d) => d.partnerCode === s.code && d.status !== 'void' && d.status !== 'draft' && d.date <= s.asOf)
    .map((d) => ({ d, out: outstandingAsOf(s.side, d, s.asOf) }))
    .filter((r) => r.out !== 0)
    .sort((x, y) => x.d.due < y.d.due ? -1 : 1);
  const total = rows.reduce((t, r) => t + r.out, 0);
  const p = DB.partners.find((x) => x.code === s.code) || { name: s.code };
  const screen = s.side === 'ar' ? 'invoices' : 'bills';
  return {
    title: p.name,
    sub: (s.side === 'ar' ? 'ลูกหนี้' : 'เจ้าหนี้') + 'คงค้าง ณ วันที่ ' + thDate(s.asOf) + ' · ' + rows.length + ' ใบ',
    body: tbl({
      cols:[{t:'เลขที่'},{t:'วันที่'},{t:'ครบกำหนด'},{t:'เกินกำหนด',a:'r'},{t:'ยอดเอกสาร',a:'r'},{t:'คงค้าง',a:'r'}],
      rows: rows.map(function (r) {
        const late = Math.floor((new Date(s.asOf) - new Date(r.d.due)) / 86400000);
        return [{mono:r.d.no}, thDateNum(r.d.date), thDateNum(r.d.due), late > 0 ? {c: late + ' วัน'} : {dim:'—'}, {n:r.d.total}, {n:r.out}];
      }),
      rowAttr: (r) => 'class="row-link" data-act="peekgo:open:' + screen + ':' + r[0].mono + '"',
      foot: ['', '', '', '', 'รวม', {n:total}],
      empty:'ไม่มียอดคงค้าง',
    }),
    total, expect: s.expect,
    proof: 'ผลรวมยอดคงค้างรายใบ = ' + fmt(total),
  };
}

function renderPeek() {
  const el = document.getElementById('peek');
  const s = PEEK.stack[PEEK.stack.length - 1];
  if (!el || !s) return;
  const v = s.kind === 'acc' ? peekAccount(s) : s.kind === 'subs' ? peekSubs(s) : peekPartner(s);
  const has = v.expect !== undefined && v.expect !== null;
  const ok = !has || v.total === v.expect;
  el.innerHTML = '<div class="pk-box" role="dialog" aria-modal="false" aria-label="รายละเอียดตัวเลข">'
    + '<div class="pk-h">'
    + (PEEK.stack.length > 1 ? '<button class="icon-btn" data-act="peekback" aria-label="ย้อนกลับ">‹</button>' : '')
    + '<div class="pk-t"><h3>' + esc(v.title) + '</h3><div class="card-sub">' + esc(v.sub) + '</div></div>'
    + '<span class="grow"></span><button class="icon-btn" data-act="peekclose" aria-label="ปิด">✕</button></div>'
    + '<div class="pk-chk ' + (ok ? 'ok' : 'bad') + '">'
    + (ok ? '<b>ตรวจแล้ว ✓</b> ' + esc(v.proof) + (has ? ' — ตรงกับตัวเลขที่คลิกพอดี' : '')
          : '<b>ไม่ตรง</b> ' + esc(v.proof) + ' แต่ตัวเลขที่คลิกคือ ' + fmt(v.expect) + ' ต่างกัน ' + fmt(v.total - v.expect))
    + '</div>'
    + '<div class="pk-b">' + v.body + '</div>'
    + (v.actions ? '<div class="pk-f">' + v.actions + '</div>' : '')
    + '</div>';
  el.classList.add('show');
}

function bindPeekEvents() {
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && document.getElementById('peek').classList.contains('show')
      && !document.getElementById('modal').classList.contains('show')) {
      ev.preventDefault();
      closePeek();
    }
  });
}

/** คำสั่งจากในแผง: ไปหน้าอื่นแล้วปิดแผง หรือเจาะลึกลงไปอีกชั้น */
function peekDispatch(head, arg, rest) {
  if (head === 'peek') { openPeek(arg); return true; }
  if (head === 'peekclose') { closePeek(); return true; }
  if (head === 'peekback') { backPeek(); return true; }
  if (head === 'peekgo') { closePeek(); dispatch(arg); return true; }
  if (head === 'peeksub') {
    const top = PEEK.stack[PEEK.stack.length - 1];
    pushPeek({ kind:'acc', acc: arg, from: top.from, to: top.to, expectRaw: balanceOf(arg, top.to, top.from) });
    return true;
  }
  return false;
}
