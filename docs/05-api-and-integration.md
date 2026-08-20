# 05 — API และการเชื่อมต่อภายนอก

## 1. หลักการ API

- REST + JSON, เวอร์ชันใน path: `/api/v1/...`
- Auth: OAuth2 (authorization code สำหรับผู้ใช้, client credentials สำหรับ machine-to-machine)
- ทุก request ต้องระบุบริษัท: header `X-Company-Id`
- **Idempotency-Key** บังคับสำหรับทุก POST ที่สร้างเอกสารการเงิน (กันสร้างซ้ำจากการ retry)
- Pagination แบบ cursor (`?cursor=...&limit=50`) — ไม่ใช้ offset กับตารางใหญ่
- Rate limit: 600 req/min ต่อ tenant, 60 req/min สำหรับ endpoint ที่สร้างเอกสาร
- Error format เดียวทั้งระบบ:
```json
{ "error": { "code": "PERIOD_CLOSED", "message": "งวดบัญชี 2569-01 ถูกปิดแล้ว",
             "message_en": "Accounting period 2026-01 is closed",
             "details": { "period": "2569-01" }, "request_id": "req_01H..." } }
```

## 2. Endpoint หลัก (ตัวอย่าง)

```
GET    /api/v1/accounts
POST   /api/v1/journal-entries              สร้าง draft
POST   /api/v1/journal-entries/{id}/post    ลงบัญชี
POST   /api/v1/journal-entries/{id}/reverse กลับรายการ

GET    /api/v1/customers
POST   /api/v1/sales-invoices
POST   /api/v1/sales-invoices/{id}/issue    ออกเลขที่ + ลงบัญชี + คิว e-Tax
POST   /api/v1/sales-invoices/{id}/void
GET    /api/v1/sales-invoices/{id}/pdf

POST   /api/v1/receipts                     รับชำระ + หัก WHT ที่ลูกค้าหักไว้
POST   /api/v1/vendor-bills
POST   /api/v1/payments                     จ่าย + สร้าง 50 ทวิ

GET    /api/v1/tax/vat-report?period=2569-01&type=output
POST   /api/v1/tax/filings                  สร้างแบบ ภ.พ.30 / ภ.ง.ด.3 / ภ.ง.ด.53
GET    /api/v1/tax/filings/{id}/export?format=rd_txt

GET    /api/v1/reports/trial-balance?from=...&to=...&dimensions=project:P001
GET    /api/v1/reports/balance-sheet?as_of=...&compare=prior_year
GET    /api/v1/reports/general-ledger?account=1140&from=...&to=...

POST   /api/v1/bank-statements/import
GET    /api/v1/bank-reconciliations/{id}/suggestions
```

## 3. Webhook

| Event | ใช้ทำอะไร |
|-------|-----------|
| `invoice.issued` / `invoice.paid` / `invoice.voided` | เชื่อม CRM, แจ้งเตือน LINE |
| `etax.accepted` / `etax.rejected` | ติดตามผลส่งกรมสรรพากร |
| `payment.created` | เชื่อมระบบอนุมัติจ่ายของธนาคาร |
| `period.closed` | ทริกเกอร์ระบบ BI ภายนอกให้ดึงข้อมูล |
| `budget.exceeded` | เตือนหัวหน้าแผนก |

ส่งแบบ HTTPS POST + ลายเซ็น HMAC-SHA256 ใน header `X-Duly-Signature`, retry แบบ exponential backoff 5 ครั้ง

## 4. การเชื่อมต่อกรมสรรพากร

### 4.1 e-Tax Invoice & e-Receipt
```
ตัวเลือก A (แนะนำสำหรับเฟสแรก): ผ่าน Service Provider ที่ได้รับอนุมัติจากกรมสรรพากร
   ข้อดี: เร็ว ไม่ต้องดูแล cert เอง มี SLA
   ข้อเสีย: ต้นทุนต่อใบ, พึ่งพาบุคคลที่สาม

ตัวเลือก B (เฟสหลัง): เชื่อมตรง
   ต้องมี: ใบรับรองอิเล็กทรอนิกส์จาก CA ที่รับรอง, HSM หรือ Cloud KMS สำหรับเก็บ private key,
   ความสามารถสร้าง XML ตามมาตรฐาน ขมธอ. 3-2560, ยื่นแบบ บ.อ.01
```
**สถาปัตยกรรมที่รองรับทั้งสองแบบ:** ทำ `EtaxProvider` interface แล้วมี adapter ต่อผู้ให้บริการ
เปลี่ยนได้โดยไม่แตะโค้ดโมดูลขาย

