-- =====================================================================
-- โหลด seed data ทั้งหมด — รันจาก root ของ repo
--   psql -d duly -v ON_ERROR_STOP=1 -f db/seed/load_seed.sql
-- =====================================================================
\ir 01_base.sql
\ir 02_provinces.sql
\ir 03_tax_codes_rates.sql
\ir 04_tax_brackets.sql
\ir 05_coa_loader.sql
\ir 06_bank_holidays.sql
\ir 07_report_definitions.sql
\ir 08_statement_engine.sql
\echo 'seed data โหลดครบแล้ว'
\echo 'ขั้นถัดไป: สร้างบริษัท แล้วเรียก duly.seed_chart_of_accounts(company_id, ''T'')'
