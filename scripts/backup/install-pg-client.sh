#!/usr/bin/env bash
# Installs the PostgreSQL client tools for one major version from the PGDG apt
# repository (Ubuntu runners), so pg_dump/pg_restore match the server's major.
# Usage: install-pg-client.sh <major>   Prints the bin directory.
set -euo pipefail
major="$1"
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list > /dev/null
sudo apt-get update -qq >&2
sudo apt-get install -y -qq "postgresql-client-${major}" >&2
echo "/usr/lib/postgresql/${major}/bin"
