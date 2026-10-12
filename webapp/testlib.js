/* ตัวโหลดเครื่องบัญชีสำหรับชุดทดสอบแยกระบบ (test-*.js)
   โหลดทุกไฟล์ใน src ที่ไม่ใช่หน้าจอ ตามลำดับเดียวกับ build.js แล้วส่งออกทุกชื่อระดับบนสุดอัตโนมัติ
   ใช้: const { ctx, ok, throws, done } = require('./testlib'); ... done(); */
const fs = require('fs');
const path = require('path');
const { ORDER } = require('./build.js');

const files = ORDER.filter((f) => !/^ui-|^sync\.js$/.test(f));
const src = files.map((f) => fs.readFileSync(path.join(__dirname, 'src', f), 'utf8')).join('\n');
const names = [];
const re = /^(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=)/gm;
let m;
while ((m = re.exec(src))) { const n = m[1] || m[2]; if (names.indexOf(n) < 0) names.push(n); }
const ctx = new Function(src + '\nreturn {' + names.map((n) => n + ': (typeof ' + n + " !== 'undefined' ? " + n + ' : undefined)').join(',') + '};')();

let pass = 0, fail = 0;
function ok(label, cond, extra) {
  if (cond) { pass++; console.log('  ผ่าน   ' + label + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ไม่ผ่าน ' + label + (extra ? '  ' + extra : '')); }
}
function throws(label, fn, code) {
  try { fn(); fail++; console.log('  ไม่ผ่าน ' + label + ' — ไม่ได้ถูกปฏิเสธ'); }
  catch (e) {
    if (e.code === code) { pass++; console.log('  ผ่าน   ' + label + ' → ' + String(e.message).slice(0, 70)); }
    else { fail++; console.log('  ไม่ผ่าน ' + label + ' — ได้ ' + (e.code || e.message)); }
  }
}
function done() {
  console.log('\n════════════════════════════════════════');
  console.log(' ผ่าน ' + pass + ' ข้อ · ไม่ผ่าน ' + fail + ' ข้อ');
  console.log('════════════════════════════════════════');
  process.exit(fail ? 1 : 0);
}
module.exports = { ctx, ok, throws, done };
