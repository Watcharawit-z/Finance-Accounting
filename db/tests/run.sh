#!/usr/bin/env bash
# รันชุดทดสอบกฎบัญชีบนฐานข้อมูลใหม่เสมอ
#   usage: db/tests/run.sh [dbname]
set -euo pipefail
DB="${1:-duly_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="${PSQL:-psql}"

$PSQL -c "DROP DATABASE IF EXISTS $DB" postgres >/dev/null
$PSQL -c "CREATE DATABASE $DB" postgres >/dev/null

for f in "$ROOT"/db/migrations/*.sql; do
  $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f "$f" >/dev/null
done
echo "migrations: ok ($(ls "$ROOT"/db/migrations/*.sql | wc -l) ไฟล์)"

( cd "$ROOT" && $PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f db/seed/load_seed.sql >/dev/null )
echo "seed: ok"

$PSQL -q -d "$DB" -v ON_ERROR_STOP=1 -f "$ROOT/db/tests/rules_test.sql" 2>&1 \
  | grep -E "^(===|  PASS|psql.*NOTICE|ERROR|FAIL| )" \
  | sed -E 's/^psql[^:]*:[^:]*:[0-9]+: NOTICE: //' || true
