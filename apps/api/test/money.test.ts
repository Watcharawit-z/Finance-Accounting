import { describe, expect, it } from 'vitest';
import { add, baseFromInclusive, format, fromDb, money, mul, percent, round2, toDb } from '../src/common/money';

describe('จำนวนเงินแบบทศนิยมคงที่', () => {
  it('ไม่มีปัญหาความคลาดเคลื่อนแบบเลขทศนิยมลอยตัว', () => {
    expect(toDb(add(money('0.1'), money('0.2')))).toBe('0.3000');
    // เทียบกับ float ที่ให้ 0.30000000000000004
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('ปฏิเสธรูปแบบที่ไม่ใช่จำนวนเงิน', () => {
    expect(() => money('abc')).toThrow();
    expect(() => money('1,000')).toThrow();
  });

  it('คำนวณ VAT 7% ของ 842,000 ได้ 58,940', () => {
    expect(toDb(round2(percent(money('842000'), '7')))).toBe('58940.0000');
  });

  it('★ ปัดเศษที่ระดับเอกสาร ไม่ใช่ทีละบรรทัด', () => {
    const line = money('33.33');
    // ปัดทีละบรรทัดแล้วบวก → ได้ 6.99
    const perLine = add(...[line, line, line].map((l) => round2(percent(l, '7'))));
    expect(toDb(perLine)).toBe('6.9900');
    // ปัดครั้งเดียวที่ยอดรวม → ได้ 7.00 ซึ่งเป็นวิธีที่ถูกต้อง
    const perDoc = round2(percent(add(line, line, line), '7'));
    expect(toDb(perDoc)).toBe('7.0000');
  });

  it('แยกฐานภาษีจากราคารวมภาษีได้ถูกต้อง', () => {
    expect(toDb(baseFromInclusive(money('107'), '7'))).toBe('100.0000');
    expect(toDb(baseFromInclusive(money('1070'), '7'))).toBe('1000.0000');
    const inclusive = money('999.99');
    const base = baseFromInclusive(inclusive, '7');
    const vat = round2(percent(base, '7'));
    // ฐาน + ภาษี ต้องกลับมาได้ยอดเดิม (คลาดเคลื่อนได้ไม่เกิน 1 สตางค์)
    const diff = inclusive - (base + vat);
    expect(diff >= -100n && diff <= 100n).toBe(true);
  });

  it('ปัดครึ่งขึ้นตามแนวปฏิบัติของกรมสรรพากร', () => {
    expect(toDb(round2(money('1.005')))).toBe('1.0100');
    expect(toDb(round2(money('1.004')))).toBe('1.0000');
  });

  it('คูณด้วยปริมาณที่มีทศนิยม', () => {
    expect(toDb(mul(money('158000'), '4'))).toBe('632000.0000');
    expect(toDb(mul(money('100'), '2.5'))).toBe('250.0000');
  });

  it('แปลงกลับไปกลับมากับฐานข้อมูลได้ตรงเดิม', () => {
    for (const v of ['0.0000', '1234567.8900', '-42.1500', '0.0001']) {
      expect(toDb(fromDb(v))).toBe(v);
    }
  });

  it('จัดรูปแบบตัวเลขติดลบด้วยวงเล็บตามแบบรายงานการเงิน', () => {
    expect(format(money('1234567.891'))).toBe('1,234,567.89');
    expect(format(money('-24000'))).toBe('(24,000.00)');
    expect(format(money('0'))).toBe('0.00');
  });
});
