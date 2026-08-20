-- =====================================================================
-- 013 — REPORTING
-- =====================================================================
SET search_path TO duly, public;

-- โครงงบการเงิน (ผู้ใช้กำหนดเองได้ ไม่ต้องแก้โค้ด)
CREATE TABLE report_definition (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid REFERENCES company(id),   -- NULL = แม่แบบของระบบ
  code         text NOT NULL,                 -- BS|PL_FUNCTION|PL_NATURE|CF_INDIRECT|SOCE|TB
  name_th      text NOT NULL,
  name_en      text,
  report_kind  text NOT NULL,                 -- financial_statement|management|tax|custom
  standard     text,                          -- TFRS_NPAE|TFRS_FULL
  is_system    boolean NOT NULL DEFAULT false,
  UNIQUE NULLS NOT DISTINCT (company_id, code)   -- company_id IS NULL = แม่แบบของระบบ
);

CREATE TABLE report_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id uuid NOT NULL REFERENCES report_definition(id) ON DELETE CASCADE,
  parent_id     uuid REFERENCES report_line(id),
  seq_no        integer NOT NULL,
  label_th      text NOT NULL,
  label_en      text,
  line_kind     text NOT NULL,        -- header|detail|subtotal|total|spacer|note_ref
  -- ส่วนของงบที่บรรทัดนี้อยู่ ใช้ตรวจความสมดุลและจัดกลุ่มโดยไม่ต้องเดาจากลำดับ
  section       text,                 -- asset|liability_equity|revenue|expense|operating|investing|financing
  -- แหล่งตัวเลข: อ้าง sub_type ไม่ใช่รหัสบัญชี (ลูกค้าเปลี่ยนรหัสได้)
  sub_types     text[] NOT NULL DEFAULT '{}',
  account_ids   uuid[] NOT NULL DEFAULT '{}',
  formula       text,                 -- เช่น 'L100 - L200'
  sign          smallint NOT NULL DEFAULT 1,
  note_no       smallint,
  indent        smallint NOT NULL DEFAULT 0,
  is_bold       boolean NOT NULL DEFAULT false,
  UNIQUE (definition_id, seq_no)
);

CREATE TABLE saved_view (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  user_id     uuid REFERENCES app_user(id),   -- NULL = แชร์ทั้งบริษัท
  screen_code text NOT NULL,
  name        text NOT NULL,
  filter_json jsonb NOT NULL,
  columns_json jsonb,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  definition_id uuid REFERENCES report_definition(id),
  name          text NOT NULL,
  frequency     text NOT NULL,       -- daily|weekly|monthly|quarterly
  day_spec      text,
  recipients    text[] NOT NULL,
  format        text NOT NULL DEFAULT 'pdf',   -- pdf|xlsx|csv
  filter_json   jsonb NOT NULL DEFAULT '{}',
  next_run_at   timestamptz,
  last_run_at   timestamptz,
  is_active     boolean NOT NULL DEFAULT true
);

-- snapshot อายุลูกหนี้/เจ้าหนี้รายวัน (คำนวณล่วงหน้าเพื่อความเร็ว)
CREATE TABLE aging_snapshot (
  company_id   uuid NOT NULL,
  as_of_date   date NOT NULL,
  aging_kind   text NOT NULL,       -- receivable|payable
  partner_id   uuid NOT NULL,
  currency     char(3) NOT NULL DEFAULT 'THB',
  not_due      numeric(19,4) NOT NULL DEFAULT 0,
  bucket_1_30  numeric(19,4) NOT NULL DEFAULT 0,
  bucket_31_60 numeric(19,4) NOT NULL DEFAULT 0,
  bucket_61_90 numeric(19,4) NOT NULL DEFAULT 0,
  bucket_91_120 numeric(19,4) NOT NULL DEFAULT 0,
  bucket_over_120 numeric(19,4) NOT NULL DEFAULT 0,
  total        numeric(19,4) NOT NULL DEFAULT 0,
  PRIMARY KEY (company_id, as_of_date, aging_kind, partner_id, currency)
);

-- ผลการตรวจสอบยอดคุมอัตโนมัติ (รันทุกวัน)
CREATE TABLE reconciliation_check (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  check_code   text NOT NULL,   -- AR_SUBLEDGER|AP_SUBLEDGER|INVENTORY|OUTPUT_VAT|INPUT_VAT|WHT|BANK
  as_of_date   date NOT NULL,
  control_amount numeric(19,4) NOT NULL,
  subledger_amount numeric(19,4) NOT NULL,
  difference   numeric(19,4) NOT NULL,
  is_balanced  boolean NOT NULL,
  detail_json  jsonb,
  checked_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, check_code, as_of_date)
);

-- งบการเงินที่ปิดแล้ว (เก็บถาวรเพื่อการอ้างอิงและส่ง DBD)
CREATE TABLE financial_statement_snapshot (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_year(id),
  statement_code text NOT NULL,
  data_json      jsonb NOT NULL,
  xbrl_key       text,
  pdf_key        text,
  approved_at    timestamptz,
  filed_dbd_at   timestamptz,
  UNIQUE (company_id, fiscal_year_id, statement_code)
);

-- กระดาษทำการกระทบยอดบัญชี–ภาษี (ภ.ง.ด.50)
CREATE TABLE tax_reconciliation_worksheet (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_year(id),
  accounting_profit numeric(19,4) NOT NULL,
  add_back_json  jsonb NOT NULL DEFAULT '[]',   -- รายจ่ายต้องห้าม ค่าเสื่อมส่วนเกิน
  deduct_json    jsonb NOT NULL DEFAULT '[]',   -- รายได้ยกเว้น ค่าเสื่อมทางภาษีส่วนเกิน
  loss_carried_forward numeric(19,4) NOT NULL DEFAULT 0,
  taxable_profit numeric(19,4) NOT NULL,
  tax_amount     numeric(19,4) NOT NULL,
  prepaid_tax    numeric(19,4) NOT NULL DEFAULT 0,
  net_payable    numeric(19,4) NOT NULL,
  UNIQUE (company_id, fiscal_year_id)
);
