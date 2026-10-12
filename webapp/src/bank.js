/* ===================================================================
   ระบบกระทบยอดธนาคาร: รายการเดินบัญชีรายบัญชี นำเข้าสเตทเมนต์ จับคู่กับใบสำคัญ
   ข้อมูล
   - DB.bankTxns   บรรทัดสเตทเมนต์ {id, acc, date, desc, ref, debit=ถอน, credit=ฝาก, balance, matched, items, matchedTo, matchId, src, importId}
   - DB.bankStmts  ยอดตามสเตทเมนต์รายงวด {acc, period, opening, closing} — closing คือยอดที่ผู้ใช้ยืนยันจากสเตทเมนต์จริง
   - DB.bankBf     รายการค้างก่อนเริ่มกระทบยอด (เช็คค้างจ่าย/เงินฝากระหว่างทาง ณ วันเริ่ม) {id, acc, date, desc, ref, amount, entryNo}
   - DB.bankImports ประวัติการนำเข้าไฟล์ ใช้กันนำเข้าซ้ำและยกเลิกการนำเข้า
   รายการฝั่งบัญชี (book item) คือยอดสุทธิที่ใบสำคัญหนึ่งใบกระทบบัญชีเงินฝากนั้น อ้างด้วยเลขที่ใบสำคัญ
   =================================================================== */

/* ---------- บัญชีเงินฝาก ---------- */
const bankAccounts = () => DB.accounts.filter((a) => a.postable && a.subType === 'bank');
function bankAccCheck(code) {
  const a = DB.accounts.find((x) => x.code === code);
  if (!a || !a.postable || a.subType !== 'bank') {
    throw new DomainError('BANK_ACCOUNT_INVALID', 'บัญชี ' + (code || '—') + ' ไม่ใช่บัญชีเงินฝากธนาคาร',
      'เลือกบัญชีเงินฝากธนาคารจากผังบัญชี เช่น 1113 หรือ 1114');
  }
  return a;
}
const bankNet = (t) => (t.credit || 0) - (t.debit || 0);
/** ยอดสุทธิที่ใบสำคัญหนึ่งใบกระทบบัญชีนี้ (เดบิต − เครดิต) — เงินเข้าเป็นบวก */
const bankEntryNet = (e, code) => e.lines.reduce((s, l) => s + (l.acc === code ? l.dr - l.cr : 0), 0);
const bankNextId = (list) => list.reduce((m, x) => Math.max(m, Number(x.id) || 0), 0) + 1;
function bankShiftPeriod(p, n) {
  const [y, m] = p.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0');
}
const bankSortLines = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);

/* ข้อมูลที่บันทึกไว้ก่อนมีระบบนี้ บรรทัดสเตทเมนต์ไม่มีบัญชีกำกับ (สมัยที่ดูได้บัญชีเดียว)
   ยกให้บัญชีเงินฝากหลัก และแปลงการจับคู่แบบเดิม (matchedTo) เป็นรายการอ้างอิงแบบใหม่ */
function bankMigrate() {
  if (!Array.isArray(DB.bankTxns)) DB.bankTxns = [];
  let main = null;
  try { main = accBySub('bank'); } catch (e) { main = null; }
  let mid = DB.bankTxns.reduce((m, t) => Math.max(m, Number(t.matchId) || 0), 0);
  DB.bankTxns.forEach(function (t) {
    if (!t.acc && main) t.acc = main;
    if (t.balance === undefined) t.balance = null;
    if (!Array.isArray(t.items)) {
      t.items = t.matched && t.matchedTo && DB.entries.some((e) => e.no === t.matchedTo) ? [t.matchedTo] : [];
    }
    if (t.matched && !t.matchId) t.matchId = ++mid;
  });
  DB.bankTxns.forEach(function (t) { if (t.acc) bankStmtEnsure(t.acc, periodOf(t.date)); });
}

/* ---------- ยอดตามสเตทเมนต์รายงวด ---------- */
const bankStmtRec = (code, period) => DB.bankStmts.find((r) => r.acc === code && r.period === period) || null;
function bankStmtEnsure(code, period) {
  let r = bankStmtRec(code, period);
  if (!r) {
    r = { acc: code, period, opening: null, closing: null };
    DB.bankStmts.push(r);
    DB.bankStmts.sort((a, b) => (a.acc + a.period < b.acc + b.period ? -1 : 1));
  }
  return r;
}
/** วันแรกที่เริ่มกระทบยอดบัญชีนี้ = งวดแรกที่มีสเตทเมนต์ (กรอกยอดหรือมีรายการ)
    รายการในบัญชีก่อนวันนี้ถือว่ากระทบยอดไปแล้วนอกระบบ ส่วนที่ยังค้าง ณ วันเริ่มให้บันทึกเป็นรายการค้างยกมา */
function bankStartDate(code) {
  let p = null;
  DB.bankStmts.forEach((r) => { if (r.acc === code && (!p || r.period < p)) p = r.period; });
  DB.bankTxns.forEach((t) => { if (t.acc === code && (!p || periodOf(t.date) < p)) p = periodOf(t.date); });
  return p ? p + '-01' : null;
}
const bankLinesIn = (code, period) => DB.bankTxns.filter((t) => t.acc === code && periodOf(t.date) === period)
  .slice().sort(bankSortLines);

/**
 * ยอดยกมาและยอดคงเหลือตามสเตทเมนต์ของงวด — ไล่จากงวดแรกที่เริ่มกระทบยอด
 * ยอดยกมา: ที่กรอกไว้ › ยอดปลายงวดก่อน › คำนวณย้อนจากยอดคงเหลือของบรรทัดแรกที่มี
 * ยอดคงเหลือ: ที่กรอกไว้ (entered) › คงเหลือของบรรทัดสุดท้ายในไฟล์ › ยกมา + รายการ
 * gap = ยอดที่กรอกไว้ − (ยกมา + รายการ) ถ้าไม่ศูนย์ แปลว่าสเตทเมนต์ในระบบขาดหรือเกินรายการ
 */
function bankPeriodBalance(code, period) {
  const start = bankStartDate(code);
  if (!start || period < start.slice(0, 7)) return null;
  let p = start.slice(0, 7), prevClose = null;
  for (let guard = 0; guard < 600; guard++) {
    const rec = bankStmtRec(code, p);
    const lines = bankLinesIn(code, p);
    const net = lines.reduce((s, t) => s + bankNet(t), 0);
    let opening = rec && rec.opening !== null && rec.opening !== undefined ? rec.opening : prevClose;
    let openFrom = rec && rec.opening !== null && rec.opening !== undefined ? 'entered' : prevClose !== null ? 'prev' : null;
    if (opening === null) {
      let run = 0;
      for (let i = 0; i < lines.length; i++) {
        run += bankNet(lines[i]);
        if (lines[i].balance !== null && lines[i].balance !== undefined) { opening = lines[i].balance - run; openFrom = 'line'; break; }
      }
    }
    let closing = rec && rec.closing !== null && rec.closing !== undefined ? rec.closing : null;
    let closeFrom = closing !== null ? 'entered' : null;
    if (closing === null) {
      let after = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].balance !== null && lines[i].balance !== undefined) { closing = lines[i].balance + after; closeFrom = 'line'; break; }
        after += bankNet(lines[i]);
      }
    }
    if (closing === null && opening !== null) { closing = opening + net; closeFrom = 'calc'; }
    const computed = opening !== null ? opening + net : null;
    if (p === period) {
      return { period: p, opening, openFrom, closing, closeFrom, entered: closeFrom === 'entered', net, count: lines.length,
        computed, gap: closeFrom === 'entered' && computed !== null ? closing - computed : 0 };
    }
    prevClose = closing;
    p = bankShiftPeriod(p, 1);
  }
  return null;
}

/* ---------- รายการฝั่งบัญชี ---------- */
/** วันที่ของรายการฝั่งบัญชีทุกตัวที่อ้างถึงได้ (ใบสำคัญและรายการค้างยกมา) */
function bankKeyDates() {
  const m = new Map();
  DB.entries.forEach((e) => { if (LIVE(e)) m.set(e.no, e.date); });
  DB.bankBf.forEach((b) => { if (!b.entryNo) m.set('BF-' + b.id, b.date); });
  return m;
}
/** รายการฝั่งบัญชีที่จับคู่ไปแล้ว: เลขอ้างอิง → เลขกลุ่มที่จับคู่ */
function bankMatchedKeys(code) {
  const m = new Map();
  DB.bankTxns.forEach((t) => { if (t.acc === code && t.matched) (t.items || []).forEach((k) => m.set(k, t.matchId)); });
  return m;
}
/**
 * รายการฝั่งบัญชีของบัญชีเงินฝากนี้ ตั้งแต่วันเริ่มกระทบยอดถึง upto (null = ทั้งหมด)
 * ไม่นับใบยอดยกมาและใบนำเข้าจากระบบเดิม — เป็นยอดสรุป ไม่ใช่ธุรกรรมที่จะขึ้นในสเตทเมนต์
 * ใบสำคัญกับใบกลับรายการของมันที่ยังไม่ขึ้นสเตทเมนต์ทั้งคู่ หักล้างกันเอง ไม่ต้องค้างอยู่ในรายการ
 */
