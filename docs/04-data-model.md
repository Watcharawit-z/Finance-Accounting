# 04 — แบบจำลองข้อมูล (Data Model)

ไฟล์ SQL จริงอยู่ที่ [`db/schema.sql`](../db/schema.sql) — เอกสารนี้อธิบาย "ทำไม"

## 1. ภาพรวมความสัมพันธ์

```
tenant ──< company ──< branch
                │
                ├──< fiscal_year ──< accounting_period
                ├──< account (ผังบัญชี)
                ├──< journal_entry ──< journal_line ──> account, dimension
                ├──< customer, vendor, item, employee, fixed_asset
                ├──< sales_document (quotation/order/invoice/receipt/cn/dn)
                ├──< purchase_document (pr/po/gr/bill/payment)
                ├──< tax_transaction  (ทะเบียนภาษีซื้อ-ขาย-หัก ณ ที่จ่าย)
                └──< audit_event

document_sequence, tax_rate, posting_rule = ตารางกติกา (config)
```

## 2. ตารางแกน — คำอธิบายการออกแบบ

### 2.1 `account` — ผังบัญชี
```
id, company_id, code, name_th, name_en, account_type, parent_id,
is_postable, currency_id, default_tax_code_id, is_active, path (ltree)
```
- `account_type` ∈ `asset | liability | equity | revenue | expense` + `sub_type` ละเอียด
  (`current_asset`, `trade_receivable`, `input_vat`, `output_vat`, `wht_payable`, …)
  → ใช้ `sub_type` สร้างงบการเงินและแบบภาษีอัตโนมัติ **ห้ามอิงรหัสบัญชีตรง ๆ** เพราะลูกค้าแต่ละรายเปลี่ยนรหัสได้
- `is_postable = false` สำหรับบัญชีหัวข้อ (header) — ลงรายการไม่ได้
- `path` (ltree) ทำให้ roll-up ยอดขึ้นระดับบนได้เร็ว

### 2.2 `journal_entry` / `journal_line` — หัวใจของระบบ
```
journal_entry: id, company_id, branch_id, entry_no, journal_type, posting_date,
               doc_date, description, source_doc_type, source_doc_id,
               status(draft|posted|reversed), reversal_of_id, period_id,
               created_by, posted_by, posted_at

journal_line:  id, entry_id, line_no, account_id, debit, credit,
               currency_id, fx_rate, debit_base, credit_base,
               partner_type, partner_id, dimension_json, tax_code_id, memo
```
กติกาที่บังคับระดับฐานข้อมูล:
- `CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0))`
- Trigger ตอน post: `SUM(debit_base) = SUM(credit_base)` ต่อ entry
- `posted` แล้ว **UPDATE/DELETE ไม่ได้** (trigger block) — แก้ได้ทางเดียวคือกลับรายการ
- `journal_line` partition by RANGE(`posting_date`) รายปี

### 2.3 `tax_transaction` — ทะเบียนภาษีรวมศูนย์
```
id, company_id, branch_id, tax_kind (vat_output|vat_input|wht),
tax_period (YYYY-MM), doc_date, doc_no, doc_type,
partner_name_snapshot, partner_tax_id_snapshot, partner_branch_snapshot,
base_amount, tax_amount, tax_code_id, wht_income_type, wht_rate,
remittance_channel (manual|e_wht), filing_id, journal_entry_id, source_doc_id
```
**ทำไมต้องมีตารางนี้แยกจาก GL:** รายงานภาษีซื้อ/ขายและแบบยื่นภาษีมีข้อมูลที่ GL ไม่มี
(เลขที่ใบกำกับของผู้ขาย, สาขาผู้ซื้อ, ประเภทเงินได้ WHT) และ snapshot ข้อมูลคู่ค้า ณ วันที่ออกเอกสาร
ตามข้อกำหนดกฎหมาย — ถ้าลูกค้าเปลี่ยนที่อยู่ทีหลัง รายงานย้อนหลังต้องไม่เปลี่ยน

`filing_id` = อ้างถึงแบบที่ยื่นแล้ว → รายการที่มี `filing_id` ห้ามแก้

