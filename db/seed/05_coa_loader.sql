-- =====================================================================
-- SEED 05 — ผังบัญชีมาตรฐาน + ตัวโหลดเข้าบริษัท
-- แม่แบบ: S = บริการ, T = ซื้อมาขายไป, M = ผลิต  (คอลัมน์ templates)
-- รันจาก root ของ repo:  psql -d duly -f db/seed/05_coa_loader.sql
-- =====================================================================
SET search_path TO duly, public;

CREATE TABLE IF NOT EXISTS coa_template (
  code             text PRIMARY KEY,
  name_th          text NOT NULL,
  name_en          text,
  account_type     account_type NOT NULL,
  sub_type         text NOT NULL,
  is_postable      boolean NOT NULL,
  is_contra        boolean NOT NULL,
  requires_partner boolean NOT NULL,
  cash_flow_class  text,
  templates        text NOT NULL
);

TRUNCATE coa_template;
\copy duly.coa_template FROM 'db/seed/coa/chart_of_accounts.csv' WITH (FORMAT csv, HEADER true, NULL '')

-- ---------------------------------------------------------------------
-- โหลดผังบัญชีเข้าบริษัท
--   p_template: 'S' บริการ | 'T' ซื้อมาขายไป | 'M' ผลิต
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION seed_chart_of_accounts(p_company_id uuid, p_template char DEFAULT 'T')
RETURNS integer AS $$
DECLARE n integer;
BEGIN
  INSERT INTO account (company_id, code, name_th, name_en, account_type, sub_type,
                       is_postable, is_contra, requires_partner, cash_flow_class,
                       level, is_system)
  SELECT p_company_id, t.code, t.name_th, t.name_en, t.account_type, t.sub_type,
         t.is_postable, t.is_contra, t.requires_partner, NULLIF(t.cash_flow_class,''),
         CASE WHEN t.code LIKE '%000' THEN 1
              WHEN t.code LIKE '%00'  THEN 2
              WHEN t.code LIKE '%0'   THEN 3
              ELSE 4 END,
         t.sub_type IN ('suspense','rounding','opening_balance','intercompany',
                        'output_vat','input_vat','retained_earnings','current_year_earnings')
    FROM coa_template t
   WHERE position(p_template IN t.templates) > 0
  ON CONFLICT (company_id, code) DO NOTHING;

  GET DIAGNOSTICS n = ROW_COUNT;

  -- ผูกบัญชีแม่จากรูปแบบรหัส (1111 → 1110 → 1100 → 1000)
  UPDATE account a
     SET parent_id = p.id
    FROM account p
   WHERE a.company_id = p_company_id
     AND p.company_id = p_company_id
     AND a.parent_id IS NULL
     AND p.code = (
       SELECT c.code FROM account c
        WHERE c.company_id = p_company_id
          AND c.code <> a.code
          AND c.code IN (
            left(a.code, 3) || '0',
            left(a.code, 2) || '00',
            left(a.code, 1) || '000'
          )
        ORDER BY length(replace(c.code,'0','')) DESC, c.code DESC
        LIMIT 1
     );

  -- สร้าง ltree path สำหรับ roll-up ยอดขึ้นระดับบน
  UPDATE account a SET path = text2ltree(
    CASE WHEN a.parent_id IS NULL THEN 'a' || a.code
         ELSE (SELECT ltree2text(p2.path) FROM account p2 WHERE p2.id = a.parent_id)
              || '.a' || a.code END)
   WHERE a.company_id = p_company_id AND a.path IS NULL AND a.parent_id IS NULL;

  FOR i IN 2..4 LOOP
    UPDATE account a SET path = text2ltree(
        (SELECT ltree2text(p2.path) FROM account p2 WHERE p2.id = a.parent_id) || '.a' || a.code)
     WHERE a.company_id = p_company_id AND a.path IS NULL AND a.level = i
       AND EXISTS (SELECT 1 FROM account p3 WHERE p3.id = a.parent_id AND p3.path IS NOT NULL);
  END LOOP;

  RETURN n;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

-- ---------------------------------------------------------------------
-- ผูกบัญชีเริ่มต้นให้บริษัท (ใช้ sub_type ไม่ใช่รหัสบัญชี)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION account_by_subtype(p_company_id uuid, p_sub_type text)
RETURNS uuid AS $$
  SELECT id FROM account
   WHERE company_id = p_company_id AND sub_type = p_sub_type AND is_postable AND is_active
   ORDER BY code LIMIT 1;
$$ LANGUAGE sql STABLE SET search_path = duly, public, pg_temp;
