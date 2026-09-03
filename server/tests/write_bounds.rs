//! The bounds on the write path, over real HTTP.
//!
//! Two properties are asserted together throughout: an oversized request is refused, **and** it
//! costs no rate-limit tokens. The second is what keeps the refusal from being an attack of its
//! own — a caller who stores nothing must not be able to drain a bucket shared with hunters the
//! limiter cannot tell apart from them.

mod common;

use common::{report_body, TestDb};
use foxmapper_server::{
    rate_limit::{ClientIpSource, RateLimiter},
    router,
    routes::hunts::{MAX_FREQUENCY_CHARS, MAX_LABEL_CHARS},
    routes::reports::{MAX_BATCH, MAX_REPORT_BYTES},
    spawn_listener, AppState,
};
use std::{net::SocketAddr, time::Duration};
use uuid::Uuid;

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

/// A report whose serialized envelope is far past the cap, built by padding a field the server
/// never reads — the point being that size is bounded without anyone looking inside.
fn bloated_report(id: Uuid, bytes: usize) -> serde_json::Value {
    let mut body = report_body(id, "bearing");
    body["payload"]["note"] = serde_json::Value::String("x".repeat(bytes));
    body
}

/// A bucket that cannot refill, so anything spent stays spent and is visible to the next request.
fn strict_limiter(capacity: f64) -> RateLimiter {
    RateLimiter::new(capacity, 0.0)
}

#[tokio::test]
async fn an_oversized_report_is_refused_and_costs_nothing() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let state = db.state_with(strict_limiter(4.0), ClientIpSource::default());
    let base = serve(state).await;
    let http = reqwest::Client::new();

    // A megabyte: 128 times the cap and comfortably inside axum's own 2 MB body limit, so the
    // rejection is provably this cap rather than the framework's.
    for _ in 0..8 {
        let r = http
            .post(format!("{base}/api/hunts/{code}/reports"))
            .json(&bloated_report(Uuid::new_v4(), 1024 * 1024))
            .send()
            .await
            .expect("post");
        assert_eq!(r.status(), 413, "an oversized report was not refused");
    }

    // Eight refusals against a bucket of four. If any of them had been charged, this would 429.
    let r = http
        .post(format!("{base}/api/hunts/{code}/reports"))
        .json(&report_body(Uuid::new_v4(), "bearing"))
        .send()
        .await
        .expect("post");
    assert_eq!(
        r.status(),
        202,
        "a refused request spent tokens, so a caller who stores nothing can still exhaust a hunt"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn a_report_just_under_the_cap_is_accepted() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // The cap must have real headroom over the format, not sit on top of it: a report roughly
    // seven times the largest one the log format can produce still has to go through.
    let r = http
        .post(format!("{base}/api/hunts/{code}/reports"))
        .json(&bloated_report(Uuid::new_v4(), MAX_REPORT_BYTES - 1024))
        .send()
        .await
        .expect("post");
    assert_eq!(r.status(), 202);

    db.cleanup().await;
}

#[tokio::test]
async fn a_full_flush_is_accepted_and_one_report_more_is_refused() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // The deployed client flushes in batches of exactly this size after a long offline stretch,
    // which is the normal case rather than an attack. If this ever 413s, every phone that spent an
    // afternoon out of coverage is stuck with reports nobody else can see.
    let batch: Vec<_> = (0..MAX_BATCH)
        .map(|_| report_body(Uuid::new_v4(), "bearing"))
        .collect();
    let r = http
        .post(format!("{base}/api/hunts/{code}/reports"))
        .json(&batch)
        .send()
        .await
        .expect("post");
    assert_eq!(
        r.status(),
        202,
        "a full flush from a real device was refused"
    );
    let accepted: serde_json::Value = r.json().await.expect("json");
    assert_eq!(
        accepted["accepted"].as_array().expect("accepted").len(),
        MAX_BATCH
    );

    let batch: Vec<_> = (0..=MAX_BATCH)
        .map(|_| report_body(Uuid::new_v4(), "bearing"))
        .collect();
    let r = http
        .post(format!("{base}/api/hunts/{code}/reports"))
        .json(&batch)
        .send()
        .await
        .expect("post");
    assert_eq!(r.status(), 413);

    db.cleanup().await;
}

