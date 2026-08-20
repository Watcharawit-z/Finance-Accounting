import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { DbService } from '../common/db.service';
import { DomainError } from '../common/errors';

@Controller('api/v1')
export class CompanyController {
  constructor(private readonly db: DbService) {}

  @Get('company')
  async company(@Req() req: Request) {
    const ctx = this.require(req);
    const [row] = await this.db.query<any>(ctx,
      `SELECT c.id, c.code, c.legal_name_th, c.tax_id, c.is_vat_registered,
              c.fiscal_year_end_mm, c.base_currency, c.accounting_standard, c.hard_lock_date,
              (SELECT json_agg(json_build_object('id',b.id,'code',b.code,'name',b.name_th,
                                                 'isHeadOffice',b.is_head_office) ORDER BY b.code)
                 FROM duly.branch b WHERE b.company_id=c.id AND b.is_active) AS branches
         FROM duly.company c WHERE c.id=$1`, [ctx.companyIds[0]]);
    if (!row) throw new DomainError('COMPANY_NOT_FOUND', 'ไม่พบบริษัทนี้ หรือไม่มีสิทธิ์เข้าถึง', 404);
    return row;
  }

  @Get('accounts')
  accounts(@Req() req: Request, @Query('postable') postable?: string) {
    const ctx = this.require(req);
    return this.db.query(ctx,
      `SELECT code, name_th, name_en, account_type, sub_type, is_postable, level
         FROM duly.account
        WHERE company_id=$1 AND is_active
          AND ($2::bool IS NULL OR is_postable = $2::bool)
        ORDER BY code`, [ctx.companyIds[0], postable === undefined ? null : postable === 'true']);
  }

  @Get('partners')
  partners(@Req() req: Request, @Query('kind') kind?: string) {
    const ctx = this.require(req);
    return this.db.query(ctx,
      `SELECT id, code, legal_name_th, entity_type, tax_id, branch_code, kind
         FROM duly.partner
        WHERE company_id=$1 AND is_active
          AND ($2::text IS NULL OR kind::text = $2 OR kind = 'both')
        ORDER BY code`, [ctx.companyIds[0], kind ?? null]);
  }

  @Get('periods')
  periods(@Req() req: Request) {
    const ctx = this.require(req);
    return this.db.query(ctx,
      `SELECT code, start_date::text, end_date::text, status
         FROM duly.accounting_period WHERE company_id=$1 ORDER BY start_date`, [ctx.companyIds[0]]);
  }

  private require(req: Request) {
    if (!req.ctx) throw new DomainError('COMPANY_CONTEXT_MISSING', 'ไม่ได้ระบุบริษัท', 400);
    return req.ctx;
  }
}
