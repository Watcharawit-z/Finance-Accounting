# 16 — อภิธานศัพท์ ไทย–อังกฤษ

ใช้เป็นมาตรฐานเดียวทั้งระบบ: UI, ชื่อฟิลด์ในฐานข้อมูล, เอกสาร, และการแปลภาษา
เมื่อมีคำใหม่ ต้องเพิ่มที่นี่ก่อนใช้ในโค้ด

## บัญชีทั่วไป

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| ผังบัญชี | Chart of Accounts | `account` |
| บัญชีแยกประเภททั่วไป | General Ledger | `journal_line` |
| สมุดรายวัน | Journal | `journal_entry` |
| รายการบัญชี / ใบสำคัญ | Journal Entry / Voucher | `journal_entry` |
| เดบิต | Debit | `debit` |
| เครดิต | Credit | `credit` |
| งบทดลอง | Trial Balance | `TB` |
| งวดบัญชี | Accounting Period | `accounting_period` |
| รอบระยะเวลาบัญชี | Fiscal Year / Accounting Period | `fiscal_year` |
| ปิดบัญชี | Close the books | `period.status = closed` |
| ยอดยกมา | Opening Balance | `journal_type = opening` |
| ยอดยกไป | Closing Balance | `closing_base` |
| กลับรายการ | Reverse / Reversal | `reversal_of_id` |
| รายการปรับปรุง | Adjusting Entry | `journal_type = adjustment` |
| มิติทางบัญชี | Accounting Dimension | `dimension_type` |
| ศูนย์ต้นทุน | Cost Center | `COST_CENTER` |
| บัญชีคุม | Control Account | — |
| บัญชีย่อย | Subsidiary Ledger | — |
| บัญชีพัก | Suspense Account | `sub_type = suspense` |

## งบการเงิน

| ไทย | English |
|-----|---------|
| งบการเงิน | Financial Statements |
| งบแสดงฐานะการเงิน (งบดุล) | Statement of Financial Position (Balance Sheet) |
| งบกำไรขาดทุน | Statement of Comprehensive Income / Income Statement |
| งบกระแสเงินสด | Statement of Cash Flows |
| งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น | Statement of Changes in Equity |
| หมายเหตุประกอบงบการเงิน | Notes to Financial Statements |
| สินทรัพย์ | Assets |
| สินทรัพย์หมุนเวียน | Current Assets |
| สินทรัพย์ไม่หมุนเวียน | Non-current Assets |
| หนี้สิน | Liabilities |
| ส่วนของผู้ถือหุ้น | Shareholders' Equity |
| รายได้ | Revenue |
| ค่าใช้จ่าย | Expenses |
| ต้นทุนขาย | Cost of Goods Sold |
| กำไรขั้นต้น | Gross Profit |
| กำไรสุทธิ | Net Profit |
| กำไรสะสม | Retained Earnings |
| สำรองตามกฎหมาย | Legal Reserve |

## ลูกหนี้และการขาย

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| ใบเสนอราคา | Quotation | `quotation` |
| ใบสั่งขาย | Sales Order | `sales_order` |
| ใบส่งของ | Delivery Note | `delivery_note` |
| ใบแจ้งหนี้ | Invoice | `sales_invoice` |
| ใบวางบิล | Billing Note | — |
| ใบกำกับภาษี | Tax Invoice | `is_tax_invoice` |
| ใบกำกับภาษีอย่างย่อ | Abbreviated Tax Invoice | `is_abbreviated` |
| ใบเสร็จรับเงิน | Receipt | `receipt` |
| ใบลดหนี้ | Credit Note | `credit_note` |
| ใบเพิ่มหนี้ | Debit Note | `debit_note` |
| ลูกหนี้การค้า | Trade Receivables | `trade_receivable` |
| อายุหนี้ | Aging | `aging_snapshot` |
| วงเงินเครดิต | Credit Limit | `credit_limit` |
| เงินมัดจำ | Deposit | `customer_deposit` |
| หนี้สงสัยจะสูญ | Doubtful Accounts | `bad_debt` |
| หนี้สูญ | Bad Debt | `bad_debt` |
| ค่าเผื่อผลขาดทุนด้านเครดิต | Expected Credit Loss Allowance | `ar_allowance` |
| ทวงหนี้ | Dunning / Collection | `dunning_log` |

