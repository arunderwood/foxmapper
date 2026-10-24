# The production database

The relay's store is a single managed Postgres 18 on Render's `basic-256mb` plan, in Oregon,
declared alongside the web service in [render.yaml](../render.yaml). This page is about **measuring
it** — what the server exposes, what it does not, and what the counters actually mean. For what
the data *is*, see [log-format.md](log-format.md).

Everything below is read-only unless it says otherwise. The one exception is marked.

---

## 1. Per-statement timing: `pg_stat_statements`

**Status: not installed.** The extension is available at version 1.12, and the library is already
loaded — only the SQL-level view is missing from `foxmapper_db`.

### It really is installable, and no dashboard change is needed

`SHOW shared_preload_libraries` is refused to `foxmapper_db_user`, so the usual way of checking
whether the library is preloaded is closed. Read `pg_settings` instead:

```sql
SELECT name, setting, context FROM pg_settings WHERE name LIKE 'pg_stat_statements.%';
```

Five rows come back, and `pg_stat_statements.max` has `context = postmaster`. A loadable module's
GUCs appear in `pg_settings` only once that module is loaded, and a `postmaster`-context one only
if it was loaded at server start — which is `shared_preload_libraries` and nothing else. So the
library is preloaded cluster-wide and has been collecting since the server started; `CREATE
EXTENSION` only exposes what is already there, and the first query returns accumulated history
rather than an empty table. `pg_stat_statements.save` is `on`, so that history survives restarts.

The extension is **trusted** at this version and `foxmapper_db_user` holds `CREATE` on the
database, so no superuser and no Render support ticket is involved. The relay's own `DATABASE_URL`
credentials are sufficient.

### Installing it

**This writes to production.** It takes a lock on the extension catalog for the duration of a
catalog insert and does not touch the relay's tables, but it is still a schema change against the
live database — get a human to say yes first. Render's MCP query tool runs everything in a
read-only transaction, so it cannot do this; use `psql` with the instance's connection string from
the Render dashboard, or the dashboard's own SQL console.

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

### Listing statements by total execution time

The query nobody should have to compose twice:

```sql
SELECT calls,
       round(total_exec_time)                  AS total_ms,
       round(mean_exec_time, 2)                AS mean_ms,
       round(max_exec_time, 2)                 AS max_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 100) AS statement
FROM pg_stat_statements s
JOIN pg_database d ON d.oid = s.dbid
WHERE d.datname = current_database()
ORDER BY total_exec_time DESC
LIMIT 20;
```

Two things to know before reading the output:

- **The counters are cluster-wide.** `pg_stat_statements` has one shared hash table for the whole
  server, so the `dbid` filter above is load-bearing: without it the relay's handful of statements
  are buried under Render's monitoring (see §3). Drop the filter deliberately when that is what you
  want to look at.
- **`foxmapper_db_user` is not in `pg_read_all_stats`.** Rows belonging to other roles still appear
  with their counts, but their `query` reads `<insufficient privilege>`. The relay's own statements
  are fully visible, which is what this is for.

To start a fresh measurement window — before a load test, say — `SELECT
pg_stat_statements_reset();` zeroes it. That is also a write, and it throws away whatever the
previous window had collected.

### `blk_read_time` and `blk_write_time` are always zero

`track_io_timing` is `off`, so the two I/O-time columns in `pg_stat_statements` (and in
`pg_stat_database`) read 0 no matter what the server did. They are not evidence of fast I/O; they
are evidence of nothing. Turning it on needs a `superuser`-context setting that
`foxmapper_db_user` cannot reach, so treat those columns as absent and use `shared_blks_read`
against `shared_blks_hit` for cache behaviour instead.

## 2. The fallback: slow-statement logs

`log_min_duration_statement` is already `2s`, server-wide, and its output lands in Render's
database logs — dashboard, or `list_logs` against the instance id. This is the zero-setup way to
catch a pathological statement, and it needs no extension.

Its limit is the reason §1 exists: it only ever shows you statements that crossed two seconds. A
statement that takes 40 ms and runs ten thousand times an hour is invisible to it and obvious in
`pg_stat_statements`.

## 3. Why the transaction count looks enormous, and why it is not the relay

As of 2026-10-24, `foxmapper_db` reported **3,853,411 committed transactions** against roughly
100–150 HTTP requests a day. None of that gap is the relay.

`pg_stat_database.stats_reset` is `NULL`, so every counter dates from server start
(2026-07-16, about 100 days) rather than from any deploy — 3.85M works out to ~38,500 a day. A
pair of short samples minutes apart measured a flat 0.46–0.53 transactions a second, or
40,000–45,000 a day — the same rate as the 100-day average, and steady, which already rules out
anything driven by hunt traffic. Hunts are bursty by nature and the relay is idle between them.

What the gap actually is:

| Signal | Value | What it says |
|---|---|---|
| `sessions` | 284,990 | A new connection every ~30 s, around the clock, for 100 days. |
| transactions per session | 13.5 | A short-lived client that connects, runs a dozen statements, leaves. |
| scans of the relay's own tables | 561,902 | At most 15% of those transactions touched a relay table — and every relay route touches one. |
| `tup_returned` | 856,670,130 | Against a 2.3 MB database holding 391 live reports. These are system-catalog reads. |
| `tup_inserted` | 5,453 | The relay's whole write history: 4,378 reports and 618 hunts. |

So ~85% of the transactions read no relay table at all, while 856 million tuples came back from
somewhere — the signature of catalog introspection on a fixed timer, not of an application. The
cluster's login roles are `datadog`, `render_conn`, `primaryuser`, `postgres` and
`foxmapper_db_user`, and a `postgres`-owned backend sits attached to `foxmapper_db`; the platform
monitors the database it hosts. The `postgres` database shows the identical shape five times over
(1,434,122 sessions, 14,198,882 transactions, 1.5 billion tuples returned, 29 rows ever inserted),
which is the same mechanism pointed at a database that has no application in it whatsoever.

The relay's own footprint, for comparison, is the bottom two rows of that table: 5,453 inserts and
a few hundred thousand index scans in 100 days. Read `xact_commit` on this instance as a platform
statistic. For the relay's load, read `pg_stat_user_tables`, or install §1 and filter by `dbid`.
