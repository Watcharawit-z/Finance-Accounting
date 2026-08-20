-- =====================================================================
-- SEED 08 — ตัวคำนวณงบการเงินจากนิยามรายงาน
-- คืนค่าเฉพาะบรรทัด detail (ผลรวมตาม sub_type)
-- บรรทัด subtotal/total คำนวณจาก formula ที่ชั้นแอปพลิเคชัน
-- =====================================================================
SET search_path TO duly, public;

-- ยอดคงเหลือรายบัญชี ณ ช่วงเวลา
-- statement_kind: 'position' = ยอดสะสมถึงวันที่ (งบแสดงฐานะการเงิน)
--                 'performance' = ยอดเคลื่อนไหวในช่วง (งบกำไรขาดทุน)
CREATE OR REPLACE FUNCTION account_balances(
  p_company_id uuid, p_from date, p_to date, p_statement_kind text DEFAULT 'position'
) RETURNS TABLE (account_id uuid, sub_type text, account_type account_type, balance numeric) AS $$
  SELECT l.account_id, a.sub_type, a.account_type,
         SUM(l.debit_base - l.credit_base)::numeric(19,4)
    FROM journal_line l
    JOIN journal_entry e ON e.id = l.entry_id
    JOIN account a ON a.id = l.account_id
   WHERE l.company_id = p_company_id
     -- ★ ต้องรวม 'reversed' ด้วย: รายการที่ถูกกลับรายการยังคงอยู่ในบัญชีแยกประเภท
     --   ตัวที่หักล้างคือรายการกลับรายการซึ่งเป็นอีก entry หนึ่งต่างหาก
     --   ถ้ากรองออกจะกลายเป็นหักล้างซ้ำสองครั้ง และงบจะไม่สมดุล
     AND e.status IN ('posted','reversed')
     AND l.posting_date <= p_to
     AND (p_statement_kind = 'position' OR l.posting_date >= p_from)
   GROUP BY l.account_id, a.sub_type, a.account_type;
$$ LANGUAGE sql STABLE SET search_path = duly, public, pg_temp;

-- คำนวณบรรทัด detail ของงบตามนิยาม
CREATE OR REPLACE FUNCTION report_detail_lines(
  p_company_id uuid, p_definition_code text, p_from date, p_to date
) RETURNS TABLE (seq_no integer, label_th text, section text, amount numeric) AS $$
DECLARE kind text;
BEGIN
  SELECT CASE WHEN rd.code IN ('BS') THEN 'position' ELSE 'performance' END
    INTO kind FROM report_definition rd
   WHERE rd.code = p_definition_code AND rd.company_id IS NULL;

  RETURN QUERY
  SELECT rl.seq_no, rl.label_th, rl.section,
         COALESCE(SUM(b.balance) * rl.sign, 0)::numeric(19,4)
    FROM report_line rl
    JOIN report_definition rd ON rd.id = rl.definition_id
    LEFT JOIN account_balances(p_company_id, p_from, p_to, kind) b
           -- PL_NET: บรรทัดกำไรสะสมต้องรวมผลการดำเนินงานของงวดปัจจุบันที่ยังไม่ได้ปิดบัญชี
           -- ไม่งั้นงบแสดงฐานะการเงินจะไม่สมดุลตลอดปีจนกว่าจะปิดงบ
           ON b.sub_type = ANY(rl.sub_types)
           OR (rl.formula = 'PL_NET' AND b.account_type IN ('revenue','expense'))
   WHERE rd.code = p_definition_code AND rd.company_id IS NULL
     AND rl.line_kind = 'detail'
     AND cardinality(rl.sub_types) > 0
   GROUP BY rl.seq_no, rl.label_th, rl.section, rl.sign
   ORDER BY rl.seq_no;
END $$ LANGUAGE plpgsql STABLE SET search_path = duly, public, pg_temp;

-- ตรวจว่างบแสดงฐานะการเงินสมดุลหรือไม่
-- รวมสินทรัพย์ ต้องเท่ากับ รวมหนี้สินและส่วนของผู้ถือหุ้น → ผลต่างต้องเป็น 0
CREATE OR REPLACE FUNCTION balance_sheet_check(p_company_id uuid, p_as_of date)
RETURNS numeric AS $$
  SELECT COALESCE(SUM(amount) FILTER (WHERE section = 'asset'), 0)
       - COALESCE(SUM(amount) FILTER (WHERE section = 'liability_equity'), 0)
    FROM report_detail_lines(p_company_id, 'BS', '1900-01-01'::date, p_as_of);
$$ LANGUAGE sql STABLE SET search_path = duly, public, pg_temp;
