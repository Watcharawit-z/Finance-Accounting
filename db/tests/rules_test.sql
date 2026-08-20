-- =====================================================================
-- ชุดทดสอบกฎทางบัญชีที่บังคับระดับฐานข้อมูล
-- รัน:  psql -d duly_test -v ON_ERROR_STOP=1 -f db/tests/rules_test.sql
-- ทุกเคสที่ "ต้องล้มเหลว" ถ้าไม่ล้มเหลว = สคีมามีช่องโหว่ → สคริปต์จะ RAISE EXCEPTION
-- =====================================================================
SET search_path TO duly, public;
\set ON_ERROR_STOP on

-- helper: ยืนยันว่าคำสั่งต้องล้มเหลว
CREATE OR REPLACE FUNCTION must_fail(sql text, what text) RETURNS void AS $$
BEGIN
  BEGIN
    EXECUTE sql;
  EXCEPTION WHEN others THEN
    RAISE NOTICE '  PASS  % → % ', what, replace(left(SQLERRM,90), E'\n',' ');
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL: "%" ควรถูกปฏิเสธ แต่ทำสำเร็จ', what;
END $$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION must_pass(sql text, what text) RETURNS void AS $$
BEGIN
  EXECUTE sql;
  RAISE NOTICE '  PASS  %', what;
END $$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- ข้อมูลตั้งต้น
-- ---------------------------------------------------------------------
INSERT INTO currency (code,name_th,name_en,decimals) VALUES ('THB','บาท','Thai Baht',2)
  ON CONFLICT DO NOTHING;

INSERT INTO tenant (id,slug,name) VALUES
  ('11111111-1111-1111-1111-111111111111','test','ผู้ใช้ทดสอบ');

INSERT INTO company (id,tenant_id,code,legal_name_th,tax_id) VALUES
  ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
   'C01','บจก. ทดสอบระบบ','0105548021447');

INSERT INTO branch (id,company_id,code,name_th,is_head_office) VALUES
  ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
   '00000','สำนักงานใหญ่',true);

INSERT INTO app_user (id,tenant_id,email,full_name) VALUES
  ('44444444-4444-4444-4444-444444444444','11111111-1111-1111-1111-111111111111',
   'test@example.com','ผู้ทดสอบ');

INSERT INTO fiscal_year (id,company_id,code,start_date,end_date) VALUES
  ('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222',
   '2569','2026-01-01','2026-12-31');

INSERT INTO accounting_period (id,company_id,fiscal_year_id,period_no,code,start_date,end_date,status) VALUES
  ('66666666-6666-6666-6666-666666666661','22222222-2222-2222-2222-222222222222',
   '55555555-5555-5555-5555-555555555555',1,'2569-01','2026-01-01','2026-01-31','open'),
  ('66666666-6666-6666-6666-666666666662','22222222-2222-2222-2222-222222222222',
   '55555555-5555-5555-5555-555555555555',2,'2569-02','2026-02-01','2026-02-28','closed');

INSERT INTO account (id,company_id,code,name_th,account_type,sub_type,is_postable,requires_partner) VALUES
  ('77777777-0000-0000-0000-000000001100','22222222-2222-2222-2222-222222222222','1100','สินทรัพย์หมุนเวียน','asset','header',false,false),
  ('77777777-0000-0000-0000-000000001113','22222222-2222-2222-2222-222222222222','1113','เงินฝากธนาคาร','asset','bank',true,false),
  ('77777777-0000-0000-0000-000000001131','22222222-2222-2222-2222-222222222222','1131','ลูกหนี้การค้า','asset','trade_receivable',true,true),
  ('77777777-0000-0000-0000-000000004111','22222222-2222-2222-2222-222222222222','4111','รายได้จากการขาย','revenue','sales_revenue',true,false),
  ('77777777-0000-0000-0000-000000002141','22222222-2222-2222-2222-222222222222','2141','ภาษีขาย','liability','output_vat',true,false);

