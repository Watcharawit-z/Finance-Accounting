-- =====================================================================
-- 002 — GENERAL LEDGER
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE currency (
  code     char(3) PRIMARY KEY,
  name_th  text NOT NULL,
  name_en  text NOT NULL,
  symbol   text,
  decimals smallint NOT NULL DEFAULT 2
);

CREATE TABLE fx_rate (
  id        bigserial PRIMARY KEY,
  currency  char(3) NOT NULL REFERENCES currency(code),
  base      char(3) NOT NULL DEFAULT 'THB' REFERENCES currency(code),
  rate_date date NOT NULL,
  rate_type text NOT NULL DEFAULT 'bot_avg',   -- bot_buy|bot_sell|bot_avg|custom
  rate      numeric(19,8) NOT NULL CHECK (rate > 0),
  source    text,
  UNIQUE (currency, base, rate_date, rate_type)
);

CREATE TABLE fiscal_year (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES company(id),
  code       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  is_closed  boolean NOT NULL DEFAULT false,
  closed_at  timestamptz,
  closing_entry_id uuid,
  UNIQUE (company_id, code),
  CHECK (end_date > start_date)
);

CREATE TABLE accounting_period (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_year(id),
  period_no      smallint NOT NULL,
  code           text NOT NULL,                -- '2569-01'
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  status         period_status NOT NULL DEFAULT 'open',
  module_locks   jsonb NOT NULL DEFAULT '{}',  -- {"ar":true,"ap":false,"inventory":true}
  closed_by      uuid REFERENCES app_user(id),
  closed_at      timestamptz,
  reopened_by    uuid REFERENCES app_user(id),
  reopened_reason text,
  UNIQUE (company_id, code),
  EXCLUDE USING gist (company_id WITH =, daterange(start_date, end_date, '[]') WITH &&)
);

CREATE TABLE account (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  code                text NOT NULL,
  name_th             text NOT NULL,
  name_en             text,
  account_type        account_type NOT NULL,
  sub_type            text NOT NULL,
  parent_id           uuid REFERENCES account(id),
  path                ltree,
  level               smallint NOT NULL DEFAULT 1,
  is_postable         boolean NOT NULL DEFAULT true,
  is_contra           boolean NOT NULL DEFAULT false,
  is_system           boolean NOT NULL DEFAULT false,  -- บัญชีที่ระบบต้องใช้ ห้ามลบ
  currency            char(3) REFERENCES currency(code),
  default_tax_code_id uuid,
  requires_partner    boolean NOT NULL DEFAULT false,
  requires_dimension  text[] NOT NULL DEFAULT '{}',
  cash_flow_class     text,   -- operating|investing|financing|none  (ใช้ทำงบกระแสเงินสด)
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX ON account USING gist (path);
CREATE INDEX ON account (company_id, sub_type);
CREATE INDEX ON account (company_id, account_type, is_active);

CREATE TABLE dimension_type (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  code        text NOT NULL,      -- COST_CENTER|PROJECT|DEPARTMENT|PRODUCT_LINE
  name_th     text NOT NULL,
  is_required boolean NOT NULL DEFAULT false,
  applies_to  text[] NOT NULL DEFAULT '{}',   -- ['revenue','expense']
  sort_order  smallint NOT NULL DEFAULT 0,
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
  entry_no        text,
  journal_type    journal_type NOT NULL DEFAULT 'general',
  posting_date    date NOT NULL,
  doc_date        date NOT NULL,
  description     text NOT NULL,
  source_doc_type text,
  source_doc_id   uuid,
  status          je_status NOT NULL DEFAULT 'draft',
  reversal_of_id  uuid REFERENCES journal_entry(id),
  reversed_by_id  uuid REFERENCES journal_entry(id),
  is_auto         boolean NOT NULL DEFAULT false,
  reason          text,
  total_debit     numeric(19,4) NOT NULL DEFAULT 0,
  total_credit    numeric(19,4) NOT NULL DEFAULT 0,
  created_by      uuid NOT NULL REFERENCES app_user(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  posted_by       uuid REFERENCES app_user(id),
  posted_at       timestamptz,
  UNIQUE (company_id, entry_no)
);
CREATE INDEX ON journal_entry (company_id, posting_date, status);
CREATE INDEX ON journal_entry (source_doc_type, source_doc_id);
CREATE INDEX ON journal_entry (company_id, period_id, journal_type);

CREATE TABLE journal_line (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id       uuid NOT NULL,
  company_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
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
  CONSTRAINT jl_non_negative CHECK (debit >= 0 AND credit >= 0),
  CONSTRAINT jl_one_side     CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT jl_has_amount   CHECK (debit > 0 OR credit > 0)
) PARTITION BY RANGE (posting_date);

CREATE TABLE journal_line_2569 PARTITION OF journal_line
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE INDEX ON journal_line (company_id, account_id, posting_date);
CREATE INDEX ON journal_line (entry_id);
CREATE INDEX ON journal_line (company_id, partner_id, posting_date);
CREATE INDEX ON journal_line USING gin (dimension_json);

-- ยอดคงเหลือรายเดือน (aggregate ที่อัปเดตตอน post) — ทำให้รายงานเร็ว
CREATE TABLE gl_balance_monthly (
  company_id    uuid NOT NULL,
  branch_id     uuid NOT NULL,
  account_id    uuid NOT NULL REFERENCES account(id),
  period_code   text NOT NULL,
  dimension_key text NOT NULL DEFAULT '',
  currency      char(3) NOT NULL DEFAULT 'THB',
  opening_base  numeric(19,4) NOT NULL DEFAULT 0,
  debit_base    numeric(19,4) NOT NULL DEFAULT 0,
  credit_base   numeric(19,4) NOT NULL DEFAULT 0,
  closing_base  numeric(19,4) NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, branch_id, account_id, period_code, dimension_key)
);

-- กติกาการลงบัญชีเป็นข้อมูล ไม่ใช่โค้ด
CREATE TABLE posting_rule (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid REFERENCES company(id),
  doc_type           text NOT NULL,
  event              text NOT NULL,
  condition_json     jsonb NOT NULL DEFAULT '{}',
  line_template_json jsonb NOT NULL,
  priority           smallint NOT NULL DEFAULT 100,
  is_active          boolean NOT NULL DEFAULT true
);
CREATE INDEX ON posting_rule (doc_type, event, priority);

-- รายการซ้ำ (ค่าเช่า ค่าเสื่อม ค่าตัดจำหน่าย)
CREATE TABLE recurring_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  branch_id     uuid NOT NULL REFERENCES branch(id),
  name          text NOT NULL,
  frequency     text NOT NULL,          -- monthly|quarterly|yearly
  day_of_month  smallint NOT NULL DEFAULT 1,
  start_date    date NOT NULL,
  end_date      date,
  next_run_date date NOT NULL,
  template_json jsonb NOT NULL,          -- โครง JE
  auto_post     boolean NOT NULL DEFAULT false,
  last_entry_id uuid REFERENCES journal_entry(id),
  is_active     boolean NOT NULL DEFAULT true
);

-- รายการระหว่างบริษัท (สำหรับงบรวม)
CREATE TABLE intercompany_link (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_company_id   uuid NOT NULL REFERENCES company(id),
  to_company_id     uuid NOT NULL REFERENCES company(id),
  from_entry_id     uuid REFERENCES journal_entry(id),
  to_entry_id       uuid REFERENCES journal_entry(id),
  amount            numeric(19,4) NOT NULL,
  eliminated_period text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
