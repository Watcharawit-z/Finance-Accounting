-- =====================================================================
-- DULY — Accounting & Finance Platform
-- Core schema (PostgreSQL 17) — Phase 1 scope
-- ทุกจำนวนเงินเป็น NUMERIC(19,4) เท่านั้น ห้ามใช้ float/double
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "ltree";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "btree_gist";  -- ต้องมีสำหรับ EXCLUDE บน accounting_period

CREATE SCHEMA IF NOT EXISTS duly_core;
SET search_path TO duly_core, public;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
CREATE TYPE account_type     AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TYPE entity_type      AS ENUM ('individual','juristic','government','foreign');
CREATE TYPE partner_kind     AS ENUM ('customer','vendor','both');
CREATE TYPE je_status        AS ENUM ('draft','posted','reversed','void');
CREATE TYPE journal_type     AS ENUM ('general','sales','purchase','receipt','payment','opening','closing','adjustment');
CREATE TYPE period_status    AS ENUM ('open','soft_closed','closed','tax_filed');
CREATE TYPE doc_status       AS ENUM ('draft','pending_approval','issued','partially_paid','paid','void','cancelled');
CREATE TYPE tax_kind         AS ENUM ('vat_output','vat_input','wht','sbt','stamp');
CREATE TYPE vat_treatment    AS ENUM ('standard','zero_rated','exempt','out_of_scope','non_claimable');
CREATE TYPE remit_channel    AS ENUM ('manual','e_wht');
CREATE TYPE etax_status      AS ENUM ('not_applicable','pending','signed','submitted','accepted','rejected');

-- ---------------------------------------------------------------------
-- PLATFORM
-- ---------------------------------------------------------------------
CREATE TABLE tenant (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  plan          text NOT NULL DEFAULT 'core',
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  code                text NOT NULL,
  legal_name_th       text NOT NULL,
  legal_name_en       text,
  tax_id              char(13) NOT NULL,          -- เลขประจำตัวผู้เสียภาษี
  registration_no     text,                       -- เลขทะเบียนนิติบุคคล
  entity_type         entity_type NOT NULL DEFAULT 'juristic',
  is_vat_registered   boolean NOT NULL DEFAULT true,
  vat_registered_date date,
  fiscal_year_end_mm  smallint NOT NULL DEFAULT 12 CHECK (fiscal_year_end_mm BETWEEN 1 AND 12),
  fiscal_year_end_dd  smallint NOT NULL DEFAULT 31,
  base_currency       char(3) NOT NULL DEFAULT 'THB',
  accounting_standard text NOT NULL DEFAULT 'TFRS_NPAE',
  hard_lock_date      date,                       -- ห้ามลงรายการก่อนวันนี้เด็ดขาด
  address_json        jsonb NOT NULL DEFAULT '{}',
  logo_url            text,
  bookkeeper_name     text,                       -- ผู้ทำบัญชี (พ.ร.บ.การบัญชี 2543)
  bookkeeper_cpd_no   text,                       -- เลขทะเบียนผู้ทำบัญชี
  auditor_name        text,
  auditor_cpa_no      text,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT tax_id_digits CHECK (tax_id ~ '^[0-9]{13}$')
);

-- สาขา — จำเป็นตามกฎหมาย VAT (ใบกำกับภาษีต้องระบุสำนักงานใหญ่/สาขา)
CREATE TABLE branch (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  code         char(5) NOT NULL,                  -- '00000' = สำนักงานใหญ่
  name_th      text NOT NULL,
  name_en      text,
  address_json jsonb NOT NULL DEFAULT '{}',
  is_head_office boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  email         citext NOT NULL,
  full_name     text NOT NULL,
  password_hash text,
  mfa_secret    text,
  mfa_enabled   boolean NOT NULL DEFAULT false,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE role (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id),          -- NULL = บทบาทมาตรฐานของระบบ
  code        text NOT NULL,
  name_th     text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '[]',
  UNIQUE (tenant_id, code)
);

CREATE TABLE user_company_role (
  user_id    uuid NOT NULL REFERENCES app_user(id),
  company_id uuid NOT NULL REFERENCES company(id),
  role_id    uuid NOT NULL REFERENCES role(id),
  scope_json jsonb NOT NULL DEFAULT '{}',          -- {branch_ids:[], project_ids:[]}
  PRIMARY KEY (user_id, company_id, role_id)
);

