# -*- coding: utf-8 -*-
import sys, os, html, itertools
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from screens_data import S

STATUS = {"paid","open","late","draft","wait"}
INLINE = {"m":"mono","d":"dim","n":"neg"}
RSTYLE = {"h":"r-h","h2":"r-h2","i":"r-i","s":"r-s","t":"r-t","sp":"r-sp"}
E = html.escape

def cell(c):
    if isinstance(c, tuple):
        k, t = c[0], c[1]
        if k in STATUS: return f'<span class="st {k}">{E(t)}</span>'
        if k in INLINE: return f'<span class="{INLINE[k]}">{E(t)}</span>'
        return E(t)
    return E(str(c))

def table(sc, foot_class="", report=False):
    cols = sc["cols"]
    out = ['<table class="tbl">', "<thead><tr>"]
    for label, al in cols:
        cls = ' class="r"' if al == "r" else (' class="c"' if al == "c" else "")
        out.append(f"<th{cls}>{E(label)}</th>")
    out.append("</tr></thead><tbody>")
    for row in sc.get("rows", []):
        rcls = ""
        if report and isinstance(row[0], tuple) and row[0][0] in RSTYLE:
            rcls = f' class="{RSTYLE[row[0][0]]}"'
        out.append(f"<tr{rcls}>")
        for i, c in enumerate(row):
            al = cols[i][1] if i < len(cols) else "l"
            cls = "num" if al == "r" else ("ctr" if al == "c" else "")
            out.append(f'<td class="{cls}">{cell(c)}</td>')
        out.append("</tr>")
    out.append("</tbody>")
    if sc.get("foot"):
        out.append("<tfoot><tr>")
        for i, c in enumerate(sc["foot"]):
            al = cols[i][1] if i < len(cols) else "l"
            cls = "num" if al == "r" else ""
            out.append(f'<td class="{cls}">{cell(c)}</td>')
        out.append("</tr></tfoot>")
    out.append("</table>")
    return "".join(out)

def kpis(sc):
    spark = {
      "line-up": '<polyline points="0,20 15,18 30,19 45,14 60,15 75,11 90,12 105,7 120,5" fill="none" stroke="var(--pos-600)" stroke-width="1.5"/><circle cx="120" cy="5" r="2" fill="var(--pos-600)"/>',
      "line-down": '<polyline points="0,10 15,12 30,9 45,13 60,11 75,16 90,14 105,18 120,17" fill="none" stroke="var(--neg-600)" stroke-width="1.5"/><circle cx="120" cy="17" r="2" fill="var(--neg-600)"/>',
      "bar": ''.join(f'<rect x="{x}" y="{y}" width="9" height="{26-y}" fill="var(--line-200)"/>' for x,y in [(4,14),(20,10),(36,16),(52,8),(68,12),(84,6)]) + '<rect x="100" y="3" width="9" height="23" fill="var(--brand-600)"/>',
    }
    out = ['<div class="kpis">']
    for lbl, val, delta, dcls, sk in sc["kpis"]:
        out.append(f'<div class="kpi"><div class="lbl">{E(lbl)}</div>'
                   f'<div class="val">{E(val)}</div>'
                   f'<div class="delta {dcls}">{E(delta)}</div>'
                   f'<svg class="spark" viewBox="0 0 120 26" preserveAspectRatio="none" aria-hidden="true">{spark[sk]}</svg></div>')
    out.append("</div>")
    return "".join(out)