#[tokio::test]
async fn an_oversized_batch_is_refused_before_the_hunt_is_looked_up() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // No hunt was seeded. A 413 rather than a 404 says the request was turned away on its shape,
    // before it reached the database — which is the only way the bound is worth having.
    let batch: Vec<_> = (0..=MAX_BATCH)
        .map(|_| report_body(Uuid::new_v4(), "bearing"))
        .collect();
    let r = http
        .post(format!("{base}/api/hunts/no-such-hunt-0000-aaaa/reports"))
        .json(&batch)
        .send()
        .await
        .expect("post");
    assert_eq!(r.status(), 413);

    db.cleanup().await;
}

#[tokio::test]
async fn an_oversized_target_is_rejected() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let long = "x".repeat(10 * 1024);
    for target in [
        serde_json::json!({ "frequency": "146.52", "label": long }),
        serde_json::json!({ "frequency": long, "label": "Saturday fox" }),
    ] {
        let r = http
            .post(format!("{base}/api/hunts"))
            .json(&serde_json::json!({ "target": target }))
            .send()
            .await
            .expect("create");
        assert_eq!(r.status(), 400, "an unbounded target string was stored");
    }

    db.cleanup().await;
}

#[tokio::test]
async fn the_targets_hunters_actually_type_still_fit() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    // The caps are a bound on storage, not a vocabulary. Everything below is a real thing someone
    // would name a hunt, and the frequency stays an opaque string.
    for (frequency, label) in [
        ("146.52", "Bellingham Saturday fox hunt"),
        (
            "the 440 machine",
            "Whatcom County ARES practice hunt — spring",
        ),
        ("two meters", ""),
        ("", "fox"),
    ] {
        let r = http
            .post(format!("{base}/api/hunts"))
            .json(&serde_json::json!({
                "target": { "frequency": frequency, "label": label }
            }))
            .send()
            .await
            .expect("create");
        assert_eq!(
            r.status(),
            201,
            "rejected a real hunt: {label:?} on {frequency:?}"
        );
    }

    db.cleanup().await;
}