-- เลขที่เอกสาร — จองเลขตอน post เท่านั้น
CREATE TABLE document_sequence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  branch_id   uuid REFERENCES branch(id),
  doc_type    text NOT NULL,
  period_key  text NOT NULL,                       -- '2569-01' หรือ '2569' หรือ 'ALL'
  prefix      text NOT NULL DEFAULT '',
  padding     smallint NOT NULL DEFAULT 5,
  next_no     bigint NOT NULL DEFAULT 1,
  UNIQUE (company_id, branch_id, doc_type, period_key)
);

-- Audit log — append only (REVOKE UPDATE/DELETE จากทุก role ระดับแอป)
CREATE TABLE audit_event (
  id           bigserial PRIMARY KEY,
  tenant_id    uuid NOT NULL,
  company_id   uuid,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_ip     inet,
  actor_agent  text,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  action       text NOT NULL,                      -- create|update|post|void|approve|export|login
  before_json  jsonb,
  after_json   jsonb,
  reason       text,
  request_id   text
) PARTITION BY RANGE (occurred_at);
CREATE INDEX ON audit_event (company_id, entity_type, entity_id, occurred_at DESC);

CREATE TABLE attachment (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  entity_type    text NOT NULL,
  entity_id      uuid NOT NULL,
  file_name      text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL,
  storage_key    text NOT NULL,
  sha256         char(64) NOT NULL,
  uploaded_by    uuid REFERENCES app_user(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  retention_until date,                            -- สิ้นรอบบัญชี + 5 ปี
  legal_hold     boolean NOT NULL DEFAULT false
);
CREATE INDEX ON attachment (company_id, entity_type, entity_id);

-- ---------------------------------------------------------------------
-- LEDGER
-- ---------------------------------------------------------------------
CREATE TABLE currency (
  code      char(3) PRIMARY KEY,
  name_th   text NOT NULL,
  decimals  smallint NOT NULL DEFAULT 2
);

CREATE TABLE fx_rate (
  id          bigserial PRIMARY KEY,
  currency    char(3) NOT NULL REFERENCES currency(code),
  base        char(3) NOT NULL DEFAULT 'THB',
  rate_date   date NOT NULL,
  rate_type   text NOT NULL DEFAULT 'bot_avg',     -- bot_buy|bot_sell|bot_avg|custom
  rate        numeric(19,8) NOT NULL CHECK (rate > 0),
  UNIQUE (currency, base, rate_date, rate_type)
);

CREATE TABLE fiscal_year (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  code        text NOT NULL,                       -- '2569'
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  is_closed   boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, code),
  CHECK (end_date > start_date)
);

CREATE TABLE accounting_period (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_year(id),
  period_no      smallint NOT NULL,
  code           text NOT NULL,                    -- '2569-01'
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  status         period_status NOT NULL DEFAULT 'open',
  module_locks   jsonb NOT NULL DEFAULT '{}',      -- {"ar":true,"ap":false}
  closed_by      uuid REFERENCES app_user(id),
  closed_at      timestamptz,
  UNIQUE (company_id, code),
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
);

