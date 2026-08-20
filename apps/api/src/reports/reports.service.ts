import { Injectable } from '@nestjs/common';
import { DbService, TenantContext } from '../common/db.service';
import { format, fromDb } from '../common/money';

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  /** งบทดลอง — เดบิตรวมต้องเท่ากับเครดิตรวมเสมอ */
  async trialBalance(ctx: TenantContext, companyId: string, from: string, to: string) {
    const rows = await this.db.query<any>(ctx,
      `SELECT a.code, a.name_th, a.account_type, a.sub_type,
              COALESCE(SUM(l.debit_base)  FILTER (WHERE l.posting_date BETWEEN $2 AND $3), 0)::text AS debit,
              COALESCE(SUM(l.credit_base) FILTER (WHERE l.posting_date BETWEEN $2 AND $3), 0)::text AS credit,
              COALESCE(SUM(l.debit_base - l.credit_base) FILTER (WHERE l.posting_date < $2), 0)::text AS opening,
              COALESCE(SUM(l.debit_base - l.credit_base) FILTER (WHERE l.posting_date <= $3), 0)::text AS closing
         FROM duly.account a
         LEFT JOIN duly.journal_line l ON l.account_id = a.id
         LEFT JOIN duly.journal_entry e ON e.id = l.entry_id AND e.status IN ('posted','reversed')
        WHERE a.company_id = $1 AND a.is_postable
        GROUP BY a.id, a.code, a.name_th, a.account_type, a.sub_type
       HAVING COALESCE(SUM(l.debit_base),0) <> 0 OR COALESCE(SUM(l.credit_base),0) <> 0
        ORDER BY a.code`,
      [companyId, from, to]);

    const totalDebit = rows.reduce((acc: bigint, r: any) => acc + fromDb(r.debit), 0n);
    const totalCredit = rows.reduce((acc: bigint, r: any) => acc + fromDb(r.credit), 0n);
    return {
      period: { from, to },
      rows: rows.map((r) => ({
        code: r.code, name: r.name_th, accountType: r.account_type, subType: r.sub_type,
        opening: r.opening, debit: r.debit, credit: r.credit, closing: r.closing,
      })),
      totals: {
        debit: totalDebit.toString(), credit: totalCredit.toString(),
        debitFormatted: format(totalDebit), creditFormatted: format(totalCredit),
        balanced: totalDebit === totalCredit,
      },
    };
  }

  /** รายงานภาษีขาย/ซื้อ ตามรูปแบบประกาศอธิบดี — แยกตามสาขา */
  async vatReport(ctx: TenantContext, companyId: string, kind: 'vat_output' | 'vat_input',
                  taxPeriod: string, branchId?: string) {
    const rows = await this.db.query<any>(ctx,
      `SELECT row_number() OVER (ORDER BY doc_date, doc_no) AS seq,
              to_char(doc_date,'DD/MM/') || (extract(year from doc_date)::int + 543)::text AS doc_date_th,
              doc_date, doc_no, doc_type, partner_name, partner_tax_id, partner_branch,
              base_amount::text, tax_amount::text, vat_treatment
         FROM duly.tax_transaction
        WHERE company_id=$1 AND kind=$2 AND tax_period=$3
          AND ($4::uuid IS NULL OR branch_id = $4)
        ORDER BY doc_date, doc_no`,
      [companyId, kind, taxPeriod, branchId ?? null]);

    const base = rows.reduce((acc: bigint, r: any) => acc + fromDb(r.base_amount), 0n);
    const tax = rows.reduce((acc: bigint, r: any) => acc + fromDb(r.tax_amount), 0n);

    // ★ ต้องกระทบกับบัญชีแยกประเภทเสมอ ไม่งั้นยื่นแบบด้วยตัวเลขที่ไม่ตรงกับบัญชี
    const controlSubType = kind === 'vat_output' ? 'output_vat' : 'input_vat';
    const control = await this.db.query<any>(ctx,
      `SELECT COALESCE(SUM(l.credit_base - l.debit_base),0)::text AS amount
         FROM duly.journal_line l
         JOIN duly.journal_entry e ON e.id = l.entry_id AND e.status IN ('posted','reversed')
         JOIN duly.account a ON a.id = l.account_id
        WHERE l.company_id=$1 AND a.sub_type=$2 AND to_char(l.posting_date,'YYYY-MM')=$3`,
      [companyId, controlSubType, taxPeriod]);

    const controlAmount = kind === 'vat_output'
      ? fromDb(control[0]?.amount)
      : -fromDb(control[0]?.amount);
    const difference = tax - controlAmount;

    return {
      kind, taxPeriod, rows,
      totals: { base: base.toString(), tax: tax.toString(),
                baseFormatted: format(base), taxFormatted: format(tax) },
      reconciliation: {
        ledgerAmount: controlAmount.toString(),
        difference: difference.toString(),
        matched: difference === 0n,
        note: difference === 0n
          ? 'ยอดในรายงานตรงกับบัญชีแยกประเภท'
          : `ยอดต่างจากบัญชีแยกประเภท ${format(difference)} บาท — ต้องหาสาเหตุก่อนยื่นแบบ`,
      },
    };
  }

  /** งบแสดงฐานะการเงินจากนิยามรายงานในฐานข้อมูล */
  async balanceSheet(ctx: TenantContext, companyId: string, asOf: string) {
    const rows = await this.db.query<any>(ctx,
      `SELECT seq_no, label_th, section, amount::text
         FROM duly.report_detail_lines($1,'BS','1900-01-01'::date,$2::date)`,
      [companyId, asOf]);
    const check = await this.db.query<any>(ctx,
      'SELECT duly.balance_sheet_check($1,$2::date)::text AS diff', [companyId, asOf]);
    const diff = fromDb(check[0]?.diff);
    return {
      asOf,
      lines: rows,
      assets: format(rows.filter((r) => r.section === 'asset')
        .reduce((acc: bigint, r: any) => acc + fromDb(r.amount), 0n)),
      liabilitiesAndEquity: format(rows.filter((r) => r.section === 'liability_equity')
        .reduce((acc: bigint, r: any) => acc + fromDb(r.amount), 0n)),
      balanced: diff === 0n,
      difference: format(diff),
    };
  }

  async incomeStatement(ctx: TenantContext, companyId: string, from: string, to: string) {
    const rows = await this.db.query<any>(ctx,
      `SELECT seq_no, label_th, section, amount::text
         FROM duly.report_detail_lines($1,'PL_FUNCTION',$2::date,$3::date)`,
      [companyId, from, to]);
    const revenue = rows.filter((r) => r.section === 'revenue')
      .reduce((acc: bigint, r: any) => acc + fromDb(r.amount), 0n);
    const expense = rows.filter((r) => r.section === 'expense')
      .reduce((acc: bigint, r: any) => acc + fromDb(r.amount), 0n);
    return {
      period: { from, to }, lines: rows,
      revenue: format(revenue), expense: format(expense),
      netProfit: format(revenue - expense),
    };
  }

  /** ตรวจยอดคุมกับบัญชีย่อย — job นี้ต้องรันทุกคืนบน production */
  async reconciliationChecks(ctx: TenantContext, companyId: string, asOf: string) {
    const checks: Array<{ code: string; label: string; control: string; subledger: string; ok: boolean }> = [];

    const ar = await this.db.query<any>(ctx,
      `SELECT
         (SELECT COALESCE(SUM(l.debit_base - l.credit_base),0)
            FROM duly.journal_line l
            JOIN duly.journal_entry e ON e.id=l.entry_id AND e.status IN ('posted','reversed')
            JOIN duly.account a ON a.id=l.account_id
           WHERE l.company_id=$1 AND a.sub_type='trade_receivable' AND l.posting_date <= $2)::text AS control,
         (SELECT COALESCE(SUM(grand_total - paid_amount - credited_amount),0)
            FROM duly.sales_invoice
           WHERE company_id=$1 AND status IN ('issued','partially_paid') AND doc_date <= $2)::text AS subledger`,
      [companyId, asOf]);
    const arControl = fromDb(ar[0].control), arSub = fromDb(ar[0].subledger);
    checks.push({ code: 'AR_SUBLEDGER', label: 'ลูกหนี้รายรายรวม = บัญชีคุมลูกหนี้',
      control: format(arControl), subledger: format(arSub), ok: arControl === arSub });

    const gl = await this.db.query<any>(ctx,
      `SELECT COALESCE(SUM(l.debit_base - l.credit_base),0)::text AS diff
         FROM duly.journal_line l
         JOIN duly.journal_entry e ON e.id=l.entry_id AND e.status IN ('posted','reversed')
        WHERE l.company_id=$1 AND l.posting_date <= $2`, [companyId, asOf]);
    const glDiff = fromDb(gl[0].diff);
    checks.push({ code: 'GL_BALANCED', label: 'เดบิตรวม = เครดิตรวม ทั้งฐานข้อมูล',
      control: format(glDiff), subledger: '0.00', ok: glDiff === 0n });

    const suspense = await this.db.query<any>(ctx,
      `SELECT COALESCE(SUM(l.debit_base - l.credit_base),0)::text AS amount
         FROM duly.journal_line l
         JOIN duly.journal_entry e ON e.id=l.entry_id AND e.status IN ('posted','reversed')
         JOIN duly.account a ON a.id=l.account_id
        WHERE l.company_id=$1 AND a.sub_type='suspense' AND l.posting_date <= $2`, [companyId, asOf]);
    const susAmount = fromDb(suspense[0].amount);
    checks.push({ code: 'SUSPENSE_ZERO', label: 'บัญชีพักต้องเป็นศูนย์ก่อนปิดงวด',
      control: format(susAmount), subledger: '0.00', ok: susAmount === 0n });

    return { asOf, checks, allPassed: checks.every((c) => c.ok) };
  }
}
