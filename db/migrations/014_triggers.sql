-- =====================================================================
-- 014 — TRIGGERS: กฎทางบัญชีที่บังคับระดับฐานข้อมูล
-- ชั้นแอปพลิเคชันตรวจซ้ำอีกที แต่ชั้นนี้คือชั้นที่ "โกงไม่ได้"
-- =====================================================================
SET search_path TO duly, public;

-- ---------------------------------------------------------------------
-- 1) เดบิตต้องเท่ากับเครดิตเสมอเมื่อลงบัญชี
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_entry_balanced() RETURNS trigger AS $$
DECLARE d numeric(19,4); c numeric(19,4);
BEGIN
  IF NEW.status = 'posted' THEN
    SELECT COALESCE(SUM(debit_base),0), COALESCE(SUM(credit_base),0)
      INTO d, c FROM journal_line WHERE entry_id = NEW.id;
    IF d <> c THEN
      RAISE EXCEPTION 'รายการไม่สมดุล: เดบิต % ไม่เท่ากับเครดิต % (entry %)', d, c, NEW.id
        USING ERRCODE = 'check_violation', HINT = 'ตรวจสอบบรรทัดรายการและอัตราแลกเปลี่ยน';
    END IF;
    IF d = 0 THEN
      RAISE EXCEPTION 'ลงบัญชีรายการที่มียอดรวมเป็นศูนย์ไม่ได้ (entry %)', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE CONSTRAINT TRIGGER trg_entry_balanced
  AFTER INSERT OR UPDATE ON journal_entry
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced();

-- ---------------------------------------------------------------------
-- 2) ห้ามแก้/ลบรายการที่ลงบัญชีแล้ว — แก้ได้ทางเดียวคือกลับรายการ
--    (พ.ร.บ.การบัญชี 2543 + ข้อกำหนดการตรวจสอบ)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_posted_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('posted','reversed') THEN
      RAISE EXCEPTION 'ห้ามลบรายการที่ลงบัญชีแล้ว (entry %) — ให้ใช้การกลับรายการแทน', OLD.entry_no;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'posted' THEN
    -- อนุญาตเฉพาะการเปลี่ยนสถานะเป็น reversed และการผูก reversed_by_id
    IF NEW.status NOT IN ('posted','reversed') THEN
      RAISE EXCEPTION 'เปลี่ยนสถานะจาก posted เป็น % ไม่ได้', NEW.status;
    END IF;
    IF (NEW.posting_date, NEW.doc_date, NEW.description, NEW.branch_id,
        NEW.company_id, NEW.journal_type, NEW.entry_no, NEW.period_id)
       IS DISTINCT FROM
       (OLD.posting_date, OLD.doc_date, OLD.description, OLD.branch_id,
        OLD.company_id, OLD.journal_type, OLD.entry_no, OLD.period_id) THEN
      RAISE EXCEPTION 'ห้ามแก้ไขรายการที่ลงบัญชีแล้ว (entry %)', OLD.entry_no;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_block_posted_mutation
  BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION block_posted_mutation();

-- บรรทัดของรายการที่ post แล้วก็ห้ามแตะเช่นกัน
-- ★ ต้องครอบ INSERT ด้วย ไม่ใช่แค่ UPDATE/DELETE
--   เพราะ trg_entry_balanced เป็น DEFERRED trigger บน journal_entry เท่านั้น
--   ถ้าเปิดให้เพิ่มบรรทัดเข้ารายการที่ post แล้วในธุรกรรมถัดไป
--   จะไม่มีอะไรตรวจสมดุลอีกเลย → เดบิตไม่เท่าเครดิตโดยไม่มีใครรู้
CREATE OR REPLACE FUNCTION block_posted_line_mutation() RETURNS trigger AS $$
DECLARE st je_status;
BEGIN
  SELECT status INTO st FROM journal_entry
   WHERE id = COALESCE(NEW.entry_id, OLD.entry_id);
  IF st IN ('posted','reversed') THEN
    RAISE EXCEPTION 'ห้ามเพิ่ม แก้ไข หรือลบบรรทัดของรายการที่ลงบัญชีแล้ว'
      USING HINT = 'ให้กลับรายการแล้วลงใหม่';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_block_posted_line
  BEFORE INSERT OR UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION block_posted_line_mutation();