INSERT INTO partner (id,company_id,kind,code,legal_name_th,entity_type,tax_id) VALUES
  ('88888888-8888-8888-8888-888888888888','22222222-2222-2222-2222-222222222222',
   'customer','CUS001','บจก. ลูกค้าทดสอบ','juristic','0105559001772');

INSERT INTO document_sequence (company_id,branch_id,doc_type,period_key,prefix,padding) VALUES
  ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
   'sales_invoice','2569-01','INV2601-',5);

\echo ''
\echo '=== 1. รายการต้องสมดุล (เดบิต = เครดิต) ==='

-- 1.1 รายการสมดุล → ต้องผ่าน
BEGIN;
INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,journal_type,posting_date,doc_date,description,created_by)
VALUES ('99999999-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666661',
        'JV2601-00001','sales','2026-01-15','2026-01-15','ขายสินค้า','44444444-4444-4444-4444-444444444444');
INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit,partner_id) VALUES
  ('99999999-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-15',1,'77777777-0000-0000-0000-000000001131',107000,0,'88888888-8888-8888-8888-888888888888'),
  ('99999999-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-15',2,'77777777-0000-0000-0000-000000004111',0,100000,NULL),
  ('99999999-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-15',3,'77777777-0000-0000-0000-000000002141',0,7000,NULL);
UPDATE journal_entry SET status='posted', posted_at=now(), posted_by='44444444-4444-4444-4444-444444444444'
 WHERE id='99999999-0000-0000-0000-000000000001';
COMMIT;
\echo '  PASS  รายการสมดุล 107,000 = 100,000 + 7,000 ลงบัญชีได้'

-- 1.2 รายการไม่สมดุล → ต้องถูกปฏิเสธ
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
  VALUES ('99999999-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666661',
          'JV2601-00002','2026-01-16','2026-01-16','ไม่สมดุล','44444444-4444-4444-4444-444444444444');
  INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit)
  VALUES ('99999999-0000-0000-0000-000000000002','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-16',1,'77777777-0000-0000-0000-000000001113',500,0);
  UPDATE journal_entry SET status='posted' WHERE id='99999999-0000-0000-0000-000000000002';
  SET CONSTRAINTS ALL IMMEDIATE;   -- บังคับ deferred trigger ให้ตรวจทันที (ปกติตรวจตอน COMMIT)
$q$, 'รายการไม่สมดุล (เดบิต 500 เครดิต 0)'); END $$;

-- 1.3 เพิ่มบรรทัดเข้ารายการที่ post แล้ว → ต้องถูกปฏิเสธ
--     (ถ้าทำได้ จะทำให้เดบิตไม่เท่าเครดิตโดยไม่มี trigger ตัวไหนตรวจอีกเลย)
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit)
  VALUES ('99999999-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
          '33333333-3333-3333-3333-333333333333','2026-01-15',8,'77777777-0000-0000-0000-000000001113',999999,0);
$q$, 'แอบเพิ่มบรรทัดเข้ารายการที่ post แล้ว'); END $$;

\echo ''
\echo '=== 2. ห้ามแก้/ลบรายการที่ลงบัญชีแล้ว ==='
DO $$ BEGIN
  PERFORM must_fail($q$UPDATE journal_entry SET description='แก้ทีหลัง' WHERE id='99999999-0000-0000-0000-000000000001'$q$,
                    'แก้คำอธิบายรายการที่ post แล้ว');
  PERFORM must_fail($q$UPDATE journal_entry SET posting_date='2026-01-20' WHERE id='99999999-0000-0000-0000-000000000001'$q$,
                    'แก้วันที่รายการที่ post แล้ว');
  PERFORM must_fail($q$DELETE FROM journal_entry WHERE id='99999999-0000-0000-0000-000000000001'$q$,
                    'ลบรายการที่ post แล้ว');
  PERFORM must_fail($q$UPDATE journal_line SET debit=999999 WHERE entry_id='99999999-0000-0000-0000-000000000001' AND line_no=1$q$,
                    'แก้ยอดบรรทัดของรายการที่ post แล้ว');
  PERFORM must_fail($q$DELETE FROM journal_line WHERE entry_id='99999999-0000-0000-0000-000000000001'$q$,
                    'ลบบรรทัดของรายการที่ post แล้ว');
