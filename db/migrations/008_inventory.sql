-- =====================================================================
-- 008 — INVENTORY & COSTING
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE uom (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES company(id),
  code       text NOT NULL,
  name_th    text NOT NULL,
  name_en    text,
  category   text NOT NULL DEFAULT 'unit',   -- unit|weight|volume|length|time
  decimals   smallint NOT NULL DEFAULT 2,
  UNIQUE NULLS NOT DISTINCT (company_id, code)
);

CREATE TABLE uom_conversion (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_uom_id uuid NOT NULL REFERENCES uom(id),
  to_uom_id   uuid NOT NULL REFERENCES uom(id),
  factor      numeric(19,8) NOT NULL CHECK (factor > 0),
  item_id     uuid,          -- NULL = ใช้ได้ทุกสินค้า
  UNIQUE NULLS NOT DISTINCT (from_uom_id, to_uom_id, item_id)
);

CREATE TABLE item_category (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  code        text NOT NULL,
  name_th     text NOT NULL,
  parent_id   uuid REFERENCES item_category(id),
  inventory_account_id uuid REFERENCES account(id),
  cogs_account_id      uuid REFERENCES account(id),
  revenue_account_id   uuid REFERENCES account(id),
  UNIQUE (company_id, code)
);

CREATE TABLE item (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES company(id),
  code            text NOT NULL,
  barcode         text,
  name_th         text NOT NULL,
  name_en         text,
  description     text,
  item_type       text NOT NULL DEFAULT 'stock',  -- stock|service|non_stock|asset|kit
  category_id     uuid REFERENCES item_category(id),
  base_uom_id     uuid NOT NULL REFERENCES uom(id),
  sales_uom_id    uuid REFERENCES uom(id),
  purchase_uom_id uuid REFERENCES uom(id),
  costing_method  costing_method,      -- NULL = ใช้ค่าของบริษัท
  standard_cost   numeric(19,6),
  last_cost       numeric(19,6),
  average_cost    numeric(19,6),
  sales_price     numeric(19,6),
  sales_tax_code_id    uuid REFERENCES tax_code(id),
  purchase_tax_code_id uuid REFERENCES tax_code(id),
  inventory_account_id uuid REFERENCES account(id),
  cogs_account_id      uuid REFERENCES account(id),
  revenue_account_id   uuid REFERENCES account(id),
  expense_account_id   uuid REFERENCES account(id),
  track_lot       boolean NOT NULL DEFAULT false,
  track_serial    boolean NOT NULL DEFAULT false,
  track_expiry    boolean NOT NULL DEFAULT false,
  reorder_point   numeric(19,6),
  reorder_qty     numeric(19,6),
  lead_time_days  smallint,
  weight_kg       numeric(19,6),
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);
CREATE INDEX ON item (company_id, category_id, is_active);
CREATE INDEX ON item USING gin (name_th gin_trgm_ops);

CREATE TABLE warehouse (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES company(id),
  branch_id   uuid REFERENCES branch(id),
  code        text NOT NULL,
  name_th     text NOT NULL,
  address     text,
  keeper_id   uuid REFERENCES app_user(id),
  is_default  boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, code)
);

CREATE TABLE storage_location (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id uuid NOT NULL REFERENCES warehouse(id),
  code         text NOT NULL,
  name         text,
  UNIQUE (warehouse_id, code)
);

CREATE TABLE item_lot (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  item_id      uuid NOT NULL REFERENCES item(id),
  lot_no       text NOT NULL,
  serial_no    text,
  mfg_date     date,
  expiry_date  date,
  -- serial_no เป็น NULL ได้ (ติดตามแค่ระดับ lot) จึงต้อง NULLS NOT DISTINCT
  UNIQUE NULLS NOT DISTINCT (company_id, item_id, lot_no, serial_no)
);

-- การเคลื่อนไหวสต๊อกทุกรายการ (perpetual) — partition ตามวันที่
CREATE TABLE stock_move (
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  move_date       date NOT NULL,
  batch_id        uuid,
  direction       move_direction NOT NULL,
  item_id         uuid NOT NULL REFERENCES item(id),
  warehouse_id    uuid NOT NULL REFERENCES warehouse(id),
  location_id     uuid REFERENCES storage_location(id),
  lot_id          uuid REFERENCES item_lot(id),
  quantity        numeric(19,6) NOT NULL,       -- +เข้า / -ออก (ในหน่วยฐาน)
  unit_cost       numeric(19,6) NOT NULL DEFAULT 0,
  total_cost      numeric(19,4) NOT NULL DEFAULT 0,
  balance_qty     numeric(19,6),                -- ยอดคงเหลือหลังรายการนี้
  balance_value   numeric(19,4),
  avg_cost_after  numeric(19,6),
  source_doc_type text,
  source_doc_id   uuid,
  journal_entry_id uuid,
  reason          text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, move_date)
) PARTITION BY RANGE (move_date);

CREATE TABLE stock_move_2569 PARTITION OF stock_move
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE INDEX ON stock_move (company_id, item_id, warehouse_id, move_date);
CREATE INDEX ON stock_move (source_doc_type, source_doc_id);

