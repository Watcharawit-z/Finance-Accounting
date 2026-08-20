import { afterAll, describe, expect, it } from 'vitest';
import { BRANCH, COMPANY, CUSTOMER, TENANT, USER, buildServices, ctx, expectError } from './helpers';
import { fromDb, money, toDb } from '../src/common/money';
import type { TenantContext } from '../src/common/db.service';

const svc = buildServices();
afterAll(async () => { await svc.db.onModuleDestroy(); });

describe('กฎของบัญชีแยกประเภท', () => {
  it('ปฏิเสธรายการที่ไม่สมดุลตั้งแต่ก่อนถึงฐานข้อมูล', async () => {
    const err = await expectError(() => svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2026-04-01', docDate: '2026-04-01',
      description: 'ทดสอบไม่สมดุล', createdBy: USER,
      lines: [
        { subType: 'bank', debit: money('1000') },
        { subType: 'sales_revenue', credit: money('900') },
      ],
    }), 'ENTRY_UNBALANCED');
    expect(err.message).toContain('1000');
    expect(err.message).toContain('900');
  });

  it('ปฏิเสธรายการที่มีบรรทัดเดียว', async () => {
    await expectError(() => svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2026-04-01', docDate: '2026-04-01',
      description: 'บรรทัดเดียว', createdBy: USER,
      lines: [{ subType: 'bank', debit: money('1000') }],
    }), 'ENTRY_TOO_FEW_LINES');
  });

  it('ปฏิเสธรายการที่ยอดรวมเป็นศูนย์', async () => {
    await expectError(() => svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2026-04-01', docDate: '2026-04-01',
      description: 'ยอดศูนย์', createdBy: USER,
      lines: [{ subType: 'bank', debit: money('0') }, { subType: 'sales_revenue', credit: money('0') }],
    }), 'ENTRY_ZERO_AMOUNT');
  });

  it('ปฏิเสธการลงบัญชีในวันที่ที่ยังไม่มีงวดรองรับ', async () => {
    await expectError(() => svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2030-01-15', docDate: '2030-01-15',
      description: 'นอกรอบบัญชี', createdBy: USER,
      lines: [{ subType: 'bank', debit: money('100') }, { subType: 'sales_revenue', credit: money('100') }],
    }), 'PERIOD_NOT_FOUND');
  });

  it('ปฏิเสธการลงบัญชีในบัญชีหัวข้อ', async () => {
    const [header] = await svc.db.query<any>(ctx,
      `SELECT id FROM duly.account WHERE company_id=$1 AND code='1100'`, [COMPANY]);
    await expectError(() => svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2026-04-01', docDate: '2026-04-01',
      description: 'ลงบัญชีหัวข้อ', createdBy: USER,
      lines: [{ accountId: header.id, debit: money('100') },
              { subType: 'sales_revenue', credit: money('100') }],
    }), 'ACCOUNT_NOT_POSTABLE');
  });

  it('แจ้งชัดเจนเมื่อผังบัญชีไม่มี sub_type ที่ต้องใช้', async () => {
    const err = await expectError(() => svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2026-04-01', docDate: '2026-04-01',
      description: 'sub_type ไม่มีในผัง', createdBy: USER,
      lines: [{ subType: 'ไม่มีจริง', debit: money('100') },
              { subType: 'sales_revenue', credit: money('100') }],
    }), 'ACCOUNT_MAPPING_MISSING');
    expect(err.message).toContain('ไม่มีจริง');
  });

  it('ปฏิเสธการลงบัญชีในงวดที่ปิดแล้ว', async () => {
    await svc.db.transaction(ctx, (c) =>
      c.query(`UPDATE duly.accounting_period SET status='closed'
                WHERE company_id=$1 AND code='2569-05'`, [COMPANY]));
    try {
      await expectError(() => svc.ledger.post(ctx, {
        companyId: COMPANY, branchId: BRANCH, journalType: 'general',
        postingDate: '2026-05-15', docDate: '2026-05-15',
        description: 'ลงในงวดที่ปิด', createdBy: USER,
        lines: [{ subType: 'bank', debit: money('100') }, { subType: 'sales_revenue', credit: money('100') }],
      }), 'PERIOD_CLOSED');
    } finally {
      await svc.db.transaction(ctx, (c) =>
        c.query(`UPDATE duly.accounting_period SET status='open'
                  WHERE company_id=$1 AND code='2569-05'`, [COMPANY]));
    }
  });

  it('กลับรายการแล้วยอดสุทธิเป็นศูนย์ และรายการเดิมยังอยู่ในบัญชีแยกประเภท', async () => {
    const posted = await svc.ledger.post(ctx, {
      companyId: COMPANY, branchId: BRANCH, journalType: 'general',
      postingDate: '2026-04-02', docDate: '2026-04-02',
      description: 'รายการที่จะกลับ', createdBy: USER,
      lines: [
        { subType: 'bank', debit: money('50000') },
        { subType: 'sales_revenue', credit: money('50000') },
      ],
    });

    const reversal = await svc.ledger.reverse(ctx, posted.id, 'คีย์ผิดบัญชี ทดสอบการกลับรายการ', USER);

    const [net] = await svc.db.query<any>(ctx,
      `SELECT COALESCE(SUM(debit_base - credit_base),0)::text AS diff
         FROM duly.journal_line WHERE entry_id = ANY($1::uuid[])`, [[posted.id, reversal.id]]);
    expect(fromDb(net.diff)).toBe(0n);

    const [orig] = await svc.db.query<any>(ctx,
      'SELECT status, reversed_by_id FROM duly.journal_entry WHERE id=$1', [posted.id]);
    expect(orig.status).toBe('reversed');
    expect(orig.reversed_by_id).toBe(reversal.id);

    // ★ รายการที่ถูกกลับรายการต้องยังนับอยู่ในงบทดลอง ตัวที่หักล้างคือรายการกลับ
    const lines = await svc.db.query<any>(ctx,
      `SELECT count(*)::int AS n FROM duly.journal_line WHERE entry_id=$1`, [posted.id]);
    expect(lines[0].n).toBe(2);
  });

  it('งบทดลองยังสมดุลหลังกลับรายการ', async () => {
    const tb = await svc.reports.trialBalance(ctx, COMPANY, '2026-01-01', '2026-12-31');
    expect(tb.totals.balanced).toBe(true);
  });

  it('เลขที่รายการบัญชีต้องไม่ซ้ำแม้ลงพร้อมกัน 20 รายการ', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => svc.ledger.post(ctx, {
        companyId: COMPANY, branchId: BRANCH, journalType: 'general',
        postingDate: '2026-06-01', docDate: '2026-06-01',
        description: `รายการพร้อมกันที่ ${i + 1}`, createdBy: USER,
        lines: [{ subType: 'bank', debit: money('10') }, { subType: 'sales_revenue', credit: money('10') }],
      })),
    );
    const numbers = results.map((r) => r.entryNo);
    expect(new Set(numbers).size).toBe(20);
  });
});

