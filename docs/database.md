# The production database

The relay's store is a single managed Postgres 18 on Render's `basic-256mb` plan, in Oregon,
declared alongside the web service in [render.yaml](../render.yaml). This page is about **measuring
it** — what the server exposes, what it does not, and what the counters actually mean. For what
the data *is*, see [log-format.md](log-format.md).

Everything below is read-only unless it says otherwise. The one exception is marked.

---

## 1. Per-statement timing: `pg_stat_statements`

**Installed**, version 1.12, in `public`, since 2026-10-24.

Its counters reach back further than that, to 2026-07-16 — the library was preloaded and collecting
all along, so creating the extension only exposed history that already existed. `dealloc` in
`pg_stat_statements_info` is 0 against a `pg_stat_statements.max` of 5000, with 162 statements
tracked, so nothing has been evicted: the history is complete rather than a recent sample.

### Listing statements by total execution time

The query nobody should have to compose twice:

```sql
SELECT calls,
       round(total_exec_time::numeric)       AS total_ms,
       round(mean_exec_time::numeric, 2)     AS mean_ms,
       round(max_exec_time::numeric, 2)      AS max_ms,
       rows,
       left(regexp_replace(query, '\s+', ' ', 'g'), 90) AS statement
FROM pg_stat_statements s
JOIN pg_database d ON d.oid = s.dbid
WHERE d.datname = current_database()
ORDER BY total_exec_time DESC
LIMIT 20;
```

The `::numeric` casts are not decoration. The timing columns are `double precision`, and
two-argument `round` is numeric-only — without them the query dies on `function round(double
precision, integer) does not exist`.

Three things to know before reading the output:

- **The counters are cluster-wide.** One shared hash table serves the whole server, so the `dbid`
  filter above is load-bearing: without it the relay's statements are buried under the platform's
  (see §3). Drop it deliberately when that is what you want to look at.
- **`foxmapper_db_user` is not in `pg_read_all_stats`.** Rows belonging to other roles still appear
  with full counts, but their `query` reads `<insufficient privilege>`. The relay's own statements
  are fully visible, which is what this is for.
- **`pg_stat_statements.track` is `top`**, so `calls` counts statements the client sent, not nested
  ones. It is legitimately larger than `xact_commit`: one transaction can send several statements.

One tracked entry is an artifact rather than traffic — a `WITH a AS (… pg_sleep(60) …)` probe with a
60-second `max_exec_time`, left over from measuring the session-creation rate in §3. It stays until
someone resets the counters.

To start a fresh measurement window — before a load test, say — `SELECT
pg_stat_statements_reset();` zeroes it. That is a write, and it discards the 100-day history above,
which is not replaceable.

### Reinstalling it, if it ever goes away

**This writes to production.** It takes a catalog lock for the duration of one insert and does not
touch the relay's tables, but it is still a schema change against the live database — get a human
to say yes first.

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

No dashboard change, no superuser and no support ticket is involved: the extension is **trusted**
at this version and `foxmapper_db_user` holds `CREATE` on the database, so the relay's own
`DATABASE_URL` credentials are enough. Render's MCP query tool wraps everything in a read-only
transaction and refuses it (`SQLSTATE 25006`), so reach for `psql` with the instance's connection
string from the Render dashboard, or the dashboard's own SQL console.

If you ever need to re-confirm that the library is preloaded — `SHOW shared_preload_libraries` is
refused to `foxmapper_db_user`, so the direct route is closed — read `pg_settings` instead:

```sql
SELECT name, setting, context FROM pg_settings WHERE name LIKE 'pg_stat_statements.%';
```

Five rows, and `pg_stat_statements.max` carries `context = postmaster`. A loadable module's GUCs
appear in `pg_settings` only once that module is loaded, and a `postmaster`-context one only if it
was loaded at server start — which is `shared_preload_libraries` and nothing else.

### `blk_read_time` and `blk_write_time` are always zero

`track_io_timing` is `off`, so the two I/O-time columns in `pg_stat_statements` (and in
`pg_stat_database`) read 0 no matter what the server did. They are not evidence of fast I/O; they
are evidence of nothing. Turning it on needs a `superuser`-context setting that `foxmapper_db_user`
cannot reach, so treat those columns as absent and read `shared_blks_read` against
`shared_blks_hit` for cache behaviour instead.

## 2. The fallback: slow-statement logs

`log_min_duration_statement` is `2s`, server-wide, and its output lands in Render's database logs —
dashboard, or `list_logs` against the instance id. It needs no extension and catches a pathological
statement with no setup at all.

