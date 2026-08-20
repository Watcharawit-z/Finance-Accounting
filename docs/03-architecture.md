# 03 — สถาปัตยกรรมระบบ

## 1. หลักการตัดสินใจ

| หลักการ | เหตุผล |
|---------|--------|
| **Modular monolith ก่อน ไม่ใช่ microservices** | ทีมเล็ก, transaction ทางบัญชีต้อง ACID ข้ามโมดูล (invoice + JE + stock ต้อง commit พร้อมกัน) แยก service เมื่อจำเป็นจริงเท่านั้น |
| **PostgreSQL เป็นแหล่งความจริงเดียว** | ต้องการ constraint, transaction, numeric ที่แม่นยำ, row-level security สำหรับ multi-tenant |
| **Event log ตั้งแต่วันแรก** | เป็นทั้ง audit trail ตามกฎหมาย และเป็นเชื้อเพลิงของ AI Layer ในเฟสหลัง |
| **แยก service เฉพาะที่มีเหตุผลชัด** | (1) การลงลายมือชื่อดิจิทัล — key ต้องแยก (2) การสร้าง PDF/รายงานหนัก (3) งาน background |
| **โฮสต์ในไทย** | ลดความกังวลเรื่อง PDPA/ข้อมูลข้ามพรมแดน + latency (AWS ap-southeast-7 Bangkok หรือ GCP asia-southeast1) |

## 2. Tech Stack ที่แนะนำ

```
Frontend    React 19 + TypeScript + Vite
            TanStack Query (server state) + TanStack Table (ตารางข้อมูลหนัก ๆ)
            Tailwind CSS + Radix UI primitives (ควบคุมดีไซน์เองเต็มที่ ไม่ติด look ของ UI kit)
            AG Grid Community เฉพาะหน้าคีย์ข้อมูลแบบ Excel-like

Backend     Node.js 22 + TypeScript + NestJS   (ทีมไทยหาคนง่าย, DI/module ชัด)
            หรือ Go + Echo ถ้าเน้น performance และทีมถนัด Go
            Prisma หรือ Drizzle ORM + raw SQL สำหรับรายงาน

Database    PostgreSQL 17  — schema-per-tenant สำหรับลูกค้าใหญ่, shared schema + RLS สำหรับ SME
            Redis          — cache, queue, rate limit, session
            S3-compatible  — ไฟล์แนบ, PDF, XML e-Tax (object lock/WORM สำหรับเอกสารตามกฎหมาย)

Async       BullMQ (Redis) — คิวงาน: สร้าง PDF, ส่ง e-Tax, นำเข้า statement, ส่งอีเมล, ปิดงวด
Search      PostgreSQL FTS ก่อน → OpenSearch เมื่อข้อมูลเกิน ~50 ล้านแถว
Observability  OpenTelemetry + Grafana/Loki/Tempo, Sentry
Auth        OAuth2/OIDC (Keycloak หรือ Auth0) + MFA
```

**เหตุผลที่ไม่เลือกบางอย่าง**
- ไม่ใช้ MongoDB — งานบัญชีเป็น relational แท้ ๆ และต้องการ constraint ระดับ DB
- ไม่ใช้ `float`/`double` กับเงิน — ใช้ `NUMERIC(19,4)` เท่านั้น
- ไม่ใช้ event sourcing เต็มรูป — ซับซ้อนเกินความจำเป็น ใช้ append-only audit log แทน

## 3. โครงสร้าง Module ภายใน (Modular Monolith)

