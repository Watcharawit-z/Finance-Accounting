/* ===================================================================
   ข้อมูลตัวอย่าง — บริษัทซื้อมาขายไปขนาดกลาง 6 เดือน
   ตัวเลขสมมติทั้งหมด แต่ต้องกระทบกันได้จริงทุกบาท
   =================================================================== */

const COA = [
  ['1000','สินทรัพย์','asset','header',0],
  ['1100','สินทรัพย์หมุนเวียน','asset','header',0],
  ['1111','เงินสดในมือ','asset','cash',1],
  ['1112','เงินสดย่อย','asset','cash',1],
  ['1113','เงินฝากธนาคาร–ไทยพาณิชย์ กระแสรายวัน','asset','bank',1],
  ['1114','เงินฝากธนาคาร–กสิกรไทย ออมทรัพย์','asset','bank',1],
  ['1117','เงินระหว่างทาง','asset','cash_in_transit',1],
  ['1131','ลูกหนี้การค้า–ในประเทศ','asset','trade_receivable',1,'partner'],
  ['1139','ค่าเผื่อผลขาดทุนด้านเครดิต','asset','ar_allowance',1],
  ['1141','เงินทดรองจ่าย','asset','other_receivable',1],
  ['1143','รายได้ค้างรับ','asset','accrued_income',1],
  ['1154','สินค้าคงเหลือ','asset','inventory',1],
  ['1159','ค่าเผื่อการลดมูลค่าสินค้า','asset','inventory_allowance',1],
  ['1161','ภาษีซื้อ','asset','input_vat',1],
  ['1164','ภาษีมูลค่าเพิ่มรอขอคืน','asset','vat_receivable',1],
  ['1165','ภาษีเงินได้ถูกหัก ณ ที่จ่าย','asset','wht_asset',1],
  ['1166','ภาษีเงินได้นิติบุคคลจ่ายล่วงหน้า','asset','prepaid_cit',1],
  ['1171','ค่าใช้จ่ายจ่ายล่วงหน้า','asset','prepaid_expense',1],
  ['1180','เงินมัดจำและเงินประกันจ่าย','asset','deposit_paid',1],
  ['1200','สินทรัพย์ไม่หมุนเวียน','asset','header',0],
  ['1210','เงินลงทุนระยะยาว','asset','long_term_investment',1],
  ['1301','ที่ดิน','asset','ppe_land',1],
  ['1302','อาคารและสิ่งปลูกสร้าง','asset','ppe',1],
  ['1309','งานระหว่างก่อสร้าง','asset','cip',1],
  ['1310','ค่าเสื่อมราคาสะสม','asset','accum_depreciation',1],
  ['1401','โปรแกรมคอมพิวเตอร์','asset','intangible',1],
  ['1409','ค่าตัดจำหน่ายสะสม','asset','accum_amortization',1],
  ['1700','สินทรัพย์ไม่หมุนเวียนอื่น','asset','other_asset',1],

  ['2000','หนี้สิน','liability','header',0],
  ['2100','หนี้สินหมุนเวียน','liability','header',0],
  ['2121','เจ้าหนี้การค้า–ในประเทศ','liability','trade_payable',1,'partner'],
  ['2125','พักรับสินค้า','liability','grni',1],
  ['2131','ค่าใช้จ่ายค้างจ่าย','liability','accrued_expense',1],
  ['2132','เงินเดือนค้างจ่าย','liability','accrued_payroll',1],
  ['2135','เจ้าหนี้อื่น','liability','other_payable',1],
  ['2141','ภาษีขาย','liability','output_vat',1],
  ['2143','ภาษีมูลค่าเพิ่มค้างชำระ','liability','vat_payable',1],
  ['2144','ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.1','liability','wht_payable_pnd1',1],
  ['2145','ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.3','liability','wht_payable_pnd3',1],
  ['2146','ภาษีหัก ณ ที่จ่ายค้างนำส่ง–ภ.ง.ด.53','liability','wht_payable_pnd53',1],
  ['2148','ภาษีเงินได้นิติบุคคลค้างจ่าย','liability','cit_payable',1],
  ['2151','เงินสมทบประกันสังคมค้างนำส่ง','liability','sso_payable',1],
  ['2152','กองทุนสำรองเลี้ยงชีพค้างนำส่ง','liability','pvd_payable',1],
  ['2161','เงินมัดจำรับจากลูกค้า','liability','customer_deposit',1],
  ['2162','รายได้รับล่วงหน้า','liability','unearned_revenue',1],
  ['2210','เงินกู้ยืมระยะยาว','liability','long_term_loan',1],
  ['2240','ประมาณการหนี้สินผลประโยชน์พนักงาน','liability','employee_benefit_obligation',1],

  ['3000','ส่วนของผู้ถือหุ้น','equity','header',0],
  ['3120','ทุนที่ออกและชำระแล้ว','equity','paid_up_capital',1],
  ['3210','สำรองตามกฎหมาย','equity','legal_reserve',1],
  ['3310','กำไรสะสมยังไม่ได้จัดสรร','equity','retained_earnings',1],
  ['3320','กำไรสุทธิสำหรับงวด','equity','current_year_earnings',1],
  ['3330','เงินปันผลจ่าย','equity','dividend',1],
  ['3930','บัญชีปรับปรุงยอดยกมา','equity','opening_balance',1],

  ['4000','รายได้','revenue','header',0],
  ['4111','รายได้จากการขาย–ในประเทศ','revenue','sales_revenue',1],
  ['4112','รายได้จากการขาย–ส่งออก','revenue','sales_revenue_export',1],
  ['4121','รายได้ค่าบริการ','revenue','service_revenue',1],
  ['4123','รายได้ค่าเช่า','revenue','rental_revenue',1],
  ['4130','รับคืนสินค้าและส่วนลดจ่าย','revenue','sales_return',1],
  ['4131','ส่วนลดจ่าย','revenue','sales_discount',1],
  ['4210','ดอกเบี้ยรับ','revenue','interest_income',1],
  ['4230','กำไรจากอัตราแลกเปลี่ยน','revenue','fx_gain',1],
  ['4240','กำไรจากการจำหน่ายสินทรัพย์','revenue','gain_on_disposal',1],
  ['4250','หนี้สูญได้รับคืน','revenue','bad_debt_recovery',1],
  ['4260','รายได้เบ็ดเตล็ด','revenue','other_income',1],

  ['5000','ค่าใช้จ่าย','expense','header',0],
  ['5110','ต้นทุนขายสินค้า','expense','cogs',1],
  ['5111','ซื้อสินค้า','expense','purchases',1],
  ['5112','ส่งคืนสินค้าและส่วนลดรับ','expense','purchase_return',1],
  ['5120','ต้นทุนการให้บริการ','expense','cost_of_service',1],
  ['5140','ผลขาดทุนจากสินค้าเสื่อมสภาพ','expense','inventory_writeoff',1],
  ['5200','ค่าใช้จ่ายในการขาย','expense','selling_expense',1],
  ['5311','เงินเดือนและค่าจ้าง','expense','admin_expense',1],
  ['5315','เงินสมทบประกันสังคม–ส่วนนายจ้าง','expense','sso_expense',1],
  ['5316','เงินสมทบกองทุนสำรองฯ–ส่วนนายจ้าง','expense','pvd_expense',1],
  ['5341','ค่าเสื่อมราคา','expense','depreciation',1],
  ['5342','ค่าตัดจำหน่าย','expense','amortization',1],
  ['5351','หนี้สงสัยจะสูญ','expense','bad_debt',1],
  ['5352','ขาดทุนจากอัตราแลกเปลี่ยน','expense','fx_loss',1],
  ['5353','ขาดทุนจากการจำหน่ายสินทรัพย์','expense','loss_on_disposal',1],
  ['5354','ภาษีซื้อต้องห้าม','expense','non_claimable_vat_expense',1],
  ['5359','รายจ่ายต้องห้ามทางภาษี','expense','non_deductible',1],
  ['5410','ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร','expense','finance_cost',1],
  ['5510','ภาษีเงินได้นิติบุคคล','expense','income_tax_expense',1],
  ['9910','บัญชีพัก','asset','suspense',1],
  ['9920','ผลต่างจากการปัดเศษ','expense','rounding',1],
];

