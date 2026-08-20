-- =====================================================================
-- SEED 07 — โครงงบการเงินตาม TFRS for NPAEs
-- ★ ทุกบรรทัดอ้าง sub_type ไม่ใช่รหัสบัญชี
--   ลูกค้าเปลี่ยนรหัสบัญชีได้ตามใจ งบการเงินยังออกถูกต้อง
-- =====================================================================
SET search_path TO duly, public;

INSERT INTO report_definition (company_id,code,name_th,name_en,report_kind,standard,is_system) VALUES
 (NULL,'BS','งบแสดงฐานะการเงิน','Statement of Financial Position','financial_statement','TFRS_NPAE',true),
 (NULL,'PL_FUNCTION','งบกำไรขาดทุน (จำแนกตามหน้าที่)','Income Statement (by function)','financial_statement','TFRS_NPAE',true),
 (NULL,'PL_NATURE','งบกำไรขาดทุน (จำแนกตามลักษณะ)','Income Statement (by nature)','financial_statement','TFRS_NPAE',true),
 (NULL,'CF_INDIRECT','งบกระแสเงินสด (ทางอ้อม)','Cash Flow Statement (indirect)','financial_statement','TFRS_NPAE',true),
 (NULL,'SOCE','งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น','Statement of Changes in Equity','financial_statement','TFRS_NPAE',true),
 (NULL,'TB','งบทดลอง','Trial Balance','financial_statement',NULL,true)
ON CONFLICT DO NOTHING;

-- ทำให้สคริปต์รันซ้ำได้ (idempotent)
DELETE FROM report_line rl
 USING report_definition rd
 WHERE rd.id = rl.definition_id AND rd.company_id IS NULL AND rd.is_system;

