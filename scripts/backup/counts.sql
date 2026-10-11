-- Per-table row counts for the backup restore test (.github/workflows/prod-backup.yml).
-- One `schema.table<TAB>count` line per table: every base table in public
-- plus auth.users (seller accounts). rate_limit_windows is UNLOGGED scratch
-- state (0016): its data is deliberately not backed up, so it is not counted.
select table_schema || '.' || table_name || chr(9) ||
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
from information_schema.tables
where table_type = 'BASE TABLE'
  and ((table_schema = 'public' and table_name <> 'rate_limit_windows')
    or (table_schema = 'auth' and table_name = 'users'))
order by 1;