const CUSTOMERS = [
  ['CUS-0012','บริษัท เอ็นเอส เอ็นจิเนียริ่ง จำกัด','0105548021442','88/9 หมู่ 4 ตำบลมาบตาพุด อำเภอเมือง จังหวัดระยอง 21150',30],
  ['CUS-0031','บริษัท ไทยพัฒนาโลจิสติกส์ จำกัด','0107536000234','1 อาคารทีดีแอล ถนนสาทรใต้ แขวงยานนาวา เขตสาทร กรุงเทพมหานคร 10120',45],
  ['CUS-0044','บริษัท สยามกรีนแพค จำกัด','0105551078921','55/2 หมู่ 9 ตำบลบางปลา อำเภอบางพลี จังหวัดสมุทรปราการ 10540',30],
  ['CUS-0058','ห้างหุ้นส่วนจำกัด ทวีทรัพย์ ซัพพลาย','0103539004113','214 ถนนเจริญกรุง แขวงบางรัก เขตบางรัก กรุงเทพมหานคร 10500',15],
  ['CUS-0067','บริษัท ศรีเจริญ ก่อสร้าง จำกัด','0105546012381','99/1 ถนนพหลโยธิน แขวงจตุจักร เขตจตุจักร กรุงเทพมหานคร 10900',30],
  ['CUS-0072','บริษัท เมืองทองพลาสติก จำกัด','0105559001774','12 ซอยอ่อนนุช 17 แขวงสวนหลวง เขตสวนหลวง กรุงเทพมหานคร 10250',30],
  ['CUS-0080','บริษัท ยูนิเวอร์แซล ฟู้ดส์ จำกัด','0105536091238','7 หมู่ 2 ตำบลคลองหนึ่ง อำเภอคลองหลวง จังหวัดปทุมธานี 12120',60],
];

