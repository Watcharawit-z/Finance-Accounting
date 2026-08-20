-- =====================================================================
-- สร้าง role ของแอปพลิเคชัน (ต้องรันด้วยสิทธิ์ superuser ครั้งเดียวต่อ cluster)
-- ★ แอปต้องไม่เชื่อมด้วย superuser เพราะ superuser ข้าม Row Level Security
--   ถ้าเชื่อมด้วย postgres ข้อมูลข้ามบริษัทจะรั่วโดยที่ policy ดูเหมือนทำงาน
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'duly_app') THEN
    CREATE ROLE duly_app LOGIN PASSWORD 'duly_dev_only';
  END IF;
END $$;

GRANT USAGE ON SCHEMA duly, public TO duly_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA duly TO duly_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA duly TO duly_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA duly TO duly_app;

-- ห้ามลบข้อมูลที่กฎหมายกำหนดให้เก็บ — ปิดตั้งแต่ระดับสิทธิ์ ไม่ใช่แค่โค้ดแอป
REVOKE DELETE ON duly.journal_entry, duly.journal_line, duly.tax_transaction,
                 duly.audit_event, duly.attachment, duly.wht_certificate
  FROM duly_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA duly
  GRANT SELECT, INSERT, UPDATE ON TABLES TO duly_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA duly
  GRANT USAGE, SELECT ON SEQUENCES TO duly_app;
