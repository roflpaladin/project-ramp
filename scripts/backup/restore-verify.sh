#!/usr/bin/env bash
# The restore test: decrypts a backup made by backup.sh, restores it into a
# throwaway database, and compares row counts with the ones taken at backup
# time (compare-counts.mjs). pg_restore's stderr can quote row data, so only
# its error COUNT is printed.
# Usage: BACKUP_PASSPHRASE=… restore-verify.sh <backup.tar.gpg> <scratch-db-url> <pg-bin-dir>
set -euo pipefail
backup="$1"; scratch_url="$2"; pg_bin="$3"
here="$(cd "$(dirname "$0")" && pwd)"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

gpg --batch --pinentry-mode loopback --passphrase-fd 3 --decrypt "$backup" 3<<< "$BACKUP_PASSPHRASE" \
  | tar -C "$work" -xf -
echo "Backup taken at $(cat "$work/taken-at.txt") with $(cat "$work/pg-dump-version.txt")."

# Supabase roles and the extensions schema the dump refers to. Best effort:
# the row counts are the pass/fail signal, not a clean pg_restore.
"$pg_bin/psql" "$scratch_url" -q -c "
  do \$\$ declare r text; begin
    foreach r in array array['anon','authenticated','service_role','supabase_auth_admin','supabase_admin'] loop
      if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
    end loop;
  end \$\$;
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists \"uuid-ossp\" with schema extensions;"

set +e
"$pg_bin/pg_restore" --dbname="$scratch_url" --no-owner --no-privileges "$work/prod.dump" 2> "$work/errors.log"
set -e
echo "pg_restore reported $(grep -c 'error:' "$work/errors.log" || true) error line(s); row counts decide."

"$pg_bin/psql" "$scratch_url" -At -v ON_ERROR_STOP=1 -f "$here/counts.sql" > "$work/restored-counts.tsv"
node "$here/compare-counts.mjs" "$work/prod-counts.tsv" "$work/restored-counts.tsv"
