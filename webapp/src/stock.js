/* ===================================================================
   ระบบสต๊อก
   ใบปรับปรุงสินค้า (ST) ใบเดียวใช้ได้สี่งาน — งานที่เอกสารซื้อขายทำให้ไม่ได้
   1. ยอดยกมา    ของที่มีอยู่แล้ววันเริ่มใช้ระบบ (ระบบเดิมหรือนับจริง)
   2. ตรวจนับ     นับของจริงแล้วปรับยอดในระบบให้ตรง ขาด = ขาดทุน เกิน = รายได้อื่น
   3. ตัดจำหน่าย  ของชำรุด สูญหาย หมดอายุ
   4. เบิกใช้      เอาสินค้าไปใช้เองในกิจการ ลงเป็นค่าใช้จ่ายตามบัญชีที่เลือก
   ตีราคาด้วยต้นทุนเฉลี่ยถ่วงน้ำหนักของสินค้าตัวนั้น ณ ตอนบันทึก (ยอดยกมาใช้ต้นทุนที่กรอก)
   ทะเบียนสินค้า (มูลค่ารายตัว) ต้องเท่ากับบัญชีสินค้าคงเหลือเสมอ — ตรวจในยอดคุมก่อนปิดงวด
   =================================================================== */
const STOCK_ADJ = {
  opening:  { th: 'ยอดยกมา',    verb: 'ตั้งยอดสินค้ายกมา' },
  count:    { th: 'ตรวจนับ',     verb: 'ปรับยอดตามที่ตรวจนับ' },
  writeoff: { th: 'ตัดจำหน่าย',  verb: 'ตัดจำหน่ายสินค้า' },
  issue:    { th: 'เบิกใช้',      verb: 'เบิกสินค้าไปใช้' },
};

function stockItem(code) {
  const it = DB.items.find((x) => x.code === code);
  if (!it) throw new DomainError('ITEM_NOT_FOUND', 'ไม่พบสินค้ารหัส ' + code);
  if (it.type !== 'stock') {
    throw new DomainError('ITEM_NOT_STOCK', it.name + ' (' + it.code + ') เป็นบริการ ไม่มีสต๊อก',
      'เปลี่ยนประเภทเป็นสินค้าที่หน้าทะเบียนสินค้าก่อน');
  }
  return it;
}
/** วันที่ของความเคลื่อนไหวล่าสุดของสินค้าตัวนี้ */
function lastMoveDate(code) {
  return DB.docs.stockMove.reduce((d, m) => (m.item === code && m.date > d ? m.date : d), '');
}
function moveIn(it, qty, cost, date, src) {
  it.qty = roundQty(it.qty + qty);
  it.value += cost;
  it.avgCost = unitCost(it.value, it.qty);
  DB.docs.stockMove.push({ date, item: it.code, dir: 'in', qty, cost, src, balance: it.qty });
}
/** จ่ายออกที่ต้นทุนเฉลี่ย — ชิ้นสุดท้ายรับมูลค่าที่เหลือทั้งหมด ของหมดแล้วมูลค่าต้องเป็นศูนย์ */
function moveOut(it, qty, date, src) {
  const c = qty === it.qty ? it.value : round2(mulQty(it.avgCost, qty));
  it.qty = roundQty(it.qty - qty);
  it.value -= c;
  DB.docs.stockMove.push({ date, item: it.code, dir: 'out', qty, cost: c, src, balance: it.qty });
  return c;
}

/** ยอดสินค้าคงเหลือในบัญชีที่ยังไม่มีรายตัวสินค้ารองรับ — มักมาจากงบทดลองที่นำเข้า */
function stockUnallocated(asOf) {
  return balBySub(['inventory'], asOf) - stockValueAsOf(asOf);
}

