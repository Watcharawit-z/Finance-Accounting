-- =====================================================================
-- 010 — PAYROLL & HR
-- ข้อมูลอ่อนไหวตาม PDPA: เลขบัตรประชาชน เงินเดือน เลขบัญชีธนาคาร
-- ต้องเข้ารหัสระดับคอลัมน์และจำกัดสิทธิ์เฉพาะ role HR/Payroll
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE department (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  code        text NOT NULL,
  name_th     text NOT NULL,
  parent_id   uuid REFERENCES department(id),
  manager_id  uuid,
  cost_center_id uuid REFERENCES dimension_value(id),
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE employee (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  branch_id          uuid NOT NULL REFERENCES branch(id),
  employee_no        text NOT NULL,
  user_id            uuid REFERENCES app_user(id),
  title_th           text,
  first_name_th      text NOT NULL,
  last_name_th       text NOT NULL,
  first_name_en      text,
  last_name_en       text,
  national_id_enc    bytea,          -- ★ เข้ารหัส (เลขบัตรประชาชน 13 หลัก)
  national_id_last4  char(4),        -- แสดงผลบางส่วน
  passport_no_enc    bytea,
  nationality        char(2) NOT NULL DEFAULT 'TH',
  birth_date         date,
  gender             text,
  marital_status     text,
  spouse_has_income  boolean NOT NULL DEFAULT false,
  address_json       jsonb NOT NULL DEFAULT '{}',
  phone              text,
  email              citext,
  department_id      uuid REFERENCES department(id),
  position           text,
  employment_type    text NOT NULL DEFAULT 'monthly',  -- monthly|daily|hourly|contract
  hire_date          date NOT NULL,
  probation_end_date date,
  resign_date        date,
  resign_reason      text,
  sso_no             text,           -- เลขที่ประกันสังคม
  sso_hospital       text,
  is_sso_member      boolean NOT NULL DEFAULT true,
  pvd_member         boolean NOT NULL DEFAULT false,
  pvd_employee_rate  numeric(9,4),
  pvd_employer_rate  numeric(9,4),
  bank_code          text,
  bank_account_enc   bytea,          -- ★ เข้ารหัส
  tax_calc_method    text NOT NULL DEFAULT 'annualized',  -- annualized|per_period
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_no)
);
CREATE INDEX ON employee (company_id, department_id, is_active);

CREATE TABLE employment_contract (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  effective_from date NOT NULL,
  effective_to  date,
  position      text,
  department_id uuid REFERENCES department(id),
  base_salary   numeric(19,4) NOT NULL,
  daily_rate    numeric(19,4),
  hourly_rate   numeric(19,4),
  work_days_per_week smallint NOT NULL DEFAULT 5,
  reason        text,          -- hire|promotion|adjustment|transfer
  approved_by   uuid REFERENCES app_user(id)
);

