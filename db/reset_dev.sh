#!/usr/bin/env bash
# สร้างฐานข้อมูลใหม่ทั้งหมดสำหรับ dev/test — ลบข้อมูลเดิมทิ้ง
set -euo pipefail
DB="${1:-duly_dev}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL="${PSQL:-psql}"

$PSQL -c "DROP DATABASE IF EXISTS $DB" postgres >/dev/null
$PSQL -c "CREATE DATABASE $DB" postgres >/dev/null

for f in "$ROOT"/db/migrations/*.sql; do
  $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
( cd "$ROOT" && $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f db/seed/load_seed.sql >/dev/null )
$PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/db/setup_role.sql" >/dev/null
$PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/db/seed/demo_company.sql" >/dev/null
echo "ฐานข้อมูล $DB พร้อมใช้งาน (migrations + seed + role + ข้อมูลตัวอย่าง)"
