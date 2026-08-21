/* ===================================================================
   ธุรกรรมทางธุรกิจ — ทุกตัวจบใน "หนึ่งชุด" เหมือน transaction เดียว
   ถ้าขั้นตอนใดล้มเหลว ต้องไม่มีอะไรค้างครึ่ง ๆ กลาง ๆ
   =================================================================== */

function partnerByCode(code) {
  const p = DB.partners.find((x) => x.code === code);
  if (!p) throw new DomainError('PARTNER_NOT_FOUND', 'ไม่พบคู่ค้ารหัส ' + code);
  return p;
}

function snapshotPartner(p) {
  return {
    code: p.code, name: p.name, taxId: p.taxId, branch: p.branch,
    entityType: p.entityType, address: p.address, capturedAt: new Date().toISOString(),
  };
}

/* ---------- คำนวณ VAT ระดับเอกสาร (ปัดเศษครั้งเดียว) ---------- */
function computeVat(lines, date) {
  let std = 0, zero = 0, exempt = 0, rateUsed = '0';
  lines.forEach(function (l) {
    const amt = round2(mulQty(M(l.price), l.qty));
    const code = l.taxCode || 'VAT7';
    if (code === 'VAT7') { std += amt; rateUsed = resolveRate('VAT7', date).rate; }
    else if (code === 'VAT0') zero += amt;
    else exempt += amt;
  });
  const vat = round2(pct(std, rateUsed));
  return { std, zero, exempt, vat, total: std + zero + exempt + vat, rate: rateUsed };
}

/* ---------- ตรวจตาม ม.86/4 ก่อนออกเลข ---------- */
function assertTaxInvoiceComplete(snap, lines) {
  const missing = [];
  if (!snap.name) missing.push('ชื่อผู้ซื้อ');
  if (!snap.address) missing.push('ที่อยู่ผู้ซื้อ');
  if (!snap.branch) missing.push('สำนักงานใหญ่หรือสาขาของผู้ซื้อ');
  if (!snap.taxId) missing.push('เลขประจำตัวผู้เสียภาษีของผู้ซื้อ');
  else if (!validTaxId(snap.taxId)) {
    throw new DomainError('TAX_ID_INVALID',
      'เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (' + snap.taxId + ') ไม่ผ่านการตรวจสอบหลักที่ 13',
      'ตรวจสอบเลขกับหนังสือรับรองของลูกค้า');
  }
  if (!lines.length) missing.push('รายการสินค้าหรือบริการ');
  lines.forEach(function (l, i) {
    if (!String(l.desc || '').trim()) missing.push('คำบรรยายบรรทัดที่ ' + (i + 1));
  });
  if (missing.length) {
    throw new DomainError('TAX_INVOICE_INCOMPLETE',
      'ออกใบกำกับภาษีไม่ได้เพราะข้อมูลไม่ครบตามมาตรา 86/4: ' + missing.join(', '),
      'แก้ไขข้อมูลให้ครบแล้วลองใหม่');
  }
}

