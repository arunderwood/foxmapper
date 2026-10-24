//! Catch-up is paged, and paging is invisible.
//!
//! A client that has lost its storage asks for the whole log from seq 0, and `seq > 0` filters
//! nothing — so the unbounded form of that read sorts the hunt's entire log, with no bound on the
//! sort. The read is paged instead, which puts a second property at risk: `seq` is the SSE event
//! id and the client's cursor, so a page boundary that skipped, duplicated or reordered a report
//! would corrupt exactly the thing the cursor protects. These tests are about that boundary.
//!
//! Both read paths are here: the SSE stream, and the HTTP fallback `GET /reports?since=`. The
//! fallback is the one a client drives itself, so it also has to *say* that a page is not the end
//! — a response the client can mistake for the whole log is a report dropped silently, and the
//! fallback is the repair path the divergence audit uses.

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

/// The `GET /reports?since=` response, as a client parses it.
#[derive(serde::Deserialize)]
struct SyncPage {
    reports: Vec<serde_json::Value>,
    cursor: i64,
    more: bool,
}

#[tokio::test]
async fn the_sync_endpoint_answers_with_one_bounded_page_and_says_there_is_more() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    let total = page_size() * 2 + 7;
    seed_reports(&db, total).await;

    let base = serve(db.state()).await;
    let page: SyncPage = reqwest::get(format!("{base}/api/hunts/{CODE}/reports?since=0"))
        .await
        .expect("sync")
        .json()
        .await
        .expect("decode");

    assert_eq!(
        page.reports.len(),
        page_size(),
        "the response must be one page, not the whole log"
    );
    // The highest seq in the response, not the highest in the log: a client resumes from this, so
    // a cursor ahead of what it was handed would skip the gap in between.
    assert_eq!(
        page.cursor,
        i64::try_from(page_size()).expect("fits"),
        "the cursor must name the last report actually delivered"
    );
    assert!(
        page.more,
        "a truncated response that claims to be complete is a report dropped in silence"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn the_last_page_of_the_sync_endpoint_says_there_is_no_more() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;
    seed_reports(&db, 7).await;

    let base = serve(db.state()).await;
    let page: SyncPage = reqwest::get(format!("{base}/api/hunts/{CODE}/reports?since=0"))
        .await
        .expect("sync")
        .json()
        .await
        .expect("decode");

    assert_eq!(page.reports.len(), 7);
    assert_eq!(page.cursor, 7);
    assert!(
        !page.more,
        "a short page is the end of the log; claiming more costs every client an extra request \
         every tick, forever"
    );

    // An empty hunt is the same statement with nothing in it, and must leave the cursor where the
    // client put it rather than reporting 0 and rewinding it.
    let empty: SyncPage = reqwest::get(format!("{base}/api/hunts/{CODE}/reports?since=7"))
        .await
        .expect("sync")
        .json()
        .await
        .expect("decode");
    assert_eq!(empty.reports.len(), 0);
    assert_eq!(empty.cursor, 7);
    assert!(!empty.more);

    db.cleanup().await;
}

#[tokio::test]
async fn a_client_walking_the_sync_endpoint_reads_the_whole_log_exactly_once() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // Two full pages and a short one: the walk crosses a boundary twice and then has to stop.
    let total = page_size() * 2 + 7;
    seed_reports(&db, total).await;

    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // Exactly what web/src/log/sync.ts does: read from the cursor it was handed, while the relay
    // says there is more.
    let mut cursor = 0i64;
    let mut seqs: Vec<i64> = Vec::new();
    let mut requests = 0;
    loop {
        let page: SyncPage = http
            .get(format!("{base}/api/hunts/{CODE}/reports?since={cursor}"))
            .send()
            .await
            .expect("sync")
            .json()
            .await
            .expect("decode");
        requests += 1;
        assert!(
            page.reports.len() <= page_size(),
            "a response must never exceed {} reports, got {}",
            page_size(),
            page.reports.len()
        );
        for report in &page.reports {
            seqs.push(report["seq"].as_i64().expect("seq"));
        }
        if !page.more {
            break;
        }
        assert!(
            page.cursor > cursor,
            "the cursor must advance or the walk cannot end"
        );
        cursor = page.cursor;
    }

    let expected: Vec<i64> = (1..=i64::try_from(total).expect("total fits")).collect();
    assert_eq!(
        seqs, expected,
        "the walk must see every seq once, ascending, across both boundaries"
    );
    assert_eq!(
        seqs.iter().collect::<HashSet<_>>().len(),
        total,
        "no seq may be delivered twice"
    );
    assert_eq!(
        requests, 3,
        "the walk must be three bounded requests; one means the endpoint is still unbounded"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn the_sync_endpoint_and_the_stream_agree_on_what_a_cursor_has_seen() {
    let db = TestDb::new().await;
    db.seed_hunt(CODE).await;

    // The two protocols are idempotent with each other only if they hand the same cursor the same
    // reports. A client uses both: the stream while it is up, this endpoint every 15s regardless.
    //
    // The probe sits far enough below the end that more than a page remains above it, so the two
    // paths agreeing means they agree about the *bound*, not merely about a short tail they would
    // both return whole.
    seed_reports(&db, page_size() * 2 + 7).await;

    let probe = i64::try_from(page_size() / 2).expect("fits");
    let base = serve(db.state()).await;
    let page: SyncPage = reqwest::get(format!("{base}/api/hunts/{CODE}/reports?since={probe}"))
        .await
        .expect("sync")
        .json()
        .await
        .expect("decode");

    let streamed = store::reports_page(&db.pool, CODE, probe)
        .await
        .expect("page");

    let polled: Vec<i64> = page
        .reports
        .iter()
        .map(|r| r["seq"].as_i64().expect("seq"))
        .collect();
    let pushed: Vec<i64> = streamed.reports.iter().map(|r| r.seq).collect();
    assert_eq!(
        polled, pushed,
        "the poll and the stream must deliver the same reports above a cursor"
    );
    assert_eq!(page.more, streamed.filled);

    db.cleanup().await;
}