function bankBookItems(code, upto, fromOverride) {
  const start = fromOverride || bankStartDate(code);
  const matched = bankMatchedKeys(code);
  const out = new Map();
  const src = new Map();         // เลขที่ใบสำคัญ → ใบต้นทางของใบกลับรายการ (หาครั้งเดียว ไม่ไล่ทั้งสมุดทุกบรรทัด)
  const add = function (e, bf) {
    const amount = bankEntryNet(e, code);
    if (!amount) return;
    out.set(e.no, { key: e.no, kind: 'entry', date: e.date, amount, desc: e.desc, ref: e.srcId || '', src: e.src, entryNo: e.no, bf });
    if (e.src === 'reversal') src.set(e.no, e.srcId);
  };
  const bfEntry = new Map();
  DB.bankBf.forEach((b) => { if (b.acc === code && b.entryNo) bfEntry.set(b.entryNo, b.id); });
  DB.entries.forEach(function (e) {
    if (!LIVE(e) || (upto && e.date > upto)) return;
    /* ใบก่อนวันเริ่มเข้ามาเฉพาะที่ผู้ใช้ระบุว่ายังค้าง ณ วันเริ่ม */
    if (start && e.date < start) { if (bfEntry.has(e.no)) add(e, bfEntry.get(e.no)); return; }
    if (isOpeningEntry(e) || isImportEntry(e)) return;
    add(e, bfEntry.get(e.no));
  });
  src.forEach(function (orig, no) {
    if (!out.has(orig) || matched.has(no) || matched.has(orig)) return;
    out.delete(no); out.delete(orig);
  });
  DB.bankBf.forEach(function (b) {
    if (b.acc !== code || b.entryNo) return;
    const key = 'BF-' + b.id;
    out.set(key, { key, kind: 'bf', date: b.date, amount: b.amount, desc: b.desc, ref: b.ref || '', bf: b.id });
  });
  return Array.from(out.values()).map((it) => Object.assign(it, { matchId: matched.get(it.key) || null }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
}

/* ---------- งบกระทบยอด ---------- */
/**
 * งบกระทบยอดเงินฝากธนาคารของบัญชีหนึ่ง ณ สิ้นงวด
 *   ยอดตามสเตทเมนต์ + เงินฝากระหว่างทาง − เช็คค้างจ่าย  =  ยอดตามบัญชี + เงินเข้าที่ยังไม่บันทึก − เงินออกที่ยังไม่บันทึก
 * "ค้าง" ดู ณ วันสิ้นงวด: กลุ่มที่จับคู่กันจะนับว่าตรงกันแล้วก็ต่อเมื่อทุกบรรทัดและทุกใบสำคัญในกลุ่มลงวันที่ไม่เกินสิ้นงวด
 * เช่น เช็คที่จ่าย 28 มิ.ย. แต่ขึ้นสเตทเมนต์ 2 ก.ค. ยังเป็นเช็คค้างจ่ายในงบของเดือน มิ.ย.
 */
function bankReconcile(code, period) {
  const a = bankAccCheck(code);
  const from = period + '-01', end = endOfMonth(from);
  const start = bankStartDate(code);
  const beforeStart = !!start && start > end;
  const bal = start && !beforeStart ? bankPeriodBalance(code, period) : null;
  const book = balanceOf(code, end);
  const dates = bankKeyDates();
  const groups = new Map();
  DB.bankTxns.forEach(function (t) {
    if (t.acc !== code || !t.matched) return;
    const gid = t.matchId || ('L' + t.id);
    const g = groups.get(gid) || { ok: true, keys: [] };
    if (t.date > end) g.ok = false;
    (t.items || []).forEach(function (k) {
      g.keys.push(k);
      const d = dates.get(k);
      if (!d || d > end) g.ok = false;
    });
    groups.set(gid, g);
  });
  const cleared = new Set();
  groups.forEach((g) => { if (g.ok) g.keys.forEach((k) => cleared.add(k)); });
  const items = beforeStart ? [] : bankBookItems(code, end, start || from);
  const outstanding = items.filter((i) => !cleared.has(i.key));
  const unrecorded = beforeStart ? [] : DB.bankTxns.filter((t) => t.acc === code && t.date <= end
    && !(t.matched && groups.get(t.matchId || ('L' + t.id)).ok)).slice().sort(bankSortLines);
  const deposits = outstanding.filter((i) => i.amount > 0);
  const cheques = outstanding.filter((i) => i.amount < 0);
  const unrecIn = unrecorded.filter((t) => bankNet(t) > 0);
  const unrecOut = unrecorded.filter((t) => bankNet(t) < 0);
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  const sumDeposits = sum(deposits, (i) => i.amount);
  const sumCheques = -sum(cheques, (i) => i.amount);
  const sumUnrecIn = sum(unrecIn, bankNet);
  const sumUnrecOut = -sum(unrecOut, bankNet);
  const stmt = bal ? bal.closing : null;
  const adjBank = stmt === null ? null : stmt + sumDeposits - sumCheques;
  const adjBook = book + sumUnrecIn - sumUnrecOut;
  /* diff = ยอดตามสเตทเมนต์หลังปรับรายการระหว่างทาง − ยอดตามบัญชีที่บันทึกจริง ต้องเป็นศูนย์จึงถือว่ากระทบยอดแล้ว
     รายการที่ธนาคารลงแต่บริษัทยังไม่บันทึก (ดอกเบี้ย ค่าธรรมเนียม) อธิบายผลต่างได้ แต่ต้องบันทึกบัญชีก่อนปิดงวด
     unexplained = ส่วนที่รายการเหล่านั้นก็อธิบายไม่ได้ — สเตทเมนต์ขาดรายการ ยอดที่กรอกผิด หรือบันทึกบัญชีผิด */
  const diff = adjBank === null ? null : adjBank - book;
  const unexplained = adjBank === null ? null : adjBank - adjBook;
  return {
    acc: code, name: a.name, period, from, end, start, beforeStart, bal,
    stmt, stmtEntered: !!(bal && bal.entered), gap: bal ? bal.gap : 0,
    book, deposits, cheques, unrecIn, unrecOut, outstanding, unrecorded,
    sumDeposits, sumCheques, sumUnrecIn, sumUnrecOut, adjBank, adjBook, diff, unexplained,
    /* ต้องเป็นศูนย์ทั้งคู่ — ผลต่างเป็นศูนย์แต่มีรายการค้างบันทึก แปลว่ามีความผิดพลาดอีกจุดที่หักล้างกันพอดี */
    ok: !!start && !beforeStart && !!(bal && bal.entered) && diff === 0 && unexplained === 0,
  };
}

/** บัญชีนี้มีความเคลื่อนไหวในช่วงนี้ไหม (ฝั่งบัญชีหรือฝั่งสเตทเมนต์) */
function bankHasActivity(code, from, end) {
  if (DB.bankTxns.some((t) => t.acc === code && t.date >= from && t.date <= end)) return true;
  return DB.entries.some((e) => LIVE(e) && e.date >= from && e.date <= end && bankEntryNet(e, code) !== 0);
}

/** ข้อตรวจก่อนปิดงวด — ผ่านเมื่อทุกบัญชีเงินฝากที่มีความเคลื่อนไหวในงวด กรอกยอดปลายงวดตามสเตทเมนต์แล้ว และผลต่างเป็นศูนย์ */
function bankCloseItem(period) {
  const from = period + '-01', end = endOfMonth(from);
  const label = 'กระทบยอดเงินฝากธนาคารครบทุกบัญชี';
  const active = bankAccounts().filter((a) => bankHasActivity(a.code, from, end));
  if (!active.length) {
    return { label, ok: true, detail: 'ไม่มีความเคลื่อนไหวในบัญชีเงินฝากธนาคารงวดนี้', blocking: false, action: 'bank' };
  }
  const bad = [], good = [];
  active.forEach(function (a) {
    const r = bankReconcile(a.code, period);
    if (r.beforeStart) { good.push(a.code + ' เริ่มกระทบยอดในระบบตั้งแต่ ' + thPeriod(r.start.slice(0, 7))); return; }
    if (!r.start) { bad.push(a.code + ' ยังไม่มีสเตทเมนต์ — นำเข้าไฟล์หรือกรอกรายการ'); return; }
    const why = [];
    if (!r.stmtEntered) why.push('ยังไม่ได้กรอกยอดคงเหลือปลายงวดตามสเตทเมนต์');
    if (r.unrecorded.length) why.push('รายการในสเตทเมนต์ที่ยังไม่ได้บันทึกบัญชี ' + r.unrecorded.length + ' รายการ');
    if (r.diff !== null && r.diff !== 0) why.push('ผลต่าง ' + fmt(r.diff) + ' บาท');
    if (r.unexplained) why.push('ผลต่างที่หาที่มาไม่ได้ ' + fmt(r.unexplained) + ' บาท');
    if (r.ok) {
      const n = r.outstanding.length;
      good.push(a.code + ' ตรงกัน' + (n ? ' (รายการระหว่างทาง ' + n + ' รายการ)' : ''));
    } else bad.push(a.code + ' ' + (why.join(' · ') || 'ยังไม่ตรงกัน'));
  });
  return { label, ok: !bad.length, detail: bad.length ? 'ค้าง: ' + bad.join(' | ') + (good.length ? ' · เรียบร้อย: ' + good.join(' · ') : '') : good.join(' · '),
    blocking: false, action: 'bank' };
}

/* ---------- จับคู่ ---------- */
function bankTxnFind(id) {
  const t = DB.bankTxns.find((x) => String(x.id) === String(id));
  if (!t) throw new DomainError('TXN_NOT_FOUND', 'ไม่พบรายการเดินบัญชีนี้');
  return t;
}
/** บัญชีเงินฝากของบรรทัดที่ไม่มีบัญชีกำกับ — ดูจากใบสำคัญที่จะจับคู่ ถ้ามีบัญชีเงินฝากบัญชีเดียว */
function bankGuessAcc(t, keys) {
  if (t.acc) return t.acc;
  const e = DB.entries.find((x) => x.no === (keys || [])[0]);
  const codes = e ? e.lines.map((l) => l.acc).filter((c, i, arr) => arr.indexOf(c) === i && acc(c).subType === 'bank') : [];
  t.acc = codes.length === 1 ? codes[0] : accBySub('bank');
  return t.acc;
}
/** จับคู่บรรทัดสเตทเมนต์ (หนึ่งหรือหลายบรรทัด) กับรายการฝั่งบัญชี (หนึ่งหรือหลายใบ) ที่ยอดรวมเท่ากันพอดี */
function bankDoMatch(code, txnIds, keys) {
  const ids = (txnIds || []).map(String).filter((x, i, a) => x && a.indexOf(x) === i);
  const ks = (keys || []).map(String).filter((x, i, a) => x && a.indexOf(x) === i);
  if (!ids.length) throw new DomainError('BANK_MATCH_EMPTY', 'ยังไม่ได้เลือกรายการในสเตทเมนต์');
  const txns = ids.map(bankTxnFind);
  /* รายการที่ธนาคารลงผิดแล้วกลับรายการเองในสเตทเมนต์ (หรือเช็คคืน) หักล้างกันเป็นศูนย์ จับคู่กันเองได้โดยไม่ต้องมีใบสำคัญ */
  const selfOff = !ks.length && txns.length >= 2 && txns.reduce((s, t) => s + bankNet(t), 0) === 0;
  if (!ks.length && !selfOff) {
    throw new DomainError('BANK_MATCH_NO_ITEM', 'ยังไม่ได้เลือกรายการในบัญชีที่จะจับคู่',
      'รายการที่ยังไม่มีในบัญชี ให้กด "บันทึกเข้าบัญชี" แทน ระบบจะลงบัญชีและจับคู่ให้');
  }
  /* ตรวจให้ครบก่อนแตะข้อมูล — ผู้เรียกบางแห่ง (จับคู่ฝั่งปลายทางของการโอน) ดักข้อผิดพลาดแล้วทำงานต่อ */
  txns.forEach(function (t) {
    if (t.matched) throw new DomainError('ALREADY_MATCHED', 'รายการ ' + thDate(t.date) + ' ' + (t.desc || '') + ' จับคู่ไปแล้ว');
    if ((t.acc || code) !== code) throw new DomainError('BANK_MATCH_OTHER_ACCOUNT', 'รายการ ' + (t.desc || t.id) + ' อยู่ในสเตทเมนต์ของบัญชี ' + t.acc);
  });
  const open = new Map(bankBookItems(code, null).map((i) => [i.key, i]));
  const items = ks.map(function (k) {
    const it = open.get(k);
    if (!it) {
      throw new DomainError('BANK_MATCH_ITEM_NOT_FOUND', 'ใบสำคัญ ' + k + ' ไม่มีรายการเข้าออกบัญชี ' + code + ' ที่จับคู่ได้',
        'เลือกใบสำคัญที่ลงบัญชีเงินฝากนี้ และลงวันที่ไม่ก่อนวันเริ่มกระทบยอด');
    }
    if (it.matchId) throw new DomainError('ALREADY_MATCHED', 'ใบสำคัญ ' + k + ' จับคู่กับรายการอื่นในสเตทเมนต์ไปแล้ว');
    return it;
  });
  const sumT = txns.reduce((s, t) => s + bankNet(t), 0);
  const sumB = items.reduce((s, i) => s + i.amount, 0);
  if (sumT !== sumB) {
    throw new DomainError('BANK_MATCH_AMOUNT', 'ยอดไม่เท่ากัน — สเตทเมนต์ ' + fmt(sumT) + ' บาท บัญชี ' + fmt(sumB) + ' บาท ต่างกัน ' + fmt(sumT - sumB) + ' บาท',
      'เลือกรายการให้ยอดรวมเท่ากันพอดี ส่วนต่างเช่นค่าธรรมเนียมที่ธนาคารหัก ให้บันทึกเป็นรายการแยกก่อน');
  }
  const mid = DB.bankTxns.reduce((m, t) => Math.max(m, Number(t.matchId) || 0), 0) + 1;
  txns.forEach(function (t) {
    t.acc = code;
    t.matched = true; t.items = ks.slice(); t.matchId = mid;
    t.matchedTo = ks.length ? ks.join(', ') : 'หักล้างกันในสเตทเมนต์';
  });
  audit('bank_txn', ids.join(','), 'match', null, { acc: code, to: ks.join(', '), amount: fmt(sumT) });
  return { matchId: mid, txns, keys: ks, amount: sumT };
}
function matchBank(code, txnIds, keys) {
  bankAccCheck(code);
  return bankDoMatch(code, txnIds, keys);
}
/** รูปแบบเดิม: จับคู่บรรทัดเดียวกับใบสำคัญใบเดียว */
function matchBankTxn(id, entryNo) {
  const t = bankTxnFind(id);
  if (!entryNo) {
    throw new DomainError('BANK_MATCH_NO_ITEM', 'ต้องเลือกใบสำคัญที่ตรงกับรายการนี้',
      'ทำเครื่องหมายว่าตรงโดยไม่มีใบสำคัญรองรับไม่ได้ ผลต่างจะซ่อนอยู่ในงบกระทบยอด');
  }
  const code = bankGuessAcc(t, [entryNo]);
  bankDoMatch(code, [t.id], [entryNo]);
  return t;
}
function bankUnmatchGroup(matchId) {
  const list = DB.bankTxns.filter((t) => t.matched && String(t.matchId) === String(matchId));
  list.forEach(function (t) { t.matched = false; t.items = []; t.matchedTo = null; t.matchId = null; });
  return list;
}
function unmatchBank(matchId) {
  const list = bankUnmatchGroup(matchId);
  if (!list.length) throw new DomainError('BANK_MATCH_NOT_FOUND', 'ไม่พบการจับคู่นี้ อาจยกเลิกไปแล้ว');
  audit('bank_txn', list.map((t) => t.id).join(','), 'unmatch', null, null);
  return list;
}
/** ใบสำคัญถูกกลับรายการ — กลุ่มที่จับคู่กับใบนั้นต้องกลับไปรอกระทบยอดใหม่ทั้งกลุ่ม
    ไม่งั้นเงินในธนาคารจะดูเหมือนมีเอกสารรองรับ ทั้งที่เอกสารถูกยกเลิกไปแล้ว */
function bankUnmatchEntry(no) {
  const gids = [];
  DB.bankTxns.forEach(function (t) {
    if (!t.matched) return;
    if ((t.items || []).indexOf(no) >= 0 || t.matchedTo === no) {
      if (t.matchId) { if (gids.indexOf(t.matchId) < 0) gids.push(t.matchId); }
      else { t.matched = false; t.items = []; t.matchedTo = null; }
    }
  });
  gids.forEach(bankUnmatchGroup);
}
/** ใบสำคัญที่บันทึกจากหน้ากระทบยอดถูกเปลี่ยนเลขที่ (ซ่อมเลขซ้ำของข้อมูลเก่า) */
function bankRenameEntry(txnId, oldNo, newNo) {
  DB.bankTxns.forEach(function (t) {
    if (String(t.id) !== String(txnId)) return;
    if (t.matchedTo === oldNo) t.matchedTo = newNo;
    if (Array.isArray(t.items)) {
      t.items = t.items.map((k) => (k === oldNo ? newNo : k));
      if (t.items.length) t.matchedTo = t.items.join(', ');
    }
  });
}

/**
 * รายการในบัญชีที่น่าจะตรงกับบรรทัดสเตทเมนต์นี้ — ยอดเท่ากัน ยังไม่จับคู่ เรียงจากวันที่ใกล้ที่สุด
 * open: รายการฝั่งบัญชีที่ยังไม่จับคู่ (ส่งมาเมื่อเรียกหลายบรรทัดติดกัน จะได้ไม่ต้องคำนวณซ้ำ)
 */
function bankSuggest(t, open, limit) {
  const list = open || bankBookItems(t.acc, null).filter((i) => !i.matchId);
  const amt = bankNet(t);
  const day = (d) => Math.round((Date.parse(d) - Date.parse(t.date)) / 86400000);
  const words = String((t.ref || '') + ' ' + (t.desc || '')).toUpperCase().split(/[^A-Z0-9ก-๙]+/).filter((w) => w.length >= 4);
  return list.filter((i) => i.amount === amt && Math.abs(day(i.date)) <= 60)
    .map(function (i) {
      const text = String(i.desc + ' ' + i.ref + ' ' + i.key).toUpperCase();
      const hitRef = words.some((w) => text.indexOf(w) >= 0);
      return Object.assign({}, i, { days: day(i.date), score: Math.abs(day(i.date)) - (hitRef ? 30 : 0) });
    })
    .sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : 1))
    .slice(0, limit || 5);
}