## เจ้าหนี้และการจัดซื้อ

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| ใบขอซื้อ | Purchase Requisition | `purchase_request` |
| ใบสั่งซื้อ | Purchase Order | `purchase_order` |
| ใบรับสินค้า | Goods Receipt | `goods_receipt` |
| ตั้งหนี้ | Vendor Bill / Bill Entry | `vendor_bill` |
| ใบสำคัญจ่าย | Payment Voucher | `payment_voucher` |
| เจ้าหนี้การค้า | Trade Payables | `trade_payable` |
| พักรับสินค้า | Goods Received Not Invoiced | `grni` |
| เงินทดรองจ่าย | Advance | `employee_advance` |
| เงินสดย่อย | Petty Cash | `petty_cash_fund` |
| การจับคู่สามทาง | Three-way Match | `three_way_match` |

## ภาษี

| ไทย | English | หมายเหตุ |
|-----|---------|----------|
| ภาษีมูลค่าเพิ่ม | Value Added Tax (VAT) | |
| ภาษีขาย | Output VAT | ภาษีที่เก็บจากลูกค้า |
| ภาษีซื้อ | Input VAT | ภาษีที่จ่ายให้ผู้ขาย |
| ภาษีซื้อต้องห้าม | Non-claimable Input VAT | ขอคืนไม่ได้ |
| ภาษีหัก ณ ที่จ่าย | Withholding Tax (WHT) | |
| หนังสือรับรองการหักภาษี ณ ที่จ่าย | Withholding Tax Certificate | แบบ 50 ทวิ |
| ภาษีเงินได้นิติบุคคล | Corporate Income Tax (CIT) | |
| ภาษีเงินได้บุคคลธรรมดา | Personal Income Tax (PIT) | |
| ภาษีธุรกิจเฉพาะ | Specific Business Tax (SBT) | |
| อากรแสตมป์ | Stamp Duty | |
| เลขประจำตัวผู้เสียภาษี | Taxpayer Identification Number | 13 หลัก |
| สำนักงานใหญ่ | Head Office | รหัสสาขา 00000 |
| สาขา | Branch | |
| เบี้ยปรับ | Penalty | |
| เงินเพิ่ม | Surcharge | 1.5% ต่อเดือน |
| ประมาณการกำไรสุทธิ | Estimated Net Profit | ภ.ง.ด.51 |
| รายจ่ายต้องห้าม | Non-deductible Expenses | ม.65 ตรี |
| ผลขาดทุนสะสมยกมา | Loss Carried Forward | ไม่เกิน 5 รอบบัญชี |
| ใบกำกับภาษีอิเล็กทรอนิกส์ | e-Tax Invoice | |
| ภาษีหัก ณ ที่จ่ายอิเล็กทรอนิกส์ | e-Withholding Tax | |

## สินค้าและต้นทุน

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| สินค้าคงเหลือ | Inventory | `stock_balance` |
| วัตถุดิบ | Raw Materials | |
| งานระหว่างทำ | Work in Process | |
| สินค้าสำเร็จรูป | Finished Goods | |
| ถัวเฉลี่ยถ่วงน้ำหนัก | Weighted Average | `weighted_average` |
| เข้าก่อนออกก่อน | First-In First-Out (FIFO) | `fifo` |
| ต้นทุนมาตรฐาน | Standard Cost | `standard` |
| ตรวจนับสต๊อก | Stock Count / Physical Count | `stock_count` |
| ต้นทุนนำเข้า | Landed Cost | `landed_cost` |
| สูตรการผลิต | Bill of Materials (BOM) | `bom` |
| ใบสั่งผลิต | Production Order | `production_order` |
| มูลค่าสุทธิที่จะได้รับ | Net Realisable Value (NRV) | |

