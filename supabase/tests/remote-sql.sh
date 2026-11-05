#!/usr/bin/env bash
# Run SQL against the real Supabase project over HTTPS (Management API).
# Usage: supabase/tests/remote-sql.sh "select 1"   or   supabase/tests/remote-sql.sh -f file.sql
# Needs SUPABASE_ACCESS_TOKEN and SUPABASE_URL in the environment.
set -euo pipefail
REF="$(echo "$SUPABASE_URL" | sed -E 's#https://([^.]+)\..*#\1#')"
if [ "${1:-}" = "-f" ]; then SQL="$(cat "$2")"; else SQL="$1"; fi
python3 -c 'import json,sys; print(json.dumps({"query": sys.stdin.read()}))' <<<"$SQL" |
  curl -sS --fail-with-body -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @-
echo