/** จับคู่อัตโนมัติ — เฉพาะคู่ที่ยอดเท่ากันพอดี ห่างกันไม่เกิน 7 วัน และไม่มีตัวเลือกอื่นที่ยอดเดียวกันทั้งสองฝั่ง
    คู่ที่กำกวม (ยอดซ้ำกันหลายรายการ) ปล่อยให้ผู้ใช้เลือกเอง เดาผิดแล้วงบกระทบยอดจะตรงแบบผิด ๆ */
function bankAutoMatch(code, upto) {
  bankAccCheck(code);
  const open = bankBookItems(code, null).filter((i) => !i.matchId);
  const txns = DB.bankTxns.filter((t) => t.acc === code && !t.matched && (!upto || t.date <= upto)).slice().sort(bankSortLines);
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 7 * 86400000;
  const used = new Set();
  let n = 0;
  txns.forEach(function (t) {
    const amt = bankNet(t);
    const cand = open.filter((i) => !used.has(i.key) && i.amount === amt && near(i.date, t.date));
    let pick = cand.length === 1 ? cand[0] : null;
    if (!pick && cand.length > 1) {
      const same = cand.filter((i) => i.date === t.date);
      if (same.length === 1) pick = same[0];
    }
    if (!pick) return;
    const rivals = txns.filter((x) => x !== t && !x.matched && bankNet(x) === amt && near(x.date, pick.date)
      && (cand.length === 1 || x.date === pick.date));
    if (rivals.length) return;
    bankDoMatch(code, [t.id], [pick.key]);
    used.add(pick.key);
    n++;
  });
  return { matched: n, left: txns.filter((t) => !t.matched).length };
}