FORM = """
<div class="form">
  <div class="form-main">
    <div class="fgrid">
      <div><label class="f">ลูกค้า</label><div class="fld">บจก. เอ็นเอส เอ็นจิเนียริ่ง</div></div>
      <div><label class="f">เลขประจำตัวผู้เสียภาษี</label><div class="fld mono">0105548021442</div></div>
      <div><label class="f">สาขา</label><div class="fld">สำนักงานใหญ่ (00000)</div></div>
      <div><label class="f">วันที่ใบกำกับภาษี</label><div class="fld">28 ม.ค. 2569</div></div>
      <div><label class="f">เงื่อนไขชำระ</label><div class="fld">เครดิต 30 วัน · ครบ 27 ก.พ. 2569</div></div>
      <div><label class="f">เลขที่</label><div class="fld mono dim">ออกให้เมื่อลงบัญชี</div></div>
    </div>
    <table class="tbl bordered">
      <thead><tr><th style="width:34px">#</th><th>รายการ</th><th class="r">จำนวน</th><th class="r">ราคา/หน่วย</th><th>ภาษี</th><th class="r">จำนวนเงิน</th></tr></thead>
      <tbody>
        <tr><td class="mono">1</td><td>ชุดควบคุมมอเตอร์ รุ่น MC-450 พร้อมติดตั้ง</td><td class="num">4</td><td class="num">158,000.00</td><td>VAT 7%</td><td class="num">632,000.00</td></tr>
        <tr><td class="mono">2</td><td>ค่าบริการออกแบบระบบไฟฟ้าโรงงาน</td><td class="num">1</td><td class="num">180,000.00</td><td>VAT 7%</td><td class="num">180,000.00</td></tr>
        <tr><td class="mono">3</td><td>ค่าขนส่งและติดตั้งหน้างาน จ.ระยอง</td><td class="num">1</td><td class="num">30,000.00</td><td>VAT 7%</td><td class="num">30,000.00</td></tr>
        <tr><td class="mono dim">4</td><td colspan="5" class="dim">พิมพ์รหัสสินค้าหรือชื่อ แล้วกด Enter เพื่อเพิ่มบรรทัด</td></tr>
      </tbody>
    </table>
    <div class="callout warn">
      <b>ยังแนบเอกสารประกอบไม่ครบ</b>
      <div>ใบสั่งซื้อจากลูกค้า (PO) ยังไม่ถูกแนบ — ระบบยังออกใบกำกับได้ แต่จะขึ้นเป็นงานค้างก่อนปิดงวด</div>
    </div>
  </div>
  <aside class="form-side">
    <div class="sum"><span>มูลค่าสินค้า/บริการ</span><span class="num">842,000.00</span></div>
    <div class="sum"><span>ส่วนลด</span><span class="num">0.00</span></div>
    <div class="sum"><span>ฐานภาษี</span><span class="num">842,000.00</span></div>
    <div class="sum"><span>ภาษีมูลค่าเพิ่ม 7%</span><span class="num">58,940.00</span></div>
    <div class="sum total"><span>รวมทั้งสิ้น</span><span class="num">900,940.00</span></div>
    <div class="side-cap">คู่บัญชีที่จะลง</div>
    <table class="tbl mini"><tbody>
      <tr><td class="mono">1131 ลูกหนี้การค้า</td><td class="num">900,940.00</td><td class="num dim">—</td></tr>
      <tr><td class="mono">4111 รายได้จากการขาย</td><td class="num dim">—</td><td class="num">842,000.00</td></tr>
      <tr><td class="mono">2141 ภาษีขาย</td><td class="num dim">—</td><td class="num">58,940.00</td></tr>
    </tbody></table>
    <div class="keys">
      <div><span>เพิ่มบรรทัด</span><kbd>Enter</kbd></div>
      <div><span>บันทึกร่าง</span><kbd>Ctrl S</kbd></div>
      <div><span>ออกเลขและลงบัญชี</span><kbd>Ctrl ⇧ P</kbd></div>
      <div><span>ค้นหาทุกอย่าง</span><kbd>Ctrl K</kbd></div>
    </div>
  </aside>
</div>"""

def screen_body(sc):
    k = sc["kind"]
    parts = []
    if sc.get("chips"):
        parts.append('<div class="filters">' + "".join(
            f'<button class="chip{" on" if i==0 else ""}">{E(c)}</button>' for i, c in enumerate(sc["chips"])) + "</div>")
    if k == "dashboard":
        parts.append(kpis(sc)); parts.append('<div class="scroll">' + table(sc) + "</div>")
    elif k == "form":
        parts.append(FORM)
    elif k == "report":
        parts.append('<div class="scroll report">' + table(sc, report=True) + "</div>")
    else:
        parts.append('<div class="scroll">' + table(sc) + "</div>")
    if sc.get("note"):
        parts.append(f'<div class="rowbar"><span>{E(sc["note"])}</span></div>')
    return "".join(parts)

def screen_html(sc, in_hero=False):
    sub = f' <span class="sub">· {E(sc["subtitle"])}</span>' if sc.get("subtitle") else ""
    btns = ""
    if sc.get("secondary"): btns += f'<button class="chip">{E(sc["secondary"])}</button>'
    if sc.get("primary"):   btns += f'<button class="btn btn-primary sm">{E(sc["primary"])}</button>'
    return (f'<div class="topbar"><div><div class="crumb">{E(sc["crumb"])}</div>'
            f'<h3>{E(sc["title"])}{sub}</h3></div><span class="spacer"></span>{btns}</div>'
            + screen_body(sc))

groups = []
for g, items in itertools.groupby(S, key=lambda x: x["group"]):
    groups.append((g, list(items)))

sidebar = []
for g, items in groups:
    sidebar.append(f'<div class="side-h">{E(g)}</div>')
    for sc in items:
        sidebar.append(f'<a href="#" class="nav-item" data-s="{sc["id"]}">{E(sc["nav"])}</a>')
SIDEBAR = "".join(sidebar)

PANES = "".join(f'<div class="pane" id="pane-{sc["id"]}" hidden>{screen_html(sc)}</div>' for sc in S)
DASH = screen_html(S[0])

print(len(S), "screens rendered")
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "parts.py"), "w", encoding="utf-8").write(
    "SIDEBAR = " + repr(SIDEBAR) + "\nPANES = " + repr(PANES) + "\nDASH = " + repr(DASH) + "\n")