const VENDORS = [
  ['VEN-0001','บริษัท เอเชียสตีล จำกัด','0105533001823','300 นิคมอุตสาหกรรมบางปู จังหวัดสมุทรปราการ 10280',30,'WHT_CONTRACT','juristic'],
  ['VEN-0004','บริษัท ไทยพลาสติกซัพพลาย จำกัด','0105540022881','45 ถนนสุขุมวิท 71 แขวงพระโขนงเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',30,null,'juristic'],
  ['VEN-0009','ห้างหุ้นส่วนจำกัด สมบูรณ์ขนส่ง','0103545001198','88 ถนนบางนา-ตราด กม.15 จังหวัดสมุทรปราการ 10540',15,'WHT_TRANSPORT','juristic'],
  ['VEN-0012','บริษัท ที.เอ็น. พร็อพเพอร์ตี้ จำกัด','0105542007731','9 อาคารทีเอ็น ถนนรัชดาภิเษก เขตดินแดง กรุงเทพมหานคร 10400',7,'WHT_RENT','juristic'],
  ['VEN-0015','บริษัท มีเดียพลัส จำกัด','0105549003383','21 ซอยทองหล่อ 10 แขวงคลองตันเหนือ เขตวัฒนา กรุงเทพมหานคร 10110',30,'WHT_ADVERT','juristic'],
  ['VEN-0021','นางสาวมาลี ดีงาม','3100900123455','120/5 ถนนงามวงศ์วาน อำเภอเมือง จังหวัดนนทบุรี 11000',7,'WHT_PROF','individual'],
  ['VEN-0025','บริษัท ออฟฟิศเมท ซัพพลาย จำกัด','0105536091238','44 ถนนพระราม 3 แขวงบางโพงพาง เขตยานนาวา กรุงเทพมหานคร 10120',30,null,'juristic'],
  ['VEN-0030','บริษัท เอ็นเนอร์ยี่ ปิโตรเลียม จำกัด','0107537000521','1 ถนนวิภาวดีรังสิต แขวงจอมพล เขตจตุจักร กรุงเทพมหานคร 10900',15,null,'juristic'],
];

const ITEMS = [
  ['MC-450','ชุดควบคุมมอเตอร์ รุ่น MC-450','อุปกรณ์ไฟฟ้า','ชุด','stock','124800','162000',60,20],
  ['SW-220','สวิตช์ตัดตอนอัตโนมัติ 220V','อุปกรณ์ไฟฟ้า','อัน','stock','880','1290',3000,800],
  ['CB-16','เบรกเกอร์ 16A','อุปกรณ์ไฟฟ้า','อัน','stock','210','330',8000,2000],
  ['WR-25','สายไฟ THW 2.5 sq.mm.','สายไฟ','ม้วน','stock','2400','3350',500,150],
  ['PN-100','แผงควบคุมสำเร็จรูป 100A','แผงควบคุม','ชุด','stock','38500','53500',40,15],
  ['SRV-INS','ค่าบริการติดตั้งหน้างาน','บริการ','งาน','service','0','0',0,0],
  ['SRV-DSG','ค่าออกแบบระบบไฟฟ้า','บริการ','งาน','service','0','0',0,0],
  ['SRV-MNT','ค่าบำรุงรักษารายปี','บริการ','งาน','service','0','0',0,0],
];