/* ---------- บันทึกรายการจากสเตทเมนต์ที่ยังไม่มีในบัญชี ---------- */
/**
 * opts: { account, desc, date, wht } — account คือบัญชีคู่ เช่น ดอกเบี้ยรับ ค่าธรรมเนียมธนาคาร
 * ถ้าบัญชีคู่เป็นเงินสด/เงินฝากอีกบัญชี ถือเป็นการโอนระหว่างบัญชีของบริษัท ลงสมุดรายวันทั่วไป
 * และถ้าสเตทเมนต์ของบัญชีปลายทางมีรายการฝั่งตรงข้ามยอดเดียวกันในช่วง 5 วัน ระบบจับคู่ให้ด้วย
 * รูปแบบเดิม bookBankTxn(id, accountCode, desc) ยังใช้ได้
 */
function bookBankTxn(id, opts, descArg) {
  if (typeof opts === 'string') opts = { account: opts, desc: descArg };
  opts = opts || {};
  const t = bankTxnFind(id);
  if (t.matched) throw new DomainError('ALREADY_MATCHED', 'รายการนี้จับคู่แล้ว');
  if (!t.acc) t.acc = accBySub('bank');
  const code = t.acc;
  const counter = String(opts.account || '').trim();
  if (!counter) throw new DomainError('ACCOUNT_REQUIRED', 'ต้องเลือกบัญชีคู่ที่จะบันทึก');
  const ca = acc(counter);
  if (counter === code) throw new DomainError('BANK_BOOK_SAME_ACCOUNT', 'บัญชีคู่ต้องไม่ใช่บัญชีเงินฝากเดียวกัน');
  if (CONTROL_SUBS[ca.subType]) {
    throw new DomainError('CONTROL_ACCOUNT_MANUAL', 'บัญชี ' + ca.code + ' ' + ca.name + ' เป็นบัญชีคุม บันทึกจากหน้ากระทบยอดไม่ได้',
      CONTROL_SUBS[ca.subType] + ' — ทำเอกสารนั้นก่อน แล้วกลับมาจับคู่กับรายการในสเตทเมนต์');
  }
  const deposit = bankNet(t) > 0;
  const amount = Math.abs(bankNet(t));
  const transfer = CASH_SUB.indexOf(ca.subType) >= 0;
  const whtText = opts.wht === undefined || opts.wht === null || String(opts.wht).trim() === '' ? '0' : parseAmount(opts.wht);
  if (whtText === null) throw new DomainError('AMOUNT_INVALID', 'ภาษีถูกหัก ณ ที่จ่ายอ่านไม่ออก: ' + opts.wht);
  const wht = satangOf(whtText);
  if (wht < 0) throw new DomainError('LINE_NEGATIVE', 'ภาษีถูกหัก ณ ที่จ่ายติดลบไม่ได้');
  if (wht && (!deposit || transfer)) {
    throw new DomainError('BANK_WHT_DEPOSIT_ONLY', 'ภาษีถูกหัก ณ ที่จ่ายใส่ได้เฉพาะเงินเข้าที่ไม่ใช่การโอนระหว่างบัญชี',
      'เช่น ดอกเบี้ยรับที่ธนาคารหักภาษีไว้ 1%');
  }
  const date = opts.date || t.date;
  const desc = String(opts.desc || '').trim() || t.desc || 'รายการจากสเตทเมนต์';
  const lines = deposit
    ? [{ acc: code, dr: amount }].concat(wht ? [{ acc: ensureAccount('wht_asset', '1165', 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', 'asset'), dr: wht }] : [])
      .concat([{ acc: counter, cr: amount + wht }])
    : [{ acc: counter, dr: amount }, { acc: code, cr: amount }];
  const je = post({
    type: transfer ? 'general' : deposit ? 'receipt' : 'payment',
    date, desc, src: 'bank', srcId: String(t.id), lines,
  });
  bankDoMatch(code, [t.id], [je.no]);
  let mate = null;
  if (transfer && ca.subType === 'bank') {
    const want = -bankNet(t);
    mate = DB.bankTxns.filter((x) => x.acc === counter && !x.matched && bankNet(x) === want
      && Math.abs(Date.parse(x.date) - Date.parse(t.date)) <= 5 * 86400000)
      .sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(t.date)) - Math.abs(Date.parse(b.date) - Date.parse(t.date)))[0] || null;
    /* จับคู่ฝั่งปลายทางเป็นของแถม — ถ้าจับไม่ได้ (เช่น ใบสำคัญลงก่อนวันเริ่มกระทบยอดของบัญชีนั้น) ปล่อยให้ผู้ใช้จับเองทีหลัง
       bankDoMatch ตรวจครบก่อนแตะข้อมูล การล้มตรงนี้จึงไม่ทิ้งอะไรค้าง */
    if (mate) { try { bankDoMatch(counter, [mate.id], [je.no]); } catch (e) { mate = null; } }
  }
  audit('bank_txn', String(t.id), 'book', null, { entry: je.no, account: counter });
  return je;
}

/* ---------- บรรทัดสเตทเมนต์ ---------- */
function bankCleanLine(code, l, i) {
  const where = l.line ? 'แถว ' + l.line : 'บรรทัดที่ ' + (i + 1);
  const date = String(l.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date + 'T00:00:00Z'))) {
    throw new DomainError('BANK_LINE_DATE', where + ': วันที่ไม่ถูกต้อง', 'ใช้วันที่ตามสเตทเมนต์ เช่น 15/07/2569');
  }
  periodFor(date);
  /* อ่านแบบเดียวกับไฟล์นำเข้า — "1,000.00" "(500)" ได้ตรง ข้อความที่อ่านไม่ออกต้องแจ้ง ไม่ใช่กลายเป็นศูนย์เงียบ ๆ */
  const amt = function (v) {
    if (typeof v === 'number') return v;
    const s = parseAmount(v);
    if (s === null) throw new DomainError('AMOUNT_INVALID', where + ': จำนวนเงินอ่านไม่ออก "' + v + '"');
    return satangOf(s);
  };
  const debit = Math.abs(amt(l.debit)), credit = Math.abs(amt(l.credit));
  if ((debit > 0) === (credit > 0)) {
    throw new DomainError('BANK_LINE_AMOUNT', where + ': ต้องมีจำนวนเงินถอนหรือฝากอย่างใดอย่างหนึ่ง',
      'ถอน = เงินออกจากบัญชี · ฝาก = เงินเข้าบัญชี');
  }
  const bal = l.balance === undefined || l.balance === null || l.balance === '' ? null : amt(l.balance);
  return { acc: code, date, desc: String(l.desc || '').trim() || (credit ? 'เงินเข้า' : 'เงินออก'),
    ref: String(l.ref || '').trim(), debit, credit, balance: bal };
}
function bankPushLines(code, list, meta) {
  let id = bankNextId(DB.bankTxns);
  const made = list.map(function (l) {
    const t = Object.assign(l, { id: id++, matched: false, items: [], matchedTo: null, matchId: null,
      src: (meta && meta.src) || 'manual', importId: (meta && meta.importId) || null });
    DB.bankTxns.push(t);
    bankStmtEnsure(code, periodOf(t.date));
    return t;
  });
  return made;
}
/** กรอกรายการจากสเตทเมนต์เอง (กรณีได้สเตทเมนต์เป็นกระดาษ) */
function addBankLines(code, lines) {
  bankAccCheck(code);
  const clean = (lines || []).map((l, i) => bankCleanLine(code, l, i));
  if (!clean.length) throw new DomainError('BANK_LINES_EMPTY', 'ยังไม่ได้กรอกรายการ', 'กรอกวันที่และจำนวนเงินถอนหรือฝากอย่างน้อยหนึ่งบรรทัด');
  const made = bankPushLines(code, clean, { src: 'manual' });
  audit('bank_txn', code, 'add', null, { count: made.length });
  return made;
}
function deleteBankLine(id) {
  const t = bankTxnFind(id);
  if (t.matched) throw new DomainError('BANK_LINE_MATCHED', 'รายการนี้จับคู่แล้ว ลบไม่ได้', 'ยกเลิกการจับคู่ก่อน');
  DB.bankTxns.splice(DB.bankTxns.indexOf(t), 1);
  audit('bank_txn', String(t.id), 'delete', { date: t.date, desc: t.desc, amount: fmt(bankNet(t)) }, null);
  return t;
}