CREATE TABLE account (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id           uuid NOT NULL REFERENCES company(id),
  code                 text NOT NULL,
  name_th              text NOT NULL,
  name_en              text,
  account_type         account_type NOT NULL,
  sub_type             text NOT NULL,              -- 'trade_receivable','input_vat',... (ดู doc 10)
  parent_id            uuid REFERENCES account(id),
  path                 ltree,
  is_postable          boolean NOT NULL DEFAULT true,
  is_contra            boolean NOT NULL DEFAULT false,
  currency             char(3) REFERENCES currency(code),
  default_tax_code_id  uuid,
  requires_partner     boolean NOT NULL DEFAULT false,   -- ลูกหนี้/เจ้าหนี้ต้องระบุคู่ค้า
  requires_dimension   text[],                            -- ['COST_CENTER']
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX ON account USING gist (path);
CREATE INDEX ON account (company_id, sub_type);

CREATE TABLE dimension_type (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  code        text NOT NULL,                       -- COST_CENTER | PROJECT | DEPARTMENT
  name_th     text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  UNIQUE (company_id, code)
);

CREATE TABLE dimension_value (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dimension_type_id uuid NOT NULL REFERENCES dimension_type(id),
  code              text NOT NULL,
  name_th           text NOT NULL,
  parent_id         uuid REFERENCES dimension_value(id),
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (dimension_type_id, code)
);

CREATE TABLE journal_entry (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  branch_id       uuid NOT NULL REFERENCES branch(id),
  period_id       uuid NOT NULL REFERENCES accounting_period(id),
  entry_no        text,                            -- NULL จนกว่าจะ post
  journal_type    journal_type NOT NULL DEFAULT 'general',
  posting_date    date NOT NULL,
  doc_date        date NOT NULL,
  description     text NOT NULL,
  source_doc_type text,
  source_doc_id   uuid,
  status          je_status NOT NULL DEFAULT 'draft',
  reversal_of_id  uuid REFERENCES journal_entry(id),
  reversed_by_id  uuid REFERENCES journal_entry(id),
  reason          text,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  posted_by       uuid REFERENCES app_user(id),
  posted_at       timestamptz,
  UNIQUE (company_id, entry_no)
);
CREATE INDEX ON journal_entry (company_id, posting_date);
CREATE INDEX ON journal_entry (source_doc_type, source_doc_id);

CREATE TABLE journal_line (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id       uuid NOT NULL REFERENCES journal_entry(id) ON DELETE CASCADE,
  company_id     uuid NOT NULL,
  posting_date   date NOT NULL,
  line_no        smallint NOT NULL,
  account_id     uuid NOT NULL REFERENCES account(id),
  debit          numeric(19,4) NOT NULL DEFAULT 0,
  credit         numeric(19,4) NOT NULL DEFAULT 0,
  currency       char(3) NOT NULL DEFAULT 'THB',
  fx_rate        numeric(19,8) NOT NULL DEFAULT 1,
  debit_base     numeric(19,4) NOT NULL DEFAULT 0,
  credit_base    numeric(19,4) NOT NULL DEFAULT 0,
  partner_id     uuid,
  dimension_json jsonb NOT NULL DEFAULT '{}',
  tax_code_id    uuid,
  memo           text,
  PRIMARY KEY (id, posting_date),
  CONSTRAINT amounts_non_negative CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT one_side_only       CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT some_amount         CHECK (debit > 0 OR credit > 0)
) PARTITION BY RANGE (posting_date);
CREATE INDEX ON journal_line (company_id, account_id, posting_date);
CREATE INDEX ON journal_line USING gin (dimension_json);

-- ยอดคงเหลือรายเดือน (materialized) — ทำให้รายงานเร็ว
CREATE TABLE gl_balance_monthly (
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  account_id     uuid NOT NULL REFERENCES account(id),
  period_code    text NOT NULL,
  dimension_key  text NOT NULL DEFAULT '',
  opening_base   numeric(19,4) NOT NULL DEFAULT 0,
  debit_base     numeric(19,4) NOT NULL DEFAULT 0,
  credit_base    numeric(19,4) NOT NULL DEFAULT 0,
  closing_base   numeric(19,4) NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, branch_id, account_id, period_code, dimension_key)
);

