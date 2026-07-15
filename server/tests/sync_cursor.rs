//! The sequence gap: the one place this design can silently lose a report.
//!
//! If `seq` is assigned at transaction start and commits land out of order, a reader can observe
//! seq 5 while seq 4 is still in flight, advance its cursor past 4, and **never see 4**. No error,
//! no retry — the log has diverged permanently.
//!
//! The mitigation is serializing appends so a sequence is never visible before it is committed.
//! These tests are the reason that mitigation is a mechanism rather than a hope.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{model::IncomingReport, store};
use std::collections::HashSet;
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";

#[tokio::test]
async fn since_zero_returns_the_whole_log() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    for _ in 0..5 {
        let r = IncomingReport::from_value(report_body(Uuid::new_v4(), "null")).expect("parse");
        store::append_reports(&db.pool, CODE, &[r], 1_000)
            .await
            .expect("append");
    }

    // The recovery path after storage eviction, and why eviction costs a re-download rather than
    // a lost hunt.
    let all = store::reports_since(&db.pool, CODE, 0).await.expect("sync");
    assert_eq!(all.len(), 5);

    db.cleanup().await;
}

#[tokio::test]
async fn reports_come_back_in_ascending_sequence() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    for _ in 0..10 {
        let r = IncomingReport::from_value(report_body(Uuid::new_v4(), "omni")).expect("parse");
        store::append_reports(&db.pool, CODE, &[r], 1_000)
            .await
            .expect("append");
    }

    let all = store::reports_since(&db.pool, CODE, 0).await.expect("sync");
    let seqs: Vec<i64> = all.iter().map(|r| r.seq).collect();
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    assert_eq!(seqs, sorted);

    db.cleanup().await;
}

#[tokio::test]
async fn walking_the_cursor_sees_every_report_exactly_once() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let mut written = HashSet::new();
    for _ in 0..20 {
        let id = Uuid::new_v4();
        written.insert(id.to_string());
        let r = IncomingReport::from_value(report_body(id, "bearing")).expect("parse");
        store::append_reports(&db.pool, CODE, &[r], 1_000)
            .await
            .expect("append");
    }

    // Walk one report at a time, exactly as a client drains the stream.
    let mut cursor = 0i64;
    let mut seen = Vec::new();
    loop {
        let batch = store::reports_since(&db.pool, CODE, cursor)
            .await
            .expect("sync");
        let Some(first) = batch.first() else { break };
        cursor = first.seq;
        seen.push(first.body["id"].as_str().expect("id").to_string());
    }

    assert_eq!(seen.len(), written.len());
    assert_eq!(seen.iter().cloned().collect::<HashSet<_>>(), written);

    db.cleanup().await;
}

#[tokio::test]
async fn concurrent_appends_produce_no_gap_a_reader_can_skip_past() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // Hammer the append path from many tasks at once. Without the advisory lock, seq order and
    // commit order diverge and this is where the lost report appears.
    let mut handles = Vec::new();
    for _ in 0..24 {
        let pool = db.pool.clone();
        handles.push(tokio::spawn(async move {
            let r = IncomingReport::from_value(report_body(Uuid::new_v4(), "null")).expect("parse");
            store::append_reports(&pool, CODE, &[r], 1_000)
                .await
                .expect("append");
        }));
    }
    for handle in handles {
        handle.await.expect("append task");
    }

    let all = store::reports_since(&db.pool, CODE, 0).await.expect("sync");
    assert_eq!(all.len(), 24, "every concurrent append must be readable");

    // The real property: a reader advancing its cursor one report at a time never skips one. Any
    // seq the reader can observe must be the next one it has not seen.
    let mut cursor = 0i64;
    let mut count = 0;
    loop {
        let batch = store::reports_since(&db.pool, CODE, cursor)
            .await
            .expect("sync");
        let Some(next) = batch.first() else { break };
        cursor = next.seq;
        count += 1;
    }
    assert_eq!(count, 24, "cursor walk must see every report");

    db.cleanup().await;
}

#[tokio::test]
async fn a_reader_that_saw_the_highest_seq_has_seen_every_committed_report() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // The gap hazard restated: if a seq is visible before an earlier one commits, then reading
    // "everything up to max(seq)" would miss the in-flight row. Append concurrently, then assert
    // that the count below the maximum is exactly the maximum's position in the sequence.
    let mut handles = Vec::new();
    for _ in 0..16 {
        let pool = db.pool.clone();
        handles.push(tokio::spawn(async move {
            let r = IncomingReport::from_value(report_body(Uuid::new_v4(), "omni")).expect("parse");
            store::append_reports(&pool, CODE, &[r], 1_000)
                .await
                .expect("append");
        }));
    }
    for handle in handles {
        handle.await.expect("append task");
    }

    let all = store::reports_since(&db.pool, CODE, 0).await.expect("sync");
    let seqs: Vec<i64> = all.iter().map(|r| r.seq).collect();
    let max = *seqs.iter().max().expect("some reports");
    let min = *seqs.iter().min().expect("some reports");

    // No holes: the sequences form a contiguous run, so no cursor position can straddle a gap.
    assert_eq!(
        max - min + 1,
        i64::try_from(seqs.len()).expect("fits"),
        "sequences must be contiguous: {seqs:?}"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn an_append_cannot_start_while_another_is_in_flight() {
    // The test that actually pins the mitigation. Everything above would pass with the advisory
    // lock removed, because a lost report needs a precise interleaving to appear. This forces it:
    //
    //   A: BEGIN, take the lock, INSERT (holds seq N), does not commit
    //   B: append — must BLOCK. If it proceeds it gets seq N+1 and commits first, and a reader
    //      can then observe N+1, advance its cursor past N, and never see N.
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let mut held = db.pool.begin().await.expect("begin");
    sqlx::query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)")
        .bind(CODE)
        .execute(&mut *held)
        .await
        .expect("take lock");
    sqlx::query("INSERT INTO reports (id, hunt_code, received_at, body) VALUES ($1, $2, $3, $4)")
        .bind(Uuid::new_v4())
        .bind(CODE)
        .bind(1_000i64)
        .bind(report_body(Uuid::new_v4(), "bearing"))
        .execute(&mut *held)
        .await
        .expect("insert in flight");

    let pool = db.pool.clone();
    let second = tokio::spawn(async move {
        let r = IncomingReport::from_value(report_body(Uuid::new_v4(), "omni")).expect("parse");
        store::append_reports(&pool, CODE, &[r], 2_000).await
    });

    let outcome =
        tokio::time::timeout(std::time::Duration::from_millis(500), &mut { second }).await;
    assert!(
        outcome.is_err(),
        "a second append proceeded while the first was still in flight — the sequence gap is open \
         and a report can be lost silently"
    );

    held.commit().await.expect("commit the in-flight append");

    db.cleanup().await;
}

#[tokio::test]
async fn one_hunts_reports_never_appear_in_another() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    db.seed_hunt("brisk-owl-3310-k2m9").await;

    let mine = IncomingReport::from_value(report_body(Uuid::new_v4(), "fix")).expect("parse");
    store::append_reports(&db.pool, CODE, &[mine], 1_000)
        .await
        .expect("append");

    let theirs = store::reports_since(&db.pool, "brisk-owl-3310-k2m9", 0)
        .await
        .expect("sync");
    assert!(theirs.is_empty());

    db.cleanup().await;
}