/** กรอกยอดยกมา/ยอดคงเหลือปลายงวดตามสเตทเมนต์ — ช่องว่างคือไม่ระบุ (ให้ระบบคำนวณ) */
function setBankStatement(input) {
  const code = input.acc;
  bankAccCheck(code);
  const period = String(input.period || '');
  if (!/^\d{4}-\d{2}$/.test(period)) throw new DomainError('PERIOD_INVALID', 'งวดไม่ถูกต้อง');
  const num = function (v, label) {
    if (v === undefined || v === null || String(v).trim() === '') return null;
    if (typeof v === 'number') return v;
    const s = parseAmount(v);
    if (s === null) throw new DomainError('AMOUNT_INVALID', label + 'อ่านไม่ออก: ' + v);
    return satangOf(s);
  };
  const r = bankStmtEnsure(code, period);
  const before = { opening: r.opening, closing: r.closing };
  if ('opening' in input) r.opening = num(input.opening, 'ยอดยกมา');
  if ('closing' in input) r.closing = num(input.closing, 'ยอดคงเหลือปลายงวด');
  audit('bank_statement', code + '|' + period, 'set',
    { opening: before.opening === null ? null : fmt(before.opening), closing: before.closing === null ? null : fmt(before.closing) },
    { opening: r.opening === null ? null : fmt(r.opening), closing: r.closing === null ? null : fmt(r.closing) });
  return r;
}

/* ---------- รายการค้างก่อนเริ่มกระทบยอด ---------- */
/** เช็คที่จ่ายไปก่อนวันเริ่มแต่ธนาคารยังไม่ตัด หรือเงินฝากที่ธนาคารยังไม่เข้า ณ วันเริ่ม
    เลือกจากใบสำคัญที่มีอยู่ (entryNo) หรือกรอกเอง (รายการจากระบบเดิม) */
