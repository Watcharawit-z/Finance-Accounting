-- =====================================================================
-- SEED 03 — รหัสภาษีและอัตราภาษีตามช่วงเวลา
-- ★ หลักการ: อัตราทุกตัวเป็นข้อมูล ไม่ใช่โค้ด — แก้ที่นี่เมื่อกฎหมายเปลี่ยน
--   ทุกการคำนวณต้อง lookup ด้วยวันที่ของเอกสาร ไม่ใช่วันที่ปัจจุบัน
-- =====================================================================
SET search_path TO duly, public;

-- ---------------------------------------------------------------------
-- ภาษีมูลค่าเพิ่ม
-- ---------------------------------------------------------------------
INSERT INTO tax_code (company_id,code,name_th,name_en,kind,vat_treatment,is_sale,is_purchase) VALUES
 (NULL,'VAT7_OUT','ภาษีขาย 7%','Output VAT 7%','vat_output','standard',true,false),
 (NULL,'VAT0_OUT','ภาษีขาย 0% (ส่งออก)','Output VAT 0%','vat_output','zero_rated',true,false),
 (NULL,'EXEMPT_OUT','ขายที่ได้รับยกเว้น VAT','VAT Exempt Sale','vat_output','exempt',true,false),
 (NULL,'NOVAT_OUT','นอกขอบข่าย VAT (ขาย)','Out of Scope Sale','vat_output','out_of_scope',true,false),
 (NULL,'VAT7_IN','ภาษีซื้อ 7%','Input VAT 7%','vat_input','standard',false,true),
 (NULL,'VAT0_IN','ภาษีซื้อ 0%','Input VAT 0%','vat_input','zero_rated',false,true),
 (NULL,'EXEMPT_IN','ซื้อที่ได้รับยกเว้น VAT','VAT Exempt Purchase','vat_input','exempt',false,true),
 (NULL,'NOVAT_IN','นอกขอบข่าย VAT (ซื้อ)','Out of Scope Purchase','vat_input','out_of_scope',false,true),
 (NULL,'VAT7_NC','ภาษีซื้อต้องห้าม 7%','Non-claimable Input VAT','vat_input','non_claimable',false,true),
 (NULL,'VAT7_DEF','ภาษีซื้อรอเรียกคืน','Deferred Input VAT','vat_input','standard',false,true)
ON CONFLICT DO NOTHING;

INSERT INTO tax_rate (tax_code_id,rate,effective_from,effective_to,legal_ref,note)
SELECT id, 7.0, DATE '1999-04-01', NULL,
       'พ.ร.ฎ. ลดอัตราภาษีมูลค่าเพิ่ม (ต่ออายุเป็นช่วง ๆ)',
       'อัตราตามประมวลรัษฎากรคือ 10% แต่ลดเหลือ 7% โดยพระราชกฤษฎีกาที่ต่ออายุทุกปี — ต้องตรวจสอบการต่ออายุทุกปีงบประมาณ'
  FROM tax_code WHERE code IN ('VAT7_OUT','VAT7_IN','VAT7_NC','VAT7_DEF') AND company_id IS NULL;

INSERT INTO tax_rate (tax_code_id,rate,effective_from,legal_ref)
SELECT id, 0.0, DATE '1992-01-01', 'ม.80/1 ประมวลรัษฎากร'
  FROM tax_code WHERE code IN ('VAT0_OUT','VAT0_IN','EXEMPT_OUT','EXEMPT_IN','NOVAT_OUT','NOVAT_IN') AND company_id IS NULL;

