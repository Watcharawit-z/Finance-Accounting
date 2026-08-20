import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService, TenantContext } from '../common/db.service';
import { DomainError } from '../common/errors';
import { Money, add, fromDb, isZero, toDb, ZERO } from '../common/money';

export interface PostingLine {
  accountId?: string;
  /** ค้นบัญชีจาก sub_type แทนรหัสบัญชี — ลูกค้าเปลี่ยนรหัสได้โดยไม่กระทบโค้ด */
  subType?: string;
  debit?: Money;
  credit?: Money;
  partnerId?: string | null;
  dimensions?: Record<string, string>;
  memo?: string;
}

export interface PostingRequest {
  companyId: string;
  branchId: string;
  journalType: 'general' | 'sales' | 'purchase' | 'receipt' | 'payment' | 'payroll'
             | 'inventory' | 'asset' | 'opening' | 'closing' | 'adjustment';
  postingDate: string;   // YYYY-MM-DD
  docDate: string;
  description: string;
  sourceDocType?: string;
  sourceDocId?: string;
  lines: PostingLine[];
  createdBy: string;
  isAuto?: boolean;
}

/**
 * ★ ประตูเดียวที่เขียนลงบัญชีแยกประเภทได้
 * โมดูลอื่นห้าม INSERT ลง journal_line เอง ทั้งหมดต้องผ่าน post()
 * เพื่อให้กติกาบัญชีถูกบังคับที่จุดเดียว และแก้ที่เดียวเมื่อกฎเปลี่ยน
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DbService) {}

  async post(ctx: TenantContext, req: PostingRequest, client?: PoolClient) {
    const run = (c: PoolClient) => this.postInternal(ctx, req, c);
    return client ? run(client) : this.db.transaction(ctx, run);
  }

  private async postInternal(ctx: TenantContext, req: PostingRequest, c: PoolClient) {
    if (req.lines.length < 2) {
      throw new DomainError('ENTRY_TOO_FEW_LINES',
        'รายการบัญชีต้องมีอย่างน้อย 2 บรรทัด', 422,
        'ทุกรายการต้องมีทั้งด้านเดบิตและเครดิต');
    }

    // ตรวจสมดุลก่อนแตะฐานข้อมูล เพื่อให้ข้อความผิดพลาดชี้จุดได้ชัดกว่ารอ trigger
    const totalDebit = add(...req.lines.map((l) => l.debit ?? ZERO));
    const totalCredit = add(...req.lines.map((l) => l.credit ?? ZERO));
    if (totalDebit !== totalCredit) {
      throw new DomainError('ENTRY_UNBALANCED',
        `รายการไม่สมดุล เดบิตรวม ${toDb(totalDebit)} ไม่เท่ากับเครดิตรวม ${toDb(totalCredit)}`,
        422, 'ตรวจสอบบรรทัดรายการและอัตราแลกเปลี่ยน');
    }
    if (isZero(totalDebit)) {
      throw new DomainError('ENTRY_ZERO_AMOUNT', 'ลงบัญชีรายการที่มียอดรวมเป็นศูนย์ไม่ได้', 422);
    }

    const periodId = await this.resolvePeriod(c, req.companyId, req.postingDate);
    const periodCode = await this.periodCode(c, periodId);
    const entryNo = await this.nextNumber(c, req.companyId, null, `je_${req.journalType}`, periodCode);

    const entry = await c.query(
      `INSERT INTO duly.journal_entry
         (company_id, branch_id, period_id, entry_no, journal_type, posting_date, doc_date,
          description, source_doc_type, source_doc_id, status, is_auto, total_debit, total_credit, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'draft',$11,$12,$13,$14)
       RETURNING id`,
      [req.companyId, req.branchId, periodId, entryNo, req.journalType, req.postingDate, req.docDate,
       req.description, req.sourceDocType ?? null, req.sourceDocId ?? null, req.isAuto ?? false,
       toDb(totalDebit), toDb(totalCredit), req.createdBy],
    );
    const entryId = entry.rows[0].id as string;

    let lineNo = 0;
    for (const line of req.lines) {
      lineNo += 1;
      const accountId = line.accountId ?? await this.accountBySubType(c, req.companyId, line.subType!);
      await c.query(
        `INSERT INTO duly.journal_line
           (entry_id, company_id, branch_id, posting_date, line_no, account_id,
            debit, credit, currency, fx_rate, partner_id, dimension_json, memo)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'THB',1,$9,$10,$11)`,
        [entryId, req.companyId, req.branchId, req.postingDate, lineNo, accountId,
         toDb(line.debit ?? ZERO), toDb(line.credit ?? ZERO),
         line.partnerId ?? null, JSON.stringify(line.dimensions ?? {}), line.memo ?? null],
      );
    }

    // trigger บนฐานข้อมูลจะตรวจสมดุล งวด และความถูกต้องของบัญชีอีกชั้นตอนเปลี่ยนเป็น posted
    await c.query(
      `UPDATE duly.journal_entry SET status='posted', posted_at=now(), posted_by=$2 WHERE id=$1`,
      [entryId, req.createdBy],
    );
    await c.query('SELECT duly.refresh_gl_balance($1)', [entryId]);
    await this.audit(c, ctx, req.companyId, 'journal_entry', entryId, 'post', null,
      { entry_no: entryNo, total: toDb(totalDebit) });

    // ★ คืนค่าเป็นสตริงเสมอ ไม่ใช่ bigint
    //   ถ้าปล่อย bigint ออกไป Express จะ serialize เป็น JSON ไม่ได้และตอบ 500
    //   ซึ่งเป็นข้อผิดพลาดที่ผู้เรียกแก้อะไรไม่ได้เลย
    return { id: entryId, entryNo, totalDebit: toDb(totalDebit), totalCredit: toDb(totalCredit) };
  }

  /** กลับรายการ — ทางเดียวที่แก้ตัวเลขที่ลงบัญชีแล้วได้ */
  async reverse(ctx: TenantContext, entryId: string, reason: string, userId: string, postingDate?: string) {
    return this.db.transaction(ctx, async (c) => {
      const orig = await c.query(
        `SELECT * FROM duly.journal_entry WHERE id=$1 AND status='posted'`, [entryId]);
      if (orig.rowCount === 0) {
        throw new DomainError('ENTRY_NOT_REVERSIBLE',
          'ไม่พบรายการที่ลงบัญชีแล้วตามเลขที่นี้ หรือรายการถูกกลับรายการไปแล้ว', 404);
      }
      const e = orig.rows[0];
      const lines = await c.query(
        `SELECT account_id, debit, credit, partner_id, dimension_json, memo
           FROM duly.journal_line WHERE entry_id=$1 ORDER BY line_no`, [entryId]);

      const reversal = await this.postInternal(ctx, {
        companyId: e.company_id,
        branchId: e.branch_id,
        journalType: 'adjustment',
        postingDate: postingDate ?? e.posting_date.toISOString().slice(0, 10),
        docDate: postingDate ?? e.doc_date.toISOString().slice(0, 10),
        description: `กลับรายการ ${e.entry_no}: ${reason}`,
        sourceDocType: 'journal_entry_reversal',
        sourceDocId: entryId,
        createdBy: userId,
        lines: lines.rows.map((l) => ({
          accountId: l.account_id,
          // สลับด้าน: เดบิตเดิมกลายเป็นเครดิต และเครดิตเดิมกลายเป็นเดบิต
          debit: fromDb(l.credit),
          credit: fromDb(l.debit),
          partnerId: l.partner_id,
          dimensions: l.dimension_json,
          memo: l.memo,
        })),
      }, c);

      await c.query(
        `UPDATE duly.journal_entry SET status='reversed', reversed_by_id=$2, reason=$3 WHERE id=$1`,
        [entryId, reversal.id, reason]);
      await this.audit(c, ctx, e.company_id, 'journal_entry', entryId, 'reverse',
        { status: 'posted' }, { status: 'reversed', reversal_entry: reversal.entryNo }, reason);
      return reversal;
    });
  }

  async accountBySubType(c: PoolClient, companyId: string, subType: string): Promise<string> {
    const r = await c.query('SELECT duly.account_by_subtype($1,$2) AS id', [companyId, subType]);
    const id = r.rows[0]?.id;
    if (!id) {
      throw new DomainError('ACCOUNT_MAPPING_MISSING',
        `ยังไม่ได้ผูกบัญชีสำหรับประเภท "${subType}" ในผังบัญชีของบริษัทนี้`, 422,
        'เพิ่มบัญชีที่มี sub_type นี้ในผังบัญชี แล้วลองใหม่');
    }
    return id;
  }

  private async resolvePeriod(c: PoolClient, companyId: string, date: string): Promise<string> {
    const r = await c.query(
      `SELECT id FROM duly.accounting_period
        WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date`, [companyId, date]);
    if (r.rowCount === 0) {
      throw new DomainError('PERIOD_NOT_FOUND',
        `ยังไม่ได้สร้างงวดบัญชีที่ครอบคลุมวันที่ ${date}`, 422,
        'สร้างรอบบัญชีและงวดในหน้าตั้งค่าบริษัทก่อน', 'posting_date');
    }
    return r.rows[0].id;
  }

  private async periodCode(c: PoolClient, periodId: string): Promise<string> {
    const r = await c.query('SELECT code FROM duly.accounting_period WHERE id=$1', [periodId]);
    return r.rows[0].code;
  }

  async nextNumber(c: PoolClient, companyId: string, branchId: string | null,
                   docType: string, periodKey: string): Promise<string> {
    const r = await c.query('SELECT duly.next_document_no($1,$2,$3,$4) AS no',
      [companyId, branchId, docType, periodKey]);
    return r.rows[0].no;
  }

  async audit(c: PoolClient, ctx: TenantContext, companyId: string, entityType: string,
              entityId: string, action: string, before: unknown, after: unknown, reason?: string) {
    await c.query(
      `INSERT INTO duly.audit_event
         (tenant_id, company_id, actor_user_id, entity_type, entity_id, action, before_json, after_json, reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.tenantId, companyId, ctx.userId || null, entityType, entityId, action,
       before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason ?? null]);
  }
}
