import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { CreateInvoiceInput, InvoiceService } from './invoice.service';
import { DomainError } from '../common/errors';

@Controller('api/v1/sales-invoices')
export class InvoiceController {
  constructor(private readonly invoices: InvoiceService) {}

  @Get()
  list(@Req() req: Request, @Query('period') period?: string) {
    const { ctx } = this.require(req);
    return this.invoices.list(ctx, ctx.companyIds[0], period);
  }

  @Get(':id')
  get(@Req() req: Request, @Param('id') id: string) {
    const { ctx } = this.require(req);
    return this.invoices.get(ctx, ctx.companyIds[0], id);
  }

  @Post()
  async create(@Req() req: Request, @Body() body: unknown) {
    const { ctx } = this.require(req);
    const parsed = CreateInvoiceInput.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new DomainError('VALIDATION_ERROR', first.message, 422, undefined, first.path.join('.'),
        { issues: parsed.error.issues });
    }
    return this.invoices.createDraft(ctx, ctx.companyIds[0], parsed.data, ctx.userId);
  }

  @Post(':id/issue')
  issue(@Req() req: Request, @Param('id') id: string) {
    const { ctx } = this.require(req);
    return this.invoices.issue(ctx, ctx.companyIds[0], id, ctx.userId);
  }

  private require(req: Request) {
    if (!req.ctx) throw new DomainError('COMPANY_CONTEXT_MISSING', 'ไม่ได้ระบุบริษัท', 400);
    return { ctx: req.ctx };
  }
}