/* ---------- ขาย: ออกใบกำกับภาษี ---------- */
function issueInvoice(input) {
  const p = partnerByCode(input.partnerCode);
  const snap = snapshotPartner(p);
  const lines = input.lines.filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  assertTaxInvoiceComplete(snap, lines);

  const v = computeVat(lines, input.date);
  const no = nextNo('invoice', input.date);
  const due = addDays(input.date, p.termDays || 0);

  const revLines = {};
  lines.forEach(function (l) {
    const a = accBySub(l.revenueSub || 'sales_revenue');
    revLines[a] = (revLines[a] || 0) + round2(mulQty(M(l.price), l.qty));
  });

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ขายสินค้า/บริการ ' + snap.name + ' (' + no + ')',
    src: 'invoice', srcId: no,
    lines: [
      { acc: accBySub('trade_receivable'), dr: v.total, partner: p.code },
    ].concat(Object.keys(revLines).map((a) => ({ acc: a, cr: revLines[a] })))
     .concat(v.vat ? [{ acc: accBySub('output_vat'), cr: v.vat }] : []),
  });

  // ตัดต้นทุนขายถ้าเป็นสินค้า
  let cogs = 0;
  lines.forEach(function (l) {
    if (!l.itemCode) return;
    const it = DB.items.find((x) => x.code === l.itemCode);
    if (!it || it.type !== 'stock') return;
    const c = round2(mulQty(it.avgCost, l.qty));
    cogs += c;
    it.qty -= Number(l.qty);
    it.value -= c;
    DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'out', qty: Number(l.qty), cost: c, src: no, balance: it.qty });
  });
  let cogsJe = null;
  if (cogs > 0) {
    cogsJe = post({
      type: 'inventory', date: input.date, desc: 'ตัดต้นทุนขาย ' + no,
      src: 'invoice', srcId: no,
      lines: [{ acc: accBySub('cogs'), dr: cogs }, { acc: accBySub('inventory'), cr: cogs }],
    });
  }

  DB.taxTx.push({
    kind: 'vat_output', period: periodOf(input.date), date: input.date,
    docNo: no, docType: 'tax_invoice',
    partnerName: snap.name, taxId: snap.taxId, branch: snap.branch,
    base: v.std, zero: v.zero, exempt: v.exempt, tax: v.vat,
    entryNo: je.no, filingId: null,
  });

  const doc = {
    no, date: input.date, due, partnerCode: p.code, partnerName: snap.name,
    snap, lines: lines.map((l) => ({
      desc: l.desc, qty: Number(l.qty), price: M(l.price), uom: l.uom || '',
      taxCode: l.taxCode || 'VAT7', itemCode: l.itemCode || null,
      amount: round2(mulQty(M(l.price), l.qty)),
    })),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    paid: 0, credited: 0, status: 'issued',
    entryNo: je.no, cogsEntryNo: cogsJe ? cogsJe.no : null,
    etax: 'accepted',
  };
  DB.docs.invoice.unshift(doc);
  audit('invoice', no, 'issue', null, { total: fmt(v.total), partner: snap.name });
  return doc;
}

/* ---------- ขาย: รับชำระเงิน ---------- */
function receivePayment(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษี ' + input.invoiceNo);
  const outstanding = inv.total - inv.paid - inv.credited;
  if (outstanding <= 0) throw new DomainError('ALREADY_PAID', 'ใบกำกับภาษีนี้ชำระครบแล้ว');

  const gross = input.amount ? M(input.amount) : outstanding;
  if (gross > outstanding) {
    throw new DomainError('OVER_PAYMENT',
      'ยอดรับชำระ ' + fmt(gross) + ' เกินยอดคงค้าง ' + fmt(outstanding),
      'ถ้าลูกค้าจ่ายเกิน ให้บันทึกส่วนเกินเป็นเงินรับล่วงหน้าแทน');
  }
  // ภาษีที่ลูกค้าหักไว้ คำนวณจากฐานก่อน VAT ตามสัดส่วนที่รับชำระ
  let wht = 0, whtRate = null;
  if (input.whtCode) {
    const r = resolveRate(input.whtCode, input.date, { channel: 'manual' });
    const ratio = gross / inv.total;
    wht = round2(pct(round2(inv.base * ratio), r.rate));
    whtRate = r.rate;
  }
  const net = gross - wht;
  const no = nextNo('receipt', input.date);
  const bankAcc = input.bankAccount || accBySub('bank');

  const je = post({
    type: 'receipt', date: input.date,
    desc: 'รับชำระจาก ' + inv.partnerName + ' (' + inv.no + ')',
    src: 'receipt', srcId: no,
    lines: [
      { acc: bankAcc, dr: net },
    ].concat(wht ? [{ acc: accBySub('wht_asset'), dr: wht }] : [])
     .concat([{ acc: accBySub('trade_receivable'), cr: gross, partner: inv.partnerCode }]),
  });

  inv.paid += gross;
  if (inv.paid + inv.credited >= inv.total) inv.status = 'paid';
  else inv.status = 'partially_paid';

  const doc = {
    no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, method: input.method || 'transfer',
    gross, wht, whtRate, net, entryNo: je.no, whtCertReceived: !!input.whtCode,
  };
  DB.docs.receipt.unshift(doc);
  audit('receipt', no, 'create', null, { invoice: inv.no, net: fmt(net) });
  return doc;
}

