//! The 30-day idle purge.
//!
//! Idle-based, not age-based: every append restarts the clock, so a hunt in use never expires
//! under its participants. A hunt with no reports purges 30 days after creation.

use sqlx::PgPool;
use std::time::Duration;

pub const RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1_000;

/// Deletes hunts idle for longer than `RETENTION_MS`, and their reports with them.
///
/// Expiry is derived rather than stored: `max(report.received_at) + 30 days`, falling back to the
/// hunt's `created_at` when no report has ever arrived. After purge the code is dead — `GET`
/// endpoints 404 and the stream 204s.
pub async fn purge_idle_hunts(pool: &PgPool, now: i64) -> Result<Vec<String>, sqlx::Error> {
    let rows: Vec<(String,)> = sqlx::query_as(
        "DELETE FROM hunts
         WHERE COALESCE(
                 (SELECT MAX(received_at) FROM reports WHERE reports.hunt_code = hunts.code),
                 hunts.created_at
               ) + $1 < $2
         RETURNING code",
    )
    .bind(RETENTION_MS)
    .bind(now)
    .fetch_all(pool)
    .await?;

    Ok(rows.into_iter().map(|(code,)| code).collect())
}

/// Runs the purge on an interval for the life of the process.
pub fn spawn(pool: PgPool, interval: Duration) {
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(interval);
        loop {
            ticker.tick().await;
            let now = crate::now_ms();
            match purge_idle_hunts(&pool, now).await {
                Ok(codes) if !codes.is_empty() => {
                    tracing::info!(count = codes.len(), "purged idle hunts");
                }
                Ok(_) => {}
                Err(error) => tracing::error!(%error, "purge failed"),
            }
        }
    });
}
