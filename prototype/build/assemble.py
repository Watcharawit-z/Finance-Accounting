# -*- coding: utf-8 -*-
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from parts import SIDEBAR, PANES, DASH

CSS = r"""
:root{
  --paper:#FFFFFF; --canvas:#F6F7F9; --sunken:#EFF2F5;
  --ink-900:#14181F; --ink-700:#3A424E; --ink-500:#6B7480; --ink-300:#A2ABB6;
  --line-200:#E1E6EB; --line-100:#EDF0F4;
  --brand-700:#0F3A4D; --brand-600:#14556F; --brand-500:#1C6F8F; --brand-100:#E4EFF4;
  --on-brand:#FFFFFF;
  --pos-600:#17694A; --pos-100:#E6F2ED;
  --neg-600:#A32B2B; --neg-100:#FAEAEA;
  --warn-600:#8A5A10; --warn-100:#FBF1DE;
  --shadow-1:0 1px 2px rgba(20,24,31,.06);
  --shadow-2:0 6px 20px rgba(20,24,31,.09);
  --radius:6px;
  --sans:"IBM Plex Sans Thai","IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --paper:#171B21; --canvas:#0F1216; --sunken:#1D222A;
    --ink-900:#E9ECF0; --ink-700:#B7BFC9; --ink-500:#8A939E; --ink-300:#5E6773;
    --line-200:#282E37; --line-100:#22272F;
    --brand-700:#8FC4DA; --brand-600:#6FB0CB; --brand-500:#8FC4DA; --brand-100:#1B2C36;
    --on-brand:#0F1216;
    --pos-600:#5FBF95; --pos-100:#152A22;
    --neg-600:#E08585; --neg-100:#2E1B1B;
    --warn-600:#DCAE62; --warn-100:#2C2417;
    --shadow-1:0 1px 2px rgba(0,0,0,.4); --shadow-2:0 6px 20px rgba(0,0,0,.5);
  }
}
:root[data-theme="dark"]{
  --paper:#171B21; --canvas:#0F1216; --sunken:#1D222A;
  --ink-900:#E9ECF0; --ink-700:#B7BFC9; --ink-500:#8A939E; --ink-300:#5E6773;
  --line-200:#282E37; --line-100:#22272F;
  --brand-700:#8FC4DA; --brand-600:#6FB0CB; --brand-500:#8FC4DA; --brand-100:#1B2C36;
  --on-brand:#0F1216;
  --pos-600:#5FBF95; --pos-100:#152A22;
  --neg-600:#E08585; --neg-100:#2E1B1B;
  --warn-600:#DCAE62; --warn-100:#2C2417;
  --shadow-1:0 1px 2px rgba(0,0,0,.4); --shadow-2:0 6px 20px rgba(0,0,0,.5);
}
*{box-sizing:border-box}
body{margin:0;background:var(--canvas);color:var(--ink-900);font-family:var(--sans);
     font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{margin:0;font-weight:600;text-wrap:balance;letter-spacing:-.015em}
p{margin:0}
a{color:inherit}
.num{font-variant-numeric:tabular-nums;text-align:right;letter-spacing:-.01em}
.ctr{text-align:center}
.mono{font-family:var(--mono);font-size:.92em}
.dim{color:var(--ink-500)}
.neg{color:var(--neg-600)}
.wrap{max-width:1240px;margin:0 auto;padding:0 24px}

/* NAV */
.nav{position:sticky;top:0;z-index:50;background:var(--paper);border-bottom:1px solid var(--line-200)}
.nav-in{display:flex;align-items:center;gap:28px;height:56px}
.brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:.02em;font-size:16px}
.brand-mark{width:22px;height:22px;border:1.5px solid var(--brand-600);border-radius:3px;
  display:grid;place-items:center;color:var(--brand-600);font-size:11px;font-weight:700;font-family:var(--mono)}
.nav a.link{color:var(--ink-700);text-decoration:none;font-size:13.5px}
.nav a.link:hover{color:var(--ink-900)}
.nav-links{display:flex;gap:22px;margin-inline-start:8px}
.nav-right{margin-inline-start:auto;display:flex;align-items:center;gap:14px}
.btn{display:inline-flex;align-items:center;gap:7px;height:34px;padding:0 14px;border-radius:var(--radius);
  border:1px solid var(--line-200);background:var(--paper);color:var(--ink-900);font:inherit;font-size:13.5px;
  font-weight:500;cursor:pointer;text-decoration:none;white-space:nowrap}
.btn:hover{background:var(--sunken)}
.btn.sm{height:30px}
.btn-primary{background:var(--brand-600);border-color:var(--brand-600);color:var(--on-brand)}
.btn-primary:hover{background:var(--brand-700);border-color:var(--brand-700)}
.btn:focus-visible,.chip:focus-visible,.tab:focus-visible,.nav-item:focus-visible{outline:2px solid var(--brand-600);outline-offset:2px}

/* HERO */
.hero{border-bottom:1px solid var(--line-200);background:var(--paper);padding:60px 0}
.hero-grid{display:grid;grid-template-columns:minmax(0,400px) minmax(0,1fr);gap:52px;align-items:start}
.eyebrow{font-family:var(--mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--ink-500);margin-bottom:14px}
.hero h1{font-size:36px;line-height:1.25;margin-bottom:16px}
.hero p.lede{color:var(--ink-700);font-size:15.5px;max-width:44ch}
.hero-actions{display:flex;gap:10px;margin-top:24px;flex-wrap:wrap}
.hero-note{margin-top:16px;font-size:12.5px;color:var(--ink-500)}
.facts{display:flex;margin-top:34px;border-top:1px solid var(--line-200)}
.fact{flex:1;padding:14px 16px 0 0}
.fact b{display:block;font-size:20px;font-weight:600;font-variant-numeric:tabular-nums}
.fact span{font-size:11.5px;color:var(--ink-500)}

/* APP WINDOW */
.win{border:1px solid var(--line-200);border-radius:8px;overflow:hidden;background:var(--paper);box-shadow:var(--shadow-2)}
.win-bar{display:flex;align-items:center;gap:10px;height:36px;padding:0 12px;background:var(--sunken);
  border-bottom:1px solid var(--line-200);font-size:11.5px;color:var(--ink-500)}
.dots{display:flex;gap:5px}
.dots i{width:9px;height:9px;border-radius:50%;background:var(--line-200);display:block}
.win-url{font-family:var(--mono);font-size:11px}
.app{display:grid;grid-template-columns:212px minmax(0,1fr);min-height:520px}
.side{border-inline-end:1px solid var(--line-200);background:var(--paper);padding:10px 8px;
  max-height:640px;overflow-y:auto}
.side-h{font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-300);padding:10px 8px 4px}
.side a{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:5px 8px;border-radius:4px;
  text-decoration:none;color:var(--ink-700);font-size:12.5px}
.side a:hover{background:var(--sunken)}
.side a.on{background:var(--brand-100);color:var(--brand-700);font-weight:600}
.side .badge{font-size:10.5px;color:var(--neg-600);background:var(--neg-100);padding:1px 6px;border-radius:10px;font-variant-numeric:tabular-nums}
.main{min-width:0;display:flex;flex-direction:column}
.topbar{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--line-200)}
.topbar h3{font-size:15px}
.topbar h3 .sub{font-weight:400;color:var(--ink-500);font-size:12px}
.crumb{font-size:11.5px;color:var(--ink-500)}
.spacer{margin-inline-start:auto}
.chip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 9px;border:1px solid var(--line-200);
  border-radius:4px;font-size:12px;color:var(--ink-700);background:var(--paper);cursor:pointer;font-family:inherit}
.chip.on{border-color:var(--brand-600);color:var(--brand-700);background:var(--brand-100)}
.filters{display:flex;gap:7px;padding:9px 16px;border-bottom:1px solid var(--line-200);background:var(--paper);flex-wrap:wrap}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line-200)}
.kpi{padding:13px 16px;border-inline-end:1px solid var(--line-200)}
.kpi:last-child{border-inline-end:0}
.kpi .lbl{font-size:11.5px;color:var(--ink-500)}
.kpi .val{font-size:21px;font-weight:600;font-variant-numeric:tabular-nums;margin-top:3px;letter-spacing:-.02em}
.kpi .delta{font-size:11.5px;margin-top:2px;font-variant-numeric:tabular-nums;color:var(--ink-500)}
.kpi .delta.up{color:var(--pos-600)} .kpi .delta.down{color:var(--neg-600)}
.spark{margin-top:6px;display:block;width:100%;height:26px}

/* TABLES */
.tbl{width:100%;border-collapse:collapse;font-size:12.5px}
.tbl th{text-align:left;font-weight:500;color:var(--ink-500);font-size:11px;letter-spacing:.03em;text-transform:uppercase;
  padding:7px 12px;background:var(--line-100);border-bottom:1px solid var(--line-200);position:sticky;top:0;white-space:nowrap}
.tbl th.r{text-align:right} .tbl th.c{text-align:center}
.tbl td{padding:7px 12px;border-bottom:1px solid var(--line-100);white-space:nowrap}
.tbl tbody tr:hover{background:var(--sunken)}
.tbl tfoot td{padding:9px 12px;border-top:1.5px solid var(--line-200);font-weight:600;background:var(--paper);
  position:sticky;bottom:0}
.tbl.bordered{border:1px solid var(--line-200);border-radius:4px;overflow:hidden;margin-top:2px}
.tbl.mini{font-size:11.5px;margin-top:6px}
.tbl.mini td{padding:4px 6px}
.scroll{overflow:auto;flex:1;max-height:520px}
.st{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;white-space:nowrap}
.st::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.st.paid{color:var(--pos-600)} .st.open{color:var(--brand-600)}
.st.late{color:var(--neg-600)} .st.draft{color:var(--ink-500)} .st.wait{color:var(--warn-600)}
.rowbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 16px;
  border-top:1px solid var(--line-200);font-size:11.5px;color:var(--ink-500);white-space:normal}

/* REPORT ROWS */
.report .tbl td{white-space:normal}
.report .r-h td{font-weight:600;padding-top:12px;background:var(--line-100)}
.report .r-h2 td{font-weight:600;color:var(--ink-700);padding-top:10px}
.report .r-i td:first-child{padding-inline-start:28px}
.report .r-s td{font-weight:600;border-top:1px solid var(--line-200)}
.report .r-s td:first-child{padding-inline-start:16px}
.report .r-t td{font-weight:700;border-top:1.5px solid var(--ink-900);border-bottom:3px double var(--ink-900)}
.report .r-sp td{height:10px;border-bottom:0}
.report tbody tr.r-sp:hover{background:transparent}

/* FORM SCREEN */
.form{display:grid;grid-template-columns:minmax(0,1fr) 250px;flex:1}
.form-main{padding:14px 16px;min-width:0;overflow-x:auto}
.form-side{border-inline-start:1px solid var(--line-200);padding:14px 16px;background:var(--sunken);min-width:0;overflow-x:auto}
.fgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px}
label.f{display:block;font-size:11px;color:var(--ink-500);margin-bottom:4px;letter-spacing:.02em}
.fld{height:30px;border:1px solid var(--line-200);border-radius:4px;background:var(--paper);display:flex;
  align-items:center;padding:0 9px;font-size:12.5px;color:var(--ink-900)}
.callout{margin-top:14px;padding:10px 12px;border-radius:4px;font-size:12px}
.callout.warn{border:1px solid var(--warn-600);background:var(--warn-100);color:var(--warn-600)}
.callout b{display:block;font-size:12.5px;margin-bottom:2px}
.sum{display:flex;justify-content:space-between;font-size:12.5px;padding:5px 0}
.sum.total{border-top:1px solid var(--line-200);margin-top:6px;padding-top:9px;font-weight:600;font-size:14px}
.side-cap{margin-top:16px;font-size:11.5px;color:var(--ink-500)}
.keys{margin-top:16px;padding-top:12px;border-top:1px solid var(--line-200);font-size:11.5px;color:var(--ink-500)}
.keys div{display:flex;justify-content:space-between;padding:3px 0}
kbd{font-family:var(--mono);font-size:10.5px;border:1px solid var(--line-200);border-bottom-width:2px;
  border-radius:3px;padding:1px 5px;background:var(--paper);color:var(--ink-700)}

/* SECTIONS */
section{padding:76px 0;border-bottom:1px solid var(--line-200)}
.sec-h{max-width:64ch;margin-bottom:28px}
.sec-h h2{font-size:26px;margin-bottom:10px}
.sec-h p{color:var(--ink-700);font-size:15px}
.kicker{font-family:var(--mono);font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--brand-600);margin-bottom:10px}
.nav-item{cursor:pointer}
.pane[hidden]{display:none}

/* COMPLIANCE */
.comp{display:grid;grid-template-columns:repeat(auto-fill,minmax(238px,1fr));border:1px solid var(--line-200);
  border-radius:var(--radius);overflow:hidden;background:var(--paper)}
.comp div{padding:14px 16px;border-inline-end:1px solid var(--line-100);border-bottom:1px solid var(--line-100)}
.comp b{display:block;font-size:13.5px;font-weight:600}
.comp span{font-size:12px;color:var(--ink-500)}
.comp .ok{color:var(--pos-600);font-size:11.5px;font-weight:600;display:block;margin-top:5px;font-family:var(--mono)}

/* PRICING */
.price{display:grid;grid-template-columns:repeat(auto-fit,minmax(216px,1fr));gap:14px}
.card{border:1px solid var(--line-200);border-radius:var(--radius);background:var(--paper);padding:20px}
.card.hi{border-color:var(--brand-600);box-shadow:var(--shadow-1)}
.card h4{font-size:14px;margin-bottom:4px}
.card .amt{font-size:26px;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.card .amt small{font-size:12px;font-weight:400;color:var(--ink-500);letter-spacing:0}
.card ul{margin:14px 0 0;padding:0;list-style:none;font-size:12.5px;color:var(--ink-700)}
.card li{padding:4px 0 4px 18px;position:relative}
.card li::before{content:"—";position:absolute;left:0;color:var(--ink-300);font-family:var(--mono)}
.disclaimer{margin-top:28px;padding:14px 16px;border:1px solid var(--line-200);border-radius:var(--radius);
  background:var(--paper);font-size:12px;color:var(--ink-700)}
footer{padding:44px 0;color:var(--ink-500);font-size:12.5px}
.foot-grid{display:flex;gap:40px;flex-wrap:wrap;justify-content:space-between}

@media (max-width:980px){
  .hero-grid{grid-template-columns:1fr;gap:34px}
  .app{grid-template-columns:1fr}
  .side{display:none}
  .form{grid-template-columns:1fr}
  .form-side{border-inline-start:0;border-top:1px solid var(--line-200)}
  .kpis{grid-template-columns:repeat(2,1fr)}
  .kpi:nth-child(2){border-inline-end:0}
  .hero h1{font-size:29px}
  .fgrid{grid-template-columns:1fr 1fr}
}
@media (max-width:620px){
  .nav-links{display:none}
  .nav-in{gap:12px}
  .nav-right .link{display:none}
  .wrap{padding:0 16px}
  .fgrid{grid-template-columns:1fr}
  section{padding:52px 0}
  .hero{padding:40px 0}
  .facts{flex-wrap:wrap}
  .fact{flex:1 1 40%}
}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
"""