/* ---------- ขาย: ใบลดหนี้ ---------- */
const CN_REASONS = {
  RETURN_DEFECT: 'รับคืนสินค้าชำรุด บกพร่อง ไม่ตรงตามที่ตกลง',
  RETURN_SHORT: 'ส่งมอบสินค้าขาดจำนวน',
  PRICE_REDUCE: 'ลดราคาสินค้าหรือค่าบริการหลังออกใบกำกับ',
  SERVICE_INCOMPLETE: 'ให้บริการไม่ครบตามที่ตกลง',
  CANCEL_CONTRACT: 'บอกเลิกสัญญาหรือคืนสินค้า',
  CALC_ERROR: 'คำนวณราคาสูงกว่าที่เป็นจริง',
};
function issueCreditNote(input) {
  const inv = DB.docs.invoice.find((d) => d.no === input.invoiceNo);
  if (!inv) {
    throw new DomainError('CREDIT_NOTE_NO_ORIGIN',
      'ใบลดหนี้ต้องอ้างอิงใบกำกับภาษีเดิมเสมอ (มาตรา 86/10)',
      'เลือกใบกำกับภาษีที่ต้องการลดหนี้');
  }
  if (!CN_REASONS[input.reason]) {
    throw new DomainError('CREDIT_NOTE_REASON_INVALID',
      'เหตุผลไม่อยู่ในเหตุที่กฎหมายกำหนดตามมาตรา 86/10');
  }
  const base = M(input.base);
  const remaining = inv.base - inv.credited;
  if (base > remaining) {
    throw new DomainError('CREDIT_NOTE_EXCEEDS',
      'มูลค่าใบลดหนี้ ' + fmt(base) + ' เกินมูลค่าคงเหลือของใบกำกับเดิม ' + fmt(remaining));
  }
  const r = resolveRate('VAT7', input.date);
  const vat = round2(pct(base, r.rate));
  const total = base + vat;
  const no = nextNo('creditNote', input.date);

  const je = post({
    type: 'sales', date: input.date,
    desc: 'ใบลดหนี้ ' + no + ' อ้าง ' + inv.no + ' — ' + CN_REASONS[input.reason],
    src: 'creditNote', srcId: no,
    lines: [
      { acc: accBySub('sales_return'), dr: base },
      { acc: accBySub('output_vat'), dr: vat },
      { acc: accBySub('trade_receivable'), cr: total, partner: inv.partnerCode },
    ],
  });

  DB.taxTx.push({
    kind: 'vat_output', period: periodOf(input.date), date: input.date,
    docNo: no, docType: 'credit_note', refDoc: inv.no,
    partnerName: inv.partnerName, taxId: inv.snap.taxId, branch: inv.snap.branch,
    base: -base, zero: 0, exempt: 0, tax: -vat, entryNo: je.no, filingId: null,
  });

  inv.credited += total;
  if (inv.paid + inv.credited >= inv.total) inv.status = 'paid';

  const doc = { no, date: input.date, invoiceNo: inv.no, partnerCode: inv.partnerCode,
    partnerName: inv.partnerName, reason: input.reason, reasonText: CN_REASONS[input.reason],
    base, vat, total, entryNo: je.no };
  DB.docs.creditNote.unshift(doc);
  audit('creditNote', no, 'issue', null, { ref: inv.no, total: fmt(total), reason: CN_REASONS[input.reason] });
  return doc;
}