-- ---------------------------------------------------------------------
-- งบแสดงฐานะการเงิน
-- ---------------------------------------------------------------------
INSERT INTO report_line (definition_id,seq_no,label_th,label_en,line_kind,sub_types,formula,sign,indent,is_bold,note_no)
SELECT d.id, v.seq, v.th, v.en, v.kind, v.st::text[], v.formula, v.sign, v.ind, v.bold, v.note
FROM report_definition d, (VALUES
 (10 ,'สินทรัพย์','ASSETS','header','{}',NULL,1,0,true,NULL),
 (20 ,'สินทรัพย์หมุนเวียน','Current Assets','header','{}',NULL,1,1,true,NULL),
 (30 ,'เงินสดและรายการเทียบเท่าเงินสด','Cash and Cash Equivalents','detail','{cash,bank,cash_in_transit}',NULL,1,2,false,2),
 (40 ,'เงินลงทุนชั่วคราว','Short-term Investments','detail','{short_term_investment}',NULL,1,2,false,3),
 (50 ,'ลูกหนี้การค้าและลูกหนี้อื่น','Trade and Other Receivables','detail','{trade_receivable,trade_receivable_related,ar_allowance,other_receivable,accrued_income}',NULL,1,2,false,4),
 (60 ,'สินค้าคงเหลือ','Inventories','detail','{inventory,inventory_allowance}',NULL,1,2,false,5),
 (70 ,'สินทรัพย์หมุนเวียนอื่น','Other Current Assets','detail','{input_vat,deferred_input_vat,vat_receivable,wht_asset,prepaid_cit,prepaid_expense,deposit_paid,non_claimable_vat,suspense}',NULL,1,2,false,NULL),
 (80 ,'รวมสินทรัพย์หมุนเวียน','Total Current Assets','subtotal','{}','L30+L40+L50+L60+L70',1,1,true,NULL),
 (90 ,'สินทรัพย์ไม่หมุนเวียน','Non-current Assets','header','{}',NULL,1,1,true,NULL),
 (100,'เงินลงทุนระยะยาว','Long-term Investments','detail','{long_term_investment,investment_subsidiary,long_term_receivable}',NULL,1,2,false,6),
 (110,'อสังหาริมทรัพย์เพื่อการลงทุน','Investment Property','detail','{investment_property}',NULL,1,2,false,7),
 (120,'ที่ดิน อาคารและอุปกรณ์','Property, Plant and Equipment','detail','{ppe_land,ppe,cip,accum_depreciation}',NULL,1,2,false,8),
 (130,'สินทรัพย์สิทธิการใช้','Right-of-use Assets','detail','{rou_asset}',NULL,1,2,false,NULL),
 (140,'สินทรัพย์ไม่มีตัวตน','Intangible Assets','detail','{intangible,goodwill,accum_amortization}',NULL,1,2,false,9),
 (150,'สินทรัพย์ภาษีเงินได้รอการตัดบัญชี','Deferred Tax Assets','detail','{deferred_tax_asset}',NULL,1,2,false,NULL),
 (160,'สินทรัพย์ไม่หมุนเวียนอื่น','Other Non-current Assets','detail','{other_asset,intercompany}',NULL,1,2,false,NULL),
 (170,'รวมสินทรัพย์ไม่หมุนเวียน','Total Non-current Assets','subtotal','{}','L100+L110+L120+L130+L140+L150+L160',1,1,true,NULL),
 (180,'รวมสินทรัพย์','TOTAL ASSETS','total','{}','L80+L170',1,0,true,NULL),
 (190,'','','spacer','{}',NULL,1,0,false,NULL),
 (200,'หนี้สินและส่วนของผู้ถือหุ้น','LIABILITIES AND EQUITY','header','{}',NULL,1,0,true,NULL),
 (210,'หนี้สินหมุนเวียน','Current Liabilities','header','{}',NULL,1,1,true,NULL),
 (220,'เงินเบิกเกินบัญชีและเงินกู้ยืมระยะสั้น','Bank Overdrafts and Short-term Loans','detail','{bank_overdraft,short_term_loan,notes_payable}',NULL,-1,2,false,10),
 (230,'เจ้าหนี้การค้าและเจ้าหนี้อื่น','Trade and Other Payables','detail','{trade_payable,trade_payable_related,grni,accrued_expense,accrued_payroll,other_payable}',NULL,-1,2,false,11),
 (240,'หนี้สินทางภาษี','Tax Liabilities','detail','{output_vat,deferred_output_vat,vat_payable,wht_payable,cit_payable,other_tax_payable,sso_payable,pvd_payable}',NULL,-1,2,false,NULL),
 (250,'เงินรับล่วงหน้าจากลูกค้า','Advances from Customers','detail','{customer_deposit,unearned_revenue,retention_payable}',NULL,-1,2,false,NULL),
 (260,'ส่วนของหนี้สินระยะยาวที่ถึงกำหนดชำระใน 1 ปี','Current Portion of Long-term Debt','detail','{current_portion_ltd,lease_liability_current}',NULL,-1,2,false,NULL),
 (270,'รวมหนี้สินหมุนเวียน','Total Current Liabilities','subtotal','{}','L220+L230+L240+L250+L260',1,1,true,NULL),
 (280,'หนี้สินไม่หมุนเวียน','Non-current Liabilities','header','{}',NULL,1,1,true,NULL),
 (290,'เงินกู้ยืมระยะยาว','Long-term Loans','detail','{long_term_loan,related_party_loan}',NULL,-1,2,false,12),
 (300,'หนี้สินตามสัญญาเช่า','Lease Liabilities','detail','{lease_liability}',NULL,-1,2,false,NULL),
 (310,'ประมาณการหนี้สินผลประโยชน์พนักงาน','Employee Benefit Obligations','detail','{employee_benefit_obligation}',NULL,-1,2,false,13),
 (320,'ประมาณการหนี้สินอื่น','Other Provisions','detail','{provision,deferred_tax_liability}',NULL,-1,2,false,NULL),
 (330,'รวมหนี้สินไม่หมุนเวียน','Total Non-current Liabilities','subtotal','{}','L290+L300+L310+L320',1,1,true,NULL),
 (340,'รวมหนี้สิน','Total Liabilities','subtotal','{}','L270+L330',1,0,true,NULL),
 (350,'ส่วนของผู้ถือหุ้น','Shareholders Equity','header','{}',NULL,1,1,true,NULL),
 (360,'ทุนที่ออกและชำระแล้ว','Issued and Paid-up Share Capital','detail','{paid_up_capital,share_subscription}',NULL,-1,2,false,14),
 (370,'ส่วนเกินมูลค่าหุ้น','Share Premium','detail','{share_premium}',NULL,-1,2,false,NULL),
 (380,'สำรองตามกฎหมาย','Legal Reserve','detail','{legal_reserve,other_reserve,revaluation_surplus}',NULL,-1,2,false,15),
 (390,'กำไรสะสม','Retained Earnings','detail','{retained_earnings,current_year_earnings,dividend,prior_period_adjustment,opening_balance}','PL_NET',-1,2,false,NULL),
 (400,'รวมส่วนของผู้ถือหุ้น','Total Equity','subtotal','{}','L360+L370+L380+L390',1,1,true,NULL),
 (410,'รวมหนี้สินและส่วนของผู้ถือหุ้น','TOTAL LIABILITIES AND EQUITY','total','{}','L340+L400',1,0,true,NULL)
) AS v(seq,th,en,kind,st,formula,sign,ind,bold,note)
WHERE d.code='BS' AND d.company_id IS NULL;