END $$;

\echo ''
\echo '=== 3. งวดบัญชีที่ปิดแล้ว ==='
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO journal_entry (company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by,status)
  VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
          '66666666-6666-6666-6666-666666666662','JV2602-00001','2026-02-10','2026-02-10','ลงในงวดที่ปิดแล้ว',
          '44444444-4444-4444-4444-444444444444','posted');
$q$, 'ลงรายการในงวด ก.พ. 2569 ที่ปิดแล้ว'); END $$;

DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO journal_entry (company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
  VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
          '66666666-6666-6666-6666-666666666661','JV-X','2026-03-10','2026-03-10','วันที่ไม่ตรงงวด',
          '44444444-4444-4444-4444-444444444444');
$q$, 'วันที่ลงบัญชีอยู่นอกช่วงของงวดที่ระบุ'); END $$;

-- วันล็อกแข็ง
UPDATE company SET hard_lock_date='2026-01-31' WHERE id='22222222-2222-2222-2222-222222222222';
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO journal_entry (company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by,status)
  VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
          '66666666-6666-6666-6666-666666666661','JV-Y','2026-01-20','2026-01-20','ก่อนวันล็อก',
          '44444444-4444-4444-4444-444444444444','posted');
$q$, 'ลงรายการก่อนวันล็อกข้อมูล 31 ม.ค. 2569'); END $$;
UPDATE company SET hard_lock_date=NULL WHERE id='22222222-2222-2222-2222-222222222222';

\echo ''
\echo '=== 4. การใช้บัญชี ==='
DO $$ BEGIN
  PERFORM must_fail($q$
    INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
    VALUES ('99999999-0000-0000-0000-000000000010','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
            '66666666-6666-6666-6666-666666666661','JV-H','2026-01-17','2026-01-17','ทดสอบ','44444444-4444-4444-4444-444444444444');
    INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit)
    VALUES ('99999999-0000-0000-0000-000000000010','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-17',1,'77777777-0000-0000-0000-000000001100',100,0);
  $q$, 'ลงรายการในบัญชีหัวข้อ 1100');

  PERFORM must_fail($q$
    INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
    VALUES ('99999999-0000-0000-0000-000000000011','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
            '66666666-6666-6666-6666-666666666661','JV-P','2026-01-17','2026-01-17','ทดสอบ','44444444-4444-4444-4444-444444444444');
    INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit)
    VALUES ('99999999-0000-0000-0000-000000000011','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-17',1,'77777777-0000-0000-0000-000000001131',100,0);
  $q$, 'ลงบัญชีลูกหนี้โดยไม่ระบุคู่ค้า');

  PERFORM must_fail($q$
    INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
    VALUES ('99999999-0000-0000-0000-000000000012','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
            '66666666-6666-6666-6666-666666666661','JV-DC','2026-01-17','2026-01-17','ทดสอบ','44444444-4444-4444-4444-444444444444');
    INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit)
    VALUES ('99999999-0000-0000-0000-000000000012','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-17',1,'77777777-0000-0000-0000-000000001113',100,100);
  $q$, 'บรรทัดที่มีทั้งเดบิตและเครดิตในบรรทัดเดียว');

  PERFORM must_fail($q$
    INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
    VALUES ('99999999-0000-0000-0000-000000000013','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
            '66666666-6666-6666-6666-666666666661','JV-NEG','2026-01-17','2026-01-17','ทดสอบ','44444444-4444-4444-4444-444444444444');
    INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit)
    VALUES ('99999999-0000-0000-0000-000000000013','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-17',1,'77777777-0000-0000-0000-000000001113',-500,0);
  $q$, 'บรรทัดที่มียอดติดลบ (ต้องใช้อีกด้านแทน)');