/* ---------- ตรวจข้อมูลก่อนแตะอะไรทั้งหมด ---------- */
function stockAdjLines(kind, input) {
  const seen = {};
  const lines = (input.lines || []).filter((l) => l && String(l.itemCode || '').trim());
  if (!lines.length) throw new DomainError('STOCK_NO_LINES', 'ต้องมีสินค้าอย่างน้อย 1 รายการ');
  return lines.map(function (l, i) {
    const row = 'บรรทัดที่ ' + (i + 1) + ' ';
    const code = String(l.itemCode).trim();
    if (seen[code]) throw new DomainError('STOCK_DUP_ITEM', row + 'สินค้า ' + code + ' ซ้ำกับบรรทัดก่อนหน้า', 'รวมจำนวนไว้บรรทัดเดียว');
    seen[code] = true;
    const it = stockItem(code);
    const q = Number(l.qty);
    if (!isFinite(q) || q < 0 || (kind !== 'count' && q <= 0)) {
      throw new DomainError('STOCK_QTY_INVALID', row + it.name + ' จำนวนต้อง' + (kind === 'count' ? 'ไม่ติดลบ' : 'มากกว่าศูนย์'));
    }
    const qty = roundQty(q);
    if (kind !== 'opening') {
      /* ตรวจนับ ตัดจำหน่าย เบิกใช้ คิดจากยอดคงเหลือปัจจุบัน — ลงย้อนหลังก่อนรายการล่าสุดไม่ได้
         ไม่งั้นยอดคงเหลือที่ใช้คำนวณไม่ใช่ยอด ณ วันนั้น */
      const last = lastMoveDate(it.code);
      if (last && input.date < last) {
        throw new DomainError('STOCK_BACKDATED', row + it.name + ' มีรายการล่าสุดวันที่ ' + thDate(last)
          + ' ' + STOCK_ADJ[kind].th + 'ย้อนหลังก่อนวันนั้นไม่ได้', 'ใช้วันที่ ' + thDate(last) + ' หรือหลังจากนั้น');
      }
    }
    if ((kind === 'writeoff' || kind === 'issue') && qty > it.qty) {
      throw new DomainError('INSUFFICIENT_STOCK', row + it.name + ' มีในคลัง ' + it.qty + ' ' + (it.uom || '')
        + ' แต่จะ' + STOCK_ADJ[kind].th + ' ' + qty);
    }
    let cost = null;
    if (kind === 'opening') {
      const value = l.value !== undefined && l.value !== null && String(l.value).trim() !== '' ? M(l.value) : null;
      const unit = l.unitCost !== undefined && String(l.unitCost).trim() !== '' ? M(l.unitCost) : null;
      if (value === null && unit === null) {
        throw new DomainError('STOCK_COST_REQUIRED', row + it.name + ' ต้องกรอกต้นทุนต่อหน่วยหรือมูลค่ารวม',
          'ใช้ต้นทุนเฉลี่ยจากระบบเดิม หรือราคาซื้อล่าสุด');
      }
      cost = value !== null ? round2(value) : round2(mulQty(unit, qty));
      if (cost < 0) throw new DomainError('STOCK_COST_INVALID', row + it.name + ' มูลค่าติดลบไม่ได้');
    }
    return { it, qty, cost, unitCost: l.unitCost };
  });
}

/**
 * บันทึกใบปรับปรุงสินค้า
 * input: { kind: opening|count|writeoff|issue, date, reason, account (เบิกใช้), lines:[{itemCode, qty, unitCost?, value?}] }
 *   ตรวจนับ: qty = จำนวนที่นับได้จริง (0 ได้) ระบบคิดผลต่างจากยอดในระบบเอง
 */