-- ---------------------------------------------------------------------
-- งบกำไรขาดทุน จำแนกตามหน้าที่
-- ---------------------------------------------------------------------
INSERT INTO report_line (definition_id,seq_no,label_th,label_en,line_kind,sub_types,formula,sign,indent,is_bold,note_no)
SELECT d.id, v.seq, v.th, v.en, v.kind, v.st::text[], v.formula, v.sign, v.ind, v.bold, v.note
FROM report_definition d, (VALUES
 (10 ,'รายได้จากการขายและบริการ','Revenue from Sales and Services','detail','{sales_revenue,sales_revenue_export,sales_revenue_related,service_revenue,contract_revenue,sales_return,sales_discount}',NULL,-1,0,false,16),
 (20 ,'ต้นทุนขายและต้นทุนบริการ','Cost of Sales and Services','detail','{cogs,cost_of_service,purchases,purchase_return,manufacturing_cost,cost_variance}',NULL,1,0,false,17),
 (30 ,'กำไรขั้นต้น','Gross Profit','subtotal','{}','L10-L20',1,0,true,NULL),
 (40 ,'รายได้อื่น','Other Income','detail','{other_income,interest_income,dividend_income,fx_gain,gain_on_disposal,bad_debt_recovery,rental_revenue,commission_revenue}',NULL,-1,0,false,18),
 (50 ,'ค่าใช้จ่ายในการขาย','Selling Expenses','detail','{selling_expense}',NULL,1,0,false,NULL),
 (60 ,'ค่าใช้จ่ายในการบริหาร','Administrative Expenses','detail','{admin_expense,depreciation,amortization,bad_debt,fx_loss,loss_on_disposal,non_claimable_vat_expense,donation,non_deductible,inventory_writeoff,rounding}',NULL,1,0,false,19),
 (70 ,'รวมค่าใช้จ่าย','Total Expenses','subtotal','{}','L50+L60',1,0,false,NULL),
 (80 ,'กำไรก่อนต้นทุนทางการเงินและภาษีเงินได้','Profit before Finance Costs and Income Tax','subtotal','{}','L30+L40-L70',1,0,true,NULL),
 (90 ,'ต้นทุนทางการเงิน','Finance Costs','detail','{finance_cost}',NULL,1,0,false,20),
 (100,'กำไรก่อนภาษีเงินได้','Profit before Income Tax','subtotal','{}','L80-L90',1,0,true,NULL),
 (110,'ภาษีเงินได้นิติบุคคล','Income Tax Expense','detail','{income_tax_expense,deferred_tax_expense}',NULL,1,0,false,21),
 (120,'กำไรสุทธิ','NET PROFIT','total','{}','L100-L110',1,0,true,NULL)
) AS v(seq,th,en,kind,st,formula,sign,ind,bold,note)
WHERE d.code='PL_FUNCTION' AND d.company_id IS NULL;

