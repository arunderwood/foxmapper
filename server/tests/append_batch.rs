//! A queue flush is one statement, and the log keeps the order the client queued it in.
//!
//! `seq` is the order every device replays the log in, and the only order it has: the relay cannot
//! read the bodies, so nothing downstream can re-derive the sequence a batch was written in. A
//! flush that lands out of order is a hunt that reads differently on the device that sent it than
//! on every other one.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{model::IncomingReport, routes::reports::MAX_BATCH, store};
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";

/// Ids in descending order, so a log ordered by anything but the batch position is visible.
fn descending_ids(n: usize) -> Vec<Uuid> {
    let mut ids: Vec<Uuid> = (0..n).map(|_| Uuid::new_v4()).collect();
    ids.sort_unstable();
    ids.reverse();
    ids
}

fn batch(ids: &[Uuid]) -> Vec<IncomingReport> {
    ids.iter()
        .enumerate()
        .map(|(position, id)| {
            IncomingReport::from_value(report_body(*id, &position.to_string())).expect("parse")
        })
        .collect()
}

/// Positions as the log holds them, read back by ascending `seq`.
async fn positions_by_seq(db: &TestDb) -> Vec<String> {
    sqlx::query_scalar::<_, String>("SELECT body->>'kind' FROM reports ORDER BY seq ASC")
        .fetch_all(&db.pool)
        .await
        .expect("read positions")
}

#[tokio::test]
async fn a_batch_lands_in_the_order_it_was_sent() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let ids = descending_ids(MAX_BATCH);
    let accepted = store::append_reports(&db.pool, CODE, &batch(&ids), 1_000)
        .await
        .expect("append");

    // `accepted` is the batch order too: the client matches it against its own queue.
    assert_eq!(accepted, ids);

    let expected: Vec<String> = (0..MAX_BATCH).map(|p| p.to_string()).collect();
    assert_eq!(positions_by_seq(&db).await, expected);

    db.cleanup().await;
}

/// The statement count, not the row count. A per-report insert passes every assertion about the
/// stored log and still costs 200 round trips with the per-hunt advisory lock held for all of them.
#[tokio::test]
async fn a_batch_is_one_insert() {
    let db = TestDb::new().await;

    // One prepared statement each: the extended protocol rejects several commands in one.
    for statement in [
        "CREATE TABLE insert_statements (n BIGINT NOT NULL)",
        "INSERT INTO insert_statements VALUES (0)",
        "CREATE FUNCTION count_insert_statement() RETURNS trigger LANGUAGE plpgsql AS $$
           BEGIN UPDATE insert_statements SET n = n + 1; RETURN NULL; END $$",
        "CREATE TRIGGER reports_insert_statements AFTER INSERT ON reports
           FOR EACH STATEMENT EXECUTE FUNCTION count_insert_statement()",
    ] {
        sqlx::query(statement)
            .execute(&db.pool)
            .await
            .expect("install the statement counter");
    }

    db.seed_hunt(CODE).await;

    let ids = descending_ids(MAX_BATCH);
    store::append_reports(&db.pool, CODE, &batch(&ids), 1_000)
        .await
        .expect("append");

    let statements = sqlx::query_scalar::<_, i64>("SELECT n FROM insert_statements")
        .fetch_one(&db.pool)
        .await
        .expect("read the statement counter");

    assert_eq!(
        statements, 1,
        "a {MAX_BATCH}-report flush took {statements} insert statements"
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM reports")
            .fetch_one(&db.pool)
            .await
            .expect("count reports"),
        i64::try_from(MAX_BATCH).expect("fits")
    );

    db.cleanup().await;
}

#[tokio::test]
async fn a_batch_that_repeats_an_id_keeps_the_first_one() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // A client that retried into its own queue can flush the same report twice in one request.
    // Within a single statement the repeat conflicts with the row that statement just inserted,
    // so it is skipped exactly as a re-append across two requests would be.
    let repeated = Uuid::new_v4();
    let fresh = Uuid::new_v4();
    let flush = vec![
        IncomingReport::from_value(report_body(repeated, "first")).expect("parse"),
        IncomingReport::from_value(report_body(fresh, "fresh")).expect("parse"),
        IncomingReport::from_value(report_body(repeated, "second")).expect("parse"),
    ];

    let accepted = store::append_reports(&db.pool, CODE, &flush, 1_000)
        .await
        .expect("flush");

    // Every id the client sent is in the log, so its queue drains.
    assert_eq!(accepted, vec![repeated, fresh, repeated]);
    assert_eq!(positions_by_seq(&db).await, vec!["first", "fresh"]);

    db.cleanup().await;
}

#[tokio::test]
async fn re_appending_a_whole_batch_stores_nothing_new() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // The flush the client repeats after a response it never saw. Every id is already known, so
    // the statement inserts nothing, and the sequence does not move — a client that advanced its
    // cursor past these would otherwise re-read them forever.
    let ids = descending_ids(32);
    store::append_reports(&db.pool, CODE, &batch(&ids), 1_000)
        .await
        .expect("first flush");
    let before = positions_by_seq(&db).await;
    let max_seq = sqlx::query_scalar::<_, i64>("SELECT MAX(seq) FROM reports")
        .fetch_one(&db.pool)
        .await
        .expect("read max seq");

    let accepted = store::append_reports(&db.pool, CODE, &batch(&ids), 9_999)
        .await
        .expect("second flush");

    // Accepted, not rejected: a no-op is a success, which is what lets the retry be blind.
    assert_eq!(accepted, ids);
    assert_eq!(positions_by_seq(&db).await, before);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT MAX(seq) FROM reports")
            .fetch_one(&db.pool)
            .await
            .expect("read max seq again"),
        max_seq
    );
    assert_eq!(
        sqlx::query_scalar::<_, Vec<i64>>("SELECT array_agg(DISTINCT received_at) FROM reports")
            .fetch_one(&db.pool)
            .await
            .expect("read received_at"),
        vec![1_000]
    );

    db.cleanup().await;
}

#[tokio::test]
async fn an_empty_flush_is_accepted_and_stores_nothing() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // `POST` with `[]` reaches the store as an empty batch. The bound arrays are empty, which the
    // statement has to survive rather than fault on.
    let accepted = store::append_reports(&db.pool, CODE, &[], 1_000)
        .await
        .expect("empty flush");

    assert!(accepted.is_empty(), "accepted {accepted:?} from no reports");
    let stored = positions_by_seq(&db).await;
    assert!(stored.is_empty(), "an empty flush stored {stored:?}");

    db.cleanup().await;
}