-- ประเภทเงินได้/เงินหัก
CREATE TABLE pay_component (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  code              text NOT NULL,
  name_th           text NOT NULL,
  component_kind    text NOT NULL,   -- earning|deduction|employer_contribution
  is_taxable        boolean NOT NULL DEFAULT true,
  is_sso_base       boolean NOT NULL DEFAULT true,
  is_pvd_base       boolean NOT NULL DEFAULT false,
  is_recurring      boolean NOT NULL DEFAULT false,
  calc_type         text NOT NULL DEFAULT 'fixed',   -- fixed|formula|rate_x_qty
  formula           text,
  account_id        uuid REFERENCES account(id),
  sort_order        smallint NOT NULL DEFAULT 0,
  is_active         boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE employee_pay_component (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  component_id   uuid NOT NULL REFERENCES pay_component(id),
  amount         numeric(19,4),
  effective_from date NOT NULL,
  effective_to   date
);

CREATE TABLE pay_run (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  branch_id       uuid REFERENCES branch(id),
  doc_no          text,
  period_code     text NOT NULL,       -- '2569-01'
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  payment_date    date NOT NULL,
  run_type        text NOT NULL DEFAULT 'regular',  -- regular|bonus|adjustment|final
  employee_count  integer NOT NULL DEFAULT 0,
  total_earning   numeric(19,4) NOT NULL DEFAULT 0,
  total_deduction numeric(19,4) NOT NULL DEFAULT 0,
  total_net       numeric(19,4) NOT NULL DEFAULT 0,
  total_pit       numeric(19,4) NOT NULL DEFAULT 0,
  total_sso_employee numeric(19,4) NOT NULL DEFAULT 0,
  total_sso_employer numeric(19,4) NOT NULL DEFAULT 0,
  total_pvd_employee numeric(19,4) NOT NULL DEFAULT 0,
  total_pvd_employer numeric(19,4) NOT NULL DEFAULT 0,
  status          doc_status NOT NULL DEFAULT 'draft',
  approved_by     uuid REFERENCES app_user(id),
  journal_entry_id uuid REFERENCES journal_entry(id),
  bank_file_key   text,
  UNIQUE (company_id, period_code, run_type)
);

CREATE TABLE pay_slip (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_run_id        uuid NOT NULL REFERENCES pay_run(id) ON DELETE CASCADE,
  company_id        uuid NOT NULL,
  employee_id       uuid NOT NULL REFERENCES employee(id),
  employee_snapshot jsonb NOT NULL,
  work_days         numeric(9,2),
  absent_days       numeric(9,2) NOT NULL DEFAULT 0,
  ot_hours_1_5      numeric(9,2) NOT NULL DEFAULT 0,
  ot_hours_2        numeric(9,2) NOT NULL DEFAULT 0,
  ot_hours_3        numeric(9,2) NOT NULL DEFAULT 0,
  gross_earning     numeric(19,4) NOT NULL DEFAULT 0,
  taxable_income    numeric(19,4) NOT NULL DEFAULT 0,
  pit_amount        numeric(19,4) NOT NULL DEFAULT 0,
  sso_employee      numeric(19,4) NOT NULL DEFAULT 0,
  sso_employer      numeric(19,4) NOT NULL DEFAULT 0,
  sso_wage_base     numeric(19,4) NOT NULL DEFAULT 0,   -- หลังใช้เพดาน
  pvd_employee      numeric(19,4) NOT NULL DEFAULT 0,
  pvd_employer      numeric(19,4) NOT NULL DEFAULT 0,
  other_deduction   numeric(19,4) NOT NULL DEFAULT 0,
  net_pay           numeric(19,4) NOT NULL DEFAULT 0,
  pdf_storage_key   text,
  sent_at           timestamptz,
  UNIQUE (pay_run_id, employee_id)
);

CREATE TABLE pay_slip_line (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pay_slip_id  uuid NOT NULL REFERENCES pay_slip(id) ON DELETE CASCADE,
  component_id uuid REFERENCES pay_component(id),
  code         text NOT NULL,
  name_th      text NOT NULL,
  kind         text NOT NULL,
  quantity     numeric(19,4),
  rate         numeric(19,4),
  amount       numeric(19,4) NOT NULL,
  sort_order   smallint NOT NULL DEFAULT 0
);

-- ค่าลดหย่อนที่พนักงานแจ้ง (ล.ย.01)
CREATE TABLE employee_tax_allowance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employee(id) ON DELETE CASCADE,
  tax_year      smallint NOT NULL,
  deduction_code text NOT NULL,
  quantity      smallint NOT NULL DEFAULT 1,
  amount        numeric(19,4) NOT NULL DEFAULT 0,
  evidence_key  text,
  declared_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, tax_year, deduction_code)
);

-- เพดานและอัตราประกันสังคมตามช่วงเวลา
CREATE TABLE sso_rate (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from    date NOT NULL,
  effective_to      date,
  employee_percent  numeric(9,4) NOT NULL,
  employer_percent  numeric(9,4) NOT NULL,
  wage_floor        numeric(19,4) NOT NULL,
  wage_ceiling      numeric(19,4) NOT NULL,
  max_contribution  numeric(19,4) NOT NULL,
  breakdown_json    jsonb NOT NULL DEFAULT '{}',   -- {"sickness":1.5,"unemployment":0.5,"old_age":3.0}
  legal_ref         text
);

CREATE TABLE sso_submission (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  period_code    text NOT NULL,
  due_date       date NOT NULL,
  employee_count integer NOT NULL DEFAULT 0,
  total_wage     numeric(19,4) NOT NULL DEFAULT 0,
  employee_amount numeric(19,4) NOT NULL DEFAULT 0,
  employer_amount numeric(19,4) NOT NULL DEFAULT 0,
  total_amount   numeric(19,4) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'draft',
  filed_date     date,
  file_key       text,
  UNIQUE (company_id, period_code)
);

-- กองทุนเงินทดแทน (นายจ้างจ่ายฝ่ายเดียว รายปี)
CREATE TABLE workmen_compensation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  year           smallint NOT NULL,
  risk_rate      numeric(9,4) NOT NULL,
  estimated_wage numeric(19,4) NOT NULL,
  amount         numeric(19,4) NOT NULL,
  paid_date      date,
  UNIQUE (company_id, year)
);

-- ประมาณการผลประโยชน์พนักงาน (ค่าชดเชยเลิกจ้าง)
CREATE TABLE employee_benefit_provision (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  as_of_date      date NOT NULL,
  employee_id     uuid REFERENCES employee(id),
  service_years   numeric(9,2) NOT NULL,
  severance_days  smallint NOT NULL,
  estimated_amount numeric(19,4) NOT NULL,
  present_value   numeric(19,4) NOT NULL,
  discount_rate   numeric(9,4),
  journal_entry_id uuid REFERENCES journal_entry(id)
);

CREATE TABLE leave_type (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  code          text NOT NULL,
  name_th       text NOT NULL,
  days_per_year numeric(9,2),
  is_paid       boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE leave_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  employee_id  uuid NOT NULL REFERENCES employee(id),
  leave_type_id uuid NOT NULL REFERENCES leave_type(id),
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  days         numeric(9,2) NOT NULL,
  reason       text,
  status       approval_state NOT NULL DEFAULT 'pending',
  approved_by  uuid REFERENCES app_user(id)
);
