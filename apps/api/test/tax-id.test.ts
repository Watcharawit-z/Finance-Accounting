import { describe, expect, it } from 'vitest';
import { TaxService } from '../src/tax/tax.service';

describe('เลขประจำตัวผู้เสียภาษี 13 หลัก', () => {
  it('ยอมรับเลขที่ checksum ถูกต้อง', () => {
    expect(TaxService.isValidTaxId('0105548021442')).toBe(true);
    expect(TaxService.isValidTaxId('0105559001774')).toBe(true);
    expect(TaxService.isValidTaxId('0105533001823')).toBe(true);
  });

  it('ปฏิเสธเลขที่ checksum ผิด', () => {
    // ตัวเลขเดียวกับข้างบนแต่หลักสุดท้ายผิด
    expect(TaxService.isValidTaxId('0105548021443')).toBe(false);
    expect(TaxService.isValidTaxId('0105559001770')).toBe(false);
    expect(TaxService.isValidTaxId('0000000000000')).toBe(false);
  });

  it('ปฏิเสธรูปแบบที่ไม่ใช่ตัวเลข 13 หลัก', () => {
    expect(TaxService.isValidTaxId('010554802144')).toBe(false);
    expect(TaxService.isValidTaxId('01055480214470')).toBe(false);
    expect(TaxService.isValidTaxId('010-5548-02144-7')).toBe(false);
    expect(TaxService.isValidTaxId('')).toBe(false);
  });
});
