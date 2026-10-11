#!/usr/bin/env bash
# Dumps a database (public + auth schemas), records per-table row counts, and
# writes ONE gpg-encrypted (AES256) tar of both. Nothing unencrypted is kept,
# and no row data is printed.
# Usage: BACKUP_PASSPHRASE=… backup.sh <db-url> <pg-bin-dir> <output.tar.gpg>
set -euo pipefail
db_url="$1"; pg_bin="$2"; output="$3"
here="$(cd "$(dirname "$0")" && pwd)"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

"$pg_bin/psql" "$db_url" -At -v ON_ERROR_STOP=1 -f "$here/counts.sql" > "$work/prod-counts.tsv"
echo "Counted $(wc -l < "$work/prod-counts.tsv" | tr -d ' ') tables."

"$pg_bin/pg_dump" "$db_url" \
  --format=custom --no-owner --no-privileges \
  --schema=public --schema=auth \
  --exclude-table-data=public.rate_limit_windows \
  --file="$work/prod.dump"
date -u +%Y-%m-%dT%H:%M:%SZ > "$work/taken-at.txt"
"$pg_bin/pg_dump" --version > "$work/pg-dump-version.txt"
echo "Dump size: $(du -h "$work/prod.dump" | cut -f1)."

tar -C "$work" -cf - prod.dump prod-counts.tsv taken-at.txt pg-dump-version.txt \
  | gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 \
      --symmetric --cipher-algo AES256 --output "$output" 3<<< "$BACKUP_PASSPHRASE"
echo "Encrypted backup written."
