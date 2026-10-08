/* =====================================================================
   ที่เก็บข้อมูลฝั่งเซิร์ฟเวอร์ — เก็บสมุดบัญชีทั้งเล่มเป็น JSON หนึ่งแถว
   เหมาะกับขนาดกิจการเดียว (ข้อมูล 7 เดือนราว 0.5 MB) และทำให้ทุกเครื่อง
   ที่เปิดเว็บเห็นข้อมูลชุดเดียวกัน ต่างจากการเก็บในเบราว์เซอร์
   ===================================================================== */
const { Client } = require('pg');

const DEFAULT_BOOK = process.env.BOOK_KEY || 'default';
/* รหัสสมุดต้องปลอดภัยพอที่จะใช้เป็นคีย์ ไม่ให้ใส่อะไรก็ได้เข้ามา */
const validBook = (b) => /^[A-Za-z0-9_-]{1,64}$/.test(String(b || ''));
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
  const c = new Client({ connectionString: url, ssl, application_name: 'financii-webapp' });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}

async function init() {
  if (!enabled()) return false;
  await withClient(async function (c) {
    /* ★ เปลี่ยนชื่อระบบเป็น Financii — ย้ายตารางเดิมมาใช้ชื่อใหม่ก่อนสร้างใหม่
       ทำแบบนี้เพื่อไม่ให้ข้อมูลที่บันทึกไว้แล้วกลายเป็นตารางกำพร้า */
    await c.query(`
      DO $rb$
      BEGIN
        IF to_regclass('public.duly_state') IS NOT NULL
           AND to_regclass('public.financii_state') IS NULL THEN
          ALTER TABLE duly_state RENAME TO financii_state;
        END IF;
        IF to_regclass('public.duly_state_history') IS NOT NULL
           AND to_regclass('public.financii_state_history') IS NULL THEN
          ALTER TABLE duly_state_history RENAME TO financii_state_history;
        END IF;
      END $rb$`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS financii_state (
        book        text PRIMARY KEY,
        version     bigint NOT NULL DEFAULT 0,
        data        jsonb  NOT NULL,
        updated_at  timestamptz NOT NULL DEFAULT now()
      )`);
    /* ชื่อกิจการแยกออกมาเป็นคอลัมน์ เพื่อให้แสดงรายชื่อบริษัทได้
       โดยไม่ต้องดึงข้อมูลทั้งเล่มของทุกบริษัทมาอ่าน */
    await c.query('ALTER TABLE financii_state ADD COLUMN IF NOT EXISTS company_name text');
    await c.query('ALTER TABLE financii_state ADD COLUMN IF NOT EXISTS company_tax_id text');
    await c.query('ALTER TABLE financii_state ADD COLUMN IF NOT EXISTS entry_count integer NOT NULL DEFAULT 0');
    /* เก็บฉบับก่อนหน้าไว้ให้ย้อนดูได้ ข้อมูลบัญชีหายไม่ได้ */
    /* ถังขยะ — บริษัทที่ลบไม่หายไปทันที กู้คืนได้จนกว่าจะสั่งลบถาวร
       พ.ร.บ.การบัญชีให้เก็บบัญชีไว้ 5 ปี ลบผิดเล่มแล้วหายเลยไม่ได้ */
    await c.query(`
      CREATE TABLE IF NOT EXISTS financii_trash (
        id             bigserial PRIMARY KEY,
        book           text NOT NULL,
        version        bigint NOT NULL DEFAULT 0,
        data           jsonb NOT NULL,
        company_name   text,
        company_tax_id text,
        entry_count    integer NOT NULL DEFAULT 0,
        reason         text,
        deleted_at     timestamptz NOT NULL DEFAULT now()
      )`);
    await c.query(`
      CREATE TABLE IF NOT EXISTS financii_state_history (
        book        text NOT NULL,
        version     bigint NOT NULL,
        data        jsonb NOT NULL,
        saved_at    timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (book, version)
      )`);
  });
  return true;
}

async function read(book) {
  const key = book || DEFAULT_BOOK;
  return withClient(async function (c) {
    const r = await c.query('SELECT version, data, updated_at FROM financii_state WHERE book = $1', [key]);
    if (!r.rows.length) return { book: key, version: 0, data: null, updatedAt: null };
    return { book: key, version: Number(r.rows[0].version), data: r.rows[0].data, updatedAt: r.rows[0].updated_at };
  });
}

/** รายชื่อสมุดบัญชีทั้งหมด — อ่านแค่ข้อมูลสรุป ไม่ดึงเนื้อข้อมูลของแต่ละบริษัท */
async function listBooks() {
  return withClient(async function (c) {
    const r = await c.query(`
      SELECT book, company_name, company_tax_id, version, entry_count, updated_at
        FROM financii_state ORDER BY company_name NULLS LAST, book`);
    return r.rows.map((x) => ({
      book: x.book, name: x.company_name || x.book, taxId: x.company_tax_id || null,
      version: Number(x.version), entries: Number(x.entry_count || 0), updatedAt: x.updated_at,
    }));
  });
}

const fail = (code, msg) => Object.assign(new Error(msg), { code });

/** ลบบริษัท — ย้ายทั้งเล่มไปถังขยะในรายการเดียวกัน (ไม่มีจังหวะที่ข้อมูลหายระหว่างทาง)
    ต้องพิมพ์ชื่อบริษัทมาให้ตรงกับที่เก็บไว้ กันการลบผิดเล่มจากการกดพลาด */
async function removeBook(book, opts) {
  const o = opts || {};
  if (!validBook(book)) throw fail('BAD_BOOK', 'รหัสสมุดไม่ถูกต้อง');
  return withClient(async function (c) {
    await c.query('BEGIN');
    try {
      const r = await c.query(`SELECT version, data, company_name, company_tax_id, entry_count
                                 FROM financii_state WHERE book = $1 FOR UPDATE`, [book]);
      if (!r.rows.length) throw fail('NOT_FOUND', 'ไม่พบสมุดนี้');
      const row = r.rows[0];
      const name = String(row.company_name || book).trim();
      if (String(o.confirmName || '').trim() !== name) {
        throw fail('CONFIRM_MISMATCH', 'ชื่อบริษัทที่พิมพ์ยืนยันไม่ตรงกับ "' + name + '"');
      }
      const t = await c.query(`
        INSERT INTO financii_trash (book, version, data, company_name, company_tax_id, entry_count, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, deleted_at`,
        [book, row.version, row.data, row.company_name, row.company_tax_id, row.entry_count, o.reason || null]);
      await c.query('DELETE FROM financii_state WHERE book = $1', [book]);
      await c.query('COMMIT');
      return { trashId: Number(t.rows[0].id), deletedAt: t.rows[0].deleted_at };
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ปิดไปแล้ว */ }
      throw e;
    }
  });
}

async function listTrash() {
  return withClient(async function (c) {
    const r = await c.query(`SELECT id, book, company_name, company_tax_id, entry_count, reason, deleted_at
                               FROM financii_trash ORDER BY deleted_at DESC`);
    return r.rows.map((x) => ({ id: Number(x.id), book: x.book, name: x.company_name || x.book,
      taxId: x.company_tax_id || null, entries: Number(x.entry_count || 0), reason: x.reason, deletedAt: x.deleted_at }));
  });
}

/** กู้คืน — ใช้รหัสสมุดเดิมถ้ายังว่าง ไม่งั้นตั้งรหัสใหม่ ไม่ทับบริษัทที่มีอยู่ */
async function restoreTrash(id) {
  return withClient(async function (c) {
    await c.query('BEGIN');
    try {
      const r = await c.query('SELECT * FROM financii_trash WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rows.length) throw fail('NOT_FOUND', 'ไม่พบรายการนี้ในถังขยะ');
      const t = r.rows[0];
      let key = t.book;
      const taken = async (k) => (await c.query('SELECT 1 FROM financii_state WHERE book = $1', [k])).rows.length > 0;
      if (await taken(key)) key = (t.book + '-r' + t.id).slice(0, 64);
      for (let n = 2; await taken(key); n++) key = (t.book + '-r' + t.id + '-' + n).slice(0, 64);
      await c.query(`
        INSERT INTO financii_state (book, version, data, updated_at, company_name, company_tax_id, entry_count)
        VALUES ($1, $2, $3, now(), $4, $5, $6)`,
        [key, t.version, t.data, t.company_name, t.company_tax_id, t.entry_count]);
      await c.query('DELETE FROM financii_trash WHERE id = $1', [id]);
      await c.query('COMMIT');
      return { book: key };
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ปิดไปแล้ว */ }
      throw e;
    }
  });
}

/** ลบถาวร — ต้องพิมพ์ชื่อยืนยันอีกครั้ง ประวัติย้อนหลังลบด้วยถ้าไม่มีบริษัทอื่นใช้รหัสเดียวกัน */
async function purgeTrash(id, confirmName) {
  return withClient(async function (c) {
    await c.query('BEGIN');
    try {
      const r = await c.query('SELECT book, company_name FROM financii_trash WHERE id = $1 FOR UPDATE', [id]);
      if (!r.rows.length) throw fail('NOT_FOUND', 'ไม่พบรายการนี้ในถังขยะ');
      const name = String(r.rows[0].company_name || r.rows[0].book).trim();
      if (String(confirmName || '').trim() !== name) {
        throw fail('CONFIRM_MISMATCH', 'ชื่อบริษัทที่พิมพ์ยืนยันไม่ตรงกับ "' + name + '"');
      }
      await c.query('DELETE FROM financii_trash WHERE id = $1', [id]);
      const live = await c.query('SELECT 1 FROM financii_state WHERE book = $1', [r.rows[0].book]);
      const other = await c.query('SELECT 1 FROM financii_trash WHERE book = $1', [r.rows[0].book]);
      if (!live.rows.length && !other.rows.length) {
        await c.query('DELETE FROM financii_state_history WHERE book = $1', [r.rows[0].book]);
      }
      await c.query('COMMIT');
      return true;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch (_) { /* ปิดไปแล้ว */ }
      throw e;
    }
  });
}

/**
 * เขียนทับได้เฉพาะเมื่อรุ่นที่ผู้เรียกถืออยู่ตรงกับรุ่นบนเซิร์ฟเวอร์
 * ถ้าไม่ตรงแปลว่ามีอีกเครื่องบันทึกแทรกเข้ามา ต้องไม่ทับทิ้งเงียบ ๆ
 */
async function write(book, expectedVersion, data) {
  const key = book || DEFAULT_BOOK;
  if (!validBook(key)) { const e = new Error('รหัสสมุดไม่ถูกต้อง'); e.code = 'BAD_BOOK'; throw e; }
  const size = Buffer.byteLength(JSON.stringify(data));
  if (size > MAX_BYTES) {
    const err = new Error('ข้อมูลใหญ่เกินที่รับได้ (' + (size / 1048576).toFixed(1) + ' MB)');
    err.code = 'TOO_LARGE';
    throw err;
  }
  return withClient(async function (c) {
    await c.query('BEGIN');
    try {
      const cur = await c.query('SELECT version FROM financii_state WHERE book = $1 FOR UPDATE', [key]);
      const at = cur.rows.length ? Number(cur.rows[0].version) : 0;
      if (Number(expectedVersion) !== at) {
        await c.query('ROLLBACK');
        const err = new Error('มีการบันทึกจากอีกเครื่องแทรกเข้ามา');
        err.code = 'VERSION_CONFLICT';
        err.serverVersion = at;
        throw err;
      }
      const next = at + 1;
      const name = data && data.company ? String(data.company.name || '') : null;
      const taxId = data && data.company ? String(data.company.taxId || '') : null;
      const entries = data && Array.isArray(data.entries) ? data.entries.length : 0;
      await c.query(`
        INSERT INTO financii_state (book, version, data, updated_at, company_name, company_tax_id, entry_count)
        VALUES ($1, $2, $3, now(), $4, $5, $6)
        ON CONFLICT (book) DO UPDATE
          SET version = EXCLUDED.version, data = EXCLUDED.data, updated_at = now(),
              company_name = EXCLUDED.company_name, company_tax_id = EXCLUDED.company_tax_id,
              entry_count = EXCLUDED.entry_count`,
        [key, next, data, name, taxId, entries]);
      await c.query(
        'INSERT INTO financii_state_history (book, version, data) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [key, next, data]);
      /* เก็บย้อนหลัง 50 ฉบับพอ ไม่ให้ฐานข้อมูลบวมโดยไม่มีที่สิ้นสุด */
      await c.query(`
        DELETE FROM financii_state_history
         WHERE book = $1 AND version <= $2 - 50`, [key, next]);
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

module.exports = { enabled, init, read, write, healthy, listBooks, removeBook, listTrash, restoreTrash, purgeTrash,
  validBook, DEFAULT_BOOK, BOOK: DEFAULT_BOOK };