#[tokio::test]
async fn the_caps_are_inclusive() {
    let db = TestDb::new().await;
    let base = serve(db.state()).await;
    let http = reqwest::Client::new();

    let create = |frequency: String, label: String| {
        http.post(format!("{base}/api/hunts"))
            .json(&serde_json::json!({
                "target": { "frequency": frequency, "label": label }
            }))
            .send()
    };

    let r = create("f".repeat(MAX_FREQUENCY_CHARS), "l".repeat(MAX_LABEL_CHARS))
        .await
        .expect("create");
    assert_eq!(r.status(), 201, "a target exactly at the cap was rejected");

    for (frequency, label) in [
        ("f".repeat(MAX_FREQUENCY_CHARS + 1), "fox".to_string()),
        ("146.52".to_string(), "l".repeat(MAX_LABEL_CHARS + 1)),
    ] {
        let r = create(frequency, label).await.expect("create");
        assert_eq!(r.status(), 400, "one character over the cap was accepted");
    }

    // Characters, not bytes: an accented club name must not cost double, and an emoji must not
    // cost four.
    let r = create("146.52".to_string(), "é".repeat(MAX_LABEL_CHARS))
        .await
        .expect("create");
    assert_eq!(
        r.status(),
        201,
        "the cap counts bytes, so it shortens non-ASCII names"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn hunt_creation_is_rate_limited() {
    let db = TestDb::new().await;
    // Ten tokens against a cost of five: two hunts, then the door shuts. The real bucket holds 600
    // and refills, so a club starting a dozen hunts in an afternoon never reaches this.
    let state = db.state_with(strict_limiter(10.0), ClientIpSource::default());
    let base = serve(state).await;
    let http = reqwest::Client::new();

    let create = |body| {
        http.post(format!("{base}/api/hunts"))
            .json(&serde_json::json!({ "target": body }))
            .send()
    };
    let target = serde_json::json!({ "frequency": "146.52", "label": "fox" });

    for _ in 0..2 {
        let r = create(target.clone()).await.expect("create");
        assert_eq!(r.status(), 201);
    }
    let r = create(target).await.expect("create");
    assert_eq!(
        r.status(),
        429,
        "hunt creation is unbounded, so a script can fill the database a row at a time"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn an_oversized_target_costs_no_tokens() {
    let db = TestDb::new().await;
    let state = db.state_with(strict_limiter(5.0), ClientIpSource::default());
    let base = serve(state).await;
    let http = reqwest::Client::new();

    for _ in 0..4 {
        let r = http
            .post(format!("{base}/api/hunts"))
            .json(&serde_json::json!({
                "target": { "frequency": "146.52", "label": "x".repeat(10 * 1024) }
            }))
            .send()
            .await
            .expect("create");
        assert_eq!(r.status(), 400);
    }

    let r = http
        .post(format!("{base}/api/hunts"))
        .json(&serde_json::json!({
            "target": { "frequency": "146.52", "label": "fox" }
        }))
        .send()
        .await
        .expect("create");
    assert_eq!(r.status(), 201, "a rejected target spent tokens");

    db.cleanup().await;
}

#[tokio::test]
async fn without_a_trusted_header_every_caller_shares_the_peer_bucket() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    // The default, and what the relay does unless an operator has set the variable. Both requests
    // arrive from 127.0.0.1, so a header nobody was told to trust changes nothing.
    let state = db.state_with(strict_limiter(1.0), ClientIpSource::default());
    let base = serve(state).await;
    let http = reqwest::Client::new();

    let post = |ip: &str| {
        http.post(format!("{base}/api/hunts/{code}/reports"))
            .header("x-test-client-ip", ip)
            .json(&report_body(Uuid::new_v4(), "bearing"))
            .send()
    };

    assert_eq!(post("198.51.100.1").await.expect("post").status(), 202);
    assert_eq!(
        post("198.51.100.2").await.expect("post").status(),
        429,
        "an untrusted header was read, so anyone can mint themselves a fresh bucket"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn a_trusted_header_gives_each_caller_its_own_bucket() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let state = db.state_with(
        strict_limiter(1.0),
        ClientIpSource::trusting(axum::http::HeaderName::from_static("x-test-client-ip")),
    );
    let base = serve(state).await;
    let http = reqwest::Client::new();

    let post = |ip: &str| {
        http.post(format!("{base}/api/hunts/{code}/reports"))
            .header("x-test-client-ip", ip)
            .json(&report_body(Uuid::new_v4(), "bearing"))
            .send()
    };

    // What the change actually buys: one flooder no longer 429s everyone else behind the same
    // proxy. It does not stop the flooder, who can rotate the header at will.
    assert_eq!(post("198.51.100.1").await.expect("post").status(), 202);
    assert_eq!(post("198.51.100.1").await.expect("post").status(), 429);
    assert_eq!(
        post("198.51.100.2").await.expect("post").status(),
        202,
        "a second caller was starved by the first, which is the damage this exists to stop"
    );

    db.cleanup().await;
}

#[tokio::test]
async fn a_missing_trusted_header_falls_back_to_the_peer_address() {
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let state = db.state_with(
        strict_limiter(1.0),
        ClientIpSource::trusting(axum::http::HeaderName::from_static("x-test-client-ip")),
    );
    let base = serve(state).await;
    let http = reqwest::Client::new();

    // Omitting the header must not be a way to skip the limit: a request that cannot be attributed
    // still lands in the peer's bucket.
    let post = || {
        http.post(format!("{base}/api/hunts/{code}/reports"))
            .json(&report_body(Uuid::new_v4(), "bearing"))
            .send()
    };
    assert_eq!(post().await.expect("post").status(), 202);
    assert_eq!(post().await.expect("post").status(), 429);

    db.cleanup().await;
}

#[tokio::test]
async fn live_delivery_survives_the_bounds() {
    // A guard against fixing the write path by breaking the thing it feeds: SC-002 is the whole
    // product, and a 200-report flush has to reach an open stream.
    let db = TestDb::new().await;
    let code = "quiet-fox-8821-h7k2";
    db.seed_hunt(code).await;
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();
    let state = db.state();
    spawn_listener(
        format!(
            "{}/{}",
            std::env::var("DATABASE_URL")
                .unwrap_or_else(
                    |_| "postgres://foxmapper:foxmapper@localhost:5432/foxmapper".into()
                )
                .rsplit_once('/')
                .expect("database url has a path")
                .0,
            db.name
        ),
        state.notify_tx.clone(),
        Some(ready_tx),
    );
    ready_rx.await.expect("listener ready");

    let mut notifications = state.notify_tx.subscribe();
    let base = serve(state).await;
    let http = reqwest::Client::new();

    let batch: Vec<_> = (0..MAX_BATCH)
        .map(|_| report_body(Uuid::new_v4(), "bearing"))
        .collect();
    let r = http
        .post(format!("{base}/api/hunts/{code}/reports"))
        .json(&batch)
        .send()
        .await
        .expect("post");
    assert_eq!(r.status(), 202);

    let notified = tokio::time::timeout(Duration::from_secs(5), notifications.recv())
        .await
        .expect("a full flush produced no notification")
        .expect("notification");
    assert_eq!(notified, code);

    db.cleanup().await;
}
