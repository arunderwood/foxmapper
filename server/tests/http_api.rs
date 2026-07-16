//! The endpoints, over real HTTP.
//!
//! The store tests below this cover the mechanisms; this covers the contract a client actually
//! sees — status codes, the SSE framing, and the 204 that tells a browser to stop reconnecting.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{router, spawn_listener, AppState};
use std::{net::SocketAddr, time::Duration};
use tokio::io::{AsyncBufReadExt, BufReader};
use uuid::Uuid;

/// Serves the router on an ephemeral port and returns its base URL.
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
async fn create_then_fetch_a_hunt() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let created = http
        .post(format!("{base}/api/hunts"))
        .json(&serde_json::json!({ "target": { "frequency": "146.52", "label": "Saturday fox" } }))
        .send()
        .await
        .expect("create");
    assert_eq!(created.status(), 201);

    let body: serde_json::Value = created.json().await.expect("json");
    let code = body["code"].as_str().expect("code").to_string();

    let fetched = http
        .get(format!("{base}/api/hunts/{code}"))
        .send()
        .await
        .expect("get");
    assert_eq!(fetched.status(), 200);
    let detail: serde_json::Value = fetched.json().await.expect("json");

    // The frequency is an opaque string, echoed back exactly as given.
    assert_eq!(detail["target"]["frequency"], "146.52");
    assert_eq!(detail["report_count"], 0);
    // The digest of an empty log is the digest of the empty string.
    assert_eq!(
        detail["id_digest"],
        "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
    // `found` is not here and must never be: the server has no way to know whether the fox has
    // been found, and holding that fact would make it authoritative over derived state.
    assert!(detail.get("found").is_none());

    db.cleanup().await;
}

#[tokio::test]
async fn an_unusual_frequency_string_is_not_rejected() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // Hunters say "two meters" and "the 440 machine". Validating this as a number would reject
    // real input to enable a computation that does not exist.
    for frequency in ["two meters", "the 440 machine", "146.52", ""] {
        let created = http
            .post(format!("{base}/api/hunts"))
            .json(&serde_json::json!({ "target": { "frequency": frequency, "label": "fox" } }))
            .send()
            .await
            .expect("create");
        assert_eq!(created.status(), 201, "rejected frequency {frequency:?}");
    }

    db.cleanup().await;
}

#[tokio::test]
async fn an_unknown_hunt_is_not_found() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let r = http
        .get(format!("{base}/api/hunts/no-such-hunt-0000-aaaa"))
        .send()
        .await
        .expect("get");
    assert_eq!(r.status(), 404);

    db.cleanup().await;
}

#[tokio::test]
async fn append_returns_202_both_times_for_the_same_id() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let id = Uuid::new_v4();
    let body = report_body(id, "bearing");

    for _ in 0..2 {
        let r = http
            .post(format!("{base}/api/hunts/{code}/reports"))
            .json(&body)
            .send()
            .await
            .expect("append");
        assert_eq!(r.status(), 202);
        let accepted: serde_json::Value = r.json().await.expect("json");
        assert_eq!(accepted["accepted"][0], id.to_string());
    }

    let synced: serde_json::Value = http
        .get(format!("{base}/api/hunts/{code}/reports?since=0"))
        .send()
        .await
        .expect("sync")
        .json()
        .await
        .expect("json");
    assert_eq!(synced["reports"].as_array().expect("array").len(), 1);

    db.cleanup().await;
}

#[tokio::test]
async fn an_array_of_reports_is_accepted_as_a_queue_flush() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let batch: Vec<_> = (0..5)
        .map(|_| report_body(Uuid::new_v4(), "null"))
        .collect();
    let r = http
        .post(format!("{base}/api/hunts/{code}/reports"))
        .json(&batch)
        .send()
        .await
        .expect("flush");
    assert_eq!(r.status(), 202);

    let accepted: serde_json::Value = r.json().await.expect("json");
    assert_eq!(accepted["accepted"].as_array().expect("array").len(), 5);

    db.cleanup().await;
}

#[tokio::test]
async fn the_stream_returns_204_for_a_purged_or_unknown_hunt() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // 204 tells the browser to stop reconnecting permanently — a clean, correct end for an expired
    // hunt, and the reason a client can land an arriving participant where a first-timer lands
    // instead of polling a dead code forever.
    let r = http
        .get(format!("{base}/api/hunts/no-such-hunt-0000-aaaa/stream"))
        .send()
        .await
        .expect("stream");
    assert_eq!(r.status(), 204);

    db.cleanup().await;
}