const EMPLOYEES = [
  ['EMP-0101','นายวิชัย นำชัย','ผลิต','32000',12,3],
  ['EMP-0102','นางสาวสุนิสา ประเสริฐ','บัญชีและการเงิน','45000',0,5],
  ['EMP-0103','นายธนกร วงศ์สุวรรณ','บัญชีและการเงิน','68000',0,5],
  ['EMP-0104','นางอรุณี สมบูรณ์','บุคคล','38000',0,3],
  ['EMP-0105','นายสมศักดิ์ กิจเจริญ','จัดซื้อ','42000',0,3],
  ['EMP-0106','นายปิยะ ทองดี','คลังและขนส่ง','21000',24,0],
  ['EMP-0107','นางสาวกมลชนก แสงทอง','ขาย','35000',0,3],
  ['EMP-0108','นายอนุชา รุ่งเรือง','ขาย','30000',0,3],
  ['EMP-0109','นายเกรียงไกร ภักดี','ผลิต','19500',30,0],
  ['EMP-0110','นางสาวพรทิพย์ ใจงาม','ผลิต','18500',28,0],
  ['EMP-0111','นายชัยวัฒน์ มีสุข','คลังและขนส่ง','22000',16,0],
  ['EMP-0112','นางสาวณัฐริกา สายทอง','บริหาร','95000',0,5],
];

const ASSETS = [
  ['FA-0001','อาคารโกดังสินค้า','BUILDING','2023-01-01','8400000',20],
  ['FA-0012','รถกระบะ Isuzu D-Max','VEHICLE','2024-03-15','842000',5],
  ['FA-0018','เครื่องจักรตัดโลหะ CNC','MACHINERY','2025-01-10','2400000',5],
  ['FA-0024','รถยนต์นั่ง Toyota Camry','CAR','2025-07-01','1850000',5],
  ['FA-0031','โน้ตบุ๊กและอุปกรณ์ไอที 12 ชุด','COMPUTER','2025-09-01','384000',3],
  ['FA-0035','เครื่องปรับอากาศสำนักงาน','OFFICE','2025-04-01','268000',5],
  ['FA-0040','ชุดโต๊ะและเก้าอี้สำนักงาน','FURNITURE','2024-06-01','196000',5],
];

/* -------------------------------------------------------------- */
/* ---------- ผังบัญชีและงวด — ใช้ร่วมกันทั้งข้อมูลตัวอย่างและบริษัทเปล่า ---------- */
function loadChart() {
  DB.accounts = COA.map(function (r) {
    return {
      code: r[0], name: r[1], type: r[2], subType: r[3],
      postable: !!r[4], requiresPartner: r[5] === 'partner',
      level: r[0].endsWith('000') ? 1 : r[0].endsWith('00') ? 2 : 3,
    };
  });
}

function loadPeriods(year) {
  DB.periods = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, '0');
    DB.periods.push({
      code: year + '-' + mm, start: year + '-' + mm + '-01',
      end: endOfMonth(year + '-' + mm + '-01'), status: 'open',
    });
  }
}

/**
 * เริ่มจากบริษัทเปล่า — ผังบัญชีและงวดครบ แต่ไม่มีรายการใด ๆ
 * ใช้เมื่อจะย้ายข้อมูลจริงเข้ามา จะได้ไม่ปนกับข้อมูลตัวอย่าง
 */
