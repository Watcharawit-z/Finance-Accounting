import { Controller, Get, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ReportsService } from './reports.service';
import { DomainError } from '../common/errors';

@Controller('api/v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  trialBalance(@Req() req: Request, @Query('from') from: string, @Query('to') to: string) {
    const ctx = this.require(req);
    this.assertDates({ from, to });
    return this.reports.trialBalance(ctx, ctx.companyIds[0], from, to);
  }

  @Get('vat')
  vat(@Req() req: Request, @Query('kind') kind: string, @Query('period') period: string) {
    const ctx = this.require(req);
    if (kind !== 'vat_output' && kind !== 'vat_input') {
      throw new DomainError('INVALID_PARAM', 'kind ต้องเป็น vat_output หรือ vat_input', 400, undefined, 'kind');
    }
    if (!/^\d{4}-\d{2}$/.test(period ?? '')) {
      throw new DomainError('INVALID_PARAM', 'period ต้องเป็นรูปแบบ YYYY-MM', 400, undefined, 'period');
    }
    return this.reports.vatReport(ctx, ctx.companyIds[0], kind, period);
  }

  @Get('balance-sheet')
  balanceSheet(@Req() req: Request, @Query('as_of') asOf: string) {
    const ctx = this.require(req);
    this.assertDates({ as_of: asOf });
    return this.reports.balanceSheet(ctx, ctx.companyIds[0], asOf);
  }

  @Get('income-statement')
  incomeStatement(@Req() req: Request, @Query('from') from: string, @Query('to') to: string) {
    const ctx = this.require(req);
    this.assertDates({ from, to });
    return this.reports.incomeStatement(ctx, ctx.companyIds[0], from, to);
  }

  @Get('reconciliation')
  reconciliation(@Req() req: Request, @Query('as_of') asOf: string) {
    const ctx = this.require(req);
    this.assertDates({ as_of: asOf });
    return this.reports.reconciliationChecks(ctx, ctx.companyIds[0], asOf);
  }

  private assertDates(params: Record<string, string>) {
    for (const [k, v] of Object.entries(params)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v ?? '')) {
        throw new DomainError('INVALID_PARAM', `${k} ต้องเป็นวันที่รูปแบบ YYYY-MM-DD`, 400, undefined, k);
      }
    }
  }

  private require(req: Request) {
    if (!req.ctx) throw new DomainError('COMPANY_CONTEXT_MISSING', 'ไม่ได้ระบุบริษัท', 400);
    return req.ctx;
  }
}
