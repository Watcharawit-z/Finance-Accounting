/* รวมทุกไฟล์เป็น index.html ไฟล์เดียว เปิดได้โดยไม่ต้องติดตั้งอะไร */
const fs = require('fs');
const path = require('path');

const ORDER = ['engine.js', 'operations.js', 'seed.js', 'ui-core.js', 'ui-screens.js', 'ui-actions.js'];
const dir = path.join(__dirname, 'src');

/* กันชื่อชนกันระหว่างไฟล์ เพราะทุกไฟล์จะอยู่ในสโคปเดียวกัน */
const seen = new Map();
const parts = ORDER.map(function (f) {
  const code = fs.readFileSync(path.join(dir, f), 'utf8');
  const re = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = re.exec(code))) {
    if (seen.has(m[1])) {
      throw new Error('ชื่อซ้ำข้ามไฟล์: ' + m[1] + ' อยู่ทั้งใน ' + seen.get(m[1]) + ' และ ' + f);
    }
    seen.set(m[1], f);
  }
  return '/* ===== ' + f + ' ===== */\n' + code;
});

const script = parts.join('\n\n') + '\nboot();\n';
const shell = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8');
const out = shell.replace('/*__SCRIPT__*/', function () { return script; });
fs.writeFileSync(path.join(__dirname, 'index.html'), out);
console.log('index.html — ' + (out.length / 1024).toFixed(0) + ' KB · ' + seen.size + ' สัญลักษณ์ระดับบนสุด');
