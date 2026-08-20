import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DomainError, mapDatabaseError } from './errors';

export interface TenantContext {
  tenantId: string;
  companyIds: string[];
  userId: string;
}

/**
 * ทุกคำสั่งต้องรันภายใต้ tenant context เพื่อให้ Row Level Security ทำงาน
 * แอปเชื่อมด้วย role duly_app ซึ่งไม่ใช่ superuser จึงถูก RLS บังคับจริง
 */
@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgres://duly_app@localhost/duly',
      max: Number(process.env.DB_POOL_MAX ?? 10),
      application_name: 'duly-api',
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }

  private async applyContext(client: PoolClient, ctx: TenantContext) {
    await client.query('SELECT set_config($1,$2,true), set_config($3,$4,true), set_config($5,$6,true)', [
      'app.tenant_id', ctx.tenantId,
      'app.company_ids', ctx.companyIds.join(','),
      'app.user_id', ctx.userId,
    ]);
  }

  /** อ่านอย่างเดียว — ยังต้องอยู่ใน transaction เพราะ set_config เป็น local */
  async query<T = any>(ctx: TenantContext, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.transaction(ctx, async (client) => {
      const res = await client.query(sql, params as any[]);
      return res.rows as T[];
    });
  }

  /**
   * ทุกการเปลี่ยนแปลงข้อมูลต้องอยู่ใน transaction เดียว
   * เอกสาร + รายการบัญชี + ทะเบียนภาษี ต้อง commit พร้อมกันหรือไม่เกิดเลย
   */
  async transaction<T>(ctx: TenantContext, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.applyContext(client, ctx);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      // แปลงที่นี่ ไม่ใช่ที่ชั้น HTTP เท่านั้น — งาน background และการนำเข้าข้อมูล
      // ก็ต้องได้ error แบบเดียวกันเพื่อจัดการต่อได้ถูก
      if (e instanceof DomainError) throw e;
      throw mapDatabaseError(e) ?? e;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<boolean> {
    try {
      const r = await this.pool.query('SELECT 1 AS ok');
      return r.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }
}
