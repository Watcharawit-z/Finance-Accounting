# 10 — ผังบัญชีมาตรฐาน (Chart of Accounts) ครบทั้ง 5 หมวด

## หลักการวางรหัส

```
โครงสร้าง 4 หลัก (ขยายเป็น 6–8 หลักได้ตามบริษัท)

  X   XX   X
  │   │    └─ บัญชีย่อย
  │   └────── กลุ่มบัญชี
  └────────── หมวดใหญ่ 1–5

หมวด 1 = สินทรัพย์            (Assets)
หมวด 2 = หนี้สิน              (Liabilities)
หมวด 3 = ส่วนของผู้ถือหุ้น     (Equity)
หมวด 4 = รายได้               (Revenue)
หมวด 5 = ค่าใช้จ่าย            (Expenses)
```

**สิ่งที่สำคัญกว่ารหัสบัญชี:** ทุกบัญชีต้องผูก `sub_type` ที่ระบบรู้จัก
เพราะลูกค้าแต่ละรายเปลี่ยนรหัสได้ตามใจ แต่ระบบต้องรู้ว่าบัญชีไหนคือ "ลูกหนี้การค้า" เพื่อสร้าง
งบการเงินและแบบภาษีอัตโนมัติ **ห้ามเขียนโค้ดที่อ้างอิงรหัสบัญชีตรง ๆ**

---

## หมวด 1 — สินทรัพย์ (Assets)

### 1100 สินทรัพย์หมุนเวียน

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 1110 | **เงินสดและรายการเทียบเท่าเงินสด** | Cash and Cash Equivalents | *(header)* |
| 1111 | เงินสดในมือ | Cash on Hand | `cash` |
| 1112 | เงินสดย่อย | Petty Cash | `cash` |
| 1113 | เงินฝากธนาคาร–ออมทรัพย์ | Bank – Savings | `bank` |
| 1114 | เงินฝากธนาคาร–กระแสรายวัน | Bank – Current | `bank` |
| 1115 | เงินฝากธนาคาร–ประจำ | Bank – Fixed Deposit | `bank` |
| 1116 | เงินฝากธนาคาร–สกุลต่างประเทศ | Bank – Foreign Currency | `bank` |
| 1117 | เงินระหว่างทาง | Cash in Transit | `cash_in_transit` |
| 1120 | **เงินลงทุนชั่วคราว** | Short-term Investments | `short_term_investment` |
| 1130 | **ลูกหนี้การค้า** | Trade Receivables | *(header)* |
| 1131 | ลูกหนี้การค้า–ในประเทศ | Trade AR – Domestic | `trade_receivable` |
| 1132 | ลูกหนี้การค้า–ต่างประเทศ | Trade AR – Overseas | `trade_receivable` |
| 1133 | ลูกหนี้การค้า–กิจการที่เกี่ยวข้องกัน | Trade AR – Related Parties | `trade_receivable_related` |
| 1134 | เช็ครับลงวันที่ล่วงหน้า | Post-dated Cheques Receivable | `trade_receivable` |
| 1139 | *ค่าเผื่อผลขาดทุนด้านเครดิต (หนี้สงสัยจะสูญ)* | Allowance for Expected Credit Loss | `ar_allowance` *(contra)* |
| 1140 | **ลูกหนี้อื่น** | Other Receivables | *(header)* |
| 1141 | เงินทดรองจ่าย | Advances to Employees | `other_receivable` |
| 1142 | ลูกหนี้กรรมการ/พนักงาน | Receivable – Directors/Employees | `other_receivable` |
| 1143 | รายได้ค้างรับ | Accrued Income | `accrued_income` |
| 1144 | เงินให้กู้ยืมระยะสั้น | Short-term Loans Receivable | `other_receivable` |
| 1150 | **สินค้าคงเหลือ** | Inventories | *(header)* |
| 1151 | วัตถุดิบ | Raw Materials | `inventory` |
| 1152 | งานระหว่างทำ | Work in Process | `inventory` |
| 1153 | สินค้าสำเร็จรูป | Finished Goods | `inventory` |
| 1154 | สินค้าซื้อมาเพื่อขาย | Merchandise Inventory | `inventory` |
| 1155 | วัสดุสิ้นเปลือง | Supplies | `inventory` |
| 1156 | สินค้าระหว่างทาง | Goods in Transit | `inventory` |
| 1159 | *ค่าเผื่อการลดมูลค่าสินค้า* | Allowance for Inventory Devaluation | `inventory_allowance` *(contra)* |
| 1160 | **สินทรัพย์ทางภาษี** | Tax Assets | *(header)* |
| 1161 | **ภาษีซื้อ** | Input VAT | `input_vat` ★ |
| 1162 | ภาษีซื้อรอเรียกคืน (ยังไม่ถึงกำหนด) | Deferred Input VAT | `deferred_input_vat` ★ |
| 1163 | ภาษีซื้อต้องห้าม (บันทึกเป็นค่าใช้จ่าย) | Non-claimable Input VAT | `non_claimable_vat` |
| 1164 | ภาษีมูลค่าเพิ่มรอขอคืน / เครดิตภาษียกไป | VAT Refundable / Carry Forward | `vat_receivable` ★ |
| 1165 | **ภาษีเงินได้ถูกหัก ณ ที่จ่าย** | Withholding Tax Deducted at Source | `wht_asset` ★ |
| 1166 | ภาษีเงินได้นิติบุคคลจ่ายล่วงหน้า (ภ.ง.ด.51) | Prepaid Corporate Income Tax | `prepaid_cit` |
| 1170 | **ค่าใช้จ่ายจ่ายล่วงหน้า** | Prepaid Expenses | *(header)* |
| 1171 | ค่าเช่าจ่ายล่วงหน้า | Prepaid Rent | `prepaid_expense` |
| 1172 | ค่าเบี้ยประกันจ่ายล่วงหน้า | Prepaid Insurance | `prepaid_expense` |
| 1173 | ค่าใช้จ่ายจ่ายล่วงหน้าอื่น | Other Prepaid Expenses | `prepaid_expense` |
| 1180 | เงินมัดจำและเงินประกันจ่าย | Deposits Paid | `deposit_paid` |