function addBankBf(input) {
  const code = input.acc;
  bankAccCheck(code);
  const start = bankStartDate(code);
  const rec = { id: bankNextId(DB.bankBf), acc: code };
  if (input.entryNo) {
    const e = DB.entries.find((x) => x.no === input.entryNo);
    if (!e || !LIVE(e)) throw new DomainError('ENTRY_NOT_FOUND', 'ไม่พบใบสำคัญ ' + input.entryNo);
    const amount = bankEntryNet(e, code);
    if (!amount) throw new DomainError('BANK_BF_NOT_ON_ACCOUNT', 'ใบสำคัญ ' + e.no + ' ไม่มีรายการเข้าออกบัญชี ' + code);
    if (start && e.date >= start) {
      throw new DomainError('BANK_BF_AFTER_START', 'ใบสำคัญ ' + e.no + ' ลงวันที่หลังวันเริ่มกระทบยอด อยู่ในรายการค้างอยู่แล้ว');
    }
    if (DB.bankBf.some((b) => b.acc === code && b.entryNo === e.no)) {
      throw new DomainError('BANK_BF_DUPLICATE', 'ใบสำคัญ ' + e.no + ' อยู่ในรายการค้างยกมาแล้ว');
    }
    Object.assign(rec, { date: e.date, desc: e.desc, ref: e.srcId || '', amount, entryNo: e.no });
  } else {
    const date = String(input.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่ของเช็คหรือเงินฝาก');
    const desc = String(input.desc || '').trim();
    if (!desc) throw new DomainError('DESC_REQUIRED', 'ต้องมีคำอธิบาย', 'เช่น เช็คเลขที่ 1234567 จ่ายบริษัท ก.');
    const amt = M(String(input.amount || '').replace(/,/g, ''));
    if (amt <= 0) throw new DomainError('AMOUNT_INVALID', 'จำนวนเงินต้องมากกว่าศูนย์');
    const kind = input.kind === 'deposit' ? 'deposit' : 'cheque';
    Object.assign(rec, { date, desc, ref: String(input.ref || '').trim(), amount: kind === 'deposit' ? amt : -amt, entryNo: null });
  }
  DB.bankBf.push(rec);
  audit('bank_bf', code + '|' + rec.id, 'add', null, { desc: rec.desc, amount: fmt(rec.amount) });
  return rec;
}
function deleteBankBf(id) {
  const b = DB.bankBf.find((x) => String(x.id) === String(id));
  if (!b) throw new DomainError('BANK_BF_NOT_FOUND', 'ไม่พบรายการค้างยกมานี้');
  const key = b.entryNo || ('BF-' + b.id);
  if (bankMatchedKeys(b.acc).has(key)) throw new DomainError('BANK_LINE_MATCHED', 'รายการนี้จับคู่กับสเตทเมนต์แล้ว ลบไม่ได้', 'ยกเลิกการจับคู่ก่อน');
  DB.bankBf.splice(DB.bankBf.indexOf(b), 1);
  audit('bank_bf', b.acc + '|' + b.id, 'delete', { desc: b.desc, amount: fmt(b.amount) }, null);
  return b;
}

/* ===================================================================
   อ่านไฟล์สเตทเมนต์ (.csv / .xlsx) — ใช้ตัวอ่านไฟล์และตัวเลขชุดเดียวกับหน้านำเข้า (import.js)
   =================================================================== */
const BANK_COL_HINTS = {
  date:    ['วันที่ทำรายการ', 'วันที่รายการ', 'วันที่', 'วัน/เวลา', 'วันเวลา', 'transaction date', 'trans date', 'txn date', 'posting date', 'date'],
  vdate:   ['วันที่มีผล', 'value date', 'effective date'],
  desc:    ['รายละเอียด', 'คำอธิบาย', 'รายการ', 'description', 'details', 'particulars', 'narrative', 'transaction', 'memo'],
  debit:   ['ถอนเงิน', 'ถอน', 'เงินออก', 'จ่ายออก', 'ยอดถอน', 'withdrawal', 'withdrawals', 'withdraw', 'debit', 'เดบิต', 'paid out', 'money out', 'dr'],
  credit:  ['ฝากเงิน', 'ฝาก', 'เงินเข้า', 'รับเข้า', 'ยอดฝาก', 'deposit', 'deposits', 'credit', 'เครดิต', 'paid in', 'money in', 'cr'],
  balance: ['ยอดเงินคงเหลือ', 'ยอดคงเหลือ', 'คงเหลือ', 'balance', 'ledger balance', 'running balance'],
  amount:  ['จำนวนเงิน', 'ยอดเงิน', 'amount'],
  ref:     ['เลขที่อ้างอิง', 'อ้างอิง', 'เลขที่เช็ค', 'เลขที่เอกสาร', 'reference', 'ref no', 'ref', 'cheque no', 'chq no', 'cheque', 'เช็ค'],
  channel: ['ช่องทาง', 'channel'],
};
const BANK_ROLE_TH = { date:'วันที่', desc:'รายการ', debit:'ถอน', credit:'ฝาก', balance:'คงเหลือ', amount:'จำนวนเงิน (+ฝาก/−ถอน)', ref:'อ้างอิง', channel:'ช่องทาง' };
/** คะแนนว่าข้อความหัวคอลัมน์เป็นบทบาทใด — ตรงทั้งคำ 3 · ขึ้นต้นด้วย 2 · มีคำนี้อยู่ 1 · คำสั้น (dr cr ref) ต้องตรงทั้งคำ
    คำว่าถอน/ฝากอยู่ตรงไหนของหัวก็ชี้ขาด — "จำนวนเงินฝาก" คือช่องฝาก ไม่ใช่จำนวนเงินคอลัมน์เดียว */
function bankRoleOf(text) {
  const n = norm(text);
  if (!n) return null;
  let best = null;
  Object.keys(BANK_COL_HINTS).forEach(function (role) {
    BANK_COL_HINTS[role].forEach(function (h, hi) {
      const k = norm(h);
      const at = n.indexOf(k);
      let s = n === k ? 3 : k.length <= 3 ? 0 : at === 0 ? 2 : at > 0 ? 1 : 0;
      if (s && s < 3 && (role === 'debit' || role === 'credit')) s = 2.5;
      if (!s) return;
      const score = s * 100 - hi;
      if (!best || score > best.score) best = { role, score };
    });
  });
  return best;
}
/** หาแถวหัวตารางและคอลัมน์ — ต้องมีวันที่ และมีถอน/ฝาก หรือจำนวนเงินคอลัมน์เดียว
    ไฟล์ที่มีคอลัมน์รายการสองช่อง (เช่น "รายการ" กับ "รายละเอียด") ต่อข้อความสองช่องเข้าด้วยกัน */
function detectBankColumns(rows) {
  let best = null;
  rows.slice(0, 30).forEach(function (r, ri) {
    const cands = [];
    r.forEach(function (c, ci) { const b = bankRoleOf(cellText(c)); if (b) cands.push({ ci, role: b.role, score: b.score }); });
    cands.sort((a, b) => b.score - a.score);
    const map = {};
    const taken = (ci) => Object.keys(map).some((k) => map[k] === ci);
    cands.forEach(function (x) { if (map[x.role] === undefined && !taken(x.ci)) map[x.role] = x.ci; });
    cands.forEach(function (x) { if (x.role === 'desc' && map.desc2 === undefined && !taken(x.ci)) map.desc2 = x.ci; });
    const ok = map.date !== undefined && (map.debit !== undefined || map.credit !== undefined || map.amount !== undefined);
    const n = Object.keys(map).length + (ok ? 10 : 0);
    if (!best || n > best.n) best = { n, ok, map, headerRow: ri };
  });
  if (!best || !best.ok) return { ok: false, map: best ? best.map : {}, headerRow: best ? best.headerRow : 0 };
  delete best.map.vdate;
  if (best.map.desc2 !== undefined && best.map.desc2 < best.map.desc) {
    const d = best.map.desc; best.map.desc = best.map.desc2; best.map.desc2 = d;
  }
  return { ok: true, map: best.map, headerRow: best.headerRow };
}
/** วันที่ในสเตทเมนต์: 15/07/2569 · 15/07/2026 · 15/07/69 · 2026-07-15 · 15 ก.ค. 2569 · 15-Jul-26 · เลขวันที่ของ Excel
    order 'mdy' เมื่อไฟล์เขียนเดือนก่อนวัน (ดูจากทั้งไฟล์ ไม่ใช่ทีละแถว) */
function bankParseDate(s, order) {
  const t = cellText(s).replace(/T\d{2}:\d{2}.*$/, '').replace(/\s+\d{1,2}[:.]\d{2}([:.]\d{2})?.*$/, '');
  if (!t) return null;
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const n = Math.floor(Number(t));
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  let m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) return ymd(m[1], m[2], m[3]);
  m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (m) return order === 'mdy' ? ymd(m[3], m[1], m[2]) : ymd(m[3], m[2], m[1]);
  m = t.toLowerCase().match(/^(\d{1,2})[\s\-\/]*([^\d\s\-\/]+)[\s\-\/]*(\d{2,4})$/);
  if (m) {
    const w = m[2].replace(/\.$/, '');
    const mi = TH_MONTH_WORDS.findIndex((ws) => ws.some((x) => x.replace(/\.$/, '') === w));
    if (mi >= 0) return ymd(m[3], mi + 1, m[1]);
  }
  return null;
}
const BANK_OPEN_ROW = /ยอดยกมา|ยกมา|ยอดคงเหลือต้นงวด|brought\s*forward|opening\s*balance|beginning\s*balance|balance\s*b\/?f|previous\s*balance/i;
const BANK_CLOSE_ROW = /ยอดยกไป|ยกไป|ยอดคงเหลือปลายงวด|carried\s*forward|closing\s*balance|ending\s*balance|balance\s*c\/?f/i;
const BANK_TOTAL_ROW = /^(รวม|ยอดรวม|total|sub\s*-?\s*total|grand\s*total)/i;

/**
 * อ่านแถวจากไฟล์เป็นรายการสเตทเมนต์ — ยังไม่เขียนอะไรลงระบบ
 * คืน { ok, map, headerRow, lines:[{line,date,desc,ref,debit,credit,balance}], skipped:[{line,why,bad}], opening, closing, dates, reversed }
 */
function readBankStatement(rows, opt) {
  opt = opt || {};
  const det = opt.map ? { ok: opt.map.date !== undefined, map: opt.map, headerRow: opt.headerRow || 0 } : detectBankColumns(rows);
  const out = { ok: det.ok, map: det.map, headerRow: det.headerRow, lines: [], skipped: [], opening: null, closing: null, dates: null, reversed: false };
  if (!det.ok) return out;
  const map = det.map;
  const body = rows.slice(det.headerRow + 1);
  /* วัน/เดือน หรือ เดือน/วัน — ตัดสินจากทั้งไฟล์ เลขหน้าเกิน 12 แปลว่าวันมาก่อน เลขกลางเกิน 12 แปลว่าเดือนมาก่อน */
  let order = 'dmy';
  body.forEach(function (r) {
    const m = cellText(r[map.date]).match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/);
    if (m && Number(m[2]) > 12 && Number(m[1]) <= 12) order = 'mdy';
  });
  const money = (v) => { const s = parseAmount(v); return s === null ? null : satangOf(s); };
  const line = (r, i) => r.line || det.headerRow + 2 + i;
  body.forEach(function (r, i) {
    const texts = r.map(cellText);
    if (!texts.some((x) => x !== '')) return;
    const part = (k) => (map[k] !== undefined ? cellText(r[map[k]]) : '');
    const desc = [part('desc'), part('desc2'), part('channel')].filter(Boolean).join(' · ');
    const label = desc || texts.filter((x, ci) => ci !== map.date && !/^[\d,.\-()\s]+$/.test(x)).join(' ');
    const bal = part('balance') !== '' ? money(r[map.balance]) : null;
    const date = bankParseDate(r[map.date], order);
    const noAmount = !(part('debit') || part('credit') || part('amount'));
    /* แถวยอดยกมา/ยอดยกไป/รวม ไม่ใช่รายการ แต่ยอดคงเหลือในแถวนั้นใช้ตั้งยอดยกมาและยอดปลายงวดได้
       แถวที่มีวันที่และจำนวนเงินถือเป็นรายการเสมอ แม้คำอธิบายจะมีคำว่า "ยกมา" */
    if (BANK_OPEN_ROW.test(label) && (noAmount || !date)) {
      if (bal !== null && !out.opening) out.opening = { amount: bal, date, line: line(r, i) };
      out.skipped.push({ line: line(r, i), why: 'แถวยอดยกมา' });
      return;
    }
    if ((BANK_CLOSE_ROW.test(label) && (noAmount || !date)) || (!date && (BANK_TOTAL_ROW.test(part('date')) || BANK_TOTAL_ROW.test(label)))) {
      if (BANK_CLOSE_ROW.test(label) && bal !== null) out.closing = { amount: bal, line: line(r, i) };
      out.skipped.push({ line: line(r, i), why: 'แถวสรุปยอด' });
      return;
    }
    const hd = bankRoleOf(part('date'));
    if (!date && hd && hd.role === 'date' && hd.score >= 200) {
      out.skipped.push({ line: line(r, i), why: 'หัวตารางซ้ำ' });
      return;
    }
    let debit = 0, credit = 0;
    if (map.debit === undefined && map.credit === undefined) {
      const v = money(r[map.amount]);
      if (v === null) { out.skipped.push({ line: line(r, i), why: 'จำนวนเงินอ่านไม่ออก', bad: true }); return; }
      if (v < 0) debit = -v; else credit = v;
    } else {
      const d = map.debit !== undefined ? money(r[map.debit]) : 0;
      const c = map.credit !== undefined ? money(r[map.credit]) : 0;
      if (d === null || c === null) { out.skipped.push({ line: line(r, i), why: 'จำนวนเงินอ่านไม่ออก', bad: true }); return; }
      debit = Math.abs(d); credit = Math.abs(c);
    }
    if (!date) {
      if (debit || credit) out.skipped.push({ line: line(r, i), why: 'อ่านวันที่ไม่ออก: ' + (cellText(r[map.date]) || 'ว่าง'), bad: true });
      else out.skipped.push({ line: line(r, i), why: 'ไม่ใช่รายการ' });
      return;
    }
    if (!debit && !credit) { out.skipped.push({ line: line(r, i), why: 'ไม่มีจำนวนเงิน' }); return; }
    if (debit && credit) { out.skipped.push({ line: line(r, i), why: 'มีทั้งถอนและฝากในแถวเดียว', bad: true }); return; }
    out.lines.push({ line: line(r, i), date, desc: desc || label, ref: map.ref !== undefined ? cellText(r[map.ref]) : '',
      debit, credit, balance: bal });
  });
  /* บางธนาคารเรียงรายการใหม่สุดไว้บนสุด — กลับให้เรียงจากเก่าไปใหม่ ยอดคงเหลือจะได้ต่อกัน */
  if (out.lines.length > 1 && out.lines[0].date > out.lines[out.lines.length - 1].date) {
    out.lines.reverse();
    out.reversed = true;
  }
  out.dates = readFileDates(rows, det.headerRow);
  return out;
}
/** ลายนิ้วมือของบรรทัด ใช้กันนำเข้าซ้ำ — ยอดคงเหลือแยกรายการหน้าตาเหมือนกันในวันเดียวกันออกจากกันได้ */
const bankLineKey = (l) => [l.date, l.debit, l.credit, l.balance === null || l.balance === undefined ? '' : l.balance,
  norm(l.desc), norm(l.ref)].join('|');

