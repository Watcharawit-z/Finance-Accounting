# 13 — รูปแบบไฟล์นำส่งหน่วยงานราชการ

> ⚠️ **ข้อจำกัดของเอกสารนี้** — โครงสร้างไฟล์ที่หน่วยงานกำหนดมีรายละเอียดระดับตำแหน่งตัวอักษร
> ซึ่งต้องยึดตามคู่มือฉบับล่าสุดของหน่วยงานเท่านั้น เอกสารนี้ระบุ **สิ่งที่ต้องไปเอามา
> และวิธีออกแบบให้รองรับ** ไม่ใช่ตัวสเปกที่เอาไปเขียนโค้ดได้ตรง ๆ
> **ก่อนพัฒนาจริงต้องดาวน์โหลดคู่มือทางการและทดสอบกับระบบ sandbox ของหน่วยงาน**

---

## 1. รายการเอกสารทางการที่ต้องมีก่อนเริ่มพัฒนา

| ไฟล์ | แหล่งที่มา | ใช้ทำอะไร |
|------|-----------|-----------|
| คู่มือโปรแกรมโอนย้ายข้อมูล ภ.ง.ด.1/2/3/53 | กรมสรรพากร (rd.go.th → บริการอิเล็กทรอนิกส์) | โครงสร้างไฟล์ text นำส่งภาษีหัก ณ ที่จ่าย |
| ข้อเสนอแนะมาตรฐานฯ **ขมธอ. 3-2560** | สพธอ. (ETDA) | โครงสร้าง XML ของ e-Tax Invoice & e-Receipt |
| คู่มือการยื่นแบบ บ.อ.01 | กรมสรรพากร (etax.rd.go.th) | ขั้นตอนขออนุมัติเป็นผู้ออก e-Tax |
| DBD XBRL Taxonomy + คู่มือ | กรมพัฒนาธุรกิจการค้า (efiling.dbd.go.th) | โครงสร้างงบการเงินสำหรับ e-Filing |
| รูปแบบไฟล์ สปส.1-10 | สำนักงานประกันสังคม (sso.go.th) | นำส่งเงินสมทบรายเดือน |
| Corporate API Specification | ธนาคารแต่ละแห่ง (ต้องทำสัญญาก่อน) | ดึง statement, สั่งโอน, e-WHT |

---

## 2. e-Tax Invoice & e-Receipt (XML)

### 2.1 มาตรฐานที่ใช้
โครงสร้างอ้างอิง **UN/CEFACT Cross Industry Invoice (CII)** ที่ปรับใช้ตามข้อเสนอแนะมาตรฐาน
ขมธอ. 3-2560 ของ สพธอ. ประเภทเอกสารที่ต้องรองรับ:

| รหัส | เอกสาร |
|------|--------|
| 380 | ใบกำกับภาษี / ใบแจ้งหนี้ |
| 388 | ใบกำกับภาษี (Tax Invoice) |
| 381 | ใบลดหนี้ |
| 383 | ใบเพิ่มหนี้ |
| T01 | ใบรับ (ใบเสร็จรับเงิน) |
| T02 | ใบแจ้งหนี้/ใบกำกับภาษี |
| T03 | ใบเสร็จรับเงิน/ใบกำกับภาษี |
| T04 | ใบส่งของ/ใบกำกับภาษี |
| T05 | ใบกำกับภาษีอย่างย่อ |
| T07 | ใบลดหนี้ |

### 2.2 โครงร่างเอกสาร (แนวคิด — ต้องยึดสเปกทางการ)

