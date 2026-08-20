-- =====================================================================
-- ข้อมูลตัวอย่างสำหรับ dev และการทดสอบ — ห้ามใช้กับข้อมูลจริง
-- สร้าง: บริษัท 1 แห่ง, สาขาสำนักงานใหญ่, รอบบัญชี 2569 พร้อมงวด 12 งวด,
--        ผังบัญชีแม่แบบซื้อมาขายไป, ลูกค้า 2 ราย, ผู้ขาย 1 ราย, ชุดเลขที่เอกสาร
-- =====================================================================
SET search_path TO duly, public;

\set tenant '11111111-1111-1111-1111-111111111111'
\set company '22222222-2222-2222-2222-222222222222'
\set branch '33333333-3333-3333-3333-333333333333'
\set user_id '44444444-4444-4444-4444-444444444444'

INSERT INTO tenant (id, slug, name) VALUES (:'tenant', 'demo', 'บริษัทตัวอย่าง')
ON CONFLICT (id) DO NOTHING;

INSERT INTO company (id, tenant_id, code, legal_name_th, legal_name_en, tax_id, business_type,
                     bookkeeper_name, bookkeeper_cpd_no)
VALUES (:'company', :'tenant', 'DEMO', 'บริษัท ศรีวัฒนาการค้า จำกัด', 'Sriwattana Trading Co., Ltd.',
        '0105548021442', 'trading', 'ธนกร วงศ์สุวรรณ', 'CPD-0012345')
ON CONFLICT (id) DO NOTHING;

INSERT INTO branch (id, company_id, code, name_th, is_head_office, address_json)
VALUES (:'branch', :'company', '00000', 'สำนักงานใหญ่', true,
        '{"line1":"123 ถนนพระราม 4 แขวงคลองเตย","province":"กรุงเทพมหานคร","postcode":"10110"}')
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO app_user (id, tenant_id, email, full_name)
VALUES (:'user_id', :'tenant', 'demo@duly.local', 'ผู้ใช้ตัวอย่าง')
ON CONFLICT (id) DO NOTHING;

-- รอบบัญชี 2569 และงวดรายเดือน 12 งวด
INSERT INTO fiscal_year (id, company_id, code, start_date, end_date)
VALUES ('55555555-5555-5555-5555-555555555555', :'company', '2569', '2026-01-01', '2026-12-31')
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO accounting_period (company_id, fiscal_year_id, period_no, code, start_date, end_date)
SELECT :'company', '55555555-5555-5555-5555-555555555555', m,
       '2569-' || lpad(m::text, 2, '0'),
       make_date(2026, m, 1),
       (make_date(2026, m, 1) + INTERVAL '1 month - 1 day')::date
  FROM generate_series(1, 12) AS m
ON CONFLICT (company_id, code) DO NOTHING;

-- ผังบัญชี
SELECT seed_chart_of_accounts(:'company', 'T');

-- ชุดเลขที่เอกสาร
INSERT INTO document_sequence (company_id, branch_id, doc_type, period_key, prefix, padding)
SELECT :'company', :'branch', 'sales_invoice', '2026-' || lpad(m::text,2,'0'),
       'INV' || to_char(make_date(2026,m,1),'YYMM') || '-', 5
  FROM generate_series(1,12) AS m
ON CONFLICT DO NOTHING;

INSERT INTO document_sequence (company_id, branch_id, doc_type, period_key, prefix, padding)
SELECT :'company', NULL, 'je_' || t, '2569-' || lpad(m::text,2,'0'),
       upper(left(t,2)) || to_char(make_date(2026,m,1),'YYMM') || '-', 5
  FROM generate_series(1,12) AS m,
       unnest(ARRAY['general','sales','purchase','receipt','payment','adjustment','opening','closing',
                    'payroll','inventory','asset']) AS t
ON CONFLICT DO NOTHING;

-- คู่ค้า
INSERT INTO partner (id, company_id, kind, code, legal_name_th, entity_type, tax_id, branch_code,
                     is_vat_registered, payment_term_id,
                     receivable_account_id, payable_account_id)
VALUES
 ('88888888-8888-8888-8888-888888888888', :'company', 'customer', 'CUS-0012',
  'บริษัท เอ็นเอส เอ็นจิเนียริ่ง จำกัด', 'juristic', '0105548021442', '00000', true,
  (SELECT id FROM payment_term WHERE code='NET30' AND company_id IS NULL),
  account_by_subtype(:'company','trade_receivable'), NULL),
 ('88888888-8888-8888-8888-888888888889', :'company', 'customer', 'CUS-0099',
  'ห้างหุ้นส่วนจำกัด เลขภาษีผิด', 'juristic', '0000000000000', '00000', true,
  (SELECT id FROM payment_term WHERE code='CASH' AND company_id IS NULL),
  account_by_subtype(:'company','trade_receivable'), NULL),
 ('88888888-8888-8888-8888-88888888888a', :'company', 'vendor', 'VEN-0001',
  'บริษัท เอเชียสตีล จำกัด', 'juristic', '0105533001823', '00000', true,
  (SELECT id FROM payment_term WHERE code='NET30' AND company_id IS NULL),
  NULL, account_by_subtype(:'company','trade_payable'))
ON CONFLICT (id) DO NOTHING;

INSERT INTO partner_address (partner_id, address_kind, is_default, line1, province_code, postcode, full_text_th)
VALUES
 ('88888888-8888-8888-8888-888888888888','tax_invoice',true,'88/9 หมู่ 4 ตำบลมาบตาพุด','21','21150',
  '88/9 หมู่ 4 ตำบลมาบตาพุด อำเภอเมือง จังหวัดระยอง 21150'),
 ('88888888-8888-8888-8888-888888888889','tax_invoice',true,'1 ถนนทดสอบ','10','10110',
  '1 ถนนทดสอบ แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110')
ON CONFLICT DO NOTHING;

\echo 'ข้อมูลตัวอย่างพร้อมใช้งาน'