-- ---------------------------------------------------------------------
-- TAX
-- ---------------------------------------------------------------------
CREATE TABLE tax_code (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES company(id),      -- NULL = ของระบบ
  code           text NOT NULL,                    -- 'VAT7','VAT0','EXEMPT','WHT3_SVC'
  name_th        text NOT NULL,
  kind           tax_kind NOT NULL,
  vat_treatment  vat_treatment,
  wht_income_type text,                            -- 'service','rent','transport','advertising',...
  account_id     uuid REFERENCES account(id),
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

-- ★ อัตราภาษีเป็นข้อมูล ไม่ใช่โค้ด — lookup ด้วย posting_date เสมอ
CREATE TABLE tax_rate (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_code_id    uuid NOT NULL REFERENCES tax_code(id),
  rate           numeric(9,4) NOT NULL,
  effective_from date NOT NULL,
  effective_to   date,
  condition_json jsonb NOT NULL DEFAULT '{}',      -- {"entity_type":"juristic","channel":"e_wht"}
  note           text,
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
CREATE INDEX ON tax_rate (tax_code_id, effective_from DESC);

CREATE TABLE tax_filing (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  branch_id     uuid REFERENCES branch(id),
  form_code     text NOT NULL,                     -- 'PP30','PND3','PND53','PND1','PND51','PND50'
  tax_period    text NOT NULL,                     -- '2569-01'
  due_date      date NOT NULL,
  filed_date    date,
  filed_by      uuid REFERENCES app_user(id),
  base_amount   numeric(19,4) NOT NULL DEFAULT 0,
  tax_amount    numeric(19,4) NOT NULL DEFAULT 0,
  payment_amount numeric(19,4) NOT NULL DEFAULT 0,
  surcharge     numeric(19,4) NOT NULL DEFAULT 0,  -- เงินเพิ่ม 1.5%/เดือน
  penalty       numeric(19,4) NOT NULL DEFAULT 0,  -- เบี้ยปรับ
  status        text NOT NULL DEFAULT 'draft',     -- draft|ready|filed|amended
  rd_receipt_no text,
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, branch_id, form_code, tax_period)
);

-- ★ ทะเบียนภาษีรวมศูนย์ — snapshot ข้อมูลคู่ค้าตามข้อกำหนดกฎหมาย
CREATE TABLE tax_transaction (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  branch_id          uuid NOT NULL REFERENCES branch(id),
  kind               tax_kind NOT NULL,
  tax_period         text NOT NULL,
  doc_date           date NOT NULL,
  doc_no             text NOT NULL,                -- เลขที่ใบกำกับภาษี
  doc_type           text NOT NULL,                -- tax_invoice|credit_note|debit_note|abbrev
  seq_no             integer,                      -- ลำดับในรายงาน
  partner_name       text NOT NULL,                -- snapshot
  partner_tax_id     char(13),                     -- snapshot
  partner_branch     char(5),                      -- snapshot
  partner_address    text,                         -- snapshot
  base_amount        numeric(19,4) NOT NULL,
  tax_amount         numeric(19,4) NOT NULL,
  tax_code_id        uuid REFERENCES tax_code(id),
  vat_treatment      vat_treatment,
  wht_income_type    text,
  wht_rate           numeric(9,4),
  remittance_channel remit_channel NOT NULL DEFAULT 'manual',  -- ★ กัน e-WHT ซ้ำใน ภ.ง.ด.3/53
  wht_cert_no        text,                         -- เลขที่หนังสือรับรอง 50 ทวิ
  filing_id          uuid REFERENCES tax_filing(id),
  journal_entry_id   uuid REFERENCES journal_entry(id),
  source_doc_type    text,
  source_doc_id      uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON tax_transaction (company_id, branch_id, kind, tax_period, doc_date);
CREATE INDEX ON tax_transaction (company_id, partner_tax_id);

CREATE TABLE etax_document (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  source_doc_type text NOT NULL,
  source_doc_id  uuid NOT NULL,
  status         etax_status NOT NULL DEFAULT 'pending',
  xml_storage_key text,
  signature_info jsonb,
  submitted_at   timestamptz,
  rd_response    jsonb,
  error_code     text,
  retry_count    smallint NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- PARTNERS
-- ---------------------------------------------------------------------
CREATE TABLE partner (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES company(id),
  kind                     partner_kind NOT NULL,
  code                     text NOT NULL,
  legal_name_th            text NOT NULL,
  legal_name_en            text,
  entity_type              entity_type NOT NULL,   -- ★ ตัดสิน ภ.ง.ด.3 vs 53
  tax_id                   char(13),
  branch_code              char(5) DEFAULT '00000',
  is_vat_registered        boolean NOT NULL DEFAULT false,
  address_json             jsonb NOT NULL DEFAULT '{}',
  contact_json             jsonb NOT NULL DEFAULT '{}',
  payment_term_days        smallint NOT NULL DEFAULT 30,
  credit_limit             numeric(19,4),
  default_wht_income_type  text,
  receivable_account_id    uuid REFERENCES account(id),
  payable_account_id       uuid REFERENCES account(id),
  bank_account_json        jsonb NOT NULL DEFAULT '{}',
  is_active                boolean NOT NULL DEFAULT true,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX ON partner (company_id, tax_id);

-- ---------------------------------------------------------------------
-- SALES (AR)
-- ---------------------------------------------------------------------
CREATE TABLE sales_invoice (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  branch_id          uuid NOT NULL REFERENCES branch(id),
  doc_no             text,
  doc_date           date NOT NULL,
  due_date           date NOT NULL,
  partner_id         uuid NOT NULL REFERENCES partner(id),
  partner_snapshot   jsonb NOT NULL,               -- ★ ชื่อ/ที่อยู่/เลขผู้เสียภาษี/สาขา ณ วันออก
  currency           char(3) NOT NULL DEFAULT 'THB',
  fx_rate            numeric(19,8) NOT NULL DEFAULT 1,
  subtotal           numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount    numeric(19,4) NOT NULL DEFAULT 0,
  vat_base           numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount         numeric(19,4) NOT NULL DEFAULT 0,
  grand_total        numeric(19,4) NOT NULL DEFAULT 0,
  paid_amount        numeric(19,4) NOT NULL DEFAULT 0,
  status             doc_status NOT NULL DEFAULT 'draft',
  is_tax_invoice     boolean NOT NULL DEFAULT true,
  tax_invoice_no     text,
  tax_invoice_date   date,
  etax_status        etax_status NOT NULL DEFAULT 'not_applicable',
  journal_entry_id   uuid REFERENCES journal_entry(id),
  void_reason        text,
  created_by         uuid NOT NULL REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  issued_at          timestamptz,
  UNIQUE (company_id, doc_no),
  UNIQUE (company_id, branch_id, tax_invoice_no)
);
CREATE INDEX ON sales_invoice (company_id, partner_id, status, due_date);

CREATE TABLE credit_note (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES company(id),
  branch_id              uuid NOT NULL REFERENCES branch(id),
  doc_no                 text,
  doc_date               date NOT NULL,
  partner_id             uuid NOT NULL REFERENCES partner(id),
  partner_snapshot       jsonb NOT NULL,
  original_invoice_id    uuid NOT NULL REFERENCES sales_invoice(id),  -- ★ กฎหมายบังคับต้องอ้างอิง
  original_doc_no        text NOT NULL,
  original_doc_date      date NOT NULL,
  reason_code            text NOT NULL,            -- ★ ตาม ม.86/10
  reason_detail          text,
  base_amount            numeric(19,4) NOT NULL,
  vat_amount             numeric(19,4) NOT NULL,
  grand_total            numeric(19,4) NOT NULL,
  status                 doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id       uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

-- บรรทัดเอกสารใช้ร่วมกันทุกประเภท
CREATE TABLE document_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL,
  doc_type       text NOT NULL,                    -- sales_invoice|vendor_bill|quotation|...
  doc_id         uuid NOT NULL,
  line_no        smallint NOT NULL,
  item_id        uuid,
  description    text NOT NULL,
  quantity       numeric(19,6) NOT NULL DEFAULT 1,
  uom            text,
  unit_price     numeric(19,6) NOT NULL DEFAULT 0,
  discount_amount numeric(19,4) NOT NULL DEFAULT 0,
  line_amount    numeric(19,4) NOT NULL DEFAULT 0,
  tax_code_id    uuid REFERENCES tax_code(id),
  account_id     uuid REFERENCES account(id),
  dimension_json jsonb NOT NULL DEFAULT '{}',
  warehouse_id   uuid,
  UNIQUE (doc_type, doc_id, line_no)
);
CREATE INDEX ON document_line (doc_type, doc_id);

-- ---------------------------------------------------------------------
-- PURCHASE (AP)
-- ---------------------------------------------------------------------
CREATE TABLE vendor_bill (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  branch_id           uuid NOT NULL REFERENCES branch(id),
  doc_no              text,
  doc_date            date NOT NULL,
  due_date            date NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partner(id),
  partner_snapshot    jsonb NOT NULL,
  vendor_invoice_no   text NOT NULL,               -- เลขที่ใบกำกับของผู้ขาย
  vendor_invoice_date date NOT NULL,
  currency            char(3) NOT NULL DEFAULT 'THB',
  fx_rate             numeric(19,8) NOT NULL DEFAULT 1,
  subtotal            numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount          numeric(19,4) NOT NULL DEFAULT 0,
  wht_amount          numeric(19,4) NOT NULL DEFAULT 0,
  grand_total         numeric(19,4) NOT NULL DEFAULT 0,
  paid_amount         numeric(19,4) NOT NULL DEFAULT 0,
  status              doc_status NOT NULL DEFAULT 'draft',
  has_valid_tax_invoice boolean NOT NULL DEFAULT true,
  journal_entry_id    uuid REFERENCES journal_entry(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no),
  UNIQUE (company_id, partner_id, vendor_invoice_no)   -- ★ กันบันทึกใบกำกับซื้อซ้ำ
);

CREATE TABLE payment_voucher (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  payment_method   text NOT NULL,                  -- cash|transfer|cheque|card
  bank_account_id  uuid,
  cheque_no        text,
  cheque_date      date,
  gross_amount     numeric(19,4) NOT NULL,
  wht_amount       numeric(19,4) NOT NULL DEFAULT 0,
  fee_amount       numeric(19,4) NOT NULL DEFAULT 0,
  net_amount       numeric(19,4) NOT NULL,
  remittance_channel remit_channel NOT NULL DEFAULT 'manual',
  status           doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE payment_allocation (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id   uuid NOT NULL REFERENCES payment_voucher(id) ON DELETE CASCADE,
  bill_id      uuid NOT NULL REFERENCES vendor_bill(id),
  amount       numeric(19,4) NOT NULL CHECK (amount > 0)
);

CREATE TABLE wht_certificate (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  book_no          text NOT NULL,
  cert_no          text NOT NULL,
  issue_date       date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  partner_snapshot jsonb NOT NULL,
  form_code        text NOT NULL,                  -- PND1|PND3|PND53|PND54
  total_base       numeric(19,4) NOT NULL,
  total_wht        numeric(19,4) NOT NULL,
  payment_id       uuid REFERENCES payment_voucher(id),
  UNIQUE (company_id, book_no, cert_no)
);

-- ---------------------------------------------------------------------
-- BANKING
-- ---------------------------------------------------------------------
CREATE TABLE bank_account (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  account_id    uuid NOT NULL REFERENCES account(id),
  bank_code     text NOT NULL,                     -- SCB|KBANK|BBL|KTB|TTB
  account_no    text NOT NULL,
  account_name  text NOT NULL,
  account_kind  text NOT NULL DEFAULT 'savings',
  currency      char(3) NOT NULL DEFAULT 'THB',
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, bank_code, account_no)
);

CREATE TABLE bank_statement_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  bank_account_id uuid NOT NULL REFERENCES bank_account(id),
  txn_date        date NOT NULL,
  value_date      date,
  description     text,
  reference       text,
  debit           numeric(19,4) NOT NULL DEFAULT 0,
  credit          numeric(19,4) NOT NULL DEFAULT 0,
  balance         numeric(19,4),
  import_batch_id uuid,
  fingerprint     text NOT NULL,                   -- กันนำเข้าซ้ำ
  matched_line_id uuid,
  matched_at      timestamptz,
  UNIQUE (bank_account_id, fingerprint)
);

-- ---------------------------------------------------------------------
-- POSTING RULES (กติกาลงบัญชีเป็น config)
-- ---------------------------------------------------------------------
CREATE TABLE posting_rule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid REFERENCES company(id),  -- NULL = ค่าเริ่มต้นของระบบ
  doc_type           text NOT NULL,
  event              text NOT NULL,                -- issue|pay|void|receive
  condition_json     jsonb NOT NULL DEFAULT '{}',
  line_template_json jsonb NOT NULL,
  priority           smallint NOT NULL DEFAULT 100,
  is_active          boolean NOT NULL DEFAULT true
);

-- =====================================================================
-- TRIGGERS — บังคับกฎทางบัญชีที่ระดับฐานข้อมูล
-- =====================================================================

-- 1) เดบิตต้องเท่ากับเครดิตเสมอเมื่อ post
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric(19,4); c numeric(19,4);
BEGIN
  IF NEW.status = 'posted' AND (TG_OP = 'INSERT' OR OLD.status <> 'posted') THEN
    SELECT COALESCE(SUM(debit_base),0), COALESCE(SUM(credit_base),0)
      INTO d, c FROM journal_line WHERE entry_id = NEW.id;
    IF d <> c THEN
      RAISE EXCEPTION 'รายการไม่สมดุล: เดบิต % ≠ เครดิต % (entry %)', d, c, NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF d = 0 THEN
      RAISE EXCEPTION 'ไม่สามารถลงบัญชีรายการที่มียอดเป็นศูนย์ (entry %)', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_entry_balanced
  AFTER INSERT OR UPDATE ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- 2) ห้ามแก้/ลบรายการที่ลงบัญชีแล้ว (แก้ได้ทางเดียวคือกลับรายการ)