```xml
<rsm:CrossIndustryInvoice>
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>ETDA-CIIv2-2560</ram:ID>              <!-- รุ่นของมาตรฐาน -->
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>

  <rsm:ExchangedDocument>
    <ram:ID>INV2601-00118</ram:ID>                   <!-- เลขที่ใบกำกับภาษี -->
    <ram:Name>ใบกำกับภาษี</ram:Name>
    <ram:TypeCode>388</ram:TypeCode>
    <ram:IssueDateTime>2026-01-28T00:00:00</ram:IssueDateTime>
    <ram:Purpose>...</ram:Purpose>                   <!-- เหตุผล (ใบลด/เพิ่มหนี้) -->
  </rsm:ExchangedDocument>

  <rsm:SupplyChainTradeTransaction>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:SellerTradeParty>
        <ram:Name>บริษัท ศรีวัฒนาการค้า จำกัด</ram:Name>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="TXID">0105548021442</ram:ID>
        </ram:SpecifiedTaxRegistration>
        <ram:PostalTradeAddress>...</ram:PostalTradeAddress>
        <!-- รหัสสาขา: 00000 = สำนักงานใหญ่ -->
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>...</ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>

    <ram:IncludedSupplyChainTradeLineItem>          <!-- ซ้ำได้ตามจำนวนบรรทัด -->
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>ชุดควบคุมมอเตอร์ MC-450</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>158000.00</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="C62">4</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:CategoryCode>S</ram:CategoryCode>     <!-- S=มาตรฐาน Z=0% E=ยกเว้น -->
          <ram:RateApplicablePercent>7.00</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>632000.00</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>

    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>THB</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>58940.00</ram:CalculatedAmount>
        <ram:BasisAmount>842000.00</ram:BasisAmount>
        <ram:RateApplicablePercent>7.00</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>842000.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>842000.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount>58940.00</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>900940.00</ram:GrandTotalAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
```

### 2.3 การลงลายมือชื่อดิจิทัล
```
XML Digital Signature (XAdES) แนบท้ายเอกสาร
  · ใบรับรองอิเล็กทรอนิกส์ต้องออกโดย CA ที่ได้รับการรับรอง
  · private key เก็บใน HSM หรือ Cloud KMS — ห้ามอยู่ในไฟล์ระบบหรือ container image
  · ต้องเก็บใบรับรอง ณ เวลาที่ลงนามไว้กับเอกสาร เพื่อให้ตรวจสอบย้อนหลังได้
    แม้ใบรับรองจะหมดอายุไปแล้ว
```

### 2.4 สถาปัตยกรรมที่ต้องรองรับความล้มเหลว
```
issue invoice ──► etax_document (status = pending)
                        │
                        ├─ worker หยิบจากคิว ─► สร้าง XML ─► signer service ─► ส่ง
                        │                                                        │
                        │                       ┌────────────────────────────────┘
                        ▼                       ▼
              accepted (เก็บ XML + ใบตอบรับ)   rejected (เก็บ error_code)
                                                  │
                                                  └─► แจ้งผู้ใช้ + ให้แก้แล้วส่งใหม่
                                                      (retry_count, next_retry_at)
```
**ห้ามให้การออกใบกำกับภาษีล้มเหลวเพราะระบบ e-Tax ล่ม** — เอกสารต้องออกได้ทันที
แล้วค่อยส่งย้อนหลัง กำหนดนำส่งคือภายในวันที่ 15 ของเดือนถัดไป จึงมีเวลาเหลือเฟือ

---

## 3. ไฟล์นำส่ง ภ.ง.ด.1 / 2 / 3 / 53

### 3.1 ลักษณะทั่วไป
- ไฟล์ข้อความ (text) แบบมีตัวคั่น (pipe `|`) หรือความกว้างคงที่ ขึ้นกับแบบและรุ่นของโปรแกรม
- **การเข้ารหัสอักขระ: TIS-620** (ไม่ใช่ UTF-8) — จุดที่พลาดกันบ่อยที่สุด
- ปีใช้ **พ.ศ.** และวันที่รูปแบบ `ddmmyyyy`
- จำนวนเงินไม่มีเครื่องหมายคั่นหลักพัน ทศนิยม 2 ตำแหน่ง
- เลขประจำตัวผู้เสียภาษี 13 หลัก ไม่มีขีดคั่น
- มีไฟล์ 2 ส่วน: **ส่วนหัว** (ข้อมูลผู้มีหน้าที่หัก) และ **ส่วนรายละเอียด** (รายผู้ถูกหัก)

