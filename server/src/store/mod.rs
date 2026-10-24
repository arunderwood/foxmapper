//! Storage: append, cursor reads, and the divergence-audit digest.

pub mod purge;

use std::collections::HashSet;

use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{postgres::PgRow, PgPool, Row};
use uuid::Uuid;

use crate::model::{Hunt, HuntDetail, IncomingReport, ReportEnvelope, Target};

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("hunt not found")]
    HuntNotFound,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

pub async fn create_hunt(
    pool: &PgPool,
    code: &str,
    target: &Target,
    created_at: i64,
) -> Result<Hunt, sqlx::Error> {
    sqlx::query("INSERT INTO hunts (code, created_at, frequency, label) VALUES ($1, $2, $3, $4)")
        .bind(code)
        .bind(created_at)
        .bind(&target.frequency)
        .bind(&target.label)
        .execute(pool)
        .await?;

    Ok(Hunt {
        code: code.to_string(),
        created_at,
        target: target.clone(),
    })
}

/// Codes are stored lowercase and looked up case-insensitively — they get read aloud over a
/// repeater and typed with gloves.
pub async fn get_hunt(pool: &PgPool, code: &str) -> Result<Option<Hunt>, sqlx::Error> {
    let row = sqlx::query("SELECT code, created_at, frequency, label FROM hunts WHERE code = $1")
        .bind(code.to_lowercase())
        .fetch_optional(pool)
        .await?;

    Ok(row.map(|r| Hunt {
        code: r.get("code"),
        created_at: r.get("created_at"),
        target: Target {
            frequency: r.get("frequency"),
            label: r.get("label"),
        },
    }))
}

pub async fn hunt_detail(pool: &PgPool, code: &str) -> Result<Option<HuntDetail>, sqlx::Error> {
    let Some(hunt) = get_hunt(pool, code).await? else {
        return Ok(None);
    };
    let ids = report_ids(pool, &hunt.code).await?;
    Ok(Some(HuntDetail {
        code: hunt.code,
        created_at: hunt.created_at,
        target: hunt.target,
        report_count: i64::try_from(ids.len()).unwrap_or(i64::MAX),
        id_digest: id_digest(&ids),
    }))
}

/// Append, idempotent by report `id`, serialized through a single writer.
///
/// The advisory lock is held for the whole transaction, so `seq` order matches commit order and no
/// sequence is ever visible before its row commits. Without it a reader can observe seq 5 while
/// seq 4 is still in flight, advance past 4, and never see it. Not for throughput — at tens of
/// participants this costs nothing measurable, and it removes the failure mode rather than
/// narrowing it.
///
/// The transaction runs on its own task, so dropping this future does not cancel it. A browser
/// that closes mid-flush drops the handler at whatever `.await` it had reached, and sqlx 0.9's
/// `begin()` is not cancel-safe: dropped after `BEGIN` is sent but before its reply, it hands the
/// connection back to the pool inside a transaction it has no record of. Every autocommit write
/// that connection serves afterwards is never committed — a hunt is created, and then 404s. An
/// append the caller stopped waiting for still commits, which idempotency makes harmless.
pub async fn append_reports(
    pool: &PgPool,
    code: &str,
    reports: &[IncomingReport],
    received_at: i64,
) -> Result<Vec<Uuid>, StoreError> {
    let pool = pool.clone();
    let code = code.to_lowercase();
    let reports = reports.to_vec();
    tokio::spawn(async move { append_in_transaction(&pool, &code, &reports, received_at).await })
        .await
        .unwrap_or_else(|join_error| std::panic::resume_unwind(join_error.into_panic()))
}

async fn append_in_transaction(
    pool: &PgPool,
    code: &str,
    reports: &[IncomingReport],
    received_at: i64,
) -> Result<Vec<Uuid>, StoreError> {
    let mut tx = pool.begin().await?;

    let exists: Option<(String,)> = sqlx::query_as("SELECT code FROM hunts WHERE code = $1")
        .bind(code)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(StoreError::HuntNotFound);
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
        .bind(code)
        .execute(&mut *tx)
        .await?;

    let ids: Vec<Uuid> = reports.iter().map(|r| r.id).collect();
    let bodies: Vec<&Value> = reports.iter().map(|r| &r.body).collect();

    // The whole batch in one statement. Everything here runs holding the advisory lock, so a
    // round trip per report is a round trip every other append to this hunt spends blocked.
    //
    // ON CONFLICT DO NOTHING is the whole idempotency story: re-appending a known id is a no-op.
    // This is what lets the client retry blindly forever with no dedup logic, which is exactly
    // what a flaky mobile link needs and the reason the outbound queue can be dumb. A single
    // statement holds that for ids repeated inside one batch too — the second occurrence
    // conflicts with the row the same statement just inserted, and is skipped.
    //
    // The conflict is on the global key, so it also fires for an id another hunt already holds,
    // and then nothing lands here. Ids stay globally unique because each device keys its local
    // store by `id` alone: a per-hunt key would let a report copied into a second hunt overwrite
    // the original on any device that has joined both.
    //
    // `WITH ORDINALITY` and the explicit `ORDER BY t.ord` are what give `seq` the batch's order.
    // `unnest` emits its elements in order, but nothing in the statement obliges the insert to
    // consume them that way, and `seq` is the order every device replays the log in.
    sqlx::query(
        "INSERT INTO reports (id, hunt_code, received_at, body)
         SELECT t.id, $3, $4, t.body
         FROM unnest($1::uuid[], $2::jsonb[]) WITH ORDINALITY AS t(id, body, ord)
         ORDER BY t.ord
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(&ids)
    .bind(&bodies)
    .bind(code)
    .bind(received_at)
    .execute(&mut *tx)
    .await?;

    // Accepted means "in this hunt's log", read back rather than assumed: the client drains its
    // queue on this list, so an id the insert skipped for another hunt must not appear in it.
    let stored: HashSet<Uuid> =
        sqlx::query_scalar("SELECT id FROM reports WHERE hunt_code = $1 AND id = ANY($2)")
            .bind(code)
            .bind(&ids)
            .fetch_all(&mut *tx)
            .await?
            .into_iter()
            .collect();
    let accepted: Vec<Uuid> = ids.into_iter().filter(|id| stored.contains(id)).collect();

    // Postgres delivers NOTIFY at commit, so a listener never learns of a seq before it is
    // readable — the same guarantee the advisory lock gives the sequence itself.
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(NOTIFY_CHANNEL)
        .bind(code)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(accepted)
}

/// One channel for every hunt; listeners filter by the payload (the hunt code). LISTEN/NOTIFY
/// rather than an in-process broadcast, so live push still works with more than one instance.
pub const NOTIFY_CHANNEL: &str = "foxmapper_reports";

/// Everything with a sequence above `since`, ascending. `since = 0` returns the whole log — the
/// recovery path after storage eviction, and why eviction costs a re-download rather than a hunt.
pub async fn reports_since(
    pool: &PgPool,
    code: &str,
    since: i64,
) -> Result<Vec<ReportEnvelope>, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT seq, received_at, body FROM reports
         WHERE hunt_code = $1 AND seq > $2
         ORDER BY seq ASC",
    )
    .bind(code.to_lowercase())
    .bind(since)
    .fetch_all(pool)
    .await?;

    Ok(rows.iter().map(envelope).collect())
}