### 1200–1400 สินทรัพย์ไม่หมุนเวียน

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 1210 | เงินลงทุนระยะยาว | Long-term Investments | `long_term_investment` |
| 1220 | เงินลงทุนในบริษัทย่อย/ร่วม | Investment in Subsidiaries/Associates | `investment_subsidiary` |
| 1230 | เงินให้กู้ยืมระยะยาว | Long-term Loans Receivable | `long_term_receivable` |
| 1240 | อสังหาริมทรัพย์เพื่อการลงทุน | Investment Property | `investment_property` |
| 1300 | **ที่ดิน อาคารและอุปกรณ์** | Property, Plant and Equipment | *(header)* |
| 1301 | ที่ดิน | Land | `ppe_land` *(ไม่คิดค่าเสื่อม)* |
| 1302 | อาคารและสิ่งปลูกสร้าง | Buildings | `ppe` |
| 1303 | ส่วนปรับปรุงอาคารและสถานที่เช่า | Leasehold Improvements | `ppe` |
| 1304 | เครื่องจักรและอุปกรณ์ | Machinery and Equipment | `ppe` |
| 1305 | เครื่องใช้สำนักงานและอุปกรณ์ | Office Equipment | `ppe` |
| 1306 | คอมพิวเตอร์และอุปกรณ์ | Computer Equipment | `ppe` |
| 1307 | ยานพาหนะ | Vehicles | `ppe` |
| 1308 | เครื่องตกแต่งและติดตั้ง | Furniture and Fixtures | `ppe` |
| 1309 | งานระหว่างก่อสร้าง | Construction in Progress | `cip` *(ไม่คิดค่าเสื่อม)* |
| 1310–1318 | *ค่าเสื่อมราคาสะสม–(แต่ละประเภท)* | Accumulated Depreciation | `accum_depreciation` *(contra)* |
| 1400 | **สินทรัพย์ไม่มีตัวตน** | Intangible Assets | *(header)* |
| 1401 | โปรแกรมคอมพิวเตอร์ | Computer Software | `intangible` |
| 1402 | ค่าลิขสิทธิ์/สิทธิบัตร | Licenses and Patents | `intangible` |
| 1403 | ค่าความนิยม | Goodwill | `goodwill` |
| 1409 | *ค่าตัดจำหน่ายสะสม* | Accumulated Amortization | `accum_amortization` *(contra)* |
| 1500 | สินทรัพย์สิทธิการใช้ (สัญญาเช่า) | Right-of-use Assets | `rou_asset` |
| 1600 | สินทรัพย์ภาษีเงินได้รอการตัดบัญชี | Deferred Tax Assets | `deferred_tax_asset` |
| 1700 | สินทรัพย์ไม่หมุนเวียนอื่น | Other Non-current Assets | `other_asset` |