function buildBlank(o) {
  o = o || {};
  const year = Number(o.year) || 2026;
  DB.company = {
    name: String(o.name || '').trim() || 'บริษัทของฉัน จำกัด',
    nameEn: '',
    taxId: String(o.taxId || '').trim(),
    regNo: String(o.taxId || '').trim(),
    address: String(o.address || '').trim(),
    branch: '00000', branchName: 'สำนักงานใหญ่', phone: '',
    fiscalYear: String(year + 543),
    standard: 'TFRS for NPAEs',
    bookkeeper: '', auditor: '',
    paidUpCapital: 0, vatRegistered: true,
  };
  if (DB.company.taxId && !validTaxId(DB.company.taxId)) {
    throw new DomainError('TAX_ID_INVALID',
      'เลขประจำตัวผู้เสียภาษี ' + DB.company.taxId + ' ไม่ผ่านการตรวจหลักที่ 13',
      'ตรวจเลขกับหนังสือรับรองของบริษัท หรือเว้นว่างไว้ก่อนแล้วมาแก้ทีหลัง');
  }
  loadChart();
  loadPeriods(year);
  DB.partners = []; DB.items = []; DB.employees = []; DB.assets = [];
  DB.entries = []; DB.taxTx = [];
  DB.docs = {
    quotation: [], salesOrder: [], invoice: [], receipt: [], creditNote: [],
    purchaseOrder: [], bill: [], payment: [], whtCert: [],
    stockMove: [], payRun: [], depreciation: [], filing: [],
  };
  DB.seq = {}; DB.budget = []; DB.projects = []; DB.bankTxns = [];
  DB.audit = []; DB.settings = { hardLockDate: null };
  audit('company', 'blank', 'create', null, { name: DB.company.name, year: DB.company.fiscalYear });
  return DB.company;
}

function buildSeed() {
  DB.company = {
    name: 'บริษัท ศรีวัฒนาการค้า จำกัด',
    nameEn: 'Sriwattana Trading Co., Ltd.',
    taxId: '0105548021442',
    regNo: '0105548021442',
    address: '123 ถนนพระราม 4 แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110',
    branch: '00000', branchName: 'สำนักงานใหญ่',
    phone: '0-2xxx-xxxx',
    fiscalYear: '2569',
    standard: 'TFRS for NPAEs',
    bookkeeper: 'ธนกร วงศ์สุวรรณ (CPD-0012345)',
    auditor: 'สำนักงานสอบบัญชี ก. (CPA-5432)',
    paidUpCapital: M('10000000'),
    vatRegistered: true,
  };

  loadChart();
  loadPeriods(2026);

  DB.partners = CUSTOMERS.map((c) => ({
    code:c[0], name:c[1], taxId:c[2], address:c[3], termDays:c[4],
    branch:'00000', entityType:'juristic', kind:'customer',
    creditLimit: M('5000000'), active: true,
  })).concat(VENDORS.map((v) => ({
    code:v[0], name:v[1], taxId:v[2], address:v[3], termDays:v[4],
    whtCode:v[5], entityType:v[6], branch: v[6] === 'individual' ? null : '00000',
    kind:'vendor', active: true,
  })));

  DB.items = ITEMS.map((i) => ({
    code:i[0], name:i[1], category:i[2], uom:i[3], type:i[4],
    avgCost:M(i[5]), price:M(i[6]), qty:i[7], reorder:i[8],
    value: M(i[5]) * i[7],
  }));

  DB.employees = EMPLOYEES.map((e) => ({
    code:e[0], name:e[1], dept:e[2], salary:M(e[3]), otHours:e[4],
    pvdRate:e[5], deductions:0, active:true, hired:'2023-05-01',
  }));

  DB.assets = ASSETS.map(function (a) {
    const cost = M(a[4]);
    const months = monthsBetween(a[3], '2025-12-31');
    const t = TAX_DEPRECIATION[a[2]];
    const taxBase = t.costCap ? Math.min(cost, t.costCap) : cost;
    return {
      code:a[0], name:a[1], class:a[2], inService:a[3], cost:cost,
      bookYears:a[5], status:'in_use',
      accumBook: Math.min(divRound(divRound(cost, a[5]), 12) * months, cost),
      accumTax:  Math.min(divRound(pct(taxBase, t.rate), 12) * months, taxBase),
    };
  });

  DB.projects = [
    { code:'PJ-2569-004', name:'ติดตั้งระบบไฟฟ้าโรงงานระยอง', customer:'CUS-0012',
      contract:M('4200000'), budget:M('3150000'), actual:0, percent:62, status:'active' },
    { code:'PJ-2569-002', name:'ปรับปรุงระบบควบคุมสายพาน', customer:'CUS-0031',
      contract:M('2800000'), budget:M('2100000'), actual:0, percent:94, status:'active' },
    { code:'PJ-2569-006', name:'บำรุงรักษารายปี', customer:'CUS-0044',
      contract:M('960000'), budget:M('624000'), actual:0, percent:24, status:'active' },
  ];

  DB.budget = [
    ['5200', 'ค่าใช้จ่ายในการขาย', '250000'],
    ['5311', 'เงินเดือนและค่าจ้าง', '520000'],
    ['5341', 'ค่าเสื่อมราคา', '240000'],
    ['5410', 'ดอกเบี้ยจ่ายและค่าธรรมเนียมธนาคาร', '25000'],
    ['5110', 'ต้นทุนขายสินค้า', '2400000'],
  ].map((b) => ({ account:b[0], name:b[1], monthly:M(b[2]) }));

  openingBalances();
  generateTransactions();
}