END $$;

\echo ''
\echo '=== 5. เลขที่เอกสารต้องเรียงและไม่ซ้ำ ==='
DO $$
DECLARE i int; n text; prev text := '';
BEGIN
  FOR i IN 1..5 LOOP
    n := next_document_no('22222222-2222-2222-2222-222222222222',
                          '33333333-3333-3333-3333-333333333333','sales_invoice','2569-01');
    IF n <= prev THEN RAISE EXCEPTION 'FAIL: เลขที่ไม่เรียงลำดับ % หลังจาก %', n, prev; END IF;
    prev := n;
  END LOOP;
  IF prev <> 'INV2601-00005' THEN RAISE EXCEPTION 'FAIL: คาดหวัง INV2601-00005 ได้ %', prev; END IF;
  RAISE NOTICE '  PASS  ออกเลข 5 ใบต่อเนื่อง จบที่ %', prev;
END $$;

\echo ''
\echo '=== 6. ข้อมูลระบบต้องไม่ซ้ำ (NULLS NOT DISTINCT) ==='
INSERT INTO tax_code (company_id,code,name_th,kind,vat_treatment)
VALUES (NULL,'VAT7','ภาษีมูลค่าเพิ่ม 7%','vat_output','standard');
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO tax_code (company_id,code,name_th,kind,vat_treatment)
  VALUES (NULL,'VAT7','ซ้ำ','vat_output','standard');
$q$, 'รหัสภาษีระดับระบบซ้ำ (company_id IS NULL)'); END $$;

DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO document_sequence (company_id,branch_id,doc_type,period_key,prefix)
  VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','sales_invoice','2569-01','X');
$q$, 'ชุดเลขที่เอกสารซ้ำ'); END $$;

\echo ''
\echo '=== 7. ภาษี: ห้ามแก้รายการที่ยื่นแบบแล้ว + กันใบกำกับซื้อซ้ำ ==='
INSERT INTO tax_filing (id,company_id,branch_id,form_code,tax_period,period_start,period_end,due_date,status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333','PP30','2569-01','2026-01-01','2026-01-31','2026-02-15','filed');

INSERT INTO tax_transaction (id,company_id,branch_id,kind,tax_period,doc_date,doc_no,doc_type,
                             partner_name,partner_tax_id,base_amount,tax_amount,filing_id)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333','vat_output','2569-01','2026-01-15','INV2601-00001',
        'tax_invoice','บจก. ลูกค้าทดสอบ','0105559001772',100000,7000,'aaaaaaaa-0000-0000-0000-000000000001');

DO $$ BEGIN
  PERFORM must_fail($q$UPDATE tax_transaction SET tax_amount=1 WHERE id='bbbbbbbb-0000-0000-0000-000000000001'$q$,
                    'แก้รายการภาษีที่ยื่น ภ.พ.30 ไปแล้ว');
  PERFORM must_fail($q$DELETE FROM tax_transaction WHERE id='bbbbbbbb-0000-0000-0000-000000000001'$q$,
                    'ลบรายการภาษีที่ยื่นแบบแล้ว');
END $$;

INSERT INTO tax_transaction (company_id,branch_id,kind,tax_period,doc_date,doc_no,doc_type,
                             partner_name,partner_tax_id,base_amount,tax_amount)
VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
        'vat_input','2569-01','2026-01-10','SUP-9001','tax_invoice','บจก. ผู้ขาย','0105546012388',50000,3500);
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO tax_transaction (company_id,branch_id,kind,tax_period,doc_date,doc_no,doc_type,
                               partner_name,partner_tax_id,base_amount,tax_amount)
  VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333',
          'vat_input','2569-01','2026-01-10','SUP-9001','tax_invoice','บจก. ผู้ขาย','0105546012388',50000,3500);