-- ---------------------------------------------------------------------
-- งบกระแสเงินสด (ทางอ้อม)
-- ---------------------------------------------------------------------
INSERT INTO report_line (definition_id,seq_no,label_th,label_en,line_kind,sub_types,formula,sign,indent,is_bold)
SELECT d.id, v.seq, v.th, v.en, v.kind, v.st::text[], v.formula, v.sign, v.ind, v.bold
FROM report_definition d, (VALUES
 (10 ,'กระแสเงินสดจากกิจกรรมดำเนินงาน','Cash Flows from Operating Activities','header','{}',NULL,1,0,true),
 (20 ,'กำไรก่อนภาษีเงินได้','Profit before Income Tax','detail','{}','PL:L100',1,1,false),
 (30 ,'รายการปรับกระทบ:','Adjustments for:','header','{}',NULL,1,1,false),
 (40 ,'ค่าเสื่อมราคาและค่าตัดจำหน่าย','Depreciation and Amortization','detail','{depreciation,amortization}',NULL,1,2,false),
 (50 ,'หนี้สงสัยจะสูญ','Doubtful Accounts','detail','{bad_debt}',NULL,1,2,false),
 (60 ,'ขาดทุน (กำไร) จากการจำหน่ายสินทรัพย์','Loss (Gain) on Disposal of Assets','detail','{loss_on_disposal,gain_on_disposal}',NULL,1,2,false),
 (70 ,'ประมาณการหนี้สินผลประโยชน์พนักงาน','Employee Benefit Provision','detail','{employee_benefit_obligation}',NULL,1,2,false),
 (80 ,'ดอกเบี้ยจ่าย','Interest Expense','detail','{finance_cost}',NULL,1,2,false),
 (90 ,'การเปลี่ยนแปลงในสินทรัพย์และหนี้สินดำเนินงาน:','Changes in Operating Assets and Liabilities:','header','{}',NULL,1,1,false),
 (100,'ลูกหนี้การค้าและลูกหนี้อื่น (เพิ่มขึ้น) ลดลง','(Increase) Decrease in Trade and Other Receivables','detail','{trade_receivable,trade_receivable_related,other_receivable,accrued_income,ar_allowance}','DELTA',-1,2,false),
 (110,'สินค้าคงเหลือ (เพิ่มขึ้น) ลดลง','(Increase) Decrease in Inventories','detail','{inventory,inventory_allowance}','DELTA',-1,2,false),
 (120,'สินทรัพย์หมุนเวียนอื่น (เพิ่มขึ้น) ลดลง','(Increase) Decrease in Other Current Assets','detail','{prepaid_expense,input_vat,vat_receivable,wht_asset,deposit_paid}','DELTA',-1,2,false),
 (130,'เจ้าหนี้การค้าและเจ้าหนี้อื่น เพิ่มขึ้น (ลดลง)','Increase (Decrease) in Trade and Other Payables','detail','{trade_payable,trade_payable_related,grni,accrued_expense,accrued_payroll,other_payable}','DELTA',1,2,false),
 (140,'หนี้สินหมุนเวียนอื่น เพิ่มขึ้น (ลดลง)','Increase (Decrease) in Other Current Liabilities','detail','{output_vat,vat_payable,wht_payable,sso_payable,customer_deposit,unearned_revenue}','DELTA',1,2,false),
 (150,'เงินสดรับจากการดำเนินงาน','Cash Generated from Operations','subtotal','{}','L20+L40+L50+L60+L70+L80+L100+L110+L120+L130+L140',1,1,false),
 (160,'จ่ายดอกเบี้ย','Interest Paid','detail','{}','MANUAL',-1,1,false),
 (170,'จ่ายภาษีเงินได้','Income Tax Paid','detail','{cit_payable,prepaid_cit}','DELTA',-1,1,false),
 (180,'เงินสดสุทธิจากกิจกรรมดำเนินงาน','Net Cash from Operating Activities','subtotal','{}','L150-L160-L170',1,0,true),
 (190,'กระแสเงินสดจากกิจกรรมลงทุน','Cash Flows from Investing Activities','header','{}',NULL,1,0,true),
 (200,'ซื้อที่ดิน อาคารและอุปกรณ์','Purchase of Property, Plant and Equipment','detail','{ppe,ppe_land,cip}','DELTA',-1,1,false),
 (210,'ซื้อสินทรัพย์ไม่มีตัวตน','Purchase of Intangible Assets','detail','{intangible}','DELTA',-1,1,false),
 (220,'เงินลงทุน (เพิ่มขึ้น) ลดลง','(Increase) Decrease in Investments','detail','{short_term_investment,long_term_investment,investment_subsidiary,investment_property}','DELTA',-1,1,false),
 (230,'เงินสดสุทธิจากกิจกรรมลงทุน','Net Cash from Investing Activities','subtotal','{}','L200+L210+L220',1,0,true),
 (240,'กระแสเงินสดจากกิจกรรมจัดหาเงิน','Cash Flows from Financing Activities','header','{}',NULL,1,0,true),
 (250,'เงินกู้ยืม เพิ่มขึ้น (ลดลง)','Increase (Decrease) in Borrowings','detail','{short_term_loan,long_term_loan,bank_overdraft,notes_payable,related_party_loan,current_portion_ltd}','DELTA',1,1,false),
 (260,'ชำระหนี้สินตามสัญญาเช่า','Repayment of Lease Liabilities','detail','{lease_liability,lease_liability_current}','DELTA',1,1,false),
 (270,'เงินเพิ่มทุน','Proceeds from Share Capital','detail','{paid_up_capital,share_premium,share_subscription}','DELTA',1,1,false),
 (280,'จ่ายเงินปันผล','Dividends Paid','detail','{dividend}','DELTA',-1,1,false),
 (290,'เงินสดสุทธิจากกิจกรรมจัดหาเงิน','Net Cash from Financing Activities','subtotal','{}','L250+L260+L270+L280',1,0,true),
 (300,'เงินสดและรายการเทียบเท่าเงินสดเพิ่มขึ้น (ลดลง) สุทธิ','Net Increase (Decrease) in Cash','subtotal','{}','L180+L230+L290',1,0,true),
 (310,'เงินสดและรายการเทียบเท่าเงินสดต้นงวด','Cash and Cash Equivalents at Beginning of Period','detail','{cash,bank,cash_in_transit}','OPENING',1,0,false),
 (320,'เงินสดและรายการเทียบเท่าเงินสดปลายงวด','Cash and Cash Equivalents at End of Period','total','{cash,bank,cash_in_transit}','CLOSING',1,0,true)
) AS v(seq,th,en,kind,st,formula,sign,ind,bold)
WHERE d.code='CF_INDIRECT' AND d.company_id IS NULL;

