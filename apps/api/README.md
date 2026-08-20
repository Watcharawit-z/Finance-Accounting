# DULY API

NestJS + PostgreSQL (ใช้ SQL ตรง ไม่ผ่าน ORM) — สคีมาเป็นแหล่งความจริง ไม่ให้ ORM มากำหนดโครงสร้าง

## รัน

```bash
# 1. เตรียมฐานข้อมูล (ต้องมี PostgreSQL 16+ และสิทธิ์ superuser ครั้งแรก)
su postgres -c "cd ../.. && ./db/reset_dev.sh duly_dev"

# 2. รัน API
export DATABASE_URL='postgres://duly_app:duly_dev_only@127.0.0.1:5432/duly_dev'
npm install
npm run dev            # หรือ npm run build && npm start

curl localhost:3001/health
```

## ทดสอบ

```bash
npm test               # 52 assertions — สร้างฐานข้อมูลใหม่ก่อนรันทุกครั้ง
npm run typecheck
```

## หลักการที่ยึด

| หลักการ | ทำไม |
|---------|------|
| **เชื่อมฐานข้อมูลด้วย role `duly_app` ไม่ใช่ `postgres`** | superuser ข้าม Row Level Security ทั้งหมด ถ้าเชื่อมด้วย superuser ข้อมูลข้ามบริษัทจะรั่วโดยที่ policy ดูเหมือนทำงานอยู่ |
| **เงินเป็น `bigint` สเกล 4 ตำแหน่ง ไม่ใช่ `number`** | `0.1 + 0.2 !== 0.3` — ระบบบัญชีอธิบายผลต่างทุกสตางค์ไม่ได้ถ้าใช้ float |
| **`LedgerService.post()` เป็นประตูเดียวที่เขียนบัญชีแยกประเภท** | กติกาบัญชีถูกบังคับที่จุดเดียว แก้ที่เดียวเมื่อกฎเปลี่ยน |
| **VAT ปัดเศษที่ระดับเอกสาร** | ปัดทีละบรรทัดจะได้ตัวเลขต่างจากใบกำกับที่คู่ค้าออก |
| **อัตราภาษี lookup ด้วยวันที่ของเอกสาร** | แก้เอกสารย้อนหลังต้องไม่ทำให้ตัวเลขที่ยื่นภาษีไปแล้วเปลี่ยน |
| **แปลง error ของฐานข้อมูลที่ชั้น data access** | งาน background และการนำเข้าข้อมูลต้องได้ error แบบเดียวกับ HTTP |
| **ห้ามคืน `bigint` ออก response** | Express serialize ไม่ได้ ตอบ 500 ที่ผู้เรียกแก้อะไรไม่ได้ |

## Endpoint

```
GET  /health
GET  /api/v1/company                       ข้อมูลบริษัทและสาขา
GET  /api/v1/accounts                      ผังบัญชี
GET  /api/v1/partners?kind=customer        คู่ค้า
GET  /api/v1/periods                       งวดบัญชี

GET  /api/v1/sales-invoices?period=YYYY-MM
POST /api/v1/sales-invoices                สร้างฉบับร่าง
GET  /api/v1/sales-invoices/:id
POST /api/v1/sales-invoices/:id/issue      ★ ออกเลข + ลงบัญชี + ลงทะเบียนภาษี ใน transaction เดียว

GET  /api/v1/journal-entries?period=YYYY-MM
GET  /api/v1/journal-entries/:id
POST /api/v1/journal-entries
POST /api/v1/journal-entries/:id/reverse   ต้องระบุเหตุผล

GET  /api/v1/reports/trial-balance?from=&to=
GET  /api/v1/reports/vat?kind=vat_output&period=YYYY-MM
GET  /api/v1/reports/balance-sheet?as_of=
GET  /api/v1/reports/income-statement?from=&to=
GET  /api/v1/reports/reconciliation?as_of=
```

ทุกคำขอ (ยกเว้น `/health`) ต้องส่ง `X-Tenant-Id`, `X-Company-Id`, `X-User-Id`

> ⚠️ MVP อ่าน context จาก header ตรง ๆ **ระบบจริงต้องดึงจาก access token ที่ตรวจลายเซ็นแล้ว**
> และตรวจสิทธิ์ผู้ใช้ในบริษัทนั้นจากตาราง `user_company_role` ก่อนเสมอ

## รูปแบบข้อผิดพลาด

```json
{ "error": { "code": "TAX_ID_INVALID",
             "message": "เลขประจำตัวผู้เสียภาษีของผู้ซื้อ (0000000000000) ไม่ผ่านการตรวจสอบหลักที่ 13",
             "hint": "ตรวจสอบเลขกับหนังสือรับรองของลูกค้า",
             "field": "partner.tax_id",
             "request_id": "cd0f9d92-..." } }
```

รหัสทั้งหมดอยู่ใน [docs/14-document-states.md](../../docs/14-document-states.md)

## ยังไม่ได้ทำ (ตั้งใจ)

MVP นี้พิสูจน์ว่าสถาปัตยกรรมใช้งานได้จริง ยังขาด: การยืนยันตัวตนและ RBAC จริง,
ลูกหนี้ฝั่งรับชำระ, เจ้าหนี้และภาษีหัก ณ ที่จ่าย (มี service แล้วแต่ยังไม่มี endpoint),
สินค้าคงคลัง, ทรัพย์สินถาวร, เงินเดือน, e-Tax Invoice, การสร้างไฟล์นำส่งแบบภาษี, PDF
