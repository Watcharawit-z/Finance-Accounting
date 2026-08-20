import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { DomainExceptionFilter } from '../src/common/errors';
import { BRANCH, COMPANY, CUSTOMER, TENANT, USER } from './helpers';

let app: INestApplication;
let base: string;

const headers = {
  'Content-Type': 'application/json',
  'X-Tenant-Id': TENANT,
  'X-Company-Id': COMPANY,
  'X-User-Id': USER,
};

beforeAll(async () => {
  app = await NestFactory.create(AppModule, { logger: false });
  app.useGlobalFilters(new DomainExceptionFilter());
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => { await app.close(); });

describe('สัญญาของ HTTP API', () => {
  it('/health ใช้ได้โดยไม่ต้องระบุบริษัท', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', database: true });
  });

  it('ปฏิเสธคำขอที่ไม่ระบุบริษัท พร้อมบอกวิธีแก้', async () => {
    const res = await fetch(`${base}/api/v1/company`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('COMPANY_CONTEXT_MISSING');
    expect(body.error.hint).toContain('X-Company-Id');
    expect(body.error.request_id).toBeTruthy();
  });

  it('คืนข้อมูลบริษัทพร้อมสาขา', async () => {
    const res = await fetch(`${base}/api/v1/company`, { headers });
    const body = await res.json();
    expect(body.tax_id).toBe('0105548021442');
    expect(body.branches[0].code).toBe('00000');
  });

  it('สร้างและออกใบกำกับภาษีผ่าน HTTP ได้ครบวงจร', async () => {
    const created = await fetch(`${base}/api/v1/sales-invoices`, {
      method: 'POST', headers,
      body: JSON.stringify({
        branchId: BRANCH, partnerId: CUSTOMER, docDate: '2026-09-10',
        lines: [{ description: 'บริการติดตั้งระบบ', quantity: 2, unitPrice: '25000' }],
      }),
    });
    expect(created.status).toBe(201);
    const draft = await created.json();
    expect(draft.vatAmount).toBe('3500.0000');
    expect(draft.grandTotal).toBe('53500.0000');

    const issued = await (await fetch(`${base}/api/v1/sales-invoices/${draft.id}/issue`,
      { method: 'POST', headers })).json();
    expect(issued.status).toBe('issued');
    expect(issued.docNo).toMatch(/^INV2609-\d{5}$/);

    const list = await (await fetch(`${base}/api/v1/sales-invoices?period=2026-09`, { headers })).json();
    expect(list.some((r: any) => r.doc_no === issued.docNo)).toBe(true);
  });

  it('คืนข้อผิดพลาดในรูปแบบเดียวกันเสมอ พร้อมรหัสและฟิลด์ที่ผิด', async () => {
    const res = await fetch(`${base}/api/v1/sales-invoices`, {
      method: 'POST', headers,
      body: JSON.stringify({ branchId: BRANCH, partnerId: CUSTOMER, docDate: '15/09/2026', lines: [] }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.field).toBeTruthy();
    expect(body.error.request_id).toBeTruthy();
  });

  it('ปฏิเสธรายการบัญชีที่ไม่สมดุลด้วยข้อความที่บอกตัวเลขทั้งสองด้าน', async () => {
    const res = await fetch(`${base}/api/v1/journal-entries`, {
      method: 'POST', headers,
      body: JSON.stringify({
        branchId: BRANCH, postingDate: '2026-09-11', description: 'ทดสอบไม่สมดุล',
        lines: [{ accountCode: '1113', debit: '1000' }, { accountCode: '4111', credit: '900' }],
      }),
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('ENTRY_UNBALANCED');
    expect(body.error.message).toContain('1000');
    expect(body.error.message).toContain('900');
  });

  it('บังคับให้ระบุเหตุผลเมื่อกลับรายการ', async () => {
    const posted = await (await fetch(`${base}/api/v1/journal-entries`, {
      method: 'POST', headers,
      body: JSON.stringify({
        branchId: BRANCH, postingDate: '2026-09-12', description: 'รายการที่จะกลับ',
        lines: [{ accountCode: '1113', debit: '5000' }, { accountCode: '4111', credit: '5000' }],
      }),
    })).json();

    const noReason = await fetch(`${base}/api/v1/journal-entries/${posted.id}/reverse`,
      { method: 'POST', headers, body: JSON.stringify({}) });
    expect((await noReason.json()).error.code).toBe('REASON_REQUIRED');

    const withReason = await fetch(`${base}/api/v1/journal-entries/${posted.id}/reverse`,
      { method: 'POST', headers, body: JSON.stringify({ reason: 'คีย์ผิดบัญชี ต้องกลับรายการ' }) });
    expect(withReason.status).toBe(201);
  });

  it('ไม่มี bigint หลุดออกไปกับ response (Express serialize ไม่ได้)', async () => {
    const posted = await fetch(`${base}/api/v1/journal-entries`, {
      method: 'POST', headers,
      body: JSON.stringify({
        branchId: BRANCH, postingDate: '2026-09-13', description: 'ตรวจการ serialize',
        lines: [{ accountCode: '1113', debit: '1' }, { accountCode: '4111', credit: '1' }],
      }),
    });
    expect(posted.status).toBe(201);
    const body = await posted.json();
    expect(typeof body.totalDebit).toBe('string');
    expect(body.totalDebit).toBe('1.0000');
  });

  it('งบทดลองที่ดึงผ่าน HTTP สมดุล', async () => {
    const tb = await (await fetch(
      `${base}/api/v1/reports/trial-balance?from=2026-01-01&to=2026-12-31`, { headers })).json();
    expect(tb.totals.balanced).toBe(true);
  });

  it('ตรวจพารามิเตอร์ของรายงาน', async () => {
    const res = await fetch(`${base}/api/v1/reports/vat?kind=ผิด&period=2026-09`, { headers });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_PARAM');
  });
});