---

## หมวด 2 — หนี้สิน (Liabilities)

### 2100 หนี้สินหมุนเวียน

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 2110 | เงินเบิกเกินบัญชีธนาคาร | Bank Overdrafts | `bank_overdraft` |
| 2111 | เงินกู้ยืมระยะสั้นจากสถาบันการเงิน | Short-term Loans from FIs | `short_term_loan` |
| 2112 | ตั๋วเงินจ่าย | Notes Payable | `notes_payable` |
| 2120 | **เจ้าหนี้การค้า** | Trade Payables | *(header)* |
| 2121 | เจ้าหนี้การค้า–ในประเทศ | Trade AP – Domestic | `trade_payable` |
| 2122 | เจ้าหนี้การค้า–ต่างประเทศ | Trade AP – Overseas | `trade_payable` |
| 2123 | เจ้าหนี้การค้า–กิจการที่เกี่ยวข้องกัน | Trade AP – Related Parties | `trade_payable_related` |
| 2124 | เช็คจ่ายลงวันที่ล่วงหน้า | Post-dated Cheques Payable | `trade_payable` |
| 2125 | พักรับสินค้า (รับของแล้วยังไม่ได้ใบกำกับ) | Goods Received Not Invoiced | `grni` |
| 2130 | **เจ้าหนี้อื่นและค่าใช้จ่ายค้างจ่าย** | Other Payables and Accruals | *(header)* |
| 2131 | ค่าใช้จ่ายค้างจ่าย | Accrued Expenses | `accrued_expense` |
| 2132 | เงินเดือนค้างจ่าย | Accrued Salaries | `accrued_payroll` |
| 2133 | โบนัสค้างจ่าย | Accrued Bonus | `accrued_payroll` |
| 2134 | ดอกเบี้ยค้างจ่าย | Accrued Interest | `accrued_expense` |
| 2135 | เจ้าหนี้กรรมการ | Payable – Directors | `other_payable` |
| 2140 | **หนี้สินทางภาษี** | Tax Liabilities | *(header)* |
| 2141 | **ภาษีขาย** | Output VAT | `output_vat` ★ |
| 2142 | ภาษีขายรอเรียกเก็บ (ยังไม่ถึงกำหนด) | Deferred Output VAT | `deferred_output_vat` ★ |
| 2143 | ภาษีมูลค่าเพิ่มค้างชำระ | VAT Payable | `vat_payable` ★ |
| 2144 | **ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.1** | WHT Payable – PND1 | `wht_payable` ★ |
| 2145 | ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.3 | WHT Payable – PND3 | `wht_payable` ★ |
| 2146 | ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.53 | WHT Payable – PND53 | `wht_payable` ★ |
| 2147 | ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.54 | WHT Payable – PND54 | `wht_payable` ★ |
| 2148 | ภาษีเงินได้นิติบุคคลค้างจ่าย | Corporate Income Tax Payable | `cit_payable` |
| 2149 | ภาษีธุรกิจเฉพาะ/อากรแสตมป์ค้างจ่าย | SBT / Stamp Duty Payable | `other_tax_payable` |
| 2150 | **หนี้สินด้านบุคลากร** | Employee-related Liabilities | *(header)* |
| 2151 | เงินสมทบประกันสังคมค้างนำส่ง | Social Security Payable | `sso_payable` ★ |
| 2152 | เงินกองทุนสำรองเลี้ยงชีพค้างนำส่ง | Provident Fund Payable | `pvd_payable` |
| 2153 | เงินหักอื่นจากพนักงานค้างนำส่ง | Other Employee Deductions | `other_payable` |
| 2160 | **เงินรับล่วงหน้า** | Advances Received | *(header)* |
| 2161 | เงินมัดจำรับจากลูกค้า | Customer Deposits | `customer_deposit` |
| 2162 | รายได้รับล่วงหน้า | Unearned Revenue | `unearned_revenue` |
| 2163 | เงินประกันผลงานรับ (Retention) | Retention Payable | `retention_payable` |
| 2170 | ส่วนของหนี้สินระยะยาวที่ถึงกำหนดชำระใน 1 ปี | Current Portion of LT Debt | `current_portion_ltd` |
| 2180 | หนี้สินตามสัญญาเช่าที่ถึงกำหนดใน 1 ปี | Current Lease Liabilities | `lease_liability_current` |

