import { Controller, Get, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { DbService } from './common/db.service';
import { ContextMiddleware } from './common/context.middleware';
import { LedgerService } from './ledger/ledger.service';
import { LedgerController } from './ledger/ledger.controller';
import { TaxService } from './tax/tax.service';
import { InvoiceService } from './ar/invoice.service';
import { InvoiceController } from './ar/invoice.controller';
import { ReportsService } from './reports/reports.service';
import { ReportsController } from './reports/reports.controller';
import { CompanyController } from './company/company.controller';

@Controller()
class HealthController {
  constructor(private readonly db: DbService) {}
  @Get('health')
  async health() {
    const ok = await this.db.healthy();
    return { status: ok ? 'ok' : 'degraded', database: ok, service: 'duly-api' };
  }
}

@Module({
  controllers: [HealthController, CompanyController, LedgerController, InvoiceController, ReportsController],
  providers: [DbService, LedgerService, TaxService, InvoiceService, ReportsService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(ContextMiddleware).forRoutes('*');
  }
}