/* ---------- ซื้อ: ตั้งหนี้ผู้ขาย ---------- */
function recordBill(input) {
  const p = partnerByCode(input.partnerCode);
  const dup = DB.docs.bill.find((b) => b.partnerCode === p.code && b.vendorNo === input.vendorNo && b.status !== 'void');
  if (dup) {
    throw new DomainError('DUPLICATE_VENDOR_INVOICE',
      'บันทึกใบกำกับภาษีซื้อเลขที่ ' + input.vendorNo + ' ของผู้ขายรายนี้ไปแล้ว (' + dup.no + ')',
      'ตรวจสอบรายการเดิม หรือแก้เลขที่ใบกำกับให้ถูกต้อง');
  }
  const lines = input.lines.filter((l) => String(l.desc || '').trim() && M(l.price) !== 0);
  if (!lines.length) throw new DomainError('NO_LINES', 'ต้องมีรายการอย่างน้อย 1 บรรทัด');

  const v = computeVat(lines, input.date);
  const no = nextNo('bill', input.date);
  const claimable = !input.nonClaimableVat;

  const expLines = {};
  lines.forEach(function (l) {
    const a = accBySub(l.expenseSub || 'admin_expense');
    expLines[a] = (expLines[a] || 0) + round2(mulQty(M(l.price), l.qty));
  });
  // ภาษีซื้อต้องห้ามเข้าเป็นค่าใช้จ่าย ไม่ใช่สินทรัพย์ภาษี
  if (!claimable && v.vat) {
    const a = accBySub('non_claimable_vat_expense');
    expLines[a] = (expLines[a] || 0) + v.vat;
  }

  const je = post({
    type: 'purchase', date: input.date,
    desc: 'ตั้งหนี้ ' + p.name + ' (' + input.vendorNo + ')',
    src: 'bill', srcId: no,
    lines: Object.keys(expLines).map((a) => ({ acc: a, dr: expLines[a] }))
      .concat(claimable && v.vat ? [{ acc: accBySub('input_vat'), dr: v.vat }] : [])
      .concat([{ acc: accBySub('trade_payable'), cr: v.total, partner: p.code }]),
  });

  lines.forEach(function (l) {
    if (!l.itemCode) return;
    const it = DB.items.find((x) => x.code === l.itemCode);
    if (!it || it.type !== 'stock') return;
    const c = round2(mulQty(M(l.price), l.qty));
    it.qty += Number(l.qty);
    it.value += c;
    it.avgCost = it.qty > 0 ? divRound(it.value, it.qty) : 0;
    DB.docs.stockMove.push({ date: input.date, item: it.code, dir: 'in', qty: Number(l.qty), cost: c, src: no, balance: it.qty });
  });

  DB.taxTx.push({
    kind: 'vat_input', period: periodOf(input.date), date: input.date,
    docNo: input.vendorNo, docType: 'tax_invoice',
    partnerName: p.name, taxId: p.taxId, branch: p.branch,
    base: v.std, zero: v.zero, exempt: v.exempt, tax: claimable ? v.vat : 0,
    nonClaimable: claimable ? 0 : v.vat,
    entryNo: je.no, filingId: null,
  });

  const doc = {
    no, date: input.date, due: addDays(input.date, p.termDays || 0),
    vendorNo: input.vendorNo, partnerCode: p.code, partnerName: p.name,
    lines: lines.map((l) => ({ desc: l.desc, qty: Number(l.qty), price: M(l.price),
      amount: round2(mulQty(M(l.price), l.qty)), itemCode: l.itemCode || null })),
    base: v.std + v.zero + v.exempt, vat: v.vat, total: v.total,
    claimable, paid: 0, status: 'issued', entryNo: je.no,
    whtCode: input.whtCode || null,
  };
  DB.docs.bill.unshift(doc);
  audit('bill', no, 'create', null, { vendor: p.name, total: fmt(v.total) });
  return doc;
}