### 3.2 ฟิลด์ที่ต้องมีในส่วนรายละเอียด (ทุกแบบ)
```
· ลำดับที่
· เลขประจำตัวผู้เสียภาษีของผู้ถูกหัก (13 หลัก)
· คำนำหน้าชื่อ / ชื่อ / นามสกุล  (นิติบุคคลใช้ชื่อเต็ม)
· ที่อยู่ (เลขที่ ซอย ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์ — แยกฟิลด์)
· วันเดือนปีที่จ่าย
· ประเภทเงินได้ (รหัสตามแบบ)
· อัตราภาษี
· จำนวนเงินที่จ่าย
· จำนวนภาษีที่หัก
· เงื่อนไขการหักภาษี (1 = หัก ณ ที่จ่าย, 2 = ออกให้ตลอดไป, 3 = ออกให้ครั้งเดียว)
```

### 3.3 สิ่งที่ระบบต้องทำเพื่อให้ไฟล์ผ่านการตรวจ
```
[ ] แปลงเป็น TIS-620 และตรวจว่าไม่มีอักขระที่แปลงไม่ได้ (เช่น อีโมจิ ตัวอักษรจีน)
[ ] ตัดชื่อ/ที่อยู่ตามความยาวสูงสุดของแต่ละฟิลด์ โดยไม่ตัดกลางตัวอักษรผสม (สระ/วรรณยุกต์)
[ ] แปลง ค.ศ. → พ.ศ. ทุกวันที่
[ ] ★ กรองรายการที่ remittance_channel = 'e_wht' ออก
[ ] ยอดรวมในไฟล์ = ยอดในแบบที่กรอก = ยอดในบัญชี wht_payable
[ ] ตรวจ checksum เลขประจำตัวผู้เสียภาษีทุกราย ก่อนสร้างไฟล์
[ ] ผู้ถูกหักที่ไม่มีเลขประจำตัวผู้เสียภาษี → ต้องแจ้งเตือน ไม่ปล่อยผ่าน
```

### 3.4 การตรวจ checksum เลขประจำตัวผู้เสียภาษี 13 หลัก
```
sum = Σ (หลักที่ i × (14 − i))   สำหรับ i = 1..12
check = (11 − (sum mod 11)) mod 10
ถูกต้องเมื่อ check == หลักที่ 13
```

---

## 4. DBD e-Filing (XBRL)

### 4.1 ภาพรวม
- ยื่นงบการเงินภายใน **5 เดือน** นับแต่วันสิ้นรอบบัญชี
- ระบบ DBD มี **DBD XBRL in Excel** ให้ดาวน์โหลด — 1 ไฟล์ต่อ 1 นิติบุคคล
- ต้องยื่น **บอจ.5** (บัญชีรายชื่อผู้ถือหุ้น) ภายใน 14 วันหลังประชุมผู้ถือหุ้น

### 4.2 แนวทางพัฒนาแบบเป็นขั้น
```
เฟส 1  ส่งออกงบการเงินเป็น Excel ตามแม่แบบ DBD XBRL in Excel
       ผู้ใช้อัปโหลดเข้าระบบ DBD เอง
       → ต้นทุนต่ำ ใช้งานได้จริงทันที

เฟส 2  สร้างไฟล์ XBRL instance ตาม taxonomy โดยตรง
       ต้องแมป sub_type ของผังบัญชี → XBRL element
       เก็บการแมปในตาราง (ไม่ hardcode) เพราะ taxonomy เปลี่ยนตามปี

เฟส 3  เชื่อมต่ออัตโนมัติ (ถ้า DBD เปิด API)
```

### 4.3 ตารางแมปที่ต้องเพิ่ม (เฟส 2)
```sql
CREATE TABLE xbrl_mapping (
  taxonomy_version text,       -- 'DBD-2566'
  sub_type         text,       -- 'trade_receivable'
  element_name     text,       -- 'TradeAndOtherCurrentReceivables'
  context          text,       -- instant | duration
  PRIMARY KEY (taxonomy_version, sub_type)
);
```

---

## 5. ประกันสังคม (สปส.1-10)

- นำส่งภายในวันที่ **15 ของเดือนถัดไป**
- ยื่นผ่าน e-Service ของสำนักงานประกันสังคม หรือผ่านธนาคารที่ร่วมโครงการ
- ฟิลด์หลัก: เลขบัตรประชาชน · คำนำหน้า · ชื่อ · นามสกุล · ค่าจ้าง · เงินสมทบ
- ระบบต้องคำนวณเงินสมทบตาม **เพดานที่มีผลในเดือนนั้น** (ดู `sso_rate`)
- ตรวจก่อนส่ง: พนักงานเข้า/ออกระหว่างเดือนต้องมีในรายงานพร้อมวันที่

