-- =====================================================================
-- 006 — PURCHASE / ACCOUNTS PAYABLE
-- ใบขอซื้อ → ใบสั่งซื้อ → ใบรับสินค้า → ตั้งหนี้ → จ่ายชำระ
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE purchase_request (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  branch_id    uuid NOT NULL REFERENCES branch(id),
  doc_no       text,
  doc_date     date NOT NULL,
  need_by_date date,
  requester_id uuid NOT NULL REFERENCES app_user(id),
  department_id uuid,
  project_id   uuid,
  purpose      text NOT NULL,
  estimated_amount numeric(19,4) NOT NULL DEFAULT 0,
  budget_check_result text,        -- ok|warning|over_budget
  status       doc_status NOT NULL DEFAULT 'draft',
  approval_request_id uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE purchase_order (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  branch_id         uuid NOT NULL REFERENCES branch(id),
  doc_no            text,
  doc_date          date NOT NULL,
  expected_date     date,
  partner_id        uuid NOT NULL REFERENCES partner(id),
  partner_snapshot  jsonb NOT NULL,
  purchase_request_id uuid REFERENCES purchase_request(id),
  project_id        uuid,
  currency          char(3) NOT NULL DEFAULT 'THB',
  fx_rate           numeric(19,8) NOT NULL DEFAULT 1,
  subtotal          numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount   numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount        numeric(19,4) NOT NULL DEFAULT 0,
  grand_total       numeric(19,4) NOT NULL DEFAULT 0,
  received_amount   numeric(19,4) NOT NULL DEFAULT 0,
  invoiced_amount   numeric(19,4) NOT NULL DEFAULT 0,
  status            doc_status NOT NULL DEFAULT 'draft',
  delivery_address  text,
  terms             text,
  approval_request_id uuid,
  created_by        uuid NOT NULL REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no)
);
CREATE INDEX ON purchase_order (company_id, partner_id, status);