/* ---------- ซื้อ: จ่ายชำระพร้อมหักภาษี ณ ที่จ่าย ---------- */
function payBill(input) {
  const bill = DB.docs.bill.find((b) => b.no === input.billNo);
  if (!bill) throw new DomainError('BILL_NOT_FOUND', 'ไม่พบรายการตั้งหนี้ ' + input.billNo);
  const outstanding = bill.total - bill.paid;
  if (outstanding <= 0) throw new DomainError('ALREADY_PAID', 'รายการนี้จ่ายครบแล้ว');

  const p = partnerByCode(bill.partnerCode);
  const gross = input.amount ? M(input.amount) : outstanding;
  if (gross > outstanding) {
    throw new DomainError('OVER_PAYMENT', 'ยอดจ่าย ' + fmt(gross) + ' เกินยอดคงค้าง ' + fmt(outstanding));
  }
  const channel = input.channel || 'manual';
  let wht = 0, whtRate = null, whtCode = input.whtCode || bill.whtCode;
  const baseForWht = round2(bill.base * (gross / bill.total));

  if (whtCode && baseForWht >= M('1000')) {
    const r = resolveRate(whtCode, input.date, { channel });
    wht = round2(pct(baseForWht, r.rate));
    whtRate = r.rate;
  }
  const net = gross - wht;
  const no = nextNo('payment', input.date);
  const whtAccount = p.entityType === 'individual' ? 'wht_payable_pnd3' : 'wht_payable_pnd53';

  const je = post({
    type: 'payment', date: input.date,
    desc: 'จ่ายชำระ ' + p.name + ' (' + bill.no + ')',
    src: 'payment', srcId: no,
    lines: [{ acc: accBySub('trade_payable'), dr: gross, partner: p.code }]
      .concat(wht ? [{ acc: accBySub(whtAccount), cr: wht }] : [])
      .concat([{ acc: input.bankAccount || accBySub('bank'), cr: net }]),
  });

  bill.paid += gross;
  bill.status = bill.paid >= bill.total ? 'paid' : 'partially_paid';

  let certNo = null;
  if (wht > 0) {
    // ★ e-WHT: ธนาคารนำส่งและออกหลักฐานให้ ไม่ต้องออก 50 ทวิ เอง
    //   และต้องกันออกจากแบบ ภ.ง.ด.3/53 ไม่งั้นนำส่งซ้ำ
    if (channel === 'manual') {
      certNo = nextNo('whtCert', input.date);
      DB.docs.whtCert.unshift({
        no: certNo, date: input.date, partnerCode: p.code, partnerName: p.name,
        taxId: p.taxId, form: p.entityType === 'individual' ? 'ภ.ง.ด.3' : 'ภ.ง.ด.53',
        incomeType: resolveRate(whtCode, input.date, { channel }).label,
        base: baseForWht, wht, rate: whtRate, sent: false, paymentNo: no,
      });
    }
    DB.taxTx.push({
      kind: 'wht', period: periodOf(input.date), date: input.date,
      docNo: no, docType: 'payment',
      partnerName: p.name, taxId: p.taxId, branch: p.branch,
      entityType: p.entityType,
      base: baseForWht, tax: wht, rate: whtRate, channel,
      incomeType: resolveRate(whtCode, input.date, { channel }).label,
      form: p.entityType === 'individual' ? 'PND3' : 'PND53',
      certNo, entryNo: je.no, filingId: null,
    });
  }

  const doc = { no, date: input.date, billNo: bill.no, partnerCode: p.code, partnerName: p.name,
    gross, wht, whtRate, net, channel, certNo, entryNo: je.no,
    method: input.method || 'transfer' };
  DB.docs.payment.unshift(doc);
  audit('payment', no, 'create', null, { bill: bill.no, net: fmt(net), channel });
  return doc;
}

/* ---------- ค่าเสื่อมราคาประจำงวด ---------- */
function runDepreciation(period) {
  const already = DB.docs.depreciation.find((d) => d.period === period);
  if (already) {
    throw new DomainError('DEPRECIATION_ALREADY_RUN',
      'ตั้งค่าเสื่อมราคางวด ' + thPeriod(period) + ' ไปแล้ว (' + already.entryNo + ')',
      'กลับรายการเดิมก่อนถ้าต้องการคำนวณใหม่');
  }
  const endDate = endOfMonth(period + '-01');
  let bookTotal = 0, taxTotal = 0;
  const rows = [];

  DB.assets.forEach(function (a) {
    if (a.class === 'LAND' || a.status !== 'in_use') return;
    if (a.inService > endDate) return;
    const bookRemaining = a.cost - a.accumBook;
    if (bookRemaining <= 0) return;
    const bookMonthly = Math.min(divRound(divRound(a.cost, a.bookYears), 12), bookRemaining);

    const t = TAX_DEPRECIATION[a.class];
    const taxBase = t.costCap ? Math.min(a.cost, t.costCap) : a.cost;
    const taxRemaining = taxBase - a.accumTax;
    const taxMonthly = Math.max(0, Math.min(divRound(pct(taxBase, t.rate), 12), taxRemaining));

    a.accumBook += bookMonthly;
    a.accumTax += taxMonthly;
    bookTotal += bookMonthly;
    taxTotal += taxMonthly;
    rows.push({ code: a.code, name: a.name, class: a.class, cost: a.cost,
      book: bookMonthly, tax: taxMonthly, diff: bookMonthly - taxMonthly,
      nbvBook: a.cost - a.accumBook, nbvTax: taxBase - a.accumTax });
  });

  if (bookTotal === 0) {
    throw new DomainError('NO_DEPRECIABLE_ASSETS', 'ไม่มีทรัพย์สินที่ต้องคิดค่าเสื่อมในงวดนี้');
  }
  const je = post({
    type: 'asset', date: endDate, desc: 'ค่าเสื่อมราคาประจำงวด ' + thPeriod(period),
    src: 'depreciation', srcId: period,
    lines: [
      { acc: accBySub('depreciation'), dr: bookTotal },
      { acc: accBySub('accum_depreciation'), cr: bookTotal },
    ],
  });
  const run = { period, date: endDate, bookTotal, taxTotal, diff: bookTotal - taxTotal, rows, entryNo: je.no };
  DB.docs.depreciation.unshift(run);
  audit('depreciation', period, 'run', null, { book: fmt(bookTotal), tax: fmt(taxTotal) });
  return run;
}

