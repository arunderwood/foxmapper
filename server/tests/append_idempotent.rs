//! Append is idempotent by report `id`.
//!
//! This is what lets the client retry blindly forever with no dedup logic — exactly what a flaky
//! mobile link needs, and the reason the outbound queue can be dumb.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{model::IncomingReport, store};
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";

async fn count_rows(db: &TestDb) -> i64 {
    sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM reports")
        .fetch_one(&db.pool)
        .await
        .expect("count reports")
}

#[tokio::test]
async fn same_id_twice_is_one_row() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let id = Uuid::new_v4();
    let report = IncomingReport::from_value(report_body(id, "bearing")).expect("parse");

    let first = store::append_reports(&db.pool, CODE, std::slice::from_ref(&report), 1_000)
        .await
        .expect("first append");
    let second = store::append_reports(&db.pool, CODE, std::slice::from_ref(&report), 2_000)
        .await
        .expect("second append");

    // Both calls accept: re-appending a known id is a no-op, not a rejection.
    assert_eq!(first, vec![id]);
    assert_eq!(second, vec![id]);
    assert_eq!(count_rows(&db).await, 1);

    db.cleanup().await;
}

#[tokio::test]
async fn re_append_does_not_change_the_stored_row() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let id = Uuid::new_v4();
    let original = IncomingReport::from_value(report_body(id, "bearing")).expect("parse");
    store::append_reports(&db.pool, CODE, std::slice::from_ref(&original), 1_000)
        .await
        .expect("append");

    let (seq, received_at) =
        sqlx::query_as::<_, (i64, i64)>("SELECT seq, received_at FROM reports WHERE id = $1")
            .bind(id)
            .fetch_one(&db.pool)
            .await
            .expect("read row");

    // A report with the same id but a different body means immutability was violated upstream.
    // The append must not overwrite: the first write stands, and its seq does not move — a client
    // that already advanced past it would otherwise re-read it forever.
    let conflicting = IncomingReport::from_value(report_body(id, "fix")).expect("parse");
    store::append_reports(&db.pool, CODE, &[conflicting], 9_999)
        .await
        .expect("re-append");

    let (seq_after, received_after, kind) = sqlx::query_as::<_, (i64, i64, String)>(
        "SELECT seq, received_at, body->>'kind' FROM reports WHERE id = $1",
    )
    .bind(id)
    .fetch_one(&db.pool)
    .await
    .expect("read row again");

    assert_eq!(seq_after, seq);
    assert_eq!(received_after, received_at);
    assert_eq!(kind, "bearing");
    assert_eq!(count_rows(&db).await, 1);

    db.cleanup().await;
}

#[tokio::test]
async fn a_batch_with_a_known_id_accepts_the_new_ones() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let known = Uuid::new_v4();
    let first = IncomingReport::from_value(report_body(known, "omni")).expect("parse");
    store::append_reports(&db.pool, CODE, &[first], 1_000)
        .await
        .expect("append");

    // A queue flush after a partial success replays reports the server already has. The whole
    // batch must still land — dropping the new ones because an old one was known would lose a
    // report, which is the one unacceptable outcome.
    let fresh: Vec<_> = (0..3)
        .map(|_| IncomingReport::from_value(report_body(Uuid::new_v4(), "null")).expect("parse"))
        .collect();
    let mut batch = vec![IncomingReport::from_value(report_body(known, "omni")).expect("parse")];
    batch.extend(fresh);

    let accepted = store::append_reports(&db.pool, CODE, &batch, 2_000)
        .await
        .expect("flush");

    assert_eq!(accepted.len(), 4);
    assert_eq!(count_rows(&db).await, 4);

    db.cleanup().await;
}

#[tokio::test]
async fn appending_to_an_unknown_hunt_is_not_found() {
    let db = TestDb::new().await;
    let report = IncomingReport::from_value(report_body(Uuid::new_v4(), "fix")).expect("parse");

    // The client keeps the report locally rather than discarding it.
    let result = store::append_reports(&db.pool, "no-such-hunt-0000-aaaa", &[report], 1_000).await;
    assert!(matches!(result, Err(store::StoreError::HuntNotFound)));

    db.cleanup().await;
}

#[tokio::test]
async fn the_server_stores_a_body_it_cannot_interpret() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // The server validates only that the JSON parses and `id` is a UUID. It does not check `kind`,
    // does not validate a heading, and does not reject a confidence of 9 — enforcing domain rules
    // here would put direction-finding logic in the server.
    let id = Uuid::new_v4();
    let nonsense = serde_json::json!({
        "id": id.to_string(),
        "kind": "not-a-real-kind",
        "confidence_q": 9,
        "heading_true": 999,
        "arbitrary": { "recipe": "brisket" }
    });
    let report = IncomingReport::from_value(nonsense).expect("parse");

    let accepted = store::append_reports(&db.pool, CODE, &[report], 1_000)
        .await
        .expect("append");
    assert_eq!(accepted, vec![id]);

    db.cleanup().await;
}

#[tokio::test]
async fn a_body_without_a_uuid_id_is_rejected() {
    assert!(IncomingReport::from_value(serde_json::json!({ "kind": "fix" })).is_err());
    assert!(IncomingReport::from_value(serde_json::json!({ "id": "not-a-uuid" })).is_err());
    assert!(IncomingReport::from_value(serde_json::json!(["an", "array"])).is_err());
}