function monthsBetween(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return Math.max(0, (by - ay) * 12 + (bm - am) + 1);
}

/* ---------- ยอดยกมาต้นปี ---------- */
function openingBalances() {
  const accumDep = DB.assets.reduce((s, a) => s + a.accumBook, 0);
  const ppeCost = DB.assets.filter((a) => a.class !== 'LAND').reduce((s, a) => s + a.cost, 0);
  const inventory = DB.items.reduce((s, i) => s + i.value, 0);
  const ar = M('5884300');
  const ap = M('1884200');
  const bank1 = M('6240800'), bank2 = M('2102400'), cash = M('84000');
  const land = M('3200000');
  const loan = M('6600000');
  const capital = DB.company.paidUpCapital;
  const reserve = M('1000000');

  const assets = cash + bank1 + bank2 + ar + inventory + ppeCost + land - accumDep;
  const liabilities = ap + loan;
  const retained = assets - liabilities - capital - reserve;

  post({
    type: 'opening', date: '2026-01-01', desc: 'ยอดยกมา ณ วันที่ 1 มกราคม 2569',
    src: 'opening', srcId: '2569',
    lines: [
      { acc:'1111', dr:cash },
      { acc:'1113', dr:bank1 },
      { acc:'1114', dr:bank2 },
      { acc:'1131', dr:ar, partner:'CUS-0031' },
      { acc:'1154', dr:inventory },
      { acc:'1301', dr:land },
      { acc:'1302', dr:ppeCost },
      { acc:'1310', cr:accumDep },
      { acc:'2121', cr:ap, partner:'VEN-0001' },
      { acc:'2210', cr:loan },
      { acc:'3120', cr:capital },
      { acc:'3210', cr:reserve },
      { acc:'3310', cr:retained },
    ],
  });

  // ลูกหนี้และเจ้าหนี้ยกมา ให้มีเอกสารรองรับเพื่อให้ยอดคุมตรงกับบัญชีย่อย
  DB.docs.invoice.push({
    no:'INV2512-00301', date:'2025-12-18', due:'2026-02-01',
    partnerCode:'CUS-0031', partnerName:'บริษัท ไทยพัฒนาโลจิสติกส์ จำกัด',
    snap:{ name:'บริษัท ไทยพัฒนาโลจิสติกส์ จำกัด', taxId:'0107536000234', branch:'00000',
           address:CUSTOMERS[1][3] },
    lines:[{ desc:'ยอดยกมาจากระบบเดิม', qty:1, price:ar, amount:ar, taxCode:'EXEMPT' }],
    base:ar, vat:0, total:ar, paid:0, credited:0, status:'issued',
    entryNo:DB.entries[0].no, etax:'not_applicable', broughtForward:true,
  });
  DB.docs.bill.push({
    no:'AP2512-00140', date:'2025-12-20', due:'2026-01-19', vendorNo:'ASI-68-1102',
    partnerCode:'VEN-0001', partnerName:'บริษัท เอเชียสตีล จำกัด',
    lines:[{ desc:'ยอดยกมาจากระบบเดิม', qty:1, price:ap, amount:ap }],
    base:ap, vat:0, total:ap, claimable:true, paid:0, status:'issued',
    entryNo:DB.entries[0].no, broughtForward:true,
  });
}

/* ---------- สุ่มแบบกำหนดผลได้ (ผลลัพธ์เหมือนเดิมทุกครั้ง) ---------- */
let _seed = 20260731;
function rnd() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return _seed / 0x7fffffff; }
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));