```
apps/
  api/                     NestJS application
  web/                     React SPA
  worker/                  BullMQ consumers
  signer/                  แยกออก: e-Tax XML signing (เข้าถึง HSM/Cert เท่านั้น)

packages/
  core-ledger/             ★ หัวใจ — Account, JournalEntry, Period, Posting rules
  core-tax/                ★ Tax code, VAT, WHT, การคำนวณ, การสร้างแบบยื่น
  ar/                      Customer, Quotation, SalesOrder, Invoice, Receipt, CN/DN
  ap/                      Vendor, PR/PO/GR, Bill, Payment
  banking/                 BankAccount, Statement, Reconciliation
  inventory/               Item, Warehouse, StockMove, Costing
  fixed-assets/            Asset, Depreciation
  payroll/                 Employee, PayRun, SSO, PIT
  projects/                Project, JobCost
  budgeting/               Budget, Forecast
  reporting/               Report engine, Financial statements
  documents/               Attachment, Approval workflow
  platform/                Tenant, User, RBAC, AuditLog, Settings, Numbering
  ai/                      (เฟส 4) Insight engine, MCP tools
```

**กฎการพึ่งพา (บังคับด้วย ESLint / dependency-cruiser)**
```
ar, ap, banking, inventory, fixed-assets, payroll, projects
        │
        └──► core-ledger, core-tax, platform   (พึ่งพาลงล่างได้ทางเดียว)

core-ledger ห้าม import โมดูลใด ๆ ข้างบน  ← ป้องกัน logic บัญชีปนกับ logic เอกสาร
reporting อ่านได้ทุกโมดูล แต่เขียนไม่ได้
```

## 4. รูปแบบการลงบัญชี (Posting Architecture)

**หลักการ:** ไม่มีโมดูลไหนเขียน `journal_line` เอง ทุกอย่างผ่าน `LedgerService.post()`

```
Document (Invoice/Bill/Payment/StockMove/PayRun)
        │
        │ 1. สร้าง PostingRequest { docType, docId, date, lines[], dimensions }
        ▼
PostingRuleEngine  ← อ่านกติกาจากตาราง posting_rule (config ไม่ใช่โค้ด)
        │           ตัดสินว่าเดบิต/เครดิตบัญชีไหน จากผังบัญชีที่ผูกไว้กับ
        │           สินค้า/ลูกค้า/ผู้ขาย/กลุ่มภาษี/คลัง
        ▼
LedgerService.post()
        ├─ ตรวจงวดเปิดอยู่หรือไม่
        ├─ ตรวจ debit = credit (ทุกสกุลเงิน)
        ├─ ตรวจบัญชีมีอยู่และเป็น postable (ไม่ใช่บัญชีหัวข้อ)
        ├─ INSERT journal_entry + journal_line (ใน transaction เดียวกับเอกสาร)
        └─ INSERT audit_event + emit domain event
```

ประโยชน์: เปลี่ยนผังบัญชีหรือกติกาลงบัญชีของลูกค้าแต่ละรายได้โดยไม่แก้โค้ด และทดสอบ posting rule แยกได้

## 5. Multi-tenancy

| ระดับ | วิธี | เหมาะกับ |
|-------|------|----------|
| Shared schema + RLS | ทุกตารางมี `tenant_id`, เปิด PostgreSQL Row Level Security, ตั้ง `SET app.tenant_id` ต่อ connection | ลูกค้า SME ส่วนใหญ่ |
| Schema per tenant | `tenant_00123.journal_entry` | ลูกค้าใหญ่ที่ต้องการแยกจริง |
| Database per tenant | คนละ instance | Enterprise / ข้อกำหนดพิเศษ |

โครงสร้างองค์กรภายใน tenant:
```
Tenant (บัญชีผู้ใช้บริการ / สำนักงานบัญชี)
  └── Company (นิติบุคคล — มีเลขผู้เสียภาษี, รอบบัญชี, ผังบัญชีของตัวเอง)
        └── Branch (สำนักงานใหญ่ / สาขา 00001 — สำคัญมากสำหรับ VAT)
```
> รายงานภาษีซื้อ/ขายต้องแยกตามสาขา และใบกำกับภาษีต้องระบุสาขา → `branch_id` เป็น NOT NULL ในเอกสารภาษี

## 6. หมายเลขเอกสาร (Document Numbering)