CREATE OR REPLACE FUNCTION block_posted_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted','reversed') THEN
      RAISE EXCEPTION 'ห้ามลบรายการที่ลงบัญชีแล้ว — ให้ใช้การกลับรายการแทน';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'posted' AND NEW.status = 'posted'
     AND (NEW.posting_date, NEW.description, NEW.branch_id)
      IS DISTINCT FROM (OLD.posting_date, OLD.description, OLD.branch_id) THEN
    RAISE EXCEPTION 'ห้ามแก้ไขรายการที่ลงบัญชีแล้ว (entry %)', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_posted_mutation
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION block_posted_mutation();

-- 3) ห้ามลงรายการในงวดที่ปิดแล้ว หรือก่อนวันล็อกแข็ง
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
DECLARE st period_status; lock_date date;
BEGIN
  IF NEW.status = 'posted' THEN
    SELECT status INTO st FROM accounting_period WHERE id = NEW.period_id;
    IF st <> 'open' THEN
      RAISE EXCEPTION 'งวดบัญชีนี้ถูกปิดแล้ว (สถานะ %) ไม่สามารถลงรายการได้', st;
    END IF;
    SELECT hard_lock_date INTO lock_date FROM company WHERE id = NEW.company_id;
    IF lock_date IS NOT NULL AND NEW.posting_date <= lock_date THEN
      RAISE EXCEPTION 'วันที่ลงบัญชี % อยู่ก่อนวันล็อกข้อมูล %', NEW.posting_date, lock_date;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_period_open
  BEFORE INSERT OR UPDATE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION assert_period_open();

