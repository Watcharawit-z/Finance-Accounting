/**
 * จำนวนเงินแบบทศนิยมคงที่ 4 ตำแหน่ง เก็บเป็น bigint
 * ห้ามใช้ number กับเงินเด็ดขาด — 0.1 + 0.2 !== 0.3 ในเลขทศนิยมลอยตัว
 * ฐานข้อมูลใช้ numeric(19,4) จึงใช้สเกลเดียวกัน
 */
export const SCALE = 4;
const FACTOR = 10n ** BigInt(SCALE);

export type Money = bigint;

export function money(v: string | number | bigint): Money {
  if (typeof v === 'bigint') return v;
  const s = typeof v === 'number' ? v.toString() : String(v).trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`รูปแบบจำนวนเงินไม่ถูกต้อง: ${v}`);
  const negative = s.startsWith('-');
  const [int, frac = ''] = (negative ? s.slice(1) : s).split('.');
  const padded = (frac + '0'.repeat(SCALE)).slice(0, SCALE);
  let base = BigInt(int) * FACTOR + BigInt(padded || '0');
  const extra = frac.slice(SCALE);
  if (extra && Number(extra[0]) >= 5) base += 1n;      // ปัดครึ่งขึ้นจากทศนิยมที่เกินสเกล
  return negative ? -base : base;
}

export const ZERO: Money = 0n;
export const add = (...xs: Money[]): Money => xs.reduce((a, b) => a + b, 0n);
export const sub = (a: Money, b: Money): Money => a - b;
export const isZero = (a: Money): boolean => a === 0n;

/** หารแบบปัดครึ่งขึ้น (แนวปฏิบัติที่ใช้กับภาษีในไทย) */
export function divRound(numerator: bigint, denominator: bigint): Money {
  if (denominator === 0n) throw new Error('หารด้วยศูนย์');
  const negative = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** คูณด้วยจำนวน เช่น ปริมาณ 4 หรือ 2.5 */
export function mul(a: Money, factor: string | number): Money {
  return divRound(a * money(factor), FACTOR);
}

/** คูณด้วยอัตราร้อยละ: percent(1000, 7) = 70 */
export function percent(a: Money, rate: string | number): Money {
  return divRound(a * money(rate), FACTOR * 100n);
}

/** ปัดเป็นทศนิยม 2 ตำแหน่ง — ใช้กับยอดที่พิมพ์ลงเอกสาร */
export function round2(a: Money): Money {
  const unit = 10n ** BigInt(SCALE - 2);
  return divRound(a, unit) * unit;
}

/**
 * แยกฐานภาษีออกจากราคารวมภาษี
 *   base = inclusive × 100 ÷ (100 + rate)
 * ต้องคำนวณครั้งเดียวแบบนี้ ไม่ใช่ inclusive × 7 ÷ 107 แยกส่วน
 */
export function baseFromInclusive(inclusive: Money, rate: string | number): Money {
  const r = money(rate);
  return round2(divRound(inclusive * 100n * FACTOR, 100n * FACTOR + r));
}

export function toDb(a: Money): string {
  const negative = a < 0n;
  const abs = negative ? -a : a;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

export function fromDb(v: string | number | null | undefined): Money {
  if (v === null || v === undefined) return 0n;
  return money(typeof v === 'number' ? v.toString() : v);
}

/** จัดรูปแบบแสดงผล: 1,234,567.89 — ยอดติดลบใช้วงเล็บตามแบบรายงานการเงิน */
export function format(a: Money, decimals = 2): string {
  const negative = a < 0n;
  const abs = negative ? -a : a;
  const unit = 10n ** BigInt(SCALE - decimals);
  const rounded = divRound(abs, unit);
  const p = 10n ** BigInt(decimals);
  const int = rounded / p;
  const frac = (rounded % p).toString().padStart(decimals, '0');
  const grouped = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const body = decimals > 0 ? `${grouped}.${frac}` : grouped;
  return negative ? `(${body})` : body;
}