/* ---------- เงินเดือน ---------- */
function computePit(annualIncome, deductions) {
  const expense = Math.min(pct(annualIncome, 50), M('100000'));
  const net = Math.max(0, annualIncome - expense - deductions);
  let tax = 0;
  PIT_BRACKETS.forEach(function (b) {
    if (net <= b.lo) return;
    const top = b.hi === null ? net : Math.min(net, b.hi);
    tax += pct(top - b.lo, b.rate);
  });
  return { expense, net, tax: round2(tax) };
}

function runPayroll(period) {
  const already = DB.docs.payRun.find((r) => r.period === period);
  if (already) {
    throw new DomainError('PAYROLL_ALREADY_RUN',
      'ทำเงินเดือนงวด ' + thPeriod(period) + ' ไปแล้ว (' + already.entryNo + ')');
  }
  const payDate = endOfMonth(period + '-01');
  const sso = ssoRate(payDate);
  const slips = [];
  let gross = 0, pit = 0, ssoEmp = 0, ssoEr = 0, pvdEmp = 0, pvdEr = 0, net = 0;

  DB.employees.filter((e) => e.active).forEach(function (e) {
    const salary = e.salary;
    const ot = e.otHours ? round2(mulQty(divRound(divRound(salary, 30), 8), e.otHours * 1.5)) : 0;
    const g = salary + ot;

    const wageBase = Math.min(Math.max(salary, sso.floor), sso.ceiling);
    const s = Math.min(round2(pct(wageBase, sso.pct)), sso.max);
    const pv = e.pvdRate ? round2(pct(salary, e.pvdRate)) : 0;

    const annual = salary * 12 + ot * 12;
    const ded = M('60000') + (e.deductions || 0) + Math.min(s * 12, sso.max * 12);
    const p = computePit(annual, ded);
    const monthlyPit = round2(divRound(p.tax, 12));

    const n = g - monthlyPit - s - pv;
    slips.push({ code: e.code, name: e.name, dept: e.dept, salary, ot, gross: g,
      pit: monthlyPit, sso: s, ssoBase: wageBase, pvd: pv, net: n });

    gross += g; pit += monthlyPit; ssoEmp += s; ssoEr += s; pvdEmp += pv;
    pvdEr += pv; net += n;
  });

  if (!slips.length) throw new DomainError('NO_EMPLOYEES', 'ไม่มีพนักงานที่ยังทำงานอยู่');

  const je = post({
    type: 'payroll', date: payDate, desc: 'เงินเดือนงวด ' + thPeriod(period),
    src: 'payroll', srcId: period,
    lines: [
      { acc: accBySub('admin_expense'), dr: gross, memo: 'เงินเดือนและค่าล่วงเวลา' },
      { acc: accBySub('sso_expense'), dr: ssoEr, memo: 'เงินสมทบประกันสังคมส่วนนายจ้าง' },
      { acc: accBySub('pvd_expense'), dr: pvdEr, memo: 'เงินสมทบกองทุนสำรองฯ ส่วนนายจ้าง' },
      { acc: accBySub('wht_payable_pnd1'), cr: pit },
      { acc: accBySub('sso_payable'), cr: ssoEmp + ssoEr },
      { acc: accBySub('pvd_payable'), cr: pvdEmp + pvdEr },
      { acc: accBySub('bank'), cr: net },
    ],
  });

  const run = { period, date: payDate, count: slips.length, gross, pit,
    ssoEmp, ssoEr, pvdEmp, pvdEr, net, slips, entryNo: je.no,
    ssoCeiling: sso.ceiling, ssoMax: sso.max };
  DB.docs.payRun.unshift(run);
  DB.taxTx.push({
    kind: 'wht', period, date: payDate, docNo: je.no, docType: 'payroll',
    partnerName: 'พนักงาน ' + slips.length + ' คน', taxId: null, branch: '00000',
    base: gross, tax: pit, rate: null, channel: 'manual',
    incomeType: 'เงินเดือน ม.40(1)', form: 'PND1', entryNo: je.no, filingId: null,
  });
  audit('payroll', period, 'run', null, { count: slips.length, net: fmt(net) });
  return run;
}