$q$, 'บันทึกใบกำกับภาษีซื้อใบเดิมซ้ำ'); END $$;

\echo ''
\echo '=== 8. เอกสารแนบและ audit log ==='
INSERT INTO attachment (id,company_id,entity_type,entity_id,file_name,mime_type,size_bytes,storage_key,sha256,retention_until)
VALUES ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','sales_invoice',
        '99999999-0000-0000-0000-000000000001','invoice.pdf','application/pdf',1024,'s3://x',
        repeat('a',64),'2031-12-31');
DO $$ BEGIN
  PERFORM must_fail($q$DELETE FROM attachment WHERE id='cccccccc-0000-0000-0000-000000000001'$q$,
                    'ลบเอกสารแนบที่ยังไม่พ้นกำหนดเก็บ 5 ปี');
END $$;

INSERT INTO audit_event (tenant_id,company_id,entity_type,entity_id,action)
VALUES ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','journal_entry','x','post');
DO $$ BEGIN
  PERFORM must_fail($q$UPDATE audit_event SET action='hacked' WHERE entity_id='x'$q$, 'แก้ audit log');
  PERFORM must_fail($q$DELETE FROM audit_event WHERE entity_id='x'$q$, 'ลบ audit log');
END $$;

\echo ''
\echo '=== 9. การกลับรายการ (ทางเดียวที่แก้ตัวเลขได้) ==='
BEGIN;
INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,journal_type,posting_date,doc_date,
                           description,created_by,reversal_of_id)
VALUES ('99999999-0000-0000-0000-0000000000f1','22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666661',
        'JV2601-R0001','adjustment','2026-01-31','2026-01-31','กลับรายการ JV2601-00001',
        '44444444-4444-4444-4444-444444444444','99999999-0000-0000-0000-000000000001');
INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit,partner_id) VALUES
  ('99999999-0000-0000-0000-0000000000f1','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-31',1,'77777777-0000-0000-0000-000000001131',0,107000,'88888888-8888-8888-8888-888888888888'),
  ('99999999-0000-0000-0000-0000000000f1','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-31',2,'77777777-0000-0000-0000-000000004111',100000,0,NULL),
  ('99999999-0000-0000-0000-0000000000f1','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-31',3,'77777777-0000-0000-0000-000000002141',7000,0,NULL);
UPDATE journal_entry SET status='posted' WHERE id='99999999-0000-0000-0000-0000000000f1';
UPDATE journal_entry SET status='reversed', reversed_by_id='99999999-0000-0000-0000-0000000000f1'
 WHERE id='99999999-0000-0000-0000-000000000001';
COMMIT;
\echo '  PASS  กลับรายการได้ และเปลี่ยนสถานะต้นทางเป็น reversed ได้'

DO $$
DECLARE net numeric;
BEGIN
  SELECT SUM(debit_base) - SUM(credit_base) INTO net
    FROM journal_line
   WHERE entry_id IN ('99999999-0000-0000-0000-000000000001','99999999-0000-0000-0000-0000000000f1');
  IF net <> 0 THEN RAISE EXCEPTION 'FAIL: ยอดสุทธิหลังกลับรายการควรเป็น 0 ได้ %', net; END IF;
  RAISE NOTICE '  PASS  ยอดสุทธิหลังกลับรายการ = 0';
END $$;

\echo ''
\echo '=== 10. ยอดคงเหลือรายเดือน ==='
DO $$
DECLARE v numeric;
BEGIN
  PERFORM refresh_gl_balance('99999999-0000-0000-0000-000000000001');
  SELECT closing_base INTO v FROM gl_balance_monthly
   WHERE account_id='77777777-0000-0000-0000-000000004111' AND period_code='2026-01';
  IF v <> -100000 THEN RAISE EXCEPTION 'FAIL: บัญชีรายได้ควรมียอดเครดิต 100,000 (closing -100000) ได้ %', v; END IF;
  RAISE NOTICE '  PASS  ยอดบัญชีรายได้ในตารางสรุป = 100,000 (ด้านเครดิต)';
