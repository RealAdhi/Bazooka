#!/usr/bin/env bash
# Spin up a throwaway Postgres, apply the Supabase stub + all migrations + seed, then run the SQL tests.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN=/usr/lib/postgresql/16/bin
DIR="$(mktemp -d)"
trap '"$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
if [ "$(id -u)" = 0 ]; then chown postgres "$DIR"; RUN="runuser -u postgres --"; else RUN=""; fi
$RUN "$PGBIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
$RUN "$PGBIN/pg_ctl" -D "$DIR" -o "-k $DIR -p 54329 -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL=(psql -h "$DIR" -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$ROOT/supabase/tests/00_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do echo "migrate: $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
[ -f "$ROOT/supabase/seed.sql" ] && { echo "seed"; "${PSQL[@]}" -f "$ROOT/supabase/seed.sql"; }
for f in "$ROOT"/supabase/tests/[1-9]*.sql; do [ -f "$f" ] || continue; echo "test: $(basename "$f")"; "${PSQL[@]}" -f "$f"; done
echo "OK"
