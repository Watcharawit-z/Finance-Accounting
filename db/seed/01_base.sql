-- =====================================================================
-- SEED 01 — สกุลเงิน หน่วยนับ เงื่อนไขชำระเงิน บทบาท
-- =====================================================================
SET search_path TO duly, public;

INSERT INTO currency (code,name_th,name_en,symbol,decimals) VALUES
  ('THB','บาท','Thai Baht','฿',2),
  ('USD','ดอลลาร์สหรัฐ','US Dollar','$',2),
  ('EUR','ยูโร','Euro','€',2),
  ('JPY','เยน','Japanese Yen','¥',0),
  ('CNY','หยวน','Chinese Yuan','¥',2),
  ('SGD','ดอลลาร์สิงคโปร์','Singapore Dollar','S$',2),
  ('GBP','ปอนด์สเตอร์ลิง','Pound Sterling','£',2),
  ('AUD','ดอลลาร์ออสเตรเลีย','Australian Dollar','A$',2),
  ('HKD','ดอลลาร์ฮ่องกง','Hong Kong Dollar','HK$',2),
  ('MYR','ริงกิต','Malaysian Ringgit','RM',2),
  ('KRW','วอน','South Korean Won','₩',0),
  ('TWD','ดอลลาร์ไต้หวัน','New Taiwan Dollar','NT$',2),
  ('VND','ดอง','Vietnamese Dong','₫',0),
  ('LAK','กีบ','Lao Kip','₭',2),
  ('KHR','เรียล','Cambodian Riel','៛',2),
  ('MMK','จ๊าด','Myanmar Kyat','K',2),
  ('IDR','รูเปียห์','Indonesian Rupiah','Rp',2),
  ('INR','รูปี','Indian Rupee','₹',2),
  ('CHF','ฟรังก์สวิส','Swiss Franc','CHF',2),
  ('AED','ดีร์ฮัม','UAE Dirham','د.إ',2)
ON CONFLICT (code) DO NOTHING;

-- หน่วยนับมาตรฐาน (company_id = NULL คือของระบบ ใช้ได้ทุกบริษัท)
INSERT INTO uom (company_id,code,name_th,name_en,category,decimals) VALUES
  (NULL,'PC','ชิ้น','Piece','unit',0),
  (NULL,'EA','อัน','Each','unit',0),
  (NULL,'SET','ชุด','Set','unit',0),
  (NULL,'PKG','แพ็ค','Pack','unit',0),
  (NULL,'BOX','กล่อง','Box','unit',0),
  (NULL,'CTN','ลัง','Carton','unit',0),
  (NULL,'DOZ','โหล','Dozen','unit',0),
  (NULL,'PAIR','คู่','Pair','unit',0),
  (NULL,'ROLL','ม้วน','Roll','unit',0),
  (NULL,'SHEET','แผ่น','Sheet','unit',0),
  (NULL,'BAG','ถุง','Bag','unit',0),
  (NULL,'BTL','ขวด','Bottle','unit',0),
  (NULL,'CAN','กระป๋อง','Can','unit',0),
  (NULL,'TUBE','หลอด','Tube','unit',0),
  (NULL,'KG','กิโลกรัม','Kilogram','weight',3),
  (NULL,'G','กรัม','Gram','weight',3),
  (NULL,'TON','ตัน','Metric Ton','weight',3),
  (NULL,'L','ลิตร','Litre','volume',3),
  (NULL,'ML','มิลลิลิตร','Millilitre','volume',2),
  (NULL,'M3','ลูกบาศก์เมตร','Cubic Metre','volume',3),
  (NULL,'M','เมตร','Metre','length',3),
  (NULL,'CM','เซนติเมตร','Centimetre','length',2),
  (NULL,'M2','ตารางเมตร','Square Metre','length',3),
  (NULL,'HR','ชั่วโมง','Hour','time',2),
  (NULL,'DAY','วัน','Day','time',2),
  (NULL,'MTH','เดือน','Month','time',2),
  (NULL,'YR','ปี','Year','time',2),
  (NULL,'JOB','งาน','Job','unit',2),
  (NULL,'TRIP','เที่ยว','Trip','unit',0),
  (NULL,'LOT','ล็อต','Lot','unit',2)
ON CONFLICT DO NOTHING;