### 2200 หนี้สินไม่หมุนเวียน

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 2210 | เงินกู้ยืมระยะยาวจากสถาบันการเงิน | Long-term Loans | `long_term_loan` |
| 2220 | เงินกู้ยืมจากกรรมการ/บุคคลที่เกี่ยวข้อง | Loans from Directors/Related Parties | `related_party_loan` |
| 2230 | หนี้สินตามสัญญาเช่า–ระยะยาว | Lease Liabilities – Non-current | `lease_liability` |
| 2240 | **ประมาณการหนี้สินผลประโยชน์พนักงาน** | Employee Benefit Obligations | `employee_benefit_obligation` |
| 2250 | ประมาณการหนี้สินอื่น | Other Provisions | `provision` |
| 2260 | หนี้สินภาษีเงินได้รอการตัดบัญชี | Deferred Tax Liabilities | `deferred_tax_liability` |

---

## หมวด 3 — ส่วนของผู้ถือหุ้น (Equity)

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 3110 | ทุนจดทะเบียน | Authorized Share Capital | `authorized_capital` *(memo)* |
| 3120 | ทุนที่ออกและชำระแล้ว | Issued and Paid-up Share Capital | `paid_up_capital` |
| 3130 | ส่วนเกิน (ต่ำกว่า) มูลค่าหุ้น | Share Premium (Discount) | `share_premium` |
| 3140 | เงินรับล่วงหน้าค่าหุ้น | Share Subscription Received in Advance | `share_subscription` |
| 3210 | **สำรองตามกฎหมาย** | Legal Reserve | `legal_reserve` |
| 3220 | สำรองอื่น | Other Reserves | `other_reserve` |
| 3230 | ส่วนเกินทุนจากการตีราคาสินทรัพย์ | Revaluation Surplus | `revaluation_surplus` |
| 3310 | **กำไร (ขาดทุน) สะสมยังไม่ได้จัดสรร** | Retained Earnings (Unappropriated) | `retained_earnings` ★ |
| 3320 | กำไร (ขาดทุน) สุทธิสำหรับงวด | Current Year Profit (Loss) | `current_year_earnings` ★ |
| 3330 | *เงินปันผลจ่าย* | Dividends Paid | `dividend` *(contra)* |
| 3340 | ผลสะสมจากการแก้ไขข้อผิดพลาด/เปลี่ยนนโยบายบัญชี | Prior Period Adjustments | `prior_period_adjustment` |
| 3400 | ส่วนได้เสียที่ไม่มีอำนาจควบคุม *(งบรวม)* | Non-controlling Interests | `nci` |

> **สำรองตามกฎหมาย:** ป.พ.พ. กำหนดให้บริษัทจำกัดจัดสรรกำไรสุทธิเป็นทุนสำรองอย่างน้อย 5%
> ของกำไรสุทธิประจำปี จนกว่าทุนสำรองจะถึง 10% ของทุนจดทะเบียน
> → ระบบต้องคำนวณและเตือนตอนปิดปี

---

