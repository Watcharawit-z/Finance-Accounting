/* ===================================================================
   กราฟ — วาดเป็น SVG ตรง ๆ ไม่พึ่งไลบรารีภายนอก
   ทุกสีดึงจากโทเคนธีม จึงถูกต้องทั้งธีมสว่างและธีมมืด
   =================================================================== */

const CH = { w: 720, h: 236, top: 14, right: 14, bottom: 30, left: 62 };
const plotW = () => CH.w - CH.left - CH.right;
const plotH = () => CH.h - CH.top - CH.bottom;

/* ตัวเลขบนแกน — หน่วยล้านบาท อ่านง่ายกว่าเลขเต็ม */
const axisM = (v) => (v / S / 1000000).toFixed(v / S / 1000000 >= 10 ? 0 : 1);
const tip = (label, value) => ' data-tip="' + esc(label + ' · ' + fmt(value) + ' บาท') + '"';

/** ขั้นแกนที่ลงตัว 1 / 2 / 2.5 / 5 × 10^n */
function niceMax(v, ticks) {
  if (v <= 0) return { max: 1, step: 1 };
  const raw = v / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const mult = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) || 10;
  const step = mult * mag;
  return { max: step * ticks, step };
}

function gridY(max, ticks, showZero) {
  let g = '';
  for (let i = 0; i <= ticks; i++) {
    const y = CH.top + plotH() - (plotH() * i) / ticks;
    const v = (max * i) / ticks;
    g += '<line class="grid' + (i === 0 && showZero ? ' base' : '') + '" x1="' + CH.left + '" y1="' + y
      + '" x2="' + (CH.w - CH.right) + '" y2="' + y + '"/>'
      + '<text class="ax" x="' + (CH.left - 9) + '" y="' + (y + 4) + '" text-anchor="end">' + axisM(v) + '</text>';
  }
  return g;
}

/** มุมบนมนตามหลัก ปลายข้อมูลมน 4px ฐานตรงติดเส้นศูนย์ */
function barTop(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h);
  return 'M' + x + ' ' + (y + h) + 'V' + (y + rr) + 'a' + rr + ' ' + rr + ' 0 0 1 ' + rr + ' ' + -rr
    + 'h' + (w - rr * 2) + 'a' + rr + ' ' + rr + ' 0 0 1 ' + rr + ' ' + rr + 'V' + (y + h) + 'Z';
}

/* ---------- แท่งเปรียบเทียบ 2 ชุดข้อมูลรายเดือน ---------- */
function chartGrouped(rows, series, caption) {
  const peak = Math.max(1, ...rows.map((r) => Math.max(...series.map((s) => r[s.key]))));
  const { max } = niceMax(peak, 4);
  const band = plotW() / rows.length;
  const gap = 2;                                   // ช่องว่าง 2px ระหว่างแท่งที่ติดกัน
  const bw = Math.min(26, (band * 0.62 - gap * (series.length - 1)) / series.length);
  let bars = '';
  rows.forEach(function (r, i) {
    const cx = CH.left + band * i + band / 2;
    const total = bw * series.length + gap * (series.length - 1);
    series.forEach(function (s, j) {
      const h = Math.max(0, (r[s.key] / max) * plotH());
      const x = cx - total / 2 + j * (bw + gap);
      const y = CH.top + plotH() - h;
      bars += '<path class="mk" fill="var(' + s.color + ')" d="' + barTop(x, y, bw, h, 4) + '"'
        + tip(r.label + ' — ' + s.name, r[s.key]) + '></path>';
    });
    bars += '<text class="ax" x="' + cx + '" y="' + (CH.h - 10) + '" text-anchor="middle">' + esc(r.label) + '</text>';
  });
  return '<div class="chart-wrap">'
    + '<div class="legend">' + series.map((s) =>
        '<span><i style="background:var(' + s.color + ')"></i>' + esc(s.name) + '</span>').join('')
    + '<span class="grow"></span><span class="unit">' + esc(caption) + '</span></div>'
    + '<svg class="chart" viewBox="0 0 ' + CH.w + ' ' + CH.h + '" role="img">'
    + gridY(max, 4, true) + bars + '</svg></div>';
}

