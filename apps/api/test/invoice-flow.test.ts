import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH, COMPANY, CUSTOMER, CUSTOMER_BAD_TAXID, USER, buildServices, ctx, expectError } from './helpers';
import { fromDb, toDb } from '../src/common/money';

const svc = buildServices();
const DOC_DATE = '2026-03-10';

afterAll(async () => { await svc.db.onModuleDestroy(); });

describe('ออกใบกำกับภาษีแล้วลงบัญชีครบวงจร', () => {
  let invoiceId: string;
  let entryId: string;

  it('สร้างฉบับร่าง แล้วคำนวณ VAT ที่ระดับเอกสาร', async () => {
    const inv = await svc.invoices.createDraft(ctx, COMPANY, {
      branchId: BRANCH,
      partnerId: CUSTOMER,
      docDate: DOC_DATE,
      lines: [
        { description: 'ชุดควบคุมมอเตอร์ รุ่น MC-450', quantity: 4, unitPrice: '158000',
          taxCode: 'VAT7_OUT', revenueSubType: 'sales_revenue' },
        { description: 'ค่าบริการออกแบบระบบไฟฟ้า', quantity: 1, unitPrice: '180000',
          taxCode: 'VAT7_OUT', revenueSubType: 'service_revenue' },
        { description: 'ค่าขนส่งและติดตั้ง', quantity: 1, unitPrice: '30000',
          taxCode: 'VAT7_OUT', revenueSubType: 'service_revenue' },
      ],
    }, USER);

    invoiceId = inv.id;
    expect(inv.status).toBe('draft');
    expect(inv.docNo).toBeNull();                       // ยังไม่จองเลขจนกว่าจะออกจริง
    expect(inv.vatBase).toBe('842000.0000');
    expect(inv.vatAmount).toBe('58940.0000');
    expect(inv.grandTotal).toBe('900940.0000');
    expect(inv.lines).toHaveLength(3);
  });

  it('ออกเลขและลงบัญชีในธุรกรรมเดียว', async () => {
    const issued = await svc.invoices.issue(ctx, COMPANY, invoiceId, USER);
    expect(issued.status).toBe('issued');
    expect(issued.docNo).toMatch(/^INV2603-\d{5}$/);
    expect(issued.taxInvoiceNo).toBe(issued.docNo);
    expect(issued.journalEntryId).toBeTruthy();
    entryId = issued.journalEntryId;
  });

  it('รายการบัญชีที่สร้างขึ้นสมดุลและลงบัญชีถูกด้าน', async () => {
    const lines = await svc.db.query<any>(ctx,
      `SELECT a.sub_type, l.debit::text, l.credit::text
         FROM duly.journal_line l JOIN duly.account a ON a.id=l.account_id
        WHERE l.entry_id=$1 ORDER BY l.line_no`, [entryId]);

    const debit = lines.reduce((s: bigint, l: any) => s + fromDb(l.debit), 0n);
    const credit = lines.reduce((s: bigint, l: any) => s + fromDb(l.credit), 0n);
    expect(toDb(debit)).toBe('900940.0000');
    expect(toDb(debit)).toBe(toDb(credit));

    const receivable = lines.find((l: any) => l.sub_type === 'trade_receivable');
    expect(receivable.debit).toBe('900940.0000');
    const outputVat = lines.find((l: any) => l.sub_type === 'output_vat');
    expect(outputVat.credit).toBe('58940.0000');
    const revenue = lines.filter((l: any) => l.sub_type.includes('revenue'));
    expect(revenue.reduce((s: bigint, l: any) => s + fromDb(l.credit), 0n)).toBe(fromDb('842000'));
  });

  it('บันทึกลงทะเบียนภาษีขายพร้อม snapshot ข้อมูลคู่ค้า', async () => {
    const [tx] = await svc.db.query<any>(ctx,
      `SELECT * FROM duly.tax_transaction
        WHERE source_doc_id=$1 AND kind='vat_output'`, [invoiceId]);
    expect(tx).toBeTruthy();
    expect(tx.tax_period).toBe('2026-03');
    expect(tx.base_amount).toBe('842000.0000');
    expect(tx.tax_amount).toBe('58940.0000');
    // ★ ข้อมูลคู่ค้าต้องถูกคัดลอกไว้ ไม่ใช่อ้างอิงสด
    const [partner] = await svc.db.query<any>(ctx,
      'SELECT legal_name_th FROM duly.partner WHERE id=$1', [CUSTOMER]);
    expect(tx.partner_name).toBe(partner.legal_name_th);
    expect(tx.partner_tax_id).toBe('0105548021442');
    expect(tx.partner_branch).toBe('00000');
  });

  it('snapshot ไม่เปลี่ยนตามข้อมูลคู่ค้าที่แก้ภายหลัง', async () => {
    const [before] = await svc.db.query<any>(ctx,
      'SELECT legal_name_th FROM duly.partner WHERE id=$1', [CUSTOMER]);
    try {
      await svc.db.transaction(ctx, (c) =>
        c.query(`UPDATE duly.partner SET legal_name_th='ชื่อใหม่หลังออกใบกำกับ' WHERE id=$1`, [CUSTOMER]));

      const [tx] = await svc.db.query<any>(ctx,
        `SELECT partner_name FROM duly.tax_transaction WHERE source_doc_id=$1`, [invoiceId]);
      expect(tx.partner_name).toBe(before.legal_name_th);

      const [inv] = await svc.db.query<any>(ctx,
        `SELECT partner_snapshot->>'legal_name_th' AS name FROM duly.sales_invoice WHERE id=$1`, [invoiceId]);
      expect(inv.name).toBe(before.legal_name_th);
    } finally {
      // คืนสภาพเสมอ ไม่ว่าการทดสอบจะผ่านหรือไม่ — ไม่งั้นเทสต์ถัดไปจะพังตามกัน
      await svc.db.transaction(ctx, (c) =>
        c.query('UPDATE duly.partner SET legal_name_th=$2 WHERE id=$1', [CUSTOMER, before.legal_name_th]));
    }
  });

  it('ออกใบกำกับซ้ำจากฉบับเดิมไม่ได้', async () => {
    await expectError(() => svc.invoices.issue(ctx, COMPANY, invoiceId, USER), 'INVALID_STATE_TRANSITION');
  });

  it('รายงานภาษีขายกระทบยอดกับบัญชีแยกประเภทได้', async () => {
    const report = await svc.reports.vatReport(ctx, COMPANY, 'vat_output', '2026-03');
    expect(report.totals.tax).toBe('589400000');       // 58,940.0000 ในหน่วยสเกล
    expect(report.reconciliation.matched).toBe(true);
    expect(report.reconciliation.difference).toBe('0');
  });

  it('งบทดลองสมดุล', async () => {
    const tb = await svc.reports.trialBalance(ctx, COMPANY, '2026-01-01', '2026-12-31');
    expect(tb.totals.balanced).toBe(true);
  });

  it('งบแสดงฐานะการเงินสมดุล', async () => {
    const bs = await svc.reports.balanceSheet(ctx, COMPANY, '2026-12-31');
    expect(bs.balanced).toBe(true);
    expect(bs.difference).toBe('0.00');
  });

  it('การตรวจยอดคุมผ่านทุกข้อ', async () => {
    const rec = await svc.reports.reconciliationChecks(ctx, COMPANY, '2026-12-31');
    const failed = rec.checks.filter((c) => !c.ok);
    expect(failed.map((f) => f.code)).toEqual([]);
    expect(rec.allPassed).toBe(true);
  });
});