---

## 6. ไฟล์โอนเงินธนาคาร (Direct Credit)

แต่ละธนาคารมีฟอร์แมตของตัวเอง (Fixed-width text หรือ CSV) ที่ต้องขอจากธนาคาร
โครงสร้างร่วมที่ทุกธนาคารต้องการ:

```
ส่วนหัว (Header)   : รหัสบริษัท, เลขบัญชีต้นทาง, วันที่มีผล, จำนวนรายการ, ยอดรวม
ส่วนรายการ (Detail): รหัสธนาคารปลายทาง, เลขบัญชี, ชื่อบัญชี, จำนวนเงิน, อ้างอิง,
                     อีเมล/มือถือสำหรับแจ้งผู้รับ
ส่วนท้าย (Trailer) : จำนวนรายการ, ยอดรวม (ตรวจซ้ำกับส่วนหัว)
```

**การออกแบบ:** ทำ `BankFileAdapter` interface แล้วมี implementation ต่อธนาคาร
เพิ่มธนาคารใหม่ = เพิ่ม adapter ไม่ต้องแตะโมดูลจ่ายเงิน

---

## 7. การนำเข้า Bank Statement

| รูปแบบ | ธนาคาร | หมายเหตุ |
|--------|--------|----------|
| CSV / Excel | ทุกธนาคาร | ต้องมีตัวแมปคอลัมน์ที่ผู้ใช้ตั้งค่าเองได้ |
| MT940 / MT942 | ธนาคารที่รองรับ SWIFT | มาตรฐานสากล แนะนำถ้ามีให้ใช้ |
| OFX / QIF | บางธนาคาร | |
| API | ต้องทำสัญญา Corporate Banking | ดีที่สุดแต่ต้นทุนสูง |

**การกันนำเข้าซ้ำ**
```
fingerprint = SHA256(bank_account_id || txn_date || debit || credit || description || running_balance)
```
ใช้เป็น unique key — นำเข้าไฟล์เดิมซ้ำแล้วรายการจะไม่เพิ่ม

---

## 8. การส่งออกข้อมูลให้ผู้สอบบัญชี

ผู้สอบบัญชีมักขอไฟล์เหล่านี้ ระบบควรมีปุ่มเดียวส่งออกได้ทั้งชุด:

```
· งบทดลองก่อนและหลังปรับปรุง (Excel)
· บัญชีแยกประเภททั่วไปทุกบัญชี (Excel/CSV)
· สมุดรายวันทุกเล่ม
· รายละเอียดลูกหนี้/เจ้าหนี้คงเหลือรายราย
· ทะเบียนทรัพย์สินพร้อมค่าเสื่อม
· รายงานภาษีซื้อ-ขายทั้งปี
· audit trail ของรายการที่แก้ไข/กลับรายการ
· หนังสือยืนยันยอด (confirmation) รายลูกค้า/ผู้ขาย
```
รูปแบบ: Excel ที่มีสูตรจริงและหัวตารางแช่แข็ง + CSV สำหรับนำเข้าโปรแกรมตรวจสอบ (เช่น IDEA, ACL)

---

## 9. สรุปสิ่งที่ต้องทำก่อนพัฒนาส่วนนี้

```
[ ] ดาวน์โหลดคู่มือทางการทุกฉบับในตารางข้อ 1
[ ] ขอสิทธิ์เข้าใช้ระบบทดสอบ (sandbox) ของกรมสรรพากรสำหรับ e-Tax
[ ] เลือกและทำสัญญากับ Service Provider ของ e-Tax (เฟสแรก)
[ ] ขอ Corporate API spec จากธนาคารที่บริษัทใช้
[ ] ทดสอบไฟล์ ภ.ง.ด. กับโปรแกรมโอนย้ายข้อมูลจริงของกรมสรรพากร
    ก่อนใช้กับข้อมูลจริง — ห้ามเดาโครงสร้าง
```