-- ---------------------------------------------------------------------
-- 3) ห้ามลงรายการในงวดที่ปิดแล้ว หรือก่อนวันล็อกแข็ง
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger AS $$
DECLARE st period_status; lock_date date; p_start date; p_end date;
BEGIN
  SELECT status, start_date, end_date INTO st, p_start, p_end
    FROM accounting_period WHERE id = NEW.period_id;

  IF NEW.posting_date < p_start OR NEW.posting_date > p_end THEN
    RAISE EXCEPTION 'วันที่ลงบัญชี % ไม่อยู่ในงวดที่ระบุ (% ถึง %)', NEW.posting_date, p_start, p_end;
  END IF;

  IF NEW.status = 'posted' THEN
    IF st <> 'open' THEN
      RAISE EXCEPTION 'งวดบัญชีถูกปิดแล้ว (สถานะ %) ลงรายการไม่ได้', st
        USING HINT = 'ขอปลดล็อกงวด หรือเปลี่ยนวันที่เป็นงวดถัดไป';
    END IF;
    SELECT hard_lock_date INTO lock_date FROM company WHERE id = NEW.company_id;
    IF lock_date IS NOT NULL AND NEW.posting_date <= lock_date THEN
      RAISE EXCEPTION 'วันที่ลงบัญชี % อยู่ก่อนวันล็อกข้อมูล %', NEW.posting_date, lock_date;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_period_open
  BEFORE INSERT OR UPDATE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION assert_period_open();

-- ---------------------------------------------------------------------
-- 4) ห้ามลงรายการในบัญชีหัวข้อหรือบัญชีที่ปิดใช้งาน
--    และบังคับระบุคู่ค้า/มิติ ตามที่ผังบัญชีกำหนด
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assert_account_usable() RETURNS trigger AS $$
DECLARE a record; d text;
BEGIN
  SELECT is_postable, is_active, code, requires_partner, requires_dimension
    INTO a FROM account WHERE id = NEW.account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ไม่พบบัญชี %', NEW.account_id;
  END IF;
  IF NOT a.is_postable THEN
    RAISE EXCEPTION 'บัญชี % เป็นบัญชีหัวข้อ ลงรายการไม่ได้', a.code;
  END IF;
  IF NOT a.is_active THEN
    RAISE EXCEPTION 'บัญชี % ถูกปิดใช้งาน', a.code;
  END IF;
  IF a.requires_partner AND NEW.partner_id IS NULL THEN
    RAISE EXCEPTION 'บัญชี % ต้องระบุคู่ค้า (ลูกหนี้/เจ้าหนี้)', a.code;
  END IF;
  FOREACH d IN ARRAY a.requires_dimension LOOP
    IF NOT (NEW.dimension_json ? d) THEN
      RAISE EXCEPTION 'บัญชี % ต้องระบุมิติ %', a.code, d;
    END IF;
  END LOOP;
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_account_usable
  BEFORE INSERT OR UPDATE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION assert_account_usable();

-- ---------------------------------------------------------------------
-- 5) คำนวณยอดฐาน (base currency) อัตโนมัติ กันคีย์ผิด
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION compute_base_amounts() RETURNS trigger AS $$
BEGIN
  NEW.debit_base  := ROUND(NEW.debit  * NEW.fx_rate, 4);
  NEW.credit_base := ROUND(NEW.credit * NEW.fx_rate, 4);
  RETURN NEW;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_compute_base
  BEFORE INSERT OR UPDATE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION compute_base_amounts();

