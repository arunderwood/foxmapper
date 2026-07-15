//! Storage: append, cursor reads, and the divergence-audit digest.

pub mod purge;

use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
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
pub async fn append_reports(
    pool: &PgPool,
    code: &str,
    reports: &[IncomingReport],
    received_at: i64,
) -> Result<Vec<Uuid>, StoreError> {
    let code = code.to_lowercase();
    let mut tx = pool.begin().await?;

    let exists: Option<(String,)> = sqlx::query_as("SELECT code FROM hunts WHERE code = $1")
        .bind(&code)
        .fetch_optional(&mut *tx)
        .await?;
    if exists.is_none() {
        return Err(StoreError::HuntNotFound);
    }

    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
        .bind(&code)
        .execute(&mut *tx)
        .await?;

    let mut accepted = Vec::with_capacity(reports.len());
    for report in reports {
        // ON CONFLICT DO NOTHING is the whole idempotency story: re-appending a known id is a
        // no-op. This is what lets the client retry blindly forever with no dedup logic, which is
        // exactly what a flaky mobile link needs and the reason the outbound queue can be dumb.
        sqlx::query(
            "INSERT INTO reports (id, hunt_code, received_at, body)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(report.id)
        .bind(&code)
        .bind(received_at)
        .bind(&report.body)
        .execute(&mut *tx)
        .await?;
        accepted.push(report.id);
    }

    // Postgres delivers NOTIFY at commit, so a listener never learns of a seq before it is
    // readable — the same guarantee the advisory lock gives the sequence itself.
    sqlx::query("SELECT pg_notify($1, $2)")
        .bind(NOTIFY_CHANNEL)
        .bind(&code)
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

    Ok(rows
        .into_iter()
        .map(|r| ReportEnvelope {
            seq: r.get("seq"),
            received_at: r.get("received_at"),
            body: r.get("body"),
        })
        .collect())
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
