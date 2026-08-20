-- =====================================================================
-- 007 — BANKING & CASH MANAGEMENT
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE bank_account (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  branch_id      uuid REFERENCES branch(id),
  account_id     uuid NOT NULL REFERENCES account(id),
  bank_code      text NOT NULL,        -- SCB|KBANK|BBL|KTB|TTB|BAY|GSB
  bank_branch    text,
  account_no     text NOT NULL,
  account_name   text NOT NULL,
  account_kind   text NOT NULL DEFAULT 'savings',  -- savings|current|fixed|foreign
  currency       char(3) NOT NULL DEFAULT 'THB' REFERENCES currency(code),
  promptpay_id   text,
  api_enabled    boolean NOT NULL DEFAULT false,
  api_config     jsonb,
  is_active      boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, bank_code, account_no)
);

CREATE TABLE bank_statement (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  bank_account_id uuid NOT NULL REFERENCES bank_account(id),
  period_start    date NOT NULL,
  period_end      date NOT NULL,
  opening_balance numeric(19,4) NOT NULL,
  closing_balance numeric(19,4) NOT NULL,
  source          text NOT NULL DEFAULT 'file_import',  -- file_import|api
  file_name       text,
  imported_by     uuid REFERENCES app_user(id),
  imported_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bank_statement_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  statement_id    uuid REFERENCES bank_statement(id),
  bank_account_id uuid NOT NULL REFERENCES bank_account(id),
  txn_date        date NOT NULL,
  value_date      date,
  description     text,
  channel         text,                 -- ATM|TRANSFER|CHEQUE|FEE|INTEREST
  reference       text,
  counterparty    text,
  debit           numeric(19,4) NOT NULL DEFAULT 0,
  credit          numeric(19,4) NOT NULL DEFAULT 0,
  running_balance numeric(19,4),
  fingerprint     text NOT NULL,        -- hash กันนำเข้าซ้ำ
  match_status    text NOT NULL DEFAULT 'unmatched',   -- unmatched|suggested|matched|ignored
  suggested_json  jsonb,                -- ผลการจับคู่อัตโนมัติ + คะแนนความมั่นใจ
  UNIQUE (bank_account_id, fingerprint)
);
CREATE INDEX ON bank_statement_line (company_id, bank_account_id, txn_date, match_status);

CREATE TABLE bank_reconciliation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  bank_account_id   uuid NOT NULL REFERENCES bank_account(id),
  period_code       text NOT NULL,
  statement_balance numeric(19,4) NOT NULL,
  gl_balance        numeric(19,4) NOT NULL,
  outstanding_deposits numeric(19,4) NOT NULL DEFAULT 0,
  outstanding_cheques  numeric(19,4) NOT NULL DEFAULT 0,
  difference        numeric(19,4) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'open',   -- open|balanced|closed
  closed_by         uuid REFERENCES app_user(id),
  closed_at         timestamptz,
  UNIQUE (company_id, bank_account_id, period_code)
);

CREATE TABLE reconciliation_match (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid REFERENCES bank_reconciliation(id),
  statement_line_id uuid NOT NULL REFERENCES bank_statement_line(id),
  journal_line_id   uuid,
  source_doc_type   text,
  source_doc_id     uuid,
  amount            numeric(19,4) NOT NULL,
  matched_by        uuid REFERENCES app_user(id),
  matched_at        timestamptz NOT NULL DEFAULT now(),
  match_method      text NOT NULL DEFAULT 'manual'   -- manual|auto_exact|auto_fuzzy|rule
);

CREATE TABLE cheque (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  direction       text NOT NULL,          -- received|issued
  cheque_no       text NOT NULL,
  bank_code       text NOT NULL,
  bank_branch     text,
  cheque_date     date NOT NULL,          -- วันที่ลงในเช็ค (อาจล่วงหน้า)
  amount          numeric(19,4) NOT NULL,
  partner_id      uuid REFERENCES partner(id),
  bank_account_id uuid REFERENCES bank_account(id),
  status          text NOT NULL DEFAULT 'on_hand',
    -- received: on_hand|deposited|cleared|bounced|returned
    -- issued:   prepared|delivered|cleared|cancelled|stop_payment
  status_date     date,
  source_doc_type text,
  source_doc_id   uuid,
  journal_entry_id uuid REFERENCES journal_entry(id),
  note            text,
  UNIQUE (company_id, direction, bank_code, cheque_no)
);
CREATE INDEX ON cheque (company_id, status, cheque_date);

CREATE TABLE bank_transfer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  doc_no        text,
  doc_date      date NOT NULL,
  from_account_id uuid NOT NULL REFERENCES bank_account(id),
  to_account_id   uuid NOT NULL REFERENCES bank_account(id),
  amount        numeric(19,4) NOT NULL CHECK (amount > 0),
  fee_amount    numeric(19,4) NOT NULL DEFAULT 0,
  fx_rate       numeric(19,8),
  status        doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no),
  CHECK (from_account_id <> to_account_id)
);

-- ประมาณการกระแสเงินสด 13 สัปดาห์
CREATE TABLE cashflow_forecast_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES company(id),
  week_start    date NOT NULL,
  category      text NOT NULL,      -- ar_collection|ap_payment|payroll|tax|loan|other
  source_doc_type text,
  source_doc_id uuid,
  expected_date date NOT NULL,
  amount        numeric(19,4) NOT NULL,
  confidence    numeric(5,2) NOT NULL DEFAULT 100,
  is_manual     boolean NOT NULL DEFAULT false,
  generated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON cashflow_forecast_line (company_id, week_start);
