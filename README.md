# DULY — ระบบบัญชีและการเงินสำหรับธุรกิจไทย

> **ดุล** (Thai: balance) × **duly** (English: properly, on time, as required)
> — "บัญชีที่ดุล และทำถูกต้องตรงเวลา"

DULY คือระบบบัญชี–การเงิน (Accounting & Finance Platform) ที่ออกแบบมาให้ใช้ภายในบริษัทได้จริง
และพร้อมยกระดับเป็นผลิตภัณฑ์ SaaS ขายในตลาดไทย/อาเซียนในอนาคต โดยยึด 3 หลักการ

1. **Compliance-first** — ออกแบบตามกฎหมายไทยตั้งแต่ระดับโครงสร้างข้อมูล ไม่ใช่แปะทีหลัง
   (พ.ร.บ.การบัญชี 2543, ประมวลรัษฎากร, TFRS for NPAEs, PDPA, DBD e-Filing, e-Tax Invoice)
2. **Double-entry ที่แข็งแรง** — ทุกเอกสารลงบัญชีผ่าน Journal Entry ที่ immutable + audit trail ครบ
3. **AI-ready (แต่ยังไม่เปิดใช้)** — วางโครงข้อมูล/เหตุการณ์ไว้ให้ AI Layer เสียบเข้ามาได้ในเฟสหลัง
   โดยไม่ต้องรื้อระบบ

---

## เอกสารออกแบบ (อ่านตามลำดับนี้)

| # | เอกสาร | เนื้อหา |
|---|--------|---------|
| 00 | [ชื่อแบรนด์และ Product Brief](docs/00-brand-and-product-brief.md) | ตัวเลือกชื่อ, positioning, กลุ่มลูกค้า, โมเดลราคา |
| 01 | [กฎหมายและภาษีไทย](docs/01-thai-compliance.md) | สรุปข้อกฎหมายทุกฉบับที่ระบบต้องรองรับ + ผลต่อการออกแบบ |
| 02 | [ขอบเขตโมดูล (14 หมวด)](docs/02-modules.md) | รายละเอียดทุกโมดูลระดับ feature |
| 03 | [สถาปัตยกรรมระบบ](docs/03-architecture.md) | Tech stack, multi-tenant, service boundary, deployment |
| 04 | [แบบจำลองข้อมูล](docs/04-data-model.md) | ERD, ตารางหลัก, กติกาการลงบัญชี |
| 05 | [API & Integration](docs/05-api-and-integration.md) | REST/Webhook, e-Tax, ธนาคาร, e-Filing |
| 06 | [Design System & UX](docs/06-design-system.md) | แนวทางหน้าตาเว็บที่ "ไม่ดูเป็น AI ออกแบบ" |
| 07 | [ความปลอดภัยและ PDPA](docs/07-security-and-pdpa.md) | RBAC, audit, การเก็บรักษาเอกสาร, สิทธิเจ้าของข้อมูล |
| 08 | [AI Layer (เฟสหลัง)](docs/08-ai-layer.md) | สิ่งที่ต้องเตรียมไว้ตั้งแต่วันนี้ |
| 09 | [Roadmap และแผนสร้าง](docs/09-roadmap.md) | เฟส 0–5, ทีม, ประมาณการเวลา |
| 10 | [ผังบัญชีมาตรฐาน](docs/10-chart-of-accounts.md) | COA ไทย 5 หมวด พร้อมรหัส |
| 11 | [แบบฟอร์มพิมพ์](docs/11-print-forms.md) | ใบกำกับภาษี ใบเสร็จ 50 ทวิ รายงานภาษี งบการเงิน |
| 12 | [กฎการคำนวณภาษี](docs/12-tax-calculation-rules.md) | VAT, WHT, PIT, CIT, ค่าเสื่อม พร้อมสูตรและ test case |
| 13 | [รูปแบบไฟล์นำส่งราชการ](docs/13-file-formats.md) | e-Tax XML, ไฟล์ ภ.ง.ด., XBRL, ไฟล์ธนาคาร |
| 14 | [วงจรสถานะเอกสารและ Error Catalog](docs/14-document-states.md) | state machine ทุกเอกสาร + รหัสข้อผิดพลาด |
| 15 | [แผนการทดสอบ](docs/15-test-plan.md) | golden test, property test, UAT, เกณฑ์ go-live |
| 16 | [อภิธานศัพท์ไทย-อังกฤษ](docs/16-glossary.md) | มาตรฐานคำที่ใช้ทั้งระบบ |

## ฐานข้อมูล

```bash
createdb duly
for f in db/migrations/*.sql; do psql -d duly -v ON_ERROR_STOP=1 -f "$f"; done
psql -d duly -v ON_ERROR_STOP=1 -f db/seed/load_seed.sql
db/tests/run.sh          # ชุดทดสอบกฎบัญชี 43 ข้อ
```

- `db/migrations/` — 15 ไฟล์ 152 ตาราง ครอบคลุมทุกโมดูล ([รายละเอียด](db/README.md))
- `db/seed/` — ผังบัญชี 3 แม่แบบ, รหัสและอัตราภาษี, ขั้นภาษี, ค่าลดหย่อน, จังหวัด, วันหยุด
- `db/tests/` — ชุดทดสอบที่พิสูจน์ว่าสคีมาบังคับกฎบัญชีได้จริง
- `prototype/` — ต้นแบบหน้าเว็บแบบ static HTML

---

## สถานะ

เฟสปัจจุบัน: **Design / Blueprint** — ยังไม่เริ่มเขียนโค้ดระบบจริง
เอกสารทั้งหมดเขียนให้พร้อมส่งต่อทีมพัฒนาหรือใช้เป็น spec ตั้งต้นได้ทันที

> ⚠️ ข้อมูลกฎหมายและอัตราภาษีในเอกสารนี้อ้างอิงข้อมูลสาธารณะ ณ ปี 2569 (2026)
> ก่อนใช้งานจริงต้องให้ผู้สอบบัญชี/ที่ปรึกษาภาษีตรวจสอบ และระบบต้องออกแบบให้
> "อัตราและกฎ" เป็นข้อมูล (config) ไม่ใช่โค้ด เพื่อแก้ตามประกาศใหม่ได้โดยไม่ deploy