/* ---------- ปิดภาษีมูลค่าเพิ่มรายเดือน (ภ.พ.30) ---------- */
function fileVat(period) {
  const existing = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === period);
  if (existing) {
    throw new DomainError('ALREADY_FILED',
      'ยื่น ภ.พ.30 งวด ' + thPeriod(period) + ' ไปแล้วเมื่อ ' + thDate(existing.filedDate));
  }
  const out = DB.taxTx.filter((t) => t.kind === 'vat_output' && t.period === period);
  const inn = DB.taxTx.filter((t) => t.kind === 'vat_input' && t.period === period);
  const outTax = out.reduce((s, t) => s + t.tax, 0);
  const inTax = inn.reduce((s, t) => s + t.tax, 0);
  const payable = outTax - inTax;
  const endDate = endOfMonth(period + '-01');

  const je = payable !== 0 ? post({
    type: 'adjustment', date: endDate,
    desc: 'ปิดภาษีมูลค่าเพิ่มงวด ' + thPeriod(period),
    src: 'filing', srcId: 'PP30|' + period,
    lines: payable > 0 ? [
      { acc: accBySub('output_vat'), dr: outTax },
      { acc: accBySub('input_vat'), cr: inTax },
      { acc: accBySub('vat_payable'), cr: payable },
    ] : [
      { acc: accBySub('output_vat'), dr: outTax },
      { acc: accBySub('vat_receivable'), dr: -payable },
      { acc: accBySub('input_vat'), cr: inTax },
    ],
  }) : null;

  const filing = {
    form: 'PP30', period, filedDate: endDate,
    dueDate: addDays(endOfMonth(period + '-01'), 15),
    outBase: out.reduce((s, t) => s + t.base, 0),
    outZero: out.reduce((s, t) => s + (t.zero || 0), 0),
    outTax, inBase: inn.reduce((s, t) => s + t.base, 0), inTax,
    payable, entryNo: je ? je.no : null, count: out.length + inn.length,
  };
  DB.docs.filing.unshift(filing);
  out.concat(inn).forEach((t) => { t.filingId = 'PP30|' + period; });
  audit('filing', 'PP30|' + period, 'file', null, { payable: fmt(payable) });
  return filing;
}

/* ---------- ยื่นภาษีหัก ณ ที่จ่าย ---------- */
function fileWht(period, form) {
  const key = form + '|' + period;
  if (DB.docs.filing.find((f) => f.form === form && f.period === period)) {
    throw new DomainError('ALREADY_FILED', 'ยื่น ' + form + ' งวด ' + thPeriod(period) + ' ไปแล้ว');
  }
  // ★ กันรายการที่ธนาคารนำส่งแทน (e-WHT) ออก ไม่งั้นนำส่งซ้ำ
  const rows = DB.taxTx.filter((t) => t.kind === 'wht' && t.period === period
    && t.form === form && t.channel === 'manual');
  if (!rows.length) {
    throw new DomainError('NOTHING_TO_FILE',
      'ไม่มีรายการที่ต้องยื่นใน ' + form + ' งวด ' + thPeriod(period),
      'รายการที่นำส่งผ่าน e-Withholding Tax ธนาคารนำส่งให้แล้ว ไม่ต้องยื่นซ้ำ');
  }
  const total = rows.reduce((s, t) => s + t.tax, 0);
  const endDate = endOfMonth(period + '-01');
  const acctSub = form === 'PND1' ? 'wht_payable_pnd1' : form === 'PND3' ? 'wht_payable_pnd3' : 'wht_payable_pnd53';

  const je = post({
    type: 'payment', date: addDays(endDate, 7),
    desc: 'นำส่งภาษีหัก ณ ที่จ่าย ' + form + ' งวด ' + thPeriod(period),
    src: 'filing', srcId: key,
    lines: [{ acc: accBySub(acctSub), dr: total }, { acc: accBySub('bank'), cr: total }],
  });
  const filing = { form, period, filedDate: addDays(endDate, 7), dueDate: addDays(endDate, 7),
    count: rows.length, total, entryNo: je.no,
    excluded: DB.taxTx.filter((t) => t.kind === 'wht' && t.period === period && t.channel === 'e_wht').length };
  DB.docs.filing.unshift(filing);
  rows.forEach((t) => { t.filingId = key; });
  audit('filing', key, 'file', null, { count: rows.length, total: fmt(total) });
  return filing;
}

