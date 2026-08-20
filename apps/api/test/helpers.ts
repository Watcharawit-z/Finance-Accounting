import { DbService, TenantContext } from '../src/common/db.service';
import { LedgerService } from '../src/ledger/ledger.service';
import { TaxService } from '../src/tax/tax.service';
import { InvoiceService } from '../src/ar/invoice.service';
import { ReportsService } from '../src/reports/reports.service';

export const TENANT = '11111111-1111-1111-1111-111111111111';
export const COMPANY = '22222222-2222-2222-2222-222222222222';
export const BRANCH = '33333333-3333-3333-3333-333333333333';
export const USER = '44444444-4444-4444-4444-444444444444';
export const CUSTOMER = '88888888-8888-8888-8888-888888888888';
export const CUSTOMER_BAD_TAXID = '88888888-8888-8888-8888-888888888889';

export const ctx: TenantContext = { tenantId: TENANT, companyIds: [COMPANY], userId: USER };

process.env.DATABASE_URL = process.env.DATABASE_URL
  ?? 'postgres://duly_app:duly_dev_only@127.0.0.1:5432/duly_dev';

export function buildServices() {
  const db = new DbService();
  const ledger = new LedgerService(db);
  const tax = new TaxService(db);
  const invoices = new InvoiceService(db, ledger, tax);
  const reports = new ReportsService(db);
  return { db, ledger, tax, invoices, reports };
}

export async function expectError(fn: () => Promise<unknown>, code: string) {
  try {
    await fn();
  } catch (e: any) {
    const actual = e?.code ?? e?.constructor?.name;
    if (actual !== code) {
      throw new Error(`คาดว่าจะได้รหัสข้อผิดพลาด ${code} แต่ได้ ${actual}: ${e?.message}`);
    }
    return e;
  }
  throw new Error(`คาดว่าจะล้มเหลวด้วยรหัส ${code} แต่ทำสำเร็จ`);
}
