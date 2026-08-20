import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { DbService, TenantContext } from '../common/db.service';
import { DomainError } from '../common/errors';
import { LedgerService } from '../ledger/ledger.service';
import { TaxService } from '../tax/tax.service';
import { Money, ZERO, add, fromDb, money, mul, round2, toDb } from '../common/money';

export const InvoiceLineInput = z.object({
  description: z.string().min(1, 'ทุกบรรทัดต้องมีคำบรรยายสินค้าหรือบริการ'),
  quantity: z.union([z.string(), z.number()]).default(1),
  unitPrice: z.union([z.string(), z.number()]),
  taxCode: z.string().default('VAT7_OUT'),
  revenueSubType: z.string().default('sales_revenue'),
  uom: z.string().optional(),
});

export const CreateInvoiceInput = z.object({
  branchId: z.string().uuid(),
  partnerId: z.string().uuid(),
  docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'วันที่ต้องเป็นรูปแบบ YYYY-MM-DD'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(InvoiceLineInput).min(1, 'ใบกำกับภาษีต้องมีอย่างน้อย 1 บรรทัด'),
  note: z.string().optional(),
});
export type CreateInvoiceInput = z.infer<typeof CreateInvoiceInput>;

@Injectable()
export class InvoiceService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: LedgerService,
    private readonly tax: TaxService,
  ) {}

  async createDraft(ctx: TenantContext, companyId: string, raw: CreateInvoiceInput, userId: string) {
    // ตรวจ schema ที่ service ด้วย ไม่พึ่งว่า controller ตรวจมาแล้ว
    // เพราะ service ถูกเรียกจากงาน background และการนำเข้าข้อมูลได้ด้วย
    const input = CreateInvoiceInput.parse(raw);
    return this.db.transaction(ctx, async (c) => {
      const partner = await this.loadPartner(c, companyId, input.partnerId);
      const lines = input.lines.map((l) => ({
        ...l,
        amount: round2(mul(money(String(l.unitPrice)), String(l.quantity))),
      }));

      const vat = await this.tax.computeVat(
        c, lines.map((l) => ({ amount: l.amount, taxCode: l.taxCode })), input.docDate);

      const dueDate = input.dueDate ?? await this.dueDateFromTerms(c, input.docDate, partner.payment_term_id);

      const inv = await c.query(
        `INSERT INTO duly.sales_invoice
           (company_id, branch_id, doc_date, due_date, partner_id, partner_snapshot,
            subtotal, vat_base, vat_zero_base, vat_exempt_base, vat_amount, grand_total,
            status, is_tax_invoice, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',true,$13,$14)
         RETURNING id`,
        [companyId, input.branchId, input.docDate, dueDate, input.partnerId,
         JSON.stringify(this.snapshot(partner)),
         toDb(add(vat.standardBase, vat.zeroBase, vat.exemptBase)),
         toDb(vat.standardBase), toDb(vat.zeroBase), toDb(vat.exemptBase),
         toDb(vat.vatAmount), toDb(vat.grandTotal), input.note ?? null, userId],
      );
      const invoiceId = inv.rows[0].id as string;

      let no = 0;
      for (const l of lines) {
        no += 1;
        await c.query(
          `INSERT INTO duly.document_line
             (company_id, doc_type, doc_id, line_no, description, quantity, uom_id,
              unit_price, line_amount, account_id)
           VALUES ($1,'sales_invoice',$2,$3,$4,$5,$6,$7,$8,$9)`,
          [companyId, invoiceId, no, l.description, String(l.quantity),
           await this.resolveUom(c, companyId, l.uom),
           String(l.unitPrice), toDb(l.amount),
           await this.ledger.accountBySubType(c, companyId, l.revenueSubType)],
        );
      }

      await this.ledger.audit(c, ctx, companyId, 'sales_invoice', invoiceId, 'create', null,
        { status: 'draft', grand_total: toDb(vat.grandTotal) });
      return this.load(c, companyId, invoiceId);
    });
  }

  /**
   * ออกใบกำกับภาษี — ทุกอย่างเกิดขึ้นใน transaction เดียว
   * ถ้าขั้นตอนใดล้มเหลว เลขที่เอกสารจะไม่ถูกใช้ไปด้วย
   */
  async issue(ctx: TenantContext, companyId: string, invoiceId: string, userId: string) {
    return this.db.transaction(ctx, async (c) => {
      const inv = await this.loadRow(c, companyId, invoiceId);
      if (inv.status !== 'draft') {
        throw new DomainError('INVALID_STATE_TRANSITION',
          `ใบกำกับภาษีนี้อยู่ในสถานะ "${inv.status}" จึงออกเลขซ้ำไม่ได้`, 409);
      }

      this.assertIssuable(inv);

      const period = inv.doc_date.toISOString().slice(0, 7);      // YYYY-MM
      const taxPeriod = period;
      const docNo = await this.ledger.nextNumber(c, companyId, inv.branch_id, 'sales_invoice', period);

      const snap = inv.partner_snapshot as Record<string, any>;
      const vatAmount = fromDb(inv.vat_amount);
      const vatBase = fromDb(inv.vat_base);
      const grand = fromDb(inv.grand_total);

      const lines = await c.query(
        `SELECT account_id, line_amount FROM duly.document_line
          WHERE doc_type='sales_invoice' AND doc_id=$1 ORDER BY line_no`, [invoiceId]);

      const entry = await this.ledger.post(ctx, {
        companyId,
        branchId: inv.branch_id,
        journalType: 'sales',
        postingDate: inv.doc_date.toISOString().slice(0, 10),
        docDate: inv.doc_date.toISOString().slice(0, 10),
        description: `ขายสินค้า/บริการ ${snap.legal_name_th} (${docNo})`,
        sourceDocType: 'sales_invoice',
        sourceDocId: invoiceId,
        createdBy: userId,
        lines: [
          { subType: 'trade_receivable', debit: grand, partnerId: inv.partner_id },
          ...lines.rows.map((l) => ({ accountId: l.account_id, credit: fromDb(l.line_amount) })),
          ...(vatAmount > ZERO ? [{ subType: 'output_vat', credit: vatAmount }] : []),
        ],
      }, c);

      await this.tax.recordTaxTransaction(c, {
        companyId, branchId: inv.branch_id, kind: 'vat_output', taxPeriod,
        docDate: inv.doc_date.toISOString().slice(0, 10), docNo, docType: 'tax_invoice',
        partnerId: inv.partner_id,
        partnerName: snap.legal_name_th, partnerTaxId: snap.tax_id,
        partnerBranch: snap.branch_code, partnerAddress: snap.address,
        partnerEntityType: snap.entity_type,
        baseAmount: vatBase, taxAmount: vatAmount, vatTreatment: 'standard',
        journalEntryId: entry.id, sourceDocType: 'sales_invoice', sourceDocId: invoiceId,
      });

      await c.query(
        `UPDATE duly.sales_invoice
            SET doc_no=$2, tax_invoice_no=$2, tax_invoice_date=doc_date,
                status='issued', issued_at=now(), journal_entry_id=$3
          WHERE id=$1`,
        [invoiceId, docNo, entry.id]);

      await this.ledger.audit(c, ctx, companyId, 'sales_invoice', invoiceId, 'issue',
        { status: 'draft' }, { status: 'issued', doc_no: docNo, journal_entry: entry.entryNo });

      return this.load(c, companyId, invoiceId);
    });
  }

  /**
   * ข้อกำหนดตาม ม.86/4 — ตรวจก่อนออกเลข ไม่ใช่ตอนพิมพ์
   * ถ้าออกใบกำกับที่รายการไม่ครบ ผู้ซื้อจะใช้เครดิตภาษีซื้อไม่ได้
   */
  private assertIssuable(inv: any) {
    const snap = inv.partner_snapshot as Record<string, any>;
    const missing: string[] = [];
    if (!snap?.legal_name_th) missing.push('ชื่อผู้ซื้อ');
    if (!snap?.address) missing.push('ที่อยู่ผู้ซื้อ');
    if (!snap?.tax_id) missing.push('เลขประจำตัวผู้เสียภาษีของผู้ซื้อ');
    else if (!TaxService.isValidTaxId(snap.tax_id)) {
      throw new DomainError('TAX_ID_INVALID',
        `เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (${snap.tax_id}) ไม่ผ่านการตรวจสอบหลักที่ 13`,
        422, 'ตรวจสอบเลขกับหนังสือรับรองของลูกค้า', 'partner.tax_id');
    }
    if (!snap?.branch_code) missing.push('สำนักงานใหญ่หรือสาขาของผู้ซื้อ');

    if (missing.length > 0) {
      throw new DomainError('TAX_INVOICE_INCOMPLETE',
        `ออกใบกำกับภาษีไม่ได้เพราะข้อมูลไม่ครบตามมาตรา 86/4: ${missing.join(', ')}`,
        422, 'แก้ไขข้อมูลลูกค้าให้ครบแล้วสร้างใบกำกับใหม่', 'partner');
    }
  }

  private snapshot(p: any) {
    return {
      partner_code: p.code,
      legal_name_th: p.legal_name_th,
      legal_name_en: p.legal_name_en,
      tax_id: p.tax_id,
      branch_code: p.branch_code,
      entity_type: p.entity_type,
      address: p.address_text ?? null,
      captured_at: new Date().toISOString(),
    };
  }

  /** หน่วยนับรับเป็นรหัส (PC, SET) แล้วแปลงเป็น id — รองรับทั้งของระบบและของบริษัท */
  private async resolveUom(c: PoolClient, companyId: string, code?: string): Promise<string | null> {
    if (!code) return null;
    const r = await c.query(
      `SELECT id FROM duly.uom
        WHERE code = $1 AND (company_id = $2 OR company_id IS NULL)
        ORDER BY company_id NULLS LAST LIMIT 1`, [code, companyId]);
    if (r.rowCount === 0) {
      throw new DomainError('UOM_NOT_FOUND', `ไม่พบหน่วยนับรหัส "${code}"`, 422,
        'ตรวจสอบรหัสหน่วยนับ หรือเพิ่มหน่วยนับใหม่ในหน้าตั้งค่า', 'lines.uom');
    }
    return r.rows[0].id;
  }

  private async loadPartner(c: PoolClient, companyId: string, partnerId: string) {
    const r = await c.query(
      `SELECT p.*, (SELECT full_text_th FROM duly.partner_address a
                     WHERE a.partner_id = p.id AND a.address_kind='tax_invoice'
                     ORDER BY a.is_default DESC LIMIT 1) AS address_text
         FROM duly.partner p WHERE p.id=$1 AND p.company_id=$2`, [partnerId, companyId]);
    if (r.rowCount === 0) {
      throw new DomainError('PARTNER_NOT_FOUND', 'ไม่พบลูกค้ารายนี้ในบริษัทที่เลือกอยู่', 404);
    }
    return r.rows[0];
  }

  private async dueDateFromTerms(c: PoolClient, docDate: string, termId: string | null) {
    if (!termId) return docDate;
    const r = await c.query('SELECT days FROM duly.payment_term WHERE id=$1', [termId]);
    const days = r.rows[0]?.days ?? 0;
    const d = await c.query(`SELECT ($1::date + ($2 || ' days')::interval)::date AS due`, [docDate, days]);
    return d.rows[0].due.toISOString().slice(0, 10);
  }

  private async loadRow(c: PoolClient, companyId: string, id: string) {
    const r = await c.query('SELECT * FROM duly.sales_invoice WHERE id=$1 AND company_id=$2', [id, companyId]);
    if (r.rowCount === 0) throw new DomainError('INVOICE_NOT_FOUND', 'ไม่พบใบกำกับภาษีนี้', 404);
    return r.rows[0];
  }

  async load(c: PoolClient, companyId: string, id: string) {
    const inv = await this.loadRow(c, companyId, id);
    const lines = await c.query(
      `SELECT dl.line_no, dl.description, dl.quantity, u.code AS uom,
              dl.unit_price, dl.line_amount
         FROM duly.document_line dl
         LEFT JOIN duly.uom u ON u.id = dl.uom_id
        WHERE dl.doc_type='sales_invoice' AND dl.doc_id=$1 ORDER BY dl.line_no`, [id]);
    return {
      id: inv.id,
      docNo: inv.doc_no,
      taxInvoiceNo: inv.tax_invoice_no,
      docDate: inv.doc_date.toISOString().slice(0, 10),
      dueDate: inv.due_date.toISOString().slice(0, 10),
      status: inv.status,
      partner: inv.partner_snapshot,
      subtotal: inv.subtotal,
      vatBase: inv.vat_base,
      vatAmount: inv.vat_amount,
      grandTotal: inv.grand_total,
      journalEntryId: inv.journal_entry_id,
      lines: lines.rows,
    };
  }

  async get(ctx: TenantContext, companyId: string, id: string) {
    return this.db.transaction(ctx, (c) => this.load(c, companyId, id));
  }

  async list(ctx: TenantContext, companyId: string, period?: string) {
    return this.db.query(ctx,
      `SELECT id, doc_no, tax_invoice_no, doc_date, due_date, status,
              partner_snapshot->>'legal_name_th' AS partner_name,
              partner_snapshot->>'tax_id' AS partner_tax_id,
              vat_base, vat_amount, grand_total
         FROM duly.sales_invoice
        WHERE company_id=$1
          AND ($2::text IS NULL OR to_char(doc_date,'YYYY-MM') = $2)
        ORDER BY doc_date DESC, doc_no DESC NULLS FIRST
        LIMIT 200`, [companyId, period ?? null]);
  }
}
