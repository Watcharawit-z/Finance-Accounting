-- =====================================================================
-- 001 — EXTENSIONS, ENUMS, PLATFORM
-- =====================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "ltree";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "btree_gist";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE SCHEMA IF NOT EXISTS duly;
SET search_path TO duly, public;

-- ---------------------------------------------------------------------
-- ENUMS (ใช้ร่วมทั้งระบบ)
-- ---------------------------------------------------------------------
CREATE TYPE account_type   AS ENUM ('asset','liability','equity','revenue','expense');
CREATE TYPE entity_type    AS ENUM ('individual','juristic','government','foreign');
CREATE TYPE partner_kind   AS ENUM ('customer','vendor','both','employee');
CREATE TYPE je_status      AS ENUM ('draft','posted','reversed','void');
CREATE TYPE journal_type   AS ENUM ('general','sales','purchase','receipt','payment','payroll','inventory','asset','opening','closing','adjustment');
CREATE TYPE period_status  AS ENUM ('open','soft_closed','closed','tax_filed');
CREATE TYPE doc_status     AS ENUM ('draft','pending_approval','approved','issued','partially_received','received','partially_paid','paid','closed','void','cancelled','rejected','expired');
CREATE TYPE tax_kind       AS ENUM ('vat_output','vat_input','wht','sbt','stamp');
CREATE TYPE vat_treatment  AS ENUM ('standard','zero_rated','exempt','out_of_scope','non_claimable');
CREATE TYPE remit_channel  AS ENUM ('manual','e_wht');
CREATE TYPE etax_status    AS ENUM ('not_applicable','pending','signed','submitted','accepted','rejected');
CREATE TYPE costing_method AS ENUM ('weighted_average','fifo','standard','specific');
CREATE TYPE deprec_method  AS ENUM ('straight_line','declining_balance','sum_of_years','units_of_production','none');
CREATE TYPE approval_state AS ENUM ('pending','approved','rejected','cancelled','skipped');
CREATE TYPE move_direction AS ENUM ('in','out','transfer','adjust');

-- ---------------------------------------------------------------------
-- TENANT / COMPANY / BRANCH
-- ---------------------------------------------------------------------
CREATE TABLE tenant (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text UNIQUE NOT NULL,
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'core',
  is_firm     boolean NOT NULL DEFAULT false,   -- true = สำนักงานบัญชี ดูแลหลายบริษัท
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE company (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL REFERENCES tenant(id),
  parent_company_id   uuid REFERENCES company(id),     -- โครงสร้างกลุ่มบริษัทสำหรับงบรวม
  code                text NOT NULL,
  legal_name_th       text NOT NULL,
  legal_name_en       text,
  trade_name          text,
  tax_id              char(13) NOT NULL,
  registration_no     text,
  entity_type         entity_type NOT NULL DEFAULT 'juristic',
  business_type       text,                            -- trading|service|manufacturing|construction|realestate
  is_vat_registered   boolean NOT NULL DEFAULT true,
  vat_registered_date date,
  sso_employer_no     text,                            -- เลขที่บัญชีนายจ้างประกันสังคม
  fiscal_year_end_mm  smallint NOT NULL DEFAULT 12 CHECK (fiscal_year_end_mm BETWEEN 1 AND 12),
  fiscal_year_end_dd  smallint NOT NULL DEFAULT 31,
  base_currency       char(3) NOT NULL DEFAULT 'THB',
  accounting_standard text NOT NULL DEFAULT 'TFRS_NPAE',
  costing_method      costing_method NOT NULL DEFAULT 'weighted_average',
  hard_lock_date      date,
  retention_years     smallint NOT NULL DEFAULT 5 CHECK (retention_years >= 5),
  address_json        jsonb NOT NULL DEFAULT '{}',
  logo_url            text,
  bookkeeper_name     text,
  bookkeeper_cpd_no   text,
  auditor_name        text,
  auditor_cpa_no      text,
  settings_json       jsonb NOT NULL DEFAULT '{}',
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code),
  CONSTRAINT company_tax_id_digits CHECK (tax_id ~ '^[0-9]{13}$')
);

