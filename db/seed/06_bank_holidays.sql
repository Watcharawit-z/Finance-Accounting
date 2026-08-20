-- =====================================================================
-- SEED 06 — วันหยุดธนาคาร
-- ⚠ วันหยุดตามปฏิทินจันทรคติ (มาฆบูชา วิสาขบูชา อาสาฬหบูชา เข้าพรรษา)
--   และวันหยุดชดเชย ต้องนำเข้าจากประกาศธนาคารแห่งประเทศไทยรายปี
--   ตารางนี้ใส่เฉพาะวันที่ตายตัวตามกฎหมาย ซึ่งไม่เปลี่ยนแปลงระหว่างปี
--   ระบบต้องเตือนผู้ดูแลให้นำเข้าประกาศ ธปท. ทุกเดือนธันวาคมสำหรับปีถัดไป
-- =====================================================================
SET search_path TO duly, public;

CREATE OR REPLACE FUNCTION seed_fixed_bank_holidays(p_year integer)
RETURNS integer AS $$
DECLARE n integer := 0;
BEGIN
  INSERT INTO bank_holiday (holiday_date, name_th, name_en, is_bank, is_public)
  SELECT make_date(p_year, m, d), th, en, true, true
    FROM (VALUES
      ( 1, 1,'วันขึ้นปีใหม่','New Year''s Day'),
      ( 4, 6,'วันจักรี','Chakri Memorial Day'),
      ( 4,13,'วันสงกรานต์','Songkran Festival'),
      ( 4,14,'วันสงกรานต์','Songkran Festival'),
      ( 4,15,'วันสงกรานต์','Songkran Festival'),
      ( 5, 1,'วันแรงงานแห่งชาติ','National Labour Day'),
      ( 5, 4,'วันฉัตรมงคล','Coronation Day'),
      ( 6, 3,'วันเฉลิมพระชนมพรรษา สมเด็จพระนางเจ้าฯ พระบรมราชินี','HM Queen Suthida''s Birthday'),
      ( 7,28,'วันเฉลิมพระชนมพรรษา พระบาทสมเด็จพระเจ้าอยู่หัว','HM King''s Birthday'),
      ( 8,12,'วันเฉลิมพระชนมพรรษา สมเด็จพระบรมราชชนนีพันปีหลวง และวันแม่แห่งชาติ','HM Queen Mother''s Birthday'),
      (10,13,'วันนวมินทรมหาราช','Passing of King Bhumibol'),
      (10,23,'วันปิยมหาราช','Chulalongkorn Memorial Day'),
      ( 12, 5,'วันคล้ายวันพระบรมราชสมภพ ร.9 และวันพ่อแห่งชาติ','King Bhumibol Memorial Day'),
      ( 12,10,'วันรัฐธรรมนูญ','Constitution Day'),
      ( 12,31,'วันสิ้นปี','New Year''s Eve')
    ) AS v(m,d,th,en)
  ON CONFLICT (holiday_date) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$ LANGUAGE plpgsql SET search_path = duly, public, pg_temp;

SELECT seed_fixed_bank_holidays(2026);
SELECT seed_fixed_bank_holidays(2027);

-- วันทำการถัดไป (ใช้คำนวณวันครบกำหนดชำระและวันยื่นภาษี)
CREATE OR REPLACE FUNCTION next_business_day(p_date date)
RETURNS date AS $$
DECLARE d date := p_date;
BEGIN
  LOOP
    EXIT WHEN extract(isodow from d) < 6
          AND NOT EXISTS (SELECT 1 FROM bank_holiday WHERE holiday_date = d AND is_bank);
    d := d + 1;
  END LOOP;
  RETURN d;
END $$ LANGUAGE plpgsql STABLE SET search_path = duly, public, pg_temp;
