-- =====================================================================
-- 009 — FIXED ASSETS
-- แยกค่าเสื่อม "ทางบัญชี" กับ "ทางภาษี" ออกจากกันเสมอ
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE asset_category (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id               uuid NOT NULL REFERENCES company(id),
  code                     text NOT NULL,
  name_th                  text NOT NULL,
  tax_asset_class          text,            -- โยงกับ tax_depreciation_rate
  asset_account_id         uuid NOT NULL REFERENCES account(id),
  accum_deprec_account_id  uuid REFERENCES account(id),
  deprec_expense_account_id uuid REFERENCES account(id),
  disposal_account_id      uuid REFERENCES account(id),
  book_method              deprec_method NOT NULL DEFAULT 'straight_line',
  book_useful_life_years   numeric(9,2),
  book_salvage_percent     numeric(9,4) NOT NULL DEFAULT 0,
  tax_method               deprec_method NOT NULL DEFAULT 'straight_line',
  tax_max_rate_percent     numeric(9,4),
  UNIQUE (company_id, code)
);

CREATE TABLE fixed_asset (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  branch_id           uuid NOT NULL REFERENCES branch(id),
  asset_no            text NOT NULL,
  name_th             text NOT NULL,
  category_id         uuid NOT NULL REFERENCES asset_category(id),
  serial_no           text,
  location            text,
  custodian_id        uuid REFERENCES app_user(id),
  department_id       uuid,
  project_id          uuid,
  acquired_date       date NOT NULL,
  in_service_date     date NOT NULL,
  supplier_id         uuid REFERENCES partner(id),
  source_doc_type     text,
  source_doc_id       uuid,
  acquisition_cost    numeric(19,4) NOT NULL,
  additional_cost     numeric(19,4) NOT NULL DEFAULT 0,
  -- ทางบัญชี
  book_method         deprec_method NOT NULL,
  book_useful_life_years numeric(9,2),
  book_salvage_value  numeric(19,4) NOT NULL DEFAULT 0,
  book_accum_deprec   numeric(19,4) NOT NULL DEFAULT 0,
  book_net_value      numeric(19,4) NOT NULL DEFAULT 0,
  -- ทางภาษี
  tax_method          deprec_method NOT NULL,
  tax_rate_percent    numeric(9,4),
  tax_accum_deprec    numeric(19,4) NOT NULL DEFAULT 0,
  tax_net_value       numeric(19,4) NOT NULL DEFAULT 0,
  -- อื่น ๆ
  quantity            numeric(19,4) NOT NULL DEFAULT 1,
  barcode             text,
  photo_url           text,
  status              text NOT NULL DEFAULT 'in_use',  -- in_use|idle|under_repair|disposed|written_off
  disposed_date       date,
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, asset_no)
);
CREATE INDEX ON fixed_asset (company_id, category_id, status);

CREATE TABLE depreciation_schedule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id     uuid NOT NULL REFERENCES fixed_asset(id) ON DELETE CASCADE,
  basis        text NOT NULL,             -- book|tax
  period_code  text NOT NULL,
  period_end   date NOT NULL,
  opening_nbv  numeric(19,4) NOT NULL,
  amount       numeric(19,4) NOT NULL,
  accumulated  numeric(19,4) NOT NULL,
  closing_nbv  numeric(19,4) NOT NULL,
  is_posted    boolean NOT NULL DEFAULT false,
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (asset_id, basis, period_code)
);
CREATE INDEX ON depreciation_schedule (period_code, basis, is_posted);

CREATE TABLE depreciation_run (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  period_code   text NOT NULL,
  basis         text NOT NULL DEFAULT 'book',
  asset_count   integer NOT NULL DEFAULT 0,
  total_amount  numeric(19,4) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'draft',   -- draft|posted|reversed
  journal_entry_id uuid REFERENCES journal_entry(id),
  run_by        uuid REFERENCES app_user(id),
  run_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, period_code, basis)
);

CREATE TABLE asset_disposal (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  doc_no         text,
  asset_id       uuid NOT NULL REFERENCES fixed_asset(id),
  disposal_date  date NOT NULL,
  disposal_type  text NOT NULL,        -- sale|scrap|donation|loss|trade_in
  buyer_id       uuid REFERENCES partner(id),
  proceeds       numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount     numeric(19,4) NOT NULL DEFAULT 0,
  book_nbv       numeric(19,4) NOT NULL,
  tax_nbv        numeric(19,4) NOT NULL,
  book_gain_loss numeric(19,4) NOT NULL,
  tax_gain_loss  numeric(19,4) NOT NULL,
  sales_invoice_id uuid REFERENCES sales_invoice(id),
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE asset_movement (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id    uuid NOT NULL REFERENCES fixed_asset(id),
  move_date   date NOT NULL,
  move_type   text NOT NULL,       -- transfer|revaluation|impairment|improvement|split
  from_value  jsonb,
  to_value    jsonb,
  amount      numeric(19,4),
  reason      text,
  journal_entry_id uuid REFERENCES journal_entry(id),
  created_by  uuid REFERENCES app_user(id)
);

-- งานระหว่างก่อสร้าง
CREATE TABLE cip_project (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  code          text NOT NULL,
  name_th       text NOT NULL,
  account_id    uuid NOT NULL REFERENCES account(id),
  start_date    date NOT NULL,
  budget_amount numeric(19,4),
  accumulated   numeric(19,4) NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'in_progress',
  transferred_asset_id uuid REFERENCES fixed_asset(id),
  transferred_date date,
  UNIQUE (company_id, code)
);

-- สินทรัพย์ไม่มีตัวตน (ค่าตัดจำหน่าย)
CREATE TABLE intangible_asset (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  asset_no          text NOT NULL,
  name_th           text NOT NULL,
  kind              text NOT NULL,     -- software|license|patent|goodwill|other
  acquired_date     date NOT NULL,
  cost              numeric(19,4) NOT NULL,
  useful_life_years numeric(9,2),
  accum_amortization numeric(19,4) NOT NULL DEFAULT 0,
  net_value         numeric(19,4) NOT NULL DEFAULT 0,
  asset_account_id  uuid REFERENCES account(id),
  amort_account_id  uuid REFERENCES account(id),
  status            text NOT NULL DEFAULT 'in_use',
  UNIQUE (company_id, asset_no)
);
