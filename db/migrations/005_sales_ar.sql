-- =====================================================================
-- 005 — SALES / ACCOUNTS RECEIVABLE
-- ใบเสนอราคา → ใบสั่งขาย → ใบส่งของ → ใบกำกับภาษี → ใบเสร็จ
-- =====================================================================
SET search_path TO duly, public;

-- บรรทัดเอกสารใช้ตารางร่วมทุกประเภท (header แยก เพราะฟิลด์ต่างกันมาก)
CREATE TABLE document_line (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  doc_type        text NOT NULL,
  doc_id          uuid NOT NULL,
  line_no         smallint NOT NULL,
  line_kind       text NOT NULL DEFAULT 'item',   -- item|description|discount|subtotal
  item_id         uuid,
  item_code       text,
  description     text NOT NULL,
  quantity        numeric(19,6) NOT NULL DEFAULT 1,
  uom_id          uuid,
  unit_price      numeric(19,6) NOT NULL DEFAULT 0,
  discount_percent numeric(9,4) NOT NULL DEFAULT 0,
  discount_amount numeric(19,4) NOT NULL DEFAULT 0,
  line_amount     numeric(19,4) NOT NULL DEFAULT 0,
  tax_code_id     uuid REFERENCES tax_code(id),
  tax_amount      numeric(19,4) NOT NULL DEFAULT 0,
  account_id      uuid REFERENCES account(id),
  dimension_json  jsonb NOT NULL DEFAULT '{}',
  warehouse_id    uuid,
  delivered_qty   numeric(19,6) NOT NULL DEFAULT 0,
  invoiced_qty    numeric(19,6) NOT NULL DEFAULT 0,
  source_line_id  uuid,       -- โยงกลับบรรทัดของเอกสารต้นทาง
  note            text,
  UNIQUE (doc_type, doc_id, line_no)
);
CREATE INDEX ON document_line (doc_type, doc_id);
CREATE INDEX ON document_line (company_id, item_id);