CREATE TABLE stock_balance (
  company_id    uuid NOT NULL,
  item_id       uuid NOT NULL REFERENCES item(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouse(id),
  -- ★ PK บังคับ NOT NULL อยู่แล้ว จึงต้องมีค่า sentinel สำหรับสินค้าที่ไม่ติดตาม lot
  --   ไม่งั้นสินค้าทั่วไปจะเก็บยอดคงเหลือไม่ได้เลย
  lot_id        uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  quantity      numeric(19,6) NOT NULL DEFAULT 0,
  reserved_qty  numeric(19,6) NOT NULL DEFAULT 0,
  value         numeric(19,4) NOT NULL DEFAULT 0,
  average_cost  numeric(19,6) NOT NULL DEFAULT 0,
  last_move_at  timestamptz,
  PRIMARY KEY (company_id, item_id, warehouse_id, lot_id)
);

-- ชั้นต้นทุนสำหรับ FIFO
CREATE TABLE cost_layer (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  item_id       uuid NOT NULL REFERENCES item(id),
  warehouse_id  uuid NOT NULL REFERENCES warehouse(id),
  acquired_date date NOT NULL,
  original_qty  numeric(19,6) NOT NULL,
  remaining_qty numeric(19,6) NOT NULL,
  unit_cost     numeric(19,6) NOT NULL,
  source_move_id uuid
);
CREATE INDEX ON cost_layer (company_id, item_id, warehouse_id, acquired_date)
  WHERE remaining_qty > 0;

CREATE TABLE stock_count (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  doc_no       text,
  count_date   date NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouse(id),
  count_type   text NOT NULL DEFAULT 'full',   -- full|cycle|spot
  status       doc_status NOT NULL DEFAULT 'draft',
  counted_by   uuid REFERENCES app_user(id),
  approved_by  uuid REFERENCES app_user(id),
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE stock_count_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_count_id uuid NOT NULL REFERENCES stock_count(id) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES item(id),
  lot_id         uuid REFERENCES item_lot(id),
  system_qty     numeric(19,6) NOT NULL,
  counted_qty    numeric(19,6),
  variance_qty   numeric(19,6),
  unit_cost      numeric(19,6),
  variance_value numeric(19,4),
  reason         text
);

CREATE TABLE landed_cost (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  doc_no         text,
  doc_date       date NOT NULL,
  goods_receipt_id uuid REFERENCES goods_receipt(id),
  import_entry_no text,           -- เลขที่ใบขนสินค้า
  allocation_basis text NOT NULL DEFAULT 'value',   -- value|weight|quantity
  status         doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

CREATE TABLE landed_cost_line (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  landed_cost_id uuid NOT NULL REFERENCES landed_cost(id) ON DELETE CASCADE,
  cost_type      text NOT NULL,    -- freight|duty|insurance|handling|other
  partner_id     uuid REFERENCES partner(id),
  amount         numeric(19,4) NOT NULL,
  vat_amount     numeric(19,4) NOT NULL DEFAULT 0,
  account_id     uuid REFERENCES account(id)
);

-- การผลิต
CREATE TABLE bom (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  item_id      uuid NOT NULL REFERENCES item(id),
  version      text NOT NULL DEFAULT '1',
  output_qty   numeric(19,6) NOT NULL DEFAULT 1,
  is_active    boolean NOT NULL DEFAULT true,
  UNIQUE (company_id, item_id, version)
);

CREATE TABLE bom_line (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id        uuid NOT NULL REFERENCES bom(id) ON DELETE CASCADE,
  line_no       smallint NOT NULL,
  component_id  uuid NOT NULL REFERENCES item(id),
  quantity      numeric(19,6) NOT NULL,
  uom_id        uuid REFERENCES uom(id),
  scrap_percent numeric(9,4) NOT NULL DEFAULT 0
);

CREATE TABLE production_order (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES company(id),
  doc_no         text,
  doc_date       date NOT NULL,
  item_id        uuid NOT NULL REFERENCES item(id),
  bom_id         uuid REFERENCES bom(id),
  planned_qty    numeric(19,6) NOT NULL,
  produced_qty   numeric(19,6) NOT NULL DEFAULT 0,
  scrap_qty      numeric(19,6) NOT NULL DEFAULT 0,
  warehouse_id   uuid REFERENCES warehouse(id),
  material_cost  numeric(19,4) NOT NULL DEFAULT 0,
  labor_cost     numeric(19,4) NOT NULL DEFAULT 0,
  overhead_cost  numeric(19,4) NOT NULL DEFAULT 0,
  status         doc_status NOT NULL DEFAULT 'draft',
  journal_entry_id uuid REFERENCES journal_entry(id),
  UNIQUE (company_id, doc_no)
);

-- ค่าเผื่อการลดมูลค่าสินค้า (NRV)
CREATE TABLE inventory_writedown (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES company(id),
  period_code  text NOT NULL,
  item_id      uuid NOT NULL REFERENCES item(id),
  cost_value   numeric(19,4) NOT NULL,
  nrv_value    numeric(19,4) NOT NULL,
  writedown    numeric(19,4) NOT NULL,
  reason       text,
  journal_entry_id uuid REFERENCES journal_entry(id)
);