### 2.4 `tax_rate` — อัตราภาษีตามช่วงเวลา
```
id, tax_kind, code, name_th, rate, effective_from, effective_to,
condition_json (เช่น ประเภทผู้รับ, ช่องทางนำส่ง)
```
ตัวอย่างข้อมูล:
```
VAT_7      vat  7.00   2017-10-01 → NULL
VAT_0      vat  0.00   2000-01-01 → NULL
WHT_SVC_3  wht  3.00   2000-01-01 → NULL   {income_type:"service"}
WHT_SVC_1  wht  1.00   2026-01-01 → 2027-12-31  {income_type:"service", channel:"e_wht"}
SSO_RATE   sso  5.00   2569-01-01 → NULL  {wage_ceiling: 17500}
```
> ทุกการคำนวณต้อง lookup ด้วย `posting_date` ไม่ใช่ `NOW()` — ไม่งั้นแก้เอกสารย้อนหลังแล้วอัตราเปลี่ยน

### 2.5 `partner` (customer / vendor)
```
id, company_id, partner_type, code, legal_name_th, legal_name_en,
tax_id(13), branch_code(5, '00000'=สำนักงานใหญ่), entity_type(individual|juristic),
address_json, payment_term_days, credit_limit, default_wht_income_type,
is_vat_registered, bank_account_json, is_active
```
- `entity_type` ตัดสินว่ารายการหัก ณ ที่จ่ายจะเข้า **ภ.ง.ด.3** (บุคคล) หรือ **ภ.ง.ด.53** (นิติบุคคล)
- `tax_id` ต้องผ่าน checksum 13 หลักของกรมการปกครอง
- ที่อยู่แยก `billing` / `shipping` / `tax_invoice` (บางบริษัทใช้ที่อยู่ต่างกัน)

### 2.6 เอกสารขาย/ซื้อ — ใช้ตารางร่วมหรือแยก?
**เลือกแยก header ต่อประเภท แต่ใช้ตาราง line ร่วม** เพราะฟิลด์ต่างกันมาก
(ใบเสนอราคาไม่มีเลขที่ใบกำกับ, ใบเสร็จไม่มีสินค้า) แต่ line structure เหมือนกัน

```
sales_invoice: id, company_id, branch_id, doc_no, doc_date, due_date, customer_id,
   customer_snapshot_json,  ← สำคัญตามกฎหมาย
   currency_id, fx_rate, subtotal, discount, vat_base, vat_amount, grand_total,
   status(draft|issued|partially_paid|paid|void),
   is_tax_invoice, tax_invoice_no, tax_invoice_date,
   etax_status(not_applicable|pending|signed|submitted|accepted|rejected),
   etax_xml_url, etax_response_json,
   journal_entry_id, reference_so_id, created_by, issued_at

document_line: id, doc_type, doc_id, line_no, item_id, description,
   quantity, uom_id, unit_price, discount_amount, tax_code_id,
   line_amount, account_id, dimension_json, warehouse_id
```

### 2.7 `dimension` — มิติทางบัญชี
```
dimension_type: id, company_id, code (COST_CENTER|PROJECT|DEPARTMENT|...), name, is_required
dimension_value: id, dimension_type_id, code, name, parent_id, is_active
```
เก็บใน `journal_line.dimension_json` แบบ JSONB + GIN index (ยืดหยุ่นกว่า fixed column
และรองรับลูกค้าที่ต้องการมิติเพิ่มเองได้)

### 2.8 `audit_event` — append-only
```
id, tenant_id, company_id, occurred_at, actor_user_id, actor_ip, actor_user_agent,
entity_type, entity_id, action(create|update|post|void|approve|export|login|...),
before_json, after_json, request_id
```
- `REVOKE UPDATE, DELETE` จากทุก role ระดับแอป
- Partition รายเดือน, ย้ายไป cold storage หลัง 1 ปี แต่เก็บครบ 7 ปี
- ต้อง log การ **export/ดาวน์โหลด** ด้วย (ข้อกำหนด PDPA)

### 2.9 `attachment`
```
id, company_id, entity_type, entity_id, file_name, mime_type, size_bytes,
storage_key, sha256, uploaded_by, uploaded_at, retention_until, legal_hold
```
- `sha256` พิสูจน์ว่าไฟล์ไม่ถูกแก้
- `retention_until` = วันสิ้นรอบบัญชี + 5 ปี (ตั้งค่าได้)
- ไฟล์ e-Tax XML + signature เก็บใน bucket ที่เปิด **Object Lock (WORM)**

### 2.10 `posting_rule`
```
id, company_id, doc_type, event, condition_json, line_template_json, priority
```
ตัวอย่าง: `doc_type=sales_invoice, event=issue` →
```json
[{"side":"debit","account_ref":"customer.receivable_account","amount":"grand_total"},
 {"side":"credit","account_ref":"line.item.revenue_account","amount":"line_amount"},
 {"side":"credit","account_ref":"company.output_vat_account","amount":"vat_amount"}]
```