END $$;

\echo ''
\echo '=== 11. อัตราแลกเปลี่ยน: ยอดฐานคำนวณอัตโนมัติ ==='
BEGIN;
INSERT INTO journal_entry (id,company_id,branch_id,period_id,entry_no,posting_date,doc_date,description,created_by)
VALUES ('99999999-0000-0000-0000-0000000000f2','22222222-2222-2222-2222-222222222222',
        '33333333-3333-3333-3333-333333333333','66666666-6666-6666-6666-666666666661',
        'JV2601-FX01','2026-01-18','2026-01-18','ขายเป็น USD','44444444-4444-4444-4444-444444444444');
INSERT INTO currency (code,name_th,name_en) VALUES ('USD','ดอลลาร์สหรัฐ','US Dollar') ON CONFLICT DO NOTHING;
INSERT INTO journal_line (entry_id,company_id,branch_id,posting_date,line_no,account_id,debit,credit,currency,fx_rate,partner_id) VALUES
  ('99999999-0000-0000-0000-0000000000f2','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-18',1,'77777777-0000-0000-0000-000000001131',1000,0,'USD',35.5,'88888888-8888-8888-8888-888888888888'),
  ('99999999-0000-0000-0000-0000000000f2','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-18',2,'77777777-0000-0000-0000-000000004111',0,1000,'USD',35.5,NULL);
UPDATE journal_entry SET status='posted' WHERE id='99999999-0000-0000-0000-0000000000f2';
COMMIT;
DO $$
DECLARE v numeric;
BEGIN
  SELECT debit_base INTO v FROM journal_line
   WHERE entry_id='99999999-0000-0000-0000-0000000000f2' AND line_no=1;
  IF v <> 35500 THEN RAISE EXCEPTION 'FAIL: 1,000 USD × 35.5 ควรเป็น 35,500 บาท ได้ %', v; END IF;
  RAISE NOTICE '  PASS  แปลงค่า 1,000 USD × 35.5 = 35,500 บาท อัตโนมัติ';
END $$;

\echo ''
\echo '=== 12. งวดบัญชีต้องไม่ทับซ้อนกัน ==='
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO accounting_period (company_id,fiscal_year_id,period_no,code,start_date,end_date)
  VALUES ('22222222-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555',
          99,'2569-01B','2026-01-15','2026-02-15');
$q$, 'สร้างงวดบัญชีที่ช่วงวันที่ทับซ้อนกับงวดเดิม'); END $$;

\echo ''
\echo '=== 13. เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก ==='
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO company (tenant_id,code,legal_name_th,tax_id)
  VALUES ('11111111-1111-1111-1111-111111111111','C99','บริษัทเลขผิด','ABC123');
$q$, 'เลขประจำตัวผู้เสียภาษีไม่ใช่ตัวเลข 13 หลัก'); END $$;

\echo ''
\echo '=== 14. ใบลดหนี้ต้องอ้างอิงใบกำกับภาษีเดิมเสมอ (ม.86/10) ==='
DO $$ BEGIN PERFORM must_fail($q$
  INSERT INTO credit_note (company_id,branch_id,doc_date,partner_id,partner_snapshot,
                           original_invoice_id,original_doc_no,original_doc_date,reason_code,
                           base_amount,vat_amount,grand_total,created_by)
  VALUES ('22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','2026-01-20',
          '88888888-8888-8888-8888-888888888888','{}'::jsonb,
          NULL,'INV2601-00001','2026-01-15','RETURN',1000,70,1070,
          '44444444-4444-4444-4444-444444444444');
$q$, 'ออกใบลดหนี้โดยไม่อ้างอิงใบกำกับภาษีเดิม'); END $$;