-- ---------------------------------------------------------------------
-- 6) ห้ามแก้รายการภาษีที่ยื่นแบบไปแล้ว
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_filed_tax_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD.filing_id IS NOT NULL THEN
    RAISE EXCEPTION 'รายการภาษีนี้ถูกนำไปยื่นแบบแล้ว แก้ไขไม่ได้'
      USING HINT = 'ต้องยื่นแบบเพิ่มเติม (amended) แทน';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_block_filed_tax
  BEFORE UPDATE OR DELETE ON tax_transaction
  FOR EACH ROW EXECUTE FUNCTION block_filed_tax_mutation();

-- ---------------------------------------------------------------------
-- 7) audit_event เป็น append-only
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_event เป็น append-only แก้ไขหรือลบไม่ได้';
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_block_audit_mutation
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION block_audit_mutation();

-- ---------------------------------------------------------------------
-- 8) ห้ามลบไฟล์แนบที่ยังไม่พ้นกำหนดเก็บรักษา หรือติด legal hold
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION block_attachment_delete() RETURNS trigger AS $$
BEGIN
  IF OLD.legal_hold THEN
    RAISE EXCEPTION 'เอกสารนี้อยู่ระหว่าง legal hold ลบไม่ได้';
  END IF;
  IF OLD.retention_until IS NOT NULL AND OLD.retention_until > CURRENT_DATE THEN
    RAISE EXCEPTION 'เอกสารต้องเก็บรักษาถึง % ตามกฎหมาย ลบไม่ได้', OLD.retention_until;
  END IF;
  RETURN OLD;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

CREATE TRIGGER trg_block_attachment_delete
  BEFORE DELETE ON attachment
  FOR EACH ROW EXECUTE FUNCTION block_attachment_delete();

-- ---------------------------------------------------------------------
-- 9) จองเลขที่เอกสารแบบปลอดภัยภายใต้ concurrency
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION next_document_no(
  p_company_id uuid, p_branch_id uuid, p_doc_type text, p_period_key text
) RETURNS text AS $$
DECLARE s record; result text;
BEGIN
  SELECT * INTO s FROM document_sequence
   WHERE company_id = p_company_id
     AND doc_type = p_doc_type
     AND period_key = p_period_key
     AND (branch_id = p_branch_id OR (branch_id IS NULL AND p_branch_id IS NULL))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ยังไม่ได้ตั้งค่ารูปแบบเลขที่เอกสารสำหรับ % งวด %', p_doc_type, p_period_key;
  END IF;

  result := s.prefix || lpad(s.next_no::text, s.padding, '0') || s.suffix;
  UPDATE document_sequence SET next_no = next_no + 1 WHERE id = s.id;
  RETURN result;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

-- ---------------------------------------------------------------------
-- 10) ปรับปรุงยอดคงเหลือรายเดือนอัตโนมัติเมื่อ post
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_gl_balance(p_entry_id uuid) RETURNS void AS $$
BEGIN
  INSERT INTO gl_balance_monthly AS b
    (company_id, branch_id, account_id, period_code, dimension_key,
     debit_base, credit_base, closing_base)
  SELECT l.company_id, l.branch_id, l.account_id,
         to_char(l.posting_date,'YYYY-MM'), '',
         SUM(l.debit_base), SUM(l.credit_base),
         SUM(l.debit_base) - SUM(l.credit_base)
    FROM journal_line l
   WHERE l.entry_id = p_entry_id
   GROUP BY l.company_id, l.branch_id, l.account_id, to_char(l.posting_date,'YYYY-MM')
  ON CONFLICT (company_id, branch_id, account_id, period_code, dimension_key)
  DO UPDATE SET
    debit_base   = b.debit_base   + EXCLUDED.debit_base,
    credit_base  = b.credit_base  + EXCLUDED.credit_base,
    closing_base = b.closing_base + EXCLUDED.closing_base,
    updated_at   = now();
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;
