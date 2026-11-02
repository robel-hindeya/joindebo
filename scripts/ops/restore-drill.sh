#!/usr/bin/env bash
# Backup restore drill (plan, section 7, Phase 9; section 8: "Backups ... tested monthly").
# Dumps the tc schema from SOURCE_URL, restores it into a NEW empty database at TARGET_URL,
# then compares the row count of every tc table and the applied migrations. Prints the time
# each step took. Postgres 17 tools run in a container, so nothing needs installing.
#
#   SOURCE_URL=postgresql://...   the database to back up (production: a read replica or the backup)
#   TARGET_URL=postgresql://...   an EMPTY scratch database (never production)
#   bash scripts/ops/restore-drill.sh
#
# Never prints row data, only counts. The dump file is deleted at the end.
set -euo pipefail
# Git Bash on Windows would rewrite container paths such as /drill.
export MSYS_NO_PATHCONV=1
: "${SOURCE_URL:?set SOURCE_URL}"
: "${TARGET_URL:?set TARGET_URL}"
if [ "$SOURCE_URL" = "$TARGET_URL" ]; then echo "SOURCE_URL and TARGET_URL must differ" >&2; exit 1; fi

# The dump lives in a throwaway Docker volume; localhost URLs are reached from the container as host.docker.internal.
VOL=tc-restore-drill-$$
PG="docker run --rm -i --add-host=host.docker.internal:host-gateway -v $VOL:/drill postgres:17"
SOURCE_URL=${SOURCE_URL//@localhost:/@host.docker.internal:}
TARGET_URL=${TARGET_URL//@localhost:/@host.docker.internal:}
mkdir -p .drill
trap 'rm -rf .drill; docker volume rm -f $VOL > /dev/null' EXIT
now() { date +%s; }

counts() {
  $PG psql "$1" -tA -F' ' -c "
    select format('select %L, count(*) from tc.%I;', table_name, table_name) from information_schema.tables
    where table_schema = 'tc' and table_type = 'BASE TABLE' order by table_name" \
  | $PG psql "$1" -tA -F' ' 2>/dev/null | sort
}

t0=$(now)
$PG psql "$TARGET_URL" -tAc "select count(*) from information_schema.tables where table_schema = 'tc'" | grep -qx 0 \
  || { echo "TARGET_URL already has a tc schema; use an empty database" >&2; exit 1; }

echo "1/4 dump tc schema"
$PG pg_dump --schema=tc --no-owner --no-privileges -Fc -f /drill/tc.dump "$SOURCE_URL"
t1=$(now)

echo "2/4 restore into the scratch database"
$PG psql "$TARGET_URL" -qc "do \$\$ begin if not exists (select from pg_roles where rolname = 'tc_app') then create role tc_app; end if; end \$\$"
$PG pg_restore --no-owner --no-privileges --exit-on-error -d "$TARGET_URL" /drill/tc.dump
t2=$(now)

echo "3/4 compare row counts"
counts "$SOURCE_URL" > .drill/source.txt
counts "$TARGET_URL" > .drill/target.txt
t3=$(now)

echo "4/4 result"
tables=$(wc -l < .drill/source.txt)
if diff -q .drill/source.txt .drill/target.txt > /dev/null; then same=yes; else same=no; diff .drill/source.txt .drill/target.txt || true; fi
size=$($PG du -k /drill/tc.dump | cut -f1)
echo "tables=$tables same_counts=$same dump_kb=$size dump_s=$((t1 - t0)) restore_s=$((t2 - t1)) check_s=$((t3 - t2)) total_s=$((t3 - t0))"
[ "$same" = yes ]