-- ---------------------------------------------------------------------
-- กำหนดส่วนของงบ (ใช้ตรวจความสมดุล)
-- ---------------------------------------------------------------------
UPDATE report_line rl SET section =
  CASE WHEN rl.seq_no < 190 THEN 'asset' ELSE 'liability_equity' END
 FROM report_definition rd
WHERE rd.id = rl.definition_id AND rd.code = 'BS' AND rd.company_id IS NULL;

UPDATE report_line rl SET section =
  CASE WHEN rl.seq_no IN (10,40) THEN 'revenue' ELSE 'expense' END
 FROM report_definition rd
WHERE rd.id = rl.definition_id AND rd.code = 'PL_FUNCTION' AND rd.company_id IS NULL
  AND rl.line_kind = 'detail';

UPDATE report_line rl SET section =
  CASE WHEN rl.seq_no < 190 THEN 'operating'
       WHEN rl.seq_no < 240 THEN 'investing'
       WHEN rl.seq_no < 300 THEN 'financing'
       ELSE 'summary' END
 FROM report_definition rd
WHERE rd.id = rl.definition_id AND rd.code = 'CF_INDIRECT' AND rd.company_id IS NULL;

-- ---------------------------------------------------------------------
-- ตรวจสอบว่าไม่มี sub_type ในผังบัญชีที่หลุดจากงบการเงิน
-- (ถ้าหลุด = ยอดจะหายไปจากงบ ต้องเป็น 0 เสมอ)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW orphan_sub_types AS
SELECT DISTINCT t.sub_type
  FROM coa_template t
 WHERE t.sub_type <> 'header'
   AND t.is_postable            -- บัญชีความจำ (เช่น ทุนจดทะเบียน) แสดงในหมายเหตุ ไม่ใช่หน้างบ
   AND NOT EXISTS (
     SELECT 1 FROM report_line rl
      JOIN report_definition rd ON rd.id = rl.definition_id
     WHERE rd.code IN ('BS','PL_FUNCTION') AND t.sub_type = ANY(rl.sub_types));
