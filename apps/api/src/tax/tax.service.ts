import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DbService, TenantContext } from '../common/db.service';
import { DomainError } from '../common/errors';
import { Money, ZERO, add, money, percent, round2, toDb } from '../common/money';

export type VatTreatment = 'standard' | 'zero_rated' | 'exempt' | 'out_of_scope' | 'non_claimable';

export interface TaxLine {
  amount: Money;
  taxCode: string;          // เช่น VAT7_OUT
}

export interface VatBreakdown {
  standardBase: Money;
  zeroBase: Money;
  exemptBase: Money;
  vatAmount: Money;
  grandTotal: Money;
  rateUsed: string;
}

@Injectable()
export class TaxService {
  constructor(private readonly db: DbService) {}

  /**
   * ★ อัตราภาษีต้อง lookup ด้วย "วันที่ของเอกสาร" เสมอ ไม่ใช่วันที่ปัจจุบัน
   * ไม่งั้นการแก้เอกสารย้อนหลังจะทำให้ตัวเลขเปลี่ยนไปจากที่ยื่นภาษีไปแล้ว
   */
  async resolveRate(
    c: PoolClient, code: string, onDate: string, conditions: Record<string, string> = {},
  ): Promise<{ rate: string; taxCodeId: string; treatment: VatTreatment | null }> {
    const r = await c.query(
      `SELECT tr.rate::text AS rate, tc.id AS tax_code_id, tc.vat_treatment,
              tr.condition_json,
              (SELECT count(*) FROM jsonb_object_keys(tr.condition_json)) AS specificity
         FROM duly.tax_rate tr
         JOIN duly.tax_code tc ON tc.id = tr.tax_code_id
        WHERE tc.code = $1
          AND tc.company_id IS NULL
          AND $2::date BETWEEN tr.effective_from AND COALESCE(tr.effective_to, DATE '9999-12-31')
          AND tr.condition_json <@ $3::jsonb
        ORDER BY specificity DESC, tr.effective_from DESC
        LIMIT 1`,
      [code, onDate, JSON.stringify(conditions)],
    );
    if (r.rowCount === 0) {
      throw new DomainError('TAX_RATE_NOT_FOUND',
        `ไม่พบอัตราภาษีที่มีผลบังคับ ณ วันที่ ${onDate} สำหรับรหัส ${code}`,
        422, 'ตรวจสอบตารางอัตราภาษี — อาจมีประกาศใหม่ที่ยังไม่ได้บันทึกเข้าระบบ');
    }
    return {
      rate: r.rows[0].rate,
      taxCodeId: r.rows[0].tax_code_id,
      treatment: r.rows[0].vat_treatment,
    };
  }

  /**
   * คำนวณ VAT ระดับเอกสาร
   * ★ ปัดเศษครั้งเดียวที่ยอดรวมของแต่ละกลุ่มอัตรา ไม่ใช่ปัดทีละบรรทัด
   *   ถ้าปัดทีละบรรทัดจะได้ตัวเลขต่างจากใบกำกับที่คู่ค้าออก
   */
  async computeVat(c: PoolClient, lines: TaxLine[], docDate: string): Promise<VatBreakdown> {
    let standardBase = ZERO, zeroBase = ZERO, exemptBase = ZERO;
    let rateUsed = '0.0000';

    for (const line of lines) {
      const { rate, treatment } = await this.resolveRate(c, line.taxCode, docDate);
      switch (treatment) {
        case 'standard':
          standardBase = add(standardBase, line.amount);
          rateUsed = rate;
          break;
        case 'zero_rated':
          zeroBase = add(zeroBase, line.amount);
          break;
        case 'exempt':
        case 'out_of_scope':
          exemptBase = add(exemptBase, line.amount);
          break;
        default:
          exemptBase = add(exemptBase, line.amount);
      }
    }

    const vatAmount = round2(percent(standardBase, rateUsed));
    return {
      standardBase: round2(standardBase),
      zeroBase: round2(zeroBase),
      exemptBase: round2(exemptBase),
      vatAmount,
      grandTotal: add(round2(standardBase), round2(zeroBase), round2(exemptBase), vatAmount),
      rateUsed,
    };
  }

