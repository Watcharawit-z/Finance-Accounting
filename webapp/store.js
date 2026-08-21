/* =====================================================================
   ที่เก็บข้อมูลฝั่งเซิร์ฟเวอร์ — เก็บสมุดบัญชีทั้งเล่มเป็น JSON หนึ่งแถว
   เหมาะกับขนาดกิจการเดียว (ข้อมูล 7 เดือนราว 0.5 MB) และทำให้ทุกเครื่อง
   ที่เปิดเว็บเห็นข้อมูลชุดเดียวกัน ต่างจากการเก็บในเบราว์เซอร์
   ===================================================================== */
const { Client } = require('pg');

const BOOK = process.env.BOOK_KEY || 'default';
const MAX_BYTES = Number(process.env.MAX_STATE_BYTES || 8 * 1024 * 1024);

let pool = null;

function connectionString() {
  return process.env.DATABASE_URL || process.env.APP_DATABASE_URL || '';
}
const enabled = () => Boolean(connectionString());

async function withClient(fn) {
  const url = connectionString();
  const ssl = /sslmode=require/.test(url) || process.env.DATABASE_SSL === 'require'
    ? { rejectUnauthorized: false } : undefined;
  const c = new Client({ connectionString: url, ssl, application_name: 'duly-webapp' });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function init() {
  if (!enabled()) return false;
  await withClient(async function (c) {
    await c.query(`
      CREATE TABLE IF NOT EXISTS duly_state (
        book        text PRIMARY KEY,
        version     bigint NOT NULL DEFAULT 0,
        data        jsonb  NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`);
    /* เก็บฉบับก่อนหน้าไว้ให้ย้อนดูได้ ข้อมูลบัญชีหายไม่ได้ */
    await c.query(`
      CREATE TABLE IF NOT EXISTS duly_state_history (
        book        text NOT NULL,
        version     bigint NOT NULL,
        data        jsonb NOT NULL,
        saved_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (book, version)
      )`);
  });
  return true;
}

async function read() {
  return withClient(async function (c) {
    const r = await c.query('SELECT version, data, updated_at FROM duly_state WHERE book = $1', [BOOK]);
    if (!r.rows.length) return { version: 0, data: null, updatedAt: null };
    return { version: Number(r.rows[0].version), data: r.rows[0].data, updatedAt: r.rows[0].updated_at };
  });
}

/**
 * เขียนทับได้เฉพาะเมื่อรุ่นที่ผู้เรียกถืออยู่ตรงกับรุ่นบนเซิร์ฟเวอร์
 * ถ้าไม่ตรงแปลว่ามีอีกเครื่องบันทึกแทรกเข้ามา ต้องไม่ทับทิ้งเงียบ ๆ
 */
async function write(expectedVersion, data) {
  const size = Buffer.byteLength(JSON.stringify(data));
  if (size > MAX_BYTES) {
    const err = new Error('ข้อมูลใหญ่เกินที่รับได้ (' + (size / 1048576).toFixed(1) + ' MB)');
    err.code = 'TOO_LARGE';
    throw err;
  }
  return withClient(async function (c) {
    await c.query('BEGIN');
    try {
      const cur = await c.query('SELECT version FROM duly_state WHERE book = $1 FOR UPDATE', [BOOK]);
      const at = cur.rows.length ? Number(cur.rows[0].version) : 0;
      if (Number(expectedVersion) !== at) {
        await c.query('ROLLBACK');
        const err = new Error('มีการบันทึกจากอีกเครื่องแทรกเข้ามา');
        err.code = 'VERSION_CONFLICT';
        err.serverVersion = at;
        throw err;
      }
      const next = at + 1;
      await c.query(`
        INSERT INTO duly_state (book, version, data, updated_at)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (book) DO UPDATE
          SET version = EXCLUDED.version, data = EXCLUDED.data, updated_at = now()`,
        [BOOK, next, data]);
      await c.query(
        'INSERT INTO duly_state_history (book, version, data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [BOOK, next, data]);
      /* เก็บย้อนหลัง 50 ฉบับพอ ไม่ให้ฐานข้อมูลบวมโดยไม่มีที่สิ้นสุด */
      await c.query(`
        DELETE FROM duly_state_history
         WHERE book = $1 AND version <= $2 - 50`, [BOOK, next]);
      await c.query('COMMIT');
      return { version: next };
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ปิดไปแล้ว */ }
      throw e;
    }
  });
}

async function healthy() {
  if (!enabled()) return false;
  try { await withClient((c) => c.query('SELECT 1')); return true; }
  catch (e) { return false; }
}

module.exports = { enabled, init, read, write, healthy, BOOK };