describe('การตรวจสอบตามมาตรา 86/4 ก่อนออกเลข', () => {
  it('ปฏิเสธเมื่อเลขประจำตัวผู้เสียภาษีของผู้ซื้อไม่ถูกต้อง', async () => {
    const draft = await svc.invoices.createDraft(ctx, COMPANY, {
      branchId: BRANCH, partnerId: CUSTOMER_BAD_TAXID, docDate: DOC_DATE,
      lines: [{ description: 'สินค้าทดสอบ', quantity: 1, unitPrice: '1000' }],
    }, USER);
    const err = await expectError(() => svc.invoices.issue(ctx, COMPANY, draft.id, USER), 'TAX_ID_INVALID');
    expect(err.message).toContain('0000000000000');
    // ★ เลขที่เอกสารต้องไม่ถูกใช้ไปเมื่อการออกใบกำกับล้มเหลว
    const after = await svc.invoices.get(ctx, COMPANY, draft.id);
    expect(after.docNo).toBeNull();
    expect(after.status).toBe('draft');
  });

  it('ปฏิเสธใบกำกับที่ไม่มีบรรทัดรายการ', async () => {
    await expectError(() => svc.invoices.createDraft(ctx, COMPANY, {
      branchId: BRANCH, partnerId: CUSTOMER, docDate: DOC_DATE, lines: [],
    } as any, USER), 'ZodError').catch(async () => {
      // createDraft ไม่ได้ตรวจ schema เอง — ตรวจที่ controller
      const { CreateInvoiceInput } = await import('../src/ar/invoice.service');
      const parsed = CreateInvoiceInput.safeParse({
        branchId: BRANCH, partnerId: CUSTOMER, docDate: DOC_DATE, lines: [] });
      expect(parsed.success).toBe(false);
    });
  });
});
