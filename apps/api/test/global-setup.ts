import { execFileSync } from 'child_process';
import { resolve } from 'path';

/**
 * สร้างฐานข้อมูลทดสอบใหม่ก่อนรันทุกครั้ง
 * ผลการทดสอบต้องไม่ขึ้นกับลำดับการรันหรือข้อมูลค้างจากรอบก่อน
 */
export default function setup() {
  if (process.env.SKIP_DB_RESET === '1') return;
  const script = resolve(__dirname, '../../../db/reset_dev.sh');
  const db = process.env.TEST_DB ?? 'duly_dev';
  const asUser = process.env.PG_SUPERUSER ?? 'postgres';
  try {
    execFileSync('su', [asUser, '-c', `cd ${resolve(__dirname, '../../..')} && ${script} ${db}`],
      { stdio: 'pipe' });
  } catch (e: any) {
    // ถ้าไม่มีสิทธิ์ su ให้ลองรันตรง ๆ (เช่นในเครื่อง dev ที่ user มีสิทธิ์อยู่แล้ว)
    execFileSync(script, [db], { stdio: 'pipe' });
  }
}
