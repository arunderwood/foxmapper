//! The 30-day idle purge.
//!
//! Idle-based, not age-based: a hunt in use must never expire under its participants.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{
    model::IncomingReport,
    store::{
        self,
        purge::{purge_idle_hunts, RETENTION_MS},
    },
};
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";
const CREATED: i64 = 1_784_092_800_000;

#[tokio::test]
async fn a_hunt_with_no_reports_purges_30_days_after_creation() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let purged = purge_idle_hunts(&db.pool, CREATED + RETENTION_MS - 1)
        .await
        .expect("purge");
    assert!(purged.is_empty(), "purged one second early");

    let purged = purge_idle_hunts(&db.pool, CREATED + RETENTION_MS + 1)
        .await
        .expect("purge");
    assert_eq!(purged, vec![CODE.to_string()]);

    db.cleanup().await;
}

#[tokio::test]
async fn the_idle_clock_restarts_on_every_append() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // A report arrives 29 days in.
    let late = CREATED + RETENTION_MS - 24 * 60 * 60 * 1_000;
    let report = IncomingReport::from_value(report_body(Uuid::new_v4(), "bearing")).expect("parse");
    store::append_reports(&db.pool, CODE, &[report], late)
        .await
        .expect("append");

    // The hunt must now survive past what would have been its expiry, because the clock restarted.
    let purged = purge_idle_hunts(&db.pool, CREATED + RETENTION_MS + 1)
        .await
        .expect("purge");
    assert!(purged.is_empty(), "a hunt expired under its participants");

    // And it must still purge 30 days after that last report.
    let purged = purge_idle_hunts(&db.pool, late + RETENTION_MS + 1)
        .await
        .expect("purge");
    assert_eq!(purged, vec![CODE.to_string()]);

    db.cleanup().await;
}

#[tokio::test]
async fn purge_takes_the_reports_with_it() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    for _ in 0..3 {
        let r = IncomingReport::from_value(report_body(Uuid::new_v4(), "null")).expect("parse");
        store::append_reports(&db.pool, CODE, &[r], CREATED)
            .await
            .expect("append");
    }

    purge_idle_hunts(&db.pool, CREATED + RETENTION_MS + 1)
        .await
        .expect("purge");

    let remaining = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM reports")
        .fetch_one(&db.pool)
        .await
        .expect("count");
    assert_eq!(remaining, 0, "purge left orphaned reports");

    db.cleanup().await;
}

#[tokio::test]
async fn a_purged_hunt_is_indistinguishable_from_an_unknown_one() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    purge_idle_hunts(&db.pool, CREATED + RETENTION_MS + 1)
        .await
        .expect("purge");

    // 404 either way, on purpose: after purge there is nothing to disclose.
    assert!(store::get_hunt(&db.pool, CODE)
        .await
        .expect("lookup")
        .is_none());
    assert!(store::get_hunt(&db.pool, "never-existed-0000-aaaa")
        .await
        .expect("lookup")
        .is_none());

    db.cleanup().await;
}

#[tokio::test]
async fn appending_to_a_purged_hunt_is_not_found() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    purge_idle_hunts(&db.pool, CREATED + RETENTION_MS + 1)
        .await
        .expect("purge");

    let report = IncomingReport::from_value(report_body(Uuid::new_v4(), "fix")).expect("parse");
    let result = store::append_reports(&db.pool, CODE, &[report], CREATED).await;
    assert!(matches!(result, Err(store::StoreError::HuntNotFound)));

    db.cleanup().await;
}

#[tokio::test]
async fn purge_leaves_active_hunts_alone() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    db.seed_hunt("brisk-owl-3310-k2m9").await;

    let fresh = CREATED + RETENTION_MS;
    let report = IncomingReport::from_value(report_body(Uuid::new_v4(), "omni")).expect("parse");
    store::append_reports(&db.pool, "brisk-owl-3310-k2m9", &[report], fresh)
        .await
        .expect("append");

    let purged = purge_idle_hunts(&db.pool, CREATED + RETENTION_MS + 1)
        .await
        .expect("purge");
    assert_eq!(purged, vec![CODE.to_string()], "purged the wrong hunt");
    assert!(store::get_hunt(&db.pool, "brisk-owl-3310-k2m9")
        .await
        .expect("lookup")
        .is_some());

    db.cleanup().await;
}