## 3. ตารางสรุป (ประมาณ 90 ตารางใน P1–P2)

| กลุ่ม | ตารางหลัก |
|-------|-----------|
| Platform | tenant, company, branch, user, role, permission, user_company_role, setting, document_sequence, audit_event, attachment, notification |
| Ledger | account, fiscal_year, accounting_period, journal_entry, journal_line, gl_balance_monthly, dimension_type, dimension_value, currency, fx_rate, posting_rule |
| Tax | tax_code, tax_rate, tax_transaction, tax_filing, wht_certificate, etax_document, etax_submission |
| AR | customer(partner), quotation, sales_order, delivery_note, sales_invoice, receipt, credit_note, debit_note, customer_deposit, dunning_log |
| AP | vendor(partner), purchase_request, purchase_order, goods_receipt, vendor_bill, payment_voucher, expense_claim, petty_cash, advance |
| Banking | bank_account, bank_statement, bank_statement_line, reconciliation, reconciliation_match, cheque |
| Inventory | item, item_category, uom, uom_conversion, warehouse, stock_move, stock_balance, stock_count, stock_count_line, landed_cost, bom, production_order |
| Fixed Assets | asset_category, fixed_asset, depreciation_schedule, depreciation_run, asset_disposal |
| Payroll | employee, employment_contract, salary_structure, pay_run, pay_slip, pay_slip_line, sso_contribution, pit_deduction |
| Projects | project, project_budget, job_cost_entry, timesheet, milestone |
| Budget | budget, budget_version, budget_line, forecast |
| Reporting | report_definition, report_layout, report_schedule, saved_view |
| Documents | approval_flow, approval_step, approval_request, document_inbox |

## 4. ข้อมูลตั้งต้นที่ต้องมาพร้อมระบบ (Seed Data)

- ผังบัญชีมาตรฐานไทย (ดู [10-chart-of-accounts.md](10-chart-of-accounts.md)) — 3 แบบ: บริการ / ซื้อมาขายไป / ผลิต
- รหัสภาษี VAT และ WHT ครบทุกประเภท พร้อมอัตราตามช่วงเวลา
- หน่วยนับมาตรฐาน, สกุลเงินหลัก, รหัสจังหวัด/อำเภอ/ตำบล + รหัสไปรษณีย์
- เงื่อนไขการชำระเงินมาตรฐาน (เงินสด, 7/15/30/45/60/90 วัน, สิ้นเดือนถัดไป)
- ปฏิทินวันหยุดธนาคารไทย (ใช้คำนวณวันครบกำหนดและวันยื่นภาษี)
- กลุ่มทรัพย์สินพร้อมอายุการใช้งานทางบัญชีและอัตราค่าเสื่อมสูงสุดทางภาษี

## 5. ยอดยกมา (Opening Balance)

ขั้นตอนที่ระบบต้องรองรับตอนย้ายจากระบบเดิม:
1. นำเข้าผังบัญชี → 2. นำเข้าทะเบียนลูกค้า/ผู้ขาย/สินค้า/ทรัพย์สิน
3. นำเข้ายอดยกมาระดับบัญชี (ผ่าน JE พิเศษ `journal_type = opening`)
4. นำเข้ารายละเอียดลูกหนี้/เจ้าหนี้คงค้างรายใบ (ต้องเท่ากับยอดใน (3))
5. นำเข้ายอดสินค้าคงเหลือ + ต้นทุนต่อหน่วย
6. **ตรวจสอบอัตโนมัติ:** ยอดรวมย่อย = ยอดคุมในบัญชีแยกประเภท ทุกตัว ก่อนอนุญาตให้เริ่มใช้งาน

## 6. กติกาที่ต้องมี Test ครอบคลุม

| กติกา | ประเภทเทส |
|-------|-----------|
| เดบิต = เครดิต ทุก entry | property-based |
| ปิดงวดแล้วลงรายการย้อนหลังไม่ได้ | integration |
| เลขที่เอกสารไม่ซ้ำภายใต้ concurrency สูง | load test 100 ธุรกรรมพร้อมกัน |
| ยอดลูกหนี้ย่อยรวม = บัญชีคุมลูกหนี้ | reconciliation test รายวัน |
| VAT ในรายงานภาษีขาย = ยอดในบัญชีภาษีขาย | reconciliation test |
| การกลับรายการทำให้ยอดสุทธิเป็นศูนย์ | unit |
| ต้นทุนถัวเฉลี่ยถูกต้องเมื่อรับ-จ่ายสลับกัน | golden test |