Its limit is the reason §1 exists: it only ever shows statements that crossed two seconds. Nothing
the relay runs has ever crossed two seconds (§4), so on this instance the slow log is permanently
silent — which is worth knowing, because a silent slow log looks identical to a healthy one.

## 3. The transaction count is a statistic about Render, not about the relay

As of 2026-10-24, `foxmapper_db` reported **3,853,411 committed transactions** against roughly
100–150 HTTP requests a day. `pg_stat_statements` settles where they came from:

| In `foxmapper_db`, 100 days | Statements | Calls | Share of calls | Execution time | Share of time |
|---|---|---|---|---|---|
| `foxmapper_db_user` — the relay | 54 | 109,210 | 1.7% | 104 s | 1.2% |
| Other roles — the platform | 21 | 6,379,594 | **98.3%** | 8,403 s | **98.8%** |

The platform's 21 statements carry a fingerprint that settles it beyond the share alone: eight of
them have **exactly 288,040 calls** and two more have exactly 1,728,240, which is 6 × 288,040. A
fixed script, run once per connection, 288,040 times — one every 30 seconds for 100 days. No
application produces call counts that are equal to each other and to an integer multiple of each
other. `pg_stat_database` agrees independently: 284,990 sessions, which is the same number.

The single heaviest statement in this database belongs to that script — 288,040 calls at a 24 ms
mean, 7,049 seconds in all, 83% of every millisecond the database has ever spent. The cluster's
login roles are `datadog`, `render_conn`, `primaryuser`, `postgres` and `foxmapper_db_user`; the
platform monitors the database it hosts, and does so far more heavily than the relay uses it.

Two corroborations, in case the extension is ever reset and someone has to redo this:

- `pg_stat_database.stats_reset` is `NULL`, so its counters date from server start rather than from
  any deploy, and the rate is flat — 0.46–0.53 transactions a second across samples taken minutes
  apart, against ~38,500 a day averaged over 100 days. Hunt traffic is bursty by nature and the
  relay is idle between hunts; a constant rate cannot be it.
- The `postgres` database shows the identical shape five times over — 1,434,122 sessions, 14.2M
  transactions, 1.5 billion tuples returned, 29 rows ever inserted. That is the same mechanism
  aimed at a database with no application in it whatsoever.

Read `xact_commit` on this instance as a platform statistic. For the relay's load, read §4.

## 4. What the relay actually costs

Its entire 100-day profile, every statement it has ever sent:

| Statement | Calls | Total | Mean | Max | Rows |
|---|---|---|---|---|---|
| `SELECT seq, received_at, body FROM reports WHERE hunt_code = $1 AND seq > $2` — SSE catch-up | 30,160 | 16.1 s | 0.53 ms | 857 ms | 84,050 |
| `SELECT id FROM reports WHERE hunt_code = $1` — sync | 20,323 | 10.2 s | 0.50 ms | 203 ms | 479,677 |
| `SELECT code, created_at, frequency, label FROM hunts WHERE code = $1` | 38,016 | 7.0 s | 0.18 ms | 398 ms | 26,238 |
| `DELETE FROM hunts WHERE …` — the idle-hunt purge | 2,446 | 6.5 s | 2.67 ms | 198 ms | 604 |
| `INSERT INTO reports …` | 4,390 | 2.5 s | 0.58 ms | 296 ms | 4,378 |
| `SELECT code FROM hunts WHERE code = $1` | 3,419 | 0.3 s | 0.08 ms | 90 ms | 1,173 |
| `INSERT INTO hunts …` | 618 | 0.3 s | 0.41 ms | 93 ms | 618 |

104 seconds of database time in 100 days, or about a second a day. The purge's 2,446 calls against
2,400 hours of uptime is the hourly timer in
[`server/src/store/purge.rs`](../server/src/store/purge.rs) checking out, and the 70 recorded
`CREATE TABLE IF NOT EXISTS _sqlx_migrations` calls are 70 process starts.

**The `max` column measures the instance, not the statement.** Every row above tops out between 90
and 400 ms regardless of its mean — including `SELECT code FROM hunts WHERE code = $1`, which
averages 0.08 ms and still reached 90 ms. A statement that does almost nothing cannot be slow for
its own reasons, so that band is something external stalling every statement alike: a 0.1-core CPU
allocation being throttled, or a checkpoint. Tuning the 857 ms catch-up query on the strength of
its maximum would be chasing the instance's weather. `mean_exec_time` is the column that says
anything about a statement here.