## หมวด 4 — รายได้ (Revenue)

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 4110 | **รายได้จากการขายสินค้า** | Sales Revenue | *(header)* |
| 4111 | รายได้จากการขาย–ในประเทศ | Sales – Domestic | `sales_revenue` |
| 4112 | รายได้จากการขาย–ส่งออก (VAT 0%) | Sales – Export | `sales_revenue_export` |
| 4113 | รายได้จากการขาย–กิจการที่เกี่ยวข้องกัน | Sales – Related Parties | `sales_revenue_related` |
| 4120 | **รายได้จากการให้บริการ** | Service Revenue | *(header)* |
| 4121 | รายได้ค่าบริการ | Service Income | `service_revenue` |
| 4122 | รายได้ค่ารับเหมา/งานตามสัญญา | Contract Revenue | `contract_revenue` |
| 4123 | รายได้ค่าเช่า | Rental Income | `rental_revenue` |
| 4124 | รายได้ค่านายหน้า/คอมมิชชั่น | Commission Income | `commission_revenue` |
| 4130 | *รับคืนสินค้า* | Sales Returns | `sales_return` *(contra)* |
| 4131 | *ส่วนลดจ่าย* | Sales Discounts | `sales_discount` *(contra)* |
| 4132 | *ส่วนลดรับล่วงหน้า/ส่งเสริมการขาย* | Rebates and Allowances | `sales_discount` *(contra)* |
| 4200 | **รายได้อื่น** | Other Income | *(header)* |
| 4210 | ดอกเบี้ยรับ | Interest Income | `interest_income` |
| 4220 | เงินปันผลรับ | Dividend Income | `dividend_income` |
| 4230 | กำไรจากอัตราแลกเปลี่ยน | Gain on Foreign Exchange | `fx_gain` |
| 4240 | กำไรจากการจำหน่ายสินทรัพย์ | Gain on Disposal of Assets | `gain_on_disposal` |
| 4250 | หนี้สูญได้รับคืน | Bad Debt Recovery | `bad_debt_recovery` |
| 4260 | รายได้เบ็ดเตล็ด | Miscellaneous Income | `other_income` |
| 4270 | กำไรจากการปรับมูลค่าสินทรัพย์ | Gain on Revaluation | `other_income` |

---

## หมวด 5 — ค่าใช้จ่าย (Expenses)

### 5100 ต้นทุนขายและต้นทุนบริการ

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 5110 | ต้นทุนขายสินค้า | Cost of Goods Sold | `cogs` ★ |
| 5111 | ซื้อสินค้า | Purchases | `purchases` |
| 5112 | *ส่งคืนสินค้า / ส่วนลดรับ* | Purchase Returns and Discounts | `purchase_return` *(contra)* |
| 5113 | ค่าขนส่งเข้า | Freight In | `cogs` |
| 5114 | อากรขาเข้าและค่าใช้จ่ายนำเข้า | Import Duty and Charges | `cogs` |
| 5120 | ต้นทุนการให้บริการ | Cost of Services | `cost_of_service` |
| 5130 | **ต้นทุนการผลิต** | Manufacturing Costs | *(header)* |
| 5131 | วัตถุดิบใช้ไป | Raw Materials Used | `manufacturing_cost` |
| 5132 | ค่าแรงงานทางตรง | Direct Labor | `manufacturing_cost` |
| 5133 | ค่าใช้จ่ายการผลิต (โสหุ้ย) | Manufacturing Overhead | `manufacturing_cost` |
| 5134 | ผลต่างต้นทุนมาตรฐาน | Standard Cost Variance | `cost_variance` |
| 5140 | ผลขาดทุนจากสินค้าเสื่อมสภาพ/สูญหาย | Inventory Write-off | `inventory_writeoff` |

### 5200 ค่าใช้จ่ายในการขาย

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 5210 | เงินเดือนและค่าจ้าง–ฝ่ายขาย | Salaries – Sales | `selling_expense` |
| 5211 | ค่าคอมมิชชั่นการขาย | Sales Commission | `selling_expense` |
| 5220 | ค่าโฆษณาและส่งเสริมการขาย | Advertising and Promotion | `selling_expense` |
| 5230 | ค่าขนส่งออก | Freight Out | `selling_expense` |
| 5240 | ค่าใช้จ่ายในการเดินทาง–ฝ่ายขาย | Travelling – Sales | `selling_expense` |
| 5250 | ค่ารับรอง | Entertainment Expense | `selling_expense` *(มีเพดานทางภาษี 0.3% ของรายได้ หรือทุนชำระแล้ว สูงสุด 10 ลบ.)* |
| 5260 | ค่าใช้จ่ายในการขายอื่น | Other Selling Expenses | `selling_expense` |