CREATE TABLE quotation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  valid_until      date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  partner_snapshot jsonb NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'THB',
  fx_rate          numeric(19,8) NOT NULL DEFAULT 1,
  subtotal         numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount  numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount       numeric(19,4) NOT NULL DEFAULT 0,
  grand_total      numeric(19,4) NOT NULL DEFAULT 0,
  status           doc_status NOT NULL DEFAULT 'draft',
  terms            text,
  sales_rep_id     uuid REFERENCES app_user(id),
  converted_so_id  uuid,
  created_by       uuid NOT NULL REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE sales_order (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  delivery_date    date,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  partner_snapshot jsonb NOT NULL,
  customer_po_no   text,
  quotation_id     uuid REFERENCES quotation(id),
  project_id       uuid,
  currency         char(3) NOT NULL DEFAULT 'THB',
  fx_rate          numeric(19,8) NOT NULL DEFAULT 1,
  subtotal         numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount  numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount       numeric(19,4) NOT NULL DEFAULT 0,
  grand_total      numeric(19,4) NOT NULL DEFAULT 0,
  status           doc_status NOT NULL DEFAULT 'draft',
  created_by       uuid NOT NULL REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE delivery_note (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  partner_snapshot jsonb NOT NULL,
  sales_order_id   uuid REFERENCES sales_order(id),
  ship_to_address  text,
  vehicle_no       text,
  driver_name      text,
  warehouse_id     uuid,
  status           doc_status NOT NULL DEFAULT 'draft',
  stock_move_batch uuid,
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE sales_invoice (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES company(id),
  branch_id         uuid NOT NULL REFERENCES branch(id),
  doc_no            text,
  doc_date          date NOT NULL,
  due_date          date NOT NULL,
  partner_id        uuid NOT NULL REFERENCES partner(id),
  partner_snapshot  jsonb NOT NULL,            -- ★ ชื่อ/ที่อยู่/เลขผู้เสียภาษี/สาขา ณ วันออก
  sales_order_id    uuid REFERENCES sales_order(id),
  project_id        uuid,
  currency          char(3) NOT NULL DEFAULT 'THB',
  fx_rate           numeric(19,8) NOT NULL DEFAULT 1,
  subtotal          numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount   numeric(19,4) NOT NULL DEFAULT 0,
  vat_base          numeric(19,4) NOT NULL DEFAULT 0,
  vat_exempt_base   numeric(19,4) NOT NULL DEFAULT 0,
  vat_zero_base     numeric(19,4) NOT NULL DEFAULT 0,
  vat_amount        numeric(19,4) NOT NULL DEFAULT 0,
  wht_amount        numeric(19,4) NOT NULL DEFAULT 0,   -- ที่ลูกค้าจะหักไว้
  grand_total       numeric(19,4) NOT NULL DEFAULT 0,
  paid_amount       numeric(19,4) NOT NULL DEFAULT 0,
  credited_amount   numeric(19,4) NOT NULL DEFAULT 0,
  status            doc_status NOT NULL DEFAULT 'draft',
  is_tax_invoice    boolean NOT NULL DEFAULT true,
  is_abbreviated    boolean NOT NULL DEFAULT false,     -- ใบกำกับภาษีอย่างย่อ ม.86/6
  tax_invoice_no    text,
  tax_invoice_date  date,
  tax_invoice_book  text,
  etax_status       etax_status NOT NULL DEFAULT 'not_applicable',
  deposit_applied   numeric(19,4) NOT NULL DEFAULT 0,
  journal_entry_id  uuid REFERENCES journal_entry(id),
  void_reason       text,
  voided_by         uuid REFERENCES app_user(id),
  note              text,
  internal_note     text,
  created_by        uuid NOT NULL REFERENCES app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  issued_at         timestamptz,
  UNIQUE (company_id, doc_no)
);
CREATE UNIQUE INDEX uq_tax_invoice_no
  ON sales_invoice (company_id, branch_id, tax_invoice_no)
  WHERE tax_invoice_no IS NOT NULL;
CREATE INDEX ON sales_invoice (company_id, partner_id, status, due_date);
CREATE INDEX ON sales_invoice (company_id, doc_date);
CREATE INDEX ON sales_invoice (company_id, etax_status) WHERE etax_status IN ('pending','rejected');

CREATE TABLE credit_note (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  branch_id           uuid NOT NULL REFERENCES branch(id),
  doc_no              text,
  doc_date            date NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partner(id),
  partner_snapshot    jsonb NOT NULL,
  original_invoice_id uuid NOT NULL REFERENCES sales_invoice(id),  -- ★ กฎหมายบังคับ
  original_doc_no     text NOT NULL,
  original_doc_date   date NOT NULL,
  reason_code         text NOT NULL,   -- ★ enum ตาม ม.86/10 (ดู docs/12)
  reason_detail       text,
  base_amount         numeric(19,4) NOT NULL,
  vat_amount          numeric(19,4) NOT NULL,
  grand_total         numeric(19,4) NOT NULL,
  status              doc_status NOT NULL DEFAULT 'draft',
  etax_status         etax_status NOT NULL DEFAULT 'not_applicable',
  journal_entry_id    uuid REFERENCES journal_entry(id),
  created_by          uuid NOT NULL REFERENCES app_user(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE debit_note (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES company(id),
  branch_id           uuid NOT NULL REFERENCES branch(id),
  doc_no              text,
  doc_date            date NOT NULL,
  partner_id          uuid NOT NULL REFERENCES partner(id),
  partner_snapshot    jsonb NOT NULL,
  original_invoice_id uuid NOT NULL REFERENCES sales_invoice(id),
  original_doc_no     text NOT NULL,
  original_doc_date   date NOT NULL,
  reason_code         text NOT NULL,   -- ตาม ม.86/9
  reason_detail       text,
  base_amount         numeric(19,4) NOT NULL,
  vat_amount          numeric(19,4) NOT NULL,
  grand_total         numeric(19,4) NOT NULL,
  status              doc_status NOT NULL DEFAULT 'draft',
  etax_status         etax_status NOT NULL DEFAULT 'not_applicable',
  journal_entry_id    uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE receipt (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  partner_snapshot jsonb NOT NULL,
  payment_method   text NOT NULL,        -- cash|transfer|cheque|card|promptpay|offset
  bank_account_id  uuid,
  cheque_id        uuid,
  reference        text,
  gross_amount     numeric(19,4) NOT NULL,
  wht_amount       numeric(19,4) NOT NULL DEFAULT 0,   -- ลูกค้าหักไว้
  wht_cert_received boolean NOT NULL DEFAULT false,
  wht_cert_no      text,
  fee_amount       numeric(19,4) NOT NULL DEFAULT 0,
  discount_amount  numeric(19,4) NOT NULL DEFAULT 0,   -- ส่วนลดจ่าย/ผลต่างเศษ
  net_amount       numeric(19,4) NOT NULL,
  currency         char(3) NOT NULL DEFAULT 'THB',
  fx_rate          numeric(19,8) NOT NULL DEFAULT 1,
  fx_gain_loss     numeric(19,4) NOT NULL DEFAULT 0,
  status           doc_status NOT NULL DEFAULT 'draft',
  is_tax_receipt   boolean NOT NULL DEFAULT false,     -- ใบเสร็จ/ใบกำกับภาษี (เงินสด)
  etax_status      etax_status NOT NULL DEFAULT 'not_applicable',
  journal_entry_id uuid REFERENCES journal_entry(id),
  created_by       uuid NOT NULL REFERENCES app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE receipt_allocation (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id  uuid NOT NULL REFERENCES receipt(id) ON DELETE CASCADE,
  invoice_id  uuid REFERENCES sales_invoice(id),
  deposit_id  uuid,
  amount      numeric(19,4) NOT NULL CHECK (amount <> 0),
  wht_amount  numeric(19,4) NOT NULL DEFAULT 0
);
CREATE INDEX ON receipt_allocation (invoice_id);

CREATE TABLE customer_deposit (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       uuid NOT NULL REFERENCES company(id),
  branch_id        uuid NOT NULL REFERENCES branch(id),
  doc_no           text,
  doc_date         date NOT NULL,
  partner_id       uuid NOT NULL REFERENCES partner(id),
  partner_snapshot jsonb NOT NULL,
  sales_order_id   uuid REFERENCES sales_order(id),
  amount           numeric(19,4) NOT NULL,
  vat_amount       numeric(19,4) NOT NULL DEFAULT 0,   -- VAT เกิด ณ วันรับเงิน
  applied_amount   numeric(19,4) NOT NULL DEFAULT 0,
  refunded_amount  numeric(19,4) NOT NULL DEFAULT 0,
  status           doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE recurring_invoice (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  partner_id     uuid NOT NULL REFERENCES partner(id),
  name           text NOT NULL,
  frequency      text NOT NULL,
  day_of_month   smallint NOT NULL DEFAULT 1,
  start_date     date NOT NULL,
  end_date       date,
  next_run_date  date NOT NULL,
  template_json  jsonb NOT NULL,
  auto_issue     boolean NOT NULL DEFAULT false,
  is_active      boolean NOT NULL DEFAULT true
);

CREATE TABLE dunning_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  partner_id   uuid NOT NULL REFERENCES partner(id),
  invoice_id   uuid REFERENCES sales_invoice(id),
  level        smallint NOT NULL,       -- 1..4
  channel      text NOT NULL,           -- email|line|call|letter
  sent_at      timestamptz NOT NULL DEFAULT now(),
  sent_by      uuid REFERENCES app_user(id),
  outstanding  numeric(19,4) NOT NULL,
  days_overdue smallint NOT NULL,
  response     text
);

-- ค่าเผื่อผลขาดทุนด้านเครดิต (ตั้งตามอายุหนี้)
CREATE TABLE ecl_matrix (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  bucket_from    smallint NOT NULL,
  bucket_to      smallint,
  loss_percent   numeric(9,4) NOT NULL,
  effective_from date NOT NULL
);