/* ---------- เส้นแนวโน้ม ---------- */
function chartLine(rows, key, name, caption) {
  const peak = Math.max(1, ...rows.map((r) => r[key]));
  const { max } = niceMax(peak, 4);
  const step = rows.length > 1 ? plotW() / (rows.length - 1) : 0;
  const px = (i) => CH.left + step * i;
  const py = (v) => CH.top + plotH() - (v / max) * plotH();
  const pts = rows.map((r, i) => px(i) + ' ' + py(r[key]));
  const line = 'M' + pts.join('L');
  const area = line + 'L' + px(rows.length - 1) + ' ' + (CH.top + plotH())
    + 'L' + px(0) + ' ' + (CH.top + plotH()) + 'Z';
  const last = rows[rows.length - 1];
  let dots = '', labels = '';
  rows.forEach(function (r, i) {
    const isLast = i === rows.length - 1;
    dots += '<circle class="mk dot' + (isLast ? ' end' : '') + '" cx="' + px(i) + '" cy="' + py(r[key])
      + '" r="' + (isLast ? 4.5 : 3.5) + '"' + tip(r.label + ' — ' + name, r[key]) + '></circle>';
    labels += '<text class="ax" x="' + px(i) + '" y="' + (CH.h - 10) + '" text-anchor="middle">' + esc(r.label) + '</text>';
  });
  return '<div class="chart-wrap">'
    + '<div class="legend"><span class="grow"></span><span class="unit">' + esc(caption) + '</span></div>'
    + '<svg class="chart" viewBox="0 0 ' + CH.w + ' ' + CH.h + '" role="img">'
    + gridY(max, 4, true)
    + '<path class="area" d="' + area + '"/><path class="line" d="' + line + '"/>'
    + dots + labels
    + '<text class="val" x="' + (px(rows.length - 1) - 6) + '" y="' + (py(last[key]) - 12)
    + '" text-anchor="end">' + fmt(last[key], 0) + '</text>'
    + '</svg></div>';
}

/* ---------- แท่งแนวนอนพร้อมค่ากำกับทุกแท่ง ---------- */
function chartBarsH(rows, caption) {
  const peak = Math.max(1, ...rows.map((r) => r.value));
  const rowH = 30, padL = 168, padR = 108;
  const h = rows.length * rowH + 10;
  const w = 720, barW = w - padL - padR;
  let body = '';
  rows.forEach(function (r, i) {
    const y = i * rowH + 5;
    const len = Math.max(2, (r.value / peak) * barW);
    body += '<text class="ax lbl" x="' + (padL - 12) + '" y="' + (y + 15) + '" text-anchor="end">' + esc(r.label) + '</text>'
      + '<rect class="track" x="' + padL + '" y="' + (y + 5) + '" width="' + barW + '" height="12" rx="4"/>'
      + '<rect class="mk" x="' + padL + '" y="' + (y + 5) + '" width="' + len + '" height="12" rx="4"'
      + ' fill="var(' + (r.color || '--s1') + ')"' + tip(r.label, r.value) + '></rect>'
      + '<text class="val" x="' + (padL + barW + 10) + '" y="' + (y + 15) + '">' + fmt(r.value, 0) + '</text>';
  });
  return '<div class="chart-wrap">'
    + '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" role="img">' + body + '</svg>'
    + (caption ? '<div class="legend"><span class="grow"></span><span class="unit">' + esc(caption) + '</span></div>' : '')
    + '</div>';
}

/* ---------- เส้นจิ๋วในกล่องตัวเลขสรุป ---------- */
function sparkline(values) {
  if (!values || values.length < 2) return '';
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = hi - lo || 1;
  const w = 108, h = 24, step = w / (values.length - 1);
  const pts = values.map((v, i) => (step * i).toFixed(1) + ' ' + (h - 2 - ((v - lo) / span) * (h - 6)).toFixed(1));
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
    + '<polyline points="' + pts.join(' ') + '"/>'
    + '<circle cx="' + (w - 1.5) + '" cy="' + (h - 2 - ((values[values.length - 1] - lo) / span) * (h - 6)).toFixed(1)
    + '" r="2.2"/></svg>';
}

/* ---------- ตัวเลขรายเดือนตั้งแต่ต้นปีถึงงวดที่เลือก ---------- */
function monthlySeries() {
  const yr = STATE.period.slice(0, 4);
  const upto = Number(STATE.period.slice(5, 7));
  const rows = [];
  for (let m = 1; m <= upto; m++) {
    const code = yr + '-' + String(m).padStart(2, '0');
    const from = code + '-01', to = endOfMonth(from);
    const revenue = -balanceOf((a) => a.type === 'revenue', to, from);
    const expense = balanceOf((a) => a.type === 'expense', to, from);
    rows.push({
      code, label: TH_M[m - 1], revenue, expense, net: revenue - expense,
      cash: balBySub(CASH_SUB, to),
      ar: DB.docs.invoice.filter((d) => d.status !== 'draft' && d.status !== 'void' && d.date <= to)
        .reduce((s, d) => s + outstandingAsOf('ar', d, to), 0),
      ap: DB.docs.bill.filter((d) => d.status !== 'draft' && d.status !== 'void' && d.date <= to)
        .reduce((s, d) => s + outstandingAsOf('ap', d, to), 0),
      assets: balanceOf((a) => a.type === 'asset', to),
    });
  }
  return rows;
}

/* ---------- ค่าใช้จ่ายสูงสุดของงวด ---------- */
function topExpenses(from, to, n) {
  const rows = DB.accounts.filter((a) => a.postable && a.type === 'expense')
    .map((a) => ({ label: a.name, code: a.code, value: balanceOf(a.code, to, from) }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const head = rows.slice(0, n);
  const rest = rows.slice(n).reduce((s, r) => s + r.value, 0);
  if (rest > 0) head.push({ label: 'ค่าใช้จ่ายอื่น ๆ รวม', code: null, value: rest });
  return head;
}
