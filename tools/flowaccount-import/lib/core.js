/* ใช้คณิตศาสตร์เงินชุดเดียวกับตัวระบบ ไม่เขียนใหม่ ไม่ให้มีโอกาสเพี้ยนคนละทาง */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..');
const src = ['engine.js', 'import.js']
  .map((f) => fs.readFileSync(path.join(root, 'webapp', 'src', f), 'utf8'))
  .join('\n');

const api = new Function(src + `
  return { M, fmt, round2, pct, divRound, baseFromIncl, validTaxId, DomainError,
           parseCsv, parseAmount, detectColumns, readTrialBalance };`)();

/** จำนวนเต็มสเกล 4 → สตริงทศนิยม 4 ตำแหน่ง กลับไปกลับมาได้โดยไม่เสียค่า */
api.dec = function (v) {
  const neg = v < 0, a = Math.abs(v);
  const i = Math.floor(a / 10000);
  return (neg ? '-' : '') + i + '.' + String(a - i * 10000).padStart(4, '0');
};

module.exports = api;