describe('การแยกข้อมูลระหว่างบริษัท (Row Level Security)', () => {
  it('บริษัทอื่นมองไม่เห็นใบกำกับภาษีของเรา', async () => {
    const otherCtx: TenantContext = {
      tenantId: TENANT,
      companyIds: ['99999999-9999-9999-9999-999999999999'],
      userId: USER,
    };
    const rows = await svc.db.query(otherCtx,
      'SELECT id FROM duly.sales_invoice WHERE company_id=$1', [COMPANY]);
    expect(rows).toHaveLength(0);
  });

  it('ไม่มี context เลย ก็ต้องไม่เห็นข้อมูลใด ๆ', async () => {
    const emptyCtx: TenantContext = { tenantId: TENANT, companyIds: [], userId: USER };
    const rows = await svc.db.query(emptyCtx, 'SELECT id FROM duly.journal_entry LIMIT 5');
    expect(rows).toHaveLength(0);
  });

  it('ยังอ่านข้อมูลอ้างอิงระดับระบบได้ (อัตราภาษี เงื่อนไขชำระเงิน)', async () => {
    const emptyCtx: TenantContext = { tenantId: TENANT, companyIds: [], userId: USER };
    const rates = await svc.db.query(emptyCtx,
      `SELECT code FROM duly.tax_code WHERE company_id IS NULL LIMIT 5`);
    expect(rates.length).toBeGreaterThan(0);
  });
});

describe('อัตราภาษีต้องขึ้นกับวันที่ของเอกสาร', () => {
  it('ค่าบริการช่องทางปกติ = 3% แต่ผ่าน e-Withholding Tax ปี 2569 = 1%', async () => {
    await svc.db.transaction(ctx, async (c) => {
      const manual = await svc.tax.computeWht(c, money('100000'), 'WHT_SERVICE', '2026-06-15',
        { channel: 'manual' });
      expect(manual.rate).toBe('3.0000');
      expect(toDb(manual.amount)).toBe('3000.0000');

      const ewht = await svc.tax.computeWht(c, money('100000'), 'WHT_SERVICE', '2026-06-15',
        { channel: 'e_wht' });
      expect(ewht.rate).toBe('1.0000');
      expect(toDb(ewht.amount)).toBe('1000.0000');
    });
  });

  it('ค่าเช่าอสังหาริมทรัพย์ = 5%', async () => {
    await svc.db.transaction(ctx, async (c) => {
      const r = await svc.tax.computeWht(c, money('120000'), 'WHT_RENT', '2026-06-15', { channel: 'manual' });
      expect(toDb(r.amount)).toBe('6000.0000');
    });
  });

  it('เกณฑ์ยกเว้นเมื่อจ่ายครั้งหนึ่งไม่ถึง 1,000 บาท', () => {
    expect(svc.tax.isBelowWhtThreshold(money('900'))).toBe(true);
    expect(svc.tax.isBelowWhtThreshold(money('1000'))).toBe(false);
    expect(svc.tax.isBelowWhtThreshold(money('900'), true)).toBe(false);   // สัญญาต่อเนื่อง
  });

  it('แจ้งชัดเจนเมื่อไม่มีอัตราที่มีผลในวันนั้น', async () => {
    await svc.db.transaction(ctx, async (c) => {
      await expectError(
        () => svc.tax.resolveRate(c, 'WHT_SERVICE', '1990-01-01', { channel: 'manual' }),
        'TAX_RATE_NOT_FOUND');
    });
  });
});

describe('VAT ต้องปัดเศษที่ระดับเอกสาร', () => {
  it('สามบรรทัดละ 33.33 ได้ VAT 7.00 ไม่ใช่ 6.99', async () => {
    const inv = await svc.invoices.createDraft(ctx, COMPANY, {
      branchId: BRANCH, partnerId: CUSTOMER, docDate: '2026-04-05',
      lines: [
        { description: 'บริการ ก', quantity: 1, unitPrice: '33.33' },
        { description: 'บริการ ข', quantity: 1, unitPrice: '33.33' },
        { description: 'บริการ ค', quantity: 1, unitPrice: '33.33' },
      ],
    }, USER);
    expect(inv.vatBase).toBe('99.9900');
    expect(inv.vatAmount).toBe('7.0000');
    expect(inv.grandTotal).toBe('106.9900');
  });
});
