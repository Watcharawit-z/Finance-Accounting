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
    const configured = Boolean(process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL);
    const ok = configured ? await this.db.healthy() : false;
    return {
      status: ok ? 'ok' : 'degraded',
      database: ok,
      service: 'financii-api',
      ...(ok ? {} : {
        hint: configured
          ? 'ตั้งค่าฐานข้อมูลไว้แล้วแต่ต่อไม่ได้ — ตรวจ APP_DATABASE_URL ว่าผู้ใช้และรหัสผ่านถูกต้อง'
          : 'ยังไม่ได้ตั้ง DATABASE_URL / APP_DATABASE_URL — ดู docs/18-deploy-railway.md',
      }),
    };
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
