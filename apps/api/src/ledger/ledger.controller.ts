import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { LedgerService } from './ledger.service';
import { DbService } from '../common/db.service';
import { DomainError } from '../common/errors';
import { money } from '../common/money';

const JournalLineInput = z.object({
  accountCode: z.string().optional(),
  subType: z.string().optional(),
  debit: z.union([z.string(), z.number()]).optional(),
  credit: z.union([z.string(), z.number()]).optional(),
  partnerId: z.string().uuid().nullish(),
  memo: z.string().optional(),
}).refine((l) => l.accountCode || l.subType, { message: 'ต้องระบุ accountCode หรือ subType' })
  .refine((l) => l.debit !== undefined || l.credit !== undefined, { message: 'ต้องระบุยอดเดบิตหรือเครดิต' });

const CreateEntryInput = z.object({
  branchId: z.string().uuid(),
  journalType: z.enum(['general','sales','purchase','receipt','payment','payroll',
                       'inventory','asset','opening','closing','adjustment']).default('general'),
  postingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  lines: z.array(JournalLineInput).min(2),
});

@Controller('api/v1/journal-entries')
export class LedgerController {
  constructor(private readonly ledger: LedgerService, private readonly db: DbService) {}

  @Get()
  list(@Req() req: Request, @Query('period') period?: string) {
    const ctx = this.require(req);
    return this.db.query(ctx,
      `SELECT e.id, e.entry_no, e.journal_type, e.posting_date, e.description, e.status,
              e.total_debit::text, e.total_credit::text, e.source_doc_type
         FROM duly.journal_entry e
        WHERE e.company_id=$1
          AND ($2::text IS NULL OR to_char(e.posting_date,'YYYY-MM')=$2)
        ORDER BY e.posting_date DESC, e.entry_no DESC
        LIMIT 200`, [ctx.companyIds[0], period ?? null]);
  }

  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    const ctx = this.require(req);
    const [entry] = await this.db.query<any>(ctx,
      `SELECT e.*, e.posting_date::text AS posting_date_text FROM duly.journal_entry e
        WHERE e.id=$1 AND e.company_id=$2`, [id, ctx.companyIds[0]]);
    if (!entry) throw new DomainError('ENTRY_NOT_FOUND', 'ไม่พบรายการบัญชีนี้', 404);
    const lines = await this.db.query(ctx,
      `SELECT l.line_no, a.code, a.name_th, l.debit::text, l.credit::text, l.memo
         FROM duly.journal_line l JOIN duly.account a ON a.id=l.account_id
        WHERE l.entry_id=$1 ORDER BY l.line_no`, [id]);
    return { ...entry, lines };
  }

  @Post()
  async create(@Req() req: Request, @Body() body: unknown) {
    const ctx = this.require(req);
    const parsed = CreateEntryInput.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new DomainError('VALIDATION_ERROR', first.message, 422, undefined, first.path.join('.'));
    }
    const input = parsed.data;
    return this.db.transaction(ctx, async (c) => {
      const lines = [];
      for (const l of input.lines) {
        let accountId: string | undefined;
        if (l.accountCode) {
          const r = await c.query('SELECT id FROM duly.account WHERE company_id=$1 AND code=$2',
            [ctx.companyIds[0], l.accountCode]);
          if (r.rowCount === 0) {
            throw new DomainError('ACCOUNT_NOT_FOUND', `ไม่พบบัญชีรหัส ${l.accountCode}`, 422);
          }
          accountId = r.rows[0].id;
        }
        lines.push({
          accountId, subType: l.subType,
          debit: l.debit !== undefined ? money(String(l.debit)) : undefined,
          credit: l.credit !== undefined ? money(String(l.credit)) : undefined,
          partnerId: l.partnerId ?? null, memo: l.memo,
        });
      }
      return this.ledger.post(ctx, {
        companyId: ctx.companyIds[0], branchId: input.branchId, journalType: input.journalType,
        postingDate: input.postingDate, docDate: input.postingDate,
        description: input.description, createdBy: ctx.userId, lines,
      }, c);
    });
  }

  @Post(':id/reverse')
  reverse(@Req() req: Request, @Param('id') id: string, @Body() body: { reason?: string; postingDate?: string }) {
    const ctx = this.require(req);
    if (!body?.reason || body.reason.trim().length < 5) {
      throw new DomainError('REASON_REQUIRED',
        'การกลับรายการต้องระบุเหตุผล เพื่อให้ผู้สอบบัญชีตรวจสอบได้ภายหลัง', 422, undefined, 'reason');
    }
    return this.ledger.reverse(ctx, id, body.reason.trim(), ctx.userId, body.postingDate);
  }

  private require(req: Request) {
    if (!req.ctx) throw new DomainError('COMPANY_CONTEXT_MISSING', 'ไม่ได้ระบุบริษัท', 400);
    return req.ctx;
  }
}