## สินทรัพย์ถาวร

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| ที่ดิน อาคารและอุปกรณ์ | Property, Plant and Equipment | `ppe` |
| ค่าเสื่อมราคา | Depreciation | `depreciation` |
| ค่าเสื่อมราคาสะสม | Accumulated Depreciation | `accum_depreciation` |
| ค่าตัดจำหน่าย | Amortization | `amortization` |
| มูลค่าตามบัญชี | Net Book Value | `book_net_value` |
| มูลค่าคงเหลือ | Salvage / Residual Value | `book_salvage_value` |
| อายุการใช้งาน | Useful Life | `useful_life_years` |
| วิธีเส้นตรง | Straight-line Method | `straight_line` |
| วิธียอดลดลง | Declining Balance Method | `declining_balance` |
| การด้อยค่า | Impairment | |
| การจำหน่ายทรัพย์สิน | Disposal | `asset_disposal` |
| งานระหว่างก่อสร้าง | Construction in Progress | `cip` |
| ทะเบียนทรัพย์สิน | Fixed Asset Register | `fixed_asset` |

## เงินเดือนและบุคคล

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| เงินเดือน | Salary / Payroll | `pay_run` |
| ค่าล่วงเวลา | Overtime | `ot_hours_*` |
| สลิปเงินเดือน | Payslip | `pay_slip` |
| ประกันสังคม | Social Security | `sso` |
| กองทุนสำรองเลี้ยงชีพ | Provident Fund | `pvd` |
| กองทุนเงินทดแทน | Workmen's Compensation Fund | `workmen_compensation` |
| ค่าชดเชย | Severance Pay | |
| ค่าลดหย่อน | Tax Allowance / Deduction | `pit_deduction_rule` |
| เงินได้พึงประเมิน | Assessable Income | |
| เงินได้สุทธิ | Net Taxable Income | |

## ธนาคาร

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| กระทบยอดธนาคาร | Bank Reconciliation | `bank_reconciliation` |
| รายการเดินบัญชี | Bank Statement | `bank_statement` |
| เช็ค | Cheque | `cheque` |
| เช็คลงวันที่ล่วงหน้า | Post-dated Cheque | |
| เช็คคืน | Bounced / Returned Cheque | `bounced` |
| เงินระหว่างทาง | Cash in Transit | `cash_in_transit` |
| รายการค้างจับคู่ | Outstanding Items | `unmatched` |

## ระบบและการควบคุม

| ไทย | English | ใช้ในระบบ |
|-----|---------|-----------|
| ร่องรอยการตรวจสอบ | Audit Trail | `audit_event` |
| การแยกหน้าที่ | Segregation of Duties | `SOD` |
| สายอนุมัติ | Approval Workflow | `approval_flow` |
| สิทธิ์การเข้าถึง | Access Control / Permissions | `role.permissions` |
| ผู้ทำบัญชี | Bookkeeper | `bookkeeper_cpd_no` |
| ผู้สอบบัญชีรับอนุญาต | Certified Public Accountant (CPA) | `auditor_cpa_no` |
| การเก็บรักษาเอกสาร | Document Retention | `retention_until` |
| คำขอใช้สิทธิของเจ้าของข้อมูล | Data Subject Request | `dsr_request` |

## คำที่มักแปลผิด — ต้องระวัง

| ✗ อย่าใช้ | ✓ ใช้คำนี้ | เหตุผล |
|-----------|-----------|--------|
| "บิล" | ใบแจ้งหนี้ / ใบกำกับภาษี | "บิล" กำกวมระหว่างเอกสารขายและซื้อ |
| "Invoice" สำหรับเอกสารซื้อ | Vendor Bill | ป้องกันสับสนกับใบแจ้งหนี้ที่เราออก |
| "ยกเลิก" สำหรับเอกสารที่ลงบัญชีแล้ว | ยกเลิก (void) พร้อมกลับรายการ | ต่างจาก cancel ที่ใช้กับฉบับร่าง |
| "ลบ" | ยกเลิก | ข้อมูลบัญชีไม่มีการลบ |
| "Balance Sheet" ในเอกสารทางการ | งบแสดงฐานะการเงิน | ชื่อตามมาตรฐานปัจจุบัน |
| "หัก ณ ที่จ่าย" เดี่ยว ๆ | ภาษีเงินได้หัก ณ ที่จ่าย | ให้ชัดว่าเป็นภาษี |
| "ปิดยอด" | ปิดงวด / ปิดบัญชี | |
