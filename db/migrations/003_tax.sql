-- =====================================================================
-- 003 — TAX (VAT, WHT, แบบยื่น, e-Tax)
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE tax_code (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid REFERENCES company(id),
  code            text NOT NULL,
  name_th         text NOT NULL,
  name_en         text,
  kind            tax_kind NOT NULL,
  vat_treatment   vat_treatment,
  wht_income_type text,          -- service|rent|transport|advertising|professional|royalty|dividend|interest|commission|contract
  wht_form        text,          -- PND1|PND2|PND3|PND53|PND54
  account_id      uuid REFERENCES account(id),
  is_purchase     boolean NOT NULL DEFAULT false,
  is_sale         boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (company_id, code)   -- company_id IS NULL = รหัสภาษีของระบบ
);

-- ★ อัตราภาษีเป็นข้อมูล — lookup ด้วยวันที่ของเอกสารเสมอ ห้าม hardcode ในโค้ด
CREATE TABLE tax_rate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_code_id    uuid NOT NULL REFERENCES tax_code(id),
  rate           numeric(9,4) NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  condition_json jsonb NOT NULL DEFAULT '{}',   -- {"entity_type":"juristic","channel":"e_wht"}
  legal_ref      text,                          -- อ้างอิงกฎหมาย/ประกาศ
  note           text,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX ON tax_rate (tax_code_id, effective_from DESC);

-- ขั้นภาษีเงินได้ (ใช้ทั้งบุคคลธรรมดาและนิติบุคคล)
CREATE TABLE income_tax_bracket (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  taxpayer_kind  text NOT NULL,          -- individual|juristic|juristic_sme
  lower_bound    numeric(19,4) NOT NULL,
  upper_bound    numeric(19,4),          -- NULL = ไม่จำกัด
  rate           numeric(9,4) NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  legal_ref      text
);

-- ค่าลดหย่อนภาษีเงินได้บุคคลธรรมดา
CREATE TABLE pit_deduction_rule (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,          -- PERSONAL|SPOUSE|CHILD|PARENT|SSO|LIFE_INS|PVD|RMF|...
  name_th        text NOT NULL,
  amount_type    text NOT NULL,          -- fixed|percent|percent_capped
  amount         numeric(19,4),
  percent        numeric(9,4),
  max_amount     numeric(19,4),
  max_count      smallint,
  effective_from date NOT NULL,
  effective_to   date,
  legal_ref      text
);

-- เพดานรายจ่ายทางภาษี (ค่ารับรอง เงินบริจาค ฯลฯ)
CREATE TABLE tax_expense_limit (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL,          -- ENTERTAINMENT|DONATION_GENERAL|DONATION_EDU|...
  name_th        text NOT NULL,
  basis          text NOT NULL,          -- revenue|paid_up_capital|net_profit|greater_of
  percent        numeric(9,4) NOT NULL,
  absolute_cap   numeric(19,4),
  effective_from date NOT NULL,
  effective_to   date,
  legal_ref      text
);

-- อัตราค่าเสื่อมราคาสูงสุดทางภาษี (พ.ร.ฎ. 145)
CREATE TABLE tax_depreciation_rate (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_class       text NOT NULL,
  name_th           text NOT NULL,
  max_rate_percent  numeric(9,4) NOT NULL,
  min_years         numeric(9,2),
  sme_bonus_percent numeric(9,4),        -- สิทธิหักเพิ่มสำหรับ SME (ถ้ามี)
  effective_from    date NOT NULL,
  effective_to      date,
  legal_ref         text
);

