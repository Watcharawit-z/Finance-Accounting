import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { DomainError } from './errors';
import type { TenantContext } from './db.service';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
    ctx?: TenantContext;
  }
}

/**
 * MVP: อ่าน context จาก header โดยตรง
 * ระบบจริงต้องดึงจาก access token ที่ผ่านการตรวจลายเซ็นแล้วเท่านั้น
 * และตรวจว่าผู้ใช้มีสิทธิ์ในบริษัทที่ระบุจริง (ตาราง user_company_role)
 */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    req.requestId = (req.headers['x-request-id'] as string) || randomUUID();

    // ใช้ originalUrl เพราะ middleware ที่ผูกกับ '*' จะได้ req.path เป็น '/' เสมอ
    const path = (req.originalUrl || req.url || '').split('?')[0];
    if (path === '/health') return next();

    const tenantId = req.headers['x-tenant-id'] as string | undefined;
    const companyId = req.headers['x-company-id'] as string | undefined;
    const userId = req.headers['x-user-id'] as string | undefined;

    if (!companyId || !tenantId) {
      throw new DomainError(
        'COMPANY_CONTEXT_MISSING',
        'คำขอนี้ต้องระบุบริษัทที่ทำงานอยู่',
        400,
        'ส่ง header X-Tenant-Id และ X-Company-Id มาด้วย',
      );
    }
    req.ctx = { tenantId, companyIds: [companyId], userId: userId ?? '' };
    next();
  }
}
