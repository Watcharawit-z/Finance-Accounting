#!/usr/bin/env node
/* =====================================================================
   ตัวรัน migration สำหรับเครื่องจริง
   - จำว่ารันไฟล์ไหนไปแล้ว รันซ้ำได้ปลอดภัย (ทุก deploy จะเรียกตัวนี้)
   - รองรับคำสั่งของ psql เท่าที่ไฟล์ในโปรเจกต์นี้ใช้จริง: \ir \copy \set \echo
     จึงไม่ต้องติดตั้ง psql ในคอนเทนเนอร์
   - สร้าง role ของแอปให้ด้วย เพราะแอปต้องไม่เชื่อมด้วยผู้ใช้ที่ข้าม RLS ได้
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
let Client;
try { ({ Client } = require('pg')); }
catch (e) {
  console.error('\nหาโมดูล pg ไม่เจอ — แปลว่า dependency ไม่ได้ติดตั้งมาในอิมเมจ');
  console.error('ลองสั่ง npm install ที่รากของโปรเจกต์ แล้ว deploy ใหม่');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..', '..');
const log = (m) => process.stdout.write(m + '\n');

/* ---------- อ่านไฟล์ SQL พร้อมแตกคำสั่งของ psql ---------- */
function splitTopLevel(sql) {
  /* แยกคำสั่งด้วย ; โดยข้ามที่อยู่ในสตริง คอมเมนต์ และบล็อก $$ ... $$ */
  const out = [];
  let buf = '', i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" ) {
      const end = findQuote(sql, i, "'");
      buf += sql.slice(i, end); i = end; continue;
    }
    if (c === '"') {
      const end = findQuote(sql, i, '"');
      buf += sql.slice(i, end); i = end; continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl < 0 ? sql.length : nl;
      buf += sql.slice(i, end); i = end; continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i);
      const stop = end < 0 ? sql.length : end + 2;
      buf += sql.slice(i, stop); i = stop; continue;
    }
    if (c === '$') {
      const m = /^\$[A-Za-z_0-9]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end < 0 ? sql.length : end + tag.length;
        buf += sql.slice(i, stop); i = stop; continue;
      }
    }
    if (c === ';') { out.push(buf); buf = ''; i++; continue; }
    buf += c; i++;
  }
  if (buf.trim()) out.push(buf);
  return out.map((s) => s.trim()).filter((s) => s && !/^(--|\/\*)/.test(s) === false || s.length > 0)
            .filter((s) => s.replace(/--[^\n]*/g, '').trim().length > 0);
}
function findQuote(sql, i, q) {
  let j = i + 1;
  while (j < sql.length) {
    if (sql[j] === q) { if (sql[j + 1] === q) { j += 2; continue; } return j + 1; }
    j++;
  }
  return sql.length;
}

const csvSplit = (line) => {
  const out = []; let cell = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
};

/** แปลงไฟล์เป็นรายการงานที่รันได้: {sql} หรือ {copy:{table, file, nullAs}} */
function loadFile(file, vars) {
  vars = vars || {};
  const dir = path.dirname(file);
  const text = fs.readFileSync(file, 'utf8');
  const jobs = [];
  let sqlBuf = '';
  const flush = () => { if (sqlBuf.trim()) jobs.push({ sql: sqlBuf }); sqlBuf = ''; };

  text.split('\n').forEach(function (line) {
    if (!line.startsWith('\\')) { sqlBuf += line + '\n'; return; }
    const set = /^\\set\s+(\w+)\s+'([^']*)'/.exec(line);
    if (set) { vars[set[1]] = set[2]; return; }
    if (/^\\echo\b/.test(line)) return;
    const ir = /^\\ir\s+(\S+)/.exec(line);
    if (ir) { flush(); jobs.push(...loadFile(path.join(dir, ir[1]), vars)); return; }
    const cp = /^\\copy\s+(\S+)\s+FROM\s+'([^']+)'(?:\s+WITH\s*\(([^)]*)\))?/i.exec(line);
    if (cp) {
      flush();
      const opts = (cp[3] || '').toLowerCase();
      jobs.push({ copy: {
        table: cp[1],
        file: path.isAbsolute(cp[2]) ? cp[2] : path.join(ROOT, cp[2]),
        header: /header\s+true/.test(opts),
        nullAs: /null\s*''/.test(opts) ? '' : null,
      } });
      return;
    }
    throw new Error('ไม่รู้จักคำสั่ง psql: ' + line.trim() + ' (ในไฟล์ ' + file + ')');
  });
  flush();
  /* แทนค่าตัวแปรแบบ :name และ :'name' */
  return jobs.map(function (j) {
    if (!j.sql) return j;
    let s = j.sql;
    Object.keys(vars).forEach(function (k) {
      s = s.split(":'" + k + "'").join("'" + vars[k] + "'").split(':' + k).join(vars[k]);
    });
    return { sql: s };
  });
}