/* ---------- สร้างธุรกรรม ม.ค.–มิ.ย. 2569 ---------- */
function generateTransactions() {
  // ม.ค.–มิ.ย. ปิดงวดครบแล้ว · ก.ค. เปิดอยู่ ยังไม่ได้ทำเงินเดือน ค่าเสื่อม และยื่นภาษี
  // เพื่อให้มีงานค้างจริงให้ผู้ใช้ทดลองทำ
  const months = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
  const CLOSED_THROUGH = '2026-06';
  const stockItems = DB.items.filter((i) => i.type === 'stock');
  const svcItems = DB.items.filter((i) => i.type === 'service');
  const customers = DB.partners.filter((p) => p.kind === 'customer');
  const vendors = DB.partners.filter((p) => p.kind === 'vendor');

  months.forEach(function (mo, mi) {
    const last = Number(endOfMonth(mo + '-01').slice(-2));

    // ---- ขาย ----
    const salesCount = 12 + (mi % 3);
    for (let k = 0; k < salesCount; k++) {
      const c = customers[(mi * 3 + k) % customers.length];
      const lines = [];
      const nItems = rint(1, 3);
      for (let j = 0; j < nItems; j++) {
        const it = stockItems[(mi + k + j) % stockItems.length];
        if (it.qty < 3) continue;
        const qty = Math.max(1, Math.min(Math.floor(it.qty / 3), rint(1, 6)));
        lines.push({ desc: it.name, qty, price: String(divRound(it.price, S)),
                     uom: it.uom, itemCode: it.code, revenueSub: 'sales_revenue' });
      }
      if (rnd() > 0.5) {
        const sv = pick(svcItems);
        lines.push({ desc: sv.name, qty: 1, price: String(rint(25, 120) * 1000),
                     uom: 'งาน', revenueSub: 'service_revenue' });
      }
      if (!lines.length) continue;
      issueInvoice({ date: mo + '-' + String(rint(2, Math.min(28, last))).padStart(2, '0'),
                     partnerCode: c.code, lines });
    }

    // ---- เติมสต๊อกตามที่ขายไปจริง (นโยบายจุดสั่งซื้อ) ----
    let poSeq = 0;
    stockItems.forEach(function (it, idx) {
      if (it.qty > it.reorder) return;
      const target = it.reorder * 3;
      const qty = target - it.qty;
      if (qty <= 0) return;
      poSeq += 1;
      const v = vendors[idx % 2 === 0 ? 0 : 1];
      recordBill({
        date: mo + '-' + String(Math.min(last, 4 + poSeq * 2)).padStart(2, '0'),
        partnerCode: v.code,
        vendorNo: (v.code === 'VEN-0001' ? 'ASI-69-' : 'TPS-69-') + (1000 + mi * 20 + poSeq),
        lines: [{ desc: 'สั่งซื้อเติมสต๊อก ' + it.name, qty,
                  price: String(divRound(it.avgCost, S)),
                  expenseSub: 'inventory', itemCode: it.code }],
      });
    });

    // ---- ค่าใช้จ่ายประจำเดือน ----
    const recurring = [
      { v:'VEN-0012', no:'TNP-69-', desc:'ค่าเช่าอาคารสำนักงานและโกดัง', amt:'120000', sub:'admin_expense', wht:'WHT_RENT', day:1 },
      { v:'VEN-0009', no:'SBN-69-', desc:'ค่าขนส่งสินค้าประจำเดือน', amt:String(rint(60, 95) * 1000), sub:'selling_expense', wht:'WHT_TRANSPORT', day:25 },
      { v:'VEN-0025', no:'OFM-69-', desc:'วัสดุสิ้นเปลืองสำนักงาน', amt:String(rint(12, 28) * 1000), sub:'admin_expense', wht:null, day:12 },
      { v:'VEN-0030', no:'ENG-69-', desc:'ค่าน้ำมันรถยนต์นั่งผู้บริหาร', amt:String(rint(14, 22) * 1000), sub:'admin_expense', wht:null, day:20, nonClaim:true },
    ];
    if (mi % 2 === 0) {
      recurring.push({ v:'VEN-0015', no:'MDP-69-', desc:'ค่าโฆษณาออนไลน์', amt:'200000', sub:'selling_expense', wht:'WHT_ADVERT', day:18 });
    }
    if (mi % 3 === 1) {
      recurring.push({ v:'VEN-0021', no:'MAL-69-', desc:'ค่าที่ปรึกษาระบบบัญชี', amt:'50000', sub:'admin_expense', wht:'WHT_PROF', day:15 });
    }
    recurring.forEach(function (r, ri) {
      recordBill({
        date: mo + '-' + String(r.day).padStart(2, '0'),
        partnerCode: r.v, vendorNo: r.no + (mi * 10 + ri + 100),
        lines: [{ desc: r.desc, qty: 1, price: r.amt, expenseSub: r.sub }],
        whtCode: r.wht, nonClaimableVat: !!r.nonClaim,
      });
    });

    // ---- ใบลดหนี้เดือนละไม่เกิน 1 ใบ ----
    if (mi >= 1 && rnd() > 0.5) {
      const target = DB.docs.invoice.find((d) => periodOf(d.date) === mo && d.base > M('50000') && !d.credited);
      if (target) {
        try {
          issueCreditNote({ date: mo + '-' + String(Math.min(28, last)).padStart(2, '0'),
            invoiceNo: target.no, base: String(divRound(round2(divRound(target.base, 12)), S)),
            reason: pick(['RETURN_DEFECT','PRICE_REDUCE','CALC_ERROR']) });
        } catch (e) { /* ข้ามถ้าเงื่อนไขไม่ผ่าน */ }
      }
    }

    // ---- รับชำระใบที่ครบกำหนดแล้ว ----
    DB.docs.invoice.filter((d) => d.status === 'issued' && !d.broughtForward
        && d.due <= endOfMonth(mo + '-01') && d.due >= '2026-01-01')
      .forEach(function (inv) {
        const hasService = inv.lines.some((l) => l.desc.indexOf('ค่า') === 0);
        try {
          receivePayment({ date: inv.due, invoiceNo: inv.no,
            method: pick(['transfer','transfer','cheque','promptpay']),
            whtCode: hasService ? 'WHT_SERVICE' : null });
        } catch (e) { /* ข้าม */ }
      });

    // ---- จ่ายชำระเจ้าหนี้ที่ครบกำหนด ----
    DB.docs.bill.filter((b) => b.status === 'issued' && !b.broughtForward
        && b.due <= endOfMonth(mo + '-01'))
      .forEach(function (bill) {
        try {
          payBill({ date: bill.due, billNo: bill.no,
            channel: bill.whtCode && rnd() > 0.5 ? 'e_wht' : 'manual',
            whtCode: bill.whtCode });
        } catch (e) { /* ข้าม */ }
      });

    // ---- ดอกเบี้ยเงินกู้และค่าธรรมเนียมธนาคาร ----
    const finCost = M(String(rint(18, 26) * 1000));
    post({
      type: 'general', date: endOfMonth(mo + '-01'),
      desc: 'ดอกเบี้ยเงินกู้และค่าธรรมเนียมธนาคารประจำเดือน',
      lines: [
        { acc: accBySub('finance_cost'), dr: finCost },
        { acc: accBySub('bank'), cr: finCost },
      ],
    });

    // ---- งานสิ้นงวด: ทำเฉพาะงวดที่ปิดไปแล้ว ----
    if (mo <= CLOSED_THROUGH) {
      runPayroll(mo);
      runDepreciation(mo);
      fileVat(mo);
      ['PND1','PND3','PND53'].forEach(function (f) {
        try { fileWht(mo, f); } catch (e) { /* ไม่มีรายการก็ข้าม */ }
      });
    }
  });

  // ---- รายการเดินบัญชีที่ยังไม่กระทบยอด (เดือน ก.ค.) ----
  DB.bankTxns = [
    { id:1, date:'2026-07-03', desc:'INTEREST RECEIVED', ref:'INT690703', debit:0, credit:M('1842'), matched:false, suggest:'ดอกเบี้ยรับ — ยังไม่มีรายการในระบบ' },
    { id:2, date:'2026-07-08', desc:'FEE - REMITTANCE', ref:'FEE690708', debit:M('350'), credit:0, matched:false, suggest:'ค่าธรรมเนียมโอนเงิน — ยังไม่มีรายการในระบบ' },
    { id:3, date:'2026-07-15', desc:'TRANSFER FROM 6890', ref:'TR690715', debit:0, credit:M('240000'), matched:false, suggest:'ไม่แน่ใจ — มีใบแจ้งหนี้ยอดใกล้เคียง 3 ใบ' },
  ];
}