PAGE = """<title>DULY</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">
<style>@@CSS@@</style>

<nav class="nav">
  <div class="wrap nav-in">
    <span class="brand"><span class="brand-mark">D</span>DULY</span>
    <span class="nav-links">
      <a class="link" href="#screens">หน้าจอทั้งหมด</a>
      <a class="link" href="#compliance">กฎหมายไทย</a>
      <a class="link" href="#pricing">ราคา</a>
    </span>
    <span class="nav-right">
      <a class="link" href="#">เข้าสู่ระบบ</a>
      <a class="btn btn-primary" href="#pricing">ทดลองใช้ 30 วัน</a>
    </span>
  </div>
</nav>

<header class="hero">
  <div class="wrap hero-grid">
    <div>
      <div class="eyebrow">ระบบบัญชีและการเงิน · สำหรับธุรกิจไทย</div>
      <h1>ออกใบกำกับภาษี ยื่น ภ.พ.30 และปิดงบ<br>อยู่ในระบบเดียวกัน</h1>
      <p class="lede">DULY บันทึกทุกเอกสารเป็นรายการบัญชีคู่ตั้งแต่วินาทีที่ออก
        แบบภาษีทุกฉบับจึงสร้างจากตัวเลขจริง ไม่ต้องคีย์ซ้ำใน Excel อีกรอบ</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="#screens">ดูหน้าจอทั้ง 43 หน้า</a>
        <a class="btn" href="#compliance">รายการที่รองรับตามกฎหมาย</a>
      </div>
      <p class="hero-note">ไม่ต้องใช้บัตรเครดิต · ย้ายข้อมูลจากระบบเดิมให้ฟรี · เซิร์ฟเวอร์อยู่ในประเทศไทย</p>
      <div class="facts">
        <div class="fact"><b>5 วัน</b><span>ปิดงบเดือนโดยเฉลี่ย</span></div>
        <div class="fact"><b>13</b><span>แบบภาษีที่สร้างอัตโนมัติ</span></div>
        <div class="fact"><b>100%</b><span>ทุกยอดคลิกดูที่มาได้</span></div>
      </div>
    </div>
    <div class="win">
      <div class="win-bar"><span class="dots"><i></i><i></i><i></i></span>
        <span class="win-url">app.duly.co.th/dashboard</span></div>
      <div class="app">
        <aside class="side">
          <div class="side-h">บจก. ศรีวัฒนาการค้า</div>
          <a class="on" href="#screens">ภาพรวม</a>
          <a href="#screens">ขายและลูกหนี้ <span class="badge">7</span></a>
          <a href="#screens">ซื้อและเจ้าหนี้</a>
          <a href="#screens">ธนาคาร <span class="badge">3</span></a>
          <a href="#screens">บัญชีแยกประเภท</a>
          <a href="#screens">ภาษี</a>
          <a href="#screens">สินค้าคงคลัง</a>
          <a href="#screens">สินทรัพย์ถาวร</a>
          <a href="#screens">รายงาน</a>
        </aside>
        <div class="main">@@DASH@@</div>
      </div>
    </div>
  </div>
</header>

<section id="screens">
  <div class="wrap">
    <div class="sec-h">
      <div class="kicker">ต้นแบบหน้าจอ · 43 หน้า ครอบคลุมทุกโมดูล</div>
      <h2>หน้าตาแบบที่คนทำบัญชีใช้ได้ทั้งวัน</h2>
      <p>ความหนาแน่นของข้อมูลสำคัญกว่าพื้นที่ว่าง ตัวเลขทุกตัวชิดขวาและใช้ฟอนต์ที่หลักตรงกัน
         ทุกยอดคลิกลงไปดูใบสำคัญต้นทางได้ และทำงานได้ด้วยคีย์บอร์ดล้วนตั้งแต่ต้นจนจบ
         — เลือกหน้าจากเมนูซ้ายเพื่อดูทีละหน้า</p>
    </div>
    <div class="win">
      <div class="win-bar"><span class="dots"><i></i><i></i><i></i></span>
        <span class="win-url" id="urlbar">app.duly.co.th/dashboard</span></div>
      <div class="app">
        <aside class="side" id="explorer-nav">@@SIDEBAR@@</aside>
        <div class="main" id="explorer-main">@@PANES@@</div>
      </div>
    </div>
  </div>
</section>

<section id="compliance">
  <div class="wrap">
    <div class="sec-h">
      <div class="kicker">ออกแบบตามกฎหมายไทยตั้งแต่โครงสร้างข้อมูล</div>
      <h2>สิ่งที่ระบบบัญชีจากต่างประเทศทำให้ไม่ได้</h2>
      <p>อัตราภาษีทุกตัวเก็บเป็นข้อมูลที่มีวันเริ่มและวันสิ้นสุด เมื่อกรมสรรพากรออกประกาศใหม่
         เราแก้ที่ตารางอัตรา ไม่ต้องรอรอบปล่อยเวอร์ชัน</p>
    </div>
    <div class="comp">
      <div><b>ใบกำกับภาษีเต็มรูป</b><span>ครบทุกรายการตามมาตรา 86/4 พร้อมระบุสำนักงานใหญ่/สาขา</span><span class="ok">รองรับ</span></div>
      <div><b>ใบเพิ่มหนี้ / ใบลดหนี้</b><span>บังคับอ้างอิงใบกำกับเดิมและเหตุผลตามกฎหมาย</span><span class="ok">รองรับ</span></div>
      <div><b>รายงานภาษีซื้อ–ขาย</b><span>รูปแบบตามประกาศอธิบดี แยกตามสาขา</span><span class="ok">รองรับ</span></div>
      <div><b>ภ.พ.30 · ภ.พ.36</b><span>สร้างจากรายการจริง กระทบยอดกับบัญชีแยกประเภทอัตโนมัติ</span><span class="ok">รองรับ</span></div>
      <div><b>ภ.ง.ด.1 · 1ก · 2 · 3 · 53 · 54</b><span>สร้างไฟล์นำส่งกรมสรรพากรได้โดยตรง</span><span class="ok">รองรับ</span></div>
      <div><b>หนังสือรับรองหัก ณ ที่จ่าย</b><span>50 ทวิ ฉบับที่ 1 และ 2 พร้อมเลขที่เล่ม/เลขที่</span><span class="ok">รองรับ</span></div>
      <div><b>e-Tax Invoice &amp; e-Receipt</b><span>สร้าง XML ลงลายมือชื่อดิจิทัล และติดตามผลตอบกลับ</span><span class="ok">รองรับ</span></div>
      <div><b>e-Withholding Tax</b><span>กันรายการที่ธนาคารนำส่งแทนออกจาก ภ.ง.ด.3/53 ไม่ให้ส่งซ้ำ</span><span class="ok">รองรับ</span></div>
      <div><b>ภ.ง.ด.51</b><span>เตือนล่วงหน้าเมื่อประมาณการกำไรสุทธิเสี่ยงขาดเกิน 25%</span><span class="ok">รองรับ</span></div>
      <div><b>ภ.ง.ด.50</b><span>กระดาษทำการกระทบยอดบัญชีกับภาษี รายจ่ายต้องห้าม ค่าเสื่อมทางภาษี</span><span class="ok">รองรับ</span></div>
      <div><b>ประกันสังคม สปส.1-10</b><span>คำนวณตามเพดานค่าจ้างที่มีผลในเดือนนั้น (2569 = 17,500)</span><span class="ok">รองรับ</span></div>
      <div><b>นำส่งงบการเงิน DBD</b><span>สร้างไฟล์ XBRL และเตือนกำหนด 5 เดือนหลังสิ้นรอบบัญชี</span><span class="ok">รองรับ</span></div>
      <div><b>พ.ร.บ.การบัญชี 2543</b><span>สมุดรายวันครบ 5 เล่ม เก็บเอกสารขั้นต่ำ 5 ปี ห้ามแก้รายการที่ลงบัญชีแล้ว</span><span class="ok">รองรับ</span></div>
      <div><b>TFRS for NPAEs (2565)</b><span>งบการเงินและหมายเหตุประกอบตามมาตรฐานที่บังคับใช้ปี 2566</span><span class="ok">รองรับ</span></div>
      <div><b>PDPA</b><span>บันทึกการเข้าถึงและส่งออกข้อมูล จัดการคำขอใช้สิทธิของเจ้าของข้อมูล</span><span class="ok">รองรับ</span></div>
      <div><b>ผู้สอบบัญชี</b><span>สิทธิ์อ่านอย่างเดียว เห็นร่องรอยการแก้ไขทุกบรรทัดพร้อมค่าเดิม–ค่าใหม่</span><span class="ok">รองรับ</span></div>
    </div>
  </div>
</section>

<section id="pricing">
  <div class="wrap">
    <div class="sec-h">
      <div class="kicker">ราคา</div>
      <h2>คิดตามขนาดทีม ไม่คิดตามจำนวนใบกำกับภาษี</h2>
      <p>ออกเอกสารได้ไม่จำกัดทุกแพ็กเกจ ข้อมูลของคุณส่งออกได้ทั้งหมดตลอดเวลา ไม่มีการล็อกข้อมูลไว้กับเรา</p>
    </div>
    <div class="price">
      <div class="card"><h4>Core</h4><div class="amt">1,900 <small>บาท/เดือน</small></div>
        <ul><li>ผู้ใช้ 3 คน</li><li>บัญชีแยกประเภท ลูกหนี้ เจ้าหนี้</li><li>ธนาคารและการกระทบยอด</li><li>VAT และภาษีหัก ณ ที่จ่าย</li><li>งบการเงินตามกฎหมาย</li></ul></div>
      <div class="card hi"><h4>Business <span style="font-weight:400;color:var(--brand-600);font-size:11.5px">· เหมาะกับบริษัทส่วนใหญ่</span></h4>
        <div class="amt">4,900 <small>บาท/เดือน</small></div>
        <ul><li>ผู้ใช้ 10 คน</li><li>ทุกอย่างใน Core</li><li>สินค้าคงคลังและต้นทุน</li><li>ทรัพย์สินถาวรและค่าเสื่อม</li><li>งบประมาณ มิติ และโครงการ</li><li>สายอนุมัติ และ e-Tax Invoice</li></ul></div>
      <div class="card"><h4>Enterprise</h4><div class="amt">12,900 <small>บาท/เดือนขึ้นไป</small></div>
        <ul><li>ผู้ใช้ไม่จำกัด</li><li>หลายบริษัทและงบการเงินรวม</li><li>SSO และ API เต็มรูปแบบ</li><li>เชื่อมต่อธนาคารโดยตรง</li><li>SLA และผู้ดูแลเฉพาะราย</li></ul></div>
      <div class="card"><h4>สำนักงานบัญชี</h4><div class="amt">ตามจำนวนบริษัท</div>
        <ul><li>พื้นที่ทำงานรวมทุกลูกค้า</li><li>สลับบริษัทในคลิกเดียว</li><li>ปฏิทินภาษีรวมทุกราย</li><li>ผังบัญชีมาตรฐานใช้ซ้ำได้</li></ul></div>
    </div>
    <div class="disclaimer">
      <b>หมายเหตุ</b> — หน้านี้เป็นต้นแบบการออกแบบ (design prototype) ประกอบเอกสารการวางระบบ
      ตัวเลข ชื่อบริษัท และเลขประจำตัวผู้เสียภาษีทั้งหมดเป็นข้อมูลสมมติ
      ข้อมูลกฎหมายและอัตราภาษีอ้างอิงข้อมูลสาธารณะ ณ ปี 2569 และต้องให้ผู้สอบบัญชีหรือที่ปรึกษาภาษีตรวจสอบก่อนใช้งานจริง
    </div>
  </div>
</section>

<footer>
  <div class="wrap foot-grid">
    <div><span class="brand" style="font-size:14px"><span class="brand-mark" style="width:19px;height:19px;font-size:10px">D</span>DULY</span>
      <p style="margin-top:8px">ระบบบัญชีและการเงินสำหรับธุรกิจไทย</p></div>
    <div>ผลิตภัณฑ์<br>บัญชีแยกประเภท · ลูกหนี้ · เจ้าหนี้ · ภาษี · รายงาน</div>
    <div>ทรัพยากร<br>คู่มือการใช้งาน · เอกสาร API · สถานะระบบ</div>
    <div>บริษัท<br>เกี่ยวกับเรา · นโยบายความเป็นส่วนตัว · ข้อตกลงประมวลผลข้อมูล</div>
  </div>
</footer>

<script>
(function () {
  var nav = document.getElementById('explorer-nav');
  var items = nav.querySelectorAll('.nav-item');
  var urlbar = document.getElementById('urlbar');
  function show(id) {
    document.querySelectorAll('.pane').forEach(function (p) { p.hidden = true; });
    var pane = document.getElementById('pane-' + id);
    if (pane) pane.hidden = false;
    items.forEach(function (a) { a.classList.toggle('on', a.dataset.s === id); });
    urlbar.textContent = 'app.duly.co.th/' + id;
  }
  items.forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); show(a.dataset.s); });
  });
  show(items[0].dataset.s);
})();
</script>
"""

out = (PAGE.replace("@@CSS@@", CSS).replace("@@DASH@@", DASH)
         .replace("@@SIDEBAR@@", SIDEBAR).replace("@@PANES@@", PANES))
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
target = "/home/user/Finance-Accounting/prototype/index.html"
open(target, "w", encoding="utf-8").write(out)
print("wrote", target, len(out), "bytes")