/* ---------- ปิดงวด ---------- */
function closeChecklist(period) {
  const endDate = endOfMonth(period + '-01');
  const items = [];
  const rec = reconciliationChecks(endDate);
  rec.checks.forEach((c) => items.push({
    label: c.label, ok: c.ok,
    detail: c.ok ? 'ตรงกัน' : 'ต่างกัน ' + fmt(c.control - c.sub) + ' บาท', blocking: true,
  }));
  const dep = DB.docs.depreciation.find((d) => d.period === period);
  items.push({ label: 'ตั้งค่าเสื่อมราคาประจำงวด', ok: !!dep,
    detail: dep ? fmt(dep.bookTotal) + ' บาท' : 'ยังไม่ได้ทำ', blocking: true, action: 'depreciation' });
  const pay = DB.docs.payRun.find((r) => r.period === period);
  items.push({ label: 'ทำเงินเดือนประจำงวด', ok: !!pay,
    detail: pay ? pay.count + ' คน ' + fmt(pay.net) + ' บาท' : 'ยังไม่ได้ทำ', blocking: false, action: 'payroll' });
  const vat = DB.docs.filing.find((f) => f.form === 'PP30' && f.period === period);
  items.push({ label: 'ยื่นแบบ ภ.พ.30', ok: !!vat,
    detail: vat ? 'ชำระ ' + fmt(vat.payable) + ' บาท' : 'ยังไม่ได้ยื่น', blocking: true, action: 'vat' });
  const unmatched = DB.bankTxns.filter((t) => !t.matched && periodOf(t.date) <= period).length;
  items.push({ label: 'รายการธนาคารกระทบยอดครบ', ok: unmatched === 0,
    detail: unmatched === 0 ? 'ครบ' : 'ค้าง ' + unmatched + ' รายการ', blocking: false, action: 'bank' });

  return { period, items, canClose: items.filter((i) => i.blocking).every((i) => i.ok) };
}

function closePeriod(period) {
  const chk = closeChecklist(period);
  if (!chk.canClose) {
    throw new DomainError('CLOSE_BLOCKED',
      'ปิดงวดไม่ได้ เพราะยังมีรายการที่ต้องเคลียร์: '
        + chk.items.filter((i) => i.blocking && !i.ok).map((i) => i.label).join(', '));
  }
  const p = DB.periods.find((x) => x.code === period);
  if (!p) throw new DomainError('PERIOD_NOT_FOUND', 'ไม่พบงวด ' + period);
  p.status = 'closed';
  audit('period', period, 'close', { status: 'open' }, { status: 'closed' });
  return p;
}
function reopenPeriod(period, reason) {
  if (!reason || reason.trim().length < 5) {
    throw new DomainError('REASON_REQUIRED', 'การเปิดงวดที่ปิดแล้วต้องระบุเหตุผล');
  }
  const p = DB.periods.find((x) => x.code === period);
  if (!p) throw new DomainError('PERIOD_NOT_FOUND', 'ไม่พบงวด ' + period);
  p.status = 'open';
  audit('period', period, 'reopen', { status: 'closed' }, { status: 'open' }, reason.trim());
  return p;
}

/* ---------- กระทบยอดธนาคาร ---------- */
function matchBankTxn(id, entryNo) {
  const t = DB.bankTxns.find((x) => x.id === id);
  if (!t) throw new DomainError('TXN_NOT_FOUND', 'ไม่พบรายการเดินบัญชีนี้');
  t.matched = true;
  t.matchedTo = entryNo || 'จับคู่ด้วยตนเอง';
  audit('bank_txn', String(id), 'match', null, { to: t.matchedTo });
  return t;
}
function bookBankTxn(id, accountCode, desc) {
  const t = DB.bankTxns.find((x) => x.id === id);
  if (!t) throw new DomainError('TXN_NOT_FOUND', 'ไม่พบรายการเดินบัญชีนี้');
  if (t.matched) throw new DomainError('ALREADY_MATCHED', 'รายการนี้จับคู่แล้ว');
  const je = post({
    type: 'general', date: t.date, desc: desc || t.desc,
    src: 'bank', srcId: String(id),
    lines: t.credit > 0
      ? [{ acc: accBySub('bank'), dr: t.credit }, { acc: accountCode, cr: t.credit }]
      : [{ acc: accountCode, dr: t.debit }, { acc: accBySub('bank'), cr: t.debit }],
  });
  t.matched = true;
  t.matchedTo = je.no;
  return je;
}