/**
 * นำเข้าสเตทเมนต์เข้าบัญชีเงินฝาก — กันซ้ำทีละบรรทัด (ไฟล์ที่ซ้อนช่วงวันที่กับไฟล์เดิม นำเข้าเฉพาะส่วนที่ใหม่)
 * ทั้งไฟล์ซ้ำ → ปฏิเสธ · ไฟล์ตรงกับสเตทเมนต์ของบัญชีอื่น → ปฏิเสธ (มักเลือกบัญชีผิด)
 * ยอดคงเหลือในไฟล์ใช้ตั้งยอดยกมาของงวดแรก และยอดปลายงวดของเดือนที่ไฟล์ครอบคลุมครบทั้งเดือน
 */
function importBankStatement(code, rows, opts) {
  opts = opts || {};
  bankAccCheck(code);
  const st = readBankStatement(rows, opts);
  if (!st.ok) {
    throw new DomainError('BANK_IMPORT_COLUMNS', 'หาคอลัมน์วันที่และจำนวนเงินในไฟล์ไม่เจอ',
      'เลือกคอลัมน์เองในหน้าต่างนำเข้า หรือใช้ไฟล์ที่มีหัวตาราง วันที่ / รายการ / ถอน / ฝาก / คงเหลือ');
  }
  const bad = st.skipped.filter((s) => s.bad);
  if (!st.lines.length) {
    throw new DomainError('BANK_IMPORT_EMPTY', 'ไม่พบรายการเดินบัญชีในไฟล์',
      bad.length ? 'อ่านไม่ออก ' + bad.length + ' แถว เช่น แถว ' + bad[0].line + ' ' + bad[0].why : 'ตรวจว่าเลือกไฟล์สเตทเมนต์ที่ถูกต้อง');
  }
  const inPeriod = [], outside = [];
  st.lines.forEach(function (l) {
    try { periodFor(l.date); inPeriod.push(l); } catch (e) { outside.push(l); }
  });
  const count = (list) => { const m = {}; list.forEach((t) => { const k = bankLineKey(t); m[k] = (m[k] || 0) + 1; }); return m; };
  const have = count(DB.bankTxns.filter((t) => t.acc === code));
  const seen = {};
  const fresh = [], dup = [];
  inPeriod.forEach(function (l) {
    const k = bankLineKey(l);
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] <= (have[k] || 0)) dup.push(l); else fresh.push(l);
  });
  if (!fresh.length) {
    throw new DomainError('BANK_IMPORT_DUPLICATE',
      outside.length && !dup.length ? 'ทุกรายการในไฟล์อยู่นอกรอบบัญชีที่เปิดไว้' : 'ไฟล์นี้นำเข้าไปแล้วทุกรายการ (' + dup.length + ' รายการ)',
      outside.length && !dup.length ? 'ตรวจวันที่ในไฟล์ หรือสร้างรอบบัญชีของปีนั้นก่อน' : 'ไม่ต้องนำเข้าซ้ำ ถ้าตั้งใจนำเข้าใหม่ ให้ยกเลิกการนำเข้าครั้งก่อนในหน้ากระทบยอดก่อน');
  }
  bankAccounts().forEach(function (o) {
    if (o.code === code) return;
    const other = count(DB.bankTxns.filter((t) => t.acc === o.code));
    const same = fresh.filter((l) => other[bankLineKey(l)]).length;
    if (same >= 3 && same * 2 >= fresh.length) {
      throw new DomainError('BANK_IMPORT_OTHER_ACCOUNT', 'รายการในไฟล์นี้ตรงกับสเตทเมนต์ของบัญชี ' + o.code + ' ที่นำเข้าไว้แล้ว ' + same + ' รายการ',
        'ตรวจว่าเลือกบัญชีเงินฝากถูก ถ้านำเข้าผิดบัญชีไว้ ให้ยกเลิกการนำเข้าครั้งนั้นก่อน');
    }
  });
  const imp = { id: bankNextId(DB.bankImports), acc: code, name: String(opts.name || 'ไฟล์สเตทเมนต์'), at: new Date().toISOString(),
    from: fresh[0].date, to: fresh[fresh.length - 1].date, added: fresh.length, duplicates: dup.length,
    skipped: st.skipped.length + outside.length, set: [] };
  bankPushLines(code, fresh.map((l) => ({ acc: code, date: l.date, desc: l.desc, ref: l.ref, debit: l.debit, credit: l.credit, balance: l.balance })),
    { src: 'import', importId: imp.id });

  const warnings = [];
  /* ยอดคงเหลือต่อเนื่องไหม — ไม่ต่อแปลว่าไฟล์ขาดบางหน้าหรือเรียงผิด */
  let breaks = 0, prev = null;
  st.lines.forEach(function (l) {
    if (l.balance === null) return;
    if (prev && prev.balance + bankNet(l) !== l.balance) breaks++;
    prev = l;
  });
  if (breaks) warnings.push('ยอดคงเหลือในไฟล์ไม่ต่อเนื่อง ' + breaks + ' จุด — ไฟล์อาจไม่ครบทุกหน้า');
  /* ยอดยกมาของงวดแรกในไฟล์ — ใช้แถว "ยอดยกมา" ถ้ามี ไม่งั้นคำนวณย้อนจากยอดคงเหลือของบรรทัดแรก
     ตั้งให้เฉพาะเมื่อไฟล์เริ่มต้นเดือน (หัวไฟล์ระบุวันเริ่ม หรือรายการแรกอยู่ใน 10 วันแรก)
     ไฟล์ที่เริ่มกลางเดือน ยอดก่อนรายการแรกไม่ใช่ยอดยกมาของเดือน */
  const firstP = periodOf(inPeriod[0].date);
  const firstBal = inPeriod.find((l) => l.balance !== null);
  let opening = st.opening && st.opening.amount !== null ? st.opening.amount : null;
  if (opening === null && firstBal) {
    let run = 0;
    for (let i = 0; i < inPeriod.length; i++) { run += bankNet(inPeriod[i]); if (inPeriod[i] === firstBal) break; }
    opening = firstBal.balance - run;
  }
  const startsMonth = st.dates && st.dates.from ? st.dates.from <= firstP + '-01' : !!st.opening || inPeriod[0].date.slice(8) <= '10';
  const r0 = bankStmtEnsure(code, firstP);
  const prevRec = bankStmtRec(code, bankShiftPeriod(firstP, -1));
  const prevClose = prevRec && prevRec.closing !== null ? prevRec.closing : null;
  if (opening !== null && startsMonth) {
    if (r0.opening === null && prevClose === null) { r0.opening = opening; imp.set.push({ period: firstP, field: 'opening', value: opening }); }
    else if ((r0.opening !== null ? r0.opening : prevClose) !== opening) {
      warnings.push('ยอดยกมาในไฟล์ ' + fmt(opening) + ' ไม่ตรงกับยอดที่มีอยู่ ' + fmt(r0.opening !== null ? r0.opening : prevClose)
        + ' — ตรวจว่าไม่ได้ขาดสเตทเมนต์บางช่วง');
    }
  }
  /* ยอดปลายงวด: ตั้งให้เฉพาะเดือนที่ไฟล์ครอบคลุมถึงสิ้นเดือน
     (มีรายการเดือนถัดไป · หัวไฟล์ระบุวันที่ถึงสิ้นเดือน · หรือรายการสุดท้ายลงวันสิ้นเดือน) */
  const periods = inPeriod.map((l) => periodOf(l.date)).filter((p, i, a) => a.indexOf(p) === i);
  const lastDate = (st.dates && st.dates.to) || null;
  periods.forEach(function (p, pi) {
    const inP = inPeriod.filter((l) => periodOf(l.date) === p);
    const last = inP.slice().reverse().find((l) => l.balance !== null);
    const eom = endOfMonth(p + '-01');
    const covers = pi < periods.length - 1 || (lastDate && lastDate >= eom) || inP[inP.length - 1].date === eom;
    let close = null;
    if (last) {
      const after = inP.slice(inP.indexOf(last) + 1).reduce((s, l) => s + bankNet(l), 0);
      close = last.balance + after;
    }
    if (pi === periods.length - 1 && st.closing && st.closing.amount !== null && covers) close = st.closing.amount;
    if (close === null) return;
    const r = bankStmtEnsure(code, p);
    if (!covers) {
      warnings.push('ไฟล์มีรายการถึง ' + thDate(inP[inP.length - 1].date) + ' ยังไม่ถึงสิ้นเดือน ' + thPeriod(p)
        + ' — กรอกยอดคงเหลือปลายงวดตามสเตทเมนต์เองเมื่อได้สเตทเมนต์ครบเดือน');
      return;
    }
    if (r.closing === null) { r.closing = close; imp.set.push({ period: p, field: 'closing', value: close }); }
    else if (r.closing !== close) warnings.push('ยอดปลายงวด ' + thPeriod(p) + ' ในไฟล์ ' + fmt(close) + ' ไม่ตรงกับที่กรอกไว้ ' + fmt(r.closing));
  });
  if (outside.length) warnings.push('ข้าม ' + outside.length + ' รายการที่อยู่นอกรอบบัญชีที่เปิดไว้');
  if (dup.length) warnings.push('ข้าม ' + dup.length + ' รายการที่นำเข้าไปแล้วจากไฟล์ก่อน');
  if (bad.length) warnings.push('อ่านไม่ออก ' + bad.length + ' แถว: ' + bad.slice(0, 3).map((b) => 'แถว ' + b.line + ' ' + b.why).join(' · '));
  imp.warnings = warnings;
  DB.bankImports.unshift(imp);
  audit('bank_import', code + '|' + imp.id, 'import', null, { file: imp.name, added: imp.added, duplicates: imp.duplicates });
  return { imp, added: fresh.length, duplicates: dup.length, outside: outside.length, bad: bad.length, warnings, statement: st };
}