-- ---------------------------------------------------------------------
-- ภาษีเงินได้หัก ณ ที่จ่าย
-- อัตราปกติ + อัตราลดพิเศษเมื่อนำส่งผ่าน e-Withholding Tax
-- ---------------------------------------------------------------------
INSERT INTO tax_code (company_id,code,name_th,name_en,kind,wht_income_type,wht_form,is_purchase) VALUES
 (NULL,'WHT_SERVICE','หัก ณ ที่จ่าย - ค่าบริการ/จ้างทำของ','WHT - Services','wht','service',NULL,true),
 (NULL,'WHT_PROF','หัก ณ ที่จ่าย - วิชาชีพอิสระ','WHT - Professional','wht','professional',NULL,true),
 (NULL,'WHT_RENT','หัก ณ ที่จ่าย - ค่าเช่า','WHT - Rent','wht','rent',NULL,true),
 (NULL,'WHT_TRANSPORT','หัก ณ ที่จ่าย - ค่าขนส่ง','WHT - Transport','wht','transport',NULL,true),
 (NULL,'WHT_ADVERT','หัก ณ ที่จ่าย - ค่าโฆษณา','WHT - Advertising','wht','advertising',NULL,true),
 (NULL,'WHT_COMMISSION','หัก ณ ที่จ่าย - ค่านายหน้า','WHT - Commission','wht','commission',NULL,true),
 (NULL,'WHT_CONTRACT','หัก ณ ที่จ่าย - รับเหมา','WHT - Contract Work','wht','contract',NULL,true),
 (NULL,'WHT_PRIZE','หัก ณ ที่จ่าย - รางวัล/ส่วนลดส่งเสริมการขาย','WHT - Prize','wht','prize',NULL,true),
 (NULL,'WHT_DIVIDEND','หัก ณ ที่จ่าย - เงินปันผล','WHT - Dividend','wht','dividend','PND2',true),
 (NULL,'WHT_INTEREST','หัก ณ ที่จ่าย - ดอกเบี้ย','WHT - Interest','wht','interest','PND2',true),
 (NULL,'WHT_ROYALTY','หัก ณ ที่จ่าย - ค่าสิทธิ','WHT - Royalty','wht','royalty',NULL,true),
 (NULL,'WHT_SALARY','หัก ณ ที่จ่าย - เงินเดือน','WHT - Salary','wht','salary','PND1',true),
 (NULL,'WHT_FOREIGN','หัก ณ ที่จ่าย - จ่ายต่างประเทศ','WHT - Payment Abroad','wht','foreign','PND54',true)
ON CONFLICT DO NOTHING;