\echo ''
\echo '=== 15. งบการเงินที่สร้างจากนิยามรายงาน ==='
DO $$
DECLARE diff numeric; n integer;
BEGIN
  -- 15.1 งบแสดงฐานะการเงินต้องสมดุล
  diff := balance_sheet_check('22222222-2222-2222-2222-222222222222','2026-12-31');
  IF diff <> 0 THEN
    RAISE EXCEPTION 'FAIL: งบแสดงฐานะการเงินไม่สมดุล ผลต่าง %', diff;
  END IF;
  RAISE NOTICE '  PASS  รวมสินทรัพย์ = รวมหนี้สินและส่วนของผู้ถือหุ้น (ผลต่าง 0)';

  -- 15.2 รายการที่ถูกกลับรายการต้องยังอยู่ในงบ (ไม่ถูกหักซ้ำสองครั้ง)
  SELECT amount INTO diff FROM report_detail_lines(
    '22222222-2222-2222-2222-222222222222','BS','1900-01-01','2026-12-31') WHERE seq_no = 50;
  IF diff <> 35500 THEN
    RAISE EXCEPTION 'FAIL: ลูกหนี้ควรเป็น 35,500 (107,000 - กลับรายการ 107,000 + FX 35,500) ได้ %', diff;
  END IF;
  RAISE NOTICE '  PASS  รายการที่กลับรายการแล้วยังคงอยู่ในบัญชีแยกประเภท ไม่ถูกหักซ้ำ';

  -- 15.3 กำไรของงวดที่ยังไม่ปิดบัญชีต้องเข้าส่วนของผู้ถือหุ้น
  SELECT amount INTO diff FROM report_detail_lines(
    '22222222-2222-2222-2222-222222222222','BS','1900-01-01','2026-12-31') WHERE seq_no = 390;
  IF diff <> 35500 THEN
    RAISE EXCEPTION 'FAIL: กำไรสะสมควรรวมผลการดำเนินงานของงวด = 35,500 ได้ %', diff;
  END IF;
  RAISE NOTICE '  PASS  กำไรของงวดที่ยังไม่ปิดบัญชีถูกนำเข้าส่วนของผู้ถือหุ้นอัตโนมัติ';

  -- 15.4 ไม่มี sub_type ในผังบัญชีที่หลุดจากงบการเงิน
  SELECT count(*) INTO n FROM orphan_sub_types;
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL: มี sub_type % รายการที่ไม่ปรากฏในงบการเงิน: %',
      n, (SELECT string_agg(sub_type,', ') FROM orphan_sub_types);
  END IF;
  RAISE NOTICE '  PASS  ทุก sub_type ในผังบัญชีมีที่อยู่ในงบการเงิน';
END $$;

\echo ''
\echo '=== 16. ข้อมูลตั้งต้น (seed) ==='
DO $$
DECLARE n integer; c text;
BEGIN
  INSERT INTO company (id,tenant_id,code,legal_name_th,tax_id)
  VALUES ('12121212-1212-1212-1212-121212121212','11111111-1111-1111-1111-111111111111',
          'C02','บจก. ทดสอบผังบัญชี','0105548021448') ON CONFLICT DO NOTHING;

  n := seed_chart_of_accounts('12121212-1212-1212-1212-121212121212','T');
  IF n < 150 THEN RAISE EXCEPTION 'FAIL: ผังบัญชีโหลดได้แค่ % บัญชี', n; END IF;
  RAISE NOTICE '  PASS  โหลดผังบัญชีแม่แบบซื้อมาขายไป % บัญชี', n;

  SELECT count(*) INTO n FROM account
   WHERE company_id='12121212-1212-1212-1212-121212121212' AND path IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'FAIL: มี % บัญชีที่ไม่มี ltree path', n; END IF;
  RAISE NOTICE '  PASS  ทุกบัญชีมีลำดับชั้น (ltree path) ครบ';

  SELECT code INTO c FROM account
   WHERE id = account_by_subtype('12121212-1212-1212-1212-121212121212','trade_receivable');
  IF c IS NULL THEN RAISE EXCEPTION 'FAIL: หาบัญชีลูกหนี้จาก sub_type ไม่เจอ'; END IF;
  RAISE NOTICE '  PASS  ค้นบัญชีจาก sub_type ได้ (trade_receivable → %)', c;

  IF next_business_day('2026-04-13') <> DATE '2026-04-16' THEN
    RAISE EXCEPTION 'FAIL: วันทำการถัดไปจากสงกรานต์ควรเป็น 16 เม.ย. ได้ %', next_business_day('2026-04-13');
  END IF;
  RAISE NOTICE '  PASS  คำนวณวันทำการถัดไปข้ามวันหยุดสงกรานต์และวันหยุดสุดสัปดาห์ได้';

  SELECT count(*) INTO n FROM province;
  IF n <> 77 THEN RAISE EXCEPTION 'FAIL: ต้องมี 77 จังหวัด ได้ %', n; END IF;
  RAISE NOTICE '  PASS  ข้อมูลจังหวัดครบ 77 จังหวัด';