-- 4) ห้ามลงรายการในบัญชีหัวข้อ (non-postable)
CREATE OR REPLACE FUNCTION assert_account_postable() RETURNS trigger AS $$
DECLARE ok boolean;
BEGIN
  SELECT is_postable AND is_active INTO ok FROM account WHERE id = NEW.account_id;
  IF NOT COALESCE(ok,false) THEN
    RAISE EXCEPTION 'บัญชีนี้เป็นบัญชีหัวข้อหรือถูกปิดใช้งาน ลงรายการไม่ได้ (account %)', NEW.account_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_account_postable
  BEFORE INSERT OR UPDATE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION assert_account_postable();

-- 5) ห้ามแก้รายการภาษีที่ยื่นแบบไปแล้ว
CREATE OR REPLACE FUNCTION block_filed_tax_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.filing_id IS NOT NULL THEN
    RAISE EXCEPTION 'รายการภาษีนี้ถูกนำไปยื่นแบบแล้ว แก้ไขไม่ได้ — ให้ยื่นแบบเพิ่มเติมแทน';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_block_filed_tax
  BEFORE UPDATE OR DELETE ON tax_transaction
  FOR EACH ROW EXECUTE FUNCTION block_filed_tax_mutation();

-- =====================================================================
-- ROW LEVEL SECURITY (multi-tenant)
-- =====================================================================
ALTER TABLE company        ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entry  ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_line   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_invoice  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_bill    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_transaction ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner        ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON company
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE POLICY company_isolation ON journal_entry
  USING (company_id = ANY (string_to_array(current_setting('app.company_ids', true), ',')::uuid[]));
