//! An append whose caller goes away must not leave its connection inside a transaction.
//!
//! A browser that closes mid-flush drops the handler future at whatever `.await` it had reached.
//! Dropped inside sqlx's `begin()` — after `BEGIN` is sent, before its reply — the connection goes
//! back to the pool with a transaction open that sqlx does not know about. Every autocommit write
//! it serves after that is never committed: a hunt is "created", and `GET` says it does not exist.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{model::IncomingReport, model::Target, store};
use sqlx::{postgres::PgPoolOptions, Connection, PgConnection};
use std::time::Duration;
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";

#[tokio::test]
async fn a_cancelled_append_leaves_no_transaction_behind() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    let options = (*db.pool.connect_options()).clone();

    // One connection, so the write after each cancel lands on the connection the cancel touched.
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options.clone())
        .await
        .expect("connect");
    let mut observer = PgConnection::connect_with(&options).await.expect("connect");
    let target = Target {
        frequency: "146.52".into(),
        label: "Saturday fox".into(),
    };

    // Stepped timeouts, so some cancel lands inside `BEGIN` however fast this machine is.
    for micros in 0..400u64 {
        let id = Uuid::new_v4();
        let report = IncomingReport::from_value(report_body(id, "null")).expect("valid report");
        let _ = tokio::time::timeout(
            Duration::from_micros(micros),
            store::append_reports(&pool, CODE, &[report], 1_000),
        )
        .await;

        // Checked every time: the next append to commit would commit a leaked transaction too,
        // and hide it.
        let code = format!("check-fox-{micros:04}-aaaa");
        store::create_hunt(&pool, &code, &target, 1_000)
            .await
            .expect("create hunt");
        let seen: Option<(String,)> = sqlx::query_as("SELECT code FROM hunts WHERE code = $1")
            .bind(&code)
            .fetch_optional(&mut observer)
            .await
            .expect("lookup");
        assert!(
            seen.is_some(),
            "a hunt created after an append cancelled at {micros} µs is invisible to other \
             connections: the cancel left its connection inside a transaction"
        );
    }

    pool.close().await;
    db.cleanup().await;
}