/** ยกเลิกการนำเข้าทั้งไฟล์ — ใช้เมื่อนำเข้าผิดไฟล์หรือผิดบัญชี ต้องยกเลิกการจับคู่ของรายการจากไฟล์นี้ก่อน */
function undoBankImport(id) {
  const imp = DB.bankImports.find((x) => String(x.id) === String(id));
  if (!imp || imp.undone) throw new DomainError('BANK_IMPORT_NOT_FOUND', 'ไม่พบการนำเข้านี้ หรือยกเลิกไปแล้ว');
  const lines = DB.bankTxns.filter((t) => t.importId === imp.id);
  const done = lines.filter((t) => t.matched);
  if (done.length) {
    throw new DomainError('BANK_IMPORT_MATCHED', 'มี ' + done.length + ' รายการจากไฟล์นี้จับคู่กับบัญชีแล้ว',
      'ยกเลิกการจับคู่รายการเหล่านั้นก่อน แล้วค่อยยกเลิกการนำเข้า');
  }
  DB.bankTxns = DB.bankTxns.filter((t) => t.importId !== imp.id);
  (imp.set || []).forEach(function (s) {
    const r = bankStmtRec(imp.acc, s.period);
    if (r && r[s.field] === s.value) r[s.field] = null;
  });
  /* งวดที่ไม่เหลือทั้งรายการและยอด ลบทิ้ง — วันเริ่มกระทบยอดจะได้ถอยกลับเหมือนก่อนนำเข้า */
  DB.bankStmts = DB.bankStmts.filter((r) => r.acc !== imp.acc || r.opening !== null || r.closing !== null
    || DB.bankTxns.some((t) => t.acc === r.acc && periodOf(t.date) === r.period));
  imp.undone = true;
  imp.undoneAt = new Date().toISOString();
  audit('bank_import', imp.acc + '|' + imp.id, 'undo', { added: imp.added }, null);
  return imp;
}

/* ===================================================================
   สเตทเมนต์ตัวอย่างของบริษัทสาธิต (เดือน ก.ค.)
   รายการในบัญชีส่วนใหญ่ขึ้นสเตทเมนต์แล้วและจับคู่ไว้ · เช็คค่าใช้จ่ายปลายเดือนยังไม่ถูกเรียกเก็บ
   เงินรับใบสุดท้ายยังไม่เข้า · ธนาคารมี 3 รายการที่บริษัทยังไม่ได้บันทึก (ดอกเบี้ยรับ ค่าธรรมเนียม เงินโอนเข้า)
   =================================================================== */
function demoBankStatement() {
  const code = accBySub('bank'), period = '2026-07';
  const from = period + '-01', end = endOfMonth(from);
  const opening = balanceOf(code, addDays(from, -1));
  const rec = bankStmtEnsure(code, period);
  rec.opening = opening;
  const items = bankBookItems(code, end);
  const lastIn = items.filter((i) => i.amount > 0 && i.src === 'receipt').slice(-1)[0];
  const pending = new Set(items.filter((i) => i.src === 'expense').map((i) => i.key));
  if (lastIn) pending.add(lastIn.key);
  const word = { receipt: 'รับโอนเงิน', payment: 'โอนเงินออก', filing: 'ชำระภาษี e-Filing', expense: 'จ่ายเช็ค' };
  const rows = items.filter((i) => !pending.has(i.key)).map((i) => ({
    date: i.date, desc: word[i.src] || 'หักบัญชีอัตโนมัติ', debit: i.amount < 0 ? -i.amount : 0, credit: i.amount > 0 ? i.amount : 0, key: i.key }));
  rows.push({ date: '2026-07-03', desc: 'INTEREST RECEIVED', ref: 'INT690703', debit: 0, credit: M('1842') });
  rows.push({ date: '2026-07-08', desc: 'FEE - REMITTANCE', ref: 'FEE690708', debit: M('350'), credit: 0 });
  rows.push({ date: '2026-07-15', desc: 'TRANSFER FROM 6890', ref: 'TR690715', debit: 0, credit: M('240000') });
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let run = opening, n = 0;
  const lines = rows.map(function (r) {
    run += r.credit - r.debit;
    return { acc: code, date: r.date, desc: r.desc, ref: r.ref || ('TR' + r.date.replace(/-/g, '').slice(2) + String(++n).padStart(3, '0')),
      debit: r.debit, credit: r.credit, balance: run, key: r.key };
  });
  bankPushLines(code, lines.map((l) => { const c = Object.assign({}, l); delete c.key; return c; }), { src: 'demo' });
  rec.closing = run;
  const made = DB.bankTxns.slice(-lines.length);
  lines.forEach(function (l, i) { if (l.key) bankDoMatch(code, [made[i].id], [l.key]); });
}

matchBank = transactional(matchBank);
matchBankTxn = transactional(matchBankTxn);
unmatchBank = transactional(unmatchBank);
bankAutoMatch = transactional(bankAutoMatch);
bookBankTxn = transactional(bookBankTxn);
addBankLines = transactional(addBankLines);
deleteBankLine = transactional(deleteBankLine);
setBankStatement = transactional(setBankStatement);
addBankBf = transactional(addBankBf);
deleteBankBf = transactional(deleteBankBf);
importBankStatement = transactional(importBankStatement);
undoBankImport = transactional(undoBankImport);