async function runCopy(client, c) {
  const lines = fs.readFileSync(c.file, 'utf8').split('\n').filter((l) => l.trim() !== '');
  const header = c.header ? csvSplit(lines.shift()) : null;
  if (!header) throw new Error('\\copy รองรับเฉพาะไฟล์ที่มีบรรทัดหัวตาราง');
  const cols = header.map((h) => '"' + h.trim() + '"').join(',');
  const CHUNK = 200;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const batch = lines.slice(i, i + CHUNK).map(csvSplit);
    const params = [];
    const values = batch.map(function (row) {
      const ph = row.map(function (v) {
        params.push(c.nullAs !== null && v === c.nullAs ? null : v);
        return '$' + params.length;
      });
      return '(' + ph.join(',') + ')';
    });
    await client.query('INSERT INTO ' + c.table + ' (' + cols + ') VALUES ' + values.join(','), params);
  }
  return lines.length;
}

/* ---------- ตัวหลัก ---------- */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    /* ยังไม่ได้ต่อฐานข้อมูล — ไม่ใช่ความผิดพลาดของโค้ด แต่เป็นการตั้งค่าที่ยังไม่ครบ
       ปล่อยให้แอปขึ้นมาแล้วรายงานที่ /health จะดีกว่าตายเงียบ ๆ
       เพราะผู้ใช้จะเห็นแค่ "healthcheck failed" โดยไม่รู้สาเหตุ */
    console.error('');
    console.error('════════════════════════════════════════════════════════');
    console.error(' ยังไม่ได้ตั้งค่าฐานข้อมูล — ข้ามการรัน migration');
    console.error('════════════════════════════════════════════════════════');
    console.error(' ต้องตั้งตัวแปรเหล่านี้ในบริการนี้:');
    console.error('');
    console.error('   DATABASE_URL      = ${{Postgres.DATABASE_URL}}');
    console.error('   APP_DB_PASSWORD   = รหัสผ่านสุ่มยาวอย่างน้อย 16 ตัวอักษร');
    console.error('   APP_DATABASE_URL  = URL เดียวกัน แต่เปลี่ยนผู้ใช้เป็น duly_app');
    console.error('                       กับรหัสผ่านข้างต้น');
    console.error('');
    console.error(' ถ้ายังไม่มีฐานข้อมูล: New → Database → Add PostgreSQL');
    console.error(' รายละเอียด: docs/18-deploy-railway.md');
    console.error('════════════════════════════════════════════════════════');
    console.error('');
    console.error('แอปจะเปิดขึ้นมาในสถานะ degraded — ตรวจได้ที่ /health');
    return;
  }
  const ssl = /sslmode=require/.test(url) || process.env.DATABASE_SSL === 'require'
    ? { rejectUnauthorized: false } : undefined;
  const client = new Client({ connectionString: url, ssl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migration (
      filename    text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const files = [];
  fs.readdirSync(path.join(ROOT, 'db', 'migrations')).sort()
    .filter((f) => f.endsWith('.sql'))
    .forEach((f) => files.push({ key: 'migrations/' + f, path: path.join(ROOT, 'db', 'migrations', f) }));
  files.push({ key: 'seed/load_seed.sql', path: path.join(ROOT, 'db', 'seed', 'load_seed.sql') });

  const done = new Map(
    (await client.query('SELECT filename, checksum FROM public.schema_migration')).rows
      .map((r) => [r.filename, r.checksum]));

  let applied = 0;
  for (const f of files) {
    const sum = crypto.createHash('sha256').update(fs.readFileSync(f.path)).digest('hex').slice(0, 16);
    if (done.has(f.key)) {
      if (done.get(f.key) !== sum) {
        throw new Error('ไฟล์ ' + f.key + ' ถูกแก้หลังจากรันไปแล้ว — migration ที่รันแล้วต้องไม่ถูกแก้\n'
          + 'ถ้าต้องการเปลี่ยนสคีมา ให้เพิ่มไฟล์ใหม่แทน');
      }
      log('  ข้าม  ' + f.key);
      continue;
    }
    log('  รัน   ' + f.key);
    const jobs = loadFile(f.path, {});
    await client.query('BEGIN');
    try {
      for (const j of jobs) {
        if (j.copy) { const n = await runCopy(client, j.copy); log('        โหลด ' + n + ' แถวเข้า ' + j.copy.table); }
        else for (const stmt of splitTopLevel(j.sql)) await client.query(stmt);
      }
      await client.query('INSERT INTO public.schema_migration (filename, checksum) VALUES ($1,$2)', [f.key, sum]);
      await client.query('COMMIT');
      applied++;
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error('ล้มเหลวที่ ' + f.key + ': ' + e.message);
    }
  }

  /* ---------- role ของแอป ---------- */
  const pw = process.env.APP_DB_PASSWORD;
  if (pw) {
    if (pw.length < 16) throw new Error('APP_DB_PASSWORD ต้องยาวอย่างน้อย 16 ตัวอักษร');
    await client.query(`
      DO $do$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'duly_app') THEN
          CREATE ROLE duly_app LOGIN;
        END IF;
      END $do$`);
    await client.query('ALTER ROLE duly_app WITH LOGIN PASSWORD ' + quote(pw));
    await client.query(`
      GRANT USAGE ON SCHEMA duly, public TO duly_app;
      GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA duly TO duly_app;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA duly TO duly_app;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA duly TO duly_app;
      REVOKE DELETE ON duly.journal_entry, duly.journal_line, duly.tax_transaction,
                       duly.audit_event, duly.attachment, duly.wht_certificate
        FROM duly_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA duly
        GRANT SELECT, INSERT, UPDATE ON TABLES TO duly_app;
      ALTER DEFAULT PRIVILEGES IN SCHEMA duly
        GRANT USAGE, SELECT ON SEQUENCES TO duly_app;`);
    const su = await client.query("SELECT rolsuper FROM pg_roles WHERE rolname = 'duly_app'");
    if (su.rows[0] && su.rows[0].rolsuper) {
      throw new Error('duly_app เป็น superuser — superuser ข้าม RLS ข้อมูลข้ามบริษัทจะรั่ว');
    }
    log('  role duly_app พร้อมใช้งาน (ไม่ใช่ superuser จึงถูก RLS บังคับจริง)');
  } else {
    log('  ข้ามการสร้าง role — ไม่ได้ตั้ง APP_DB_PASSWORD');
    log('  ★ แอปจะเชื่อมด้วยผู้ใช้เดียวกับที่รัน migration ซึ่งเป็นเจ้าของตาราง');
    log('    ตารางทั้งหมดตั้ง FORCE ROW LEVEL SECURITY ไว้ เจ้าของจึงยังถูกบังคับ');
    log('    แต่ถ้าผู้ใช้นั้นเป็น superuser จะข้าม RLS ได้ ควรตั้ง APP_DB_PASSWORD บนเครื่องจริง');
  }

  await client.end();
  log(applied === 0 ? 'ฐานข้อมูลเป็นรุ่นล่าสุดอยู่แล้ว' : 'รัน migration ใหม่ ' + applied + ' ไฟล์');
}

const quote = (s) => "'" + String(s).replace(/'/g, "''") + "'";

main().catch(function (e) { console.error('\nmigration ล้มเหลว: ' + e.message); process.exit(1); });