### 5300 ค่าใช้จ่ายในการบริหาร

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 5310 | **เงินเดือนและผลตอบแทนพนักงาน** | Salaries and Employee Benefits | *(header)* |
| 5311 | เงินเดือนและค่าจ้าง | Salaries and Wages | `admin_expense` |
| 5312 | ค่าล่วงเวลา | Overtime | `admin_expense` |
| 5313 | โบนัสและเงินรางวัล | Bonus | `admin_expense` |
| 5314 | ค่าตอบแทนกรรมการ | Directors' Remuneration | `admin_expense` |
| 5315 | เงินสมทบประกันสังคม–ส่วนนายจ้าง | SSO Contribution – Employer | `admin_expense` |
| 5316 | เงินสมทบกองทุนสำรองเลี้ยงชีพ–ส่วนนายจ้าง | Provident Fund – Employer | `admin_expense` |
| 5317 | สวัสดิการพนักงาน | Employee Welfare | `admin_expense` |
| 5320 | **ค่าใช้จ่ายสำนักงาน** | Office Expenses | *(header)* |
| 5321 | ค่าเช่าสำนักงาน | Office Rent | `admin_expense` |
| 5322 | ค่าสาธารณูปโภค (ไฟฟ้า ประปา) | Utilities | `admin_expense` |
| 5323 | ค่าโทรศัพท์และอินเทอร์เน็ต | Telephone and Internet | `admin_expense` |
| 5324 | ค่าวัสดุสิ้นเปลืองสำนักงาน | Office Supplies | `admin_expense` |
| 5325 | ค่าซ่อมแซมและบำรุงรักษา | Repairs and Maintenance | `admin_expense` |
| 5326 | ค่าเบี้ยประกันภัย | Insurance | `admin_expense` |
| 5327 | ค่าน้ำมันเชื้อเพลิงและยานพาหนะ | Fuel and Vehicle Expenses | `admin_expense` |
| 5330 | **ค่าบริการวิชาชีพ** | Professional Fees | *(header)* |
| 5331 | ค่าสอบบัญชี | Audit Fee | `admin_expense` |
| 5332 | ค่าทำบัญชี | Bookkeeping Fee | `admin_expense` |
| 5333 | ค่าที่ปรึกษากฎหมายและภาษี | Legal and Tax Advisory | `admin_expense` |
| 5334 | ค่าธรรมเนียมวิชาชีพอื่น | Other Professional Fees | `admin_expense` |
| 5340 | **ค่าเสื่อมราคาและค่าตัดจำหน่าย** | Depreciation and Amortization | *(header)* |
| 5341 | ค่าเสื่อมราคา | Depreciation | `depreciation` ★ |
| 5342 | ค่าตัดจำหน่ายสินทรัพย์ไม่มีตัวตน | Amortization | `amortization` ★ |
| 5350 | **ค่าใช้จ่ายอื่นในการบริหาร** | Other Administrative Expenses | *(header)* |
| 5351 | หนี้สงสัยจะสูญ / หนี้สูญ | Doubtful Accounts / Bad Debts | `bad_debt` |
| 5352 | ขาดทุนจากอัตราแลกเปลี่ยน | Loss on Foreign Exchange | `fx_loss` |
| 5353 | ขาดทุนจากการจำหน่ายสินทรัพย์ | Loss on Disposal of Assets | `loss_on_disposal` |
| 5354 | ภาษีซื้อต้องห้าม | Non-claimable Input VAT | `non_claimable_vat_expense` |
| 5355 | ค่าธรรมเนียมและภาษีอากรอื่น | Fees, Duties and Other Taxes | `admin_expense` |
| 5356 | เงินบริจาค | Donations | `donation` *(เพดานทางภาษี 2% ของกำไรสุทธิ)* |
| 5357 | ค่าใช้จ่ายฝึกอบรม | Training Expenses | `admin_expense` |
| 5358 | ค่าใช้จ่ายเบ็ดเตล็ด | Miscellaneous Expenses | `admin_expense` |
| 5359 | รายจ่ายต้องห้ามทางภาษี | Non-deductible Expenses | `non_deductible` ★ |