CREATE TABLE tax_filing (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  branch_id       uuid REFERENCES branch(id),
  form_code       text NOT NULL,       -- PP30|PP36|PND1|PND1K|PND2|PND3|PND53|PND54|PND50|PND51|SSO1_10|PT40
  tax_period      text NOT NULL,
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  due_date        date NOT NULL,
  online_due_date date,
  filed_date      date,
  filed_by        uuid REFERENCES app_user(id),
  is_amended      boolean NOT NULL DEFAULT false,
  amend_of_id     uuid REFERENCES tax_filing(id),
  base_amount     numeric(19,4) NOT NULL DEFAULT 0,
  tax_amount      numeric(19,4) NOT NULL DEFAULT 0,
  credit_carried  numeric(19,4) NOT NULL DEFAULT 0,
  payment_amount  numeric(19,4) NOT NULL DEFAULT 0,
  surcharge       numeric(19,4) NOT NULL DEFAULT 0,
  penalty         numeric(19,4) NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'draft',   -- draft|ready|filed|paid|amended
  rd_receipt_no   text,
  export_file_key text,
  detail_json     jsonb NOT NULL DEFAULT '{}',     -- ตัวเลขทุกช่องในแบบ
  journal_entry_id uuid REFERENCES journal_entry(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- branch_id/amend_of_id เป็น NULL ได้ (แบบระดับบริษัท / ไม่ใช่แบบเพิ่มเติม)
  UNIQUE NULLS NOT DISTINCT (company_id, branch_id, form_code, tax_period, is_amended, amend_of_id)
);

-- ★ ทะเบียนภาษีรวมศูนย์ พร้อม snapshot ข้อมูลคู่ค้าตามข้อกำหนดกฎหมาย
CREATE TABLE tax_transaction (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  branch_id          uuid NOT NULL REFERENCES branch(id),
  kind               tax_kind NOT NULL,
  tax_period         text NOT NULL,
  doc_date           date NOT NULL,
  doc_no             text NOT NULL,
  doc_type           text NOT NULL,   -- tax_invoice|abbrev_tax_invoice|credit_note|debit_note|import_entry|receipt
  seq_no             integer,
  partner_id         uuid,
  partner_name       text NOT NULL,
  partner_tax_id     char(13),
  partner_branch     char(5),
  partner_address    text,
  partner_entity_type entity_type,
  base_amount        numeric(19,4) NOT NULL,
  tax_amount         numeric(19,4) NOT NULL,
  tax_code_id        uuid REFERENCES tax_code(id),
  vat_treatment      vat_treatment,
  wht_income_type    text,
  wht_rate           numeric(9,4),
  wht_form           text,
  remittance_channel remit_channel NOT NULL DEFAULT 'manual',
  wht_cert_id        uuid,
  filing_id          uuid REFERENCES tax_filing(id),
  journal_entry_id   uuid REFERENCES journal_entry(id),
  source_doc_type    text,
  source_doc_id      uuid,
  is_reversed        boolean NOT NULL DEFAULT false,
  note               text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tax_transaction (company_id, branch_id, kind, tax_period, doc_date);
CREATE INDEX ON tax_transaction (company_id, partner_tax_id);
CREATE INDEX ON tax_transaction (company_id, filing_id);
-- กันบันทึกใบกำกับภาษีซื้อซ้ำจากผู้ขายรายเดียวกัน
CREATE UNIQUE INDEX uq_input_vat_doc
  ON tax_transaction (company_id, partner_tax_id, doc_no, doc_date)
  WHERE kind = 'vat_input' AND NOT is_reversed;

CREATE TABLE wht_certificate (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  book_no          text NOT NULL,
  cert_no          text NOT NULL,
  issue_date       date NOT NULL,
  partner_id       uuid,
  partner_snapshot jsonb NOT NULL,
  form_code        text NOT NULL,
  pay_type         text NOT NULL DEFAULT 'withhold',  -- withhold|pay_forever|pay_once|other
  total_base       numeric(19,4) NOT NULL,
  total_wht        numeric(19,4) NOT NULL,
  lines_json       jsonb NOT NULL DEFAULT '[]',
  source_doc_type  text,
  source_doc_id    uuid,
  pdf_storage_key  text,
  sent_at          timestamptz,
  UNIQUE (company_id, book_no, cert_no)
);

CREATE TABLE etax_document (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  source_doc_type text NOT NULL,
  source_doc_id   uuid NOT NULL,
  provider        text NOT NULL DEFAULT 'service_provider',  -- service_provider|direct|email
  status          etax_status NOT NULL DEFAULT 'pending',
  xml_storage_key text,
  pdf_storage_key text,
  signature_info  jsonb,
  submitted_at    timestamptz,
  accepted_at     timestamptz,
  rd_response     jsonb,
  error_code      text,
  error_message   text,
  retry_count     smallint NOT NULL DEFAULT 0,
  next_retry_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_doc_type, source_doc_id)
);
CREATE INDEX ON etax_document (status, next_retry_at);

-- ปฏิทินภาษี — ระบบสร้างงานล่วงหน้าอัตโนมัติ
CREATE TABLE tax_calendar_task (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  form_code     text NOT NULL,
  tax_period    text NOT NULL,
  due_date      date NOT NULL,
  online_due_date date,
  assignee_id   uuid REFERENCES app_user(id),
  status        text NOT NULL DEFAULT 'pending',  -- pending|in_progress|filed|skipped
  filing_id     uuid REFERENCES tax_filing(id),
  note          text,
  UNIQUE (company_id, form_code, tax_period)
);
CREATE INDEX ON tax_calendar_task (company_id, due_date, status);
