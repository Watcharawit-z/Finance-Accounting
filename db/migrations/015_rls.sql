-- =====================================================================
-- 015 — ROW LEVEL SECURITY
-- แอปตั้งค่าต่อ connection:  SET app.company_ids = 'uuid1,uuid2';
-- =====================================================================
SET search_path TO duly, public;

CREATE OR REPLACE FUNCTION current_company_ids() RETURNS uuid[] AS $$
  SELECT CASE
    WHEN COALESCE(current_setting('app.company_ids', true), '') = '' THEN ARRAY[]::uuid[]
    ELSE string_to_array(current_setting('app.company_ids', true), ',')::uuid[]
  END;
$$ LANGUAGE sql STABLE SET search_path = duly, public, pg_temp;

-- เปิด RLS + สร้าง policy ให้ทุกตารางที่มีคอลัมน์ company_id
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
     WHERE n.nspname = 'duly'
       AND c.relkind IN ('r','p')
       AND a.attname = 'company_id'
       AND NOT a.attisdropped
  LOOP
    EXECUTE format('ALTER TABLE duly.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE duly.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY company_isolation ON duly.%I
      USING (company_id = ANY (duly.current_company_ids()))
      WITH CHECK (company_id = ANY (duly.current_company_ids()))
    $f$, t);
  END LOOP;
END $$;

-- company เองแยกด้วย tenant
ALTER TABLE company ENABLE ROW LEVEL SECURITY;
ALTER TABLE company FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON company
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- บทบาทแอปพลิเคชัน (ไม่ใช่ superuser จึงถูก RLS บังคับจริง)
-- CREATE ROLE duly_app LOGIN;
-- GRANT USAGE ON SCHEMA duly TO duly_app;
-- GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA duly TO duly_app;
-- REVOKE DELETE ON journal_entry, journal_line, tax_transaction, audit_event FROM duly_app;