### 5400–5500 ต้นทุนทางการเงินและภาษี

| รหัส | ชื่อบัญชี | Account Name | sub_type |
|------|-----------|--------------|----------|
| 5410 | ดอกเบี้ยจ่าย | Interest Expense | `finance_cost` |
| 5420 | ค่าธรรมเนียมธนาคาร | Bank Charges | `finance_cost` |
| 5430 | ค่าธรรมเนียมทางการเงินอื่น | Other Finance Costs | `finance_cost` |
| 5510 | **ภาษีเงินได้นิติบุคคล** | Corporate Income Tax Expense | `income_tax_expense` ★ |
| 5520 | ภาษีเงินได้รอการตัดบัญชี | Deferred Tax Expense | `deferred_tax_expense` |

---

## บัญชีพิเศษที่ระบบต้องมี (System Accounts)

| รหัสแนะนำ | บัญชี | ใช้ทำอะไร |
|-----------|-------|-----------|
| 9910 | บัญชีพัก–รายการที่ยังไม่ระบุ | Suspense Account | รายการธนาคารที่ยังไม่รู้ว่าเป็นอะไร (**ต้องเป็นศูนย์ก่อนปิดงบ**) |
| 9920 | ผลต่างจากการปัดเศษ | Rounding Difference | เศษสตางค์จากการคำนวณ VAT |
| 9930 | บัญชีปรับปรุงยอดยกมา | Opening Balance Equity | ใช้ตอนนำเข้ายอดยกมาเท่านั้น (ต้องเป็นศูนย์หลังนำเข้าเสร็จ) |
| 9940 | บัญชีระหว่างกัน (Intercompany) | Intercompany Clearing | ตัดกันตอนทำงบรวม |

> ระบบต้องมี **รายงานตรวจสุขภาพผังบัญชี**: บัญชีพักไม่เป็นศูนย์, บัญชีที่ไม่เคยใช้เกิน 2 ปี,
> บัญชีที่มียอดผิดด้าน (เช่น ลูกหนี้ยอดเครดิต), บัญชีที่ไม่ได้ผูก `sub_type`

---

## แม่แบบผังบัญชีที่ต้องมีให้เลือกตอนเปิดบริษัทใหม่

1. **ธุรกิจบริการ** — ไม่มีสินค้าคงเหลือ ไม่มีต้นทุนขาย ใช้ต้นทุนบริการแทน
2. **ซื้อมาขายไป (Trading)** — เต็มรูปตามผังข้างบน
3. **ผลิต (Manufacturing)** — เพิ่มกลุ่ม 5130 และบัญชีสินค้าคงเหลือ 3 ระดับ
4. **รับเหมาก่อสร้าง** — เพิ่มงานระหว่างทำตามสัญญา, รายได้ที่ยังไม่เรียกเก็บ, เงินประกันผลงาน
5. **อสังหาริมทรัพย์** — เพิ่มต้นทุนโครงการ, ที่ดินรอการพัฒนา, ภาษีธุรกิจเฉพาะ

---

## หมายเหตุการแปลงเป็นงบการเงิน

| งบ | สร้างจาก |
|-----|----------|
| งบแสดงฐานะการเงิน | หมวด 1, 2, 3 (ยอดสะสม ณ วันที่) |
| งบกำไรขาดทุน | หมวด 4, 5 (ยอดเคลื่อนไหวในงวด) |
| งบกระแสเงินสด (ทางอ้อม) | กำไรสุทธิ + รายการที่ไม่ใช่เงินสด (`depreciation`, `bad_debt`, `provision`) ± การเปลี่ยนแปลงเงินทุนหมุนเวียน |
| งบแสดงการเปลี่ยนแปลงส่วนของผู้ถือหุ้น | หมวด 3 (ยอดต้นงวด + การเคลื่อนไหว) |

**การปิดบัญชีสิ้นปี:** ปิดหมวด 4 และ 5 ทั้งหมดเข้า `3320 กำไรสุทธิสำหรับงวด`
→ โอนเข้า `3310 กำไรสะสม` → จัดสรรสำรองตามกฎหมาย 5% → ยอดคงเหลือรอจัดสรร
