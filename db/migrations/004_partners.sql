-- =====================================================================
-- 004 — PARTNERS (ลูกค้า / ผู้ขาย)
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE partner (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES company(id),
  kind                    partner_kind NOT NULL,
  code                    text NOT NULL,
  legal_name_th           text NOT NULL,
  legal_name_en           text,
  trade_name              text,
  entity_type             entity_type NOT NULL,   -- ★ ตัดสิน ภ.ง.ด.3 (บุคคล) vs ภ.ง.ด.53 (นิติบุคคล)
  tax_id                  char(13),
  branch_code             char(5) DEFAULT '00000',
  branch_name             text,
  is_vat_registered       boolean NOT NULL DEFAULT false,
  is_related_party        boolean NOT NULL DEFAULT false,
  payment_term_id         uuid REFERENCES payment_term(id),
  credit_limit            numeric(19,4),
  credit_hold             boolean NOT NULL DEFAULT false,
  default_wht_income_type text,
  default_currency        char(3) REFERENCES currency(code),
  price_list_id           uuid,
  receivable_account_id   uuid REFERENCES account(id),
  payable_account_id      uuid REFERENCES account(id),
  default_revenue_account_id uuid REFERENCES account(id),
  default_expense_account_id uuid REFERENCES account(id),
  tags                    text[] NOT NULL DEFAULT '{}',
  note                    text,
  is_active               boolean NOT NULL DEFAULT true,
  created_by              uuid REFERENCES app_user(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX ON partner (company_id, tax_id);
CREATE INDEX ON partner (company_id, kind, is_active);
CREATE INDEX ON partner USING gin (legal_name_th gin_trgm_ops);

CREATE TABLE partner_address (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id    uuid NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  address_kind  text NOT NULL,   -- tax_invoice|billing|shipping|office
  is_default    boolean NOT NULL DEFAULT false,
  line1         text NOT NULL,
  line2         text,
  subdistrict_code char(6) REFERENCES subdistrict(code),
  district_code char(4) REFERENCES district(code),
  province_code char(2) REFERENCES province(code),
  postcode      char(5),
  country       char(2) NOT NULL DEFAULT 'TH',
  full_text_th  text NOT NULL     -- ที่อยู่รูปแบบพิมพ์บนเอกสาร
);

CREATE TABLE partner_contact (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   text,
  email      citext,
  phone      text,
  line_id    text,
  is_primary boolean NOT NULL DEFAULT false,
  receives   text[] NOT NULL DEFAULT '{}'   -- ['invoice','receipt','statement','dunning']
);

CREATE TABLE partner_bank_account (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id   uuid NOT NULL REFERENCES partner(id) ON DELETE CASCADE,
  bank_code    text NOT NULL,
  account_no   text NOT NULL,
  account_name text NOT NULL,
  is_default   boolean NOT NULL DEFAULT false,
  -- การเปลี่ยนเลขบัญชีต้องอนุมัติซ้ำ (กันฉ้อโกงเปลี่ยนปลายทางโอน)
  verified_by  uuid REFERENCES app_user(id),
  verified_at  timestamptz
);

-- ประวัติวงเงินเครดิตและการอนุมัติ
CREATE TABLE partner_credit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid NOT NULL REFERENCES partner(id),
  old_limit   numeric(19,4),
  new_limit   numeric(19,4) NOT NULL,
  reason      text,
  approved_by uuid REFERENCES app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