/// How many reports one catch-up read returns.
///
/// The bound is what keeps a catch-up a sequence of small queries instead of one query
/// proportional to the hunt. `seq > 0` filters nothing, so once a hunt is a small slice of the
/// table the planner stops taking its ordering from `reports_hunt_seq_idx` and instead reads the
/// hunt through `reports_hunt_received_idx` and sorts — and that sort has no bound. Measured on
/// Postgres 18 with `work_mem` at 1.6 MB, a hunt of 7,000 reports sorts to a temp file
/// (`external merge  Disk: 1608kB`); the same read under a `LIMIT` plans as an ordered index
/// scan with no sort at all.
///
/// 500 is far above any hunt this has seen — the largest so far is 206 — so in practice the
/// first page is the whole log and catch-up is still a single query. The page boundary is
/// invisible to a client either way: the events, their ids and their order do not depend on how
/// many queries produced them.
pub const CATCH_UP_PAGE: i64 = 500;

/// One page of a catch-up read.
pub struct ReportPage {
    pub reports: Vec<ReportEnvelope>,
    /// The page came back full, so there is more above its last `seq` and the reader should come
    /// straight back rather than wait for the next append. A log that ends exactly on a page
    /// boundary therefore costs one extra empty read.
    pub filled: bool,
}

/// At most [`CATCH_UP_PAGE`] reports with a sequence above `since`, ascending — one page of
/// [`reports_since`], for a reader that walks the log with a cursor.
pub async fn reports_page(
    pool: &PgPool,
    code: &str,
    since: i64,
) -> Result<ReportPage, sqlx::Error> {
    let rows = sqlx::query(
        "SELECT seq, received_at, body FROM reports
         WHERE hunt_code = $1 AND seq > $2
         ORDER BY seq ASC
         LIMIT $3",
    )
    .bind(code.to_lowercase())
    .bind(since)
    .bind(CATCH_UP_PAGE)
    .fetch_all(pool)
    .await?;

    let filled = i64::try_from(rows.len()).is_ok_and(|n| n >= CATCH_UP_PAGE);

    Ok(ReportPage {
        reports: rows.iter().map(envelope).collect(),
        filled,
    })
}

fn envelope(row: &PgRow) -> ReportEnvelope {
    ReportEnvelope {
        seq: row.get("seq"),
        received_at: row.get("received_at"),
        body: row.get("body"),
    }
}

pub async fn report_ids(pool: &PgPool, code: &str) -> Result<Vec<String>, sqlx::Error> {
    let rows = sqlx::query("SELECT id FROM reports WHERE hunt_code = $1")
        .bind(code.to_lowercase())
        .fetch_all(pool)
        .await?;

    Ok(rows
        .into_iter()
        .map(|r| r.get::<Uuid, _>("id").to_string())
        .collect())
}

/// The divergence-audit digest, specified exactly because "SHA-256 over the sorted id list" is not
/// a specification — a third party would guess a different answer and the audit would report
/// divergence that isn't there.
///
/// ```text
/// digest = "sha256:" + hex(SHA-256(join(sort_asc([lowercase(id) for id in reports]), "\n")))
/// ```
///
/// Sort ascending bytewise over lowercase canonical UUIDs (ASCII, so bytewise and lexicographic
/// agree). Join with a single `\n`, **no trailing newline**. Lowercase hex. The digest of an empty
/// log is the SHA-256 of the empty string.
#[must_use]
pub fn id_digest(ids: &[String]) -> String {
    let mut sorted: Vec<String> = ids.iter().map(|id| id.to_lowercase()).collect();
    sorted.sort();
    let joined = sorted.join("\n");
    let digest = Sha256::digest(joined.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}
