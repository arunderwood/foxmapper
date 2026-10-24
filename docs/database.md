# Measuring the production database

The relay's store is a managed Postgres 18 on Render's `basic-256mb` plan, declared alongside the
web service in [render.yaml](../render.yaml).

## Per-statement timing

`pg_stat_statements` 1.12 is installed, with counters reaching back to 2026-07-16. Statements by
total execution time:

```sql
SELECT calls,
       round(total_exec_time::numeric)   AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 90) AS statement
FROM pg_stat_statements s
JOIN pg_database d ON d.oid = s.dbid
WHERE d.datname = current_database()
ORDER BY total_exec_time DESC
LIMIT 20;
```

The `::numeric` casts are required: the timing columns are `double precision` and two-argument
`round` is numeric-only. The `dbid` filter is load-bearing — the counters are cluster-wide, and
98% of the calls in this database are Render's own monitoring (see below).

Ignore `max_exec_time`. Every statement on this instance tops out between 90 and 400 ms whatever
its mean, including one averaging 0.08 ms, so that band is the 0.1-core allocation being throttled
rather than anything about a statement. Ignore `blk_read_time` and `blk_write_time` too:
`track_io_timing` is `off` and the app's role cannot change it, so they always read 0.

If the extension ever needs reinstalling, `CREATE EXTENSION pg_stat_statements;` is enough — it is
trusted and `foxmapper_db_user` holds `CREATE`. **It writes to production**, and Render's MCP query
tool refuses it (`SQLSTATE 25006`), so use `psql` or the dashboard's SQL console.

## Slow-statement logs

`log_min_duration_statement` is `2s` server-wide, and its output lands in Render's database logs.
Nothing the relay runs has ever crossed that threshold — its whole cost is 104 seconds of database
time in 100 days — so the slow log here is permanently silent, which looks identical to healthy.

## `xact_commit` is a statistic about Render, not the relay

The instance reports millions of committed transactions against ~100–150 HTTP requests a day.
Of all calls in `foxmapper_db`, 98.3% belong to roles other than `foxmapper_db_user`
(`datadog`, `render_conn`, `postgres`), and eight of those statements have *exactly* 288,040 calls
with two more at 6 × 288,040 — a fixed monitoring script run once per connection, every 30 seconds.
The `postgres` database shows the same shape at five times the rate against no application at all.

For the relay's own load, read `pg_stat_statements` filtered by `dbid`, or `pg_stat_user_tables`.