```
รูปแบบ: {prefix}{yy}{mm}-{running}      เช่น  INV2601-00042
เก็บใน document_sequence (company_id, branch_id, doc_type, period, next_no)
ออกเลขด้วย SELECT ... FOR UPDATE หรือ PostgreSQL sequence ต่อชุด
```
กติกา: จองเลข **ตอน post เท่านั้น** ไม่ใช่ตอนสร้าง draft (กันเลขขาดช่วง),
ยกเลิกเอกสาร = สถานะ `void` แต่เลขยังอยู่ในระบบ (กฎหมายต้องการเลขต่อเนื่อง)

## 7. งวดบัญชีและการล็อก

```
สถานะงวด: open → soft_closed (ปิดชั่วคราว เฉพาะ role สูงแก้ได้) → closed → tax_filed (ล็อกถาวร)
```
- ล็อกแยกตามโมดูลได้ (เช่น ปิด AR/AP แล้ว แต่ GL ยังเปิดให้ปรับปรุง)
- มี "วันที่ล็อกแข็ง" (hard lock date) ระดับบริษัท — ห้ามลงรายการก่อนวันนี้เด็ดขาด

## 8. การ Deploy

```
                       Cloudflare (WAF, CDN, DDoS)
                              │
                    ┌─────────┴─────────┐
                    │   Load Balancer   │
                    └─────────┬─────────┘
              ┌───────────────┼───────────────┐
         api (x3)        web (static)     worker (x2)
              │                                │
      ┌───────┴────────┬───────────┬──────────┴──────┐
  PostgreSQL       Redis       S3/MinIO        signer (isolated VPC,
  (primary +                   (Object Lock)    ไม่มี inbound จาก internet)
   replica)
```

**สภาพแวดล้อม:** `dev` → `staging` (ข้อมูลปลอม) → `sandbox` (ให้ลูกค้าทดลอง) → `production`

**Backup / DR**
- PostgreSQL: WAL archiving + PITR, full backup รายวัน เก็บ 35 วัน + รายเดือนเก็บ 7 ปี
- ทดสอบกู้คืนจริงทุกไตรมาส (บันทึกผลไว้เป็นหลักฐานให้ผู้สอบบัญชี)
- RPO ≤ 15 นาที, RTO ≤ 4 ชั่วโมง

## 9. ประสิทธิภาพ

| จุดที่จะช้า | วิธีแก้ |
|-------------|---------|
| งบทดลอง/รายงานการเงินย้อนหลัง | ตาราง `gl_balance_monthly` (materialized) อัปเดตตอน post + rebuild ได้ |
| รายงานภาษีซื้อ/ขายเดือนละหลายหมื่นแถว | index `(company_id, branch_id, tax_period, doc_date)` + partition รายปี |
| `journal_line` โตเร็วที่สุดในระบบ | partition by range ตาม `posting_date` รายปี |
| Aging ลูกหนี้/เจ้าหนี้ | คำนวณล่วงหน้าเป็น snapshot รายวัน |
| Export Excel หลายหมื่นแถว | ทำใน worker แล้วส่งลิงก์ดาวน์โหลด ไม่ block request |

**เป้าหมาย:** หน้าจอทั่วไป p95 < 300ms · โพสต์เอกสาร < 500ms · งบการเงินรายเดือน < 3 วินาที

## 10. ความถูกต้องของตัวเลข

- ทุกจำนวนเงิน = `NUMERIC(19,4)` ในฐานข้อมูล, ใช้ decimal library (ไม่ใช่ float) ในโค้ด
- ปัดเศษ: ปัดที่ **ระดับเอกสาร** ตามกฎกรมสรรพากร (ปัดทศนิยม 2 ตำแหน่ง) และเก็บผลต่างปัดเศษเข้าบัญชีผลต่างปัดเศษ
- VAT คำนวณจากยอดรวมหลังหักส่วนลดของทั้งใบ ไม่ใช่บวกทีละบรรทัด (กันผลต่าง 1 สตางค์)
- ทดสอบ property-based: สุ่มเอกสาร 10,000 ใบ → เดบิตรวม = เครดิตรวม เสมอ