#[tokio::test]
async fn the_stream_replays_from_last_event_id_and_then_pushes_live() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;

    let state = db.state();
    // The stream's live half needs the LISTEN bridge; catch-up alone would pass without it.
    let url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://foxmapper:foxmapper@localhost:5432/foxmapper".into());
    let listener_url = url
        .rsplit_once('/')
        .map(|(p, _)| format!("{p}/{}", db.name))
        .expect("url");
    spawn_listener(listener_url, state.notify_tx.clone());

    let base = serve(state).await;
    let http = reqwest::Client::new();

    // Two reports exist before anyone connects.
    for _ in 0..2 {
        http.post(format!("{base}/api/hunts/{code}/reports"))
            .json(&report_body(Uuid::new_v4(), "omni"))
            .send()
            .await
            .expect("append");
    }

    let response = http
        .get(format!("{base}/api/hunts/{code}/stream"))
        .header("Accept", "text/event-stream")
        .send()
        .await
        .expect("stream");
    assert_eq!(response.status(), 200);
    assert!(response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .expect("content-type")
        .starts_with("text/event-stream"));
    // Buffered SSE fails the five-second requirement silently and only in production.
    assert_eq!(
        response.headers().get("x-accel-buffering").expect("header"),
        "no"
    );

    let stream = response.bytes_stream();
    let reader = BufReader::new(tokio_util::io::StreamReader::new(
        futures::TryStreamExt::map_err(stream, std::io::Error::other),
    ));
    let mut lines = reader.lines();

    // Catch-up: both pre-existing reports arrive without anyone asking for them by id.
    let mut ids_seen = Vec::new();
    let mut retry_seen = false;

    let collect = async {
        while let Ok(Some(line)) = lines.next_line().await {
            if line.starts_with("retry:") {
                retry_seen = true;
            }
            if let Some(id) = line.strip_prefix("id:") {
                ids_seen.push(id.trim().to_string());
            }
            if ids_seen.len() == 3 {
                break;
            }
            if ids_seen.len() == 2 {
                // Live push: a third report appended after the stream opened must arrive without
                // reconnecting. This is the half that proves realtime and sync are one path.
                let _ = http
                    .post(format!("{base}/api/hunts/{code}/reports"))
                    .json(&report_body(Uuid::new_v4(), "fix"))
                    .send()
                    .await;
                ids_seen.push("__sent".into());
                ids_seen.retain(|i| i != "__sent");
            }
        }
    };

    tokio::time::timeout(Duration::from_secs(10), collect)
        .await
        .expect("stream did not deliver three reports within ten seconds");

    assert!(
        retry_seen,
        "the stream must set the browser's reconnect delay"
    );
    assert_eq!(ids_seen.len(), 3);

    // `id:` is the server sequence, and it must ascend — the browser replays the last one as
    // Last-Event-ID, so a non-monotonic id would make a client re-read or skip.
    let seqs: Vec<i64> = ids_seen.iter().map(|s| s.parse().expect("seq")).collect();
    let mut sorted = seqs.clone();
    sorted.sort_unstable();
    assert_eq!(seqs, sorted, "stream ids must ascend: {seqs:?}");

    db.cleanup().await;
}

#[tokio::test]
async fn last_event_id_skips_what_the_client_already_has() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    for _ in 0..3 {
        http.post(format!("{base}/api/hunts/{code}/reports"))
            .json(&report_body(Uuid::new_v4(), "null"))
            .send()
            .await
            .expect("append");
    }

    let synced: serde_json::Value = http
        .get(format!("{base}/api/hunts/{code}/reports?since=0"))
        .send()
        .await
        .expect("sync")
        .json()
        .await
        .expect("json");
    let second_seq = synced["reports"][1]["seq"].as_i64().expect("seq");

    let response = http
        .get(format!("{base}/api/hunts/{code}/stream"))
        .header("Last-Event-ID", second_seq.to_string())
        .send()
        .await
        .expect("stream");

    let stream = response.bytes_stream();
    let reader = BufReader::new(tokio_util::io::StreamReader::new(
        futures::TryStreamExt::map_err(stream, std::io::Error::other),
    ));
    let mut lines = reader.lines();

    let first_id = tokio::time::timeout(Duration::from_secs(5), async {
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(id) = line.strip_prefix("id:") {
                return id.trim().parse::<i64>().expect("seq");
            }
        }
        panic!("stream closed without an event");
    })
    .await
    .expect("timed out waiting for the resumed event");

    // Catch-up after four offline hours and a live report are the same code path.
    assert!(
        first_id > second_seq,
        "stream replayed a report the client already had"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn the_ids_endpoint_backs_the_divergence_audit() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let mut written = Vec::new();
    for _ in 0..4 {
        let id = Uuid::new_v4();
        written.push(id.to_string());
        http.post(format!("{base}/api/hunts/{code}/reports"))
            .json(&report_body(id, "omni"))
            .send()
            .await
            .expect("append");
    }

    let listed: serde_json::Value = http
        .get(format!("{base}/api/hunts/{code}/ids"))
        .send()
        .await
        .expect("ids")
        .json()
        .await
        .expect("json");

    let mut got: Vec<String> = listed["ids"]
        .as_array()
        .expect("array")
        .iter()
        .map(|v| v.as_str().expect("id").to_string())
        .collect();
    got.sort();
    written.sort();
    assert_eq!(got, written);

    db.cleanup().await;
}