INSERT INTO uom_conversion (from_uom_id,to_uom_id,factor)
SELECT f.id, t.id, v.factor FROM (VALUES
  ('KG','G',1000),('TON','KG',1000),('L','ML',1000),('M','CM',100),('DOZ','PC',12),
  ('YR','MTH',12),('DAY','HR',24)
) AS v(f,t,factor)
JOIN uom f ON f.code=v.f AND f.company_id IS NULL
JOIN uom t ON t.code=v.t AND t.company_id IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO payment_term (company_id,code,name_th,days,term_type) VALUES
  (NULL,'CASH','เงินสด',0,'cod'),
  (NULL,'PREPAID','ชำระล่วงหน้า',0,'prepaid'),
  (NULL,'NET7','เครดิต 7 วัน',7,'net'),
  (NULL,'NET15','เครดิต 15 วัน',15,'net'),
  (NULL,'NET30','เครดิต 30 วัน',30,'net'),
  (NULL,'NET45','เครดิต 45 วัน',45,'net'),
  (NULL,'NET60','เครดิต 60 วัน',60,'net'),
  (NULL,'NET90','เครดิต 90 วัน',90,'net'),
  (NULL,'EOM','สิ้นเดือนที่ส่งของ',0,'eom'),
  (NULL,'EOM30','สิ้นเดือนถัดไป',30,'eom_plus'),
  (NULL,'EOM60','สิ้นเดือนถัดไปอีก 2 เดือน',60,'eom_plus')
ON CONFLICT DO NOTHING;

-- บทบาทมาตรฐาน (tenant_id = NULL คือของระบบ)
INSERT INTO role (tenant_id,code,name_th,name_en,description,is_system,permissions) VALUES
 (NULL,'OWNER','เจ้าของ / กรรมการ','Owner','ดูและทำได้ทุกอย่าง รวมถึงจัดการผู้ใช้',true,
  '["*"]'::jsonb),
 (NULL,'CFO','ผู้บริหารการเงิน','CFO','ดูทุกรายงาน อนุมัติ ปลดล็อกงวด',true,
  '["gl:read","gl:post","gl:unlock_period","ar:*","ap:*","bank:*","tax:*","report:*","budget:*","payroll:read","approval:approve"]'::jsonb),
 (NULL,'CHIEF_ACCOUNTANT','สมุห์บัญชี','Chief Accountant','ลงบัญชี ปิดงวด ยื่นภาษี จัดการผังบัญชี',true,
  '["gl:*","ar:*","ap:*","bank:*","tax:*","inventory:*","asset:*","report:*","coa:write","period:close"]'::jsonb),
 (NULL,'ACCOUNTANT','พนักงานบัญชี','Accountant','คีย์เอกสารและสร้างรายการฉบับร่าง',true,
  '["gl:read","gl:draft","ar:write","ap:write","bank:read","tax:read","report:read","inventory:read"]'::jsonb),
 (NULL,'TREASURY','การเงิน','Treasury','สร้างรายการจ่าย กระทบยอดธนาคาร',true,
  '["bank:*","ap:pay","ar:receive","report:read","cheque:*"]'::jsonb),
 (NULL,'PURCHASING','จัดซื้อ','Purchasing','ใบขอซื้อ ใบสั่งซื้อ รับของ',true,
  '["ap:pr","ap:po","ap:gr","partner:vendor_read","inventory:read"]'::jsonb),
 (NULL,'SALES','ขาย','Sales','ใบเสนอราคา ใบสั่งขาย ดูวงเงินลูกค้า',true,
  '["ar:quotation","ar:order","ar:invoice","partner:customer_write","inventory:read_qty"]'::jsonb),
 (NULL,'WAREHOUSE','คลังสินค้า','Warehouse','รับ จ่าย โอน นับสต๊อก',true,
  '["inventory:move","inventory:count","ap:gr","ar:delivery"]'::jsonb),
 (NULL,'HR_PAYROLL','บุคคลและเงินเดือน','HR & Payroll','ข้อมูลพนักงานและการทำเงินเดือน',true,
  '["payroll:*","employee:*","tax:pnd1"]'::jsonb),
 (NULL,'AUDITOR','ผู้สอบบัญชี','Auditor','อ่านอย่างเดียวทุกรายการ รวมถึง audit log',true,
  '["*:read","audit:read","export:read"]'::jsonb),
 (NULL,'SYS_ADMIN','ผู้ดูแลระบบ','System Admin','จัดการผู้ใช้และการตั้งค่า แต่ดูตัวเลขบัญชีไม่ได้',true,
  '["user:*","setting:*","integration:*","role:*"]'::jsonb)
ON CONFLICT DO NOTHING;