END $$;

\echo ''
\echo '=== 17. อัตราภาษีต้อง lookup ตามวันที่ของเอกสาร ==='
DO $$
DECLARE r numeric;
BEGIN
  -- ค่าบริการจ่ายผ่าน e-Withholding Tax ปี 2569 → 1%
  SELECT tr.rate INTO r FROM tax_rate tr JOIN tax_code tc ON tc.id = tr.tax_code_id
   WHERE tc.code = 'WHT_SERVICE' AND tc.company_id IS NULL
     AND tr.condition_json->>'channel' = 'e_wht'
     AND DATE '2026-06-15' BETWEEN tr.effective_from AND COALESCE(tr.effective_to, DATE '9999-12-31');
  IF r <> 1.0 THEN RAISE EXCEPTION 'FAIL: e-WHT ค่าบริการปี 2569 ควรเป็น 1%% ได้ %', r; END IF;
  RAISE NOTICE '  PASS  ค่าบริการผ่าน e-Withholding Tax ปี 2569 = 1%%';

  -- ช่องทางปกติยังเป็น 3%
  SELECT tr.rate INTO r FROM tax_rate tr JOIN tax_code tc ON tc.id = tr.tax_code_id
   WHERE tc.code = 'WHT_SERVICE' AND tc.company_id IS NULL
     AND tr.condition_json->>'channel' = 'manual'
     AND DATE '2026-06-15' BETWEEN tr.effective_from AND COALESCE(tr.effective_to, DATE '9999-12-31');
  IF r <> 3.0 THEN RAISE EXCEPTION 'FAIL: ค่าบริการช่องทางปกติควรเป็น 3%% ได้ %', r; END IF;
  RAISE NOTICE '  PASS  ค่าบริการช่องทางยื่นแบบปกติ = 3%%';

  -- เพดานประกันสังคมเปลี่ยนตามปี
  SELECT wage_ceiling INTO r FROM sso_rate
   WHERE DATE '2025-06-15' BETWEEN effective_from AND COALESCE(effective_to, DATE '9999-12-31');
  IF r <> 15000 THEN RAISE EXCEPTION 'FAIL: เพดานประกันสังคมปี 2568 ควรเป็น 15,000 ได้ %', r; END IF;
  SELECT wage_ceiling INTO r FROM sso_rate
   WHERE DATE '2026-06-15' BETWEEN effective_from AND COALESCE(effective_to, DATE '9999-12-31');
  IF r <> 17500 THEN RAISE EXCEPTION 'FAIL: เพดานประกันสังคมปี 2569 ควรเป็น 17,500 ได้ %', r; END IF;
  RAISE NOTICE '  PASS  เพดานประกันสังคม 2568 = 15,000 และ 2569 = 17,500 (แยกตามวันที่)';
END $$;

\echo ''
\echo '============================================'
\echo ' ผ่านทุกกฎ — สคีมาบังคับกฎบัญชีได้จริง'
\echo '============================================'