-- อัตราปกติ (ช่องทางนำส่งแบบยื่นแบบเอง)
INSERT INTO tax_rate (tax_code_id,rate,effective_from,condition_json,legal_ref,note)
SELECT tc.id, v.rate, DATE '2000-01-01', v.cond::jsonb, v.ref, v.note
FROM (VALUES
 ('WHT_SERVICE',    3.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 8',  'ค่าจ้างทำของ/ค่าบริการ ทั้งบุคคลและนิติบุคคล'),
 ('WHT_CONTRACT',   3.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 8',  'รับเหมาก่อสร้าง'),
 ('WHT_PROF',       3.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 7',  'ม.40(6) วิชาชีพอิสระ'),
 ('WHT_RENT',       5.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 6',  'ค่าเช่าอสังหาริมทรัพย์'),
 ('WHT_TRANSPORT',  1.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 12', 'ผู้ประกอบการขนส่งในประเทศ ไม่รวมขนส่งสาธารณะ'),
 ('WHT_ADVERT',     2.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 10', 'ค่าโฆษณา'),
 ('WHT_PRIZE',      5.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 9',  'รางวัล ส่วนลด หรือประโยชน์จากการส่งเสริมการขาย'),
 ('WHT_ROYALTY',    3.0, '{"channel":"manual"}', 'ท.ป.4/2528 ข้อ 3',  'ค่าแห่งกู๊ดวิลล์ ค่าลิขสิทธิ์ ม.40(3)'),
 ('WHT_DIVIDEND',  10.0, '{}',                   'ม.50(2)(จ)',        'เงินปันผล'),
 ('WHT_ROYALTY_X',  0.0, '{}',                   '',                  'placeholder')
) AS v(code,rate,cond,ref,note)
JOIN tax_code tc ON tc.code = v.code AND tc.company_id IS NULL;

-- ดอกเบี้ย: อัตราต่างกันตามประเภทผู้รับ
INSERT INTO tax_rate (tax_code_id,rate,effective_from,condition_json,legal_ref,note)
SELECT id, 1.0, DATE '2000-01-01', '{"entity_type":"juristic"}'::jsonb, 'ท.ป.4/2528 ข้อ 4', 'ดอกเบี้ยจ่ายให้นิติบุคคล'
  FROM tax_code WHERE code='WHT_INTEREST' AND company_id IS NULL
UNION ALL
SELECT id, 15.0, DATE '2000-01-01', '{"entity_type":"individual"}'::jsonb, 'ม.50(2)', 'ดอกเบี้ยจ่ายให้บุคคลธรรมดา'
  FROM tax_code WHERE code='WHT_INTEREST' AND company_id IS NULL;

-- ค่านายหน้า: บุคคลธรรมดาใช้อัตราก้าวหน้า นิติบุคคล 3%
INSERT INTO tax_rate (tax_code_id,rate,effective_from,condition_json,legal_ref,note)
SELECT id, 3.0, DATE '2000-01-01', '{"entity_type":"juristic"}'::jsonb, 'ท.ป.4/2528 ข้อ 3/1', 'ค่านายหน้าจ่ายให้นิติบุคคล'
  FROM tax_code WHERE code='WHT_COMMISSION' AND company_id IS NULL;

-- จ่ายไปต่างประเทศ (ม.70) — ต้องตรวจอนุสัญญาภาษีซ้อนรายประเทศเพิ่มเติม
INSERT INTO tax_rate (tax_code_id,rate,effective_from,condition_json,legal_ref,note)
SELECT id, 15.0, DATE '2000-01-01', '{"income_class":"service_royalty"}'::jsonb, 'ม.70',
       'อัตราทั่วไป — ต้องตรวจอนุสัญญาภาษีซ้อน (DTA) รายประเทศก่อนใช้จริง'
  FROM tax_code WHERE code='WHT_FOREIGN' AND company_id IS NULL
UNION ALL
SELECT id, 10.0, DATE '2000-01-01', '{"income_class":"dividend"}'::jsonb, 'ม.70', 'เงินปันผลจ่ายต่างประเทศ'
  FROM tax_code WHERE code='WHT_FOREIGN' AND company_id IS NULL;

-- ★ อัตราลดพิเศษเมื่อนำส่งผ่าน e-Withholding Tax
--   มาตรการเดิมสิ้นสุด 31 ธ.ค. 2568 → ครม. ต่ออายุถึง 31 ธ.ค. 2570
INSERT INTO tax_rate (tax_code_id,rate,effective_from,effective_to,condition_json,legal_ref,note)
SELECT tc.id, 1.0, DATE '2023-01-01', DATE '2025-12-31', '{"channel":"e_wht"}'::jsonb,
       'พ.ร.ฎ. ลดอัตราภาษีหัก ณ ที่จ่ายสำหรับ e-Withholding Tax',
       'มาตรการรอบเดิม'
  FROM tax_code tc WHERE tc.code IN ('WHT_SERVICE','WHT_CONTRACT','WHT_PROF','WHT_RENT','WHT_TRANSPORT','WHT_ADVERT','WHT_COMMISSION','WHT_ROYALTY') AND tc.company_id IS NULL
UNION ALL
SELECT tc.id, 1.0, DATE '2026-01-01', DATE '2027-12-31', '{"channel":"e_wht"}'::jsonb,
       'มติ ครม. ขยายมาตรการภาษี e-Tax (ข่าว ปชส. กรมสรรพากร 14/2569)',
       'ขยายเวลาอีก 2 ปี — ตรวจสอบการต่ออายุก่อน 1 ม.ค. 2571'
  FROM tax_code tc WHERE tc.code IN ('WHT_SERVICE','WHT_CONTRACT','WHT_PROF','WHT_RENT','WHT_TRANSPORT','WHT_ADVERT','WHT_COMMISSION','WHT_ROYALTY') AND tc.company_id IS NULL;

-- ---------------------------------------------------------------------
-- ภาษีธุรกิจเฉพาะ
-- ---------------------------------------------------------------------
INSERT INTO tax_code (company_id,code,name_th,name_en,kind,is_sale) VALUES
 (NULL,'SBT_BANK','ภาษีธุรกิจเฉพาะ - ธุรกิจการเงิน','SBT - Banking','sbt',true),
 (NULL,'SBT_REALESTATE','ภาษีธุรกิจเฉพาะ - ขายอสังหาริมทรัพย์','SBT - Real Estate','sbt',true)
ON CONFLICT DO NOTHING;

INSERT INTO tax_rate (tax_code_id,rate,effective_from,legal_ref,note)
SELECT id, 3.0, DATE '2000-01-01', 'ม.91/6', 'บวกภาษีท้องถิ่นอีก 10% ของภาษีธุรกิจเฉพาะ → รวมเป็น 3.3%'
  FROM tax_code WHERE code IN ('SBT_BANK','SBT_REALESTATE') AND company_id IS NULL;

DELETE FROM tax_rate WHERE note = 'placeholder';