Flow:
```
issue invoice → build XML → sign → submit → poll/callback → update etax_status
                                    ↑
                      ถ้า reject: เก็บ error code, แจ้งผู้ใช้, ให้แก้แล้วส่งใหม่
```
**สำคัญ:** ใบกำกับภาษีต้องออกได้แม้ระบบ e-Tax ล่ม → บันทึกเป็น `pending` แล้วส่งย้อนหลังในคิว

### 4.2 ไฟล์นำส่งแบบภาษี
กรมสรรพากรรับไฟล์ text ผ่าน "โปรแกรมโอนย้ายข้อมูล" สำหรับ ภ.ง.ด.1/2/3/53
→ ระบบสร้างไฟล์ตาม layout ที่กำหนด (fixed-width/delimited) พร้อมไฟล์ตรวจสอบ

### 4.3 e-Withholding Tax
เชื่อมผ่านธนาคาร (ไม่ใช่กรมสรรพากรโดยตรง) — ส่งไฟล์/API คำสั่งจ่ายพร้อมข้อมูลภาษี
ธนาคารหักและนำส่งแทน แล้วส่งหลักฐานกลับ → ระบบ mark `remittance_channel = e_wht`

### 4.4 DBD e-Filing (XBRL)
สร้างไฟล์ตาม taxonomy ของ DBD → อัปโหลดที่ efiling.dbd.go.th
(ยังไม่มี public API — เฟสแรกทำแค่ export ไฟล์ให้ผู้ใช้อัปโหลดเอง)

## 5. การเชื่อมต่อธนาคาร

| ธนาคาร | ช่องทางที่มี | ใช้ทำอะไร |
|--------|--------------|-----------|
| SCB, KBank, BBL, KTB, TTB | Corporate API / Host-to-Host (ต้องทำสัญญา) | ดึง statement, สั่งโอน, e-WHT |
| ทุกธนาคาร | ไฟล์ statement (CSV/Excel/MT940) | นำเข้าเพื่อกระทบยอด |
| PromptPay | QR Tag 30 + Bill Payment | รับชำระพร้อมเลขอ้างอิงใบแจ้งหนี้ |

**เฟส 1 ทำแค่นำเข้าไฟล์** — ต้นทุนต่ำ ครอบคลุมทุกธนาคาร
**เฟส 3 ค่อยเชื่อม API** ตามลูกค้าที่ต้องการ

## 6. การเชื่อมต่ออื่นที่ควรมี

| ระบบ | เหตุผล |
|------|--------|
| อีเมล (SES/SendGrid) | ส่งใบแจ้งหนี้ ใบกำกับภาษี สลิปเงินเดือน |
| LINE Messaging API / LINE Notify | ตลาดไทยใช้ LINE เป็นหลัก — แจ้งอนุมัติ เตือนกำหนดชำระ |
| Google Sheets / Excel Add-in | นักบัญชีไทยทำงานบน Excel — ต้องดึงข้อมูลสดเข้า Excel ได้ |
| e-Commerce (Shopee/Lazada/Shopify) | ดึงยอดขายมาออกใบกำกับภาษีอัตโนมัติ |
| ระบบ POS | ร้านค้าปลีก |
| Payment Gateway (2C2P, Omise, GB Prime Pay) | รับชำระออนไลน์ + กระทบยอดค่าธรรมเนียม |
| ธนาคารแห่งประเทศไทย | อัตราแลกเปลี่ยนอ้างอิงรายวัน |

## 7. ความปลอดภัยของ API

- HTTPS/TLS 1.3 เท่านั้น, HSTS
- Scope ละเอียด: `invoices:read`, `invoices:write`, `reports:read`, `payroll:read` …
- Personal Access Token มีวันหมดอายุบังคับ (สูงสุด 1 ปี)
- IP allowlist ต่อ API client (ตัวเลือกสำหรับ Enterprise)
- ทุกการเรียกที่แก้ข้อมูลบันทึกลง `audit_event` พร้อม `request_id`
- ไม่ส่งข้อมูลอ่อนไหว (เลขบัตร ปชช., เงินเดือน) ใน response ที่ไม่มี scope ตรง