  /**
   * ภาษีหัก ณ ที่จ่าย — ฐานคำนวณคือมูลค่าก่อน VAT เสมอ
   * ช่องทาง e_wht ใช้อัตราลดพิเศษตามมาตรการที่มีผลในวันนั้น
   */
  async computeWht(
    c: PoolClient,
    baseBeforeVat: Money,
    taxCode: string,
    payDate: string,
    opts: { entityType?: 'individual' | 'juristic'; channel?: 'manual' | 'e_wht' } = {},
  ): Promise<{ amount: Money; rate: string; taxCodeId: string }> {
    const conditions: Record<string, string> = {};
    if (opts.channel) conditions.channel = opts.channel;
    if (opts.entityType) conditions.entity_type = opts.entityType;

    const { rate, taxCodeId } = await this.resolveRate(c, taxCode, payDate, conditions);
    return { amount: round2(percent(baseBeforeVat, rate)), rate, taxCodeId };
  }

  /** เกณฑ์ยกเว้น: จ่ายครั้งหนึ่งไม่ถึง 1,000 บาท และไม่ใช่สัญญาต่อเนื่อง ไม่ต้องหัก */
  isBelowWhtThreshold(baseBeforeVat: Money, hasContinuingContract = false): boolean {
    return !hasContinuingContract && baseBeforeVat < money('1000');
  }

  /** บันทึกลงทะเบียนภาษีพร้อม snapshot ข้อมูลคู่ค้าตามข้อกำหนดกฎหมาย */
  async recordTaxTransaction(c: PoolClient, row: {
    companyId: string; branchId: string; kind: 'vat_output' | 'vat_input' | 'wht';
    taxPeriod: string; docDate: string; docNo: string; docType: string;
    partnerId?: string | null; partnerName: string; partnerTaxId?: string | null;
    partnerBranch?: string | null; partnerAddress?: string | null;
    partnerEntityType?: string | null;
    baseAmount: Money; taxAmount: Money; taxCodeId?: string | null;
    vatTreatment?: string | null; whtIncomeType?: string | null; whtRate?: string | null;
    whtForm?: string | null; remittanceChannel?: 'manual' | 'e_wht';
    journalEntryId?: string | null; sourceDocType?: string; sourceDocId?: string;
  }) {
    const r = await c.query(
      `INSERT INTO duly.tax_transaction
         (company_id, branch_id, kind, tax_period, doc_date, doc_no, doc_type,
          partner_id, partner_name, partner_tax_id, partner_branch, partner_address, partner_entity_type,
          base_amount, tax_amount, tax_code_id, vat_treatment, wht_income_type, wht_rate, wht_form,
          remittance_channel, journal_entry_id, source_doc_type, source_doc_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       RETURNING id`,
      [row.companyId, row.branchId, row.kind, row.taxPeriod, row.docDate, row.docNo, row.docType,
       row.partnerId ?? null, row.partnerName, row.partnerTaxId ?? null, row.partnerBranch ?? null,
       row.partnerAddress ?? null, row.partnerEntityType ?? null,
       toDb(row.baseAmount), toDb(row.taxAmount), row.taxCodeId ?? null, row.vatTreatment ?? null,
       row.whtIncomeType ?? null, row.whtRate ?? null, row.whtForm ?? null,
       row.remittanceChannel ?? 'manual', row.journalEntryId ?? null,
       row.sourceDocType ?? null, row.sourceDocId ?? null],
    );
    return r.rows[0].id as string;
  }

  /** ตรวจ checksum เลขประจำตัวผู้เสียภาษี 13 หลัก */
  static isValidTaxId(taxId: string): boolean {
    if (!/^\d{13}$/.test(taxId)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i += 1) sum += Number(taxId[i]) * (13 - i);
    const check = (11 - (sum % 11)) % 10;
    return check === Number(taxId[12]);
  }
}
