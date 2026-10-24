//! Catch-up is paged, and paging is invisible.
//!
//! A client that has lost its storage asks for the whole log from seq 0, and `seq > 0` filters
//! nothing — so the unbounded form of that read sorts the hunt's entire log, with no bound on the
//! sort. The read is paged instead, which puts a second property at risk: `seq` is the SSE event
//! id and the client's cursor, so a page boundary that skipped, duplicated or reordered a report
//! would corrupt exactly the thing the cursor protects. These tests are about that boundary.

mod common;

use common::TestDb;
use foxmapper_server::{router, store, AppState};
use std::{collections::HashSet, net::SocketAddr, time::Duration};
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

const CODE: &str = "quiet-fox-8821-h7k2";

fn page_size() -> usize {
    usize::try_from(store::CATCH_UP_PAGE).expect("page size fits in a usize")
}

/// Bulk-seeds `count` reports straight into the table.
///
/// Not through `append_reports`: that serializes on an advisory lock and sends a notification per
/// call, which is the write path's business and not what these tests read. Thousands of rows in
/// one statement keeps them quick.
async fn seed_reports(db: &TestDb, count: usize) {
    sqlx::query(
        "INSERT INTO reports (id, hunt_code, received_at, body)
         SELECT gen_random_uuid(), $1, $2, jsonb_build_object('v', 1, 'kind', 'bearing', 'n', n)
         FROM generate_series(1, $3) AS n",
    )
    .bind(CODE)
    .bind(1_784_092_800_000i64)
    .bind(i64::try_from(count).expect("count fits"))
    .execute(&db.pool)
    .await
    .expect("seed reports");
}

async fn serve(state: AppState) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    let app = router(state);
    tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await;
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn a_cursor_walk_reads_the_whole_log_in_bounded_pages() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // Two full pages and a short one, so the walk has to cross a boundary twice and then stop.
    let total = page_size() * 2 + 7;
    seed_reports(&db, total).await;

    let mut cursor = 0i64;
    let mut seqs = Vec::new();
    let mut pages = Vec::new();
    loop {
        let page = store::reports_page(&db.pool, CODE, cursor)
            .await
            .expect("page");
        assert!(
            page.reports.len() <= page_size(),
            "a page must never exceed {} rows, got {}",
            page_size(),
            page.reports.len()
        );
        for report in &page.reports {
            cursor = report.seq;
            seqs.push(report.seq);
        }
        pages.push((page.reports.len(), page.filled));
        if !page.filled {
            break;
        }
    }

    // The property the cursor protects: every report exactly once, in order, no gaps.
    let expected: Vec<i64> = (1..=i64::try_from(total).expect("total fits")).collect();
    assert_eq!(
        seqs, expected,
        "the walk must see every seq once, ascending"
    );
    assert_eq!(
        seqs.iter().collect::<HashSet<_>>().len(),
        total,
        "no seq may be delivered twice"
    );

    assert_eq!(
        pages,
        vec![(page_size(), true), (page_size(), true), (7, false)],
        "the walk must be three bounded reads, not one"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn a_log_ending_on_a_page_boundary_ends_with_an_empty_page() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    seed_reports(&db, page_size()).await;

    let full = store::reports_page(&db.pool, CODE, 0).await.expect("page");
    assert_eq!(full.reports.len(), page_size());
    assert!(
        full.filled,
        "a page that filled cannot know the log ended with it"
    );

    let cursor = full.reports.last().expect("a report").seq;
    let after = store::reports_page(&db.pool, CODE, cursor)
        .await
        .expect("page");
    assert!(after.reports.is_empty());
    assert!(
        !after.filled,
        "an empty page must end the walk rather than ask for another"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn an_empty_hunt_reads_one_empty_page() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // The page that ends the walk, so a stream over an empty hunt reaches its wait instead of
    // reading in a loop.
    let page = store::reports_page(&db.pool, CODE, 0).await.expect("page");
    assert!(page.reports.is_empty());
    assert!(!page.filled);

    db.cleanup().await;
}

#[tokio::test]
async fn the_stream_catches_up_across_a_page_boundary_and_stays_live() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // More than one page, so the handler has to come straight back for the rest instead of
    // waiting for an append that may never come.
    let seeded = page_size() + 13;
    seed_reports(&db, seeded).await;

    let state = db.state();
    // The live half needs the LISTEN bridge; catch-up alone would pass without it.
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://foxmapper:foxmapper@localhost:5432/foxmapper".into());
    let listener_url = url
        .rsplit_once('/')
        .map(|(p, _)| format!("{p}/{}", db.name))
        .expect("url");
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    foxmapper_server::spawn_listener(listener_url, state.notify_tx.clone(), Some(ready_tx));
    ready_rx.await.expect("listener ready");

    let base = serve(state).await;
    let http = reqwest::Client::new();

    let response = http
        .get(format!("{base}/api/hunts/{CODE}/stream"))
        .header("Accept", "text/event-stream")
        .send()
        .await
        .expect("stream");
    assert_eq!(response.status(), 200);

    let stream = response.bytes_stream();
    let reader = BufReader::new(tokio_util::io::StreamReader::new(
        futures::TryStreamExt::map_err(stream, std::io::Error::other),
    ));
    let mut lines = reader.lines();

    // One more than the seeded log: the last arrives only if the handler left the paged read and
    // reached its notification wait.
    let expected = seeded + 1;
    let mut ids_seen: Vec<i64> = Vec::new();
    let mut appended = false;

    let collect = async {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(id) = line.strip_prefix("id:") {
                ids_seen.push(id.trim().parse().expect("seq"));
            }
            if ids_seen.len() == expected {
                break;
            }
            if ids_seen.len() == seeded && !appended {
                appended = true;
                let _ = http
                    .post(format!("{base}/api/hunts/{CODE}/reports"))
                    .json(&common::report_body(Uuid::new_v4(), "fix"))
                    .send()
                    .await;
            }
        }
    };

    tokio::time::timeout(Duration::from_secs(30), collect)
        .await
        .unwrap_or_else(|_| {
            panic!(
                "the stream delivered {} of {expected} events; a paged catch-up that stops at a \
                 page boundary looks exactly like this",
                ids_seen.len()
            )
        });

    let expected_ids: Vec<i64> = (1..=i64::try_from(expected).expect("fits")).collect();
    assert_eq!(
        ids_seen, expected_ids,
        "every event exactly once, ascending, across the page boundary"
    );

    db.cleanup().await;
}
