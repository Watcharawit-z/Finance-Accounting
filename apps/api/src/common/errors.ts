import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * ข้อผิดพลาดเชิงธุรกิจ — รหัสตรงกับ docs/14-document-states.md
 * ทุกข้อความต้องตอบ 3 คำถาม: เกิดอะไรขึ้น ทำไม จะแก้ยังไง
 */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 422,
    readonly hint?: string,
    readonly field?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

/** แปลง error จากฐานข้อมูลและจากการตรวจ schema ให้เป็นรหัสที่ผู้ใช้เข้าใจ */
export function mapDatabaseError(e: unknown): DomainError | null {
  const err = e as { code?: string; message?: string; constraint?: string; detail?: string;
                     name?: string; issues?: Array<{ message: string; path: (string|number)[] }> };

  if (err?.name === 'ZodError' && Array.isArray(err.issues) && err.issues.length > 0) {
    const first = err.issues[0];
    return new DomainError('VALIDATION_ERROR', first.message, 422, undefined,
      first.path.join('.'), { issues: err.issues });
  }

  const msg = err?.message ?? '';

  if (err?.code === '23505') {
    if (err.constraint?.includes('uq_input_vat_doc'))
      return new DomainError('DUPLICATE_VENDOR_INVOICE',
        'บันทึกใบกำกับภาษีซื้อเลขที่นี้ของผู้ขายรายนี้ไปแล้ว', 409,
        'ตรวจสอบรายการที่บันทึกไว้ก่อน หรือแก้เลขที่ใบกำกับให้ถูกต้อง');
    if (err.constraint?.includes('tax_invoice_no'))
      return new DomainError('DOC_NO_ALREADY_USED', 'เลขที่ใบกำกับภาษีนี้ถูกใช้แล้ว', 409);
    return new DomainError('DUPLICATE_KEY', 'ข้อมูลซ้ำกับรายการที่มีอยู่แล้ว', 409, undefined, undefined,
      { constraint: err.constraint });
  }

  if (msg.includes('รายการไม่สมดุล'))
    return new DomainError('ENTRY_UNBALANCED', msg, 422, 'ตรวจสอบบรรทัดรายการและอัตราแลกเปลี่ยน');
  if (msg.includes('งวดบัญชีถูกปิดแล้ว'))
    return new DomainError('PERIOD_CLOSED', msg, 409, 'ขอปลดล็อกงวด หรือเปลี่ยนวันที่เป็นงวดถัดไป', 'posting_date');
  if (msg.includes('ก่อนวันล็อกข้อมูล'))
    return new DomainError('PERIOD_LOCKED_HARD', msg, 409, undefined, 'posting_date');
  if (msg.includes('ไม่อยู่ในงวดที่ระบุ'))
    return new DomainError('DATE_OUTSIDE_PERIOD', msg, 422, 'เลือกงวดให้ตรงกับวันที่', 'posting_date');
  if (msg.includes('เป็นบัญชีหัวข้อ'))
    return new DomainError('ACCOUNT_NOT_POSTABLE', msg, 422, 'เลือกบัญชีย่อยแทน');
  if (msg.includes('ถูกปิดใช้งาน'))
    return new DomainError('ACCOUNT_INACTIVE', msg, 422);
  if (msg.includes('ต้องระบุคู่ค้า'))
    return new DomainError('PARTNER_REQUIRED', msg, 422);
  if (msg.includes('ต้องระบุมิติ'))
    return new DomainError('DIMENSION_REQUIRED', msg, 422);
  if (msg.includes('ที่ลงบัญชีแล้ว'))
    return new DomainError('ENTRY_IMMUTABLE', msg, 409, 'ใช้การกลับรายการแทนการแก้ไข');
  if (msg.includes('ยื่นแบบแล้ว'))
    return new DomainError('TAX_PERIOD_FILED', msg, 409, 'ต้องยื่นแบบเพิ่มเติมแทน');
  if (msg.includes('ยังไม่ได้ตั้งค่ารูปแบบเลขที่เอกสาร'))
    return new DomainError('SEQUENCE_NOT_CONFIGURED', msg, 422, 'ตั้งค่าเลขที่เอกสารในหน้าตั้งค่าบริษัท');
  return null;
}

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? '-';

    const mapped = exception instanceof DomainError ? exception : mapDatabaseError(exception);
    if (mapped) {
      return res.status(mapped.status).json({
        error: {
          code: mapped.code,
          message: mapped.message,
          hint: mapped.hint,
          field: mapped.field,
          details: mapped.details,
          request_id: requestId,
        },
      });
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return res.status(status).json({
        error: {
          code: status === 404 ? 'NOT_FOUND' : 'REQUEST_ERROR',
          message: typeof body === 'string' ? body : (body as any)?.message ?? exception.message,
          request_id: requestId,
        },
      });
    }
    // ข้อผิดพลาดที่ไม่คาดคิด — ห้ามเปิดเผยรายละเอียดภายในให้ผู้เรียก
    console.error('[unhandled]', requestId, exception);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: { code: 'INTERNAL_ERROR', message: 'เกิดข้อผิดพลาดภายในระบบ', request_id: requestId },
    });
  }
}