CREATE TABLE branch (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  code           char(5) NOT NULL,
  name_th        text NOT NULL,
  name_en        text,
  address_json   jsonb NOT NULL DEFAULT '{}',
  is_head_office boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX one_head_office_per_company
  ON branch (company_id) WHERE is_head_office;

-- ---------------------------------------------------------------------
-- USERS / RBAC
-- ---------------------------------------------------------------------
CREATE TABLE app_user (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id),
  email         citext NOT NULL,
  full_name     text NOT NULL,
  phone         text,
  password_hash text,
  mfa_secret    text,
  mfa_enabled   boolean NOT NULL DEFAULT false,
  locale        text NOT NULL DEFAULT 'th',
  date_format   text NOT NULL DEFAULT 'buddhist',    -- buddhist|gregorian
  density       text NOT NULL DEFAULT 'default',
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE role (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenant(id),   -- NULL = บทบาทมาตรฐานของระบบ
  code        text NOT NULL,
  name_th     text NOT NULL,
  name_en     text,
  description text,
  permissions jsonb NOT NULL DEFAULT '[]',  -- ['invoice:write','gl:post',...]
  is_system   boolean NOT NULL DEFAULT false,
  -- NULLS NOT DISTINCT: tenant_id IS NULL = บทบาทของระบบ ต้องไม่ซ้ำกันเองด้วย
  UNIQUE NULLS NOT DISTINCT (tenant_id, code)
);

CREATE TABLE user_company_role (
  user_id    uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES company(id),
  role_id    uuid NOT NULL REFERENCES role(id),
  scope_json jsonb NOT NULL DEFAULT '{}',   -- {branch_ids:[],department_ids:[],project_ids:[]}
  granted_by uuid REFERENCES app_user(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id, role_id)
);

CREATE TABLE api_client (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id),
  name           text NOT NULL,
  client_id      text UNIQUE NOT NULL,
  secret_hash    text NOT NULL,
  scopes         text[] NOT NULL DEFAULT '{}',
  ip_allowlist   inet[],
  expires_at     timestamptz NOT NULL,
  last_used_at   timestamptz,
  is_active      boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------------
-- DOCUMENT NUMBERING
-- ---------------------------------------------------------------------
CREATE TABLE document_sequence (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  branch_id   uuid REFERENCES branch(id),
  doc_type    text NOT NULL,
  period_key  text NOT NULL,          -- 'YYYY-MM' | 'YYYY' | 'ALL'
  prefix      text NOT NULL DEFAULT '',
  suffix      text NOT NULL DEFAULT '',
  padding     smallint NOT NULL DEFAULT 5,
  next_no     bigint NOT NULL DEFAULT 1,
  -- ★ ต้องเป็น NULLS NOT DISTINCT ไม่งั้นชุดเลข branch_id IS NULL ซ้ำกันได้
  --   แล้ว next_document_no() จะล็อกผิดแถว → เลขที่เอกสารซ้ำ
  UNIQUE NULLS NOT DISTINCT (company_id, branch_id, doc_type, period_key)
);

-- เลขที่เอกสารที่ถูกยกเลิก — เก็บไว้เพื่อพิสูจน์ว่าเลขไม่ขาดช่วง
CREATE TABLE voided_document_no (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(id),
  doc_type   text NOT NULL,
  doc_no     text NOT NULL,
  voided_at  timestamptz NOT NULL DEFAULT now(),
  voided_by  uuid REFERENCES app_user(id),
  reason     text NOT NULL,
  UNIQUE (company_id, doc_type, doc_no)
);

-- ---------------------------------------------------------------------
-- AUDIT / ATTACHMENT / SETTINGS
-- ---------------------------------------------------------------------
CREATE TABLE audit_event (
  id            bigserial,
  tenant_id     uuid NOT NULL,
  company_id    uuid,
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_ip      inet,
  actor_agent   text,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  action        text NOT NULL,
  before_json   jsonb,
  after_json    jsonb,
  reason        text,
  request_id    text,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit_event_2569 PARTITION OF audit_event
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE INDEX ON audit_event (company_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX ON audit_event (company_id, actor_user_id, occurred_at DESC);

CREATE TABLE attachment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  entity_type     text NOT NULL,
  entity_id       uuid NOT NULL,
  doc_category    text,                 -- tax_invoice|receipt|contract|po|other
  file_name       text NOT NULL,
  mime_type       text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  storage_key     text NOT NULL,
  sha256          char(64) NOT NULL,
  page_count      smallint,
  ocr_text        text,                 -- เตรียมไว้สำหรับ full-text search + AI เฟสหลัง
  uploaded_by     uuid REFERENCES app_user(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now(),
  retention_until date,
  legal_hold      boolean NOT NULL DEFAULT false,
  deleted_at      timestamptz
);
CREATE INDEX ON attachment (company_id, entity_type, entity_id);
CREATE INDEX ON attachment USING gin (ocr_text gin_trgm_ops);

CREATE TABLE setting (
  company_id uuid NOT NULL REFERENCES company(id),
  key        text NOT NULL,
  value_json jsonb NOT NULL,
  updated_by uuid REFERENCES app_user(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, key)
);

-- ---------------------------------------------------------------------
-- MASTER DATA ที่ใช้ร่วมกัน
-- ---------------------------------------------------------------------
CREATE TABLE province (
  code     char(2) PRIMARY KEY,
  name_th  text NOT NULL,
  name_en  text NOT NULL,
  region   text
);

CREATE TABLE district (
  code        char(4) PRIMARY KEY,
  province_code char(2) NOT NULL REFERENCES province(code),
  name_th     text NOT NULL,
  name_en     text
);

CREATE TABLE subdistrict (
  code          char(6) PRIMARY KEY,
  district_code char(4) NOT NULL REFERENCES district(code),
  name_th       text NOT NULL,
  name_en       text,
  postcode      char(5) NOT NULL
);

CREATE TABLE bank_holiday (
  holiday_date date PRIMARY KEY,
  name_th      text NOT NULL,
  name_en      text,
  is_bank      boolean NOT NULL DEFAULT true,
  is_public    boolean NOT NULL DEFAULT true
);

CREATE TABLE payment_term (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid REFERENCES company(id),
  code        text NOT NULL,
  name_th     text NOT NULL,
  days        smallint NOT NULL DEFAULT 0,
  term_type   text NOT NULL DEFAULT 'net',   -- net|eom|eom_plus|cod|prepaid
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE NULLS NOT DISTINCT (company_id, code)
);