function saveStockAdj(input) {
  const kind = input.kind;
  if (!STOCK_ADJ[kind]) throw new DomainError('STOCK_KIND_UNKNOWN', 'ไม่รู้จักงานสต๊อกชนิด ' + kind);
  const date = String(input.date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new DomainError('DATE_REQUIRED', 'ต้องระบุวันที่');
  const p = periodFor(date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวดบัญชี ' + thPeriod(p.code) + ' ปิดแล้ว ลงรายการไม่ได้');
  }
  const reason = String(input.reason || '').trim();
  if ((kind === 'writeoff' || kind === 'issue') && reason.length < 3) {
    throw new DomainError('REASON_REQUIRED', kind === 'writeoff'
      ? 'ต้องระบุเหตุผลที่ตัดจำหน่าย (ชำรุด สูญหาย หมดอายุ ฯลฯ)' : 'ต้องระบุว่าเบิกไปใช้ทำอะไร',
      kind === 'writeoff' ? 'จะนำไปหักเป็นรายจ่ายทางภาษีได้ ต้องมีหลักฐานการทำลายหรือแจ้งสรรพากรตามระเบียบ' : 'ผู้สอบบัญชีจะเห็นข้อความนี้');
  }
  let expAcc = null;
  if (kind === 'issue') {
    expAcc = input.account || defaultAccountFor('admin_expense');
    if (!expenseAccounts().some((a) => a.code === expAcc)) {
      throw new DomainError('ISSUE_ACCOUNT_INVALID', 'บัญชี ' + expAcc + ' ใช้รับรู้การเบิกสินค้าไม่ได้', 'เลือกบัญชีค่าใช้จ่าย');
    }
  }
  const rows = stockAdjLines(kind, input);

  let mode = null;
  if (kind === 'opening') {
    const total = rows.reduce((s, r) => s + r.cost, 0);
    const free = stockUnallocated(date);
    /* ยอดสินค้าที่ยกมากับงบทดลองอยู่ในบัญชีแล้ว ใบนี้แค่แยกเป็นรายตัว ห้ามลงบัญชีซ้ำ
       ไม่มียอดค้างแยก = เริ่มจากศูนย์จริง ลงบัญชีคู่กับบัญชีปรับปรุงยอดยกมา */
    if (free > 0) {
      if (total > free) {
        throw new DomainError('OPENING_STOCK_EXCEEDS',
          'มูลค่าสินค้ายกมา ' + fmt(total) + ' บาท มากกว่ายอดสินค้าคงเหลือในบัญชีที่ยังไม่แยกรายตัว ' + fmt(free) + ' บาท',
          'ยอดรวมรายตัวต้องเท่ากับยอดสินค้าคงเหลือในงบทดลองที่นำเข้า — ตรวจจำนวนและต้นทุนอีกครั้ง');
      }
      mode = 'allocate';
    } else mode = 'post';
  }

  const no = nextNo('stockAdj', date);
  const lines = [];
  let outCost = 0, inCost = 0, shortage = 0, surplus = 0;
  rows.forEach(function (r) {
    const it = r.it;
    const book = it.qty;
    const line = { itemCode: it.code, name: it.name, uom: it.uom, bookQty: book, qty: r.qty, diff: 0, cost: 0 };
    if (kind === 'opening') {
      moveIn(it, r.qty, r.cost, date, no);
      line.diff = r.qty; line.cost = r.cost; inCost += r.cost;
    } else if (kind === 'count') {
      const diff = roundQty(r.qty - book);
      line.diff = diff;
      if (diff < 0) {
        line.cost = -moveOut(it, -diff, date, no);
        shortage -= line.cost;
      } else if (diff > 0) {
        const unit = it.avgCost || (r.unitCost !== undefined && String(r.unitCost).trim() !== '' ? M(r.unitCost) : 0);
        if (!unit) {
          throw new DomainError('STOCK_COST_REQUIRED', it.name + ' นับได้เกินแต่ยังไม่มีต้นทุนเฉลี่ย ต้องกรอกต้นทุนต่อหน่วย');
        }
        line.cost = round2(mulQty(unit, diff));
        moveIn(it, diff, line.cost, date, no);
        surplus += line.cost;
      }
    } else {
      line.diff = -r.qty;
      line.cost = -moveOut(it, r.qty, date, no);
      outCost -= line.cost;
    }
    lines.push(line);
  });

  /* ลงบัญชี — ยอดยกมาแบบแยกรายตัวไม่ลง (อยู่ในบัญชีแล้ว) ตรวจนับที่ตรงพอดีก็ไม่มีอะไรให้ลง */
  const inv = accBySub('inventory');
  let jl = [];
  if (kind === 'opening' && mode === 'post' && inCost > 0) {
    jl = [{ acc: inv, dr: inCost }, { acc: accBySub('opening_balance'), cr: inCost }];
  } else if (kind === 'count') {
    const net = surplus - shortage;
    if (shortage) jl.push({ acc: accBySub('inventory_writeoff'), dr: shortage, memo: 'สินค้าขาดจากการตรวจนับ' });
    if (surplus) jl.push({ acc: accBySub('other_income'), cr: surplus, memo: 'สินค้าเกินจากการตรวจนับ' });
    if (net > 0) jl.push({ acc: inv, dr: net });
    if (net < 0) jl.push({ acc: inv, cr: -net });
  } else if (kind === 'writeoff' && outCost) {
    jl = [{ acc: accBySub('inventory_writeoff'), dr: outCost }, { acc: inv, cr: outCost }];
  } else if (kind === 'issue' && outCost) {
    jl = [{ acc: expAcc, dr: outCost }, { acc: inv, cr: outCost }];
  }
  const je = jl.length >= 2 ? post({
    type: kind === 'opening' ? 'opening' : 'inventory', date,
    desc: STOCK_ADJ[kind].verb + ' ' + no + (reason ? ' — ' + reason : ''),
    src: 'stockAdj', srcId: no, lines: jl,
  }) : null;

  const doc = {
    no, date, kind, reason, account: expAcc, mode, lines,
    valueIn: inCost + surplus, valueOut: outCost + shortage,
    entryNo: je ? je.no : null, status: 'posted',
  };
  DB.docs.stockAdj.unshift(doc);
  audit('stockAdj', no, 'create', null, { kind, lines: lines.length, in: fmt(doc.valueIn), out: fmt(doc.valueOut), mode });
  return doc;
}

/** ยกเลิกใบปรับปรุงสินค้า — กลับรายการบัญชีและคืนสต๊อกตามที่ใบนี้ทำไว้ */
function voidStockAdj(no, reason) {
  if (!reason || String(reason).trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การยกเลิกเอกสารต้องระบุเหตุผล อย่างน้อย 5 ตัวอักษร');
  }
  const why = String(reason).trim();
  const d = DB.docs.stockAdj.find((x) => x.no === no);
  if (!d) throw new DomainError('DOC_NOT_FOUND', 'ไม่พบใบปรับปรุงสินค้า ' + no);
  if (d.status === 'void') throw new DomainError('ALREADY_VOID', 'ใบปรับปรุงสินค้า ' + no + ' ยกเลิกไปแล้ว');
  const p = periodFor(d.date);
  if (p.status !== 'open') {
    throw new DomainError('PERIOD_CLOSED', 'งวด ' + thPeriod(p.code) + ' ปิดแล้ว ยกเลิกใบนี้ไม่ได้',
      'ทำใบตรวจนับหรือตัดจำหน่ายใหม่ในงวดปัจจุบันแทน');
  }
  /* ของที่รับเข้าด้วยใบนี้ถูกขายหรือใช้ไปแล้ว ดึงกลับออกไม่ได้ */
  DB.docs.stockMove.filter((m) => m.src === no && m.dir === 'in').forEach(function (m) {
    const it = DB.items.find((x) => x.code === m.item);
    if (it && it.qty < m.qty) {
      throw new DomainError('VOID_HAS_DEPENDENTS', 'ยกเลิกไม่ได้ ' + it.name + ' เหลือในคลัง ' + it.qty + ' ' + it.uom
        + ' น้อยกว่าที่ใบนี้รับเข้า ' + m.qty, 'ของถูกขายหรือเบิกไปแล้ว — ทำใบตรวจนับใหม่แทน');
    }
  });
  if (d.entryNo) {
    const e = DB.entries.find((x) => x.no === d.entryNo);
    if (e && e.status === 'posted') reverse(d.entryNo, 'ยกเลิกใบปรับปรุงสินค้า ' + no + ' — ' + why, d.date, { fromSource: true });
  }
  stockBack(no, 'in');
  stockBack(no, 'out');
  d.status = 'void';
  d.voidReason = why;
  d.voidedAt = new Date().toISOString();
  audit('stockAdj', no, 'void', { status: 'posted' }, { status: 'void' }, why);
  return d;
}

/* ---------- รายงานคุมสินค้า ---------- */
/** เอกสารต้นทางของความเคลื่อนไหว — ใช้บอกชนิดเอกสารในสต๊อกการ์ด */
function stockSrcLabel(src) {
  const s = String(src || '');
  const voided = / \(ยกเลิก\)$/.test(s);
  const no = s.replace(/ \(ยกเลิก\)$/, '');
  const kinds = [['invoice', 'ขาย'], ['cashSale', 'ขายเงินสด'], ['creditNote', 'รับคืนจากลูกค้า'], ['bill', 'ซื้อ'], ['goodsReceipt', 'รับสินค้า']];
  let label = null;
  kinds.forEach(function (k) { if (!label && (DB.docs[k[0]] || []).some((d) => d.no === no)) label = k[1]; });
  if (!label) {
    const a = DB.docs.stockAdj.find((d) => d.no === no);
    if (a) label = STOCK_ADJ[a.kind].th;
  }
  if (!label && DB.entries.some((e) => e.no === no && e.src === 'import')) label = 'ยอดยกมาจากระบบเดิม';
  return (voided ? 'ยกเลิก' : '') + (label || 'อื่น ๆ');
}

/** สต๊อกการ์ด (รายงานสินค้าและวัตถุดิบ) ของสินค้าหนึ่งตัวในช่วงวันที่ — ยอดยกมา รับ จ่าย คงเหลือทีละรายการ */
function stockCard(code, from, to) {
  const it = stockItem(code);
  const mine = DB.docs.stockMove.map((m, i) => ({ m, i })).filter((x) => x.m.item === code);
  /* ย้อนจากยอดปัจจุบัน — ใช้ได้แม้สินค้าที่ยกมารุ่นก่อนไม่มีรายการรับเข้า */
  let qty = it.qty, value = it.value;
  mine.forEach(function (x) {
    if (x.m.date < from) return;
    const s = x.m.dir === 'in' ? 1 : -1;
    qty = roundQty(qty - s * x.m.qty); value -= s * x.m.cost;
  });
  const opening = { qty, value };
  const rows = mine.filter((x) => x.m.date >= from && x.m.date <= to)
    .sort((a, b) => (a.m.date < b.m.date ? -1 : a.m.date > b.m.date ? 1 : a.i - b.i))
    .map(function (x) {
      const m = x.m, s = m.dir === 'in' ? 1 : -1;
      qty = roundQty(qty + s * m.qty); value += s * m.cost;
      return { date: m.date, src: m.src, kind: stockSrcLabel(m.src), dir: m.dir,
        inQty: m.dir === 'in' ? m.qty : 0, inValue: m.dir === 'in' ? m.cost : 0,
        outQty: m.dir === 'out' ? m.qty : 0, outValue: m.dir === 'out' ? m.cost : 0,
        unitCost: m.qty ? unitCost(m.cost, m.qty) : 0, balQty: qty, balValue: value };
    });
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  return { item: it, from, to, opening, rows, closing: { qty, value },
    inQty: roundQty(sum('inQty')), inValue: sum('inValue'), outQty: roundQty(sum('outQty')), outValue: sum('outValue') };
}

/** สรุปสินค้าทุกตัวในช่วงวันที่ — ยกมา รับ จ่าย คงเหลือ (จำนวนและมูลค่า) */
function stockSummary(from, to) {
  const rows = DB.items.filter((i) => i.type === 'stock').map(function (i) {
    const c = stockCard(i.code, from, to);
    return { code: i.code, name: i.name, uom: i.uom, opening: c.opening, inQty: c.inQty, inValue: c.inValue,
      outQty: c.outQty, outValue: c.outValue, closing: c.closing, moves: c.rows.length };
  });
  const sum = (f) => rows.reduce((t, r) => t + f(r), 0);
  return { from, to, rows,
    totals: { opening: sum((r) => r.opening.value), inValue: sum((r) => r.inValue), outValue: sum((r) => r.outValue),
      closing: sum((r) => r.closing.value) },
    gl: balBySub(['inventory'], to) };
}

/** ตั้งยอดสินค้ายกมาจากไฟล์ — สินค้าที่ยังไม่มีในทะเบียนสร้างให้ แล้วออกใบยอดยกมาใบเดียว (ทั้งหมดหรือไม่มีเลย) */
function importOpeningStock(rows, date, fileName) {
  let created = 0;
  const lines = (rows || []).map(function (r) {
    let it = r.code ? DB.items.find((x) => x.code === r.code) : DB.items.find((x) => norm(x.name) === norm(r.name));
    if (!it) {
      it = saveItem({ newCode: r.code || '', name: r.name, type: 'stock', uom: r.uom || 'หน่วย', category: 'ยกมาจากระบบเดิม', price: '0' }).item;
      created++;
    }
    return { itemCode: it.code, qty: r.qty, value: r.value };
  });
  const doc = saveStockAdj({ kind: 'opening', date, reason: 'ยอดสินค้ายกมาจากไฟล์' + (fileName ? ' ' + fileName : ''), lines });
  return { doc, created };
}

saveStockAdj = transactional(saveStockAdj);
importOpeningStock = transactional(importOpeningStock);
voidStockAdj = transactional(voidStockAdj);