-- (สร้าง policy ทำนองเดียวกันกับทุกตารางที่มี company_id)

-- =====================================================================
-- ตัวอย่างข้อมูลอัตราภาษี (seed) — แสดงหลัก "rate as data"
-- =====================================================================
-- INSERT INTO tax_code (code,name_th,kind,vat_treatment) VALUES
--   ('VAT7','ภาษีมูลค่าเพิ่ม 7%','vat_output','standard'),
--   ('VAT0','ภาษีมูลค่าเพิ่ม 0% (ส่งออก)','vat_output','zero_rated'),
--   ('EXEMPT','ยกเว้นภาษีมูลค่าเพิ่ม','vat_output','exempt'),
--   ('WHT_SVC','หัก ณ ที่จ่าย - ค่าบริการ','wht',NULL),
--   ('WHT_RENT','หัก ณ ที่จ่าย - ค่าเช่า','wht',NULL);
--
-- INSERT INTO tax_rate (tax_code_id, rate, effective_from, effective_to, condition_json, note) VALUES
--   (<VAT7>,  7.0, '2017-10-01', NULL, '{}', 'ลดอัตราตาม พ.ร.ฎ. ต่ออายุรายปี'),
--   (<WHT_SVC>,3.0, '2000-01-01', NULL, '{}', 'อัตราปกติ'),
--   (<WHT_SVC>,1.0, '2026-01-01','2027-12-31','{"channel":"e_wht"}','มาตรการ e-Withholding Tax'),
--   (<WHT_RENT>,5.0,'2000-01-01', NULL, '{}', 'ค่าเช่าอสังหาริมทรัพย์');