CREATE TABLE goods_receipt (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  purchase_order_id uuid REFERENCES purchase_order(id),
  warehouse_id     uuid,
  vendor_do_no     text,
  status           doc_status NOT NULL DEFAULT 'draft',
  stock_move_batch uuid,
  journal_entry_id uuid REFERENCES journal_entry(id),   -- Dr สินค้า Cr พักรับสินค้า (GRNI)
  received_by      uuid REFERENCES app_user(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE vendor_bill (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  branch_id           uuid NOT NULL REFERENCES branch(id),
  doc_no              text,
  doc_date            date NOT NULL,
  due_date            date NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partner(id),
  partner_snapshot    jsonb NOT NULL,
  vendor_invoice_no   text NOT NULL,
  vendor_invoice_date date NOT NULL,
  purchase_order_id   uuid REFERENCES purchase_order(id),
  goods_receipt_id    uuid REFERENCES goods_receipt(id),
  project_id          uuid,
  currency            char(3) NOT NULL DEFAULT 'THB',
  fx_rate             numeric(19,8) NOT NULL DEFAULT 1,
  subtotal            numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount     numeric(19,4) NOT NULL DEFAULT 0,
  vat_base            numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount          numeric(19,4) NOT NULL DEFAULT 0,
  non_claimable_vat   numeric(19,4) NOT NULL DEFAULT 0,   -- ภาษีซื้อต้องห้าม
  wht_amount          numeric(19,4) NOT NULL DEFAULT 0,
  grand_total         numeric(19,4) NOT NULL DEFAULT 0,
  paid_amount         numeric(19,4) NOT NULL DEFAULT 0,
  status              doc_status NOT NULL DEFAULT 'draft',
  has_valid_tax_invoice boolean NOT NULL DEFAULT true,
  tax_invoice_received_date date,       -- วันที่ได้รับ (กำหนดงวดที่ใช้ภาษีซื้อได้)
  is_deferred_input_vat boolean NOT NULL DEFAULT false,
  three_way_match     text,             -- matched|qty_variance|price_variance|no_po
  approval_request_id uuid,
  journal_entry_id    uuid REFERENCES journal_entry(id),
  created_by          uuid NOT NULL REFERENCES app_user(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no),
  UNIQUE (company_id, partner_id, vendor_invoice_no, vendor_invoice_date)  -- ★ กันบันทึกซ้ำ
);
CREATE INDEX ON vendor_bill (company_id, partner_id, status, due_date);

CREATE TABLE vendor_credit_note (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  branch_id           uuid NOT NULL REFERENCES branch(id),
  doc_no              text,
  doc_date            date NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partner(id),
  partner_snapshot    jsonb NOT NULL,
  original_bill_id    uuid NOT NULL REFERENCES vendor_bill(id),
  vendor_cn_no        text NOT NULL,
  reason_code         text NOT NULL,
  base_amount         numeric(19,4) NOT NULL,
  vat_amount          numeric(19,4) NOT NULL,
  grand_total         numeric(19,4) NOT NULL,
  status              doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id    uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE payment_voucher (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES company(id),
  branch_id          uuid NOT NULL REFERENCES branch(id),
  doc_no             text,
  doc_date           date NOT NULL,
  partner_id         uuid NOT NULL REFERENCES partner(id),
  partner_snapshot   jsonb NOT NULL,
  payment_method     text NOT NULL,     -- cash|transfer|cheque|card|promptpay
  bank_account_id    uuid,
  cheque_id          uuid,
  reference          text,
  currency           char(3) NOT NULL DEFAULT 'THB',
  fx_rate            numeric(19,8) NOT NULL DEFAULT 1,
  gross_amount       numeric(19,4) NOT NULL,
  wht_amount         numeric(19,4) NOT NULL DEFAULT 0,
  fee_amount         numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount    numeric(19,4) NOT NULL DEFAULT 0,
  fx_gain_loss       numeric(19,4) NOT NULL DEFAULT 0,
  net_amount         numeric(19,4) NOT NULL,
  remittance_channel remit_channel NOT NULL DEFAULT 'manual',   -- ★ e_wht = ธนาคารนำส่งแทน
  wht_cert_id        uuid REFERENCES wht_certificate(id),
  status             doc_status NOT NULL DEFAULT 'draft',
  approval_request_id uuid,
  journal_entry_id   uuid REFERENCES journal_entry(id),
  created_by         uuid NOT NULL REFERENCES app_user(id),
  approved_by        uuid REFERENCES app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE payment_allocation (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id    uuid NOT NULL REFERENCES payment_voucher(id) ON DELETE CASCADE,
  bill_id       uuid REFERENCES vendor_bill(id),
  advance_id    uuid,
  amount        numeric(19,4) NOT NULL CHECK (amount <> 0),
  wht_amount    numeric(19,4) NOT NULL DEFAULT 0,
  wht_income_type text,
  wht_rate      numeric(9,4)
);
CREATE INDEX ON payment_allocation (bill_id);

CREATE TABLE expense_claim (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  employee_id      uuid NOT NULL,
  purpose          text NOT NULL,
  total_amount     numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount       numeric(19,4) NOT NULL DEFAULT 0,
  advance_deducted numeric(19,4) NOT NULL DEFAULT 0,
  net_payable      numeric(19,4) NOT NULL DEFAULT 0,
  status           doc_status NOT NULL DEFAULT 'draft',
  approval_request_id uuid,
  paid_with_payroll boolean NOT NULL DEFAULT false,
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE employee_advance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  doc_no           text,
  doc_date         date NOT NULL,
  employee_id      uuid NOT NULL,
  purpose          text NOT NULL,
  amount           numeric(19,4) NOT NULL,
  cleared_amount   numeric(19,4) NOT NULL DEFAULT 0,
  returned_amount  numeric(19,4) NOT NULL DEFAULT 0,
  due_date         date,
  status           doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE petty_cash_fund (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  branch_id      uuid NOT NULL REFERENCES branch(id),
  name           text NOT NULL,
  custodian_id   uuid REFERENCES app_user(id),
  account_id     uuid NOT NULL REFERENCES account(id),
  imprest_amount numeric(19,4) NOT NULL,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE petty_cash_txn (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fund_id       uuid NOT NULL REFERENCES petty_cash_fund(id),
  company_id    uuid NOT NULL REFERENCES company(id),
  doc_no        text,
  txn_date      date NOT NULL,
  description   text NOT NULL,
  account_id    uuid REFERENCES account(id),
  amount        numeric(19,4) NOT NULL,
  vat_amount    numeric(19,4) NOT NULL DEFAULT 0,
  partner_id    uuid REFERENCES partner(id),
  is_replenish  boolean NOT NULL DEFAULT false,
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);
