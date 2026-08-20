-- =====================================================================
-- 011 — PROJECTS, JOB COSTING, BUDGETING
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE project (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  branch_id      uuid REFERENCES branch(id),
  code           text NOT NULL,
  name_th        text NOT NULL,
  customer_id    uuid REFERENCES partner(id),
  project_type   text,                -- construction|service|internal|rnd
  manager_id     uuid REFERENCES app_user(id),
  start_date     date,
  end_date       date,
  contract_value numeric(19,4),
  budget_cost    numeric(19,4),
  actual_revenue numeric(19,4) NOT NULL DEFAULT 0,
  actual_cost    numeric(19,4) NOT NULL DEFAULT 0,
  percent_complete numeric(9,4) NOT NULL DEFAULT 0,
  retention_percent numeric(9,4) NOT NULL DEFAULT 0,
  revenue_method text NOT NULL DEFAULT 'completed',  -- completed|percentage_of_completion
  status         text NOT NULL DEFAULT 'active',     -- planning|active|on_hold|completed|cancelled
  dimension_value_id uuid REFERENCES dimension_value(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

CREATE TABLE project_phase (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name_th     text NOT NULL,
  start_date  date,
  end_date    date,
  budget_cost numeric(19,4),
  weight_percent numeric(9,4),
  UNIQUE (project_id, code)
);

CREATE TABLE project_budget_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  phase_id     uuid REFERENCES project_phase(id),
  cost_type    text NOT NULL,      -- material|labor|subcontract|overhead|equipment
  account_id   uuid REFERENCES account(id),
  description  text,
  budget_amount numeric(19,4) NOT NULL,
  actual_amount numeric(19,4) NOT NULL DEFAULT 0,
  committed_amount numeric(19,4) NOT NULL DEFAULT 0   -- จาก PO ที่เปิดค้าง
);

CREATE TABLE job_cost_entry (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  project_id    uuid NOT NULL REFERENCES project(id),
  phase_id      uuid REFERENCES project_phase(id),
  entry_date    date NOT NULL,
  cost_type     text NOT NULL,
  description   text NOT NULL,
  quantity      numeric(19,6),
  unit_cost     numeric(19,6),
  amount        numeric(19,4) NOT NULL,
  account_id    uuid REFERENCES account(id),
  source_doc_type text,
  source_doc_id uuid,
  journal_entry_id uuid REFERENCES journal_entry(id)
);
CREATE INDEX ON job_cost_entry (company_id, project_id, entry_date);

CREATE TABLE project_milestone (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  seq_no        smallint NOT NULL,
  name_th       text NOT NULL,
  planned_date  date,
  completed_date date,
  billing_percent numeric(9,4),
  billing_amount  numeric(19,4),
  retention_amount numeric(19,4) NOT NULL DEFAULT 0,
  invoice_id    uuid REFERENCES sales_invoice(id),
  status        text NOT NULL DEFAULT 'pending',
  UNIQUE (project_id, seq_no)
);

CREATE TABLE timesheet (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  employee_id uuid NOT NULL REFERENCES employee(id),
  work_date   date NOT NULL,
  project_id  uuid REFERENCES project(id),
  phase_id    uuid REFERENCES project_phase(id),
  hours       numeric(9,2) NOT NULL CHECK (hours > 0),
  description text,
  hourly_cost numeric(19,4),
  is_billable boolean NOT NULL DEFAULT true,
  status      approval_state NOT NULL DEFAULT 'pending',
  approved_by uuid REFERENCES app_user(id),
  -- project_id/phase_id IS NULL = เวลาที่ไม่ผูกโครงการ
  UNIQUE NULLS NOT DISTINCT (employee_id, work_date, project_id, phase_id)
);

-- งานระหว่างทำตามสัญญา (สำหรับ percentage of completion)
CREATE TABLE contract_wip (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  project_id      uuid NOT NULL REFERENCES project(id),
  period_code     text NOT NULL,
  cost_to_date    numeric(19,4) NOT NULL,
  estimated_total_cost numeric(19,4) NOT NULL,
  percent_complete numeric(9,4) NOT NULL,
  revenue_recognized numeric(19,4) NOT NULL,
  billed_to_date  numeric(19,4) NOT NULL,
  unbilled_revenue numeric(19,4) NOT NULL,
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, project_id, period_code)
);

-- ---------------------------------------------------------------------
-- BUDGETING
-- ---------------------------------------------------------------------
CREATE TABLE budget (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  fiscal_year_id uuid NOT NULL REFERENCES fiscal_year(id),
  code           text NOT NULL,
  name_th        text NOT NULL,
  control_mode   text NOT NULL DEFAULT 'none',   -- none|warn|block
  status         text NOT NULL DEFAULT 'draft',  -- draft|approved|closed
  approved_by    uuid REFERENCES app_user(id),
  approved_at    timestamptz,
  UNIQUE (company_id, code)
);

CREATE TABLE budget_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id   uuid NOT NULL REFERENCES budget(id) ON DELETE CASCADE,
  version_no  smallint NOT NULL,
  name        text NOT NULL,     -- 'ตั้งต้น' | 'ปรับปรุงครั้งที่ 1'
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (budget_id, version_no)
);

CREATE TABLE budget_line (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_version_id uuid NOT NULL REFERENCES budget_version(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL,
  account_id        uuid NOT NULL REFERENCES account(id),
  branch_id         uuid REFERENCES branch(id),
  dimension_key     text NOT NULL DEFAULT '',
  period_code       text NOT NULL,
  amount            numeric(19,4) NOT NULL DEFAULT 0,
  note              text,
  -- branch_id IS NULL = งบระดับบริษัท (ไม่แยกสาขา)
  UNIQUE NULLS NOT DISTINCT (budget_version_id, account_id, branch_id, dimension_key, period_code)
);
CREATE INDEX ON budget_line (company_id, period_code, account_id);

CREATE TABLE forecast (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  name           text NOT NULL,
  base_period    text NOT NULL,
  horizon_months smallint NOT NULL DEFAULT 12,
  method         text NOT NULL DEFAULT 'manual',   -- manual|trend|driver
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE forecast_line (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  forecast_id uuid NOT NULL REFERENCES forecast(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES account(id),
  period_code text NOT NULL,
  amount      numeric(19,4) NOT NULL,
  confidence  numeric(5,2)
);
