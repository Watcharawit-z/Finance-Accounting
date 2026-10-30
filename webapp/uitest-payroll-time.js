/* ทดสอบหน้าจอขาด ลา มาสาย ด้วยปุ่มและแบบฟอร์มจริง — รันด้วย node webapp/uitest-payroll-time.js (สร้าง index.html ก่อน)
   บันทึกรายการ → แผ่นงานเงินเดือนดึงยอดเอง → แก้ทับ/กลับไปใช้บันทึก → นำเข้าไฟล์สองแบบ → ทำเงินเดือน → สลิป → ล็อกบันทึก */
const fs = require('fs');
const path = require('path');
const T = require('./uitestlib');
const ok = T.ok;
function nid(p12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(p12[i]) * (13 - i);
  return p12 + ((11 - (sum % 11)) % 10);
}
const DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'att-'));

(async () => {
  const { page, errors } = await T.open();
  const go = (s) => page.evaluate((s) => dispatch('go:' + s), s);
  const toastText = () => page.evaluate(() => document.getElementById('toast').textContent);
  const cell = (code, f) => page.textContent('[data-pc="R|2026-01|' + code + '|' + f + '"]');
  await T.blank(page, '2026-01');
  await page.evaluate((ids) => {
    saveEmployee({ name: 'นายสาย ประจำ', dept: 'ขาย', nationalId: ids[0], salary: '30000', hired: '2025-01-01' });
    saveEmployee({ name: 'นางสาวขาด บ่อย', dept: 'บัญชี', nationalId: ids[1], salary: '12000', hired: '2025-06-01' });
    save(); render();
  }, [nid('110170023070'), nid('310050012345')]);

  console.log('\n[1] เมนูและหน้าขาด ลา มาสาย');
  await go('payroll');
  ok('หน้างวดจ่ายเงินเดือนมีปุ่มไปบันทึกขาด ลา มาสาย', !!await page.$('#main [data-act="go:attendance"]'));
  ok('★ แผ่นงานมีช่อง "ขาดงาน (วัน)" และ "มาสาย (นาที)" และคอลัมน์ "หักขาด ลา สาย"', await page.evaluate(() => {
    const th = Array.from(document.querySelectorAll('#main th')).map((x) => x.textContent);
    return th.includes('ขาดงาน (วัน)') && th.includes('มาสาย (นาที)') && th.includes('หักขาด ลา สาย')
      && !!document.querySelector('#main input.pay-in[data-emp="EMP-0001"][data-item="late"]')
      && !!document.querySelector('#main input.pay-in[data-emp="EMP-0001"][data-item="absent"]');
  }));
  await go('attendance');
  ok('เมนูเงินเดือนมี "ขาด ลา มาสาย" อยู่ถัดจากงวดจ่ายเงินเดือน', await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('#nav .nav-i')).map((e) => e.textContent.trim());
    return t.indexOf('ขาด ลา มาสาย') === t.indexOf('งวดจ่ายเงินเดือน') + 1;
  }));
  ok('หน้าขาด ลา มาสาย แสดงพนักงานทั้ง 2 คน ยังไม่มีรายการ', await page.evaluate(() => /ยังไม่มีบันทึกขาด ลา สาย/.test(document.getElementById('main').textContent)
    && !!document.querySelector('#main [data-act="attemp:EMP-0002"]')));

  console.log('\n[2] บันทึกรายการจากหน้าจอ');
  async function addAtt(o) {
    await page.click('#main [data-act="att:new"]');
    await page.waitForSelector('#modal.show');
    await page.selectOption('#modal [name="attCode"]', o.code);
    await page.fill('#modal [name="attDate"]', o.date);
    await page.selectOption('#modal [name="attType"]', o.type);
    if (o.minutes) await page.fill('#modal [name="attMinutes"]', String(o.minutes));
    if (o.days) await page.selectOption('#modal [name="attDays"]', String(o.days));
    if (o.note) await page.fill('#modal [name="attNote"]', o.note);
  }
  await addAtt({ code: 'EMP-0001', date: '2026-01-05', type: 'late', minutes: 25, note: 'รถติด' });
  ok('★ หน้าต่างบอกอัตราและยอดที่จะหักก่อนบันทึก (25 นาที = 52.08)', /วันละ 1,000\.00/.test(await page.textContent('#attRate'))
    && /รายการนี้หัก 52\.08/.test(await page.textContent('#attRate')), await page.textContent('#attRate'));
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  await addAtt({ code: 'EMP-0001', date: '2026-01-06', type: 'absent', days: '0.5' });
  ok('เลือกขาดงานแล้วช่องนาทีซ่อน ช่องวันขึ้น', await page.evaluate(() => document.querySelector('#modal [data-att-unit="minutes"]').hidden
    && !document.querySelector('#modal [data-att-unit="days"]').hidden));
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  await addAtt({ code: 'EMP-0002', date: '2026-01-07', type: 'absent', days: '1' });
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  await addAtt({ code: 'EMP-0001', date: '2026-01-06', type: 'absent', days: '1' });
  await page.click('#modal [data-act="modal:submit"]');
  await page.waitForTimeout(150);
  ok('ขาดซ้ำวันเดิมถูกปฏิเสธ หน้าต่างยังเปิดให้แก้', /อยู่แล้ว|เกิน 1 วัน/.test(await toastText())
    && await page.evaluate(() => document.getElementById('modal').classList.contains('show')));
  await page.click('#modal [data-act="modal:close"]');
  const sum = await page.evaluate(() => document.getElementById('main').textContent);
  ok('★ สรุปรายคน: สาย 25 นาที · ขาดครึ่งวัน · เงินหักรวม 552.08', /552\.08/.test(sum) && /0\.5 วัน/.test(sum));
  ok('รายการรายวันมี 3 รายการ แก้/ลบได้', await page.evaluate(() => document.querySelectorAll('#main [data-act^="att:del:"]').length === 3));

  console.log('\n[3] แผ่นงานเงินเดือนดึงยอดจากบันทึกเอง');
  await go('payroll');
  const lateIn = '#main input.pay-in[data-emp="EMP-0001"][data-item="late"]';
  ok('★ ช่องมาสาย 25 นาที ขาดงาน 0.5 วัน มาจากบันทึก (ตัวเลขจาง)', await page.inputValue(lateIn) === '25'
    && await page.inputValue('#main input.pay-in[data-emp="EMP-0001"][data-item="absent"]') === '0.5'
    && await page.evaluate((s) => document.querySelector(s).classList.contains('from-log'), lateIn));
  ok('คอลัมน์หักขาด ลา สาย = 552.08 · เงินเดือนแสดงเต็ม 30,000', await cell('EMP-0001', 'reduce') === '552.08' && await cell('EMP-0001', 'salary') === '30,000.00');
  ok('รวมเงินได้ = 30,000 − 552.08 = 29,447.92', await cell('EMP-0001', 'gross') === '29,447.92');
  ok('★ ขาด 1 วันของเงินเดือน 12,000: หัก 400 ประกันสังคมจาก 11,600 = 580', await cell('EMP-0002', 'reduce') === '400.00' && await cell('EMP-0002', 'sso') === '580.00');
  await page.fill(lateIn, '60');
  await page.press(lateIn, 'Tab');
  await page.waitForTimeout(150);
  ok('★ พิมพ์ทับ 60 นาที: หัก 125 + ขาด 500 = 625 และเตือนว่าไม่ตรงกับบันทึก', await cell('EMP-0001', 'reduce') === '625.00'
    && /ไม่ใช้บันทึกเวลา/.test(await page.textContent('[data-pc="R|2026-01|EMP-0001|warn"]')));
  await page.fill(lateIn, '');
  await page.press(lateIn, 'Tab');
  await page.waitForTimeout(150);
  ok('ลบจนว่าง กลับไปใช้บันทึก 25 นาที (เติมกลับให้เห็น)', await cell('EMP-0001', 'reduce') === '552.08' && await page.inputValue(lateIn) === '25');
  await page.click('#main [data-act="payline:R|2026-01:EMP-0001"]');
  await page.waitForSelector('#modal.show');
  ok('หน้าต่างรายการมีกลุ่มขาด ลา มาสาย บอกยอดจากบันทึกและอัตรา', await page.evaluate(() => {
    const t = document.getElementById('modal').textContent;
    return !!document.querySelector('#modal [name="pi_early"]') && !!document.querySelector('#modal [name="pi_unpaid"]')
      && /ตามบันทึกขาด ลา มาสาย 25 นาที/.test(t) && /ชั่วโมงละ 125\.00/.test(t);
  }));
  await page.fill('#modal [name="pi_unpaid"]', '1');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  ok('ใส่ลาไม่รับค่าจ้าง 1 วันจากหน้าต่างรายการ: หักรวม 1,552.08', await cell('EMP-0001', 'reduce') === '1,552.08');

  console.log('\n[4] นำเข้าไฟล์');
  const ev = path.join(DIR, 'att_event.csv');
  fs.writeFileSync(ev, '﻿รหัสพนักงาน,วันที่,ประเภท,นาที,วัน,หมายเหตุ\nEMP-0001,12/01/2569,มาสาย,10,,\nEMP-0002,2026-01-13,ลาไม่รับค่าจ้าง,,ครึ่งวัน,ลากิจ\n'
    + 'EMP-9999,2026-01-13,มาสาย,5,,\nEMP-0002,2026-01-14,ป่วย,,1,\n');
  await go('attendance');
  await page.click('#main [data-act="att:import"]');
  await page.waitForSelector('#modal.show');
  await page.setInputFiles('#attFile', ev);
  await page.waitForFunction(() => /นำเข้าได้/.test((document.getElementById('attPreview') || {}).textContent || ''));
  const pv = await page.textContent('#attPreview');
  ok('★ ตรวจไฟล์ก่อนนำเข้า: ได้ 2 รายการ ไม่ผ่าน 2 แถว (ไม่มีพนักงาน · ไม่รู้จักประเภท) วันที่ พ.ศ. อ่านได้',
    /นำเข้าได้ 2 รายการ/.test(pv) && /ไม่ผ่าน 2 แถว/.test(pv) && /ไม่พบพนักงาน/.test(pv) && /ไม่รู้จักประเภท/.test(pv), pv.slice(0, 200));
  ok('ยังไม่บันทึกอะไรระหว่างตรวจ', await page.evaluate(() => attendanceList().length === 3));
  ok('มีปุ่มดาวน์โหลดแถวที่ไม่ผ่าน', !!await page.$('#attPreview [data-act="att:baddl"]'));
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  ok('★ นำเข้าแล้ว 5 รายการในงวด ลากิจครึ่งวันจากไฟล์ถูกต้อง', await page.evaluate(() => attendanceList().length === 5
    && attendanceList().some((x) => x.type === 'unpaid' && x.days === 0.5 && x.date === '2026-01-13' && x.src === 'import')));
  const ck = path.join(DIR, 'att_clock.csv');
  fs.writeFileSync(ck, 'รหัสพนักงาน,วันที่,เวลาเข้า,เวลาออก\nEMP-0002,2026-01-15,08:40,17:30\nEMP-0002,2026-01-16,08:30,16:45\nEMP-0002,2026-01-19,,\n');
  await page.click('#main [data-act="att:import"]');
  await page.waitForSelector('#modal.show');
  await page.setInputFiles('#attFile', ck);
  await page.waitForFunction(() => /นำเข้าได้/.test((document.getElementById('attPreview') || {}).textContent || ''));
  ok('★ ไฟล์เครื่องสแกนนิ้ว: สาย 10 นาที · กลับก่อน 45 นาที · ขาด 1 วัน', /เวลาเข้า-ออกจากเครื่องสแกนนิ้ว/.test(await page.textContent('#attPreview'))
    && /นำเข้าได้ 3 รายการ/.test(await page.textContent('#attPreview')));
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  ok('รายการจากเครื่องสแกนนิ้วจำที่มา', await page.evaluate(() => attendanceList().filter((x) => x.src === 'clock').length === 3));

  console.log('\n[5] ทำเงินเดือน · สลิป · ล็อกบันทึก');
  await go('payroll');
  await page.click('#main [data-act="run:payroll"]');
  await page.waitForTimeout(250);
  const run = await page.evaluate(() => { const r = DB.docs.payRun[0]; return r ? { no: r.no, ded: r.slips.find((s) => s.code === 'EMP-0001').ded.map((x) => x.type + ':' + x.qty) } : null; });
  ok('★ ทำเงินเดือนแล้ว สลิปมีรายการขาด ลา มาสาย', !!run && run.ded.includes('late:35') && run.ded.includes('absent:0.5') && run.ded.includes('unpaid:1'),
    run && run.ded.join(' '));
  await page.click('#main [data-act="printdoc:payslip:' + run.no + '/EMP-0001"]');
  await page.waitForSelector('#printArea.show .sheet');
  const slipText = await page.textContent('#printArea');
  ok('★ สลิปพิมพ์ "หักมาสาย 35 นาที (2 ครั้ง)" และ "หักขาดงาน 0.5 วัน"', /หักมาสาย 35 นาที \(2 ครั้ง\)/.test(slipText) && /หักขาดงาน 0\.5 วัน/.test(slipText));
  await page.click('#printArea [data-act="printclose"]');
  await go('attendance');
  ok('★ หลังทำเงินเดือน ปุ่มบันทึก/นำเข้าถูกปิด และบอกว่าล็อกแล้ว', await page.evaluate(() =>
    document.querySelector('#main [data-act="att:new"]').classList.contains('disabled') && /บันทึกเวลาถูกล็อก/.test(document.getElementById('main').textContent)
    && !document.querySelector('#main [data-act^="att:del:"]')));

  console.log('\n[6] ตั้งค่า และจอมือถือ');
  await page.evaluate(() => dispatch('paysettings'));
  await page.waitForSelector('#modal.show');
  ok('ตั้งค่ามีตัวหารค่าจ้างรายวัน ผ่อนผันมาสาย เวลาเข้า-เลิกงาน และคำเตือนเรื่องห้ามหักเป็นค่าปรับ', await page.evaluate(() =>
    !!document.querySelector('#modal [name="dayBasis"]') && !!document.querySelector('#modal [name="lateGrace"]')
    && !!document.querySelector('#modal [name="workStart"]') && /ม\.76/.test(document.getElementById('modal').textContent)));
  await page.fill('#modal [name="lateGrace"]', '5');
  await page.click('#modal [data-act="modal:submit"]');
  await T.closed(page);
  ok('บันทึกผ่อนผัน 5 นาทีแล้ว', await page.evaluate(() => payrollSetting('lateGrace') === 5));
  /* บรรทัดรวมของตารางต้องเรียงเป็นแถวเดียวบนจอคอม (เคยซ้อนเป็นแนวตั้งเพราะกฎมือถือเจาะจงกว่า) */
  ok('★ บรรทัดรวมของตารางเรียงแนวนอนบนจอคอม ไม่ซ้อนกัน', await page.evaluate(() => {
    const tds = Array.from(document.querySelectorAll('#main tfoot td'));
    const tops = new Set(tds.map((td) => Math.round(td.getBoundingClientRect().top)));
    return tds.length >= 8 && tds.every((td) => getComputedStyle(td).display === 'table-cell') && tops.size === 1;
  }));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.evaluate(() => { STATE.screen = 'attendance'; render(); });
  await page.waitForTimeout(200);
  ok('จอมือถือไม่ล้นแนวนอน', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  ok('ยอดคุมผ่าน งบทดลองสมดุล', await page.evaluate(() => trialBalance('2026-01-01', '2026-01-31').balanced));
  void errors;
  await T.done();
})();
